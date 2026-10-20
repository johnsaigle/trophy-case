# Deterministic GitHub Contribution Enrichment Plan

## Purpose

Improve the public career dataset with contribution-level evidence from GitHub,
especially reviews of other people's pull requests in polyglot repositories.
The deterministic phase should identify what was contributed to or reviewed
without using an LLM and without inflating the curated `events.jsonl` timeline.

This plan deliberately separates facts available from GitHub from later semantic
judgments. GitHub can reliably provide relationships, files, languages, paths,
and repository context. It generally cannot determine whether a change is a
security finding, what vulnerability class it represents, or how notable it is.

## Design decision: two levels of data

### Curated events

`events.jsonl` remains the canonical, concise record of audits, notable reviews,
bug reports, tools, writing, and aggregate project relationships. Routine pull
requests and reviews should not each become career events.

### Contribution evidence

Introduce `contributions.jsonl` as a normalized current-state dataset with one
record per public GitHub issue or pull request. A pull request may have multiple
relationships, such as both `authored-pr` and `reviewed-pr`, without being
double-counted.

Unlike `events.jsonl`, this file should use deterministic upserts by stable ID.
Git history provides change history when GitHub metadata is updated. Derived
JSON and visualizations remain generated output.

Proposed stable IDs:

```text
github-pr-<owner>-<repo>-<number>
github-issue-<owner>-<repo>-<number>
```

## Attribution levels

Not all GitHub metadata provides equally strong evidence. Preserve the evidence
level instead of flattening everything into an unqualified tag.

1. **Direct contribution**: files changed by an authored PR.
2. **Direct review**: files on which the owner left inline review comments.
3. **Reviewed PR scope**: other files changed by a PR with a submitted review.
4. **Repository context**: repository languages or configured defaults used only
   when item-level evidence is unavailable.

For example, approving a mixed Rust and Solidity PR supports the fact that both
languages were in the reviewed PR. An inline comment on a Rust file is stronger
evidence of direct Rust review. Generated profiles must retain that distinction.

## Proposed normalized record

```json
{
  "id": "github-pr-wormhole-foundation-native-token-transfers-918",
  "kind": "pull-request",
  "project": "wormhole-foundation/native-token-transfers",
  "number": 918,
  "url": "https://github.com/wormhole-foundation/native-token-transfers/pull/918",
  "title": "Add peer check to the executeMsg (evm)",
  "state": "merged",
  "relations": ["reviewed-pr"],
  "created_at": "...",
  "updated_at": "...",
  "merged_at": "...",
  "head_sha": "...",
  "review": {
    "count": 2,
    "states": ["CHANGES_REQUESTED", "APPROVED"],
    "inline_comment_count": 0,
    "commented_paths": []
  },
  "files": {
    "count": 4,
    "complete": true,
    "paths": ["evm/src/NttManager/NttManager.sol"],
    "language_changes": {"solidity": 103}
  },
  "assertions": [
    {
      "tag": "solidity",
      "category": "language",
      "evidence_level": "reviewed-pr-scope",
      "evidence": ["extension:.sol"]
    },
    {
      "tag": "evm",
      "category": "ecosystem",
      "evidence_level": "reviewed-pr-scope",
      "evidence": ["path-prefix:evm/"]
    }
  ],
  "provenance": {
    "source": "github-api",
    "source_fingerprint": "sha256:...",
    "collector_version": 1
  }
}
```

Do not store review bodies or diff hunks in the normalized public dataset. They
can be large, contain unrelated third-party text, and are unnecessary for
deterministic tagging. A later semantic pass can fetch them into a local cache.

## Pipeline

### 1. Discovery

For every configured repository, query independently for:

```text
repo:OWNER/REPO is:pr author:johnsaigle
repo:OWNER/REPO is:pr reviewed-by:johnsaigle
repo:OWNER/REPO is:issue author:johnsaigle
```

Use `-author:johnsaigle` on the reviewed query when separate authored and
reviewed streams are useful, but merge results by stable PR ID afterward.

GitHub search is capped, so historical backfill should use bounded date windows,
starting with one calendar year and splitting a window further if it approaches
the result limit. Record every completed window in the checkpoint before moving
to the next one.

For incremental collection, query using an overlap window on `updated:` and
upsert by stable ID. The overlap makes the collector tolerant of interrupted
runs and delayed search indexing.

Discovery is only a candidate source. Hydration must verify that the owner's
review endpoint actually contains a submitted review before assigning
`reviewed-pr`.

### 2. Pull-request hydration

Fetch the following endpoints for each discovered PR:

```text
GET /repos/{owner}/{repo}/pulls/{number}
GET /repos/{owner}/{repo}/pulls/{number}/files
GET /repos/{owner}/{repo}/pulls/{number}/reviews
GET /repos/{owner}/{repo}/pulls/{number}/comments
```

Filter reviews and inline comments to `user.login == johnsaigle`. Paginate every
collection. Store review state and dates, but store only paths and counts for
inline comments in the normalized deterministic record.

The files endpoint has an upper bound. Mark `files.complete: false` whenever the
reported changed-file count exceeds the retrieved set. Never silently treat a
partial file list as complete.

### 3. Issue hydration

Fetch issue metadata and labels. Issues normally have no changed-file evidence,
so deterministic classification should be limited to:

- the authored relationship;
- repository context;
- explicitly configured label mappings;
- a linked PR only when GitHub exposes an unambiguous relationship.

Do not infer a programming language from issue prose. That belongs in a later
semantic pass or human override.

### 4. Language extraction

Maintain a versioned extension and special-filename table. Initial examples:

```text
.go        -> go
.rs        -> rust
.sol       -> solidity
.ts/.tsx   -> typescript
.js/.jsx   -> javascript
.move      -> move
.daml      -> daml
.php       -> php
.py        -> python
.sh        -> shell
Dockerfile -> dockerfile
Makefile   -> makefile
```

For each language, preserve:

- number of matching files;
- additions plus deletions;
- matching direct-review paths;
- evidence level.

Do not choose a single language at collection time. Derived profiles may apply
documented thresholds later, while the normalized record retains all observed
facts.

Generated, vendored, lock, binary, and documentation files should be flagged by
rules rather than deleted. This keeps the source observation reproducible while
allowing profiles to exclude low-signal categories.

### 5. Ecosystem and component extraction

Use versioned repository and path rules, for example:

```json
{
  "wormhole-foundation/native-token-transfers": {
    "defaults": ["bridge"],
    "paths": {
      "evm/": ["evm"],
      "solana/": ["solana"],
      "cosmwasm/": ["cosmos"],
      "sui/": ["sui"],
      "cli/src/commands/xrpl/": ["xrpl"]
    }
  }
}
```

Rules may use exact files, path prefixes, extensions, or manifest indicators.
Each assertion must record the rule that produced it. A repository default is
context, while a changed or commented path is item-level evidence.

Path rules should describe what an item touched, not its main purpose. For
example, changing `cli/src/commands/solana.ts` establishes Solana-related scope
but does not establish that the contribution primarily concerned Solana.

### 6. Overrides

Keep rare corrections separate from fetched records:

```json
{
  "github-pr-owner-repo-123": {
    "add_assertions": [],
    "remove_assertions": [],
    "reason": "..."
  }
}
```

Overrides must be reviewable, factual, and include a reason. They should apply
after deterministic rules and before generated aggregation.

### 7. Aggregation

Generate project and career profiles rather than modifying aggregate events in
place. Suggested outputs:

```text
dist/contributions.json
dist/project-profiles.json
dist/contribution-capabilities.json
```

Profiles should expose separate counts for direct contributions, direct review
paths, reviewed PR scope, and repository context. Do not add all contribution
counts directly to the existing event-count capability map: large repositories
would dominate it and the meaning of the visualization would change.

## Checkpoint and cache strategy

Proposed paths:

```text
contributions.jsonl                    normalized, checked in
data/github-enrichment-rules.json      checked in
data/github-enrichment-overrides.json  checked in
.github/enrichment-state.json          checked in
.cache/github-enrichment/              local, ignored
```

Checkpoint state should contain completed backfill windows and the latest
successful incremental timestamp per repository and relationship. Write state
only after normalized output has been written successfully.

Compute `source_fingerprint` from the deterministic source fields that affect a
record, including PR `updated_at`, head SHA, file summaries, owner review states,
and commented paths. Skip normalization and all later processing when the
fingerprint is unchanged.

The collector must be safe to rerun:

- stable IDs;
- deterministic sorting;
- atomic writes through a temporary file;
- overlap windows with deduplication;
- no current timestamp in generated output;
- no rewrite when normalized content is unchanged.

## Proposed implementation units

```text
scripts/github-discover.js       search and checkpoint windows
scripts/github-hydrate.js        fetch normalized GitHub facts
scripts/github-classify.js       deterministic rules only
scripts/render-contributions.js  derived profiles and website JSON
scripts/lib/github.js            paginated API wrapper and rate-limit handling
scripts/lib/contribution-rules.js
```

A single command may orchestrate these units later, but keeping their outputs
separate makes the expensive backfill resumable and testable.

## Basic feasibility tests performed

Tests were run on 2026-10-19 with authenticated `gh api` calls. No backfill or
LLM classification was run.

### Review discovery

```text
repo:wormhole-foundation/native-token-transfers is:pr reviewed-by:johnsaigle
```

returned 76 PRs. Adding `-author:johnsaigle` returned 69, demonstrating that
authored and reviewed relationships can overlap and should be merged rather than
counted as separate items.

The corresponding authored query returned 30 PRs. These numbers are discovery
results, not proposed portfolio statistics; hydration and deduplication still
need to run.

### Repository languages are insufficient

The NTT repository language endpoint reported substantial TypeScript, Solidity,
Rust, and Move content, while the repository's primary language was TypeScript.
This confirms that repository-level language alone is too coarse for a polyglot
codebase.

### Changed files provide clean deterministic tags

- NTT PR #918 changed four files, all under `evm/` and all Solidity files. It
  deterministically supports `solidity` and `evm` at reviewed-PR scope.
- NTT PR #921 changed five TypeScript files under XRPL CLI paths. It
  deterministically supports `typescript` and `xrpl` at reviewed-PR scope.
- NTT PR #923 changed TypeScript, shell, and workflow files and included a
  Solana command path. This demonstrates why raw observations should be retained
  and why path-derived ecosystems should mean “touched,” not “primary topic.”

### Inline comments provide stronger review attribution

The Canton integration PR `wormholelabs-xyz/wormhole#55` changed 85 files. The
GitHub review APIs returned one submitted review and 12 inline comments by the
owner across six unique paths: one workflow file and five Daml source files.
This deterministically supports direct Daml/Canton review evidence without
claiming authorship of the PR.

The review text also contained substantive security reasoning, but interpreting
that reasoning is intentionally outside this deterministic plan.

### Review state is not a security signal

NTT PR #918 had owner reviews with `CHANGES_REQUESTED` and `APPROVED` states but
no inline comments, and the review bodies concerned rebasing and CI. Review
state proves participation, not security relevance or technical subject matter.

## Initial test suite

Before any backfill, implement fixture-based tests that do not call GitHub:

1. Discovery results merge authored and reviewed relationships by stable ID.
2. Pagination preserves all items and deduplicates overlap windows.
3. `.sol` files under `evm/` produce Solidity and EVM assertions.
4. `.ts` files under XRPL paths produce TypeScript and XRPL assertions.
5. Inline-comment paths receive `direct-review`; other PR files receive
   `reviewed-pr-scope`.
6. Authored PR files receive `direct-contribution`.
7. Repository fallback never overwrites stronger evidence.
8. Partial file responses set `files.complete: false`.
9. Unknown extensions remain recorded but do not invent a language.
10. Identical fixtures produce byte-for-byte identical JSONL and profiles.
11. A changed rule version deterministically rebuilds assertions.
12. Overrides add or remove only the assertions they name.

Add a small opt-in integration test that queries one known public PR and checks
only API shape. Keep network tests out of the default test command so CI does not
depend on mutable external data.

## Rollout

1. Define the contribution schema, fixture set, and deterministic rules.
2. Implement discovery with dry-run output and resumable yearly windows.
3. Implement hydration and test on 5–10 representative PRs.
4. Review normalized output and attribution levels before broad collection.
5. Run the one-time repository-by-repository backfill.
6. Add deterministic profiles without changing the existing capability map.
7. Only then design the optional semantic/LLM pass against checkpointed records.
8. Add weekly incremental collection after the backfill output has been reviewed.

The backfill should be a deliberate, separately reviewed operation. Building the
deterministic machinery does not itself authorize running it across all public
contributions.
