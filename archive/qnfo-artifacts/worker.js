/**
 * qnfo-artifacts v1.2.0 -- Cloudflare Artifacts control plane + fleet repository access.
 *
 * WHY THIS EXISTS
 *   All 182 QNFO / rwnq8 repositories live in two Artifacts namespaces (qnfo = the QNFO org,
 *   rwnq8 = the personal account). Nothing could read them: no Worker held an Artifacts binding,
 *   so "repository content is available to the fleet" was true on paper only. This worker is the
 *   one control plane over both namespaces.
 *
 * BINDINGS
 *   ARTIFACTS       -> namespace "qnfo"
 *   ARTIFACTS_RWNQ8 -> namespace "rwnq8"
 *   AUDIT           -> D1 qnfo-audit (optional: /registry falls back to the live namespace listing)
 *   OPS_ROUTER_AUTH_KEY -> shared secret; when present, mutating routes require Bearer auth
 *
 * ROUTES
 *   GET  /health                                liveness + self-doc
 *   GET  /                                     self-doc
 *   GET  /registry                             repo index across both namespaces
 *   GET  /repos?namespace=&limit=&cursor=       list repos in a namespace
 *   POST /repos {namespace,name,description}    create a repo            (auth)
 *   GET  /repos/:ns/:name                      repo metadata + HEAD
 *   GET  /repos/:ns/:name/log?limit=&ref=      commit log
 *   GET  /repos/:ns/:name/tree?ref=&path=      file listing at a ref    (bounded)
 *   GET  /repos/:ns/:name/file?path=&ref=      file content (text)
 *   POST /repos/:ns/:name/token {scope,ttl}    mint a scoped Git token   (auth)
 *   POST /workspace {namespace,unit,kind}      isolated repo for a task  (auth)
 *
 * DEFECTS FIXED FROM v1.1.0 (which never deployed, so nothing broke in production)
 *   * readFile({ path, ref }) THROWS unless ref is a non-empty string; v1.1.0 passed
 *     ref: undefined whenever the caller omitted ?ref=, so every plain /file read failed.
 *     The ref now defaults to the repository's own default branch.
 *   * readFile() resolves to a BLOB, not a string; v1.1.0 checked for string/ArrayBuffer and
 *     otherwise returned JSON.stringify(blob) == "{}" -- a silent empty body. It uses .text().
 *   * repo handles are disposable. v1.2.0 used `using` (Explicit Resource Management); the fleet's
 *     SUITE-SYNTAX-CHECK-1 runs `node --check` on a file this old Node rejects that syntax for, so
 *     the handles are held as plain consts and released when the request ends. Portability over
 *     the tidier binding: a worker that cannot be syntax-checked cannot be merged.
 */

var VERSION = "1.2.3"; // 1.2.3 HEALTH-CONTRACT-1 (agent_issues 2852, capability_contract_conformance, pillar autonomy): /health declares limitations[] next to capabilities[] (module constants CAPABILITIES and LIMITATIONS); before this the snapshot read an empty limitations list for this worker. No behaviour change.
const MAX_TTL = 86400;
const DEFAULT_TTL = 3600;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const NAMESPACES = ["qnfo", "rwnq8"];

// HEALTH-CONTRACT-1 (agent_issues 2852): the capability contract on /health. qnfo-deploy-guard snapshots capabilities[] and
// limitations[] from every live worker's /health and qnfo-fleet-control grades the share that declare both. Every limit below is
// enforced in this file (the constants and routes it names) or stated in its header.
const CAPABILITIES = ["artifacts-control-plane", "repo-list", "commit-log", "tree-listing",
  "file-read", "scoped-git-tokens", "agent-workspace-provisioning"];
const LIMITATIONS = [
  "mutating routes (POST /repos, POST /repos/:ns/:name/token, POST /workspace) are default-deny: without OPS_ROUTER_AUTH_KEY they answer 503 writes_disabled, with it they need a matching Bearer or X-Ops-Key",
  "no route deletes a repository or writes file content: the worker lists, reads and creates repositories, and a caller writes through the scoped Git token it mints",
  "only the two Artifacts namespaces qnfo and rwnq8, each through its own binding (ARTIFACTS, ARTIFACTS_RWNQ8); a namespace with no binding is reported under missing_bindings and /health reads degraded when none is bound",
  "paged and bounded: /repos returns at most 100 repositories per page (default 25), /log at most 100 commits (default 20) and /tree at most 500 file names (default 200, files_truncated says when it cut)",
  "a scoped Git token lives at most " + MAX_TTL + " seconds (default " + DEFAULT_TTL + ")",
  "a repository name must match " + NAME_RE.source + " and a description is cut at 1024 characters",
  "/file returns one blob decoded as text, so it is not a binary-safe download, and no route serves a whole-tree archive"
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function fail(message, status = 400, code = "bad_request") {
  return json({ ok: false, error: code, message }, status);
}
function clampTtl(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL;
  return Math.min(Math.floor(n), MAX_TTL);
}
async function readJson(request) {
  try { return await request.json(); } catch (e) { return {}; }
}
function nsBinding(env, ns) {
  if (ns === "rwnq8") return env.ARTIFACTS_RWNQ8 || null;
  if (ns === "qnfo") return env.ARTIFACTS || null;
  return null;
}
function authorized(request, env) {
  const key = env.OPS_ROUTER_AUTH_KEY;
  // Default-deny. The worker is public on workers.dev and POST /repos creates a billable Artifacts
  // repository, so an unconfigured key must close the mutating routes rather than open them.
  if (!key) return false;
  const h = request.headers.get("Authorization") || "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : (request.headers.get("X-Ops-Key") || "");
  return given === key;
}
function writeDisabled(env) {
  if (env.OPS_ROUTER_AUTH_KEY) return fail("unauthorized", 401, "unauthorized");
  return fail("mutating routes are disabled: OPS_ROUTER_AUTH_KEY is not configured on this worker",
              503, "writes_disabled");
}
async function defaultBranch(repo, fallback) {
  try {
    const info = await repo.info();
    return (info && info.defaultBranch) || fallback || "main";
  } catch (e) {
    return fallback || "main";
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    if (path === "/health" || path === "/") {
      const bound = NAMESPACES.filter((n) => !!nsBinding(env, n));
      return json({
        status: bound.length ? "ok" : "degraded",
        worker: "qnfo-artifacts", version: VERSION,
        namespaces: bound,
        missing_bindings: NAMESPACES.filter((n) => !nsBinding(env, n)),
        auth_required_for_writes: !!env.OPS_ROUTER_AUTH_KEY,
        capabilities: CAPABILITIES,
        limitations: LIMITATIONS,
      });
    }

    if (path === "/registry" && method === "GET") {
      const reg = [];
      for (const ns of NAMESPACES) {
        const b = nsBinding(env, ns);
        if (!b) continue;
        try {
          let cursor;
          do {
            const page = await b.list({ limit: 100, cursor });
            for (const r of page.repos) reg.push({ namespace: ns, name: r.name, status: r.status });
            cursor = page.cursor || null;
          } while (cursor);
        } catch (e) {
          reg.push({ namespace: ns, error: String((e && e.message) || e) });
        }
      }
      return json({ ok: true, total: reg.length, namespaces: NAMESPACES, repos: reg });
    }

    const ns = url.searchParams.get("namespace") || "qnfo";
    if (!NAMESPACES.includes(ns)) return fail("namespace must be one of " + NAMESPACES.join(", "), 400, "invalid_namespace");

    if (path === "/repos" && method === "GET") {
      const binding = nsBinding(env, ns);
      if (!binding) return fail("ARTIFACTS binding missing for namespace " + ns, 501, "binding_missing");
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 100);
      const cursor = url.searchParams.get("cursor") || undefined;
      try {
        const page = await binding.list({ limit, cursor });
        return json({ ok: true, namespace: ns, count: page.repos.length,
                      cursor: page.cursor == null ? null : page.cursor,
                      repos: page.repos.map((r) => ({ name: r.name, status: r.status })) });
      } catch (e) { return fail(String((e && e.message) || e), 502, "list_failed"); }
    }

    if (path === "/repos" && method === "POST") {
      if (!authorized(request, env)) return writeDisabled(env);
      const binding = nsBinding(env, ns);
      if (!binding) return fail("ARTIFACTS binding missing for namespace " + ns, 501, "binding_missing");
      const body = await readJson(request);
      const name = String(body.name || "");
      if (!NAME_RE.test(name)) return fail("invalid repo name", 400, "invalid_name");
      try {
        const created = await binding.create(name, {
          description: body.description ? String(body.description).slice(0, 1024) : undefined,
          readOnly: body.readOnly === true,
          setDefaultBranch: body.defaultBranch ? String(body.defaultBranch) : "main",
        });
        return json({ ok: true, namespace: ns,
                      repo: { name: created.name, defaultBranch: created.defaultBranch, remote: created.remote },
                      token: created.token }, 201);
      } catch (e) { return fail(String((e && e.message) || e), 409, "create_failed"); }
    }

    const repoMatch = path.match(/^\/repos\/([^/]+)\/([^/]+?)(\/log|\/tree|\/token|\/file)?$/);
    if (repoMatch) {
      const rns = decodeURIComponent(repoMatch[1]);
      const name = decodeURIComponent(repoMatch[2]);
      const sub = repoMatch[3] || "";
      if (!NAMESPACES.includes(rns)) return fail("invalid namespace", 400, "invalid_namespace");
      const b = nsBinding(env, rns);
      if (!b) return fail("ARTIFACTS binding missing for namespace " + rns, 501, "binding_missing");

      if (sub === "" && method === "GET") {
        try {
          const repo = await b.get(name);
          const info = await repo.info();
          let head = null, logErr = null;
          try {
            const log = await repo.log({ ref: info.defaultBranch || "main", limit: 1 });
            head = (log && log[0] && log[0].hash) || null;
          } catch (e) { logErr = String((e && e.message) || e); }
          return json({ ok: true, namespace: rns, repo: info.name,
                        default_branch: info.defaultBranch, read_only: info.readOnly,
                        source: info.source, updated_at: info.updatedAt,
                        head_sha: head, head_error: logErr });
        } catch (e) {
          return fail("repo '" + rns + "/" + name + "' not found or not ready", 404, "repo_not_found");
        }
      }

      if (sub === "/log" && method === "GET") {
        try {
          const repo = await b.get(name);
          const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 100);
          const ref = url.searchParams.get("ref") || await defaultBranch(repo);
          const log = await repo.log({ ref, limit });
          return json({ ok: true, namespace: rns, repo: name, ref, commits: log });
        } catch (e) { return fail(String((e && e.message) || e), 502, "log_failed"); }
      }

      if (sub === "/tree" && method === "GET") {
        // Bounded listing: agents need to discover paths before reading them, but an unbounded
        // walk of a 1200-file repo is a CPU bill. 500 entries per call, caller pages with path.
        try {
          const repo = await b.get(name);
          const ref = url.searchParams.get("ref") || await defaultBranch(repo);
          const prefix = (url.searchParams.get("path") || "").replace(/^\/+|\/+$/g, "");
          const max = Math.min(Number(url.searchParams.get("limit")) || 200, 500);
          const log = await repo.log({ ref, limit: 1 });
          if (!log || !log[0]) return fail("ref not found: " + ref, 404, "ref_not_found");
          let treeHash = log[0].treeHash, walked = "", missing = "";
          for (const seg of (prefix ? prefix.split("/") : [])) {
            const entries = await repo.readTree(treeHash);
            const hit = (entries || []).find((e) => e.name === seg && e.type === "tree");
            if (!hit) { missing = seg; break; }
            treeHash = hit.hash;
            walked = walked ? walked + "/" + seg : seg;
          }
          if (missing) return fail("path not found: " + missing, 404, "path_not_found");
          const entries = (await repo.readTree(treeHash)) || [];
          const files = entries.filter((e) => e.type === "blob").map((e) => ({
            path: walked ? walked + "/" + e.name : e.name, sha: e.hash }));
          const dirs = entries.filter((e) => e.type === "tree").map((e) => ({
            path: walked ? walked + "/" + e.name : e.name }));
          return json({ ok: true, namespace: rns, repo: name, ref, prefix: walked || null,
                        dirs, files: files.slice(0, max), files_truncated: files.length > max,
                        file_count: files.length });
        } catch (e) { return fail(String((e && e.message) || e), 502, "tree_failed"); }
      }

      if (sub === "/file" && method === "GET") {
        const filePath = url.searchParams.get("path");
        if (!filePath) return fail("path query param required", 400, "missing_path");
        try {
          const repo = await b.get(name);
          const ref = url.searchParams.get("ref") || await defaultBranch(repo);
          const blob = await repo.readFile({ ref, path: filePath });
          if (!blob) return fail("file not found: " + filePath, 404, "file_not_found");
          const text = await blob.text();
          return new Response(text, {
            headers: { "Content-Type": blob.type || "text/plain; charset=utf-8", "Cache-Control": "no-store" },
          });
        } catch (e) { return fail(String((e && e.message) || e), 502, "read_file_failed"); }
      }

      if (sub === "/token" && method === "POST") {
        if (!authorized(request, env)) return writeDisabled(env);
        const body = await readJson(request);
        const scope = body.scope === "read" ? "read" : "write";
        const ttl = clampTtl(body.ttl);
        try {
          const repo = await b.get(name);
          const token = await repo.createToken(scope, ttl);
          return json({ ok: true, namespace: rns, repo: name, scope, ttl, token });
        } catch (e) { return fail(String((e && e.message) || e), 502, "token_failed"); }
      }

      return fail("method not allowed", 405, "method_not_allowed");
    }

    if (path === "/workspace" && method === "POST") {
      if (!authorized(request, env)) return writeDisabled(env);
      const body = await readJson(request);
      const rawUnit = String(body.unit || "").trim();
      if (!rawUnit) return fail("unit required", 400, "missing_unit");
      const kind = ["agent", "task", "branch", "user"].indexOf(body.kind) >= 0 ? body.kind : "agent";
      const wns = body.namespace === "rwnq8" ? "rwnq8" : "qnfo";
      const binding = nsBinding(env, wns);
      if (!binding) return fail("ARTIFACTS binding missing for namespace " + wns, 501, "binding_missing");
      const slug = rawUnit.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
      if (!slug) return fail("unit produced an empty slug", 400, "invalid_unit");
      try {
        const created = await binding.create(kind + "-" + slug, {
          description: "Isolated Artifacts workspace for " + kind + ":" + rawUnit,
          readOnly: false, setDefaultBranch: "main",
        });
        return json({ ok: true, namespace: wns,
                      workspace: { kind, unit: rawUnit, repo: created.name,
                                   defaultBranch: created.defaultBranch, remote: created.remote },
                      token: created.token }, 201);
      } catch (e) { return fail(String((e && e.message) || e), 409, "workspace_create_failed"); }
    }

    return fail("not found", 404, "not_found");
  },
};
