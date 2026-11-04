#!/usr/bin/env python3
"""
QNFO GitHub Label Manager — v1.0

Creates, clones, and verifies standardized labels across all QNFO program repos.
Labels are defined once and deployed idempotently with --force.

Usage:
    python label_manager.py --verify              # Check label counts across all repos
    python label_manager.py --create             # Create labels on template repo
    python label_manager.py --clone              # Clone template labels to all repos
    python label_manager.py --all                # Create + clone + verify

Label taxonomy (39 labels, 7 groups):
    program:*  — Research program affiliation (color-coded per program)
    type:*     — Work type (paper, audit, infra, bug, feature, docs, kaizen, epic)
    priority:* — Urgency (p0=critical through p3=low)
    phase:*    — WBS phase (p0-p9)
    status:*   — Workflow state (backlog, in-progress, review, blocked, done)
    4d:*       — Distribution status (draft, published, distributed, durable)
    d1:synced  — Cloudflare D1 sync marker

Thin-client compliant: git-managed, no local persistence needed.
"""
import subprocess, json, sys, argparse

TEMPLATE_REPO = "QNFO/qnfo-research"
PROGRAM_REPOS = [
    "QNFO/ultrametric-physics",
    "QNFO/laws-of-form",
    "QNFO/infomatics",
    "QNFO/cfpe",
    "QNFO/qnfo-research",
    "QNFO/qwav-platform",
    "QNFO/qwav-demos",
]

LABELS = {
    # Program labels (distinct colors per program)
    "program:ump":  {"color": "5C4B99", "desc": "Ultrametric Physics"},
    "program:slb":  {"color": "4A90D9", "desc": "Laws of Form"},
    "program:inm":  {"color": "2E8B57", "desc": "Infomatics"},
    "program:cfe":  {"color": "D9464E", "desc": "CFPE — Paradigm Forecasting"},
    "program:res":  {"color": "E67E22", "desc": "QNFO Research"},
    "program:plt":  {"color": "1ABC9C", "desc": "QWAV Platform"},
    "program:dem":  {"color": "9B59B6", "desc": "QWAV Demos"},
    # Type labels
    "type:paper":   {"color": "0366D6", "desc": "Research paper"},
    "type:audit":   {"color": "D73A4A", "desc": "Audit or review"},
    "type:infra":   {"color": "F9D0C4", "desc": "Infrastructure work"},
    "type:bug":     {"color": "B60205", "desc": "Bug report"},
    "type:feature": {"color": "A2EEEF", "desc": "New feature or enhancement"},
    "type:docs":    {"color": "0075CA", "desc": "Documentation"},
    "type:kaizen":  {"color": "BFDADC", "desc": "Continuous improvement"},
    "type:epic":    {"color": "3A2449", "desc": "Epic — large body of work"},
    # Priority
    "priority:p0":  {"color": "B60205", "desc": "Critical — blocking"},
    "priority:p1":  {"color": "D93F0B", "desc": "High — this sprint"},
    "priority:p2":  {"color": "FB8C00", "desc": "Medium — next sprint"},
    "priority:p3":  {"color": "0E8A16", "desc": "Low — backlog"},
    # Phase (WBS-aligned)
    "phase:p0": {"color": "D4C5F9", "desc": "Initiation"},
    "phase:p1": {"color": "D4C5F9", "desc": "Due Diligence"},
    "phase:p2": {"color": "D4C5F9", "desc": "Literature Review"},
    "phase:p3": {"color": "D4C5F9", "desc": "Citations"},
    "phase:p4": {"color": "D4C5F9", "desc": "Deep Research"},
    "phase:p5": {"color": "D4C5F9", "desc": "Publication"},
    "phase:p6": {"color": "D4C5F9", "desc": "Deployment"},
    "phase:p7": {"color": "D4C5F9", "desc": "Dissemination"},
    "phase:p8": {"color": "D4C5F9", "desc": "Core Distribution"},
    "phase:p9": {"color": "D4C5F9", "desc": "Extension"},
    # Status
    "status:backlog":    {"color": "EEEEEE", "desc": "Not yet scheduled"},
    "status:in-progress": {"color": "FBCA04", "desc": "Work in progress"},
    "status:review":     {"color": "1D76DB", "desc": "Under review"},
    "status:blocked":    {"color": "B60205", "desc": "Blocked by dependency"},
    "status:done":       {"color": "0E8A16", "desc": "Complete"},
    # 4-D Distribution
    "4d:draft":       {"color": "C2E0C6", "desc": "Not yet distributed"},
    "4d:published":   {"color": "C2E0C6", "desc": "Published on papers.qnfo.org"},
    "4d:distributed": {"color": "C2E0C6", "desc": "Distributed to IPFS + Arweave"},
    "4d:durable":     {"color": "C2E0C6", "desc": "Zenodo + DNSLink + IA complete"},
    # D1 sync
    "d1:synced": {"color": "5319E7", "desc": "Synced with canonical D1 state"},
}


def create_labels():
    """Create labels on template repo."""
    print(f"Creating {len(LABELS)} labels on {TEMPLATE_REPO}...")
    for name, props in LABELS.items():
        r = subprocess.run([
            "gh", "label", "create", name,
            "--repo", TEMPLATE_REPO,
            "--color", props["color"],
            "--description", props["desc"],
            "--force"
        ], capture_output=True, text=True)
        status = "~" if "Created" not in (r.stdout + r.stderr) else "+"
        print(f"  {status} {name}")


def clone_labels():
    """Clone template labels to all program repos."""
    for repo in PROGRAM_REPOS:
        if repo == TEMPLATE_REPO:
            continue
        print(f"Cloning to {repo}...")
        r = subprocess.run(
            ["gh", "label", "clone", TEMPLATE_REPO, "--repo", repo, "--force"],
            capture_output=True, text=True
        )
        print(f"  {'OK' if r.returncode == 0 else 'ERROR: ' + r.stderr[:80]}")


def verify_labels():
    """Verify label counts across all repos."""
    print(f"{'Repo':35s} {'Custom':>7} {'Total':>7} {'Status'}")
    print("-" * 60)
    all_ok = True
    for repo in PROGRAM_REPOS:
        r = subprocess.run(
            ["gh", "label", "list", "--repo", repo, "--limit", "50", "--json", "name"],
            capture_output=True, text=True
        )
        if r.returncode != 0:
            print(f"{repo:35s} {'—':>7} {'—':>7} ERROR")
            all_ok = False
            continue
        labels = json.loads(r.stdout)
        all_names = [l["name"] for l in labels]
        defaults = {"bug", "documentation", "duplicate", "enhancement",
                     "good first issue", "help wanted", "invalid", "question", "wontfix"}
        custom = [n for n in all_names if n not in defaults]
        ok = "✓" if len(custom) >= 39 else "✗"
        print(f"{repo:35s} {len(custom):>7} {len(all_names):>7} {ok}")
        if len(custom) < 39:
            all_ok = False
    return all_ok


def main():
    parser = argparse.ArgumentParser(description="QNFO Label Manager")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--verify", action="store_true", help="Verify labels across all repos")
    group.add_argument("--create", action="store_true", help="Create labels on template repo")
    group.add_argument("--clone", action="store_true", help="Clone template labels to all repos")
    group.add_argument("--all", action="store_true", help="Create + clone + verify")
    args = parser.parse_args()

    if args.verify:
        ok = verify_labels()
        sys.exit(0 if ok else 1)
    elif args.create:
        create_labels()
    elif args.clone:
        clone_labels()
    elif args.all:
        create_labels()
        clone_labels()
        verify_labels()


if __name__ == "__main__":
    main()
