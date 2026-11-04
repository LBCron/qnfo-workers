import { connect } from "cloudflare:sockets";
// qnfo-cloud-ops v1.4.0 — Cloud scheduler (Workers Cron Triggers)
// Replaces the local DeepChat scheduled-task fleet with cloud-only execution.
// Jobs dispatched by cron string (UTC; Amsterdam wall-clock preserved via DST sync).
// v1.4.0: zenodo-stats carries the ADR-014 attribution audit (creators + related_identifiers
// captured per record; creator violations flagged; sole-author mandate held) and weekly-ops
// carries SEO discoverability health (papers/qnfo/qwav/qwav.tech: status + title + JSON-LD).
// v1.11.0: jobVisibility adds an outreach section (qnfo-outreach funnel_daily + submissions via
// OUTREACH binding) - closes the P7 scorecard loop for the outreach/submission engine.
// v1.10.0: jobEngagement (weekly Mon 07:15 AMS) collects Bluesky + Buffer per-post engagement
// into qnfo-audit.social_engagements; jobVisibility digest adds citation + engagement sections.
// v1.2.0+: vectorized event store (OPS_VZ, doc=cloud-ops) + SILENCE POLICY — no
// automated email to personal inboxes except: briefing with decision items,
// job failures, new DeepChat stable release, cost alert >$90, NLnet one-shot.
// Author: QNFO. Deployed via Cloudflare API. Canonical source: QNFO/qnfo-ops/cloud/scheduler/worker.js

const VERSION = "1.14.0"; // outreach activation gate + email validation (2026-09-03 RED-TEAM legacy-drain gate) // visibility digest adds Ops AI section (WHAT-ELSE P0-2 2026-09-03)
const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
const ACCOUNT = "edb167b78c9fb901ea5bca3ce58ccc4b";
const WORKER_NAME = "qnfo-cloud-ops";
const EMAIL_BASE = "https://qnfo-email.internal";
const NL = String.fromCharCode(10);

// ---------- auth ----------
function auth(token, env) {
  const exp = env.INFRA_TOKEN;
  const adm = env.OPS_ADMIN_TOKEN;
  if (!token) return false;
  const ok = (k) => { const a = new TextEncoder().encode(token); const b = new TextEncoder().encode(k || ""); if (a.byteLength !== b.byteLength) return false; let d = 0; for (let i = 0; i < a.byteLength; i++) d |= a[i] ^ b[i]; return d === 0; };
  return ok(exp) || ok(adm);
}

// ---------- audit log ----------
async function logRun(env, job, status, notes) {
  try {
    await env.AUDIT.prepare(
      "INSERT INTO audit_sessions (session_id, agent, start_time, end_time, tasks_completed, tasks_total, notes) VALUES (?1,?2,?3,?4,?5,?6,?7)"
    ).bind(
      "cloud-ops-" + job + "-" + Date.now().toString(36),
      "qnfo-cloud-ops",
      new Date().toISOString(),
      new Date().toISOString(),
      status === "ok" ? 1 : 0,
      1,
      JSON.stringify({ job, status, ...notes }).slice(0, 500)
    ).run();
  } catch (e) { /* audit write is best-effort */ }
}

// ---------- scheduler state (D1 qnfo-audit.scheduler_state) ----------
async function stateGet(env, key, fallback) {
  try {
    const r = await env.AUDIT.prepare("SELECT value FROM scheduler_state WHERE key = ?1").bind(key).first();
    return (r && r.value !== null && r.value !== undefined) ? r.value : fallback;
  } catch (e) { return fallback; }
}
async function stateSet(env, key, value) {
  try {
    await env.AUDIT.prepare(
      "INSERT INTO scheduler_state (key, value, updated_at) VALUES (?1,?2, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
    ).bind(key, String(value)).run();
  } catch (e) { /* best-effort */ }
}

// ---------- email digest ----------
async function sendDigest(env, subject, text, toOverride) {
  if (!env.SEND_EMAIL) return { error: "SEND_EMAIL binding missing" };
  const toRaw = toOverride || env.DIGEST_TO || env.ALERT_EMAIL_TO || "";
  const dom = String(toRaw).split('@')[1] || '';
  if (HUMAN_DOMAINS.has(dom)) return { skipped: 'personal-domain', to: toRaw }; // user directive 2026-09-02: never auto-email personal inboxes
  const to = toRaw;
  try {
    const r = await env.SEND_EMAIL.send({ to, from: { email: "alerts@qnfo.org", name: "QNFO Ops" }, subject, text });
    return { ok: true, messageId: r && r.messageId, to };
  } catch (e) {
    return { error: String(e && e.message || e), to };
  }
}

// ---------- vectorized event store (OPS_VZ) + silent digest ----------
async function embedText(env, text) {
  try {
    const resp = await env.AI.run(EMBED_MODEL, { text: [String(text).slice(0, 1800)] }, { gateway: { id: "default" } });
    const v = (resp && resp.data || []).find((x) => Array.isArray(x) && x.length === 768);
    return v || null;
  } catch (e) { return null; }
}

async function recordEvent(env, kind, id, text, meta) {
  const m = Object.assign({}, meta || {});
  try {
    await env.AUDIT.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1,?2,?3,?4,?5,?6,?7)")
      .bind(id, new Date().toISOString(), kind, String(text).slice(0, 2000), JSON.stringify(m).slice(0, 1500), m.job || null, m.status || null).run();
  } catch (e) {}
  try {
    if (env.OPS_VZ) {
      const v = await embedText(env, kind + ": " + text);
      if (v) {
        await env.OPS_VZ.upsert([{ id, values: v, metadata: { doc: "cloud-ops", kind, ts: new Date().toISOString(), text: String(text).slice(0, 1500), ...m } }]);
      }
    }
  } catch (e) {}
  return { stored: true, id };
}

async function storeDigest(env, job, subject, text) {
  return recordEvent(env, "digest", "dg-" + job + "-" + Date.now().toString(36), subject + NL + text, { job });
}

// ---------- qnfo-email service ----------
async function cfEmail(env, path, opts = {}) {
  const url = new URL(EMAIL_BASE + path);
  const headers = { Authorization: "Bearer " + (env.EMAIL_API_KEY || "") };
  if (opts.body) headers["Content-Type"] = "application/json";
  const resp = await env.EMAIL.fetch(url.toString(), { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let j = null;
  try { j = await resp.json(); } catch (e) { j = null; }
  if (!resp.ok) return { error: (j && j.error) || "email svc HTTP " + resp.status };
  return j;
}

// ---------- GitHub helpers ----------
function ghHeaders(env, extra) { return { Authorization: "Bearer " + (env.GH_TOKEN || ""), "User-Agent": "qnfo-cloud-ops/" + VERSION, Accept: "application/vnd.github+json", ...(extra || {}) }; }
async function ghGet(env, path) {
  const r = await fetch("https://api.github.com" + path, { headers: ghHeaders(env) });
  const txt = await r.text().catch(() => "");
  let j = null;
  try { j = JSON.parse(txt); } catch (e) { j = null; }
  return { status: r.status, body: j, raw: txt.slice(0, 200) };
}
async function ghPost(env, path, body) {
  const r = await fetch("https://api.github.com" + path, { method: "POST", headers: ghHeaders(env), body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => null);
  return { status: r.status, body: j };
}
async function ghPut(env, path, body) {
  const r = await fetch("https://api.github.com" + path, { method: "PUT", headers: ghHeaders(env), body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => null);
  return { status: r.status, body: j };
}

// ---------- Cloudflare API (for DST schedule rebuild) ----------
async function cfApi(env, path, method, body) {
  const r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + ACCOUNT + path, {
    method: method || "GET",
    headers: { Authorization: "Bearer " + (env.CF_TOKEN || ""), "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (qnfo-cloud-ops)" },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, body: j };
}

// ---------- Amsterdam schedule model (canonical wall-clock times) ----------
const AMS_SCHEDULE = {
  "release-check":  { times: ["06:15"], days: "*",   fixed: null },
  "email-triage":   { times: ["08:00", "14:00"], days: "1-5", fixed: null },
  "briefing":       { times: ["08:30"], days: "1-5", fixed: null },
  "gmail-triage":   { times: ["09:00", "15:00"], days: "1-5", fixed: null },
  "research-scan":  { times: ["10:00"], days: "1-5", fixed: null },
  "weekly":         { times: ["17:00"], days: "5",   fixed: null },
  "weekly-ops":     { times: ["06:00"], days: "7",   fixed: null },
  "portfolio-sync": { times: ["08:00"], days: "1",   fixed: null },
  "zenodo-stats":   { times: ["09:00"], days: "7",   fixed: null },
  "board-sync":     { times: ["08:00"], days: "6",   fixed: null },
  "outreach":       { times: ["11:00"], days: "1-5", fixed: null },
  "nlnet":          { times: ["11:00"], days: null,  fixed: { dom: 3, mon: 9 } },
  "worker-health":  { times: ["05:05", "17:05"], days: "*",   fixed: null },
  "sitemap-ping":   { times: ["06:00"], days: null,  fixed: { dom: 1, mon: "*" } },
  "loose-threads-sweep": { times: ["07:00"], days: "1", fixed: null },
  "visibility":      { times: ["07:30"], days: "1", fixed: null },
  "engagement":      { times: ["07:15"], days: "1", fixed: null },
  "monthly-cost-report": { times: ["09:00"], days: null, fixed: { dom: 1, mon: "*" } },
};

// Build cron strings (UTC) for a given Amsterdam UTC offset in hours (+2 CEST, +1 CET).
function buildCrons(offset) {
  const crons = [];
  for (const [job, s] of Object.entries(AMS_SCHEDULE)) {
    if (s.fixed) {
      const [hh, mm] = s.times[0].split(":").map(Number);
      let u = hh - offset; if (u < 0) u += 24;
      crons.push({ job, cron: mm + " " + u + " " + s.fixed.dom + " " + s.fixed.mon + " *" });
    } else {
      const byMinute = {};
      for (const t of s.times) {
        const [hh, mm] = t.split(":").map(Number);
        let u = hh - offset; if (u < 0) u += 24;
        (byMinute[mm] = byMinute[mm] || []).push(u);
      }
      for (const [mm, hours] of Object.entries(byMinute)) {
        const hs = [...new Set(hours)].sort((a, b) => a - b).join(",");
        crons.push({ job, cron: mm + " " + hs + " * * " + s.days });
      }
    }
  }
  return crons;
}

// Current Europe/Amsterdam UTC offset in hours for a given instant.
function amsOffset(instant) {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Amsterdam", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const parts = dtf.formatToParts(instant || new Date());
    const m = {}; for (const p of parts) m[p.type] = p.value;
    const asUTC = Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), Number(m.hour), Number(m.minute), Number(m.second));
    const t = (instant || new Date()).getTime();
    const raw = (asUTC - t) / 3600000;
    return Math.round(raw * 2) / 2; // Amsterdam offsets are whole hours; round away ms-truncation noise
  } catch (e) { return 2; }
}

// Rebuild all cron triggers to preserve Amsterdam firing instants at the current offset.
async function syncSchedules(env, force) {
  const off = amsOffset(new Date());
  const stored = await stateGet(env, "cron_offset", String(off));
  const crons = buildCrons(off);
  const signature = crons.map((c) => c.job + "=" + c.cron).sort().join("|");
  const storedSignature = await stateGet(env, "cron_signature", "");
  if (!force && String(off) === String(stored) && signature === String(storedSignature)) return { changed: false, offset: off };
  const r = await cfApi(env, "/workers/scripts/" + WORKER_NAME + "/schedules", "PUT", crons.map((c) => ({ cron: c.cron })));
  const ok = r.status === 200 && r.body && r.body.success;
  if (ok) {
    await stateSet(env, "cron_offset", String(off));
    await stateSet(env, "cron_signature", signature);
  }
  return { changed: true, ok, offset: off, crons: crons.map((c) => c.cron), status: r.status };
}

// ================= PART 2: IMAP client + Gmail GTD triage + email triage =================

// ---------- minimal IMAP client over Workers TCP (TLS) ----------
function decodeHeader(s) {
  // RFC 2047 =?charset?B?base64?= / =?charset?Q?quoted?=
  let out = String(s || "");
  out = out.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, enc, data) => {
    try {
      if (/b/i.test(enc)) {
        return decodeURIComponent(escape(atob(data.replace(/\s/g, ""))));
      }
      return decodeURIComponent(data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (mm, hx) => String.fromCharCode(parseInt(hx, 16))));
    } catch (e) { return data; }
  });
  return out.trim();
}

async function imapOpen(env) {
  const host = "imap.gmail.com", port = 993;
  const socket = connect({ hostname: host, port }, { secureTransport: "on", allowHalfOpen: false });
  const watchdog = setTimeout(() => { try { socket.close(); } catch (e) {} }, 90000);
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buf = "";
  let tagSeq = 0;

  async function readLine() {
    while (true) {
      const idx = buf.indexOf("\r\n");
      if (idx >= 0) { const line = buf.slice(0, idx); buf = buf.slice(idx + 2); return line; }
      const { value, done } = await reader.read();
      if (done) return null;
      buf += dec.decode(value, { stream: true });
    }
  }
  async function readLiteral(n) {
    while (buf.length < n) {
      const { value, done } = await reader.read();
      if (done) return null;
      buf += dec.decode(value, { stream: true });
    }
    const lit = buf.slice(0, n);
    buf = buf.slice(n); // do NOT consume the 2 framing bytes; the continuation is part of the stream
    return lit;
  }
  async function cmd(command) {
    const tag = "a" + (++tagSeq);
    await writer.write(enc.encode(tag + " " + command + "\r\n"));
    const lines = [];
    let ok = false;
    while (true) {
      const line = await readLine();
      if (line === null) throw new Error("imap eof during " + command);
      if (line.startsWith(tag + " ")) {
        lines.push(line);
        ok = /^a\d+ OK/i.test(line);
        return { ok, lines };
      }
      lines.push(line);
      const m = line.match(/\{(\d+)\}$/);
      if (m) {
        const lit = await readLiteral(parseInt(m[1], 10));
        if (lit === null) throw new Error("imap literal eof");
        lines.push(lit);
      }
    }
  }
  async function close() {
    try { clearTimeout(watchdog); } catch (e) {}
    try { await writer.write(enc.encode("aZ LOGOUT\r\n")); } catch (e) {}
    try { writer.close(); reader.cancel(); socket.close(); } catch (e) {}
  }
  return { cmd, close };
}

// Classification: faithful port of gmail-gtd-triage.py classify() (QNFO 2026-08).
const BULK_DOMAINS = new Set("github.com gitlab.com bitbucket.org cloudflare.com vercel.com netlify.com twitter.com x.com linkedin.com facebook.com instagram.com youtube.com reddit.com quora.com medium.com substack.com wordpress.com tumblr.com spotify.com netflix.com disneyplus.com hulu.com twitch.tv discord.com telegram.org whatsapp.com tiktok.com pinterest.com snapchat.com booking.com airbnb.com expedia.com tripadvisor.com skyscanner.net ebay.com etsy.com aliexpress.com temu.com shein.com wish.com shopify.com mailchimp.com sendinblue.com brevo.com hubspot.com salesforce.com klaviyo.com constantcontact.com campaignmonitor.com mailerlite.com convertkit.com beehiiv.com adobe.com dropbox.com notion.so slack.com zoom.us godaddy.com namecheap.com wix.com squarespace.com hostinger.com google.com googlemail.com microsoft.com apple.com amazon.com amazonaws.com npmjs.com pypi.org crates.io docker.com stackoverflow.com arxiv.org researchgate.net academia.edu orcid.org paypal.com stripe.com klarna.com afterpay.com revolut.com".split(" "));
const FINANCIAL_DOMAINS = new Set("chase.com bankofamerica.com wellsfargo.com citibank.com citi.com capitalone.com americanexpress.com amex.com discover.com usbank.com ally.com sofi.com chime.com ing.com rabobank.nl abnamro.nl ing.nl bunq.com n26.com wise.com transferwise.com payoneer.com vanguard.com fidelity.com schwab.com etrade.com traderepublic.com degiro.nl ibkr.com interactivebrokers.com".split(" "));
const HUMAN_DOMAINS = new Set("outlook.com hotmail.com live.com msn.com gmail.com yahoo.com ymail.com icloud.com me.com mac.com protonmail.com proton.me zoho.com aol.com gmx.com tutanota.com".split(" "));
const QNFO_DOMAINS = new Set(["qnfo.org", "qwav.org", "qwav.tech", "qnfo.io"]);
const WITHDRAWN_CONTEXTS = { "cwi.nl": ["summer school", "poster", "slides", "practical information"] };

const RX = {
  receipt: /receipt|invoice|statement|payment (received|confirmed)|order confirmation|confirmation of order|your order|shipping confirmation|tracking (number|#)|delivery (update|confirm)|tax (receipt|statement)|transaction (receipt|confirm)|payment method|practical information|bevestiging|bestelling|factuur|betaling|purchase (confirmed|confirmation)/i,
  waiting: /application (received|submitted|is under)|received your (submission|paper)|submission received|your submission|we (received|got) your|ticket[ #]?\d|case[ #]?\d|support (request|ticket)|under review|in review|we'll (get back|follow)|will (get back|follow up)|status update|awaiting|aanvraag/i,
  sysnotice: /profile activat|account activat|welcome to|your (account|profile) is (now )?(active|ready)|getting started/i,
  someday: /invitation|you're invited|save the date|call for (papers|proposals)|cfp|register now|webinar|meetup|event announcement|opportunity|nominations? (open|now)/i,
  action: /^re:|^aw:|^sv:|deadline|action required|response required|please respond|rsvp|decision needed|approval needed|urgent|reminder|herinnering/i,
  code: /verification code|login code|security code|one-time (password|code)|otp|confirm your email|email verification/i,
  newsletter: /newsletter|weekly (digest|roundup)|daily digest|top stories|this week|unsubscribe|nieuwsbrief/i,
  marketing: /sale|discount|promo|offer|limited time|deal of|% off|free shipping|don't miss|act now|final hours|survey|feedback|rate your|tell us about your|share your (opinion|experience|mening)|deel je mening|mening delen|hear about your/i,
  security: /security alert|fraud alert|unusual activity|sign-in (alert|attempt)|new device|password (reset|changed)|2fa|two-factor/i,
  jobalert: /job (alert|opening)|vacature|are hiring|are looking for|great companies/i,
  volunteer: /vrijwilliger|volunteer/i,
};

function domIn(dom, set) { if (!dom) return false; if (set.has(dom)) return true; for (const b of set) if (dom.endsWith("." + b)) return true; return false; }

function classify(sender, subject, ageDays) {
  const dom = (sender || "").trim().toLowerCase().split("@").pop() || "";
  if (domIn(dom, FINANCIAL_DOMAINS)) {
    if (RX.receipt.test(subject)) return "REFERENCE";
    if (RX.security.test(subject)) return "ACTION";
    return "ACTION";
  }
  for (const [base, kws] of Object.entries(WITHDRAWN_CONTEXTS)) {
    if (dom === base || dom.endsWith("." + base)) {
      const sl = (subject || "").toLowerCase();
      if (kws.some((k) => sl.includes(k))) return "NOISE";
    }
  }
  if (domIn(dom, QNFO_DOMAINS)) return "NOISE";
  if (domIn(dom, HUMAN_DOMAINS)) {
    if (RX.receipt.test(subject)) return "REFERENCE";
    if (RX.waiting.test(subject)) return "WAITING";
    if (RX.newsletter.test(subject)) return "SOMEDAY";
    return "ACTION";
  }
  if (domIn(dom, BULK_DOMAINS)) {
    if (RX.security.test(subject)) return (domIn(dom, new Set(["cloudflare.com", "microsoft.com", "google.com"]))) ? "ACTION" : "WAITING";
    if (RX.receipt.test(subject)) return "REFERENCE";
    if (RX.waiting.test(subject)) return "WAITING";
    if (RX.sysnotice.test(subject)) return "NOISE";
    if (RX.action.test(subject)) return "ACTION";
    if (RX.someday.test(subject)) return "SOMEDAY";
    if (RX.code.test(subject)) return (ageDays < 1) ? "REFERENCE" : "NOISE";
    if (RX.newsletter.test(subject) || RX.marketing.test(subject)) return "NOISE";
    return "NOISE";
  }
  if (RX.receipt.test(subject)) return "REFERENCE";
  if (RX.waiting.test(subject)) return "WAITING";
  if (RX.volunteer.test(subject)) return "REFERENCE";
  if (RX.jobalert.test(subject)) return "NOISE";
  if (RX.sysnotice.test(subject)) return "NOISE";
  if (RX.someday.test(subject)) return "SOMEDAY";
  if (RX.newsletter.test(subject)) return "SOMEDAY";
  if (RX.marketing.test(subject)) return "NOISE";
  if (RX.action.test(subject)) return "ACTION";
  if ((sender || "").toLowerCase().startsWith("noreply") || (sender || "").toLowerCase().startsWith("no-reply")) return "NOISE";
  return "ACTION";
}

const F_WAITING = "GTD-Waiting For", F_SOMEDAY = "GTD-Someday Maybe", F_REF = "GTD-Reference";

async function jobGmailTriage(env) {
  if (!env.GMAIL_PASS) return { status: "error", notes: { error: "GMAIL_PASS secret missing" } };
  const out = { checked: 0, counts: { ACTION: 0, WAITING: 0, SOMEDAY: 0, REFERENCE: 0, NOISE: 0 }, moved: 0, actions: [], waiting: [] };
  let imap;
  try {
    imap = await imapOpen(env);
    const login = await imap.cmd('LOGIN "rwnquni@gmail.com" "' + env.GMAIL_PASS.replace(/"/g, "") + '"');
    if (!login.ok) throw new Error("gmail login failed");
    const sel = await imap.cmd('SELECT "INBOX"');
    if (!sel.ok) throw new Error("gmail SELECT INBOX failed");
    const search = await imap.cmd("UID SEARCH ALL");
    const searchLine = search.lines.find((l) => l.startsWith("* SEARCH"));
    const uids = searchLine ? searchLine.replace("* SEARCH", "").trim().split(/\s+/).filter(Boolean).slice(0, 1000) : [];
    out.checked = uids.length;
    // create labels (idempotent; NO on exists is fine)
    for (const l of [F_WAITING, F_SOMEDAY, F_REF]) { try { await imap.cmd('CREATE "' + l + '"'); } catch (e) {} }
    const now = Date.now();
    const plan = [];
    for (let i = 0; i < uids.length; i += 25) {
      const batch = uids.slice(i, i + 25);
      const fet = await imap.cmd("UID FETCH " + batch.join(",") + " (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])");
      // parse: attribute lines "* N FETCH (UID u ..." followed by literal header bytes
      let cur = null;
      for (const ln of fet.lines) {
        const mm = ln.match(/^\* \d+ FETCH \(UID (\d+) /);
        if (mm) { cur = mm[1]; continue; }
        if (ln.startsWith("* ") && / FETCH /.test(ln)) { continue; }
        if (cur !== null) {
          const hdr = ln;
          const fromM = hdr.match(/^From:\s*(.+)$/mi);
          const subjM = hdr.match(/^Subject:\s*(.+)$/mi);
          const dateM = hdr.match(/^Date:\s*(.+)$/mi);
          const sender = (fromM ? fromM[1] : "").replace(/<[^>]*>/g, "").trim() || ((fromM && fromM[1].match(/<([^>]+)>/) || [])[1] || "");
          const subject = decodeHeader(subjM ? subjM[1] : "");
          let ageDays = 0;
          if (dateM) { const d = new Date(dateM[1]); if (!isNaN(d)) ageDays = Math.floor((now - d.getTime()) / 86400000); }
          const cls = classify(sender, subject, ageDays);
          out.counts[cls] = (out.counts[cls] || 0) + 1;
          const rec = { uid: cur, cls, sender: sender.slice(0, 60), subject: subject.slice(0, 90) };
          if (cls === "ACTION") out.actions.push(rec);
          if (cls === "WAITING") out.waiting.push(rec);
          plan.push(rec);
          cur = null;
        }
      }
    }
    // ---- v1.5.1: grouped batched moves + deadline-aware checkpoint (red-team CONCERN B).
    // Before: ~2 commands per message (~400+ vs 90s watchdog), hard cap 200, no resume.
    // Now: one UID STORE/COPY per 25-UID batch; loop stops at 80s; remaining UIDs stay
    // in INBOX so the next run resumes naturally (moved messages leave INBOX anyway).
    const startMs = Date.now();
    const groups = { ACTION: [], WAITING: [], SOMEDAY: [], REFERENCE: [], NOISE: [] };
    for (const p of plan) {
      if (groups[p.cls] === undefined) groups[p.cls] = [];
      groups[p.cls].push(p.uid);
    }
    const deadlineHit = () => (Date.now() - startMs > 80000);
    const applyBatch = async (uids2, label) => {
      let timedOut = false;
      for (let i = 0; i < uids2.length; i += 25) {
        if (deadlineHit()) { timedOut = true; out.partial = true; break; }
        const part = uids2.slice(i, i + 25).join(",");
        try {
          if (label) { try { await imap.cmd('UID COPY ' + part + ' "' + label + '"'); } catch (e) {} }
          await imap.cmd("UID STORE " + part + " +FLAGS (\\Deleted)");
          out.moved += Math.min(25, uids2.length - i);
        } catch (e) { /* per-batch failures tolerated */ }
      }
      return timedOut;
    };
    // ACTION: flag + unread, stay in INBOX (batched, no \Deleted)
    for (let i = 0; i < groups.ACTION.length; i += 25) {
      if (deadlineHit()) { out.partial = true; break; }
      const part = groups.ACTION.slice(i, i + 25).join(",");
      try { await imap.cmd("UID STORE " + part + " +FLAGS (\\Flagged)"); } catch (e) {}
      try { await imap.cmd("UID STORE " + part + " -FLAGS (\\Seen)"); } catch (e) {}
    }
    let timedOut = await applyBatch(groups.WAITING, F_WAITING);
    if (!timedOut) timedOut = await applyBatch(groups.SOMEDAY, F_SOMEDAY);
    if (!timedOut) timedOut = await applyBatch(groups.REFERENCE, F_REF);
    if (!timedOut) timedOut = await applyBatch(groups.NOISE, null); // \Deleted only -> Trash (recoverable)
    if (out.moved > 0) { try { await imap.cmd("EXPUNGE"); } catch (e) {} }
    await imap.close();
  } catch (e) {
    if (imap) { try { await imap.close(); } catch (e2) {} }
    return { status: "error", notes: { error: String(e && e.message || e), ...out } };
  }
  // persist state for PDB + Friday review (incl. partial flag for resume observability)
  await stateSet(env, "gmail_triage_state", JSON.stringify({ ts: new Date().toISOString(), counts: out.counts, moved: out.moved, partial: !!out.partial, actions: out.actions.slice(0, 20), waiting: out.waiting.slice(0, 20) }));
  const L = ["QNFO Gmail GTD triage \u2014 " + new Date().toISOString().slice(0, 10), ""];
  L.push("INBOX " + out.checked + " msgs: " + JSON.stringify(out.counts) + " moved=" + out.moved + ".");
  if (out.actions.length) { L.push("", "ACTION (stay in INBOX):"); for (const a of out.actions.slice(0, 10)) L.push("- " + a.sender + " | " + a.subject); }
  if (out.waiting.length) { L.push("", "WAITING:"); for (const w of out.waiting.slice(0, 5)) L.push("- " + w.sender + " | " + w.subject); }
  if (!out.actions.length && !out.waiting.length) L.push("", "No actionable inbox mail.");
  const d = await storeDigest(env, "gmail-triage", "QNFO Gmail GTD triage \u2014 " + new Date().toISOString().slice(0, 10), L.join(NL));
  return { status: "ok", notes: { ...out, digest: d } };
}

async function jobEmailTriage(env) {
  const recent = await cfEmail(env, "/emails/recent?limit=30&status=processed");
  if (recent.error) return { status: "error", notes: { error: recent.error } };
  const emails = recent.emails || [];
  const action = [], noise = [];
  const SPAM_SENDERS = ["glintopenaccess", "paperworkspot", "mdpi", "webofproceedings"];
  const SYS_PAT = /dmarc|srs0|bounce|cf-bounce|noreply|no-reply|mailer-daemon|rspamd/i;
  for (const e of emails) {
    const s = String(e.sender || "");
    const subj = String(e.subject || "");
    if (SPAM_SENDERS.some((x) => s.includes(x))) { noise.push(e); continue; }
    if (SYS_PAT.test(s)) { noise.push(e); continue; }
    if (/^srs/i.test(s)) { noise.push(e); continue; }
    action.push(e);
  }
  for (const e of noise) {
    try { await cfEmail(env, "/emails/status", { method: "PATCH", body: { id: e.id, status: "spam" } }); } catch (err) {}
  }
  // ---- outreach reply detection (v1.3.1): an inbound email from a contacted address
  // marks that outreach_log row 'replied' so follow-ups skip it. Deterministic, idempotent.
  try {
    const contacted = await env.AUDIT.prepare("SELECT DISTINCT lower(email) AS em FROM outreach_log WHERE status IN ('sent','followup')").all();
    const set = new Set((contacted.results || []).map((r) => r.em).filter(Boolean));
    if (set.size) {
      const inbound = await env.AUDIT.prepare("SELECT id, sender FROM emails WHERE status IN ('processed','read') AND received_at > datetime('now','-30 days')").all();
      for (const row of inbound.results || []) {
        const s = String(row.sender || "").toLowerCase();
        const m = s.match(/<([^>]+)>/);
        const addr = m ? m[1] : s.trim();
        if (addr && set.has(addr)) {
          await env.AUDIT.prepare("UPDATE outreach_log SET status='replied' WHERE lower(email)=?1 AND status IN ('sent','followup')").bind(addr).run();
        }
      }
    }
  } catch (e) {}
  const L = ["QNFO email triage \u2014 " + new Date().toISOString().slice(0, 10), ""];
  L.push("Checked " + emails.length + " processed emails: " + action.length + " actionable, " + noise.length + " noise (marked spam).");
  if (action.length) {
    L.push("", "ACTIONABLE:");
    for (const e of action.slice(0, 12)) {
      L.push("- id " + e.id + " | " + (e.recipient || "") + " <- " + e.sender + " | " + String(e.subject || "").slice(0, 90));
    }
  } else {
    L.push("", "No actionable inbound email.");
  }
  const d = await storeDigest(env, "email-triage", "QNFO email triage \u2014 " + new Date().toISOString().slice(0, 10), L.join(NL));
  return { status: "ok", notes: { checked: emails.length, actionable: action.length, noise: noise.length, digest: d } };
}

// ================= PART 3: research-scan (AI GTD extract) + briefing + release-check + weekly =================

const REGISTER_R2_KEY = "obsidian/notes/v1/_personal-gtd.md";
const CLOUD_APPEND_R2_KEY = "obsidian/notes/v1/_gtd-cloud-append.md";
const AI_MODEL = "dynamic/value";

async function r2GetText(env, key) {
  try {
    const obj = await env.VAULT.get(key);
    if (!obj) return null;
    return await obj.text();
  } catch (e) { return null; }
}
async function r2PutText(env, key, text) {
  try { await env.VAULT.put(key, text); return true; } catch (e) { return false; }
}

// ---------- research scan: arXiv query -> archive D1 -> AI GTD extraction -> D1 register + R2 append ----------
async function jobResearchScan(env) {
  const q = encodeURIComponent('(all:"ultrametric" OR all:"p-adic" OR all:"Bruhat-Tits" OR all:"quantum energy" OR all:"joules per solution" OR all:"quantum error correction" OR all:"ZBW" OR all:"quantum thermodynamics") AND (cat:quant-ph OR cat:math-ph OR cat:hep-th OR cat:cs.ET)');
  let hits = [];
  try {
    const r = await fetch("https://export.arxiv.org/api/query?search_query=" + q + "&start=0&max_results=10&sortBy=submittedDate&sortOrder=descending", {
      headers: { "User-Agent": "Mozilla/5.0 (QNFO cloud ops)" }
    });
    const txt = await r.text();
    const entries = txt.split("<entry>").slice(1);
    for (const en of entries) {
      const t = (en.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
      const id = (en.match(/<id>[\s\S]*?arxiv\.org\/abs\/([^<]+)<\/id>/) || [])[1] || "";
      const pub = (en.match(/<published>([^<]+)<\/published>/) || [])[1] || "";
      const authors = [];
      const am = en.match(/<name>([\s\S]*?)<\/name>/g) || [];
      for (const a of am) authors.push(a.replace(/<\/?name>/g, "").trim());
      if (t) hits.push({ id: id.trim(), title: t.replace(/\s+/g, " ").trim().slice(0, 200), published: pub.slice(0, 10), authors: authors.slice(0, 6) });
    }
  } catch (e) {
    hits = [{ error: e.message }];
  }

  // archive to D1 (machine-only)
  try {
    await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS research_scan_log (id TEXT PRIMARY KEY, ts TEXT, job TEXT, payload TEXT)").run();
    await env.AUDIT.prepare("INSERT INTO research_scan_log (id, ts, job, payload) VALUES (?1,?2,?3,?4)").bind("scan-" + Date.now().toString(36), new Date().toISOString(), "research-scan", JSON.stringify(hits).slice(0, 3000)).run();
  } catch (e) {}

  // AI GTD extraction: papers are never shown to the user; only actionable items surface
  let extracted = { gtd_lines: [], outreach: [], must_read: [] };
  const real = hits.filter((h) => !h.error);
  if (real.length && env.AI) {
    try {
      const prompt = "Today's arXiv matches for QNFO research (id | title | authors):\n" +
        real.map((h) => "- " + h.id + " | " + h.title + " | " + h.authors.join(", ")).join("\n") +
        "\n\nYou are the QNFO research GTD extractor. Papers are NEVER shown to the user. Extract ONLY genuinely actionable items: (1) outreach candidates — a paper whose corresponding author should receive a QNFO outreach email about the energy-efficiency benchmark / ultrametric physics (only when the overlap is strong); (2) must-reads — papers directly relevant to JPCUB/joules-per-solution or ultrametric physics that Rowan should read; (3) dated register lines — anything with a deadline or action date.\nReply with STRICT JSON only: {\"gtd_lines\":[{\"date\":\"YYYY-MM-DD\",\"text\":\"one short action line\"}],\"outreach\":[{\"paper_id\":\"\",\"reason\":\"one line\"}],\"must_read\":[{\"paper_id\":\"\",\"reason\":\"one line\"}]}. Empty arrays are fine. No prose.";
      const resp = await env.AI.run(AI_MODEL, { messages: [{ role: "user", content: prompt }], max_tokens: 700 }, { gateway: { id: "default" } });
      const content = (resp && (resp.response || (resp.result && resp.result.response))) || "";
      const m = content.match(/\{[\s\S]*\}/);
      if (m) {
        const p = JSON.parse(m[0]);
        if (p && Array.isArray(p.gtd_lines)) extracted = p;
      }
    } catch (e) {
      extracted = { gtd_lines: [], outreach: [], must_read: [], error: String(e && e.message || e) };
    }
  }

  // persist: D1 gtd_register + outreach_queue; R2 cloud-append file
  const addedLines = [];
  for (const gl of (extracted.gtd_lines || []).slice(0, 5)) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(gl.date || "") ? gl.date : new Date().toISOString().slice(0, 10);
    const text = String(gl.text || "").slice(0, 300);
    if (!text) continue;
    try {
      await env.AUDIT.prepare("INSERT INTO gtd_register (section, line, done, line_date, source, updated_at) VALUES (?1,?2,0,?3,?4, datetime('now'))").bind("NEXT STEPS", text, date, "research-scan").run();
      addedLines.push({ date, text });
      await recordEvent(env, "gtd-line", "gtd-" + date + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), date + " \u2014 " + text, { job: "research-scan" });
    } catch (e) {}
  }
  for (const oc of (extracted.outreach || []).slice(0, 4)) {
    try {
      await env.AUDIT.prepare("INSERT INTO outreach_queue (id, paper_id, author, email, reason, status, created_at) VALUES (?1,?2,?3,NULL,?4,'pending', datetime('now'))").bind("oq-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), String(oc.paper_id || "").slice(0, 40), "", String(oc.reason || "").slice(0, 300)).run();
      await recordEvent(env, "outreach", "oq-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), String(oc.paper_id || "") + " \u2014 " + String(oc.reason || "").slice(0, 300), { job: "research-scan" });
    } catch (e) {}
  }
  for (const mr of (extracted.must_read || []).slice(0, 3)) {
    try {
      await env.AUDIT.prepare("INSERT INTO gtd_register (section, line, done, line_date, source, updated_at) VALUES (?1,?2,0,?3,?4, datetime('now'))").bind("NEXT STEPS", "Read " + String(mr.paper_id || "").slice(0, 40) + " \u2014 " + String(mr.reason || "").slice(0, 200), new Date().toISOString().slice(0, 10), "research-scan").run();
    } catch (e) {}
  }
  if (addedLines.length) {
    const block = "\n<!-- cloud-scan " + new Date().toISOString() + " -->\n" + addedLines.map((l) => "- [ ] " + l.date + " \u2014 " + l.text + " (via research scan)").join("\n") + "\n";
    const existing = (await r2GetText(env, CLOUD_APPEND_R2_KEY)) || "";
    await r2PutText(env, CLOUD_APPEND_R2_KEY, (existing + block).slice(-20000));
  }

  // digest: counts only (papers never listed)
  const L = ["QNFO research scan \u2014 " + new Date().toISOString().slice(0, 10), ""];
  L.push("arXiv matches: " + real.length + " (archived to D1).");
  L.push("GTD actions extracted: " + addedLines.length + " register lines, " + (extracted.outreach || []).length + " outreach candidates, " + (extracted.must_read || []).length + " must-reads.");
  if (extracted.error) L.push("AI extraction: " + extracted.error);
  if (!addedLines.length && !(extracted.outreach || []).length && !(extracted.must_read || []).length) L.push("No actionable items today.");
  const d = await storeDigest(env, "research-scan", "QNFO research scan \u2014 " + new Date().toISOString().slice(0, 10), L.join(NL));
  return { status: "ok", notes: { hits: real.length, added_lines: addedLines.length, outreach: (extracted.outreach || []).length, must_read: (extracted.must_read || []).length, digest: d } };
}

// ---------- briefing (President's Daily Briefing, cloud) ----------
async function jobBriefing(env) {
  const L = ["QNFO briefing \u2014 " + new Date().toISOString().slice(0, 10), ""];
  let items = 0;

  // 1. GTD register open next-actions (local mirror + cloud canonical)
  try {
    const regText = await r2GetText(env, REGISTER_R2_KEY);
    if (regText) {
      const now = new Date();
      const due = [];
      const re = /^- \[ \] (\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2})?.*? — (.+)$/gm;
      let m;
      while ((m = re.exec(regText)) !== null) {
        const d = new Date(m[1] + "T00:00:00Z");
        const days = Math.floor((d.getTime() - now.getTime()) / 86400000);
        if (days <= 14) due.push({ date: m[1], days, text: m[2].slice(0, 110) });
      }
      due.sort((a, b) => (a.date < b.date ? -1 : 1));
      if (due.length) {
        items += due.length;
        L.push("Open next-actions due <=14d (" + due.length + "):");
        for (const x of due.slice(0, 12)) L.push("- " + x.date + (x.days < 0 ? " (overdue)" : " (in " + x.days + "d)") + " \u2014 " + x.text);
      }
    }
  } catch (e) { L.push("register read error: " + e.message); }

  // 2. cloud-added register lines (D1)
  try {
    const rows = await env.AUDIT.prepare("SELECT line, line_date FROM gtd_register WHERE done=0 ORDER BY line_date ASC LIMIT 10").all();
    if (rows.results && rows.results.length) {
      const fresh = rows.results.filter((r) => { const d = new Date((r.line_date || "").slice(0, 10) + "T00:00:00Z"); return !isNaN(d); });
      if (fresh.length) {
        items += fresh.length;
        L.push("", "Cloud-registered actions (" + fresh.length + "):");
        for (const r of fresh.slice(0, 8)) L.push("- " + (r.line_date || "").slice(0, 10) + " \u2014 " + String(r.line || "").slice(0, 100));
      }
    }
  } catch (e) {}

  // 3. qnfo.org emails needing attention
  try {
    const rows = await env.AUDIT.prepare("SELECT id, sender, recipient, subject, status FROM emails WHERE status IN ('processed','read') AND received_at > datetime('now','-24 hours') ORDER BY id DESC LIMIT 15").all();
    const real = (rows.results || []).filter((e) => !/dmarc|srs0|bounce|cf-bounce|rspamd/i.test(String(e.sender || "")));
    if (real.length) {
      items += real.length;
      L.push("", "Email needing attention (" + real.length + "):");
      for (const e of real.slice(0, 8)) L.push("- id " + e.id + " | " + e.sender + " | " + String(e.subject || "").slice(0, 80));
    }
  } catch (e) { L.push("email query error: " + e.message); }

  // 4. pending intents
  try {
    const r = await env.AUDIT.prepare("SELECT id, type, summary, due, status FROM intents WHERE status='pending' ORDER BY created_at DESC LIMIT 8").all();
    if (r.results && r.results.length) {
      items += r.results.length;
      L.push("", "Pending intents (" + r.results.length + "):");
      for (const i of r.results) L.push("- [" + i.type + "] " + String(i.summary || "").slice(0, 80) + (i.due ? " (due " + i.due + ")" : ""));
    }
  } catch (e) {}

  // 5. outreach follow-ups awaiting reply >14d
  try {
    const r = await env.AUDIT.prepare("SELECT email, subject, sent_at FROM outreach_log WHERE status='sent' AND sent_at < datetime('now','-14 days') ORDER BY sent_at ASC LIMIT 5").all();
    if (r.results && r.results.length) {
      items += r.results.length;
      L.push("", "Outreach awaiting reply >14d (" + r.results.length + "):");
      for (const o of r.results) L.push("- " + o.email + " | " + String(o.subject || "").slice(0, 60) + " | " + (o.sent_at || "").slice(0, 10));
    }
  } catch (e) {}

  if (!items) L.push("No decision items.");
  const subject = "QNFO briefing \u2014 " + new Date().toISOString().slice(0, 10);
  const text = L.join(NL);
  // SILENCE POLICY: the personal inbox gets the briefing ONLY when there are decision items.
  // A briefing with items requires clear-and-present attention (user directive 2026-08-28),
  // so it overrides DIGEST_TO (alerts@qnfo.org) to the personal inbox; everything else stays archived.
  const d = items > 0 ? (env.DIGEST_TO ? await sendDigest(env, subject, text, env.DIGEST_TO) : await storeDigest(env, "briefing", subject, text)) : await storeDigest(env, "briefing", subject, text);
  return { status: "ok", notes: { items, digest: d } };
}

// ---------- DeepChat release check (user mandate 2026-08-19) ----------
async function jobReleaseCheck(env) {
  // /releases/latest always returns the newest NON-prerelease release
  const r = await ghGet(env, "/repos/ThinkInAIXYZ/deepchat/releases/latest");
  const latest = r.body && r.body.tag_name ? r.body : null;
  const stored = await stateGet(env, "deepchat_stable", "");
  if (!latest) {
    return { status: "error", notes: { error: "github releases fetch failed: " + r.status, body_preview: r.raw } };
  }
  const tag = latest.tag_name;
  const L = [];
  let action = false;
  if (stored !== tag) {
    if (stored) {
      action = true;
      L.push("NEW DeepChat stable release: " + tag + " (installed baseline was " + stored + ").");
      L.push("Action: update DeepChat via the app, then verify DEEPCHAT-RELEASE-TRACK-1 checklist.");
      L.push((latest.body || "").slice(0, 400));
    }
    await stateSet(env, "deepchat_stable", tag);
  }
  if (!action) return { status: "ok", notes: { latest: tag, changed: false } };
  const d = await sendDigest(env, "DeepChat release \u2014 " + tag, L.join(NL));
  return { status: "ok", notes: { latest: tag, changed: true, digest: d } };
}

// ---------- sitemap ping (monthly, 1st 06:00 Amsterdam) ----------
// Folded from local DeepChat one-shot 6eff3cad (qnfo-cloud-migration-2026-09-02 handoff).
// Health-pings the published sitemaps; failures digest, successes stay silent.
const SITEMAP_URLS = [
  "https://rwnq8.github.io/sitemap.xml",
  "https://qnfo-landing.pages.dev/sitemap.xml",
];
async function jobSitemapPing(env) {
  const out = { ok: 0, fail: 0, urls: [] };
  for (const url of SITEMAP_URLS) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "qnfo-cloud-ops/" + VERSION }, cf: { cacheTtl: 0 } });
      if (r.status === 200) {
        out.ok++;
        await recordEvent(env, "sitemap-ping", "sp-" + url.replace(/[^a-z0-9]+/gi, "-").slice(0, 60) + "-" + Date.now().toString(36), "sitemap OK " + url, { job: "sitemap-ping", status: "ok", url });
      } else {
        out.fail++;
        out.urls.push(url + " -> " + r.status);
        await recordEvent(env, "sitemap-ping", "sp-" + url.replace(/[^a-z0-9]+/gi, "-").slice(0, 60) + "-" + Date.now().toString(36), "sitemap FAIL " + url + " status " + r.status, { job: "sitemap-ping", status: "error", url });
      }
    } catch (e) {
      out.fail++;
      out.urls.push(url + " -> " + String(e && e.message || e));
      await recordEvent(env, "sitemap-ping", "sp-" + url.replace(/[^a-z0-9]+/gi, "-").slice(0, 60) + "-" + Date.now().toString(36), "sitemap ERROR " + url + ": " + String(e && e.message || e), { job: "sitemap-ping", status: "error", url });
    }
  }
  if (out.fail > 0) await sendDigest(env, "Sitemap ping failures — " + new Date().toISOString().slice(0, 10), out.urls.join(NL));
  return { status: "ok", notes: out };
}

// ---------- loose threads sweep (weekly Monday 07:00 Amsterdam) ----------
// Cloud-native standing sweep for unfinished WBS states / handoffs / tasks (user directive
// 2026-09-02: periodic sweep to find loose threads). Digests decision items; silent when clean.
// Resolution happens in the ops cycle that receives the digest (disposition markers in
// phase_data.disposition_<date>, newer handoff rows, or task status updates).
async function jobLooseThreadsSweep(env) {
  const GRACE_DAYS = 7;
  const out = { wbs_mid: 0, handoffs_open: 0, tasks_open: 0, items: [] };
  try {
    const wbs = await env.AUDIT.prepare(
      "SELECT project_id, current_phase, total_phases, last_updated FROM wbs_state " +
      "WHERE current_phase GLOB '[0-9]*' AND total_phases GLOB '[0-9]*' " +
      "AND CAST(current_phase AS INTEGER) < CAST(total_phases AS INTEGER) " +
      "AND (phase_data NOT LIKE '%disposition_%' OR phase_data = '{}') " +
      "AND last_updated < datetime('now', '-7 days') " +
      "ORDER BY last_updated ASC LIMIT 40"
    ).all();
    for (const r of wbs.results || []) {
      out.wbs_mid++;
      out.items.push("WBS " + r.project_id + " phase " + r.current_phase + "/" + r.total_phases + " (updated " + String(r.last_updated).slice(0, 19) + ")");
    }
  } catch (e) { out.items.push("wbs query error: " + String(e && e.message || e)); }
  try {
    const h = await env.AUDIT.prepare(
      "SELECT h.project_id, h.pending_work, h.timestamp FROM handoffs h " +
      "WHERE h.timestamp = (SELECT MAX(h2.timestamp) FROM handoffs h2 WHERE h2.project_id = h.project_id) " +
      "AND h.pending_work IS NOT NULL AND TRIM(h.pending_work) != '' " +
      "AND LOWER(TRIM(h.pending_work)) NOT LIKE 'none%' " +
      "AND LOWER(TRIM(h.pending_work)) NOT LIKE 'zero deferred%' " +
      "AND LOWER(TRIM(h.pending_work)) NOT LIKE '0 deferred%' " +
      "AND h.timestamp < datetime('now', '-7 days') " +
      "ORDER BY h.timestamp ASC LIMIT 40"
    ).all();
    for (const r of h.results || []) {
      out.handoffs_open++;
      out.items.push("HANDOFF " + r.project_id + " (" + String(r.timestamp).slice(0, 19) + "): " + String(r.pending_work).slice(0, 90));
    }
  } catch (e) { out.items.push("handoffs query error: " + String(e && e.message || e)); }
  try {
    const t = await env.AUDIT.prepare(
      "SELECT task_code, status, updated_at FROM tasks_wbs " +
      "WHERE status IN ('pending','in_progress','blocked') " +
      "AND updated_at < datetime('now', '-7 days') " +
      "ORDER BY updated_at ASC LIMIT 40"
    ).all();
    for (const r of t.results || []) {
      out.tasks_open++;
      out.items.push("TASK " + r.task_code + " [" + r.status + "] (updated " + String(r.updated_at).slice(0, 19) + ")");
    }
  } catch (e) { out.items.push("tasks query error: " + String(e && e.message || e)); }
  const total = out.wbs_mid + out.handoffs_open + out.tasks_open;
  await recordEvent(env, "job-run", "jr-loose-threads-" + Date.now().toString(36), "loose-threads-sweep: " + total + " items (wbs " + out.wbs_mid + ", handoffs " + out.handoffs_open + ", tasks " + out.tasks_open + ")", { job: "loose-threads-sweep", status: total ? "attention" : "ok" });
  if (!total) return { status: "ok", notes: { total: 0, silent: true } };
  const L = [
    "Loose threads sweep \u2014 " + new Date().toISOString().slice(0, 10),
    "",
    "WBS mid-phase: " + out.wbs_mid + " | open handoffs: " + out.handoffs_open + " | open tasks: " + out.tasks_open,
    "",
  ].concat(out.items.slice(0, 25));
  if (out.items.length > 25) L.push("... truncated (" + out.items.length + " total items; resolve oldest first).");
  L.push("", "Resolution: disposition each item (complete / convert-to-schedule / delete-with-rationale) in the next ops cycle.");
  const d = await sendDigest(env, "Loose threads \u2014 " + total + " item(s) need disposition", L.join(NL));
  return { status: "ok", notes: { total, wbs_mid: out.wbs_mid, handoffs_open: out.handoffs_open, tasks_open: out.tasks_open, digest: d } };
}

// ---------- weekly (Friday 17:00 Amsterdam) ----------
async function jobWeekly(env) {
  const L = ["QNFO weekly summary \u2014 " + new Date().toISOString().slice(0, 10), ""];
  try {
    const e = await env.AUDIT.prepare("SELECT COUNT(*) AS n FROM emails WHERE received_at > datetime('now','-7 days')").first();
    L.push("Emails (7d): " + (e && e.n || 0));
  } catch (err) {}
  try {
    const q = await env.AUDIT.prepare("SELECT COUNT(*) AS n FROM ai_queries WHERE ts > datetime('now','-7 days')").first();
    L.push("AI queries (7d): " + (q && q.n || 0));
  } catch (err) {}
  try {
    const i = await env.AUDIT.prepare("SELECT COUNT(*) AS n FROM intents WHERE created_at > datetime('now','-7 days')").first();
    L.push("Intents (7d): " + (i && i.n || 0));
  } catch (err) {}
  try {
    const g = await env.AUDIT.prepare("SELECT COUNT(*) AS n FROM gtd_register WHERE done=0").first();
    L.push("Open GTD register items (cloud): " + (g && g.n || 0));
  } catch (err) {}
  try {
    if (env.QNFO_INFRA) {
      const r = await env.QNFO_INFRA.fetch("https://qnfo-infra.internal/records", { headers: { Authorization: "Bearer " + env.INFRA_TOKEN } });
      const j = await r.json();
      if (j && j.papers != null) L.push("Records: papers " + j.papers + ", KG " + (j.kg && j.kg.nodes || "?") + " nodes");
    }
  } catch (err) {}
  // ---- P9.1 weekly review (v1.5.0): vault delta + register sweep + portfolio triage.
  // Cloud-able surface of local cronjob 382376cd (full LLM fold-in + ignorance audit = v2).
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const review = { vault_delta: [], register_open: 0, triage: { closeout: [], stale: [], skip: [] }, published: null };
  // 1. vault delta: R2 mirror (d-drive obsidian/) notes newer than 7 days ago
  try {
    const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const prefix = "obsidian/notes/v1/" + since.slice(0, 4) + "/" + since.slice(5, 7) + "/";
    let cursor;
    let seen = 0;
    do {
      const page = await env.VAULT.list({ prefix, cursor, limit: 1000 });
      for (const o of page.objects || []) {
        if (!o.key.endsWith(".md")) continue;
        const m = o.key.match(/obsidian\/notes\/v1\/(\d{4})\/(\d{2})\/(\d{2})\/(?:.*\/)?([^/]+\.md)$/);
        if (m) {
          const d = m[1] + "-" + m[2] + "-" + m[3];
          if (d >= since) { review.vault_delta.push({ date: d, note: m[4] }); seen++; }
        }
      }
      cursor = page.truncated ? page.cursor : null;
    } while (cursor && seen < 500);
  } catch (e) { L.push("vault delta error: " + (e && e.message)); }
  // 2. register sweep (open items)
  try {
    const r = await env.AUDIT.prepare("SELECT COUNT(*) AS n FROM gtd_register WHERE done=0").first();
    review.register_open = (r && r.n) || 0;
  } catch (e) {}
  // 3. portfolio triage heuristics (deterministic; SELECT * for column resilience)
  try {
    const rows = await env.PORTFOLIO.prepare("SELECT * FROM program_registry ORDER BY wbs_order").all();
    for (const p of rows.results || []) {
      const ph = String(p.phase || p.current_phase || "").replace(/^P/i, "");
      const st = String(p.status || "");
      const upd = new Date(String(p.updated_at || "").replace(" ", "T") + "Z").getTime();
      const ageDays = isNaN(upd) ? 0 : Math.floor((Date.now() - upd) / 864e5);
      const code = String(p.wbs_code || p.code || "");
      const name = String(p.name || p.title || "").slice(0, 50);
      if (/complete|closed|archiv/i.test(st) || ph === "8" || ph === "9") review.triage.closeout.push((code || "?") + " " + name + " [phase " + ph + "]");
      else if (ageDays > 90 && !/completed/i.test(st)) review.triage.stale.push((code || "?") + " " + name + " [" + ageDays + "d]");
      else review.triage.skip.push((code || "?") + " " + name);
    }
  } catch (e) { L.push("triage error: " + (e && e.message)); }
  // 4. publish review note to R2 (GTD-visible record) + D1 register line + vectorize
  const noteKey = "obsidian/notes/v1/_weekly-review-" + today + ".md";
  const lines = ["# Weekly Review \u2014 " + today, "", "Auto-generated by qnfo-cloud-ops (Workers cron). Vault-delta + register + portfolio triage.", ""];
  lines.push("Vault notes (7d): " + review.vault_delta.length);
  for (const n of review.vault_delta.slice(0, 30)) lines.push("- " + n.date + " " + n.note);
  lines.push("", "Open GTD register items: " + review.register_open);
  lines.push("", "Portfolio triage \u2014 closeout-archive candidates (" + review.triage.closeout.length + "):");
  for (const c of review.triage.closeout.slice(0, 20)) lines.push("- " + c);
  lines.push("", "Stale / review candidates (" + review.triage.stale.length + "):");
  for (const s of review.triage.stale.slice(0, 20)) lines.push("- " + s);
  lines.push("", "Active / current (" + review.triage.skip.length + "):");
  for (const s of review.triage.skip.slice(0, 10)) lines.push("- " + s);
  lines.push("", "Decisions: PDB surfaces actionable items; this note is the GTD-visible record.");
  try { await r2PutText(env, noteKey, lines.join(NL)); review.published = noteKey; } catch (e) { L.push("publish error: " + (e && e.message)); }
  try {
    await env.AUDIT.prepare("INSERT INTO gtd_register (section, line, done, line_date, source, updated_at) VALUES (?1,?2,0,?3,?4, datetime('now'))")
      .bind("WEEKLY REVIEW", "Review weekly-review-" + today + " triage (closeout " + review.triage.closeout.length + ", stale " + review.triage.stale.length + ")", today, "weekly-review").run();
  } catch (e) {}
  await recordEvent(env, "weekly-review", "wr-" + today.replace(/-/g, ""), "Weekly review " + today + ": vault " + review.vault_delta.length + ", register " + review.register_open + ", closeout " + review.triage.closeout.length + ", stale " + review.triage.stale.length, { job: "weekly", date: today });
  await stateSet(env, "weekly_review_last", today);
  L.push("Vault notes (7d): " + review.vault_delta.length + " | closeout candidates: " + review.triage.closeout.length + " | stale: " + review.triage.stale.length);
  const d = await storeDigest(env, "weekly", "QNFO weekly summary \u2014 " + today, L.join(NL));
  return { status: "ok", notes: { digest: d, review: { vault_delta: review.vault_delta.length, register_open: review.register_open, closeout: review.triage.closeout.length, stale: review.triage.stale.length, published: review.published } } };
}

// ================= PART 4: weekly-ops (DST sync) + portfolio-sync + zenodo-stats + board-sync + nlnet =================

async function jobWeeklyOps(env) {
  const L = ["QNFO cloud ops audit \u2014 " + new Date().toISOString().slice(0, 10), ""];
  let cost = 0;

  // DST self-adjust: rebuild cron triggers when the Amsterdam offset changes
  const dst = await syncSchedules(env, false);
  if (dst.changed) {
    L.push("Schedule sync: offset=" + dst.offset + ", schedules " + (dst.ok ? "updated" : "UPDATE FAILED (status " + dst.status + ")"));
  } else {
    L.push("Schedules: " + buildCrons(dst.offset).length + " cron triggers, Amsterdam offset +" + dst.offset + ".");
  }

  try {
    if (env.QNFO_INFRA) {
      const an = await env.QNFO_INFRA.fetch("https://qnfo-infra.internal/analytics", { headers: { Authorization: "Bearer " + env.INFRA_TOKEN } }).then((r) => r.json());
      const st = await env.QNFO_INFRA.fetch("https://qnfo-infra.internal/state", { headers: { Authorization: "Bearer " + env.INFRA_TOKEN } }).then((r) => r.json());
      const rc = await env.QNFO_INFRA.fetch("https://qnfo-infra.internal/records", { headers: { Authorization: "Bearer " + env.INFRA_TOKEN } }).then((r) => r.json());
      if (an && an.ai_30d && !an.ai_30d.error) {
        cost = an.ai_30d.est_cost_usd || 0;
        L.push("Workers AI (30d): " + Math.round(an.ai_30d.neurons) + " neurons, est. $" + cost);
      }
      if (an && an.workers_30d && !an.workers_30d.error) L.push("Worker invocations (30d): " + an.workers_30d.requests);
      if (st && st.workers) L.push("Fleet: workers " + st.workers.count + ", D1 " + st.d1.count + ", R2 " + (st.r2 && st.r2.count || 0) + ", Vectorize " + (st.vectorize && st.vectorize.count || 0));
      if (st && st.gateway_logs && !st.gateway_logs.error) L.push("AI Gateway (last window): $" + st.gateway_logs.cost_usd);
      if (rc && rc.papers != null) L.push("Records: papers " + rc.papers + ", KG " + (rc.kg && rc.kg.nodes || "?") + " nodes");
    }
  } catch (e) {
    L.push("infra query error: " + e.message);
  }
  try {
    const z = await env.AUDIT.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(downloads),0) AS dl, COALESCE(SUM(views),0) AS vw FROM zenodo_stats").first();
    if (z) L.push("Zenodo stats table: " + z.n + " DOIs, " + z.dl + " downloads, " + z.vw + " views (cumulative).");
  } catch (e) {}
  // ---- SEO discoverability health (v1.4.0): status + title + JSON-LD on the public surfaces
  try {
    const seo = [];
    const ua = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" };
    for (const [name, url] of [["papers", "https://papers.qnfo.org/"], ["qnfo", "https://qnfo.org/"], ["qwav", "https://qwav.org/"], ["qwav-tech", "https://qwav.tech/"]]) {
      try {
        const r = await fetch(url, { headers: ua });
        const html = await r.text();
        const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "";
        const ld = html.includes("application/ld+json");
        const ok = r.status === 200 && !!title.trim() && ld;
        seo.push({ name, status: r.status, title: !!title.trim(), jsonld: ld, ok });
      } catch (e) { seo.push({ name, error: String(e && e.message || e), ok: false }); }
    }
    const bad = seo.filter((s) => !s.ok);
    L.push("SEO health: " + seo.map((s) => s.name + "=" + (s.ok ? "OK" : (s.status || "ERR"))).join(", "));
    if (bad.length) {
      L.push("SEO FAIL: " + bad.map((s) => s.name + " (" + (s.status || s.error) + (s.title === false ? " no-title" : "") + (s.jsonld === false ? " no-jsonld" : "") + ")").join("; "));
      await recordEvent(env, "seo-fail", "seo-" + Date.now().toString(36), "SEO health failure: " + JSON.stringify(bad), { job: "weekly-ops" });
    }
  } catch (e) { L.push("SEO check error: " + (e && e.message)); }
  if (cost > 90) L.push("", "\u26A0 COST ALERT: est. 30d Workers AI cost $" + cost + " exceeds $90/30d spend-limit gate (rule 6f5c29f8).");
  const subject = "QNFO cloud ops audit \u2014 " + new Date().toISOString().slice(0, 10);
  const text = L.join(NL);
  const alert = cost > 90 || (dst.changed && !dst.ok);
  // SILENCE POLICY: email only on cost alert or a failed DST schedule rebuild.
  const d = alert ? await sendDigest(env, subject, text) : await storeDigest(env, "weekly-ops", subject, text);
  return { status: "ok", notes: { est_cost_30d: cost, dst: dst.changed, digest: d } };
}

async function jobMonthlyCostReport(env) {
  const now = new Date();
  const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = monthDate.toISOString().slice(0, 7);
  const response = await env.QNFO_INFRA.fetch(
    "https://qnfo-infra.internal/gateway-cost-report?month=" + encodeURIComponent(month),
    { headers: { Authorization: "Bearer " + env.INFRA_TOKEN } }
  );
  const report = await response.json();
  if (!response.ok || report.error) throw new Error("gateway cost report unavailable: " + (report.error || response.status));

  const lines = ["QNFO AI Gateway cost report — " + month, "", "Source: " + report.source];
  for (const gateway of report.gateways || []) {
    lines.push("", gateway.gateway + ": $" + gateway.cost_usd + " across " + gateway.requests + " requests" + (gateway.complete ? "" : " (INCOMPLETE — page limit reached)"));
    if (gateway.missing_cost_requests) lines.push("Requests without valid cost: " + gateway.missing_cost_requests);
    if (gateway.invalid_timestamp_logs) lines.push("Logs without usable timestamps: " + gateway.invalid_timestamp_logs);
    lines.push("Providers (spend / cap):");
    for (const provider of (gateway.by_provider || [])) {
      const cap = provider.cap_usd == null ? "no configured cap" : "$" + provider.cap_usd + " (" + Math.round(provider.cost_usd / provider.cap_usd * 100) + "%; " + provider.cap_status + ")";
      lines.push("- " + provider.provider + ": $" + provider.cost_usd + " / " + cap + " (" + provider.requests + " requests)");
    }
    lines.push("Models:");
    for (const model of (gateway.by_model || [])) lines.push("- " + model.model + ": $" + model.cost_usd + " (" + model.requests + " requests)");
    lines.push("Workers:");
    for (const worker of (gateway.by_worker || [])) lines.push("- " + worker.worker + ": $" + worker.cost_usd + " (" + worker.requests + " requests)");
    lines.push("Provider / model / worker:");
    for (const row of (gateway.by_provider_model_worker || [])) {
      lines.push("- " + row.provider + " / " + row.model + " / " + row.worker + ": $" + row.cost_usd + " (" + row.requests + " requests)");
    }
  }
  if (!report.complete) lines.push("", "WARNING: one or more gateways reached the 5,000-log collection limit; totals are partial.");
  lines.push("", "Cap warnings begin at 80% of the configured monthly cap. Costs are from gateway logs and are not invoice-reconciled.");

  const subject = "QNFO AI Gateway cost report — " + month;
  const text = lines.join(NL);
  const stored = await storeDigest(env, "monthly-cost-report", subject, text);
  const email = await sendDigest(env, subject, text);
  return {
    status: report.complete && email && email.ok ? "ok" : "error",
    notes: {
      month,
      complete: !!report.complete,
      gateways: (report.gateways || []).map((gateway) => ({ gateway: gateway.gateway, requests: gateway.requests, cost_usd: gateway.cost_usd })),
      stored,
      email
    }
  };
}

// ---------- portfolio sync: real PORTFOLIO-STATUS.md regeneration + GitHub PR ----------
async function jobPortfolioSync(env) {
  const out = {};
  try { out.papers = ((await env.LIVING.prepare("SELECT COUNT(*) AS n FROM papers").first()) || {}).n || 0; } catch (e) { out.papers = -1; }
  try { out.published = ((await env.LIVING.prepare("SELECT COUNT(*) AS n FROM papers WHERE status IN ('published','distributed')").first()) || {}).n || 0; } catch (e) {}
  try {
    const r = await env.LIVING.prepare("SELECT COUNT(*) AS n FROM papers WHERE updated_at > datetime('now','-7 days')").first();
    out.recent7 = (r && r.n) || 0;
  } catch (e) {}
  try { out.programs = ((await env.PORTFOLIO.prepare("SELECT COUNT(*) AS n FROM program_registry").first()) || {}).n || 0; } catch (e) { out.programs = -1; }
  try {
    const g = await env.GRAPH.prepare("SELECT COUNT(*) AS n FROM nodes").first();
    const e2 = await env.GRAPH.prepare("SELECT COUNT(*) AS n FROM edges").first();
    out.kgNodes = (g && g.n) || 0; out.kgEdges = (e2 && e2.n) || 0;
  } catch (e) { out.kgNodes = -1; }
  try {
    const r = await ghGet(env, "/search/repositories?q=org:QNFO");
    out.repos = (r.body && r.body.total_count) || 0;
  } catch (e) { out.repos = -1; }
  try { out.zenodoDOIs = ((await env.LIVING.prepare("SELECT COUNT(DISTINCT zenodo_doi) AS n FROM papers WHERE zenodo_doi IS NOT NULL AND zenodo_doi != ''").first()) || {}).n || 0; } catch (e) {}

  const now = new Date().toISOString();
  const md = [
    "# QNFO Portfolio Status",
    "",
    "Auto-generated by qnfo-cloud-ops (Workers cron). Cloud-canonical sources; regenerated weekly.",
    "",
    "> Generated: " + now,
    "",
    "## Records",
    "",
    "- Papers in living-paper: " + out.papers,
    "- Published/distributed (Zenodo DOI): " + out.published,
    "- Updated in last 7 days: " + out.recent7,
    "- Distinct Zenodo DOIs: " + out.zenodoDOIs,
    "",
    "## Knowledge graph",
    "",
    "- Nodes: " + out.kgNodes,
    "- Edges: " + out.kgEdges,
    "",
    "## Programs",
    "",
    "- Registered programs (portfolio-state): " + out.programs,
    "",
    "## Public surface",
    "",
    "- Public GitHub repos (QNFO org): " + out.repos,
    "",
    "## Schedule",
    "",
    "All scheduled tasks run cloud-based via Cloudflare Cron Triggers (qnfo-cloud-ops worker). No local processing.",
    "",
  ].join("\n");

  // R2: fetch current main file + no-drift early return (direct-main update, no branch/PR churn)
  const cur = await ghGet(env, "/repos/QNFO/.github/contents/PORTFOLIO-STATUS.md");
  let curText = "";
  if (cur.status === 200 && cur.body && cur.body.content) {
    try { curText = atob(cur.body.content.replace(/\s/g, "")); } catch (e) { curText = ""; }
  }
  if (curText === md) {
    await storeDigest(env, "portfolio-sync", "QNFO portfolio sync — " + now.slice(0, 10), "No drift — no update (silent).");
    return { status: "ok", notes: { drift: false, ...out, digest: { stored: true } } };
  }
  // direct main update (R2 fix 2026-09-02: branch/PR/merge churn caused 422 file-put; portfolio status is an auto-generated ledger committed by the automation token)
  const sha = (cur.status === 200 && cur.body && cur.body.sha) ? cur.body.sha : undefined;
  const putBody = { message: "Portfolio status " + now.slice(0, 10), content: btoa(md) };
  if (sha) putBody.sha = sha;
  const putR = await ghPut(env, "/repos/QNFO/.github/contents/PORTFOLIO-STATUS.md", putBody);
  if (putR.status !== 200 && putR.status !== 201) return { status: "error", notes: { error: "file put failed " + putR.status + " " + (putR.body && putR.body.message ? putR.body.message : "") + " (R2 direct-main)", ...out } };
  await storeDigest(env, "portfolio-sync", "QNFO portfolio sync — " + now.slice(0, 10), "Drift applied direct-to-main. " + JSON.stringify(out));
  return { status: "ok", notes: { drift: true, directMain: true, ...out } };
}

// ---------- zenodo stats delta ----------
async function jobZenodoStats(env) {
  const corpus = await env.LIVING.prepare("SELECT zenodo_doi, slug FROM papers WHERE zenodo_doi IS NOT NULL AND zenodo_doi != '' AND status IN ('published','distributed')").all();
  const byDoi = {};
  for (const row of corpus.results || []) {
    const d = String(row.zenodo_doi || "").trim();
    if (d && d !== "pending" && !byDoi[d]) byDoi[d] = row;
  }
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const freshRows = await env.AUDIT.prepare("SELECT doi FROM zenodo_stats WHERE fetched_at LIKE ?1 || '%'").bind(today).all();
  const fresh = new Set((freshRows.results || []).map((r) => r.doi));
  const prevRows = await env.AUDIT.prepare("SELECT doi, downloads, views FROM zenodo_stats").all();
  const prevMap = {}; let prevDl = 0, prevVw = 0;
  for (const r of prevRows.results || []) {
    prevMap[r.doi] = r;
    prevDl += Number(r.downloads || 0); prevVw += Number(r.views || 0);
  }
  const todo = Object.keys(byDoi).filter((d) => !fresh.has(d));
  let fetched = 0, errors = 0;
  const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" };
  const movers = [];
  const auditViolations = [];
  for (const doi of todo) {
    const rid = doi.split(".").pop();
    try {
      const r = await fetch("https://zenodo.org/api/records/" + rid, { headers: UA });
      if (!r.ok) { errors++; continue; }
      const d = await r.json();
      const st = d.stats || {};
      const rec = {
        doi: d.doi || doi,
        conceptdoi: d.conceptdoi || null,
        title: String((d.metadata && d.metadata.title) || "").slice(0, 200),
        slug: (byDoi[doi] && byDoi[doi].slug) || null,
        downloads: Number(st.downloads || 0),
        unique_downloads: Number(st.unique_downloads || 0),
        views: Number(st.views || 0),
        unique_views: Number(st.unique_views || 0),
        version_downloads: Number(st.version_downloads || 0),
      };
      const prev = prevMap[doi] || {};
      await env.AUDIT.prepare(
        "INSERT INTO zenodo_stats (doi, conceptdoi, title, slug, downloads, unique_downloads, views, unique_views, version_downloads, prev_downloads, prev_views, fetched_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12, datetime('now')) ON CONFLICT(doi) DO UPDATE SET prev_downloads=zenodo_stats.downloads, prev_views=zenodo_stats.views, downloads=excluded.downloads, unique_downloads=excluded.unique_downloads, views=excluded.views, unique_views=excluded.unique_views, version_downloads=excluded.version_downloads, title=excluded.title, slug=excluded.slug, conceptdoi=excluded.conceptdoi, fetched_at=excluded.fetched_at, updated_at=datetime('now')"
      ).bind(rec.doi, rec.conceptdoi, rec.title, rec.slug, rec.downloads, rec.unique_downloads, rec.views, rec.unique_views, rec.version_downloads, Number(prev.downloads || 0), Number(prev.views || 0), today).run();
      fetched++;
      const growth = rec.downloads - Number(prev.downloads || 0);
      if (growth > 0) movers.push({ doi, title: rec.title, g: growth });
      // ---- ADR-014 attribution audit (v1.4.0): capture creators + related_identifiers,
      // flag creator violations (sole human author = Rowan Brad Quni-Gudzinas; organizational
      // bylines prohibited per ADR-014). obsoleted_ok is informational, not a violation.
      try {
        const creators = ((d.metadata || {}).creators || []).map((c) => String(c.name || "")).filter(Boolean);
        const rels = ((d.metadata || {}).related_identifiers || []).map((r) => String((r.relation_type && (r.relation_type.id || r.relation_type)) || "").toLowerCase() + ":" + String(r.identifier || "")).join(",");
        const creatorOk = creators.length > 0 && creators.some((n) => /Quni-Gudzinas/i.test(n));
        const hasObsoleted = /isobsoletedby|issupersededby/i.test(rels);
        await env.AUDIT.prepare(
          "INSERT INTO zenodo_attribution_audit (doi, creators, related, creator_ok, obsoleted_ok, audited_at) VALUES (?1,?2,?3,?4,?5, datetime('now')) ON CONFLICT(doi) DO UPDATE SET creators=excluded.creators, related=excluded.related, creator_ok=excluded.creator_ok, obsoleted_ok=excluded.obsoleted_ok, audited_at=datetime('now')"
        ).bind(rec.doi, creators.join("; ").slice(0, 500), rels.slice(0, 1500), creatorOk ? 1 : 0, hasObsoleted ? 1 : 0).run();
        if (!creatorOk) auditViolations.push({ doi: rec.doi, why: "creator", creators: creators.join("; ").slice(0, 120) });
      } catch (e) {}
    } catch (e) {
      errors++;
    }
    if (fetched % 40 === 0) await new Promise((res) => setTimeout(res, 200));
  }
  const tot = await env.AUDIT.prepare("SELECT COALESCE(SUM(downloads),0) AS dl, COALESCE(SUM(views),0) AS vw, COUNT(*) AS n FROM zenodo_stats").first();
  movers.sort((a, b) => b.g - a.g);
  const L = ["QNFO Zenodo stats delta \u2014 " + new Date().toISOString().slice(0, 10), ""];
  L.push("Corpus " + Object.keys(byDoi).length + " DOIs; fetched " + fetched + " today, errors " + errors + ".");
  L.push("downloads: " + prevDl + " -> " + (tot.dl || 0) + " (+" + ((tot.dl || 0) - prevDl) + ")");
  L.push("views:     " + prevVw + " -> " + (tot.vw || 0) + " (+" + ((tot.vw || 0) - prevVw) + ")");
  if (movers.length) {
    L.push("", "top movers (downloads):");
    for (const m of movers.slice(0, 8)) L.push("- +" + m.g + "  " + m.title.slice(0, 50) + "  " + m.doi);
  }
  if (auditViolations.length) {
    L.push("", "ADR-014 attribution violations (" + auditViolations.length + "):");
    for (const v of auditViolations.slice(0, 8)) L.push("- " + v.doi + " [" + v.why + "] " + v.creators);
  } else {
    L.push("", "ADR-014 attribution audit: 0 creator violations (sole-author mandate holds).");
  }
  const d = await storeDigest(env, "zenodo-stats", "QNFO Zenodo stats delta \u2014 " + new Date().toISOString().slice(0, 10), L.join(NL));
  return { status: fetched > 0 || errors === 0 ? "ok" : "error", notes: { fetched, errors, corpus: Object.keys(byDoi).length, audit_violations: auditViolations.length, digest: d } };
}

// ---------- GitHub board sync v2 (mutations enabled, paginated) ----------
async function jobBoardSync(env) {
  const out = { programs: 0, projects: 0, boardItems: 0, existing: 0, added: 0, skipped: 0, errors: [] };
  const canonical = [];
  try {
    const prog = await env.PORTFOLIO.prepare("SELECT wbs_code, name, level, status, github_repo, zenodo_doi, phase FROM program_registry WHERE level IN ('program','project') ORDER BY wbs_code").all();
    for (const r of prog.results || []) {
      const c = String(r.wbs_code || "");
      const lvl = String(r.level || "").toLowerCase() === "program" ? "Program" : "Project";
      if (lvl === "Program") out.programs++; else out.projects++;
      canonical.push({ code: c, title: c + " — " + String(r.name || "").slice(0, 120), body: lvl + ". Repo: " + (r.github_repo || "—") + ". DOI: " + (r.zenodo_doi || "—") + ". Phase: " + (r.phase || "—") + ". Status: " + (r.status || "—") + ". Synced from Cloudflare canonical (portfolio-state).", level: lvl, status: (String(r.status || "") === "completed" || String(r.status || "") === "published") ? "Completed" : "Active" });
    }
  } catch (e) { out.errors.push("registry: " + String(e && e.message || e)); }
  const gql = async (query) => {
    const r = await fetch("https://api.github.com/graphql", { method: "POST", headers: { Authorization: "Bearer " + (env.GH_TOKEN || ""), "User-Agent": "qnfo-cloud-ops/" + VERSION, "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
    return r.json().catch(() => null);
  };
  const pageQ = (after) => '{ organization(login: "QNFO") { projectV2(number: 7) { id items(first: 100' + (after ? ', after: "' + after + '"' : '') + ') { totalCount pageInfo { hasNextPage endCursor } nodes { content { ... on DraftIssue { title } } } } fields(first: 30) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }';
  let j = await gql(pageQ(null));
  let pid = null, levelField = null, wbsField = null, stField = null;
  const existing = [];
  let pages = 0;
  while (j && !(j.errors && j.errors.length) && j.data) {
    const p = j.data.organization && j.data.organization.projectV2;
    if (!p) break;
    pid = p.id;
    out.boardItems = (p.items && p.items.totalCount) || out.boardItems;
    for (const n of p.items.nodes || []) if (n.content && n.content.title) existing.push(String(n.content.title));
    if (pages === 0) {
      const byName = {};
      for (const f of p.fields.nodes || []) byName[f.name] = f;
      levelField = byName["Level"] || null;
      wbsField = byName["WBS Program"] || null;
      stField = byName["Program Status"] || null;
    }
    pages++;
    const pg = p.items && p.items.pageInfo;
    if (!pg || !pg.hasNextPage || pages >= 4) break;
    j = await gql(pageQ(pg.endCursor));
  }
  if (j && j.errors && j.errors.length) out.errors.push("board: " + j.errors[0].message);
  const optMap = (f) => { const m = {}; for (const o of (f && f.options) || []) m[o.name] = o.id; return m; };
  const lvlOpts = optMap(levelField), wbsOpts = optMap(wbsField), stOpts = optMap(stField);
  const existingLower = new Set(existing.map((t) => t.toLowerCase()));
  const haveCode = new Set();
  for (const t of existing) { const m = t.match(/^([A-Z0-9.]+)—/); if (m) haveCode.add(m[1].trim()); }
  const esc = (s) => String(s || "").replace(/\\/g, "").replace(/"/g, "'").replace(/\n/g, " ").replace(/\r/g, " ").slice(0, 400);
  let added = 0, skipped = 0;
  for (const it of canonical) {
    if (existingLower.has(it.title.toLowerCase())) { skipped++; continue; }
    if (it.code && haveCode.has(it.code)) { skipped++; continue; }
    if (added >= 20) { out.errors.push("cap: max 20 adds/run"); break; }
    if (!pid) { out.errors.push("no board pid"); break; }
    try {
      const addQ = 'mutation { addProjectV2DraftIssue(input: {projectId: "' + pid + '", title: "' + esc(it.title) + '", body: "' + esc(it.body) + '"}) { projectItem { id } } }';
      const aj = await gql(addQ);
      if (aj && aj.errors && aj.errors.length) { out.errors.push("add " + it.code + ": " + aj.errors[0].message); continue; }
      const itemId = aj && aj.data && aj.data.addProjectV2DraftIssue && aj.data.addProjectV2DraftIssue.projectItem && aj.data.addProjectV2DraftIssue.projectItem.id;
      if (!itemId) { out.errors.push("add " + it.code + ": no item id"); continue; }
      const setField = async (fld, optId) => {
        if (!fld || !optId) return;
        const uq = 'mutation { updateProjectV2ItemFieldValue(input: {projectId: "' + pid + '", itemId: "' + itemId + '", fieldId: "' + fld.id + '", value: {singleSelectOptionId: "' + optId + '"}}) { projectV2Item { id } } }';
        const uj = await gql(uq);
        if (uj && uj.errors && uj.errors.length) out.errors.push("field " + it.code + ": " + uj.errors[0].message);
      };
      await setField(levelField, lvlOpts[it.level]);
      const wbsCode = it.level === "Program" ? it.code.split(".").pop() : (it.code.split(".").slice(0, -1).pop() || "RES");
      await setField(wbsField, wbsOpts[wbsCode] || wbsOpts[it.code.split(".")[0]]);
      await setField(stField, stOpts[it.status]);
      added++;
    } catch (e) { out.errors.push("add " + it.code + ": " + String(e && e.message || e)); }
  }
  out.added = added; out.skipped = skipped; out.existing = existing.length;
  const L = ["QNFO GitHub board sync v2 — " + new Date().toISOString().slice(0, 10), ""];
  L.push("Canonical: " + out.programs + " programs + " + out.projects + " projects (portfolio-state).");
  L.push("Board #7: " + out.boardItems + " existing items; added " + added + ", skipped " + skipped + ".");
  if (out.errors.length) L.push("Errors: " + out.errors.slice(0, 8).join(" | "));
  L.push("Mutation v2 active (idempotent upsert by WBS code; never deletes).");
  const d = await storeDigest(env, "board-sync", "QNFO GitHub board sync — " + new Date().toISOString().slice(0, 10), L.join(NL));
  const fatal = out.errors.some((x) => x.startsWith("registry") || x.startsWith("board:"));
  return { status: fatal ? "error" : "ok", notes: { ...out, digest: d } };
}

// ---------- NLnet NGI Zero submission (Sep 3 11:00 Amsterdam) ----------
async function jobNlnet(env) {
  const L = ["QNFO NLnet NGI Zero submission \u2014 " + new Date().toISOString().slice(0, 10), ""];
  let proposal = null, dossier = null;
  const p = await ghGet(env, "/repos/QNFO/qnfo-workers/contents/funding/NLNET_PROPOSAL.md");
  if (p.status === 200 && p.body && p.body.content) { try { proposal = atob(p.body.content.replace(/\s/g, "")); } catch (e) {} }
  const dd = await ghGet(env, "/repos/QNFO/qnfo-workers/contents/funding/DOSSIER.md");
  if (dd.status === 200 && dd.body && dd.body.content) { try { dossier = atob(dd.body.content.replace(/\s/g, "")); } catch (e) {} }
  L.push("Bundle: proposal " + (proposal ? proposal.length + " chars" : "FETCH FAILED") + ", dossier " + (dossier ? dossier.length + " chars" : "FETCH FAILED") + ".");
  // NLnet uses an interactive form (captcha-gated). Attempt only a plain form POST if one exists; otherwise notify.
  let formResult = "not attempted";
  try {
    const page = await fetch("https://nlnet.nl/propose/", { headers: { "User-Agent": "Mozilla/5.0 (QNFO cloud ops)" } });
    const html = await page.text();
    if (/hcaptcha|recaptcha|cf-turnstile/i.test(html)) {
      formResult = "form captcha-gated \u2014 no autonomous submission path (per OUTREACH-FORM-GATE-1: never circumvent anti-bot controls)";
    } else {
      formResult = "no captcha detected but NLnet submission requires the interactive form; autonomous browser submission deferred";
    }
  } catch (e) { formResult = "page fetch error: " + e.message; }
  L.push("Submission: " + formResult + ".");
  L.push("Next step: user-submitted form at https://nlnet.nl/propose/ with the prepared bundle (deadline Nov 3 2026 12:00 CEST).");
  await storeDigest(env, "nlnet", "QNFO NLnet NGI Zero submission \u2014 " + new Date().toISOString().slice(0, 10), L.join(NL));
  // one-shot: this single email IS an action item (user must submit the form).
  const d = await sendDigest(env, "QNFO NLnet NGI Zero submission \u2014 " + new Date().toISOString().slice(0, 10), L.join(NL));
  return { status: "ok", notes: { formResult, digest: d } };
}

// ---------- backfill: embed existing D1 rows into OPS_VZ (one-off; run via /run?job=backfill) ----------
async function jobBackfill(env) {
  const out = { contacts: 0, gtd: 0, outreach: 0 };
  try {
    const c = await env.AUDIT.prepare("SELECT email, name FROM contact_ledger LIMIT 500").all();
    for (const r of c.results || []) {
      await recordEvent(env, "contact", "ct-" + String(r.email).replace(/[^a-z0-9.@_-]/gi, ""), (r.name || "?") + " <" + r.email + ">", { job: "backfill" });
      out.contacts++;
    }
  } catch (e) { out.contacts = -1; }
  try {
    const g = await env.AUDIT.prepare("SELECT id, line, line_date FROM gtd_register LIMIT 500").all();
    for (const r of g.results || []) {
      await recordEvent(env, "gtd-line", "gtd-bf-" + r.id, (r.line_date || "") + " \u2014 " + r.line, { job: "backfill" });
      out.gtd++;
    }
  } catch (e) { out.gtd = -1; }
  try {
    const o = await env.AUDIT.prepare("SELECT id, paper_id, reason, status FROM outreach_queue LIMIT 200").all();
    for (const r of o.results || []) {
      await recordEvent(env, "outreach", "oq-bf-" + r.id, (r.paper_id || "") + " \u2014 " + (r.reason || "") + " [" + (r.status || "") + "]", { job: "backfill" });
      out.outreach++;
    }
  } catch (e) { out.outreach = -1; }
  await recordEvent(env, "job-run", "jr-backfill-" + Date.now().toString(36), "backfill completed: " + JSON.stringify(out), { job: "backfill", status: "ok" });
  return { status: "ok", notes: out };
}

// ---------- outreach engine v1: queue -> verify (arXiv tarball) -> dedup -> send -> log ----------
const OUTREACH_ACTIVATION_AT = Date.parse("2026-09-15T00:00:00Z");
const EMAIL_VALID = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
function validEmail(em) {
  if (!em || em.length > 254 || !EMAIL_VALID.test(em)) return false;
  if (/^[%@#]|\.\./.test(em)) return false;
  const d = em.split("@")[1] || "";
  if (!d.includes(".")) return false;
  return true;
}

const OUTREACH_FROM = { email: "rowan.quni@qnfo.org", name: "Rowan Brad Quni-Gudzinas" };

async function verifyArxivEmail(env, paperId) {
  const id = String(paperId || "").trim().replace(/^arXiv:/i, "").replace(/v\d+$/, "");
  if (!/^\d{4}\.\d{4,5}$/.test(id)) return null;
  try {
    const r = await fetch("https://export.arxiv.org/e-print/" + id, { headers: { "User-Agent": "Mozilla/5.0 (QNFO cloud ops)" } });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    let text = "";
    try {
      const ds = new DecompressionStream("gzip");
      const stream = new Blob([buf]).stream().pipeThrough(ds);
      const reader = stream.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
        if (text.length > 5000000) break; // arXiv sources can be large; emails live in the .tex (anywhere in the tar)
      }
    } catch (e) { text = new TextDecoder().decode(buf); }
    const m = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
    const junk = /noreply|no-reply|example|\.png|\.jpg|\.gif|arxiv|elsevier|springer|overleaf|latex|biblatex|hyperref/i;
    for (const em of m) if (!junk.test(em) && em.length < 80) return em;
    return null;
  } catch (e) { return null; }
}

async function jobOutreach(env) {
  const out = { pending: 0, sent: 0, followups: 0, skipped_no_email: 0, skipped_dupe: 0, errors: [] };
  if (!env.SEND_EMAIL) return { status: "error", notes: { error: "SEND_EMAIL binding missing" } };
  // OUTREACH-ENGINE-LIVE-1 activation gate (2026-09-03 red-team): legacy drain must NOT send
  // external outreach before ACTIVATION_AT, and must honor the qnfo-outreach kill switch.
  try {
    const kill = await env.OUTREACH.prepare("SELECT value FROM pipeline_state WHERE key = 'external_sends_enabled'").first();
    const canExternal = Date.now() >= OUTREACH_ACTIVATION_AT && kill && kill.value === "1";
    if (!canExternal) return { status: "gated", notes: { sent: 0, reason: "pre-activation or kill switch off (activation 2026-09-15)", kill: !!(kill && kill.value === "1") } };
  } catch (e) { return { status: "gated", notes: { sent: 0, reason: "gate check failed", error: String(e && e.message || e) } }; }
  const today = new Date().toISOString().slice(0, 10);
  const sentKey = "outreach_sent_" + today;
  let sentToday = Number(await stateGet(env, sentKey, "0")) || 0;
  const CAP = 3;
  let rows;
  try {
    rows = await env.AUDIT.prepare("SELECT id, paper_id, author, email, reason FROM outreach_queue WHERE status='pending' ORDER BY created_at ASC LIMIT 10").all();
  } catch (e) { return { status: "error", notes: { error: String(e && e.message || e) } }; }
  const pending = (rows.results || []).filter((r) => r.email || r.paper_id);
  out.pending = pending.length;
  for (const r of pending) {
    if (sentToday >= CAP) { out.errors.push({ id: r.id, error: "daily cap reached" }); break; }
    let email = r.email || null;
    try {
      if (!email) {
        email = await verifyArxivEmail(env, r.paper_id);
        if (!email) { out.skipped_no_email++; continue; }
        await env.AUDIT.prepare("UPDATE outreach_queue SET email=?1 WHERE id=?2").bind(email, r.id).run();
      }
      const dup = await env.AUDIT.prepare("SELECT 1 AS x FROM contact_ledger WHERE email=?1 UNION ALL SELECT 1 AS x FROM outreach_log WHERE email=?1 LIMIT 1").bind(email).first();
      if (dup) { out.skipped_dupe++; continue; }
      if (!validEmail(email)) { out.errors.push({ id: r.id, error: "invalid email " + email }); continue; }
      const subject = "QNFO \u2014 the energy-efficiency benchmark for quantum computing";
      const body = [
        "Hello,",
        "",
        "I am Rowan Brad Quni-Gudzinas, founder of QNFO, a research collective working on an open, reproducible, energy-first standard for quantum computing: the JPCub benchmark \u2014 \u201cwhat does a correct quantum answer cost in energy?\u201d (grounded in Landauer, Margolus\u2013Levitin, and Bremermann limits).",
        "",
        r.paper_id ? "I came across your recent work (arXiv " + r.paper_id + (r.reason ? " \u2014 " + r.reason : "") + ") and it looks directly relevant to this program." : "I came across your recent work and it looks directly relevant to this program.",
        "",
        "Would you be open to a brief exchange on how your results relate to energy accounting for quantum computation? Happy to share our working papers and benchmark definitions.",
        "",
        "Best regards,",
        "Rowan Brad Quni-Gudzinas",
        "QNFO",
      ].join("\n");
      const res = await env.SEND_EMAIL.send({ to: email, from: OUTREACH_FROM, subject, text: body });
      await env.AUDIT.prepare("INSERT INTO outreach_log (email, subject, message_id, sent_at, status) VALUES (?1,?2,?3, datetime('now'), 'sent')").bind(email, subject, (res && res.messageId) || "").run();
      await env.AUDIT.prepare("INSERT INTO contact_ledger (email, name, first_contact, last_contact, contact_count, status) VALUES (?1,?2,?3,?3,1,'outreach') ON CONFLICT(email) DO UPDATE SET last_contact=excluded.last_contact, contact_count=contact_count+1").bind(email, r.author || null, today).run();
      await env.AUDIT.prepare("UPDATE outreach_queue SET status='sent', sent_at=datetime('now') WHERE id=?1").bind(r.id).run();
      await recordEvent(env, "outreach", "oq-sent-" + Date.now().toString(36), "outreach sent to " + email + " re " + (r.paper_id || ""), { job: "outreach", email });
      sentToday++;
      await stateSet(env, sentKey, String(sentToday));
      out.sent++;
    } catch (e) {
      out.errors.push({ id: r.id, error: String(e && e.message || e) });
    }
  }
  // ---- follow-up pass (v1.3.1): one follow-up, 14+ days after a send with no reply,
  // never a second follow-up, shared daily cap.
  if (sentToday < CAP) {
    try {
      const fu = await env.AUDIT.prepare(
        "SELECT email, subject FROM outreach_log WHERE status='sent' AND sent_at < datetime('now','-14 days') " +
        "AND email NOT IN (SELECT email FROM outreach_log WHERE status IN ('replied','followup')) " +
        "ORDER BY sent_at ASC LIMIT 3"
      ).all();
      for (const f of fu.results || []) {
        if (sentToday >= CAP) break;
        try {
          const subject = "Re: " + String(f.subject || "").replace(/^Re:\s*/i, "");
          const body = [
            "Hello,",
            "",
            "Following up on my earlier note about the energy-efficiency benchmark for quantum computing \u2014 I would still welcome a brief exchange if you are open to it.",
            "",
            "Best regards,",
            "Rowan Brad Quni-Gudzinas",
            "QNFO",
          ].join("\n");
          const res = await env.SEND_EMAIL.send({ to: f.email, from: OUTREACH_FROM, subject, text: body });
          await env.AUDIT.prepare("INSERT INTO outreach_log (email, subject, message_id, sent_at, status) VALUES (?1,?2,?3, datetime('now'), 'followup')").bind(f.email, subject, (res && res.messageId) || "").run();
          sentToday++;
          await stateSet(env, sentKey, String(sentToday));
          out.followups++;
        } catch (e) {
          out.errors.push({ id: "fu-" + f.email, error: String(e && e.message || e) });
        }
      }
    } catch (e) {}
  }
  await recordEvent(env, "job-run", "jr-outreach-" + Date.now().toString(36), "outreach run: " + JSON.stringify(out), { job: "outreach", status: out.errors.length ? "partial" : "ok" });
  return { status: out.errors.length ? "error" : "ok", notes: out };
}


// ---------- AI endpoint health (every 30 min) ----------
async function jobWorkerHealth(env) {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
  const endpoints = [
    { worker: "qnfo-ai",        binding: "QNFO_AI", url: "https://qnfo-ai.internal/health",               headers: { "User-Agent": UA } },
    { worker: "personal-api",   binding: "PERSONAL_API", url: "https://personal-api.internal/health",      headers: { "User-Agent": UA } },
    { worker: "qnfo-idea-factory", url: "https://ideas.qnfo.org/health",              headers: { "User-Agent": UA } },
    { worker: "qnfo-ai-chat",   binding: "QNFO_AI", url: "https://qnfo-ai.internal/v1/chat/completions",  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (env.ROUTER_AUTH_KEY || ""), "User-Agent": UA }, body: { model: "deepseek-v4-flash", messages: [{ role: "user", content: "ping" }], max_tokens: 5 } },
    { worker: "personal-api-chat", binding: "PERSONAL_API", url: "https://personal-api.internal/v1/chat/completions", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (env.PL_API_KEY || ""), "User-Agent": UA }, body: { model: "personal-twin-chat", messages: [{ role: "user", content: "ping" }], max_tokens: 5 } }
  ];
  const out = { checks: [], failed: [] };
  const now = new Date().toISOString();
  for (const ep of endpoints) {
    const t0 = Date.now();
    let status = 0, dur = 0, error = "", body = "";
    try {
      const fetcher = ep.binding && env[ep.binding] && env[ep.binding].fetch
        ? (u, o) => env[ep.binding].fetch(u, o)
        : (u, o) => fetch(u, o);
      const resp = await fetcher(ep.url, { method: ep.body ? "POST" : "GET", headers: ep.headers || {}, body: ep.body ? JSON.stringify(ep.body) : undefined, signal: AbortSignal.timeout(45000) });
      status = resp.status;
      dur = Date.now() - t0;
      try { body = (await resp.text()).slice(0, 200); } catch (e) { body = ""; }
      if (status !== 200) { error = "HTTP " + status + " body:" + body.slice(0, 80); }
      else {
        if (ep.body && body.indexOf("error") === 0) { error = body.slice(0, 120); status = 0; }
      }
    } catch (e) {
      dur = Date.now() - t0;
      error = String(e && e.message || e).slice(0, 200);
      status = 0;
    }
    try {
      await env.AUDIT.prepare("INSERT INTO worker_invocations (worker_name, endpoint, status_code, duration_ms, created_at) VALUES (?1,?2,?3,?4,?5)")
        .bind(ep.worker, ep.url, status, dur, now).run();
    } catch (e) {}
    const ok = status === 200 && !error;
    out.checks.push({ worker: ep.worker, status, duration_ms: Math.round(dur), ok });
    if (!ok) out.failed.push({ worker: ep.worker, status, error });
  }
  if (out.failed.length) {
    const L = ["AI endpoint health check FAILED " + now, ""];
    for (const f of out.failed) L.push("- " + f.worker + " -> HTTP " + f.status + " " + (f.error || ""));
    L.push("", "Action: verify endpoint config, worker deploy, provider keys (QNFO-ROUTER/PERSONAL-TWIN apiType must be 'openai').");
    const subject = "QNFO AI endpoint health alert";
    const d = await sendDigest(env, subject, L.join(NL));
    try {
      await env.AUDIT.prepare("INSERT INTO alerts (source, level, message, digested) VALUES ('worker-health', 'error', ?1, 1)")
        .bind(L.join(NL).slice(0, 2000)).run();
    } catch (e) {}
    await recordEvent(env, "job-run", "jr-worker-health-" + Date.now().toString(36), "worker-health FAILED " + JSON.stringify(out.failed), { job: "worker-health", status: "error" });
    return { status: "error", notes: out };
  }
  await recordEvent(env, "job-run", "jr-worker-health-" + Date.now().toString(36), "worker-health ok " + out.checks.length + " endpoints", { job: "worker-health", status: "ok" });
  return { status: "ok", notes: out };
}


// ---------- P7 visibility scorecard (weekly Monday) ----------
// IMPRESSIONS-ZONE-NOT-WORKER-1: real web impressions live in CF GraphQL
// httpRequests1dGroups for the qnfo.org zone (84e9dc1d7fb72629ccdbe3174ed24420);
// worker_invocations are self-health only and are NEVER cited as external traffic.
async function jobVisibility(env) {
  const ZONE = "84e9dc1d7fb72629ccdbe3174ed24420";
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const out = { zone: ZONE, ts: today };
  const UA = { "User-Agent": "qnfo-cloud-ops/" + VERSION, Authorization: "Bearer " + (env.CF_TOKEN || "") };
  // 1) honest zone totals, last 7 days (httpRequests1dGroups)
  try {
    const q = ['query { viewer { zones(filter: {zoneTag: "', ZONE, '"}) { httpRequests1dGroups(limit: 7, filter: {date_geq: "', since, '", date_leq: "', today, '"}) { dimensions { date } sum { requests pageViews } uniq { uniques } } } } }'].join("");
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { ...UA, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
    if (r.ok) {
      const d = await r.json();
      const days = (d.data && d.data.viewer && d.data.viewer.zones && d.data.viewer.zones[0] && d.data.viewer.zones[0].httpRequests1dGroups) || [];
      let req = 0, pv = 0, uniq = 0;
      for (const day of days) { req += (day.sum.requests || 0); pv += (day.sum.pageViews || 0); uniq += (day.uniq.uniques || 0); }
      out.days = days.length; out.requests = req; out.pageviews = pv; out.uniques = uniq;
    } else out.web_error = "HTTP " + r.status;
  } catch (e) { out.web_error = String(e && e.message || e); }
  // 2) zenodo_stats deltas (cumulative table updated daily by zenodo-stats job)
  try {
    const agg = await env.AUDIT.prepare("SELECT COUNT(*) n, COALESCE(SUM(downloads),0) dl, COALESCE(SUM(views),0) vw, COALESCE(SUM(prev_downloads),0) pdl, COALESCE(SUM(prev_views),0) pvw FROM zenodo_stats").first();
    if (agg) { out.dois = agg.n; out.zenodo_downloads = agg.dl; out.zenodo_views = agg.vw; out.dl_delta = agg.dl - agg.pdl; out.vw_delta = agg.vw - agg.pvw; }
    const mov = await env.AUDIT.prepare("SELECT doi, title, downloads, prev_downloads, views, prev_views FROM zenodo_stats WHERE updated_at >= datetime('now','-8 days') ORDER BY (downloads - prev_downloads) DESC LIMIT 10").all();
    out.movers = ((mov.results || []).map(function (r) { return { doi: r.doi, title: String(r.title || "").slice(0, 50), dl_gain: (r.downloads || 0) - (r.prev_downloads || 0), vw_gain: (r.views || 0) - (r.prev_views || 0) }; })).filter(function (m) { return m.dl_gain > 0 || m.vw_gain > 0; });
  } catch (e) { out.zs_error = String(e && e.message || e); }
  // 3) new versions this week (living-paper published rows updated in last 7 days)
  try {
    const wk = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19).replace("T", " ");
    const vs = await env.LIVING.prepare("SELECT title, version, zenodo_doi, updated_at FROM papers WHERE status IN ('published','distributed') AND zenodo_doi IS NOT NULL AND zenodo_doi != '' AND updated_at >= ?1 ORDER BY updated_at DESC LIMIT 12").bind(wk).all();
    out.new_versions = (vs.results || []).length;
    out.versions = (vs.results || []).map(function (r) { return { title: String(r.title || "").slice(0, 50), ver: r.version, doi: r.zenodo_doi }; });
  } catch (e) { out.lp_error = String(e && e.message || e); }
  // 4) social threads created this week (qnfo-audit social_threads)
  try {
    const wk = new Date(Date.now() - 7 * 864e5).toISOString().replace("T", " ");
    const sc = await env.AUDIT.prepare("SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status='posted' THEN 1 ELSE 0 END),0) posted FROM social_threads WHERE created_at >= ?1").bind(wk).first();
    out.social_threads_7d = sc ? (sc.n || 0) : 0; out.social_posted_7d = sc ? (sc.posted || 0) : 0;
  } catch (e) { out.soc_error = String(e && e.message || e); }
  // 5) citations (citation_stats: openalex/crossref cited_by + totals)
  try {
    const cit = await env.AUDIT.prepare("SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN metric='cited_by_count' THEN value ELSE 0 END),0) cited FROM citation_stats WHERE source IN ('openalex','crossref') AND collected_at >= datetime('now','-8 days')").first();
    const citedDois = await env.AUDIT.prepare("SELECT COUNT(DISTINCT doi) n FROM citation_stats WHERE metric='cited_by_count' AND value > 0").first();
    out.citation_events = cit ? (cit.n || 0) : 0;
    out.citation_count = cit ? (cit.cited || 0) : 0;
    out.cited_dois = citedDois ? (citedDois.n || 0) : 0;
  } catch (e) { out.cit_error = String(e && e.message || e); }
  // 6) social engagement 7d (social_engagements)
  try {
    const wk = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const eng = await env.AUDIT.prepare("SELECT platform, metric, SUM(value) v FROM social_engagements WHERE collected_at >= ?1 AND metric != 'auth_status' AND metric != 'reach' GROUP BY platform, metric ORDER BY platform, metric").bind(wk).all();
    out.engagement = (eng.results || []).map(function (r) { return { platform: r.platform, metric: r.metric, value: r.v || 0 }; });
  } catch (e) { out.eng_error = String(e && e.message || e); }
  // 7) outreach funnel (qnfo-outreach D1: funnel_daily + submissions)
  try {
    if (env.OUTREACH) {
      const wk = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      const f = await env.OUTREACH.prepare("SELECT COALESCE(SUM(mined),0) mined, COALESCE(SUM(drafted),0) drafted, COALESCE(SUM(sent),0) sent, COALESCE(SUM(replied),0) replied, COALESCE(SUM(bounced),0) bounced, COALESCE(SUM(opted_out),0) opted_out FROM funnel_daily WHERE day >= ?1").bind(wk).first();
      const sub = await env.OUTREACH.prepare("SELECT COUNT(*) n FROM submissions WHERE status IN ('submitted','accepted')").first();
      out.outreach = f ? { mined_7d: f.mined, drafted_7d: f.drafted, sent_7d: f.sent, replied_7d: f.replied, bounced_7d: f.bounced, opted_out_7d: f.opted_out } : {};
      out.submissions_accepted = sub ? (sub.n || 0) : 0;
    }
  } catch (e) { out.outreach_error = String(e && e.message || e); }
  const L = ["QNFO visibility scorecard — " + today, ""];
  if (out.requests !== undefined) L.push("zone qnfo.org 7d: " + out.requests + " requests / " + out.pageviews + " pageviews / " + out.uniques + " unique visitors (" + out.days + " days)");
  else L.push("zone qnfo.org 7d: unavailable (" + (out.web_error || "no data") + ")");
  L.push("zenodo: " + (out.dois || 0) + " records | downloads " + (out.zenodo_downloads || 0) + " (+Δ" + (out.dl_delta || 0) + ") | views " + (out.zenodo_views || 0) + " (+Δ" + (out.vw_delta || 0) + ")");
  if (out.movers && out.movers.length) { L.push("", "zenodo top movers (7d):"); for (const m of out.movers.slice(0, 6)) L.push("- +" + m.dl_gain + " dl / +" + m.vw_gain + " vw  " + m.title + "  " + m.doi); }
  if (out.new_versions !== undefined) { L.push("", "new versions this week: " + out.new_versions); for (const v of (out.versions || []).slice(0, 8)) L.push("- " + v.title + " " + v.ver + "  " + v.doi); }
  L.push("", "social threads created 7d: " + (out.social_threads_7d || 0) + " (posted " + (out.social_posted_7d || 0) + ")");
  L.push("citations: " + (out.citation_count || 0) + " cited-by across " + (out.cited_dois || 0) + " DOIs (" + (out.citation_events || 0) + " events 7d)");
  if (out.engagement && out.engagement.length) {
    L.push("", "social engagement (7d):");
    for (const e of out.engagement) L.push("- " + e.platform + " " + e.metric + ": " + e.value);
  } else L.push("", "social engagement (7d): none collected" + (out.eng_error ? " (" + out.eng_error + ")" : ""));
  if (out.outreach) {
    L.push("", "outreach (7d): mined " + (out.outreach.mined_7d || 0) + " / drafted " + (out.outreach.drafted_7d || 0) + " / sent " + (out.outreach.sent_7d || 0) + " / replies " + (out.outreach.replied_7d || 0) + " / bounces " + (out.outreach.bounced_7d || 0) + " / opt-outs " + (out.outreach.opted_out_7d || 0));
    L.push("open submissions accepted: " + (out.submissions_accepted || 0));
  } else if (out.outreach_error) L.push("", "outreach (7d): unavailable (" + out.outreach_error + ")");
  // 8) ops AI endpoint usage 7d (qnfo-ops: ops_ai_log + cloud_ops_events)
  try {
    const wk = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const oa = await env.AUDIT.prepare("SELECT COUNT(*) n, ROUND(COALESCE(SUM(cost_usd),0),4) cost FROM ops_ai_log WHERE ts >= ?1").bind(wk).first();
    const ev = await env.AUDIT.prepare("SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END),0) ok FROM cloud_ops_events WHERE job='qnfo-ops' AND kind='ops_ai_tool' AND ts >= ?1").bind(wk).first();
    const dr = await env.AUDIT.prepare("SELECT COUNT(*) n FROM cloud_ops_events WHERE job='qnfo-ops' AND text='ops_issue_run' AND status='ok' AND ts >= ?1").bind(wk).first();
    out.ops_ai = { chats_7d: oa ? (oa.n || 0) : 0, cost_7d: oa ? (oa.cost || 0) : 0, tool_events_7d: ev ? (ev.n || 0) : 0, tool_ok_7d: ev ? (ev.ok || 0) : 0, drains_7d: dr ? (dr.n || 0) : 0 };
  } catch (e) { out.ops_error = String(e && e.message || e); }
  if (out.ops_ai) L.push("", "ops AI (7d): " + out.ops_ai.chats_7d + " chats | $" + out.ops_ai.cost_7d + " | " + out.ops_ai.tool_events_7d + " tool events (" + out.ops_ai.tool_ok_7d + " ok) | drains " + out.ops_ai.drains_7d);
  else if (out.ops_error) L.push("", "ops AI (7d): unavailable (" + out.ops_error + ")");
  const d = await storeDigest(env, "visibility", "QNFO visibility scorecard — " + today, L.join(NL));
  out.digest = d;
  return { status: "ok", notes: out };
}


// ---------- engagement collection (Bluesky + Buffer) ----------
async function jobEngagement(env) {
  const out = { ts: new Date().toISOString().slice(0, 10) };
  const stmts = [];
  const row = (platform, postId, metric, value, note) => {
    stmts.push(env.AUDIT.prepare("INSERT INTO social_engagements (platform, post_id, metric, value, note, collected_at) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(platform, post_id, metric, collected_at) DO UPDATE SET value=excluded.value, note=excluded.note").bind(platform, postId, metric, value, note || null, out.ts));
  };
  // 1) Bluesky (AT Protocol) - live
  try {
    if (!env.BSKY_HANDLE || !env.BSKY_APP_PASS) { out.bsky = "no credentials"; }
    else {
      const BS = "https://bsky.social/xrpc";
      const sessR = await fetch(BS + "/com.atproto.server.createSession", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "qnfo-cloud-ops/" + VERSION }, body: JSON.stringify({ identifier: env.BSKY_HANDLE, password: env.BSKY_APP_PASS }) });
      const sess = await sessR.json();
      if (!sessR.ok || !sess.accessJwt) { out.bsky = "session " + sessR.status; }
      else {
        const feedR = await fetch(BS + "/app.bsky.feed.getAuthorFeed?actor=" + encodeURIComponent(sess.did) + "&limit=30", { headers: { "User-Agent": "qnfo-cloud-ops/" + VERSION, Authorization: "Bearer " + sess.accessJwt } });
        const feed = await feedR.json();
        const uris = ((feed && feed.feed) || []).map((f) => f.post && f.post.uri).filter(Boolean);
        let likes = 0, reposts = 0, replies = 0, counted = 0;
        for (let i = 0; i < uris.length; i += 25) {
          const chunk = uris.slice(i, i + 25);
          const postsR = await fetch(BS + "/app.bsky.feed.getPosts?" + chunk.map((u) => "uris=" + encodeURIComponent(u)).join("&"), { headers: { "User-Agent": "qnfo-cloud-ops/" + VERSION, Authorization: "Bearer " + sess.accessJwt } });
          const posts = await postsR.json();
          for (const p of (posts && posts.posts) || []) {
            const l = p.likeCount || 0, r = p.repostCount || 0, c = p.replyCount || 0;
            likes += l; reposts += r; replies += c; counted++;
            row("bluesky", p.uri, "likes", l);
            row("bluesky", p.uri, "reposts", r);
            row("bluesky", p.uri, "replies", c);
          }
        }
        out.bsky = { posts: counted, likes, reposts, replies };
      }
    }
  } catch (e) { out.bsky_error = String(e && e.message || e); }
  // 2) Buffer (Mastodon / LinkedIn / X) - token-gated, graceful 401
  try {
    if (!env.BUFFER_TOKEN) { out.buffer = "no token"; }
    else {
      const B = "https://api.bufferapp.com/1";
      const pr = await fetch(B + "/profiles.json?access_token=" + env.BUFFER_TOKEN, { headers: { "User-Agent": "qnfo-cloud-ops/" + VERSION } });
      if (pr.status === 401) { out.buffer = "unauthorized (reconnect required)"; row("buffer", "auth", "auth_status", 0, "401 unauthorized"); }
      else if (!pr.ok) { out.buffer = "HTTP " + pr.status; }
      else {
        const profiles = await pr.json();
        let likes = 0, comments = 0, shares = 0, reach = 0, counted = 0;
        for (const prof of (profiles || []).slice(0, 4)) {
          try {
            const ur = await fetch(B + "/profiles/" + prof.id + "/updates/sent.json?access_token=" + env.BUFFER_TOKEN + "&count=10", { headers: { "User-Agent": "qnfo-cloud-ops/" + VERSION } });
            if (!ur.ok) continue;
            const updates = await ur.json();
            for (const u of updates || []) {
              const ir = await fetch(B + "/updates/" + u.id + "/interactions.json?access_token=" + env.BUFFER_TOKEN, { headers: { "User-Agent": "qnfo-cloud-ops/" + VERSION } });
              if (!ir.ok) continue;
              const inter = await ir.json();
              const f = inter.favorites || 0, c = inter.comments || 0, rt = inter.retweets || 0, sh = inter.shares || 0, re = inter.reach || 0;
              likes += f; comments += c; shares += rt + sh; reach += re; counted++;
              row("buffer", String(u.id), "likes", f);
              row("buffer", String(u.id), "comments", c);
              row("buffer", String(u.id), "shares", rt + sh);
              row("buffer", String(u.id), "reach", re);
            }
          } catch (e2) {}
        }
        out.buffer = { updates: counted, likes, comments, shares, reach };
      }
    }
  } catch (e) { out.buffer_error = String(e && e.message || e); }
  try {
    if (stmts.length) {
      const batch = stmts.slice(0, 100);
      await env.AUDIT.batch(batch);
      out.rows_written = batch.length;
      out.rows_total = stmts.length;
    } else out.rows_written = 0;
  } catch (e) { out.write_error = String(e && e.message || e); }
  return { status: "ok", notes: out };
}
// ================= PART 5: registry + dispatch + handlers =================

const JOBS = {
  "email-triage": jobEmailTriage,
  "gmail-triage": jobGmailTriage,
  "briefing": jobBriefing,
  "research-scan": jobResearchScan,
  "weekly": jobWeekly,
  "weekly-ops": jobWeeklyOps,
  "monthly-cost-report": jobMonthlyCostReport,
  "portfolio-sync": jobPortfolioSync,
  "zenodo-stats": jobZenodoStats,
  "board-sync": jobBoardSync,
  "release-check": jobReleaseCheck,
  "nlnet": jobNlnet,
  "outreach": jobOutreach,
  "backfill": jobBackfill,
  "worker-health": jobWorkerHealth,
  "sitemap-ping": jobSitemapPing,
  "loose-threads-sweep": jobLooseThreadsSweep,
  "visibility": jobVisibility,
  "engagement": jobEngagement,
};

// cron -> job dispatch map for a given Amsterdam offset
function dispatchMap(offset) {
  const map = {};
  for (const c of buildCrons(offset)) map[c.cron] = c.job;
  return map;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    const off = Number(await stateGet(env, "cron_offset", "2")) || 2;
    const map = dispatchMap(off);
    const job = map[cron];
    if (!job || !JOBS[job]) {
      console.log("no job for cron", cron, "offset", off);
      return;
    }
    try {
      const out = await JOBS[job](env);
      await logRun(env, job, out.status, out.notes || {});
      await recordEvent(env, "job-run", "jr-" + job + "-" + Date.now().toString(36), job + " " + out.status + " " + JSON.stringify(out.notes || {}).slice(0, 300), { job, status: out.status });
      console.log("cloud-ops", job, out.status, JSON.stringify(out.notes || {}).slice(0, 200));
    } catch (e) {
      await logRun(env, job, "error", { error: String(e && e.message || e) });
      await recordEvent(env, "job-run", "jr-" + job + "-" + Date.now().toString(36), job + " error " + String(e && e.message || e), { job, status: "error" });
      console.error("cloud-ops", job, "error", String(e && e.message || e));
      try {
        await sendDigest(env, "QNFO cloud job failure \u2014 " + job, "Job " + job + " failed: " + String(e && e.message || e));
      } catch (e2) {}
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (path === "/health" && request.method === "GET") {
      const off = amsOffset(new Date());
      const crons = buildCrons(off).map((c) => c.cron + " -> " + c.job);
      return new Response(JSON.stringify({
        ok: true, worker: WORKER_NAME, version: VERSION,
        jobs: Object.keys(JOBS),
        ams_offset: off,
        crons,
        bindings: {
          audit: !!env.AUDIT, portfolio: !!env.PORTFOLIO, living: !!env.LIVING, outreach: !!env.OUTREACH, graph: !!env.GRAPH,
          email: !!env.EMAIL, email_key: !!env.EMAIL_API_KEY, qnfo_infra: !!env.QNFO_INFRA,
          send_email: !!env.SEND_EMAIL, vault: !!env.VAULT, ai: !!env.AI, ops_vz: !!env.OPS_VZ,
          secrets: { gh: !!env.GH_TOKEN, gmail: !!env.GMAIL_PASS, cf: !!env.CF_TOKEN, admin: !!env.OPS_ADMIN_TOKEN, infra_token: !!env.INFRA_TOKEN }
        }
      }), { headers: { "Content-Type": "application/json", ...CORS } });
    }

    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!auth(token, env)) return new Response("unauthorized", { status: 401, headers: CORS });

    if (path === "/run" && request.method === "POST") {
      const job = (url.searchParams.get("job") || "").trim();
      if (!job || !JOBS[job]) return new Response(JSON.stringify({ error: "unknown job: " + job + " (valid: " + Object.keys(JOBS).join(",") + ")" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
      try {
        const out = await JOBS[job](env);
        await logRun(env, job, out.status, out.notes || {});
        await recordEvent(env, "job-run", "jr-" + job + "-" + Date.now().toString(36), job + " " + out.status + " " + JSON.stringify(out.notes || {}).slice(0, 300), { job, status: out.status });
        return new Response(JSON.stringify({ ok: true, job, ...out }), { headers: { "Content-Type": "application/json", ...CORS } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, job, error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json", ...CORS } });
      }
    }

    if (path === "/search" && request.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return new Response(JSON.stringify({ error: "q required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
      const vec = await embedText(env, q);
      if (!vec) return new Response(JSON.stringify({ error: "embedding failed" }), { status: 502, headers: { "Content-Type": "application/json", ...CORS } });
      const k = Math.min(Math.max(parseInt(url.searchParams.get("k") || "8", 10) || 8, 1), 20);
      try {
        const r = await env.OPS_VZ.query(vec, { topK: k, returnValues: false, returnMetadata: "all" });
        const hits = (r.matches || []).map((m) => {
          const md = m.metadata || {};
          return { id: m.id, score: Math.round((m.score || 0) * 1e4) / 1e4, kind: md.kind, ts: md.ts, job: md.job, status: md.status, text: md.text || "" };
        });
        return new Response(JSON.stringify({ ok: true, query: q, count: hits.length, hits }), { headers: { "Content-Type": "application/json", ...CORS } });
      } catch (e) {
        return new Response(JSON.stringify({ error: "search failed: " + String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json", ...CORS } });
      }
    }

    if (path === "/cron-rebuild" && request.method === "POST") {
      const r = await syncSchedules(env, true);
      return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json", ...CORS } });
    }

    if (path === "/register" && request.method === "GET") {
      const mode = url.searchParams.get("mode") || "d1";
      let out = {};
      if (mode === "r2") {
        out.register = await r2GetText(env, REGISTER_R2_KEY);
        out.cloud_append = await r2GetText(env, CLOUD_APPEND_R2_KEY);
      } else {
        const rows = await env.AUDIT.prepare("SELECT id, section, line, done, line_date, source FROM gtd_register ORDER BY id DESC LIMIT 50").all();
        out.rows = rows.results || [];
      }
      return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", ...CORS } });
    }

    if (path === "/auth/graph" && request.method === "GET") {
      const step = url.searchParams.get("step") || "";
      const info = {
        status: env.MS_CLIENT_ID ? "configured" : "not-configured",
        steps: [
          "One-time bootstrap (user action, ~3 min):",
          "1. https://entra.microsoft.com -> App registrations -> New registration (name: qnfo-cloud-scheduler; accounts: personal Microsoft accounts only).",
          "2. API permissions: Microsoft Graph delegated -> Mail.ReadWrite, Calendars.ReadWrite, Tasks.ReadWrite, offline_access.",
          "3. Authentication -> Mobile and desktop applications -> enable https://login.microsoftonline.com/common/oauth2/nativeclient.",
          "4. Put the Application (client) ID into the worker secret MS_CLIENT_ID via PUT /accounts/{acct}/workers/scripts/qnfo-cloud-ops/secrets/MS_CLIENT_ID.",
          "5. GET /auth/graph?step=device on this worker to start the device-code flow; the code is emailed to the digest address for one-time consent.",
        ],
        device: step === "device" && env.MS_CLIENT_ID ? { note: "device flow starts once MS_CLIENT_ID is set" } : null
      };
      return new Response(JSON.stringify(info), { headers: { "Content-Type": "application/json", ...CORS } });
    }

    return new Response("not found", { status: 404, headers: CORS });
  }
};
