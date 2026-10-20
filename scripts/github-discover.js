#!/usr/bin/env node
/**
 * Discovery: find candidate PRs/issues per configured repo via GitHub search.
 *
 * Usage:
 *   node scripts/github-discover.js --backfill [--repos a/b,c/d] [--dry-run]
 *   node scripts/github-discover.js --incremental [--overlap-days 7] [--dry-run]
 *
 * - Backfill queries bounded yearly windows per relationship and recursively
 *   splits any window that approaches the 1000-result search cap.
 * - Incremental queries an overlap window on `updated:` and upserts by stable ID.
 * - Candidates are written to .cache/github-enrichment/discovery.json (local).
 * - Completed windows are checkpointed to .github/enrichment-state.json, but
 *   only after candidates have been written successfully.
 * - --dry-run queries and reports but writes nothing.
 */
const fs = require("fs");
const path = require("path");
const { ghSearch, sleep, SEARCH_INTERVAL_MS } = require("./lib/github");
const { mergeCandidates, windowHalves, stableId } = require("./lib/contribution-rules");

const ROOT = path.resolve(__dirname, "..");
const REPOS_CONFIG = path.join(ROOT, "data", "github-enrichment-repos.json");
const STATE_PATH = path.join(ROOT, ".github", "enrichment-state.json");
const CACHE_DIR = path.join(ROOT, ".cache", "github-enrichment");
const DISCOVERY_PATH = path.join(CACHE_DIR, "discovery.json");

const SEARCH_SATURATION = 900; // approach the 1000-result cap -> split
const RELATIONSHIPS = ["authored-pr", "reviewed-pr", "authored-issue"];

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const INCREMENTAL = args.includes("--incremental");
const overlapArgIdx = args.indexOf("--overlap-days");
const OVERLAP_DAYS = overlapArgIdx >= 0 ? parseInt(args[overlapArgIdx + 1], 10) : 7;
const reposArgIdx = args.indexOf("--repos");
const REPO_FILTER = reposArgIdx >= 0 ? args[reposArgIdx + 1].split(",") : null;

if (!INCREMENTAL && !args.includes("--backfill")) {
  console.error("Pass --backfill or --incremental (add --dry-run to preview).");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(REPOS_CONFIG, "utf8"));
const AUTHOR = config.author;
const repos = REPO_FILTER || config.repos;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { windows: {}, last_incremental: {} };
  }
}

function loadDiscovery() {
  try {
    return JSON.parse(fs.readFileSync(DISCOVERY_PATH, "utf8"));
  } catch {
    return [];
  }
}

/** Atomic JSON write through a temporary file. */
function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`);
  fs.renameSync(tmp, filePath);
}

function queryFor(relationship, slug, window) {
  const dateQual = window.updated ? `updated:>=${window.from}` : `created:${window.from}..${window.to}`;
  const base = `repo:${slug}`;
  switch (relationship) {
    case "authored-pr":
      return `${base} is:pr author:${AUTHOR} ${dateQual}`;
    case "reviewed-pr":
      return `${base} is:pr reviewed-by:${AUTHOR} ${dateQual}`;
    case "authored-issue":
      return `${base} is:issue author:${AUTHOR} ${dateQual}`;
    default:
      throw new Error(`unknown relationship ${relationship}`);
  }
}

/** Recursively query a window, splitting it when the search is saturated. */
async function searchWindow(relationship, slug, window) {
  const { total_count, items } = await ghSearch(queryFor(relationship, slug, window));
  if (total_count < SEARCH_SATURATION) return items;
  const days =
    (new Date(`${window.to}T00:00:00Z`) - new Date(`${window.from}T00:00:00Z`)) / 86400e3;
  if (days < 2) {
    console.error(
      `WARN: ${slug} ${relationship} ${window.from}..${window.to} saturated (${total_count}) but cannot split further`
    );
    return items;
  }
  console.log(
    `  splitting saturated window ${window.from}..${window.to} (${total_count} hits) for ${slug} ${relationship}`
  );
  await sleep(SEARCH_INTERVAL_MS);
  const halves = windowHalves(window);
  const all = [];
  for (const half of halves) all.push(...(await searchWindow(relationship, slug, half)));
  return all;
}

function toCandidates(items, relationship, slug) {
  return items
    .filter((it) => it && (it.number || it.number === 0))
    .map((it) => ({
      id: stableId(it.pull_request ? "pull-request" : "issue", slug, it.number),
      kind: it.pull_request ? "pr" : "issue",
      project: slug,
      number: it.number,
      title: it.title,
      url: it.html_url,
      created_at: it.created_at,
      updated_at: it.updated_at,
      relations: [relationship],
    }));
}

function yearlyWindows() {
  const startYear = 2015; // earliest plausible activity; harmless to over-cover
  const endYear = new Date().getUTCFullYear();
  const windows = [];
  for (let y = startYear; y <= endYear; y++) {
    windows.push({ from: `${y}-01-01`, to: `${y}-12-31` });
  }
  return windows;
}

async function main() {
  const state = loadState();
  let candidates = loadDiscovery();
  state.windows = state.windows || {};
  state.last_incremental = state.last_incremental || {};
  const nowIso = new Date().toISOString();
  let totalNew = 0;

  for (const slug of repos) {
    for (const relationship of RELATIONSHIPS) {
      let windows;
      let updatedSince = null;
      if (INCREMENTAL) {
        const last = (state.last_incremental[slug] || {})[relationship];
        const from = last
          ? new Date(new Date(last).getTime() - OVERLAP_DAYS * 86400e3).toISOString().slice(0, 10)
          : `${new Date().getUTCFullYear()}-01-01`;
        updatedSince = from;
        windows = [{ from, to: nowIso.slice(0, 10), updated: true }];
      } else {
        const completed = new Set((state.windows[slug] || {})[relationship] || []);
        windows = yearlyWindows().filter((w) => !completed.has(`${w.from}..${w.to}`));
      }
      if (windows.length === 0) continue;

      for (const window of windows) {
        const label = `${slug} ${relationship} ${window.from}..${window.to}${window.updated ? " (updated)" : ""}`;
        const items = await searchWindow(relationship, slug, window);
        const fresh = toCandidates(items, relationship, slug);
        candidates = mergeCandidates(candidates, fresh);
        totalNew += fresh.length;
        console.log(`${label}: ${items.length} hits -> ${candidates.length} total candidates`);

        if (!DRY_RUN) {
          // Persist candidates before recording the window in the checkpoint.
          writeJsonAtomic(DISCOVERY_PATH, candidates);
          const key = `${window.from}..${window.to}`;
          if (INCREMENTAL) {
            state.last_incremental[slug] = state.last_incremental[slug] || {};
            state.last_incremental[slug][relationship] = nowIso;
          } else {
            state.windows[slug] = state.windows[slug] || {};
            state.windows[slug][relationship] = [
              ...new Set([...((state.windows[slug] || {})[relationship] || []), key]),
            ].sort();
          }
          writeJsonAtomic(STATE_PATH, state);
        }
        await sleep(SEARCH_INTERVAL_MS);
      }
    }
  }

  console.log(
    `${DRY_RUN ? "DRY RUN: " : ""}done. ${totalNew} discovery hits merged into ${candidates.length} candidates.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
