// QWAV Pages restoration: source guard, scoped edge repair and strict live outcome checks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync("python3", ["-"], {
  cwd: root,
  encoding: "utf8",
  input: String.raw`
import os, sys, tempfile
from pathlib import Path
sys.path.insert(0, "scripts")
import qwav_pages as m
os.environ["CLOUDFLARE_ACCOUNT_ID"] = "test-account"

def rejects(fn, message):
    try:
        fn()
    except ValueError as e:
        assert message in str(e), str(e)
    else:
        raise AssertionError("expected failure: " + message)

with tempfile.TemporaryDirectory() as directory:
    site = Path(directory)
    (site / "functions/api/paper").mkdir(parents=True)
    function = site / "functions/api/paper/[slug].js"
    function.write_text("export function onRequest() {}")
    (site / "index.html").write_text(m.TITLE)
    (site / "_redirects").write_text("# Do not add / /papers/ 301\n/old /new 301\n")
    m.validate_tree(site)
    for redirect in ("/ /papers/ 301", "/ /papers/ 301 # deep only", "/* /papers/:splat 301"):
        (site / "_redirects").write_text(redirect)
        rejects(lambda: m.validate_tree(site), "project-wide root")
    (site / "_redirects").write_text("# comment only")
    function.unlink()
    rejects(lambda: m.validate_tree(site), "Function missing")
    function.write_text("export function onRequest() {}")
    (site / "index.html").write_text("<title>Old papers</title>")
    rejects(lambda: m.validate_tree(site), "JPcu")
    (site / "index.html").write_text(m.TITLE)

    expression = '(http.host in {"qwav.tech" "www.qwav.tech"})'
    marketing = m.redirect_rule(expression, "https://qnfo.org/")
    primer = dict(m.redirect_rule('(http.host eq "primer.qwav.tech")', "https://deep.qwav.tech/"), ref="primer")
    before = [primer, marketing]
    rules = m.planned_rules(before, "qwav.tech")
    assert before == [primer, marketing], "planning must not mutate the backup"
    assert rules[0] == primer, "unrelated primer redirect is preserved"
    assert rules[1]["action_parameters"]["from_value"] == {
        "status_code": 301, "preserve_query_string": True,
        "target_url": {"expression": 'concat("https://qwav.org", http.request.uri.path)'},
    }
    assert rules[2]["expression"] == '(http.host eq "deep.qwav.tech" and http.request.uri.path eq "/")'
    assert rules[2]["action_parameters"]["from_value"]["target_url"]["value"] == "https://deep.qwav.tech/papers/"
    assert m.planned_rules(rules, "qwav.tech") == rules, "repair must be idempotent"
    assert m.planned_rules([], "qwav.tech")[0]["expression"] == expression
    for zone in ("qwav.org", "qwav.net", "qwav.uk"):
        old = m.redirect_rule('(http.host in {"%s" "www.%s"})' % (zone, zone), "https://qnfo.org/")
        assert m.planned_rules([old, primer], zone) == [dict(old, enabled=False), primer]

    domains = [{"name": host, "status": "active", "verification_data": {"status": "active"},
                "validation_data": {"status": "active"}} for host in ("qwav.org", "qwav.tech", "www.qwav.tech")]
    writes = []
    def request(method, path, body=None):
        if method != "GET":
            writes.append((method, path, body))
            return {}
        if path.endswith("/entrypoint"):
            return {"id": "ruleset", "rules": [primer, marketing] if "331e" in path else []}
        if path.endswith("/workers/routes"):
            return [
                {"id": "stale", "pattern": "qwav.net/*", "script": "qnfo-lifecycle"},
                {"id": "other", "pattern": "ask.qwav.org/*", "script": "qnfo-ai-search"},
                {"id": "new-owner", "pattern": "qwav.org/*", "script": "another-worker"},
            ]
        if path.endswith("/domains"):
            return domains
        return {"canonical_deployment": {"id": "deployment", "latest_stage": {"status": "success"},
                "uses_functions": True, "deployment_trigger": {"metadata": {"commit_hash": "abc", "commit_dirty": False}}}}
    m.repair_edge(request)
    assert len([w for w in writes if w[0] == "PUT"]) == 1
    assert [w[1] for w in writes if w[0] == "DELETE"] == ["/zones/" + m.ZONES["qwav.net"] + "/workers/routes/stale"]
    assert not any(w[0] == "PATCH" for w in writes)
    missing = domains.pop()
    writes.clear()
    rejects(lambda: m.repair_edge(request), "custom domain missing")
    assert writes == [], "missing Pages prerequisites must not mutate edge state"
    domains.append(missing)
    domains[1]["validation_data"]["status"] = "pending"
    writes.clear()
    m.repair_edge(request)
    assert [w[1].split("/")[-1] for w in writes if w[0] == "PATCH"] == ["qwav.tech"]
    domains[1]["validation_data"]["status"] = "active"

    (site / "papers").mkdir()
    (site / "papers/index.html").write_text('<a href="https://deep.qwav.tech/papers/missing">one</a>'
                                         '<a href="https://deep.qwav.tech/papers/valid">two</a>')
    def get(url):
        if "/api/paper/" in url:
            return (404, {}, "missing") if url.endswith("missing") else (200, {"Content-Type": "text/markdown; charset=utf-8"}, "# Paper")
        if "/papers/" in url:
            return 200, {}, "<title>Papers</title><a href='/papers/valid'>Paper</a>"
        for host in ("qwav.tech", "www.qwav.tech", "deep.qwav.tech"):
            if url.startswith("https://" + host + "/"):
                target = "https://deep.qwav.tech/papers/" if host.startswith("deep.") else "https://qwav.org/"
                return 301, {"Location": target + ("?qwav_probe=1" if "?" in url else "")}, "redirect"
        return 200, {}, m.TITLE
    m.verify(site, "abc", get=get, request=request)
    rejects(lambda: m.verify(site, "wrong", get=get, request=request), "clean checked-out commit")
    for field, value in (("uses_functions", False), ("dirty", True), ("stage", "failed")):
        def bad_deployment(method, path, body=None):
            response = request(method, path, body)
            if "canonical_deployment" in response:
                deployment = response["canonical_deployment"]
                if field == "dirty":
                    deployment["deployment_trigger"]["metadata"]["commit_dirty"] = value
                elif field == "stage":
                    deployment["latest_stage"]["status"] = value
                else:
                    deployment[field] = value
            return response
        rejects(lambda: m.verify(site, "abc", get=get, request=bad_deployment), "clean checked-out commit")
    rejects(lambda: m.verify(site, "abc", "missing", get=get, request=request), "nonempty markdown")
    rejects(lambda: m.verify(site, "abc", "../bad", get=get, request=request), "invalid paper slug")
    def changed(url, status, headers, body):
        return lambda u: (status, headers, body) if u == url else get(u)
    for status, body in ((301, "301 Moved Permanently"), (200, "<title>Old index</title>")):
        rejects(lambda: m.verify(site, "abc", get=changed("https://qwav.org/", status, {}, body), request=request), "200 JPcu")
    rejects(lambda: m.verify(site, "abc", get=changed("https://qwav.tech/", 301, {"Location": "https://qwav.org/papers/"}, ""), request=request), "expected 301")
    rejects(lambda: m.verify(site, "abc", get=changed("https://deep.qwav.tech/?qwav_probe=1", 301, {"Location": "https://deep.qwav.tech/papers/"}, ""), request=request), "expected 301")
    rejects(lambda: m.verify(site, "abc", get=changed("https://qwav.org/api/paper/valid", 200, {"Content-Type": "text/html"}, "SPA"), request=request), "nonempty markdown")
    rejects(lambda: m.verify(site, "abc", get=changed("https://qwav.org/papers/", 200, {}, m.TITLE), request=request), "papers index")
    domains[1]["validation_data"]["status"] = "pending"
    rejects(lambda: m.verify(site, "abc", get=get, request=request), "not active")
print("QWAV Pages regression checks passed")
`,
});
assert.equal(result.status, 0, result.stdout + result.stderr);

const workflow = readFileSync(new URL("../.github/workflows/qwav-pages-deploy.yml", import.meta.url), "utf8");
assert.match(workflow, /push:\n    branches: \[main\]/);
assert.match(workflow, /--commit-hash "\$commit" --commit-dirty=false/);
assert.match(workflow, /git status --porcelain/);
assert.match(workflow, /qwav_pages\.py validate --site site/);
assert.match(workflow, /qwav_pages\.py preflight/);
assert.match(workflow, /qwav_pages\.py repair/);
assert.match(workflow, /qwav_pages\.py verify/);
assert.doesNotMatch(workflow, /::warning::qwav\.org|--commit-dirty=true/);
console.log(result.stdout + "QWAV workflow integration checks passed");
