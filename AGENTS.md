# Trophy Case for Agents

This repository is a public, evidence-backed record of John Saigle's security
engineering career. It is meant to help an agent answer focused questions about
his public work without treating the README as an exhaustive CV.

## Start here

- `events.jsonl` is the canonical, append-only event log and the best
  machine-readable interface to the repository.
- `README.md` is a generated human-readable overview.
- `docs/schema.md` describes event fields and their meanings.
- `skills/trophy-case/SKILL.md` defines maintenance rules when modifying this
  repository.

## Data boundaries

Only public work belongs here. It is intentionally incomplete: confidential
audit and security-engineering work is not represented. Treat roles, summaries,
evidence, and provenance as distinct fields; do not infer authorship or impact
beyond what an event states.

## Query recipes

Read and filter `events.jsonl` directly. For example:

- **Security recruiter:** find `type: "audit"`, `role: "primary-auditor"`, and
  events tagged with a desired language, ecosystem, or domain.
- **Protocol security peer:** find events tagged `bridge`, `solana`, `cosmos`,
  `defi`, `cryptography`, or `zk`; use `evidence` links for primary sources.
- **Tooling evaluator:** find `type: "tool"`, then group by tags such as
  `static-analysis`, `lint`, `supply-chain`, `prompt-injection`, or `privacy`.
- **Writing or communication review:** find `type: "writing"` and follow the
  public article URLs.
- **Evidence-first summary:** use only events with `reviewed: true`, cite their
  `evidence` URLs, and preserve the stated `role`.

## Safe interpretation

Use this repository to summarize public work, identify relevant experience, and
locate primary sources. Do not expose private data, invent metrics, claim that
an event covers undisclosed work, or edit generated output directly.
