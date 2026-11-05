var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var VERSION = "1.6.0-codeagent";
/* 1.5.8 CRON-D1-RETRY-1 (pillar autonomy; patch): the fleet_heartbeat upsert retries transient D1 errors (overloaded, timeout, reset) with backoff, so a short D1 overload no longer leaves the worker looking silent to CRON-WATCH-1 (worker-silent:qnfo-subscribers). */ /* 1.5.0-no-registrar NO-REGISTRAR-1 (2026-10-21): dead DOIs recognised by prefix only */ // 1.4.0 CRON-GRID-1 (owner directive 2026-10-19, pillar autonomy): one hourly trigger. The weekly digest keeps its Sunday 16:00 UTC slot (never retried: it is a send to subscribers); subscriber attribution and the heartbeat now run every hour (they ran weekly). Every fire is logged to cron_fire_log for CRON-WATCH-1. // 1.3.4 SUBSCRIBERS-ATTRIBUTION-CHAIN-1 (2026-10-19, agent_issues 2899, QNFO/qnfo-workers#2489, pillar reach): the attribution snapshot passes the reach_signals CHECK (quality unknown), is one batch with its DELETE, sums per entity_id, and the utm columns are ensured per column before the cron reads them. // 1.3.1 WORKERS-BP-LOGGING-qnfo-subscribers-1 (2026-10-14, agent_issues 2539, child of 2342, pillar autonomy): the swallowed catch in handleSubscribe logs as a structured console.error (worker, where, error); control flow unchanged. // 1.3.0 (2026-10-13, pillar autonomy, issue 2397) CRON-ONLY-HEARTBEAT-1: the weekly cron upserts qnfo-audit.fleet_heartbeat after the digest run.
// 1.2.0 (2026-10-12, pillar reach, issue 1753) SUBSCRIBE-FUNNEL-1: every step of the sign-up
// funnel is counted in qnfo-audit.subscribe_funnel (day, stage, source, n; a counter, never an address): box and page views,
// submits by outcome (accepted, honeypot, invalid, rate-limited, suppressed, repeat), confirmation mails sent or failed,
// confirm-page views, confirmations and unsubscribes. GET /funnel returns the 30-day funnel and names its largest leak (open,
// counts only); GET /subscribe is a sign-up page of its own (one field, works without scripts) that a post or a mail can link
// to; POST /funnel/view lets another surface count a view of its box. SUBSCRIBE-SEND-HONEST-1: a sign-up whose confirmation
// mail could not be sent answers with an error instead of "check your inbox". SUBSCRIBE-RESEND-BOUND-1: a pending address gets
// at most one confirmation mail an hour, however often the form is submitted with it (the form could be used to mail one
// address without limit). The digest token is compared in constant time; event ids come from crypto.randomUUID.
// 1.1.10-doi-scrub // 1.1.8 DIGEST-LINKS-UTM-1 (2026-10-06, pillar reach; transformation lever T7.10): every paper link in the
// weekly digest carries utm_source=digest&utm_medium=email&utm_campaign=<slug> and the confirmation mail's corpus link
// utm_source=confirm&utm_medium=email&utm_campaign=corpus, so a digest read becomes a measured visit once qnfo-gateway 3.10.0
// (UTM-CLICK-LEDGER-1, T7.9) counts tagged page loads into reach_signals source utm (channel digest, campaign slug). No
// per-recipient id: the campaign is the paper, never the reader. Unsubscribe and confirm links stay untagged (API routes).
// 1.1.7 // 1.1.5 FLEET-CTL-STATIC-1: static fleet link (issue 1778); DIGEST-EXCLUDE-1 (2026-10-02): the digest skips quarantined papers, as papers.qnfo.org does
// 1.1.7 (2026-10-05, pillar: reach): SUBSCRIBE-CONFIRM-POST-1 (#1904) and SUBSCRIBE-SEND-LOG-1 (#1905).
// (1) GET /confirm?token=... no longer confirms. Mail link scanners (for example Microsoft Safe Links) fetch every link in a
//     message, so a confirming GET turned scanner traffic into subscribers nobody opted in. GET returns a page with one
//     "Confirm subscription" button; only its POST sets status='subscribed'. The button posts to this worker's own origin,
//     because qnfo-gateway forwards /api/confirm upstream as a GET whatever the browser's method. The link in the email is
//     unchanged. Each page view and each confirmation is one cloud_ops_events row (kind 'subscribers-confirm', no address),
//     so the double opt-in completion rate is measurable.
// (2) Every send writes one cloud_ops_events row (kind 'subscribers-send', status ok|error, meta {kind: confirm|digest,
//     domain, messageId or error}); the address itself is never written, only its domain. Digest sends carry
//     List-Unsubscribe <https unsubscribe URL> and List-Unsubscribe-Post: List-Unsubscribe=One-Click (Cloudflare Email
//     Service send() accepts headers; refused headers fall back to a send without them, recorded as headers_refused).
//     The one-click POST reaches /unsubscribe, which already unsubscribes on GET or POST.
// The cron "0 16 * * 1" fires on Sunday 16:00 UTC (Cloudflare cron day-of-week 1 = Sunday; subscriber_digest_runs rows
// 2026-09-13..10-04 are all Sundays), so /health now says Sunday.
var SITE = "https://qnfo.org";
// DIGEST-LINKS-UTM-1: a site link tagged for the reach ledger (qnfo-gateway counts utm-tagged HTML loads; the campaign is the
// paper slug or a fixed word, never a recipient id).
function utmLink(path, source, campaign) {
  return SITE + path + "?utm_source=" + encodeURIComponent(source) + "&utm_medium=email&utm_campaign=" + encodeURIComponent(campaign);
}
__name(utmLink, "utmLink");
// FLEET-CTL-STATIC-1 (issue 1778; owner request 1757): the owner's fleet command-line link on the subscribe, confirm and
// unsubscribe pages, as static HTML scoped to the subscribe surface. Not fleet.qnfo.org/ctl.js: it scopes the link with
// location.href, and these pages are opened at /api/confirm?token=... and /api/unsubscribe?token=..., so a click would carry
// the subscriber's token to another site.
var FLEET_CTL_LINK = '<a id="fleet-ctl" href="https://fleet.qnfo.org/cmd?from=' + encodeURIComponent(SITE + "/subscribe") + '" rel="noopener noreferrer" title="Fleet command line for this page (owner controls need an email code)" aria-label="Fleet command line" style="position:fixed;right:10px;bottom:8px;z-index:2147483000;font:12px/1 system-ui,sans-serif;padding:5px 8px;border-radius:7px;color:#5b6472;background:rgba(127,127,127,.12);text-decoration:none;opacity:.45">&#8984; fleet</a><style>@media print{#fleet-ctl{display:none!important}}</style>';
var FROM = { email: "qnfo@qnfo.org", name: "QNFO" };
var DIGEST_VOTE_BASE = SITE + "/api/vote/digest";
var MAX_RECIPIENTS = 1e3;
var RATE_LIMIT_PER_HOUR = 5;
var DIGEST_WINDOW_DAYS = 7;
var PAPER_CAP = 60;
function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
__name(json, "json");
function html(body, status) {
  const page = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>QNFO</title><style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#faf7f2;color:#1b1915;display:flex;min-height:100vh;align-items:center;justify-content:center}main{max-width:560px;padding:2.5rem 1.6rem;text-align:center}h1{font-family:Georgia,serif;font-size:1.6rem;font-weight:600}p{color:#8a8376;line-height:1.7}a{color:#24315e}</style></head><body><main>' + body + '<p style="margin-top:2rem"><a href="' + SITE + '">\u2190 qnfo.org</a></p></main>' + FLEET_CTL_LINK + '</body></html>';
  return new Response(page, { status: status || 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
__name(html, "html");
function normEmail(v) {
  return String(v == null ? "" : v).trim().toLowerCase();
}
__name(normEmail, "normEmail");
function validEmail(e) {
  if (!e || e.length > 254) return false;
  return /^[^@\s]{1,64}@[^@\s.]{1,255}\.[^@\s.]{2,}$/.test(e);
}
__name(validEmail, "validEmail");
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  const arr = Array.from(new Uint8Array(buf));
  let out = "";
  for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
  return out;
}
__name(sha256Hex, "sha256Hex");
function fmtDate(s) {
  return String(s || "").slice(0, 10);
}
__name(fmtDate, "fmtDate");
function unsubUrl(token) {
  return SITE + "/api/unsubscribe?token=" + encodeURIComponent(token);
}
__name(unsubUrl, "unsubUrl");
function confirmUrl(token) {
  return SITE + "/api/confirm?token=" + encodeURIComponent(token);
}
__name(confirmUrl, "confirmUrl");
// SUBSCRIBE-SEND-LOG-1 (#1905): one cloud_ops_events row per event; never throws, never stores an address.
async function logEvent(env, kind, status, text, meta) {
  try {
    if (!env.AUDIT) return;
    await env.AUDIT.prepare(
      "INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, ?2, ?3, ?4, ?5, 'subscribers', ?6)"
    ).bind(kind + "-" + Date.now().toString(36) + crypto.randomUUID().replace(/-/g, "").slice(0, 6), (/* @__PURE__ */ new Date()).toISOString(), kind, String(text).slice(0, 300), JSON.stringify(Object.assign({ v: VERSION }, meta || {})), status).run();
  } catch (e) {
  }
}
__name(logEvent, "logEvent");
// SUBSCRIBE-FUNNEL-1 (1.2.0, issue 1753): one counter row per day, stage and source. No address, no IP, no token.
var FUNNEL_DDL = "CREATE TABLE IF NOT EXISTS subscribe_funnel (day TEXT NOT NULL, stage TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, stage, source))";
var FUNNEL_READY = new WeakSet();
var FUNNEL_STAGES = ["box_view", "page_view", "submit", "confirm_mail_sent", "confirm_page", "confirmed"];
var BOT_UA_RE = /bot|crawl|spider|slurp|headless|preview|scan|monitor|curl|wget|python|http-client|safelinks/i;
function funnelSource(v) {
  const x = String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40);
  return x || "unknown";
}
__name(funnelSource, "funnelSource");
async function funnel(env, stage, source) {
  try {
    if (!env.AUDIT) return;
    if (!FUNNEL_READY.has(env.AUDIT)) {
      await env.AUDIT.prepare(FUNNEL_DDL).run();
      FUNNEL_READY.add(env.AUDIT);
    }
    await env.AUDIT.prepare(
      "INSERT INTO subscribe_funnel (day, stage, source, n) VALUES (date('now'), ?1, ?2, 1) ON CONFLICT(day, stage, source) DO UPDATE SET n = n + 1"
    ).bind(String(stage), funnelSource(source)).run();
  } catch (e) {
    console.error(JSON.stringify({ event: "subscribe_funnel_write_failed", stage: String(stage), error: String(e && e.message || e).slice(0, 200) }));
  }
}
__name(funnel, "funnel");
// The 30-day funnel and its largest leak: the step with the lowest pass-through among steps that had any input.
function funnelSummary(rows) {
  const stages = {}, bySource = {};
  for (const r of rows || []) {
    const n = Number(r.n) || 0;
    stages[r.stage] = (stages[r.stage] || 0) + n;
    if (!bySource[r.source]) bySource[r.source] = {};
    bySource[r.source][r.stage] = (bySource[r.source][r.stage] || 0) + n;
  }
  const views = (stages.box_view || 0) + (stages.page_view || 0);
  const steps = [
    { step: "view -> submit", from: views, to: stages.submit || 0 },
    { step: "submit -> confirmation mail sent", from: stages.submit || 0, to: stages.confirm_mail_sent || 0 },
    { step: "confirmation mail sent -> confirm page opened", from: stages.confirm_mail_sent || 0, to: stages.confirm_page || 0 },
    { step: "confirm page opened -> confirmed", from: stages.confirm_page || 0, to: stages.confirmed || 0 }
  ];
  let leak = null;
  for (const st of steps) {
    st.rate = st.from > 0 ? Math.round(st.to / st.from * 1e4) / 1e4 : null;
    if (st.rate !== null && (leak === null || st.rate < leak.rate)) leak = st;
  }
  return { stages, by_source: bySource, steps, largest_leak: leak ? { step: leak.step, from: leak.from, to: leak.to, rate: leak.rate } : null };
}
__name(funnelSummary, "funnelSummary");
async function handleFunnel(env) {
  let rows = [];
  try {
    const r = await env.AUDIT.prepare("SELECT stage, source, SUM(n) AS n FROM subscribe_funnel WHERE day >= date('now','-30 days') GROUP BY stage, source").all();
    rows = r && r.results || [];
  } catch (e) {
    rows = [];
  }
  const out = funnelSummary(rows);
  out.worker = "qnfo-subscribers";
  out.version = VERSION;
  out.window_days = 30;
  out.limits = ["counts only: no address, IP or token is stored", "box_view is counted only for surfaces that report it (POST /funnel/view?source=<surface>); page_view is this worker's own /subscribe page; both skip declared bots", "a surface that reports no view shows submits without a view count"];
  return json(out);
}
__name(handleFunnel, "handleFunnel");
async function handleFunnelView(request, env) {
  const u = new URL(request.url);
  const ua = String(request.headers.get("User-Agent") || "");
  await funnel(env, BOT_UA_RE.test(ua) || !ua ? "box_view_bot" : "box_view", u.searchParams.get("source") || "unknown");
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
}
__name(handleFunnelView, "handleFunnelView");
// The sign-up page: one field, a plain form post (no script needed), the same double opt-in as every other box.
function subscribePage(source, note) {
  return html('<h1>New QNFO papers by email</h1><p>One short weekly digest: titles and links, nothing else. Nothing is sent until you confirm by email, and every digest carries a one-click unsubscribe.</p>' + (note ? '<p role="status" style="color:#1b1915"><strong>' + escAttr(note) + "</strong></p>" : "") + '<form method="post" action="/subscribe" style="margin-top:1.4rem"><label for="sub-email" style="position:absolute;left:-9999px">Email address</label><input id="sub-email" type="email" name="email" required autocomplete="email" placeholder="you@example.com" style="font:inherit;font-size:1rem;padding:.7rem .8rem;border:1px solid #cfc8ba;border-radius:8px;min-width:16rem;max-width:100%"> <input type="text" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px"><input type="hidden" name="source" value="' + escAttr(funnelSource(source)) + '"><button type="submit" style="font:inherit;font-size:1rem;padding:.7rem 1.4rem;border:0;border-radius:8px;background:#24315e;color:#fff;cursor:pointer">Subscribe</button></form>');
}
__name(subscribePage, "subscribePage");
async function handleSubscribePage(request, env) {
  const u = new URL(request.url);
  const source = u.searchParams.get("utm_source") || u.searchParams.get("source") || "subscribe-page";
  const ua = String(request.headers.get("User-Agent") || "");
  await funnel(env, BOT_UA_RE.test(ua) || !ua ? "page_view_bot" : "page_view", source);
  return subscribePage(source);
}
__name(handleSubscribePage, "handleSubscribePage");
// Constant-time comparison of two secrets: both are hashed, so neither length nor a prefix match shows in the timing.
async function safeEqual(a, b) {
  const x = await sha256Hex(String(a)), y = await sha256Hex(String(b));
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
__name(safeEqual, "safeEqual");
function emailDomain(to) {
  return String(to || "").toLowerCase().split("@").pop().slice(0, 120);
}
__name(emailDomain, "emailDomain");
async function sendEmail(env, to, subject, text, kind, headers) {
  kind = kind || "confirm";
  const domain = emailDomain(to);
  if (!env.SEND_EMAIL) {
    await logEvent(env, "subscribers-send", "error", "subscribers " + kind + " send error (" + domain + ")", { kind, domain, error: "SEND_EMAIL binding missing" });
    return { error: "SEND_EMAIL binding missing" };
  }
  const msg = { to, from: FROM, subject, text };
  let headersRefused = null;
  try {
    let r;
    if (headers) {
      try {
        r = await env.SEND_EMAIL.send(Object.assign({}, msg, { headers }));
      } catch (e) {
        const m = String(e && e.message || e);
        if (!/header/i.test(m)) throw e;
        headersRefused = m.slice(0, 200);
        r = await env.SEND_EMAIL.send(msg);
      }
    } else {
      r = await env.SEND_EMAIL.send(msg);
    }
    const messageId = r && r.messageId || null;
    const meta = { kind, domain, messageId };
    if (headers) meta.list_unsubscribe = !headersRefused;
    if (headersRefused) meta.headers_refused = headersRefused;
    await logEvent(env, "subscribers-send", "ok", "subscribers " + kind + " send ok (" + domain + ")", meta);
    return { ok: true, messageId };
  } catch (e) {
    const err = String(e && e.message || e);
    await logEvent(env, "subscribers-send", "error", "subscribers " + kind + " send error (" + domain + ")", { kind, domain, error: err.slice(0, 300) });
    return { error: err };
  }
}
__name(sendEmail, "sendEmail");
// RFC 2369 / RFC 8058 one-click unsubscribe for the digest (Gmail and Yahoo expect it on bulk mail).
function listUnsubscribeHeaders(token) {
  return { "List-Unsubscribe": "<" + unsubUrl(token) + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}
__name(listUnsubscribeHeaders, "listUnsubscribeHeaders");
function escAttr(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
__name(escAttr, "escAttr");
function confirmText(token) {
  return [
    "Thanks for subscribing to QNFO.",
    "",
    "Please confirm your subscription by opening this link:",
    "",
    confirmUrl(token),
    "",
    "Once confirmed you will receive a short weekly digest of new QNFO papers:",
    "titles, links and DOIs, nothing else.",
    "",
    "If you did not request this, ignore this message - no further email will be sent.",
    "",
    "Browse the corpus: " + utmLink("/papers", "confirm", "corpus"),
    "",
    "\u2014 QNFO"
  ].join("\n");
}
__name(confirmText, "confirmText");
function digestText(papers, token) {
  const lines = [];
  lines.push(papers.length + (papers.length === 1 ? " new paper" : " new papers") + " from QNFO this week.");
  lines.push("");
  for (let i = 0; i < papers.length; i++) {
    const p = papers[i];
    const doi = /10\.5281\//.test(String(p.doi || "")) ? "" : String(p.doi || "");
    lines.push(i + 1 + ". " + String(p.title || "").replace(/\s+/g, " ").trim());
    const meta = [];
    if (p.created_at) meta.push(fmtDate(p.created_at));
    if (doi) meta.push("DOI: " + doi);
    if (meta.length) lines.push("   " + meta.join("  \xB7  "));
    if (p.slug) lines.push("   " + utmLink("/papers/" + p.slug, "digest", p.slug));
    lines.push("");
  }
  lines.push("");
  lines.push("Know someone who should read this? Forward this issue, or send them here:");
  lines.push(SITE + "/?utm_source=digest&utm_campaign=digest-forward");
  lines.push("");
  lines.push("Unsubscribe: " + unsubUrl(token));
  lines.push("");
  lines.push("\u2014 QNFO");
  return lines.join("\n");
}
__name(digestText, "digestText");
/* SUBSCRIBE-UTM-ATTRIBUTION-1: ensure the utm_source/utm_campaign columns exist (lazy ALTER, safe
 * when the migration already ran) so the sign-up can record which tagged link drove it.
 * SUBSCRIBERS-ATTRIBUTION-CHAIN-1: one try per column (a duplicate on the first must not skip the second), a real
 * failure is logged and retried on the next call, and the isolate guard is set only when both columns exist. */
var SUB_UTM_READY = new WeakSet();
async function ensureSubscriberUtm(env) {
  if (!env.AUDIT || SUB_UTM_READY.has(env.AUDIT)) return;
  let ready = true;
  // CF-OBS-ISSUE-1: the lazy ALTER TABLE ran on cold start and intermittently exceeded the D1
  // storage-operation budget. Probe for each column with a catalog read (cheap, no DDL); the
  // ALTER runs only when the column is genuinely missing, once per isolate.
  for (const col of ["utm_source", "utm_campaign"]) {
    let present = false;
    try {
      const r = await env.AUDIT.prepare("SELECT 1 AS x FROM pragma_table_info('subscribers') WHERE name = ?1").bind(col).first();
      present = !!(r && r.x);
    } catch (e) {
      const probeMsg = String(e && e.message || e);
      console.error(JSON.stringify({ worker: "qnfo-subscribers", where: "ensureSubscriberUtm", probe: col, error: probeMsg.slice(0, 200) }));
    }
    if (present) continue;
    try {
      await env.AUDIT.prepare("ALTER TABLE subscribers ADD COLUMN " + col + " TEXT NOT NULL DEFAULT ''").run();
    } catch (e) {
      const msg = String(e && e.message || e);
      if (!/duplicate column/i.test(msg)) {
        ready = false;
        console.error(JSON.stringify({ worker: "qnfo-subscribers", where: "ensureSubscriberUtm", column: col, error: msg.slice(0, 200) }));
      }
    }
  }
  if (ready) SUB_UTM_READY.add(env.AUDIT);
}

async function handleSubscribe(request, env) {
  let body = {};
  // A plain form post (the /subscribe page, no script) is answered with a page; a JSON post (the site's boxes) with JSON.
  const ctype = String(request.headers.get("Content-Type") || "").toLowerCase();
  const isForm = ctype.includes("application/x-www-form-urlencoded") || ctype.includes("multipart/form-data");
  try {
    if (isForm) {
      const f = await request.formData();
      body = { email: f.get("email"), hp: f.get("hp"), website: f.get("website"), source: f.get("source"), utm_source: f.get("utm_source"), utm_campaign: f.get("utm_campaign") };
    } else body = await request.json();
  } catch (e) {
    body = {};
  }
  const src = String(body && body.source || "qnfo.org").slice(0, 80);
  const utmSource = String(body && body.utm_source || "").slice(0, 80);
  const utmCampaign = String(body && body.utm_campaign || "").slice(0, 120);
  const reply = function(data, status) {
    if (!isForm) return json(data, status);
    if (data.ok) return html("<h1>Check your inbox</h1><p>" + (data.pending === false ? "This address is already subscribed. The next digest will reach you by email." : "A confirmation link is on its way. Your subscription starts when you open it and press the button. If nothing arrives within a few minutes, look in the spam folder.") + "</p>", status);
    return subscribePage(src, data.error || "The sign-up did not go through. Please try again.");
  };
  const email = normEmail(body && body.email);
  const hp = String(body && (body.hp || body.website) || "");
  if (hp) {
    await funnel(env, "submit_honeypot", src);
    return reply({ ok: true, pending: true });
  }
  if (!validEmail(email)) {
    await funnel(env, "submit_invalid", src);
    return reply({ ok: false, error: "Please enter a valid email address." }, 400);
  }
  // SUPPRESSION-BYPASS-AT-SUBSCRIBE-1 (#1276): honor email_suppression at sign-up
  // so an owner-suppressed address cannot silently re-enter the list. Return a
  // soft success (do not reveal suppression) and skip the INSERT + confirmation.
  try {
    const sup = await env.AUDIT.prepare("SELECT 1 AS x FROM email_suppression WHERE lower(email) = ?1").bind(email).first();
    if (sup) {
      await funnel(env, "submit_suppressed", src);
      return reply({ ok: true, pending: false, confirmation_sent: false, suppressed: true });
    }
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-subscribers", where: "handleSubscribe", error: String(e && e.message || e) })); }
  // SUBSCRIBE-CLIENT-IP-1: the gateway forwards the visitor identity as X-Forwarded-For / X-Client-UA;
  // read those first so worker-to-worker subrequests don't rate-limit the whole site as one visitor.
  const ip = request.headers.get("X-Forwarded-For") || request.headers.get("CF-Connecting-IP") || "";
  const ua = String(request.headers.get("X-Client-UA") || request.headers.get("User-Agent") || "").slice(0, 300);
  const ipHash = ip ? await sha256Hex(ip) : "";
  const source = src;
  try {
    if (ipHash) {
      const r = await env.AUDIT.prepare(
        "SELECT COUNT(*) AS c FROM subscribers WHERE ip_hash = ?1 AND created_at >= datetime('now','-1 hour')"
      ).bind(ipHash).first();
      if (r && r.c >= RATE_LIMIT_PER_HOUR) {
        await funnel(env, "submit_rate_limited", src);
        return reply({ ok: false, error: "Too many sign-ups from this network. Please try again later." }, 429);
      }
    }
    const existing = await env.AUDIT.prepare(
      "SELECT email, status, welcomed_at, unsub_token, (welcomed_at IS NOT NULL AND welcomed_at >= datetime('now','-60 minutes')) AS mailed_recently FROM subscribers WHERE email = ?1"
    ).bind(email).first();
    let token = existing && existing.unsub_token ? existing.unsub_token : "";
    if (!token) token = crypto.randomUUID().replace(/-/g, "");
    await ensureSubscriberUtm(env);
        // Insert or upsert the subscriber. If the utm columns are present (SUB_UTM_READY guard), store them;
    // otherwise fall back to a schema without those columns to avoid D1 ALTER timeouts on the request path.
    if (SUB_UTM_READY.has(env.AUDIT)) {
      await env.AUDIT.prepare(
        "INSERT INTO subscribers (email, status, source, utm_source, utm_campaign, unsub_token, ip_hash, user_agent, created_at) VALUES (?1, 'pending', ?2, ?3, ?4, ?5, ?6, ?7, datetime('now')) ON CONFLICT(email) DO UPDATE SET status = CASE WHEN subscribers.status = 'subscribed' THEN 'subscribed' ELSE 'pending' END, updated_at = datetime('now'), source = excluded.source, utm_source = excluded.utm_source, utm_campaign = excluded.utm_campaign"
      ).bind(email, source, utmSource, utmCampaign, token, ipHash, ua).run();
    } else {
      await env.AUDIT.prepare(
        "INSERT INTO subscribers (email, status, source, unsub_token, ip_hash, user_agent, created_at) VALUES (?1, 'pending', ?2, ?3, ?4, ?5, datetime('now')) ON CONFLICT(email) DO UPDATE SET status = CASE WHEN subscribers.status = 'subscribed' THEN 'subscribed' ELSE 'pending' END, updated_at = datetime('now'), source = excluded.source"
      ).bind(email, source, token, ipHash, ua).run();
    }
    const alreadyConfirmed = !!(existing && existing.status === "subscribed");
    if (alreadyConfirmed) {
      await funnel(env, "submit_already_confirmed", src);
      return reply({ ok: true, pending: false, confirmation_sent: false });
    }
    // SUBSCRIBE-RESEND-BOUND-1: one confirmation mail an hour per address, however often the form is submitted with it.
    if (existing && Number(existing.mailed_recently) === 1) {
      await funnel(env, "submit_repeat", src);
      return reply({ ok: true, pending: true, confirmation_sent: false, already_sent: true });
    }
    await funnel(env, "submit", src);
    const res = await sendEmail(env, email, "Confirm your QNFO subscription", confirmText(token), "confirm");
    if (res && res.ok) {
      await env.AUDIT.prepare("UPDATE subscribers SET welcomed_at = datetime('now') WHERE email = ?1").bind(email).run();
      await funnel(env, "confirm_mail_sent", src);
      return reply({ ok: true, pending: true, confirmation_sent: true });
    }
    // SUBSCRIBE-SEND-HONEST-1: the row stays pending and a retry sends again; the visitor is not told to check an inbox
    // that will stay empty.
    await funnel(env, "confirm_mail_failed", src);
    return reply({ ok: false, pending: true, confirmation_sent: false, error: "We could not send the confirmation email just now. Please try again in a few minutes." }, 502);
  } catch (e) {
    console.error(JSON.stringify({ event: "subscribe_failed", error: String(e && e.message || e).slice(0, 200) }));
    await funnel(env, "submit_error", src);
    return reply({ ok: false, error: "Sign-up failed. Please try again shortly." }, 500);
  }
}
__name(handleSubscribe, "handleSubscribe");
// SUBSCRIBE-CONFIRM-POST-1 (#1904): only a POST confirms; a GET (the emailed link, or a scanner fetching it) shows the button.
async function confirmToken(request, u) {
  let token = u.searchParams.get("token") || "";
  if (!token && request.method.toUpperCase() === "POST") {
    try {
      const ct = String(request.headers.get("Content-Type") || "").toLowerCase();
      if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
        const f = await request.formData();
        token = String(f.get("token") || "");
      } else if (ct.includes("application/json")) {
        const b = await request.json();
        token = String(b && b.token || "");
      }
    } catch (e) {
      token = "";
    }
  }
  return token;
}
__name(confirmToken, "confirmToken");
function confirmButtonPage(origin, token) {
  const action = origin + "/confirm?token=" + encodeURIComponent(token);
  return html('<h1>Confirm your subscription</h1><p>Press the button to receive the weekly digest of new QNFO papers: titles, links and DOIs. Nothing is sent until you do.</p><form method="post" action="' + escAttr(action) + '"><input type="hidden" name="token" value="' + escAttr(token) + '"><button type="submit" style="font:inherit;font-size:1rem;padding:.7rem 1.4rem;border:0;border-radius:8px;background:#24315e;color:#fff;cursor:pointer">Confirm subscription</button></form><p>If you did not ask for this, close this page; no email will follow.</p>');
}
__name(confirmButtonPage, "confirmButtonPage");
async function handleConfirm(request, env) {
  const u = new URL(request.url);
  const method = request.method.toUpperCase();
  const token = await confirmToken(request, u);
  if (!token) return html("<h1>Missing link</h1><p>This confirmation link is incomplete.</p>", 400);
  try {
    const row = await env.AUDIT.prepare("SELECT email, status FROM subscribers WHERE unsub_token = ?1").bind(token).first();
    if (!row) return html("<h1>Link not recognised</h1><p>This confirmation link is invalid.</p>", 404);
    if (row.status === "subscribed") {
      return html("<h1>Already confirmed</h1><p>Your subscription is active. The next digest will reach you by email.</p>");
    }
    if (method !== "POST") {
      await funnel(env, "confirm_page", "email");
      await logEvent(env, "subscribers-confirm", "page", "subscribers confirm page shown (" + emailDomain(row.email) + ")", { method, changed: 0, domain: emailDomain(row.email) });
      return confirmButtonPage(u.origin, token);
    }
    const r = await env.AUDIT.prepare(
      "UPDATE subscribers SET status='subscribed', confirmed_at=datetime('now'), updated_at=datetime('now') WHERE unsub_token = ?1"
    ).bind(token).run();
    await funnel(env, "confirmed", "email");
    await logEvent(env, "subscribers-confirm", "confirmed", "subscribers confirmed (" + emailDomain(row.email) + ")", { method, changed: Number(r && r.meta && r.meta.changes || 0), domain: emailDomain(row.email) });
    return html("<h1>Subscription confirmed</h1><p>You are on the list. The next digest of new QNFO papers will reach you by email.</p>");
  } catch (e) {
    return html("<h1>Something went wrong</h1><p>Please try again later.</p>", 500);
  }
}
__name(handleConfirm, "handleConfirm");
async function handleUnsubscribe(request, env) {
  const u = new URL(request.url);
  const token = u.searchParams.get("token") || "";
  if (!token) return html("<h1>Missing link</h1><p>This unsubscribe link is incomplete.</p>", 400);
  try {
    const r = await env.AUDIT.prepare(
      "UPDATE subscribers SET status='unsubscribed', updated_at=datetime('now') WHERE unsub_token = ?1"
    ).bind(token).run();
    const changed = r && r.meta && r.meta.changes ? r.meta.changes : 0;
    if (!changed) return html("<h1>Link not recognised</h1><p>This unsubscribe link is invalid or has already been used.</p>", 404);
    await funnel(env, "unsubscribed", "email");
    return html("<h1>You're unsubscribed</h1><p>You will not receive any further QNFO research digests.</p>");
  } catch (e) {
    return html("<h1>Something went wrong</h1><p>Please try again later.</p>", 500);
  }
}
__name(handleUnsubscribe, "handleUnsubscribe");
async function recordRun(env, since, now, papers, recipients, sent, failed, status, notes) {
  try {
    await env.AUDIT.prepare(
      "INSERT INTO subscriber_digest_runs (period_start, period_end, papers, recipients, sent, failed, status, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
    ).bind(since, now, papers, recipients, sent, failed, status, notes || null).run();
  } catch (e) {
  }
}
__name(recordRun, "recordRun");
async function runDigest(env, opts) {
  opts = opts || {};
  // WEEKLY-SIGNAL-1: a human-approved "claim, check, limits" issue for today's slot replaces the roll-up; a run with an explicit
  // window or start (an on-demand roll-up) keeps today's behaviour, and so does every week without an approved issue.
  if (!opts.since && !(Number(opts.windowDays) > 0)) {
    const sig = await signalForSlot(env);
    if (sig && (sig.status === "sent" || sig.status === "sending")) return { ok: true, skipped: "signal-already-sent", signal: sig.send_date };
    if (sig && sig.status === "approved") return signalSend(env, sig);
  }
  const windowDays = Number(opts.windowDays) > 0 ? Number(opts.windowDays) : DIGEST_WINDOW_DAYS;
  const since = opts.since || new Date(Date.now() - windowDays * 864e5).toISOString().slice(0, 19).replace("T", " ");
  const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
  let papers = [];
  try {
    const pr = await env.LIVING.prepare(
      "SELECT slug, title, created_at, doi FROM papers WHERE slug IS NOT NULL AND status NOT IN ('duplicate','kg-backfill','quarantined') AND created_at >= ?1 ORDER BY created_at DESC LIMIT " + PAPER_CAP
    ).bind(since).all();
    papers = pr && pr.results || [];
  } catch (e) {
    return { ok: false, error: "papers query failed: " + String(e && e.message || e) };
  }
  let subs = [];
  try {
    const sr = await env.AUDIT.prepare(
      // SUPPRESSION-AT-DIGEST-1 (1.1.7): /health promises "suppressed addresses are never mailed"; the digest now honours
      // email_suppression too (before, only sign-up did).
      "SELECT email, unsub_token FROM subscribers WHERE status='subscribed' AND NOT EXISTS (SELECT 1 FROM email_suppression es WHERE lower(es.email) = lower(subscribers.email)) ORDER BY created_at LIMIT " + MAX_RECIPIENTS
    ).all();
    subs = sr && sr.results || [];
  } catch (e) {
    return { ok: false, error: "subscribers query failed: " + String(e && e.message || e) };
  }
  if (!papers.length) {
    await recordRun(env, since, now, 0, subs.length, 0, 0, "skipped", "no new papers in window");
    return { ok: true, skipped: "no-new-papers", papers: 0, recipients: subs.length, sent: 0, failed: 0 };
  }
  if (!subs.length) {
    await recordRun(env, since, now, papers.length, 0, 0, 0, "skipped", "no confirmed subscribers");
    return { ok: true, skipped: "no-subscribers", papers: papers.length, recipients: 0, sent: 0, failed: 0 };
  }
  const subject = "QNFO research digest \u2014 " + papers.length + (papers.length === 1 ? " new paper" : " new papers");
  let sent = 0, failed = 0;
  const BATCH = 8;
  for (let i = 0; i < subs.length; i += BATCH) {
    const slice = subs.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(function(s) {
      return sendEmail(env, s.email, subject, digestText(papers, s.unsub_token), "digest", listUnsubscribeHeaders(s.unsub_token));
    }));
    for (let j = 0; j < results.length; j++) {
      if (results[j] && results[j].ok) sent++;
      else failed++;
    }
  }
  if (sent > 0) {
    try {
      await env.AUDIT.prepare(
        "UPDATE subscribers SET last_digest_at = datetime('now') WHERE status='subscribed'"
      ).run();
    } catch (e) {
    }
  }
  await recordRun(env, since, now, papers.length, subs.length, sent, failed, failed ? "partial" : "ok", null);
  return { ok: true, papers: papers.length, recipients: subs.length, sent, failed };
}
__name(runDigest, "runDigest");
// ---- WEEKLY-SIGNAL-1:BEGIN (RM-BS-WEEKLY-SIGNAL-1, blue-sky bet B16, pillar reach) ----
// One weekly "claim, check, limits" issue instead of a roll-up of every paper, with a human in the loop and the voice disclosed.
// The hourly tick drafts the issue for the next Sunday 16:00 UTC slot, by rule (no model call, no new binding), from papers
// published in the last seven days that have a plain-language summary and no open erratum: the claim is that summary, the
// check and the limits are quoted from the paper's own text, and a missing one is said to be missing. The draft is stored in
// qnfo-audit.weekly_signal_issues as 'draft' and mailed once to the owner with a review link. A GET on that link never changes
// anything (mail scanners fetch every link, as for /confirm); only its Approve or Reject button (POST) does. runDigest sends
// an approved issue to confirmed, non-suppressed subscribers and nobody else; with no approved issue it sends the paper
// roll-up exactly as before. There is no audio yet: the issue says so, and says the voice will be synthetic and labelled.
var OWNER_REVIEW_TO = "rwnquni@outlook.com";
var SIGNAL_HOST = "https://qnfo-subscribers.q08.workers.dev";
var SIGNAL_LEAD_MS = 96 * 36e5;
var SIGNAL_MAX_ITEMS = 3;
var SIGNAL_CANDIDATES = 30;
var SIGNAL_BODY_CHARS = 70000;
var SIGNAL_VOICE = "Audio edition: not yet published. When it is, the voice is synthetic and will be labelled as such.";
var SIGNAL_HOW = "How this issue was made: the text is drafted by rule from papers QNFO published in the past seven days (no language model is called in this step) and is read and approved by a human editor before it is sent. The Claim lines are QNFO's plain-language summaries, which a model wrote; the Check and Limits lines are quoted from the paper itself.";
var SIG_RE_EXPERIMENT = /^\*\*(?:\([a-z]\)\s*)?Smallest falsifying experiment\.?\*\*\s*/i;
var SIG_RE_FALSIFY = /^\*\*Falsification\.?\*\*\s*/i;
var SIG_RE_FALSIFY_H = /^#{2,4}[ \t]*(?:\d+(?:\.\d+)*\.?[ \t]*)?(?:Falsification|Falsifiability)\b[^\n]*$/im;
var SIG_RE_LIMITS = /^\*\*Limitations?[^*\n]{0,40}\*\*\s*/i;
var SIG_RE_LIMITS_ALT = /^\*\*What the results do and do not claim\.?\*\*\s*/i;
var SIG_SPLIT = /(?<!\b(?:e\.g|i\.e|vs|Fig|Figs|Sec|Eq|Eqs|Ref|Refs|cf|approx|al)\.)(?<=[.!?])\s+(?=[A-Z0-9("])/;
var SIG_RE_LIMITS_H = /^#{2,4}[ \t]*(?:\d+(?:\.\d+)*\.?[ \t]*)?Limitations?\b[^\n]*$/im;
// The Sunday 16:00 UTC slot at or after nowMs (the slot of the weekly digest cron), and its date.
function signalSlot(nowMs) {
  var d = new Date(nowMs);
  var base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16, 0, 0);
  var slot = base + ((7 - d.getUTCDay()) % 7) * 864e5;
  if (slot <= nowMs) slot += 7 * 864e5;
  return slot;
}
function signalDate(slotMs) {
  return new Date(slotMs).toISOString().slice(0, 10);
}
// Plain text from a markdown excerpt: no emphasis, links, citation numbers or formulas (a formula becomes "(formula)").
function sigClean(s) {
  return String(s == null ? "" : s).replace(/\r/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "(formula)").replace(/\$[^$\n]{1,200}\$/g, "(formula)")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*+|__|`/g, "")
    .replace(/\s*\[\d+(?:\s*[,;\u2013-]\s*\d+)*\]/g, "").replace(/\s+/g, " ").trim();
}
// Up to maxSent whole sentences within about maxChars; a sentence that still carries formula markup is left out.
function sigPick(text, maxChars, maxSent) {
  var sents = sigClean(text).split(SIG_SPLIT), out = [], len = 0;
  for (var i = 0; i < sents.length && out.length < maxSent; i++) {
    var s = sents[i].trim();
    if (!s || /[$\\]/.test(s) || (s.match(/\(formula\)/g) || []).length > 2) { if (out.length) break; continue; }
    if (out.length && len + s.length + 1 > maxChars) break;
    if (s.length > maxChars) s = s.slice(0, maxChars - 1).replace(/\s+\S*$/, "") + "\u2026";
    out.push(s);
    len += s.length + 1;
  }
  return out.join(" ");
}
// The paragraph that opens with a bold label (the way the QNFO paper template writes "**Falsification.**"), and the one after it.
function sigBlock(body, re) {
  var blocks = String(body || "").split(/\n[ \t]*\n/);
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i].trim(), m = re.exec(b);
    if (m) return { text: b.slice(m[0].length), next: blocks[i + 1] || "" };
  }
  return null;
}
// The first paragraph under a heading (older papers use headings instead of bold labels).
function sigHeading(body, re) {
  body = String(body || "");
  var m = re.exec(body);
  if (!m) return null;
  var blocks = body.slice(m.index + m[0].length).split(/\n[ \t]*\n/);
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i].trim();
    if (!b) continue;
    if (b.charAt(0) === "#") return null;
    return { text: b, next: blocks[i + 1] || "" };
  }
  return null;
}
function sigCheck(body) {
  var b = sigBlock(body, SIG_RE_EXPERIMENT) || sigBlock(body, SIG_RE_FALSIFY) || sigHeading(body, SIG_RE_FALSIFY_H);
  return b ? sigPick(b.text, 520, 3) : "";
}
function sigLimits(body) {
  var b = sigBlock(body, SIG_RE_LIMITS) || sigHeading(body, SIG_RE_LIMITS_H) || sigBlock(body, SIG_RE_LIMITS_ALT);
  if (!b) return "";
  var lead = sigClean(b.text), more = !lead || /:\s*$/.test(lead);
  var lines = (b.text + (more ? "\n" + b.next : "")).split("\n"), items = [];
  for (var i = 0; i < lines.length && items.length < 2; i++) {
    var m = /^\s*(?:\d+[.)]|[-*])\s+(.*)$/.exec(lines[i]);
    if (m) { var one = sigPick(m[1], 200, 1); if (one) items.push(one); }
  }
  if (items.length) return "Limits the paper states: (1) " + items[0] + (items[1] ? " (2) " + items[1] : "");
  return sigPick(b.text, 360, 2);
}
function sigNotChecked(body) {
  var m = /^[ \t]*[-*][ \t]*Not checked:[ \t]*([^\n]+)/im.exec(String(body || ""));
  return m ? sigPick(m[1], 360, 2) : "";
}
// One item of the issue from a paper row (slug, title, created_at, version, plain, grade), its body text and its open-erratum count.
function sigItem(p, body, errataOpen) {
  var check = sigCheck(body), limits = sigLimits(body), notChecked = sigNotChecked(body);
  return {
    slug: p.slug, title: String(p.title || "").replace(/\s+/g, " ").trim(), created_at: fmtDate(p.created_at), version: String(p.version || ""),
    claim: sigPick(p.plain, 420, 3), check: check, check_found: !!check, limits: limits, limits_found: !!limits, not_checked: notChecked,
    errata_open: errataOpen, grade: Number(p.grade) || 0
  };
}
function signalCompose(items, sendDate) {
  var lines = [];
  lines.push("QNFO weekly signal, " + sendDate);
  lines.push("");
  lines.push("Each item gives one claim, the check the paper itself proposes, and what it does not show. QNFO papers are machine-assisted preprints and are not independently peer-reviewed: read the limits before you rely on a claim.");
  lines.push("");
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    lines.push(i + 1 + ". " + it.title);
    lines.push("   Published " + it.created_at + (it.version ? ", version " + it.version : ""));
    lines.push("   Claim (plain-language summary, written by a model): " + (it.claim || "No summary available."));
    lines.push("   Check: " + (it.check_found ? it.check : "No falsification test or runnable check was found in the paper text; read the paper before you rely on this claim."));
    var lim = ["Not independently peer-reviewed.", it.errata_open === 0 ? "No open erratum is recorded." : "Open errata: " + it.errata_open + "."];
    if (it.limits_found) lim.unshift(it.limits); else lim.unshift("The paper has no limitations section that this step could read.");
    if (it.not_checked) lim.push("Not checked, per the paper's own provenance note: " + it.not_checked);
    lines.push("   Limits: " + lim.join(" "));
    lines.push("   Read: " + utmLink("/papers/" + it.slug, "digest", it.slug));
    lines.push("");
  }
  lines.push(SIGNAL_HOW);
  lines.push("");
  lines.push(SIGNAL_VOICE);
  return {
    subject: "QNFO weekly signal, " + sendDate + ": " + items.length + (items.length === 1 ? " claim" : " claims") + " with checks and limits",
    body: lines.join("\n")
  };
}
function signalPlaceholders(n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push("?" + (i + 1));
  return out.join(",");
}
// Draft the issue for sendDate. Returns { ok, drafted } or { ok, skipped } or { ok: false, error }; stores nothing when nothing qualifies.
async function signalDraft(env, nowMs, sendDate) {
  var since = new Date(nowMs - 7 * 864e5).toISOString().slice(0, 19).replace("T", " "), cands;
  try {
    var pr = await env.LIVING.prepare(
      "SELECT p.slug, p.title, p.created_at, p.version, p.paper_type, s.text AS plain, s.grade AS grade FROM papers p JOIN plain_summary s ON s.slug = p.slug " +
      "WHERE p.status IN ('published','distributed') AND p.slug IS NOT NULL AND p.created_at >= ?1 AND s.text != '' AND s.grade <= 12 AND s.rev LIKE 'pl1|' || p.version || '|%' " +
      "ORDER BY p.created_at DESC LIMIT " + SIGNAL_CANDIDATES
    ).bind(since).all();
    cands = pr && pr.results || [];
  } catch (e) {
    return { ok: false, error: "papers query failed: " + String(e && e.message || e).slice(0, 200) };
  }
  if (!cands.length) return { ok: true, skipped: "no-candidates", send_date: sendDate };
  var open = new Map();
  try {
    var er = await env.AUDIT.prepare(
      "SELECT target_ref, COUNT(*) AS n FROM internal_errata WHERE target_kind = 'paper' AND status = 'open' AND target_ref IN (" + signalPlaceholders(cands.length) + ") GROUP BY target_ref"
    ).bind(...cands.map(function (c) { return c.slug; })).all();
    var erl = er && er.results || [];
    for (var i = 0; i < erl.length; i++) open.set(String(erl[i].target_ref), Number(erl[i].n) || 0);
  } catch (e) {
    return { ok: false, error: "errata query failed: " + String(e && e.message || e).slice(0, 200) };
  }
  var clean = cands.filter(function (c) { return !open.get(String(c.slug)); }).slice(0, 12);
  if (!clean.length) return { ok: true, skipped: "all-candidates-have-open-errata", send_date: sendDate };
  var bodies = new Map();
  try {
    var br = await env.LIVING.prepare(
      "SELECT slug, substr(body_md, 1, " + SIGNAL_BODY_CHARS + ") AS b FROM papers WHERE slug IN (" + signalPlaceholders(clean.length) + ")"
    ).bind(...clean.map(function (c) { return c.slug; })).all();
    var brl = br && br.results || [];
    for (var j = 0; j < brl.length; j++) bodies.set(String(brl[j].slug), String(brl[j].b || ""));
  } catch (e2) {
    return { ok: false, error: "bodies query failed: " + String(e2 && e2.message || e2).slice(0, 200) };
  }
  var items = clean.map(function (c) { return sigItem(c, bodies.get(String(c.slug)) || "", 0); });
  // Rule-based order, not a quality judgement: papers that state both a check and their limits first, then the newest.
  var order = items.map(function (it, idx) { return { it: it, idx: idx, score: (it.check_found ? 2 : 0) + (it.limits_found ? 1 : 0) }; });
  order.sort(function (a, b) { return b.score - a.score || a.idx - b.idx; });
  items = order.slice(0, SIGNAL_MAX_ITEMS).map(function (o) { return o.it; });
  var text = signalCompose(items, sendDate);
  try {
    var ins = await env.AUDIT.prepare(
      "INSERT OR IGNORE INTO weekly_signal_issues (send_date, status, subject, body_text, items_json, voice_disclosure) VALUES (?1, 'draft', ?2, ?3, ?4, ?5)"
    ).bind(sendDate, text.subject, text.body, JSON.stringify(items), SIGNAL_VOICE).run();
    return { ok: true, drafted: Number(ins && ins.meta && ins.meta.changes || 0) === 1, send_date: sendDate, items: items.length, with_check: items.filter(function (x) { return x.check_found; }).length };
  } catch (e3) {
    return { ok: false, error: "insert failed: " + String(e3 && e3.message || e3).slice(0, 200) };
  }
}
// The review capability: an HMAC of the send date under SUBSCRIBERS_TOKEN, never the secret itself. Null when the secret is absent.
async function signalToken(env, sendDate) {
  if (!env.SUBSCRIBERS_TOKEN) return null;
  var key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(env.SUBSCRIBERS_TOKEN)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  var sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("signal-review|" + sendDate)));
  var out = "";
  for (var i = 0; i < 20; i++) out += sig[i].toString(16).padStart(2, "0");
  return out;
}
async function signalReviewUrl(env, sendDate) {
  var t = await signalToken(env, sendDate);
  return t ? SIGNAL_HOST + "/review?week=" + sendDate + "&token=" + t : null;
}
async function signalMailOwner(env, row) {
  var url = await signalReviewUrl(env, row.send_date);
  if (!url) return { ok: false, skipped: "no-review-key" };
  var text = [
    "A weekly-signal draft is waiting for your review. Nothing goes to subscribers unless you approve it.",
    "",
    "Review link (opening it changes nothing; the Approve and Reject buttons on that page do):",
    url,
    "",
    "Approve before Sunday " + row.send_date + " 16:00 UTC. If you do nothing, the paper roll-up goes out as before and this draft expires.",
    "The link is for you only.",
    "",
    "--- draft ---",
    "",
    row.body_text
  ].join("\n");
  var r = await sendEmail(env, OWNER_REVIEW_TO, "QNFO weekly signal draft for " + row.send_date + ": review before Sunday 16:00 UTC", text, "signal-review");
  try {
    if (r && r.ok) await env.AUDIT.prepare("UPDATE weekly_signal_issues SET owner_mailed_at = datetime('now'), mail_attempts = mail_attempts + 1 WHERE send_date = ?1").bind(row.send_date).run();
    else await env.AUDIT.prepare("UPDATE weekly_signal_issues SET mail_attempts = mail_attempts + 1 WHERE send_date = ?1").bind(row.send_date).run();
  } catch (e) {
  }
  return r && r.ok ? { ok: true, mailed: true } : { ok: false, error: String(r && r.error || "send failed").slice(0, 200) };
}
// The hourly step: expire what was never reviewed in time, draft inside the lead window, mail the owner once (three attempts at most).
async function signalTick(env, nowMs, opts) {
  nowMs = nowMs || Date.now();
  opts = opts || {};
  if (!env.AUDIT || !env.LIVING) return { ok: true, skipped: "no-binding" };
  var today = new Date(nowMs).toISOString().slice(0, 10), row;
  try {
    await env.AUDIT.prepare("UPDATE weekly_signal_issues SET status = 'expired', notes = 'not sent: the slot passed while the issue was ' || status WHERE status IN ('draft','approved') AND send_date < ?1").bind(today).run();
  } catch (e) {
    return { ok: false, error: "weekly_signal_issues unreadable: " + String(e && e.message || e).slice(0, 200) };
  }
  var slot = signalSlot(nowMs), sendDate = signalDate(slot);
  if (!opts.force && slot - nowMs > SIGNAL_LEAD_MS) return { ok: true, skipped: "outside-window", send_date: sendDate };
  try {
    row = await env.AUDIT.prepare("SELECT send_date, status, body_text, owner_mailed_at, mail_attempts FROM weekly_signal_issues WHERE send_date = ?1").bind(sendDate).first();
    if (!row) {
      var d = await signalDraft(env, nowMs, sendDate);
      if (!d.ok || !d.drafted) return d;
      await logEvent(env, "subscribers-signal", "drafted", "weekly signal drafted for " + sendDate, { send_date: sendDate, items: d.items, with_check: d.with_check });
      row = await env.AUDIT.prepare("SELECT send_date, status, body_text, owner_mailed_at, mail_attempts FROM weekly_signal_issues WHERE send_date = ?1").bind(sendDate).first();
    }
  } catch (e2) {
    return { ok: false, error: "signal tick failed: " + String(e2 && e2.message || e2).slice(0, 200) };
  }
  if (row && row.status === "draft" && !row.owner_mailed_at && Number(row.mail_attempts || 0) < 3 && !opts.noMail) {
    var m = await signalMailOwner(env, row);
    return { ok: m.ok, send_date: sendDate, status: row.status, owner_mail: m.ok ? "sent" : m.skipped || m.error };
  }
  return { ok: true, send_date: sendDate, status: row ? row.status : null };
}
async function signalBearerOk(request, env) {
  var token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return !!(env.SUBSCRIBERS_TOKEN && token && await safeEqual(token, env.SUBSCRIBERS_TOKEN));
}
// Send the approved issue for today's slot. The row is claimed ('sending') before the first mail, so a retry of the cron
// can never mail it twice; a crash mid-send leaves 'sending' and the issue is not resent. Subscribers only: confirmed, not suppressed.
async function signalSend(env, row) {
  var now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
  var claim = await env.AUDIT.prepare("UPDATE weekly_signal_issues SET status = 'sending' WHERE send_date = ?1 AND status = 'approved'").bind(row.send_date).run();
  if (!(claim && claim.meta && Number(claim.meta.changes) === 1)) return { ok: true, skipped: "signal-not-claimable" };
  var subs = [];
  try {
    var sr = await env.AUDIT.prepare(
      "SELECT email, unsub_token FROM subscribers WHERE status='subscribed' AND NOT EXISTS (SELECT 1 FROM email_suppression es WHERE lower(es.email) = lower(subscribers.email)) ORDER BY created_at LIMIT " + MAX_RECIPIENTS
    ).all();
    subs = sr && sr.results || [];
  } catch (e) {
    await env.AUDIT.prepare("UPDATE weekly_signal_issues SET status = 'approved' WHERE send_date = ?1 AND status = 'sending'").bind(row.send_date).run();
    return { ok: false, error: "subscribers query failed: " + String(e && e.message || e) };
  }
  var items = [];
  try { items = JSON.parse(row.items_json || "[]"); } catch (e) { items = []; }
  if (!subs.length) {
    await env.AUDIT.prepare("UPDATE weekly_signal_issues SET status = 'approved' WHERE send_date = ?1 AND status = 'sending'").bind(row.send_date).run();
    await recordRun(env, now, now, items.length, 0, 0, 0, "skipped", "weekly-signal " + row.send_date + ": no confirmed subscribers");
    return { ok: true, skipped: "no-subscribers", signal: row.send_date, recipients: 0, sent: 0, failed: 0 };
  }
  var sent = 0, failed = 0, BATCH = 8;
  for (var i = 0; i < subs.length; i += BATCH) {
    var results = await Promise.all(subs.slice(i, i + BATCH).map(function (s) {
      var text = row.body_text + "\n\nKnow someone who should read this? Forward this issue, or send them here:\n" + SITE + "/?utm_source=digest&utm_campaign=signal-forward\n\nUnsubscribe: " + unsubUrl(s.unsub_token) + "\n\n\u2014 QNFO";
      return sendEmail(env, s.email, row.subject, text, "digest", listUnsubscribeHeaders(s.unsub_token));
    }));
    for (var j = 0; j < results.length; j++) {
      if (results[j] && results[j].ok) sent++;
      else failed++;
    }
  }
  try {
    await env.AUDIT.prepare("UPDATE weekly_signal_issues SET status = 'sent', sent_at = datetime('now'), sent_count = ?1 WHERE send_date = ?2").bind(sent, row.send_date).run();
    if (sent > 0) await env.AUDIT.prepare("UPDATE subscribers SET last_digest_at = datetime('now') WHERE status='subscribed'").run();
  } catch (e) {
  }
  await recordRun(env, now, now, items.length, subs.length, sent, failed, failed ? "partial" : "ok", "weekly-signal " + row.send_date);
  await logEvent(env, "subscribers-signal", "sent", "weekly signal sent for " + row.send_date, { send_date: row.send_date, recipients: subs.length, sent: sent, failed: failed });
  return { ok: true, signal: row.send_date, items: items.length, recipients: subs.length, sent: sent, failed: failed };
}
// Today's slot decides: an approved issue is sent, a sent one is not followed by the roll-up, anything else falls through to the roll-up.
async function signalForSlot(env) {
  try {
    var today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    return await env.AUDIT.prepare("SELECT send_date, status, subject, body_text, items_json FROM weekly_signal_issues WHERE send_date = ?1").bind(today).first();
  } catch (e) {
    return null;
  }
}
function signalShell(o) {
  var t = escAttr(o.title), d = escAttr(o.description);
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>' + t + '</title><meta name="description" content="' + d + '">' +
    (o.robots ? '<meta name="robots" content="' + o.robots + '"><meta name="referrer" content="no-referrer">' : "") +
    (o.canonical ? '<link rel="canonical" href="' + escAttr(o.canonical) + '"><meta property="og:url" content="' + escAttr(o.canonical) + '">' : "") +
    '<meta property="og:title" content="' + t + '"><meta property="og:description" content="' + d + '"><meta property="og:type" content="website"><meta property="og:site_name" content="QNFO"><meta name="twitter:card" content="summary">' +
    '<style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#faf7f2;color:#1b1915;line-height:1.6}main{max-width:42rem;margin:0 auto;padding:1.5rem 1.1rem 3rem}h1{font-family:Georgia,serif;font-size:1.6rem;font-weight:600;line-height:1.25}p{margin:.8rem 0}a{color:#24315e;overflow-wrap:anywhere}.meta{color:#6b6558;font-size:.95rem}.issue p{overflow-wrap:anywhere}button{font:inherit;min-height:48px;min-width:48px;padding:.6rem 1.4rem;margin:.4rem .6rem .4rem 0;border-radius:8px;border:1px solid #24315e;background:#24315e;color:#fff;cursor:pointer}button.alt{background:#fff;color:#24315e}ul.list{padding-left:1.1rem}ul.list li{margin:.5rem 0}</style></head><body><main>' + o.body + '<p class="meta"><a href="' + SITE + '">qnfo.org</a></p></main></body></html>';
}
function signalHtml(body, status, extraHeaders) {
  return new Response(body, { status: status || 200, headers: Object.assign({ "Content-Type": "text/html; charset=utf-8" }, extraHeaders || {}) });
}
// Plain issue text as paragraphs; every address in it becomes a link.
function sigBodyHtml(text) {
  return String(text || "").split(/\n{2,}/).map(function (blk) {
    return "<p>" + escAttr(blk).replace(/\n/g, "<br>").replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" rel="noopener">$1</a>') + "</p>";
  }).join("");
}
// Public archive: sent issues only. A D1 error still answers 200 with the shell, so a probe on this page says nothing about D1 load.
async function handleSignalIndex(request, env) {
  var u = new URL(request.url), list = "", failed = false;
  try {
    var r = await env.AUDIT.prepare("SELECT send_date, subject, items_json FROM weekly_signal_issues WHERE status = 'sent' ORDER BY send_date DESC LIMIT 60").all();
    var rows = r && r.results || [];
    list = rows.length ? '<ul class="list">' + rows.map(function (x) {
      var n = 0;
      try { n = JSON.parse(x.items_json || "[]").length; } catch (e) { n = 0; }
      return '<li><a href="/signal/' + escAttr(x.send_date) + '">' + escAttr(x.subject) + '</a> <span class="meta">(' + escAttr(x.send_date) + ", " + n + (n === 1 ? " item" : " items") + ")</span></li>";
    }).join("") + "</ul>" : "<p>No issue has been sent yet. The first goes out after a human editor approves it.</p>";
  } catch (e) {
    failed = true;
    list = "<p>The archive cannot be read right now. Try again in a few minutes.</p>";
  }
  var body = "<h1>QNFO weekly signal</h1><p>One short issue a week: a claim from a QNFO paper, the check the paper itself proposes, and what it does not show. A human editor approves every issue before it is sent.</p>" + list +
    "<p>" + escAttr(SIGNAL_VOICE) + '</p><p class="meta">Sign up for the weekly signal at <a href="' + SITE + '/subscribe">qnfo.org/subscribe</a>. Subscribing uses a double opt-in and every issue carries an unsubscribe link.</p>';
  return signalHtml(signalShell({ title: "QNFO weekly signal", description: "A weekly issue from QNFO: one claim, the check the paper proposes, and its limits. Human-approved; any audio edition will use a labelled synthetic voice.", canonical: u.origin + "/signal", body: body }), 200, { "Cache-Control": failed ? "no-store" : "public, max-age=300" });
}
async function handleSignalIssue(request, env, sendDate) {
  var u = new URL(request.url), row = null;
  try {
    row = await env.AUDIT.prepare("SELECT send_date, subject, body_text FROM weekly_signal_issues WHERE send_date = ?1 AND status = 'sent'").bind(sendDate).first();
  } catch (e) {
    return signalHtml(signalShell({ title: "QNFO weekly signal", description: "QNFO weekly signal.", body: "<h1>QNFO weekly signal</h1><p>This issue cannot be read right now. Try again in a few minutes.</p>" }), 503, { "Cache-Control": "no-store" });
  }
  if (!row) return signalHtml(signalShell({ title: "Issue not found - QNFO weekly signal", description: "No such issue.", robots: "noindex", body: '<h1>Issue not found</h1><p>No sent issue has this date. <a href="/signal">All issues</a></p>' }), 404);
  var desc = sigPick(String(row.body_text).split("\n\n")[1] || row.subject, 200, 1) || row.subject;
  return signalHtml(signalShell({ title: row.subject, description: desc, canonical: u.origin + "/signal/" + row.send_date, body: '<p class="meta"><a href="/signal">All issues</a></p><div class="issue">' + sigBodyHtml(row.body_text) + "</div>" }), 200, { "Cache-Control": "public, max-age=300" });
}
function signalReviewPage(row, note, canAct) {
  var forms = "";
  if (canAct) {
    forms = '<form method="post" action="/review"><input type="hidden" name="week" value="' + escAttr(row.send_date) + '"><input type="hidden" name="token" value="' + escAttr(note.token) + '">' +
      (row.status === "draft" ? '<button type="submit" name="decision" value="approve">Approve</button>' : "") +
      '<button type="submit" name="decision" value="reject" class="alt">' + (row.status === "approved" ? "Withdraw approval" : "Reject") + "</button></form>";
  }
  var body = "<h1>Weekly signal for " + escAttr(row.send_date) + "</h1><p><strong>Status: " + escAttr(row.status) + "</strong>" + (note.message ? " &mdash; " + escAttr(note.message) : "") + "</p>" + forms +
    '<p class="meta">Nothing is sent unless the status is approved when the Sunday ' + escAttr(row.send_date) + ' 16:00 UTC slot arrives. Opening this page changes nothing.</p><h2>' + escAttr(row.subject) + '</h2><div class="issue">' + sigBodyHtml(row.body_text) + "</div>";
  return signalHtml(signalShell({ title: "Review the weekly signal " + row.send_date, description: "Owner review of the QNFO weekly signal draft.", robots: "noindex,nofollow", body: body }), 200, { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
}
function signalReviewError(title, text, status) {
  return signalHtml(signalShell({ title: title, description: title, robots: "noindex", body: "<h1>" + escAttr(title) + "</h1><p>" + escAttr(text) + "</p>" }), status, { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
}
async function handleSignalReview(request, env) {
  var u = new URL(request.url), method = request.method.toUpperCase(), week = u.searchParams.get("week") || "", token = u.searchParams.get("token") || "", decision = "";
  if (method === "POST") {
    try {
      var f = await request.formData();
      week = String(f.get("week") || week);
      token = String(f.get("token") || token);
      decision = String(f.get("decision") || "");
    } catch (e) {
      return signalReviewError("Bad request", "The form could not be read.", 400);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !/^[0-9a-f]{40}$/.test(token)) return signalReviewError("Link incomplete", "This review link is incomplete.", 400);
  var want = await signalToken(env, week);
  if (!want || !await safeEqual(token, want)) return signalReviewError("Link not recognised", "This review link is not valid.", 403);
  var row;
  try {
    row = await env.AUDIT.prepare("SELECT send_date, status, subject, body_text, drafted_at FROM weekly_signal_issues WHERE send_date = ?1").bind(week).first();
  } catch (e) {
    return signalReviewError("Something went wrong", "Please try again later.", 500);
  }
  if (!row) return signalReviewError("No such draft", "There is no issue for this date.", 404);
  var slotPassed = Date.now() >= Date.parse(week + "T16:00:00Z");
  var canAct = !slotPassed && (row.status === "draft" || row.status === "approved");
  var message = "";
  if (method === "POST") {
    if (!canAct) {
      message = slotPassed ? "the send slot has passed, so this issue can no longer be changed" : "this issue is already " + row.status;
    } else if (decision === "approve" && row.status === "draft") {
      var a = await env.AUDIT.prepare("UPDATE weekly_signal_issues SET status = 'approved', reviewed_at = datetime('now'), reviewed_by = 'owner-link' WHERE send_date = ?1 AND status = 'draft'").bind(week).run();
      message = Number(a && a.meta && a.meta.changes) === 1 ? "approved; it will be sent to confirmed subscribers at the Sunday slot" : "not changed";
      await logEvent(env, "subscribers-signal", "approved", "weekly signal approved for " + week, { send_date: week, drafted_at: row.drafted_at });
    } else if (decision === "reject") {
      var r = await env.AUDIT.prepare("UPDATE weekly_signal_issues SET status = 'rejected', reviewed_at = datetime('now'), reviewed_by = 'owner-link' WHERE send_date = ?1 AND status IN ('draft','approved')").bind(week).run();
      message = Number(r && r.meta && r.meta.changes) === 1 ? "rejected; the paper roll-up goes out as before" : "not changed";
      await logEvent(env, "subscribers-signal", "rejected", "weekly signal rejected for " + week, { send_date: week, drafted_at: row.drafted_at });
    } else {
      message = "no change was made";
    }
    row = await env.AUDIT.prepare("SELECT send_date, status, subject, body_text, drafted_at FROM weekly_signal_issues WHERE send_date = ?1").bind(week).first() || row;
    canAct = !slotPassed && (row.status === "draft" || row.status === "approved");
  }
  return signalReviewPage(row, { message: message, token: token }, canAct);
}
// ---- WEEKLY-SIGNAL-1:END ----
async function health(env) {
  let confirmed = null, pending = null;
  try {
    const r = await env.AUDIT.prepare("SELECT COALESCE(SUM(status='subscribed'),0) AS c, COALESCE(SUM(status='pending'),0) AS p, COUNT(*) AS total FROM subscribers").first();
    confirmed = r ? Number(r.c) : null;
    pending = r ? Number(r.p) : null;
  } catch (e) {
    confirmed = "err";
  }
  // WEEKLY-SIGNAL-1: the newest issue's date and state (no text, no address), so a read of /health shows whether a draft exists.
  let signal = null;
  try {
    const sg = await env.AUDIT.prepare("SELECT send_date, status FROM weekly_signal_issues ORDER BY send_date DESC LIMIT 1").first();
    signal = sg ? { send_date: sg.send_date, status: sg.status } : { send_date: null, status: "none" };
  } catch (e) {
    signal = { send_date: null, status: "unreadable" };
  }
  return json({
    status: "ok",
    worker: "qnfo-subscribers",
    version: VERSION,
    capabilities: ["subscribe", "double-opt-in", "unsubscribe", "weekly-digest", "subscribe-page", "funnel-counts", "weekly-signal"],
    weekly_signal_latest: signal,
    limitations: ["a weekly-signal issue is drafted by rule, mailed only to the owner for review, and sent to subscribers only after the owner approves it; with no approved issue the paper roll-up is sent", "no send before double opt-in", "a confirmation link confirms only when its page's button is pressed (POST); a GET never confirms", "the digest sends only on the Sunday 16:00 UTC cron or an authenticated POST /run/digest", "suppressed addresses are never mailed", "a pending address gets at most one confirmation mail an hour", "GET /funnel shows counts only; a view is counted only on this worker's /subscribe page or when a surface reports it"],
    subscribers: confirmed,
    pending,
    send_email: !!env.SEND_EMAIL,
    audit_db: !!env.AUDIT,
    living_db: !!env.LIVING
  });
}
__name(health, "health");
/* SUBSCRIBE-UTM-METRIC-1 (owner directive 2026-10-18, pillar reach): aggregate confirmed
 * subscribers by utm_campaign/utm_source into reach_signals so reach metrics can attribute
 * subscriber growth to the tagged link that drove it (closes UTM-CLICK-LEDGER-1 -> subscriber).
 * SUBSCRIBERS-ATTRIBUTION-CHAIN-1 (agent_issues 2899): the utm columns are ensured first (the cron read them before
 * any sign-up had added them), the rows are summed per entity_id (two sources under one campaign collided on the
 * primary key), quality is 'unknown' (the live CHECK allows human, bot, unknown; 'derived' refused every insert), and the
 * previous snapshot is deleted in the same batch as the inserts, so a failed insert cannot wipe it. */
async function writeSubscriberAttribution(env) {
  try {
    if (!env.AUDIT) return;
    await ensureSubscriberUtm(env);
    const rows = await env.AUDIT.prepare(
      "SELECT COALESCE(utm_campaign,'') AS camp, COALESCE(utm_source,'') AS src, COUNT(*) AS n FROM subscribers WHERE (confirmed_at IS NOT NULL OR status='subscribed') AND (utm_campaign != '' OR utm_source != '') GROUP BY utm_campaign, utm_source"
    ).all();
    const list = rows.results || [];
    const byId = new Map();
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const id = String(r.camp || r.src || "untagged").slice(0, 80);
      byId.set(id, (byId.get(id) || 0) + (Number(r.n) || 0));
    }
    const stmts = [env.AUDIT.prepare("DELETE FROM reach_signals WHERE source = 'subscriber-attribution'")];
    for (const [id, n] of byId) {
      stmts.push(env.AUDIT.prepare(
        "INSERT INTO reach_signals (date, source, channel, entity_type, entity_id, metric, value, quality, collected_at) VALUES (date('now'), 'subscriber-attribution', 'email', 'campaign', ?1, 'subscribers_confirmed_attributed', ?2, 'unknown', datetime('now'))"
      ).bind(id, n));
    }
    await env.AUDIT.batch(stmts);
  } catch (e) {
    console.error(JSON.stringify({ worker: "qnfo-subscribers", where: "writeSubscriberAttribution", error: String(e && e.message || e).slice(0, 200) }));
  }
}

var worker_default = {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    const p = u.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": SITE, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    }
    if (p === "/health" && method === "GET") return health(env);
    if (p === "/subscribe" && method === "POST") return handleSubscribe(request, env);
    if (p === "/subscribe" && method === "GET") return handleSubscribePage(request, env);
    if (p === "/funnel" && method === "GET") return handleFunnel(env);
    if (p === "/funnel/view" && method === "POST") return handleFunnelView(request, env);
    if (p === "/confirm" && (method === "GET" || method === "POST")) return handleConfirm(request, env);
    if (p === "/unsubscribe" && (method === "GET" || method === "POST")) return handleUnsubscribe(request, env);
    // WEEKLY-SIGNAL-1: the public archive of sent issues, and the owner's review page (a GET shows, a POST decides).
    if (p === "/signal" && method === "GET") return handleSignalIndex(request, env);
    const signalIssue = /^\/signal\/(\d{4}-\d{2}-\d{2})$/.exec(p);
    if (signalIssue && method === "GET") return handleSignalIssue(request, env, signalIssue[1]);
    if (p === "/review" && (method === "GET" || method === "POST")) return handleSignalReview(request, env);
    if (p === "/run/signal/draft" && method === "POST") {
      if (!await signalBearerOk(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
      let so = {};
      try {
        so = await request.json();
      } catch (e) {
        so = {};
      }
      return json(await signalTick(env, Date.now(), { force: !!so.force, noMail: !!so.noMail }));
    }
    if (p === "/run/digest" && method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "");
      if (!env.SUBSCRIBERS_TOKEN || !token || !await safeEqual(token, env.SUBSCRIBERS_TOKEN)) return json({ ok: false, error: "unauthorized" }, 401);
      let o = {};
      try {
        o = await request.json();
      } catch (e) {
        o = {};
      }
      return json(await runDigest(env, o));
    }
    if (p === "/" || p === "") {
      return html('<h1>QNFO subscribers</h1><p>Service endpoint. Sign up at <a href="' + SITE + '">' + SITE + "</a>.</p>");
    }
    return json({ error: "not found", path: p }, 404);
  },
  async scheduled(event, env, ctx) {
    return cronGridRun(env.AUDIT, event, ctx, CRON_GRID_CFG, function (ev, c) { return subscribersScheduled(ev, env, c); });
  }
};
function subscribersScheduled(event, env, ctx) {
    // CRON-ONLY-HEARTBEAT-1 (agent_issues 2397): the heartbeat row is written after the digest run, so it means "the scheduled run finished".
    ctx.waitUntil((async () => {
      let ok = 1;
      try {
        if (!event || !event.cron || event.cron === SUBSCRIBERS_DIGEST_CRON) {
          const r = await runDigest(env, {});
          if (r && r.ok === false) ok = 0;
        }
      } catch (e) {
        ok = 0;
        console.error(JSON.stringify({ event: "scheduled_digest_failed", error: String(e && e.message || e).slice(0, 200) }));
      }
      // WEEKLY-SIGNAL-1: the hourly tick drafts the next weekly signal inside its lead window and mails the owner the review link once.
      try {
        if (event && event.cron && event.cron !== SUBSCRIBERS_DIGEST_CRON) {
          const sr = await signalTick(env, Date.now(), {});
          if (sr && sr.ok === false) console.error(JSON.stringify({ event: "weekly_signal_tick_failed", error: String(sr.error || sr.owner_mail || "").slice(0, 200) }));
        }
      } catch (e) {
        console.error(JSON.stringify({ event: "weekly_signal_tick_threw", error: String(e && e.message || e).slice(0, 200) }));
      }
      try {
        await writeSubscriberAttribution(env);
      } catch (e) {
        console.error(JSON.stringify({ event: "subscriber_attribution_failed", error: String(e && e.message || e).slice(0, 200) }));
      }
      try {
        await d1Transient(() => env.AUDIT.prepare("INSERT INTO fleet_heartbeat (worker, version, ts, ok) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(worker) DO UPDATE SET version=excluded.version, ts=excluded.ts, ok=excluded.ok").bind("qnfo-subscribers", VERSION, (/* @__PURE__ */ new Date()).toISOString(), ok).run());
      } catch (e) {
        console.error(JSON.stringify({ event: "fleet_heartbeat_write_failed", error: String(e && e.message || e).slice(0, 200) }));
      }
    })());
}
var D1_TRANSIENT_RE = /D1_ERROR: (?:D1 DB (?:storage operation exceeded timeout|is overloaded|reset because)|Internal error (?:while starting up |in )?D1 DB storage|Network connection lost|Replica disconnected from primary)/i;
// CRON-D1-RETRY-1: run an idempotent D1 statement up to 4 times, backing off 200 ms, 400 ms, 800 ms, on a transient D1 error only.
async function d1Transient(fn) {
  for (var attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (attempt >= 3 || !D1_TRANSIENT_RE.test(String(e && e.message || e))) throw e;
      await new Promise(function (resolve) { setTimeout(resolve, 200 * Math.pow(2, attempt)); });
    }
  }
}
var SUBSCRIBERS_DIGEST_CRON = "0 16 * * 1";
// ---- CRON-GRID-1:BEGIN (owner directive 2026-10-19: "ALL CRON TICKS SHALL BE MEASURED IN 5-MINUTE INTERVALS, AND NO CRON
// SHALL EXECUTE LESS THAN ONCE EVERY HOUR. ALL CRON FAILURES/ERRORS SHALL BE TRIAGED AND REMEDIATED AUTOMATICALLY BY THE FLEET.")
// Cloudflare fires this worker only on triggers that repeat at least hourly, on minutes that are multiples of 5. A job that
// had its own slower trigger (daily, weekly, every 6 hours) keeps its cadence: it runs on the first grid fire after its old
// slot, and is retried on later fires while its last good run is older than its period plus 30 minutes, at most
// CRON_GRID_RETRIES times in a row; past that CRON-WATCH-1 (qnfo-audit fleet_tasks cron-watch) escalates it to the code loop.
// Every run is one cron_fire_log row (source worker:<name>, outcome ok, error or idle) that CRON-WATCH-1 reads. A job named
// retry: false (a send to people outside the fleet) runs only on its slot, so a failure is never repeated at a reader.
var CRON_GRID_RETRIES = 3;
function cronGridField(spec, v, lo, hi) {
  return String(spec).split(",").some(function (part) {
    var step = 1, sm = /^(.*)\/(\d+)$/.exec(part), a, b;
    if (sm) { part = sm[1]; step = Math.max(1, parseInt(sm[2], 10)); }
    if (part === "*") { a = lo; b = hi; }
    else if (part.indexOf("-") > 0) { a = parseInt(part, 10); b = parseInt(part.split("-")[1], 10); }
    else { a = parseInt(part, 10); b = sm ? hi : a; }
    return v >= a && v <= b && (v - a) % step === 0;
  });
}
// Cloudflare numbers weekdays 1 (Sunday) to 7 (Saturday) (CF-DOW, qnfo-fleet-control 2026-10-05).
function cronGridMatch(expr, d) {
  var f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return false;
  var domOk = cronGridField(f[2], d.getUTCDate(), 1, 31), dowOk = cronGridField(f[4], d.getUTCDay() + 1, 1, 7);
  var dayOk = f[2] !== "*" && f[4] !== "*" ? (domOk || dowOk) : (domOk && dowOk);
  return dayOk && cronGridField(f[0], d.getUTCMinutes(), 0, 59) && cronGridField(f[1], d.getUTCHours(), 0, 23) && cronGridField(f[3], d.getUTCMonth() + 1, 1, 12);
}
// True when expr had a slot in the window (sinceMs, untilMs].
function cronGridSlot(expr, sinceMs, untilMs) {
  for (var t = Math.floor(untilMs / 60000) * 60000; t > sinceMs; t -= 60000) if (cronGridMatch(expr, new Date(t))) return true;
  return false;
}
async function cronGridLog(db, worker, expr, startMs, outcome, note) {
  if (!db) return;
  try {
    await db.prepare("INSERT INTO cron_fire_log (cron_name, task_id, cron_expr, fired_at, fired_epoch_ms, outcome, source, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
      .bind(worker + "|" + expr, worker, expr, new Date(startMs).toISOString(), startMs, outcome, "worker:" + worker, String(note || "").slice(0, 500)).run();
  } catch (e) { console.error(JSON.stringify({ worker: worker, where: "cron-grid-log", error: String(e && e.message || e).slice(0, 200) })); }
}
async function cronGridDue(db, cfg, nowMs) {
  var out = [], lag = cfg.lagMin || 0;
  for (var i = 0; i < cfg.jobs.length; i++) {
    var j = cfg.jobs[i];
    if (cronGridSlot(j.cron, nowMs - (lag + cfg.tickMin) * 60000, nowMs - lag * 60000)) { out.push({ cron: j.cron, why: "slot" }); continue; }
    if (!db || !j.retry) continue;
    try {
      var name = cfg.worker + "|" + j.cron;
      var r = await db.prepare("SELECT COUNT(*) AS n, MAX(CASE WHEN outcome = 'ok' THEN fired_epoch_ms END) AS last_ok, SUM(CASE WHEN outcome = 'error' AND fired_epoch_ms > COALESCE((SELECT MAX(fired_epoch_ms) FROM cron_fire_log WHERE cron_name = ?1 AND outcome = 'ok'), 0) THEN 1 ELSE 0 END) AS fails FROM cron_fire_log WHERE cron_name = ?1").bind(name).first();
      if (r && Number(r.n) > 0 && Number(r.fails || 0) < CRON_GRID_RETRIES && nowMs - Number(r.last_ok || 0) > (j.periodMin + 30) * 60000) out.push({ cron: j.cron, why: "retry" });
    } catch (e) { console.error(JSON.stringify({ worker: cfg.worker, where: "cron-grid-due", error: String(e && e.message || e).slice(0, 200) })); }
  }
  return out;
}
// One run of the worker's own handler, awaited with its waitUntil work, logged with its outcome.
async function cronGridOne(db, worker, expr, why, ev, ctx, run) {
  var t0 = Date.now(), pending = [];
  var c = { waitUntil: function (p) { pending.push(Promise.resolve(p)); } };
  try {
    await run(ev, c);
    // Index loop, not allSettled: work a waitUntil promise adds while it runs is awaited too.
    var bad = null;
    for (var k = 0; k < pending.length; k++) { try { await pending[k]; } catch (e) { if (!bad) bad = e || new Error("waitUntil rejected"); } }
    if (bad) throw bad;
    await cronGridLog(db, worker, expr, t0, "ok", why + " " + (Date.now() - t0) + " ms");
  } catch (e) {
    await cronGridLog(db, worker, expr, t0, "error", why + ": " + String(e && e.message || e));
    throw e;
  }
}
// cfg: { worker, tick, tickMin, lagMin, jobs: [{ cron, periodMin, retry }], own: "self" | "none" | "<cron the tick runs as>", ownWhenDue }
async function cronGridRun(db, event, ctx, cfg, run) {
  var cron = String((event && event.cron) || "");
  var nowMs = Number(event && event.scheduledTime) || Date.now();
  if (cron !== cfg.tick) return cronGridOne(db, cfg.worker, cron || "manual", "fire", event, ctx, run);
  var due = await cronGridDue(db, cfg, nowMs), firstErr = null;
  for (var i = 0; i < due.length; i++) {
    try { await cronGridOne(db, cfg.worker, due[i].cron, due[i].why, { cron: due[i].cron, scheduledTime: nowMs, type: "scheduled" }, ctx, run); }
    catch (e) { if (!firstErr) firstErr = e; }
  }
  if (cfg.own === "none" || (due.length && cfg.ownWhenDue === false)) {
    if (!due.length) await cronGridLog(db, cfg.worker, cfg.tick, nowMs, "idle", "grid tick: no job due");
  } else {
    var ev = cfg.own && cfg.own !== "self" ? { cron: cfg.own, scheduledTime: nowMs, type: "scheduled" } : event;
    try { await cronGridOne(db, cfg.worker, cfg.tick, "tick", ev, ctx, run); } catch (e) { if (!firstErr) firstErr = e; }
  }
  if (firstErr) throw firstErr;
}
// ---- CRON-GRID-1:END ----
var CRON_GRID_CFG = {"worker": "qnfo-subscribers", "tick": "0 * * * *", "tickMin": 60, "jobs": [{"cron": "0 16 * * 1", "periodMin": 10080, "retry": true}], "own": "self"};

export {
  worker_default as default,
  funnelSummary,
  funnelSource,
  safeEqual,
  ensureSubscriberUtm,
  writeSubscriberAttribution,
  signalSlot,
  signalDate,
  signalTick,
  signalDraft,
  signalToken,
  sigPick,
  sigCheck,
  sigLimits
};
//# sourceMappingURL=worker.js.map