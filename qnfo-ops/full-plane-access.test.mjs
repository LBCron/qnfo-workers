// FULL-PLANE-ACCESS-1 (agent_issues 100073), qnfo-ops 2.50.0 offline suite. No network: fetch and the service bindings are
// stubs. Proves: the seven tools are declared, dispatched and named in the operator prompt; the public mode is unchanged; GitHub issues, comments and Projects v2 shape their answers and fall back to the steward when
// GraphQL is refused; fleet_graph and dashboard_feed go over their bindings with validated input (a non-2xx feed answers with an
// error naming status, path and reason: OPS-DASHBOARD-FEED-ERROR-BLIND-1); cf_docs builds only
// developers.cloudflare.com URLs and searches an llms.txt index. SCHEMA-INDEX-REFRESH-1 (node:sqlite): a stale plane is rebuilt
// from sqlite_master and pragma_table_info, a fresh one is left alone, an unreadable one keeps its rows, and the cron calls it.
// Run: node qnfo-ops/full-plane-access.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
const grab = (start, end) => { const i = src.indexOf(start), j = src.indexOf(end, i); return i >= 0 && j > i ? src.slice(i, j) : ""; };
const blk = grab("var FPA_REPO_RE", "// FULL-PLANE-ACCESS-1:END");
ok(blk.length > 3000, "the FULL-PLANE-ACCESS-1 block is found in worker.js");
const ghApi = grab("async function githubApi(env, method, path, body) {", "\n__name(githubApi");
const encP = grab("function encPath(s) {", "\n__name(encPath");
let calls = [];
let responder = () => new Response("{}", { status: 404 });
globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init: init || {} }); return responder(String(url), init || {}); };
const lib = new Function("VERSION", ghApi + "\n" + encP + "\n" + blk + "\nreturn { githubIssuesList, githubIssueGet, githubIssueComment, githubProjectsList, fleetGraphTool, dashboardFeed, cfDocsTool };")("2.50.0-test");
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json" } });

// Declared, dispatched, prompted.
for (const n of ["github_issues_list", "github_issue_get", "github_issue_comment", "github_projects_list", "fleet_graph", "dashboard_feed", "cf_docs"]) {
  ok(src.indexOf('{ name: "' + n + '", description') >= 0, "tool declared: " + n);
  ok(src.indexOf('else if (name === "' + n + '") res = await') >= 0, "tool dispatched: " + n);
}
ok(/2\. Tools:[^\n]*github_projects_list[^\n]*fleet_graph[^\n]*dashboard_feed[^\n]*cf_docs/.test(src), "operator prompt rule 2 names the new tools");
ok(/github_issue_comment: "completed"/.test(src), "the comment write is in the audit trail");
const pub = grab("var OPS_PUBLIC_TOOLS = OPS_TOOLS.filter", "}).concat([");
ok(!/github_issue|github_projects|fleet_graph|dashboard_feed|cf_docs/.test(pub), "public mode keeps its three tools (OPS-PUBLIC-READ-1)");
// a minimum, not an exact pin: the next patch release would break an exact one (CLAUDE.md, suites that pin a VERSION)
const _ver = (/var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(src) || []).slice(1).map(Number);
ok(_ver.length === 3 && (_ver[0] > 2 || (_ver[0] === 2 && (_ver[1] > 50 || (_ver[1] === 50 && _ver[2] >= 0)))), "VERSION is at least 2.50.0", _ver);
ok(!/model such as llama/i.test(src.split("\n").filter((l) => l.includes('name: "cf_docs"')).join("\n")), "the cf_docs description names no banned model (MODEL-FLOOR-REPAIR-1)");

(async () => {
  // Issues list: PRs dropped, labels flattened, query built.
  calls = [];
  responder = () => J([{ number: 7, title: "a", state: "open", labels: [{ name: "fleet-issue" }], user: { login: "u" }, assignees: [], comments: 2, html_url: "h7" }, { number: 8, title: "pr", pull_request: {}, labels: [] }]);
  let r = await lib.githubIssuesList({ GITHUB_TOKEN: "t" }, { state: "all", labels: "roadmap", limit: 2 });
  ok(r.ok && r.count === 1 && r.issues[0].labels[0] === "fleet-issue" && r.more === true, "issues list drops PRs and flattens labels", r);
  ok(/\/repos\/QNFO\/qnfo-workers\/issues\?state=all&per_page=2/.test(calls[0].url) && /labels=roadmap/.test(calls[0].url), "issues list query", calls[0].url);
  ok((await lib.githubIssuesList({}, { repo: "../etc" })).ok === false, "a bad repo is refused");
  // Issue get with comments.
  responder = (u) => /comments/.test(u) ? J([{ id: 1, user: { login: "x" }, body: "c".repeat(3000) }]) : J({ number: 9, title: "t", state: "open", labels: [], comments: 1, body: "b" });
  r = await lib.githubIssueGet({}, { number: 9 });
  ok(r.ok && r.body === "b" && r.comment_list.length === 1 && r.comment_list[0].body.length < 1600, "issue get returns body and capped comments", r);
  ok((await lib.githubIssueGet({}, { number: 0 })).ok === false, "issue get needs a number");
  // Comment needs the token and posts.
  ok((await lib.githubIssueComment({}, { number: 9, body: "x" })).ok === false, "comment refuses without GITHUB_TOKEN");
  calls = []; responder = () => J({ id: 5, html_url: "c5" }, 201);
  r = await lib.githubIssueComment({ GITHUB_TOKEN: "t" }, { number: 9, body: "done" });
  ok(r.ok && r.comment_id === 5 && calls[0].init.method === "POST" && /issues\/9\/comments$/.test(calls[0].url), "comment posts", r);
  // Projects: list, items with fields, fallback.
  responder = () => J({ data: { organization: { projectsV2: { totalCount: 1, nodes: [{ number: 7, title: "Roadmap", closed: false, items: { totalCount: 459 }, url: "p7" }] } } } });
  r = await lib.githubProjectsList({ GITHUB_TOKEN: "t" }, {});
  ok(r.ok && r.projects[0].number === 7 && r.projects[0].items === 459, "projects list", r);
  responder = () => J({ data: { organization: { projectV2: { number: 7, title: "Roadmap", url: "p7", items: { totalCount: 2, pageInfo: { hasNextPage: true, endCursor: "C1" }, nodes: [{ id: "I1", type: "ISSUE", fieldValues: { nodes: [{ name: "In progress", field: { name: "Status" } }, { date: "2026-10-19", field: { name: "Start" } }, {}] }, content: { number: 12, title: "x", state: "OPEN", url: "u", repository: { nameWithOwner: "QNFO/qnfo-workers" } } }] } } } } });
  r = await lib.githubProjectsList({ GITHUB_TOKEN: "t" }, { number: 7, limit: 1 });
  ok(r.ok && r.next === "C1" && r.items[0].fields.Status === "In progress" && r.items[0].fields.Start === "2026-10-19" && r.items[0].repo === "QNFO/qnfo-workers", "project items with field values", r);
  responder = () => J({ errors: [{ message: "Your token has not been granted the required scopes" }] });
  const steward = { fetch: async (u) => /portfolio/.test(u) ? J({ last_run: { board_items_added: 2 } }) : J({ programs: [] }) };
  r = await lib.githubProjectsList({ GITHUB_TOKEN: "t", CH_QNFO_GITHUB_STEWARD: steward }, { number: 7 });
  ok(r.ok && /GraphQL refused/.test(r.source) && r.portfolio.last_run.board_items_added === 2 && Array.isArray(r.roadmap.programs), "refused GraphQL falls back to the steward", r);
  r = await lib.githubProjectsList({ CH_QNFO_GITHUB_STEWARD: steward }, {});
  ok(r.ok && /GITHUB_TOKEN/.test(r.source), "no token falls back to the steward", r);
  // fleet_graph over MEMORY.
  let seen = "";
  const mem = { fetch: async (u) => { seen = u; return /bad/.test(u) ? J({ error: "ambiguous", candidates: ["a", "b"] }, 400) : J({ nodes: 3 }); } };
  r = await lib.fleetGraphTool({ MEMORY: mem }, { op: "impact", id: "d1t:qnfo-audit.agent_issues", depth: 2 });
  ok(r.ok && r.nodes === 3 && /\/fleet-graph\/impact\?id=d1t%3Aqnfo-audit.agent_issues&depth=2$/.test(seen), "fleet_graph impact over the binding", seen);
  r = await lib.fleetGraphTool({ MEMORY: mem }, { op: "find", query: "bad" });
  ok(!r.ok && r.candidates.length === 2, "fleet_graph passes refusals and candidates through", r);
  ok((await lib.fleetGraphTool({ MEMORY: mem }, { op: "find", query: "%".repeat(11) })).error === "Query pattern too complex", "fleet_graph rejects an over-wildcard query");
  ok((await lib.fleetGraphTool({ MEMORY: mem }, { op: "find", query: "a".repeat(101) })).error === "Query pattern too complex", "fleet_graph rejects a too-long query");
  ok((await lib.fleetGraphTool({ MEMORY: mem }, { op: "drop" })).ok === false, "fleet_graph refuses an unknown op");
  // dashboard_feed.
  const dash = { fetch: async (u) => { seen = u; return J({ endpoints: 23 }); } };
  r = await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: dash }, {});
  ok(r.ok && r.json.endpoints === 23 && seen === "https://fleet.qnfo.org/api", "dashboard_feed defaults to /api", r);
  r = await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: dash }, { path: "/api/area/cost" });
  ok(r.ok && seen === "https://fleet.qnfo.org/api/area/cost", "dashboard_feed reads an area");
  for (const bad of ["/owner", "/api/../owner", "https://evil.test/api", "/api/x?y=<z>"]) ok((await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: dash }, { path: bad })).ok === false, "dashboard_feed refuses " + bad);
  // OPS-DASHBOARD-FEED-ERROR-BLIND-1 (agent_issues 1000178): a non-2xx feed carries its reason in `error` (logToolEvent writes it to the audit row).
  const m405 = { fetch: async () => J({ error: "method_not_allowed", path: "/api/cmd", allow: ["POST"], hint: "Use POST /api/cmd to send a command; GET /api lists the read-only endpoints." }, 405) };
  r = await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: m405 }, { path: "/api/cmd" });
  ok(r.ok === false && r.status === 405 && r.path === "/api/cmd" && r.error === "HTTP 405 for /api/cmd: method_not_allowed", "dashboard_feed 405 names status, path and the endpoint's reason", r);
  ok(Array.isArray(r.allow) && r.allow[0] === "POST" && /Use POST \/api\/cmd/.test(r.hint) && r.json && r.json.error === "method_not_allowed", "dashboard_feed 405 keeps allow, the endpoint's hint and the body", r);
  // the default 405 hint is built from the endpoint's own allow list (body, else the Allow header) and says this tool is GET-only
  r = await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: { fetch: async () => J({ error: "method_not_allowed", allow: ["PUT"] }, 405) } }, { path: "/api/cmd" });
  ok(r.ok === false && (r.allow || []).join() === "PUT" && r.hint === "dashboard_feed is GET-only and this endpoint allows PUT; GET /api lists the read feeds" && !/POST/.test(r.hint), "a 405 without its own hint says the tool is GET-only and names the body's allow list", r);
  r = await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: { fetch: async () => new Response("nope", { status: 405, headers: { allow: "DELETE, PUT" } }) } }, { path: "/api/cmd" });
  ok(r.ok === false && (r.allow || []).join() === "DELETE,PUT" && r.hint === "dashboard_feed is GET-only and this endpoint allows DELETE,PUT; GET /api lists the read feeds" && !/POST/.test(r.hint) && r.error === "HTTP 405 for /api/cmd: nope", "a plain-text 405 takes the allow list from the Allow header", r);
  r = await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: { fetch: async () => J({ error: "m", allow: "PUT, DELETE" }, 405) } }, { path: "/api/cmd" });
  ok((r.allow || []).join() === "PUT,DELETE", "a string allow in the body is split into a list", r);
  r = await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: { fetch: async () => J({ error: "method" }, 405) } }, { path: "/api/cmd" });
  ok(r.ok === false && r.error === "HTTP 405 for /api/cmd: method" && r.allow === undefined && r.hint === "dashboard_feed is GET-only and this endpoint allows another method; GET /api lists the read feeds", "a 405 that names no allow list still says the tool is GET-only", r);
  r = await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: { fetch: async () => J({ error: "E", message: "M" }, 400) } }, { path: "/api/x" });
  ok(r.ok === false && r.error === "HTTP 400 for /api/x: E", "error wins over message when the body has both", r);
  r = await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: { fetch: async () => J({ error: "x".repeat(5000) }, 500) } }, { path: "/api/x" });
  ok(r.ok === false && String(r.error).length < 260 && String(r.error).indexOf("HTTP 500 for /api/x: xxxx") === 0, "a 5000-character JSON reason is capped in the error", r.error && r.error.length);
  r = await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: { fetch: async () => J({ message: "no such feed" }, 404) } }, { path: "/api/nope" });
  ok(r.ok === false && r.error === "HTTP 404 for /api/nope: no such feed" && r.hint === undefined, "a JSON refusal with only a message uses it", r);
  r = await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: { fetch: async () => J({ error: { code: 7 } }, 500) } }, { path: "/api/x" });
  ok(r.ok === false && r.error === 'HTTP 500 for /api/x: {"code":7}', "an object-valued error is serialised, not [object Object]", r);
  r = await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: { fetch: async () => new Response("upstream exploded ".repeat(40), { status: 502 }) } }, { path: "/api/live" });
  ok(r.ok === false && r.status === 502 && /^HTTP 502 for \/api\/live: upstream exploded/.test(r.error) && r.error.length < 330 && /upstream exploded/.test(r.text) && r.json === undefined, "a non-JSON failure falls back to the capped body text", r);
  r = await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: { fetch: async () => new Response("", { status: 503 }) } }, { path: "/api/live" });
  ok(r.ok === false && r.error === "HTTP 503 for /api/live", "an empty failure body still yields a non-empty error", r);
  r = await lib.dashboardFeed({ CH_QNFO_FLEET_DASHBOARD: dash }, { path: "/api/kpi" });
  ok(r.ok === true && r.status === 200 && r.json.endpoints === 23 && !("error" in r) && !("hint" in r), "the 2xx shape is unchanged (no error key)", r);
  // cf_docs.
  calls = [];
  responder = (u) => /llms\.txt$/.test(u) ? new Response("# Workers\n- [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)\n- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)\n") : /service-bindings\/index\.md$/.test(u) ? new Response("# Service bindings\nbody") : new Response("nf", { status: 404 });
  r = await lib.cfDocsTool({}, { mode: "search", product: "workers", query: "cron triggers" });
  ok(r.ok && r.results.length === 1 && /Cron Triggers/.test(r.results[0]) && calls[0].url === "https://developers.cloudflare.com/workers/llms.txt", "cf_docs search over a product index", r);
  r = await lib.cfDocsTool({}, { path: "https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/" });
  ok(r.ok && /^# Service bindings/.test(r.markdown) && /service-bindings\/index\.md$/.test(calls[calls.length - 1].url), "cf_docs page from a full URL", r);
  r = await lib.cfDocsTool({}, { mode: "models", model: "llama-3.3-70b-instruct-fp8-fast" });
  ok(/workers-ai\/models\/llama-3\.3-70b-instruct-fp8-fast\/index\.md$/.test(calls[calls.length - 1].url) && r.ok === false, "cf_docs models builds the catalog path and reports a miss", r);
  for (const bad of ["../../etc", "Workers", "x".repeat(300)]) ok((await lib.cfDocsTool({}, { mode: "page", path: bad })).ok === false, "cf_docs refuses path " + bad.slice(0, 20));
  ok(calls.every((c) => c.url.indexOf("https://developers.cloudflare.com/") === 0), "cf_docs only fetches developers.cloudflare.com");
  // SCHEMA-INDEX-REFRESH-1 against real SQLite.
  const si = grab("var SCHEMA_INDEX_MAX_AGE_MIN", "// FULL-PLANE-ACCESS-1 (2.50.0");
  ok(si.length > 1000, "the schema index block is found");
  ok(/await schemaIndexRefresh\(env, false\)/.test(grab("async scheduled(controller, env, ctx) {", "CRON-ONLY-HEARTBEAT-1 (agent_issues 2397, pillar autonomy): each half-hourly")), "the cron runs the schema index refresh");
  const mkdb = () => { const d = new DatabaseSync(":memory:"); const prep = (sql) => { let a = []; const q = { bind(...x) { a = x; return q; }, async all() { return { results: d.prepare(sql).all(...a) }; }, async run() { d.prepare(sql).run(...a); return { success: true }; }, _run() { d.prepare(sql).run(...a); } }; return q; }; return { d, b: { prepare: prep, async batch(l) { d.exec("BEGIN"); try { for (const x of l) x._run(); d.exec("COMMIT"); } catch (e) { d.exec("ROLLBACK"); throw e; } return []; } } }; };
  const A = mkdb(), G = mkdb(), L = mkdb();
  A.d.exec("CREATE TABLE d1_schema_index (db TEXT, tbl TEXT, ord INTEGER, col TEXT, coltype TEXT, required INTEGER, pk INTEGER, cols TEXT, refreshed_at TEXT); CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT); CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, predicate_id TEXT)");
  A.d.exec("INSERT INTO d1_schema_index (db, tbl, col, cols, refreshed_at) VALUES ('audit', 'agent_issues', 'id,title', 'id,title', '2026-09-30 14:18:24'), ('graph', 'old', 'a', 'a', '2999-01-01 00:00:00'), ('living', 'papers', 'id', 'id', '2026-09-30 14:18:24')");
  for (let i = 0; i < 120; i++) G.d.exec("CREATE TABLE t" + i + " (a, b)");
  const dbmap = { audit: "QNFO_AUDIT", graph: "QNFO_GRAPH", living: "LIVING_PAPER" };
  const sim = new Function("DB_MAP", "function __name(f){return f}\n" + si + "\nreturn { schemaIndexRefresh, schemaIndexRows };")(dbmap);
  const brokenLiving = { prepare: () => ({ async all() { throw new Error("D1_ERROR: boom"); } }) };
  let res = await sim.schemaIndexRefresh({ QNFO_AUDIT: A.b, QNFO_GRAPH: G.b, LIVING_PAPER: brokenLiving }, false);
  const rows = (db) => A.d.prepare("SELECT tbl, cols FROM d1_schema_index WHERE db = ? ORDER BY tbl").all(db);
  ok(res.rebuilt.audit === 3 && !res.rebuilt.graph && /boom/.test(res.failed.living), "stale audit rebuilt, fresh graph skipped, unreadable living reported", res);
  ok(rows("audit").find((r) => r.tbl === "agent_issues").cols === "id,title,predicate_id", "the rebuilt row carries the live column list");
  ok(rows("living").length === 1 && rows("graph")[0].tbl === "old", "a skipped or failed plane keeps its rows");
  ok(A.d.prepare("SELECT status FROM cloud_ops_events WHERE kind = 'schema-index-refresh'").get().status === "err", "the run is recorded, err when a plane failed");
  res = await sim.schemaIndexRefresh({ QNFO_AUDIT: A.b, QNFO_GRAPH: G.b, LIVING_PAPER: brokenLiving }, true);
  ok(res.rebuilt.graph === 120 && rows("graph").length === 120 && rows("graph")[0].cols === "a,b", "force rebuilds a plane of 120 tables over several 49-row inserts", res.rebuilt);
  ok(!rows("audit").some((r) => /^_cf_/.test(r.tbl)), "_cf_ tables are never indexed");
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
