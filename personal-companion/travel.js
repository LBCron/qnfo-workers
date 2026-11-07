// personal-companion/travel.js
// TRAVEL-PLANNER-1 (2026-10-19, charter pillar: personal). The owner likes travelling and dislikes planning it. This module
// does the planning server-side, on the companion's hourly tick, from data the fleet already holds:
//   * personal-life.events (category lodging/travel), written by qnfo-email ITINERARY-INGEST-1 from booking confirmations;
//   * personal-life.profile rows with facet travel/likes/dislikes/logistics (the owner's preferences; never in this repo);
//   * travel_reactions, the append-only ledger of what the owner picked, rejected or booked.
// Design rules (each is a test in travel.test.mjs):
//   1. No questionnaire. The module never asks a preference question; it proposes 2-3 concrete options with one pick
//      marked and learns from the reaction (pick, not for me, or a later booking that lands in events).
//   2. Nothing is booked or paid. A pick records the choice and hands back a booking search link; the owner books.
//   3. Links that change state are signed (HMAC-SHA256 of the option id) and change state only on POST, so a mail
//      scanner that follows a GET link cannot pick or reject anything. No signing key set means no state-changing links.
//   4. One proposal per trip key (city + check-in date), ever; a tick is idempotent and safe to run every hour.
//   5. A model failure proposes nothing (two models, then nothing, retried next tick); options are never invented
//      without a model, and every option carries a real search link rather than a made-up listing.
//   6. No personal data in this file: home city and limits are travel_config rows with neutral defaults.

export const DDL = [
  `CREATE TABLE IF NOT EXISTS travel_options (
     id TEXT PRIMARY KEY,
     trip_key TEXT NOT NULL,
     rank INTEGER NOT NULL,
     pick INTEGER NOT NULL DEFAULT 0,
     mode TEXT NOT NULL,
     city TEXT NOT NULL,
     country TEXT,
     kind TEXT,
     checkin TEXT NOT NULL,
     nights INTEGER NOT NULL,
     est_per_night REAL,
     currency TEXT,
     why TEXT,
     link TEXT NOT NULL,
     model TEXT,
     status TEXT NOT NULL DEFAULT 'proposed',
     created_at TEXT NOT NULL,
     decided_at TEXT,
     UNIQUE (trip_key, rank)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_travel_options_status ON travel_options(status, checkin)`,
  `CREATE TABLE IF NOT EXISTS travel_reactions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     option_id TEXT,
     trip_key TEXT,
     reaction TEXT NOT NULL CHECK (reaction IN ('pick','no','booked','expired')),
     city TEXT,
     kind TEXT,
     ts TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS travel_notices (
     kind TEXT NOT NULL,
     ref TEXT NOT NULL,
     sent_at TEXT NOT NULL,
     PRIMARY KEY (kind, ref)
   )`,
  `CREATE TABLE IF NOT EXISTS travel_config (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  // TRAVEL-CHAT-1: the conversation, and a signing secret kept out of travel_config (which /api/travel returns).
  `CREATE TABLE IF NOT EXISTS travel_chat (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     role TEXT NOT NULL CHECK (role IN ('user','assistant')),
     content TEXT NOT NULL,
     meta TEXT,
     ts TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS travel_logins (
     id TEXT PRIMARY KEY,
     code_mac TEXT NOT NULL,
     exp INTEGER NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     used INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS travel_secrets (
     k TEXT PRIMARY KEY,
     v TEXT NOT NULL
   )`,
  // TRAVEL-TRIP-1: the planned stops (end_date = the day the party leaves), visa limits, and cached weather by request URL.
  `CREATE TABLE IF NOT EXISTS travel_stops (
     id TEXT PRIMARY KEY,
     trip TEXT NOT NULL DEFAULT 'next',
     city TEXT NOT NULL,
     country TEXT,
     lat REAL,
     lon REAL,
     start_date TEXT NOT NULL,
     end_date TEXT NOT NULL,
     note TEXT,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS travel_permits (
     id TEXT PRIMARY KEY,
     person TEXT NOT NULL,
     country TEXT NOT NULL,
     entry_date TEXT NOT NULL,
     max_days INTEGER NOT NULL,
     year_cap INTEGER,
     note TEXT,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS travel_weather (
     url TEXT PRIMARY KEY,
     data TEXT NOT NULL,
     fetched_at TEXT NOT NULL
   )`,
  // TRAVEL-PICKS-1: three places to eat and three things to do per stop, kept for the city they were made for.
  `CREATE TABLE IF NOT EXISTS travel_picks (
     id TEXT PRIMARY KEY,
     stop_id TEXT NOT NULL,
     city TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('eat','do')),
     rank INTEGER NOT NULL,
     name TEXT NOT NULL,
     area TEXT,
     why TEXT,
     model TEXT,
     status TEXT NOT NULL DEFAULT 'open',
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_travel_picks_stop ON travel_picks(stop_id, status)`
];

// Seeded once with INSERT OR IGNORE; a row the owner edits always wins.
export const DEFAULTS = {
  enabled: "on",            // off stops proposals and notices, not the routes
  home_city: "Amsterdam",
  home_country: "NL",
  home_airports: "AMS,EIN,RTM", // a travel row titled "... to <one of these>" right after a stay means the trip ends
  lead_days: "3",           // propose when the next unbooked night is this close (the owner books late)
  nights: "2",              // default stay length per stop
  adults: "1",              // party size for stay searches (TRAVEL-CONTEXT-1); the owner's row says who travels
  max_per_night: "100",     // search filter ceiling
  currency: "EUR",
  ideas_weekday: "0",       // 0 = Sunday: weekly "where next" ideas while nothing is booked; "-1" turns them off
  mail_from_hour: "7",      // local hours (tz below) in which mail may go out
  mail_to_hour: "21",
  tz: "Europe/Amsterdam",
  // TRAVEL-CHAT-1: chat models in order of preference (any Workers AI text model; first one that answers wins). The page's
  // model menu rewrites this row; a row edited in D1 wins too.
  chat_models: "@cf/openai/gpt-oss-120b,@cf/zai-org/glm-5.3,@cf/moonshotai/kimi-k2.6",
  // Cloudflare Access: when both are set, a valid Cf-Access-Jwt-Assertion for this team and audience signs the owner in.
  access_team: "",
  access_aud: "",
  // TRAVEL-TRIP-1: arrival wording in early check-in drafts, and the inbound address that turns a forwarded confirmation
  // into a booking (qnfo-email ITINERARY-INGEST-1); empty hides the hint.
  checkin_arrival: "around midday",
  forward_to: ""
};

export const MODELS = ["@cf/zai-org/glm-5.3-flash", "@cf/openai/gpt-oss-20b"];
// Profile text handed to a model, travel facet first. 4000 cut the travel facet itself once it grew past ~6k characters
// (TRAVEL-CONTEXT-1, 2026-10-19: budget, stay type, trip style and home base were dropped); 12000 is ~3k tokens.
export const PROFILE_CHARS = 12000;
export const BASE = "https://reading.q08.org";
export const PLANNER_URL = "https://travel.q08.org/travel";

// TRAVEL-ENSURE-ONCE-1 (agent_issues 1000678): the schema and default rows are written once per isolate and database handle, not on every request.
// Every GET of travel.q08.org ran every CREATE and every default INSERT in sequence against the D1 primary; when those writes queued behind the hourly
// tick the sign-in page answered in 5.3 to 6.0 s (9 of 38 hourly samples, all status 401, over the SLI's 5 s limit).
// TRAVEL-ENSURE-BATCH-1 (agent_issues 1000678, second step): the memo alone did not help the hourly availability probe, which always meets a fresh isolate: samples after the
// 1.44.2 deploy still read 4.8 s (a runner in the US, the D1 primary in Western Europe, about 30 statements one after the other, one round trip each). The statements now go in one
// db.batch call (one round trip; the sequential loop stays for a handle without batch), and the request path (handleTravel) first asks one read whether the tables exist and writes
// nothing when they do: the hourly tick (travelTick) still runs the full ensure, so a new column or table in DDL reaches the database within the hour.
const ENSURED_DBS = new WeakSet();
const TRAVEL_TABLES = DDL.map((s) => (/CREATE TABLE IF NOT EXISTS (\w+)/.exec(s) || [])[1]).filter(Boolean);

export async function ensureTravel(db, nowIso) {
  if (db && typeof db === "object" && ENSURED_DBS.has(db)) return;
  const ts = nowIso || new Date().toISOString();
  const stmts = DDL.map((s) => db.prepare(s)).concat(Object.entries(DEFAULTS).map(([k, v]) => db.prepare("INSERT INTO travel_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING").bind(k, v, ts)));
  if (typeof db.batch === "function") await db.batch(stmts);
  else for (const s of stmts) await s.run();
  if (db && typeof db === "object") ENSURED_DBS.add(db);
}

// The request path: one read, no write when the tables are there.
export async function ensureTravelCheap(db) {
  if (db && typeof db === "object" && ENSURED_DBS.has(db)) return;
  let have = 0;
  try {
    const r = await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN (" + TRAVEL_TABLES.map(() => "?").join(",") + ")").bind(...TRAVEL_TABLES).first();
    have = Number((r && r.n) || 0);
  } catch (e) { have = 0; }
  if (have >= TRAVEL_TABLES.length) { if (db && typeof db === "object") ENSURED_DBS.add(db); return; }
  await ensureTravel(db);
}

export async function cfg(db) {
  const out = { ...DEFAULTS };
  const r = await db.prepare("SELECT key, value FROM travel_config").all();
  for (const row of r.results || []) out[row.key] = row.value;
  return out;
}

export function addDays(iso, n) {
  const d = new Date(String(iso).slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function localParts(nowMs, tz) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
  const p = {};
  for (const x of f.formatToParts(new Date(nowMs))) p[x.type] = x.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { day: p.year + "-" + p.month + "-" + p.day, hour: Number(p.hour), weekday: wd };
}

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

// Where the owner is in a trip, from lodging and travel rows (ISO dates; lodging end_date is the check-out day).
// road: the latest lodging ends within lead_days of today (or is current), no later lodging covers that night, and no
//       travel row on or after it returns home. checkin = that check-out day.
// home: anything else. future_booked says whether any lodging starts after today.
export function tripState(rows, today, c) {
  const home = norm(c.home_city);
  const lead = Number(c.lead_days) || 3;
  const lodging = (rows || []).filter((r) => r.category === "lodging" && /^\d{4}-\d{2}-\d{2}$/.test(String(r.start_date || "")) && /^\d{4}-\d{2}-\d{2}$/.test(String(r.end_date || "")))
    .sort((a, b) => (a.end_date < b.end_date ? -1 : a.end_date > b.end_date ? 1 : 0));
  const travel = (rows || []).filter((r) => r.category === "travel" && /^\d{4}-\d{2}-\d{2}$/.test(String(r.start_date || "")));
  const recent = lodging.filter((r) => r.end_date >= addDays(today, -60)).map((r) => r.city).filter(Boolean);
  const futureBooked = lodging.some((r) => r.start_date > today);
  const current = lodging.filter((r) => r.end_date >= today);
  // the earliest check-out on or after today that no other lodging continues from
  let gap = null;
  for (const r of current) {
    const continued = lodging.some((o) => o !== r && o.start_date <= r.end_date && o.end_date > r.end_date);
    if (!continued) { gap = r; break; }
  }
  if (gap && gap.start_date <= addDays(today, lead) && gap.end_date <= addDays(today, lead)) {
    // A flight row's city is sometimes the origin (eSky) and sometimes the destination, so the title's "to <X>" decides too.
    const dests = [home].concat(String(c.home_airports || "").split(",").map(norm)).filter(Boolean).map((s) => s.replace(/[^a-z0-9 ]/g, ""));
    const toHome = new RegExp("\\bto\\s+(" + dests.join("|") + ")\\b", "i");
    const goesHome = travel.some((t) => t.start_date >= gap.end_date && t.start_date <= addDays(gap.end_date, 1) &&
      ((norm(t.city) === home && norm(t.city) !== norm(gap.city)) || toHome.test(norm(t.title))));
    const awayFromHome = norm(gap.city) !== home;
    if (!goesHome && awayFromHome) {
      return { mode: "road", city: gap.city, country: gap.country || "", checkin: gap.end_date, recent, futureBooked };
    }
  }
  return { mode: "home", city: c.home_city, country: c.home_country, checkin: null, recent, futureBooked };
}

export function bookingLink({ city, country, checkin, nights, maxPerNight, currency, adults }) {
  const q = new URLSearchParams({
    ss: [city, country].filter(Boolean).join(", "),
    checkin: checkin,
    checkout: addDays(checkin, Math.max(1, Number(nights) || 1)),
    group_adults: String(Math.min(8, Math.max(1, Math.round(Number(adults) || 1)))),
    no_rooms: "1",
    group_children: "0",
    selected_currency: currency || "EUR",
    order: "review_score_and_price"
  });
  const max = Number(maxPerNight);
  if (max > 0) q.set("nflt", "price=" + (currency || "EUR") + "-min-" + Math.round(max) + "-1");
  return "https://www.booking.com/searchresults.html?" + q.toString();
}

export function transitLink(from, to) {
  const q = new URLSearchParams({ api: "1", origin: from, destination: to, travelmode: "transit" });
  return "https://www.google.com/maps/dir/?" + q.toString();
}

// Model output -> at most 3 clean options. Accepts a bare JSON array, {options:[...]}, or JSON inside prose/fences.
export function parseOptions(text) {
  const s = String(text || "");
  let j = null;
  const tries = [s, (s.match(/```(?:json)?\s*([\s\S]*?)```/) || [])[1], (s.match(/\{[\s\S]*\}/) || [])[0], (s.match(/\[[\s\S]*\]/) || [])[0]];
  for (const t of tries) { if (!t) continue; try { j = JSON.parse(t); break; } catch (e) { /* next shape */ } }
  const arr = Array.isArray(j) ? j : (j && Array.isArray(j.options) ? j.options : []);
  const out = [];
  const seen = new Set();
  for (const o of arr) {
    if (!o || typeof o !== "object") continue;
    const city = String(o.city || "").replace(/[\r\n<>]/g, " ").trim().slice(0, 60);
    if (!city || seen.has(norm(city))) continue;
    seen.add(norm(city));
    const nights = Math.min(7, Math.max(1, Math.round(Number(o.nights) || 0) || 0));
    const est = Number(o.est_per_night);
    out.push({
      city,
      country: String(o.country || "").replace(/[\r\n<>]/g, " ").trim().slice(0, 40),
      kind: String(o.kind || "").replace(/[\r\n<>]/g, " ").trim().slice(0, 40).toLowerCase(),
      nights: nights || null,
      est_per_night: Number.isFinite(est) && est > 0 && est < 5000 ? Math.round(est) : null,
      why: String(o.why || "").replace(/[\r\n<>]+/g, " ").trim().slice(0, 240)
    });
  }
  return out.slice(0, 3);
}

// Drop what the owner rejected or just stayed in, keep at most 3, and mark one pick: the first option whose kind the owner
// picked or booked most often, else the model's first.
export function rankAndMark(opts, reactions, state) {
  const no = new Set((reactions || []).filter((r) => r.reaction === "no").map((r) => norm(r.city)));
  const recent = new Set((state && state.recent || []).map(norm));
  const here = norm(state && state.city);
  const kept = (opts || []).filter((o) => !no.has(norm(o.city)) && !recent.has(norm(o.city)) && norm(o.city) !== here).slice(0, 3);
  const score = {};
  for (const r of reactions || []) if (r.kind && (r.reaction === "pick" || r.reaction === "booked")) score[r.kind] = (score[r.kind] || 0) + (r.reaction === "booked" ? 2 : 1);
  let best = 0, bestScore = 0;
  kept.forEach((o, i) => { const sc = score[o.kind] || 0; if (sc > bestScore) { best = i; bestScore = sc; } });
  return kept.map((o, i) => ({ ...o, pick: i === best ? 1 : 0 }));
}

export function promptFor(state, c, profileRows, reactions, monthName) {
  const facts = (profileRows || []).map((r) => "- " + String(r.label || "") + ": " + String(r.statement || "")).join("\n").slice(0, PROFILE_CHARS);
  const picked = (reactions || []).filter((r) => r.reaction === "pick" || r.reaction === "booked").slice(0, 10).map((r) => r.city + (r.kind ? " (" + r.kind + ")" : "")).join(", ");
  const rejected = (reactions || []).filter((r) => r.reaction === "no").slice(0, 15).map((r) => r.city).join(", ");
  const task = state.mode === "road"
    ? "The traveller checks out of " + state.city + (state.country ? ", " + state.country : "") + " on " + state.checkin + " and has nothing booked after that. Propose exactly 3 next stops reachable by train, bus or a short flight, each for " + c.nights + " nights or a length you justify."
    : "The traveller is home in " + c.home_city + " with nothing booked. Propose exactly 3 trips that could start within the next three weeks, each a first stop of " + c.nights + "-3 nights.";
  return [
    { role: "system", content: "You plan travel for one traveller who loves travel and hates planning; they sometimes travel with a companion (the profile says who and how). You never ask questions. Reply with JSON only: {\"options\":[{\"city\":\"\",\"country\":\"\",\"kind\":\"old town|coast|second city|nature|capital\",\"nights\":2,\"est_per_night\":0,\"why\":\"one sentence in plain English\"}]}. Respect every logistics fact (visas, residence rules) in the profile." },
    { role: "user", content: [
      task,
      "Month: " + monthName + ". Typical lodging budget: up to " + c.max_per_night + " " + c.currency + " per night.",
      "Profile:\n" + (facts || "- (no stored preferences yet)"),
      "Stayed recently (do not repeat): " + ((state.recent || []).join(", ") || "none"),
      "Picked or booked before: " + (picked || "none"),
      "Rejected (never propose): " + (rejected || "none")
    ].join("\n\n") }
  ];
}

export function modelText(r) {
  if (r == null) return "";
  if (typeof r === "string") return r;
  if (typeof r.response === "string") return r.response;
  if (r.response && typeof r.response === "object") return JSON.stringify(r.response);
  const ch = r.choices && r.choices[0];
  if (ch && ch.message && typeof ch.message.content === "string") return ch.message.content;
  return "";
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => { const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/"); const b = atob(t + "===".slice((t.length + 3) % 4)); return Uint8Array.from(b, (ch) => ch.charCodeAt(0)); };

export async function sign(secret, id) {
  return b64u(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode("travel:" + id)));
}
// crypto.subtle.verify compares in constant time.
export async function verify(secret, id, sig) {
  if (!secret || !sig) return false;
  try { return await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64u(sig), new TextEncoder().encode("travel:" + id)); }
  catch (e) { return false; }
}

export function signingKey(env) { return env.TRAVEL_KEY || env.WELLBEING_TOKEN || env.COMPANION_KEY || ""; }

export function optionId() {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return "tr_" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function mailFor(state, opts, links, c) {
  const head = state.mode === "road"
    ? "You check out of " + state.city + " on " + state.checkin + " and nothing is booked after that. Three next stops; my pick is marked."
    : "Nothing is booked yet. Three ideas for a next trip; my pick is marked.";
  const lines = [head, ""];
  opts.forEach((o, i) => {
    const l = links[i];
    lines.push((o.pick ? "★ " : "  ") + (i + 1) + ". " + o.city + (o.country ? ", " + o.country : "") + " · " + o.nights + " night" + (o.nights === 1 ? "" : "s") + (o.kind ? " · " + o.kind : "") + (o.est_per_night ? " · about " + o.est_per_night + " " + c.currency + "/night" : ""));
    if (o.why) lines.push("   " + o.why);
    lines.push("   Stays: " + o.link);
    if (state.mode === "road") lines.push("   Getting there: " + transitLink(state.city, o.city + (o.country ? ", " + o.country : "")));
    if (l) lines.push("   Choose or skip: " + l);
    lines.push("");
  });
  lines.push("Nothing is booked for you. Choosing one records it and keeps the search link ready; skipping one means I won't suggest that place again.");
  const pick = opts.find((o) => o.pick) || opts[0];
  return { subject: (state.mode === "road" ? "Next stop after " + state.city + ": " : "Where next: ") + pick.city + " is my pick", body: lines.join("\n") };
}

async function many(db, sql, ...a) { const r = await db.prepare(sql).bind(...a).all(); return r.results || []; }

// Record bookings that match an open proposal (strongest signal) and close proposals whose night is now covered or past.
export async function reconcile(db, rows, today, nowIso) {
  const open = await many(db, "SELECT id, trip_key, city, kind, checkin FROM travel_options WHERE status IN ('proposed','picked')");
  const lodging = (rows || []).filter((r) => r.category === "lodging");
  let booked = 0, expired = 0;
  const done = new Set();
  for (const o of open) {
    if (done.has(o.trip_key)) continue;
    const covering = lodging.filter((r) => r.start_date <= o.checkin && r.end_date > o.checkin);
    if (covering.length) {
      const won = open.find((x) => x.trip_key === o.trip_key && covering.some((r) => norm(r.city) === norm(x.city)));
      await db.prepare("UPDATE travel_options SET status = CASE WHEN id = ? THEN 'booked' ELSE 'superseded' END, decided_at = ? WHERE trip_key = ? AND status IN ('proposed','picked')").bind(won ? won.id : "", nowIso, o.trip_key).run();
      if (won) {
        await db.prepare("INSERT INTO travel_reactions (option_id, trip_key, reaction, city, kind, ts) VALUES (?, ?, 'booked', ?, ?, ?)").bind(won.id, o.trip_key, won.city, won.kind || null, nowIso).run();
        booked++;
      }
      done.add(o.trip_key);
    } else if (o.checkin < today) {
      await db.prepare("UPDATE travel_options SET status = 'expired', decided_at = ? WHERE trip_key = ? AND status IN ('proposed','picked')").bind(nowIso, o.trip_key).run();
      done.add(o.trip_key);
      expired++;
    }
  }
  return { booked, expired };
}

// One hourly step. deps: { now (ms), ai(model, input) -> result (required for proposals), send(subject, body) -> {ok}, key }
export async function travelTick(env, deps = {}) {
  const db = env.PERSONAL;
  if (!db) return { skipped: "no PERSONAL binding" };
  const nowMs = deps.now || Date.now();
  const nowIso = new Date(nowMs).toISOString();
  await ensureTravel(db, nowIso);
  const c = await cfg(db);
  const lp = localParts(nowMs, c.tz);
  const today = lp.day;
  const rows = await many(db, "SELECT id, category, title, city, country, start_date, end_date, booking_ref FROM events WHERE category IN ('lodging','travel') AND (end_date >= ? OR start_date >= ?)", addDays(today, -60), addDays(today, -60));
  const rec = await reconcile(db, rows, today, nowIso);
  const out = { mode: null, proposed: 0, notices: 0, ...rec };
  if (c.enabled !== "on" && !deps.force) { out.skipped = "travel_config enabled = " + c.enabled; return out; }
  const inHours = lp.hour >= Number(c.mail_from_hour) && lp.hour < Number(c.mail_to_hour);
  if (!inHours && !deps.force) { out.skipped = "outside mail hours"; return out; }
  const send = deps.send || (async () => ({ ok: false, error: "no sender" }));

  // Day-before note for a stay starting tomorrow: an early check-in request ready to paste to the host.
  for (const ev of rows.filter((r) => r.category === "lodging" && r.start_date === addDays(today, 1))) {
    const seen = await db.prepare("SELECT 1 FROM travel_notices WHERE kind = 'checkin' AND ref = ?").bind(ev.id).first();
    if (seen) continue;
    const r = deps.dry ? { ok: true } : await send("Tomorrow: " + (ev.title || ev.city) + " - early check-in note", "Your stay starts tomorrow. A message for the host, ready to paste in the booking app (nothing was sent to them):\n\n" + checkinDraft(ev, c));
    if (r && r.ok && !deps.dry) await db.prepare("INSERT OR IGNORE INTO travel_notices (kind, ref, sent_at) VALUES ('checkin', ?, ?)").bind(ev.id, nowIso).run();
    if (r && r.ok) out.notices++;
  }

  // TRAVEL-TRIP-1: a visa limit the plan breaks or nearly breaks is mailed once per status and planned exit.
  try {
    const trip = await tripRows(db, today);
    const allStops = await many(db, "SELECT city, country, start_date, end_date FROM travel_stops");
    for (const v of visaStatus(trip.permits, allStops, today)) {
      if (v.status !== "warn" && v.status !== "over") continue;
      if (v.exit && v.exit < today) continue;
      const ref = v.id + ":" + v.status + ":" + v.exit;
      const seen = await db.prepare("SELECT 1 FROM travel_notices WHERE kind = 'visa' AND ref = ?").bind(ref).first();
      if (seen) continue;
      const r = deps.dry ? { ok: true } : await send((v.status === "over" ? "Visa: the plan overstays " : "Visa: close to the limit in ") + v.name, v.text + "\n\nThe trip plan and its day counter: " + PLANNER_URL);
      if (r && r.ok && !deps.dry) await db.prepare("INSERT OR IGNORE INTO travel_notices (kind, ref, sent_at) VALUES ('visa', ?, ?)").bind(ref, nowIso).run();
      if (r && r.ok) out.notices++;
    }
  } catch (e) { console.error(JSON.stringify({ evt: "travel-trip:visa-check-failed", error: String(e && e.message || e).slice(0, 200) })); }

  // TRAVEL-PICKS-1: one upcoming stop per tick gets its eat and do picks, so the Places tab is filled before the owner asks.
  if (!deps.dry) {
    try {
      const due = await picksDue(db, today);
      if (due) { const r = await makePicks(db, deps, c, due, nowIso); out.picks = r.ok ? due.city : "failed: " + r.error; }
    } catch (e) { console.error(JSON.stringify({ evt: "travel-picks:tick-failed", error: String(e && e.message || e).slice(0, 200) })); }
  }

  const state = tripState(rows, today, c);
  out.mode = state.mode;
  let tripKey, checkin;
  if (state.mode === "road") { checkin = state.checkin; tripKey = "road:" + norm(state.city) + ":" + checkin; }
  else {
    const wd = Number(c.ideas_weekday);
    if (state.futureBooked || wd < 0 || (lp.weekday !== wd && !deps.force)) { out.skipped = state.futureBooked ? "trip already booked" : "not the ideas day"; return out; }
    checkin = addDays(today, 7);
    tripKey = "ideas:" + today;
  }
  const exists = await db.prepare("SELECT 1 FROM travel_options WHERE trip_key = ? LIMIT 1").bind(tripKey).first();
  if (exists) { out.skipped = "already proposed " + tripKey; return out; }

  const profile = await many(db, "SELECT label, statement FROM profile WHERE facet IN ('travel','likes','dislikes','logistics') AND (domain IS NULL OR domain IN ('personal','straddle')) AND (status IS NULL OR status IN ('accepted','active')) ORDER BY CASE facet WHEN 'travel' THEN 0 ELSE 1 END, confidence DESC LIMIT 80");
  const reactions = await many(db, "SELECT reaction, city, kind FROM travel_reactions WHERE ts >= ? AND (kind IS NULL OR kind NOT IN ('eat','do')) ORDER BY ts DESC LIMIT 60", addDays(today, -365));
  const month = new Date(checkin + "T12:00:00Z").toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  const messages = promptFor(state, c, profile, reactions, month);
  let opts = [], model = null;
  // the caller passes its attributed model runner (aiRunAttr in worker.js); this module never calls the AI binding itself
  if (typeof deps.ai !== "function") { out.skipped = "no model caller"; return out; }
  for (const m of MODELS) {
    try {
      const r = await deps.ai(m, { messages, max_tokens: 900, temperature: 0.6 });
      opts = rankAndMark(parseOptions(modelText(r)), reactions, state);
      if (opts.length >= 2) { model = m; break; }
    } catch (e) { console.error(JSON.stringify({ evt: "travel:model-failed", model: m, error: String(e && e.message || e).slice(0, 200) })); }
  }
  if (opts.length < 2) { out.skipped = "no usable options from models"; return out; }
  if (!opts.some((o) => o.pick)) opts[0].pick = 1;

  const key = deps.key !== undefined ? deps.key : signingKey(env);
  const links = [];
  for (const [i, o] of opts.entries()) {
    o.id = optionId();
    o.nights = o.nights || Number(c.nights) || 2;
    o.link = bookingLink({ city: o.city, country: o.country, checkin, nights: o.nights, maxPerNight: c.max_per_night, currency: c.currency, adults: c.adults });
    links[i] = key ? BASE + "/travel/o/" + o.id + "?s=" + encodeURIComponent(await sign(key, o.id)) : null;
  }
  const mail = mailFor(state, opts, links, c);
  if (deps.dry) { out.preview = { trip_key: tripKey, model, subject: mail.subject, body: mail.body }; return out; }
  for (const [i, o] of opts.entries()) {
    await db.prepare("INSERT INTO travel_options (id, trip_key, rank, pick, mode, city, country, kind, checkin, nights, est_per_night, currency, why, link, model, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?) ON CONFLICT(trip_key, rank) DO NOTHING")
      .bind(o.id, tripKey, i + 1, o.pick, state.mode, o.city, o.country || null, o.kind || null, checkin, o.nights, o.est_per_night, c.currency, o.why || null, o.link, model, nowIso).run();
  }
  const sent = await send(mail.subject, mail.body);
  if (!sent || !sent.ok) {
    // undelivered: remove the rows so the next tick proposes again instead of holding a proposal nobody saw
    await db.prepare("DELETE FROM travel_options WHERE trip_key = ? AND status = 'proposed'").bind(tripKey).run();
    out.error = "send failed: " + String(sent && sent.error || "unknown").slice(0, 200);
    return out;
  }
  out.proposed = opts.length;
  out.trip_key = tripKey;
  return out;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function page(title, inner, status) {
  const html = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex\"><title>" + esc(title) + "</title>" +
    "<style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a;background:#fff}a{color:#0b57d0}button{font:inherit;padding:.6rem 1rem;margin:.25rem .5rem .25rem 0;border-radius:.5rem;border:1px solid #888;background:#f4f4f4;cursor:pointer}.pick{background:#0b57d0;color:#fff;border-color:#0b57d0}.muted{color:#555}@media(prefers-color-scheme:dark){body{background:#121212;color:#eee}a{color:#8ab4f8}button{background:#222;color:#eee}.muted{color:#aaa}}</style></head><body>" + inner + "</body></html>";
  return new Response(html, { status: status || 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
}

function bearerOk(request, env) {
  const key = env.COMPANION_KEY || "";
  if (!key) return false;
  const u = new URL(request.url);
  const h = request.headers.get("Authorization") || "";
  const got = h.startsWith("Bearer ") ? h.slice(7) : (u.searchParams.get("k") || "");
  const a = new TextEncoder().encode(got), b = new TextEncoder().encode(key);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

const jsonRes = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Record a pick or a not-for-me on one option (shared by the mailed option page and the chat page).
export async function applyReaction(db, o, action, nowIso) {
  const open = o.status === "proposed" || o.status === "picked";
  if (!open) return false;
  if (action === "pick") {
    await db.prepare("UPDATE travel_options SET status = CASE WHEN id = ? THEN 'picked' ELSE 'proposed' END, decided_at = CASE WHEN id = ? THEN ? ELSE decided_at END WHERE trip_key = ? AND status IN ('proposed','picked')").bind(o.id, o.id, nowIso, o.trip_key).run();
  } else {
    await db.prepare("UPDATE travel_options SET status = 'rejected', decided_at = ? WHERE id = ?").bind(nowIso, o.id).run();
  }
  await db.prepare("INSERT INTO travel_reactions (option_id, trip_key, reaction, city, kind, ts) VALUES (?, ?, ?, ?, ?, ?)").bind(o.id, o.trip_key, action, o.city, o.kind || null, nowIso).run();
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// TRAVEL-CHAT-1 (2026-10-19, owner request: "something that really is interactive and personalized", "not locked in to
// Claude"). A chat page at /travel on the companion's own host. Each turn the model sees what the fleet knows (stays and
// flights in personal-life.events, profile facets travel/likes/dislikes/logistics, past picks and rejections, the last
// turns of the conversation) and answers with JSON: a short reply, 0-3 concrete options with one pick, at most one
// question with tap answers, and what it learned. Learned preferences are written to personal-life.profile (facet travel,
// ids travel:chat-*), so the hourly planner and every later turn use them. Models are Workers AI ids in travel_config
// chat_models (swappable from the page). Sign-in: Cloudflare Access when access_team/access_aud are set, the companion's
// own key cookie, or a 6-digit code (and one-tap link) mailed to the owner; no key for the owner to keep. A signed-in
// device stays signed in (120 days, renewed on use). Nothing is booked or paid.

export const SESSION_DAYS = 120;          // a signed-in device stays signed in; each visit in the last 60 days renews it
export const CODE_TRIES = 5;               // wrong guesses allowed per mailed code
export const LOGIN_TTL_MIN = 20;
export const LOGIN_MAILS_PER_HOUR = 4;
export const CHAT_MODEL_MENU = ["@cf/openai/gpt-oss-120b", "@cf/zai-org/glm-5.3", "@cf/moonshotai/kimi-k2.6"];

// The signing secret: a worker secret when one is set, else a random one generated once and kept in D1.
export async function authKey(env, db) {
  const k = signingKey(env);
  if (k) return k;
  const r = await db.prepare("SELECT v FROM travel_secrets WHERE k = 'session'").first();
  if (r && r.v) return r.v;
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  await db.prepare("INSERT OR IGNORE INTO travel_secrets (k, v) VALUES ('session', ?)").bind(b64u(b)).run();
  const again = await db.prepare("SELECT v FROM travel_secrets WHERE k = 'session'").first();
  return again && again.v || "";
}

export async function makeToken(key, kind, expSec) { return expSec + "." + await sign(key, kind + ":" + expSec); }
export async function tokenOk(key, kind, tok, nowMs) {
  const m = /^(\d{9,11})\.([A-Za-z0-9_-]{20,})$/.exec(String(tok || ""));
  if (!m || Number(m[1]) * 1000 < nowMs) return false;
  return verify(key, kind + ":" + m[1], m[2]);
}

function cookie(request, name) {
  for (const part of String(request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

function sameString(a, b) {
  const x = new TextEncoder().encode(String(a || "")), y = new TextEncoder().encode(String(b || ""));
  if (!x.length || x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

const b64json = (s) => JSON.parse(new TextDecoder().decode(unb64u(s)));

// Cloudflare Access: verify the RS256 JWT Access puts in Cf-Access-Jwt-Assertion against the team's published keys.
// deps.accessCerts(team) returns the JSON of https://<team>.cloudflareaccess.com/cdn-cgi/access/certs (the worker fetches it).
export async function accessOk(request, c, deps, nowMs) {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion") || "";
  if (!jwt || !c.access_team || !c.access_aud || typeof deps.accessCerts !== "function") return false;
  try {
    const [h, p, s] = jwt.split(".");
    if (!s) return false;
    const header = b64json(h), payload = b64json(p);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (header.alg !== "RS256" || !aud.includes(c.access_aud) || !(Number(payload.exp) * 1000 > nowMs)) return false;
    if (payload.iss !== "https://" + c.access_team + ".cloudflareaccess.com") return false;
    const certs = await deps.accessCerts(c.access_team);
    const jwk = (certs && certs.keys || []).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64u(s), new TextEncoder().encode(h + "." + p));
  } catch (e) { return false; }
}

export async function chatAuthed(request, env, db, c, deps, nowMs) {
  if (bearerOk(request, env)) return "bearer";
  if (env.COMPANION_KEY && sameString(cookie(request, "pc_key"), env.COMPANION_KEY)) return "companion-key";
  const key = deps.key !== undefined ? deps.key : await authKey(env, db);
  if (key && await tokenOk(key, "sess", cookie(request, "trv"), nowMs)) return "session";
  if (await accessOk(request, c, deps, nowMs)) return "access";
  return "";
}

// First JSON object or array in a model reply (bare, fenced, or inside prose).
export function firstJson(text) {
  const s = String(text || "");
  const tries = [s, (s.match(/```(?:json)?\s*([\s\S]*?)```/) || [])[1], (s.match(/\{[\s\S]*\}/) || [])[0]];
  for (const t of tries) { if (!t) continue; try { return JSON.parse(t); } catch (e) { /* next shape */ } }
  return null;
}

const clean = (v, n) => String(v == null ? "" : v).replace(/[\r\n<>]+/g, " ").trim().slice(0, n);

export function parseChat(text, today) {
  const j = firstJson(text);
  if (!j || typeof j !== "object" || Array.isArray(j)) {
    // a model that ignored the format still gets its words shown, as long as it is not raw JSON
    const t = String(text || "").trim();
    return { reply: /^[[{]/.test(t) ? "" : t.slice(0, 4000), options: [], question: null, learned: [] };
  }
  const reply = String(j.reply || "").replace(/<[^>]*>/g, "").trim().slice(0, 4000);
  const options = parseOptions(JSON.stringify({ options: Array.isArray(j.options) ? j.options : [] }));
  const done = new Set();
  (Array.isArray(j.options) ? j.options : []).forEach((o) => {
    const hit = options.find((x) => norm(x.city) === norm(o && o.city));
    if (!hit || done.has(hit)) return;
    done.add(hit);
    hit.pick = o.pick === true || o.pick === 1 ? 1 : 0;
    const ci = String(o.checkin || "");
    hit.checkin = /^\d{4}-\d{2}-\d{2}$/.test(ci) && (!today || ci >= today) ? ci : "";
  });
  if (options.length && !options.some((o) => o.pick)) options[0].pick = 1;
  if (options.filter((o) => o.pick).length > 1) options.forEach((o, i) => { o.pick = i === options.findIndex((x) => x.pick) ? 1 : 0; });
  let question = null;
  if (j.question && typeof j.question === "object" && clean(j.question.text, 200)) {
    const choices = (Array.isArray(j.question.choices) ? j.question.choices : []).map((x) => clean(x, 60)).filter(Boolean).slice(0, 4);
    question = { text: clean(j.question.text, 200), choices };
  }
  const learned = (Array.isArray(j.learned) ? j.learned : []).map((l) => ({ label: clean(l && l.label, 50), statement: clean(l && l.statement, 240) }))
    .filter((l) => l.label && l.statement).slice(0, 3);
  return { reply, options, question, learned };
}

export const CHAT_SYSTEM = [
  "You are a personal travel planner for one traveller who loves the stimulation of travel and hates planning it. They sometimes travel with a companion; the profile says who and how, so plan for the party it describes. You talk with them in a chat.",
  "How you work:",
  "- Lead with something concrete. When the next destination or step is open, propose 2 or 3 specific places and mark one as your pick. Never send a list of questions or a questionnaire.",
  "- Use what you know (their profile, past picks and rejections, where they are now, what is booked) and say in one sentence why each option fits them in particular.",
  "- Ask at most one short question per reply, and only when the answer would change the plan (dates, a hard limit). Give it 2 to 4 short answers they can tap.",
  "- When they react (like this, not that, too far, too pricey, more of X), adjust at once and record what you learned as a short preference.",
  "- When they choose a place, plan it: how to get there from where they are, which area to stay in, a short outline for the nights, and what to book first.",
  "- You never book or pay. The app attaches stay-search and transit links to every option.",
  "- Plain, warm, brief English. No emojis. No filler. Short paragraphs or lines starting with '- '.",
  "Reply with JSON only, exactly this shape:",
  "{\"reply\":\"text shown in the chat\",\"options\":[{\"city\":\"\",\"country\":\"\",\"kind\":\"old town|coast|second city|nature|capital|island|mountains\",\"checkin\":\"YYYY-MM-DD or empty\",\"nights\":2,\"est_per_night\":0,\"why\":\"one sentence\",\"pick\":true}],\"question\":{\"text\":\"\",\"choices\":[\"\",\"\"]},\"learned\":[{\"label\":\"two to four words\",\"statement\":\"one sentence about the traveller's preference\"}]}",
  "Use [] when there are no options or nothing was learned, and null when there is no question. Respect every logistics fact (residence, visa rules) in the context.",
  "KERNEL-REPLY-4 (2026-11-06, docs/DOCTRINE-KERNEL.md 8.2.1 recognitions, KERNEL-EVERYWHERE-1): end on the plan or the proposal, never on a conditional offer ('would you like', 'want me to', 'if you want', 'shall I', 'let me know if') or a questionnaire. The one designed question with tap answers above is the only question shape; everything else ends on what you propose or what you did. A refusal or limit (you never book or pay, a visa rule) is stated with its reason as a disposition, not offered around. When a reversible step could be taken now, take it and report it in the same reply."
].join("\n");

export function chatContext(x) {
  const c = x.c;
  const where = x.state.mode === "road"
    ? "On the road: staying in " + x.state.city + (x.state.country ? ", " + x.state.country : "") + ", checks out " + x.state.checkin + " with nothing booked after that."
    : "No open gap detected; home base is " + c.home_city + (c.home_country ? ", " + c.home_country : "") + ".";
  const booked = (x.booked || []).map((b) => "- " + (b.city || b.title) + (b.country ? ", " + b.country : "") + ": " + b.start_date + " to " + b.end_date).join("\n");
  const facts = (x.profile || []).map((r) => "- " + String(r.label || "") + ": " + String(r.statement || "")).join("\n").slice(0, PROFILE_CHARS);
  const picked = (x.reactions || []).filter((r) => r.reaction === "pick" || r.reaction === "booked").slice(0, 12).map((r) => r.city + (r.kind ? " (" + r.kind + ")" : "")).join(", ");
  const rejected = (x.reactions || []).filter((r) => r.reaction === "no").slice(0, 20).map((r) => r.city).join(", ");
  return [
    "Context (from their bookings and stored profile; use it, do not recite it):",
    "Today: " + x.today + ".",
    where,
    "Booked ahead:\n" + (booked || "- nothing"),
    x.plan || "",
    "Default lodging budget: up to " + c.max_per_night + " " + c.currency + " per night; default stay " + c.nights + " nights per stop.",
    "Profile:\n" + (facts || "- (nothing stored yet)"),
    "Stayed in recently: " + ((x.state.recent || []).join(", ") || "none"),
    "Picked or booked before: " + (picked || "none"),
    "Turned down before: " + (rejected || "none")
  ].filter(Boolean).join("\n\n");
}

export function historyText(row) {
  let t = String(row.content || "");
  if (row.role !== "assistant" || !row.meta) return t;
  try {
    const m = JSON.parse(row.meta);
    if (m.options && m.options.length) t += "\n[Options shown: " + m.options.map((o) => o.city + (o.pick ? " (my pick)" : "") + (o.status && o.status !== "proposed" ? " - " + o.status : "")).join(", ") + "]";
    if (m.question && m.question.text) t += "\n[Asked: " + m.question.text + "]";
  } catch (e) { /* plain text */ }
  return t;
}

export const OPEN_TURN = "(The traveller just opened the planner. Greet them in one short line, then lead with your best proposal for what comes next, given where they are and what is booked.)";

export function chatPrompt(x) {
  const msgs = [{ role: "system", content: CHAT_SYSTEM + "\n\n" + chatContext(x) }];
  for (const h of x.history || []) msgs.push({ role: h.role, content: historyText(h).slice(0, 3000) });
  msgs.push({ role: "user", content: x.text || OPEN_TURN });
  return msgs;
}

export function chatModels(c, allow) {
  const list = String(c.chat_models || DEFAULTS.chat_models).split(",").map((s) => s.trim()).filter((m) => /^@cf\/[\w.\-/]+$/.test(m));
  const ok = typeof allow === "function" ? list.filter((m) => allow(m)) : list;
  return ok.length ? ok : CHAT_MODEL_MENU.slice();
}

const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

async function chatContextRows(db, today) {
  const rows = await many(db, "SELECT id, category, title, city, country, start_date, end_date, booking_ref FROM events WHERE category IN ('lodging','travel') AND (end_date >= ? OR start_date >= ?)", addDays(today, -60), addDays(today, -60));
  let profile = [];
  try { profile = await many(db, "SELECT id, facet, label, statement FROM profile WHERE facet IN ('travel','likes','dislikes','logistics') AND (domain IS NULL OR domain IN ('personal','straddle')) AND (status IS NULL OR status IN ('accepted','active')) ORDER BY CASE facet WHEN 'travel' THEN 0 ELSE 1 END, confidence DESC LIMIT 80"); }
  catch (e) { console.error(JSON.stringify({ evt: "travel-chat:profile-read", error: String(e && e.message || e).slice(0, 200) })); }
  const reactions = await many(db, "SELECT reaction, city, kind FROM travel_reactions WHERE ts >= ? AND (kind IS NULL OR kind NOT IN ('eat','do')) ORDER BY ts DESC LIMIT 60", addDays(today, -365));
  return { rows, profile, reactions };
}

// One chat turn. input: { text } or { open: true }. deps: { ai(model, input), now, modelAllowed(model) }.
export async function chatTurn(env, deps, input) {
  const db = env.PERSONAL;
  const nowMs = deps.now || Date.now();
  const nowIso = new Date(nowMs).toISOString();
  await ensureTravel(db, nowIso);
  const c = await cfg(db);
  const today = localParts(nowMs, c.tz).day;
  const text = String(input && input.text || "").trim().slice(0, 2000);
  if (!text && !(input && input.open)) return { ok: false, error: "Say something first." };
  if (typeof deps.ai !== "function") return { ok: false, error: "no model caller" };
  const { rows, profile, reactions } = await chatContextRows(db, today);
  const state = tripState(rows, today, c);
  const booked = rows.filter((r) => r.category === "lodging" && r.end_date >= today).sort((a, b) => (a.start_date < b.start_date ? -1 : 1)).slice(0, 8);
  const history = (await many(db, "SELECT role, content, meta FROM travel_chat ORDER BY id DESC LIMIT 16")).reverse();
  const trip = await tripRows(db, today);
  const plan = planText(trip.stops, visaStatus(trip.permits, await many(db, "SELECT city, country, start_date, end_date FROM travel_stops"), today));
  const messages = chatPrompt({ c, today, state, booked, profile, reactions, history, text, plan });
  let parsed = null, model = null, lastErr = "";
  for (const m of chatModels(c, deps.modelAllowed)) {
    try {
      const r = await deps.ai(m, { messages, max_tokens: 2000, temperature: 0.7 });
      const pc = parseChat(modelText(r), today);
      if (pc.reply || pc.options.length) { parsed = pc; model = m; break; }
      lastErr = m + " gave an empty answer";
    } catch (e) {
      lastErr = m + ": " + String(e && e.message || e).slice(0, 160);
      console.error(JSON.stringify({ evt: "travel-chat:model-failed", model: m, error: lastErr }));
    }
  }
  if (!parsed) return { ok: false, error: "No model answered (" + lastErr + "). Send it again, or pick another model under Settings." };

  if (text) await db.prepare("INSERT INTO travel_chat (role, content, ts) VALUES ('user', ?, ?)").bind(text, nowIso).run();
  const from = state.mode === "road" ? [state.city, state.country].filter(Boolean).join(", ") : [c.home_city, c.home_country].filter(Boolean).join(", ");
  const tripKey = "chat:" + nowIso;
  const options = [];
  for (const [i, o] of parsed.options.entries()) {
    const checkin = o.checkin || (state.mode === "road" ? state.checkin : addDays(today, 7));
    const nights = o.nights || Number(c.nights) || 2;
    const opt = { id: optionId(), city: o.city, country: o.country, kind: o.kind, checkin, nights, est_per_night: o.est_per_night, why: o.why, pick: o.pick, status: "proposed",
      link: bookingLink({ city: o.city, country: o.country, checkin, nights, maxPerNight: c.max_per_night, currency: c.currency, adults: c.adults }),
      transit: transitLink(from, [o.city, o.country].filter(Boolean).join(", ")) };
    await db.prepare("INSERT INTO travel_options (id, trip_key, rank, pick, mode, city, country, kind, checkin, nights, est_per_night, currency, why, link, model, status, created_at) VALUES (?, ?, ?, ?, 'chat', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?) ON CONFLICT(trip_key, rank) DO NOTHING")
      .bind(opt.id, tripKey, i + 1, opt.pick, opt.city, opt.country || null, opt.kind || null, checkin, nights, opt.est_per_night, c.currency, opt.why || null, opt.link, model, nowIso).run();
    options.push(opt);
  }
  const learned = await learnPrefs(db, parsed.learned, "travel chat " + today + (text ? ": \"" + text.slice(0, 160) + "\"" : ""), nowIso);
  const meta = { options, question: parsed.question, learned, model };
  const ins = await db.prepare("INSERT INTO travel_chat (role, content, meta, ts) VALUES ('assistant', ?, ?, ?)").bind(parsed.reply, JSON.stringify(meta), nowIso).run();
  return { ok: true, message: { id: ins && ins.meta && ins.meta.last_row_id || null, role: "assistant", content: parsed.reply, meta, ts: nowIso } };
}

// Learned preferences go to the one preferences store, personal-life.profile (facet travel, ids travel:chat-*); a repeat
// raises confidence.
async function learnPrefs(db, list, evidence, nowIso) {
  const learned = [];
  for (const l of list || []) {
    const id = "travel:chat-" + (slug(l.label) || "note");
    try {
      await db.prepare("INSERT INTO profile (id, facet, label, statement, evidence, confidence, updated_at, domain, status) VALUES (?, 'travel', ?, ?, ?, 0.7, ?, 'personal', 'active') ON CONFLICT(id) DO UPDATE SET statement = excluded.statement, evidence = excluded.evidence, updated_at = excluded.updated_at, status = 'active', confidence = MIN(0.95, profile.confidence + 0.05)")
        .bind(id, l.label, l.statement, evidence, nowIso).run();
      learned.push({ id, label: l.label, statement: l.statement });
    } catch (e) { console.error(JSON.stringify({ evt: "travel-chat:learn-failed", error: String(e && e.message || e).slice(0, 200) })); }
  }
  return learned;
}

// Chat history for the page, with each option's live status (picked, rejected, booked) folded back in.
export async function chatState(db, c, nowMs) {
  const today = localParts(nowMs, c.tz).day;
  const hist = (await many(db, "SELECT id, role, content, meta, ts FROM travel_chat ORDER BY id DESC LIMIT 60")).reverse();
  const ids = [];
  for (const h of hist) { try { h.meta = h.meta ? JSON.parse(h.meta) : null; } catch (e) { h.meta = null; } for (const o of (h.meta && h.meta.options) || []) ids.push(o.id); }
  if (ids.length) {
    const st = {};
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      for (const r of await many(db, "SELECT id, status FROM travel_options WHERE id IN (" + part.map(() => "?").join(",") + ")", ...part)) st[r.id] = r.status;
    }
    for (const h of hist) for (const o of (h.meta && h.meta.options) || []) o.status = st[o.id] || o.status;
  }
  const { rows, profile } = await chatContextRows(db, today);
  const state = tripState(rows, today, c);
  const where = state.mode === "road" ? "In " + state.city + ", checking out " + state.checkin + ", nothing booked after" : (rows.some((r) => r.category === "lodging" && r.end_date >= today) ? "Trip booked ahead" : "Nothing booked");
  return { history: hist, where, models: { current: chatModels(c)[0], menu: CHAT_MODEL_MENU }, known: profile.map((p) => ({ id: p.id, facet: p.facet, label: p.label, statement: p.statement, removable: p.facet === "travel" })) };
}

function chatPage(nonce) {
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\"><meta name=\"robots\" content=\"noindex\"><title>Travel planner</title><style nonce=\"" + nonce + "\">" + CHAT_CSS + "</style></head><body>" + CHAT_BODY + "<script nonce=\"" + nonce + "\">" + CHAT_JS + "</script></body></html>";
}

const CHAT_CSS = ":root{--bg:#f7f6f3;--card:#fff;--ink:#1b1b1b;--muted:#5d5d5d;--line:#dedbd4;--accent:#0b57d0;--accent-ink:#fff;--me:#e6eefc;--warn:#9a3412}" +
  "@media(prefers-color-scheme:dark){:root{--bg:#141414;--card:#1e1e1e;--ink:#ececec;--muted:#a3a3a3;--line:#333;--accent:#8ab4f8;--accent-ink:#0b0b0b;--me:#23314d;--warn:#fdba74}}" +
  "*{box-sizing:border-box}html,body{margin:0;height:100%}body{font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--ink);display:flex;flex-direction:column}" +
  "header{padding:.75rem 1rem;border-bottom:1px solid var(--line);display:flex;gap:.75rem;align-items:baseline;flex-wrap:wrap}header h1{font-size:1.1rem;margin:0}#where{color:var(--muted);font-size:.9rem}" +
  "main{flex:1;overflow-y:auto;padding:1rem;max-width:44rem;width:100%;margin:0 auto}" +
  ".msg{margin:0 0 1rem;max-width:100%}.msg.user{margin-left:auto;background:var(--me);padding:.55rem .85rem;border-radius:1rem 1rem .25rem 1rem;width:fit-content;max-width:85%}" +
  ".msg.assistant .text p{margin:.3rem 0}.msg.assistant .text ul{margin:.3rem 0;padding-left:1.2rem}.err{color:var(--warn)}" +
  ".opts{display:grid;gap:.6rem;margin:.6rem 0}.opt{background:var(--card);border:1px solid var(--line);border-radius:.8rem;padding:.75rem .9rem}.opt.pick{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}" +
  ".opt h3{margin:0;font-size:1.02rem}.opt .meta{color:var(--muted);font-size:.88rem}.opt .why{margin:.35rem 0}.opt .tag{font-size:.75rem;color:var(--accent);font-weight:600;margin-left:.4rem}" +
  ".opt.rejected{opacity:.55}.opt.picked{border-color:var(--accent)}.row{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.45rem;align-items:center}" +
  "button,.btn{font:inherit;font-size:.92rem;padding:.42rem .8rem;border-radius:.6rem;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;text-decoration:none;display:inline-block}" +
  "button.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}button:disabled{opacity:.5;cursor:default}a{color:var(--accent)}" +
  ".chips{display:flex;flex-wrap:wrap;gap:.4rem;margin:.4rem 0}.q{margin:.5rem 0 .2rem;font-weight:600}" +
  ".learned{font-size:.85rem;color:var(--muted);margin:.3rem 0}" +
  "footer{border-top:1px solid var(--line);padding:.6rem .75rem calc(.6rem + env(safe-area-inset-bottom));background:var(--bg)}" +
  "form#f{display:flex;gap:.5rem;max-width:44rem;margin:0 auto}textarea{flex:1;font:inherit;padding:.55rem .7rem;border-radius:.7rem;border:1px solid var(--line);background:var(--card);color:var(--ink);resize:none;min-height:2.6rem;max-height:9rem}" +
  "details{max-width:44rem;margin:.4rem auto 0;font-size:.9rem;color:var(--muted)}details li{margin:.2rem 0}select{font:inherit;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:.4rem;padding:.2rem}" +
  ".typing{color:var(--muted);font-style:italic}" +
  "nav.tabs{display:flex;gap:.3rem;margin-left:auto}nav.tabs button[aria-pressed=true]{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}" +
  "section.tab{flex:1;overflow-y:auto;padding:1rem;max-width:44rem;width:100%;margin:0 auto}section.tab h2{font-size:1rem;margin:1.2rem 0 .5rem}" +
  ".card{background:var(--card);border:1px solid var(--line);border-radius:.8rem;padding:.7rem .9rem;margin:0 0 .6rem}.card.warn{border-color:var(--warn)}.card.over{border-color:var(--warn);box-shadow:0 0 0 2px var(--warn)}" +
  ".big{font-size:1.4rem;font-weight:700}.flag{color:var(--warn);font-size:.88rem;margin:.15rem 0}.muted{color:var(--muted);font-size:.88rem}" +
  ".day{display:grid;grid-template-columns:5.6rem 1fr;gap:.5rem;padding:.45rem 0;border-bottom:1px solid var(--line)}.day .d{color:var(--muted);font-size:.88rem}.day .wx{font-size:.88rem;color:var(--muted)}.badge{font-size:.75rem;border:1px solid var(--accent);color:var(--accent);border-radius:.4rem;padding:0 .3rem;margin-left:.3rem}" +
  "pre.draft{white-space:pre-wrap;font:inherit;background:var(--bg);border:1px solid var(--line);border-radius:.5rem;padding:.5rem;margin:.4rem 0}" +
  ".ed{display:flex;flex-wrap:wrap;gap:.4rem;margin:.4rem 0}.ed label{display:flex;flex-direction:column;font-size:.8rem;color:var(--muted)}.ed input{font:inherit;font-size:.92rem;padding:.3rem .4rem;border:1px solid var(--line);border-radius:.4rem;background:var(--card);color:var(--ink);max-width:11rem}" +
  ".pillar{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin:.45rem 0 0}.picks{flex-basis:100%;margin:.1rem 0 .2rem;padding-left:1.1rem}.picks li{margin:.3rem 0}button.small{font-size:.8rem;padding:.15rem .5rem;margin:.2rem 0 0}.pillar .pl{font-weight:600;font-size:.85rem;min-width:3.2rem}" +
  "#imptext{width:100%;min-height:10rem;font:inherit;padding:.6rem;border-radius:.7rem;border:1px solid var(--line);background:var(--card);color:var(--ink)}";

const CHAT_BODY = "<header><h1>Travel planner</h1><span id=\"where\"></span><nav class=\"tabs\"><button type=\"button\" data-tab=\"chat\" aria-pressed=\"true\">Chat</button><button type=\"button\" data-tab=\"places\" aria-pressed=\"false\">Places</button><button type=\"button\" data-tab=\"moving\" aria-pressed=\"false\">Getting around</button><button type=\"button\" data-tab=\"imp\" aria-pressed=\"false\">Import</button></nav></header>" +
  "<main id=\"log\" aria-live=\"polite\"></main>" +
  "<section class=\"tab\" id=\"places\" hidden><p class=\"muted\">Where to go, where to sleep, what to eat and what to do, stop by stop. Tap a question and the chat answers it.</p><div id=\"visa\"></div><div id=\"checkins\"></div><h2>Stops</h2><div id=\"stops\"></div><p><button type=\"button\" id=\"addstop\">Add a stop</button> <button type=\"button\" id=\"addvisa\">Add a visa</button></p></section>" +
  "<section class=\"tab\" id=\"moving\" hidden><p class=\"muted\">How to get from one stop to the next, then every day with its weather.</p><h2>Moves</h2><div id=\"moves\"></div><h2>Day by day</h2><p class=\"muted\">Weather: forecast for the next 16 days; after that, the same dates last year.</p><div id=\"days\"></div></section>" +
  "<section class=\"tab\" id=\"imp\" hidden><h2>Import a booking</h2><p class=\"muted\">Paste a confirmation email or any booking text. I pick out the stays and journeys and add them to your trips.</p><p id=\"fwd\" class=\"muted\"></p><textarea id=\"imptext\" aria-label=\"Booking text\"></textarea><p><button class=\"primary\" type=\"button\" id=\"impgo\">Import</button></p><div id=\"impout\"></div></section>" +
  "<footer><form id=\"f\"><textarea id=\"t\" rows=\"1\" placeholder=\"Where to, or react to an idea...\" aria-label=\"Message\"></textarea><button class=\"primary\" id=\"send\">Send</button></form>" +
  "<details id=\"settings\"><summary>Settings and what I know</summary><p>Model: <select id=\"model\"></select> <span id=\"modelnote\"></span></p><p>What I use to plan (remove anything wrong):</p><ul id=\"known\"></ul>" +
  "<p><button id=\"fresh\" type=\"button\">Start a fresh conversation</button> <button id=\"out\" type=\"button\">Sign out</button></p></details></footer>";

const CHAT_JS = String.raw`
const $ = (s) => document.querySelector(s);
const log = $("#log"), ta = $("#t"), sendBtn = $("#send");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function md(t) {
  const out = []; let list = false;
  for (const raw of String(t || "").split(/\n/)) {
    const line = esc(raw).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (/^\s*[-*] /.test(raw)) { if (!list) { out.push("<ul>"); list = true; } out.push("<li>" + line.replace(/^\s*[-*] /, "") + "</li>"); continue; }
    if (list) { out.push("</ul>"); list = false; }
    if (line.trim()) out.push("<p>" + line + "</p>");
  }
  if (list) out.push("</ul>");
  return out.join("");
}
async function api(path, body) {
  const r = await fetch(path, body === undefined ? { credentials: "same-origin" } : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status === 401) { location.reload(); throw new Error("signed out"); }
  return r.json();
}
function scrollEnd() { log.scrollTop = log.scrollHeight; }
function chips(list, onPick) {
  const d = document.createElement("div"); d.className = "chips";
  for (const c of list) { const b = document.createElement("button"); b.type = "button"; b.textContent = c; b.onclick = () => { d.querySelectorAll("button").forEach((x) => x.disabled = true); onPick(c); }; d.appendChild(b); }
  return d;
}
function optCard(o) {
  const d = document.createElement("div");
  d.className = "opt" + (o.pick ? " pick" : "") + (o.status ? " " + o.status : "");
  const nights = o.nights ? o.nights + " night" + (o.nights == 1 ? "" : "s") : "";
  d.innerHTML = "<h3>" + esc(o.city) + (o.country ? ", " + esc(o.country) : "") + (o.pick ? "<span class=tag>MY PICK</span>" : "") + "</h3>" +
    "<div class=meta>" + [nights, o.checkin ? "from " + esc(o.checkin) : "", esc(o.kind || ""), o.est_per_night ? "about " + esc(o.est_per_night) + "/night" : ""].filter(Boolean).join(" · ") + "</div>" +
    (o.why ? "<div class=why>" + esc(o.why) + "</div>" : "");
  const row = document.createElement("div"); row.className = "row";
  const open = !o.status || o.status === "proposed";
  if (open) {
    const yes = document.createElement("button"); yes.className = "primary"; yes.type = "button"; yes.textContent = "This one";
    const no = document.createElement("button"); no.type = "button"; no.textContent = "Not for me";
    yes.onclick = async () => { yes.disabled = no.disabled = true; await api("/travel/api/react", { id: o.id, action: "pick" }); d.classList.add("picked"); send("I'll take " + o.city + ". Plan it."); };
    no.onclick = async () => {
      yes.disabled = no.disabled = true; await api("/travel/api/react", { id: o.id, action: "no" }); d.classList.add("rejected");
      d.appendChild(chips(["Too far", "Too pricey", "Been there", "Not my vibe", "Show me something else"], (c) => send(c === "Show me something else" ? "Not " + o.city + ". Show me something else." : "Not " + o.city + ": " + c.toLowerCase() + ".")));
      scrollEnd();
    };
    row.append(yes, no);
  } else {
    const s = document.createElement("span"); s.className = "meta"; s.textContent = o.status === "picked" ? "Chosen" : o.status === "rejected" ? "Skipped" : o.status; row.append(s);
  }
  const stays = document.createElement("a"); stays.className = "btn"; stays.href = o.link; stays.target = "_blank"; stays.rel = "noopener noreferrer"; stays.textContent = "Stays";
  row.append(stays);
  if (o.transit) { const tr = document.createElement("a"); tr.className = "btn"; tr.href = o.transit; tr.target = "_blank"; tr.rel = "noopener noreferrer"; tr.textContent = "Getting there"; row.append(tr); }
  d.appendChild(row);
  return d;
}
function render(m, last) {
  const d = document.createElement("div"); d.className = "msg " + m.role;
  if (m.role === "user") { d.textContent = m.content; log.appendChild(d); return; }
  const tx = document.createElement("div"); tx.className = "text"; tx.innerHTML = md(m.content); d.appendChild(tx);
  const meta = m.meta || {};
  if (meta.options && meta.options.length) { const g = document.createElement("div"); g.className = "opts"; meta.options.forEach((o) => g.appendChild(optCard(o))); d.appendChild(g); }
  if (meta.learned && meta.learned.length) { const l = document.createElement("div"); l.className = "learned"; l.textContent = "Noted for next time: " + meta.learned.map((x) => x.statement).join(" "); d.appendChild(l); }
  if (meta.question && meta.question.text && last) {
    const q = document.createElement("div"); q.className = "q"; q.textContent = meta.question.text; d.appendChild(q);
    if (meta.question.choices && meta.question.choices.length) d.appendChild(chips(meta.question.choices, (c) => send(c)));
  }
  log.appendChild(d);
}
let busy = false;
async function send(text, open) {
  if (busy) return; busy = true; sendBtn.disabled = true;
  if (text) render({ role: "user", content: text });
  const t = document.createElement("div"); t.className = "msg typing"; t.textContent = "Thinking..."; log.appendChild(t); scrollEnd();
  try {
    const r = await api("/travel/api/chat", open ? { open: true } : { text });
    t.remove();
    if (r.ok) { render(r.message, true); loadKnown(); }
    else { const e = document.createElement("div"); e.className = "msg err"; e.textContent = r.error || "Something went wrong."; log.appendChild(e); }
  } catch (e) { t.remove(); const er = document.createElement("div"); er.className = "msg err"; er.textContent = "Could not reach the planner: " + e.message; log.appendChild(er); }
  busy = false; sendBtn.disabled = false; scrollEnd();
}
function showKnown(k) {
  const ul = $("#known"); ul.innerHTML = "";
  for (const p of k) {
    const li = document.createElement("li"); li.innerHTML = "<strong>" + esc(p.label) + "</strong>: " + esc(p.statement) + " ";
    if (p.removable) { const b = document.createElement("button"); b.type = "button"; b.textContent = "Forget"; b.onclick = async () => { await api("/travel/api/forget", { id: p.id }); li.remove(); }; li.appendChild(b); }
    ul.appendChild(li);
  }
}
async function loadKnown() { try { const s = await api("/travel/api/state?known=1"); showKnown(s.known || []); } catch (e) { console.warn("known list", e); } }
async function boot() {
  const s = await api("/travel/api/state");
  $("#where").textContent = s.where || "";
  const sel = $("#model");
  for (const m of s.models.menu.concat(s.models.menu.includes(s.models.current) ? [] : [s.models.current])) { const o = document.createElement("option"); o.value = m; o.textContent = m.replace(/^@cf\//, ""); if (m === s.models.current) o.selected = true; sel.appendChild(o); }
  sel.onchange = async () => { const r = await api("/travel/api/model", { model: sel.value }); $("#modelnote").textContent = r.ok ? "saved" : (r.error || "not saved"); };
  showKnown(s.known || []);
  const h = s.history || [];
  h.forEach((m, i) => render(m, i === h.length - 1));
  scrollEnd();
  const last = h[h.length - 1];
  if (!last || Date.now() - Date.parse(last.ts) > 12 * 3600e3) send("", true);
}
function el(tag, cls, text) { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; }
function btn(label, fn, cls) { const b = el("button", cls || "", label); b.type = "button"; b.onclick = fn; return b; }
function fmtDay(d) { const t = new Date(d + "T12:00:00Z"); return t.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); }
function editor(fields, values, onSave, onDelete) {
  const f = el("div", "ed");
  const inputs = {};
  for (const [name, label, type] of fields) {
    const l = el("label", "", label); const i = document.createElement("input"); i.type = type || "text"; i.value = values[name] == null ? "" : values[name]; inputs[name] = i; l.appendChild(i); f.appendChild(l);
  }
  const msg = el("span", "muted");
  f.appendChild(btn("Save", async () => { const v = {}; for (const k in inputs) v[k] = inputs[k].value.trim(); const r = await onSave(v); if (r && r.ok) loadTrip(); else msg.textContent = (r && r.error) || "Not saved."; }, "primary"));
  if (onDelete) f.appendChild(btn("Remove", async () => { await onDelete(); loadTrip(); }));
  f.appendChild(msg);
  return f;
}
function pickRow(label, list, p, q) {
  const r = el("div", "pillar"); r.appendChild(el("span", "pl", label));
  if (list.length) {
    const ul = el("ul", "picks");
    for (const x of list) {
      const li = el("li");
      const a = el("a", "", x.name); a.href = x.map; a.target = "_blank"; a.rel = "noopener noreferrer"; li.appendChild(a);
      if (x.area) li.appendChild(el("span", "muted", " · " + x.area));
      if (x.why) li.appendChild(el("div", "muted", x.why));
      const no = btn("Not for me", async () => { no.disabled = true; await api("/travel/api/pick-no", { id: x.id }); li.remove(); }); no.className = "small"; li.appendChild(no);
      ul.appendChild(li);
    }
    r.appendChild(ul);
  } else r.appendChild(el("span", "muted", "Suggestions arrive on their own, or get them now."));
  const more = btn(list.length ? "Fresh ideas" : "Suggest now", async () => { more.disabled = true; more.textContent = "Thinking..."; const x = await api("/travel/api/picks", { stop: p.id }); if (x && x.ok) loadTrip(); else { more.disabled = false; more.textContent = (x && x.error) || "Try again"; } });
  r.appendChild(more);
  r.appendChild(btn("Ask", () => ask(q)));
  return r;
}
const STOP_FIELDS = [["city", "Place"], ["country", "Country (2 letters)"], ["start_date", "Arrive", "date"], ["end_date", "Leave", "date"], ["note", "Note"]];
const VISA_FIELDS = [["person", "Who"], ["country", "Country (2 letters)"], ["entry_date", "Entry day", "date"], ["max_days", "Days allowed", "number"], ["year_cap", "Days per calendar year (optional)", "number"]];
function renderTrip(t) {
  const visa = $("#visa"); visa.innerHTML = "";
  if (t.visa.length) visa.appendChild(el("h2", "", "Visa days"));
  for (const v of t.visa) {
    const c = el("div", "card " + (v.status === "over" || v.status === "warn" ? v.status : ""));
    if (v.now) c.appendChild(el("div", "big", "Day " + v.now.day + " of " + v.max_days + " in " + v.name + ", " + v.now.left + " left"));
    c.appendChild(el("div", "", v.text));
    if (v.note) c.appendChild(el("div", "muted", v.note));
    const row = el("div", "row"); let open = null;
    row.appendChild(btn("Edit", () => { if (open) { open.remove(); open = null; return; } open = editor(VISA_FIELDS, v, (x) => api("/travel/api/permit", { ...x, id: v.id, note: v.note }), () => api("/travel/api/permit", { id: v.id, delete: true })); c.appendChild(open); }));
    c.appendChild(row); visa.appendChild(c);
  }
  const ck = $("#checkins"); ck.innerHTML = "";
  if (t.checkins.length) ck.appendChild(el("h2", "", "Early check-in requests"));
  for (const k of t.checkins) {
    const c = el("div", "card");
    c.appendChild(el("strong", "", k.title + ", from " + fmtDay(k.start_date)));
    c.appendChild(el("div", "muted", k.sent ? "You marked this as sent." : "Draft only: nothing goes to the host until you send it from the booking app."));
    c.appendChild(el("pre", "draft", k.draft));
    const row = el("div", "row");
    const cp = btn("Copy", async () => { try { await navigator.clipboard.writeText(k.draft); cp.textContent = "Copied"; } catch (e) { cp.textContent = "Select the text to copy"; } }, "primary");
    row.appendChild(cp);
    if (!k.sent) row.appendChild(btn("Mark as sent", async () => { await api("/travel/api/checkin-sent", { id: k.id }); loadTrip(); }));
    c.appendChild(row); ck.appendChild(c);
  }
  const st = $("#stops"); st.innerHTML = "";
  if (!t.places.length) st.appendChild(el("p", "muted", "No stops planned yet. Add one, or ask in the chat."));
  for (const p of t.places) {
    const s = t.stops.find((x) => x.id === p.id) || p;
    const c = el("div", "card");
    c.appendChild(el("strong", "", p.city + (p.country_name ? ", " + p.country_name : "")));
    c.appendChild(el("div", "muted", fmtDay(p.start_date) + " to " + fmtDay(p.end_date) + " · " + p.nights + " night" + (p.nights === 1 ? "" : "s") + (p.weather ? " · " + p.weather.low + "° to " + p.weather.high + "°" + (p.weather.kind === "lastyear" ? " last year" : "") : "") + (p.note ? " · " + p.note : "")));
    if (p.fog) c.appendChild(el("div", "flag", "Fog season: plan moves for late morning."));
    const sl = el("div", "pillar"); sl.appendChild(el("span", "pl", "Sleep"));
    sl.appendChild(el("span", "", p.sleep.booked.length ? "Booked: " + p.sleep.booked.join(", ") + (p.sleep.nights_open > 0 ? " (" + p.sleep.nights_open + " night" + (p.sleep.nights_open === 1 ? "" : "s") + " still open)" : "") : "Not booked yet"));
    const stays = el("a", "btn", "Find a stay"); stays.href = p.sleep.search; stays.target = "_blank"; stays.rel = "noopener noreferrer"; sl.appendChild(stays);
    sl.appendChild(btn("Ideas", () => ask(p.ask.sleep)));
    c.appendChild(sl);
    c.appendChild(pickRow("Eat", p.eat, p, p.ask.eat));
    c.appendChild(pickRow("Do", p.do, p, p.ask.do));
    let open = null;
    c.appendChild(btn("Edit stop", () => { if (open) { open.remove(); open = null; return; } open = editor(STOP_FIELDS, s, (x) => api("/travel/api/stop", { ...x, id: p.id }), () => api("/travel/api/stop", { id: p.id, delete: true })); c.appendChild(open); }));
    st.appendChild(c);
  }
  const mv = $("#moves"); mv.innerHTML = "";
  if (!t.moves.length) mv.appendChild(el("p", "muted", "No moves between stops yet."));
  for (const m of t.moves) {
    const c = el("div", "card" + (m.fog ? " warn" : ""));
    c.appendChild(el("strong", "", fmtDay(m.day) + ": " + m.from + " to " + m.to));
    c.appendChild(el("div", "muted", (m.booked.length ? "Booked: " + m.booked.join(", ") : "Not booked yet") + (m.cross ? " · border crossing" : "")));
    if (m.fog) c.appendChild(el("div", "flag", "Fog season where you leave from: morning departures are often delayed. Leave after late morning."));
    const row = el("div", "row");
    const tr = el("a", "btn", "Routes and times"); tr.href = m.transit; tr.target = "_blank"; tr.rel = "noopener noreferrer"; row.appendChild(tr);
    row.appendChild(btn("Best way", () => ask(m.ask)));
    c.appendChild(row); mv.appendChild(c);
  }
  const dl = $("#days"); dl.innerHTML = "";
  for (const d of t.days) {
    const r = el("div", "day");
    r.appendChild(el("div", "d", fmtDay(d.day)));
    const b = el("div");
    const head = el("div", "", d.move ? d.move : (d.city || "")); if (d.booked) head.appendChild(el("span", "badge", "booked")); b.appendChild(head);
    if (d.wx) b.appendChild(el("div", "wx", (d.wx.tmax != null ? Math.round(d.wx.tmax) + "°/" + Math.round(d.wx.tmin) + "° " : "") + (d.wx.text || "") + (d.wx.kind === "lastyear" ? " (last year)" : "")));
    if (d.note) b.appendChild(el("div", "muted", d.note));
    for (const f of d.flags) b.appendChild(el("div", "flag", f));
    r.appendChild(b); dl.appendChild(r);
  }
}
async function loadTrip() { try { const t = await api("/travel/api/trip"); if (t.ok) renderTrip(t); $("#fwd").textContent = t.forward_to ? "Or forward the confirmation email to " + t.forward_to + " and it lands here on its own." : ""; } catch (e) { $("#days").textContent = "Could not load the trip: " + e.message; } }
let addOpen = null;
$("#addstop").onclick = () => { if (addOpen) addOpen.remove(); addOpen = editor(STOP_FIELDS, {}, (x) => api("/travel/api/stop", x)); $("#stops").appendChild(addOpen); };
$("#addvisa").onclick = () => { if (addOpen) addOpen.remove(); addOpen = editor(VISA_FIELDS, {}, (x) => api("/travel/api/permit", x)); $("#visa").appendChild(addOpen); };
$("#impgo").onclick = async () => {
  const out = $("#impout"); const v = $("#imptext").value.trim(); if (!v) return;
  $("#impgo").disabled = true; out.textContent = "Reading...";
  try {
    const r = await api("/travel/api/import", { text: v });
    out.innerHTML = "";
    if (!r.ok) { out.appendChild(el("p", "err", r.error || "Nothing imported.")); }
    else {
      for (const b of r.added) out.appendChild(el("div", "card", (b.category === "lodging" ? "Stay: " : "Journey: ") + b.title + (b.city ? ", " + b.city : "") + " · " + fmtDay(b.start_date) + (b.end_date !== b.start_date ? " to " + fmtDay(b.end_date) : "")));
      if (r.learned.length) out.appendChild(el("p", "learned", "Noted for next time: " + r.learned.map((x) => x.statement).join(" ")));
      if (!r.added.length && !r.learned.length) out.appendChild(el("p", "muted", "Nothing to add."));
      $("#imptext").value = "";
    }
  } catch (e) { out.textContent = "Could not import: " + e.message; }
  $("#impgo").disabled = false;
};
function showTab(tab) {
  document.querySelectorAll("nav.tabs button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.tab === tab)));
  $("#log").hidden = tab !== "chat"; document.querySelector("footer").hidden = tab !== "chat";
  $("#places").hidden = tab !== "places"; $("#moving").hidden = tab !== "moving"; $("#imp").hidden = tab !== "imp";
  if (tab !== "chat") loadTrip();
}
function ask(q) { showTab("chat"); send(q); }
document.querySelectorAll("nav.tabs button").forEach((b) => b.onclick = () => showTab(b.dataset.tab));
$("#f").onsubmit = (e) => { e.preventDefault(); const v = ta.value.trim(); if (!v) return; ta.value = ""; send(v); };
ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#f").requestSubmit(); } });
$("#fresh").onclick = async () => { await api("/travel/api/reset", {}); log.innerHTML = ""; send("", true); };
$("#out").onclick = async () => { await api("/travel/api/logout", {}); location.reload(); };
boot().catch((e) => { log.textContent = "Could not load: " + e.message; });
`;

function htmlRes(body, status, extra) {
  const h = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", ...(extra || {}) };
  return new Response(body, { status: status || 200, headers: h });
}

// TURNSTILE-EDGE-1 (1.44.0, BP26-EDGE-SECURITY-1): the travel sign-in forms carry a Turnstile widget and POST /travel/login verifies its token before it mails a code (fail-open only while TURNSTILE_SECRET is unbound).
// BEGIN TURNSTILE-EDGE-1
var TURNSTILE_SITEKEY_DEFAULT = "0x4AAAAAAFpf2WdSG4-h5mu_";
var TURNSTILE_SCRIPT = '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>';
function turnstileWidget(env, action) {
  var key = (env && env.TURNSTILE_SITEKEY) || TURNSTILE_SITEKEY_DEFAULT;
  return '<div class="cf-turnstile" data-sitekey="' + key + '" data-action="' + String(action || "form").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) + '" data-appearance="interaction-only" data-theme="auto"></div>';
}
async function turnstileVerify(env, token, ip, action) {
  if (!env || !env.TURNSTILE_SECRET) return { ok: true, skipped: true, reason: "no-secret" };
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return { ok: false, reason: "missing-token" };
  try {
    var body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
    if (ip) body.set("remoteip", ip);
    var r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: body, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { ok: false, reason: "siteverify-" + r.status };
    var j = await r.json();
    if (!j || j.success !== true) return { ok: false, reason: "rejected:" + String((j && j["error-codes"]) || "").slice(0, 80) };
    if (action && j.action && j.action !== action) return { ok: false, reason: "action-mismatch" };
    return { ok: true, reason: "verified" };
  } catch (e) {
    return { ok: false, reason: "siteverify-error" };
  }
}
// END TURNSTILE-EDGE-1
function signInPage(msg) {
  return page("Travel planner", "<h1>Travel planner</h1>" + (msg ? "<p>" + msg + "</p>" : "") +
    "<form method=\"post\" action=\"/travel/login\">" + turnstileWidget(null, "travel_login") + "<button class=\"pick\">Email me a code</button></form>" + TURNSTILE_SCRIPT +
    "<p class=\"muted\">A 6-digit code goes to your own inbox. Type it in once and this device stays signed in.</p>", 401);
}

function codePage(msg, status) {
  return page("Enter your code", "<h1>Check your inbox</h1>" + (msg ? "<p>" + msg + "</p>" : "<p>Type the 6-digit code from the email, or tap the link in it.</p>") +
    "<form method=\"post\" action=\"/travel/code\"><input name=\"code\" inputmode=\"numeric\" autocomplete=\"one-time-code\" pattern=\"[0-9 ]{6,7}\" maxlength=\"7\" required autofocus style=\"font:inherit;font-size:1.6rem;letter-spacing:.3rem;width:9rem;padding:.3rem .5rem\"> <button class=\"pick\">Sign in</button></form>" +
    "<form method=\"post\" action=\"/travel/login\">" + turnstileWidget(null, "travel_login") + "<button>Send a new code</button></form>" + TURNSTILE_SCRIPT, status || 200);
}

const codeMac = (key, id, code) => sign(key, "code:" + id + ":" + code);

function signedIn(origin, key, nowMs) {
  return makeToken(key, "sess", Math.floor(nowMs / 1000) + SESSION_DAYS * 86400).then((sess) =>
    new Response(null, { status: 303, headers: { Location: origin + "/travel", "Set-Cookie": sessionCookie(sess, SESSION_DAYS * 86400), "Cache-Control": "no-store" } }));
}

const sessionCookie = (v, maxAge) => "trv=" + v + "; Path=/travel; Max-Age=" + maxAge + "; HttpOnly; Secure; SameSite=Lax";

// Routes: GET /travel (chat page or sign-in), POST /travel/login (mails a code), POST /travel/code, GET+POST /travel/auth?i=&t=, POST /travel/api/{chat,react,
// forget,model,reset,logout}, GET /travel/api/state; GET+POST /travel/o/:id?s= (mailed option pages);
// GET /api/travel and POST /api/travel/run (COMPANION_KEY bearer).
export async function handleTravel(request, env, deps = {}) {
  const u = new URL(request.url);
  const p = u.pathname;
  if (p !== "/travel" && !p.startsWith("/travel/") && p !== "/api/travel" && p !== "/api/travel/run") return null;
  const db = env.PERSONAL;
  if (!db) return jsonRes({ ok: false, error: "no PERSONAL binding" }, 503);
  await ensureTravelCheap(db);
  const nowMs = deps.now || Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (p === "/api/travel" || p === "/api/travel/run") {
    if (!bearerOk(request, env)) return jsonRes({ ok: false, error: "unauthorized" }, 401);
    if (p === "/api/travel/run") {
      if (request.method !== "POST") return jsonRes({ ok: false, error: "POST only" }, 405);
      const r = await travelTick(env, { ...deps, dry: u.searchParams.get("dry") === "1", force: u.searchParams.get("force") === "1" });
      return jsonRes({ ok: true, result: r });
    }
    const options = await many(db, "SELECT id, trip_key, rank, pick, mode, city, country, kind, checkin, nights, est_per_night, currency, why, link, status, created_at, decided_at FROM travel_options ORDER BY created_at DESC, rank LIMIT 30");
    const reactions = await many(db, "SELECT option_id, trip_key, reaction, city, kind, ts FROM travel_reactions ORDER BY id DESC LIMIT 30");
    return jsonRes({ ok: true, config: await cfg(db), options, reactions });
  }

  const om = /^\/travel\/o\/(tr_[0-9a-f]{18})$/.exec(p);
  if (om) return optionPage(request, env, deps, db, u, om[1], nowIso);

  const c = await cfg(db);
  // Sign-in by mailed link. Asking for a link only ever mails the owner; it is capped per hour.
  if (p === "/travel/login") {
    if (request.method !== "POST") return Response.redirect(u.origin + "/travel", 303);
    let tsTok = "";
    try { tsTok = String((await request.clone().formData()).get("cf-turnstile-response") || ""); } catch (e) { tsTok = ""; }
    const tsv = await turnstileVerify(env, tsTok, request.headers.get("CF-Connecting-IP") || "", "travel_login");
    if (!tsv.ok) return signInPage("Verification did not complete. Wait a moment and tap the button again.");
    const recent = await db.prepare("SELECT COUNT(*) n FROM travel_logins WHERE created_at >= ?").bind(new Date(nowMs - 3600e3).toISOString()).first();
    if (recent && recent.n >= LOGIN_MAILS_PER_HOUR) return codePage("A few codes went out in the last hour already; use the newest one in your inbox.", 429);
    const key = deps.key !== undefined ? deps.key : await authKey(env, db);
    if (!key) return signInPage("Sign-in is not available right now (no signing key).");
    const id = optionId().replace(/^tr_/, "lg_");
    const rnd = new Uint32Array(1);
    crypto.getRandomValues(rnd);
    const code = String(rnd[0] % 1000000).padStart(6, "0");
    const exp = Math.floor(nowMs / 1000) + LOGIN_TTL_MIN * 60;
    await db.prepare("INSERT INTO travel_logins (id, code_mac, exp, created_at) VALUES (?, ?, ?, ?)").bind(id, await codeMac(key, id, code), exp, nowIso).run();
    const tok = await makeToken(key, "login:" + id, exp);
    // TRAVEL-SIGNIN-MAIL-1: the code goes through the sign-in sender, which the "less email" setting does not silence
    const send = deps.sendCode || deps.send || (async () => ({ ok: false, error: "no sender" }));
    const r = await send("Travel planner code: " + code, "Your sign-in code: " + code + "\n\nOr tap: " + u.origin + "/travel/auth?i=" + id + "&t=" + encodeURIComponent(tok) + "\n\nIt works once, for " + LOGIN_TTL_MIN + " minutes. If you did not ask for it, ignore this mail.");
    if (!r || !r.ok) {
      await db.prepare("DELETE FROM travel_logins WHERE id = ?").bind(id).run();
      console.error(JSON.stringify({ evt: "travel:code-mail-failed", error: String(r && r.error || "unknown").slice(0, 200) }));
      return signInPage("Sorry, the code didn't go out. Wait a minute and tap the button again.");
    }
    return codePage("");
  }
  if (p === "/travel/code") {
    if (request.method !== "POST") return codePage("");
    const key = deps.key !== undefined ? deps.key : await authKey(env, db);
    let code = "";
    try { code = String((await request.formData()).get("code") || "").replace(/\D/g, ""); } catch (e) { code = ""; }
    const live = await many(db, "SELECT id, code_mac FROM travel_logins WHERE used = 0 AND attempts < ? AND exp > ? ORDER BY created_at DESC LIMIT 5", CODE_TRIES, Math.floor(nowMs / 1000));
    if (!live.length) return signInPage("That code has expired. Get a new one.");
    for (const l of live) {
      if (code.length === 6 && await verify(key, "code:" + l.id + ":" + code, l.code_mac)) {
        const r = await db.prepare("UPDATE travel_logins SET used = 1 WHERE id = ? AND used = 0").bind(l.id).run();
        if (r && r.meta && r.meta.changes) return signedIn(u.origin, key, nowMs);
      }
    }
    await db.prepare("UPDATE travel_logins SET attempts = attempts + 1 WHERE used = 0 AND exp > ?").bind(Math.floor(nowMs / 1000)).run();
    return codePage("That code did not match. Try again, or send a new one.", 401);
  }
  if (p === "/travel/auth") {
    const id = u.searchParams.get("i") || "";
    const tok = u.searchParams.get("t") || "";
    const key = deps.key !== undefined ? deps.key : await authKey(env, db);
    const valid = /^lg_[0-9a-f]{18}$/.test(id) && await tokenOk(key, "login:" + id, tok, nowMs);
    if (!valid) return signInPage("That link has expired. Get a new code.");
    // GET only shows a button: mail scanners follow GET links, so the one-time link is spent only by the POST.
    if (request.method !== "POST") return page("Sign in", "<h1>Travel planner</h1><form method=\"post\"><button class=\"pick\">Sign in on this device</button></form>");
    const r = await db.prepare("UPDATE travel_logins SET used = 1 WHERE id = ? AND used = 0").bind(id).run();
    if (!r || !r.meta || !r.meta.changes) return signInPage("That link was already used. Get a new code.");
    return signedIn(u.origin, key, nowMs);
  }

  const who = await chatAuthed(request, env, db, c, deps, nowMs);
  if (p === "/travel" || p === "/travel/") {
    if (!who) return signInPage("");
    const nb = new Uint8Array(12);
    crypto.getRandomValues(nb);
    const nonce = b64u(nb);
    const extra = {};
    if (who === "session") {
      const m = /^(\d+)\./.exec(cookie(request, "trv"));
      if (m && Number(m[1]) * 1000 - nowMs < 60 * 86400e3) {
        const key = deps.key !== undefined ? deps.key : await authKey(env, db);
        extra["Set-Cookie"] = sessionCookie(await makeToken(key, "sess", Math.floor(nowMs / 1000) + SESSION_DAYS * 86400), SESSION_DAYS * 86400);
      }
    }
    return htmlRes(chatPage(nonce), 200, { ...extra, "Content-Security-Policy": "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
  }
  if (!p.startsWith("/travel/api/")) return page("Not found", "<p>Not found.</p>", 404);
  if (!who) return jsonRes({ ok: false, error: "unauthorized" }, 401);

  if (p === "/travel/api/state" && request.method === "GET") return jsonRes({ ok: true, ...(await chatState(db, c, nowMs)) });
  if (p === "/travel/api/trip" && request.method === "GET") return jsonRes({ ok: true, ...(await planState(db, c, nowMs, deps)) });
  if (request.method !== "POST") return jsonRes({ ok: false, error: "POST only" }, 405);
  // Cross-site requests: JSON bodies need a CORS preflight this route never grants, and a foreign Origin is refused outright.
  const origin = request.headers.get("Origin");
  if (origin && origin !== u.origin) return jsonRes({ ok: false, error: "cross-origin request refused" }, 403);
  if (!String(request.headers.get("Content-Type") || "").includes("application/json")) return jsonRes({ ok: false, error: "JSON body required" }, 415);
  let body = {};
  try { body = await request.json(); } catch (e) { return jsonRes({ ok: false, error: "bad JSON" }, 400); }

  if (p === "/travel/api/chat") return jsonRes(await chatTurn(env, deps, { text: body.text, open: body.open === true }));
  if (p === "/travel/api/import") return jsonRes(await importText(env, deps, { text: body.text }));
  if (p === "/travel/api/stop") return jsonRes(await saveStop(db, deps, body, nowIso));
  if (p === "/travel/api/permit") return jsonRes(await savePermit(db, body, nowIso));
  if (p === "/travel/api/picks") {
    const st = await db.prepare("SELECT id, city, country, start_date, end_date, note FROM travel_stops WHERE id = ?").bind(String(body.stop || "")).first();
    if (!st) return jsonRes({ ok: false, error: "no such stop" }, 404);
    return jsonRes(await makePicks(db, deps, c, st, nowIso));
  }
  if (p === "/travel/api/pick-no") return jsonRes(await pickNo(db, String(body.id || ""), nowIso));
  if (p === "/travel/api/checkin-sent") {
    const ev = await db.prepare("SELECT id FROM events WHERE id = ? AND category = 'lodging'").bind(String(body.id || "")).first();
    if (!ev) return jsonRes({ ok: false, error: "no such stay" }, 404);
    await db.prepare("INSERT OR IGNORE INTO travel_notices (kind, ref, sent_at) VALUES ('checkin-sent', ?, ?)").bind(ev.id, nowIso).run();
    return jsonRes({ ok: true });
  }
  if (p === "/travel/api/react") {
    const action = body.action;
    if (action !== "pick" && action !== "no") return jsonRes({ ok: false, error: "action must be pick or no" }, 400);
    const o = await db.prepare("SELECT * FROM travel_options WHERE id = ?").bind(String(body.id || "")).first();
    if (!o) return jsonRes({ ok: false, error: "no such option" }, 404);
    return jsonRes({ ok: true, changed: await applyReaction(db, o, action, nowIso) });
  }
  if (p === "/travel/api/forget") {
    const id = String(body.id || "");
    const r = await db.prepare("UPDATE profile SET status = 'retracted', updated_at = ? WHERE id = ? AND facet = 'travel'").bind(nowIso, id).run();
    return jsonRes({ ok: true, changed: !!(r && r.meta && r.meta.changes) });
  }
  if (p === "/travel/api/model") {
    const m = String(body.model || "");
    const allowed = /^@cf\/[\w.\-/]+$/.test(m) && (typeof deps.modelAllowed !== "function" || deps.modelAllowed(m));
    if (!allowed) return jsonRes({ ok: false, error: "model not allowed here" }, 400);
    const rest = chatModels(c).filter((x) => x !== m);
    await db.prepare("INSERT INTO travel_config (key, value, updated_at) VALUES ('chat_models', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind([m].concat(rest).join(","), nowIso).run();
    return jsonRes({ ok: true, models: [m].concat(rest) });
  }
  if (p === "/travel/api/reset") {
    // a fresh conversation keeps everything learned; the old turns stay in D1 under a marker row so nothing is lost
    await db.prepare("CREATE TABLE IF NOT EXISTS travel_chat_archive AS SELECT * FROM travel_chat WHERE 0").run();
    await db.prepare("INSERT INTO travel_chat_archive SELECT * FROM travel_chat").run();
    await db.prepare("DELETE FROM travel_chat").run();
    return jsonRes({ ok: true });
  }
  if (p === "/travel/api/logout") {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Set-Cookie": sessionCookie("", 0) } });
  }
  return jsonRes({ ok: false, error: "not found" }, 404);
}

async function optionPage(request, env, deps, db, u, id, nowIso) {
  const key = deps.key !== undefined ? deps.key : signingKey(env);
  if (!(await verify(key, id, u.searchParams.get("s")))) return page("Link not valid", "<p>This link is not valid.</p>", 403);
  const o = await db.prepare("SELECT * FROM travel_options WHERE id = ?").bind(id).first();
  if (!o) return page("Not found", "<p>That suggestion is gone.</p>", 404);

  if (request.method === "POST") {
    let action = u.searchParams.get("action") || "";
    const ct = request.headers.get("Content-Type") || "";
    if (!action && ct.includes("application/x-www-form-urlencoded")) action = String((await request.formData()).get("action") || "");
    if (action !== "pick" && action !== "no") return page("Unknown action", "<p>Unknown action.</p>", 400);
    const open = await applyReaction(db, o, action, nowIso);
    const body = action === "pick"
      ? "<h1>" + esc(o.city) + " it is</h1><p>Nothing has been booked. When you're ready:</p><p><a href=\"" + esc(o.link) + "\">Stays in " + esc(o.city) + " from " + esc(o.checkin) + "</a></p><p class=\"muted\">Once the booking confirmation reaches your inbox I'll see it and stop suggesting other places for those nights. <a href=\"/travel\">Plan it in the chat</a>.</p>"
      : "<h1>Noted</h1><p>I won't suggest " + esc(o.city) + " again. <a href=\"/travel\">See other ideas in the chat</a>.</p>";
    return page(o.city, (open ? "" : "<p class=\"muted\">This suggestion was already closed (" + esc(o.status) + "); nothing changed.</p>") + body);
  }

  const action = (a, label, cls) => "<form method=\"post\" style=\"display:inline\"><input type=\"hidden\" name=\"action\" value=\"" + a + "\"><button class=\"" + cls + "\">" + label + "</button></form>";
  return page(o.city,
    "<h1>" + esc(o.city) + (o.country ? ", " + esc(o.country) : "") + (o.pick ? " ★" : "") + "</h1>" +
    "<p>" + esc(o.nights) + " night" + (o.nights == 1 ? "" : "s") + " from " + esc(o.checkin) + (o.kind ? " · " + esc(o.kind) : "") + (o.est_per_night ? " · about " + esc(o.est_per_night) + " " + esc(o.currency || "") + "/night" : "") + "</p>" +
    (o.why ? "<p>" + esc(o.why) + "</p>" : "") +
    "<p><a href=\"" + esc(o.link) + "\">See stays</a></p>" +
    (o.status === "proposed" || o.status === "picked" ? action("pick", "This one", "pick") + action("no", "Not for me", "") : "<p class=\"muted\">Closed: " + esc(o.status) + "</p>"));
}

// ---------------------------------------------------------------------------------------------------------------------
// TRAVEL-TRIP-1 (2026-10-19, owner asked for all five: a visa day counter, import by paste, a day-by-day plan with weather
// and fog notes, early check-in drafts, one preferences store). The plan is travel_stops (one row per stop; end_date is the
// day the party leaves), the visa limits are travel_permits (one row per person, country and entry). Both are personal data
// and live only in D1. Weather comes from Open-Meteo through deps.http (the worker's fetch, Open-Meteo hosts only):
// the forecast for the next 16 days, and the same dates last year beyond that ("last year" is labelled, never a forecast).
// Check-in requests are drafts for the owner to copy into the booking app; nothing is sent to a host from here.

export const WX_FORECAST_DAYS = 16;
export const VISA_WARN_DAYS = 7;          // a planned exit this close to the last allowed day is a warning
const FORECAST_TTL_MS = 3 * 3600e3;
// Indo-Gangetic plain and the Nepal Terai and valleys: dense winter fog (mid-December to early February) stops trains and flights.
export const FOG_BELT = { latMin: 23.5, latMax: 31.5, lonMin: 73, lonMax: 89 };
const WX_CODES = { 0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow", 80: "showers", 81: "showers", 82: "heavy showers", 95: "thunderstorms", 96: "thunderstorms", 99: "thunderstorms" };

export function daysBetween(a, b) { return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400e3); }

export function countryName(cc) {
  const code = String(cc || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return String(cc || "");
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch (e) { return code; }
}

// a real calendar day (V8's Date.parse rolls 2027-02-30 over to 2 March, so the round trip decides)
const isoDay = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return false; const t = Date.parse(s + "T12:00:00Z"); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };

export function shiftYear(iso, n) {
  const y = Number(iso.slice(0, 4)) + n;
  const md = iso.slice(5) === "02-29" ? "02-28" : iso.slice(5);
  return y + "-" + md;
}

export function fogSeason(lat, lon, day) {
  if (lat == null || lon == null) return false;
  const b = FOG_BELT;
  if (lat < b.latMin || lat > b.latMax || lon < b.lonMin || lon > b.lonMax) return false;
  const md = String(day).slice(5);
  return md >= "12-10" || md <= "02-10";
}

// Dates the party is in each country: a stop covers start_date through end_date (the travel day counts in both countries,
// as immigration counts it).
export function presence(stops) {
  const by = {};
  for (const s of stops || []) {
    if (!isoDay(s.start_date) || !isoDay(s.end_date) || s.end_date < s.start_date) continue;
    const cc = String(s.country || "").toUpperCase();
    by[cc] = by[cc] || new Set();
    for (let d = s.start_date; d <= s.end_date; d = addDays(d, 1)) by[cc].add(d);
  }
  return by;
}

// One line per permit: days used against days allowed, from entry to the planned exit (the last day of the unbroken stay
// that starts at entry), plus a calendar-year cap where the country has one.
export function visaStatus(permits, stops, today) {
  const pres = presence(stops);
  return (permits || []).map((p) => {
    const cc = String(p.country || "").toUpperCase();
    const days = pres[cc] || new Set();
    const limit = addDays(p.entry_date, Number(p.max_days) - 1);
    let exit = null;
    if (days.has(p.entry_date)) { exit = p.entry_date; while (days.has(addDays(exit, 1))) exit = addDays(exit, 1); }
    const used = exit ? daysBetween(p.entry_date, exit) + 1 : 0;
    const spare = exit ? daysBetween(exit, limit) : null;
    let status = !exit ? "unplanned" : spare < 0 ? "over" : spare <= VISA_WARN_DAYS ? "warn" : "ok";
    const name = countryName(cc);
    const who = p.person ? " (" + p.person + ")" : "";
    let text;
    if (!exit) text = name + who + ": no stop in the plan starts on the entry day " + p.entry_date + ".";
    else if (status === "over") text = name + who + ": the plan has " + used + " days from " + p.entry_date + " to " + exit + ", but the visa allows " + p.max_days + ". Leave by " + limit + " or get a longer visa.";
    else text = name + who + ": " + used + " of " + p.max_days + " days (" + p.entry_date + " to " + exit + "), " + spare + " to spare; last allowed day " + limit + ".";
    let now = null;
    if (exit && today >= p.entry_date && today <= exit) now = { day: daysBetween(p.entry_date, today) + 1, left: daysBetween(today, limit) };
    let year = null;
    if (Number(p.year_cap) > 0) {
      const y = p.entry_date.slice(0, 4);
      const n = [...days].filter((d) => d.slice(0, 4) === y).length;
      year = { year: y, used: n, cap: Number(p.year_cap) };
      if (n > year.cap) { status = "over"; text += " Calendar " + y + ": " + n + " days, over the " + year.cap + "-day yearly limit."; }
      else if (year.cap - n <= VISA_WARN_DAYS && status === "ok") { status = "warn"; text += " Calendar " + y + ": " + n + " of " + year.cap + " days."; }
    }
    return { id: p.id, person: p.person, country: cc, name, entry_date: p.entry_date, max_days: Number(p.max_days), year_cap: p.year_cap == null ? null : Number(p.year_cap), exit, used, limit, spare, status, now, year, text, note: p.note || "" };
  });
}

// What to fetch for one stop: the forecast part (next 16 days) and the same dates last year for anything later.
export function weatherRequests(stop, today) {
  if (stop.lat == null || stop.lon == null || !isoDay(stop.start_date) || !isoDay(stop.end_date) || stop.end_date < today) return [];
  const q = "latitude=" + Number(stop.lat).toFixed(2) + "&longitude=" + Number(stop.lon).toFixed(2) + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto";
  const s = stop.start_date < today ? today : stop.start_date;
  const lastFc = addDays(today, WX_FORECAST_DAYS - 1);
  const out = [];
  if (s <= lastFc) out.push({ kind: "forecast", url: "https://api.open-meteo.com/v1/forecast?" + q + "&start_date=" + s + "&end_date=" + (stop.end_date < lastFc ? stop.end_date : lastFc) });
  if (stop.end_date > lastFc) {
    const hs = s > lastFc ? s : addDays(lastFc, 1);
    out.push({ kind: "lastyear", url: "https://archive-api.open-meteo.com/v1/archive?" + q + "&start_date=" + shiftYear(hs, -1) + "&end_date=" + shiftYear(stop.end_date, -1) });
  }
  return out;
}

export function parseWeather(j, kind) {
  const d = (j && j.daily) || {};
  const out = {};
  (d.time || []).forEach((t, i) => {
    const day = kind === "lastyear" ? shiftYear(t, 1) : t;
    const code = d.weather_code ? d.weather_code[i] : null;
    out[day] = { kind, code, text: WX_CODES[code] || "", tmax: d.temperature_2m_max ? d.temperature_2m_max[i] : null, tmin: d.temperature_2m_min ? d.temperature_2m_min[i] : null, rain: d.precipitation_sum ? d.precipitation_sum[i] : null };
  });
  return out;
}

async function weatherFor(db, stops, today, deps, nowMs) {
  const wx = {};
  if (typeof deps.http !== "function") return wx;
  const reqs = [];
  for (const s of stops) for (const r of weatherRequests(s, today)) reqs.push({ ...r, stop: s.id });
  await Promise.all(reqs.map(async (r) => {
    let data = null;
    const row = await db.prepare("SELECT data, fetched_at FROM travel_weather WHERE url = ?").bind(r.url).first();
    if (row && (r.kind === "lastyear" || nowMs - Date.parse(row.fetched_at) < FORECAST_TTL_MS)) { try { data = JSON.parse(row.data); } catch (e) { data = null; } }
    if (!data) {
      try {
        data = parseWeather(await deps.http(r.url), r.kind);
        await db.prepare("INSERT INTO travel_weather (url, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at").bind(r.url, JSON.stringify(data), new Date(nowMs).toISOString()).run();
      } catch (e) {
        console.error(JSON.stringify({ evt: "travel-trip:weather-failed", kind: r.kind, error: String(e && e.message || e).slice(0, 160) }));
        if (row) { try { data = JSON.parse(row.data); } catch (e2) { data = null; } }
      }
    }
    wx[r.stop] = Object.assign(wx[r.stop] || {}, data || {});
  }));
  return wx;
}

// Day by day from today (or the first stop) to the last stop's departure: where the party sleeps, travel days, the weather
// and fog notes, and the booking that covers the night when one has landed in events.
export function dayPlan(stops, today, wx, lodging) {
  const list = (stops || []).filter((s) => isoDay(s.start_date) && isoDay(s.end_date) && s.end_date >= s.start_date)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0));
  if (!list.length) return [];
  const last = list.reduce((m, s) => (s.end_date > m ? s.end_date : m), list[0].end_date);
  if (last < today) return [];
  const first = list[0].start_date > today ? list[0].start_date : today;
  const days = [];
  for (let d = first; d <= last && days.length < 220; d = addDays(d, 1)) {
    const sleep = list.find((s) => s.start_date <= d && s.end_date > d) || null;
    const leaving = list.find((s) => s.end_date === d && s !== sleep) || null;
    const here = sleep || leaving;
    const w = here && wx && wx[here.id] ? wx[here.id][d] || null : null;
    const flags = [];
    // The long fog note goes on travel days (from the place being left, where a delayed departure strands the party) and
    // on the first fog-season day of a stop; the days in between carry a short reminder.
    const moving = leaving && leaving !== sleep;
    if (moving && fogSeason(leaving.lat, leaving.lon, d)) flags.push("Travel day in fog season: dense morning fog in " + leaving.city + " often delays trains and flights. Leave after late morning and keep a buffer.");
    else if (here && fogSeason(here.lat, here.lon, d)) flags.push(days.length && days[days.length - 1].stop === here.id && fogSeason(here.lat, here.lon, addDays(d, -1)) ? "Fog season." : "Fog season here: dense morning fog often delays trains and flights. Plan moves for late morning.");
    if (w && (w.code === 45 || w.code === 48)) flags.push(w.kind === "forecast" ? "Fog in the forecast." : "There was fog on this date last year.");
    if (w && w.kind === "forecast" && w.rain != null && w.rain >= 20) flags.push("Heavy rain forecast (" + Math.round(w.rain) + " mm).");
    const booked = sleep ? (lodging || []).find((e) => e.start_date <= d && e.end_date > d) || null : null;
    days.push({
      day: d,
      city: sleep ? sleep.city : null,
      country: sleep ? sleep.country : null,
      stop: sleep ? sleep.id : null,
      move: leaving && sleep && leaving.city !== sleep.city ? leaving.city + " to " + sleep.city : (leaving && !sleep ? "Leave " + leaving.city : null),
      note: sleep && sleep.start_date === d ? sleep.note || "" : "",
      wx: w,
      flags,
      booked: booked ? (booked.title || booked.city) : null
    });
  }
  return days;
}

// A request for the host, in the party's voice. ev: a lodging event; c: config (adults, checkin_arrival).
export function checkinDraft(ev, c) {
  const n = Math.max(1, Number(c && c.adults) || 1);
  const we = n > 1;
  const when = String(c && c.checkin_arrival || "around midday");
  return [
    "Hello,",
    "",
    (we ? "We have" : "I have") + " a booking from " + ev.start_date + (ev.booking_ref ? " (reference " + ev.booking_ref + ")" : "") + (we ? " for " + n + " adults" : "") + " and expect to arrive " + when + ".",
    "Would an early check-in be possible? If not, could " + (we ? "we leave our bags" : "I leave my bag") + " with you until the room is ready?",
    "",
    "Thank you!"
  ].join("\n");
}

async function tripRows(db, today) {
  const stops = await many(db, "SELECT id, trip, city, country, lat, lon, start_date, end_date, note FROM travel_stops WHERE end_date >= ? ORDER BY start_date", addDays(today, -1));
  const permits = await many(db, "SELECT id, person, country, entry_date, max_days, year_cap, note FROM travel_permits ORDER BY entry_date");
  return { stops, permits };
}

// Lodging starting today through the next 3 days, each with its draft and whether the owner marked it sent.
async function checkinCards(db, c, today) {
  const evs = await many(db, "SELECT id, title, city, country, start_date, end_date, booking_ref FROM events WHERE category = 'lodging' AND start_date >= ? AND start_date <= ? ORDER BY start_date", today, addDays(today, 3));
  const out = [];
  for (const ev of evs) {
    const sent = await db.prepare("SELECT sent_at FROM travel_notices WHERE kind = 'checkin-sent' AND ref = ?").bind(ev.id).first();
    out.push({ id: ev.id, title: ev.title || ev.city, city: ev.city, start_date: ev.start_date, draft: checkinDraft(ev, c), sent: sent ? sent.sent_at : null });
  }
  return out;
}

// TRAVEL-PILLARS-1 (2026-10-26, owner: "where to go, where to sleep, what to eat, how to get around, and what to do ... it's
// basically only two"). The page groups the plan into two pillars. Places: each stop with where to sleep (the booked stay
// covering its nights, or a stay search), what to eat and what to do (one tap asks the chat for 2-3 specific picks), and its
// weather. Getting around: each move between stops with its booked journey, a transit search and travel-day fog notes,
// then the day-by-day list.
export function placeCards(stops, today, wx, lodging, c, picks) {
  return (stops || []).filter((s) => isoDay(s.start_date) && isoDay(s.end_date) && s.end_date > s.start_date && s.end_date >= today)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))
    .map((s) => {
      const nights = daysBetween(s.start_date, s.end_date);
      const stays = (lodging || []).filter((e) => e.start_date < s.end_date && e.end_date > s.start_date && (!e.city || !s.city || norm(e.city).includes(norm(s.city).split(" ")[0]) || norm(s.city).includes(norm(e.city))));
      const covered = new Set();
      for (const e of stays) for (let d = e.start_date; d < e.end_date; d = addDays(d, 1)) if (d >= s.start_date && d < s.end_date) covered.add(d);
      const w = wx && wx[s.id] ? Object.values(wx[s.id]) : [];
      const hi = w.map((x) => x.tmax).filter((x) => x != null), lo = w.map((x) => x.tmin).filter((x) => x != null);
      const where = s.city + (s.country ? ", " + countryName(s.country) : "");
      const span = s.start_date + " to " + s.end_date;
      return {
        id: s.id, city: s.city, country: s.country, country_name: countryName(s.country), start_date: s.start_date, end_date: s.end_date, nights, note: s.note || "",
        sleep: { booked: stays.map((e) => e.title || e.city), nights_open: nights - covered.size,
          search: bookingLink({ city: s.city, country: countryName(s.country), checkin: s.start_date, nights, maxPerNight: c.max_per_night, currency: c.currency, adults: c.adults }) },
        weather: hi.length ? { high: Math.round(Math.max(...hi)), low: Math.round(Math.min(...lo)), kind: w.some((x) => x.kind === "forecast") ? "forecast" : "lastyear" } : null,
        fog: fogSeason(s.lat, s.lon, s.start_date) || fogSeason(s.lat, s.lon, addDays(s.end_date, -1)),
        eat: pickList(picks, s, "eat"),
        do: pickList(picks, s, "do"),
        ask: {
          sleep: "Where should we stay in " + where + " (" + span + ")? Two or three specific places that fit us, with the area for each.",
          eat: "What should we eat in " + where + " (" + span + ")? Two or three specific places or dishes, and why they fit us.",
          do: "What should we do in " + where + " (" + span + ")? Two or three specific things that fit us, not the generic circuit."
        }
      };
    });
}

export function moveCards(stops, today, travel) {
  const list = (stops || []).filter((s) => isoDay(s.start_date) && isoDay(s.end_date)).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const out = [];
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    const day = b.start_date;
    if (day < today || norm(a.city) === norm(b.city)) continue;
    const from = a.city + (a.country ? ", " + countryName(a.country) : ""), to = b.city + (b.country ? ", " + countryName(b.country) : "");
    const booked = (travel || []).filter((t) => t.start_date === day || (t.start_date === addDays(day, -1) && t.end_date === day)).map((t) => t.title || t.city);
    out.push({ day, from: a.city, to: b.city, cross: (a.country || "") !== (b.country || ""), booked, transit: transitLink(from, to),
      fog: fogSeason(a.lat, a.lon, day),
      ask: "How should we get from " + from + " to " + to + " on " + day + "? Compare train, bus and flight on door-to-door time and cost, and say which to book." });
  }
  return out;
}

export async function planState(db, c, nowMs, deps) {
  const today = localParts(nowMs, c.tz).day;
  const { stops, permits } = await tripRows(db, today);
  const lodging = await many(db, "SELECT title, city, start_date, end_date FROM events WHERE category = 'lodging' AND end_date >= ?", today);
  const travel = await many(db, "SELECT title, city, start_date, end_date FROM events WHERE category = 'travel' AND start_date >= ?", addDays(today, -1));
  const wx = await weatherFor(db, stops, today, deps || {}, nowMs);
  const picks = await many(db, "SELECT id, stop_id, city, kind, rank, name, area, why FROM travel_picks WHERE status = 'open' ORDER BY rank");
  return {
    today,
    places: placeCards(stops, today, wx, lodging, c, picks),
    moves: moveCards(stops, today, travel),
    stops: stops.map((s) => ({ ...s, country_name: countryName(s.country) })),
    visa: visaStatus(permits, (await many(db, "SELECT city, country, start_date, end_date FROM travel_stops")), today),
    days: dayPlan(stops, today, wx, lodging),
    checkins: await checkinCards(db, c, today),
    forward_to: c.forward_to || ""
  };
}

export const IMPORT_SYSTEM = [
  "You turn pasted travel text (booking confirmations, emails, notes) into structured bookings. Extract only what the text states; never guess a date, place or reference.",
  "Reply with JSON only, exactly this shape:",
  "{\"bookings\":[{\"category\":\"lodging|travel\",\"title\":\"short name, e.g. the hotel or 'Flight KTM to DEL'\",\"venue\":\"\",\"city\":\"\",\"country\":\"two-letter code\",\"start_date\":\"YYYY-MM-DD\",\"end_date\":\"YYYY-MM-DD\",\"booking_ref\":\"\"}],\"learned\":[{\"label\":\"two to four words\",\"statement\":\"one sentence about the traveller's preference\"}]}",
  "lodging: start_date is check-in, end_date is check-out, city is where the stay is. travel: one row per flight, train or bus leg; start_date is the departure day, city is the destination.",
  "learned: only preferences the text plainly shows (a room type they chose, a class they booked). Use [] when there is nothing."
].join("\n");

export function parseImport(text) {
  const j = firstJson(text);
  const rows = j && Array.isArray(j.bookings) ? j.bookings : [];
  const bookings = [];
  for (const b of rows.slice(0, 20)) {
    if (!b || typeof b !== "object") continue;
    const category = b.category === "lodging" || b.category === "travel" ? b.category : "";
    const start = String(b.start_date || "");
    let end = String(b.end_date || "");
    if (!category || !isoDay(start)) continue;
    if (category === "travel" && !isoDay(end)) end = start;
    if (!isoDay(end) || end < start || (category === "lodging" && end === start)) continue;
    const title = clean(b.title, 120) || clean(b.venue, 120) || clean(b.city, 80);
    if (!title) continue;
    const cc = clean(b.country, 40);
    bookings.push({ category, title, venue: clean(b.venue, 120), city: clean(b.city, 80), country: /^[A-Za-z]{2}$/.test(cc) ? cc.toUpperCase() : cc, start_date: start, end_date: end, booking_ref: clean(b.booking_ref, 40).replace(/[^A-Za-z0-9-]/g, "") });
  }
  const learned = (j && Array.isArray(j.learned) ? j.learned : []).map((l) => ({ label: clean(l && l.label, 50), statement: clean(l && l.statement, 240) })).filter((l) => l.label && l.statement).slice(0, 3);
  return { bookings, learned };
}

async function hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Paste import: a model reads the text, the code validates every field, and each booking becomes a personal-life.events
// row (source travel-paste) that the planner, the trip view and the radar see like a forwarded confirmation. Re-pasting the
// same booking updates the same row.
export async function importText(env, deps, input) {
  const db = env.PERSONAL;
  const nowMs = deps.now || Date.now();
  const nowIso = new Date(nowMs).toISOString();
  await ensureTravel(db, nowIso);
  const c = await cfg(db);
  const text = String(input && input.text || "").trim().slice(0, 12000);
  if (text.length < 20) return { ok: false, error: "Paste the confirmation text first." };
  if (typeof deps.ai !== "function") return { ok: false, error: "no model caller" };
  const today = localParts(nowMs, c.tz).day;
  const messages = [{ role: "system", content: IMPORT_SYSTEM + "\nToday is " + today + "." }, { role: "user", content: text }];
  let parsed = null, lastErr = "";
  for (const m of chatModels(c, deps.modelAllowed)) {
    try {
      const pi = parseImport(modelText(await deps.ai(m, { messages, max_tokens: 1500, temperature: 0.1 })));
      if (pi.bookings.length || pi.learned.length) { parsed = pi; break; }
      lastErr = m + " found no booking";
    } catch (e) { lastErr = m + ": " + String(e && e.message || e).slice(0, 160); }
  }
  if (!parsed) return { ok: false, error: "I could not find a booking with dates in that text (" + lastErr + ")." };
  const added = [];
  for (const b of parsed.bookings) {
    const id = "paste:" + (await hex([b.category, b.start_date, b.end_date, norm(b.city), b.booking_ref, norm(b.title)].join("|"))).slice(0, 20);
    await db.prepare("INSERT INTO events (id, category, title, venue, city, country, start_date, end_date, booking_ref, source, source_subject, ingested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'travel-paste', ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, venue = excluded.venue, city = excluded.city, country = excluded.country, booking_ref = excluded.booking_ref, ingested_at = excluded.ingested_at")
      .bind(id, b.category, b.title, b.venue || null, b.city || null, b.country || null, b.start_date, b.end_date, b.booking_ref || null, text.slice(0, 120).replace(/\s+/g, " "), nowIso).run();
    added.push({ id, ...b });
  }
  const learned = await learnPrefs(db, parsed.learned, "travel import " + today, nowIso);
  return { ok: true, added, learned };
}

async function geocode(deps, city, country) {
  if (typeof deps.http !== "function") return null;
  try {
    const j = await deps.http("https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=" + encodeURIComponent(city) + (/^[A-Z]{2}$/.test(country || "") ? "&countryCode=" + country : ""));
    const r = j && j.results && j.results[0];
    return r && typeof r.latitude === "number" ? { lat: r.latitude, lon: r.longitude, country: String(r.country_code || "").toUpperCase() } : null;
  } catch (e) { console.error(JSON.stringify({ evt: "travel-trip:geocode-failed", error: String(e && e.message || e).slice(0, 160) })); return null; }
}

const rid = (p) => { const b = new Uint8Array(9); crypto.getRandomValues(b); return p + [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); };

export async function saveStop(db, deps, body, nowIso) {
  const id = /^st_[0-9a-f]{18}$/.test(String(body.id || "")) ? body.id : "";
  if (body.delete === true) {
    if (!id) return { ok: false, error: "no such stop" };
    await db.prepare("DELETE FROM travel_stops WHERE id = ?").bind(id).run();
    return { ok: true, deleted: id };
  }
  const city = clean(body.city, 80);
  let country = clean(body.country, 2).toUpperCase();
  const start = String(body.start_date || ""), end = String(body.end_date || "");
  if (!city || !isoDay(start) || !isoDay(end) || end <= start) return { ok: false, error: "A stop needs a place, an arrival day and a later leaving day." };
  const old = id ? await db.prepare("SELECT city, country, lat, lon FROM travel_stops WHERE id = ?").bind(id).first() : null;
  let lat = old ? old.lat : null, lon = old ? old.lon : null;
  if (!old || norm(old.city) !== norm(city) || (country && old.country !== country) || lat == null) {
    const g = await geocode(deps, city, country);
    lat = g ? g.lat : null; lon = g ? g.lon : null;
    if (g && !country) country = g.country;
  }
  if (!/^[A-Z]{2}$/.test(country)) country = old && old.country ? old.country : "";
  const sid = id || rid("st_");
  await db.prepare("INSERT INTO travel_stops (id, trip, city, country, lat, lon, start_date, end_date, note, updated_at) VALUES (?, 'next', ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET city = excluded.city, country = excluded.country, lat = excluded.lat, lon = excluded.lon, start_date = excluded.start_date, end_date = excluded.end_date, note = excluded.note, updated_at = excluded.updated_at")
    .bind(sid, city, country || null, lat, lon, start, end, clean(body.note, 300) || null, nowIso).run();
  return { ok: true, id: sid, located: lat != null };
}

export async function savePermit(db, body, nowIso) {
  const id = /^vp_[0-9a-f]{18}$/.test(String(body.id || "")) ? body.id : "";
  if (body.delete === true) {
    if (!id) return { ok: false, error: "no such visa" };
    await db.prepare("DELETE FROM travel_permits WHERE id = ?").bind(id).run();
    return { ok: true, deleted: id };
  }
  const person = clean(body.person, 40), country = clean(body.country, 2).toUpperCase(), entry = String(body.entry_date || "");
  const max = Math.round(Number(body.max_days)), cap = body.year_cap == null || body.year_cap === "" ? null : Math.round(Number(body.year_cap));
  if (!person || !/^[A-Z]{2}$/.test(country) || !isoDay(entry) || !(max >= 1 && max <= 3650) || (cap != null && !(cap >= 1 && cap <= 366))) return { ok: false, error: "A visa needs a person, a country, an entry day and the days allowed." };
  const vid = id || rid("vp_");
  await db.prepare("INSERT INTO travel_permits (id, person, country, entry_date, max_days, year_cap, note, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET person = excluded.person, country = excluded.country, entry_date = excluded.entry_date, max_days = excluded.max_days, year_cap = excluded.year_cap, note = excluded.note, updated_at = excluded.updated_at")
    .bind(vid, person, country, entry, max, cap, clean(body.note, 200) || null, nowIso).run();
  return { ok: true, id: vid };
}

// Plan lines for the chat model, so a proposal respects the dated stops and the visa limits.
export function planText(stops, visa) {
  const s = (stops || []).slice(0, 30).map((x) => "- " + x.city + (x.country ? ", " + x.country : "") + ": " + x.start_date + " to " + x.end_date + (x.note ? " (" + x.note + ")" : "")).join("\n");
  const v = (visa || []).map((x) => "- " + x.text).join("\n");
  return (s ? "Planned stops (not booked unless listed under Booked ahead):\n" + s : "") + (v ? (s ? "\n" : "") + "Visa limits:\n" + v : "");
}

// TRAVEL-PICKS-1 (2026-10-26). Rowan's pillars: where to go, sleep, eat and what to do ("basically only two": places and
// getting around). Sleep had a search link; eat and do were only a chat question. Each stop now carries three places to eat
// and three things to do, made from the profile on the tick (one stop per tick) or on demand, never asked as a question.
// A "not for me" is a travel_reactions row (reaction 'no', kind eat|do) and every later pick for any city avoids it.
// Links are map searches for the named place, never a made-up listing or booking.
export const PICKS_SYSTEM = [
  "You suggest where to eat and what to do for a traveller who loves travel and hates planning; they sometimes travel with a companion (the profile says who and how). You never ask questions.",
  "Reply with JSON only, exactly this shape: {\"eat\":[{\"name\":\"\",\"area\":\"\",\"why\":\"\"}],\"do\":[{\"name\":\"\",\"area\":\"\",\"why\":\"\"}]}",
  "Exactly 3 of each. name: a real, specific place, market, dish-and-place or activity that exists in that city, as it is known locally. area: the neighbourhood. why: one plain sentence on why it fits this traveller, from the profile.",
  "Prefer what locals use over the generic tourist circuit. Respect every diet, budget, mobility and logistics fact in the profile. Never repeat anything listed as rejected."
].join("\n");

export function picksPrompt(stop, profileRows, rejected) {
  const facts = (profileRows || []).map((r) => "- " + String(r.label || "") + ": " + String(r.statement || "")).join("\n").slice(0, PROFILE_CHARS);
  const where = stop.city + (stop.country ? ", " + countryName(stop.country) : "");
  const month = isoDay(stop.start_date) ? new Date(stop.start_date + "T12:00:00Z").toLocaleString("en-GB", { month: "long", timeZone: "UTC" }) : "";
  return [
    { role: "system", content: PICKS_SYSTEM },
    { role: "user", content: [
      "Stop: " + where + ", " + stop.start_date + " to " + stop.end_date + (month ? " (" + month + ")" : "") + (stop.note ? ". Note: " + stop.note : "") + ".",
      "Profile:\n" + (facts || "- (no stored preferences yet)"),
      "Rejected before (never suggest): " + ((rejected || []).slice(0, 30).join(", ") || "none")
    ].join("\n\n") }
  ];
}

export function parsePicks(text) {
  const j = firstJson(text) || {};
  const out = { eat: [], do: [] };
  for (const kind of ["eat", "do"]) {
    const seen = new Set();
    for (const x of Array.isArray(j[kind]) ? j[kind] : []) {
      const name = clean(x && x.name, 80);
      if (!name || seen.has(norm(name))) continue;
      seen.add(norm(name));
      out[kind].push({ name, area: clean(x.area, 60), why: clean(x.why, 220) });
      if (out[kind].length === 3) break;
    }
  }
  return out;
}

export function mapLink(name, area, city, country) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([name, area, city, countryName(country)].filter(Boolean).join(", "));
}

function pickList(picks, stop, kind) {
  return (picks || []).filter((x) => x.stop_id === stop.id && x.kind === kind && norm(x.city) === norm(stop.city))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => ({ id: x.id, name: x.name, area: x.area || "", why: x.why || "", map: mapLink(x.name, x.area, stop.city, stop.country) }));
}

// The next stop within 60 days that has no open picks for its current city.
export async function picksDue(db, today) {
  return db.prepare("SELECT s.id, s.city, s.country, s.start_date, s.end_date, s.note FROM travel_stops s WHERE s.end_date >= ? AND s.start_date <= ? AND NOT EXISTS (SELECT 1 FROM travel_picks p WHERE p.stop_id = s.id AND p.status = 'open' AND lower(p.city) = lower(s.city)) ORDER BY s.start_date LIMIT 1")
    .bind(today, addDays(today, 60)).first();
}

export async function makePicks(db, deps, c, stop, nowIso) {
  if (typeof deps.ai !== "function") return { ok: false, error: "no model caller" };
  let profile = [];
  try { profile = await many(db, "SELECT label, statement FROM profile WHERE facet IN ('travel','likes','dislikes','logistics') AND (domain IS NULL OR domain IN ('personal','straddle')) AND (status IS NULL OR status IN ('accepted','active')) ORDER BY CASE facet WHEN 'travel' THEN 0 ELSE 1 END, confidence DESC LIMIT 80"); }
  catch (e) { console.error(JSON.stringify({ evt: "travel-picks:profile-read", error: String(e && e.message || e).slice(0, 200) })); }
  const rejected = (await many(db, "SELECT p.name FROM travel_reactions r JOIN travel_picks p ON p.id = r.option_id WHERE r.reaction = 'no' AND r.kind IN ('eat','do') ORDER BY r.ts DESC LIMIT 30")).map((r) => r.name);
  const messages = picksPrompt(stop, profile, rejected);
  const models = [...new Set([...chatModels(c, deps.modelAllowed), ...MODELS])];
  let got = null, model = null, lastErr = "";
  for (const m of models) {
    try {
      const pk = parsePicks(modelText(await deps.ai(m, { messages, max_tokens: 1200, temperature: 0.5 })));
      const rej = new Set(rejected.map(norm));
      pk.eat = pk.eat.filter((x) => !rej.has(norm(x.name))); pk.do = pk.do.filter((x) => !rej.has(norm(x.name)));
      if (pk.eat.length >= 2 && pk.do.length >= 2) { got = pk; model = m; break; }
      lastErr = m + " gave too few";
    } catch (e) { lastErr = m + ": " + String(e && e.message || e).slice(0, 160); }
  }
  if (!got) return { ok: false, error: "No suggestions this time (" + lastErr + "). Try again in a minute." };
  await db.prepare("UPDATE travel_picks SET status = 'replaced' WHERE stop_id = ? AND status = 'open'").bind(stop.id).run();
  for (const kind of ["eat", "do"]) {
    for (const [i, x] of got[kind].entries()) {
      await db.prepare("INSERT INTO travel_picks (id, stop_id, city, kind, rank, name, area, why, model, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)")
        .bind(rid("pk_"), stop.id, stop.city, kind, i + 1, x.name, x.area || null, x.why || null, model, nowIso).run();
    }
  }
  return { ok: true, model, eat: got.eat.length, do: got.do.length };
}

export async function pickNo(db, id, nowIso) {
  if (!/^pk_[0-9a-f]{18}$/.test(id)) return { ok: false, error: "no such suggestion" };
  const x = await db.prepare("SELECT id, city, kind, status FROM travel_picks WHERE id = ?").bind(id).first();
  if (!x) return { ok: false, error: "no such suggestion" };
  if (x.status !== "open") return { ok: true, changed: false };
  await db.prepare("UPDATE travel_picks SET status = 'no' WHERE id = ?").bind(id).run();
  await db.prepare("INSERT INTO travel_reactions (option_id, trip_key, reaction, city, kind, ts) VALUES (?, NULL, 'no', ?, ?, ?)").bind(id, x.city, x.kind, nowIso).run();
  return { ok: true, changed: true };
}
