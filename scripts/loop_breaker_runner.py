#!/usr/bin/env python3
"""LOOP-BREAKER-1 and DOCTRINE-AUDIT-1 filing from the GitHub runner (2026-10-09, pillar autonomy; agent_issues 2183, 2181).

WHAT  1. Reads qnfo-audit.v_loop_breaker_signatures (2026-10-09-06): an error signature seen 3 or more times in 24 h that
         recurred in the last 2 h gets one open LOOP-BREAKER-1 issue (deduped on the open title), and its issue-<id> contract
         gets a probe that passes once the signature has not recurred for 6 hours.
      2. Once per ISO week, files DOCTRINE-AUDIT-<year>-W<week>: the v_doctrine_scorecard_v2 clause furthest from its target,
         with the measured value, and a probe that passes when the clause reaches the target. It never edits the doctrine
         (amendments land by PR).
WHY   An agent_issues insert from a fleet_tick trigger nests the issue triggers past D1's 10 levels (D1-TRIGGER-DEPTH-1);
      the runner writes at depth 0. Deterministic: no model call.
RUNS  A step of remediation-consumer.yml (hourly). Never fails the job.
      3. WORKERS-BP-AUDIT-D1-1 (2026-10-12): runs scripts/fleet_best_practices_audit.py's D1 half (findings table, run row, metric
         workers_bp_findings_open, one WORKERS-BP-DEBT-1: <worker> issue per worker with fail-class debt, each with a code-task line
         and a d1-query probe that closes it when the worker is clean).
      4. BP26-PRODUCERS-1 (2026-10-26): runs scripts/bp26_producers.py, the runner half of the BP26 best-practice catalogue's metrics
         (every scripts/bp26_<area>.py module's collectors; each writes only metrics tagged [BP26] and keeps its evidence rows).
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import remediation_consumer as RC  # noqa: E402

TITLE = "LOOP-BREAKER-1: %s: %s"
# Scorecard clauses with their targets (doctrine sections) and the direction that is good.
CLAUSES = [
    ("silent_drops", 0, "section 6, no silent drop"),
    ("issues_unaccounted", 0, "section 6, issue accounting"),
    ("spofs_on_critical_path", 0, "section 10, single points of failure with an untested alternate"),
    ("controls_on_critical_path_untested", 0, "section 11, controls on a critical path without a tested alternate"),
    ("beliefs_unverified_60m", 0, "section 5, beliefs acted on without a fresh probe"),
    ("failure_modes_unprobed_pct", 0, "section 12, failure modes without a detector"),
    ("root_causes_unremediated", 0, "section 12, recurring root causes"),
]


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def now_ms():
    return int(time.time() * 1000)


def file_issue(d1, title, description, probe, priority="high", category="reliability", source="loop-breaker"):
    if d1("SELECT id FROM agent_issues WHERE title = ?1 AND status = 'open' LIMIT 1", [title]):
        return None
    d1("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) "
       "VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, ?6)", [title, description, source, category, priority, now_ms()])
    row = d1("SELECT id FROM agent_issues WHERE title = ?1 AND status = 'open' ORDER BY id DESC LIMIT 1", [title])
    if not row:
        return None
    iid = int(row[0]["id"])
    d1("UPDATE remediation_contracts SET verify_probe = ?1, verify_transport = 'd1-query', status = 'active' WHERE class = ?2",
       [probe, "issue-%d" % iid])
    return iid


# D1-OVERLOAD-REFILE-1 (2026-11-05, pillar autonomy; GitHub 6852, 6853, 6863, 6866, 6867, 6869, 6959, 6975, 7116, 7197 and the rest of the family).
# "D1 DB is overloaded" is one shared-database condition seen by every worker; scripts/cf_obs_issue_bridge.py folds its observability groups into ONE
# umbrella issue (D1-OVERLOAD-FOLD-1) and the hourly workflow issue-meta-fold supersedes the per-group issues by the umbrella's id. This runner kept
# filing a LOOP-BREAKER-1 issue per producer and message variant for the same condition: the fold closed them at 18:56Z on 2026-11-04, the next hourly
# run filed each title again, issue_refile_reopen (a title closed within 24 h is reopened, the insert dropped) reopened all ten at 19:53Z, and
# FOLD-NO-PINGPONG-1 then had to leave them open for a day. A signature whose text says the database is overloaded is now counted, not filed, while the
# umbrella is open; with no open umbrella it is filed as before so the condition is never untracked. The v_loop_breaker_signatures digit stripping turns
# "D1 DB" into "D DB", so the mark is the part without the digit.
D1_OVERLOAD_MARK = "db is overloaded"
UMBRELLA_TITLE = "CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]"


def is_d1_overload(producer, sig, example=""):
    return D1_OVERLOAD_MARK in (str(sig or "") + " " + str(example or "")).lower()


def umbrella_open(d1):
    return bool(d1("SELECT id FROM agent_issues WHERE status = 'open' AND lower(trim(title)) = lower(trim(?1)) LIMIT 1", [UMBRELLA_TITLE]))


def loop_breakers(d1, stats=None):
    filed = []
    stats = stats if stats is not None else {}
    umbrella = None   # read once, only when a D1-overload signature is seen
    rows = d1("SELECT src, producer, sig, n, last_ts, example FROM v_loop_breaker_signatures "
              "WHERE datetime(last_ts) > datetime('now', '-2 hours') ORDER BY n DESC LIMIT 10")
    for r in rows:
        producer, sig = str(r.get("producer") or "?")[:60], str(r.get("sig") or "")
        if not sig.strip():
            continue
        if is_d1_overload(producer, sig, r.get("example")):
            if umbrella is None:
                umbrella = umbrella_open(d1)
            if umbrella:
                stats["folded_d1_overload"] = stats.get("folded_d1_overload", 0) + 1
                continue
        title = TITLE % (producer, sig)
        probe = ("SELECT '1' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM v_loop_breaker_signatures WHERE producer = %s AND sig = %s "
                 "AND datetime(last_ts) > datetime('now', '-6 hours')) THEN '1' ELSE '0' END AS observed") % (q(producer), q(sig))
        desc = ("Charter pillar: autonomy (doctrine revision 2 section 2, loop breaker). The same failure recurred %s times in 24 h "
                "(source %s, producer %s, last %s). One defect is the likely root cause; fix it rather than retrying. "
                "Example: %s\nCloses when the signature has not recurred for 6 hours (v_loop_breaker_signatures)."
                % (r.get("n"), r.get("src"), producer, r.get("last_ts"), str(r.get("example") or "")[:300]))
        iid = file_issue(d1, title, desc, probe)
        if iid:
            filed.append(iid)
    return filed


def doctrine_audit(d1, week=None):
    week = week or time.strftime("%G-W%V", time.gmtime())
    title = "DOCTRINE-AUDIT-" + week
    if d1("SELECT id FROM agent_issues WHERE title = ?1 LIMIT 1", [title]):
        return None
    card = (d1("SELECT * FROM v_doctrine_scorecard_v2") or [{}])[0]
    worst = None
    for key, target, clause in CLAUSES:
        v = card.get(key)
        if v is None:
            continue
        gap = float(v) - target
        if gap > 0 and (worst is None or gap > worst[0]):
            worst = (gap, key, target, clause, v)
    if not worst:
        return None
    gap, key, target, clause, v = worst
    probe = ("SELECT '1' AS expected, CASE WHEN (SELECT %s FROM v_doctrine_scorecard_v2) <= %s THEN '1' ELSE '0' END AS observed" % (key, target))
    desc = ("Charter pillar: autonomy (doctrine revision 2 sections 5 and 10, weekly self-audit). Weakest clause this week by "
            "v_doctrine_scorecard_v2: %s = %s (target %s), %s. Build the machinery that moves it (a detector, an alternate path, "
            "a probe); amendments to the doctrine itself land by PR. Closes when the clause reaches its target." % (key, v, target, clause))
    return file_issue(d1, title, desc, probe, priority="medium", category="governance", source="doctrine-audit")


def main(d1=None):
    live = d1 is None  # the runner step passes nothing; the offline suite passes a sqlite shim and must never reach the network
    d1 = d1 or RC.d1
    out = {"loop_breaker": "ok"}
    try:
        stats = {}
        out["filed"] = loop_breakers(d1, stats)
        out.update(stats)   # folded_d1_overload: signatures counted, not filed, because the umbrella issue tracks them
    except Exception as e:  # noqa: BLE001
        out["loop_breaker"] = "failed: " + str(e)[:200]
    try:
        out["doctrine_audit"] = doctrine_audit(d1)
    except Exception as e:  # noqa: BLE001
        out["doctrine_audit"] = "failed: " + str(e)[:200]
    # WORKERS-BP-AUDIT-D1-1 (2026-10-12, agent_issues 2348 "the audit script does not report to D1"): the whole-tree Workers
    # best-practices audit writes its findings, run row and metric and files one WORKERS-BP-DEBT-1 issue per worker from this
    # same depth-0 step. Never fails the job: run_d1 catches everything and reports it in its own key.
    try:
        import fleet_best_practices_audit as BP  # noqa: E402
        out["workers_bp_audit"] = BP.run_d1(d1)
    except Exception as e:  # noqa: BLE001
        out["workers_bp_audit"] = "failed: " + str(e)[:200]
    # BP26-PRODUCERS-1 (2026-10-26, agent_issues 1000363): the runner half of the BP26 catalogue's measurements (public-page probes, repository
    # scans, DNS and API reads, other databases) from this same depth-0 step. Network and API reads only on the live runner, never in the
    # offline suite; run() never raises and writes only metrics tagged [BP26], so a broken collector cannot stop the audit above or the consumer.
    if live:
        try:
            import bp26_producers as BP26  # noqa: E402
            res = BP26.run()
            out["bp26_producers"] = {k: res[k] for k in ("bp26_producers", "ran", "skipped", "unknown") if k in res}
            out["bp26_producers"]["written"] = len(res.get("written", []))
            out["bp26_producers"]["errors"] = res.get("errors", [])[:6]
        except Exception as e:  # noqa: BLE001
            out["bp26_producers"] = "failed: " + str(e)[:200]
    print(json.dumps(out))
    return 0


def selftest():
    import sqlite3
    c = sqlite3.connect(":memory:")
    c.executescript("""
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, verify_probe TEXT, verify_transport TEXT, status TEXT, issue_id INTEGER);
CREATE TRIGGER birth AFTER INSERT ON agent_issues BEGIN INSERT INTO remediation_contracts VALUES ('issue-' || NEW.id, 'needs', 'd1-query', 'needs-machine-probe', NEW.id); END;
CREATE TABLE workers_bp_findings (worker TEXT, check_name TEXT, severity TEXT, file TEXT, line INTEGER, line_text TEXT, why TEXT, run_at TEXT);
CREATE TABLE workers_bp_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT, sha TEXT, workers INTEGER, fail_count INTEGER, advisory_count INTEGER, cron_triggers INTEGER);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);
CREATE TABLE sigs (src TEXT, producer TEXT, sig TEXT, n INTEGER, last_ts TEXT, example TEXT);
CREATE VIEW v_loop_breaker_signatures AS SELECT * FROM sigs;
CREATE TABLE card (silent_drops INTEGER, issues_unaccounted INTEGER, failure_modes_unprobed_pct INTEGER);
CREATE VIEW v_doctrine_scorecard_v2 AS SELECT * FROM card;
INSERT INTO card VALUES (0, 3, 90);
""")
    c.execute("INSERT INTO sigs VALUES ('event', 'qnfo-research-exec', 'slot : D_ERROR: no such column: legacy_flag', 11, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'x')")
    c.execute("INSERT INTO sigs VALUES ('event', 'old', 'stale sig', 5, '2020-01-01T00:00:00Z', 'x')")

    def d1(sql, params=None):
        cur = c.execute(sql, params or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    assert main(d1) == 0 and main(d1) == 0
    all_titles = [r[0] for r in c.execute("SELECT title FROM agent_issues ORDER BY id")]
    titles = [t for t in all_titles if not t.startswith("WORKERS-BP-DEBT-1: ")]
    assert titles == ["LOOP-BREAKER-1: qnfo-research-exec: slot : D_ERROR: no such column: legacy_flag", "DOCTRINE-AUDIT-" + time.strftime("%G-W%V", time.gmtime())], titles
    # WORKERS-BP-AUDIT-D1-1: the same step scans the live tree (here: this repository) and writes a run row; debt issues, if any, are per worker.
    assert c.execute("SELECT COUNT(*) FROM workers_bp_runs").fetchone()[0] >= 1, "the audit wrote no run row"
    probes = dict(c.execute("SELECT class, verify_probe FROM remediation_contracts WHERE class IN ('issue-1', 'issue-2')"))
    assert all(p.startswith("SELECT '1' AS expected") for p in probes.values()), probes
    for p in c.execute("SELECT verify_probe FROM remediation_contracts WHERE class NOT IN ('issue-1', 'issue-2')"):
        assert "workers_bp_findings WHERE worker = " in p[0] and "'no-run'" in p[0], p  # the debt issues' probes read the findings table and need a fresh run
    assert d1(probes["issue-1"])[0]["observed"] == "0"
    c.execute("UPDATE sigs SET last_ts = '2020-01-01T00:00:00Z'")
    assert d1(probes["issue-1"])[0]["observed"] == "1"
    assert "failure_modes_unprobed_pct" in c.execute("SELECT description FROM agent_issues WHERE id = 2").fetchone()[0]
    selftest_d1_overload()
    print("loop_breaker_runner selftest ok")


def selftest_d1_overload():
    """D1-OVERLOAD-REFILE-1: the producer must not refile what the fold closed. Models issue_refile_reopen (a title closed within 24 h is
    reopened and the insert dropped) as production does, so a regression reproduces the close, refile and reopen cycle."""
    import sqlite3
    c = sqlite3.connect(":memory:")
    c.executescript("""
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, verify_probe TEXT, verify_transport TEXT, status TEXT, issue_id INTEGER);
CREATE TRIGGER birth AFTER INSERT ON agent_issues BEGIN INSERT INTO remediation_contracts VALUES ('issue-' || NEW.id, 'needs', 'd1-query', 'needs-machine-probe', NEW.id); END;
CREATE TRIGGER issue_refile_reopen BEFORE INSERT ON agent_issues
WHEN EXISTS (SELECT 1 FROM agent_issues t WHERE t.title = NEW.title AND t.status IN ('resolved', 'wontfix', 'closed') AND typeof(t.updated_at) = 'integer' AND t.updated_at > (strftime('%s', 'now') * 1000 - 86400000))
BEGIN
  UPDATE agent_issues SET status = 'open', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE id = (SELECT t.id FROM agent_issues t WHERE t.title = NEW.title AND t.status IN ('resolved', 'wontfix', 'closed') AND typeof(t.updated_at) = 'integer' AND t.updated_at > (strftime('%s', 'now') * 1000 - 86400000) ORDER BY t.id DESC LIMIT 1);
  SELECT RAISE(IGNORE);
END;
CREATE TABLE sigs (src TEXT, producer TEXT, sig TEXT, n INTEGER, last_ts TEXT, example TEXT);
CREATE VIEW v_loop_breaker_signatures AS SELECT * FROM sigs;
""")
    # the exact shapes the live view produced on 2026-11-04: digits stripped from the signature, digits kept in the example
    c.execute("INSERT INTO sigs VALUES ('event', 'qnfo-code-orchestrator', 'fleet_tick_heavy: D_ERROR: D DB is overloaded. Too many resources consumed within ', 5, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'fleet_tick_heavy: D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window')")
    c.execute("INSERT INTO sigs VALUES ('event', 'BRANCH-HYGIENE-1', 'D_ERROR: D DB is overloaded. Too many resources consumed within a  second', 4, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'D1_ERROR: D1 DB is overloaded.')")
    c.execute("INSERT INTO sigs VALUES ('event', 'qnfo-research-exec', 'slot : D_ERROR: no such column: legacy_flag', 11, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'x')")

    def d1(sql, params=None):
        cur = c.execute(sql, params or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    def rows():
        return [(r[0], r[1]) for r in c.execute("SELECT title, status FROM agent_issues ORDER BY id")]

    assert is_d1_overload("p", "fleet_tick: D_ERROR: D DB is overloaded.", "") and is_d1_overload("p", "x", "D1_ERROR: D1 DB is overloaded")
    assert not is_d1_overload("p", "slot : D_ERROR: no such column: legacy_flag", "exceeded its CPU time limit")
    # 1. no umbrella issue: the overload is still tracked, filed as before; the other error is filed too
    stats = {}
    filed = loop_breakers(d1, stats)
    assert len(filed) == 3 and not stats.get("folded_d1_overload"), (filed, stats)
    # 2. the fold closes the two overload issues and the umbrella opens (what the bridge and issue-meta-fold do)
    now = int(time.time() * 1000)
    c.execute("UPDATE agent_issues SET status = 'closed', updated_at = ?1 WHERE instr(lower(title), 'db is overloaded') > 0", [now])
    c.execute("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) VALUES (?1, 'umbrella', 'cf-obs-bridge', 'reliability', 'high', 'open', ?2, ?2)", [UMBRELLA_TITLE, now])
    before = rows()
    stats = {}
    assert loop_breakers(d1, stats) == [] and stats == {"folded_d1_overload": 2}, stats
    assert loop_breakers(d1) == []
    assert rows() == before, "the closed overload issues were reopened or refiled: %r" % (rows(),)
    # 3. a different error still files (the non-overload family is untouched) and the umbrella itself is never counted as a signature
    c.execute("INSERT INTO sigs VALUES ('event', 'qnfo-lifecycle', 'tick threw: exceeded its CPU time limit', 3, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'cpu')")
    assert len(loop_breakers(d1)) == 1
    # 4. the umbrella closes (the condition is over): a later overload signature is filed again, so the condition is never untracked
    c.execute("UPDATE agent_issues SET status = 'closed' WHERE title = ?1", [UMBRELLA_TITLE])
    stats = {}
    loop_breakers(d1, stats)
    assert not stats.get("folded_d1_overload"), stats
    assert any(t.startswith("LOOP-BREAKER-1: ") and "DB is overloaded" in t and s == "open" for t, s in rows()), rows()
    print("loop_breaker_runner d1-overload selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    sys.exit(main())
