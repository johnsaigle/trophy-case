#!/usr/bin/env node
/**
 * Render assets/security-engineering.svg: public security-engineering work in
 * watched repositories since data/work-themes.json `since` — per-repo
 * quarterly activity lanes plus keyword groups over authored PR titles.
 *
 * Reads dist/contributions.json and data/work-themes.json (deterministic).
 * Run: node scripts/render-era.js
 */
const fs = require("fs");
const path = require("path");
const { background, roundedTop, FONT, MONO, esc, themeCss, svgOpen } = require("./lib/svg");

const ROOT = path.resolve(__dirname, "..");
const themes = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "work-themes.json"), "utf8"));
const all = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "contributions.json"), "utf8")).records;
const records = all.filter((r) => r.created_at >= themes.since);
const fmt = (n) => n.toLocaleString("en-US");

const role = (r) => (r.kind === "issue" ? "issues" : r.relations.includes("authored-pr") ? "authored" : "reviewed");
const quarter = (r) => `${r.created_at.slice(0, 4)}Q${Math.floor((Number(r.created_at.slice(5, 7)) - 1) / 3) + 1}`;

// ---------------------------------------------------------------- lanes
const repos = new Map();
for (const r of records) {
  if (!repos.has(r.project)) repos.set(r.project, { project: r.project, authored: 0, reviewed: 0, issues: 0, merged: 0, cells: new Map() });
  const repo = repos.get(r.project);
  repo[role(r)] += 1;
  if (role(r) === "authored" && r.merged_at) repo.merged += 1;
  const q = quarter(r);
  if (!repo.cells.has(q)) repo.cells.set(q, { authored: 0, reviewed: 0, issues: 0 });
  repo.cells.get(q)[role(r)] += 1;
}
const lanes = [...repos.values()].sort(
  (a, b) => b.authored + b.reviewed + b.issues - (a.authored + a.reviewed + a.issues) || a.project.localeCompare(b.project)
);
const quarters = [];
const years = [...new Set(records.map((r) => Number(r.created_at.slice(0, 4))))];
for (let y = Math.min(...years); y <= Math.max(...years); y += 1) for (let q = 1; q <= 4; q += 1) quarters.push(`${y}Q${q}`);
const peakCell = Math.max(...lanes.flatMap((l) => [...l.cells.values()].map((c) => c.authored + c.reviewed + c.issues)));

// ---------------------------------------------------------------- themes
const authoredPrs = records.filter((r) => r.kind === "pull-request" && r.relations.includes("authored-pr"));
const rules = themes.rules.map((rule) => ({ ...rule, regex: new RegExp(rule.pattern, "i") }));
const themeCounts = new Map();
for (const r of authoredPrs) {
  const rule = rules.find((candidate) => candidate.regex.test(r.title));
  const key = rule ? rule.id : "other";
  const label = rule ? rule.label : "Other";
  if (!themeCounts.has(key)) themeCounts.set(key, { id: key, label, count: 0, merged: 0 });
  const entry = themeCounts.get(key);
  entry.count += 1;
  if (r.merged_at) entry.merged += 1;
}
const themeRows = [...themeCounts.values()].sort((a, b) => {
  if (a.id === "other") return 1;
  if (b.id === "other") return -1;
  return b.count - a.count || a.id.localeCompare(b.id);
});

// ---------------------------------------------------------------- render
const width = 960;
const laneTop = 150;
const laneH = 40;
const gridLeft = 360;
const gridRight = 920;
const slot = (gridRight - gridLeft) / quarters.length;
const themeTop = laneTop + lanes.length * laneH + 78;
const themeRowH = 28;
const height = themeTop + themeRows.length * themeRowH + 70;
const barLeft = 270;
const barUnit = (width - barLeft - 110) / Math.max(...themeRows.map((t) => t.count));
const mergedTotal = authoredPrs.filter((r) => r.merged_at).length;
const reviewedTotal = records.filter((r) => role(r) === "reviewed").length;
const issueTotal = records.filter((r) => role(r) === "issues").length;

const svg = [
  svgOpen(
    width,
    height,
    "Security engineering in public repositories",
    "Quarterly activity per public repository and keyword groups over authored pull request titles."
  ),
  themeCss([
    `.lane { font: 600 13px ${FONT}; fill: var(--fg) }`,
    `.lane-sub { font: 11px ${FONT}; fill: var(--muted) }`,
    `.q { font: 11px ${MONO}; fill: var(--faint) }`,
    `.count { font: 700 12px ${MONO}; fill: var(--muted) }`,
    `.legend { font: 12px ${FONT}; fill: var(--muted) }`,
    `.grid { stroke: var(--line); stroke-width: 1 }`,
    `.track { fill: var(--line); fill-opacity: .45 }`,
    `.section { font: 700 13px ${FONT}; fill: var(--fg) }`,
  ]),
  background(),
  `<text class="title" x="40" y="48">Security engineering in public repositories</text>`,
  `<text class="subtitle" x="40" y="75">${fmt(authoredPrs.length)} authored PRs (${fmt(mergedTotal)} merged) · ${fmt(reviewedTotal)} reviewed PRs · ${fmt(issueTotal)} issues · ${quarters[0].slice(0, 4)}–${quarters[quarters.length - 1].slice(0, 4)}</text>`,
];

let lx = 40;
for (const [id, label] of [["authored", "authored PRs"], ["reviewed", "reviewed PRs (not authored)"], ["issues", "issues"]]) {
  svg.push(`<rect x="${lx}" y="96" width="12" height="12" rx="3" fill="url(#g-${id})"/>`, `<text class="legend" x="${lx + 18}" y="107">${label}</text>`);
  lx += 40 + label.length * 6.2;
}

quarters.forEach((q, i) => {
  const cx = gridLeft + (i + 0.5) * slot;
  if (q.endsWith("Q1")) svg.push(`<text class="q" x="${(gridLeft + i * slot + 2).toFixed(2)}" y="${laneTop - 10}">${q.slice(0, 4)}</text>`);
  if (q.endsWith("Q1") && i > 0) svg.push(`<line class="grid" x1="${gridLeft + i * slot}" x2="${gridLeft + i * slot}" y1="${laneTop - 4}" y2="${laneTop + lanes.length * laneH - 6}"/>`);
});

lanes.forEach((lane, index) => {
  const y = laneTop + index * laneH;
  const total = lane.authored + lane.reviewed + lane.issues;
  const repoName = lane.project.split("/")[1];
  const ambiguous = lanes.filter((other) => other.project.split("/")[1] === repoName).length > 1;
  const repo = ambiguous ? lane.project : repoName;
  const parts = [
    lane.authored ? `${lane.authored} authored${lane.merged ? ` (${lane.merged} merged)` : ""}` : "",
    lane.reviewed ? `${lane.reviewed} reviewed` : "",
    lane.issues ? `${lane.issues} issue${lane.issues === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  svg.push(
    `<g><title>${esc(lane.project)}: ${total} records</title>`,
    `<text class="lane" x="40" y="${y + 16}">${esc(repo)}</text>`,
    `<text class="lane-sub" x="40" y="${y + 30}">${esc(parts.join(" · "))}</text>`,
    `</g>`,
    `<line class="grid" x1="${gridLeft}" x2="${gridRight}" y1="${y + laneH - 4}" y2="${y + laneH - 4}"/>`
  );
  quarters.forEach((q, i) => {
    const cell = lane.cells.get(q);
    if (!cell) return;
    const n = cell.authored + cell.reviewed + cell.issues;
    const h = Math.max(4, 30 * Math.sqrt(n / peakCell));
    const w = Math.min(slot * 0.62, 26);
    const x0 = gridLeft + (i + 0.5) * slot - w / 2;
    let base = y + laneH - 5;
    const drawn = [["authored", cell.authored], ["reviewed", cell.reviewed], ["issues", cell.issues]].filter(([, c]) => c);
    svg.push(`<g><title>${esc(repo)} ${q}: ${n} (${drawn.map(([k, c]) => `${c} ${k}`).join(", ")})</title>`);
    drawn.forEach(([id, count], k) => {
      const segment = (count / n) * h;
      base -= segment;
      svg.push(
        k === drawn.length - 1
          ? `<path d="${roundedTop(x0, base, w, segment, 4)}" fill="url(#g-${id})"/>`
          : `<rect x="${x0.toFixed(2)}" y="${base.toFixed(2)}" width="${w.toFixed(2)}" height="${segment.toFixed(2)}" fill="url(#g-${id})"/>`
      );
    });
    svg.push(`</g>`);
  });
});

svg.push(
  `<text class="section" x="40" y="${themeTop - 30}">What the authored PR titles say</text>`,
  `<text class="lane-sub" x="40" y="${themeTop - 14}">Keyword groups over ${fmt(authoredPrs.length)} authored PR titles · bar = PRs, solid portion = merged</text>`
);
themeRows.forEach((row, i) => {
  const y = themeTop + i * themeRowH;
  svg.push(
    `<g><title>${esc(row.label)}: ${row.count} PRs, ${row.merged} merged</title>`,
    `<text class="lane" x="${barLeft - 14}" y="${y + 16}" text-anchor="end">${esc(row.label)}</text>`,
    `<rect class="track" x="${barLeft}" y="${y + 2}" width="${(row.count * barUnit).toFixed(2)}" height="18" rx="3"/>`,
    `<rect x="${barLeft}" y="${y + 2}" width="${Math.max(row.merged * barUnit - 1, 0).toFixed(2)}" height="18" rx="3" fill="url(#g-authored)"/>`,
    `<text class="count" x="${(barLeft + row.count * barUnit + 8).toFixed(2)}" y="${y + 16}">${row.count}</text>`,
    `</g>`
  );
});
svg.push(
  `<text class="footnote" x="40" y="${height - 36}">Quarterly column height uses a square-root scale. Groups come from data/work-themes.json (first match wins); they describe titles, not impact.</text>`,
  `<text class="footnote" x="40" y="${height - 18}">Dated by PR/issue creation; only watched public repositories. Much of this work is not public. Generated from contributions.jsonl.</text>`,
  `</svg>`,
  ``
);

fs.writeFileSync(path.join(ROOT, "assets", "security-engineering.svg"), svg.join("\n"));
console.log(`Rendered assets/security-engineering.svg: ${lanes.length} repos, ${themeRows.length} groups`);
