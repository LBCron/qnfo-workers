// MATH-LATEX-2 (#1891) offline test (node:sqlite as D1 shim, a Map as the R2 mirror, a stubbed QNFO_AI router).
// Proves: pseudoMathScan counts plain-text math (Unicode super/subscripts and operators, bare ^ and _ scripts, box-drawing
// lines) and ignores LaTeX, code, links, snake_case and the References list; every prompt that writes paper text carries
// the LaTeX rule; review turns plain-text math into a HARD gate-math-latex finding that goes to revise (no model call to
// decide it) and leaves a LaTeX paper alone; verify logs a math-scan event; in the default measure mode it still publishes;
// with ops_config research_math_gate=enforce the first failing pass goes back to revise and a second, math-only failing
// pass parks the row (no re-arm). MATH-LATEX-AUTOFIX-1 (agent_issues 100027): the forms that have one LaTeX spelling are
// converted with no model call in review, revise and verify, so only what the converter leaves (box drawings, a line that
// already holds currency) still reaches the models and the park.
// Run: node qnfo-research-exec/math-latex.test.mjs   -> prints "math-latex tests passed"
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pseudoMathScan, mathLatexAutofix, stageReview, stageRevise, stageVerify } from "./worker.js";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");

// 1. the scanner
const plain = "The rate is 10⁻⁴ with T₁ ≈ 5 us and E = E_g 8 d^3 per gate.";
assert.ok(pseudoMathScan(plain).count >= 5, "plain-text math counted: " + JSON.stringify(pseudoMathScan(plain)));
const latex = "The rate is $10^{-4}$ with $T_1 \\approx 5$ us and\n\n$$E = E_g 8 d^3$$\n\nper gate; see `file_name`, [x](https://x.org/a_b) and snake_case_name or x_train.";
assert.equal(pseudoMathScan(latex).count, 0, "LaTeX, code, links and snake_case are not counted: " + JSON.stringify(pseudoMathScan(latex)));
const refs = "# T\n\nBody $x$.\n\n## References\n\n[1] Qubit T₁ ≈ 10⁻⁴ limits. arXiv:2401.00001.\n";
assert.equal(pseudoMathScan(refs).count, 0, "the References list is not scanned");
assert.equal(pseudoMathScan("```\nx^2 + y_1 ≈ 3\n```\n").count, 0, "fenced code is not scanned");
assert.equal(pseudoMathScan("Text\n┌──┐\n└──┘\n").count, 2, "box-drawing lines outside a fence are counted");
assert.ok(pseudoMathScan(plain).samples.length > 0, "samples are returned for the fix text");

// 2. every prompt that writes paper text carries the rule
// PROMPT-CACHE-PREFIX-1 (#2116): the task instructions live in RESEARCH_SHARED_PREAMBLE under "### TASK <NAME>" headings.
const pre = (() => { const a = src.indexOf("var RESEARCH_SHARED_PREAMBLE = ["); return src.slice(a, src.indexOf("].join(", a)); })();
const block = (name) => { const tag = "### TASK " + name.replace(/_PROMPT$/, ""); const a = pre.indexOf('"' + tag + '"'); assert.ok(a >= 0, tag + " present"); const b = pre.indexOf('"### TASK ', a + tag.length + 2); return pre.slice(a, b < 0 ? undefined : b); };
for (const name of ["WRITER_PROMPT", "RECONCILE_PROMPT", "REVISE_PROMPT"]) assert.ok(/MATH_RULE/.test(block(name)), name + " carries MATH_RULE");
assert.ok(/LaTeX/.test(block("REVISE_PATCH_PROMPT")), "REVISE_PATCH_PROMPT asks for LaTeX in replacements");

// shims
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE research_queue (id TEXT PRIMARY KEY, status TEXT, stage TEXT, context TEXT, source TEXT, claimed_at TEXT, attempt INTEGER DEFAULT 0, error TEXT, recover_count INTEGER DEFAULT 0, revise_count INTEGER DEFAULT 0, terminal_rearms INTEGER DEFAULT 0);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);`);
function stmt(sql) {
  let args = [];
  const o = { bind(...a) { args = a.map((v) => (v === undefined ? null : v)); return o; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; } };
  return o;
}
const r2 = new Map();
let routerCalls = 0;
const env = {
  QNFO_AUDIT: { prepare: stmt },
  MIRROR: { async put(k, v) { r2.set(k, String(v)); }, async get(k) { return r2.has(k) ? { async text() { return r2.get(k); } } : null; } },
  QNFO_AI: { async fetch(url, opts) {
    routerCalls++;
    const body = JSON.parse(opts.body);
    const p = body.messages[0].content;
    // VERIFY-EXTRACT-FAIL-CLOSED-1 (0.18.0): the extractor answers with its own list. The review JSON this mock used to return for
    // every prompt that carries the shared preamble is not a claim list, and it now fails the extraction closed instead of
    // reading as "qualitative".
    const content = p.includes("=== TASK: VERIFY_EXTRACT ===") ? "[]" : /adversarial reviewer/.test(p) ? '{"verdict":"pass","hard":[],"soft":[]}' : "[]";
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  } },
  AI: { async run() { throw new Error("no Workers AI call expected in this test"); } }
};
const bib = "## Bibliography\n" + [1, 2, 3, 4, 5].map((n) => "[" + n + "] arXiv:2401.0000" + n + " | Work " + n).join("\n") + "\n";
// DEGENERATE-TEXT-PRODUCER-1 (0.39.0): finalGates now fails a paper that repeats one sentence back to back, which is what this filler used to be, so each sentence carries a different word.
const lexw = (i) => { let s = "", k = i + 1; while (k > 0) { s += "abcdefghijklmnopqrstuvwxyz"[k % 26]; k = Math.floor(k / 26); } return "w" + s; };
const filler = Array.from({ length: 130 }, (_, i) => "This section " + lexw(i) + " discusses the method in prose with no notation at all.").join(" ");
const short = "This section states its part of the argument in plain prose without notation. ".repeat(4).trim();
const mkPaper = (mathLine) => "# A Title\n\n## Abstract\n\n" + mathLine + "\n\n## 1. Introduction\n\n" + filler + " [1] [2] [3] [4] [5]\n\n## 2. Background and Related Work\n\n" + short + "\n\n## 3. Methods\n\n" + short + "\n\n## 4. Analysis\n\n" + short + "\n\n## 5. Results\n\n" + short + "\n\n## 6. Discussion\n\n" + short + "\n\n## 7. Practical Implications and Engineering Pathways\n\n" + short + "\n\n## 8. Conclusion\n\n" + short + "\n\n## References\n\n" + [1, 2, 3, 4, 5].map((n) => "[" + n + "] Work " + n + ". arXiv:2401.0000" + n + ".").join("\n") + "\n";
const PSEUDO = mkPaper("We find T₁ ≈ 10⁻⁴ s and E = E_g 8 d^3 for code distance d.");
const CLEAN = mkPaper("We find $T_1 \\approx 10^{-4}$ s and $E = E_g 8 d^3$ for code distance $d$.");
const put = (id, paper) => { r2.set("pipeline/" + id + "/reconciled.md", paper); r2.set("pipeline/" + id + "/grounding.md", "# Grounding\n\n" + bib); };
const row = (id, ctx) => { db.prepare("INSERT OR REPLACE INTO research_queue (id, status, stage, context, source) VALUES (?, 'researching', ?, ?, 'remediation')").run(id, "x", JSON.stringify(ctx)); return db.prepare("SELECT * FROM research_queue WHERE id = ?").get(id); };
const get = (id) => db.prepare("SELECT * FROM research_queue WHERE id = ?").get(id);
const events = (kind) => db.prepare("SELECT text, status FROM cloud_ops_events WHERE kind = ?").all(kind);

// MATH-LATEX-AUTOFIX-1: a box drawing is left to the models, so it still exercises the finding, revise and park paths.
const BOX = mkPaper("The layout:\n\n\u250c\u2500\u2500\u2510\n\u2502ab\u2502\n\u2514\u2500\u2500\u2518\n\nas drawn.");
const stored = (id) => r2.get("pipeline/" + id + "/reconciled.md");

// 3. review: plain-text math is converted before the review (no finding); a box drawing still goes to revise
put("r1", PSEUDO);
let out = await stageReview(env, row("r1", { cycles: 0 }));
assert.equal(out.stage, "review->verify", "converted math passes review: " + JSON.stringify(out));
assert.equal(pseudoMathScan(stored("r1")).count, 0, "the stored paper is converted: " + stored("r1").split("\n")[4]);
assert.ok(/\$T_\{1\} \\approx 10\^\{-4\}\$/.test(stored("r1")), "T1 and 10^-4 become one LaTeX span");
assert.ok(events("math-autofix").some((e) => /row=r1 stage=review pseudo_math \d+->0/.test(e.text) && e.status === "ok"), "math-autofix event logged");
put("r3", BOX);
out = await stageReview(env, row("r3", { cycles: 0 }));
assert.equal(out.stage, "review->revise", "a box drawing still sends the paper to revise: " + JSON.stringify(out));
const fx = JSON.parse(r2.get("pipeline/r3/fixes.json"));
assert.ok(Array.isArray(fx) && fx.some((f) => f.id === "gate-math-latex" && f.severity === "HARD" && /\$10\^\{-4\}\$/.test(f.fix)), "fixes.json carries gate-math-latex with a LaTeX example");
put("r2", CLEAN);
out = await stageReview(env, row("r2", { cycles: 0 }));
assert.equal(out.stage, "review->verify", "a LaTeX paper passes review: " + JSON.stringify(out));
assert.equal(stored("r2"), CLEAN, "a LaTeX paper is not rewritten");

// 4. verify, default measure mode: logs math-scan and publishes; a converted paper scans clean
put("v1", PSEUDO);
out = await stageVerify(env, row("v1", { cycles: 2, verifyPass: 1 }));
assert.equal(out.stage, "verify->publish", "measure mode publishes: " + JSON.stringify(out));
assert.ok(events("math-scan").some((e) => /row=v1 pseudo_math=0 mode=measure/.test(e.text) && e.status === "ok"), "verify converted the paper before the scan");
put("v3", BOX);
out = await stageVerify(env, row("v3", { cycles: 2, verifyPass: 1 }));
assert.equal(out.stage, "verify->publish", "measure mode publishes a box drawing too");
assert.ok(events("math-scan").some((e) => /row=v3 pseudo_math=\d+ mode=measure/.test(e.text) && e.status === "warn"), "math-scan warn event logged");
put("v2", CLEAN);
out = await stageVerify(env, row("v2", { cycles: 2 }));
assert.equal(out.stage, "verify->publish");
assert.ok(events("math-scan").some((e) => /row=v2 pseudo_math=0 /.test(e.text) && e.status === "ok"), "a clean paper logs an ok math-scan");

// 5. enforce mode: first failing pass -> revise; second math-only failing pass -> back into the lane at ground (SINGLE-LANE-1: it was parked); convertible math
// is no longer withheld at all (the 8 rows parked from 2026-10-12 to 2026-10-19 were this case)
db.prepare("INSERT INTO ops_config (key, value) VALUES ('research_math_gate', 'enforce')").run();
put("e1", BOX);
out = await stageVerify(env, row("e1", { cycles: 2 }));
assert.equal(out.stage, "verify->revise", "enforce: first failing pass goes back to revise: " + JSON.stringify(out));
assert.ok(JSON.parse(r2.get("pipeline/e1/fixes.json")).some((f) => f.id === "gate-math-latex"));
put("e2", BOX);
out = await stageVerify(env, row("e2", { cycles: 2, verifyPass: 1 }));
assert.ok(out.lane && out.stage === "verify", "enforce: second math-only failure re-enters the lane: " + JSON.stringify(out));
const e2 = get("e2");
assert.equal(e2.stage, "ground"); assert.equal(e2.status, "queued"); assert.match(e2.error, /^SINGLE-LANE-1: re-entered at ground, no parked state\. Was: MATH-LATEX-2: \d+ plain-text math tokens/);
assert.equal(e2.recover_count, 0, "a fresh recovery budget for the new cycle"); assert.equal(e2.terminal_rearms, 1, "the cycle is counted");
assert.equal(events("lane-reenter").length, 1); assert.equal(events("math-park").length, 0, "nothing is parked any more");
put("e4", PSEUDO);
out = await stageVerify(env, row("e4", { cycles: 2, verifyPass: 1 }));
assert.equal(out.stage, "verify->publish", "enforce: convertible math is converted and published, not parked: " + JSON.stringify(out));
put("e3", CLEAN);
out = await stageVerify(env, row("e3", { cycles: 2, verifyPass: 1 }));
assert.equal(out.stage, "verify->publish", "enforce: a LaTeX paper publishes");
assert.ok(routerCalls > 0, "the router stub served the review and extract calls");

// 6. revise: a math-only fix list is resolved without a model call and goes back to review
put("m1", PSEUDO);
r2.set("pipeline/m1/fixes.json", JSON.stringify([{ id: "gate-math-latex", severity: "HARD", claim: "5 plain-text math tokens", fix: "x" }]));
const callsBefore = routerCalls;
out = await stageRevise(env, row("m1", { cycles: 1, verifyPass: 1 }));
assert.equal(out.stage, "revise->review", "math-only revise returns to review: " + JSON.stringify(out));
assert.ok(out.mathAutofix, "the autofix resolved it");
assert.equal(routerCalls, callsBefore, "no model call for a math-only fix list");
assert.equal(JSON.parse(get("m1").context).verifyPass, 1, "verifyPass is kept");
assert.equal(pseudoMathScan(stored("m1")).count, 0);

// 7. the converter itself
const conv = [
  ["Absorption at 1600 cm\u207b\u00b9 and x\u2081\u00b2 + y\u2082 \u2264 3.", "Absorption at 1600 $\\mathrm{cm}^{-1}$ and $x_{1}^{2}$ + $y_{2} \\le 3$."],
  ["The overlap |\u27e8\u03c8|\u03c6\u27e9|\u00b2 is near 1.", "The overlap $|\\langle \u03c8|\u03c6\\rangle|^{2}$ is near 1."],
  ["Error falls as p^(\u22122) and \u221a2 \u2248 1.41.", "Error falls as $p^{-2}$ and $\\sqrt{2} \\approx 1.41$."],
  ["values \u2264 threshold and a \u2260 b.", "values $\\le$ threshold and $a \\neq b$."],
  ["We wrote $x$\u00b2 inline.", "We wrote $x^{2}$ inline."],
];
for (const [i, o] of conv) assert.equal(mathLatexAutofix(i), o, "converts " + i);
for (const keep of ["Costs $5 per run with T\u2081 limits.", "Keep `x_1^2` and [l](https://a.org/x_1), snake_case_name, arXiv:2401.00001, 10.1000/x_1.", "```\ny^2 \u2264 3\n```", "## References\n\n[1] Qubit T\u2081 \u2248 10\u207b\u2074 limits.\n"]) assert.equal(mathLatexAutofix(keep), keep, "left unchanged: " + keep);
for (const [i] of conv) assert.equal(mathLatexAutofix(mathLatexAutofix(i)), mathLatexAutofix(i), "idempotent: " + i);
assert.ok(!/\$\$/.test(mathLatexAutofix("A $x$\u00b2 and $y$ then T\u2081 $z$.")), "never emits $$ next to existing math");

console.log("math-latex tests passed");
