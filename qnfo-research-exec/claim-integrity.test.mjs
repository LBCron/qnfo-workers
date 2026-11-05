// CLAIM-INTEGRITY-1 (0.22.0) suite: fabricated empirical claims are found, proposals and cited work are not, corrections apply
// and leave no claim behind, the prompts carry the rule, and the gate fails closed with no confirming model.
// Offline, no bindings. Run: node qnfo-research-exec/claim-integrity.test.mjs
import assert from "node:assert/strict";
import { fabricatedClaimScan, ciSentences, ciJsonArray, ciFind, ciLocateQuote, ciRewriteOk, ciApplyReplacements, claimAudit, claimGate, correctionNotice, withCorrection, retractionNotice, RESEARCH_SHARED_PREAMBLE, EMPIRICAL_ACT_RULE, CI_REVIEW_DIMENSION } from "./worker.js";

const wrap = (body, head = "3. Methods") => "# A Title\n\n## Abstract\n\nAn abstract.\n\n## " + head + "\n\n" + body + "\n\n## References\n\n[1] A work. arXiv:2401.00001.\n";

// Sentences taken from published papers (2026-10-19) that described work which never took place.
for (const bad of [
  "All measurements are pre‑registered, and data are deposited in an open repository.",
  "The work is purely analytical and pre‑registered; it resides at Technology Readiness Level 2 (TRL 2) per NASA definitions.",
  "- **Baseline times:** pilot measurements on a representative derivation task give $t_P=1800\\,\\mathrm{s}$ and $t_S=600\\,\\mathrm{s}$.",
  "We conducted a user study with 24 participants who rated each output on a Likert scale.",
  "Participants were asked to complete three tasks in random order.",
  "Blind expert reviewers rated the protocol outputs higher than the controls (mean 78 vs 64).",
  "Informed consent was obtained from all participants, and the study was approved by the institutional review board.",
  "Twenty researchers were recruited from three universities.",
  "The framework has been peer-reviewed by domain experts.",
  "In total, N = 420 participants completed the survey."
]) {
  const hits = fabricatedClaimScan(wrap(bad));
  assert.ok(hits.length >= 1, "missed: " + bad);
}

// Honest sentences: proposals, cited work, negations, derivations, the pipeline's own notices.
for (const ok of [
  "The smallest next experiment would recruit sixteen participants per cell in a 2 x 2 design.",
  "A pilot study could measure time-to-exhaustion under two conditions.",
  "The online experiment of [7] sampled $N=420$ participants across ten network topologies.",
  "This work has not been peer reviewed and no hardware or field trials have been performed.",
  "We derive the speedup $U = 2400/630.9 \\approx 3.8$ from the stated inputs.",
  "We assume $t_P = 1800$ s and $t_S = 600$ s.",
  "Future work should pre-register the protocol before any data are collected.",
  "Large language models were evaluated on held-out benchmarks in [3], which reports 71% accuracy."
]) {
  const hits = fabricatedClaimScan(wrap(ok));
  assert.equal(hits.length, 0, "false hit: " + ok + " :: " + JSON.stringify(hits));
}

// Skipped regions: code, display math, References, Provenance, Correction and Retraction notices.
const skipped = "# T\n\n## Abstract\n\nAn abstract sentence about bounds.\n\n```python\n# we measured participants were recruited\n```\n\n$$\nN = 420\\ participants\n$$\n\n## Correction Notice\n\n- The previous version stated: \"Twenty researchers were recruited from three universities.\" It was removed.\n\n## Provenance and AI Involvement\n\n- This paper has been peer-reviewed by experts.\n\n## References\n\n[1] Smith. Participants were recruited online. arXiv:2401.00001.\n";
assert.equal(fabricatedClaimScan(skipped).length, 0, JSON.stringify(fabricatedClaimScan(skipped)));
assert.equal(fabricatedClaimScan("# T\n\n> **Correction (version 1.0.1, 2026-10-19):** statements that described experiments as done were corrected; participants were recruited never.\n").length, 0);

// Multi-line paragraphs: the sentence is joined, and the joined quote is still found in the original text.
const ml = wrap("The design is set out below.\nTwenty researchers (ten pairs) with comparable records\nwere recruited for the study.");
const mh = fabricatedClaimScan(ml);
assert.equal(mh.length, 1);
assert.ok(ciFind(ml, mh[0].quote), "joined quote not located");
assert.equal(mh[0].section, "3. Methods");

// Model output parsing: prose and citation brackets before the JSON are skipped; an invalid reply is null.
assert.deepEqual(ciJsonArray('Looking at [1] and [2]...\n[{"quote":"x","kind":"review"}]'), [{ quote: "x", kind: "review" }]);
assert.deepEqual(ciJsonArray("none found: []"), []);
assert.equal(ciJsonArray("no json here"), null);

// A model quote counts only when it is in the paper.
const doc = wrap("All measurements are pre-registered, and data are deposited in an open repository. The bound is tight.");
assert.ok(ciLocateQuote(doc, "All measurements are pre-registered,  and data are deposited in an open repository."));
assert.equal(ciLocateQuote(doc, "We surveyed 500 engineers about the bound."), null);

// Rewrites: no new number, nothing the scan flags; empty means remove.
assert.ok(ciRewriteOk("pilot measurements give t = 1800 s", "We assume t = 1800 s."));
assert.ok(!ciRewriteOk("pilot measurements give t = 1800 s", "We assume t = 1900 s."));
assert.ok(!ciRewriteOk("x", "Twenty researchers were recruited."));
assert.ok(ciRewriteOk("anything", ""));

// Apply: the sentence is replaced or removed, and an emptied list item is dropped.
const listDoc = "# T\n\n## 3. Methods\n\n- Twenty researchers were recruited.\n- The model has two parameters.\n";
const ap = ciApplyReplacements(listDoc, [{ quote: "Twenty researchers were recruited.", replace: "" }]);
assert.equal(ap.applied.length, 1);
assert.ok(!/recruited/.test(ap.md) && !/^-\s*$/m.test(ap.md) && /two parameters/.test(ap.md), ap.md);

// Notices: the correction sits before the provenance or reference list, the banner under the title, and neither is re-flagged.
const edits = [{ quote: "All measurements are pre-registered, and data are deposited in an open repository.", kind: "registration", replace: "" }];
const fixed = ciApplyReplacements(doc, edits);
const body = withCorrection(fixed.md, correctionNotice("1.0.1", "2026-10-19", fixed.applied), "> **Correction (version 1.0.1, 2026-10-19):** see the Correction Notice.");
assert.ok(body.indexOf("## Correction Notice") < body.indexOf("## References") && /^# A Title\n\n> \*\*Correction/m.test(body), body);
assert.equal(fabricatedClaimScan(body).length, 0, JSON.stringify(fabricatedClaimScan(body)));
assert.equal((withCorrection(body, correctionNotice("1.0.2", "2026-10-20", fixed.applied), "> **Correction (version 1.0.2, 2026-10-20):** x").match(/## Correction Notice/g) || []).length, 1);
const rn = retractionNotice("A Title", "1.0.0", "2026-10-19", [{ quote: "Twenty researchers were recruited.", kind: "human-study" }]);
assert.ok(/^# Retracted: A Title/.test(rn) && /## Retraction Notice/.test(rn));
assert.equal(fabricatedClaimScan(rn).length, 0);

// Prompts: writer, reconcile, revise and patch carry the rule; the reviewer carries dimension 10.
const tasks = RESEARCH_SHARED_PREAMBLE.split(/^### TASK /m);
const task = (n) => tasks.find((t) => t.startsWith(n + "\n")) || "";
for (const n of ["WRITER", "REVISE"]) assert.ok(task(n).includes(EMPIRICAL_ACT_RULE), n);
assert.ok(task("RECONCILE").includes(EMPIRICAL_ACT_RULE.slice(2)));
assert.ok(task("REVIEW").includes(CI_REVIEW_DIMENSION));
assert.ok(/never states that the authors performed an experiment/.test(task("REVISE_PATCH")));

// The audit with a scripted model: extraction adds a sentence the scan missed, confirmation keeps only FABRICATED, and a
// missing confirmation fails closed (every candidate stands, ok false).
const paper = wrap("Pilot measurements gave $t = 1800$ s. Output quality is scored on a 0-100 scale in the proposed design. The data were deposited in a public repository.");
const envWith = (replies) => ({ QNFO_AUDIT: { prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => null }), first: async () => null }) }, AI: { run: async (model) => { const r = replies[model]; return { response: typeof r === "function" ? r() : r }; } } });
const ext = JSON.stringify([{ quote: "Output quality is scored on a 0-100 scale in the proposed design.", kind: "review", why: "x" }, { quote: "Not in the paper at all, invented.", kind: "other" }]);
const a1 = await claimAudit(envWith({ "@cf/openai/gpt-oss-120b": ext, "@cf/zai-org/glm-5.3-flash": '[{"n":1,"verdict":"FABRICATED"},{"n":2,"verdict":"FABRICATED"},{"n":3,"verdict":"PROPOSED"}]' }), paper);
assert.equal(a1.ok, true);
assert.equal(a1.candidates, 3, JSON.stringify(a1));
assert.equal(a1.confirmed.length, 2);
const a2 = await claimAudit(envWith({ "@cf/openai/gpt-oss-120b": "[]", "@cf/zai-org/glm-5.3-flash": "" }), paper);
assert.equal(a2.ok, false);
assert.equal(a2.confirmed.length, a2.candidates);
// MODEL-MATRIX-1 (agent_issues 1000709): the extraction call runs on gpt-oss-20b first and asks gpt-oss-120b the same request only when the reply is empty or unparseable;
// the confirming model is untouched; ops_config claim_scan_model = off restores gpt-oss-120b for every request.
const countingEnv = (replies, cfg) => {
  const calls = [];
  return {
    calls,
    QNFO_AUDIT: { prepare: (sql) => ({ first: async () => (/claim_scan_model/.test(sql) && cfg ? { value: cfg } : null), bind: () => ({ run: async () => ({}), first: async () => null }) }) },
    AI: { run: async (model) => { calls.push(model); const r = replies[model]; return { response: typeof r === "function" ? r() : r }; } },
  };
};
const CONFIRM = '[{"n":1,"verdict":"FABRICATED"},{"n":2,"verdict":"FABRICATED"},{"n":3,"verdict":"PROPOSED"}]';
let ce = countingEnv({ "@cf/openai/gpt-oss-20b": ext, "@cf/openai/gpt-oss-120b": "SHOULD NOT BE ASKED", "@cf/zai-org/glm-5.3-flash": CONFIRM });
let ca = await claimAudit(ce, paper);
assert.deepEqual(ce.calls, ["@cf/openai/gpt-oss-20b", "@cf/zai-org/glm-5.3-flash"], "the 20b extraction answers, the 120b is not asked");
assert.equal(ca.extractModel, "@cf/openai/gpt-oss-20b");
assert.equal(ca.candidates, 3);
assert.equal(ca.confirmed.length, 2);
ce = countingEnv({ "@cf/openai/gpt-oss-20b": "", "@cf/openai/gpt-oss-120b": ext, "@cf/zai-org/glm-5.3-flash": CONFIRM });
ca = await claimAudit(ce, paper);
assert.deepEqual(ce.calls, ["@cf/openai/gpt-oss-20b", "@cf/openai/gpt-oss-120b", "@cf/zai-org/glm-5.3-flash"], "an empty 20b reply is asked again of the 120b for the same request");
assert.equal(ca.extractModel, "@cf/openai/gpt-oss-120b");
assert.equal(ca.confirmed.length, 2);
ce = countingEnv({ "@cf/openai/gpt-oss-20b": "I could not produce JSON, sorry.", "@cf/openai/gpt-oss-120b": ext, "@cf/zai-org/glm-5.3-flash": CONFIRM });
ca = await claimAudit(ce, paper);
assert.equal(ca.extractModel, "@cf/openai/gpt-oss-120b", "an unparseable 20b reply falls back too");
ce = countingEnv({ "@cf/openai/gpt-oss-20b": "[]", "@cf/openai/gpt-oss-120b": ext, "@cf/zai-org/glm-5.3-flash": CONFIRM });
ca = await claimAudit(ce, paper);
assert.equal(ca.extractModel, "@cf/openai/gpt-oss-20b", "a valid empty list is an answer, not a reason to ask again");
assert.ok(!ce.calls.includes("@cf/openai/gpt-oss-120b"));
ce = countingEnv({ "@cf/openai/gpt-oss-20b": ext, "@cf/openai/gpt-oss-120b": ext, "@cf/zai-org/glm-5.3-flash": CONFIRM }, "off");
ca = await claimAudit(ce, paper);
assert.deepEqual(ce.calls, ["@cf/openai/gpt-oss-120b", "@cf/zai-org/glm-5.3-flash"], "ops_config claim_scan_model = off skips the 20b entirely");
assert.equal(ca.extractModel, "@cf/openai/gpt-oss-120b");
ce = countingEnv({ "@cf/openai/gpt-oss-20b": ext, "@cf/zai-org/glm-5.3-flash": "" });
ca = await claimAudit(ce, paper, { scanOnly: true });
assert.deepEqual(ce.calls, [], "scanOnly asks no model at all");

const gates = { ok: true, fixes: [], reason: "" };
await claimGate(envWith({ "@cf/openai/gpt-oss-120b": "[]", "@cf/zai-org/glm-5.3-flash": "" }), { id: 1 }, paper, gates);
assert.equal(gates.ok, false);
assert.equal(gates.fixes[0].id, "gate-fabricated-claim");
const g2 = { ok: true, fixes: [], reason: "" };
await claimGate(envWith({ "@cf/openai/gpt-oss-120b": "[]", "@cf/zai-org/glm-5.3-flash": "[]" }), { id: 2 }, wrap("We derive the bound from the stated inputs."), g2);
assert.equal(g2.ok, true);

console.log("claim-integrity: all assertions passed");
