#!/usr/bin/env node
/**
 * Render derived profiles from contributions.jsonl (never modifies it).
 *
 * Outputs (generated; byte-for-byte deterministic, no timestamps):
 *   dist/contributions.json             - normalized records for the website
 *   dist/project-profiles.json          - per-project evidence-level breakdowns
 *   dist/contribution-capabilities.json - tag totals separated by evidence level
 *
 * Deliberately separate from the events.jsonl capability map: contribution
 * counts are not merged into event counts (a large repository would dominate
 * it and change the visualization's meaning).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTRIBUTIONS_PATH = path.join(ROOT, "contributions.jsonl");
const DIST_DIR = path.join(ROOT, "dist");

const LEVELS = ["direct-contribution", "direct-review", "reviewed-pr-scope", "repository-context"];
const RELATIONS = ["authored-pr", "reviewed-pr", "authored-issue"];

function loadContributions() {
  return fs
    .readFileSync(CONTRIBUTIONS_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`Invalid JSON on contributions.jsonl line ${i + 1}: ${err.message}`);
      }
    });
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function emptyLevelCounts() {
  return Object.fromEntries(LEVELS.map((l) => [l, 0]));
}

/** Highest evidence level at which a tag appears in a record's assertions. */
function levelByTag(record) {
  const byTag = new Map();
  for (const a of record.assertions || []) {
    const rank = LEVELS.indexOf(a.evidence_level);
    const existing = byTag.get(a.tag);
    if (!existing || rank > LEVELS.indexOf(existing)) byTag.set(a.tag, a.evidence_level);
  }
  return byTag;
}

function main() {
  const records = loadContributions().sort((a, b) => a.id.localeCompare(b.id));

  // ---------------------------------------------------------------- projects
  const projects = new Map();
  for (const r of records) {
    const p =
      projects.get(r.project) ||
      (() => {
        const fresh = {
          project: r.project,
          records: 0,
          relations: Object.fromEntries(RELATIONS.map((rel) => [rel, 0])),
          languages: {},
          ecosystems: {},
          domains: {},
        };
        projects.set(r.project, fresh);
        return fresh;
      })();
    p.records += 1;
    for (const rel of r.relations || []) {
      if (!(rel in p.relations)) p.relations[rel] = 0;
      p.relations[rel] += 1;
    }
    const byTag = levelByTag(r);
    for (const a of r.assertions || []) {
      const bucket =
        a.category === "language"
          ? p.languages
          : a.category === "ecosystem"
            ? p.ecosystems
            : a.category === "domain"
              ? p.domains
              : null;
      if (!bucket) continue;
      const entry =
        bucket[a.tag] ||
        (bucket[a.tag] = { records: 0, evidence: emptyLevelCounts() });
      entry.records += 1;
      entry.evidence[byTag.get(a.tag)] += 1;
    }
  }
  const projectProfiles = [...projects.values()]
    .map((p) => ({
      ...p,
      languages: sortKeysByThenName(p.languages),
      ecosystems: sortKeysByThenName(p.ecosystems),
      domains: sortKeysByThenName(p.domains),
    }))
    .sort((a, b) => b.records - a.records || a.project.localeCompare(b.project));

  // ----------------------------------------------------------- capabilities
  const capabilities = {};
  for (const r of records) {
    const byTag = levelByTag(r);
    for (const a of r.assertions || []) {
      const entry =
        capabilities[a.tag] ||
        (capabilities[a.tag] = { category: a.category, records: 0, evidence: emptyLevelCounts() });
      entry.records += 1;
      entry.evidence[byTag.get(a.tag)] += 1;
    }
  }

  const out = {
    contributions: { version: 1, count: records.length, records },
    projectProfiles: { version: 1, projects: projectProfiles },
    contributionCapabilities: {
      version: 1,
      levels: LEVELS,
      tags: Object.fromEntries(
        Object.entries(capabilities).sort(([a], [b]) => a.localeCompare(b))
      ),
    },
  };

  fs.mkdirSync(DIST_DIR, { recursive: true });
  const outputs = [
    ["contributions.json", out.contributions],
    ["project-profiles.json", out.projectProfiles],
    ["contribution-capabilities.json", out.contributionCapabilities],
  ];
  for (const [name, value] of outputs) {
    writeIfChanged(path.join(DIST_DIR, name), json(value));
  }
  console.log(
    `Rendered ${outputs.map(([n]) => `dist/${n}`).join(", ")} from ${records.length} records.`
  );
}

function sortKeysByThenName(obj) {
  return Object.fromEntries(
    Object.entries(obj)
      .sort(([aName, a], [bName, b]) => b.records - a.records || aName.localeCompare(bName))
  );
}

function writeIfChanged(filePath, content) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) return;
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

main();
