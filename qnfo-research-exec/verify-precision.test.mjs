// qnfo-research-exec 0.13.0 offline suite (node:sqlite as the D1 shim; no network, synthetic data). Proves:
//  1. VERIFY-STATED-PRECISION-1: a CLAIM line is decided at the precision the paper states, so a correctly rounded value
//     matches and a wrong digit does not; the two live outputs that failed on 2026-10-12 are replayed;
//  2. VERIFY-UNRUN-1: a verification that printed no CLAIM line never passes; it waits, retries, then fails;
//  3. GATE-STRUCTURE-1: a new paper without its closing sections fails the deterministic gates;
//  4. REVIEW-HARD-GATE-1: HARD findings left at the cycle cap withhold the paper (measure mode restores the old advance);
//  5. REVISE-NO-UNREVISED-1 and REVISE-PATCH-GROUND-1: no applied edit never advances; a memory-written link is skipped;
//  6. CITATION-UNVERIFIED-HOLD-1: an unconfirmed citation defers, then holds with the revert line the expiry tick reads;
//  7. RESEARCH-PARK-REVIEW-1: a review row parks; a waiting row is an idle slot; a withheld paper is a warn event;
//  8. AI-ROUTER-SECOND-PATH-DRILL-1: the drill records the tested alternate only when both halves hold, once a day.
// Run: node qnfo-research-exec/verify-precision.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { versionAtLeast } from "../scripts/version-at-least.mjs";
import worker, { adjudicateVerification, numLit, statedLiterals, finalGates, stageVerify, stageReview, stageRevise, publishStageV2, runSlot, applyRevisePatch, laneReenter, doneStatus, routerSecondPathDrill, routerDrillDue, VERIFY_GEN_PROMPT, REVISE_PATCH_PROMPT } from "./worker.js";

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
globalThis.setTimeout = (fn) => { fn(); return 0; };
const realFetch = globalThis.fetch;

// ---- 1. adjudication ------------------------------------------------------------------------------------------------
ok(numLit("4.2800e-21").sig === 5 && numLit("0.0553679").sig === 6 && numLit("121,306,200").value === 121306200 && numLit("none") === null && numLit(".5").value === 0.5, "numLit reads digits, exponent and separators");
ok(statedLiterals("$n_{c}\\approx1.36\\times10^{8}\\ \\text{m}^{-2}$").some((l) => l.digits === "136" && l.sig === 3), "a LaTeX scientific literal is read with its digits");
ok(statedLiterals("Critical pitch is $\\ell_{c}\\approx86\\ \\mu\\text{m}$.").some((l) => l.digits === "86" && l.sig === 2), "a literal next to a LaTeX command is read");
// Live output of row a2033fc2 (2026-10-12): six of eight correct values printed match=no at rel_tol 1e-6.
const claimsA = [
  { id: "Q1", statement: "Thermal energy at 310 K: k_B*T = 4.2800e-21 J" },
  { id: "Q2", statement: "Cluster volume V_c = 5.236e-28 m^3 for r_c = 0.5 nm" },
  { id: "Q3", statement: "Rotational correlation time prefactor: tau_R = 1.537e-6 * eta s" },
  { id: "Q4", statement: "Static-limit coherence floor T2_static = 92.26 microseconds for delta_B_rms = 1e-4 T" },
  { id: "Q5", statement: "gamma^2 * <delta B^2> = 1.174839e8 s^-2" },
  { id: "Q6", statement: "Rotational dephasing rate coefficient A = 180.6101 s^-1 per Pa*s" },
  { id: "Q7", statement: "T2* = 5.5368 s at eta = 1e-3 Pa*s (rotational channel)" },
  { id: "Q8", statement: "T2* = 55.37 ms at eta = 0.1 Pa*s (rotational channel)" }
];
const outA = ["CLAIM Q1: computed=4.28001e-21 expected=4.28e-21 match=no", "CLAIM Q2: computed=5.23599e-28 expected=5.236e-28 match=no", "CLAIM Q3: computed=1.53732e-06 expected=1.537e-06 match=no", "CLAIM Q4: computed=9.22594e-05 expected=9.226e-05 match=no", "CLAIM Q5: computed=1.17484e+08 expected=1.17484e+08 match=yes", "CLAIM Q6: computed=180.61 expected=180.61 match=yes", "CLAIM Q7: computed=5.53679 expected=5.5368 match=no", "CLAIM Q8: computed=0.0553679 expected=0.05537 match=no", "VERIFICATION SUMMARY: 8 claims, 8 match, 0 mismatch", "", "[exit 0]"].join("\n");
let adj = adjudicateVerification(outA, claimsA);
ok(adj.ran && adj.rows.length === 8 && adj.mismatches === 0, "row a2033fc2: eight correctly rounded values are eight matches", adj.rows.filter((r) => !r.match));
ok(adj.rows[0].basis.indexOf("5 significant digits (as the paper states") === 0, "the precision comes from the paper's own literal (4.2800e-21 has five digits)", adj.rows[0]);
// Live output of row 5aa098d9: values the paper states to two or three digits.
const claimsB = [
  { id: "Q5", statement: "Linearized critical density is $n_{c}^{\\text{lin}}\\approx9.1\\times10^{6}\\ \\text{m}^{-2}$." },
  { id: "Q6", statement: "Exact critical density is $n_{c}\\approx1.36\\times10^{8}\\ \\text{m}^{-2}$." },
  { id: "Q7", statement: "Critical pitch is $\\ell_{c}\\approx86\\ \\mu\\text{m}$." }
];
adj = adjudicateVerification("CLAIM Q5: computed=9.091e+06 expected=9.100e+06 match=no\nCLAIM Q6: computed=1.364e+08 expected=1.360e+08 match=no\nCLAIM Q7: computed=8.563e-05 expected=8.600e-05 match=no", claimsB);
ok(adj.mismatches === 0, "row 5aa098d9: values stated to two and three digits match their unrounded computation", adj.rows);
// A wrong digit still fails, whatever the script says.
adj = adjudicateVerification("CLAIM Q1: computed=4.31001e-21 expected=4.28e-21 match=no\nCLAIM Q2: computed=3.0 expected=2.5 match=yes\nCLAIM Q6: computed=1.42e+08 expected=1.36e+08 match=yes", claimsA.concat(claimsB));
ok(adj.mismatches === 3 && adj.rows.every((r) => !r.match), "a wrong digit is a mismatch even when the script printed match=yes", adj.rows);
// Precision floors: a stated 1.0 accepts 1.04 (rounds to 1.0) and refuses 1.06; with no literal in the statement the printed digits rule, at least three.
adj = adjudicateVerification("CLAIM A: computed=1.04e-13 expected=1.000e-13 match=no\nCLAIM B: computed=1.06e-13 expected=1.000e-13 match=no\nCLAIM C: computed=2.004 expected=2 match=no\nCLAIM D: computed=2.02 expected=2 match=no\nCLAIM E: computed=0 expected=0.0 match=yes\nCLAIM F: computed=1e-3 expected=0 match=yes", [{ id: "A", statement: "P = $1.0\\times10^{-13}$ W" }, { id: "B", statement: "P = $1.0\\times10^{-13}$ W" }]);
ok(adj.rows.map((r) => r.match).join() === "true,false,true,false,true,false", "half a unit in the last stated digit; three digits when the paper's literal is not found; zero is exact", adj.rows.map((r) => [r.id, r.match, r.basis]));
adj = adjudicateVerification("CLAIM Q1: computed=True expected=none match=no\nCLAIM Q2: computed=3/4 expected=3/4 match=yes", []);
ok(adj.ran && adj.mismatches === 1 && adj.rows[1].match === true && /script verdict/.test(adj.rows[0].basis), "a line whose values are not both numbers keeps the script's verdict", adj.rows);
ok(adjudicateVerification("Traceback (most recent call last):\n  ZeroDivisionError\n[exit 1]", claimsA).ran === false && adjudicateVerification("", []).ran === false, "no CLAIM line means the verification did not run");
ok(/exactly the digits the paper states/.test(VERIFY_GEN_PROMPT) && !/rel_tol=1e-6/.test(VERIFY_GEN_PROMPT), "the script is told to print the paper's digits, not to compare at 1e-6");
ok(/adds no name, citation, identifier, link, number or finding from memory/.test(REVISE_PATCH_PROMPT), "the patch reviser may state only what the paper or the fixes state");

// ---- shared fixtures ------------------------------------------------------------------------------------------------
const audit = new DatabaseSync(":memory:");
audit.exec(`CREATE TABLE research_queue (id TEXT PRIMARY KEY, source TEXT, source_id TEXT, idea TEXT, summary TEXT, status TEXT DEFAULT 'queued', stage TEXT, claimed_at TEXT, attempt INTEGER DEFAULT 0, context TEXT, error TEXT, recover_count INTEGER DEFAULT 0, revise_count INTEGER DEFAULT 0, terminal_rearms INTEGER DEFAULT 0, paper_slug TEXT, published_at TEXT, doi TEXT);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE spof_registry (component TEXT PRIMARY KEY, alternate_tested_at TEXT);
INSERT INTO spof_registry (component) VALUES ('qnfo-ai router');`);
const lp = new DatabaseSync(":memory:");
lp.exec("CREATE TABLE papers (identifier TEXT, slug TEXT, title TEXT, abstract TEXT, body_md TEXT, status TEXT, doi TEXT);");
const d1 = (db) => ({ prepare(sql) {
  let args = [];
  const o = { bind(...a) { args = a; return o; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; } };
  return o;
} });
const r2 = new Map();
const ai = { calls: [], answer: () => "" };
let pilotOut = "";
const env = {
  QNFO_AUDIT: d1(audit), LIVING_PAPER: d1(lp),
  MIRROR: { async put(k, v) { r2.set(k, v); }, async get(k) { return r2.has(k) ? { text: async () => r2.get(k) } : null; } },
  AI: { async run(model, input) { const p = input.messages[0].content; const task = (p.match(/=== TASK: ([A-Z_]+) ===/) || [])[1] || "?"; ai.calls.push({ model, task }); return { response: ai.answer(task, model, p) }; } },
  CONTAINERS_PILOT: { async fetch() { return new Response(JSON.stringify({ ok: true, result: { exitCode: 0, stdout: pilotOut, stderr: "" } })); } }
};
const filler = "The derivation proceeds from the stated inputs and each step is written out in full so that a reader can follow it. ";
const paperMd = (opts) => {
  const o = opts || {};
  const sec = (h) => "## " + h + "\n\n" + filler.repeat(22) + "\n\n";
  return "# A Test Paper On Rounded Values\n\n" + sec("Abstract") + sec("1. Introduction") + "## 2. Background and Related Work\n\nPrior work [1], [2], [3], [4], [5], [6], [7], [8] frames the question. " + filler.repeat(20) + "\n\n" + sec("3. Methods") + sec("4. Analysis") + (o.truncated ? "" : sec("5. Results") + sec("6. Discussion") + sec("7. Practical Implications and Engineering Pathways") + sec("8. Conclusion")) + "## References\n\n[1] placeholder\n";
};
const grounding = "# Grounding block\n\n## Bibliography (cite ONLY these; keep this exact order and numbering)\n\n" + Array.from({ length: 8 }, (_, i) => "[" + (i + 1) + "] arXiv:2601.0100" + i + " | Title " + i + "\n  Summary " + i).join("\n");
const put = (id, opts) => { r2.set("pipeline/" + id + "/reconciled.md", paperMd(opts)); r2.set("pipeline/" + id + "/grounding.md", grounding); };
const row = (id, stage, context, extra) => {
  const e = extra || {};
  audit.prepare("INSERT INTO research_queue (id, source, source_id, idea, status, stage, context, recover_count, paper_slug) VALUES (?, 'proposal', '1', 'an idea', ?, ?, ?, ?, ?)").run(id, e.status || "researching", stage, context ? JSON.stringify(context) : null, e.recover || 0, e.slug || null);
  return get(id);
};
const get = (id) => audit.prepare("SELECT * FROM research_queue WHERE id = ?").get(id);
const events = (kind) => audit.prepare("SELECT text, status FROM cloud_ops_events WHERE kind = ? ORDER BY rowid").all(kind);
const claimsJson = JSON.stringify([{ id: "Q1", statement: "k_B*T = 4.2800e-21 J", inputs: "k_B = 1.380649e-23 J/K; T = 310 K", formula: "k_B*T" }]);
const verifyAnswer = (task) => task === "VERIFY_EXTRACT" ? claimsJson : task === "VERIFY_GEN" ? "```python\nprint('CLAIM Q1: computed=%s expected=4.2800e-21 match=yes' % (1.380649e-23 * 310))\n```" : "";

// ---- 3. structure gate -----------------------------------------------------------------------------------------------
let g = finalGates(paperMd({ truncated: true }) , { bibCount: 8, minChars: 100, structure: true });
ok(g.fixes.some((f) => f.id === "gate-structure" && /Results, Discussion, Practical Implications, Conclusion/.test(f.claim)), "a paper that stops before its closing sections fails gate-structure", g.reason);
ok(!finalGates(paperMd({ truncated: true }), { bibCount: 8, minChars: 100 }).fixes.some((f) => f.id === "gate-structure"), "a remediation paper keeps its own structure");
ok(!finalGates(paperMd(), { bibCount: 8, minChars: 100, structure: true }).fixes.some((f) => f.id === "gate-structure"), "a complete paper passes gate-structure");

// ---- 1b/2. stageVerify ---------------------------------------------------------------------------------------------
ai.answer = verifyAnswer;
put("v-ok"); pilotOut = "CLAIM Q1: computed=4.2800119e-21 expected=4.28e-21 match=no\nVERIFICATION SUMMARY: 1 claims, 0 match, 1 mismatch";
let res = await stageVerify(env, row("v-ok", "verify", { cycles: 1, verifyPass: 0 }));
ok(res.ok === true && res.stage === "verify->publish" && get("v-ok").status === "review" && get("v-ok").stage === "publish", "a correctly rounded claim goes to publish although the script printed match=no", res);
ok(/## Adjudication/.test(r2.get("pipeline/v-ok/verification.md")) && /\| Q1 \| 4\.2800119e-21 \| 4\.28e-21 \| no \| match \|/.test(r2.get("pipeline/v-ok/verification.md")), "the published verification report shows the script's column and the decision");
put("v-bad"); pilotOut = "CLAIM Q1: computed=4.3100119e-21 expected=4.2800e-21 match=no";
res = await stageVerify(env, row("v-bad", "verify", { cycles: 1, verifyPass: 0 }));
ok(res.ok === true && res.stage === "verify->revise" && res.mismatch === true && /independently computed 4\.3100119e-21, the paper states 4\.2800e-21/.test(r2.get("pipeline/v-bad/fixes.json")), "a wrong value goes to revise with the computed and stated numbers", res);
const goldenClaims = [{ id: "Q1", statement: "Q1 = 1.0" }, { id: "Q2", statement: "Q2 = 2.0" }];
ai.answer = (task) => task === "VERIFY_EXTRACT" ? JSON.stringify(goldenClaims) : task === "VERIFY_GEN" ? "```python\nprint('CLAIM Q1: computed=1.000 expected=1.000 match=yes\\nCLAIM Q2: computed=3.000 expected=2.000 match=no')\n```" : "";
pilotOut = "CLAIM Q1: computed=1.000 expected=1.000 match=yes\nCLAIM Q2: computed=3.000 expected=2.000 match=no";
put("v-golden-metrics");
res = await stageVerify(env, row("v-golden-metrics", "verify", { cycles: 1, verifyPass: 0 }));
const goldenRates = audit.prepare("SELECT catch_rate, false_positive_rate, model_version, prompt_version FROM research_golden_runs WHERE row_id = 'v-golden-metrics'").get();
ok(res.stage === "verify->revise" && goldenRates && goldenRates.catch_rate === 0.5 && goldenRates.false_positive_rate === 0 && goldenRates.catch_rate + goldenRates.false_positive_rate !== 1 && goldenRates.model_version && goldenRates.prompt_version, "golden-run rates are independent and retain model and prompt versions", { res, goldenRates });
put("v-bad2");
res = await stageVerify(env, row("v-bad2", "verify", { cycles: 1, verifyPass: 1 }));
ok(res.ok === false && res.withheld === "verify-unresolved" && res.mismatches === 1 && get("v-bad2").status === "queued" && /mismatch=true gates=$/.test(get("v-bad2").error), "a second failing pass withholds the paper and re-arms the row, as before", res);
put("v-trunc", { truncated: true }); pilotOut = "CLAIM Q1: computed=4.2800119e-21 expected=4.28e-21 match=yes";
res = await stageVerify(env, row("v-trunc", "verify", { cycles: 1, verifyPass: 0 }));
ok(res.stage === "verify->complete" && get("v-trunc").stage === "complete" && res.incomplete.some((r) => /missing: Results, Discussion, Practical, Conclusion/.test(r)), "a truncated paper goes back to the complete stage before any verification (PAPER-COMPLETE-1)", res);
put("v-unrun"); pilotOut = "Traceback (most recent call last):\nNameError: name 'x' is not defined";
let nCalls = ai.calls.length;
res = await stageVerify(env, row("v-unrun", "verify", { cycles: 1, verifyPass: 0 }));
ok(res.ok === false && res.unrun === 1 && get("v-unrun").stage === "verify" && get("v-unrun").status === "researching" && JSON.parse(get("v-unrun").context).verifyUnrun === 1, "a script that printed no CLAIM line is not a pass: the row stays in verify", res);
nCalls = ai.calls.length;
res = await stageVerify(env, get("v-unrun"));
ok(res.ok === true && !!res.deferred && ai.calls.length === nCalls, "the retry waits without a model call", res);
let slot = await runSlot(env, 0, 2, [get("v-unrun")]);
ok(slot.status === "ok" && slot.claimed === 0 && slot.deferred === true, "a waiting row is an idle slot, so the tick loop does not spin on it", slot);
audit.prepare("UPDATE research_queue SET context = ? WHERE id = 'v-unrun'").run(JSON.stringify({ cycles: 1, verifyPass: 0, verifyUnrun: 2, verifyUnrunAt: "2020-01-01T00:00:00Z" }));
res = await stageVerify(env, get("v-unrun"));
ok(res.ok === false && res.unrun === 3 && get("v-unrun").status === "queued" && /produced no result in 3 attempts/.test(get("v-unrun").error), "after three attempts the pass fails with its reason", get("v-unrun").error);
ok(events("verify-unrun").length === 2 && events("verify-adjudication").length >= 3, "unrun and adjudication events are recorded");

// ---- 4. review gate --------------------------------------------------------------------------------------------------
const reviewJson = (ids) => JSON.stringify({ verdict: ids.length ? "revise" : "pass", hard: ids.map((id) => ({ id, severity: "HARD", claim: "c", reason: "r", fix: "f" })), soft: [] });
ai.answer = (task) => task === "REVIEW" ? reviewJson(["H1", "H2"]) : "";
put("r-low");
res = await stageReview(env, row("r-low", "review", { cycles: 0 }));
ok(res.stage === "review->revise" && get("r-low").stage === "revise", "below the cycle cap HARD findings go to revise, as before", res);
audit.prepare("INSERT INTO ops_config (key, value) VALUES ('research_max_review_cycles', '2')").run();
put("r-cap");
res = await stageReview(env, row("r-cap", "review", { cycles: 2 }));
// The configured review-cycle cap ends this pass for HARD findings: the paper is withheld (never published) and, since SINGLE-LANE-1, re-enters the lane at revise with a fresh budget instead of being parked.
ok(res.ok === false && res.withheld === "review-hard" && res.hardLeft === 2 && get("r-cap").status === "queued" && get("r-cap").stage === "revise" && /^SINGLE-LANE-1: re-entered at revise, no parked state\. Was: review: 2 HARD findings unresolved after 2 revise cycles \(H1,H2\)/.test(get("r-cap").error), "at the cap a paper with unresolved HARD findings is withheld and re-enters the lane at revise (never parked, never published)", get("r-cap"));
audit.prepare("INSERT INTO ops_config (key, value) VALUES ('research_review_gate', 'measure')").run();
put("r-measure");
res = await stageReview(env, row("r-measure", "review", { cycles: 2 }));
ok(res.stage === "review->verify" && res.hardLeft === 2 && get("r-measure").stage === "verify", "research_review_gate = measure restores the advance without a deploy", res);
audit.prepare("DELETE FROM ops_config WHERE key = 'research_review_gate'").run();
ai.answer = (task) => task === "REVIEW" ? "not json at all" : "";
put("r-parse");
res = await stageReview(env, row("r-parse", "review", { cycles: 2 }));
ok(res.stage === "review->review" && res.reparse === 1 && get("r-parse").stage === "review", "an unreadable review at the cap is run again, not counted as a finding", res);
audit.prepare("UPDATE research_queue SET context = ? WHERE id = 'r-parse'").run(JSON.stringify({ cycles: 2, reparse: 2 }));
res = await stageReview(env, get("r-parse"));
ok(res.ok === false && res.withheld === "review-hard", "a review that stays unreadable withholds the paper", res);
audit.prepare("DELETE FROM ops_config WHERE key = 'research_max_review_cycles'").run();
ai.answer = (task) => task === "REVIEW" ? reviewJson([]) : "";
put("r-pass");
res = await stageReview(env, row("r-pass", "review", { cycles: 2 }));
ok(res.stage === "review->verify" && res.hardLeft === 0, "a clean review advances", res);

// ---- 5. revise ---------------------------------------------------------------------------------------------------------
const hardFixes = JSON.stringify([{ id: "H1", severity: "HARD", claim: "c", reason: "r", fix: "f" }]);
const goodEdit = JSON.stringify([{ find: "Prior work [1], [2], [3], [4], [5], [6], [7], [8] frames the question.", replace: "Prior work [1], [2], [3], [4], [5], [6], [7], [8] frames the question precisely." }]);
const badEdit = JSON.stringify([{ find: "a sentence that does not occur anywhere in this paper at all", replace: "x" }]);
put("s-noop"); r2.set("pipeline/s-noop/fixes.json", hardFixes);
ai.answer = () => badEdit; nCalls = ai.calls.length;
res = await stageRevise(env, row("s-noop", "revise", { cycles: 0 }));
let used = ai.calls.slice(nCalls).map((c) => c.model);
ok(res.ok === false && res.withheld === "revise-noop" && get("s-noop").status === "researching" && get("s-noop").stage === "revise" && /^RERUN-ROUTE-1 revise-once: revise: .*not advanced unrevised/.test(get("s-noop").error) && used.length === 3 && new Set(used).size === 3 && /kimi/.test(used[2]) && !/kimi/.test(used[0] + used[1]), "no applied edit from gpt-oss-120b, glm-5.3-flash and the kimi-k2.6 last resort fails the pass; the paper never advances unrevised", { res, used });
put("s-second"); r2.set("pipeline/s-second/fixes.json", hardFixes);
ai.answer = (task, model) => /gpt-oss/.test(model) ? goodEdit : badEdit;
res = await stageRevise(env, row("s-second", "revise", { cycles: 0 }));
ok(res.ok === true && res.stage === "revise->review" && res.patch === 1 && /frames the question precisely/.test(r2.get("pipeline/s-second/reconciled.md")), "the second model's edit is applied when the first applied none", res);
put("s-parse"); r2.set("pipeline/s-parse/fixes.json", JSON.stringify([{ id: "review-parse", severity: "HARD", claim: "review output", reason: "unparseable review output", fix: "re-run review" }]));
ai.answer = () => "[]";
res = await stageRevise(env, row("s-parse", "revise", { cycles: 1 }));
ok(res.ok === true && res.rereview === true && get("s-parse").stage === "review" && JSON.parse(get("s-parse").context).cycles === 1, "an unreadable review is run again without counting a revise cycle", res);
const base = "A".repeat(30) + " the first result is stated here in a full sentence. " + "B".repeat(30) + " the second result is stated here in a full sentence.";
let ap = applyRevisePatch(base, JSON.stringify([{ find: "the first result is stated here in a full sentence.", replace: "the first result follows Smith (https://example.org/smith-2020)." }, { find: "the second result is stated here in a full sentence.", replace: "the second result is stated here." }]));
ok(ap.applied === 1 && ap.ungrounded === 1 && !/example\.org/.test(ap.text) && /second result is stated here\./.test(ap.text), "an edit that brings in a link the paper does not carry is skipped; the other edit applies", ap);
ap = applyRevisePatch(base + " See arXiv:2601.01000.", JSON.stringify([{ find: "the first result is stated here in a full sentence.", replace: "the first result is in arXiv:2601.01000 and doi 10.1234/abcd." }]));
ok(ap.applied === 0 && ap.ungrounded === 1, "an identifier already in the paper is fine, a new DOI is not", ap);

// ---- 6. citation hold --------------------------------------------------------------------------------------------------
const body = "# P\n\n" + filler.repeat(190) + "\n\nSee [1].\n\n## References\n\n[1] Title 0. arXiv:2601.01000. https://arxiv.org/abs/2601.01000\n";
lp.prepare("INSERT INTO papers (identifier, slug, title, abstract, body_md, status) VALUES ('qnf-c1', 'c1-slug', 'P', 'A', ?, 'draft')").run(body);
let fetches = 0;
globalThis.fetch = async () => { fetches++; return new Response("down", { status: 503 }); };
row("c1", "publish", { cycles: 1 }, { status: "review", slug: "c1-slug" });
res = await publishStageV2(env, get("c1"));
ok(res.ok === true && /^citation unconfirmed/.test(res.deferred) && get("c1").status === "review" && !!JSON.parse(get("c1").context).citeSince && fetches >= 2, "an unconfirmed citation does not publish: the row waits in review", res);
ok(lp.prepare("SELECT status FROM papers WHERE slug = 'c1-slug'").get().status === "draft", "the paper is not published");
fetches = 0;
res = await publishStageV2(env, get("c1"));
ok(res.deferred === "citation check retry pending" && fetches === 0, "the retry is spaced: no lookup within five minutes", res);
audit.prepare("UPDATE research_queue SET context = ? WHERE id = 'c1'").run(JSON.stringify({ cycles: 1, citeSince: new Date(Date.now() - 40 * 6e4).toISOString(), citeLast: new Date(Date.now() - 10 * 6e4).toISOString() }));
res = await publishStageV2(env, get("c1"));
const held = get("c1");
ok(res.ok === false && res.held === true && res.withheld === "citation-unverified" && held.status === "held" && /^CITATION-UNVERIFIED: /.test(held.error) && held.error.indexOf("Revert: status review, stage publish") > 0 && !JSON.parse(held.context).citeSince, "after thirty minutes the row is held with the revert line the six-hour expiry tick releases", held);
ok(lp.prepare("SELECT status FROM papers WHERE slug = 'c1-slug'").get().status === "draft" && events("citation-hold").length === 1, "held, logged, still unpublished");
globalThis.fetch = realFetch;

// ---- 7. lane re-entry (was: park), done status ----------------------------------------------------------------------------------------------
row("p-review", "publish", null, { status: "review", recover: 3 });
await laneReenter(env, get("p-review"), { kind: "poison", prior: "publish", reason: "recover_count exhausted (3); last error: publish: boom" });
ok(get("p-review").status === "queued" && get("p-review").stage === "ground" && /^SINGLE-LANE-1: re-entered at ground, no parked state\. Was: .*publish: boom/.test(get("p-review").error), "a failing publish-stage row in status review re-enters the lane (RESEARCH-PARK-REVIEW-1: it was parked)", get("p-review"));
ok(doneStatus({ ok: false, stage: "verify", unrun: 1, cause: "script-error", retry: true }) === "warn" && doneStatus({ ok: false, stage: "verify", unrun: 3, cause: "script-error" }) === "error", "RETRY-NOT-ERROR-1: a retry still in budget is a warn; the exhausted pass is an error");
ok(doneStatus({ ok: true }) === "ok" && doneStatus({ ok: false, withheld: "review-hard" }) === "warn" && doneStatus({ ok: false, stage: "verify" }) === "error", "a withheld paper is a warn event; a broken stage stays an error");

// ---- 8. router drill ---------------------------------------------------------------------------------------------------
let routerStatus = 503, drillBody = null;
env.QNFO_AI = { async fetch(url, init) { drillBody = JSON.parse(init.body); return new Response("drill", { status: routerStatus }); } };
ai.answer = () => "OK";
ok(await routerDrillDue(env) === true, "the drill is due when no router-second-path event exists today");
let dr = await routerSecondPathDrill(env);
ok(dr.router503 && dr.direct && dr.recorded && drillBody.drill === "router-down" && drillBody.max_tokens === 16 && ai.calls[ai.calls.length - 1].model === "@cf/zai-org/glm-5.3-flash", "503 from the router and a direct answer record the tested alternate", dr);
ok(/^\d{4}-\d\d-\d\dT/.test(audit.prepare("SELECT alternate_tested_at t FROM spof_registry WHERE component = 'qnfo-ai router'").get().t) && events("router-second-path")[0].status === "ok", "spof_registry carries the test time and the event is ok");
ok(await routerDrillDue(env) === false, "once a UTC day");
audit.prepare("UPDATE spof_registry SET alternate_tested_at = NULL").run();
routerStatus = 200;
dr = await routerSecondPathDrill(env);
ok(!dr.router503 && !dr.recorded && audit.prepare("SELECT alternate_tested_at t FROM spof_registry").get().t === null && events("router-second-path")[1].status === "warn", "a router that does not answer the drill records nothing and warns", dr);
delete env.QNFO_AI;

// ---- version -------------------------------------------------------------------------------------------------------------
const h = await (await worker.fetch(new Request("https://qnfo-research-exec.example/health"), env, { waitUntil() {}, props: null })).json();
ok(versionAtLeast(h.version, "0.13.0"), "VERSION is at least 0.13.0", h.version);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
