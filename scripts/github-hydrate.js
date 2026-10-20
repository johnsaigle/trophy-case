#!/usr/bin/env node
/**
 * Hydration: fetch normalized GitHub facts for discovery candidates.
 *
 * Usage:
 *   node scripts/github-hydrate.js                     # hydrate pending candidates
 *   node scripts/github-hydrate.js --prs owner/repo#918,owner/repo#921
 *   node scripts/github-hydrate.js --issues owner/repo#123
 *
 * For each PR: pulls, files (paginated), reviews, and review comments. Reviews
 * and comments are kept in full in the local cache; the deterministic classifier
 * (github-classify.js) filters to the owner and stores only counts and paths in
 * the normalized dataset. Raw facts are cached under .cache/github-enrichment/raw/.
 *
 * Re-running is safe: candidates already hydrated with the same updated_at are
 * skipped. Nothing outside .cache/ is written; github-classify.js produces the
 * checked-in contributions.jsonl.
 */
const fs = require("fs");
const path = require("path");
const { gh, ghAllPages, withRateLimitRetry, sleep } = require("./lib/github");
const { stableId } = require("./lib/contribution-rules");

const ROOT = path.resolve(__dirname, "..");
const REPOS_CONFIG = path.join(ROOT, "data", "github-enrichment-repos.json");
const DISCOVERY_PATH = path.join(ROOT, ".cache", "github-enrichment", "discovery.json");
const RAW_DIR = path.join(ROOT, ".cache", "github-enrichment", "raw");

const args = process.argv.slice(2);
const prsIdx = args.indexOf("--prs");
const issuesIdx = args.indexOf("--issues");
const explicit = [];
if (prsIdx >= 0) explicit.push(...parseRefs(args[prsIdx + 1], "pr"));
if (issuesIdx >= 0) explicit.push(...parseRefs(args[issuesIdx + 1], "issue"));

function parseRefs(spec, kind) {
  return spec.split(",").map((s) => {
    const m = s.trim().match(/^([^/]+\/[^#]+)#(\d+)$/);
    if (!m) throw new Error(`Bad reference "${s}" (expected owner/repo#number)`);
    return { kind, project: m[1], number: parseInt(m[2], 10) };
  });
}

function loadDiscovery() {
  try {
    return JSON.parse(fs.readFileSync(DISCOVERY_PATH, "utf8"));
  } catch {
    return [];
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`);
  fs.renameSync(tmp, filePath);
}

function rawPath(id) {
  return path.join(RAW_DIR, `${id}.json`);
}

// Enough cumulative backoff to outlast an exhausted 5000/hour core limit
// (60+120+...+720s ≈ 78 min) plus secondary rate limits.
const RETRY_ATTEMPTS = 12;

async function hydratePr(slug, number) {
  const [owner, repo] = slug.split("/");
  const base = `repos/${owner}/${repo}/pulls/${number}`;
  const pr = await withRateLimitRetry(() => gh(base), { attempts: RETRY_ATTEMPTS });
  const files = await ghAllPages(`${base}/files`, { attempts: RETRY_ATTEMPTS });
  const reviews = await ghAllPages(`${base}/reviews`, { attempts: RETRY_ATTEMPTS });
  const comments = await ghAllPages(`repos/${owner}/${repo}/pulls/${number}/comments`, {
    attempts: RETRY_ATTEMPTS,
  });
  return { kind: "pr", project: slug, number, pr, files, reviews, comments };
}

async function hydrateIssue(slug, number) {
  const [owner, repo] = slug.split("/");
  const issue = await withRateLimitRetry(
    () => gh(`repos/${owner}/${repo}/issues/${number}`),
    { attempts: RETRY_ATTEMPTS }
  );
  if (issue.pull_request) {
    throw new Error(`${slug}#${number} is a PR, not an issue`);
  }
  return { kind: "issue", project: slug, number, issue };
}

async function main() {
  const config = JSON.parse(fs.readFileSync(REPOS_CONFIG, "utf8"));
  const AUTHOR = config.author;
  fs.mkdirSync(RAW_DIR, { recursive: true });

  let targets = explicit;
  if (targets.length === 0) {
    const candidates = loadDiscovery();
    targets = candidates.map((c) => ({
      kind: c.kind,
      project: c.project,
      number: c.number,
      updated_at: c.updated_at,
    }));
  }
  // Deterministic order; hydration is resumable so ordering only affects logging.
  targets.sort((a, b) =>
    `${a.project}#${a.number}`.localeCompare(`${b.project}#${b.number}`)
  );

  let hydrated = 0;
  let skipped = 0;
  let refreshed = 0;
  for (const t of targets) {
    const id = stableId(t.kind === "pr" ? "pull-request" : "issue", t.project, t.number);
    const existingPath = rawPath(id);
    if (fs.existsSync(existingPath)) {
      const existing = JSON.parse(fs.readFileSync(existingPath, "utf8"));
      const source = existing.pr || existing.issue;
      if (source && source.updated_at && (!t.updated_at || source.updated_at === t.updated_at)) {
        skipped++;
        continue;
      }
      // Cached but stale relative to discovery: re-hydrate (upsert overwrites).
      refreshed++;
    }
    process.stdout.write(`Hydrating ${id}... `);
    let raw;
    try {
      raw =
        t.kind === "pr"
          ? await hydratePr(t.project, t.number)
          : await hydrateIssue(t.project, t.number);
    } catch (err) {
      // One bad PR (deleted, 404, transient failure) must not kill the backfill;
      // state is resumable so the target is retried on the next run.
      console.log(`FAILED: ${err.message.slice(0, 200)}`);
      continue;
    }
    writeJsonAtomic(existingPath, raw);
    const ownerReviewCount = (raw.reviews || []).filter(
      (r) => r.user && r.user.login === AUTHOR && r.state !== "PENDING"
    ).length;
    console.log(
      `${raw.files ? raw.files.length : 0} files, ${ownerReviewCount} owner reviews, ` +
        `${(raw.comments || []).filter((c) => c.user && c.user.login === AUTHOR).length} owner inline comments`
    );
    hydrated++;
    await sleep(300);
  }
  console.log(`Hydrated ${hydrated}, skipped ${skipped} (already cached), refreshed ${refreshed} stale.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
