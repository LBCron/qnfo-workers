var VERSION = "0.6.1-oauth";
/* 0.4.1: new Shorts descriptions include the QNFO channel context. */ /* #5479, pillar reach: authenticated re-consent and code exchange with the stored OAuth client. */ /* 0.3.0 YT-6 (2026-10-28, pillar reach; minor: a data product; agent_issues 1000597): views and average view duration of each uploaded Short are read hourly from the YouTube Data and Analytics APIs into youtube_videos (views, avg_view_duration_s) and metric youtube_avg_view_duration_s; without the extra owner consent (human_actions yt-analytics-consent) the read is refused, recorded as youtube.retention_scope and nothing is written. */ /* 0.2.1 HEALTH-CONTRACT-1 (2026-10-28, pillar autonomy; patch; agent_issues 2852): /health declares capabilities[] and limitations[], so capability_contract_conformance counts this worker. */ /* 0.2.0 YT-QUALITY-1 (2026-10-28, pillar reach; minor: new capabilities): the Shorts stop looking alike and sounding flat. Voice: Workers AI Deepgram Aura 2 (more natural than melotts, which stays as the per-sentence fallback). Director: four new templates (bignum, flow, compare, list) beside the old ones, rules for speech-written narration (contractions, short sentences, pitch-bearing punctuation, no spoken URL) and for variety (at least four kinds, never one kind three times). Render image: scene fitted to a safe width so nothing leaves the frame, five themes (palette plus animated background) chosen per paper, captions measured in the real font and chunked at phrases in the Shorts safe zone, loudness-normalised audio, an AI-generated mp4 comment tag and provenance.json (BP26-AI-ACT-ART50-1). Closing line no longer speaks a URL. Sources: scripts/youtube_poc (YT-POC-3/4), docs/YOUTUBE-PIPELINE.md. */ /* prior: 0.1.5 */ /* 0.1.5 YT-MANIM-PIN-1 (2026-10-27, pillar reach; patch): the render image pins manim 0.22.0, the version the scene was tested on; 0.18.1 has no Scene.time and the first container render failed with that AttributeError (visible since 0.1.4 returns the Manim stderr). */ /* prior: 0.1.4 */ /* 0.1.4 YT-RENDER-ERR-1 (2026-10-27, pillar reach; patch): the render container returns the Manim stderr tail when Manim fails (the first live render failed with only a traceback of the wrapper). */ /* prior: 0.1.3 */ /* 0.1.3 YT-DIRECTOR-1 (2026-10-27, pillar reach; patch): the director takes the first reply that holds a beats array from qnfo-ai, then Workers AI kimi, then gpt-oss, and a failure note quotes each reply (the first live run failed with "no JSON in model reply" from one model). */ /* prior: 0.1.2 */ /* 0.1.2 YT-EXPORTS-1 (2026-10-27, pillar reach; patch): wrangler.toml declares RenderContainer in `exports` instead of `migrations`, so a deploy after a secrets write through the script API is accepted and re-attaches the container (the pilot incident 1485 class). */ /* prior: 0.1.1 */ /* 0.1.1 YT-RUN-SYNC-1 (2026-10-27, pillar reach; patch): POST /run did its pass inside ctx.waitUntil, which a fetch handler loses 30 s after the response, so a manual run died at the director; it now awaits one bounded pass (budget_s, default 80, under the edge 100 s limit) and returns the row states. */ /* prior: 0.1.0 */ /* 0.1.0 YT-SERVER-1 (2026-10-27, pillar reach; minor: a new worker): the plain-language paper to YouTube Short pipeline runs on Cloudflare only. One hourly tick takes the newest plain_article (living-paper, status ok) with no youtube_videos row (cap 2 videos a week), an LLM director writes the beats, a second model family and a number check drop any beat the article does not support, Workers AI TTS speaks each sentence, a Cloudflare Container renders 1080x1920 with Manim, word-timed captions and the visible AI-narration tag into R2, and videos.insert uploads it (public by default, owner directive 2026-10-27) with containsSyntheticMedia. */
// WORKERS-AI-ATTRIBUTION-1 (2026-10-01, #1681): per-worker Workers AI attribution. Returns a shallow env copy whose AI
// binding records each .run() (calls, errors, ms, tokens, neurons) into qnfo-audit ai_call_counters (purpose 'binding').
// Neurons = usage tokens x Cloudflare's published per-model rates (neurons per M tokens). Fail-soft; env is never mutated.
var __AI_ATTR_RATES = { "@cf/zai-org/glm-5.3": [127273, 400000], "@cf/zai-org/glm-5.3-flash": [13636, 45455], "@cf/nvidia/nemotron-3-120b-a12b": [45455, 136364], "@cf/moonshotai/kimi-k2.6": [86364, 363636], "@cf/moonshotai/kimi-k2.7-code": [86364, 363636], "@cf/openai/gpt-oss-120b": [31818, 68182], "@cf/openai/gpt-oss-20b": [18182, 27273], "@cf/deepseek-ai/deepseek-v4-pro-0813": [120000, 360000], "@cf/deepseek-ai/deepseek-v4-flash-0731": [40000, 120000], "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [26668, 204805], "@cf/qwen/qwen3-30b-a3b-fp8": [4625, 30475], "@cf/qwen/qwen3.8-27b": [40909, 290909], "@cf/baai/bge-base-en-v1.5": [6058, 0], "@cf/baai/bge-small-en-v1.5": [1841, 0], "@cf/baai/bge-large-en-v1.5": [18582, 0] };
function __aiAttrEnv(env, worker, aiKey, dbKey) {
  try {
    if (!env || env.__aiAttr) return env;
    var ai = env[aiKey], db = env[dbKey];
    if (!ai || typeof ai.run !== "function" || !db) return env;
    var wrapped = new Proxy(ai, { get: function (t, p) {
      if (p !== "run") { var v = Reflect.get(t, p); return typeof v === "function" ? v.bind(t) : v; }
      return async function (model, input, opts) {
        var t0 = Date.now(), ok = 1, res;
        try { res = await t.run(model, input, opts); return res; } catch (e) { ok = 0; throw e; }
        finally {
          try {
            var u = res && typeof res === "object" && res.usage || {};
            var chars = 0; try { chars = JSON.stringify(input && (input.messages || input.prompt || input.text) || input || "").length; } catch (e1) {}
            var inTok = Number(u.prompt_tokens || u.input_tokens || 0) || Math.round(chars / 4);
            var outTok = Number(u.completion_tokens || u.output_tokens || 0);
            var r = __AI_ATTR_RATES[String(model)] || [0, 0];
            var neurons = (inTok * r[0] + outTok * r[1]) / 1e6;
            await db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, in_chars, ms, in_tok, out_tok, neurons) VALUES (?1,?2,'binding',?3,1,?4,?5,?6,?7,?8,?9) ON CONFLICT(day, worker, purpose, model) DO UPDATE SET calls=calls+1, errors=errors+excluded.errors, in_chars=in_chars+excluded.in_chars, ms=ms+excluded.ms, in_tok=in_tok+excluded.in_tok, out_tok=out_tok+excluded.out_tok, neurons=neurons+excluded.neurons")
              .bind(new Date().toISOString().slice(0, 10), worker, String(model).slice(0, 120), ok ? 0 : 1, chars, Date.now() - t0, inTok, outTok, neurons).run();
          } catch (e2) {}
        }
      };
    } });
    var copy = Object.assign({}, env);
    copy[aiKey] = wrapped;
    copy.__aiAttr = 1;
    return copy;
  } catch (e) {
    return env;
  }
}
// Owner directive 2026-10-27: "all of this needs to run 100% server-side on Cloudflare Quniverse". docs/YOUTUBE-PIPELINE.md has the design.
// State machine per paper (D1 qnfo-audit.youtube_videos.state): queued -> directed -> audio -> rendering -> rendered -> uploaded;
// terminal: rejected (director left too few supported beats), failed (4 attempts), uploaded. Every tick resumes an unfinished row before
// it starts a new paper, so a slow render or a missing credential never loses work (state and artifacts live in D1 and R2).
// Secrets (wrangler secret put, under the deploy-guard secret lock): YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN, YT_RUN_TOKEN.
var WORKER = "qnfo-youtube-shorts";
var YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"];
var CRON_TABLE = ["0 * * * *"]; // CRON-SINGLE-TRIGGER-1: one hourly trigger; every entry runs once in the hour it fires
// YT-CAP-1: the cap was never a cost limit (a Short costs about USD 0.10 and the month stop is SPEND_STOP_USD); it was a pacing guess to stay clear of YouTube's templated-content policy
// while the Shorts were poor. Owner directive 2026-11-04: many short Shorts, started now. 28 a week is 4 a day, inside the Data API quota (1,600 units per upload of 10,000 a day).
var WEEKLY_CAP = 28;
// YT-UPGRADE-1: Shorts uploaded before this instant came from the old director and voice (0.4.x); they are re-made in the new quality, ahead of any new paper.
var UPGRADE_EPOCH = "2026-11-04T21:07:00Z";
var MAX_ATTEMPTS = 4;
var PRIVACY = "public"; // owner directive 2026-10-27: "ALL VIDEOS/SHORTS SHALL BE PUBLIC BY DEFAULT". An API project that has not passed the YouTube audit is forced to private by YouTube; the privacy YouTube returns is what the ledger stores.
var BASE = "https://papers.qnfo.org";
var TTS_MODEL = "@cf/myshell-ai/melotts"; // fallback voice
var TTS_PRIMARY = "@cf/deepgram/aura-2-en"; // YT-QUALITY-1: the more natural voice; $0.03 per 1000 characters
var TTS_SPEAKER = "luna";
var CHECK_MODEL = "@cf/openai/gpt-oss-120b";
var WRITE_FALLBACK_MODEL = "@cf/moonshotai/kimi-k2.6";
var KINDS = ["hook", "versus", "payoff", "meter", "dots", "points", "stat", "bignum", "flow", "compare", "list"];
var MAX_NARR_WORDS = 150; // about 55 seconds at the voice's pace; a Short is under 60 s
var MIN_CONTENT_BEATS = 3;
var RENDER_POLLS = 40; // x 15 s inside one tick
// COST-CAP (owner 2026-10-27: at most USD 50 a month added expense, all-in; hard stop at SPEND_STOP_USD). Rates are list prices used as ESTIMATES;
// youtube_spend stores units next to usd so the rates can be corrected from measured runs (docs/YOUTUBE-PIPELINE.md cost model).
var SPEND_STOP_USD = 45;
var PRICES = { neuron_usd: 0.011 / 1000, tts_neurons_per_char: 1.0, tts_aura_usd_per_char: 0.00003, llm_neurons_per_call: 3000, container_vcpu_s: 0.000020, container_gib_s: 0.0000025, container_vcpu: 1, container_gib: 6 };
var NUM_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1000000 };

function json(data, status) {
  return new Response(JSON.stringify(data, null, 2), { status: status || 200, headers: { "content-type": "application/json; charset=utf-8" } });
}
function safeEqual(a, b) {
  var x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  var d = 0;
  for (var i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function b64FromBytes(u8) {
  var s = "", i = 0;
  for (; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- pure helpers (tested in youtube.test.mjs) ----------
function splitSentences(text) {
  return String(text || "").replace(/\s+/g, " ").trim().split(/(?<=[.?!])\s+/).filter(Boolean);
}
function numTokens(text) {
  // digits ("350", "10,000", "2.5") and spelled numbers in text order: every number word on its own ("six in ten" is 6 and 10) and
  // composed runs ("three hundred and fifty" is also 350, "ten thousand three hundred" 10300). Punctuation ends a run.
  var t = String(text || "").toLowerCase().replace(/(\d),(\d{3})/g, "$1$2");
  var out = [], total = 0, group = 0, active = false, lastScale = false, words = 0;
  var flush = function () { if (active && words > 1) out.push(String(total + group)); total = 0; group = 0; active = false; lastScale = false; words = 0; };
  (t.match(/\d+(?:\.\d+)?|[a-z]+|[^a-z\d\s]/g) || []).forEach(function (w) {
    if (/^\d/.test(w)) { flush(); out.push(String(parseFloat(w))); return; }
    if (Object.prototype.hasOwnProperty.call(NUM_WORDS, w)) {
      var v = NUM_WORDS[w];
      out.push(String(v));
      active = true; words++;
      if (v === 100) { group = (group || 1) * 100; lastScale = true; }
      else if (v >= 1000) { total += (group || 1) * v; group = 0; lastScale = true; }
      else { group += v; lastScale = false; }
    } else if (w === "and" && active && lastScale) {
      return;   // "three hundred AND fifty" continues a number; "three and ten" does not
    } else {
      flush();
    }
  });
  flush();
  return out;
}
function beatStrings(b) {
  var out = [b.narr];
  ["lines", "items"].forEach(function (k) { if (Array.isArray(b[k])) b[k].forEach(function (x) { out.push(x); }); });
  ["left", "right", "value", "label", "need_label", "have_label", "axis_label", "verdict", "a", "b"].forEach(function (k) { if (typeof b[k] === "string") out.push(b[k]); });
  ["title", "sub"].forEach(function (k) { if (typeof b[k] === "string") out.push(b[k]); });
  if (typeof b.value === "number") out.push(String(b.value));
  if (Array.isArray(b.nodes)) b.nodes.forEach(function (x) { out.push(x); });
  if (Array.isArray(b.items)) b.items.forEach(function (x) { if (Array.isArray(x)) { if (typeof x[0] === "string") out.push(x[0]); if (typeof x[3] === "string") out.push(x[3]); } });
  if (Array.isArray(b.bars)) b.bars.forEach(function (r) { if (Array.isArray(r) && typeof r[3] === "string") out.push(r[3]); });
  return out.filter(function (x) { return typeof x === "string"; });
}
function articleText(article) {
  var parts = [article.title || "", article.short || ""];
  (article.sections || []).forEach(function (s) { parts.push(s.h || ""); (s.paras || []).forEach(function (p) { parts.push(p); }); });
  return parts.join("\n");
}
function shapeOk(b) {
  if (!b || typeof b !== "object" || KINDS.indexOf(b.kind) < 0 || typeof b.narr !== "string" || !b.narr.trim()) return false;
  var strs = function (a, n) { return Array.isArray(a) && a.length >= 1 && a.length <= n && a.every(function (x) { return typeof x === "string" && x.length <= 60; }); };
  var s = function (x) { return typeof x === "string" && x.length > 0 && x.length <= 60; };
  var n01 = function (x) { return typeof x === "number" && x >= 0 && x <= 1; };
  switch (b.kind) {
    case "hook": return strs(b.lines, 6) && (b.hi === undefined || (Array.isArray(b.hi) && b.hi.every(function (i) { return Number.isInteger(i) && i >= 0 && i < b.lines.length; })));
    case "versus": return s(b.left) && s(b.right);
    case "payoff": return Array.isArray(b.bars) && b.bars.length >= 2 && b.bars.length <= 3 && b.bars.every(function (r) { return Array.isArray(r) && r.length === 4 && typeof r[1] === "number" && Math.abs(r[1]) <= 3 && s(r[3]); });
    case "meter": return n01(b.need) && n01(b.have) && s(b.need_label) && s(b.have_label) && s(b.axis_label) && s(b.verdict);
    case "dots": return n01(b.from) && n01(b.to) && s(b.a) && s(b.b);
    case "points": return strs(b.items, 4);
    case "stat": return s(b.value) && s(b.label);
    case "bignum": return typeof b.value === "number" && isFinite(b.value) && s(b.label) && (b.frac === undefined || n01(b.frac)) && (b.sub === undefined || s(b.sub));
    case "flow": return Array.isArray(b.nodes) && b.nodes.length >= 2 && b.nodes.length <= 4 && b.nodes.every(function (x) { return typeof x === "string" && x.length > 0 && x.length <= 28; });
    case "compare": return Array.isArray(b.items) && b.items.length >= 2 && b.items.length <= 3 && b.items.every(function (r) { return Array.isArray(r) && r.length === 4 && s(r[0]) && n01(r[1]) && s(r[3]); });
    case "list": return strs(b.items, 4) && b.items.length >= 2;
  }
  return false;
}
// Drops every beat whose shape is wrong or whose numbers are not in the article; unsupportedIdx (from the checker model) drops the rest.
function validateBeats(beats, article, unsupportedIdx) {
  var known = {};
  numTokens(articleText(article)).forEach(function (t) { known[t] = 1; });
  var kept = [], dropped = [], words = 0;
  (Array.isArray(beats) ? beats : []).forEach(function (b, i) {
    if (!shapeOk(b)) { dropped.push({ i: i, why: "shape" }); return; }
    if ((unsupportedIdx || []).indexOf(i) >= 0) { dropped.push({ i: i, why: "claim-not-in-article" }); return; }
    var bad = numTokens(beatStrings(b).join(" \n ")).filter(function (t, k, arr) { return !known[t] && arr.indexOf(t) === k; });
    if (bad.length) { dropped.push({ i: i, why: "number-not-in-article", numbers: bad }); return; }
    var w = b.narr.trim().split(/\s+/).length;
    if (words + w > MAX_NARR_WORDS) { dropped.push({ i: i, why: "too-long" }); return; }
    words += w;
    kept.push(b);
  });
  return { kept: kept, dropped: dropped, words: words };
}
function monthKey(d) { return (d || new Date()).toISOString().slice(0, 7); }
function spendUsd(kind, units) {
  if (kind === "tts") return units * PRICES.tts_neurons_per_char * PRICES.neuron_usd;
  if (kind === "tts_aura") return units * PRICES.tts_aura_usd_per_char;
  if (kind === "llm") return units * PRICES.llm_neurons_per_call * PRICES.neuron_usd;
  if (kind === "container") return units * (PRICES.container_vcpu * PRICES.container_vcpu_s + PRICES.container_gib * PRICES.container_gib_s);
  return 0;
}
function spendAllows(monthUsd) { return monthUsd < SPEND_STOP_USD; }
function capAllows(startedLast7d) { return startedLast7d < WEEKLY_CAP; }
// YT-17: of the newest plain articles, make the Short for the paper outsiders already read (external-referrer loads, then all page views in 30 days from paper_readership);
// papers with no reading data keep their newest-first order, and a failed read leaves the order untouched.
function rankByInterest(rows, readership) {
  var m = {};
  (readership || []).forEach(function (r) { if (r && r.slug) m[r.slug] = r; });
  var score = function (x) { var r = m[x.slug]; return r ? [Number(r.ext_30d) || 0, Number(r.pv_30d) || 0] : [0, 0]; };
  return rows.map(function (r, i) { return { r: r, i: i, s: score(r) }; }).sort(function (a, b) { return (b.s[0] - a.s[0]) || (b.s[1] - a.s[1]) || (a.i - b.i); }).map(function (x) { return x.r; });
}
// YT-UPGRADE-1: papers whose Short came from the old pipeline go before new papers (stable order inside each group).
function upgradesFirst(rows, oldSlugs) {
  var o = oldSlugs || {};
  return rows.filter(function (r) { return o[r.slug]; }).concat(rows.filter(function (r) { return !o[r.slug]; }));
}
function nextCandidate(rows, takenSlugs) {
  var taken = {};
  (takenSlugs || []).forEach(function (s) { taken[s] = 1; });
  for (var i = 0; i < rows.length; i++) if (!taken[rows[i].slug]) return rows[i];
  return null;
}
function parseSections(body) {
  try { var a = JSON.parse(body); return Array.isArray(a) ? a.filter(function (s) { return s && Array.isArray(s.paras); }) : []; } catch (e) { return []; }
}
function jsonFromText(t) {
  var s = String(t || "").replace(/<think>[\s\S]*?<\/think>/g, "");
  var a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON in model reply");
  return JSON.parse(s.slice(a, b + 1));
}
function buildMetadata(article, slug, title, durationS) {
  var url = BASE + "/papers/" + slug + "/quickread";
  return {
    title: (String(title || article.title).slice(0, 80) + " #Shorts").slice(0, 100),
    description: "Living papers and an open knowledge graph from the QNFO autonomous research fleet — https://qnfo.org\n\n" +
      String(article.short || "").slice(0, 600) + "\n\nFull plain-language article (no jargon, no mathematics): " + url + "\nPaper: " + BASE + "/papers/" + slug +
      "\n\nAI disclosure: the voice is synthetic (text-to-speech) and the animations are generated from the plain-language version of a QNFO paper.\n#Shorts #science #research",
    tags: ["Shorts", "science", "research explained", "QNFO"], categoryId: "27", privacyStatus: PRIVACY, containsSyntheticMedia: true, madeForKids: false, duration_s: durationS
  };
}

// ---------- ledger ----------
async function logEvent(env, kind, text, meta, status) {
  try {
    await env.QNFO_AUDIT.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), nowIso(), String(kind).slice(0, 200), String(text || "").slice(0, 2000), meta ? JSON.stringify(meta).slice(0, 4000) : null, WORKER, status || "ok").run();
  } catch (e) { console.error(JSON.stringify({ worker: WORKER, where: "logEvent", error: String(e && e.message || e) })); }
}
async function addSpend(env, rowId, kind, units, note) {
  try {
    await env.QNFO_AUDIT.prepare("INSERT INTO youtube_spend (month, row_id, kind, units, usd, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(monthKey(), rowId, kind, units, spendUsd(kind, units), note || null, nowIso()).run();
  } catch (e) { console.error(JSON.stringify({ worker: WORKER, where: "addSpend", error: String(e && e.message || e) })); }
}
async function monthSpend(env) {
  var r = await env.QNFO_AUDIT.prepare("SELECT COALESCE(SUM(usd), 0) AS usd FROM youtube_spend WHERE month = ?1").bind(monthKey()).first();
  return r ? Number(r.usd) : 0;
}
async function ensureTable(env) {
  await env.QNFO_AUDIT.prepare("CREATE TABLE IF NOT EXISTS youtube_spend (id INTEGER PRIMARY KEY AUTOINCREMENT, month TEXT NOT NULL, row_id INTEGER, kind TEXT NOT NULL, units REAL NOT NULL, usd REAL NOT NULL, note TEXT, created_at TEXT NOT NULL)").run();
  await env.QNFO_AUDIT.prepare("CREATE TABLE IF NOT EXISTS youtube_videos (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, rev TEXT, state TEXT NOT NULL, title TEXT, attempts INTEGER NOT NULL DEFAULT 0, note TEXT, duration_s REAL, video_id TEXT, privacy TEXT, synthetic INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, uploaded_at TEXT, views INTEGER)").run();
}
async function setState(env, id, state, fields) {
  var f = fields || {};
  await env.QNFO_AUDIT.prepare("UPDATE youtube_videos SET state = ?1, note = ?2, title = COALESCE(?3, title), duration_s = COALESCE(?4, duration_s), video_id = COALESCE(?5, video_id), privacy = COALESCE(?6, privacy), uploaded_at = COALESCE(?7, uploaded_at), attempts = attempts + ?8, updated_at = ?9 WHERE id = ?10")
    .bind(state, f.note == null ? null : String(f.note).slice(0, 1500), f.title || null, f.duration_s == null ? null : f.duration_s, f.video_id || null, f.privacy || null, f.uploaded_at || null, f.bump ? 1 : 0, nowIso(), id).run();
}

// ---------- stages ----------
async function loadArticle(env, slug) {
  var r = await env.LIVING_PAPER.prepare("SELECT slug, rev, title, short, body FROM plain_article WHERE slug = ?1 AND status = 'ok'").bind(slug).first();
  if (!r) throw new Error("plain_article row missing or not ok: " + slug);
  return { slug: r.slug, rev: r.rev, title: r.title, short: r.short, sections: parseSections(r.body) };
}
function modelText(w) {
  return (w && (typeof w.response === "string" ? w.response : (w.choices && w.choices[0] && w.choices[0].message && w.choices[0].message.content))) || "";
}
// YT-DIRECTOR-1: the first reply that holds JSON wins; the order is qnfo-ai (router), then Workers AI kimi, then gpt-oss, so one model that
// answers with prose, an empty reply or only reasoning does not strand a paper. The failure note carries a snippet of each reply.
async function aiJson(env, system, user, maxTokens, temp) {
  temp = typeof temp === "number" ? temp : 0.3; // YT-SCRIPT-1: the director writes a script, so it runs warmer than the checkers
  var msgs = [{ role: "system", content: system }, { role: "user", content: user }], notes = [];
  var sources = [];
  if (env.QNFO_AI && typeof env.QNFO_AI.fetch === "function") sources.push({ n: "qnfo-ai", run: async function () {
    var r = await env.QNFO_AI.fetch("https://qnfo-ai.internal/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "auto", messages: msgs, max_tokens: maxTokens, stream: false, temperature: temp }) });
    if (!r.ok) throw new Error("http " + r.status + " " + (await r.text()).slice(0, 120));
    return modelText(await r.json());
  } });
  sources.push({ n: "kimi", run: async function () { return modelText(await env.AI.run(WRITE_FALLBACK_MODEL, { messages: msgs, max_tokens: maxTokens, reasoning_effort: "none", temperature: temp })); } });
  sources.push({ n: "gpt-oss", run: async function () { return modelText(await env.AI.run(CHECK_MODEL, { messages: msgs, max_tokens: maxTokens + 1500, reasoning_effort: "low", temperature: temp })); } });
  for (var i = 0; i < sources.length; i++) {
    try {
      var t = await sources[i].run();
      var j = jsonFromText(t);
      if (j && Array.isArray(j.beats)) return { json: j, source: sources[i].n };
      notes.push(sources[i].n + ": no beats array");
    } catch (e) { notes.push(sources[i].n + ": " + String(e && e.message || e).slice(0, 140)); }
  }
  throw new Error("director: " + notes.join(" | ").slice(0, 700));
}
var CTA_LINES = ["Want the full story, in plain language? It is free, and the link is in the description.", "There is more to this than fits in a minute. The whole article is free, linked in the description.", "If that got you curious, the plain-language version is free, and the link is below."];
function ctaBeat(slug) {
  var h = 0, t = String(slug || "");
  for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return { kind: "cta", narr: CTA_LINES[h % CTA_LINES.length], title: "Read it free", url: "papers.qnfo.org", sub: "No jargon. No mathematics." };
}
function directorPrompt() {
  return "You write a 35-45 second vertical video for people who have never heard of this paper, from its plain-language article. Think like a good science storyteller, not a slide reader. Output JSON only: {\"title\":\"<=70 chars, plain\",\"script\":\"the whole voice-over, 85-110 words, never more than 110\",\"beats\":[...]}.\n" +
    "STEP 1, the script. Write the complete voice-over FIRST, as one piece of natural speech with an arc: (1) HOOK, one concrete question or surprising claim from the article, under 12 words, no greeting; (2) STAKES, why a curious person should care, in everyday words; (3) the IDEA, explained step by step, with at most one everyday comparison introduced by 'think of it like' or 'imagine' that adds no factual claim; (4) a TURN, a spoken pivot such as 'But here is the catch' or 'So what does that mean?' that carries the article's caveat (assumed, modelled, does not show); (5) PAYOFF, what changes in how we should see the world, in one plain sentence; (6) a closing question or teaser that makes the listener want the article. Count the words: the first live Short ran 160 words and 59 seconds, and shorter holds attention better. Write for the ear: full, grammatical sentences, contractions, sentences of 4 to 16 words with deliberate variety (a short one after a long one), questions and commas where a speaker's pitch moves, numbers spelled as words, no URLs, no brackets, no jargon without a plain gloss, never read a list aloud. Talk to one person ('you'). The voice must sound like someone explaining this to a friend.\n" +
    "STEP 2, the storyboard. Cut the script into 5 to 7 beats in order; each beat's narr is the exact consecutive piece of the script it covers (1 to 3 sentences) and together they are the whole script. Give each beat a picture that ILLUSTRATES what is said and never repeats it: on-screen text is two to five words, a label or a number, never the sentence being spoken. Beat fields: {\"kind\":K,\"narr\":\"...\", ...fields}. Kinds:\n" +
    "hook {lines:[<=5 short lines shown big, each <=16 chars], hi:[indexes of lines to highlight]} (beat 1, and optionally the last beat to show the closing question as big text)\n" +
    "flow {nodes:[2-4 labels, each <=22 chars]} (a process or chain: A leads to B leads to C)\n" +
    "list {title:\"<=24 chars\", items:[2-4 short points, each <=38 chars]} (parts or caveats, as keywords)\n" +
    "compare {title:\"<=30 chars\", items:[[\"label\", fraction 0-1, \"c1\", \"value text <=18 chars\"], ...2-3 rows, colours c1 c2 c3]} (two or three quantities the article gives)\n" +
    "bignum {value: a NUMBER that is in the article, frac:0-1 ring fill, color:\"c1\"|\"c2\"|\"c3\", label:\"what it counts\", sub:\"<=36 chars\"}\n" +
    "versus {left:\"<=18 chars\", right:\"<=18 chars\"} (two things the article contrasts)\n" +
    "payoff {bars:[[x,value,\"c1\",\"label\"],...]} x in -2.4,0,2.4; value -2..3 (only when the article gives outcomes)\n" +
    "meter {need:0-1, have:0-1, need_label, have_label, axis_label, verdict} (only when the article gives a threshold and an actual value)\n" +
    "dots {from:0-1, to:0-1, a:\"group\", b:\"group\"} (only when the article describes a share changing)\n" +
    "RULES: bignum, compare, payoff, meter and dots draw DATA: use one only when the article states those exact figures, never to decorate an idea (an idea without figures is shown with flow, list, versus or hook); every fact, number and claim must be written in the article (the one everyday comparison is the only exception and carries no numbers); keep its caveats; no outside facts, no hype, no invented quotes. Use at least four different kinds, never the same kind twice in a row, and fit the picture to the idea (a quantity: bignum; a chain: flow; a contrast: versus; a change in mix: dots or compare; caveats: list). Do not write a closing beat (a link card is added after yours).\n";
}
async function stageDirect(env, row) {
  var article = await loadArticle(env, row.slug);
  var text = article.title + "\nSummary: " + article.short + "\n\n" + article.sections.map(function (s) { return "## " + s.h + "\n" + s.paras.join("\n"); }).join("\n\n");
  var dj = await aiJson(env, directorPrompt(), text.slice(0, 9000), 3500, 0.7);
  var spec = dj.json;
  await addSpend(env, row.id, "llm", 2, "director " + dj.source + " + checker");
  var pre = validateBeats(spec.beats, article, []);
  var unsupported = [];
  if (pre.kept.length) {
    var chk = await env.AI.run(CHECK_MODEL, {
      messages: [
        { role: "system", content: "You check video narration against its source article. For each numbered narration, decide if EVERY factual claim in it is stated in the article. An everyday comparison introduced by 'think of it like' or 'imagine' is allowed when it adds no factual claim about the paper. Reply JSON only: {\"unsupported\":[numbers of narrations with any claim not in the article]}." },
        { role: "user", content: "ARTICLE:\n" + text.slice(0, 9000) + "\n\nNARRATIONS:\n" + (spec.beats || []).map(function (b, i) { return i + ". " + (b && b.narr); }).join("\n") }],
      max_tokens: 800, reasoning_effort: "low", temperature: 0
    });
    var ct = chk && (chk.response || (chk.choices && chk.choices[0] && chk.choices[0].message && chk.choices[0].message.content));
    var cj = jsonFromText(typeof ct === "string" ? ct : JSON.stringify(ct || {}));
    unsupported = (Array.isArray(cj.unsupported) ? cj.unsupported : []).map(Number);
  }
  var v = validateBeats(spec.beats, article, unsupported);
  await env.MEDIA.put("youtube/" + row.id + "/beats.json", JSON.stringify({ title: spec.title, script: spec.script, kept: v.kept, dropped: v.dropped, checker_unsupported: unsupported }), { httpMetadata: { contentType: "application/json" } });
  if (v.kept.length < MIN_CONTENT_BEATS) {
    await setState(env, row.id, "rejected", { note: "director left " + v.kept.length + " supported beats; dropped " + JSON.stringify(v.dropped).slice(0, 600) });
    return null;
  }
  var cta = ctaBeat(row.slug);
  var beats = v.kept.concat([cta]);
  await setState(env, row.id, "directed", { title: String(spec.title || article.title).slice(0, 80), note: "beats " + beats.length + ", dropped " + v.dropped.length });
  return beats;
}
async function ttsSentence(env, text) {
  try {   // YT-QUALITY-1: Aura 2 first (natural prosody); any failure falls back to melotts so a run never stops on the voice
    var resp = await env.AI.run(TTS_PRIMARY, { text: text, speaker: TTS_SPEAKER, encoding: "mp3" }, { returnRawResponse: true });
    var buf = await resp.arrayBuffer();
    if (buf && buf.byteLength > 1000) return { b64: b64FromBytes(new Uint8Array(buf)), aura: true };
  } catch (e) {
    console.error(JSON.stringify({ worker: WORKER, where: "tts-aura", error: String(e && e.message || e).slice(0, 200) }));
  }
  var r = await env.AI.run(TTS_MODEL, { prompt: text, lang: "en" });
  if (r && typeof r.audio === "string") return { b64: r.audio, aura: false };
  if (r instanceof ArrayBuffer) return { b64: b64FromBytes(new Uint8Array(r)), aura: false };
  if (r && r.byteLength !== undefined) return { b64: b64FromBytes(new Uint8Array(r)), aura: false };
  throw new Error("TTS returned no audio: " + JSON.stringify(r).slice(0, 120));
}
// YT-VOICE-1: the first attempt is voiced in the render container by Kokoro-82M (CPU, no per-character cost, one pass per beat, real word times for the captions);
// a row that has already failed once is re-voiced here with Aura/melotts, so a Kokoro fault never costs the Short.
function ttsEngine(attempts) { return (attempts || 0) < 1 ? "kokoro" : "aura"; }
async function stageAudio(env, row, beats) {
  var out = [], auraChars = 0, melChars = 0, engine = ttsEngine(row.attempts);
  for (var i = 0; i < beats.length; i++) {
    var b = Object.assign({}, beats[i]), ss = [];
    var sents = splitSentences(b.narr);
    if (engine === "kokoro") { b.sentences = sents.map(function (t) { return { text: t }; }); out.push(b); continue; }
    for (var j = 0; j < sents.length; j++) { var tr = await ttsSentence(env, sents[j]); ss.push({ text: sents[j], audio_b64: tr.b64 }); if (tr.aura) auraChars += sents[j].length; else melChars += sents[j].length; }
    b.sentences = ss;
    out.push(b);
  }
  if (auraChars) await addSpend(env, row.id, "tts_aura", auraChars, "aura-2 characters");
  if (melChars) await addSpend(env, row.id, "tts", melChars, "melotts characters");
  await env.MEDIA.put("youtube/" + row.id + "/job.json", JSON.stringify({ id: String(row.id), slug: row.slug, title: row.title, tts: engine, beats: out }), { httpMetadata: { contentType: "application/json" } });
  await setState(env, row.id, "audio", { note: engine + " voice, " + out.length + " beats" });
}
function renderStub(env) { return env.RENDER.get(env.RENDER.idFromName("default")); }
async function stageSubmit(env, row) {
  var obj = await env.MEDIA.get("youtube/" + row.id + "/job.json");
  if (!obj) throw new Error("job.json missing in R2");
  var job = JSON.parse(await obj.text());
  var r = await renderStub(env).fetch("https://render.internal/submit", { method: "POST", body: JSON.stringify({ id: String(row.id), job: job }) });
  if (!r.ok) throw new Error("container submit " + r.status + ": " + (await r.text()).slice(0, 300));
  await setState(env, row.id, "rendering", { note: "submitted " + nowIso() });
}
async function stagePoll(env, row, deadline) {
  for (var i = 0; i < RENDER_POLLS; i++) {
    if (deadline && Date.now() > deadline) return false;
    var r = await renderStub(env).fetch("https://render.internal/poll?id=" + row.id);
    var j = await r.json().catch(function () { return {}; });
    if (j.state === "done") {
      var d = await renderStub(env).fetch("https://render.internal/download?id=" + row.id);
      if (!d.ok) throw new Error("container download " + d.status);
      var bytes = await d.arrayBuffer();
      var t0 = Date.parse(String(row.note || "").replace("submitted ", ""));
      if (t0) await addSpend(env, row.id, "container", Math.max(1, Math.round((Date.now() - t0) / 1000)), "wall seconds submit to done");
      await env.MEDIA.put("youtube/" + row.id + "/short.mp4", bytes, { httpMetadata: { contentType: "video/mp4" } });
      await setState(env, row.id, "rendered", { duration_s: Number(j.duration_s) || null, note: "rendered " + bytes.byteLength + " bytes" });
      return true;
    }
    if (j.state === "error") throw new Error("render error: " + String(j.error || "").slice(-600));
    if (j.state === "unknown") { await setState(env, row.id, "audio", { note: "container lost the job; resubmitting" }); return false; }
    await sleep(15000);
  }
  return false; // still rendering: the next tick resumes polling
}
function oauthJson(data, status) {
  var response = json(data, status);
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}
function base64Url(bytes) {
  return b64FromBytes(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function oauthMac(env, text) {
  var key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.YT_RUN_TOKEN), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))));
}
async function handleOAuth(request, env, path) {
  if (!env.YT_RUN_TOKEN || !safeEqual(request.headers.get("x-run-token") || "", env.YT_RUN_TOKEN)) return oauthJson({ ok: false, error: "unauthorized" }, 401);
  if (request.method !== "POST") return oauthJson({ ok: false, error: "POST required" }, 405);
  if (!env.YT_CLIENT_ID || !env.YT_CLIENT_SECRET) return oauthJson({ ok: false, error: "OAuth client not configured" }, 503);
  var body;
  try {
    var text = await request.text();
    if (text.length > 8192) return oauthJson({ ok: false, error: "request too large" }, 413);
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("object required");
  } catch (_) { return oauthJson({ ok: false, error: "invalid JSON" }, 400); }
  if (path === "/oauth/consent") {
    var redirect;
    try {
      redirect = new URL(body.redirect_uri || "http://localhost:8765/");
      // The existing Google client is a Desktop app; only a loopback redirect is supported.
      if (redirect.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname) || redirect.username || redirect.password || redirect.pathname !== "/" || redirect.search || redirect.hash) throw new Error("loopback required");
    } catch (_) { return oauthJson({ ok: false, error: "redirect_uri must be an HTTP loopback root URL" }, 400); }
    var payload = btoa(JSON.stringify({ redirect_uri: redirect.href, expires: Date.now() + 600000, nonce: base64Url(crypto.getRandomValues(new Uint8Array(32))) }));
    var state = payload + "." + await oauthMac(env, payload);
    var verifier = await oauthMac(env, "pkce:" + state);
    var challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    var consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    consent.search = new URLSearchParams({ client_id: env.YT_CLIENT_ID, redirect_uri: redirect.href, response_type: "code", scope: YT_SCOPES.join(" "), access_type: "offline", prompt: "consent", state: state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
    return oauthJson({ ok: true, url: consent.href, state: state, expires_in: 600 });
  }
  var grant;
  try {
    if (typeof body.code !== "string" || !body.code.trim() || typeof body.state !== "string") throw new Error("code and state required");
    var parts = body.state.split(".");
    if (parts.length !== 2 || !safeEqual(parts[1], await oauthMac(env, parts[0]))) throw new Error("invalid state");
    grant = JSON.parse(atob(parts[0]));
    if (!Number.isFinite(grant.expires) || grant.expires <= Date.now()) throw new Error("expired state");
  } catch (_) { return oauthJson({ ok: false, error: "invalid or expired consent state; code and returned state required" }, 400); }
  try {
    var r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, code: body.code, redirect_uri: grant.redirect_uri, grant_type: "authorization_code", code_verifier: await oauthMac(env, "pkce:" + body.state) }).toString() });
    var token = await r.json().catch(function () { return {}; });
    if (!r.ok || !token.access_token) return oauthJson({ ok: false, error: "Google code exchange failed", upstream_status: r.status }, 502);
    var scopes = typeof token.scope === "string" ? token.scope.split(/\s+/) : [];
    var missing = YT_SCOPES.filter(function (scope) { return !scopes.includes(scope); });
    if (missing.length) return oauthJson({ ok: false, error: "Google consent did not grant all required scopes", missing_scopes: missing }, 403);
    if (typeof token.refresh_token !== "string" || !token.refresh_token) return oauthJson({ ok: false, error: "Google returned no refresh token; repeat offline consent" }, 409);
    // Only the authenticated operator receives the new token; installation still requires the secret-lock lease.
    return oauthJson({ ok: true, refresh_token: token.refresh_token, scopes: scopes, install: "Acquire the deploy-guard secret-lock lease, put YT_REFRESH_TOKEN on qnfo-youtube-shorts, release the lease, then verify numeric views via /status." });
  } catch (_) { return oauthJson({ ok: false, error: "Google code exchange unavailable" }, 502); }
}
async function accessToken(env) {
  var r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, refresh_token: env.YT_REFRESH_TOKEN, grant_type: "refresh_token" }).toString() });
  var j = await r.json().catch(function () { return {}; });
  if (!r.ok || !j.access_token) throw new Error("oauth refresh " + r.status + ": " + JSON.stringify(j).slice(0, 300));
  return j.access_token;
}
async function stageUpload(env, row) {
  if (!env.YT_CLIENT_ID || !env.YT_CLIENT_SECRET || !env.YT_REFRESH_TOKEN) {
    await setState(env, row.id, "rendered", { note: "awaiting-youtube-credentials: video is in R2 youtube/" + row.id + "/short.mp4" });
    return false;
  }
  var article = await loadArticle(env, row.slug);
  var meta = buildMetadata(article, row.slug, row.title, row.duration_s);
  var obj = await env.MEDIA.get("youtube/" + row.id + "/short.mp4");
  if (!obj) throw new Error("short.mp4 missing in R2");
  var bytes = await obj.arrayBuffer();
  var tok = await accessToken(env);
  var init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { authorization: "Bearer " + tok, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "video/mp4", "x-upload-content-length": String(bytes.byteLength) },
    body: JSON.stringify({ snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: meta.categoryId }, status: { privacyStatus: PRIVACY, selfDeclaredMadeForKids: false, containsSyntheticMedia: true } })
  });
  var loc = init.headers.get("location");
  if (!init.ok || !loc) throw new Error("youtube init " + init.status + ": " + (await init.text()).slice(0, 400));
  var up = await fetch(loc, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(bytes.byteLength) }, body: bytes });
  var uj = await up.json().catch(function () { return {}; });
  if (!up.ok || !uj.id) throw new Error("youtube upload " + up.status + ": " + JSON.stringify(uj).slice(0, 400));
  for (var w = 0; w < 3; w++) {
    try { await setState(env, row.id, "uploaded", { video_id: uj.id, privacy: (uj.status && uj.status.privacyStatus) || PRIVACY, uploaded_at: nowIso(), note: "https://youtube.com/shorts/" + uj.id }); break; }
    catch (e) { await logEvent(env, "youtube.ledger_retry", row.slug + " video " + uj.id, { error: String(e && e.message || e).slice(0, 200) }, "warn"); await sleep(1500); }
  }
  await logEvent(env, "youtube.uploaded", row.slug, { video_id: uj.id, privacy: uj.status && uj.status.privacyStatus, row: row.id }, "ok");
  return true;
}

async function advance(env, row, deadline) {
  for (var guard = 0; guard < 8 && Date.now() < deadline; guard++) {
    row = await env.QNFO_AUDIT.prepare("SELECT * FROM youtube_videos WHERE id = ?1").bind(row.id).first();
    try {
      if (row.state === "queued") { if (!(await stageDirect(env, row))) return row.id; }
      else if (row.state === "directed") {
        var bo = await env.MEDIA.get("youtube/" + row.id + "/beats.json");
        var beats = JSON.parse(await bo.text()).kept.concat([ctaBeat(row.slug)]);
        await stageAudio(env, row, beats);
      }
      else if (row.state === "audio") await stageSubmit(env, row);
      else if (row.state === "rendering") { if (!(await stagePoll(env, row, deadline))) { if ((await env.QNFO_AUDIT.prepare("SELECT state FROM youtube_videos WHERE id = ?1").bind(row.id).first()).state === "rendering") return row.id; } }
      else if (row.state === "rendered") { if (!(await stageUpload(env, row))) return row.id; }
      else return row.id; // uploaded, rejected, failed
    } catch (e) {
      var msg = String(e && e.message || e);
      var attempts = (row.attempts || 0) + 1;
      var state = attempts >= MAX_ATTEMPTS ? "failed" : (row.state === "rendering" ? "audio" : row.state);
      // YT-FM-RENDER-1: the container failed twice on this job; the job stays in R2 for youtube-render-runner.yml (a GitHub-runner render), and this row stops blocking new papers.
      if (attempts === 1 && (row.state === "audio" || row.state === "rendering")) state = "directed"; // YT-VOICE-1: back to the voice stage, which now uses Aura
      if (attempts >= 2 && attempts < MAX_ATTEMPTS && (row.state === "audio" || row.state === "rendering")) state = "runner_pending";
      await setState(env, row.id, state, { note: row.state + ": " + msg, bump: true });
      await logEvent(env, "youtube.stage_error", row.slug + " " + row.state, { error: msg.slice(0, 500), attempts: attempts }, "error");
      return row.id;
    }
  }
  return row.id;
}

// ---------- YT-6 (agent_issues 1000597, roadmap YT-6, pillar reach): what viewers did with each Short ----------
// Views and average view duration are read back hourly into youtube_videos (views, avg_view_duration_s, retention_read_at) from the YouTube Data API (statistics.viewCount) and the
// YouTube Analytics API (views, averageViewDuration by video). The refresh token this worker holds was consented for upload; reading needs youtube.readonly and yt-analytics.readonly, which
// is one more owner consent (IDENTITY-BOUND, human_actions yt-analytics-consent). Until it is given the read answers 401 or 403, the worker records that exactly once per tick as
// youtube.retention_scope with status warn, leaves the columns NULL and never writes a zero: metric youtube_avg_view_duration_s reads unmeasured, not 0.
var RETENTION_EVERY_MIN = 55;
function parseRetentionReport(j) {
  var out = {};
  if (!j || !Array.isArray(j.rows) || !Array.isArray(j.columnHeaders)) return out;
  var names = j.columnHeaders.map(function (h) { return h && h.name; });
  var iv = names.indexOf("video"), iw = names.indexOf("views"), ia = names.indexOf("averageViewDuration");
  if (iv < 0) return out;
  j.rows.forEach(function (r) {
    var o = {};
    if (iw >= 0 && r[iw] != null && isFinite(Number(r[iw]))) o.views = Number(r[iw]);
    if (ia >= 0 && r[ia] != null && isFinite(Number(r[ia]))) o.avg_view_duration_s = Number(r[ia]);
    out[String(r[iv])] = o;
  });
  return out;
}
function parseVideoStats(j) {
  var out = {};
  ((j && j.items) || []).forEach(function (it) {
    var n = it && it.statistics && it.statistics.viewCount;
    if (it && it.id && n != null && isFinite(Number(n))) out[String(it.id)] = { views: Number(n) };
  });
  return out;
}
function retentionDue(lastIso, nowMs) {
  if (!lastIso) return true;
  var t = Date.parse(lastIso);
  return !isFinite(t) || nowMs - t >= RETENTION_EVERY_MIN * 60000;
}
// 401, or 403 with an insufficient-scope reason, is the missing consent; anything else is reported as the HTTP status, never as the consent.
function retentionFailure(status, bodyText) {
  var t = String(bodyText || "");
  if (status === 401 || (status === 403 && /insufficient|scope|forbidden|permission/i.test(t))) return "scope-missing";
  if (status === 403 && /quota/i.test(t)) return "quota";
  return "http-" + status;
}
var RETENTION_COLS_READY = new WeakSet();
async function ensureRetentionColumns(env) {
  if (RETENTION_COLS_READY.has(env.QNFO_AUDIT)) return;
  var have = ((await env.QNFO_AUDIT.prepare("SELECT name FROM pragma_table_info('youtube_videos')").all()).results || []).map(function (r) { return r.name; });
  if (have.indexOf("avg_view_duration_s") < 0) await env.QNFO_AUDIT.prepare("ALTER TABLE youtube_videos ADD COLUMN avg_view_duration_s REAL").run();
  if (have.indexOf("retention_read_at") < 0) await env.QNFO_AUDIT.prepare("ALTER TABLE youtube_videos ADD COLUMN retention_read_at TEXT").run();
  RETENTION_COLS_READY.add(env.QNFO_AUDIT);
}
async function readRetention(env, nowMs) {
  nowMs = nowMs || Date.now();
  if (!env.YT_CLIENT_ID || !env.YT_CLIENT_SECRET || !env.YT_REFRESH_TOKEN) return { skipped: "no-credentials" };
  await ensureRetentionColumns(env);
  var rows = ((await env.QNFO_AUDIT.prepare("SELECT id, video_id, uploaded_at, retention_read_at FROM youtube_videos WHERE state = 'uploaded' AND video_id IS NOT NULL ORDER BY id LIMIT 50").all()).results || []).filter(function (r) { return retentionDue(r.retention_read_at, nowMs); });
  if (!rows.length) return { rows: 0 };
  var token = await accessToken(env);
  var ids = rows.map(function (r) { return r.video_id; });
  var auth = { headers: { authorization: "Bearer " + token } };
  var stats = {}, report = {}, failure = null;
  var d = await fetch("https://www.googleapis.com/youtube/v3/videos?part=statistics&id=" + encodeURIComponent(ids.join(",")), auth);
  var dText = await d.text();
  if (d.ok) { try { stats = parseVideoStats(JSON.parse(dText)); } catch (e) { stats = {}; } } else failure = retentionFailure(d.status, dText);
  var from = rows.map(function (r) { return String(r.uploaded_at || "").slice(0, 10); }).filter(Boolean).sort()[0] || new Date(nowMs - 30 * 864e5).toISOString().slice(0, 10);
  var to = new Date(nowMs).toISOString().slice(0, 10);
  var a = await fetch("https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=" + from + "&endDate=" + to + "&metrics=views,averageViewDuration&dimensions=video&sort=-views&maxResults=50&filters=" + encodeURIComponent("video==" + ids.join(",")), auth);
  var aText = await a.text();
  if (a.ok) { try { report = parseRetentionReport(JSON.parse(aText)); } catch (e) { report = {}; } } else if (!failure) failure = retentionFailure(a.status, aText);
  var wrote = 0;
  for (var i = 0; i < rows.length; i++) {
    var id = rows[i].video_id, s = stats[id] || {}, p = report[id] || {};
    var views = p.views != null ? p.views : s.views;
    if (views == null && p.avg_view_duration_s == null) continue;
    await env.QNFO_AUDIT.prepare("UPDATE youtube_videos SET views = COALESCE(?1, views), avg_view_duration_s = COALESCE(?2, avg_view_duration_s), retention_read_at = ?3, updated_at = ?3 WHERE id = ?4")
      .bind(views == null ? null : views, p.avg_view_duration_s == null ? null : p.avg_view_duration_s, nowIso(), rows[i].id).run();
    wrote++;
  }
  if (failure) await logEvent(env, "youtube.retention_scope", failure === "scope-missing" ? "retention read refused (" + failure + "): the OAuth grant lacks youtube.readonly / yt-analytics.readonly; owner card yt-analytics-consent" : "retention read failed: " + failure, { failure: failure, rows: rows.length, wrote: wrote }, "warn");
  return { rows: rows.length, wrote: wrote, failure: failure };
}
async function refreshMetric(env) {
  var r = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM youtube_videos WHERE state = 'uploaded' AND uploaded_at >= ?1").bind(new Date(Date.now() - 30 * 86400000).toISOString()).first();
  await env.QNFO_AUDIT.prepare("UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2, state = 'MEASURED' WHERE metric = 'youtube_videos_30d'").bind(String(r ? r.n : 0), nowIso()).run();
  var sp = await monthSpend(env);
  await env.QNFO_AUDIT.prepare("UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2, state = 'MEASURED' WHERE metric = 'youtube_spend_usd_month'").bind(sp.toFixed(4), nowIso()).run();
  // YT-6: the average view duration over the Shorts whose retention was read; with none read the metric stays unmeasured (no row is written, never a zero).
  try {
    await ensureRetentionColumns(env);
    var av = await env.QNFO_AUDIT.prepare("SELECT AVG(avg_view_duration_s) AS a, COUNT(avg_view_duration_s) AS c FROM youtube_videos WHERE state = 'uploaded' AND avg_view_duration_s IS NOT NULL").first();
    if (av && Number(av.c) > 0) await env.QNFO_AUDIT.prepare("UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2, state = 'MEASURED' WHERE metric = 'youtube_avg_view_duration_s'").bind(String(Math.round(Number(av.a) * 100) / 100), nowIso()).run();
  } catch (e) { console.error(JSON.stringify({ worker: WORKER, where: "refreshMetric:avg-view-duration", error: String(e && e.message || e) })); }
  return r ? r.n : 0;
}
async function runTick(env, opts) {
  var deadline = Date.now() + ((opts && opts.budgetMs) || 13 * 60 * 1000);
  await ensureTable(env);
  var open = await env.QNFO_AUDIT.prepare("SELECT * FROM youtube_videos WHERE state IN ('queued','directed','audio','rendering','rendered') ORDER BY id LIMIT 1").first();
  var res = { resumed: null, started: null };
  var spent = await monthSpend(env);
  res.month_spend_usd = Math.round(spent * 1e4) / 1e4;
  if (!spendAllows(spent)) {
    res.skipped = "spend-cap: month spend " + spent.toFixed(2) + " >= " + SPEND_STOP_USD;
    await logEvent(env, "youtube.spend_cap", res.skipped, { month: monthKey(), usd: spent }, "warn");
    res.uploaded_30d = await refreshMetric(env);
    return res;
  }
  if (open) { res.resumed = await advance(env, open, deadline); }
  else {
    var started = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM youtube_videos WHERE state != 'rejected' AND created_at >= ?1").bind(new Date(Date.now() - 7 * 86400000).toISOString()).first();
    if (capAllows(started ? started.n : 0) || (opts && opts.ignoreCap)) {
      var cands = (await env.LIVING_PAPER.prepare("SELECT slug, rev FROM plain_article WHERE status = 'ok' AND body IS NOT NULL AND words >= 200 ORDER BY generated_at DESC LIMIT 40").all()).results || [];
      var oldGen = [];
      try { oldGen = (await env.QNFO_AUDIT.prepare("SELECT slug FROM youtube_videos WHERE state = 'uploaded' AND created_at < ?1 AND slug NOT LIKE '%@v%'").bind(UPGRADE_EPOCH).all()).results || []; } catch (e) { await logEvent(env, "youtube.upgrade_read", String(e && e.message || e).slice(0, 200), null, "warn"); }
      var oldSlugs = {};
      oldGen.forEach(function (x) { oldSlugs[x.slug] = 1; });
      if (oldGen.length) {
        var have = {};
        cands.forEach(function (x) { have[x.slug] = 1; });
        var want = oldGen.map(function (x) { return x.slug; }).filter(function (x) { return !have[x]; });
        if (want.length) {
          var inList = want.map(function (_, i) { return "?" + (i + 1); }).join(",");
          try { cands = cands.concat((await env.LIVING_PAPER.prepare("SELECT slug, rev FROM plain_article WHERE status = 'ok' AND body IS NOT NULL AND slug IN (" + inList + ")").bind(...want).all()).results || []); } catch (e) { await logEvent(env, "youtube.upgrade_read", String(e && e.message || e).slice(0, 200), null, "warn"); }
        }
      }
      var taken = ((await env.QNFO_AUDIT.prepare("SELECT slug FROM youtube_videos").all()).results || []).map(function (x) { return x.slug; }).filter(function (x) { return !oldSlugs[x]; });
      var interest = [];
      try { interest = (await env.QNFO_AUDIT.prepare("SELECT slug, ext_30d, pv_30d FROM paper_readership WHERE slug IS NOT NULL").all()).results || []; } catch (e) { await logEvent(env, "youtube.interest_read", String(e && e.message || e).slice(0, 200), null, "warn"); }
      cands = upgradesFirst(rankByInterest(cands, interest), oldSlugs);
      var c = nextCandidate(cands, taken);
      if (c) {
        if (oldSlugs[c.slug]) { await env.QNFO_AUDIT.prepare("UPDATE youtube_videos SET slug = slug || '@v1', note = 'superseded by the YT-UPGRADE-1 remake; ' || COALESCE(note, ''), updated_at = ?1 WHERE slug = ?2 AND state = 'uploaded'").bind(nowIso(), c.slug).run(); await logEvent(env, "youtube.upgrade", c.slug, null, "info"); }
        var ins = await env.QNFO_AUDIT.prepare("INSERT INTO youtube_videos (slug, rev, state, privacy, synthetic, created_at, updated_at) VALUES (?1, ?2, 'queued', ?3, 1, ?4, ?4)").bind(c.slug, c.rev, PRIVACY, nowIso()).run();
        res.started = await advance(env, { id: ins.meta.last_row_id }, deadline);
      }
    }
  }
  try { res.retention = await readRetention(env); } catch (e) { res.retention = { error: String(e && e.message || e).slice(0, 200) }; await logEvent(env, "youtube.retention_error", res.retention.error, null, "warn"); }
  res.uploaded_30d = await refreshMetric(env);
  try { await env.QNFO_AUDIT.prepare("INSERT OR REPLACE INTO fleet_heartbeat (worker, version, ts, ok) VALUES (?1, ?2, ?3, 1)").bind(WORKER, VERSION, nowIso()).run(); } catch (e) { console.error(JSON.stringify({ worker: WORKER, where: "heartbeat", error: String(e && e.message || e) })); }
  return res;
}

// ---------- Container (Durable Object): starts the render image and proxies to its HTTP server on :8080 ----------
class RenderContainer {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this._starting = null; }
  async ensureStarted() {
    if (!this.ctx.container) throw new Error("CONTAINER-CONFIG-MISSING-1: ctx.container is undefined - the [[containers]] block is not attached to this deployment");
    if (!this.ctx.container.running) {
      if (!this._starting) this._starting = Promise.resolve(this.ctx.container.start({ enableInternet: false })).finally(() => { this._starting = null; });
      await this._starting;
    }
    var port = this.ctx.container.getTcpPort(8080), last = null;
    for (var i = 0; i < 30; i++) {
      try { var r = await port.fetch("http://container/health"); if (r.ok) return port; } catch (e) { last = e; }
      await sleep(2000);
    }
    throw new Error("container did not answer /health: " + String(last && last.message || last));
  }
  async fetch(request) {
    var u = new URL(request.url);
    try {
      if (u.pathname === "/state") return json({ configured: !!this.ctx.container, running: !!(this.ctx.container && this.ctx.container.running) });
      var port = await this.ensureStarted();
      if (u.pathname === "/submit") {
        var r = await port.fetch("http://container/render", { method: "POST", headers: { "content-type": "application/json" }, body: await request.text() });
        return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
      }
      if (u.pathname === "/poll") return port.fetch("http://container/result?id=" + encodeURIComponent(u.searchParams.get("id") || ""));
      if (u.pathname === "/download") return port.fetch("http://container/result?download=1&id=" + encodeURIComponent(u.searchParams.get("id") || ""));
      return json({ ok: false, error: "not found" }, 404);
    } catch (e) {
      return json({ ok: false, error: String(e && e.message || e) }, 500);
    }
  }
}

async function status(env) {
  var out = { ok: true, worker: WORKER, version: VERSION, privacy: PRIVACY, weekly_cap: WEEKLY_CAP, spend_stop_usd: SPEND_STOP_USD, month_spend_usd: await monthSpend(env).catch(function () { return null; }), credentials: !!(env.YT_CLIENT_ID && env.YT_CLIENT_SECRET && env.YT_REFRESH_TOKEN) };
  try {
    await ensureRetentionColumns(env);
    out.rows = ((await env.QNFO_AUDIT.prepare("SELECT id, slug, state, attempts, video_id, privacy, duration_s, views, avg_view_duration_s, substr(note,1,200) AS note, created_at, uploaded_at FROM youtube_videos ORDER BY id DESC LIMIT 10").all()).results) || [];
  } catch (e) { out.rows = []; out.rows_error = String(e && e.message || e); }
  try { out.container = await (await renderStub(env).fetch("https://render.internal/state")).json(); } catch (e) { out.container = { error: String(e && e.message || e) }; }
  return out;
}

var worker_default = {
  async fetch(request, env, ctx) {
    env = __aiAttrEnv(env, "qnfo-youtube-shorts", "AI", "QNFO_AUDIT");
    var url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, worker: WORKER, version: VERSION,
      capabilities: ["paper-to-short-video", "tts-voice-over", "container-render", "youtube-upload", "retention-read", "status-report", "oauth-reconsent"],
      limitations: ["POST /run needs the x-run-token header (YT_RUN_TOKEN); /health and /status are open", "rendering runs in a container, one unfinished row is resumed per tick", "uploads at the configured privacy status through the YouTube Data API, so it is bound by that API quota", "a paper whose script has too few supported beats is rejected, and a row failing 4 attempts is terminal", "views and average view duration are read only once the OAuth grant also carries youtube.readonly and yt-analytics.readonly (owner consent); until then they stay NULL"] });
    if (url.pathname === "/status") return json(await status(env));
    if (url.pathname === "/oauth/consent" || url.pathname === "/oauth/exchange") return handleOAuth(request, env, url.pathname);
    if (url.pathname === "/run" && request.method === "POST") {
      var tok = request.headers.get("x-run-token") || "";
      if (!env.YT_RUN_TOKEN || !safeEqual(tok, env.YT_RUN_TOKEN)) return json({ ok: false, error: "unauthorized" }, 401);
      var budget = Math.min(85, Math.max(10, Number(url.searchParams.get("budget_s")) || 80));
      try {
        var rr = await runTick(env, { ignoreCap: url.searchParams.get("ignore_cap") === "1", budgetMs: budget * 1000 });
        await logEvent(env, "youtube.run", JSON.stringify(rr), rr, "ok");
        return json({ ok: true, result: rr, status: await status(env) });
      } catch (e) {
        await logEvent(env, "youtube.run", String(e && e.message || e), null, "error");
        return json({ ok: false, error: String(e && e.message || e) }, 500);
      }
    }
    return json({ ok: false, error: "not found" }, 404);
  },
  async scheduled(event, env, ctx) {
    env = __aiAttrEnv(env, "qnfo-youtube-shorts", "AI", "QNFO_AUDIT");
    ctx.waitUntil(runTick(env, {}).then(function (r) { return logEvent(env, "youtube.tick", JSON.stringify(r), r, "ok"); }).catch(function (e) { console.error(JSON.stringify({ worker: WORKER, where: "scheduled", error: String(e && e.message || e) })); return logEvent(env, "youtube.tick", String(e && e.message || e), null, "error"); }));
  }
};
export { RenderContainer, spendUsd, spendAllows, splitSentences, numTokens, validateBeats, capAllows, ttsEngine, directorPrompt, ctaBeat, rankByInterest, upgradesFirst, nextCandidate, parseSections, jsonFromText, buildMetadata, shapeOk, CRON_TABLE, VERSION, parseRetentionReport, parseVideoStats, retentionDue, retentionFailure, readRetention };
export default worker_default;
