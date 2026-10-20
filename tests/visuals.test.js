/**
 * Structural checks for the finding-fingerprint inputs.
 * No network, no rendering. Run: node --test tests/
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EVENTS = fs
  .readFileSync(path.join(ROOT, "events.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const OVERRIDES = require("../data/finding-class-overrides.json");

const CLASSES = new Set([
  "accounting",
  "access-control",
  "arithmetic",
  "dos",
  "crypto",
  "supply-chain",
  "determinism",
  "error-handling",
  "memory-safety",
  "validation",
  "config",
  "testing",
  "documentation",
  "other",
]);

const findings = new Map();
for (const event of EVENTS) {
  for (const finding of event.audit?.findings || []) {
    findings.set(`${event.id}/${finding.id}`, { event, finding });
  }
}

test("finding class overrides resolve to real findings with valid classes", () => {
  for (const [key, override] of Object.entries(OVERRIDES.classes)) {
    assert.ok(findings.has(key), `override ${key} does not match an audit finding`);
    assert.ok(CLASSES.has(override.class), `override ${key} uses unknown class ${override.class}`);
    assert.equal(typeof override.reason, "string");
    assert.ok(override.reason.trim().length > 0, `override ${key} needs a reason`);
  }
});

test("finding class labels map onto known classes", () => {
  for (const [id, label] of Object.entries(OVERRIDES.labels || {})) {
    assert.ok(CLASSES.has(id), `label defined for unknown class ${id}`);
    assert.equal(typeof label, "string");
    assert.ok(label.trim().length > 0, `label for ${id} is empty`);
  }
});

test("no published finding falls back to the other bucket", () => {
  const unclassified = [];
  for (const [key, { finding }] of findings) {
    const className = OVERRIDES.classes[key]?.class || finding.class || "other";
    if (className === "other") unclassified.push(key);
  }
  assert.deepEqual(unclassified, [], `classify these findings in data/finding-class-overrides.json`);
});

test("overview and fingerprint graphics render deterministically with dark-mode support", () => {
  const { execFileSync } = require("child_process");
  const assets = ["security-engineering.svg", "overview-stats.svg", "career-timeline.svg", "finding-fingerprint.svg"];
  const run = () => {
    execFileSync("node", [path.join(ROOT, "scripts", "render-visuals.js")]);
    execFileSync("node", [path.join(ROOT, "scripts", "render-overview.js")]);
    execFileSync("node", [path.join(ROOT, "scripts", "render-era.js")]);
    return assets.map((name) => fs.readFileSync(path.join(ROOT, "assets", name), "utf8"));
  };
  const first = run();
  const second = run();
  assert.deepEqual(second, first);
  for (const svg of first) {
    assert.match(svg, /prefers-color-scheme: dark/);
    assert.doesNotMatch(svg, /NaN|undefined/);
  }
});

test("work theme rules compile, have unique ids, and leave few titles ungrouped", () => {
  const themes = require("../data/work-themes.json");
  const ids = new Set();
  for (const rule of themes.rules) {
    assert.ok(!ids.has(rule.id), `duplicate theme id ${rule.id}`);
    ids.add(rule.id);
    assert.doesNotThrow(() => new RegExp(rule.pattern, "i"), `bad pattern for ${rule.id}`);
    assert.ok(rule.label.trim());
  }
  const records = require("../dist/contributions.json").records.filter(
    (r) => r.created_at >= themes.since && r.kind === "pull-request" && r.relations.includes("authored-pr")
  );
  const ungrouped = records.filter((r) => !themes.rules.some((rule) => new RegExp(rule.pattern, "i").test(r.title)));
  assert.ok(ungrouped.length / records.length < 0.1, `${ungrouped.length} of ${records.length} titles match no theme`);
});

test("README highlights point at real contributions with the claimed role", () => {
  const records = new Map(
    fs
      .readFileSync(path.join(ROOT, "contributions.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((record) => [record.id, record])
  );
  for (const item of require("../data/highlights.json").items) {
    for (const link of item.links) {
      const record = records.get(link.id);
      assert.ok(record, `highlight ${link.id} is not in contributions.jsonl`);
      if (link.claim === "authored-merged") {
        assert.ok(record.relations.includes("authored-pr"), `${link.id} is not authored`);
        assert.ok(record.merged_at, `${link.id} is not merged`);
      } else if (link.claim === "authored") {
        assert.ok(record.relations.includes("authored-pr"), `${link.id} is not authored`);
      } else {
        assert.equal(link.claim, "reviewer");
        assert.ok(record.relations.includes("reviewed-pr"), `${link.id} is not reviewed`);
      }
    }
  }
});
