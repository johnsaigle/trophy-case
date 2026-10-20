/**
 * Shared SVG theme for generated visualizations. Colors are CSS variables with
 * a prefers-color-scheme override, so images embedded in a README follow the
 * viewer's light/dark setting.
 */
const FONT = "ui-sans-serif,system-ui,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,monospace";

const SEVERITIES = ["critical", "high", "medium", "low", "informational"];
const SEVERITY_COLORS = {
  critical: "#b91c1c",
  high: "#f97316",
  medium: "#eab308",
  low: "#38bdf8",
  informational: "#94a3b8",
};

const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const THEME = {
  light: { washA: "#f8fafc", washB: "#eef2ff", bg: "#f8fafc", card: "#fff", fg: "#0f172a", muted: "#475569", faint: "#64748b", line: "#e2e8f0" },
  dark: { washA: "#0d1117", washB: "#101a30", bg: "#0d1117", card: "#161b22", fg: "#e6edf3", muted: "#9da7b3", faint: "#8b949e", line: "#30363d" },
};

// Plain class rules (no CSS variables) so rsvg and other non-browser renderers
// work; extra rules written with var(--fg|--muted|--faint|--line) are expanded
// per theme.
const themeCss = (extra = []) => {
  const expand = (line, t) => line.replace(/var\(--(\w+)\)/g, (_, key) => t[key]);
  const core = (t) => [
    `.wash-a { stop-color: ${t.washA} } .wash-b { stop-color: ${t.washB} }`,
    `.bg { fill: ${t.bg} } .card { fill: ${t.card}; stroke: ${t.line} }`,
    `.title { fill: ${t.fg} } .subtitle { fill: ${t.muted} } .heading { fill: ${t.muted} } .footnote { fill: ${t.faint} }`,
  ];
  const themed = extra.filter((line) => line.includes("var("));
  return [
    `<style>`,
    `  .title { font: 700 26px ${FONT} } .subtitle { font: 14px ${FONT} }`,
    `  .heading { font: 700 14px ${FONT}; letter-spacing: .04em; text-transform: uppercase } .footnote { font: 12px ${FONT} }`,
    ...core(THEME.light).map((line) => `  ${line}`),
    ...extra.map((line) => `  ${expand(line, THEME.light)}`),
    `  @media (prefers-color-scheme: dark) {`,
    ...core(THEME.dark).map((line) => `    ${line}`),
    ...themed.map((line) => `    ${expand(line, THEME.dark)}`),
    `  }`,
    `</style>`,
  ].join("\n");
};

const GRADIENTS = {
  authored: ["#3b82f6", "#2563eb"],
  reviewed: ["#2dd4bf", "#14b8a6"],
  issues: ["#fbbf24", "#f59e0b"],
};

// Background wash, accent bar, and shared bar gradients. Stops use classes so
// the dark theme can recolor the wash.
function background({ accentBar = true } = {}) {
  const grad = ([top, bottom], id) =>
    `<linearGradient id="g-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
  return [
    `<defs>`,
    `<linearGradient id="bgfade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="wash-a"/><stop offset="1" class="wash-b"/></linearGradient>`,
    `<linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2563eb"/><stop offset="0.5" stop-color="#14b8a6"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>`,
    ...Object.entries(GRADIENTS).map(([id, colors]) => grad(colors, id)),
    `</defs>`,
    `<rect width="100%" height="100%" rx="16" fill="url(#bgfade)"/>`,
    accentBar ? `<rect x="40" y="16" width="64" height="4" rx="2" fill="url(#accent)"/>` : "",
  ].filter(Boolean).join("\n");
}

// Rect with only the top corners rounded.
const roundedTop = (x, y, w, h, r) => {
  const k = Math.min(r, w / 2, h);
  return `M ${x.toFixed(2)} ${(y + h).toFixed(2)} L ${x.toFixed(2)} ${(y + k).toFixed(2)} Q ${x.toFixed(2)} ${y.toFixed(2)} ${(x + k).toFixed(2)} ${y.toFixed(2)} L ${(x + w - k).toFixed(2)} ${y.toFixed(2)} Q ${(x + w).toFixed(2)} ${y.toFixed(2)} ${(x + w).toFixed(2)} ${(y + k).toFixed(2)} L ${(x + w).toFixed(2)} ${(y + h).toFixed(2)} Z`;
};

function svgOpen(width, height, title, desc) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    `<title id="title">${esc(title)}</title>`,
    `<desc id="desc">${esc(desc)}</desc>`,
  ].join("\n");
}

module.exports = { background, roundedTop, FONT, MONO, SEVERITIES, SEVERITY_COLORS, esc, themeCss, svgOpen };
