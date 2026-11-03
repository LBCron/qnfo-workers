// COMPLETE-STRUCTURAL-1 (qnfo-research-exec 0.40.10, agent_issues 1000556-1000566 LOOP-BREAKER-1): a paper that holds every
// required section, ends cleanly and cites no missing section, yet is incomplete for a structural reason alone (duplicate or
// skipped section numbers, out-of-order headings, an appendix before the body, generation-instruction residue) fell into
// stageComplete's "section" branch with pc.middleMissing empty; PAPER_SECTION_ORDER.find(undefined) === undefined and spec.n
// threw "Cannot read properties of undefined (reading 'n')" on every claim, and the uncaught throw skipped markError, so the
// row sat claimed and the stale reaper fed it back to crash again. The row now goes through markError with its reasons.
// Offline, in-memory mocks, same shape as complete-to-floor.test.mjs.
// Run: node qnfo-research-exec/complete-structural.test.mjs   -> prints "N passed, 0 failed"
import assert from "node:assert/strict";
import { stageComplete, paperCompleteness } from "./worker.js";

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d !== undefined ? " -- " + JSON.stringify(d).slice(0, 700) : "")); } };

const S = (i) => "Step " + i + " of the derivation fixes the intermediate value " + (i * 7) + " from the stated inputs and carries it forward with the arithmetic shown. ";
const run = (from, n) => Array.from({ length: n }, (_, k) => S(from + k)).join("");
const sec = (h, from, n) => "## " + h + "\n\n" + run(from, n) + "\n\n";
const grounding = "INPUT BLOCK\n\n## Bibliography\n" + Array.from({ length: 12 }, (_, i) => "[" + (i + 1) + "] arXiv:2401.0000" + (i + 1) + " | Work number " + (i + 1)).join("\n") + "\n";

// Every required section present (the completeness regexes read names, not numbers), a clean end, no dangling
// cross-reference -- but the numbers skip 4, so paperCompleteness is incomplete for a structural reason only.
function structuralPaper() {
  return "# A paper about a model\n\n## Abstract\n\nContext, gap, approach, result and practice are stated here in order.\n\n"
    + sec("1. Introduction", 1, 12) + sec("2. Background and Related Work", 20, 12) + sec("3. Methods", 40, 12)
    + sec("5. Analysis", 60, 12) + sec("6. Results", 80, 12) + sec("7. Discussion", 100, 12)
    + "### 7.1 Discussion detail\n\nThis detail belongs to the discussion section.\n\n```md\n### 7.2 Example\n```\n\n"
    + sec("8. Practical Implications and Engineering Pathways", 120, 12) + sec("9. Conclusion", 140, 6)
    + "## References\n\n[1] Work number 1. https://arxiv.org/abs/2401.00001\n";
}

const pc = paperCompleteness(structuralPaper());
ok(!pc.complete && pc.middleMissing.length === 0 && pc.dangling.length === 0 && !pc.truncated, "fixture: structural-only incompleteness (no writable section, not truncated)", pc.reasons);

function mkEnv(opts) {
  const o = opts || {};
  const store = { "pipeline/r1/reconciled.md": o.paper, "pipeline/r1/grounding.md": grounding };
  const sqls = [], calls = [];
  const D1 = { prepare(sql) { let args = []; const q = { bind(...x) { args = x; return q; }, async run() { sqls.push({ sql, args }); return { meta: { changes: 1 } }; }, async first() { return args[0] === "research_floor_extend" ? { value: "off" } : null; }, async all() { return { results: [] }; } }; return q; } };
  const MIRROR = { async get(k) { const v = store[k]; return v == null ? null : { text: async () => v }; }, async put(k, v) { store[k] = v; } };
  const AI = { async run(model, input) { calls.push({ model, prompt: input.messages[0].content }); return { response: "" }; } };
  return { env: { AI, QNFO_AUDIT: D1, MIRROR }, sqls, calls, store };
}
const row = { id: "r1", context: "{}", recover_count: 0, source: "remediation", source_id: "errata:105", stage: "complete", status: "researching" };

// 1. A numbering-only structural defect is normalized deterministically, even at the recovery ceiling.
{
  const t = mkEnv({ paper: structuralPaper() });
  let res, threw = null;
  try { res = await stageComplete(t.env, Object.assign({}, row, { recover_count: 6 })); } catch (e) { threw = e; }
  ok(threw === null, "stageComplete does not throw on a structural-only incomplete paper", threw && threw.message);
  ok(res && res.ok === true && res.stage === "complete->review", "the repaired paper advances without exhausting recovery", res);
  ok(t.calls.length === 0, "no model call is spent on a paper no section can fix", t.calls.length);
  const normalized = t.store["pipeline/r1/reconciled.md"];
  const headings = normalized.match(/^## \d+\. /gm) || [];
  ok(headings.length === 8 && headings.every((h, i) => h === "## " + (i + 1) + ". "), "required headings use consecutive canonical numbers", headings);
  ok(normalized.includes("### 6.1 Discussion detail") && normalized.includes("### 7.2 Example"), "subsections follow their renumbered section while fenced examples remain unchanged");
  const rearm = t.sqls.filter((s) => /UPDATE research_queue SET status='queued', stage='ground'/.test(s.sql));
  ok(rearm.length === 0, "numbering repair avoids another whole-paper retry", t.sqls.map((s) => s.sql));
  ok(t.sqls.some((s) => /UPDATE research_queue SET stage='review'/.test(s.sql)), "the repaired paper is routed to review", t.sqls.map((s) => s.sql));
  const ev = t.sqls.filter((s) => /INSERT INTO cloud_ops_events/.test(s.sql)).map((s) => ({ kind: s.args[2], text: s.args[3] }));
  ok(ev.some((e) => e.kind === "complete-structure-numbering"), "a repair event records the deterministic normalization", ev);
}

// 2. A paper with a genuinely missing middle section still takes the section branch (regression guard for the branch order).
{
  const missing = structuralPaper().replace(sec("3. Methods", 40, 12), "");
  const pc2 = paperCompleteness(missing);
  ok(!pc2.complete && pc2.middleMissing.indexOf("Methods") >= 0, "fixture: a missing middle section lands in middleMissing", pc2.reasons);
  const t = mkEnv({ paper: missing });
  const res = await stageComplete(t.env, row);
  ok(res && res.stage !== undefined && t.calls.length >= 1 && /=== TASK: SECTION ===/.test(t.calls[0].prompt) && /SECTION TO WRITE: '## 3. Methods'/.test(t.calls[0].prompt), "a missing middle section still asks the model for exactly that section", { res, calls: t.calls.length });
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
