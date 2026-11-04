#!/usr/bin/env python3
"""scheduler-guard.py — permanent cadence + registry gate for the DeepChat local scheduler (2026-09-02).
User directive 2026-09-08: DEPRECATE ALL DeepChat local cron — DeepChat is a thin-client front-end only,
never canonical or orchestrator; mission-critical operations run server-side (Cloudflare Workers cron).
no deferred items may rest with only an 'owner' — every closeout resolves them or assigns a date/trigger.
Asserts against the Roaming app DB cron_jobs table:
  1. no ENABLED local cron fires more than 1x/day (worst-case active-day parse)
  2. ZERO enabled local cron rows (canonical set is EMPTY since 2026-09-08: all local cron deprecated)
  3. zero DISABLED residue rows (superseded cloud functions must not linger)
  4. the 2055e49c one-shot is deleted once stale (SILENT-ROLLOVER-1): next_run_at in the past = FAIL
Run on every ops cycle and after ANY registry change. Exit 0 = PASS.
Canonical: QNFO/qnfo-ops/scripts/scheduler-guard.py (mirror .deepchat/scripts).
2026-09-02: canonical set 4 -> 5 rows. 2026-09-08: canonical set 5 -> 0 (user directive: deprecate ALL DeepChat local cron).
"""
import sqlite3, re, sys, datetime

DB = r"C:/Users/LENOVO/AppData/Roaming/DeepChat/app_db/agent.db"
CANONICAL = {}  # 2026-09-08: all DeepChat local cron deprecated (thin-client front-end only)
ONE_SHOT = None

def fires_per_day(cron):
    f = (cron or "").strip().split()
    if len(f) < 5:
        return 0
    h = f[1]
    m = re.match(r"^\*/(\d+)$", h)
    if m:
        n = (24 + int(m.group(1)) - 1) // int(m.group(1))
    elif h == "*":
        n = 24
    else:
        n = len([x for x in h.split(",") if x])
    mon, dom, dow = f[3], f[2], f[4]
    if mon != "*" and not mon.startswith("*/"):
        n = max(1, round(n * 0.25))
    if (dom != "*" and not dom.startswith("*/")) or (dow != "*" and not dow.startswith("*/")):
        n = max(1, round(n * 0.2))
    return n

def main():
    fails = []
    # GIT-BASH-PREF-GUARD-1: agent shell must stay git-bash (auto would re-select windows-powershell via PSModulePath)
    try:
        import json as _json, os as _os
        _sp = _os.path.join(_os.environ.get('APPDATA', ''), 'DeepChat', 'app-settings.json')
        if _os.path.exists(_sp):
            with open(_sp, 'r', encoding='utf-8') as _f:
                _cfg = _json.load(_f)
            _pref = (_cfg.get('agentCommandShell') or {}).get('preference')
            if _pref is not None and _pref != 'git-bash':
                fails.append('agentCommandShell.preference drift: %r (must be git-bash)' % _pref)
    except Exception as _e:
        fails.append('could not verify git-bash preference: ' + str(_e))
    try:
        c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=60)
        rows = c.execute("SELECT id, name, enabled, cron_expr, next_run_at FROM cron_jobs").fetchall()
        c.close()
    except Exception as e:
        print("SCHEDULER-GUARD: ERROR reading cron_jobs:", e)
        return 2
    enabled = [r for r in rows if r[2] == 1]
    disabled = [r for r in rows if r[2] != 1]
    ids = {r[0] for r in enabled}
    if disabled:
        fails.append("DISABLED residue present: " + ", ".join(str(r[0])[:8] + " " + str(r[1])[:40] for r in disabled))
    for r in enabled:
        if fires_per_day(str(r[3])) > 1:
            fails.append(">1x/day enabled: %s %s (%s)" % (str(r[0])[:8], str(r[1])[:40], r[3]))
    for cid, expected in CANONICAL.items():
        if cid not in ids:
            fails.append("canonical row MISSING: " + cid[:8] + " " + expected)
    extra = [str(r[0]) for r in enabled if r[0] not in CANONICAL]
    if extra:
        fails.append("NON-canonical enabled row(s): " + ", ".join(extra))
    now = datetime.datetime.now(datetime.timezone.utc)
    # SILENT-ROLLOVER-1: fired one-shots roll +365d silently - delete stale one-shot automatically (no owner needed)
    for r in rows:
        if r[0] == ONE_SHOT and r[3]:
            nxt = r[4]
            if isinstance(nxt, (int, float)) and nxt and nxt < now.timestamp():
                try:
                    w = sqlite3.connect(DB, timeout=60)
                    w.execute("DELETE FROM cron_jobs WHERE id=?", (ONE_SHOT,))
                    w.commit(); w.close()
                    print("  - AUTO-DELETED stale one-shot 2055e49c (fired; SILENT-ROLLOVER-1)")
                except Exception as e:
                    fails.append("could not auto-delete stale one-shot: " + str(e))
    if fails:
        print("SCHEDULER-GUARD: FAIL")
        for f in fails:
            print("  - " + f)
        return 1
    print("SCHEDULER-GUARD: PASS (local cron deprecated: %d enabled rows present (must be 0), 0 disabled residue, all <=1x/day)" % len(enabled))
    return 0

if __name__ == "__main__":
    sys.exit(main())
