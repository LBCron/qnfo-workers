#!/usr/bin/env python3
"""deploy-drift-guard-selftest.py - MODULE-SCOPE-DEPTH-1 acceptance gate (offline).

_repo_version() must return the VERSION a worker serves from /health: the declaration at MODULE scope. The scanner behind it has
to survive the constructs that break a naive brace counter: braces inside strings, comments, regex literals and template
literals, and the division-vs-regex ambiguity. Exit 0 = every case passed.
"""
import importlib.util, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
spec = importlib.util.spec_from_file_location("g", os.path.join(HERE, "deploy-drift-guard.py"))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

fails = []
def check(label, got, want):
    ok = got == want
    print(("PASS " if ok else "FAIL ") + label + ("" if ok else "  -- got %r want %r" % (got, want)))
    if not ok:
        fails.append(label)

V = g._repo_version

check("plain module-scope", V('var VERSION = "1.0.0";\nexport default {};'), "1.0.0")

# radar-hub shape: hub's own at depth 0 FIRST; embedded IIFEs (col 0, un-indented) declare their own, the LAST being higher.
radar = '''import { X } from "cloudflare:workers";
var VERSION = "1.0.9";
var eventsMod = (function(){
var __n = 1;
var VERSION = "1.0.8";
function f() { return 1; }
return { f };
})();
var other = (function(){
var VERSION = "1.2.4";
})();
export default { async fetch() { return new Response(VERSION); } };
'''
check("radar-hub shape: depth 0 beats the last embedded IIFE (was 1.2.4)", V(radar), "1.0.9")

# fleet-exec shape: embedded module FIRST (col 0, inside an IIFE), module-scope SECOND.
fexec = '''const execMod = (() => {
const VERSION = "fleet-executor/0.3.2";
return { VERSION };
})();
const VERSION = "1.0.2";
'''
check("fleet-exec shape: module scope wins, not the embedded first", V(fexec), "1.0.2")

# personal-companion shape: folded module at the END, indented.
check("folded indented module at the end is ignored", V('var VERSION = "1.7.2";\nfunction vault() {\n  var VERSION = "0.1.21-folded";\n}\n'), "1.7.2")

# braces that must NOT change depth
check("braces inside strings", V('var s = "{{{";\nvar t = \'}}}\';\nvar VERSION = "2.0.0";'), "2.0.0")
check("braces inside line + block comments", V('// { { {\n/* } } } */\nvar VERSION = "2.1.0";'), "2.1.0")
check("braces + quotes inside a regex literal", V('var re = /[{"\'`]+\\/{/g;\nvar VERSION = "2.2.0";'), "2.2.0")
check("regex after return / typeof / paren", V('function f(){ return /{/.test("x"); }\nif (/}/.test(y)) { }\nvar VERSION = "2.3.0";'), "2.3.0")
check("division is not a regex", V('var a = 10 / 2 / 5;\nvar o = { k: a / 2 };\nvar VERSION = "2.4.0";'), "2.4.0")
check("template literal with ${ {obj} } and nested template", V('var t = `x ${ ({a:1}).a } y ${ `n ${ {b:2}.b }` } {{`;\nvar VERSION = "2.5.0";'), "2.5.0")
check("escaped quote / backtick in strings and templates", V('var a = "q\\"{";\nvar b = `\\`{`;\nvar VERSION = "2.6.0";'), "2.6.0")
check("VERSION text inside a regex literal is not a declaration", V('var re = /^var VERSION = "(\\d+)\\.(\\d+)";$/m;\nvar VERSION = "0.4.54";'), "0.4.54")
check("VERSION inside a function only (no module scope): falls back, never crashes", V('function f(){\n  var VERSION = "9.9.9";\n}\n'), "9.9.9")
check("QNFO_VERSION is not preferred over a plain module VERSION", V('const QNFO_VERSION = "fabric-1";\nconst VERSION = "3.0.0";'), "3.0.0")
check("no declaration at all", V('export default {};'), None)
check("class + arrow + object bodies", V('class A { m() { return () => { return {a:1}; }; } }\nvar VERSION = "4.0.0";'), "4.0.0")

# the real artifacts this was written for
def real(path):
    with open(os.path.join(ROOT, path), encoding="utf-8", errors="replace") as fh:
        return V(fh.read())
import re
# Real files are checked for shape, not a pinned number: a routine version bump must never fail this offline
# test (a hardcoded version broke deploy-drift when personal-companion went 1.7.2 to 1.7.3).
for path in ["radar-hub/worker.js", "fleet-exec/worker.js", "personal-companion/worker.js"]:
    if os.path.exists(os.path.join(ROOT, path)):
        got = real(path)
        check("real file " + path + " yields a semver-shaped VERSION", bool(got and re.match(r"^\d+\.\d+\.\d+", got)), True)

# The canonical-deploy workflow uploads worker.js. A stale mirror must not override it
# when measuring repo-to-live drift; retain mirror fallback for directories without source.
original_root = g.ROOT
with tempfile.TemporaryDirectory() as root:
    g.ROOT = root
    directory = os.path.join(root, "fixture")
    os.makedirs(directory)
    with open(os.path.join(directory, "worker.js"), "w", encoding="utf-8") as fh:
        fh.write('var VERSION = "2.0.0";\n')
    with open(os.path.join(directory, "deployed-current.worker.js"), "w", encoding="utf-8") as fh:
        fh.write('var VERSION = "1.0.0";\n')
    version, path, _ = g.repo_artifact("fixture")
    check("worker.js wins when the mirror is stale", (version, os.path.basename(path)), ("2.0.0", "worker.js"))
    os.remove(os.path.join(directory, "worker.js"))
    version, path, _ = g.repo_artifact("fixture")
    check("the mirror remains a fallback when worker.js is absent", (version, os.path.basename(path)),
          ("1.0.0", "deployed-current.worker.js"))
g.ROOT = original_root

# ---------------------------------------------------------------- UNMANAGED-PROBE-1 / AUDIT-CRASH-FIX-1 (2026-10-26)
# The guard is the producer of `unmanaged_workers` (deployed scripts that no repo directory names). `cf_script_list` stays a boolean.
fake_http = {"voice-stt": (200, None), "stray": (200, "3.0.1"), "dark": (404, None), "tomb": (410, None), "down": (0, None)}
probe = lambda w: fake_http[w]
rep, tomb, trunc = g.unmanaged_scripts({"qnfo-ai", "voice-stt", "stray", "dark", "tomb", "down"}, {"qnfo-ai", "retired-dir-worker"}, probe)
check("unmanaged = deployed minus repo-declared names, sorted, probed",
      [(u["worker"], u["http"], u["version"]) for u in rep],
      [("dark", 404, None), ("down", 0, None), ("stray", 200, "3.0.1"), ("voice-stt", 200, None)])
check("a 410 tombstone is counted, never reported", (tomb, trunc), (1, False))
check("an unreadable CF script list (None) reports nothing: unknown is not 'nothing deployed'", g.unmanaged_scripts(None, {"a"}, probe), ([], 0, False))
check("every deployed script has a repo directory: nothing to probe", g.unmanaged_scripts({"a"}, {"a", "b"}, probe), ([], 0, False))

class FakeResponse:
    def __init__(self, status, body):
        self.status, self.body = status, body
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def getcode(self): return self.status
    def read(self, size): return self.body

probe_urls = []
real_urlopen = g.urllib.request.urlopen
def fake_urlopen(req, timeout=30):
    probe_urls.append(req.full_url)
    return FakeResponse(200, b'{"ok":true}')
g.urllib.request.urlopen = fake_urlopen
try:
    check("fleet-lee uses its live custom-domain API health endpoint and accepts a healthy response without a version",
          g.health_probe("qnfo-fleet-lee"), (200, None))
    check("other unmanaged workers retain their workers.dev health URL",
          g.health_probe("other-worker"), (200, None))
    check("only fleet-lee uses the configured custom health URL", probe_urls,
          ["https://lee.qnfo.org/api/health", "https://other-worker.q08.workers.dev/health"])
finally:
    g.urllib.request.urlopen = real_urlopen

lee, _, _ = g.unmanaged_scripts(
    {"qnfo-fleet-lee"}, set(), lambda w: (200, None), lambda w: False)
check("fleet-lee remains on its custom domain with workers.dev intentionally disabled",
      lee,
      [{"worker": "qnfo-fleet-lee", "http": 200, "version": None,
        "workers_dev_enabled": False, "workers_dev_expected": False, "route_drift": False}])
lee, _, _ = g.unmanaged_scripts(
    {"qnfo-fleet-lee"}, set(), lambda w: (200, None), lambda w: True)
check("an enabled fleet-lee workers.dev route is reported as route drift",
      lee[0]["route_drift"], True)
lee, _, _ = g.unmanaged_scripts(
    {"qnfo-fleet-lee"}, set(), lambda w: (200, None), lambda w: None)
check("an unreadable fleet-lee subdomain setting remains unknown, not drift",
      (lee[0]["workers_dev_enabled"], lee[0]["route_drift"]), (None, False))

many = {"w%02d" % i for i in range(g.UNMANAGED_MAX + 5)}
rep, tomb, trunc = g.unmanaged_scripts(many, set(), lambda w: (200, None))
check("the probe set is capped and says so", (len(rep), trunc), (g.UNMANAGED_MAX, True))
check("deployed_workers() without credentials is None (unknown), not an empty set", g.deployed_workers("", ""), None)

# ARCHIVE-MARKER-READ-1 (RM-REPO-DEAD-SOURCES-1): an archived RETIRED/FOLDED directory still reports a recreated worker.
with tempfile.TemporaryDirectory() as tmp:
    def put(rel, text):
        p = os.path.join(tmp, *rel.split("/"))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "w", encoding="utf-8").write(text)
    put("archive/old-a/RETIRED", "retired\n")
    put("archive/old-a/wrangler.toml", 'name = "qnfo-old-a"\n')
    put("archive/old-b/FOLDED", "folded into host\n")
    put("archive/old-c/wrangler.toml", 'name = "qnfo-old-c"\n')
    put("archive/MANIFEST.md", "# manifest\n")
    check("an archived marked directory whose declared worker is in the account is retired_present",
          g.archived_retired_present({"qnfo-old-a", "x"}, tmp), [("archive/old-a", "qnfo-old-a", "RETIRED")])
    check("an archived directory without a wrangler name falls back to the directory name",
          g.archived_retired_present({"old-b"}, tmp), [("archive/old-b", "old-b", "FOLDED")])
    check("an archived directory with no marker is never reported",
          g.archived_retired_present({"qnfo-old-c", "old-c"}, tmp), [])
    check("an absent worker reports nothing", g.archived_retired_present({"zzz"}, tmp), [])
    check("an unknown account list (None) reports nothing", g.archived_retired_present(None, tmp), [])
    check("a repository without archive/ reports nothing", g.archived_retired_present({"qnfo-old-a"}, os.path.join(tmp, "nope")), [])

print("\n%d failure(s)" % len(fails))
sys.exit(1 if fails else 0)
