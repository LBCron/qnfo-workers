#!/usr/bin/env node
// POLICY-GATE-1 replay (RM-POLICY-SMT-GATE-1, agent_issues 1000649): measures the blocked-call precision and recall of the shadow policy gate (policyGateShadowDecision in
// qnfo-ops/worker.js) on labelled calls, so enforcement is decided on a measurement and not on a belief (the issue's failure mode: an incomplete constraint blocks nothing).
//
// A case is {id, tool, args, label} with label "block" (the call is incomplete or unconfirmed and the gate should flag it) or "allow" (a complete confirmed call, or a tool no rule covers).
// The gate flags a call when policyGateShadowDecision returns would_block true. precision = flagged-and-labelled-block / flagged; recall = flagged-and-labelled-block / labelled-block.
// Cases under `out_of_class` are irreversible-looking calls the issue's three classes (email send, publish, delete) do not cover: they are listed as gaps and never counted in recall.
//
// Sources: the labelled corpus qnfo-ops/policy-gate-corpus.json (default), and --events <file.json>: rows of cloud_ops_events kind ops_ai_tool exported from qnfo-audit, e.g.
//   SELECT text, status, meta FROM cloud_ops_events WHERE kind = 'ops_ai_tool' AND text IN ('email_respond','composio_execute','r2_delete','kv_delete','workspace_delete','github_branch_delete','ops_d1_write') LIMIT 100
// An event is labelled by what the authoritative check decided (status rejected or error = block, ok = allow); its args are the redacted, 600-character-capped meta.args, so a truncated
// call is skipped. As of 2026-11-05 the production corpus is empty: cloud_ops_events holds no call of the three classes since 2026-09-01 except 15 ops_d1_write calls on 2026-10-29.
// Usage: node scripts/policy_gate_replay.mjs [--corpus file] [--events file] [--min-precision 0.9] [--min-recall 0.9] [--worker qnfo-ops/worker.js]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function loadDecision(workerSource) {
  const s = workerSource.replace(/\r\n/g, "\n");
  const i = s.indexOf("function policyGateShadowDecision(");
  const j = s.indexOf("\n__name(policyGateShadowDecision", i);
  if (i < 0 || j < 0) throw new Error("policyGateShadowDecision not found in the worker source");
  return new Function(s.slice(i, j) + "\nreturn policyGateShadowDecision;")();
}

export function replayCases(cases, decision) {
  const t = { tp: 0, fp: 0, fn: 0, tn: 0 };
  const rules = {};
  const misses = [];
  const falsePositives = [];
  for (const c of cases) {
    const d = decision(c.tool, c.args || {});
    const flagged = !!(d && d.would_block);
    if (d) {
      const r = (rules[d.rule_id] = rules[d.rule_id] || { calls: 0, flagged: 0 });
      r.calls++;
      if (flagged) r.flagged++;
    }
    if (flagged && c.label === "block") t.tp++;
    else if (flagged) { t.fp++; falsePositives.push(c.id); }
    else if (c.label === "block") { t.fn++; misses.push(c.id); }
    else t.tn++;
  }
  const ratio = (a, b) => (b === 0 ? null : Number((a / b).toFixed(4)));
  return { cases: cases.length, ...t, precision: ratio(t.tp, t.tp + t.fp), recall: ratio(t.tp, t.tp + t.fn), rules, misses, false_positives: falsePositives };
}

export function casesFromEvents(rows) {
  const out = [];
  let skipped = 0;
  for (const r of rows) {
    let meta = null;
    try { meta = typeof r.meta === "string" ? JSON.parse(r.meta) : r.meta; } catch (e) { meta = null; }
    if (!meta || !meta.args || typeof meta.args !== "object" || meta.args._truncated) { skipped++; continue; }
    out.push({ id: "event-" + out.length, tool: r.text, args: meta.args, label: r.status === "ok" ? "allow" : "block" });
  }
  return { cases: out, skipped };
}

export function gaps(outOfClass, decision) {
  return outOfClass.map((c) => ({ id: c.id, tool: c.tool, covered: decision(c.tool, c.args || {}) !== null }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (n, d) => { const k = process.argv.indexOf(n); return k > 0 ? process.argv[k + 1] : d; };
  const decision = loadDecision(readFileSync(arg("--worker", new URL("../qnfo-ops/worker.js", import.meta.url)), "utf8"));
  const corpus = JSON.parse(readFileSync(arg("--corpus", new URL("../qnfo-ops/policy-gate-corpus.json", import.meta.url)), "utf8"));
  const report = { corpus: replayCases(corpus.cases, decision), out_of_class_gaps: gaps(corpus.out_of_class || [], decision) };
  const ev = arg("--events", null);
  if (ev) {
    const { cases, skipped } = casesFromEvents(JSON.parse(readFileSync(ev, "utf8")));
    report.events = { ...replayCases(cases, decision), skipped };
  }
  console.log(JSON.stringify(report, null, 2));
  const minP = Number(arg("--min-precision", 0)), minR = Number(arg("--min-recall", 0));
  const bad = [];
  if (report.corpus.precision != null && report.corpus.precision < minP) bad.push("precision " + report.corpus.precision + " < " + minP);
  if (report.corpus.recall != null && report.corpus.recall < minR) bad.push("recall " + report.corpus.recall + " < " + minR);
  if (bad.length) { console.error("policy gate replay below threshold: " + bad.join("; ")); process.exit(1); }
}
