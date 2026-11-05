



// qnfo-observability v1.2.2 — v1.2.1 + ingest fixes: (a) restore LOGS R2 binding (was missing after a prior deploy, freezing trace ingest), (b) startAfter cursor in R2 list (once backlog >1000 keys the filter-only list() returned 0 files and the cursor froze).
// qnfo-observability v1.2.0 — merged: audit-hub + qnfo-events
// PURPOSE: makes the QNFO fleet observable to itself.
//   (1) INGEST  — scheduled trace ingest: Cloudflare Logpush workers_trace_events (R2 qnfo-audit/workers_trace/*.log.gz)
//                 parsed into structured D1 table worker_logs. Covers ALL workers with zero per-worker code changes.
//   (2) LOG API — POST /log direct structured events (optional client snippet), GET /workers/logs query.
//   (3) SUMMARY — GET /fleet/summary joins worker_logs + fleet_probe_log + worker_invocations into one view.
//   (4) DIGEST  — hourly digest writes cloud_ops_events (kind=fleet-observability-digest) + alerts on error-ratio anomalies.
//   (5) JOBS    — GET /jobs + GET /jobs/<id>: keyless read-only view of the qnfo-ops async-job ledger
//                 (qnfo-audit.ops_jobs). STATUS METADATA ONLY — never the response body (JOBS-STATUS-PUBLIC-1).
// CANONICAL SOURCE: QNFO/qnfo-workers/qnfo-observability/worker.js
// DEPLOY: wrangler deploy (from this dir); bindings AUDIT (qnfo-audit D1) + LOGS (R2 qnfo-audit); cron 17 * * * *.
//
// v1.1.6-single-module (2026-09-13, ops-endpoint session). STRUCTURAL DEPLOY BLOCKER FIXED.
//   v1.1.4 and earlier did `import { FLEET } from './fleet.js'`, making this a MULTI-MODULE worker.
//   The control plane deploys from a single R2 key (r2:qnfo-canonical/qnfo-observability.js), and one
//   key cannot carry two modules — so every deploy failed with:
//     HTTP 400 code 10021 "No such module \"fleet.js\". imported from \"worker.js\"
//   (observed: fleet_deploys id 76, 2026-09-13T14:04:01Z, ok:0.)
//   This was NOT transient and could not be fixed by re-running the deploy: the worker's module
//   topology was incompatible with the deploy transport. FLEET is now inlined below and the import
//   is removed. fleet.js is retained in the repo as the human-readable registry snapshot, but it is
//   no longer a runtime dependency. Any worker that imports a sibling module cannot deploy through a
//   single-key canonical and must be inlined the same way.
//
// v1.1.5-false-clean-fix (2026-09-13). The integration monitor could report `healthy, n=0` for a chain
//   whose pending predicate matched NO rows because the status enum in the medium had changed.
//   Verified against live D1 — five chains were false-clean:
//     alerts    predicate `digested = 0`      -> 0 rows; actual: 'auto' 914, 1 141, NULL 45
//     outreach  predicate `status='pending'`  -> 0 rows; actual: 'needs-contact' 20, sent 3, skipped 18
//     revisions predicate `status='queued'`   -> 0 rows; actual: 'needs-substantive-revision' 38, quarantined 23
//     intents   predicate `status='pending'`  -> 0 rows; actual: 'triaged' 34, deduped 10, done 106
//     email     predicate `status='received'` -> 0 rows; actual: processed 226, archived 110, spam 45
//   A monitor that cannot see backlog is worse than no monitor, because it reports health.
//   Two changes: (a) corrected the two predicates whose target enum is unambiguous from live data
//   (alerts -> NULL/''/0; outreach -> 'needs-contact'); (b) added `total` to every chain — when the
//   pending predicate matches 0 rows while the medium holds >= 20 rows the chain now reports
//   `empty-match` and raises an `enum-check` opportunity instead of asserting `healthy`. Chains where
//   empty genuinely IS success (ideas, errata, version-drain, issues, alerts) set expectEmpty.
//   empty-match is excluded from chainScore: it is an UNKNOWN, not a pass. Counting it as healthy is
//   what let five stale predicates report green for days.

// FLEET registry snapshot, INLINED (was ./fleet.js).
// REGENERATED 2026-09-13 from qnfo-audit.service_registry (55 rows), cross-checked against
// qnfo-fleet-dashboard's own Cloudflare API read:
//   fleet_dashboard_state.fleet.workers      = 55
//   fleet_dashboard_state.integration.ghost  = []
//   fleet_dashboard_state.integration.unregistered = []
// PRIOR VERSION: captured 2026-09-10 with 81 entries; the fleet then underwent a ghost-retirement
// reconciliation on 2026-09-12 ("dropped 25 ghost scheduled entries, 39 ghost probes, 2 fully-ghost
// chains"). The stale 81-name list made digest() report ~26 workers as silent that no longer existed.
// MAINTENANCE: regenerate from service_registry. Do not hand-append. A worker merged into a hub is
// retired even if its code still runs inside the hub under its own WORKER constant (cf.
// qnfo-fleet-control bundling qnfo-fleet-advisor + qnfo-fleet-calibrator).
const FLEET = [
  "ai-health-prober",
  "audit-hub",
  "calendar-api",
  "companion-hub",
  "errata-hub",
  "fleet-exec",
  "idea-hub",
  "jnl-pipeline",
  "obsidian-writer",
  "osf-integrity-check",
  "personal-api",
  "personal-companion",
  "qnfo-agent-orchestrator",
  "qnfo-ai",
  "qnfo-ai-calibration",
  "qnfo-ai-search",
  "qnfo-archive",
  "qnfo-autopilot",
  "qnfo-backlog-exec",
  "qnfo-chat-canary",
  "qnfo-cloud-ops",
  "qnfo-ddocs-indexer",
  "qnfo-email",
  "qnfo-email-orchestrator",
  "qnfo-events",
  "qnfo-fleet-control",
  "qnfo-fleet-dashboard",
  "qnfo-gateway",
  "qnfo-impact",
  "qnfo-infra",
  "qnfo-intent-orchestrator",
  "qnfo-ipatent",
  "qnfo-kaizen",
  "qnfo-lifecycle",
  "qnfo-memory-mcp",
  "qnfo-observability",
  "qnfo-ops",
  "qnfo-outreach",
  "qnfo-paper-explainer",
  "qnfo-paper-indexer",
  "qnfo-paper-reviser",
  "qnfo-pdf",
  "qnfo-proof",
  "qnfo-qwav",
  "qnfo-research-exec",
  "qnfo-research-supervisor",
  "qnfo-signal-loop",
  "qnfo-skill-sync",
  "qnfo-social",
  "qnfo-subscribers",
  "qnfo-tools-mcp",
  "qnfo-twin-maintain",
  "radar-hub",
  "research-daily-brief"
];

// 1.5.6 ISSUES-CHAIN-DRAINABLE-1 (2026-10-30, pillar autonomy): count only issue families the folded backlog member can drain, and identify its live qnfo-lifecycle host. Tests: issue-backpressure-drainable.test.mjs.
// 1.5.2 ERRATA-CHAIN-DRAINING-1 (2026-10-20, agent_issues 2679, pillar autonomy; patch: reclassification only): the errata chain reads draining, not stuck, while its consumers advance; rejected and no-paper rows are terminal, not pending. Tests: errata-chain-draining.test.mjs.
var VERSION = "1.6.0-retired-agent-ws";
// 1.5.5 RESEARCH-CHAIN-HELD-1 (2026-10-28, pillar autonomy; patch: reclassification only; agent_issues 1000630, 100166): the research chain reads draining, not stuck, while qnfo-research-exec reports in the last 45 minutes that the daily research budget is exhausted (COST-SUSTAIN-1, work resumes at 00:00 UTC); the detail says so. Each day after the budget ran out at about 13:00 UTC the chain read stuck for ten hours, the dashboard raised an error-level issue and the loop-heartbeats journey failed on it. A budget hold that is not reported still reads stuck. Tests: research-chain-held.test.mjs. // 1.5.4 OUTREACH-CHAIN-DRAINED-1 (2026-10-26, pillar autonomy; patch: a fix, agent_issues 100487): the outreach integration chain sets expectEmpty, so a drained queue (0 waiting of 193 rows, every row in a terminal status within the minute of its insertion) reads healthy and no longer files empty-match / enum-check noise; the enum-drift guard is the live detector fm-outreach-chain-enum. // 1.5.3 ISSUE-HYGIENE-1 (2026-10-26, pillar autonomy; patch: a fix): evReview dedupes its escalation by the ledger fingerprint (fp=<fingerprint>; in the description) instead of the ledger title, which embeds a changing count and filed a new agent_issues row on every change; the row now carries source qnfo-observability:evReview and category reliability (it had NULL). // 1.5.2 // 1.5.1 CRON-GRID-1 (owner directive 2026-10-19: every cron tick on the 5-minute grid, none slower than hourly): trigger minute moved onto the 5-minute grid (:17 -> :15; the folded scorer still runs on the 05:xx fire). // 1.4.7 WORKERS-BP-LOGGING-qnfo-observability-1 (2026-10-14, agent_issues 2537, child of 2342, pillar autonomy): the 9 lines scripts/fleet_best_practices_audit.py counted as swallowed-catch (liveFleet, six reads and writes in assessIntegration, the scorer member's two alert writes) log a structured console.error (worker, where, error), so the failure reaches Workers Logs; control flow unchanged (no rethrow, a handler that was empty still returns undefined). // 1.4.6 OUTREACH-CHAIN-ENUM-2 (2026-10-14, pillar core): the outreach chain counts needs-contact, the status radar-hub writes and qnfo-cloud-ops drains (the dashboard showed it empty-match, DEGRADED). // 1.4.5 CRON-ONLY-HEARTBEAT-1 (2026-10-13, agent_issues 2397, pillar autonomy): each hourly scheduled run ends with a qnfo-audit fleet_heartbeat upsert (ok=0 when the run threw); write errors are logged. 1.4.4 WORKER-LOGS-SAMPLED-ERROR-VISIBILITY-1 (2026-10-12, agent_issues 1223, pillar autonomy): the digest's error ratio divides captured failures by the script's requests in the worker_usage_daily census (worker_logs holds failures only, so its self-ratio alerted "100%" hourly for idea-hub, qnfo-ai-search and qnfo-gateway); client disconnects are not failures; the digest and /fleet/summary state the log contract. // 1.4.3 NO-SILENT-DROP-1 (2026-10-08, pillar autonomy; owner directive "The system shall never silently drop issues"): evReview escalates an issue_ledger incident unless an OPEN agent_issue has its title; before this, any issue with the title in any status (a closed one included) swallowed every recurrence. // 1.4.0 WATCHMAKER-INVERTED-MEASURED-1 (agent_issues 2027) + SAI-KAIZEN-GRADIENT-1 (agent_issues 2054), pillar autonomy: the scorer member writes watchmaker_inverted as a MEASURED dimension, 5 x (1 - counted/ops) from the latest watchmaker_runs row (was a hand score of 4.8 from 2026-09-24, past due), and computeSai's kaizen term is 1 / (1 + step x open issues), keeping a gradient at every backlog size, in parity with qnfo-fleet-dashboard. 1.3.2 FOLD-HYGIENE-1 (#1756): the public /scorer/preview logs a failure and answers "preview failed" instead of the exception text (CodeQL js/stack-trace-exposure, PR 668). 1.3.1 SCORER-FOLD-1 (#1756): qnfo-autonomy-scorer runs here as a member (05:17 UTC daily, awaited; /scorer/* read routes). 1.2.16 FIX-ALERTS-DIGEST-CONSUMER: mark digest anomaly alerts consumed
const NAME = 'qnfo-observability';
const KNOWN = new Set(FLEET);
// FLEET-SIZE-LIVE-1 (2026-09-23): derive the fleet set from the LIVE service_registry (census
// authority) instead of the hardcoded snapshot above. The snapshot carried 10 ghosts + was missing
// 9 live workers, so workers_silent_24h reported phantom silent workers and fleet_size was stale.
// FLEET is retained only as a fallback when the registry read fails.
async function liveFleet(env) {
  try {
    const r = await env.AUDIT.prepare("SELECT service FROM service_registry WHERE state='live'").all();
    const names = (r.results || []).map(function (x) { return x.service; });
    if (names.length) return names;
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-observability", where: "liveFleet", error: String(e && e.message || e).slice(0, 300) })); }
  return FLEET;
}
const INGEST_CAP_FILES = 300;   // max R2 files processed per run (CPU bound)
const RETENTION_DAYS = 30;      // worker_logs retention window
const EMPTY_MATCH_MIN_TOTAL = 20; // rows in the medium before an empty match is suspicious
const UA = 'qnfo-observability/' + VERSION;
// WAE-FLEET-1 (2026-10-18): Workers Analytics Engine write layer. Dataset qnfo_fleet via binding FLEET_ANALYTICS.
// fire-and-forget (never awaited), guarded against a missing binding, never throws — WAE must not fail a request.
function writeFleet(env, blobs, doubles, index) {
  try { if (env.FLEET_ANALYTICS) env.FLEET_ANALYTICS.writeDataPoint({ blobs: blobs, doubles: doubles, indexes: [String(index || NAME).slice(0, 96)] }); }
  catch (e) { /* best-effort: swallow */ }
}

function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } }); }
function nowIso() { return new Date().toISOString(); }

// PRECONDITION: str is a raw logpush JSON line. POSTCONDITION: stable base36 hash used as dedupe key.
function fnv1a(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }

// PRECONDITION: env.AUDIT is qnfo-audit D1. POSTCONDITION: worker_logs + trace_ingest_state + unique hash index exist.
async function ensureSchema(env) {
  await env.AUDIT.prepare(`CREATE TABLE IF NOT EXISTS worker_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_hash TEXT UNIQUE NOT NULL,
    ts_ms INTEGER NOT NULL,
    ingested_at TEXT NOT NULL,
    script_name TEXT NOT NULL,
    event_type TEXT,
    outcome TEXT,
    url TEXT,
    method TEXT,
    status INTEGER,
    cpu_ms REAL,
    wall_ms REAL,
    logs_json TEXT,
    exceptions_json TEXT
  )`).run();
  await env.AUDIT.prepare('CREATE INDEX IF NOT EXISTS idx_worker_logs_script_ts ON worker_logs(script_name, ts_ms)').run();
  await env.AUDIT.prepare('CREATE INDEX IF NOT EXISTS idx_worker_logs_ts ON worker_logs(ts_ms)').run();
  await env.AUDIT.prepare('CREATE TABLE IF NOT EXISTS trace_ingest_state (k TEXT PRIMARY KEY, v TEXT)').run();
  await env.AUDIT.prepare('CREATE TABLE IF NOT EXISTS integration_state (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, json TEXT)').run();
}

// PRECONDITION: schema ensured. POSTCONDITION: cursor key persisted.
async function getCursor(env) {
  const r = await env.AUDIT.prepare('SELECT v FROM trace_ingest_state WHERE k = ?').bind('last_key').first();
  return r ? r.v : '';
}

async function setCursor(env, key) {
  await env.AUDIT.prepare('INSERT INTO trace_ingest_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind('last_key', key).run();
}

// PRECONDITION: gz Uint8Array from R2. POSTCONDITION: decompressed UTF-8 text (DecompressionStream is Workers-runtime native).
async function gunzip(buf) {
  const ds = new DecompressionStream('gzip');
  const stream = new Response(new Blob([buf])).body.pipeThrough(ds);
  return await new Response(stream).text();
}

// PRECONDITION: line = one logpush record JSON. POSTCONDITION: normalized row params or null on parse failure.
function parseLine(line, ingestedAt) {
  if (!line || !line.trim()) return null;
  let r; try { r = JSON.parse(line); } catch (e) { return null; }
  const ev = r.Event || {};
  const req = ev.Request || {};
  const resp = ev.Response || {};
  const hash = fnv1a(line);
  return {
    hash,
    ts: Number(r.EventTimestampMs) || 0,
    ingestedAt,
    script: String(r.ScriptName || '').slice(0, 120),
    type: String(r.EventType || '').slice(0, 60),
    outcome: String(r.Outcome || '').slice(0, 60),
    url: String(req.URL || '').slice(0, 400),
    method: String(req.Method || '').slice(0, 12),
    status: resp.Status == null ? null : Number(resp.Status),
    cpu: r.CPUTimeMs == null ? null : Number(r.CPUTimeMs),
    wall: r.WallTimeMs == null ? null : Number(r.WallTimeMs),
    logs: (r.Logs && r.Logs.length) ? JSON.stringify(r.Logs).slice(0, 2000) : null,
    exc: (r.Exceptions && r.Exceptions.length) ? JSON.stringify(r.Exceptions).slice(0, 2000) : null,
  };
}

// PRECONDITION: R2 binding LOGS -> bucket qnfo-audit. POSTCONDITION: returns {files, inserted, dupes, errors, lastKey}.
// INVARIANT: cursor advances only past fully-processed files; dedupe via UNIQUE event_hash + INSERT OR IGNORE.
async function ingestTrace(env) {
  await ensureSchema(env);
  const cursor0 = await getCursor(env);
  // v1.0.1: first run starts at the 72h-ago boundary so the backlog drains fast (older raw gz stay in R2)
  const cutoff = 'workers_trace/' + new Date(Date.now() - 72 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const cursor = cursor0 || cutoff;
  let listed;
  try { listed = await env.LOGS.list({ prefix: 'workers_trace/', limit: 1000, startAfter: cursor }); } catch (e) { return { files: 0, inserted: 0, dupes: 0, errors: 1, lastKey: cursor, note: 'list failed: ' + e.message }; }
  const files = (listed.objects || [])
    .map(o => o.key)
    .filter(k => k.endsWith('.log.gz') && !k.includes('/test'))
    .filter(k => k > cursor)
    .sort()
    .slice(0, INGEST_CAP_FILES);
  let inserted = 0, dupes = 0, errors = 0, filesDone = 0, lastKey = cursor;
  const ingestedAt = nowIso();
  for (const key of files) {
    try {
      const obj = await env.LOGS.get(key);
      if (!obj) { continue; }
      const buf = new Uint8Array(await obj.arrayBuffer());
      const text = await gunzip(buf);
      for (const line of text.split('\n')) {
        const row = parseLine(line, ingestedAt);
        if (!row) continue;
        const res = await env.AUDIT.prepare('INSERT OR IGNORE INTO worker_logs (event_hash, ts_ms, ingested_at, script_name, event_type, outcome, url, method, status, cpu_ms, wall_ms, logs_json, exceptions_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(row.hash, row.ts, row.ingestedAt, row.script, row.type, row.outcome, row.url, row.method, row.status, row.cpu, row.wall, row.logs, row.exc).run();
        if (res.meta && res.meta.changes) inserted++; else dupes++;
      }
      lastKey = key;
      filesDone++;
      // v1.0.1: persist cursor every 25 files so interrupted runs retain progress
      if (filesDone % 25 === 0 && lastKey !== cursor) await setCursor(env, lastKey);
    } catch (e) {
      errors++;
    }
  }
  if (lastKey !== cursor) await setCursor(env, lastKey);
  // RETENTION: delete rows older than window (cheap on indexed ts_ms).
  await env.AUDIT.prepare('DELETE FROM worker_logs WHERE ts_ms < ?').bind(Date.now() - RETENTION_DAYS * 86400000).run();
  return { files: files.length, inserted, dupes, errors, lastKey };
}

// PRECONDITION: worker_logs populated. POSTCONDITION: cloud_ops_events digest row + alerts for error-ratio anomalies.
// WORKER-LOGS-SAMPLED-ERROR-VISIBILITY-1 (1.4.4, agent_issues 1223). worker_logs is not a census of invocations: since
// qnfo-ops ERROR-DETAIL-CAPTURE-1 it holds the failed events copied from Workers Logs (event_type telemetry:*) plus the
// Logpush rows of the few scripts that opt in. Dividing its bad rows by its own row count therefore read 100% for every
// script with 20 captured failures (2026-10-12 05:17Z: idea-hub 78/78, qnfo-ai-search 78/78, qnfo-gateway 26/26, against
// 607, 944 and 7497 requests in the unsampled census). The ratio's denominator is now the script's requests_24h in the
// latest worker_usage_daily census; a script with captured failures and no census row is listed as unrated, never
// alerted on a self-ratio; a client disconnect (outcome canceled) is counted apart, not as a failure.
var LOG_CONTRACT = "worker_logs holds failed events only (telemetry:* rows copied from Workers Logs by qnfo-ops) plus Logpush rows of opted-in scripts; it is not an invocation census. Request and error totals come from worker_usage_daily (Cloudflare analytics, unsampled). A script absent from worker_logs had no captured failure; it is not silent.";
async function usageCensus(env) {
  try {
    const r = await env.AUDIT.prepare("SELECT day, script, requests_24h, errors_24h FROM worker_usage_daily WHERE day = (SELECT MAX(day) FROM worker_usage_daily)").all();
    const by = {}; let day = null;
    for (const x of (r.results || [])) { by[x.script] = { requests: Number(x.requests_24h) || 0, errors: Number(x.errors_24h) || 0 }; day = x.day; }
    return { day: day, by: by };
  } catch (e) {
    console.error(JSON.stringify({ at: "usage-census", error: String(e && e.message || e).slice(0, 200) }));
    return { day: null, by: {} };
  }
}
// TELEMETRY-AGREEMENT-1 (RM-BS-SELF-REPORTING-PLATFORM-1, blue-sky B12, pillar reliability): two failure signals describe each worker, the platform's own invocation census
// (worker_usage_daily, Cloudflare GraphQL) and the failed events copied into worker_logs. The roadmap retires the copy only after they are measured to agree, so the digest
// states, per worker, which one sees failures the other does not. capture_blind = the platform counts failures and worker_logs holds none (a Logpush or telemetry-copy gap);
// platform_blind = worker_logs holds failures the platform census does not count (logged errors inside invocations that finished ok, or scheduled-handler exceptions).
function telemetryAgreement(rows, census) {
  const own = {};
  for (const r of rows) own[r.script_name] = Number(r.bad) || 0;
  const names = new Set(Object.keys(own).concat(Object.keys(census.by || {})));
  const out = { compared: 0, agree: 0, differ: 0, capture_blind: [], platform_blind: [], census_day: census.day || null };
  for (const w of names) {
    const c = census.by && census.by[w], plat = c ? Number(c.errors) || 0 : null, cap = own[w] || 0;
    if (plat === null) continue;
    if (plat === 0 && cap === 0) continue;
    out.compared++;
    if (cap === 0 && plat >= 5) out.capture_blind.push({ worker: w, platform: plat, captured: 0, requests: c.requests });
    else if (plat === 0 && cap >= 10) out.platform_blind.push({ worker: w, platform: 0, captured: cap, requests: c.requests });
    else if (Math.max(plat, cap) <= 5 * Math.max(Math.min(plat, cap), 1)) out.agree++;
    else out.differ++;
  }
  out.capture_blind.sort((a, b) => b.platform - a.platform);
  out.platform_blind.sort((a, b) => b.captured - a.captured);
  out.capture_blind = out.capture_blind.slice(0, 10);
  out.platform_blind = out.platform_blind.slice(0, 10);
  return out;
}
async function digest(env, ingestResult) {
  const dayAgo = Date.now() - 86400000;
  const agg = await env.AUDIT.prepare(`SELECT script_name, COUNT(*) n, SUM(CASE WHEN (outcome != 'ok' AND outcome != 'canceled') OR status >= 500 THEN 1 ELSE 0 END) bad, SUM(CASE WHEN outcome = 'canceled' THEN 1 ELSE 0 END) canceled, SUM(CASE WHEN event_type LIKE 'telemetry:%' THEN 1 ELSE 0 END) captured, MAX(ts_ms) last_ts, MAX(status) max_status
    FROM worker_logs WHERE ts_ms >= ? GROUP BY script_name`).bind(dayAgo).all();
  const rows = (agg.results || []);
  const seen = new Set(rows.map(r => r.script_name));
  const fl = await liveFleet(env);
  const census = await usageCensus(env);
  const summary = {
    generated_at: nowIso(),
    version: VERSION,
    ingest: ingestResult,
    log_contract: LOG_CONTRACT,
    census_day: census.day,
    census_scripts: Object.keys(census.by).length,
    total_events_24h: rows.reduce((a, r) => a + r.n, 0),
    workers_seen_24h: rows.length,
    workers_silent_24h: fl.filter(w => !seen.has(w) && !(census.by[w] && census.by[w].requests > 0)),
    workers_without_captured_failures_24h: fl.filter(w => !seen.has(w)).length,
    unrated: [],
    anomalies: [],
    telemetry_agreement: telemetryAgreement(rows, census),
  };
  for (const r of rows) {
    const bad = Number(r.bad) || 0, c = census.by[r.script_name];
    // WAE-FLEET-1: fleet-wide per-worker aggregate (events, errors, canceled) from the Logpush census.
    writeFleet(env, [r.script_name, 'digest-24h', bad > 0 ? 'error' : 'ok'], [Number(r.n) || 0, bad, Number(r.canceled) || 0], r.script_name);
    // A script whose rows are all captured failures has no denominator of its own.
    const selfRated = (Number(r.captured) || 0) < r.n;
    const denom = c && c.requests > 0 ? Math.max(c.requests, r.n) : (selfRated ? r.n : 0);
    if (!denom) { if (bad) summary.unrated.push({ worker: r.script_name, bad: bad, canceled: Number(r.canceled) || 0 }); continue; }
    const ratio = bad / denom;
    if (denom >= 20 && ratio > 0.5) {
      summary.anomalies.push({ worker: r.script_name, events: denom, bad: bad, ratio: Math.round(ratio * 100) / 100, denominator: c && c.requests > 0 ? "worker_usage_daily" : "worker_logs" });
      await env.AUDIT.prepare('INSERT INTO alerts (source, level, message, digested) VALUES (?, ?, ?, "digest")').bind(NAME, 'warning', NAME + ': ' + r.script_name + ' error ratio ' + Math.round(ratio * 100) + '% (' + bad + '/' + denom + ' last 24h)').run();
    }
  }
  // TELEMETRY-AGREEMENT-1: a worker whose failures reach the platform census but never worker_logs would have been invisible to the alert above. The census is the second path.
  for (const g of summary.telemetry_agreement.capture_blind) {
    const ratio = g.requests > 0 ? g.platform / g.requests : 0;
    if (g.requests >= 20 && ratio > 0.5) {
      summary.anomalies.push({ worker: g.worker, events: g.requests, bad: g.platform, ratio: Math.round(ratio * 100) / 100, denominator: "worker_usage_daily", source: "platform-census" });
      await env.AUDIT.prepare('INSERT INTO alerts (source, level, message, digested) VALUES (?, ?, ?, "digest")').bind(NAME, 'warning', NAME + ': ' + g.worker + ' platform error ratio ' + Math.round(ratio * 100) + '% (' + g.platform + '/' + g.requests + ' last 24h, none captured in worker_logs)').run();
    }
  }
  // RECURRENCE-FIX (2026-09-14): id was hour-granular ('fleet-obs-<YYYY-MM-DDTHH>-digest'), so any
  // second call to digest() within the same hour hit a TEXT PRIMARY KEY collision on cloud_ops_events
  // and threw (scriptThrewException x95/24h: cron + repeated /run/ingest). Minute-unique + INSERT OR
  // REPLACE makes the digest idempotent and collision-free.
  const id = 'fleet-obs-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '-digest';
  await env.AUDIT.prepare('INSERT OR REPLACE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, nowIso(), 'fleet-observability-digest', 'Fleet observability digest: ' + rows.length + ' workers logged ' + summary.total_events_24h + ' events in 24h; ' + summary.anomalies.length + ' anomalies', JSON.stringify(summary), NAME, 'ok').run();
  return summary;
}

// PRECONDITION: POST body JSON {worker, event, level?, message?, data?}. POSTCONDITION: worker_logs row with event_type='custom'.
async function logEvent(env, body, req) {
  const w = String(body.worker || '').slice(0, 120);
  if (!w) return json({ ok: false, error: 'worker required' }, 400);
  const row = {
    hash: 'c' + fnv1a(nowIso() + '|' + w + '|' + String(body.event || '') + '|' + crypto.randomUUID()),
    ts: Date.now(),
    ingestedAt: nowIso(),
    script: w,
    type: 'custom:' + String(body.event || 'event').slice(0, 40),
    outcome: 'log',
    url: null, method: null, status: null, cpu: null, wall: null,
    logs: JSON.stringify({ level: String(body.level || 'info').slice(0, 20), message: String(body.message || '').slice(0, 1000), data: body.data ?? null, registered: KNOWN.has(w) }).slice(0, 2000),
    exc: null,
  };
  await ensureSchema(env);
  await env.AUDIT.prepare('INSERT OR IGNORE INTO worker_logs (event_hash, ts_ms, ingested_at, script_name, event_type, outcome, url, method, status, cpu_ms, wall_ms, logs_json, exceptions_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(row.hash, row.ts, row.ingestedAt, row.script, row.type, row.outcome, row.url, row.method, row.status, row.cpu, row.wall, row.logs, row.exc).run();
  return json({ ok: true, hash: row.hash });
}

// === SYSTEM INTEGRATION ASSESSMENT (v1.1.0) ===
// Purpose: measure the fleet as a SYSTEM - cross-worker chains (producer -> consumer -> medium),
// feedback-loop closure, entropy/decay of the system's own bookkeeping, and integration opportunities.
// A worker can be alive while its chain is broken; this layer makes that visible.

function ageHours(iso) {
  if (!iso) return null;
  const t = Date.parse(String(iso));
  if (isNaN(t)) return null;
  return Math.max(0, (Date.now() - t) / 3600000);
}

// Chain definitions: { id, name, producer, consumer, medium, sql, total, max, minOk, want, expectEmpty }
// sql:   counts rows in the PENDING state (must return {n} and optionally {oldest}|{latest}).
// total: counts ALL rows in the medium. Used by the v1.1.5 empty-match guard: if sql matches 0 rows
//        while total >= EMPTY_MATCH_MIN_TOTAL, the chain reports `empty-match` rather than `healthy`,
//        because the pending predicate is more likely stale than the medium is drained.
// max:   pending-items ceiling (above = backpressure/stuck). minOk: minimum expected activity.
// expectEmpty: true when zero pending rows IS the success condition (drained queue), suppressing the
//        empty-match opportunity for that chain.
const INTEGRATION_CHAINS = [
  { id: 'fleet-pulse', name: 'Scheduler -> Executor pulse', producer: 'fleet-scheduler', consumer: 'fleet-executor', medium: 'fleet_runs',
    sql: "SELECT COUNT(*) n, MAX(started_at) latest FROM fleet_runs WHERE julianday(started_at) >= julianday('now','-75 minutes')",
    total: "SELECT COUNT(*) n FROM fleet_runs",
    max: null, minOk: 1, expectEmpty: false, want: '>=1 pulse run / 75min (hourly heartbeat)' },
  { id: 'errata', name: 'Errata watch -> respond -> publish', producer: 'errata-watch / email', consumer: 'errata-respond / errata-publish', medium: 'errata_queue',
    sql: "SELECT COUNT(*) n, MIN(created_at) oldest FROM errata_queue WHERE status NOT IN ('done','published','resolved','superseded','implemented','rejected','no-paper')",
    total: "SELECT COUNT(*) n FROM errata_queue",
    max: 10, minOk: null, expectEmpty: true, want: 'pending <= 10',
    // ERRATA-CHAIN-DRAINING-1 (2026-10-20): the same CHAIN-DRAINING-1 rule the research chain has. A backlog above the ceiling whose consumers moved a row in the last 3 hours is throughput-bound (draining), not stuck;
    // 'stuck' stays for no progress. The terminal statuses rejected and no-paper are no longer counted as pending (one no-paper row from 2026-10-06 made oldest_h read about 14 days).
    progress: "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', MAX(updated_at)) latest FROM errata_queue WHERE updated_at > created_at AND updated_at >= datetime('now','-3 hours')", progressWindowH: 3 },
  { id: 'ideas', name: 'Idea intake -> triage', producer: 'edge form / idea-miner / auto-scan', consumer: 'idea-triage', medium: 'idea_proposals',
    sql: "SELECT COUNT(*) n, MIN(created_at) oldest FROM idea_proposals WHERE status = 'new'",
    total: "SELECT COUNT(*) n FROM idea_proposals",
    max: 30, minOk: null, expectEmpty: true, want: 'new <= 30' },
  { id: 'intents', name: 'Intent intake -> orchestrator', producer: 'calendar-api / edge', consumer: 'qnfo-intent-orchestrator', medium: 'intents',
    sql: "SELECT COUNT(*) n, MIN(created_at) oldest FROM intents WHERE status = 'pending'",
    total: "SELECT COUNT(*) n FROM intents",
    max: 20, minOk: null, expectEmpty: true, want: 'pending <= 20 (0 = drained)' },
  { id: 'version-drain', name: 'Reviser -> research-exec publish drain', producer: 'qnfo-paper-reviser', consumer: 'qnfo-research-exec', medium: 'version_queue',
    // v1.2.4: gate-blocked rows are STUCK (QUALITY-GATE-1), not drained. They were invisible because the
    // chain only counted 'drafted' — a 23-row gate-blocked backlog reported "none". Include them.
    sql: "SELECT COUNT(*) n, MIN(created_at) oldest FROM version_queue WHERE status IN ('drafted','gate-blocked')",
    total: "SELECT COUNT(*) n FROM version_queue",
    max: 5, minOk: null, expectEmpty: true, want: 'drafted+gate-blocked <= 5 (gate-blocked = stuck, QUALITY-GATE-1)' },
  { id: 'outreach', name: 'Outreach queue -> send drain', producer: 'radar-hub / idea-hub / qnfo-cloud-ops', consumer: 'qnfo-cloud-ops (jobOutreach)', medium: 'outreach_queue',
    // STATUS-DRIFT-FIX (2026-09-14): the chain watched 'needs-contact', which NO writer emits. Live writers
    // emit 'pending' (radar-hub, qnfo-cloud-ops) or 'queued' (idea-hub, qnfo-idea-triage — drifted); the
    // consumer (qnfo-cloud-ops jobOutreach) drains 'pending','needs-email'. Watch the real enum.
    // OUTREACH-CHAIN-ENUM-2 (1.4.6, 2026-10-14): radar-hub writes 'needs-contact' again and qnfo-cloud-ops jobOutreach drains
    // 'pending', 'needs-email' and 'needs-contact'; the chain read empty-match (0 of 116) while 12 needs-contact rows waited.
    sql: "SELECT COUNT(*) n, MIN(created_at) oldest FROM outreach_queue WHERE status IN ('pending','needs-email','needs-contact','queued')",
    total: "SELECT COUNT(*) n FROM outreach_queue",
    // OUTREACH-GATE-DERIVE-1 (2026-09-30): want text cited 2026-09-15 as the send gate, but the
    // real gate is qnfo-outreach pipeline_state.external_sends_enabled (read live, currently '1').
    // The candidate ceiling (20) is unchanged; only the rationale is corrected so it never claims
    // a date in the past is still gating sends.
    // OUTREACH-CHAIN-DRAINED-1 (1.5.4, 2026-10-26, agent_issues 100487): zero waiting rows IS this chain's success condition. radar-hub inserts the day's candidates at 09:00:30 UTC and the qnfo-cloud-ops outreach
    // job moves each to sent, skipped-no-email, skipped-dup or held-segment-stopped within the minute (193 rows on 2026-10-26: 102 sent, 27 skipped, 26 skipped-no-email, 25 held-segment-stopped by the learner's
    // recorded stop rule, 13 skipped-dup; 0 waiting), so the empty-match guard read a drained queue as "0 of 193 rows matched ... verify the status enum" every hour and filed an owner task. The enum-drift
    // check the guard stood in for is the live detector fm-outreach-chain-enum (a status outside the known set fails it), so the chain no longer needs the guard.
    max: 20, minOk: null, expectEmpty: true, want: 'pending+needs-email+needs-contact <= 20 (send gate = qnfo-outreach pipeline_state.external_sends_enabled; drain = qnfo-cloud-ops job=outreach, 8/day)' },
  { id: 'issues', name: 'Chat failures -> backlog triage', producer: 'ops gateway', consumer: 'qnfo-lifecycle (qnfo-backlog-exec member)', medium: 'agent_issues',
    // The backlog member is folded into qnfo-lifecycle. Count its supported issue families, not residual prose
    // mentioning health or exceptions; a health ticket is drainable only when it opts in to a worker-process probe.
    sql: "SELECT COUNT(*) n FROM agent_issues WHERE status='open' AND ((((' ' || lower(COALESCE(title,'')) || ' ') GLOB '*[^a-z0-9_]health[^a-z0-9_]*' OR (' ' || lower(COALESCE(title,'')) || ' ') GLOB '*[^a-z0-9_]availability[^a-z0-9_]*' OR (' ' || lower(COALESCE(title,'')) || ' ') GLOB '*[^a-z0-9_]heartbeat[^a-z0-9_]*' OR (' ' || lower(COALESCE(title,'')) || ' ') GLOB '*[^a-z0-9_]unreachable[^a-z0-9_]*' OR (' ' || lower(COALESCE(title,'')) || ' ') GLOB '*[^a-z0-9_]down[^a-z0-9_]*') AND instr(lower(replace(COALESCE(title,'') || ' ' || COALESCE(description,''), ' ', '')), 'probe_target=') > 0 AND instr(lower(replace(COALESCE(title,'') || ' ' || COALESCE(description,''), ' ', '')), 'probe_class=worker-process') > 0) OR title LIKE '%WORKER-EXCEPTION-DETECTED %' OR title LIKE '%ALERT-STORM-DETECTED %' OR title LIKE '%ERROR-BURST %' OR title LIKE '%ERROR-BURST-DETECTED %' OR title LIKE 'MODEL-DEGRADED%' OR title LIKE '[ai-cal] model probe failing:%')",
    total: "SELECT COUNT(*) n FROM agent_issues",
    max: 10, minOk: null, expectEmpty: true, want: 'drainable open <= 10 (opted-in worker health, exception detector, or model-health issue families handled by the qnfo-lifecycle backlog member); residual open defects are tracked elsewhere, not backpressure' },
  { id: 'alerts', name: 'Alerts -> digest consumer', producer: 'fleet (sla-breach, qnfo-fleet-control, qnfo-observability, ...)', consumer: 'qnfo-social alertDigest (0 7 * * *)', medium: 'alerts',
    // v1.2.7: no digest consumer was ever built for the alerts medium (audit 2026-09-21); name it honestly.
    // v1.1.5: was `digested = 0` (0 rows). Live values are TEXT 'auto' (914), INTEGER 1 (141), NULL (45).
    // The column is declared INTEGER but producers write TEXT, so an equality test on 0 can never match.
    // CHAIN-CADENCE-1 (2026-10-01): the consumer exists. qnfo-social alertDigest runs daily at 07:00 UTC and marks up to
    // 100 rows digested=1; it last ran 2026-10-01T07:00 and left nothing older. Counting every undigested row meant the
    // chain read "stuck" each day between digests: 52 rows at 08:45, all raised after 07:00, 44 of them the 08:00
    // SLA-breach batch. Stuck now means rows the daily consumer has missed: undigested and older than 26h.
    sql: "SELECT COUNT(*) n, MIN(created_at) oldest FROM alerts WHERE (digested IS NULL OR digested = '' OR digested = 0) AND created_at < datetime('now','-26 hours')",
    total: "SELECT COUNT(*) n FROM alerts",
    max: 5, minOk: null, expectEmpty: true, want: 'undigested older than 26h <= 5 (daily consumer at 07:00 UTC)' },
  { id: 'email', name: 'Inbound email -> triage', producer: 'SMTP gateway', consumer: 'qnfo-email workers', medium: 'emails',
    sql: "SELECT COUNT(*) n FROM emails WHERE status = 'received'",
    total: "SELECT COUNT(*) n FROM emails",
    max: 10, minOk: null, expectEmpty: true, want: 'unprocessed <= 10 (received unused; 0 = drained)' },
  { id: 'research', name: 'Research queue -> execution', producer: 'supervisor / radars', consumer: 'qnfo-research-exec', medium: 'research_queue',
    // STATUS-DRIFT-FIX (2026-09-26, GOVERNANCE-METRIC-DEFINITION-VERIFY-1): the producer writes status
    // 'queued' (live enum: published=19, queued=9, researching=1, wontfix=27), but the predicate watched
    // 'pending'/'ensemble-draft'/'claimed' -> 0 of 56 matched while 10 were genuinely pending -> a permanent
    // false 'empty-match' warn. Watch the real enum.
    sql: "SELECT COUNT(*) n, MIN(created_at) oldest FROM research_queue WHERE status IN ('queued','pending','researching','ensemble-draft','claimed')",
    total: "SELECT COUNT(*) n FROM research_queue",
    max: 10, minOk: null, expectEmpty: false, want: 'queued/active <= 10',
    // CHAIN-DRAINING-1 (2026-09-30): a backlog above the ceiling whose consumer is demonstrably
    // advancing is throughput-bound, not wired wrong. 'stuck' is reserved for no consumer progress.
    progress: "SELECT MAX(ts) latest FROM cloud_ops_events WHERE job='qnfo-research-exec' AND kind='done' AND status='ok' AND ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 hours')",
    progressWindowH: 3,
    // RESEARCH-CHAIN-HELD-1 (1.5.5): the consumer's own report that the daily budget is spent is a policy pause, not a wiring fault.
    heldBy: "SELECT MAX(ts) latest FROM cloud_ops_events WHERE job='qnfo-research-exec' AND kind='research-budget' AND text LIKE 'daily budget exhausted%' AND ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-45 minutes')" },
  { id: 'revisions', name: 'Revision log -> publish drain', producer: 'qnfo-paper-reviser', consumer: 'qnfo-research-exec', medium: 'paper_revision_log',
    // CHAIN-CADENCE-1: the reviser writes 'queued' when it queues a version, and qnfo-research-exec moves the row to
    // 'published'. 0 queued means drained, not a predicate mismatch. The live enum is already-revised, published,
    // needs-substantive-revision, quarantined, wontfix; queued rows are transient. Flagged "empty-match" otherwise.
    sql: "SELECT COUNT(*) n, MIN(created_at) oldest FROM paper_revision_log WHERE status = 'queued'",
    total: "SELECT COUNT(*) n FROM paper_revision_log",
    max: 8, minOk: null, expectEmpty: true, want: 'queued <= 8 (0 = drained: queued -> published by qnfo-research-exec)' },
];

// RESEARCH-CHAIN-HELD-1: true when the consumer reported a policy hold inside the chain's window; a read error is not a hold.
async function chainHeld(env, c) {
  try { const r = await env.AUDIT.prepare(c.heldBy).first(); return !!(r && r.latest); } catch (e) { return false; }
}
// PRECONDITION: schema ensured. POSTCONDITION: integration_state row appended with latest assessment.
async function assessIntegration(env) {
  const chains = [];
  for (let i = 0; i < INTEGRATION_CHAINS.length; i++) {
    const c = INTEGRATION_CHAINS[i];
    const st = { id: c.id, name: c.name, producer: c.producer, consumer: c.consumer, medium: c.medium, status: 'unknown', n: null, total: null, oldest_h: null, detail: '', metric: (c.id === 'fleet-pulse' ? 'rate' : 'queue') };
    try {
      const r = await env.AUDIT.prepare(c.sql).first();
      // v1.1.5: read the medium size so an empty pending match can be distinguished from a drained queue.
      if (c.total) {
        try { const tr = await env.AUDIT.prepare(c.total).first(); st.total = tr ? Number(tr.n) || 0 : null; } catch (eT) { st.total = null; }
      }
      if (r) {
        st.n = r.n == null ? null : Number(r.n);
        st.oldest_h = ageHours(r.oldest || r.latest);
        let progH = null;
        if (c.max != null && st.n > c.max && c.progress) {
          try { const pr = await env.AUDIT.prepare(c.progress).first(); progH = pr && pr.latest ? ageHours(pr.latest) : null; } catch (eP) { progH = null; }
        }
        if (c.max != null && st.n > c.max && progH != null && progH <= (c.progressWindowH || 3)) {
          st.status = 'draining';
          st.detail = 'draining: ' + st.n + ' waiting above ceiling (' + c.want + '); consumer ' + c.consumer + ' advanced ' + Math.round(progH * 60) + 'm ago';
        }
        else if (c.max != null && st.n > c.max && c.heldBy && await chainHeld(env, c)) {
          st.status = 'draining';
          st.detail = 'held: ' + st.n + ' waiting above ceiling (' + c.want + '); ' + c.consumer + ' reports the daily research budget exhausted (COST-SUSTAIN-1), work resumes at 00:00 UTC';
        }
        else if (c.max != null && st.n > c.max) { st.status = 'stuck'; st.detail = 'backpressure: ' + st.n + ' waiting (' + c.want + ')' + (c.progress ? '; no consumer progress in ' + (c.progressWindowH || 3) + 'h' : ''); }
        else if (c.minOk != null && st.n < c.minOk) { st.status = 'degraded'; st.detail = 'below expected activity (' + c.want + ')'; }
        else if (st.n === 0 && st.total != null && st.total >= EMPTY_MATCH_MIN_TOTAL && !c.expectEmpty) {
          // The pending predicate matched nothing, but the medium is not empty. Either the queue drained
          // or the status enum moved. We cannot tell from here, so we must not assert health.
          st.status = 'empty-match';
          st.detail = '0 of ' + st.total + ' rows matched the pending predicate (' + c.want + ') - verify the status enum, or confirm the queue is genuinely drained';
        }
        else { st.status = 'healthy'; st.detail = c.want; }
      } else {
        st.n = 0; st.status = c.minOk != null ? 'degraded' : 'healthy';
        st.detail = c.minOk != null ? 'no activity in window (' + c.want + ')' : c.want;
      }
    } catch (e) {
      st.detail = 'query error: ' + String(e && e.message ? e.message : e).slice(0, 70);
    }
    chains.push(st);
  }
  let probed = [], traced = [], invocated = [];
  try { const r = await env.AUDIT.prepare("SELECT DISTINCT name FROM fleet_probe_log").all(); probed = (r.results || []).map(function (x) { return x.name; }); } catch (e) { console.error(JSON.stringify({ worker: "qnfo-observability", where: "assessIntegration fleet_probe_log", error: String(e && e.message || e).slice(0, 300) })); }
  try { const r = await env.AUDIT.prepare("SELECT DISTINCT script_name FROM worker_logs").all(); traced = (r.results || []).map(function (x) { return x.script_name; }); } catch (e) { console.error(JSON.stringify({ worker: "qnfo-observability", where: "assessIntegration worker_logs", error: String(e && e.message || e).slice(0, 300) })); }
  try { const r = await env.AUDIT.prepare("SELECT DISTINCT worker_name FROM worker_invocations").all(); invocated = (r.results || []).map(function (x) { return x.worker_name; }); } catch (e) { console.error(JSON.stringify({ worker: "qnfo-observability", where: "assessIntegration worker_invocations", error: String(e && e.message || e).slice(0, 300) })); }
  const probedSet = new Set(probed), tracedSet = new Set(traced), invocatedSet = new Set(invocated);
  // FLEET-SIZE-LIVE-1 (2026-09-13): use live service_registry count instead of hardcoded FLEET array
  var liveFleetNames = FLEET;
  try {
    const lf = await env.AUDIT.prepare("SELECT service FROM service_registry WHERE state='live'").all();
    if (lf && lf.results && lf.results.length) liveFleetNames = lf.results.map(function (x) { return x.service; });
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-observability", where: "assessIntegration service_registry", error: String(e && e.message || e).slice(0, 300) })); }
  const liveSet = new Set(liveFleetNames);
  const fleetSize = liveFleetNames.length;
  const coverage = {
    fleet_size: fleetSize,
    probed: [...probedSet].filter(function (w) { return liveSet.has(w); }).length,
    invocated: [...invocatedSet].filter(function (w) { return liveSet.has(w); }).length,
    traced: [...tracedSet].filter(function (w) { return liveSet.has(w); }).length,
    probe_gap: liveFleetNames.filter(function (w) { return !probedSet.has(w); }).length,
    trace_gap: liveFleetNames.filter(function (w) { return !tracedSet.has(w); }).length,
  };
  const decaySignals = [
    ['cloud_ops_events', 'SELECT MAX(ts) latest FROM cloud_ops_events'],
    ['fleet_probe_log', 'SELECT MAX(ts) latest FROM fleet_probe_log'],
    ['ops_ai_log', 'SELECT MAX(ts) latest FROM ops_ai_log'],
    ['deployment_history', 'SELECT MAX(deployed_at) latest FROM deployment_history'],
    ['self_heal_actions', 'SELECT MAX(ts) latest FROM self_heal_actions'],
    ['issue_ledger', 'SELECT MAX(last_seen) latest FROM issue_ledger'],
  ];
  const decay = [];
  for (let i = 0; i < decaySignals.length; i++) {
    const ds = decaySignals[i];
    try {
      const r = await env.AUDIT.prepare(ds[1]).first();
      decay.push({ signal: ds[0], age_h: ageHours(r && r.latest) });
    } catch (e) {
      decay.push({ signal: ds[0], age_h: null, error: String(e && e.message ? e.message : e).slice(0, 50) });
    }
  }
  const opportunities = [];
  for (let i = 0; i < chains.length; i++) {
    const c = chains[i];
    if (c.status === 'stuck') opportunities.push({ kind: 'backpressure', chain: c.id, text: c.name + ': ' + c.detail + ' (oldest ' + (c.oldest_h == null ? '?' : c.oldest_h.toFixed(1)) + 'h)' });
    if (c.status === 'degraded') opportunities.push({ kind: 'low-activity', chain: c.id, text: c.name + ': ' + c.detail });
    // v1.1.5: surface enum drift as its own signal class, unless empty is the success condition.
    if (c.status === 'empty-match' && !INTEGRATION_CHAINS[i].expectEmpty) opportunities.push({ kind: 'enum-check', chain: c.id, text: c.name + ': ' + c.detail });
    if (c.oldest_h != null && c.oldest_h > 72 && c.status === 'healthy') opportunities.push({ kind: 'stale-item', chain: c.id, text: c.name + ': oldest pending item ' + c.oldest_h.toFixed(1) + 'h old (under count ceiling but stale)' });
  }
  if (coverage.probe_gap > 0) opportunities.push({ kind: 'coverage', text: coverage.probe_gap + ' of ' + fleetSize + ' workers have no liveness probe' });
  if (coverage.trace_gap > 0) opportunities.push({ kind: 'trace-gap', text: 'Logpush trace coverage: ' + coverage.traced + '/' + fleetSize + ' workers emit trace events' });
  const noSignal = liveFleetNames.filter(function (w) { return !probedSet.has(w) && !tracedSet.has(w) && !invocatedSet.has(w); });
  if (noSignal.length > 0) opportunities.push({ kind: 'integration-candidate', text: noSignal.length + ' workers emit no probe/trace/invocation signal: ' + noSignal.slice(0, 8).join(', ') + (noSignal.length > 8 ? ', ...' : '') });
  // v1.1.5: empty-match is deliberately excluded from chainScore - it is an UNKNOWN, not a pass and not
  // a failure. Counting it as healthy is what let five stale predicates report green for days.
  const chainVals = chains.filter(function (c) { return c.status === 'healthy' || c.status === 'draining' || c.status === 'stuck' || c.status === 'degraded'; });
  const chainScore = chainVals.length ? chainVals.reduce(function (a, c) { return a + (c.status === 'healthy' ? 1 : c.status === 'draining' ? 0.75 : c.status === 'degraded' ? 0.5 : 0); }, 0) / chainVals.length : null;
  const coverageScore = Math.min(1, (coverage.probed / Math.max(1, fleetSize)) * 0.6 + (coverage.traced / Math.max(1, fleetSize)) * 0.4);
  const decVals = decay.filter(function (d) { return d.age_h != null; });
  const freshnessScore = decVals.length ? decVals.reduce(function (a, d) { return a + Math.max(0, 1 - d.age_h / 48); }, 0) / decVals.length : null;
  let total = null;
  if (chainScore != null && freshnessScore != null) {
    total = Math.round(100 * (0.5 * chainScore + 0.3 * coverageScore + 0.2 * freshnessScore));
  }
  const score = {
    total: total,
    chains: chainScore == null ? null : Math.round(chainScore * 100),
    coverage: Math.round(coverageScore * 100),
    freshness: freshnessScore == null ? null : Math.round(freshnessScore * 100),
    weights: 'chains 50% / coverage 30% / freshness 20%',
    note: 'v1.1.5: chains in empty-match are excluded from chainScore (unknown, not healthy)',
  };
  const summary = { generated_at: new Date().toISOString(), version: VERSION, fleet_size: fleetSize, chains: chains, coverage: coverage, decay: decay, opportunities: opportunities, score: score };
  try {
    await env.AUDIT.prepare('INSERT INTO integration_state (ts, json) VALUES (?, ?)').bind(summary.generated_at, JSON.stringify(summary)).run();
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-observability", where: "assessIntegration integration_state", error: String(e && e.message || e).slice(0, 300) })); }
  // PROACTIVE (v1.1.1): score-regression self-alert - the objective function polices its own drops.
  try {
    const prev = await env.AUDIT.prepare('SELECT json FROM integration_state ORDER BY id DESC LIMIT 1 OFFSET 1').first();
    if (prev && prev.json) {
      const prevS = JSON.parse(prev.json);
      const prevTotal = prevS && prevS.score && typeof prevS.score.total === 'number' ? prevS.score.total : null;
      if (prevTotal != null && score.total != null && prevTotal - score.total >= 5) {
        const id = 'proactive-sai-drop-' + new Date().toISOString().slice(0, 13);
        const exists = await env.AUDIT.prepare("SELECT id FROM cloud_ops_events WHERE id = ?1").bind(id).first();
        if (!exists) {
          await env.AUDIT.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, ?2, 'proactive-alert', ?3, ?4, 'qnfo-observability', 'ok')").bind(id, new Date().toISOString(), 'System integration score dropped ' + prevTotal + ' -> ' + score.total + ' (>=5 points). Investigate chains/coverage/decay regression.', JSON.stringify({ prev: prevTotal, now: score.total })).run();
        }
      }
    }
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-observability", where: "assessIntegration score-regression alert", error: String(e && e.message || e).slice(0, 300) })); }
  return summary;
}

// === MERGED: qnfo-events v1.1.0 (issue ledger + event ingest) ===
function evNorm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function evHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
function evFingerprint(ev) { return ev.fingerprint && String(ev.fingerprint).trim() || evHash(evNorm(ev.source) + '|' + evNorm(ev.category) + '|' + evNorm(ev.title)); }
async function evEnsureSchema(env) {
  await env.AUDIT.prepare('CREATE TABLE IF NOT EXISTS issue_ledger (fingerprint TEXT PRIMARY KEY, source TEXT, level TEXT, category TEXT, title TEXT, status TEXT DEFAULT \'open\', first_seen TEXT, last_seen TEXT, occurrences INTEGER DEFAULT 1, last_detail TEXT, updated_at TEXT)').run();
  await env.AUDIT.prepare('CREATE TABLE IF NOT EXISTS issue_events (id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT, source TEXT, level TEXT, category TEXT, title TEXT, detail TEXT, ts TEXT)').run();
  await env.AUDIT.prepare('CREATE INDEX IF NOT EXISTS idx_issue_ledger_status ON issue_ledger(status)').run();
}
function evOkAuth(req, env) {
  const t = env.EVENTS_TOKEN || ''; if (!t) return true;
  const h = req.headers.get('Authorization') || ''; if (!h.startsWith('Bearer ')) return false;
  const a = h.slice(7), b = t; if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
async function evIngest(env, ev) {
  await evEnsureSchema(env);
  const fp = evFingerprint(ev); const now = new Date().toISOString();
  const level = String(ev.level || 'info').toLowerCase();
  const source = String(ev.source || 'unknown').slice(0, 80);
  const category = String(ev.category || 'general').slice(0, 60);
  const title = String(ev.title || '').slice(0, 300);
  const detail = String(ev.detail || '').slice(0, 4000);
  const ts = String(ev.ts || now).slice(0, 40);
  const exist = await env.AUDIT.prepare('SELECT fingerprint FROM issue_ledger WHERE fingerprint=?1').bind(fp).first();
  let created = false;
  if (!exist) { created = true; await env.AUDIT.prepare('INSERT INTO issue_ledger (fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences, last_detail, updated_at) VALUES (?1,?2,?3,?4,?5,\'open\',?6,?6,1,?7,?6)').bind(fp, source, level, category, title, ts, detail).run(); }
  else { await env.AUDIT.prepare('UPDATE issue_ledger SET occurrences = occurrences + 1, last_seen = ?1, last_detail = ?2, updated_at = ?1 WHERE fingerprint = ?3').bind(ts, detail, fp).run(); }
  await env.AUDIT.prepare('INSERT INTO issue_events (fingerprint, source, level, category, title, detail, ts) VALUES (?1,?2,?3,?4,?5,?6,?7)').bind(fp, source, level, category, title, detail, ts).run();
  const row = await env.AUDIT.prepare('SELECT fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences FROM issue_ledger WHERE fingerprint=?1').bind(fp).first();
  return { created, issue: row };
}
async function evSetStatus(env, fp, status, note) {
  await evEnsureSchema(env);
  const row = await env.AUDIT.prepare('SELECT fingerprint FROM issue_ledger WHERE fingerprint=?1').bind(fp).first();
  if (!row) return { error: 'not found' };
  await env.AUDIT.prepare('UPDATE issue_ledger SET status=?1, last_detail=COALESCE(?2,last_detail), updated_at=?3 WHERE fingerprint=?4').bind(status, String(note || '').slice(0, 1000) || null, new Date().toISOString(), fp).run();
  return { ok: true };
}
async function evSweep(env) {
  await evEnsureSchema(env); let alertsN = 0, coeN = 0;
  try {
    const alerts = await env.AUDIT.prepare("SELECT id, source, level, message, created_at FROM alerts WHERE julianday(created_at) > julianday('now','-2 day') ORDER BY id ASC").all();
    for (const a of alerts.results || []) {
      const key = 'src:alert:' + a.id; const seen = await env.AUDIT.prepare('SELECT id FROM issue_events WHERE detail=?1 LIMIT 1').bind(key).first(); if (seen) continue;
      const fp = 'alert:' + evHash(evNorm(a.source || 'unknown') + '|' + evNorm(a.message || '').slice(0, 180));
      const lvl = a.level === 'HIGH' ? 'high' : String(a.level || 'warning').toLowerCase(); const now = new Date().toISOString();
      const ex = await env.AUDIT.prepare('SELECT fingerprint FROM issue_ledger WHERE fingerprint=?1').bind(fp).first();
      if (!ex) await env.AUDIT.prepare("INSERT INTO issue_ledger (fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences, last_detail, updated_at) VALUES (?1,?2,?3,'alert','AUTO-SWEEP: ' || substr(?4,1,220),'open',?5,?5,1,?4,?5)").bind(fp, String(a.source || 'unknown').slice(0, 80), lvl, String(a.message || ''), now).run();
      else await env.AUDIT.prepare('UPDATE issue_ledger SET occurrences=occurrences+1, last_seen=?1, last_detail=?2, updated_at=?1 WHERE fingerprint=?3').bind(now, String(a.message || '').slice(0, 1000), fp).run();
      await env.AUDIT.prepare("INSERT INTO issue_events (fingerprint, source, level, category, title, detail, ts) VALUES (?1,?2,?3,'alert','AUTO-SWEEP',?4,?5)").bind(fp, String(a.source || 'unknown').slice(0, 80), lvl, key, now).run(); alertsN++;
    }
  } catch (e) { alertsN = -1; }
  try {
    const coe = await env.AUDIT.prepare("SELECT id, kind, text, job, status, ts FROM cloud_ops_events WHERE julianday(ts) > julianday('now','-2 day') AND status IN ('error','partial','failed') ORDER BY ts ASC").all();
    for (const c of coe.results || []) {
      const key = 'src:coe:' + c.id; const seen = await env.AUDIT.prepare('SELECT id FROM issue_events WHERE detail=?1 LIMIT 1').bind(key).first(); if (seen) continue;
      const fp = 'coe:' + evHash(evNorm(c.job || c.kind || 'unknown') + '|' + evNorm(c.text || '').slice(0, 180)); const now = new Date().toISOString();
      const ex = await env.AUDIT.prepare('SELECT fingerprint FROM issue_ledger WHERE fingerprint=?1').bind(fp).first();
      if (!ex) await env.AUDIT.prepare("INSERT INTO issue_ledger (fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences, last_detail, updated_at) VALUES (?1,?2,'error','cloud-ops','AUTO-SWEEP: ' || substr(?3,1,220),'open',?4,?4,1,?3,?4)").bind(fp, String(c.job || c.kind || 'unknown').slice(0, 80), String(c.text || ''), now).run();
      else await env.AUDIT.prepare('UPDATE issue_ledger SET occurrences=occurrences+1, last_seen=?1, last_detail=?2, updated_at=?1 WHERE fingerprint=?3').bind(now, String(c.text || '').slice(0, 1000), fp).run();
      await env.AUDIT.prepare("INSERT INTO issue_events (fingerprint, source, level, category, title, detail, ts) VALUES (?1,?2,'error','cloud-ops','AUTO-SWEEP',?3,?4)").bind(fp, String(c.job || c.kind || 'unknown').slice(0, 80), key, now).run(); coeN++;
    }
  } catch (e) { coeN = -1; }
  return { alertsN, coeN };
}
async function evReview(env) {
  await evEnsureSchema(env); const now = new Date().toISOString(); const out = { reviewed: 0, escalated: 0, staleResolved: 0 };
  try {
    const open = await env.AUDIT.prepare("SELECT fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences FROM issue_ledger WHERE status IN ('open','acknowledged') ORDER BY last_seen ASC").all();
    const rows = open.results || []; out.reviewed = rows.length;
    const ago = (iso, hours) => { try { return Date.now() - new Date(iso).getTime() > hours * 3600000; } catch (e) { return false; } };
    for (const it of rows) {
      const fp = it.fingerprint; const occ = it.occurrences || 1; const src = String(it.source || '');
      if (occ >= 3 && (it.level === 'high' || it.level === 'error')) {
        // ISSUE-HYGIENE-1 (1.5.3): the escalation is keyed by the LEDGER FINGERPRINT, not by the ledger title. A title can embed a changing count
        // ("[self-heal] tool git_clone_exec failing x4 (20.0% of 20 calls in 6h)"), so the title match filed a new issue each time the count moved
        // (four copies of one resolved ledger row on 2026-10-25, all with a NULL source) and nothing closed them. The fingerprint travels in the
        // description as "fp=<fingerprint>;" so a later run, and the hourly workflow issue-meta-fold, find the ticket of a ledger row exactly.
        const fpTag = 'fp=' + fp + ';';
        const dup = await env.AUDIT.prepare("SELECT id FROM agent_issues WHERE status = 'open' AND (title = ?1 OR instr(COALESCE(description, ''), ?2) > 0)").bind(String(it.title || '').slice(0, 180), fpTag).first(); /* NO-SILENT-DROP-1 (1.4.3): only an open issue suppresses the escalation; a closed one used to swallow every recurrence, and an insert now reopens it (D1 trigger issue_refile_reopen) */
        if (!dup) { await env.AUDIT.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) VALUES (?1, ?2, 'qnfo-observability:evReview', 'reliability', 'high', 'open', ?3, ?3)").bind(String(it.title || '').slice(0, 180), ('AUTO-ESCALATION from evReview ' + now + ' - ' + occ + 'x, src ' + src).slice(0, 440) + ', ' + fpTag, Date.now()).run(); out.escalated++; }
      } else if (it.status === 'acknowledged' && ago(it.last_seen, 24) && occ <= 2) {
        await env.AUDIT.prepare("UPDATE issue_ledger SET status='resolved', resolved_at=?1, last_detail='auto-resolved (stale acknowledged)', updated_at=?1 WHERE fingerprint=?2").bind(now, fp).run(); out.staleResolved++;
      } else if (ago(it.last_seen, 72) && occ <= 2 && (it.level === 'info' || it.level === 'warning')) {
        await env.AUDIT.prepare("UPDATE issue_ledger SET status='resolved', resolved_at=?1, last_detail='auto-resolved (stale, no repeat)', updated_at=?1 WHERE fingerprint=?2").bind(now, fp).run(); out.staleResolved++;
      }
    }
  } catch (e) { out.error = String(e && e.message || e).slice(0, 300); }
  return out;
}

// ---- SCORER-FOLD-1 (2026-10-06, agent_issues 1756, owner standing grant / charter rule 9) ----
// qnfo-autonomy-scorer runs here as a member instead of as its own worker (fleet_budget workers over the cap of 30). Its
// code is its worker.js 1.2.1 unchanged except for the version constant; it keeps WORKER = "qnfo-autonomy-scorer", so
// autonomy_scores, autonomy_score_history, survival_state.sai, fleet_heartbeat and alerts keep their writer. It runs once a
// day on this worker's hourly "17 * * * *" tick at 05:17 UTC (its old "17 5 * * *"), and its read-only routes are served
// at /scorer/health, /scorer/preview and /scorer/scores. Its header (why, scope, SAI formula) is in
// qnfo-autonomy-scorer/worker.js; edit the member here, the directory there is FOLDED.
var SCORER_VERSION = "1.3.0-wm-measured";
var scorerMod = (function() {
  var VERSION = SCORER_VERSION; // member version (SCORER-FOLD-1); was 1.2.1-priority-queue as its own worker
  // PRIORITY-QUEUE-1 (2026-10-03, owner directive "dates aren't important, the order of priority is"): the OODA decide stage
  // no longer counts issues past an SLA date (every issue is now due on arrival and worked in v_issue_queue order). It counts
  // open issues with no next action: no code-task line, no active remediation contract, no triage remediation. Stricter.
  var WORKER = "qnfo-autonomy-scorer";
  var DAY = 86400000;
  var SAI_TERMS = ["autonomy", "thinking", "decision", "self_improv", "reliability", "integration", "external_impact", "governance"];
  var SAI_STATE_MAX_AGE_MS = 6 * 3600000;
  // Rows this worker derives from the others; never inputs to the mean or to the SAI.
  var COMPOSITE_DIMS = { overall: true, sai_weighted: true };
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function pct(x) { return Math.round(x * 1000) / 10; }
  function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
  // Pure: facts -> measured dimensions. No I/O, so it is unit-testable.
  function scoreFromFacts(f, nowMs) {
    var out = [];
    var depTotal = f.dep_ok + f.dep_fail;
    var depRatio = depTotal > 0 ? f.dep_ok / depTotal : null;
    var syncTotal = f.sync_n + f.drift_n;
    var syncRatio = syncTotal > 0 ? f.sync_n / syncTotal : null;
    if (depRatio !== null && syncRatio !== null) {
      out.push({
        dimension: "s3_control", framework: "VSM",
        score: r1(5 * (0.5 * depRatio + 0.5 * syncRatio)),
        evidence: "MEASURED: canonical deploys last 7d " + f.dep_ok + " ok / " + f.dep_fail + " failed (" + pct(depRatio) + "%); live==repo " + f.sync_n + " SYNC / " + f.drift_n + " DRIFT across deployable workers (" + pct(syncRatio) + "%). score = 5 x (0.5 x deploy_ok + 0.5 x sync).",
        gap: depRatio < syncRatio ? "deploy failures in the last 7d (" + f.dep_fail + ")" : (f.drift_n ? f.drift_n + " worker(s) drifted from repo" : "none measured"),
        confidence: depTotal >= 20 ? "high" : "medium"
      });
    }
    var healActed = f.heal_acted;
    if (healActed > 0) {
      var hr = f.heal_good / healActed;
      var healDim = {
        framework: "fleet", score: r1(5 * hr),
        evidence: "MEASURED: self_heal_actions last 7d, excluding no-action and superseded rows: " + f.heal_good + " of " + healActed + " acted rows verified and not failed (" + pct(hr) + "%).",
        gap: healActed - f.heal_good ? (healActed - f.heal_good) + " acted row(s) unverified or failed" : "none measured",
        confidence: healActed >= 20 ? "high" : "medium"
      };
      out.push(Object.assign({ dimension: "self_healing" }, healDim));
      out.push(Object.assign({ dimension: "self_heal" }, healDim));
    }
    // FM-4: file rate vs close rate, plus absolute backlog pressure against a ceiling of 50 open issues.
    var closeRate = f.filed7 > 0 ? Math.min(1, f.closed7 / f.filed7) : 1;
    var pressure = 1 / (1 + Math.max(0, f.open_now - 50) / 50);
    out.push({
      dimension: "issue_flow", framework: "fleet", score: r1(5 * closeRate * pressure),
      evidence: "MEASURED (FM-4 backpressure): last 7d filed " + f.filed7 + ", closed " + f.closed7 + " (close rate " + pct(closeRate) + "%); open now " + f.open_now + " vs ceiling 50 (pressure factor " + r1(pressure * 100) / 100 + "). score = 5 x close_rate x pressure.",
      gap: f.open_now > 50 ? "open backlog " + f.open_now + " above ceiling 50" : (closeRate < 1 ? "closing slower than filing" : "none measured"),
      confidence: f.filed7 >= 10 ? "high" : "medium"
    });
    // ---- VSM S1, S2, S3*, S4, S5 ----
    var liveRatio = f.live_n > 0 ? f.live_ok / f.live_n : null;
    if (liveRatio !== null) {
      var pubRatio = Math.min(1, f.pub30 / 30);
      out.push({
        dimension: "s1_operations", framework: "VSM", score: r1(5 * liveRatio * (0.5 + 0.5 * pubRatio)),
        evidence: "MEASURED: operational units serving " + f.live_ok + "/" + f.live_n + " (worker_live_audit http=200 among deployable workers, " + pct(liveRatio) + "%); research published last 30d " + f.pub30 + " vs mission target 30 (one per day). score = 5 x serving x (0.5 + 0.5 x min(1, pub30/30)).",
        gap: pubRatio < 1 ? "publishing " + f.pub30 + "/30 per 30d" : (f.live_ok < f.live_n ? (f.live_n - f.live_ok) + " unit(s) not serving" : "none measured"),
        confidence: "high"
      });
    }
    var syncT = f.sync_n + f.drift_n;
    var fgT = f.fg_fresh + f.fg_stale;
    if (syncT > 0 && fgT > 0) {
      var s2 = 0.5 * (f.sync_n / syncT) + 0.5 * (f.fg_fresh / fgT);
      out.push({
        dimension: "s2_coordination", framework: "VSM", score: r1(5 * s2),
        evidence: "MEASURED: shared-state coherence. live==repo " + f.sync_n + "/" + syncT + "; freshness_guard shared registers fresh " + f.fg_fresh + "/" + fgT + " (stale " + f.fg_stale + "). score = 5 x (0.5 x sync + 0.5 x fresh).",
        gap: f.fg_stale ? f.fg_stale + " shared register(s) stale" : (f.drift_n ? f.drift_n + " worker(s) drifted" : "none measured"),
        confidence: "medium"
      });
    }
    if (f.guards_n > 0) {
      out.push({
        dimension: "s3_star_audit", framework: "VSM", score: r1(5 * f.guards_ok / f.guards_n),
        evidence: "MEASURED: guard_registry " + f.guards_ok + "/" + f.guards_n + " guards status=verified with a negative test. score = 5 x verified/total.",
        gap: f.guards_n - f.guards_ok ? (f.guards_n - f.guards_ok) + " guard(s) unverified" : "none measured",
        confidence: "medium"
      });
    }
    if (f.sig30 > 0) {
      out.push({
        dimension: "s4_intelligence", framework: "VSM", score: r1(5 * f.sig30_done / f.sig30),
        evidence: "MEASURED: environment signals last 30d (expired orphans excluded) " + f.sig30 + ", triaged (status != new) " + f.sig30_done + " (" + pct(f.sig30_done / f.sig30) + "%). score = 5 x triaged/received.",
        gap: f.sig30 - f.sig30_done ? (f.sig30 - f.sig30_done) + " signal(s) untriaged" : "none measured",
        confidence: f.sig30 >= 50 ? "high" : "medium"
      });
    }
    if (f.gates_n > 0) {
      out.push({
        dimension: "s5_policy", framework: "VSM", score: r1(5 * f.gates_met / f.gates_n),
        evidence: "MEASURED: identity/impact gates (impact_thresholds) MET " + f.gates_met + "/" + f.gates_n + ". score = 5 x met/total. Business gates cannot be met by engineering alone; see the owner-decision list.",
        gap: f.gates_n - f.gates_met ? (f.gates_n - f.gates_met) + " gate(s) open" : "none measured",
        confidence: "high"
      });
    }
    // ---- OODA: each stage measured; closure is the weakest stage (a loop is as fast as its slowest leg) ----
    var stages = [];
    if (fgT > 0) stages.push(["observe", f.fg_fresh / fgT, "freshness_guard fresh " + f.fg_fresh + "/" + fgT]);
    if (f.open_now > 0) stages.push(["orient", f.triaged / f.open_now, "open issues triaged " + f.triaged + "/" + f.open_now]);
    else stages.push(["orient", 1, "no open issues"]);
    if (f.triaged > 0) stages.push(["decide", 1 - f.breached / f.triaged, "open issues with a next action (code task, active closing contract or remediation) " + (f.triaged - f.breached) + "/" + f.triaged]);
    var actR = f.filed7 > 0 ? Math.min(1, f.closed7 / f.filed7) : 1;
    stages.push(["act", actR, "7d closed/filed " + f.closed7 + "/" + f.filed7]);
    var weakest = null;
    for (var k = 0; k < stages.length; k++) {
      out.push({ dimension: "ooda_" + stages[k][0], framework: "OODA", score: r1(5 * stages[k][1]),
        evidence: "MEASURED: " + stages[k][2] + " (" + pct(stages[k][1]) + "%). score = 5 x ratio.",
        gap: stages[k][1] < 1 ? stages[k][0] + " below 100%" : "none measured", confidence: "medium" });
      if (!weakest || stages[k][1] < weakest[1]) weakest = stages[k];
    }
    out.push({ dimension: "ooda_closure", framework: "OODA", score: r1(5 * weakest[1]),
      evidence: "MEASURED: loop closure = weakest stage (" + stages.map(function (x) { return x[0] + " " + pct(x[1]) + "%"; }).join(", ") + ").",
      gap: "weakest stage: " + weakest[0], confidence: "medium" });
    // WATCHMAKER-INVERTED-MEASURED-1 (agent_issues 2027): was a hand score (4.8 on 2026-09-24, past its next_score); now
    // 5 x (1 - counted / ops) from the latest watchmaker_runs row, the same index fleet.qnfo.org publishes.
    if (f.wm && f.wm.ops > 0) {
      var wmc = Math.min(f.wm.counted, f.wm.ops);
      out.push({ dimension: "watchmaker_inverted", framework: "fleet", score: r1(5 * (1 - wmc / f.wm.ops)),
        evidence: "MEASURED: watchmaker_runs " + f.wm.day + ": " + wmc + " of " + f.wm.ops + " recurring operations still need a person or a session" + (f.wm.keys ? " (" + f.wm.keys + ")" : "") + ". score = 5 x (1 - counted/ops).",
        gap: wmc > 0 ? wmc + " operation(s) counted: " + f.wm.keys : "none counted", confidence: "high" });
    }
    return out;
  }
  // Pure: the current table overlaid with today's measured dims (what the table holds after this run's write).
  // Judgement dims are carried unchanged; the derived composite rows are left out.
  function mergeDims(measured, current, nowMs) {
    var merged = {}; var i;
    // isNum: the stored score is a number (the dashboard's liveSaiInputs skips NULL or text scores; the SAI does too).
    for (i = 0; i < current.length; i++) if (!COMPOSITE_DIMS[current[i].dimension]) merged[current[i].dimension] = { score: Number(current[i].score), isNum: typeof current[i].score === "number", next: current[i].next_score, measured: false };
    for (i = 0; i < measured.length; i++) merged[measured[i].dimension] = { score: measured[i].score, isNum: typeof measured[i].score === "number", next: isoDay(nowMs + DAY), measured: true };
    return merged;
  }
  // Pure: measured dims + the current table -> overall row (the UNWEIGHTED dimension mean).
  function composite(measured, current, nowMs) {
    var merged = mergeDims(measured, current, nowMs); var i;
    var names = Object.keys(merged); var sum = 0, n = 0, stale = [], meas = 0;
    var today = isoDay(nowMs);
    for (i = 0; i < names.length; i++) {
      var d = merged[names[i]];
      if (isFinite(d.score)) { sum += d.score; n++; }
      if (d.measured) meas++; else if (d.next && String(d.next) < today) stale.push(names[i]);
    }
    if (!n) return null;
    return {
      dimension: "overall", framework: "composite", score: r1(sum / n),
      evidence: "MEASURED composite: unweighted mean of " + n + " dimensions, " + meas + " recomputed today by " + WORKER + ", " + (n - meas) + " carried from hand-scored judgement rows. " + (stale.length ? stale.length + " judgement dimension(s) are past their own next_score date and are NOT fresh: " + stale.join(", ") + "." : "No judgement dimension is past its next_score date.") + " This is the dimension mean; the owner-weighted SAI is the sai_weighted row and survival_state.sai (SAI-COMPOSITE-WEIGHTS-1).",
      gap: stale.length ? "re-score judgement dimensions: " + stale.join(", ") : "none measured",
      confidence: stale.length > n / 2 ? "low" : "medium"
    };
  }
  // ---- SAI-COMPOSITE-WEIGHTS-1: the owner-weighted SAI ----
  // Pure: a line-for-line port of qnfo-fleet-dashboard computeSai(st, bench, cfg, live). st is the dashboard's own
  // state (fleet_dashboard_state.state_json), cfg is sai_config, live is { dims, closureRate, healRate, externalImpact }
  // read exactly as the dashboard's liveSaiInputs reads them. sai.test.mjs slices the dashboard's function out of its
  // source and asserts both return the same SAI, terms and signals, so a formula change in one fails CI until the
  // other follows. The one addition is sai_raw (the unrounded 0-100 value) for the 0-5 scale.
  function computeSai(st, bench, cfg, live) {
    var clamp01 = function (x) { return Math.max(0, Math.min(1, x)); };
    var P = cfg || {};
    var LD = live || {};
    var dims = LD.dims || {};
    var nd = function (k) { return typeof dims[k] === "number" ? dims[k] : null; };
    var probes = st.probes || [];
    var probeRatio = probes.length ? probes.filter(function (p) { return p.ok; }).length / probes.length : 0;
    var issues = st.issues || [];
    var nErr = issues.filter(function (i) { return i.sev === "err"; }).length;
    var nWarn = issues.filter(function (i) { return i.sev === "warn"; }).length;
    var chains = st.chains || [];
    var chainRatio = chains.length ? chains.filter(function (c) { return c.state === "ok"; }).length / chains.length : 0;
    var ig = st.integration || {};
    var islands = ig.islands || [];
    var drift = ig.drift || {};
    var driftBad = (drift.ghost || 0) + (drift.unregistered || 0) + (drift.unversioned || 0);
    var density = ig.density_contract || ig.density || 0;
    var audits = {};
    (st.audits || []).forEach(function (a) { if (a && a.key) audits[a.key] = a; });
    var openIssues = -1, userWait = -1;
    var m1 = ((audits.agent_issues || {}).detail || "").match(/(\d+) open of/);
    if (m1) openIssues = Number(m1[1]);
    var m2 = ((audits.register || {}).detail || "").match(/v_waiting_on_human=(\d+)/);
    if (m2) userWait = Number(m2[1]);
    var noRun = (st.scheduled || []).filter(function (s) { return s.status === "NO-RUN"; }).length;
    var userFreedom = userWait === 0 ? 1 : userWait > 0 ? clamp01(1 - P.uf_step * userWait) : 1;
    var loopHealth = P.lh_probe * probeRatio + P.lh_chain * chainRatio + P.lh_norun * (noRun === 0 ? 1 : P.lh_norun_penalty);
    var autonomy = Math.min(P.aut_user * userFreedom + P.aut_loop * loopHealth, P.autonomy_ceiling);
    var thinking = P.thinking_base + P.thinking_scale * (typeof bench === "number" && bench >= 0 && bench <= 1 ? bench : 0);
    var decLive = ["independent_decision", "ooda_closure", "s3_control", "s5_policy"].map(nd).filter(function (x) { return x != null; });
    var decision = decLive.length ? decLive.reduce(function (a, b) { return a + b; }, 0) / decLive.length / 5 : null;
    // SAI-KAIZEN-GRADIENT-1 (agent_issues 2054): 1 / (1 + step x open) keeps a gradient at every backlog size (the linear
    // clamp read 0 for any backlog above 20, so closing 30 issues moved nothing); parity with qnfo-fleet-dashboard computeSai.
    var kaizen = openIssues > 0 ? 1 / (1 + P.kaizen_step * openIssues) : 1;
    var closureRate = typeof LD.closureRate === "number" ? LD.closureRate : 0;
    var healRate = typeof LD.healRate === "number" ? LD.healRate : 0;
    var selfImprov = P.si_kaizen * kaizen + P.si_closure * closureRate + P.si_heal * healRate;
    var reliability = P.rel_probe * probeRatio + P.rel_err * clamp01(1 - P.rel_err_step * nErr) + P.rel_warn * clamp01(1 - P.rel_warn_step * nWarn);
    var driftPen = clamp01(1 - P.drift_step * driftBad);
    var islandPen = clamp01(1 - P.island_step * islands.length);
    var densityScore = clamp01(density * P.density_mult);
    var structural = P.st_chain * chainRatio + P.st_drift * (P.st_drift_w * driftPen + P.st_island_w * islandPen) + P.st_density * densityScore;
    var sysInt = ig.system || {};
    var sysScore = sysInt.score && typeof sysInt.score.total === "number" ? sysInt.score.total : null;
    var integration = sysScore != null ? P.int_struct * structural + P.int_sys * clamp01(sysScore / 100) : structural;
    var govPol = nd("s5_policy") != null ? nd("s5_policy") / 5 : P.gov_policy;
    var governance = P.gov_user * userFreedom + P.gov_pol_w * govPol;
    var externalImpact = typeof LD.externalImpact === "number" ? Math.max(0, Math.min(1, LD.externalImpact)) : 0;
    var scores = { autonomy: autonomy, thinking: thinking, decision: decision, self_improv: selfImprov, reliability: reliability, integration: integration, external_impact: externalImpact, governance: governance };
    var weights = ["w_autonomy", "w_thinking", "w_decision", "w_self_improv", "w_reliability", "w_integration", "w_external_impact", "w_governance"];
    var missing = weights.filter(function (k) { return typeof P[k] !== "number"; });
    var sai = missing.length || scores.decision == null ? null : 100 * (P.w_autonomy * scores.autonomy + P.w_thinking * scores.thinking + P.w_decision * scores.decision + P.w_self_improv * scores.self_improv + P.w_reliability * scores.reliability + P.w_integration * scores.integration + P.w_external_impact * scores.external_impact + P.w_governance * scores.governance);
    return { sai: sai == null ? null : Math.round(sai * 10) / 10, sai_raw: sai, scores: scores, weights_source: "sai_config", config_missing: missing, decision_source: decLive.length ? "autonomy_scores" : "unavailable", signals: { probe_ratio: probeRatio, chain_ratio: chainRatio, issues_err: nErr, issues_warn: nWarn, open_agent_issues: openIssues, user_wait: userWait, islands: islands.length, drift_bad: driftBad, density: density, no_run: noRun, closure_rate: closureRate, heal_rate: healRate } };
  }
  function r3(x) { return Math.round(x * 1000) / 1000; }
  // Pure: gathered inputs + the merged dims -> the weighted SAI on 0-100 and 0-5, or the reason it cannot be measured.
  // `weights` (optional) overrides w_* for a what-if; it never reaches a write.
  function weightedSai(inp, merged, nowMs, weights) {
    if (!inp || !inp.state) return { ok: false, reason: "no fleet_dashboard_state row (the dashboard has not refreshed)" };
    var at = Date.parse(String(inp.state_at || "").replace(" ", "T"));
    if (isNaN(at)) return { ok: false, reason: "dashboard state carries no timestamp" };
    var ageMin = Math.max(0, Math.round((nowMs - at) / 60000));
    if (nowMs - at > SAI_STATE_MAX_AGE_MS) return { ok: false, reason: "dashboard state is " + ageMin + " min old (limit " + SAI_STATE_MAX_AGE_MS / 60000 + "): its probes, chains and issues are not today's", state_at: inp.state_at };
    var dims = {};
    Object.keys(merged || {}).forEach(function (k) { if (merged[k].isNum !== false && isFinite(merged[k].score)) dims[k] = merged[k].score; });
    var cfg = Object.assign({}, inp.cfg || {}, weights || {});
    var res = computeSai(inp.state, inp.bench, cfg, { dims: dims, closureRate: inp.closureRate, healRate: inp.healRate, externalImpact: inp.externalImpact });
    if (res.config_missing.length) return { ok: false, reason: "sai_config has no " + res.config_missing.join(", ") };
    if (res.scores.decision == null) return { ok: false, reason: "no decision dimension (independent_decision, ooda_closure, s3_control, s5_policy) is scored" };
    if (typeof res.sai_raw !== "number" || !isFinite(res.sai_raw)) return { ok: false, reason: "SAI is not finite: a formula parameter is missing from sai_config" };
    var w = {}, wsum = 0;
    SAI_TERMS.forEach(function (t) { w[t] = cfg["w_" + t]; wsum += cfg["w_" + t]; });
    return { ok: true, sai: Math.round(res.sai_raw / 20 * 100) / 100, sai_100: res.sai, scores: res.scores, weights: w, weight_sum: r3(wsum), state_at: inp.state_at, state_age_min: ageMin, bench: inp.bench, signals: res.signals };
  }
  // Pure: a measured SAI -> the sai_weighted autonomy_scores row.
  function saiRow(s, mean) {
    var worst = null;
    SAI_TERMS.forEach(function (t) { var short = s.weights[t] * (1 - s.scores[t]); if (!worst || short > worst.short) worst = { t: t, short: short }; });
    return {
      dimension: "sai_weighted", framework: "composite", score: s.sai,
      evidence: "MEASURED (SAI-COMPOSITE-WEIGHTS-1): the objective-function SAI, the eight terms weighted by the owner-ratified sai_config w_*, with the same formula and inputs as qnfo-fleet-dashboard computeSai. SAI " + s.sai_100 + "/100 = " + s.sai + "/5 (SAI/20). Terms, weight x score: " + SAI_TERMS.map(function (t) { return t + " " + s.weights[t] + " x " + r3(s.scores[t]); }).join(", ") + " (weights sum " + s.weight_sum + "). Inputs: dashboard state " + s.state_at + " (" + s.state_age_min + " min old), bench " + s.bench + ". Unweighted dimension mean (overall) " + (mean == null ? "n/a" : mean) + "/5.",
      gap: "largest weighted shortfall: " + worst.t + " (" + s.weights[worst.t] + " x (1 - " + r3(s.scores[worst.t]) + ") = " + r3(worst.short) + " of 1.00)",
      confidence: s.state_age_min <= 60 ? "medium" : "low"
    };
  }
  // Pure: ?w_<term>=<0..1> query parameters -> what-if weights. Other parameters are ignored; a bad w_* is refused.
  function parseWhatIf(searchParams) {
    var w = {}, n = 0, bad = [];
    searchParams.forEach(function (v, k) {
      if (k.indexOf("w_") !== 0) return;
      var x = Number(v);
      if (SAI_TERMS.indexOf(k.slice(2)) < 0 || v === "" || !isFinite(x) || x < 0 || x > 1) { bad.push(k); return; }
      w[k] = x; n++;
    });
    return { weights: n ? w : null, bad: bad };
  }
  var FACT_SQL = "SELECT " +
    "(SELECT count(*) FROM fleet_deploys WHERE ts > datetime('now','-7 day') AND ok=1) AS dep_ok," +
    "(SELECT count(*) FROM fleet_deploys WHERE ts > datetime('now','-7 day') AND ok=0) AS dep_fail," +
    "(SELECT count(*) FROM worker_live_audit WHERE note='SYNC') AS sync_n," +
    "(SELECT count(*) FROM worker_live_audit WHERE note='DRIFT') AS drift_n," +
    "(SELECT count(*) FROM self_heal_actions WHERE ts > datetime('now','-7 day') AND status NOT IN ('no-action','superseded')) AS heal_acted," +
    "(SELECT count(*) FROM self_heal_actions WHERE ts > datetime('now','-7 day') AND status NOT IN ('no-action','superseded','failed','verified-failed') AND verified_at IS NOT NULL) AS heal_good," +
    "(SELECT count(*) FROM agent_issues WHERE created_at > (strftime('%s','now')-604800)*1000) AS filed7," +
    "(SELECT count(*) FROM agent_issues WHERE status!='open' AND updated_at > (strftime('%s','now')-604800)*1000) AS closed7," +
    "(SELECT count(*) FROM agent_issues WHERE status='open') AS open_now";
  // Split from FACT_SQL: D1 caps the number of terms in one compound SELECT.
  var FACT_SQL2 = "SELECT " +
    "(SELECT count(*) FROM worker_live_audit WHERE note NOT IN ('NOT_A_WORKER','NOT_DEPLOYED','CRON_ONLY')) AS live_n," +
    "(SELECT count(*) FROM worker_live_audit WHERE note NOT IN ('NOT_A_WORKER','NOT_DEPLOYED','CRON_ONLY') AND http=200) AS live_ok," +
    "(SELECT count(*) FROM research_queue WHERE published_at > datetime('now','-30 day')) AS pub30," +
    "(SELECT count(*) FROM freshness_guard WHERE status='fresh') AS fg_fresh," +
    "(SELECT count(*) FROM freshness_guard WHERE status='stale') AS fg_stale," +
    "(SELECT count(*) FROM guard_registry) AS guards_n," +
    "(SELECT count(*) FROM guard_registry WHERE status='verified') AS guards_ok";
  var FACT_SQL3 = "SELECT " +
    "(SELECT count(*) FROM signals WHERE COALESCE(created_at,ts) > datetime('now','-30 day') AND status!='expired') AS sig30," +
    "(SELECT count(*) FROM signals WHERE COALESCE(created_at,ts) > datetime('now','-30 day') AND status NOT IN ('new','expired')) AS sig30_done," +
    // REVIEW-GATE-1 (2026-10-01, docs/STRATEGY.md s9): a RETIRED threshold is history, not a gate; it counts in neither term.
    "(SELECT count(*) FROM impact_thresholds WHERE state != 'RETIRED') AS gates_n," +
    "(SELECT count(*) FROM impact_thresholds WHERE state='MET') AS gates_met," +
    "(SELECT count(*) FROM agent_issues a JOIN issue_triage t ON t.issue_id=a.id WHERE a.status='open') AS triaged," +
    "(SELECT count(*) FROM agent_issues a JOIN issue_triage t ON t.issue_id=a.id WHERE a.status='open' AND COALESCE(a.description,'') NOT LIKE '%code-task:%' AND COALESCE(t.remediation,'') = '' AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id=a.id AND c.status='active')) AS breached";
  function json(o, s) { return new Response(JSON.stringify(o, null, 1), { status: s || 200, headers: { "content-type": "application/json" } }); }
  async function collect(env) {
    var r = await env.AUDIT.prepare(FACT_SQL).first();
    var r2 = await env.AUDIT.prepare(FACT_SQL2).first();
    var r3 = await env.AUDIT.prepare(FACT_SQL3).first();
    if (!r || !r2 || !r3) throw new Error("fact query returned no row");
    r = Object.assign({}, r, r2, r3);
    var keys = ["dep_ok", "dep_fail", "sync_n", "drift_n", "heal_acted", "heal_good", "filed7", "closed7", "open_now",
      "live_n", "live_ok", "pub30", "fg_fresh", "fg_stale", "guards_n", "guards_ok", "sig30", "sig30_done", "gates_n", "gates_met", "triaged", "breached"];
    var f = {};
    for (var i = 0; i < keys.length; i++) { var v = Number(r[keys[i]]); if (!isFinite(v) || v < 0) throw new Error("bad fact " + keys[i]); f[keys[i]] = v; }
    // WATCHMAKER-INVERTED-MEASURED-1 (agent_issues 2027): the latest published watchmaker index (qnfo-fleet-dashboard
    // WATCHMAKER-INDEX-1, one watchmaker_runs row a day). Optional: no row leaves the dimension to its dated hand score.
    try {
      var wm = await env.AUDIT.prepare("SELECT day, index_value, counted, json_array_length(json_extract(json, '$.ops')) AS ops FROM watchmaker_runs ORDER BY day DESC LIMIT 1").first();
      f.wm = wm && Number(wm.ops) > 0 ? { day: String(wm.day), counted: Number(wm.index_value) || 0, ops: Number(wm.ops), keys: String(wm.counted || "") } : null;
    } catch (e) { f.wm = null; }
    return f;
  }
  // The SAI inputs, read from the same registers as the dashboard's loadSaiConfig, liveSaiInputs and weekly report
  // card. Stricter than the dashboard in one way: a failed read throws (the SAI is then not measured) instead of
  // silently counting as 0. A missing benchmark row is 0, as on the dashboard.
  async function collectSai(env) {
    var A = env.AUDIT;
    var cfgR = await A.prepare("SELECT k, v FROM sai_config").all();
    var cfg = {};
    ((cfgR && cfgR.results) || []).forEach(function (x) { if (x && typeof x.v === "number") cfg[x.k] = x.v; });
    var stRow = await A.prepare("SELECT updated_at, state_json FROM fleet_dashboard_state WHERE id = 1").first();
    var state = stRow && stRow.state_json ? JSON.parse(stRow.state_json) : null;
    var br = await A.prepare("SELECT value FROM report_card_inputs WHERE key = 'arc_agi_10task_pass_rate'").first();
    var bench = br && br.value != null && !isNaN(Number(br.value)) ? Number(br.value) : 0;
    var ic = await A.prepare("SELECT COUNT(*) AS c, SUM(CASE WHEN status NOT IN ('closed','done','resolved','wontfix','cancelled') THEN 1 ELSE 0 END) AS o FROM agent_issues").first();
    var tc = ic ? Number(ic.c || 0) : 0, oc = ic ? Number(ic.o || 0) : 0;
    var hc = await A.prepare("SELECT COUNT(*) AS c, SUM(CASE WHEN status IN ('healed','resolved') THEN 1 ELSE 0 END) AS h FROM self_heal_actions").first();
    var ss = await A.prepare("SELECT survival_score FROM survival_state WHERE id = 1").first();
    return {
      cfg: cfg, state: state, state_at: stRow ? stRow.updated_at : null, bench: bench,
      closureRate: tc > 0 ? clamp((tc - oc) / tc, 0, 1) : null,
      healRate: hc && Number(hc.c) > 0 ? clamp(Number(hc.h || 0) / Number(hc.c), 0, 1) : null,
      externalImpact: ss && typeof ss.survival_score === "number" ? clamp(ss.survival_score, 0, 1) : undefined
    };
  }
  async function run(env, write, whatIf) {
    if (write && whatIf) throw new Error("what-if weights are preview-only");
    var now = Date.now();
    var facts = await collect(env);
    var cur = await env.AUDIT.prepare("SELECT dimension, score, next_score FROM autonomy_scores").all();
    var current = (cur && cur.results) || [];
    var measured = scoreFromFacts(facts, now);
    var comp = composite(measured, current, now);
    var merged = mergeDims(measured, current, now);
    var sai, alt = null;
    try {
      var inp = await collectSai(env);
      sai = weightedSai(inp, merged, now, null);
      if (whatIf) {
        alt = weightedSai(inp, merged, now, whatIf);
        if (alt.ok && sai.ok) alt.delta = { sai: Math.round((alt.sai - sai.sai) * 100) / 100, sai_100: Math.round((alt.sai_100 - sai.sai_100) * 10) / 10 };
      }
    } catch (e) {
      sai = { ok: false, reason: "SAI inputs unreadable: " + String(e && e.message || e).slice(0, 200) };
    }
    var sRow = sai.ok ? saiRow(sai, comp ? comp.score : null) : null;
    var rows = measured.concat(comp ? [comp] : [], sRow ? [sRow] : []);
    if (write && rows.length) {
      var day = isoDay(now), next = isoDay(now + DAY);
      await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS autonomy_score_history (id INTEGER PRIMARY KEY AUTOINCREMENT, dimension TEXT, score REAL, evidence TEXT, scored_at TEXT, ts INTEGER)").run();
      var stmts = [];
      for (var i = 0; i < rows.length; i++) {
        var x = rows[i];
        stmts.push(env.AUDIT.prepare("INSERT INTO autonomy_scores (dimension, framework, score, scale, evidence, gap, confidence, scored_at, next_score) VALUES (?1,?2,?3,'0-5',?4,?5,?6,?7,?8) ON CONFLICT(dimension) DO UPDATE SET framework=excluded.framework, score=excluded.score, scale=excluded.scale, evidence=excluded.evidence, gap=excluded.gap, confidence=excluded.confidence, scored_at=excluded.scored_at, next_score=excluded.next_score").bind(x.dimension, x.framework, x.score, x.evidence, x.gap, x.confidence, day, next));
        stmts.push(env.AUDIT.prepare("INSERT INTO autonomy_score_history (dimension, score, evidence, scored_at, ts) VALUES (?1,?2,?3,?4,?5)").bind(x.dimension, x.score, x.evidence, day, now));
      }
      // SAI-COMPOSITE-WEIGHTS-1: survival_state.sai is the owner-weighted SAI (0-5), never the unweighted mean. An
      // unmeasured SAI is written as NULL (survival_state has no SAI timestamp, so a carried value would read as today's).
      stmts.push(env.AUDIT.prepare("INSERT INTO survival_state (id, ts, sai) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET sai=excluded.sai").bind(new Date(now).toISOString(), sai.ok ? sai.sai : null));
      stmts.push(env.AUDIT.prepare("INSERT INTO fleet_heartbeat (worker,version,ts,ok) VALUES (?1,?2,?3,1) ON CONFLICT(worker) DO UPDATE SET version=excluded.version, ts=excluded.ts, ok=excluded.ok").bind(WORKER, VERSION, new Date(now).toISOString()));
      await env.AUDIT.batch(stmts);
      if (!sai.ok) {
        try { await env.AUDIT.prepare("INSERT INTO alerts (source, level, message) VALUES (?1,'warn',?2)").bind(WORKER, "SAI-COMPOSITE-WEIGHTS-1: weighted SAI not measured, survival_state.sai set NULL and sai_weighted left at its last value: " + sai.reason).run(); } catch (e2) { console.error(JSON.stringify({ worker: "qnfo-observability", where: "scorer run sai alert", error: String(e2 && e2.message || e2).slice(0, 300) })); }
      }
    }
    var out = { ts: new Date(now).toISOString(), version: VERSION, wrote: !!write, facts: facts, rows: rows, sai: sai };
    if (whatIf) out.what_if = alt;
    return out;
  }
  return {
    async scheduled(event, env, ctx) {
      ctx.waitUntil(run(env, true).catch(async function (e) {
        try { await env.AUDIT.prepare("INSERT INTO alerts (source, level, message) VALUES (?1,'warn',?2)").bind(WORKER, "autonomy scoring failed, nothing written: " + String(e && e.message || e).slice(0, 300)).run(); } catch (e2) { console.error(JSON.stringify({ worker: "qnfo-observability", where: "scorer scheduled failure alert", error: String(e2 && e2.message || e2).slice(0, 300) })); }
      }));
    },
    async fetch(request, env) {
      var u = new URL(request.url); var p = u.pathname;
      if (p === "/health") return json({ ok: true, worker: WORKER, version: VERSION, ts: new Date().toISOString(), capabilities: ["autonomy-scoring", "score-preview", "score-history", "sai-weighted", "sai-what-if"], limitations: ["read-only over HTTP; scoring runs on the daily 05:17 cron", "recomputes only measurable dimensions; judgement dimensions are never touched", "the weighted SAI needs a dashboard state younger than 6h; otherwise survival_state.sai is NULL", "what-if weights (/preview?w_<term>=x) are computed, never written"] });
      if (request.method !== "GET") return json({ error: "read-only; scoring runs on the daily cron" }, 405);
      if (p === "/preview") {
        var wi = parseWhatIf(u.searchParams);
        if (wi.bad.length) return json({ error: "what-if weights must be w_<term>=<0..1> with term one of " + SAI_TERMS.join(", "), refused: wi.bad }, 400);
        try { return json(await run(env, false, wi.weights)); } catch (e) { console.error("preview failed", String(e && e.message || e)); return json({ error: "preview failed" }, 500); }
      }
      if (p === "/scores") { var r = await env.AUDIT.prepare("SELECT dimension, framework, score, scale, confidence, scored_at, next_score, gap FROM autonomy_scores ORDER BY dimension").all(); return json({ scores: (r && r.results) || [] }); }
      return json({ worker: WORKER, version: VERSION, routes: ["/health", "/preview", "/scores"] }, 404);
    }
  };
})();

export default {
  // PRECONDITION: cron trigger 15 * * * * (CRON-GRID-1; was 17 * * * *). POSTCONDITION: ingest + digest executed hourly, server-side.
  async scheduled(controller, env, ctx) {
    let hbOk = true;
    try {
      await ensureSchema(env);
      const r = await ingestTrace(env);
      const summary = await digest(env, r);
      await assessIntegration(env);
      ctx.waitUntil(evReview(env).catch(function (e) { console.error('evReview failed', String(e && e.message || e)); })); // OBSERVABILITY-ESCALATION-1 (#1809): escalate undigested alerts hourly
    } catch (e) { hbOk = false; console.error('scheduled failed', String(e && e.message || e)); }
    // SCORER-FOLD-1: the folded qnfo-autonomy-scorer runs once a day, on the 05:17 UTC tick (its old "17 5 * * *").
    if (new Date(Number(controller && controller.scheduledTime) || Date.now()).getUTCHours() === 5) {
      // The scorer hands its run to waitUntil; the host collects and awaits it so the run is not cut at 30 seconds.
      const pending = [];
      try { await scorerMod.scheduled(controller, env, { waitUntil: function (p) { pending.push(Promise.resolve(p)); }, passThroughOnException: function () {} }); await Promise.allSettled(pending); } catch (e) { hbOk = false; console.error('scorer member failed', String(e && e.message || e)); }
    }
    // CRON-ONLY-HEARTBEAT-1 (agent_issues 2397, pillar autonomy): each hourly run ends with one fleet_heartbeat upsert (ok=0 when the
    // run above threw). The write is caught and logged; it never fails the run.
    try {
      await env.AUDIT.prepare("INSERT INTO fleet_heartbeat (worker, version, ts, ok) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(worker) DO UPDATE SET version=excluded.version, ts=excluded.ts, ok=excluded.ok").bind("qnfo-observability", VERSION, new Date().toISOString(), hbOk ? 1 : 0).run();
    } catch (e) { console.error('qnfo-observability fleet_heartbeat write failed', String(e && e.message || e).slice(0, 200)); }
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    // WAE-FLEET-1: per-request data point (this worker's own traffic).
    writeFleet(env, [NAME, p || '/', req.method || 'GET'], [1], NAME);
    // SCORER-FOLD-1: the folded scorer's read-only routes (it answers 405 to anything but GET).
    if (p === '/scorer' || p.indexOf('/scorer/') === 0) {
      const su = new URL(req.url);
      su.pathname = p.slice(7) || '/health';
      return scorerMod.fetch(new Request(su.toString(), req), env);
    }
    // OBS-PUBLIC-READONLY-1 (2026-10-01, charter H0, #1735 sweep): evOkAuth() fails OPEN when EVENTS_TOKEN is unset (it is),
    // so on the public hostname anyone could read every worker's trace logs (logs_json, exceptions_json, URLs) at
    // /workers/logs, post events, and resolve or mute issue_ledger rows. The only external callers of /v1/* (qnfo-events,
    // audit-hub, qnfo-chameleon) are retired; the dashboard reaches /run/ingest through its service binding, whose hostname a
    // public request cannot carry. On a public hostname only the aggregate reads stay anonymous; everything else needs a
    // configured EVENTS_TOKEN bearer.
    if (/\.workers\.dev$|(^|\.)qnfo\.org$/i.test(url.hostname) && !['/health', '/integration', '/trend'].includes(p)) {
      const tok = env.EVENTS_TOKEN || '';
      const hdr = req.headers.get('Authorization') || '';
      const given = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
      let okTok = !!tok && given.length === tok.length;
      if (okTok) { let d = 0; for (let i = 0; i < tok.length; i++) d |= tok.charCodeAt(i) ^ given.charCodeAt(i); okTok = d === 0; }
      if (!okTok) return json({ error: 'forbidden: on a public hostname only /health, /integration and /trend are open (OBS-PUBLIC-READONLY-1)' }, 403);
    }
    if (p === '/health') {
      return json({ ok: true, name: NAME, version: VERSION, capabilities: ['trace-log-ingest', 'integration-assessment', 'trend', 'issue-ledger', 'fleet-probe-summary'], limitations: ['on a public hostname only /health, /integration and /trend are open; other routes need EVENTS_TOKEN or a service binding', 'ingests worker trace logs from R2 on the hourly :17 cron', '/workers/logs returns at most 200 rows'], cursor: null, log_rows: null, latest_ingest: null });
    }
    await ensureSchema(env);
    if (p === '/integration') {
      const summary = await assessIntegration(env);
      return json({ ok: true, integration: summary });
    }
    if (p === '/trend') {
      // Trend analysis (v1.1.2): score delta + per-chain depth velocity = bifurcation early-warning.
      // Chaos lesson: monitor the DERIVATIVE of queue depth, not depth alone (arrival vs drain crossing).
      try {
        const rows = await env.AUDIT.prepare('SELECT ts, json FROM integration_state ORDER BY id DESC LIMIT 24').all();
        const pts = (rows.results || []).map(function (x) { try { return JSON.parse(x.json); } catch (e) { return null; } }).filter(function (x) { return x != null; });
        const latest = pts[0] || null;
        const prev = pts[1] || null;
        const chainVel = [];
        if (latest && prev) {
          const prevChains = {};
          (prev.chains || []).forEach(function (c) { prevChains[c.id] = c.n == null ? 0 : c.n; });
          (latest.chains || []).forEach(function (c) {
            const pn = prevChains[c.id] == null ? null : prevChains[c.id];
            const cn = c.n == null ? 0 : c.n;
            const vel = pn == null ? null : cn - pn;
            let warn = null;
            if (c.status === 'stuck') warn = 'stuck';
            else if (c.status === 'empty-match') warn = 'empty-match (verify enum)';
            else if (c.metric !== 'rate' && vel != null && vel > 0 && cn >= 1) warn = 'depth growing (+' + vel + ')';
            chainVel.push({ id: c.id, n: cn, prev_n: pn, velocity: vel, state: c.status, warn: warn });
          });
        }
        const scNow = latest && latest.score ? latest.score.total : null;
        const scPrev = prev && prev.score ? prev.score.total : null;
        const delta = (scNow != null && scPrev != null) ? Math.round((scNow - scPrev) * 10) / 10 : null;
        const warnings = [];
        chainVel.forEach(function (c) { if (c.warn) warnings.push(c.id + ': ' + c.warn); });
        if (delta != null && delta <= -3) warnings.push('score declining ' + delta + ' (prev ' + scPrev + ')');
        return json({ ok: true, generated_at: new Date().toISOString(), points: pts.length, span_h: pts.length > 1 ? Math.round(((Date.parse(latest.generated_at) - Date.parse(pts[pts.length - 1].generated_at)) / 3600000) * 10) / 10 : null, score_now: scNow, score_prev: scPrev, score_delta: delta, chain_velocity: chainVel, warnings: warnings });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 80) }, 500);
      }
    }
    if (p === '/run/ingest') {
      try {
        const r = await ingestTrace(env);
        const summary = await digest(env, r);
        return json({ ok: true, ingest: r, summary: { workers_seen_24h: summary.workers_seen_24h, anomalies: summary.anomalies.length } });
      } catch (e) { return json({ ok: false, error: String(e && e.message || e).slice(0, 200) }, 500); }
    }
    if (p === '/log' && req.method === 'POST') {
      let body = {}; try { body = await req.json(); } catch (e) { return json({ ok: false, error: 'invalid json' }, 400); }
      return await logEvent(env, body, req);
    }
    if (p === '/workers/logs') {
      const worker = url.searchParams.get('worker') || '';
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
      const since = Number(url.searchParams.get('since') || 0);
      let rows;
      if (worker) {
        rows = await env.AUDIT.prepare('SELECT ts_ms, ingested_at, script_name, event_type, outcome, url, method, status, cpu_ms, wall_ms, logs_json, exceptions_json FROM worker_logs WHERE script_name = ? AND ts_ms >= ? ORDER BY ts_ms DESC LIMIT ?').bind(worker, since, limit).all();
      } else {
        rows = await env.AUDIT.prepare('SELECT ts_ms, ingested_at, script_name, event_type, outcome, url, method, status, cpu_ms, wall_ms, logs_json, exceptions_json FROM worker_logs WHERE ts_ms >= ? ORDER BY ts_ms DESC LIMIT ?').bind(since, limit).all();
      }
      return json({ ok: true, count: rows.results.length, logs: rows.results });
    }
    if (p === '/fleet/summary') {
      const probes = await env.AUDIT.prepare(`SELECT name, url, ok, status, ms, ts, body FROM fleet_probe_log WHERE ts >= ? ORDER BY ts DESC LIMIT 400`).bind(new Date(Date.now() - 86400000).toISOString()).all();
      const latestProbe = {};
      for (const row of (probes.results || [])) { if (!latestProbe[row.name] || row.ts > latestProbe[row.name].ts) latestProbe[row.name] = row; }
      const agg = await env.AUDIT.prepare(`SELECT script_name, COUNT(*) n, SUM(CASE WHEN outcome != 'ok' OR status >= 500 THEN 1 ELSE 0 END) bad, MAX(ts_ms) last_ts FROM worker_logs WHERE ts_ms >= ? GROUP BY script_name`).bind(Date.now() - 86400000).all();
      return json({ ok: true, generated_at: nowIso(), version: VERSION, fleet_size: (await liveFleet(env)).length, fleet_size_source: "service_registry", probes: latestProbe, log_stats: agg.results || [], log_contract: LOG_CONTRACT });
    }
    // JOBS-STATUS-PUBLIC-1 (2026-09-13, v1.1.4): keyless read-only view of the qnfo-ops async-job ledger.
    // WHY: the operator requirement is that a job status link be visible WITHOUT a key. The ops bearer is the
    // master key for chats + job creation, so requiring it to read a status code is wrong. This surface is the
    // status half; the deliverable body stays bearer-gated on qnfo-ops because ops_jobs.response can contain
    // mailbox contents and D1 rows. SCOPE: additive, after all existing routes, wrapped fail-closed.
    if (p === '/jobs' || p.startsWith('/jobs/')) {
      try {
        const cols = 'id, status, model, strategy, created_at, updated_at, length(response) AS response_len, length(tool_log) AS tool_log_len, substr(error,1,200) AS error';
        const id = p.startsWith('/jobs/') ? decodeURIComponent(p.slice(6)) : (url.searchParams.get('id') || '');
        if (id) {
          const row = await env.AUDIT.prepare('SELECT ' + cols + ' FROM ops_jobs WHERE id = ?').bind(id).first();
          if (!row) return json({ ok: false, error: 'no such job', id: id }, 404);
          return json({ ok: true, source: NAME, version: VERSION, note: 'status metadata only; the response body is bearer-gated on qnfo-ops', job: row });
        }
        const limit = Math.min(Number(url.searchParams.get('limit') || 25), 100);
        const st = url.searchParams.get('status') || '';
        const rows = st
          ? await env.AUDIT.prepare('SELECT ' + cols + ' FROM ops_jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?').bind(st, limit).all()
          : await env.AUDIT.prepare('SELECT ' + cols + ' FROM ops_jobs ORDER BY created_at DESC LIMIT ?').bind(limit).all();
        const agg = await env.AUDIT.prepare('SELECT status, COUNT(*) n FROM ops_jobs GROUP BY status').all();
        return json({ ok: true, source: NAME, version: VERSION, note: 'status metadata only; the response body is bearer-gated on qnfo-ops', counts: agg.results || [], jobs: rows.results || [] });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 200) }, 500);
      }
    }

    if (p === '/v1/events' && req.method === 'POST') { if (!evOkAuth(req, env)) return json({ error: 'unauthorized' }, 401); let ev = {}; try { ev = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); } return json(await evIngest(env, ev)); }
    if (p === '/v1/issues' && req.method === 'GET') {
      if (!evOkAuth(req, env)) return json({ error: 'unauthorized' }, 401); await evEnsureSchema(env);
      const evSt = url.searchParams.get('status'); const evSrc = url.searchParams.get('source'); const evLv = url.searchParams.get('level');
      let sql = 'SELECT fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences FROM issue_ledger WHERE 1=1'; const binds = [];
      if (evSt) { sql += ' AND status=?'; binds.push(evSt); } if (evSrc) { sql += ' AND source=?'; binds.push(evSrc); } if (evLv) { sql += ' AND level=?'; binds.push(evLv); }
      sql += ' ORDER BY last_seen DESC LIMIT 100';
      const res = binds.length ? await env.AUDIT.prepare(sql).bind(...binds).all() : await env.AUDIT.prepare(sql).all();
      return json({ issues: res.results || [], count: (res.results || []).length });
    }
    if (p.startsWith('/v1/issues/') && req.method === 'POST') {
      if (!evOkAuth(req, env)) return json({ error: 'unauthorized' }, 401);
      const rest = p.slice('/v1/issues/'.length).split('/'); if (rest.length !== 2) return json({ error: 'expected /v1/issues/:fp/:action' }, 400);
      const fp = decodeURIComponent(rest[0]); const action = rest[1];
      if (!['resolve', 'acknowledge', 'mute', 'reopen'].includes(action)) return json({ error: 'action must be resolve|acknowledge|mute|reopen' }, 400);
      const body = await req.json().catch(() => ({}));
      return json(await evSetStatus(env, fp, { resolve: 'resolved', acknowledge: 'acknowledged', mute: 'muted', reopen: 'open' }[action], body.note || ''));
    }
    if (p === '/v1/sync' && req.method === 'POST') { if (!evOkAuth(req, env)) return json({ error: 'unauthorized' }, 401); return json(await evSweep(env)); }
    if (p === '/v1/review' && req.method === 'POST') { if (!evOkAuth(req, env)) return json({ error: 'unauthorized' }, 401); return json(await evReview(env)); }
        return json({ ok: false, error: 'not found', endpoints: ['/health', '/run/ingest', '/log', '/workers/logs', '/fleet/summary', '/integration', '/trend', '/jobs', '/jobs/<id>', '/v1/events', '/v1/issues', '/v1/sync', '/v1/review'] }, 404);
  }
};