#!/usr/bin/env python3
"""Offline test for the canary's VERSION parse (CANARY-VERSION-REGEX-1, no network).

qnfo-gateway may have generated or explanatory comments before its VERSION declaration. This suite parses the real worker
files in the repo and asserts that the canary, version-bump-guard.py and canonical_deploy.py read the same VERSION, and that
no CANARY_WORKERS entry is unwatched.
"""
import glob
import importlib.util
import json
import os
import re
import sys
import tempfile
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)


def load(name, fname):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, fname))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cr = load("canary_revert", "canary_revert.py")
vbg = load("version_bump_guard", "version-bump-guard.py")
cd = load("canonical_deploy", "canonical_deploy.py")


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8", errors="replace") as fh:
        return fh.read()


class T(unittest.TestCase):
    def test_gateway_version_is_watched(self):
        source = read("qnfo-gateway/worker.js")
        self.assertRegex(source, r'(?m)^var\s+VERSION\s*=\s*["\']', "qnfo-gateway has a line-start VERSION declaration")
        v = cr.read_version(source)
        self.assertTrue(v and re.match(r"^\d+\.\d+\.\d+", v), "canary reads a VERSION from qnfo-gateway/worker.js, got %r" % (v,))

    def test_forms_the_fleet_writes(self):
        for src, want in (
            ('var VERSION="3.26.1-gw-json-quiet";;\n', "3.26.1-gw-json-quiet"),
            ('var VERSION="1.0.1-x";const V=VERSION;\n', "1.0.1-x"),
            ('var VERSION = "0.7.0-a"; /* c */\n', "0.7.0-a"),
            ('x\nvar  VERSION  =  "2.0.0";\n', "2.0.0"),
        ):
            self.assertEqual(cr.read_version(src), want, src)

    def test_non_declarations_stay_unread(self):
        for src in ("nothing", "var VERSION = FLEET_EXEC_VERSION;", "  var VERSION = \"1.0.0\";", "const VERSION = \"1.0.0\";", "var VERSION = '1.0.0';"):
            self.assertIsNone(cr.read_version(src), src)

    def test_revert_bump_keeps_the_line_as_written(self):
        r = cr.bump_for_revert('var VERSION="3.26.1-gw";; /* c */\nb', "3.26.2-bad", "-revert-abc1234")
        self.assertEqual(r, ("3.26.3-revert-abc1234", 'var VERSION="3.26.3-revert-abc1234";; /* c */\nb'))
        r = cr.bump_for_revert('a\nvar VERSION = "0.6.1-base";\nb', "0.7.0-bad", "-r")
        self.assertEqual(r, ("0.7.1-r", 'a\nvar VERSION = "0.7.1-r";\nb'))
        self.assertIsNone(cr.bump_for_revert('var VERSION="1";;\nvar VERSION = "2";', "1.0.0", "-r"))

    def test_every_canary_worker_is_watched(self):
        missing = []
        for w in cr.CANARY_WORKERS:
            if not cr.read_version(read(w + "/worker.js")):
                missing.append(w)
        self.assertEqual(missing, [], "CANARY_WORKERS with no VERSION line the canary can read: %s" % missing)

    def test_canary_guard_and_deploy_read_the_same_version(self):
        # the three parsers must agree on every worker the canary watches, and on the gateway's mirror
        for w in cr.CANARY_WORKERS:
            for fname in ("worker.js", "deployed-current.worker.js"):
                path = os.path.join(w, fname)
                if not os.path.exists(os.path.join(ROOT, path)):
                    continue
                text = read(path)
                a, b, c = cr.read_version(text), vbg.version_of(text), cd.repo_version(os.path.join(ROOT, path))
                self.assertTrue(a, path)
                self.assertTrue(a == b == c, "%s: canary %r, version-bump-guard %r, canonical_deploy %r" % (path, a, b, c))

    def test_no_line_start_declaration_is_unread(self):
        # every worker.js that declares VERSION as a quoted literal at the start of a line is readable by the canary,
        # whatever its spacing; list (not fail) the workers that declare none in that form, they carry QNFO_VERSION or a comment header.
        decl = re.compile(r'^var\s+VERSION\s*=\s*"', re.M)
        unread, none = [], []
        for f in sorted(glob.glob(os.path.join(ROOT, "*", "worker.js"))):
            rel = os.path.relpath(f, ROOT)
            text = read(rel)
            if decl.search(text):
                if not cr.read_version(text):
                    unread.append(rel)
            else:
                none.append(rel)
        print("workers with no line-start `var VERSION = \"..\"` literal (not parsed by the canary, none is in CANARY_WORKERS): %d" % len(none))
        for rel in none:
            print("  " + rel)
        self.assertEqual(unread, [], "line-start VERSION literals the canary cannot read: %s" % unread)
        self.assertFalse([w for w in cr.CANARY_WORKERS if w + "/worker.js" in none], "a CANARY_WORKERS entry has no VERSION literal")

    # CANARY-AHEAD-1 (agent_issues 1000171): the incident replayed through run(). Push 7a9d293 carried 3.31.2-seo-index-8, a commit 15 s later
    # deployed 3.31.3-seo-index-9, /health answered the later version, and the canary reverted the healthy worker (3595289a) after 25 polls.
    def _run_canary(self, pushed_version, live_health):
        calls = {"revert": [], "issue": [], "functional": [], "ahead": []}
        clock = {"t": 0.0}
        names = ["git", "git_show", "fetch_health", "revert_push", "file_issue", "functional", "record_functional", "record_ahead", "poll"]
        saved = {n: getattr(cr, n) for n in names}
        real_poll = cr.poll
        cr.git = lambda args, check=True: 'var VERSION = "%s";\n' % pushed_version
        # DEPLOY-PROBES-1: qnfo-gateway's real probes.json and wrangler.toml at the pushed commit, nothing at its parent
        cr.git_show = lambda ref, path: read(path) if ref == "7a9d2935424f8ce69eb5f7e774930ccf27a5163d" and path in ("qnfo-gateway/probes.json", "qnfo-gateway/wrangler.toml") else None
        cr.fetch_health = lambda worker, timeout=10: live_health
        cr.revert_push = lambda pushed, failed, dry, why=None, bystanders=None: calls["revert"].append(failed) or {"sha": "r" * 40, "redeploy": ["canonical-deploy.yml"]}
        cr.file_issue = lambda *a, **k: calls["issue"].append(a) or "filed"
        cr.functional = lambda workers, *a, **k: calls["functional"].append(list(workers)) or {}
        cr.record_functional = lambda *a, **k: None
        cr.record_ahead = lambda acct, token, pushed, results: calls["ahead"].append(sorted(w for w, r in results.items() if r["state"] == "ahead")) or "ok"
        cr.poll = lambda wanted, minutes, poll_sec, **k: real_poll(wanted, minutes, poll_sec, fetch=cr.fetch_health, clock=lambda: clock["t"], sleep=lambda sec: clock.__setitem__("t", clock["t"] + sec))
        old_env = {k: os.environ.get(k) for k in ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CANARY_FUNCTIONAL")}
        os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_API_TOKEN"] = "acct", "tok"
        os.environ.pop("CANARY_FUNCTIONAL", None)
        out = []
        real_emit = cr.emit
        cr.emit = out.append
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as fh:
            fh.write("qnfo-gateway qnfo-gateway/worker.js\n")
            targets = fh.name
        try:
            a = types.SimpleNamespace(targets=targets, pushed="7a9d2935424f8ce69eb5f7e774930ccf27a5163d", canary_min=8, poll_sec=20, dry_run=False,
                                      no_revert=False, functional=None, functional_tries=1, functional_wait=0)
            rc = cr.run(a)
        finally:
            cr.emit = real_emit
            for n, f in saved.items():
                setattr(cr, n, f)
            for k, v in old_env.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
            os.unlink(targets)
        return rc, calls, out, clock["t"]

    def test_a_later_push_deployed_is_not_a_failed_deploy(self):
        rc, calls, out, waited = self._run_canary("3.31.2-seo-index-8", {"status": "ok", "version": "3.31.3-seo-index-9"})
        self.assertEqual(rc, 0)
        self.assertEqual(calls["revert"], [], "a live VERSION ahead of the pushed one must not revert the push")
        self.assertEqual(calls["issue"], [], "and files no CONTROL-PLANE-REVERTED-1 issue")
        self.assertEqual(calls["functional"], [[]], "the functional step is the later push's: nothing is checked for an ahead worker")
        self.assertEqual(waited, 0.0, "it answers at the first poll instead of waiting out the window")
        self.assertEqual(calls["ahead"], [["qnfo-gateway"]], "the avoided revert is written once to the ledger (record_ahead), not only logged")
        text = "\n".join(out)
        self.assertIn("CANARY-AHEAD-1", text)
        self.assertIn("canary: ahead ledger ok", text)
        self.assertIn("qnfo-gateway ahead (wanted 3.31.2-seo-index-8, saw 3.31.3-seo-index-9, 1 polls)", text)

    def test_a_lower_or_unarrived_version_still_reverts(self):
        for live in ({"status": "ok", "version": "3.31.1-older"}, {"status": "ok", "version": "3.31.2-other-suffix"}, {"status": "ok"}, None):
            rc, calls, out, waited = self._run_canary("3.31.2-seo-index-8", live)
            self.assertEqual(rc, 0)
            self.assertEqual(len(calls["revert"]), 1, "live %r: a push whose VERSION never arrived is still reverted" % (live,))
            self.assertEqual(len(calls["issue"]), 1, "live %r: and the issue is still filed" % (live,))
            self.assertGreaterEqual(waited, 8 * 60, "live %r: after the whole window" % (live,))
            self.assertEqual(calls["ahead"], [], "live %r: nothing is recorded as ahead" % (live,))
            self.assertNotIn("CANARY-AHEAD-1", "\n".join(out))

    def test_the_exact_version_still_runs_the_functional_step(self):
        rc, calls, out, waited = self._run_canary("3.31.2-seo-index-8", {"status": "ok", "version": "3.31.2-seo-index-8"})
        self.assertEqual((rc, calls["revert"], calls["functional"], calls["ahead"]), (0, [], [["qnfo-gateway"]], []))
        self.assertNotIn("CANARY-AHEAD-1", "\n".join(out))

    def test_record_ahead_writes_one_ledger_row_per_run(self):
        import apply_migrations
        writes = []
        real_d1 = apply_migrations.d1
        apply_migrations.d1 = lambda acct, token, db_id, sql, params=None: writes.append((acct, db_id, sql, params)) or []
        try:
            results = {"qnfo-gateway": {"want": "3.31.2-seo-index-8", "state": "ahead", "seen": "3.31.3-seo-index-9", "polls": 1},
                       "qnfo-ops": {"want": "2.0.0", "state": "ok", "seen": "2.0.0", "polls": 2}}
            self.assertEqual(cr.record_ahead("acct", "tok", "7a9d2935424f8ce69eb5f7e774930ccf27a5163d", results), "ok")
            self.assertEqual(cr.record_ahead("acct", "tok", "7a9d293", {"qnfo-ops": results["qnfo-ops"]}), None, "an exact-version run records nothing")
            self.assertEqual(cr.record_ahead(None, None, "7a9d293", results), None, "and no credential records nothing")
        finally:
            apply_migrations.d1 = real_d1
        self.assertEqual(len(writes), 1)
        acct, db_id, sql_text, params = writes[0]
        self.assertEqual((acct, db_id), ("acct", cr.DB_ID))
        self.assertIn("INSERT OR REPLACE INTO cloud_ops_events", sql_text)
        self.assertIn("'canary-ahead'", sql_text)
        self.assertEqual(params[0], "canary-ahead-7a9d2935424f-qnfo-gateway")
        self.assertEqual(params[1], "CANARY-AHEAD-1 push 7a9d293: qnfo-gateway wanted 3.31.2-seo-index-8, live 3.31.3-seo-index-9 is ahead after 1 poll")
        meta = json.loads(params[2])
        self.assertEqual((meta["workers"], meta["want"], meta["seen"]), (["qnfo-gateway"], {"qnfo-gateway": "3.31.2-seo-index-8"}, {"qnfo-gateway": "3.31.3-seo-index-9"}))


# DEPLOY-PROBES-1: the generalised functional step, replayed through run() for a worker outside the control plane.
dp = cr.DP  # the module instance canary_revert uses, so patching dp.fetch_text reaches it
PUSHED = "c0ffee1c0ffee1c0ffee1c0ffee1c0ffee1c0ffe"
WORKER = "qnfo-evolve"
DECL = {"mode": "revert", "health": "https://qnfo-evolve.q08.workers.dev/health",
        "http": [{"url": "https://qnfo-evolve.q08.workers.dev/health", "contains": ["MARKER"]}]}


class ProbeFlow(unittest.TestCase):
    def _run(self, answer, decl=DECL, base_decl=DECL, baseline=None, created=False, later=None, no_revert=False, health_version="1.0.1", files=None, wrangler='name = "qnfo-evolve"\n', d1=None):
        calls = {"revert": [], "issue": [], "probe_issue": []}
        names = ["git", "git_show", "fetch_health", "revert_push", "file_issue", "file_probe_issue", "record_functional", "record_ahead", "later_commits", "changed_files", "emit", "poll"]
        saved = {n: getattr(cr, n) for n in names}
        saved_fetch, saved_d1 = dp.fetch_text, dp.d1_explain
        cr.git = lambda args, check=True: 'var VERSION = "1.0.1";\n'
        cr.changed_files = lambda pushed: list(files if files is not None else [WORKER + "/worker.js"])
        if d1 is not None:
            dp.d1_explain = lambda acct_, token_, db_id, sql: d1

        def show(ref, path):
            if path == WORKER + "/wrangler.toml":
                return wrangler
            if path == WORKER + "/probes.json":
                d = decl if ref == PUSHED else base_decl
                return None if d is None else json.dumps(d)
            if path == WORKER + "/worker.js":
                return "x"
            return None
        cr.git_show = show
        cr.fetch_health = lambda worker, timeout=10: {"version": health_version}
        cr.revert_push = lambda pushed, failed, dry, why=None, bystanders=None: calls["revert"].append((failed, why, bystanders)) or {"sha": "r" * 40, "redeploy": ["canonical-deploy.yml"]}
        cr.file_issue = lambda *a, **k: calls["issue"].append(a) or "filed"
        cr.file_probe_issue = lambda acct, token, pushed, worker, probes, kind: calls["probe_issue"].append((worker, kind, [q["reason"] for q in probes])) or "filed"
        cr.record_functional = lambda *a, **k: None
        cr.record_ahead = lambda *a, **k: None
        cr.later_commits = lambda pushed, d: list(later or [])
        clock = {"t": 0.0}
        real_poll = cr.poll
        cr.poll = lambda wanted, minutes, poll_sec, **k: real_poll(wanted, minutes, poll_sec, fetch=cr.fetch_health, clock=lambda: clock["t"], sleep=lambda sec: clock.__setitem__("t", clock["t"] + sec))
        out = []
        cr.emit = out.append
        dp.fetch_text = lambda url, timeout=25: answer
        old_env = {k: os.environ.get(k) for k in ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CANARY_FUNCTIONAL")}
        os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_API_TOKEN"] = "acct", "tok"
        os.environ.pop("CANARY_FUNCTIONAL", None)
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as fh:
            fh.write(WORKER + " " + WORKER + "/worker.js" + (" create" if created else "") + "\nqnfo-other qnfo-other/worker.js\n")
            targets = fh.name
        bfile = None
        if baseline is not None:
            with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
                json.dump({WORKER: baseline}, fh)
                bfile = fh.name
        try:
            a = types.SimpleNamespace(targets=targets, pushed=PUSHED, canary_min=1, poll_sec=1, dry_run=False, no_revert=no_revert, functional=None,
                                      functional_tries=2, functional_wait=0, baseline_file=bfile, base=None)
            real_sleep = cr.time.sleep
            cr.time.sleep = lambda s_: None
            try:
                rc = cr.run(a)
            finally:
                cr.time.sleep = real_sleep
        finally:
            for n, f in saved.items():
                setattr(cr, n, f)
            dp.fetch_text, dp.d1_explain = saved_fetch, saved_d1
            for k, v in old_env.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
            os.unlink(targets)
            if bfile:
                os.unlink(bfile)
        return rc, calls, out

    def key(self):
        return dp.probe_list(DECL)[0][0]

    def test_a_probe_that_passed_before_and_fails_after_reverts_the_push(self):
        rc, calls, out = self._run((200, "no marker here"), baseline=None)
        self.assertEqual(rc, 0)
        self.assertEqual(len(calls["revert"]), 1, "a regression reverts the push")
        failed, why, bystanders = calls["revert"][0]
        self.assertEqual(failed, [(WORKER, WORKER, "1.0.1")])
        self.assertIn("marker MARKER absent", why[WORKER])
        self.assertEqual(len(calls["issue"]), 1, "and the closed-loop issue is filed")
        title = cr.issue_text(PUSHED, {WORKER: {"want": "1.0.1", "state": "failed:functional", "seen": "1.0.1", "polls": 1, "functional": "x"}}, {"sha": "r" * 40, "redeploy": ["canonical-deploy.yml"]})[0]
        self.assertTrue(title.startswith("DEPLOY-PROBE-REVERTED-1"), title)

    def test_a_probe_that_passes_reverts_nothing(self):
        rc, calls, out = self._run((200, "all good MARKER"))
        self.assertEqual((rc, calls["revert"], calls["issue"], calls["probe_issue"]), (0, [], [], []))
        self.assertIn("passes its probes", "\n".join(out))

    def test_a_failure_that_was_declared_and_already_failing_is_filed_not_reverted(self):
        rc, calls, out = self._run((200, "nope"), baseline={self.key(): "fail"})
        self.assertEqual((calls["revert"], calls["issue"]), ([], []))
        self.assertEqual([(w, k) for w, k, _ in calls["probe_issue"]], [(WORKER, "pre-existing")])

    def test_a_probe_the_push_itself_declares_is_its_own_even_if_it_failed_before(self):
        rc, calls, out = self._run((200, "nope"), base_decl=None, baseline={self.key(): "fail"})
        self.assertEqual(len(calls["revert"]), 1)

    def test_a_worker_created_by_the_push_is_observed_never_reverted(self):
        rc, calls, out = self._run((200, "nope"), created=True)
        self.assertEqual(calls["revert"], [], "a revert would delete files of a worker that stays deployed")
        self.assertEqual([(w, k) for w, k, _ in calls["probe_issue"]], [(WORKER, "observed")])

    def test_observe_mode_and_verify_only_runs_never_revert(self):
        rc, calls, out = self._run((200, "nope"), decl=dict(DECL, mode="observe"))
        self.assertEqual((calls["revert"], [k for _, k, _ in calls["probe_issue"]]), ([], ["observed"]))
        rc, calls, out = self._run((200, "nope"), no_revert=True)
        self.assertEqual((calls["revert"], [k for _, k, _ in calls["probe_issue"]]), ([], ["observed"]))

    def test_an_inconclusive_answer_reverts_nothing(self):
        rc, calls, out = self._run((0, "name resolution failed"))
        self.assertEqual((calls["revert"], calls["issue"], calls["probe_issue"]), ([], [], []))
        self.assertIn("inconclusive", "\n".join(out))

    def test_a_later_push_that_changed_the_worker_owns_the_verdict(self):
        rc, calls, out = self._run((200, "nope"), later=["abc1234"])
        self.assertEqual((calls["revert"], calls["issue"]), ([], []))
        self.assertIn("owns the verdict", "\n".join(out))
        self.assertEqual([k for _, k, _ in calls["probe_issue"]], ["observed"])

    def test_the_version_poll_of_a_declared_health_url_still_gates_the_probes(self):
        rc, calls, out = self._run((200, "all good MARKER"), health_version="0.9.0")
        self.assertEqual(len(calls["revert"]), 1, "the VERSION never arrived: reverted exactly like a control-plane worker")

    def test_a_failure_belonging_to_an_earlier_cancelled_push_is_not_blamed_on_this_one(self):
        rc, calls, out = self._run((200, "nope"), files=["qnfo-other/worker.js", "docs/a.md"])
        self.assertEqual((calls["revert"], calls["issue"]), ([], []), "this push did not touch the failing worker: reverting it would hit the innocent commit and keep the bad code")
        self.assertIn("did not touch " + WORKER, "\n".join(out))
        self.assertEqual([k for _, k, _ in calls["probe_issue"]], ["observed"])

    def test_a_baseline_taken_after_the_deploy_cannot_tell_a_regression_from_old_debt(self):
        rc, calls, out = self._run((200, "nope"), baseline={"__live_version__": "1.0.1"})
        self.assertEqual(calls["revert"], [], "the live VERSION before the deploy already was the pushed one")
        self.assertIn("baseline was taken after the deploy", "\n".join(out))
        rc, calls, out = self._run((200, "nope"), baseline={"__live_version__": "1.0.0"})
        self.assertEqual(len(calls["revert"]), 1, "a baseline of the previous VERSION is trusted")

    def test_a_mistyped_marker_in_a_new_probe_is_filed_not_reverted(self):
        rc, calls, out = self._run((200, "nope"), base_decl=None, baseline={self.key(): "fail-marker"})
        self.assertEqual(calls["revert"], [])
        self.assertEqual([k for _, k, _ in calls["probe_issue"]], ["new-probe"])
        rc, calls, out = self._run((404, "not found"), base_decl=None, baseline={self.key(): "fail"})
        self.assertEqual(len(calls["revert"]), 1, "a route that did not exist before the push and is broken after it is the push's own")

    def test_a_new_d1_probe_on_schema_the_same_push_migrates_waits_for_the_migration(self):
        decl = {"mode": "revert", "health": DECL["health"], "d1": [{"binding": "DB", "explain": ["SELECT 1 FROM foo"]}]}
        wr = 'name = "qnfo-evolve"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "qnfo-audit"\ndatabase_id = "35e2e573-92f3-46ac-83c6-22f6429fc5e5"\n'
        err = (False, "D1 HTTP 400: no such table: foo: SQLITE_ERROR")
        rc, calls, out = self._run((200, "ok"), decl=decl, base_decl=None, wrangler=wr, d1=err, files=[WORKER + "/worker.js", "migrations/2026-11-05-foo.sql"])
        self.assertEqual(calls["revert"], [], "apply-migrations.yml starts at the same commit and may not have created foo yet")
        rc, calls, out = self._run((200, "ok"), decl=decl, base_decl=None, wrangler=wr, d1=err, files=[WORKER + "/worker.js"])
        self.assertEqual(len(calls["revert"]), 1, "without a migration in the push a missing table is the push's own")

    def test_every_repository_declaration_is_valid_and_its_workers_are_deployable(self):
        self.assertEqual(dp.validate_repo(), [])
        control_plane = set(cr.CANARY_WORKERS)
        for d in dp.worker_dirs(ROOT):
            if not os.path.exists(os.path.join(ROOT, d, "probes.json")):
                continue
            decl = json.loads(read(d + "/probes.json"))
            self.assertTrue(dp.probe_list(decl), d + " declares no probe")
            if d not in control_plane and decl.get("health"):
                self.assertRegex(read(d + "/worker.js"), r'(?m)^var\s+VERSION\s*=\s*"', d + " declares health but has no line-start var VERSION: the canary could not read the pushed VERSION")


class DrillEndToEnd(unittest.TestCase):
    """DEPLOY-PROBES-1 drill: a deliberately bad deploy of a canary worker, replayed against a scratch git origin and a local HTTP server.
    The worker /health answers the pushed VERSION (so the old canary would have passed it) while its declared route no longer shows its
    marker. run() must revert the push on origin/main, bump the VERSION above the bad one, keep the mirror identical and redeploy the bystander."""

    def _git(self, cwd, *args):
        import subprocess
        return subprocess.run(["git"] + list(args), cwd=cwd, check=True, capture_output=True, text=True).stdout

    def test_a_bad_deploy_is_reverted_on_origin_main_and_both_workers_are_redeployed(self):
        import http.server
        import shutil
        import threading

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                body = (json.dumps({"ok": True, "version": "1.0.1"}) if self.path == "/health" else "BAD PAGE").encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass
        srv = http.server.HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base_url = "http://127.0.0.1:%d" % srv.server_address[1]
        tmp = tempfile.mkdtemp(prefix="drill-")
        old_cwd = os.getcwd()
        saved = {n: getattr(cr, n) for n in ("dispatch_redeploy", "file_issue", "record_functional", "record_ahead", "poll")}
        real_poll = cr.poll
        real_validate = dp.validate
        try:
            origin, work = os.path.join(tmp, "origin.git"), os.path.join(tmp, "work")
            self._git(tmp, "init", "--bare", "-b", "main", origin)
            self._git(tmp, "clone", origin, work)
            self._git(work, "config", "user.name", "drill")
            self._git(work, "config", "user.email", "drill@example.com")
            self._git(work, "checkout", "-b", "main")
            for d, v in (("w", "1.0.0"), ("o", "2.0.0")):
                os.makedirs(os.path.join(work, d))
                for f in ("worker.js", "deployed-current.worker.js"):
                    with open(os.path.join(work, d, f), "w", newline="\n") as fh:
                        fh.write('var VERSION = "%s";\nexport default { fetch() { return new Response("GOOD PAGE"); } };\n' % v)
                with open(os.path.join(work, d, "wrangler.toml"), "w", newline="\n") as fh:
                    fh.write('name = "%s"\n' % d)
            decl = {"mode": "revert", "health": base_url + "/health", "http": [{"url": base_url + "/page", "contains": ["GOOD PAGE"]}]}
            with open(os.path.join(work, "w", "probes.json"), "w", newline="\n") as fh:
                json.dump(decl, fh)
            self._git(work, "add", "-A")
            self._git(work, "commit", "-m", "base")
            self._git(work, "push", "origin", "main")
            for d, v in (("w", "1.0.1"), ("o", "2.0.1")):
                for f in ("worker.js", "deployed-current.worker.js"):
                    with open(os.path.join(work, d, f), "w", newline="\n") as fh:
                        fh.write('var VERSION = "%s";\nexport default { fetch() { return new Response("BAD PAGE"); } };\n' % v)
            self._git(work, "add", "-A")
            self._git(work, "commit", "-m", "the bad deploy")
            self._git(work, "push", "origin", "main")
            pushed = self._git(work, "rev-parse", "HEAD").strip()
            targets = os.path.join(tmp, "targets.txt")
            with open(targets, "w") as fh:
                fh.write("w w/worker.js\no o/worker.js\n")
            dispatched, issues = [], []
            cr.dispatch_redeploy = lambda workers: dispatched.append(list(workers)) or {"redeploy": ["canonical-deploy.yml"]}
            cr.file_issue = lambda acct, token, pushed_, results, outcome: issues.append((results, outcome)) or "filed"
            cr.record_functional = lambda *a, **k: None
            cr.record_ahead = lambda *a, **k: None
            cr.poll = lambda wanted, minutes, poll_sec, **k: real_poll(wanted, minutes, poll_sec, fetch=lambda w: {"version": "1.0.1"}, clock=lambda: 0.0, sleep=lambda s_: None)
            dp.validate = lambda decl, bindings=None: []  # the scratch server is http://127.0.0.1, which the fleet-host rule rightly refuses
            os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_API_TOKEN"] = "acct", "tok"
            os.chdir(work)
            a = types.SimpleNamespace(targets=targets, pushed=pushed, canary_min=1, poll_sec=1, dry_run=False, no_revert=False, functional=None,
                                      functional_tries=1, functional_wait=0, baseline_file=None, base=None)
            out = []
            real_emit = cr.emit
            cr.emit = out.append
            try:
                rc = cr.run(a)
            finally:
                cr.emit = real_emit
            self.assertEqual(rc, 0, "\n".join(out))
            self._git(work, "fetch", "origin", "main")
            origin_log = self._git(work, "log", "--format=%s", "origin/main", "-3").splitlines()
            self.assertTrue(origin_log[0].startswith("revert: " + pushed[:7] + " failed the functional canary on w"), (origin_log, out))
            w_js = self._git(work, "show", "origin/main:w/worker.js")
            w_mirror = self._git(work, "show", "origin/main:w/deployed-current.worker.js")
            o_js = self._git(work, "show", "origin/main:o/worker.js")
            self.assertIn('var VERSION = "1.0.2-revert-' + pushed[:7] + '"', w_js, "the reverted worker is re-bumped above the bad 1.0.1")
            self.assertEqual(w_js, w_mirror, "the mirror stays identical to worker.js")
            self.assertIn("GOOD PAGE", w_js, "the previous content is back")
            self.assertIn('var VERSION = "2.0.0"', o_js, "the bystander of the same push is reverted too")
            self.assertEqual(dispatched, [["w", "o"]], "the failed worker and the bystander the revert changed are both redeployed")
            self.assertEqual(len(issues), 1)
            self.assertTrue(cr.issue_text(pushed, issues[0][0], issues[0][1])[0].startswith("DEPLOY-PROBE-REVERTED-1"))
            self.assertIn("marker GOOD PAGE absent", issues[0][0]["w"]["functional"])
        finally:
            os.chdir(old_cwd)
            for n, f in saved.items():
                setattr(cr, n, f)
            dp.validate = real_validate
            srv.shutdown()
            shutil.rmtree(tmp, ignore_errors=True)
            for k in ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"):
                os.environ.pop(k, None)


class RevertThroughPullRequest(unittest.TestCase):
    """The first live drill of DEPLOY-PROBES-1 (qnfo-evolve, 2026-11-04) detected the bad deploy and then could not push its revert: the require-build ruleset
    refuses a direct push to main from the Actions token (GH013). Replayed with a bare origin whose pre-receive hook refuses main the same way: the revert must
    travel as a pull request, a refusal must not be retried, and the issue must say so."""

    def _git(self, cwd, *args):
        import subprocess
        return subprocess.run(["git"] + list(args), cwd=cwd, check=True, capture_output=True, text=True).stdout

    def _setup(self, tmp):
        origin, work = os.path.join(tmp, "origin.git"), os.path.join(tmp, "work")
        self._git(tmp, "init", "--bare", "-b", "main", origin)
        self._git(tmp, "clone", origin, work)
        self._git(work, "config", "user.name", "drill")
        self._git(work, "config", "user.email", "drill@example.com")
        self._git(work, "checkout", "-b", "main")
        os.makedirs(os.path.join(work, "w"))
        for f in ("worker.js", "deployed-current.worker.js"):
            with open(os.path.join(work, "w", f), "w", newline="\n") as fh:
                fh.write('var VERSION = "1.0.0";\nexport default { fetch() { return new Response("GOOD"); } };\n')
        self._git(work, "add", "-A")
        self._git(work, "commit", "-m", "base")
        self._git(work, "push", "origin", "main")
        for f in ("worker.js", "deployed-current.worker.js"):
            with open(os.path.join(work, "w", f), "w", newline="\n") as fh:
                fh.write('var VERSION = "1.0.1";\nexport default { fetch() { return new Response("BAD"); } };\n')
        self._git(work, "add", "-A")
        self._git(work, "commit", "-m", "the bad deploy")
        self._git(work, "push", "origin", "main")
        pushed = self._git(work, "rev-parse", "HEAD").strip()
        # from now on the origin refuses main exactly like the ruleset does
        hook = os.path.join(origin, "hooks", "pre-receive")
        with open(hook, "w", newline="\n") as fh:
            fh.write('#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/main" ]; then\n'
                     '    echo "remote: error: GH013: Repository rule violations found for refs/heads/main." >&2\n'
                     '    echo "remote: - Required status check \\"Workers Builds: qnfo-workers\\" is expected." >&2\n    exit 1\n  fi\ndone\nexit 0\n')
        os.chmod(hook, 0o755)
        return origin, work, pushed

    def test_a_refused_push_to_main_becomes_a_revert_pull_request(self):
        import shutil
        tmp = tempfile.mkdtemp(prefix="viapr-")
        old_cwd = os.getcwd()
        saved = {n: getattr(cr, n) for n in ("dispatch_redeploy", "create_pr")}
        try:
            origin, work, pushed = self._setup(tmp)
            prs, sleeps = [], []
            cr.dispatch_redeploy = lambda workers: {"redeploy": ["canonical-deploy.yml"]}
            cr.create_pr = lambda branch, title, body: prs.append((branch, title, body)) or (True, "https://github.com/QNFO/qnfo-workers/pull/9999")
            real_sleep = cr.time.sleep
            cr.time.sleep = sleeps.append
            os.chdir(work)
            try:
                out = cr.revert_push(pushed, [("w", "w", "1.0.1")], False, {"w": "marker GOOD absent"}, {})
            finally:
                cr.time.sleep = real_sleep
            self.assertEqual(out.get("pr"), "https://github.com/QNFO/qnfo-workers/pull/9999", out)
            self.assertNotIn("error", out)
            self.assertEqual(sleeps, [], "a rule refusal is not retried")
            self.assertEqual(len(prs), 1)
            branch, title, body = prs[0]
            self.assertEqual(branch, "canary-revert-" + out["sha"][:12])
            self.assertTrue(title.startswith("revert: " + pushed[:7] + " failed the functional canary on w"), title)
            self.assertIn("direct push to main was refused", body)
            self.assertEqual(self._git(work, "ls-remote", "origin", "refs/heads/main").split()[0], pushed, "main on the origin is untouched")
            on_branch = self._git(work, "ls-remote", "origin", "refs/heads/" + branch).split()
            self.assertEqual(on_branch[0], out["sha"], "the revert commit is on the branch the pull request was opened from")
            self._git(work, "fetch", "origin", branch)
            js = self._git(work, "show", "FETCH_HEAD:w/worker.js")
            self.assertIn('var VERSION = "1.0.2-revert-' + pushed[:7] + '"', js)
            self.assertIn("GOOD", js)
            title2, desc2 = cr.issue_text(pushed, {"w": {"want": "1.0.1", "state": "failed:functional", "seen": "1.0.1", "polls": 1, "functional": "x"}}, out)
            self.assertTrue(title2.startswith("DEPLOY-PROBE-REVERTED-1: push " + pushed[:7] + " revert opened as a pull request"), title2)
            self.assertIn("pull/9999", desc2)
        finally:
            os.chdir(old_cwd)
            for n, f in saved.items():
                setattr(cr, n, f)
            shutil.rmtree(tmp, ignore_errors=True)

    def test_when_the_pull_request_cannot_be_opened_the_issue_says_nothing_was_reverted(self):
        import shutil
        tmp = tempfile.mkdtemp(prefix="viapr-")
        old_cwd = os.getcwd()
        saved = {n: getattr(cr, n) for n in ("dispatch_redeploy", "create_pr")}
        try:
            origin, work, pushed = self._setup(tmp)
            cr.dispatch_redeploy = lambda workers: {"redeploy": []}
            cr.create_pr = lambda branch, title, body: (False, "HTTP 403 Resource not accessible by integration")
            os.chdir(work)
            out = cr.revert_push(pushed, [("w", "w", "1.0.1")], False, {"w": "x"}, {})
            self.assertIn("error", out)
            self.assertIn("sha", out, "the local revert commit exists, which used to make the issue claim a revert on main")
            title, desc = cr.issue_text(pushed, {"w": {"want": "1.0.1", "state": "failed:functional", "seen": "1.0.1", "polls": 1, "functional": "x"}}, out)
            self.assertTrue(title.startswith("DEPLOY-PROBE-CANARY-FAILED-1:") and "could not be reverted" in title, title)
            self.assertIn("revert pull request not opened", desc)
        finally:
            os.chdir(old_cwd)
            for n, f in saved.items():
                setattr(cr, n, f)
            shutil.rmtree(tmp, ignore_errors=True)

    def test_create_pr_uses_the_fleet_credential_and_recognises_an_existing_pull_request(self):
        calls = []
        real_run = cr.subprocess.run

        class R:
            def __init__(self, rc, out="", err=""):
                self.returncode, self.stdout, self.stderr = rc, out, err
        answers = [R(0, "https://github.com/QNFO/qnfo-workers/pull/1\n"), R(1, "", "a pull request for branch \"x\" into branch \"main\" already exists:\nhttps://github.com/QNFO/qnfo-workers/pull/7"), R(1, "", "HTTP 403")]
        cr.subprocess.run = lambda cmd, **k: calls.append((cmd, k.get("env", {}).get("GH_TOKEN"))) or answers.pop(0)
        os.environ["QNFO_GH_PAT"] = "pat-value"
        try:
            self.assertEqual(cr.create_pr("b", "t", "body"), (True, "https://github.com/QNFO/qnfo-workers/pull/1"))
            self.assertEqual(cr.create_pr("b", "t", "body"), (True, "https://github.com/QNFO/qnfo-workers/pull/7"))
            self.assertEqual(cr.create_pr("b", "t", "body")[0], False)
        finally:
            cr.subprocess.run = real_run
            os.environ.pop("QNFO_GH_PAT", None)
        self.assertTrue(all(tok == "pat-value" for _, tok in calls), "the pull request is opened with QNFO_GH_PAT so the lane's workflows run on it")
        self.assertEqual(calls[0][0][:3], ["gh", "pr", "create"])


if __name__ == "__main__":
    unittest.main()
