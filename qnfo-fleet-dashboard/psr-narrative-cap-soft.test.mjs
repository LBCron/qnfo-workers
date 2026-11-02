// PSR-NARRATIVE-CAP-SOFT-1 offline suite (qnfo-fleet-dashboard 1.71.1, 2026-10-26, pillar cost; agent_issues 1000409).
// BUDGET-SOFT-ROUTE-1 (owner directive 2026-10-06): a breached ai_spend cap steers model choice to the cheapest capable model and never stops work. The weekly program-strategic review
// asked for no narrative at all while any fleet_budget ai_spend cap was breached (ai_spend:workers-ai read 660.09 against a cap of 95) and when the budget could not be read.
// The worker's own source (psrNarrativeTier, psrNarrative, psrReview) runs in a vm with a scripted fake D1 and a fake qnfo-ai service. Proves: with caps in range the narrative runs on the
// normal tier (free model first, paid model as the fallback); with a cap breached it still runs, once per program, on the free model only, tier "lean"; with the budget unreadable it runs
// lean; the persona prompt of each program is read; the result and the summary name the tier and the count; a model that fails or answers nothing leaves the deterministic review intact and
// never throws; and the gate text the closing code-probe looks for is gone.
// Run: node qnfo-fleet-dashboard/psr-narrative-cap-soft.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };

const grab = (start, end) => { const i = src.indexOf(start), j = src.indexOf(end, i); return i >= 0 && j > i ? src.slice(i, j + end.length) : ""; };
const parts = [
  grab("async function d1all(db, sql, params) {", "\n__name(d1all, \"d1all\");"),
  grab("var PSR_RISK_HIGH = 3;", "\n__name(psrReview, \"psrReview\");"),
];
ok(parts.every((p) => p.length > 100), "d1all and the PSR block (psrNarrativeTier, psrNarrative, psrReview) are found in worker.js", parts.map((p) => p.length));
const id = (f) => f;
const sb = { console, Math, Number, String, Object, JSON, Array, Date, Promise, isFinite, setTimeout, clearTimeout, AbortController, NAME: "qnfo-fleet-dashboard", VERSION: "test", __name: id, __name2: id, __name22: id, __name222: id, __name2222: id, __name22222: id };
vm.createContext(sb);
vm.runInContext(parts.join("\n") + "\n;__x = { psrNarrativeTier, psrNarrative, psrReview, PSR_FREE_MODEL, PSR_PAID_MODEL };", sb);
const X = sb.__x;

// A scripted fake D1. o.budget: fleet_budget rows (undefined = the read throws); o.programs: v_program_health rows; o.prompts: persona prompts by agent id.
function fakeDb(o) {
  const runs = [], reads = [];
  const stmt = (sql) => {
    let args = [];
    const s = {
      bind: (...xs) => { args = xs; return s; },
      all: async () => {
        reads.push({ sql, args });
        if (/FROM fleet_budget/.test(sql)) { if (o.budget === undefined) throw new Error("D1 down"); return { results: o.budget }; }
        if (/FROM v_program_health/.test(sql)) return { results: o.programs };
        if (/FROM program_charters/.test(sql)) return { results: o.programs.map((p) => ({ program_code: p.program_code, objective: "obj " + p.program_code, primary_metric: null, manager_persona: "program-manager:" + p.program_code })) };
        if (/FROM fleet_agents/.test(sql)) return { results: o.prompts && o.prompts[args[0]] ? [{ system_prompt: o.prompts[args[0]] }] : [] };
        return { results: [] };
      },
      first: async () => null,
      run: async () => { runs.push({ sql, args }); return { success: true, meta: { last_row_id: 7 } }; },
    };
    return s;
  };
  return { prepare: stmt, runs, reads };
}
const programs = [
  { program_code: "QNFO.OPS", open_issues: 40, high_open: 5, active_projects: 2, stalled_projects: 0, guard_breaches: 0, charter_ok: 1 },
  { program_code: "QNFO.INFRA", open_issues: 12, high_open: 0, active_projects: 1, stalled_projects: 1, guard_breaches: 0, charter_ok: 1 },
];
const prompts = { "program-manager:QNFO.OPS": "You are the QNFO.OPS manager.", "program-manager:QNFO.INFRA": "You are the QNFO.INFRA manager." };
const OK_BUDGET = [{ cap: 95, current: 80 }, { cap: 50, current: 0 }];
const BREACHED = [{ cap: 95, current: 660.09 }, { cap: 50, current: 0 }];

// A fake qnfo-ai service: records each request; plan(model, n) returns a text, null (empty answer) or throws / answers non-ok when it is an Error / a number.
function fakeAi(plan) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, model: body.model, system: body.messages[0].content, user: body.messages[1].content, max_tokens: body.max_tokens });
      const r = plan(body.model, calls.length);
      if (r instanceof Error) throw r;
      if (typeof r === "number") return new Response("{}", { status: r });
      return new Response(JSON.stringify({ choices: [{ message: { content: r } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
}
const mkEnv = (db, ai) => ({ AUDIT: db, SVC_QNFO_AI: ai });
const FREE = X.PSR_FREE_MODEL, PAID = X.PSR_PAID_MODEL;
ok(FREE === "@cf/zai-org/glm-5.3-flash" && PAID === "deepseek-v4-flash", "the free and paid narrative models are the ones this suite assumes", { FREE, PAID });

// 1. The tier.
{
  ok((await X.psrNarrativeTier(mkEnv(fakeDb({ budget: OK_BUDGET, programs }), null))) === "normal", "every cap in range: tier normal");
  ok((await X.psrNarrativeTier(mkEnv(fakeDb({ budget: BREACHED, programs }), null))) === "lean", "one cap breached: tier lean");
  ok((await X.psrNarrativeTier(mkEnv(fakeDb({ budget: [{ cap: 95, current: 95 }], programs }), null))) === "normal", "a spend equal to its cap is not a breach");
  ok((await X.psrNarrativeTier(mkEnv(fakeDb({ budget: [], programs }), null))) === "normal", "no ai_spend row at all: tier normal (nothing is breached)");
  ok((await X.psrNarrativeTier(mkEnv(fakeDb({ budget: undefined, programs }), null))) === "lean", "budget unreadable: tier lean, not silence");
}

// 2. The review at each tier.
async function review(budget, plan, extra) {
  const db = fakeDb(Object.assign({ budget, programs, prompts }, extra || {}));
  const ai = fakeAi(plan);
  const res = await X.psrReview(mkEnv(db, ai), "2026-10-26");
  return { db, ai, res };
}
const noteRows = (db) => db.runs.filter((r) => /INSERT OR REPLACE INTO program_review_notes/.test(r.sql));
{
  const { db, ai, res } = await review(BREACHED, (m) => "Narrative via " + m + ".");
  ok(res.ok === true && res.narrative_tier === "lean" && res.narrative_count === 2, "breached cap: the review runs, tier lean, two narratives", res);
  ok(ai.calls.length === 2, "breached cap: one model call per program (the narrative is not skipped)", ai.calls.length);
  ok(ai.calls.every((c) => c.model === FREE), "breached cap: every call asks the free model only", ai.calls.map((c) => c.model));
  ok(ai.calls.some((c) => c.system === prompts["program-manager:QNFO.OPS"]) && ai.calls.some((c) => c.system === prompts["program-manager:QNFO.INFRA"]), "breached cap: each program's persona prompt is read and sent", ai.calls.map((c) => c.system));
  ok(ai.calls.every((c) => /^Program QNFO\.(OPS|INFRA)\. /.test(c.user)), "breached cap: the user turn is the program's facts", ai.calls.map((c) => c.user.slice(0, 40)));
  ok(/narrative lean \(2 of 2\)/.test(res.summary) && /free model only/.test(res.summary) && !/rule 8/.test(res.summary), "breached cap: the summary names the tier and the count, not rule 8", res.summary);
  const rows = noteRows(db);
  ok(rows.length === 2 && rows.every((r) => r.args.some((a) => typeof a === "string" && /^Narrative via @cf\/zai-org\/glm-5\.3-flash\.$/.test(a))), "breached cap: the narratives are stored on the review notes", rows.map((r) => r.args));
  ok(db.runs.filter((r) => /INTO portfolio_runs/.test(r.sql)).length === 1, "breached cap: one portfolio_runs row is written");
}
{
  const { ai, res } = await review(OK_BUDGET, (m) => "Narrative via " + m + ".");
  ok(res.narrative_tier === "normal" && res.narrative_count === 2 && ai.calls.length === 2, "caps in range: tier normal, one call per program", { res, calls: ai.calls.length });
  ok(ai.calls.every((c) => c.model === FREE), "caps in range: the free model answers first", ai.calls.map((c) => c.model));
  ok(/narrative normal \(2 of 2\)/.test(res.summary) && !/free model only/.test(res.summary), "caps in range: the summary says normal", res.summary);
}
{
  const { ai, res } = await review(OK_BUDGET, (m) => (m === FREE ? null : "paid answer"));
  ok(ai.calls.filter((c) => c.model === PAID).length === 2 && res.narrative_count === 2, "caps in range: an empty free answer falls back to the paid model", ai.calls.map((c) => c.model));
}
{
  const { ai, res } = await review(BREACHED, (m) => (m === FREE ? null : "paid answer"));
  ok(ai.calls.every((c) => c.model === FREE) && res.narrative_count === 0 && res.narrative_tier === "lean", "breached cap: an empty free answer is not retried on the paid model", { models: ai.calls.map((c) => c.model), res });
}
{
  const { ai, res, db } = await review(undefined, () => "ok text");
  ok(res.narrative_tier === "lean" && res.narrative_count === 2 && ai.calls.every((c) => c.model === FREE), "budget unreadable: the narrative runs lean on the free model", { res, models: ai.calls.map((c) => c.model) });
  ok(noteRows(db).length === 2, "budget unreadable: the review is written");
}

// 3. A failing model never breaks the review.
{
  for (const [label, plan] of [["a thrown fetch", () => new Error("network")], ["a 500", () => 500], ["an empty answer", () => null], ["a blank answer", () => "   "]]) {
    let res = null, threw = null;
    try { ({ res } = await review(BREACHED, plan)); } catch (e) { threw = e; }
    ok(!threw && res && res.ok === true && res.narrative_count === 0 && res.notes.length === 2, "breached cap with " + label + ": the review still completes without narratives", { threw: threw && String(threw), res });
    ok(res && /narrative lean \(0 of 2\)/.test(res.summary), "breached cap with " + label + ": the summary says 0 of 2", res && res.summary);
  }
}

// 4. The gate is gone.
{
  const fn = grab("async function psrReview(env, day) {", "\n__name(psrReview");
  ok(!/if \(narrativeAllowed\) \{/.test(src), "worker.js has no `if (narrativeAllowed) {` gate (the closing code-probe)");
  ok(!/narrativeAllowed|psrNarrativeAllowed/.test(src), "no reader of the old boolean is left");
  ok(/psrNarrative\(env, pm, promptText, narrativeTier === "lean"\)/.test(fn), "psrReview passes the lean tier to psrNarrative as freeOnly");
  ok(!/narrative_allowed/.test(fn), "the result no longer carries narrative_allowed");
  ok(/const models = freeOnly \? \[PSR_FREE_MODEL\] : \[PSR_FREE_MODEL, PSR_PAID_MODEL\];/.test(src), "psrNarrative's free-only lever is the one the lean tier uses");
}

// 5. Release bookkeeping.
{
  const v = /var VERSION = "(\d+)\.(\d+)\.(\d+)"/.exec(src);
  ok(v && (+v[1] > 1 || +v[2] > 70 || (+v[2] === 70 && +v[3] >= 3)), "VERSION is at least 1.70.3 (1.71.1 at release)", v && v[0]);
  ok(src.includes("1.71.1 PSR-NARRATIVE-CAP-SOFT-1"), "the release notes retain PSR-NARRATIVE-CAP-SOFT-1");
  ok(src === mirror, "deployed-current.worker.js is identical to worker.js");
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
