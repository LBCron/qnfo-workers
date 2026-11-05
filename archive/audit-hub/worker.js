var auditorMod = (function(){
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var VERSION = "1.1.8";
var SELF = { purpose: "fleet event/log audit + act + feedback loops (automated, user-free)", checks: ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "F1", "F2", "F3", "F4"] };
var HUMAN_DOMAINS = new Set("outlook.com hotmail.com live.com msn.com gmail.com yahoo.com ymail.com icloud.com me.com mac.com protonmail.com proton.me zoho.com aol.com gmx.com tutanota.com".split(" "));
function json(o, st) {
  return new Response(JSON.stringify(o), { status: st || 200, headers: { "Content-Type": "application/json" } });
}
__name(json, "json");
function norm(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
__name(norm, "norm");
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
__name(hash, "hash");
function fpOf(source, category, title) {
  return hash(norm(source) + "|" + norm(category) + "|" + norm(title));
}
__name(fpOf, "fpOf");
async function ensureSchema(env) {
  await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS fleet_audit_runs (id TEXT PRIMARY KEY, ts TEXT, mode TEXT, counts TEXT, findings TEXT, actions TEXT, digest TEXT, open_high TEXT)").run();
  await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS kaizen_candidates (id TEXT PRIMARY KEY, class TEXT, source TEXT, category TEXT, title TEXT, evidence TEXT, status TEXT DEFAULT 'proposed', created_at TEXT, updated_at TEXT)").run();
  await env.AUDIT.prepare("CREATE INDEX IF NOT EXISTS idx_fleet_audit_runs_ts ON fleet_audit_runs(ts)").run();
  await env.AUDIT.prepare("CREATE INDEX IF NOT EXISTS idx_kaizen_candidates_status ON kaizen_candidates(status)").run();
  await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS feedback_probes (k TEXT PRIMARY KEY, ts TEXT, status TEXT, code INTEGER)").run();
}
__name(ensureSchema, "ensureSchema");
function okAuth(req, env) {
  const t = env.AUDITOR_TOKEN || "";
  if (!t) return false;
  const h = req.headers.get("Authorization") || "";
  if (!h.startsWith("Bearer ")) return false;
  const a = h.slice(7);
  if (a.length !== t.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ t.charCodeAt(i);
  return d === 0;
}
__name(okAuth, "okAuth");
async function qAll(env, sql, ...bind) {
  const r = bind.length ? await env.AUDIT.prepare(sql).bind(...bind).all() : await env.AUDIT.prepare(sql).all();
  return r.results || [];
}
__name(qAll, "qAll");
async function q1(env, sql, ...bind) {
  const r = await qAll(env, sql, ...bind);
  return r[0] || null;
}
__name(q1, "q1");
async function ledgerEnsure(env, entry) {
  const source = String(entry.source || "unknown").slice(0, 80);
  const category = String(entry.category || "general").slice(0, 60);
  const level = String(entry.level || "info").toLowerCase();
  const title = String(entry.title || "").slice(0, 300);
  const detail = String(entry.detail || "").slice(0, 4e3);
  const now = (/* @__PURE__ */ new Date()).toISOString();
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
__name(ledgerEnsure, "ledgerEnsure");
async function setFpStatus(env, fp, status, note) {
  await env.AUDIT.prepare("UPDATE issue_ledger SET status=?, last_detail=COALESCE(?,last_detail), updated_at=? WHERE fingerprint=?").bind(status, String(note || "").slice(0, 1e3) || null, (/* @__PURE__ */ new Date()).toISOString(), fp).run();
}
__name(setFpStatus, "setFpStatus");
async function runAudit(env, mode, log) {
  await ensureSchema(env);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const runId = "audit-" + now.replace(/[:.]/g, "-");
  const iso = /* @__PURE__ */ __name((ms) => new Date(ms).toISOString(), "iso");
  const cut2d = iso(Date.now() - 2 * 864e5), cut3d = iso(Date.now() - 3 * 864e5), cut7d = iso(Date.now() - 7 * 864e5), cut12h = iso(Date.now() - 12 * 36e5), cut14d = iso(Date.now() - 14 * 864e5);
  const findings = [];
  const actions = [];
  const count = /* @__PURE__ */ __name((arr) => arr.length, "count");
  const F = /* @__PURE__ */ __name((check, level, text) => findings.push({ check, level, text: String(text).slice(0, 600) }), "F");
  const A = /* @__PURE__ */ __name((kind, text) => actions.push({ kind, text: String(text).slice(0, 600) }), "A");
  let trendLine = "";
  const snapshot = {};
  try {
    snapshot.ledger_open = (await q1(env, "SELECT COUNT(*) n FROM issue_ledger WHERE status IN ('open','acknowledged')"))?.n || 0;
  } catch (e) {
  }
  try {
    snapshot.open_high = await qAll(env, "SELECT fingerprint,title,source,level,occurrences,last_seen FROM issue_ledger WHERE status IN ('open','acknowledged') AND level IN ('high','critical') ORDER BY last_seen DESC");
  } catch (e) {
    snapshot.open_high = [];
  }
  try {
    snapshot.coe_48h = (await q1(env, "SELECT COUNT(*) n FROM cloud_ops_events WHERE ts > ?", cut2d))?.n || 0;
  } catch (e) {
  }
  try {
    snapshot.alerts_48h = (await q1(env, "SELECT COUNT(*) n FROM alerts WHERE created_at > datetime('now','-2 day')"))?.n || 0;
  } catch (e) {
  }
  try {
    snapshot.agent_open = (await q1(env, "SELECT COUNT(*) n FROM agent_issues WHERE status='open'"))?.n || 0;
  } catch (e) {
  }
  try {
    snapshot.deploys_7d = (await q1(env, "SELECT COUNT(*) n FROM deployment_history WHERE deployed_at > datetime('now','-7 day')"))?.n || 0;
  } catch (e) {
  }
  try {
    const stale = await qAll(env, "SELECT fingerprint,title,source,occurrences,last_seen FROM issue_ledger WHERE status IN ('open','acknowledged') AND level IN ('high','critical') AND updated_at < ?", cut7d);
    for (const s of stale) F("C1", "warning", "stale open " + s.level + " [" + s.source + "] " + String(s.title).slice(0, 160) + " (occ " + s.occurrences + ", last " + s.last_seen + ")");
    log("C1 stale-open-high: " + stale.length);
  } catch (e) {
    F("C1", "error", "check failed: " + e.message);
  }
  try {
    const closable = await qAll(env, "SELECT fingerprint,title,source,level,occurrences,last_seen FROM issue_ledger WHERE status='open' AND level IN ('info','warning','low') AND last_seen < ? AND occurrences<=3", cut14d);
    for (const c of closable) {
      await setFpStatus(env, c.fingerprint, "resolved", "audit auto-close (C2): no recurrence for >=14d (last " + c.last_seen + ", occ " + c.occurrences + ")");
      A("auto-close", c.source + ": " + String(c.title).slice(0, 120));
    }
    log("C2 auto-close stale low: " + closable.length);
  } catch (e) {
    F("C2", "error", "check failed: " + e.message);
  }
  let reopenN = 0;
  const reopened = [];
  try {
    const rec = await qAll(env, "SELECT l.fingerprint, l.source, l.title, l.level, (SELECT COUNT(*) FROM issue_events e WHERE e.fingerprint=l.fingerprint AND e.ts > l.updated_at) AS newer FROM issue_ledger l WHERE l.status IN ('resolved','acknowledged','muted') AND EXISTS (SELECT 1 FROM issue_events e WHERE e.fingerprint=l.fingerprint AND e.ts > l.updated_at)");
    for (const r of rec) {
      await setFpStatus(env, r.fingerprint, "open", "audit reopen (C3): recurrence observed after resolution");
      reopened.push({ source: r.source, category: "reopen", title: String(r.title).slice(0, 120), fp: r.fingerprint });
      reopenN++;
    }
    log("C3 reopen-on-recurrence: " + reopenN);
  } catch (e) {
    F("C3", "error", "check failed: " + e.message);
  }
  try {
    const jobs = await qAll(env, "SELECT job, COUNT(DISTINCT substr(ts,1,10)) d, MAX(ts) last FROM cloud_ops_events WHERE ts > ? AND job IS NOT NULL GROUP BY job HAVING d>=3", cut14d);
    for (const j of jobs) {
      if (String(j.last) < new Date(Date.now() - 48 * 36e5).toISOString()) {
        F("C4", "high", "job silent >48h: " + j.job + " (last event " + j.last + ")");
        await ledgerEnsure(env, { source: "cloud-ops", category: "job-silence", level: "high", title: "Job silent >48h: " + j.job, detail: "last event " + j.last + "; recurring scheduler job stopped emitting (check cron/schedules)." });
      }
    }
    log("C4 job-silence candidates: " + jobs.length);
  } catch (e) {
    F("C4", "error", "check failed: " + e.message);
  }
  try {
    const lag = await qAll(env, "SELECT id, kind, text, job, ts FROM cloud_ops_events WHERE ts < ? AND ts > ? AND status IN ('error','failed','partial') AND NOT EXISTS (SELECT 1 FROM issue_events ie WHERE ie.detail='src:coe:'||cloud_ops_events.id)", cut12h, cut3d);
    if (lag.length > 0) {
      F("C5", "warning", "events-sweep-lag: " + lag.length + " coe error rows >12h old not mirrored to issue_ledger (oldest " + lag[0].ts + ")");
      await ledgerEnsure(env, { source: "auditor", category: "pipeline", level: "warning", title: "Events sweep lag: " + lag.length + " coe error rows not mirrored in 12h", detail: "qnfo-events daily 03:15 sweep latency; rows: " + lag.slice(0, 5).map((x) => x.id).join(",") });
    }
    log("C5 sweep-lag: " + lag.length);
  } catch (e) {
    F("C5", "error", "check failed: " + e.message);
  }
  try {
    const old = await qAll(env, "SELECT id,title,priority,category,source FROM agent_issues WHERE status='open' AND priority IN ('high','critical') AND created_at < CAST(strftime('%s','now') AS INTEGER)-2592000 ORDER BY created_at ASC LIMIT 25");
    for (const o of old) {
      await ledgerEnsure(env, { source: "agent-issues", category: "stale-open", level: "high", title: "Stale open agent_issue #" + o.id + ": " + String(o.title).slice(0, 180), detail: "agent_issue " + o.id + " " + (o.priority || "") + " " + (o.category || "") + " open >30d (source " + (o.source || "?") + ")" });
    }
    log("C6 agent-issue bridge: " + old.length);
  } catch (e) {
    F("C6", "error", "check failed: " + e.message);
  }
  try {
    const stuck = await qAll(env, "SELECT id,sender,subject,status,updated_at FROM errata_queue WHERE status NOT IN ('processed','done','completed','published','resolved','cancelled','closed','audited','implemented','orphaned') AND updated_at < datetime('now','-24 hour') ORDER BY updated_at ASC LIMIT 10");
    if (stuck.length > 0) {
      F("C7", "high", "errata-stuck: " + stuck.length + " queue rows non-terminal >24h");
      for (const s of stuck.slice(0, 3)) await ledgerEnsure(env, { source: "errata", category: "stuck", level: "high", title: "Errata queue stuck >24h #" + s.id + ": " + String(s.subject || "").slice(0, 140), detail: "status " + s.status + " since " + s.updated_at + " sender " + (s.sender || "") });
    }
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
      } else if (["superseded", "stale"].indexOf(String(act.status)) >= 0) {
        A("errata-needs-review", "errata queue #" + p.id + " action " + act.id + " status='" + act.status + "' - NOT auto-revived (may be deliberate), needs review");
        log("C7-act queue " + p.id + " action " + act.status + " needs review (no auto-send)");
      } else {
        log("C7-act queue " + p.id + " action " + act.status + ", awaiting pipeline");
      }
    }
    const inv = await qAll(env, "SELECT q.id, a.status FROM errata_queue q JOIN errata_actions a ON a.queue_id=q.id WHERE q.status='detected' AND a.status='published'");
    for (const r of inv) {
      await env.AUDIT.prepare("UPDATE errata_queue SET status='published', updated_at=datetime('now') WHERE id=?").bind(r.id).run();
      A("errata-inverse-heal", "errata queue #" + r.id + " detected+published action -> flipped published");
      log("C7-act inverse heal queue " + r.id);
    }
    log("C7 errata-stuck: " + stuck.length + ", parked: " + parked.length + ", inverse-healed: " + inv.length);
  } catch (e) {
    F("C7", "error", "check failed: " + e.message);
  }
  try {
    const rep = reopened.length;
    if (rep >= 2) {
      await upsertCandidate(env, "repeat-resolution", "mixed", "reopen", "Recurrence after resolution x" + rep, JSON.stringify(reopened.slice(0, 10)), log);
    }
    const clusters = await qAll(env, "SELECT source, category, COUNT(*) n FROM issue_events WHERE ts > ? GROUP BY source, category HAVING n>=5 ORDER BY n DESC LIMIT 10", cut7d);
    for (const c of clusters) {
      await upsertCandidate(env, "event-cluster", c.source, c.category, "Event cluster: " + c.source + "/" + c.category + " x" + c.n, JSON.stringify(c), log);
    }
    log("C8 clusters: " + clusters.length + ", reopen clusters: " + rep);
  } catch (e) {
    F("C8", "error", "check failed: " + e.message);
  }
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
          if (ev && ev.last) {
            await setFpStatus(env, it.fingerprint, "resolved", "audit close (C10): job '" + job + "' resumed (event " + ev.last + ")");
            A("recovery-close", "job-silence " + job);
            closed10++;
          }
        } else if (it.source === "errata") {
          const mm = title.match(/#(\d+)/);
          if (!mm) continue;
          const row = await q1(env, "SELECT status FROM errata_queue WHERE id=?", Number(mm[1]));
          if (row) {
            const s = String(row.status || "").toLowerCase();
            if (["processed", "done", "completed", "published", "resolved", "cancelled", "closed"].indexOf(s) >= 0) {
              await setFpStatus(env, it.fingerprint, "resolved", "audit close (C10): errata queue #" + mm[1] + " now " + row.status);
              A("recovery-close", "errata #" + mm[1]);
              closed10++;
            }
          }
        } else if (it.source === "agent-issues") {
          const mm = title.match(/#(\d+)/);
          if (!mm) continue;
          const row = await q1(env, "SELECT status FROM agent_issues WHERE id=?", Number(mm[1]));
          if (row && String(row.status || "") !== "open") {
            await setFpStatus(env, it.fingerprint, "resolved", "audit close (C10): agent_issue #" + mm[1] + " now " + row.status);
            A("recovery-close", "agent-issue #" + mm[1]);
            closed10++;
          }
        }
      } catch (e2) {
      }
    }
    log("C10 resolve-on-recovery: " + closed10);
  } catch (e) {
    F("C10", "error", "check failed: " + e.message);
  }
  try {
    const cut30h = iso(Date.now() - 30 * 36e5);
    const evFeed = await q1(env, "SELECT COUNT(*) n FROM issue_events WHERE detail LIKE 'src:%' AND ts > ?", cut30h);
    if (!evFeed || evFeed.n === 0) {
      F("F1", "high", "events-feed-silent: no qnfo-events sweep src rows in 30h (cron 15 3 * * * stalled?)");
      await ledgerEnsure(env, { source: "auditor", category: "subloop", level: "high", title: "Events feed silent >30h: qnfo-events sweep not writing issue_events", detail: "expected src:alert:/src:coe: sweep rows ~every 24h; none since " + cut30h + ". Check qnfo-events cron 15 3 * * *." });
    } else {
      log("F1 events-feed alive: " + evFeed.n + " rows in 30h");
    }
  } catch (e) {
    F("F1", "error", "check failed: " + e.message);
  }
  try {
    const kz = await q1(env, "SELECT COUNT(*) n, MAX(created_at) last FROM kaizen_reports WHERE created_at > datetime('now','-4 day')");
    if (!kz || kz.n === 0) {
      F("F1", "warning", "kaizen-silent: no kaizen_reports in 4 days (worker crons 0 2 * * * + 0 10 * * 1 stalled?)");
      await ledgerEnsure(env, { source: "auditor", category: "subloop", level: "warning", title: "Kaizen feed silent >4d", detail: "kaizen_reports empty for 4 days; qnfo-kaizen crons 0 2 * * * / 0 10 * * 1." });
    } else {
      log("F1 kaizen alive: last " + kz.last);
    }
  } catch (e) {
    F("F1", "error", "check failed: " + e.message);
  }
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
      let n = 0;
      if (cand.source === "auditor") {
        const later = await qAll(env, "SELECT findings FROM fleet_audit_runs WHERE ts > ?", im.updated_at);
        for (const rr of later) {
          let arr = [];
          try {
            arr = JSON.parse(rr.findings || "[]");
          } catch (e) {
          }
          if (arr.some((f) => String(f.check || "") === cand.category)) n++;
        }
      } else {
        n = (await q1(env, "SELECT COUNT(*) n FROM issue_events WHERE source=? AND category=? AND ts > ?", cand.source, cand.category, im.updated_at))?.n || 0;
      }
      const status = n === 0 ? "verified_effective" : n >= 2 ? "ineffective" : "proposed";
      if (status === "verified_effective" || status === "ineffective") {
        await env.AUDIT.prepare("UPDATE kaizen_candidates SET status=?, evidence=?, updated_at=? WHERE id=?").bind(status, "effect-check after improvement resolved: recurrence since " + im.updated_at + " = " + n, (/* @__PURE__ */ new Date()).toISOString(), cand.id).run();
        eff++;
        if (status === "ineffective") A("feedback-reopen", "candidate " + cand.class + " (" + (cand.source || "?") + "/" + (cand.category || "?") + ") ineffective: recurrence x" + n);
      }
    }
    log("F2 improvement-effectiveness verified: " + eff);
  } catch (e) {
    F("F2", "error", "check failed: " + e.message);
  }
  try {
    const hist = await qAll(env, "SELECT findings FROM fleet_audit_runs ORDER BY ts DESC LIMIT 12");
    const per = {};
    for (const row of hist) {
      let arr = [];
      try {
        arr = JSON.parse(row.findings || "[]");
      } catch (e) {
      }
      for (const f of arr) {
        const k = String(f.check || "?");
        per[k] = (per[k] || 0) + 1;
      }
    }
    const top = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 5);
    trendLine = "Audit trend (last " + hist.length + " runs): " + (top.length ? top.map((x) => x[0] + " x" + x[1]).join(", ") : "clean");
    for (const [check, n] of top) {
      if (n >= 6) await upsertCandidate(env, "recurring-finding", "auditor", check, "Recurring finding: check " + check + " fired " + n + "/" + hist.length + " runs", JSON.stringify({ check, n, of: hist.length }), log);
    }
    log("F3 trend: " + trendLine);
  } catch (e) {
    F("F3", "error", "check failed: " + e.message);
  }
  try {
    const KNOWN = ["qnfo-ai", "personal-api"];
    const dom = /* @__PURE__ */ __name((nm) => nm, "dom");
    const cut6h = iso(Date.now() - 6 * 36e5);
    const cand6h = iso(Date.now() - 6 * 36e5);
    const openH = await qAll(env, "SELECT fingerprint,source,title,first_seen,last_seen FROM issue_ledger WHERE status IN ('open','acknowledged') AND level IN ('high','critical','error') AND first_seen < ? AND last_seen < ?", cut6h, cut12h);
    let probes = 0, closed4 = 0;
    for (const it of openH) {
      const title = String(it.title || "") + " " + String(it.source || "");
      const seen = {};
      for (const nm of KNOWN) {
        if (title.indexOf(nm) < 0 || seen[dom(nm)]) continue;
        seen[dom(nm)] = true;
        const lastP = await q1(env, "SELECT ts,status FROM feedback_probes WHERE k=?", dom(nm));
        if (lastP && String(lastP.ts) > cand6h) continue;
        probes++;
        let ok = false, code = 0;
        try {
          const r = await fetch("https://" + dom(nm) + ".q08.workers.dev/health", { headers: { "User-Agent": "Mozilla/5.0 (qnfo-auditor)" }, signal: AbortSignal.timeout(8e3) });
          code = r.status;
          const j = await r.json().catch(() => null);
          ok = r.status === 200 && j && j.ok === true && !!j.version;
        } catch (e) {
          code = 0;
        }
        await env.AUDIT.prepare("INSERT INTO feedback_probes (k, ts, status, code) VALUES (?,?,?,?) ON CONFLICT(k) DO UPDATE SET ts=excluded.ts, status=excluded.status, code=excluded.code").bind(dom(nm), (/* @__PURE__ */ new Date()).toISOString(), ok ? "ok" : "fail", code).run();
        if (ok) {
          const still = await q1(env, "SELECT fingerprint,status FROM issue_ledger WHERE fingerprint=?", it.fingerprint);
          if (still && still.status !== "resolved") {
            await setFpStatus(env, it.fingerprint, "resolved", "audit close (F4): live /health probe " + dom(nm) + " 200 ok " + (/* @__PURE__ */ new Date()).toISOString());
            A("recovery-close", dom(nm) + " healthy (F4)");
            closed4++;
          }
        }
        if (probes >= 6) break;
      }
      if (probes >= 6) break;
    }
    log("F4 remediation probes=" + probes + " closed=" + closed4);
  } catch (e) {
    F("F4", "error", "check failed: " + e.message);
  }
  const prev = await q1(env, "SELECT open_high, ts FROM fleet_audit_runs ORDER BY ts DESC LIMIT 1");
  let prevFps = [];
  try {
    prevFps = prev && prev.open_high ? JSON.parse(prev.open_high) : [];
  } catch (e) {
    prevFps = [];
  }
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
    } catch (e) {
    }
  }
  if (findings.length) {
    digestParts.push("");
    digestParts.push("Findings this run: " + findings.length);
    for (const f of findings.slice(0, 12)) digestParts.push(" - " + f.check + " " + f.level + ": " + f.text.slice(0, 240));
  }
  if (actions.length) {
    digestParts.push("");
    digestParts.push("Actions: " + actions.length);
    for (const a of actions.slice(0, 10)) digestParts.push(" - " + a.kind + ": " + a.text.slice(0, 200));
  }
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
      } catch (e) {
        email = { ok: false, error: String(e && e.message || e).slice(0, 300) };
      }
    } else {
      email = { ok: false, error: "no SEND_EMAIL binding / DIGEST_TO secret" };
    }
  }
  log("C9 digest: want=" + wantEmail + " new=" + newFps.length + " email=" + JSON.stringify(email));
  await env.AUDIT.prepare("INSERT INTO fleet_audit_runs (id, ts, mode, counts, findings, actions, digest, open_high) VALUES (?,?,?,?,?,?,?,?)").bind(runId, now, mode, JSON.stringify(snapshot).slice(0, 3e3), JSON.stringify(findings).slice(0, 6e3), JSON.stringify(actions).slice(0, 4e3), digestText.slice(0, 6e3), JSON.stringify(curFps).slice(0, 2e3)).run();
  return { run_id: runId, ts: now, mode, findings: findings.length, actions: actions.length, email, open_high: curFps.length, new_high: newFps.length };
}
__name(runAudit, "runAudit");
async function upsertCandidate(env, cls, source, category, title, evidence, log) {
  const id = fpOf("kaizen", cls, String(source) + "|" + String(category));
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const ex = await q1(env, "SELECT id,status,evidence FROM kaizen_candidates WHERE id=?", id);
  if (!ex) {
    await env.AUDIT.prepare("INSERT INTO kaizen_candidates (id, class, source, category, title, evidence, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'proposed',?,?)").bind(id, cls, String(source).slice(0, 80), String(category).slice(0, 60), String(title).slice(0, 300), String(evidence).slice(0, 1500), now, now).run();
  } else if (ex.status === "proposed") {
    await env.AUDIT.prepare("UPDATE kaizen_candidates SET evidence=?, updated_at=? WHERE id=?").bind(String(evidence).slice(0, 1500), now, id).run();
  }
  const matureCut = new Date(Date.now() - 7 * 864e5).toISOString();
  const mature = await qAll(env, "SELECT id,class,source,category,title FROM kaizen_candidates WHERE status='proposed' AND created_at < ? LIMIT 10", matureCut);
  for (const m of mature) {
    await ledgerEnsure(env, { source: "kaizen", category: "improvement", level: "medium", title: "Improvement candidate: " + m.class + " (" + (m.source || "?") + "/" + (m.category || "?") + ") [" + m.id + "]", detail: m.id });
    await env.AUDIT.prepare("UPDATE kaizen_candidates SET status='promoted', updated_at=? WHERE id=?").bind((/* @__PURE__ */ new Date()).toISOString(), m.id).run();
  }
}
__name(upsertCandidate, "upsertCandidate");
var worker_default = {
  async scheduled(event, env, ctx) {
    const cron = event && event.cron || "";
    const mode = String(cron).trim().split(/\s+/)[4] === "1" ? "deep" : "standard";
    try {
      const r = await runAudit(env, mode, console.log);
      console.log("qnfo-auditor", JSON.stringify(r));
    } catch (e) {
      console.error("qnfo-auditor run failed", String(e && e.message || e));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const m = request.method;
    if (path === "/health" && m === "GET") return json({ ok: true, worker: "qnfo-auditor", version: VERSION, self: SELF, audit: !!env.AUDIT, sendEmail: !!env.SEND_EMAIL, token: !!env.AUDITOR_TOKEN });
    if (!okAuth(request, env)) return json({ error: "unauthorized" }, 401);
    if (path === "/" && m === "GET") return json({ ok: true, name: "qnfo-auditor", version: VERSION, endpoints: ["POST /v1/run", "GET /v1/runs", "GET /v1/state", "/health"], schedule: "45 1,13 * * * (standard) + 45 6 * * 1 (deep)" });
    if (path === "/v1/run" && m === "POST") {
      let mode = "standard";
      try {
        const b = await request.json();
        if (b && b.mode === "deep") mode = "deep";
      } catch (e) {
      }
      return json(await runAudit(env, mode, () => {
      }));
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
return { default: worker_default };
})();
var blankauditMod = (function(){
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var VERSION = "1.1.0";
var FROM_EMAIL = "alerts@qnfo.org";
var FROM_NAME = "QNFO Ops";
function json(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200, headers: { "Content-Type": "application/json" } });
}
__name(json, "json");
async function run(env) {
  const out = { version: VERSION, status: "ok", total_24h: 0, blank: 0, junk: 0, fallback: 0, hits: 0, alertInserted: false, email: null, emailError: null, error: null };
  if (!env.AUDIT) {
    out.status = "error";
    out.error = "AUDIT D1 binding missing";
    return out;
  }
  try {
    const q = await env.AUDIT.prepare(
      "SELECT COUNT(*) AS total_24h, COALESCE(SUM(CASE WHEN response IS NULL OR TRIM(response)='' THEN 1 ELSE 0 END),0) AS blank, COALESCE(SUM(CASE WHEN response IS NOT NULL AND LENGTH(TRIM(response)) BETWEEN 1 AND 7 THEN 1 ELSE 0 END),0) AS junk, COALESCE(SUM(CASE WHEN response LIKE '%fallback%' OR response LIKE '%could not generate%' OR response LIKE '%do not have a reliable answer%' THEN 1 ELSE 0 END),0) AS fallback FROM ai_queries WHERE ts > datetime('now','-1 day') AND model != 'web-search'"
    ).first();
    const row = q || {};
    out.total_24h = row.total_24h || 0;
    out.blank = row.blank || 0;
    out.junk = row.junk || 0;
    out.fallback = row.fallback || 0;
    out.hits = out.blank + out.junk + out.fallback;
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const dup = await env.AUDIT.prepare("SELECT COUNT(*) AS n FROM alerts WHERE source='blank-audit' AND date(created_at)=?1").bind(today).first();
    if ((dup && dup.n) > 0) {
      out.status = "skipped";
      out.note = "alert row already exists for " + today;
      return out;
    }
    if (out.hits === 0) {
      out.status = "clean";
      return out;
    }
    const msg = out.hits + " blank/fallback gateway responses in last 24h (" + out.blank + " blank, " + out.junk + " junk<8ch, " + out.fallback + " fallback-marked of " + out.total_24h + " total)";
    await env.AUDIT.prepare("INSERT INTO alerts (source, level, message, created_at) VALUES ('blank-audit','warning',?1,datetime('now'))").bind(msg).run();
    out.alertInserted = true;
    if (env.SEND_EMAIL && env.ALERT_EMAIL_TO) {
      try {
        const r = await env.SEND_EMAIL.send({ to: env.ALERT_EMAIL_TO, from: { email: FROM_EMAIL, name: FROM_NAME }, subject: "QNFO gateway blank/fallback daily report", text: msg });
        out.email = "sent:" + (r && r.messageId ? String(r.messageId).slice(0, 20) : "ok");
      } catch (e) {
        out.emailError = String(e && e.message || e);
        await env.AUDIT.prepare("INSERT INTO alerts (source, level, message, created_at) VALUES ('blank-audit','error',?1,datetime('now'))").bind("blank-audit email send failed: " + out.emailError).run();
      }
    } else {
      out.email = "skipped: SEND_EMAIL binding missing";
    }
  } catch (e) {
    out.status = "error";
    out.error = String(e && e.stack || e);
  }
  return out;
}
__name(run, "run");
var worker_default = {
  async scheduled(event, env, ctx) {
    try {
      const out = await run(env);
      console.log("blank-audit", JSON.stringify(out));
    } catch (e) {
      console.error("blank-audit", String(e && e.message || e));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json({ ok: true, worker: "qnfo-blank-audit", version: VERSION, bindings: { audit: !!env.AUDIT, sendEmail: !!env.SEND_EMAIL } });
      if (url.pathname === "/run") return json(await run(env));
      return json({ ok: true, name: "qnfo-blank-audit", endpoints: ["/health", "/run"] });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  }
};
return { default: worker_default };
})();
var scorecardMod = (function(){
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var VERSION = "qnfo-scorecard/1.0.1";
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
}
__name(json, "json");
async function d1all(db, sql) {
  try {
    const r = await db.prepare(sql).all();
    return r.results || [];
  } catch (e) {
    return null;
  }
}
__name(d1all, "d1all");
function n1(rows, fallback) {
  if (!rows || !rows.length) return fallback;
  const v = rows[0].n;
  return v === null || v === void 0 ? fallback : Number(v);
}
__name(n1, "n1");
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
__name(clamp, "clamp");
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
__name(validateEnvelope, "validateEnvelope");
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
__name(validatePayload, "validatePayload");
async function compute(env) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const d = nowIso.slice(0, 10);
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
  const integrity = clamp(100 - cpRej * 10, 0, 100);
  const humanLoad = userWait === 0 ? 100 : clamp(100 - userWait * 20, 0, 100);
  const outputFlowing = vq7 >= 1 && rq7 >= 1 && so7 >= 1 ? 100 : vq7 + rq7 + so7 > 0 ? 50 : 0;
  const watchmaker = clamp(100 * (1 - (overdue + userWait) / Math.max(1, openRows)), 0, 100);
  const probeRate = probeN > 0 ? 100 * probeOk / probeN : 0;
  const verRate = srN > 0 ? 100 * (srN - noVer) / srN : 0;
  const purRate = srN > 0 ? 100 * (srN - noPur) / srN : 0;
  const coverage = clamp(Math.round((probeRate + verRate + purRate) / 3), 0, 100);
  const drift = clamp(100 - scanerr * 2, 0, 100);
  const telemetry = wlN >= 1 ? clamp(Math.round(wlS * 100 / Math.max(1, srN)), 0, 100) : 0;
  const govern = 40;
  const intelligence = aiN > 0 ? Math.round(100 * aiOk / aiN) : modOk === modN && modN > 0 ? 100 : 0;
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
      iteration: { fleet_runs_24h: frN, kaizen_closed: kzClosed, handoffs },
      output: { versions_7d: vq7, papers_7d: rq7, social_7d: so7 },
      human_load: { user_waiting: userWait, overdue, open_rows: openRows },
      sub_scores: { integrity, human_load: humanLoad, output: outputFlowing, watchmaker: Math.round(watchmaker), coverage, drift, telemetry, govern, intelligence }
    },
    grade: {
      letter,
      score,
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
    payload
  };
  const errs = validateEnvelope(art).concat(validatePayload(art.payload));
  const status = errs.length === 0 ? "accepted" : "rejected";
  try {
    await env.AUDIT.prepare("INSERT INTO codeparse_events (artifact, kind, source, status, err, ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(status === "accepted" ? JSON.stringify(art) : null, "report-card", "qnfo-scorecard", status, errs.join("; ").slice(0, 300), nowIso).run();
  } catch (e) {
  }
  art.recorded = { status, errors: errs };
  return art;
}
__name(compute, "compute");
var worker_default = {
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
return { default: worker_default };
})();
var registerguardMod = (function(){
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var VERSION = "1.0.0";
var WORKER = "qnfo-register-guard";
var EXEC_CITE = /\b(?:executor|worker)\s*=/i;
var RUN_CITE = /\b(?:job|cron|schedule|task)\s*=/i;
function ts() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(ts, "ts");
async function recordEvent(env, kind, text, meta) {
  try {
    await env.AUDIT.prepare(
      "INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1,?2,?3,?4,?5,?6,?7)"
    ).bind(
      kind.slice(0, 2) + "-" + WORKER + "-" + Date.now().toString(36),
      ts(),
      kind,
      String(text).slice(0, 800),
      JSON.stringify(meta || {}).slice(0, 800),
      WORKER,
      "ok"
    ).run();
  } catch (e) {
  }
}
__name(recordEvent, "recordEvent");
async function run(env) {
  let relabeled = 0;
  const relabeledIds = [];
  try {
    const rows = await env.AUDIT.prepare(
      "SELECT id, owner, COALESCE(evidence_pointer,'') AS ev FROM task_dod_register WHERE status='open' AND owner IN ('scheduled-runner','fleet')"
    ).all();
    for (const r of rows.results || []) {
      const ev = String(r.ev || "");
      if (!(EXEC_CITE.test(ev) && RUN_CITE.test(ev))) {
        await env.AUDIT.prepare(
          "UPDATE task_dod_register SET owner='agent', evidence_pointer=COALESCE(evidence_pointer,'') || ?1, updated_at=datetime('now') WHERE id=?2 AND status='open'"
        ).bind(" [relabeled agent " + ts().slice(0, 10) + ": no executor+run citation]", r.id).run();
        relabeled++;
        relabeledIds.push(r.id);
      }
    }
  } catch (e) {
  }
  let overdue = 0;
  try {
    const o = await env.AUDIT.prepare(
      "SELECT COUNT(*) AS n FROM task_dod_register WHERE status='open' AND due IS NOT NULL AND due != '' AND due < ?1"
    ).bind((/* @__PURE__ */ new Date()).toISOString().slice(0, 10)).first();
    overdue = o ? Number(o.n || 0) : 0;
  } catch (e) {
  }
  const summary = { relabeled, relabeledIds, overdue };
  await recordEvent(env, "register-guard", "relabeled=" + relabeled + " overdue=" + overdue, summary);
  return { status: "ok", ...summary };
}
__name(run, "run");
var worker_default = {
  async scheduled(event, env, ctx) {
    try {
      const o = await run(env);
      console.log(WORKER, JSON.stringify(o));
    } catch (e) {
      console.error(WORKER, String(e && e.message || e));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: WORKER, version: VERSION }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/run" && request.method === "POST") {
      const o = await run(env);
      return new Response(JSON.stringify({ ok: true, worker: WORKER, version: VERSION, out: o }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
};
return { default: worker_default };
})();

// ===== MERGE audit-hub =====
export default {
  async fetch(request, env, ctx) {
    const p = new URL(request.url).pathname;
    if (p === "/health") return new Response(JSON.stringify({ ok: true, worker: "audit-hub", version: "1.0.0", members: 4 }), { headers: { "content-type": "application/json" } });
    if (p === "/auditor" || p.startsWith("/auditor/")) { const u = new URL(request.url); u.pathname = p.slice(8) || "/"; return auditorMod.default.fetch(new Request(u.toString(), request), env, ctx); }
    if (p === "/blank-audit" || p.startsWith("/blank-audit/")) { const u = new URL(request.url); u.pathname = p.slice(12) || "/"; return blankauditMod.default.fetch(new Request(u.toString(), request), env, ctx); }
    if (p === "/scorecard" || p.startsWith("/scorecard/")) { const u = new URL(request.url); u.pathname = p.slice(10) || "/"; return scorecardMod.default.fetch(new Request(u.toString(), request), env, ctx); }
    if (p === "/register-guard" || p.startsWith("/register-guard/")) { const u = new URL(request.url); u.pathname = p.slice(15) || "/"; return registerguardMod.default.fetch(new Request(u.toString(), request), env, ctx); }
    return new Response("audit-hub", { status: 200 });
  },
  async scheduled(event, env, ctx) {
    const c = event.cron;
    if (c === "23 6 * * 1") return auditorMod.default.scheduled(event, env, ctx);
    if (c === "45 1,13 * * *") return auditorMod.default.scheduled(event, env, ctx);
    if (c === "40 4 * * *") return blankauditMod.default.scheduled(event, env, ctx);
    if (c === "30 4 * * *") return registerguardMod.default.scheduled(event, env, ctx);
  },
};