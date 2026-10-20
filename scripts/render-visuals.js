#!/usr/bin/env node
/**
 * Generate deterministic, dependency-free data exports and SVG visualizations.
 *
 * Identical events.jsonl and data/tag-taxonomy.json inputs produce byte-for-byte
 * identical output. Run: node scripts/render-visuals.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EVENTS_PATH = path.join(ROOT, "events.jsonl");
const TAXONOMY_PATH = path.join(ROOT, "data", "tag-taxonomy.json");
const FINDING_CLASS_OVERRIDES_PATH = path.join(ROOT, "data", "finding-class-overrides.json");
const ASSETS_DIR = path.join(ROOT, "assets");
const DIST_DIR = path.join(ROOT, "dist");

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

function renderCapabilityMap(graph) {
  const width = 960;
  const height = 560;
  const nodeWidth = 176;
  const nodeHeight = 48;
  const columns = taxonomy.map.categories;
  const minimumCount = taxonomy.map.minimum_event_count;
  const selected = graph.nodes.filter(
    (node) => columns.includes(node.category) && node.count >= minimumCount
  );
  const selectedById = new Map(selected.map((node) => [node.id, node]));
  const positions = new Map();

  columns.forEach((category, columnIndex) => {
    const nodes = selected.filter((node) => node.category === category).sort(compareCountThenName);
    const x = 138 + columnIndex * 228;
    const top = 158;
    const bottom = 472;
    nodes.forEach((node, index) => {
      const y = nodes.length === 1 ? (top + bottom) / 2 : top + (index * (bottom - top)) / (nodes.length - 1);
      positions.set(node.id, { x, y });
    });
  });

  const visibleEdges = graph.edges.filter((edge) => {
    const source = selectedById.get(edge.source);
    const target = selectedById.get(edge.target);
    return source && target && source.category !== target.category;
  });

  const svg = [];
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    `<title id="title">Public security capability map</title>`,
    `<desc id="desc">Recurring languages, ecosystems, security domains, and practices connected when their tags occur on the same public-work event.</desc>`,
    `<style>`,
    `  .title { font: 700 26px ui-sans-serif,system-ui,sans-serif; fill: #0f172a }`,
    `  .subtitle { font: 14px ui-sans-serif,system-ui,sans-serif; fill: #475569 }`,
    `  .heading { font: 700 14px ui-sans-serif,system-ui,sans-serif; fill: #334155; letter-spacing: .04em; text-transform: uppercase }`,
    `  .label { font: 600 14px ui-sans-serif,system-ui,sans-serif; fill: #fff }`,
    `  .count { font: 700 12px ui-monospace,SFMono-Regular,monospace; fill: #fff }`,
    `  .footnote { font: 12px ui-sans-serif,system-ui,sans-serif; fill: #64748b }`,
    `</style>`,
    `<rect width="100%" height="100%" rx="16" fill="#f8fafc"/>`,
    `<text class="title" x="40" y="48">Public security capability map</text>`,
    `<text class="subtitle" x="40" y="75">Connections show tags appearing together; line weight shows frequency.</text>`
  );

  for (const edge of visibleEdges) {
    const sourceNode = selectedById.get(edge.source);
    const targetNode = selectedById.get(edge.target);
    let source = positions.get(edge.source);
    let target = positions.get(edge.target);
    if (columns.indexOf(sourceNode.category) > columns.indexOf(targetNode.category)) {
      [source, target] = [target, source];
    }
    const x1 = source.x + nodeWidth / 2;
    const x2 = target.x - nodeWidth / 2;
    const middle = (x1 + x2) / 2;
    svg.push(
      `<path d="M ${x1} ${source.y} C ${middle} ${source.y}, ${middle} ${target.y}, ${x2} ${target.y}" fill="none" stroke="#94a3b8" stroke-opacity="0.38" stroke-width="${1 + edge.count * 1.4}">`,
      `<title>${esc(edge.source)} + ${esc(edge.target)}: ${edge.count} event${edge.count === 1 ? "" : "s"}</title>`,
      `</path>`
    );
  }

  columns.forEach((category, columnIndex) => {
    const definition = taxonomy.categories[category];
    const x = 138 + columnIndex * 228;
    svg.push(`<text class="heading" x="${x}" y="116" text-anchor="middle">${esc(definition.label)}</text>`);
  });

  for (const node of selected) {
    const { x, y } = positions.get(node.id);
    const color = taxonomy.categories[node.category].color;
    svg.push(
      `<g>`,
      `<title>${esc(node.label)}: ${node.count} event${node.count === 1 ? "" : "s"}</title>`,
      `<rect x="${x - nodeWidth / 2}" y="${y - nodeHeight / 2}" width="${nodeWidth}" height="${nodeHeight}" rx="12" fill="${color}"/>`,
      `<text class="label" x="${x - nodeWidth / 2 + 16}" y="${y + 5}">${esc(node.label)}</text>`,
      `<circle cx="${x + nodeWidth / 2 - 23}" cy="${y}" r="14" fill="#000" fill-opacity="0.18"/>`,
      `<text class="count" x="${x + nodeWidth / 2 - 23}" y="${y + 4}" text-anchor="middle">${node.count}</text>`,
      `</g>`
    );
  }

  svg.push(
    `<text class="footnote" x="40" y="530">Includes tags present on at least ${minimumCount} public-work events · Generated deterministically from events.jsonl</text>`,
    `</svg>`,
    ``
  );
  return svg.join("\n");
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

function polar(cx, cy, radius, angle) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function wedgePath(cx, cy, innerRadius, outerRadius, startAngle, endAngle) {
  const a = polar(cx, cy, outerRadius, startAngle);
  const b = polar(cx, cy, outerRadius, endAngle);
  const c = polar(cx, cy, innerRadius, endAngle);
  const d = polar(cx, cy, innerRadius, startAngle);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${outerRadius.toFixed(2)} ${outerRadius.toFixed(2)} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} L ${c.x.toFixed(2)} ${c.y.toFixed(2)} A ${innerRadius} ${innerRadius} 0 0 0 ${d.x.toFixed(2)} ${d.y.toFixed(2)} Z`;
}

function renderFindingFingerprint(patterns) {
  const width = 960;
  const height = 600;
  const cx = 480;
  const cy = 320;
  const innerRadius = 70;
  const maximumRadius = 180;
  const maximumCount = Math.max(...patterns.classes.map((entry) => entry.count));
  const angleStep = 360 / patterns.classes.length;
  const palette = ["#2563eb", "#7c3aed", "#c2410c", "#047857", "#be123c", "#0369a1"];
  const svg = [];

  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    `<title id="title">Published report finding classifications</title>`,
    `<desc id="desc">A radial fingerprint of finding classes in public reports listing John Saigle as primary auditor.</desc>`,
    `<style>`,
    `  .title { font: 700 26px ui-sans-serif,system-ui,sans-serif; fill: #0f172a }`,
    `  .subtitle { font: 14px ui-sans-serif,system-ui,sans-serif; fill: #475569 }`,
    `  .label { font: 600 12px ui-sans-serif,system-ui,sans-serif; fill: #334155 }`,
    `  .total { font: 700 28px ui-sans-serif,system-ui,sans-serif; fill: #0f172a }`,
    `  .total-label { font: 12px ui-sans-serif,system-ui,sans-serif; fill: #64748b }`,
    `  .footnote { font: 12px ui-sans-serif,system-ui,sans-serif; fill: #64748b }`,
    `</style>`,
    `<rect width="100%" height="100%" rx="16" fill="#f8fafc"/>`,
    `<text class="title" x="40" y="48">Published report finding classifications</text>`,
    `<text class="subtitle" x="40" y="75">Reports listing John Saigle as primary auditor · radial length uses a square-root count scale.</text>`
  );

  patterns.classes.forEach((entry, index) => {
    const middleAngle = index * angleStep;
    const startAngle = middleAngle - angleStep * 0.39;
    const endAngle = middleAngle + angleStep * 0.39;
    const outerRadius = innerRadius + Math.sqrt(entry.count / maximumCount) * (maximumRadius - innerRadius);
    const color = entry.id === "other" ? "#94a3b8" : palette[index % palette.length];
    const breakdown = Object.entries(entry.severities)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([severity, count]) => `${severity}: ${count}`)
      .join(", ");
    const labelPoint = polar(cx, cy, maximumRadius + 34, middleAngle);
    const anchor = labelPoint.x < cx - 10 ? "end" : labelPoint.x > cx + 10 ? "start" : "middle";
    svg.push(
      `<path d="${wedgePath(cx, cy, innerRadius, outerRadius, startAngle, endAngle)}" fill="${color}" fill-opacity="0.88">`,
      `<title>${esc(entry.label)}: ${entry.count} (${esc(breakdown)})</title>`,
      `</path>`,
      `<text class="label" x="${labelPoint.x.toFixed(2)}" y="${labelPoint.y.toFixed(2)}" text-anchor="${anchor}">${esc(entry.label)} · ${entry.count}</text>`
    );
  });

  svg.push(
    `<circle cx="${cx}" cy="${cy}" r="${innerRadius - 5}" fill="#fff" stroke="#e2e8f0"/>`,
    `<text class="total" x="${cx}" y="${cy - 3}" text-anchor="middle">${patterns.finding_count}</text>`,
    `<text class="total-label" x="${cx}" y="${cy + 18}" text-anchor="middle">findings</text>`,
    `<text class="footnote" x="40" y="570">Human-reviewed classes from data/finding-class-overrides.json · Generated from events.jsonl</text>`,
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
fs.writeFileSync(path.join(ASSETS_DIR, "capability-map.svg"), renderCapabilityMap(capabilityGraph));
fs.writeFileSync(path.join(ASSETS_DIR, "finding-fingerprint.svg"), renderFindingFingerprint(findingPatterns));

console.log(
  `Rendered visualizations: ${capabilityGraph.nodes.length} tags, ${capabilityGraph.edges.length} connections, ${findingPatterns.finding_count} findings`
);
