#!/usr/bin/env node
/**
 * Local batching helpers for manual/agent semantic classification.
 *
 *   node scripts/semantic-batch.js dump [--offset N] [--limit N]
 *       Print compact, token-efficient packets not yet in the results file.
 *
 *   node scripts/semantic-batch.js merge
 *       Read a JSON object { "<record-id>": {judgment...}, ... } from stdin and
 *       merge it into data/github-enrichment-semantic.json. Each merged entry
 *       is forced to approved:false unless it already exists with approved:true.
 *
 *   node scripts/semantic-batch.js status
 *       Count classified vs remaining packets.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SEMANTIC_DIR = path.join(ROOT, ".cache", "github-enrichment", "semantic");
const RESULTS_PATH = path.join(ROOT, "data", "github-enrichment-semantic.json");

const args = process.argv.slice(2);
const sub = args[0];
const num = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? parseInt(args[i + 1], 10) : dflt;
};

function loadResults() {
  try {
    return JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function packets() {
  return fs
    .readdirSync(SEMANTIC_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(SEMANTIC_DIR, f), "utf8")));
}

const clip = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

function dump() {
  const results = loadResults();
  const offset = num("--offset", 0);
  const limit = num("--limit", 20);
  const pending = packets().filter((p) => !results[p.id]);
  const slice = pending.slice(offset, offset + limit);
  console.log(`PENDING ${pending.length} TOTAL, showing ${slice.length} (offset ${offset})\n`);
  for (const p of slice) {
    console.log(`## ${p.id}`);
    console.log(`TITLE: ${clip(p.title, 160)}`);
    if (p.files.length) console.log(`FILES(${p.files.length}): ${p.files.slice(0, 8).map((f) => clip(f, 90)).join(" | ")}`);
    for (const r of p.owner_review_bodies.slice(0, 2)) {
      console.log(`REVIEW[${r.state}]: ${clip(r.body, 340)}`);
    }
    if (p.owner_review_bodies.length > 2) console.log(`(+${p.owner_review_bodies.length - 2} more reviews)`);
    for (const c of p.owner_comment_bodies.slice(0, 4)) {
      console.log(`COMMENT@${clip(c.path, 70)}: ${clip(c.body, 190)}`);
    }
    if (p.owner_comment_bodies.length > 4) console.log(`(+${p.owner_comment_bodies.length - 4} more comments)`);
    console.log();
  }
}

function merge() {
  const patch = JSON.parse(fs.readFileSync(0, "utf8"));
  const results = loadResults();
  let merged = 0;
  for (const [id, j] of Object.entries(patch)) {
    if (!j || typeof j !== "object") throw new Error(`bad judgment for ${id}`);
    const prior = results[id];
    results[id] = {
      security_relevant: Boolean(j.security_relevant),
      work_orientation: ["protocol-security", "appsec", "other"].includes(j.work_orientation)
        ? j.work_orientation
        : "other",
      vuln_classes: Array.isArray(j.vuln_classes) ? j.vuln_classes : [],
      notable: Boolean(j.notable),
      basis: typeof j.basis === "string" ? j.basis.slice(0, 500) : "",
      judged_by: "agent",
      // Never carry approval from a different judgment; new entries start false.
      approved: prior ? prior.approved === true : false,
    };
    merged++;
  }
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 1) + "\n");
  const total = Object.keys(results).filter((k) => k !== ".").length;
  console.log(`merged ${merged}; results now ${total} entries`);
}

function status() {
  const results = loadResults();
  const all = packets();
  const done = all.filter((p) => results[p.id]).length;
  console.log({ packets: all.length, classified: done, remaining: all.length - done });
}

if (sub === "dump") dump();
else if (sub === "merge") merge();
else if (sub === "status") status();
else {
  console.error("Usage: dump [--offset N] [--limit N] | merge < patch.json | status");
  process.exit(1);
}
