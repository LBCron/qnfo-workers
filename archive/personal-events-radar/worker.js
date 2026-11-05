// personal-events-radar Worker - QNFO.OPS.010 Stage B
// v1.2.4 (2026-09-03): CAL_TOKEN auth header on calendar-api calls (calendar-api v0.3.0 gate).
// v1.2.3 (2026-09-02): editorial chrome filter (Iamsterdam "Editorial tips / Weekend Guide"
//   page sections are not events).
// v1.2.2 (2026-09-02): time-colon guard on year-less day groups ("vrijdag 4 sep 14:00" must
//   not extract "sep 14"); until-detection extended to till/t/m/tot-<digit> variants so
//   closing-date rows stay report-only on Dutch and English museum pages.
// v1.2.1 (2026-09-02): year-less date inference (Eventbrite lists "Thu, Sep 17" without an
//   adjacent year; infer current/next year with a digit-lookahead guard against
//   "September 2026" month-year labels; unlocks the queer-arts source).
// v1.2.0 (2026-09-02): red-team remediation of v1.1.0 (M-1..M-3, S-1..S-4):
//   - M-1 until-date semantics: "until <date>" rows are RUNNING-UNTIL (report-only, never
//     posted to the calendar); date shown is the CLOSING date, stated explicitly in the tag.
//   - M-2 venue coverage: Stedelijk URL fixed (/en/whats-on, 404 -> 200 verified);
//     Dutch month names added to MONTH_RE (openluchttheater.nl is Dutch-locale);
//     month-without-day patterns ("Until September 2026") surface as RUNNING-UNTIL rows.
//   - M-3 widget filter: matchmaker/recommended-concert widgets discarded from extraction.
//   - S-1 queer arts source added: Eventbrite Amsterdam LGBTQ (profile facet "queer arts
//     and culture", conf 0.95; server-rendered, verified fetchable).
//   - S-2 travel-energy gate re-added (inert while all sources are Amsterdam-local; enforces
//     the budget if a non-local travel source is ever added). Report wording now matches.
//   - S-3 ledger dedupe: venue matched by normalized-slug containment (ledger rows carry
//     full-address venue strings; radar uses short names).
//   - S-4 titles trimmed at word boundaries; header counts labelled "this run".
// v1.1.0 (2026-09-02): PERSONAL-QNFO-SEPARATION-1 rebuild.
//   v1.0.x VIOLATED the separation gate: it scored WORK programs from research venue pages
//   into the PERSONAL plane calendar. v1.1.0 removed the entire work/research interest
//   taxonomy and scans PERSONAL-LIFE venues only.
// PURPOSE: weekly scan of personal-life venue pages scored against the PERSONAL plane
//   preferences in personal-life D1 (profile facets). Gates every recommendation through the
//   standing personal filters:
//   - energy budget: max 2 in-person TRAVEL events per half-year (local Amsterdam events are
//     commutable and do not consume travel budget); H2 2026 travel budget SPENT
//   - Schengen exit deadline 2026-10-17: onsite Schengen-venue events on/after that date blocked
//   - standing filter: no QPL/CWI topics in personal recommendations
//   - room-question gate: venue affinity (energizing venues rank up)
//   - tasting-menu protocol: 3-5 cheap local experiments over the next 90 days
// Cleared events are POSTed to calendar-api /events?plane=personal (source=personal-radar,
// status=tentative) with relevance+friction; RUNNING-UNTIL exhibitions are report-only;
// report persisted to D1 qnfo-audit.personal_radar and delivered to obsidian-writer.
// DEPLOY: cd qnfo-workers/personal-events-radar && wrangler deploy
// CANONICAL SOURCE (remote): github.com/QNFO/qnfo-workers -> personal-events-radar/worker.js
// NOTE: all regexes are built backslash-free (char classes + fromCharCode) for transport safety.
const VERSION = "1.2.4";
const WORKER = "personal-events-radar";

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const WSC = "[" + " " + TAB + CR + LF + "]";
const WS = WSC + "+";

// ---- Personal-life interest taxonomy (from personal-life profile facets ONLY) ----
// NO work/research keywords live here (PERSONAL-QNFO-SEPARATION-1).
const INTERESTS = [
  { code: "MUS", name: "Museums", kw: ["museum", "exhibition", "expositie", "gallery", "collection", "masterpiece", "old master", "tentoonstelling"] },
  { code: "CLA", name: "Classical music", kw: ["concert", "classical", "symphony", "orchestra", "orchestral", "chamber music", "recital", "concerto", "sonata", "opera", "baroque", "renaissance music"] },
  { code: "PER", name: "Play and performance", kw: ["performance", "theatre", "theater", "dance", "ballet", "puppet", "circus", "comedy", "open air", "openluchttheater", "storytelling"] },
  { code: "QUR", name: "Queer arts and culture", kw: ["queer", "pride", "lgbt", "lgbtq", "drag", "ballroom"] },
  { code: "JAZ", name: "Jazz and contemporary", kw: ["jazz", "contemporary music", "electronic", "dj", "live music", "indie", "folk"] },
  { code: "LIT", name: "Literature and ideas", kw: ["literature", "poetry", "book", "author", "reading", "philosophy cafe", "debate", "talk"] },
  { code: "FIL", name: "Film and screen", kw: ["film", "cinema", "screening", "documentary", "movie"] },
  { code: "FES", name: "Festivals and city life", kw: ["festival", "open day", "night of", "museumnacht", "free entry", "gratis", "market", "parade", "city walk"] }
];

// ---- Personal-life venue sources (Amsterdam local; evidence = profile facets) ----
const SOURCES = [
  { name: "Concertgebouw", url: "https://www.concertgebouw.nl/en", kind: "concert", delivery: "onsite", cost: 2 },
  { name: "Rijksmuseum", url: "https://www.rijksmuseum.nl/en/whats-on", kind: "exhibition", delivery: "onsite", cost: 1 },
  { name: "VanGoghMuseum", url: "https://www.vangoghmuseum.nl/en/visit/whats-on", kind: "exhibition", delivery: "onsite", cost: 1 },
  { name: "Stedelijk", url: "https://www.stedelijk.nl/en/whats-on", kind: "exhibition", delivery: "onsite", cost: 1 },
  { name: "Openluchttheater", url: "https://www.openluchttheater.nl/agenda", kind: "performance", delivery: "onsite", cost: 0 },
  { name: "Iamsterdam", url: "https://www.iamsterdam.com/en/whats-on", kind: "event", delivery: "onsite", cost: 1 },
  { name: "EventbriteLGBTQ", url: "https://www.eventbrite.nl/d/netherlands--amsterdam/events/lgbtq/", kind: "event", delivery: "onsite", cost: 1 }
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// ---- Personal gate configuration (evidence = personal-life profile facets, 2026-09-02) ----
const ENERGY = { maxInPersonPerHalfYear: 2, h2_2026_spent: true, nextEligibility: "2027-01-01" };
const SCHENGEN_EXIT = "2026-10-17";
const STANDING_DROP = /qpl|cwi/i;
const VENUE_AFFINITY = { Concertgebouw: 1, Rijksmuseum: 1, VanGoghMuseum: 1, Stedelijk: 1, Openluchttheater: 1, EventbriteLGBTQ: 1 };
const LOCAL_VENUES = ["Concertgebouw", "Rijksmuseum", "VanGoghMuseum", "Stedelijk", "Openluchttheater", "Iamsterdam", "EventbriteLGBTQ"];
const SCHENGEN_VENUES = ["Concertgebouw", "Rijksmuseum", "VanGoghMuseum", "Stedelijk", "Openluchttheater", "Iamsterdam", "EventbriteLGBTQ"];
const TRAVEL_KINDS = ["conference", "workshop", "school"];

// Dutch month names added (openluchttheater.nl is Dutch-locale); /i flag makes case moot.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, maa: 3, mei: 5, okt: 10 };
const MONTH_RE = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Januari|Februari|Maart|April|Mei|Juni|Juli|Augustus|September|Oktober|November|December)";
const ENTITY_MAP = { amp: "&", lt: "<", gt: ">", quot: String.fromCharCode(34), apos: String.fromCharCode(39), nbsp: " ", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", times: "×", middot: "·", sdot: "⋅", minus: "−", deg: "°", micro: "µ" };

function decodeEntities(x) {
  return String(x || "").replace(/&#x([0-9a-fA-F]+);|&#([0-9]+);|&([a-zA-Z][a-zA-Z0-9]*);/g, function(m, hx, dec, name) {
    if (hx) { try { return String.fromCodePoint(parseInt(hx, 16)); } catch (e) { return m; } }
    if (dec) { try { return String.fromCodePoint(parseInt(dec, 10)); } catch (e) { return m; } }
    return Object.prototype.hasOwnProperty.call(ENTITY_MAP, name) ? ENTITY_MAP[name] : m;
  });
}
function cleanHtml(text) {
  const s = String(text || "")
    .replace(new RegExp("<script[^]*?</script>", "gi"), " ")
    .replace(new RegExp("<style[^]*?</style>", "gi"), " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(s).replace(new RegExp(WSC + "+", "g"), " ").trim();
}
function pad2(n) { return String(n).padStart(2, "0"); }
function toISO(y, m, d) { return y + "-" + pad2(m) + "-" + pad2(d); }

function extractEvents(text, src) {
  const events = [];
  let discarded = 0;
  const clean = cleanHtml(text);
  const cutYear = new Date().getFullYear();
  const dropGarbage = (s) => {
    if (new RegExp("[.]st[0-9]+" + WSC + "*[{]").test(s)) return true;
    if (new RegExp("fill" + WSC + "*:" + WSC + "*none").test(s)) return true;
    if (new RegExp('"id"' + WSC + "*:" + WSC + "*[0-9]+" + WSC + "*,").test(s)) return true;
    if (/window[.]/.test(s)) return true;
    if (new RegExp("function" + WS + "[(]").test(s)) return true;
    if (/matchmaker|recommended concerts|you choose/i.test(s)) return true; // M-3 widget filter
    if (/editorial tips|weekend guide/i.test(s)) return true; // v1.2.3 editorial chrome filter
    return false;
  };
  const seen = new Set();
  const rangeRe = new RegExp("(" + MONTH_RE + ")[a-z]*[.]?" + WS + "([0-9]{1,2})" + WSC + "*[-–—]" + WSC + "*([0-9]{1,2})" + WSC + "*,?" + WSC + "*(20[0-9]{2})", "gi");
  const rangeRe2 = new RegExp("([0-9]{1,2})" + WSC + "*[-–—]" + WSC + "*([0-9]{1,2})" + WS + "(" + MONTH_RE + ")[a-z]*[.]?" + WSC + "*,?" + WSC + "*(20[0-9]{2})", "gi");
  const singleRe = new RegExp("(" + MONTH_RE + ")[a-z]*[.]?" + WS + "([0-9]{1,2})" + WSC + "*,?" + WSC + "*(20[0-9]{2})", "gi");
  const singleRe2 = new RegExp("([0-9]{1,2})" + WS + "(" + MONTH_RE + ")[a-z]*[.]?" + WSC + "*,?" + WSC + "*(20[0-9]{2})", "gi");
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;
  const push = (mo, d1, d2, yr, idx, inferYear) => {
    const mon = (mo || "").toLowerCase().slice(0, 3);
    const month = MONTHS[mon];
    if (!month) { discarded += 1; return; }
    let year = yr ? parseInt(yr, 10) : 0;
    if (!year && inferYear) year = month >= nowMonth ? nowYear : nowYear + 1;
    if (year < cutYear || year > cutYear + 2) { discarded += 1; return; }
    const startIso = toISO(year, month, Math.min(d1 || 1, 28));
    const endIso = d2 ? toISO(year, month, Math.min(d2, 28)) : startIso;
    const key = src.name + "|" + startIso;
    if (seen.has(key)) return;
    let end = idx + 200;
    const after = clean.slice(idx + 10, idx + 420);
    const nxt = after.search(new RegExp(MONTH_RE + "[a-z]*[.]?"));
    if (nxt !== -1 && nxt < 200) end = idx + 10 + nxt;
    let snippet = clean.slice(Math.max(0, idx - 80), end).slice(0, 240);
    const spIdx = snippet.indexOf(" ");
    if (spIdx !== -1 && spIdx < 40) snippet = snippet.slice(spIdx + 1);
    if (dropGarbage(snippet)) { discarded += 1; return; }
    seen.add(key);
    const pre = clean.slice(Math.max(0, idx - 40), idx).toLowerCase();
    const runningUntil = new RegExp("until|till|t/m|tot(?=" + WSC + "*[0-9])", "i").test(pre); // M-1: closing-date semantics
    const wideSnippet = clean.slice(Math.max(0, idx - 120), Math.min(clean.length, idx + 40)).slice(0, 240);
    const dateText = (d2 ? mo + " " + d1 + "-" + d2 + ", " + year : mo + " " + d1 + ", " + year);
    events.push({ venue: src.name, dateText, startIso, endIso, year, month, day: d1 || null, url: src.url, snippet, wideSnippet, runningUntil, srcKind: src.kind, srcDelivery: src.delivery, srcCost: src.cost });
  };
  for (const m of clean.matchAll(rangeRe)) push(m[1], parseInt(m[2], 10), parseInt(m[3], 10), m[4], m.index);
  for (const m of clean.matchAll(rangeRe2)) push(m[3], parseInt(m[1], 10), parseInt(m[2], 10), m[4], m.index);
  for (const m of clean.matchAll(singleRe)) push(m[1], parseInt(m[2], 10), null, m[3], m.index);
  for (const m of clean.matchAll(singleRe2)) push(m[2], parseInt(m[1], 10), null, m[3], m.index);
  // year-less variants (Eventbrite: "Thu, Sep 17"); lookahead blocks "September 2026" labels;
  // skip positions where a year token follows within 20 chars (year-ful regex already handled)
  const rangeReNY = new RegExp("(" + MONTH_RE + ")[a-z]*[.]?" + WS + "([0-9]{1,2})(?![0-9:])" + WSC + "*[-–—]" + WSC + "*([0-9]{1,2})(?![0-9:])", "gi");
  const singleReNY = new RegExp("(" + MONTH_RE + ")[a-z]*[.]?" + WS + "([0-9]{1,2})(?![0-9:])", "gi");
  const singleRe2NY = new RegExp("([0-9]{1,2})(?![0-9])" + WS + "(" + MONTH_RE + ")[a-z]*[.]?", "gi");
  const nearYear = (i) => /20[0-9]{2}/.test(clean.slice(i, i + 20));
  for (const m of clean.matchAll(rangeReNY)) { if (!nearYear(m.index)) push(m[1], parseInt(m[2], 10), parseInt(m[3], 10), null, m.index, true); }
  for (const m of clean.matchAll(singleReNY)) { if (!nearYear(m.index)) push(m[1], parseInt(m[2], 10), null, null, m.index, true); }
  for (const m of clean.matchAll(singleRe2NY)) { if (!nearYear(m.index)) push(m[2], parseInt(m[1], 10), null, null, m.index, true); }
  // month-without-day: "Until September 2026" (museums list closing exhibitions this way)
  const untilMonthRe = new RegExp("(?:until|till|t/m)" + WS + "(" + MONTH_RE + ")[a-z]*" + WSC + "*[.]?" + WSC + "*(20[0-9]{2})", "gi");
  for (const m of clean.matchAll(untilMonthRe)) {
    const mon = (m[1] || "").toLowerCase().slice(0, 3);
    const month = MONTHS[mon];
    const year = parseInt(m[2], 10);
    if (!month || year < cutYear || year > cutYear + 2) continue;
    const endIso = toISO(year, month, 28);
    const key = src.name + "|rm|" + endIso;
    if (seen.has(key)) continue;
    const snippet = clean.slice(Math.max(0, m.index - 60), m.index + 120).slice(0, 200);
    if (dropGarbage(snippet)) continue;
    seen.add(key);
    events.push({ venue: src.name, dateText: "until " + m[1] + " " + year, startIso: endIso, endIso, year, month, day: null, url: src.url, snippet, wideSnippet: snippet, runningUntil: true, runningUntilMonth: true, srcKind: src.kind, srcDelivery: src.delivery, srcCost: src.cost });
  }
  const kept = events.slice(0, 20);
  discarded += Math.max(0, events.length - kept.length);
  return { events: kept, discarded };
}

function classify(ev) {
  const s = (ev.snippet || "").toLowerCase();
  let kind = ev.srcKind;
  if (/concert|recital|symphony|orchestra|opera/i.test(s)) kind = "concert";
  else if (/exhibition|expositie|tentoonstelling/i.test(s)) kind = "exhibition";
  else if (/performance|theatre|theater|dance|ballet|open air|openluchttheater/i.test(s)) kind = "performance";
  else if (/festival|parade|night of|museumnacht/i.test(s)) kind = "festival";
  else if (/film|cinema|screening|documentary/i.test(s)) kind = "film";
  else if (/talk|lecture|reading|debate/i.test(s)) kind = "talk";
  let delivery = ev.srcDelivery;
  if (/online|virtual|stream|livestream|live stream|hybrid/i.test(s)) delivery = "hybrid";
  let cost = ev.srcCost;
  if (/free|gratis|no charge|open to all|free entry/i.test(s)) cost = 0;
  return { kind, delivery, cost };
}

function interestHits(ev) {
  const text = ((ev.wideSnippet || ev.snippet || "") + " " + ev.venue).toLowerCase();
  const hits = [];
  for (const d of INTERESTS) {
    let n = 0;
    for (const kw of d.kw) if (text.indexOf(kw) !== -1) n += 1;
    if (n > 0) hits.push({ code: d.code, name: d.name, n });
  }
  if (hits.length === 0) {
    const a = VENUE_AFFINITY[ev.venue];
    if (a) hits.push({ code: "VEN", name: "venue-affinity:" + ev.venue, n: 0, affinity: true });
  }
  hits.sort((a, b) => b.n - a.n);
  return hits;
}

function kwEvidence(g) { return (g.e.interestDetail || []).some((h) => h.n >= 1); }

function kindFriction(kind) {
  const m = { festival: 0, performance: 1, talk: 1, film: 1, event: 2, exhibition: 2, concert: 2 };
  return m[kind] !== undefined ? m[kind] : 2;
}
function deliveryFriction(d) { return d === "onsite" ? 1 : d === "hybrid" ? 0 : 2; }
function costFriction(c) { return c === 0 ? 0 : c === 1 ? 1 : 2; }

function scoreEvent(ev) {
  const c = classify(ev);
  const hits = interestHits(ev);
  const affinity = VENUE_AFFINITY[ev.venue] || 0;
  const strong = hits.filter((h) => h.n >= 2).length;
  let relevance = hits.length === 0 ? 0 : Math.min(10, 2 + hits.length + strong + affinity);
  if (STANDING_DROP.test(((ev.snippet || "") + " " + ev.venue).toLowerCase())) relevance = 0;
  const friction = Math.min(10, kindFriction(c.kind) + deliveryFriction(c.delivery) + costFriction(c.cost));
  const priority = Math.round((relevance * 10) / (1 + friction) * 10) / 10;
  return {
    ...ev, kind: c.kind, delivery: c.delivery, cost: c.cost,
    interests: hits.slice(0, 4).map((h) => h.code),
    interestDetail: hits.slice(0, 4),
    relevance, friction, priority,
    frictionClass: friction <= 2 ? "LOW" : friction <= 5 ? "MED" : "HIGH"
  };
}

async function computeBudget(env) { // S-2: travel gate ledger read (inert while all sources local)
  const r = await env.PERSONAL_DB.prepare(
    "SELECT venue, start_date FROM events WHERE start_date>=? AND start_date<? AND category IN ('conference','workshop','school','program')"
  ).bind("2027-01-01", "2027-07-01").all();
  const seen = new Set();
  let booked = 0;
  for (const row of (r.results || [])) {
    const k = (row.venue || "") + "|" + String(row.start_date || "").slice(0, 10);
    if (!seen.has(k)) { seen.add(k); booked += 1; }
  }
  return { h1InPersonBooked: booked, h1SlotsLeft: Math.max(0, ENERGY.maxInPersonPerHalfYear - booked) };
}

function gateEvent(e, budget) {
  const reasons = [];
  const text = ((e.snippet || "") + " " + e.venue).toLowerCase();
  if (STANDING_DROP.test(text)) reasons.push("standing-filter:QPL/CWI");
  if (e.delivery === "onsite" && SCHENGEN_VENUES.includes(e.venue) && e.startIso >= SCHENGEN_EXIT) {
    reasons.push("schengen-exit:" + SCHENGEN_EXIT);
  }
  if (e.delivery === "onsite" && TRAVEL_KINDS.includes(e.kind) && !LOCAL_VENUES.includes(e.venue)) {
    if (ENERGY.h2_2026_spent && e.startIso < ENERGY.nextEligibility) reasons.push("energy-budget:H2-2026-spent");
    else if (e.startIso >= "2027-01-01" && e.startIso < "2027-07-01" && budget.h1SlotsLeft <= 0) reasons.push("energy-budget:H1-2027-full");
  }
  return { cleared: reasons.length === 0, reasons };
}

async function scanVenue(src) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(src.url, { headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow", signal: ctrl.signal });
    const text = await r.text();
    if (r.ok) return { name: src.name, ...extractEvents(text, src) };
    return { name: src.name, events: [], discarded: 0, error: "HTTP " + r.status };
  } catch (e) {
    return { name: src.name, events: [], discarded: 0, error: e && e.name === "AbortError" ? "timeout" : String((e && e.message) || e).slice(0, 100) };
  } finally { clearTimeout(t); }
}

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function calAuthH(env) { return env.CAL_TOKEN ? { Authorization: "Bearer " + env.CAL_TOKEN } : {}; }

async function fetchExistingCalendar(env) {
  try {
    const r = await env.CAL_API.fetch("https://calendar-api/events?plane=personal", { headers: calAuthH(env) });
    const j = await r.json();
    return (j.events || []).filter((e) => e.source === "personal-radar");
  } catch (e) { return []; }
}

function renderReport(scannedAt, horizon, gated, budget, stats, posted) {
  const L = [];
  L.push("PERSONAL-EVENTS-RADAR SCAN — generated " + scannedAt.slice(0, 10) + " (window: " + scannedAt.slice(0, 10) + " .. " + horizon + ")");
  L.push("[PERSONAL-RADAR: " + gated.length + " in-window events | " + stats.okVenues + "/" + stats.totalVenues + " venues ok | " + gated.filter((g) => g.cleared && g.e.relevance >= 3 && kwEvidence(g) && !g.e.runningUntil && !g.e.runningUntilMonth).length + " cleared | " + posted.posted + " posted this run]");
  L.push("");
  L.push("Scope: PERSONAL LIFE only (museums, concerts, performance, queer arts, festivals,");
  L.push("local Amsterdam culture). Work/research venues live in events-radar, not here.");
  L.push("Ranking rule: priority = 10 x relevance / (1 + friction). Friction = kind + delivery + cost.");
  L.push("Gates: standing filter (QPL/CWI) -> Schengen exit 2026-10-17 (onsite Amsterdam events)");
  L.push("-> in-person TRAVEL budget (applies only to non-local travel events; all current");
  L.push("sources are Amsterdam-local, so the travel gate is inert but enforced).");
  L.push("Calendar POST rule: cleared gates AND relevance >= 3 AND at least one keyword hit.");
  L.push("RUNNING-UNTIL exhibitions are report-only: the date shown is the CLOSING date, never");
  L.push("posted to the calendar as an event on that day.");
  L.push("");
  const cleared = gated.filter((g) => g.cleared && g.e.relevance >= 3);
  const top = cleared.filter((g) => !g.e.runningUntil && !g.e.runningUntilMonth && g.e.priority >= 4 && g.e.frictionClass !== "HIGH").sort((a, b) => b.e.priority - a.e.priority || a.e.startIso.localeCompare(b.e.startIso)).slice(0, 10);
  L.push("## Top picks - personal relevance / friction");
  if (top.length === 0) L.push("_No events cleared the top-pick threshold this scan._");
  for (const g of top) {
    const e = g.e;
    L.push("- [P " + e.priority + " | " + e.frictionClass + " friction] " + e.startIso + " [" + e.kind + "|" + e.delivery + "|" + (e.cost === 0 ? "free" : e.cost === 1 ? "fee?" : "paid") + "] " + e.venue + ": " + e.snippet.slice(0, 110) + "  -> " + (e.interests.join("/") || "-") + "  <" + e.url + ">");
  }
  const t90 = scannedAt.slice(0, 10);
  const t90end = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const tasting = gated.filter((g) => g.cleared && !g.e.runningUntil && !g.e.runningUntilMonth && g.e.relevance >= 2 && g.e.friction <= 2 && g.e.startIso >= t90 && g.e.startIso <= t90end)
    .sort((a, b) => a.e.friction - b.e.friction || b.e.relevance - a.e.relevance).slice(0, 5);
  L.push("");
  L.push("## Tasting menu - 3-5 cheap local experiments over the next 90 days");
  if (tasting.length === 0) L.push("_No cheap low-friction experiments surfaced this scan._");
  for (const g of tasting) {
    const e = g.e;
    L.push("- " + e.startIso + " [" + e.kind + "|" + e.delivery + "|" + (e.cost === 0 ? "free" : "fee?") + "] " + e.venue + ": " + e.snippet.slice(0, 110) + "  <" + e.url + ">");
  }
  L.push("");
  L.push("## Budget and gates");
  L.push("- in-person TRAVEL budget: H2 2026 SPENT (LoF26 + QPL26); H1 2027 ledger shows " + budget.h1InPersonBooked + " booked, " + budget.h1SlotsLeft + " slot(s) left.");
  L.push("- local Amsterdam events do NOT consume the travel budget; the gate enforces only non-local travel kinds.");
  L.push("- Schengen exit deadline: 2026-10-17. Onsite Amsterdam events on/after that date are blocked.");
  L.push("- standing filter: QPL / CWI topics excluded from personal recommendations.");
  L.push("- posted to calendar-api plane=personal: " + posted.posted + " new (dedupe skipped " + posted.skipped + ").");
  L.push("");
  L.push("## All in-window events (gate tags)");
  const chrono = gated.slice().sort((a, b) => a.e.startIso.localeCompare(b.e.startIso) || a.e.venue.localeCompare(b.e.venue));
  for (const g of chrono) {
    const e = g.e;
    let tag;
    if (e.runningUntil || e.runningUntilMonth) tag = "RUNNING-UNTIL (closes " + e.startIso + ", report-only)";
    else if (g.cleared) tag = e.relevance >= 3 ? "CLEARED" : "LOW-RELEVANCE";
    else tag = g.reasons.join("; ");
    L.push("- " + e.startIso + (e.endIso && e.endIso !== e.startIso ? ".." + e.endIso : "") + " [" + e.kind + "|" + e.delivery + "|" + (e.cost === 0 ? "free" : e.cost === 1 ? "fee?" : "paid") + "] " + e.venue + ": " + e.snippet.slice(0, 100) + "  [" + tag + "]");
  }
  L.push("");
  L.push("## Source health");
  L.push("- venues ok: " + stats.okVenues + "/" + stats.totalVenues + " | discarded: " + stats.discarded + " | venue errors: " + stats.venueErrors.length);
  for (const v of stats.venueErrors) L.push("- ERR " + v.venue + ": " + v.error);
  return L.join(LF);
}

async function ensureSchema(env) {
  await env.AUDIT_DB.prepare(
    "CREATE TABLE IF NOT EXISTS personal_radar (slug TEXT PRIMARY KEY, report TEXT, events_json TEXT, posted_json TEXT, scanned_at TEXT, updated_at TEXT)"
  ).run();
}

async function run(env) {
  await ensureSchema(env);
  const scannedAt = new Date().toISOString();
  const nowIso = scannedAt.slice(0, 10);
  const horizon = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const budget = await computeBudget(env);

  const results = await Promise.allSettled(SOURCES.map((s) => scanVenue(s)));
  const rawEvents = [];
  const venueErrors = [];
  let discarded = 0;
  results.forEach((res, i) => {
    if (res.status === "fulfilled" && res.value) {
      if (res.value.error) venueErrors.push({ venue: SOURCES[i].name, error: res.value.error });
      else { rawEvents.push(...res.value.events); discarded += res.value.discarded; }
    } else venueErrors.push({ venue: SOURCES[i].name, error: String((res.reason || "?").slice(0, 100)) });
  });

  const inWindow = rawEvents.filter((e) => e.startIso >= nowIso && e.startIso <= horizon);
  const scored = inWindow.map(scoreEvent);
  const seen = new Set();
  const uniq = scored.filter((e) => { const k = e.venue + "|" + e.startIso; if (seen.has(k)) return false; seen.add(k); return true; });
  const gated = uniq.map((e) => ({ e, ...gateEvent(e, budget) }));

  const existing = await fetchExistingCalendar(env);
  const existingKeys = new Set(existing.map((x) => String(x.location || "").toLowerCase() + "|" + String(x.dtstart || "").slice(0, 10)));
  let ledgerRows = [];
  try {
    const lr = await env.PERSONAL_DB.prepare("SELECT venue, start_date FROM events WHERE start_date>=?").bind(nowIso).all();
    ledgerRows = lr.results || [];
  } catch (e) { /* ledger read best-effort */ }
  const ledgerSlugs = ledgerRows.map((x) => ({ v: slug(x.venue), d: String(x.start_date || "").slice(0, 10) }));

  let posted = 0, skipped = 0;
  const postedList = [];
  for (const g of gated) {
    if (g.e.runningUntil || g.e.runningUntilMonth) { skipped += 1; continue; } // M-1 report-only
    if (!g.cleared || g.e.relevance < 3 || !kwEvidence(g)) continue;
    let title = g.e.venue + ": " + g.e.snippet.slice(0, 90);
    const cut = title.lastIndexOf(" ");
    if (cut > 30) title = title.slice(0, cut); // S-4 word-boundary trim
    const key = g.e.venue.toLowerCase() + "|" + g.e.startIso;
    const kSlug = slug(g.e.venue);
    const ledgerDup = ledgerSlugs.some((r) => r.d === g.e.startIso && (r.v.indexOf(kSlug) !== -1 || kSlug.indexOf(r.v) !== -1)); // S-3 containment
    if (existingKeys.has(key) || ledgerDup) { skipped += 1; continue; }
    if (posted >= 8) { skipped += 1; continue; }
    const body = {
      title, dtstart: g.e.startIso, dtend: g.e.endIso, all_day: false,
      location: g.e.venue, url: g.e.url, source: "personal-radar",
      domain: g.e.interests[0] || null, relevance: g.e.relevance, friction: g.e.friction,
      status: "tentative", description: g.e.snippet.slice(0, 300)
    };
    try {
      const pr = await env.CAL_API.fetch("https://calendar-api/events?plane=personal", {
        method: "POST", headers: Object.assign({ "content-type": "application/json" }, calAuthH(env)), body: JSON.stringify(body)
      });
      if (pr.ok) {
        posted += 1;
        postedList.push({ title, dtstart: g.e.startIso, id: (await pr.json()).id || null });
        existingKeys.add(key);
      } else skipped += 1;
    } catch (e) { skipped += 1; }
  }

  const stats = { inWindow: uniq.length, discarded, okVenues: SOURCES.length - venueErrors.length, totalVenues: SOURCES.length, venueErrors, horizonISO: horizon };
  const report = renderReport(scannedAt, horizon, gated, budget, stats, { posted, skipped });
  const slugN = "personal-events-radar-" + scannedAt.slice(0, 10);

  let delivery = null;
  try {
    if (env.OBSIDIAN_WRITER) {
      const dr = await env.OBSIDIAN_WRITER.fetch("https://obsidian-writer/", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "personal-events-radar", section: "Personal Events Radar", content: report, date: scannedAt.slice(0, 10) })
      });
      delivery = { status: dr.status, ok: dr.ok };
    }
  } catch (e) { delivery = { error: String((e && e.message) || e).slice(0, 120) }; }

  await env.AUDIT_DB.prepare(
    "INSERT OR REPLACE INTO personal_radar (slug, report, events_json, posted_json, scanned_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(slugN, report, JSON.stringify(gated), JSON.stringify(postedList), scannedAt, scannedAt).run();

  return {
    slug: slugN, version: VERSION, events: uniq.length, discarded, venueErrors: venueErrors.length,
    budget, posted: postedList, delivery,
    topPicks: gated.filter((g) => g.cleared && !g.e.runningUntil && !g.e.runningUntilMonth && g.e.relevance >= 3).sort((a, b) => b.e.priority - a.e.priority).slice(0, 5)
      .map((g) => "P" + g.e.priority + " " + g.e.startIso + " " + g.e.venue + " " + g.e.interests.join("/") + " [" + g.e.delivery + "]")
  };
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" && url.searchParams.get("run") === "1") {
      const out = await run(env);
      return new Response(JSON.stringify({ ok: true, ...out }), { headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/") {
      const rows = await env.AUDIT_DB.prepare("SELECT report FROM personal_radar ORDER BY scanned_at DESC LIMIT 1").all();
      const latest = rows.results && rows.results[0];
      return new Response(latest ? latest.report : "No scan yet. GET /?run=1", { headers: { "content-type": "text/markdown" } });
    }
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: WORKER, version: VERSION }), { headers: { "content-type": "application/json" } });
    }
    return new Response("personal-events-radar worker: GET / (latest report) | GET /?run=1 (trigger scan) | GET /health", { status: 404 });
  }
};
