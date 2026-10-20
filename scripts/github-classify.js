#!/usr/bin/env node
/**
 * Classification: apply deterministic rules (data/github-enrichment-rules.json)
 * and reviewable overrides (data/github-enrichment-overrides.json) to hydrated
 * raw facts, upserting the checked-in contributions.jsonl.
 *
 * Usage: node scripts/github-classify.js
 *
 * - One record per public PR/issue, keyed by stable ID.
 * - Records are sorted by ID; output is written atomically and only when the
 *   content actually changed.
 * - No network, no LLM: classification is fully reproducible from the cache.
 */
const fs = require("fs");
const path = require("path");
const {
  classifyRecord,
} = require("./lib/contribution-rules");

const ROOT = path.resolve(__dirname, "..");
const REPOS_CONFIG = path.join(ROOT, "data", "github-enrichment-repos.json");
const RULES_PATH = path.join(ROOT, "data", "github-enrichment-rules.json");
const OVERRIDES_PATH = path.join(ROOT, "data", "github-enrichment-overrides.json");
const RAW_DIR = path.join(ROOT, ".cache", "github-enrichment", "raw");
const CONTRIBUTIONS_PATH = path.join(ROOT, "contributions.jsonl");

const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
const author = JSON.parse(fs.readFileSync(REPOS_CONFIG, "utf8")).author;

function loadContributions() {
  try {
    return fs
      .readFileSync(CONTRIBUTIONS_PATH, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function writeContributionsAtomic(records) {
  const tmp = `${CONTRIBUTIONS_PATH}.tmp`;
  fs.writeFileSync(tmp, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.renameSync(tmp, CONTRIBUTIONS_PATH);
}

function main() {
  if (!fs.existsSync(RAW_DIR)) {
    console.error(`No hydrated records at ${RAW_DIR}. Run scripts/github-hydrate.js first.`);
    process.exit(1);
  }
  const rawFiles = fs
    .readdirSync(RAW_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const previous = new Map(
    loadContributions().map((r) => [r.id, JSON.stringify(r)])
  );
  const records = new Map(loadContributions().map((r) => [r.id, r]));
  let classified = 0;
  let changed = 0;
  let skippedNoRelation = 0;
  for (const f of rawFiles) {
    const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), "utf8"));
    let record;
    try {
      record = classifyRecord(raw, rules, { author, overrides });
    } catch (err) {
      // Discovery is only a candidate source: hydrated facts may not support
      // any relationship (e.g. a stale search hit). Skip those, loudly.
      if (/no relationship/.test(err.message)) {
        skippedNoRelation++;
        continue;
      }
      throw err;
    }
    if (record.id !== f.replace(/\.json$/, "")) {
      throw new Error(`Cache filename ${f} does not match stable ID ${record.id}`);
    }
    records.set(record.id, record);
    if (previous.get(record.id) !== JSON.stringify(record)) changed++;
    classified++;
  }

  const sorted = [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
  const output = sorted.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const current = fs.existsSync(CONTRIBUTIONS_PATH)
    ? fs.readFileSync(CONTRIBUTIONS_PATH, "utf8")
    : "";
  if (output === current) {
    console.log(`No changes: ${sorted.length} records (${classified} reclassified).`);
    return;
  }
  writeContributionsAtomic(sorted);
  console.log(
    `Wrote ${sorted.length} records (${changed} new or changed; ${skippedNoRelation} candidates had no supported relationship and were skipped).`
  );
}

main();
