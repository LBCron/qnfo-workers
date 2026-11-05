#!/usr/bin/env python3
"""purge-agent-snapshots.py - purge stale agent-snapshot-*.db from %TEMP% (2026-09-06).
Canonical: QNFO/qnfo-ops/scripts/purge-agent-snapshots.py (mirror .deepchat/scripts).
Active-remediation complement to disk-guard.py (which MONITORS free space; this PURGES
the specific leak). Root cause: DeepChat dumps ~1.1GB agent.db snapshots into Temp and
never prunes them, re-bloating C: and driving run_code heartbeat timeouts.
Deletes agent-snapshot-*.db / -settings.db / agent-prune-test.db older than the orphan cutoff.
RM-GATE-H1 (fleet-lessons H1): the cutoff was 24 hours (AGE_HOURS), so a snapshot leaked by a backup killed before its finally block
survived this sweep until the next day and the next backup stacked a second one. The default cutoff is now SNAPSHOT_ORPHAN_MIN_AGE_MIN
(180 minutes): well past a live run, and Windows refuses to delete a file that is open, so a running backup keeps its snapshot.
SNAPSHOT_AGE_HOURS still overrides it (the old knob). backup_agentdb_chunked.py runs the same purge at the start of every run.
Idempotent, exits 0. Safe: canonical agent.db is at
AppData/Roaming/DeepChat/app_db/agent.db and is R2-backed in chunked parts.
Scheduled via Windows task QNFO-Snapshot-Purge (daily 03:00), device-bound write.
"""
import glob, os, sys, time

TEMP = os.environ.get("TEMP") or os.path.join(os.environ.get("LOCALAPPDATA", ""), "Temp")
ORPHAN_MIN_AGE_MIN = float(os.environ.get("SNAPSHOT_ORPHAN_MIN_AGE_MIN") or "180")
AGE_MIN = float(os.environ["SNAPSHOT_AGE_HOURS"]) * 60 if os.environ.get("SNAPSHOT_AGE_HOURS") else ORPHAN_MIN_AGE_MIN
CUTOFF = time.time() - AGE_MIN * 60
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
