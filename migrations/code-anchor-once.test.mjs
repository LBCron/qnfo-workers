// BREACH-CODE-ANCHORS-1 offline suite (agent_issues 99926, trigger 379 breach_code_task_pct). Two layers.
//
// LAYER 1, the anchor guard (reads the checkout and every migration, no fixture). A trigger's code-task / code-anchor pair is copied into
// analytics_metric_triggers.action when the lever is written and nothing re-reads it when the worker changes; trigger 1238 kept
// "async function triageProposals(env) {" after idea-hub changed that function, and the code loop could not place the edit. So:
//   * every migration from migrations/2026-10-19-breach-code-task-anchors.sql on that writes a pair to analytics_metric_triggers (UPDATE keyed
//     by WHERE id = N / id IN (...) / metric_key = '...', or INSERT with a metric_key) is read in file order; the LAST writer of a trigger
//     is its effective pair, so a later migration that repoints an anchor (UPDATE ... SET action = replace(action, char(10) || 'code-anchor:
//     OLD', char(10) || 'code-anchor: NEW') WHERE id = N) supersedes the older one, and a comment line "-- ANCHOR-RETIRED: <id or metric_key>
//     <reason>" retires a spent one. Each effective pair must name a repository file on this checkout (a worker's worker.js, or a file under
//     scripts/) and an anchor that occurs EXACTLY ONCE in it (0 is the 1238 defect, 2 or more cannot place an edit either), and the worker
//     must be one the code loop may change (PLAN_DENY_WORKERS, read from the orchestrator);
//   * the suite names the workers it reads as "../<dir>/worker.js" (WATCHED), so SUITE-DEPENDENTS-1 in scripts/run-suites.mjs selects it on a
//     PR that changes one of them: the PR that moves an anchored line is the one that goes red, and its author adds the repoint in the same PR.
//     The suite itself proves the selection for every dir in WATCHED, and a pair that names another worker fails until it is listed;
//   * anchors written by migrations before BREACH-CODE-ANCHORS-1 (409, 3687, 537 and others) cannot be judged from the repository, so they are
//     reported as NOTEs only;
//   * the guard is exercised on fixtures: a refactored anchored line goes red, the repoint migration clears it, a bad pair in a later
//     migration is caught, a retirement clears, INSERT ... SELECT and VALUES forms are read, an unkeyed or unlisted write fails.
//
// LAYER 2, the migration itself (replayed on SQLite against a fixture with the live layout: analytics_metric_triggers, v_metric_trigger_state,
// metric_registry, remediation_contracts, failure_modes, capability_ledger, decision_log with its append-only triggers and the
// decision_predictions parser, 51 breaching triggers as measured on 2026-10-19 11:50Z):
//   * the lever sentence sits inside the 300 characters of prose that qnfo-fleet-control triggerIssueDescription (read from its source) keeps,
//     so the filed issue carries the edit and not only the title; no new text trips the code orchestrator PLAN_DENY_TEXT;
//   * only the four intended trigger rows and the issue-99926 probe change; the old text is kept inside the new action; the Pillar header the
//     dashboard parses is unchanged; the live breach_code_task_pct SQL reads 4 of 51 (7.8) before and 7 of 51 (13.7) after, and stays at or
//     above 10 until 70 triggers breach (the margin depends on N: 1 above the ceiling at 51, 2 at 50);
//   * applying the file twice changes nothing more; the Rollback line restores every action and note byte for byte and the probe; the file can be
//     applied again after a rollback;
//   * fm-breach-anchor-stale (active, the only closing check that is probed) reads 1 on the corrected 1238 anchor, 0 on the stale text and on
//     any other anchor, and 1 when the row or the anchor line is gone. The issue-99926 contract stays parked as monitoring (neither prober
//     reads a parked row, checked against both probers' SQL), so its probe is the recorded closing condition and the issue closes through
//     TRIGGER-RECOVERY-1; the decision prediction parses;
//   * migrations/2026-10-19-breach-lever-issues.sql files the three levers as agent_issues for the code loop (the follow-up the open
//     METRIC-TRIGGER issues cannot carry, because evaluateMetricTriggers never rewrites an open issue or a reopened twin).
// A neutralised run shows the guards bite: NEUTRALISE_MIGRATION=1 node migrations/code-anchor-once.test.mjs must exit 1.
// Run: node migrations/code-anchor-once.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { discover, select } from "../scripts/run-suites.mjs";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const MIG = "migrations/2026-10-19-breach-code-task-anchors.sql";
const FOLLOW = "migrations/2026-10-19-breach-lever-issues.sql";
const GUARD_FROM = MIG.split("/")[1]; // the first migration the anchor guard judges
const SELF = "migrations/code-anchor-once.test.mjs";
const sql = rd(MIG);
const NEUTRAL = process.env.NEUTRALISE_MIGRATION === "1";
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
const countOf = (text, needle) => { let n = 0, i = 0; while ((i = text.indexOf(needle, i)) >= 0) { n++; i += needle.length; } return n; };

// SUITE-DEPENDENTS-1 (scripts/run-suites.mjs) selects a suite for a PR when its text names "../<changed dir>/". These are the workers whose
// files this suite reads; naming them here is what runs the guard on a PR that moves an anchored line. A pair that names a worker not listed
// here fails the guard: add "../<dir>/worker.js" to this list in the PR that writes the pair.
const WATCHED = ["../qnfo-jobsearch/worker.js", "../idea-hub/worker.js", "../q08-signal-engine/worker.js", "../qnfo-research-exec/worker.js", "../qnfo-fleet-control/worker.js", "../qnfo-code-orchestrator/worker.js", "../qnfo-fleet-dashboard/worker.js", "../qnfo-ai-search/worker.js", "../qnfo-lifecycle/worker.js", "../qnfo-cloud-ops/worker.js", "../qnfo-agents/src/index.ts", "../qnfo-ai/worker.js", "../qnfo-youtube-shorts/worker.js"];
// scripts, .github and migrations changes already run every suite (SHARED in scripts/run-suites.mjs)
const SHARED_DIRS = ["scripts", ".github", "migrations"];
const dirOf = (p) => String(p).split("/")[0];
const isWatched = (watched, p) => SHARED_DIRS.indexOf(dirOf(p)) >= 0 || watched.some((w) => w.startsWith("../" + dirOf(p) + "/"));
function rdW(p) {
  if (!isWatched(WATCHED, p)) throw new Error(p + " is not under a directory listed in WATCHED");
  return readFileSync(new URL("../" + p, import.meta.url), "utf8");
}

// ---- what the repository says (read from the sources, never copied)
const fc = rdW("qnfo-fleet-control/worker.js");
const a0 = fc.indexOf("var ACT_BRIDGE_MARK = "), a1 = fc.indexOf("// TRIGGER-DISPATCH-1", a0);
if (a0 < 0 || a1 < 0) throw new Error("ACT_BRIDGE_MARK / triggerIssueDescription not found in qnfo-fleet-control/worker.js: update migrations/code-anchor-once.test.mjs to read it");
const bridge = new Function(fc.slice(a0, a1) + "; return { MARK: ACT_BRIDGE_MARK, desc: triggerIssueDescription };")();
const orch = rdW("qnfo-code-orchestrator/worker.js");
const orchConst = (name, re) => {
  const m = re.exec(orch);
  if (!m) throw new Error("qnfo-code-orchestrator/worker.js: " + name + " not found in the expected shape; update migrations/code-anchor-once.test.mjs to read it");
  return m[1];
};
const denyText = new Function("return " + orchConst("PLAN_DENY_TEXT", /const PLAN_DENY_TEXT = (\/.*\/[a-z]*);/))();
const controlPlane = JSON.parse(orchConst("PLAN_CONTROL_PLANE", /const PLAN_CONTROL_PLANE = (\[[^\]]*\]);/));
const canaried = JSON.parse(orchConst("PLAN_LOOP_CANARIED", /const PLAN_LOOP_CANARIED = (\[[^\]]*\]);/));
const denyWorkers = controlPlane.filter((w) => canaried.indexOf(w) < 0); // control-plane workers the code loop refuses
const intakeMark = new Function("return " + orchConst("INTAKE_MARK", /const INTAKE_MARK = (\/.*\/[a-z]*);/))();
const intakeTrusted = orchConst("INTAKE_TRUSTED_DEFAULT", /const INTAKE_TRUSTED_DEFAULT = "([^"]*)";/);
const goalMax = Number(orchConst("GOAL_MAX", /const GOAL_MAX = (\d+);/));
const pillarRe = /^Pillar [a-z]+(?: [a-z]+)?(?: \([^)]*\))?(?:\.|:)\s*/i; // the dashboard parser (qnfo-fleet-dashboard worker.js)

// the first code-task line and the first code-anchor line of an action, as triggerIssueDescription and the intake read them
function pairOf(action) {
  const marks = String(action || "").match(bridge.MARK) || [];
  const t = marks.filter((l) => /code-task:/.test(l))[0], an = marks.filter((l) => /code-anchor:/.test(l))[0];
  if (!t || !an) return null;
  const path = (/path=(\S+)/.exec(t) || [])[1], anchor = an.replace(/^\s*code-anchor:[ \t]*/, "").replace(/[ \t]+$/, "");
  return { path, anchor };
}

// ---- the anchor ledger: what the migrations say the live triggers carry
// A small SQL scanner: statements split at ';' outside literals and comments, string literals decoded ('' is a quote) and replaced in the
// statement text by '@<index>' so the structure (WHERE, VALUES, SELECT, commas) can be read without a parser. A literal is tagged when it
// sits behind the statement's top-level WHERE.
function scanSql(text) {
  const stmts = [];
  const fresh = () => ({ code: "", lits: [], depth: 0, whereAt: -1 });
  let cur = fresh(), i = 0;
  const n = text.length;
  const flush = () => { if (cur.code.trim()) stmts.push(cur); cur = fresh(); };
  while (i < n) {
    const c = text[i];
    if (c === "-" && text[i + 1] === "-") { while (i < n && text[i] !== "\n") i++; continue; }
    if (c === "/" && text[i + 1] === "*") { const j = text.indexOf("*/", i + 2); i = j < 0 ? n : j + 2; continue; }
    if (c === "'") {
      let s = ""; i++;
      while (i < n) {
        if (text[i] === "'") { if (text[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; }
        s += text[i++];
      }
      cur.code += "'@" + cur.lits.length + "'";
      cur.lits.push({ text: s, where: cur.whereAt >= 0 });
      continue;
    }
    if (c === ";") { flush(); i++; continue; }
    if (c === "(") cur.depth++; else if (c === ")") cur.depth--;
    if (cur.depth === 0 && cur.whereAt < 0 && (c === "W" || c === "w") && /^where(?!\w)/i.test(text.slice(i, i + 6)) && !/\w/.test(text[i - 1] || " ")) cur.whereAt = cur.code.length;
    cur.code += c; i++;
  }
  flush();
  return stmts;
}
function splitTop(s) {
  const out = []; let d = 0, st = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") d++; else if (c === ")") d--; else if (c === "," && d === 0) { out.push(s.slice(st, i)); st = i + 1; }
  }
  out.push(s.slice(st));
  return out.map((x) => x.trim());
}
function closeParen(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) { if (s[i] === "(") d++; else if (s[i] === ")") { d--; if (d === 0) return i; } }
  return -1;
}
// 'a' || char(10) || 'b' -> "a\nb"; anything else in the chain is unknown and adds nothing
function evalExpr(expr, lits) {
  let out = "";
  String(expr || "").split("||").forEach((p) => {
    p = p.trim();
    const m = /^'@(\d+)'$/.exec(p);
    if (m) out += lits[Number(m[1])].text; else if (/^char\(\s*10\s*\)$/i.test(p)) out += "\n";
  });
  return out;
}
// the code-task / code-anchor lines the intake reads, one literal at a time (a literal that starts with the marker is a line of its own, as
// every migration here writes them: char(10) || 'code-task: ...' || char(10) || 'code-anchor: ...')
function markers(text) {
  const task = [], anchor = [];
  String(text).split("\n").forEach((l) => {
    let m;
    if ((m = /^[ \t]*code-task:[ \t]*(.*)$/.exec(l))) task.push(m[1]);
    else if ((m = /^[ \t]*code-anchor:[ \t]*(.*)$/.exec(l))) anchor.push(m[1].replace(/[ \t]+$/, ""));
  });
  return { task, anchor };
}
const pathOf = (taskLine) => (/\bpath=(\S+)/.exec(taskLine || "") || [])[1] || null;
// the triggers a WHERE clause names: one target per trigger; an id and a metric_key joined by AND name the same trigger (aliases), an IN list
// names several
function targetsOfWhere(whereCode, lits) {
  let m;
  const one = [];
  if ((m = /\bid\s*=\s*(\d+)\b/i.exec(whereCode))) one.push("id:" + m[1]);
  if ((m = /\bmetric_key\s*=\s*'@(\d+)'/i.exec(whereCode))) one.push("metric:" + lits[Number(m[1])].text);
  if (one.length) return [one];
  const many = [];
  if ((m = /\bid\s+IN\s*\(([\d\s,]+)\)/i.exec(whereCode))) m[1].split(",").forEach((x) => { if (x.trim()) many.push(["id:" + x.trim()]); });
  else if ((m = /\bmetric_key\s+IN\s*\(([^)]*)\)/i.exec(whereCode))) Array.from(m[1].matchAll(/'@(\d+)'/g)).forEach((x) => many.push(["metric:" + lits[Number(x[1])].text]));
  return many;
}
// every pair a file writes to analytics_metric_triggers: { writes: [{ targets, path|null, anchor }], unkeyed: [...], retired: [key] }
function anchorWrites(sqlText) {
  const writes = [], unkeyed = [], retired = [];
  for (const st of scanSql(sqlText)) {
    const code = st.code;
    let m;
    if (/^\s*UPDATE\s+(?:OR\s+\w+\s+)?analytics_metric_triggers\b/i.test(code)) {
      const setCode = st.whereAt >= 0 ? code.slice(0, st.whereAt) : code;
      if (!/\baction\s*=/i.test(setCode)) continue;
      const mk = markers(st.lits.filter((l) => !l.where).map((l) => l.text).join("\n"));
      if (!mk.anchor.length) continue;
      const targets = st.whereAt >= 0 ? targetsOfWhere(code.slice(st.whereAt), st.lits) : [];
      const w = { targets, path: pathOf(mk.task[mk.task.length - 1]), anchor: mk.anchor[mk.anchor.length - 1], stmt: code.replace(/\s+/g, " ").slice(0, 90) };
      (targets.length ? writes : unkeyed).push(w);
    } else if ((m = /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+analytics_metric_triggers\s*\(([^)]*)\)\s*/i.exec(code))) {
      const cols = m[1].split(",").map((c) => c.trim().toLowerCase());
      const rest = code.slice(m[0].length);
      const tuples = [];
      if (/^VALUES(?!\w)/i.test(rest)) {
        let p = rest.indexOf("(");
        while (p >= 0) {
          const q = closeParen(rest, p);
          if (q < 0) break;
          tuples.push(splitTop(rest.slice(p + 1, q)));
          if (!rest.slice(q + 1).trimStart().startsWith(",")) break;
          p = rest.indexOf("(", q + 1);
        }
      } else if (/^SELECT(?!\w)/i.test(rest)) {
        const body = rest.slice(6);
        let d = 0, cut = body.length;
        for (let i = 0; i < body.length; i++) {
          const c = body[i];
          if (c === "(") d++; else if (c === ")") d--;
          else if (d === 0 && /^(where|from)(?!\w)/i.test(body.slice(i, i + 6)) && !/\w/.test(body[i - 1] || " ")) { cut = i; break; }
        }
        tuples.push(splitTop(body.slice(0, cut)));
      }
      for (const f of tuples) {
        const row = {};
        cols.forEach((c, i) => { row[c] = f[i]; });
        const mk = markers(evalExpr(row.action, st.lits));
        if (!mk.anchor.length) continue;
        const key = evalExpr(row.metric_key, st.lits);
        const w = { targets: key ? [["metric:" + key]] : [], path: pathOf(mk.task[mk.task.length - 1]), anchor: mk.anchor[mk.anchor.length - 1], stmt: code.replace(/\s+/g, " ").slice(0, 90) };
        (w.targets.length ? writes : unkeyed).push(w);
      }
    }
  }
  const rx = /^--[ \t]*ANCHOR-RETIRED:[ \t]*(\S+)/gm;
  let r;
  while ((r = rx.exec(sqlText))) retired.push(/^\d+$/.test(r[1]) ? "id:" + r[1] : "metric:" + r[1]);
  return { writes, unkeyed, retired };
}
// files: [{ name, sql }] in apply order. The last writer of a trigger is its effective pair; a replace-only repoint inherits the path of the
// pair before it; ids and metric_keys named together in one WHERE are the same trigger from then on; a retirement removes the pair (it is
// applied after the statements of its own file).
function buildLedger(files, guardFrom) {
  const map = new Map(), parent = new Map(), problems = [];
  const find = (k) => { while (parent.has(k)) k = parent.get(k); return k; };
  for (const f of files) {
    const guarded = f.name >= guardFrom;
    const { writes, unkeyed, retired } = anchorWrites(f.sql);
    for (const w of writes) for (const keys of w.targets) {
      const roots = keys.map(find);
      const prev = roots.map((r) => map.get(r)).find((x) => x && x.path);
      const root = roots[0];
      const names = new Set(keys);
      roots.forEach((r) => { const old = map.get(r); if (old) old.keys.forEach((k) => names.add(k)); if (r !== root) { parent.set(r, root); map.delete(r); } });
      map.set(root, { keys: Array.from(names), file: f.name, path: w.path || (prev && prev.path) || null, anchor: w.anchor, guarded });
    }
    if (guarded) unkeyed.forEach((u) => problems.push(f.name + ": a code-anchor is written to analytics_metric_triggers without a key the guard can follow (" + u.stmt + "): use WHERE id = N, WHERE id IN (...) or WHERE metric_key = '...', or an INSERT that lists metric_key"));
    retired.forEach((k) => { map.delete(find(k)); });
  }
  return { map, problems };
}
const keyName = (e) => e.keys.join("+");
const REPAIR = (e) => { const k = e.keys.find((x) => x.startsWith("id:")) || e.keys[0]; return "Repoint it in a migration that sorts after " + e.file + ": UPDATE analytics_metric_triggers SET action = replace(action, char(10) || 'code-anchor: <old anchor line>', char(10) || 'code-anchor: <new anchor line>') WHERE " + (k.startsWith("id:") ? "id = " + k.slice(3) : "metric_key = '" + k.slice(7) + "'") + " (the whole anchor line, one statement), or retire it with a comment line '-- ANCHOR-RETIRED: " + k.replace(/^(id|metric):/, "") + " <why>'."; };
// env: read(path) for a watched worker file (throws when it is not listed), readAny(path) for any file of the checkout, exists(path),
// watched, denyWorkers
function checkLedger(ledger, env) {
  const problems = ledger.problems.slice(), legacy = [];
  let checked = 0;
  for (const e of ledger.map.values()) {
    const label = e.file + " " + keyName(e);
    if (!e.guarded) {
      if (!e.path) continue;
      let n = -1;
      try { n = countOf(env.readAny(e.path), e.anchor); } catch (x) { n = -1; }
      if (n !== 1) legacy.push(keyName(e) + " " + e.path + " x" + n);
      continue;
    }
    checked++;
    if (!e.path) { problems.push(label + ": the anchor has no code-task line with a path (a repoint inherits the path of an earlier pair, a first pair needs its own code-task line)"); continue; }
    if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/.test(e.path) || e.path.split("/").indexOf("..") >= 0) { problems.push(label + ": " + e.path + " is not a repository-relative file path (the shape the intake reads)"); continue; }
    if (!isWatched(env.watched, e.path)) { problems.push(label + ": " + e.path + " is under a directory that is not in WATCHED in migrations/code-anchor-once.test.mjs; add \"../" + dirOf(e.path) + "/" + e.path.split("/").slice(1).join("/") + "\" to WATCHED so a PR that changes it runs this suite (SUITE-DEPENDENTS-1)"); continue; }
    const worker = dirOf(e.path);
    if (/^[a-z0-9][a-z0-9-]*\/worker\.js$/.test(e.path) && !env.exists(worker + "/wrangler.toml")) problems.push(label + ": " + worker + " has no wrangler.toml, so it is not a live worker directory");
    if (env.denyWorkers.indexOf(worker) >= 0) problems.push(label + ": " + worker + " is a control-plane worker the code loop refuses (PLAN_DENY_WORKERS), so the lever has no doer");
    if (!(e.anchor.length > 0 && e.anchor.length <= 300 && !/^\s|\s$/.test(e.anchor))) problems.push(label + ": the anchor is not one trimmed line of at most 300 characters (the intake pattern)");
    let n;
    try { n = countOf(env.read(e.path), e.anchor); } catch (x) { n = -1; }
    if (n !== 1) problems.push(label + " (" + e.path + "): the anchor occurs " + n + " times, not exactly once: " + JSON.stringify(e.anchor.slice(0, 110)) + ". " + REPAIR(e));
  }
  return { problems, legacy, checked };
}
const realFiles = readdirSync(new URL("migrations/", root)).filter((f) => f.endsWith(".sql")).sort().map((name) => ({ name, sql: rd("migrations/" + name) }));
const realEnv = { read: rdW, readAny: rd, watched: WATCHED, denyWorkers, exists: (p) => { try { return rd(p).length > 0; } catch (x) { return false; } } };
const sortFiles = (list) => list.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

// ---- fixture: the live layout (sqlite_master 2026-10-19) and the live rows this file touches
const ORIG = {
  1238: "Pillar research. Raise the ACCEPT bar and apply the diversity constraint in idea-hub triageProposals (the only live triager of idea_proposals; qnfo-idea-triage is FOLDED and not deployed) so no topic cluster exceeds 50% of accepted items in 30 days; weight the owner corpus above arXiv scans. Lever sketch (measured 2026-10-06): after an ACCEPT score on a generated proposal, classify it with the same IDEA_TOPIC_CLUSTERS qnfo-cloud-ops jobIdeaTopicMetric uses; if (cluster_count + 1) / (n + 1) > 0.5 with n >= 10, hold it as status deferred_diversity with the score kept, release held rows best-score-first with no model call once the share allows; exempt name LIKE '%owner%' and name LIKE 'intake:%' rows (SIGNAL-INTAKE-SOURCES-1 brings the non-quantum families). Since idea-hub 1.6.0 (BUDGET-SOFT-ROUTE-1) a breached cap only makes triage score lean, so the share moves with new accepts too. Definition of done: metric_registry.idea_topic_concentration_30d <= 0.5 on two consecutive days; record before and after in issue_triage.close_evidence.\ncode-task: repo=qnfo-workers path=idea-hub/worker.js\ncode-anchor: async function triageProposals(env) {",
  5394: "Pillar research (RESEARCH-BACKPRESSURE-1). The pool grows only when idea-hub accepts more proposals a day than qnfo-research-exec publishes (compare SELECT substr(created_at,1,10) d, COUNT(*) FROM research_queue GROUP BY d with SELECT substr(published_at,1,10) d, COUNT(*) FROM research_queue WHERE published_at IS NOT NULL GROUP BY d). Levers in order: (1) raise the idea-hub acceptance bar for generated proposals (owner-authored ideas stay exempt); (2) raise qnfo-research-exec RESEARCH_PARALLEL_MAX when the AI spend metrics are inside target; (3) cut stages that end in revise-noop or review-unresolved loops. DoD: research_deferred_pool <= 120 and falling for 3 days. SLA-DRAIN-3 (2026-10-14): lever 2 is applied (qnfo-research-exec 0.18.1 RESEARCH_PARALLEL_MAX 8; ops_config research_parallel 6, raise to 8 while AI spend is inside target). Next lever when the pool is still above 120 after 24 h at width 6: limit source = 'remediation' rows (COMPLETENESS-SWEEP-1 rewrites) to half of research_parallel in the executor claim order, so proposals keep slots while rewrites cycle review-unresolved or revise-noop. That is a change to the claim in qnfo-research-exec/worker.js (INFLIGHT_SQL and the claim query; 1.1 MB, so a session PR, not the code loop) or to RB_ORDER_SQL in qnfo-fleet-control RESEARCH-BACKPRESSURE-1.",
  5916: "Pillar research (CONTENT-PIPELINE-1). A paper should be live only after it passes the release gate (pub-gate-v1-deterministic). Read them: on living-paper, SELECT COALESCE(release_gate_pass, -1) g, substr(COALESCE(release_gate_reason, '(never scored)'), 1, 40) r, COUNT(*) FROM papers WHERE status = 'published' GROUP BY 1, 2 ORDER BY 3 DESC. Levers: (1) never scored: qnfo-cloud-ops PUB-GATE-LOOP-1 must score every published paper each run (PUB_GATE_CHUNK batches until none is left unscored), not stop at its change cap; (2) scored thin (25-49): route each into the revision flow (version_queue) so it is enriched and re-gated, and record the result in publication_gate_audit. Whether a thin paper stays live while it is revised is the gate policy in qnfo-cloud-ops; change it there with its measurement.",
  9193: "Pillar autonomy (EMPTY-REPLY-RATE-ALERT-1, agent_issues 2829). Find the model: SELECT model, worker, purpose, SUM(calls) c, SUM(errors) e, ROUND(1.0*SUM(errors)/SUM(calls),3) r FROM ai_call_counters WHERE day >= date('now','-1 day') GROUP BY model, worker, purpose HAVING SUM(calls) >= 5 ORDER BY r DESC. Then: (1) when the errors are empty replies from a reasoning model (finish=length), raise that caller's max_tokens or move the model behind a non-reasoning leg (REASONING-BUDGET-1); (2) when one caller dominates, demote the model in that caller's ladder or hedge order and keep a per-request fallback to the previous model; (3) when every caller of the model fails, take it out of the qnfo-ai rotation until ai-health-prober passes it under a real budget. Done: ai_model_error_rate_max_1d <= 0.5 at two refreshes."
};
const NOTES = { 1238: "Owner directive 2026-10-04: arXiv QEC must stop dominating. | REPOINT", 5394: "RESEARCH-BACKPRESSURE-1 (migrations/2026-10-13-02-research-backpressure.sql)", 5916: null, 9193: "EMPTY-REPLY-RATE-ALERT-1 (migrations/2026-10-19-resolve-empty-reply-rate.sql)" };
const TOUCHED = [1238, 5394, 5916, 9193];
const NEW_ROWS = [5394, 5916, 9193]; // rows that gain a lever, a code-task and a code-anchor
const LEVER_TAIL = { 5394: "now exempt.", 5916: "so 140 thin papers stay live.", 9193: "failed 89 of 114 calls in 24 h." };
const EXPECT_PATH = { 5394: "qnfo-fleet-control/worker.js", 5916: "qnfo-research-exec/worker.js", 9193: "q08-signal-engine/worker.js", 1238: "idea-hub/worker.js" };
const STALE = "async function triageProposals(env) {", FIXED = "async function triageProposals(env, deadline) {";
// the breaching triggers on 2026-10-19 11:50Z: id, metric, operator, threshold, value, carries a code-task line
const LIVE = [[9, "ops_agent_empty_answers_7d", "gte", 1, 1, 0], [344, "worker_count", "gt", 30, 32, 0], [354, "workers_ai_cost_30d_usd", "gt", 95, 168.86, 0], [357, "watchmaker_index", "gt", 0, 1, 0], [360, "drift_total", "gt", 0, 1, 0], [371, "remedy_efficacy_30d", "lt", 0.5, 0.22, 0], [378, "code_task_success_rate_30d", "lt", 0.5, 0.34, 0], [379, "breach_code_task_pct", "lt", 10, 7.7, 0], [388, "fix_hold_rate_30d", "lt", 0.8, 0.4627, 0], [409, "fleet_ai_run_rate_30d_usd", "gt", 95, 474.45, 1], [410, "issue_mttr_h_30d", "gt", 2, 14.67, 0], [537, "q08_gate_pass_rate_7d", "lt", 0.5, 0.059, 1], [538, "q08_neurons_per_published_piece_7d", "gt", 6000, 85171.078, 0], [1238, "idea_topic_concentration_30d", "gt", 0.5, 0.889, 1], [1867, "attention_channels_stopped", "gt", 1, 2, 0], [1959, "issues_without_next_action", "gt", 0, 73, 0], [2038, "runtime_verified_share_24h", "lt", 10, 7.1, 0], [2934, "session_dependent_issues_open", "gt", 0, 18, 0], [2935, "code_task_superseded_share_30d", "gt", 0.1, 0.16, 0], [3059, "stuck_items_over_sla", "gt", 0, 243, 0], [3060, "issues_unprobed_60m", "gt", 10, 107, 0], [3061, "unverified_blocker_claims", "gt", 0, 24, 0], [3072, "failure_modes_recurring", "gt", 0, 10, 0], [3077, "spofs_total", "gt", 0, 10, 0], [3452, "tick_completion_24h", "lt", 95, 90.3, 0], [3454, "owner_dispatch_7d", "gt", 5, 12, 0], [3464, "mttr_h_7d", "gt", 2, 80.9, 0], [3528, "tick_slot_coverage_24h", "lt", 0.95, 0.907, 0], [3687, "workers_ai_run_rate_usd", "gt", 95, 410.84, 1], [3688, "fleet_cost_run_rate_usd", "gt", 160, 416.67, 0], [3689, "monthly_cost_run_rate_usd", "gt", 650, 1521.41, 0], [4650, "code_goal_success_rate_30d", "lt", 0.9, 0.541, 0], [4982, "false_stops_7d", "gt", 0, 6, 0], [4986, "metrics_on_probation_overdue", "gt", 0, 3, 0], [4989, "tick_sequence_completion_24h", "lt", 0.9, 0.792, 0], [4992, "roster_capabilities_single_executor", "gt", 158, 166, 0], [5182, "spof_alternates_untested_24h", "gt", 0, 1, 0], [5394, "research_deferred_pool", "gt", 120, 267, 0], [5708, "issue_drain_ratio_24h", "lt", 1.5, 0.874, 0], [5795, "issue_auto_close_2h_share_24h", "lt", 1, 0.42, 0], [5915, "content_items_over_stage_sla", "gt", 0, 422, 0], [5916, "papers_live_failing_release_gate", "gt", 0, 139, 0], [5929, "sla_breaches_over_120m", "gt", 565, 597, 0], [6050, "cadence_overdue_over_120m", "gt", 0, 4, 0], [6123, "human_wait_oldest_min", "gt", 120, 205, 0], [8558, "idea_to_publish_h_p50_7d", "gt", 100, 100.1, 0], [8559, "tracker_drift", "gt", 0, 1, 0], [9162, "goals_unevaluated", "gt", 0, 1, 0], [9193, "ai_model_error_rate_max_1d", "gt", 0.5, 0.779, 0], [9262, "fleet_graph_findings_warn", "gt", 0, 89, 0], [9374, "crons_unobserved", "gt", 0, 1, 0]];
const EXISTING_PAIRS = { 409: ["qnfo-research-exec/worker.js", "async function markError(env, row, msg) {"], 3687: ["qnfo-research-exec/worker.js", "async function markError(env, row, msg) {"], 537: ["q08-signal-engine/worker.js", 'if (!title) problems.push("no H1 title");'] };
const OLD_PROBE = "SELECT '1' AS expected, CASE WHEN (SELECT hit FROM v_metric_trigger_state WHERE id = 379) = 0 AND (SELECT val FROM v_metric_trigger_state WHERE id = 379) IS NOT NULL THEN CASE WHEN (SELECT COUNT(*) FROM (SELECT observed, verified_at FROM remediation_verifications WHERE class = 'issue-99926' ORDER BY id DESC LIMIT 1) p WHERE p.observed = '1' OR (p.observed = 'recovering' AND datetime(p.verified_at) < COALESCE(datetime((SELECT last_refreshed FROM metric_registry WHERE metric = (SELECT metric_key FROM analytics_metric_triggers WHERE id = 379))), datetime('now', '-50 minutes')))) > 0 THEN '1' ELSE 'recovering' END ELSE '0' END AS observed";
// the live metric-refresh step (fleet_tasks metric-refresh, steps[4]) for breach_code_task_pct, read 2026-10-19
const PCT_SQL = "SELECT CASE WHEN COUNT(*) > 0 THEN CAST(ROUND(100.0 * SUM(CASE WHEN instr(t.action, char(10) || 'code-task:') > 0 OR t.action LIKE 'code-task:%' THEN 1 ELSE 0 END) / COUNT(*), 1) AS TEXT) ELSE 'n/a: no trigger in breach' END AS v FROM v_metric_trigger_state s JOIN analytics_metric_triggers t ON t.id = s.id WHERE s.hit = 1";

function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE analytics_metric_triggers(id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT UNIQUE, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER DEFAULT 5, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER DEFAULT 168, enabled INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE analytics_dash_records (metric TEXT, value TEXT);
CREATE TABLE analytics_dash_meta (key TEXT, value TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT NOT NULL, kind TEXT NOT NULL, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE VIEW v_metric_trigger_state AS
WITH raw AS (
  SELECT t.id, t.metric_key, t.title, t.operator, t.threshold, t.owner, t.queue_target, t.priority,
    COALESCE(
      CASE WHEN t.source_table = 'records' THEN (SELECT CASE WHEN rtrim(trim(x.value), '% ') <> '' AND rtrim(trim(x.value), '% ') NOT GLOB '*[^0-9.+-]*' THEN CAST(rtrim(trim(x.value), '% ') AS REAL) END FROM analytics_dash_records x WHERE x.metric = t.metric_key) END,
      (SELECT CASE WHEN rtrim(trim(m.value), '% ') <> '' AND rtrim(trim(m.value), '% ') NOT GLOB '*[^0-9.+-]*' THEN CAST(rtrim(trim(m.value), '% ') AS REAL) END FROM analytics_dash_meta m WHERE m.key = t.metric_key),
      (SELECT CASE WHEN rtrim(trim(r.last_value), '% ') <> '' AND rtrim(trim(r.last_value), '% ') NOT GLOB '*[^0-9.+-]*' THEN CAST(rtrim(trim(r.last_value), '% ') AS REAL) END FROM metric_registry r WHERE r.metric = t.metric_key)
    ) AS val
  FROM analytics_metric_triggers t WHERE t.enabled = 1
)
SELECT id, metric_key, title, operator, threshold, owner, queue_target, priority, val,
  CASE WHEN val IS NULL THEN NULL
       WHEN operator = 'gt' THEN val > threshold
       WHEN operator = 'lte' THEN val <= threshold
       WHEN operator = 'lt' THEN val < threshold
       WHEN operator = 'eq' THEN val = threshold
       ELSE val >= threshold END AS hit
FROM raw;
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT DEFAULT (datetime('now')), last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER DEFAULT 45000, next_due_at TEXT, max_items INTEGER DEFAULT 5, requires_container INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0);
CREATE TRIGGER remediation_probe_edit_rerun AFTER UPDATE OF verify_probe, verify_transport ON remediation_contracts WHEN NEW.verify_probe IS NOT OLD.verify_probe OR NEW.verify_transport IS NOT OLD.verify_transport BEGIN UPDATE remediation_contracts SET next_due_at = datetime('now') WHERE class = NEW.class; END;
CREATE TRIGGER remediation_probe_semicolon_upd AFTER UPDATE OF verify_probe, verify_transport ON remediation_contracts WHEN NEW.verify_transport LIKE 'd1-query%' AND instr(COALESCE(NEW.verify_probe, ''), ';') > 0 BEGIN UPDATE remediation_contracts SET verify_probe = replace(rtrim(trim(verify_probe), ';'), ';', ',') WHERE class = NEW.class; END;
CREATE TRIGGER remediation_probe_semicolon_ins AFTER INSERT ON remediation_contracts WHEN NEW.verify_transport LIKE 'd1-query%' AND instr(COALESCE(NEW.verify_probe, ''), ';') > 0 BEGIN UPDATE remediation_contracts SET verify_probe = replace(rtrim(trim(verify_probe), ';'), ';', ',') WHERE class = NEW.class; END;
CREATE TRIGGER remediation_contracts_cadence_1h_ai AFTER INSERT ON remediation_contracts WHEN NEW.expected_cadence_h IS NULL OR NEW.expected_cadence_h > 1 BEGIN UPDATE remediation_contracts SET expected_cadence_h = 1 WHERE class = NEW.class; END;
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE capability_ledger (capability TEXT PRIMARY KEY, provenance TEXT NOT NULL, prerequisites TEXT, reliability TEXT, acquired_at TEXT NOT NULL, last_exercised_at TEXT, evidence TEXT NOT NULL);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TABLE decision_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('metric', 'issue')), subject TEXT NOT NULL, op TEXT NOT NULL CHECK (op IN ('<', '<=', '>', '>=', '=', 'between', 'closed')), value REAL, value2 REAL, due_at TEXT NOT NULL, origin TEXT NOT NULL CHECK (origin IN ('parsed', 'seeded')), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), scored_at TEXT, observed TEXT, matched INTEGER, UNIQUE (decision_id, subject, op));
CREATE TRIGGER decision_predictions_parse AFTER INSERT ON decision_log
WHEN instr(COALESCE(NEW.predicted_outcome, ''), ' within ') > 0
BEGIN
  INSERT OR IGNORE INTO decision_predictions (decision_id, kind, subject, op, value, due_at, origin)
    SELECT NEW.id, 'metric', t.tok1, t.tok2, CAST(t.tok3 AS REAL),
      strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+' || CAST(t.after AS INTEGER) || CASE WHEN instr(t.after, ' d') > 0 THEN ' days' ELSE ' hours' END), 'parsed'
    FROM (
      SELECT u.tok1, u.tok2,
        CASE WHEN instr(u.rest2, ' ') > 0 THEN substr(u.rest2, 1, instr(u.rest2, ' ') - 1) ELSE u.rest2 END AS tok3, u.after
      FROM (
        SELECT v.tok1,
          CASE WHEN instr(v.rest1, ' ') > 0 THEN substr(v.rest1, 1, instr(v.rest1, ' ') - 1) ELSE v.rest1 END AS tok2,
          CASE WHEN instr(v.rest1, ' ') > 0 THEN ltrim(substr(v.rest1, instr(v.rest1, ' ') + 1)) ELSE '' END AS rest2, v.after
        FROM (
          SELECT substr(w.p, 1, instr(w.p, ' ') - 1) AS tok1, ltrim(substr(w.p, instr(w.p, ' ') + 1)) AS rest1,
            ltrim(substr(w.p, instr(w.p, ' within ') + 8)) AS after
          FROM (SELECT trim(NEW.predicted_outcome) AS p) w
        ) v
      ) u
    ) t
    WHERE t.tok1 IN (SELECT metric FROM metric_registry) AND t.tok2 IN ('<', '<=', '>', '>=', '=')
      AND t.tok3 GLOB '[0-9]*' AND CAST(t.after AS INTEGER) > 0;
END;`);
  const ins = db.prepare("INSERT INTO analytics_metric_triggers (id, metric_key, title, source_table, operator, threshold, action, owner, notes, enabled) VALUES (?, ?, ?, 'meta', ?, ?, ?, 'x', ?, 1)");
  const reg = db.prepare("INSERT INTO metric_registry (metric, layer, kind, last_value) VALUES (?, 'system', 'outcome', ?)");
  LIVE.forEach(([id, key, op, thr, val, ct]) => {
    let action = ORIG[id];
    if (action === undefined) {
      action = "Pillar autonomy. Placeholder lever for trigger " + id + ".";
      if (ct) action += "\ncode-task: repo=qnfo-workers path=" + EXISTING_PAIRS[id][0] + "\ncode-anchor: " + EXISTING_PAIRS[id][1];
    }
    ins.run(id, key, key, op, thr, action, NOTES[id] === undefined ? null : NOTES[id]);
    reg.run(key, String(val));
  });
  // decoys: a trigger that is not breaching (carries a code-task), a disabled breaching one, an unrelated contract
  ins.run(364, "gateway_cap_30d_usd", "gateway", "gt", 180, "Pillar cost. decoy.\ncode-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js\ncode-anchor: x", null);
  reg.run("gateway_cap_30d_usd", "180");
  db.prepare("INSERT INTO analytics_metric_triggers (id, metric_key, title, source_table, operator, threshold, action, owner, enabled) VALUES (9998, 'disabled_decoy', 'd', 'meta', 'gt', 0, 'Pillar core. disabled.', 'x', 0)").run();
  reg.run("disabled_decoy", "5");
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, expected_cadence_h, status, module) VALUES ('issue-99926', 99926, 'born with the issue (ORPHAN-GUARD-BIRTH-1)', 'needs-machine-probe', ?, 'd1-query', 'qnfo-fleet-control', 1, 'monitoring', 'probe-template-v1h')").run(OLD_PROBE);
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, expected_cadence_h, status, module) VALUES ('issue-100045', 100045, 'x', 'needs-machine-probe', 'SELECT 1 AS expected, 1 AS observed', 'd1-query', 'qnfo-ai', 1, 'monitoring', 'probe-template-v1h')").run();
  db.prepare("INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen) VALUES ('other-mode', 'a', 'b', 'c', 'd', 'fm-other-mode', '2026-10-19T00:00:00Z')").run();
  return db;
}
const apply = (db) => { if (!NEUTRAL) db.exec(sql); };
const all = (db, q) => db.prepare(q).all();
const get = (db, q) => db.prepare(q).get();
const actions = (db) => Object.fromEntries(all(db, "SELECT id, action FROM analytics_metric_triggers").map((r) => [r.id, r.action]));
const dump = (db) => JSON.stringify({
  t: all(db, "SELECT * FROM analytics_metric_triggers ORDER BY id"), rc: all(db, "SELECT * FROM remediation_contracts ORDER BY class"),
  fm: all(db, "SELECT * FROM failure_modes ORDER BY fm_key"), cap: all(db, "SELECT * FROM capability_ledger ORDER BY capability"),
  dl: all(db, "SELECT * FROM decision_log ORDER BY id"), dp: all(db, "SELECT * FROM decision_predictions ORDER BY id"),
});
const pct = (db) => get(db, PCT_SQL).v;

// ---- the file itself
{
  const lines = sql.split("\n");
  ok(lines[0] === "-- APPLY-BY: ci" && lines[1] === "-- DB: qnfo-audit" && /^-- Rollback: \S/.test(lines[2]) && !lines[2].slice(12).includes("\n"), "the header opts in to the migration runner and carries a one-line Rollback", lines.slice(0, 3));
  const stmts = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  ok(!/^\s*(DELETE\s+FROM|DROP\s+)/im.test(stmts), "the file runs no DELETE or DROP, so it needs no BACKUP header; its backup tables are created ahead of the first change");
  ok(/CREATE TABLE IF NOT EXISTS bak_20261019_breach_anchors AS SELECT id, metric_key, action, notes FROM analytics_metric_triggers WHERE id IN \(1238, 5394, 9193, 5916\)/.test(stmts) && stmts.indexOf("bak_20261019_breach_anchors AS") < stmts.indexOf("UPDATE analytics_metric_triggers"), "the backup of the four trigger rows is taken before the first update");
  ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link (CLOUDFLARE-ONLY-HOST-1)");
  ok(!/\b(LIKE|GLOB)\s+'[^']{50,}'/i.test(stmts), "no LIKE or GLOB pattern over 50 bytes (D1 refuses it)");
  const py = spawnSync("python3", ["-I", "scripts/apply_migrations.py", "--check", MIG], { cwd: rootPath, encoding: "utf8" });
  if (!py.error) ok(py.status === 0, "scripts/apply_migrations.py --check passes the file", (py.stdout || "") + (py.stderr || ""));
}

// ---- the metric before the fix, and the defect shape the guard exists for (a synthetic file, so no checkout state can change the verdict)
{
  const db0 = build();
  const before = pct(db0);
  ok(LIVE.length === 51 && get(db0, "SELECT COUNT(*) AS n FROM v_metric_trigger_state WHERE hit = 1").n === 51, "the fixture has the 51 breaching triggers of the live read", LIVE.length);
  ok(before === "7.8", "before the fix the live formula reads 4 of 51 = 7.8, under the floor of 10", before);
  const stale = pairOf(actions(db0)[1238]);
  ok(stale && stale.anchor === STALE && stale.path === "idea-hub/worker.js", "before the fix trigger 1238 names the anchor " + STALE, stale);
  const hubNow = "async function triageProposals(env, deadline) {\n  return 1;\n}\n";
  ok(countOf(hubNow, STALE) === 0 && countOf(hubNow, FIXED) === 1, "on a file with the (env, deadline) signature the old 1238 anchor matches nothing and the corrected one matches once (the defect the guard exists for)");
  ok(get(db0, "SELECT hit FROM v_metric_trigger_state WHERE id = 379").hit === 1, "trigger 379 is in breach before the fix");
  ok(Object.keys(EXISTING_PAIRS).every((id) => { const p = pairOf(actions(db0)[id]); return p && p.path === EXISTING_PAIRS[id][0] && p.anchor === EXISTING_PAIRS[id][1]; }), "the fixture carries the live pairs of triggers 409, 3687 and 537");
}

// ---- apply once: the guard, the prose, the rows
const db = build();
const base = dump(db), baseActions = actions(db);
apply(db);
const after = actions(db);
{
  // 1238: only the anchor changes
  ok(!after[1238].includes(STALE) && after[1238].endsWith("\ncode-anchor: " + FIXED), "1238 ends in the corrected anchor", after[1238].slice(-120));
  ok(after[1238].replace(FIXED, STALE) === baseActions[1238], "1238 differs from the old text in the anchor and nowhere else");
  // every pair the file writes, read from the DB the file produced, agrees with what the ledger parser reads from the file text (so the
  // guard below judges the pairs the live triggers will carry). Whether the anchors still occur once on the checkout is the guard's verdict,
  // not this block's: a later repoint migration may legitimately have moved them.
  const own = buildLedger(realFiles.filter((f) => f.name <= GUARD_FROM), GUARD_FROM).map;
  const ownIds = Array.from(own.values()).filter((e) => e.file === GUARD_FROM).map((e) => e.keys.find((k) => k.startsWith("id:"))).sort();
  ok(JSON.stringify(ownIds) === JSON.stringify(TOUCHED.map((id) => "id:" + id).sort()), "the ledger parser reads exactly the four triggers this file writes", ownIds);
  TOUCHED.forEach((id) => {
    const p = pairOf(after[id]);
    ok(!!p, "trigger " + id + " ends in a code-task line and a code-anchor line", after[id].slice(-200));
    if (!p) return;
    ok(p.path === EXPECT_PATH[id], "trigger " + id + " names " + EXPECT_PATH[id], p.path);
    const e = Array.from(own.values()).find((x) => x.keys.indexOf("id:" + id) >= 0);
    ok(e && e.file === GUARD_FROM && e.path === p.path && e.anchor === p.anchor, "trigger " + id + ": the ledger parser and the replayed DB agree on the pair", { ledger: e && { file: e.file, path: e.path, anchor: e.anchor }, db: p });
  });
  // the new rows keep the old text, the Pillar header, and carry the lever inside the 300 characters the issue keeps
  NEW_ROWS.forEach((id) => {
    const o = baseActions[id], a = after[id], cut = o.indexOf(").") + 2;
    ok(a.startsWith(o.slice(0, cut)) && pillarRe.exec(a)[0] === pillarRe.exec(o)[0], "trigger " + id + ": the Pillar header the dashboard parses is unchanged", pillarRe.exec(a));
    ok(a.includes(o.slice(cut)), "trigger " + id + ": the old text is kept whole after the lever sentence");
    const d = bridge.desc("METRIC-TRIGGER #" + id + " m=1 -> ", a, " (owner x)");
    ok(/ Lever: in [a-z0-9-]+\/worker\.js /.test(d) && d.includes(LEVER_TAIL[id]), "trigger " + id + ": the lever sentence, to its last words, is inside the prose the filed issue keeps", d.slice(0, 460));
    ok(d.split("\n").length === 3 && /^code-task: repo=qnfo-workers path=\S+$/.test(d.split("\n")[1]) && /^code-anchor: .+$/.test(d.split("\n")[2]), "trigger " + id + ": the filed issue ends in the code-task and code-anchor lines, each on a line of its own");
    ok(!denyText.test(d) && !denyText.test(a), "trigger " + id + ": no text the planner refuses (PLAN_DENY_TEXT)");
    ok(a.includes("ACT-BRIDGE-FIX-20261019 evidence") && !/^code-(task|anchor):/m.test(a.split("\nACT-BRIDGE-FIX-20261019 evidence")[0]), "trigger " + id + ": one evidence paragraph, and no marker line above the two that end the action");
  });
  // only the intended rows change
  const baseRows = JSON.parse(base), nowRows = JSON.parse(dump(db));
  ok(JSON.stringify(nowRows.t.filter((r) => TOUCHED.indexOf(r.id) < 0)) === JSON.stringify(baseRows.t.filter((r) => TOUCHED.indexOf(r.id) < 0)), "every other trigger row is byte-identical");
  ok(nowRows.t.filter((r) => TOUCHED.indexOf(r.id) >= 0).every((r, i) => r.action !== baseRows.t.find((b) => b.id === r.id).action && r.notes.includes("BREACH-CODE-ANCHORS-1")), "the four touched rows changed in action and carry a BREACH-CODE-ANCHORS-1 note");
  ok(nowRows.t.every((r) => r.threshold === baseRows.t.find((b) => b.id === r.id).threshold && r.operator === baseRows.t.find((b) => b.id === r.id).operator && r.enabled === baseRows.t.find((b) => b.id === r.id).enabled), "no threshold, operator or enabled flag moved");
  ok(JSON.stringify(nowRows.rc.filter((r) => r.class === "issue-100045")) === JSON.stringify(baseRows.rc.filter((r) => r.class === "issue-100045")), "an unrelated contract is untouched");
  const rc = get(db, "SELECT * FROM remediation_contracts WHERE class = 'issue-99926'");
  ok(rc.verify_probe === OLD_PROBE && rc.status === "monitoring" && rc.action === "needs-machine-probe", "the issue-99926 contract is untouched: it keeps the standard recovering probe, its monitoring park and its action (a second evaluator oscillates a METRIC-TRIGGER issue)");
  const fmc = get(db, "SELECT * FROM remediation_contracts WHERE class = 'fm-breach-anchor-stale'");
  ok(fmc && fmc.status === "active" && fmc.verify_transport === "d1-query" && fmc.module === "failure-mode" && fmc.expected_cadence_h === 1 && fmc.issue_id === null, "the fm- detector contract is active, d1-query, hourly", fmc);
  const fm = get(db, "SELECT * FROM failure_modes WHERE fm_key = 'breach-anchor-stale'");
  ok(fm && fm.probe_class === "fm-breach-anchor-stale" && fm.issue_id === 99926 && fm.root_cause.length > 80 && fm.remediation.includes("code-anchor-once.test.mjs") && fm.trigger_condition && fm.symptom && fm.blast_radius, "the failure mode is registered with its root cause, remediation and detector", fm && fm.fm_key);
  ok(get(db, "SELECT COUNT(*) AS n FROM capability_ledger WHERE capability = 'metric-lever-anchor-guard'").n === 1, "the capability is recorded");
  const dl = all(db, "SELECT * FROM decision_log");
  ok(dl.length === 1 && dl[0].actor.startsWith("session_") && dl[0].capability_gain && dl[0].surfaces_tested && dl[0].predicted_outcome === "breach_code_task_pct >= 10 within 3 hours", "one decision_log row with its capability gain, prediction and surfaces", dl.map((r) => r.action));
  const dp = all(db, "SELECT * FROM decision_predictions");
  ok(dp.length === 1 && dp[0].subject === "breach_code_task_pct" && dp[0].op === ">=" && dp[0].value === 10 && dp[0].origin === "parsed", "the prediction parses into decision_predictions", dp);
  ok(!/INSERT\s+(OR\s+\w+\s+)?INTO\s+agent_issues|UPDATE\s+agent_issues/i.test(sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n")), "the file never writes agent_issues (the open METRIC-TRIGGER issues are not rewritten)");
}

// ---- the metric: the live SQL counts the new rows
{
  const v = pct(db);
  ok(v === "13.7", "after the apply the live breach_code_task_pct SQL reads 7 of 51 = 13.7", v);
  ok(all(db, "SELECT t.id FROM v_metric_trigger_state s JOIN analytics_metric_triggers t ON t.id = s.id WHERE s.hit = 1 AND (instr(t.action, char(10) || 'code-task:') > 0 OR t.action LIKE 'code-task:%') ORDER BY t.id").map((r) => r.id).join(",") === "409,537,1238,3687,5394,5916,9193", "the rows that carry a code-task line are 409, 537, 1238, 3687 and the three new ones");
  const n = get(db, "SELECT COUNT(*) AS n FROM v_metric_trigger_state WHERE hit = 1").n, ct = 7;
  ok(ct >= Math.ceil(0.1 * n) + 1, "7 code-task lines clear ceil(10 percent of " + n + ") = " + Math.ceil(0.1 * n) + " with a margin of at least 1", { n, ct });
  let maxN = n; while (ct / (maxN + 1) * 100 >= 10) maxN++;
  ok(maxN >= 65, "the floor of 10 holds until " + maxN + " triggers breach", maxN);
  console.log("NOTE the margin depends on N: 7 named levers clear the floor of 10 while N <= " + maxN + "; at N = " + n + " the margin over ceil(10 percent) is " + (ct - Math.ceil(0.1 * n)) + ", at N = 50 it is 2 (the live count moves with every refresh)");
  // a breach that recovers stops counting, numerator and denominator: the pool is the first to clear once POOL-BOUND-1 parks it
  const recover = (...metrics) => { const d2 = build(); apply(d2); metrics.forEach((m) => d2.prepare("UPDATE metric_registry SET last_value = '0' WHERE metric = ?").run(m)); return pct(d2); };
  const p1 = recover("research_deferred_pool"), p2 = recover("research_deferred_pool", "ai_model_error_rate_max_1d"), p3 = recover("research_deferred_pool", "ai_model_error_rate_max_1d", "papers_live_failing_release_gate");
  ok(p1 === "12.0" && Number(p2) >= 10, "the share holds at or above 10 when the pool clears (6 of 50 = 12.0) and when the error rate clears too (5 of 49 = 10.2)", { p1, p2 });
  console.log("NOTE if all three fixed breaches recover the share is " + p3 + " (4 of 48): each lever that lands needs the next breach to name its doer");
  // issue 99926 closes through TRIGGER-RECOVERY-1 on the metric; its parked contract is not touched by the file (the anchor half is the detector below)
  const run = (q, d) => { try { return (d || db).prepare(q).get() || {}; } catch (e) { return { error: String(e && e.message) }; } };
  const fmp = (get(db, "SELECT verify_probe AS p FROM remediation_contracts WHERE class = 'fm-breach-anchor-stale'") || {}).p || "SELECT 1 WHERE 0";
  db.prepare("UPDATE metric_registry SET last_value = ? WHERE metric = 'breach_code_task_pct'").run(v);
  const consumerSql = /CONTRACT_SQL = """([\s\S]*?)"""/.exec(rd("scripts/remediation_consumer.py"));
  ok(consumerSql && /status = 'active'/.test(consumerSql[1]) && !/monitoring/.test(consumerSql[1]), "scripts/remediation_consumer.py CONTRACT_SQL probes active contracts (holding only for runner-https), never a monitoring one; if this fails the parked issue-99926 probe now runs and the comment in the migration is stale", consumerSql && consumerSql[1].slice(0, 260));
  ok(/FROM remediation_contracts c LEFT JOIN agent_issues a ON a\.id = c\.issue_id WHERE c\.status IN \('active', 'holding'\)/.test(fc), "qnfo-fleet-control remediationContractsTick probes active and holding contracts, never a monitoring one; if this fails the parked issue-99926 probe now runs and the comment in the migration is stale");
  // the active detector (the only probed check of the 1238 anchor): 1 on the corrected anchor, 0 on the stale text and on any other anchor,
  // 1 when the anchor line or the row is gone
  const dd = build(); apply(dd);
  const act = () => get(dd, "SELECT action FROM analytics_metric_triggers WHERE id = 1238").action;
  const setA = (a) => dd.prepare("UPDATE analytics_metric_triggers SET action = ? WHERE id = 1238").run(a);
  const f1 = run(fmp, dd);
  ok(f1.expected === "1" && f1.observed === "1", "the fm detector reads 1 on the corrected 1238 anchor", f1);
  setA(act().replace(FIXED, STALE));
  const f0 = run(fmp, dd);
  ok(f0.expected === "1" && f0.observed === "0", "the fm detector reads 0 on the stale 1238 anchor", f0);
  setA(act().replace(STALE, "async function triageProposals(env, deadline, more) {"));
  const f2 = run(fmp, dd);
  ok(f2.observed === "0", "the fm detector reads 0 on any other 1238 anchor (a new drift of 1238 itself), not only on the old text", f2);
  setA(act().slice(0, act().indexOf("\ncode-task:")));
  const f3 = run(fmp, dd);
  ok(f3.observed === "1", "the fm detector reads 1 when the 1238 action carries no anchor line (nothing can be stale)", f3);
  dd.prepare("DELETE FROM analytics_metric_triggers WHERE id = 1238").run();
  const f4 = run(fmp, dd);
  ok(f4.observed === "1", "the fm detector reads 1 when trigger 1238 is gone", f4);
  ok(!/\b(insert into|update |delete from|drop table|drop index|alter table|create table|create index|create trigger|attach |detach |pragma |replace into|vacuum)/i.test(fmp), "the detector probe contains no write keyword the consumer refuses (WRITE_KW)");
  db.prepare("UPDATE metric_registry SET last_value = '7.7' WHERE metric = 'breach_code_task_pct'").run();
}

// ---- idempotency: a second apply changes nothing
{
  const d = build(); apply(d);
  const once = dump(d);
  apply(d);
  ok(dump(d) === once, "applying the file twice leaves every table exactly as after the first apply");
  if (NEUTRAL) ok(false, "NEUTRALISE_MIGRATION=1: no backup table exists to read");
  else {
    const bak = all(d, "SELECT id, action FROM bak_20261019_breach_anchors ORDER BY id");
    ok(bak.length === 4 && bak.every((b) => b.action === baseActions[b.id]), "the backup table holds the four original action texts, and a second apply does not overwrite it", bak.map((b) => b.id));
    ok(!all(d, "SELECT name FROM sqlite_master WHERE name = 'bak_20261019_breach_anchors_rc'").length, "no contract backup exists: the file does not touch the issue-99926 contract");
  }
}

// ---- Rollback: byte for byte, and the file can be applied again
{
  const m = /^-- Rollback: (.+)$/m.exec(sql);
  const d = build(); apply(d);
  if (!NEUTRAL) {
    d.exec(m[1]);
    const back = actions(d);
    ok(Object.keys(baseActions).every((id) => back[id] === baseActions[id]), "after the Rollback line every trigger action is back byte for byte");
    ok(JSON.stringify(all(d, "SELECT id, notes FROM analytics_metric_triggers ORDER BY id")) === JSON.stringify(JSON.parse(base).t.map((r) => ({ id: r.id, notes: r.notes }))), "after the Rollback line every trigger note is back (a NULL note is NULL again)");
    ok(get(d, "SELECT verify_probe AS p FROM remediation_contracts WHERE class = 'issue-99926'").p === OLD_PROBE, "after the Rollback line the issue-99926 probe is still the original");
    ok(get(d, "SELECT COUNT(*) AS n FROM remediation_contracts WHERE class = 'fm-breach-anchor-stale'").n === 0 && get(d, "SELECT COUNT(*) AS n FROM failure_modes WHERE fm_key = 'breach-anchor-stale'").n === 0 && get(d, "SELECT COUNT(*) AS n FROM capability_ledger").n === 0 && get(d, "SELECT COUNT(*) AS n FROM failure_modes").n === 1, "after the Rollback line the failure mode, its detector and the ledger row are gone and the other failure mode stays");
    ok(get(d, "SELECT COUNT(*) AS n FROM decision_log").n === 1, "the decision_log row stays: the log is append-only");
    ok(pct(d) === "7.8", "after the Rollback line the live formula reads 7.8 again", pct(d));
    d.exec(sql);
    const again = actions(d);
    ok(TOUCHED.every((id) => again[id] === after[id]) && get(d, "SELECT COUNT(*) AS n FROM decision_log").n === 1, "the file applies again after a rollback and writes the same four actions without a second decision row");
  } else ok(false, "NEUTRALISE_MIGRATION=1: the migration was not applied, so the Rollback and the guards above could not hold");
}

// ---- LAYER 1: the anchor guard on this checkout (every migration from BREACH-CODE-ANCHORS-1 on, the last writer of a trigger wins)
{
  const led = buildLedger(realFiles, GUARD_FROM);
  const res = checkLedger(led, realEnv);
  res.problems.forEach((pr) => ok(false, "ANCHOR GUARD " + pr));
  ok(res.problems.length === 0 && res.checked >= 4, "every effective code-task / code-anchor pair written by a migration from " + GUARD_FROM + " on (" + res.checked + " triggers) names a watched worker and occurs exactly once in it", { checked: res.checked });
  TOUCHED.forEach((id) => {
    const e = Array.from(led.map.values()).find((x) => x.keys.indexOf("id:" + id) >= 0);
    ok(e && e.file >= GUARD_FROM, "trigger " + id + " is in the ledger, written by " + GUARD_FROM + " or by a later migration that repoints it", e && e.file);
  });
  if (res.legacy.length) console.log("NOTE " + res.legacy.length + " anchor(s) written by migrations before " + GUARD_FROM + " do not occur exactly once on this checkout (not judged from the repository; repoint by migration while the trigger is in breach): " + res.legacy.slice(0, 12).join("; "));
}

// ---- LAYER 1: a PR that changes a watched worker runs this suite (SUITE-DEPENDENTS-1), so the PR that moves an anchored line is the one that fails
{
  const suites = discover(rootPath);
  const readS = (f) => readFileSync(join(rootPath, f), "utf8");
  ok(suites.indexOf(SELF) >= 0, "scripts/run-suites.mjs discovers this suite", suites.length);
  WATCHED.forEach((w) => {
    const dir = w.split("/")[1];
    const sel = select(suites, [dir], readS);
    ok(sel.suites.indexOf(SELF) >= 0, "a PR that changes " + dir + " runs " + SELF + " (a suite that names ../" + dir + "/ is selected)", sel.reason);
  });
}

// ---- LAYER 1: the guard on fixtures (synthetic worker files, so no checkout state changes these verdicts)
{
  const base = realFiles.filter((f) => f.name <= GUARD_FROM);
  const baseLed = buildLedger(base, GUARD_FROM);
  const entryOf = (id) => Array.from(baseLed.map.values()).find((x) => x.keys.indexOf("id:" + id) >= 0);
  const good = {};
  baseLed.map.forEach((e) => { if (e.guarded) good[e.path] = (good[e.path] || "") + "function f() {\n" + e.anchor + "\n}\n"; });
  const envOf = (files) => {
    const get1 = (q) => { if (!(q in files)) throw new Error("no " + q); return files[q]; };
    return { read: get1, readAny: get1, watched: WATCHED, denyWorkers, exists: () => true };
  };
  const verdict = (extra, files) => checkLedger(buildLedger(sortFiles(base.concat(extra)), GUARD_FROM), envOf(files || good));
  const F = (name, body) => ({ name, sql: "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: SELECT 1\n" + body });
  const old9193 = entryOf(9193).anchor, Q = "q08-signal-engine/worker.js";
  const refactored = Object.assign({}, good, { [Q]: good[Q].replace(old9193, "if (/nemotron/.test(m)) return { chat_template_kwargs: { enable_thinking: false } };") });
  const repoint = (id, from, to) => "UPDATE analytics_metric_triggers SET action = replace(action, char(10) || 'code-anchor: " + from.replace(/'/g, "''") + "', char(10) || 'code-anchor: " + to.replace(/'/g, "''") + "') WHERE id = " + id + ";\n";
  const newLine = "if (/nemotron/.test(m)) return { chat_template_kwargs: { enable_thinking: false } };";

  const v1 = verdict([]);
  ok(v1.problems.length === 0 && v1.checked === 4, "fixture: the four pairs of this file on files that hold their anchors once pass", v1);
  ok(refactored[Q] !== good[Q], "fixture: the refactor changed the anchored q08 line");
  const v2 = verdict([], refactored);
  ok(v2.problems.length === 1 && /id:9193/.test(v2.problems[0]) && /occurs 0 times/.test(v2.problems[0]) && /WHERE id = 9193/.test(v2.problems[0]) && /ANCHOR-RETIRED: 9193/.test(v2.problems[0]), "fixture: a harmless refactor of the anchored line turns the guard red and the message says how to repair it", v2.problems);
  const rp = F("2026-10-21-repoint-9193.sql", repoint(9193, old9193, newLine));
  const v3 = verdict([rp], refactored);
  ok(v3.problems.length === 0 && v3.checked === 4, "fixture: a later migration that repoints the anchor supersedes the old pair, in the same PR that moves the line", v3);
  ok(buildLedger(sortFiles(base.concat([rp])), GUARD_FROM).map.size === baseLed.map.size, "fixture: a repoint replaces the pair of the same trigger, it adds none");
  const v4 = verdict([F("2026-10-21-repoint-9193.sql", repoint(9193, old9193, "if (/nope-not-there/.test(m)) return 1;"))], refactored);
  ok(v4.problems.length === 1 && /2026-10-21-repoint-9193\.sql/.test(v4.problems[0]) && /occurs 0 times/.test(v4.problems[0]), "fixture: a repoint to an anchor that is not there is judged in its turn", v4.problems);
  const v5 = verdict([F("2026-10-20-bad-anchor.sql", "UPDATE analytics_metric_triggers SET action = action || char(10) || 'code-task: repo=qnfo-workers path=idea-hub/worker.js' || char(10) || 'code-anchor: async function doesNotExistAnywhere(env) {' WHERE id = 2934;\n")]);
  ok(v5.problems.length === 1 && /id:2934/.test(v5.problems[0]) && /2026-10-20-bad-anchor\.sql/.test(v5.problems[0]) && /occurs 0 times/.test(v5.problems[0]), "fixture: a later migration that writes a pair whose anchor is nowhere is caught (the recurrence of the failure mode)", v5.problems);
  const dup = Object.assign({}, good, { "idea-hub/worker.js": good["idea-hub/worker.js"] + good["idea-hub/worker.js"] });
  const v6 = verdict([], dup);
  ok(v6.problems.length === 1 && /occurs 2 times/.test(v6.problems[0]), "fixture: an anchor that occurs twice fails as well", v6.problems);
  const ret = F("2026-10-21-retire-9193.sql", "-- ANCHOR-RETIRED: 9193 the lever shipped in PR 0, the line is spent\nSELECT 1;\n");
  const v7 = verdict([ret], refactored);
  ok(v7.problems.length === 0 && v7.checked === 3, "fixture: a retirement comment clears a spent anchor", v7);
  const v8 = verdict([ret, F("2026-10-22-again.sql", "UPDATE analytics_metric_triggers SET action = action || char(10) || 'code-task: repo=qnfo-workers path=" + Q + "' || char(10) || 'code-anchor: nowhere at all' WHERE id = 9193;\n")], refactored);
  ok(v8.problems.length === 1 && /2026-10-22-again\.sql/.test(v8.problems[0]), "fixture: a pair written after a retirement is judged again", v8.problems);
  const ins = (key, anchor, path) => "INSERT INTO analytics_metric_triggers (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)\nSELECT '" + key + "', 'T', 'registry', 'gt', 0.25, 3,\n  'Pillar research (X, agent_issues 1). lever.' || char(10) || 'code-task: repo=qnfo-workers path=" + path + "' || char(10) || 'code-anchor: " + anchor.replace(/'/g, "''") + "',\n  'idea-hub', 'agent_issues', 24, 1, 'n'\nWHERE NOT EXISTS (SELECT 1 FROM analytics_metric_triggers x WHERE x.metric_key = '" + key + "');\n";
  const v9 = verdict([F("2026-10-22-ins.sql", ins("m_bad", "async function nope(env) {", "idea-hub/worker.js"))]);
  ok(v9.problems.length === 1 && /metric:m_bad/.test(v9.problems[0]), "fixture: an INSERT ... SELECT that carries a stale pair is read and caught", v9.problems);
  const goodHub = Object.assign({}, good, { "idea-hub/worker.js": good["idea-hub/worker.js"] + "async function fine(env) {\n}\n" });
  const v10 = verdict([F("2026-10-22-ins.sql", ins("m_ok", "async function fine(env) {", "idea-hub/worker.js"))], goodHub);
  ok(v10.problems.length === 0 && v10.checked === 5, "fixture: an INSERT ... SELECT with a pair that occurs once is checked and passes", v10);
  const vals = F("2026-10-22-vals.sql", "INSERT INTO analytics_metric_triggers (metric_key, title, action, owner) VALUES ('m_a', 'A', 'x' || char(10) || 'code-task: repo=qnfo-workers path=idea-hub/worker.js' || char(10) || 'code-anchor: async function fine(env) {', 'o'), ('m_b', 'B', 'y' || char(10) || 'code-task: repo=qnfo-workers path=idea-hub/worker.js' || char(10) || 'code-anchor: async function gone(env) {', 'o');\n");
  const v11 = verdict([vals], goodHub);
  ok(v11.checked === 6 && v11.problems.length === 1 && /metric:m_b/.test(v11.problems[0]), "fixture: a VALUES insert with two rows is read row by row", v11);
  const v12 = verdict([F("2026-10-01-old.sql", "UPDATE analytics_metric_triggers SET action = action || char(10) || 'code-task: repo=qnfo-workers path=idea-hub/worker.js' || char(10) || 'code-anchor: gone since long' WHERE id = 7777;\n")]);
  ok(v12.problems.length === 0 && v12.legacy.some((l) => /id:7777/.test(l)), "fixture: a pair written before " + GUARD_FROM + " is reported as a legacy NOTE and not judged", v12);
  const v13 = verdict([F("2026-10-22-social.sql", "UPDATE analytics_metric_triggers SET action = action || char(10) || 'code-task: repo=qnfo-workers path=qnfo-social/worker.js' || char(10) || 'code-anchor: function x() {' WHERE id = 7001;\n")], Object.assign({}, good, { "qnfo-social/worker.js": "function x() {\n}\n" }));
  ok(v13.problems.length === 1 && /not in WATCHED/.test(v13.problems[0]) && /\.\.\/qnfo-social\/worker\.js/.test(v13.problems[0]), "fixture: a pair that names a worker outside WATCHED fails until the worker is listed (so a PR that changes it runs this suite)", v13.problems);
  const v14 = verdict([F("2026-10-22-unkeyed.sql", "UPDATE analytics_metric_triggers SET action = action || char(10) || 'code-task: repo=qnfo-workers path=idea-hub/worker.js' || char(10) || 'code-anchor: async function fine(env) {' WHERE metric_key LIKE 'x%';\n")], goodHub);
  ok(v14.problems.length === 1 && /without a key the guard can follow/.test(v14.problems[0]), "fixture: a pair written under a WHERE the guard cannot key is a finding, never silently unguarded", v14.problems);
  const v15 = verdict([F("2026-10-22-in.sql", "UPDATE analytics_metric_triggers SET action = action || char(10) || 'code-task: repo=qnfo-workers path=idea-hub/worker.js' || char(10) || 'code-anchor: async function fine(env) {' WHERE id IN (7101, 7102);\n")], goodHub);
  ok(v15.checked === 6 && v15.problems.length === 0, "fixture: WHERE id IN (...) writes one pair per trigger", v15);
  const quote = F("2026-10-22-quote.sql", "-- the trigger's anchor, with an apostrophe in a comment\nUPDATE analytics_metric_triggers SET action = action || char(10) || 'code-task: repo=qnfo-workers path=idea-hub/worker.js' || char(10) || 'code-anchor: var s = ''x'';' WHERE id = 7201;\n");
  const v16 = verdict([quote], Object.assign({}, good, { "idea-hub/worker.js": good["idea-hub/worker.js"] + "var s = 'x';\n" }));
  ok(v16.checked === 5 && v16.problems.length === 0, "fixture: an apostrophe in a comment and a doubled quote in a literal are read as the file text the DB will hold", v16);
  const al = [
    F("2026-10-22-a.sql", "UPDATE analytics_metric_triggers SET action = action || char(10) || 'code-task: repo=qnfo-workers path=idea-hub/worker.js' || char(10) || 'code-anchor: async function one(env) {' WHERE metric_key = 'k8001';\n"),
    F("2026-10-23-b.sql", "UPDATE analytics_metric_triggers SET action = replace(action, char(10) || 'code-anchor: async function one(env) {', char(10) || 'code-anchor: async function two(env) {') WHERE id = 8001 AND metric_key = 'k8001' AND instr(action, 'x') > 0;\n"),
    F("2026-10-24-c.sql", repoint(8001, "async function two(env) {", "async function three(env) {")),
  ];
  const ledAl = buildLedger(sortFiles(base.concat(al)), GUARD_FROM);
  const eAl = Array.from(ledAl.map.values()).filter((x) => x.keys.indexOf("id:8001") >= 0 || x.keys.indexOf("metric:k8001") >= 0);
  ok(eAl.length === 1 && eAl[0].anchor === "async function three(env) {" && eAl[0].path === "idea-hub/worker.js" && eAl[0].file === "2026-10-24-c.sql", "fixture: an id and a metric_key named together are one trigger; the last repoint by either key wins and the path is inherited", eAl);
  const v17 = verdict(al, Object.assign({}, good, { "idea-hub/worker.js": good["idea-hub/worker.js"] + "async function three(env) {\n}\n" }));
  ok(v17.problems.length === 0, "fixture: the aliased trigger is judged once, on its last pair", v17);
  const v18 = verdict([F("2026-10-22-script.sql", "UPDATE analytics_metric_triggers SET action = action || char(10) || 'code-task: repo=qnfo-workers path=scripts/bridge.py' || char(10) || 'code-anchor: FILE_H = QUIET_H' WHERE id = 7301;\n")], Object.assign({}, good, { "scripts/bridge.py": "FILE_H = QUIET_H - 0.5\n" }));
  ok(v18.checked === 5 && v18.problems.length === 0, "fixture: a pair in a file under scripts/ needs no WATCHED entry (a scripts change already runs every suite) and is judged like any other", v18);
  const v19 = verdict([F("2026-10-22-escape.sql", "UPDATE analytics_metric_triggers SET action = action || char(10) || 'code-task: repo=qnfo-workers path=../etc/passwd' || char(10) || 'code-anchor: root' WHERE id = 7302;\n")]);
  ok(v19.problems.length === 1 && /not a repository-relative file path/.test(v19.problems[0]), "fixture: a path that leaves the repository is refused", v19.problems);
  if (denyWorkers.length) {
    const denied = denyWorkers[0] + "/worker.js";
    const led20 = buildLedger(sortFiles(base.concat([F("2026-10-22-control.sql", "UPDATE analytics_metric_triggers SET action = action || char(10) || 'code-task: repo=qnfo-workers path=" + denied + "' || char(10) || 'code-anchor: fine' WHERE id = 7303;\n")])), GUARD_FROM);
    const env20 = Object.assign(envOf(Object.assign({}, good, { [denied]: "fine\n" })), { watched: WATCHED.concat(["../" + denied]) });
    const v20 = checkLedger(led20, env20);
    ok(v20.problems.length === 1 && /control-plane worker the code loop refuses/.test(v20.problems[0]), "fixture: a pair in a worker the code loop refuses (PLAN_DENY_WORKERS, read from the orchestrator) is a finding even when it is watched", v20.problems);
  }
  const noPath = verdict([F("2026-10-22-nopath.sql", repoint(9999, "a", "b"))]);
  ok(noPath.problems.length === 1 && /no code-task line with a path/.test(noPath.problems[0]), "fixture: a repoint of a trigger the ledger has never seen cannot name its file and fails", noPath.problems);
}

// ---- the follow-up migration: one agent_issues row per lever, for the code loop (the open METRIC-TRIGGER issues cannot carry the lever)
// The code-probe markers are text each edit must introduce. They were absent from their files on main when the rows were written (read
// 2026-10-19), so the probes cannot pass while the defect exists; they are not asserted absent here, because they must be present once the
// lever lands and this suite then has to stay green.
const FOLLOW_MARKER = { 9193: 'm.indexOf("qwen") >= 0', 5394: "owner-corpus", 5916: "/deepseek/.test(m)" };
{
  const fsql = rd(FOLLOW);
  const flines = fsql.split("\n");
  const fbody = flines.filter((l) => !/^\s*--/.test(l)).join("\n");
  ok(flines.indexOf("-- APPLY-BY: ci") >= 0 && flines.indexOf("-- DB: qnfo-audit") >= 0 && flines.some((l) => /^-- Rollback: \S/.test(l)), "the follow-up opts in to the migration runner and carries a one-line Rollback");
  ok(!/^\s*(DELETE\s+FROM|DROP\s+)/im.test(fbody), "the follow-up body runs no DELETE or DROP, so it needs no BACKUP header");
  ok(!/claude\.ai|anthropic\.com/i.test(fsql), "the follow-up carries no claude.ai or anthropic.com link (CLOUDFLARE-ONLY-HOST-1)");
  ok(!/INSERT\s+(OR\s+\w+\s+)?INTO\s+agent_issues[^;]*\)\s*SELECT\b/i.test(fbody), "the follow-up uses single-row VALUES inserts (agent_issues refuses the INSERT ... SELECT shape at compile time)");
  const py = spawnSync("python3", ["-I", "scripts/apply_migrations.py", "--check", FOLLOW], { cwd: rootPath, encoding: "utf8" });
  if (!py.error) ok(py.status === 0, "scripts/apply_migrations.py --check passes the follow-up", (py.stdout || "") + (py.stderr || ""));
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT DEFAULT 'optimization', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER)");
  d.exec(fsql);
  const rows = d.prepare("SELECT * FROM agent_issues ORDER BY id").all();
  ok(rows.length === 3 && rows.every((r) => r.status === "open" && /^BREACH-LEVER-\d+: /.test(r.title) && r.created_at > 1.7e12 && r.updated_at > 1.7e12), "the follow-up files three open issues with millisecond timestamps", rows.map((r) => r.title));
  const own = buildLedger(realFiles.filter((f) => f.name <= GUARD_FROM), GUARD_FROM).map;
  [9193, 5394, 5916].forEach((id) => {
    const r = rows.find((x) => x.title.startsWith("BREACH-LEVER-" + id + ":"));
    ok(!!r, "the follow-up files BREACH-LEVER-" + id);
    if (!r) return;
    const e = Array.from(own.values()).find((x) => x.file === GUARD_FROM && x.keys.indexOf("id:" + id) >= 0);
    const m = intakeMark.exec(r.description);
    const mk = markers(r.description);
    ok(m && e && m[1] === "qnfo-workers" && m[2] === e.path && mk.task.length === 1 && mk.anchor.length === 1 && mk.anchor[0] === e.anchor, "BREACH-LEVER-" + id + ": its code-task and code-anchor lines are the ones trigger " + id + " carries, each on a line of its own, and the intake pattern reads them", { m: m && m[0], anchor: mk.anchor });
    ok(("," + intakeTrusted + ",").indexOf(",claude-session*,") >= 0 && /^claude-session/.test(r.source), "BREACH-LEVER-" + id + ": the source is one the code loop trusts (INTAKE_TRUSTED_DEFAULT)", r.source);
    ok(/^Charter pillar: [a-z]+/.test(r.description) && r.description.length <= goalMax && !denyText.test(r.description), "BREACH-LEVER-" + id + ": it names its charter pillar, fits the goal bound of the intake and trips no text the planner refuses (PLAN_DENY_TEXT)", r.description.length);
    const probeLine = r.description.split("\n").filter((l) => /^code-probe: /.test(l));
    let probe = null;
    try { probe = JSON.parse(probeLine[0].slice("code-probe: ".length)); } catch (x) { probe = null; }
    const marker = probe && (probe.contains || probe.absent);
    ok(marker === FOLLOW_MARKER[id] && !!probe.contains, "BREACH-LEVER-" + id + ": the code-probe closes on the marker " + FOLLOW_MARKER[id] + " being present (contains, never an absent that already passes)", marker);
    ok(probeLine.length === 1 && probe && probe.paths && probe.paths.length === 1 && probe.paths[0] === e.path && typeof marker === "string" && !(probe.contains && probe.absent), "BREACH-LEVER-" + id + ": one code-probe on the file the code-task names, with one marker", probeLine);
    ok(marker && r.description.split("\nEdit: ")[1] && r.description.split("\nEdit: ")[1].split("\n")[0].replace(/''/g, "'").includes(marker.replace(/\\"/g, '"')), "BREACH-LEVER-" + id + ": the probe marker is text the Edit line tells the doer to write (a marker that is absent from the file today, read on main when the row was written: it closes the row only when the edit lands)", marker);
    ok(r.description.includes("never rewrites an open issue"), "BREACH-LEVER-" + id + ": it says why the open METRIC-TRIGGER issue could not carry the lever");
  });
  d.exec(/^-- Rollback: (.+)$/m.exec(fsql)[1]);
  ok(d.prepare("SELECT COUNT(*) AS n FROM agent_issues").get().n === 0, "the Rollback line of the follow-up removes exactly its three rows");
  ok(sql.includes("breach-lever-issues.sql") && /\n-- [^\n]*never writes agent_issues/.test(sql), "the anchor migration names the follow-up and says it never writes agent_issues itself");
}

console.log(`code-anchor-once: ${pass} pass, ${fail} fail${NEUTRAL ? " (migration neutralised)" : ""}`);
if (fail) process.exit(1);
