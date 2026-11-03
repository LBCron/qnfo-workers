// EDITS-OVERLAP-RESOLVE-1, SEARCH-ELISION-1, SYNTAX-HINT-1 offline suite (qnfo-code-orchestrator 0.15.0, pillar autonomy,
// agent_issues 1834/2313). Replays the shapes of the 2026-10-13 failed attempts: ct_53djh2yfqk3ocj (the same insertion written
// twice, "edits overlap"), ct_cvwqti3jsita1z (SEARCH "if (decision) ..."), ct_ne8sjnxe748hiz ("Illegal continue statement") and
// ct_xi8oy93u9i00zf ("Identifier 'learnerVisits' has already been declared").
// Run: node --no-warnings qnfo-code-orchestrator/edit-repair-hints.test.mjs   (exit 0 = all passed)
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "worker.js"), "utf8");
function grab(name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("function " + name + " not found");
  const nl = src.indexOf("\n", i);
  if (src.slice(i, nl).trimEnd().endsWith("}")) return src.slice(i, nl); // a one-line function
  const end = src.indexOf("\n}\n", i); // top-level functions close at column 0 (strings hold braces, so no counting)
  if (end < 0) throw new Error("function " + name + " not closed");
  return src.slice(i, end + 2);
}
function grabConst(name) {
  const m = new RegExp("^(?:const|var|let) " + name + " = [^\\n]*;$", "m").exec(src);
  if (!m) throw new Error("const " + name + " not found");
  return m[0];
}
const fns = ["countOf", "indentMatch", "reindent", "fzLine", "fuzzyMatch", "nearestBlock", "nearestLines", "placesOf", "elidedLine",
  "applyEdits", "dropEdits", "overlapNorm", "resolveOverlaps", "inertStrip", "escRe", "bracketBalance", "syntaxHint"];
const ctx = {};
vm.createContext(ctx);
vm.runInContext(["MAX_EDITS", "NEAREST_MAX_CHARS", "ELISION_RE"].map(grabConst).join("\n") + "\n" + fns.map(grab).join("\n") +
  "\nthis.applyEdits=applyEdits;this.elidedLine=elidedLine;this.syntaxHint=syntaxHint;this.dropEdits=dropEdits;this.nearestLines=nearestLines;", ctx);
const { applyEdits, elidedLine, syntaxHint, dropEdits, nearestLines } = ctx;

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 600) : "")); } };
const whole = (b) => ({ ws: 0, we: b.length });

// --- EDITS-OVERLAP-RESOLVE-1 ---
const base = [
  "async function scoreIdea(env, desire, lean) {",
  '  var prompt = SCORECARD_PROMPT + String(desire || "").slice(0, 3000);',
  "  var card = await judge(env, prompt, lean);",
  "  return card;",
  "}",
  "",
].join("\n");
const ins = ["var neighbours = await nearest(env, desire, 5);", "var labels = await label(env, neighbours, desire);"];
// ct_53djh2yfqk3ocj: edit 1 (one line, unindented) is inside edit 2 (two lines, indented) and makes the same change.
const dupEdits = [
  { search: 'var prompt = SCORECARD_PROMPT + String(desire || "").slice(0, 3000);', replace: 'var prompt = SCORECARD_PROMPT + String(desire || "").slice(0, 3000);\n' + ins.join("\n") },
  { search: 'async function scoreIdea(env, desire, lean) {\n  var prompt = SCORECARD_PROMPT + String(desire || "").slice(0, 3000);',
    replace: 'async function scoreIdea(env, desire, lean) {\n  var prompt = SCORECARD_PROMPT + String(desire || "").slice(0, 3000);\n  ' + ins.join("\n  ") },
];
const r1 = applyEdits(base, whole(base), dupEdits);
ok(r1.ok, "a contained edit that repeats the outer change applies", r1);
ok(r1.ok && r1.dropped.length === 1 && r1.dropped[0].edit === 1 && r1.dropped[0].within === 2, "the inner duplicate is named as dropped", r1.dropped);
ok(r1.ok && r1.text.indexOf("  var neighbours = await nearest(env, desire, 5);\n  var labels") > 0 && r1.text.split("var neighbours").length === 2, "the change lands once, with the outer edit's indentation", r1.text);
ok(r1.ok && r1.resolved.length === 1, "resolved holds only the kept edit", r1.resolved);
const kept = dropEdits(dupEdits, r1.dropped);
ok(kept.length === 1 && kept[0] === dupEdits[1], "dropEdits removes the dropped edit by index");
const again = applyEdits(base, whole(base), kept);
ok(again.ok && again.text === r1.text && again.dropped.length === 0, "the kept set applies to the same text with no overlap left", again);
// Order does not matter: the duplicate written second is dropped the same way.
const r1b = applyEdits(base, whole(base), [dupEdits[1], dupEdits[0]]);
ok(r1b.ok && r1b.dropped.length === 1 && r1b.dropped[0].edit === 2 && r1b.text === r1.text, "a duplicate written after the outer edit is dropped too", r1b);
// Two edits on the same text with the same REPLACE are one.
const same = { search: "  return card;", replace: "  return card || null;" };
const r2 = applyEdits(base, whole(base), [same, { search: "  return card;", replace: "  return card || null;" }]);
ok(r2.ok && r2.dropped.length === 1 && r2.text.indexOf("return card || null;") > 0, "two identical edits apply once", r2);
// A real conflict is refused, naming both edits and the shared line (quoted as data).
const r3 = applyEdits(base, whole(base), [
  { search: "  var card = await judge(env, prompt, lean);", replace: "  var card = await judge(env, prompt, false);" },
  { search: "  var card = await judge(env, prompt, lean);\n  return card;", replace: "  return await judge(env, prompt, true);" },
]);
ok(!r3.ok && /^edits overlap: edits 1 and 2 both change line 3: var card = await judge\(env, prompt, lean\);/.test(r3.error) && /merge them into one block/.test(r3.error), "a conflicting overlap is refused with both edits and the line named", r3.error);
// Partial overlap (neither contains the other) is refused.
const r4 = applyEdits(base, whole(base), [
  { search: "  var card = await judge(env, prompt, lean);\n  return card;", replace: "X" },
  { search: "  return card;\n}", replace: "Y" },
]);
ok(!r4.ok && /^edits overlap: edits 1 and 2/.test(r4.error), "a partial overlap is refused", r4.error);
// Non-overlapping edits are unchanged.
const r5 = applyEdits(base, whole(base), [same, { search: "  var card = await judge(env, prompt, lean);", replace: "  var card = await judge(env, prompt, !!lean);" }]);
ok(r5.ok && r5.dropped.length === 0 && /!!lean/.test(r5.text) && /card \|\| null/.test(r5.text), "separate edits both apply, nothing dropped", r5);

// --- SEARCH-ELISION-1 ---
const social = ["async function learnerRecordPost(env, dec, bskyUri, nowMs) {", "  if (!dec) return;", "  await learnerSave(env, dec);", "}", ""].join("\n");
const r6 = applyEdits(social, whole(social), [{ search: "if (decision) ...", replace: "if (decision || !decision) {}" }]);
ok(!r6.ok && /occurs 0 times in the shown content because it abbreviates the file with '\.\.\.'/.test(r6.error) && /"if \(decision\) \.\.\."/.test(r6.error), "a SEARCH that elides with ... is told why it cannot match", r6.error);
ok(elidedLine(social, "  // ... existing code ...\n  await learnerSave(env, dec);") === "// ... existing code ...", "an elision comment line is found");
ok(elidedLine(social, "{ ... }") === "{ ... }", "an elided block body is found");
ok(elidedLine(social, "fn(...args);") === null && elidedLine(social, "var a = [...xs, 1];") === null, "spread syntax is not an elision");
const spreadFile = "function f(a) {\n  return g(...\n    a);\n}\n";
ok(elidedLine(spreadFile, "  return g(...") === null, "an elision-shaped line that is a real line of the content is not flagged");
const r7 = applyEdits(social, whole(social), [{ search: "  if (!dec) return null;", replace: "x" }]);
ok(!r7.ok && !/abbreviates/.test(r7.error) && /occurs 0 times/.test(r7.error), "a SEARCH with no elision keeps the usual message", r7.error);

// ct_im1000598 copied a concatenated string instead of the array entry; the retry needs literal source, not a trimmed preview.
const help = [
  '  "  ipatent                iPatent views, searches and drafts (counts by topic)",',
  "",
  '  "  suggest                ' + "what the fleet proposes ".repeat(5) + '",',
].join("\n");
const wrongHelp = '  "  ipatent                iPatent views, searches and drafts (counts by topic)\\n" +';
const missedHelp = applyEdits(help, whole(help), [{ search: wrongHelp, replace: "" }]);
ok(!missedHelp.ok && missedHelp.error.includes("\n" + help), "failed string SEARCH returns complete source with indentation, blank lines, quotes and punctuation", missedHelp);
const copiedHelp = missedHelp.error.slice(missedHelp.error.indexOf("complete lines):\n") + "complete lines):\n".length);
const repairedHelp = applyEdits(help, whole(help), [{ search: copiedHelp, replace: "" }]);
ok(repairedHelp.ok && repairedHelp.text === "", "copying the suggested lines passes the unchanged exact-match verifier", repairedHelp);
const longHelp = '  "ipatent ' + "x".repeat(900) + '",';
ok(nearestLines(longHelp, whole(longHelp), "ipatent missing") === "", "a line over the hint budget is omitted, never truncated");
const partialHelp = "prefix ipatent partial\n" + help + "\n  ipatent trailing suffix";
const bounded = { ws: "prefix ".length, we: partialHelp.length - " suffix".length };
const boundedHint = nearestLines(partialHelp, bounded, "ipatent missing");
ok(boundedHint.includes("\n" + help) && !boundedHint.includes("ipatent partial") && !boundedHint.includes("ipatent trailing"), "cut window boundaries are never presented as complete source", boundedHint);

// --- SYNTAX-HINT-1 ---
const loopBase = "function scan(rows) {\n  for (const r of rows) {\n    if (!r) continue;\n    use(r);\n  }\n}\n";
const brk = [{ search: "    if (!r) continue;", replace: "    if (!r) continue;\n  }\n    if (r.x) continue;" }];
const h1 = syntaxHint("SyntaxError: Illegal continue statement: no surrounding iteration statement", brk, null);
ok(/^; where: edit 1 changes the bracket balance \(\{ \} -1\): its REPLACE closes more than its SEARCH/.test(h1), "an edit that closes a block early is named", h1);
const opens = [{ search: "  use(r);", replace: "  if (r.ok) {\n    use(r);" }, { search: "  }\n}", replace: "  }\n}" }];
const h2 = syntaxHint("SyntaxError: Unexpected end of input", opens, null);
ok(/edit 1 changes the bracket balance \(\{ \} \+1\): its REPLACE opens more/.test(h2) && !/edit 2/.test(h2), "only the unbalanced edit is named", h2);
const quoted = [{ search: '  log("x");', replace: '  log("x { (");' }];
ok(syntaxHint("SyntaxError: Unexpected token ')'", quoted, null) === "", "brackets inside strings do not count");
const dupFile = "async function learnerVisits(env, slug, d0) {\n  return 1;\n}\nconst a = 1;\nasync function learnerVisits(env, slug) {\n  return 2;\n}\n";
const h3 = syntaxHint("SyntaxError: Identifier 'learnerVisits' has already been declared", [], dupFile);
ok(/learnerVisits is declared at lines 1, 5 of the edited file/.test(h3), "an already-declared identifier gets the lines that declare it", h3);
ok(syntaxHint("SyntaxError: Unexpected token ')'", [{ search: "a(1);", replace: "a(2);" }], "a(2);") === "", "a balanced edit and an unrelated error add nothing");
ok(/SyntaxError/.test(src.slice(src.indexOf("SYNTAX-HINT-1: a parse error"), src.indexOf("SYNTAX-HINT-1: a parse error") + 400)), "verify feeds the hint only for a SyntaxError");

// --- CODE-LOOP-2X-1 (agent_issues 2506): the cron tick, its caps, intake and plan WIP are at least doubled ---
ok(src.indexOf("tick(env, { budgetMs: 40000, maxSteps: 48 })") > 0, "the cron tick runs 48 steps in 40 s, across 8 lanes");
ok(/opts\.budgetMs\) \|\| 20000, 50000\)/.test(src) && /opts\.maxSteps\) \|\| 8, gate\.capped \? 1 : 64\)/.test(src), "tick caps 50 s / 64 steps below threshold, POST default stays 8; capped batch is one step");
ok(/intakeIssues\(env, 8\)/.test(src) && /^const PLAN_WIP = 12;/m.test(src), "intake takes 8 issues per tick and PLAN_WIP is 12 (LANES-8-1)");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
