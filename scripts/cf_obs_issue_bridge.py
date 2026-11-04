#!/usr/bin/env python3
"""CF-OBS-BRIDGE-1 (2026-10-18, owner directive "INTEGRATE CLOUDFLARE OBSERVABILITY ISSUES INTO UNIFIED TRACKING, AUDITING, AND
REMEDIATION. THE SYSTEM SHALL AUTOMATICALLY SWEEP FOR ALL KNOWN ISSUES AND RESOLVE AUTOMATICALLY").

WHAT  Closes the loop between Cloudflare Workers Observability Issues and the fleet's own tracker:
      1. SWEEP   reads every page of /workers/observability/issues?status=active (Cloudflare API, read).
      2. TRACK   every live group (seen within FILE_H hours, i.e. not yet quiet; not external scan noise) gets ONE open agent_issues row
                 "CF-OBS-ISSUE-1: <service>: <title>", deduped on the Cloudflare id carried in its description, with:
                   - a code-task line for <service>/worker.js when that file exists, so the code loop attempts the fix;
                   - its issue-<id> contract re-pointed at a d1-query probe that passes once the group has not recurred for
                     QUIET_H hours (read from fleet_issue_dispatch, which qnfo-fleet-control pollObservability refreshes
                     every 10 minutes). The existing autoclose trigger then closes the issue with verified evidence.
      3. RESOLVE when a CF-OBS-ISSUE-1 issue is closed by verification and its group has been quiet QUIET_H hours, the
                 group is PATCHed to status=resolved in Cloudflare. Cloudflare re-activates a resolved group on its next
                 occurrence, and the next sweep then files a fresh issue (relapse is visible, never silent).
      CF-OBS-BRIDGE-LOOP-1 (2026-10-19): FILE and RESOLVE share one boundary. Before, a group was filed while seen within 24 h but
      the issue's own probe closed it after 6 h quiet, so a group quiet for 6 to 24 h was closed by the probe, filed again by the next
      sweep (the D1 trigger issue_refile_reopen reopens a title closed within 24 h) and closed again, while the RESOLVE step only
      ran on rows the FILE step had just reopened: 145 reopens on 27 issues in 24 h and no group told 'resolved'. Now a group quiet
      for FILE_H or more is never filed (a closed one is PATCHed resolved at once), and a title closed within 24 h is not filed again
      unless the group was observed after the close (a relapse, which the trigger reopens and the sweep counts as relapsed).
      One run row per sweep in cloud_ops_events (kind cf-obs-bridge); the fm-cf-obs-untracked contract audits the gap.
WHY   Before this, pollObservability mirrored groups into fleet_issue_dispatch, but nothing turned a live group into a tracked,
      probed, closable issue, so 29 groups sat active (3824 occurrences) while the remediation loop never saw them.
      A failing PATCH, closed-issue SELECT or Cloudflare list read is counted in `errors` and never skips the churn metric or the run row
      (they are written in a finally); the suite is a PR gate in deploy-gate.yml and the consumer runs the sweep even if it fails.
RUNS  A step of remediation-consumer.yml (runner, depth 0: an agent_issues insert from a D1 trigger nests past D1's limit).
      Deterministic, no model call. Never fails the job.
"""
import json
import os
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PREFIX = "CF-OBS-ISSUE-1: "
QUIET_H = 6          # a tracked group quiet this long passes its probe and its Cloudflare group is resolved
FILE_H = QUIET_H - 0.5   # a group is filed only while quieter than this; the margin keeps a group the probe would close in the
                         # same cycle (fleet_issue_dispatch lags Cloudflare by up to one 10-minute refresh) from opening at all
REFILE_H = 24        # issue_refile_reopen reopens a title closed within this window; the bridge never inserts into it blind
CHURN_LIMIT = 2      # do not re-file a CF-OBS-ISSUE-1 row that has already reopened more than this many times in 24 hours
NOISE = ("potential vulnerability scan",)
MAX_NEW = 15         # bound new issues per run so a burst cannot flood the tracker
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def now_ms():
    return int(time.time() * 1000)


# D1-OVERLOAD-FOLD-1 (issue 6953 family): "D1 DB is overloaded" is one shared-database condition seen by many workers. Each worker, function and
# message variant is a separate Cloudflare group, so one saturation spike filed 20+ CF-OBS-ISSUE-1 issues, each handed to a coding session
# (2026-11-04: #6883-#6896, #6953-#6959, 87 open issues of one cause). They are folded into ONE umbrella issue that carries the counts; the
# fix for the cause lives in the D1-OVERLOAD-1 series (migrations/2026-11-04-d1-overload-root-cause.sql). Issues already filed stay and close
# on their own probe; the umbrella closes when no overload group has been observed for QUIET_H hours.
D1_OVERLOAD_MARK = "d1 db is overloaded"
UMBRELLA_ID = "d1-overload"
UMBRELLA_TITLE = PREFIX + "fleet: D1 DB is overloaded, all workers [cf-obs:" + UMBRELLA_ID + "]"


def is_d1_overload(it):
    return D1_OVERLOAD_MARK in str(it.get("title") or "").lower()


def umbrella_probe():
    return ("SELECT '1' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM fleet_issue_dispatch d WHERE d.category = 'worker-observability' "
            "AND d.state <> 'resolved' AND json_valid(d.payload) AND instr(lower(COALESCE(json_extract(d.payload, '$.title'), '')), '%s') > 0 "
            "AND CAST(json_extract(d.payload, '$.lastObserved') AS INTEGER) > (CAST(strftime('%%s', 'now') AS INTEGER) - %d) * 1000) "
            "THEN '1' ELSE '0' END AS observed") % (D1_OVERLOAD_MARK, QUIET_H * 3600)


def ensure_umbrella(d1, folded, now, res):
    """One open issue for every live D1-overload group. Returns without writing when it is already open."""
    if d1("SELECT id FROM agent_issues WHERE status = 'open' AND lower(trim(title)) = lower(trim(?1)) LIMIT 1", [UMBRELLA_TITLE]):
        res["already"] += 1
        return
    services = sorted({str(g.get("service") or "?") for g in folded})
    occ = sum(int(g.get("count") or 0) for g in folded)
    desc = ("Charter pillar: reliability. %d live Cloudflare observability group(s), %d occurrence(s), across %d worker(s): %s.\n"
            "cf-obs-id: %s\nOne shared-database condition (qnfo-audit is a single-writer D1 used by 80+ workers). Per-group issues are not filed "
            "for it (D1-OVERLOAD-FOLD-1); the cause is worked in the D1-OVERLOAD-1 series (migrations/2026-11-04-d1-overload-root-cause.sql, "
            "FLEET-TICK-FANOUT-COST-1 and the other D1-OVERLOAD-1 doers). Closes by verification when no overload group has been observed for %d hours.") % (
        len(folded), occ, len(services), ", ".join(services)[:400], UMBRELLA_ID, QUIET_H)
    try:
        d1("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) "
           "VALUES (?1, ?2, 'cf-obs-bridge', 'reliability', 'high', 'open', ?3, ?3)", [UMBRELLA_TITLE, desc, now])
        row = d1("SELECT id, created_at FROM agent_issues WHERE title = ?1 AND status = 'open' ORDER BY id DESC LIMIT 1", [UMBRELLA_TITLE])
        if row:
            iid = int(row[0]["id"])
            d1("UPDATE remediation_contracts SET verify_probe = ?1, verify_transport = 'd1-query', status = 'active', next_due_at = datetime('now'), "
               "attempts = 0 WHERE class = ?2", [umbrella_probe(), "issue-%d" % iid])
            (res["filed"] if int(row[0]["created_at"] or 0) == now else res["relapsed"]).append(iid)
    except Exception as e:  # noqa: BLE001
        res["errors"] += 1
        print(json.dumps({"evt": "cf-obs-bridge:umbrella", "error": str(e)[:200]}))


def is_noise(it):
    t = str(it.get("title") or "").lower()
    return any(n in t for n in NOISE) and "low risk" in t


def is_high_risk_scan(it):
    t = str(it.get("title") or "").lower()
    return "potential vulnerability scan" in t and "high risk" in t


def is_router_drill_503(it):
    title = str(it.get("title") or "").lower()
    return str(it.get("service") or "") == "qnfo-ai" and "httpservererror" in title and "http 503" in title


def router_drill_count(d1, last_observed):
    rows = d1("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'router-drill' "
              "AND julianday(ts) BETWEEN julianday(datetime(?1 / 1000.0, 'unixepoch'), '-5 minutes') "
              "AND julianday(datetime(?1 / 1000.0, 'unixepoch'), '+5 minutes')", [last_observed])
    return int(rows[0]["n"]) if rows else 0


def title_for(it):
    svc = str(it.get("service") or "?")[:40]
    t = " ".join(str(it.get("title") or "issue").split())[:110]
    # The group ID keeps a distinct group from reopening a closed issue: issue_refile_reopen matches titles exactly.
    return PREFIX + svc + ": " + t + " [cf-obs:" + str(it.get("id") or "?") + "]"


def probe_for(cf_id):
    fp = "cf-obs-" + cf_id
    return ("SELECT '1' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM fleet_issue_dispatch d WHERE d.fingerprint = '%s' "
            "AND d.state <> 'resolved' AND CAST(json_extract(d.payload, '$.lastObserved') AS INTEGER) > "
            "(CAST(strftime('%%s', 'now') AS INTEGER) - %d) * 1000) THEN '1' ELSE '0' END AS observed") % (fp.replace("'", "''"), QUIET_H * 3600)


def code_task_line(svc):
    path = os.path.join(ROOT, svc, "worker.js")
    if svc and os.path.isfile(path):
        return "\ncode-task: repo=qnfo-workers path=%s/worker.js" % svc
    return ""


def list_active(cf):
    out = []
    for page in range(1, 11):
        r = cf("GET", "/workers/observability/issues?" + urllib.parse.urlencode({"status": "active", "perPage": 50, "page": page}))
        items = r.get("result") if r.get("success") else None
        if items is None:
            raise RuntimeError("issues list unreadable: " + json.dumps(r.get("errors"))[:200])
        out.extend(items)
        if len(items) < 50:
            return out
    return out


def sweep(d1, cf, now=None):
    now = now or now_ms()
    res = {"active": 0, "live": 0, "noise": 0, "filed": [], "relapsed": [], "held_closed": 0, "already": 0, "resolved_cf": [], "errors": 0,
           "reopened_24h": 0, "drill_skipped": [], "folded": 0}
    try:
        _file_and_resolve(d1, cf, now, res)
    except Exception:
        res["errors"] += 1
        raise
    finally:
        _record(d1, res, now)   # the guard metric and the run row are written even when a phase raised (CF-OBS-BRIDGE-LOOP-1)
    return res


def _file_and_resolve(d1, cf, now, res):
    items = list_active(cf)
    res["active"] = len(items)
    filed = 0
    folded = []
    for it in items:
        cid = str(it.get("id") or "")
        if not cid:
            continue
        if is_noise(it):
            res["noise"] += 1
            continue
        if now - int(it.get("lastObserved") or 0) >= FILE_H * 3600 * 1000:
            continue   # quiet: never filed; a closed issue for it is resolved below
        if is_d1_overload(it):
            folded.append(it)
            res["folded"] += 1
            continue
        res["live"] += 1
        if is_router_drill_503(it):
            try:
                occurrences = int(it.get("count") or 0)
                drills = router_drill_count(d1, int(it.get("lastObserved") or 0))
            except Exception as e:  # noqa: BLE001   correlation failure must not hide a real observability issue
                res["errors"] += 1
                print(json.dumps({"evt": "cf-obs-bridge:router-drill-check", "id": cid, "error": str(e)[:200]}))
                occurrences = drills = 0
            if occurrences > 0 and drills == occurrences:
                res["drill_skipped"].append(cid)
                print(json.dumps({"evt": "cf-obs-bridge:router-drill-skip", "id": cid,
                                  "occurrences": occurrences, "drill_events": drills}))
                continue
        if d1("SELECT id FROM agent_issues WHERE status = 'open' AND title LIKE 'CF-OBS-ISSUE-1:%' AND instr(description, ?1) > 0 LIMIT 1", ["cf-obs-id: " + cid]):
            res["already"] += 1
            continue
        if filed >= MAX_NEW:
            continue
        title = title_for(it)
        if d1("SELECT id FROM agent_issues WHERE status = 'open' AND lower(trim(title)) = lower(trim(?1)) LIMIT 1", [title]):
            res["already"] += 1
            continue
        # CF-OBS-BRIDGE-LOOP-1: a title closed within REFILE_H would be reopened by issue_refile_reopen. That is right for a
        # recurrence and wrong for a group quiet since the close, so insert only when it was observed after the close.
        try:
            closed_row = d1("SELECT id, updated_at FROM agent_issues WHERE title LIKE 'CF-OBS-ISSUE-1:%' AND status IN ('closed', 'resolved', 'wontfix') "
                            "AND typeof(updated_at) = 'integer' AND updated_at > ?1 AND (title = ?2 OR instr(description, ?3) > 0) "
                            "ORDER BY updated_at DESC LIMIT 1", [now - REFILE_H * 3600 * 1000, title, "cf-obs-id: " + cid])
        except Exception as e:  # noqa: BLE001   unknown whether the title is held: do not insert blind, retry next sweep
            res["errors"] += 1
            print(json.dumps({"evt": "cf-obs-bridge:closed-row", "id": cid, "error": str(e)[:200]}))
            continue
        if closed_row:
            closed_id = int(closed_row[0]["id"])
            try:
                r = d1("SELECT COUNT(*) AS n FROM issue_lifecycle WHERE event = 'reopened' AND issue_id = ?1 "
                       "AND ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours')", [closed_id])
                reopen_count = int(r[0]["n"]) if r else 0
            except Exception as e:  # noqa: BLE001
                res["errors"] += 1
                print(json.dumps({"evt": "cf-obs-bridge:churn-count", "id": cid, "error": str(e)[:200]}))
                continue
            if reopen_count >= CHURN_LIMIT:
                res["held_closed"] += 1
                continue
        if closed_row and int(it.get("lastObserved") or 0) <= int(closed_row[0]["updated_at"]):
            res["held_closed"] += 1
            continue
        svc = str(it.get("service") or "")
        desc = ("Charter pillar: reliability. Cloudflare Workers Observability issue group, live: %s occurrence(s), first %s, last %s "
                "(type %s, service %s).\ncf-obs-id: %s\nDashboard: https://dash.cloudflare.com/?to=/:account/workers/observability/issues/%s\n"
                "Find the root cause in the worker and fix it; do not suppress the log line. Closes by verification when the group "
                "has not recurred for %d hours (fleet_issue_dispatch, refreshed every 10 min by qnfo-fleet-control pollObservability); "
                "the bridge then marks the Cloudflare group resolved.%s") % (
            it.get("count"), time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(int(it.get("firstObserved") or 0) / 1000)),
            time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(int(it.get("lastObserved") or 0) / 1000)), it.get("type"), svc, cid, cid,
            QUIET_H, code_task_line(svc))
        pri = "high" if (is_high_risk_scan(it) or it.get("type") == "exception" or int(it.get("count") or 0) >= 50) else "medium"
        try:
            d1("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) "
               "VALUES (?1, ?2, 'cf-obs-bridge', 'reliability', ?3, 'open', ?4, ?4)", [title, desc, pri, now])
            row = d1("SELECT id, created_at FROM agent_issues WHERE title = ?1 AND status = 'open' ORDER BY id DESC LIMIT 1", [title])
            if row:
                iid = int(row[0]["id"])
                if int(row[0]["created_at"] or 0) != now:
                    res["relapsed"].append(iid)   # issue_refile_reopen absorbed the INSERT and reopened an older row: not a new filing
                    # The trigger leaves the reopened issue's contract in 'holding' (HOLDING-OPEN-REARM-1), probed at most daily, so
                    # re-arm it here: due now, attempts reset, and pointed at this group in case the title matched another cf-obs-id.
                    d1("UPDATE remediation_contracts SET verify_probe = ?1, verify_transport = 'd1-query', status = 'active', "
                       "next_due_at = datetime('now'), attempts = 0 WHERE class = ?2", [probe_for(cid), "issue-%d" % iid])
                else:
                    d1("UPDATE remediation_contracts SET verify_probe = ?1, verify_transport = 'd1-query', status = 'active' WHERE class = ?2",
                       [probe_for(cid), "issue-%d" % iid])
                    res["filed"].append(iid)
                filed += 1
        except Exception as e:  # noqa: BLE001
            res["errors"] += 1
            print(json.dumps({"evt": "cf-obs-bridge:file", "id": cid, "error": str(e)[:200]}))
    if folded:
        ensure_umbrella(d1, folded, now, res)
    # RESOLVE: verified-closed bridge issues whose group is still active in Cloudflare but quiet QUIET_H hours.
    active_ids = {str(it.get("id")): it for it in items}
    closed = d1("SELECT id, description FROM agent_issues WHERE title LIKE 'CF-OBS-ISSUE-1:%' AND status IN ('closed', 'resolved') "
                "AND updated_at > (CAST(strftime('%s', 'now') AS INTEGER) - 14 * 86400) * 1000")
    for row in closed:
        desc = str(row.get("description") or "")
        k = desc.find("cf-obs-id: ")
        if k < 0:
            continue
        cid = desc[k + 11:].split("\n", 1)[0].strip()
        it = active_ids.get(cid)
        if cid[:8] in res["resolved_cf"] or not it or now - int(it.get("lastObserved") or 0) < QUIET_H * 3600 * 1000:
            continue
        try:
            r = cf("PATCH", "/workers/observability/issues/" + urllib.parse.quote(cid), {"status": "resolved"})
        except Exception as e:  # noqa: BLE001   a timeout on one PATCH must not skip the others, the metric or the run row
            res["errors"] += 1
            print(json.dumps({"evt": "cf-obs-bridge:resolve", "id": cid[:8], "error": str(e)[:200]}))
            continue
        if r.get("success"):
            res["resolved_cf"].append(cid[:8])
        else:
            res["errors"] += 1


CHURN_SQL = ("SELECT COALESCE(MAX(n), 0) AS worst, COALESCE(SUM(n), 0) AS total FROM (SELECT l.issue_id, COUNT(*) AS n FROM issue_lifecycle l "
             "JOIN agent_issues a ON a.id = l.issue_id WHERE l.event = 'reopened' AND a.title LIKE 'CF-OBS-ISSUE-1:%' "
             "AND l.ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours') "
             "AND l.ts > COALESCE((SELECT strftime('%Y-%m-%dT%H:%M:%SZ', t.created_at, '+15 minutes') FROM analytics_metric_triggers t "
             "WHERE t.metric_key = 'cf_obs_reopen_churn_24h'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) GROUP BY l.issue_id)")


def _record(d1, res, now):
    # The bridge produces metric cf_obs_reopen_churn_24h (refresh_class worker-written): the most reopened events any one
    # CF-OBS-ISSUE-1 issue logged in the last 24 h AFTER the metric's trigger was born (CHURN_SQL: the churn the old bridge logged
    # before the fix is history, not a breach the fixed bridge could clear within the 120-minute issue SLA). 0 or 1 is a relapse;
    # 3 or more is a loop.
    try:
        ch = d1(CHURN_SQL)
        res["reopened_24h"] = int(ch[0]["total"]) if ch else 0
        d1("UPDATE metric_registry SET last_value = ?1, last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED' "
           "WHERE metric = 'cf_obs_reopen_churn_24h'", [str(int(ch[0]["worst"])) if ch else "0"])
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"evt": "cf-obs-bridge:churn-metric", "error": str(e)[:200]}))
    try:
        d1("INSERT INTO cloud_ops_events (id, ts, kind, text, job, status) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), "
           "'cf-obs-bridge', ?2, 'remediation-consumer', ?3)",
           ["cfb-%d-%s" % (now, os.urandom(4).hex()), json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in res.items()}), "ok" if not res["errors"] else "warn"])
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"evt": "cf-obs-bridge:run-row", "error": str(e)[:200]}))


def live_cf():
    import remediation_consumer as RC  # noqa: E402
    import cf_ops_actions as C  # noqa: E402
    acct, tok = RC.ACCOUNT, RC.TOKEN

    def cf(method, path, body=None):
        st, j = C.call(method, "/accounts/%s%s" % (acct, path), tok, body, timeout=30)
        return j if isinstance(j, dict) else {}
    return RC.d1, cf


def main():
    if not (os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CF_API_TOKEN")):
        print(json.dumps({"cf_obs_bridge": "skipped: no token"}))
        return 0
    try:
        d1, cf = live_cf()
        print(json.dumps({"cf_obs_bridge": sweep(d1, cf)}))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"cf_obs_bridge": "failed: " + str(e)[:300]}))
    return 0


def selftest():
    import cf_obs_issue_bridge_test as T  # noqa: E402   (CF-OBS-BRIDGE-LOOP-1: the suite models issue_refile_reopen and the lifecycle log)
    return T.run()


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main())
