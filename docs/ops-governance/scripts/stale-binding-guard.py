#!/usr/bin/env python3
"""
stale-binding-guard.py — RECURRENCE-ZERO-1 mechanism fix for STALE-BINDING-FAILURE (2026-09-15).

WHY: worker consolidation deleted/merged several workers (qnfo-citation-watch, qnfo-auditor,
personal-life-search, qnfo-errata-*, jnl-referee) but left their [[services]] bindings in
consumers' wrangler.toml. A service binding to a non-existent worker passes local config but
FAILS THE DEPLOY with Cloudflare API code 10144 ("Worker ... was not found"), silently making
the consumer UNREDEPLOYABLE. Found on qnfo-autopilot (blocked redeploy) + 6 more.

WHAT: for every qnfo-workers/<dir>/wrangler.toml, extract `service = "<name>"` under
[[services]] and check it exists in the live worker set. Non-live -> report.

SCOPE: advisory by default (exit 0). Pass --strict to exit 1 when any stale binding is found
(use in CI / a fleet probe). Read-only; never mutates anything.

INVARIANT: the live-worker set is fetched fresh from the Cloudflare API (source of truth),
never a hardcoded list, so this cannot itself drift.
"""
import json
import os
import re
import subprocess
import sys

WORKERS_DIR = os.environ.get("QNFO_WORKERS_DIR", os.path.expanduser("~/Dev/qnfo-workers"))
ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "edb167b78c9fb901ea5bca3ce58ccc4b")


def live_workers():
    """PRECONDITION: CLOUDFLARE_API_TOKEN set. POSTCONDITION: set of live worker names."""
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:
        print("SKIP: CLOUDFLARE_API_TOKEN not set (cannot fetch live workers)")
        return None
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/workers/scripts?per_page=100"
    try:
        out = subprocess.run(
            ["curl", "-s", "-H", f"Authorization: Bearer {token}", url],
            capture_output=True, text=True, timeout=30,
        ).stdout
        data = json.loads(out)
        return {w["id"] for w in data.get("result", [])}
    except Exception as e:  # noqa: BLE001
        print(f"SKIP: live-worker fetch failed: {e}")
        return None


def stale_bindings(live):
    """POSTCONDITION: list of (toml_path, binding_service) whose target is not live."""
    stale = []
    if not os.path.isdir(WORKERS_DIR):
        print(f"SKIP: {WORKERS_DIR} not found")
        return stale
    for d in sorted(os.listdir(WORKERS_DIR)):
        toml = os.path.join(WORKERS_DIR, d, "wrangler.toml")
        if not os.path.isfile(toml):
            continue
        try:
            txt = open(toml, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        # each [[services]] block: collect a following `service = "..."`
        for block in re.split(r"\[\[services\]\]", txt)[1:]:
            m = re.search(r'service\s*=\s*"([^"]+)"', block)
            if m and m.group(1) not in live:
                stale.append((toml, m.group(1)))
    return stale


def do_export_gaps():
    """POSTCONDITION: list of (toml_path, class_name) where wrangler.toml declares a
    [[durable_objects.bindings]] class_name that worker.js does NOT module-level export.
    Catches the qnfo-fleet-control defect (DO class not exported -> wrangler 10061/10099)."""
    gaps = []
    if not os.path.isdir(WORKERS_DIR):
        return gaps
    for d in sorted(os.listdir(WORKERS_DIR)):
        toml = os.path.join(WORKERS_DIR, d, "wrangler.toml")
        js = os.path.join(WORKERS_DIR, d, "worker.js")
        if not (os.path.isfile(toml) and os.path.isfile(js)):
            continue
        try:
            txt = open(toml, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        classes = []
        for block in re.split(r"\[\[durable_objects\.bindings\]\]", txt)[1:]:
            m = re.search(r'class_name\s*=\s*"([^"]+)"', block)
            if m:
                classes.append(m.group(1))
        if not classes:
            continue
        try:
            code = open(js, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        for cn in classes:
            # module-level export of the class AS A BINDING:
            #   `export { X }` / `export { ... X ... }` / `export class X` / `export const X =`
            # NOTE: `export default { X: ... }` does NOT export the binding X (it is a property of a
            # default object), so it is correctly NOT matched (that was the qnfo-fleet-control bug).
            p1 = r"export\s+(?:class|const|let|var|function)\s+" + re.escape(cn) + r"\b"
            p2 = r"export\s*\{[^}]*\b" + re.escape(cn) + r"\b"
            if not (re.search(p1, code) or re.search(p2, code)):
                gaps.append((toml, cn))
    return gaps


def main():
    live = live_workers()
    if live is None:
        return 0
    stale = stale_bindings(live)
    dogaps = do_export_gaps()
    print(f"live workers: {len(live)}")
    rc = 0
    if not stale and not dogaps:
        print("OK: no stale service bindings; no DO-export gaps")
        return 0
    if stale:
        print(f"STALE SERVICE BINDINGS: {len(stale)} (target not in live worker set)")
        for path, svc in stale:
            print(f"  {path} -> {svc}")
        rc = 1
    if dogaps:
        print(f"DO-EXPORT GAPS: {len(dogaps)} (durable_objects class not module-exported)")
        for path, cn in dogaps:
            print(f"  {path} -> class {cn}")
        rc = 1
    return rc if "--strict" in sys.argv else 0


if __name__ == "__main__":
    sys.exit(main())
