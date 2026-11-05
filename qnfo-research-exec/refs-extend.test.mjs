// REVISE-REFS-EXTEND-1 (qnfo-research-exec 0.30.0, agent_issues 100326, 100284, 100205): a revise patch whose ONLY fault is that it takes
// the cited references under the reference floor is applied and routed to the floor extension (stageComplete, extendFor "floor") instead
// of refused. The char floor and the cut limit are unchanged, alone or together with the reference clause. Runs the worker's real
// stageRevise, stageComplete and stageReview, reviseShrinkReasons / reviseRefsOnly / reviseShrinkRefusal against in-memory R2, AI and D1
// mocks (node:sqlite for the loop-bound driver). Offline, no network.
// Measured before the change (2026-10-19 14:43Z to 2026-10-20 09:16Z): 373 of 384 revise-shrink-refused events were the reference
// clause ("drops the cited references 8 -> 6 under the floor of 8"), 11 the char floor, none the cut limit; 263 revise-noop in 24 h.
// The route does not depend on ops_config research_revise_shrink_guard: it holds under the guard and under measure (the live value when this
// shipped, REVISE-GUARD-MEASURE-1, section 2f); measure keeps its meaning for the char-floor and cut-limit clauses.
// Run: node qnfo-research-exec/refs-extend.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import * as W from "./worker.js";

const { stageRevise, stageReview, stageComplete, reviseShrinkRefusal, floorShortfall, paperCompleteness, FLOOR_EXTEND_TARGET } = W;
const reviseRefsOnly = W.reviseRefsOnly, reviseShrinkReasons = W.reviseShrinkReasons;

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d !== undefined ? " -- " + JSON.stringify(d).slice(0, 700) : "")); } };
globalThis.setTimeout = (fn) => { fn(); return 0; };

// ---- fixtures: a complete paper that cites 9 of 12 bibliography entries (the reference floor is min(8, 12) = 8) ----
const S = (i) => "Step " + i + " of the derivation fixes the intermediate value " + (i * 7) + " from the stated inputs and carries it forward with the arithmetic shown. ";
const C = (cite) => "Prior work [" + cite + "] supplies the comparison used in this step. ";
const run = (from, n, cite) => Array.from({ length: n }, (_, k) => S(from + k)).join("") + (cite ? C(cite) : "");
const sec = (h, from, n, cite) => "## " + h + "\n\n" + run(from, n, cite) + "\n\n";
const BIB = 12;
const grounding = "INPUT BLOCK\n\n## Bibliography\n" + Array.from({ length: BIB }, (_, i) => "[" + (i + 1) + "] arXiv:2401.0000" + (i + 1) + " | Work number " + (i + 1)).join("\n") + "\n";
const refList = (nums) => "## References\n\n" + nums.map((k) => "[" + k + "] Work number " + k + ". arXiv:2401.0000" + k).join("\n") + "\n";
function mkPaper(n, appendix) {
  return "# A paper about a model\n\n## Abstract\n\nContext, gap, approach, result and practice are stated here in order.\n\n"
    + sec("1. Introduction", 1, n, 1) + sec("2. Background and Related Work", 1000, n, 2) + sec("3. Methods", 2000, n, 3) + sec("4. Analysis", 3000, n, 4)
    + sec("5. Results", 4000, n, 5) + sec("6. Discussion", 5000, n, 6) + sec("7. Practical Implications and Engineering Pathways", 6000, n, 7)
    + sec("8. Conclusion", 7000, Math.max(3, Math.floor(n / 4)), "8, 9") + refList([1, 2, 3, 4, 5, 6, 7, 8, 9]) + (appendix || "");
}
const BIGP = mkPaper(41); // about 41k chars
let NEAR = ""; // just above the 20,000-char floor
for (let n = 20; n < 60; n++) { NEAR = mkPaper(n); if (NEAR.length >= 20500) break; }
ok(BIGP.length > 38000 && BIGP.length < 46000 && paperCompleteness(BIGP).complete, "fixture: a complete paper of about 41k chars citing 9 entries", BIGP.length);
ok(NEAR.length >= 20500 && NEAR.length < 23500 && paperCompleteness(NEAR).complete, "fixture: a complete paper just above the 20,000-char floor", NEAR.length);

const row = (extra) => Object.assign({ id: "r1", context: "{}", recover_count: 0, source: "idea-hub", stage: "revise", status: "researching" }, extra || {});
const patchOf = (paper, edits) => edits.reduce((p, e) => p.replace(e.find, e.replace), paper);
const startOf = (paper, heading) => paper.indexOf("## " + heading);

// The edits a reviser returns for "the Conclusion rests on [8, 9], which do not support it: delete the claim and its citation".
const EDIT_89 = { find: C("8, 9"), replace: "" };
ok(BIGP.split(EDIT_89.find).length === 2, "fixture: the [8, 9] sentence occurs once");
const REFS_ONLY = patchOf(BIGP, [EDIT_89]);
// A 25% block (sections 2 and most of 3) plus the [8, 9] sentence: the cut limit and the reference clause both break.
const BLOCK = BIGP.slice(startOf(BIGP, "2. Background"), startOf(BIGP, "2. Background") + Math.floor(BIGP.length * 0.25));
const CUT_AND_REFS = patchOf(BIGP, [{ find: BLOCK, replace: "" }, EDIT_89]);
// A paper just above the floor: dropping section 2 and the [8, 9] sentence leaves it under the floor with 6 cited references.
const SEC2 = NEAR.slice(startOf(NEAR, "2. Background"), startOf(NEAR, "3. Methods"));
const FLOOR_AND_REFS = patchOf(NEAR, [{ find: SEC2, replace: "" }, EDIT_89]);
// The same block cut but its citations kept in the replacement: only the cut limit breaks.
const keptCites = (BLOCK.match(/Prior work \[[0-9, ]+\] supplies the comparison used in this step\. /g) || []).join("");
const CUT_ONLY = patchOf(BIGP, [{ find: BLOCK, replace: keptCites }]);
// Every body citation deleted: no bibliography citation is left.
const NO_CITES = patchOf(BIGP, [1, 2, 3, 4, 5, 6, 7].map((k) => ({ find: C(k), replace: "" })).concat([EDIT_89]));

// ---- 1. the decision: which clause a patch breaks ----
ok(typeof reviseRefsOnly === "function" && typeof reviseShrinkReasons === "function", "the worker exports reviseShrinkReasons and reviseRefsOnly");
if (typeof reviseRefsOnly === "function") {
  const ro = reviseRefsOnly(row(), BIGP, REFS_ONLY, grounding);
  ok(ro && ro.refsBefore === 9 && ro.refsAfter === 7 && ro.refsFloor === 8 && ro.refs === "drops the cited references 9 -> 7 under the floor of 8", "9 -> 7 under the floor of 8 is a reference-only patch", ro);
  ok(reviseRefsOnly(row(), BIGP, BIGP.replace(S(5), ""), grounding) === null, "a one-sentence removal breaks no clause");
  const r1 = reviseShrinkReasons(row(), BIGP, CUT_AND_REFS, grounding);
  ok(/^cuts 2\d% of the paper in one pass/.test(r1.cut) && r1.refs && !r1.floor && r1.refsAfter < 8 && CUT_AND_REFS.length > 20000, "fixture: the cut-limit + references patch breaks both clauses and stays above the floor", r1);
  ok(reviseRefsOnly(row(), BIGP, CUT_AND_REFS, grounding) === null, "a patch that breaks the cut limit AND the reference clause is not a reference-only patch");
  const r2 = reviseShrinkReasons(row(), NEAR, FLOOR_AND_REFS, grounding);
  ok(/^below the 20000-char floor$/.test(r2.floor) && r2.refs && !r2.cut, "fixture: the char-floor + references patch breaks both clauses", r2);
  ok(reviseRefsOnly(row(), NEAR, FLOOR_AND_REFS, grounding) === null, "a patch that breaks the char floor AND the reference clause is not a reference-only patch");
  const r3 = reviseShrinkReasons(row(), BIGP, CUT_ONLY, grounding);
  ok(/^cuts 2\d%/.test(r3.cut) && !r3.refs && !r3.floor && reviseRefsOnly(row(), BIGP, CUT_ONLY, grounding) === null, "a cut-limit-only patch is not a reference-only patch", r3);
  const r4 = reviseShrinkReasons(row(), BIGP, NO_CITES, grounding);
  ok(r4.refs && r4.refsAfter === 0 && reviseRefsOnly(row(), BIGP, NO_CITES, grounding) === null, "a patch that leaves no bibliography citation in the body stays refused (the renderer would keep the old list)", r4);
}
// reviseShrinkRefusal keeps its three strings and their order.
ok(reviseShrinkRefusal(row(), BIGP, REFS_ONLY, grounding) === "drops the cited references 9 -> 7 under the floor of 8", "reviseShrinkRefusal: the reference string is unchanged", reviseShrinkRefusal(row(), BIGP, REFS_ONLY, grounding));
ok(/^cuts 2\d% of the paper in one pass \(limit 20%\)$/.test(reviseShrinkRefusal(row(), BIGP, CUT_AND_REFS, grounding)), "reviseShrinkRefusal: the cut string wins over the reference string");
ok(reviseShrinkRefusal(row(), NEAR, FLOOR_AND_REFS, grounding) === "below the 20000-char floor", "reviseShrinkRefusal: the char-floor string wins over the reference string");
ok(reviseShrinkRefusal(row(), BIGP, BIGP.replace(S(5), ""), grounding) === "", "reviseShrinkRefusal: no violation is the empty string");

// ---- 2. stageRevise end to end ----
function mkEnv(answerFn, opts) {
  const o = opts || {};
  const store = { "pipeline/r1/reconciled.md": o.paper || BIGP, "pipeline/r1/grounding.md": grounding, "pipeline/r1/fixes.json": JSON.stringify({ hard: [{ id: o.hardId || "h1", severity: "HARD", claim: "the Conclusion rests on [8, 9]", reason: "the cited works do not support the claim", fix: "delete the unsupported claim and its citation" }], soft: [] }) };
  const sqls = [], calls = [];
  const D1 = { prepare(sql) { let args = []; const q = { bind(...x) { args = x; return q; }, async run() { sqls.push({ sql, args }); return { meta: { changes: 1 } }; }, async first() { if (/research_lean_ensemble/.test(sql)) return { value: "off" }; if (/FROM fleet_budget/.test(sql)) return { n: 0 }; if (/FROM ops_config/.test(sql) && o.flags && o.flags[args[0]] !== undefined) return { value: o.flags[args[0]] }; return null; }, async all() { return { results: [] }; } }; return q; } };
  const MIRROR = { async get(k) { const v = store[k]; return v == null ? null : { text: async () => v }; }, async put(k, v) { store[k] = v; } };
  const AI = { async run(model, input) { const prompt = input.messages[0].content; calls.push({ model, prompt }); return { response: answerFn(calls.length, prompt) }; } };
  return { env: { AI, QNFO_AUDIT: D1, MIRROR }, sqls, calls, store };
}
const events = (t) => t.sqls.filter((s) => /INSERT INTO cloud_ops_events/.test(s.sql)).map((s) => ({ kind: s.args[2], text: s.args[3], status: s.args[6] }));
const stageUpdates = (t) => t.sqls.filter((s) => /UPDATE research_queue SET stage=/.test(s.sql)).map((s) => ({ sql: s.sql, ctx: s.args[0] ? JSON.parse(s.args[0]) : null }));
const raw = (edits) => JSON.stringify(edits);

// 2a. A reference-only patch is applied by the first model, marked, logged, and routed to the floor extension. The review's HARD id is
// not a gate id (h1), so the old _floorNext would not have fired; the extension route does not depend on it.
{
  const t = mkEnv(() => raw([EDIT_89]));
  const res = await stageRevise(t.env, row());
  const stored = t.store["pipeline/r1/reconciled.md"];
  ok(t.calls.length === 1, "one model call: the patch is applied, not retried on two more models", t.calls.length);
  ok(res && res.ok === true && res.patch === 1 && res.cycle === 1 && res.extendFor === "floor" && res.refsShort === true, "the pass succeeds and reports the floor extension", res);
  ok(stored === REFS_ONLY && !stored.includes(C("8, 9")), "the patched paper is stored", stored.length);
  const up = stageUpdates(t);
  ok(up.length === 1 && /stage='complete'/.test(up[0].sql) && up[0].ctx.extendFor === "floor" && up[0].ctx.cycles === 1 && up[0].ctx.patch === 1, "the row goes to stage complete with extendFor floor and the cycle counted", up);
  const ev = events(t);
  const rb = ev.filter((e) => e.kind === "revise-refs-below-floor");
  ok(rb.length === 1 && rb[0].status === "warn" && /refs 9->7 floor=8/.test(rb[0].text) && /chars \d+->\d+/.test(rb[0].text) && /drops the cited references 9 -> 7 under the floor of 8/.test(rb[0].text) && /routed to the floor extension/.test(rb[0].text), "revise-refs-below-floor is logged (warn) with the counts and the floor", rb);
  ok(!ev.some((e) => e.kind === "revise-shrink-refused") && !ev.some((e) => e.kind === "revise-noop"), "no refusal and no revise-noop");
  ok(ev.some((e) => e.kind === "floor-route" && /revise->complete refs 9->7 floor=8/.test(e.text) && /cycle=1/.test(e.text)), "a floor-route event records the route", ev.map((e) => e.kind));
  // The D1 reads of migrations/2026-10-20-revise-refs-extend.sql (issue-100329, fm-revise-refs-extend-unrestored) join this event to the floor-extend of the
  // same row on the text before the first space, so both events must open with "row=<id> ".
  ok(rb[0].text.split(" ")[0] === "row=r1" && rb[0].text.split(" ")[1].startsWith("model="), "the revise-refs-below-floor text opens with 'row=<id> model=' (the key the closing read joins on)", rb[0].text.slice(0, 60));
  ok(ev.some((e) => e.kind === "revise-patch" && e.status === "ok" && /applied=1/.test(e.text) && !/refused=/.test(e.text)), "revise-patch records applied=1 and no refusal");
  const sh = floorShortfall(row(), stored, grounding, false);
  ok(sh.need && sh.refs && sh.uncited.length === 5, "floorShortfall on the patched paper names the references and 5 uncited entries", sh);
}

// 2b. The floor extension, not the refusal, restores the count: stageComplete reads that row and cites the uncited entries.
{
  const EXT = "## Extended Derivations and Worked Examples\n\n" + run(900, 20) + C(8) + C(9) + C(10) + C(11) + C(12) + run(950, 6);
  const t = mkEnv((n, prompt) => /=== TASK: EXTEND ===/.test(prompt) ? EXT : "[]", { paper: REFS_ONLY });
  const res = await stageComplete(t.env, row({ stage: "complete", context: JSON.stringify({ cycles: 1, patch: 1, verifyPass: 0, extendFor: "floor" }) }));
  const out = t.store["pipeline/r1/reconciled.md"];
  const sh = floorShortfall(row(), out, grounding, false);
  ok(res && res.ok === true && res.stage === "complete->review" && res.floor === "ok", "complete extends the patched paper and advances it to review", res);
  ok(!sh.need && W.finalGates(out, { bibCount: BIB, minChars: 20000, structure: true }).ok, "the extended paper passes the length and reference gates", W.finalGates(out, { bibCount: BIB, minChars: 20000, structure: true }).reason);
  ok(t.calls.length === 1 && /NOT YET CITED: \[8\], \[9\], \[10\], \[11\], \[12\]/.test(t.calls[0].prompt), "the EXTEND prompt names the uncited entries", t.calls[0].prompt.slice(-300));
  const up = stageUpdates(t);
  ok(up.length === 1 && /stage='review'/.test(up[0].sql) && up[0].ctx.cycles === 1 && up[0].ctx.extendFor === undefined, "the review context keeps the cycle count and drops the floor fields", up);
  ok(events(t).some((e) => e.kind === "floor-extend" && /round=1/.test(e.text)), "a floor-extend event follows on the same row");
  ok(events(t).filter((e) => e.kind === "floor-extend").every((e) => e.text.split(" ")[0] === "row=r1" && e.text.split(" ")[1].startsWith("round=")), "and its text opens with 'row=<id> round=' (the same key as the revise-refs-below-floor event)");
}

// 2c. When the renderer already restores the references (the appendix after the list cites [8] and [9]) no extension is needed: the
// patch is applied and the paper goes to review as for any applied patch.
{
  const APPX = "\n## Appendix A. Notes\n\nThe comparison in the Conclusion is set out in [8] and [9].\n";
  const withAppendix = mkPaper(41, APPX);
  const t = mkEnv(() => raw([EDIT_89]), { paper: withAppendix });
  const patched = patchOf(withAppendix, [EDIT_89]);
  ok(reviseShrinkReasons && reviseShrinkReasons(row(), withAppendix, patched, grounding).refs !== "" && !floorShortfall(row(), patched, grounding, false).need, "fixture: the body drops to 7 cited references but the rendered list keeps 9", floorShortfall(row(), patched, grounding, false));
  const res = await stageRevise(t.env, row());
  const up = stageUpdates(t);
  ok(res && res.ok === true && res.patch === 1 && res.extendFor === undefined && up.length === 1 && /stage='review'/.test(up[0].sql) && up[0].ctx.extendFor === undefined, "the paper goes to review, not to the extension", { res, up });
  const ev = events(t);
  ok(ev.some((e) => e.kind === "revise-refs-below-floor" && /no extension needed/.test(e.text)) && !ev.some((e) => e.kind === "floor-route") && !ev.some((e) => e.kind === "revise-shrink-refused"), "the event says no extension is needed", ev.map((e) => e.kind + ":" + e.text.slice(-60)));
}

// 2d. The other two clauses are unchanged: refused by every model, the pass fails as revise-noop, nothing is stored.
for (const [name, edits, paper, why] of [
  ["the char floor", [{ find: BIGP.slice(startOf(BIGP, "2. Background"), startOf(BIGP, "7. Practical")), replace: "" }], BIGP, /^below the 20000-char floor$/],
  ["the cut limit", [{ find: BLOCK, replace: keptCites }], BIGP, /^cuts 2\d% of the paper in one pass \(limit 20%\)$/],
  ["the cut limit together with the reference clause", [{ find: BLOCK, replace: "" }, EDIT_89], BIGP, /^cuts 2\d% of the paper in one pass \(limit 20%\)$/],
  ["the char floor together with the reference clause", [{ find: SEC2, replace: "" }, EDIT_89], NEAR, /^below the 20000-char floor$/],
  ["a patch that leaves no citation", [1, 2, 3, 4, 5, 6, 7].map((k) => ({ find: C(k), replace: "" })).concat([EDIT_89]), BIGP, /^drops the cited references 9 -> 0 under the floor of 8$/]
]) {
  const t = mkEnv(() => raw(edits), { paper });
  const res = await stageRevise(t.env, row());
  const ev = events(t);
  const refused = ev.filter((e) => e.kind === "revise-shrink-refused");
  ok(t.calls.length === 3 && refused.length === 3, name + ": three answers, all refused", { calls: t.calls.length, refused: refused.length, ev: ev.map((e) => e.kind) });
  ok(refused.length > 0 && refused.every((e) => why.test(e.text.split(": ").slice(1).join(": ")) && e.status === "warn"), name + ": the refusal text is unchanged", refused.map((e) => e.text.slice(-120)));
  ok(res && res.ok === false && res.withheld === "revise-noop" && t.store["pipeline/r1/reconciled.md"] === paper, name + ": the pass fails as revise-noop and the stored paper is untouched", res);
  ok(!ev.some((e) => e.kind === "revise-refs-below-floor") && stageUpdates(t).every((u) => !/stage='complete'/.test(u.sql) && !/stage='review'/.test(u.sql)), name + ": no refs-below-floor event and no advance", ev.map((e) => e.kind));
}

// 2e. The first model's destructive answer is refused (cut limit); the second model's reference-only answer is applied and routed.
{
  const t = mkEnv((n) => n === 1 ? raw([{ find: BLOCK, replace: "" }]) : raw([EDIT_89]));
  const res = await stageRevise(t.env, row());
  ok(t.calls.length === 2 && res.ok === true && res.extendFor === "floor" && t.store["pipeline/r1/reconciled.md"] === REFS_ONLY, "a refused cut then a reference-only edit on the second model: applied and routed", { calls: t.calls.length, res });
  ok(events(t).filter((e) => e.kind === "revise-shrink-refused").length === 1 && events(t).filter((e) => e.kind === "revise-refs-below-floor").length === 1, "one refusal and one refs-below-floor event");
}

// 2f. The switches. research_revise_refs_extend = off and research_floor_extend = off restore the refusal of the reference clause.
// research_revise_shrink_guard = measure (the live value when this shipped, REVISE-GUARD-MEASURE-1) does NOT disable the route: a
// reference-only patch is routed to the floor extension under measure as under the guard, and measure keeps its old meaning (apply and
// log "mode=measure, applied") for a patch that breaks the char floor or the cut limit.
for (const [name, flags] of [["research_revise_refs_extend = off", { research_revise_refs_extend: "off" }], ["research_floor_extend = off", { research_floor_extend: "off" }]]) {
  const t = mkEnv(() => raw([EDIT_89]), { flags });
  const res = await stageRevise(t.env, row());
  const ev = events(t);
  ok(t.calls.length === 3 && res.ok === false && res.withheld === "revise-noop" && t.store["pipeline/r1/reconciled.md"] === BIGP, name + ": the reference clause refuses as before", { calls: t.calls.length, res });
  ok(ev.filter((e) => e.kind === "revise-shrink-refused" && /drops the cited references 9 -> 7 under the floor of 8/.test(e.text)).length === 3 && ev.some((e) => e.kind === "revise-noop" && /shrink refused: drops the cited references 9 -> 7 under the floor of 8/.test(e.text)) && !ev.some((e) => e.kind === "revise-refs-below-floor"), name + ": the refusal and the noop name the clause", ev.map((e) => e.kind));
}
{
  const t = mkEnv(() => raw([EDIT_89]), { flags: { research_revise_shrink_guard: "measure" } });
  const res = await stageRevise(t.env, row());
  const up = stageUpdates(t);
  const ev = events(t);
  ok(t.calls.length === 1 && res.ok === true && res.patch === 1 && res.extendFor === "floor" && res.refsShort === true && t.store["pipeline/r1/reconciled.md"] === REFS_ONLY, "measure mode: a reference-only patch is applied and the pass reports the floor extension", { calls: t.calls.length, res });
  ok(up.length === 1 && /stage='complete'/.test(up[0].sql) && up[0].ctx.extendFor === "floor" && up[0].ctx.cycles === 1 && up[0].ctx.patch === 1, "measure mode: the row goes to stage complete with extendFor floor", up);
  const rb = ev.filter((e) => e.kind === "revise-refs-below-floor");
  ok(rb.length === 1 && rb[0].status === "warn" && /refs 9->7 floor=8/.test(rb[0].text) && /routed to the floor extension/.test(rb[0].text), "measure mode: revise-refs-below-floor is logged with the route", rb);
  ok(ev.some((e) => e.kind === "floor-route" && /revise->complete refs 9->7 floor=8/.test(e.text)) && !ev.some((e) => e.kind === "revise-shrink-refused") && !ev.some((e) => e.kind === "revise-noop"), "measure mode: a floor-route event, and no revise-shrink-refused (mode=measure) and no revise-noop", ev.map((e) => e.kind + ":" + e.text.slice(-70)));
}
// measure keeps its meaning for the other two clauses: the patch is applied, logged as a measured refusal, and not routed as a reference-only patch.
for (const [name, edits, paper, why] of [
  ["the cut limit", [{ find: BLOCK, replace: keptCites }], BIGP, /^cuts 2\d% of the paper in one pass \(limit 20%\)/],
  ["the cut limit together with the reference clause", [{ find: BLOCK, replace: "" }, EDIT_89], BIGP, /^cuts 2\d% of the paper in one pass \(limit 20%\)/],
  ["the char floor together with the reference clause", [{ find: SEC2, replace: "" }, EDIT_89], NEAR, /^below the 20000-char floor/]
]) {
  const t = mkEnv(() => raw(edits), { paper, flags: { research_revise_shrink_guard: "measure" } });
  const res = await stageRevise(t.env, row());
  const ev = events(t);
  const refused = ev.filter((e) => e.kind === "revise-shrink-refused");
  ok(t.calls.length === 1 && res.ok === true && res.patch >= 1 && res.extendFor === undefined, "measure mode, " + name + ": the patch is applied on the first model and not routed to the extension", { calls: t.calls.length, res });
  ok(refused.length === 1 && refused[0].status === "warn" && why.test(refused[0].text.split(": ").slice(1).join(": ")) && /\(mode=measure, applied\)$/.test(refused[0].text), "measure mode, " + name + ": logged as revise-shrink-refused (mode=measure, applied)", refused.map((e) => e.text.slice(-140)));
  ok(!ev.some((e) => e.kind === "revise-refs-below-floor") && !ev.some((e) => e.kind === "revise-noop") && t.store["pipeline/r1/reconciled.md"] !== paper, "measure mode, " + name + ": no refs-below-floor event and the paper is stored", ev.map((e) => e.kind));
}
{
  const t = mkEnv(() => raw([EDIT_89]), { flags: { research_revise_refs_extend: "on" } });
  const res = await stageRevise(t.env, row());
  ok(res.ok === true && res.extendFor === "floor", "any value other than off keeps the extension on", res);
}

// 2g. A review that lists gate-refcount (the old _floorNext route) still extends; an ordinary patch that keeps the references is unchanged.
{
  const t = mkEnv(() => raw([{ find: S(5), replace: "Step 5 of the derivation fixes the intermediate value 35 from the stated inputs, shown in full detail. " }]), { hardId: "h2" });
  const res = await stageRevise(t.env, row());
  const up = stageUpdates(t);
  ok(res.ok === true && res.extendFor === undefined && up.length === 1 && /stage='review'/.test(up[0].sql) && !events(t).some((e) => e.kind === "revise-refs-below-floor"), "a patch that keeps the references goes to review as before", { res, up });
}

// ---- 3. the loop is bounded: delete, extend, review asks for another deletion, ... ends at the review-cycle cap ----
{
  const audit = new DatabaseSync(":memory:");
  audit.exec(`CREATE TABLE research_queue (id TEXT PRIMARY KEY, source TEXT, source_id TEXT, idea TEXT, summary TEXT, status TEXT DEFAULT 'queued', stage TEXT, claimed_at TEXT, attempt INTEGER DEFAULT 0, context TEXT, error TEXT, recover_count INTEGER DEFAULT 0, revise_count INTEGER DEFAULT 0, terminal_rearms INTEGER DEFAULT 0, paper_slug TEXT, published_at TEXT, doi TEXT);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
INSERT INTO ops_config (key, value) VALUES ('research_review_triage', 'off'), ('research_lean_ensemble', 'off');
INSERT INTO research_queue (id, source, source_id, idea, status, stage, context, recover_count) VALUES ('loop1', 'proposal', '1', 'an idea', 'researching', 'review', '{"cycles":0,"verifyPass":0}', 0);`);
  const d1 = { prepare(sql) {
    let args = [];
    const o = { bind(...a) { args = a; return o; },
      async run() { const r = audit.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
      async first() { return audit.prepare(sql).get(...args) || null; },
      async all() { return { results: audit.prepare(sql).all(...args) }; } };
    return o;
  } };
  const r2 = new Map([["pipeline/loop1/reconciled.md", BIGP], ["pipeline/loop1/grounding.md", grounding]]);
  const tasks = { REVIEW: 0, REVISE_PATCH: 0, EXTEND: 0 };
  const bodyCited = (paper) => { const body = paper.split("## References")[0]; const set = new Set(); for (const m of body.matchAll(/Prior work \[([0-9, ]+)\] supplies/g)) for (const n of m[1].split(",")) set.add(n.trim()); return Array.from(set).sort((a, b) => a - b); };
  const AI = { async run(model, input) {
    const p = input.messages[0].content;
    const task = (p.match(/=== TASK: ([A-Z_]+) ===/) || [])[1] || "?";
    tasks[task] = (tasks[task] || 0) + 1;
    const paper = r2.get("pipeline/loop1/reconciled.md");
    if (task === "REVIEW") return { response: JSON.stringify({ verdict: "revise", hard: [{ id: "H1", severity: "HARD", claim: "a conclusion rests on a citation that does not support it", reason: "unsupported", fix: "delete the claim and its citation" }], soft: [] }) };
    if (task === "REVISE_PATCH") {
      // The same deletion every cycle: remove the last citation sentences until 7 cited references remain.
      const sents = Array.from(paper.split("## References")[0].matchAll(/Prior work \[[0-9, ]+\] supplies the comparison used in this step\. /g)).map((m) => m[0]);
      const edits = [];
      let work = paper;
      for (let i = sents.length - 1; i >= 0 && bodyCited(work).length > 7; i--) {
        if (work.split(sents[i]).length !== 2) continue;
        edits.push({ find: sents[i], replace: "" });
        work = work.replace(sents[i], "");
      }
      return { response: JSON.stringify(edits.slice(0, 8)) };
    }
    if (task === "EXTEND") {
      const unc = ((p.match(/BIBLIOGRAPHY ENTRIES NOT YET CITED: ([^\n]*)/) || [])[1] || "").match(/\d+/g) || [];
      return { response: "## Extended Derivations and Worked Examples\n\n" + run(900, 6) + unc.map((k) => C(k)).join("") + run(950, 3) };
    }
    return { response: "" };
  } };
  const env = { QNFO_AUDIT: d1, MIRROR: { async put(k, v) { r2.set(k, v); }, async get(k) { return r2.has(k) ? { text: async () => r2.get(k) } : null; } }, AI };
  const get = () => audit.prepare("SELECT * FROM research_queue WHERE id = 'loop1'").get();
  const trail = [];
  let first = null, last = null, steps = 0;
  // Drive the real stages until the row leaves review / revise / complete; a HARD finding at the configured cap re-enters the lane (SINGLE-LANE-1) without an extra cycle.
  for (; steps < 400; steps++) {
    const r = get();
    if (r.status !== "researching" || !["review", "revise", "complete"].includes(r.stage)) { last = r.status + "/" + r.stage; break; }
    const fn = r.stage === "review" ? stageReview : r.stage === "revise" ? stageRevise : stageComplete;
    const res = await fn(env, r);
    trail.push(r.stage + ":" + (JSON.parse(r.context || "{}").cycles ?? "-"));
    if (res && res.ok === false && !first) first = { withheld: res.withheld || res.stage, cycle: res.cycle };
  }
  const evK = (k) => audit.prepare("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = ?").get(k).n;
  const capCycles = 6;
  if (process.env.REFS_EXTEND_DEBUG) console.log(audit.prepare("SELECT kind, status, substr(text,1,330) t FROM cloud_ops_events ORDER BY rowid").all().map((e) => e.kind + " " + e.status + " " + e.t).join("\n"));
  ok(first && first.withheld === "review-hard" && first.cycle === capCycles, "the alternation ends: review withholds the paper with its HARD finding at cycle 6 (MAX_REVIEW_CYCLES)", { first, steps, trail: trail.join(" ") });
  ok(last === "queued/revise", "a paper still carrying a HARD finding at the review-cycle cap re-enters the lane at revise (never parked, never published) without a seventh revise/review cycle in this pass", { last, steps });
  ok(steps < 100, "it ends well inside the step budget", steps);
  ok(tasks.REVISE_PATCH === capCycles && tasks.REVIEW === capCycles + 1 && evK("revise-refs-below-floor") === tasks.REVISE_PATCH && evK("revise-noop") === 0 && evK("revise-shrink-refused") === 0, "exactly the six configured revise cycles run, with a final quality-gate review and no refused patches", { tasks, refsBelow: evK("revise-refs-below-floor"), noop: evK("revise-noop"), refused: evK("revise-shrink-refused") });
  ok(evK("floor-extend") >= capCycles && evK("floor-extend") <= capCycles * 6, "every deletion was followed by at least one floor-extend, at most FLOOR_EXTEND_MAX_ROUNDS per cycle", evK("floor-extend"));
  const finalPaper = r2.get("pipeline/loop1/reconciled.md");
  ok(!W.floorShortfall(row(), finalPaper, grounding, false).need, "the paper the loop ended on is back at the reference floor (the extension restored it)", W.floorShortfall(row(), finalPaper, grounding, false));
}

// FLOOR_EXTEND_TARGET and the round cap are untouched by this change.
ok(FLOOR_EXTEND_TARGET === 1.2, "FLOOR_EXTEND_TARGET is unchanged");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
