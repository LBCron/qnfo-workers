// qnfo-auditor v1.0.0 - Fleet Event Audit & Act loop (REVIEW -> AUDIT -> ACT -> LEARN).
// Reviews/audits/acts on ALL QNFO event & log stores automatically, unattended:
//   issue_ledger/issue_events (qnfo-events), cloud_ops_events (qnfo-cloud-ops scheduler),
//   alerts, agent_issues, audit_trail, deployment_history, errata_queue/errata_actions,
//   kaizen_reports. Produces run records (fleet_audit_runs) + improvement candidates
//   (kaizen_candidates) feeding self-awareness and continuous improvement.
// Checks: C1 stale-open-high, C2 auto-close-stale-low, C3 reopen-on-recurrence,
//   C4 job-silence, C5 events-sweep-lag, C6 agent-issue bridge, C7 errata-stuck,
//   C8 kaizen feed, C9 digest state machine.
// Canonical source: QNFO/qnfo-workers/qnfo-auditor (FLEET-SELF-DOC-1)
// Deploy: wrangler deploy from this dir; secrets: AUDITOR_TOKEN, DIGEST_TO.
var VERSION = "1.1.7";
var SELF = { purpose: "fleet event/log audit + act + feedback loops (automated, user-free)", checks: ["C1","C2","C3","C4","C5","C6","C7","C8","C9","C10","F1","F2","F3","F4"] };
var HUMAN_DOMAINS = new Set("outlook.com hotmail.com live.com msn.com gmail.com yahoo.com ymail.com icloud.com me.com mac.com protonmail.com proton.me zoho.com aol.com gmx.com tutanota.com".split(" "));
function json(o, st) { return new Response(JSON.stringify(o), { status: st || 200, headers: { "Content-Type": "application/json" } }); }
function norm(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
function fpOf(source, category, title) { return hash(norm(source) + "|" + norm(category) + "|" + norm(title)); }
async function ensureSchema(env) {
  await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS fleet_audit_runs (id TEXT PRIMARY KEY, ts TEXT, mode TEXT, counts TEXT, findings TEXT, actions TEXT, digest TEXT, open_high TEXT)").run();
  await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS kaizen_candidates (id TEXT PRIMARY KEY, class TEXT, source TEXT, category TEXT, title TEXT, evidence TEXT, status TEXT DEFAULT 'proposed', created_at TEXT, updated_at TEXT)").run();
  await env.AUDIT.prepare("CREATE INDEX IF NOT EXISTS idx_fleet_audit_runs_ts ON fleet_audit_runs(ts)").run();
  await env.AUDIT.prepare("CREATE INDEX IF NOT EXISTS idx_kaizen_candidates_status ON kaizen_candidates(status)").run();
  await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS feedback_probes (k TEXT PRIMARY KEY, ts TEXT, status TEXT, code INTEGER)").run();
}
function okAuth(req, env) {
  const t = env.AUDITOR_TOKEN || "";
  if (!t) return false; // fail-closed (v1.0.2): no unauthenticated control-plane access even if a deploy drops the secret
  const h = req.headers.get("Authorization") || "";
  if (!h.startsWith("Bearer ")) return false;
  const a = h.slice(7);
  if (a.length !== t.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ t.charCodeAt(i);
  return d === 0;
}
async function qAll(env, sql, ...bind) { const r = bind.length ? await env.AUDIT.prepare(sql).bind(...bind).all() : await env.AUDIT.prepare(sql).all(); return r.results || []; }
async function q1(env, sql, ...bind) { const r = await qAll(env, sql, ...bind); return r[0] || null; }
async function ledgerEnsure(env, entry) {
  const source = String(entry.source || "unknown").slice(0, 80);
  const category = String(entry.category || "general").slice(0, 60);
  const level = String(entry.level || "info").toLowerCase();
  const title = String(entry.title || "").slice(0, 300);
  const detail = String(entry.detail || "").slice(0, 4000);
  const now = new Date().toISOString();
  const fp = fpOf(source, category, title);
  const ex = await q1(env, "SELECT fingerprint,status FROM issue_ledger WHERE fingerprint=?", fp);
  if (!ex) {
    await env.AUDIT.prepare("INSERT INTO issue_ledger (fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences, last_detail, updated_at) VALUES (?,?,?,?,?,'open',?,?,1,?,?)").bind(fp, source, level, category, title, now, now, detail, now).run();
  } else {
    await env.AUDIT.prepare("UPDATE issue_ledger SET occurrences=occurrences+1, last_seen=?, last_detail=?, updated_at=? WHERE fingerprint=?").bind(now, detail, now, fp).run();
  }
  await env.AUDIT.prepare("INSERT INTO issue_events (fingerprint, source, level, category, title, detail, ts) VALUES (?,?,?,?,?,?,?)").bind(fp, source, level, category, title, detail, now).run();
  return fp;
}
async function setFpStatus(env, fp, status, note) {
  await env.AUDIT.prepare("UPDATE issue_ledger SET status=?, last_detail=COALESCE(?,last_detail), updated_at=? WHERE fingerprint=?").bind(status, String(note || "").slice(0, 1000) || null, new Date().toISOString(), fp).run();
}
async function runAudit(env, mode, log) {
  await ensureSchema(env);
  const now = new Date().toISOString();
  const runId = "audit-" + now.replace(/[:.]/g, "-");
  const iso = (ms) => new Date(ms).toISOString();
  const cut2d = iso(Date.now() - 2 * 864e5), cut3d = iso(Date.now() - 3 * 864e5), cut7d = iso(Date.now() - 7 * 864e5), cut12h = iso(Date.now() - 12 * 3600e3), cut14d = iso(Date.now() - 14 * 864e5);
  const findings = []; const actions = [];
  const count = (arr) => arr.length;
  const F = (check, level, text) => findings.push({ check, level, text: String(text).slice(0, 600) });
  const A = (kind, text) => actions.push({ kind, text: String(text).slice(0, 600) });
  let trendLine = "";

  // ---- snapshot counts ----
  const snapshot = {};
  try { snapshot.ledger_open = (await q1(env, "SELECT COUNT(*) n FROM issue_ledger WHERE status IN ('open','acknowledged')"))?.n || 0; } catch (e) {}
  try { snapshot.open_high = await qAll(env, "SELECT fingerprint,title,source,level,occurrences,last_seen FROM issue_ledger WHERE status IN ('open','acknowledged') AND level IN ('high','critical') ORDER BY last_seen DESC"); } catch (e) { snapshot.open_high = []; }
  try { snapshot.coe_48h = (await q1(env, "SELECT COUNT(*) n FROM cloud_ops_events WHERE ts > ?", cut2d))?.n || 0; } catch (e) {}
  try { snapshot.alerts_48h = (await q1(env, "SELECT COUNT(*) n FROM alerts WHERE created_at > datetime('now','-2 day')"))?.n || 0; } catch (e) {}
  try { snapshot.agent_open = (await q1(env, "SELECT COUNT(*) n FROM agent_issues WHERE status='open'"))?.n || 0; } catch (e) {}
  try { snapshot.deploys_7d = (await q1(env, "SELECT COUNT(*) n FROM deployment_history WHERE deployed_at > datetime('now','-7 day')"))?.n || 0; } catch (e) {}

  // C1 - stale open HIGH/CRITICAL (>7d untouched)
  try {
    const stale = await qAll(env, "SELECT fingerprint,title,source,occurrences,last_seen FROM issue_ledger WHERE status IN ('open','acknowledged') AND level IN ('high','critical') AND updated_at < ?", cut7d);
    for (const s of stale) F("C1", "warning", "stale open " + s.level + " [" + s.source + "] " + String(s.title).slice(0, 160) + " (occ " + s.occurrences + ", last " + s.last_seen + ")");
    log("C1 stale-open-high: " + stale.length);
  } catch (e) { F("C1", "error", "check failed: " + e.message); }

  // C2 - auto-close stale low/warning (no recurrence >=14d, occ<=3)
  try {
    const closable = await qAll(env, "SELECT fingerprint,title,source,level,occurrences,last_seen FROM issue_ledger WHERE status='open' AND level IN ('info','warning','low') AND last_seen < ? AND occurrences<=3", cut14d);
    for (const c of closable) {
      await setFpStatus(env, c.fingerprint, "resolved", "audit auto-close (C2): no recurrence for >=14d (last " + c.last_seen + ", occ " + c.occurrences + ")");
      A("auto-close", c.source + ": " + String(c.title).slice(0, 120));
    }
    log("C2 auto-close stale low: " + closable.length);
  } catch (e) { F("C2", "error", "check failed: " + e.message); }

  // C3 - reopen resolved/acknowledged/muted entries with newer issue_events (recurrence after resolution)
  let reopenN = 0; const reopened = [];
  try {
    const rec = await qAll(env, "SELECT l.fingerprint, l.source, l.title, l.level, (SELECT COUNT(*) FROM issue_events e WHERE e.fingerprint=l.fingerprint AND e.ts > l.updated_at) AS newer FROM issue_ledger l WHERE l.status IN ('resolved','acknowledged','muted') AND EXISTS (SELECT 1 FROM issue_events e WHERE e.fingerprint=l.fingerprint AND e.ts > l.updated_at)");
    for (const r of rec) {
      await setFpStatus(env, r.fingerprint, "open", "audit reopen (C3): recurrence observed after resolution");
      reopened.push({ source: r.source, category: "reopen", title: String(r.title).slice(0, 120), fp: r.fingerprint });
      reopenN++;
    }
    log("C3 reopen-on-recurrence: " + reopenN);
  } catch (e) { F("C3", "error", "check failed: " + e.message); }

  // C4 - job silence (recurring scheduler job with no event in 48h)
  try {
    const jobs = await qAll(env, "SELECT job, COUNT(DISTINCT substr(ts,1,10)) d, MAX(ts) last FROM cloud_ops_events WHERE ts > ? AND job IS NOT NULL GROUP BY job HAVING d>=3", cut14d);
    for (const j of jobs) {
      if (String(j.last) < new Date(Date.now() - 48 * 3600e3).toISOString()) {
        F("C4", "high", "job silent >48h: " + j.job + " (last event " + j.last + ")");
        await ledgerEnsure(env, { source: "cloud-ops", category: "job-silence", level: "high", title: "Job silent >48h: " + j.job, detail: "last event " + j.last + "; recurring scheduler job stopped emitting (check cron/schedules)." });
      }
    }
    log("C4 job-silence candidates: " + jobs.length);
  } catch (e) { F("C4", "error", "check failed: " + e.message); }

  // C5 - events sweep lag (coe/alerts error rows older than 12h not yet mirrored by qnfo-events sweep)
  try {
    const lag = await qAll(env, "SELECT id, kind, text, job, ts FROM cloud_ops_events WHERE ts < ? AND ts > ? AND status IN ('error','failed','partial') AND NOT EXISTS (SELECT 1 FROM issue_events ie WHERE ie.detail='src:coe:'||cloud_ops_events.id)", cut12h, cut3d);
    if (lag.length > 0) {
      F("C5", "warning", "events-sweep-lag: " + lag.length + " coe error rows >12h old not mirrored to issue_ledger (oldest " + lag[0].ts + ")");
      await ledgerEnsure(env, { source: "auditor", category: "pipeline", level: "warning", title: "Events sweep lag: " + lag.length + " coe error rows not mirrored in 12h", detail: "qnfo-events daily 03:15 sweep latency; rows: " + lag.slice(0, 5).map((x) => x.id).join(",") });
    }
    log("C5 sweep-lag: " + lag.length);
  } catch (e) { F("C5", "error", "check failed: " + e.message); }

  // C6 - agent_issues bridge (open high/critical older than 30d -> ledger visibility)
  try {
    const old = await qAll(env, "SELECT id,title,priority,category,source FROM agent_issues WHERE status='open' AND priority IN ('high','critical') AND created_at < CAST(strftime('%s','now') AS INTEGER)-2592000 ORDER BY created_at ASC LIMIT 25");
    for (const o of old) {
      await ledgerEnsure(env, { source: "agent-issues", category: "stale-open", level: "high", title: "Stale open agent_issue #" + o.id + ": " + String(o.title).slice(0, 180), detail: "agent_issue " + o.id + " " + (o.priority || "") + " " + (o.category || "") + " open >30d (source " + (o.source || "?") + ")" });
    }
    log("C6 agent-issue bridge: " + old.length);
  } catch (e) { F("C6", "error", "check failed: " + e.message); }

  // C7 - errata stuck (queue rows not terminal after 24h)
  try {
    const stuck = await qAll(env, "SELECT id,sender,subject,status,updated_at FROM errata_queue WHERE status NOT IN ('processed','done','completed','published','resolved','cancelled','closed','audited','implemented','orphaned') AND updated_at < datetime('now','-24 hour') ORDER BY updated_at ASC LIMIT 10");
    if (stuck.length > 0) {
      F("C7", "high", "errata-stuck: " + stuck.length + " queue rows non-terminal >24h");
      for (const s of stuck.slice(0, 3)) await ledgerEnsure(env, { source: "errata", category: "stuck", level: "high", title: "Errata queue stuck >24h #" + s.id + ": " + String(s.subject || "").slice(0, 140), detail: "status " + s.status + " since " + s.updated_at + " sender " + (s.sender || "") });
    }
    // C7-ACT: verify parked pipeline-end rows ('audited'/'implemented') and close the loop user-free.
    // Sending-safe: orphan rows go to NON-sending 'orphaned'; only transient 'error' actions auto-retry.
    const parked = await qAll(env, "SELECT id,status FROM errata_queue WHERE status IN ('audited','implemented') AND updated_at < datetime('now','-24 hour')");
    for (const p of parked) {
      const act = await q1(env, "SELECT id,status,risk FROM errata_actions WHERE queue_id=? ORDER BY id DESC LIMIT 1", p.id);
      if (act && act.status === "published") {
        await env.AUDIT.prepare("UPDATE errata_queue SET status='published', updated_at=datetime('now') WHERE id=?").bind(p.id).run();
        A("errata-terminal-flip", "errata queue #" + p.id + " -> published (action " + act.id + " published)");
        log("C7-act flip queue " + p.id + " -> published");
      } else if (act && act.status === "drafted" && act.risk === "low") {
        log("C7-act queue " + p.id + " has drafted low-risk action, in publish flow");
      } else if (act && act.status === "drafted") {
        A("errata-manual-risk", "errata queue #" + p.id + " action " + act.id + " drafted but risk='" + act.risk + "' - publish selects low only, needs review");
        log("C7-act queue " + p.id + " drafted risk=" + act.risk + " needs review");
      } else if (!act) {
        await env.AUDIT.prepare("UPDATE errata_queue SET status='orphaned', updated_at=datetime('now') WHERE id=?").bind(p.id).run();
        A("errata-orphaned", "errata queue #" + p.id + " has no action row -> parked 'orphaned' (non-sending terminal)");
        log("C7-act orphan queue " + p.id + " -> orphaned");
      } else if (act.status === "error") {
        await env.AUDIT.prepare("UPDATE errata_actions SET status='drafted', updated_at=datetime('now') WHERE id=?").bind(act.id).run();
        await ledgerEnsure(env, { source: "errata", category: "publish-retry", level: "warning", title: "Errata publish retry queue #" + p.id + " (action " + act.id + " was error) -> re-drafted", detail: "auto-retry after publish failure (2026-09-04 403 delete case); repeats accumulate here for visibility" });
        A("errata-retry", "errata action " + act.id + " (error) for queue #" + p.id + " -> re-drafted for publish retry");
        log("C7-act retry action " + act.id + " -> drafted");
      } else if (["superseded","stale"].indexOf(String(act.status)) >= 0) {
        A("errata-needs-review", "errata queue #" + p.id + " action " + act.id + " status='" + act.status + "' - NOT auto-revived (may be deliberate), needs review");
        log("C7-act queue " + p.id + " action " + act.status + " needs review (no auto-send)");
      } else {
        log("C7-act queue " + p.id + " action " + act.status + ", awaiting pipeline");
      }
    }
    // C7-ACT inverse heal: queue='detected' but latest action already 'published' (respond crash window) -> terminal
    const inv = await qAll(env, "SELECT q.id, a.status FROM errata_queue q JOIN errata_actions a ON a.queue_id=q.id WHERE q.status='detected' AND a.status='published'");
    for (const r of inv) {
      await env.AUDIT.prepare("UPDATE errata_queue SET status='published', updated_at=datetime('now') WHERE id=?").bind(r.id).run();
      A("errata-inverse-heal", "errata queue #" + r.id + " detected+published action -> flipped published");
      log("C7-act inverse heal queue " + r.id);
    }
    log("C7 errata-stuck: " + stuck.length + ", parked: " + parked.length + ", inverse-healed: " + inv.length);
  } catch (e) { F("C7", "error", "check failed: " + e.message); }

  // C8 - kaizen/improvement feed
  try {
    // 8a recurrence-after-resolve clusters (evidence from C3 reopenings + resolved-again patterns)
    const rep = reopened.length;
    if (rep >= 2) {
      await upsertCandidate(env, "repeat-resolution", "mixed", "reopen", "Recurrence after resolution x" + rep, JSON.stringify(reopened.slice(0, 10)), log);
    }
    // 8b high-volume event clusters in last 7d
    const clusters = await qAll(env, "SELECT source, category, COUNT(*) n FROM issue_events WHERE ts > ? GROUP BY source, category HAVING n>=5 ORDER BY n DESC LIMIT 10", cut7d);
    for (const c of clusters) {
      await upsertCandidate(env, "event-cluster", c.source, c.category, "Event cluster: " + c.source + "/" + c.category + " x" + c.n, JSON.stringify(c), log);
    }
    log("C8 clusters: " + clusters.length + ", reopen clusters: " + rep);
  } catch (e) { F("C8", "error", "check failed: " + e.message); }

  // C10 - resolve-on-recovery (close open ledger entries whose underlying source condition cleared)
  try {
    const openSrc = await qAll(env, "SELECT fingerprint, source, title, last_seen FROM issue_ledger WHERE status IN ('open','acknowledged') AND source IN ('cloud-ops','errata','agent-issues')");
    let closed10 = 0;
    for (const it of openSrc) {
      const title = String(it.title || "");
      try {
        if (it.source === "cloud-ops" && title.indexOf("Job silent >48h:") === 0) {
          const job = title.slice("Job silent >48h:".length).trim();
          if (!job) continue;
          const ev = await q1(env, "SELECT MAX(ts) last FROM cloud_ops_events WHERE job=? AND ts > ?", job, it.last_seen);
          if (ev && ev.last) { await setFpStatus(env, it.fingerprint, "resolved", "audit close (C10): job '" + job + "' resumed (event " + ev.last + ")"); A("recovery-close", "job-silence " + job); closed10++; }
        } else if (it.source === "errata") {
          const mm = title.match(/#(\d+)/); if (!mm) continue;
          const row = await q1(env, "SELECT status FROM errata_queue WHERE id=?", Number(mm[1]));
          if (row) { const s = String(row.status || "").toLowerCase();
            if (["processed","done","completed","published","resolved","cancelled","closed"].indexOf(s) >= 0) { await setFpStatus(env, it.fingerprint, "resolved", "audit close (C10): errata queue #" + mm[1] + " now " + row.status); A("recovery-close", "errata #" + mm[1]); closed10++; } }
        } else if (it.source === "agent-issues") {
          const mm = title.match(/#(\d+)/); if (!mm) continue;
          const row = await q1(env, "SELECT status FROM agent_issues WHERE id=?", Number(mm[1]));
          if (row && String(row.status || "") !== "open") { await setFpStatus(env, it.fingerprint, "resolved", "audit close (C10): agent_issue #" + mm[1] + " now " + row.status); A("recovery-close", "agent-issue #" + mm[1]); closed10++; }
        }
      } catch (e2) {}
    }
    log("C10 resolve-on-recovery: " + closed10);
  } catch (e) { F("C10", "error", "check failed: " + e.message); }

  // ---- FEEDBACK PHASE (v1.1.0): close the learning loops + supervise subloops ----
  // F1 - subloop supervision heartbeats (is each automated subloop still writing side effects?)
  try {
    const cut30h = iso(Date.now() - 30 * 3600e3);
    const evFeed = await q1(env, "SELECT COUNT(*) n FROM issue_events WHERE detail LIKE 'src:%' AND ts > ?", cut30h);
    if (!evFeed || evFeed.n === 0) {
      F("F1", "high", "events-feed-silent: no qnfo-events sweep src rows in 30h (cron 15 3 * * * stalled?)");
      await ledgerEnsure(env, { source: "auditor", category: "subloop", level: "high", title: "Events feed silent >30h: qnfo-events sweep not writing issue_events", detail: "expected src:alert:/src:coe: sweep rows ~every 24h; none since " + cut30h + ". Check qnfo-events cron 15 3 * * *." });
    } else { log("F1 events-feed alive: " + evFeed.n + " rows in 30h"); }
  } catch (e) { F("F1", "error", "check failed: " + e.message); }
  try {
    const kz = await q1(env, "SELECT COUNT(*) n, MAX(created_at) last FROM kaizen_reports WHERE created_at > datetime('now','-4 day')");
    if (!kz || kz.n === 0) {
      F("F1", "warning", "kaizen-silent: no kaizen_reports in 4 days (worker crons 0 2 * * * + 0 10 * * 1 stalled?)");
      await ledgerEnsure(env, { source: "auditor", category: "subloop", level: "warning", title: "Kaizen feed silent >4d", detail: "kaizen_reports empty for 4 days; qnfo-kaizen crons 0 2 * * * / 0 10 * * 1." });
    } else { log("F1 kaizen alive: last " + kz.last); }
  } catch (e) { F("F1", "error", "check failed: " + e.message); }

  // F2 - improvement-effectiveness verification (does a promoted change actually stop recurrence?)
  try {
    const impr = await qAll(env, "SELECT fingerprint,last_detail,status,updated_at FROM issue_ledger WHERE source='kaizen' AND category='improvement' AND status='resolved'");
    let eff = 0;
    for (const im of impr) {
      const title = String(im.title || "");
      const m1 = title.match(/\[([0-9a-f]{4,16})\]/);
      const cid = (m1 ? m1[1] : "") || String(im.last_detail || "").trim().slice(0, 40);
      if (!cid) continue;
      const cand = await q1(env, "SELECT id,class,source,category,status FROM kaizen_candidates WHERE id=?", cid);
      if (!cand || cand.status === "verified_effective" || cand.status === "ineffective") continue;
      // effectiveness signal: auditor-source (recurring-finding) candidates measured by future finding trend; others by recurrence of source/category events
      let n = 0;
      if (cand.source === "auditor") {
        const later = await qAll(env, "SELECT findings FROM fleet_audit_runs WHERE ts > ?", im.updated_at);
        for (const rr of later) { let arr = []; try { arr = JSON.parse(rr.findings || "[]"); } catch (e) {} if (arr.some((f) => String(f.check || "") === cand.category)) n++; }
      } else {
        n = (await q1(env, "SELECT COUNT(*) n FROM issue_events WHERE source=? AND category=? AND ts > ?", cand.source, cand.category, im.updated_at))?.n || 0;
      }
      const status = n === 0 ? "verified_effective" : (n >= 2 ? "ineffective" : "proposed");
      if (status === "verified_effective" || status === "ineffective") {
        await env.AUDIT.prepare("UPDATE kaizen_candidates SET status=?, evidence=?, updated_at=? WHERE id=?").bind(status, "effect-check after improvement resolved: recurrence since " + im.updated_at + " = " + n, new Date().toISOString(), cand.id).run();
        eff++;
        if (status === "ineffective") A("feedback-reopen", "candidate " + cand.class + " (" + (cand.source || "?") + "/" + (cand.category || "?") + ") ineffective: recurrence x" + n);
      }
    }
    log("F2 improvement-effectiveness verified: " + eff);
  } catch (e) { F("F2", "error", "check failed: " + e.message); }

  // F3 - self-trend (auditor's own finding history -> recurring-finding candidates + digest trend)
  try {
    const hist = await qAll(env, "SELECT findings FROM fleet_audit_runs ORDER BY ts DESC LIMIT 12");
    const per = {};
    for (const row of hist) { let arr = []; try { arr = JSON.parse(row.findings || "[]"); } catch (e) {} for (const f of arr) { const k = String(f.check || "?"); per[k] = (per[k] || 0) + 1; } }
    const top = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 5);
    trendLine = "Audit trend (last " + hist.length + " runs): " + (top.length ? top.map((x) => x[0] + " x" + x[1]).join(", ") : "clean");
    for (const [check, n] of top) {
      if (n >= 6) await upsertCandidate(env, "recurring-finding", "auditor", check, "Recurring finding: check " + check + " fired " + n + "/" + hist.length + " runs", JSON.stringify({ check, n, of: hist.length }), log);
    }
    log("F3 trend: " + trendLine);
  } catch (e) { F("F3", "error", "check failed: " + e.message); }

  // F4 - remediation watchdog subloop (live /health probe auto-resolves OPEN HIGH entries whose worker recovered)
  try {
    // F4 probes ONLY the true failure subjects named in the entry title (worker-health JSON rows list the failing worker).
    // chat-canary / blank-audit entries are NOT auto-resolved: their titles name the canary (a probe) not the endpoint - an agent verifies the canary result table instead (no false resolution).
    const KNOWN = ["qnfo-ai","personal-api"];
    const dom = (nm) => nm;
    const cut6h = iso(Date.now() - 6 * 3600e3);
    const cand6h = iso(Date.now() - 6 * 3600e3);
    // gate: entry older than 6h (first_seen) AND no recurrence in the last 12h (last_seen) -> candidate for live re-verification
    const openH = await qAll(env, "SELECT fingerprint,source,title,first_seen,last_seen FROM issue_ledger WHERE status IN ('open','acknowledged') AND level IN ('high','critical','error') AND first_seen < ? AND last_seen < ?", cut6h, cut12h);
    let probes = 0, closed4 = 0;
    for (const it of openH) {
      const title = String(it.title || "") + " " + String(it.source || "");
      const seen = {};
      for (const nm of KNOWN) {
        if (title.indexOf(nm) < 0 || seen[dom(nm)]) continue;
        seen[dom(nm)] = true;
        const lastP = await q1(env, "SELECT ts,status FROM feedback_probes WHERE k=?", dom(nm));
        if (lastP && String(lastP.ts) > cand6h) continue; // >=1 probe per worker per 6h
        probes++;
        let ok = false, code = 0;
        try {
          const r = await fetch("https://" + dom(nm) + ".q08.workers.dev/health", { headers: { "User-Agent": "Mozilla/5.0 (qnfo-auditor)" }, signal: AbortSignal.timeout(8000) });
          code = r.status; const j = await r.json().catch(() => null);
          ok = r.status === 200 && j && j.ok === true && !!j.version;
        } catch (e) { code = 0; }
        await env.AUDIT.prepare("INSERT INTO feedback_probes (k, ts, status, code) VALUES (?,?,?,?) ON CONFLICT(k) DO UPDATE SET ts=excluded.ts, status=excluded.status, code=excluded.code").bind(dom(nm), new Date().toISOString(), ok ? "ok" : "fail", code).run();
        if (ok) {
          const still = await q1(env, "SELECT fingerprint,status FROM issue_ledger WHERE fingerprint=?", it.fingerprint);
          if (still && still.status !== "resolved") { await setFpStatus(env, it.fingerprint, "resolved", "audit close (F4): live /health probe " + dom(nm) + " 200 ok " + new Date().toISOString()); A("recovery-close", dom(nm) + " healthy (F4)"); closed4++; }
        }
        if (probes >= 6) break;
      }
      if (probes >= 6) break;
    }
    log("F4 remediation probes=" + probes + " closed=" + closed4);
  } catch (e) { F("F4", "error", "check failed: " + e.message); }

  // C9 - digest state machine (email only on new/increased HIGH or weekly deep)
  const prev = await q1(env, "SELECT open_high, ts FROM fleet_audit_runs ORDER BY ts DESC LIMIT 1");
  let prevFps = []; try { prevFps = prev && prev.open_high ? JSON.parse(prev.open_high) : []; } catch (e) { prevFps = []; }
  const curFps = (snapshot.open_high || []).map((x) => x.fingerprint);
  const newFps = curFps.filter((f) => !prevFps.includes(f));
  const digestParts = [];
  digestParts.push("QNFO fleet audit " + now.slice(0, 10) + " (" + mode + ")");
  digestParts.push("Ledger open: " + snapshot.ledger_open + " | open HIGH/CRITICAL: " + curFps.length + " (new since last run: " + newFps.length + ") | coe 48h: " + snapshot.coe_48h + " | alerts 48h: " + snapshot.alerts_48h + " | agent open: " + snapshot.agent_open + " | deploys 7d: " + snapshot.deploys_7d);
  if (trendLine) digestParts.push(trendLine);
  if (curFps.length) {
    digestParts.push("");
    digestParts.push("Unresolved HIGH/CRITICAL:");
    for (const h of snapshot.open_high) digestParts.push(" - [" + h.source + "] " + String(h.title).slice(0, 200) + " (occ " + h.occurrences + ")");
  }
  if (mode === "deep") {
    try {
      const impr = await qAll(env, "SELECT fingerprint,title,occurrences,updated_at FROM issue_ledger WHERE source='kaizen' AND category='improvement' AND status='open' ORDER BY updated_at DESC LIMIT 15");
      if (impr.length) {
        digestParts.push("");
        digestParts.push("OPEN IMPROVEMENT CANDIDATES (apply + resolve -> F2 auto-verifies effectiveness):");
        for (const im of impr) digestParts.push(" - [" + im.fingerprint + "] " + String(im.title).slice(0, 200) + " (occ " + im.occurrences + ", since " + im.updated_at + ")");
        digestParts.push("Resolve via: POST /v1/issues/<fp>/resolve with note evidence, or fix the underlying class and mark the candidate verified_effective.");
      }
    } catch (e) {}
  }
  if (findings.length) { digestParts.push(""); digestParts.push("Findings this run: " + findings.length); for (const f of findings.slice(0, 12)) digestParts.push(" - " + f.check + " " + f.level + ": " + f.text.slice(0, 240)); }
  if (actions.length) { digestParts.push(""); digestParts.push("Actions: " + actions.length); for (const a of actions.slice(0, 10)) digestParts.push(" - " + a.kind + ": " + a.text.slice(0, 200)); }
  const digestText = digestParts.join("\n");
  let email = null;
  const wantEmail = mode === "deep" || newFps.length > 0 || curFps.length > (prevFps.length || 0);
  if (wantEmail) {
    const digDom = String(env.DIGEST_TO || "").split("@")[1] || "";
    if (HUMAN_DOMAINS.has(digDom)) {
      email = { ok: false, skipped: "personal-domain", to: env.DIGEST_TO };
      log("C9 digest: skipped personal-domain recipient " + digDom);
    } else if (env.SEND_EMAIL && env.DIGEST_TO) {
      try {
        const r = await env.SEND_EMAIL.send({ to: env.DIGEST_TO, from: { email: "alerts@qnfo.org", name: "QNFO Ops" }, subject: "QNFO fleet audit digest " + now.slice(0, 10) + " (HIGH open: " + curFps.length + ")", text: digestText });
        email = { ok: true, messageId: r && r.messageId };
      } catch (e) { email = { ok: false, error: String(e && e.message || e).slice(0, 300) }; }
    } else { email = { ok: false, error: "no SEND_EMAIL binding / DIGEST_TO secret" }; }
  }
  log("C9 digest: want=" + wantEmail + " new=" + newFps.length + " email=" + JSON.stringify(email));

  await env.AUDIT.prepare("INSERT INTO fleet_audit_runs (id, ts, mode, counts, findings, actions, digest, open_high) VALUES (?,?,?,?,?,?,?,?)")
    .bind(runId, now, mode, JSON.stringify(snapshot).slice(0, 3000), JSON.stringify(findings).slice(0, 6000), JSON.stringify(actions).slice(0, 4000), digestText.slice(0, 6000), JSON.stringify(curFps).slice(0, 2000)).run();

  return { run_id: runId, ts: now, mode, findings: findings.length, actions: actions.length, email, open_high: curFps.length, new_high: newFps.length };
}
async function upsertCandidate(env, cls, source, category, title, evidence, log) {
  const id = fpOf("kaizen", cls, String(source) + "|" + String(category));
  const now = new Date().toISOString();
  const ex = await q1(env, "SELECT id,status,evidence FROM kaizen_candidates WHERE id=?", id);
  if (!ex) {
    await env.AUDIT.prepare("INSERT INTO kaizen_candidates (id, class, source, category, title, evidence, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'proposed',?,?)").bind(id, cls, String(source).slice(0, 80), String(category).slice(0, 60), String(title).slice(0, 300), String(evidence).slice(0, 1500), now, now).run();
  } else if (ex.status === "proposed") {
    await env.AUDIT.prepare("UPDATE kaizen_candidates SET evidence=?, updated_at=? WHERE id=?").bind(String(evidence).slice(0, 1500), now, id).run();
  }
  // promote mature candidates (>7d proposed) to the ledger for agent/ops visibility
  // v1.1.0 fix: mature cutoff computed here (v1.0.2 referenced runAudit-local cut7d -> ReferenceError, promotion silently dead)
  const matureCut = new Date(Date.now() - 7 * 864e5).toISOString();
  const mature = await qAll(env, "SELECT id,class,source,category,title FROM kaizen_candidates WHERE status='proposed' AND created_at < ? LIMIT 10", matureCut);
  for (const m of mature) {
    await ledgerEnsure(env, { source: "kaizen", category: "improvement", level: "medium", title: "Improvement candidate: " + m.class + " (" + (m.source || "?") + "/" + (m.category || "?") + ") [" + m.id + "]", detail: m.id });
    await env.AUDIT.prepare("UPDATE kaizen_candidates SET status='promoted', updated_at=? WHERE id=?").bind(new Date().toISOString(), m.id).run();
  }
}
export default {
  async scheduled(event, env, ctx) {
    const cron = (event && event.cron) || "";
    const mode = String(cron).trim().split(/\s+/)[4] === "1" ? "deep" : "standard";
    try { const r = await runAudit(env, mode, console.log); console.log("qnfo-auditor", JSON.stringify(r)); }
    catch (e) { console.error("qnfo-auditor run failed", String(e && e.message || e)); }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname; const m = request.method;
    if (path === "/health" && m === "GET") return json({ ok: true, worker: "qnfo-auditor", version: VERSION, self: SELF, audit: !!env.AUDIT, sendEmail: !!env.SEND_EMAIL, token: !!env.AUDITOR_TOKEN });
    if (!okAuth(request, env)) return json({ error: "unauthorized" }, 401);
    if (path === "/" && m === "GET") return json({ ok: true, name: "qnfo-auditor", version: VERSION, endpoints: ["POST /v1/run", "GET /v1/runs", "GET /v1/state", "/health"], schedule: "45 1,13 * * * (standard) + 45 6 * * 1 (deep)" });
    if (path === "/v1/run" && m === "POST") {
      let mode = "standard"; try { const b = await request.json(); if (b && b.mode === "deep") mode = "deep"; } catch (e) {}
      return json(await runAudit(env, mode, () => {}));
    }
    if (path === "/v1/runs" && m === "GET") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "10", 10) || 10, 50);
      const rows = await qAll(env, "SELECT id, ts, mode, counts, findings, actions, open_high FROM fleet_audit_runs ORDER BY ts DESC LIMIT ?", limit);
      return json({ runs: rows });
    }
    if (path === "/v1/state" && m === "GET") {
      const open = await qAll(env, "SELECT fingerprint,source,level,category,title,status,occurrences,last_seen FROM issue_ledger WHERE status IN ('open','acknowledged') ORDER BY last_seen DESC LIMIT 100");
      const candidates = await qAll(env, "SELECT id,class,source,category,title,status,created_at FROM kaizen_candidates ORDER BY updated_at DESC LIMIT 50");
      return json({ open_issues: open, kaizen_candidates: candidates });
    }
    return json({ error: "not found" }, 404);
  }
};
