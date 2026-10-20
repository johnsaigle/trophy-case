# Development

How the trophy case works under the hood. The **presentation side** (README.md,
future visualizations, Pages site) is generated output — never hand-edited. The
**dev side** is everything that produces it.

## Architecture

```
                 ┌──────────────────────────────┐
  pdfs/*.pdf ──► │ scripts/backfill.py          │ ──► events.jsonl (seed)
                 └──────────────────────────────┘
                 ┌──────────────────────────────┐
  GitHub API ──► │ scripts/collect.js (weekly   │ ──► events.jsonl (count refresh)
                 │ Actions cron)                │ ──► proposals/candidates-*.json
                 └──────────────────────────────┘
                 ┌──────────────────────────────┐
  candidates ──► │ scripts/postprocess.js       │ ──► events.jsonl (new events)
  (local LLM)    └──────────────────────────────┘
                 ┌──────────────────────────────┐
  events.jsonl ─►│ scripts/render.js            │ ──► README.md
                 └──────────────────────────────┘
                 ┌──────────────────────────────┐
  events.jsonl ─►│ scripts/render-visuals.js    │ ──► assets/*.svg
  tag taxonomy ─►│                              │ ──► dist/*.json
                 └──────────────────────────────┘
```

**`events.jsonl` is the single source of truth.** Schema: [schema.md](schema.md).

The deterministic pipeline for contribution-level GitHub evidence is implemented
(see [github-enrichment-plan.md](github-enrichment-plan.md) for the design) and
the one-time repository-by-repository backfill has been run: `contributions.jsonl`
holds one normalized record per public PR/issue across the watched repos.

### GitHub contribution enrichment

```bash
# 1. Discovery (per-repo, resumable yearly windows; checkpointed in
#    .github/enrichment-state.json, candidates cached in .cache/github-enrichment/)
node scripts/github-discover.js --backfill [--dry-run] [--repos a/b,c/d]
node scripts/github-discover.js --incremental [--overlap-days 7]

# 2. Hydration (raw API facts cached under .cache/github-enrichment/raw/)
node scripts/github-hydrate.js                    # all pending discovery candidates
node scripts/github-hydrate.js --prs owner/repo#918,owner/repo#921

# 3. Deterministic classification -> contributions.jsonl (checked in)
node scripts/github-classify.js

# 4. Derived profiles -> dist/contributions.json, dist/project-profiles.json,
#    dist/contribution-capabilities.json
node scripts/render-contributions.js
```

Rules live in `data/github-enrichment-rules.json` (versioned: language table,
path rules per repo, low-signal file flags, issue label mappings). Rare
corrections go in `data/github-enrichment-overrides.json` and must include a
`reason`. Records are upserted by stable ID (`github-pr-<owner>-<repo>-<number>`),
so reruns are idempotent and git history tracks metadata changes. Assertions
carry an `evidence_level`: `direct-contribution` > `direct-review` >
`reviewed-pr-scope` > `repository-context`; repository defaults never overwrite
stronger evidence.

Tests (no network):

```bash
node --test tests/
```

An opt-in integration test hits one known public PR:
`RUN_INTEGRATION=1 node --test tests/integration.github-api.test.js`.

### Semantic pass (plan step 7, optional)

`scripts/semantic-pass.js prepare` builds semantic packets (titles, paths, and
the owner's own review/comment bodies) from the raw cache into
`.cache/github-enrichment/semantic/` — local only, never checked in.
`classify [--sample N] [--dry-run]` sends batches to any OpenAI-compatible
endpoint (`LLM_URL`, `LLM_MODEL` auto-detect — same conventions as
`postprocess.js`) and stores judgments in
`data/github-enrichment-semantic.json` with `approved: false`. Only after a
human verifies entries may `apply --id <record-id>` generate
`data/github-enrichment-overrides.json` entries (tagged repository-context +
`human-approved` evidence) that feed back into `github-classify.js`.

Judgments can also be produced by an agent in-session instead of an LLM
endpoint. `scripts/semantic-batch.js` keeps that loop small and reviewable:

```bash
node scripts/semantic-batch.js status                      # packets vs classified
node scripts/semantic-batch.js dump --offset 0 --limit 14  # next unclassified packets
node scripts/semantic-batch.js merge <<'EOF'               # JSON patch on stdin
{ "github-pr-owner-repo-123": { "security_relevant": true, "work_orientation": "appsec",
  "vuln_classes": ["validation"], "notable": false, "basis": "observable facts only" } }
EOF
```

`dump` always starts from the first unclassified packet, so `--offset` is only
needed when inspecting ahead. `merge` normalizes every judgment to
`judged_by: "agent"` and, unlike the LLM path, keeps `approved: false` for any
new or changed judgment; it only preserves `approved: true` when the same
record was already approved. Approval and `apply` remain manual steps.

Batch conventions: `work_orientation` is `protocol-security`, `appsec`, or
`other`; `vuln_classes` uses the `docs/schema.md` vocabulary (0–3 per record);
`notable` is true only when the owner's own words show concrete vulnerability
identification, a security-blocking review, or substantive security design
judgment; `basis` records observable facts (files, checks, reasoning) without
inflating impact. Non-security review work is still classified
(`security_relevant: false`, `work_orientation: "other"`) so coverage is
visible.

## Repo layout

| Path | Role |
|---|---|
| `README.md` | Presentation. Generated by `render.js` — do not edit |
| `events.jsonl` | The log. Append-only; one JSON object per line |
| `collectors.json` | Watched repos + collector config |
| `scripts/backfill.py` | One-time seed generator (PDF extraction + manual entries) |
| `scripts/collect.js` | Weekly collector (runs in Actions) |
| `scripts/postprocess.js` | Local LLM classification of pending candidates |
| `scripts/render.js` | README renderer |
| `scripts/render-visuals.js` | Deterministic JSON export and SVG renderer |
| `scripts/render-era.js` | Per-repo quarterly lanes and PR-title keyword groups (rules in `data/work-themes.json`) |
| `scripts/render-overview.js` | Stat strip, activity timeline SVGs, and `dist/summary.json` (run after render-visuals) |
| `scripts/lib/svg.js` | Shared SVG theme (light/dark) and severity palette |
| `data/tag-taxonomy.json` | Tag categories (used by the capability graph export) |
| `assets/` | Generated static SVG visualizations |
| `dist/` | Generated website-friendly JSON exports |
| `contributions.jsonl` | Normalized contribution evidence (deterministic upserts) |
| `data/github-enrichment-*.json` | Enrichment rules, overrides, and watched repos |
| `tests/` | Fixture tests (`node --test tests/`) + opt-in integration test |
| `proposals/` | Candidate dumps from collector runs + `processed-urls.json` |
| `docs/` | Dev documentation (this file, schema) |
| `pdfs/` | Audit report archive |

## Workflows

- **`collect-events.yml`** — Mondays 06:00 UTC + manual dispatch. Refreshes live
  counts in `events.jsonl`, dumps new candidates to `proposals/`, opens a
  proposal PR. Requires repo setting "Allow GitHub Actions to create and approve
  pull requests" and the `PAT_READ_ONLY` secret (classic PAT, `public_repo`).
- **`render-readme.yml`** — on every relevant data or renderer change. Re-renders
  the JSON exports, SVG visualizations, and README, then prunes merged
  `collect/*` branches.

## Local post-processing

The Actions runner can't run an LLM (GitHub Models was retired 2026-07), so
classification of new candidates happens locally. Two equivalent paths:

**Option A — agent**: any agent with the `skills/trophy-case/SKILL.md` skill
loaded can classify pending candidates by hand (the skill contains the full
procedure and criteria).

**Option B — script**: `scripts/postprocess.js` sends candidates to any
OpenAI-compatible endpoint (local server, llama.cpp, TabbyAPI, ...).

```bash
# 1. Point LLM_URL at your endpoint (default http://127.0.0.1:8081) and preview:
node scripts/postprocess.js --dry-run

# 2. Write the accepted events:
node scripts/postprocess.js

# 3. Review the diff, then commit:
git diff events.jsonl
git add events.jsonl proposals/ && git commit -m "postprocess: classify pending candidates"
git push   # README re-renders automatically
```

`LLM_MODEL` is auto-detected from the endpoint's `/v1/models` if unset.

Notes:
- Candidates already referenced in `events.jsonl` or `proposals/processed-urls.json`
  are skipped, so re-runs are idempotent.
- Rejected candidates (not security-relevant) are recorded in
  `processed-urls.json` and never re-proposed.
- If your local model is down, the script fails without writing anything —
  candidates stay pending for next time.

## Adding events manually

Two options:

1. **Seed entries** (stable, reproducible): add to `MANUAL` in
   `scripts/backfill.py` and run `python3 scripts/backfill.py`. Use this for
   anything with a fixed place in history (audits, tools, writing).
2. **Quick append**: add a JSON line to `events.jsonl` directly. Keep the schema
   (`docs/schema.md`), set `provenance.source: "manual"`.

When introducing a new tag, also classify it in `data/tag-taxonomy.json`. The
visualization renderer rejects unknown tags so the website-facing data cannot
silently drift. Then regenerate all output:

```bash
node scripts/render-visuals.js && node scripts/render-overview.js && node scripts/render-era.js && node scripts/render.js
```

The capability map includes recurring tags at or above
`map.minimum_event_count`; its nodes and connections are computed from event
tag co-occurrence. The finding fingerprint is computed from audit finding
classes. The renderers use fixed sorting and geometry, omit timestamps, and do
not use randomized layout, so identical inputs produce byte-for-byte identical
artifacts.

### Finding classes and display labels

Class IDs are canonical (`docs/schema.md`) and shared with the semantic pass, so
they are never renamed for presentation. Two layers live in
`data/finding-class-overrides.json`:

- `classes` maps `<event-id>/<finding-id>` to `{class, reason}` for findings the
  PDF extraction left as `other` or classified wrongly. Every entry needs a
  factual one-line reason. `tests/visuals.test.js` fails if an override does not
  resolve to a real finding, uses an unknown class, or if any finding would
  still fall back to `other`.
- `labels` maps class IDs to chart labels: `error-handling` → **Failure
  Handling**, `testing` → **Verification Gaps**, `documentation` → **Code
  Quality**. A label may be more precise than its ID but must not claim work or
  impact the finding does not have.

Fix a wrong class rather than relabelling it. Examples already applied: an
exposed admin login on a test server is `config`, not `testing`; a duplicated
core math routine (whose source title is a PDF parse artifact) is `arithmetic`.

When event tags change, the contributions outputs depend on them too:

```bash
node scripts/github-classify.js && node scripts/render-contributions.js
```

Either way, push and the README and visualizations regenerate.

## Regenerating the seed

```bash
python3 scripts/backfill.py && node scripts/render.js
```

Requires `pdftotext` (poppler-utils). The backfill rewrites `events.jsonl` from
`pdfs/` + the `MANUAL` list — run it only when changing the seed, since it will
not preserve collector count refreshes (those return on the next weekly run).
