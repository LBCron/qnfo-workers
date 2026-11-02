#!/usr/bin/env python3
"""SYNC-VERSION-CAPTURE-1 (issue #1509, AUDIT-PROBE-DEGENERATE-VERSION-NULL-1).

Measured 2026-09-30: worker_live_audit carried live_version = NULL for 110/110
rows, INCLUDING the 5 rows whose note was 'SYNC'. A SYNC row is written by
scripts/fleet-autoaudit.py from the guard's `sync_workers` class, and the guard
(scripts/deploy-drift-guard.py) emitted that class as BARE WORKER-NAME STRINGS:

    sync_workers.append(worker)

so the consumer had no version to write and called

    put(w, 200, None, None, 1, "SYNC")

match=1 therefore proved only that the worker answered /health, NOT that repo and
live versions agreed -- a degenerate pass that silently downgraded every
version-sync check in the fleet (the same defect class as the drift it is meant
to catch: a check that cannot fail).

F1 guard   : emit the {worker, dir, version} object shape every other class uses.
F2 consumer: read the version off the object; keep tolerating the legacy
             bare-string form so an older guard cannot crash the consumer
             (mixed-version safety during rollout).

Fail-closed: exits 1 unless BOTH post-states carry the required predicates.
Idempotent : re-running on an already-patched tree is a no-op.
"""
import os
import subprocess
import sys

ROOT = os.environ.get("REPO_ROOT") or os.getcwd()
GUARD = os.path.join(ROOT, "scripts", "deploy-drift-guard.py")
CONSUMER = os.path.join(ROOT, "scripts", "fleet-autoaudit.py")
MARK = "SYNC-VERSION-CAPTURE-1"

G_OLD = "        else:\n            sync_workers.append(worker)\n"
G_NEW = (
    "        else:\n"
    "            # SYNC-VERSION-CAPTURE-1 (issue 1509): sync_workers used to be bare worker\n"
    "            # name strings, so the consumer had no version to write and\n"
    "            # worker_live_audit.live_version was NULL for every SYNC row -- making\n"
    "            # match=1 indistinguishable from a degenerate liveness pass. Emit the\n"
    "            # {worker,dir,version} object shape used by every other class.\n"
    '            sync_workers.append({"worker": worker, "dir": d, "version": lv})\n'
)

C_OLD = (
    '    for w in d.get("sync_workers", []):\n'
    '        put(w, 200, None, None, 1, "SYNC")\n'
)
C_NEW = (
    '    for it in d.get("sync_workers", []):\n'
    "        # SYNC-VERSION-CAPTURE-1 (issue 1509): sync_workers now carries the version.\n"
    "        # Accept both the object form and the legacy bare-string form so an older guard\n"
    "        # cannot crash this consumer.\n"
    '        _v = it.get("version") if isinstance(it, dict) else None\n'
    '        put(_w(it), 200, _v, _v, 1, "SYNC")\n'
)


def patch(path, old, new, label, already_applied):
    if not os.path.exists(path):
        print("FAIL: %s not found at %s" % (label, path))
        sys.exit(1)
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    if new in src or already_applied(src):
        print("%s: already applied (idempotent no-op)" % label)
        return src
    hits = src.count(old)
    if hits != 1:
        print("FAIL: %s: expected exactly 1 pre-state occurrence, found %d" % (label, hits))
        sys.exit(1)
    src = src.replace(old, new)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(src)
    print("%s: patched" % label)
    return src


def main():
    guard_src = patch(
        GUARD, G_OLD, G_NEW, "deploy-drift-guard.py",
        lambda src: MARK in src
        and 'sync_workers.append({"worker": worker, "dir": d, "version": lv})' in src
        and "sync_workers.append(worker)" not in src,
    )
    cons_src = patch(
        CONSUMER, C_OLD, C_NEW, "fleet-autoaudit.py",
        lambda src: MARK in src
        and '_v = it.get("version") if isinstance(it, dict) else None' in src
        and 'put(_w(it), 200, _v, _v, 1, "SYNC")' in src
        and 'put(w, 200, None, None, 1, "SYNC")' not in src
        and "def _w(it):" in src,
    )

    fails = []

    # --- post-conditions: marker present in both ---------------------------------
    for label, src in (("deploy-drift-guard.py", guard_src),
                       ("fleet-autoaudit.py", cons_src)):
        if MARK not in src:
            fails.append("%s missing marker %s" % (label, MARK))

    # --- guard: object shape emitted, bare-string form gone ----------------------
    if 'sync_workers.append({"worker": worker, "dir": d, "version": lv})' not in guard_src:
        fails.append("guard does not emit the {worker,dir,version} object")
    if "sync_workers.append(worker)" in guard_src:
        fails.append("guard still contains the bare-string append")

    # --- consumer: reads version, still tolerates legacy strings -----------------
    if "_v = it.get(\"version\") if isinstance(it, dict) else None" not in cons_src:
        fails.append("consumer does not read the version off the object")
    if 'put(_w(it), 200, _v, _v, 1, "SYNC")' not in cons_src:
        fails.append("consumer does not put the captured version")
    if 'put(w, 200, None, None, 1, "SYNC")' in cons_src:
        fails.append("consumer still writes the degenerate NULL SYNC row")
    if "def _w(it):" not in cons_src:
        fails.append("consumer lost its _w() resolver (legacy-form tolerance)")

    # --- both files must still parse ---------------------------------------------
    for path in (GUARD, CONSUMER):
        rc = subprocess.call([sys.executable, "-m", "py_compile", path])
        if rc != 0:
            fails.append("py_compile failed for %s" % os.path.basename(path))

    if fails:
        print("SYNC-VERSION-CAPTURE-1: FAIL-CLOSED")
        for f in fails:
            print("  FAIL: %s" % f)
        sys.exit(1)

    print("SYNC-VERSION-CAPTURE-1: APPLIED AND VERIFIED (guard emits version; consumer captures it)")


if __name__ == "__main__":
    main()
