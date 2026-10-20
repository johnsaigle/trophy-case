/**
 * Deterministic classification for GitHub contribution records.
 *
 * Pure functions only — no network, no timestamps, no randomness. Given the
 * same hydrated facts, rules, and overrides, every function returns the same
 * output byte-for-byte. This is the only place assertion logic lives.
 *
 * Evidence levels (strongest first):
 *   direct-contribution  files changed by an authored PR
 *   direct-review        files with the owner's inline review comments
 *   reviewed-pr-scope    other files changed by a reviewed PR
 *   repository-context   repo defaults / labels, when no item evidence exists
 */
const crypto = require("crypto");

const LEVEL_RANK = {
  "direct-contribution": 4,
  "direct-review": 3,
  "reviewed-pr-scope": 2,
  "repository-context": 1,
};

const COLLECTOR_VERSION = 1;

// ---------------------------------------------------------------- helpers

function sha256(text) {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

/** Stable JSON stringification: recursively sorted keys, fixed separators. */
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function stableId(kind, project, number) {
  const slug = project.replace("/", "-");
  const noun = kind === "pull-request" ? "pr" : "issue";
  return `github-${noun}-${slug}-${number}`;
}

// ---------------------------------------------------------------- flagging

/** Return the flag category for a path, or null. First matching rule wins. */
function flagForPath(filePath, rules) {
  const flagged = rules.flagged_paths || {};
  const lower = filePath.toLowerCase();
  const base = lower.split("/").pop();
  for (const category of Object.keys(flagged)) {
    const rule = flagged[category];
    if ((rule.names || []).some((n) => base === n.toLowerCase())) return category;
    if ((rule.name_prefixes || []).some((p) => base.startsWith(p.toLowerCase()))) return category;
    if ((rule.suffixes || []).some((s) => lower.endsWith(s.toLowerCase()))) return category;
    if ((rule.segments || []).some((s) => `/${filePath}/`.includes(s))) return category;
  }
  return null;
}

/** Language for a path, or null. Extension table first, then special filenames. */
function languageForPath(filePath, rules) {
  const table = rules.languages || { extensions: {}, filenames: {} };
  const base = filePath.split("/").pop();
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const ext = base.slice(dot).toLowerCase();
    if (table.extensions[ext]) return table.extensions[ext];
  }
  return table.filenames[base.toLowerCase()] || null;
}

/** Ecosystem tags for a path from the repo's path rules. Returns [{tag, prefix}]. */
function ecosystemsForPath(project, filePath, rules) {
  const repoRules = (rules.repos || {})[project];
  if (!repoRules || !repoRules.paths) return [];
  const lower = `${filePath.toLowerCase()}/`;
  const matches = [];
  for (const [prefix, tagsForPrefix] of Object.entries(repoRules.paths)) {
    if (lower.startsWith(prefix.toLowerCase())) {
      for (const tag of tagsForPrefix) matches.push({ tag, prefix });
    }
  }
  return matches.sort((a, b) => a.tag.localeCompare(b.tag) || a.prefix.localeCompare(b.prefix));
}

function repoDefaults(project, rules) {
  const repoRules = (rules.repos || {})[project];
  return [...(repoRules && repoRules.defaults ? repoRules.defaults : [])];
}

// ---------------------------------------------------------------- fingerprint

/**
 * Fingerprint over the hydrated source fields that affect a record. Identical
 * fingerprints mean the normalized record would be unchanged; classification
 * and downstream rendering can be skipped.
 */
function computeFingerprint(raw, author) {
  const authorReviews = ownerReviews(raw, author);
  const fingerprintSource = {
    updated_at: (raw.pr ? raw.pr.updated_at : raw.issue && raw.issue.updated_at) || null,
    merged_at: (raw.pr && raw.pr.merged_at) || null,
    state: raw.pr ? raw.pr.state : raw.issue && raw.issue.state,
    head_sha: raw.pr && raw.pr.head ? raw.pr.head.sha : null,
    changed_files_reported: raw.pr ? raw.pr.changed_files : null,
    files: (raw.files || []).map((f) => ({
      filename: f.filename,
      additions: f.additions,
      deletions: f.deletions,
      status: f.status,
    })),
    owner_reviews: authorReviews.map((r) => ({ state: r.state, submitted_at: r.submitted_at || null })),
    owner_commented_paths: ownerCommentedPaths(raw, author),
  };
  return sha256(stableStringify(fingerprintSource));
}

function ownerReviews(raw, author) {
  return (raw.reviews || []).filter(
    (r) => r.user && r.user.login === author && r.state !== "PENDING"
  );
}

function ownerCommentedPaths(raw, author) {
  const paths = (raw.comments || [])
    .filter((c) => c.user && c.user.login === author && c.path)
    .map((c) => c.path);
  return [...new Set(paths)].sort();
}

// ---------------------------------------------------------------- assertions

function assertion(tag, category, level, evidence) {
  return {
    tag,
    category,
    evidence_level: level,
    evidence: [...new Set(evidence)].sort(),
  };
}

/** Keep the strongest assertion per (tag, category); merge evidence at that level. */
function mergeAssertions(assertions) {
  const best = new Map();
  for (const a of assertions) {
    const key = `${a.tag}\u0000${a.category}`;
    const existing = best.get(key);
    if (!existing) {
      best.set(key, { tag: a.tag, category: a.category, evidence_level: a.evidence_level, evidence: [...a.evidence] });
      continue;
    }
    if (LEVEL_RANK[a.evidence_level] > LEVEL_RANK[existing.evidence_level]) {
      existing.evidence_level = a.evidence_level;
      existing.evidence = [...a.evidence];
    } else if (a.evidence_level === existing.evidence_level) {
      existing.evidence = [...new Set([...existing.evidence, ...a.evidence])];
    }
    // Weaker evidence never overwrites stronger evidence (repository fallback rule).
  }
  return [...best.values()].sort(
    (a, b) => a.tag.localeCompare(b.tag) || a.category.localeCompare(b.category)
  );
}

// ---------------------------------------------------------------- classification

/** Extension or special-filename basis string for a path's language, or null. */
function languageBasis(filePath, rules) {
  const table = rules.languages || { extensions: {}, filenames: {} };
  const base = filePath.split("/").pop();
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const ext = base.slice(dot).toLowerCase();
    if (table.extensions[ext]) return `extension:${ext}`;
  }
  if (table.filenames[base.toLowerCase()]) return `filename:${base.toLowerCase()}`;
  return null;
}

function levelForFile(project, filePath, context, rules) {
  const { authored, commentedPaths, reviewed, manualReviewed } = context;
  const ecosystems = ecosystemsForPath(project, filePath, rules);
  const language = languageForPath(filePath, rules);
  const languageBasisStr = languageBasis(filePath, rules);
  const tags = [
    ...(language ? [{ tag: language, category: "language", basis: languageBasisStr }] : []),
    ...ecosystems.map((e) => ({ tag: e.tag, category: "ecosystem", basis: `path-prefix:${e.prefix}` })),
  ];
  let level;
  let relationshipEvidence;
  if (authored) {
    level = "direct-contribution";
    relationshipEvidence = "authored-pr";
  } else if (commentedPaths.includes(filePath)) {
    level = "direct-review";
    relationshipEvidence = "inline-comment";
  } else if (reviewed) {
    level = "reviewed-pr-scope";
    relationshipEvidence = "reviewed-pr";
  } else if (manualReviewed) {
    // Human-verified team attribution (e.g. AR reviews on m0): weaker claim,
    // still item-level file scope, explicitly marked in evidence.
    level = "reviewed-pr-scope";
    relationshipEvidence = "manual-attribution";
  } else {
    level = null; // no relationship: no assertion from this file
  }
  const evidence = [relationshipEvidence];
  return { tags, level, evidence };
}

/**
 * Classify one hydrated record into the normalized schema.
 *
 * raw shape (from scripts/github-hydrate.js):
 *   { kind: "pr"|"issue", project, number,
 *     pr?: full pulls response, files?: [file...],
 *     reviews?: [...], comments?: [...], issue?: full issue response }
 */
function classifyRecord(raw, rules, { author, overrides } = {}) {
  const isPr = raw.kind === "pr";
  const source = isPr ? raw.pr : raw.issue;
  if (!source) throw new Error(`raw record ${raw.project}#${raw.number} is missing its source payload`);

  const ownerReviewList = isPr ? ownerReviews(raw, author) : [];
  const commentedPaths = isPr ? ownerCommentedPaths(raw, author) : [];
  const authored = source.user && source.user.login === author;
  const reviewed = ownerReviewList.length > 0;
  // Repositories where review work is attributed to a team the owner was part
  // of rather than their GitHub account (configured in the rules, e.g. AR
  // reviews on m0). The relation is human-verified; file-level evidence is
  // stamped "manual-attribution" instead of the API-backed "reviewed-pr".
  const manualReviewRel = (rules.repos || {})[raw.project]?.manual_relations || [];
  const manualReviewed = isPr && manualReviewRel.includes("reviewed-pr") && !reviewed;

  const relations = [];
  if (isPr) {
    if (authored) relations.push("authored-pr");
    if (reviewed || manualReviewed) relations.push("reviewed-pr");
  } else if (authored) {
    relations.push("authored-issue");
  }
  if (relations.length === 0) {
    throw new Error(
      `${raw.project}#${raw.number}: no relationship to ${author}; refusing to emit a record`
    );
  }

  const context = {
    authored,
    reviewed,
    manualReviewed,
    commentedPaths,
    author,
    project: raw.project,
  };
  const assertions = [];
  let filesPayload = null;
  let languageChanges = {};
  let reviewPayload = null;

  if (isPr) {
    const fileEntries = (raw.files || []).map((f) => ({
      filename: f.filename,
      additions: f.additions,
      deletions: f.deletions,
    }));
    const reported = typeof source.changed_files === "number" ? source.changed_files : fileEntries.length;
    const flagged = {};
    for (const entry of fileEntries) {
      const flag = flagForPath(entry.filename, rules);
      if (flag) flagged[entry.filename] = flag;
    }

    for (const entry of fileEntries) {
      const { tags, level, evidence } = levelForFile(raw.project, entry.filename, context, rules);
      if (!level) continue;
      for (const { tag, category, basis } of tags) {
        assertions.push(
          assertion(tag, category, level, basis ? [...evidence, basis] : evidence)
        );
        if (category === "language") {
          const lang = languageChanges[tag] || (languageChanges[tag] = {
            files: 0,
            changed_lines: 0,
            direct_review_paths: [],
            evidence_level: "repository-context",
          });
          lang.files += 1;
          lang.changed_lines += entry.additions + entry.deletions;
          if (commentedPaths.includes(entry.filename)) lang.direct_review_paths.push(entry.filename);
          if (LEVEL_RANK[level] > LEVEL_RANK[lang.evidence_level]) lang.evidence_level = level;
        }
      }
    }

    languageChanges = Object.fromEntries(
      Object.entries(languageChanges).map(([lang, v]) => [
        lang,
        { ...v, direct_review_paths: [...new Set(v.direct_review_paths)].sort() },
      ])
    );

    filesPayload = {
      count: reported,
      complete: fileEntries.length >= reported,
      paths: fileEntries.map((f) => f.filename).sort(),
      flagged,
      language_changes: languageChanges,
    };

    reviewPayload = {
      count: ownerReviewList.length,
      states: [...new Set(ownerReviewList.map((r) => r.state))].sort(),
      inline_comment_count: (raw.comments || []).filter((c) => c.user && c.user.login === author).length,
      commented_paths: commentedPaths,
    };
  } else {
    // Issues: no file evidence. Labels only, via explicit configured mappings.
    const labelMap = rules.issue_label_tags || {};
    for (const label of source.labels || []) {
      const name = typeof label === "string" ? label : label.name;
      const mapping = labelMap[name];
      if (mapping) {
        assertions.push(
          assertion(mapping.tag, mapping.category || "ecosystem", "repository-context", `label:${name}`)
        );
      }
    }
  }

  // Repository defaults: weakest fallback, never overwrite item-level evidence.
  for (const tag of repoDefaults(raw.project, rules)) {
    assertions.push(assertion(tag, "ecosystem", "repository-context", ["repository-default"]));
  }

  let finalAssertions = mergeAssertions(assertions);

  if (overrides && overrides.entries) {
    finalAssertions = applyOverrides(finalAssertions, overrides.entries[stableIdFor(raw)] || null);
  }

  const id = stableIdFor(raw);
  const record = {
    id,
    kind: isPr ? "pull-request" : "issue",
    project: raw.project,
    number: raw.number,
    url: source.html_url,
    title: source.title,
    state: source.state,
    relations: relations.sort(),
    created_at: source.created_at,
    updated_at: source.updated_at,
  };
  if (isPr) {
    record.merged_at = source.merged_at || null;
    record.head_sha = source.head ? source.head.sha : null;
    record.review = reviewPayload;
    record.files = filesPayload;
  }
  record.assertions = finalAssertions;
  record.provenance = {
    source: "github-api",
    source_fingerprint: computeFingerprint(raw, author),
    collector_version: COLLECTOR_VERSION,
  };
  if (manualReviewed) {
    record.provenance.attribution = "manual";
  }
  return record;
}

function stableIdFor(raw) {
  return stableId(raw.kind === "pr" ? "pull-request" : "issue", raw.project, raw.number);
}

// ---------------------------------------------------------------- overrides

function applyOverrides(assertions, override) {
  if (!override) return assertions;
  if (!override.reason || !override.reason.trim()) {
    throw new Error(`Override for record is missing a reason: ${JSON.stringify(override)}`);
  }
  const removed = new Set(override.remove_assertions || []);
  let next = assertions.filter((a) => !removed.has(a.tag));
  for (const add of override.add_assertions || []) {
    if (!add.tag || !add.category || !add.evidence_level) {
      throw new Error(`Override add_assertions entry missing tag/category/evidence_level: ${JSON.stringify(add)}`);
    }
    if (!LEVEL_RANK[add.evidence_level]) {
      throw new Error(`Override uses unknown evidence_level: ${add.evidence_level}`);
    }
    next.push(assertion(add.tag, add.category, add.evidence_level, add.evidence || []));
  }
  return mergeAssertions(next);
}

// ---------------------------------------------------------------- discovery

/** Merge authored/reviewed/issue discovery candidates by stable ID, unioning relations. */
function mergeCandidates(existing, incoming) {
  const byId = new Map(existing.map((c) => [c.id, { ...c, relations: new Set(c.relations) }]));
  for (const c of incoming) {
    const found = byId.get(c.id);
    if (found) {
      for (const r of c.relations) found.relations.add(r);
    } else {
      byId.set(c.id, { ...c, relations: new Set(c.relations) });
    }
  }
  return [...byId.values()]
    .map((c) => ({ ...c, relations: [...c.relations].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Calendar-window helper. Windows are inclusive date strings YYYY-MM-DD.
 * Returns the two halves of a window (first ends the day before the second
 * starts). The caller re-queries each half when a search approaches the API's
 * 1000-result cap.
 */
function windowHalves(window) {
  const from = new Date(`${window.from}T00:00:00Z`).getTime();
  const to = new Date(`${window.to}T00:00:00Z`).getTime();
  const days = Math.round((to - from) / 86400e3);
  if (days < 2) {
    throw new Error(`Window ${window.from}..${window.to} is too small to split further`);
  }
  const half = Math.ceil(days / 2) * 86400e3;
  const firstTo = new Date(from + half - 86400e3).toISOString().slice(0, 10);
  const secondFrom = new Date(from + half).toISOString().slice(0, 10);
  return [{ from: window.from, to: firstTo }, { from: secondFrom, to: window.to }];
}

module.exports = {
  LEVEL_RANK,
  COLLECTOR_VERSION,
  stableStringify,
  stableId,
  sha256,
  flagForPath,
  languageForPath,
  languageBasis,
  ecosystemsForPath,
  repoDefaults,
  computeFingerprint,
  ownerReviews,
  ownerCommentedPaths,
  assertion,
  mergeAssertions,
  classifyRecord,
  applyOverrides,
  mergeCandidates,
  windowHalves,
};
