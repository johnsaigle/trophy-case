# Event Schema

The trophy case is generated from `events.jsonl` — an append-only log with one JSON
object per line. Every renderer (README, stats, visualizations) reads from this file;
the file itself is the source of truth.

## Rules

- **Append-only**: never edit or delete existing lines (fix by appending a corrected
  event with a new `id`, or a `supersedes` field).
- **Public-only**: nothing enters this log that isn't safe to publish. Internal work
  appears only as deliberate hand-written aggregate entries.
- **Provenance on everything**: each event records how it came to exist.

## Common fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Stable slug, e.g. `audit-zetachain-node-2023` |
| `type` | string | yes | `audit` \| `code-review` \| `review` \| `bug-report` \| `disclosure` \| `writing` \| `tool` \| `talk` |
| `title` | string | yes | |
| `date` | string \| null | yes | ISO date. `null` when unknown; use `date_hint` |
| `date_hint` | string | no | e.g. `"2015-2020"` when exact date unknown |
| `org` | string \| null | no | Employer or context, e.g. `Halborn`, `Asymmetric Research` |
| `client` | string \| null | no | For audits: the audited organization |
| `project` | string \| null | no | GitHub slug `owner/repo` when applicable |
| `role` | string | no | `primary-auditor` \| `reviewer` \| `reporter` \| `author` \| `maintainer` |
| `summary` | string | no | One line. LLM-written summaries must be human-approved before merge |
| `evidence` | array | no | `{kind: "pdf"\|"url"\|"doi"\|"file", path?, url?}` |
| `tags` | string[] | no | Ecosystem/language/domain, lowercase: `cosmos`, `go`, `access-control` |
| `severity` | string | no | For bugs/findings: `critical` \| `high` \| `medium` \| `low` \| `informational` |
| `notability` | int 1–5 | no | 5 = career-highlight, 3 = worth listing, 1 = filler. Drives rendering filters |
| `state` | string | no | **On evidence entries only** (not events): lifecycle of the referenced artifact — `draft` \| `open` \| `merged`. A review is a completed fact regardless of PR state; the collector refreshes evidence `state` when PRs merge |
| `provenance` | object | yes | `{source, extracted_at, confidence?}` — `source` ∈ `manual` \| `pdf-parse` \| `github-collector` \| `rss` |
| `reviewed` | bool | yes | `false` for bot-proposed events awaiting human merge approval |

## Type-specific payloads

### `type: "audit"`

```json
{
  "id": "audit-zetachain-node-2023",
  "type": "audit",
  "date": "2023-04-04",
  "title": "ZetaChain Node Security Audit",
  "org": "Halborn",
  "client": "ZetaChain",
  "role": "primary-auditor",
  "evidence": [{"kind": "pdf", "path": "pdfs/Halborn_ZetaNode_Cosmos_Security_Audit_Report.pdf"}],
  "tags": ["cosmos", "go", "bridge"],
  "notability": 5,
  "provenance": {"source": "pdf-parse", "extracted_at": "2026-10-06", "confidence": 0.9},
  "reviewed": true,
  "audit": {
    "counts": {"critical": 4, "high": 5, "medium": 6, "low": 6},
    "findings": [
      {
        "id": "HAL-01",
        "title": "Zeta supply does not track assets correctly",
        "severity": "critical",
        "score": null,
        "remediation": "solved",
        "class": "accounting"
      }
    ]
  }
}
```

Finding `class` vocabulary: `accounting`, `access-control`, `arithmetic`, `dos`,
`crypto`, `supply-chain`, `determinism`, `error-handling`, `validation`,
`config`, `testing`, `documentation`, `other`.

Finding `remediation`: `solved` | `acknowledged` | `risk-accepted` | `partially-solved` | `unknown`.

### `type: "code-review"` / `"review"` / `"bug-report"`

Optional `code_review` payload: `{"prs_merged": 179, "issues": 9, "reviews_2026_ytd": 112}`.
Live counts are refreshed by the weekly collector; the event marks that the
relationship exists, the collector keeps numbers current.

`review` events capture meaningful review contributions to *others'* PRs —
including PRs still in draft (e.g. early review of a strategic integration).
The event records what you did (the review); the PR's lifecycle lives on the
evidence entry's `state`. Role must be accurate: `reviewer`, never author.
`project` is the canonical repo; evidence URLs may point at forks where the
PR actually lives.

The weekly collector also refreshes review counts via GraphQL
`contributionsCollection.pullRequestReviewContributionsByRepository`.

## Pipeline

1. **Collectors** append candidate events with `reviewed: false` via PR.
2. **Human** reviews the PR diff and merges (approval = `reviewed` stays false in
   file but merge itself is the approval; renderer treats merged lines as reviewed)
   — or edits lines before merging.
3. **Renderers** read only merged lines on `main`.

Current collectors:
- `scripts/backfill.py` — one-time PDF extraction + manual seed (already run).
- `scripts/collect.js` — weekly GitHub + GitHub Models classification.
