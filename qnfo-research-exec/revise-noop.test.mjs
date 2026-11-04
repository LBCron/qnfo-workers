// REVISE-PATCH-RETRY-STRICT-1 and REVISE-NO-UNREVISED-1 offline suite (qnfo-research-exec 0.16.0, agent_issues 2211).
// Runs the worker's real stageRevise against in-memory D1, R2 and AI mocks. Proves: a model answer of "[]" for a non-empty
// fix list is retried once with an instruction that names the HARD fix ids and demands an edit per fix, on the other model
// family, with the cached prefix (preamble + paper) unchanged; when the retry still applies nothing the row is NOT advanced
// to review but handed to markError (re-queued from ground with recover_count+1, the recovery path); and an answer in the
// {"edits": [...]} shape is applied and advances the row.
// Run: node qnfo-research-exec/revise-noop.test.mjs   -> prints "N passed, 0 failed"
import { stageRevise, paperCompleteness } from "./worker.js";

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d !== undefined ? " -- " + JSON.stringify(d).slice(0, 600) : "")); } };

const SENT = "The derivation in this paragraph restates an input value with its source and shows the arithmetic step that follows from it. ";
const sec = (h, n) => "## " + h + "\n\n" + SENT.repeat(n) + "\n\n";
const UNIQUE = "The coupling constant takes the value 0.5000 in the baseline configuration of the model studied here.";
const mkPaper = () => "# A paper about a model\n\n## Abstract\n\nContext, gap, approach, result and practice are stated here in order.\n\n"
  + sec("1. Introduction", 12) + sec("2. Background and Related Work", 12) + sec("3. Methods", 12)
  + "## 4. Analysis\n\n" + UNIQUE + "\n\n" + SENT.repeat(14) + "\n\n"
  + sec("5. Results", 12) + sec("6. Discussion", 12) + sec("7. Practical Implications and Engineering Pathways", 12) + sec("8. Conclusion", 6)
  + "## References\n\n" + Array.from({ length: 8 }, (_, i) => "[" + (i + 1) + "] Work " + (i + 1) + ". arXiv:2401.0000" + i).join("\n") + "\n";
const PAPER = mkPaper();
ok(PAPER.length >= 12000 && paperCompleteness(PAPER).complete, "fixture: a complete paper of at least 12000 chars", { len: PAPER.length, pc: paperCompleteness(PAPER) });

function mkEnv(answer, countOrOpts = 0) {
  const store = { "pipeline/r1/reconciled.md": PAPER, "pipeline/r1/fixes.json": JSON.stringify({ hard: [{ id: "h1", severity: "HARD", claim: "the coupling value", reason: "stated without derivation", fix: "derive or remove" }], soft: [] }), "pipeline/r1/grounding.md": "" };
  const opts = typeof countOrOpts === "object" ? countOrOpts : {};
  const reviseCount = typeof countOrOpts === "number" ? countOrOpts : 0;
  const sqls = [], calls = [];
  const state = { reviseCount, status: "researching", stage: "revise", error: null, claimedAt: "now", recoverCount: 0 };
  const D1 = { prepare(sql) { let args = []; const q = { bind(...x) { args = x; return q; }, async run() {
    sqls.push({ sql, args });
    if (opts.failReviseCount && /SET revise_count/.test(sql)) throw new Error("simulated counter write failure");
    if (/UPDATE research_queue SET status='researching', stage='revise'/.test(sql)) {
      state.status = "researching"; state.stage = "revise"; state.error = args[0]; state.recoverCount++;
    }
    return { meta: { changes: 1 } };
  }, async first() {
    sqls.push({ sql, args });
    if (opts.failReviseCount && /SET revise_count/.test(sql)) throw new Error("simulated counter write failure");
    if (/UPDATE research_queue SET revise_count/.test(sql)) {
      state.reviseCount++;
      if (state.reviseCount >= 2) {
        state.status = "wontfix"; state.stage = "parked"; state.error = "REVISE-NOOP-BOUND-1 revise_count>=2; PARKED-REVISE-NOOP-CEILING-1"; state.claimedAt = null;
      }
      return { revise_count: state.reviseCount, status: state.status, stage: state.stage };
    }
    return null;
  }, async all() { return { results: [] }; } }; return q; } };
  const MIRROR = { async get(k) { const v = store[k]; return v == null ? null : { text: async () => v }; }, async put(k, v) { store[k] = v; } };
  const AI = { async run(model, input) { const prompt = input.messages[0].content; calls.push({ model, prompt }); return { response: typeof answer === "function" ? answer(calls.length, prompt) : answer }; } };
  return { env: { AI, QNFO_AUDIT: D1, MIRROR }, sqls, calls, store, state };
}
const row = { id: "r1", context: "{}", recover_count: 0, source: "idea-hub", stage: "revise", status: "researching" };

// 1. "[]" twice: strict retry, then the recovery path, never an advance.
{
  const t = mkEnv("[]");
  const res = await stageRevise(t.env, Object.assign({}, row));
  // WAI-WIDTH-GOVERNOR-1 (0.25.0): gpt-oss-120b, then glm-5.3-flash with the strict text, then kimi-k2.6 once as the last retry.
  ok(t.calls.length === 3, "the empty answer is retried on the second family and once more on the last resort", t.calls.length);
  ok(t.calls[0].model !== t.calls[1].model, "the retry runs on another model", t.calls.map((c) => c.model));
  ok(/gpt-oss-120b/.test(t.calls[0].model) && /glm-5\.3-flash/.test(t.calls[1].model) && /kimi-k2\.6/.test(t.calls[2].model), "the order is gpt-oss-120b, glm-5.3-flash, kimi-k2.6 (RESEARCH-REVISE-RELIABLE-1) (kimi only last)", t.calls.map((c) => c.model));
  ok(t.calls[2].prompt === t.calls[1].prompt, "the last-resort call carries the same strict text", t.calls[2].prompt.slice(-80));
  ok(t.calls[1].prompt.startsWith(t.calls[0].prompt), "the retry prompt keeps the first prompt (preamble + paper + fixes) as its prefix, so the cached prefix is unchanged");
  const add = t.calls[1].prompt.slice(t.calls[0].prompt.length);
  ok(/STRICT RETRY/.test(add) && /\bh1\b/.test(add) && /at least one edit for EACH/.test(add) && /empty array is a wrong answer/.test(add), "the retry names the fix id and demands one edit per HARD fix", add);
  ok(res && res.ok === false && res.stage === "revise" && res.withheld === "revise-noop" && res.proposed === 0 && Array.isArray(res.fixIds) && res.fixIds[0] === "h1", "the pass fails as revise-noop with the fix ids", res);
  const upd = t.sqls.filter((s) => /UPDATE research_queue/.test(s.sql));
  ok(upd.some((s) => /SET revise_count = COALESCE\(revise_count, 0\) \+ 1/.test(s.sql)), "a revise-noop increments the live diagnostic counter", upd.map((s) => s.sql));
  ok(!upd.some((s) => /stage='review'/.test(s.sql)), "the row is NOT advanced to review", upd.map((s) => s.sql));
  ok(t.state.reviseCount === 1, "the first no-op increments the durable revise_count", t.state);
  // RERUN-ROUTE-1 (0.18.0, agent_issues 2473): a revise failure re-enters once at revise with its findings, not at ground.
  ok(upd.some((s) => /status='researching', stage='revise'/.test(s.sql) && /recover_count=recover_count\+1/.test(s.sql) && s.args[3] === "r1" && /^RERUN-ROUTE-1 revise-once: /.test(s.args[0]) && /not advanced unrevised/.test(s.args[0]) && /h1/.test(s.args[0])), "markError re-enters the row once at revise with recover_count+1 and the reason (the recovery path)", upd.map((s) => [s.sql, s.args]));
  ok(t.store["pipeline/r1/reconciled.md"] === PAPER, "the paper in R2 is untouched");
  const ev = t.sqls.filter((s) => /INSERT INTO cloud_ops_events/.test(s.sql)).map((s) => s.args[2] + ": " + s.args[3]);
  ok(ev.some((e) => /^revise-noop: /.test(e) && /ids=h1/.test(e) && /strict_retry=yes/.test(e) && /revise failed, recover path/.test(e)), "the revise-noop event names the fix ids, the strict retry and the disposition", ev);
}

// 1b. A second non-parse revise-noop hits the explicit revise_count ceiling and parks with its own reason.
{
  const t = mkEnv("[]", 1);
  const second = Object.assign({}, row, { recover_count: 1, revise_count: 1, error: "RERUN-ROUTE-1 revise-once: first no-op" });
  const res = await stageRevise(t.env, second);
  ok(res && res.withheld === "revise-noop", "the second no-op remains withheld", res);
  const park = t.sqls.find((s) => /UPDATE research_queue SET revise_count/.test(s.sql));
  ok(res && res.parked === true && res.revise_count === 2 && park && /PARKED-REVISE-NOOP-CEILING-1/.test(park.sql), "revise_count=2 parks explicitly instead of re-entering the loop", { result: res, sql: park && park.sql, state: t.state });
}

// 1c. A D1 counter failure is logged and does not replace the existing recover-route behavior.
{
  const t = mkEnv("[]", { failReviseCount: true });
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  let res;
  try { res = await stageRevise(t.env, Object.assign({}, row)); } finally { console.error = realError; }
  ok(res && res.withheld === "revise-noop", "a failed counter write does not turn the revise failure into success or throw", res);
  ok(errors.some((e) => /where":"revise-count/.test(e)), "the failed diagnostic write is surfaced", errors);
  ok(t.sqls.some((s) => /status='researching', stage='revise'/.test(s.sql)), "the existing one-retry route remains active when counting is unavailable", t.sqls.map((s) => s.sql));
}

// 2. {"edits": [...]} with a real excerpt: applied, advanced to review.
{
  const t = mkEnv(JSON.stringify({ edits: [{ find: UNIQUE, replace: "The coupling constant takes the value $0.5000$ in the baseline configuration; it follows from the ratio derived in the previous step." }] }));
  const res = await stageRevise(t.env, Object.assign({}, row));
  ok(t.calls.length === 1, "an applied edit needs no retry", t.calls.length);
  ok(res && res.ok === true && res.stage === "revise->review" && res.patch === 1, "the row advances to review with one applied edit", res);
  ok(t.store["pipeline/r1/reconciled.md"].includes("$0.5000$") && !t.store["pipeline/r1/reconciled.md"].includes(UNIQUE), "the edit is in the stored paper");
  ok(t.sqls.some((s) => /stage='review'/.test(s.sql)) && !t.sqls.some((s) => /stage='ground'/.test(s.sql)), "the row goes to review, not to the recovery path");
}

// 3. The first answer has no bracket at all, the fallback model answers "[]": the strict retry still runs on that model.
{
  const t = mkEnv((n) => n === 1 ? "I cannot find a suitable edit." : n === 2 ? "[]" : "[]");
  const res = await stageRevise(t.env, Object.assign({}, row));
  ok(t.calls.length === 4 && /STRICT RETRY/.test(t.calls[2].prompt) && !/STRICT RETRY/.test(t.calls[1].prompt) && /kimi-k2\.6/.test(t.calls[3].model) && !t.calls.slice(0, 3).some((c) => /kimi/.test(c.model)), "no-bracket answer, then '[]', then the strict retry, then kimi-k2.6 as the last resort", t.calls.map((c) => c.model + ":" + c.prompt.slice(-40)));
  ok(res && res.ok === false && res.withheld === "revise-noop", "still no advance when every answer is empty", res);
}

// 4. The strict retry applies an edit: the row advances.
{
  const t = mkEnv((n) => n === 1 ? "[]" : "[{\"find\":" + JSON.stringify(UNIQUE) + ",\"replace\":\"The coupling constant takes the value $0.5000$ in the baseline configuration, as derived above.\"}]");
  const res = await stageRevise(t.env, Object.assign({}, row));
  ok(res && res.ok === true && res.stage === "revise->review" && res.patch === 1 && t.calls.length === 2, "an edit from the strict retry is applied and advances the row", res);
}

// 4b. A six-finding pass with a non-applicable proposed anchor gets the strict retry and applies only a real paper excerpt.
{
  const ids = ["H1", "H3", "H4", "H5", "H6", "H7"];
  const t = mkEnv((n) => n === 1
    ? JSON.stringify([{ find: "This proposed target does not occur in the paper.", replace: "A corrected statement." }])
    : JSON.stringify([{ find: UNIQUE, replace: "The coupling constant takes the value $0.5000$ in the baseline configuration, as derived above." }]));
  t.store["pipeline/r1/fixes.json"] = JSON.stringify({ hard: ids.map((id) => ({ id, severity: "HARD", claim: "claim " + id, reason: "unsupported statement", fix: "correct or qualify" })), soft: [] });
  const res = await stageRevise(t.env, Object.assign({}, row));
  const retry = t.calls[1] && t.calls[1].prompt.slice(t.calls[0].prompt.length);
  ok(t.calls.length === 2 && /STRICT RETRY/.test(retry), "a proposed but inapplicable patch gets one strict retry", t.calls.map((c) => c.model));
  ok(ids.every((id) => retry.includes(id)) && /none applied to the PAPER/.test(retry) && /copied verbatim from PAPER/.test(retry) && /unique, contiguous excerpt/.test(retry), "the strict retry names all six findings and requires an exact applicable excerpt", retry);
  ok(res && res.ok === true && res.stage === "revise->review" && res.patch === 1, "only an applicable strict-retry patch advances to review", res);
  ok(t.store["pipeline/r1/reconciled.md"].includes("$0.5000$") && !t.store["pipeline/r1/reconciled.md"].includes(UNIQUE), "the strict retry's exact paper edit is stored");
}

// 5. A second no-op is parked durably without the recovery route overwriting it.
{
  const t = mkEnv("[]", 1);
  const res = await stageRevise(t.env, Object.assign({}, row, { revise_count: 1 }));
  ok(res && res.ok === false && res.withheld === "revise-noop" && res.parked === true && res.revise_count === 2, "the second no-op is reported as parked", res);
  ok(t.state.reviseCount === 2 && t.state.status === "wontfix" && t.state.stage === "parked" && t.state.claimedAt === null, "the second no-op persists its count and terminal queue state", t.state);
  ok(!t.sqls.some((s) => /status='researching', stage='revise'/.test(s.sql)), "the parked no-op is not requeued by markError");
  ok(!t.sqls.some((s) => /stage='review'/.test(s.sql)), "a paper with unresolved HARD fixes is never advanced to review");
}

// 6. An unreadable review is re-reviewed, not counted as an unapplied patch.
{
  const t = mkEnv("[]");
  t.store["pipeline/r1/fixes.json"] = JSON.stringify([{ id: "review-parse", severity: "HARD", claim: "review output", reason: "unparseable review output", fix: "re-run review" }]);
  const res = await stageRevise(t.env, Object.assign({}, row));
  ok(res && res.rereview === true && res.stage === "revise->review", "a parse-only finding retries review", res);
  ok(!t.sqls.some((s) => /SET revise_count/.test(s.sql)), "a review parser failure does not consume the no-op revise ceiling", t.sqls.map((s) => s.sql));
  const events = t.sqls.filter((s) => /INSERT INTO cloud_ops_events/.test(s.sql)).map((s) => s.args[2]);
  ok(events.includes("revise-review-parse") && !events.includes("revise-noop"), "parse failures have a distinct event and do not inflate revise-noop telemetry", events);
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
