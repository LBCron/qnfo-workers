// ANALYSIS-FORM-1 offline suite (EK-6, roadmap row 1753, charter pillar reach).
// Proves: the shared module's pure functions behave (objection finder, lede helpers, shown lede, even-keel parse / verdict / reviewer choice,
// sources footer, AI label); the essay contract keeps the line the probe for issue 1000716 reads; every adopting worker holds exactly the
// current block in worker.js and in its mirror (a stale copy fails here, not in production).
// Run: node _shared/analysis-form.test.mjs
import { readFileSync } from "node:fs";
import { block, current, apply, BEGIN, END, moduleSource } from "./inline-analysis-form.mjs";

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 300) : "")); } };

const src = moduleSource();
ok(!/\/\*/.test(src), "the module uses line comments only, so it can sit anywhere in a worker without closing a block comment early");
ok(!/^\s*(import|export)\b/m.test(src), "the module has no import or export, so it can be inlined");
const names = [...src.matchAll(/^(?:var|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
ok(names.length > 30 && names.every((n) => /^(AF_|af)/.test(n)), "every top-level name starts with AF_ or af", names.filter((n) => !/^(AF_|af)/.test(n)));
const AF = new Function(src + "\nreturn {" + names.join(",") + "};")();

// ---- writer rules and forms
ok(AF.AF_P_ESSAY.split("\n")[0].startsWith("FORM: essay, 2000 to 2800 words. This is long-form."), "the essay contract opens with the line the issue-1000716 probe reads");
ok(src.indexOf("FORM: essay, 2000 to 2800 words. This is long-form.") > 0, "the probe string is present in the module source");
ok(/^LEDE \(inverted pyramid/.test(AF.AF_LEDE_RULE) && /^CONTEXT AND SYSTEMS ANALYSIS \(required/.test(AF.AF_SYSTEMS_RULE) && /^Quotations: /.test(AF.AF_QUOTE_RULE), "lede, systems and quotation rules are whole strings");
ok(/at least three independent full-text sources/.test(AF.AF_CONTESTED_RULE) && /strongest objection to your central claim/.test(AF.AF_OBJECTION_RULE), "the contested-sources and objection rules are present");
ok(/^- Even keel: /.test(AF.AF_EVEN_KEEL_RULE) && /naming the party only where the source material names it/.test(AF.AF_EVEN_KEEL_RULE) && !/critics, scholars/.test(AF.AF_EVEN_KEEL_RULE), "the even-keel rule attributes only to parties the source names (no invented critics)");
ok(/^systems: /m.test(AF.AF_P_CRITIQUE) && /"systems":n/.test(AF.AF_P_CRITIQUE), "the adversarial rubric scores systems and returns JSON");

// ---- objection finder (OBJECTION-FIND-1)
const classic = "Lede.\n\n## The objection\n\nA careful reader might say the count itself was disputed, and that this weakens the claim.\n\n## End\n\nx";
ok(/count itself was disputed/.test(AF.afFindObjection(classic)), "a heading containing objection is read");
const mid = "Lede.\n\n## The vote\n\nThe count ran for days.\n\nThe strongest objection to this reading is that the negotiators fixed the outcome before any ballot was cast. If so, the vote ratified rather than decided.\n\n## End\n\nx";
ok(/negotiators fixed the outcome/.test(AF.afFindObjection(mid)), "a paragraph that raises the objection in so many words is read");
ok(AF.afFindObjection("Lede.\n\n## History\n\nThe war against the state ended in 1994 and the sides talked.") === "", "a piece with no objection reads empty");

// ---- lede helpers
const ex = AF.afExtractLede("The Corlea Trackway is a road of oak planks in Ireland.\n\n## One\n\nBody.");
ok(ex.lede.startsWith("The Corlea Trackway") && ex.rest.startsWith("## One") && !ex.startsHeading, "afExtractLede splits the lede from the body");
ok(AF.afLedeProblems({ title: "T", lede: "The Corlea Trackway is a road of oak planks.", body_md: "x" }, "Corlea Trackway").length === 0, "a lede that names the subject passes");
ok(AF.afLedeProblems({ title: "T", lede: "The idea of a road is older than any road.", body_md: "x" }, "Corlea Trackway").length >= 1, "an abstract opening fails");
const longLede = Array.from({ length: 12 }, (_, i) => "Sentence " + i + " of the Corlea Trackway " + "word ".repeat(12).trim() + ".").join(" ");
const split = AF.afSplitLongLede({ title: "T", lede: longLede, body_md: "## One\n\nBody." });
ok(split.lede.split(/\s+/).length <= 110 && split.body_md.indexOf("## One") > 0, "afSplitLongLede cuts at a sentence boundary and moves the rest to the body");

// ---- EK-1: the lede a reader is shown
ok(AF.afShownLede({ lede: " Stored lede. ", body_md: "First body paragraph." }) === "Stored lede.", "a stored lede is shown as stored");
ok(AF.afShownLede({ lede: "", body_md: "The first paragraph of the body is the lede.\n\nSecond paragraph." }) === "The first paragraph of the body is the lede.", "a lost lede is read from the first prose paragraph of the body");
ok(AF.afShownLede({ lede: "", body_md: "## Heading first\n\nThe paragraph under the heading.\n\nMore." }) === "The paragraph under the heading.", "a body that opens on a heading yields the first prose paragraph after it");
ok(AF.afShownLede({ lede: "", body_md: "## Only headings\n\n- a list item\n\n> a quote" }) === "", "no prose paragraph, no lede");
const longBody = Array.from({ length: 14 }, (_, i) => "Clause number " + i + " has " + "word ".repeat(12).trim() + ".").join(" ") + "\n\nSecond.";
ok(AF.afShownLede({ lede: "", body_md: longBody }).split(/\s+/).length <= 110, "a derived lede longer than the limit is cut at a sentence boundary");
ok(AF.afShownLede(null) === "" && AF.afShownLede({}) === "", "no piece, no lede");

// ---- EK-3: even-keel parse, verdict, reviewer choice, revision note
const full = AF.afParseBalanceScore('<think>hm</think>{"opposing":8,"wording":6,"attribution":7,"reason":"The third section states the policy as settled."}');
ok(full && full.score === Math.round(8 * 5 + 6 * 2.5 + 7 * 2.5) && full.parts.opposing === 8 && /third section/.test(full.reason), "sub-scores are combined with opposing counting double", full);
ok(AF.afParseBalanceScore('{"score":64,"pass":false,"reason":"x"}').score === 64, "a reply that gives only a score is read as such");
ok(AF.afParseBalanceScore('Here: "opposing": 9, "wording": 9, "attribution": 9 (cut off').score === 90, "sub-scores are read even when the JSON is cut off");
ok(AF.afParseBalanceScore("no numbers here") === null && AF.afParseBalanceScore("") === null && AF.afParseBalanceScore(null) === null, "an unusable reply is null");
ok(AF.afParseBalanceScore('{"opposing":11,"wording":5,"attribution":5}') === null, "an out-of-range part is not trusted");
ok(AF.afParseBalanceScore('{"score":140}') === null, "an out-of-range score is not trusted");
ok(AF.afBalanceVerdict({ score: 70 }).state === "pass" && AF.afBalanceVerdict({ score: 69 }).state === "fail", "the bar is 70: 70 passes, 69 fails");
ok(AF.afBalanceVerdict(null).state === "unavailable" && AF.afBalanceVerdict({ reason: "x" }).state === "unavailable", "no score is unavailable, never a pass");
ok(AF.afBalanceVerdict({ score: 60 }, 55).state === "pass", "the bar can be passed in");

const fam = { a: "nvidia", b: "openai", c: "moonshot", d: "deepseek", e: "zai" };
const famOf = (id) => fam[id] || "unknown:" + id;
const pool = ["a", "b", "c", "d", "e"];
let picked = AF.afPickBalanceReviewer(pool, { familyOf: famOf, writerFamily: "deepseek", avoid: ["nvidia", "openai"], seed: 0 });
ok(picked === "c", "with the writer and two fact-check judges excluded the reviewer is a fresh family", picked);
picked = AF.afPickBalanceReviewer(pool, { familyOf: famOf, writerFamily: "deepseek", avoid: ["nvidia", "openai"], seed: 3 });
ok(picked === "e", "the seed rotates among fresh families", picked);
ok(["a", "b", "c", "e"].includes(AF.afPickBalanceReviewer(pool, { familyOf: famOf, writerFamily: "deepseek", avoid: ["nvidia", "openai", "moonshot", "zai"], seed: 3 })), "when every family judged already, one that is not the writer's is still chosen");
ok(AF.afPickBalanceReviewer(pool, { familyOf: famOf, writerFamily: "deepseek", seed: 7 }) !== "d", "never the writer's family");
ok(AF.afPickBalanceReviewer(["x", "y"], { familyOf: famOf, writerFamily: "deepseek" }) === "", "models of unknown family are never chosen (the BALANCE_FAMILY defect: a family no model had left the check unavailable for every piece)");
ok(AF.afPickBalanceReviewer(pool, { familyOf: famOf, writerFamily: "deepseek", allowed: (id) => id === "e" }) === "e", "the allow list is honoured");
ok(AF.afPickBalanceReviewer(pool, { familyOf: famOf, writerFamily: "deepseek", sick: { c: 1, e: 1 }, avoid: ["nvidia", "openai"] }) !== "c", "a model marked sick is skipped");
ok(AF.afPickBalanceReviewer([], {}) === "" && AF.afPickBalanceReviewer(null, null) === "", "an empty pool gives no reviewer");
const note = AF.afBalanceRevisionNote("The third section states the policy as settled.");
ok(/third section states the policy as settled/.test(note) && /add no name, date, figure, event or claim it does not contain/.test(note) && /strongest argument against your central claim/.test(note), "the revision note names the finding and forbids new facts");
ok(/Return only JSON/.test(AF.AF_BALANCE_PROMPT) && /opposing/.test(AF.AF_BALANCE_PROMPT) && /wording/.test(AF.AF_BALANCE_PROMPT) && /attribution/.test(AF.AF_BALANCE_PROMPT), "the reviewer prompt asks for the three parts");

// ---- sources footer and host profiles
const foot = AF.afSourcesFooter(["https://en.wikipedia.org/wiki/Corlea_Trackway", "https://arxiv.org/abs/2401.00001", "javascript:alert(1)", "http://insecure.example/x", "https://hansard.parliament.uk/Commons/2021-09-06/debates/abc/Afghanistan", "https://globalvoices.org/2021/08/16/afghan-voices/", "https://dawn.com/news/1"]);
ok(/^<p class=src>Sources: /.test(foot) && /Corlea Trackway \(Wikipedia\)/.test(foot) && /arXiv 2401\.00001/.test(foot), "Wikipedia and arXiv keep their plain labels", foot);
ok(/>Hansard \(UK Parliament\)</.test(foot) && />Global Voices</.test(foot) && />dawn\.com</.test(foot), "registered hosts get their label, an unregistered one its host name", foot);
ok(!/javascript:/.test(foot) && !/insecure\.example/.test(foot), "only https references are linked");
ok(AF.afSourcesFooter([]) === "" && AF.afSourcesFooterFromJson("not json") === "" && AF.afSourcesFooterFromJson(null) === "", "no references, no footer");
ok(/Corlea/.test(AF.afSourcesFooterFromJson(JSON.stringify({ refs: ["https://en.wikipedia.org/wiki/Corlea_Trackway"] }))), "the footer reads anchor_json");
ok(!/<script/.test(AF.afSourcesFooter(["https://example.org/a?x=<script>"])), "references are escaped");
ok(AF.afSourceProfile("https://en.wikipedia.org/wiki/X").label === "Wikipedia" && AF.afSourceProfile("https://hansard.parliament.uk/x").country === "GB" && AF.afSourceProfile("https://globalvoices.org/x").country === "NL", "host profiles carry label and country");
ok(AF.afSourceProfile("https://notwikipedia.org/x") === null && AF.afSourceProfile("https://evilhansard.parliament.uk.example.com/") === null, "a look-alike host does not match a profile");
ok(AF.afSourceProfile("https://hansard.parliament.uk/x").viewpoint === "uk-parliament" && AF.afSourceProfile("https://en.wikipedia.org/wiki/X").viewpoint === "", "viewpoint labels are standpoints; an encyclopedia has none");

// ---- AI label
const label = AF.afAiLabelHtml();
ok(label === '<span class=ai title="' + AF.AF_AI_LABEL_TEXT + '">AI-generated</span>' && /No human reviews pieces before they appear\./.test(AF.AF_AI_LABEL_TEXT), "the label says AI-generated and that no human reviews pieces");

// ---- adopters hold the current block (worker.js and mirror)
const ADOPTERS = ["personal-companion"];
for (const dir of ADOPTERS) {
  for (const f of ["worker.js", "deployed-current.worker.js"]) {
    const text = readFileSync(new URL("../" + dir + "/" + f, import.meta.url), "utf8");
    ok(current(text) === block(), dir + "/" + f + " holds the current ANALYSIS-FORM-1 block (run node _shared/inline-analysis-form.mjs " + dir + ")");
    ok(current(text) !== "" && apply(text) === text, dir + "/" + f + " is unchanged by re-inlining");
  }
}
ok(block().startsWith(BEGIN) && block().trimEnd().endsWith(END), "the block is fenced by its markers");
let threw = false; try { apply("no markers here\n"); } catch (e) { threw = true; }
ok(threw, "a worker with no block and no anchor is refused, not silently left alone");
ok(apply("a\nvar X = 1;\nb\n", "var X").indexOf("ANALYSIS-FORM-1:BEGIN") > 0, "the first adoption inserts before the anchor line");

console.log("analysis-form: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
