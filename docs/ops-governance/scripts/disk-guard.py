#!/usr/bin/env python3
"""disk-guard.py - permanent C: free-space gate (2026-09-02).
Canonical: QNFO/qnfo-ops/scripts/disk-guard.py (mirror .deepchat/scripts).
Root-cause guard for the 2026-09-02 disk bloat finding: backup local copies + temp debris
accumulated silently. A daily local cron (device-bound read, scheduler-guard canonical set)
runs this; on WARN/CRIT it triggers an out-of-band alert through the agent wrapper.
Exit codes: 0=OK 1=WARN(<WARN_GB) 2=CRIT(<CRIT_GB).
"""
import json, shutil, sys

WARN_GB = float(sys.argv[1]) if len(sys.argv) > 1 else 12.0
CRIT_GB = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0

u = shutil.disk_usage("C:/")
free_gb = u.free / 2**30
used_gb = u.used / 2**30
total_gb = u.total / 2**30
pct_free = 100.0 * u.free / u.total

state = "OK" if free_gb >= WARN_GB else ("WARN" if free_gb >= CRIT_GB else "CRIT")
row = {
  "drive": "C:", "state": state, "free_gb": round(free_gb, 2),
  "used_gb": round(used_gb, 2), "total_gb": round(total_gb, 2),
  "pct_free": round(pct_free, 1),
  "warn_gb": WARN_GB, "crit_gb": CRIT_GB,
  "ts": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
}
print(json.dumps(row))
sys.exit(0 if state == "OK" else (1 if state == "WARN" else 2))
