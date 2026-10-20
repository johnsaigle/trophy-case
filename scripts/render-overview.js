#!/usr/bin/env node
/**
 * Generate the at-a-glance README graphics: a headline stat strip and a
 * year-by-year activity timeline.
 *
 * Reads events.jsonl, dist/contributions.json, and dist/finding-patterns.json
 * (run scripts/render-visuals.js first). Output is deterministic.
 * Run: node scripts/render-overview.js
 */
const fs = require("fs");
const path = require("path");
const { background, roundedTop, FONT, MONO, SEVERITIES, SEVERITY_COLORS, esc, themeCss, svgOpen } = require("./lib/svg");

const ROOT = path.resolve(__dirname, "..");
const ASSETS_DIR = path.join(ROOT, "assets");
const events = fs
  .readFileSync(path.join(ROOT, "events.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map(JSON.parse);
const contributions = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "contributions.json"), "utf8")).records;
const patterns = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "finding-patterns.json"), "utf8"));

const AUTHORED = "#2563eb";
const REVIEWED = "#14b8a6";
const ISSUES = "#f59e0b";
const shortName = (project) => {
  const repo = project.split("/")[1];
  return repo.length > 11 ? `${repo.slice(0, 10)}…` : repo;
};
const fmt = (n) => n.toLocaleString("en-US");

// ---------------------------------------------------------------- stats

const audits = events.filter((e) => e.type === "audit");
const severityTotals = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
for (const entry of patterns.classes) {
  for (const [severity, count] of Object.entries(entry.severities)) severityTotals[severity] += count;
}
const authoredPrs = contributions.filter((r) => r.kind === "pull-request" && r.relations.includes("authored-pr")).length;
const reviewedPrs = contributions.filter((r) => r.kind === "pull-request" && r.relations.includes("reviewed-pr")).length;
const mergedAuthored = contributions.filter((r) => r.kind === "pull-request" && r.relations.includes("authored-pr") && r.merged_at).length;
const inlineComments = contributions.filter((r) => r.kind === "pull-request" && r.relations.includes("reviewed-pr")).reduce((sum, r) => sum + ((r.review && r.review.inline_comment_count) || 0), 0);
const issues = contributions.filter((r) => r.kind === "issue").length;
const projects = new Set(contributions.map((r) => r.project)).size;
const articles = events.filter((e) => e.type === "writing").length;
const tools = events.filter((e) => e.type === "tool").length;

// ---------------------------------------------------------------- stat strip

function renderStats() {
  const width = 960;
  const height = 168;
  const top = 24;
  const tileHeight = 120;
  const gap = 16;
  const tiles = [170, 270, 270, 142];
  const xs = [];
  tiles.reduce((x, w) => (xs.push(x), x + w + gap), 30);
  const big = (x, value, label, sub) => [
    `<text class="big" x="${x}" y="${top + 52}">${value}</text>`,
    `<text class="tile-label" x="${x}" y="${top + 76}">${esc(label)}</text>`,
    sub ? `<text class="tile-sub" x="${x}" y="${top + 98}">${esc(sub)}</text>` : "",
  ];
  const svg = [
    svgOpen(
      width,
      height,
      "Public work at a glance",
      "Audit, finding, pull request, tool, and article counts derived from the public record."
    ),
    themeCss([
      `.big { font: 700 40px ${FONT}; fill: var(--fg) }`,
      `.tile-label { font: 600 14px ${FONT}; fill: var(--fg) }`,
      `.tile-sub { font: 12px ${FONT}; fill: var(--muted) }`,
      `.tile-mono { font: 700 12px ${MONO}; fill: var(--muted) }`,
    ]),
    background({ accentBar: false }),
  ];
  const accents = ["url(#accent)", "#f97316", AUTHORED, REVIEWED];
  tiles.forEach((w, i) =>
    svg.push(
      `<rect class="card" x="${xs[i]}" y="${top}" width="${w}" height="${tileHeight}" rx="12"/>`,
      `<rect x="${xs[i] + 18}" y="${top}" width="36" height="4" rx="2" fill="${accents[i]}"/>`
    )
  );

  // 1. audits
  let x = xs[0] + 18;
  svg.push(...big(x, audits.length, "audits", "as primary auditor"));

  // 2. findings with severity bar
  x = xs[1] + 18;
  svg.push(...big(x, patterns.finding_count, "published findings", ""));
  const barWidth = tiles[1] - 36;
  let bx = x;
  for (const severity of SEVERITIES) {
    const count = severityTotals[severity];
    if (!count) continue;
    const w = (count / patterns.finding_count) * barWidth;
    svg.push(
      `<rect x="${bx.toFixed(2)}" y="${top + 88}" width="${Math.max(w - 2, 1).toFixed(2)}" height="10" rx="2" fill="${SEVERITY_COLORS[severity]}"><title>${severity}: ${count}</title></rect>`
    );
    bx += w;
  }
  svg.push(
    `<text class="tile-sub" x="${x}" y="${top + 114}">${SEVERITIES.filter((s) => severityTotals[s])
      .map((s) => `${severityTotals[s]} ${({ critical: "crit", medium: "med", informational: "info" })[s] || s}`)
      .join(" · ")}</text>`
  );

  // 3. pull requests: authored vs reviewed
  x = xs[2] + 18;
  svg.push(...big(x, `${fmt(authoredPrs)} / ${fmt(reviewedPrs)}`, "PRs authored / reviewed", ""));
  const prWidth = tiles[2] - 36;
  const authoredWidth = (authoredPrs / (authoredPrs + reviewedPrs)) * prWidth;
  svg.push(
    `<rect x="${x}" y="${top + 88}" width="${(authoredWidth - 2).toFixed(2)}" height="10" rx="2" fill="url(#g-authored)"/>`,
    `<rect x="${(x + authoredWidth).toFixed(2)}" y="${top + 88}" width="${(prWidth - authoredWidth).toFixed(2)}" height="10" rx="2" fill="url(#g-reviewed)"/>`,
    `<text class="tile-sub" x="${x}" y="${top + 114}">${fmt(mergedAuthored)} merged · ${fmt(inlineComments)} inline review comments</text>`
  );

  // 4. tools and articles
  x = xs[3] + 18;
  svg.push(...big(x, tools, "tools", `${articles} articles`));

  svg.push(`</svg>`, ``);
  return svg.join("\n");
}

// ---------------------------------------------------------------- timeline

function renderTimeline() {
  const width = 960;
  const gridLeft = 290;
  const gridRight = 920;
  const laneTop = 150;
  const laneH = 78;
  const height = laneTop + 3 * laneH + 96;

  // Project -> chapter, taken from the org recorded on events.jsonl.
  const orgByProject = new Map();
  for (const event of events) if (event.project && event.org) orgByProject.set(event.project, event.org);
  const quarterOf = (iso) => `${iso.slice(0, 4)}Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;

  // Repos with no event of their own (forks) fall into the chapter their dates imply.
  const orgOf = (r) => orgByProject.get(r.project) || (r.created_at >= "2024" ? "Asymmetric Research" : null);
  const chapter = (org) => {
    const records = contributions.filter((r) => orgOf(r) === org);
    const cells = new Map();
    for (const r of records) cells.set(quarterOf(r.created_at), (cells.get(quarterOf(r.created_at)) || 0) + 1);
    const authored = records.filter((r) => r.kind === "pull-request" && r.relations.includes("authored-pr"));
    return {
      cells,
      merged: authored.filter((r) => r.merged_at).length,
      reviewed: records.filter((r) => r.kind === "pull-request" && !r.relations.includes("authored-pr")).length,
      issues: records.filter((r) => r.kind === "issue").length,
    };
  };
  const mcgill = chapter("McGill University");
  const research = chapter("Asymmetric Research");
  const auditCells = new Map();
  for (const audit of audits) {
    if (!audit.date) continue;
    const key = quarterOf(audit.date);
    if (!auditCells.has(key)) auditCells.set(key, []);
    auditCells.get(key).push(audit);
  }
  const datedAudits = [...auditCells.values()].flat().length;

  const lanes = [
    { name: "McGill · LORIS", sub: `${mcgill.merged} merged PRs · ${mcgill.issues} issues · ${mcgill.reviewed} reviews`, color: "#2563eb", cells: mcgill.cells },
    { name: "Halborn · audit reports", sub: `${audits.length} audits · ${patterns.finding_count} findings`, color: "#6366f1", audits: auditCells },
    { name: "Asymmetric Research", sub: `${research.merged} merged PRs · ${research.reviewed} reviews · ${research.issues} issues`, color: "#14b8a6", cells: research.cells },
  ];

  const allQuarters = [
    ...mcgill.cells.keys(),
    ...research.cells.keys(),
    ...auditCells.keys(),
  ].sort();
  const firstYear = Number(allQuarters[0].slice(0, 4));
  const lastYear = Number(allQuarters[allQuarters.length - 1].slice(0, 4));
  const quarters = [];
  for (let y = firstYear; y <= lastYear; y += 1) for (let q = 1; q <= 4; q += 1) quarters.push(`${y}Q${q}`);
  const slot = (gridRight - gridLeft) / quarters.length;

  const svg = [
    svgOpen(
      width,
      height,
      "Public work over time",
      "Three chapters of public work by quarter: LORIS contributions, published audit reports, and security engineering in public repositories."
    ),
    themeCss([
      `.tick { font: 11px ${MONO}; fill: var(--faint) }`,
      `.lane { font: 700 14px ${FONT}; fill: var(--fg) }`,
      `.lane-sub { font: 12px ${FONT}; fill: var(--muted) }`,
      `.legend { font: 12px ${FONT}; fill: var(--muted) }`,
      `.grid { stroke: var(--line); stroke-width: 1 }`,
      `.empty { fill: var(--line); fill-opacity: .5 }`,
    ]),
    background(),
    `<text class="title" x="40" y="48">Public work over time</text>`,
    `<text class="subtitle" x="40" y="75">Three chapters of the public record, by quarter. Shading is relative within each row.</text>`,
  ];

  // legend: shading ramp + audit diamond
  svg.push(`<text class="legend" x="40" y="108">Less</text>`);
  [0.2, 0.4, 0.65, 1].forEach((opacity, i) =>
    svg.push(`<rect x="${72 + i * 18}" y="97" width="14" height="14" rx="3" fill="#2563eb" fill-opacity="${opacity}"/>`)
  );
  svg.push(
    `<text class="legend" x="150" y="108">More PRs and issues that quarter</text>`,
    `<path d="M 386 96 l 8 8 l -8 8 l -8 -8 z" fill="#6366f1"/>`,
    `<text class="legend" x="402" y="108">One published audit report</text>`
  );

  quarters.forEach((q, i) => {
    if (!q.endsWith("Q1")) return;
    const x = gridLeft + i * slot;
    svg.push(
      `<text class="tick" x="${(x + 2).toFixed(2)}" y="${laneTop - 12}">${q.slice(0, 4)}</text>`,
      `<line class="grid" x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${laneTop - 6}" y2="${laneTop + 3 * laneH - 14}"/>`
    );
  });

  lanes.forEach((lane, index) => {
    const y = laneTop + index * laneH;
    const mid = y + (laneH - 14) / 2;
    svg.push(
      `<text class="lane" x="40" y="${mid - 2}">${esc(lane.name)}</text>`,
      `<text class="lane-sub" x="40" y="${mid + 16}">${esc(lane.sub)}</text>`
    );
    if (lane.cells) {
      const peak = Math.max(...lane.cells.values());
      quarters.forEach((q, i) => {
        const n = lane.cells.get(q);
        const x = gridLeft + i * slot + 1;
        if (!n) {
          svg.push(`<rect class="empty" x="${x.toFixed(2)}" y="${(mid - 4).toFixed(2)}" width="${(slot - 2).toFixed(2)}" height="8" rx="2"/>`);
          return;
        }
        const opacity = (0.2 + 0.8 * Math.sqrt(n / peak)).toFixed(2);
        svg.push(
          `<rect x="${x.toFixed(2)}" y="${(mid - 20).toFixed(2)}" width="${(slot - 2).toFixed(2)}" height="40" rx="3" fill="${lane.color}" fill-opacity="${opacity}"><title>${esc(lane.name)} ${q}: ${n} PRs and issues</title></rect>`
        );
      });
    } else {
      quarters.forEach((q, i) => {
        const x = gridLeft + i * slot + 1;
        if (!lane.audits.has(q)) {
          svg.push(`<rect class="empty" x="${x.toFixed(2)}" y="${(mid - 4).toFixed(2)}" width="${(slot - 2).toFixed(2)}" height="8" rx="2"/>`);
          return;
        }
        const list = lane.audits.get(q);
        const names = list.map((a) => `${a.client} (${a.date})`).join("; ");
        svg.push(`<g><title>${q}: ${esc(names)}</title>`);
        list.forEach((_, k) => {
          const cy = mid + (k - (list.length - 1) / 2) * 15;
          const cx = gridLeft + (quarters.indexOf(q) + 0.5) * slot;
          svg.push(`<path d="M ${cx.toFixed(2)} ${(cy - 9).toFixed(2)} l 8 9 l -8 9 l -8 -9 z" fill="${lane.color}"/>`);
        });
        svg.push(`</g>`);
      });
    }
  });

  svg.push(
    `<text class="footnote" x="40" y="${height - 38}">Dated by PR or issue creation, or by report date. Only watched public repositories are counted; PR counts are not comparable across chapters.</text>`,
    `<text class="footnote" x="40" y="${height - 18}">${audits.length - datedAudits ? `${audits.length - datedAudits} undated audit not shown. ` : ""}Chapters come from the org recorded on each event in events.jsonl. Generated from events.jsonl and contributions.jsonl.</text>`,
    `</svg>`,
    ``
  );
  return svg.join("\n");
}

const summary = {
  schema_version: 1,
  source: ["events.jsonl", "contributions.jsonl"],
  audits: audits.length,
  findings: { total: patterns.finding_count, by_severity: severityTotals },
  contributions: {
    records: contributions.length,
    projects,
    authored_prs: authoredPrs,
    merged_authored_prs: mergedAuthored,
    inline_review_comments: inlineComments,
    reviewed_prs: reviewedPrs,
    issues,
  },
  tools,
  articles,
};

fs.mkdirSync(ASSETS_DIR, { recursive: true });
fs.writeFileSync(path.join(ROOT, "dist", "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(ASSETS_DIR, "overview-stats.svg"), renderStats());
fs.writeFileSync(path.join(ASSETS_DIR, "career-timeline.svg"), renderTimeline());
console.log("Rendered overview graphics and dist/summary.json");
