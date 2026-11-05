// RM-CMD-FAILURES-1 (qnfo-fleet-dashboard 1.92.0): where the /cmd command line failed, by stage, and the two stage defects the inventory found.
//  1. cmdFailureStage names the stage of every kind of failed or fallback cmd_log row seen in production (24 rows, 2026-10-06 .. 2026-11-04).
//  2. GET /api/cmd/failures answers the counts by stage (no prompt text).
//  3. A CodeSession stream turn (kind agent-stream) used to be swept as "abandoned: the worker stopped before answering" three minutes after it started although
//     qnfo-agents had finished it; its row now links to its session and is settled from the session by the sweep, by the job poll and when the stream ends.
//  4. A refused hand-off (CodeSession start, ops-exec start) is logged as a stage row instead of only a console line.
//  5. The page renders the stream answer (it rendered an empty card for kind "stream") and names the real cause of a refused microphone.
// Run: node qnfo-fleet-dashboard/cmd-stream.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import worker from "./worker.js";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

// ---- 1. the classifier, from the pure functions of the worker source
const code = src.slice(src.indexOf("var CMD_STAGES"), src.indexOf("// RM-CMD-FAILURES-1: a hand-off that was refused")) + "\nthis.cmdFailureStage = cmdFailureStage; this.cmdFailureSummary = cmdFailureSummary; this.CMD_STAGES = CMD_STAGES;";
const ctx = { String, Number, Object, Math };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const st = ctx.cmdFailureStage;
// every error text that appears among the 24 failed/fallback rows of qnfo-audit.cmd_log on 2026-11-04 (kind, status, error)
const seen = [
  ["ai", "fallback", "glm-5.3-flash: timeout 13s", "model"],
  ["ai", "fallback", "retried: deepseek-v4-flash: timeout 40s | glm-5.3-flash: timeout 35s | llama-3.3-70b-instruct-fp8-fast: timeout 30s", "model"],
  ["ai", "fallback", "glm-5.3-flash: http 401 | deepseek-v4-flash-wa: http 401 | gpt-oss-120b: http 401", "model"],
  ["ai", "fallback", "gpt-oss-120b: router_timeout 15s | deepseek-v4-flash-wa: router_timeout 19s | glm-5.3-flash: router_timeout 23s", "model"],
  ["agent", "failed", "abandoned: the agent run did not finish in 30 minutes", "ops-exec"],
  ["agent", "failed", "agent run lost: http 404", "ops-exec"],
  ["agent-stream", "failed", "abandoned: the worker stopped before answering", "stream"],
  ["agent-stream", "failed", "stream: the code session turn failed", "stream"],
  ["ai", "failed", "abandoned: the worker stopped before answering", "worker-stopped"],
  ["handoff", "fallback", "hand-off: code-session start: http 0 qnfo-agents: timeout", "hand-off"],
  ["ai", "failed", "Cannot read properties of undefined", "other"],
  ["tool", "failed", "", "other"]
];
for (const [k, s, e, want] of seen) ok(st(k, s, e) === want, "stage of " + k + "/" + s + " '" + e.slice(0, 40) + "' is " + want, st(k, s, e));
ok(ctx.CMD_STAGES.indexOf("stream") >= 0 && ctx.CMD_STAGES.indexOf("hand-off") >= 0, "the stage list names the hand-off and stream stages");
const sum = ctx.cmdFailureSummary([
  { kind: "ai", status: "fallback", err: "glm-5.3-flash: timeout 13s", n: 7, o: 3, last_ts: "2026-10-06 10:00:00" },
  { kind: "ai", status: "fallback", err: "gpt-oss-120b: router_timeout 15s", n: 14, o: 9, last_ts: "2026-10-25 16:47:06" },
  { kind: "agent-stream", status: "failed", err: "abandoned: the worker stopped before answering", n: 2, o: 2, last_ts: "2026-11-04 10:20:54" },
  { kind: "agent", status: "failed", err: "abandoned: the agent run did not finish in 30 minutes", n: 1, o: 1, last_ts: "2026-10-30 09:20:47" }
], 400);
ok(sum.failed === 24 && sum.turns === 400 && sum.rate === 0.06, "24 failures of 400 turns is a 6 percent rate", sum);
ok(sum.by_stage[0].stage === "model" && sum.by_stage[0].n === 21 && sum.by_stage[0].owner_n === 12, "the model stage leads with 21 rows, 12 of them the owner's", sum.by_stage);
ok(sum.by_stage.map((x) => x.stage).join() === "model,stream,ops-exec", "stages are ordered by count", sum.by_stage.map((x) => x.stage));
ok(sum.by_stage.find((x) => x.stage === "model").sample === "gpt-oss-120b: router_timeout 15s", "the sample is the error class of the newest row of the stage");

// ---- 2..4. the real worker on an in-memory D1
function d1(db) {
  return {
    prepare(sql) {
      let stmt = null, err = null; try { stmt = db.prepare(sql); } catch (e) { err = e; }
      let args = [];
      const api = {
        bind(...a) { args = a.map((x) => (x === undefined ? null : x)); return api; },
        async run() { if (err) throw err; const r = stmt.run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
        async all() { if (err) throw err; return { results: stmt.all(...args) }; },
        async first() { if (err) throw err; return stmt.get(...args) ?? null; }
      };
      return api;
    }
  };
}
const raw = new DatabaseSync(":memory:");
const LOOP = "test-loop-token";
let sessionReply = { ok: true, session_id: "run_abcdef123456", turn: 1, status: "queued" }; // POST /code-sessions
let sessionState = { ok: true, session: { id: "run_abcdef123456", status: "running", turns: [{ turn: 1, status: "running" }] } }; // GET /code-sessions/<id>
const agentsCalls = [];
let opsStart = { ok: true };
const env = {
  AUDIT: d1(raw), LOOP_TOKEN: LOOP, AI: {},
  SVC_QNFO_AGENTS: { async fetch(u, init) {
    agentsCalls.push((init && init.method || "GET") + " " + u.replace("https://agents.qnfo.org", ""));
    const method = init && init.method || "GET";
    if (/\/events\?/.test(u)) return new Response("id: 1\nevent: complete\ndata: {\"turn\":1,\"answer\":\"done\"}\n\n", { status: 200 });
    if (method === "POST") return new Response(JSON.stringify(sessionReply), { status: sessionReply.ok ? 202 : 409 });
    return new Response(JSON.stringify(sessionState), { status: 200 });
  } },
  SVC_QNFO_OPS: { async fetch(u, init) {
    const b = init && init.body ? JSON.parse(init.body) : {};
    if (b.op === "start") return new Response(JSON.stringify(opsStart), { status: opsStart.ok ? 200 : 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } }
};
const waits = [];
const wctx = { waitUntil(p) { waits.push(p); }, passThroughOnException() {} };
const call = (method, path, body) => worker.fetch(new Request("https://fleet.qnfo.org" + path, { method, headers: { "x-loop-token": LOOP, "x-fleet-ui": "1", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, wctx);
const rows = (sql) => raw.prepare(sql).all();

// a stream turn: the row links to its session and the id goes to the client
let r = await call("POST", "/api/cmd", { text: "please refactor the widget module in a branch" });
let j = await r.json();
ok(r.status === 202 && j.kind === "stream" && j.session_id === "run_abcdef123456" && /^cmd-[0-9a-f]{20}$/.test(j.id), "a plain-English owner turn starts a stream and answers its cmd_log id", j);
let row = rows("SELECT * FROM cmd_log WHERE id = '" + j.id + "'")[0];
ok(row && row.kind === "agent-stream" && row.status === "running" && row.answer === "session:run_abcdef123456 turn:1", "the running row links to its session", row);
const streamId = j.id;

// while the turn runs the poll says running and the sweep leaves it alone, even after the 3-minute stale mark
raw.prepare("UPDATE cmd_log SET ts = datetime('now', '-10 minutes') WHERE id = ?").run(streamId);
r = await call("GET", "/api/cmd/job/" + streamId);
j = await r.json();
ok(j.status === "running" && j.agent === true, "a running code session turn polls as running (not abandoned)", j);
ok(rows("SELECT status FROM cmd_log WHERE id = '" + streamId + "'")[0].status === "running", "the 3-minute sweep no longer marks a stream turn abandoned");

// the session finishes: the next poll settles the row with the turn's answer and model
sessionState = { ok: true, session: { id: "run_abcdef123456", status: "done", turns: [{ turn: 1, status: "done", answer: "Refactor planned in 3 steps.", model: "deepseek-v4-flash-wa", finished_ms: 1790000000000 }] } };
r = await call("GET", "/api/cmd/job/" + streamId);
j = await r.json();
ok(j.status === "answered" && j.answer === "Refactor planned in 3 steps." && j.model === "deepseek-v4-flash-wa", "a finished code session turn is settled as answered with its answer", j);
row = rows("SELECT * FROM cmd_log WHERE id = '" + streamId + "'")[0];
ok(row.status === "answered" && row.done_ms === 1790000000000 && row.error === null, "the row is stored settled", row);

// a failed turn settles as a stream-stage failure with the session's own error
sessionReply = { ok: true, session_id: "run_zzzzzz999999", turn: 2, status: "queued" };
sessionState = { ok: true, session: { id: "run_zzzzzz999999", status: "failed", turns: [{ turn: 2, status: "failed", error: "session turn was evicted twice", finished_ms: 5 }] } };
r = await call("POST", "/api/cmd", { text: "please summarise the open pull requests", session_id: "run_zzzzzz999999" });
j = await r.json();
ok(agentsCalls.some((c) => c === "POST /code-sessions/run_zzzzzz999999/turns"), "a follow-up turn is posted to the same session", agentsCalls);
const failId = j.id;
const sw = await call("GET", "/api/cmd/job/" + failId);
const swj = await sw.json();
ok(swj.ok === false && swj.status === "failed", "a failed turn polls as failed", swj);
ok(/the code session did not finish \(session turn was evicted twice\)/.test(swj.error), "the failure text names the code session, not the AI model leg", swj);
row = rows("SELECT status, error FROM cmd_log WHERE id = '" + failId + "'")[0];
ok(row.status === "failed" && /^stream: session turn was evicted twice/.test(row.error) && st("agent-stream", row.status, row.error) === "stream", "the failure is stored with the session's error and the stream stage", row);

// the sweep (the scheduled path) settles a row nobody polls, and abandons one whose session is gone
sessionReply = { ok: true, session_id: "run_gone00000001", turn: 1, status: "queued" };
sessionState = { ok: true, session: { id: "run_gone00000001", status: "done", turns: [{ turn: 1, status: "done", answer: "swept answer", model: "m" }] } };
r = await call("POST", "/api/cmd", { text: "please list the stale branches" });
const sweepId = (await r.json()).id;
raw.prepare("UPDATE cmd_log SET ts = datetime('now', '-5 minutes') WHERE id = ?").run(sweepId);
await call("GET", "/api/cmd/job/cmd-00000000000000000000"); // 404 path; the sweep is exercised through the exported tick below
const sweepSrc = src.slice(src.indexOf("async function cmdSweep(env)"), src.indexOf("// Execute one action through the same code the queue-card buttons use"));
ok(/cmdSettleStreams\(env\)/.test(sweepSrc) && /kind NOT IN \('agent', 'agent-stream'\)/.test(sweepSrc) && /kind = 'agent-stream' AND ts < datetime\('now', '-30 minutes'\)/.test(sweepSrc), "cmdSweep settles stream turns first, spares them for 3 minutes and abandons them only after 30");
// run the sweep for real through the module's scheduled path if exported, else through a direct evaluation of its source
const sweepCtx = { cmdEnsure: async () => {}, cmdSettleStreams: null, console };
const settleSrc = src.slice(src.indexOf("var CMD_STREAM_LINK_RE"), src.indexOf("// CMD-VOICE-1: speech to text for the command line."));
const bundle = settleSrc + "\n" + sweepSrc + "\nthis.cmdSweep = cmdSweep; this.cmdSettleStreams = cmdSettleStreams;";
const vctx = { cmdEnsure: async () => {}, AbortSignal, console, String, Number, Date, JSON, Array, Object, RegExp, Promise };
vm.createContext(vctx);
vm.runInContext(bundle, vctx);
await vctx.cmdSweep(env);
row = rows("SELECT status, answer FROM cmd_log WHERE id = '" + sweepId + "'")[0];
ok(row.status === "answered" && row.answer === "swept answer", "the scheduled sweep settles a stream turn that nobody polled", row);

sessionState = { ok: false, error: "no such code session" };
raw.prepare("INSERT INTO cmd_log (id, text, kind, status, answer, owner, ts) VALUES ('cmd-gone', '', 'agent-stream', 'running', 'session:run_gone00000001 turn:1', 1, datetime('now', '-1 minutes'))").run();
await vctx.cmdSettleStreams(env);
row = rows("SELECT status, error FROM cmd_log WHERE id = 'cmd-gone'")[0];
ok(row.status === "failed" && /^stream: the code session is gone/.test(row.error), "a turn whose session no longer exists fails with the stream stage, not as a model timeout", row);

raw.prepare("INSERT INTO cmd_log (id, text, kind, status, answer, owner, ts) VALUES ('cmd-old', '', 'agent-stream', 'running', 'garbled', 1, datetime('now', '-40 minutes'))").run();
await vctx.cmdSweep(env);
row = rows("SELECT status, error FROM cmd_log WHERE id = 'cmd-old'")[0];
ok(row.status === "failed" && /^stream: the code session did not finish in 30 minutes/.test(row.error), "a stream turn still running after 30 minutes is failed in the stream stage", row);

// the events route settles when the stream ends
sessionReply = { ok: true, session_id: "run_events00000001", turn: 1, status: "queued" };
sessionState = { ok: true, session: { id: "run_events00000001", status: "done", turns: [{ turn: 1, status: "done", answer: "from events", model: "m" }] } };
r = await call("POST", "/api/cmd", { text: "please check the deploy lock" });
const evId = (await r.json()).id;
waits.length = 0;
r = await call("GET", "/api/cmd/session/run_events00000001/events?after=0");
const evText = await r.text();
await Promise.all(waits);
ok(/event: complete/.test(evText), "the stream still reaches the page unchanged", evText);
row = rows("SELECT status, answer FROM cmd_log WHERE id = '" + evId + "'")[0];
ok(row.status === "answered" && row.answer === "from events", "the row is settled when the stream has been read to its end", row);

// ---- hand-off failures are logged as rows of their own stage
sessionReply = { ok: false, error: "no such code session", http: 409 };
opsStart = { ok: false, error: "ops-exec unavailable" };
const before = rows("SELECT COUNT(*) AS n FROM cmd_log WHERE kind = 'handoff'")[0].n;
r = await call("POST", "/api/cmd", { text: "please look at the queue depth later" });
await r.text();
const hand = rows("SELECT status, error, text FROM cmd_log WHERE kind = 'handoff' ORDER BY ts, rowid");
ok(hand.length - before === 2 && hand.every((x) => x.status === "fallback" && x.text === ""), "both refused hand-offs are logged without the prompt text", hand);
ok(hand.some((x) => /^hand-off: code-session start:/.test(x.error)) && hand.some((x) => /^hand-off: ops-exec start:/.test(x.error)), "the rows name the hand-off that failed", hand);

// ---- GET /api/cmd/failures
r = await call("GET", "/api/cmd/failures?days=30");
j = await r.json();
ok(j.ok === true && Array.isArray(j.by_stage) && j.turns > 0 && j.failed > 0, "the failures route answers counts", j);
ok(j.by_stage.some((x) => x.stage === "hand-off" && x.n === 2) && j.by_stage.some((x) => x.stage === "stream" && x.n >= 2), "it names the hand-off and stream stages", j.by_stage.map((x) => x.stage + ":" + x.n));
ok(!/refactor|summarise|stale branches|deploy lock/.test(JSON.stringify(j)), "it carries no prompt text", j);
const anon = await worker.fetch(new Request("https://fleet.qnfo.org/api/cmd/failures"), env, wctx);
ok(anon.status === 200, "it is an open read like the other fleet reads", anon.status);

// ---- the closing probe of issue 1000804 (migrations/2026-11-05-cmd-failures-1.sql) on this database
const mig = readFileSync(new URL("../migrations/2026-11-05-cmd-failures-1.sql", import.meta.url), "utf8");
const probeSql = /SET verify_probe = '((?:[^']|'')*)'/.exec(mig)[1].replace(/''/g, "'");
let pr = raw.prepare(probeSql).get();
ok(pr.expected !== pr.observed && /command-line defects in 24h: .*handoff\/fallback/.test(pr.observed) && /agent-stream\/failed/.test(pr.observed), "the probe sees the recent hand-off and stream defects", pr);
raw.prepare("DELETE FROM cmd_log WHERE status IN ('failed', 'fallback')").run();
raw.prepare("INSERT INTO cmd_log (id, text, kind, status, error, owner) VALUES ('cmd-model-fb', '', 'ai', 'fallback', 'glm-5.3-flash: timeout 13s', 1)").run();
pr = raw.prepare(probeSql).get();
ok(pr.expected === pr.observed, "a model fallback (the designed degradation of the AI answer leg) is not a command-line defect", pr);
raw.prepare("INSERT INTO cmd_log (id, text, kind, status, error, owner, ts) VALUES ('cmd-old-fail', '', 'agent-stream', 'failed', 'abandoned: the worker stopped before answering', 1, datetime('now', '-30 hours'))").run();
pr = raw.prepare(probeSql).get();
ok(pr.expected === pr.observed, "a defect older than 24 hours leaves the window", pr);
raw.prepare("INSERT INTO cmd_log (id, text, kind, status, error, owner) VALUES ('cmd-new-fail', '', 'ai', 'failed', 'abandoned: the worker stopped before answering', 1)").run();
pr = raw.prepare(probeSql).get();
ok(pr.expected !== pr.observed && /1 command-line defects in 24h: ai\/failed/.test(pr.observed), "a fresh worker-stopped failure on the model path is a defect", pr);
ok(/IDENTITY-BOUND:/.test(mig) && /INSERT OR IGNORE INTO human_actions/.test(mig) && /microphone=\(self\)/.test(mig), "the zone header change is an IDENTITY-BOUND owner card with the exact change");

// ---- the page
const i0 =src.indexOf("var CMD_JS = "), i1 = src.indexOf("\n", i0);
const pageJs = vm.runInNewContext(src.slice(i0 + "var CMD_JS = ".length, src.indexOf('"; // standards-ok', i0) + 1)).replace("HOLDER", "true");
ok(typeof pageJs === "string" && pageJs.length > 5000, "CMD_JS evaluates to the page script");
new vm.Script(pageJs); // syntax
ok(/kind==='stream'&&j\.session_id/.test(pageJs) && /\/api\/cmd\/session\/'\+sj\+'\/events/.test(pageJs), "the page opens the code session stream for a kind stream answer");
ok(/Permissions-Policy microphone=\(\)/.test(pageJs) && /allowsFeature\('microphone'\)/.test(pageJs), "a refused microphone names a site policy block when the page's own policy forbids it");

// a small DOM: enough for the page script to run send() against a stubbed stream
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ""; this._text = ""; this.style = {}; this.attrs = {}; this.parentNode = null; this.listeners = {}; this.disabled = false; this.value = ""; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  set textContent(v) { this._text = String(v); this.children = []; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, f) { this.listeners[t] = f; }
  focus() {}
  get scrollHeight() { return 20; }
  set innerHTML(v) { this._text = String(v).replace(/<[^>]*>/g, ""); this.children = []; }
  querySelector(sel) { // only the selectors the page uses: '.wait', '.wait span.t', '.qk'
    const cls = (e, c) => (" " + e.className + " ").includes(" " + c + " ");
    const walk = (e, f) => { for (const c of e.children) { if (f(c)) return c; const d = walk(c, f); if (d) return d; } return null; };
    if (sel === ".wait span.t") { const w = walk(this, (x) => cls(x, "wait")); return w ? walk(w, (x) => x.tag === "span" && cls(x, "t")) : null; }
    if (sel.startsWith(".")) return walk(this, (x) => cls(x, sel.slice(1)));
    return null;
  }
}
const byId = {};
const doc = {
  getElementById: (id) => byId[id] || (byId[id] = new El("div")),
  createElement: (t) => new El(t), createTextNode: (t) => { const e = new El("#text"); e._text = t; return e; },
  addEventListener() {}, querySelector: () => null, activeElement: null, permissionsPolicy: { allowsFeature: () => true }
};
byId.cform = new El("form"); byId.cmd = new El("div"); byId.cmd.attrs["data-from"] = ""; byId.ctext = new El("textarea"); byId.cout = new El("div"); byId.cgo = new El("button"); byId.cwho = new El("div"); byId.cchips = new El("div"); byId.cmic = new El("button");
const posted = [];
const events = [
  "id: 1\nevent: status\ndata: {\"status\":\"running\",\"turn\":1}\n\n",
  "id: 2\nevent: tool\ndata: {\"turn\":1,\"phase\":\"call\",\"name\":\"ops_fleet_status\",\"input\":\"{}\"}\n\n",
  "id: 3\nevent: text\ndata: {\"turn\":1,\"delta\":\"Fleet \"}\n\nid: 4\nevent: text\ndata: {\"turn\":1,\"delta\":\"is healthy.\"}\n\n",
  "id: 5\nevent: complete\ndata: {\"turn\":1,\"answer\":\"Fleet is healthy.\",\"model\":\"deepseek-v4-flash-wa\",\"input_tokens\":120,\"output_tokens\":8,\"cost_usd\":0.0004}\n\n"
];
const enc = new TextEncoder();
const fetched = [];
const win = {
  document: doc, sessionStorage: { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); } }, location: { href: "" }, window: null, setTimeout: (f) => setTimeout(f, 0), clearTimeout, console, JSON, Math, Date, Number, String, Array, Object, Promise, TextDecoder, TextEncoder, Error,
  navigator: {}, MediaRecorder: undefined,
  fetch: async (u, init) => {
    fetched.push([u, init && init.body]);
    if (u === "/api/cmd") { posted.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true, kind: "stream", id: "cmd-0123456789abcdef0123", session_id: "run_page00000001", turn: 1, holder: true }) }; }
    if (/^\/api\/cmd\/session\//.test(u)) {
      let i = 0;
      return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (i < events.length ? { done: false, value: enc.encode(events[i++]) } : { done: true }), cancel() {} }) } };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }
};
win.window = win;
const pageSrc = pageJs;
vm.runInNewContext(pageSrc, win);
byId.ctext.value = "please refactor the widget module";
byId.cform.listeners.submit({ preventDefault() {} });
await new Promise((res) => setTimeout(res, 80));
const card = byId.cout.children[0];
const shown = card ? card.textContent : "";
ok(posted.length === 1 && posted[0].text === "please refactor the widget module", "the page posts the line", posted);
ok(/Fleet is healthy\./.test(shown), "the page shows the streamed answer", shown);
ok(/> ops_fleet_status/.test(shown), "the page shows each tool step", shown);
ok(/deepseek-v4-flash-wa/.test(shown) && /120 in \/ 8 out tokens/.test(shown), "the page shows model and tokens", shown);
ok(!card.querySelector(".wait"), "the working indicator is gone when the answer is complete");
ok(win.sessionStorage.getItem("fleetcmdsid") === "run_page00000001", "the page remembers the session for the next line");
byId.ctext.value = "and the next thing";
fetched.length = 0;
byId.cform.listeners.submit({ preventDefault() {} });
await new Promise((res) => setTimeout(res, 40));
ok(posted.length === 2 && posted[1].session_id === "run_page00000001", "the next line continues the same code session", posted);
ok(fetched.some(([u]) => u === "/api/cmd/session/run_page00000001/events?after=5"), "the next stream resumes after the last event it saw", fetched.map((f) => f[0]));

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
