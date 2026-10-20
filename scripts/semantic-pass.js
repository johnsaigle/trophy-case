#!/usr/bin/env node
/**
 * Semantic pass over checkpointed contribution records (plan rollout step 7).
 *
 * The deterministic pipeline records facts; this optional pass asks a local
 * LLM (any OpenAI-compatible endpoint) to judge what those facts mean.
 * Three subcommands, deliberately separate:
 *
 *   node scripts/semantic-pass.js prepare            # offline; packets to .cache/
 *   node scripts/semantic-pass.js classify [--sample N] [--dry-run]
 *   node scripts/semantic-pass.js apply --id <record-id>...   # approved only
 *
 * Safety rails:
 * - Packets and results live under .cache/ and data/ respectively and are NOT
 *   auto-applied. apply() only includes records whose entries carry
 *   approved: true (human sign-off, mirroring skills/trophy-case/SKILL.md).
 * - Applied assertions use category "vulnerability-class" or "domain" with
 *   evidence_level "semantic-assessment" (weakest tier, below
 *   repository-context rank-wise: see data/github-enrichment-overrides.json
 *   for deliberate corrections with reasons).
 * - No review bodies or third-party text are stored in checked-in output.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REPOS_CONFIG = path.join(ROOT, "data", "github-enrichment-repos.json");
const CONTRIBUTIONS_PATH = path.join(ROOT, "contributions.jsonl");
const OVERPATH = path.join(ROOT, "data", "github-enrichment-overrides.json");
const SEMANTIC_DIR = path.join(ROOT, ".cache", "github-enrichment", "semantic");
const RESULTS_PATH = path.join(ROOT, "data", "github-enrichment-semantic.json");

const LLM_URL = process.env.LLM_URL || "http://127.0.0.1:8081/v1/chat/completions";
let LLM_MODEL = process.env.LLM_MODEL || null;

const args = process.argv.slice(2);
const sub = args[0];

function loadContributions() {
  return fs
    .readFileSync(CONTRIBUTIONS_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
}

// ---------------------------------------------------------------- prepare

function buildPacket(raw, record, author) {
  const reviews =
    (raw.reviews || [])
      .filter((r) => r.user && r.user.login === author && r.body)
      .map((r) => ({ state: r.state, body: r.body.slice(0, 800) }));
  const comments =
    (raw.comments || [])
      .filter((c) => c.user && c.user.login === author && c.body)
      .map((c) => ({ path: c.path, body: c.body.slice(0, 500) }));
  return {
    id: record.id,
    project: record.project,
    title: record.title,
    files: record.files ? record.files.paths : [],
    owner_review_bodies: reviews,
    owner_comment_bodies: comments,
  };
}

function prepare() {
  const author = JSON.parse(fs.readFileSync(REPOS_CONFIG, "utf8")).author;
  fs.mkdirSync(SEMANTIC_DIR, { recursive: true });
  const rawDir = path.join(ROOT, ".cache", "github-enrichment", "raw");
  if (!fs.existsSync(rawDir)) throw new Error("raw cache missing; run scripts/github-hydrate.js first");
  const records = new Map(loadContributions().map((r) => [r.id, r]));
  const rawFiles = fs.readdirSync(rawDir).sort();
  let built = 0;
  let skippedNoWords = 0;
  for (const f of rawFiles) {
    const raw = JSON.parse(fs.readFileSync(path.join(rawDir, f), "utf8"));
    const record = records.get(f.replace(/\.json$/, ""));
    if (!record) continue;
    const packet = buildPacket(raw, record, author);
    const hasWords =
      packet.owner_review_bodies.length + packet.owner_comment_bodies.length > 0;
    if (!hasWords) {
      skippedNoWords++;
      continue;
    }
    fs.writeFileSync(path.join(SEMANTIC_DIR, `${packet.id}.json`), JSON.stringify(packet, null, 1) + "\n");
    built++;
  }
  console.log(
    `Prepared ${built} semantic packets (${skippedNoWords} records without owner-authored words skipped).`
  );
}

// ---------------------------------------------------------------- classify

async function detectModel() {
  if (LLM_MODEL) return LLM_MODEL;
  const base = LLM_URL.replace(/\/chat\/completions$/, "");
  const res = await fetch(`${base}/models`);
  if (!res.ok) throw new Error(`model auto-detect failed: ${res.status}`);
  const data = await res.json();
  const id = data.data && data.data[0] && data.data[0].id;
  if (id) console.log(`Auto-detected model: ${id}`);
  return id || null;
}

const VULN_CLASSES = [
  "accounting", "access-control", "arithmetic", "dos", "crypto", "supply-chain",
  "determinism", "error-handling", "validation", "config", "testing",
  "documentation", "other",
];

async function classifyBatch(packets, model) {
  const payload = packets.map((p, i) => ({ index: i, ...p }));
  const prompt = `You are auditing a security engineer's GitHub review and PR activity. Below are packets containing PR titles, changed file paths, and bodies the engineer personally wrote (reviews and inline comments).

For each packet, judge ONLY what the engineer's own words and the changed files support:
- security_relevant: does the work relate to security engineering, vulnerability identification/fix review, or hardening? (CI/docs/refactors = false)
- work_orientation: "protocol-security" (blockchain/consensus/bridge/token protocols), "appsec" (traditional application security), or "other"
- vuln_classes: 0-3 vulnerability types discussed in the engineer's own words, from this vocabulary only: ${VULN_CLASSES.join(", ")}
- notable: true only if a reviewer or peer would call this a substantive security contribution (1 = filler)
- basis: one short factual sentence quoting nothing, first person plural not allowed; reference only observable facts.

Input:
${JSON.stringify(payload, null, 2)}

Respond with ONLY a JSON array: [{"index": 0, "security_relevant": true, "work_orientation": "protocol-security", "vuln_classes": ["validation"], "notable": false, "basis": "..."}]`;

  const res = await fetch(LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4000,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data.choices[0].message.content;
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const rawJson = fenced ? fenced[1] : content;
  const start = rawJson.indexOf("[");
  const end = rawJson.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("no JSON array in LLM response");
  return JSON.parse(rawJson.slice(start, end));
}

async function classify() {
  const packetFiles = fs.readdirSync(SEMANTIC_DIR).filter((f) => f.endsWith(".json")).sort();
  const BATCH = 10;
  const sampleIdx = args.includes("--sample")
    ? parseInt(args[args.indexOf("--sample") + 1], 10) || 8
    : packetFiles.length;
  const selected = packetFiles.slice(0, sampleIdx);
  const results = loadResults();
  let classified = 0;
  for (let i = 0; i < selected.length; i += BATCH) {
    const batch = selected.slice(i, i + BATCH).map((f) => JSON.parse(fs.readFileSync(path.join(SEMANTIC_DIR, f), "utf8")));
    const judged = await classifyBatch(batch, await detectModel());
    for (const j of judged) {
      const packet = batch[j.index];
      if (!packet) continue;
      results[packet.id] = {
        security_relevant: Boolean(j.security_relevant),
        work_orientation: j.work_orientation || "other",
        vuln_classes: (j.vuln_classes || []).filter((c) => VULN_CLASSES.includes(c)),
        notable: Boolean(j.notable),
        basis: typeof j.basis === "string" ? j.basis.slice(0, 300) : "",
        judged_by: LLM_MODEL,
        approved: false, // human flips this after reviewing
      };
      classified++;
    }
  }
  if (!args.includes("--dry-run")) {
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 1) + "\n");
  }
  console.log(
    `Classified ${classified} packets${args.includes("--dry-run") ? " (dry run; nothing written)" : " -> data/github-enrichment-semantic.json (all approved:false; review before applying)"}.`
  );
}

function loadResults() {
  try {
    return JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- apply

/** Merge approved semantic judgments as override assertions (never auto). */
function apply() {
  const ids = args.slice(args.indexOf("--id") + 1).filter((a) => !a.startsWith("--"));
  if (ids.length === 0) {
    console.error("Pass --id <record-id> for each record to apply.");
    process.exit(1);
  }
  const results = loadResults();
  for (const id of ids) {
    const r = results[id];
    if (!r) {
      console.error(`No semantic result for ${id}`);
      continue;
    }
    if (!r.approved) {
      console.error(`Skipping ${id}: approved is false. Review and set approved:true first.`);
      continue;
    }
    console.log(`Applying ${id} -> append to data/github-enrichment-overrides.json manually:`);
    console.log(
      JSON.stringify(
        {
          [id]: {
            add_assertions: [
              ...r.vuln_classes.map((c) => ({
                tag: c,
                category: "domain",
                evidence_level: "repository-context",
                evidence: [`semantic:${r.judged_by}`, "human-approved"],
              })),
              ...([r.work_orientation]
                .filter((o) => ["protocol-security", "appsec"].includes(o))
                .map((o) => ({
                  tag: o,
                  category: "practice",
                  evidence_level: "repository-context",
                  evidence: [`semantic:${r.judged_by}`, "human-approved"],
                }))),
            ],
            remove_assertions: [],
            reason: r.basis,
          },
        },
        null,
        1
      )
    );
  }
}

(async () => {
  if (sub === "prepare") return prepare();
  if (sub === "classify") {
    LLM_MODEL = await detectModel();
    return classify();
  }
  if (sub === "apply") return apply();
  console.error("Usage: node scripts/semantic-pass.js prepare | classify [--sample N] [--dry-run] | apply --id ...");
  process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
