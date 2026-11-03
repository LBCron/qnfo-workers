#!/usr/bin/env python3
"""QWAV Pages source, edge and outcome checks for qnfo-fleet-issues#116 (reach)."""
import argparse
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from cf_ops_actions import call, emit, env, sanitize_rule

TITLE = "<title>QWAV — Ultrametric Computing Platform | Joules-per-Solution (JPCUB) | p-adic Architecture</title>"
PROJECT = "qwav"
PHASE = "http_request_dynamic_redirect"
ZONES = {
    "qwav.org": "4df9cb76facef38e78f6f6fc61cbb7c7",
    "qwav.tech": "331e4363fd05e8e4fc123ea7d2775411",
    "qwav.net": "260c09728193c4f902435bad47ce976c",
    "qwav.uk": "2e0b5be2a41da2a5754269984e7873ad",
}
HOME_HOSTS = ("qwav.org", "qwav.net", "www.qwav.uk", "score.qwav.tech")


def validate_tree(site):
    site = Path(site)
    if TITLE not in (site / "index.html").read_text():
        raise ValueError("QWAV root must contain the JPcu homepage")
    for line in (site / "_redirects").read_text().splitlines():
        fields = line.split("#", 1)[0].split()
        if fields and fields[0] in ("/", "/*"):
            raise ValueError("project-wide root redirect would shadow the JPcu homepage")
    if not (site / "functions/api/paper/[slug].js").is_file():
        raise ValueError("paper markdown Function missing from deployment tree")


def redirect_rule(expression, target, dynamic=False):
    return {
        "action": "redirect", "expression": expression, "enabled": True,
        "action_parameters": {"from_value": {
            "status_code": 301, "preserve_query_string": True,
            "target_url": {"expression" if dynamic else "value": target},
        }},
    }


def planned_rules(before, zone):
    rules = [sanitize_rule(r) for r in before]
    expression = '(http.host in {"%s" "www.%s"})' % (zone, zone)
    for rule in rules:
        if rule.get("action") != "redirect" or rule.get("expression") != expression:
            continue
        if zone == "qwav.tech":
            rule.update(redirect_rule(expression, 'concat("https://qwav.org", http.request.uri.path)', True))
        elif rule.get("enabled", True):
            rule["enabled"] = False
    if zone == "qwav.tech":
        want = redirect_rule(expression, 'concat("https://qwav.org", http.request.uri.path)', True)
        if not any(all(r.get(k) == v for k, v in want.items()) for r in rules):
            rules.insert(0, dict(want, description="QWAV Pages canonical apex and www"))
        expression = '(http.host eq "deep.qwav.tech" and http.request.uri.path eq "/")'
        want = redirect_rule(expression, "https://deep.qwav.tech/papers/")
        existing = next((r for r in rules if r.get("expression") == expression and r.get("action") == "redirect"), None)
        if existing is not None:
            existing.update(want)
        else:
            rules.append(dict(want, description="QWAV deep research root to papers"))
    return rules


def api(method, path, body=None):
    status, response = call(method, path, env("CLOUDFLARE_API_TOKEN"), body)
    if not 200 <= status < 300 or not response.get("success"):
        raise RuntimeError(f"{method} {path}: HTTP {status}: {response.get('errors')}")
    return response.get("result")


def project_path():
    return f"/accounts/{env('CLOUDFLARE_ACCOUNT_ID')}/pages/projects/{PROJECT}"


def repair_edge(request=api):
    path = project_path()
    request("GET", path)
    domains = request("GET", path + "/domains")
    for host in ("qwav.org", "qwav.tech", "www.qwav.tech"):
        if not any(d["name"] == host for d in domains):
            raise ValueError(f"Pages custom domain missing: {host}")
    # Disable only apex/www rules; keep a writable backup for rollback and all subdomain rules.
    for zone, zone_id in ZONES.items():
        path = f"/zones/{zone_id}"
        before = request("GET", path + f"/rulesets/phases/{PHASE}/entrypoint")
        rules = planned_rules(before["rules"], zone)
        if rules != [sanitize_rule(r) for r in before["rules"]]:
            emit({"stage": "redirect-backup", "zone": zone, "ruleset": before["id"],
                  "rules": [sanitize_rule(r) for r in before["rules"]]})
            request("PUT", path + "/rulesets/" + before["id"], {"rules": rules})
        for route in request("GET", path + "/workers/routes"):
            host = route.get("pattern", "").removesuffix("/*")
            if (host == zone or host.endswith("." + zone)) and route.get("pattern") == host + "/*" and (
                host in HOME_HOSTS and route.get("script") in ("qnfo-lifecycle", "qnfo-gateway")
                or host in ("qwav.tech", "www.qwav.tech") and route.get("script") == "qnfo-gateway"
            ):
                emit({"stage": "route-backup", "zone": zone, "route": route})
                request("DELETE", path + "/workers/routes/" + route["id"])
    path = project_path()
    for host in ("qwav.org", "qwav.tech", "www.qwav.tech"):
        domain = next(d for d in domains if d["name"] == host)
        if domain["validation_data"]["status"] != "active":
            request("PATCH", path + "/domains/" + host)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch(url):
    opener = urllib.request.build_opener(NoRedirect)
    request = urllib.request.Request(url, headers={"User-Agent": "qnfo-qwav-pages/1"})
    try:
        response = opener.open(request, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.code, response.headers, response.read().decode("utf-8", errors="replace")


def verify(site, commit, paper_slug="", get=fetch, request=api):
    for host in HOME_HOSTS:
        status, _, body = get(f"https://{host}/")
        if status != 200 or TITLE not in body:
            raise ValueError(f"{host}/: expected 200 JPcu homepage, got {status}")
    for host in ("qwav.tech", "www.qwav.tech", "deep.qwav.tech"):
        target = "https://deep.qwav.tech/papers/" if host.startswith("deep.") else "https://qwav.org/"
        for query in ("", "?qwav_probe=1"):
            status, headers, _ = get(f"https://{host}/{query}")
            if status != 301 or headers.get("Location") != target + query:
                raise ValueError(f"{host}/: expected 301 to {target + query}, got {status} {headers.get('Location')}")
    for host in ("qwav.org", "deep.qwav.tech"):
        status, _, body = get(f"https://{host}/papers/")
        if status != 200 or not body.strip() or TITLE in body:
            raise ValueError(f"{host}/papers/: expected 200 papers index, got {status}")
    candidates = [paper_slug] if paper_slug else re.findall(
        r'href="https://deep\.qwav\.tech/papers/([a-z0-9-]+)"',
        (Path(site) / "papers/index.html").read_text(),
    )[:20]
    for slug in candidates:
        if not re.fullmatch(r"[a-z0-9-]+", slug):
            raise ValueError("invalid paper slug")
        status, headers, body = get(f"https://qwav.org/api/paper/{slug}")
        if status == 200 and headers.get("Content-Type", "").startswith("text/markdown") and body.strip():
            break
    else:
        raise ValueError("no paper probe returned 200 nonempty markdown")
    path = project_path()
    deployment = request("GET", path)["canonical_deployment"]
    metadata = deployment["deployment_trigger"]["metadata"]
    if deployment["latest_stage"]["status"] != "success" or not deployment.get("uses_functions") \
            or metadata.get("commit_hash") != commit or metadata.get("commit_dirty") is not False:
        raise ValueError("production deployment must match the clean checked-out commit and retain Functions")
    domains = request("GET", path + "/domains")
    for host in ("qwav.org", "qwav.tech", "www.qwav.tech"):
        domain = next((d for d in domains if d["name"] == host), {})
        if any(domain.get(key, {}).get("status") != "active" for key in ("verification_data", "validation_data")) \
                or domain.get("status") != "active":
            raise ValueError(f"Pages custom domain not active: {host}")
    emit({"action": "qwav-pages-deploy", "ok": True, "commit": commit,
          "deployment": deployment["id"], "paper_slug": slug})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("validate", "preflight", "repair", "verify"))
    parser.add_argument("--site", default="site")
    parser.add_argument("--commit", default="")
    parser.add_argument("--paper-slug", default="")
    args = parser.parse_args()
    if args.action == "validate":
        validate_tree(args.site)
    elif args.action == "preflight":
        project = api("GET", project_path())
        if not project.get("uses_functions"):
            raise ValueError("qwav project must retain its existing Pages Functions")
    elif args.action == "repair":
        repair_edge()
    else:
        for attempt in range(6):
            try:
                verify(args.site, args.commit, args.paper_slug)
                return
            except (ValueError, urllib.error.URLError) as error:
                print(f"verification attempt {attempt + 1}: {error}")
                if attempt == 5:
                    raise
                time.sleep(20)


if __name__ == "__main__":
    main()
