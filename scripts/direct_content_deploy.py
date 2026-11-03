#!/usr/bin/env python3
"""DEPLOY-SECOND-PATH-1 (2026-10-09, pillar core; agent_issues 2178, doctrine section 10 SPOF).

WHAT  The second deploy path for canonical-deploy.yml. When qnfo-ops /ops/deploy is unreachable (connection error or a
      5xx; scripts/canonical_deploy.py exits 3 and lists the workers in its fallback file), this uploads worker.js and its
      statically imported local modules straight to Cloudflare with the repository token through the code-only endpoint
      PUT /accounts/{account}/workers/scripts/{name}/content, which replaces the script's code and keeps its bindings,
      settings, secrets and schedules as they are live. It never creates a worker (an absent script is skipped, as
      WORKER-RESURRECTION-GUARD-1 does), never deploys a container worker (its config is script-level), and writes a
      cloud_ops_events row (kind deploy-fallback) for each worker so the ledger shows which path shipped it.
      --drill exercises the path on purpose for one worker at its current main code and, on success, sets
      spof_registry.alternate_tested_at for 'qnfo-ops /ops/deploy' (doctrine section 10: an untested alternate is no
      alternate).
      DEPLOY-SECOND-PATH-LEDGER-1 (2026-10-13, agent_issues 2451): every deploy attempt (not a skip) also writes one
      qnfo-audit.deployment_history row (action deploy-direct, status success|failed, version_id the worker's VERSION,
      notes with the version, the run and why the fallback ran), so CHAOS-DRILL-1 can read this alternate from D1
      (spof_alternate_probes 'qnfo-ops /ops/deploy'). A ledger write that fails is one stderr line and never changes the
      deploy's result; an exception while deploying one worker is a failed attempt and the next target still runs.
WHY   Every canonical deploy, canary reverts included, went through qnfo-ops; a broken qnfo-ops could not deploy its own fix.
"""
import argparse
import json
import os
import posixpath
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

API = "https://api.cloudflare.com/client/v4"
SPOF = "qnfo-ops /ops/deploy"
# qnfo-audit's id, used when the by-name lookup returns nothing (the same id scripts/apply_migrations.py writes to).
AUDIT_DB_ID = "35e2e573-92f3-46ac-83c6-22f6429fc5e5"
LEDGER_SQL = ("INSERT INTO deployment_history (resource_type, resource_name, action, version_id, deployed_by, deployed_at, status, notes) "
              "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
DEPLOYED_BY = "canonical-deploy/direct_content_deploy"
REASON_FALLBACK = "qnfo-ops /ops/deploy unreachable (connection error, timeout or 5xx): canonical_deploy.py listed the worker in the fallback file"
REASON_DRILL = "drill: the second path exercised on purpose (--drill)"
REASON_DIRECT = "direct run: --worker named on the command line, no drill"


def env(name):
    return os.environ.get(name, "").strip()


def cf(method, path, token, body=None, headers=None, timeout=60):
    req = urllib.request.Request(API + path, data=body, method=method,
                                 headers=dict({"Authorization": "Bearer " + token}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace") or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8", "replace") or "{}")
        except Exception:  # noqa: BLE001
            return e.code, {}


def is_module(src):
    return bool(re.search(r"^\s*(?:import|export)\b", src, re.M))


IMPORT_RE = re.compile(r"""(?m)^\s*(?:import\s+(?:[^;\n]*?\s+from\s+)?|export\s+[^;\n]*?\s+from\s*)["']([^"']+)["']""")
DYNAMIC_IMPORT_RE = re.compile(r"""\bimport\s*\(\s*["']([^"']+)["']\s*\)""")
MODULE_TYPES = {".js": "application/javascript+module", ".mjs": "application/javascript+module",
                ".json": "application/json", ".txt": "text/plain"}


def collect_modules(path, src, read=None):
    """Collect the local source modules imported by a Worker, in stable dependency order."""
    read = read or read_file
    root = os.path.abspath(os.getcwd())
    worker_dir = os.path.dirname(path) or "."
    seen = set()
    modules = []

    def visit(parent, text):
        refs = IMPORT_RE.findall(text) + DYNAMIC_IMPORT_RE.findall(text)
        for ref in refs:
            if not ref.startswith(("./", "../")):
                continue
            target = os.path.normpath(os.path.join(os.path.dirname(parent), ref))
            absolute = os.path.abspath(target)
            if os.path.commonpath((root, absolute)) != root:
                raise ValueError("relative module import escapes the repository: " + ref)
            name = posixpath.relpath(target.replace("\\", "/"), worker_dir.replace("\\", "/"))
            if name in seen:
                continue
            suffix = os.path.splitext(name)[1].lower()
            if suffix not in MODULE_TYPES or not re.fullmatch(r"[A-Za-z0-9._/-]+", name):
                raise ValueError("unsupported relative module import: " + ref)
            seen.add(name)
            content = read(target)
            modules.append((name, content, MODULE_TYPES[suffix]))
            visit(target, content)

    visit(path, src)
    return modules


def multipart(src, module, modules=None):
    boundary = "----qnfo" + uuid.uuid4().hex
    meta = {"main_module": "worker.js"} if module else {"body_part": "worker.js"}
    main_type = "application/javascript+module" if module else "application/javascript"
    parts = ["--" + boundary, 'Content-Disposition: form-data; name="metadata"',
             "Content-Type: application/json", "", json.dumps(meta)]
    for name, content, content_type in [("worker.js", src, main_type)] + (modules or []):
        parts.extend(["--" + boundary,
                      'Content-Disposition: form-data; name="%s"; filename="%s"' % (name, name),
                      "Content-Type: " + content_type, "", content])
    parts.extend(["--" + boundary + "--", ""])
    return "\r\n".join(parts).encode("utf-8"), "multipart/form-data; boundary=" + boundary


def d1(acct, token, sql, params=None, call=cf):
    """One parameterised statement on qnfo-audit; raises when D1 does not answer success."""
    st, j = call("GET", "/accounts/%s/d1/database?name=qnfo-audit" % acct, token)
    dbs = [d for d in (j.get("result") or []) if d.get("name") == "qnfo-audit"]
    db = (dbs[0].get("uuid") if dbs else None) or AUDIT_DB_ID
    st, j = call("POST", "/accounts/%s/d1/database/%s/query" % (acct, db), token,
                 json.dumps({"sql": sql, "params": params or []}).encode(), {"Content-Type": "application/json"})
    if not j.get("success"):
        raise RuntimeError("D1 HTTP %s: %s" % (st, json.dumps(j.get("errors") or j)[:300]))
    return True


def redact(text, token):
    s = " ".join(str(text).split())
    return s.replace(token, "***") if token else s


def record(acct, token, what, sql, params, call=cf):
    """A ledger write never fails a deploy: an error is one stderr line (token redacted) and the run goes on."""
    try:
        return d1(acct, token, sql, params, call)
    except Exception as e:  # noqa: BLE001
        print("::warning::%s write failed; the deploy result stands: %s" % (what, redact("%s: %s" % (type(e).__name__, e), token)[:300]),
              file=sys.stderr)
        return False


def ledger_params(worker, r, reason, run, stamp):
    """The deployment_history row (LEDGER_SQL) for one deploy attempt."""
    ver = r.get("version")
    notes = "DEPLOY-SECOND-PATH-1 %s %s via PUT /content (repository token), run %s; reason: %s" % (
        worker, ver or "(VERSION unknown)", run, reason)
    if not r.get("ok"):
        notes += "; failed: HTTP %s %s" % (r.get("http"), r.get("error") or "")
    return ["worker", worker, "deploy-direct", ver, DEPLOYED_BY, stamp, "success" if r.get("ok") else "failed", notes[:500]]


def read_file(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def version_of(src):
    m = re.search(r'(?:var|const|let)\s+VERSION\s*=\s*["\']([^"\']+)["\']', src)
    return m.group(1) if m else None


def deploy_one(acct, token, worker, path, call=cf, read=None):
    read = read or read_file
    wdir = os.path.dirname(path) or "."
    toml = wdir.replace("\\", "/").rstrip("/") + "/wrangler.toml"  # forward slashes: the selftest keys and the repository paths are posix on every OS
    try:
        if "[[containers]]" in read(toml):
            return {"worker": worker, "ok": True, "skipped": "container worker (script-level config; deploy-code-orchestrator.yml owns it)"}
    except OSError:
        pass
    st, _ = call("GET", "/accounts/%s/workers/scripts/%s/settings" % (acct, urllib.parse.quote(worker)), token)
    if st == 404:
        return {"worker": worker, "ok": True, "skipped": "absent from the account; never created here (WORKER-RESURRECTION-GUARD-1)"}
    src = read(path)
    body, ctype = multipart(src, is_module(src), collect_modules(path, src, read))
    st, j = call("PUT", "/accounts/%s/workers/scripts/%s/content" % (acct, urllib.parse.quote(worker)), token, body, {"Content-Type": ctype}, 120)
    ok = 200 <= st < 300 and bool(j.get("success", True))
    return {"worker": worker, "ok": ok, "http": st, "version": version_of(src),
            "error": None if ok else json.dumps(j.get("errors") or j)[:400]}


def main(argv=None, call=cf, read=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--targets", help="file of '<worker> <path>' lines (canonical_deploy.py --fallback-file)")
    ap.add_argument("--worker")
    ap.add_argument("--path")
    ap.add_argument("--drill", action="store_true", help="exercise the path on purpose and record alternate_tested_at")
    a = ap.parse_args(argv)
    acct, token = env("CLOUDFLARE_ACCOUNT_ID"), env("CLOUDFLARE_API_TOKEN")
    if not acct or not token:
        print("::error::CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set; the second deploy path cannot run")
        return 1
    targets = []
    if a.worker:
        targets.append((a.worker, a.path or a.worker + "/worker.js", REASON_DRILL if a.drill else REASON_DIRECT))
    if a.targets and os.path.exists(a.targets):
        for line in open(a.targets, encoding="utf-8"):
            p = line.split()
            if p:
                targets.append((p[0], p[1] if len(p) > 1 else p[0] + "/worker.js", REASON_FALLBACK))
    if not targets:
        print("no fallback targets")
        return 0
    failed = 0
    run = env("GITHUB_RUN_ID") or "local"
    for worker, path, reason in targets:
        try:
            r = deploy_one(acct, token, worker, path, call, read)
        except Exception as e:  # noqa: BLE001 - one worker's exception is a failed attempt; the next target still runs
            try:
                ver = version_of((read or read_file)(path))
            except Exception:  # noqa: BLE001
                ver = None
            r = {"worker": worker, "ok": False, "http": None, "version": ver,
                 "error": redact("%s: %s" % (type(e).__name__, e), token)[:400]}
        print(json.dumps(r))
        if r.get("skipped"):
            continue
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        record(acct, token, "deployment_history", LEDGER_SQL, ledger_params(worker, r, reason, run, stamp), call)
        if not r["ok"]:
            failed += 1
            print("::error::fallback deploy failed for %s" % worker)
            continue
        record(acct, token, "cloud_ops_events",
               "INSERT INTO cloud_ops_events (id, ts, kind, status, text, job) VALUES (?1, ?2, 'deploy-fallback', 'ok', ?3, 'canonical-deploy')",
               ["deploy-fallback-%s-%s" % (worker, stamp), stamp, "DEPLOY-SECOND-PATH-1 %s %s via PUT /content (repository token), run %s%s"
                % (worker, r.get("version"), run, " drill" if a.drill else "")], call)
        if a.drill:
            record(acct, token, "spof_registry",
                   "UPDATE spof_registry SET alternate_path = COALESCE(NULLIF(alternate_path, ''), ?1), alternate_tested_at = ?2, "
                   "evidence = COALESCE(evidence, '') || ?3 WHERE component = ?4",
                   ["canonical-deploy.yml falls back to scripts/direct_content_deploy.py (PUT /content with the repository token) when /ops/deploy is unreachable",
                    stamp, " | drill %s: %s %s deployed by the second path (run %s)" % (stamp, worker, r.get("version"), run), SPOF], call)
    return 1 if failed else 0


def selftest():
    calls = []
    files = {"w/wrangler.toml": 'name = "w"', "w/worker.js": 'var VERSION = "1.2.3";\nexport default { fetch() {} };\n',
             "c/wrangler.toml": "[[containers]]\n", "c/worker.js": "x",
             "m/wrangler.toml": 'name = "m"',
             "m/worker.js": 'var VERSION = "1.2.3";\nimport { handle } from "./oauth-broker.mjs";\nexport default { fetch() { return handle(); } };\n',
             "m/oauth-broker.mjs": 'import { token } from "./oauth-shared.js";\nexport function handle() { return token; }\n',
             "m/oauth-shared.js": 'export const token = "ok";\n'}

    def read(p):
        if p not in files:
            raise OSError(p)
        return files[p]

    def call(method, path, token, body=None, headers=None, timeout=60):
        calls.append((method, path, body if method == "PUT" or "/query" in path else None))
        if path.endswith("/absent/settings"):
            return 404, {}
        if "d1/database?name" in path:
            return 200, {"result": [{"name": "qnfo-audit", "uuid": "db"}]}
        if "/query" in path:
            return 200, {"success": True}
        if method == "PUT":
            assert b'"main_module": "worker.js"' in body and b"application/javascript+module" in body
            return 200, {"success": True}
        return 200, {"success": True}

    os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_API_TOKEN"] = "acct", "tok"
    assert main(["--worker", "w", "--path", "w/worker.js", "--drill"], call, read) == 0
    upload = next(c[2] for c in calls if c[0] == "PUT")
    assert b'name="worker.js"; filename="worker.js"' in upload and b'name="oauth-broker.mjs"; filename="oauth-broker.mjs"' not in upload
    q = [json.loads(b) for m, p, b in calls if p.endswith("/query")]
    assert len(q) == 3, calls  # deployment_history, cloud_ops_events, spof_registry
    assert "INTO deployment_history" in q[0]["sql"] and q[0]["params"][2:4] == ["deploy-direct", "1.2.3"] and q[0]["params"][6] == "success", q[0]
    calls.clear()
    assert main(["--worker", "m", "--path", "m/worker.js"], call, read) == 0
    upload = next(c[2] for c in calls if c[0] == "PUT")
    assert b'name="oauth-broker.mjs"; filename="oauth-broker.mjs"' in upload
    assert b'name="oauth-shared.js"; filename="oauth-shared.js"' in upload
    assert b'export function handle() { return token; }' in upload
    assert b'export const token = "ok";' in upload
    assert b"Content-Type: application/javascript+module" in upload
    try:
        collect_modules("m/worker.js", 'import "../../outside.mjs";', read)
        raise AssertionError("an import escaping the repository was accepted")
    except ValueError as exc:
        assert "escapes the repository" in str(exc)
    try:
        collect_modules("m/worker.js", 'import "./not-a-module.css";', read)
        raise AssertionError("an unsupported module type was accepted")
    except ValueError as exc:
        assert "unsupported relative module import" in str(exc)
    calls.clear()
    assert main(["--worker", "absent", "--path", "w/worker.js"], call, read) == 0 and not any(c[0] == "PUT" or "/query" in c[1] for c in calls)
    calls.clear()
    assert main(["--worker", "c", "--path", "c/worker.js"], call, read) == 0 and not any(c[0] == "PUT" or "/query" in c[1] for c in calls)
    assert not is_module("addEventListener('fetch', e => {})")
    assert is_module("export default {}") and is_module('import "./oauth-broker.mjs";')
    print("direct_content_deploy selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    sys.exit(main())
