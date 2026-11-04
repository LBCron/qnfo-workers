// WAI-WIDTH-GOVERNOR-1 (qnfo-research-exec 0.25.0, pillar cost; agent_issues 99924, 2731, 99928, 99937, 2930) offline suite.
// Runs, from the worker source, (1) widthGovern and researchParallel (AIMD width under the LEAN-WIDTH-1 cap) against node:sqlite
// tables that hold the real event shapes, (2) aiText (per-isolate model-skip gauge; a fallback is never a dearer model) against a
// scripted env.AI, and (3) the real stageRevise (kimi-k2.6 only as the last retry, switchable off) against in-memory mocks.
// Run: node qnfo-research-exec/width-governor.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { stageRevise, paperCompleteness } from "./worker.js";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 500) : "")); } };
const line = (name) => { const m = new RegExp("\\nvar " + name + " = [^\\n]*").exec(src); if (!m) throw new Error("missing " + name); return m[0]; };
const fn = (head) => { const a = src.indexOf("\n" + head); if (a < 0) throw new Error("missing " + head); return src.slice(a, src.indexOf("\n}\n", a) + 2); };
const GLM = "@cf/zai-org/glm-5.3-flash", OSS = "@cf/openai/gpt-oss-120b", KIMI = "@cf/moonshotai/kimi-k2.6", GLM_BIG = "@cf/zai-org/glm-5.3";
console.error = () => {};

// ---- 1. the width governor against node:sqlite ------------------------------------------------------------------------------
const WIDTH_SRC = ["WORKER", "RESEARCH_PARALLEL_DEFAULT", "RESEARCH_PARALLEL_MAX", "RESEARCH_PARALLEL_LEAN", "WIDTH_FLOOR", "WIDTH_STEP_UP", "WIDTH_RL_SHARE", "WIDTH_RL_MIN", "WIDTH_LOOKBACK_MIN", "WIDTH_PREV_MAX_MIN"].map(line).join("")
  + fn("function nowIso(") + fn("async function logEvent(") + fn("async function floorFlag(") + fn("async function widthGovern(") + fn("async function leanEnsemble(") + fn("async function researchLeanWidth(") + fn("async function researchParallel(")
  + "\nreturn { widthGovern, researchParallel, WIDTH_FLOOR };";
const { widthGovern, researchParallel, WIDTH_FLOOR } = new Function("crypto", WIDTH_SRC)(globalThis.crypto);
ok(WIDTH_FLOOR === 4, "the width floor is 4: the governor never drives the width to 0");

function mkDb(opts) {
  opts = opts || {};
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);"
    + "CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT);"
    + (opts.noBudget ? "" : "CREATE TABLE fleet_budget (node_class TEXT PRIMARY KEY, cap INTEGER NOT NULL, target INTEGER NOT NULL, current INTEGER NOT NULL, unit TEXT NOT NULL, updated_at TEXT NOT NULL);"));
  let seq = 0;
  const D1 = { prepare(sql) { let args = []; const q = {
    bind(...a) { args = a; return q; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async run() { db.prepare(sql).run(...args); return { meta: { changes: 1 } }; },
    async all() { return { results: db.prepare(sql).all(...args) }; } }; return q; } };
  const ev = (kind, text, minsAgo, job) => db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?,?,?,?,?,?,?)").run("s" + (seq++), new Date(Date.now() - minsAgo * 6e4).toISOString(), kind, text, "{}", job || "qnfo-research-exec", "ok");
  const cfg = (k, v) => db.prepare("INSERT OR REPLACE INTO ops_config (key, value) VALUES (?, ?)").run(k, String(v));
  const events = (kind) => db.prepare("SELECT text, status FROM cloud_ops_events WHERE kind = ? AND job = 'qnfo-research-exec' ORDER BY ts, id").all(kind);
  const rl = (n, mins, model) => { for (let i = 0; i < n; i++) ev("ai-warn", "aiText model=" + (model || GLM) + " transient (3021: AiError: Rate limit exceeded), backing off " + (700 + i) + "ms (attempt 1/3)", mins); };
  const runs = (n, mins) => { for (let i = 0; i < n; i++) ev("done", '{"ok":true,"stage":"review->verify"}', mins); };
  return { db, env: { QNFO_AUDIT: D1 }, ev, cfg, events, rl, runs };
}
const tick = () => new Promise((r) => setTimeout(r, 4));

// no history: starts at the cap, holds, and says so
{
  const t = mkDb();
  ok(await widthGovern(t.env, 24) === 24, "no history: the width is the cap");
  const e = t.events("research-width");
  ok(e.length === 1 && /^width=24 cap=24 prev=24 rl=0 runs=0 share=0\.00 mode=hold$/.test(e[0].text) && e[0].status === "ok", "a research-width event records the reading", e);
}
// a rate-limited tick halves, repeatedly, to the floor and no lower
{
  const t = mkDb();
  t.runs(40, 5); t.rl(25, 5);
  t.ev("research-width", "width=24 cap=24 prev=24 rl=0 runs=0 share=0.00 mode=hold", 10);
  const seen = [];
  for (let i = 0; i < 5; i++) { seen.push(await widthGovern(t.env, 24)); await tick(); }
  ok(JSON.stringify(seen) === JSON.stringify([12, 6, 4, 4, 4]), "25 first-attempt rate limits in 40 runs: 24 -> 12 -> 6 -> 4, and 4 stays 4 (never 0)", seen);
  const e = t.events("research-width");
  ok(e.slice(1).every((x) => /mode=halve/.test(x.text) && x.status === "warn" && /share=0\.63/.test(x.text)), "every halving is a warn event with the measured share", e.map((x) => x.text));
}
// recovery: +2 per clean tick up to the cap
{
  const t = mkDb();
  t.runs(40, 5);
  t.ev("research-width", "width=4 cap=24 prev=8 rl=30 runs=40 share=0.75 mode=halve", 10);
  const seen = [];
  for (let i = 0; i < 12; i++) { seen.push(await widthGovern(t.env, 24)); await tick(); }
  ok(JSON.stringify(seen) === JSON.stringify([6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 24, 24]), "clean ticks add 2 each from 4 back to the cap and stay there", seen);
  const e = t.events("research-width");
  ok(/mode=grow/.test(e[1].text) && /mode=hold/.test(e[e.length - 1].text), "growth is logged as grow, the cap as hold", [e[1].text, e[e.length - 1].text]);
}
// thresholds: at least 3 calls and more than 15% of the runs
{
  const a = mkDb(); a.runs(100, 5); a.rl(15, 5);
  ok(await widthGovern(a.env, 24) === 24, "exactly 15% (15 of 100) does not halve");
  const b = mkDb(); b.runs(100, 5); b.rl(16, 5);
  ok(await widthGovern(b.env, 24) === 12, "16% halves");
  const c = mkDb(); c.runs(2, 5); c.rl(2, 5);
  ok(await widthGovern(c.env, 24) === 24, "two rate limits are below the minimum of 3 even at a 100% share");
  const d = mkDb(); d.rl(3, 5);
  ok(await widthGovern(d.env, 24) === 12 && /share=1\.00/.test(d.events("research-width")[0].text), "3 rate limits with no stage run at all read as a full share and halve");
}
// only first-attempt 3021/3040 calls of this worker in the last 30 minutes count
{
  const t = mkDb();
  t.runs(10, 5);
  for (let i = 0; i < 6; i++) t.ev("ai-warn", "aiText model=" + GLM + " transient (3021: Rate limit), backing off 1400ms (attempt 2/3)", 5);
  for (let i = 0; i < 6; i++) t.ev("ai-warn", "aiText model=" + KIMI + " transient (3046: Request timeout), backing off 700ms (attempt 1/3)", 5);
  for (let i = 0; i < 6; i++) t.ev("ai-warn", "aiText model=" + GLM + " transient (3021: Rate limit), backing off 700ms (attempt 1/3)", 5, "q08-signal-engine");
  for (let i = 0; i < 6; i++) t.ev("ai-warn", "aiText model=" + GLM + " transient (3021: Rate limit), backing off 700ms (attempt 1/3)", 45);
  ok(await widthGovern(t.env, 24) === 24 && /rl=0 /.test(t.events("research-width")[0].text), "retries 2/3, timeouts, another worker's events and events older than 30 minutes are not counted", t.events("research-width"));
  const u = mkDb(); u.runs(10, 5);
  for (let i = 0; i < 4; i++) u.ev("ai-warn", "aiText model=" + OSS + " transient (3040: capacity exceeded), backing off 700ms (attempt 1/3)", 5);
  ok(await widthGovern(u.env, 24) === 12, "3040 (capacity exceeded) counts like 3021");
}
// the previous width: newest research-width event of the last hour, capped at today's cap; older ones are ignored
{
  const t = mkDb(); t.runs(40, 5); t.rl(25, 5);
  t.ev("research-width", "width=4 cap=24 prev=8 rl=30 runs=40 share=0.75 mode=halve", 90);
  ok(await widthGovern(t.env, 24) === 12, "a 90-minute-old reading is ignored: the halving starts from the cap");
  const u = mkDb(); u.runs(10, 5);
  u.ev("research-width", "width=40 cap=48 prev=48 rl=0 runs=10 share=0.00 mode=hold", 10);
  ok(await widthGovern(u.env, 24) === 24, "a previous width above a lowered cap is clamped to the cap");
}
// cap at or under the floor, the off switch, and a D1 fault
{
  const t = mkDb(); t.runs(40, 5); t.rl(25, 5);
  ok(await widthGovern(t.env, 4) === 4 && await widthGovern(t.env, 2) === 2 && t.events("research-width").length === 0, "a cap at or under the floor is returned as is, with no reading");
  t.cfg("research_governor", "off");
  ok(await widthGovern(t.env, 24) === 24 && t.events("research-width").length === 0, "ops_config research_governor = off returns the plain cap and logs nothing");
  const bad = { QNFO_AUDIT: { prepare() { throw new Error("D1 down"); } } };
  ok(await widthGovern(bad, 24) === 24, "a D1 fault returns the cap");
}
// researchParallel: the lean cap first, the governor under it
{
  const t = mkDb();
  t.cfg("research_parallel", 96);
  t.db.prepare("INSERT INTO fleet_budget VALUES ('ai_spend:workers-ai', 95, 78, 410, 'usd_30d_list_estimate', 'now')").run();
  ok(await researchParallel(t.env) === 24, "breached cap, clean history: configured 96 -> lean 24 -> governed 24");
  await tick(); t.runs(40, 2); t.rl(25, 2);
  ok(await researchParallel(t.env) === 12, "breached cap and 25 of 40 runs rate-limited: 24 -> 12");
  await tick();
  ok(await researchParallel(t.env) === 6, "the next rate-limited tick halves again: 6");
  const u = mkDb();
  u.cfg("research_parallel", 96);
  u.db.prepare("INSERT INTO fleet_budget VALUES ('ai_spend:workers-ai', 95, 78, 20, 'usd_30d_list_estimate', 'now')").run();
  ok(await researchParallel(u.env) === 48, "no breach: configured 96 is clamped to the 48 ceiling, the governor holds it there");
  const v = mkDb({ noBudget: true });
  v.cfg("research_parallel", 96);
  ok(await researchParallel(v.env) === 24, "an unreadable fleet_budget reads as breached: lean width 24");
  const w = mkDb();
  w.cfg("research_parallel", 3);
  w.cfg("research_governor", "off");
  ok(await researchParallel(w.env) === 3, "a configured width of 3 is never raised to the floor");
  const x = mkDb();
  ok(await researchParallel(x.env) === 2, "unset research_parallel keeps the default 2");
}

// ---- 2. aiText: the gauge, and a fallback is never a dearer model ----------------------------------------------------------
const i0 = src.indexOf("\nasync function aiText(env, model, prompt, maxTokens, effort) {");
const AI_SRC = line("__AI_ATTR_RATES") + line("AI_RATE_FALLBACK") + line("AI_TIMEOUT_SKIP") + line("AI_TRANSIENT_RE") + line("AI_MODEL_SKIP_MS") + line("_aiRateSkip") + line("_aiSkipLogged")
  + fn("function aiInputRate(") + fn("function aiFallbackFor(") + fn("async function aiSkipLog(")
  + "\nvar MODELS_COST_ORDER = [\"@cf/zai-org/glm-5.3-flash\", \"@cf/openai/gpt-oss-120b\"];\nvar _costFirst = false;\nvar AI_TEXT_MAX_OUT = {};\nasync function aiRunOpts() { return undefined; }\nvar _evs = [];\nasync function logEvent(env, kind, text) { _evs.push(kind + ': ' + text); }\n"
  + src.slice(i0, src.indexOf("\n}\n", i0) + 2)
  + "\nreturn { aiText, aiFallbackFor, aiInputRate, AI_RATE_FALLBACK, __AI_ATTR_RATES, evs: _evs, skip: _aiRateSkip, reset: function() { for (var k in _aiRateSkip) delete _aiRateSkip[k]; for (var k2 in _aiSkipLogged) delete _aiSkipLogged[k2]; _evs.length = 0; } };";
const G = new Function(AI_SRC)();
const realSet = globalThis.setTimeout; const waits = [];
globalThis.setTimeout = (f, ms) => { waits.push(ms); return realSet(f, 0); };
const aenv = (script) => { G.reset(); waits.length = 0; const calls = []; return { calls, AI: { run: async (model) => { calls.push(model); const r = script(model, calls.length); if (r instanceof Error) throw r; return r; } } }; };

// the table itself: no entry names a dearer model, and every model in it has a known rate
{
  const bad = Object.keys(G.AI_RATE_FALLBACK).filter((p) => !(G.aiInputRate(G.AI_RATE_FALLBACK[p]) <= G.aiInputRate(p)) || G.aiInputRate(p) === Infinity);
  ok(bad.length === 0, "no AI_RATE_FALLBACK entry names a model whose input rate is above the primary's", bad);
  ok(G.aiFallbackFor(GLM) === null && G.aiFallbackFor(OSS) === GLM && G.aiFallbackFor(KIMI) === GLM && G.aiFallbackFor(GLM_BIG) === OSS && G.aiFallbackFor("@cf/unknown/model") === null, "glm-5.3-flash has no fallback; gpt-oss-120b, kimi-k2.6 and glm-5.3 fall back to a cheaper one; an unknown model to none");
  ok(G.aiInputRate(KIMI) / G.aiInputRate(GLM) > 6 && G.aiInputRate(OSS) / G.aiInputRate(GLM) > 2, "the rates behind that: kimi-k2.6 is over 6x and gpt-oss-120b over 2x glm-5.3-flash");
}
// the guard is a runtime rule, not only a property of today's table: a dearer entry added later is refused
{
  G.AI_RATE_FALLBACK[GLM] = OSS;
  ok(G.aiFallbackFor(GLM) === null, "a table entry that names a dearer model (glm-5.3-flash -> gpt-oss-120b) is refused at run time");
  const e = aenv((m) => new Error("3021: Rate limit exceeded"));
  const out = await G.aiText(e, GLM, "p", 100, "low");
  ok(out === "" && e.calls.indexOf(OSS) < 0, "and a rate-limited glm-5.3-flash call never reaches gpt-oss-120b even then", e.calls);
  delete G.AI_RATE_FALLBACK[GLM];
}
// a rate-limited glm-5.3-flash never buys gpt-oss-120b: backoff, one wait, one more call, then an empty answer
{
  const e = aenv((m) => new Error("3021: AiError: Rate limit exceeded"));
  const out = await G.aiText(e, GLM, "p", 100, "low");
  ok(out === "" && e.calls.length === 5 && e.calls.every((m) => m === GLM), "glm-5.3-flash 3021 on every call: 3 backoff retries and one call after the wait, all on glm-5.3-flash, empty answer", e.calls);
  ok(waits.some((w) => w >= 2e4), "the extra try waited the 20 s gauge window", waits);
  ok(G.evs.some((x) => /^ai-warn: .*no fallback at or under its price/.test(x)) && G.evs.some((x) => /^ai-error: /.test(x)), "the wait and the final error are logged", G.evs);
}
{
  const e = aenv((m, n) => n <= 4 ? new Error("3021: Rate limit exceeded") : { response: "answer" });
  const out = await G.aiText(e, GLM, "p", 100, "low");
  ok(out === "answer" && e.calls.length === 5 && e.calls.indexOf(OSS) < 0, "the call after the wait succeeds on glm-5.3-flash with no dearer model", e.calls);
}
// gpt-oss-120b exhausted: the cheaper glm-5.3-flash, as AI-RATE-FALLBACK-1 did
{
  const e = aenv((m) => m === OSS ? new Error("3021: Rate limit exceeded") : { response: "from-glm" });
  const out = await G.aiText(e, OSS, "p", 100, "low");
  ok(out === "from-glm" && e.calls.filter((m) => m === OSS).length === 4 && e.calls[e.calls.length - 1] === GLM, "gpt-oss-120b exhausted after 4 calls: the answer comes from glm-5.3-flash", e.calls);
  ok(G.skip[OSS] > Date.now() + 15e3 && G.skip[OSS] <= Date.now() + 2e4, "the 3021 set a 20 s skip gauge on gpt-oss-120b", G.skip);
}
// the gauge: while it runs, a call that names the model goes to its fallback at once (one event per window), and another model is untouched
{
  const e = aenv((m) => m === OSS ? new Error("3021: Rate limit exceeded") : { response: "ok" });
  await G.aiText(e, OSS, "p", 100, "low");
  e.calls.length = 0;
  const out1 = await G.aiText(e, OSS, "p2", 100, "low");
  const out2 = await G.aiText(e, OSS, "p3", 100, "low");
  ok(out1 === "ok" && out2 === "ok" && JSON.stringify(e.calls) === JSON.stringify([GLM, GLM]), "inside the window gpt-oss-120b calls go straight to glm-5.3-flash, no gpt-oss-120b call at all", e.calls);
  ok(G.evs.filter((x) => /^ai-skip: .*gpt-oss-120b skipped for/.test(x)).length === 1, "the skip is logged once per window, not once per call", G.evs);
  e.calls.length = 0;
  await G.aiText(e, KIMI, "p4", 100, "low");
  ok(JSON.stringify(e.calls) === JSON.stringify([KIMI]), "a model with no gauge set is called as usual", e.calls);
}
{
  const e = aenv((m) => new Error("3021: Rate limit exceeded"));
  await G.aiText(e, GLM, "p", 100, "low");
  e.calls.length = 0; waits.length = 0;
  const e2 = { calls: e.calls, AI: { run: async (model) => { e.calls.push(model); return { response: "fine" }; } } };
  const out = await G.aiText(e2, GLM, "p2", 100, "low");
  ok(out === "fine" && JSON.stringify(e.calls) === JSON.stringify([GLM]) && waits.length >= 1, "inside the window a glm-5.3-flash call (no cheaper fallback) waits, then calls glm-5.3-flash once, never gpt-oss-120b", { calls: e.calls, waits });
}
// a timeout does not set the gauge; kimi-k2.6 timeout still falls back at once (KIMI-TIMEOUT-FALLBACK-1)
{
  const e = aenv((m) => m === KIMI ? new Error("3046: Request timeout") : { response: "ok" });
  const out = await G.aiText(e, KIMI, "p", 100, "low");
  ok(out === "ok" && JSON.stringify(e.calls) === JSON.stringify([KIMI, GLM]) && !(G.skip[KIMI] > 0), "a 3046 timeout sets no gauge and keeps the kimi-k2.6 -> glm-5.3-flash fallback", { calls: e.calls, skip: G.skip });
}
globalThis.setTimeout = realSet;

// ---- 3. the revise chain: gpt-oss-120b first since RESEARCH-REVISE-RELIABLE-1 (0.48.0), glm-5.3-flash second, kimi-k2.6 last ----
const SENT = "The derivation in this paragraph restates an input value with its source and shows the arithmetic step that follows from it. ";
const sec = (h, n) => "## " + h + "\n\n" + SENT.repeat(n) + "\n\n";
const UNIQUE = "The coupling constant takes the value 0.5000 in the baseline configuration of the model studied here.";
const PAPER = "# A paper about a model\n\n## Abstract\n\nContext, gap, approach, result and practice are stated here in order.\n\n"
  + sec("1. Introduction", 12) + sec("2. Background and Related Work", 12) + sec("3. Methods", 12)
  + "## 4. Analysis\n\n" + UNIQUE + "\n\n" + SENT.repeat(14) + "\n\n"
  + sec("5. Results", 12) + sec("6. Discussion", 12) + sec("7. Practical Implications and Engineering Pathways", 12) + sec("8. Conclusion", 6)
  + "## References\n\n" + Array.from({ length: 8 }, (_, i) => "[" + (i + 1) + "] Work " + (i + 1) + ". arXiv:2401.0000" + i).join("\n") + "\n";
ok(PAPER.length >= 12000 && paperCompleteness(PAPER).complete, "fixture: a complete paper of at least 12000 chars");
const GOOD = (n) => "[{\"find\":" + JSON.stringify(UNIQUE) + ",\"replace\":\"The coupling constant takes the value $0.5000$ in the baseline configuration, as derived in step " + n + ".\"}]";
function renv(answer, cfg) {
  const store = { "pipeline/r1/reconciled.md": PAPER, "pipeline/r1/fixes.json": JSON.stringify({ hard: [{ id: "h1", severity: "HARD", claim: "the coupling value", reason: "stated without derivation", fix: "derive or remove" }], soft: [] }), "pipeline/r1/grounding.md": "" };
  const calls = [];
  const D1 = { prepare(sql) { let args = []; const q = { bind(...x) { args = x; return q; }, async run() { return { meta: { changes: 1 } }; }, async first() { return /FROM ops_config/.test(sql) && cfg && cfg[args[0]] != null ? { value: cfg[args[0]] } : null; }, async all() { return { results: [] }; } }; return q; } };
  const MIRROR = { async get(k) { const v = store[k]; return v == null ? null : { text: async () => v }; }, async put(k, v) { store[k] = v; } };
  const AI = { async run(model, input) { calls.push(model); return { response: answer(calls.length, model) }; } };
  return { env: { AI, QNFO_AUDIT: D1, MIRROR }, calls, store };
}
const row = { id: "r1", context: "{}", recover_count: 0, source: "idea-hub", stage: "revise", status: "researching" };
{
  const t = renv((n) => n === 1 ? "[]" : GOOD(n));
  const res = await stageRevise(t.env, Object.assign({}, row));
  ok(res.ok === true && res.stage === "revise->review" && t.calls.length === 2 && t.calls[0] === OSS && t.calls[1] === GLM, "an edit from glm-5.3-flash, the second model, ends the chain: kimi-k2.6 is never called", t.calls);
}
{
  const t = renv((n) => n === 1 ? "I cannot find a suitable edit." : GOOD(n));
  const res = await stageRevise(t.env, Object.assign({}, row));
  ok(res.ok === true && res.stage === "revise->review" && JSON.stringify(t.calls) === JSON.stringify([OSS, GLM]), "an answer with no JSON list at all goes to glm-5.3-flash, not kimi-k2.6", t.calls);
}
{
  const t = renv((n) => n < 3 ? "[]" : GOOD(n));
  const res = await stageRevise(t.env, Object.assign({}, row));
  ok(res.ok === true && res.stage === "revise->review" && JSON.stringify(t.calls) === JSON.stringify([OSS, GLM, KIMI]), "kimi-k2.6 is the third and last call, and its edit is applied", t.calls);
}
{
  const t = renv(() => "[]");
  const res = await stageRevise(t.env, Object.assign({}, row));
  ok(res.ok === false && res.withheld === "revise-noop" && JSON.stringify(t.calls) === JSON.stringify([OSS, GLM, KIMI]), "three empty answers fail the pass as before, after exactly one kimi-k2.6 call", t.calls);
}
{
  const t = renv(() => "[]", { research_kimi_last_resort: "off" });
  const res = await stageRevise(t.env, Object.assign({}, row));
  ok(res.ok === false && res.withheld === "revise-noop" && JSON.stringify(t.calls) === JSON.stringify([OSS, GLM]) && t.calls.indexOf(KIMI) < 0, "ops_config research_kimi_last_resort = off drops kimi-k2.6 from the chain", t.calls);
}

globalThis.setTimeout = realSet;
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
