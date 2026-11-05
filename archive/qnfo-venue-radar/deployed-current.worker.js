// qnfo-venue-radar Worker - QNFO.LW.003 (2026-09-03)
// v1.0.0: multi-venue read radar - LessWrong + Alignment Forum (shared /api), EA Forum (RSS),
//         Hacker News (Algolia JSON).
// PURPOSE: fully-autonomous research-signal intake into qnfo-audit D1. Scans QNFO-relevant
//   keyword buckets (energy/compute efficiency, Landauer/thermodynamic limits, brain efficiency,
//   AI energy, quantum speed limits, PaQit/QNFO self-watch) across written-content venues that
//   expose machine-readable surfaces. NEVER emails (NO-FLEET-DIGESTS). Write surfaces on these
//   venues are human-gated by platform policy; this worker is the READ layer only.
// CAPABILITIES: per-bucket keyword search (LW/AF markdown API, HN Algolia JSON) + EA RSS sweep;
//   relevance 0-3; dedupe (UNIQUE venue+external_id+query); kill switch venue_radar_enabled;
//   >=6h run backoff; per-venue audit rows; self-doc /health; manual trigger /?run=1.
// DEPLOY: cd qnfo-workers/qnfo-venue-radar && wrangler d1 execute qnfo-audit --remote --file=migrations/001_venue_radar.sql && wrangler deploy
// CANONICAL SOURCE: github.com/QNFO/qnfo-workers -> qnfo-workers/qnfo-venue-radar/worker.js
var VERSION = "1.0.5";
const WORKER = "qnfo-venue-radar";

// QNFO research keyword buckets (extends LESSWRONG-INTEGRATION.md section 6 + events-radar DOMAINS)
const BUCKETS = [
  { code: "EFF", label: "energy efficiency computing", kws: ["energy efficiency computing", "energy-efficient computing", "joules per compute", "joules-per-compute", "energy per operation", "green computing", "energy efficiency"] },
  { code: "LAN", label: "thermodynamic limits computation", kws: ["landauer", "reversible computation", "reversible computing", "thermodynamic limits", "thermodynamics of computation", "erasure cost"] },
  { code: "BRA", label: "brain efficiency", kws: ["brain efficiency", "neuromorphic energy", "brain energy"] },
  { code: "AIE", label: "AI energy costs", kws: ["ai energy costs", "ai energy", "data center power", "compute efficiency", "energy costs ai", "ai winter energy"] },
  { code: "QNT", label: "quantum speed limit energy", kws: ["margolus-levitin", "margolus levitin", "quantum speed limit", "quantum energy bound", "quantum computation energy"] },
  { code: "SELF", label: "PaQit QNFO watch", kws: ["paqit", "qnfo", "joules per compute benchmark", "joules-per-compute-benchmark"] }
];

const LW_BASE = "https://www.lesswrong.com"; // AF shares the same API + corpus (RELATED-SITES-SURVEY v1.0)
const EA_FEED = "https://forum.effectivealtruism.org/feed.xml";
const HN_API = "https://hn.algolia.com/api/v1/search";

function nowIso() { return new Date().toISOString(); }
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
function stripHtml(s) { return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function clean(s) { return stripHtml(s).slice(0, 400); }
function escQ(s) { return encodeURIComponent(s); }

async function fetchText(url, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs || 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "QNFO-venue-radar/1.0 (+https://github.com/QNFO/qnfo-workers)" } });
    if (!r.ok) return { error: "http_" + r.status };
    return { text: await r.text() };
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 120) };
  } finally { clearTimeout(t); }
}

function relevanceFor(title, snippet, kws) {
  const tl = (title || "").toLowerCase(); const sl = (snippet || "").toLowerCase();
  if (kws.some(k => tl.includes(k))) return 3;
  if (kws.some(k => sl.includes(k))) return 2;
  return 1;
}

// ---- LessWrong / Alignment Forum markdown search parser -------------------------
function parseLwSearch(text, query, bucket) {
  const rows = [];
  const sec = text.split("## Posts")[1];
  if (!sec) return rows;
  const postsPart = sec.split("## ")[0];
  const lines = postsPart.split(/\r?\n/);
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^-\s*\[(.*?)\]\(\/api\/post\/([^)\s]+)\)\s*-\s*author:\s*(.*?)\s*\|\s*karma:\s*(-?\d+)\s*\|\s*date:\s*([\d\-: TZ]+)/);
    if (m) {
      if (cur) rows.push(cur);
      cur = { title: m[1], id: m[2], url: LW_BASE + "/api/post/" + m[2], author: m[3], karma: parseInt(m[4], 10) || 0, date: m[5].trim(), snippet: "" };
      continue;
    }
    if (cur && !/^[-*] \[/.test(line)) {
      cur.snippet = (cur.snippet ? cur.snippet + " " : "") + clean(line);
    }
  }
  if (cur) rows.push(cur);
  return rows.map(r => ({ ...r, query, topic: bucket.code, kind: "post", relevance: relevanceFor(r.title, r.snippet, bucket.kws), raw_hash: fnv1a(r.id + r.title) }));
}

// ---- EA Forum RSS parser ----------------------------------------------------------
function parseEaRss(text, query, bucket) {
  const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  const rows = [];
  for (const it of items) {
    const body = it[1];
    const title = clean((body.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "");
    if (!title) continue;
    const link = ((body.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "").trim();
    const guid = ((body.match(/<guid[^>]*>([\s\S]*?)<\/guid>/) || [])[1] || link || "").trim();
    const date = ((body.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "").trim();
    const desc = clean((body.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || "");
    const author = clean((body.match(/<dc:creator>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/dc:creator>/) || [])[1] || "");
    const extId = guid || link.split("/").pop() || fnv1a(title);
    rows.push({ title, id: String(extId).slice(0, 180), url: link, author, karma: 0, date, snippet: desc.slice(0, 300), query, topic: bucket.code, kind: "post", relevance: relevanceFor(title, desc, bucket.kws), raw_hash: fnv1a(String(extId) + title) });
  }
  return rows;
}

// ---- Hacker News Algolia JSON parser ---------------------------------------------
function parseHn(json, query, bucket) {
  const rows = [];
  try {
    const data = JSON.parse(json);
    for (const h of (data.hits || [])) {
      if (!h || !h.objectID) continue;
      const title = h.title || h.story_title || "";
      const url = h.url || ("https://news.ycombinator.com/item?id=" + h.objectID);
      const snippet = clean(String(h.story_text || h.comment_text || "").slice(0, 300));
      rows.push({ title, id: "hn_" + h.objectID, url, author: h.author || "", karma: h.points || 0, date: h.created_at || "", snippet, query, topic: bucket.code, kind: "post", relevance: relevanceFor(title, snippet, bucket.kws), raw_hash: fnv1a(h.objectID + title) });
    }
  } catch (e) { /* parse error -> empty */ }
  return rows;
}

// Yield assertion: fetched=0 is "empty" (source returned nothing / parser mismatch); fetched>0 with kept=0 is "dup-only" (all rows already stored, legitimate but visible).
function runStatus(err, fetched, kept) { return err ? "error" : fetched === 0 ? "empty" : kept === 0 ? "dup-only" : "ok"; }
function yieldNote(fetched, kept) { return fetched === 0 ? "fetched=0" : kept === 0 ? "fetched>0 kept=0 (all duplicates)" : ""; }

// ---- Radar run --------------------------------------------------------------------
async function run(env, forced) {
  const t0 = nowIso();
  const cfg = async (key) => {
    const r = await env.RADAR_DB.prepare("SELECT value FROM venue_radar_config WHERE key = ?").bind(key).first();
    return r ? r.value : null;
  };
  const setCfg = (key, value) => env.RADAR_DB.prepare("INSERT OR REPLACE INTO venue_radar_config (key, value, updated_at) VALUES (?, ?, ?)").bind(key, value, t0).run();

  const enabled = await cfg("venue_radar_enabled");
  if (enabled !== "1") {
    // VENUE-RADAR-DORMANT-1: a disabled kill switch used to skip silently, so the radar looked dormant with no trace. Record it (at most one row per 6h).
    try {
      const lastSkip = await env.RADAR_DB.prepare("SELECT run_at FROM venue_radar_runs WHERE status = 'skipped' ORDER BY id DESC LIMIT 1").first();
      if (!lastSkip || Date.now() - Date.parse(lastSkip.run_at) > 6 * 3600 * 1000) {
        await env.RADAR_DB.prepare("INSERT INTO venue_radar_runs (venue, kind, run_at, status, fetched, kept, detail) VALUES (?,?,?,?,?,?,?)")
          .bind("all", "kill-switch", t0, "skipped", 0, 0, "venue_radar_enabled=" + enabled).run();
      }
    } catch (e) { /* audit row is best-effort */ }
    return { ok: true, worker: WORKER, version: VERSION, skipped: "disabled", ts: t0 };
  }

  {
    const last = await cfg("last_run_utc");
    if (last) {
      const dt = Date.now() - Date.parse(last);
      if (!Number.isNaN(dt) && dt < 6 * 3600 * 1000 && !forced) return { ok: true, worker: WORKER, version: VERSION, skipped: "backoff", ts: t0 };
      if (!Number.isNaN(dt) && forced && dt < 5 * 60 * 1000) return { ok: true, worker: WORKER, version: VERSION, skipped: "too-frequent", ts: t0 };
    }
  }

  const INSERT = "INSERT OR IGNORE INTO venue_signal (venue, external_id, kind, title, author, url, karma, date, query, topic, snippet, relevance, raw_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
  const summary = [];

  // LW/AF: one search per bucket
  for (const b of BUCKETS) {
    const q = b.label;
    const url = LW_BASE + "/api/search?search=" + escQ(q);
    const f = await fetchText(url);
    let rows = [], err = null;
    if (f.error) err = f.error; else rows = parseLwSearch(f.text, q, b);
    let kept = 0;
    for (const r of rows) {
      const ins = await env.RADAR_DB.prepare(INSERT)
        .bind("lesswrong", r.id, r.kind, r.title, r.author, r.url, r.karma, r.date, r.query, r.topic, r.snippet, r.relevance, r.raw_hash, t0).run();
      if (ins && ins.meta && ins.meta.changes > 0) kept++;
    }
    summary.push({ venue: "lesswrong", bucket: b.code, fetched: rows.length, kept, err });
    await env.RADAR_DB.prepare("INSERT INTO venue_radar_runs (venue, kind, run_at, status, fetched, kept, detail) VALUES (?,?,?,?,?,?,?)")
      .bind("lesswrong", b.code, t0, runStatus(err, rows.length, kept), rows.length, kept, err || yieldNote(rows.length, kept)).run();
  }

  // EA Forum RSS sweep: keep only bucket-relevant rows
  {
    const f = await fetchText(EA_FEED);
    let rows = [], err = null;
    if (f.error) err = f.error; else {
      const b = { code: "RSS", kws: BUCKETS.flatMap(x => x.kws) };
      rows = parseEaRss(f.text, "ea-rss", b).filter(r => r.relevance >= 2);
    }
    let kept = 0;
    for (const r of rows) {
      const ins = await env.RADAR_DB.prepare(INSERT)
        .bind("eaforum", r.id, r.kind, r.title, r.author, r.url, r.karma, r.date, r.query, r.topic, r.snippet, r.relevance, r.raw_hash, t0).run();
      if (ins && ins.meta && ins.meta.changes > 0) kept++;
    }
    summary.push({ venue: "eaforum", bucket: "RSS", fetched: rows.length, kept, err });
    await env.RADAR_DB.prepare("INSERT INTO venue_radar_runs (venue, kind, run_at, status, fetched, kept, detail) VALUES (?,?,?,?,?,?,?)")
      .bind("eaforum", "rss", t0, runStatus(err, rows.length, kept), rows.length, kept, err || yieldNote(rows.length, kept)).run();
  }

  // Hacker News: Algolia per bucket
  for (const b of BUCKETS) {
    const q = b.label;
    const url = HN_API + "?query=" + escQ(q) + "&tags=story&hitsPerPage=8";
    const f = await fetchText(url);
    let rows = [], err = null;
    if (f.error) err = f.error; else rows = parseHn(f.text, q, b);
    let kept = 0;
    for (const r of rows) {
      const ins = await env.RADAR_DB.prepare(INSERT)
        .bind("hackernews", r.id, r.kind, r.title, r.author, r.url, r.karma, r.date, r.query, r.topic, r.snippet, r.relevance, r.raw_hash, t0).run();
      if (ins && ins.meta && ins.meta.changes > 0) kept++;
    }
    summary.push({ venue: "hackernews", bucket: b.code, fetched: rows.length, kept, err });
    await env.RADAR_DB.prepare("INSERT INTO venue_radar_runs (venue, kind, run_at, status, fetched, kept, detail) VALUES (?,?,?,?,?,?,?)")
      .bind("hackernews", b.code, t0, runStatus(err, rows.length, kept), rows.length, kept, err || yieldNote(rows.length, kept)).run();
  }

  await setCfg("last_run_utc", t0);
  await env.RADAR_DB.prepare("INSERT OR IGNORE INTO venue_radar_config (key, value, updated_at) VALUES ('review_due_at', '2026-10-03', ?)").bind(t0).run();

  return { ok: true, worker: WORKER, version: VERSION, ts: t0, summary };
}

export { parseLwSearch, parseEaRss, parseHn, relevanceFor };

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env, false)); },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" && url.searchParams.get("run") === "1") {
      try {
        const out = await run(env, true);
        return new Response(JSON.stringify({ ok: true, ...out }), { headers: { "content-type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, worker: WORKER, version: VERSION, error: String((e && e.message) || e).slice(0, 500), stack: String((e && e.stack) || "").slice(0, 1200) }), { status: 500, headers: { "content-type": "application/json" } });
      }
    }
    if (url.pathname === "/") {
      const rows = await env.RADAR_DB.prepare("SELECT venue, run_at, status, fetched, kept FROM venue_radar_runs ORDER BY id DESC LIMIT 20").all();
      const cnt = await env.RADAR_DB.prepare("SELECT COUNT(*) AS n FROM venue_signal").first();
      return new Response(JSON.stringify({ worker: WORKER, version: VERSION, signal_rows: cnt ? cnt.n : 0, runs: rows.results || [] }), { headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: WORKER, version: VERSION, capabilities: ["lesswrong-alignmentforum-radar", "ea-forum-radar", "hacker-news-radar"], limitations: ["public feeds only; one daily scan at 06:45 (GET /?run=1 triggers one on demand)", "keyword matching, no model call"], purpose: "multi-venue read radar (LW/AF + EA RSS + HN Algolia) -> qnfo-audit D1", sources: ["lesswrong/alignmentforum", "eaforum-rss", "hackernews-algolia"], schedule: "45 6 * * * UTC", canonical: "github.com/QNFO/qnfo-workers/qnfo-venue-radar" }), { headers: { "content-type": "application/json" } });
    }
    return new Response("qnfo-venue-radar: GET / (status) | GET /?run=1 (trigger scan) | GET /health", { status: 404 });
  }
};
