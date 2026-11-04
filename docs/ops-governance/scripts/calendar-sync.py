#!/usr/bin/env python3
"""calendar-sync.py — Outlook calendar -> JSON for QNFO intent orchestrator ingestion.

Closes CALENDAR-SYNC-TOOL-GAP-1 (2026-08-21): the prior calendar sync cron
(78136b24) failed at its 300s cap because this durable script did not exist
anywhere. Canonical home: QNFO/qnfo-ops scripts/calendar-sync.py (mirror:
C:/Users/LENOVO/.deepchat/scripts/calendar-sync.py).

v1.1 (2026-09-02, R2/R5 closeout): per-item failures are COUNTED (no silent
except:continue), the 30-item cap sets truncated=true, and event start times are
offset-aware ISO (no naive-local ambiguity vs the UTC orchestrator). A clean zero
is count==0 AND failures==0 AND truncated==false.

Output contract (v1.1):
  {"ok": true, "count": N, "failures": M, "truncated": bool,
   "horizon_start": <aware ISO>, "horizon_end": <aware ISO>,
   "events": [{"subject","start","duration_min","location","all_day"}]}
  ok:false is emitted only on fatal errors (exit 2/3). failures>0 means M items
  could not be read (partial, still ok:true). truncated=true means more events
  exist beyond the 30-item cap.

Usage:
    python calendar-sync.py [days] [--pretty]
    python calendar-sync.py 14      # next 14 days, compact JSON on stdout
Exit codes: 0 = ok (partial failures reported in the "failures" field),
            2 = Outlook/pywin32 unavailable, 3 = unexpected error.
"""
import sys, json
from datetime import datetime, timedelta

try:
    import win32com.client
except ImportError:
    print(json.dumps({"ok": False, "error": "pywin32 not installed"}))
    sys.exit(2)

MAX_EVENTS = 30


def get_upcoming_events(days):
    outlook = win32com.client.Dispatch("Outlook.Application")
    ns = outlook.GetNamespace("MAPI")
    cal = ns.GetDefaultFolder(9)  # olFolderCalendar
    items = cal.Items
    items.IncludeRecurrences = True
    items.Sort("[Start]")
    tz = datetime.now().astimezone().tzinfo   # local timezone, offset-aware
    now_local = datetime.now().astimezone()
    horizon = now_local + timedelta(days=int(days))
    events = []
    failures = 0
    truncated = False
    for it in items:
        try:
            start = it.Start
            if isinstance(start, str):
                start = datetime.fromisoformat(start.replace("Z", "+00:00"))
            if start.tzinfo is None:
                start = start.replace(tzinfo=tz)   # Outlook naive = local wall time
            if start < now_local:
                continue
            if start > horizon:
                break
            events.append({
                "subject": str(it.Subject or "").strip(),
                "start": start.isoformat(),         # offset-aware, e.g. +02:00
                "duration_min": int(it.Duration or 0),
                "location": str(it.Location or "").strip(),
                "all_day": bool(it.AllDayEvent),
            })
            if len(events) >= MAX_EVENTS:
                truncated = True
                break
        except Exception as e:
            failures += 1
    return events, failures, truncated, now_local, horizon


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 14
    try:
        events, failures, truncated, now_local, horizon = get_upcoming_events(days)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(3)
    print(json.dumps({
        "ok": True,
        "count": len(events),
        "failures": failures,
        "truncated": truncated,
        "horizon_start": now_local.isoformat(),
        "horizon_end": horizon.isoformat(),
        "events": events,
    }, indent=2))


if __name__ == "__main__":
    main()
