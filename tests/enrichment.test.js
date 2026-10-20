/**
 * Fixture-based tests for the deterministic GitHub enrichment pipeline.
 * No network. Run: node --test tests/
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const rules = require("../data/github-enrichment-rules.json");
const {
  classifyRecord,
  computeFingerprint,
  mergeCandidates,
  applyOverrides,
  stableStringify,
  windowHalves,
  stableId,
} = require("../scripts/lib/contribution-rules");

const AUTHOR = "johnsaigle";
const NTT = "wormhole-foundation/native-token-transfers";

// ---------------------------------------------------------------- fixtures

let seq = 0;
function prFixture({
  project = NTT,
  number = ++seq,
  user = "someone-else",
  state = "merged",
  merged_at = "2026-05-02T00:00:00Z",
  files = [],
  changed_files,
  ownerReviews = [],
  ownerComments = [],
} = {}) {
  return {
    kind: "pr",
    project,
    number,
    pr: {
      number,
      title: `Fixture PR #${number}`,
      state,
      merged_at,
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-03T00:00:00Z",
      html_url: `https://github.com/${project}/pull/${number}`,
      changed_files: changed_files ?? files.length,
      head: { sha: `deadbeef${number}` },
      user: { login: user },
    },
    files,
    reviews: ownerReviews,
    comments: ownerComments,
  };
}

const file = (filename, additions = 10, deletions = 1, status = "modified") => ({
  filename,
  additions,
  deletions,
  status,
});

const find = (record, tag) => record.assertions.find((a) => a.tag === tag);
const jsonl = (records) => records.map((r) => JSON.stringify(r)).join("\n") + "\n";

// ---------------------------------------------------------------- 1+2. discovery merge

test("discovery merges authored and reviewed relationships by stable ID", () => {
  const authored = [
    { id: "github-pr-a-b-1", kind: "pr", project: "a/b", number: 1, relations: ["authored-pr"] },
  ];
  const reviewed = [
    { id: "github-pr-a-b-1", kind: "pr", project: "a/b", number: 1, relations: ["reviewed-pr"] },
    { id: "github-pr-a-b-2", kind: "pr", project: "a/b", number: 2, relations: ["reviewed-pr"] },
  ];
  const merged = mergeCandidates(authored, reviewed);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].relations, ["authored-pr", "reviewed-pr"]);
  assert.deepEqual(merged[1].relations, ["reviewed-pr"]);
});

test("pagination overlap windows deduplicate to one candidate per item", () => {
  const window1 = [
    { id: "github-pr-a-b-7", kind: "pr", project: "a/b", number: 7, relations: ["reviewed-pr"] },
  ];
  const window2 = [
    // same PR re-found by an overlapping window, with an extra relation discovered
    { id: "github-pr-a-b-7", kind: "pr", project: "a/b", number: 7, relations: ["authored-pr"] },
    { id: "github-pr-a-b-8", kind: "pr", project: "a/b", number: 8, relations: ["reviewed-pr"] },
  ];
  const merged = mergeCandidates(mergeCandidates([], window1), window2);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].relations, ["authored-pr", "reviewed-pr"]);
});

// ---------------------------------------------------------------- 3. solidity/evm

test("sol files under evm/ produce solidity and evm at reviewed-pr scope", () => {
  const raw = prFixture({
    number: 918,
    files: [file("evm/src/NttManager/NttManager.sol", 100, 3), file("evm/src/libraries/Peers.sol")],
    ownerReviews: [{ user: { login: AUTHOR }, state: "APPROVED", submitted_at: "2026-05-02T00:00:00Z" }],
  });
  const record = classifyRecord(raw, rules, { author: AUTHOR });
  assert.deepEqual(record.relations, ["reviewed-pr"]);
  const solidity = find(record, "solidity");
  assert.equal(solidity.evidence_level, "reviewed-pr-scope");
  assert.ok(solidity.evidence.includes("extension:.sol"));
  const evm = find(record, "evm");
  assert.equal(evm.evidence_level, "reviewed-pr-scope");
  assert.ok(evm.evidence.includes("path-prefix:evm/"));
  assert.equal(record.files.language_changes.solidity.files, 2);
  assert.equal(record.files.language_changes.solidity.changed_lines, 100 + 3 + 10 + 1);
});

// ---------------------------------------------------------------- 4. typescript/xrpl

test("ts files under xrpl paths produce typescript and xrpl", () => {
  const raw = prFixture({
    number: 921,
    files: [
      file("cli/src/commands/xrpl/CreateWrap.ts"),
      file("cli/src/commands/xrpl/Redeem.ts"),
    ],
    ownerReviews: [{ user: { login: AUTHOR }, state: "COMMENTED" }],
  });
  const record = classifyRecord(raw, rules, { author: AUTHOR });
  const ts = find(record, "typescript");
  assert.equal(ts.evidence_level, "reviewed-pr-scope");
  const xrpl = find(record, "xrpl");
  assert.equal(xrpl.evidence_level, "reviewed-pr-scope");
  assert.ok(xrpl.evidence.includes("path-prefix:cli/src/commands/xrpl/"));
});

// ---------------------------------------------------------------- 5. direct review

test("inline-comment paths get direct-review; other files stay reviewed-pr-scope", () => {
  const raw = prFixture({
    number: 55,
    files: [file("solang/lib/Token.daml"), file("da-utils/README.md")],
    ownerReviews: [{ user: { login: AUTHOR }, state: "CHANGES_REQUESTED" }],
    ownerComments: [
      { user: { login: AUTHOR }, path: "solang/lib/Token.daml" },
      { user: { login: "other-dev" }, path: "da-utils/README.md" },
    ],
  });
  const record = classifyRecord(raw, rules, { author: AUTHOR });
  const daml = find(record, "daml");
  assert.equal(daml.evidence_level, "direct-review");
  assert.deepEqual(record.review.commented_paths, ["solang/lib/Token.daml"]);
  assert.equal(record.review.inline_comment_count, 1);
  // README.md is documentation-flagged but still observed; daml gets the strong level
  assert.equal(record.files.flagged["da-utils/README.md"], "documentation");
  assert.equal(record.files.language_changes.daml.evidence_level, "direct-review");
  assert.deepEqual(record.files.language_changes.daml.direct_review_paths, ["solang/lib/Token.daml"]);
});

// ---------------------------------------------------------------- 6. authored

test("authored PR files receive direct-contribution", () => {
  const raw = prFixture({
    number: 42,
    user: AUTHOR,
    files: [file("solana/programs/ntt/src/lib.rs")],
  });
  const record = classifyRecord(raw, rules, { author: AUTHOR });
  assert.deepEqual(record.relations, ["authored-pr"]);
  const rust = find(record, "rust");
  assert.equal(rust.evidence_level, "direct-contribution");
  const solana = find(record, "solana");
  assert.equal(solana.evidence_level, "direct-contribution");
  assert.equal(record.review.count, 0);
});

// ---------------------------------------------------------------- 7. repo fallback

test("repository defaults never overwrite stronger item-level evidence", () => {
  const customRules = {
    ...rules,
    repos: { "t/r": { defaults: ["evm"], paths: { "evm/": ["evm"] } } },
  };
  const raw = prFixture({
    project: "t/r",
    number: 1,
    user: AUTHOR,
    files: [file("evm/src/Foo.sol")],
  });
  const record = classifyRecord(raw, customRules, { author: AUTHOR });
  const evm = find(record, "evm");
  assert.equal(evm.evidence_level, "direct-contribution");
  assert.deepEqual(evm.evidence, ["authored-pr", "path-prefix:evm/"]);

  // and the weak fallback applies when no item-level evidence exists
  const rawNoMatch = prFixture({
    project: "t/r",
    number: 2,
    user: AUTHOR,
    files: [file("docs/notes.txt")],
  });
  const record2 = classifyRecord(rawNoMatch, customRules, { author: AUTHOR });
  const evm2 = find(record2, "evm");
  assert.equal(evm2.evidence_level, "repository-context");
  assert.deepEqual(evm2.evidence, ["repository-default"]);
});

// ---------------------------------------------------------------- 8. partial files

test("partial file responses set files.complete to false", () => {
  const raw = prFixture({
    number: 77,
    user: AUTHOR,
    files: [file("a.go"), file("b.go")],
    changed_files: 5,
  });
  const record = classifyRecord(raw, rules, { author: AUTHOR });
  assert.equal(record.files.count, 5);
  assert.equal(record.files.complete, false);
  assert.equal(record.files.paths.length, 2);

  const complete = classifyRecord(
    { ...raw, pr: { ...raw.pr, changed_files: 2 } },
    rules,
    { author: AUTHOR }
  );
  assert.equal(complete.files.complete, true);
});

// ---------------------------------------------------------------- 9. unknown extensions

test("unknown extensions are recorded without inventing a language", () => {
  const raw = prFixture({
    number: 9,
    user: AUTHOR,
    files: [file("src/thing.weird"), file("src/Makefile")],
  });
  const record = classifyRecord(raw, rules, { author: AUTHOR });
  assert.ok(record.files.paths.includes("src/thing.weird"));
  assert.equal(find(record, "makefile").evidence_level, "direct-contribution");
  assert.ok(!record.files.language_changes.weird);
});

// ---------------------------------------------------------------- 10. determinism

test("identical fixtures produce byte-for-byte identical records", () => {
  const build = () =>
    classifyRecord(
      prFixture({
        number: 918,
        files: [file("evm/src/NttManager/NttManager.sol"), file("evm/README.md")],
        ownerReviews: [{ user: { login: AUTHOR }, state: "APPROVED" }],
      }),
      rules,
      { author: AUTHOR }
    );
  const a = build();
  const b = build();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  // stableStringify is key-order-independent
  assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
  // record IDs sort deterministically for JSONL output
  const records = [b, a].sort((x, y) => x.id.localeCompare(y.id));
  assert.equal(jsonl(records), jsonl([a, b]));
});

// ---------------------------------------------------------------- 11. rule versions

test("a changed rule version deterministically rebuilds assertions", () => {
  const raw = prFixture({
    number: 10,
    user: AUTHOR,
    files: [file("evm/src/Foo.sol")],
  });
  const v1 = { ...rules, repos: { [NTT]: { defaults: [], paths: { "evm/": ["evm"] } } } };
  const v2 = { ...rules, repos: { [NTT]: { defaults: [], paths: { "evm/": ["evm", "bridge"] } } } };
  const r1 = classifyRecord(raw, v1, { author: AUTHOR });
  const r2 = classifyRecord(raw, v2, { author: AUTHOR });
  assert.ok(!find(r1, "bridge"));
  assert.equal(find(r2, "bridge").evidence_level, "direct-contribution");
  // fingerprints cover source facts only (unchanged here); the records differ
  assert.equal(r1.provenance.source_fingerprint, r2.provenance.source_fingerprint);
  assert.notEqual(JSON.stringify(r1.assertions), JSON.stringify(r2.assertions));
});

// ---------------------------------------------------------------- 12. overrides

test("overrides add or remove only the assertions they name", () => {
  const base = [
    { tag: "solidity", category: "language", evidence_level: "direct-contribution", evidence: ["extension:.sol"] },
    { tag: "evm", category: "ecosystem", evidence_level: "direct-contribution", evidence: ["path-prefix:evm/"] },
    { tag: "bridge", category: "ecosystem", evidence_level: "repository-context", evidence: ["repository-default"] },
  ];
  const next = applyOverrides(base, {
    remove_assertions: ["bridge"],
    add_assertions: [{ tag: "defi", category: "domain", evidence_level: "direct-contribution", evidence: [] }],
    reason: "PR explicitly implements a bridge vault; verified by hand.",
  });
  assert.ok(!find({ assertions: next }, "bridge"));
  assert.equal(find({ assertions: next }, "defi").evidence_level, "direct-contribution");
  assert.equal(find({ assertions: next }, "solidity").evidence_level, "direct-contribution");
  assert.equal(find({ assertions: next }, "evm").evidence_level, "direct-contribution");

  assert.throws(() => applyOverrides(base, { remove_assertions: ["bridge"] }), /reason/);
  assert.throws(
    () =>
      applyOverrides(base, {
        add_assertions: [{ tag: "x", category: "domain", evidence_level: "made-up" }],
        reason: "bad level",
      }),
    /evidence_level/
  );
});

// ---------------------------------------------------------------- fingerprint & misc

test("fingerprints change when source fields change and stay stable otherwise", () => {
  const raw = prFixture({ number: 918, files: [file("evm/src/A.sol")] });
  const raw2 = JSON.parse(JSON.stringify(raw));
  assert.equal(computeFingerprint(raw, AUTHOR), computeFingerprint(raw2, AUTHOR));

  raw2.pr.updated_at = "2026-06-01T00:00:00Z";
  assert.notEqual(computeFingerprint(raw, AUTHOR), computeFingerprint(raw2, AUTHOR));

  const raw3 = JSON.parse(JSON.stringify(raw));
  raw3.reviews.push({ user: { login: AUTHOR }, state: "APPROVED", submitted_at: "x" });
  assert.notEqual(computeFingerprint(raw, AUTHOR), computeFingerprint(raw3, AUTHOR));

  const raw4 = JSON.parse(JSON.stringify(raw));
  raw4.comments.push({ user: { login: AUTHOR }, path: "evm/src/A.sol" });
  assert.notEqual(computeFingerprint(raw, AUTHOR), computeFingerprint(raw4, AUTHOR));
});

test("records without a relationship to the author are refused", () => {
  const raw = prFixture({ number: 13, user: "someone-else", ownerReviews: [] });
  assert.throws(() => classifyRecord(raw, rules, { author: AUTHOR }), /no relationship/);
});

test("stable IDs match the plan format", () => {
  assert.equal(
    stableId("pull-request", "wormhole-foundation/native-token-transfers", 918),
    "github-pr-wormhole-foundation-native-token-transfers-918"
  );
  assert.equal(
    stableId("issue", "stx-labs/clarity-go", 3),
    "github-issue-stx-labs-clarity-go-3"
  );
});

test("window splitting produces contiguous inclusive date halves", () => {
  const [a, b] = windowHalves({ from: "2020-01-01", to: "2020-12-31" });
  assert.equal(a.from, "2020-01-01");
  assert.equal(b.to, "2020-12-31");
  assert.equal(new Date(`${b.from}T00:00:00Z`) - new Date(`${a.to}T00:00:00Z`), 86400e3);
});

// ---------------------------------------------------------------- rules file sanity

test("checked-in rules and overrides are valid", () => {
  const rulesPath = path.join(__dirname, "..", "data", "github-enrichment-rules.json");
  const parsed = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  assert.equal(parsed.version, 1);
  for (const lang of Object.values(parsed.languages.extensions)) {
    assert.match(lang, /^[a-z0-9-]+$/);
  }
  const overrides = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "github-enrichment-overrides.json"), "utf8")
  );
  for (const [id, entry] of Object.entries(overrides.entries || {})) {
    assert.ok(entry.reason && entry.reason.trim(), `override ${id} needs a reason`);
  }
});
