---
name: TrophyCase
description: Maintain the trophy-case security career event log. USE WHEN working in the trophy-case repo, classifying pending candidates in proposals/, adding events to events.jsonl, adding manual entries, regenerating the README, classifying published report findings, editing finding classes or fingerprint labels, or retiring taxonomy tags.
---

# TrophyCase

A generated portfolio of the owner's security career: audits, code review,
bug reports, writing, tools. **`events.jsonl` is the single source of truth.**
The README, JSON exports, and SVG visualizations are generated output — never
edit them directly.

## Rules

1. **Append-only**: never edit or delete existing lines in `events.jsonl`.
   One exception: when the owner explicitly asks to drop or correct a metadata
   value (a tag, a corrupt title), edit that line in place, keep the diff to the
   affected field, and say so in the commit message. Never rewrite the file.
2. **Public-only**: nothing enters the log that isn't already public. Internal
   work appears only as deliberate hand-written aggregate entries.
3. **Provenance on every event**: `provenance.source` ∈ `manual` | `pdf-parse` |
   `github-collector` | `local-llm` | `agent`.
4. **Honest roles**: `reviewer` is never blurred into `author`. Bugs the owner
   helped find but didn't author are `role: "reporter"` with a summary saying so.
5. Every event tag must be classified in `data/tag-taxonomy.json`; add new tags
   there before regenerating output.
6. Schema reference: `docs/schema.md`. Pipeline reference: `docs/development.md`.

## Main task: classify pending candidates

The weekly collector dumps unclassified PRs/issues to
`proposals/candidates-*.json`. To process them:

1. Read all `proposals/candidates-*.json`.
2. Skip candidates whose `url` already appears in any `events.jsonl` evidence
   or in `proposals/processed-urls.json`.
3. For each remaining candidate, judge:
   - `security_relevant`: relates to security engineering, vulnerability fixes,
     security review, or hardening? Pure CI/docs/refactor = false.
   - `type`: `code-review` (security engineering contribution) or `bug-report`.
   - `notability`: 1–5 (5 = career highlight, 3 = worth listing, 1 = filler).
   - `summary`: one factual sentence, no hype.
   - `tags`: 1–4 lowercase (language, ecosystem, domain — e.g. `rust`,
     `cosmos`, `access-control`).
4. Append accepted candidates to `events.jsonl` as events with
   `id: "proposal-<slug-with-dashes>-<number>"`, `reviewed: true`,
   `provenance: {"source": "agent", ...}`, and evidence `{"kind": "url", "url": ...}`.
5. Append **all** seen candidate URLs (accepted or not) to
   `proposals/processed-urls.json` so nothing is re-proposed.
6. Run `node scripts/render-visuals.js && node scripts/render.js` and include
   regenerated files under `assets/`, `dist/`, and `README.md` in the commit.

The script `scripts/postprocess.js` does the same thing against a local
OpenAI-compatible endpoint — prefer it when the owner wants one-command
processing; do it by hand (following the steps above) when they don't.

## Other tasks

- **Add a manual event**: append a JSON line to `events.jsonl` (schema-compliant,
  `provenance.source: "manual"`), or add it to `MANUAL` in
  `scripts/backfill.py` and run `python3 scripts/backfill.py` for seed-stable
  entries. Then run both renderers.
- **Regenerate presentation output**: `node scripts/render-visuals.js &&
  node scripts/render.js`. If tag evidence changed, also run
  `node scripts/github-classify.js && node scripts/render-contributions.js`.
- **Validate**: `node --check scripts/*.js` after editing scripts, then
  `node --test tests/`.

## Finding classes and labels

Audit findings carry a canonical `class` ID (`docs/schema.md`). IDs are stable
and shared with the semantic pass — never rename an ID to improve how it reads.

The PDF extraction heuristics default ambiguous findings to `other`, and
occasionally misclassify one. Both are corrected in
`data/finding-class-overrides.json`, which is the only place to touch:

- `classes["<event-id>/<finding-id>"] = {class, reason}` — use when the source
  class is missing, `other`, or plainly wrong. `reason` is one factual line
  about the finding, not a justification of its importance.
- `labels[class-id]` — display-only names for the fingerprint chart. A label may
  be more precise or more professional than its ID, but must not claim work,
  coverage, or impact the finding does not have.

Judging rules:

- Classify what the finding *is*: panics, unchecked errors, and silent failures
  are `error-handling`; missing unit/fuzz tests are `testing`; todos, spelling,
  and misleading names are `documentation`.
- If a finding sits in the wrong class, fix the class instead of stretching a
  label. Examples: an exposed admin login on a test server is `config`, not
  `testing`; a duplicated core math routine is `arithmetic`, not `testing`.
- Source titles can be PDF parse artifacts (multi-thousand-character run-ons).
  Classify the actual finding and record the artifact in `reason`.
- `other` must not appear in published output; `tests/visuals.test.js` fails if
  it does. Every override must resolve to a real finding and carry a reason.
- Current display labels: `error-handling` → **Failure Handling**,
  `testing` → **Verification Gaps**, `documentation` → **Code Quality**.
  Keep these unless the owner asks otherwise; changing them changes the chart.

## Retiring a tag

When the owner asks to remove a taxonomy tag (e.g. `healthcare`), change every
layer in one commit:

1. `data/tag-taxonomy.json` (entry) and `data/github-enrichment-rules.json`
   (repo defaults using it).
2. `scripts/backfill.py` seeds and the historical `events.jsonl` line(s). This
   is the documented metadata exception to rule 1 — keep the diff to `tags`.
3. `node scripts/github-classify.js && node scripts/render-contributions.js` to
   strip it from `contributions.jsonl` and the generated exports.
4. Update tests that assert the tag (including negative assertions), then run
   the renderers and the suite.

Do not add a "retired tags" layer that leaves the tag in canonical data unless
the owner wants the tag preserved; a clean removal is easier to reason about.

## Verification

- `events.jsonl` must stay valid JSONL: `node -e "require('fs').readFileSync('events.jsonl','utf8').trim().split('\n').forEach(JSON.parse)"`
- After any log change, re-render and inspect `git diff -- README.md assets/ dist/`.
- Determinism check: run `node scripts/render-visuals.js` twice and confirm the
  second run produces no diff.
