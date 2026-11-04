// POLICY-GATE-1 replay (RM-POLICY-SMT-GATE-1, agent_issues 1000649): precision and recall of the shadow policy gate on the labelled corpus, the replay of exported cloud_ops_events
// rows, and the gaps the three classes do not cover. The recall fix for a D1 delete behind a comment or a WITH clause is pinned here; docs/POLICY-GATE-REPLAY.md has the numbers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadDecision, replayCases, casesFromEvents, gaps } from "../scripts/policy_gate_replay.mjs";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
assert.equal(source.replace(/\r\n/g, "\n"), mirror.replace(/\r\n/g, "\n"), "deployed-current.worker.js mirrors worker.js");
const decision = loadDecision(source);
const corpus = JSON.parse(readFileSync(new URL("./policy-gate-corpus.json", import.meta.url), "utf8"));

const ids = corpus.cases.map((c) => c.id);
assert.equal(new Set(ids).size, ids.length, "case ids are unique");
assert.ok(corpus.cases.every((c) => c.label === "block" || c.label === "allow"), "every case is labelled");
assert.ok(corpus.cases.filter((c) => c.label === "block").length >= 20 && corpus.cases.filter((c) => c.label === "allow").length >= 20, "both labels are well represented");

const r = replayCases(corpus.cases, decision);
assert.equal(r.cases, corpus.cases.length);
assert.equal(r.tp + r.fp + r.fn + r.tn, r.cases, "the confusion matrix covers every case");
assert.equal(r.recall, 1, "every incomplete or unconfirmed irreversible call in the corpus is flagged");
assert.deepEqual(r.misses, []);
assert.ok(r.precision >= 0.95, "at most a few ordinary calls are flagged: " + r.precision);
assert.deepEqual(r.false_positives, ["slack-remove-reaction"], "the one known false positive: any remove/delete slug is treated as a deletion");
for (const rule of ["email-send-existing-thread", "publish-explicit-confirmation", "delete-explicit-confirmation"]) {
  assert.ok(r.rules[rule] && r.rules[rule].calls >= 5 && r.rules[rule].flagged >= 1, rule + " is exercised on both sides");
}

// the pre-fix miss: a D1 delete behind a comment or a WITH clause is a delete
for (const sql of ["/* x */ DELETE FROM t WHERE id = 1", "-- x\nDROP TABLE t", "with a as (select 1) delete from t", "  TRUNCATE TABLE t"]) {
  const d = decision("ops_d1_write", { sql });
  assert.ok(d && d.would_block === true, "unconfirmed destructive SQL is flagged: " + sql);
}
for (const sql of ["SELECT 1", "WITH a AS (SELECT 1) SELECT * FROM a", "INSERT INTO t VALUES (1)", "UPDATE t SET x = 1 WHERE id = 1"]) {
  assert.equal(decision("ops_d1_write", { sql }), null, "no rule for non-destructive SQL: " + sql);
}

// gaps stay documented: if a rule starts covering one, this test fails so the corpus and the doc move together
assert.ok(gaps(corpus.out_of_class, decision).every((g) => g.covered === false), "out-of-class cases are not covered by any rule");

// events replay: labelled by the authoritative check, truncated args skipped
const { cases, skipped } = casesFromEvents([
  { text: "r2_delete", status: "ok", meta: JSON.stringify({ args: { confirm: true, key: "a" } }) },
  { text: "r2_delete", status: "rejected", meta: JSON.stringify({ args: { key: "a" } }) },
  { text: "email_respond", status: "error", meta: JSON.stringify({ args: { body: "no thread" } }) },
  { text: "r2_delete", status: "ok", meta: JSON.stringify({ args: { _truncated: 1 } }) },
  { text: "r2_delete", status: "ok", meta: "{not json" }
]);
assert.equal(skipped, 2);
assert.deepEqual(cases.map((c) => c.label), ["allow", "block", "block"]);
const er = replayCases(cases, decision);
assert.equal(er.recall, 1);
assert.equal(er.precision, 1);
assert.equal(replayCases([], decision).precision, null, "an empty corpus has no precision, not 0 or 1");

console.log("policy-gate-replay tests: ok");
