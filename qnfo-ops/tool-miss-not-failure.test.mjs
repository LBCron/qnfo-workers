// TOOL-MISS-NOT-FAILURE-1 offline suite (qnfo-ops, 2026-10-26, charter pillar autonomy; agent_issues 1000393, 1000394, 100437, 1000443). No network: fetch is a stub.
// An existence lookup that misses is an answer, not a tool malfunction. The tool still returns ok:false with the same error text and hint, but carries not_found:true, and logToolEvent records a
// not_found result as status ok (meta keeps resultOk false and the error text, so nothing is hidden and the calibration join on meta.resultOk is unchanged); every other failure stays status error, a
// refusal stays rejected. Covered here: github_repo_read on a missing path (1000393, 1000394), github_issue_get on a missing number (100437: GitHub 404 for the D1 issue id 100350), web_search called with
// query instead of q (1000443: "q required" for {"query": ...}), and the self-fetch refusal of web_fetch (1000115) recorded as rejected, a correct refusal, not an error.
// ISSUE-TOOL-REPO-ARGS-1 (2.59.5, agent_issues 100437): github_issue_get still failed at 17:48Z and 19:42Z with "repo (owner/name) and number required" because the model sends {owner, repo, number}; the three issue tools
// (github_issue_get, github_issues_list, github_issue_comment) now resolve the repo with fpaRepoArg, which keeps every shape that worked before.
// Run: node qnfo-ops/tool-miss-not-failure.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
const grab = (start, end) => { const i = src.indexOf(start), j = src.indexOf(end, i); return i >= 0 && j > i ? src.slice(i, j) : ""; };
const parts = [
  grab("async function githubApi(env, method, path, body) {", "\n__name(githubApi"),
  grab("function encPath(s) {", "\n__name(encPath"),
  grab("var FPA_REPO_RE =", "\n"),
  grab("var FPA_GH_ERR = function(res) {", "};\n") + "};\n",
  grab("function fpaRepoArg(args) {", "\nfunction fpaCap"),
  grab("function fpaCap(s, n) {", "\nfunction fpaIssueRow"),
  grab("function fpaIssueRow(i) {", "\nasync function githubIssuesList"),
  grab("async function githubIssuesList(env, args) {", "\nasync function githubIssueGet"),
  grab("async function githubRepoRead(env, args) {", "\n__name(githubRepoRead"),
  grab("async function githubIssueGet(env, args) {", "\nasync function githubIssueComment"),
  grab("async function githubIssueComment(env, args) {", "\nvar FPA_FIELD"),
  grab("function b64Utf8(b64) {", "\n// ---- UTF8-DEPLOY-1:END"),
  grab("var WS_UA =", "\n__name(webSearchTool"),
];
ok(parts.every((p) => p.length > 30), "githubApi, encPath, FPA_REPO_RE, FPA_GH_ERR, fpaRepoArg, fpaCap, fpaIssueRow, githubIssuesList, githubRepoRead, githubIssueGet, githubIssueComment and webSearchTool are found in worker.js", parts.map((p) => p.length));
const logSrc = grab("function opsFitArgs(args, budget) {", "\n__name(logToolEvent");
ok(logSrc.length > 100, "logToolEvent is found in worker.js");

const decodeBase64 = (b) => Buffer.from(b, "base64").toString("utf8");
const stripHtml = (s) => String(s || "").replace(/<[^>]+>/g, "").trim();
let calls = [];
let responder = () => new Response("{}", { status: 404 });
globalThis.fetch = async (url, init) => { calls.push(String(url)); return responder(String(url), init || {}); };
const tools = new Function("decodeBase64", "stripHtml", parts.join("\n") + "\nreturn { githubRepoRead, githubIssueGet, githubIssuesList, githubIssueComment, webSearchTool, fpaRepoArg };")(decodeBase64, stripHtml);
const env = { GITHUB_TOKEN: "t" };
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json" } });

// ---- github_repo_read (1000393)
responder = () => J({ message: "Not Found" }, 404);
let r = await tools.githubRepoRead(env, { repo: "QNFO/qnfo-workers", path: "mind/worker.js" });
ok(r.ok === false && r.not_found === true && /^path not found: mind\/worker\.js/.test(r.error), "a path that does not exist answers ok:false with not_found:true and the same error text", r);
ok(/parent dir 'mind' also not found/.test(r.error), "the hint that names the parent is kept", r.error);
responder = (u) => /contents\/mind\?/.test(u) || /contents\/mind$/.test(u) ? J([{ name: "worker.js.bak" }, { name: "wrangler.toml" }], 200) : J({ message: "Not Found" }, 404);
r = await tools.githubRepoRead(env, { repo: "QNFO/qnfo-workers", path: "mind/worker.js" });
ok(r.ok === false && r.not_found === true && /dir 'mind' contains: worker\.js\.bak, wrangler\.toml/.test(r.error) && /nearest match: worker\.js\.bak/.test(r.error), "the directory listing and the nearest match stay in the answer", r.error);
responder = () => J({ message: "Server Error" }, 500);
r = await tools.githubRepoRead(env, { repo: "QNFO/qnfo-workers", path: "a.md" });
ok(r.ok === false && !r.not_found && /GitHub 500/.test(r.error), "a GitHub 500 is a failure, not a miss", r);
responder = () => J({ message: "Bad credentials" }, 401);
r = await tools.githubRepoRead(env, { repo: "QNFO/qnfo-workers", path: "a.md" });
ok(r.ok === false && !r.not_found, "a 401 is a failure, not a miss", r);

// ---- github_issue_get (100437)
responder = () => J({ message: "Not Found" }, 404);
r = await tools.githubIssueGet(env, { number: 100350 });
ok(r.ok === false && r.not_found === true && r.error === "GitHub 404: Not Found", "a GitHub issue number that does not exist answers not_found:true with the same error text", r);
responder = () => J({ message: "Forbidden" }, 403);
r = await tools.githubIssueGet(env, { number: 7 });
ok(r.ok === false && !r.not_found && /GitHub 403/.test(r.error), "a 403 is a failure, not a miss", r);
responder = () => J({ number: 7, title: "t", state: "open", body: "b", comments: 0, user: { login: "u" }, html_url: "x" }, 200);
r = await tools.githubIssueGet(env, { number: 7, comments: false });
ok(r.ok === true && r.number === 7 && !r.not_found, "a found issue is unchanged", r);
r = await tools.githubIssueGet(env, { number: 0 });
ok(r.ok === false && !r.not_found && /number required/.test(r.error), "a missing number stays an argument error", r);

// ---- the issue tools take {owner, repo, number} (100437, ISSUE-TOOL-REPO-ARGS-1, 2.59.5: github_issue_get failed at 17:48Z and 19:42Z with this shape)
ok(tools.fpaRepoArg({ owner: "QNFO", repo: "qnfo-workers" }) === "QNFO/qnfo-workers" && tools.fpaRepoArg({ repo: "QNFO/qnfo-workers" }) === "QNFO/qnfo-workers" && tools.fpaRepoArg({}) === "QNFO/qnfo-workers" && tools.fpaRepoArg(undefined) === "QNFO/qnfo-workers", "fpaRepoArg: owner plus bare repo joins, owner/name is kept, nothing at all is QNFO/qnfo-workers");
ok(tools.fpaRepoArg({ owner: "QNFO" }) === "QNFO/qnfo-workers" && tools.fpaRepoArg({ repo: "qnfo-workers" }) === "QNFO/qnfo-workers" && tools.fpaRepoArg({ owner: "Cloudflare", repo: "workers-sdk" }) === "Cloudflare/workers-sdk" && tools.fpaRepoArg({ owner: "x", repo: "a/b" }) === "a/b", "fpaRepoArg: an owner alone keeps the default (as before), a bare name is QNFO/name, another owner is honoured, an owner/name repo wins over owner");
const okIssue = () => J({ number: 580, title: "t", state: "open", body: "b", comments: 0, user: { login: "u" }, html_url: "x" }, 200);
responder = okIssue; calls = [];
r = await tools.githubIssueGet(env, { owner: "QNFO", repo: "qnfo-workers", number: 580 });
ok(r.ok === true && r.number === 580 && r.repo === "QNFO/qnfo-workers" && calls.length === 1 && /\/repos\/QNFO\/qnfo-workers\/issues\/580$/.test(calls[0]), "github_issue_get with {owner, repo, number} (the call that failed at 19:42Z) reads QNFO/qnfo-workers issue 580", { r, calls });
calls = [];
r = await tools.githubIssueGet(env, { repo: "QNFO/qnfo-workers", number: 552 });
ok(r.ok === true && /\/repos\/QNFO\/qnfo-workers\/issues\/552$/.test(calls[0]), "the owner/name shape that worked before still works", calls);
calls = [];
r = await tools.githubIssueGet(env, { number: 552 });
ok(r.ok === true && /\/repos\/QNFO\/qnfo-workers\/issues\/552$/.test(calls[0]), "no repo at all still defaults to QNFO/qnfo-workers", calls);
calls = [];
r = await tools.githubIssueGet(env, { owner: "Cloudflare", repo: "workers-sdk", number: 1 });
ok(r.ok === true && r.repo === "Cloudflare/workers-sdk" && /\/repos\/Cloudflare\/workers-sdk\/issues\/1$/.test(calls[0]), "another owner is honoured, not replaced by QNFO", { r, calls });
calls = [];
r = await tools.githubIssueGet(env, { owner: "x y", repo: "bad repo!", number: 5 });
ok(r.ok === false && /repo \(owner\/name\) and number required/.test(r.error) && calls.length === 0, "a repo that is not owner/name after joining stays an argument error and makes no request", { r, calls });
r = await tools.githubIssueGet(env, { owner: "QNFO", repo: "qnfo-workers", number: 0 });
ok(r.ok === false && /number required/.test(r.error) && calls.length === 0, "owner and repo with no number stays an argument error", r);
responder = () => J([{ number: 1, title: "t", state: "open", user: { login: "u" } }], 200); calls = [];
r = await tools.githubIssuesList(env, { owner: "QNFO", repo: "qnfo-workers", limit: 5 });
ok(r.ok === true && r.repo === "QNFO/qnfo-workers" && /\/repos\/QNFO\/qnfo-workers\/issues\?/.test(calls[0]), "github_issues_list takes {owner, repo} too", { r, calls });
responder = () => J({ id: 9, html_url: "u" }, 201); calls = [];
r = await tools.githubIssueComment(env, { owner: "QNFO", repo: "qnfo-workers", number: 580, body: "hello" });
ok(r.ok === true && r.repo === "QNFO/qnfo-workers" && /\/repos\/QNFO\/qnfo-workers\/issues\/580\/comments$/.test(calls[0]), "github_issue_comment takes {owner, repo, number} too", { r, calls });
r = await tools.githubIssueComment(env, { owner: "QNFO", repo: "qnfo-workers", number: 580 });
ok(r.ok === false && /body required/.test(r.error), "a comment with no body is still an argument error", r);
ok([...src.matchAll(/const repo = fpaRepoArg\(args\);/g)].length === 3, "exactly the three issue tools resolve the repo with fpaRepoArg", [...src.matchAll(/const repo = fpaRepoArg\(args\);/g)].length);

// ---- web_search (1000443; bounded lite fallback 1000810)
const litePage = (n) => new Response('<html><body><a href="/lite/?q=x">nav</a>' + Array.from({ length: n }, (_, i) => (i % 2 ? "<a class='result-link' href='/lite/?uddg=https%3A%2F%2Fexample.com%2F" + i + "'>" : '<a href="https://lite.duckduckgo.com/lite/?uddg=https%3A%2F%2Fexample.com%2F' + i + '" class="result-link">') + "Example " + i + "</a>").join("") + "</body></html>", { status: 200 });
const isLite = (u) => /lite\.duckduckgo\.com\/lite\//.test(u);
responder = (u) => isLite(u) ? litePage(2) : new Response("<html></html>", { status: 200 });
calls = [];
r = await tools.webSearchTool(env, { query: "roster_capabilities_single_executor qnfo-workers" });
ok(r.ok === true && r.path === "fallback" && calls.length === 2 && calls[0].endsWith(encodeURIComponent("roster_capabilities_single_executor qnfo-workers")) && calls[1].endsWith("lite/?q=" + encodeURIComponent("roster_capabilities_single_executor qnfo-workers")), "web_search accepts query as an alias of q and falls back to lite.duckduckgo.com on an empty primary", { r, calls });
ok(r.ok === true && r.results.length === 2 && r.results[0].url === "https://example.com/0" && r.results[0].title === "Example 0" && r.results[0].snippet === "" && r.results.every((x) => /example\.com/.test(x.url)), "the fallback parses result-link anchors in either attribute order and either quote style, decodes uddg, never returns nav links, and uses an empty snippet", r);
calls = [];
r = await tools.webSearchTool(env, { q: "x" });
ok(r.ok === true && r.path === "fallback" && calls[0].endsWith("?q=x") && calls[1].endsWith("lite/?q=x"), "q still works", { r, calls });
r = await tools.webSearchTool(env, { q: "first", query: "second" });
ok(calls[calls.length - 1].endsWith("lite/?q=first"), "q wins when both are given");
calls = [];
r = await tools.webSearchTool(env, {});
ok(r.ok === false && r.error === "q required" && calls.length === 0, "no q and no query keeps the error and makes no request", r);
r = await tools.webSearchTool(env, { query: "   " });
ok(r.ok === false && r.error === "q required", "a blank query is still an error", r);
responder = () => new Response("<html></html>", { status: 200 });
calls = [];
r = await tools.webSearchTool(env, { q: "both-empty" });
ok(r.ok === false && r.search_unavailable === true && r.path === "all-failed" && /0 results parsed/.test(r.error) && calls.length === 3 && r.paths_tried.length === 3, "every parser empty is an explicit fail-closed error naming all three paths (OPS-WEBSEARCH-PATHS-1), never a successful empty result", { r, calls });
responder = (u) => isLite(u) ? new Response("nope", { status: 503 }) : new Response("<html></html>", { status: 200 });
r = await tools.webSearchTool(env, { q: "y" });
ok(r.ok === false && r.search_unavailable === true && /ddg-lite: HTTP 503/.test(r.error) && r.paths_tried[1].status === 503, "a failed lite fetch no longer ends the call (Bing is tried next) and its HTTP 503 stays in paths_tried and in the final error", r);
responder = (u) => isLite(u) ? litePage(20) : new Response("<html></html>", { status: 200 });
r = await tools.webSearchTool(env, { q: "z" });
ok(r.ok === true && r.results.length === 5, "the fallback is bounded by k", r);
responder = () => new Response('<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2F">T</a><a class="result__snippet" href="x">S</a>', { status: 200 });
calls = [];
r = await tools.webSearchTool(env, { q: "p" });
ok(r.ok === true && r.path === "primary" && calls.length === 1 && r.results.length === 1 && r.results[0].url === "https://a.example/", "a primary hit is unchanged and reports path primary with no fallback call", { r, calls });

// ---- logToolEvent (1000394)
const rows = [];
const envLog = { QNFO_AUDIT: { prepare() { let b = []; const s = { bind(...x) { b = x; return s; }, async run() { rows.push(b); return {}; } }; return s; } } };
const logToolEvent = new Function("randId", "iso", "redactedSnippet", "logAuditTrail", logSrc + "\nreturn logToolEvent;")(() => "evt-x", () => "2026-10-26T00:00:00Z", (o) => JSON.stringify(o), async () => {});
const statusOf = async (res) => { rows.length = 0; await logToolEvent(envLog, "github_repo_read", { path: "p" }, res, 12); return { status: rows[0][6], meta: JSON.parse(rows[0][4]), kind: rows[0][2], text: rows[0][3] }; };
let s = await statusOf({ ok: false, not_found: true, error: "path not found: mind/worker.js - dir 'mind' contains: x" });
ok(s.status === "ok" && s.meta.resultOk === false && /^path not found: mind\/worker\.js/.test(s.meta.error), "a not_found result is logged status ok, with resultOk false and the error text kept", s);
s = await statusOf({ ok: true, content: "x" });
ok(s.status === "ok" && s.meta.resultOk === true && s.meta.error === undefined, "a normal success is unchanged", s);
s = await statusOf({ ok: false, error: "GitHub 500: x" });
ok(s.status === "error" && s.meta.resultOk === false && /GitHub 500/.test(s.meta.error), "any other failure is still status error", s);
s = await statusOf({ ok: false, rejected: true, error: "read-only SELECT/WITH only" });
ok(s.status === "rejected", "a refusal is still status rejected", s);
s = await statusOf({ ok: false, not_found: true, rejected: true, error: "x" });
ok(s.status === "ok", "not_found wins over rejected (a miss is an answer)", s);
s = await statusOf(undefined);
ok(s.status === "error", "no result at all is an error", s);
ok(s.kind === "ops_ai_tool" && s.text === "github_repo_read", "the event keeps its kind and tool name", s);

// ---- web_fetch self-fetch refusal (1000115): a correct refusal is rejected, not an error
const sf = grab("    return {\n      ok: false,\n      rejected: true,\n      error: \"self-fetch blocked: \"", "hint:");
ok(sf.length > 0 && /self_fetch: true/.test(sf), "the self-fetch refusal of web_fetch carries rejected:true next to self_fetch:true");
ok(!/ok: false,\n      error: "self-fetch blocked/.test(src), "no self-fetch refusal is left without it");
// the flag is produced by the two lookup tools only (an existence lookup) and read by exactly two functions that both file a miss as ok:
// logToolEvent, and opsRunEventAppend (OPS-RM-SLICES-1, 2.63.0), which writes the same classification into ops_run_events
const nf = [...src.matchAll(/\{ ok: false, not_found: true/g)].length;
ok(nf === 2, "exactly two results carry the not_found flag: the repo path miss and the issue miss", nf);
const nfReads = [...src.matchAll(/\.not_found\b/g)].map((m) => m.index);
const fnEnd = (name) => { const s = src.indexOf("async function " + name + "("); return s < 0 ? -1 : src.indexOf("\n}\n", s); };
const fnStart = (name) => src.indexOf("async function " + name + "(");
const readsIn = (name) => nfReads.filter((i) => i > fnStart(name) && i < fnEnd(name)).length;
ok(nfReads.length === 2 && readsIn("logToolEvent") === 1 && readsIn("opsRunEventAppend") === 1, "and only logToolEvent and opsRunEventAppend read it, once each", { total: nfReads.length, log: readsIn("logToolEvent"), run: readsIn("opsRunEventAppend") });
ok(/const ok = !!\(execRes && execRes\.ok\) \|\| !!\(parsed && parsed\.not_found\);/.test(src), "opsRunEventAppend counts a lookup miss as ok, the same classification as logToolEvent");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
