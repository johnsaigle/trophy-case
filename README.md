# Overview

This is a loose archive of security work I've done for open-source projects, including
security engineering and source code reviews.

# Code Review and Security Engineering

## As part of Asymmetric Research

### Wormhole
- [Wormhole Guardian](https://github.com/wormhole-foundation/wormhole/pulls/johnsaigle) (24 open PRs, 113 merged PRs, 7 issues)
- [Native Token Transfers](https://github.com/wormhole-foundation/native-token-transfers/pulls?q=is%3Apr+author%3Ajohnsaigle) (18 merged PRs, 23 issues)
- [Liquidity Layer](https://github.com/wormhole-foundation/example-liquidity-layer/pulls?q=johnsaigle) (7 issues)
- Wormhole Solidity SDK (bug reports): [PR #105](https://github.com/wormhole-foundation/wormhole-solidity-sdk/pull/105), [PR #106](https://github.com/wormhole-foundation/wormhole-solidity-sdk/pull/106)

### M0 Foundation
_(Pull requests labelled "AR" --> Asymmetric Research)_

- [Solana M](https://github.com/m0-foundation/solana-m/pulls?q=is%3Apr+AR+is%3Aclosed) (10 merged PRs)
- [Solana M Extensions](https://github.com/m0-foundation/solana-m-extensions/pulls?q=is%3Apr+%22AR%22) (11 merged PRs)

### Stacks
- [Clarity-Go Parser](https://github.com/stx-labs/clarity-go/issues?q=is%3Aissue%20author%3Ajohnsaigle) (4 issues)

### Commonware
- [Commonware monorepo](https://github.com/commonwarexyz/monorepo/issues?q=is%3Aissue%20author%3Ajohnsaigle) (2 issues)

### Other Projects
- Ghostfolio: Insecure randomness for new passwords ([Discussion #3192](https://github.com/ghostfolio/ghostfolio/discussions/3192), [PR #3196](https://github.com/ghostfolio/ghostfolio/pull/3196))

## McGill University (2015-2020)
[LORIS Neuroimaging Software](https://github.com/aces/Loris/pulls?q=is%3Apr+author%3Ajohnsaigle+is%3Aclosed+label%3A%22Category%3A+Security%22) (407 merged PRs, 207 issues)


# Audit Reports
Formal audit reports for which I was the primary auditor.

| Title | Organization | Type | Programming Language | Link | 
| --- | --- | --- | --- | --- |
 | BoostyLabs Tricorn Bridge Server | BoostyLabs | Bridge, EVM | Go |[📒](https://github.com/HalbornSecurity/PublicReports/blob/master/Cosmos%20Audits/BoostyLabs_Tricorn_Bridge_Server_Golang_Security_Assessment_Report_Halborn_Final.pdf)  |
 | ZetaChain Node Audit | ZetaChain | Cosmos Node Audit, Bridge, Bitcoin, Ethereum | Go, Solidity |[📒](https://drive.google.com/file/d/1323iwH34kOqGzBZIz4iX-Qfo8ACzomNc/view?usp=sharing)  |
| Groth16 Verifier Audit | MystenLabs (Sui Foundation) | Cryptography, ZK | Rust |[📒](https://github.com/johnsaigle/audits/blob/main/pdfs/Groth16.pdf)  |
| Mars Protocol - Custom Modules | Mars Protocol | Cosmos node, Governance, DeFi | Go | [📒](https://github.com/mars-protocol/mars-audits/blob/main/hub/halborn/Mars_Protocol_Custom_Modules_Gov_Incentives_Safety_Cosmos_Security.pdf)
| Maya Node - Audit | MayaChain | Cosmos node | Go | [📒](https://maya-cdn.s3.amazonaws.com/Halborn/Cosmos_Security_Final.pdf) | 
| Maya Node - ETH Router | MayaChain | Cosmos module, DeFi | Go | [📒](https://maya-cdn.s3.amazonaws.com/Halborn/ETH_Router_Draft_3.pdf)  |
| Maya Node - Liquidity Auction | MayaChain | Cosmos module, DeFi | Go | [📒](https://maya-cdn.s3.amazonaws.com/Halborn/Liquidity_Auction_Final.pdf)|
| Sifchain - CLP Update | Sifchain | Cosmos module, DeFi | Go | [📒](https://drive.google.com/drive/u/1/folders/1kkjdpNuRmTjaiIKA6CQISavCvj4Awpbc)|
| Sifchain - Margin | Sifchain | Cosmos module, DeFi | Go | [📒](https://drive.google.com/drive/u/1/folders/1kkjdpNuRmTjaiIKA6CQISavCvj4Awpbc)|

# Technical Writing

Personal website: https://johnsaigle.com

- [Boredom Over Beauty: Why Code Quality is Code Security](https://blog.asymmetric.re/boredom-over-beauty-why-code-quality-is-code-security/)
- [Top 5 Security Vulnerabilities Cosmos Developers Need to Watch Out For](https://www.halborn.com/blog/post/top-5-security-vulnerabilities-cosmos-developers-need-to-watch-out-for)
- [Don’t “Panic”: How Improper Error-Handling Can Lead to Blockchain Hacks](https://www.halborn.com/blog/post/dont-panic-how-improper-error-handling-can-lead-to-blockchain-hacks)
 
# Tools

- [go-unmaintained](https://github.com/johnsaigle/go-unmaintained) -- Find abandoned packages via go.mod. 
- [Anchor version detector](https://github.com/johnsaigle/anchor-version-detector) --  Detect or infer the Anchor, Solana, and Rust versions needed for an Anchor project.
- [Scary Strings](https://github.com/johnsaigle/scary-strings) -- If these strings are in your code, you might have a problem!
- [Oblique Strategies for Hackers](https://github.com/johnsaigle/oblique-strategies-for-hackers) -- A deck of cards created to stimulate and inspire hackers. (Inspired by Brian Eno's project.)
