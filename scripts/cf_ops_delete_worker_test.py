#!/usr/bin/env python3
"""Offline tests for DELETE-AFTER-UNBIND-1 (cf_ops_actions.py delete-worker, TP-9 lever 1, agent_issues 2025).

On 2026-10-06 PR 657 deleted qnfo-kaizen and qnfo-skill-sync while qnfo-ops (KAIZEN, SKILLSYNC) and qnfo-fleet-dashboard
(SVC_QNFO_KAIZEN) still had live service bindings to them, so every canonical deploy of the two binders failed with
Cloudflare 10143 until the bindings were removed out of band (GitHub #660). Proves: delete-worker reads every live script's
bindings first and refuses while any service binding targets the worker, naming each binder; it fails closed when the
script list or a binder's settings cannot be read; it ignores bindings to other workers and the target's own bindings; it
still refuses protected and unmarked workers before any census; an already-absent worker is a no-op; and with no binders
left it deletes and verifies. No DELETE is sent on any refusal.
Run: python3 scripts/cf_ops_delete_worker_test.py   (prints "N passed, 0 failed")
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cf_ops_actions as C  # noqa: E402

passed = failed = 0


def ok(cond, label, extra=None):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print("FAIL " + label + ("" if extra is None else " :: " + str(extra)[:300]))


root = tempfile.mkdtemp()
for d, marker in (("qnfo-kaizen", "RETIRED"), ("qnfo-folded", "FOLDED"), ("qnfo-unmarked", None)):
    os.makedirs(os.path.join(root, d), exist_ok=True)
    if marker:
        open(os.path.join(root, d, marker), "w").write("x")

LIVE = {"qnfo-ops", "qnfo-fleet-dashboard", "qnfo-gateway", "qnfo-kaizen", "qnfo-folded", "qnfo-unmarked"}
SETTINGS = {
    "qnfo-ops": [{"type": "service", "name": "KAIZEN", "service": "qnfo-kaizen"},
                 {"type": "service", "name": "GATEWAY", "service": "qnfo-gateway"},
                 {"type": "d1", "name": "AUDIT", "id": "x"}],
    "qnfo-fleet-dashboard": [{"type": "service", "name": "SVC_QNFO_KAIZEN", "service": "qnfo-kaizen"}],
    "qnfo-gateway": [],
    "qnfo-kaizen": [{"type": "service", "name": "SELF", "service": "qnfo-kaizen"}],
    "qnfo-folded": [],
    "qnfo-unmarked": [],
}
FAIL = {"list": False, "settings": None}
deletes, emitted = [], []
C.emit = lambda o: emitted.append(o)


def fake_call(method, path, token, body=None, timeout=60):
    if method == "GET" and path.endswith("/workers/scripts"):
        if FAIL["list"]:
            return 500, {}
        return 200, {"success": True, "result": [{"id": n} for n in sorted(LIVE)]}
    if method == "GET" and path.endswith("/settings"):
        w = path.split("/workers/scripts/")[1].split("/")[0]
        if w not in LIVE:
            return 404, {}
        if FAIL["settings"] == w:
            return 503, {}
        return 200, {"success": True, "result": {"bindings": SETTINGS.get(w, [])}}
    if method == "DELETE":
        w = path.split("/workers/scripts/")[1].split("?")[0]
        deletes.append(w)
        LIVE.discard(w)
        return 200, {"success": True}
    return 404, {}


C.call = fake_call
cwd = os.getcwd()
os.chdir(root)
try:
    ok(C.delete_worker("qnfo-ops", "a", "t") == 3 and emitted[-1]["refused"] == "protected" and not deletes, "a protected worker is refused before any census")
    ok(C.delete_worker("qnfo-unmarked", "a", "t") == 3 and "marker" in emitted[-1]["refused"] and not deletes, "an unmarked directory is refused")
    rc = C.delete_worker("qnfo-kaizen", "a", "t")
    ok(rc == 3 and not deletes, "a worker with live binders is not deleted", emitted[-1])
    ok(sorted(emitted[-1].get("binders") or []) == ["qnfo-fleet-dashboard:SVC_QNFO_KAIZEN", "qnfo-ops:KAIZEN"], "every binder is named, the target's own binding and other workers' bindings are not", emitted[-1].get("binders"))
    ok("unbind-service" in emitted[-1]["refused"], "the refusal names the repair (unbind-service)")
    FAIL["list"] = True
    ok(C.delete_worker("qnfo-folded", "a", "t") == 1 and "census failed" in emitted[-1]["refused"] and not deletes, "an unreadable script list fails closed")
    FAIL["list"] = False
    FAIL["settings"] = "qnfo-gateway"
    ok(C.delete_worker("qnfo-folded", "a", "t") == 1 and "census failed" in emitted[-1]["refused"] and not deletes, "an unreadable binder settings fails closed")
    FAIL["settings"] = None
    SETTINGS["qnfo-ops"] = [b for b in SETTINGS["qnfo-ops"] if b["name"] != "KAIZEN"]
    ok(C.delete_worker("qnfo-kaizen", "a", "t") == 3 and emitted[-1].get("binders") == ["qnfo-fleet-dashboard:SVC_QNFO_KAIZEN"] and not deletes, "one remaining binder still blocks the delete")
    SETTINGS["qnfo-fleet-dashboard"] = []
    rc = C.delete_worker("qnfo-kaizen", "a", "t")
    ok(rc == 0 and deletes == ["qnfo-kaizen"] and emitted[-1]["ok"] and emitted[-1]["verify_settings_http"] == 404, "with no binders left the worker is deleted and verified", emitted[-1])
    ok(C.delete_worker("qnfo-kaizen", "a", "t") == 0 and emitted[-1].get("already_absent") and deletes == ["qnfo-kaizen"], "a second run is a no-op")
    ok(C.delete_worker("qnfo-folded", "a", "t") == 0 and deletes == ["qnfo-kaizen", "qnfo-folded"], "a FOLDED worker with no binders is deleted")

    # ARCHIVE-MARKER-READ-1 (RM-REPO-DEAD-SOURCES-1): a RETIRED/FOLDED directory moved to archive/<name>/ keeps its marker, and
    # every marker reader finds it there; a directory with no marker anywhere is still refused.
    def mkdir_with(rel, marker=None, toml=None):
        os.makedirs(os.path.join(root, *rel.split("/")), exist_ok=True)
        if marker:
            open(os.path.join(root, *rel.split("/"), marker), "w").write("x")
        if toml:
            open(os.path.join(root, *rel.split("/"), "wrangler.toml"), "w").write(toml)

    mkdir_with("archive/qnfo-arch", "RETIRED", 'name = "qnfo-arch"\n')
    mkdir_with("archive/skills-discovery", "FOLDED", 'name = "qnfo-skills-discovery"\n[[d1_databases]]\nbinding = "DB"\ndatabase_id = "db-archived-id"\n')
    mkdir_with("archive/qnfo-arch-nomark", None, 'name = "qnfo-arch-nomark"\n[[d1_databases]]\nbinding = "DB"\ndatabase_id = "db-unmarked-archive-id"\n')
    mkdir_with("qnfo-twin", None, 'name = "qnfo-twin"\n[[d1_databases]]\nbinding = "DB"\ndatabase_id = "db-live-id"\n')
    mkdir_with("archive/qnfo-twin", "RETIRED", 'name = "qnfo-twin"\n')
    LIVE.update({"qnfo-arch", "qnfo-skills-discovery", "qnfo-arch-nomark", "qnfo-twin"})
    for w in ("qnfo-arch", "qnfo-skills-discovery", "qnfo-arch-nomark", "qnfo-twin"):
        SETTINGS[w] = []
    ok(C.retirement_marker("qnfo-arch") == "RETIRED" and C.repo_dir("qnfo-arch") == os.path.join(".", "archive", "qnfo-arch"), "the marker of an archived directory is found under archive/<name>", C.repo_dir("qnfo-arch"))
    ok(C.retirement_marker("qnfo-skills-discovery") == "FOLDED" and C.repo_dir("qnfo-skills-discovery") == os.path.join(".", "archive", "skills-discovery"), "an archived directory is found by the worker name its wrangler.toml declares", C.repo_dir("qnfo-skills-discovery"))
    ok(C.retirement_marker("qnfo-arch-nomark") is None and C.retirement_marker("nowhere-at-all") is None, "an archived directory with no marker, and a name with no directory, have no marker")
    ok(C.repo_dir("../" + os.path.basename(root)) is None and C.repo_dir("a/b") is None and C.repo_dir("..") is None and C.repo_dir("") is None, "a name that is not a plain directory name resolves to nothing (no path traversal)")
    ok(C.retirement_marker("qnfo-twin") is None and C.repo_dir("qnfo-twin") == os.path.join(".", "qnfo-twin"), "a top-level directory wins over its archive twin, so an unmarked live directory is not shadowed by a marked copy")
    before = list(deletes)
    ok(C.delete_worker("qnfo-twin", "a", "t") == 3 and "marker" in emitted[-1]["refused"] and deletes == before, "delete-worker refuses a top-level unmarked directory even when a marked archive twin exists")
    ok(C.delete_worker("qnfo-arch-nomark", "a", "t") == 3 and "marker" in emitted[-1]["refused"] and deletes == before, "delete-worker refuses an archived directory that lost its marker")
    ok(C.delete_worker("qnfo-never-had-a-dir", "a", "t") == 3 and "marker" in emitted[-1]["refused"] and deletes == before, "delete-worker refuses a name with no repository directory anywhere")
    rc = C.delete_worker("qnfo-arch", "a", "t")
    ok(rc == 0 and emitted[-1]["ok"] and emitted[-1]["marker"] == "RETIRED" and deletes == before + ["qnfo-arch"], "delete-worker finds the RETIRED marker under archive/qnfo-arch and deletes", emitted[-1])
    rc = C.delete_worker("qnfo-skills-discovery", "a", "t")
    ok(rc == 0 and emitted[-1]["ok"] and emitted[-1]["marker"] == "FOLDED" and deletes == before + ["qnfo-arch", "qnfo-skills-discovery"], "delete-worker finds the FOLDED marker of an archive directory by its declared worker name", emitted[-1])

    # Vectorize index delete reads the owner's marker the same way.
    C.VECTORIZE_RETIRED["qnfo-test-index"] = "qnfo-arch"
    vcalls = []

    def vec_call(method, path, token, body=None, timeout=60):
        vcalls.append(method)
        return (404, {}) if method == "GET" else (200, {"success": True})

    C.call = vec_call
    rc = C.delete_vectorize_index("qnfo-test-index", "a", "t")
    ok(rc == 0 and emitted[-1].get("already_absent") and emitted[-1]["marker"] == "RETIRED", "delete-vectorize-index finds the owner's marker under archive/", emitted[-1])
    C.VECTORIZE_RETIRED["qnfo-test-index"] = "qnfo-arch-nomark"
    ok(C.delete_vectorize_index("qnfo-test-index", "a", "t") == 3 and "marker" in emitted[-1]["refused"], "delete-vectorize-index still refuses an owner directory with no marker anywhere")
    C.VECTORIZE_RETIRED.pop("qnfo-test-index")
    C.call = fake_call

    # D1 binder scans: a marked archive directory that names a database id is not a live binder, a top-level unmarked
    # directory is, and an archive directory that lost its marker is (fail-safe, it blocks a database delete).
    ok(C.wrangler_binders("db-archived-id") == [], "a marked archived directory is not a live D1 binder")
    ok(C.wrangler_binders("db-live-id") == ["qnfo-twin"], "a top-level unmarked directory is a live D1 binder", C.wrangler_binders("db-live-id"))
    ok(C.wrangler_binders("db-unmarked-archive-id") == ["archive/qnfo-arch-nomark"], "an archive directory with no marker still counts as a binder", C.wrangler_binders("db-unmarked-archive-id"))
    mkdir_with("archive/qnfo-store", "RETIRED", 'name = "qnfo-store"\n[[secrets_store_secrets]]\nbinding = "X"\nsecret_name = "N"\n')
    ok(all(w != "qnfo-store" for w, _b, _s in C.declared_store_bindings()), "a marked archived directory declares no live Secrets Store binding")
finally:
    os.chdir(cwd)

print(str(passed) + " passed, " + str(failed) + " failed")
sys.exit(1 if failed else 0)
