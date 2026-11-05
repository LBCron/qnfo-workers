var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var VERSION = "2.0.14-codeagent"; // 2.0.14 CLOSE-REFUSAL-1 (2026-11-05): host parity with qnfo-lifecycle closeIssueGuarded: a close the contract guard refuses is a recheck, not the end of the run. // 2.0.13 SLA-GAP-1 (agent_issues 1000619): host parity with qnfo-lifecycle slaGap. // 2.0.12 FOLDED-TARGET-REVERT-1 (2026-10-26): reverts 2.0.11 (PR 4620), which edited this FOLDED member without its host and turned qnfo-lifecycle/backlog-fold.test.mjs red; the live code is qnfo-lifecycle's backlogMod. // 2.0.9 SLA-120M-7 (2026-10-14): the advisor-noise sweep closes a snapshot after 120 minutes, not 3 h, and logs its caught error; host parity with qnfo-lifecycle 1.11.4. // 2.0.8 WORKERS-BP-LOGGING-qnfo-lifecycle-1 (2026-10-14, agent_issues 2536): the swallowed catches log as a structured console.error; host parity with qnfo-lifecycle 1.11.3. 2.0.7: BACKLOG-LATEST-PASS-1.
// PRIORITY-QUEUE-1 (2026-10-03, owner directive): the sweep ranks critical first. The old CASE ranked high, medium, else,
// so critical issues sorted with low. Within a priority the least recently touched row still goes first (rotation).
var WORKER = "qnfo-backlog-exec";
var MAX_ROW = 40;
var LATEST_PASS_MAX_H = 3;
var PROBE_TIMEOUT = 8e3;
async function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}
__name(json, "json");
function ts() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(ts, "ts");
function nowEpoch() {
  return Date.now();
}
__name(nowEpoch, "nowEpoch");
function createdAgeMs(ca, now) {
  if (typeof ca === "number") return now - ca;
  if (typeof ca === "string") {
    const t = ca.trim();
    if (/^\d{10,}$/.test(t)) return now - Number(t);
    const d = new Date(t).getTime();
    if (Number.isFinite(d)) return now - d;
  }
  return 0;
}
__name(createdAgeMs, "createdAgeMs");
async function recordEvent(env, kind, text, meta, job, status) {
  try {
    const id = kind.slice(0, 2) + "-" + (job || WORKER) + "-" + Date.now().toString(36);
    await env.AUDIT.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1,?2,?3,?4,?5,?6,?7)").bind(id, ts(), kind, String(text).slice(0, 800), JSON.stringify(meta || {}).slice(0, 800), job || WORKER, status || "ok").run();
  } catch (e) {
  }
}
__name(recordEvent, "recordEvent");
async function alert(env, source, level, message) {
  try {
    await env.AUDIT.prepare("INSERT INTO alerts (source, level, message) VALUES (?,?,?)").bind(source, level, String(message).slice(0, 500)).run();
  } catch (e) {
  }
}
__name(alert, "alert");
function workerTarget(text) {
  const m = String(text || "").match(/\b(qnfo-[a-z0-9-]+|personal-api(?:-[a-z0-9-]+)?|research-daily-brief|calendar-api|events-radar|qnfo-ai|qnfo-ai-chat)\b/g);
  if (!m) return null;
  return m[0];
}
__name(workerTarget, "workerTarget");
var TRUSTED_TRANSPORTS = new Set(["http", "external", "curl", "container", "dns", "edge-ext", "external-curl", "external-http", "external-https"]);
function transportTrusted(tr) {
  const t = String(tr || "").toLowerCase().trim();
  if (!t) return false;
  if (TRUSTED_TRANSPORTS.has(t)) return true;
  return TRUSTED_TRANSPORTS.has(t.split(":")[0].trim());
}
async function closeIssue(env, id, now, target, evidence) {
  const stamp = new Date().toISOString();
  const ev = "backlog-exec v1.6.1 evidence-first auto-close " + stamp + (target ? " | target=" + target : "") + (evidence ? " | " + evidence : "");
  await env.AUDIT.prepare("INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, remediation, close_evidence, triaged_at) VALUES (?1,'RC-03','closed','qnfo-backlog-exec',datetime('now'),'auto-close by qnfo-backlog-exec v1.6.0 drain',?2,datetime('now')) ON CONFLICT(issue_id) DO UPDATE SET triage_state='closed', close_evidence=?2, triaged_at=datetime('now')").bind(id, ev).run();
  return env.AUDIT.prepare("UPDATE agent_issues SET status='closed', close_channel='auto:backlog-exec', updated_at=?1 WHERE id=?2 AND status='open'").bind(now, id).run();
}
// CLOSE-REFUSAL-1 (2026-11-05, pillar autonomy; CHAOS-DRILL-FAILED-1 control:model-health-sweep, agent_issues 1001590): the BEFORE UPDATE trigger issue_close_evidence_required raises ABORT
// 'close-while-contract-fails' for an issue whose own contract still reads a failing verdict, and the call sites below let that error end the whole daily run: qnfo-lifecycle logged it 23 times
// from 2026-11-03T05:00Z and the 02:00 UTC run of 2026-11-04 never reached its summary job-run event, which is the evidence the drill probe of model-health-sweep reads. A refused close is a
// decision of the guard, not a failure of the run: the issue stays open for its contract to close and the run goes on to the next row. Any other error is still thrown.
async function closeIssueGuarded(env, id, now, target, evidence) {
  try { await closeIssue(env, id, now, target, evidence); return ""; } catch (e) {
    const m = String((e && e.message) || e);
    if (m.indexOf("close-while-contract-fails") >= 0 || m.indexOf("close-without-evidence") >= 0) return m.slice(0, 160);
    throw e;
  }
}
// BACKLOG-EXEC-EVIDENCE-1 (2.0.4, agent_issues 1808): exception-class issues (WORKER-EXCEPTION-DETECTED <worker>,
// ALERT-STORM-DETECTED <worker>, filed by qnfo-error-selfheal until it was retired on 2026-10-01) closed when alerts held no
// qnfo-error-selfheal row naming the worker in 24 h. That worker is retired and alerts holds 0 of its rows, so the count was
// always 0 and every such issue older than 24 h closed, even while the worker kept failing; the health probe was read and
// then ignored. The target was also wrong: the first fleet name in title+description, which is the filer itself whenever the
// title names a worker the pattern misses (issue 509, job-market-watch, closed as "qnfo-error-selfheal" recovered), and any
// prose issue with "exception" in its title was treated as one (#1826, and #1808 itself as "qnfo-workers").
// Now: only a detector-shaped title counts, its subject is the worker the title names ("__unknown__" is no worker), and the
// issue closes only when all of these hold, written into close_evidence by the statement that closes it:
//   errors stopped: the latest worker_usage_daily snapshot (qnfo-fleet-control refreshScriptUsage, Cloudflare
//     workersInvocationsAdaptive per script, where errors are counted now) is under 36 h old, covers >= 10 scripts, has
//     the worker's row with errors_24h = 0, and its 24 h window began after the issue was filed;
//   no exception rows for the worker in worker_logs in 24 h (outcome other than ok/canceled, or exceptions_json);
//   no alert flood from the worker in 24 h (at most 4 alerts in any clock hour; the detector's storm was > 8 in 60 min,
//     which always puts >= 5 into one clock hour);
//   the health probe passed: see exceptionProbe (trusted transports only; a same-zone fetch never counts).
var EXC_TITLE = /\b(?:WORKER-EXCEPTION-DETECTED|ALERT-STORM-DETECTED|ERROR-BURST(?:-DETECTED)?)\s+(\S+)/i;
var EXC_SCRIPT = /^[a-z0-9][a-z0-9-]{0,62}$/;
var EXC_PROBE_MAX_MIN = 30;
var EXC_SNAPSHOT_MAX_H = 36;
var EXC_SNAPSHOT_MIN_SCRIPTS = 10;
var EXC_ALERTS_PER_HOUR_MAX = 4;
function exceptionTarget(title) {
  const m = String(title || "").match(EXC_TITLE);
  if (!m) return { detector: false, target: null };
  const n = m[1].replace(/[),.;:]+$/, "");
  return { detector: true, target: EXC_SCRIPT.test(n) ? n : null, named: n };
}
async function exceptionRecurrence(env, name, createdMs) {
  const out = { ok: false, why: "", ev: "" };
  const snap = await env.AUDIT.prepare("SELECT day, COUNT(*) AS n, MAX(ts) AS ts FROM worker_usage_daily WHERE day = (SELECT MAX(day) FROM worker_usage_daily) GROUP BY day").first();
  if (!snap) { out.why = "unmeasured: worker_usage_daily is empty"; return out; }
  const snapMs = Date.parse(String(snap.ts || ""));
  if (!Number.isFinite(snapMs) || Date.now() - snapMs > EXC_SNAPSHOT_MAX_H * 36e5) { out.why = "unmeasured: worker_usage_daily snapshot " + snap.day + " is stale (ts " + snap.ts + ")"; return out; }
  if (Number(snap.n) < EXC_SNAPSHOT_MIN_SCRIPTS) { out.why = "unmeasured: worker_usage_daily snapshot " + snap.day + " covers " + snap.n + " scripts (< " + EXC_SNAPSHOT_MIN_SCRIPTS + ")"; return out; }
  const u = await env.AUDIT.prepare("SELECT requests_24h, errors_24h, ts FROM worker_usage_daily WHERE day = ?1 AND script = ?2").bind(snap.day, name).first();
  if (!u) { out.why = "unmeasured: no worker_usage_daily row for " + name + " in snapshot " + snap.day; return out; }
  const uMs = Date.parse(String(u.ts || ""));
  if (!Number.isFinite(uMs) || uMs - 864e5 < createdMs) { out.why = "unmeasured: the snapshot's 24h window (to " + u.ts + ") began before the issue was filed (" + new Date(createdMs).toISOString() + ")"; return out; }
  const wl = await env.AUDIT.prepare("SELECT COUNT(*) AS c, MAX(ingested_at) AS last FROM worker_logs WHERE script_name = ?1 AND ts_ms >= ?2 AND (COALESCE(outcome, 'ok') NOT IN ('ok', 'canceled') OR (exceptions_json IS NOT NULL AND exceptions_json NOT IN ('', '[]')))").bind(name, Date.now() - 864e5).first();
  const al = await env.AUDIT.prepare("SELECT COALESCE(MAX(n), 0) AS m FROM (SELECT strftime('%Y-%m-%d %H', created_at) AS h, COUNT(*) AS n FROM alerts WHERE source = ?1 AND julianday(created_at) >= julianday('now', '-24 hours') GROUP BY h)").bind(name).first();
  const errors = Number(u.errors_24h || 0), logErr = wl ? Number(wl.c || 0) : 0, perHour = al ? Number(al.m || 0) : 0;
  out.ev = "worker_usage_daily day=" + snap.day + " ts=" + u.ts + " errors_24h=" + errors + " requests_24h=" + Number(u.requests_24h || 0) + " (window after filing " + new Date(createdMs).toISOString() + "); worker_logs error rows 24h=" + logErr + "; alerts max/h 24h=" + perHour;
  if (errors > 0 || logErr > 0 || perHour > EXC_ALERTS_PER_HOUR_MAX) { out.why = "errors recur: " + out.ev; return out; }
  out.ok = true;
  return out;
}
// The health probe: the newest trusted-transport fleet_probe_log row (qnfo-fleet-dashboard probes most workers over http
// every 5-15 min) decides when it is under 30 min old, pass or fail. Only when there is none (the dashboard does not probe
// itself) does the external /health probe in worker_live_audit (scripts/fleet-autoaudit.py) count, if under 6 h old.
var EXC_LIVE_AUDIT_MAX_H = 6;
async function exceptionProbe(env, name) {
  const rs = await env.AUDIT.prepare("SELECT ok, status, ts, transport, source FROM fleet_probe_log WHERE name = ?1 ORDER BY id DESC LIMIT 12").bind(name).all();
  const row = (rs.results || []).find((r) => transportTrusted(r.transport));
  let why = "no trusted-transport fleet_probe_log row for " + name;
  if (row) {
    const ageMin = (Date.now() - new Date(row.ts).getTime()) / 6e4;
    const ev = "probe ok=" + Number(row.ok) + " status=" + row.status + " transport=" + row.transport + " ts=" + row.ts + " source=" + row.source;
    if (ageMin <= EXC_PROBE_MAX_MIN) return { ok: Number(row.ok) === 1, ev: ev };
    why = ev + " (older than " + EXC_PROBE_MAX_MIN + "m)";
  }
  let la = null;
  try { la = await env.AUDIT.prepare("SELECT http, live_version, probed_at FROM worker_live_audit WHERE worker = ?1").bind(name).first(); } catch (e) { la = null; }
  const laMs = la ? Date.parse(String(la.probed_at || "").replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(la.probed_at || "")) ? "" : "Z")) : NaN;
  if (la && Number(la.http) === 200 && Number.isFinite(laMs) && Date.now() - laMs <= EXC_LIVE_AUDIT_MAX_H * 36e5) return { ok: true, ev: "probe ok=1 status=200 transport=external-https ts=" + la.probed_at + " source=worker_live_audit live_version=" + la.live_version };
  return { ok: false, ev: why + (la ? "; worker_live_audit http=" + la.http + " probed_at=" + la.probed_at + " (needs 200 within " + EXC_LIVE_AUDIT_MAX_H + "h)" : "") };
}
async function recheckRecentCloses(env) {
  let reopened = 0;
  const now = nowEpoch();
  try {
    const rows = await env.AUDIT.prepare("SELECT issue_id, close_evidence FROM issue_triage WHERE owner='qnfo-backlog-exec' AND triage_state='closed' AND triaged_at >= datetime('now','-7 days') AND close_evidence LIKE '%target=%' LIMIT 40").all();
    for (const r of rows.results || []) {
      const m = String(r.close_evidence || "").match(/target=([a-z0-9-]+)/i);
      if (!m) continue;
      const tgt = m[1];
      const last = await env.AUDIT.prepare("SELECT ok, ts FROM fleet_probe_log WHERE name=?1 ORDER BY id DESC LIMIT 1").bind(tgt).first();
      if (!last) continue;
      const age = Date.now() - new Date(last.ts).getTime();
      if (age <= 240 * 6e4 && Number(last.ok) === 0) {
        await env.AUDIT.prepare("UPDATE agent_issues SET status='open', updated_at=?1 WHERE id=?2 AND status='closed'").bind(now, r.issue_id).run();
        await env.AUDIT.prepare("UPDATE issue_triage SET triage_state='triaged', reopened_count = reopened_count + 1 WHERE issue_id=?1").bind(r.issue_id).run();
        reopened++;
        await recordEvent(env, "job-run", "backlog-exec REOPENED issue " + r.issue_id + " (" + tgt + "): fresh probe regression " + last.ts, { id: r.issue_id, target: tgt, action: "reopened" }, WORKER, "ok");
      }
    }
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "backlogMod.recheckRecentCloses", error: String(e && e.message || e) })); }
  return reopened;
}
async function reconcileDodMirrors(env) {
  let dodClosed = 0, reowned = 0;
  try {
    const r1 = await env.AUDIT.prepare("UPDATE task_dod_register SET status='closed', evidence_pointer = COALESCE(evidence_pointer,'') || ' | auto-closed (backlog-exec v1.6.3 mirror reconciliation): source agent_issues row is terminal', updated_at=datetime('now') WHERE status='open' AND source_table='agent_issues' AND EXISTS (SELECT 1 FROM agent_issues a WHERE CAST(a.id AS TEXT)=task_dod_register.source_row_id AND a.status IN ('closed','resolved','wontfix'))").run();
    dodClosed = r1 && r1.meta ? Number(r1.meta.changes || 0) : 0;
    const r2 = await env.AUDIT.prepare("UPDATE task_dod_register SET owner='agent', evidence_pointer = COALESCE(evidence_pointer,'') || ' | re-owned (backlog-exec v1.6.3): prior owner was not a live service', updated_at=datetime('now') WHERE status='open' AND owner NOT IN (SELECT service FROM service_registry WHERE state='live') AND owner <> 'agent'").run();
    reowned = r2 && r2.meta ? Number(r2.meta.changes || 0) : 0;
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "backlogMod.reconcileDodMirrors", error: String(e && e.message || e) })); }
  return { dodClosed, reowned };
}
// REGISTER-INVENTORY-COMPLETE-1 (2026-09-28): the fleet-failures inventory spans SIX
// open-issue registers (GitHub org, task_dod_register, gtd_register, agent_issues,
// fleet_issue_dispatch, issue_ledger) but the drain acted only on agent_issues, so the
// other lanes accumulated un-drained. This dispositions every sub-lane so the inventory
// is both COMPLETE and SELF-DRAINING (self-audit + remediate fleet-wide, not just one table).
var DISPATCH_TERMINAL = "'executed','verified-done','closed-failed','closed-no-action','no-action','dedupe-superseded','no-handler-superseded'";
var DOD_TERMINAL = "'done','closed','resolved','cancelled','cancelled-with-monitor'";
var AGENT_TERMINAL = "'closed','done','resolved','wontfix','cancelled'";
async function reconcileRegisters(env) {
  const out = { dispatchClosed: 0, dodClosed: 0 };
  try {
    const r1 = await env.AUDIT.prepare(
      "UPDATE fleet_issue_dispatch SET state='closed' WHERE state='queued' AND COALESCE(exec_state,'') IN (" + DISPATCH_TERMINAL + ")"
    ).run();
    out.dispatchClosed = r1 && r1.meta ? Number(r1.meta.changes || 0) : 0;
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "backlogMod.reconcileRegisters", error: String(e && e.message || e) })); }
  try {
    const r2 = await env.AUDIT.prepare(
      "UPDATE task_dod_register SET status='closed', evidence_pointer=COALESCE(evidence_pointer,'') || ' | auto-closed (backlog-exec v1.9.0 register reconcile)', updated_at=datetime('now') WHERE status NOT IN (" + DOD_TERMINAL + ") AND status <> 'in_progress' AND source_table='agent_issues' AND EXISTS (SELECT 1 FROM agent_issues a WHERE CAST(a.id AS TEXT)=task_dod_register.source_row_id AND a.status IN ('closed','resolved','wontfix','done','cancelled'))"
    ).run();
    out.dodClosed = r2 && r2.meta ? Number(r2.meta.changes || 0) : 0;
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "backlogMod.reconcileRegisters", error: String(e && e.message || e) })); }
  return out;
}
// REGISTER-INVENTORY-COMPLETE-2 (2026-09-28): the fleet-failures dashboard surfaces
// FOURTEEN registers across panel 4 (complete open-issue inventory) and panel 6
// (unremediated registers). v1.9.0 covered panel 4's six only. This enumerates ALL of
// them with an open count, a kind, and the disposition actor, so no register the
// failures inventory shows is invisible to the drain. kind=event-plane|lock lanes are
// reported but excluded from the open total (they are not drainable backlogs).
var INVENTORY_LANES = [
  ["agent_issues", "SELECT COUNT(*) n FROM agent_issues WHERE status NOT IN (" + AGENT_TERMINAL + ")", "issue", "backlog-exec drain + verified-remediation closure"],
  ["task_dod_register", "SELECT COUNT(*) n FROM task_dod_register WHERE status NOT IN (" + DOD_TERMINAL + ")", "issue", "backlog-exec register reconcile"],
  ["gtd_register", "SELECT COUNT(*) n FROM gtd_register WHERE done=0", "issue", "gtd register owner"],
  ["fleet_issue_dispatch", "SELECT COUNT(*) n FROM fleet_issue_dispatch WHERE state='queued' AND COALESCE(exec_state,'') NOT IN (" + DISPATCH_TERMINAL + ")", "issue", "backlog-exec register reconcile"],
  ["issue_ledger", "SELECT COUNT(*) n FROM issue_ledger WHERE status='open'", "issue", "backlog-exec ledger sweep"],
  ["email_parse_failures", "SELECT COUNT(*) n FROM email_parse_failures WHERE status IN ('open','handoff')", "issue", "qnfo-email parse-failure resolver"],
  ["email_send_violations", "SELECT COUNT(*) n FROM email_send_violations WHERE COALESCE(resolved,0)=0", "issue", "qnfo-email send policy"],
  ["dead_links", "SELECT COUNT(*) n FROM dead_links WHERE resolved_at IS NULL", "issue", "link checker"],
  ["email_loop_quarantine", "SELECT COUNT(*) n FROM email_loop_quarantine WHERE status NOT IN ('processed','archived','spam')", "quarantine", "qnfo-email loop classifier"],
  ["version_queue", "SELECT COUNT(*) n FROM version_queue WHERE status NOT IN ('published','wontfix')", "pipeline", "qnfo-paper-reviser"],
  ["outreach_queue", "SELECT COUNT(*) n FROM outreach_queue WHERE COALESCE(status,'') NOT IN ('sent','skipped','rejected')", "queue", "qnfo-outreach drain"],
  ["deploy_locks", "SELECT COUNT(*) n FROM deploy_locks WHERE typeof(expires_at) IN ('integer','real') AND expires_at > (strftime('%s','now')*1000)", "lock", "qnfo-deploy-guard reap"],
  ["ai_gateway_failures", "SELECT COALESCE(SUM(count),0) n FROM ai_gateway_failures WHERE ts >= ((strftime('%s','now')-86400)*1000)", "event-plane", "qnfo-ai-calibration / gateway-health"]
];
async function openInventory(env) {
  const registers = {};
  let total = 0;
  for (let i = 0; i < INVENTORY_LANES.length; i++) {
    const lane = INVENTORY_LANES[i];
    let open = -1;
    try { const r = await env.AUDIT.prepare(lane[1]).first(); open = r ? Number(r.n) : -1; } catch (e) { open = -1; }
    registers[lane[0]] = { open: open, kind: lane[2], disposition: lane[3] };
    if (open > 0 && lane[2] !== "event-plane" && lane[2] !== "lock") total += open;
  }
  registers["github"] = { open: null, kind: "external", disposition: "GitHub mirror (dashboard GITHUB_TOKEN)" };
  return { laneCount: INVENTORY_LANES.length + 1, total: total, registers: registers };
}
// SLA-GAP-1 (agent_issues 1000619, QNFO.OPS roadmap #162): which open issues lack a doer, an owner or a next action, or have an expired SLA. "No doer" is the fleet's own
// definition, the view v_issues_no_next_action (no active or holding contract, no code-task or session-task line, no live code task, work claim or owner card).
async function slaGap(env) {
  const one = async (sql) => { try { const r = await env.AUDIT.prepare(sql).first(); return r ? Number(r.n) : -1; } catch (e) { return -1; } };
  const counts = {
    open: await one("SELECT COUNT(*) n FROM agent_issues WHERE status = 'open'"),
    no_doer: await one("SELECT COUNT(*) n FROM v_issues_no_next_action"),
    no_owner: await one("SELECT COUNT(*) n FROM agent_issues a LEFT JOIN issue_triage t ON t.issue_id = a.id WHERE a.status = 'open' AND (t.issue_id IS NULL OR COALESCE(t.owner, '') = '')"),
    no_next_action: await one("SELECT COUNT(*) n FROM agent_issues a LEFT JOIN issue_triage t ON t.issue_id = a.id WHERE a.status = 'open' AND COALESCE(t.remediation, '') = '' AND instr(COALESCE(a.description, ''), 'code-task:') = 0"),
    sla_breached: await one("SELECT COUNT(*) n FROM agent_issues a JOIN issue_triage t ON t.issue_id = a.id WHERE a.status = 'open' AND t.sla_due_at < datetime('now')")
  };
  let rows = [];
  try { rows = (await env.AUDIT.prepare("SELECT id, priority, age_h, substr(title, 1, 120) AS title FROM v_issues_no_next_action ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, age_h DESC LIMIT 20").all()).results || []; } catch (e) { rows = []; }
  return { counts: counts, first20_no_doer: rows };
}
function healthOptIn(title, description) {
  const t = String(title || "") + " " + String(description || "");
  const m = t.match(/probe_target\s*=\s*([A-Za-z0-9_.-]+)/i);
  const c2 = t.match(/probe_class\s*=\s*([a-z0-9_-]+)/i);
  if (!m && !c2) return null;
  if (!m) return { partial: true, missing: "probe_target" };
  if (!c2) return { partial: true, missing: "probe_class" };
  const c = t.match(/probe_class\s*=\s*([a-z0-9_-]+)/i);
  return { target: m[1], cls: (c ? c[1] : "").toLowerCase(), complete: true, partial: false };
}
async function probeHealthyViaLog(env, name, maxAgeMin) {
  const win = Number(maxAgeMin) > 0 ? Number(maxAgeMin) : 15;
  try {
    const row = await env.AUDIT.prepare("SELECT ok, status, ts, transport, source FROM fleet_probe_log WHERE name = ?1 ORDER BY id DESC LIMIT 1").bind(name).first();
    if (row && Number(row.ok) === 1) {
      const age = Date.now() - new Date(row.ts).getTime();
      if (age < win * 6e4) return { ok: true, via: "fleet_probe_log", ts: row.ts, status: row.status, transport: row.transport, source: row.source };
    }
  } catch (e) {
  }
  return null;
}
__name(probeHealthyViaLog, "probeHealthyViaLog");
async function probeHealth(name) {
  const hosts = [name + ".q08.workers.dev", name + ".qnfo.org"];
  for (const h of hosts) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT);
      const r = await fetch("https://" + h + "/health", { headers: { "User-Agent": "Mozilla/5.0 (qnfo-backlog-exec)" }, signal: ctl.signal });
      clearTimeout(timer);
      if (r.ok) return { ok: true, host: h, status: r.status, transport: "worker-same-zone" };
    } catch (e) {
    }
  }
  return { ok: false, host: null, status: 0, transport: "worker-same-zone" };
}
__name(probeHealth, "probeHealth");
// SLA-120M-7 (1.11.4): an OPEN-ISSUES advisor snapshot is superseded and closed after 120 minutes, not 3 h (owner directive 2026-10-14:
// no SLA exceeds 120 minutes).
var ADVISOR_NOISE_MAX_MIN = 120;
async function sweepAdvisorNoise(env) {
  let closed = 0;
  const now = nowEpoch();
  try {
    const noise = await env.AUDIT.prepare("SELECT id, title, created_at FROM agent_issues WHERE status='open' AND title LIKE 'OPEN-ISSUES%' ORDER BY id").all();
    const rows = noise.results || [];
    for (const r of rows) {
      const ageMs = createdAgeMs(r.created_at, now);
      if (ageMs > ADVISOR_NOISE_MAX_MIN * 6e4) {
        await closeIssue(env, r.id, now);
        closed++;
        await recordEvent(env, "job-run", "backlog-exec closed advisor-noise snapshot " + r.id + " (" + String(r.title || "").slice(0, 40) + "): superseded, age>" + ADVISOR_NOISE_MAX_MIN + "min", { id: r.id, action: "closed", reason: "advisor-noise sweep v1.2.6" }, WORKER, "ok");
      }
    }
  } catch (e) {
    console.error(JSON.stringify({ worker: "qnfo-lifecycle", where: "sweepAdvisorNoise", error: String(e && e.message || e) }));
  }
  return closed;
}
__name(sweepAdvisorNoise, "sweepAdvisorNoise");
async function sweepIssueLedger(env) {
  let resolved = 0;
  const now = nowEpoch();
  const hours = Number(env.LEDGER_STALE_HOURS) > 0 ? Math.floor(Number(env.LEDGER_STALE_HOURS)) : 72;
  try {
    const stale = await env.AUDIT.prepare(
      "SELECT fingerprint, source, title, last_seen FROM issue_ledger WHERE status='open' AND julianday(last_seen) < julianday('now', ?1) ORDER BY last_seen LIMIT 500"
    ).bind("-" + hours + " hours").all();
    const rows = stale.results || [];
    for (const r of rows) {
      await env.AUDIT.prepare(
        "UPDATE issue_ledger SET status='resolved', resolved_at=?1, resolution_note=?2, updated_at=?1 WHERE fingerprint=?3 AND status='open'"
      ).bind(ts(), "auto-resolved v1.2.8: not re-seen in " + hours + "h (fingerprint PK - a recurrence would have advanced last_seen)", r.fingerprint).run();
      resolved++;
    }
    if (resolved > 0) {
      await recordEvent(env, "job-run", "backlog-exec resolved " + resolved + " stale issue_ledger fingerprint(s) (not re-seen in " + hours + "h)", { action: "issue_ledger-sweep", resolved, window_hours: hours }, WORKER, "ok");
    }
  } catch (e) {
    await recordEvent(env, "job-run", "backlog-exec issue_ledger sweep failed: " + String(e && e.message || e), { action: "issue_ledger-sweep", error: true }, WORKER, "error");
  }
  return resolved;
}
__name(sweepIssueLedger, "sweepIssueLedger");
async function sweepOpsJobs(env) {
  const out = { promoted: 0, failed: 0, strandedBefore: 0 };
  const staleMin = Number(env.OPS_JOB_STALE_MIN) > 0 ? Math.floor(Number(env.OPS_JOB_STALE_MIN)) : 30;
  const reapContinuing = String(env.OPS_JOB_REAP_CONTINUING || "1") !== "0";
  const statuses = reapContinuing ? "'running','continuing','queued'" : "'running','queued'";
  try {
    const stranded = await env.AUDIT.prepare(
      "SELECT COUNT(*) AS c FROM ops_jobs WHERE status IN ('running','continuing','queued') AND length(COALESCE(response,'')) > 0"
    ).first();
    out.strandedBefore = stranded ? Number(stranded.c || 0) : 0;
    const rows = await env.AUDIT.prepare(
      "SELECT id, status, updated_at, length(COALESCE(response,'')) AS rl FROM ops_jobs WHERE status IN (" + statuses + ") AND julianday(updated_at) < julianday('now', ?1) ORDER BY updated_at LIMIT 200"
    ).bind("-" + staleMin + " minutes").all();
    for (const r of rows.results || []) {
      if (Number(r.rl) > 0) {
        await env.AUDIT.prepare("UPDATE ops_jobs SET status='succeeded', updated_at=?1 WHERE id=?2 AND status IN (" + statuses + ")").bind(ts(), r.id).run();
        out.promoted++;
      } else {
        await env.AUDIT.prepare("UPDATE ops_jobs SET status='failed', error=COALESCE(error, ?1), updated_at=?2 WHERE id=?3 AND status IN (" + statuses + ")").bind("reaper v1.3.0 (INFERRED - no diagnostic was captured): no response within " + staleMin + "m of last write", ts(), r.id).run();
        out.failed++;
      }
    }
    if (out.promoted + out.failed > 0) {
      await recordEvent(env, "job-run", "backlog-exec reaped ops_jobs: promoted " + out.promoted + " stranded answer(s) to terminal, failed " + out.failed + " silent row(s) (idle>" + staleMin + "m)", { action: "ops-jobs-reap", promoted: out.promoted, failed: out.failed, stranded_before: out.strandedBefore, stale_min: staleMin }, WORKER, "ok");
    }
  } catch (e) {
    await recordEvent(env, "job-run", "backlog-exec ops_jobs reap failed: " + String(e && e.message || e), { action: "ops-jobs-reap", error: true }, WORKER, "error");
  }
  return out;
}
__name(sweepOpsJobs, "sweepOpsJobs");
async function run(env) {
  const MIN_AGE_MS = (Number(env.MIN_CLOSE_AGE_MIN) > 0 ? Number(env.MIN_CLOSE_AGE_MIN) : 30) * 6e4;
  const PROBE_WIN_MIN = Number(env.PROBE_LOG_MAX_AGE_MIN) > 0 ? Number(env.PROBE_LOG_MAX_AGE_MIN) : 15;
  const dodReconcile = await reconcileDodMirrors(env);
  const reopenedOnRegression = await recheckRecentCloses(env);
  const noiseClosed = await sweepAdvisorNoise(env);
  const ledgerResolved = await sweepIssueLedger(env);
  const jobsReaped = await sweepOpsJobs(env);
  const registers = await reconcileRegisters(env);
  const inventory = await openInventory(env);
  const rows = await env.AUDIT.prepare("SELECT id, title, description, source, category, priority, status, created_at, updated_at FROM agent_issues WHERE status='open' ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, updated_at ASC, id LIMIT ?1").bind(MAX_ROW).all();
  const items = rows.results || [];
  const now = nowEpoch();
  let closed = 0, rechecked = 0, escalated = 0;
  const detail = [];
  for (const row of items) {
    const title = String(row.title || "");
    const name = workerTarget(title + " " + String(row.description || ""));
    const isHealthAvailability = /\b(health|heartbeat|availability|unreachable|endpoint down|is down|down)\b/i.test(title);
    const optIn = healthOptIn(title, row.description);
    if (isHealthAvailability && !optIn) {
      rechecked++;
      detail.push({ id: row.id, action: "recheck", note: "legacy-unmarked health ticket (v1.5.0): no probe_target= opt-in marker, auto-close disabled" });
      continue;
    }
    if (optIn && optIn.partial) {
      escalated++;
      detail.push({ id: row.id, action: "escalate-partial-marker", note: "partial opt-in marker (missing " + optIn.missing + "); fail-closed" });
      continue;
    }
    if (optIn && !isHealthAvailability) {
      escalated++;
      detail.push({ id: row.id, action: "escalate-marker-non-health", note: "opt-in marker on a non-health ticket; auto-close refused" });
      continue;
    }
    if (optIn && isHealthAvailability && optIn.cls === "worker-process") {
      const ageMs = createdAgeMs(row.created_at, now);
      if (ageMs < MIN_AGE_MS) {
        rechecked++;
        detail.push({ id: row.id, target: optIn.target, action: "recheck", note: "too fresh to auto-close: age " + Math.round(ageMs / 6e4) + "m < " + Math.round(MIN_AGE_MS / 6e4) + "m" });
        continue;
      }
      const pLog = await probeHealthyViaLog(env, optIn.target, PROBE_WIN_MIN);
      const p = pLog ? { ok: true, host: pLog.via + " " + pLog.ts, transport: pLog.transport } : await probeHealth(optIn.target);
      if (p.ok && transportTrusted(p.transport)) {
        const refused = await closeIssueGuarded(env, row.id, now, optIn.target);
        if (refused) { rechecked++; detail.push({ id: row.id, action: "recheck", note: "close refused by the contract guard (CLOSE-REFUSAL-1): " + refused }); continue; }
        closed++;
        detail.push({ id: row.id, target: optIn.target, action: "closed", note: "health re-probe PASS " + p.host + " transport=" + p.transport + " (fresh<=" + PROBE_WIN_MIN + "m, age>" + Math.round(MIN_AGE_MS / 6e4) + "m)" });
        await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (" + optIn.target + "): " + p.host + " transport=" + p.transport, { id: row.id, target: optIn.target, action: "closed", reason: "health predicate v1.5.0: opt-in + fresh + trusted transport", transport: p.transport }, WORKER, "ok");
        continue;
      }
      escalated++;
      detail.push({ id: row.id, target: optIn.target, action: "escalate", note: "no close-authorizing evidence (ok=" + p.ok + ", transport=" + (p.transport || "none") + "): same-zone/binding evidence cannot authorize a close" });
      continue;
    }
    // BACKLOG-EXEC-EVIDENCE-1: see exceptionRecurrence. A detector issue that is not proven recovered falls through to the
    // other predicates (a verified remediation can still close it) and is rechecked with the measured reason.
    const exc = !isHealthAvailability ? exceptionTarget(title) : { detector: false };
    let excNote = null;
    if (exc.detector) {
      const ageMs = createdAgeMs(row.created_at, now);
      if (!exc.target) excNote = "exception-class: '" + String(exc.named || "").slice(0, 40) + "' names no worker, so no recurrence can be measured";
      else if (ageMs <= 24 * 3600 * 1e3) excNote = "exception-class: under 24h old";
      else {
        let rec, pr;
        try {
          rec = await exceptionRecurrence(env, exc.target, now - ageMs);
          pr = rec.ok ? await exceptionProbe(env, exc.target) : null;
        } catch (e) {
          rec = { ok: false, why: "recurrence query failed: " + String(e && e.message || e).slice(0, 160) };
        }
        if (rec.ok && pr && pr.ok) {
          const evidence = "BACKLOG-EXEC-EVIDENCE-1 (" + VERSION + ") exception-class closed on evidence: " + rec.ev + "; " + pr.ev;
          const refused = await closeIssueGuarded(env, row.id, now, exc.target, evidence);
          if (refused) { rechecked++; detail.push({ id: row.id, action: "recheck", note: "close refused by the contract guard (CLOSE-REFUSAL-1): " + refused }); continue; }
          closed++;
          detail.push({ id: row.id, target: exc.target, action: "closed", note: evidence.slice(0, 400) });
          await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (" + exc.target + "): exception-class closed on evidence", { id: row.id, target: exc.target, action: "closed", reason: "BACKLOG-EXEC-EVIDENCE-1: errors stopped and probe passed" }, WORKER, "ok");
          continue;
        }
        excNote = "exception-class " + exc.target + " not closed: " + (rec.ok ? "errors stopped (" + rec.ev + ") but " + (pr ? pr.ev : "no probe") : rec.why);
      }
    }
    const isModelHealth = /^MODEL-DEGRADED\b/i.test(title);
    if (isModelHealth) {
      try {
        const dg = await env.AUDIT.prepare("SELECT model_id FROM ai_model_health WHERE status='degraded'").all();
        const degraded = new Set((dg.results || []).map((d) => String(d.model_id)));
        const named = title.replace(/^MODEL-DEGRADED\s*/i, "").split(",").map((s) => s.trim()).filter(Boolean);
        const still = named.filter((m) => degraded.has(m));
        if (degraded.size === 0 || still.length === 0) {
          const refused = await closeIssueGuarded(env, row.id, now);
          if (refused) { rechecked++; detail.push({ id: row.id, action: "recheck", note: "close refused by the contract guard (CLOSE-REFUSAL-1): " + refused }); continue; }
          closed++;
          detail.push({ id: row.id, action: "closed", note: "model-health stale: none of [" + named.slice(0, 4).join(",") + "] degraded now (degraded rows=" + degraded.size + ")" });
          await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (model-health): no named model degraded now", { id: row.id, action: "closed", reason: "model-health predicate cleared v1.2.7" }, WORKER, "ok");
          continue;
        }
        rechecked++;
        detail.push({ id: row.id, action: "recheck", note: "model-health STILL degraded: " + still.join(",") });
        continue;
      } catch (e) {
      }
    }
    const probeFail = title.match(/^\[ai-cal\]\s+model probe failing:\s*(\S+)/i);
    if (probeFail) {
      try {
        const model = probeFail[1];
        const h = await env.AUDIT.prepare("SELECT status FROM ai_model_health WHERE model_id=?1").bind(model).first();
        if (!h || String(h.status) !== "degraded") {
          const refused = await closeIssueGuarded(env, row.id, now);
          if (refused) { rechecked++; detail.push({ id: row.id, action: "recheck", note: "close refused by the contract guard (CLOSE-REFUSAL-1): " + refused }); continue; }
          closed++;
          detail.push({ id: row.id, target: model, action: "closed", note: "ai-cal probe-failing stale: ai_model_health status=" + (h ? h.status : "absent") });
          await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (ai-cal " + model + "): health no longer degraded", { id: row.id, target: model, action: "closed", reason: "ai-cal probe predicate cleared v1.2.7" }, WORKER, "ok");
          continue;
        }
        rechecked++;
        detail.push({ id: row.id, target: model, action: "recheck", note: "ai-cal probe STILL failing: " + model });
        continue;
      } catch (e) {
      }
    }
    const gwFail = title.match(/^\[gw-fail\]\s+(\d+)\s+(\S+)/);
    if (gwFail) {
      try {
        const model = gwFail[2];
        const rec = await env.AUDIT.prepare("SELECT COALESCE(SUM(count),0) AS n FROM ai_gateway_failures WHERE model=?1 AND ts >= ((strftime('%s','now') - 86400) * 1000)").bind(model).first();
        const n = rec ? Number(rec.n || 0) : 0;
        if (n === 0) {
          const refused = await closeIssueGuarded(env, row.id, now);
          if (refused) { rechecked++; detail.push({ id: row.id, action: "recheck", note: "close refused by the contract guard (CLOSE-REFUSAL-1): " + refused }); continue; }
          closed++;
          detail.push({ id: row.id, target: model, action: "closed", note: "gw-fail stale: 0 failures for " + model + " in 24h" });
          await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (gw-fail " + model + "): no recurrence in 24h", { id: row.id, target: model, action: "closed", reason: "gateway-failure predicate cleared v1.2.7" }, WORKER, "ok");
          continue;
        }
        rechecked++;
        detail.push({ id: row.id, target: model, action: "recheck", note: "gateway failures CURRENT: " + n + "/24h - real defect, root fix pending" });
        continue;
      } catch (e) {
      }
    }
    const vq = title.match(/version_queue\s+id=(\d+)/i);
    if (vq) {
      try {
        const q = await env.AUDIT.prepare("SELECT status, version_to, updated_at FROM version_queue WHERE id=?1").bind(Number(vq[1])).first();
        if (!q || String(q.status).toLowerCase() !== "error") {
          const refused = await closeIssueGuarded(env, row.id, now);
          if (refused) { rechecked++; detail.push({ id: row.id, action: "recheck", note: "close refused by the contract guard (CLOSE-REFUSAL-1): " + refused }); continue; }
          closed++;
          detail.push({ id: row.id, target: "version_queue#" + vq[1], action: "closed", note: q ? "version_queue status=" + q.status + " (not error) - condition cleared" : "version_queue row absent - ticket orphaned" });
          await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (VQ " + vq[1] + "): " + (q ? "status=" + q.status : "row absent"), { id: row.id, action: "closed", reason: "publish predicate cleared v1.2.9" }, WORKER, "ok");
          continue;
        }
        rechecked++;
        detail.push({ id: row.id, target: "version_queue#" + vq[1], action: "recheck", note: "version_queue STILL error (v" + (q.version_to || "?") + ", updated " + q.updated_at + ")" });
        continue;
      } catch (e) {
      }
    }
    if (/^TERMINAL research failure\b/i.test(title)) {
      try {
        const t = await env.AUDIT.prepare("SELECT COUNT(*) AS c FROM research_queue WHERE status='failed' AND recover_count>=2").first();
        const still = t ? Number(t.c || 0) : 0;
        if (still === 0) {
          const refused = await closeIssueGuarded(env, row.id, now);
          if (refused) { rechecked++; detail.push({ id: row.id, action: "recheck", note: "close refused by the contract guard (CLOSE-REFUSAL-1): " + refused }); continue; }
          closed++;
          detail.push({ id: row.id, action: "closed", note: "research terminal condition cleared: 0 rows with status='failed' AND recover_count>=2" });
          await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (research): no terminal-failed queue rows remain", { id: row.id, action: "closed", reason: "research-pipeline predicate cleared v1.2.9" }, WORKER, "ok");
          continue;
        }
        rechecked++;
        detail.push({ id: row.id, action: "recheck", note: "research terminal condition STILL present: " + still + " queue row(s) status='failed' AND recover_count>=2" });
        continue;
      } catch (e) {
      }
    }
    // VERIFIED-REMEDIATION-CLOSURE-1 (issue #1281 DRAIN-CLOSURE-PREDICATE-TYPE-ERROR):
    // every predicate above is a liveness/heartbeat predicate, so semantic
    // defects (correctness/security/email/dissemination/publication/procedure)
    // could never close. The "defect absence" predicate is a fresh
    // remediation_verifications row with pass=1: a re-probe that verified the
    // fix. Close those here (RE-FALSIFICATION-CLOSED-GATE-1).
    // BACKLOG-LATEST-PASS-1 (2.0.7, 2026-10-14; agent_issues 2222 closed at 02:01 UTC while its latest verification, 01:44, failed
    // "pending: companion_hours_since_last_piece reads 93.1"): the predicate took ANY pass in 7 days, so a pass from 2026-10-09 closed a
    // defect that was still live (also 2086, 2050, 1947 in the week to 2026-10-14). It now reads only the issue's LATEST verification,
    // which must pass and be at most LATEST_PASS_MAX_H old (INTEGRITY-GUARDS-1: a fix whose latest verification fails does not count);
    // the close evidence names that row.
    {
      let vr = null;
      try {
        vr = await env.AUDIT.prepare(
          "SELECT id, probe_url, transport, observed, pass, verified_at FROM remediation_verifications WHERE issue_id=?1 ORDER BY id DESC LIMIT 1"
        ).bind(row.id).first();
      } catch (e) { console.error(JSON.stringify({ worker: WORKER, where: "run:latest-pass", error: String(e && e.message || e).slice(0, 300) })); }
      const vrMs = vr ? Date.parse(String(vr.verified_at || "").replace(" ", "T") + (/[zZ]$/.test(String(vr.verified_at || "")) ? "" : "Z")) : NaN;
      if (vr && Number(vr.pass) === 1 && Number.isFinite(vrMs) && now - vrMs <= LATEST_PASS_MAX_H * 36e5) {
        const evidence = "BACKLOG-LATEST-PASS-1 latest verification #" + vr.id + " pass at " + vr.verified_at + " via " + (vr.transport || "?") + ": " + String(vr.observed || "").slice(0, 160);
        const refused = await closeIssueGuarded(env, row.id, now, null, evidence);
        if (refused) { rechecked++; detail.push({ id: row.id, action: "recheck", note: "close refused by the contract guard (CLOSE-REFUSAL-1): " + refused }); continue; }
        closed++;
        detail.push({ id: row.id, action: "closed", note: evidence.slice(0, 300) });
        await recordEvent(env, "job-run", "backlog-exec closed issue " + row.id + " (latest verification passed)", { id: row.id, action: "closed", reason: "BACKLOG-LATEST-PASS-1", verification: vr.id, probe: vr.probe_url, transport: vr.transport }, WORKER, "ok");
        continue;
      }
    }
    await env.AUDIT.prepare("UPDATE agent_issues SET updated_at=?1 WHERE id=?2 AND status='open'").bind(now, row.id).run();
    rechecked++;
    detail.push(excNote ? { id: row.id, title: title.slice(0, 60), target: exc.target || null, action: "recheck", note: excNote.slice(0, 400) } : { id: row.id, title: title.slice(0, 60), action: "recheck", note: name ? "probe target " + name : "no probe target" });
  }
  const summary = { registers, inventory, noiseClosed, ledgerResolved, jobsReaped, processed: items.length, closed, rechecked, escalated, detail: detail.slice(0, MAX_ROW) };
  if (escalated > 0) await alert(env, WORKER, "warning", "backlog-exec: " + escalated + " health issue(s) still failing: " + detail.filter((d) => d.action === "escalate").map((d) => d.target).join(", "));
  await recordEvent(env, "job-run", "backlog-exec " + JSON.stringify({ noiseClosed, ledgerResolved, jobsReaped, processed: items.length, closed, rechecked, escalated }), { exceptionRule: "BACKLOG-EXEC-EVIDENCE-1", version: VERSION, noiseClosed, ledgerResolved, jobsReaped, processed: items.length, closed, rechecked, escalated }, WORKER, "ok");
  return { status: "ok", notes: summary };
}
__name(run, "run");
var worker_default = {
  async scheduled(event, env, ctx) {
    if (env.FLEET_FEED) {
      try {
        var fr = await env.FLEET_FEED.fetch("https://qnfo-fleet-feed.q08.workers.dev/feed/self?worker=qnfo-backlog-exec");
        if (fr.ok) {
          var fd = await fr.json();
          var actionable = (fd.findings || []).filter(function(f) {
            return f.auto_action && f.severity_int >= 2 && f.category && !f.category.startsWith("backlog/");
          }).slice(0, 10);
          for (var af of actionable) {
            var sql = af.auto_action;
            if (sql && /^(UPDATE|INSERT|DELETE)/i.test(sql.trim())) {
              try {
                await env.AUDIT.prepare(sql).run();
              } catch (e2) {
              }
            }
            try {
              await env.AUDIT.prepare(
                "INSERT OR IGNORE INTO self_heal_actions (kind, ref, action, ts, status, verified_at) VALUES (?,?,?,datetime('now'),'executed',datetime('now'))"
              ).bind("feed-auto-exec", af.id, (af.auto_action || "").slice(0, 500)).run();
            } catch (e3) {
            }
          }
        }
      } catch (eFeed) {
      }
    }
    try {
      const out = await run(env);
      console.log("backlog-exec", JSON.stringify(out));
    } catch (e) {
      console.error("backlog-exec", String(e && e.message || e));
      await alert(env, WORKER, "error", "run failed: " + String(e && e.message || e));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const open = await env.AUDIT.prepare("SELECT COUNT(*) c FROM agent_issues WHERE status='open'").first().catch(() => null);
      const led = await env.AUDIT.prepare("SELECT COUNT(*) c FROM issue_ledger WHERE status='open'").first().catch(() => null);
      const stranded = await env.AUDIT.prepare("SELECT COUNT(*) c FROM ops_jobs WHERE status IN ('running','continuing','queued') AND length(COALESCE(response,'')) > 0").first().catch(() => null);
      // HEALTH-PROBE-BUDGET-1 (2026-09-29): /health MUST stay cheap. This handler used to
      // run the full 14-lane inventory scan, which on a cold isolate exceeded the
      // 5s AbortController budget in qnfo-ops probeService() -> AbortError -> backlog_status
      // and fleet_status both reported this worker as "timeout" while it was in fact
      // healthy (curl http=200 in 1.6s). That false negative auto-filed agent_issues 1368.
      // The full inventory is served by the separate /inventory route.
      return json({ ok: true, worker: WORKER, version: VERSION, capabilities: ["backlog-inventory", "issue-drain", "stranded-job-recovery"], limitations: ["POST /run needs RUN_TOKEN or the qnfo-ops service binding (backlog.internal)", "the drain runs on the daily 01:10 cron", "/health reports counts only; the full inventory is GET /inventory"], openBacklog: open ? open.c : -1, openLedger: led ? led.c : -1, strandedOpsJobs: stranded ? stranded.c : -1, openIssuesTotal: open ? open.c : -1 });
    }
    if (url.pathname === "/inventory") {
      return json({ ok: true, worker: WORKER, version: VERSION, inventory: await openInventory(env) });
    }
    if (url.pathname === "/sla-gap") {
      return json({ ok: true, worker: WORKER, version: VERSION, sla_gap: await slaGap(env) });
    }
    if (url.pathname === "/run" && request.method === "POST") {
      const runTok = env.RUN_TOKEN;
      const authH = request.headers.get("Authorization") || "";
      // INTERNAL-SERVICE-BINDING-AUTH-1 (2026-09-27): qnfo-ops calls this endpoint over the
      // BACKLOG service binding as https://backlog.internal/run and holds no RUN_TOKEN
      // binding, so the Bearer-only gate returned 401 on every drain attempt. Internal
      // service-binding calls never leave Cloudflare and never carry CF-Connecting-IP;
      // client-originated calls always do. Bearer remains supported and preferred.
      const internalCall = url.hostname === "backlog.internal" && !request.headers.get("CF-Connecting-IP");
      if (runTok && authH === "Bearer " + runTok) {
        // authorized: shared run token
      } else if (internalCall) {
        // authorized: internal service-binding caller
      } else if (!runTok) {
        return json({ error: "run endpoint disabled: RUN_TOKEN unset" }, 503);
      } else {
        return json({ error: "unauthorized" }, 401);
      }
      const out = await run(env);
      return json({ ok: true, worker: WORKER, version: VERSION, out });
    }
    return json({ error: "not found" }, 404);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map