var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var VERSION = "1.0.0";
var WORKER = "qnfo-fleet-feed";
var SEV = { ok: 0, info: 1, warn: 2, error: 3, critical: 4 };
var EPS = {
  PROBE_LIVE: 0.95,
  D1_FRESHNESS: 0.9,
  ISSUE_OPEN: 0.85,
  DRIFT_REPORT: 0.85,
  AUTONOMY_SCORE: 0.8,
  REGISTRY_STATE: 0.75,
  INFERRED: 0.6
};
function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Feed-Version": VERSION }
  });
}
__name(json, "json");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
function sevInt(s) {
  return SEV[s] !== void 0 ? SEV[s] : 1;
}
__name(sevInt, "sevInt");
function finding(opts) {
  return {
    id: opts.id,
    worker: opts.worker || null,
    category: opts.category || "general",
    severity: opts.severity || "warn",
    severity_int: sevInt(opts.severity || "warn"),
    epsilon: opts.epsilon || EPS.INFERRED,
    title: opts.title,
    detail: opts.detail || null,
    auto_action: opts.auto_action || null,
    human_action: opts.human_action || null,
    verification_query: opts.verification_query || null,
    source_table: opts.source_table || null,
    source_ref: opts.source_ref || null,
    generated_at: nowIso()
  };
}
__name(finding, "finding");
async function collectFreshness(env) {
  var findings = [];
  try {
    var rows = await env.AUDIT.prepare(
      "SELECT signal, table_name, status, age_hours, threshold_hours, checked_at FROM freshness_guard ORDER BY age_hours DESC"
    ).all();
    for (var r of rows.results || []) {
      if (r.status === "idle" || r.status === "stale" || r.status === "unknown") {
        var sev = (r.age_hours || 0) > r.threshold_hours * 3 ? "error" : "warn";
        findings.push(finding({
          id: "freshness-" + r.signal,
          category: "freshness",
          severity: sev,
          epsilon: EPS.D1_FRESHNESS,
          title: "Signal '" + r.signal + "' is " + r.status + " (" + Math.round(r.age_hours || 0) + "h > " + r.threshold_hours + "h threshold)",
          detail: "Table: " + r.table_name + ". Last checked: " + r.checked_at,
          auto_action: "Trigger the worker responsible for writing " + r.table_name + " via its /run or scheduled endpoint.",
          verification_query: "SELECT status, age_hours FROM freshness_guard WHERE signal='" + r.signal + "'",
          source_table: "freshness_guard",
          source_ref: r.signal
        }));
      }
    }
  } catch (e) {
  }
  return findings;
}
__name(collectFreshness, "collectFreshness");
async function collectOpenIssues(env) {
  var findings = [];
  try {
    var rows = await env.AUDIT.prepare(
      "SELECT id, title, priority, category, created_at FROM agent_issues WHERE status NOT IN ('wontfix','closed','resolved') ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id DESC LIMIT 40"
    ).all();
    for (var r of rows.results || []) {
      var sev = r.priority === "critical" ? "critical" : r.priority === "high" ? "error" : "warn";
      findings.push(finding({
        id: "issue-" + r.id,
        category: "backlog/" + (r.category || "general"),
        severity: sev,
        epsilon: EPS.ISSUE_OPEN,
        title: r.title,
        detail: "agent_issues id=" + r.id + " created " + r.created_at,
        auto_action: "POST https://qnfo-backlog-exec.q08.workers.dev/run with body {confirm:true} to attempt auto-close (health-availability class issues only).",
        human_action: r.priority === "critical" ? "Immediate human review required." : null,
        verification_query: "SELECT status FROM agent_issues WHERE id=" + r.id,
        source_table: "agent_issues",
        source_ref: String(r.id)
      }));
    }
  } catch (e) {
  }
  return findings;
}
__name(collectOpenIssues, "collectOpenIssues");
async function collectDrift(env) {
  var findings = [];
  try {
    var rows = await env.AUDIT.prepare(
      "SELECT worker, deployed_version, canonical_version, note, ts FROM fleet_drift_report WHERE note NOT IN ('clean','deployed-clean') ORDER BY ts DESC LIMIT 30"
    ).all();
    var seen = /* @__PURE__ */ new Set();
    for (var r of rows.results || []) {
      var key = r.worker + ":" + r.note;
      if (seen.has(key)) continue;
      seen.add(key);
      var sev = r.note === "noVERSION" ? "warn" : r.note === "deployed-ahead" ? "info" : "warn";
      findings.push(finding({
        id: "drift-" + r.worker,
        worker: r.worker,
        category: "drift/" + r.note,
        severity: sev,
        epsilon: EPS.DRIFT_REPORT,
        title: r.worker + ": " + r.note + " (deployed=" + (r.deployed_version || "?") + " canonical=" + (r.canonical_version || "?") + ")",
        detail: "Last scanned: " + r.ts,
        auto_action: r.note === "deployed-ahead" ? "cp deployed bundle to qnfo-workers/" + r.worker + "/deployed-current.worker.js and commit." : "wrangler deploy from qnfo-workers/" + r.worker + "/ or CF API PUT to redeploy from canonical.",
        verification_query: "SELECT note FROM fleet_drift_report WHERE worker='" + r.worker + "' ORDER BY ts DESC LIMIT 1",
        source_table: "fleet_drift_report",
        source_ref: r.worker
      }));
    }
  } catch (e) {
  }
  return findings;
}
__name(collectDrift, "collectDrift");
async function collectResearchPipeline(env) {
  var findings = [];
  try {
    var stuck = await env.AUDIT.prepare(
      "SELECT id, stage, attempt, error FROM research_queue WHERE status='researching' AND claimed_at < datetime('now','-30 minutes') LIMIT 5"
    ).all();
    for (var r of stuck.results || []) {
      findings.push(finding({
        id: "research-stuck-" + r.id.slice(0, 12),
        worker: "qnfo-research-exec",
        category: "research/stuck",
        severity: "error",
        epsilon: EPS.D1_FRESHNESS,
        title: "research_queue row " + r.id.slice(0, 12) + " stuck at stage=" + r.stage + " for >30min (attempt=" + r.attempt + ")",
        detail: r.error || "No error recorded. May be silent Workers AI timeout.",
        auto_action: "POST https://qnfo-research-exec.q08.workers.dev/run to advance. If attempt>5: UPDATE research_queue SET status='wontfix' WHERE id='" + r.id + "'.",
        verification_query: "SELECT status, stage, attempt FROM research_queue WHERE id='" + r.id + "'",
        source_table: "research_queue",
        source_ref: r.id
      }));
    }
    var failed = await env.AUDIT.prepare("SELECT COUNT(*) AS c FROM research_queue WHERE status='failed'").first();
    if (failed && failed.c > 0) {
      findings.push(finding({
        id: "research-failed-queue",
        worker: "qnfo-research-exec",
        category: "research/failed",
        severity: "warn",
        epsilon: EPS.D1_FRESHNESS,
        title: failed.c + " research_queue rows in status=failed",
        detail: "Failed rows are not retried automatically.",
        auto_action: "UPDATE research_queue SET status='queued', attempt=0, error=NULL WHERE status='failed' AND attempt < 3",
        human_action: "Review rows with attempt>=3 before resetting.",
        verification_query: "SELECT COUNT(*) AS c FROM research_queue WHERE status='failed'",
        source_table: "research_queue",
        source_ref: "failed-count"
      }));
    }
    var scan = await env.AUDIT.prepare("SELECT payload, ts FROM research_scan_log ORDER BY rowid DESC LIMIT 1").first();
    if (scan && scan.payload === "[]") {
      findings.push(finding({
        id: "research-scan-zero",
        worker: "radar-hub",
        category: "research/scan",
        severity: "warn",
        epsilon: EPS.D1_FRESHNESS,
        title: "Latest research scan returned 0 papers (" + scan.ts + ")",
        detail: "May be arXiv 429 rate-limit or date-range miss.",
        auto_action: "GET https://research-daily-brief.q08.workers.dev/run?date=" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + "&dry=1 to test arXiv connection.",
        verification_query: "SELECT payload FROM research_scan_log ORDER BY rowid DESC LIMIT 1",
        source_table: "research_scan_log",
        source_ref: "latest"
      }));
    }
  } catch (e) {
  }
  return findings;
}
__name(collectResearchPipeline, "collectResearchPipeline");
async function collectOutreach(env) {
  var findings = [];
  try {
    var pending = await env.AUDIT.prepare(
      "SELECT COUNT(*) AS c FROM outreach_queue WHERE status='pending' AND (email IS NULL OR email='')"
    ).first();
    if (pending && pending.c > 0) {
      findings.push(finding({
        id: "outreach-no-email",
        worker: "qnfo-outreach",
        category: "outreach/missing-email",
        severity: "info",
        epsilon: EPS.D1_FRESHNESS,
        title: pending.c + " outreach_queue entries have no email address (qnfo-outreach resolves at send time)",
        auto_action: "No pre-action needed. qnfo-outreach resolves emails at activation via institutional lookup.",
        verification_query: "SELECT COUNT(*) AS c FROM outreach_queue WHERE status='pending' AND (email IS NULL OR email='')",
        source_table: "outreach_queue",
        source_ref: "no-email-count"
      }));
    }
    var idle = await env.AUDIT.prepare("SELECT MAX(sent_at) AS last FROM outreach_log").first();
    var lastSent = idle && idle.last ? new Date(idle.last) : null;
    var hoursIdle = lastSent ? (Date.now() - lastSent.getTime()) / 36e5 : 9999;
    var activation = /* @__PURE__ */ new Date("2026-09-15T00:00:00Z");
    if (hoursIdle > 72 && Date.now() > activation.getTime()) {
      findings.push(finding({
        id: "outreach-idle-post-activation",
        worker: "qnfo-outreach",
        category: "outreach/idle",
        severity: hoursIdle > 168 ? "error" : "warn",
        epsilon: EPS.D1_FRESHNESS,
        title: "Outreach pipeline idle " + Math.round(hoursIdle) + "h AFTER activation date",
        detail: "Activation was 2026-09-15. Last send: " + (idle && idle.last || "never"),
        auto_action: "SELECT value FROM pipeline_state WHERE key='external_sends_enabled'. If value=0, UPDATE pipeline_state SET value=1 WHERE key='external_sends_enabled'.",
        human_action: "If sends are still 0 after enabling, check qnfo-outreach worker logs for errors.",
        verification_query: "SELECT MAX(sent_at) FROM outreach_log",
        source_table: "outreach_log",
        source_ref: "idle-post-activation"
      }));
    }
  } catch (e) {
  }
  return findings;
}
__name(collectOutreach, "collectOutreach");
async function collectModelHealth(env) {
  var findings = [];
  try {
    var bad = await env.AUDIT.prepare(
      "SELECT model_id, status, gateway_failures, consecutive_failures FROM ai_model_health WHERE status NOT IN ('ok') ORDER BY gateway_failures DESC LIMIT 10"
    ).all();
    for (var r of bad.results || []) {
      var sev = r.consecutive_failures > 5 ? "error" : "warn";
      findings.push(finding({
        id: "model-health-" + r.model_id.replace(/[^a-z0-9]/gi, "-"),
        worker: "qnfo-ai",
        category: "ai-model/" + r.status,
        severity: sev,
        epsilon: EPS.D1_FRESHNESS,
        title: "AI model " + r.model_id + " status=" + r.status + " (gw_failures=" + r.gateway_failures + ", consecutive=" + r.consecutive_failures + ")",
        auto_action: r.consecutive_failures === 0 ? "UPDATE ai_model_health SET status='ok', updated_at=unixepoch()*1000 WHERE model_id='" + r.model_id + "' AND consecutive_failures=0" : "Trigger ai-health-prober to re-probe: GET https://ai-health-prober.q08.workers.dev/run",
        verification_query: "SELECT status, consecutive_failures FROM ai_model_health WHERE model_id='" + r.model_id + "'",
        source_table: "ai_model_health",
        source_ref: r.model_id
      }));
    }
  } catch (e) {
  }
  return findings;
}
__name(collectModelHealth, "collectModelHealth");
async function collectSelfHeal(env) {
  var findings = [];
  try {
    var bad = await env.AUDIT.prepare(
      "SELECT id, kind, ref, action FROM self_heal_actions WHERE status='executed' AND action LIKE '%status=error%' ORDER BY rowid DESC LIMIT 5"
    ).all();
    for (var r of bad.results || []) {
      findings.push(finding({
        id: "selfheal-failed-" + r.id,
        category: "self-heal/outcome-mismatch",
        severity: "warn",
        epsilon: EPS.INFERRED,
        title: "Self-heal action id=" + r.id + " recorded executed but result=error (outcome not checked)",
        detail: r.action ? r.action.slice(0, 200) : null,
        auto_action: "UPDATE self_heal_actions SET status='failed' WHERE id=" + r.id + " AND action LIKE '%status=error%'",
        verification_query: "SELECT status FROM self_heal_actions WHERE id=" + r.id,
        source_table: "self_heal_actions",
        source_ref: String(r.id)
      }));
    }
  } catch (e) {
  }
  return findings;
}
__name(collectSelfHeal, "collectSelfHeal");
async function collectAutonomyScores(env) {
  var findings = [];
  try {
    var overall = await env.AUDIT.prepare(
      "SELECT score, gap, confidence, scored_at FROM autonomy_scores WHERE dimension='overall' ORDER BY scored_at DESC LIMIT 1"
    ).first();
    if (overall && overall.score < 4) {
      findings.push(finding({
        id: "autonomy-score-below-target",
        category: "autonomy/score",
        severity: overall.score < 3 ? "error" : "warn",
        epsilon: EPS.AUTONOMY_SCORE,
        title: "Overall autonomy score " + overall.score + "/5 (target >=4.0, scored " + overall.scored_at + ")",
        detail: "Gap: " + (overall.gap || "unspecified"),
        auto_action: "GET https://qnfo-fleet-feed.q08.workers.dev/feed/actions and execute all auto_action items with severity>=warn.",
        verification_query: "SELECT score FROM autonomy_scores WHERE dimension='overall' ORDER BY scored_at DESC LIMIT 1",
        source_table: "autonomy_scores",
        source_ref: "overall"
      }));
    }
  } catch (e) {
  }
  return findings;
}
__name(collectAutonomyScores, "collectAutonomyScores");
async function collectVersionQueue(env) {
  var findings = [];
  try {
    var stale = await env.AUDIT.prepare(
      "SELECT COUNT(*) AS c FROM version_queue WHERE status='drafted' AND updated_at < datetime('now','-4 hours')"
    ).first();
    if (stale && stale.c > 0) {
      findings.push(finding({
        id: "version-queue-stale",
        worker: "qnfo-research-exec",
        category: "publish/stale",
        severity: "warn",
        epsilon: EPS.D1_FRESHNESS,
        title: stale.c + " version_queue rows drafted >4h (publish drain stalled)",
        auto_action: "POST https://qnfo-research-exec.q08.workers.dev/run/drain-v2 to force-drain the version queue.",
        verification_query: "SELECT COUNT(*) AS c FROM version_queue WHERE status='drafted'",
        source_table: "version_queue",
        source_ref: "stale-drafted"
      }));
    }
  } catch (e) {
  }
  return findings;
}
__name(collectVersionQueue, "collectVersionQueue");
async function collectRegistryGaps(env) {
  var findings = [];
  try {
    var noPurpose = await env.AUDIT.prepare(
      "SELECT COUNT(*) AS c FROM service_registry WHERE state='live' AND (purpose IS NULL OR purpose='')"
    ).first();
    if (noPurpose && noPurpose.c > 0) {
      findings.push(finding({
        id: "registry-no-purpose",
        category: "registry/incomplete",
        severity: "info",
        epsilon: EPS.REGISTRY_STATE,
        title: noPurpose.c + " live workers have no purpose in service_registry",
        auto_action: "POST https://qnfo-ops.q08.workers.dev/registry/refresh to auto-populate purpose from /health responses.",
        verification_query: "SELECT COUNT(*) AS c FROM service_registry WHERE state='live' AND (purpose IS NULL OR purpose='')",
        source_table: "service_registry",
        source_ref: "no-purpose"
      }));
    }
  } catch (e) {
  }
  return findings;
}
__name(collectRegistryGaps, "collectRegistryGaps");
async function isAcked(env, id) {
  try {
    var r = await env.AUDIT.prepare(
      "SELECT 1 FROM feed_acks WHERE finding_id=? AND acked_until > datetime('now') LIMIT 1"
    ).bind(id).first();
    return !!r;
  } catch (e) {
    return false;
  }
}
__name(isAcked, "isAcked");
async function buildFeed(env) {
  var [freshness, issues, drift, research, outreach, models, heal, autonomy, vqueue, registry] = await Promise.all([
    collectFreshness(env),
    collectOpenIssues(env),
    collectDrift(env),
    collectResearchPipeline(env),
    collectOutreach(env),
    collectModelHealth(env),
    collectSelfHeal(env),
    collectAutonomyScores(env),
    collectVersionQueue(env),
    collectRegistryGaps(env)
  ]);
  var all = [
    ...freshness,
    ...issues,
    ...drift,
    ...research,
    ...outreach,
    ...models,
    ...heal,
    ...autonomy,
    ...vqueue,
    ...registry
  ];
  var active = [];
  for (var f of all) {
    if (!await isAcked(env, f.id)) active.push(f);
  }
  active.sort(function(a, b) {
    return b.severity_int - a.severity_int || b.epsilon - a.epsilon;
  });
  var counts = { critical: 0, error: 0, warn: 0, info: 0, ok: 0 };
  for (var f2 of active) counts[f2.severity] = (counts[f2.severity] || 0) + 1;
  var autoActionable = active.filter(function(f3) {
    return f3.auto_action && f3.severity_int >= SEV.warn;
  });
  var humanRequired = active.filter(function(f3) {
    return f3.human_action && !f3.auto_action;
  });
  return {
    schema_version: "1",
    feed_version: VERSION,
    worker: WORKER,
    generated_at: nowIso(),
    summary: {
      total_findings: active.length,
      by_severity: counts,
      auto_actionable: autoActionable.length,
      human_required: humanRequired.length,
      fleet_health: counts.critical > 0 ? "critical" : counts.error > 0 ? "degraded" : counts.warn > 0 ? "warn" : "ok"
    },
    findings: active
  };
}
__name(buildFeed, "buildFeed");
var SCHEMA = {
  schema_version: "1",
  description: "qnfo-fleet-feed v1.0.0: machine-readable autonomous fleet feed for self-aware, self-healing, user-free operation.",
  endpoints: {
    "GET /health": "Liveness + version.",
    "GET /feed": "Full fleet feed. All findings sorted by severity desc, epsilon desc.",
    "GET /feed/summary": "Compact summary: counts by severity, fleet_health, auto_actionable count.",
    "GET /feed/self?worker=<name>": "Per-worker feed: findings relevant to the named worker.",
    "GET /feed/actions": "Only auto-actionable findings (severity>=warn, has auto_action).",
    "GET /feed/signals": "Raw signal table (freshness_guard + autonomy_scores).",
    "POST /feed/ack?ref=<finding_id>": "Acknowledge a finding for 24h (suppress from feed).",
    "GET /feed/schema": "This schema descriptor."
  },
  finding_fields: {
    id: "Stable string ID. Use for acks and deduplication.",
    worker: "Worker name this finding targets, or null for fleet-wide.",
    category: "Dot-separated category path e.g. 'research/stuck', 'freshness', 'drift'.",
    severity: "ok | info | warn | error | critical",
    severity_int: "Integer 0-4 for machine comparison.",
    epsilon: "Evidential weight 0..1. Higher = more confident the finding is real.",
    title: "One-line human+machine readable description.",
    detail: "Extended context. May be null.",
    auto_action: "Concrete action a control loop can take WITHOUT human gate. SQL, HTTP call, or wrangler command. Null if no safe auto-action.",
    human_action: "Action requiring human review. Null if auto_action covers it.",
    verification_query: "SQL SELECT or HTTP GET confirming the finding is resolved.",
    source_table: "D1 table this finding was derived from.",
    source_ref: "Row identifier within source_table.",
    generated_at: "ISO timestamp when this finding was generated."
  },
  autonomy_contract: {
    principle_1: "Every finding with auto_action and severity>=warn MUST be acted on by the next control-loop cron without human intervention.",
    principle_2: "Findings with human_action and no auto_action are escalated to alerts@qnfo.org. Never silently dropped.",
    principle_3: "A finding is resolved when its verification_query returns the expected value. Control loop re-runs /feed/actions after acting and confirms resolution.",
    principle_4: "Workers bind this feed as a service binding (FLEET_FEED) and call /feed/self?worker=<name> at the start of every scheduled run to get their own work items."
  }
};
async function ensureAckTable(env) {
  try {
    await env.AUDIT.prepare(
      "CREATE TABLE IF NOT EXISTS feed_acks (finding_id TEXT PRIMARY KEY, acked_at TEXT, acked_until TEXT)"
    ).run();
  } catch (e) {
  }
}
__name(ensureAckTable, "ensureAckTable");
var worker_default = {
  async fetch(request, env) {
    await ensureAckTable(env);
    var url = new URL(request.url);
    var p = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (p === "/health") return json({ ok: true, worker: WORKER, version: VERSION, time: nowIso() });
      if (p === "/feed/schema") return json(SCHEMA);
      if (p === "/feed/signals") {
        var fg = await env.AUDIT.prepare("SELECT * FROM freshness_guard ORDER BY age_hours DESC").all();
        var as_ = await env.AUDIT.prepare("SELECT * FROM autonomy_scores ORDER BY scored_at DESC").all();
        return json({ freshness_guard: fg.results || [], autonomy_scores: as_.results || [], generated_at: nowIso() });
      }
      if (p === "/feed/ack" && request.method === "POST") {
        var ref = url.searchParams.get("ref");
        if (!ref) return json({ error: "ref required" }, 400);
        var until = new Date(Date.now() + 864e5).toISOString();
        await env.AUDIT.prepare(
          "INSERT OR REPLACE INTO feed_acks (finding_id, acked_at, acked_until) VALUES (?,?,?)"
        ).bind(ref, nowIso(), until).run();
        return json({ ok: true, acked: ref, until });
      }
      if (p === "/feed" || p === "/feed/summary" || p === "/feed/actions" || p === "/feed/self") {
        var feed = await buildFeed(env);
        if (p === "/feed/summary") {
          return json({
            schema_version: "1",
            feed_version: VERSION,
            generated_at: feed.generated_at,
            summary: feed.summary,
            top_findings: feed.findings.slice(0, 5).map(function(f) {
              return { id: f.id, severity: f.severity, title: f.title, auto_action: !!f.auto_action };
            })
          });
        }
        if (p === "/feed/actions") {
          return json({
            schema_version: "1",
            feed_version: VERSION,
            generated_at: feed.generated_at,
            auto_actionable: feed.findings.filter(function(f) {
              return f.auto_action && f.severity_int >= SEV.warn;
            }),
            human_required: feed.findings.filter(function(f) {
              return f.human_action && !f.auto_action;
            })
          });
        }
        if (p === "/feed/self") {
          var workerName = url.searchParams.get("worker") || "";
          if (!workerName) return json({ error: "worker param required" }, 400);
          var mine = feed.findings.filter(function(f) {
            return f.worker === workerName || f.worker === null;
          });
          return json({
            schema_version: "1",
            feed_version: VERSION,
            worker: workerName,
            generated_at: feed.generated_at,
            findings: mine,
            summary: {
              total: mine.length,
              auto_actionable: mine.filter(function(f) {
                return f.auto_action && f.severity_int >= SEV.warn;
              }).length,
              human_required: mine.filter(function(f) {
                return f.human_action && !f.auto_action;
              }).length
            }
          });
        }
        return json(feed);
      }
      return json({ ok: true, worker: WORKER, version: VERSION, endpoints: Object.keys(SCHEMA.endpoints) });
    } catch (e) {
      return json({ error: String(e && e.message || e), worker: WORKER, version: VERSION }, 500);
    }
  },
  async scheduled(event, env) {
    await ensureAckTable(env);
    try {
      var feed = await buildFeed(env);
      var s = feed.summary;
      await env.AUDIT.prepare(
        "INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?,?,?,?,?,?,?)"
      ).bind(
        "feed-" + Date.now(),
        nowIso(),
        "fleet-feed",
        "health=" + s.fleet_health + " findings=" + s.total_findings + " actionable=" + s.auto_actionable + " human=" + s.human_required,
        JSON.stringify(s),
        WORKER,
        s.fleet_health === "ok" ? "ok" : "warn"
      ).run();
    } catch (e) {
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map