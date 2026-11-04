#!/usr/bin/env python3
"""purge-agent-snapshots.py - purge stale agent-snapshot-*.db from %TEMP% (2026-09-06).
Canonical: QNFO/qnfo-ops/scripts/purge-agent-snapshots.py (mirror .deepchat/scripts).
Active-remediation complement to disk-guard.py (which MONITORS free space; this PURGES
the specific leak). Root cause: DeepChat dumps ~1.1GB agent.db snapshots into Temp and
never prunes them, re-bloating C: and driving run_code heartbeat timeouts.
Deletes agent-snapshot-*.db / -settings.db / agent-prune-test.db older than AGE_HOURS
(default 24). Idempotent, exits 0. Safe: canonical agent.db is at
AppData/Roaming/DeepChat/app_db/agent.db and is R2-backed in chunked parts.
Scheduled via Windows task QNFO-Snapshot-Purge (daily 03:00), device-bound write.
"""
import glob, os, sys, time

TEMP = os.environ.get("TEMP") or os.path.join(os.environ.get("LOCALAPPDATA", ""), "Temp")
AGE_HOURS = float(os.environ.get("SNAPSHOT_AGE_HOURS", "24"))
CUTOFF = time.time() - AGE_HOURS * 3600
PATTERNS = ("agent-snapshot-*.db", "agent-snapshot-*-settings.db", "agent-prune-test.db",
            "agent-snapshot-*.db-wal", "agent-snapshot-*.db-shm")  # 2026-09-30: -wal/-shm included

removed = 0
freed = 0
for pat in PATTERNS:
    for p in glob.glob(os.path.join(TEMP, pat)):
        try:
            st = os.stat(p)
            if st.st_mtime < CUTOFF:
                freed += st.st_size
                os.remove(p)
                removed += 1
        except OSError as e:
            print(f"skip {p}: {e}", file=sys.stderr)

print(f"purged {removed} files, {freed/1e9:.2f} GB")
