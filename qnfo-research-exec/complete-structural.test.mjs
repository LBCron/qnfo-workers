// COMPLETE-STRUCTURAL-1 (qnfo-research-exec 0.40.10, agent_issues 1000556-1000566 LOOP-BREAKER-1): a paper that holds every
// required section, ends cleanly and cites no missing section, yet is incomplete for a structural reason alone (duplicate or
// skipped section numbers, out-of-order headings, an appendix before the body, generation-instruction residue) fell into
// stageComplete's "section" branch with pc.middleMissing empty; PAPER_SECTION_ORDER.find(undefined) === undefined and spec.n
// threw "Cannot read properties of undefined (reading 'n')" on every claim, and the uncaught throw skipped markError, so the
// row sat claimed and the stale reaper fed it back to crash again. The row now goes through markError with its reasons.
// Offline, in-memory mocks, same shape as complete-to-floor.test.mjs.
// Run: node qnfo-research-exec/complete-structural.test.mjs   -> prints "N passed, 0 failed"
import assert from "node:assert/strict";
import { stageComplete, paperCompleteness, repairStructuralHeadings } from "./worker.js";

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
  ok(ev.some((e) => e.kind === "complete-structure-numbering" && /canonical headings restored/.test(e.text)), "the canonical eight-section case keeps its own event text (the first attempt still wins)", ev);
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

// COMPLETE-STRUCTURAL-2 (agent_issues 1000960, 1000974, 1001274): the second attempt, repairStructuralHeadings. The fixtures below
// are the shapes the live rows died on: an extension section that is no required spec (RESEARCH-FLOOR-1), duplicate numbers with
// skipped numbers together (rem-7782cea0), and a model-written "Results of ..." heading beside the real Results (5ec7f391).
const xsec = (h, from, n, extra) => "## " + h + "\n\n" + run(from, n) + (extra || "") + "\n\n";
const REFS = "## References\n\n[1] Work number 1. https://arxiv.org/abs/2401.00001\n[2] Work number 2, Section 9 of the standard. https://arxiv.org/abs/2401.00002\n";
const nums = (md) => (md.match(/^## (\d+)\./gm) || []).map((h) => Number(h.replace(/\D/g, "")));
const head = "# A paper about a model\n\n";
const abstract0 = "## 0. Abstract\n\nContext, gap, approach, result and practice are stated here in order.\n\n";
const front5 = (a) => (a || "") + sec("1. Introduction", 1, 12) + sec("2. Background and Related Work", 20, 12) + sec("3. Methods", 40, 12) + sec("4. Analysis", 60, 12) + sec("5. Results", 80, 12);
const eventsOf = (t) => t.sqls.filter((s) => /INSERT INTO cloud_ops_events/.test(s.sql)).map((s) => ({ kind: s.args[2], text: s.args[3] }));

// A. A numbered extension heading that is no required spec, one skipped number (7), "## 0." untouched, a fence untouched.
function paperA() {
  return head + front5(abstract0)
    + xsec("6. Sensitivity, Limiting Cases and Robustness Checks", 200, 12, "Section 8 shows how the limiting case feeds the discussion. ")
    + "### 6.1 Limiting case\n\nThe limiting case follows from the derivation above.\n\n"
    + sec("8. Discussion", 100, 12)
    + "### 8.1 Discussion detail\n\nThis detail belongs to the discussion; see Sections 8 and 9, and Section 10 of the Communications Act for an outside rule.\n\n```md\n### 8.2 Example\nSection 10 inside a fence.\n```\n\n"
    + sec("9. Practical Implications and Engineering Pathways", 120, 12)
    + xsec("10. Conclusion", 140, 6, "Section 10 closes the paper; Section 9 gives the pathways. ") + REFS;
}
{
  const pa = paperCompleteness(paperA());
  ok(JSON.stringify(pa.reasons) === JSON.stringify(["skipped section numbers: 7"]) && pa.middleMissing.length === 0 && !pa.truncated && pa.dangling.length === 0, "fixture A: skipped number plus an extension section", pa.reasons);
  const t = mkEnv({ paper: paperA() });
  let res, threw = null;
  try { res = await stageComplete(t.env, Object.assign({}, row, { recover_count: 6 })); } catch (e) { threw = e; }
  ok(threw === null && res && res.ok === true && res.stage === "complete->review", "A: the repaired paper advances to review even at the recovery ceiling", res || (threw && threw.message));
  ok(t.calls.length === 0, "A: no model call is spent", t.calls.length);
  const md = t.store["pipeline/r1/reconciled.md"];
  ok(JSON.stringify(nums(md)) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), "A: numbered sections are 1..9 (plus the untouched 0) and the extension keeps its slot", nums(md));
  ok(md.includes("## 0. Abstract") && md.includes("## 6. Sensitivity, Limiting Cases and Robustness Checks") && md.includes("## 7. Discussion") && md.includes("## 9. Conclusion"), "A: headings carry their text, '## 0.' is not a section");
  ok(md.includes("### 6.1 Limiting case") && md.includes("### 7.1 Discussion detail") && !md.includes("### 8.1 Discussion detail"), "A: N.x sub-headings follow the section they sit under");
  ok(md.includes("```md\n### 8.2 Example\nSection 10 inside a fence.\n```"), "A: fenced example headings and references are left alone");
  ok(md.includes("Section 7 shows how the limiting case") && md.includes("Sections 7 and 8,") && md.includes("Section 10 of the Communications Act"), "A: 'Section(s) N' references move, a reference to an outside document does not");
  ok(md.includes("Section 9 closes the paper; Section 8 gives the pathways."), "A: references are remapped in one pass (10 -> 9 and 9 -> 8 do not cascade)");
  ok(md.endsWith(REFS), "A: the References block is byte-identical");
  ok(paperCompleteness(md).complete === true, "A: the repaired paper passes paperCompleteness", paperCompleteness(md).reasons);
  ok(eventsOf(t).some((e) => e.kind === "complete-structure-numbering" && /structural headings repaired without a model call/.test(e.text)), "A: the event says which repair ran", eventsOf(t));
  ok(repairStructuralHeadings(md, ["skipped section numbers: 7"]) === null, "A: a second run changes nothing");
}

// B. rem-7782cea0 shape: duplicate 7 with skipped 6 and 8, the sub-headings belong to the section they sit under by position.
function paperB() {
  return head + front5()
    + sec("7. Discussion", 100, 12) + "### 7.1 Discussion detail\n\nSection 9 sums up the paper and Section 7 could mean either section above.\n\n"
    + sec("7. Practical Implications and Engineering Pathways", 120, 12) + "### 7.2 Practical detail\n\nThis detail belongs to the practical section.\n\n"
    + sec("9. Conclusion", 140, 6) + REFS;
}
{
  const pb = paperCompleteness(paperB());
  ok(JSON.stringify(pb.reasons) === JSON.stringify(["duplicate section numbers: 7", "skipped section numbers: 6,8"]), "fixture B: duplicate and skipped numbers together", pb.reasons);
  const t = mkEnv({ paper: paperB() });
  const res = await stageComplete(t.env, row);
  ok(res && res.ok === true && res.stage === "complete->review" && t.calls.length === 0, "B: advances to review with no model call", { res, calls: t.calls.length });
  const md = t.store["pipeline/r1/reconciled.md"];
  ok(JSON.stringify(nums(md)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]), "B: sections are 1..8", nums(md));
  ok(md.includes("## 6. Discussion") && md.includes("## 7. Practical Implications and Engineering Pathways") && md.includes("## 8. Conclusion"), "B: the duplicate old number is resolved by position");
  ok(md.includes("### 6.1 Discussion detail") && md.includes("### 7.2 Practical detail"), "B: sub-headings follow their own section, not a global map");
  ok(md.includes("Section 8 sums up the paper and Section 7 could mean either"), "B: a unique old number moves (9 -> 8), the ambiguous 7 is left alone");
  ok(paperCompleteness(md).complete === true, "B: the repaired paper passes paperCompleteness", paperCompleteness(md).reasons);
}

// C. 5ec7f391 shape: a second heading that matches the Results spec is demoted, its text and sub-sections are kept.
function paperC() {
  return head + front5()
    + xsec("6. Results of the extended study", 200, 12, "The extended study repeats the measurement. ") + "### 6.1 Extended detail\n\nThe extended detail text stays under the demoted heading.\n\n"
    + sec("7. Discussion", 100, 12) + xsec("8. Practical Implications and Engineering Pathways", 120, 12, "See Section 9 for the conclusion. ") + sec("9. Conclusion", 140, 6) + REFS;
}
{
  const pcC = paperCompleteness(paperC());
  ok(JSON.stringify(pcC.reasons) === JSON.stringify(["duplicate required section: Results"]), "fixture C: a duplicate required Results heading", pcC.reasons);
  const t = mkEnv({ paper: paperC() });
  const res = await stageComplete(t.env, row);
  ok(res && res.ok === true && res.stage === "complete->review" && t.calls.length === 0, "C: advances to review with no model call", { res, calls: t.calls.length });
  const md = t.store["pipeline/r1/reconciled.md"];
  ok(JSON.stringify(nums(md)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]), "C: sections are 1..8 after the demotion", nums(md));
  ok(md.includes("### Results of the extended study\n\n") && !/^## .*Results of the extended study/m.test(md), "C: the later Results heading is a ### heading without its number");
  ok(md.includes("#### Extended detail") && md.includes("The extended detail text stays under the demoted heading.") && md.includes("The extended study repeats the measurement."), "C: the text and the sub-section under it are kept (one level deeper, number dropped)");
  ok(md.includes("## 5. Results") && md.includes("## 6. Discussion") && md.includes("See Section 8 for the conclusion."), "C: the first Results stays and the following sections close the gap");
  ok(md.length > paperC().length - 40, "C: no content is removed", { before: paperC().length, after: md.length });
  ok(paperCompleteness(md).complete === true, "C: the repaired paper passes paperCompleteness", paperCompleteness(md).reasons);
}

// D. A defect outside the three kinds goes to markError exactly as before, even when a numbering defect rides along.
{
  const outOfOrder = head + sec("1. Introduction", 1, 12) + sec("2. Background and Related Work", 20, 12) + sec("3. Methods", 40, 12) + sec("4. Analysis", 60, 12)
    + sec("8. Discussion", 100, 12) + sec("9. Results", 80, 12) + sec("10. Practical Implications and Engineering Pathways", 120, 12) + sec("11. Conclusion", 140, 6) + REFS;
  const po = paperCompleteness(outOfOrder);
  ok(po.reasons.some((r) => /^out of order/.test(r)) && po.reasons.some((r) => /^skipped section numbers/.test(r)) && po.middleMissing.length === 0 && !po.truncated && po.dangling.length === 0, "fixture D: out of order plus skipped numbers, nothing writable", po.reasons);
  ok(repairStructuralHeadings(outOfOrder, po.reasons) === null, "D: the helper declines when any reason is outside the three kinds");
  const t = mkEnv({ paper: outOfOrder });
  const res = await stageComplete(t.env, row);
  ok(res && res.ok === false && res.stage === "complete" && res.structural === true, "D: the result is exactly the structural refusal as before", res);
  ok(t.calls.length === 0 && !t.sqls.some((s) => /stage='review'/.test(s.sql)), "D: no model call and no advance to review", t.sqls.map((s) => s.sql));
  ok(t.sqls.some((s) => /UPDATE research_queue SET status='queued', stage='ground'/.test(s.sql) && /complete: structural defects only, no writable section: out of order/.test(String(s.args[0]))), "D: markError records the reasons verbatim", t.sqls.map((s) => ({ sql: s.sql.slice(0, 60), a: String(s.args[0]).slice(0, 120) })));
  ok(t.store["pipeline/r1/reconciled.md"] === outOfOrder, "D: the stored paper is not rewritten");
  const residue = paperB().replace("## 1. Introduction\n\n", "## 1. Introduction\n\nHere is the paper you asked for. ");
  const pr = paperCompleteness(residue);
  ok(pr.reasons.some((r) => /^generation-instruction residue/.test(r)), "fixture D: residue reason present", pr.reasons);
  ok(repairStructuralHeadings(residue, pr.reasons) === null, "D: residue is never repaired by renumbering");
}

// E. Helper contract: declines unknown or empty reasons, a no-op, and a defect it cannot reach (a heading inside a code fence).
{
  const clean = head + front5() + sec("6. Discussion", 100, 12) + sec("7. Practical Implications and Engineering Pathways", 120, 12) + sec("8. Conclusion", 140, 6) + REFS;
  ok(paperCompleteness(clean).complete === true, "fixture E: a clean paper", paperCompleteness(clean).reasons);
  ok(repairStructuralHeadings(clean, []) === null && repairStructuralHeadings(clean, undefined) === null, "E: no reasons, no repair");
  ok(repairStructuralHeadings(clean, ["skipped section numbers: 3"]) === null, "E: nothing to change is null");
  ok(repairStructuralHeadings(clean, ["duplicate required section: Nope"]) === null, "E: an unknown key is not repaired");
  ok(repairStructuralHeadings(clean, ["missing: Methods"]) === null && repairStructuralHeadings(clean, ["skipped section numbers: 3", "cites missing section 9"]) === null, "E: any other reason declines");
  const fenced = paperA().replace("```md\n### 8.2 Example", "```md\n## 5. Example heading in a code block\n### 8.2 Example");
  const pf = paperCompleteness(fenced);
  ok(pf.reasons.some((r) => /^duplicate section numbers/.test(r)), "fixture E: paperCompleteness reads a heading inside a fence as a numbered section", pf.reasons);
  ok(repairStructuralHeadings(fenced, pf.reasons) === null, "E: a defect the repair cannot reach without editing a code fence returns null, not a half repair");
  const info = {};
  const fixed = repairStructuralHeadings(paperB(), paperCompleteness(paperB()).reasons, info);
  ok(typeof fixed === "string" && /moved\)$/.test(info.note || ""), "E: info.note describes the repair", info);
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
