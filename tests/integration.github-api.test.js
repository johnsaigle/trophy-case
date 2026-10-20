/**
 * Opt-in integration test: verifies API shape for one known public PR.
 * Not part of the default test run (CI must not depend on mutable external
 * data). Requires an authenticated `gh` CLI.
 *
 *   RUN_INTEGRATION=1 node --test tests/integration.github-api.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("child_process");

const KNOWN_PR = "repos/wormhole-foundation/native-token-transfers/pulls/918";

test("known public PR has the expected API shape", { skip: !process.env.RUN_INTEGRATION && "set RUN_INTEGRATION=1" }, () => {
  const pr = JSON.parse(execFileSync("gh", ["api", KNOWN_PR], { encoding: "utf8" }));
  assert.equal(pr.number, 918);
  assert.equal(typeof pr.changed_files, "number");
  assert.ok(pr.user && pr.user.login);
  assert.ok(pr.html_url.includes("/pull/918"));

  const files = JSON.parse(
    execFileSync("gh", ["api", `${KNOWN_PR}/files?per_page=100&page=1`], { encoding: "utf8" })
  );
  assert.ok(Array.isArray(files));
  for (const f of files) {
    assert.ok(f.filename);
    assert.equal(typeof f.additions, "number");
    assert.equal(typeof f.deletions, "number");
  }

  const reviews = JSON.parse(
    execFileSync("gh", ["api", `${KNOWN_PR}/reviews?per_page=100&page=1`], { encoding: "utf8" })
  );
  assert.ok(Array.isArray(reviews));
  for (const r of reviews) {
    assert.ok(r.user && r.user.login);
    assert.ok(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"].includes(r.state));
  }
});
