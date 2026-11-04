#!/usr/bin/env python3
"""
QNFO GitHub Batch Star/Unstar Tool — v1.0

Applies star/unstar operations based on a classification JSON (from star_audit.py).
Supports batch operations across categories with rate limiting.

Usage:
    # Unstar all dump repos
    python star_batch.py --unstar dump --account rwnq8

    # Star recommended repos from a curated list
    python star_batch.py --star star_list.json

    # Dry run (preview only, no changes)
    python star_batch.py --unstar dump --dry-run

Input:
    star_classification.json — output from star_audit.py
        {"agentic_ai": [...], "quantum": [...], "dump": [...], ...}

    Or a simple JSON list for --star mode:
        ["langchain-ai/langgraph", "crewAIInc/crewAI", ...]

Thin-client compliant: git-managed, no local persistence needed.
"""
import subprocess, json, sys, argparse, time


def api_delete(repo):
    """Unstar a repo."""
    r = subprocess.run(
        ["gh", "api", "-X", "DELETE", f"user/starred/{repo}"],
        capture_output=True, text=True, timeout=20
    )
    return r.returncode == 0, r.stderr.strip()


def api_put(repo):
    """Star a repo."""
    r = subprocess.run(
        ["gh", "api", "-X", "PUT", f"user/starred/{repo}",
         "-H", "Content-Length: 0"],
        capture_output=True, text=True, timeout=20
    )
    return r.returncode == 0, r.stderr.strip()


def unstar_batch(repos, dry_run=False):
    """Batch unstar repos."""
    if dry_run:
        print(f"[DRY RUN] Would unstar {len(repos)} repos:")
        for r in sorted(repos):
            print(f"  ✗ {r}")
        return

    ok, not_found, failed = 0, 0, []
    total = len(repos)
    for i, repo in enumerate(sorted(repos)):
        success, err = api_delete(repo)
        if success:
            ok += 1
        elif "404" in err or "Not Found" in err:
            not_found += 1
        else:
            failed.append((repo, err[:100]))

        if (i + 1) % 20 == 0:
            print(f"  [{i+1}/{total}] {ok} unstared, {not_found} not found")

    print(f"\n  Unstarred: {ok}, Not found: {not_found}, Failed: {len(failed)}")
    for r, e in failed[:5]:
        print(f"    FAIL: {r} — {e}")


def star_batch(repos, dry_run=False):
    """Batch star repos."""
    if dry_run:
        print(f"[DRY RUN] Would star {len(repos)} repos:")
        for r in sorted(repos):
            print(f"  ⭐ {r}")
        return

    ok, not_found, failed = 0, 0, []
    for repo in sorted(repos):
        success, err = api_put(repo)
        if success:
            ok += 1
            print(f"  ⭐ {repo}")
        elif "404" in err or "Not Found" in err:
            not_found += 1
            print(f"  - {repo} — not found")
        else:
            failed.append((repo, err[:100]))
            print(f"  ✗ {repo} — {err[:100]}")

    print(f"\n  Starred: {ok}, Not found: {not_found}, Failed: {len(failed)}")


def main():
    parser = argparse.ArgumentParser(description="QNFO Batch Star/Unstar Tool")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--unstar", nargs="+", metavar="CATEGORY",
                       help="Categories to unstar (e.g., dump infra_dump)")
    group.add_argument("--star", nargs="+",
                       help="JSON file(s) or direct repo list to star")
    parser.add_argument("--input", help="Classification JSON from star_audit.py")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    args = parser.parse_args()

    if args.unstar:
        if not args.input:
            print("ERROR: --unstar requires --input <classification.json>")
            sys.exit(1)
        with open(args.input, encoding="utf-8") as f:
            data = json.load(f)
        repos = []
        for cat in args.unstar:
            if cat in data:
                repos.extend(data[cat])
            else:
                print(f"WARNING: category '{cat}' not found in input")
        repos = sorted(set(repos))
        print(f"Unstar: {len(repos)} repos from categories {args.unstar}")
        unstar_batch(repos, args.dry_run)

    elif args.star:
        all_repos = []
        for src in args.star:
            if src.endswith(".json"):
                with open(src, encoding="utf-8") as f:
                    loaded = json.load(f)
                    if isinstance(loaded, list):
                        all_repos.extend(loaded)
                    elif isinstance(loaded, dict):
                        for v in loaded.values():
                            if isinstance(v, list):
                                all_repos.extend(v)
            else:
                # Direct repo name
                all_repos.append(src)
        all_repos = sorted(set(all_repos))
        print(f"Star: {len(all_repos)} repos")
        star_batch(all_repos, args.dry_run)


if __name__ == "__main__":
    main()
