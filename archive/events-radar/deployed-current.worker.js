// events-radar Worker - QNFO.OPS.009 (supersedes conference-radar QNFO.OPS.008)
// v1.0.0 (2026-09-02): generalized Events Radar.
// PURPOSE: periodic scan of event/calendar pages across ALL active QNFO research domains
//   (conferences, workshops, seminars, colloquia, webinars, meetups, summer schools,
//   submission deadlines). Ranks every event by RELEVANCE to active QNFO research and by
//   ATTENDANCE FRICTION (time/travel/cost) so a free 1-hour relevant webinar outranks a
//   paid conference requiring travel. Delivers a ranked markdown report to obsidian-writer
//   (R2 vault -> D:/Obsidian) and optionally qnfo-email; persists to D1 qnfo-audit.events_radar.
// CAPABILITIES: parallel venue scan (per-venue 8s AbortController timeout), date-range and
//   single-date extraction, kind/delivery/cost classification, domain-keyword relevance,
//   friction scoring, canonical-catalog verification against live source pages, deadline flags.
// DEPLOY: cd qnfo-workers/events-radar && wrangler deploy  (wrangler.toml: RADAR_DB D1 qnfo-audit)
// CANONICAL SOURCE: github.com/QNFO/qnfo-workers -> qnfo-workers/events-radar/worker.js
const VERSION = "1.0.1";
const WORKER = "events-radar";

// ---- Active QNFO research domains (WBS.TAXONOMY 2026-08-29 + research programs) ----
const DOMAINS = [
  { code: "ADL", name: "Adelic Physics / p-adic info", kw: ["adelic", "p-adic", "idelic", "non-archimedean", "shannon", "rate-distortion", "rate distortion", "entropy", "number theory", "adele", "adelic shannon"] },
  { code: "UMP", name: "Ultrametric foundations / physics foundations", kw: ["ultrametric", "non-archimedean", "hierarchical", "quantum foundations", "foundations of physics", "philosophy of physics", "spacetime", "space-time", "emergence", "renormalization", "foundations"] },
  { code: "SLB", name: "Laws of Form / distinction primitives", kw: ["laws of form", "spencer-brown", "spencer brown", "calculus of indications", "distinction", "re-entry", "reentry", "idempotent", "paradox", "loaf", "brownian"] },
  { code: "INM", name: "Infomatics / information theory", kw: ["information theory", "infomatics", "maxwell", "szilard", "semantic information", "algorithmic information", "kolmogorov", "mutual information", "channel", "coding theory"] },
  { code: "QD", name: "Quantum info / foundations / qubit", kw: ["qubit", "quantum", "qip", "quantum error correction", "quantum algorithm", "quantum information", "decoherence", "entanglement", "quantum computing", "quantum cryptography"] },
  { code: "CMP", name: "Computing machines / models of computation", kw: ["automata", "cellular automata", "lambda calculus", "computability", "turing", "computation", "reversible computation", "formal languages", "hypercomputation", "memcomputing"] },
  { code: "JPC", name: "Energy-efficient / thermodynamic computing", kw: ["energy-efficient", "energy efficient", "green computing", "sustainable computing", "carbon", "landauer", "joules", "energy benchmark", "low-power", "thermodynamic computing", "power consumption", "frugal"] },
  { code: "SR", name: "Cryptography", kw: ["cryptograph", "post-quantum", "side-channel", "side channel", "lattice", "encryption", "privacy", "crypto"] },
  { code: "CON", name: "Complexity science / networks / consilience", kw: ["complex", "network", "consilience", "interdisciplinary", "systems", "agent-based"] },
  { code: "CGS", name: "Gap synthesis / research programs", kw: ["gap synthesis", "portfolio", "research program", "research agenda"] },
  { code: "ODR", name: "Discrete physics (Compton count)", kw: ["compton", "discrete", "counting", "causal", "geometry", "primitive"] },
  { code: "PBO", name: "Pattern-based ontology", kw: ["ontology", "autaxys", "pattern", "taxonomy", "knowledge representation", "categories"] },
  { code: "CFE", name: "Cascading foresight", kw: ["foresight", "anticipation", "forecasting", "futures"] },
  { code: "LOG", name: "Foundations of math / logic", kw: ["logic", "foundations of mathematics", "proof", "type theory", "category theory", "topos", "univalent", "homotopy", "set theory", "symbolic logic"] }
];

// ---- Source catalog: name, page url, default kind, domain affinities, delivery/cost defaults ----
// kind: conference|workshop|school|seminar|colloquium|webinar|meetup|lecture|other
const SOURCES = [
  { name: "CWI", url: "https://www.cwi.nl/en/events/", kind: "workshop", domains: ["ADL", "INM", "CMP", "QD"], delivery: "hybrid", cost: 1 },
  { name: "Perimeter", url: "https://perimeterinstitute.ca/conferences", kind: "conference", domains: ["UMP", "QD", "ADL", "INM"], delivery: "hybrid", cost: 1 },
  { name: "FQXi", url: "https://fqxi.org/events", kind: "other", domains: ["UMP", "QD", "SLB", "INM", "ADL"], delivery: "online", cost: 0 },
  { name: "IQOQI", url: "https://iqoqi.at", kind: "colloquium", domains: ["QD", "UMP"], delivery: "hybrid", cost: 0 },
  { name: "MPI-PKS", url: "https://www.pks.mpg.de/events/workshops-seminars/", kind: "workshop", domains: ["UMP", "INM", "CMP"], delivery: "onsite", cost: 1 },
  { name: "SFI", url: "https://www.santafe.edu/events", kind: "seminar", domains: ["CON", "INM", "CFE"], delivery: "hybrid", cost: 0 },
  { name: "QuSoft", url: "https://www.qusoft.org", kind: "workshop", domains: ["QD", "CMP"], delivery: "hybrid", cost: 0 },
  { name: "QuTech", url: "https://www.qutech.nl/events/", kind: "event", domains: ["QD", "JPC"], delivery: "hybrid", cost: 0 },
  { name: "CSH", url: "https://www.csh.ac.at/events/", kind: "webinar", domains: ["CON", "INM", "CFE", "JPC"], delivery: "hybrid", cost: 0 },
  { name: "CSS", url: "https://cssociety.org/events", kind: "conference", domains: ["CON", "INM", "CFE"], delivery: "onsite", cost: 2 },
  { name: "CNA", url: "https://www.complexnetworks.org/", kind: "conference", domains: ["CON", "INM"], delivery: "onsite", cost: 2 },
  { name: "QIP", url: "https://qipconference.org/", kind: "conference", domains: ["QD", "CMP", "SR"], delivery: "onsite", cost: 2 },
  // --- expanded domain scope (2026-09-02, QNFO.OPS.009) ---
  { name: "HotCarbon", url: "https://hotcarbon.org/", kind: "workshop", domains: ["JPC", "CMP"], delivery: "onsite", cost: 1 },
  { name: "ACM-eEnergy", url: "https://energy.acm.org/", kind: "conference", domains: ["JPC", "CMP"], delivery: "onsite", cost: 2 },
  { name: "QWorld", url: "https://qworld.net/", kind: "webinar", domains: ["QD", "CMP"], delivery: "online", cost: 0 },
  { name: "QCrypt", url: "https://qcrypt.net/", kind: "conference", domains: ["SR", "QD"], delivery: "onsite", cost: 2 },
  { name: "IACR", url: "https://www.iacr.org/events/", kind: "conference", domains: ["SR"], delivery: "onsite", cost: 2 },
  { name: "RealWorldCrypto", url: "https://rwc.iacr.org/", kind: "conference", domains: ["SR"], delivery: "onsite", cost: 2 },
  { name: "ASL", url: "https://aslonline.org/meetings/", kind: "meeting", domains: ["LOG", "SLB"], delivery: "hybrid", cost: 1 },
  { name: "IAOA", url: "https://iaoa.org/", kind: "other", domains: ["PBO", "LOG"], delivery: "online", cost: 0 },
  { name: "ICTP", url: "https://www.ictp.it/events", kind: "school", domains: ["UMP", "ADL", "INM", "LOG"], delivery: "hybrid", cost: 1 },
  { name: "IHES", url: "https://www.ihes.fr/en/events/", kind: "lecture", domains: ["UMP", "ADL", "LOG"], delivery: "hybrid", cost: 0 },
  { name: "ESI", url: "https://www.esi.ac.at/events", kind: "workshop", domains: ["UMP", "ADL", "LOG"], delivery: "hybrid", cost: 1 },
  { name: "NetSci", url: "https://netscisociety.net/events", kind: "conference", domains: ["CON", "INM"], delivery: "hybrid", cost: 2 }
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Canonical deadline flags (verified 2026-09-02; AoE = UTC-12)
const DEADLINE_FLAGS = [
  { label: "QIP 2027 talk submission", deadline: "2026-10-05T23:59:00-12:00", venue: "QIP", note: "Quantum Information Processing 2027 talk submission (AoE)" }
];

// Canonical catalog: specific high-value events kept across scans. Each carries a verify
// URL + token; at scan time the worker fetches the page and marks VERIFIED only when the
// token is present, else CANDIDATE-UNVERIFIED (check the link).
const CATALOG = [
  { title: "QIP 2027 - 30th Conference on Quantum Information Processing", start: "2027-02-20", end: "2027-02-26", kind: "conference", delivery: "onsite", cost: 2, domains: ["QD", "CMP", "SR"], url: "https://qipconference.org/", note: "NUS Singapore. Talk submission 2026-10-05 (AoE).", deadline: "2026-10-05T23:59:00-12:00", verify: { url: "https://qipconference.org/", token: "2027" } },
  { title: "IEEE Quantum Week QCE26 (incl. Q-SET)", start: "2026-09-13", end: "2026-09-18", kind: "conference", delivery: "onsite", cost: 2, domains: ["QD", "CMP"], url: "https://qce.quantum.ieee.org/", note: "Toronto, Canada.", verify: { url: "https://qce.quantum.ieee.org/", token: "QCE26" } },
  { title: "HotCarbon - Hot Topics in Carbon Computing workshop", start: null, end: null, kind: "workshop", delivery: "onsite", cost: 1, domains: ["JPC", "CMP"], url: "https://hotcarbon.org/", note: "Energy/carbon-efficient systems workshop (co-located with systems conf).", verify: { url: "https://hotcarbon.org/", token: "carbon" } },
  { title: "QCrypt - International Conf. on Quantum Cryptography", start: null, end: null, kind: "conference", delivery: "onsite", cost: 2, domains: ["SR", "QD"], url: "https://qcrypt.net/", note: "Annual quantum cryptography conference.", verify: { url: "https://qcrypt.net/", token: "qcrypt" } },
  { title: "Delft Quantum Showcase (QuTech)", start: null, end: null, kind: "event", delivery: "onsite", cost: 0, domains: ["QD"], url: "https://www.qutech.nl/events/", note: "Public showcase at QuTech Delft.", verify: { url: "https://www.qutech.nl/events/", token: "showcase" } }
];

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";

const ENTITY_MAP = { amp: "&", lt: "<", gt: ">", quot: String.fromCharCode(34), apos: String.fromCharCode(39), nbsp: " ", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", times: "×", middot: "·", sdot: "⋅", minus: "−", deg: "°", micro: "µ" };
function decodeEntities(x) {
  return String(x || "").replace(/&#x([0-9a-fA-F]+);|&#([0-9]+);|&([a-zA-Z][a-zA-Z0-9]*);/g, function(m, hx, dec, name) {
    if (hx) { try { return String.fromCodePoint(parseInt(hx, 16)); } catch (e) { return m; } }
    if (dec) { try { return String.fromCodePoint(parseInt(dec, 10)); } catch (e) { return m; } }
    return Object.prototype.hasOwnProperty.call(ENTITY_MAP, name) ? ENTITY_MAP[name] : m;
  });
}
function cleanHtml(text) {
  const s = String(text || "").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}

function pad2(n) { return String(n).padStart(2, "0"); }

// extract dated events from page text for one source
function extractEvents(text, src) {
  const events = [];
  let discarded = 0;
  const clean = cleanHtml(text);
  const cutYear = new Date().getFullYear();
  const dropGarbage = (s) => /\.st\d+\s*\{|fill\s*:\s*none|"id"\s*:\s*\d+\s*,|window\.|function\s+\(/i.test(s);
  const seen = new Set();
  // range first: "Sep 13 - 18, 2026" | "13 - 18 Sep 2026"
  const rangeRe = new RegExp("(" + MONTH_RE + ")[a-z]*\\.?\\s+(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})\\s*,?\\s*(20\\d{2})", "gi");
  const rangeRe2 = new RegExp("(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})\\s+(" + MONTH_RE + ")[a-z]*\\.?\\s*,?\\s*(20\\d{2})", "gi");
  const singleRe = new RegExp("(" + MONTH_RE + ")[a-z]*\\.?\\s+(\\d{1,2})\\s*,?\\s*(20\\d{2})", "gi");
  const singleRe2 = new RegExp("(\\d{1,2})\\s+(" + MONTH_RE + ")[a-z]*\\.?\\s*,?\\s*(20\\d{2})", "gi");

  const push = (mo, d1, d2, yr, idx) => {
    const mon = (mo || "").toLowerCase().slice(0, 3);
    const month = MONTHS[mon];
    if (!month) { discarded += 1; return; }
    const year = yr ? parseInt(yr, 10) : 0;
    if (year < cutYear || year > cutYear + 2) { discarded += 1; return; }
    const startIso = toISO(year, month, Math.min(d1 || 1, 28));
    const endIso = d2 ? toISO(year, month, Math.min(d2, 28)) : startIso;
    const key = src.name + "|" + startIso;
    if (seen.has(key)) return;
    const snippet = clean.slice(Math.max(0, idx - 80), idx + 200).slice(0, 240);
    if (dropGarbage(snippet)) { discarded += 1; return; }
    seen.add(key);
    const dateText = (d2 ? mo + " " + d1 + "-" + d2 + ", " + year : mo + " " + d1 + ", " + year);
    events.push({ venue: src.name, dateText, startIso, endIso, year, month, day: d1 || null, url: src.url, snippet, srcKind: src.kind, srcDelivery: src.delivery, srcCost: src.cost, srcDomains: (src.domains || []).slice() });
  };
  function toISO(y, m, d) { return y + "-" + pad2(m) + "-" + pad2(d); }

  for (const m of clean.matchAll(rangeRe)) push(m[1], parseInt(m[2], 10), parseInt(m[3], 10), m[4], m.index);
  for (const m of clean.matchAll(rangeRe2)) push(m[3], parseInt(m[1], 10), parseInt(m[2], 10), m[4], m.index);
  for (const m of clean.matchAll(singleRe)) push(m[1], parseInt(m[2], 10), null, m[3], m.index);
  for (const m of clean.matchAll(singleRe2)) push(m[2], parseInt(m[1], 10), null, m[3], m.index);

  const kept = events.slice(0, 16);
  discarded += Math.max(0, events.length - kept.length);
  return { events: kept, discarded };
}

// ---- classification: kind / delivery / cost from snippet + source defaults ----
function classify(ev) {
  const s = (ev.snippet || "").toLowerCase();
  let kind = ev.srcKind;
  if (/webinar|online seminar|zoom|livestream|live stream|youtube|virtual talk/i.test(s)) kind = "webinar";
  else if (/meetup|community|networking|hackathon/i.test(s)) kind = "meetup";
  else if (/summer school|winter school|school on|doctoral school/i.test(s)) kind = "school";
  else if (/workshop/i.test(s)) kind = "workshop";
  else if (/colloquium/i.test(s)) kind = "colloquium";
  else if (/seminar/i.test(s)) kind = "seminar";
  else if (/lecture|public talk|talk:/i.test(s)) kind = "lecture";
  else if (/conference|symposium/i.test(s)) kind = "conference";

  const hasInPerson = /in person|in-person|onsite|on-site|venue|location:|conference centre|university|hotel/i.test(s);
  let delivery = ev.srcDelivery;
  if (/online|virtual|webinar|zoom|remote|livestream|live stream|youtube|hybrid/i.test(s)) delivery = hasInPerson ? "hybrid" : "online";
  else if (hasInPerson) delivery = "onsite";

  let cost = ev.srcCost;
  if (/free|no fee|complimentary|donation|open to all|no registration fee/i.test(s)) cost = 0;
  else if (/registration fee|\bfee\b|ticket|registration required|paypal|checkout/i.test(s)) cost = 1;

  return { kind, delivery, cost };
}

// ---- relevance: count per-domain keyword hits over snippet ----
function domainHits(ev) {
  const text = ((ev.snippet || "") + " " + ev.venue).toLowerCase();
  const hits = [];
  for (const d of DOMAINS) {
    let n = 0;
    for (const kw of d.kw) if (text.indexOf(kw) !== -1) n += 1;
    if (n > 0) hits.push({ code: d.code, name: d.name, n });
  }
  // venue affinity counts as weak evidence when the snippet has no keyword hit
  if (hits.length === 0 && Array.isArray(ev.srcDomains)) {
    for (const code of ev.srcDomains.slice(0, 4)) {
      const d = DOMAINS.find((x) => x.code === code);
      if (d && !hits.some((h) => h.code === code)) hits.push({ code: d.code, name: d.name, n: 0, affinity: true });
    }
  }
  hits.sort((a, b) => b.n - a.n);
  return hits;
}

function kindFriction(kind) {
  const m = { webinar: 0, meetup: 1, lecture: 1, seminar: 1, meeting: 1, colloquium: 2, event: 2, other: 2, workshop: 3, school: 4, conference: 5 };
  return m[kind] !== undefined ? m[kind] : 2;
}
function deliveryFriction(d) { return d === "online" ? 0 : d === "hybrid" ? 1 : d === "onsite" ? 3 : 2; }
function costFriction(c) { return c === 0 ? 0 : c === 1 ? 1 : 2; }

function scoreEvent(ev) {
  const c = classify(ev);
  const hits = domainHits(ev);
  const domainCount = hits.length;
  const strong = hits.filter((h) => h.n >= 2).length;
  const relevance = domainCount === 0 ? 0 : Math.min(10, 2 + domainCount + strong);
  const friction = Math.min(10, kindFriction(c.kind) + deliveryFriction(c.delivery) + costFriction(c.cost));
  const priority = Math.round((relevance * 10) / (1 + friction) * 10) / 10;
  return {
    ...ev,
    kind: c.kind,
    delivery: c.delivery,
    cost: c.cost,
    domains: hits.slice(0, 4).map((h) => h.code),
    domainDetail: hits.slice(0, 4),
    relevance,
    friction,
    priority,
    frictionClass: friction <= 2 ? "LOW" : friction <= 5 ? "MED" : "HIGH"
  };
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

function flagStatus(deadlineIso, now) {
  const dl = new Date(deadlineIso).getTime();
  const days = (dl - now.getTime()) / 86400000;
  if (days < 0) return "PASSED";
  if (days <= 7) return "IMMINENT";
  if (days <= 30) return "UPCOMING";
  return "FUTURE";
}

async function verifyCatalog(env) {
  const out = [];
  for (const c of CATALOG) {
    let verified = false;
    let err = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(c.verify.url, { headers: { "User-Agent": UA }, redirect: "follow", signal: ctrl.signal });
      clearTimeout(t);
      const text = await r.text();
      verified = r.ok && text.toLowerCase().indexOf(c.verify.token.toLowerCase()) !== -1;
    } catch (e) { err = String((e && e.message) || e).slice(0, 80); }
    out.push({ ...c, verified, verifyError: err });
  }
  return out;
}

function fmtDate(iso) { return iso ? iso : "TBA"; }
function costLabel(c) { return c === 0 ? "free" : c === 1 ? "fee?" : "paid"; }

function renderReport(scannedAt, nowIso, scored, flags, catalogs, stats) {
  const L = [];
  const horizon = stats.horizonISO;
  L.push("EVENTS-RADAR SCAN — generated " + scannedAt.slice(0, 10) + " (window: " + scannedAt.slice(0, 10) + " .. " + horizon + ")");
  L.push("[EVENTS-RADAR: " + stats.inWindow + " events | " + stats.okVenues + " venues ok | " + stats.catalogVerified + "/" + catalogs.length + " catalog verified | " + flags.length + " deadline " + (flags.length === 1 ? "flag" : "flags") + "]");
  L.push("");
  L.push("Ranking rule: priority = 10 × relevance ÷ (1 + friction). Friction = kind + delivery + cost");
  L.push("(0 = free online webinar … 10 = paid multi-day conference abroad). Free low-friction");
  L.push("relevant events are ranked above costly travel conferences by design.");
  L.push("");
  // ---- Top picks ----
  const top = scored.filter((e) => e.relevance >= 4 && e.priority >= 4 && e.frictionClass !== "HIGH").sort((a, b) => b.priority - a.priority || a.startIso.localeCompare(b.startIso)).slice(0, 10);
  L.push("## Top picks — relevance ÷ friction");
  if (top.length === 0) L.push("_No events cleared the top-pick threshold this scan._");
  for (const e of top) {
    L.push("- [P " + e.priority + " | " + e.frictionClass + " friction] " + fmtDate(e.startIso) + " [" + e.kind + "|" + e.delivery + "|" + costLabel(e.cost) + "] " + e.venue + ": " + e.snippet.slice(0, 120) + "  → " + e.domains.join("/") + "  <" + e.url + ">");
  }
  // ---- Upcoming chronological ----
  const upcoming = scored.slice().sort((a, b) => a.startIso.localeCompare(b.startIso) || a.venue.localeCompare(b.venue));
  L.push("");
  L.push("## Upcoming events (chronological, window ≤ " + horizon + ")");
  if (upcoming.length === 0) L.push("_None in window._");
  for (const e of upcoming) {
    L.push("- " + fmtDate(e.startIso) + (e.endIso && e.endIso !== e.startIso ? "…" + e.endIso : "") + " [" + e.kind + "|" + e.delivery + "|" + costLabel(e.cost) + "] " + e.venue + ": " + e.snippet.slice(0, 130) + "  → " + (e.domains.join("/") || "—") + "  <" + e.url + ">");
  }
  // ---- Deadline flags ----
  L.push("");
  L.push("## Deadline flags");
  for (const f of flags) L.push("- [" + f.status + "] " + f.label + " — " + f.deadline + " (" + f.note + ")");
  // ---- Catalog ----
  L.push("");
  L.push("## Canonical catalog (re-verified against source page each scan)");
  for (const c of catalogs) {
    const tag = c.verified ? "VERIFIED" : (c.verifyError ? "UNREACHABLE" : "CANDIDATE-UNVERIFIED");
    L.push("- [" + tag + "] " + c.title + (c.start ? "  " + c.start + (c.end && c.end !== c.start ? ".." + c.end : "") : "") + " [" + c.kind + "|" + c.delivery + "|" + costLabel(c.cost) + "|" + c.domains.join("/") + "]  " + c.note + "  <" + c.url + ">" + (c.deadline ? "  deadline " + c.deadline : ""));
  }
  // ---- Source health ----
  L.push("");
  L.push("## Source health");
  L.push("- venues ok: " + stats.okVenues + "/" + stats.totalVenues + " | discarded: " + stats.discarded + " | venue errors: " + stats.venueErrors.length);
  for (const v of stats.venueErrors) L.push("- ERR " + v.venue + ": " + v.error);
  return L.join("\n");
}

async function ensureSchema(env) {
  await env.RADAR_DB.prepare("CREATE TABLE IF NOT EXISTS events_radar (slug TEXT PRIMARY KEY, report TEXT, events_json TEXT, scanned_at TEXT, updated_at TEXT, curated_json TEXT, flags_json TEXT)").run();
  for (const col of ["curated_json", "flags_json"]) {
    try { await env.RADAR_DB.prepare("ALTER TABLE events_radar ADD COLUMN " + col + " TEXT").run(); } catch (e) { /* already exists */ }
  }
}

async function run(env) {
  await ensureSchema(env);
  const scannedAt = new Date().toISOString();
  const now = new Date();
  const nowIso = scannedAt.slice(0, 10);
  const horizon = new Date(now.getTime() + 365 * 86400000).toISOString().slice(0, 10);

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

  // window: keep events with startIso >= today and <= horizon
  const inWindow = rawEvents.filter((e) => e.startIso >= nowIso && e.startIso <= horizon);
  const scored = inWindow.map(scoreEvent);
  // dedupe identical venue+iso
  const seen = new Set();
  const uniq = scored.filter((e) => { const k = e.venue + "|" + e.startIso; if (seen.has(k)) return false; seen.add(k); return true; });

  const flags = DEADLINE_FLAGS.map((f) => ({ ...f, status: flagStatus(f.deadline, now) })).filter((f) => f.status !== "PASSED");
  const catalogs = await verifyCatalog(env);

  const stats = {
    inWindow: uniq.length, discarded, okVenues: SOURCES.length - venueErrors.length, totalVenues: SOURCES.length,
    venueErrors, catalogVerified: catalogs.filter((c) => c.verified).length, horizonISO: horizon
  };
  const report = renderReport(scannedAt, nowIso, uniq, flags, catalogs, stats);
  const slug = "events-radar-" + scannedAt.slice(0, 10);

  let delivery = null;
  try {
    if (env.OBSIDIAN_WRITER) {
      const dr = await env.OBSIDIAN_WRITER.fetch("https://obsidian-writer/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "events-radar", section: "Events Radar", content: report, date: scannedAt.slice(0, 10) })
      });
      delivery = { status: dr.status, ok: dr.ok };
    }
  } catch (e) { delivery = { error: String((e && e.message) || e).slice(0, 120) }; }

  let email = null;
  try {
    if (env.EMAIL && env.EMAIL_API_KEY) {
      const er = await env.EMAIL.fetch("https://qnfo-email.internal/send", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.EMAIL_API_KEY },
        body: JSON.stringify({ to: "alerts@qnfo.org", subject: "Events Radar scan " + scannedAt.slice(0, 10), body: report })
      });
      email = { status: er.status, ok: er.ok };
    }
  } catch (e) { email = { error: String((e && e.message) || e).slice(0, 120) }; }

  await env.RADAR_DB.prepare(
    "INSERT OR REPLACE INTO events_radar (slug, report, events_json, curated_json, flags_json, scanned_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(slug, report, JSON.stringify(uniq), JSON.stringify(catalogs), JSON.stringify(flags), scannedAt, scannedAt).run();

  return {
    slug, version: VERSION, events: uniq.length, discarded, venueErrors: venueErrors.length,
    catalogVerified: stats.catalogVerified + "/" + catalogs.length,
    flags: flags.map((f) => f.label + ":" + f.status),
    topPicks: uniq.slice().sort((a, b) => b.priority - a.priority).slice(0, 5).map((e) => "P" + e.priority + " " + e.startIso + " " + e.venue + " " + e.domains.join("/")),
    delivery, email
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
      const rows = await env.RADAR_DB.prepare("SELECT report FROM events_radar ORDER BY scanned_at DESC LIMIT 1").all();
      const latest = rows.results && rows.results[0];
      return new Response(latest ? latest.report : "No scan yet. GET /?run=1", { headers: { "content-type": "text/markdown" } });
    }
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: WORKER, version: VERSION }), { headers: { "content-type": "application/json" } });
    }
    return new Response("events-radar worker: GET / (latest report) | GET /?run=1 (trigger scan) | GET /health", { status: 404 });
  }
};
