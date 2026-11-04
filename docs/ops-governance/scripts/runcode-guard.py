#!/usr/bin/env python3
# runcode-guard.py - RUN_CODE sudden-termination guard (2026-09-02, pipeline-audit)
# Canonical: QNFO/qnfo-ops/scripts/runcode-guard.py ; Mirror: C:/Users/LENOVO/.deepchat/scripts/
# Root cause (app.asar primary evidence, RUNCODE-HALT-LIMITS-2026-09-02): run_code cells
# execute in an Electron utilityProcess (execArgv --max-old-space-size=64) with FIVE kill
# mechanisms + additional limits:
#   (1) HEARTBEAT_TIMEOUT_MS=3500 - hidden 3.5s liveness watchdog; any event-loop stall
#       >3.5s (sync exec/grep, big-result serialization, busy-wait) kills the cell.
#   (2) READY_TIMEOUT_MS=5e3 - spawn gate with NO retry; ONE active cell per session.
#   (3) script.runInContext timeout 2000ms - long synchronous cell prefix throws.
#   (4) RSS monitor every 1s - soft delta 128MB / hard 512MB kills (64MB heap child).
#   (5) RUN_CODE_OUTPUT_MAX_BYTES=1MiB - output cap; nested tool result also capped.
# Guard duties:
#   A. app.asar constant parity via pure-python streaming scan (no grep dependency;
#      v1.1 fixes: subprocess grep absent under Windows python -> false DRIFT).
#   B. chat-DB scan for observed kill signatures (24h / 7d / all-time counts).
#   C. RUNCODE-CELL-PROTOCOL.md artifact present (live system skill + qnfo-skills repo).
# Exit: 0 PASS | 1 runtime error | 2 DRIFT / artifact missing
import os, re, sqlite3, sys, datetime

ASAR_CANDIDATES = [
    r"C:\Program Files\DeepChat\resources\app.asar",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\DeepChat\resources\app.asar"),
    os.path.expandvars(r"%LOCALAPPDATA%\DeepChat\resources\app.asar"),
]
BASELINE = {"HEARTBEAT_TIMEOUT_MS": 3500, "READY_TIMEOUT_MS": 5000, "RUN_CODE_OUTPUT_MAX_BYTES": 1024 * 1024}
DB_PATH = os.path.expandvars(r"%APPDATA%\DeepChat\app_db\agent.db")
PROTO_LIVE = r"C:\Users\LENOVO\.deepchat\skills\system\RUNCODE-CELL-PROTOCOL.md"
PROTO_REPO = r"C:\Users\LENOVO\Documents\GitHub\qnfo-skills\system\RUNCODE-CELL-PROTOCOL.md"
SIGS = [
    ("heartbeat_timeout", "Code cell heartbeat timed out"),
    ("ready_timeout", "did not become ready within 5 seconds"),
    ("output_cap", "exceeded the 1 MiB limit"),
    ("output_cap_alt", "Code mode output exceeded"),
    ("sync_prefix", "runInContext"),
    ("terminated", "Code cell terminated"),
]
results = {"asar": {}, "scan": {}, "artifacts": {}}

def check_asar():
    asar = next((p for p in ASAR_CANDIDATES if os.path.exists(p)), None)
    if not asar:
        results["asar"]["error"] = "app.asar not found in any candidate path"
        return False
    results["asar"]["path"] = asar
    ok = True
    targets = {n: n.encode() + b" = " for n in BASELINE}
    found = {}
    chunk = 4 * 1024 * 1024
    overlap = 256
    with open(asar, "rb") as f:
        buf = b""
        while True:
            block = f.read(chunk)
            if not block:
                break
            buf = buf + block
            for n, pat in list(targets.items()):
                if n in found:
                    continue
                idx = buf.find(pat)
                if idx >= 0:
                    tail = buf[idx + len(pat): idx + len(pat) + 64]
                    m = re.search(rb"^[0-9* e]+", tail)
                    val = None
                    if m:
                        expr = m.group(0).decode().replace(" ", "")
                        try:
                            if re.fullmatch(r"[0-9*e.]+", expr):
                                val = int(eval(expr))
                        except Exception:
                            val = None
                    found[n] = val
            buf = buf[-overlap:]
    for n, expect in BASELINE.items():
        val = found.get(n)
        results["asar"][n] = {"expected": expect, "found": val}
        if val != expect:
            ok = False
    if set(found.keys()) != set(BASELINE.keys()):
        ok = False
        results["asar"]["missing_constants"] = sorted(set(BASELINE.keys()) - set(found.keys()))
    return ok

def check_scan(days=7):
    if not os.path.exists(DB_PATH):
        results["scan"]["error"] = "agent.db not found: " + DB_PATH
        return True
    try:
        con = sqlite3.connect("file:" + DB_PATH + "?mode=ro", uri=True, timeout=10)
        cur = con.cursor()
        cur.execute("SELECT content, created_at FROM deepchat_messages")
        rows = cur.fetchall()
        con.close()
    except Exception as e:
        results["scan"]["error"] = "query failed: " + str(e)
        return True
    now = datetime.datetime.now(datetime.timezone.utc)
    counts = {k: {"total": 0, "d7": 0, "d1": 0} for k, _ in SIGS}
    scanned = 0
    for content, created in rows:
        if not content:
            continue
        scanned += 1
        c = str(content)
        age_days = None
        if created is not None:
            try:
                t = float(created)
                if t > 1e12:
                    t = t / 1000.0
                dt = datetime.datetime.fromtimestamp(t, tz=datetime.timezone.utc)
                age_days = (now - dt).total_seconds() / 86400.0
            except Exception:
                age_days = None
        for k, sig in SIGS:
            if sig in c:
                counts[k]["total"] += 1
                if age_days is not None and age_days <= 7:
                    counts[k]["d7"] += 1
                if age_days is not None and age_days <= 1:
                    counts[k]["d1"] += 1
    results["scan"]["rows_scanned"] = scanned
    results["scan"]["counts"] = counts
    return True

def check_artifacts():
    for name, p in (("live_system_skill", PROTO_LIVE), ("repo_system_skill", PROTO_REPO)):
        results["artifacts"][name] = os.path.exists(p)
    return all(results["artifacts"].values())

def j(o):
    import json
    return json.dumps(o, default=str)

def main():
    a = check_asar()
    s = check_scan()
    art = check_artifacts()
    print("RUNTIME_VER 1.1")
    print("ASAR " + j(results["asar"]))
    print("SCAN " + j(results["scan"]))
    print("ARTIFACTS " + j(results["artifacts"]))
    problems = []
    if not a:
        problems.append("ASAR_DRIFT_OR_UNREADABLE")
    if not art:
        problems.append("PROTOCOL_ARTIFACT_MISSING")
    if results["asar"].get("error") or results["scan"].get("error"):
        problems.append("RUNTIME_ERROR")
    if problems:
        print("GUARD_FAIL: " + " | ".join(problems))
        return 2 if (problems[0].startswith("ASAR") or problems[0].startswith("PROTOCOL")) else 1
    tot = sum(v["d7"] for v in results["scan"].get("counts", {}).values()) if results["scan"].get("counts") else 0
    print("GUARD_PASS exit0 (7d termination mentions=%d informational trend)" % tot)
    return 0

if __name__ == "__main__":
    sys.exit(main())

