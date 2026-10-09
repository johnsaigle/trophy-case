#!/usr/bin/env node
/**
 * Weekly collector: fetch new merged PRs/issues across watched repos,
 * classify via GitHub Models, refresh live counts, and propose new events.
 *
 * Usage: node scripts/collect.js [--dry-run]
 * Env: GH_TOKEN (or GITHUB_TOKEN). Uses `gh` CLI for GitHub API calls.
 *
 * Outputs:
 *  - events.jsonl        existing events (counts refreshed in place) + proposed events appended
 *  - proposals/candidates-<date>.json  raw candidates (for local LLM processing if Models fails)
 *  - .github/collect-state.json       last-run checkpoint
 *
 * Proposed events carry reviewed:false; a human approves by merging the PR.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "collectors.json"), "utf8"));
const EVENTS = path.join(ROOT, "events.jsonl");
const STATE = path.join(ROOT, ".github", "collect-state.json");
const PROPOSALS_DIR = path.join(ROOT, "proposals");
const DRY_RUN = process.argv.includes("--dry-run");

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const graphqlToken = () => process.env.PAT_READ_ONLY || TOKEN;

function gh(endpoint, token, ...flags) {
  return JSON.parse(
    execFileSync("gh", ["api", endpoint, ...flags], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GH_TOKEN: token || TOKEN },
    })
  );
}

function ghAllPages(endpoint) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = endpoint.includes("?") ? "&" : "?";
    const items = gh(`${endpoint}${sep}page=${page}`);
    out.push(...items);
    if (!Array.isArray(items) || items.length < 100) return out;
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}

function loadEvents() {
  return fs.readFileSync(EVENTS, "utf8").split("\n").filter(Boolean).map(JSON.parse);
}

function saveEvents(events) {
  fs.writeFileSync(EVENTS, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

// ---------------------------------------------------------------- fetching

async function collect() {
  const state = loadState();
  const since =
    state.last_run || new Date(Date.now() - CONFIG.lookback_days * 86400e3).toISOString().slice(0, 10);
  const sinceDate = new Date(since);
  console.log(`Collecting since ${since}`);

  const events = loadEvents();
  const knownUrls = new Set(
    events.flatMap((e) => (e.evidence || []).map((v) => v.url).filter(Boolean))
  );

  const candidates = [];
  const counts = {}; // slug -> { prs_merged, issues }

  // Counts + candidates via GraphQL search: the REST search backend has proven
  // unreliable from Actions runners (deterministically wrong totals).
  const authorModeRepos = CONFIG.repos.filter((r) => r.query_mode !== "mentions-ar");
  if (authorModeRepos.length > 0) {
    const aliases = [];
    const def = (name, q) => {
      aliases.push(
        `${name}: search(query: ${JSON.stringify(q)}, type: ISSUE, first: 30) { issueCount nodes { ... on Issue { number title url createdAt body } ... on PullRequest { number title url closedAt body } } }`
      );
    };
    authorModeRepos.forEach(({ slug }, i) => {
      def(`pr${i}`, `repo:${slug} is:pr is:merged author:${CONFIG.author}`);
      def(`is${i}`, `repo:${slug} is:issue author:${CONFIG.author}`);
    });
    const query = `query {\n  ${aliases.join("\n  ")}\n}`;
    const res = gh("graphql", graphqlToken(), "-f", `query=${query}`);
    if (res.errors) throw new Error(`GraphQL search errors: ${JSON.stringify(res.errors)}`);
    const d = res.data;

    authorModeRepos.forEach(({ slug }, i) => {
      try {
        const prs = d[`pr${i}`];
        const iss = d[`is${i}`];
        counts[slug] = { prs_merged: prs.issueCount, issues: iss.issueCount };
        const prItems = prs.nodes.map((n) => ({ ...n, is_pr: true, date: n.closedAt }));
        const isItems = iss.nodes.map((n) => ({ ...n, is_pr: false, date: n.createdAt }));
        for (const item of [...prItems, ...isItems]) {
          if (new Date(item.date) < sinceDate) continue;
          if (knownUrls.has(item.url)) continue;
          candidates.push({ slug, url: item.url, number: item.number, title: item.title,
            is_pr: item.is_pr, body: (item.body || "").slice(0, 600), created_at: item.date });
        }
        console.log(`${slug}: ${prs.issueCount} merged PRs, ${iss.issueCount} issues (lifetime)`);
      } catch (err) {
        console.error(`WARN: ${slug} failed: ${err.message}`);
      }
    });
  }

  // Repos with issues disabled (e.g. m0-foundation): search APIs refuse them.
  // List closed PRs and filter for "AR" (Asymmetric Research) client-side.
  for (const { slug } of CONFIG.repos.filter((r) => r.query_mode === "mentions-ar")) {
    try {
      const pulls = ghAllPages(`repos/${slug}/pulls?state=closed&per_page=100`);
      const merged = pulls.filter(
        (p) => p.merged_at && `${p.title} ${p.body || ""}`.includes("AR")
      );
      counts[slug] = { prs_merged: merged.length, issues: 0 };
      for (const p of merged) {
        if (new Date(p.merged_at) < sinceDate) continue;
        if (knownUrls.has(p.html_url)) continue;
        candidates.push({ slug, url: p.html_url, number: p.number, title: p.title,
          is_pr: true, body: (p.body || "").slice(0, 600), created_at: p.merged_at });
      }
      console.log(`${slug}: ${merged.length} merged PRs, 0 issues (lifetime, AR filter)`);
    } catch (err) {
      console.error(`WARN: ${slug} failed: ${err.message}`);
    }
  }

  // Refresh review counts via GraphQL contributions (YTD).
  // contributionsCollection needs a user token; the Actions bot token can't read it,
  // so prefer PAT_READ_ONLY when available.
  const yearStart = `${new Date().getFullYear()}-01-01T00:00:00Z`;
  const now = new Date().toISOString();
  let reviewCounts = {};
  if (process.env.PAT_READ_ONLY) {
    try {
      const q = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      pullRequestReviewContributionsByRepository {
        repository { nameWithOwner }
        contributions { totalCount }
      }
    }
  }
}`;
      const res = gh(
        "graphql",
        process.env.PAT_READ_ONLY,
        "-f", `query=${q}`,
        "-f", `login=${CONFIG.author}`,
        "-f", `from=${yearStart}`,
        "-f", `to=${now}`
      );
      if (res.errors) {
        throw new Error(JSON.stringify(res.errors));
      }
      if (!res.data || !res.data.user) {
        throw new Error("GraphQL returned no user data");
      }
      for (const r of res.data.user.contributionsCollection.pullRequestReviewContributionsByRepository) {
        reviewCounts[r.repository.nameWithOwner] = r.contributions.totalCount;
      }
      console.log(`Review counts refreshed: ${JSON.stringify(reviewCounts)}`);
    } catch (err) {
      console.error(`WARN: review count refresh failed: ${err.message}`);
    }
  } else {
    console.log("PAT_READ_ONLY not set; skipping review count refresh");
  }

  return { events, candidates, counts, reviewCounts, since };
}

// ---------------------------------------------------------------- LLM classification

async function classify(candidates) {
  if (candidates.length === 0) return [];
  if (!TOKEN) throw new Error("no token");

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

  const res = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CONFIG.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 2000,
    }),
  });
  if (!res.ok) throw new Error(`GitHub Models ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data.choices[0].message.content;
  const parsed = JSON.parse(content);
  const arr = Array.isArray(parsed) ? parsed : parsed.items || parsed.results || [];
  return candidates.map((c, i) => arr.find((x) => x.index === i) || null);
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

// ---------------------------------------------------------------- main

(async () => {
  const { events, candidates, counts, reviewCounts, since } = await collect();

  // 1. Refresh live counts on existing events (documented exception to append-only:
  //    numeric counters are live stats, not history).
  let countUpdates = 0;
  for (const e of events) {
    const repo = CONFIG.repos.find((r) => r.event_id === e.id);
    if (repo && e.code_review) {
      const c = counts[repo.slug];
      if (c) {
        e.code_review.prs_merged = c.prs_merged;
        e.code_review.issues = c.issues;
        countUpdates++;
      }
    }
    if (e.project && reviewCounts[e.project] && e.code_review) {
      e.code_review.reviews_ytd = reviewCounts[e.project];
    }
  }

  // 2. Classify new candidates.
  let classifications;
  try {
    classifications = await classify(candidates);
    console.log(`Classified ${classifications.length} candidates via GitHub Models`);
  } catch (err) {
    console.error(`WARN: LLM classification failed (${err.message}); falling back to keywords`);
    classifications = candidates.map(keywordGuess);
  }

  // 3. Build proposed events.
  const proposals = [];
  candidates.forEach((c, i) => {
    const k = classifications[i] || keywordGuess(c);
    if (!k.security_relevant) return;
    proposals.push({
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
      provenance: { source: "github-collector", extracted_at: new Date().toISOString().slice(0, 10) },
      reviewed: false,
    });
  });

  // 4. Persist.
  fs.mkdirSync(PROPOSALS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(PROPOSALS_DIR, `candidates-${new Date().toISOString().slice(0, 10)}.json`),
    JSON.stringify({ since, candidates, proposals }, null, 2)
  );

  if (!DRY_RUN) {
    const existing = new Set(events.map((e) => e.id));
    const fresh = proposals.filter((p) => !existing.has(p.id));
    saveEvents([...events, ...fresh]);
    fs.writeFileSync(STATE, JSON.stringify({ last_run: new Date().toISOString() }, null, 2));
    console.log(`Count updates: ${countUpdates}; proposed ${fresh.length} new events (reviewed:false)`);
  } else {
    console.log(`DRY RUN: would update ${countUpdates} counts, propose ${proposals.length} events`);
    console.log(JSON.stringify(proposals, null, 2));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
