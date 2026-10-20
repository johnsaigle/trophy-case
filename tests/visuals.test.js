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

test("no published finding falls back to the other bucket", () => {
  const unclassified = [];
  for (const [key, { finding }] of findings) {
    const className = OVERRIDES.classes[key]?.class || finding.class || "other";
    if (className === "other") unclassified.push(key);
  }
  assert.deepEqual(unclassified, [], `classify these findings in data/finding-class-overrides.json`);
});
