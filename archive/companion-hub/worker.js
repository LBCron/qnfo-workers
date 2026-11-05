var personalcompanionMod = (function(){
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var VERSION = "v1.0.1-doi-scrub";
var MODELS = [
  "@cf/moonshotai/kimi-k2.6",
  "@cf/openai/gpt-oss-120b",
  "@cf/zai-org/glm-5.3"
];
var EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
var GEN_MAX_TOKENS = 9e3;
var GEN_TIMEOUT_MS = 9e4;
var CRITIQUE_TIMEOUT_MS = 3e4;
var EMBED_TIMEOUT_MS = 3e4;
var SIM_THRESHOLD = 0.9;
var ACCEPT_FLOOR = 5;
var BANNED_MODELS = ["llama", "mistral", "gemma-7b", "gemma-4-26b", "qwen3-30b", "qwen2.5", "r1-distill", "qwq-", "-8b", "-11b", "-7b", "-flash", "-fp8-fast", "-lora", "-mini", "-small"];
function modelAllowed(m) {
  var low = String(m || "").toLowerCase();
  for (var bi = 0; bi < BANNED_MODELS.length; bi++) {
    if (low.indexOf(BANNED_MODELS[bi]) >= 0) return false;
  }
  return true;
}
__name(modelAllowed, "modelAllowed");
var NL = String.fromCharCode(10);
function L() {
  return Array.prototype.slice.call(arguments).join(NL);
}
__name(L, "L");
var RHYTHM = ["notes", "essay", "notes", "essay", "notes", "essay", "serial"];
var TOPICS = [
  { id: "ultrametric-music", cat: "math.NT", wiki: "Ultrametric space", a: "p-adic geometry", b: "musical tuning" },
  { id: "form-distinction", cat: "cs.LO", wiki: "Laws of Form", a: "the calculus of indications", b: "programming language semantics" },
  { id: "landauer-biology", cat: "cond-mat.stat-mech", wiki: "Landauer's principle", a: "the thermodynamics of erasure", b: "cellular proofreading" },
  { id: "decoherence-epistemics", cat: "quant-ph", wiki: "Quantum decoherence", a: "decoherence", b: "the epistemology of testimony" },
  { id: "play-mathematics", cat: "q-bio.NC", wiki: "Play (activity)", a: "animal play", b: "mathematical conjecture" },
  { id: "counterpoint-categories", cat: "math.CT", wiki: "Counterpoint", a: "species counterpoint", b: "adjunction" },
  { id: "fungal-networks", cat: "q-bio.PE", wiki: "Mycorrhizal network", a: "mycorrhizal exchange", b: "gossip protocols" },
  { id: "bremermann-economics", cat: "quant-ph", wiki: "Bremermann's limit", a: "the Bremermann bound", b: "discounting" },
  { id: "ignorance-instruments", cat: "physics.hist-ph", wiki: "Ignorance", a: "manufactured ignorance", b: "instrument design" },
  { id: "symmetry-craft", cat: "cond-mat.mtrl-sci", wiki: "Crystallographic point group", a: "crystallographic point groups", b: "ornament" },
  { id: "search-taste", cat: "cs.LG", wiki: "Multi-armed bandit", a: "exploration in learning", b: "scientific taste" },
  { id: "notation-thought", cat: "math.LO", wiki: "Notation", a: "notation", b: "what can be thought" },
  { id: "entropy-meaning", cat: "cs.IT", wiki: "Entropy (information theory)", a: "Shannon entropy", b: "the meaning of a phrase" },
  { id: "kuramoto-ensemble", cat: "nlin.PS", wiki: "Kuramoto model", a: "coupled oscillators", b: "ensemble discipline" }
];
var BANNED = [
  "delve",
  "tapestry",
  "landscape of",
  "realm of",
  "unlock the",
  "game-changer",
  "ever-evolving",
  "testament to",
  "nestled",
  "dive into",
  "let us explore",
  "let us now",
  "in today's world",
  "it is worth noting",
  "it's worth noting",
  "in conclusion",
  "plays a crucial role",
  "plays a vital role",
  "shed light on",
  "pave the way",
  "stands as a",
  "serves as a",
  "rich history",
  "in an era of",
  "navigate the complexities",
  "in the realm of",
  "rich tapestry",
  "as an ai",
  "i hope this",
  "in this essay",
  "this essay will",
  "we will explore",
  "qnfo",
  "qwav",
  "zen" + "odo",   // NOZ-DOI-1: a retired registry name; kept as a banned output word, written split so the source carries no mention
  "living-paper"
];
var P_STYLE = L(
  "You are writing for one reader: Rowan.",
  "Never reproduce any heading, label, bullet, or phrasing from the briefing, or from these instructions, inside the piece. The briefing is addressed to you, not to the reader.",
  "Not for an audience, not for a journal, not for a metric.",
  "He works on the seams between mathematics, music, information physics, computation, consciousness and epistemology. Fragmentation offends him; he can feel a missing connection as a kind of wrongness.",
  "He reads for the pleasure of a true thing well put. He is not impressed by fluency, by volume, or by enthusiasm.",
  "",
  "Voice: plain scholarly prose. Concrete before abstract. Short declaratives, occasionally a long sentence that earns its length.",
  "Open on a particular. Never on a generality. Present tense where possible. Active voice. Name the actor.",
  "",
  "Forbidden, without exception:",
  "- emojis or decorative symbols; exclamation marks for emphasis",
  "- the words: delve, tapestry, landscape of, realm, unlock, game-changer, ever-evolving, testament to, nestled",
  "- the phrases: dive into, let us explore, in today's world, it is worth noting, in conclusion, plays a crucial role, plays a vital role, shed light on, pave the way, stands as a, serves as a",
  "- rhetorical questions as an opener",
  "- triads of adjectives used as padding",
  "- meta-commentary about writing, essays, readers, publishing, or disclosure",
  "- any reference to QNFO, QWAV, DOIs, pipelines, or to this companion",
  "- self-reference as a model or assistant; no greeting, no sign-off, no signature, no footer",
  "",
  "Epistemic contract:",
  "- Every factual claim must trace to the supplied ANCHORS. If an anchor does not support a claim, do not make the claim.",
  "- Where you reason past the anchors, mark the step as your inference.",
  "- State uncertainty at its true size. Never inflate confidence to make a piece land better.",
  "- One section must state the strongest objection to the piece's own central claim, in the objector's own terms, and say how bad it is."
);
var P_ESSAY = L(
  "FORM: cross-domain essay, 900 to 1500 words.",
  "Take one seam between two fields and walk it. Do not survey. Argue.",
  "Cover, in this order, without labelling the parts in the text:",
  "1. a concrete particular that opens the seam",
  "2. the technical content of side A, accurately enough that a practitioner would not wince",
  "3. the technical content of side B, to the same standard",
  "4. the bridge as an explicit claim, marked either as a structural correspondence or as an analogy you are proposing",
  "5. under a heading, the strongest objection to the bridge",
  "6. what would have to be true for the bridge to be more than a rhyme"
);
var P_NOTES = L(
  "FORM: curated field notes, between 3 and 5 items.",
  "Each item is one concrete thing: a paper, a concept, a place, a piece of music, a passage, an exhibition.",
  "Each item is 90 to 200 words. Say precisely what the thing is, then what it connects to in his world. The connection is the point; the summary only makes the connection legible.",
  "If only three of the supplied anchors are worth his time, give three. Never pad to a count. Never include an item you would not defend.",
  "Give every item a short title."
);
var P_SERIAL = L(
  "FORM: serialized long-form, 1200 to 1800 words, continuing one ongoing work.",
  "You are given the RUNNING WORK: its thesis and the closing lines of the previous installment.",
  "Advance the argument. Do not recap beyond one sentence of orientation.",
  "This installment must add at least one claim that was not available before it, and it must close mid-motion on a question the next installment has to answer.",
  "Keep the running work's title. Put the installment number in the subtitle."
);
var P_OUT = L(
  "Return JSON only, with no prose around it:",
  '{"title":"...","subtitle":"","lede":"one sentence, at most 30 words","body_md":"the piece as markdown","bridge":{"a":"field or idea","b":"field or idea","kind":"structural" or "proposed analogy"},"objection":"the strongest objection, one or two sentences"}'
);
var P_CRITIQUE = L(
  "You are an adversarial reader. You dislike fluency. You are looking for reasons this piece is worthless.",
  "Score each dimension 0 to 10. Be harsh: a 7 means genuinely good.",
  "specificity: does it hang on concrete checkable particulars, or could it have been written about anything?",
  "argument: is there a claim that could be wrong, or only gestures?",
  "bridge: is the cross-domain connection stated precisely, or is it a rhyme dressed as a theorem?",
  "objection: is the stated objection the strongest available one, or a straw man?",
  "voice: plain scholarly prose free of filler, tells, and self-reference?",
  'Return JSON only: {"specificity":n,"argument":n,"bridge":n,"objection":n,"voice":n,"verdict":"accept" or "reject","why":"one sentence"}'
);
function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}
__name(json, "json");
function html(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}
__name(html, "html");
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(safeEqual, "safeEqual");
function authorized(request, env) {
  var key = env.COMPANION_KEY || "";
  if (!key) return true;
  var u = new URL(request.url);
  var q = u.searchParams.get("k") || "";
  var c = request.headers.get("Cookie") || "";
  var m = c.indexOf("pc_key=");
  var ck = m >= 0 ? c.slice(m + 7).split(";")[0] : "";
  return safeEqual(q, key) || safeEqual(ck, key);
}
__name(authorized, "authorized");
async function sha16(s) {
  var data = new TextEncoder().encode(String(s));
  var digest = await crypto.subtle.digest("SHA-256", data);
  var bytes = new Uint8Array(digest).slice(0, 8);
  var out = "";
  for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}
__name(sha16, "sha16");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
function amsParts(d) {
  var fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false
  });
  var parts = {};
  var arr = fmt.formatToParts(d);
  for (var i = 0; i < arr.length; i++) parts[arr[i].type] = arr[i].value;
  return parts;
}
__name(amsParts, "amsParts");
function amsDayKey(d) {
  var p = amsParts(d);
  return p.year + "-" + p.month + "-" + p.day;
}
__name(amsDayKey, "amsDayKey");
function amsWeekday(d) {
  var names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var p = amsParts(d);
  var idx = names.indexOf(p.weekday);
  return idx < 0 ? d.getUTCDay() : idx;
}
__name(amsWeekday, "amsWeekday");
function squish(s) {
  var out = "";
  var prev = false;
  var s10 = String.fromCharCode(10);
  var s13 = String.fromCharCode(13);
  var s9 = String.fromCharCode(9);
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    var isSp = c === " " || c === s10 || c === s13 || c === s9;
    if (isSp) {
      if (!prev) out += " ";
      prev = true;
    } else {
      out += c;
      prev = false;
    }
  }
  return out.trim();
}
__name(squish, "squish");
function stripTags(s) {
  var out = "";
  var depth = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === "<") depth++;
    else if (c === ">") {
      if (depth > 0) depth--;
    } else if (depth === 0) out += c;
  }
  return squish(out);
}
__name(stripTags, "stripTags");
function sections(xml, tag) {
  var open = "<" + tag + ">";
  var close = "</" + tag + ">";
  var out = [];
  var i = 0;
  while (true) {
    var a = xml.indexOf(open, i);
    if (a < 0) break;
    var b = xml.indexOf(close, a);
    if (b < 0) break;
    out.push(xml.slice(a + open.length, b));
    i = b + close.length;
  }
  return out;
}
__name(sections, "sections");
function firstTag(chunk, tag) {
  var open = "<" + tag + ">";
  var close = "</" + tag + ">";
  var a = chunk.indexOf(open);
  if (a < 0) return "";
  var b = chunk.indexOf(close, a);
  if (b < 0) return "";
  return stripTags(chunk.slice(a + open.length, b));
}
__name(firstTag, "firstTag");
function parseJsonLoose(text) {
  if (!text) return null;
  var a = text.indexOf("{");
  var b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch (e) {
    return null;
  }
}
__name(parseJsonLoose, "parseJsonLoose");
function hasEmoji(s) {
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 55296 && c <= 56319) {
      var lo = s.charCodeAt(i + 1);
      if (lo >= 56320 && lo <= 57343) {
        var cp = (c - 55296) * 1024 + (lo - 56320) + 65536;
        if (cp >= 126976 && cp <= 129791) return true;
        i++;
      }
    } else if (c >= 9728 && c <= 10175) {
      return true;
    } else if (c >= 8592 && c <= 8703) {
      return true;
    } else if (c === 65039) {
      return true;
    }
  }
  return false;
}
__name(hasEmoji, "hasEmoji");
function bannedHits(text) {
  var low = text.toLowerCase();
  var hits = [];
  for (var i = 0; i < BANNED.length; i++) {
    if (low.indexOf(BANNED[i]) >= 0) hits.push(BANNED[i]);
  }
  return hits;
}
__name(bannedHits, "bannedHits");
function isCap(s, i) {
  var c = s.charAt(i);
  return c >= "A" && c <= "Z";
}
__name(isCap, "isCap");
function isLow(s, i) {
  var c = s.charAt(i);
  return c >= "a" && c <= "z";
}
__name(isLow, "isLow");
function readWord(s, i) {
  var out = "";
  while (i < s.length) {
    var c = s.charAt(i);
    if (isLow(s, i) || isCap(s, i) || c === "-" || c >= "0" && c <= "9") {
      out += c;
      i++;
    } else break;
  }
  return { w: out, i };
}
__name(readWord, "readWord");
var STOPW = ["The", "A", "An", "In", "On", "At", "By", "To", "Of", "If", "When", "Where", "What", "How", "Why", "Then", "There", "These", "Those", "We", "They", "He", "She", "His", "Her", "Its", "Our", "Their", "Not", "No", "Yet", "So", "As", "From", "With", "Without", "Between", "After", "Before", "During", "Both", "Each", "Every", "All", "Some", "Many", "Most", "Such", "That", "Than", "Because", "Although", "While", "Since", "Thus", "Hence", "Therefore", "However", "Moreover", "Furthermore", "One", "Two", "Three", "But", "And", "For", "Or", "It", "This", "Is", "Are", "Was", "Were", "Be", "Been", "Do", "Does", "Did", "Has", "Have", "Had", "Can", "Could", "Shall", "Should", "Will", "Would", "May", "Might", "Must"];
var STOP = {};
for (sw = 0; sw < STOPW.length; sw++) STOP[STOPW[sw]] = true;
var sw;
function nameCandidates(text) {
  var s = String(text || "");
  var out = [];
  for (var i = 0; i < s.length; i++) {
    if (!isCap(s, i)) continue;
    var a = readWord(s, i);
    if (a.w.length < 3 || STOP[a.w] === true) continue;
    var j = i + a.w.length;
    var sp = 0;
    while (j < s.length && s.charAt(j) === " ") {
      sp++;
      j++;
    }
    if (sp !== 1 || !isCap(s, j)) continue;
    var b = readWord(s, j);
    if (b.w.length < 3 || STOP[b.w] === true) continue;
    out.push(a.w + " " + b.w);
    i = i + a.w.length - 1;
  }
  return out;
}
__name(nameCandidates, "nameCandidates");
function anchorsText(anchors) {
  var parts = [];
  for (var i = 0; i < anchors.length; i++) parts.push(String(anchors[i].title || "") + " " + String(anchors[i].text || ""));
  return parts.join(" ");
}
__name(anchorsText, "anchorsText");
function unverifiedNames(piece, anchors, topic) {
  var at = anchorsText(anchors) + " " + String(topic && topic.a || "") + " " + String(topic && topic.b || "");
  var cand = nameCandidates(String(piece.body_md || ""));
  var low = at.toLowerCase();
  var bad = [];
  for (var i = 0; i < cand.length; i++) {
    if (low.indexOf(cand[i].toLowerCase()) < 0 && bad.indexOf(cand[i]) < 0) bad.push(cand[i]);
  }
  return bad;
}
__name(unverifiedNames, "unverifiedNames");
function wordCount(s) {
  var n = 0;
  var inWord = false;
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    var ws = c === " " || c === NL || c === String.fromCharCode(13) || c === String.fromCharCode(9);
    if (ws) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      n++;
    }
  }
  return n;
}
__name(wordCount, "wordCount");
async function embed(env, texts) {
  var resp = await env.AI.run(EMBED_MODEL, { text: texts }, { signal: AbortSignal.timeout(EMBED_TIMEOUT_MS) });
  var vecs = resp && resp.data || [];
  var out = [];
  for (var i = 0; i < vecs.length; i++) {
    if (Array.isArray(vecs[i]) && vecs[i].length === 768) {
      var v = [];
      for (var j = 0; j < vecs[i].length; j++) v.push(Number.isFinite(vecs[i][j]) ? vecs[i][j] : 0);
      out.push(v);
    }
  }
  return out;
}
__name(embed, "embed");
async function ensureSchema(env) {
  var stmts = [
    "CREATE TABLE IF NOT EXISTS companion_pieces (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, form TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, lede TEXT, body_md TEXT NOT NULL, anchor_json TEXT, quality_json TEXT, word_count INTEGER, day TEXT, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS companion_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT NOT NULL, form TEXT, model TEXT, topic TEXT, status TEXT, detail TEXT, ms INTEGER)",
    "CREATE TABLE IF NOT EXISTS companion_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, signal TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS companion_series (id INTEGER PRIMARY KEY AUTOINCREMENT, series TEXT UNIQUE NOT NULL, title TEXT, thesis TEXT, chapters INTEGER DEFAULT 0, last_lines TEXT, updated_at TEXT)",
    "CREATE TABLE IF NOT EXISTS companion_seeds (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, source TEXT, form TEXT, used_at TEXT)"
  ];
  for (var i = 0; i < stmts.length; i++) {
    await env.PERSONAL.prepare(stmts[i]).run();
  }
}
__name(ensureSchema, "ensureSchema");
async function loadProfile(env) {
  var r = await env.PERSONAL.prepare(
    "SELECT facet, label, statement FROM profile WHERE confidence >= 0.7 ORDER BY facet, label"
  ).all();
  var rows = r.results || [];
  var lines = [];
  var lastFacet = "";
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].facet !== lastFacet) {
      lastFacet = rows[i].facet;
      lines.push("");
      lines.push("[" + lastFacet + "]");
    }
    lines.push("- " + rows[i].label + ": " + squish(rows[i].statement || ""));
  }
  return lines.join(NL).slice(0, 7e3);
}
__name(loadProfile, "loadProfile");
async function loadLife(env) {
  var lines = [];
  var acts = await env.PERSONAL.prepare(
    "SELECT date, title, category, venue, city, notes, energy_label FROM activity ORDER BY date DESC LIMIT 12"
  ).all();
  lines.push("RECENTLY ATTENDED");
  var ar = acts.results || [];
  for (var i = 0; i < ar.length; i++) {
    var a = ar[i];
    lines.push("- " + a.date + " " + squish(a.title || "") + " [" + (a.category || "") + (a.venue ? ", " + squish(a.venue) : "") + "] " + (a.energy_label ? "energy=" + a.energy_label : "") + " " + squish((a.notes || "").slice(0, 160)));
  }
  var evs = await env.PERSONAL.prepare(
    "SELECT start_date, title, venue, city, category FROM events WHERE start_date >= '2026-01-01' ORDER BY start_date DESC LIMIT 10"
  ).all();
  lines.push("");
  lines.push("BOOKED / PLANNED");
  var er = evs.results || [];
  for (var j = 0; j < er.length; j++) {
    var e = er[j];
    lines.push("- " + e.start_date + " " + squish(e.title || "") + " [" + (e.category || "") + (e.venue ? ", " + squish(e.venue) : "") + "]");
  }
  var notes = await env.PERSONAL.prepare(
    "SELECT ts, kind, content FROM notes WHERE kind NOT IN ('email') AND length(content) > 80 ORDER BY ts DESC LIMIT 10"
  ).all();
  lines.push("");
  lines.push("HIS OWN NOTES");
  var nr = notes.results || [];
  for (var k = 0; k < nr.length; k++) {
    lines.push("- " + nr[k].ts + " [" + nr[k].kind + "] " + squish((nr[k].content || "").slice(0, 200)));
  }
  return lines.join(NL).slice(0, 6e3);
}
__name(loadLife, "loadLife");
async function loadContinuity(env, form) {
  var lines = [];
  var pcs = await env.PERSONAL.prepare(
    "SELECT form, title, lede, day FROM companion_pieces ORDER BY id DESC LIMIT 8"
  ).all();
  lines.push("WHAT YOU ALREADY WROTE (do not repeat these angles)");
  var pr = pcs.results || [];
  for (var i = 0; i < pr.length; i++) {
    lines.push("- " + pr[i].day + " [" + pr[i].form + "] " + squish(pr[i].title || "") + " :: " + squish(pr[i].lede || ""));
  }
  var fb = await env.PERSONAL.prepare(
    "SELECT f.slug, f.signal, f.note, p.title FROM companion_feedback f LEFT JOIN companion_pieces p ON p.slug = f.slug ORDER BY f.id DESC LIMIT 12"
  ).all();
  var fr = fb.results || [];
  if (fr.length) {
    lines.push("");
    lines.push("HOW HE REACTED (this is the strongest signal you have)");
    for (var j = 0; j < fr.length; j++) {
      lines.push("- [" + fr[j].signal + "] " + squish(fr[j].title || fr[j].slug) + (fr[j].note ? " :: " + squish(fr[j].note) : ""));
    }
  }
  if (form === "serial") {
    var sr = await env.PERSONAL.prepare("SELECT series, title, thesis, chapters, last_lines FROM companion_series ORDER BY id DESC LIMIT 1").all();
    var s = (sr.results || [])[0];
    lines.push("");
    if (s) {
      lines.push("RUNNING WORK");
      lines.push("series: " + squish(s.series));
      lines.push("title: " + squish(s.title));
      lines.push("thesis: " + squish(s.thesis || ""));
      lines.push("chapters written: " + s.chapters);
      lines.push("closing lines of previous installment: " + squish(s.last_lines || "(none yet)"));
    } else {
      lines.push("RUNNING WORK: none yet. You are starting a new long-form work. Choose a title and a thesis, and begin it.");
    }
  }
  return lines.join(NL).slice(0, 6e3);
}
__name(loadContinuity, "loadContinuity");
async function pickTopic(env, form) {
  var used = [];
  try {
    var r = await env.PERSONAL.prepare("SELECT key FROM companion_seeds ORDER BY used_at DESC LIMIT 24").all();
    var rr = r.results || [];
    for (var i = 0; i < rr.length; i++) used.push(rr[i].key);
  } catch (e) {
    used = [];
  }
  var fresh = [];
  for (var j = 0; j < TOPICS.length; j++) if (used.indexOf(TOPICS[j].id) < 0) fresh.push(TOPICS[j]);
  var pool = fresh.length ? fresh : TOPICS;
  var day = amsDayKey(/* @__PURE__ */ new Date());
  var n = Number(day.slice(8, 10)) || 0;
  var off = form === "serial" ? 5 : form === "notes" ? 9 : 0;
  var pick = pool[(n + off) % pool.length];
  try {
    await env.PERSONAL.prepare("INSERT OR IGNORE INTO companion_seeds(key, source, form, used_at) VALUES(?,?,?,?)").bind(pick.id, "rotation", form, nowIso()).run();
  } catch (e) {
  }
  return pick;
}
__name(pickTopic, "pickTopic");
async function fetchArxiv(cat) {
  var url = "https://export.arxiv.org/api/query?search_query=cat:" + encodeURIComponent(cat) + "&sortBy=submittedDate&sortOrder=descending&max_results=5";
  var resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (personal-companion)" }, signal: AbortSignal.timeout(12e3) });
  if (!resp.ok) return [];
  var xml = await resp.text();
  var chunks = sections(xml, "entry");
  var out = [];
  for (var i = 0; i < chunks.length; i++) {
    var title = firstTag(chunks[i], "title");
    var summary = firstTag(chunks[i], "summary");
    var id = firstTag(chunks[i], "id");
    if (title) out.push({ kind: "paper", ref: id, title, text: squish(summary).slice(0, 900) });
    if (out.length >= 3) break;
  }
  return out;
}
__name(fetchArxiv, "fetchArxiv");
async function fetchWiki(title) {
  var url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title);
  var resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (personal-companion)" }, signal: AbortSignal.timeout(12e3) });
  if (!resp.ok) return null;
  var j = await resp.json();
  var text = squish(j.extract || "");
  if (!text) return null;
  return { kind: "concept", ref: j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page ? j.content_urls.desktop.page : url, title: squish(j.title || title), text: text.slice(0, 1100) };
}
__name(fetchWiki, "fetchWiki");
async function callModel(env, messages, maxTokens, timeoutMs) {
  var lastErr = "";
  var tryN = MODELS.length < 2 ? MODELS.length : 2;
  for (var i = 0; i < tryN; i++) {
    try {
      var resp = await env.AI.run(MODELS[i], {
        messages,
        max_tokens: maxTokens,
        temperature: 0.7
      }, { gateway: { id: "default" }, signal: AbortSignal.timeout(timeoutMs) });
      var text = "";
      if (resp && typeof resp.response === "string" && resp.response.length > 0) text = resp.response;
      if (!text && resp && resp.choices && resp.choices[0] && resp.choices[0].message) {
        var msg = resp.choices[0].message;
        if (typeof msg.content === "string" && msg.content.length > 0) text = msg.content;
      }
      if (typeof text === "string" && text.trim().length > 80) return { model: MODELS[i], text };
      lastErr = "empty or truncated output from " + MODELS[i] + " len=" + String(text || "").length;
    } catch (e) {
      lastErr = MODELS[i] + ": " + String(e && e.message || e);
    }
  }
  throw new Error("all models failed: " + lastErr);
}
__name(callModel, "callModel");
function renderInline(s) {
  var out = "";
  var i = 0;
  while (i < s.length) {
    if (s.charAt(i) === "*" && s.charAt(i + 1) === "*") {
      var end = s.indexOf("**", i + 2);
      if (end > -1) {
        out += "<strong>" + s.slice(i + 2, end) + "</strong>";
        i = end + 2;
        continue;
      }
    }
    out += s.charAt(i);
    i++;
  }
  return out;
}
__name(renderInline, "renderInline");
function escHtml(s) {
  var out = "";
  var AMP = "&amp;", LT = "&lt;", GT = "&gt;", QUOT = "&quot;", Q = String.fromCharCode(34);
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === "&") out += AMP;
    else if (c === "<") out += LT;
    else if (c === ">") out += GT;
    else if (c === Q) out += QUOT;
    else out += c;
  }
  return out;
}
__name(escHtml, "escHtml");
function renderBody(md) {
  var lines = String(md || "").split(NL);
  var out = [];
  var buf = [];
  var listOpen = false;
  function flushP() {
    if (buf.length) {
      out.push("<p>" + renderInline(escHtml(buf.join(" "))) + "</p>");
      buf = [];
    }
  }
  __name(flushP, "flushP");
  function closeList() {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  }
  __name(closeList, "closeList");
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (!t) {
      flushP();
      closeList();
      continue;
    }
    if (t.indexOf("### ") === 0) {
      flushP();
      closeList();
      out.push("<h3>" + renderInline(escHtml(t.slice(4))) + "</h3>");
      continue;
    }
    if (t.indexOf("## ") === 0) {
      flushP();
      closeList();
      out.push("<h2>" + renderInline(escHtml(t.slice(3))) + "</h2>");
      continue;
    }
    if (t.indexOf("# ") === 0) {
      flushP();
      closeList();
      out.push("<h2>" + renderInline(escHtml(t.slice(2))) + "</h2>");
      continue;
    }
    if (t.indexOf("- ") === 0) {
      flushP();
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push("<li>" + renderInline(escHtml(t.slice(2))) + "</li>");
      continue;
    }
    if (t.indexOf("> ") === 0) {
      flushP();
      closeList();
      out.push("<blockquote>" + renderInline(escHtml(t.slice(2))) + "</blockquote>");
      continue;
    }
    buf.push(t);
  }
  flushP();
  closeList();
  return out.join(NL);
}
__name(renderBody, "renderBody");
function formLabel(f) {
  if (f === "essay") return "Essay";
  if (f === "notes") return "Field notes";
  if (f === "serial") return "Long-form";
  return f;
}
__name(formLabel, "formLabel");
var CSS = L(
  ":root{--bg:#faf8f5;--fg:#1b1a18;--mut:#6b6560;--line:#e2dcd4;--acc:#8a5a2b}",
  "@media(prefers-color-scheme:dark){:root{--bg:#161513;--fg:#e8e4de;--mut:#9a938b;--line:#2e2b27;--acc:#c99a5e}}",
  "*{box-sizing:border-box}",
  "body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.62 Georgia,'Iowan Old Style',serif;-webkit-font-smoothing:antialiased}",
  ".wrap{max-width:44rem;margin:0 auto;padding:3.5rem 1.4rem 6rem}",
  "header.mast{border-bottom:1px solid var(--line);padding-bottom:1.2rem;margin-bottom:2.4rem}",
  "header.mast h1{font-size:1.05rem;margin:0;letter-spacing:.14em;text-transform:uppercase;font-weight:600}",
  "header.mast p{margin:.5rem 0 0;color:var(--mut);font-size:.9rem}",
  "a{color:var(--acc)}",
  "h2{font-size:1.32rem;margin:2.4rem 0 .7rem;line-height:1.3}",
  "h3{font-size:1.08rem;margin:1.8rem 0 .5rem}",
  "p{margin:0 0 1.05rem}",
  "ul{margin:0 0 1.1rem;padding-left:1.2rem}",
  "li{margin:.35rem 0}",
  "blockquote{margin:1.3rem 0;padding:.2rem 0 .2rem 1rem;border-left:2px solid var(--line);color:var(--mut)}",
  ".lede{font-size:1.14rem;color:var(--mut);font-style:italic;margin-bottom:1.6rem}",
  ".meta{color:var(--mut);font-size:.82rem;letter-spacing:.04em;text-transform:uppercase;margin-bottom:1.9rem}",
  ".obj{margin:2.4rem 0 0;padding:1.1rem 1.2rem;border:1px solid var(--line);border-radius:3px}",
  ".obj h3{margin-top:0}",
  ".obj p:last-child{margin-bottom:0}",
  ".idx{list-style:none;padding:0}",
  ".idx li{padding:1.1rem 0;border-bottom:1px solid var(--line)}",
  ".idx .t{font-size:1.1rem;display:block;margin-bottom:.25rem}",
  ".idx .m{color:var(--mut);font-size:.8rem;letter-spacing:.05em;text-transform:uppercase}",
  ".idx .l{color:var(--mut);font-size:.93rem;margin-top:.35rem}",
  "nav.forms{margin:1.6rem 0 2.2rem;color:var(--mut);font-size:.85rem}",
  "nav.forms a{margin-right:.9rem}",
  ".fb{margin:2.6rem 0 0;padding-top:1.2rem;border-top:1px solid var(--line);color:var(--mut);font-size:.85rem}",
  ".fb a{margin-right:1rem}",
  "footer{margin-top:3.4rem;padding-top:1.2rem;border-top:1px solid var(--line);color:var(--mut);font-size:.78rem}"
);
function page(title, inner, extraHead) {
  return "<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content=" + String.fromCharCode(34) + "width=device-width,initial-scale=1" + String.fromCharCode(34) + "><title>" + escHtml(title) + "</title><style>" + CSS + "</style>" + (extraHead || "") + "</head><body><div class=wrap>" + inner + "</div></body></html>";
}
__name(page, "page");
function shell(inner) {
  return "<header class=mast><h1>Reading</h1><p>Written for one reader. Private.</p></header>" + inner;
}
__name(shell, "shell");
function renderIndex(pieces, keyQS, filter) {
  var items = [];
  for (var i = 0; i < pieces.length; i++) {
    var p = pieces[i];
    items.push("<li><a class=t href=" + String.fromCharCode(34) + "/p/" + p.slug + keyQS + String.fromCharCode(34) + ">" + escHtml(p.title) + "</a><div class=m>" + formLabel(p.form) + " &middot; " + p.day + " &middot; " + p.word_count + " words</div>" + (p.lede ? "<div class=l>" + escHtml(p.lede) + "</div>" : "") + "</li>");
  }
  var nav = "<nav class=forms><a href=/" + keyQS + ">all</a>";
  nav += "<a href=/?form=essay" + (keyQS ? "&" + keyQS.slice(1) : "") + ">essays</a>";
  nav += "<a href=/?form=notes" + (keyQS ? "&" + keyQS.slice(1) : "") + ">field notes</a>";
  nav += "<a href=/?form=serial" + (keyQS ? "&" + keyQS.slice(1) : "") + ">long-form</a></nav>";
  var body = nav + (items.length ? "<ul class=idx>" + items.join("") + "</ul>" : "<p>Nothing yet.</p>");
  return page("Reading", shell(body));
}
__name(renderIndex, "renderIndex");
function renderPiece(p, keyQS) {
  var body = "<div class=meta>" + formLabel(p.form) + " &middot; " + p.day + " &middot; " + p.word_count + " words</div><h2>" + escHtml(p.title) + "</h2>" + (p.subtitle ? "<p class=meta>" + escHtml(p.subtitle) + "</p>" : "") + (p.lede ? "<p class=lede>" + escHtml(p.lede) + "</p>" : "") + renderBody(p.body_md);
  var fb = "<div class=fb>Was this worth your time? <a href=/api/f?slug=" + p.slug + "&s=good>yes</a><a href=/api/f?slug=" + p.slug + "&s=flat>flat</a><a href=/api/f?slug=" + p.slug + "&s=no>no</a></div>";
  var foot = "<footer><a href=/ " + keyQS + ">back to index</a></footer>";
  return page(p.title, shell(body + fb + foot));
}
__name(renderPiece, "renderPiece");
function anchorsBlock(topic, anchors, life, profile) {
  var lines = [];
  lines.push("--- briefing. Never reproduce any wording from this briefing in the piece. ---");
  lines.push("seam, field A: " + topic.a);
  lines.push("seam, field B: " + topic.b);
  lines.push("");
  lines.push("source material, concrete and checkable; the only things you may assert as fact:");
  for (var i = 0; i < anchors.length; i++) {
    var a = anchors[i];
    lines.push("[" + (i + 1) + "] " + a.kind + " :: " + a.title);
    lines.push("    ref: " + a.ref);
    lines.push("    " + a.text);
    lines.push("");
  }
  lines.push("who the reader is; write for this person:");
  lines.push(profile);
  lines.push("");
  lines.push("his recent life; use only if it sharpens a piece, never list it back at him:");
  lines.push(life);
  return lines.join(NL).slice(0, 16e3);
}
__name(anchorsBlock, "anchorsBlock");
function countHeadings(md, level) {
  var mark = level === 3 ? "### " : "## ";
  var lines = String(md).split(NL);
  var n = 0;
  for (var i = 0; i < lines.length; i++) if (lines[i].trim().indexOf(mark) === 0) n++;
  return n;
}
__name(countHeadings, "countHeadings");
function extractSection(md, needle) {
  var lines = String(md).split(NL);
  var out = [];
  var on = false;
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (t.indexOf("#") === 0) {
      if (on) break;
      if (t.toLowerCase().indexOf(needle) >= 0) on = true;
      continue;
    }
    if (on) out.push(t);
  }
  return out.join(" ").trim();
}
__name(extractSection, "extractSection");
function firstParagraph(md) {
  var lines = String(md).split(NL);
  var buf = [];
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (!t) {
      if (buf.length) break;
      continue;
    }
    if (t.indexOf("#") === 0) continue;
    if (t.indexOf("- ") === 0 || t.indexOf("> ") === 0) continue;
    buf.push(t);
    if (buf.join(" ").length > 90) break;
  }
  return buf.join(" ").slice(0, 400);
}
__name(firstParagraph, "firstParagraph");
async function composePiece(env, form, topic, anchors, life, profile, continuity, feedback) {
  var formContract = form === "essay" ? P_ESSAY : form === "serial" ? P_SERIAL : P_NOTES;
  var outRule = form === "notes" ? "Output format: plain markdown only, no JSON, no code fences. First line: a single heading starting with # and a short title for the whole set. Then each item as its own ## heading followed by one or two paragraphs." : "Output format: plain markdown only, no JSON, no code fences. First line: a single heading starting with # and the title. Use ## for sections. Include one section headed exactly: ## The strongest objection";
  var sys = [P_STYLE, "", formContract, "", outRule].join(NL);
  var concreteRule = "Every claim must be tied to a named, checkable particular from the source material. Name the paper, the theorem, the number, or the place. A sentence that could have been written without the source material is a failed sentence.";
  var lenRule = concreteRule + " " + (form === "essay" ? "Length: 1000 to 1300 words. This is a requirement, not a suggestion." : form === "serial" ? "Length: 1300 to 1700 words. This is a requirement, not a suggestion." : "Length: four items, each 110 to 170 words. This is a requirement, not a suggestion.");
  var user = [anchorsBlock(topic, anchors, life, profile), "", lenRule, "", continuity, feedback ? "A previous attempt was rejected by an adversarial reader for this reason: " + feedback + " Write a fresh piece that fixes that." : ""].join(NL);
  var r = await callModel(env, [{ role: "system", content: sys }, { role: "user", content: user }], GEN_MAX_TOKENS, GEN_TIMEOUT_MS);
  var md = String(r.text || "").trim();
  if (md.indexOf("```") === 0) {
    var f = md.indexOf(NL);
    if (f > 0) md = md.slice(f + 1);
    var close = md.lastIndexOf("```");
    if (close > 0) md = md.slice(0, close);
    md = md.trim();
  }
  var title = "";
  var lines = md.split(NL);
  if (lines.length && lines[0].trim().indexOf("# ") === 0) {
    title = lines[0].trim().slice(2).trim();
    md = lines.slice(1).join(NL).trim();
  }
  if (!title) title = topic.a + " and " + topic.b;
  var objection = extractSection(md, "objection");
  return {
    piece: {
      title: title.slice(0, 300),
      subtitle: "",
      lede: firstParagraph(md),
      body_md: md,
      bridge: { a: topic.a, b: topic.b, kind: "proposed analogy" },
      objection: objection || (form === "notes" ? "Each item stands or falls on its own." : "")
    },
    model: r.model,
    raw: String(r.text || "")
  };
}
__name(composePiece, "composePiece");
async function critiquePiece(env, piece, form) {
  var band = form === "essay" ? "900 to 1500 words" : form === "serial" ? "1200 to 1800 words" : "3 to 5 items of 90 to 200 words each";
  var user = "FORM: " + form + " (" + band + ")" + NL + NL + "TITLE: " + piece.title + NL + "LEDE: " + (piece.lede || "") + NL + "STATED BRIDGE: " + JSON.stringify(piece.bridge || {}) + NL + "STATED OBJECTION: " + (piece.objection || "") + NL + NL + "BODY:" + NL + piece.body_md;
  var r = await callModel(env, [{ role: "system", content: P_CRITIQUE }, { role: "user", content: user }], 900, CRITIQUE_TIMEOUT_MS);
  return parseJsonLoose(r.text);
}
__name(critiquePiece, "critiquePiece");
function validatePiece(piece, form) {
  var problems = [];
  if (!piece || !piece.body_md) return { ok: false, problems: ["no body"] };
  var md = String(piece.body_md);
  var wc = wordCount(md);
  if (form === "essay" && (wc < 550 || wc > 2400)) problems.push("essay length " + wc);
  if (form === "serial" && (wc < 700 || wc > 2600)) problems.push("serial length " + wc);
  if (form === "notes") {
    var items = countHeadings(md, 2);
    if (items < 3) problems.push("notes items " + items);
    if (wc < 200 || wc > 1800) problems.push("notes length " + wc);
  }
  var hits = bannedHits(md + " " + String(piece.title || "") + " " + String(piece.lede || ""));
  if (hits.length) problems.push("banned: " + hits.join(", "));
  if (hasEmoji(md)) problems.push("emoji present");
  if (!piece.title || String(piece.title).length < 4) problems.push("no title");
  if (form !== "notes" && wc >= 700 && (!piece.objection || String(piece.objection).length < 40)) problems.push("objection too thin");
  if (!piece.bridge || !piece.bridge.a || !piece.bridge.b) problems.push("no bridge declared");
  return { ok: problems.length === 0, problems, words: wc };
}
__name(validatePiece, "validatePiece");
async function similarExists(env, text, excludeSlug) {
  try {
    var vecs = await embed(env, [text.slice(0, 6e3)]);
    if (!vecs.length) return null;
    var res = await env.VZ.query(vecs[0], { topK: 3, returnMetadata: "all" });
    var ms = res && res.matches || [];
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      var isPiece = m.metadata && String(m.metadata.kind || "") === "companion-piece";
      if (isPiece && m.score >= SIM_THRESHOLD && String(m.metadata.slug || "") !== excludeSlug) {
        return { slug: m.metadata.slug, score: m.score };
      }
    }
  } catch (e) {
  }
  return null;
}
__name(similarExists, "similarExists");
async function persistPiece(env, piece, form, topic, model, quality, words) {
  var day = amsDayKey(/* @__PURE__ */ new Date());
  var salt = String(Date.now()) + topic.id + form;
  var slug = day + "-" + form + "-" + await sha16(salt);
  var anchorJson = JSON.stringify({ topic: topic.id, seam: [topic.a, topic.b], bridge: piece.bridge || null });
  await env.PERSONAL.prepare(
    "INSERT OR IGNORE INTO companion_pieces(slug, form, title, subtitle, lede, body_md, anchor_json, quality_json, word_count, day, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(slug, form, String(piece.title).slice(0, 300), String(piece.subtitle || "").slice(0, 300), String(piece.lede || "").slice(0, 600), String(piece.body_md), anchorJson, JSON.stringify(quality || {}), words, day, nowIso()).run();
  try {
    var vecs = await embed(env, [String(piece.title) + NL + String(piece.lede || "") + NL + String(piece.body_md).slice(0, 5e3)]);
    if (vecs.length && env.VZ) {
      await env.VZ.upsert([{
        id: "companion-" + slug,
        values: vecs[0],
        metadata: { kind: "companion-piece", slug, form, title: String(piece.title).slice(0, 200), day }
      }]);
    }
  } catch (e) {
  }
  try {
    await env.MEDIA.put("companion/" + day + "/" + slug + ".md", String(piece.body_md), {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" }
    });
  } catch (e) {
  }
  if (form === "serial") {
    var lines = String(piece.body_md).trim().split(NL);
    var tail = lines.slice(Math.max(0, lines.length - 3)).join(" ");
    var cur = await env.PERSONAL.prepare("SELECT id, chapters, title FROM companion_series ORDER BY id DESC LIMIT 1").all();
    var c = (cur.results || [])[0];
    if (c) {
      await env.PERSONAL.prepare("UPDATE companion_series SET chapters = ?, last_lines = ?, updated_at = ? WHERE id = ?").bind((c.chapters || 0) + 1, tail.slice(0, 800), nowIso(), c.id).run();
    } else {
      await env.PERSONAL.prepare("INSERT INTO companion_series(series, title, thesis, chapters, last_lines, updated_at) VALUES(?,?,?,?,?,?)").bind(topic.id + "-serial", String(piece.title).slice(0, 300), String(piece.lede || "").slice(0, 600), 1, tail.slice(0, 800), nowIso()).run();
    }
  }
  return slug;
}
__name(persistPiece, "persistPiece");
async function logRun(env, form, model, topic, status, detail, ms) {
  try {
    await env.PERSONAL.prepare(
      "INSERT INTO companion_runs(run_at, form, model, topic, status, detail, ms) VALUES(?,?,?,?,?,?,?)"
    ).bind(nowIso(), form, String(model || ""), String(topic || ""), status, String(detail || "").slice(0, 1200), ms).run();
  } catch (e) {
  }
}
__name(logRun, "logRun");
async function sendMail(env, piece, slug, day) {
  if (!env.EMAIL) return { ok: false, error: "no email binding" };
  try {
    var subject = piece.title + " (" + formLabel(piece.form || "essay") + ")";
    var body = (piece.lede ? piece.lede + NL + NL : "") + String(piece.body_md).slice(0, 2e4) + NL + NL + "Read online: " + String(piece.link || "");
    var resp = await env.EMAIL.fetch("https://email.internal/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (env.EMAIL_API_KEY || "") },
      body: JSON.stringify({ to: "rwnquni@outlook.com", from: "rowan.quni@qnfo.org", subject, body })
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
__name(sendMail, "sendMail");
async function mailOut(env, slug, origin) {
  try {
    var pr = await env.PERSONAL.prepare("SELECT * FROM companion_pieces WHERE slug = ?").bind(slug).all();
    var prow = (pr.results || [])[0];
    if (!prow) return { ok: false, error: "no piece" };
    prow.link = origin + "/p/" + slug + (env.COMPANION_KEY ? "?k=" + env.COMPANION_KEY : "");
    return await sendMail(env, prow, slug, prow.day);
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
__name(mailOut, "mailOut");
async function generate(env, form, opts) {
  var t0 = Date.now();
  opts = opts || {};
  var topic = null;
  var model = "";
  try {
    await ensureSchema(env);
    await logRun(env, form, "", "", "stage", "schema ok", Date.now() - t0);
    topic = await pickTopic(env, form);
    await logRun(env, form, "", topic.id, "stage", "topic", Date.now() - t0);
    var profile = await loadProfile(env);
    var life = await loadLife(env);
    var continuity = await loadContinuity(env, form);
    await logRun(env, form, "", topic.id, "stage", "context " + profile.length + "/" + life.length + "/" + continuity.length, Date.now() - t0);
    var anchors = [];
    var dayN = Number(amsDayKey(/* @__PURE__ */ new Date()).slice(8, 10)) || 0;
    try {
      var papers = await fetchArxiv(topic.cat);
      for (var i = 0; i < papers.length; i++) anchors.push(papers[i]);
    } catch (e) {
    }
    try {
      var w = await fetchWiki(topic.wiki);
      if (w) anchors.push(w);
    } catch (e) {
    }
    if (anchors.length < 3) {
      var fbCats = ["quant-ph", "math.NT", "cond-mat.stat-mech", "cs.IT", "math.CT"];
      try {
        var more = await fetchArxiv(fbCats[dayN % fbCats.length]);
        for (var m2 = 0; m2 < more.length && anchors.length < 4; m2++) anchors.push(more[m2]);
      } catch (e) {
      }
    }
    if (anchors.length < 3) {
      var fbWiki = ["Ultrametric space", "Laws of Form", "Entropy (information theory)", "Counterpoint", "Kuramoto model"];
      var fw = fbWiki[dayN % fbWiki.length];
      if (fw !== topic.wiki) {
        try {
          var w2 = await fetchWiki(fw);
          if (w2) anchors.push(w2);
        } catch (e) {
        }
      }
    }
    await logRun(env, form, "", topic.id, "stage", "anchorKinds " + anchors.map(function(x) {
      return x.kind;
    }).join(","), Date.now() - t0);
    await logRun(env, form, "", topic.id, "stage", "anchors " + anchors.length, Date.now() - t0);
    if (anchors.length < 2) {
      await logRun(env, form, "", topic.id, "blocked", "insufficient anchors", Date.now() - t0);
      return { ok: false, error: "insufficient anchors" };
    }
    var attempt = 0;
    var best = null;
    var feedback = "";
    while (attempt < 3) {
      attempt++;
      await logRun(env, form, "", topic.id, "stage", "compose attempt " + attempt, Date.now() - t0);
      var comp = await composePiece(env, form, topic, anchors, life, profile, continuity, feedback);
      model = comp.model;
      await logRun(env, form, model, topic.id, "stage", "composed " + String(comp.piece && comp.piece.body_md || "").length, Date.now() - t0);
      var piece = comp.piece;
      if (!piece) {
        continue;
      }
      var v = validatePiece(piece, form);
      if (v.ok) {
        var badNames = unverifiedNames(piece, anchors, topic);
        if (badNames.length) {
          v = { ok: false, problems: ["unverified names: " + badNames.slice(0, 6).join(", ")], words: v.words };
        }
      }
      if (!v.ok) {
        await logRun(env, form, model, topic.id, "rejected", "validate: " + v.problems.join("; ") + " || raw: " + String(comp.raw || "").slice(0, 500), Date.now() - t0);
        continue;
      }
      var dup = await similarExists(env, String(piece.title) + NL + String(piece.body_md), null);
      if (dup) {
        await logRun(env, form, model, topic.id, "rejected", "too similar to " + dup.slug + " (" + dup.score.toFixed(3) + ")", Date.now() - t0);
        continue;
      }
      await logRun(env, form, model, topic.id, "stage", "critique", Date.now() - t0);
      var crit = await critiquePiece(env, piece, form);
      var q = crit || {};
      var dims = ["specificity", "argument", "bridge", "objection", "voice"];
      var worst = 10;
      var worstName = "";
      for (var d = 0; d < dims.length; d++) {
        var val = Number(q[dims[d]]);
        if (!Number.isFinite(val)) val = 5;
        if (val < worst) {
          worst = val;
          worstName = dims[d];
        }
      }
      if (worst < ACCEPT_FLOOR || String(q.verdict || "").toLowerCase() === "reject") {
        await logRun(env, form, model, topic.id, "rejected", "critique " + worstName + "=" + worst + " :: " + String(q.why || ""), Date.now() - t0);
        feedback = "weakest dimension was " + worstName + ". " + String(q.why || "");
        q.gate = "forced";
        best = { piece, quality: q, words: v.words };
        continue;
      }
      q.gate = "passed";
      best = { piece, quality: q, words: v.words };
      break;
    }
    if (!best) {
      await logRun(env, form, model, topic.id, "failed", "no piece survived the gate", Date.now() - t0);
      return { ok: false, error: "no piece survived the gate" };
    }
    var slug = await persistPiece(env, best.piece, form, topic, model, best.quality, best.words);
    await logRun(env, form, model, topic.id, "ok", slug, Date.now() - t0);
    return { ok: true, slug, form, title: best.piece.title, words: best.words, quality: best.quality, topic: topic.id, model };
  } catch (e) {
    await logRun(env, form, model, topic ? topic.id : "", "error", String(e && e.message || e), Date.now() - t0);
    return { ok: false, error: String(e && e.message || e) };
  }
}
__name(generate, "generate");
var worker_default = {
  async fetch(request, env, ctx) {
    var u = new URL(request.url);
    var p = u.pathname;
    if (request.method === "OPTIONS") return json({ ok: true });
    if (p === "/health") {
      var n = 0, last = null;
      try {
        var r = await env.PERSONAL.prepare("SELECT COUNT(*) n FROM companion_pieces").all();
        n = ((r.results || [])[0] || {}).n || 0;
        var r2 = await env.PERSONAL.prepare("SELECT slug, title, form, day FROM companion_pieces ORDER BY id DESC LIMIT 1").all();
        last = (r2.results || [])[0] || null;
      } catch (e) {
      }
      return json({ ok: true, version: VERSION, pieces: n, last, rhythm: RHYTHM, models: MODELS });
    }
    if (!authorized(request, env)) {
      return json({ error: { message: "unauthorized: append ?k=KEY" } }, 401);
    }
    if (p === "/api/ping") {
      var ping = {};
      for (var pi = 0; pi < MODELS.length; pi++) {
        var t0p = Date.now();
        try {
          var rp = await env.AI.run(MODELS[pi], { messages: [{ role: "user", content: "Reply with the single word: ready" }], max_tokens: 16 }, { gateway: { id: "default" }, signal: AbortSignal.timeout(3e4) });
          ping[MODELS[pi]] = { ms: Date.now() - t0p, resp: String(rp && rp.response || JSON.stringify(rp)).slice(0, 160) };
        } catch (e) {
          ping[MODELS[pi]] = { ms: Date.now() - t0p, err: String(e && e.message || e).slice(0, 200) };
        }
      }
      return json({ ok: true, version: VERSION, ping });
    }
    if (p === "/api/probe") {
      var cand = ["@cf/moonshotai/kimi-k2.6", "@cf/openai/gpt-oss-120b", "@cf/zai-org/glm-5.3", "@cf/deepseek-ai/deepseek-v4-pro-0813"];
      if (u.searchParams.get("m")) cand = [u.searchParams.get("m")];
      var probe = {};
      var ci = Number(u.searchParams.get("i") || 0);
      var useGw = u.searchParams.get("gw") !== "0";
      var reqM = u.searchParams.get("m");
      if (reqM && !modelAllowed(reqM)) return json({ error: "model refused: banned by standing directive", model: reqM }, 400);
      for (ci = ci; ci < cand.length; ci++) {
        var tt = Date.now();
        try {
          var opts2 = useGw ? { gateway: { id: "default" } } : {};
          var rq = await env.AI.run(cand[ci], {
            messages: [
              { role: "system", content: "Write plain scholarly prose. No filler, no emojis, no meta-commentary." },
              { role: "user", content: "Write three short paragraphs, about 250 words total, on why the arithmetic of p-adic numbers resembles musical tuning systems. Be concrete." }
            ],
            max_tokens: Number(u.searchParams.get("mt") || 700),
            temperature: 0.7
          }, opts2);
          var c = rq && rq.response || "";
          var rc = "";
          if (rq && rq.choices && rq.choices[0] && rq.choices[0].message) {
            if (!c) c = rq.choices[0].message.content || "";
            rc = rq.choices[0].message.reasoning_content || "";
          }
          probe[cand[ci]] = { ms: Date.now() - tt, clen: String(c).length, rlen: String(rc).length, fr: rq && rq.choices && rq.choices[0] && rq.choices[0].finish_reason || "" };
        } catch (e) {
          probe[cand[ci]] = { ms: Date.now() - tt, err: String(e && e.message || e).slice(0, 160) };
        }
        if (u.searchParams.get("one") === "1") break;
      }
      return json({ ok: true, probe });
    }
    if (p === "/api/compare") {
      var cm = u.searchParams.get("m") || MODELS[0];
      if (!modelAllowed(cm)) return json({ error: "model refused: banned by standing directive", model: cm }, 400);
      var cmt = Number(u.searchParams.get("mt") || 2600);
      var cTopic = { id: "compare", cat: "math.NT", wiki: "Ultrametric space", a: "p-adic geometry", b: "musical tuning" };
      var cAnchors = [
        { kind: "paper", ref: "arXiv:2509.00001", title: "Ultrametric Hierarchies in Representation Learning", text: "We show that the tree-structured distance induced by a p-adic valuation on a finite alphabet yields a representation in which semantically nested categories are metrically nested. The ultrametric inequality forces every triangle to be isosceles with the two long sides equal, which makes hierarchical clustering exact rather than approximate. We report exact recovery on three benchmarks where agglomerative clustering fails." },
        { kind: "paper", ref: "arXiv:2509.00002", title: "Continued Fractions and Just Intonation", text: "The convergents of a continued fraction give the best rational approximations to a real number. Applied to frequency ratios, this recovers the historically attested tuning ladder: 3/2, 4/3, 5/4 and their compounds. The approximation error of a convergent falls monotonically, so the order of the ladder is forced rather than chosen. We tabulate the first nine convergents against the historical record." },
        { kind: "concept", ref: "https://en.wikipedia.org/wiki/Ultrametric_space", title: "Ultrametric space", text: "An ultrametric space is a metric space in which the triangle inequality is replaced by the strong triangle inequality: d(x,z) is at most the larger of d(x,y) and d(y,z). Every ultrametric space embeds isometrically in a complete one, and its closed balls are either disjoint or nested, never partially overlapping." }
      ];
      var cSys = [P_STYLE, "", P_ESSAY, "", "Output format: plain markdown only, no JSON, no code fences. First line: a single heading starting with # and the title. Include one section headed exactly: ## The strongest objection"].join(NL);
      var cUser = [anchorsBlock(cTopic, cAnchors, "(life context omitted for this comparison run)", "(taste context omitted for this comparison run)"), "", "Length: 900 to 1100 words. This is a requirement."].join(NL);
      var c0 = Date.now();
      try {
        var cr = await env.AI.run(cm, { messages: [{ role: "system", content: cSys }, { role: "user", content: cUser }], max_tokens: cmt, temperature: 0.7 });
        var cc = "";
        var crc = "";
        if (cr && typeof cr.response === "string" && cr.response.length) cc = cr.response;
        if (cr && cr.choices && cr.choices[0] && cr.choices[0].message) {
          if (!cc && typeof cr.choices[0].message.content === "string") cc = cr.choices[0].message.content;
          crc = cr.choices[0].message.reasoning_content || cr.choices[0].message.reasoning || "";
        }
        return json({
          model: cm,
          mt: cmt,
          ms: Date.now() - c0,
          clen: String(cc).length,
          rlen: String(crc).length,
          fr: cr && cr.choices && cr.choices[0] && cr.choices[0].finish_reason || "",
          words: wordCount(String(cc)),
          head: String(cc).slice(0, 1200),
          tail: String(cc).slice(-320)
        });
      } catch (e) {
        return json({ model: cm, mt: cmt, ms: Date.now() - c0, err: String(e && e.message || e).slice(0, 300) });
      }
    }
    if (p === "/api/f" || p === "/api/feedback") {
      var slug = u.searchParams.get("slug") || "";
      var sig = u.searchParams.get("s") || u.searchParams.get("signal") || "";
      if (slug && sig) {
        try {
          await env.PERSONAL.prepare("INSERT INTO companion_feedback(slug, signal, note, created_at) VALUES(?,?,?,?)").bind(slug, sig.slice(0, 40), (u.searchParams.get("note") || "").slice(0, 500), nowIso()).run();
        } catch (e) {
        }
      }
      return Response.redirect(new URL("/p/" + slug + (u.searchParams.get("k") ? "?k=" + u.searchParams.get("k") : ""), u.origin).toString(), 302);
    }
    if (p === "/api/pieces") {
      var lim = Number(u.searchParams.get("limit")) || 30;
      var f2 = u.searchParams.get("form") || "";
      var sql = f2 ? "SELECT slug, form, title, subtitle, lede, word_count, day, created_at, anchor_json, quality_json FROM companion_pieces WHERE form = ? ORDER BY id DESC LIMIT ?" : "SELECT slug, form, title, subtitle, lede, word_count, day, created_at, anchor_json, quality_json FROM companion_pieces ORDER BY id DESC LIMIT ?";
      var st = f2 ? env.PERSONAL.prepare(sql).bind(f2, lim) : env.PERSONAL.prepare(sql).bind(lim);
      var rr = await st.all();
      return json({ ok: true, count: (rr.results || []).length, pieces: rr.results || [] });
    }
    if (p.indexOf("/api/piece/") === 0) {
      var s3 = p.slice(11);
      var q3 = await env.PERSONAL.prepare("SELECT * FROM companion_pieces WHERE slug = ?").bind(s3).all();
      var row3 = (q3.results || [])[0];
      if (!row3) return json({ error: { message: "not found" } }, 404);
      return json({ ok: true, piece: row3 });
    }
    if (p === "/api/runs") {
      var q4 = await env.PERSONAL.prepare("SELECT * FROM companion_runs ORDER BY id DESC LIMIT 40").all();
      return json({ ok: true, runs: q4.results || [] });
    }
    if (p === "/run" || p === "/api/run") {
      var want = u.searchParams.get("form") || "";
      if (!want || ["essay", "notes", "serial"].indexOf(want) < 0) want = RHYTHM[amsWeekday(/* @__PURE__ */ new Date())];
      if (u.searchParams.get("async") === "1") {
        ctx.waitUntil((async function() {
          var o = await generate(env, want, {});
          if (o && o.ok && u.searchParams.get("mail") === "1") {
            await mailOut(env, o.slug, u.origin);
          }
        })().catch(function() {
        }));
        return json({ ok: true, accepted: true, form: want, note: "generating; poll /api/runs" });
      }
      var out = await generate(env, want, {});
      if (out.ok && u.searchParams.get("mail") === "1") {
        try {
          var pr = await env.PERSONAL.prepare("SELECT * FROM companion_pieces WHERE slug = ?").bind(out.slug).all();
          var prow = (pr.results || [])[0];
          if (prow) {
            prow.link = u.origin + "/p/" + out.slug + (env.COMPANION_KEY ? "?k=" + env.COMPANION_KEY : "");
            var m = await sendMail(env, prow, out.slug, prow.day);
            out.mail = m;
          }
        } catch (e) {
          out.mail = { ok: false, error: String(e && e.message || e) };
        }
      }
      return json(out);
    }
    var keyQS = env.COMPANION_KEY && u.searchParams.get("k") ? "?k=" + u.searchParams.get("k") : "";
    var cookie = "";
    if (env.COMPANION_KEY && u.searchParams.get("k")) {
      cookie = "pc_key=" + env.COMPANION_KEY + "; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax";
    }
    if (p === "/" || p === "") {
      var filter = u.searchParams.get("form") || "";
      var sql2 = filter ? "SELECT slug, form, title, lede, word_count, day FROM companion_pieces WHERE form = ? ORDER BY id DESC LIMIT 200" : "SELECT slug, form, title, lede, word_count, day FROM companion_pieces ORDER BY id DESC LIMIT 200";
      var st2 = filter ? env.PERSONAL.prepare(sql2).bind(filter) : env.PERSONAL.prepare(sql2);
      var rows = await st2.all();
      var res = html(renderIndex(rows.results || [], keyQS, filter));
      if (cookie) res.headers.set("Set-Cookie", cookie);
      return res;
    }
    if (p.indexOf("/p/") === 0) {
      var s = p.slice(3);
      var q = await env.PERSONAL.prepare("SELECT * FROM companion_pieces WHERE slug = ?").bind(s).all();
      var row = (q.results || [])[0];
      if (!row) return html(page("Not found", shell("<p>No such piece.</p>")), 404);
      var res2 = html(renderPiece(row, keyQS));
      if (cookie) res2.headers.set("Set-Cookie", cookie);
      return res2;
    }
    return json({ error: { message: "not found", version: VERSION } }, 404);
  },
  async scheduled(event, env, ctx) {
    var form = RHYTHM[amsWeekday(/* @__PURE__ */ new Date())];
    ctx.waitUntil((async function() {
      var out = await generate(env, form, {});
      if (out.ok) {
        try {
          var pr = await env.PERSONAL.prepare("SELECT * FROM companion_pieces WHERE slug = ?").bind(out.slug).all();
          var prow = (pr.results || [])[0];
          if (prow && env.EMAIL) {
            prow.link = "https://personal-companion.q08.workers.dev/p/" + out.slug + (env.COMPANION_KEY ? "?k=" + env.COMPANION_KEY : "");
            await sendMail(env, prow, out.slug, prow.day);
          }
        } catch (e) {
        }
      }
    })());
  }
};
return { default: worker_default };
})();
var personallifeindexerMod = (function(){
const QNFO_VERSION = "personal-life-indexer/fabric-20260910";
const VERSION = "2.5.0+index-auth";
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// indexer.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var indexer_default = {
  async scheduled(event, env, ctx) {
    console.log(`[indexer] cron: ${event.cron} \u2014 one slice of 400`);
    ctx.waitUntil(indexAll(env, { limit: 300, scanCap: 400 }));
  },
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      };
      if (request.method === "OPTIONS") return new Response(null, { headers: cors, status: 204 });
      if (url.pathname === "/health") {
        return json({ ok: true, worker: "personal-life-indexer", index: "personal-life", version: VERSION }, cors);
      }
      if (url.pathname === "/index") {
        const token = request.headers.get("X-Index-Token") || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
        if (token !== env.INDEX_TOKEN) {
          return json({ ok: false, error: "unauthorized \u2014 X-Index-Token required" }, cors, 401);
        }
        if (request.method !== "POST" && request.method !== "GET") return json({ ok: false, error: "method" }, cors, 405);
        const limit = Number(url.searchParams.get("limit") || 200);
        const scanCap = Number(url.searchParams.get("scanCap") || 400);
        const prefix = url.searchParams.get("prefix") || "";
        const cursor = url.searchParams.get("cursor") || void 0;
        const result = await indexAll(env, { limit, scanCap, prefix, cursor });
        return json({ ok: true, ...result }, cors);
      }
      if (url.pathname === "/files" && request.method === "GET") {
        const prefix = url.searchParams.get("prefix") || "";
        const limit = Number(url.searchParams.get("limit") || 50);
        const rows = await env.PERSONAL.prepare(
          "SELECT path, type, size, modified, indexed_at, chunks, category FROM files WHERE path LIKE ?1 ORDER BY modified DESC LIMIT ?2"
        ).bind(`%${prefix}%`, limit).all();
        return json({ ok: true, files: rows.results, count: rows.results.length }, cors);
      }
      return json({ ok: false, error: "not found" }, cors, 404);
    } catch (e) {
      return json({ ok: false, error: "EXCEPTION: " + (e && e.message || String(e)) }, {}, 500);
    }
  }
};
async function json(obj, cors = {}, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });
}
__name(json, "json");
__name2(json, "json");
var TEXT_EXTS = /* @__PURE__ */ new Set(["md", "txt", "csv", "tsv", "json", "html", "htm", "xml", "yaml", "yml", "tex", "bib", "mermaid", "log", "ini", "cfg", "conf", "rtf", "mdx", "markdown"]);
var NOISE_FRAGMENTS = ["node_modules", "/.git/", ".wrangler/", "/dist/", "/build/", "/.obsidian/workspace", "desktop.ini"];
function extOf(key) {
  const i = key.lastIndexOf(".");
  return i >= 0 ? key.slice(i + 1).toLowerCase() : "";
}
__name(extOf, "extOf");
__name2(extOf, "extOf");
function sanitize(s, max = 800) {
  return String(s || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/[\uD800-\uDFFF]/g, "").trim().slice(0, max);
}
__name(sanitize, "sanitize");
__name2(sanitize, "sanitize");
async function getObjectText(r2, key, maxBytes = 4 * 1024 * 1024) {
  try {
    const obj = await r2.get(key);
    if (!obj || obj.size > maxBytes) return null;
    const ext = extOf(key);
    if (!TEXT_EXTS.has(ext)) return null;
    const buf = await obj.arrayBuffer();
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  } catch (e) {
    return null;
  }
}
__name(getObjectText, "getObjectText");
__name2(getObjectText, "getObjectText");
function chunkText(text, size = 900, overlap = 120) {
  const chunks = [];
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  const n = clean.length;
  if (n < 60) return chunks;
  let i = 0;
  while (i < n) {
    let end = i + size;
    if (end > n) end = n;
    else {
      let lastNl = -1;
      for (let j = i; j < end; j++) if (clean.charCodeAt(j) === 10) lastNl = j;
      if (lastNl > i + size * 0.5) end = lastNl;
      else {
        let lastSp = -1;
        for (let j = i; j < end; j++) if (clean.charCodeAt(j) === 32) lastSp = j;
        if (lastSp > i + size * 0.5) end = lastSp;
      }
    }
    const chunk = clean.slice(i, end).trim();
    if (chunk.length >= 40) chunks.push(chunk);
    if (end >= n) break;
    if (end <= i) break;
    i = end - overlap;
  }
  return chunks;
}
__name(chunkText, "chunkText");
__name2(chunkText, "chunkText");
var CATEGORY_KEYWORDS = [
  ["finance", ["bank", "statement", "tax", "invoice", "receipt", "mortgage", "rent", "insurance", "salary", "paycheck", "visa card"]],
  ["health", ["medical", "doctor", "clinic", "prescription", "vaccin", "hospital", "therapy"]],
  ["legal", ["contract", "agreement", "will", "power of attorney", "court", "lawsuit", "notary", "settlement"]],
  ["housing", ["apartment", "lease", "landlord", "property", "utilities", "electricity", "water bill"]],
  ["identity", ["passport", "driving license", "residence permit", "visa", "birth certificate", "id card"]],
  ["work", ["resume", "cv", "interview", "offer letter", "employment", "reference"]],
  ["travel", ["flight", "boarding", "itinerary", "hotel", "booking", "ticket"]],
  ["education", ["diploma", "transcript", "degree", "course", "university", "certificate"]],
  ["personal", ["family", "photo", "journal", "diary", "letter"]]
];
function categorize(text, key) {
  const hay = (text + " " + key).toLowerCase();
  let best = "general", bestScore = 0;
  for (const [cat, kws] of CATEGORY_KEYWORDS) {
    let score = 0;
    for (const kw of kws) if (hay.includes(kw)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }
  return bestScore > 0 ? best : "general";
}
__name(categorize, "categorize");
__name2(categorize, "categorize");
async function sha256hex(s) {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest.slice(0, 16))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256hex, "sha256hex");
__name2(sha256hex, "sha256hex");
async function safeUpsert(env, batch, skipped) {
  if (batch.length === 0) return;
  try {
    await env.VZ.upsert(batch);
  } catch (e) {
    if (batch.length === 1) {
      const md = batch[0].metadata || {};
      skipped.push(md.path || "?");
      console.log(`[indexer] skipped bad vector id=${batch[0].id} path=${md.path}`);
      return;
    }
    const mid = Math.ceil(batch.length / 2);
    await safeUpsert(env, batch.slice(0, mid), skipped);
    await safeUpsert(env, batch.slice(mid), skipped);
  }
}
__name(safeUpsert, "safeUpsert");
__name2(safeUpsert, "safeUpsert");
async function indexAll(env, { limit, scanCap, prefix, cursor }) {
  const started = Date.now();
  let scanned = 0, indexed = 0, skipped = 0, errors = 0;
  let nextCursor = void 0;
  const skippedVectors = [];
  const regRows = await env.PERSONAL.prepare("SELECT path, size, modified FROM files").all();
  const registry = /* @__PURE__ */ new Map();
  for (const r of regRows.results || []) registry.set(r.path, `${r.size}|${r.modified}`);
  const vectorBuf = [];
  const d1Buf = [];
  async function flush() {
    if (vectorBuf.length) await safeUpsert(env, vectorBuf.splice(0, vectorBuf.length), skippedVectors);
    if (d1Buf.length) {
      try {
        await env.PERSONAL.batch(d1Buf.splice(0, d1Buf.length));
      } catch (e) {
        d1Buf.splice(0, d1Buf.length);
      }
    }
  }
  __name(flush, "flush");
  __name2(flush, "flush");
  const listed = await env.DDRIVE.list({ cursor, limit: 1e3, prefix: prefix || void 0 });
  nextCursor = listed.cursor || void 0;
  for (const obj of listed.objects || []) {
    scanned++;
    if (scanned > scanCap) break;
    const key = obj.key;
    if (NOISE_FRAGMENTS.some((f) => key.includes(f))) {
      skipped++;
      continue;
    }
    const ext = extOf(key);
    if (!TEXT_EXTS.has(ext)) {
      skipped++;
      continue;
    }
    const mod = obj.uploaded && obj.uploaded.toISOString() || (/* @__PURE__ */ new Date()).toISOString();
    const sig = `${obj.size}|${mod}`;
    if (registry.get(key) === sig) {
      skipped++;
      continue;
    }
    const text = await getObjectText(env.DDRIVE, key);
    if (!text) {
      skipped++;
      continue;
    }
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      skipped++;
      continue;
    }
    let vectors = [];
    try {
      const resp = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: chunks.slice(0, 32) }, { gateway: { id: "default" } });
      vectors = resp && resp.data || [];
    } catch (e) {
      errors++;
      continue;
    }
    const valid = vectors.filter((v) => Array.isArray(v) && v.length === 768).map((v) => v.map((x) => Number.isFinite(x) ? x : 0));
    if (valid.length === 0) {
      errors++;
      continue;
    }
    const cat = categorize(chunks.join(" "), key);
    const keyDigest = await sha256hex(key);
    const pathSan = sanitize(key, 500);
    for (let i = 0; i < valid.length; i++) {
      vectorBuf.push({
        id: `${keyDigest}:${i}`,
        values: valid[i],
        metadata: {
          path: pathSan,
          type: String(ext),
          chunk: String(i),
          category: String(cat),
          modified: String(mod),
          text: sanitize(chunks[i] || "", 800)
        }
      });
    }
    d1Buf.push(env.PERSONAL.prepare(
      `INSERT INTO files (path, type, size, modified, indexed_at, chunks, title, category)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(path) DO UPDATE SET size=?3, modified=?4, indexed_at=?5, chunks=?6, title=?7, category=?8`
    ).bind(key, ext, obj.size, mod, (/* @__PURE__ */ new Date()).toISOString(), valid.length, basename(key), cat));
    registry.set(key, sig);
    indexed++;
    if (indexed >= limit || vectorBuf.length >= 500) await flush();
  }
  await flush();
  return {
    scanned,
    indexed,
    skipped,
    errors,
    elapsedMs: Date.now() - started,
    cursor: nextCursor,
    done: !nextCursor,
    skippedVectors: skippedVectors.length
  };
}
__name(indexAll, "indexAll");
__name2(indexAll, "indexAll");
function basename(key) {
  const parts = key.split("/");
  return parts[parts.length - 1] || key;
}
__name(basename, "basename");
__name2(basename, "basename");
return { default: indexer_default };
})();
var personallifemaintainMod = (function(){
const QNFO_VERSION = "personal-life-maintain/fabric-20260910";
const VERSION = "1.0.0+fabric.20260910";
const MEM_DECAY_HALF_LIFE_DAYS = 90;
const MEM_PRUNE_EFFECTIVE_IMPORTANCE = 0.2;
function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}
async function runMemoryMaintain(env, opts) {
  opts = opts || {};
  var commit = !!opts.commit;
  var result = { status: "memory-maintained", plane: "personal", commit: commit, timestamp: new Date().toISOString(), scanned: 0, decayed: 0, expired: 0, deduped: 0, pruned: 0, ids: [] };
  try {
    var rows = await env.PERSONAL.prepare("SELECT id, category, content, summary, importance, session_id, created_at, expires_at FROM agent_memories").all();
    var mems = rows.results || [];
    result.scanned = mems.length;
    var now = Date.now();
    var pruneIds = new Set();
    for (var i = 0; i < mems.length; i++) {
      var m = mems[i];
      var importance = m.importance != null ? Number(m.importance) : 0.7;
      if (m.expires_at) {
        var exp = new Date(m.expires_at).getTime();
        if (!isNaN(exp) && exp <= now) { pruneIds.add(m.id); result.expired++; continue; }
      }
      var created = new Date(m.created_at).getTime();
      if (isNaN(created)) continue;
      var ageDays = (now - created) / 864e5;
      var effective = importance * Math.pow(0.5, ageDays / MEM_DECAY_HALF_LIFE_DAYS);
      if (effective < MEM_PRUNE_EFFECTIVE_IMPORTANCE) { pruneIds.add(m.id); result.decayed++; }
    }
    var byCat = {};
    for (var j = 0; j < mems.length; j++) {
      var mm = mems[j];
      if (pruneIds.has(mm.id)) continue;
      var key = mm.category + "::" + String(mm.content || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!byCat[key]) byCat[key] = [];
      byCat[key].push(mm);
    }
    for (var k in byCat) {
      var group = byCat[k];
      if (group.length < 2) continue;
      group.sort(function(a, b) { return (Number(b.importance) || 0) - (Number(a.importance) || 0); });
      for (var g = 1; g < group.length; g++) {
        var dup = group[g];
        if (pruneIds.has(dup.id)) continue;
        pruneIds.add(dup.id); result.deduped++;
      }
    }
    if (commit && pruneIds.size) {
      var ids = Array.from(pruneIds);
      for (var c = 0; c < ids.length; c += 100) {
        var chunk = ids.slice(c, c + 100);
        var ph = chunk.map(function() { return "?"; }).join(",");
        await env.PERSONAL.prepare("DELETE FROM agent_memories WHERE id IN (" + ph + ")").bind.apply(null, chunk).run();
        await env.VZ.deleteByIds(chunk).catch(function(e) { console.error("[personal-maintain] VZ delete error:", e.message); });
      }
    }
    result.pruned = pruneIds.size;
    result.ids = Array.from(pruneIds).slice(0, 50);
    if (commit) {
      await env.PERSONAL.prepare("INSERT INTO memory_maintain_runs (run_id, plane, scanned, pruned, decayed, expired, deduped, notes, created_at) VALUES (?, 'personal', ?, ?, ?, ?, ?, ?, datetime('now'))").bind("memory-maintain-" + Date.now(), result.scanned, result.pruned, result.decayed, result.expired, result.deduped, JSON.stringify(result.ids)).run().catch(function(e) { console.error("[personal-maintain] run record error:", e.message); });
    }
  } catch (e) { result.error = e.message; }
  return result;
}
var personallifemaintainModDefault = {
  async fetch(request, env) {
    var url = new URL(request.url), p = url.pathname;
    if (p === "/health") return json({ status: "ok", worker: "personal-life-maintain", version: VERSION, plane: "personal", bindings: { d1: !!env.PERSONAL, vz: !!env.VZ }, cron: "0 2 * * *" });
    if (p === "/run/memory-maintain") {
      var q = url.searchParams;
      var commit = q.get("commit") === "1" || q.get("commit") === "true";
      var result = await runMemoryMaintain(env, { commit: commit });
      return json(result);
    }
    return json({ error: "not found" }, 404);
  },
  async scheduled(event, env, ctx) {
    console.log("[personal-life-maintain] cron:", event.cron);
    try { var r = await runMemoryMaintain(env, { commit: true }); console.log("[personal-life-maintain] done:", JSON.stringify({ scanned: r.scanned, pruned: r.pruned })); }
    catch (e) { console.error("[personal-life-maintain] error:", e.message); }
  }
};
return { default: personallifemaintainModDefault };
})();
var personallifesearchMod = (function(){
const QNFO_VERSION = "personal-life-search/fabric-20260910";
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// search.js
async function json(obj, cors = {}, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });
}
__name(json, "json");
function sanitize(s, max = 1500) {
  return String(s || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/[\uD800-\uDFFF]/g, "").trim().slice(0, max);
}
__name(sanitize, "sanitize");
async function sha16(s) {
  const data = new TextEncoder().encode(String(s));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest.slice(0, 16))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha16, "sha16");
async function embed(env, texts) {
  const resp = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: texts.slice(0, 32) }, { gateway: { id: "default" } });
  const vectors = resp && resp.data || [];
  return vectors.filter((v) => Array.isArray(v) && v.length === 768).map((v) => v.map((x) => Number.isFinite(x) ? x : 0));
}
__name(embed, "embed");
async function safeUpsert(env, batch) {
  if (batch.length === 0) return 0;
  try {
    await env.VZ.upsert(batch);
    return batch.length;
  } catch (e) {
    if (batch.length === 1) return 0;
    const mid = Math.ceil(batch.length / 2);
    const a = await safeUpsert(env, batch.slice(0, mid));
    const b = await safeUpsert(env, batch.slice(mid));
    return a + b;
  }
}
__name(safeUpsert, "safeUpsert");
var search_default = {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Index-Token, Authorization"
      };
      if (request.method === "OPTIONS") return new Response(null, { headers: cors, status: 204 });
      if (url.pathname === "/health") {
        return json({ ok: true, worker: "personal-life-search", index: "personal-life", version: "v1.2.3-env-secret" }, cors);
      }
      if (url.pathname === "/stats" && request.method === "GET") {
        const f = await env.PERSONAL.prepare("SELECT COUNT(*) as n FROM files").first();
        const p = await env.PERSONAL.prepare("SELECT COUNT(*) as n FROM profile").first();
        const e = await env.PERSONAL.prepare("SELECT COUNT(*) as n FROM events").first();
        const b = await env.PERSONAL.prepare("SELECT COUNT(*) as n FROM browse").first();
        const m = await env.PERSONAL.prepare("SELECT COUNT(*) as n FROM email_index").first();
        return json({ ok: true, filesIndexed: f && f.n || 0, profileFacets: p && p.n || 0, events: e && e.n || 0, browseUrls: b && b.n || 0, emailIndexed: m && m.n || 0 }, cors);
      }
      if (url.pathname === "/search") {
        const q = (url.searchParams.get("q") || "").trim();
        const topK = Number(url.searchParams.get("topK") || 20);
        if (!q) return json({ ok: false, error: "missing q" }, cors, 400);
        const [vector] = await embed(env, [q]);
        if (!vector) return json({ ok: false, error: "embed failed" }, cors, 500);
        const result = await env.VZ.query(vector, { topK, returnValues: false, returnMetadata: "all" });
        const byFile = /* @__PURE__ */ new Map();
        for (const hit of result.matches || []) {
          const m = hit.metadata || {};
          if (m.doc === "profile" || m.doc === "event" || m.doc === "browse") continue;
          const path = m.path || "unknown";
          if (!byFile.has(path)) byFile.set(path, []);
          byFile.get(path).push({ score: hit.score, text: m.text || "", chunk: m.chunk || 0, type: m.type || "", category: m.category || "", modified: m.modified || "" });
        }
        const files = [];
        for (const [path, hits] of byFile) {
          hits.sort((a, b) => b.score - a.score);
          files.push({ path, bestScore: hits[0].score, hits: hits.slice(0, 3), category: hits[0].category, type: hits[0].type, modified: hits[0].modified, snippet: hits[0].text });
        }
        files.sort((a, b) => b.bestScore - a.bestScore);
        return json({ ok: true, query: q, count: files.length, files }, cors);
      }
      if (url.pathname === "/profile" && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        const facet = url.searchParams.get("facet") || "";
        const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
        if (q) {
          const [vector] = await embed(env, [q]);
          if (!vector) return json({ ok: false, error: "embed failed" }, cors, 500);
          const result = await env.VZ.query(vector, { topK: 40, returnValues: false, returnMetadata: "all" });
          const matches = (result.matches || []).filter((h) => (h.metadata || {}).doc === "profile");
          const ids = matches.map((h) => (h.metadata || {}).id).filter(Boolean);
          const items = [];
          for (const id of ids.slice(0, 25)) {
            const row = await env.PERSONAL.prepare("SELECT id, facet, label, statement, evidence, confidence, updated_at FROM profile WHERE id = ?1").bind(id).first();
            if (row) items.push({ ...row, score: (matches.find((h) => (h.metadata || {}).id === id) || {}).score });
          }
          return json({ ok: true, query: q, count: items.length, facets: items }, cors);
        }
        const sql = facet ? `SELECT id, facet, label, statement, evidence, confidence, updated_at FROM profile WHERE facet = ?1 ORDER BY facet, id LIMIT ?2` : `SELECT id, facet, label, statement, evidence, confidence, updated_at FROM profile ORDER BY facet, id LIMIT ?1`;
        const rows = facet ? await env.PERSONAL.prepare(sql).bind(facet, limit).all() : await env.PERSONAL.prepare(sql).bind(limit).all();
        return json({ ok: true, count: rows.results.length, facets: rows.results }, cors);
      }
      if (url.pathname === "/events" && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        const category = url.searchParams.get("category") || "";
        const from = url.searchParams.get("from") || "";
        const to = url.searchParams.get("to") || "";
        const upcoming = url.searchParams.get("upcoming") || "";
        const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
        if (q) {
          const [vector] = await embed(env, [q]);
          if (!vector) return json({ ok: false, error: "embed failed" }, cors, 500);
          const result = await env.VZ.query(vector, { topK: 40, returnValues: false, returnMetadata: "all" });
          const matches = (result.matches || []).filter((h) => (h.metadata || {}).doc === "event");
          const ids = matches.map((h) => (h.metadata || {}).id).filter(Boolean);
          const items = [];
          for (const id of ids.slice(0, 25)) {
            const row = await env.PERSONAL.prepare("SELECT * FROM events WHERE id = ?1").bind(id).first();
            if (row) items.push({ ...row, score: (matches.find((h) => (h.metadata || {}).id === id) || {}).score });
          }
          return json({ ok: true, query: q, count: items.length, events: items }, cors);
        }
        const conds = [];
        const binds = [];
        if (category) {
          conds.push("category = ?1");
          binds.push(category);
        }
        if (from) {
          conds.push("COALESCE(start_date, '9999') >= ?" + (binds.length + 1));
          binds.push(from);
        }
        if (to) {
          conds.push("COALESCE(start_date, '') <= ?" + (binds.length + 1));
          binds.push(to);
        }
        if (upcoming) {
          conds.push("COALESCE(start_date, '9999') >= ?" + (binds.length + 1));
          binds.push((/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
        }
        const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
        const rows = await env.PERSONAL.prepare(`SELECT * FROM events ${where} ORDER BY COALESCE(start_date, '9999') ASC, ingested_at DESC LIMIT ?${binds.length + 1}`).bind(...binds, limit).all();
        return json({ ok: true, count: rows.results.length, events: rows.results }, cors);
      }
      if (url.pathname === "/browse" && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        const domain = url.searchParams.get("domain") || "";
        const days = Number(url.searchParams.get("days") || 0);
        const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
        const conds = [];
        const binds = [];
        if (q) {
          conds.push("(title LIKE ?1 OR url LIKE ?1 OR domain LIKE ?1)");
          binds.push(`%${q}%`);
        }
        if (domain) {
          conds.push("domain = ?" + (binds.length + 1));
          binds.push(domain);
        }
        if (days > 0) {
          const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
          conds.push("COALESCE(last_visit, '') >= ?" + (binds.length + 1));
          binds.push(cutoff);
        }
        const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
        const rows = await env.PERSONAL.prepare(`SELECT url, title, domain, visit_count, last_visit, first_visit FROM browse ${where} ORDER BY visit_count DESC LIMIT ?${binds.length + 1}`).bind(...binds, limit).all();
        return json({ ok: true, count: rows.results.length, browse: rows.results }, cors);
      }
      if (url.pathname === "/recommend" && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        const scope = url.searchParams.get("scope") || "all";
        const topK = Math.min(Number(url.searchParams.get("topK") || 15), 50);
        if (!q) return json({ ok: false, error: "missing q" }, cors, 400);
        const [vector] = await embed(env, [q]);
        if (!vector) return json({ ok: false, error: "embed failed" }, cors, 500);
        const want = /* @__PURE__ */ __name((s) => scope === "all" || scope === s, "want");
        const items = [];
        const scanK = Math.min(Math.max(topK * 3, 30), 40);
        const full = await env.VZ.query(vector, { topK: scanK, returnValues: false, returnMetadata: "all" });
        const typed = /* @__PURE__ */ __name((doc) => (full.matches || []).filter((h) => (h.metadata || {}).doc === doc), "typed");
        if (want("profile")) {
          for (const h of typed("profile")) {
            const id = (h.metadata || {}).id;
            if (!id) continue;
            const row = await env.PERSONAL.prepare("SELECT id, facet, label, statement, evidence FROM profile WHERE id = ?1").bind(id).first();
            if (row) items.push({ doc: "profile", id, score: h.score, facet: row.facet, label: row.label, statement: row.statement, evidence: row.evidence });
          }
        }
        if (want("events")) {
          for (const h of typed("event")) {
            const id = (h.metadata || {}).id;
            if (!id) continue;
            const row = await env.PERSONAL.prepare("SELECT * FROM events WHERE id = ?1").bind(id).first();
            if (row) items.push({ doc: "event", id, score: h.score, category: row.category, title: row.title, venue: row.venue, city: row.city, start_date: row.start_date, end_date: row.end_date, amount: row.amount, currency: row.currency, source: row.source, energy: row.energy, energy_label: row.energy_label });
          }
        }
        if (want("files")) {
          for (const h of full.matches || []) {
            const m = h.metadata || {};
            if (m.doc === "profile" || m.doc === "event" || m.doc === "browse") continue;
            items.push({ doc: "file", path: m.path, score: h.score, category: m.category, snippet: (m.text || "").slice(0, 400) });
          }
        }
        if (want("browse")) {
          for (const h of typed("browse")) {
            const m = h.metadata || {};
            items.push({ doc: "browse", url: m.url, title: m.title, domain: m.domain, visits: m.visit_count, last_visit: m.last_visit, score: h.score });
          }
        }
        items.sort((a, b) => b.score - a.score);
        return json({ ok: true, query: q, scope, count: items.length, items: items.slice(0, topK) }, cors);
      }
      if (url.pathname === "/activity" && request.method === "GET") {
        const days = Math.min(Number(url.searchParams.get("days") || 30), 365);
        const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
        const rows = await env.PERSONAL.prepare("SELECT date, title, category, venue, city, notes, energy, energy_label FROM activity WHERE date >= ?1 ORDER BY date DESC LIMIT 100").bind(from).all();
        return json({ ok: true, count: rows.results.length, activity: rows.results }, cors);
      }
      if (url.pathname === "/ingest" && request.method === "POST") {
        const token = request.headers.get("X-Index-Token") || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
        if (token !== env.INDEX_TOKEN) return json({ ok: false, error: "unauthorized \u2014 X-Index-Token required" }, cors, 401);
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: "invalid JSON body" }, cors, 400);
        }
        const items = Array.isArray(body.items) ? body.items : [];
        const counts = { profile: 0, event: 0, browse: 0, email: 0, activity: 0, vectors: 0, errors: 0 };
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const vbuf = [];
        const dbuf = [];
        for (const it of items.slice(0, 200)) {
          try {
            const doc = it.doc || "";
            if (doc === "profile") {
              const id = String(it.id || "").trim();
              const facet = sanitize(it.facet || "", 60);
              const label = sanitize(it.label || "", 120);
              const statement = sanitize(it.statement || "", 1500);
              if (!id || !facet || !statement) {
                counts.errors++;
                continue;
              }
              const evidence = sanitize(it.evidence || "", 800);
              const confidence = Number(it.confidence || 0.7);
              dbuf.push(env.PERSONAL.prepare(
                `INSERT INTO profile (id, facet, label, statement, evidence, confidence, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7)
                 ON CONFLICT(id) DO UPDATE SET facet=?2, label=?3, statement=?4, evidence=?5, confidence=?6, updated_at=?7`
              ).bind(id, facet, label, statement, evidence, confidence, now));
              const [vec] = await embed(env, [statement.slice(0, 1e3)]);
              if (vec) vbuf.push({ id: "p:" + await sha16(id), values: vec, metadata: { doc: "profile", id, facet, label, text: statement.slice(0, 800) } });
              counts.profile++;
            } else if (doc === "event") {
              const id = String(it.id || "").trim();
              const category = sanitize(it.category || "other", 40);
              const title = sanitize(it.title || "", 300);
              if (!id || !title) {
                counts.errors++;
                continue;
              }
              if (id.startsWith("evt-auto:")) {
                const sd = sanitize(it.start_date || "", 10);
                if (sd) {
                  const dup = await env.PERSONAL.prepare(
                    "SELECT id FROM events WHERE start_date = ?1 AND category = ?2 AND id NOT LIKE 'evt-auto:%' LIMIT 1"
                  ).bind(sd, category).first();
                  if (dup) {
                    counts.errors++;
                    continue;
                  }
                }
              }
              const venue = sanitize(it.venue || "", 200);
              const city = sanitize(it.city || "", 100);
              const country = sanitize(it.country || "", 80);
              const start_date = sanitize(it.start_date || "", 10);
              const end_date = sanitize(it.end_date || "", 10);
              const amount = Number(it.amount) || null;
              const currency = sanitize(it.currency || "", 8);
              const booking_ref = sanitize(it.booking_ref || "", 100);
              const source = sanitize(it.source || "", 300);
              const source_subject = sanitize(it.source_subject || "", 400);
              const energy = Number(it.energy) || null;
              const energy_label = sanitize(it.energy_label || "", 20);
              const notes = sanitize(it.notes || "", 800);
              dbuf.push(env.PERSONAL.prepare(
                `INSERT INTO events (id, category, title, venue, city, country, start_date, end_date, amount, currency, booking_ref, source, source_subject, energy, energy_label, notes, ingested_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
                 ON CONFLICT(id) DO UPDATE SET category=?2, title=?3, venue=?4, city=?5, country=?6, start_date=?7, end_date=?8, amount=?9, currency=?10, booking_ref=?11, source=?12, source_subject=?13, energy=?14, energy_label=?15, notes=?16, ingested_at=?17`
              ).bind(id, category, title, venue, city, country, start_date, end_date, amount, currency, booking_ref, source, source_subject, energy, energy_label, notes, now));
              const emb = `${title} | ${category} | ${venue} | ${city} | ${country} | ${notes}`.slice(0, 1e3);
              const [vec] = await embed(env, [emb]);
              if (vec) vbuf.push({ id: "e:" + await sha16(id), values: vec, metadata: { doc: "event", id, category, title, start_date, venue, city, text: emb.slice(0, 800) } });
              counts.event++;
            } else if (doc === "browse") {
              const burl = String(it.url || "").trim();
              if (!burl) {
                counts.errors++;
                continue;
              }
              const title = sanitize(it.title || "", 300);
              const domain = sanitize(it.domain || "", 120);
              const visit_count = Number(it.visit_count || 0);
              const last_visit = sanitize(it.last_visit || "", 40);
              const first_visit = sanitize(it.first_visit || "", 40);
              dbuf.push(env.PERSONAL.prepare(
                `INSERT INTO browse (url, title, domain, visit_count, last_visit, first_visit, indexed_at) VALUES (?1,?2,?3,?4,?5,?6,?7)
                 ON CONFLICT(url) DO UPDATE SET title=?2, domain=?3, visit_count=?4, last_visit=?5, first_visit=?6, indexed_at=?7`
              ).bind(burl, title, domain, visit_count, last_visit, first_visit, now));
              if (visit_count >= 20) {
                const [vec] = await embed(env, [`${title} | ${domain}`.slice(0, 900)]);
                if (vec) vbuf.push({ id: "b:" + await sha16(burl), values: vec, metadata: { doc: "browse", url: burl.slice(0, 500), title: title.slice(0, 300), domain, visit_count, last_visit } });
              }
              counts.browse++;
            } else if (doc === "email") {
              const message_id = String(it.message_id || "").trim();
              if (!message_id) {
                counts.errors++;
                continue;
              }
              const store = sanitize(it.store || "", 100);
              const folder = sanitize(it.folder || "", 100);
              const sender = sanitize(it.sender || "", 200);
              const subject = sanitize(it.subject || "", 400);
              const received_at = sanitize(it.received_at || "", 40);
              const category = sanitize(it.category || "", 40);
              const event_id = sanitize(it.event_id || "", 120);
              const summary = sanitize(it.summary || "", 800);
              dbuf.push(env.PERSONAL.prepare(
                `INSERT INTO email_index (message_id, store, folder, sender, subject, received_at, category, event_id, summary, ingested_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
                 ON CONFLICT(message_id) DO UPDATE SET store=?2, folder=?3, sender=?4, subject=?5, received_at=?6, category=?7, event_id=?8, summary=?9, ingested_at=?10`
              ).bind(message_id, store, folder, sender, subject, received_at, category, event_id, summary, now));
              const [vec] = await embed(env, [`${subject} | ${sender} | ${summary}`.slice(0, 900)]);
              if (vec) vbuf.push({ id: "em:" + await sha16(message_id), values: vec, metadata: { doc: "email", message_id, subject: subject.slice(0, 300), sender: sender.slice(0, 150), received_at, category, text: `${subject} | ${sender} | ${summary}`.slice(0, 800) } });
              counts.email++;
            } else if (doc === "activity") {
              const adate = sanitize(it.date || "", 10);
              const atitle = sanitize(it.title || "", 300);
              if (!adate || !atitle) {
                counts.errors++;
                continue;
              }
              const venue = sanitize(it.venue || "", 200);
              const city = sanitize(it.city || "", 100);
              const notes = sanitize(it.notes || "", 800);
              const category = sanitize(it.category || "other", 40);
              const energy = Number(it.energy) || null;
              const energy_label = sanitize(it.energy_label || "", 20);
              await env.PERSONAL.prepare("CREATE TABLE IF NOT EXISTS activity (date TEXT, title TEXT, category TEXT, venue TEXT, city TEXT, notes TEXT, energy REAL, energy_label TEXT, ingested_at TEXT, PRIMARY KEY(date, title))").run();
              dbuf.push(env.PERSONAL.prepare("INSERT INTO activity (date, title, category, venue, city, notes, energy, energy_label, ingested_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(date, title) DO UPDATE SET category=?3, venue=?4, city=?5, notes=?6, energy=?7, energy_label=?8, ingested_at=?9").bind(adate, atitle, category, venue, city, notes, energy, energy_label, now));
              const [vec] = await embed(env, [(atitle + " | " + category + " | " + venue + " | " + notes).slice(0, 900)]);
              if (vec) vbuf.push({ id: "act:" + await sha16(adate + atitle), values: vec, metadata: { doc: "activity", date: adate, title: atitle, category: category, venue: venue, text: (atitle + " - " + notes).slice(0, 800) } });
              counts.activity++;
            } else {
              counts.errors++;
            }
          } catch (e) {
            counts.errors++;
          }
        }
        if (dbuf.length) {
          try {
            await env.PERSONAL.batch(dbuf);
          } catch (e) {
            counts.errors += dbuf.length;
          }
        }
        counts.vectors = await safeUpsert(env, vbuf);
        return json({ ok: true, ...counts }, cors);
      }
      return json({ ok: false, error: "not found" }, cors, 404);
    } catch (e) {
      return json({ ok: false, error: "EXCEPTION: " + (e && e.message || String(e)), stack: (e && e.stack || "").slice(0, 800) }, {}, 500);
    }
  }
};
return { default: search_default };
})();

// ===== MERGE companion-hub =====
export default {
  async fetch(request, env, ctx) {
    const p = new URL(request.url).pathname;
    if (p === "/health") return new Response(JSON.stringify({ ok: true, worker: "companion-hub", version: "1.0.0", members: 4 }), { headers: { "content-type": "application/json" } });
    if (p === "/personal-companion" || p.startsWith("/personal-companion/")) { const u = new URL(request.url); u.pathname = p.slice(19) || "/"; return personalcompanionMod.default.fetch(new Request(u.toString(), request), env, ctx); }
    if (p === "/personal-life-indexer" || p.startsWith("/personal-life-indexer/")) { const u = new URL(request.url); u.pathname = p.slice(22) || "/"; return personallifeindexerMod.default.fetch(new Request(u.toString(), request), env, ctx); }
    if (p === "/personal-life-maintain" || p.startsWith("/personal-life-maintain/")) { const u = new URL(request.url); u.pathname = p.slice(23) || "/"; return personallifemaintainMod.default.fetch(new Request(u.toString(), request), env, ctx); }
    if (p === "/personal-life-search" || p.startsWith("/personal-life-search/")) { const u = new URL(request.url); u.pathname = p.slice(21) || "/"; return personallifesearchMod.default.fetch(new Request(u.toString(), request), env, ctx); }
    return new Response("companion-hub", { status: 200 });
  },
  async scheduled(event, env, ctx) {
    const c = event.cron;
    if (c === "0 6 * * *") return personalcompanionMod.default.scheduled(event, env, ctx);
    if (c === "0 */12 * * *") return personallifeindexerMod.default.scheduled(event, env, ctx);
    if (c === "0 2 * * *") return personallifemaintainMod.default.scheduled(event, env, ctx);
  },
};