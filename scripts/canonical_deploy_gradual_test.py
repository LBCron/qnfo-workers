#!/usr/bin/env python3
"""Offline tests for gradual_attempt in canonical_deploy.py (BP26-GRADUAL-ADOPT-1). Run: python3 scripts/canonical_deploy_gradual_test.py"""
import json, os, sys, types
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import canonical_deploy as C

passed = failed = 0
def ok(c, l):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print("FAIL", l)

def runner(outcome):
    return lambda cmd: types.SimpleNamespace(stdout="x\nRESULT_JSON=" + json.dumps({"outcome": outcome, "why": "t"}) + "\n", stderr="", returncode=0 if outcome == "rolled-out" else 1)

os.environ["CLOUDFLARE_API_TOKEN"] = "t"; os.environ["CLOUDFLARE_ACCOUNT_ID"] = "a"; os.environ.pop("GRADUAL_DEPLOY", None)
C.gradual_workers = lambda: {"w1"}
C.config_changed = lambda w: False
ok(C.gradual_attempt("w1", "w1/worker.js", runner("rolled-out")) == (True, True), "rolled out is handled and ok")
ok(C.gradual_attempt("w1", "w1/worker.js", runner("rolled-back")) == (True, False), "rolled back is handled and failed")
ok(C.gradual_attempt("w1", "w1/worker.js", runner("refused")) == (False, False), "refused falls back to /ops/deploy")
ok(C.gradual_attempt("w2", "w2/worker.js", runner("rolled-out")) == (False, False), "an unlisted worker uses the default path")
C.config_changed = lambda w: True
ok(C.gradual_attempt("w1", "w1/worker.js", runner("rolled-out")) == (False, False), "a wrangler.toml change uses the default path")
C.config_changed = lambda w: False
os.environ["GRADUAL_DEPLOY"] = "off"
ok(C.gradual_attempt("w1", "w1/worker.js", runner("rolled-out")) == (False, False), "GRADUAL_DEPLOY=off disables it")
os.environ.pop("GRADUAL_DEPLOY"); os.environ.pop("CLOUDFLARE_API_TOKEN")
ok(C.gradual_attempt("w1", "w1/worker.js", runner("rolled-out")) == (False, False), "no token: default path")
_listed = {l.split("#")[0].strip() for l in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gradual-deploy-workers.txt")) if l.split("#")[0].strip()}
_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ok(all(os.path.isfile(os.path.join(_root, w, "worker.js")) and not os.path.exists(os.path.join(_root, w, "FOLDED")) and not os.path.exists(os.path.join(_root, w, "RETIRED")) for w in _listed), "every worker the shipped list names is a deployable directory (a FOLDED or RETIRED one can never be exercised; WORKER-COUNT-1.3 moved the proof worker off qnfo-model-eval)")
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
