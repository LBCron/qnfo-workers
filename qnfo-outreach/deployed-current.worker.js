var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
import { EmailMessage } from "cloudflare:email";
var VERSION = "0.3.9-email-utm"; /* 0.3.9 EMAIL-UTM-1 (2026-11-04, pillar reach): links to qnfo.org, papers.qnfo.org, q08.org and qwav.org in a sent body carry utm_source=email&utm_medium=email&utm_campaign=<template>, so reach_signals/v_channel_impact_7d can count email clicks (7d: 18 sends, 0 attributed clicks because no link was tagged). */ /* OUTREACH-CF-DOW-1: cron 0 11 * * 2-6 (Cloudflare Mon-Fri; 1-5 was Sun-Thu) */
var ACTIVATION_AT_MS = Date.parse("2026-09-13T00:00:00Z");
var WARMUP_FROM_MS = Date.parse("2026-09-08T00:00:00Z");
var GLOBAL_DAILY_CAP = 8;
var PER_DOMAIN_DAILY_CAP = 3;
var WARMUP_ALLOWLIST = ["alerts@qnfo.org", "qnfo@qnfo.org", "rowan.quni@qnfo.org", "rwnquni@outlook.com", "rowan.quni@outlook.com"];
var FROM_ACADEMIC = "rowan.quni@qnfo.org";
var SPAM_TOKENS = ["TEST", "SEND TEST", "WRANGLER", "MATRIX", "VERIFY", "verification code", "PIPELINE TEST", "FREE", "!!!"];
var GITHUB_QUERIES = ["topic:energy-efficiency", "topic:hpc", "topic:quantum-control", "topic:green-software"];
var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
__name(json, "json");
function utcDay() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
__name(utcDay, "utcDay");
function makeId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
__name(makeId, "makeId");
function fill(tpl, ct) {
  return String(tpl || "").replaceAll("{{name}}", ct.name || "there").replaceAll("{{topic}}", (ct.tags || "").split(",")[0] || "this area").replaceAll("{{org}}", ct.org || "your organization");
}
__name(fill, "fill");
function subjectClean(subject) {
  const s = String(subject || "").toUpperCase();
  return !SPAM_TOKENS.some((t) => s.includes(t.toUpperCase()));
}
__name(subjectClean, "subjectClean");
async function sendRaw(env, from, to, subject, bodyText) {
  try {
    // SUPPRESSION-1 (2026-09-22): honour opt-out before any send (fail-open on DB error).
    const _db = env.QNFO_AUDIT || env.AUDIT_DB || env.AUDIT;
    if (_db) { try { const _e = String(to).toLowerCase(); const _s = await _db.prepare("SELECT 1 FROM email_suppression WHERE lower(email)=?1").bind(_e).first(); if (_s) return { ok: false, err: "suppressed", to: to }; const _l = await _db.prepare("SELECT suppress FROM contact_ledger WHERE lower(email)=?1").bind(_e).first(); if (_l && _l.suppress) return { ok: false, err: "suppressed", to: to }; } catch (_e) {} }
    const r = await env.SEND_EMAIL.send({ to, from, subject, text: bodyText });
    const mid = r && r.messageId ? String(r.messageId) : null;
    return { ok: true, err: "", messageId: mid };
  } catch (e) {
    return { ok: false, err: String(e && e.message || e) };
  }
}
__name(sendRaw, "sendRaw");
async function noRepeat(env, email) {
  const e = email.toLowerCase();
  const s = await env.OUTREACH_D1.prepare(
    "SELECT 1 FROM sends WHERE contact_id IN (SELECT id FROM contacts WHERE email = ?1) AND status IN ('sent','queued') LIMIT 1"
  ).bind(e).first();
  if (s) return true;
  try {
    const legacy = await env.OUTREACH_D1.prepare(
      "SELECT 1 FROM outreach_campaigns WHERE lower(recipient_email) = ?1 AND status IN ('sent','followed_up') LIMIT 1"
    ).bind(e).first();
    if (legacy) return true;
  } catch (err) {
  }
  try {
    const audit = await env.QNFO_AUDIT.prepare(
      "SELECT 1 FROM outreach_log WHERE lower(email) = ?1 AND status IN ('sent','followup','replied') LIMIT 1"
    ).bind(e).first();
    if (audit) return true;
  } catch (err) {
  }
  return false;
}
__name(noRepeat, "noRepeat");
async function mineGitHub(env, count = 3) {
  const q = GITHUB_QUERIES[Math.floor(Math.random() * GITHUB_QUERIES.length)];
  const resp = await fetch("https://api.github.com/search/repositories?q=" + encodeURIComponent(q) + "&sort=updated&per_page=5", {
    headers: { "User-Agent": "qnfo-outreach/" + VERSION, "Accept": "application/vnd.github+json" }
  });
  if (!resp.ok) return { mined: 0, err: "github search " + resp.status };
  const data = await resp.json();
  const repos = (data.items || []).slice(0, count);
  let mined = 0;
  for (const repo of repos) {
    const owner = repo.owner && repo.owner.login;
    if (!owner) continue;
    const uresp = await fetch("https://api.github.com/users/" + owner, { headers: { "User-Agent": "qnfo-outreach/" + VERSION } });
    if (!uresp.ok) continue;
    const u = await uresp.json();
    const email = String(u.email || "").toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    const existing = await env.OUTREACH_D1.prepare("SELECT id FROM contacts WHERE email = ?1").bind(email).first();
    if (existing) continue;
    await env.OUTREACH_D1.prepare(
      "INSERT INTO contacts (id, email, name, org, role, audience, tags, source, source_ref) VALUES (?1,?2,?3,?4,'practitioner','practitioner',?5,'github',?6)"
    ).bind(
      makeId("c-"),
      email,
      String(u.name || "").slice(0, 120),
      String(u.company || "").slice(0, 120),
      (repo.topics || []).slice(0, 5).join(","),
      String(repo.html_url || "").slice(0, 200)
    ).run();
    mined++;
  }
  return { mined };
}
__name(mineGitHub, "mineGitHub");
async function draftCampaigns(env) {
  const campaigns = await env.OUTREACH_D1.prepare("SELECT * FROM campaigns WHERE status = 'active' AND starts_at <= datetime('now')").all();
  let drafted = 0;
  for (const c of campaigns.results || []) {
    const total = await env.OUTREACH_D1.prepare("SELECT COUNT(*) n FROM sends WHERE campaign_id = ?1").bind(c.id).first();
    if ((total && total.n || 0) >= c.total_cap) continue;
    const contacts = await env.OUTREACH_D1.prepare(
      "SELECT * FROM contacts WHERE suppress = 0 AND status IN ('new','verified') AND audience = ?1 AND NOT EXISTS (SELECT 1 FROM sends s WHERE s.contact_id = contacts.id AND s.kind = ?2) ORDER BY first_seen LIMIT ?3"
    ).bind(c.audience, c.template_key, c.daily_cap).all();
    for (const ct of contacts.results || []) {
      await env.OUTREACH_D1.prepare(
        "INSERT INTO sends (id, campaign_id, contact_id, kind, channel, subject, body, status) VALUES (?1,?2,?3,?4,'email',?5,?6,'draft')"
      ).bind(makeId("s-"), c.id, ct.id, c.template_key, fill(c.subject_template, ct).slice(0, 200), fill(c.body_template, ct)).run();
      drafted++;
    }
  }
  return drafted;
}
__name(draftCampaigns, "draftCampaigns");
async function sha16(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
async function unsubUrl(email) {
  const e = String(email || "").toLowerCase();
  const h = await sha16(e + ":qnfo-unsub-2026");
  return "https://qnfo.org/email/unsubscribe?e=" + encodeURIComponent(e) + "&t=" + h.slice(0, 16);
}
function utmEmail(body, campaign) {
  const camp = encodeURIComponent(String(campaign || "outreach").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40) || "outreach");
  return String(body || "").replace(/https?:\/\/(?:[a-z0-9-]+\.)*(?:qnfo\.org|q08\.org|qwav\.org)(?:\/[^\s<>"')\]]*)?/gi, function (u) {
    if (/[?&]utm_source=/i.test(u) || /\/email\/unsubscribe/i.test(u)) return u;
    const tail = (u.match(/[.,;:!]+$/) || [""])[0];
    const base = tail ? u.slice(0, -tail.length) : u;
    const h = base.indexOf("#");
    const b = h < 0 ? base : base.slice(0, h), f = h < 0 ? "" : base.slice(h);
    return b + (b.indexOf("?") < 0 ? "?" : "&") + "utm_source=email&utm_medium=email&utm_campaign=" + camp + f + tail;
  });
}
__name(utmEmail, "utmEmail");
async function compliant(body, email, campaign) {
  body = utmEmail(body, campaign);
  const url = await unsubUrl(email);
  const footer = "\n\n--\nThis was sent once, to one person. If you would rather not receive anything further from me: " + url + "\nReplying with STOP also works and I will remove you within a day.\nRowan Brad Quni-Gudzinas, QNFO (Netherlands)";
  return String(body || "") + footer;
}
async function suppressed(env, email) {
  const e = String(email || "").toLowerCase();
  try { const row = await env.QNFO_AUDIT.prepare("SELECT 1 FROM email_suppression WHERE lower(email)=?1").bind(e).first(); if (row) return true; } catch (err) {}
  try { const c = await env.OUTREACH_D1.prepare("SELECT suppress FROM contacts WHERE lower(email)=?1").bind(e).first(); if (c && Number(c.suppress) === 1) return true; } catch (err) {}
  return false;
}
async function scanReplies(env) {
  let last = 0;
  try { const s = await env.OUTREACH_D1.prepare("SELECT value FROM pipeline_state WHERE key='reply_scan_watermark'").first(); last = Number((s && s.value) || 0) || 0; } catch (e) {}
  let rows = [];
  try {
    rows = ((await env.QNFO_AUDIT.prepare("SELECT id, sender, subject, substr(COALESCE(body_text,''),1,3000) body FROM emails WHERE id > ?1 AND status != 'sent' ORDER BY id ASC LIMIT 200").bind(last).all()).results) || [];
  } catch (e) { return { scanned: 0, suppressed: 0, err: String(e).slice(0, 120) }; }
  const STOP = /\b(unsubscribe|opt[\s-]?out|remove me|stop emailing|do not contact|don'?t contact|take me off|no further (emails?|contact)|leave me alone)\b/i;
  // REPLY-SCAN-QUOTED-FIX (2026-09-22): strip quoted history + our own footer/URLs before matching,
  // so a genuine reply that merely quotes our unsubscribe footer is NOT misread as a STOP opt-out.
  const stripQuoted = function (s) {
    let t = String(s || "");
    t = t.split(/\r?\n/).filter(function (l) { return !/^\s*>/.test(l); }).join("\n");
    t = t.split(/\r?\n\s*(?:On .{0,120}?wrote:|Am .{0,120}?schrieb|Le .{0,120}?\u00e9crit|From: .{0,120})\s*:?/i)[0];
    t = t.replace(/https?:\/\/\S*unsubscribe\S*/gi, " ");
    t = t.replace(/This was sent once, to one person[\s\S]*$/i, " ");
    return t;
  };
  let maxId = last, n = 0;
  for (const row of rows) {
    if (row.id > maxId) maxId = row.id;
    const from = String(row.sender || "").toLowerCase();
    if (/srs0=|cf-bounce|bounces\+|mailer-daemon|postmaster|noreply|no-reply/.test(from)) continue;
    const m = from.match(/[^@\s<>]+@[^@\s<>]+/);
    const addr = m ? m[0].replace(/[>,]+$/, "") : "";
    if (!addr || !EMAIL_RE.test(addr)) continue;
    // OUTREACH-CONSENT-1 (2026-10-01): the cold-email opt-out line now says reply "stop", so a reply whose subject or
    // first written line is just "stop" counts too. Only the first line is tested, so "I can't stop reading" is not a STOP.
    const firstLine = (stripQuoted(row.body).split(/\r?\n/).find(function (l) { return l.trim(); }) || "").trim();
    const bareStop = /^\W*(please\s+)?stop\W*$/i.test(firstLine) || /^(re:\s*)*\W*stop\W*$/i.test(String(row.subject || "").trim());
    if (bareStop || STOP.test(String(row.subject || "") + " " + stripQuoted(row.body))) {
      try {
        await env.QNFO_AUDIT.prepare("INSERT INTO email_suppression (email, reason, source) VALUES (?1,'reply-stop','reply-scan') ON CONFLICT(email) DO UPDATE SET reason='reply-stop', source='reply-scan', created_at=datetime('now')").bind(addr).run();
        await env.OUTREACH_D1.prepare("UPDATE contacts SET suppress=1, suppress_reason=?1 WHERE lower(email)=?2").bind("reply-stop " + utcDay(), addr).run();
        await env.OUTREACH_D1.prepare("UPDATE sends SET status='suppressed' WHERE status IN ('draft','queued') AND contact_id IN (SELECT id FROM contacts WHERE lower(email)=?1)").bind(addr).run();
        n++;
      } catch (e) {}
    }
  }
  try {
    await env.OUTREACH_D1.prepare("INSERT INTO pipeline_state (key,value,updated_at) VALUES ('reply_scan_watermark',?1,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").bind(String(maxId)).run();
  } catch (e) {}
  return { scanned: rows.length, suppressed: n, watermark: maxId };
}
// OUTREACH-SHARED-CAP-1 (2026-10-01, #1718): the 8/day total and 3/day per-domain caps (docs/STRATEGY.md s5) span BOTH
// engines. This engine counted only its own sends table, and qnfo-cloud-ops jobOutreach sends from qnfo-audit
// outreach_log, so together they could send 16/day. The shared count reads both ledgers for the UTC day; it throws on a
// read error and the caller stops sending for the run (fail closed). Self-checks to the owner's address are not counted.
async function sharedOutreachCount(env, day, email) {
  const dom = "%@" + String(email || "").toLowerCase().split("@").pop();
  const a = await env.OUTREACH_D1.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN lower(c.email) LIKE ?2 THEN 1 ELSE 0 END),0) AS d FROM sends s LEFT JOIN contacts c ON c.id = s.contact_id WHERE s.status = 'sent' AND s.sent_at LIKE ?1 AND COALESCE(s.kind,'') <> 'selfcheck'").bind(day + "%", dom).first();
  const b = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN lower(email) LIKE ?2 THEN 1 ELSE 0 END),0) AS d FROM outreach_log WHERE sent_at LIKE ?1 AND status IN ('sent','followup','replied')").bind(day + "%", dom).first();
  return { n: Number(a && a.n || 0) + Number(b && b.n || 0), d: Number(a && a.d || 0) + Number(b && b.d || 0) };
}
async function sendGated(env) {
  const now = Date.now();
  const day = utcDay();
  const kill = await env.OUTREACH_D1.prepare("SELECT value FROM pipeline_state WHERE key = 'external_sends_enabled'").first();
  const sentToday = await env.OUTREACH_D1.prepare("SELECT COUNT(*) n FROM sends WHERE status = 'sent' AND sent_at LIKE ?1").bind(day + "%").first();
  const budget = GLOBAL_DAILY_CAP - (sentToday && sentToday.n || 0);
  if (budget <= 0) return { sent: 0, skipped: "budget" };
  const canExternal = now >= ACTIVATION_AT_MS && kill && kill.value === "1";
  const canWarmup = now >= WARMUP_FROM_MS;
  let sent = 0;
  if (canWarmup && !canExternal) {
    const selfToday = await env.OUTREACH_D1.prepare("SELECT 1 FROM sends WHERE kind = 'selfcheck' AND sent_at LIKE ?1 LIMIT 1").bind(day + "%").first();
    if (!selfToday) {
      const res = await sendRaw(env, FROM_ACADEMIC, "rwnquni@outlook.com", "Outreach pipeline self-check " + day, "Automated daily self-check of the qnfo-outreach send path. No action needed.");
      await env.OUTREACH_D1.prepare(
        "INSERT INTO sends (id, campaign_id, contact_id, kind, channel, subject, body, status, sent_at) VALUES (?1,NULL,NULL,'selfcheck','email','Outreach pipeline self-check','self-check',?2,datetime('now'))"
      ).bind(makeId("s-"), res.ok ? "sent" : "failed").run();
      if (res.ok) sent++;
    }
  }
  if (!canExternal) return { sent, skipped: "pre-activation" };
  const queue = await env.OUTREACH_D1.prepare(
    "SELECT s.* FROM sends s JOIN campaigns c ON c.id = s.campaign_id WHERE s.status = 'draft' AND c.status = 'active' ORDER BY s.created_at LIMIT 30"
  ).all();
  for (const row of queue.results || []) {
    if (sent >= budget) break;
    const contact = await env.OUTREACH_D1.prepare("SELECT * FROM contacts WHERE id = ?1").bind(row.contact_id).first();
    if (!contact || contact.suppress) {
      await env.OUTREACH_D1.prepare("UPDATE sends SET status = 'suppressed' WHERE id = ?1").bind(row.id).run();
      continue;
    }
    const to = String(contact.email || "").toLowerCase();
    if (!EMAIL_RE.test(to) || WARMUP_ALLOWLIST.includes(to)) continue;
    if (!subjectClean(row.subject)) {
      await env.OUTREACH_D1.prepare("UPDATE sends SET status = 'suppressed' WHERE id = ?1").bind(row.id).run();
      continue;
    }
    if (await noRepeat(env, to)) {
      await env.OUTREACH_D1.prepare("UPDATE sends SET status = 'suppressed' WHERE id = ?1").bind(row.id).run();
      continue;
    }
    if (await suppressed(env, to)) {
      await env.OUTREACH_D1.prepare("UPDATE sends SET status = 'suppressed' WHERE id = ?1").bind(row.id).run();
      continue;
    }
    let shared;
    try {
      shared = await sharedOutreachCount(env, day, to);
    } catch (e) {
      // OUTREACH-SHARED-CAP-1 (2026-10-01, #1718): fail closed AND say so; a silent break left no trace of the skip.
      return { sent, skipped: "shared-cap-read-failed", error: String(e && e.message || e) };
    }
    if (shared.n >= GLOBAL_DAILY_CAP) return { sent, skipped: "shared-cap", shared_today: shared.n };
    if (shared.d >= PER_DOMAIN_DAILY_CAP) continue;
    const finalBody = await compliant(row.body, to, row.kind);
    const res = await sendRaw(env, FROM_ACADEMIC, to, row.subject, finalBody);
    if (res.ok) {
      await env.OUTREACH_D1.prepare("UPDATE sends SET status='sent', sent_at=datetime('now'), message_id=?2 WHERE id=?1").bind(row.id, res.messageId).run();
      await env.OUTREACH_D1.prepare(
        "UPDATE contacts SET status='contacted', last_contacted=datetime('now'), contact_count=contact_count+1 WHERE id=?1"
      ).bind(row.contact_id).run();
      sent++;
    } else {
      await env.OUTREACH_D1.prepare("UPDATE sends SET status='failed' WHERE id=?1").bind(row.id).run();
    }
  }
  return { sent, skipped: "" };
}
__name(sendGated, "sendGated");
async function bumpFunnel(env, mined, drafted, sent) {
  const day = utcDay();
  await env.OUTREACH_D1.prepare(
    "INSERT INTO funnel_daily (day, mined, drafted, sent) VALUES (?1,?2,?3,?4) ON CONFLICT(day) DO UPDATE SET mined = mined + ?2, drafted = drafted + ?3, sent = sent + ?4"
  ).bind(day, mined, drafted, sent).run();
}
__name(bumpFunnel, "bumpFunnel");
var worker_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    if (path === "/health" || path === "/") {
      return json({
        ok: true,
        worker: "qnfo-outreach",
        version: VERSION,
        activation_at: "2026-09-13T00:00:00Z",
        warmup_from: "2026-09-08T00:00:00Z",
        cron: "0 11 * * 2-6",
        capabilities: ["contact-mining", "campaign-sends", "warmup-self-check", "rfc-comments"],
        limitations: ["/api/* needs Bearer OUTREACH_TOKEN and fails closed (503) while that secret is unset", "sends only on the weekday 11:00 cron, inside the fleet-wide shared daily and per-domain caps (fail closed)", "never mails a suppressed address (email_suppression or contacts.suppress)", "warm-up mail goes only to the own-mailbox allowlist"],
        mode: Date.now() >= ACTIVATION_AT_MS ? "external-enabled" : "draft+warmup",
        day: utcDay()
      });
    }
    // API-AUTH-1 (2026-10-01): /api/* returns contact PII and message bodies and can mine or send,
    // so it needs Bearer OUTREACH_TOKEN. Fails closed when the secret is unset. The cron is unaffected.
    if (path.startsWith("/api/")) {
      const exp = env.OUTREACH_TOKEN;
      if (!exp) return json({ ok: false, err: "OUTREACH_TOKEN not configured" }, 503);
      const got = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
      let d = got.length === exp.length ? 0 : 1;
      for (let i = 0; i < exp.length; i++) d |= (got.charCodeAt(i) || 0) ^ exp.charCodeAt(i);
      if (d !== 0) return json({ ok: false, err: "unauthorized" }, 401);
    }
    if (path === "/api/contacts" && method === "GET") {
      const rows = await env.OUTREACH_D1.prepare("SELECT * FROM contacts ORDER BY first_seen DESC LIMIT 50").all();
      return json(rows.results);
    }
    if (path === "/api/campaigns" && method === "GET") {
      const rows = await env.OUTREACH_D1.prepare("SELECT * FROM campaigns ORDER BY starts_at").all();
      return json(rows.results);
    }
    if (path === "/api/sends" && method === "GET") {
      const status = url.searchParams.get("status") || "";
      const rows = status ? await env.OUTREACH_D1.prepare("SELECT * FROM sends WHERE status = ?1 ORDER BY created_at DESC LIMIT 50").bind(status).all() : await env.OUTREACH_D1.prepare("SELECT * FROM sends ORDER BY created_at DESC LIMIT 50").all();
      return json(rows.results);
    }
    if (path === "/api/rfcs" && method === "GET") {
      const rows = await env.OUTREACH_D1.prepare("SELECT * FROM rfc_topics ORDER BY id").all();
      return json(rows.results);
    }
    if (path === "/api/miners/github" && method === "POST") {
      const r = await mineGitHub(env);
      await bumpFunnel(env, r.mined || 0, 0, 0);
      return json(r);
    }
    if (path === "/api/warmup" && method === "POST") {
      let body = {};
      try {
        body = await req.json();
      } catch (e) {
        body = {};
      }
      const to = String(body.to || "qnfo@qnfo.org").toLowerCase();
      if (!WARMUP_ALLOWLIST.includes(to)) return json({ ok: false, err: "recipient not in own-mailbox allowlist" }, 403);
      const res = await sendRaw(env, FROM_ACADEMIC, to, "Outreach pipeline self-check " + utcDay(), "Automated self-check of the qnfo-outreach send path. No action needed.");
      await env.OUTREACH_D1.prepare(
        "INSERT INTO sends (id, campaign_id, contact_id, kind, channel, subject, body, status, sent_at) VALUES (?1,NULL,NULL,'selfcheck','email','Outreach pipeline self-check','self-check',?2,datetime('now'))"
      ).bind(makeId("s-"), res.ok ? "sent" : "failed").run();
      return json({ ok: res.ok, err: res.err, to });
    }
    const rfcMatch = path.match(/^\/rfc\/([a-z0-9-]+)\/comment$/);
    if (rfcMatch && method === "POST") {
      let b = {};
      try {
        b = await req.json();
      } catch (e) {
        b = {};
      }
      const topic = await env.OUTREACH_D1.prepare("SELECT * FROM rfc_topics WHERE slug = ?1").bind(rfcMatch[1]).first();
      if (!topic) return json({ ok: false, err: "unknown rfc topic" }, 404);
      const answer = String(b.answer || "").slice(0, 4e3);
      const fromEmail = String(b.email || "").toLowerCase().slice(0, 200);
      if (!answer) return json({ ok: false, err: "answer required" }, 400);
      await env.OUTREACH_D1.prepare(
        "INSERT INTO rfc_responses (id, rfc_topic, from_email, question, answer) VALUES (?1,?2,?3,?4,?5)"
      ).bind(makeId("r-"), topic.slug, fromEmail, topic.question, answer).run();
      return json({ ok: true, topic: topic.slug });
    }
    return json({ ok: false, err: "not found" }, 404);
  },
  async scheduled(controller, env, ctx) {
    await scanReplies(env).catch(() => ({ scanned: 0 }));
    const mined = await mineGitHub(env).catch(() => ({ mined: 0 }));
    const drafted = await draftCampaigns(env).catch(() => 0);
    const sent = await sendGated(env).catch((e) => ({ sent: 0, skipped: "send-error", error: String(e && e.message || e) }));
    // OUTREACH-SHARED-CAP-1 (2026-10-01, #1718): keep the last send run's outcome (incl. a fail-closed skip) readable.
    await env.OUTREACH_D1.prepare("INSERT INTO pipeline_state (key,value,updated_at) VALUES ('last_send_run',?1,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").bind(JSON.stringify(sent).slice(0, 1000)).run().catch(() => {
    });
    await bumpFunnel(env, mined.mined || 0, drafted, sent.sent || 0).catch(() => {
    });
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map