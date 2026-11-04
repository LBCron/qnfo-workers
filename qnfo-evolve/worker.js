/* qnfo-evolve — EVOLVE-1
 *
 * WHY THIS EXISTS
 *   On 2026-10-17 the fleet's own registers said, in its own words, what was wrong and nobody was
 *   doing anything about it. v_process_path_gaps listed three steps whose only path read
 *   "none automatic" (research-head-stalled, code-task-stalled, issue-unremediated); v_dod_spof_gaps
 *   listed qnfo-research-exec as NO-ALTERNATE-PATH and GitHub Actions plus the GitHub token as
 *   ALTERNATE-NEVER-TESTED. The owner doctrine (SLA-AND-PATHS-1, 2026-10-17) says every step needs
 *   an SLA and at least two independent paths, and it is VIOLATED BY THE FLEET'S OWN TABLES with no
 *   consequence, because nothing in the fleet reads those tables and turns them into work.
 *
 *   Measured the same day: 169 issues open, 25 carrying a code-task line; issue_plans held 6 queued
 *   against 128 "not-code", and 67 of those refusals were the same sentence -- "the issue names no
 *   worker the code loop may change". So the loop was not idle because the fleet had nothing to fix.
 *   It was idle because the fleet never said WHICH WORKER should fix it.
 *
 * WHAT IT DOES
 *   Every quarter hour it reads the fleet's structural gap registers, keeps only the gaps whose
 *   owning worker it can name, and files ONE issue per gap in the shape the code loop accepts:
 *   the live worker named, the file named, the reproduction SQL, and a machine-evaluable definition
 *   of done. It then re-runs each probe and closes the issue itself when the gap disappears.
 *   That closes the missing arc: registered gap -> named work -> merged change -> verified closure.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   * It never edits code, never opens a pull request, never deploys, never changes a view. It writes
 *     only agent_issues rows (its own source) and its own three tables. A bug here can file a bad
 *     issue; it cannot damage a worker.
 *   * It never re-words a gap into something easier. If the owning worker cannot be named it records
 *     the skip and moves on, rather than filing the unplannable prose that starved the loop.
 *   * It files at most MAX_NEW_PER_TICK per tick and holds at most MAX_OPEN open filings, so a wide
 *     register cannot flood a loop that plans a handful of tasks a day.
 *
 * READING
 *   GET /health  version, last run, open filings (public read)
 *   GET /report  the last 20 filings and the last run (public read)
 *   POST /tick   same work as the cron; needs x-loop-token when LOOP_TOKEN is configured
 */
// 0.2.7 CAPABILITY-CONTRACT-REFRESH-1 (#2852, pillar autonomy; patch: re-publish the declared /health lists for a fresh live capability audit).
var VERSION = "0.2.9-revert-49ce59b"; // 0.2.6 WIP-RECOVERY-PLANNER-ALIGNMENT-1: recoverWip counts the planner's active-task set and reads its shared code_plan_wip ceiling; the run ledger records queued work and oldest age.
var WORKER = "qnfo-evolve";
var SOURCE = "qnfo-evolve|EVOLVE-1";
var MAX_OPEN = 5;
var MAX_NEW_PER_TICK = 2;

/* WIP-RECOVERY-1. qnfo-code-orchestrator refuses to plan while PLAN_WIP unfinished code
 * tasks exist. Measured 2026-10-17: 7 tasks queued, the planner had not planned since 15:21Z, and the
 * queue could only drain by a task SUCCEEDING -- which the builder was failing to do at roughly 3:2.
 * That is a closed loop with one exit, and the owner doctrine (SLA-AND-PATHS-1: every step needs two
 * independent paths to a successful definition of done) says a step with one exit is a defect.
 *
 * So this is the second path: a task that has burned WIP_ATTEMPTS attempts and has not moved for
 * WIP_STALE_MIN minutes is parked as 'failed' with its full row backed up to ops_config, which frees
 * a planning slot. It is deliberately timid -- it never touches a task with fewer than 6 attempts, it
 * never touches one that moved in the last 10 minutes (it may be mid-attempt), it acts at most twice a
 * tick, and it only acts while active WIP reaches the shared planner ceiling. Restore is one statement:
 *   UPDATE code_tasks SET status='queued' WHERE id=(the id in the backup key).
 * The parked issue is not lost: the planner takes an issue again inside its 3-day window. */
var WIP_CEILING_DEFAULT = 12;
var WIP_CEILING_MAX = 48;
var WIP_TERMINAL_STATUSES = [
  "merged", "closed", "publish_failed", "needs_human", "failed", "reverted", "superseded"
];
var WIP_HANDOFF_STATUSES = ["branch_pushed", "published", "pr_open"];
var WIP_EXCLUDED_STATUSES = WIP_TERMINAL_STATUSES.concat(WIP_HANDOFF_STATUSES);
var WIP_ATTEMPTS = 6;
var WIP_STALE_MIN = 10;
var WIP_PARK_PER_TICK = 2;

/* Mirrors PLAN_DENY_WORKERS in qnfo-code-orchestrator 0.17.2 (PLAN_CONTROL_PLANE minus
 * PLAN_LOOP_CANARIED). Filing against one of these is self-defeating: the planner refuses the issue
 * with "the issue names no worker the code loop may change", which is the exact refusal class EVOLVE-1
 * exists to remove. Measured on the first tick (2026-10-17T17:02Z): the code-task-stalled gap resolved
 * to qnfo-code-orchestrator and would have been refused on the next plan pass. Such a gap is counted and
 * reported instead -- the ceiling is real and it should be visible, not silently filed and dropped.
 * Keep this list in step with the orchestrator; the offline suite pins the two known canaried workers. */
var DENY_WORKERS = [
  "qnfo-fleet-control", "qnfo-ops", "qnfo-deploy-guard", "qnfo-containers-pilot",
  "qnfo-autonomy-scorer", "qnfo-observability", "qnfo-code-orchestrator", "qnfo-code-agent"
];

function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
function iso() { return new Date().toISOString(); }
function errText(e) { return String((e && e.message) || e).slice(0, 300); }
function q(s) { return String(s == null ? "" : s).replace(/'/g, "''"); }

/* FNV-1a over the identity of the gap. Deterministic across ticks and isolates, so a gap keeps the
 * same key until it is fixed -- that is what makes dedupe work without a random id. */
function hashKey(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}
function gapKey(kind, a, b) { return kind + ":" + hashKey(kind + "\u0000" + a + "\u0000" + b); }

/* A step is single-path when the register says so, or when its path list literally contains a
 * "none ..." entry -- the fleet writes "none automatic" where a second path should be (measured:
 * research-head-stalled, code-task-stalled, issue-unremediated). */
function isSinglePath(pathsJson) {
  var t = String(pathsJson == null ? "" : pathsJson).toLowerCase();
  if (!t) return true;
  if (t.indexOf('"none') >= 0) return true;
  try {
    var arr = JSON.parse(pathsJson);
    return !Array.isArray(arr) || arr.length < 2;
  } catch (e) {
    return true;
  }
}

/* The issue the code loop can actually farm. Every refusal class measured on 2026-10-17 is answered
 * here: a live worker is named, the file is named, and the definition of done is a query, not prose. */
function buildIssue(kind, row, worker, file) {
  var stepLabel = String(row.step || row.component || "");
  if (stepLabel.length > 80) stepLabel = stepLabel.slice(0, 77) + "...";
  var subject = kind === "single-path"
    ? row.process + " / " + stepLabel + " has fewer than two live paths"
    : stepLabel + " has no tested alternate path";
  var probe = row.probe;
  var lines = [
    "EVOLVE-1 structural gap filed from the fleet's own registers, not from a metric breach.",
    "",
    "gap: " + kind,
    "process: " + (row.process || "-"),
    "step: " + (row.step || row.component || "-"),
    "sla_min: " + (row.sla_min == null ? "-" : row.sla_min),
    "",
    "worker: " + worker,
    "file: " + file,
    "",
    "evidence: " + JSON.stringify(row.evidence == null ? null : row.evidence).slice(0, 400),
    "reproduce: " + probe,
    "",
    "definition of done: the reproduce query returns 0 rows, and the new path is exercised once "
      + "(a probe row or a run log line), not merely declared.",
    "",
    "constraint: do not raise the SLA, widen a view, or rename the step to hide it. Add a second "
      + "path that actually runs.",
    "doctrine: SLA-AND-PATHS-1 (owner, 2026-10-17) -- every step has an SLA and at least two "
      + "independent paths to a successful definition of done."
  ];
  return {
    key: gapKey(kind, row.process || "", row.step || row.component || ""),
    kind: kind,
    process: row.process || "",
    step: row.step || row.component || "",
    title: "EVOLVE-1: " + subject,
    description: lines.join("\n"),
    worker: worker,
    file: file,
    probe: probe,
    priority: kind === "single-path" ? "high" : "medium"
  };
}

function isDenied(worker) { return DENY_WORKERS.indexOf(worker) >= 0; }

/* Deterministic selection: dedupe against open filings, keep the register's own order, and never
 * exceed the budget. Pure, so the offline suite can pin it. */
function pickNew(candidates, openKeys, room, perTick) {
  var have = {};
  for (var i = 0; i < (openKeys || []).length; i++) have[openKeys[i]] = true;
  var out = [];
  var cap = Math.min(room, perTick);
  if (cap <= 0) return out;
  for (var j = 0; j < (candidates || []).length && out.length < cap; j++) {
    var c = candidates[j];
    if (!c || !c.key || have[c.key]) continue;
    have[c.key] = true;
    out.push(c);
  }
  return out;
}

async function loadTargets(env) {
  var map = {};
  var r = await env.AUDIT.prepare(
    "SELECT kind, key, worker, file FROM evolve_targets"
  ).all();
  var rows = (r && r.results) || [];
  for (var i = 0; i < rows.length; i++) {
    map[rows[i].kind + "|" + rows[i].key] = { worker: rows[i].worker, file: rows[i].file };
  }
  return map;
}

async function pathGapCandidates(env, targets) {
  var out = [];
  var r = await env.AUDIT.prepare(
    "SELECT process, step, sla_min, paths, no_sla, single_path FROM v_process_path_gaps"
  ).all();
  var rows = (r && r.results) || [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var single = Number(row.single_path || 0) === 1 || isSinglePath(row.paths);
    if (!single) continue;
    var t = targets["process|" + row.process];
    if (!t || !t.worker) continue;
    out.push(buildIssue("single-path", {
      process: row.process,
      step: row.step,
      sla_min: row.sla_min,
      evidence: { paths: row.paths, no_sla: row.no_sla, single_path: row.single_path },
      probe: "SELECT COUNT(*) AS n FROM v_process_path_gaps WHERE process = '" + q(row.process)
        + "' AND step = '" + q(row.step) + "' AND (single_path = 1 OR paths LIKE '%\"none%')"
    }, t.worker, t.file));
  }
  return out;
}

async function spofCandidates(env, targets) {
  var out = [];
  var r = await env.AUDIT.prepare(
    "SELECT component, verdict, critical_path FROM v_dod_spof_gaps "
    + "WHERE verdict IN ('NO-ALTERNATE-PATH','ALTERNATE-NEVER-TESTED')"
  ).all();
  var rows = (r && r.results) || [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var t = targets["component|" + row.component];
    if (!t || !t.worker) continue;
    out.push(buildIssue("no-alternate", {
      component: row.component,
      evidence: { verdict: row.verdict, critical_path: row.critical_path },
      probe: "SELECT COUNT(*) AS n FROM v_dod_spof_gaps WHERE component = '" + q(row.component)
        + "' AND verdict = '" + q(row.verdict) + "'"
    }, t.worker, t.file));
  }
  return out;
}

async function openFilings(env) {
  var r = await env.AUDIT.prepare(
    "SELECT key, process, step, worker, file, issue_id, probe_sql, filed_at "
    + "FROM evolve_filings WHERE state = 'open' ORDER BY filed_at"
  ).all();
  return (r && r.results) || [];
}

async function fileIssue(env, d) {
  var now = Date.now();
  var ins = await env.AUDIT.prepare(
    "INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) "
    + "VALUES (?, ?, ?, 'optimization', ?, 'open', ?, ?)"
  ).bind(d.title, d.description, SOURCE, d.priority, now, now).run();
  var issueId = (ins && ins.meta && ins.meta.last_row_id) || null;
  await env.AUDIT.prepare(
    "INSERT OR REPLACE INTO evolve_filings (key, kind, process, step, worker, file, issue_id, probe_sql, state, filed_at) "
    + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)"
  ).bind(d.key, d.kind, d.process || "", d.step || "", d.worker, d.file, issueId, d.probe, iso()).run();
  return issueId;
}

/* The closure half. A filing stops being work the moment its probe returns nothing, and this worker
 * closes it with evidence instead of waiting for a session to notice.
 *
 * ORDER MATTERS: agent_issues carries a BEFORE UPDATE trigger `issue_close_evidence_required` that
 * ABORTS with 'close-without-evidence' unless issue_triage.close_evidence is already populated for
 * the issue. Writing the status first fails the whole tick, silently, with the gap still open --
 * measured 2026-10-17 when a manual retraction was refused. So the evidence row is written first. */
async function closeResolved(env, filings) {
  var closed = 0;
  for (var i = 0; i < filings.length; i++) {
    var f = filings[i];
    var n = null;
    try {
      var r = await env.AUDIT.prepare(f.probe_sql).all();
      var rows = (r && r.results) || [];
      n = rows.length ? Number(rows[0].n) : 0;
    } catch (e) {
      continue;
    }
    if (n !== 0) continue;
    var evidence = "EVOLVE-1 " + iso() + ": probe returned 0 rows for " + (f.process || f.key)
      + "; the register no longer reports this gap.";
    try {
      await env.AUDIT.prepare(
        "INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, close_evidence) "
        + "VALUES (?, 'EVOLVE-1', 'triaged', ?, datetime('now'), ?) "
        + "ON CONFLICT(issue_id) DO UPDATE SET close_evidence = excluded.close_evidence"
      ).bind(f.issue_id, f.worker, evidence).run();
    } catch (e) {
      await env.AUDIT.prepare(
        "UPDATE issue_triage SET close_evidence = ? WHERE issue_id = ?"
      ).bind(evidence, f.issue_id).run();
    }
    await env.AUDIT.prepare(
      "UPDATE agent_issues SET status = 'closed', close_channel = 'evolve-auto', updated_at = ? "
      + "WHERE id = ? AND status = 'open'"
    ).bind(Date.now(), f.issue_id).run();
    await env.AUDIT.prepare(
      "UPDATE evolve_filings SET state = 'closed', closed_at = ?, evidence = ? WHERE key = ?"
    ).bind(iso(), evidence, f.key).run();
    closed++;
  }
  return closed;
}

/* The drain path described at WIP-RECOVERY-1. Returns the ids it parked. */
async function recoverWip(env, out) {
  var parked = [];
  /* Match the planner's shared setting and count the same unfinished statuses; queued tasks are only
   * eligible for parking, not the whole planner WIP set. */
  var ceiling = WIP_CEILING_DEFAULT;
  try {
    var c = await env.AUDIT.prepare(
      "SELECT value FROM ops_config WHERE key = 'code_plan_wip'"
    ).all();
    var cv = ((c && c.results) || [])[0];
    if (cv) {
      var configured = Number(cv.value);
      if (Number.isFinite(configured) && configured > 0) {
        ceiling = Math.max(1, Math.floor(Math.min(WIP_CEILING_MAX, configured)));
      }
      else console.error(JSON.stringify({ evt: "evolve-wip-config-invalid", key: "code_plan_wip", value: cv.value }));
    }
  } catch (e) {
    console.error(JSON.stringify({ evt: "evolve-wip-config-read-failed", error: errText(e) }));
    out.skipped.push("wip-config: " + errText(e));
    return parked;
  }
  out.wip_ceiling = ceiling;

  var placeholders = WIP_EXCLUDED_STATUSES.map(function () { return "?"; }).join(", ");
  var activeQuery = env.AUDIT.prepare(
    "SELECT COUNT(*) AS n, "
    + "SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued, "
    + "MIN(updated_at) AS oldest_updated_at "
    + "FROM code_tasks WHERE status NOT IN (" + placeholders + ")"
  );
  var w = await activeQuery.bind(...WIP_EXCLUDED_STATUSES).all();
  var counts = ((w && w.results) || [{}])[0];
  var wip = Number(counts.n) || 0;
  out.wip = wip;
  out.wip_queued = Number(counts.queued) || 0;
  var oldestAt = counts.oldest_updated_at ? Date.parse(counts.oldest_updated_at) : NaN;
  var runAt = Date.parse(out.ts);
  out.wip_oldest_age_min = Number.isFinite(oldestAt) && Number.isFinite(runAt)
    ? Math.max(0, Math.floor((runAt - oldestAt) / 60000)) : 0;
  if (wip < ceiling) return parked;

  var r = await env.AUDIT.prepare(
    "SELECT * FROM code_tasks WHERE status = 'queued' AND attempts >= ? "
    + "AND (julianday('now') - julianday(updated_at)) * 1440 >= ? "
    + "ORDER BY attempts DESC, updated_at ASC LIMIT ?"
  ).bind(WIP_ATTEMPTS, WIP_STALE_MIN, WIP_PARK_PER_TICK).all();
  var rows = (r && r.results) || [];
  for (var i = 0; i < rows.length; i++) {
    var t = rows[i];
    var bakKey = "code_tasks--bak-" + t.id + "-" + out.ts.slice(0, 19).replace(/[-:T]/g, "");
    await env.AUDIT.prepare(
      "INSERT OR REPLACE INTO ops_config (key, value, note, updated_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind(bakKey, JSON.stringify(t).slice(0, 900000),
      "EVOLVE-1 WIP-RECOVERY-1 backup before parking " + t.id + "; restore: UPDATE code_tasks SET status='queued', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='" + t.id + "'").run();
    var update = await env.AUDIT.prepare(
      "UPDATE code_tasks SET status = 'failed', updated_at = ?, "
      + "last_error = COALESCE(last_error, '') || ? WHERE id = ? AND status = 'queued'"
    ).bind(out.ts, " | EVOLVE-1 WIP-RECOVERY-1: " + t.attempts + " attempts and no movement while WIP was "
      + wip + " >= " + ceiling + "; parked to free a planning slot (backup: ops_config " + bakKey + ")", t.id).run();
    if (update && update.meta && update.meta.changes > 0) parked.push(t.id + ":" + t.attempts);
  }
  return parked;
}

async function ledger(env, out) {
  try {
    await env.AUDIT.prepare(
      "INSERT INTO evolve_runs (ts, scanned, filed, closed, skipped, detail) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(out.ts, out.scanned, out.filed, out.closed,
      JSON.stringify(out.skipped).slice(0, 2000),
      JSON.stringify({
        filed: out.filed_keys, blocked_control_plane: out.blocked, wip: out.wip,
        wip_ceiling: out.wip_ceiling, wip_queued: out.wip_queued,
        wip_oldest_age_min: out.wip_oldest_age_min, parked_wip: out.parked
      }).slice(0, 2000)).run();
  } catch (e) { /* the ledger must never fail the tick */ }
}

async function runTick(env) {
  var out = {
    ts: iso(), scanned: 0, filed: 0, closed: 0, skipped: [], filed_keys: [], blocked: [],
    wip: 0, wip_ceiling: 0, wip_queued: 0, wip_oldest_age_min: 0, parked: []
  };
  if (!env.AUDIT) { out.skipped.push("no AUDIT binding"); return out; }

  var targets = {};
  try { targets = await loadTargets(env); } catch (e) { out.skipped.push("targets: " + errText(e)); }

  var cands = [];
  try { cands = cands.concat(await pathGapCandidates(env, targets)); }
  catch (e) { out.skipped.push("path_gaps: " + errText(e)); }
  try { cands = cands.concat(await spofCandidates(env, targets)); }
  catch (e) { out.skipped.push("spof: " + errText(e)); }
  out.scanned = cands.length;

  /* Split before planning: a gap whose owner the loop may not change is reported, never filed. */
  var usable = [];
  for (var c = 0; c < cands.length; c++) {
    if (isDenied(cands[c].worker)) out.blocked.push(cands[c].worker + ":" + (cands[c].process || cands[c].step || ""));
    else usable.push(cands[c]);
  }

  var filings = [];
  try { filings = await openFilings(env); } catch (e) { out.skipped.push("filings: " + errText(e)); }

  var keys = [];
  for (var i = 0; i < filings.length; i++) keys.push(filings[i].key);
  var plan = pickNew(usable, keys, MAX_OPEN - filings.length, MAX_NEW_PER_TICK);
  for (var j = 0; j < plan.length; j++) {
    try {
      var id = await fileIssue(env, plan[j]);
      out.filed++;
      out.filed_keys.push(plan[j].key + "->" + id);
    } catch (e) {
      out.skipped.push("file " + plan[j].key + ": " + errText(e));
    }
  }

  try { out.closed = await closeResolved(env, filings); }
  catch (e) { out.skipped.push("close: " + errText(e)); }

  /* The drain path runs last: intake first, so a tick never parks work it could have replaced. */
  try { out.parked = await recoverWip(env, out); }
  catch (e) { out.skipped.push("wip-recovery: " + errText(e)); }

  await ledger(env, out);
  return out;
}

async function report(env) {
  var filings = await env.AUDIT.prepare(
    "SELECT key, kind, process, step, worker, file, issue_id, state, filed_at, closed_at "
    + "FROM evolve_filings ORDER BY filed_at DESC LIMIT 20"
  ).all();
  var runs = await env.AUDIT.prepare(
    "SELECT ts, scanned, filed, closed, detail FROM evolve_runs ORDER BY id DESC LIMIT 10"
  ).all();
  return { worker: WORKER, version: VERSION, filings: (filings && filings.results) || [], runs: (runs && runs.results) || [] };
}

/* Constant-time comparison: a loop-token check that short-circuits on the first differing byte
 * leaks the prefix of the secret through response timing. The guard is right to refuse `===`. */
function sameSecret(a, b) {
  var x = String(a == null ? "" : a);
  var y = String(b == null ? "" : b);
  var n = x.length > y.length ? x.length : y.length;
  var d = x.length ^ y.length;
  for (var i = 0; i < n; i++) {
    d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return d === 0 && x.length > 0;
}

function tickAllowed(env, req) {
  if (!env.LOOP_TOKEN) return true;
  return sameSecret(req.headers.get("x-loop-token"), env.LOOP_TOKEN);
}

/* HEALTH-CONTRACT-1 (agent_issues 2852): the capability contract on /health. qnfo-deploy-guard snapshots capabilities[] and
 * limitations[] from every live worker's /health and qnfo-fleet-control grades the share that declare both
 * (capability_contract_conformance). Each line states what this file does or refuses to do; the suite pins both lists
 * non-empty and the limits that are also constants here (MAX_NEW_PER_TICK, MAX_OPEN, WIP_ATTEMPTS, WIP_STALE_MIN). */
var CAPABILITIES = [
  "gap-register-read: reads v_process_path_gaps and v_dod_spof_gaps from the AUDIT D1",
  "owner-worker-resolution: names the worker and file that own a gap from evolve_targets",
  "issue-filing: files one agent_issues row per gap with the live worker, the file, the reproduction SQL and a query as the definition of done",
  "auto-close: re-runs each filing's probe and closes the issue itself (close_channel evolve-auto) when the probe returns 0 rows",
  "wip-recovery: parks a queued code task that has burned 6 attempts and not moved for 10 minutes while active planner WIP reaches shared code_plan_wip, after backing its row up to ops_config",
  "control-plane-visibility: counts a gap whose owner the code loop may not change and reports it instead of filing it",
  "run-ledger: records every tick in evolve_runs",
  "report: GET /report returns the last 20 filings and the last run",
  "manual-tick: POST /tick runs the same work as the cron, gated by x-loop-token when LOOP_TOKEN is configured"
];
var LIMITATIONS = [
  "never edits code, opens a pull request, deploys or changes a view; it writes only its own agent_issues rows and its own tables",
  "files at most " + MAX_NEW_PER_TICK + " issues per tick and holds at most " + MAX_OPEN + " open filings, so a wide register cannot flood the code loop",
  "files only a gap whose owning worker evolve_targets names; an unnamed owner is recorded as a skip, never re-worded into something easier",
  "never files against a control-plane worker in DENY_WORKERS, a hand-kept mirror of the orchestrator's plan denylist; such a gap is only counted",
  "wip recovery never touches a task with fewer than " + WIP_ATTEMPTS + " attempts or one that moved in the last " + WIP_STALE_MIN + " minutes, acts at most " + WIP_PARK_PER_TICK + " times per tick and only while active planner WIP reaches code_plan_wip",
  "reads and writes one D1 binding (AUDIT) and holds no other binding or secret; with no AUDIT binding a tick does nothing",
  "runs on a 5,20,35,50 minute cron; /health reports only the last recorded run"
];

async function handleFetch(request, env) {
  var req = request;
  var url = new URL(req.url);
  var path = url.pathname;
  try {
    if (path === "/health") {
      var last = null;
      try {
        var lr = await env.AUDIT.prepare(
          "SELECT ts, scanned, filed, closed, detail FROM evolve_runs ORDER BY id DESC LIMIT 1"
        ).all();
        last = ((lr && lr.results) || [])[0] || null;
      } catch (e) { last = { error: errText(e) }; }
      return json({ ok: true, worker: WORKER, version: VERSION, last_run: last, capabilities: CAPABILITIES, limitations: LIMITATIONS });
    }
    if (path === "/report") return json(await report(env));
    if (path === "/tick" && req.method === "POST") {
      if (!tickAllowed(env, req)) return json({ error: "forbidden" }, 403);
      return json(await runTick(env));
    }
    return json({ worker: WORKER, version: VERSION, endpoints: ["/health", "/report", "POST /tick"] });
  } catch (e) {
    return json({ error: errText(e) }, 500);
  }
}

/* ES MODULE FORMAT, NOT SERVICE-WORKER SYNTAX -- and this is not a style choice.
 * Creating this worker with a D1 binding through the canonical path is refused as
 * "Binding 'AUDIT' of type 'd1' requires a Worker written in ES module format" (CF 100329), and a
 * service-worker script uploaded on the module path fails as "no registered event handlers" (10068).
 * The fix is the export default below. There is still no import: the canonical deployer PUTs this
 * file verbatim, so a bare specifier would ship unresolved. */
export default {
  fetch: function (request, env) {
    return handleFetch(request, env);
  },
  scheduled: function (event, env) {
    return runTick(env)
      .then(function (out) { console.log("EVOLVE-1 tick " + JSON.stringify(out)); })
      .catch(function (e) {
        console.error(JSON.stringify({ worker: WORKER, event: "tick-failed", error: errText(e) }));
      });
  }
};
