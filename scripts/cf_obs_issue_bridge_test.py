#!/usr/bin/env python3
"""CF-OBS-BRIDGE-LOOP-1 tests for scripts/cf_obs_issue_bridge.py (offline, in-memory SQLite, no network).

The harness models the two production triggers that made the bridge flap, so a regression reproduces the real loop:
  issue_refile_reopen  BEFORE INSERT on agent_issues: a title closed within 24 h is reopened and the INSERT is ignored
                       (migrations/2026-10-08-12-doctrine.sql);
  issue_lifecycle_au   AFTER UPDATE OF status: every transition to 'open' is logged as event 'reopened'.
Before CF-OBS-BRIDGE-LOOP-1 a group quiet for 6 to 24 h was filed again (LIVE_H 24 against QUIET_H 6), reopened by the trigger,
closed by its own probe at the next tick, and never told 'resolved' in Cloudflare. cf_obs_issue_bridge.py --selftest runs this suite.
"""
import json
import os
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cf_obs_issue_bridge as B  # noqa: E402

H = 3600 * 1000

SCHEMA = """
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE UNIQUE INDEX open_title ON agent_issues(lower(trim(title))) WHERE status = 'open';
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, verify_probe TEXT, verify_transport TEXT, status TEXT, issue_id INTEGER, next_due_at TEXT, attempts INTEGER DEFAULT 0,
  precondition TEXT, action TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, module TEXT);
CREATE TRIGGER birth AFTER INSERT ON agent_issues BEGIN INSERT INTO remediation_contracts (class, verify_probe, verify_transport, status, issue_id) VALUES ('issue-' || NEW.id, 'needs', 'd1-query', 'needs-machine-probe', NEW.id); END;
CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, event TEXT NOT NULL, from_status TEXT, to_status TEXT, has_evidence INTEGER, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE TRIGGER issue_lifecycle_au AFTER UPDATE OF status ON agent_issues WHEN COALESCE(OLD.status, '') <> COALESCE(NEW.status, '')
BEGIN INSERT INTO issue_lifecycle (issue_id, event, from_status, to_status, has_evidence) VALUES (NEW.id, CASE WHEN NEW.status = 'open' THEN 'reopened' ELSE 'dispositioned' END, OLD.status, NEW.status, 1); END;
CREATE TRIGGER issue_refile_reopen BEFORE INSERT ON agent_issues
WHEN EXISTS (SELECT 1 FROM agent_issues t WHERE t.title = NEW.title AND t.status IN ('resolved', 'wontfix', 'closed')
  AND typeof(t.updated_at) = 'integer' AND t.updated_at > (strftime('%s', 'now') * 1000 - 86400000))
BEGIN
  UPDATE agent_issues SET status = 'open', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
      description = COALESCE(description, '') || char(10) || 'REOPENED by issue_refile_reopen (DOCTRINE-1) by ' || COALESCE(NEW.source, '?')
  WHERE id = (SELECT t.id FROM agent_issues t WHERE t.title = NEW.title AND t.status IN ('resolved', 'wontfix', 'closed')
    AND typeof(t.updated_at) = 'integer' AND t.updated_at > (strftime('%s', 'now') * 1000 - 86400000) ORDER BY t.id DESC LIMIT 1);
  SELECT RAISE(IGNORE);
END;
CREATE TABLE fleet_issue_dispatch (fingerprint TEXT PRIMARY KEY, category TEXT, payload TEXT, state TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, job TEXT, status TEXT, meta TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);
INSERT INTO metric_registry VALUES ('cf_obs_reopen_churn_24h', NULL, NULL, 'MEASURED');
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT UNIQUE, created_at TEXT DEFAULT (datetime('now')));
INSERT INTO analytics_metric_triggers (metric_key, created_at) VALUES ('cf_obs_reopen_churn_24h', datetime('now', '-2 hours'));
"""


class Env:
    """One in-memory tracker plus a Cloudflare double whose active list loses a group when it is PATCHed resolved."""

    def __init__(self, groups):
        self.c = sqlite3.connect(":memory:")
        self.c.executescript(SCHEMA)
        self.groups = {g["id"]: g for g in groups}
        self.patched = []
        self.fail_patch = False   # a transport error (timeout) on the PATCH call
        self.fail_sql = None      # a D1 error on any statement containing this text
        self.fail_list = False

    def d1(self, sql, params=None):
        if self.fail_sql and self.fail_sql in sql:
            raise RuntimeError("d1 unavailable")
        cur = self.c.execute(sql, params or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    def cf(self, method, path, body=None):
        if method == "GET":
            if self.fail_list:
                raise OSError("timed out")
            return {"success": True, "result": list(self.groups.values()) if "page=1" in path else []}
        if self.fail_patch:
            raise OSError("timed out")
        gid = path.rsplit("/", 1)[-1]
        self.patched.append((gid, body))
        self.groups.pop(gid, None)
        return {"success": True}

    def sweep(self, now):
        return B.sweep(self.d1, self.cf, now)

    def reopens(self):
        return self.d1("SELECT COUNT(*) n FROM issue_lifecycle WHERE event = 'reopened'")[0]["n"]

    def issues(self):
        return self.d1("SELECT id, title, description, status FROM agent_issues ORDER BY id")

    def close_by_probe(self, issue_id, ago_ms=0):
        """What the autoclose trigger does once the issue's own probe passes."""
        pr = self.d1("SELECT verify_probe FROM remediation_contracts WHERE class = 'issue-%d'" % issue_id)[0]["verify_probe"]
        assert self.d1(pr)[0]["observed"] == "1", "probe must pass before the close"
        self.c.execute("UPDATE agent_issues SET status = 'closed', updated_at = ? WHERE id = ?", [B.now_ms() - ago_ms, issue_id])


def grp(gid, svc, quiet_ms, now, title="HttpServerError · HTTP 502", count=9):
    return {"id": gid, "service": svc, "title": title, "type": "exception", "count": count, "firstObserved": now - 9e8, "lastObserved": now - quiet_ms}


def seed_router_drill(env, ts):
    env.c.execute("INSERT INTO cloud_ops_events (id, ts, kind, text, job, status) VALUES (?, datetime(? / 1000.0, 'unixepoch'), 'router-drill', '', 'qnfo-ai', 'ok')",
                  ["drill-%d" % ts, ts])


def seed_closed(env, g, closed_ago_ms):
    """A CF-OBS issue for group g that the probe already closed closed_ago_ms ago."""
    env.c.execute("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) VALUES (?, ?, 'cf-obs-bridge', 'reliability', 'high', 'open', ?, ?)",
                  [B.title_for(g), "cf-obs-id: %s\nseed" % g["id"], B.now_ms() - 30 * H, B.now_ms() - 30 * H])
    iid = env.d1("SELECT id FROM agent_issues ORDER BY id DESC LIMIT 1")[0]["id"]
    env.c.execute("UPDATE agent_issues SET status = 'closed', updated_at = ? WHERE id = ?", [B.now_ms() - closed_ago_ms, iid])
    return iid


def test_quiet_group_with_closed_issue_is_resolved_not_refiled():
    now = B.now_ms()
    env = Env([grp("g-q8", "radar-hub", 8 * H, now), grp("g-q12", "qnfo-ops", 12 * H, now), grp("g-q20", "qnfo-ai", 20 * H, now)])
    for g in list(env.groups.values()):
        seed_closed(env, g, 1 * H)
    base = env.reopens()
    for i in range(3):
        r = env.sweep(now)
        assert env.reopens() == base, "sweep %d reopened a closed CF-OBS issue: %s" % (i + 1, r)
        assert r["filed"] == [], r
    assert sorted(g for g, b in env.patched) == ["g-q12", "g-q20", "g-q8"] and all(b == {"status": "resolved"} for _, b in env.patched), env.patched
    assert all(i["status"] == "closed" for i in env.issues()), env.issues()


def test_quiet_group_without_issue_is_not_filed():
    now = B.now_ms()
    env = Env([grp("g-q8", "radar-hub", 8 * H, now), grp("g-edge", "qnfo-ai", int(5.8 * H), now)])
    r = env.sweep(now)
    assert r["filed"] == [] and env.issues() == [] and env.reopens() == 0, (r, env.issues())
    assert r["live"] == 0, r


def test_live_group_filed_once_and_probe_lifecycle():
    now = B.now_ms()
    high_risk_scan = grp("g-scan-high", "qnfo-fleet-lee", 1e5, now, title="Potential vulnerability scan · wordpress · high risk", count=3)
    high_risk_scan["type"] = "security"
    env = Env([grp("g-live", "qnfo-ai", 60e3, now, count=92),
               grp("g-scan-low", "qnfo-gateway", 1e5, now, title="Potential vulnerability scan · /wp-login.php · low risk"),
               high_risk_scan, grp("g-old", "qnfo-ops", 30 * H, now)])
    r1 = env.sweep(now)
    assert r1["active"] == 4 and r1["noise"] == 1 and r1["live"] == 2 and len(r1["filed"]) == 2, r1
    r2 = env.sweep(now)
    assert r2["filed"] == [] and r2["already"] == 2, r2
    row = env.issues()[0]
    assert row["title"] == "CF-OBS-ISSUE-1: qnfo-ai: HttpServerError · HTTP 502 [cf-obs:g-live]" and "cf-obs-id: g-live" in row["description"], row
    scan = env.issues()[1]
    assert "Potential vulnerability scan · wordpress · high risk" in scan["title"] and scan["status"] == "open", scan
    assert env.d1("SELECT priority FROM agent_issues WHERE id = ?", [scan["id"]])[0]["priority"] == "high", scan
    pr = env.d1("SELECT verify_probe FROM remediation_contracts WHERE class = 'issue-%d'" % row["id"])[0]["verify_probe"]
    assert pr.startswith("SELECT '1' AS expected") and "cf-obs-g-live" in pr, pr
    # the probe fails while the dispatch row is live, passes once it is quiet
    env.c.execute("INSERT INTO fleet_issue_dispatch VALUES ('cf-obs-g-live', 'worker-observability', ?, 'tracked')", [json.dumps({"lastObserved": now - 60e3})])
    assert env.d1(pr)[0]["observed"] == "0"
    env.c.execute("UPDATE fleet_issue_dispatch SET payload = ?", [json.dumps({"lastObserved": now - 7 * H})])
    assert env.d1(pr)[0]["observed"] == "1"
    assert env.reopens() == 0


def test_router_drill_503_is_skipped_when_drills_explain_occurrences():
    now = B.now_ms()
    group = grp("g-drill", "qnfo-ai", 60e3, now, title="HttpServerError · HTTP 503", count=1)
    env = Env([group])
    seed_router_drill(env, group["lastObserved"])

    r = env.sweep(now)

    assert r["filed"] == [] and r["relapsed"] == [] and env.issues() == [], (r, env.issues())
    assert r["drill_skipped"] == ["g-drill"], r
    log = run_rows(env)
    assert len(log) == 1 and json.loads(log[0]["text"])["drill_skipped"] == 1, log


def test_real_and_partially_explained_503_groups_are_filed():
    now = B.now_ms()
    real = grp("g-real-503", "qnfo-ai", 7 * 60e3, now, title="HttpServerError · HTTP 503", count=1)
    partial = grp("g-partial-503", "qnfo-ai", 60e3, now, title="HttpServerError · HTTP 503", count=2)
    env = Env([real, partial])
    seed_router_drill(env, partial["lastObserved"])

    r = env.sweep(now)

    assert len(r["filed"]) == 2 and r["drill_skipped"] == [], (r, env.issues())
    assert len(env.issues()) == 2 and all("[cf-obs:" in issue["title"] for issue in env.issues()), env.issues()


def test_distinct_group_with_same_title_does_not_reopen_closed_issue():
    now = B.now_ms()
    first = grp("g-first", "qnfo-ai", 60e3, now)
    env = Env([first])
    filed = env.sweep(now)["filed"]
    assert len(filed) == 1, env.issues()
    first_id = filed[0]

    dispatch(env, grp("g-first", "qnfo-ai", 7 * H, now))
    env.close_by_probe(first_id, ago_ms=5 * 60e3)

    second = grp("g-second", "qnfo-ai", 60e3, now)
    env.groups = {"g-second": second}
    result = env.sweep(now)

    assert len(result["filed"]) == 1 and result["relapsed"] == [], result
    assert env.reopens() == 0, env.issues()
    rows = env.issues()
    assert len(rows) == 2 and rows[0]["status"] == "closed" and rows[1]["status"] == "open", rows
    assert "[cf-obs:g-first]" in rows[0]["title"] and "[cf-obs:g-second]" in rows[1]["title"], rows


def test_full_cycle_file_close_resolve_has_no_reopen():
    """File live, the group goes quiet, the probe closes the issue, the next sweeps resolve the group and nothing reopens."""
    now = B.now_ms()
    env = Env([grp("g-cyc", "qnfo-ai", 60e3, now)])
    r = env.sweep(now)
    assert len(r["filed"]) == 1, r
    iid = r["filed"][0]
    # time passes: 7 h later the group has not recurred; dispatch mirrors it
    later = now + 7 * H
    env.c.execute("INSERT INTO fleet_issue_dispatch VALUES ('cf-obs-g-cyc', 'worker-observability', ?, 'tracked')", [json.dumps({"lastObserved": now - 60e3 - 7 * H})])
    env.close_by_probe(iid)
    for i in range(3):
        rr = env.sweep(later)
        assert rr["filed"] == [] and env.reopens() == 0, (i, rr)
    assert [g for g, _ in env.patched] == ["g-cyc"], env.patched


def test_recurrence_after_close_is_a_relapse_not_a_filing():
    now = B.now_ms()
    env = Env([grp("g-rel", "qnfo-ai", 60e3, now)])
    iid = seed_closed(env, env.groups["g-rel"], 3 * H)   # closed 3 h ago; the group recurred 1 minute ago
    # as production leaves it after the probe passed: the contract parked in 'holding', due tomorrow, with attempts used
    env.c.execute("UPDATE remediation_contracts SET status = 'holding', verify_probe = 'stale', next_due_at = datetime('now', '+1 day'), attempts = 4 WHERE class = ?",
                  ["issue-%d" % iid])
    r = env.sweep(now)
    assert r["filed"] == [] and len(r["relapsed"]) == 1, r
    assert env.reopens() == 1 and env.issues()[0]["status"] == "open", env.issues()
    assert env.patched == []
    c = env.d1("SELECT status, verify_probe, attempts, next_due_at <= datetime('now') AS due FROM remediation_contracts WHERE class = ?", ["issue-%d" % iid])[0]
    assert c["status"] == "active" and c["attempts"] == 0 and c["due"] == 1 and c["verify_probe"] == B.probe_for("g-rel"), c


def test_closed_title_guard_holds_a_group_that_has_not_recurred_since_the_close():
    now = B.now_ms()
    env = Env([grp("g-hold", "qnfo-ai", 1 * H, now)])  # live by age, but the issue was closed 30 minutes ago, after its last occurrence
    seed_closed(env, env.groups["g-hold"], int(0.5 * H))
    r = env.sweep(now)
    assert env.reopens() == 0 and r["filed"] == [] and r["held_closed"] == 1, r
    assert env.patched == [], env.patched


def test_metric_churn_is_written_each_sweep():
    now = B.now_ms()
    env = Env([grp("g-live", "qnfo-ai", 60e3, now)])
    env.sweep(now)
    assert env.d1("SELECT last_value v FROM metric_registry WHERE metric = 'cf_obs_reopen_churn_24h'")[0]["v"] == "0"
    iid = env.issues()[0]["id"]
    for _ in range(3):  # three close/reopen cycles of one issue within the window
        env.c.execute("UPDATE agent_issues SET status = 'closed' WHERE id = ?", [iid])
        env.c.execute("UPDATE agent_issues SET status = 'open' WHERE id = ?", [iid])
    r = env.sweep(now)
    assert env.d1("SELECT last_value v FROM metric_registry WHERE metric = 'cf_obs_reopen_churn_24h'")[0]["v"] == "3", r
    assert r["reopened_24h"] == 3, r


def run_rows(env):
    return env.d1("SELECT status, text FROM cloud_ops_events WHERE kind = 'cf-obs-bridge'")


def churn_value(env):
    return env.d1("SELECT last_value v FROM metric_registry WHERE metric = 'cf_obs_reopen_churn_24h'")[0]["v"]


def test_metric_ignores_churn_logged_before_the_fix_shipped():
    """Second review, major: the trigger (gt 2) is born with the migration. Counting the old bridge's reopens inside the trailing 24 h
    window would breach it at the first sweep and keep it open for about 22 h, against the 120-minute issue SLA."""
    now = B.now_ms()
    env = Env([grp("g-live", "qnfo-ai", 60e3, now)])
    r = env.sweep(now)
    iid = r["filed"][0]
    for _ in range(13):   # the pre-fix flap: 13 reopens of one issue, 3 h ago, before the trigger row (born 2 h ago) existed
        env.c.execute("INSERT INTO issue_lifecycle (issue_id, event, from_status, to_status, has_evidence, ts) VALUES (?, 'reopened', 'closed', 'open', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-3 hours'))", [iid])
    r = env.sweep(now)
    assert churn_value(env) == "0" and r["reopened_24h"] == 0, (churn_value(env), r)
    for _ in range(3):    # a loop after the fix shipped is still caught
        env.c.execute("INSERT INTO issue_lifecycle (issue_id, event, from_status, to_status, has_evidence, ts) VALUES (?, 'reopened', 'closed', 'open', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 hours'))", [iid])
    env.sweep(now)
    assert churn_value(env) == "3", churn_value(env)
    env.c.execute("DELETE FROM analytics_metric_triggers")   # no trigger row: nothing is counted rather than everything
    env.sweep(now)
    assert churn_value(env) == "0", churn_value(env)


def test_a_failing_patch_does_not_skip_the_metric_or_the_run_row():
    now = B.now_ms()
    env = Env([grp("g-a", "qnfo-ai", 8 * H, now), grp("g-b", "qnfo-ops", 9 * H, now)])
    for g in list(env.groups.values()):
        seed_closed(env, g, 1 * H)
    env.fail_patch = True
    r = env.sweep(now)   # must not raise
    assert r["errors"] == 2 and r["resolved_cf"] == [], r
    assert churn_value(env) == "0", "the guard metric was skipped"
    rows = run_rows(env)
    assert len(rows) == 1 and rows[0]["status"] == "warn", rows
    env.fail_patch = False   # and the next sweep still resolves them
    assert sorted(env.sweep(now)["resolved_cf"]) == ["g-a", "g-b"]


def test_a_failing_closed_row_select_does_not_skip_the_metric_or_insert_blind():
    now = B.now_ms()
    env = Env([grp("g-live", "qnfo-ai", 60e3, now)])
    env.fail_sql = "status IN ('closed', 'resolved', 'wontfix')"
    r = env.sweep(now)   # must not raise
    assert r["errors"] == 1 and r["filed"] == [] and env.issues() == [], (r, env.issues())
    assert churn_value(env) == "0" and len(run_rows(env)) == 1 and run_rows(env)[0]["status"] == "warn", run_rows(env)
    env.fail_sql = None
    assert len(env.sweep(now)["filed"]) == 1


def test_an_unreadable_cloudflare_list_still_records_the_run():
    now = B.now_ms()
    env = Env([grp("g-live", "qnfo-ai", 60e3, now)])
    env.fail_list = True
    try:
        env.sweep(now)
        raised = False
    except OSError:
        raised = True
    assert raised, "the failure must still reach main() and its log line"
    assert churn_value(env) == "0" and len(run_rows(env)) == 1 and run_rows(env)[0]["status"] == "warn", run_rows(env)


def migration_sql():
    path = os.path.join(B.ROOT, "migrations", "2026-10-19-cf-obs-bridge-loop.sql")
    return open(path, encoding="utf-8").read()


def migration_statements(sql):
    stmts, cur = [], ""
    for line in sql.splitlines():
        if line.startswith("--"):
            continue
        cur += line + "\n"
        if sqlite3.complete_statement(cur):
            stmts.append(cur.strip())
            cur = ""
    return stmts


def migration_probe(env, klass):
    """Apply the migration's INSERT OR IGNORE INTO remediation_contracts for klass to the model and return the stored probe."""
    for st in migration_statements(migration_sql()):
        if st.startswith("INSERT OR IGNORE INTO remediation_contracts") and "'%s'" % klass in st:
            env.c.execute(st)
            return env.d1("SELECT verify_probe p FROM remediation_contracts WHERE class = ?", [klass])[0]["p"]
    raise AssertionError("the migration has no contract " + klass)


def untracked_probes(env):
    """(old probe from the migration's rollback line, new probe after the migration's UPDATE) for fm-cf-obs-untracked."""
    sql = migration_sql()
    rb = [l for l in sql.splitlines() if l.startswith("-- Rollback:")][0][len("-- Rollback:"):]
    old = [x for x in rb.split("; ") if x.strip().startswith("UPDATE remediation_contracts SET verify_probe = ")]
    assert len(old) == 1, "the rollback line must restore the old fm-cf-obs-untracked probe"
    env.c.execute("INSERT INTO remediation_contracts (class, verify_probe, verify_transport, status) VALUES ('fm-cf-obs-untracked', 'x', 'd1-query', 'active')")
    env.c.execute(old[0].strip().rstrip(";"))
    old_probe = env.d1("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-cf-obs-untracked'")[0]["p"]
    ups = [st for st in migration_statements(sql) if st.startswith("UPDATE remediation_contracts SET verify_probe = ") and "fm-cf-obs-untracked" in st]
    assert len(ups) == 1, "the migration must update fm-cf-obs-untracked to the bridge gate"
    env.c.execute(ups[0])
    new_probe = env.d1("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-cf-obs-untracked'")[0]["p"]
    assert new_probe != old_probe
    env.c.execute(old[0].strip().rstrip(";"))   # the rollback really restores the old text
    assert env.d1("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-cf-obs-untracked'")[0]["p"] == old_probe
    env.c.execute(ups[0])
    return old_probe, new_probe


def dispatch(env, g):
    env.c.execute("INSERT INTO fleet_issue_dispatch VALUES (?, 'worker-observability', ?, 'tracked')",
                  ["cf-obs-" + g["id"], json.dumps({"id": g["id"], "title": g["title"], "lastObserved": int(g["lastObserved"]), "firstObserved": int(g["firstObserved"])})])


def test_untracked_detector_agrees_with_the_bridge_gate():
    """Second review, minor: fm-cf-obs-untracked must count a group exactly when the bridge would file it."""
    now = B.now_ms()
    cases = [   # (name, quiet_ms, closed_ago_ms or None, detector counts, bridge acts)
        ("quiet 5.7 h, no issue", int(5.7 * H), None, 0, False),
        ("quiet 1 h, issue closed 30 min ago (held)", 1 * H, int(0.5 * H), 0, False),
        ("recurred after the close (relapse)", 60e3, 3 * H, 1, True),
        ("live, never tracked", 1 * H, None, 1, True),
    ]
    old_counts = {}
    for name, quiet, closed_ago, want, acts in cases:
        env = Env([grp("g-x", "qnfo-ai", quiet, now)])
        g = env.groups["g-x"]
        dispatch(env, g)
        if closed_ago is not None:
            seed_closed(env, g, closed_ago)
        old_probe, new_probe = untracked_probes(env)
        old_counts[name] = int(env.d1(old_probe)[0]["observed"])
        got = int(env.d1(new_probe)[0]["observed"])
        r = env.sweep(now)
        acted = bool(r["filed"] or r["relapsed"])
        assert got == want and acted == acts, (name, got, want, acted, acts, r)
    assert old_counts["quiet 5.7 h, no issue"] == 1 and old_counts["quiet 1 h, issue closed 30 min ago (held)"] == 1, old_counts   # the conflict the old probe had


def test_loop_detector_ignores_pre_fix_reopens():
    now = B.now_ms()
    env = Env([grp("g-live", "qnfo-ai", 8 * H, now)])
    g = env.groups["g-live"]
    dispatch(env, g)
    iid = seed_closed(env, g, 3 * H)
    probe = migration_probe(env, "fm-cf-obs-bridge-refile-loop")
    # a flap-signature reopen (group quiet 8 h at the reopen) 30 minutes ago, logged by the old bridge just before the deploy
    env.c.execute("UPDATE analytics_metric_triggers SET created_at = datetime('now', '-10 minutes')")
    env.c.execute("INSERT INTO issue_lifecycle (issue_id, event, from_status, to_status, has_evidence, ts) VALUES (?, 'reopened', 'closed', 'open', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 minutes'))", [iid])
    assert env.d1(probe)[0]["observed"] == "0", env.d1(probe)
    env.c.execute("UPDATE analytics_metric_triggers SET created_at = datetime('now', '-3 hours')")   # the same reopen after the fix shipped is a live loop
    assert env.d1(probe)[0]["observed"] == "1", env.d1(probe)


def test_migration_trigger_is_shaped():
    sql = migration_sql()
    assert "code-task: repo=qnfo-workers path=scripts/cf_obs_issue_bridge.py" in sql and "code-anchor: FILE_H = QUIET_H - 0.5" in sql
    assert open(os.path.join(B.ROOT, "scripts", "cf_obs_issue_bridge.py")).read().count("FILE_H = QUIET_H - 0.5") == 1   # the anchor occurs once
    assert "'cf_obs_reopen_churn_24h <= 2 within 24 h'" in sql
    assert "DELETE FROM metric_authorship WHERE metric = 'cf_obs_reopen_churn_24h'" in [l for l in sql.splitlines() if l.startswith("-- Rollback:")][0]


D1_TITLE = "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a <duration> window"


def test_d1_overload_groups_fold_into_one_umbrella_issue():
    now = B.now_ms()
    env = Env([grp("g-a", "qnfo-social", 60e3, now, title=D1_TITLE, count=10),
               grp("g-b", "qnfo-fleet-control", 90e3, now, title="performanceLoopTick error: " + D1_TITLE, count=5),
               grp("g-c", "qnfo-pdf", 2 * H, now, title=D1_TITLE, count=3),
               grp("g-other", "qnfo-ai", 60e3, now)])
    r1 = env.sweep(now)
    assert r1["folded"] == 3 and r1["live"] == 1 and len(r1["filed"]) == 2, r1   # the umbrella plus the one unrelated group
    titles = [i["title"] for i in env.issues()]
    assert sum("D1 DB is overloaded" in t for t in titles) == 1, titles
    assert B.UMBRELLA_TITLE in titles and any("qnfo-ai" in t for t in titles), titles
    umb = [i for i in env.issues() if i["title"] == B.UMBRELLA_TITLE][0]
    assert "3 live" in umb["description"] and "18 occurrence" in umb["description"] and "qnfo-pdf" in umb["description"], umb
    assert "code-task:" not in umb["description"]
    r2 = env.sweep(now)
    assert r2["filed"] == [] and r2["already"] == 2 and r2["folded"] == 3, r2
    assert len(env.issues()) == 2


def test_umbrella_probe_fails_while_overload_is_live_and_passes_when_quiet():
    now = B.now_ms()
    env = Env([grp("g-a", "qnfo-social", 60e3, now, title=D1_TITLE)])
    env.sweep(now)
    umb = [i for i in env.issues() if i["title"] == B.UMBRELLA_TITLE][0]
    pr = env.d1("SELECT verify_probe FROM remediation_contracts WHERE class = 'issue-%d'" % umb["id"])[0]["verify_probe"]
    env.c.execute("INSERT INTO fleet_issue_dispatch VALUES ('cf-obs-x', 'worker-observability', ?, 'tracked')",
                  [json.dumps({"title": D1_TITLE, "lastObserved": now - 60e3})])
    assert env.d1(pr)[0]["observed"] == "0"
    env.c.execute("UPDATE fleet_issue_dispatch SET payload = ?", [json.dumps({"title": D1_TITLE, "lastObserved": now - 7 * H})])
    assert env.d1(pr)[0]["observed"] == "1"


# D1-OVERLOAD-UMBRELLA-PROBE-1: the two production triggers that overwrote the umbrella's probe (contract_probe_templates_family_birth and
# contract_probe_templates_family_reassert, migrations/2026-11-01-family-probe-at-birth.sql and 2026-11-04-relapse-hold-1.sql), reduced to what matters:
# a CF-OBS contract is born into module issue-birth-probe-families with a probe on fingerprint cf-obs-<id>, and any later write of verify_probe that
# lacks the closing "ELSE 'missing' END AS observed" is replaced by such a probe again.
FAMILY_TRIGGERS = """
CREATE TRIGGER family_birth AFTER INSERT ON remediation_contracts
WHEN NEW.status = 'needs-machine-probe' AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.id = NEW.issue_id AND a.title LIKE 'CF-OBS-ISSUE-1:%' AND instr(COALESCE(a.description, ''), 'cf-obs-id: ') > 0)
BEGIN
  UPDATE remediation_contracts SET status = 'active', module = 'issue-birth-probe-families',
    verify_probe = 'SELECT 1 AS expected, CASE WHEN EXISTS (SELECT 1 FROM fleet_issue_dispatch WHERE fingerprint = ''cf-obs-d1-overload'') THEN ''1'' ELSE ''missing'' END AS observed'
  WHERE class = NEW.class;
END;
CREATE TRIGGER family_reassert AFTER UPDATE OF verify_probe ON remediation_contracts
WHEN NEW.module = 'issue-birth-probe-families' AND instr(NEW.verify_probe, 'ELSE ''missing'' END AS observed') = 0
BEGIN
  UPDATE remediation_contracts SET verify_probe = 'SELECT 1 AS expected, CASE WHEN EXISTS (SELECT 1 FROM fleet_issue_dispatch WHERE fingerprint = ''cf-obs-d1-overload'') THEN ''1'' ELSE ''missing'' END AS observed'
  WHERE class = NEW.class;
END;
"""


def umbrella_contract(env):
    umb = [i for i in env.issues() if i["title"] == B.UMBRELLA_TITLE][0]
    return umb["id"], env.d1("SELECT verify_probe, module, status, attempts FROM remediation_contracts WHERE class = 'issue-%d'" % umb["id"])[0]


def test_umbrella_probe_survives_the_family_triggers_and_measures_both_sources():
    now = B.now_ms()
    env = Env([grp("g-a", "qnfo-social", 60e3, now, title=D1_TITLE)])
    env.c.executescript(FAMILY_TRIGGERS)
    env.sweep(now)
    iid, k = umbrella_contract(env)
    assert k["verify_probe"] == B.umbrella_probe() and k["module"] == B.UMBRELLA_MODULE and k["status"] == "active", k
    assert "missing" not in k["verify_probe"]
    # a sweep that finds the probe right writes nothing (attempts is reset only when the probe or module differs)
    env.c.execute("UPDATE remediation_contracts SET attempts = 3 WHERE class = 'issue-%d'" % iid)
    env.sweep(now)
    assert umbrella_contract(env)[1]["attempts"] == 3
    # the live drift of 2026-11-05: the family module and its probe on a fingerprint that is not a Cloudflare group; the next sweep repairs it
    env.c.execute("UPDATE remediation_contracts SET module = 'issue-birth-probe-families', verify_probe = 'SELECT 1 AS expected, ''missing'' AS observed', attempts = 5 WHERE class = 'issue-%d'" % iid)
    env.sweep(now)
    k = umbrella_contract(env)[1]
    assert k["verify_probe"] == B.umbrella_probe() and k["module"] == B.UMBRELLA_MODULE and k["attempts"] == 0, k
    pr = k["verify_probe"]
    ts = lambda ms: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ms / 1000))
    # nothing seen anywhere: passes
    assert env.d1(pr)[0]["observed"] == "1"
    # an overload group seen 1 h ago keeps it open even though Cloudflare says resolved (a resolved status alone is not quiet)
    env.c.execute("INSERT INTO fleet_issue_dispatch VALUES ('cf-obs-x', 'worker-observability', ?, 'resolved')", [json.dumps({"title": D1_TITLE, "lastObserved": now - 1 * H})])
    assert env.d1(pr)[0]["observed"] == "0"
    env.c.execute("UPDATE fleet_issue_dispatch SET payload = ?", [json.dumps({"title": D1_TITLE, "lastObserved": now - 7 * H})])
    assert env.d1(pr)[0]["observed"] == "1"
    # the LOOP-BREAKER-1 source: an error event with the overload text 1 h ago keeps it open, 7 h ago does not, another error never does
    env.c.execute("INSERT INTO cloud_ops_events (id, ts, kind, text, job, status, meta) VALUES ('e1', ?, 'x', 'fleet_tick: D1_ERROR: D1 DB is overloaded. Too many', 'qnfo-code-orchestrator', 'error', NULL)", [ts(B.now_ms() - 1 * H)])
    assert env.d1(pr)[0]["observed"] == "0"
    env.c.execute("UPDATE cloud_ops_events SET ts = ?", [ts(B.now_ms() - 7 * H)])
    assert env.d1(pr)[0]["observed"] == "1"
    env.c.execute("INSERT INTO cloud_ops_events (id, ts, kind, text, job, status, meta) VALUES ('e2', ?, 'x', 'tick', 'w', 'error', ?)", [ts(B.now_ms() - 1 * H), json.dumps({"error": "D1_ERROR: D1 DB is overloaded."})])
    assert env.d1(pr)[0]["observed"] == "0"
    env.c.execute("UPDATE cloud_ops_events SET status = 'ok'")
    env.c.execute("INSERT INTO cloud_ops_events (id, ts, kind, text, job, status) VALUES ('e3', ?, 'x', 'no such column: legacy_flag', 'w', 'error')", [ts(B.now_ms() - 1 * H)])
    assert env.d1(pr)[0]["observed"] == "1"


def test_quiet_overload_group_files_nothing():
    now = B.now_ms()
    env = Env([grp("g-q", "qnfo-pdf", 30 * H, now, title=D1_TITLE)])
    r = env.sweep(now)
    assert r["folded"] == 0 and r["filed"] == [] and env.issues() == [], r


TESTS = [
    test_d1_overload_groups_fold_into_one_umbrella_issue,
    test_umbrella_probe_fails_while_overload_is_live_and_passes_when_quiet,
    test_umbrella_probe_survives_the_family_triggers_and_measures_both_sources,
    test_quiet_overload_group_files_nothing,
    test_quiet_group_with_closed_issue_is_resolved_not_refiled,
    test_quiet_group_without_issue_is_not_filed,
    test_live_group_filed_once_and_probe_lifecycle,
    test_router_drill_503_is_skipped_when_drills_explain_occurrences,
    test_real_and_partially_explained_503_groups_are_filed,
    test_distinct_group_with_same_title_does_not_reopen_closed_issue,
    test_full_cycle_file_close_resolve_has_no_reopen,
    test_recurrence_after_close_is_a_relapse_not_a_filing,
    test_closed_title_guard_holds_a_group_that_has_not_recurred_since_the_close,
    test_metric_churn_is_written_each_sweep,
    test_metric_ignores_churn_logged_before_the_fix_shipped,
    test_a_failing_patch_does_not_skip_the_metric_or_the_run_row,
    test_a_failing_closed_row_select_does_not_skip_the_metric_or_insert_blind,
    test_an_unreadable_cloudflare_list_still_records_the_run,
    test_untracked_detector_agrees_with_the_bridge_gate,
    test_loop_detector_ignores_pre_fix_reopens,
    test_migration_trigger_is_shaped,
]


def run():
    failed = 0
    for t in TESTS:
        try:
            t()
            print("ok   " + t.__name__)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print("FAIL " + t.__name__ + ": " + type(e).__name__ + ": " + str(e)[:300])
    print("cf_obs_issue_bridge tests: %d/%d passed" % (len(TESTS) - failed, len(TESTS)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(run())
