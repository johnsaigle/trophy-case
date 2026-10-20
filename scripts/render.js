#!/usr/bin/env node
/**
 * Render README.md from events.jsonl.
 *
 * The README is generated output — edit events.jsonl (or scripts/backfill.py for
 * the seed), never this file's output. Run: node scripts/render.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const events = fs
  .readFileSync(path.join(ROOT, "events.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map(JSON.parse);

const LANGUAGES = new Set(["go", "rust", "solidity", "typescript", "javascript", "python", "php"]);
const TAG_CASE = { evm: "EVM", zk: "ZK", defi: "DeFi", nft: "NFT", api: "API", ci: "CI" };
const tc = (s) => TAG_CASE[s] || (s.charAt(0).toUpperCase() + s.slice(1));

// ---------------------------------------------------------------- helpers

function evUrl(e) {
  const ev = (e.evidence || []).find((v) => v.kind === "url");
  return ev ? ev.url : null;
}

function countsSuffix(e) {
  const cr = e.code_review;
  if (!cr) return "";
  const parts = [];
  if (cr.prs_merged) parts.push(`${cr.prs_merged} merged PR${cr.prs_merged !== 1 ? "s" : ""}`);
  if (cr.issues) parts.push(`${cr.issues} issue${cr.issues !== 1 ? "s" : ""}`);
  if (cr.reviews_ytd) parts.push(`${cr.reviews_ytd} reviews in ${new Date().getFullYear()}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function groupFor(e) {
  const p = e.project || "";
  if (p.startsWith("wormhole-foundation/") || p.startsWith("wormholelabs-xyz/")) return "Wormhole";
  if (p.startsWith("m0-foundation/")) return "M0 Foundation";
  if (p.startsWith("stx-labs/")) return "Stacks";
  if (p.startsWith("commonwarexyz/")) return "Commonware";
  return "Other Projects";
}

// ---------------------------------------------------------------- stats line

const auditEvents = events.filter((e) => e.type === "audit");
const findings = auditEvents.flatMap((e) => (e.audit && e.audit.findings) || []);
const bySev = {};
for (const f of findings) bySev[f.severity] = (bySev[f.severity] || 0) + 1;
const sevStr = ["critical", "high", "medium", "low", "informational"]
  .filter((s) => bySev[s])
  .map((s) => `${bySev[s]} ${s}`)
  .join(", ");

const statsLine = [
  `${auditEvents.length} audits`,
  `${findings.length} published findings${sevStr ? ` (${sevStr})` : ""}`,
  `${events.filter((e) => e.type === "writing").length} articles`,
  `${events.filter((e) => e.type === "tool").length} security tools`,
].join(" · ");

// ---------------------------------------------------------------- highlights

const fmt = (n) => n.toLocaleString("en-US");
const contributions = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "contributions.json"), "utf8")).records;
const contributionById = new Map(contributions.map((r) => [r.id, r]));
const prs = contributions.filter((r) => r.kind === "pull-request");
const authoredPrs = prs.filter((r) => r.relations.includes("authored-pr"));
const reviewedPrs = prs.filter((r) => r.relations.includes("reviewed-pr"));
const inlineReviewed = reviewedPrs.filter((r) => r.review && r.review.inline_comment_count > 0);
const inlineComments = reviewedPrs.reduce((sum, r) => sum + ((r.review && r.review.inline_comment_count) || 0), 0);
const criticalAudits = auditEvents
  .filter((e) => e.audit && e.audit.counts && e.audit.counts.critical)
  .sort((a, b) => b.audit.counts.critical - a.audit.counts.critical);

const highlightConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "highlights.json"), "utf8"));
const highlightRows = highlightConfig.items.map((item) => {
  const links = item.links.map((link) => {
    const record = contributionById.get(link.id);
    if (!record) throw new Error(`highlight link ${link.id} not found in contributions`);
    return `[${link.label}](${record.url})`;
  });
  return `| ${item.area} | ${item.text} | ${links.join(", ")} |`;
});

// ---------------------------------------------------------------- sections

const lines = [];
lines.push(
  `# Overview`,
  ``,
  `This is a loose archive of security work I've done for open-source projects, including`,
  `security engineering and source code reviews.`,
  ``,
  `![${statsLine}](assets/overview-stats.svg)`,
  ``,
  `> **Note:** this is a best-effort list of *public* work only. Much of my audit`,
  `> and security engineering output is under confidentiality agreement and cannot be listed.`,
  ``,
  `## Selected work`,
  ``,
  `- **Audits:** ${auditEvents.length} published reports as primary auditor, including ${criticalAudits
    .map((e) => `${e.audit.counts.critical} critical finding${e.audit.counts.critical === 1 ? "" : "s"} in ${e.title.replace(/ (Security )?(Audit|Assessment)$/, "")}`)
    .join(" and ")}.`,
  `- **Code review:** reviewed ${fmt(reviewedPrs.length)} public pull requests, leaving ${fmt(inlineComments)} inline comments across ${fmt(inlineReviewed.length)} of them.`,
  `- **Authored:** ${fmt(authoredPrs.length)} public pull requests, ${fmt(authoredPrs.filter((r) => r.merged_at).length)} merged.`,
  ``,
  `| Area | Work | PRs |`,
  `| --- | --- | --- |`,
  ...highlightRows,
  ``,
  `## Public work over time`,
  ``,
  `![Public work over time](assets/career-timeline.svg)`,
  ``,
  `## Security engineering in public repositories`,
  ``,
  `![Security engineering in public repositories](assets/security-engineering.svg)`,
  ``,
  `## Findings in published audit reports`,
  ``,
  `![Published report finding classifications](assets/finding-fingerprint.svg)`,
  ``,
  `Machine-readable exports: [summary](dist/summary.json) · [events](dist/events.json) · [capability graph](dist/capability-graph.json) · [finding patterns](dist/finding-patterns.json)`,
  ``,
  `<!-- GENERATED from events.jsonl by scripts/render.js — do not edit sections below by hand. -->`,
  ``,
  `# Code Review and Security Engineering`,
  ``
);

// --- code review / review / bug-report, grouped by org then project family
const contributionEvents = events.filter((e) =>
  ["code-review", "review", "bug-report"].includes(e.type)
);
const byOrg = {};
for (const e of contributionEvents) {
  const org = e.org || "Independent";
  (byOrg[org] = byOrg[org] || []).push(e);
}

for (const org of ["Asymmetric Research", "McGill University", "Independent"]) {
  const evs = byOrg[org];
  if (!evs) continue;

  if (org === "McGill University") {
    const e = evs[0];
    const hint = e.date_hint ? ` (${e.date_hint})` : "";
    lines.push(`## ${org}${hint}`, ``);
    lines.push(
      `- [${e.title}](${evUrl(e)})${countsSuffix(e)}`,
      ``
    );
    continue;
  }

  if (org === "Independent") {
    lines.push(`## Independent Projects`, ``);
    for (const e of evs) {
      const url = evUrl(e);
      lines.push(`- ${url ? `[${e.title}](${url})` : e.title}${countsSuffix(e)}`);
      if (e.summary) lines.push(`  ${e.summary}`);
    }
    lines.push(``);
    continue;
  }

  lines.push(`## As part of ${org}`, ``);
  const groups = {};
  for (const e of evs) (groups[groupFor(e)] = groups[groupFor(e)] || []).push(e);

  for (const g of ["Wormhole", "M0 Foundation", "Stacks", "Commonware", "Other Projects"]) {
    if (!groups[g]) continue;
    lines.push(`### ${g}`, ``);
    if (g === "M0 Foundation") {
      lines.push(`_(Pull requests labelled "AR" --> Asymmetric Research)_`, ``);
    }
    for (const e of groups[g]) {
      const url = evUrl(e);
      const name = url ? `[${e.title}](${url})` : e.title;
      const prefix = e.type === "bug-report" ? "" : "";
      lines.push(`- ${prefix}${name}${countsSuffix(e)}`);
      if (e.type === "review" && e.summary) lines.push(`  ${e.summary}`);
    }
    lines.push(``);
  }
}

// --- audit table
lines.push(`# Audit Reports`, ``, `Formal audit reports for which I was the primary auditor.`, ``);
lines.push(`| Date | Title | Client | Type | Language | C / H / M / L / I | Report |`);
lines.push(`| --- | --- | --- | --- | --- | --- | --- |`);
const auditsByDate = [...auditEvents].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
for (const e of auditsByDate) {
  const tags = e.tags || [];
  const langs = tags.filter((t) => LANGUAGES.has(t)).map(tc);
  const types = tags.filter((t) => !LANGUAGES.has(t)).map(tc);
  const url = evUrl(e);
  const link = url ? `[Report](${url})` : "";
  const counts = (e.audit && e.audit.counts) || {};
  const sev = !e.audit || !e.audit.counts ? "n/a" : ["critical", "high", "medium", "low", "informational"].map((s) => counts[s] || 0).join(" / ");
  lines.push(
    `| ${e.date || ""} | ${e.title} | ${e.client} | ${types.join(", ")} | ${langs.join(", ")} | ${sev} | ${link} |`
  );
}
lines.push(``);

// --- writing
lines.push(`# Technical Writing`, ``, `Personal website: https://johnsaigle.com`, ``);
const writing = events.filter((e) => e.type === "writing");
const writingByOrg = {};
for (const e of writing) (writingByOrg[e.org || "Other"] = writingByOrg[e.org || "Other"] || []).push(e);
for (const org of ["Asymmetric Research", "Halborn", "Other"]) {
  if (!writingByOrg[org]) continue;
  lines.push(`## ${org}`, ``);
  for (const e of writingByOrg[org]) {
    const url = evUrl(e);
    lines.push(`- ${url ? `[${e.title}](${url})` : e.title}`);
  }
  lines.push(``);
}

// --- tools
lines.push(`# Tools`, ``);
for (const e of events.filter((e) => e.type === "tool")) {
  const url = evUrl(e);
  const [name, ...rest] = e.title.split(" — ");
  const desc = rest.join(" — ");
  const nameLinked = url ? `[${name}](${url})` : name;
  lines.push(`- ${nameLinked}${desc ? ` -- ${desc}` : ""}`);
}
lines.push(``);

fs.writeFileSync(path.join(ROOT, "README.md"), lines.join("\n"));
console.log(`Rendered README.md: ${events.length} events, ${findings.length} findings`);
