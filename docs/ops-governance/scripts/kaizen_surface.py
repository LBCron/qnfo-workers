#!/usr/bin/env python3
"""
kaizen_surface.py - QNFO.INF.KAIZEN.W10 (2026-08-21)
Pull open high-priority kaizen issues from qnfo-skill-sync and print <=5 one-liners
for the merged Daily Ops job. Report-only; never mutates.

Usage: python C:/Users/LENOVO/.deepchat/scripts/kaizen_surface.py [--limit 5]
Output:
  [KAIZEN-123] <title> (<source>)
  ... or exactly one line: kaizen issues: none open
Exit codes: 0 ok; 1 request failed (job reports failure line).
"""
import sys, json, os, argparse, urllib.request

API = "https://qnfo-skill-sync.q08.workers.dev/issues"

def _token():
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".sync_token")
    try:
        with open(p) as f:
            return f.read().strip()
    except Exception:
        return ""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=5)
    args = ap.parse_args()
    limit = min(max(args.limit, 1), 100)
    url = f"{API}?status=open&priority=high&limit={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "X-Sync-Token": _token()})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"kaizen surface: request failed: {e}", file=sys.stderr)
        sys.exit(1)
    issues = (data or {}).get("issues") or []
    if not issues:
        print("kaizen issues: none open")
        return
    for i in issues[:limit]:
        print(f"[KAIZEN-{i.get('id')}] {i.get('title', 'untitled')} ({i.get('source', '?')})")

if __name__ == "__main__":
    main()
