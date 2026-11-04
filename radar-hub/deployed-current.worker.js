import { WorkflowEntrypoint } from "cloudflare:workers";
// HUB-VERSION-SCOPE-1 (2026-09-23): radar-hub's OWN version, at MODULE scope so the hub's
// `export default` can read it. Each embedded sub-worker IIFE declares its own version constant
// inside its own scope; a bare reference from module scope throws ReferenceError.
// 1.1.3 (2026-10-02, pillar: reach): JOB-MARKET-INLINE-1 (the weekly job-market scan runs from the cron and records a
// handoffs row with a claim_sheet), MENTION-RADAR-LEDGER-1 (one cloud_ops_events row per mention-radar run day),
// EVENTS-RADAR-CF-DOW-1 (events cron moved from Sunday to Monday, the day its weekly sources are read).
var VERSION = "1.6.0-heartbeat-retry";
// agent_issues 1000854, 1000787 (#5485): bounded transient D1 heartbeat retries; one bumpable hub VERSION.
// 1.5.0 RADAR-VENUE-RECOVERED-1 (agent_issues 2573, pillar personal; minor: a decision radar-hub now takes on its own): a venue that yields usable candidates again closes the open RADAR-VENUE-SILENT-1 issue this worker filed, through issue_triage.close_evidence (close_channel auto-recovery); the run result lists recoveredVenues. The counter already reset on recovery, but nothing closed the issue, so it sat open until the 48 h stale probe. venue-recovered.test.mjs. // 1.4.4 BAD-TAG-FILTER-1 (2026-10-19): HTML-to-text helpers handle odd end tags, unclosed blocks and entity order. // 1.4.3 WORKERS-BP-LOGGING-radar-hub-1 (2026-10-14, agent_issues 2540, child of 2342, pillar autonomy): the 13 swallowed catches log as a structured console.error (worker, where, error); control flow unchanged. // 1.4.2 FAMILIES-WINDOW-CLOCK-1: signal_source_families_7d counts its 7 days from the run clock, not the database clock.
function rhex(n) { var b = new Uint8Array(Math.ceil(n / 2)); crypto.getRandomValues(b); return Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("").slice(0, n); } // 1.3.5 CRYPTO-IDS-1: outreach_queue ids draw from crypto.getRandomValues. // 1.3.4-doi-scrub NOZ-DOI-1 (2026-10-10): the weekly attribution-audit job and its cron branch are gone; the citation watch tracks no static DOIs; the mention radar tracks only non-retired DOIs. // // 1.3.3 NO-TOPIC-HARDCODE-1 (owner directive 2026-10-10): the arXiv radar builds its query, keyword list and classes from the owner's accepted ideas in idea_proposals instead of fixed tables; with none on file it skips. // 1.3.2 RADAR-VENUE-SILENT-1 (2026-10-06, pillar: personal): a per-venue consecutive-zero counter kept as one row in the existing personal_radar table; a normally productive venue (>= 2 productive days) with zero usable candidates for 3 consecutive days files ONE agent_issues row "RADAR-VENUE-SILENT-1: <venue>" (source radar-hub, personal, low, epoch-ms), a failed fetch is a gap not a zero, a same-day re-run does not double count, and the run report names silent venues. 1.3.1 (2026-10-06): the intake run result never echoes exception text (CodeQL js/stack-trace-exposure on PR 662); details go to the worker log. 1.3.0 SIGNAL-INTAKE-SOURCES-1 (2026-10-06, agent_issues 1947, pillar: research): a D1-driven interdisciplinary feed intake (radar_sources kind 'signal': arXiv beyond quant-ph, journals, science news, community feeds) scored by lexicon with no model call into idea_proposals (name intake:<family>), bounded per run and per family, deduped by URL in signal_intake_seen, in the 08:30Z slot (no new cron); metric signal_source_families_7d; GET /intake, POST /intake/run; the events radar skips kind 'signal' rows. 1.2.4 RADAR-TASTE-SHRINK-1 + RADAR-TITLE-NOISE-2 (pillar: personal): taste prior shrunk by n/(n+3) with a 0.6 floor under 5 feedback rows and a half-the-day safety valve; Stedelijk date-range, Iamsterdam navigation and Eventbrite chrome titles dropped or cleaned. 1.2.3 RADAR-TITLE-NOISE-1 (pillar: personal): clean readable calendar titles for personal radar rows, dedupe key unchanged. 1.2.2 RADAR-TASTE-LEARN-1 (pillar: personal): the personal radar learns per-venue and per-domain taste from calendar_feedback. 1.2.1 AWAY-GATE-1 (pillar: personal): the personal radar skips Amsterdam events while a lodging row places the owner elsewhere. 1.2.0 CRON-SINGLE-TRIGGER-1 (#1785): one hourly trigger, CRON_TABLE in code
var eventsMod = (function(){
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var EVENTS_VERSION = "1.0.8";
var WORKER = "events-radar";
var DOMAINS = [
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
var SOURCES = [
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
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
var DEADLINE_FLAGS = [
  { label: "QIP 2027 talk submission", deadline: "2026-10-05T23:59:00-12:00", venue: "QIP", note: "Quantum Information Processing 2027 talk submission (AoE)" }
];
var CATALOG = [
  { title: "QIP 2027 - 30th Conference on Quantum Information Processing", start: "2027-02-20", end: "2027-02-26", kind: "conference", delivery: "onsite", cost: 2, domains: ["QD", "CMP", "SR"], url: "https://qipconference.org/", note: "NUS Singapore. Talk submission 2026-10-05 (AoE).", deadline: "2026-10-05T23:59:00-12:00", verify: { url: "https://qipconference.org/", token: "2027" } },
  { title: "IEEE Quantum Week QCE26 (incl. Q-SET)", start: "2026-09-13", end: "2026-09-18", kind: "conference", delivery: "onsite", cost: 2, domains: ["QD", "CMP"], url: "https://qce.quantum.ieee.org/", note: "Toronto, Canada.", verify: { url: "https://qce.quantum.ieee.org/", token: "QCE26" } },
  { title: "HotCarbon - Hot Topics in Carbon Computing workshop", start: null, end: null, kind: "workshop", delivery: "onsite", cost: 1, domains: ["JPC", "CMP"], url: "https://hotcarbon.org/", note: "Energy/carbon-efficient systems workshop (co-located with systems conf).", verify: { url: "https://hotcarbon.org/", token: "carbon" } },
  { title: "QCrypt - International Conf. on Quantum Cryptography", start: null, end: null, kind: "conference", delivery: "onsite", cost: 2, domains: ["SR", "QD"], url: "https://qcrypt.net/", note: "Annual quantum cryptography conference.", verify: { url: "https://qcrypt.net/", token: "qcrypt" } },
  { title: "Delft Quantum Showcase (QuTech)", start: null, end: null, kind: "event", delivery: "onsite", cost: 0, domains: ["QD"], url: "https://www.qutech.nl/events/", note: "Public showcase at QuTech Delft.", verify: { url: "https://www.qutech.nl/events/", token: "showcase" } }
];
var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
var MONTH_RE = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
var ENTITY_MAP = { amp: "&", lt: "<", gt: ">", quot: String.fromCharCode(34), apos: String.fromCharCode(39), nbsp: " ", ndash: "\u2013", mdash: "\u2014", lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D", hellip: "\u2026", times: "\xD7", middot: "\xB7", sdot: "\u22C5", minus: "\u2212", deg: "\xB0", micro: "\xB5" };
function decodeEntities(x) {
  return String(x || "").replace(/&#x([0-9a-fA-F]+);|&#([0-9]+);|&([a-zA-Z][a-zA-Z0-9]*);/g, function(m, hx, dec, name) {
    if (hx) {
      try {
        return String.fromCodePoint(parseInt(hx, 16));
      } catch (e) {
        return m;
      }
    }
    if (dec) {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch (e) {
        return m;
      }
    }
    return Object.prototype.hasOwnProperty.call(ENTITY_MAP, name) ? ENTITY_MAP[name] : m;
  });
}
__name(decodeEntities, "decodeEntities");
function cleanHtml(text) {
  const s = String(text || "").replace(/<(script|style)\b[\s\S]*?(?:<\/\1[^>]*>|$)/gi, " ").replace(/<[^>]+>/g, " ");
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}
__name(cleanHtml, "cleanHtml");
function pad2(n) {
  return String(n).padStart(2, "0");
}
__name(pad2, "pad2");
function extractEvents(text, src) {
  const events = [];
  let discarded = 0;
  const clean = cleanHtml(text);
  const cutYear = (/* @__PURE__ */ new Date()).getFullYear();
  const dropGarbage = /* @__PURE__ */ __name((s) => /\.st\d+\s*\{|fill\s*:\s*none|"id"\s*:\s*\d+\s*,|window\.|function\s+\(/i.test(s), "dropGarbage");
  const seen = /* @__PURE__ */ new Set();
  const rangeRe = new RegExp("(" + MONTH_RE + ")[a-z]*\\.?\\s+(\\d{1,2})\\s*[-\u2013\u2014]\\s*(\\d{1,2})\\s*,?\\s*(20\\d{2})", "gi");
  const rangeRe2 = new RegExp("(\\d{1,2})\\s*[-\u2013\u2014]\\s*(\\d{1,2})\\s+(" + MONTH_RE + ")[a-z]*\\.?\\s*,?\\s*(20\\d{2})", "gi");
  const singleRe = new RegExp("(" + MONTH_RE + ")[a-z]*\\.?\\s+(\\d{1,2})\\s*,?\\s*(20\\d{2})", "gi");
  const singleRe2 = new RegExp("(\\d{1,2})\\s+(" + MONTH_RE + ")[a-z]*\\.?\\s*,?\\s*(20\\d{2})", "gi");
  const push = /* @__PURE__ */ __name((mo, d1, d2, yr, idx) => {
    const mon = (mo || "").toLowerCase().slice(0, 3);
    const month = MONTHS[mon];
    if (!month) {
      discarded += 1;
      return;
    }
    const year = yr ? parseInt(yr, 10) : 0;
    if (year < cutYear || year > cutYear + 2) {
      discarded += 1;
      return;
    }
    const startIso = toISO(year, month, Math.min(d1 || 1, 28));
    const endIso = d2 ? toISO(year, month, Math.min(d2, 28)) : startIso;
    const key = src.name + "|" + startIso;
    if (seen.has(key)) return;
    const snippet = clean.slice(Math.max(0, idx - 80), idx + 200).slice(0, 240);
    if (dropGarbage(snippet)) {
      discarded += 1;
      return;
    }
    seen.add(key);
    const dateText = d2 ? mo + " " + d1 + "-" + d2 + ", " + year : mo + " " + d1 + ", " + year;
    events.push({ venue: src.name, dateText, startIso, endIso, year, month, day: d1 || null, url: src.url, snippet, srcKind: src.kind, srcDelivery: src.delivery, srcCost: src.cost, srcDomains: (src.domains || []).slice() });
  }, "push");
  function toISO(y, m, d) {
    return y + "-" + pad2(m) + "-" + pad2(d);
  }
  __name(toISO, "toISO");
  for (const m of clean.matchAll(rangeRe)) push(m[1], parseInt(m[2], 10), parseInt(m[3], 10), m[4], m.index);
  for (const m of clean.matchAll(rangeRe2)) push(m[3], parseInt(m[1], 10), parseInt(m[2], 10), m[4], m.index);
  for (const m of clean.matchAll(singleRe)) push(m[1], parseInt(m[2], 10), null, m[3], m.index);
  for (const m of clean.matchAll(singleRe2)) push(m[2], parseInt(m[1], 10), null, m[3], m.index);
  const kept = events.slice(0, 16);
  discarded += Math.max(0, events.length - kept.length);
  return { events: kept, discarded };
}
__name(extractEvents, "extractEvents");
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
__name(classify, "classify");
function domainHits(ev) {
  const text = ((ev.snippet || "") + " " + ev.venue).toLowerCase();
  const hits = [];
  for (const d of DOMAINS) {
    let n = 0;
    for (const kw of d.kw) if (text.indexOf(kw) !== -1) n += 1;
    if (n > 0) hits.push({ code: d.code, name: d.name, n });
  }
  if (hits.length === 0 && Array.isArray(ev.srcDomains)) {
    for (const code of ev.srcDomains.slice(0, 4)) {
      const d = DOMAINS.find((x) => x.code === code);
      if (d && !hits.some((h) => h.code === code)) hits.push({ code: d.code, name: d.name, n: 0, affinity: true });
    }
  }
  hits.sort((a, b) => b.n - a.n);
  return hits;
}
__name(domainHits, "domainHits");
function kindFriction(kind) {
  const m = { webinar: 0, meetup: 1, lecture: 1, seminar: 1, meeting: 1, colloquium: 2, event: 2, other: 2, workshop: 3, school: 4, conference: 5 };
  return m[kind] !== void 0 ? m[kind] : 2;
}
__name(kindFriction, "kindFriction");
function deliveryFriction(d) {
  return d === "online" ? 0 : d === "hybrid" ? 1 : d === "onsite" ? 3 : 2;
}
__name(deliveryFriction, "deliveryFriction");
function costFriction(c) {
  return c === 0 ? 0 : c === 1 ? 1 : 2;
}
__name(costFriction, "costFriction");
function scoreEvent(ev) {
  const c = classify(ev);
  const hits = domainHits(ev);
  const domainCount = hits.length;
  const strong = hits.filter((h) => h.n >= 2).length;
  const relevance = domainCount === 0 ? 0 : Math.min(10, 2 + domainCount + strong);
  const friction = Math.min(10, kindFriction(c.kind) + deliveryFriction(c.delivery) + costFriction(c.cost));
  const priority = Math.round(relevance * 10 / (1 + friction) * 10) / 10;
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
__name(scoreEvent, "scoreEvent");
async function scanVenue(src) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8e3);
  try {
    const r = await fetch(src.url, { headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow", signal: ctrl.signal });
    const text = await r.text();
    if (r.ok) return { name: src.name, ...extractEvents(text, src) };
    return { name: src.name, events: [], discarded: 0, error: "HTTP " + r.status };
  } catch (e) {
    return { name: src.name, events: [], discarded: 0, error: e && e.name === "AbortError" ? "timeout" : String(e && e.message || e).slice(0, 100) };
  } finally {
    clearTimeout(t);
  }
}
__name(scanVenue, "scanVenue");
function flagStatus(deadlineIso, now) {
  const dl = new Date(deadlineIso).getTime();
  const days = (dl - now.getTime()) / 864e5;
  if (days < 0) return "PASSED";
  if (days <= 7) return "IMMINENT";
  if (days <= 30) return "UPCOMING";
  return "FUTURE";
}
__name(flagStatus, "flagStatus");
async function verifyCatalog(env) {
  const out = [];
  for (const c of CATALOG) {
    let verified = false;
    let err = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8e3);
      const r = await fetch(c.verify.url, { headers: { "User-Agent": UA }, redirect: "follow", signal: ctrl.signal });
      clearTimeout(t);
      const text = await r.text();
      verified = r.ok && text.toLowerCase().indexOf(c.verify.token.toLowerCase()) !== -1;
    } catch (e) {
      err = String(e && e.message || e).slice(0, 80);
    }
    out.push({ ...c, verified, verifyError: err });
  }
  return out;
}
__name(verifyCatalog, "verifyCatalog");
function fmtDate(iso) {
  return iso ? iso : "TBA";
}
__name(fmtDate, "fmtDate");
function costLabel(c) {
  return c === 0 ? "free" : c === 1 ? "fee?" : "paid";
}
__name(costLabel, "costLabel");
function renderReport(scannedAt, nowIso, scored, flags, catalogs, stats) {
  const L = [];
  const horizon = stats.horizonISO;
  L.push("EVENTS-RADAR SCAN \u2014 generated " + scannedAt.slice(0, 10) + " (window: " + scannedAt.slice(0, 10) + " .. " + horizon + ")");
  L.push("[EVENTS-RADAR: " + stats.inWindow + " events | " + stats.okVenues + " venues ok | " + stats.catalogVerified + "/" + catalogs.length + " catalog verified | " + flags.length + " deadline " + (flags.length === 1 ? "flag" : "flags") + "]");
  L.push("");
  L.push("Ranking rule: priority = 10 \xD7 relevance \xF7 (1 + friction). Friction = kind + delivery + cost");
  L.push("(0 = free online webinar \u2026 10 = paid multi-day conference abroad). Free low-friction");
  L.push("relevant events are ranked above costly travel conferences by design.");
  L.push("");
  const top = scored.filter((e) => e.relevance >= 4 && e.priority >= 4 && e.frictionClass !== "HIGH").sort((a, b) => b.priority - a.priority || a.startIso.localeCompare(b.startIso)).slice(0, 10);
  L.push("## Top picks \u2014 relevance \xF7 friction");
  if (top.length === 0) L.push("_No events cleared the top-pick threshold this scan._");
  for (const e of top) {
    L.push("- [P " + e.priority + " | " + e.frictionClass + " friction] " + fmtDate(e.startIso) + " [" + e.kind + "|" + e.delivery + "|" + costLabel(e.cost) + "] " + e.venue + ": " + e.snippet.slice(0, 120) + "  \u2192 " + e.domains.join("/") + "  <" + e.url + ">");
  }
  const upcoming = scored.slice().sort((a, b) => a.startIso.localeCompare(b.startIso) || a.venue.localeCompare(b.venue));
  L.push("");
  L.push("## Upcoming events (chronological, window \u2264 " + horizon + ")");
  if (upcoming.length === 0) L.push("_None in window._");
  for (const e of upcoming) {
    L.push("- " + fmtDate(e.startIso) + (e.endIso && e.endIso !== e.startIso ? "\u2026" + e.endIso : "") + " [" + e.kind + "|" + e.delivery + "|" + costLabel(e.cost) + "] " + e.venue + ": " + e.snippet.slice(0, 130) + "  \u2192 " + (e.domains.join("/") || "\u2014") + "  <" + e.url + ">");
  }
  L.push("");
  L.push("## Deadline flags");
  for (const f of flags) L.push("- [" + f.status + "] " + f.label + " \u2014 " + f.deadline + " (" + f.note + ")");
  L.push("");
  L.push("## Canonical catalog (re-verified against source page each scan)");
  for (const c of catalogs) {
    const tag = c.verified ? "VERIFIED" : c.verifyError ? "UNREACHABLE" : "CANDIDATE-UNVERIFIED";
    L.push("- [" + tag + "] " + c.title + (c.start ? "  " + c.start + (c.end && c.end !== c.start ? ".." + c.end : "") : "") + " [" + c.kind + "|" + c.delivery + "|" + costLabel(c.cost) + "|" + c.domains.join("/") + "]  " + c.note + "  <" + c.url + ">" + (c.deadline ? "  deadline " + c.deadline : ""));
  }
  L.push("");
  L.push("## Source health");
  L.push("- venues ok: " + stats.okVenues + "/" + stats.totalVenues + " | discarded: " + stats.discarded + " | venue errors: " + stats.venueErrors.length);
  for (const v of stats.venueErrors) L.push("- ERR " + v.venue + ": " + v.error);
  return L.join("\n");
}
__name(renderReport, "renderReport");
async function ensureSchema(env) {
  await env.RADAR_DB.prepare("CREATE TABLE IF NOT EXISTS events_radar (slug TEXT PRIMARY KEY, report TEXT, events_json TEXT, scanned_at TEXT, updated_at TEXT, curated_json TEXT, flags_json TEXT)").run();
  for (const col of ["curated_json", "flags_json"]) {
    try {
      await env.RADAR_DB.prepare("ALTER TABLE events_radar ADD COLUMN " + col + " TEXT").run();
    } catch (e) {
    }
  }
}
__name(ensureSchema, "ensureSchema");
async function run(env) {
  await ensureSchema(env);
  const scannedAt = (/* @__PURE__ */ new Date()).toISOString();
  const now = /* @__PURE__ */ new Date();
  const nowIso = scannedAt.slice(0, 10);
  const horizon = new Date(now.getTime() + 365 * 864e5).toISOString().slice(0, 10);
  try {
    // SIGNAL-INTAKE-SOURCES-1: kind 'signal' rows are feeds for the intake module, not venue pages to scan for events.
    const rs = await env.RADAR_DB.prepare("SELECT name, url, kind, cadence, category FROM radar_sources WHERE enabled=1 AND COALESCE(kind,'') <> 'signal' AND (cadence='daily' OR (cadence='weekly' AND CAST(strftime('%w','now') AS INTEGER)=1)) ORDER BY cadence DESC").all();
    if (rs.results && rs.results.length) SOURCES = rs.results.map((r) => ({ name: r.name, url: r.url, kind: r.kind || "event", domains: [r.category || "X"], delivery: "hybrid", cost: 0 }));
  } catch (e) { console.error(JSON.stringify({ worker: "radar-hub", where: "eventsMod.run", error: String(e && e.message || e) })); }
  const results = await Promise.allSettled(SOURCES.map((s) => scanVenue(s)));
  const rawEvents = [];
  const venueErrors = [];
  let discarded = 0;
  results.forEach((res, i) => {
    if (res.status === "fulfilled" && res.value) {
      if (res.value.error) venueErrors.push({ venue: SOURCES[i].name, error: res.value.error });
      else {
        rawEvents.push(...res.value.events);
        discarded += res.value.discarded;
      }
    } else venueErrors.push({ venue: SOURCES[i].name, error: String((res.reason || "?").slice(0, 100)) });
  });
  const inWindow = rawEvents.filter((e) => e.startIso >= nowIso && e.startIso <= horizon);
  const scored = inWindow.map(scoreEvent);
  const seen = /* @__PURE__ */ new Set();
  const uniq = scored.filter((e) => {
    const k = e.venue + "|" + e.startIso;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const flags = DEADLINE_FLAGS.map((f) => ({ ...f, status: flagStatus(f.deadline, now) })).filter((f) => f.status !== "PASSED");
  const catalogs = await verifyCatalog(env);
  const stats = {
    inWindow: uniq.length,
    discarded,
    okVenues: SOURCES.length - venueErrors.length,
    totalVenues: SOURCES.length,
    venueErrors,
    catalogVerified: catalogs.filter((c) => c.verified).length,
    horizonISO: horizon
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
  } catch (e) {
    delivery = { error: String(e && e.message || e).slice(0, 120) };
  }
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
  } catch (e) {
    email = { error: String(e && e.message || e).slice(0, 120) };
  }
  await env.RADAR_DB.prepare(
    "INSERT OR REPLACE INTO events_radar (slug, report, events_json, curated_json, flags_json, scanned_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(slug, report, JSON.stringify(uniq), JSON.stringify(catalogs), JSON.stringify(flags), scannedAt, scannedAt).run();
  return {
    slug,
    version: EVENTS_VERSION,
    events: uniq.length,
    discarded,
    venueErrors: venueErrors.length,
    catalogVerified: stats.catalogVerified + "/" + catalogs.length,
    flags: flags.map((f) => f.label + ":" + f.status),
    topPicks: uniq.slice().sort((a, b) => b.priority - a.priority).slice(0, 5).map((e) => "P" + e.priority + " " + e.startIso + " " + e.venue + " " + e.domains.join("/")),
    delivery,
    email
  };
}
__name(run, "run");
var worker_default = {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
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
      return new Response(JSON.stringify({ ok: true, worker: WORKER, version: EVENTS_VERSION }), { headers: { "content-type": "application/json" } });
    }
    return new Response("events-radar worker: GET / (latest report) | GET /?run=1 (trigger scan) | GET /health", { status: 404 });
  }
};
return { default: worker_default, run };
})();
//# sourceMappingURL=worker.js.map

// NO-TOPIC-HARDCODE-1 (1.3.3): seed terms for the arXiv radar come from the owner's own accepted ideas (idea_proposals), the same
// rows the idea-hub think loop seeds from. Pure helpers first, so they are testable without a network or a database.
var ARXIV_SEED_STOPWORDS = new Set("about above across after again against also among because been before being between both cannot could does doing during each either every from further gives given have having here however into itself just keep known like made make many more most much must need neither often only other over said same should since some such than that their them then there these they this those through thus under until upon using very want were what when where whether which while whose will with within without would your idea ideas research question questions paper papers study studies analysis approach method methods result results claim claims note notes proposal show shows shown based work works new novel first second third".split(" "));
function arxivOwnerGroups(texts, maxGroups, termsPer) {
  var docs = (texts || []).map(function(t) { return String(t || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9\- ]+/g, " ").split(/\s+/).filter(function(w) { return w.length >= 5 && !ARXIV_SEED_STOPWORDS.has(w) && !/^[0-9-]+$/.test(w); }); });
  var df = {};
  docs.forEach(function(d) { new Set(d).forEach(function(w) { df[w] = (df[w] || 0) + 1; }); });
  var groups = [];
  for (var k = 0; k < docs.length && groups.length < maxGroups; k++) {
    var tf = {};
    docs[k].forEach(function(w) { tf[w] = (tf[w] || 0) + 1; });
    var wt = function(w) { return tf[w] * Math.log(1 + docs.length / df[w]); };
    var terms = Object.keys(tf).sort(function(x, y) { return (wt(y) - wt(x)) || (x < y ? -1 : 1); }).slice(0, termsPer);
    if (terms.length) groups.push({ label: terms[0], terms: terms });
  }
  return groups;
}
async function arxivSeedGroups(env) {
  var rows = [];
  try {
    if (env.AUDIT) rows = (await env.AUDIT.prepare("SELECT idea FROM idea_proposals WHERE decision = 'ACCEPT' AND (name = 'owner-corpus' OR contact = 'owner' OR name LIKE 'rowan%' OR name LIKE 'owner%') ORDER BY random() LIMIT 9").all()).results || [];
  } catch (e) { rows = []; }
  return arxivOwnerGroups(rows.map(function(r) { return r.idea; }), 4, 4);
}
// Pure: text + groups -> { top, classes, score, fit }; "core" when two lines of work match or one matches on two terms.
function arxivClassify(text, groups) {
  var classes = {}, score = 0;
  (groups || []).forEach(function(g) {
    var n = 0;
    g.terms.forEach(function(t) { if (text.indexOf(t) >= 0) n++; });
    if (n) { classes[g.label] = n; score += n; }
  });
  var top = "other", best = 0;
  for (var k in classes) if (classes[k] > best) { best = classes[k]; top = k; }
  var fit = Object.keys(classes).length >= 2 || best >= 2 ? "core" : "adjacent";
  return { top: top, classes: classes, score: score, fit: fit };
}
var arxivMod = (function(){
const QNFO_VERSION = "qnfo-arxiv-radar/fabric-20260910";
const VERSION = "1.1.0-qwav-classify";
var arxivModDefault = {
  async scheduled(event, env, ctx) {
    try {
      const out = await run(env);
      console.log("arxiv-radar", JSON.stringify(out));
    } catch (e) {
      console.error("arxiv-radar", String((e && e.message) || e));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: "qnfo-arxiv-radar", version: VERSION }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/run") {
      const out = await run(env);
      return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }
};
const UA = "Mozilla/5.0 (QNFO arxiv-radar)";
function pad(n) { return String(n).padStart(2, "0"); }
async function run(env) {
  const out = { hits: 0, candidates: 0, enqueued: 0, dupes: 0, noteKey: null, error: null, sample: [] };
  let hits = [];
  // NO-TOPIC-HARDCODE-1 (1.3.3, owner directive 2026-10-10): the radar's query, keyword list and classes come from the
  // owner's accepted ideas in idea_proposals (groups of distinctive terms, one group per idea), never from a fixed table.
  const groups = await arxivSeedGroups(env);
  if (!groups.length) {
    out.skipped = "no-owner-ideas";
    // Log the skipped run so the fleet can tell a quiet radar from a dormant one.
    try { if (env.AUDIT) await env.AUDIT.prepare("INSERT INTO research_scan_log (id, ts, job, payload) VALUES (?1, ?2, 'arxiv-radar', ?3)").bind("arxiv-" + Date.now().toString(36), new Date().toISOString(), JSON.stringify({ v: VERSION, skipped: out.skipped })).run(); } catch (e) { console.error(JSON.stringify({ worker: "radar-hub", where: "arxivMod.run", error: String(e && e.message || e) })); }
    return out;
  }
  const STRONG = [];
  for (const g of groups) for (const t of g.terms) if (STRONG.indexOf(t) < 0) STRONG.push(t);
  const WIDE_QUERY = "(" + STRONG.map(function(t) { return 'all:"' + t.replace(/-/g, " ") + '"'; }).join(" OR ") + ")";
  try {
    const q = encodeURIComponent(WIDE_QUERY);
    const r = await fetch("https://export.arxiv.org/api/query?search_query=" + q + "&start=0&max_results=20&sortBy=submittedDate&sortOrder=descending", { headers: { "User-Agent": UA } });
    const txt = await r.text();
    const entries = txt.split("<entry>").slice(1);
    for (const en of entries) {
      const t = (en.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
      const id = (en.match(/<id>[\s\S]*?arxiv\.org\/abs\/([^<]+)<\/id>/) || [])[1] || "";
      const pub = (en.match(/<published>([^<]+)<\/published>/) || [])[1] || "";
      const sum = (en.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || "";
      const authors = [];
      const am = en.match(/<name>([\s\S]*?)<\/name>/g) || [];
      for (const a of am) authors.push(a.replace(/<\/?name>/g, "").trim());
      if (t) hits.push({ id: id.trim(), title: t.replace(/\s+/g, " ").trim().slice(0, 220), published: pub.slice(0, 10), authors: authors.slice(0, 6), text: (t + " " + sum).replace(/\s+/g, " ").toLowerCase() });
    }
  } catch (e) { out.error = String((e && e.message) || e); }
  out.hits = hits.length;
  const candidates = [];
  for (const h of hits) {
    let score = 0;
    for (const kw of STRONG) if (h.text.includes(kw)) score++;
    if (score >= 1) candidates.push(h);
  }
  out.candidates = candidates.length;
  // QWAV-SCAN-CLASSIFY-1 (2026-10-01, RM-VISION-QWAV-SCAN-1): the radar kept any hit with one keyword and gave no
  // topic, so the digest could not be read by research area and nothing downstream could weigh a hit. Each hit is now
  // classified deterministically (no model call, zero cost) into the owner's lines of work (arxivClassify) and given a fit grade:
  // "core" when it matches two lines of work or one on two terms, "adjacent" otherwise.
  for (const c of candidates) {
    const cls = arxivClassify(c.text, groups);
    c.cls = cls.top; c.classes = cls.classes; c.score = cls.score; c.fit = cls.fit;
  }
  candidates.sort(function(a, b) { return (b.fit === "core") - (a.fit === "core") || b.score - a.score; });
  out.by_class = {};
  for (const c of candidates) out.by_class[c.cls] = (out.by_class[c.cls] || 0) + 1;
  out.core = candidates.filter(function(c) { return c.fit === "core"; }).length;
  out.sample = candidates.slice(0, 5).map(function(c){ return c.id + " [" + c.cls + "/" + c.fit + "] " + c.title.slice(0, 60); });
  const lines = [];
  const order = groups.map(function(g) { return g.label; }).concat(["other"]);
  for (const k of order) {
    const grp = candidates.filter(function(c) { return c.cls === k; }).slice(0, 10);
    if (!grp.length) continue;
    lines.push("", "## " + (k === "other" ? "Other" : k.charAt(0).toUpperCase() + k.slice(1)) + " (" + grp.length + ")");
    for (const c of grp) lines.push("- [" + c.id + "] " + c.title + " (" + c.published + ", " + c.fit + ", score " + c.score + ") " + c.authors.slice(0, 3).join(", "));
  }
  const d = new Date();
  const ymd = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const key = "notes/v1/" + d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + ymd + "/_arxiv-radar-" + ymd + ".md";
  const body = "# arXiv Radar " + ymd + "\n\nWidened scan: " + hits.length + " hits, " + candidates.length + " candidates (" + out.core + " core)\n" + lines.join("\n") + "\n";
  try {
    if (env.VAULT) { await env.VAULT.put(key, body, { httpMetadata: { contentType: "text/markdown" } }); out.noteKey = key; }
  } catch (e) { console.error(JSON.stringify({ worker: "radar-hub", where: "arxivMod.run", error: String(e && e.message || e) })); }
  if (env.AUDIT) {
    for (const c of candidates.slice(0, 8)) {
      try {
        const dup = await env.AUDIT.prepare("SELECT 1 AS x FROM outreach_queue WHERE paper_id=?1 LIMIT 1").bind(c.id.slice(0, 40)).first();
        if (dup) { out.dupes++; continue; }
        await env.AUDIT.prepare("INSERT INTO outreach_queue (id, paper_id, author, email, reason, status, created_at) VALUES (?1,?2,?3,NULL,?4,'needs-contact', datetime('now'))").bind("aq-" + Date.now().toString(36) + rhex(4), c.id.slice(0, 40), "", "arxiv-radar widened: " + c.title.slice(0, 120)).run();
        out.enqueued++;
      } catch (e) { console.error(JSON.stringify({ worker: "radar-hub", where: "arxivMod.run", error: String(e && e.message || e) })); }
    }
    // Run ledger in the existing research_scan_log (job arxiv-radar): the radar logged only to the console, so the
    // fleet could not tell a quiet day from a dormant radar (the backlog called it dormant for 20-27 days).
    try {
      await env.AUDIT.prepare("INSERT INTO research_scan_log (id, ts, job, payload) VALUES (?1, ?2, 'arxiv-radar', ?3)").bind("arxiv-" + Date.now().toString(36), new Date().toISOString(), JSON.stringify({ v: VERSION, hits: out.hits, candidates: out.candidates, core: out.core, by_class: out.by_class, enqueued: out.enqueued, dupes: out.dupes, note: out.noteKey, error: out.error, top: candidates.slice(0, 8).map(function(c) { return { id: c.id, cls: c.cls, fit: c.fit, score: c.score, title: c.title.slice(0, 120) }; }) }).slice(0, 3000)).run();
      out.logged = true;
    } catch (e) { out.logged = false; }
  }
  return out;
}
return arxivModDefault;
})();
var researchMod = (function(){
const QNFO_VERSION = "qnfo-research-radar/fabric-20260910";
const VERSION = "1.0.1+fabric.20260910";
var researchModDefault = {
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    let out;
    try {
      if (cron === "0 6 1 * *") out = await jobPhilpapers(env);
      else if (cron === "0 9 * * 7") out = await jobSeo(env);
      else out = { status: "skipped", cron: cron };
      console.log("research-radar", JSON.stringify(out));
    } catch (e) {
      console.error("research-radar", String((e && e.message) || e));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: "qnfo-research-radar", version: VERSION }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/run") {
      const mode = url.searchParams.get("job") || "all";
      const results = {};
      if (mode === "philpapers" || mode === "all") results.philpapers = await jobPhilpapers(env);
      if (mode === "seo" || mode === "all") results.seo = await jobSeo(env);
      return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }
};
const SITEMAPS = ["https://rwnq8.github.io/sitemap.xml","https://qnfo-landing.pages.dev/sitemap.xml"];
function pad(n) { return String(n).padStart(2, "0"); }
function todayKey() {
  const d = new Date();
  const ymd = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  return { ymd: ymd, dir: "notes/v1/" + d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + ymd };
}
async function writeNote(env, name, body) {
  const t = todayKey();
  const key = t.dir + "/_" + name + "-" + t.ymd + ".md";
  try {
    if (env.VAULT) { await env.VAULT.put(key, body, { httpMetadata: { contentType: "text/markdown" } }); return key; }
  } catch (e) { console.error(JSON.stringify({ worker: "radar-hub", where: "researchMod.writeNote", error: String(e && e.message || e) })); }
  return null;
}
async function jobPhilpapers(env) {
  let status = 0, len = 0, line = "no check";
  try {
    const r = await fetch("https://philpapers.org/s/Quni-Gudzinas", { headers: { "User-Agent": "Mozilla/5.0 (QNFO philpapers monitor)" } });
    status = r.status;
    const t = await r.text();
    len = t.length;
    line = "philpapers.org search page HTTP " + status + " | bytes " + len;
  } catch (e) { line = "ERROR " + String((e && e.message) || e); }
  const body = "# PhilPapers Index Monitor " + todayKey().ymd + "\n\n" + line + "\n";
  const noteKey = await writeNote(env, "philpapers", body);
  return { status: "ok", httpStatus: status, bytes: len, noteKey: noteKey };
}
async function jobSeo(env) {
  const lines = [];
  for (const u of SITEMAPS) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (QNFO SEO health)" } });
      const t = await r.text();
      const lastmod = (t.match(/<lastmod>([^<]+)<\/lastmod>/i) || [])[1] || "none";
      lines.push("- " + u + " | HTTP " + r.status + " | bytes " + t.length + " | lastmod " + lastmod);
    } catch (e) { lines.push("- " + u + " | ERROR " + String((e && e.message) || e)); }
  }
  const body = "# SEO Health Check " + todayKey().ymd + "\n\n" + lines.join("\n") + "\n";
  const noteKey = await writeNote(env, "seo-health", body);
  return { status: "ok", noteKey: noteKey, checks: lines.length };
}

return researchModDefault;
})();
var citationMod = (function(){
const QNFO_VERSION = "qnfo-citation-watch/fabric-20260910";
var citationModDefault = {
  async scheduled(event, env, ctx) {
    try {
      const out = await run(env);
      console.log("citation-watch", JSON.stringify(out));
    } catch (e) {
      console.error("citation-watch", String((e && e.message) || e));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: "qnfo-citation-watch", version: "1.0.0" }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/run") {
      const out = await run(env);
      return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }
};
// NOZ-DOI-1: no registry-minted DOIs are tracked any more; the mention radar covers citations by author id.
const KNOWN_DOIS = [];
async function run(env) {
  const lines = [];
  let total = 0;
  if (!KNOWN_DOIS.length) return { status: "skipped", reason: "no tracked DOIs", total: 0, lines: 0, wrote: false };
  for (const doi of KNOWN_DOIS) {
    try {
      const r = await fetch("https://api.openalex.org/works/doi:" + doi, { headers: { "User-Agent": "QNFO citation watch (mailto:rwnquni@outlook.com)" } });
      if (!r.ok) continue;
      const w = await r.json();
      const cited = (w && w.cited_by_count) || 0;
      total += cited;
      lines.push("- " + ((w && w.title) || doi) + " | cited_by: " + cited);
      const cr = await fetch("https://api.openalex.org/works?filter=cites:" + doi + "&per-page=5", { headers: { "User-Agent": "QNFO citation watch (mailto:rwnquni@outlook.com)" } });
      if (cr.ok) {
        const c = await cr.json();
        for (const cit of (c.results || []).slice(0, 3)) {
          lines.push("    - " + ((cit && cit.title) || "untitled") + " | " + ((cit && cit.publication_date) || ""));
        }
      }
    } catch (e) { console.error(JSON.stringify({ worker: "radar-hub", where: "citationMod.run", error: String(e && e.message || e) })); }
  }
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const key = "notes/v1/" + d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + ymd + "/_citation-watch-" + ymd + ".md";
  const body = "# Citation Watch " + ymd + "\n\nTotal known-DOI citations: " + total + "\n\n" + lines.join("\n") + "\n";
  let wrote = false;
  try {
    if (env.VAULT) { await env.VAULT.put(key, body, { httpMetadata: { contentType: "text/markdown" } }); wrote = true; }
  } catch (e) { console.error(JSON.stringify({ worker: "radar-hub", where: "citationMod.run", error: String(e && e.message || e) })); }
  return { status: "ok", total, noteKey: key, lines: lines.length, wrote };
}

return citationModDefault;
})();
var jmwMod = (function(){
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
// JOB-MARKET-INLINE-1 (radar-hub 1.1.3, 2026-10-02, pillar: reach). The weekly job-market watch had not recorded a run
// since 2026-09-08 (handoffs project_id job-market-watch-workflow-*; that row and the two of 09-01 came from manual
// Workflow instances, never the cron: commit 3fda8b34 already found the cron "DETACHED ... zero fires"). Three defects:
//   1. The cron only called env.JOB_MARKET_WATCH.create(). A Workflow is its own resource that `wrangler deploy` creates;
//      radar-hub is deployed through qnfo-ops' raw script upload, which installs the binding (without a workflow_name)
//      but never creates or re-points the Workflow, and the Workflow the binding named belonged to the job-market-watch
//      script, retired on 2026-09-27. A created instance had no class to run.
//   2. Since 2026-09-27 qnfo-audit refuses any handoffs row without a claim_sheet (trigger
//      handoffs_claim_sheet_required_ins, FRAMEWORK-DOGFOOD-1). The record step wrote none, so even a running instance
//      could not record.
//   3. The D1 record came after the R2 vault write, so a vault failure lost the run.
// The cron now runs the scan inline (three HTTP reads and two writes fit a scheduled invocation easily), writes the vault
// note best-effort, and always writes the handoffs row with a claim_sheet. JobMarketWatchWorkflow stays exported, with the
// same steps, so a manually created instance still works. Cron 0 7 * * 2 is Monday 07:00Z (Cloudflare numbers 1=Sunday).
var JMW_PROJECT = "job-market-watch-workflow-";
async function jmwScan(f) {
  const opt = { headers: { "User-Agent": "QNFO-job-market-watch/1.1 (+https://qnfo.org)" }, signal: AbortSignal.timeout(20e3) };
  const out = [];
  try {
    const r = await f("https://api.lever.co/v0/postings/epoch-ai?mode=json", opt);
    if (r.ok) {
      const j = await r.json();
      out.push({ source: "epoch", channel: "RED", roles: (Array.isArray(j) ? j : []).map((x) => x.text || "").filter(Boolean).slice(0, 12) });
    } else out.push({ source: "epoch", channel: "RED", error: "HTTP " + r.status });
  } catch (e) {
    out.push({ source: "epoch", channel: "RED", error: String(e && e.message || e).slice(0, 120) });
  }
  try {
    const r = await f("https://api.ashbyhq.com/posting-api/job-board/quantware", opt);
    if (r.ok) {
      const j = await r.json();
      out.push({ source: "quantware", channel: "RED", roles: (j.jobs || []).map((x) => x.title).slice(0, 12) });
    } else out.push({ source: "quantware", channel: "RED", error: "HTTP " + r.status });
  } catch (e) {
    out.push({ source: "quantware", channel: "RED", error: String(e && e.message || e).slice(0, 120) });
  }
  try {
    const r = await f("https://forecastingresearch.org/careers", opt);
    if (r.ok) {
      const html = await r.text();
      const titles = [];
      for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{8,80})/g)) {
        const t = m[2].trim();
        if (/Senior|Research|Analyst|Fellow|Researcher|Data/.test(t) && titles.length < 12) titles.push(t);
      }
      out.push({ source: "fri", channel: "GREEN", roles: titles, email: html.includes("info@forecastingresearch.org") });
    } else out.push({ source: "fri", channel: "GREEN", error: "HTTP " + r.status });
  } catch (e) {
    out.push({ source: "fri", channel: "GREEN", error: String(e && e.message || e).slice(0, 120) });
  }
  return out;
}
function jmwReport(boards, iso) {
  const lines = ["# JOB MARKET WATCH", "", "> Generated " + iso, "", "## Scan results", ""];
  for (const b of boards) {
    lines.push("### " + b.source + " [" + b.channel + "]");
    if (b.roles && b.roles.length) lines.push(b.roles.map(function(x) {
      return "- " + x;
    }).join(String.fromCharCode(10)));
    if (b.error) lines.push("- ERROR: " + b.error);
    if (b.email !== void 0) lines.push("- email channel: " + (b.email ? "yes (GREEN - automated application possible)" : "no"));
  }
  lines.push("", "## CHANNEL-1 POLICY", "GREEN = direct email application (automatable). RED = form-ATS (track only, recruit-at-large).");
  return lines.join(String.fromCharCode(10));
}
function jmwKey(date) {
  return "notes/v1/" + date.slice(0, 4) + "/" + date.slice(5, 7) + "/" + date + "/_job-market-watch-workflow-" + date + ".md";
}
async function jmwDeliver(env, key, report) {
  if (!env.VAULT) return { key: null, error: "no VAULT binding" };
  try {
    await env.VAULT.put(key, report, { httpMetadata: { contentType: "text/markdown" } });
    return { key, error: null };
  } catch (e) {
    return { key: null, error: String(e && e.message || e).slice(0, 120) };
  }
}
async function jmwRecord(env, boards, date, iso, trigger, delivered) {
  const ok = boards.filter((b) => !b.error).length;
  const roles = boards.reduce((n, b) => n + (b.roles ? b.roles.length : 0), 0);
  const green = boards.filter((b) => b.channel === "GREEN").length, red = boards.filter((b) => b.channel === "RED").length;
  const summary = "Job market scan (" + trigger + "): " + boards.length + " boards (" + green + " GREEN / " + red + " RED), " + ok + " read, " + roles + " roles";
  const claim = JSON.stringify({ claim: summary, evidence: delivered.key ? "R2 obsidian-vault " + delivered.key : "board reads only (vault note not written: " + (delivered.error || "?") + ")", boards: boards.map((b) => b.source + ":" + (b.error ? "error " + b.error : (b.roles || []).length + " roles")), confidence: "measured", status: ok ? "verified" : "unverified" });
  const res = await env.AUDIT.prepare("INSERT INTO handoffs (session_id, project_id, phase_completed, summary, pending_work, next_action, r2_handoff_path, timestamp, wbs_code, claim_sheet) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("cloud-workflow", JMW_PROJECT + date, "1", summary, "none - autonomous", "next: weekly Monday 07:00Z (cron 0 7 * * 2)", delivered.key, iso, "JOB-MARKET-WATCH", claim).run();
  return res && res.meta ? res.meta.last_row_id : null;
}
async function runJobMarket(env, opts) {
  opts = opts || {};
  const f = opts.fetch || ((u, i) => fetch(u, i));
  const iso = new Date(opts.now || Date.now()).toISOString(), date = iso.slice(0, 10);
  const boards = await jmwScan(f);
  const delivered = await jmwDeliver(env, jmwKey(date), jmwReport(boards, iso));
  const handoff_id = await jmwRecord(env, boards, date, iso, opts.trigger || "cron", delivered);
  return { boards: boards.length, read: boards.filter((b) => !b.error).length, key: delivered.key, vault_error: delivered.error, handoff_id };
}
var worker_default = {
  async scheduled(event, env, ctx) {
    try {
      console.log("job-market-watch", JSON.stringify(await runJobMarket(env, { trigger: "cron" })));
    } catch (e) {
      console.error("job-market-watch", String(e && e.message || e));
    }
  },
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: "job-market-watch", version: "1.2.0" }), { headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }
};
var JobMarketWatchWorkflow = class extends WorkflowEntrypoint {
  static {
    __name(this, "JobMarketWatchWorkflow");
  }
  async run(event, step) {
    const iso = (/* @__PURE__ */ new Date()).toISOString(), date = iso.slice(0, 10);
    const boards = await step.do("scan-sources", { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "90 seconds" }, async () => jmwScan((u, i) => fetch(u, i)));
    const delivered = await step.do("deliver-r2", {}, async () => jmwDeliver(this.env, jmwKey(date), jmwReport(boards, iso)));
    const handoff_id = await step.do("record-d1", {}, async () => jmwRecord(this.env, boards, date, iso, "workflow", delivered));
    return { boards: boards.length, key: delivered.key, handoff_id };
  }
};
return { JobMarketWatchWorkflow: JobMarketWatchWorkflow, default: worker_default, runJobMarket: runJobMarket };
})();
//# sourceMappingURL=worker.js.map

var perMod = (function(){
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var PERSONAL_VERSION = "1.2.8";
var WORKER = "personal-events-radar";
var TAB = String.fromCharCode(9);
var LF = String.fromCharCode(10);
var CR = String.fromCharCode(13);
var WSC = "[ " + TAB + CR + LF + "]";
var WS = WSC + "+";
var INTERESTS = [
  { code: "MUS", name: "Museums", kw: ["museum", "exhibition", "expositie", "gallery", "collection", "masterpiece", "old master", "tentoonstelling"] },
  { code: "CLA", name: "Classical music", kw: ["concert", "classical", "symphony", "orchestra", "orchestral", "chamber music", "recital", "concerto", "sonata", "opera", "baroque", "renaissance music"] },
  { code: "PER", name: "Play and performance", kw: ["performance", "theatre", "theater", "dance", "ballet", "puppet", "circus", "comedy", "open air", "openluchttheater", "storytelling"] },
  { code: "QUR", name: "Queer arts and culture", kw: ["queer", "pride", "lgbt", "lgbtq", "drag", "ballroom"] },
  { code: "JAZ", name: "Jazz and contemporary", kw: ["jazz", "contemporary music", "electronic", "dj", "live music", "indie", "folk"] },
  { code: "LIT", name: "Literature and ideas", kw: ["literature", "poetry", "book", "author", "reading", "philosophy cafe", "debate", "talk"] },
  { code: "FIL", name: "Film and screen", kw: ["film", "cinema", "screening", "documentary", "movie"] },
  { code: "FES", name: "Festivals and city life", kw: ["festival", "open day", "night of", "museumnacht", "free entry", "gratis", "market", "parade", "city walk"] }
];
var SOURCES = [
  { name: "Concertgebouw", url: "https://www.concertgebouw.nl/en", kind: "concert", delivery: "onsite", cost: 2, titleDir: "after" },
  { name: "Rijksmuseum", url: "https://www.rijksmuseum.nl/en/whats-on", kind: "exhibition", delivery: "onsite", cost: 1 },
  { name: "VanGoghMuseum", url: "https://www.vangoghmuseum.nl/en/visit/whats-on", kind: "exhibition", delivery: "onsite", cost: 1 },
  { name: "Stedelijk", url: "https://www.stedelijk.nl/en/whats-on", kind: "exhibition", delivery: "onsite", cost: 1 },
  { name: "Openluchttheater", url: "https://www.openluchttheater.nl/agenda", kind: "performance", delivery: "onsite", cost: 0 },
  { name: "Iamsterdam", url: "https://www.iamsterdam.com/en/whats-on", kind: "event", delivery: "onsite", cost: 1 },
  { name: "EventbriteLGBTQ", url: "https://www.eventbrite.nl/d/netherlands--amsterdam/events/lgbtq/", kind: "event", delivery: "onsite", cost: 1 }
];
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
var ENERGY = { maxInPersonPerHalfYear: 2, h2_2026_spent: true, nextEligibility: "2027-01-01" };
var SCHENGEN_EXIT = "2026-10-17";
var STANDING_DROP = /qpl|cwi/i;
var VENUE_AFFINITY = { Concertgebouw: 1, Rijksmuseum: 1, VanGoghMuseum: 1, Stedelijk: 1, Openluchttheater: 1, EventbriteLGBTQ: 1 };
var LOCAL_VENUES = ["Concertgebouw", "Rijksmuseum", "VanGoghMuseum", "Stedelijk", "Openluchttheater", "Iamsterdam", "EventbriteLGBTQ"];
var SCHENGEN_VENUES = []; // FIX 2026-09-19: local Amsterdam venues must not be Schengen-gated
var TRAVEL_KINDS = ["conference", "workshop", "school"];
var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, maa: 3, mei: 5, okt: 10 };
var MONTH_RE = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Januari|Februari|Maart|April|Mei|Juni|Juli|Augustus|September|Oktober|November|December)";
var ENTITY_MAP = { amp: "&", lt: "<", gt: ">", quot: String.fromCharCode(34), apos: String.fromCharCode(39), nbsp: " ", ndash: "\u2013", mdash: "\u2014", lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D", hellip: "\u2026", times: "\xD7", middot: "\xB7", sdot: "\u22C5", minus: "\u2212", deg: "\xB0", micro: "\xB5" };
function decodeEntities(x) {
  return String(x || "").replace(/&#x([0-9a-fA-F]+);|&#([0-9]+);|&([a-zA-Z][a-zA-Z0-9]*);/g, function(m, hx, dec, name) {
    if (hx) {
      try {
        return String.fromCodePoint(parseInt(hx, 16));
      } catch (e) {
        return m;
      }
    }
    if (dec) {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch (e) {
        return m;
      }
    }
    return Object.prototype.hasOwnProperty.call(ENTITY_MAP, name) ? ENTITY_MAP[name] : m;
  });
}
__name(decodeEntities, "decodeEntities");
function cleanHtml(text) {
  const s = String(text || "").replace(new RegExp("<script[^]*?<\/script>", "gi"), " ").replace(new RegExp("<style[^]*?</style>", "gi"), " ").replace(/<[^>]+>/g, " ");
  return decodeEntities(s).replace(new RegExp(WSC + "+", "g"), " ").trim();
}
__name(cleanHtml, "cleanHtml");
function pad2(n) {
  return String(n).padStart(2, "0");
}
__name(pad2, "pad2");
function toISO(y, m, d) {
  return y + "-" + pad2(m) + "-" + pad2(d);
}
__name(toISO, "toISO");
// RADAR-TITLE-NOISE-1 (charter pillar: personal). The calendar title used to be the venue plus the first 90 characters of the
// stripped page text around the date, which carried menu chrome, dates and the previous card's tail. extractEvents now also
// builds `title`: the nearest heading or link text before the date, else the text between the previous date and this one,
// with chrome, dates and repeated venue prefixes removed and a length cap. The snippet (scoring, classify, report) and the
// dedupe key venue|date are untouched, so existing rows are never re-posted.
var TITLE_CAP = 80;
var TITLE_CHROME = new RegExp("indeling" + WS + "prijs" + WS + "taal" + WS + "valuta|dit" + WS + "evenement" + WS + "opslaan|\\bopslaan\\b|\\bnext" + WS + "page\\b|\\bprevious" + WS + "page\\b|\\bpage" + WS + "[0-9]+\\b|upcoming" + WS + "exhibitions|skip" + WS + "to" + WS + "[a-z]+(?:" + WS + "[a-z]+)?|read" + WS + "more|lees" + WS + "meer|accept(?:" + WS + "all)?" + WS + "cookies|\\bcookies?(?:" + WS + "(?:settings|policy|preferences))?\\b|tickets" + WS + "available|accessibility" + WS + "facilities|now" + WS + "on" + WS + "view|\\bexpected\\b|\\bsave" + WS + "this" + WS + "event\\b|\\bsubscribe\\b|\\bnewsletter\\b|at" + WS + "various" + WS + "times|diverse" + WS + "locaties" + WSC + "*/" + WSC + "*various" + WS + "locations|[0-9]{1,2}:[0-9]{2}" + WSC + "*-" + WSC + "*[0-9]{1,2}:[0-9]{2}|our" + WS + "top" + WS + "picks" + WS + "this" + WS + "season|all" + WS + "events" + WS + "and" + WS + "happenings|festivals" + WS + "and" + WS + "events|shopping" + WS + "and" + WS + "markets|theatre" + WS + "and" + WS + "stage|art" + WS + "and" + WS + "design", "gi");
// RADAR-TITLE-NOISE-2 (#1885): everything in front of the last navigation marker is the previous card or the menu, and titles
// at the venues whose pages are mostly navigation lists (Stedelijk, Iamsterdam, Eventbrite) must start like a title: a
// leading lowercase word, "&" or punctuation is a cut fragment, so the candidate falls back to the next clean segment or is skipped.
var TITLE_LEAD_CHROME = new RegExp("^[^]*(?:indeling" + WS + "prijs" + WS + "taal" + WS + "valuta|dit" + WS + "evenement" + WS + "opslaan|\\bopslaan" + WSC + "*:|\\bnext" + WS + "page|upcoming" + WS + "exhibitions)" + WSC + "*:?", "i");
var TITLE_STRICT_VENUES = ["Stedelijk", "Iamsterdam", "EventbriteLGBTQ"];
var TITLE_WDAY = "(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag";
var TITLE_DATE_SRC = "(?:(?:" + TITLE_WDAY + ")[.]?,?" + WSC + "*)?(?:" + MONTH_RE + "[a-z]*[.]?" + WS + "[0-9]{1,2}(?:" + WSC + "*[-–—]" + WSC + "*[0-9]{1,2})?|[0-9]{1,2}(?:" + WSC + "*[-–—]" + WSC + "*[0-9]{1,2})?" + WS + MONTH_RE + "[a-z]*[.]?)(?:" + WSC + "*,?" + WSC + "*(?:20[0-9]{2}|'[0-9]{2})(?![0-9:]))?(?:" + WSC + "*,?" + WSC + "*[0-9]{1,2}:[0-9]{2}(?:" + WSC + "*[AaPp][Mm])?)?";
function cleanTitleSegment(raw, venue, isHeading) {
  const strict = TITLE_STRICT_VENUES.indexOf(venue) !== -1;
  let t = String(raw || "").replace(TITLE_LEAD_CHROME, " ").replace(TITLE_CHROME, " ");
  const venueRe = new RegExp("^[^A-Za-z0-9]*" + String(venue || "").replace(/[^A-Za-z0-9]/g, "") + "[:|]?", "i");
  while (venueRe.test(t) && String(venue || "")) t = t.replace(venueRe, " ");
  t = t.replace(new RegExp("^[^A-Za-z0-9]*Amsterdam" + WSC + "*[|:]", "i"), " ");
  t = t.replace(new RegExp(WSC + "+", "g"), " ").trim();
  if (strict && /^[a-z&,;:)|\-\u2013\u2014.]/.test(t)) return "";
  t = t.replace(new RegExp("^['\u2019]?[0-9]{1,2}" + WS + "(?=[A-Z])"), "").trim();
  const close = t.indexOf(")");
  if (close !== -1 && t.indexOf("(") === -1 || close !== -1 && close < t.indexOf("(")) t = t.slice(close + 1).trim();
  const sentence = t.lastIndexOf(". ");
  if (sentence !== -1 && t.length - sentence - 2 >= 8) t = t.slice(sentence + 2).trim();
  const tail = new RegExp("(?:^|" + WS + ")(?:from|until|till|t/m|every|op|vanaf" + (isHeading ? "" : "|" + TITLE_WDAY + "|and|en|or|of|the") + ")[.,]?" + WSC + "*$", "i");
  for (let i = 0; i < 4 && tail.test(t); i++) t = t.replace(tail, "").trim();
  let words = t.split(" ");
  while (words.length > 2 && /^[a-z]/.test(words[0]) && words.slice(1, 6).some((w) => /^[A-Z0-9]/.test(w))) words = words.slice(1);
  t = words.join(" ").replace(/^[^A-Za-z0-9]+/, "").replace(/[\s,;:|\-\u2013\u2014]+$/, "").trim();
  if (t.length > TITLE_CAP) {
    t = t.slice(0, TITLE_CAP);
    const cut = t.lastIndexOf(" ");
    if (cut > 30) t = t.slice(0, cut);
    t = t.replace(/[\s,;:|\-\u2013\u2014]+$/, "");
  }
  return /[A-Za-z]{3}/.test(t) && t.length >= 8 ? t : "";
}
__name(cleanTitleSegment, "cleanTitleSegment");
function cleanTitleText(raw, venue, isHeading) {
  const text = String(raw || "");
  if ((text.match(new RegExp("\\b[0-9]{1,2}" + WSC + "+[.]" + WSC + "+", "g")) || []).length >= 2) return "";
  const one = new RegExp("(?:(?:from|until|till|t/m|vanaf)" + WS + ")?" + TITLE_DATE_SRC, "gi").source;
  const rangeRe = new RegExp("(?:" + one + ")(?:" + WSC + "*(?:till|until|to|t/m|tot|[-\u2013\u2014])" + WSC + "*(?:" + one + "))*", "gi");
  const parts = text.replace(rangeRe, " \u0001 ").split("\u0001");
  for (const part of parts) {
    const c = cleanTitleSegment(part, venue, isHeading);
    if (c) return c;
  }
  return "";
}
__name(cleanTitleText, "cleanTitleText");
function headingCandidates(html, clean) {
  const out = [];
  for (const re of [/<(h[1-4])\b[^>]*>([^]*?)<\/\1>/gi, /<(a)\b[^>]*>([^]*?)<\/\1>/gi]) {
    for (const m of String(html || "").matchAll(re)) {
      const txt = cleanHtml(m[2]);
      if (txt.length < 8 || txt.length > 140) continue;
      let i = clean.indexOf(txt);
      while (i !== -1 && out.length < 600) {
        out.push({ txt, start: i, end: i + txt.length });
        i = clean.indexOf(txt, i + txt.length);
      }
    }
  }
  return out;
}
__name(headingCandidates, "headingCandidates");
function buildTitle(clean, idx, cands, venue, dir) {
  const dateRe = new RegExp(TITLE_DATE_SRC, "gi");
  const hasDate = (x) => new RegExp(TITLE_DATE_SRC, "i").test(x);
  const m0 = new RegExp("^" + TITLE_DATE_SRC, "i").exec(clean.slice(idx));
  const dateEnd = idx + (m0 ? m0[0].length : 0);
  let best = null;
  for (const c of cands) {
    if (dir === "after") {
      if (c.start < dateEnd || c.start - dateEnd > 200 || hasDate(clean.slice(dateEnd, c.start))) continue;
      if (best && c.start >= best.pos) continue;
      const t = cleanTitleText(c.txt, venue, true);
      if (t) best = { pos: c.start, t };
    } else {
      if (c.end > idx || idx - c.end > 160 || hasDate(clean.slice(c.end, idx))) continue;
      if (best && c.end <= best.pos) continue;
      const t = cleanTitleText(c.txt, venue, true);
      if (t) best = { pos: c.end, t };
    }
  }
  if (best) return best.t;
  const pre = clean.slice(Math.max(0, idx - 140), idx);
  const ms = Array.from(pre.matchAll(dateRe));
  for (let k = ms.length; k >= 0; k--) {
    const seg = pre.slice(k === 0 ? 0 : ms[k - 1].index + ms[k - 1][0].length, k === ms.length ? pre.length : ms[k].index);
    const before = cleanTitleText(seg, venue);
    if (before) return before;
  }
  const after = clean.slice(dateEnd, dateEnd + 140);
  const next = after.search(new RegExp(TITLE_DATE_SRC, "i"));
  return cleanTitleText(next === -1 ? after : after.slice(0, next), venue);
}
__name(buildTitle, "buildTitle");
function extractEvents(text, src) {
  const events = [];
  let discarded = 0;
  const clean = cleanHtml(text);
  const cands = headingCandidates(text, clean);
  const cutYear = (/* @__PURE__ */ new Date()).getFullYear();
  const dropGarbage = /* @__PURE__ */ __name((s) => {
    if (new RegExp("[.]st[0-9]+" + WSC + "*[{]").test(s)) return true;
    if (new RegExp("fill" + WSC + "*:" + WSC + "*none").test(s)) return true;
    if (new RegExp('"id"' + WSC + "*:" + WSC + "*[0-9]+" + WSC + "*,").test(s)) return true;
    if (/window[.]/.test(s)) return true;
    if (new RegExp("function" + WS + "[(]").test(s)) return true;
    if (/matchmaker|recommended concerts|you choose/i.test(s)) return true;
    if (/editorial tips|weekend guide/i.test(s)) return true;
    return false;
  }, "dropGarbage");
  const seen = /* @__PURE__ */ new Set();
  const rangeRe = new RegExp("(" + MONTH_RE + ")[a-z]*[.]?" + WS + "([0-9]{1,2})" + WSC + "*[-\u2013\u2014]" + WSC + "*([0-9]{1,2})" + WSC + "*,?" + WSC + "*(20[0-9]{2})", "gi");
  const rangeRe2 = new RegExp("([0-9]{1,2})" + WSC + "*[-\u2013\u2014]" + WSC + "*([0-9]{1,2})" + WS + "(" + MONTH_RE + ")[a-z]*[.]?" + WSC + "*,?" + WSC + "*(20[0-9]{2})", "gi");
  const singleRe = new RegExp("(" + MONTH_RE + ")[a-z]*[.]?" + WS + "([0-9]{1,2})" + WSC + "*,?" + WSC + "*(20[0-9]{2})", "gi");
  const singleRe2 = new RegExp("([0-9]{1,2})" + WS + "(" + MONTH_RE + ")[a-z]*[.]?" + WSC + "*,?" + WSC + "*(20[0-9]{2})", "gi");
  const now = /* @__PURE__ */ new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;
  const push = /* @__PURE__ */ __name((mo, d1, d2, yr, idx, inferYear) => {
    const mon = (mo || "").toLowerCase().slice(0, 3);
    const month = MONTHS[mon];
    if (!month) {
      discarded += 1;
      return;
    }
    let year = yr ? parseInt(yr, 10) : 0;
    if (!year && inferYear) year = month >= nowMonth ? nowYear : nowYear + 1;
    if (year < cutYear || year > cutYear + 2) {
      discarded += 1;
      return;
    }
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
    if (dropGarbage(snippet)) {
      discarded += 1;
      return;
    }
    seen.add(key);
    const pre = clean.slice(Math.max(0, idx - 40), idx).toLowerCase();
    const runningUntil = new RegExp("until|till|t/m|tot(?=" + WSC + "*[0-9])", "i").test(pre);
    const wideSnippet = clean.slice(Math.max(0, idx - 120), Math.min(clean.length, idx + 40)).slice(0, 240);
    const dateText = d2 ? mo + " " + d1 + "-" + d2 + ", " + year : mo + " " + d1 + ", " + year;
    events.push({ venue: src.name, title: buildTitle(clean, idx, cands, src.name, src.titleDir), dateText, startIso, endIso, year, month, day: d1 || null, url: src.url, snippet, wideSnippet, runningUntil, srcKind: src.kind, srcDelivery: src.delivery, srcCost: src.cost });
  }, "push");
  for (const m of clean.matchAll(rangeRe)) push(m[1], parseInt(m[2], 10), parseInt(m[3], 10), m[4], m.index);
  for (const m of clean.matchAll(rangeRe2)) push(m[3], parseInt(m[1], 10), parseInt(m[2], 10), m[4], m.index);
  for (const m of clean.matchAll(singleRe)) push(m[1], parseInt(m[2], 10), null, m[3], m.index);
  for (const m of clean.matchAll(singleRe2)) push(m[2], parseInt(m[1], 10), null, m[3], m.index);
  const rangeReNY = new RegExp("(" + MONTH_RE + ")[a-z]*[.]?" + WS + "([0-9]{1,2})(?![0-9:])" + WSC + "*[-\u2013\u2014]" + WSC + "*([0-9]{1,2})(?![0-9:])", "gi");
  const singleReNY = new RegExp("(" + MONTH_RE + ")[a-z]*[.]?" + WS + "([0-9]{1,2})(?![0-9:])", "gi");
  const singleRe2NY = new RegExp("([0-9]{1,2})(?![0-9])" + WS + "(" + MONTH_RE + ")[a-z]*[.]?", "gi");
  const nearYear = /* @__PURE__ */ __name((i) => /20[0-9]{2}/.test(clean.slice(i, i + 20)), "nearYear");
  for (const m of clean.matchAll(rangeReNY)) {
    if (!nearYear(m.index)) push(m[1], parseInt(m[2], 10), parseInt(m[3], 10), null, m.index, true);
  }
  for (const m of clean.matchAll(singleReNY)) {
    if (!nearYear(m.index)) push(m[1], parseInt(m[2], 10), null, null, m.index, true);
  }
  for (const m of clean.matchAll(singleRe2NY)) {
    if (!nearYear(m.index)) push(m[2], parseInt(m[1], 10), null, null, m.index, true);
  }
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
__name(extractEvents, "extractEvents");
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
__name(classify, "classify");
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
__name(interestHits, "interestHits");
function kwEvidence(g) {
  return (g.e.interestDetail || []).some((h) => h.n >= 1);
}
__name(kwEvidence, "kwEvidence");
function kindFriction(kind) {
  const m = { festival: 0, performance: 1, talk: 1, film: 1, event: 2, exhibition: 2, concert: 2 };
  return m[kind] !== void 0 ? m[kind] : 2;
}
__name(kindFriction, "kindFriction");
function deliveryFriction(d) {
  return d === "onsite" ? 1 : d === "hybrid" ? 0 : 2;
}
__name(deliveryFriction, "deliveryFriction");
function costFriction(c) {
  return c === 0 ? 0 : c === 1 ? 1 : 2;
}
__name(costFriction, "costFriction");
function scoreEvent(ev) {
  const c = classify(ev);
  const hits = interestHits(ev);
  const affinity = VENUE_AFFINITY[ev.venue] || 0;
  const strong = hits.filter((h) => h.n >= 2).length;
  let relevance = hits.length === 0 ? 0 : Math.min(10, 2 + hits.length + strong + affinity);
  if (STANDING_DROP.test(((ev.snippet || "") + " " + ev.venue).toLowerCase())) relevance = 0;
  const friction = Math.min(10, kindFriction(c.kind) + deliveryFriction(c.delivery) + costFriction(c.cost));
  const priority = Math.round(relevance * 10 / (1 + friction) * 10) / 10;
  return {
    ...ev,
    kind: c.kind,
    delivery: c.delivery,
    cost: c.cost,
    interests: hits.slice(0, 4).map((h) => h.code),
    interestDetail: hits.slice(0, 4),
    relevance,
    friction,
    priority,
    frictionClass: friction <= 2 ? "LOW" : friction <= 5 ? "MED" : "HIGH"
  };
}
__name(scoreEvent, "scoreEvent");
// RADAR-TASTE-LEARN-1 (charter pillar: personal). The owner answers each suggestion keep|went|nope (+ reason) and the answers
// land in qnfo-audit.calendar_feedback. Taste score per venue and per domain = (went*2 + keep) - 2*(nope with reason
// not-my-thing or not-my-crowd), shrunk linearly to zero below 3 samples. relevance is multiplied by
// clamp(1 + 0.15*score, 0.3, 1.5). bad-timing and too-much-effort never touch taste: they add +1 friction per occurrence per
// venue (cap 3). The stated-taste prior (art openings and exhibitions up, repair cafes and hobby-tech meetups down) joins in
// only once feedback exists, so an empty or missing table leaves every score exactly as before (fail safe).
var TASTE_PRIOR_DOMAIN = { MUS: 2, CLA: 1, JAZ: 1, QUR: 1 };
var TASTE_PRIOR_TOPICS = [
  { name: "art-opening", re: /\bopening\b|vernissage|exhibition|expositie|tentoonstelling/i, score: 1 },
  { name: "repair-cafe-hobby-tech", re: /repair caf|repaircaf|hackerspace|hobby|arduino|raspberry pi|maker ?space|tech meetup|tech meet-up/i, score: -4 }
];
var TASTE_MIN_SAMPLES = 3;
var TASTE_FRICTION_CAP = 3;
// RADAR-TASTE-SHRINK-1 (#1952): the stated-taste prior is scaled by n/(n+TASTE_PRIOR_K), n = usable feedback rows, so one early
// nope cannot swing the whole prior; below TASTE_FLOOR_ROWS rows the multiplier never goes under TASTE_EARLY_FLOOR (0.6); and the
// personal radar never lets taste drop more than half of a day's viable candidates (tasteValve keeps the top half by pre-taste priority).
var TASTE_PRIOR_K = 3;
var TASTE_FLOOR_ROWS = 5;
var TASTE_EARLY_FLOOR = 0.6;
var TASTE_LATE_FLOOR = 0.3;
function tasteFloor(taste) {
  return taste && taste.rows < TASTE_FLOOR_ROWS ? TASTE_EARLY_FLOOR : TASTE_LATE_FLOOR;
}
__name(tasteFloor, "tasteFloor");
function tasteClamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}
__name(tasteClamp, "tasteClamp");
function buildTaste(rows) {
  const bump = (map, key, f) => {
    if (!key) return;
    const k = String(key).trim();
    if (!k) return;
    const o = map[k] || (map[k] = { went: 0, keep: 0, nopeTaste: 0, friction: 0 });
    f(o);
  };
  const venue = {}, domain = {};
  let used = 0;
  for (const r of rows || []) {
    const action = String(r.action || "").toLowerCase();
    const reason = String(r.reason || "").toLowerCase();
    let f = null;
    if (action === "went") f = (o) => { o.went += 1; };
    else if (action === "keep") f = (o) => { o.keep += 1; };
    else if (action === "nope" && (reason === "not-my-thing" || reason === "not-my-crowd")) f = (o) => { o.nopeTaste += 1; };
    else if (action === "nope" && (reason === "bad-timing" || reason === "too-much-effort")) {
      bump(venue, r.location, (o) => { o.friction += 1; });
      used += 1;
      continue;
    }
    if (!f) continue;
    used += 1;
    bump(venue, r.location, f);
    bump(domain, r.domain, f);
  }
  const fin = (map) => {
    const out = {};
    for (const k of Object.keys(map)) {
      const o = map[k];
      const n = o.went + o.keep + o.nopeTaste;
      const raw = o.went * 2 + o.keep - o.nopeTaste * 2;
      const score = n === 0 ? 0 : raw * Math.min(1, n / TASTE_MIN_SAMPLES);
      out[k] = { went: o.went, keep: o.keep, nope: o.nopeTaste, samples: n, raw, score: Math.round(score * 100) / 100, frictionAdd: Math.min(TASTE_FRICTION_CAP, o.friction) };
    }
    return out;
  };
  return { active: used > 0, rows: used, venue: fin(venue), domain: fin(domain) };
}
__name(buildTaste, "buildTaste");
async function loadTaste(env) {
  try {
    if (!env.RADAR_DB) return { active: false, rows: 0, venue: {}, domain: {} };
    const r = await env.RADAR_DB.prepare("SELECT action, reason, location, domain FROM calendar_feedback ORDER BY id DESC LIMIT 2000").all();
    return buildTaste(r.results || []);
  } catch (e) {
    return { active: false, rows: 0, venue: {}, domain: {} };
  }
}
__name(loadTaste, "loadTaste");
function tasteScoreFor(e, taste) {
  const v = taste.venue[e.venue];
  const dom = (e.interests || [])[0];
  const d = dom ? taste.domain[dom] : null;
  let prior = 0;
  const pd = dom ? TASTE_PRIOR_DOMAIN[dom] : 0;
  if (pd) prior += pd;
  const text = ((e.snippet || "") + " " + (e.venue || "")).toLowerCase();
  for (const t of TASTE_PRIOR_TOPICS) if (t.re.test(text)) prior += t.score;
  const n = taste.rows || 0;
  prior = Math.round(prior * (n / (n + TASTE_PRIOR_K)) * 100) / 100;
  const learned = (v ? v.score : 0) + (d ? d.score : 0);
  return { learned, prior, score: learned + prior, frictionAdd: v ? v.frictionAdd : 0 };
}
__name(tasteScoreFor, "tasteScoreFor");
function applyTaste(e, taste) {
  if (!taste || !taste.active) return e;
  const t = tasteScoreFor(e, taste);
  const mult = tasteClamp(1 + 0.15 * t.score, tasteFloor(taste), 1.5);
  const relevance = e.relevance === 0 ? 0 : Math.min(10, Math.round(e.relevance * mult * 10) / 10);
  const friction = Math.min(10, e.friction + t.frictionAdd);
  const priority = Math.round(relevance * 10 / (1 + friction) * 10) / 10;
  return { ...e, relevance, friction, priority, frictionClass: friction <= 2 ? "LOW" : friction <= 5 ? "MED" : "HIGH", tastePre: { relevance: e.relevance, friction: e.friction, priority: e.priority, frictionClass: e.frictionClass }, taste: { score: t.score, prior: t.prior, mult: Math.round(mult * 1000) / 1000, frictionAdd: t.frictionAdd } };
}
__name(applyTaste, "applyTaste");
function tasteValve(list, taste) {
  let dropped = 0, restored = 0;
  const days = {};
  for (const e of list) {
    if (!e.tastePre || e.tastePre.relevance < 2) continue;
    (days[e.startIso] || (days[e.startIso] = [])).push(e);
  }
  const out = list.slice();
  for (const day of Object.keys(days)) {
    const viable = days[day];
    const lost = viable.filter((e) => e.relevance < 2);
    const keepMin = Math.ceil(viable.length / 2);
    let need = keepMin - (viable.length - lost.length);
    dropped += lost.length;
    if (need <= 0) continue;
    lost.sort((a, b) => b.tastePre.priority - a.tastePre.priority);
    for (const e of lost.slice(0, need)) {
      const i = out.indexOf(e);
      out[i] = { ...e, relevance: e.tastePre.relevance, friction: e.tastePre.friction, priority: e.tastePre.priority, frictionClass: e.tastePre.frictionClass, tasteRestored: true };
      restored += 1;
      dropped -= 1;
    }
  }
  if (taste) {
    taste.droppedByFloor = dropped;
    taste.restoredByValve = restored;
  }
  return out;
}
__name(tasteValve, "tasteValve");
function tasteReportLines(taste) {
  const L = [];
  L.push("## Taste weights (RADAR-TASTE-LEARN-1)");
  if (!taste || !taste.active) {
    L.push("- inactive: no usable calendar_feedback rows yet, so relevance and friction are the plain INTERESTS scores.");
    return L;
  }
  L.push("- feedback rows used: " + taste.rows + ". relevance x clamp(1 + 0.15 x (venue + domain + prior), 0.3, 1.5); shrunk to zero below " + TASTE_MIN_SAMPLES + " samples; bad-timing and too-much-effort add friction only (cap " + TASTE_FRICTION_CAP + ").");
  const fmt = (m) => Object.keys(m).sort().map((k) => k + " score " + m[k].score + " (went " + m[k].went + ", keep " + m[k].keep + ", nope " + m[k].nope + (m[k].frictionAdd ? ", +" + m[k].frictionAdd + " friction" : "") + ", x" + (Math.round(tasteClamp(1 + 0.15 * m[k].score, 0.3, 1.5) * 100) / 100) + ")");
  const v = fmt(taste.venue), d = fmt(taste.domain);
  L.push("- venues: " + (v.length ? v.join("; ") : "none yet"));
  L.push("- domains: " + (d.length ? d.join("; ") : "none yet"));
  L.push("- taste flooring: " + (taste.droppedByFloor || 0) + " candidate(s) dropped below relevance 2 by taste this run; " + (taste.restoredByValve || 0) + " restored by the safety valve (taste may drop at most half of a day's viable candidates, top half by priority kept); multiplier floor " + tasteFloor(taste) + " (" + TASTE_EARLY_FLOOR + " under " + TASTE_FLOOR_ROWS + " feedback rows); prior scaled by n/(n+" + TASTE_PRIOR_K + ").");
  L.push("- stated-taste prior: " + Object.keys(TASTE_PRIOR_DOMAIN).map((k) => k + " +" + TASTE_PRIOR_DOMAIN[k]).join(", ") + "; " + TASTE_PRIOR_TOPICS.map((t) => t.name + " " + (t.score > 0 ? "+" : "") + t.score).join(", ") + ".");
  return L;
}
__name(tasteReportLines, "tasteReportLines");
async function computeBudget(env) {
  const r = await env.PERSONAL_DB.prepare(
    "SELECT venue, start_date FROM events WHERE start_date>=? AND start_date<? AND category IN ('conference','workshop','school','program')"
  ).bind("2027-01-01", "2027-07-01").all();
  const seen = /* @__PURE__ */ new Set();
  let booked = 0;
  for (const row of r.results || []) {
    const k = (row.venue || "") + "|" + String(row.start_date || "").slice(0, 10);
    if (!seen.has(k)) {
      seen.add(k);
      booked += 1;
    }
  }
  return { h1InPersonBooked: booked, h1SlotsLeft: Math.max(0, ENERGY.maxInPersonPerHalfYear - booked), away: await loadAwayWindows(env, (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)) };
}
__name(computeBudget, "computeBudget");
// AWAY-GATE-1 (2026-10-03, charter pillar: personal). Where the owner is comes from personal-life.events rows with
// category 'lodging' (start_date = check-in, end_date = check-out, city = where). A lodging row outside Amsterdam is an
// away window; the check-out day is not part of it (end date exclusive), so the day the owner is home again is not hidden.
// Nothing is deleted: the radar just stops suggesting Amsterdam events that start inside a window.
async function loadAwayWindows(env, fromDate) {
  try {
    const r = await env.PERSONAL_DB.prepare("SELECT city, country, start_date, end_date FROM events WHERE category = 'lodging' AND end_date >= ? ORDER BY start_date").bind(fromDate).all();
    const out = [];
    for (const w of r.results || []) {
      const st = String(w.start_date || "").slice(0, 10);
      const en = String(w.end_date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(st) || !/^\d{4}-\d{2}-\d{2}$/.test(en) || en <= st) continue;
      const city = String(w.city || "").trim();
      if (/^amsterdam$/i.test(city)) continue;
      out.push({ city: city || "elsewhere", start: st, end: en });
    }
    return out;
  } catch (e) {
    return [];
  }
}
__name(loadAwayWindows, "loadAwayWindows");
function awayReason(startIso, windows) {
  const d = String(startIso || "").slice(0, 10);
  for (const w of windows || []) if (d >= w.start && d < w.end) return "away:" + w.city;
  return null;
}
__name(awayReason, "awayReason");
function gateEvent(e, budget) {
  const reasons = [];
  const text = ((e.snippet || "") + " " + e.venue).toLowerCase();
  if (STANDING_DROP.test(text)) reasons.push("standing-filter:QPL/CWI");
  if (e.delivery === "onsite" && SCHENGEN_VENUES.includes(e.venue) && e.startIso >= SCHENGEN_EXIT) {
    reasons.push("schengen-exit:" + SCHENGEN_EXIT);
  }
  if (e.delivery === "onsite" && LOCAL_VENUES.includes(e.venue)) {
    const away = awayReason(e.startIso, budget.away);
    if (away) reasons.push(away);
  }
  if (e.delivery === "onsite" && TRAVEL_KINDS.includes(e.kind) && !LOCAL_VENUES.includes(e.venue)) {
    if (ENERGY.h2_2026_spent && e.startIso < ENERGY.nextEligibility) reasons.push("energy-budget:H2-2026-spent");
    else if (e.startIso >= "2027-01-01" && e.startIso < "2027-07-01" && budget.h1SlotsLeft <= 0) reasons.push("energy-budget:H1-2027-full");
  }
  return { cleared: reasons.length === 0, reasons };
}
__name(gateEvent, "gateEvent");
async function scanVenue(src) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8e3);
  try {
    const r = await fetch(src.url, { headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow", signal: ctrl.signal });
    const text = await r.text();
    if (r.ok) return { name: src.name, ...extractEvents(text, src) };
    return { name: src.name, events: [], discarded: 0, error: "HTTP " + r.status };
  } catch (e) {
    return { name: src.name, events: [], discarded: 0, error: e && e.name === "AbortError" ? "timeout" : String(e && e.message || e).slice(0, 100) };
  } finally {
    clearTimeout(t);
  }
}
__name(scanVenue, "scanVenue");
var slug = /* @__PURE__ */ __name((s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""), "slug");
function calAuthH(env) {
  return env.CAL_TOKEN ? { Authorization: "Bearer " + env.CAL_TOKEN } : {};
}
__name(calAuthH, "calAuthH");
async function fetchExistingCalendar(env) {
  try {
    const r = await env.CAL_API.fetch("https://calendar-api/events?plane=personal", { headers: calAuthH(env) });
    const j = await r.json();
    return (j.events || []).filter((e) => e.source === "personal-radar");
  } catch (e) {
    return [];
  }
}
__name(fetchExistingCalendar, "fetchExistingCalendar");
function renderReport(scannedAt, horizon, gated, budget, stats, posted, taste) {
  const L = [];
  L.push("PERSONAL-EVENTS-RADAR SCAN \u2014 generated " + scannedAt.slice(0, 10) + " (window: " + scannedAt.slice(0, 10) + " .. " + horizon + ")");
  L.push("[PERSONAL-RADAR: " + gated.length + " in-window events | " + stats.okVenues + "/" + stats.totalVenues + " venues ok | " + gated.filter((g) => g.cleared && g.e.relevance >= 2).length + " cleared | " + posted.posted + " posted this run]");
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
  const t90end = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  const tasting = gated.filter((g) => g.cleared && !g.e.runningUntil && !g.e.runningUntilMonth && g.e.relevance >= 2 && g.e.friction <= 2 && g.e.startIso >= t90 && g.e.startIso <= t90end).sort((a, b) => a.e.friction - b.e.friction || b.e.relevance - a.e.relevance).slice(0, 5);
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
  L.push("- away windows (lodging rows outside Amsterdam): " + ((budget.away || []).length ? budget.away.map((w) => w.city + " " + w.start + ".." + w.end).join("; ") + ". Onsite Amsterdam events inside a window are gated (check-out day not included)." : "none."));
  L.push("- Schengen exit deadline: 2026-10-17. Onsite Amsterdam events on/after that date are blocked.");
  L.push("- standing filter: QPL / CWI topics excluded from personal recommendations.");
  if (stats.venueSilent && stats.venueSilent.length) L.push("- SILENT VENUES (zero usable candidates for " + VENUE_ZERO_LIMIT + "+ runs, RADAR-VENUE-SILENT-1): " + stats.venueSilent.join(", ") + ".");
  L.push("- posted to calendar-api plane=personal: " + posted.posted + " new (dedupe skipped " + posted.skipped + ").");
  L.push("");
  for (const x of tasteReportLines(taste)) L.push(x);
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
__name(renderReport, "renderReport");
async function ensureSchema(env) {
  await env.AUDIT_DB.prepare(
    "CREATE TABLE IF NOT EXISTS personal_radar (slug TEXT PRIMARY KEY, report TEXT, events_json TEXT, posted_json TEXT, scanned_at TEXT, updated_at TEXT)"
  ).run();
  try { await env.AUDIT_DB.prepare("ALTER TABLE personal_radar ADD COLUMN venue_zero TEXT").run(); } catch (e) { /* column already exists */ }
}
__name(ensureSchema, "ensureSchema");
// RADAR-VENUE-SILENT-1 (charter pillar: personal): the junk and fragment-title gates, shared by the posting loop and the per-venue yield.
function isJunkCandidate(e) {
  if (/opslaan|dit evenement|next page|previous page|\bpage\s+\d+\b|skip to|lees meer|read more|\bcookie\b|subscribe|newsletter|privacy policy|all rights reserved/i.test(e.snippet) || String(e.snippet || "").trim().length < 15) return true;
  if (!e.title && TITLE_STRICT_VENUES.indexOf(e.venue) !== -1) return true;
  return false;
}
__name(isJunkCandidate, "isJunkCandidate");
// Per-venue consecutive-zero counters live in the existing personal_radar table, in a venue_zero TEXT column added by ensureSchema, on
// each day's report row (the newest row that has one is the state; no extra rows, so readers of the table are unaffected).
// State per venue: z consecutive zero-yield days, p days with a yield, d the UTC day last counted, zb/pb the values before that day
// (a same-day re-run recomputes from them instead of counting twice). A venue whose fetch failed is a gap, never a zero. A venue that
// was productive on at least 2 counted days and then yields nothing for 3 days files ONE agent_issues row (open-title unique index dedupes).
var VENUE_ZERO_LIMIT = 3;
var VENUE_PRODUCTIVE_DAYS = 2;
// RADAR-VENUE-RECOVERED-1 (agent_issues 2573): the filing loop owns the close. A venue that yields again closes the RADAR-VENUE-SILENT-1 issue
// this worker filed, through issue_triage.close_evidence (the only way a status may change). Without it the issue waited for a session or the
// 48 h stale probe ("the filing loop radar-hub did not close it within 48h") although the counter had already reset.
async function closeRecoveredVenueIssue(env, src, y, day) {
  try {
    const open = await env.AUDIT_DB.prepare("SELECT id FROM agent_issues WHERE title = ? AND status = 'open' ORDER BY id DESC LIMIT 1").bind("RADAR-VENUE-SILENT-1: " + src.name).first();
    if (!open || !open.id) return false;
    const ev = "RADAR-VENUE-RECOVERED-1 " + new Date().toISOString() + ": " + src.name + " (" + src.url + ") yielded " + y + " usable candidate(s) in the " + day + " run, so its consecutive-zero counter is 0 (personal_radar.venue_zero); radar-hub closes the issue it filed.";
    await env.AUDIT_DB.prepare("INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, close_evidence) VALUES (?, 'RADAR-VENUE-RECOVERED-1', 'closed', 'radar-hub', datetime('now'), ?) ON CONFLICT(issue_id) DO UPDATE SET close_evidence = excluded.close_evidence, triage_state = 'closed'").bind(open.id, ev).run();
    await env.AUDIT_DB.prepare("UPDATE agent_issues SET status = 'closed', close_channel = 'auto-recovery', updated_at = ? WHERE id = ? AND status = 'open'").bind(Date.now(), open.id).run();
    return true;
  } catch (e) {
    console.error(JSON.stringify({ worker: "radar-hub", where: "closeRecoveredVenueIssue", error: String(e && e.message || e).slice(0, 160) }));
    return false;
  }
}
__name(closeRecoveredVenueIssue, "closeRecoveredVenueIssue");
async function updateVenueCounters(env, gated, venueErrors, day) {
  const out = { silent: [], filed: [], closed: [], state: null };
  try {
    const row = await env.AUDIT_DB.prepare("SELECT venue_zero FROM personal_radar WHERE venue_zero IS NOT NULL ORDER BY scanned_at DESC LIMIT 1").first();
    let st = {};
    try { st = row && row.venue_zero ? JSON.parse(row.venue_zero) || {} : {}; } catch (e) { st = {}; }
    const failed = new Set((venueErrors || []).map((x) => x.venue));
    for (const src of SOURCES) {
      if (failed.has(src.name)) continue;
      const y = gated.filter((g) => g.e.venue === src.name && !isJunkCandidate(g.e)).length;
      const prev = st[src.name] || { z: 0, p: 0, d: "", zb: 0, pb: 0 };
      const baseZ = prev.d === day ? prev.zb || 0 : prev.z || 0;
      const baseP = prev.d === day ? prev.pb || 0 : prev.p || 0;
      const z = y > 0 ? 0 : baseZ + 1;
      const p = y > 0 ? Math.min(60, baseP + 1) : baseP;
      st[src.name] = { z, p, d: day, zb: baseZ, pb: baseP, y };
      if (y > 0 && await closeRecoveredVenueIssue(env, src, y, day)) out.closed.push(src.name);
      if (z >= VENUE_ZERO_LIMIT && p >= VENUE_PRODUCTIVE_DAYS) {
        out.silent.push(src.name);
        const now = Date.now();
        const r = await env.AUDIT_DB.prepare("INSERT OR IGNORE INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
          .bind("RADAR-VENUE-SILENT-1: " + src.name, "The personal radar venue " + src.name + " (" + src.url + ") produced zero usable candidates for " + z + " consecutive runs after " + p + " productive days. Fetch succeeded, so the page markup probably changed or only fragment titles remain (they are skipped, not posted). Open the page, adjust the " + src.name + " extractor in radar-hub/worker.js with a fixture, and the counter resets on the next productive run.", "radar-hub", "personal", "low", "open", now, now).run();
        if (r && r.meta && r.meta.changes) out.filed.push(src.name);
      }
    }
    out.state = JSON.stringify(st);
  } catch (e) {
    console.error("updateVenueCounters", e && e.message || e);
  }
  return out;
}
__name(updateVenueCounters, "updateVenueCounters");
async function run(env) {
  await ensureSchema(env);
  const scannedAt = (/* @__PURE__ */ new Date()).toISOString();
  const nowIso = scannedAt.slice(0, 10);
  const horizon = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  const budget = await computeBudget(env);
  const results = await Promise.allSettled(SOURCES.map((s) => scanVenue(s)));
  const rawEvents = [];
  const venueErrors = [];
  let discarded = 0;
  results.forEach((res, i) => {
    if (res.status === "fulfilled" && res.value) {
      if (res.value.error) venueErrors.push({ venue: SOURCES[i].name, error: res.value.error });
      else {
        rawEvents.push(...res.value.events);
        discarded += res.value.discarded;
      }
    } else venueErrors.push({ venue: SOURCES[i].name, error: String((res.reason || "?").slice(0, 100)) });
  });
  const inWindow = rawEvents.filter((e) => e.startIso >= nowIso && e.startIso <= horizon);
  const taste = await loadTaste(env);
  const scored = tasteValve(inWindow.map(scoreEvent).map((e) => applyTaste(e, taste)), taste);
  const seen = /* @__PURE__ */ new Set();
  const uniq = scored.filter((e) => {
    const k = e.venue + "|" + e.startIso;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const gated = uniq.map((e) => ({ e, ...gateEvent(e, budget) }));
  const existing = await fetchExistingCalendar(env);
  const existingKeys = new Set(existing.map((x) => String(x.location || "").toLowerCase() + "|" + String(x.dtstart || "").slice(0, 10)));
  let ledgerRows = [];
  try {
    const lr = await env.PERSONAL_DB.prepare("SELECT venue, start_date FROM events WHERE start_date>=?").bind(nowIso).all();
    ledgerRows = lr.results || [];
  } catch (e) {
  }
  const ledgerSlugs = ledgerRows.map((x) => ({ v: slug(x.venue), d: String(x.start_date || "").slice(0, 10) }));
  let posted = 0, skipped = 0, writeFailures = 0;
  const postedList = [];
  for (const g of gated) {
    if (g.e.runningUntil || g.e.runningUntilMonth) {
      skipped += 1;
      continue;
    }
    if (!g.cleared || g.e.relevance < 2) continue;
    /* junkgate-marker */
    if (isJunkCandidate(g.e)) { skipped += 1; continue; }
    let title = g.e.venue + ": " + g.e.snippet.slice(0, 90);
    const cut = title.lastIndexOf(" ");
    if (cut > 30) title = title.slice(0, cut);
    if (g.e.title) title = g.e.venue + ": " + g.e.title;
    const key = g.e.venue.toLowerCase() + "|" + g.e.startIso;
    const kSlug = slug(g.e.venue);
    const ledgerDup = ledgerSlugs.some((r) => r.d === g.e.startIso && (r.v.indexOf(kSlug) !== -1 || kSlug.indexOf(r.v) !== -1));
    if (existingKeys.has(key) || ledgerDup) {
      skipped += 1;
      continue;
    }
    if (posted >= 8) {
      skipped += 1;
      continue;
    }
    const body = {
      title,
      dtstart: g.e.startIso,
      dtend: g.e.endIso,
      all_day: false,
      location: g.e.venue,
      url: g.e.url,
      source: "personal-radar",
      domain: g.e.interests[0] || null,
      relevance: g.e.relevance,
      friction: g.e.friction,
      status: "tentative",
      description: g.e.snippet.slice(0, 300)
    };
    try {
      const pr = await env.CAL_API.fetch("https://calendar-api/events?plane=personal", {
        method: "POST",
        headers: Object.assign({ "content-type": "application/json" }, calAuthH(env)),
        body: JSON.stringify(body)
      });
      if (pr.ok) {
        posted += 1;
        postedList.push({ title, dtstart: g.e.startIso, id: (await pr.json()).id || null });
        existingKeys.add(key);
      } else { skipped += 1; writeFailures += 1; }
    } catch (e) {
      skipped += 1; writeFailures += 1;
    }
  }
  if (writeFailures > 0 && gated.length > 0 && gated.filter((g) => g.cleared).length > 0) {
    try {
      await env.RADAR_DB.prepare("INSERT INTO self_heal_actions (kind, ref, action, ts, status) VALUES (?,?,?,datetime('now'),'detected')").bind("calendar-write-path-broken", "radar-hub/personal/" + scannedAt.slice(0, 10), "personal radar: cleared>0 but 0 posted (write/auth failure) - verify CAL_TOKEN matches calendar-api").run();
    } catch (e) { console.error(JSON.stringify({ worker: "radar-hub", where: "perMod.run", error: String(e && e.message || e) })); }
  }
  const venueSilent = await updateVenueCounters(env, gated, venueErrors, scannedAt.slice(0, 10));
  const stats = { venueSilent: venueSilent.silent, inWindow: uniq.length, discarded, okVenues: SOURCES.length - venueErrors.length, totalVenues: SOURCES.length, venueErrors, horizonISO: horizon };
  const report = renderReport(scannedAt, horizon, gated, budget, stats, { posted, skipped }, taste);
  const slugN = "personal-events-radar-" + scannedAt.slice(0, 10);
  let delivery = null;
  try {
    if (env.OBSIDIAN_WRITER) {
      const dr = await env.OBSIDIAN_WRITER.fetch("https://obsidian-writer/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "personal-events-radar", section: "Personal Events Radar", content: report, date: scannedAt.slice(0, 10) })
      });
      delivery = { status: dr.status, ok: dr.ok };
    }
  } catch (e) {
    delivery = { error: String(e && e.message || e).slice(0, 120) };
  }
  await env.AUDIT_DB.prepare(
    "INSERT OR REPLACE INTO personal_radar (slug, report, events_json, posted_json, scanned_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(slugN, report, JSON.stringify(gated), JSON.stringify(postedList), scannedAt, scannedAt).run();
  if (venueSilent.state) { try { await env.AUDIT_DB.prepare("UPDATE personal_radar SET venue_zero = ? WHERE slug = ?").bind(venueSilent.state, slugN).run(); } catch (e) { console.error("venue_zero write", e && e.message || e); } }
  return {
    slug: slugN,
    version: PERSONAL_VERSION,
    events: uniq.length,
    discarded,
    venueErrors: venueErrors.length,
    budget,
    silentVenues: venueSilent.silent,
    recoveredVenues: venueSilent.closed,
    taste: { active: taste.active, rows: taste.rows, droppedByFloor: taste.droppedByFloor || 0, restoredByValve: taste.restoredByValve || 0 },
    posted: postedList,
    delivery,
    topPicks: gated.filter((g) => g.cleared && !g.e.runningUntil && !g.e.runningUntilMonth && g.e.relevance >= 3).sort((a, b) => b.e.priority - a.e.priority).slice(0, 5).map((g) => "P" + g.e.priority + " " + g.e.startIso + " " + g.e.venue + " " + g.e.interests.join("/") + " [" + g.e.delivery + "]")
  };
}
__name(run, "run");
var worker_default = {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
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
      return new Response(JSON.stringify({ ok: true, worker: WORKER, version: PERSONAL_VERSION }), { headers: { "content-type": "application/json" } });
    }
    return new Response("personal-events-radar worker: GET / (latest report) | GET /?run=1 (trigger scan) | GET /health", { status: 404 });
  }
};
return { default: worker_default };
})();
//# sourceMappingURL=worker.js.map


// MENTION-RADAR-1 begin
// MENTION-RADAR-1 (2026-10-01, #1641 EXTERNAL-MENTION-MONITOR-EMPTY-1; charter pillar: reach; STRATEGY 6.1 "Mentions").
// Daily discovery of third-party references to the owner's work from free, keyless public APIs:
//   openalex  works that cite an OpenAlex work of ORCID 0009-0002-4317-5604 (cites: filter)
//   datacite  DataCite records whose relatedIdentifiers cite/reference one of the owner's tracked DOIs (citation_stats)
//   bluesky   app.bsky.feed.searchPosts for qnfo.org / papers.qnfo.org links and the name "Quni-Gudzinas"
//   hn        Hacker News Algolia search for qnfo (whole word), qnfo.org urls and "Quni-Gudzinas"
// Crossref Event Data is not used: the service was retired.
// Self-references are excluded (owner ORCID, owner names, the QNFO label, the owner's Bluesky DIDs).
// Dedupe: the stable key is the canonical url (https://doi.org/<lowercased doi>, https://bsky.app/profile/<did>/post/<rkey>,
// https://news.ycombinator.com/item?id=<id> for comments, the same url rule qnfo-cloud-ops jobRadar uses for hn). A url
// already present in external_mentions under any source is not written again (UNIQUE(source, url) plus NOT EXISTS on url).
// reach_signals: one row per channel per UTC day, source 'mention-radar', entity site/qnfo, metric 'mentions' (rows of that
// source first seen that day, recomputed from D1 so a rerun is idempotent) and 'mentions_visible' (distinct external mentions
// the API returned). A source whose API failed writes NO reach_signals row: a failure is a gap, never a zero.
var mentionMod = (function(){
  var ORCID = "0009-0002-4317-5604";
  var SELECTED_DOIS = [];
  // qnfo.bsky.social, its Mastodon bridge, and the owner's personal account (qvers.bsky.social).
  var SELF_DIDS = ["did:plc:vad2yeqflg5uznmp557zge5c", "did:plc:veqmjot4gx3e7vz644mjtgyv", "did:plc:t57gdiqaqydoacnyjptth64f"];
  var SELF_NAME = /quni|gudzinas|\bqnfo\b/i;
  var CITE_REL = /^(cites|references|reviews|isderivedfrom|issupplementto|continues|compiles)$/i;
  var REQ = { headers: { "User-Agent": "QNFO-mention-radar/1.0 (+https://qnfo.org; mailto:qnfo@qnfo.org)", "Accept": "application/json" } };
  var OA = "https://api.openalex.org/works";
  var MAILTO = "&mailto=qnfo%40qnfo.org";

  function day(d) { return (d || new Date()).toISOString().slice(0, 10); }
  function normDoi(s) { return String(s || "").trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi:/, ""); }
  function errStr(e) { return "error:" + String((e && e.message) || e).slice(0, 80); }
  function clip(s, n) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n); }
  async function getJson(f, url) {
    var r = await f(url, REQ);
    if (!r || !r.ok) throw new Error("http " + (r ? r.status : "none"));
    return r.json();
  }
  function chunk(a, n) { var o = []; for (var i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

  async function ownerDois(env) {
    var set = new Set(SELECTED_DOIS);
    try {
      var r = await env.AUDIT.prepare("SELECT DISTINCT lower(doi) AS doi FROM citation_stats WHERE doi IS NOT NULL AND lower(doi) NOT LIKE '10.5281/%' LIMIT 400").all();
      for (var x of (r.results || [])) if (x.doi && !/^10\.5281\//.test(normDoi(x.doi))) set.add(normDoi(x.doi));
    } catch (e) { console.error(JSON.stringify({ worker: "radar-hub", where: "mentionMod.ownerDois", error: String(e && e.message || e) })); }
    return Array.from(set);
  }

  // ---- openalex
  async function srcOpenAlex(f) {
    var ids = new Map(), cursor = "*";
    for (var p = 0; p < 5 && cursor; p++) {
      var j = await getJson(f, OA + "?filter=author.orcid:" + ORCID + "&select=id,doi&per-page=200&cursor=" + encodeURIComponent(cursor) + MAILTO);
      for (var w of (j.results || [])) if (w.id) ids.set(String(w.id).replace("https://openalex.org/", ""), normDoi(w.doi));
      cursor = j.meta && j.meta.next_cursor;
      if (!(j.results || []).length) break;
    }
    var out = [];
    for (var group of chunk(Array.from(ids.keys()), 50)) {
      var cur = "*";
      for (var q = 0; q < 3 && cur; q++) {
        var jj = await getJson(f, OA + "?filter=cites:" + group.join("|") + "&select=id,doi,display_name,authorships,referenced_works,publication_date,cited_by_count&per-page=200&cursor=" + encodeURIComponent(cur) + MAILTO);
        for (var c of (jj.results || [])) {
          var auths = c.authorships || [];
          var self = auths.some(function(a) { var au = a.author || {}; return String(au.orcid || "").indexOf(ORCID) >= 0 || SELF_NAME.test(au.display_name || "") || SELF_NAME.test(a.raw_author_name || ""); });
          if (self) continue;
          var cited = (c.referenced_works || []).map(function(r) { return String(r).replace("https://openalex.org/", ""); }).filter(function(r) { return ids.has(r); }).map(function(r) { return ids.get(r) || r; });
          var doi = normDoi(c.doi);
          out.push({ source: "openalex-cites", url: doi ? "https://doi.org/" + doi : String(c.id || ""), title: clip("cites " + (cited.join(", ") || "owner work") + ": " + (c.display_name || ""), 180), author: clip(auths.slice(0, 3).map(function(a) { return (a.author && a.author.display_name) || a.raw_author_name || ""; }).join("; "), 180), score: Number(c.cited_by_count) || 0, created: c.publication_date || "" });
        }
        cur = jj.meta && jj.meta.next_cursor;
        if (!(jj.results || []).length) break;
      }
    }
    return out;
  }

  // ---- datacite
  async function srcDataCite(f, dois) {
    var own = new Set(dois), out = [];
    for (var group of chunk(dois, 15)) {
      var gset = new Set(group);
      var q = "relatedIdentifiers.relatedIdentifier:(" + group.map(function(d) { return "\"" + d + "\""; }).join(" OR ") + ")";
      var url = "https://api.datacite.org/dois?query=" + encodeURIComponent(q) + "&" + encodeURIComponent("page[size]") + "=100&" + encodeURIComponent("fields[dois]") + "=doi,creators,titles,relatedIdentifiers,published,created";
      for (var p = 0; p < 3 && url; p++) {
        var j = await getJson(f, url);
        for (var d of (j.data || [])) {
          var a = d.attributes || {}, doi = normDoi(a.doi || d.id);
          if (!doi || own.has(doi)) continue;
          var creators = a.creators || [];
          var self = creators.some(function(c) { return SELF_NAME.test(c.name || "") || SELF_NAME.test(c.familyName || "") || (c.nameIdentifiers || []).some(function(n) { return String(n.nameIdentifier || "").indexOf(ORCID) >= 0; }); });
          if (self) continue;
          var cited = (a.relatedIdentifiers || []).filter(function(r) { return CITE_REL.test(r.relationType || "") && gset.has(normDoi(r.relatedIdentifier)); }).map(function(r) { return normDoi(r.relatedIdentifier); });
          if (!cited.length) continue;
          var t = (a.titles && a.titles[0] && a.titles[0].title) || "";
          out.push({ source: "datacite-cites", url: "https://doi.org/" + doi, title: clip("cites " + cited.join(", ") + ": " + t, 180), author: clip(creators.slice(0, 3).map(function(c) { return c.name || ""; }).join("; "), 180), score: 0, created: String(a.published || a.created || "") });
        }
        url = j.links && j.links.next;
      }
    }
    return out;
  }

  // ---- bluesky
  var BSKY_QUERIES = ["qnfo.org", "papers.qnfo.org", "\"Quni-Gudzinas\""];
  async function srcBluesky(f) {
    var out = [];
    for (var q of BSKY_QUERIES) {
      var j = await getJson(f, "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=" + encodeURIComponent(q) + "&limit=100&sort=latest");
      for (var p of (j.posts || [])) {
        var a = p.author || {}, rec = p.record || {};
        if (SELF_DIDS.indexOf(a.did) >= 0 || /qnfo/i.test(a.handle || "") || SELF_NAME.test(a.displayName || "")) continue;
        var blob = String(rec.text || "") + " " + JSON.stringify(rec.facets || []) + " " + JSON.stringify(rec.embed || p.embed || {});
        if (!/qnfo\.org/i.test(blob) && !/quni-gudzinas/i.test(blob)) continue;
        var rkey = String(p.uri || "").split("/").pop();
        if (!a.did || !rkey) continue;
        out.push({ source: "bluesky", url: "https://bsky.app/profile/" + a.did + "/post/" + rkey, title: clip(rec.text || "(post)", 180), author: clip(a.handle || a.did, 180), score: (p.likeCount || 0) + (p.repostCount || 0) + (p.replyCount || 0) + (p.quoteCount || 0), created: rec.createdAt || p.indexedAt || "" });
      }
    }
    return out;
  }

  // ---- hacker news (same url rule as qnfo-cloud-ops jobRadar, so the two writers dedupe on (hn, url))
  var HN_QUERIES = [
    "https://hn.algolia.com/api/v1/search?query=qnfo&tags=(story,comment)&hitsPerPage=50&typoTolerance=false",
    "https://hn.algolia.com/api/v1/search?query=qnfo.org&restrictSearchableAttributes=url&hitsPerPage=50&typoTolerance=false",
    "https://hn.algolia.com/api/v1/search?query=%22Quni-Gudzinas%22&tags=(story,comment)&hitsPerPage=50&typoTolerance=false"
  ];
  async function srcHn(f) {
    var out = [];
    var hit = function(s) { return /\bqnfo\b/i.test(String(s || "")) || /quni-gudzinas/i.test(String(s || "")); };
    for (var q of HN_QUERIES) {
      var j = await getJson(f, q);
      for (var h of (j.hits || [])) {
        var u = h.story_url || h.url || "https://news.ycombinator.com/item?id=" + h.objectID;
        if (!hit(h.title) && !hit(h.story_title) && !hit(u) && !hit(h.comment_text) && !hit(h.story_text)) continue;
        out.push({ source: "hn", url: h.comment_text ? "https://news.ycombinator.com/item?id=" + h.objectID : u, title: clip(h.title || h.story_title || "comment", 180), author: clip(h.author || "", 180), score: h.points || 0, created: h.created_at || "" });
      }
    }
    return out;
  }

  var CHANNELS = [
    { channel: "openalex", source: "openalex-cites", quality: "human", run: function(f, dois) { return srcOpenAlex(f); } },
    { channel: "datacite", source: "datacite-cites", quality: "human", needsDois: true, run: function(f, dois) { return srcDataCite(f, dois); } },
    { channel: "bluesky", source: "bluesky", quality: "unknown", run: function(f) { return srcBluesky(f); } },
    { channel: "hn", source: "hn", quality: "unknown", run: function(f) { return srcHn(f); } }
  ];

  async function run(env, opts) {
    opts = opts || {};
    var f = opts.fetch || ((u, i) => fetch(u, i));
    var now = opts.now || new Date(), today = day(now), iso = now.toISOString();
    var db = env.AUDIT || env.RADAR_DB || env.AUDIT_DB;
    if (!db) return { status: "error", error: "no AUDIT binding" };
    var dois = await ownerDois({ AUDIT: db });
    var sources = {}, written = {}, signals = 0;
    for (var ch of CHANNELS) {
      var list;
      if (ch.needsDois && !dois.length) continue;
      try { list = await ch.run(f, dois); }
      catch (e) { sources[ch.channel] = errStr(e); continue; }
      var seen = new Map();
      for (var m of list) if (m.url && !seen.has(m.url)) seen.set(m.url, m);
      sources[ch.channel] = "ok:" + seen.size;
      var added = 0;
      for (var mm of seen.values()) {
        try {
          var r = await db.prepare("INSERT OR IGNORE INTO external_mentions (ts, source, title, url, author, score, created, first_seen) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM external_mentions WHERE url = ?)").bind(iso, mm.source, mm.title, mm.url, mm.author, mm.score, mm.created, iso, mm.url).run();
          if (r && r.meta && r.meta.changes) added += r.meta.changes;
        } catch (e) { console.error(JSON.stringify({ worker: "radar-hub", where: "mentionMod.run", error: String(e && e.message || e) })); }
      }
      written[ch.channel] = added;
      try {
        var cnt = await db.prepare("SELECT COUNT(*) AS n FROM external_mentions WHERE source = ? AND substr(first_seen, 1, 10) = ?").bind(ch.source, today).first();
        var n = Number(cnt && cnt.n) || 0;
        var ins = "INSERT OR REPLACE INTO reach_signals (date, source, channel, entity_type, entity_id, metric, value, quality) VALUES (?, 'mention-radar', ?, 'site', 'qnfo', ?, ?, ?)";
        await db.prepare(ins).bind(today, ch.channel, "mentions", n, ch.quality).run();
        await db.prepare(ins).bind(today, ch.channel, "mentions_visible", seen.size, ch.quality).run();
        signals += 2;
      } catch (e) { sources[ch.channel] += " signals-" + errStr(e); }
    }
    var vals = Object.values(sources), healthy = vals.filter(function(v) { return v.indexOf("ok:") === 0; }).length;
    var res = { status: healthy === 0 ? "error" : healthy < vals.length ? "degraded" : "ok", date: today, owner_dois: dois.length, sources: sources, new_mentions: written, reach_signals_rows: signals };
    // MENTION-RADAR-LEDGER-1 (radar-hub 1.1.3): the run result went only to the console and a run whose every source
    // failed wrote nothing, so a dead radar looked like a quiet one. One cloud_ops_events row per UTC day, id
    // mention-radar-<day> (kind mention-radar, job radar-hub), replaced by each run that day. Best-effort.
    try {
      await db.prepare("INSERT OR REPLACE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?, ?, 'mention-radar', ?, ?, 'radar-hub', ?)").bind("mention-radar-" + today, iso, clip("mention radar " + res.status + " " + JSON.stringify(sources), 500), JSON.stringify(res).slice(0, 3000), res.status).run();
      res.recorded = true;
    } catch (e) { res.recorded = false; }
    return res;
  }

  async function recent(env) {
    var db = env.AUDIT || env.RADAR_DB || env.AUDIT_DB;
    var by = await db.prepare("SELECT source, COUNT(*) AS n, MAX(first_seen) AS last FROM external_mentions GROUP BY source ORDER BY n DESC").all();
    var rows = await db.prepare("SELECT source, title, url, author, created, first_seen FROM external_mentions ORDER BY first_seen DESC LIMIT 50").all();
    return { by_source: by.results || [], recent: rows.results || [] };
  }

  async function fetchHandler(request, env) {
    var p = new URL(request.url).pathname;
    var J = function(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json" } }); };
    if (p === "/run") {
      if (request.method !== "POST") return J({ error: "POST /mentions/run" }, 405);
      return J(await run(env));
    }
    if (p === "/" || p === "") return J(await recent(env));
    return J({ error: "not found" }, 404);
  }

  return { run: run, recent: recent, fetch: fetchHandler, CHANNELS: CHANNELS, SELECTED_DOIS: SELECTED_DOIS };
})();
// MENTION-RADAR-1 end

// SIGNAL-INTAKE-SOURCES-1 (radar-hub 1.3.0, 2026-10-06, agent_issues 1947 SIGNAL-INTAKE-1; pillar: research).
// Owner directive 2026-10-06: the Quniverse must consider broader interdisciplinary signals, not only arXiv papers about
// quantum computing (QNFO) and Hacker News / GitHub (q08). Measured before this change in qnfo-audit (30 days): every
// `signals` row came from artifact_reentry (520), q08 (104) or reading (49); every accepted idea_proposals row came from
// auto-scan (the qnfo-cloud-ops arXiv query), auto-reentry or auto-miner; idea_topic_concentration_30d read 0.596.
// This module is a D1-driven feed intake. radar_sources rows with kind 'signal' (RSS 2.0, RSS 1.0 / RDF, Atom and the
// arXiv API) are fetched once a day; every item is scored, with no model call, against the owner's interest lexicon
// (STRATEGY 2.3 pillars plus the published corpus: foundations of physics, information and ontology, complexity and
// self-organisation, thermodynamics of computation, epistemics and metascience, autonomous research systems, number
// theory, origins of life and mind, invention); the best few, spread across source families, become idea_proposals rows
// (name 'intake:<family>', ip_hash 'intake:<url hash>') that idea-hub triages like every other producer. Bounded: at most
// SIGNAL_INTAKE_MAX_PER_RUN rows a run (ops_config signal_intake_max_per_run) and MAX_PER_FAMILY per family; every item is
// recorded once by URL in signal_intake_seen; ops_config signal_intake_enabled='0' stops it. It runs in the existing
// 08:30Z daily slot (CRON_TABLE unchanged, no new cron) and adds no model call (none may be added while a fleet_budget cap
// is breached; triage defers scoring under a breach anyway). Ledger: one cloud_ops_events row per UTC day
// (signal-intake-<day>, kind signal-intake, job radar-hub). Metric signal_source_families_7d: distinct families with an
// accepted item in 7 days (registered with its trigger in migrations/2026-10-06-signal-intake-sources.sql). Sources are
// data: INSERT a radar_sources row (kind 'signal', category = family, cadence 'daily', enabled 1) and the next run reads
// it; the events radar skips kind 'signal' rows (they are feeds, not venue pages).
var intakeMod = (function(){
  var VERSION = "1.0.0";
  var MAX_PER_RUN_DEFAULT = 8, MAX_PER_FAMILY = 2, MAX_ITEMS_PER_SOURCE = 60, FETCH_MS = 12000, MAX_AGE_DAYS = 14;
  var UA = "Mozilla/5.0 (compatible; QNFO radar-hub signal-intake/" + VERSION + "; +https://qnfo.org)";
  // Two tiers of lexicon. A STRONG term names an interest the owner has published on or STRATEGY 2.3 leads with; a WEAK
  // term is a field word that alone says little. An item is kept with at least one strong term and a score of 3 or more
  // (strong 2, weak 1), so "model", "theory" and "information" in a journal abstract never pass by themselves.
  var STRONG = ["ultrametric", "p-adic", "non-archimedean", "adelic", "landauer", "thermodynamics of computation", "thermodynamic cost",
    "energy per computation", "joules per", "energy cost of comput", "energy efficiency of comput", "reversible comput", "self-reference",
    "self-referential", "strange loop", "laws of form", "distinction", "ontolog", "epistem", "ignorance", "metascience", "reproducib",
    "replication crisis", "open science", "ai for science", "autonomous research", "self-improving", "foundations of physics",
    "interpretation of quantum", "it from bit", "origin of life", "abiogenesis", "biogenesis", "free energy principle", "active inference",
    "algorithmic information", "kolmogorov", "computational irreducib", "cellular automat", "category theory", "emergence", "emergent",
    "self-organi", "self-organis", "criticality", "phase transition", "nonequilibrium", "non-equilibrium", "dissipative", "scale-free",
    "scale invarian", "fractal", "number theor", "prime number", "riemann", "zeta function", "information-theoretic", "information theory",
    "entropy production", "maximum entropy", "measurement problem", "observer", "consciousness", "theory of mind", "collective intelligence",
    "cooperation", "network science", "complex system", "complexity science", "patent", "invention", "inventor", "data center energy",
    "datacenter energy", "energy of ai", "compute energy", "carbon footprint of", "agentic", "autonomous agent", "multi-agent",
    "scientific discovery", "hypothesis generation", "peer review", "research integrity", "falsifi", "bayesian", "causal inference",
    "counterfactual", "quantum thermodynamic", "error correction", "zitterbewegung", "geometrogenesis", "holograph", "spacetime emergen"];
  var WEAK = ["quantum", "thermodynamic", "entropy", "information", "complex", "network", "model", "theory", "philosoph", "mathematic",
    "evolution", "cognition", "brain", "language model", "llm", "energy", "computation", "computing", "knowledge", "science policy",
    "funding", "university", "physics", "biology", "economics", "logic", "simulation", "measurement", "benchmark", "open source"];
  var SKIP_TITLE = /^(correction|author correction|publisher correction|erratum|corrigendum|retraction|retracted|editorial|table of contents)\b/i;
  function tagText(block, name) {
    var m = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + name + ">", "i"));
    return m ? m[1] : "";
  }
  function decode(s) {
    return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, function(m, n) { var c = Number(n); return c > 31 && c < 1114112 ? String.fromCodePoint(c) : " "; })
      .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  }
  function itemLink(block) {
    // Atom: <link href=".." rel="alternate"/> (rel may be absent); arXiv API also carries <id>http://arxiv.org/abs/..</id>;
    // RSS 2.0: <link>url</link>; RSS 1.0 / RDF: <item rdf:about="url"> and <link>url</link>.
    var tags = block.match(/<link\b[^>]*>/gi) || [];
    var alt = null, any = null;
    for (var i = 0; i < tags.length; i++) {
      var h = tags[i].match(/\bhref="([^"]+)"/i);
      if (!h) continue;
      var rel = (tags[i].match(/\brel="([^"]+)"/i) || [])[1];
      if (!rel || rel === "alternate") { alt = alt || h[1]; }
      any = any || h[1];
    }
    var txt = decode(tagText(block, "link"));
    var about = (block.match(/^<(?:item|entry)\b[^>]*\brdf:about="([^"]+)"/i) || [])[1];
    var id = decode(tagText(block, "id"));
    var pick = alt || (/^https?:\/\//i.test(txt) ? txt : null) || about || any || (/^https?:\/\//i.test(id) ? id : null) || "";
    return String(pick).trim();
  }
  function parseFeed(xml) {
    var s = String(xml || "");
    var blocks = s.match(/<entry\b[\s\S]*?<\/entry>/gi) || s.match(/<item\b[\s\S]*?<\/item>/gi) || [];
    var out = [];
    for (var i = 0; i < blocks.length && out.length < MAX_ITEMS_PER_SOURCE; i++) {
      var b = blocks[i];
      var title = decode(tagText(b, "title")).slice(0, 240);
      var link = itemLink(b);
      if (!title || !/^https?:\/\//i.test(link)) continue;
      var summary = decode(tagText(b, "summary") || tagText(b, "description") || tagText(b, "content:encoded") || tagText(b, "content")).slice(0, 1200);
      var pub = decode(tagText(b, "published") || tagText(b, "updated") || tagText(b, "pubDate") || tagText(b, "dc:date"));
      out.push({ title: title, link: link, summary: summary, published: pub });
    }
    return out;
  }
  function score(item) {
    var text = (item.title + " " + item.summary).toLowerCase();
    var strong = [], weak = 0;
    for (var i = 0; i < STRONG.length; i++) if (text.indexOf(STRONG[i]) >= 0) strong.push(STRONG[i]);
    for (var j = 0; j < WEAK.length; j++) if (text.indexOf(WEAK[j]) >= 0) weak++;
    return { score: strong.length * 2 + weak, strong: strong, weak: weak };
  }
  function tooOld(pub, now) {
    if (!pub) return false;
    var t = Date.parse(pub);
    return isFinite(t) && (now.getTime() - t) > MAX_AGE_DAYS * 864e5;
  }
  async function sha16(s) {
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
    return Array.from(new Uint8Array(buf)).slice(0, 8).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  // Pure selection: top MAX_PER_FAMILY per family by score, then round-robin across families (alphabetical) up to max.
  function selectAcross(candidates, max) {
    var byFam = {};
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      (byFam[c.family] = byFam[c.family] || []).push(c);
    }
    var fams = Object.keys(byFam).sort();
    for (var f = 0; f < fams.length; f++) byFam[fams[f]].sort(function(a, b) { return b.score - a.score; });
    var picked = [];
    for (var round = 0; round < MAX_PER_FAMILY && picked.length < max; round++) {
      for (var k = 0; k < fams.length && picked.length < max; k++) {
        var row = byFam[fams[k]][round];
        if (row) picked.push(row);
      }
    }
    return picked;
  }
  async function ensureSchema(db) {
    await db.prepare("CREATE TABLE IF NOT EXISTS signal_intake_seen (url TEXT PRIMARY KEY, family TEXT, source TEXT, title TEXT, score REAL, accepted INTEGER DEFAULT 0, proposal_id INTEGER, seen_at TEXT DEFAULT (datetime('now')))").run();
  }
  async function readConfig(db) {
    var max = MAX_PER_RUN_DEFAULT, enabled = true;
    try {
      var rows = (await db.prepare("SELECT key, value FROM ops_config WHERE key IN ('signal_intake_max_per_run','signal_intake_enabled')").all()).results || [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].key === "signal_intake_max_per_run") { var n = parseInt(String(rows[i].value), 10); if (isFinite(n) && n >= 0 && n <= 40) max = n; }
        if (rows[i].key === "signal_intake_enabled" && String(rows[i].value).trim() === "0") enabled = false;
      }
    } catch (e) { console.error(JSON.stringify({ worker: "radar-hub", where: "intakeMod.readConfig", error: String(e && e.message || e) })); }
    return { max: max, enabled: enabled };
  }
  async function fetchSource(f, src) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function() { ctl.abort(); }, FETCH_MS) : null;
    try {
      var r = await f(src.url, { headers: { "User-Agent": UA, "Accept": "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5" }, signal: ctl ? ctl.signal : undefined, cf: { cacheTtl: 1800 } });
      if (!r.ok) return { error: "http " + r.status, items: [] };
      var txt = await r.text();
      var items = parseFeed(txt);
      return items.length ? { items: items } : { error: "no items parsed (" + txt.length + " bytes)", items: [] };
    } catch (e) {
      // The detail goes to the worker log; the run result (served by POST /intake/run) carries a fixed class only
      // (CodeQL js/stack-trace-exposure).
      console.log("signal-intake fetch " + src.url + ": " + String((e && e.message) || e).slice(0, 160));
      return { error: e && e.name === "AbortError" ? "timeout" : "fetch failed", items: [] };
    } finally { if (timer) clearTimeout(timer); }
  }
  async function run(env, opts) {
    opts = opts || {};
    var f = opts.fetch || ((u, i) => fetch(u, i));
    var now = opts.now || new Date(), today = now.toISOString().slice(0, 10), iso = now.toISOString();
    var db = env.AUDIT || env.RADAR_DB || env.AUDIT_DB;
    if (!db) return { status: "error", error: "no AUDIT binding" };
    var out = { status: "ok", date: today, version: VERSION, sources: {}, fetched: 0, items: 0, candidates: 0, inserted: 0, dupes: 0, families: {}, picked: [] };
    await ensureSchema(db);
    var cfg = await readConfig(db);
    if (!cfg.enabled) { out.status = "skipped"; out.reason = "ops_config signal_intake_enabled=0"; await ledger(db, today, iso, out); return out; }
    var srcs = [];
    try { srcs = (await db.prepare("SELECT name, url, category FROM radar_sources WHERE enabled=1 AND kind='signal' ORDER BY category, name").all()).results || []; }
    catch (e) { console.log("signal-intake radar_sources read: " + String((e && e.message) || e).slice(0, 160)); out.status = "error"; out.error = "radar_sources unreadable"; await ledger(db, today, iso, out); return out; }
    if (!srcs.length) { out.status = "error"; out.error = "no radar_sources rows with kind='signal'"; await ledger(db, today, iso, out); return out; }
    var candidates = [];
    for (var b = 0; b < srcs.length; b += 6) {
      var batch = srcs.slice(b, b + 6);
      var results = await Promise.all(batch.map(function(s) { return fetchSource(f, s); }));
      for (var i = 0; i < batch.length; i++) {
        var s = batch[i], r = results[i], fam = String(s.category || "other");
        if (r.error) { out.sources[s.name] = "error:" + r.error; continue; }
        out.fetched++;
        out.sources[s.name] = "ok:" + r.items.length;
        for (var k = 0; k < r.items.length; k++) {
          var it = r.items[k];
          out.items++;
          if (SKIP_TITLE.test(it.title) || it.title.length < 20 || tooOld(it.published, now)) continue;
          var sc = score(it);
          if (!sc.strong.length || sc.score < 3) continue;
          candidates.push({ family: fam, source: s.name, title: it.title, link: it.link, summary: it.summary, published: it.published, score: sc.score, strong: sc.strong.slice(0, 5) });
        }
      }
    }
    // Items already seen (by URL) are not candidates again; the ledger row they got on first sight stays.
    var fresh = [];
    for (var c = 0; c < candidates.length; c++) {
      var seen = await db.prepare("SELECT 1 AS x FROM signal_intake_seen WHERE url=?1").bind(candidates[c].link).first().catch(function() { return null; });
      if (seen) { out.dupes++; continue; }
      fresh.push(candidates[c]);
    }
    out.candidates = fresh.length;
    var picked = selectAcross(fresh, cfg.max);
    var pickedUrls = {};
    for (var p = 0; p < picked.length; p++) {
      var it2 = picked[p];
      pickedUrls[it2.link] = 1;
      var text = it2.title + ". " + (it2.summary ? it2.summary.slice(0, 600) + (it2.summary.length > 600 ? "..." : "") + " " : "") +
        "Source: " + it2.link + " (" + it2.family + ", " + it2.source + "). Why it fits: " + it2.strong.join(", ") + ".";
      var h = "intake:" + await sha16(it2.link);
      try {
        var dup = await db.prepare("SELECT id FROM idea_proposals WHERE ip_hash=?1 LIMIT 1").bind(h).first();
        var pid = dup ? dup.id : null;
        if (!dup) {
          var ins = await db.prepare("INSERT INTO idea_proposals (name, idea, contact, status, ip_hash, created_at) VALUES (?1, ?2, ?3, 'new', ?4, ?5)").bind("intake:" + it2.family, text.slice(0, 3000), it2.link.slice(0, 500), h, iso).run();
          pid = ins && ins.meta ? ins.meta.last_row_id : null;
          out.inserted++;
          out.families[it2.family] = (out.families[it2.family] || 0) + 1;
        } else out.dupes++;
        await db.prepare("INSERT OR IGNORE INTO signal_intake_seen (url, family, source, title, score, accepted, proposal_id, seen_at) VALUES (?1,?2,?3,?4,?5,1,?6,?7)").bind(it2.link, it2.family, it2.source, it2.title.slice(0, 240), it2.score, pid, iso).run();
        out.picked.push({ family: it2.family, score: it2.score, title: it2.title.slice(0, 100), url: it2.link });
      } catch (e) { console.log("signal-intake insert " + it2.link + ": " + String((e && e.message) || e).slice(0, 160)); out.sources[it2.source] += " insert-error"; }
    }
    // Every other fresh candidate is recorded as seen-but-not-taken, so the next run does not re-score it.
    for (var q = 0; q < fresh.length; q++) {
      if (pickedUrls[fresh[q].link]) continue;
      try { await db.prepare("INSERT OR IGNORE INTO signal_intake_seen (url, family, source, title, score, accepted, seen_at) VALUES (?1,?2,?3,?4,?5,0,?6)").bind(fresh[q].link, fresh[q].family, fresh[q].source, fresh[q].title.slice(0, 240), fresh[q].score, iso).run(); } catch (e) { console.error(JSON.stringify({ worker: "radar-hub", where: "intakeMod.run", error: String(e && e.message || e) })); }
    }
    var errs = Object.keys(out.sources).filter(function(k) { return out.sources[k].indexOf("error:") === 0; }).length;
    if (!out.fetched) out.status = "error"; else if (errs) out.status = "degraded";
    try {
      // FAMILIES-WINDOW-CLOCK-1 (1.4.2): the 7-day window is counted from the run's own clock, the clock every seen_at of the run is
      // written with; the database clock made the count depend on when it was read (signal-intake.test.mjs went red on 2026-10-14,
      // eight days after its fixture run)
      var fm = await db.prepare("SELECT COUNT(DISTINCT family) AS n FROM signal_intake_seen WHERE accepted=1 AND seen_at >= ?1").bind(new Date(now.getTime() - 7 * 864e5).toISOString()).first();
      out.families_7d = Number(fm && fm.n) || 0;
      await db.prepare("INSERT OR IGNORE INTO metric_registry (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, state, refresh_class) VALUES ('signal_source_families_7d', 'fleet', 'leading', 'COUNT(DISTINCT family) FROM signal_intake_seen WHERE accepted=1 AND seen_at >= now-7d: interdisciplinary source families (radar_sources kind signal) that produced an accepted idea_proposals row in the last 7 days (radar-hub SIGNAL-INTAKE-SOURCES-1, daily 08:30Z, no model call)', 'qnfo-audit.signal_intake_seen (radar-hub intake run ledger cloud_ops_events signal-intake-<day>)', '0 (2026-10-06: every signal came from arXiv quantum, artifact re-entry, q08 or reading)', '>= 5 distinct families a week (SIGNAL-INTAKE-1, owner directive 2026-10-04 and 2026-10-06)', 'radar-hub', 'trigger: fewer than 3 families -> METRIC-TRIGGER issue (migrations/2026-10-06-signal-intake-sources.sql)', 'daily', '< 5', '< 3', 'MEASURED', 'computed')").run();
      await db.prepare("UPDATE metric_registry SET last_value=?1, last_refreshed=?2, state='MEASURED' WHERE metric='signal_source_families_7d'").bind(String(out.families_7d), iso).run();
    } catch (e) { console.log("signal-intake metric write: " + String((e && e.message) || e).slice(0, 160)); out.metric_error = "metric write failed"; }
    await ledger(db, today, iso, out);
    return out;
  }
  async function ledger(db, today, iso, out) {
    try {
      var meta = Object.assign({}, out, { picked: (out.picked || []).slice(0, 12) });
      await db.prepare("INSERT OR REPLACE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?, ?, 'signal-intake', ?, ?, 'radar-hub', ?)").bind("signal-intake-" + today, iso, ("signal intake " + out.status + ": " + out.inserted + " proposals from " + Object.keys(out.families || {}).length + " families, " + out.fetched + " sources read" + (out.error ? " " + out.error : "")).slice(0, 500), JSON.stringify(meta).slice(0, 6000), out.status).run();
      out.recorded = true;
    } catch (e) { out.recorded = false; }
  }
  async function last(env) {
    var db = env.AUDIT || env.RADAR_DB || env.AUDIT_DB;
    var row = await db.prepare("SELECT ts, status, meta FROM cloud_ops_events WHERE id >= 'signal-intake-' AND id < 'signal-intake.' ORDER BY ts DESC LIMIT 1").first().catch(function() { return null; });
    var srcs = (await db.prepare("SELECT name, url, category, enabled FROM radar_sources WHERE kind='signal' ORDER BY category, name").all().catch(function() { return { results: [] }; })).results || [];
    var fam = await db.prepare("SELECT COUNT(DISTINCT family) AS n FROM signal_intake_seen WHERE accepted=1 AND seen_at >= datetime('now','-7 days')").first().catch(function() { return null; });
    var meta = null; try { meta = row && row.meta ? JSON.parse(row.meta) : null; } catch (e) { console.error(JSON.stringify({ worker: "radar-hub", where: "intakeMod.last", error: String(e && e.message || e) })); }
    return { last_run: row ? { ts: row.ts, status: row.status, meta: meta } : null, families_7d: Number(fam && fam.n) || 0, sources: srcs };
  }
  async function fetchHandler(request, env) {
    var p = new URL(request.url).pathname;
    var J = function(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json" } }); };
    if (p === "/run") {
      if (request.method !== "POST") return J({ error: "POST /intake/run" }, 405);
      return J(await run(env));
    }
    if (p === "/" || p === "") return J(await last(env));
    return J({ error: "not found" }, 404);
  }
  return { run: run, last: last, fetch: fetchHandler, parseFeed: parseFeed, score: score, selectAcross: selectAcross, STRONG: STRONG, WEAK: WEAK, VERSION: VERSION };
})();
// SIGNAL-INTAKE-SOURCES-1 end

const JobMarketWatchWorkflow = jmwMod.JobMarketWatchWorkflow;
export { JobMarketWatchWorkflow, intakeMod };

// ---- EVENTS-WORKFLOW-1:BEGIN (RM-RADAR-WORKFLOWS-PILOT-1, 2026-11-05, pillar research; roadmap_implementation row 43)
// Pilot of Cloudflare Workflows on the weekly events (conference) radar. The Monday 05:00Z table entry creates one instance of
// EventsRadarWorkflow, whose durable steps are scan (retried with backoff) and record, instead of running the scan inside the cron
// invocation. The earlier job-market attempt (JOB-MARKET-INLINE-1 above) failed because the Workflow resource did not exist, so
// nothing is trusted here until an instance has been read as complete: every start is a research_scan_log row (job
// events-radar-workflow), and the hourly watch re-runs the scan inline when the instance errored, was terminated, or has not
// completed 45 minutes after it started. With no binding, or a create that throws, the cron runs the inline scan exactly as before.
// Ledger ids are evwf-<ISO time>-<stage> so the watch reads them by primary-key range and never scans the table.
var EVENTS_FLOW_PREFIX = "evwf-";
var EVENTS_FLOW_STALE_MS = 45 * 60 * 1e3;
var EVENTS_FLOW_WATCH_MS = 6 * 3600 * 1e3;
function eventsFlowId(stage, at) {
  return EVENTS_FLOW_PREFIX + new Date(at || Date.now()).toISOString() + "-" + stage;
}
async function eventsFlowLog(env, stage, detail, at) {
  try {
    if (!env || !env.AUDIT) return false;
    var payload = JSON.stringify(Object.assign({ stage: stage }, detail || {})).slice(0, 1800);
    await env.AUDIT.prepare("INSERT OR IGNORE INTO research_scan_log (id, ts, job, payload) VALUES (?1, ?2, 'events-radar-workflow', ?3)").bind(eventsFlowId(stage, at), new Date(at || Date.now()).toISOString(), payload).run();
    return true;
  } catch (e) {
    console.error(JSON.stringify({ worker: "radar-hub", where: "eventsFlowLog", error: String(e && e.message || e).slice(0, 200) }));
    return false;
  }
}
// What a finished scan reports, kept small: a Workflow step output must stay well under its size limit.
function eventsFlowSummary(out) {
  out = out || {};
  return { slug: String(out.slug || ""), events: Number(out.events) || 0, venueErrors: Number(out.venueErrors) || 0, catalogVerified: String(out.catalogVerified || "") };
}
var EventsRadarWorkflow = class extends WorkflowEntrypoint {
  async run(event, step) {
    var instance = String(event && event.instanceId || "");
    var scan = await step.do("scan", { retries: { limit: 2, delay: "2 minutes", backoff: "exponential" }, timeout: "10 minutes" }, async () => eventsFlowSummary(await eventsMod.run(this.env)));
    await step.do("record", { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "1 minute" }, async () => {
      await eventsFlowLog(this.env, "done", { instance: instance, via: "workflow", summary: scan });
      return { recorded: true };
    });
    return scan;
  }
};
export { EventsRadarWorkflow };
// Named export for the tests (the same shape as intakeMod above: an object, not a handler); filled in below.
var eventsFlow = { start: null, watch: null };
export { eventsFlow };
async function eventsRadarStart(event, env, ctx) {
  if (env && env.EVENTS_RADAR_FLOW && typeof env.EVENTS_RADAR_FLOW.create === "function") {
    var at = Number(event && event.scheduledTime) || Date.now();
    try {
      var inst = await env.EVENTS_RADAR_FLOW.create({ id: "events-" + new Date(at).toISOString().slice(0, 10) + "-" + rhex(6), params: { cron: String(event && event.cron || ""), scheduledTime: at } });
      await eventsFlowLog(env, "started", { instance: String(inst && inst.id || ""), cron: String(event && event.cron || "") }, at);
      return;
    } catch (e) {
      await eventsFlowLog(env, "create-failed", { error: String(e && e.message || e).slice(0, 300) }, at);
    }
  }
  return eventsMod.default.scheduled(event, env, ctx);
}
// Hourly, and only in the Monday window in which a start can be waiting (the table entry fires at 05:00Z): read the latest start,
// ask the Workflow for the instance status, record done when it completed, or run the scan inline once when it did not.
async function eventsFlowWatch(env, ctx, nowMs) {
  var now = Number(nowMs) || Date.now();
  var d = new Date(now);
  if (!env || !env.AUDIT || !env.EVENTS_RADAR_FLOW || d.getUTCDay() !== 1 || d.getUTCHours() < 5 || d.getUTCHours() > 11) return { skipped: true };
  var since = EVENTS_FLOW_PREFIX + new Date(now - EVENTS_FLOW_WATCH_MS).toISOString();
  var rows = ((await env.AUDIT.prepare("SELECT id, ts, payload FROM research_scan_log WHERE id >= ?1 AND id < 'evwf.' ORDER BY id ASC LIMIT 40").bind(since).all()).results || []);
  var started = null, settled = {};
  rows.forEach(function (r) {
    var p = {}; try { p = JSON.parse(r.payload || "{}"); } catch (e) { p = {}; }
    if (p.stage === "started") started = { ts: r.ts, instance: p.instance };
    if (p.stage === "done" || p.stage === "fallback") settled[p.instance || "?"] = true;
  });
  if (!started || !started.instance || settled[started.instance]) return { skipped: true, reason: started ? "settled" : "no start" };
  var status = "unknown";
  try {
    var inst = await env.EVENTS_RADAR_FLOW.get(started.instance);
    var st = await inst.status();
    status = String(st && st.status || "unknown");
  } catch (e) {
    status = "unreadable";
  }
  if (status === "complete") {
    await eventsFlowLog(env, "done", { instance: started.instance, via: "watch", status: status }, now);
    return { done: true, instance: started.instance };
  }
  var age = now - Date.parse(started.ts);
  if (status === "errored" || status === "terminated" || age > EVENTS_FLOW_STALE_MS) {
    await eventsFlowLog(env, "fallback", { instance: started.instance, status: status, age_min: Math.round(age / 60000) }, now);
    if (ctx && ctx.waitUntil) ctx.waitUntil(eventsMod.run(env)); else await eventsMod.run(env);
    return { fallback: true, instance: started.instance, status: status };
  }
  return { waiting: true, instance: started.instance, status: status };
}
eventsFlow.start = eventsRadarStart;
eventsFlow.watch = eventsFlowWatch;
// ---- EVENTS-WORKFLOW-1:END

// ===== MERGED RADAR HUB v2 (2026-09-11: + job-market-watch + personal-events-radar) =====
// HUB-VERSION-SCOPE-1 (2026-09-23): the hub's own VERSION is declared at MODULE scope (top of
// this file). The sub-worker IIFEs each declare their own version constant in their own function
// scope, so a bare `VERSION` reference here previously resolved to nothing -> ReferenceError
// -> /health returned CF error 1101 (the old hardcoded "1.0.0" literal had masked it).
// Module scope also makes the deploy tooling's "first VERSION in file" extraction report the
// HUB version rather than events-radar's.
// ---- CRON-SINGLE-TRIGGER-1:BEGIN (pure; replayed by scripts/cron-single-trigger.test.mjs)
// CRON-SINGLE-TRIGGER-1 (2026-10-02, #1785, pillar: core). The account held 84 cron expressions against the fleet budget
// of 50. This worker now registers ONE hourly trigger; each tick runs every entry of CRON_TABLE (the former trigger list,
// unchanged) that fired in the hour ending at the tick, through the same dispatcher as before. An entry on the hour runs
// at its minute; one at :15 or :30 runs at the next full hour. Hourly keeps the 15-minute CPU limit of a cron trigger.
var TICK_CRON = "0 * * * *";
var CRON_TABLE = ["0 5 * * 2", "30 8 * * *", "0 6 1 * *", "0 9 * * 7", "0 11 1,15 * *", "0 7 * * 2", "30 5 * * 2", "0 6 * * *"];
var TICK_PARALLEL = true;
function cronFieldMatch(spec, v) {
  return String(spec).split(",").some(function (part) {
    var st = /^(.+)\/(\d+)$/.exec(part), step = st ? Number(st[2]) : 1, base = st ? st[1] : part;
    var r = /^(\d+)-(\d+)$/.exec(base), lo, hi;
    if (base === "*") { lo = 0; hi = 1e9; } else if (r) { lo = Number(r[1]); hi = Number(r[2]); } else { lo = Number(base); hi = st ? 1e9 : lo; }
    return v >= lo && v <= hi && (v - (base === "*" ? 0 : lo)) % step === 0;
  });
}
// Cloudflare cron fields in UTC; day of week 1 = Sunday .. 7 = Saturday.
function cronMatchesAt(expr, ms) {
  var f = String(expr).trim().split(/\s+/), d = new Date(ms);
  return f.length === 5 && cronFieldMatch(f[0], d.getUTCMinutes()) && cronFieldMatch(f[1], d.getUTCHours()) && cronFieldMatch(f[2], d.getUTCDate()) && cronFieldMatch(f[3], d.getUTCMonth() + 1) && cronFieldMatch(f[4], d.getUTCDay() + 1);
}
// The table entries that fired in the 60 minutes ending at the tick (tick minute included), in table order.
function cronDueAtTick(table, tickMs) {
  var t = Math.floor(tickMs / 60000) * 60000;
  return table.filter(function (expr) {
    for (var k = 0; k < 60; k++) if (cronMatchesAt(expr, t - k * 60000)) return true;
    return false;
  });
}
// ---- CRON-SINGLE-TRIGGER-1:END
// `one` is the dispatcher this worker always had (one cron expression in, its job run). A trigger other than the tick
// (a former per-job trigger still registered) goes straight to it, and so does an event marked tickEntry: that is how
// the tick hands each table entry on, and how a test runs one entry whose expression equals the tick's.
async function cronTickDispatch(event, one) {
  if (!event || event.cron !== TICK_CRON || event.tickEntry) return one(event);
  var at = Number(event.scheduledTime) || Date.now();
  var due = cronDueAtTick(CRON_TABLE, at);
  var run = function (expr) {
    return Promise.resolve().then(function () { return one({ cron: expr, scheduledTime: at, type: "scheduled", tickEntry: true }); }).catch(function (e) { console.error("cron " + expr + ": " + String(e && e.message || e)); });
  };
  if (TICK_PARALLEL) { await Promise.all(due.map(run)); return; }
  for (var i = 0; i < due.length; i++) await run(due[i]);
}
// CRON-ONLY-HEARTBEAT-1 (agent_issues 2397, charter pillar: autonomy): one fleet_heartbeat upsert when a scheduled run has finished,
// so the fleet can tell when this worker's cron stops. ok is 1 when the run did not throw. A failed write is logged and never thrown.
async function cronHeartbeat(env, ok) {
  var ts = new Date().toISOString();
  // The upsert is idempotent even if D1 committed before losing the response; keep its bindings stable across retries.
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      await env.AUDIT.prepare("INSERT INTO fleet_heartbeat (worker, version, ts, ok) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(worker) DO UPDATE SET version=excluded.version, ts=excluded.ts, ok=excluded.ok").bind("radar-hub", VERSION, ts, ok).run();
      return;
    } catch (e) {
      var message = String(e && e.message || e);
      if (attempt === 2 || !/D1_ERROR: (?:D1 DB (?:storage operation exceeded timeout|is overloaded|reset because)|Internal error (?:while starting up |in )?D1 DB storage|Network connection lost|Replica disconnected from primary)/i.test(message)) {
        console.error("fleet_heartbeat radar-hub: " + message);
        return;
      }
      await new Promise(function (resolve) { setTimeout(resolve, 100 * Math.pow(2, attempt)); });
    }
  }
}
// The hub's cron router (the handler this worker always had). The exported scheduled() below runs it, then writes the heartbeat.
// cronTickDispatch logs and swallows a table entry's error by design (one failing job does not stop the rest), so ok is 0 only when the handler
// throws or a waitUntil promise rejects; the swallowed entries stay visible in the logs.
var hubRun = {
  async scheduled(event, env, ctx) {
    return cronTickDispatch(event, async function (event) {
    const c = event.cron;
    // EVENTS-RADAR-CF-DOW-1 (1.1.3): the events radar scans its 34 weekly sources only when strftime('%w') is 1 (Monday),
    // but "0 5 * * 1" is Sunday in Cloudflare's numbering (1=Sunday..7=Saturday): every run (events_radar 2026-09-06, 13,
    // 20, all Sundays) skipped them. "0 5 * * 2" is Monday 05:00Z. The old spelling stays routed for a stale registration.
    if (c === "0 5 * * 2" || c === "0 5 * * 1") return eventsRadarStart(event, env, ctx);
    // MENTION-RADAR-1: the daily 08:30Z slot also runs the external-mention discovery; each job is isolated.
    if (c === "30 8 * * *") {
      // SIGNAL-INTAKE-SOURCES-1: the interdisciplinary feed intake shares this daily slot (no new cron); isolated like the others.
      await Promise.allSettled([
        arxivMod.scheduled(event, env, ctx),
        mentionMod.run(env).then((o) => console.log("mention-radar", JSON.stringify(o)), (e) => console.error("mention-radar", String((e && e.message) || e))),
        intakeMod.run(env).then((o) => console.log("signal-intake", JSON.stringify(o).slice(0, 1500)), (e) => console.error("signal-intake", String((e && e.message) || e)))
      ]);
      return;
    }
    if (c === "0 6 1 * *" || c === "0 9 * * 7") return researchMod.scheduled(event, env, ctx);
    if (c === "0 11 1,15 * *") return citationMod.scheduled(event, env, ctx);
    if (c === "0 7 * * 2") return jmwMod.default.scheduled(event, env, ctx);
    if (c === "30 5 * * 2") return perMod.default.scheduled(event, env, ctx);
    if (c === "0 6 * * *") return perMod.default.scheduled(event, env, ctx);
    });
  },
};
export default {
  async fetch(request, env, ctx) {
    const p = new URL(request.url).pathname;
    if (p === "/health") return new Response(JSON.stringify({ ok: true, worker: "radar-hub", version: VERSION, radars: 8, events_workflow: !!env.EVENTS_RADAR_FLOW, capabilities: ["mention-radar", "events-radar", "arxiv-radar", "research-radar", "citation-radar", "jobs-radar", "personal-radar", "signal-intake"], limitations: ["each radar runs on its own cron; only the arXiv radar can be forced (POST /arxiv/run, one run per 10 minutes)", "arXiv classification is keyword-based, with no model call", "the arXiv radar reads the 20 newest matching submissions per run", "the signal intake reads radar_sources rows of kind 'signal' once a day (08:30Z), scores items by lexicon with no model call, and writes at most ops_config signal_intake_max_per_run (default 8) idea_proposals rows a run; POST /intake/run needs the radar token"] }), { headers: { "content-type": "application/json" } });
    // HUB-AUTH-1 (2026-10-01): every member route can run a scan, write the personal calendar or
    // return the personal report, so all of them need Bearer RADAR_TOKEN. Fails closed when unset.
    // Crons do not pass through fetch and are unaffected.
    {
      const exp = env.RADAR_TOKEN;
      if (!exp) return new Response(JSON.stringify({ error: "RADAR_TOKEN not configured" }), { status: 503, headers: { "content-type": "application/json" } });
      const got = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
      let d = got.length === exp.length ? 0 : 1;
      for (let i = 0; i < exp.length; i++) d |= (got.charCodeAt(i) || 0) ^ exp.charCodeAt(i);
      if (d !== 0) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
    }
    function sub(prefix) { const u = new URL(request.url); u.pathname = p.slice(prefix.length) || "/"; return new Request(u.toString(), request); }
    if (p === "/events" || p.startsWith("/events/")) return eventsMod.default.fetch(sub("/events"), env, ctx);
    if (p === "/citation" || p.startsWith("/citation/")) return citationMod.fetch(sub("/citation"), env, ctx);
    if (p === "/jobs" || p.startsWith("/jobs/")) return jmwMod.default.fetch(sub("/jobs"), env, ctx);
    if (p === "/personal" || p.startsWith("/personal/")) return perMod.default.fetch(sub("/personal"), env, ctx);
    if (p === "/mentions" || p.startsWith("/mentions/")) return mentionMod.fetch(sub("/mentions"), env, ctx);
    if (p === "/intake" || p.startsWith("/intake/")) return intakeMod.fetch(sub("/intake"), env, ctx);
    if (p === "/arxiv/health") return arxivMod.fetch(sub("/arxiv"), env, ctx);
    if (p === "/arxiv/last") {
      const row = env.AUDIT ? await env.AUDIT.prepare("SELECT ts, payload FROM research_scan_log WHERE job='arxiv-radar' ORDER BY ts DESC LIMIT 1").first().catch(function() { return null; }) : null;
      return new Response(JSON.stringify(row ? { ts: row.ts, run: JSON.parse(row.payload || "{}") } : { ts: null }), { headers: { "content-type": "application/json" } });
    }
    if (p === "/arxiv/run" && request.method === "POST") {
      // One forced run per 10 minutes: the route is public, and each run calls arXiv and writes D1.
      const last = env.AUDIT ? await env.AUDIT.prepare("SELECT ts FROM research_scan_log WHERE job='arxiv-radar' ORDER BY ts DESC LIMIT 1").first().catch(function() { return null; }) : null;
      if (last && Date.now() - Date.parse(last.ts) < 6e5) return new Response(JSON.stringify({ ok: false, error: "last run " + last.ts + "; one run per 10 minutes" }), { status: 429, headers: { "content-type": "application/json" } });
      return arxivMod.fetch(sub("/arxiv"), env, ctx);
    }
    return new Response("radar-hub", { status: 200 });
  },
  async scheduled(event, env, ctx) {
    const state = { ok: 1 }, pending = [];
    // the events and personal radars hand their work to ctx.waitUntil: collect those promises (still passed on) so the heartbeat follows them
    const hubCtx = { waitUntil(pr) { pending.push(Promise.resolve(pr)); if (ctx && ctx.waitUntil) ctx.waitUntil(pr); } };
    try {
      await hubRun.scheduled(event, env, hubCtx);
      try { await eventsFlowWatch(env, hubCtx); } catch (we) { console.error(JSON.stringify({ worker: "radar-hub", where: "eventsFlowWatch", error: String(we && we.message || we).slice(0, 200) })); }
      const settled = await Promise.allSettled(pending);
      if (settled.some(function (r) { return r.status === "rejected"; })) state.ok = 0;
    } catch (err) {
      state.ok = 0;
      throw err;
    } finally {
      await cronHeartbeat(env, state.ok);
    }
  },
};
