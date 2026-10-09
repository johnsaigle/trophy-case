#!/usr/bin/env python3
"""One-time backfill: generate events.jsonl from pdfs/*.pdf + manual seed entries.

Requires: pdftotext, python3. Run from repo root: python3 scripts/backfill.py
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "pdfs"
OUT = ROOT / "events.jsonl"
EXTRACTED_AT = "2026-10-06"

# ---------------------------------------------------------------- report metadata

REPORTS = {
    "BoostyLabs_Tricorn_Bridge_Server_Golang_Security_Assessment_Report_Halborn_Final.pdf": {
        "id": "audit-boostylabs-tricorn-2023",
        "title": "Tricorn Bridge Server Security Assessment",
        "client": "BoostyLabs",
        "date": "2023-08-06",
        "tags": ["evm", "bridge", "go"],
        "url": "https://github.com/HalbornSecurity/PublicReports/blob/master/Cosmos%20Audits/BoostyLabs_Tricorn_Bridge_Server_Golang_Security_Assessment_Report_Halborn_Final.pdf",
    },
    "Cosmos_Security_Final.pdf": {
        "id": "audit-mayachain-node-2023",
        "title": "Maya Node Security Audit",
        "client": "MayaChain",
        "date": "2023-01-25",
        "tags": ["cosmos", "go", "node"],
        "url": "https://maya-cdn.s3.amazonaws.com/Halborn/Cosmos_Security_Final.pdf",
    },
    "Groth16.pdf": {
        "id": "audit-groth16-verifier-2023",
        "title": "Groth16 Verifier Audit",
        "client": "Mysten Labs (Sui Foundation)",
        "date": "2023-05-12",
        "tags": ["cryptography", "zk", "rust"],
        "url": "https://github.com/johnsaigle/audits/blob/main/pdfs/Groth16.pdf",
    },
    "Halborn_ZetaNode_Cosmos_Security_Audit_Report.pdf": {
        "id": "audit-zetachain-node-2023",
        "title": "ZetaChain Node Security Audit",
        "client": "ZetaChain",
        "date": "2023-03-31",
        "tags": ["cosmos", "go", "solidity", "bridge", "bitcoin"],
        "url": "https://drive.google.com/file/d/1323iwH34kOqGzBZIz4iX-Qfo8ACzomNc/view",
    },
    "Liquidity_Auction_Final.pdf": {
        "id": "audit-mayachain-liquidity-auction-2023",
        "title": "Maya Node Liquidity Auction Audit",
        "client": "MayaChain",
        "date": "2023-01-18",
        "tags": ["cosmos", "go", "defi"],
        "url": "https://maya-cdn.s3.amazonaws.com/Halborn/Liquidity_Auction_Final.pdf",
    },
    "Mars_Protocol_Custom_Modules_Gov_Incentives_Safety_Cosmos_Security.pdf": {
        "id": "audit-mars-protocol-custom-modules-2022",
        "title": "Mars Protocol Custom Modules Audit (Governance, Incentives, Safety)",
        "client": "Mars Protocol",
        "date": "2022-11-24",
        "tags": ["cosmos", "go", "governance", "defi"],
        "url": "https://github.com/mars-protocol/mars-audits/blob/main/hub/halborn/Mars_Protocol_Custom_Modules_Gov_Incentives_Safety_Cosmos_Security.pdf",
    },
    "Sifchain_CLP_Update_Cosmos_Security_Audit_Report_Halborn_Final.pdf": {
        "id": "audit-sifchain-clp-update-2022",
        "title": "Sifchain CLP Update Audit",
        "client": "Sifchain",
        "date": "2022-07-08",
        "tags": ["cosmos", "go", "defi"],
        "url": "https://drive.google.com/drive/u/1/folders/1kkjdpNuRmTjaiIKA6CQISavCvj4Awpbc",
    },
    "Sifchain_Margin_Cosmos_Security_Audit_Report_Halborn_Final.pdf": {
        "id": "audit-sifchain-margin-2022",
        "title": "Sifchain Margin Audit",
        "client": "Sifchain",
        "date": "2022-09-08",
        "tags": ["cosmos", "go", "defi"],
        "url": "https://drive.google.com/drive/u/1/folders/1kkjdpNuRmTjaiIKA6CQISavCvj4Awpbc",
    },
}

# Audit listed in README but no local PDF: seed manually, no findings.
EXTRA_AUDITS = [
    {
        "id": "audit-mayachain-eth-router-2022",
        "type": "audit",
        "date": None,
        "date_hint": "2022",
        "title": "Maya Node ETH Router Audit",
        "org": "Halborn",
        "client": "MayaChain",
        "role": "primary-auditor",
        "tags": ["cosmos", "go", "defi"],
        "evidence": [{"kind": "url", "url": "https://maya-cdn.s3.amazonaws.com/Halborn/ETH_Router_Draft_3.pdf"}],
        "notability": 4,
        "provenance": {"source": "manual", "extracted_at": EXTRACTED_AT},
        "reviewed": True,
    }
]

# ---------------------------------------------------------------- finding parsing

ENTRY = re.compile(r"^\s*(\d+\.\d+)\s+\((HAL-\d+)\)\s+(.*)$")
SEV = re.compile(r"[-\s(]*(CRITICAL|HIGH|MEDIUM|LOW|INFORMATIONAL)\b\s*(?:\((\d+(?:\.\d+)?)\))?\s*$", re.I)
STATUS = re.compile(
    r"(CRITICAL|HIGH|MEDIUM|LOW|INFORMATIONAL)\s+"
    r"(SOLVED|ACKNOWLEDGED|RISK ACCEPTED|PARTIALLY SOLVED)(?:\s*-\s*(\d{2}/\d{2}/\d{4}))?", re.I)

CLASS_RULES = [
    (r"division by zero|overflow|integer|arithmetic|satoshis|calculation error", "arithmetic"),
    (r"denial.of.service|memory exhaustion|unbounded|rate limiting|sybil", "dos"),
    (r"allow.?list|access control|authorization|permission|mnemonic|private key|signing", "access-control"),
    (r"validat|missing function parameter|input", "validation"),
    (r"vulnerable (dependency|packages|components|3rd party)|outdated|unsupported|deprecated|md5|insecure hash|hard.?cod", "supply-chain"),
    (r"non.determinism|iteration over map", "determinism"),
    (r"panic|unhandled error|unchecked error|error handling|error condition|fails silently", "error-handling"),
    (r"unit tests|fuzz|test", "testing"),
    (r"spelling|typo|todo|misleading|documentation|readme|naming", "documentation"),
    (r"cryptograph|signature|hash collision|groth16|zk|randomness", "crypto"),
    (r"cors|unencrypted|password|traffic|web server|grpc|api", "config"),
]


def classify(title: str) -> str:
    t = title.lower()
    for pattern, cls in CLASS_RULES:
        if re.search(pattern, t):
            return cls
    return "other"


def parse_report(pdf: Path, tmp: Path) -> tuple[dict, dict]:
    txt = tmp / (pdf.stem + ".txt")
    subprocess.run(["pdftotext", "-layout", str(pdf), str(txt)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    raw = txt.read_text(errors="replace").splitlines()
    toc = [re.sub(r"\s+\d+\s*$", "", ln) for ln in raw[:450]]  # strip TOC page numbers

    findings, cur = {}, None
    for ln in toc:
        m = ENTRY.match(ln)
        if m:
            if cur and cur["fid"] not in findings:
                findings[cur["fid"]] = cur["f"]
            cur = {"fid": m.group(2), "f": {"title": m.group(3).strip(), "severity": None, "score": None}}
            sm = SEV.search(cur["f"]["title"])
            if sm:
                cur["f"]["title"] = SEV.sub("", cur["f"]["title"]).strip(" -(")
                cur["f"]["severity"] = sm.group(1).title()
                cur["f"]["score"] = float(sm.group(2)) if sm.group(2) else None
        elif cur and cur["f"]["severity"] is None and ln.strip():
            sm = SEV.search(ln)
            if sm:
                cur["f"]["title"] = re.sub(r"\s+", " ", cur["f"]["title"] + " " + SEV.sub("", ln).strip(" -(")).strip()
                cur["f"]["severity"] = sm.group(1).title()
                cur["f"]["score"] = float(sm.group(2)) if sm.group(2) else None
            else:
                cur["f"]["title"] += " " + ln.strip()
    if cur and cur["fid"] not in findings:
        findings[cur["fid"]] = cur["f"]
    findings = {k: v for k, v in findings.items() if v["severity"]}

    statuses = {}
    text = "\n".join(raw)
    for sm in STATUS.finditer(text):
        statuses[sm.group(1).upper()] = sm.group(2).lower().replace(" ", "-")
    return findings, statuses


def titlecase_title(t: str) -> str:
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s*-\s*$", "", t)
    return t.capitalize() if t.isupper() else t


def audit_event(pdf: Path, meta: dict, tmp: Path) -> dict:
    findings, statuses = parse_report(pdf, tmp)
    sev_order = ["critical", "high", "medium", "low", "informational"]
    counts = {s: 0 for s in sev_order}
    out_findings = []
    for fid, f in sorted(findings.items(), key=lambda kv: int(kv[0].split("-")[1])):
        sev = f["severity"].lower()
        counts[sev] += 1
        out_findings.append({
            "id": fid,
            "title": titlecase_title(f["title"]),
            "severity": sev,
            "score": f["score"],
            "remediation": statuses.get(sev.upper(), "unknown"),
            "class": classify(f["title"]),
        })
    counts = {k: v for k, v in counts.items() if v}
    top = next((s for s in sev_order if counts.get(s)), None)
    return {
        "id": meta["id"],
        "type": "audit",
        "date": meta["date"],
        "title": meta["title"],
        "org": "Halborn",
        "client": meta["client"],
        "role": "primary-auditor",
        "summary": None,
        "evidence": [
            {"kind": "pdf", "path": f"pdfs/{pdf.name}"},
            {"kind": "url", "url": meta["url"]},
        ],
        "tags": meta["tags"],
        "severity": top,
        "notability": 5 if top in ("critical", "high") else 4,
        "provenance": {"source": "pdf-parse", "extracted_at": EXTRACTED_AT, "confidence": 0.9},
        "reviewed": True,
        "audit": {"counts": counts, "findings": out_findings},
    }


# ---------------------------------------------------------------- manual seed

def ev(id_, type_, title, *, date=None, date_hint=None, org=None, project=None,
       tags=None, notability=3, summary=None, evidence=None, severity=None,
       code_review=None, role=None):
    e = {
        "id": id_, "type": type_, "date": date, "title": title, "org": org,
        "project": project, "role": role, "summary": summary,
        "evidence": evidence or [], "tags": tags or [], "severity": severity,
        "notability": notability,
        "provenance": {"source": "manual", "extracted_at": EXTRACTED_AT},
        "reviewed": True,
    }
    if date_hint:
        e["date_hint"] = date_hint
    if code_review:
        e["code_review"] = code_review
    return e


MANUAL = [
    ev("code-review-wormhole-guardian", "code-review", "Wormhole Guardian",
       org="Asymmetric Research", project="wormhole-foundation/wormhole",
       tags=["rust", "cosmos", "bridge"], notability=4, role="core-contributor",
       summary="Lead maintainer and security reviewer for the Wormhole Guardian network.",
       code_review={"prs_merged": 179, "issues": 9, "reviews_ytd": 112},
       evidence=[{"kind": "url", "url": "https://github.com/wormhole-foundation/wormhole/pulls/johnsaigle"}]),
    ev("review-canton-integration-draft", "review", "Review: Canton chain integration",
       org="Asymmetric Research", project="wormhole-foundation/wormhole",
       date="2026-08-06", tags=["canton", "bridge", "rust"], notability=4,
       role="reviewer",
       summary="Substantial review and design feedback on the Canton integration PR (developed on the WormholeLabs fork).",
       evidence=[{"kind": "url", "url": "https://github.com/wormholelabs-xyz/wormhole/pull/55", "state": "open"}]),
    ev("code-review-wormhole-ntt", "code-review", "Wormhole Native Token Transfers",
       org="Asymmetric Research", project="wormhole-foundation/native-token-transfers",
       tags=["solidity", "rust", "bridge"], notability=4, role="reviewer",
       code_review={"prs_merged": 18, "issues": 25, "reviews_ytd": 11},
       evidence=[{"kind": "url", "url": "https://github.com/wormhole-foundation/native-token-transfers/pulls?q=is%3Apr+author%3Ajohnsaigle"}]),
    ev("code-review-wormhole-liquidity-layer", "code-review", "Wormhole Liquidity Layer",
       org="Asymmetric Research", project="wormhole-foundation/example-liquidity-layer",
       tags=["solidity", "defi"], notability=3, role="reviewer",
       code_review={"issues": 7},
       evidence=[{"kind": "url", "url": "https://github.com/wormhole-foundation/example-liquidity-layer/pulls?q=johnsaigle"}]),
    ev("bug-report-wormhole-solidity-sdk", "bug-report", "Wormhole Solidity SDK bug reports",
       org="Asymmetric Research", project="wormhole-foundation/wormhole-solidity-sdk",
       tags=["solidity"], notability=4, role="reporter",
       evidence=[
           {"kind": "url", "url": "https://github.com/wormhole-foundation/wormhole-solidity-sdk/pull/105"},
           {"kind": "url", "url": "https://github.com/wormhole-foundation/wormhole-solidity-sdk/pull/106"},
       ]),
    ev("code-review-m0-solana-m", "code-review", "Solana M",
       org="Asymmetric Research", project="m0-foundation/solana-m",
       tags=["solana", "rust", "stablecoin"], notability=4, role="reviewer",
       code_review={"prs_merged": 10},
       evidence=[{"kind": "url", "url": "https://github.com/m0-foundation/solana-m/pulls?q=is%3Apr+AR+is%3Aclosed"}]),
    ev("code-review-m0-solana-m-extensions", "code-review", "Solana M Extensions",
       org="Asymmetric Research", project="m0-foundation/solana-m-extensions",
       tags=["solana", "rust"], notability=3, role="reviewer",
       code_review={"prs_merged": 11},
       evidence=[{"kind": "url", "url": "https://github.com/m0-foundation/solana-m-extensions/pulls?q=is%3Apr+%22AR%22"}]),
    ev("code-review-clarity-go-parser", "code-review", "Clarity-Go Parser",
       org="Asymmetric Research", project="stx-labs/clarity-go",
       tags=["go", "stacks"], notability=3, role="reporter",
       code_review={"issues": 4},
       evidence=[{"kind": "url", "url": "https://github.com/stx-labs/clarity-go/issues?q=is%3Aissue%20author%3Ajohnsaigle"}]),
    ev("code-review-commonware", "code-review", "Commonware monorepo",
       org="Asymmetric Research", project="commonwarexyz/monorepo",
       tags=["rust", "infra"], notability=3, role="reporter",
       code_review={"issues": 2},
       evidence=[{"kind": "url", "url": "https://github.com/commonwarexyz/monorepo/issues?q=is%3Aissue%20author%3Ajohnsaigle"}]),
    ev("bug-report-ghostfolio-insecure-randomness", "bug-report", "Ghostfolio: insecure randomness for new passwords",
       project="ghostfolio/ghostfolio", tags=["typescript", "web"], notability=3,
       severity="medium", role="reporter",
       summary="Password generation used insecure randomness; reported and fixed via PR.",
       evidence=[
           {"kind": "url", "url": "https://github.com/ghostfolio/ghostfolio/discussions/3192"},
           {"kind": "url", "url": "https://github.com/ghostfolio/ghostfolio/pull/3196"},
       ]),
    ev("code-review-loris-mcgill", "code-review", "LORIS Neuroimaging Software",
       org="McGill University", project="aces/Loris", date_hint="2015-2020",
       tags=["php", "web", "healthcare"], notability=3, role="reviewer",
       code_review={"prs_merged": 407, "issues": 207},
       evidence=[{"kind": "url", "url": "https://github.com/aces/Loris/pulls?q=is%3Apr+author%3Ajohnsaigle+is%3Aclosed+label%3A%22Category%3A+Security%22"}]),
    ev("writing-boredom-over-beauty", "writing", "Boredom Over Beauty: Why Code Quality is Code Security",
       org="Asymmetric Research", tags=["blog"], notability=3, role="author",
       evidence=[{"kind": "url", "url": "https://blog.asymmetric.re/boredom-over-beauty-why-code-quality-is-code-security/"}]),
    ev("writing-solana-vulns-that-arent", "writing", "Solana Vulnerabilities That Aren't — Unpacking Common Misreports",
       org="Asymmetric Research", tags=["blog", "solana"], notability=3, role="author",
       evidence=[{"kind": "url", "url": "https://blog.asymmetric.re/solana-vulnerabilities-that-arent-unpacking-common-misreports/"}]),
    ev("writing-top5-cosmos-vulns", "writing", "Top 5 Security Vulnerabilities Cosmos Developers Need to Watch Out For",
       org="Halborn", tags=["blog", "cosmos"], notability=3, role="author",
       evidence=[{"kind": "url", "url": "https://www.halborn.com/blog/post/top-5-security-vulnerabilities-cosmos-developers-need-to-watch-out-for"}]),
    ev("writing-dont-panic", "writing", "Don't \u201cPanic\u201d: How Improper Error-Handling Can Lead to Blockchain Hacks",
       org="Halborn", tags=["blog"], notability=3, role="author",
       evidence=[{"kind": "url", "url": "https://www.halborn.com/blog/post/dont-panic-how-improper-error-handling-can-lead-to-blockchain-hacks"}]),
    ev("tool-locked-in", "tool", "locked-in — lint for unsafe package installation patterns",
       org="Asymmetric Research", project="asymmetric-research/locked-in",
       tags=["supply-chain", "lint"], notability=3, role="author",
       evidence=[{"kind": "url", "url": "https://github.com/asymmetric-research/locked-in"}]),
    ev("tool-go-unmaintained", "tool", "go-unmaintained — find abandoned packages via go.mod",
       project="johnsaigle/go-unmaintained", tags=["supply-chain", "go"], notability=3, role="author",
       evidence=[{"kind": "url", "url": "https://github.com/johnsaigle/go-unmaintained"}]),
    ev("tool-anchor-version-detector", "tool", "Anchor version detector",
       project="johnsaigle/anchor-version-detector", tags=["solana", "anchor"], notability=2, role="author",
       evidence=[{"kind": "url", "url": "https://github.com/johnsaigle/anchor-version-detector"}]),
    ev("tool-scary-strings", "tool", "Scary Strings — dangerous-function wordlists",
       project="johnsaigle/scary-strings", tags=["static-analysis"], notability=3, role="author",
       evidence=[{"kind": "url", "url": "https://github.com/johnsaigle/scary-strings"}]),
    ev("tool-oblique-strategies", "tool", "Oblique Strategies for Hackers",
       project="johnsaigle/oblique-strategies-for-hackers", tags=["fun"], notability=2, role="author",
       evidence=[{"kind": "url", "url": "https://github.com/johnsaigle/oblique-strategies-for-hackers"}]),
]


def main() -> None:
    if not shutil.which("pdftotext"):
        sys.exit("pdftotext not found")
    tmp = Path("/tmp/opencode/trophy-backfill")
    tmp.mkdir(parents=True, exist_ok=True)

    events = []
    for pdf in sorted(PDF_DIR.glob("*.pdf")):
        meta = REPORTS.get(pdf.name)
        if not meta:
            print(f"WARNING: no metadata for {pdf.name}, skipping", file=sys.stderr)
            continue
        events.append(audit_event(pdf, meta, tmp))
    events += EXTRA_AUDITS + MANUAL

    seen = set()
    with OUT.open("w") as f:
        for e in events:
            if e["id"] in seen:
                sys.exit(f"duplicate id: {e['id']}")
            seen.add(e["id"])
            f.write(json.dumps(e, ensure_ascii=False) + "\n")

    n_findings = sum(len(e.get("audit", {}).get("findings", [])) for e in events)
    print(f"Wrote {len(events)} events ({n_findings} findings) to {OUT}")


if __name__ == "__main__":
    main()
