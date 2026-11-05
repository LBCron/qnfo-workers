#!/usr/bin/env python3
"""FOLD-KIT-1 self-test (scripts/fold_worker.py). No network; a synthetic two-worker repository in a temp directory.

Proves (FOLD-KIT-2): public routes with methods and prefixes, named non-qnfo callers, a derived member key (an HMAC of a host
secret the member never sees) and a constant fold and pass the generated suite; a host with an older runtime and malformed
options are refused. Proves (FOLD-KIT-1): a guest with a cloudflare: import, a sourceMappingURL trailer and a token-free props gate folds into a host; the
host's other named exports survive; the guest's missing binding is appended, its cron dropped, its binder re-pointed with
props.member, and its host's own binding to it becomes a self-binding; the generated suite passes under node; and the kit
refuses a guest that exports a Durable Object class, a fold that would hand a personal-plane binding to research code, and
a host with two top-level VERSION lines.
Run: python3 scripts/fold_worker_selftest.py   -> prints "N passed, 0 failed"
"""
import os
import shutil
import subprocess
import sys
import tempfile
import tomllib

KIT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fold_worker.py")
passed = failed = 0


def ok(cond, msg, extra=""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print("FAIL " + msg + ((" :: " + str(extra)[:400]) if extra else ""))


GUEST = '''var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
import { connect } from "cloudflare:sockets";
var VERSION = "1.0.0-guest";
var worker_default = {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    if (u.pathname === "/health") return new Response(JSON.stringify({ worker: "g-one", version: VERSION, sock: typeof connect }));
    return new Response("guest " + u.pathname + " " + (env.GDB ? "db" : "nodb"));
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(env.GDB.prepare("SELECT 1").run());
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
'''
HOST = '''import { DurableObject } from "cloudflare:workers";
var VERSION = "2.0.0-host"; // host
class HostDO extends DurableObject {}
var host_default = {
  async fetch(request, env, ctx) { return new Response("host"); },
  async scheduled(event, env, ctx) {}
};
export {
  HostDO,
  host_default as default
};
'''
GT = '''name = "g-one"
main = "worker.js"
compatibility_date = "2026-08-01"

[triggers]
crons = ["5 * * * *"]

[[d1_databases]]
binding = "GDB"
database_name = "qnfo-audit"
database_id = "a"

[[r2_buckets]]
binding = "GBUCKET"
bucket_name = "g-bucket"
'''
HT = '''name = "h-one"
main = "worker.js"
compatibility_date = "2026-08-01"

[triggers]
crons = ["0 * * * *"]

[[d1_databases]]
binding = "AUDIT"
database_name = "qnfo-audit"
database_id = "a"

[[d1_databases]]
binding = "PERSONAL"
database_name = "personal-life"
database_id = "p"

[[services]]
binding = "G"
service = "g-one"
props = { caller = "h-one" }
'''
BINDER = '''name = "b-one"
main = "worker.js"
compatibility_date = "2026-08-01"

[[services]]
binding = "GSVC"
service = "g-one"

[[services]]
binding = "OTHER"
service = "x-one"
'''


def repo(tmp, guest=GUEST, host=HOST, gt=GT, ht=HT):
    for d, files in (("g-one", {"worker.js": guest, "wrangler.toml": gt}), ("h-one", {"worker.js": host, "wrangler.toml": ht}),
                     ("b-one", {"worker.js": 'var VERSION = "0.1.0";\nexport default { fetch() { return new Response("b"); } };\n', "wrangler.toml": BINDER})):
        os.makedirs(os.path.join(tmp, d), exist_ok=True)
        for f, s in files.items():
            with open(os.path.join(tmp, d, f), "w") as fh:
                fh.write(s)


def run(tmp, extra=()):
    args = [sys.executable, KIT, "g-one", "h-one", "--member-version", "1.0.1-folded", "--host-version", "2.1.0-g-fold",
            "--note", "G-FOLD-1 selftest", "--prefix", "/g", "--env-map", '{"GDB":"AUDIT"}', "--due", 'new Date(ms).getUTCMinutes() < 30 ? "5 * * * *" : null',
            "--test-due-at", "Date.UTC(2026, 9, 6, 9, 0, 3)", "--test-due-cron", "5 * * * *", "--host-cron", "0 * * * *", "--why", "selftest"] + list(extra)
    return subprocess.run(args, cwd=tmp, capture_output=True, text=True)


tmp = tempfile.mkdtemp(prefix="foldkit-")
try:
    repo(tmp)
    r = run(tmp)
    ok(r.returncode == 0, "the kit folds the synthetic guest", r.stderr or r.stdout)
    hsrc = open(os.path.join(tmp, "h-one", "worker.js")).read()
    ok(hsrc.startswith('import { connect as __fk_gOne_connect } from "cloudflare:sockets";\n'), "the guest import is hoisted as an aliased host import", hsrc[:120])
    ok("var connect = __fk_gOne_connect;" in hsrc and "  HostDO," in hsrc and "__fk_gOne_default as default" in hsrc, "the alias is bound inside the member and the host's other export survives")
    ok(hsrc == open(os.path.join(tmp, "h-one", "deployed-current.worker.js")).read(), "the mirror equals the worker")
    ok(hsrc.count('\nvar VERSION = "2.1.0-g-fold";') == 1 and "sourceMappingURL" not in hsrc.split("FOLD-KIT-1:g-one:BEGIN")[1].split("FOLD-KIT-1:g-one:END")[0], "host version bumped; the guest's sourceMappingURL trailer is dropped")
    ht = tomllib.load(open(os.path.join(tmp, "h-one", "wrangler.toml"), "rb"))
    ok(any(b["binding"] == "GBUCKET" for b in ht.get("r2_buckets", [])) and ht["triggers"]["crons"] == ["0 * * * *"], "the missing binding is appended and the host keeps its own cron only")
    ok(any(s["binding"] == "G" and s["service"] == "h-one" and s.get("props", {}).get("member") == "g-one" for s in ht.get("services", [])), "the host's own binding to the guest becomes a self-binding with props.member", ht.get("services"))
    bt = tomllib.load(open(os.path.join(tmp, "b-one", "wrangler.toml"), "rb"))
    gs = [s for s in bt["services"] if s["binding"] == "GSVC"][0]
    ok(gs["service"] == "h-one" and gs.get("props") == {"caller": "b-one", "member": "g-one"} and [s for s in bt["services"] if s["binding"] == "OTHER"][0]["service"] == "x-one", "the binder is re-pointed with props and its other binding is untouched", bt)
    ok(os.path.exists(os.path.join(tmp, "g-one", "FOLDED")) and "is FOLDED into h-one" in open(os.path.join(tmp, "g-one", "FOLDED")).read(), "the guest carries a FOLDED marker naming the host (fold-guard reads it)")
    # The generated suite needs cloudflare:workers stubbed; it does that itself.
    t = subprocess.run(["node", "--no-warnings", os.path.join(tmp, "h-one", "g-one-fold.test.mjs")], capture_output=True, text=True)
    ok(t.returncode == 0 and " 0 failed" in t.stdout, "the generated suite passes", t.stdout + t.stderr)
    ok('"PERSONAL"' not in hsrc.split("keys: ")[1].split("\n")[0], "the member's env keys leave out the host's personal-plane binding")

    # FOLD-RETURN-ORDER-1: a guest written as `export default {...}` with top-level statements after it keeps them running before the member is returned.
    shutil.rmtree(tmp); tmp = tempfile.mkdtemp(prefix="foldkit-")
    late = GUEST.split("var worker_default = {")[0] + "export default {\n  async fetch(request, env, ctx) { return new Response(\"g\" + LATE_CFG.tick); },\n  async scheduled(event, env, ctx) { return LATE_CFG.tick; }\n};\nvar LATE_CFG = {\"tick\": \"20 * * * *\"};\n"
    repo(tmp, guest=late)
    r = run(tmp)
    ok(r.returncode == 0, "the kit folds a guest with `export default {` and a statement after it", r.stderr or r.stdout)
    hl = open(os.path.join(tmp, "h-one", "worker.js")).read().split("FOLD-KIT-1:g-one:BEGIN")[1].split("FOLD-KIT-1:g-one:END")[0]
    ok("\nvar __fk_gOne_guestDefault = {" in hl and "\nreturn {" not in hl and hl.index("var LATE_CFG") < hl.index("return __fk_gOne_guestDefault;"), "the default is held in a variable and returned after the guest's last top-level statement", hl[-900:])
    # FOLD-KIT-2: public routes with methods, a named non-qnfo caller, a derived env value and a constant.
    shutil.rmtree(tmp); tmp = tempfile.mkdtemp(prefix="foldkit-")
    repo(tmp, guest=GUEST.replace('(env.GDB ? "db" : "nodb")', '(env.GDB ? "db" : "nodb") + (env.GKEY ? "k" : "") + (env.GBASE || "")'),
         ht=HT + '\n[[services]]\nbinding = "OTHERSVC"\nservice = "x-one"\n')
    r = run(tmp, ["--public-route", "GET,POST /e/*", "--public-route", "GET /events.ics", "--callers", "b-two,personal-api",
                  "--env-derive", '{"GKEY":"HSECRET"}', "--env-const", '{"GBASE":"https://h-one.q08.workers.dev/g"}'])
    ok(r.returncode == 0, "the kit folds with public routes, named callers, a derived key and a constant", r.stderr or r.stdout)
    h2 = open(os.path.join(tmp, "h-one", "worker.js")).read()
    ok('publicRoutes: [{"path": "/e/", "prefix": true, "methods": ["GET", "POST"]}, {"path": "/events.ics", "prefix": false, "methods": ["GET"]}], callers: ["b-two", "personal-api"],' in h2
       and 'derive: {"GKEY": "HSECRET"}' in h2 and '"GBASE": "https://h-one.q08.workers.dev/g"' in h2, "the member table carries routes, callers, derive and consts", h2[-1500:])
    marker = open(os.path.join(tmp, "g-one", "FOLDED")).read()
    ok("(or b-two, personal-api)" in marker and "GET,POST https://h-one.q08.workers.dev/g/e/*" in marker and "is FOLDED into h-one" in marker, "the FOLDED marker names the callers and public routes", marker)
    t = subprocess.run(["node", "--no-warnings", os.path.join(tmp, "h-one", "g-one-fold.test.mjs")], capture_output=True, text=True)
    ok(t.returncode == 0 and " 0 failed" in t.stdout and int(t.stdout.split(" passed")[0].split()[-1]) >= 19, "the generated suite covers and passes the new routes, caller, derive and const checks", t.stdout + t.stderr)
    # a host that already carries an older runtime is refused (a second member would get the old wrapper)
    shutil.rmtree(tmp); tmp = tempfile.mkdtemp(prefix="foldkit-")
    repo(tmp, host=HOST.replace("class HostDO", "// ---- FOLD-KIT-1:RUNTIME:BEGIN ----\nfunction __foldWrap(host, m) { return host; }\n// ---- FOLD-KIT-1:RUNTIME:END ----\nclass HostDO"))
    r = run(tmp)
    ok(r.returncode != 0 and "older FOLD-KIT runtime" in r.stderr, "a host with an older kit runtime is refused", r.stderr)
    for bad in (["--public-route", "FETCH /x"], ["--public-route", "GET x"], ["--callers", "Bad_Name"], ["--env-derive", '{"lower":"X"}']):
        shutil.rmtree(tmp); tmp = tempfile.mkdtemp(prefix="foldkit-")
        repo(tmp)
        r = run(tmp, bad)
        ok(r.returncode != 0, "a malformed option is refused: " + " ".join(bad), r.stdout[-200:])

    shutil.rmtree(tmp); tmp = tempfile.mkdtemp(prefix="foldkit-")
    repo(tmp, guest=GUEST.replace("export {\n  worker_default as default\n};", "class GDO {}\nexport {\n  GDO,\n  worker_default as default\n};"))
    r = run(tmp)
    ok(r.returncode != 0 and "Durable Object or Workflow" in r.stderr, "a guest exporting a class is refused", r.stderr)

    shutil.rmtree(tmp); tmp = tempfile.mkdtemp(prefix="foldkit-")
    repo(tmp, guest=GUEST.replace('(env.GDB ? "db" : "nodb")', '(env.PERSONAL ? "p" : "nop")'))
    r = run(tmp)
    ok(r.returncode != 0 and "personal/research separation" in r.stderr, "research code that reads the host's personal binding is refused (PERSONAL-RESEARCH-SEPARATION-1)", r.stderr)

    shutil.rmtree(tmp); tmp = tempfile.mkdtemp(prefix="foldkit-")
    repo(tmp, host=HOST.replace('var VERSION = "2.0.0-host"; // host\n', 'var VERSION = "2.0.0-host"; // host\nvar VERSION = "x";\n'))
    r = run(tmp)
    ok(r.returncode != 0 and "top-level" in r.stderr, "a host with two top-level VERSION lines is refused", r.stderr)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
print("%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
