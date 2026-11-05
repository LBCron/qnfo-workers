// EK-3 offline suite (personal-companion 1.44.17, roadmap row 1750, agent_issues 1000714, charter pillar: reach, ENSEMBLE-POLICY-1).
// Until 1.44.17 the even-keel reviewer was chosen from a model family called "ensemble-policy-1" that no model has, so balanceCheck answered
// "unavailable" for every piece and companion_audits.balance_score is NULL on every row. Proves: the reviewer is found (a family other than the
// writer's, a fresh one when there is one); it is asked only after the grounding check and both fact-check judges pass; a score under the bar
// stops the piece at stage "balance" with a "one-sided:" problem; an unreadable or failing reviewer is replaced once and then fails open with the
// reason recorded; the audit of published pieces does not run it; the score reaches companion_audits and quality_json; the writer is told the bar;
// the revision of a one-sided draft carries the even-keel note, not the fact-revision text.
// Run: node personal-companion/even-keel.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { importWorker } from "./_harness-import-worker.mjs";
const IMPORT = 'import { WorkflowEntrypoint } from "cloudflare:workers";';
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mod = await importWorker(() => (src.replace(IMPORT, "var WorkflowEntrypoint = class {};") + "\n//" + Math.random()), new URL("./", import.meta.url));
const V = mod.__verify;
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 600) : "")); } };

const FACT_PASS = '{"unsupported":[],"verdict":"pass"}';
const FACT_FAIL = '{"unsupported":["FACT: The Alpha Subject recorded 99 measurements"],"verdict":"fail"}';
const BAL = (o, w, a, r) => JSON.stringify({ opposing: o, wording: w, attribution: a, reason: r || "ok" });
const WRITER = "deepseek-chat";
const ground = "Drift in the readings. The Alpha Subject recorded 14 measurements in 1987 at the Beta Station.";
const text = "# Drift in the readings\n\nThe Alpha Subject recorded 14 measurements in 1987 at the Beta Station.";

// A scripted AI binding. `balance` is a reply (string), a function of the model id, or an Error to throw; fact-check calls get `fact`.
function world(opts) {
  const calls = [];
  const AI = {
    run: async (model, input) => {
      const prompt = String(input && input.messages && input.messages[0] && input.messages[0].content || "");
      const isBalance = /even-keel reviewer/.test(prompt);
      calls.push({ model, kind: isBalance ? "balance" : "fact" });
      let reply = isBalance ? opts.balance : opts.fact;
      if (typeof reply === "function") reply = reply(model);
      if (reply instanceof Error) throw reply;
      return { response: reply };
    }
  };
  return { env: { AI }, calls };
}
const famOf = V.familyOf;

// the pool: every model has a known family, so the reviewer lookup cannot come back empty because of a family name
ok(V.REVIEW_POOL.every((id) => !String(famOf(id)).startsWith("unknown")), "every model in the reviewer pool has a known family", V.REVIEW_POOL.map(famOf));
ok(!/var BALANCE_FAMILY/.test(src) && !/=== BALANCE_FAMILY/.test(src), "the filter on a family name no model has is gone from the worker");

// (1) the reviewer is found and is not the writer's family
{
  const w = world({ balance: BAL(9, 9, 9, "fine"), fact: FACT_PASS });
  const r = await V.balanceCheck(w.env, text, WRITER, "seed-1", []);
  ok(r.unavailable === false && r.ok === true && r.score === 90 && r.family !== famOf(WRITER) && w.calls.length === 1 && w.calls[0].kind === "balance", "a reviewer is found, scores 90 and is not the writer's family", { r, calls: w.calls });
}
// (2) a fresh family reads it when one is left
{
  const judged = [{ model: "@cf/nvidia/nemotron-3-120b-a12b", family: "nvidia" }, { model: "@cf/openai/gpt-oss-120b", family: "openai" }];
  const fams = new Set();
  for (let i = 0; i < 6; i++) {
    const w = world({ balance: BAL(9, 9, 9), fact: FACT_PASS });
    const r = await V.balanceCheck(w.env, text, WRITER, "seed-" + i, judged);
    fams.add(r.family);
  }
  ok([...fams].every((f) => f === "moonshot" || f === "zai"), "with nvidia and openai already judging, the reviewer is moonshot or zai", [...fams]);
  const only = await V.balanceCheck(world({ balance: BAL(9, 9, 9) }).env, text, WRITER, "s", [{ family: "nvidia" }, { family: "openai" }, { family: "moonshot" }, { family: "zai" }]);
  ok(only.unavailable === false, "when every family has judged, a non-writer family is still asked", only);
}
// (3) a score under the bar stops the piece at stage "balance"
{
  const w = world({ balance: BAL(2, 2, 1, "The third section presents the policy as settled."), fact: FACT_PASS });
  const vr = await V.verifyPiece(w.env, text, ground, WRITER, "seed-3", {});
  ok(vr.ok === false && vr.stage === "balance" && /^one-sided: The third section presents the policy as settled\./.test(vr.problems[0]) && vr.balance.score === 18 && vr.unavailable === false, "a one-sided draft stops at stage balance with the reviewer's reason", vr);
  ok(vr.judges.some((j) => j.verdict === "balance-fail"), "the reviewer is listed among the judges");
  // order: both fact-check judges first, the even-keel reviewer last
  const kinds = w.calls.map((c) => c.kind);
  ok(kinds.slice(0, 2).every((k) => k === "fact") && kinds[kinds.length - 1] === "balance" && kinds.filter((k) => k === "balance").length === 1, "the fact-check runs first and the even-keel reviewer is asked once, last", kinds);
}
// (4) a score at the bar passes and is carried in the result
{
  const w = world({ balance: BAL(8, 9, 9, "fine"), fact: FACT_PASS });
  const vr = await V.verifyPiece(w.env, text, ground, WRITER, "seed-4", {});
  ok(vr.ok === true && vr.stage === "pass" && vr.balance && vr.balance.ok === true && vr.balance.score === 85 && vr.balance.model, "a balanced draft passes with its score and model", vr.balance);
  const exact = await V.verifyPiece(world({ balance: '{"score":70}', fact: FACT_PASS }).env, text, ground, WRITER, "seed-4b", {});
  ok(exact.ok === true && exact.balance.score === 70, "a score of exactly 70 passes", exact.balance);
  const below = await V.verifyPiece(world({ balance: '{"score":69}', fact: FACT_PASS }).env, text, ground, WRITER, "seed-4c", {});
  ok(below.ok === false && below.stage === "balance", "a score of 69 does not", below.stage);
}
// (5) no usable reply from two reviewers: the first is replaced once, then the check fails open and says why
{
  const w = world({ balance: new Error("model down"), fact: FACT_PASS });
  const vr = await V.verifyPiece(w.env, text, ground, WRITER, "seed-5", {});
  const bcalls = w.calls.filter((c) => c.kind === "balance");
  ok(vr.ok === true && vr.balance.unavailable === true && /no balance score from 2 reviewer/.test(vr.balance.reason) && bcalls.length === 2 && bcalls[0].model !== bcalls[1].model, "two failing reviewers: asked once each, fail open with the reason", { calls: bcalls.length, reason: vr.balance && vr.balance.reason });
  let seen = null;
  for (let i = 0; i < 8 && !(seen && seen.second); i++) {
    const wi = world({ balance: (m) => (/kimi/.test(m) ? BAL(9, 9, 9) : "no json at all"), fact: FACT_PASS });
    const r = await V.balanceCheck(wi.env, text, WRITER, "seed-5-" + i, []);
    const bc = wi.calls.filter((c) => c.kind === "balance");
    if (bc.length === 2 && !r.unavailable) seen = { second: true, r };
  }
  ok(seen && seen.r.unavailable === false && /kimi/.test(seen.r.model), "an unreadable reply from the first reviewer is replaced by the second", seen);
}
// (6) the check is never spent on a draft the fact-check rejects, and the audit of published pieces does not run it
{
  const w = world({ balance: BAL(9, 9, 9), fact: FACT_FAIL });
  const vr = await V.verifyPiece(w.env, text, ground, WRITER, "seed-6", {});
  ok(vr.ok === false && vr.stage === "factcheck" && w.calls.every((c) => c.kind === "fact") && vr.balance === null, "a fact-check failure stops before any even-keel call", { stage: vr.stage, calls: w.calls.length });
  const w2 = world({ balance: BAL(0, 0, 0), fact: FACT_PASS });
  const va = await V.verifyPiece(w2.env, text, ground, WRITER, "audit:x", { noBalance: true });
  ok(va.ok === true && va.balance === null && w2.calls.every((c) => c.kind === "fact"), "noBalance (the audit of published pieces) skips the even-keel call", { ok: va.ok, calls: w2.calls.length });
  ok(/verifyPiece\(env, pieceText\(p\), p\.ground_text, "", "audit:" \+ p\.slug, \{ noBalance: true \}\)/.test(src), "auditPublished passes noBalance, so a one-sided piece is never retracted as inaccurate");
}
// (7) the score is stored: companion_audits.balance_score and the quality record
{
  const rows = [];
  const db = { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { rows.push({ sql, a }); return {}; }, all: async () => ({ results: [] }), first: async () => null }), run: async () => { rows.push({ sql, a: [] }); return {}; }, all: async () => ({ results: [] }), first: async () => null }) };
  await V.recordAudit({ PERSONAL: db }, "2026-11-05-essay-abc", "pass", "pass", { judges: [{ model: "m1" }, { model: "m2" }], problems: [], balance: { score: 88, ok: true } });
  const ins = rows.find((r) => /INSERT OR REPLACE INTO companion_audits/.test(r.sql));
  ok(ins && ins.a[6] === 88 && ins.a[3] === "m1,m2", "recordAudit stores balance_score 88 beside the judges", ins && ins.a);
  ok(/q\.balance = afBalanceRecord\(vr\.balance\);/.test(src) && /"even-keel: "/.test(src), "generate stores the record in quality_json and logs the stage");
}
// (8) the writer is told the bar; a one-sided draft is revised with the even-keel note
{
  ok(/^- Even keel: a disputed claim is stated as the position of the party that holds it/m.test(V.prompts.P_STYLE) && !/according to critics/.test(V.prompts.P_STYLE), "the writer prompt carries the even-keel rule");
  ok(/NL \+ \(revision\.note \|\| factRevisionPrompt\(revision\.problems\)\) \+ NL \+ NL \+ "--- DRAFT TO REVISE ---"/.test(src), "composePiece uses the revision note when there is one");
  ok(/note: vr\.stage === "balance" \? afBalanceRevisionNote\(vr\.balance && vr\.balance\.reason\) : ""/.test(src), "a one-sided draft is revised with the even-keel note");
  ok(/feedback = vr\.stage === "balance" \? afBalanceRetryFeedback\(vr\.balance && vr\.balance\.reason\)/.test(src), "a one-sided attempt that cannot be revised retries with the even-keel feedback, not the fact-check text");
  const shared = readFileSync(new URL("../_shared/analysis-form.js", import.meta.url), "utf8");
  ok(/EVEN-KEEL REVISION/.test(shared) && !/Every item in the list is a claim the source material does not support/.test(shared.slice(shared.indexOf("function afBalanceRevisionNote"), shared.indexOf("function afBalanceRetryFeedback"))), "the even-keel revision note does not say the items are unsupported claims");
}

// (9) the check is measured: scored share and hold share, counts only, written to the two registered metrics each tick
{
  const writes = [];
  // the five newest passes: 4 of 5 scored; in the 7 days: 8 scored passes and 2 attempts held
  const first = async (sql) => (/FROM \(SELECT balance_score/.test(sql) ? { n: 5, scored: 4 } : /FROM companion_audits/.test(sql) ? { n: 8 } : /FROM companion_runs/.test(sql) ? { held: 2 } : null);
  const personal = { prepare: (sql) => ({ bind: () => ({ first: () => first(sql) }), first: () => first(sql) }) };
  const audit = { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { writes.push({ sql, a }); return {}; } }) }) };
  const now = Date.parse("2026-11-05T12:00:00Z");
  const out = await V.writeBalanceMetrics({ PERSONAL: personal, AUDIT: audit }, now);
  ok(out && out.scoredShare === 0.8 && out.holdShare === 0.2, "4 of the newest 5 passes scored is 0.8; 2 held beside 8 scored in the week is 0.2", out);
  const byMetric = Object.fromEntries(writes.map((w) => [w.a[0], w.a[1]]));
  ok(byMetric.companion_balance_scored_share_last5 === "0.8" && byMetric.companion_balance_hold_share_7d === "0.2" && writes.every((w) => /UPDATE metric_registry SET last_value/.test(w.sql)), "both metrics are written as UPDATEs of registered rows", writes.map((w) => w.a));
  const zero = async () => ({ n: 0, scored: 0, held: 0 });
  const none = await V.writeBalanceMetrics({ PERSONAL: { prepare: () => ({ bind: () => ({ first: zero }), first: zero }) }, AUDIT: audit }, now);
  ok(none && none.scoredShare === null && none.holdShare === null, "no passes, no share (not zero)", none);
  ok(await V.writeBalanceMetrics({ PERSONAL: { prepare: () => { throw new Error("db down"); } }, AUDIT: audit }, now) === null, "a read failure is logged and returns null, never throws into the stall detector");
  ok(/await writeBalanceMetrics\(env, now\); await writeSourceMetrics\(env, now\);\n  var open = await env\.AUDIT/.test(src), "the stall detector writes them every hourly tick");
}

console.log("even-keel: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
