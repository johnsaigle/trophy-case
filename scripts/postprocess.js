#!/usr/bin/env node
/**
 * Local post-processing: classify pending candidates from proposals/candidates-*.json
 * using any OpenAI-compatible LLM endpoint, and append accepted events
 * to events.jsonl.
 *
 * Usage:
 *   node scripts/postprocess.js                 # process all pending candidates
 *   node scripts/postprocess.js --dry-run       # classify, print, don't write
 *
 * Env/config (any OpenAI-compatible endpoint):
 *   LLM_URL    (default http://127.0.0.1:8081/v1/chat/completions)
 *   LLM_MODEL  (default: auto-detect from LLM_URL /v1/models)
 *
 * After running: review the events.jsonl diff, then commit. The README renderer
 * picks the new events up on push.
 *
 * Alternatively, skip this script entirely and let an agent classify the
 * pending candidates — see skills/trophy-case/SKILL.md.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EVENTS = path.join(ROOT, "events.jsonl");
const PROPOSALS = path.join(ROOT, "proposals");
const PROCESSED = path.join(ROOT, "proposals", "processed-urls.json");
const DRY_RUN = process.argv.includes("--dry-run");

const LLM_URL = process.env.LLM_URL || "http://127.0.0.1:8081/v1/chat/completions";
let LLM_MODEL = process.env.LLM_MODEL || null;

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function extractJsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("no JSON array in LLM response");
  return JSON.parse(raw.slice(start, end + 1));
}

async function detectModel() {
  if (LLM_MODEL) return LLM_MODEL;
  const base = LLM_URL.replace(/\/chat\/completions$/, "");
  const res = await fetch(`${base}/models`);
  if (!res.ok) throw new Error(`model auto-detect failed: ${res.status}`);
  const data = await res.json();
  const id = data.data && data.data[0] && data.data[0].id;
  if (!id) throw new Error("no models listed at LLM_URL; set LLM_MODEL explicitly");
  console.log(`Auto-detected model: ${id}`);
  return id;
}

async function classify(candidates) {
  const payload = candidates.map((c, i) => ({
    index: i,
    repo: c.slug,
    is_pr: c.is_pr,
    title: c.title,
    body: c.body,
  }));
  const prompt = `You are curating a security engineer's public portfolio. Below are GitHub PRs and issues.
For each, judge:
- security_relevant: does it relate to security engineering, vulnerability fixes, security review, or hardening? (pure CI/docs/refactor = false)
- type: "code-review" (security engineering contribution) or "bug-report" (reported a bug/vulnerability)
- notability: 1-5 (5 = career highlight, 3 = worth listing, 1 = filler)
- summary: one factual sentence, no hype, describing the contribution
- tags: 1-4 lowercase tags (language, ecosystem, domain e.g. "rust", "cosmos", "access-control")

Input:
${JSON.stringify(payload, null, 2)}

Respond with ONLY a JSON array: [{"index": 0, "security_relevant": true, "type": "code-review", "notability": 3, "summary": "...", "tags": ["..."]}]`;

  const res = await fetch(LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data.choices[0].message.content;
  return extractJsonArray(content);
}

function keywordGuess(c) {
  const t = `${c.title} ${c.body}`.toLowerCase();
  const bugWords = /(vulnerab|overflow|inject|cve|exploit|race condition|panic|dos|denial.of.service|auth bypass|sanitize)/;
  return {
    index: null,
    security_relevant: bugWords.test(t),
    type: bugWords.test(t) ? "bug-report" : "code-review",
    notability: 3,
    summary: null,
    tags: [],
  };
}

(async () => {
  const events = fs.readFileSync(EVENTS, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const knownUrls = new Set(events.flatMap((e) => (e.evidence || []).map((v) => v.url).filter(Boolean)));
  const processed = new Set(loadJson(PROCESSED, []));

  // Gather pending candidates across all collector runs.
  const pending = [];
  const seenUrls = new Set();
  for (const f of fs.readdirSync(PROPOSALS).filter((f) => f.startsWith("candidates-") && f.endsWith(".json"))) {
    const data = loadJson(path.join(PROPOSALS, f), { candidates: [] });
    for (const c of data.candidates || []) {
      if (knownUrls.has(c.url) || processed.has(c.url) || seenUrls.has(c.url)) continue;
      seenUrls.add(c.url);
      pending.push(c);
    }
  }

  if (pending.length === 0) {
    console.log("No pending candidates. Nothing to do.");
    return;
  }
  console.log(`Classifying ${pending.length} pending candidates via ${LLM_MODEL || "auto-detected model"} at ${LLM_URL}...`);

  let classifications;
  try {
    LLM_MODEL = await detectModel();
    classifications = await classify(pending);
  } catch (err) {
    console.error(`ERROR: LLM classification failed: ${err.message}`);
    console.error("Check LLM_URL / LLM_MODEL, or classify manually (see skills/trophy-case/SKILL.md).");
    process.exit(1);
  }

  const accepted = [];
  pending.forEach((c, i) => {
    const k = classifications.find((x) => x.index === i) || keywordGuess(c);
    if (!k.security_relevant) return;
    accepted.push({
      id: `proposal-${c.slug.replace("/", "-")}-${c.number}`,
      type: k.type,
      date: c.created_at.slice(0, 10),
      title: c.title,
      org: null,
      project: c.slug,
      role: k.type === "bug-report" ? "reporter" : "reviewer",
      summary: k.summary,
      evidence: [{ kind: "url", url: c.url }],
      tags: k.tags || [],
      severity: null,
      notability: k.notability || 3,
      provenance: { source: "local-llm", extracted_at: new Date().toISOString().slice(0, 10) },
      reviewed: true,
    });
  });

  if (DRY_RUN) {
    console.log(`DRY RUN: would accept ${accepted.length} of ${pending.length} candidates:`);
    console.log(JSON.stringify(accepted, null, 2));
    return;
  }

  // Append accepted events + record every seen URL as processed.
  const existingIds = new Set(events.map((e) => e.id));
  const fresh = accepted.filter((e) => !existingIds.has(e.id));
  fs.writeFileSync(EVENTS, [...events, ...fresh].map((e) => JSON.stringify(e)).join("\n") + "\n");
  fs.writeFileSync(PROCESSED, JSON.stringify([...processed, ...seenUrls], null, 2));

  console.log(`Accepted ${fresh.length} events (${pending.length - accepted.length} rejected as not security-relevant).`);
  console.log("Review the events.jsonl diff, then commit. README re-renders on push.");
})();
