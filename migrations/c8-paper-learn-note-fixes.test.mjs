// C8-PAPER-LEARN-NOTE-FIXES-1 offline suite: replays migrations/2026-11-05-c8-paper-learn-note-fixes.sql on node:sqlite. Output MUST contain "0 failed" on success.
// Proves: the four notes and the one catalogue citation lose the name of a retired or folded worker and keep the rest of their text; a note whose text differs is untouched; other rows are untouched;
// a replay changes nothing; the new text names no worker that carries a RETIRED or FOLDED marker in the repository; the Rollback restores the originals.
// Run: node --no-warnings migrations/c8-paper-learn-note-fixes.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-c8-paper-learn-note-fixes.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql), "header opts in");
const d = new DatabaseSync(":memory:");
d.exec("CREATE TABLE paper_learnings (id INTEGER PRIMARY KEY, status_note TEXT); CREATE TABLE paper_learning_mechanisms (mech_key TEXT PRIMARY KEY, citation TEXT)");
const notes = {
  4866: "PL-TRIAGE-2 in place (x; canary): Ensemble agreement is not the only check: fixed-answer canaries exist (qnfo-chat-canary, the CF-MODEL-EVAL-1 battery, research_golden_runs), and ENSEMBLE-POLICY-1 keeps non-model layers.",
  5535: "PL-TRIAGE-2 in place (x; citewatch): Generation-specific checks exist: CITE-FULLTEXT-1 grounds each citation on a full text and drops a work it cannot read, qnfo-citation-watch watches citations, and the claim gate holds overstated empirical claims.",
  4939: "PL-TRIAGE-2 rejected (x; no-measured-gap): The fleet already records and publishes its own refutations (prediction_miss_rate_7d 0.26, the errata pipeline for its papers); crediting falsifications is new.",
  5538: "PL-TRIAGE-2 in place (x; provenance): Concealment is not possible by design: reopen rates and corrections are tracked (issue_lifecycle, the errata pipeline).",
};
for (const [id, n] of Object.entries(notes)) d.prepare("INSERT INTO paper_learnings VALUES (?, ?)").run(Number(id), n);
d.prepare("INSERT INTO paper_learnings VALUES (7777, 'mentions qnfo-chat-canary but is another row')").run();
d.prepare("INSERT INTO paper_learning_mechanisms VALUES ('research-golden-set', 'research_golden_runs, qnfo-chat-canary, cf_model_eval_runs (qnfo-model-eval)'), ('other', 'qnfo-chat-canary kept')").run();
d.exec(sql);
const n = (id) => d.prepare("SELECT status_note FROM paper_learnings WHERE id = ?").get(id).status_note;
ok(!/qnfo-chat-canary/.test(n(4866)) && /post-deploy canaries of DEPLOY-PROBES-1/.test(n(4866)) && /ENSEMBLE-POLICY-1 keeps non-model layers\.$/.test(n(4866)), "4866 names what runs and keeps its tail");
ok(!/citation-watch/.test(n(5535)) && /drops a work it cannot read, and the claim gate holds overstated empirical claims\.$/.test(n(5535)), "5535 drops the folded worker and stays a sentence");
ok(!/errata pipeline/.test(n(4939)) && /draftCorrection/.test(n(4939)) && /crediting falsifications is new\.$/.test(n(4939)), "4939 names the corrections path that runs");
ok(!/errata/.test(n(5538)) && /paper_change_ledger\)\.$/.test(n(5538)), "5538 names the ledger");
ok(n(7777) === "mentions qnfo-chat-canary but is another row", "another row is untouched");
ok(!/qnfo-chat-canary/.test(d.prepare("SELECT citation FROM paper_learning_mechanisms WHERE mech_key = 'research-golden-set'").get().citation) && d.prepare("SELECT citation FROM paper_learning_mechanisms WHERE mech_key = 'other'").get().citation === "qnfo-chat-canary kept", "only the research-golden-set citation changes");
const stale = ["qnfo-chat-canary", "qnfo-citation-watch", "errata-hub", "qnfo-errata-publish", "qnfo-errata-respond", "qnfo-errata-watch", "errata-orchestrator", "qnfo-paper-reviser"];
const added = Array.from(sql.matchAll(/, '((?:[^']|'')*)'\)\s*\nWHERE|, '((?:[^']|'')*)'\)\s*WHERE/g)).map((m) => m[1] || m[2]).join(" ");
ok(!stale.some((w) => added.includes(w)), "the replacement text names no retired or folded worker");
const marked = (w) => existsSync(new URL("../" + w + "/RETIRED", import.meta.url)) || existsSync(new URL("../" + w + "/FOLDED", import.meta.url));
ok(["qnfo-chat-canary", "qnfo-citation-watch"].every(marked) || !existsSync(new URL("../qnfo-chat-canary/", import.meta.url)), "the two workers named by the old text still carry their marker (or are gone)");
const snap = JSON.stringify([d.prepare("SELECT * FROM paper_learnings ORDER BY id").all(), d.prepare("SELECT * FROM paper_learning_mechanisms ORDER BY mech_key").all()]);
d.exec(sql); ok(JSON.stringify([d.prepare("SELECT * FROM paper_learnings ORDER BY id").all(), d.prepare("SELECT * FROM paper_learning_mechanisms ORDER BY mech_key").all()]) === snap, "a replay changes nothing");
d.exec(/^-- Rollback: (.+)$/m.exec(sql)[1]);
ok(n(4866) === notes[4866] && n(5538) === notes[5538] && d.prepare("SELECT citation FROM paper_learning_mechanisms WHERE mech_key = 'research-golden-set'").get().citation.includes("qnfo-chat-canary"), "the rollback restores the originals");
console.log(pass + " passed, " + fail + " failed");
