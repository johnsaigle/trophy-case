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
const ASSETS_DIR = path.join(ROOT, "assets");

const LEVELS = ["direct-contribution", "direct-review", "reviewed-pr-scope", "repository-context"];
const LEVEL_COLORS = {
  "direct-contribution": "#047857",
  "direct-review": "#2563eb",
  "reviewed-pr-scope": "#94a3b8",
  "repository-context": "#e2e8f0",
};
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

const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const LEVEL_LABELS = {
  "direct-contribution": "direct contribution (authored files)",
  "direct-review": "direct review (inline comments)",
  "reviewed-pr-scope": "reviewed PR scope (other changed files)",
  "repository-context": "repository context (defaults/labels)",
};

/**
 * Horizontal stacked bars per tag: length = tagged records, color = strongest
 * evidence level observed for that tag. Deterministic: fixed sort, no
 * timestamps, identical inputs produce identical bytes.
 */
function renderEvidenceSvg(records, capabilities) {
  const width = 960;
  const topN = 24;
  const entries = Object.entries(capabilities)
    .map(([tag, v]) => ({ tag, ...v }))
    .sort((a, b) => b.records - a.records || a.tag.localeCompare(b.tag));
  const selected = entries.slice(0, topN);
  const hiddenCount = entries.length - selected.length;
  const max = selected.length ? selected[0].records : 1;

  const rowH = 34;
  const barX = 260;
  const barMaxW = 520;
  const top = 196;
  const legendY = top + selected.length * rowH + 44;
  const height = legendY + 76;

  const relations = Object.fromEntries(RELATIONS.map((r) => [r, 0]));
  const projects = new Set();
  for (const r of records) {
    projects.add(r.project);
    for (const rel of r.relations || []) relations[rel] += 1;
  }

  const svg = [];
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    `<title id="title">Contribution evidence by tag</title>`,
    `<desc id="desc">Tags from normalized GitHub pull request and issue records, split by the strongest evidence level observed.</desc>`,
    `<style>`,
    `  .title { font: 700 26px ui-sans-serif,system-ui,sans-serif; fill: #0f172a }`,
    `  .subtitle { font: 14px ui-sans-serif,system-ui,sans-serif; fill: #475569 }`,
    `  .stats { font: 12px ui-monospace,SFMono-Regular,monospace; fill: #64748b }`,
    `  .label { font: 600 14px ui-sans-serif,system-ui,sans-serif; fill: #334155 }`,
    `  .count { font: 700 12px ui-monospace,SFMono-Regular,monospace; fill: #334155 }`,
    `  .legend { font: 12px ui-sans-serif,system-ui,sans-serif; fill: #475569 }`,
    `  .footnote { font: 12px ui-sans-serif,system-ui,sans-serif; fill: #64748b }`,
    `</style>`,
    `<rect width="100%" height="100%" rx="16" fill="#f8fafc"/>`,
    `<text class="title" x="40" y="48">Contribution evidence by tag</text>`,
    `<text class="subtitle" x="40" y="75">Normalized GitHub PR/issue records · bar length shows tagged records; color shows the strongest evidence level.</text>`,
    `<text class="stats" x="40" y="99">${records.length} records · ${projects.size} projects · ${relations["authored-pr"]} authored PRs · ${relations["reviewed-pr"]} reviewed PRs · ${relations["authored-issue"]} issues</text>`
  );

  if (selected.length === 0) {
    svg.push(
      `<text class="label" x="40" y="${top}">No contribution records yet.</text>`,
      `</svg>`
    );
    return svg.join("\n");
  }

  selected.forEach((entry, i) => {
    const y = top + i * rowH + 6;
    svg.push(`<text class="label" x="40" y="${y + 15}">${esc(entry.tag)}</text>`);
    let x = barX;
    for (const level of LEVELS) {
      const count = entry.evidence[level] || 0;
      if (!count) continue;
      const w = (count / max) * barMaxW;
      svg.push(`<rect x="${x.toFixed(2)}" y="${y}" width="${w.toFixed(2)}" height="20" fill="${LEVEL_COLORS[level]}"/>`);
      x += w;
    }
    svg.push(`<text class="count" x="${(x + 8).toFixed(2)}" y="${y + 15}">${entry.records}</text>`);
  });

  const legendItems = LEVELS.map((level, i) => {
    const x = 40 + i * 225;
    return (
      `<rect x="${x}" y="${legendY - 11}" width="14" height="14" rx="3" fill="${LEVEL_COLORS[level]}"/>` +
      `<text class="legend" x="${x + 20}" y="${legendY}">${esc(LEVEL_LABELS[level])}</text>`
    );
  });
  svg.push(...legendItems);

  svg.push(
    `<text class="footnote" x="40" y="${legendY + 30}">Item-level evidence: files changed by authored PRs and files with inline review comments. Reviewed PR scope covers</text>`,
    `<text class="footnote" x="40" y="${legendY + 48}">other files changed by reviewed PRs. Repository context is repo defaults and issue labels. ${entries.length > topN ? `Top ${topN} of ${entries.length} tags · ${hiddenCount} not shown.` : `All ${entries.length} tags shown.`}</text>`,
    `</svg>`
  );
  return svg.join("\n");
}

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
        a.category === "language" ? p.languages : a.category === "ecosystem" ? p.ecosystems : null;
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
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const outputs = [
    ["contributions.json", out.contributions],
    ["project-profiles.json", out.projectProfiles],
    ["contribution-capabilities.json", out.contributionCapabilities],
  ];
  for (const [name, value] of outputs) {
    writeIfChanged(path.join(DIST_DIR, name), json(value));
  }
  writeIfChanged(
    path.join(ASSETS_DIR, "contribution-evidence.svg"),
    renderEvidenceSvg(records, capabilities)
  );
  console.log(
    `Rendered ${outputs.map(([n]) => `dist/${n}`).join(", ")}, assets/contribution-evidence.svg from ${records.length} records.`
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
