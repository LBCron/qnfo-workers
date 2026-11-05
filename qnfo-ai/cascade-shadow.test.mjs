// CASCADE-SHADOW-1 (RM-BS-QUNIVERSE-SMALL-1, docs/BLUE-SKY-ROADMAP-2026-11.md B1): offline suite for the cascade shadow in qnfo-ai/worker.js.
// Pins: (1) the fixture set is 24 gold-labelled items (8 per sub-stage, every label present, lean keeps every label);
// (2) the label parser is deterministic and refuses an ambiguous reply; (3) the assessment: a candidate that matches the incumbent and costs less is eligible,
// one that loses more than one noise-floor width is worse (the kill rule), one that loses within the floor is not worse, a harness fault is an error and never
// a verdict, the floor never falls under 1/n; (4) the run: pinned raw-binding calls (a wrapper that substitutes a model would be bypassed), one cloud_ops_events
// row per candidate plus one run row, 96 calls at most; (5) the gate: one finished run per 22 hours, a faulted-run cap, the ops_config switch, a forced run
// every 30 minutes; (6) BUDGET-SOFT-ROUTE-1: a spend governor that does not say allow makes the run lean (12 fixtures, one candidate), never skipped;
// (7) the hourly scheduled handler runs the shadow and the second tick is a no-op; (8) the route needs the router key and an explicit confirm.
// Run: node qnfo-ai/cascade-shadow.test.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
const dir = mkdtempSync(join(tmpdir(), "qnfo-ai-cascade-"));
let seq = 0;
const load = async () => {
  const p = join(dir, "worker" + (++seq) + ".mjs");
  writeFileSync(p, src);
  return (await import(pathToFileURL(p).href)).default;
};
const checks = [];
const ok = (condition, name, actual) => checks.push({ condition, name, actual });

/* ---- pure pieces, evaluated from the shipped source so the suite reads the real fixtures and rules ---------------------------------------------------------- */
const ratesLit = src.match(/^var __AI_ATTR_RATES = (\{.*\});$/m);
const block = src.slice(src.indexOf("var CASCADE_STAGE"), src.indexOf("async function cascadeShadowRun"));
const C = new Function("__AI_ATTR_RATES", block + "\nreturn { CASCADE_SETS, CASCADE_INCUMBENT, CASCADE_CANDIDATES, CASCADE_MIN_SAVING, cascadeFixtures, cascadeLabel, cascadeAssess, cascadeNeurons };")(JSON.parse(ratesLit[1]));

{
  const all = C.cascadeFixtures(false), lean = C.cascadeFixtures(true);
  ok(all.length === 24 && ["severity", "route", "degenerate"].every((s) => all.filter((f) => f.set === s).length === 8), "24 fixtures, 8 per sub-stage", all.length);
  ok(new Set(all.map((f) => f.id)).size === 24 && all.every((f) => f.labels.includes(f.gold) && f.prompt.includes("Text: ")), "ids are unique and every gold label is one of the offered labels");
  for (const [s, labels] of Object.entries({ severity: 4, route: 4, degenerate: 2 })) {
    ok(new Set(all.filter((f) => f.set === s).map((f) => f.gold)).size === labels, "every label of " + s + " appears in the full set");
    ok(new Set(lean.filter((f) => f.set === s).map((f) => f.gold)).size === labels, "every label of " + s + " survives the lean cut");
  }
  ok(lean.length === 12, "lean is 12 fixtures", lean.length);
}
{
  const L = C.CASCADE_SETS.severity.labels;
  ok(C.cascadeLabel("HIGH.", L) === "high", "case and a trailing full stop");
  ok(C.cascadeLabel("**critical**", L) === "critical", "markdown emphasis");
  ok(C.cascadeLabel("Answer: medium", L) === "medium", "an 'Answer:' prefix");
  ok(C.cascadeLabel("<think>maybe high</think>\nlow", L) === "low", "a think block is dropped before reading");
  ok(C.cascadeLabel("The severity is high.", L) === "high", "a first line that names exactly one label");
  ok(C.cascadeLabel("high or critical", L) === null, "a first line that names two labels is not an answer");
  ok(C.cascadeLabel("", L) === null && C.cascadeLabel("not sure", L) === null, "empty and label-free replies are not answers");
  ok(C.cascadeLabel("degenerate", C.CASCADE_SETS.degenerate.labels) === "degenerate" && C.cascadeLabel("ok", C.CASCADE_SETS.degenerate.labels) === "ok", "the two-label set");
}
{
  // synthetic runs over 24 fixtures: items carry ok, set, token counts, err
  const mk = (model, okFn, inTok = 100, outTok = 50, errFn = () => false) => ({
    model,
    items: Array.from({ length: 24 }, (_, i) => ({ id: "f" + i, set: i < 8 ? "severity" : i < 16 ? "route" : "degenerate", ok: okFn(i) ? 1 : 0, empty: 0, err: errFn(i) ? "Error" : null, in_tok: inTok, out_tok: outTok }))
  });
  const inc = mk(C.CASCADE_INCUMBENT, () => true);
  let a = C.cascadeAssess(inc, mk("@cf/qwen/qwen3-30b-a3b-fp8", () => true), 24);
  ok(a.verdict === "eligible" && a.projected_saving_pct > 60 && a.diff === 0 && a.would_revert_if_moved === false, "identical accuracy at a fraction of the cost is eligible", a);
  ok(Math.abs(a.noise_floor - Math.sqrt(1 / 24 / 24)) < 1e-3, "with no disagreement the noise floor is still 1/sqrt(n squared / 1), not zero", a.noise_floor);
  a = C.cascadeAssess(inc, mk("@cf/openai/gpt-oss-20b", (i) => i >= 4), 24);
  ok(a.verdict === "worse" && a.would_revert_if_moved === true && a.diff < -a.noise_floor, "four losses and no wins fall past the floor: the kill rule reads worse", a);
  a = C.cascadeAssess(inc, mk("@cf/openai/gpt-oss-20b", (i) => i !== 5), 24);
  ok(a.verdict !== "worse" && a.diff < 0 && a.diff >= -a.noise_floor, "one loss is inside the noise floor, not a kill", a);
  a = C.cascadeAssess(inc, mk("@cf/zai-org/glm-5.3-flash", () => true, 100, 50), 24);
  ok(a.verdict === "eligible" || a.verdict === "not_cheaper", "a same-accuracy candidate is eligible or not cheaper by its measured cost", a);
  a = C.cascadeAssess(inc, mk(C.CASCADE_INCUMBENT, () => true), 24);
  ok(a.verdict === "not_cheaper" && a.cost_ratio === 1 && a.projected_saving_pct === 0, "the same model at the same cost saves nothing", a);
  a = C.cascadeAssess(inc, mk("@cf/qwen/qwen3-30b-a3b-fp8", () => true, 100, 50, (i) => i % 3 === 0), 24);
  ok(a.verdict === "error" && a.would_revert_if_moved === false, "a third of the calls failing is a harness fault, never a verdict on the model", a);
  a = C.cascadeAssess(inc, mk("@cf/qwen/qwen3-30b-a3b-fp8", () => true, 100, 400), 24);
  ok(a.verdict === "not_cheaper" || a.projected_saving_pct < 30, "a cheap per-token rate with a long answer is judged on the measured total, not the rate", a);
  ok(C.cascadeNeurons("@cf/openai/gpt-oss-120b", 1e6, 0) === 31818 && C.cascadeNeurons("unknown/model", 5, 5) === null, "neurons come from the rate table, unknown models are unmeasured");
}
ok(C.CASCADE_CANDIDATES.every((m) => Object.prototype.hasOwnProperty.call(JSON.parse(ratesLit[1]), m)) && Object.prototype.hasOwnProperty.call(JSON.parse(ratesLit[1]), C.CASCADE_INCUMBENT), "every model of the stage has a rate in the table");
ok(/^\[triggers\]\s*\ncrons = \["40 \* \* \* \*"\]/m.test(toml), "wrangler.toml declares the hourly trigger at minute 40");
ok(/async scheduled\(event, env, ctx\)/.test(src) && /copy\.__rawAI = ai;/.test(src), "the worker has a scheduled handler and keeps the raw binding");

/* ---- the worker, with a stub binding and an in-memory event table ------------------------------------------------------------------------------------------- */
const goldOf = new Map();
for (const s of Object.values(C.CASCADE_SETS)) for (const [t, g] of s.items) goldOf.set(t, g);
const makeEnv = (o = {}) => {
  const st = { events: [], calls: [], opsConfig: o.opsConfig || null, spendRows: o.spendRows || [] };
  const env = {
    ROUTER_AUTH_KEY: "test-key",
    SPEND_CAP_GATEWAY_USD: "100000", SPEND_CAP_TOTAL_USD: o.totalCap || "100000", SPEND_CAP_WORKERS_AI_USD: o.waCap || "100000",
    QNFO_AUDIT: {
      prepare(sql) {
        const q = { args: [] };
        q.bind = (...args) => { q.args = args; return q; };
        q.first = async () => (/FROM ops_config/.test(sql) ? (st.opsConfig ? { value: st.opsConfig } : null) : null);
        q.all = async () => {
          if (/FROM ai_spend_ledger/.test(sql)) return { results: st.spendRows };
          if (/FROM cloud_ops_events WHERE kind = 'cascade-shadow-run'/.test(sql)) {
            const by = {};
            st.events.filter((e) => e.kind === "cascade-shadow-run" && e.ts > q.args[0]).forEach((e) => { by[e.status] = (by[e.status] || 0) + 1; });
            return { results: Object.entries(by).map(([status, n]) => ({ status, n })) };
          }
          return { results: [] };
        };
        q.run = async () => {
          const m = /INSERT INTO cloud_ops_events[^']*'(cascade-shadow(?:-run)?)'/.exec(sql);
          if (m) st.events.push({ kind: m[1], id: q.args[0], ts: q.args[1], text: q.args[2], meta: JSON.parse(q.args[3]), status: q.args[4] });
          return { meta: {} };
        };
        return q;
      }
    },
    AI: {
      async run(model, input) {
        st.calls.push({ model, input });
        const text = String(input.messages[0].content);
        const gold = goldOf.get(text.slice(text.indexOf("Text: ") + 6));
        const reply = (o.reply || ((m, g) => g))(model, gold, text);
        if (reply instanceof Error) throw reply;
        const wide = o.usage ? o.usage(model) : { prompt_tokens: 100, completion_tokens: 50 };
        return { choices: [{ message: { content: reply }, finish_reason: "stop" }], usage: wide };
      }
    }
  };
  return { env, st };
};
const ctx = { props: {}, waitUntil() {} };
const post = async (worker, env, body, key = "test-key", c = ctx) => {
  const r = await worker.fetch(new Request("https://ai.test/internal/eval/cascade-shadow", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(body) }), env, c);
  return { status: r.status, json: await r.json() };
};

try {
  {
    const w = await load();
    const { env, st } = makeEnv({
      reply: (m, g) => (/gpt-oss-20b/.test(m) ? (g === "high" || g === "ok" ? "wrong" : g) : /glm-5.3-flash/.test(m) ? new Error("capacity") : g)
    });
    let r = await post(w, env, { confirm: true }, "wrong-key");
    ok(r.status === 401 && st.calls.length === 0, "an unauthorized caller runs nothing", r);
    r = await post(w, env, {});
    ok(r.status === 400 && st.calls.length === 0, "a run needs an explicit confirm", r);
    r = await post(w, env, { confirm: true });
    ok(r.status === 200 && r.json.model_calls === 96 && st.calls.length >= 96 && st.calls.length <= 96 + 24, "a full run is 96 model calls (plus bounded length retries)", { calls: st.calls.length, json: { model_calls: r.json.model_calls } });
    const byModel = Object.fromEntries(r.json.assessments.map((a) => [a.candidate.split("/").pop(), a]));
    ok(byModel["qwen3-30b-a3b-fp8"].verdict === "eligible" && byModel["qwen3-30b-a3b-fp8"].diff === 0, "the cheap candidate that answers every fixture right is eligible", byModel["qwen3-30b-a3b-fp8"]);
    ok(byModel["gpt-oss-20b"].verdict === "worse" && byModel["gpt-oss-20b"].would_revert_if_moved === true, "the candidate that misses the 'high' and 'ok' fixtures reads worse", byModel["gpt-oss-20b"]);
    ok(byModel["glm-5.3-flash"].verdict === "error" && byModel["glm-5.3-flash"].errors_candidate === 24, "a candidate whose every call throws is a harness fault", byModel["glm-5.3-flash"]);
    const rows = st.events.filter((e) => e.kind === "cascade-shadow"), run = st.events.filter((e) => e.kind === "cascade-shadow-run");
    ok(rows.length === 3 && run.length === 1 && run[0].status === "ok" && r.json.faulted_candidates === 1, "three candidate rows and one run row; one faulted candidate does not fault the run", st.events.map((e) => e.kind + ":" + e.status));
    ok(rows.map((e) => e.status).sort().join() === "error,ok,ok" && rows.every((e) => e.meta.stage === "decision-classify" && e.meta.incumbent === "@cf/openai/gpt-oss-120b" && e.meta.noise_method && e.meta.promote_needs_consecutive_eligible_runs === 3), "each row names the stage, the incumbent, the noise method and the promotion rule");
    ok(st.calls.every((c) => c.input.max_tokens >= 1024 && c.input.messages.length === 1) && JSON.stringify(st.events).indexOf("Text: ") < 0, "calls are bounded to one message and the rows carry no fixture text");
    ok(st.calls.every((c) => [C.CASCADE_INCUMBENT, ...C.CASCADE_CANDIDATES].includes(c.model)), "only the stage's models are called (no fallback model)", [...new Set(st.calls.map((c) => c.model))]);
    const callsAfter = st.calls.length;
    r = await post(w, env, { confirm: true });
    ok(r.json.skipped === "a run finished inside the gate window" && st.calls.length === callsAfter, "a run with one faulted candidate still closes the gate: the others are not asked again", r.json);
  }
  {
    // a dead binding faults every candidate: the run row is a fault, the next attempts are allowed, the fourth is not
    const w = await load();
    const { env, st } = makeEnv({ reply: () => new Error("binding down") });
    let r = await post(w, env, { confirm: true });
    ok(r.json.ok === false && st.events.filter((e) => e.kind === "cascade-shadow-run" && e.status === "error").length === 1, "every candidate faulting makes the run row a fault", r.json.verdicts);
    r = await post(w, env, { confirm: true });
    r = await post(w, env, { confirm: true });
    ok(st.events.filter((e) => e.kind === "cascade-shadow-run").length === 3, "a faulted run does not block the next attempt, up to three");
    r = await post(w, env, { confirm: true });
    ok(r.json.skipped === "three faulted runs inside the gate window" && st.events.filter((e) => e.kind === "cascade-shadow-run").length === 3, "three faulted runs close the gate", r.json);
  }
  {
    const w = await load();
    const { env, st } = makeEnv();
    let r = await post(w, env, { confirm: true });
    ok(r.status === 200 && r.json.ok === true && r.json.assessments.length === 3 && r.json.assessments.every((a) => a.diff === 0), "a clean run finishes ok", r.json.verdicts);
    ok(r.json.assessments.every((a) => a.verdict === "eligible"), "equal accuracy at lower measured cost: all three candidates eligible on identical token counts", r.json.assessments.map((a) => a.candidate + ":" + a.verdict + ":" + a.projected_saving_pct));
    const before = st.calls.length;
    r = await post(w, env, { confirm: true });
    ok(r.json.skipped === "a run finished inside the gate window" && st.calls.length === before, "a finished run closes the gate: no second run, no model calls", r.json);
    st.events.forEach((e) => { e.ts = new Date(Date.now() - 31 * 6e4).toISOString(); });
    r = await post(w, env, { confirm: true });
    ok(r.json.run_id && st.calls.length > before, "a forced call runs again once the 30-minute window has passed", r.json.skipped);
  }
  {
    const w = await load();
    const { env, st } = makeEnv({ opsConfig: "off" });
    const r = await post(w, env, { confirm: true });
    ok(r.json.skipped === "ops_config cascade_shadow is off" && st.calls.length === 0 && st.events.length === 0, "ops_config cascade_shadow = off stops the run before any model call", r.json);
  }
  {
    // BUDGET-SOFT-ROUTE-1: a breached cap makes the run lean, it does not skip it
    const w = await load();
    const { env, st } = makeEnv({ waCap: "1", spendRows: [{ provider: "workers-ai", usd: 500 }] });
    const r = await post(w, env, { confirm: true });
    ok(r.status === 200 && r.json.lean === true && r.json.fixtures === 12 && r.json.assessments.length === 1 && r.json.model_calls === 24, "a breached workers-ai cap runs lean: 12 fixtures, one candidate, 24 calls", { lean: r.json.lean, fixtures: r.json.fixtures, calls: r.json.model_calls, gov: r.json.gov_note });
    ok(st.events.filter((e) => e.kind === "cascade-shadow").length === 1 && st.events.find((e) => e.kind === "cascade-shadow").meta.lean === true, "the lean flag is on the recorded row");
  }
  {
    // reasoning model that spends its budget on thought: asked once more, scored on the second reply
    const w = await load();
    const { env, st } = makeEnv();
    const seen = new Map();
    env.AI.run = async (model, input) => {
      st.calls.push({ model, input });
      const t = String(input.messages[0].content), gold = goldOf.get(t.slice(t.indexOf("Text: ") + 6));
      const k = model + "|" + t;
      const n = (seen.get(k) || 0) + 1;
      seen.set(k, n);
      if (/gpt-oss-120b/.test(model) && n === 1) return { choices: [{ message: { content: "", reasoning_content: "thinking" }, finish_reason: "length" }], usage: { prompt_tokens: 100, completion_tokens: 1024 } };
      return { choices: [{ message: { content: gold }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50 } };
    };
    const r = await post(w, env, { confirm: true, candidates: ["@cf/qwen/qwen3-30b-a3b-fp8"] });
    ok(r.json.assessments.length === 1 && r.json.assessments[0].acc_incumbent === 1 && r.json.assessments[0].empty_incumbent === 0, "a length-capped empty reply is retried once with room and then scored", r.json.assessments[0]);
    ok(st.calls.filter((c) => /gpt-oss-120b/.test(c.model) && c.input.max_tokens === 3072).length === 24, "the retry asks for 3072 tokens", st.calls.filter((c) => /gpt-oss-120b/.test(c.model)).length);
    ok(r.json.assessments[0].neurons_incumbent > 24 * (100 * 31818 + 50 * 68182) / 1e6, "the cost of the retried call is counted", r.json.assessments[0].neurons_incumbent);
  }
  {
    // the hourly trigger
    const w = await load();
    const { env, st } = makeEnv();
    await w.scheduled({ cron: "40 * * * *" }, env, ctx);
    ok(st.calls.length >= 96 && st.events.filter((e) => e.kind === "cascade-shadow").length === 3 && st.events.filter((e) => e.kind === "cascade-shadow-run").length === 1, "the scheduled handler runs the shadow and writes its rows", { calls: st.calls.length, events: st.events.map((e) => e.kind) });
    const before = st.calls.length;
    await w.scheduled({ cron: "40 * * * *" }, env, ctx);
    ok(st.calls.length === before && st.events.length === 4, "the next hourly tick is a no-op while the run is inside the 22-hour window");
    const { env: e2, st: s2 } = makeEnv();
    e2.AI.run = async () => { throw new Error("binding down"); };
    await w.scheduled({}, e2, ctx);
    ok(s2.events.filter((e) => e.kind === "cascade-shadow-run").every((e) => e.status === "error"), "a dead binding writes a faulted run row and never throws out of the trigger", s2.events.map((e) => e.kind + ":" + e.status));
  }

  const failed = checks.filter((c) => !c.condition);
  for (const c of failed) console.log("FAIL " + c.name + (c.actual !== undefined ? " :: " + JSON.stringify(c.actual).slice(0, 500) : ""));
  console.log((checks.length - failed.length) + " passed, " + failed.length + " failed");
  process.exitCode = failed.length ? 1 : 0;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
