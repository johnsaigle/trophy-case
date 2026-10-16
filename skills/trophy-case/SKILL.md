---
name: TrophyCase
description: Maintain the trophy-case security career event log. USE WHEN working in the trophy-case repo, classifying pending candidates in proposals/, adding events to events.jsonl, adding manual entries, or regenerating the README.
---

# TrophyCase

A generated portfolio of the owner's security career: audits, code review,
bug reports, writing, tools. **`events.jsonl` is the single source of truth.**
Everything user-facing (README.md today, visualizations later) is generated
output — never edit it directly.

## Rules

1. **Append-only**: never edit or delete existing lines in `events.jsonl`.
2. **Public-only**: nothing enters the log that isn't already public. Internal
   work appears only as deliberate hand-written aggregate entries.
3. **Provenance on every event**: `provenance.source` ∈ `manual` | `pdf-parse` |
   `github-collector` | `local-llm` | `agent`.
4. **Honest roles**: `reviewer` is never blurred into `author`. Bugs the owner
   helped find but didn't author are `role: "reporter"` with a summary saying so.
5. Schema reference: `docs/schema.md`. Pipeline reference: `docs/development.md`.

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
6. Run `node scripts/render.js` and include the regenerated README in the commit.

The script `scripts/postprocess.js` does the same thing against a local
OpenAI-compatible endpoint — prefer it when the owner wants one-command
processing; do it by hand (following the steps above) when they don't.

## Other tasks

- **Add a manual event**: append a JSON line to `events.jsonl` (schema-compliant,
  `provenance.source: "manual"`), or add it to `MANUAL` in
  `scripts/backfill.py` and run `python3 scripts/backfill.py` for seed-stable
  entries. Then `node scripts/render.js`.
- **Regenerate README**: `node scripts/render.js`.
- **Validate**: `node --check scripts/*.js` after editing scripts.

## Verification

- `events.jsonl` must stay valid JSONL: `node -e "require('fs').readFileSync('events.jsonl','utf8').trim().split('\n').forEach(JSON.parse)"`
- After any log change, re-render and check `git diff README.md` looks sane.
