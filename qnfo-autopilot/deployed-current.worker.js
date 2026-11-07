var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var VERSION = "0.3.7-model-floor-1";
var NAME = "qnfo-autopilot";
var DASH = "https://fleet.qnfo.org/api/state";
var UA = "qnfo-autopilot/" + VERSION;
function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
__name(json, "json");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
async function ensureSchema(env) {
  await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS worker_activity_daily (id INTEGER PRIMARY KEY AUTOINCREMENT, worker_name TEXT NOT NULL, day TEXT NOT NULL, req24 INTEGER, source TEXT, ts TEXT)").run();
  await env.AUDIT.prepare("CREATE INDEX IF NOT EXISTS idx_wad_day ON worker_activity_daily(day)").run();
  await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS evolve_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, worker TEXT NOT NULL, ts TEXT, status TEXT DEFAULT 'proposed', proposal TEXT, sha256 TEXT)").run();
}
__name(ensureSchema, "ensureSchema");
async function overdueCensus(env) {
  const r = await env.AUDIT.prepare("SELECT id, source_row_id, title, due FROM task_dod_register WHERE status = 'open' AND due IS NOT NULL AND due <= ?1 ORDER BY due LIMIT 100").bind(nowIso().slice(0, 10)).all();
  return r.results || [];
}
__name(overdueCensus, "overdueCensus");
async function activitySnapshot(env) {
  let st;
  try {
    const resp = await fetch(DASH, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(2e4) });
    if (!resp.ok) return { ok: false, why: "dash " + resp.status };
    st = await resp.json();
  } catch (e) {
    return { ok: false, why: String(e && e.message ? e.message : e).slice(0, 60) };
  }
  const sched = st.scheduled || [];
  const day = nowIso().slice(0, 10);
  let inserted = 0;
  for (const s of sched) {
    if (!s.name || s.req24 == null) continue;
    await env.AUDIT.prepare("INSERT INTO worker_activity_daily (worker_name, day, req24, source, ts) VALUES (?1, ?2, ?3, 'dashboard-scheduled-req24', ?4)").bind(s.name, day, s.req24, nowIso()).run();
    inserted++;
  }
  return { ok: true, inserted, workers: sched.length };
}
__name(activitySnapshot, "activitySnapshot");
async function cycle(env) {
  await ensureSchema(env);
  const overdue = await overdueCensus(env);
  const activity = await activitySnapshot(env);
  const report = { ts: nowIso(), version: VERSION, overdue_count: overdue.length, overdue: overdue.slice(0, 20), activity };
  try {
    await env.AUDIT.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, ?2, 'autopilot-cycle', ?3, ?4, ?5, 'ok')").bind("autopilot-" + nowIso().slice(0, 13), nowIso(), "autopilot cycle: " + overdue.length + " overdue register rows; activity snapshot " + (activity.inserted || 0) + " workers", JSON.stringify(report), NAME).run();
  } catch (e) {
  }
  return report;
}
__name(cycle, "cycle");
var GH_API = "https://api.github.com";
var B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64C[b0 >> 2] + B64C[(b0 & 3) << 4 | b1 >> 4];
    out += i + 1 < bytes.length ? B64C[(b1 & 15) << 2 | b2 >> 6] : "=";
    out += i + 2 < bytes.length ? B64C[b2 & 63] : "=";
  }
  return out;
}
__name(b64encode, "b64encode");
async function gitCommit(env, owner, repo, path, content, message) {
  const tok = env.GITHUB_TOKEN;
  if (!tok) return { ok: false, why: "no GITHUB_TOKEN secret" };
  const url = GH_API + "/repos/" + owner + "/" + repo + "/contents/" + path;
  const hdrs = { "Authorization": "Bearer " + tok, "User-Agent": UA, "Accept": "application/vnd.github+json" };
  const body = { message, content: b64encode(content), branch: "main" };
  try {
    const ex = await fetch(url + "?ref=main", { headers: hdrs });
    if (ex.ok) {
      const j = await ex.json();
      if (j && j.sha) body.sha = j.sha;
    }
  } catch (e) {
  }
  try {
    const resp = await fetch(url, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, hdrs), body: JSON.stringify(body) });
    const j = await resp.json();
    return { ok: resp.ok, status: resp.status, commit: j.commit && j.commit.sha ? String(j.commit.sha).slice(0, 7) : null, path: j.content ? j.content.path : null, error: resp.ok ? null : String(j.message || "").slice(0, 120) };
  } catch (e) {
    return { ok: false, why: String(e && e.message ? e.message : e).slice(0, 120) };
  }
}
__name(gitCommit, "gitCommit");
async function publishReport(env) {
  let st;
  try {
    const resp = await fetch(DASH, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(2e4) });
    if (!resp.ok) return { ok: false, why: "dash " + resp.status };
    st = await resp.json();
  } catch (e) {
    return { ok: false, why: String(e && e.message ? e.message : e).slice(0, 60) };
  }
  const rc = st.report_card || {};
  const ig = st.integration || {};
  const sys = ig.system || {};
  const day = nowIso().slice(0, 10);
  const md = [
    "# QNFO Autopilot Report " + day,
    "",
    "> Generated autonomously by qnfo-autopilot " + VERSION + " (cloud; no local python/git).",
    "",
    "## Autonomy ladder",
    "- LoA: " + (rc.loa || "?") + " (" + (rc.loa_label || "") + ")",
    "- AGI level: " + (rc.agi || "?"),
    "- VSM: " + (rc.vsm || "?"),
    "- OODA: " + (rc.ooda || "?"),
    "- Watchmaker (human-gated ops): " + (rc.watchmaker || "?"),
    "- Drift: ghost " + (rc.drift && rc.drift.ghost || 0) + ", unregistered " + (rc.drift && rc.drift.unregistered || 0) + ", unversioned " + (rc.drift && rc.drift.unversioned || 0),
    "",
    "## System integration score",
    "- Total: " + (sys.score && sys.score.total || "?") + "/100 (chains " + (sys.score && sys.score.chains || "?") + " / coverage " + (sys.score && sys.score.coverage || "?") + " / freshness " + (sys.score && sys.score.freshness || "?") + ")",
    "- Coverage: " + JSON.stringify(sys.coverage || {}),
    "",
    "## Opportunities",
    (sys.opportunities || []).map(function(o) {
      return "- [" + o.kind + "] " + o.text;
    }).join("\n") || "- none",
    "",
    "## Fleet",
    "- Workers: " + (st.fleet && st.fleet.workers || "?") + " | Scheduled: " + (st.fleet && st.fleet.scheduled || "?") + " | Probes: " + (st.fleet && st.fleet.probes || "?"),
    ""
  ].join("\n");
  return await gitCommit(env, "QNFO", "qnfo-ops", "docs/AUTOPILOT-REPORT-" + day + ".md", md, "autopilot: cloud-generated report " + day);
}
__name(publishReport, "publishReport");
var CF_API = "https://api.cloudflare.com/client/v4/accounts/edb167b78c9fb901ea5bca3ce58ccc4b";
var EVOLVE_MODEL = "@cf/moonshotai/kimi-k2.6";
var THINK_MODEL = "@cf/zai-org/glm-5.3";
var COVERAGE = [
  "paper-hub",
  "jnl-pipeline",
  "qnfo-email",
  "qnfo-ai-search",
  "obsidian-writer",
  "qnfo-lifecycle",
  "calendar-api",
  "radar-hub",
  "qnfo-events",
  "qnfo-archive",
  "qnfo-chat-canary",
  "qnfo-ddocs-indexer",
  "qnfo-impact",
  "qnfo-proof",
  "qnfo-thread-ingest"
];
function sbName(w) {
  return "SB_" + w.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}
__name(sbName, "sbName");
var SERVICE_BINDINGS = {};
for (_ci = 0; _ci < COVERAGE.length; _ci++) {
  SERVICE_BINDINGS[COVERAGE[_ci]] = sbName(COVERAGE[_ci]);
}
var _ci;
function unwrap(raw) {
  if (!raw || raw.indexOf("Content-Disposition") < 0) return raw;
  const m = raw.match(/Content-Type: [^\r\n]+\r\n\r\n/);
  if (!m) return raw;
  const idx = raw.indexOf(m[0]) + m[0].length;
  let code = raw.slice(idx);
  const bm = code.match(/\r\n--[A-Za-z0-9]+--\r?\n?$/);
  if (bm) code = code.slice(0, code.length - bm[0].length);
  return code;
}
__name(unwrap, "unwrap");
async function sha256hex(str) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(d)].map(function(b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}
__name(sha256hex, "sha256hex");
async function evolvePropose(env, worker, goal) {
  if (!env.CF_API_TOKEN) return { ok: false, why: "no CF_API_TOKEN secret" };
  if (!env.AI) return { ok: false, why: "no AI binding" };
  let code;
  try {
    const resp = await fetch(CF_API + "/workers/scripts/" + worker + "/content/v2", { headers: { "Authorization": "Bearer " + env.CF_API_TOKEN, "User-Agent": UA } });
    if (!resp.ok) return { ok: false, why: "source " + resp.status };
    const raw = await resp.text();
    code = unwrap(raw);
  } catch (e) {
    return { ok: false, why: String(e && e.message ? e.message : e).slice(0, 80) };
  }
  const prompt = "You are improving a Cloudflare Worker. Goal: " + (goal || "add a /version endpoint that returns JSON {ok:true,version}") + ". Here is the current module source:\n\n" + code.slice(0, 16e3) + "\n\nReturn ONLY the complete modified source (JavaScript, valid module syntax).";
  let proposal;
  try {
    const out = await aiRunAttr(env, "qnfo-autopilot", "evolve", EVOLVE_MODEL, { messages: [{ role: "user", content: prompt }], max_tokens: 4096 });
    proposal = typeof out === "string" ? out : out.response || JSON.stringify(out);
  } catch (e) {
    return { ok: false, why: "AI " + String(e && e.message ? e.message : e).slice(0, 80) };
  }
  const hash = await sha256hex(proposal);
  try {
    await env.AUDIT.prepare("INSERT INTO evolve_candidates (worker, ts, status, proposal, sha256) VALUES (?1, ?2, ?3, ?4, ?5)").bind(worker, nowIso(), "proposed", proposal, hash).run();
  } catch (e) {
  }
  return { ok: true, worker, candidate_bytes: proposal.length, sha256: hash.slice(0, 16), status: "proposed (NOT deployed)" };
}
__name(evolvePropose, "evolvePropose");
async function deployWorker(env, worker, code, isModule) {
  const tok = env.CF_API_TOKEN;
  if (!tok) return { ok: false, why: "no CF_API_TOKEN" };
  let bindings = [], compat = "2026-08-01", flags = [];
  try {
    const s = await fetch(CF_API + "/workers/scripts/" + worker + "/settings", { headers: { "Authorization": "Bearer " + tok, "User-Agent": UA } });
    if (s.ok) {
      const j = await s.json();
      const r = j.result || {};
      bindings = r.bindings || [];
      if (r.compatibility_date) compat = r.compatibility_date;
      if (r.compatibility_flags) flags = r.compatibility_flags;
    }
  } catch (e) {
  }
  const norm = (bindings || []).map(function(b2) {
    const t = b2.type;
    if (t === "secret_text" || t === "plain_text") return null;
    const out = { name: b2.name, type: t };
    if (t === "d1") {
      if (b2.database_id) out.database_id = b2.database_id;
    } else if (t === "kv_namespace") {
      if (b2.namespace_id) out.namespace_id = b2.namespace_id;
    } else if (t === "r2_bucket") {
      if (b2.bucket_name) out.bucket_name = b2.bucket_name;
    } else if (t === "service") {
      if (b2.service) out.service = b2.service;
      if (b2.environment) out.environment = b2.environment;
    } else if (t === "queue") {
      if (b2.queue_name) out.queue_name = b2.queue_name;
    } else if (t === "vectorize") {
      if (b2.index_name) out.index_name = b2.index_name;
    } else if (t === "durable_object_namespace") {
      if (b2.namespace_id) out.namespace_id = b2.namespace_id;
      if (b2.class_name) out.class_name = b2.class_name;
    } else if (t === "analytics_engine") {
      if (b2.dataset) out.dataset = b2.dataset;
    } else if (t === "ai" || t === "browser" || t === "send_email") {
    } else if (t === "workflow") {
      for (const k in b2) {
        if (k !== "name" && k !== "type") out[k] = b2[k];
      }
    } else {
      for (const k in b2) {
        if (k !== "name" && k !== "type" && k !== "id" && k !== "project" && k !== "version") out[k] = b2[k];
      }
    }
    return out;
  }).filter(function(x) {
    return x !== null;
  });
  const meta = { bindings: norm, compatibility_date: compat };
  if (isModule) meta.main_module = "worker.js";
  else meta.body_part = "script";
  if (flags.length) meta.compatibility_flags = flags;
  const CRLF = "\r\n";
  const b = "----QNFO-EVOLVE-" + Date.now();
  const partName = isModule ? "worker.js" : "script";
  const ctype = isModule ? "application/javascript+module" : "application/javascript";
  const parts = ["--" + b, 'Content-Disposition: form-data; name="metadata"', "Content-Type: application/json", "", JSON.stringify(meta), "--" + b, 'Content-Disposition: form-data; name="' + partName + '"; filename="' + partName + '"', "Content-Type: " + ctype, "", code, "--" + b + "--"];
  try {
    const resp = await fetch(CF_API + "/workers/scripts/" + worker, { method: "PUT", headers: { "Authorization": "Bearer " + tok, "User-Agent": UA, "Content-Type": "multipart/form-data; boundary=" + b }, body: parts.join(CRLF) });
    const j = await resp.json();
    if (!resp.ok) return { ok: false, why: "PUT " + resp.status + " " + String((j.errors || []).map(function(e) {
      return e.code + ":" + String(e.message).slice(0, 60);
    }).join("|") || j).slice(0, 140) };
    return { ok: true };
  } catch (e) {
    return { ok: false, why: String(e && e.message ? e.message : e).slice(0, 120) };
  }
}
__name(deployWorker, "deployWorker");
async function workerDomains(env, worker) {
  try {
    const r = await fetch(CF_API + "/workers/domains", { headers: { "Authorization": "Bearer " + env.CF_API_TOKEN, "User-Agent": UA } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.result || []).filter(function(d) {
      return d.worker_name && d.worker_name === worker || d.script && d.script === worker;
    }).map(function(d) {
      return d.hostname;
    });
  } catch (e) {
    return [];
  }
}
__name(workerDomains, "workerDomains");
async function verifyHealth(env, worker) {
  const sbName2 = SERVICE_BINDINGS[worker];
  if (sbName2 && env[sbName2]) {
    try {
      const resp = await env[sbName2].fetch("https://internal/health", { headers: { "User-Agent": UA } });
      const txt = await resp.text();
      if (resp.status >= 500) return { ok: false, why: "svc-binding http " + resp.status + " " + txt.slice(0, 50) };
      return { ok: true, why: "svc-binding http " + resp.status };
    } catch (e) {
      return { ok: false, why: "svc-binding unreachable " + String(e && e.message ? e.message : e).slice(0, 40) };
    }
  }
  try {
    const fresh = new Date(Date.now() - 30 * 60 * 1e3).toISOString();
    const hb = await env.AUDIT.prepare("SELECT ok, ts FROM fleet_heartbeat WHERE worker = ?1").bind(worker).first();
    if (hb && hb.ts && hb.ts >= fresh) return hb.ok === 1 ? { ok: true, why: "heartbeat ok " + hb.ts } : { ok: false, why: "heartbeat failure " + hb.ts };
  } catch (e) {
  }
  const domains = await workerDomains(env, worker);
  for (const d of domains) {
    try {
      const resp = await fetch("https://" + d + "/health", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(1e4) });
      const txt = await resp.text();
      if (resp.status >= 500) return { ok: false, why: "http " + resp.status + " " + txt.slice(0, 50) };
      return { ok: true, why: "custom-domain " + d + " http " + resp.status };
    } catch (e) {
    }
  }
  try {
    const resp = await fetch("https://" + worker + ".q08.workers.dev/health", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(1e4) });
    const txt = await resp.text();
    if (txt.indexOf("1042") >= 0) return { ok: true, why: "no-reachable-domain (deploy-parses only)" };
    if (resp.status >= 500) return { ok: false, why: "http " + resp.status + " " + txt.slice(0, 50) };
    if (resp.status === 404) return { ok: true, why: "no /health route (worker serving)" };
    return { ok: true, why: "http " + resp.status };
  } catch (e) {
    return { ok: false, why: "unreachable " + String(e && e.message ? e.message : e).slice(0, 40) };
  }
}
__name(verifyHealth, "verifyHealth");
async function evolveApply(env, worker, candidateId, goal) {
  await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS evolve_rollback (id INTEGER PRIMARY KEY AUTOINCREMENT, worker TEXT, ts TEXT, source TEXT, sha256 TEXT)").run();
  let proposal = null;
  if (candidateId) {
    const row = await env.AUDIT.prepare("SELECT proposal, sha256 FROM evolve_candidates WHERE id = ?1").bind(Number(candidateId)).first();
    if (row) proposal = row.proposal;
  }
  if (!proposal) {
    const p = await evolvePropose(env, worker, goal);
    if (!p.ok) return p;
    const row = await env.AUDIT.prepare("SELECT proposal, sha256 FROM evolve_candidates ORDER BY id DESC LIMIT 1").first();
    proposal = row.proposal;
  }
  if (!proposal) return { ok: false, why: "no candidate" };
  let current;
  try {
    const resp = await fetch(CF_API + "/workers/scripts/" + worker + "/content/v2", { headers: { "Authorization": "Bearer " + env.CF_API_TOKEN, "User-Agent": UA } });
    if (!resp.ok) return { ok: false, why: "snapshot read " + resp.status };
    current = unwrap(await resp.text());
  } catch (e) {
    return { ok: false, why: "snapshot " + String(e && e.message ? e.message : e).slice(0, 60) };
  }
  const isModule = current.indexOf("export default") >= 0 || current.indexOf("export {") >= 0 || current.indexOf("export{") >= 0 || current.indexOf("export ") >= 0 || current.indexOf("__esm") >= 0;
  const rbHash = await sha256hex(current);
  await env.AUDIT.prepare("INSERT INTO evolve_rollback (worker, ts, source, sha256) VALUES (?1, ?2, ?3, ?4)").bind(worker, nowIso(), current, rbHash).run();
  const put = await deployWorker(env, worker, proposal, isModule);
  if (!put.ok) {
    await env.AUDIT.prepare("UPDATE evolve_candidates SET status = 'rejected-parse' WHERE sha256 = ?1").bind(await sha256hex(proposal)).run();
    return { ok: false, why: "deploy rejected (parse): " + put.why, reverted: false };
  }
  await new Promise(function(r) {
    setTimeout(r, 1e4);
  });
  const h = await verifyHealth(env, worker);
  if (h.ok) {
    await new Promise(function(r) {
      setTimeout(r, 8e3);
    });
    const h2 = await verifyHealth(env, worker);
    if (!h2.ok) {
      h.ok = false;
      h.why = h2.why;
    }
  }
  if (!h.ok) {
    const rb = await deployWorker(env, worker, current, isModule);
    await env.AUDIT.prepare("UPDATE evolve_candidates SET status = 'auto-reverted' WHERE sha256 = ?1").bind(await sha256hex(proposal)).run();
    return { ok: false, why: "verify failed -> AUTO-REVERTED", reverted: rb.ok, verify: h.why, rollback_point: rbHash.slice(0, 16) };
  }
  await env.AUDIT.prepare("UPDATE evolve_candidates SET status = 'applied' WHERE sha256 = ?1").bind(await sha256hex(proposal)).run();
  return { ok: true, worker, applied: true, verify: h.why, rollback_point: rbHash.slice(0, 16) };
}
__name(evolveApply, "evolveApply");
var SEED_WORKERS = COVERAGE;
async function autonomousApply(env) {
  await ensureSchema(env);
  await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS self_rewrite_state (id INTEGER PRIMARY KEY AUTOINCREMENT, worker TEXT, ts TEXT, action TEXT, status TEXT, detail TEXT)").run();
  let worker = null, candidateId = null;
  const pend = await env.AUDIT.prepare("SELECT worker, id FROM evolve_candidates WHERE status = 'proposed' ORDER BY id ASC LIMIT 1").first();
  if (pend) {
    worker = pend.worker;
    candidateId = pend.id;
  } else {
    const last = await env.AUDIT.prepare("SELECT worker FROM self_rewrite_state WHERE action = 'apply' ORDER BY id DESC LIMIT 1").first();
    const lastW = last ? last.worker : null;
    const idx = lastW ? (SEED_WORKERS.indexOf(lastW) + 1) % SEED_WORKERS.length : 0;
    worker = SEED_WORKERS[idx] || SEED_WORKERS[0];
  }
  if (!worker) return { ok: true, skipped: "no target" };
  const result = await evolveApply(env, worker, candidateId, candidateId ? null : "self-improvement: keep behavior identical, add or fix a small non-functional detail");
  const status = result.ok ? "applied" : "reverted-or-rejected";
  await env.AUDIT.prepare("INSERT INTO self_rewrite_state (worker, ts, action, status, detail) VALUES (?1, ?2, ?3, ?4, ?5)").bind(worker, nowIso(), "apply", status, String(result.why || result.verify || "ok").slice(0, 220)).run();
  return result;
}
__name(autonomousApply, "autonomousApply");
// INVEST-DECISION-1: the hourly think-loop spends model tokens to generate new research questions. When the
// investment verdict (qnfo-fleet-dashboard, metric_registry.invest_decision_level) is scale back (2) or stop (3) and
// fresh (<3h), pause it: a reversible, spend-reducing T1 action. Unreadable or stale signals never pause anything.
async function investPaused(env) {
  try {
    const r = await env.AUDIT.prepare("SELECT last_value, last_refreshed FROM metric_registry WHERE metric = 'invest_decision_level'").first();
    if (!r || r.last_value == null) return null;
    const age = Date.now() - Date.parse(String(r.last_refreshed || ""));
    const lvl = Number(r.last_value);
    return isFinite(lvl) && lvl >= 2 && age < 3 * 36e5 ? lvl : null;
  } catch (e) {
    return null;
  }
}
__name(investPaused, "investPaused");
async function thinkLoop(env) {
  const _paused = await investPaused(env);
  if (_paused != null) return { ok: true, skipped: "invest-decision level " + _paused + " (scale back / stop): think-loop paused" };
  await ensureSchema(env);
  await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS self_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, question TEXT, hypothesis TEXT, source TEXT, status TEXT)").run();
  try {
    const ai = await aiRunAttr(env, "qnfo-autopilot", "think", THINK_MODEL, {
      messages: [
        { role: "system", content: 'You are the QNFO research collective. Propose ONE novel, falsifiable research question the fleet should investigate next. Output strict JSON only: {"question": "...", "hypothesis": "...", "why": "..."}. No markdown.' },
        { role: "user", content: "Generate one novel research question. Consider energy-efficient computing, quantum foundations, information thermodynamics, or a gap in the existing corpus." }
      ],
      max_tokens: 1024
    });
    let text = "";
    const _m = ai && ai.choices && ai.choices[0] && ai.choices[0].message;
    if (_m && typeof _m.content === "string" && _m.content.trim()) text = _m.content.trim();
    else if (ai && typeof ai.response === "string") text = ai.response;
    else if (typeof ai === "string") text = ai;
    if (!text) return { ok: false, why: "model empty", raw: JSON.stringify(ai || {}).slice(0, 200) };
    let q = null;
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        q = JSON.parse(m[0]);
      } catch (e) {
      }
    }
    if (!q || !q.question) {
      const qm = text.match(/"question"\s*:\s*"([^"]+)"/);
      if (qm) q = { question: qm[1], hypothesis: "" };
    }
    if (q && q.question) {
      const _sig = /* @__PURE__ */ __name((s) => {
        const o = /* @__PURE__ */ new Set();
        for (const w of String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)) {
          if (w.length > 4) o.add(w);
        }
        return o;
      }, "_sig");
      const _contain = /* @__PURE__ */ __name((a, b) => {
        if (!a.size || !b.size) return 0;
        let n = 0;
        for (const x of a) if (b.has(x)) n++;
        return n / Math.min(a.size, b.size);
      }, "_contain");
      const _cand = _sig(q.question);
      const _recent = await env.AUDIT.prepare("SELECT question FROM self_questions WHERE status='open' AND ts >= ?1").bind(new Date(Date.now() - 7 * 864e5).toISOString()).all();
      const _dup = (_recent.results || []).some(function(r) {
        return _contain(_cand, _sig(r.question)) >= 0.6;
      });
      if (_dup) return { ok: true, skipped: "near-duplicate theme", question: String(q.question).slice(0, 120) };
      await env.AUDIT.prepare("INSERT INTO self_questions (ts, question, hypothesis, source, status) VALUES (?1, ?2, ?3, ?4, ?5)").bind(nowIso(), String(q.question).slice(0, 300), String(q.hypothesis || "").slice(0, 300), "think-loop", "open").run();
      const qh = (await sha256hex(String(q.question))).slice(0, 8);
      const existing = await env.AUDIT.prepare("SELECT id FROM idea_proposals WHERE ip_hash = ?1 LIMIT 1").bind(qh).first();
      if (!existing) {
        await env.AUDIT.prepare("INSERT INTO idea_proposals (name, idea, contact, status, ip_hash, created_at) VALUES ('think-loop', ?1, '', 'new', ?2, ?3)").bind(JSON.stringify({ ideas: [String(q.question)] }), qh, nowIso()).run();
      }
      return { ok: true, question: q.question, routed: !existing };
    }
    return { ok: false, why: "no parseable question" };
  } catch (e) {
    return { ok: false, why: String(e && e.message ? e.message : e).slice(0, 120) };
  }
}
__name(thinkLoop, "thinkLoop");
var worker_default = {
  async scheduled(controller, env, ctx) {
    await ensureSchema(env);
    ctx.waitUntil((async function() {
      try {
        await cycle(env);
      } catch (e) {
      }
    })());
    ctx.waitUntil((async function() {
      try {
        await autonomousApply(env);
      } catch (e) {
      }
    })());
    ctx.waitUntil((async function() {
      try {
        await thinkLoop(env);
      } catch (e) {
      }
    })());
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";
    await ensureSchema(env);
    if (p === "/health") return json({ ok: true, name: NAME, version: VERSION });
    if (p === "/run/cycle") return json({ ok: true, report: await cycle(env) });
    if (p === "/git/commit" && request.method === "POST") {
      let b = {};
      try {
        b = await request.json();
      } catch (e) {
        return json({ ok: false, error: "bad json" }, 400);
      }
      if (!b.owner || !b.repo || !b.path || b.content == null) return json({ ok: false, error: "need owner, repo, path, content" }, 400);
      const r = await gitCommit(env, b.owner, b.repo, b.path, String(b.content), b.message || "autopilot commit " + nowIso().slice(0, 16));
      return json({ ok: r.ok, commit: r });
    }
    if (p === "/publish/report") {
      return json({ ok: true, commit: await publishReport(env) });
    }
    if (p === "/evolve/propose" && request.method === "POST") {
      let b = {};
      try {
        b = await request.json();
      } catch (e) {
        return json({ ok: false, error: "bad json" }, 400);
      }
      if (!b.worker) return json({ ok: false, error: "need worker" }, 400);
      return json({ ok: true, proposal: await evolvePropose(env, b.worker, b.goal) });
    }
    if (p === "/evolve/apply" && request.method === "POST") {
      let b = {};
      try {
        b = await request.json();
      } catch (e) {
        return json({ ok: false, error: "bad json" }, 400);
      }
      if (!b.worker) return json({ ok: false, error: "need worker" }, 400);
      return json({ ok: true, apply: await evolveApply(env, b.worker, b.candidate_id, b.goal) });
    }
    if (p === "/run/apply" && request.method === "POST") {
      const result = await autonomousApply(env);
      return json({ ok: true, result });
    }
    if (p === "/run/think" && request.method === "POST") {
      const result = await thinkLoop(env);
      return json({ ok: true, result });
    }
    if (p === "/heartbeat" && request.method === "POST") {
      let b = {};
      try {
        b = await request.json();
      } catch (e) {
        return json({ ok: false, error: "bad json" }, 400);
      }
      if (!b.worker) return json({ ok: false, error: "need worker" }, 400);
      await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS fleet_heartbeat (worker TEXT PRIMARY KEY, version TEXT, ts TEXT, ok INTEGER)").run();
      await env.AUDIT.prepare("INSERT OR REPLACE INTO fleet_heartbeat (worker, version, ts, ok) VALUES (?1, ?2, ?3, ?4)").bind(b.worker, String(b.version || ""), nowIso(), b.ok === false ? 0 : 1).run();
      return json({ ok: true, heartbeat: true });
    }
    return json({ ok: false, error: "not found", endpoints: ["/health", "/run/cycle", "/git/commit", "/publish/report", "/evolve/propose", "/evolve/apply", "/heartbeat"] }, 404);
  }
};
// WORKERS-AI-SPEND-UNATTRIBUTED-RISING-1 (#1681): every env.AI.run in this worker goes through aiRunAttr, which adds a
// per-worker/purpose call counter to D1 ai_call_counters (one UPSERT per call, fail-soft, never blocks or alters the AI call).
// Copied from qnfo-fleet-control (workers cannot import across directories); same table/columns. No new paid service.
// Unlike fleet-control the counter write is NOT awaited (fire-and-forget, errors swallowed) so it can never add latency.
// W-META-FLEET-1 (0.3.7, agent_issues #8368/#8366 class, fleet-wide): in_tok/out_tok/neurons now recorded from the
// response usage at Cloudflare's per-model neuron rates (same columns and rate table as the fleet __aiAttrEnv helper).
var AI_ATTR_DB_BINDINGS = ["AUDIT_DB","AUDIT","DB_AUDIT","QNFO_AUDIT"];
var AI_ATTR_RATES = { "@cf/zai-org/glm-5.3": [127273, 400000], "@cf/zai-org/glm-5.3-flash": [13636, 45455], "@cf/nvidia/nemotron-3-120b-a12b": [45455, 136364], "@cf/moonshotai/kimi-k2.6": [86364, 363636], "@cf/moonshotai/kimi-k2.7-code": [86364, 363636], "@cf/openai/gpt-oss-120b": [31818, 68182], "@cf/openai/gpt-oss-20b": [18182, 27273], "@cf/deepseek-ai/deepseek-v4-pro-0813": [120000, 360000], "@cf/deepseek-ai/deepseek-v4-flash-0731": [40000, 120000], "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [26668, 204805], "@cf/qwen/qwen3-30b-a3b-fp8": [4625, 30475], "@cf/qwen/qwen3.8-27b": [40909, 290909], "@cf/baai/bge-base-en-v1.5": [6058, 0], "@cf/baai/bge-small-en-v1.5": [1841, 0], "@cf/baai/bge-large-en-v1.5": [18582, 0] };
async function aiRunAttr(env, worker, purpose, model, input, opts) {
  var t0 = Date.now(), ok = 1, res;
  try { res = await env.AI.run(model, input, opts); return res; } catch (e) { ok = 0; throw e; }
  finally {
    try {
      var db = null;
      for (var bi = 0; bi < AI_ATTR_DB_BINDINGS.length && !db; bi++) db = env[AI_ATTR_DB_BINDINGS[bi]];
      if (db) {
        var ic = 0; try { ic = JSON.stringify(input && input.messages || input || "").length; } catch (e2) {}
        var day = new Date().toISOString().slice(0, 10);
        var ms = Date.now() - t0;
        var u = (ok && res && typeof res === "object" && res.usage) || {};
        var isEmbed = /bge|embed|whisper|m2m100|resnet|flux|sdxl/i.test(String(model));
        var inTok = Number(u.prompt_tokens || u.input_tokens || 0) || (isEmbed ? 0 : Math.round(ic / 4));
        var outTok = Number(u.completion_tokens || u.output_tokens || 0);
        var r = AI_ATTR_RATES[String(model)] || [0, 0];
        var neurons = (inTok * r[0] + outTok * r[1]) / 1e6;
        var wr = (async function() {
          await db.prepare("CREATE TABLE IF NOT EXISTS ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model))").run();
          await db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, in_chars, ms, in_tok, out_tok, neurons) VALUES (?1,?2,?3,?4,1,?5,?6,?7,?8,?9,?10) ON CONFLICT(day, worker, purpose, model) DO UPDATE SET calls=calls+1, errors=errors+?5, in_chars=in_chars+?6, ms=ms+?7, in_tok=in_tok+?8, out_tok=out_tok+?9, neurons=neurons+?10").bind(day, worker, purpose, String(model), ok ? 0 : 1, ic, ms, inTok, outTok, neurons).run();
        })();
        wr.catch(function() {});
      }
    } catch (e3) {}
  }
}
// end aiRunAttr
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map