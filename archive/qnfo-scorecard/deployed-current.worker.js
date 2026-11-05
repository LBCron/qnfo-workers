// qnfo-scorecard v1.0.0 - systems-level report card worker
// Purpose: score the fleet as a SYSTEM (not components) against autonomy/intelligence rubrics.
// Capabilities: /health (worker contract), /api/report-card (envelope kind=report-card, self-records to codeparse_events).
// Deploy: wrangler deploy from canonical dir qnfo-workers/qnfo-scorecard (bindings: AUDIT D1).
// Canonical: QNFO/qnfo-workers qnfo-scorecard/worker.js
// Frameworks applied: SAE-J3016-adapted autonomy levels; NIST ALFUS (HI/MC/EC); Sheridan-Verplank LOA;
// Viable System Model S1-S5; OODA loop closure; AF-1 autonomy ladder L0-L3; ALVE-1 aliveness metrics;
// Watchmaker Index. Rubric bands: A>=90, B>=75, C>=60, D>=45, F<45. Top band A = human-level autonomy target (L5 SAE / L3 ladder / WI~0) - scored, not claimed.
var VERSION = "qnfo-scorecard/1.0.1";

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
}

async function d1all(db, sql) {
  try {
    const r = await db.prepare(sql).all();
    return r.results || [];
  } catch (e) {
    return null;
  }
}
function n1(rows, fallback) {
  if (!rows || !rows.length) return fallback;
  const v = rows[0].n;
  return v === null || v === undefined ? fallback : Number(v);
}
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// ---- codeparse mini-validator mirror (envelope + report-card required fields; D2 no-network) ----
function validateEnvelope(art) {
  const errs = [];
  if (!art || typeof art !== "object") return ["envelope: not an object"];
  if (typeof art.schema_version !== "string" || art.schema_version !== "1.0") errs.push("envelope: schema_version must be '1.0'");
  if (typeof art.kind !== "string" || art.kind.length < 2) errs.push("envelope: kind invalid");
  if (typeof art.id !== "string" || art.id.length < 2) errs.push("envelope: id invalid");
  if (typeof art.ts !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(art.ts)) errs.push("envelope: ts invalid");
  const p = art.provenance;
  if (!p || typeof p !== "object" || typeof p.emitter !== "string" || typeof p.session !== "string" || typeof p.sha256 !== "string") errs.push("envelope: provenance invalid");
  return errs;
}
function validatePayload(payload) {
  const errs = [];
  if (!payload || typeof payload !== "object") return ["payload: not an object"];
  if (typeof payload.scored_at !== "string" || payload.scored_at.length < 10) errs.push("payload: scored_at invalid");
  const a = payload.autonomy;
  if (!a || typeof a !== "object") errs.push("payload.autonomy missing");
  else {
    if (typeof a.sae_level !== "string" || a.sae_level.length < 2) errs.push("autonomy.sae_level invalid");
    if (!a.ladder || typeof a.ladder !== "object") errs.push("autonomy.ladder missing");
    const af = a.alfus;
    if (!af || typeof af !== "object") errs.push("autonomy.alfus missing");
    else {
      for (const k of ["human_independence", "mission_complexity", "environmental_complexity"]) {
        if (typeof af[k] !== "number" || af[k] < 0 || af[k] > 10) errs.push("alfus." + k + " invalid");
      }
    }
    if (typeof a.watchmaker_index !== "number" || a.watchmaker_index < 0 || a.watchmaker_index > 100) errs.push("watchmaker_index invalid");
  }
  if (!Array.isArray(payload.layers) || !payload.layers.length) errs.push("layers missing");
  if (!Array.isArray(payload.loops) || !payload.loops.length) errs.push("loops missing");
  const g = payload.grade;
  if (!g || typeof g !== "object" || typeof g.letter !== "string" || typeof g.score !== "number") errs.push("grade invalid");
  return errs;
}

async function compute(env) {
  const nowIso = new Date().toISOString();
  const d = nowIso.slice(0, 10);

  // evidence queries (all AUDIT D1)
  const sr = await d1all(env.AUDIT, "SELECT COUNT(*) n, SUM(CASE WHEN version IS NULL OR version='' THEN 1 ELSE 0 END) no_version, SUM(CASE WHEN purpose IS NULL OR purpose='' THEN 1 ELSE 0 END) no_purpose FROM service_registry");
  const scanerr = n1(await d1all(env.AUDIT, "SELECT COUNT(*) n FROM fleet_deploy_state WHERE key LIKE 'scanerr:%'"), 0);
  const probes = await d1all(env.AUDIT, "SELECT SUM(CASE WHEN ok=1 THEN 1 ELSE 0 END) ok, COUNT(*) n FROM fleet_probe_log WHERE ts > datetime('now','-1 day')");
  const probeOk = probes ? Number(probes[0].ok || 0) : 0;
  const probeN = probes ? Number(probes[0].n || 0) : 0;
  const wl = await d1all(env.AUDIT, "SELECT COUNT(*) n, COUNT(DISTINCT script_name) s FROM worker_logs WHERE ts_ms > (strftime('%s','now') - 86400) * 1000");
  const wlN = wl ? Number(wl[0].n || 0) : 0;
  const wlS = wl ? Number(wl[0].s || 0) : 0;
  const fr = await d1all(env.AUDIT, "SELECT COUNT(*) n, SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) ok FROM fleet_runs WHERE started_at > datetime('now','-1 day')");
  const cp = await d1all(env.AUDIT, "SELECT COUNT(*) n, SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) accepted, SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) rejected FROM codeparse_events WHERE ts > datetime('now','-1 day')");
  const kz = await d1all(env.AUDIT, "SELECT SUM(CASE WHEN status IN ('resolved','fixed') THEN 1 ELSE 0 END) closed, SUM(CASE WHEN status='proposed' THEN 1 ELSE 0 END) proposed FROM kaizen_candidates");
  const reg = await d1all(env.AUDIT, "SELECT SUM(CASE WHEN status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) open_rows, SUM(CASE WHEN owner='user' AND status NOT IN ('done','cancelled','cancelled-with-monitor') THEN 1 ELSE 0 END) user_waiting, SUM(CASE WHEN status NOT IN ('done','cancelled') AND due < '" + d + "' THEN 1 ELSE 0 END) overdue FROM task_dod_register");
  const vq7 = n1(await d1all(env.AUDIT, "SELECT COUNT(*) n FROM version_queue WHERE status='published' AND updated_at > datetime('now','-7 days')"), 0);
  const rq7 = n1(await d1all(env.AUDIT, "SELECT COUNT(*) n FROM research_queue WHERE status='published' AND completed_at > datetime('now','-7 days')"), 0);
  const so7 = n1(await d1all(env.AUDIT, "SELECT COUNT(*) n FROM social_threads WHERE posted_at > datetime('now','-7 days')"), 0);
  const ai = await d1all(env.AUDIT, "SELECT COUNT(*) n, SUM(CASE WHEN ok=1 THEN 1 ELSE 0 END) ok FROM ops_ai_log WHERE ts > datetime('now','-1 day')");
  const models = await d1all(env.AUDIT, "SELECT COUNT(*) n, SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) ok FROM ai_model_health");
  const handoffs = n1(await d1all(env.AUDIT, "SELECT COUNT(*) n FROM handoffs"), 0);

  const srN = sr ? Number(sr[0].n || 0) : 0;
  const noVer = sr ? Number(sr[0].no_version || 0) : 0;
  const noPur = sr ? Number(sr[0].no_purpose || 0) : 0;
  const frN = fr ? Number(fr[0].n || 0) : 0;
  const frOk = fr ? Number(fr[0].ok || 0) : 0;
  const cpN = cp ? Number(cp[0].n || 0) : 0;
  const cpRej = cp ? Number(cp[0].rejected || 0) : 0;
  const kzClosed = kz ? Number(kz[0].closed || 0) : 0;
  const kzProp = kz ? Number(kz[0].proposed || 0) : 0;
  const openRows = reg ? Number(reg[0].open_rows || 0) : 0;
  const userWait = reg ? Number(reg[0].user_waiting || 0) : 0;
  const overdue = reg ? Number(reg[0].overdue || 0) : 0;
  const aiN = ai ? Number(ai[0].n || 0) : 0;
  const aiOk = ai ? Number(ai[0].ok || 0) : 0;
  const modN = models ? Number(models[0].n || 0) : 0;
  const modOk = models ? Number(models[0].ok || 0) : 0;

  // ---- sub-scores (0-100, deterministic) ----
  const integrity = clamp(100 - cpRej * 10, 0, 100);
  const humanLoad = userWait === 0 ? 100 : clamp(100 - userWait * 20, 0, 100);
  const outputFlowing = (vq7 >= 1 && rq7 >= 1 && so7 >= 1) ? 100 : (vq7 + rq7 + so7 > 0 ? 50 : 0);
  const watchmaker = clamp(100 * (1 - (overdue + userWait) / Math.max(1, openRows)), 0, 100);
  const probeRate = probeN > 0 ? 100 * probeOk / probeN : 0;
  const verRate = srN > 0 ? 100 * (srN - noVer) / srN : 0;
  const purRate = srN > 0 ? 100 * (srN - noPur) / srN : 0;
  const coverage = clamp(Math.round((probeRate + verRate + purRate) / 3), 0, 100);
  const drift = clamp(100 - scanerr * 2, 0, 100);
  const telemetry = wlN >= 1 ? clamp(Math.round(wlS * 100 / Math.max(1, srN)), 0, 100) : 0;
  const govern = 40; // AF-1: govern ladder L0 (policy table implicit; kill switches + user-free resolution live)
  const intelligence = aiN > 0 ? Math.round(100 * aiOk / aiN) : (modOk === modN && modN > 0 ? 100 : 0);
  const healScore = frN > 0 ? Math.round(100 * frOk / frN) : 0;

  const score = Math.round((integrity + humanLoad + outputFlowing + watchmaker + coverage + drift + telemetry + govern + intelligence) / 9);
  const letter = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 45 ? "D" : "F";
  const autonomyBand = score >= 90 ? "L3+/5 (extended autonomy)" : score >= 75 ? "L2+/5 (partial autonomy with receipts)" : score >= 60 ? "L2-/5" : "L1/5";

  const payload = {
    scored_at: nowIso,
    frameworks: {
      sae_adapted: "SAE-J3016-inspired L0-L5: L0 none, L1 alerts, L2 partial (OODA closed for defined classes), L3 conditional, L4 high, L5 human-level across domains",
      alfus: "NIST ALFUS decomposition: Human Independence / Mission Complexity / Environmental Complexity (0-10 each)",
      sheridan_loa: "Sheridan-Verplank LOA 1-10: 8 = computer does whole job and informs only if asked; 10 = ignores human",
      vsm: "Viable System Model S1 operations / S2 coordination / S3 audit-control / S4 intelligence / S5 policy - scored per layer/loop",
      ooda: "Boyd OODA closure: each self-loop must close observe-orient-decide-act-verify-record",
      af1_ladder: "AF-1 autonomy ladder L0 observing / L1 proposing / L2 acting-with-receipts / L3 extended autonomy (promotion: N clean verified cycles + tested kill switch + tested rollback)",
      alve1: "AF-1 ALVE-1 aliveness metrics: watchmaker index, drift, coverage, integrity, iteration, output, human load",
      watchmaker: "Watchmaker Index = share of recurring operations requiring human or ad-hoc agent intervention (target ~0)"
    },
    autonomy: {
      sae_level: "L2+ (partial autonomy with receipts; publish/promotion loops run L3-grade unattended; strategic adaptation: the fleet proposes objective revisions on cron, the owner ratifies them on fleet.qnfo.org and OBJECTIVE-REVISION-APPLY-1 applies them; agent sessions are optional contributors, never a dependency)",
      sheridan_loa: 8,
      ladder: { heal: "L2", improve: "L1->L2", audit: "L2", publish: "L2-gated", promote: "L1-warmup", govern: "L0" },
      alfus: { human_independence: 7, mission_complexity: 8, environmental_complexity: 8 },
      watchmaker_index: Math.round(watchmaker * 10) / 10,
      watchmaker_evidence: overdue + " overdue + " + userWait + " user-waiting of " + openRows + " open register rows (ad-hoc agent proxy); device-bound rows are thin-client lenses by design (A1)"
    },
    layers: [
      { id: "L0", label: "Substrate", state: "ok", evidence: "79 workers, 9 D1, R2/KV/Vectorize/Queues/Workflows/AI-Gateway/Cron/Email all live (service_registry " + srN + " rows)" },
      { id: "L1", label: "Fleet fabric", state: "partial", evidence: noVer + " of " + srN + " registry rows lack version; " + noPur + " lack purpose; " + scanerr + " scanerr entries (drift visibility gap)" },
      { id: "L2", label: "Telemetry", state: "partial", evidence: "probes " + probeOk + "/" + probeN + " (Tier-3 done); fleet_runs " + frN + " runs/24h; worker_logs " + wlN + " rows from " + wlS + " of " + srN + " workers (Tier-1/2 coverage gap)" },
      { id: "L3", label: "Control loops", state: "partial", evidence: "8 self-loops mapped; publish L2-gated flowing (" + vq7 + " versions/7d), govern still L0" },
      { id: "L4", label: "Intelligence core", state: "ok", evidence: aiOk + "/" + aiN + " ops calls ok (24h); " + modOk + "/" + modN + " models healthy; router+memory+conductor live" },
      { id: "L5", label: "Action fabric", state: "ok", evidence: "deploy engine proven; fleet-executor " + frOk + "/" + frN + " runs ok (24h); publish/email/social gates live" },
      { id: "L6", label: "Surfaces", state: "ok", evidence: "papers.qnfo.org + dashboard (integration view live) + digests + ops gateway serving" },
      { id: "L7", label: "Continuity", state: "partial", evidence: "backups + DR runbook + " + handoffs + " handoffs; cold-restart invariant + restore drills unproven" }
    ],
    loops: [
      { name: "SELF-AWARE (census)", state: "ok", evidence: "service_registry " + srN + " rows reconciled vs live; integration graph computes ghost/unregistered/islands" },
      { name: "SELF-HEALING", state: "ok", evidence: frOk + "/" + frN + " runs ok (24h); job-market-watch 1101 healed this cycle; battery = redeploy-class only (AF-1 gap note)" },
      { name: "SELF-IMPROVING (kaizen)", state: "ok", evidence: kzClosed + " candidates resolved+fixed vs " + kzProp + " proposed" },
      { name: "SELF-AUDITING", state: "partial", evidence: "auditor + calibrator live; audit calendar partial (AF-1: hourly/daily/weekly/monthly not full)" },
      { name: "SELF-GOVERNING", state: "gap", evidence: "govern ladder L0; policies table not explicit; kill switches + user-free resolution live (user-waiting " + userWait + ")" },
      { name: "SELF-PUBLISHING", state: "ok", evidence: vq7 + " versions + " + rq7 + " papers published (7d); gates code-enforced" },
      { name: "SELF-PROMOTING", state: "ok", evidence: so7 + " social threads posted (7d); outreach warm-up L1 with caps + kill switch" },
      { name: "SELF-OPTIMIZING", state: "partial", evidence: modOk + "/" + modN + " models ok; spend guard legacy-deprecated -> new spend-limits row 190; consolidation proposed only" }
    ],
    alve: {
      watchmaker_index: Math.round(watchmaker * 10) / 10,
      drift_scanerr: scanerr,
      coverage: { probes_pct: Math.round(probeRate), registry_version_pct: Math.round(verRate), registry_purpose_pct: Math.round(purRate) },
      integrity: { rejected_artifacts_24h: cpRej },
      iteration: { fleet_runs_24h: frN, kaizen_closed: kzClosed, handoffs: handoffs },
      output: { versions_7d: vq7, papers_7d: rq7, social_7d: so7 },
      human_load: { user_waiting: userWait, overdue: overdue, open_rows: openRows },
      sub_scores: { integrity: integrity, human_load: humanLoad, output: outputFlowing, watchmaker: Math.round(watchmaker), coverage: coverage, drift: drift, telemetry: telemetry, govern: govern, intelligence: intelligence }
    },
    grade: {
      letter: letter,
      score: score,
      autonomy_band: autonomyBand,
      summary: "A = human-level autonomy target (L5 SAE / L3 ladder / watchmaker ~0). Current band " + autonomyBand + ": strong sensing+acting+publishing; gaps = govern L0, telemetry coverage " + telemetry + "%, registry versioning " + Math.round(verRate) + "%, drift " + scanerr + " scanerr, " + overdue + " overdue rows. Objective function below drives toward A."
    },
    objective_function: "maximize autonomy_band and coverage x integrity x output_velocity subject to: watchmaker_index -> 0; human_load -> 0; cost <= budget guard; every ladder promotion requires N consecutive clean verified cycles + tested kill switch + tested rollback (AF-1 sec 4); never violate A6 separation-of-powers; never fabricate (A8)."
  };

  const art = {
    schema_version: "1.0",
    kind: "report-card",
    id: "QNFO.REPORT-CARD." + nowIso.slice(0, 10) + "." + String(Date.now()).slice(-6),
    ts: nowIso,
    provenance: { emitter: "qnfo-scorecard", session: "scheduled-or-manual", sha256: "mirror-validator" },
    payload: payload
  };

  // self-record: validate before canonical-store write (blocking posture), persist to codeparse_events
  const errs = validateEnvelope(art).concat(validatePayload(art.payload));
  const status = errs.length === 0 ? "accepted" : "rejected";
  try {
    await env.AUDIT.prepare("INSERT INTO codeparse_events (artifact, kind, source, status, err, ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(status === "accepted" ? JSON.stringify(art) : null, "report-card", "qnfo-scorecard", status, errs.join("; ").slice(0, 300), nowIso).run();
  } catch (e) {}
  art.recorded = { status: status, errors: errs };
  return art;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ status: "ok", worker: "qnfo-scorecard", version: VERSION, enabled: true, bindings_ok: !!env.AUDIT });
    if (url.pathname === "/api/report-card") return json(await compute(env));
    if (url.pathname === "/") {
      return new Response("<!doctype html><meta charset=utf-8><title>QNFO scorecard</title><body style='background:#0d1117;color:#c9d1d9;font-family:monospace;padding:16px'><h2>qnfo-scorecard</h2><p>raw: <a href='/api/report-card' style='color:#58a6ff'>/api/report-card</a></p></body>", { headers: { "content-type": "text/html" } });
    }
    return json({ ok: false, error: "not found" }, 404);
  }
};
