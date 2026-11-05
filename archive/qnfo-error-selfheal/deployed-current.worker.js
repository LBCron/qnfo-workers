// qnfo-error-selfheal — autonomous fleet error detection + deterministic self-correction.
// VERSION 1.0.2 (2026-09-06). Canonical repo: QNFO/qnfo-workers/qnfo-error-selfheal.
// v1.0.2: scanAlertStorms() polices the alert stream (dup>3 or flood>8 per 60m -> one open issue per source+class).
// Purpose: hourly cloud-cron watcher that (1) queries CF GraphQL workersInvocationsAdaptive for
// NEW uncaught worker exceptions in the last 60 min, (2) queries Log Explorer zone http_requests
// for 5xx edges, (3) files deduped agent_issues + alerts for any new spike, (4) deterministically
// auto-re-arms the now-fixed legacy errata publish failure class (errata_actions
// status='error' risk='low' -> 'drafted', bounded <=3/day/action) so the errata-publish worker
// v0.7.1+ retries and publishes. Self-docs /health per FLEET-SELF-DOC-1.
var VERSION = "1.0.3-doi-scrub"; // 1.0.3 NOZ-DOI-1 comment scrub; 2026-09-06 v1.0.1 5xx ISO-filter fix; v1.0.2 alert-storm watchdog
const WORKER = "qnfo-error-selfheal";
const ACCOUNT = "edb167b78c9fb901ea5bca3ce58ccc4b";
const ZONE = "84e9dc1d7fb72629ccdbe3174ed24420"; // qnfo.org
const JSON_HEADERS = { "Content-Type": "application/json" };

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: JSON_HEADERS });
}
function nowIso() { return new Date().toISOString(); }
function isoMin(ms) { return new Date(Date.now() - ms).toISOString(); }

async function ensureSchema(env) {
  await env.QNFO_AUDIT.prepare(
    "CREATE TABLE IF NOT EXISTS fleet_error_state (worker TEXT PRIMARY KEY, errors INTEGER, seen_at TEXT)"
  ).run();
  await env.QNFO_AUDIT.prepare(
    "CREATE TABLE IF NOT EXISTS self_heal_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, ref TEXT, action TEXT, ts TEXT)"
  ).run();
}

async function alertWorker(env, worker, errCount, winStart) {
  const firstSeen = winStart.slice(0, 16).replace("T", " ");
  const title = "WORKER-EXCEPTION-DETECTED " + worker + " (window " + firstSeen + ")";
  const dup = await env.QNFO_AUDIT.prepare(
    "SELECT id FROM agent_issues WHERE title=? AND (status IS NULL OR status NOT IN ('closed','done','resolved')) LIMIT 1"
  ).bind(title).first();
  if (!dup) {
    const desc = "qnfo-error-selfheal detected " + errCount + " uncaught scriptThrewException for worker " + worker + " in the last 60 min. Root-cause + fix per RECURRENCE-ZERO-1 before closeout; verify a live probe with same-turn evidence.";
    await env.QNFO_AUDIT.prepare(
      "INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(title, desc, WORKER, "infra", "medium", "open", nowIso(), nowIso()).run();
  }
  await env.QNFO_AUDIT.prepare(
    "INSERT INTO alerts (source, level, message, created_at) VALUES (?,?,?,?)"
  ).bind(WORKER, "warning", title + ": " + errCount + " exceptions/60m", nowIso()).run();
}

async function recoverErrata(env) {
  const rows = await env.QNFO_AUDIT.prepare(
    "SELECT id, slug FROM errata_actions WHERE status='error' AND risk='low' AND updated_at >= '2026-09-04T15:00:00Z' ORDER BY id ASC LIMIT 10"
  ).all();
  const list = rows && rows.results ? rows.results : [];
  const today = nowIso().slice(0, 10);
  let rearmed = 0;
  for (const r of list) {
    const cnt = await env.QNFO_AUDIT.prepare(
      "SELECT COUNT(*) AS c FROM self_heal_actions WHERE kind='errata-rearm' AND ref=? AND substr(ts,1,10)=?"
    ).bind(String(r.id), today).first();
    if (cnt && cnt.c >= 3) continue;
    await env.QNFO_AUDIT.prepare(
      "UPDATE errata_actions SET status='drafted', updated_at=datetime('now') WHERE id=?"
    ).bind(r.id).run();
    await env.QNFO_AUDIT.prepare(
      "INSERT INTO self_heal_actions (kind, ref, action, ts) VALUES ('errata-rearm', ?, 'drafted', ?)"
    ).bind(String(r.id), nowIso()).run();
    rearmed++;
  }
  return rearmed;
}

async function scanAlertStorms(env) {
  // v1.0.2: self-correcting oversight over the ALERT STREAM itself. Reads newest 500 alert rows
  // (id order is format-independent; created_at mixes ISO-T and space formats - never string-range compare),
  // detects duplicate-message floods (>3 identical/60m) and source floods (>8 alerts/60m), files ONE
  // open agent_issue per source+class. Polices every alert writer, incl. this worker.
  const rows = await env.QNFO_AUDIT.prepare(
    "SELECT id, source, message, created_at FROM alerts ORDER BY id DESC LIMIT 500"
  ).all();
  const list = rows && rows.results ? rows.results : [];
  const now = Date.now();
  const byMsg = {};
  const bySrc = {};
  for (const r of list) {
    const t = new Date(String(r.created_at || "").replace(" ", "T").replace("Z", "") + "Z").getTime();
    if (!t || now - t > 60 * 60000) continue;
    const key = (r.source || "?") + "||" + (r.message || "");
    byMsg[key] = (byMsg[key] || 0) + 1;
    bySrc[r.source || "?"] = (bySrc[r.source || "?"] || 0) + 1;
  }
  const storms = [];
  for (const k of Object.keys(byMsg)) if (byMsg[k] > 3) storms.push({ source: k.split("||")[0], kind: "dup", count: byMsg[k] });
  for (const s of Object.keys(bySrc)) if (bySrc[s] > 8) storms.push({ source: s, kind: "flood", count: bySrc[s] });
  const filed = [];
  for (const st of storms) {
    if (filed.some((f) => f.source === st.source && f.kind === st.kind)) continue;
    const title = "ALERT-STORM-DETECTED " + st.source + " (" + st.kind + ")";
    const dup = await env.QNFO_AUDIT.prepare(
      "SELECT id FROM agent_issues WHERE title=? AND (status IS NULL OR status NOT IN ('closed','done','resolved')) LIMIT 1"
    ).bind(title).first();
    if (!dup) {
      await env.QNFO_AUDIT.prepare(
        "INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
      ).bind(title, "qnfo-error-selfheal detected " + st.count + " " + st.kind + " alerts from " + st.source + " in the trailing 60 min. Root-cause the alert source emit cadence/dedup per RECURRENCE-ZERO-1; verify quieter after fix.", WORKER, "infra", "medium", "open", nowIso(), nowIso()).run();
      filed.push(st);
    }
  }
  return { storms: storms.slice(0, 8), filed: filed };
}

async function scan(env) {
  await ensureSchema(env);
  const winStart = isoMin(60 * 60000);
  const out = { ts: nowIso(), worker: WORKER, version: VERSION };
  const gql = JSON.stringify({
    query: '{ viewer { accounts(filter: {accountTag: "' + ACCOUNT + '"}) { workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: "' + winStart + '", datetime_leq: "' + nowIso() + '"}) { sum { requests errors } dimensions { scriptName } } } } }'
  });
  const exceptions = [];
  try {
    const g = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.CF_API_TOKEN }, body: gql
    });
    const j = await g.json();
    const rows = (j.data && j.data.viewer.accounts[0] && j.data.viewer.accounts[0].workersInvocationsAdaptive) || [];
    for (const row of rows) {
      const errs = (row.sum && row.sum.errors) || 0;
      if (errs > 0) exceptions.push({ worker: row.dimensions.scriptName || "unknown", errors: errs });
    }
  } catch (e) { out.gql_error = String(e.message || e).slice(0, 150); }
  for (const ex of exceptions) {
    const prev = await env.QNFO_AUDIT.prepare("SELECT errors, seen_at FROM fleet_error_state WHERE worker=?").bind(ex.worker).first();
    const newBurst = !prev || ex.errors > (prev.errors || 0);
    if (newBurst) {
      await env.QNFO_AUDIT.prepare(
        "INSERT INTO fleet_error_state (worker, errors, seen_at) VALUES (?,?,?) ON CONFLICT(worker) DO UPDATE SET errors=excluded.errors, seen_at=excluded.seen_at"
      ).bind(ex.worker, ex.errors, nowIso()).run();
      await alertWorker(env, ex.worker, ex.errors, winStart);
      out.alerts = out.alerts || [];
      out.alerts.push(ex.worker + ":" + ex.errors);
    }
  }
  out.workers_with_exceptions = exceptions;
  try {
    // v1.0.1: ISO-8601 timestamp filter (epoch-ms numeric compare was silent no-op -> retention-total ~440, not a 60m count)
    const sql = "SELECT COUNT(*) AS c FROM http_requests WHERE EdgeResponseStatus >= 500 AND EdgeEndTimestamp >= '" + winStart + "'";
    const le = await fetch("https://api.cloudflare.com/client/v4/zones/" + ZONE + "/logs/explorer/query/sql?query=" + encodeURIComponent(sql), {
      headers: { "Authorization": "Bearer " + env.CF_API_TOKEN }
    });
    const lj = await le.json();
    const edge5xx = (lj.result && lj.result[0] && lj.result[0].c) || 0;
    out.edge_5xx_60m = edge5xx;
    if (edge5xx > 20) {
      const lastSpike = await env.QNFO_AUDIT.prepare(
        "SELECT message, created_at FROM alerts WHERE source=? AND message LIKE 'http_requests 5xx spike%' ORDER BY id DESC LIMIT 1"
      ).bind(WORKER).first();
      let prevN = 0, lastTs = 0;
      if (lastSpike && lastSpike.message) {
        const m = lastSpike.message.match(/(d+)s+ins+60m/);
        if (m) prevN = parseInt(m[1], 10);
        if (lastSpike.created_at) lastTs = new Date(lastSpike.created_at).getTime() || 0;
      }
      const cooldownOk = !lastTs || (Date.now() - lastTs) > 6 * 3600 * 1000;
      const growthOk = edge5xx >= prevN * 1.5;
      if (prevN === 0 || cooldownOk || growthOk) {
        if (prevN === 0) {
          const dupTitle = "HTTP-5XX-ELEVATED qnfo.org (http_requests 5xx)";
          const dup = await env.QNFO_AUDIT.prepare(
            "SELECT id FROM agent_issues WHERE title=? AND (status IS NULL OR status NOT IN ('closed','done','resolved')) LIMIT 1"
          ).bind(dupTitle).first();
          if (!dup) {
            await env.QNFO_AUDIT.prepare(
              "INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
            ).bind(dupTitle, "qnfo-error-selfheal measured " + edge5xx + " edge 5xx in 60m on qnfo.org (ISO-filtered Log Explorer count). Root-cause the 504/D1 class per RECURRENCE-ZERO-1.", WORKER, "infra", "medium", "open", nowIso(), nowIso()).run();
          }
        }
        await env.QNFO_AUDIT.prepare(
          "INSERT INTO alerts (source, level, message, created_at) VALUES (?,?,?,?)"
        ).bind(WORKER, "warning", "http_requests 5xx spike: " + edge5xx + " in 60m (qnfo.org)", nowIso()).run();
        out.edge_spike = true;
      }
    }
  } catch (e) { out.log_explorer_error = String(e.message || e).slice(0, 150); }
  out.errata_rearmed = await recoverErrata(env);
  out.alert_storms = await scanAlertStorms(env);
  out.ok = true;
  return out;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scan(env).then(function (s) {
      console.log("[qnfo-error-selfheal] scan:", JSON.stringify(s).slice(0, 600));
    }).catch(function (e) { console.error("[qnfo-error-selfheal] scan error:", String(e.message || e)); }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true, worker: WORKER, version: VERSION, purpose: "autonomous fleet error detection + deterministic self-correction", schedule: "17 * * * *", endpoints: { scan: "POST /run" } });
    }
    if (url.pathname === "/run" && request.method === "POST") {
      try { return json(await scan(env)); }
      catch (e) { return json({ ok: false, error: String(e.message || e) }, 500); }
    }
    return json({ error: "not found", routes: ["/health", "/run"] }, 404);
  }
};
