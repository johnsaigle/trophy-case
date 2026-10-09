# Overview

This is a loose archive of security work I've done for open-source projects, including
security engineering and source code reviews.

> **9 audits · 96 published findings (5 critical, 13 high, 12 medium, 44 low, 22 informational) · 4 articles · 5 security tools**

> **Note:** this is a best-effort list of *public* work only. Much of my audit
> and security engineering output is under confidentiality agreement and cannot be listed.

<!-- GENERATED from events.jsonl by scripts/render.js — do not edit sections below by hand. -->

# Code Review and Security Engineering

## As part of Asymmetric Research

### Wormhole

- [Wormhole Guardian](https://github.com/wormhole-foundation/wormhole/pulls/johnsaigle) (179 merged PRs, 9 issues, 112 reviews in 2026)
- [Review: Canton chain integration](https://github.com/wormholelabs-xyz/wormhole/pull/55)
  Substantial review and design feedback on the Canton integration PR (developed on the WormholeLabs fork).
- [Wormhole Native Token Transfers](https://github.com/wormhole-foundation/native-token-transfers/pulls?q=is%3Apr+author%3Ajohnsaigle) (18 merged PRs, 25 issues, 11 reviews in 2026)
- [Wormhole Liquidity Layer](https://github.com/wormhole-foundation/example-liquidity-layer/pulls?q=johnsaigle) (7 issues)
- [Wormhole Solidity SDK bug reports](https://github.com/wormhole-foundation/wormhole-solidity-sdk/pull/105)

### M0 Foundation

_(Pull requests labelled "AR" --> Asymmetric Research)_

- [Solana M](https://github.com/m0-foundation/solana-m/pulls?q=is%3Apr+AR+is%3Aclosed) (10 merged PRs)
- [Solana M Extensions](https://github.com/m0-foundation/solana-m-extensions/pulls?q=is%3Apr+%22AR%22) (11 merged PRs)
- [Solana M: claim yield calculation walked incomplete index history](https://github.com/m0-foundation/solana-m/pull/186)

### Stacks

- [Clarity-Go Parser](https://github.com/stx-labs/clarity-go/issues?q=is%3Aissue%20author%3Ajohnsaigle) (4 issues)

### Commonware

- [Commonware monorepo](https://github.com/commonwarexyz/monorepo/issues?q=is%3Aissue%20author%3Ajohnsaigle) (2 issues)

## McGill University (2015-2020)

- [LORIS Neuroimaging Software](https://github.com/aces/Loris/pulls?q=is%3Apr+author%3Ajohnsaigle+is%3Aclosed+label%3A%22Category%3A+Security%22) (407 merged PRs, 207 issues)

## Independent Projects

- [Ghostfolio: insecure randomness for new passwords](https://github.com/ghostfolio/ghostfolio/discussions/3192)
  Password generation used insecure randomness; reported and fixed via PR.

# Audit Reports

Formal audit reports for which I was the primary auditor.

| Title | Organization | Type | Programming Language | Link |
| --- | --- | --- | --- | --- |
| Tricorn Bridge Server Security Assessment | BoostyLabs | EVM, Bridge | Go | [📒](https://github.com/HalbornSecurity/PublicReports/blob/master/Cosmos%20Audits/BoostyLabs_Tricorn_Bridge_Server_Golang_Security_Assessment_Report_Halborn_Final.pdf) |
| Maya Node Security Audit | MayaChain | Cosmos, Node | Go | [📒](https://maya-cdn.s3.amazonaws.com/Halborn/Cosmos_Security_Final.pdf) |
| Groth16 Verifier Audit | Mysten Labs (Sui Foundation) | Cryptography, ZK | Rust | [📒](https://github.com/johnsaigle/audits/blob/main/pdfs/Groth16.pdf) |
| ZetaChain Node Security Audit | ZetaChain | Cosmos, Bridge, Bitcoin | Go, Solidity | [📒](https://drive.google.com/file/d/1323iwH34kOqGzBZIz4iX-Qfo8ACzomNc/view) |
| Maya Node Liquidity Auction Audit | MayaChain | Cosmos, DeFi | Go | [📒](https://maya-cdn.s3.amazonaws.com/Halborn/Liquidity_Auction_Final.pdf) |
| Mars Protocol Custom Modules Audit (Governance, Incentives, Safety) | Mars Protocol | Cosmos, Governance, DeFi | Go | [📒](https://github.com/mars-protocol/mars-audits/blob/main/hub/halborn/Mars_Protocol_Custom_Modules_Gov_Incentives_Safety_Cosmos_Security.pdf) |
| Sifchain CLP Update Audit | Sifchain | Cosmos, DeFi | Go | [📒](https://drive.google.com/drive/u/1/folders/1kkjdpNuRmTjaiIKA6CQISavCvj4Awpbc) |
| Sifchain Margin Audit | Sifchain | Cosmos, DeFi | Go | [📒](https://drive.google.com/drive/u/1/folders/1kkjdpNuRmTjaiIKA6CQISavCvj4Awpbc) |
| Maya Node ETH Router Audit | MayaChain | Cosmos, DeFi | Go | [📒](https://maya-cdn.s3.amazonaws.com/Halborn/ETH_Router_Draft_3.pdf) |

# Technical Writing

Personal website: https://johnsaigle.com

## Asymmetric Research

- [Boredom Over Beauty: Why Code Quality is Code Security](https://blog.asymmetric.re/boredom-over-beauty-why-code-quality-is-code-security/)
- [Solana Vulnerabilities That Aren't — Unpacking Common Misreports](https://blog.asymmetric.re/solana-vulnerabilities-that-arent-unpacking-common-misreports/)

## Halborn

- [Top 5 Security Vulnerabilities Cosmos Developers Need to Watch Out For](https://www.halborn.com/blog/post/top-5-security-vulnerabilities-cosmos-developers-need-to-watch-out-for)
- [Don't “Panic”: How Improper Error-Handling Can Lead to Blockchain Hacks](https://www.halborn.com/blog/post/dont-panic-how-improper-error-handling-can-lead-to-blockchain-hacks)

# Tools

- [locked-in](https://github.com/asymmetric-research/locked-in) -- lint for unsafe package installation patterns
- [go-unmaintained](https://github.com/johnsaigle/go-unmaintained) -- find abandoned packages via go.mod
- [Anchor version detector](https://github.com/johnsaigle/anchor-version-detector)
- [Scary Strings](https://github.com/johnsaigle/scary-strings) -- dangerous-function wordlists
- [Oblique Strategies for Hackers](https://github.com/johnsaigle/oblique-strategies-for-hackers)
