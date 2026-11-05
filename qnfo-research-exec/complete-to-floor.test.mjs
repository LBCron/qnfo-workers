// RESEARCH-FLOOR-1 (qnfo-research-exec 0.24.0, agent_issues 99913): complete-to-floor, the gate-length / gate-refcount routing and
// the re-arm of the rows parked on the defect. Runs the worker's real stageComplete, stageVerify, stageRevise, floorShortfall,
// floorRearmTick and parkRearmTick against in-memory R2, AI and D1 mocks (node:sqlite for the re-arm), and the real migration
// file against synthetic rows. Offline, no network.
// Run: node qnfo-research-exec/complete-to-floor.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { stageComplete, stageVerify, stageRevise, floorShortfall, legacyParkedSweep, finalGates, paperCompleteness, FLOOR_EXTEND_TARGET } from "./worker.js";

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d !== undefined ? " -- " + JSON.stringify(d).slice(0, 700) : "")); } };

// ---- fixtures: a complete paper of 19,793..19,999 chars that cites 6 of 12 bibliography entries ----
const S = (i) => "Step " + i + " of the derivation fixes the intermediate value " + (i * 7) + " from the stated inputs and carries it forward with the arithmetic shown. ";
const run = (from, n, cite) => Array.from({ length: n }, (_, k) => S(from + k)).join("") + (cite ? "Prior work [" + cite + "] supplies the comparison used in this step. " : "");
const sec = (h, from, n, cite) => "## " + h + "\n\n" + run(from, n, cite) + "\n\n";
const BIB = 12;
const grounding = "INPUT BLOCK\n\n## Bibliography\n" + Array.from({ length: BIB }, (_, i) => "[" + (i + 1) + "] arXiv:2401.0000" + (i + 1) + " | Work number " + (i + 1)).join("\n") + "\n";
const refList = (nums) => "## References\n\n" + nums.map((k) => "[" + k + "] Work number " + k + ". arXiv:2401.0000" + k + ". https://arxiv.org/abs/2401.0000" + k).join("\n") + "\n";
function mkPaper(analysisSentences, cited) {
  return "# A paper about a model\n\n## Abstract\n\nContext, gap, approach, result and practice are stated here in order.\n\n"
    + sec("1. Introduction", 1, 12, cited[0]) + sec("2. Background and Related Work", 20, 12, cited[1]) + sec("3. Methods", 40, 12, cited[2])
    + sec("4. Analysis", 60, analysisSentences, cited[3]) + sec("5. Results", 400, 12, cited[4]) + sec("6. Discussion", 420, 12, cited[5])
    + sec("7. Practical Implications and Engineering Pathways", 440, 12, cited[6]) + sec("8. Conclusion", 460, 6, cited[7]) + refList(cited.filter(Boolean));
}
const CITED = [1, 2, 3, 4, 5, 6];
let SHORT = "";
for (let n = 20; n < 400; n++) { SHORT = mkPaper(n, CITED); if (SHORT.length >= 19793) break; }
ok(SHORT.length >= 19793 && SHORT.length < 20000 && paperCompleteness(SHORT).complete, "fixture: a complete paper of 19,793-19,999 chars", { len: SHORT.length, pc: paperCompleteness(SHORT) });
const LONG = mkPaper(120, [1, 2, 3, 4, 5, 6, 7, 8]);
ok(LONG.length >= 24000 && paperCompleteness(LONG).complete, "fixture: a complete paper above the extension goal", LONG.length);

// The section a writer would return for the EXTEND task: a heading, long grounded text, and citations of the uncited entries.
const EXT_SECTION = "## Extended Derivations and Worked Examples\n\n" + run(900, 40, "7") + run(950, 8, "8, 9") + "Further work [10] and [11] and [12] bears on the same step. " + run(960, 12) + "\n";

function mkEnv(opts) {
  const o = opts || {};
  const store = { "pipeline/r1/reconciled.md": o.paper || SHORT, "pipeline/r1/grounding.md": o.grounding === undefined ? grounding : o.grounding };
  if (o.fixes) store["pipeline/r1/fixes.json"] = o.fixes;
  const sqls = [], calls = [];
  const D1 = { prepare(sql) { let args = []; const q = { bind(...x) { args = x; return q; }, async run() { sqls.push({ sql, args }); return { meta: { changes: 1 } }; }, async first() { if (/FROM ops_config/.test(sql) && o.flags && o.flags[args[0]] !== undefined) return { value: o.flags[args[0]] }; return null; }, async all() { return { results: [] }; } }; return q; } };
  const MIRROR = { async get(k) { const v = store[k]; return v == null ? null : { text: async () => v }; }, async put(k, v) { store[k] = v; } };
  const AI = { async run(model, input) { const prompt = input.messages[0].content; calls.push({ model, prompt }); const a = o.answer; return { response: typeof a === "function" ? a(calls.length, prompt) : a === undefined ? "[]" : a }; } };
  return { env: { AI, QNFO_AUDIT: D1, MIRROR }, sqls, calls, store };
}
const events = (t) => t.sqls.filter((s) => /INSERT INTO cloud_ops_events/.test(s.sql)).map((s) => ({ kind: s.args[2], text: s.args[3], status: s.args[6] }));
const stageUpdate = (t) => t.sqls.filter((s) => /UPDATE research_queue SET stage=/.test(s.sql)).map((s) => ({ sql: s.sql, ctx: s.args[0] ? JSON.parse(s.args[0]) : null }));
const row = (extra) => Object.assign({ id: "r1", context: "{}", recover_count: 0, source: "idea-hub", stage: "complete", status: "researching" }, extra || {});
const gateOk = (paper) => finalGates(paper, { bibCount: BIB, minChars: 20000, structure: true });

// 0. The fixture fails both floor gates before the change.
{
  const g = finalGates(SHORT, { bibCount: BIB, minChars: 20000, structure: true });
  ok(!g.ok && g.fixes.some((f) => f.id === "gate-length") && g.fixes.some((f) => f.id === "gate-refcount"), "the short fixture fails gate-length and gate-refcount", g.reason);
  const sh = floorShortfall(row(), SHORT, grounding, false);
  ok(sh.need && sh.len && sh.refs && sh.floor === 20000 && sh.uncited.length === 6 && sh.target === Math.ceil(20000 * FLOOR_EXTEND_TARGET), "floorShortfall names the length, the references and the 6 uncited entries", sh);
  ok(!floorShortfall(row(), LONG, grounding, false).need, "a paper above the floor with 8 references needs nothing");
  ok(!floorShortfall(row({ source: "remediation" }), SHORT, grounding, false).len, "a remediation row keeps its own (8,000-char) length floor");
  ok(FLOOR_EXTEND_TARGET >= 1.1, "the extension goal is at least 1.1x the floor");
}

// 1. complete extends a 19.8k paper with 6 cited references to the floor and cites 8 or more.
{
  const t = mkEnv({ answer: EXT_SECTION });
  const res = await stageComplete(t.env, row());
  const out = t.store["pipeline/r1/reconciled.md"];
  ok(out.length >= 22000, "the stored paper reaches 22,000 chars or more", out.length);
  ok(res && res.ok === true && res.stage === "complete->review" && res.floor === "ok", "the row advances to review once at the floor", res);
  ok(gateOk(out).ok, "finalGates (the verify gate set) passes on the stored paper", gateOk(out).reason);
  ok(((out.split("## References")[1] || "").match(/^\[\d+\]/gm) || []).length >= 8, "the rendered reference list holds 8 or more entries", (out.split("## References")[1] || "").slice(0, 200));
  ok(/## 5\. Results[\s\S]*## 6\. Extended Derivations and Worked Examples[\s\S]*## 7\. Discussion/.test(out) && /## 8\. Practical/.test(out) && /## 9\. Conclusion/.test(out), "the section sits between Results and Discussion and the later headings are renumbered", out.match(/^## .*$/gm));
  ok(paperCompleteness(out).complete, "the extended paper is still structurally complete", paperCompleteness(out).reasons);
  ok(t.calls.length === 1 && /=== TASK: EXTEND ===/.test(t.calls[0].prompt) && /NOT YET CITED: \[7\], \[8\], \[9\], \[10\], \[11\], \[12\]/.test(t.calls[0].prompt) && /LENGTH: at least \d+ characters/.test(t.calls[0].prompt), "the EXTEND prompt names the length and the six uncited entries", t.calls.map((c) => c.prompt.slice(-420)));
  const up = stageUpdate(t);
  ok(up.length === 1 && /stage='review'/.test(up[0].sql) && up[0].ctx.extendFor === undefined && up[0].ctx.floorRounds === undefined, "the review context carries no floor fields", up);
  const ev = events(t);
  ok(ev.some((e) => e.kind === "floor-extend" && /round=1 chars \d+->\d+ floor=20000 target=24000 uncited=6/.test(e.text)) && ev.some((e) => e.kind === "complete" && / floor=ok floor_rounds=1/.test(e.text) && /chars=\d{5}/.test(e.text)), "floor-extend and complete events record the round", ev);
}

// 2. A paper at the extension goal makes no model call.
{
  const t = mkEnv({ paper: LONG, answer: "unused" });
  const res = await stageComplete(t.env, row());
  ok(t.calls.length === 0 && res.stage === "complete->review" && res.floor === "ok", "a paper above the floor goes to review with no call", res);
}

// 3. A writer that adds nothing: two stalled rounds stay in complete with the floor context, the third gives up to review
//    (verify then decides, once); the stored paper is untouched.
{
  const t = mkEnv({ answer: "No." });
  const r1 = await stageComplete(t.env, row());
  ok(r1.ok && r1.stage === "complete" && t.calls.length >= 2, "two stalled extension rounds stay in complete", r1);
  const up1 = stageUpdate(t).concat(t.sqls.filter((s) => /UPDATE research_queue SET context=/.test(s.sql)).map((s) => ({ ctx: JSON.parse(s.args[0]) })));
  const c1 = up1[up1.length - 1].ctx;
  ok(c1.extendFor === "floor" && c1.completeStall === 2 && c1.floorRounds === 2, "the context carries the floor rounds and the stall count", c1);
  const t2 = mkEnv({ answer: "No." });
  const r2 = await stageComplete(t2.env, row({ context: JSON.stringify(c1) }));
  ok(r2.ok && r2.stage === "complete->review" && r2.floor === "gave-up", "the third stalled round hands the paper to review as gave-up", r2);
  ok(t2.store["pipeline/r1/reconciled.md"] === SHORT, "a stalled extension leaves the stored paper unchanged");
  ok(events(t2).some((e) => e.kind === "complete" && / floor=gave-up/.test(e.text) && e.status === "warn"), "the complete event says gave-up at warn");
  // The round budget bounds the extension even when every round adds a little.
  const t3 = mkEnv({ answer: () => "## Another Extra Section\n\n" + run(1000 + Math.floor(Math.random() * 1e5), 3) });
  const r3 = await stageComplete(t3.env, row({ context: JSON.stringify({ extendFor: "floor", floorRounds: 5 }) }));
  ok(t3.calls.length === 1 && r3.stage === "complete->review", "with 5 of 6 rounds spent only one more is made, then the paper moves on", { calls: t3.calls.length, r3 });
}

// 4. The ops_config lever restores the old exit.
{
  const t = mkEnv({ answer: EXT_SECTION, flags: { research_floor_extend: "off" } });
  const res = await stageComplete(t.env, row());
  ok(t.calls.length === 0 && res.stage === "complete->review" && t.store["pipeline/r1/reconciled.md"] === SHORT, "research_floor_extend = off: no extension, the paper goes to review as before", res);
}

// 4b. XREF-REPAIR-1 (0.28.2, agent_issues 2671): a complete paper whose only fault is a "Section N" above its highest heading leaves
//     complete in the same tick with no model call; it used to run the continuation three rounds, add under 300 chars each time,
//     and be re-queued at ground (3 rows on 2026-10-19, each discarding a whole draft).
{
  const dangle = (p, n) => p.replace("## 2. Background and Related Work", "The setup is developed in Section " + n + ".\n\n## 2. Background and Related Work");
  const D12 = dangle(LONG, 12);
  ok(paperCompleteness(D12).complete === false && paperCompleteness(D12).truncated === false && paperCompleteness(D12).dangling.join() === "12" && !floorShortfall(row(), D12, grounding, false).need, "fixture: a complete paper above the floor whose only fault is 'Section 12'", paperCompleteness(D12));
  const t = mkEnv({ paper: D12, answer: () => { throw new Error("the model must not be called for a dangling reference"); } });
  const res = await stageComplete(t.env, row({ context: JSON.stringify({ cycles: 2, verifyPass: 1 }) }));
  const out = t.store["pipeline/r1/reconciled.md"];
  ok(res && res.ok === true && res.stage === "complete->review" && res.floor === "ok", "the paper leaves complete for review in the same tick", res);
  ok(t.calls.length === 0, "no model call is made", t.calls.length);
  ok(paperCompleteness(out).complete && !/Section 12/.test(out) && /developed in the relevant section\./.test(out) && out.length === D12.length + "the relevant section".length - "Section 12".length, "the stored paper is complete and only the one span was reworded", { len: out.length, base: D12.length });
  const up = stageUpdate(t);
  ok(up.length === 1 && /stage='review'/.test(up[0].sql) && up[0].ctx.cycles === 2 && up[0].ctx.verifyPass === 1 && !t.sqls.some((s) => /stage='ground'/.test(s.sql)), "the row moves to review keeping its context; nothing is marked failed or re-queued at ground", { up, sqls: t.sqls.map((s) => s.sql.slice(0, 60)) });
  const ev = events(t);
  ok(ev.some((e) => e.kind === "xref-repair" && /sections=12 maxSec=8 chars \d+->\d+/.test(e.text) && e.status === "ok") && ev.some((e) => e.kind === "complete" && / rounds=1 /.test(e.text) && / steps=xref:10 /.test(e.text) && / complete=true/.test(e.text) && e.status === "ok"), "an xref-repair event and an ok complete event record it", ev);
  // Every other reader of the completeness contract still sees the reference: the same paper fails the gate set until repaired.
  ok(!gateOk(D12).ok && gateOk(D12).fixes.some((f) => f.id === "gate-complete") && gateOk(out).ok, "verify's gate-complete still fails the unrepaired paper and passes the repaired one", [gateOk(D12).reason, gateOk(out).reason]);

  // A paper cut at a paragraph end (tail sections missing) that also cites a missing section is NOT repaired: it is continued.
  const cutTail = dangle(LONG, 12).split("## 6. Discussion")[0].replace(/\s+$/, "") + "\n\n" + refList([1, 2, 3, 4, 5, 6, 7, 8]);
  const pcT = paperCompleteness(cutTail);
  ok(pcT.truncated === true && pcT.tailMissing.length === 3 && pcT.dangling.join() === "12", "fixture: a tail-truncated paper that also cites Section 12", pcT);
  const t2 = mkEnv({ paper: cutTail, answer: "No." });
  const r2 = await stageComplete(t2.env, row());
  ok(t2.calls.length >= 1 && /=== TASK: CONTINUE ===/.test(t2.calls[0].prompt) && !events(t2).some((e) => e.kind === "xref-repair") && /Section 12/.test(t2.store["pipeline/r1/reconciled.md"] || cutTail) && r2.ok && r2.stage === "complete", "a truncated paper still takes the continue path and keeps its text", { calls: t2.calls.length, r2 });

  // A dangling reference in a paper that is also under the floor: reworded first, then extended in the same tick.
  const S12 = dangle(SHORT, 12);
  const t3 = mkEnv({ paper: S12, answer: EXT_SECTION });
  const r3 = await stageComplete(t3.env, row());
  const ev3 = events(t3).map((e) => e.kind);
  ok(r3 && r3.ok && ev3.indexOf("xref-repair") >= 0 && ev3.indexOf("xref-repair") < ev3.indexOf("floor-extend") && t3.calls.length === 1 && /=== TASK: EXTEND ===/.test(t3.calls[0].prompt), "a short paper with a dangling reference is reworded, then extended (one model call)", { r3, ev3, calls: t3.calls.length });
  ok(paperCompleteness(t3.store["pipeline/r1/reconciled.md"]).complete, "and the stored paper is complete", paperCompleteness(t3.store["pipeline/r1/reconciled.md"]).reasons);
}

// 5. verify: a first-pass failure on gate-length / gate-refcount only goes to complete, carrying verifyPass 1 and the cycle count.
{
  const t = mkEnv({ answer: "[]" });
  const res = await stageVerify(t.env, row({ stage: "verify", context: JSON.stringify({ cycles: 3 }) }));
  const up = stageUpdate(t);
  ok(res && res.ok === true && res.stage === "verify->complete" && res.extendFor === "floor", "a floor-only verify failure routes to complete", res);
  ok(up.length === 1 && /stage='complete'/.test(up[0].sql) && up[0].ctx.verifyPass === 1 && up[0].ctx.cycles === 3 && up[0].ctx.extendFor === "floor", "the route keeps cycles and sets verifyPass 1 (the second verify is terminal)", up);
  ok(!up.some((s) => /stage='revise'/.test(s.sql)), "the row does not go to revise");
}
// 5b. Any other gate alongside the floor gates keeps the revise route.
{
  const t = mkEnv({ paper: SHORT.replace("## 2. Background and Related Work\n\n", "## 2. Background and Related Work\n\nThis claim is not yet checked [to verify]. "), answer: "[]" });
  const res = await stageVerify(t.env, row({ stage: "verify" }));
  ok(res && res.stage === "verify->revise" && /gate-toverify/.test(res.gate), "a floor failure with another gate still goes to revise", res);
}
// 5c. The second verify pass is terminal as before (no new extension loop).
{
  const t = mkEnv({ answer: "[]" });
  const res = await stageVerify(t.env, row({ stage: "verify", context: JSON.stringify({ cycles: 2, verifyPass: 1 }) }));
  ok(res && res.ok === false && res.withheld === "verify-unresolved" && /gate-length/.test(res.gate), "verifyPass 1 and still short: the pass fails (recover loop), no second extension", res);
  ok(!stageUpdate(t).some((s) => /stage='complete'/.test(s.sql)), "no route back to complete");
}
// 5d. The lever restores the revise route.
{
  const t = mkEnv({ answer: "[]", flags: { research_floor_extend: "off" } });
  const res = await stageVerify(t.env, row({ stage: "verify" }));
  ok(res && res.stage === "verify->revise", "research_floor_extend = off: verify goes to revise as before", res);
}

// 6. revise: fixes that are only gate-length / gate-refcount go to complete with no patch call.
{
  const fixes = JSON.stringify([{ id: "gate-length", severity: "HARD", claim: "paper too short", reason: "body length 19800 < 20000", fix: "Expand" }, { id: "gate-refcount", severity: "HARD", claim: "too few references", reason: "rendered references 6 < 8", fix: "List more" }]);
  const t = mkEnv({ fixes, answer: "should not be called" });
  const res = await stageRevise(t.env, row({ stage: "revise" }));
  const up = stageUpdate(t);
  ok(res && res.stage === "revise->complete" && res.extendFor === "floor" && t.calls.length === 0, "floor-only fixes route to complete without a patch call", { res, calls: t.calls.length });
  ok(up.length === 1 && /stage='complete'/.test(up[0].sql) && up[0].ctx.extendFor === "floor", "the row context asks for the floor extension", up);
  ok(events(t).some((e) => e.kind === "floor-route" && /revise->complete ids=gate-length,gate-refcount/.test(e.text)), "a floor-route event is logged");
  // A paper above the floor is not routed (the fixes are stale): the patch reviser runs as before.
  const t2 = mkEnv({ paper: LONG, fixes, answer: "[]" });
  const res2 = await stageRevise(t2.env, row({ stage: "revise" }));
  ok(t2.calls.length >= 1 && res2.stage !== "revise->complete", "stale floor fixes on a paper above the floor go to the patch reviser", res2);
}
// 6b. A mixed fix list is patched; if the patched paper is still short it goes to complete, not to review.
{
  const fixes = JSON.stringify([{ id: "gate-length", severity: "HARD", claim: "paper too short", reason: "x", fix: "x" }, { id: "h1", severity: "HARD", claim: "the step value", reason: "stated without derivation", fix: "derive" }]);
  const find = S(5), replace = "Step 5 of the derivation fixes the intermediate value 35 from the stated inputs and carries it forward with the arithmetic shown in full. ";
  const t = mkEnv({ fixes, answer: JSON.stringify([{ find, replace }]) });
  const res = await stageRevise(t.env, row({ stage: "revise", context: JSON.stringify({ cycles: 1 }) }));
  const up = stageUpdate(t);
  ok(res && res.patch === 1 && up.length === 1 && /stage='complete'/.test(up[0].sql) && up[0].ctx.extendFor === "floor" && up[0].ctx.cycles === 2, "a patched paper still under the floor is extended, not reviewed short", { res, up });
}

// ---- 7. FLOOR-REARM-1 (retired by SINGLE-LANE-1, 0.54.0): the migration still freezes its candidates; the worker no longer has a sweep that re-arms them, legacyParkedSweep returns any row still parked ----
function d1Over(db) {
  return { prepare(sql) { let args = []; const q = { bind(...x) { args = x; return q; }, async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; }, async first() { return db.prepare(sql).get(...args) || null; }, async all() { return { results: db.prepare(sql).all(...args) }; } }; return q; } };
}
const RQ = "CREATE TABLE research_queue (id TEXT PRIMARY KEY, status TEXT, stage TEXT, error TEXT, recover_count INTEGER DEFAULT 0, revise_count INTEGER DEFAULT 0, terminal_rearms INTEGER DEFAULT 0, attempt INTEGER DEFAULT 0, context TEXT, claimed_at TEXT, created_at TEXT, published_at TEXT, source TEXT)";
const OTHER = "CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT); CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT)";
const P = "PARKED-POISON-1: recover_count exhausted (3); last error: ";
function seed(db) {
  const ins = db.prepare("INSERT INTO research_queue (id, status, stage, error, recover_count, terminal_rearms, created_at, context, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposal')");
  const rows = [
    ["a1", "wontfix", "parked", P + "verify: unresolved after revision - mismatch=false gates=gate-length", 3, 0, "2026-10-12T10:00:00Z"],
    ["a2", "wontfix", "parked", P + "verify: unresolved after revision - mismatch=false gates=gate-length,gate-refcount", 3, 0, "2026-10-13T10:00:00Z"],
    ["a3", "wontfix", "parked", P + "verify: unresolved after revision - mismatch=false gates=gate-refcount", 3, 0, "2026-10-14T10:00:00Z"],
    ["a4", "wontfix", "parked", P + "review: 6 HARD findings unresolved after 6 revise cycles", 3, 0, "2026-10-12T11:00:00Z"],
    ["a5", "wontfix", "parked", P + "revise: no applicable edit for 2 HARD fixes (h1,h2) from two models", 3, 0, "2026-10-13T11:00:00Z"],
    ["a6", "wontfix", "parked", P + "revise: no applicable edit for 1 HARD fixes (verify-mismatch)", 3, 0, "2026-10-14T11:00:00Z"],
    ["a7", "wontfix", "parked", P + "verify: unresolved after revision - mismatch=true gates=gate-length", 3, 0, "2026-10-11T11:00:00Z"],
    ["x1", "wontfix", "parked", P + "ground: bibliography 4 < 5 entries", 3, 0, "2026-10-12T12:00:00Z"],
    ["x2", "wontfix", "parked", P + "verify: unresolved after revision - mismatch=false gates=gate-length", 3, 1, "2026-10-12T13:00:00Z"],
    ["x3", "wontfix", "parked", "PARKED-MATH-LATEX-2: 5 plain-text math tokens remain", 0, 0, "2026-10-12T14:00:00Z"],
    ["x4", "researching", "verify", P + "verify: unresolved after revision - mismatch=false gates=gate-length", 1, 0, "2026-10-12T15:00:00Z"],
    ["x5", "wontfix", "parked", "REVIEW-UNRESOLVED-PARK-1: prior stage revise; revise: no applicable edit", 0, 0, "2026-10-12T16:00:00Z"]
  ];
  for (const r of rows) ins.run(r[0], r[1], r[2], r[3], r[4], r[5], r[6], null);
}
const migSql = readFileSync(new URL("../migrations/2026-10-19-research-rearm-after-repair.sql", import.meta.url), "utf8");
const BAK = "bak_20261019_research_parked";
{
  // The migration, applied to the pre-fix world, freezes the candidates and re-queues nothing.
  const db = new DatabaseSync(":memory:");
  db.exec(RQ + ";" + OTHER + ";");
  db.exec("CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('hold','filter','pause','kill-switch','gate','cap','guard','lease')), guards_against TEXT, critical_path INTEGER NOT NULL DEFAULT 0, disposition TEXT NOT NULL CHECK (disposition IN ('remove','demote','replace','keep')), disposition_state TEXT NOT NULL DEFAULT 'planned' CHECK (disposition_state IN ('planned','applied')), alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT NOT NULL, issue_id INTEGER, reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));"
    + "CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);"
    + "CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT DEFAULT (datetime('now')), last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER DEFAULT 45000, next_due_at TEXT, max_items INTEGER DEFAULT 5, requires_container INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0);"
    + "CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, created_at INTEGER);"
    + "CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, ts TEXT DEFAULT (datetime('now')));"
    + "INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, status) VALUES ('issue-99913', 99913, 'p', 'VACUOUS-PROBE-V3-1', 'SELECT ''closed'' AS expected, NULL AS observed', 'd1-query', 'qnfo-fleet-control', 'superseded');");
  seed(db);
  const before = JSON.stringify(db.prepare("SELECT * FROM research_queue ORDER BY id").all());
  db.exec(migSql);
  ok(JSON.stringify(db.prepare("SELECT * FROM research_queue ORDER BY id").all()) === before, "the migration changes no research_queue row (nothing is queued before the fixed worker runs)");
  const bak = db.prepare("SELECT id FROM " + BAK + " ORDER BY id").all().map((r) => r.id);
  ok(JSON.stringify(bak) === JSON.stringify(["a1", "a2", "a3", "a4", "a5", "a6", "a7"]), "the backup freezes exactly the parked rows of the corrected defects, once-armed and other parks excluded", bak);
  db.exec(migSql);
  ok(db.prepare("SELECT count(*) n FROM " + BAK).get().n === 7 && db.prepare("SELECT count(*) n FROM failure_modes").get().n === 2, "applying the file twice adds nothing");

  // Worker side (SINGLE-LANE-1): floorRearmTick and parkRearmTick are gone. Every row the migration froze (and every other row still parked) goes back into the
  // lane through legacyParkedSweep, ten a run, with its prior error in the text; rows that are not parked are never touched.
  const env = { QNFO_AUDIT: d1Over(db) };
  const parkedLeft = () => db.prepare("SELECT count(*) n FROM research_queue WHERE stage = 'parked'").get().n;
  ok(parkedLeft() === 11, "fixture: eleven rows are still parked", parkedLeft());
  const r1 = await legacyParkedSweep(env);
  ok(r1.reentered === 10 && parkedLeft() === 1, "legacyParkedSweep returns ten rows a run", { r1, left: parkedLeft() });
  const a3 = db.prepare("SELECT * FROM research_queue WHERE id = 'a3'").get();
  ok(a3.status === "queued" && a3.stage === "ground" && a3.terminal_rearms === 1 && a3.recover_count === 0 && a3.claimed_at === null && /^SINGLE-LANE-1: re-entered at ground, no parked state\. Was: PARKED-POISON-1/.test(a3.error), "a returned row is queued at ground with a fresh budget and its prior error in the text", a3);
  const x2 = db.prepare("SELECT * FROM research_queue WHERE id = 'x2'").get();
  ok(x2.terminal_rearms === 2 && x2.status === "queued", "a row that had one earlier re-arm counts it", x2);
  const r2 = await legacyParkedSweep(env);
  ok(r2.reentered === 1 && parkedLeft() === 0, "the next run returns the rest", { r2 });
  const r3 = await legacyParkedSweep(env);
  ok(r3.reentered === 0, "nothing is returned twice", r3);
  ok(db.prepare("SELECT status, stage FROM research_queue WHERE id = 'x4'").get().status === "researching", "a row that is not parked is never touched");

  // The failure-mode rows, controls and closing probe.
  const fms = db.prepare("SELECT fm_key, probe_class FROM failure_modes ORDER BY fm_key").all();
  ok(JSON.stringify(fms.map((f) => f.probe_class)) === JSON.stringify(["fm-research-draft-below-floor", "fm-research-revise-shrink"]), "two failure modes, each with its fm-<key> detector class", fms);
  const cons = db.prepare("SELECT class, verify_probe, status FROM remediation_contracts WHERE class LIKE 'fm-research%' ORDER BY class").all();
  ok(cons.length === 2 && cons.every((c) => c.status === "active" && c.verify_probe.indexOf(";") < 0 && /^SELECT '1' AS expected/.test(c.verify_probe)), "two detector contracts, each one SELECT", cons);
  const ctl = db.prepare("SELECT control, kind, disposition, disposition_state, alternate_path FROM control_registry ORDER BY control").all();
  ok(ctl.length === 3 && ctl.every((c) => c.disposition_state === "applied" && c.alternate_path), "three controls (gate, guard, cap), each applied with an alternate path", ctl);
  const c99913 = db.prepare("SELECT verify_probe, status, issue_id FROM remediation_contracts WHERE class = 'issue-99913'").get();
  ok(/'ok' AS expected/.test(c99913.verify_probe) && /gate-length/.test(c99913.verify_probe) && c99913.status === "active" && c99913.issue_id === 99913 && !/FROM agent_issues WHERE id = 99913/.test(c99913.verify_probe), "issue 99913 gets a probe that measures the defect (not its own closure) and is active", c99913);
  ok(db.prepare("SELECT count(*) n FROM decision_log").get().n === 1, "one decision_log row");

  // The 99913 probe on synthetic rows: observed ok only when the floor holds for 24 h.
  const probe = c99913.verify_probe;
  const evIns = db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, job, status) VALUES (?, ?, ?, ?, 'qnfo-research-exec', ?)");
  const ev = { run: (id, ts, kind, text, status) => evIns.run(id, ts, kind, text, status || "ok") };
  const ago = (min) => new Date(Date.now() - min * 6e4).toISOString();
  ok(db.prepare(probe).get().observed === "defect", "no complete events in 24 h: not ok");
  for (let i = 0; i < 24; i++) ev.run("c" + i, ago(60 + i), "complete", "row=x rounds=1 total=1 gained=0 steps= chars=" + (i < 2 ? 18000 : 26000) + " complete=true floor=" + (i < 2 ? "gave-up" : "ok") + " floor_rounds=" + (i < 2 ? 6 : 1));
  ok(db.prepare(probe).get().observed === "defect", "2 of 24 complete events that left under the floor (8%) is a defect", db.prepare(probe).get());
  db.prepare("UPDATE cloud_ops_events SET text = replace(replace(text, 'chars=18000', 'chars=26000'), 'floor=gave-up', 'floor=ok')").run();
  ok(db.prepare(probe).get().observed === "ok", "24 complete events all above the floor and no floor terminal: ok", db.prepare(probe).get());
  db.prepare("INSERT INTO agent_issues (title, status, created_at) VALUES ('RESEARCH-TERMINAL abcd1234: verify: unresolved after revision - mismatch=false gates=gate-length', 'open', ?)").run(Date.now() - 3600e3);
  ok(db.prepare(probe).get().observed === "defect", "a gate-length RESEARCH-TERMINAL issue filed in 24 h is a defect again");

  // Detectors: quiet before the deploy marker, loud on recurrence after it.
  const fmFloor = cons.find((c) => c.class === "fm-research-draft-below-floor").verify_probe, fmShrink = cons.find((c) => c.class === "fm-research-revise-shrink").verify_probe;
  db.prepare("DELETE FROM cloud_ops_events").run();
  for (let i = 0; i < 4; i++) { ev.run("o" + i, ago(600 + i), "complete", "row=x rounds=1 total=1 gained=0 steps= chars=18000 complete=true", "x"); ev.run("n" + i, ago(600 + i), "revise-noop", "row=x no applicable patch edit (proposed=1); revise failed, recover path", "x"); }
  ok(db.prepare(fmFloor).get().observed === "1" && db.prepare(fmShrink).get().observed === "1", "events of the old worker (no floor_rounds marker) keep both detectors quiet");
  ev.run("m", ago(300), "complete", "row=y chars=26000 complete=true floor=ok floor_rounds=0", "ok");
  ok(db.prepare(fmFloor).get().observed === "1", "after the marker, a healthy complete event keeps it quiet");
  for (let i = 0; i < 3; i++) { ev.run("g" + i, ago(100 + i), "complete", "row=z chars=19000 complete=true floor=gave-up floor_rounds=6", "warn"); ev.run("s" + i, ago(100 + i), "revise-noop", "row=z no applicable patch edit (proposed=1); shrink refused: below the 20000-char floor; revise failed", "warn"); }
  ok(db.prepare(fmFloor).get().observed === "0" && db.prepare(fmShrink).get().observed === "0", "three recurrences after the marker trip both detectors");
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
