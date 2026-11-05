#!/usr/bin/env python3
"""repo_content_index.py -- ARTIFACTS-CONTENT-INDEX-1

WHY THIS EXISTS
  Migrating repositories into Artifacts makes them durable; it does not make them FINDABLE. Until
  repository content is in the fleet's own stores, no agent can answer "where is this implemented"
  or "what does our LICENSE actually say" without shelling out to git. The owner directive is that
  repository content is integrated with the fleet's databases, graph and AI indices.

WHAT IT DOES (one repo at a time, resumable, budgeted)
  1. reads the converged replica of a repo from Artifacts (HEAD tree walk, blobs by sha)
  2. keeps text worth searching, skipping vendored, generated and duplicate trees
  3. embeds chunks with Workers AI and upserts them into Vectorize index `qnfo-repos`
  4. writes one qnfo-audit.repo_file_index row per file (vector ids, size, language)
  5. links the repo to what it contains in the knowledge graph (qnfo-graph)

REFUSALS (each one is deliberate, not an omission)
  * never indexes a repo whose replica is not converged (artifact_sync_state.in_sync = 1):
    indexing a stale tree is how a knowledge base becomes confidently wrong
  * never indexes a blob twice: a file whose blob_sha is already in repo_file_index is skipped
  * never embeds generated/duplicated trees (node_modules, dist, deployed-current mirrors)

USAGE
  python scripts/repo_content_index.py --max-repos 5 --max-chunks 400
  python scripts/repo_content_index.py --repo qnfo/qnfo-workers --dry-run
"""

import argparse
import hashlib
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from functools import partial

from cloudflare_http import request_json

CF = "https://api.cloudflare.com/client/v4"
AUDIT_D1 = os.environ.get("QNFO_AUDIT_D1_ID", "35e2e573-92f3-46ac-83c6-22f6429fc5e5")
GRAPH_D1 = os.environ.get("QNFO_GRAPH_D1_ID", "a1954b92-d681-4d02-b1f6-f9a2eb4c265d")
INDEX = "qnfo-repos"
EMBED_MODEL = "@cf/baai/bge-base-en-v1.5"
DIMS = 768
CHUNK = 1400
OVERLAP = 200
MAX_FILE_BYTES = 96 * 1024

TEXT_EXT = {
    ".md", ".markdown", ".txt", ".rst", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py",
    ".sql", ".json", ".jsonc", ".toml", ".yml", ".yaml", ".lean", ".tex", ".bib", ".sh", ".ps1",
    ".html", ".css", ".csv", ".r", ".jl",
}
SKIP_DIRS = {
    "node_modules", ".git", "dist", "build", "vendor", ".wrangler", "coverage", ".next",
    "__pycache__", "site-packages", ".venv", "venv", "target",
}
SKIP_FILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "poetry.lock"}
SKIP_PATTERNS = ("deployed-current.worker.js",)  # byte-identical mirrors of worker.js


http = partial(request_json, timeout=90, user_agent="qnfo-repo-content-index/1.0")


def d1(acct, token, db, sql, params=None):
    body = {"sql": sql}
    if params:
        body["params"] = params
    return http(CF + "/accounts/" + acct + "/d1/database/" + db + "/query", token, "POST", body)


D1_RETRY_DELAYS = (3, 8, 20, 45)  # seconds between attempts; D1 overload clears in tens of seconds


def d1_transient(st, j):
    """True for a D1 overload (code 7429) or a 5xx: the statement is valid, the database is busy."""
    if st >= 500 or st == 429:
        return True
    errs = (j or {}).get("errors") or []
    return any(isinstance(e, dict) and e.get("code") in (7429, 7500) for e in errs)


def q(acct, token, db, sql, params=None, sleep=time.sleep):
    # D1-OVERLOAD-RETRY-1 (issue 6918): the ledger read failed the whole sync on one 7429 ("D1 DB is overloaded")
    # while the shared qnfo-audit database was busy; retry with backoff before giving up.
    delays = iter(D1_RETRY_DELAYS)
    while True:
        st, j = d1(acct, token, db, sql, params)
        ok = 200 <= st < 300 and j.get("success")
        if not ok and d1_transient(st, j):
            wait = next(delays, None)
            if wait is not None:
                sleep(wait)
                continue
        break
    if not ok:
        return None, j.get("errors") or j
    res = j.get("result") or []
    return (res[0].get("results") if res else []), None


def ensure_index(acct, token):
    st, j = http(CF + "/accounts/" + acct + "/vectorize/v2/indexes/" + INDEX, token)
    if 200 <= st < 300:
        cfg = (j.get("result") or {}).get("config") or {}
        return {"exists": True, "dimensions": cfg.get("dimensions"), "metric": cfg.get("metric")}
    st, j = http(CF + "/accounts/" + acct + "/vectorize/v2/indexes", token, "POST",
                 {"name": INDEX, "description": "QNFO repository content (Artifacts replicas, HEAD)",
                  "config": {"dimensions": DIMS, "metric": "cosine"}})
    return {"exists": st in (200, 201), "created": st in (200, 201),
            "detail": None if st in (200, 201) else json.dumps(j.get("errors") or j)[:200]}


def walk(acct, token, ns, repo, commit_hash):
    """Depth-first walk of the HEAD tree, yielding (path, blob_sha, size_unknown)."""
    base = CF + "/accounts/" + acct + "/artifacts/namespaces/" + ns + "/repos/" + repo
    st, j = http(base + "/commit/" + commit_hash, token)
    if st != 200:
        return [], "commit_read_%s" % st
    root = (j.get("result") or {}).get("treeHash")
    if not root:
        return [], "no_root_tree"
    out, stack, guard = [], [(root, "")], 0
    while stack and guard < 4000:
        guard += 1
        tree_hash, prefix = stack.pop()
        st, j = http(base + "/tree/" + tree_hash, token)
        if st != 200:
            continue
        for e in (j.get("result") or []):
            name, typ = e.get("name"), e.get("type")
            p = prefix + name if not prefix else prefix + "/" + name
            if typ == "tree":
                if name in SKIP_DIRS:
                    continue
                stack.append((e.get("hash"), p))
            elif typ == "blob":
                out.append((p, e.get("hash")))
    return out, None


def wanted(path):
    low = path.lower()
    base = low.rsplit("/", 1)[-1]
    if base in SKIP_FILES or any(base.endswith(s) for s in SKIP_PATTERNS):
        return False
    ext = "." + base.rsplit(".", 1)[-1] if "." in base else ""
    return ext in TEXT_EXT


def chunk(text):
    out, i = [], 0
    while i < len(text):
        out.append(text[i:i + CHUNK])
        if i + CHUNK >= len(text):
            break
        i += CHUNK - OVERLAP
    return out


def embed(acct, token, texts):
    st, j = http(CF + "/accounts/" + acct + "/ai/run/" + EMBED_MODEL, token, "POST",
                 {"text": texts}, timeout=120)
    if not (200 <= st < 300):
        return None, json.dumps(j.get("errors") or j)[:200]
    data = ((j.get("result") or {}).get("data") or [])
    if len(data) != len(texts):
        return None, "embed_count_mismatch"
    return data, None


def vid(ns, repo, path, idx):
    h = hashlib.sha1(("%s/%s:%s#%d" % (ns, repo, path, idx)).encode()).hexdigest()[:32]
    return ("%s-%s" % (repo[:24], h))[:64]


def index_repo(ctx, row, budget):
    acct, token = ctx["acct"], ctx["token"]
    ns, repo = row["namespace"], row["artifacts_name"]
    base = CF + "/accounts/" + acct + "/artifacts/namespaces/" + ns + "/repos/" + repo
    st, j = http(base + "/log?limit=1", token)
    if st != 200 or not (j.get("result") or []):
        return {"repo": ns + "/" + repo, "skipped": "no_head", "status": st}
    head = j["result"][0]["hash"]

    files, err = walk(acct, token, ns, repo, head)
    if err:
        return {"repo": ns + "/" + repo, "skipped": err}
    candidates = [(p, h) for (p, h) in files if wanted(p)]

    known = set()
    rows, e = q(acct, token, AUDIT_D1,
                "SELECT blob_sha FROM repo_file_index WHERE namespace = ? AND repo = ?", [ns, repo])
    if e:
        return {"repo": ns + "/" + repo, "skipped": "d1_read", "detail": json.dumps(e)[:160]}
    for r in rows:
        if r.get("blob_sha"):
            known.add(r["blob_sha"])

    todo = [(p, h) for (p, h) in candidates if h not in known]
    stats = {"repo": ns + "/" + repo, "head": head, "files_total": len(files),
             "files_text": len(candidates), "already_indexed": len(candidates) - len(todo),
             "files_new": 0, "chunks": 0, "vectors": 0, "errors": []}

    docs_for_graph = []
    for path, sha in todo:
        if budget["chunks"] <= 0:
            stats["stopped"] = "chunk_budget"
            break
        st, blob = http(base + "/blob/" + sha, token, raw=True)
        if st != 200 or not isinstance(blob, (bytes, bytearray)):
            stats["errors"].append({"path": path, "why": "blob_%s" % st})
            continue
        if len(blob) > MAX_FILE_BYTES:
            continue
        try:
            text = blob.decode("utf-8")
        except UnicodeDecodeError:
            continue
        if "\x00" in text[:1000]:
            continue
        pieces = chunk(text)[:12]
        vecs, counts = [], 0
        for i in range(0, len(pieces), 20):
            batch = pieces[i:i + 20]
            vals, e = embed(acct, token, batch)
            if e:
                stats["errors"].append({"path": path, "why": e})
                break
            for k, v in enumerate(vals):
                vecs.append({"id": vid(ns, repo, path, i + k), "values": v,
                             "metadata": {"ns": ns, "repo": repo, "path": path, "sha": sha,
                                          "chunk": i + k, "lang": lang_of(path),
                                          "text": batch[k][:180]}})
                counts += 1
        if not vecs:
            continue
        for i in range(0, len(vecs), 100):
            st, j = http(CF + "/accounts/" + acct + "/vectorize/v2/indexes/" + INDEX + "/upsert",
                         token, "POST", {"vectors": vecs[i:i + 100]}, timeout=150)
            if not (200 <= st < 300):
                stats["errors"].append({"path": path, "why": "upsert_%s" % st,
                                        "detail": json.dumps(j.get("errors") or j)[:120]})
                break
        budget["chunks"] -= counts
        stats["files_new"] += 1
        stats["chunks"] += counts
        stats["vectors"] += len(vecs)
        ids = json.dumps([v["id"] for v in vecs])
        d1(acct, token, AUDIT_D1,
           "INSERT INTO repo_file_index (id, repo_id, namespace, repo, path, blob_sha, bytes, lines, "
           "lang, vector_ids, chunks, indexed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now')) "
           "ON CONFLICT(id) DO UPDATE SET blob_sha=excluded.blob_sha, vector_ids=excluded.vector_ids, "
           "chunks=excluded.chunks, indexed_at=excluded.indexed_at, bytes=excluded.bytes",
           ["%s/%s#%s@%s" % (ns, repo, path, sha[:12]), row["id"], ns, repo, path, sha,
            len(blob), text.count("\n") + 1, lang_of(path), ids, len(vecs)])
        if path.lower().endswith((".md", ".markdown")) and len(docs_for_graph) < 5:
            docs_for_graph.append(path)

    # Graph: the Repository node already exists (repo:<ns>:<name>); record what it now contains.
    node_id = "repo:%s:%s" % (ns, row["name"])
    d1(acct, token, GRAPH_D1,
       "UPDATE nodes SET properties = json_set(COALESCE(NULLIF(properties,''),'{}'), "
       "'$.content_indexed_at', datetime('now'), '$.content_files', ?, '$.content_vectors', ?, "
       "'$.content_head', ?), updated_at = datetime('now') WHERE id = ?",
       [stats["files_new"], stats["vectors"], head, node_id])
    return stats


def lang_of(path):
    low = path.lower()
    for ext, lang in ((".py", "python"), (".js", "javascript"), (".mjs", "javascript"),
                      (".ts", "typescript"), (".sql", "sql"), (".md", "markdown"),
                      (".lean", "lean"), (".tex", "latex"), (".yml", "yaml"), (".yaml", "yaml"),
                      (".json", "json"), (".toml", "toml"), (".html", "html"), (".css", "css"),
                      (".sh", "shell"), (".ps1", "powershell"), (".r", "r"), (".bib", "bibtex")):
        if low.endswith(ext):
            return lang
    return "text"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-repos", type=int, default=5)
    ap.add_argument("--max-chunks", type=int, default=600)
    ap.add_argument("--repo", default="", help="namespace/name")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args()

    token = os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CF_API_TOKEN")
    acct = os.environ.get("CLOUDFLARE_ACCOUNT_ID") or os.environ.get("CF_ACCOUNT_ID")
    if not (token and acct):
        print(json.dumps({"ok": False, "error": "need CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID"}))
        return 3

    # Stop embedding repo content into Vectorize until a consumer exists.
    # A reader can set the environment variable QNFO_REPO_CONTENT_READER=1 to enable indexing.
    if os.getenv("QNFO_REPO_CONTENT_READER") != "1":
        print(json.dumps({
            "ok": True,
            "note": "no reader for Vectorize index qnfo-repos; skipping embedding",
            "index": idx
        }))
        return 0

    idx = ensure_index(acct, token)
    if not idx.get("exists"):
        print(json.dumps({"ok": False, "error": "vectorize index", "detail": idx}))
        return 3

    where = "a.archived = 0 AND s.in_sync = 1"
    params = []
    if args.repo:
        ns, _, nm = args.repo.partition("/")
        where += " AND a.namespace = ? AND a.name = ? AND s.in_sync IS NOT NULL"
        params = [ns, nm]
    sql = ("SELECT a.id, a.namespace, a.name, a.artifacts_name, s.in_sync FROM artifact_repos a "
           "LEFT JOIN artifact_sync_state s ON s.repo_id = a.id WHERE " + where +
           " ORDER BY COALESCE((SELECT MAX(indexed_at) FROM repo_file_index f "
           "WHERE f.namespace = a.namespace AND f.repo = a.artifacts_name), '1970') ASC "
           "LIMIT ?")
    params = params + [args.max_repos]
    rows, err = q(acct, token, AUDIT_D1, sql, params)
    if err:
        print(json.dumps({"ok": False, "error": "ledger read", "detail": json.dumps(err)[:300]}))
        return 3
    if not rows:
        print(json.dumps({"ok": True, "note": "no converged repos to index", "index": idx}))
        return 0

    if args.dry_run:
        print(json.dumps({"ok": True, "dry_run": True, "index": idx,
                          "would_index": [r["namespace"] + "/" + r["artifacts_name"] for r in rows]}))
        return 0

    budget = {"chunks": args.max_chunks}
    ctx = {"acct": acct, "token": token}
    results = []
    for r in rows:
        if budget["chunks"] <= 0:
            break
        try:
            results.append(index_repo(ctx, r, budget))
        except Exception as e:
            results.append({"repo": r["namespace"] + "/" + r["artifacts_name"], "error": str(e)[:200]})

    total_v = sum(x.get("vectors", 0) for x in results)
    total_f = sum(x.get("files_new", 0) for x in results)
    print(json.dumps({"ok": True, "index": idx, "repos": len(results),
                      "files_indexed": total_f, "vectors_upserted": total_v,
                      "chunk_budget_left": budget["chunks"], "results": results}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
