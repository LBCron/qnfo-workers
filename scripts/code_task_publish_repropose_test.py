#!/usr/bin/env python3
"""Offline test for WORKFLOW-SCRIPT-FIXES-1 (workflow failure audit 2026-10-20, run 39124945342; scripts/code-task-publish.py).

REPROPOSE-TRIGGER-COUNT-1: repropose() read `n != 1` from store.changes() as "the insert failed". D1 reports meta.changes from the
connection's total changes, so the AFTER INSERT trigger queue_pulls_code_task_ai (goal headed "[issue #N]") and code_tasks_repo_slug_ai
make a clean insert report 2, and ct_n6u8tqjg0xalz4 raised "the successor row was not written" while ct_6stuyid3pw7mfz existed (a red
run, and the reproposed_as link skipped). The check now fails only when the count is below one AND the row is not there.
PUBLISH-SELFTEST-QUIET-1: the offline selftest's red-on-purpose fixture suite printed a ::notice:: that sat on every run's annotations.
PUBLISH-NOPATCH-ATTRIBUTION-1: the "no patch" refusal names the ctx keys, step and model of the row, keeping its leading text.

Run: python3 scripts/code_task_publish_repropose_test.py   (prints "N passed, 0 failed")
"""
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location("code_task_publish", os.path.join(HERE, "code-task-publish.py"))
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)

passed = failed = 0


def ok(cond, msg, extra=None):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print("FAIL " + msg + ((" :: " + str(extra)[:400]) if extra is not None else ""))


TRIGGER = ("CREATE TRIGGER queue_pulls_code_task_ai AFTER INSERT ON code_tasks WHEN instr(COALESCE(NEW.goal, ''), '[issue #') = 1 "
           "BEGIN INSERT OR IGNORE INTO queue_pulls (puller, issue_id, via, ref) "
           "VALUES ('qnfo-code-orchestrator', CAST(substr(NEW.goal, 9) AS INTEGER), 'code_task', NEW.id); END")


def d1_like_store():
    """A store that counts like D1 and carries the live queue_pulls trigger (migrations/2026-10-12-21-tick-driver-roster.sql)."""
    db = sqlite3.connect(":memory:")
    db.execute(P.DDL)
    db.execute("CREATE TABLE queue_pulls (puller TEXT, issue_id INTEGER, via TEXT, ref TEXT, UNIQUE (via, ref))")
    db.execute(TRIGGER)
    return P.SqliteD1Store(db)


def old_task(store, tid, goal):
    store.changes("INSERT INTO code_tasks (id,repo,path,goal,status,step,ctx,created_at,updated_at) VALUES (?,?,?,?,?,'done',?,?,?)",
                  [tid, P.REPO_NAME, "scripts/x.py", goal, "superseded", json.dumps({"anchor": "def f():"}), P.now(), P.now()])
    return store.rows("SELECT * FROM code_tasks WHERE id=?", [tid])[0]


# 1. the premise: D1 counts the trigger's row, so a clean insert of an issue-headed goal reports more than one change
store = d1_like_store()
n = store.changes("INSERT INTO code_tasks (id,repo,path,goal,status,step,ctx,created_at,updated_at) VALUES (?,?,?,?,?,'read',?,?,?)",
                  ["ct_probe0000001", P.REPO_NAME, "scripts/x.py", "[issue #2727] g", "queued", "{}", P.now(), P.now()])
ok(n == 2, "premise: an insert of a '[issue #N]'-headed goal reports 2 changes under D1 counting (row + queue_pulls trigger row)", n)

# 2. repropose of an issue-headed task: the successor is written, linked, and no error is logged
logs = []
t = old_task(store, "ct_old000000001", "[issue #2727] RUM-ZERO-DAY-1: a stored false zero")
nid = P.repropose(store, t, logs.append)
linked = json.loads(store.rows("SELECT ctx FROM code_tasks WHERE id=?", ["ct_old000000001"])[0]["ctx"]).get("reproposed_as")
ok(nid is not None and linked == nid, "an issue-headed task is reproposed and linked (reproposed_as) despite the trigger row", (nid, linked, logs))
ok(not [m for m in logs if "::error::" in m], "no 'successor row was not written' alarm for a successor that was written", logs)
succ = store.rows("SELECT * FROM code_tasks WHERE id=?", [nid])[0] if nid else {}
ok(succ.get("status") == "queued" and succ.get("goal", "").startswith("[issue #2727]") and "reproposed from ct_old000000001" in succ.get("goal", ""),
   "the successor keeps the [issue #N] head and the provenance note", succ)

# 3. a plain goal (no trigger row) still works
logs = []
t = old_task(store, "ct_old000000002", "plain goal without an issue head")
nid2 = P.repropose(store, t, logs.append)
ok(nid2 is not None and not logs, "a goal without the issue head is reproposed as before", (nid2, logs))


# 4. an insert that did not land is still reported: nothing written and no such row
class Stub:
    def __init__(self, changes, present):
        self._changes, self._present, self.sql = changes, present, []

    def changes(self, sql, params=()):
        self.sql.append(sql)
        return self._changes if sql.startswith("INSERT") else 1

    def rows(self, sql, params=()):
        return [{"present": 1}] if self._present else []


logs = []
r = P.repropose(Stub(0, False), {"id": "ct_old000000003", "repo": P.REPO_NAME, "path": "scripts/x.py", "goal": "g", "ctx": "{}"}, logs.append)
ok(r is None and len(logs) == 1 and "the successor row was not written" in logs[0], "a count of 0 with no row is still an error and returns None", (r, logs))

# 5. a count of 0 with the row present (an under-reporting store) is not an alarm
logs = []
stub = Stub(0, True)
r = P.repropose(stub, {"id": "ct_old000000004", "repo": P.REPO_NAME, "path": "scripts/x.py", "goal": "g", "ctx": "{}"}, logs.append)
ok(r is not None and not logs and any(s.startswith("UPDATE code_tasks SET ctx=json_set") for s in stub.sql), "a count of 0 with the row present links the successor, no alarm", (r, logs))

# 6. a task whose explicit target disagrees with its path is rebuilt from the declared file, not published as the wrong change
store = d1_like_store()
goal = ("[issue #1000619] Add /sla-gap to backlog-exec\n"
        "code-task: repo=qnfo-workers path=qnfo-backlog-exec/worker.js")
old_id = "ct_pathmismatch01"
store.changes("INSERT INTO code_tasks (id,repo,path,goal,status,step,attempts,ctx,branch,created_at,updated_at) "
              "VALUES (?,?,?,?, 'ready_to_publish','done',0,?,?,?,?)",
              [old_id, P.REPO_NAME, "qnfo-lifecycle/worker.js", goal,
               json.dumps({"anchor": "if (url.pathname === \"/inventory\") {", "extras": [{"path": "qnfo-lifecycle/test.mjs"}],
                           "patch": "diff --git a/qnfo-lifecycle/worker.js b/qnfo-lifecycle/worker.js\n"
                                    "--- a/qnfo-lifecycle/worker.js\n+++ b/qnfo-lifecycle/worker.js\n@@ -1 +1 @@\n-old\n+new\n"}),
               "codeagent-pathmismatch", P.now(), P.now()])
logs = []
out = P.publish_all(store, "/nonexistent", "main", None, logs.append)
successor_id = store.rows("SELECT id FROM code_tasks WHERE id<>?", [old_id])[0]["id"]
successor = store.rows("SELECT * FROM code_tasks WHERE id=?", [successor_id])[0]
successor_ctx = json.loads(successor["ctx"])
ok(out["reproposed"] == 1 and out["failed"] == 0, "a mismatched target is requeued instead of published or failed", (out, logs))
ok(store.rows("SELECT status FROM code_tasks WHERE id=?", [old_id])[0]["status"] == "superseded"
   and successor["path"] == "qnfo-backlog-exec/worker.js" and successor["status"] == "queued",
   "the successor starts on the explicit target path with a fresh read", successor)
ok(successor_ctx.get("path_directive") is True and "anchor" not in successor_ctx and "extras" not in successor_ctx
   and "CODE-TASK-PATH-DIRECTIVE-1" in successor["goal"],
   "path-specific context is not carried to the retargeted task", (successor_ctx, successor["goal"]))

# 7. forbidden and ambiguous target declarations never widen the publisher's path policy
ok(P.explicit_task_path({"goal": "code-task: repo=qnfo-workers path=qnfo-ops/wrangler.toml"}) is None,
   "a denied wrangler target is not accepted")
ok(P.explicit_task_path({"goal": "code-task: repo=qnfo-workers path=qnfo-a/worker.js\n"
                               "code-task: repo=qnfo-workers path=qnfo-b/worker.js"}) is None,
   "ambiguous target declarations are not retargeted")


# 8. the offline selftest leaves no ::notice::/::warning::/::error:: line for the Actions annotations
run = subprocess.run([sys.executable, os.path.join(HERE, "code-task-publish.py"), "--selftest"], capture_output=True, text=True, timeout=600)
ann = [ln for ln in run.stdout.splitlines() if ln.startswith("::")]
ok(run.returncode == 0 and "selftest: 0 failure(s)" in run.stdout, "the selftest passes", run.stdout[-300:])
ok(not ann, "the selftest prints no workflow-command annotation line (the red.test.mjs fixture notice no longer reaches the run page)", ann)

# 7. the no-patch refusal names its producer and keeps the text the fm-code-task-lease-lost-write detector matches
task = {"id": "ct_nopatch000001", "repo": P.REPO_NAME, "path": "scripts/x.py", "step": "verify", "model": "glm-5.3-flash",
        "ctx": json.dumps({"mode": "patch", "base": "x" * 50, "edits": [{"search": "a", "replace": "b"}]})}
status, url, err, note = P.publish_one(task, "/nonexistent", "main", None)
ok(status == "publish_failed" and str(err).startswith("task has no patch in ctx.patch"), "the no-patch refusal keeps its leading text", err)
ok("ctx keys: base,edits,mode" in str(err) and "step=verify" in str(err) and "model=glm-5.3-flash" in str(err), "the no-patch refusal names the ctx keys, step and model", err)
ok("no patch in ctx.patch" in str(err), "the detector's LIKE '%no patch in ctx.patch%' still matches", err)
status, url, err, note = P.publish_one({"id": "ct_nopatch000002", "repo": P.REPO_NAME, "path": "scripts/x.py", "ctx": "{}"}, "/nonexistent", "main", None)
ok(str(err).startswith("task has no patch in ctx.patch") and "ctx keys: none" in str(err) and "step=none" in str(err), "an empty ctx and a row without step or model are described, not raised", err)

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
