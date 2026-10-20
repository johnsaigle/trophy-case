#!/usr/bin/env node
/**
 * Generate deterministic, dependency-free data exports and SVG visualizations.
 *
 * Identical events.jsonl, data/tag-taxonomy.json, and
 * data/finding-class-overrides.json inputs produce byte-for-byte identical
 * output. Run: node scripts/render-visuals.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EVENTS_PATH = path.join(ROOT, "events.jsonl");
const TAXONOMY_PATH = path.join(ROOT, "data", "tag-taxonomy.json");
const FINDING_CLASS_OVERRIDES_PATH = path.join(ROOT, "data", "finding-class-overrides.json");
const ASSETS_DIR = path.join(ROOT, "assets");
const DIST_DIR = path.join(ROOT, "dist");
const { background, SEVERITIES, SEVERITY_COLORS, themeCss, svgOpen } = require("./lib/svg");

const events = fs
  .readFileSync(EVENTS_PATH, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON on events.jsonl line ${index + 1}: ${error.message}`);
    }
  });
const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, "utf8"));
const findingClassConfig = JSON.parse(
  fs.readFileSync(FINDING_CLASS_OVERRIDES_PATH, "utf8")
);
const findingClassOverrides = findingClassConfig.classes;
const findingClassLabels = findingClassConfig.labels || {};

const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const titleCase = (value) =>
  ({ defi: "DeFi", dos: "DoS", evm: "EVM", php: "PHP", pii: "PII", sast: "SAST", zk: "ZK" })[
    value
  ] ||
  value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
const compareCountThenName = (a, b) => b.count - a.count || a.id.localeCompare(b.id);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function validateInputs() {
  const errors = [];
  const ids = new Set();
  const knownCategories = new Set(Object.keys(taxonomy.categories || {}));

  for (const [tag, category] of Object.entries(taxonomy.tags || {})) {
    if (!knownCategories.has(category)) errors.push(`taxonomy tag "${tag}" uses unknown category "${category}"`);
  }
  for (const category of taxonomy.map?.categories || []) {
    if (!knownCategories.has(category)) errors.push(`map uses unknown category "${category}"`);
  }

  for (const event of events) {
    if (!event.id) errors.push("event is missing id");
    else if (ids.has(event.id)) errors.push(`duplicate event id "${event.id}"`);
    else ids.add(event.id);

    const eventTags = event.tags || [];
    if (new Set(eventTags).size !== eventTags.length) errors.push(`${event.id}: duplicate tags`);
    for (const tag of eventTags) {
      if (!taxonomy.tags?.[tag]) errors.push(`${event.id}: tag "${tag}" is missing from data/tag-taxonomy.json`);
    }
  }

  if (errors.length) throw new Error(`Visualization input validation failed:\n- ${errors.join("\n- ")}`);
}

function buildCapabilityGraph() {
  const nodeEvents = new Map();
  const edgeEvents = new Map();

  for (const event of events) {
    const tags = [...new Set(event.tags || [])].sort();
    for (const tag of tags) {
      if (!nodeEvents.has(tag)) nodeEvents.set(tag, []);
      nodeEvents.get(tag).push(event.id);
    }
    for (let i = 0; i < tags.length; i += 1) {
      for (let j = i + 1; j < tags.length; j += 1) {
        const key = `${tags[i]}\0${tags[j]}`;
        if (!edgeEvents.has(key)) edgeEvents.set(key, []);
        edgeEvents.get(key).push(event.id);
      }
    }
  }

  const categories = Object.entries(taxonomy.categories)
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const nodes = [...nodeEvents.entries()]
    .map(([id, eventIds]) => ({
      id,
      label: titleCase(id),
      category: taxonomy.tags[id],
      count: eventIds.length,
      event_ids: eventIds.sort(),
    }))
    .sort(compareCountThenName);
  const edges = [...edgeEvents.entries()]
    .map(([key, eventIds]) => {
      const [source, target] = key.split("\0");
      return { source, target, count: eventIds.length, event_ids: eventIds.sort() };
    })
    .sort((a, b) =>
      b.count - a.count || a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
    );

  return {
    schema_version: 1,
    source: "events.jsonl",
    event_count: events.length,
    map: taxonomy.map,
    categories,
    nodes,
    edges,
  };
}

function buildFindingPatterns() {
  const counts = new Map();
  let findingCount = 0;
  let reportCount = 0;

  for (const event of events.filter((event) => event.type === "audit")) {
    const findings = event.audit?.findings || [];
    if (findings.length) reportCount += 1;
    for (const finding of findings) {
      findingCount += 1;
      const override = findingClassOverrides[`${event.id}/${finding.id}`];
      const className = override?.class || finding.class || "other";
      if (!counts.has(className)) counts.set(className, { count: 0, severities: {} });
      const entry = counts.get(className);
      entry.count += 1;
      entry.severities[finding.severity] = (entry.severities[finding.severity] || 0) + 1;
    }
  }

  const classes = [...counts.entries()]
    .map(([id, value]) => ({ id, label: findingClassLabels[id] || titleCase(id), ...value }))
    .sort((a, b) => {
      if (a.id === "other") return 1;
      if (b.id === "other") return -1;
      return compareCountThenName(a, b);
    });
  return {
    schema_version: 1,
    source: "events.jsonl",
    report_count: reportCount,
    finding_count: findingCount,
    classes,
  };
}

function renderFindingFingerprint(patterns) {
  const width = 960;
  const rowHeight = 30;
  const top = 138;
  const labelRight = 236;
  const barLeft = 252;
  const maximumCount = Math.max(...patterns.classes.map((entry) => entry.count));
  const unit = (width - barLeft - 70) / maximumCount;
  const height = top + patterns.classes.length * rowHeight + 62;
  const totals = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const entry of patterns.classes) {
    for (const [severity, count] of Object.entries(entry.severities)) totals[severity] += count;
  }
  const svg = [];

  svg.push(
    svgOpen(
      width,
      height,
      "Published report finding classifications",
      "Finding classes in public reports listing John Saigle as primary auditor, stacked by severity."
    ),
    themeCss([
      `.label { font: 600 13px ui-sans-serif,system-ui,sans-serif; fill: var(--fg) }`,
      `.count { font: 700 12px ui-monospace,SFMono-Regular,monospace; fill: var(--muted) }`,
      `.legend { font: 12px ui-sans-serif,system-ui,sans-serif; fill: var(--muted) }`,
      `.track { fill: var(--line); fill-opacity: .45 }`,
    ]),
    background(),
    `<text class="title" x="40" y="48">Published report finding classifications</text>`,
    `<text class="subtitle" x="40" y="75">${patterns.finding_count} findings across ${patterns.report_count} reports listing John Saigle as primary auditor · bars stacked by severity.</text>`
  );

  let legendX = 40;
  for (const severity of SEVERITIES) {
    if (!totals[severity]) continue;
    svg.push(
      `<rect x="${legendX}" y="96" width="12" height="12" rx="3" fill="${SEVERITY_COLORS[severity]}"/>`,
      `<text class="legend" x="${legendX + 18}" y="107">${severity} · ${totals[severity]}</text>`
    );
    legendX += 40 + severity.length * 6.4 + String(totals[severity]).length * 7;
  }

  patterns.classes.forEach((entry, index) => {
    const y = top + index * rowHeight;
    const breakdown = SEVERITIES.filter((severity) => entry.severities[severity])
      .map((severity) => `${severity}: ${entry.severities[severity]}`)
      .join(", ");
    svg.push(
      `<g>`,
      `<title>${esc(entry.label)}: ${entry.count} (${esc(breakdown)})</title>`,
      `<text class="label" x="${labelRight}" y="${y + 17}" text-anchor="end">${esc(entry.label)}</text>`
    );
    svg.push(`<rect x="${barLeft}" y="${y + 3}" width="${(width - barLeft - 70).toFixed(2)}" height="${rowHeight - 8}" rx="3" class="track"/>`);
    let x = barLeft;
    for (const severity of SEVERITIES) {
      const count = entry.severities[severity] || 0;
      if (!count) continue;
      svg.push(
        `<rect x="${x.toFixed(2)}" y="${y + 3}" width="${(count * unit - 1.5).toFixed(2)}" height="${rowHeight - 8}" rx="3" fill="${SEVERITY_COLORS[severity]}"/>`
      );
      x += count * unit;
    }
    svg.push(`<text class="count" x="${(x + 8).toFixed(2)}" y="${y + 17}">${entry.count}</text>`, `</g>`);
  });

  svg.push(
    `<text class="footnote" x="40" y="${height - 24}">Human-reviewed classes from data/finding-class-overrides.json · Generated from events.jsonl</text>`,
    `</svg>`,
    ``
  );
  return svg.join("\n");
}

validateInputs();
const capabilityGraph = buildCapabilityGraph();
const findingPatterns = buildFindingPatterns();

fs.mkdirSync(ASSETS_DIR, { recursive: true });
fs.mkdirSync(DIST_DIR, { recursive: true });
fs.writeFileSync(path.join(DIST_DIR, "events.json"), json(events));
fs.writeFileSync(path.join(DIST_DIR, "capability-graph.json"), json(capabilityGraph));
fs.writeFileSync(path.join(DIST_DIR, "finding-patterns.json"), json(findingPatterns));
fs.writeFileSync(path.join(ASSETS_DIR, "finding-fingerprint.svg"), renderFindingFingerprint(findingPatterns));

console.log(
  `Rendered visualizations: ${capabilityGraph.nodes.length} tags, ${capabilityGraph.edges.length} connections, ${findingPatterns.finding_count} findings`
);
