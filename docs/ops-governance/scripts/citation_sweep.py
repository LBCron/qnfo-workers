#!/usr/bin/env python3
"""citation_sweep.py - QNFO citation & impact metrics sweep (canonical).

Collects per-DOI impact metrics for the QNFO corpus and upserts into
qnfo-audit.citation_stats (doi/source/metric/value/collected_at).

Sources:
  - openalex: cited_by_count  (https://api.openalex.org/works/doi:{doi})
  - datacite: citationCount   (https://api.datacite.org/dois/{doi}?include=events) -
    Zenodo DOIs are DataCite-registered, so DataCite events is the canonical citation
    source for this corpus (Crossref does not index Zenodo DOIs - 404).
  - zenodo:   views / downloads (record stats from the Zenodo records API)

Usage: python citation_sweep.py [--limit 60]
Env: ~/.env keys CLOUDFLARE_API_TOKEN.
"""
import os, sys, json, time, hashlib, urllib.request, urllib.parse, urllib.error

ACCOUNT = "edb167b78c9fb901ea5bca3ce58ccc4b"
AUDIT_DB = "35e2e573-92f3-46ac-83c6-22f6429fc5e5"
LIVING_DB = "70a58cb3-b2cd-498d-877f-ecca86859a22"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) qnfo-citation-sweep/1.0 (mailto:qnfo@qnfo.org)"


def load_env(path="~/.env"):
    env = {}
    with open(os.path.expanduser(path), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def http(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as r:
        raw = r.read().decode("utf-8", "replace")
        return json.loads(raw) if raw.strip() else {}


def d1(cf_token, db, sql, params=None):
    url = "https://api.cloudflare.com/client/v4/accounts/%s/d1/database/%s/query" % (ACCOUNT, db)
    body = {"sql": sql}
    if params:
        body["params"] = params
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                 headers={"Authorization": "Bearer " + cf_token, "Content-Type": "application/json", "User-Agent": UA}, method="POST")
    with urllib.request.urlopen(req, timeout=40) as r:
        res = json.loads(r.read().decode("utf-8", "replace"))
    if not res.get("success"):
        raise RuntimeError("d1 failed: " + str(res)[:200])
    return res


def main():
    limit = 60
    for i, a in enumerate(sys.argv):
        if a == "--limit" and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])
    env = load_env()
    cf = env.get("CLOUDFLARE_API_TOKEN", "")
    if not cf:
        print(json.dumps({"error": "CLOUDFLARE_API_TOKEN missing from ~/.env"}))
        sys.exit(1)

    # corpus DOIs from living-paper
    res = d1(cf, LIVING_DB, "SELECT DISTINCT zenodo_doi AS doi FROM papers WHERE zenodo_doi IS NOT NULL AND zenodo_doi != '' AND status IN ('published','distributed') ORDER BY updated_at DESC LIMIT ?", [limit])
    dois = [r["doi"] for r in res.get("result", [])[0].get("results", []) if r.get("doi")]
    print("corpus DOIs: %d (limit %d)" % (len(dois), limit))

    today = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"
    upsert = ("INSERT INTO citation_stats (id, doi, source, metric, value, collected_at) VALUES (?,?,?,?,?,?) "
              "ON CONFLICT(id) DO UPDATE SET value=excluded.value, collected_at=excluded.collected_at")
    written = 0
    per_source = {"openalex": 0, "datacite": 0, "zenodo": 0}
    for doi in dois:
        doi = doi.strip()
        if not doi.startswith("10."):
            continue
        # openalex
        try:
            w = http("https://api.openalex.org/works/doi:" + urllib.parse.quote(doi, safe=""))
            if w and isinstance(w, dict) and "cited_by_count" in w:
                d1(cf, AUDIT_DB, upsert, [hashlib.sha1(("openalex|" + doi).encode()).hexdigest()[:32], doi, "openalex", "cited_by_count", w["cited_by_count"], today])
                written += 1
                per_source["openalex"] += 1
        except Exception:
            pass
        time.sleep(0.4)
        # datacite (canonical citation source for Zenodo/DataCite DOIs)
        try:
            w = http("https://api.datacite.org/dois/" + urllib.parse.quote(doi, safe="") + "?include=events")
            cnt = ((w.get("data") or {}).get("attributes") or {}).get("citationCount", 0)
            d1(cf, AUDIT_DB, upsert, [hashlib.sha1(("datacite|" + doi).encode()).hexdigest()[:32], doi, "datacite", "cited_by_count", cnt, today])
            written += 1
            per_source["datacite"] += 1
        except Exception:
            pass
        # zenodo record stats (record id = suffix after last '.')
        try:
            rid = doi.rsplit(".", 1)[-1]
            w = http("https://zenodo.org/api/records/" + rid)
            st = w.get("stats") or {}
            d1(cf, AUDIT_DB, upsert, [hashlib.sha1(("zenodo-v|" + doi).encode()).hexdigest()[:32], doi, "zenodo", "views", st.get("views", 0), today])
            d1(cf, AUDIT_DB, upsert, [hashlib.sha1(("zenodo-d|" + doi).encode()).hexdigest()[:32], doi, "zenodo", "downloads", st.get("downloads", 0), today])
            written += 2
            per_source["zenodo"] += 1
        except Exception:
            pass
        time.sleep(0.4)

    print(json.dumps({"rows_written": written, "per_source": per_source, "collected_at": today}))


if __name__ == "__main__":
    main()
