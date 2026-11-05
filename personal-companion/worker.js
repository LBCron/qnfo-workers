var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
import { WorkflowEntrypoint } from "cloudflare:workers";
// SINGLE-MODULE-INLINE-1: wellbeing.js + wellbeing-wire.js inlined as namespaces by scripts/inline-companion-modules.mjs; the deploy uploads worker.js as ONE module (no relative imports allowed), and the source text below keeps its comments so the marker-based suites still find their anchors. Edit the sibling modules and re-run the script.
var WBW = (() => {
var WB = (() => {
// personal-companion/wellbeing.js
// WELLBEING-LOOP-1 — the inbound side of the companion.
//
// WHY THIS FILE EXISTS (measured 2026-10-17 against personal-life D1 e8d6c61a):
//   chat 9206 · notes 780 · events 151   <- rich input
//   journal 0 · habits 0 · habit_log 0   <- no affect signal at all, ever
//   activity 3, last row 2026-08-28      <- 50 days stale; "what I actually did" is unknown
//   proactive_signals 30, shown 9, acted 0  <- 31 days of suggestions, none ever came back
//
// So the companion could write TO the owner and list his bookings. It could not tell how he was,
// and nothing it suggested ever closed. That is an outbound publisher plus an event lister.
// This module is the loop: capture -> decide -> ask -> observe -> adapt, and a FIXED escalation
// path when things are bad. Nothing here is model-generated: the owner's words are his own.
//
// Design rules this file enforces (each is a test in wellbeing.test.mjs):
//   1. One ask at a time. A nudge that is not answered expires; it is never re-sent.
//   2. Escalate only after a done. An expired ask drops one rung, never climbs.
//   3. Low mood caps the ladder at body (step 2). No task-shaped asks when mood <= 2.
//   4. Three unanswered in a row -> presence only, one message, no ask, for the rest of the day.
//   5. A kind that fires 6+ times with 0 done is retired automatically. (This is the observed defect.)
//   6. The crisis block is a static template filled from config. It can never hallucinate a number.

const WELLBEING_VERSION = "1.0.0";

// A fixed ladder. Step size is deliberately tiny at the bottom: on a bad day the win is water.
const LADDER = [
  { step: 1, kind: "micro",   minutes: 2,  slaMinutes: 90,   minHour: 7   },
  { step: 2, kind: "body",    minutes: 15, slaMinutes: 240,  minHour: 8   },
  { step: 3, kind: "contact", minutes: 10, slaMinutes: 720,  minHour: 10  },
  { step: 4, kind: "care",    minutes: 30, slaMinutes: 1440, minHour: 10  }
];

const DEFAULT_CONFIG = {
  tz: "Europe/Amsterdam",      // IANA zone; the UTC offset is resolved per instant, so DST is not a bug
  tz_offset_min: 120,          // fallback only, if Intl is unavailable
  quiet_start: 22,             // local hour
  quiet_end: 7.5,
  max_per_day: 3,
  min_gap_min: 150,
  max_unanswered: 3,
  retire_after_fired: 6,
  retire_below_done_rate: 0.05,
  // Owner-specific. Empty by default ON PURPOSE: the escalation block must never invent a phone number.
  backstop_name: "",
  backstop_contact: "",
  crisis_lines: [],
  // Names the contact rung may use. Empty means the generic "message one person" line; a name is
  // far more likely to be acted on than a category, so fill this the moment the owner names anyone.
  contact_candidates: [],
  presence_line: "I'm here. Nothing needed from you right now.",
  // Candidate asks per rung. Replace with the owner's own list; these are placeholders that pass tests.
  candidates: {
    1: ["Drink a glass of water.", "Stand up and open a window.", "Six slow breaths, out longer than in.", "Put one thing back where it lives."],
    2: ["Step outside for five minutes, no phone.", "Shower, even if that's the whole day.", "Eat something with protein in it.", "Walk to the end of the street and back."],
    3: ["Message one person. One line is enough.", "Reply to the message you've been avoiding.", "Say yes to the next small invitation."],
    4: ["Book the appointment. Just the booking.", "Write down what you'd tell a doctor, one paragraph.", "Send the message that asks for help."]
  }
};

// ---------------------------------------------------------------- schema

const DDL = [
  `CREATE TABLE IF NOT EXISTS wellbeing_checkins (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts TEXT NOT NULL,
     day TEXT NOT NULL,
     mood INTEGER,
     energy INTEGER,
     sleep_hours REAL,
     load TEXT,
     note TEXT,
     source TEXT NOT NULL DEFAULT 'reply',
     raw_json TEXT,
     UNIQUE(day, source)
   )`,

  `CREATE TRIGGER IF NOT EXISTS wellbeing_checkin_range_ins
   BEFORE INSERT ON wellbeing_checkins
   WHEN (NEW.mood IS NOT NULL AND (NEW.mood < 1 OR NEW.mood > 5))
     OR (NEW.energy IS NOT NULL AND (NEW.energy < 1 OR NEW.energy > 5))
     OR (NEW.sleep_hours IS NOT NULL AND (NEW.sleep_hours < 0 OR NEW.sleep_hours > 24))
   BEGIN SELECT RAISE(ABORT, 'WELLBEING-RANGE-1'); END`,

  // A check-in with no mood, no energy and no words is not a check-in.
  `CREATE TRIGGER IF NOT EXISTS wellbeing_checkin_empty_ins
   BEFORE INSERT ON wellbeing_checkins
   WHEN NEW.mood IS NULL AND NEW.energy IS NULL AND (NEW.note IS NULL OR length(trim(NEW.note)) = 0)
   BEGIN SELECT RAISE(ABORT, 'WELLBEING-EMPTY-1'); END`,

  `CREATE TABLE IF NOT EXISTS companion_nudges (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts TEXT NOT NULL,
     day TEXT NOT NULL,
     kind TEXT NOT NULL,
     ladder_step INTEGER NOT NULL DEFAULT 1,
     ask TEXT NOT NULL,
     minutes INTEGER,
     expected TEXT,
     due_at TEXT,
     state TEXT NOT NULL DEFAULT 'queued',
     sent_at TEXT,
     shown_at TEXT,
     closed_at TEXT,
     response TEXT,
     outcome TEXT,
     superseded_by INTEGER,
     reason TEXT,
     context_json TEXT
   )`,

  `CREATE TRIGGER IF NOT EXISTS nudge_state_ins
   BEFORE INSERT ON companion_nudges
   WHEN NEW.state NOT IN ('queued','sent','shown','done','declined','expired','superseded')
   BEGIN SELECT RAISE(ABORT, 'NUDGE-STATE-1'); END`,

  // done is a claim about the world; it must carry the moment it closed.
  `CREATE TRIGGER IF NOT EXISTS nudge_close_ins
   BEFORE INSERT ON companion_nudges
   WHEN NEW.state = 'done' AND NEW.closed_at IS NULL
   BEGIN SELECT RAISE(ABORT, 'NUDGE-CLOSE-1'); END`,

  // One open ask of a given kind per day. Expired/declined/superseded do not block a retry tomorrow.
  `CREATE TRIGGER IF NOT EXISTS nudge_dup_ins
   BEFORE INSERT ON companion_nudges
   WHEN EXISTS (
     SELECT 1 FROM companion_nudges
      WHERE day = NEW.day AND kind = NEW.kind
        AND state NOT IN ('expired','declined','superseded')
   )
   BEGIN SELECT RAISE(ABORT, 'NUDGE-DUP-1'); END`,

  `CREATE TABLE IF NOT EXISTS wellbeing_config (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,

  // The feedback loop, per kind. This is the table the old proactive_signals never had a reader for.
  `CREATE VIEW IF NOT EXISTS v_nudge_loop AS
   SELECT kind,
          COUNT(*) AS fired,
          SUM(CASE WHEN shown_at IS NOT NULL THEN 1 ELSE 0 END) AS shown,
          SUM(CASE WHEN state = 'done' THEN 1 ELSE 0 END) AS done,
          SUM(CASE WHEN state = 'expired' THEN 1 ELSE 0 END) AS expired,
          SUM(CASE WHEN state = 'declined' THEN 1 ELSE 0 END) AS declined,
          ROUND(1.0 * SUM(CASE WHEN state = 'done' THEN 1 ELSE 0 END) / COUNT(*), 3) AS done_rate,
          MAX(ts) AS last_ts
     FROM companion_nudges
    WHERE ts >= datetime('now', '-28 days')
    GROUP BY kind`,

  // Mood against its own recent baseline, not against a population norm.
  `CREATE VIEW IF NOT EXISTS v_wellbeing_trend AS
   SELECT day, mood, energy, sleep_hours,
          (SELECT ROUND(AVG(mood), 2) FROM wellbeing_checkins b
            WHERE b.day <= a.day AND b.day > date(a.day, '-7 days')) AS avg7,
          (SELECT ROUND(AVG(mood), 2) FROM wellbeing_checkins c
            WHERE c.day <= a.day AND c.day > date(a.day, '-28 days')) AS avg28
     FROM wellbeing_checkins a
    ORDER BY day`,

  // COVERAGE-SINGLE-ROW-1: one row, so a single read answers "is the loop actually being fed?".
  `CREATE VIEW IF NOT EXISTS v_wellbeing_coverage AS
   SELECT
     (SELECT MAX(day) FROM wellbeing_checkins) AS checkin_last,
     (SELECT COUNT(*) FROM wellbeing_checkins WHERE day >= date('now','-7 days')) AS checkins_7d,
     (SELECT MAX(ts) FROM companion_nudges) AS nudge_last,
     (SELECT COUNT(*) FROM companion_nudges WHERE ts >= datetime('now','-7 days')) AS nudges_7d,
     (SELECT COUNT(*) FROM companion_nudges WHERE closed_at IS NOT NULL AND closed_at >= datetime('now','-7 days')) AS answered_7d,
     (SELECT MAX(ts) FROM journal) AS journal_last,
     (SELECT COUNT(*) FROM journal WHERE ts >= datetime('now','-7 days')) AS journal_7d,
     (SELECT MAX(date) FROM activity) AS activity_last`
];

async function ensureWellbeingSchema(db) {
  for (const sql of DDL) await db.prepare(sql).run();
  // Seed config keys that are absent. Never overwrite: the owner's words win.
  const nowIso = new Date().toISOString();
  for (const [key, value] of Object.entries(flatConfig(DEFAULT_CONFIG))) {
    await db.prepare(
      "INSERT INTO wellbeing_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING"
    ).bind(key, typeof value === "string" ? value : JSON.stringify(value), nowIso).run();
  }
}

function flatConfig(cfg) {
  const out = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k === "candidates") continue;         // per-rung lists are code defaults, not config rows
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------- capture

const str = (v) => (v === null || v === undefined ? "" : String(v));

async function recordCheckin(db, { mood, energy, sleep_hours, load, note, source = "reply", raw, ts } = {}) {
  const now = ts || new Date().toISOString();
  const day = dayKey(now);
  const m = mood === undefined || mood === null || mood === "" ? null : Number(mood);
  const e = energy === undefined || energy === null || energy === "" ? null : Number(energy);
  const s = sleep_hours === undefined || sleep_hours === null || sleep_hours === "" ? null : Number(sleep_hours);
  await db.prepare(
    `INSERT INTO wellbeing_checkins (ts, day, mood, energy, sleep_hours, load, note, source, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, source) DO UPDATE SET
       ts = excluded.ts, mood = COALESCE(excluded.mood, mood), energy = COALESCE(excluded.energy, energy),
       sleep_hours = COALESCE(excluded.sleep_hours, sleep_hours), load = COALESCE(excluded.load, load),
       note = COALESCE(excluded.note, note), raw_json = COALESCE(excluded.raw_json, raw_json)`
  ).bind(now, day, m, e, s, load ?? null, note ?? null, source, raw ? JSON.stringify(raw) : null).run();
  return { day, mood: m, energy: e, sleep_hours: s };
}

// A fixed +120 offset is wrong for half the year: Europe/Amsterdam is +0200 until 2026-10-25
// and +0100 after, which would shift quiet hours by an hour and file a 23:30 message under the
// next day. Resolve the offset from the IANA zone instead, per instant.
function tzOffsetMinutes(tz, atMs = Date.now()) {
  if (typeof tz === "number") return tz;
  if (!tz) return DEFAULT_CONFIG.tz_offset_min;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
      .formatToParts(new Date(atMs));
    const name = (parts.find((p) => p.type === "timeZoneName") || {}).value || "GMT+00:00";
    const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    if (!m) return 0;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
  } catch {
    return DEFAULT_CONFIG.tz_offset_min;
  }
}

function dayKey(iso, tz = DEFAULT_CONFIG.tz) {
  const t = new Date(iso).getTime() + tzOffsetMinutes(tz, new Date(iso).getTime()) * 60000;
  return new Date(t).toISOString().slice(0, 10);
}

function localHourFloat(iso, tz = DEFAULT_CONFIG.tz) {
  const t = new Date(iso).getTime() + tzOffsetMinutes(tz, new Date(iso).getTime()) * 60000;
  const d = new Date(t);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

// ---------------------------------------------------------------- judgement

function inQuiet(hourFloat, quietStart, quietEnd) {
  if (quietStart === quietEnd) return false;
  if (quietStart < quietEnd) return hourFloat >= quietStart && hourFloat < quietEnd;
  return hourFloat >= quietStart || hourFloat < quietEnd;   // wraps midnight
}

// Drift is measured against the owner's own baseline and against the observable record,
// not against a questionnaire.
//
// Weak vs strong (fixed 2026-10-17 after the first live read): `activity` is 50 days stale by
// design and `chat` volume moves when he changes client, so those two can never declare drift on
// their own - a false "you are withdrawing" is worse than a missed week. Text signals (a note gap,
// a night shift) and self-report are what carry the judgement.
function drift(ctx = {}) {
  const strong = [];
  const weak = [];
  // The vault's own daily note ("_17.md") is a better writing signal than the `notes` table, which
  // is mostly ingested mail and events. Prefer it when it is present.
  const noteGap = (ctx.days_since_daily_note !== undefined && ctx.days_since_daily_note !== null)
    ? ctx.days_since_daily_note
    : ctx.days_since_note;
  if ((noteGap ?? 0) > 3) weak.push({ k: "note", why: "no daily note for " + Math.round(noteGap) + "d" });
  if ((ctx.night_share ?? 0) > 0.25) weak.push({ k: "night", why: "night share " + Math.round(ctx.night_share * 100) + "%" });
  if (ctx.volume_ratio !== undefined && ctx.volume_ratio !== null && ctx.volume_ratio < 0.5) {
    weak.push({ k: "volume", why: "volume " + Math.round(ctx.volume_ratio * 100) + "% of baseline" });
  }
  if ((ctx.days_since_activity ?? 0) > 10) weak.push({ k: "activity", why: "no logged activity for " + Math.round(ctx.days_since_activity) + "d" });

  const moodToday = ctx.mood_today;
  const moodAvg = ctx.mood_avg7;
  if (moodToday === 1) strong.push({ k: "mood", why: "mood 1 today" });
  else if (moodToday !== null && moodToday !== undefined && moodToday <= 2 &&
           moodAvg !== null && moodAvg !== undefined && moodAvg <= 2.5) {
    strong.push({ k: "mood", why: "mood " + moodToday + " on a " + moodAvg + " week" });
  }
  if ((ctx.unanswered_streak ?? 0) >= 3) strong.push({ k: "unanswered", why: ctx.unanswered_streak + " unanswered asks" });
  if (ctx.mood_drop_2d) strong.push({ k: "mood-drop", why: "mood fell sharply in 2 days" });

  const reasons = strong.concat(weak).map((r) => r.why);
  const textSignal = weak.some((w) => w.k === "note" || w.k === "night");

  let level = "ok";
  if (strong.length) level = "shaky";
  else if (weak.length >= 2 && textSignal) level = "drift";
  else if (weak.length) level = "watch";

  return { level, reasons, strong: strong.map((s) => s.k), weak: weak.map((w) => w.k) };
}

function lastDone(recent, kind) {
  let best = null;
  for (const r of recent) {
    if (r.kind !== kind || r.state !== "done") continue;
    if (!best || String(r.ts) > String(best.ts)) best = r;
  }
  return best;
}

// retire: fired >= N and done_rate < floor. This is what makes the loop self-correcting.
// Without it the companion repeats what has never once worked, which is exactly the 0/30 defect.
function retiredKinds(loopRows, cfg = DEFAULT_CONFIG) {
  const out = new Set();
  for (const row of loopRows) {
    const fired = Number(row.fired || 0);
    const rate = Number(row.done_rate || 0);
    if (fired >= (cfg.retire_after_fired ?? 6) && rate <= (cfg.retire_below_done_rate ?? 0.05)) out.add(row.kind);
  }
  return out;
}

// ---------------------------------------------------------------- the decision

// Pure. Everything it needs is passed in, so every rule is testable without a database.
// Returns null (stay quiet) or one ask.
function planNext({ nowIso, ctx = {}, cfg = DEFAULT_CONFIG, recent = [], loopRows = [] }) {
  const hour = localHourFloat(nowIso);
  const today = dayKey(nowIso);
  const nowMs = new Date(nowIso).getTime();

  if (inQuiet(hour, cfg.quiet_start, cfg.quiet_end)) return { skip: "quiet-hours" };

  const retired = retiredKinds(loopRows, cfg);

  // SHAKY-NO-ASK-1: the worst failure mode is a well-formed task on the day the right move was
  // to ask nothing. When drift says shaky and there is no check-in yet, the only message is the
  // check-in itself (or presence, if one already went out). No ladder, no ask, no obligation.
  const shaky = ctx.drift_level === "shaky";
  if (shaky) {
    const checkedIn = ctx.checked_in === true ||
      (ctx.mood_today !== null && ctx.mood_today !== undefined) ||
      (ctx.energy_today !== null && ctx.energy_today !== undefined);
    if (!checkedIn) {
      if (recent.some((r) => r.day === today && r.kind === "checkin")) {
        if (recent.some((r) => r.day === today && r.kind === "presence")) return { skip: "shaky-already-touched" };
        return {
          kind: "presence", ladder_step: 0, minutes: 0,
          ask: cfg.presence_line, expected: null,
          due_at: new Date(nowMs + 6 * 3600e3).toISOString(),
          reason: "shaky-presence"
        };
      }
      return {
        kind: "checkin", ladder_step: 0, minutes: 0,
        ask: "How's it landing today?", expected: "log:checkin",
        due_at: new Date(nowMs + 6 * 3600e3).toISOString(),
        reason: "shaky-no-checkin"
      };
    }
  }

  // A shaky day that has been logged still gets almost nothing: one ask, not three.
  if (shaky) cfg = { ...cfg, max_per_day: Math.min(cfg.max_per_day ?? 3, 1) };

  // Rule 4: three unanswered -> presence only, once, then silence.
  if ((ctx.unanswered_streak ?? 0) >= (cfg.max_unanswered ?? 3)) {
    const already = recent.some((r) => r.day === today && r.kind === "presence");
    if (already) return { skip: "presence-already-sent" };
    return {
      kind: "presence", ladder_step: 0, minutes: 0,
      ask: cfg.presence_line, expected: null,
      due_at: new Date(nowMs + 6 * 3600e3).toISOString(),
      reason: "unanswered-streak=" + ctx.unanswered_streak
    };
  }

  const todays = recent.filter((r) => r.day === today && r.state !== "superseded");
  if (todays.length >= (cfg.max_per_day ?? 3)) return { skip: "daily-cap" };

  const lastSent = recent
    .filter((r) => r.sent_at || r.ts)
    .map((r) => new Date(r.sent_at || r.ts).getTime())
    .sort((a, b) => b - a)[0];
  if (lastSent && nowMs - lastSent < (cfg.min_gap_min ?? 150) * 60000) return { skip: "min-gap" };

  // Rule 3: on a bad day the ladder is capped at body, and body is preferred over any task shape.
  const lowMood = ctx.mood_today !== null && ctx.mood_today !== undefined && ctx.mood_today <= 2;
  const capStep = lowMood ? 2 : 4;

  // Rule 2: escalate only after a done; an expired ask drops one rung.
  let step = 1;
  const last = recent
    .filter((r) => r.state === "done" || r.state === "expired")
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))[0];
  if (last) {
    const prev = Number(last.ladder_step || 1);
    step = last.state === "done" ? prev + 1 : Math.max(1, prev - 1);
  }
  if (!recent.some((r) => r.state === "done")) step = 1;   // nothing has landed yet: start at the floor
  step = Math.min(Math.max(1, step), capStep);

  // A rung that is not allowed at this hour is not a rung today.
  while (step > 1) {
    const rung = LADDER[step - 1];
    if (hour >= (rung.minHour ?? 0) && !retired.has(rung.kind)) break;
    step -= 1;
  }
  let rung = LADDER[step - 1];
  if (retired.has(rung.kind)) {
    const alt = LADDER.filter((r) => !retired.has(r.kind) && hour >= (r.minHour ?? 0) && r.step <= capStep);
    if (!alt.length) return { skip: "all-kinds-retired" };
    rung = alt[0];
  }

  // The contact rung names a person when it has one. "Message one person" is a category; "message
  // Ana" is an errand, and errands get done. Rotation is by least-recently-used, so nobody loops.
  if (rung.kind === "contact") {
    const names = (cfg.contact_candidates || []).filter((n) => n && String(n).trim());
    if (names.length) {
      const lastNamed = (n) => {
        const hit = recent.filter((r) => String(r.ask || "").includes(String(n))).map((r) => String(r.ts)).sort().pop();
        return hit || "";
      };
      const pick = names.slice().sort((a, b) => lastNamed(a).localeCompare(lastNamed(b)) || String(a).localeCompare(String(b)))[0];
      return {
        kind: "contact",
        ladder_step: rung.step,
        minutes: rung.minutes,
        ask: "Message " + pick + ". One line is enough - even 'thinking of you'.",
        expected: "log:contact",
        due_at: new Date(nowMs + rung.slaMinutes * 60000).toISOString(),
        reason: "step=3 named=" + pick
      };
    }
  }

  // Do not repeat the same kind inside 48h unless there is nothing else.
  const usedKinds = new Set(
    recent.filter((r) => nowMs - new Date(r.ts).getTime() < 48 * 3600e3).map((r) => r.kind)
  );
  let pool = (cfg.candidates?.[rung.step] || []).filter(Boolean);
  if (!pool.length) return { skip: "no-candidate" };

  const recentAsks = new Set(recent.map((r) => str(r.ask)));
  let fresh = pool.filter((a) => !recentAsks.has(str(a)));
  if (!fresh.length) fresh = pool;

  // Deterministic pick: least recently used, so the same line never loops.
  const lastUse = (a) => {
    const hit = recent.filter((r) => str(r.ask) === str(a)).map((r) => String(r.ts)).sort().pop();
    return hit || "";
  };
  fresh.sort((a, b) => lastUse(a).localeCompare(lastUse(b)) || a.localeCompare(b));

  return {
    kind: rung.kind,
    ladder_step: rung.step,
    minutes: rung.minutes,
    ask: fresh[0],
    expected: "log:" + rung.kind,
    due_at: new Date(nowMs + rung.slaMinutes * 60000).toISOString(),
    reason: "step=" + rung.step + (lowMood ? " low-mood-cap" : "") + (usedKinds.has(rung.kind) ? " repeat-within-48h" : "")
  };
}

// ---------------------------------------------------------------- the closed loop

async function expireStale(db, nowIso = new Date().toISOString()) {
  const r = await db.prepare(
    `UPDATE companion_nudges SET state = 'expired', closed_at = ?
      WHERE state IN ('sent','shown') AND due_at IS NOT NULL AND due_at < ?`
  ).bind(nowIso, nowIso).run();
  return r.meta?.changes ?? 0;
}

async function closeNudge(db, id, { state, response, outcome, nowIso } = {}) {
  const now = nowIso || new Date().toISOString();
  if (!["done", "declined", "expired", "superseded"].includes(state)) throw new Error("NUDGE-STATE-1");
  await db.prepare(
    "UPDATE companion_nudges SET state = ?, closed_at = ?, response = ?, outcome = ? WHERE id = ?"
  ).bind(state, now, response ?? null, outcome ?? null, id).run();
}

async function unansweredStreak(db) {
  // Only asks count. A morning check-in or a presence line sitting in 'sent' is not an ignored ask,
  // and counting it would push the companion into presence mode after three ordinary mornings.
  const kinds = LADDER.map((r) => "'" + r.kind + "'").join(",");
  const r = await db.prepare(
    "SELECT state FROM companion_nudges WHERE kind IN (" + kinds + ") AND state IN ('sent','shown','done','declined','expired') ORDER BY ts DESC LIMIT 10"
  ).all();
  let n = 0;
  for (const row of r.results || []) {
    if (row.state === "done" || row.state === "declined") break;
    n += 1;
  }
  return n;
}

// What actually helped, per person, measured on the next day's numbers.
async function whatHelped(db, days = 60) {
  const r = await db.prepare(
    `SELECT n.kind,
            COUNT(*) AS done_n,
            ROUND(AVG(c.mood), 2) AS mood_next_day,
            ROUND(AVG(c.energy), 2) AS energy_next_day
       FROM companion_nudges n
       JOIN wellbeing_checkins c ON c.day = date(n.day, '+1 day')
      WHERE n.state = 'done' AND n.ts >= datetime('now', ?)
      GROUP BY n.kind
      ORDER BY done_n DESC`
  ).bind("-" + Number(days) + " days").all();
  return r.results || [];
}

// ---------------------------------------------------------------- escalation (fixed text only)

// The six steps of a safety plan (Stanley & Brown): warning signs, internal coping, people and
// places that distract, people to ask for help, professionals and agencies, making the environment
// safer. The first four were missing entirely; this is the whole instrument, in the owner's words.
// A step with nothing in it is reported as empty, never filled in for him.
function safetyPlanBlock(plan = {}, cfg = DEFAULT_CONFIG) {
  const p = plan && typeof plan === "object" ? plan : {};
  const list = (x) => (Array.isArray(x) ? x.filter((v) => v && String(v).trim()) : []);
  const lines = [];
  const missing = [];
  const push = (label, items) => {
    const name = String(label).replace(/:$/, "");
    if (!items.length) { missing.push(name); return; }
    lines.push(label);
    for (const it of items) lines.push("  - " + String(it));
  };
  push("What it looks like when it starts:", list(p.warning_signs));
  push("What has worked before, on your own:", list(p.coping));
  push("Where to go, or who to be near:", list(p.distraction));
  const people = list(p.people);
  const personal = [];
  if (people.length) {
    lines.push("People you can tell:");
    for (const who of people) {
      const name = typeof who === "string" ? who : (who && who.name) || "";
      const how = typeof who === "string" ? "" : (who && who.contact) || "";
      if (name) lines.push("  - " + name + (how ? " (" + how + ")" : ""));
    }
  } else if (cfg && (cfg.backstop_name || cfg.backstop_contact)) {
    lines.push("People you can tell:");
    lines.push("  - " + (cfg.backstop_name || "your person") + (cfg.backstop_contact ? " (" + cfg.backstop_contact + ")" : ""));
  } else {
    missing.push("People you can tell");
  }
  const lines_ = Array.isArray(cfg.crisis_lines) ? cfg.crisis_lines : [];
  if (lines_.length) {
    lines.push("Services:");
    for (const l of lines_) lines.push("  - " + (l && l.label ? l.label : "") + (l && l.number ? " " + l.number : "") + (l && l.url ? " " + l.url : ""));
  } else {
    missing.push("Services");
  }
  push("Making the flat safer for tonight:", list(p.environment));
  return { lines, missing, complete: missing.length === 0 };
}

// SLA: 60 seconds, three independent paths. No model call anywhere in this path.
function crisisBlock(cfg = DEFAULT_CONFIG, plan = null) {
  const lines = Array.isArray(cfg.crisis_lines) ? cfg.crisis_lines : [];
  const has = (s) => s && String(s).trim().length > 0;
  const sp = safetyPlanBlock(plan || {}, cfg);
  const out = ["I'm not going to argue with you about this, and I'm not qualified to."];
  if (sp.lines.length) {
    out.push("");
    out.push("You wrote this down when you were okay. Start with the first line that fits:");
    out.push(...sp.lines);
  }
  out.push("");
  out.push(has(cfg.backstop_name) || has(cfg.backstop_contact)
    ? "Tell " + (cfg.backstop_name || "your person") + " you're not okay. Right now, one line."
    : "Tell one real person you're not okay. Right now, one line. (No backstop is configured yet - add one.)");
  out.push(lines.length
    ? "If it gets worse, call: " + lines.map((l) => (l && l.label ? l.label + " " + l.number : l.number || l)).join(" · ")
    : "If it gets worse, use your local emergency number. (No crisis lines configured yet.)");
  out.push("Nothing here needs to be solved tonight.");
  return { sla_seconds: 60, paths: ["chat", "email", "dashboard-card"], text: out.join("\n"), plan_missing: sp.missing, plan_complete: sp.complete };
}

// The weekly review reports what happened, in the owner's interest and not as a scorecard.
// It never counts what he missed: a review that totals failures is the same guilt machine the
// expiry rule exists to prevent. `done` is what he completed; nothing else is listed.
function weeklyReviewText({ week, checkins = [], done = [], helped = [], retired = [] } = {}) {
  const L = [];
  L.push("Week of " + week + ".");
  const moods = checkins.map((c) => (c && c.mood)).filter((v) => v !== null && v !== undefined);
  if (checkins.length) {
    L.push("");
    L.push("You checked in " + checkins.length + (checkins.length === 1 ? " day." : " days."));
    if (moods.length) {
      const avg = moods.reduce((a, b) => a + Number(b), 0) / moods.length;
      L.push("Mood averaged " + (Math.round(avg * 10) / 10) + ".");
    }
  }
  if (done.length) {
    L.push("");
    L.push("What you did:");
    for (const d of done) L.push("- " + String(d.ask || "").replace(/\.$/, "") + (d.day ? " (" + d.day + ")" : ""));
  }
  if (helped.length) {
    L.push("");
    L.push("Days after those, mood averaged:");
    for (const h of helped) {
      if (h.mood_after === null || h.mood_after === undefined) continue;
      L.push("- " + h.kind + ": " + h.mood_after + (h.mood_other !== null && h.mood_other !== undefined ? " (other days " + h.mood_other + ")" : ""));
    }
  }
  if (retired.length) {
    L.push("");
    L.push("It stopped asking about " + retired.join(", ") + ". It never landed, and repeating it was not helping.");
  }
  L.push("");
  L.push("Nothing needed here.");
  return L.join("\n");
}

// Stems, not phrases. A phrase list misses every inflection ("hurt myself" does not match
// "hurting myself" - that gap was caught by this file's own test on 2026-10-17), and a missed
// inflection is the one failure this detector cannot afford.
const HARD = [
  /\b(kill|killing|kills)\s+my\s?self\b/,
  /\b(end|ending)\s+(it\s+all|my\s+life)\b/,
  /\b(take|taking)\s+my\s+own\s+life\b/,
  /\b(want|wanna|wish)\s+(to\s+)?(die|be\s+dead)\b/,
  /\bbetter\s+off\s+dead\b/,
  /\bno\s+(reason|point)\s+(to|in)\s+(live|living|go\s+on|going\s+on)\b/,
  /\bsuicid\w*\b/,
  /\bself[-\s]?harm\w*\b/,
  /\b(overdos\w*)\b/,
  // "cut myself some slack" is not a crisis. The lookahead keeps ordinary English out.
  /\b(hurt|harm|cut|burn|starve|poison|stab|choke)\w*\s+my\s?self\b(?!\s+(some|a)\s+(slack|break))/,
  /\b(don'?t|do\s+not)\s+want\s+to\s+(be\s+here|exist|wake\s+up|live|be\s+alive|go\s+on)\b/,
  // COMPANION-CRISIS-PARITY-1 (agent_issues 100040): the phrasings personal-api/companion.js
  // added in RED-TEAM-1 (PR 2602), copied at the same level.
  /\bwish\s+(i\s+)?(was|were|could\s+be)\s+dead\b/,
  /\b(end|ending|finish)\s+it(\s+(all|tonight|today|now))?\s*$/,
  /\b(going|want|wanna|plan(ning)?)\s+to\s+end\s+it\b/,
  /\b(better|be)\s+off\s+without\s+me\b/,
  /\bno\s?one\s+would\s+(miss|notice|care\s+if)\s+(me|i)\b/,
  /\bnobody\s+would\s+(miss|notice|care\s+if)\s+(me|i)\b/,
  /\bkms\b/,
  /\bunalive\b/,
  /\b(jump|jumping)\s+(off|in\s+front\s+of)\b/,
  /\b(take|taking|swallow)\s+(all\s+)?(my|the)\s+(pills|tablets|meds)\b/,
  // Dutch: zelfmoord, dood willen, er een eind aan maken, mezelf iets aandoen.
  /\bzelfmoord\w*\b/,
  /\bsuïcid\w*\b/,
  /\bik\s+wil\s+(dood|sterven|niet\s+meer\s+(leven|bestaan|wakker\s+worden))\b/,
  /\b(er\s+)?een\s+(eind|einde)\s+aan\s+(maken|te\s+maken)\b/,
  /\bmezelf\s+(iets\s+aan\s?doen|pijn\s+doen|snijden|van\s+kant\s+maken)\b/,
  /\bik\s+wil\s+er\s+niet\s+meer\s+zijn\b/,
  /\bliever\s+dood\b/
];

const SOFT = [
  "can't go on", "cant go on", "can not go on", "give up", "hopeless", "pointless",
  "nothing matters", "can't cope", "cant cope", "falling apart", "hate myself",
  "so tired of everything", "what's the point", "whats the point", "numb",
  "i'm a mess", "im a mess", "can't do this anymore", "cant do this anymore", "want to disappear",
  "worthless", "a burden", "trapped", "empty inside",
  "ik zie het niet meer zitten", "ik kan niet meer", "het heeft geen zin", "hopeloos", "ik haat mezelf",
  "ik ben op", "ik ben een last"
];

function crisisSignal(text) {
  // Phones type curly apostrophes (U+2018/U+2019) by default; the patterns use a straight one.
  const t = String(text || "").toLowerCase().replace(/[‘’ʼ`´]/g, "'").replace(/\s+/g, " ").trim();
  for (const re of HARD) {
    const m = t.match(re);
    if (m) return { level: 2, match: m[0] };
  }
  const s = SOFT.find((p) => t.includes(p));
  if (s) return { level: 1, match: s };
  return { level: 0, match: null };
}

return Object.freeze({ WELLBEING_VERSION, LADDER, DEFAULT_CONFIG, DDL, ensureWellbeingSchema, recordCheckin, tzOffsetMinutes, dayKey, localHourFloat, inQuiet, drift, retiredKinds, planNext, expireStale, closeNudge, unansweredStreak, whatHelped, safetyPlanBlock, crisisBlock, weeklyReviewText, crisisSignal });
})(); // end inline wellbeing.js
// personal-companion/wellbeing-wire.js
// WELLBEING-LOOP-1 wiring: routes, the hourly tick, the morning check-in, delivery.
// Kept out of worker.js so the 345 KB bundle needs three small insertions and nothing else.
//
// Facts this file relies on (verified 2026-10-17):
//   owner mailbox rwnquni@outlook.com (worker.js PROMPT_OWNER / sendMail)
//   mail primitive sendOne(env, to, subject, body) (worker.js)
//   personal-life D1: chat(role,ts), notes(kind,ts), activity(date), events(start_date)
//   crisis numbers verified on https://www.113.nl : 112 immediate danger, 113 or 0800-0113, chat 24/7



const OWNER = "rwnquni@outlook.com";
const BASE = "https://reading.q08.org";

// Seeded once, then owned by the owner: a row in wellbeing_config always wins.
const SEEDS = {
  crisis_lines: [
    { label: "112 - immediate danger", number: "112" },
    { label: "113 Zelfmoordpreventie", number: "113" },
    { label: "0800-0113 (free)", number: "0800-0113" },
    { label: "chat 24/7", number: "", url: "https://www.113.nl" }
  ]
};

const parseVal = (v) => { try { return JSON.parse(v); } catch { return v; } };
const esc = (s) => String(s === null || s === undefined ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const days = (ms) => ms / 864e5;

async function ensureWellbeing(db) {
  await WB.ensureWellbeingSchema(db);
  const now = new Date().toISOString();
  for (const [k, v] of Object.entries(SEEDS)) {
    await db.prepare(
      "INSERT INTO wellbeing_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING"
    ).bind(k, JSON.stringify(v), now).run();
    // DEFAULT_CONFIG seeds an empty crisis_lines first, so the INSERT above is a no-op. Fill an
    // empty list once; the WHERE guard means an owner edit, made at any point, is never overwritten.
    const cur = await db.prepare("SELECT value FROM wellbeing_config WHERE key = ?").bind(k).first();
    const parsed = cur ? parseVal(cur.value) : null;
    if (Array.isArray(parsed) && parsed.length === 0) {
      await db.prepare(
        "UPDATE wellbeing_config SET value = ?, updated_at = ? WHERE key = ? AND value = ?"
      ).bind(JSON.stringify(v), now, k, cur.value).run();
    }
  }
}

async function cfg(env) {
  const r = await env.PERSONAL.prepare("SELECT key, value FROM wellbeing_config").all();
  const out = { ...WB.DEFAULT_CONFIG };
  for (const row of r.results || []) out[row.key] = parseVal(row.value);
  return out;
}

async function setCfg(env, key, value) {
  await env.PERSONAL.prepare(
    "INSERT INTO wellbeing_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).bind(key, typeof value === "string" ? value : JSON.stringify(value), new Date().toISOString()).run();
}

// ---------------------------------------------------------------- context

// The companion's picture of "how is he, right now". Built only from what is already recorded,
// so it works on day one, before a single check-in exists.
async function context(env, nowIso, c) {
  const conf = c || (await cfg(env));
  const now = nowIso || new Date().toISOString();
  const nowMs = new Date(now).getTime();
  const tz = conf.tz;
  const day = WB.dayKey(now, tz);
  const iso = (d) => new Date(nowMs - d * 864e5).toISOString();

  const one = async (sql, ...b) => {
    try { return (await env.PERSONAL.prepare(sql).bind(...b).first()) || {}; } catch { return {}; }
  };
  const many = async (sql, ...b) => {
    try { return ((await env.PERSONAL.prepare(sql).bind(...b).all()).results) || []; } catch { return []; }
  };

  const lastNote = await one("SELECT MAX(ts) AS t FROM notes WHERE kind NOT IN ('email')");
  const lastAct = await one("SELECT MAX(date) AS d FROM activity");
  const vol = await one(
    "SELECT SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS w, COUNT(*) AS m FROM chat WHERE LOWER(role) = 'user' AND ts >= ?",
    iso(7), iso(28)
  );
  // The table carries both 'USER' and 'user' (two import eras): compare case-insensitively or a
  // whole client's history disappears from the baseline.
  const nightRows = await many("SELECT ts FROM chat WHERE LOWER(role) = 'user' AND ts >= ? LIMIT 2000", iso(14));

  const vrows = await many(
    "SELECT path, size FROM files WHERE path LIKE 'obsidian/notes/v1/%' AND path GLOB '*/_[0-9][0-9].md' ORDER BY modified DESC LIMIT 400"
  );
  const vault = vaultNoteDays(vrows, day);

  const check = await one("SELECT mood, energy, sleep_hours FROM wellbeing_checkins WHERE day = ? ORDER BY ts DESC", day);
  const avg = await one(
    "SELECT ROUND(AVG(mood),2) a7 FROM wellbeing_checkins WHERE mood IS NOT NULL AND day >= ?", WB.dayKey(iso(7), tz)
  );
  const recentMood = await one(
    "SELECT ROUND(AVG(CASE WHEN day >= ? THEN mood END),2) m2, ROUND(AVG(CASE WHEN day < ? THEN mood END),2) m5 FROM wellbeing_checkins WHERE mood IS NOT NULL AND day >= ?",
    WB.dayKey(iso(2), tz), WB.dayKey(iso(2), tz), WB.dayKey(iso(7), tz)
  );

  let night = 0;
  for (const row of nightRows) {
    const h = WB.localHourFloat(row.ts, tz);
    if (h < 5) night += 1;
  }

  const answers = await WB.unansweredStreak(env.PERSONAL);
  const idx = {
    days_since_note: lastNote.t ? days(nowMs - Date.parse(lastNote.t)) : 999,
    days_since_daily_note: vault.latest ? days(nowMs - Date.parse(vault.latest + "T12:00:00Z")) : 999,
    daily_note_days_7d: vault.days7,
    daily_note_last_size: vault.latestSize,
    days_since_activity: lastAct.d ? days(nowMs - Date.parse(lastAct.d + "T12:00:00Z")) : 999,
    night_share: nightRows.length ? night / nightRows.length : 0,
    volume_ratio: vol.m ? (Number(vol.w) / 1) / (Number(vol.m) / 4) : null,
    mood_today: check.mood === undefined ? null : check.mood,
    energy_today: check.energy === undefined ? null : check.energy,
    sleep_today: check.sleep_hours === undefined ? null : check.sleep_hours,
    mood_avg7: avg.a7 === undefined ? null : avg.a7,
    mood_drop_2d: recentMood.m2 !== null && recentMood.m5 !== null && recentMood.m2 !== undefined && recentMood.m5 !== undefined
      ? Number(recentMood.m5) - Number(recentMood.m2) >= 0.75 : false,
    unanswered_streak: answers
  };

  return {
    day,
    hour: WB.localHourFloat(now, tz),
    ctx: idx,
    drift: WB.drift(idx),
    checked_in: check.mood !== undefined || check.energy !== undefined,
    // SCALE-ANCHORED-1: the same instrument the check-in page shows, machine-readable, so no reader
    // has to guess what 1 and 5 mean or which direction is good. Thresholds are drift()'s own.
    scale: {
      mood: { question: "how you feel right now", 1: "rough", 2: "low", 3: "okay", 4: "good", 5: "great" },
      energy: { question: "how much you have in the tank", 1: "empty", 2: "thin", 3: "steady", 4: "strong", 5: "full" },
      direction: "5 is best; 1-2 low, 3 neutral, 4-5 high",
      not_a_grade: true,
      used_for: "low values drop the ask ladder to presence; nothing is scored and there is no target",
      thresholds: { mood_today_strong_low: 1, mood_avg7_strong_low: 2.5, mood_drop_2d_points: 0.75 }
    }
  };
}

async function recentNudges(env, limit = 40) {
  const r = await env.PERSONAL.prepare(
    "SELECT * FROM companion_nudges ORDER BY id DESC LIMIT ?"
  ).bind(limit).all();
  return r.results || [];
}

async function loopRows(env) {
  try {
    const r = await env.PERSONAL.prepare("SELECT * FROM v_nudge_loop").all();
    return r.results || [];
  } catch { return []; }
}

// ---------------------------------------------------------------- delivery

// The owner's own daily notes live in the vault as notes/v1/YYYY/MM/DD/_DD.md. The same note is
// mirrored under several prefixes, so dedupe by the date in the path, not by row.
function vaultNoteDays(rows, today) {
  const days = new Set();
  let latest = null, latestSize = 0;
  for (const r of rows || []) {
    const m = String(r.path || "").match(/\/(\d{4})\/(\d{2})\/(\d{2})\/_\d\d\.md$/);
    if (!m) continue;
    const d = m[1] + "-" + m[2] + "-" + m[3];
    days.add(d);
    if (!latest || d > latest) { latest = d; latestSize = Number(r.size || 0); }
  }
  const ref = Date.parse(today + "T12:00:00Z");
  let days7 = 0;
  for (const d of days) if (Date.parse(d + "T12:00:00Z") >= ref - 7 * 864e5) days7 += 1;
  return { days7, latest, latestSize, total: days.size };
}

function token(env, u) {
  const expected = env.WELLBEING_TOKEN;
  if (!expected) return true;                    // unset: same fail-open convention as authorized()
  return u.searchParams.get("t") === expected || u.searchParams.get("k") === expected;
}

function nudgeMail(n, c, tok) {
  const q = tok ? "&t=" + encodeURIComponent(tok) : "";
  if (n.kind === "presence") {
    return {
      subject: "I'm here",
      body: [c.presence_line || "I'm here. Nothing needed from you right now.", "", "No reply needed.", "", BASE + "/wb/checkin" + (tok ? "?t=" + encodeURIComponent(tok) : "")].join("\n")
    };
  }
  if (n.kind === "checkin") {
    return {
      subject: "morning - two taps",
      body: ["How's it landing today?", "", "Mood (how you feel) then energy (what you have in the tank). Two taps, 1 low to 5 high, nothing to type:", "", BASE + "/wb/checkin" + (tok ? "?t=" + encodeURIComponent(tok) : "")].join("\n")
    };
  }
  return {
    subject: "one small thing",
    body: [
      n.ask,
      "",
      "Did it:    " + BASE + "/wb/done?id=" + n.id + q,
      "Not today: " + BASE + "/wb/no?id=" + n.id + q,
      "",
      "Either answer is a good answer. If nothing happens this closes on its own and nothing else is asked today."
    ].join("\n")
  };
}

// ONE-MORNING-MAIL-1: the morning brief and the standalone check-in both fire on the 06:00Z tick,
// which put two messages in the owner's inbox 15 minutes apart. The check-in now rides inside the
// brief when the brief goes out; the standalone path remains as the fallback for days with no brief.
async function briefCheckinLines(env, nowIso) {
  const c = await cfg(env);
  if (c.wellbeing_prompts !== true) return [];
  const day = WB.dayKey(nowIso || new Date().toISOString(), c.tz);
  const seen = await env.PERSONAL.prepare(
    "SELECT 1 AS x FROM companion_nudges WHERE day = ? AND kind = 'checkin' LIMIT 1"
  ).bind(day).first();
  if (seen) return [];
  const t = env.WELLBEING_TOKEN ? "?t=" + encodeURIComponent(env.WELLBEING_TOKEN) : "";
  return ["", "How's it landing? Two taps: mood and energy, 1 low to 5 high, nothing to type:", BASE + "/wb/checkin" + t];
}

async function noteCheckinInBrief(env, nowIso) {
  const c = await cfg(env);
  if (c.wellbeing_prompts !== true) return false;
  const now = nowIso || new Date().toISOString();
  const day = WB.dayKey(now, c.tz);
  try {
    await env.PERSONAL.prepare(
      `INSERT INTO companion_nudges (ts, day, kind, ladder_step, ask, minutes, expected, due_at, state, sent_at, reason)
       VALUES (?, ?, 'checkin', 0, 'How''s it landing today?', 0, 'log:checkin', ?, 'sent', ?, 'morning-brief')`
    ).bind(now, day, new Date(Date.parse(now) + 6 * 3600e3).toISOString(), now).run();
    return true;
  } catch (e) {
    if (String(e && e.message || e).includes("NUDGE-DUP-1")) return false;
    throw e;
  }
}

// ---------------------------------------------------------------- the tick

// Called hourly. Idempotent by construction: one row per kind per day, a min gap, a daily cap.
async function wellbeingTick(env, deps = {}) {
  const send = deps.send;
  const now = deps.nowIso || new Date().toISOString();
  await ensureWellbeing(env.PERSONAL);

  const c = await cfg(env);
  const out = { now, expired: await WB.expireStale(env.PERSONAL, now) };
  if (c.wellbeing_prompts !== true) return { ...out, skipped: "practical-notifications-only" };
  const pack = await context(env, now, c);
  out.drift = pack.drift;
  // RED-TEAM-1 (personal-api 4.12.0): the pause he sets on /companion silences this ladder too (one budget of
  // attention). A risk-words care touch still comes from personal-api's companion tick, never from here.
  if (!deps.force && c.pause_until && Date.parse(c.pause_until) > Date.parse(now)) { out.skipped = "paused"; return out; }
  // Sunday evening review, independent of the ask ladder; silent without enough data.
  try { out.review = await weeklyReview(env, { send, nowIso: now, force: !!deps.forceReview }); } catch (eRv) { out.review = { error: String(eRv && eRv.message || eRv) }; }

  // 1. The morning check-in. Its own schedule, not the reading brief's: 07:45 local, once a day.
  if (pack.hour >= 7.75 && pack.hour < 12) {
    const already = (await recentNudges(env, 20)).some((r) => r.kind === "checkin" && r.day === pack.day);
    if (!already && send) {
      const row = await insertNudge(env, {
        day: pack.day, kind: "checkin", step: 0, ask: "How's it landing today?",
        minutes: 0, expected: "log:checkin", due_at: new Date(Date.parse(now) + 6 * 3600e3).toISOString(),
        reason: "morning-checkin"
      });
      if (row) {
        const mail = nudgeMail(row, c, env.WELLBEING_TOKEN);
        const sent = await send(env, OWNER, mail.subject, mail.body);
        await markSent(env, row.id, sent, now);
        out.checkin = { id: row.id, sent: !!(sent && sent.ok !== false) };
      }
    }
  }

  // 2. At most one ask, on the WS ladder, with every cadence rule applied.
  const planCfg = deps.force
    ? { ...c, quiet_start: 0, quiet_end: 0, max_per_day: 99, min_gap_min: 0 }
    : c;
  const plan = WB.planNext({
    nowIso: now,
    ctx: { ...pack.ctx, drift_level: pack.drift.level, checked_in: pack.checked_in },
    cfg: planCfg,
    recent: await recentNudges(env, 40), loopRows: await loopRows(env)
  });
  if (plan.skip) { out.skipped = plan.skip; return out; }
  if (!send) { out.planned = plan; return out; }

  const row = await insertNudge(env, {
    day: pack.day, kind: plan.kind, step: plan.ladder_step, ask: plan.ask,
    minutes: plan.minutes, expected: plan.expected, due_at: plan.due_at, reason: plan.reason
  });
  if (!row) { out.skipped = "insert-failed"; return out; }
  const mail = nudgeMail(row, c, env.WELLBEING_TOKEN);
  const sent = await send(env, OWNER, mail.subject, mail.body);
  await markSent(env, row.id, sent, now);
  out.sent = { id: row.id, kind: plan.kind, step: plan.ladder_step, ok: !!(sent && sent.ok !== false) };
  return out;
}

async function insertNudge(env, n) {
  const now = new Date().toISOString();
  try {
    const r = await env.PERSONAL.prepare(
      `INSERT INTO companion_nudges (ts, day, kind, ladder_step, ask, minutes, expected, due_at, state, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`
    ).bind(now, n.day, n.kind, n.step, n.ask, n.minutes ?? null, n.expected ?? null, n.due_at ?? null, n.reason ?? null).run();
    const newId = r && r.meta ? r.meta.last_row_id : null;
    // Never hand an undefined id to a later UPDATE: a row with no id is a silent delivery failure.
    if (newId === null || newId === undefined) throw new Error("NUDGE-ID-1: insert returned no row id");
    return { id: newId, ...n };
  } catch (e) {
    if (!String(e && e.message || e).includes("NUDGE-DUP-1")) throw e;
    // A queued row from a failed send is reused, never duplicated.
    const r = await env.PERSONAL.prepare(
      "SELECT * FROM companion_nudges WHERE day = ? AND kind = ? AND state = 'queued' LIMIT 1"
    ).bind(n.day, n.kind).all();
    return (r.results || [])[0] || null;
  }
}

async function markSent(env, id, sent, nowIso) {
  // COMPANION-EMAIL-OPT-IN-1: with companion e-mail off the ask still happens, on the phone: the row is marked sent "via app"
  // and personal-api's companion tick mirrors fresh ladder rows to Web Push (and shows them on Today).
  if (sent && sent.disabled && sent.app) {
    await env.PERSONAL.prepare(
      "UPDATE companion_nudges SET state = 'sent', sent_at = ?, outcome = ? WHERE id = ? AND state = 'queued'"
    ).bind(nowIso, JSON.stringify({ via: "app", email_mode: sent.mode || "off" }), id).run();
    return;
  }
  // owner_notice_enabled=0 is a deliberate off switch, not a delivery failure: record it as closed
  // rather than leaving a row to be retried forever.
  if (sent && sent.disabled) {
    await env.PERSONAL.prepare(
      "UPDATE companion_nudges SET state = 'expired', closed_at = ?, outcome = ? WHERE id = ? AND state = 'queued'"
    ).bind(nowIso, JSON.stringify({ owner_notices_disabled: true }), id).run();
    return;
  }
  if (sent && sent.ok !== false && !sent.suppressed) {
    await env.PERSONAL.prepare(
      "UPDATE companion_nudges SET state = 'sent', sent_at = ?, outcome = ? WHERE id = ? AND state = 'queued'"
    ).bind(nowIso, JSON.stringify({ via: sent.via || "mail" }), id).run();
    return;
  }
  const why = JSON.stringify({ send_failed: sent ? (sent.error || (sent.suppressed ? "suppressed" : "unknown")) : "no-send" });
  await env.PERSONAL.prepare(
    "UPDATE companion_nudges SET state = 'queued', outcome = ? WHERE id = ?"
  ).bind(why, id).run();
}

// ---------------------------------------------------------------- crisis

async function escalate(env, deps, { text, source }) {
  const c = await cfg(env);
  const block = WB.crisisBlock(c, c.safety_plan || null);
  const sig = WB.crisisSignal(text);
  if (sig.level < 2) return { level: sig.level, sent: false };
  const body = block.text + "\n\n" + BASE + "/wb/checkin" + (env.WELLBEING_TOKEN ? "?t=" + encodeURIComponent(env.WELLBEING_TOKEN) : "");
  let sent = null;
  try { sent = deps.send ? await deps.send(env, OWNER, "not alone", body, "crisis") : null; } catch (e) { sent = { ok: false, error: String(e && e.message || e) }; }
  try {
    await env.PERSONAL.prepare(
      "INSERT INTO companion_nudges (ts, day, kind, ladder_step, ask, minutes, expected, due_at, state, sent_at, reason) VALUES (?, ?, 'crisis', 0, ?, 0, NULL, ?, 'sent', ?, ?)"
    ).bind(new Date().toISOString(), WB.dayKey(new Date().toISOString(), c.tz), "escalation", new Date(Date.now() + 864e5).toISOString(), new Date().toISOString(), "signal:" + sig.match + " source:" + source).run();
  } catch { /* the mail is what matters; the ledger row is best effort */ }
  return { level: 2, match: sig.match, sent: !!(sent && sent.ok !== false), block };
}

// ---------------------------------------------------------------- weekly review

function localWeekday(nowIso, tz) {
  const t = new Date(new Date(nowIso).getTime() + WB.tzOffsetMinutes(tz, new Date(nowIso).getTime()) * 60000);
  return t.getUTCDay();   // 0 = Sunday
}

function addDays(day, n) {
  return new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
}

function mondayOf(day) {
  const dow = (new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7;   // 0 = Monday
  return addDays(day, -dow);
}

// Everything the review may report, each figure computed from rows and nothing inferred.
// A correlation is only reported when there are at least two observations behind it.
async function weeklyData(env, nowIso, c) {
  const conf = c || (await cfg(env));
  const now = nowIso || new Date().toISOString();
  const today = WB.dayKey(now, conf.tz);
  const week = mondayOf(today);
  const win = addDays(today, -27);
  const many = async (sql, ...b) => {
    try { return ((await env.PERSONAL.prepare(sql).bind(...b).all()).results) || []; } catch { return []; }
  };
  const checks = await many("SELECT day, mood, energy FROM wellbeing_checkins WHERE day >= ? AND mood IS NOT NULL ORDER BY day", win);
  const dones = await many("SELECT day, kind, ask FROM companion_nudges WHERE state = 'done' AND day >= ? AND kind IN ('micro','body','contact','care') ORDER BY day", win);

  const after = {};
  for (const d of dones) { const nd = addDays(d.day, 1); (after[d.kind] = after[d.kind] || new Set()).add(nd); }
  const allAfter = new Set();
  for (const k of Object.keys(after)) for (const v of after[k]) allAfter.add(v);
  const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + Number(b), 0) / arr.length) * 10) / 10 : null);
  const helped = [];
  for (const kind of Object.keys(after)) {
    const a = checks.filter((r) => after[kind].has(r.day)).map((r) => r.mood);
    if (a.length < 2) continue;                       // one good day is not a finding
    const others = checks.filter((r) => !allAfter.has(r.day)).map((r) => r.mood);
    helped.push({ kind, mood_after: avg(a), mood_other: avg(others) });
  }

  return {
    week, today,
    checks: checks.filter((r) => r.day >= week),
    done: dones.filter((r) => r.day >= week),
    helped,
    retired: [...WB.retiredKinds(await loopRows(env), conf)]
  };
}

// Sunday evening. Silent unless there is enough of his own data to say something true.
async function weeklyReview(env, deps = {}) {
  const c = await cfg(env);
  const now = deps.nowIso || new Date().toISOString();
  const today = WB.dayKey(now, c.tz);
  if (!deps.force && (localWeekday(now, c.tz) !== 0 || WB.localHourFloat(now, c.tz) < 18)) {
    return { skipped: "not-sunday-evening" };
  }
  const week = mondayOf(today);
  const seen = await recentNudges(env, 30);
  if (seen.some((r) => r.kind === "review" && r.day === week)) return { skipped: "already-reviewed" };

  const data = await weeklyData(env, now, c);
  if (!deps.force && data.checks.length < 3 && data.done.length < 2) {
    return { skipped: "not-enough-data", checks: data.checks.length, done: data.done.length };
  }
  const text = WB.weeklyReviewText({ week, checkins: data.checks, done: data.done, helped: data.helped, retired: data.retired });
  if (!deps.send) return { planned: true, text };

  const row = await insertNudge(env, { day: week, kind: "review", step: 0, ask: "weekly review", minutes: 0, expected: null, due_at: null, reason: "weekly-review" });
  if (!row) return { skipped: "insert-failed" };
  const sent = await deps.send(env, OWNER, "the week - " + week, text);
  await markSent(env, row.id, sent, now);
  return { ok: !!(sent && sent.ok !== false), id: row.id, done: data.done.length, checks: data.checks.length };
}

// ---------------------------------------------------------------- http

function page(title, body) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)}</title>` +
    `<style>body{font:17px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1.2rem;color:#1b1b1b}` +
      `a.b{display:inline-block;min-width:3.9rem;text-align:center;padding:.6rem 0;margin:.2rem;border:1px solid #bbb;border-radius:.6rem;text-decoration:none;color:#111}` +
      `a.b small{display:block;font-size:.68rem;line-height:1.1;opacity:.75}` +
    `a.b.sel{background:#111;color:#fff;border-color:#111}a.q{color:#666}textarea{width:100%;min-height:6rem;font:inherit;padding:.6rem;border:1px solid #bbb;border-radius:.6rem}` +
    `input{width:calc(100% - 1.4rem);font:inherit;padding:.6rem;border:1px solid #bbb;border-radius:.6rem;margin:.2rem 0}` +
    `h1{font-size:1.15rem;font-weight:600}</style></head><body>` + String(body || "") + `</body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}
const txt = (body, status = 200) => new Response(String(body) + "\n", { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

async function handleWellbeing(request, env, deps = {}) {
  const u = new URL(request.url);
  const p = u.pathname;
  if (!p.startsWith("/wb/") && p !== "/api/wellbeing") return null;
  await ensureWellbeing(env.PERSONAL);
  if (!token(env, u)) return txt("unauthorized: append ?t=TOKEN", 401);

  const c = await cfg(env);
  const t = env.WELLBEING_TOKEN || "";

  if (p === "/wb/checkin") {
    let note = u.searchParams.get("note");
    if (request.method === "POST") {
      try { const fd = await request.formData(); note = fd.get("note") || note; } catch { /* not a form */ }
    }
    const mood = u.searchParams.get("mood");
    const energy = u.searchParams.get("energy");
    if (mood !== null || energy !== null || note) {
      await WB.recordCheckin(env.PERSONAL, {
        mood: mood || null, energy: energy || null,
        sleep_hours: u.searchParams.get("sleep"), load: u.searchParams.get("load"),
        note: note || null, source: "web", ts: new Date().toISOString()
      });
      const esc2 = note ? await escalate(env, deps, { text: note, source: "checkin-note" }) : { level: 0 };
      if (esc2.level >= 2) {
        return page("not alone", "<h1>You said something that matters.</h1><p>I have sent you the numbers and the one thing to do. You do not have to hold this alone tonight.</p><p><a class='q' href='/wb/checkin?t=" + esc(t) + "'>back</a></p>");
      }
    }
    const st = await env.PERSONAL.prepare("SELECT mood, energy FROM wellbeing_checkins WHERE day = ? ORDER BY ts DESC LIMIT 1")
      .bind(WB.dayKey(new Date().toISOString(), c.tz)).all();
    const row = (st.results || [])[0] || {};
    const link = (k, v) => "/wb/checkin?" + k + "=" + v + (t ? "&t=" + encodeURIComponent(t) : "");
    // SCALE-ANCHORED-1: a bare 1-5 row is not an instrument. Every rung carries the word it means,
    // the page states the direction and the bands, and it says the number is not a grade.
    const MOOD_WORDS = ["rough", "low", "okay", "good", "great"];
    const ENERGY_WORDS = ["empty", "thin", "steady", "strong", "full"];
    const btns = (k, cur, words) => [1, 2, 3, 4, 5].map((v) => `<a class="b${cur === v ? " sel" : ""}" href="${link(k, v)}">${v}<small>${words[v - 1]}</small></a>`).join("");
    const done = row.mood !== undefined || row.energy !== undefined;
    return page("check-in",
      `<h1>Today</h1>` +
      `<p><b>Mood</b> is how you feel right now. <b>Energy</b> is how much you have in the tank. Both 1 to 5, where 5 is best.</p>` +
      `<p class="q">mood - how you feel right now</p><div>${btns("mood", row.mood, MOOD_WORDS)}</div>` +
      `<p class="q">energy - what you have in the tank</p><div>${btns("energy", row.energy, ENERGY_WORDS)}</div>` +
      `<p class="q">1-2 is low, 3 is neutral, 4-5 is high. It is not a grade and there is no target: a low day means fewer asks and more presence, nothing else.</p>` +
      (done ? `<form method="post"><p class="q">anything you want to leave here</p><textarea name="note" autofocus></textarea><p><button class="b" type="submit">save</button></p></form>` : "")
    );
  }

  if (p === "/wb/done" || p === "/wb/no") {
    const id = Number(u.searchParams.get("id"));
    if (!id) return txt("missing id", 400);
    await WB.closeNudge(env.PERSONAL, id, {
      state: p === "/wb/done" ? "done" : "declined",
      response: p === "/wb/done" ? "web" : "declined-web"
    });
    return page("logged", p === "/wb/done"
      ? "<h1>Logged.</h1><p>That counts. Nothing else needed.</p>"
      : "<h1>Noted.</h1><p>Nothing more today. It will not ask again.</p>");
  }

  // Ops path: prove the loop now instead of waiting for the hour. Token-gated like every other
  // wellbeing route. force=1 bypasses quiet hours and the daily cap, never the ladder or retirement.
  if (p === "/wb/tick") {
    // kind=checkin proves the check-in path now instead of waiting for 07:45.
    if (u.searchParams.get("kind") === "review") {
      const rv = await weeklyReview(env, { send: deps.send, force: true });
      return new Response(JSON.stringify(rv, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    if (u.searchParams.get("kind") === "checkin") {
      const c0 = await cfg(env);
      const nowC = new Date().toISOString();
      const dayC = WB.dayKey(nowC, c0.tz);
      const rowC = await insertNudge(env, {
        day: dayC, kind: "checkin", step: 0, ask: "How's it landing today?", minutes: 0,
        expected: "log:checkin", due_at: new Date(Date.parse(nowC) + 6 * 3600e3).toISOString(), reason: "ops-force"
      });
      if (!rowC) return new Response(JSON.stringify({ ok: false, skipped: "already-sent-today" }, null, 2), { headers: { "Content-Type": "application/json" } });
      const mailC = nudgeMail(rowC, c0, env.WELLBEING_TOKEN);
      const sentC = deps.send ? await deps.send(env, OWNER, mailC.subject, mailC.body) : null;
      await markSent(env, rowC.id, sentC, nowC);
      return new Response(JSON.stringify({ ok: !!(sentC && sentC.ok !== false), id: rowC.id, subject: mailC.subject }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    const out = await wellbeingTick(env, { send: deps.send, force: u.searchParams.get("force") === "1" });
    return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }

  // The six-step safety plan (Stanley & Brown), in his own words, written when it is not an
  // emergency. The escalation block is the only reader.
  if (p === "/wb/plan") {
    const plan = (c.safety_plan && typeof c.safety_plan === "object") ? c.safety_plan : {};
    if (request.method === "POST") {
      let fd = null;
      try { fd = await request.formData(); } catch { /* not a form */ }
      if (fd) {
        const linesOf = (k) => String(fd.get(k) || "").split("\n").map((s) => s.trim()).filter(Boolean);
        const people = linesOf("people").map((line) => {
          const parts = line.split("|").map((s) => s.trim());
          return parts[1] ? { name: parts[0], contact: parts[1] } : { name: parts[0] };
        }).filter((x) => x.name);
        await setCfg(env, "safety_plan", {
          warning_signs: linesOf("warning_signs"),
          coping: linesOf("coping"),
          distraction: linesOf("distraction"),
          people,
          environment: linesOf("environment"),
          updated_at: new Date().toISOString()
        });
      }
      return page("saved", "<h1>Saved.</h1><p>It will use this if you ever need it.</p><p><a class='q' href='/wb/plan?t=" + esc(t) + "'>back</a></p>");
    }
    const ta = (k, label, hint, val) =>
      "<p class='q'>" + label + (hint ? " <span style='opacity:.7'>" + hint + "</span>" : "") + "</p>" +
      "<textarea name='" + k + "'>" + esc((val || []).join("\n")) + "</textarea>";
    const sp = WB.safetyPlanBlock(plan, c);
    return page("safety plan",
      "<h1>Your safety plan</h1>" +
      "<p class='q'>One item per line, in your own words. Written now, while it is not an emergency. It is read only by the escalation message.</p>" +
      "<form method='post'>" +
      ta("warning_signs", "1. What it looks like when it starts", "your earliest signs", plan.warning_signs) +
      ta("coping", "2. What has worked before, on your own", "no one else needed", plan.coping) +
      ta("distraction", "3. Where to go, or who to be near", "places that ask nothing of you", plan.distraction) +
      ta("people", "4. People you can tell", "Name | phone or email", (plan.people || []).map((x) => (typeof x === "string" ? x : (x.contact ? x.name + " | " + x.contact : x.name)))) +
      "<p class='q'>5. Services: " + esc((c.crisis_lines || []).map((l) => (l.label || "") + " " + (l.number || "")).join(" · ") || "none on file") + "</p>" +
      ta("environment", "6. Making the flat safer for tonight", "", plan.environment) +
      "<p><button class='b' type='submit'>save</button></p></form>" +
      (sp.missing.length
        ? "<p class='q'>Still empty: " + esc(sp.missing.join(", ")) + "</p>"
        : "<p class='q'>All six steps have something in them.</p>")
    );
  }

  // The owner fills the two things the machine cannot infer. Token-gated like everything else.
  if (p === "/wb/settings") {
    if (request.method === "POST") {
      let fd = null;
      try { fd = await request.formData(); } catch { /* not a form */ }
      if (fd) {
        const cand = fd.get("contact_candidates");
        if (cand !== null) {
          const list = String(cand).split(",").map((s) => s.trim()).filter(Boolean);
          await setCfg(env, "contact_candidates", list);
        }
        for (const k of ["backstop_name", "backstop_contact", "presence_line"]) {
          const v = fd.get(k);
          if (v !== null) await setCfg(env, k, String(v).trim());
        }
        for (const k of ["quiet_start", "quiet_end"]) {
          const v = fd.get(k);
          if (v !== null && String(v).trim() !== "" && !Number.isNaN(Number(v))) await setCfg(env, k, Number(v));
        }
      }
      return page("saved", "<h1>Saved.</h1><p>It will use this from the next tick.</p><p><a class='q' href='/wb/settings?t=" + esc(t) + "'>back</a></p>");
    }
    const v = (x, d = "") => esc(x === undefined || x === null ? d : x);
    const cands = Array.isArray(c.crisis_lines) ? c.crisis_lines : [];
    return page("settings",
      "<h1>What only you can tell it</h1>" +
      "<form method='post'>" +
      "<p class='q'>people it may name on the contact rung (comma separated)</p>" +
      "<input name='contact_candidates' value='" + v((c.contact_candidates || []).join(", ")) + "'>" +
      "<p class='q'>backstop name - the person it names if you say something that scares it</p>" +
      "<input name='backstop_name' value='" + v(c.backstop_name) + "'>" +
      "<p class='q'>how to reach them</p>" +
      "<input name='backstop_contact' value='" + v(c.backstop_contact) + "'>" +
      "<p class='q'>quiet from / until (local hour, 22 and 7.5 by default)</p>" +
      "<input name='quiet_start' value='" + v(c.quiet_start) + "' style='width:5rem'> " +
      "<input name='quiet_end' value='" + v(c.quiet_end) + "' style='width:5rem'>" +
      "<p class='q'>what it says when it only wants to be present</p>" +
      "<input name='presence_line' value='" + v(c.presence_line) + "'>" +
      "<p><button class='b' type='submit'>save</button></p>" +
      "</form>" +
      "<p class='q' style='margin-top:2rem'>crisis lines on file: " +
      esc(cands.map((l) => (l && l.label ? l.label + " " + (l.number || "") : (l && l.number) || "")).join(" · ") || "none") +
      "</p>"
    );
  }

  if (p === "/api/wellbeing") {
    const pack = await context(env, null, c);
    const gaps = [];
    if (!c.backstop_contact && !c.backstop_name) gaps.push("backstop_contact");
    if (!Array.isArray(c.crisis_lines) || !c.crisis_lines.length) gaps.push("crisis_lines");
    if (!env.WELLBEING_TOKEN) gaps.push("WELLBEING_TOKEN secret");
    const trend = await env.PERSONAL.prepare("SELECT * FROM v_wellbeing_trend ORDER BY day DESC LIMIT 30").all();
    const cov = await env.PERSONAL.prepare("SELECT * FROM v_wellbeing_coverage").all();
    return new Response(JSON.stringify({
      ok: true,
      day: pack.day, hour: pack.hour, checked_in: pack.checked_in,
      context: pack.ctx, drift: pack.drift,
      config_gaps: gaps,
      plan_missing: WB.safetyPlanBlock(c.safety_plan || {}, c).missing,
      coverage: (cov.results || [])[0] || null,
      loop: await loopRows(env),
      trend: trend.results || [],
      nudges: (await recentNudges(env, 12)).map((n) => ({ id: n.id, ts: n.ts, kind: n.kind, step: n.ladder_step, state: n.state, ask: n.ask, response: n.response }))
    }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }

  return null;
}

return Object.freeze({ OWNER, BASE, ensureWellbeing, cfg, setCfg, context, recentNudges, loopRows, vaultNoteDays, nudgeMail, briefCheckinLines, noteCheckinInBrief, wellbeingTick, escalate, weeklyData, weeklyReview, handleWellbeing });
})(); // end inline wellbeing-wire.js

// TRAVEL-INLINE-BEGIN (generated by scripts/inline-companion-travel.mjs from personal-companion/travel.js; do not edit here)
var TRV = (() => {
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

const DDL = [
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
const DEFAULTS = {
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

const MODELS = ["@cf/zai-org/glm-5.3-flash", "@cf/openai/gpt-oss-20b"];
// Profile text handed to a model, travel facet first. 4000 cut the travel facet itself once it grew past ~6k characters
// (TRAVEL-CONTEXT-1, 2026-10-19: budget, stay type, trip style and home base were dropped); 12000 is ~3k tokens.
const PROFILE_CHARS = 12000;
const BASE = "https://reading.q08.org";
const PLANNER_URL = "https://travel.q08.org/travel";

// TRAVEL-ENSURE-ONCE-1 (agent_issues 1000678): the schema and default rows are written once per isolate and database handle, not on every request.
// Every GET of travel.q08.org ran every CREATE and every default INSERT in sequence against the D1 primary; when those writes queued behind the hourly
// tick the sign-in page answered in 5.3 to 6.0 s (9 of 38 hourly samples, all status 401, over the SLI's 5 s limit).
// TRAVEL-ENSURE-BATCH-1 (agent_issues 1000678, second step): the memo alone did not help the hourly availability probe, which always meets a fresh isolate: samples after the
// 1.44.2 deploy still read 4.8 s (a runner in the US, the D1 primary in Western Europe, about 30 statements one after the other, one round trip each). The statements now go in one
// db.batch call (one round trip; the sequential loop stays for a handle without batch), and the request path (handleTravel) first asks one read whether the tables exist and writes
// nothing when they do: the hourly tick (travelTick) still runs the full ensure, so a new column or table in DDL reaches the database within the hour.
const ENSURED_DBS = new WeakSet();
const TRAVEL_TABLES = DDL.map((s) => (/CREATE TABLE IF NOT EXISTS (\w+)/.exec(s) || [])[1]).filter(Boolean);

async function ensureTravel(db, nowIso) {
  if (db && typeof db === "object" && ENSURED_DBS.has(db)) return;
  const ts = nowIso || new Date().toISOString();
  const stmts = DDL.map((s) => db.prepare(s)).concat(Object.entries(DEFAULTS).map(([k, v]) => db.prepare("INSERT INTO travel_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING").bind(k, v, ts)));
  if (typeof db.batch === "function") await db.batch(stmts);
  else for (const s of stmts) await s.run();
  if (db && typeof db === "object") ENSURED_DBS.add(db);
}

// The request path: one read, no write when the tables are there.
async function ensureTravelCheap(db) {
  if (db && typeof db === "object" && ENSURED_DBS.has(db)) return;
  let have = 0;
  try {
    const r = await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN (" + TRAVEL_TABLES.map(() => "?").join(",") + ")").bind(...TRAVEL_TABLES).first();
    have = Number((r && r.n) || 0);
  } catch (e) { have = 0; }
  if (have >= TRAVEL_TABLES.length) { if (db && typeof db === "object") ENSURED_DBS.add(db); return; }
  await ensureTravel(db);
}

async function cfg(db) {
  const out = { ...DEFAULTS };
  const r = await db.prepare("SELECT key, value FROM travel_config").all();
  for (const row of r.results || []) out[row.key] = row.value;
  return out;
}

function addDays(iso, n) {
  const d = new Date(String(iso).slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function localParts(nowMs, tz) {
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
function tripState(rows, today, c) {
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

function bookingLink({ city, country, checkin, nights, maxPerNight, currency, adults }) {
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

function transitLink(from, to) {
  const q = new URLSearchParams({ api: "1", origin: from, destination: to, travelmode: "transit" });
  return "https://www.google.com/maps/dir/?" + q.toString();
}

// Model output -> at most 3 clean options. Accepts a bare JSON array, {options:[...]}, or JSON inside prose/fences.
function parseOptions(text) {
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
function rankAndMark(opts, reactions, state) {
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

function promptFor(state, c, profileRows, reactions, monthName) {
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

function modelText(r) {
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

async function sign(secret, id) {
  return b64u(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode("travel:" + id)));
}
// crypto.subtle.verify compares in constant time.
async function verify(secret, id, sig) {
  if (!secret || !sig) return false;
  try { return await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64u(sig), new TextEncoder().encode("travel:" + id)); }
  catch (e) { return false; }
}

function signingKey(env) { return env.TRAVEL_KEY || env.WELLBEING_TOKEN || env.COMPANION_KEY || ""; }

function optionId() {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return "tr_" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function mailFor(state, opts, links, c) {
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
async function reconcile(db, rows, today, nowIso) {
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
async function travelTick(env, deps = {}) {
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
async function applyReaction(db, o, action, nowIso) {
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

const SESSION_DAYS = 120;          // a signed-in device stays signed in; each visit in the last 60 days renews it
const CODE_TRIES = 5;               // wrong guesses allowed per mailed code
const LOGIN_TTL_MIN = 20;
const LOGIN_MAILS_PER_HOUR = 4;
const CHAT_MODEL_MENU = ["@cf/openai/gpt-oss-120b", "@cf/zai-org/glm-5.3", "@cf/moonshotai/kimi-k2.6"];

// The signing secret: a worker secret when one is set, else a random one generated once and kept in D1.
async function authKey(env, db) {
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

async function makeToken(key, kind, expSec) { return expSec + "." + await sign(key, kind + ":" + expSec); }
async function tokenOk(key, kind, tok, nowMs) {
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
async function accessOk(request, c, deps, nowMs) {
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

async function chatAuthed(request, env, db, c, deps, nowMs) {
  if (bearerOk(request, env)) return "bearer";
  if (env.COMPANION_KEY && sameString(cookie(request, "pc_key"), env.COMPANION_KEY)) return "companion-key";
  const key = deps.key !== undefined ? deps.key : await authKey(env, db);
  if (key && await tokenOk(key, "sess", cookie(request, "trv"), nowMs)) return "session";
  if (await accessOk(request, c, deps, nowMs)) return "access";
  return "";
}

// First JSON object or array in a model reply (bare, fenced, or inside prose).
function firstJson(text) {
  const s = String(text || "");
  const tries = [s, (s.match(/```(?:json)?\s*([\s\S]*?)```/) || [])[1], (s.match(/\{[\s\S]*\}/) || [])[0]];
  for (const t of tries) { if (!t) continue; try { return JSON.parse(t); } catch (e) { /* next shape */ } }
  return null;
}

const clean = (v, n) => String(v == null ? "" : v).replace(/[\r\n<>]+/g, " ").trim().slice(0, n);

function parseChat(text, today) {
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

const CHAT_SYSTEM = [
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
  "Use [] when there are no options or nothing was learned, and null when there is no question. Respect every logistics fact (residence, visa rules) in the context."
].join("\n");

function chatContext(x) {
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

function historyText(row) {
  let t = String(row.content || "");
  if (row.role !== "assistant" || !row.meta) return t;
  try {
    const m = JSON.parse(row.meta);
    if (m.options && m.options.length) t += "\n[Options shown: " + m.options.map((o) => o.city + (o.pick ? " (my pick)" : "") + (o.status && o.status !== "proposed" ? " - " + o.status : "")).join(", ") + "]";
    if (m.question && m.question.text) t += "\n[Asked: " + m.question.text + "]";
  } catch (e) { /* plain text */ }
  return t;
}

const OPEN_TURN = "(The traveller just opened the planner. Greet them in one short line, then lead with your best proposal for what comes next, given where they are and what is booked.)";

function chatPrompt(x) {
  const msgs = [{ role: "system", content: CHAT_SYSTEM + "\n\n" + chatContext(x) }];
  for (const h of x.history || []) msgs.push({ role: h.role, content: historyText(h).slice(0, 3000) });
  msgs.push({ role: "user", content: x.text || OPEN_TURN });
  return msgs;
}

function chatModels(c, allow) {
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
async function chatTurn(env, deps, input) {
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
async function chatState(db, c, nowMs) {
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
async function handleTravel(request, env, deps = {}) {
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

const WX_FORECAST_DAYS = 16;
const VISA_WARN_DAYS = 7;          // a planned exit this close to the last allowed day is a warning
const FORECAST_TTL_MS = 3 * 3600e3;
// Indo-Gangetic plain and the Nepal Terai and valleys: dense winter fog (mid-December to early February) stops trains and flights.
const FOG_BELT = { latMin: 23.5, latMax: 31.5, lonMin: 73, lonMax: 89 };
const WX_CODES = { 0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow", 80: "showers", 81: "showers", 82: "heavy showers", 95: "thunderstorms", 96: "thunderstorms", 99: "thunderstorms" };

function daysBetween(a, b) { return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400e3); }

function countryName(cc) {
  const code = String(cc || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return String(cc || "");
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch (e) { return code; }
}

// a real calendar day (V8's Date.parse rolls 2027-02-30 over to 2 March, so the round trip decides)
const isoDay = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return false; const t = Date.parse(s + "T12:00:00Z"); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };

function shiftYear(iso, n) {
  const y = Number(iso.slice(0, 4)) + n;
  const md = iso.slice(5) === "02-29" ? "02-28" : iso.slice(5);
  return y + "-" + md;
}

function fogSeason(lat, lon, day) {
  if (lat == null || lon == null) return false;
  const b = FOG_BELT;
  if (lat < b.latMin || lat > b.latMax || lon < b.lonMin || lon > b.lonMax) return false;
  const md = String(day).slice(5);
  return md >= "12-10" || md <= "02-10";
}

// Dates the party is in each country: a stop covers start_date through end_date (the travel day counts in both countries,
// as immigration counts it).
function presence(stops) {
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
function visaStatus(permits, stops, today) {
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
function weatherRequests(stop, today) {
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

function parseWeather(j, kind) {
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
function dayPlan(stops, today, wx, lodging) {
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
function checkinDraft(ev, c) {
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
function placeCards(stops, today, wx, lodging, c, picks) {
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

function moveCards(stops, today, travel) {
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

async function planState(db, c, nowMs, deps) {
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

const IMPORT_SYSTEM = [
  "You turn pasted travel text (booking confirmations, emails, notes) into structured bookings. Extract only what the text states; never guess a date, place or reference.",
  "Reply with JSON only, exactly this shape:",
  "{\"bookings\":[{\"category\":\"lodging|travel\",\"title\":\"short name, e.g. the hotel or 'Flight KTM to DEL'\",\"venue\":\"\",\"city\":\"\",\"country\":\"two-letter code\",\"start_date\":\"YYYY-MM-DD\",\"end_date\":\"YYYY-MM-DD\",\"booking_ref\":\"\"}],\"learned\":[{\"label\":\"two to four words\",\"statement\":\"one sentence about the traveller's preference\"}]}",
  "lodging: start_date is check-in, end_date is check-out, city is where the stay is. travel: one row per flight, train or bus leg; start_date is the departure day, city is the destination.",
  "learned: only preferences the text plainly shows (a room type they chose, a class they booked). Use [] when there is nothing."
].join("\n");

function parseImport(text) {
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
async function importText(env, deps, input) {
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

async function saveStop(db, deps, body, nowIso) {
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

async function savePermit(db, body, nowIso) {
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
function planText(stops, visa) {
  const s = (stops || []).slice(0, 30).map((x) => "- " + x.city + (x.country ? ", " + x.country : "") + ": " + x.start_date + " to " + x.end_date + (x.note ? " (" + x.note + ")" : "")).join("\n");
  const v = (visa || []).map((x) => "- " + x.text).join("\n");
  return (s ? "Planned stops (not booked unless listed under Booked ahead):\n" + s : "") + (v ? (s ? "\n" : "") + "Visa limits:\n" + v : "");
}

// TRAVEL-PICKS-1 (2026-10-26). Rowan's pillars: where to go, sleep, eat and what to do ("basically only two": places and
// getting around). Sleep had a search link; eat and do were only a chat question. Each stop now carries three places to eat
// and three things to do, made from the profile on the tick (one stop per tick) or on demand, never asked as a question.
// A "not for me" is a travel_reactions row (reaction 'no', kind eat|do) and every later pick for any city avoids it.
// Links are map searches for the named place, never a made-up listing or booking.
const PICKS_SYSTEM = [
  "You suggest where to eat and what to do for a traveller who loves travel and hates planning; they sometimes travel with a companion (the profile says who and how). You never ask questions.",
  "Reply with JSON only, exactly this shape: {\"eat\":[{\"name\":\"\",\"area\":\"\",\"why\":\"\"}],\"do\":[{\"name\":\"\",\"area\":\"\",\"why\":\"\"}]}",
  "Exactly 3 of each. name: a real, specific place, market, dish-and-place or activity that exists in that city, as it is known locally. area: the neighbourhood. why: one plain sentence on why it fits this traveller, from the profile.",
  "Prefer what locals use over the generic tourist circuit. Respect every diet, budget, mobility and logistics fact in the profile. Never repeat anything listed as rejected."
].join("\n");

function picksPrompt(stop, profileRows, rejected) {
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

function parsePicks(text) {
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

function mapLink(name, area, city, country) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([name, area, city, countryName(country)].filter(Boolean).join(", "));
}

function pickList(picks, stop, kind) {
  return (picks || []).filter((x) => x.stop_id === stop.id && x.kind === kind && norm(x.city) === norm(stop.city))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => ({ id: x.id, name: x.name, area: x.area || "", why: x.why || "", map: mapLink(x.name, x.area, stop.city, stop.country) }));
}

// The next stop within 60 days that has no open picks for its current city.
async function picksDue(db, today) {
  return db.prepare("SELECT s.id, s.city, s.country, s.start_date, s.end_date, s.note FROM travel_stops s WHERE s.end_date >= ? AND s.start_date <= ? AND NOT EXISTS (SELECT 1 FROM travel_picks p WHERE p.stop_id = s.id AND p.status = 'open' AND lower(p.city) = lower(s.city)) ORDER BY s.start_date LIMIT 1")
    .bind(today, addDays(today, 60)).first();
}

async function makePicks(db, deps, c, stop, nowIso) {
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

async function pickNo(db, id, nowIso) {
  if (!/^pk_[0-9a-f]{18}$/.test(id)) return { ok: false, error: "no such suggestion" };
  const x = await db.prepare("SELECT id, city, kind, status FROM travel_picks WHERE id = ?").bind(id).first();
  if (!x) return { ok: false, error: "no such suggestion" };
  if (x.status !== "open") return { ok: true, changed: false };
  await db.prepare("UPDATE travel_picks SET status = 'no' WHERE id = ?").bind(id).run();
  await db.prepare("INSERT INTO travel_reactions (option_id, trip_key, reaction, city, kind, ts) VALUES (?, NULL, 'no', ?, ?, ?)").bind(id, x.city, x.kind, nowIso).run();
  return { ok: true, changed: true };
}

return Object.freeze({ DDL, DEFAULTS, MODELS, PROFILE_CHARS, BASE, PLANNER_URL, ensureTravel, ensureTravelCheap, cfg, addDays, localParts, tripState, bookingLink, transitLink, parseOptions, rankAndMark, promptFor, modelText, sign, verify, signingKey, optionId, mailFor, reconcile, travelTick, applyReaction, SESSION_DAYS, CODE_TRIES, LOGIN_TTL_MIN, LOGIN_MAILS_PER_HOUR, CHAT_MODEL_MENU, authKey, makeToken, tokenOk, accessOk, chatAuthed, firstJson, parseChat, CHAT_SYSTEM, chatContext, historyText, OPEN_TURN, chatPrompt, chatModels, chatTurn, chatState, handleTravel, WX_FORECAST_DAYS, VISA_WARN_DAYS, FOG_BELT, daysBetween, countryName, shiftYear, fogSeason, presence, visaStatus, weatherRequests, parseWeather, dayPlan, checkinDraft, placeCards, moveCards, planState, IMPORT_SYSTEM, parseImport, importText, saveStop, savePermit, planText, PICKS_SYSTEM, picksPrompt, parsePicks, mapLink, picksDue, makePicks, pickNo });
})(); // TRAVEL-INLINE-END

var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var __name22 = __name2;
// COMPANION-STALL-YIELD-1 (1.37.0, agent_issues 100064, pillar personal; minor: the worker now stops a prune loop, an attempt and a rewrite on its own):
// the release note is carried by the comment blocks at STALL_MIN, shortenFeedback, pruneRepeat and attemptBudgetStop, and none is added to the VERSION
// line below (VERSION-LINE-NOTES-1, 2026-10-19). Its older trailing notes stay until length-lede.test.mjs stops pinning "LENGTH-LEDE-1" on that line.
// VERSION-NOTES-MOVED-1: release notes live in the block below
var VERSION = "1.45.0";
/* 1.44.14 COMPANION-LENGTH-HEADROOM-1 (issue 1000633, pillar personal; patch): repeated length failures alongside exhausted retry budgets expose too little headroom for model output variation. Length-only repairs now target 500 words below the unchanged ceiling while remaining inside each form's normal writer band. */
/* 1.43.6 BP26-AI-ACT-ART50-1 and BP26-STRUCTURED-DATA-1 (2026-10-26, agent_issues 1000341 and 1000336, pillar core; patch): the visible AI-generated label of every reading.q08.org piece now has its machine-readable half. A piece page carries an Article JSON-LD block (headline, datePublished, url, an Organization as author, never an AI or invented persona, and creditText saying it was written by AI and that no human reviews pieces before they appear) and the index page a Blog block. Measured before: the reading pages carried the visible label and no JSON-LD at all. */
/* 1.43.5 BP26-EDGE-SECURITY-1 (2026-10-26, agent_issues 1000356, pillar security; patch): every response of reading.q08.org and travel.q08.org now carries a Referrer-Policy (strict-origin-when-cross-origin), X-Frame-Options DENY and X-Content-Type-Options nosniff unless the route already set its own; measured before: reading.q08.org sent no referrer policy and no frame protection, travel.q08.org no frame protection. A wrapper around the final fetch handler copies the response only when a header is missing; redirects, streams and WebSocket upgrades are untouched. */
/* 1.43.3 COMPANION-REVIEWER-HYGIENE-1 (2026-10-26, pillar personal; patch; port of q08-signal-engine 0.36.0 Q08-REVIEWER-HYGIENE-1): a fact-check reviewer's object printed as a string is unwrapped, an item with no claim text is set aside (a fail that names nothing else still fails closed), and an item whose closing clause says it is supported ("matches source", "so supported", "which the source supports") is acquitted unless that clause also denies it. No check on names, years, figures or the two-family rule changed. */
/* 1.43.2 COMPANION-SERIAL-TITLE-1 (2026-10-26, pillar personal; patch): a serial installment takes the running title with its number ("<title>, part N", N from companion_series.chapters plus one) before the duplicate-title check, so the check no longer rejects a full compose for keeping the title the prompt tells the writer to keep; every other form keeps the check as it was. */
// 1.43.0 BP26-AI-LABEL-1 (2026-10-26, pillar reach; EU AI Act Art. 50(4), applicable since 2026-08-02): every reading.q08.org piece says in its meta line that it is AI-generated and has no human review before publication.
/* 1.42.0 TRAVEL-PICKS-1 (2026-10-26, pillar personal; minor): the owner's pillars (2026-10-24: "where to go, where to sleep, what to eat, how to get around, and what to do ... basically only two"). Each upcoming stop on the travel Places tab now carries three places to eat and three things to do, made from the profile on the hourly tick (one stop per tick, within 60 days) or by "Suggest now"/"Fresh ideas", each with a map-search link and a "Not for me" that is remembered (travel_reactions kind eat|do) and never bans the city from stop ideas. New table travel_picks; routes POST /travel/api/picks and /travel/api/pick-no. Nothing is booked. */
/* 1.41.0 READING-NO-SOURCE-LEDE-1 (2026-10-26, pillar personal; minor): the owner (2026-10-21): "you also don't need to say lead every article was from Wikipedia". The writer no longer credits its source in the lede or the prose; each piece page lists its sources in a quiet footer instead, built from anchor_json refs; pieces already stored lose the "according to the Wikipedia article on ..." clause at display time (plainCredit), so the stored text, the grounding check and the fact-check are unchanged. */
/* 1.40.0 TRAVEL-PILLARS-1 (2026-10-26, pillar personal, owner: "where to go, where to sleep, what to eat, how to get around, and what to do ... it's basically only two"; minor): the travel page groups the plan into two tabs. Places: visa days, check-in drafts and one card per stop with Sleep (booked stay and nights still open, a stay search, ideas), Eat and Do (one tap asks the chat for specific picks), its weather range and fog season. Getting around: each move between stops with its booked journey, a routes link, a "best way" question and fog from the place being left, then the day-by-day list. */
/* 1.39.1 TRAVEL-SIGNIN-MAIL-1 (2026-10-26, pillar personal, owner screenshot; patch): the travel planner's "Email me a code" was refused while companion e-mail is off (wellbeing_config email_mode), so the owner could not sign in. Sign-in codes go through sendOwnerNotice kind "signin", which skips email_mode and owner_notice_enabled (the owner asked for that mail that minute); a failed send says "Sorry, the code didn't go out" instead of a config key and logs the detail. */
/* 1.39.0 READING-SITEMAP-1 (issue 4120, pillar personal; minor): expose only accuracy-passed, non-retracted reading pages through /sitemap.xml; keep the existing robots.txt exclusion and route authorization, separate from issue 100064. */
/* 1.38.2 WEBMCP-CATCH-LOGGING-1 (2026-10-25): report WebMCP injection and header-rewrite errors to Workers Logs. */
/* 1.38.1 COMPANION-FACTCHECK-FRESH-1 (2026-10-25, agent_issues 100064, pillar personal; patch): fact-check retries bypass cached verdicts so repeated drafts receive a fresh review. */
/* 1.38.0 NO-REGISTRAR-1 (2026-10-21, pillar personal): the prose filter list no longer names the closed registrar. */
/* 1.37.2 DOMAIN-PLANE-OWNER-MAIL-1 (2026-10-20, agent_issues 100229, pillar personal; patch): owner notices (morning brief, check-ins, readings) are sent from companion@q08.org first and from rowan.quni@qnfo.org only when the SEND_EMAIL binding refuses the q08.org sender; subscriber mail keeps its sender. */
/* 1.37.1 VERSION-LINE-NOTES-COMPANION-1 (2026-10-19, agent_issues 100253, pillar personal; patch, a comment moved): the release notes of every earlier version rode on the VERSION line (about 64,000 chars), so a version bump of this worker rewrote it in worker.js and in deployed-current.worker.js, a patch of about 257 KB, past the code loop's publish cap. The notes of 1.36.0 and earlier are in the git history of personal-companion/worker.js; new notes go in this block, never on the VERSION line (VERSION-LINE-NOTES-1, qnfo-fleet-control 0.40.1 and qnfo-fleet-dashboard 1.51.8, did the same for those two workers). 1.37.0 COMPANION-STALL-YIELD-1 (issue 100064): the stall issue closes only on two pieces since its filing with no two failed runs between them; the fresh-error digest; shortenFeedback; the prune-repeat and attempt-budget stops. */
var MODELS = [
  "@cf/moonshotai/kimi-k2.6",
  "@cf/openai/gpt-oss-120b",
  "@cf/zai-org/glm-5.3"
];
var EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
var GEN_MAX_TOKENS = 14e3;
var CRITIQUE_TIMEOUT_MS = 3e4;
var EMBED_TIMEOUT_MS = 3e4;
var SIM_THRESHOLD = 0.9;
var WRITER_MODEL = "deepseek-chat";
var WRITER_MODEL_ESSAY = "deepseek-reasoner";
var CRITIC_MODEL = "deepseek-chat";
var WRITER_TIMEOUT_MS = 3e5;
var WRITER_URL = "https://api.deepseek.com/chat/completions";
var ACCEPT_FLOOR_NOTES = 4;
var ACCEPT_FLOOR_ESSAY = 5;
var MAX_PIECES_PER_DAY = 5;
// PUBLISH-QUOTAS-1 (owner directive 2026-10-17: "PUBLISH STREAMS SHALL HAVE SEPARATE QUOTAS FOR EACH PROPERTY, DO NOT
// COMMINGLE STREAMS"). reading.q08.org reads its own number from ops_config publish_quotas instead of holding a
// private constant that only a deploy could change; MAX_PIECES_PER_DAY stays as the fallback when the row is absent.
// q08.org and papers.qnfo.org read the same object under their own keys, so no property can spend another's budget.
var QUOTA_PROPERTY = "reading.q08.org";
var QUOTAS_KEY = "publish_quotas";
async function readingQuota(env) {
  try {
    var r = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = ?1").bind(QUOTAS_KEY).first();
    var raw = r && r.value ? JSON.parse(String(r.value)) : null;
    var v = raw && Object.prototype.hasOwnProperty.call(raw, QUOTA_PROPERTY) ? Number(raw[QUOTA_PROPERTY]) : NaN;
    if (Number.isFinite(v) && v >= 0 && v <= 500) return Math.floor(v);
  } catch (e) {
    console.error(JSON.stringify({ worker: "personal-companion", event: "publish-quota-read", error: String(e && e.message || e).slice(0, 160) }));
  }
  return MAX_PIECES_PER_DAY;
}
var GEN_HOURS_UTC = [4, 8, 12, 16, 20];
var BANNED_MODELS = ["llama", "mistral", "gemma-7b", "gemma-4-26b", "qwen3-30b", "qwen2.5", "r1-distill", "qwq-", "-8b", "-11b", "-7b", "-flash", "-fp8-fast", "-lora", "-mini", "-small"];
function modelAllowed(m) {
  var low = String(m || "").toLowerCase();
  for (var bi = 0; bi < BANNED_MODELS.length; bi++) {
    if (low.indexOf(BANNED_MODELS[bi]) >= 0) return false;
  }
  return true;
}
__name(modelAllowed, "modelAllowed");
__name2(modelAllowed, "modelAllowed");
__name22(modelAllowed, "modelAllowed");
var NL = String.fromCharCode(10);
function L() {
  return Array.prototype.slice.call(arguments).join(NL);
}
__name(L, "L");
__name2(L, "L");
__name22(L, "L");
var RHYTHM = ["notes", "essay", "notes", "essay", "notes", "essay", "serial"];
// COMPANION-VERIFY-1 (1.14.0): there is no hard-coded topic list. pickTopic() draws the subject from live Wikipedia and arXiv.
// ANALYSIS-FORM-1:BEGIN (sourced from _shared/analysis-form.js; applied by _shared/inline-analysis-form.mjs; do not edit inside a worker)
// ---- ANALYSIS-FORM-1 (EK-6, roadmap row 1753, charter pillar reach). One analysis form for every writer that outsiders read.
//
// WHAT. The form that reading.q08.org grew over October 2026 lives here once: the writer's rules (lede, systems analysis, quotation,
// contested-topic sources, the strongest objection, even keel), the essay form and the adversarial reader's rubric; the objection
// finder; the lede helpers; the even-keel check (prompt, parser, verdict, reviewer choice, revision note); the sources footer with
// the host profile table; the AI label. A form improvement is made in this file, inlined into each adopting worker by
// `node _shared/inline-analysis-form.mjs <worker>`, and proved by `_shared/analysis-form.test.mjs`, which also fails when an adopting
// worker holds a stale copy. Nothing here imports anything or touches a binding: pure strings and pure functions, so any worker can
// take it (personal-companion today; q08-signal-engine and the research writers by the same script).
//
// WHY. Before this file the form existed only inside personal-companion/worker.js while q08 and the research writers kept separate
// prompts, so each fix (a lede that names its subject, an objection placed where the argument needs it, a label for AI text) had to be
// ported by hand, and the even-keel check (EK-3) was written against a model family that did not exist (BALANCE_FAMILY "ensemble-policy-1").
//
// HOW TO ADOPT (q08-signal-engine, research writers). 1) Run `node _shared/inline-analysis-form.mjs q08-signal-engine --anchor "<a line of
// the worker to insert the block before>"` once; it writes the block between its BEGIN and END marker lines
// and mirrors deployed-current.worker.js; later runs replace the block in place (`--check` only reports a stale copy). 2) Build the
// writer prompt from the AF_ rules (AF_LEDE_RULE, AF_SYSTEMS_RULE, AF_QUOTE_RULE, AF_CONTESTED_RULE, AF_OBJECTION_RULE, AF_EVEN_KEEL_RULE) and
// AF_P_ESSAY; keep the worker's own voice and format lines around them. 3) After the deterministic gate and the fact-check, ask one reviewer
// from another family (afPickBalanceReviewer) with AF_BALANCE_PROMPT, read the reply with afParseBalanceScore, decide with afBalanceVerdict,
// and on a fail revise with afBalanceRevisionNote. 4) Render with afSourcesFooter and afAiLabelHtml.
//
// RULES FOR EDITING. ES5 style (var and function), no import or export, every name starts with AF_ or af, no `*` followed by `/` in a
// comment. A change here changes every adopter on its next inline run: version the change in AF_VERSION and say what moved in the PR.
var AF_VERSION = "1.0.0";
var AF_NL = "\n";
function afLines() { return Array.prototype.slice.call(arguments).join(AF_NL); }
function afEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

// ---- the writer's rules, one string each, verbatim from reading.q08.org's prompt (the pinned tests read them back)
var AF_LEDE_RULE = "LEDE (inverted pyramid, checked before anything else): the first paragraph, at most 110 words and before any heading, tells a reader who has never heard of the subject what it is, where it comes from in the world (the place, the period, the field or the people) and why it matters. Never credit or name the source document in the lede or anywhere in the prose: no 'according to the Wikipedia article', no 'the arXiv paper describes'; the sources are listed under the piece for the reader. Name the subject in the first sentence. Then the most important facts from the source, most important first, and only then the analysis. Never open on a generality, an aphorism, a question or an abstract noun ('the idea of', 'the pattern').";
var AF_SYSTEMS_RULE = "CONTEXT AND SYSTEMS ANALYSIS (required; this is why the piece exists, and a piece that only retells its source is rejected): after the facts, place the subject in its bigger picture and explain the system behind it, from the source material. Name the parties or parts involved and what each is rewarded, punished or constrained by; the constraint, delay or information gap that shapes the outcome; the feedback loop that keeps it in place or changes it; who gains and who pays; and where the same arrangement operates beyond this case. Reason openly and say it is reasoning ('the incentive is ...', 'that means ...', 'if ... then ...'), introducing no name, date, number, event or quotation the source material does not contain. Every sentence of the analysis that the source does not state must read as reasoning from its first words; never state an inferred arrangement, funding, motive or behaviour as a reported fact. Build the analysis from this subject's own particulars in the source (its named parties, figures, dates and events): a paragraph that would read the same for any other subject is boilerplate and is rejected. Begin the analysis with a line of its own that contains exactly <!-- analysis --> (readers never see it): everything before that line is reporting from the source material, everything after it is your analysis.";
var AF_QUOTE_RULE = "Quotations: quote only words that appear verbatim in the source material, attributed to the person the source attributes them to, and only from the source that concerns that person; never invent, paraphrase into quotation marks or move a quotation to another subject. Every quotation of five or more words is checked against the sources.";
var AF_CONTESTED_RULE = "- For a contested topic in policy, history, geopolitics, health or economics, use at least three independent full-text sources with at least two explicit viewpoint labels and one verified non-US source. Compare where the viewpoints differ; source metadata is not evidence for factual claims.";
var AF_OBJECTION_RULE = "- The strongest objection to your central claim must appear in the piece, stated fairly in your own words as an objection a careful reader could raise, with an honest assessment of how bad it is. Never put it in quotation marks and never attribute it to critics, scholars, commentators or anyone the source material does not name making that objection. It may rest on the source material or be pure logic; it may not rest on facts from outside it. Where it sits is your choice; do not give it the same heading or the same position twice in a row.";
// EK-3 (writer side): the reviewer below scores what the writer was asked for here, so a draft is told its bar before it is judged.
var AF_EVEN_KEEL_RULE = "- Even keel: a disputed claim is stated as the position of the party that holds it, naming the party only where the source material names it, never as settled fact. Use neutral descriptive words for people, groups, causes and events; where the source material's own wording is loaded, report it as that party's wording or replace it with a plain description. Where the source material holds more than one account of an event or a policy, give each its strongest form and say where they differ.";
// The long-form essay contract (reading.q08.org's P_ESSAY; the probe for issue 1000716 reads the first line of it in both files).
var AF_P_ESSAY = afLines(
  "FORM: essay, 2000 to 2800 words. This is long-form. One sustained line of thought, carried to the end; do not stop while the argument is still thin, and do not pad.",
  "The subject is one thing. Write about the subject itself, in depth. Do not survey. Argue.",
  "Your argument must be a specific, falsifiable claim with consequences - something a knowledgeable reader could disagree with. It must not be an analogy, a family resemblance, or a restatement of the obvious.",
  "You are given real source material below. Mine it. Use the names, dates, numbers, mechanisms and cases it contains, and only those; a piece that could have been written without reading the sources has failed, and a piece that states anything the sources do not contain is discarded.",
  "Required content, not required sections: (a) the strongest objection to your central claim, stated fairly in your own words (never as a quotation or an unnamed critic), weighed honestly; (b) what would have to be true for your claim to hold, and what observation would falsify it. Where these sit is your call - the objection can be a heading, two sentences mid-argument, or the whole last section. Do not end every piece with the same two moves.",
  "Vary the section plan. Your previous pieces are listed below; your structure must differ from each of their structures. A reader must not be able to predict your headings from the first page."
);
// The adversarial reader's rubric (reading.q08.org's P_CRITIQUE).
var AF_P_CRITIQUE = afLines(
  "You are an adversarial reader. You dislike fluency. You are looking for reasons this piece is worthless.",
  "You are given the SOURCE MATERIAL the writer was allowed to use, and the piece.",
  "Score each dimension 0 to 10. Be harsh: a 7 means genuinely good.",
  "specificity: does it hang on concrete checkable particulars from the source material, or could it have been written about anything?",
  "argument: is there a claim that could be wrong, or only gestures?",
  "objection: is the stated objection the strongest available one, or a straw man?",
  "voice: plain scholarly prose free of filler, tells, and self-reference?",
  "grounding: does every concrete claim (name, date, number, event, quotation) trace to the source material? Score 0 if you find one that does not. A sentence that reports as fact something the source does not state (an event, an arrangement, a behaviour, a cause) counts as such a claim. Reasoning the writer frames as reasoning ('the incentive is ...', 'that means ...', 'if ... then ...', 'it follows that ...') and that adds no name, date, number, event or quotation is not a grounding failure: judge it under argument and systems. Text after a line <!-- analysis --> is the writer's marked analysis: there, count under grounding only a concrete invented fact (a name, date, number, event, rule, quotation or study the source material does not contain); claims about incentives, constraints, motives and consequences in that section are judged under argument and systems, never grounding. Text before that line is held to the full rule.",
  "systems: does the piece place its subject in a bigger picture and explain the system behind it (the parties and what each is rewarded or constrained by, the constraint or information gap, the feedback loop, who gains and who pays, where else it operates), or does it only retell the source? A retelling scores at most 3.",
  "invented: every concrete claim you found that the source material does not support, each as a short quotation copied exactly from the piece (at most 16; an empty list when there is none).",
  'Return JSON only: {"specificity":n,"argument":n,"objection":n,"voice":n,"grounding":n,"systems":n,"invented":["exact quotation", ...],"verdict":"accept" or "reject","why":"one sentence"}'
);

// ---- the objection finder (OBJECTION-FIND-1): where the essay contract lets the objection sit, not only under a heading that says so
function afExtractSection(md, needle) {
  var lines = String(md).split(AF_NL);
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
var AF_OBJECTION_CUE_RE = /\b(objections?|object(?:s)? that|counter-?arguments?|case against|argument against|strongest (?:challenge|reply|doubt)|a careful reader|a sceptic|a skeptic)\b/i;
var AF_OBJECTION_HEAD_RE = /\b(objections?|against|counter|critics?|sceptic|skeptic|doubts?|wrong|other side|caveats?|challenges?|reservations?|rebuttal|dissent|weakness(?:es)?)\b/i;
function afFindObjection(md) {
  var s = afExtractSection(md, "objection");
  if (s.length >= 40) return s;
  var paras = String(md || "").split(/\n\s*\n/).map(function (x) { return x.trim(); }).filter(Boolean);
  for (var i = 0; i < paras.length; i++) {
    if (paras[i].indexOf("#") === 0 || !AF_OBJECTION_CUE_RE.test(paras[i])) continue;
    var t = paras[i];
    if (t.length < 200 && i + 1 < paras.length && paras[i + 1].indexOf("#") !== 0) t += " " + paras[i + 1];
    t = t.replace(/\s+/g, " ").trim();
    if (t.length >= 40) return t;
  }
  var lines = String(md || "").split(AF_NL), on = false, out = [];
  for (var j = 0; j < lines.length; j++) {
    var l = lines[j].trim();
    if (l.indexOf("#") === 0) {
      if (on && out.join(" ").trim().length >= 40) break;
      on = AF_OBJECTION_HEAD_RE.test(l.replace(/^#+/, "")); out = [];
      continue;
    }
    if (on && l) out.push(l);
  }
  var h = out.join(" ").replace(/\s+/g, " ").trim();
  return on && h.length >= 40 ? h : s;
}

// ---- the lede (COMPANION-LEDE-1, LEDE-RULE-1, LEDE-SPLIT-1) and the sentence splitter it shares with sentence deletion
// SENT-INITIALISM-1 (1.26.2, companion_runs 6224 of 2026-10-14 08:11 UTC): a dotted initialism ("U.S.", "D.C.") ended a sentence, so the
// critic prune that deleted "... of the U.S." left the fragment "Consul. Negotiations failed ..." and the critic scored the fragment
// invented. An initialism of two or more dotted capitals no longer ends a sentence (a sentence that truly ends on one joins the next).
var AF_SENT_ABBREV_RE = /(?:^|[\s(])(?:(?:[A-Z]\.)+[A-Z]|[A-Z]|Dr|Mr|Mrs|Ms|Prof|St|No|vs|v|cf|Fig|Eq|et al|e\.g|i\.e|pp?|Jr|Sr|Gen|Gov|Sen|Rep|Lt|Col|Capt|Sgt|Hon|Stat|Ct|Mt|Ft)\.\s*$/;
function afExtractLede(md) {
  var lines = String(md).split(AF_NL);
  var i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  var startsHeading = i < lines.length && lines[i].trim().indexOf("#") === 0;
  while (i < lines.length && lines[i].trim().indexOf("#") === 0) {
    i++;
    while (i < lines.length && !lines[i].trim()) i++;
  }
  var buf = [];
  while (i < lines.length) {
    var t = lines[i].trim();
    if (!t) break;
    if (t.indexOf("#") === 0) break;
    if (t.indexOf("- ") === 0 || t.indexOf("> ") === 0) break;
    buf.push(t);
    i++;
  }
  var lede = buf.join(" ").trim();
  var rest = startsHeading ? String(md).trim() : lines.slice(i).join(AF_NL).trim();
  return { lede, rest, startsHeading };
}
// COMPANION-LEDE-1 (1.17.0; owner 2026-10-13: every piece opens with a proper lede, inverted pyramid). The lede is the first paragraph a
// reader sees (piece.lede, else the first prose paragraph of the body). It must share at least one significant word with the subject's
// title (the first five letters, so "trackway" matches "trackways"), must not open on abstract framing or a question, and stays short.
var AF_LEDE_MAX_WORDS = 120;
var AF_LEDE_ABSTRACT_RE = /^\s*(?:(?:the|this|that|these|such|our)\s+(?:very\s+)?(?:idea|notion|concept|question|problem|pattern|mechanism|story|history|tension|dynamics?|nature|essence|meaning|paradox)\s+of\b|in\s+(?:a|an|the|our|today's)\s+(?:world|age|era|time|times)\b|throughout\s+(?:history|time|the\s+ages)\b|since\s+the\s+dawn\b|(?:imagine|consider|picture)\b|what\s+(?:if|does|do|is|makes|happens)\b|(?:we|you)\s+(?:often|rarely|tend|all|like)\b|there\s+is\s+something\b|few\s+\w+\s+(?:are|have|capture)\b)/i;
var AF_LEDE_STOP = /^(this|that|with|from|have|were|their|there|which|when|what|into|than|then|they|them|been|also|only|more|most|such|does|each|over|will|would|could|should|about|after|before|because|while|where|your|using|based|towards?|new|how|why|the|and|for)$/;
function afLedeWords(t) { return String(t || "").toLowerCase().replace(/[‐-―−]/g, "-").split(/[^a-z0-9À-ɏ]+/).filter(function (w) { return w.length >= 4 && !AF_LEDE_STOP.test(w); }); }
function afLedeOf(piece) {
  var l = String(piece && piece.lede || "").trim();
  if (l) return l;
  var paras = String(piece && piece.body_md || "").split(/\n\s*\n/);
  for (var i = 0; i < paras.length; i++) { var p = paras[i].trim(); if (p && p.charAt(0) !== "#" && p.indexOf("- ") !== 0 && p.indexOf("> ") !== 0 && p.indexOf("<!--") !== 0) return p.replace(/\s+/g, " "); }
  return "";
}
function afLedeProblems(piece, subject) {
  var lede = afLedeOf(piece), out = [];
  if (!lede) return ["lede missing: open with a paragraph that says what the subject is and where it comes from"];
  var n = lede.split(/\s+/).filter(Boolean).length;
  if (n > AF_LEDE_MAX_WORDS) out.push("lede too long (" + n + " words; the first paragraph is at most " + AF_LEDE_MAX_WORDS + ")");
  var first = (lede.match(/^[\s\S]*?[.!?](?=\s|$)/) || [lede])[0];
  if (AF_LEDE_ABSTRACT_RE.test(lede.replace(/^[*_\s]+/, "")) || /\?\s*$/.test(first)) out.push("lede opens on abstract framing or a question ('" + lede.slice(0, 50) + "'): open by saying what the subject is and where it comes from");
  var want = afLedeWords(subject);
  var have = afLedeWords(lede).map(function (w) { return w.slice(0, 5); });
  if (want.length && !want.some(function (w) { return have.indexOf(w.slice(0, 5)) >= 0; })) out.push("lede does not name the subject: the first paragraph must say what " + String(subject).slice(0, 80) + " is and where it comes from");
  return out;
}
// LEDE-SPLIT-1 (1.19.1, run 5342-5364: three of five drafts failed only or mainly on "lede too long", 137-174 words). An over-long first
// paragraph is split at a sentence boundary: the opening sentences up to AF_LEDE_SPLIT_WORDS stay the lede, the rest becomes the first body
// paragraph. Nothing is added or removed, so no fact changes; a single sentence longer than the limit is left to the check.
var AF_LEDE_SPLIT_WORDS = 100;
function afSplitLongLede(piece) {
  var lede = String(piece && piece.lede || "").trim();
  var count = function (s) { return String(s).split(/\s+/).filter(Boolean).length; };
  if (!lede || count(lede) <= AF_LEDE_MAX_WORDS) return piece;
  var raw = lede.match(/[\s\S]*?[.!?]+["')\]’”]*(?=\s|$)\s*|[\s\S]+$/g) || [lede], sents = [];
  raw.forEach(function (x) { if (sents.length && AF_SENT_ABBREV_RE.test(sents[sents.length - 1])) sents[sents.length - 1] += x; else sents.push(x); });
  var kept = [], n = 0, i = 0;
  for (; i < sents.length; i++) { var w = count(sents[i]); if (kept.length && n + w > AF_LEDE_SPLIT_WORDS) break; kept.push(sents[i]); n += w; }
  if (i >= sents.length) return piece;
  var head = kept.join("").trim(), rest = sents.slice(i).join("").trim();
  var body = String(piece.body_md || "");
  // when the lede was read out of the body (a draft that opened with a heading) the body already holds the paragraph: shorten only the lede
  if (body.indexOf(lede) !== -1) return Object.assign({}, piece, { lede: head });
  return Object.assign({}, piece, { lede: head, body_md: rest + "\n\n" + body });
}
// EK-1 (roadmap row 1748): the lede a reader is shown. The stored lede when there is one; otherwise the first prose paragraph of the body,
// cut at a sentence boundary when it runs past AF_LEDE_SPLIT_WORDS, so the index preview and the piece page always agree and a piece whose
// stored lede was lost to a prune still opens on a set-apart lede. Empty when the body holds no prose paragraph.
function afShownLede(piece) {
  var stored = String(piece && piece.lede || "").trim();
  if (stored) return stored;
  var derived = afLedeOf({ lede: "", body_md: piece && piece.body_md });
  if (!derived) return "";
  return String(afSplitLongLede({ lede: derived, body_md: "" }).lede || derived).trim();
}

// ---- the even-keel check (EK-3): one reviewer from a family other than the writer's scores how fairly the piece handles disagreement
var AF_BALANCE_MIN_SCORE = 70;
var AF_BALANCE_PROMPT = afLines(
  "You are an even-keel reviewer. You did not write this draft and you are not its editor. Score how fairly it handles disagreement, using only what is on the page.",
  "Score each part from 0 to 10:",
  "opposing: is the strongest argument against the draft's central claim stated at the strength its own holders would give it, and weighed honestly rather than set up to fail? A draft that makes no contested claim scores 10 here.",
  "wording: are loaded or partisan terms for people, groups, causes and events avoided, or reported as a party's own words? 10 means none unattributed.",
  "attribution: is every disputed claim attributed to the party that makes it, or stated as disputed, instead of asserted as settled fact? 10 means none unattributed.",
  "Do not judge accuracy, style, length or whether you agree with the draft. A draft is one-sided when it argues one position while presenting it as the only reasonable view.",
  "Return only JSON: {\"opposing\":n,\"wording\":n,\"attribution\":n,\"reason\":\"one sentence that names the weakest passage\"}"
);
function afBalanceScore(parts) { return Math.round(parts.opposing * 5 + parts.wording * 2.5 + parts.attribution * 2.5); }
// Reads a reviewer's reply: sub-scores 0 to 10 combined by weight into 0 to 100 (opposing counts double); a reply that gives only "score" is read as such.
// null when nothing usable is in the reply.
function afParseBalanceScore(text) {
  var t = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  var o = null, m = t.match(/\{[\s\S]*\}/);
  if (m) { try { o = JSON.parse(m[0]); } catch (e) { o = null; } }
  if (!o) {
    var parts0 = {}, any = 0;
    ["opposing", "wording", "attribution"].forEach(function (k) { var mm = t.match(new RegExp("\"" + k + "\"\\s*:\\s*(\\d+(?:\\.\\d+)?)")); if (mm) { parts0[k] = Number(mm[1]); any++; } });
    if (any === 3) o = parts0;
    else { var sm = t.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/); if (!sm) return null; o = { score: Number(sm[1]) }; }
  }
  var reason = String(o.reason || "").replace(/\s+/g, " ").trim().slice(0, 260);
  var p = { opposing: Number(o.opposing), wording: Number(o.wording), attribution: Number(o.attribution) };
  var haveParts = [p.opposing, p.wording, p.attribution].every(function (x) { return isFinite(x) && x >= 0 && x <= 10; });
  if (haveParts) return { score: afBalanceScore(p), parts: p, reason: reason };
  var score = Number(o.score);
  if (!isFinite(score) || score < 0 || score > 100) return null;
  return { score: Math.round(score), parts: null, reason: reason };
}
// pass, fail or unavailable: a missing or unreadable reply is "unavailable" (the caller fails open only after the deterministic gate and the
// fact-check have passed, and records that it did), never a pass.
function afBalanceVerdict(res, minScore) {
  var min = typeof minScore === "number" ? minScore : AF_BALANCE_MIN_SCORE;
  if (!res || typeof res.score !== "number" || !isFinite(res.score)) return { state: "unavailable", score: null, reason: String(res && res.reason || "no score") };
  return { state: res.score >= min ? "pass" : "fail", score: res.score, parts: res.parts || null, reason: String(res.reason || "") };
}
// The reviewers, in the order to ask them: models whose family is known and is not the writer's, families that have not yet judged the piece
// first (a fresh family reads it, ENSEMBLE-POLICY-1 rule 2), then those that have; one model per family. The start rotates with the seed.
// Empty when no model qualifies. opts: familyOf(id) -> family, allowed(id) -> bool, writerFamily, avoid (families), sick (map of model ids to skip), seed.
function afBalanceReviewers(pool, opts) {
  opts = opts || {};
  var fam = opts.familyOf || function (id) { return String(id).split("/")[1] || String(id); };
  var avoid = {}; (opts.avoid || []).forEach(function (f) { avoid[f] = 1; });
  var seen = {};
  var list = (pool || []).filter(function (id) {
    var f = fam(id);
    if (!f || String(f).indexOf("unknown") === 0 || f === opts.writerFamily || (opts.allowed && !opts.allowed(id)) || (opts.sick && opts.sick[id]) || seen[f]) return false;
    seen[f] = 1;
    return true;
  });
  if (!list.length) return [];
  var start = Math.abs(opts.seed | 0) % list.length, rotated = list.slice(start).concat(list.slice(0, start));
  return rotated.filter(function (id) { return !avoid[fam(id)]; }).concat(rotated.filter(function (id) { return avoid[fam(id)]; }));
}
function afPickBalanceReviewer(pool, opts) { return afBalanceReviewers(pool, opts)[0] || ""; }
// The instruction a draft gets when the even-keel reviewer found it one-sided. It may reorganise, attribute and reword; it may not add a fact.
function afBalanceRevisionNote(reason) {
  return "EVEN-KEEL REVISION. A reviewer from another editorial family found the draft below one-sided: " + String(reason || "it argues one position as the only reasonable view") + AF_NL +
    "Return the SAME piece in the SAME output format (a single # heading with the title, then the prose). State the strongest argument against your central claim at the strength its own holders would give it and weigh it honestly; attribute each disputed claim to the party the source material names as making it, or say it is disputed; replace loaded words with plain description. Use only what the source material states: add no name, date, figure, event or claim it does not contain, and keep the title, the headings and the length.";
}

// The instruction for a fresh draft after an attempt was rejected as one-sided and could not be revised in the time left.
function afBalanceRetryFeedback(reason) {
  return "The previous draft was found one-sided by a reviewer from another editorial family: " + String(reason || "it argues one position as the only reasonable view") + " Write a new draft that states the strongest argument against its central claim at the strength its own holders would give it, attributes each disputed claim to the party the source material names or says it is disputed, and uses plain descriptive words. Use only facts the source material states.";
}
// What is stored with the piece (quality_json): what the check said, never the draft. res is a balanceCheck result: { unavailable, ok, score, parts, reason, model, family, tried }.
function afBalanceRecord(res) {
  if (!res) return { state: "not-run" };
  if (res.unavailable) return { state: "unavailable", reason: String(res.reason || "").slice(0, 200), tried: res.tried || [] };
  return { state: res.ok ? "pass" : "fail", score: res.score, parts: res.parts || null, reason: String(res.reason || "").slice(0, 260), model: res.model || "", family: res.family || "" };
}

// ---- the sources footer and the host profile table (EK-2): where a source is from and what standpoint it speaks from
// country is an ISO 3166 alpha-2 code of the publisher; viewpoint is a short standpoint label ("" for an encyclopedia or a journal, which speak from none).
var AF_SOURCE_PROFILES = {
  "wikipedia.org": { label: "Wikipedia", country: "US", viewpoint: "" },
  "arxiv.org": { label: "arXiv", country: "US", viewpoint: "" },
  "hansard.parliament.uk": { label: "Hansard (UK Parliament)", country: "GB", viewpoint: "uk-parliament" },
  "globalvoices.org": { label: "Global Voices", country: "NL", viewpoint: "global-citizen-media" }
};
function afHost(ref) {
  var m = /^https:\/\/([^\/?#:]+)/i.exec(String(ref || ""));
  return m ? m[1].toLowerCase().replace(/^(?:www|m)\./, "") : "";
}
// The profile of the longest registered host suffix of the reference's host (en.wikipedia.org matches wikipedia.org); null when unregistered.
function afSourceProfile(ref) {
  var host = afHost(ref), best = "";
  Object.keys(AF_SOURCE_PROFILES).forEach(function (h) { if ((host === h || host.slice(-(h.length + 1)) === "." + h) && h.length > best.length) best = h; });
  return best ? AF_SOURCE_PROFILES[best] : null;
}
function afSourceLabel(ref) {
  var r = String(ref || ""), m = /wikipedia\.org\/wiki\/([^?#]+)/.exec(r);
  if (m) { try { return decodeURIComponent(m[1]).replace(/_/g, " ") + " (Wikipedia)"; } catch (e) { return r; } }
  var a = /arxiv\.org\/abs\/([^?#]+)/.exec(r);
  if (a) return "arXiv " + a[1];
  var prof = afSourceProfile(r);
  return prof ? prof.label : (afHost(r) || r);
}
// refs: https URLs (anything else is dropped); esc: the host's HTML escaper (default afEsc). The markup is the footer reading.q08.org has always had.
function afSourcesFooter(refs, esc) {
  var e = esc || afEsc, Q = String.fromCharCode(34);
  var list = (refs || []).filter(function (r) { return /^https:\/\//.test(String(r)); });
  if (!list.length) return "";
  var items = list.slice(0, 8).map(function (r) { return "<a href=" + Q + e(r) + Q + " rel=noopener>" + e(afSourceLabel(r)) + "</a>"; });
  return "<p class=src>Sources: " + items.join(" &middot; ") + "</p>";
}
function afSourcesFooterFromJson(anchorJson, esc) {
  var refs = [];
  try { refs = JSON.parse(String(anchorJson || "{}")).refs || []; } catch (e) { return ""; }
  return afSourcesFooter(refs, esc);
}

// ---- the AI label (BP26-AI-LABEL-1, BP26-AI-ACT-ART50-1): the visible label and the machine-readable credit ride the same sentence
var AF_AI_LABEL_TEXT = "Written by AI and checked against its source material by automated review. No human reviews pieces before they appear.";
function afAiLabelHtml() { return "<span class=ai title=" + String.fromCharCode(34) + AF_AI_LABEL_TEXT + String.fromCharCode(34) + ">AI-generated</span>"; }
// ANALYSIS-FORM-1:END
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
  "living-paper"
];
var P_STYLE = L(
  "You are writing for one reader: the person described in the reader profile below.",
  "Never reproduce any heading, label, bullet, or phrasing from the briefing, or from these instructions, inside the piece. The briefing is addressed to you, not to the reader.",
  "Not for an audience, not for a journal, not for a metric.",
  "The reader profile and recent-life notes tell you what he cares about and how he reads. They shape emphasis and register only; never state anything from them as a fact, and never list them back to him.",
  "He reads for the pleasure of a true thing well put. He is not impressed by fluency, by volume, or by enthusiasm.",
  "",
  "Voice: plain scholarly prose. Concrete before abstract. Short declaratives, occasionally a long sentence that earns its length.",
  AF_LEDE_RULE,
  AF_SYSTEMS_RULE,
  AF_QUOTE_RULE,
  "Present tense where possible. Active voice. Name the actor.",
  "Figures, dates, names and quotations: use one only exactly as the source material states it. Never compute, round, convert, estimate, combine or recall a number from memory; if a point needs a figure the sources do not give, make the point without one.",
  "",
  "Forbidden, without exception:",
  "- emojis, arrows (→) or other symbols written in place of words; exclamation marks for emphasis",
  "- the words: delve, tapestry, landscape of, realm, unlock, game-changer, ever-evolving, testament to, nestled",
  "- the phrases: dive into, let us explore, in today's world, it is worth noting, in conclusion, plays a crucial role, plays a vital role, shed light on, pave the way, stands as a, serves as a",
  "- rhetorical questions as an opener",
  "- triads of adjectives used as padding",
  "- meta-commentary about writing, essays, readers, publishing, or disclosure",
  "- any reference to QNFO, QWAV, DOIs, pipelines, or to this companion",
  "- self-reference as a model or assistant; no greeting, no sign-off, no signature, no footer",
  "",
  "Epistemic contract (every piece is fact-checked line by line against the source material before anyone sees it; one unsupported claim and it is discarded):",
  "- The SOURCE MATERIAL below is the only source of facts. Your own memory is not a source, even for things you are certain of.",
  "- Every name of a person, place, organisation, work or product, every date and year, every number and every quotation must appear in the source material. If it is not there, it is not in the piece.",
  "- Quote a number exactly as the source states it, with its own unit. Never compute, convert, round, average, scale or combine numbers, and never state a figure the source gives only as a range or in words; describe it without the digits instead.",
  "- Do not add examples, precedents, historical episodes or comparisons from outside the source material. A scenario you need must be an explicit hypothetical that names no real person, organisation, product, date or number.",
  "- Reasoning that follows from the source material is welcome. State it as reasoning (it follows that, if this holds then), never as a further reported fact.",
  "- State uncertainty about the claim at its true size. Never inflate confidence to make a piece land better. Where the evidence leaves a point open, say the point is open, in terms of the subject itself; never write about the source material (what it covers, omits or does not say).",
  AF_CONTESTED_RULE,
  AF_OBJECTION_RULE,
  AF_EVEN_KEEL_RULE,
  "",
  "The source material is raw research notes, usually encyclopedic extracts in a register you must not copy. Never reproduce their sentences. Banned habits they carry: definitional lead sentences, hedged attributions ('commentators have linked', 'observers note', 'a study found', 'some argue'), and disambiguation-style enumeration. If you need a definition, state it in your own words.",
  "Do not open with 'In [year], ...' unless the date itself is doing the work. Never repeat the opening move of one of your recent pieces (listed below). Pieces listed below are not sources.",
  "Reader verdicts (worth your time? yes/flat/no) are listed below. flat and no mean the piece did not earn its reading time; note what those pieces shared and do not repeat it. A recent no outweighs an old yes."
);
var P_ESSAY = AF_P_ESSAY;
var P_NOTES = L(
  "FORM: connected field essay, 1800 to 2400 words, in 3 to 5 movements.",
  "Each movement is one concrete thing taken from the source material.",
  "Each movement is 350 to 550 words. Say precisely what the thing is, then develop what it connects to in his world - draw the connection out, do not merely state it. One through-line binds the movements into a single sustained piece, not a list.",
  "If only three of the supplied sources are worth his time, give three. Never pad to a count. Never include an item you would not defend.",
  "Give every item a short title.",
  "The set title names the subject, not the count. Banned pattern: a title that starts with a number followed by a plural noun."
);
var P_SERIAL = L(
  "FORM: serialized long-form, 1800 to 2400 words, continuing one ongoing work.",
  "You are given the RUNNING WORK: its thesis and the closing lines of the previous installment. They are part of the source material.",
  "Advance the argument. Do not recap beyond one sentence of orientation.",
  "This installment must add at least one claim that was not available before it, and it must close mid-motion on a question the next installment has to answer.",
  "Keep the running work's title. Put the installment number in the subtitle."
);
var P_CRITIQUE = AF_P_CRITIQUE;
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
__name2(json, "json");
__name22(json, "json");
function html(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}
__name(html, "html");
__name2(html, "html");
__name22(html, "html");
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(safeEqual, "safeEqual");
__name2(safeEqual, "safeEqual");
__name22(safeEqual, "safeEqual");
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
__name2(authorized, "authorized");
__name22(authorized, "authorized");
async function sha16(s) {
  var data = new TextEncoder().encode(String(s));
  var digest = await crypto.subtle.digest("SHA-256", data);
  var bytes = new Uint8Array(digest).slice(0, 8);
  var out = "";
  for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}
__name(sha16, "sha16");
__name2(sha16, "sha16");
__name22(sha16, "sha16");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
__name2(nowIso, "nowIso");
__name22(nowIso, "nowIso");
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
__name2(amsParts, "amsParts");
__name22(amsParts, "amsParts");
function amsDayKey(d) {
  var p = amsParts(d);
  return p.year + "-" + p.month + "-" + p.day;
}
__name(amsDayKey, "amsDayKey");
__name2(amsDayKey, "amsDayKey");
__name22(amsDayKey, "amsDayKey");
function amsWeekday(d) {
  var names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var p = amsParts(d);
  var idx = names.indexOf(p.weekday);
  return idx < 0 ? d.getUTCDay() : idx;
}
__name(amsWeekday, "amsWeekday");
__name2(amsWeekday, "amsWeekday");
__name22(amsWeekday, "amsWeekday");
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
__name2(squish, "squish");
__name22(squish, "squish");
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
__name2(stripTags, "stripTags");
__name22(stripTags, "stripTags");
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
__name2(sections, "sections");
__name22(sections, "sections");
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
__name2(firstTag, "firstTag");
__name22(firstTag, "firstTag");
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
__name2(parseJsonLoose, "parseJsonLoose");
__name22(parseJsonLoose, "parseJsonLoose");
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
__name2(hasEmoji, "hasEmoji");
__name22(hasEmoji, "hasEmoji");
function bannedHits(text) {
  var low = text.toLowerCase();
  var hits = [];
  for (var i = 0; i < BANNED.length; i++) {
    if (low.indexOf(BANNED[i]) >= 0) hits.push(BANNED[i]);
  }
  return hits;
}
__name(bannedHits, "bannedHits");
__name2(bannedHits, "bannedHits");
__name22(bannedHits, "bannedHits");
function isCap(s, i) {
  var c = s.charAt(i);
  return c >= "A" && c <= "Z";
}
__name(isCap, "isCap");
__name2(isCap, "isCap");
__name22(isCap, "isCap");
function isLow(s, i) {
  var c = s.charAt(i);
  return c >= "a" && c <= "z";
}
__name(isLow, "isLow");
__name2(isLow, "isLow");
__name22(isLow, "isLow");
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
__name2(readWord, "readWord");
__name22(readWord, "readWord");
// COMPANION-LEDE-1: the kind of source in plain words, so the lede can name where the subject comes from and the fact-check
// material carries the same words ("the Wikipedia article on ...", "the arXiv paper ...").
function sourceLabel(a) {
  var ref = String(a && a.ref || ""), kind = String(a && a.kind || "");
  if (/wikipedia\.org/i.test(ref)) return "Wikipedia article";
  if (kind === "paper" || /arxiv/i.test(ref)) return "arXiv paper";
  return kind || "source";
}
function anchorsText(anchors) {
  var parts = [];
  for (var i = 0; i < anchors.length; i++) parts.push(sourceLabel(anchors[i]) + ": " + String(anchors[i].title || "") + " " + String(anchors[i].text || ""));
  return parts.join(" ");
}
// WORKERS-BP-LOGGING-personal-companion-1 (1.24.0, agent_issues 2528, child of WORKERS-BP-LOGGING-1): a caught error is written to Workers
// Logs as one JSON line instead of being swallowed; every handler keeps its control flow (no rethrow, same return).
function logCaught(where, e) { console.error(JSON.stringify({ worker: "personal-companion", where: where, error: String(e && e.message || e).slice(0, 300) })); }
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
__name2(wordCount, "wordCount");
__name22(wordCount, "wordCount");
async function embed(env, texts) {
  var resp = await aiRunAttr(env, "personal-companion", "embed", EMBED_MODEL, { text: texts }, { signal: AbortSignal.timeout(EMBED_TIMEOUT_MS) });
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
__name2(embed, "embed");
__name22(embed, "embed");
async function ensureSchema(env) {
  var stmts = [
    "CREATE TABLE IF NOT EXISTS companion_pieces (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, form TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, lede TEXT, body_md TEXT NOT NULL, anchor_json TEXT, quality_json TEXT, word_count INTEGER, day TEXT, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS companion_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT NOT NULL, form TEXT, model TEXT, topic TEXT, status TEXT, detail TEXT, ms INTEGER)",
    "CREATE TABLE IF NOT EXISTS companion_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, signal TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS companion_series (id INTEGER PRIMARY KEY AUTOINCREMENT, series TEXT UNIQUE NOT NULL, title TEXT, thesis TEXT, chapters INTEGER DEFAULT 0, last_lines TEXT, updated_at TEXT)",
    "CREATE TABLE IF NOT EXISTS companion_seeds (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, source TEXT, form TEXT, used_at TEXT)",
    "CREATE TABLE IF NOT EXISTS companion_subscribers (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'pending', token TEXT NOT NULL, created_at TEXT NOT NULL, confirmed_at TEXT)"
  ];
  for (var i = 0; i < stmts.length; i++) {
    await env.PERSONAL.prepare(stmts[i]).run();
  }
  await ensureAccuracySchema(env);
}
__name(ensureSchema, "ensureSchema");
__name2(ensureSchema, "ensureSchema");
__name22(ensureSchema, "ensureSchema");
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
__name2(loadProfile, "loadProfile");
__name22(loadProfile, "loadProfile");
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
__name2(loadLife, "loadLife");
__name22(loadLife, "loadLife");
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
    "SELECT f.slug, f.signal, f.note, p.title FROM companion_feedback f LEFT JOIN companion_pieces p ON p.slug = f.slug WHERE f.created_at > datetime('now','-14 days') ORDER BY f.id DESC LIMIT 60"
  ).all();
  var fr = fb.results || [];
  if (fr.length) {
    var yes = 0, flat = 0, no = 0, neg = [], pos = [];
    for (var j = 0; j < fr.length; j++) {
      var sgn = String(fr[j].signal || "");
      if (sgn === "good") yes++;
      else if (sgn === "flat") flat++;
      else no++;
      var t = squish(fr[j].title || fr[j].slug);
      if (sgn === "good") pos.push(t);
      else neg.push(t + "(" + sgn + ")");
    }
    lines.push("");
    lines.push("HOW HE REACTED \u2014 reader verdicts, worth your time? (last 14 days: yes=" + yes + " flat=" + flat + " no=" + no + ")");
    if (neg.length) lines.push("flat/no pieces \u2014 these did not earn their reading time; do not repeat what they shared: " + neg.slice(0, 6).join(" | "));
    if (pos.length) lines.push("yes pieces \u2014 earned it: " + pos.slice(0, 6).join(" | "));
    var rn = [];
    for (var j2 = 0; j2 < Math.min(fr.length, 8); j2++) rn.push("[" + fr[j2].signal + "] " + squish(fr[j2].title || fr[j2].slug));
    lines.push("most recent votes: " + rn.join(" | "));
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
__name2(loadContinuity, "loadContinuity");
__name22(loadContinuity, "loadContinuity");
// COMPANION-VERIFY-1 (1.14.0, owner directive 2026-10-10: generative instructions specify process and style only, no hard-coded
// topics) and COMPANION-SOURCES-1 (1.14.2, 2026-10-11). The subject is drawn live from two independent providers, each of which
// can carry a piece alone: Wikipedia (a random article with enough text to argue from, plus two articles it links to) and arXiv
// (recent submissions; the abstracts are the source text). With both up the piece draws on both; with one down it draws on the
// other (arXiv alone needs at least two papers, Wikipedia alone at least two articles). Nothing here names a field, a category
// or a subject. Every fetch carries a descriptive User-Agent, is retried with backoff, and records its HTTP status or error in
// srcDiag, which the run log shows when a run is blocked (1.14.1 blocked every run with "insufficient anchors" and no reason).
// Material that was fetched but never became a published piece is cached (companion_anchor_cache) and reused on an outage.
// Whatever is fetched is only ever the source material the piece is checked against; the accuracy gate is unchanged.
var WIKI_API = "https://en.wikipedia.org/w/api.php";
var fetchCfg = { backoff: [400, 1500], timeoutMs: 12e3 };
var srcDiag = [];
function fetchUA() { return "qnfo-personal-companion/" + String(VERSION).split("-")[0] + " (https://reading.q08.org; mailto:rowan@qnfo.org)"; }
function diagNote(s) { if (srcDiag.length < 14) srcDiag.push(String(s).slice(0, 140)); }
function sleepMs(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
// One GET with retries on network errors, 429 and 5xx. Returns the Response, or null after recording why in srcDiag.
async function srcFetch(label, url) {
  var tries = fetchCfg.backoff.length + 1, last = "";
  for (var t = 0; t < tries; t++) {
    try {
      var resp = await fetch(url, { headers: { "User-Agent": fetchUA(), "Accept": "application/json, application/atom+xml, text/xml, */*", "Api-User-Agent": fetchUA() }, signal: AbortSignal.timeout(fetchCfg.timeoutMs) });
      if (resp.ok) return resp;
      last = "HTTP " + resp.status;
      if (resp.status !== 429 && resp.status < 500) break;
      var ra = Number(resp.headers && resp.headers.get && resp.headers.get("retry-after"));
      if (t < tries - 1 && ra > 0 && ra <= 5) await sleepMs(ra * 1e3);
    } catch (e) {
      last = "error " + String(e && e.message || e).slice(0, 60);
    }
    if (t < tries - 1) await sleepMs(fetchCfg.backoff[t]);
  }
  diagNote(label + ": " + last);
  return null;
}
async function srcJson(label, url) {
  var resp = await srcFetch(label, url);
  if (!resp) return null;
  try { return await resp.json(); } catch (e) { diagNote(label + ": not JSON"); return null; }
}
async function fetchRandomTitles(n) {
  var j = await srcJson("wikipedia random", WIKI_API + "?action=query&list=random&rnnamespace=0&rnlimit=" + n + "&format=json");
  return ((j && j.query && j.query.random) || []).map(function (r) { return squish(r.title || ""); }).filter(Boolean);
}
async function fetchLinkedTitles(title) {
  var j = await srcJson("wikipedia links", WIKI_API + "?action=query&prop=links&plnamespace=0&pllimit=" + LINK_POOL + "&redirects=1&format=json&titles=" + encodeURIComponent(title));
  var pages = j && j.query && j.query.pages || {};
  var pk = Object.keys(pages)[0];
  var links = (pages[pk] && pages[pk].links) || [];
  return links.map(function (l) { return squish(l.title || ""); }).filter(function (t) { return t && !/^\d{1,4}$/.test(t) && !/^(List|Lists|Index|Outline|Timeline) of /i.test(t); });
}
async function fetchWiki(title) {
  // ANCHOR-FULL-ARTICLE-1 (1.19.3): MediaWiki treats a boolean parameter that is present as true whatever its value, so the former
  // "exintro=0" asked for the intro only: stored concept anchors measured 1.3k-3.6k characters (companion_anchor_cache 1-10, Admiral
  // Ackbar 2.5k-3.2k under a 6k budget) and most random articles never reached ANCHOR_MIN_CHARS, so runs fell back to cached or
  // paper material and to ever thinner sources. The parameter is now left out, so the whole article text is read (cut to 12k below).
  var j = await srcJson("wikipedia extract", WIKI_API + "?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=" + encodeURIComponent(title));
  var pages = j && j.query && j.query.pages || {};
  var pk = Object.keys(pages)[0];
  var p = pages[pk] || {};
  var text = squish(p.extract || "");
  if (!text) return null;
  return { kind: "concept", ref: "https://en.wikipedia.org/wiki/" + encodeURIComponent(p.title || title), title: squish(p.title || title), text: text.slice(0, 12e3) };
}
__name(fetchWiki, "fetchWiki");
async function fetchArxivQuery(label, query, sortBy) {
  var resp = await srcFetch(label, "https://export.arxiv.org/api/query?search_query=" + query + "&sortBy=" + (sortBy || "submittedDate") + "&sortOrder=descending&max_results=8");
  if (!resp) return [];
  var chunks = [];
  try { chunks = sections(await resp.text(), "entry"); } catch (e) { diagNote(label + ": unreadable"); return []; }
  var out = [];
  for (var i = 0; i < chunks.length; i++) {
    var title = firstTag(chunks[i], "title");
    var summary = firstTag(chunks[i], "summary");
    var id = firstTag(chunks[i], "id");
    // a candidate only: its text is the paper's full text, read by withFullText (COMPANION-PAPER-FULLTEXT-1); the abstract is never ground
    if (title && summary && squish(summary).length > 300) out.push({ kind: "paper", ref: id, title: squish(title) });
  }
  if (!out.length) diagNote(label + ": no usable entries");
  return out;
}
// COMPANION-PAPER-FULLTEXT-1 (1.17.0, agent_issues 2469; owner directive 2026-10-13: "Papers shall cite full texts, not merely reference
// work summaries"). A paper anchor was its arXiv abstract cut to 1200 characters, so a piece about a paper rested on a summary. Each
// candidate paper is now read from its full text: the arXiv HTML rendering (https://arxiv.org/html/<id>), else ar5iv
// (https://ar5iv.labs.arxiv.org/html/<id>), the pattern of q08-signal-engine articleUrlFor/fetchArticleText. A paper with no readable full
// text is dropped, never kept as an abstract. At most PAPER_FULLTEXT_TRIES candidates are fetched per run (subrequest budget).
var PAPER_MIN_CHARS = 3000;
var PAPER_FULLTEXT_TRIES = 5;
var PAPER_TEXT_MAX = 12e3;
function arxivIdOf(ref) {
  var m = String(ref || "").match(/arxiv\.org\/(?:abs|pdf|html)\/([^\s?#]+?)(?:\.pdf)?\/?(?:[?#].*)?$/i);
  return m ? m[1] : "";
}
function paperFullTextUrls(ref) {
  var id = arxivIdOf(ref);
  return id ? ["https://arxiv.org/html/" + id, "https://ar5iv.labs.arxiv.org/html/" + id] : [];
}
function decodeEntities(s) {
  return String(s || "").replace(/&#(\d+);/g, function (m, n) { var c = Number(n); return c > 0 && c < 1114112 ? String.fromCodePoint(c) : " "; })
    .replace(/&#x([0-9a-f]+);/gi, function (m, n) { var c = parseInt(n, 16); return c > 0 && c < 1114112 ? String.fromCodePoint(c) : " "; })
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
}
// The readable body of an arXiv/ar5iv HTML page: scripts, styles, navigation, MathML annotations and the reference list removed.
function paperHtmlText(html) {
  var h = String(html || "").slice(0, 600000);
  var a = h.search(/<article\b/i);
  if (a >= 0) h = h.slice(a);
  h = h.replace(/<(script|style|nav|header|footer|noscript|annotation|annotation-xml|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<section[^>]*class="[^"]*ltx_bibliography[\s\S]*$/i, " ")
    .replace(/<\/(p|div|h[1-6]|li|section|tr|figcaption)>/gi, " ");
  return squish(decodeEntities(stripTags(h)));
}
async function fetchPaperFullText(ref) {
  var urls = paperFullTextUrls(ref);
  for (var i = 0; i < urls.length; i++) {
    try {
      var r = await fetch(urls[i], { headers: { "User-Agent": fetchUA(), "Accept": "text/html" }, signal: AbortSignal.timeout(15e3), redirect: "follow" });
      if (!r.ok) { diagNote("paper full text " + urls[i].split("/")[2] + ": HTTP " + r.status); continue; }
      var t = paperHtmlText(await r.text());
      if (t.length >= PAPER_MIN_CHARS && !/^\s*(?:No HTML for|Conversion to HTML had a Fatal error)/i.test(t)) return { text: t.slice(0, PAPER_TEXT_MAX), url: urls[i] };
      diagNote("paper full text " + urls[i].split("/")[2] + ": " + t.length + " chars");
    } catch (e) { diagNote("paper full text: " + String(e && e.message || e).slice(0, 60)); }
  }
  return null;
}
// Replaces each candidate's abstract with its full text; candidates without one are dropped. Returns at most `want` papers.
async function withFullText(papers, want) {
  var out = [];
  for (var i = 0; i < papers.length && i < PAPER_FULLTEXT_TRIES && out.length < want; i++) {
    var ft = await fetchPaperFullText(papers[i].ref);
    if (ft) out.push({ kind: "paper", ref: papers[i].ref, title: papers[i].title, text: ft.text, full: true });
  }
  return out;
}
var ANCHOR_MIN_CHARS = 2500;
var LINK_MIN_CHARS = 1200;
// ARXIV-WINDOW-WEEK-1 (1.19.3): arXiv lists a submission only at its next announcement, so a 3-day submittedDate window holds no
// listed paper over a weekend: on Monday 2026-10-13 08:00 UTC the window [10-10 08:02, 10-13 08:02] returned 0 entries while 5 days
// returned 2440 and 7 days 5853, and the 08:00 and 08:01 runs were blocked with "arxiv recent: no usable entries".
var ARXIV_WINDOW_DAYS = 7;
function arxivWindow(nowMs) {
  function stamp(ms) { return new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 12); }
  return "submittedDate:[" + stamp(nowMs - ARXIV_WINDOW_DAYS * 864e5) + "+TO+" + stamp(nowMs) + "]";
}
function pickSeeded(list, seed, k) {
  var arr = list.slice(), out = [], h = seed >>> 0;
  while (arr.length && out.length < k) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    out.push(arr.splice(h % arr.length, 1)[0]);
  }
  return out;
}
// Fits the anchors to the budget the writer, the grounding check and the reviewers all share.
// FULLTEXT-BUDGET-1 (1.26.2, agent_issues 2552; owner directive 2026-10-13 CITE-FULLTEXT-1: ground on full texts, never a truncation):
// the budget was 18000 characters, so the primary article kept about 9900 for a 2000-2800 word essay (14000-18000 characters), less text
// than the writer was asked to produce. The writer filled the rest from memory and the critic, reading the excerpt, scored it invented
// (companion_runs 6141 of 2026-10-14 08:05 UTC: "claims from the source material's prelude sections ... which were not in the provided
// source"; 6002, 5962 alike). The budget is 36000 and the primary keeps PRIMARY_SHARE 0.7 of it (25200 characters, about 4000 words),
// so the subject's own article is longer than the essay; the critic and the fact-check read the same budget, so no judge or bar changes.
var GROUND_MAX = 36000;
// SOURCE-SENTENCE-CUT-1 (1.24.0, companion_runs 5836 and 5852 of 2026-10-14 01:03 UTC: the critic rejected drafts for quoting "a sentence
// fragment from the source material that is cut off mid-sentence"): a source over its share of the budget is cut at the last sentence end
// inside the share (when that keeps at least SENTENCE_CUT_KEEP of it), so the writer, the grounding check and the reviewers never read a
// half sentence as a fact.
var SENTENCE_CUT_KEEP = 0.6;
function cutAtSentence(text, max) {
  var t = String(text || "");
  if (t.length <= max) return t;
  var head = t.slice(0, max), best = -1, re = /[.!?]["')\]\u201d\u2019]*(?=\s)/g, m;
  while ((m = re.exec(head))) best = m.index + m[0].length;
  return best >= max * SENTENCE_CUT_KEEP ? head.slice(0, best) : head;
}
// PRIMARY-SHARE-1 (1.25.5, agent_issues 2552; companion_runs 5979-6017 of 2026-10-14 05:00 UTC): five anchors split the budget evenly, so
// the essay's own subject (the Vietnam War article) was cut to 3600 characters for a 2000-2800 word essay, and every critic rejection named
// subject facts the excerpt did not hold ("US support timing, Kennedy's specific actions"). The primary anchor (index 0, the subject the
// lede names) now keeps PRIMARY_SHARE of the budget when there are others, and the rest share what is left; the total is unchanged, so
// the writer, the grounding check, the critic and the reviewers still read the same material, and no judge or bar changes.
var PRIMARY_SHARE = 0.7; // FULLTEXT-BUDGET-1 (1.26.2): was 0.55 of 18000
// EK-2: a contested topic is not drafted unless source records prove three distinct publishers, differing viewpoints,
// and a non-US source. Missing perspective or country metadata is not evidence and fails closed.
var CONTESTED_TOPIC_RE = /\b(?:policy|policies|politics|political|election|elections|parliament|congress|government|governance|war|wars|conflict|invasion|occupation|insurgen\w*|geopolitic\w*|foreign relations|international relations|history|historical|history of|empire|colonial\w*|treaty|treaties|sanction\w*|health|medicine|medical|disease|diseases|epidemic|pandemic|vaccin\w*|econom\w*|inflation|recession|trade|tariff\w*|taxation|market|markets|budget|debt|poverty)\b/i;
function isContestedTopic(text) { return CONTESTED_TOPIC_RE.test(String(text || "").slice(0, 4000)); }
function sourceHost(ref) {
  try {
    var u = new URL(String(ref || ""));
    return u.protocol === "https:" ? u.hostname.toLowerCase().replace(/^(?:www|m)\./, "") : "";
  } catch (e) { return ""; }
}
function sourceViewpoint(anchor) {
  var value = String(anchor && anchor.viewpoint || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  return value && !/^(?:unknown|unspecified|neutral|encyclopedic|academic|general|none|other)$/.test(value) ? value : "";
}
function sourceCountry(anchor) {
  var code = String(anchor && anchor.sourceCountry || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "US") return "";
  try {
    var name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return name && name !== code && name !== "Unknown Region" ? code : "";
  } catch (e) { return ""; }
}
function contestedSourcesOk(anchors) {
  var seenRefs = {}, seenHosts = {}, list = [];
  for (var i = 0; i < (anchors || []).length; i++) {
    var a = anchors[i];
    var host = sourceHost(a && a.ref);
    if (!a || !host || seenRefs[a.ref] || seenHosts[host]) continue;
    if (String(a.text || "").length < ANCHOR_MIN_CHARS) continue;
    seenRefs[a.ref] = 1;
    seenHosts[host] = 1;
    list.push(a);
  }
  if (list.length < 3) return { ok: false, why: "only " + list.length + " full-text sources" };
  var viewpoints = {}, nonUS = false;
  for (var k = 0; k < list.length; k++) {
    var viewpoint = sourceViewpoint(list[k]), country = sourceCountry(list[k]);
    if (viewpoint) viewpoints[viewpoint] = 1;
    if (country) nonUS = true;
  }
  if (Object.keys(viewpoints).length < 2) return { ok: false, why: "fewer than 2 explicit viewpoints" };
  if (!nonUS) return { ok: false, why: "no verified non-US source" };
  return { ok: true, why: "" };
}
function fitAnchors(anchors) {
  // CITE-FULLTEXT-1: an abstract or excerpt does not satisfy the contested-topic source gate.
  if (anchors && anchors.length && isContestedTopic(String(anchors[0] && anchors[0].title || "") + " " + String(anchors[0] && anchors[0].text || ""))) {
    var gate = contestedSourcesOk(anchors);
    if (!gate.ok) { diagNote("contested-topic gate: " + gate.why + " \u2014 topic dropped"); return []; }
  }
  var n = anchors.length || 1, per = Math.max(900, Math.floor(GROUND_MAX / n));
  var prim = n > 1 ? Math.max(per, Math.floor(GROUND_MAX * PRIMARY_SHARE)) : per;
  var rest = n > 1 ? Math.max(900, Math.floor((GROUND_MAX - prim) / (n - 1))) : per;
  return anchors.map(function (a, i) {
    var o = { kind: a.kind, ref: a.ref, title: a.title, text: cutAtSentence(a.text, i === 0 ? prim : rest) };
    if (a.full) o.full = true;
    if (a.viewpoint) o.viewpoint = a.viewpoint;
    if (a.sourceCountry) o.sourceCountry = a.sourceCountry;
    return o;
  });
}
// SYSTEMS-TOPIC-1 (1.21.0; companion_runs 5412-5444 of 2026-10-13 12:00 UTC, topic wiki:1065 Amundsenia, an asteroid): the subject was
// the first random article long enough to use, so a catalogue entry with no actors became the topic, and the required systems analysis
// (COMPANION-SYSTEMS-ANALYSIS-1) made the writer invent institutional incentives; the critic rejected every attempt (grounding 0 and 3,
// systems 2). A candidate is now the primary only when its text names people or institutions making choices: it is not a catalogue
// entry (minor planet, species or genus, settlement or station, album, song or episode), and it uses at least SYSTEMS_FIT_MIN distinct
// decision terms in its first SYSTEMS_FIT_CHARS characters. When no candidate fits, the first long-enough article is used as before, so a
// run never loses its sources to the filter.
var SYSTEMS_FIT_MIN = 4;
var SYSTEMS_FIT_CHARS = 6000;
var CATALOGUE_RE = /\b(?:minor planet|main-belt asteroid|asteroid|is a species of|is a genus of|species of (?:plant|moth|beetle|fly|snail|fish|bird|spider|fungus)|is a (?:village|hamlet|town|commune|municipality|census-designated place|unincorporated community|railway station|metro station|bus station) |is an? (?:studio |live |compilation )?album|is a song|is an? (?:episode|single) |is a (?:river|mountain|lake|crater) in)\b/i;
var DECISION_TERMS = ["decided", "decision", "policy", "policies", "government", "council", "committee", "ministry", "parliament", "congress", "court", "ruled", "law", "regulation", "regulated", "banned", "funded", "funding", "budget", "invested", "investment", "market", "price", "company", "firm", "corporation", "founded", "established", "elected", "election", "campaign", "negotiated", "treaty", "agreement", "trade", "strike", "union", "reform", "proposed", "opposed", "adopted", "approved", "rejected", "competition", "competitors", "acquired", "merger", "contract", "license", "licence", "rights", "lawsuit", "standard", "protocol", "incentive", "subsidy", "tax", "tariff", "war", "army", "governor", "mayor", "president", "minister", "board", "shareholders", "employees", "workers"];
// CAUSAL-SOURCE-1 (1.24.0, companion_runs 5829-5911 of 2026-10-14 01:00-02:11 UTC: every rejection named analysis the source "never
// states": a tuition freeze's purpose, a scientist's health driving her career, a palace grant's revocability). A random article rarely
// says why anything happened, so the required systems analysis had nothing to stand on. Among the candidates that pass systemsFit, the
// primary is now the first whose visible text (the share fitAnchors keeps) states at least CAUSAL_MIN causes, purposes or effects in
// its own words; when none does, the fitted candidate stating the most is used, so a run never loses its sources to the screen.
var CAUSAL_MIN = 6, CAUSAL_CHARS = 6000;
var CAUSAL_RE = /\b(?:because|due to|owing to|as a result|resulted in|results in|led to|leading to|lead to|caused|causing|in order to|so that|in response to|in an effort to|aimed (?:to|at)|intended to|designed to|meant to|to (?:prevent|reduce|increase|protect|avoid|allow|enable|encourage|discourage|compete)|therefore|consequently|thus|prompted|forced|motivated|the reason|reasons for|effect of|effects of|impact of|criticis(?:m|ed)|opposed|opposition|controvers(?:y|ial)|argued|critics|supporters)\b/gi;
function causalScore(text) { return (String(text || "").slice(0, CAUSAL_CHARS).match(CAUSAL_RE) || []).length; }
function systemsFit(art) {
  var text = String(art && art.text || ""), head = text.slice(0, SYSTEMS_FIT_CHARS).toLowerCase();
  var lead = text.slice(0, 600);
  if (CATALOGUE_RE.test(lead)) return { ok: false, score: 0, why: "catalogue entry" };
  var seen = 0;
  for (var i = 0; i < DECISION_TERMS.length; i++) if (new RegExp("\\b" + DECISION_TERMS[i] + "\\b").test(head)) seen++;
  return { ok: seen >= SYSTEMS_FIT_MIN, score: seen, why: seen >= SYSTEMS_FIT_MIN ? "fit" : "few decision terms (" + seen + ")" };
}
// CONTEXT-LINKS-1 (1.21.5; companion_runs 5519-5544 of 2026-10-13 15:00 UTC, topic "The Black Book of Soviet Jewry"): the two articles
// that sit beside the primary were drawn at random from its first 60 links in alphabetical order, so the writer, told to give context and
// systems analysis, had only the one article and invented the rest (a committee's motives, a censor's expectations, who received copies;
// 25 sentences pruned by the fact-check in one attempt). The linked articles are now ranked by how often the primary's text names them
// (each full-name mention counts twice and a bare surname once, so "Grossman" counts for "Vasily Grossman"; matching keeps case),
// and the most-named ones are read first: the people, bodies and events the subject is about, which is the context a reader needs and
// the fact-check can check. Seeded random links fill in when fewer than two are named.
var LINK_POOL = 500;
var LINK_MENTION_MIN = 2;
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function mentionCount(text, needle) {
  if (!needle || needle.length < 4) return 0;
  // a one-word name counts only where it stands alone, not inside a longer name ("Church" in "Eastern Orthodox Church", "Tennessee" in
  // "Tennessee Valley Authority")
  var solo = !/\s/.test(needle);
  var re = solo ? "(?<![A-Z][\\w'-]*\\s)(?<=^|[^A-Za-z0-9])" + escRe(needle) + "(?![A-Za-z0-9])(?!\\s+[A-Z])" : "(?<=^|[^A-Za-z0-9])" + escRe(needle) + "(?![A-Za-z0-9])";
  var m = String(text || "").match(new RegExp(re, "g"));
  return m ? m.length : 0;
}
// the name as running text writes it: no disambiguation ("Sedan (automobile)"), no state after a comma ("Knoxville, Tennessee"), no
// leading article ("The Holocaust" is "the Holocaust" mid-sentence). Matching keeps case, so a proper name counts and a common noun
// that happens to be a title ("Engine", "Calendar") counts only where it opens a sentence.
function linkBase(title) { return String(title || "").replace(/\s*\([^)]*\)\s*$/, "").split(",")[0].replace(/^The\s+/, "").trim(); }
function linkMentionScore(title, text, selfTitle) {
  var base = linkBase(title), s = 2 * mentionCount(text, base);
  var selfWords = linkBase(selfTitle).toLowerCase().split(/\s+/);
  var words = base.split(/\s+/).filter(Boolean), last = words[words.length - 1] || "";
  // a surname counts for the full name ("Grossman" for "Vasily Grossman"): only for names, whose every word is capitalised
  if (words.length >= 2 && last.length >= 5 && selfWords.indexOf(last.toLowerCase()) < 0 && words.every(function (w) { return /^[A-Z\u00C0-\u024F]/.test(w); })) s += mentionCount(text, last);
  return s;
}
function rankLinked(titles, text, selfTitle) {
  var self = linkBase(selfTitle).toLowerCase();
  return (titles || []).map(function (t, i) { return { t: t, s: linkBase(t).toLowerCase() === self ? 0 : linkMentionScore(t, text, selfTitle), i: i }; })
    .filter(function (x) { return x.s >= LINK_MENTION_MIN; })
    // one article per name: the plain title before its disambiguated variants ("Alabama" before "Alabama (band)")
    .sort(function (a, b) { return b.s - a.s || (/\(/.test(a.t) ? 1 : 0) - (/\(/.test(b.t) ? 1 : 0) || a.i - b.i; })
    .filter(function (x, k, arr) { var bx = linkBase(x.t).toLowerCase(); return !arr.slice(0, k).some(function (y) { return linkBase(y.t).toLowerCase() === bx; }); })
    .map(function (x) { return x.t; });
}
// TOPIC-PRESCREEN-1 (1.21.6, companion_runs 5553-5572 of 2026-10-13 16:01 UTC): the primary was chosen by reading random articles in
// full, one at a time, so a run saw four candidates (a footballer, a flycatcher, a film), none fit, and the fallback biography made the
// writer invent club budgets, market values and contract terms for the required systems analysis. The intros of TOPIC_POOL random
// articles now come in one request; candidates are read in full best-first (most decision terms in the intro, catalogue entries last),
// so the full-text reads go to the articles most likely to fit. When the intro request fails the order is the random order, as before.
var TOPIC_POOL = 20;
async function fetchWikiIntros(titles) {
  var list = (titles || []).slice(0, 20), res = {};
  if (!list.length) return res;
  var j = await srcJson("wikipedia intros", WIKI_API + "?action=query&prop=extracts&exintro=1&explaintext=1&exlimit=" + list.length + "&redirects=1&format=json&titles=" + encodeURIComponent(list.join("|")));
  var q = j && j.query || {}, pages = q.pages || {}, byTitle = {}, alias = {};
  Object.keys(pages).forEach(function (k) { var pg = pages[k]; if (pg && pg.title && pg.extract) byTitle[pg.title] = squish(pg.extract); });
  (q.normalized || []).concat(q.redirects || []).forEach(function (r) { if (r && r.from && r.to) alias[r.from] = r.to; });
  list.forEach(function (t) { var x = t; for (var h = 0; h < 3 && alias[x]; h++) x = alias[x]; if (byTitle[x]) res[t] = byTitle[x]; });
  return res;
}
function introScore(intro) {
  var text = String(intro || "");
  if (!text) return 0;
  if (CATALOGUE_RE.test(text.slice(0, 600))) return -1;
  var low = text.toLowerCase(), seen = 0;
  for (var i = 0; i < DECISION_TERMS.length; i++) if (new RegExp("\\b" + DECISION_TERMS[i] + "\\b").test(low)) seen++;
  return seen;
}
function screenTopics(titles, intros) {
  var have = intros && Object.keys(intros).length;
  var scored = (titles || []).map(function (t, i) { return { t: t, i: i, s: have && intros[t] !== undefined ? introScore(intros[t]) : 0 }; });
  if (have) scored.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
  return scored;
}
// EVENT-POOL-1 (1.25.0, companion_runs 5918 of 2026-10-14 03:01 UTC: the causal screen read three fitted candidates, a hotel, a
// politician and an actor, which stated 1, 0 and 0 causes, so the primary again stated none). Random articles rarely say why anything
// happened. Wikipedia's "On this day" feed lists historical events (laws, wars, strikes, disasters, founding acts), whose articles state
// causes and effects by nature. Half the topic pool now comes from the events of one seeded calendar day. Each event gives its first page
// that is itself an event (its title or description names one, or its description opens with a year: "2004 Haitian coup d'etat",
// "1996 aviation accident"), never a year, a date, a list, a country or a person; an event with no such page gives none. The other half
// of the pool stays random, and the intro and causal screens judge both.
var EVENT_POOL = 10;
var WIKI_REST = "https://en.wikipedia.org/api/rest_v1";
var MONTH_DAY_RE = /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}$/i;
var EVENT_WORD_RE = /\b(war|wars|attack|bombing|shooting|massacre|siege|battle|invasion|uprising|rebellion|revolution|riot|protest|strike|boycott|embargo|sanctions?|coup|crisis|scandal|hoax|fraud|trial|deal|agreement|accord|treaty|pact|referendum|election|act|law|bill|decree|reform|ban|abolition|amendment|constitution|independence|secession|accident|crash|disaster|collapse|explosion|earthquake|flood|fire|famine|pandemic|epidemic|outbreak|recession|default|bankruptcy|merger|operation|campaign|expedition|mission|incident|affair|conference|summit|convention|ceremony|founding|dissolution|partition|occupation|evacuation|assassination)\b/i;
function eventDay(seed) { var d = new Date(Date.UTC(2024, 0, 1) + ((seed >>> 0) % 366) * 864e5); return [String(d.getUTCMonth() + 1).padStart(2, "0"), String(d.getUTCDate()).padStart(2, "0")]; }
function eventPage(p) {
  var t = squish(String(p && (p.normalizedtitle || p.title) || "").replace(/_/g, " ")), desc = squish(String(p && p.description || ""));
  if (!t || /^\d{1,4}( BC| AD| BCE| CE)?$/i.test(t) || MONTH_DAY_RE.test(t) || /^(List|Lists|Index|Outline|Timeline) of /i.test(t)) return "";
  return EVENT_WORD_RE.test(t) || EVENT_WORD_RE.test(desc) || /^\d{3,4}\b/.test(desc) ? t : "";
}
function eventTitles(feed) {
  var out = [];
  ((feed && feed.events) || []).forEach(function (ev) {
    var pages = (ev && ev.pages) || [];
    for (var i = 0; i < pages.length; i++) {
      var t = eventPage(pages[i]);
      if (!t) continue;
      if (out.indexOf(t) < 0) out.push(t);
      break;
    }
  });
  return out;
}
async function fetchEventTitles(seed, n) {
  var md = eventDay(seed);
  var j = await srcJson("wikipedia onthisday", WIKI_REST + "/feed/onthisday/events/" + md[0] + "/" + md[1]);
  return pickSeeded(eventTitles(j), seed, n);
}
async function wikiAnchors(used, cooled, seed) {
  var events = [];
  try { events = await fetchEventTitles(seed, EVENT_POOL); } catch (eE) { diagNote("wikipedia onthisday: " + String(eE && eE.message || eE).slice(0, 60)); } // EVENT-POOL-1
  var random = await fetchRandomTitles(TOPIC_POOL - events.length);
  var pool = events.concat(random.filter(function (x) { return events.indexOf(x) < 0; }));
  if (events.length) diagNote("event pool: " + events.length + " from " + eventDay(seed).join("/"));
  var fresh = pool.filter(function (x) { return used.indexOf("wiki:" + x) < 0 && !cooled["wiki:" + x]; });
  var intros = {};
  try { intros = await fetchWikiIntros(fresh); } catch (eI) { diagNote("wikipedia intros: " + String(eI && eI.message || eI).slice(0, 60)); }
  var scored = screenTopics(fresh, intros);
  if (Object.keys(intros).length) diagNote("intro screen: " + scored.slice(0, 3).map(function (x) { return x.t.slice(0, 40) + " " + x.s; }).join(", "));
  var titles = scored.map(function (x) { return x.t; });
  var primary = null, fallback = null, skipped = [], fitted = null, fittedCausal = -1, causalSeen = [];
  for (var t = 0; t < titles.length && !primary && t < 10; t++) {
    var key = "wiki:" + titles[t];
    if (used.indexOf(key) >= 0 || cooled[key]) continue;
    var art = await fetchWiki(titles[t]);
    if (!art || art.text.length < ANCHOR_MIN_CHARS) continue;
    // CONTESTED-PRESKIP-1 (1.44.15, agent_issues 1000633): every Wikipedia anchor shares one host, so a contested primary can never pass
    // the EK-2 source gate in fitAnchors (three publishers); 94 runs on 3-4 Nov fetched and screened one only to drop it, and
    // reading.q08.org published two pieces in a week. Skip such a candidate here and try the next; the gate itself is unchanged.
    if (isContestedTopic(String(art.title || "") + " " + String(art.text || ""))) { skipped.push(titles[t] + " (contested, one-host sources)"); continue; }
    var fit = systemsFit(art);
    if (fit.ok) {
      var cs = causalScore(art.text); // CAUSAL-SOURCE-1
      causalSeen.push(art.title.slice(0, 40) + " " + cs);
      if (cs >= CAUSAL_MIN) primary = art;
      else if (cs > fittedCausal) { fitted = art; fittedCausal = cs; }
    }
    else { if (!fallback) fallback = art; skipped.push(titles[t] + " (" + fit.why + ")"); }
  }
  if (skipped.length) diagNote("systems-fit skipped: " + skipped.slice(0, 3).join(", "));
  if (causalSeen.length) diagNote("causal screen: " + causalSeen.slice(0, 5).join(", ") + (primary ? "" : fitted ? "; none stated " + CAUSAL_MIN + ", using " + fitted.title : ""));
  if (!primary && fitted) primary = fitted;
  if (!primary && fallback) { primary = fallback; diagNote("systems-fit: no candidate fit, using " + fallback.title); }
  if (!primary) return [];
  var anchors = [primary];
  var pool = await fetchLinkedTitles(primary.title);
  var named = rankLinked(pool, primary.text, primary.title);
  var linked = named.slice(0, 4).concat(pickSeeded(pool.filter(function (x) { return named.indexOf(x) < 0; }), seed, 6)).slice(0, 6);
  var got = 0, picked = [];
  for (var li = 0; li < linked.length && got < 2; li++) {
    var la = await fetchWiki(linked[li]);
    if (la && la.text.length >= LINK_MIN_CHARS) { anchors.push(la); got++; picked.push(la.title + (named.indexOf(linked[li]) >= 0 ? " (named)" : " (random)")); }
  }
  if (picked.length) diagNote("context links: " + picked.join(", "));
  return anchors;
}
async function paperAnchors(subject, seed) {
  var papers = [];
  if (subject) papers = await fetchArxivQuery("arxiv subject", "all:%22" + encodeURIComponent(subject) + "%22", "relevance");
  if (!papers.length) papers = pickSeeded(await fetchArxivQuery("arxiv recent", arxivWindow(Date.now())), seed, 8);
  return withFullText(papers, 3); // COMPANION-PAPER-FULLTEXT-1: full texts only, never the abstract
}
async function ensureAnchorCache(env) {
  try {
    await env.PERSONAL.prepare("CREATE TABLE IF NOT EXISTS companion_anchor_cache (id INTEGER PRIMARY KEY AUTOINCREMENT, topic_id TEXT, a TEXT, anchors_json TEXT NOT NULL, created_at TEXT NOT NULL, attempts INTEGER DEFAULT 0, done INTEGER DEFAULT 0)").run();
    return true;
  } catch (e) { return false; }
}
async function pickTopic(env, form) {
  srcDiag = [];
  var used = [];
  try {
    var r = await env.PERSONAL.prepare(
      "SELECT DISTINCT key FROM companion_seeds WHERE used_at > datetime('now','-10 days') OR (form = ? AND used_at > datetime('now','-1 day'))"
    ).bind(form).all();
    var rr = r.results || [];
    for (var i = 0; i < rr.length; i++) used.push(rr[i].key);
  } catch (e) {
    used = [];
  }
  var cooled = {};
  try {
    var cr = await env.PERSONAL.prepare(
      // TOPIC-COOLDOWN-2: a rejected draft counts too (every attempt of a topic ended 'rejected' and the run 'failed' with no topic, so the
      // cooldown never saw a topic and one Wikipedia article was retried every hour: runs 5100-5135)
      "SELECT topic, SUM(CASE WHEN status IN ('failed','rejected') THEN 1 ELSE 0 END) f FROM companion_runs WHERE topic != '' AND topic != 'none' AND run_at > datetime('now','-14 days') GROUP BY topic"
    ).all();
    var crr = cr.results || [];
    for (var ci = 0; ci < crr.length; ci++) if (Number(crr[ci].f) >= 2) cooled[crr[ci].topic] = true;
  } catch (e) {
    cooled = {};
  }
  var seed = (Date.now() ^ (Math.random() * 4294967296)) >>> 0;
  var wiki = [], papers = [];
  try { wiki = await wikiAnchors(used, cooled, seed); } catch (eW) { wiki = []; diagNote("wikipedia: " + String(eW && eW.message || eW).slice(0, 60)); }
  try { papers = await paperAnchors(wiki.length ? wiki[0].title : "", seed); } catch (eP) { papers = []; diagNote("arxiv: " + String(eP && eP.message || eP).slice(0, 60)); }
  var anchors = [], id = "", subject = "";
  if (wiki.length >= 2) { anchors = wiki.concat(papers.slice(0, 2)); id = "wiki:" + wiki[0].title; subject = wiki[0].title; }
  else if (papers.length >= 2) {
    // Wikipedia unavailable (or too thin): the piece rests on recent papers alone, each read from its full text (COMPANION-PAPER-FULLTEXT-1).
    var pp = papers.slice(0, 3);
    anchors = (wiki.length ? wiki : []).concat(pp);
    id = "arxiv:" + pp[0].title; subject = pp[0].title;
    if (used.indexOf(id) >= 0 || cooled[id]) { anchors = []; }
  }
  var cacheOk = await ensureAnchorCache(env);
  var cacheId = 0, fromCache = false;
  if (anchors.length < 2 && cacheOk) {
    try {
      var cr2 = await env.PERSONAL.prepare("SELECT id, topic_id, a, anchors_json FROM companion_anchor_cache WHERE done = 0 AND attempts < 3 AND created_at > ? ORDER BY id DESC LIMIT 1").bind(new Date(Date.now() - 3 * 864e5).toISOString()).first();
      // COMPANION-PAPER-FULLTEXT-1: material cached before 1.17.0 holds paper abstracts; a paper anchor without its full text is dropped
      var cached = cr2 && JSON.parse(cr2.anchors_json);
      if (cached) cached = cached.filter(function (a) { return a && (a.kind !== "paper" || a.full === true); });
      if (cached && String(cr2.topic_id || "").indexOf("arxiv:") === 0 && !cached.some(function (a) { return a.title === cr2.a; })) cached = null; // its subject paper was dropped
      if (cached && cached.length >= 2) {
        anchors = cached; id = cr2.topic_id; subject = cr2.a; cacheId = cr2.id; fromCache = true;
        await env.PERSONAL.prepare("UPDATE companion_anchor_cache SET attempts = attempts + 1 WHERE id = ?").bind(cr2.id).run();
        diagNote("reused cached material " + id);
      }
    } catch (eC) { logCaught("pickTopic", eC); }
  }
  if (anchors.length < 2) return { id: "none", a: "", b: "", anchors: [], diag: srcDiag.join("; ") || "no source returned usable text" };
  anchors = fitAnchors(anchors);
  var pick = { id: id, a: subject, b: anchors.length > 1 ? anchors[1].title : "", anchors: anchors, diag: srcDiag.join("; "), cacheId: cacheId, fromCache: fromCache };
  if (!fromCache && cacheOk) {
    try {
      var ins = await env.PERSONAL.prepare("INSERT INTO companion_anchor_cache (topic_id, a, anchors_json, created_at, attempts) VALUES (?,?,?,?,1)").bind(id, subject, JSON.stringify(anchors), nowIso()).run();
      pick.cacheId = ins && ins.meta && ins.meta.last_row_id || 0;
    } catch (eI) { logCaught("pickTopic", eI); }
  }
  try {
    await env.PERSONAL.prepare(
      "INSERT INTO companion_seeds(key, source, form, used_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET used_at=excluded.used_at, form=excluded.form"
    ).bind(pick.id, "live", form, nowIso()).run();
  } catch (e) {
    try {
      await env.PERSONAL.prepare("INSERT OR IGNORE INTO companion_seeds(key, source, form, used_at) VALUES(?,?,?,?)").bind(pick.id, "live", form, nowIso()).run();
    } catch (e2) { logCaught("pickTopic", e2); }
  }
  return pick;
}
// COMPANION-DEEPSEEK-402-FALLBACK-1 (1.13.0, 2026-10-07, pillar core): the owner left the DeepSeek balance empty
// (decision 2026-10-05, #1986), every writer and critic call got HTTP 402 in under a second, and reading.q08.org
// published nothing after 2026-10-05 08:06Z (companion_runs: "composed 0" x5 per run, steward "collapse" every hour).
// Now a DeepSeek failure falls through to Workers AI; a 401/402/403 opens a 60-minute breaker so later calls skip the
// paid round trip. The fallback order differs by role so writer and critic stay on different models.
var DS_BREAKER_MS = 36e5;
var dsBreakerUntil = 0;
var lastCallFallback = false; // COMPANION-FALLBACK-FLOOR-1: true when the latest model call was answered by Workers AI
// Measured 2026-10-07 (400-word probe, max_tokens 6000): kimi-k2.6 402 words in 60s, gpt-oss-120b 400 words in 26s,
// glm-5.3 spent all 6000 tokens reasoning and returned no prose, so it is last everywhere. Reasoning models need room
// beyond the prose, so a fallback call gets at least FB_MIN_TOKENS and FB_MIN_TIMEOUT_MS.
// WRITER-FAMILY-1 (1.25.0, 2026-10-14, agent_issues 2552): every one of the 111 drafts rejected from 2026-10-13 00:00 to 2026-10-14
// 02:11 UTC was written by gpt-oss-120b (companion_runs.model), whatever the topic, prompt or repair. deepseek-v4-pro, a family neither
// critic-first (moonshot) nor gpt-oss, now writes first with its reasoning switched off (the switch the fact-check measured, about 9 s
// a verdict), and gpt-oss-120b stays the per-request fallback. It costs about 177 neurons per 1k tokens against gpt-oss's 42
// (ai_call_counters 2026-10-12 to 14), roughly 2000 neurons a draft. ops_config companion_writer = gpt-oss puts the old order back
// without a deploy (BUDGET-SOFT-ROUTE-1: the lever at a cap is the cheaper model, never a stop).
// COMPANION-FALLBACK-TUNE-1 (1.13.1): kimi-k2.6 stays out of the writer lead. Live run 2026-10-07 12:00Z: it used the full 300 s writer
// timeout on every essay attempt before gpt-oss answered, so the run was killed by the cron wall after three attempts with no piece.
var WRITER_LEAD = "@cf/deepseek-ai/deepseek-v4-pro-0813";
var CF_FALLBACK = {
  essay: [WRITER_LEAD, "@cf/openai/gpt-oss-120b", "@cf/moonshotai/kimi-k2.6", "@cf/zai-org/glm-5.3"],
  writer: [WRITER_LEAD, "@cf/openai/gpt-oss-120b", "@cf/moonshotai/kimi-k2.6", "@cf/zai-org/glm-5.3"],
  // CRITIC-NOTHINK-1 (1.20.2): deepseek-v4-pro answers fact-checks in about 9 s with no errors (ai_call_counters 2026-10-13) and is a
  // family other than the gpt-oss writer, so it is second; glm-5.3 stays last.
  critic: ["@cf/moonshotai/kimi-k2.6", "@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/openai/gpt-oss-120b", "@cf/zai-org/glm-5.3"],
  // REFRAME-REPAIR-1 (1.23.0): the editor is the writer's family first and never the critic's first family (moonshot), so the critic's
  // re-read of an edited draft stays an independent reading; nemotron (nvidia) is the last family
  editor: [WRITER_LEAD, "@cf/openai/gpt-oss-120b", "@cf/nvidia/nemotron-3-120b-a12b"]
};
var CF_FALLBACK_GPT_OSS = { essay: CF_FALLBACK.essay.slice(1), writer: CF_FALLBACK.writer.slice(1), editor: CF_FALLBACK.editor.slice(1) };
// WRITER-FAMILY-1: the families that wrote or edited the draft in hand. A critic call skips them, so a draft is never judged by its own
// family when the critic chain falls through (kimi-k2.6 failed 28 of 162 calls from 2026-10-12 to 14). Reset by every new draft.
var authorFamilies = {};
var writerOrder = "deepseek";
async function loadWriterOrder(env) {
  writerOrder = "deepseek";
  try {
    var db = env && (env.AUDIT || env.QNFO_AUDIT);
    var row = db ? await db.prepare("SELECT value FROM ops_config WHERE key = 'companion_writer'").first() : null;
    if (row && /gpt-oss/i.test(String(row.value || ""))) writerOrder = "gpt-oss";
  } catch (e) { logCaught("loadWriterOrder", e); }
  return writerOrder;
}
var FB_MIN_TOKENS = 4e3;
var FB_MIN_TIMEOUT_MS = 9e4;
function fallbackChain(model, role) {
  var table = writerOrder === "gpt-oss" ? Object.assign({}, CF_FALLBACK, CF_FALLBACK_GPT_OSS) : CF_FALLBACK;
  if (role && table[role]) return table[role];
  return String(model || "").indexOf("reasoner") >= 0 ? table.essay : table.writer;
}
function cfText(r) {
  if (!r) return { text: "", rlen: 0 };
  var c = "", rc = "";
  if (typeof r.response === "string") c = r.response;
  var m = r.choices && r.choices[0] && r.choices[0].message;
  if (m) {
    if (!c && typeof m.content === "string") c = m.content;
    rc = m.reasoning_content || m.reasoning || "";
  }
  return { text: c, rlen: String(rc || "").length };
}
// CRITIC-NOTHINK-1 (1.20.2, companion_runs 5420-5442 of 2026-10-13 12:00 UTC): each critique took 70-125 s because kimi-k2.6, first in
// the critic chain, reasoned until its 90 s timeout on 9 of 15 calls before gpt-oss answered, so five attempts used the run without one
// reaching the fact-check. A critic call takes the measured per-model reasoning switch of the fact-check reviewers (factCheckExtra:
// kimi and deepseek thinking off, gpt-oss effort low), which returns the same JSON verdict in seconds.
async function callWorkersAI(env, messages, maxTokens, timeoutMs, chain, prevErr, role) {
  var errs = prevErr ? [prevErr] : [];
  for (var i = 0; i < chain.length; i++) {
    var m = chain[i];
    if (!modelAllowed(m)) continue;
    // WRITER-FAMILY-1: a critic never reads a draft its own family wrote or edited
    if (role === "critic" && authorFamilies[familyOf(m)]) { errs.push(m + ": skipped (author family)"); continue; }
    // WRITER-FAMILY-1: kimi and deepseek write with their reasoning off, as they review; gpt-oss keeps its writing effort
    var quiet = role === "critic" || role === "editor" || /kimi|deepseek/i.test(m);
    try {
      var r = await aiRunAttr(env, "personal-companion", "compose-fallback", m,
        Object.assign({ messages: messages, max_tokens: Math.min(Math.max(Number(maxTokens) || 0, FB_MIN_TOKENS), 14e3), temperature: role === "critic" || role === "editor" ? CRITIC_TEMPERATURE : WRITER_TEMPERATURE_FB }, quiet ? factCheckExtra(m) : {}),
        // COMPANION-PUBLISH-REPAIR-1: skipCache. The default AI Gateway caches identical requests, so a retry with the same prompt got the
        // same draft back in 0.1 s (runs 5242-5254 and 5264-5276 replayed the 01:00Z drafts verbatim); every writer and critic call is fresh.
        { gateway: { id: "default", skipCache: true }, signal: AbortSignal.timeout(Math.max(Number(timeoutMs) || 0, FB_MIN_TIMEOUT_MS)) });
      var t = cfText(r);
      if (typeof t.text === "string" && t.text.trim().length > 80) {
        if (role !== "critic") authorFamilies[familyOf(m)] = 1; // WRITER-FAMILY-1
        return { model: m, text: t.text };
      }
      errs.push(m + ": empty (clen=" + String(t.text || "").length + " rlen=" + t.rlen + ")");
    } catch (e) {
      errs.push(m + ": " + String(e && e.message || e).slice(0, 160));
    }
  }
  return { model: chain[0], text: null, error: errs.join(" | ").slice(0, 600) };
}
async function callModel(env, messages, maxTokens, timeoutMs, model, role) {
  var useModel = model || WRITER_MODEL;
  var isReasoner = String(useModel).indexOf("reasoner") >= 0;
  var chain = fallbackChain(useModel, role);
  lastCallFallback = false;
  if (!env.DEEPSEEK_API_KEY || Date.now() < dsBreakerUntil) {
    lastCallFallback = true;
    return await callWorkersAI(env, messages, maxTokens, timeoutMs, chain, Date.now() < dsBreakerUntil ? "deepseek breaker open" : "no deepseek key", role);
  }
  var dsErr = "";
  try {
    var mt = isReasoner ? Math.min(Number(maxTokens) || 16e3, 16e3) : Math.min(Number(maxTokens) || 4e3, 14e3);
    var body = { model: useModel, messages, max_tokens: mt, stream: false };
    body.temperature = isReasoner ? 1 : 0.7;
    var resp = await fetch(WRITER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.DEEPSEEK_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs || 9e4)
    });
    if (!resp.ok) {
      var errText = "";
      try {
        errText = await resp.text();
      } catch (e2) { logCaught("callModel", e2); }
      if (resp.status === 401 || resp.status === 402 || resp.status === 403) dsBreakerUntil = Date.now() + DS_BREAKER_MS;
      dsErr = useModel + ": HTTP " + resp.status + " " + errText.slice(0, 160);
    } else {
      var j = await resp.json();
      var msg = j && j.choices && j.choices[0] && j.choices[0].message;
      var text = msg && msg.content || "";
      if (typeof text === "string" && text.trim().length > 80) return { model: useModel, text };
      dsErr = useModel + ": " + (msg && msg.reasoning_content ? "reasoning only, rlen=" + String(msg.reasoning_content).length : "empty");
    }
  } catch (e) {
    dsErr = useModel + ": " + String(e && e.message || e).slice(0, 160);
  }
  lastCallFallback = true;
  return await callWorkersAI(env, messages, maxTokens, timeoutMs, chain, dsErr, role);
}
__name(callModel, "callModel");
__name2(callModel, "callModel");
__name22(callModel, "callModel");
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
__name2(renderInline, "renderInline");
__name22(renderInline, "renderInline");
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
__name2(escHtml, "escHtml");
__name22(escHtml, "escHtml");
// READING-NO-SOURCE-LEDE-1 (1.41.0): pieces written before 1.41.0 credit their source in the lede ("X is a club in Araraquara,
// according to the Wikipedia article on it."). plainCredit drops that clause at display time only; the stored text is what was
// checked, and a sentence whose subject is the article itself is left alone rather than rewritten.
var CREDIT_SRC = "(?:the\\s+)?(?:English\\s+)?(?:Wikipedia(?:\\s+article|\\s+entry|\\s+page)?|arXiv\\s+(?:paper|preprint|submission))";
var CREDIT_TAIL_RE = new RegExp(",?\\s+(?:according\\s+to|as\\s+(?:described|told|summarised|summarized|recounted)\\s+(?:in|by)|per|in\\s+the\\s+words\\s+of)\\s+" + CREDIT_SRC + "(?:\\s+(?:on|about|for|titled|called)\\s+[^,.;:!?]{1,120})?(?=[.;:!?]|$)", "gi");
var CREDIT_HEAD_RE = new RegExp("(^|[.!?]\\s+)(?:According\\s+to|As\\s+(?:described|told|summarised|summarized|recounted)\\s+(?:in|by)|Per)\\s+" + CREDIT_SRC + "(?:\\s+(?:on|about|for|titled|called)\\s+[^,]{1,120})?,\\s+(\\S)", "g");
function plainCredit(text) {
  return String(text || "").replace(CREDIT_TAIL_RE, "").replace(CREDIT_HEAD_RE, function (m, pre, c) { return pre + c.toUpperCase(); });
}
function sourcesFoot(anchorJson) { return afSourcesFooterFromJson(anchorJson, escHtml); }
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
  __name2(flushP, "flushP");
  __name22(flushP, "flushP");
  function closeList() {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  }
  __name(closeList, "closeList");
  __name2(closeList, "closeList");
  __name22(closeList, "closeList");
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
__name2(renderBody, "renderBody");
__name22(renderBody, "renderBody");
function formLabel(f) {
  if (f === "essay") return "Essay";
  if (f === "notes") return "Field notes";
  if (f === "serial") return "Long-form";
  return f;
}
__name(formLabel, "formLabel");
__name2(formLabel, "formLabel");
__name22(formLabel, "formLabel");
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
  "footer{margin-top:3.4rem;padding-top:1.2rem;border-top:1px solid var(--line);color:var(--mut);font-size:.78rem}",
  ".src{margin-top:2rem;color:var(--mut);font-size:.8rem}"
);
function page(title, inner, extraHead) {
  return "<!doctype html><html lang=en><head><meta charset=utf-8><meta name=robots content=noindex><meta name=viewport content=" + String.fromCharCode(34) + "width=device-width,initial-scale=1" + String.fromCharCode(34) + "><title>" + escHtml(title) + "</title><link rel=alternate type=application/rss+xml title=Reading href=/feed.xml><meta name=description content='A personal companion that writes one piece at a time - essays, field notes, and long-form serials.'><style>" + CSS + "</style>" + (extraHead || "") + "</head><body><div class=wrap>" + inner + "</div><script src='https://fleet.qnfo.org/ctl.js' defer></script></body></html>";
}
__name(page, "page");
__name2(page, "page");
__name22(page, "page");
function shell(inner) {
  return "<header class=mast><h1><a href=/>Reading</a></h1><p>Written for one reader. Private.</p><nav class=forms><a href=/subscribe>subscribe</a><a href=/feed.xml>rss</a></nav></header>" + inner;
}
__name(shell, "shell");
__name2(shell, "shell");
__name22(shell, "shell");
function renderIndex(pieces, keyQS, filter) {
  var items = [];
  for (var i = 0; i < pieces.length; i++) {
    var p = pieces[i];
    items.push("<li><a class=t href=" + String.fromCharCode(34) + "/p/" + p.slug + keyQS + String.fromCharCode(34) + ">" + escHtml(p.title) + "</a><div class=m>" + formLabel(p.form) + " &middot; " + p.day + " &middot; " + p.word_count + " words</div>" + (p.lede ? "<div class=l>" + escHtml(plainCredit(p.lede)) + "</div>" : "") + "</li>");
  }
  var nav = "<nav class=forms><a href=/" + keyQS + ">all</a>";
  nav += "<a href=/?form=essay" + (keyQS ? "&" + keyQS.slice(1) : "") + ">essays</a>";
  nav += "<a href=/?form=notes" + (keyQS ? "&" + keyQS.slice(1) : "") + ">field notes</a>";
  nav += "<a href=/?form=serial" + (keyQS ? "&" + keyQS.slice(1) : "") + ">long-form</a></nav>";
  var body = nav + (items.length ? "<ul class=idx>" + items.join("") + "</ul>" : "<p>Nothing yet.</p>");
  return page("Reading", shell(body), readingIndexLd());
}
__name(renderIndex, "renderIndex");
__name2(renderIndex, "renderIndex");
__name22(renderIndex, "renderIndex");
// BP26-AI-LABEL-1 (1.43.0): Article 50(4) disclosure on every piece; there is no human editorial review, so the label is unconditional.
var AI_LABEL_HTML = afAiLabelHtml();
// BP26-AI-ACT-ART50-1 (1.43.6): the JSON-LD flag that goes with AI_LABEL_HTML. Both ride the same sentence, so the visible label and the machine-readable one never disagree.
function pieceLd(p) {
  var url = "https://reading.q08.org/p/" + String(p.slug || "");
  var ld = { "@context": "https://schema.org", "@type": "Article", headline: String(p.title || "").slice(0, 200), datePublished: String(p.day || ""), inLanguage: "en", url: url, mainEntityOfPage: url,
    author: { "@type": "Organization", name: "Reading (reading.q08.org)", url: "https://reading.q08.org/" }, publisher: { "@type": "Organization", name: "q08", url: "https://q08.org/" },
    creditText: AF_AI_LABEL_TEXT };
  return "<script type=\"application/ld+json\">" + JSON.stringify(ld).replace(/</g, "\\u003c") + "</script>";
}
function readingIndexLd() {
  var ld = { "@context": "https://schema.org", "@type": "Blog", name: "Reading", url: "https://reading.q08.org/", description: "Essays, field notes and long-form serials written by AI for one reader and checked against their source material by automated review.", publisher: { "@type": "Organization", name: "q08", url: "https://q08.org/" } };
  return "<script type=\"application/ld+json\">" + JSON.stringify(ld).replace(/</g, "\\u003c") + "</script>";
}
function renderPiece(p, keyQS) {
  var bodyMd = String(p.body_md || "");
  var startsHeading = /^\s*#/.test(bodyMd);
  var ledeHtml = p.lede ? "<p class=lede>" + escHtml(plainCredit(p.lede)) + "</p>" : "";
  var bodyContent = plainCredit(bodyMd);
if (p.lede) {
  var ledePlain = plainCredit(p.lede).trim();
  if (bodyContent.trim().startsWith(ledePlain)) {
    bodyContent = bodyContent.trim().slice(ledePlain.length).trim();
  }
}
var body = "<div class=meta>" + formLabel(p.form) + " &middot; " + p.day + " &middot; " + p.word_count + " words &middot; " + AI_LABEL_HTML + "</div><h2>" + escHtml(p.title) + "</h2>" + (p.subtitle ? "<p class=meta>" + escHtml(p.subtitle) + "</p>" : "") + ledeHtml + renderBody(bodyContent) + sourcesFoot(p.anchor_json);
  var fb = "<div class=fb>Was this worth your time? <a href=/api/f?slug=" + p.slug + "&s=good>yes</a><a href=/api/f?slug=" + p.slug + "&s=flat>flat</a><a href=/api/f?slug=" + p.slug + "&s=no>no</a></div>";
  var foot = "<footer><a href=/ " + keyQS + ">back to index</a></footer>";
  return page(p.title, shell(body + fb + foot), pieceLd(p));
}
__name(renderPiece, "renderPiece");
__name2(renderPiece, "renderPiece");
__name22(renderPiece, "renderPiece");
function anchorsBlock(topic, anchors, life, profile) {
  var lines = [];
  lines.push("--- briefing. Never reproduce any wording from this briefing in the piece. ---");
  lines.push("subject: " + topic.a);
  if (anchors.length) lines.push("the subject comes from: the " + sourceLabel(anchors[0]) + " \"" + anchors[0].title + "\" (it is listed under the piece; never credit it in the prose)");
  lines.push("The other items are supporting source material: use those that bear on the subject, ignore the rest. Do not force a connection the sources do not make.");
  lines.push("");
  lines.push("SOURCE MATERIAL, concrete and checkable; the only things you may assert as fact (nothing outside it, not even what you are sure is true):");
  for (var i = 0; i < anchors.length; i++) {
    var a = anchors[i];
    lines.push("[" + (i + 1) + "] " + sourceLabel(a) + " :: " + a.title);
    lines.push("    ref: " + a.ref);
    if (a.viewpoint || a.sourceCountry) lines.push("    source metadata (not factual evidence): " + [a.viewpoint ? "viewpoint=" + a.viewpoint : "", a.sourceCountry ? "sourceCountry=" + a.sourceCountry : ""].filter(Boolean).join("; "));
    lines.push("    " + a.text);
    lines.push("");
  }
  lines.push("who the reader is; shapes emphasis and register only, is not source material and supports no factual claim:");
  lines.push(profile);
  lines.push("");
  lines.push("his recent life; shapes emphasis only, is not source material, never list it back at him:");
  lines.push(life);
  return lines.join(NL).slice(0, 32e3);
}
__name(anchorsBlock, "anchorsBlock");
__name2(anchorsBlock, "anchorsBlock");
__name22(anchorsBlock, "anchorsBlock");
function countHeadings(md, level) {
  var mark = level === 3 ? "### " : "## ";
  var lines = String(md).split(NL);
  var n = 0;
  for (var i = 0; i < lines.length; i++) if (lines[i].trim().indexOf(mark) === 0) n++;
  return n;
}
__name(countHeadings, "countHeadings");
__name2(countHeadings, "countHeadings");
__name22(countHeadings, "countHeadings");
// extractSection moved to _shared/analysis-form.js (afExtractSection, used by afFindObjection).
// OBJECTION-FIND-1 (1.25.3, agent_issues 2552; companion_runs 5965, 5968 and 5972, 2026-10-14 04:06-04:07 UTC): the essay contract
// lets the objection sit anywhere ("a heading, two sentences mid-argument, or the whole last section") and the output rule forbids
// the same heading or position twice in a row, but the objection was read only from a heading containing "objection", so three of
// the four deepseek drafts of the 04:00 run failed "objection too thin" before any reader saw them. The objection is now the
// section under such a heading, else the paragraph that raises it in so many words (with the next one when it only opens the
// point), else the section under a heading that names a challenge to the claim. The critic still scores whether it is the
// strongest objection; nothing here judges its quality.
// OBJECTION_CUE_RE and OBJECTION_HEAD_RE moved to _shared/analysis-form.js (AF_OBJECTION_CUE_RE, AF_OBJECTION_HEAD_RE).
function findObjection(md) { return afFindObjection(md); }
__name(findObjection, "findObjection");
function extractLede(md) { return afExtractLede(md); }
__name(extractLede, "extractLede");
__name2(extractLede, "extractLede");
__name22(extractLede, "extractLede");
function sourceDiversityOk(srcs) {
  if (!Array.isArray(srcs) || srcs.length < 3) return false;
  var hasFullText = srcs.every(function (a) { return String(a.text || "").trim().length > 0; });
  if (!hasFullText) return false;
  var hasNonUS = srcs.some(function (a) { return a.sourceCountry && a.sourceCountry.toUpperCase() !== "US"; });
  if (!hasNonUS) return false;
  var vpSet = {};
  srcs.forEach(function (a) { if (a.viewpoint) vpSet[a.viewpoint] = true; });
  if (Object.keys(vpSet).length < 2) return false;
  // EK-2: the 3 sources must be independent - distinct refs, not the same anchor counted twice.
  var seen = {};
  var independent = true;
  srcs.forEach(function (a) { var k = String(a.ref || a.title || "").trim(); if (!k || seen[k]) independent = false; seen[k] = true; });
  return independent;
}
__name(sourceDiversityOk, "sourceDiversityOk");
__name2(sourceDiversityOk, "sourceDiversityOk");
__name22(sourceDiversityOk, "sourceDiversityOk");
var CONTESTED_TOPIC_RE = new RegExp("\\b(?:politics|political|policy|policies|geopolitics|geopolitical|history|histories|war|wars|election|elections|health|economy|economics|economies|finance|diplomacy|diplomacies|government|military|conflict|conflicts|treaty|treaties|budget|budgets|inflation|recession|legislation|vaccine|vaccines|pandemic|pandemics|disease|diseases|Afghanistan)\\b", "i");
var NOTES_OBJECTION_PLACEHOLDER = "Each item stands or falls on its own.";
async function composePiece(env, form, topic, anchors, life, profile, continuity, feedback, revision) {
  // Ensure contested-topic pieces have sufficient source diversity:
  // - at least 3 independent sources with full text
  // - at least two distinct viewpoints
  // - at least one source from a non‑US country
  var topicText = [topic.a, topic.b, topic.category, topic.tag, topic.topic, topic.subject].map(function (x) { return String(x || ""); }).join(" ");
  if (CONTESTED_TOPIC_RE.test(topicText) && !sourceDiversityOk(anchors)) {
    return { piece: null, model: null, raw: "", error: "insufficient sources for contested topic" };
  }
  var band = writerBand(form, writerIsFallback(env)), bandText = band[0] + " to " + band[1] + " words";
  var formContract = (form === "essay" ? P_ESSAY : form === "serial" ? P_SERIAL : P_NOTES).replace(/\d{4} to \d{4} words/, bandText);
  var outRule = form === "notes" ? "Output format: plain markdown only, no JSON, no code fences. First line: a single heading starting with # and a short title for the whole set. Then the lede paragraph, with no heading above it. Then each movement as its own ## heading followed by several developed paragraphs." : "Output format: plain markdown only, no JSON, no code fences. First line: a single heading starting with # and the title. Then the lede paragraph, with no heading above it. Use ## for sections after it. The strongest objection must appear in the piece, but never under the same heading or in the same position twice in a row; place it where the argument needs it";
  var P_ADV1 = L("ADVERSARIAL-REASONING-1 (binding): DISAGREE-WITH-EVIDENCE - state disagreement plainly with counter-evidence when evidence contradicts the user/source/corpus; SEEK-DISCONFIRMATION - name and test the strongest argument against the current answer; EXPOSE-FAILURE-MODES - state at least one concrete failure mode per substantive response; LABEL-UNCERTAINTY - tie confidence to evidence, never inflate it, and say I do not know with a reason when required.");
  var sys = [P_STYLE, P_ADV1, "", formContract, "", outRule].join(NL);
  var concreteRule = "Every claim must be tied to a named, checkable particular that appears in the source material, and you may name nothing that does not appear there. A sentence that could have been written without the source material is a failed sentence. Write the title and every heading in sentence case: capitalise only the first word and names that appear in the source material.";
  var lenRule = concreteRule + " " + "Length: " + bandText + (form === "notes" ? ", in 3 to 5 movements" : "") + ". Reach it with what the source material says, never with particulars it does not hold: a shorter piece that adds nothing is better than a longer one that invents.";
  var user = [anchorsBlock(topic, anchors, life, profile), "", lenRule, "", continuity, feedback ? "A previous draft was rejected by an adversarial reader for this reason: " + feedback + " Write a better draft that fixes that." : "", revision ? NL + (revision.note || factRevisionPrompt(revision.problems)) + NL + NL + "--- DRAFT TO REVISE ---" + NL + "# " + String(revision.title || "") + NL + NL + String(revision.body_md || "").slice(0, 24e3) : ""].join(NL);
  var writerModel = form === "notes" ? WRITER_MODEL : WRITER_MODEL_ESSAY;
  authorFamilies = {}; // WRITER-FAMILY-1: a new draft, a new set of author families
  var r = await callModel(env, [{ role: "system", content: sys }, { role: "user", content: user }], GEN_MAX_TOKENS, WRITER_TIMEOUT_MS, writerModel, form === "notes" ? "writer" : "essay");
  if (!r || !r.text) {
    var errMsg = r && r.error ? r.error : "callModel returned null";
    return { piece: null, model: r && r.model || writerModel, raw: "", error: errMsg };
  }
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
  if (!title) title = topic.b ? topic.a + " and " + topic.b : topic.a;
  var objection = findObjection(md);
  var ledeObj = extractLede(md);
  return {
    piece: {
      title: title.slice(0, 300),
      subtitle: "",
      lede: ledeObj.lede,
      body_md: ledeObj.rest,
      objection: objection || (form === "notes" ? NOTES_OBJECTION_PLACEHOLDER : "")
    },
    model: r.model,
    raw: String(r.text || "")
  };
}
__name(composePiece, "composePiece");
__name2(composePiece, "composePiece");
__name22(composePiece, "composePiece");
async function critiquePiece(env, piece, form, ground, note) {
  var wb = writerBand(form, writerIsFallback(env)), band = wb[0] + " to " + wb[1] + " words" + (form === "notes" ? " in 3 to 5 movements" : ""); // WRITER-FIT-1
  // COMPANION-CRITIC-OBJECTION-1 (1.17.0): the notes form has no objection section, and composePiece filled the field with a placeholder
  // ("Each item stands or falls on its own."), which the critic then scored as the piece's objection (run 5329: "richly detailed and
  // well-grounded in the source, but its stated objection is weak", objection=3, rejected). The critic now reads the body for it.
  var objText = String(piece.objection || "").trim();
  var objLine = !objText || objText === NOTES_OBJECTION_PLACEHOLDER ? "(no separate objection section; judge the objection the body raises, if any)" : objText;
  var user = todayLine() + NL + NL + "SOURCE MATERIAL:" + NL + String(ground || "").slice(0, GROUND_MAX + 2000) + NL + NL + "FORM: " + form + " (" + band + ")" + NL + NL + "TITLE: " + piece.title + NL + "LEDE: " + stripAnalysisMark(piece.lede || "") + NL + "STATED OBJECTION: " + objLine + NL + NL + "BODY:" + NL + (analysisSplitOk(splitText(piece)) ? String(piece.body_md || "") : stripAnalysisMark(piece.body_md)); // SPLIT-LEDE-1
  if (note) user += NL + NL + String(note); // ANALYSIS-RULE-REREAD-1
  var r = await callModel(env, [{ role: "system", content: P_CRITIQUE }, { role: "user", content: user }], 1600, CRITIQUE_TIMEOUT_MS, CRITIC_MODEL, "critic"); // CRITIC-LIST-16-1: room for 16 quotations
  return r && r.text ? parseJsonLoose(r.text) : null;
}
__name(critiquePiece, "critiquePiece");
__name2(critiquePiece, "critiquePiece");
__name22(critiquePiece, "critiquePiece");
var GEN_BUDGET_MS = 600e3;
var LENGTH_FLOOR = { essay: 2000, serial: 1800, notes: 1700 };
// COMPANION-FALLBACK-FLOOR-1: measured 2026-10-07/08, 40+ gpt-oss-120b drafts all landed at 1100-1750 words and none passed the
// 1700-2000 floor, so nothing published for 78h. A draft written by the Workers AI fallback is held to 70% of the floor
// (the critic, banned-phrase and citation gates are unchanged); DeepSeek drafts keep the full floor.
// COMPANION-PUBLISH-REPAIR-1 (1.17.0): 0.7 -> 0.5. In the 72h to 2026-10-13 05:16Z the fallback's drafts measured 771-1189 words (notes, 28
// rejected for length) and 1263-1374 (essays, 10), so 42 attempts failed on length alone or with it; a longer demand on a three-article
// source is also what pushed the writer to add particulars the sources do not hold. The prompt still asks for the full length.
var FALLBACK_FLOOR_RATIO = 0.5;
// WRITER-FIT-1 (1.22.1, companion_runs 5584-5628 of 2026-10-13 18:00 UTC): the first draft passed the critic, then every rejection named a
// detail the writer added to the reporting (a concession's service obligations, a fare structure, a firm's capital tied to exports). The
// Workers AI writer was asked for the full band (1800-2800 words) while its drafts are held to half of it (FALLBACK_FLOOR_RATIO), so it
// padded a three-article source with plausible particulars, and it sampled at 0.7. It is now asked for the length its floor needs (a
// 15% margin over the floor, a 500-word band), the critic is told the same band, and it samples at WRITER_TEMPERATURE_FB; the critic, a
// judge, samples at CRITIC_TEMPERATURE. DeepSeek drafts keep the full band.
var WRITER_TEMPERATURE_FB = 0.35, CRITIC_TEMPERATURE = 0.2;
var FULL_BAND = { essay: [2000, 2800], serial: [1800, 2400], notes: [1800, 2400] };
function writerBand(form, fallback) {
  var full = FULL_BAND[form] || FULL_BAND.notes;
  if (!fallback) return full;
  var lo = Math.round((LENGTH_FLOOR[form] || 1700) * FALLBACK_FLOOR_RATIO * 1.15 / 50) * 50;
  return [lo, lo + 500];
}
function writerIsFallback(env) { return !(env && env.DEEPSEEK_API_KEY) || Date.now() < dsBreakerUntil; }
// A draft repaired by deleting sentences (grounding, banned phrase, fact-check items) was written at full length; it is held to this share
// of the floor in effect (the q08-signal-engine PRUNE_FLOOR pattern), so a deletion that cannot add a fact is not undone by the floor.
var REPAIR_FLOOR_SHARE = 0.85;
function floorFor(form, share) {
  var f = LENGTH_FLOOR[form];
  if (f && lastCallFallback) f = Math.round(f * FALLBACK_FLOOR_RATIO);
  return f && share ? Math.round(f * share) : f;
}
// COMPANION-FALLBACK-TUNE-1: when the only validation problem is a length below the form's floor, the next attempt gets the
// draft itself and is asked to extend it (keep every claim, title and section; deepen the argument from the anchors) to the
// floor plus a margin. Any other problem, or a draft that is too long, returns null and the normal retry feedback stands.
function expandFeedback(problems, form, piece) {
  if (!problems || problems.length !== 1) return null;
  var m = /^(essay|serial|notes) length (\d+)$/.exec(String(problems[0]));
  if (!m || m[1] !== form) return null;
  var wc = Number(m[2]), floor = floorFor(form);
  if (!floor || wc >= floor) return null;
  var target = floor + 300;
  return "The previous draft was good but too short: " + wc + " words against a floor of " + floor + ". Do not start over. " +
    "Return the same piece, same title and the same sections in the same order, extended to at least " + target + " words: " +
    "deepen each section with more specific particulars from the source material (names, numbers, mechanisms, cases) and a fuller " +
    "treatment of the strongest objection. Keep every sentence that is already there unless extending it. The draft follows." + NL + NL +
    "# " + String(piece && piece.title || "") + NL + NL + String(piece && piece.body_md || "").slice(0, 24e3);
}
// COMPANION-STALL-YIELD-1 (1.37.0, agent_issues 100064): an over-length draft is cut, not rewritten. validatePiece refuses an essay or notes
// piece over 3200 words and a serial over 2800 (the ceilings are unchanged and this table only repeats them; the floors are untouched).
// 29 of the 158 rejections in the 24 h to 2026-10-19 17:11Z were lengths (the newest, #11643, "essay length 3741"), and expandFeedback
// returns null above the floor, so each one fell to the generic "failed validation ... try again" feedback and paid a whole new draft
// (about 80 s on the Workers AI writer, whose new draft is as likely to be long again). When the length is the ONLY problem and the draft
// is not past 1.5 times the ceiling (a draft that far over is a broken one, and its text would not fit the feedback), the next attempt gets
// the draft itself and is asked to cut the least-sourced passages down to 500 words under the ceiling and to add nothing, which cannot
// introduce a claim the fact-check has not seen. The result goes through every gate as any draft does.
var LENGTH_CEILING = { essay: 3200, serial: 2800, notes: 3200 };
var SHORTEN_MAX_RATIO = 1.5, SHORTEN_DRAFT_CHARS = 36e3, SHORTEN_MARGIN = 500;
function shortenFeedback(problems, form, piece) {
  if (!problems || problems.length !== 1) return null;
  var m = /^(essay|serial|notes) length (\d+)$/.exec(String(problems[0]));
  if (!m || m[1] !== form) return null;
  var wc = Number(m[2]), ceiling = LENGTH_CEILING[form];
  if (!ceiling || wc <= ceiling || wc > Math.round(ceiling * SHORTEN_MAX_RATIO)) return null;
  var target = ceiling - SHORTEN_MARGIN, floor = floorFor(form);
  var body = String(piece && piece.body_md || ""), lede = String(piece && piece.lede || "");
  var text = (lede && body.indexOf(lede) === -1 ? lede + NL + NL : "") + body; // the words that were counted: the lede once, then the body
  return "The previous draft was good but too long: " + wc + " words against a ceiling of " + ceiling + ". Do not start over. " +
    "Return the same piece, same title and the same sections in the same order, cut to at most " + target + " words" + (floor ? " (and no fewer than " + floor + ")" : "") + " by removing the least-sourced passages: " +
    "the sentences that rest on the fewest particulars from the source material. Add nothing: no new sentence, name, number, date or claim. " +
    "Keep every sentence that stays word for word. The draft follows." + NL + NL +
    "# " + String(piece && piece.title || "") + NL + NL + text.slice(0, SHORTEN_DRAFT_CHARS);
}
// LEDE-PRUNE-EXTEND-1 (1.21.6, companion_runs 5540 of 2026-10-13 15:06 UTC): the third fact-prune round had removed every sentence the
// reviewers quoted (25 in three rounds) and was blocked only because the cleaned notes fell to 550 words and its first paragraph, whose
// subject-naming sentence was one of the invented ones, no longer named The Black Book of Soviet Jewry; the run then rewrote the dirtier
// round-2 draft, which drew new inventions. A cleaned draft whose only problems are its length and/or a lede without the subject is kept,
// and the revision repairs exactly those on it: it is extended from the source material and given a first paragraph that names the subject.
var LEDE_SUBJECT_PREFIX = "lede does not name the subject";
function pruneBlockFixable(problems, form) {
  var ps = problems || [], lenRe = new RegExp("^" + form + " length \\d+$");
  return ps.length > 0 && ps.every(function (p) { var x = String(p); return lenRe.test(x) || x.indexOf(LEDE_SUBJECT_PREFIX) === 0; });
}
function pruneRepairFeedback(problems, form, piece, subject) {
  if (!pruneBlockFixable(problems, form)) return null;
  var len = (problems || []).filter(function (p) { return /^(essay|serial|notes) length \d+$/.test(String(p)); })[0];
  var lede = (problems || []).some(function (p) { return String(p).indexOf(LEDE_SUBJECT_PREFIX) === 0; });
  var ledeLine = "Its first paragraph must say what " + String(subject || "the subject").slice(0, 120) + " is and where it comes from, from the source material only; open the piece with that.";
  var fb = len ? expandFeedback([len], form, piece) : null;
  if (len && !fb) return null;
  if (fb) return lede ? fb.replace("The draft follows.", ledeLine + " The draft follows.") : fb;
  return "The previous draft was good, but its first paragraph no longer names its subject. Do not start over. Return the same piece, same title and the same sections in the same order. " +
    ledeLine + " Keep every other sentence as it is. The draft follows." + NL + NL + "# " + String(piece && piece.title || "") + NL + NL + String(piece && piece.body_md || "").slice(0, 24e3);
}
// COMPANION-LEDE-1, LEDE-SPLIT-1: the lede constants and helpers live in _shared/analysis-form.js (EK-6, ANALYSIS-FORM-1); these names stay for the callers and the suites.
var LEDE_MAX_WORDS = AF_LEDE_MAX_WORDS;
var LEDE_SPLIT_WORDS = AF_LEDE_SPLIT_WORDS;
function ledeWords(t) { return afLedeWords(t); }
function ledeOf(piece) { return afLedeOf(piece); }
function ledeProblems(piece, subject) { return afLedeProblems(piece, subject); }
function splitLongLede(piece) { return afSplitLongLede(piece); }
// LENGTH-LEDE-1 (1.22.7, companion_runs 5678-5691 of 2026-10-13 20:00 UTC): composePiece cuts the first paragraph out into piece.lede
// whenever the draft opens with a paragraph, and leaves it in the body when the draft opens with a heading, so the length rails counted
// the same text 70-120 words shorter in the first layout (notes drafts of 834, 702 and 769 words were rejected against a floor of 850).
// The writer is asked for the length of the whole piece and the reader reads the lede above the body, so the piece is measured as
// lede + body, the lede once (not again when the body already holds it), the invisible analysis line not at all.
function pieceWords(piece) {
  var body = stripAnalysisMark(piece && piece.body_md), lede = stripAnalysisMark(piece && piece.lede);
  var wc = wordCount(body);
  return lede && body.indexOf(lede) === -1 ? wc + wordCount(lede) : wc;
}
// opts (optional): floorShare lowers the length floor for a repaired draft (REPAIR_FLOOR_SHARE); subject turns on the lede check (essay, notes).
function validatePiece(piece, form, ground, opts) {
  var o = opts || {};
  var problems = [];
  if (!piece || !piece.body_md) return { ok: false, problems: ["no body"] };
  var md = String(piece.body_md);
  var wc = pieceWords(piece); // LENGTH-LEDE-1
  if (form === "essay" && (wc < floorFor("essay", o.floorShare) || wc > 3200)) problems.push("essay length " + wc);
  if (form === "serial" && (wc < floorFor("serial", o.floorShare) || wc > 2800)) problems.push("serial length " + wc);
  if (form === "notes") {
    var items = countHeadings(md, 2);
    if (items < 3) problems.push("notes items " + items);
    if (wc < floorFor("notes", o.floorShare) || wc > 3200) problems.push("notes length " + wc);
  }
  if (o.subject && form !== "serial") ledeProblems(piece, o.subject).forEach(function (p) { problems.push(p); });
  var hits = bannedHits(md + " " + String(piece.title || "") + " " + String(piece.lede || ""));
  if (hits.length) problems.push("banned: " + hits.join(", "));
  if (hasEmoji(md)) problems.push("emoji present");
  if (!piece.title || String(piece.title).length < 4) problems.push("no title");
  if (form !== "notes" && wc >= 700 && (!piece.objection || String(piece.objection).length < 40)) problems.push("objection too thin");
  // COMPANION-VERIFY-1: when the source material is given, every name, year and figure must occur in it.
  if (ground !== undefined && ground !== null) {
    var gp = groundingProblems(pieceText(piece), ground, {});
    for (var gi = 0; gi < gp.length; gi++) problems.push("grounding: " + gp[gi]);
  }
  return { ok: problems.length === 0, problems, words: wc };
}
__name(validatePiece, "validatePiece");
__name2(validatePiece, "validatePiece");
__name22(validatePiece, "validatePiece");
// GROUNDING-REPAIR-1 (issue 2354, COMPANION-GROUNDING-REPAIR-1, pillar personal; no model call). When a draft fails validation for
// grounding problems only ("grounding: name not in the source: X", "grounding: figure not in the source: 78 %"), every sentence that
// contains one of the named items (exact substring, case-insensitive, unicode hyphens and quotes normalised the way the name check
// does) is removed from the lede and the body, and the draft is validated again in full. The repaired draft is accepted only when it
// passes validatePiece (length floor included) and at most a quarter of its sentences went; otherwise null, and the retry feedback
// path stands. Paragraph breaks and markdown headings are kept (a notes piece must still count its "## " items), decimals ("8.34")
// and abbreviations ("Dr.") do not end a sentence, and every other field of the piece (objection, subtitle) is carried over unchanged.
// Removing an unsupported sentence can only reduce the claims, so the two-family fact-check that follows runs unchanged.
var GROUNDING_PREFIX = "grounding:";
// Sentence deletion shared by the repair and the fact-check prune. `cutFn(units)` receives every sentence unit ({ sn, field, cut }) of the
// lede and the body (markdown heading lines are never units, so a notes piece keeps its "## " items) and marks the ones to delete.
// Paragraph breaks are kept, decimals and abbreviations do not end a sentence, every other field of the piece is carried over.
// SENT-INITIALISM-1 (1.26.2, companion_runs 6224 of 2026-10-14 08:11 UTC): a dotted initialism ("U.S.", "D.C.") ended a sentence, so the
// critic prune that deleted "... of the U.S." left the fragment "Consul. Negotiations failed ..." and the critic scored the fragment
// invented. An initialism of two or more dotted capitals no longer ends a sentence (a sentence that truly ends on one joins the next).
var SENT_ABBREV_RE = AF_SENT_ABBREV_RE;
function deleteSentences(piece, cutFn) {
  var fields = { lede: String(piece && piece.lede || ""), body_md: String(piece && piece.body_md || "") }, units = [], layout = {};
  Object.keys(fields).forEach(function (f) {
    layout[f] = fields[f].split("\n").map(function (line) {
      if (!line.trim() || /^\s*#/.test(line)) return { fixed: line };
      var raw = line.match(/[\s\S]*?[.!?]+["')\]\u2019\u201d]*(?=\s|$)\s*|[\s\S]+$/g) || [line];
      var parts = [];
      raw.forEach(function (x) { if (parts.length && SENT_ABBREV_RE.test(parts[parts.length - 1])) parts[parts.length - 1] += x; else parts.push(x); });
      return { parts: parts.map(function (sn) { var u = { sn: sn, field: f, cut: false, blank: !sn.trim() }; if (!u.blank) units.push(u); return u; }) };
    });
  });
  cutFn(units);
  var removed = units.filter(function (u) { return u.cut; }).map(function (u) { return u.sn.replace(/\s+/g, " ").trim(); });
  var rebuilt = {};
  Object.keys(layout).forEach(function (f) {
    rebuilt[f] = layout[f].map(function (l) {
      if (l.fixed !== undefined) return l.fixed;
      var out = l.parts.filter(function (u) { return !u.cut; }).map(function (u) { return u.sn; }).join("");
      return out.trim() ? out.replace(/\s+$/, "") : null;
    }).filter(function (l) { return l !== null; }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  });
  return { piece: Object.assign({}, piece, rebuilt), removed: removed, total: units.length };
}
// COMPANION-PUBLISH-REPAIR-1 (1.17.0): the repair also takes "banned: a, b" problems (each sentence holding a banned phrase is deleted;
// the FRAMING-REPAIR-1 pattern of q08-signal-engine) and a length problem next to them. 32 attempts in 72h failed on banned phrases and
// 24 on grounding with a length shortfall, all thrown away. A banned phrase in the title, or any other problem (emoji, items, lede,
// objection), is not repairable here. The result is accepted when the repaired draft passes validatePiece at REPAIR_FLOOR_SHARE of the
// floor; when only its length is left, it is returned with ok false so the extend path extends the cleaned draft instead of the original.
function repairGroundingDraft(piece, problems, form, ground, opts) {
  var list = Array.isArray(problems) ? problems : [];
  if (!list.length || !piece) return null;
  var grounding = [], phrases = [], other = [], symbols = false;
  list.forEach(function (p) {
    var s = String(p).replace(/^[\s-]+/, ""), low = s.toLowerCase();
    if (low.indexOf(GROUNDING_PREFIX) === 0) grounding.push(s);
    else if (low === "emoji present") symbols = true; // SYMBOL-REPAIR-1 (1.23.3)
    else if (low.indexOf("banned: ") === 0) low.slice(8).split(/,\s*/).forEach(function (b) { if (b.trim()) phrases.push(b.trim()); });
    else if (/^(essay|serial|notes) length \d+$/.test(low)) {}
    else other.push(s);
  });
  if (other.length || (!grounding.length && !phrases.length && !symbols)) return null;
  var titleLow = String(piece.title || "").toLowerCase();
  if (phrases.some(function (b) { return titleLow.indexOf(b) !== -1; })) return null;
  var norm = function (s) { return String(s || "").toLowerCase().replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u2018\u2019]/g, "'"); };
  var gNeedles = groundingNeedles(grounding).map(norm).filter(function (n) { return n.trim().length > 0; });
  if (grounding.length && !gNeedles.length) return null;
  var needles = gNeedles.concat(phrases.map(norm));
  var d = deleteSentences(piece, function (units) {
    units.forEach(function (u) { var low = norm(u.sn); if (needles.some(function (n) { return low.indexOf(n) !== -1; }) || (symbols && hasEmoji(String(u.sn)))) u.cut = true; });
  });
  var removed = d.removed.length;
  if (removed === 0) return null;
  if (removed * 4 > d.total) return null;
  var v2 = validatePiece(d.piece, form, ground, Object.assign({}, opts || {}, { floorShare: REPAIR_FLOOR_SHARE }));
  if (!v2.ok) {
    var shortOnly = v2.problems.length === 1 && /^(essay|serial|notes) length \d+$/.test(v2.problems[0]) && v2.words < floorFor(form, REPAIR_FLOOR_SHARE);
    return shortOnly ? { ok: false, piece: d.piece, removed: removed, total: d.total, v: v2 } : null;
  }
  return { ok: true, piece: d.piece, removed: removed, total: d.total, v: v2 };
}
// COMPANION-FACT-PRUNE-1 (1.17.0; q08-signal-engine Q08-PRUNE-1 and Q08-PRUNE-FUZZY-1): the reviewers quote the unsupported sentences, so
// the safest repair deletes exactly those sentences (deletion cannot add a fact; a model revision can). A quotation matches a sentence
// that contains its first 60 normalised characters (or is contained in it); a quotation that matches nothing removes the one sentence that
// shares the most of its content words (at least 4 and 60% of them). The caller re-verifies the result in full.
var FUZZY_MIN_SHARED = 4, FUZZY_MIN_SHARE = 0.6;
function normForMatch(t) { return String(t || "").toLowerCase().replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d"*_]/g, "").replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim(); }
function contentWords(t) { return normForMatch(t).split(" ").filter(function (w) { return w.length >= 4 && !/^(that|this|with|from|have|were|their|there|which|when|what|into|than|then|they|them|been|also|only|more|most|such|does|each|over|will|would|could|should|about|after|before|because|while|where)$/.test(w); }); }
// The critic's verdict as the worst gating score. COMPANION-CRITIC-OBJECTION-1: the notes form has no objection section, so its
// objection score is recorded but does not gate. COMPANION-SYSTEMS-ANALYSIS-1 (1.20.0): the systems score gates every form. A grounding
// score under the notes floor is the worst score when every gating dimension passed.
var CRITIC_PRUNE_ROUNDS = 3;
function critiqueWorst(q, form) {
  var dims = form === "notes" ? ["specificity", "argument", "voice", "systems"] : ["specificity", "argument", "objection", "voice", "systems"];
  var worst = 10, worstName = "", missing = false;
  for (var d = 0; d < dims.length; d++) {
    var val = Number(q && q[dims[d]]);
    if (!Number.isFinite(val)) { missing = true; val = 0; }
    if (val < worst) { worst = val; worstName = dims[d]; }
  }
  var groundScore = Number(q && q.grounding);
  if (Number.isFinite(groundScore) && groundScore < ACCEPT_FLOOR_NOTES && worst >= ACCEPT_FLOOR_NOTES) { worst = groundScore; worstName = "grounding"; }
  return { worst: worst, worstName: worstName, missing: missing };
}
// CRITIC-PRUNE-1: the spans the critic quotes in its reason (straight or curly, single or double quotes, at least three words) that the
// draft itself contains, at most three; a quotation of the source that the draft does not contain is ignored.
function criticQuotes(why, text, invented) {
  var out = [], t = normForMatch(text), re = /["\u201c\u2018']([^"\u201c\u201d\u2018\u2019\n]{8,240}?)["\u201d\u2019'](?![a-z])/g, m;
  var take = function (raw) {
    var qq = String(raw || "").replace(/^["\u201c\u2018'\s]+|["\u201d\u2019'\s.]+$/g, "").trim(), n = normForMatch(qq);
    if (n.split(" ").filter(Boolean).length >= 3 && t.indexOf(n) >= 0 && out.indexOf(qq) < 0) out.push(qq);
  };
  // CRITIC-LIST-1 (1.22.2): the critic's list of every invented claim comes first; quotations in its one-sentence reason add to it
  (Array.isArray(invented) ? invented : []).slice(0, CRITIC_INVENTED_MAX).forEach(function (x) { if (typeof x === "string") take(x.slice(0, 300)); });
  while ((m = re.exec(String(why || ""))) && out.length < CRITIC_INVENTED_MAX) take(m[1]);
  return out.slice(0, CRITIC_INVENTED_MAX);
}
// CRITIC-LIST-1 (1.22.2, companion_runs 5620-5627 of 2026-10-13 18:07 UTC): the critic named one invented claim per reading in its one
// sentence, so the critic prune removed one or two sentences a round and the third round still met a fourth invention. The critic now also
// returns every invented claim it found as exact quotations (at most CRITIC_INVENTED_MAX), and one prune round deletes all of them.
// CRITIC-LIST-16-1 (1.26.4, agent_issues 2552; companion_runs 6424-6466 of 2026-10-14 11:00 UTC): every attempt used all three prune rounds
// and was still rejected, and 7 of the 12 rounds removed 8 or more sentences, the list's cap: the critic found more than one round could
// delete. The list takes up to 16 quotations (the critic's reply budget rises with it), so one round removes what a reading found; the
// prune still stops at the repair floor and the two-family fact-check still follows.
var CRITIC_INVENTED_MAX = 16;
// ANALYSIS-RULE-REREAD-1 (1.26.0, agent_issues 2552; companion_runs 6069 of 2026-10-14 06:13 UTC and the grounding-only rejections 5962,
// 5993, 6002): the critic's rubric says that after the <!-- analysis --> line only a concrete invented fact counts under grounding, and that
// claims about incentives, constraints, motives and consequences there are judged under argument and systems, never grounding. The critic
// still scored grounding 0 for "the central mechanism", "feedback loop" and "load-bearing element", every one after the line, while every
// other dimension passed; the critic prune then deleted the analysis the owner asked for. When every passage a grounding rejection quotes
// lies after the line (and the draft already passed the deterministic name, year and figure check), the same critic reads the piece once
// more with its own rule and the quoted passages put back to it. Its new reading stands either way; the two-family fact-check still
// follows. No judge is added and no bar moves: the re-read only asks the judge to apply the rubric it was given.
function quotesAllInAnalysis(piece, quotes) {
  var t = splitText(piece), m = ANALYSIS_MARK_RE.exec(t);
  if (!m || !quotes || !quotes.length) return false;
  var before = normForMatch(t.slice(0, m.index)), after = normForMatch(t.slice(m.index + m[0].length));
  return quotes.every(function (x) { var n = normForMatch(x); return n && after.indexOf(n) >= 0 && before.indexOf(n) < 0; });
}
// GATE-SEPARATION-1 (1.27.0, agent_issues 2552; owner 2026-10-14: "REJECTION RATES ARE UNACCEPTABLY HIGH AND WASTE SYSTEM RESOURCES.
// WHY ZERO PUBLISHED TODAY?"). On 2026-10-14 to 12:07 UTC the companion made 75 compose attempts, 72 were rejected and 0 published; only 4
// drafts ever reached the two-family fact-check. critiqueWorst makes the critic's grounding score the deciding score once every quality
// dimension passes, so a draft the critic judged good enough to publish was thrown away on the critic's grounding opinion before the
// fact-check, the gate built for accuracy (COMPANION-VERIFY-1: deterministic grounding plus two reviewers of other families, with its own
// prune rounds), ever read it. Two LLM layers judged the same property and the stricter one discarded the draft (ENSEMBLE-POLICY: layers
// few, small and disjoint). One judge per property now: the critic gates quality (specificity, argument, objection, voice, systems); its
// grounding score is advisory, and the sentences it quotes as invented are deleted once, deterministically, before the fact-check, which
// gates accuracy as before. ops_config companion_critic_grounding_gate = on restores the old gate without a deploy.
function qualityWorst(q, form) {
  var dims = form === "notes" ? ["specificity", "argument", "voice", "systems"] : ["specificity", "argument", "objection", "voice", "systems"];
  var worst = 10, worstName = "", missing = false;
  for (var d = 0; d < dims.length; d++) {
    var val = Number(q && q[dims[d]]);
    if (!Number.isFinite(val)) { missing = true; val = 0; }
    if (val < worst) { worst = val; worstName = dims[d]; }
  }
  return { worst: worst, worstName: worstName, missing: missing };
}
function gateWorst(q, form, groundingGates) { return groundingGates ? critiqueWorst(q, form) : qualityWorst(q, form); }
async function criticGroundingGates(env) {
  try {
    var r = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'companion_critic_grounding_gate'").first();
    return /^(on|1|true|yes)$/i.test(String(r && r.value || "").trim());
  } catch (e) { logCaught("criticGroundingGates", e); return false; }
}
// CRITIC-QUOTE-SOURCED-1 (1.26.2, agent_issues 2552; companion_runs 6178 of 2026-10-14 08:07 UTC): the critic scored grounding 0 for "The
// emperor fled to Rehe, and Prince Gong stayed to sign the Convention of Peking" as an invented sentence, while the source it was given
// says "The emperor and his entourage fled to Rehe, while Prince Gong stayed to conduct the negotiations, signing the Convention of Peking".
// When every passage a grounding rejection quotes is stated by one source passage (at least SOURCED_COVER of its content words, every
// figure, and the same negation), the same critic reads the piece once more with each quote and the source sentence beside it. Its new
// reading stands either way, and the two-family fact-check still follows: the re-read only shows the judge the evidence it missed.
var SOURCED_COVER = 0.8;
var NEGATION_RE = /\b(?:not|never|no|none|nor|without|neither|cannot)\b|n't\b/i;
function sourceSentences(ground) {
  return String(ground || "").replace(/\\n/g, " ").split(/(?<=[.!?]["')\]\u201d\u2019]*)\s+/).map(function (x) { return x.trim(); }).filter(function (x) { return x.length >= 20; });
}
function sourcedPassage(sents, quote) {
  var qw = contentWords(quote);
  if (qw.length < 3) return null;
  var nums = String(quote).match(/\d[\d,.]*\d|\d/g) || [], neg = NEGATION_RE.test(quote);
  var covered = function (win) {
    var ws = contentWords(win), hit = 0;
    qw.forEach(function (w) { if (ws.some(function (x) { return x === w || (w.length >= 4 && x.length >= 4 && (x.indexOf(w) === 0 || w.indexOf(x) === 0)); })) hit++; });
    return hit / qw.length;
  };
  // one source sentence first, then two adjacent ones (a quote may join them)
  for (var span = 1; span <= 2; span++) {
    for (var i = 0; i + span <= sents.length; i++) {
      var win = sents.slice(i, i + span).join(" ");
      if (covered(win) < SOURCED_COVER) continue;
      if (!nums.every(function (n) { return win.indexOf(n) >= 0; })) continue;
      if (NEGATION_RE.test(win) !== neg) continue;
      return win.slice(0, 400);
    }
  }
  return null;
}
function quotesAllSourced(ground, quotes) {
  if (!quotes || !quotes.length) return null;
  var sents = sourceSentences(ground), out = [];
  for (var i = 0; i < quotes.length; i++) { var src = sourcedPassage(sents, quotes[i]); if (!src) return null; out.push({ quote: quotes[i], source: src }); }
  return out;
}
function sourcedRereadNote(pairs) {
  return "RUBRIC CHECK: your previous reading scored grounding 0 and named these passages as invented, but the source material states each of them: " + pairs.map(function (p) { return "\"" + String(p.quote).slice(0, 200) + "\" (source: \"" + String(p.source).slice(0, 300) + "\")"; }).join("; ") + ". A passage the source material states is grounded even when its wording differs; compare each with its source sentence, including names, figures and negation. Read the piece again and score every dimension; list under invented only claims the source material does not state.";
}
function rubricNoQuoteNote() {
  return "RUBRIC CHECK: your previous reading scored grounding 0 but quoted no passage of the piece as invented. Grounding counts only a claim the piece makes that the source material does not support; a source detail the piece leaves out is not a grounding failure. Read the piece again: list under invented each claim you judge unsupported as an exact quotation copied from the piece, and score grounding 0 only if you can quote one.";
}
function rubricRereadNote(quotes) {
  return "RUBRIC CHECK: your previous reading scored grounding 0 for these passages, and every one of them is after the <!-- analysis --> line: " + quotes.map(function (x) { return "\"" + String(x).slice(0, 200) + "\""; }).join("; ") + ". Your rubric for that section: count under grounding only a concrete invented fact (a name, date, number, event, rule, quotation or study the source material does not contain); claims about incentives, constraints, motives, mechanisms and consequences are judged under argument and systems, never grounding. Read the piece again and score every dimension under that rule; list under invented only concrete invented facts.";
}

// CRITIC-TODAY-1 (1.23.1, companion_runs 5744 and 5753 of 2026-10-13 22:04 UTC): the critic called a club's "2026 Serie A2" title and "2023
// Serie D" result fabricated because "the source material explicitly lists [them] as future-dated or unoccurred": its training ends before
// today, so a recent date the source states read as invented. The critic and the fact-check reviewers are told today's date.
function todayLine(now) { return "TODAY: " + new Date(now || Date.now()).toISOString().slice(0, 10) + ". The source material can report events up to today; a date or result is not invented because it is recent or later than you know of. Judge it only against the source material."; }
// REFRAME-REPAIR-1 (1.23.0, companion_runs 5699-5731 of 2026-10-13 21:00 UTC; agent_issues 2222): with the analysis split holding (36-57%),
// all five drafts were still rejected because the writer stated motives, mechanisms and reward systems as facts ("intended to signal
// toughness", "feedback loop", "governor-legislator reward systems ... presented as facts"). The critic prune can only delete such
// sentences, which strips the analysis the reader asked for, and each fresh draft invented anew. On the first critic rejection for grounding
// or argument, one editor call (the writer's family at a judge's temperature, never the critic's first family) rewrites each flagged
// sentence in place: a motive, cause, mechanism or likely behaviour the sources do not state becomes explicit reasoning; an event, action,
// payment or statement they do not contain is deleted; nothing new is added. The edit is kept only when it passes the validation every
// repaired draft passes (names, years and figures in the sources, floors, lede), stays within REFRAME_BAND of the draft's length, keeps
// its headings and its analysis line as they were, and the critic's new reading is no worse. The critic prune and the two-family fact-check
// follow unchanged.
var REFRAME_BAND = [0.85, 1.15], REFRAME_TIMEOUT_MS = 12e4, REFRAME_START_BEFORE_MS = 54e4;
var P_REFRAME = L(
  "You are a copy editor. A reader rejected the DRAFT below because some of its sentences present as fact what the SOURCE MATERIAL does not say. Return the whole draft, edited, as plain markdown in the same layout: the first line is # and the title, then the lede paragraph with no heading, then the body with its ## headings in the same order. If the draft has a line that contains exactly <!-- analysis -->, keep that line where it is; if it has none, add none.",
  "Edit sentence by sentence:",
  "1. Change only the sentences listed under FLAGGED and the claims the READER'S OBJECTION describes. Every other sentence stays word for word.",
  "2. A changed sentence that states as fact a motive, intention, incentive, cause, effect, mechanism, strategy, feedback loop, pattern or likely behaviour that the SOURCE MATERIAL does not state is rewritten in place as an argument from a reported fact: name the fact it starts from and say what follows from it as reasoning ('Because ..., ... has a reason to ...', 'If ..., then ...', 'That would leave ... paying for ...', 'This suggests ...'). Vary the wording: never open two sentences the same way, and never put more than one hedge in a paragraph. Keep the substance and the force of the argument; a string of hedges is worse than the original.",
  "3. A sentence that reports an event, action, statement, payment, meeting, document, rule or arrangement that the SOURCE MATERIAL does not contain is deleted.",
  "4. Every sentence listed under FLAGGED, and every claim the READER'S OBJECTION describes, is fixed by rule 2 or rule 3.",
  "5. Add nothing: no name, date, number, quotation, event, example or source that is not already in the DRAFT and the SOURCE MATERIAL. Keep the title, every heading and the first sentence of the lede. Keep the length within a tenth of the draft's.",
  "Output only the edited draft: no commentary, no list of changes, no code fences."
);
// the markdown a writer or editor returns, read the way composePiece reads it: optional code fence, "# title", lede paragraph, body
function parseDraftMd(text, fallbackTitle) {
  var md = String(text || "").trim();
  if (md.indexOf("```") === 0) {
    var f = md.indexOf(NL);
    if (f > 0) md = md.slice(f + 1);
    var close = md.lastIndexOf("```");
    if (close > 0) md = md.slice(0, close);
    md = md.trim();
  }
  var title = "", lines = md.split(NL);
  if (lines.length && lines[0].trim().indexOf("# ") === 0) { title = lines[0].trim().slice(2).trim(); md = lines.slice(1).join(NL).trim(); }
  var ledeObj = extractLede(md);
  return { title: String(title || fallbackTitle || "").slice(0, 300), lede: ledeObj.lede, body_md: ledeObj.rest, objection: findObjection(md) };
}
async function reframePiece(env, piece, ground, why, invented) {
  var lede = String(piece && piece.lede || "").trim(), body = String(piece && piece.body_md || "");
  var draft = "# " + String(piece && piece.title || "") + NL + NL + (lede && body.indexOf(lede) < 0 ? lede + NL + NL : "") + body;
  var flagged = criticQuotes(why, pieceText(piece), invented);
  var user = "SOURCE MATERIAL:" + NL + String(ground || "").slice(0, GROUND_MAX + 2000) + NL + NL + "READER'S OBJECTION: " + String(why || "").slice(0, 1200) + NL + NL +
    "FLAGGED:" + NL + (flagged.length ? flagged.map(function (x) { return "- " + x; }).join(NL) : "(none quoted; fix what the objection describes)") + NL + NL + "DRAFT:" + NL + draft.slice(0, 3e4);
  var r = await callModel(env, [{ role: "system", content: P_REFRAME }, { role: "user", content: user }], GEN_MAX_TOKENS, REFRAME_TIMEOUT_MS, WRITER_MODEL, "editor");
  if (!r || !r.text) return { piece: null, why: "editor unavailable" + (r && r.error ? ": " + String(r.error).slice(0, 120) : "") };
  var p = parseDraftMd(r.text, piece.title);
  var out = { title: p.title || piece.title, subtitle: piece.subtitle || "", lede: p.lede, body_md: p.body_md, objection: p.objection || piece.objection };
  var w0 = pieceWords(piece), w1 = pieceWords(out);
  if (!w0 || w1 < w0 * REFRAME_BAND[0] || w1 > w0 * REFRAME_BAND[1]) return { piece: null, why: "edit length " + w1 + " of " + w0 + " words" };
  if (countHeadings(out.body_md, 2) !== countHeadings(body, 2)) return { piece: null, why: "edit changed the headings (" + countHeadings(out.body_md, 2) + " of " + countHeadings(body, 2) + ")" };
  // REFRAME-REMARK-1 (1.23.4, companion_runs 5806, 5811, 5816 of 2026-10-14 00:03-00:10 UTC: three of four edits were refused because the
  // editor dropped the analysis line): a dropped line is placed again by the auto-mark rule (the first reasoning paragraph, third or later,
  // where the rails hold); the edit is refused only when no paragraph holds them
  var note = "";
  if (ANALYSIS_MARK_RE.test(draft) && !ANALYSIS_MARK_RE.test(splitText(out))) {
    out = withAutoMark(out);
    if (!analysisSplitOk(splitText(out))) return { piece: null, why: "edit dropped the analysis line and no paragraph holds the rails" };
    note = ", analysis line placed again";
  }
  if (ANALYSIS_MARK_RE.test(draft) !== ANALYSIS_MARK_RE.test(splitText(out))) return { piece: null, why: ANALYSIS_MARK_RE.test(draft) ? "edit dropped the analysis line" : "edit added an analysis line" };
  return { piece: out, model: r.model, why: w0 + " -> " + w1 + " words, " + flagged.length + " flagged" + note };
}
// HEADING-LABEL-1 (1.28.1, agent_issues 2552; companion_runs 6525 of 2026-10-14 13:13 UTC, Bush v. Gore): the first 1.27.0 draft to reach
// the fact-check lost 36 sentences to five prune rounds and was still rejected, two of its last four items being section headings ("The
// clock as the real decision-maker -- heading introduces new framing not in source"). A heading line is never a sentence unit, so no
// round could remove it. The fact prune (opts.headings) now deletes a "## " heading whose text a FACT item quotes, and the section joins
// the one before it; the reviewers are told a heading is a label (listed only when it states a specific unsupported fact), and a reason
// that calls an item framing reads as interpretation. The title is never deleted, and the inference prune leaves headings alone.
function pruneHeadings(piece, needles) {
  var removed = [];
  var body = String(piece && piece.body_md || "").split("\n").filter(function (line) {
    var h = line.match(/^\s*#{2,6}\s+(.+?)\s*#*\s*$/);
    if (!h) return true;
    var nh = normForMatch(h[1]).slice(0, 90);
    if (nh.length < 12) return true;
    var n = needles.filter(function (x) { return !x.hit && (x.nd === nh || nh.indexOf(x.nd) === 0 || x.nd.indexOf(nh) === 0); })[0];
    if (!n) return true;
    n.hit = true; removed.push(line.trim());
    return false;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return removed.length ? { piece: Object.assign({}, piece, { body_md: body }), removed: removed } : { piece: piece, removed: [] };
}
function pruneUnsupported(piece, problems, opts) {
  var needles = [];
  (problems || []).forEach(function (pr) {
    var m = String(pr).match(/^unsupported claim:\s*([\s\S]*?)(?:\s+--\s+[\s\S]*)?$/);
    if (!m) return;
    var raw = m[1].replace(/^\s*(?:FACT|INFERENCE)\s*:\s*/i, ""), q = normForMatch(raw);
    if (q.length >= 18) needles.push({ nd: q.slice(0, 90), raw: raw, hit: false });
  });
  if (!needles.length) return { piece: piece, removed: [], total: 0 };
  if (opts && opts.headings) {
    var ph = pruneHeadings(piece, needles);
    if (ph.removed.length) {
      var rest = needles.filter(function (n) { return !n.hit; });
      var rs = rest.length ? pruneUnsupported(ph.piece, rest.map(function (n) { return "unsupported claim: " + n.raw; })) : { piece: ph.piece, removed: [], total: 0 };
      return { piece: rs.piece, removed: ph.removed.concat(rs.removed), total: rs.total, headings: ph.removed.length };
    }
  }
  return deleteSentences(piece, function (units) {
    units.forEach(function (x) {
      var ns = normForMatch(x.sn);
      needles.forEach(function (n) {
        var hit = ns.indexOf(n.nd.slice(0, Math.min(n.nd.length, 60))) >= 0 || (ns.length >= 30 && n.nd.indexOf(ns.slice(0, Math.min(ns.length, 60))) >= 0);
        if (hit) { x.cut = true; n.hit = true; }
      });
    });
    needles.forEach(function (n) {
      if (n.hit) return;
      var want = contentWords(n.raw);
      if (want.length < FUZZY_MIN_SHARED) return;
      var best = null, bestShared = 0;
      units.forEach(function (x) {
        if (x.cut) return;
        var have = contentWords(x.sn), shared = want.filter(function (w) { return have.indexOf(w) >= 0; }).length;
        if (shared > bestShared) { bestShared = shared; best = x; }
      });
      if (best && bestShared >= FUZZY_MIN_SHARED && bestShared / want.length >= FUZZY_MIN_SHARE) { best.cut = true; n.hit = true; }
    });
  });
}
__name(repairGroundingDraft, "repairGroundingDraft");
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
  } catch (e) { logCaught("similarExists", e); }
  return null;
}
__name(similarExists, "similarExists");
__name2(similarExists, "similarExists");
__name22(similarExists, "similarExists");
async function emitReadingSignal(env, piece, form, slug) {
  try {
    if (!env.AUDIT) return;
    var body = String(piece.body_md || "");
    var paras = body.split("\n").map(function(l) {
      return l.trim();
    }).filter(function(l) {
      return l.length > 80;
    });
    var openQ = paras.length ? paras[paras.length - 1].slice(0, 400) : "";
    await env.AUDIT.prepare(
      "INSERT OR IGNORE INTO signals (id, ts, source, source_ref, content, open_questions, evidential_weight, domain, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      "reading:" + slug,
      nowIso(),
      "reading",
      "https://reading.q08.org/p/" + slug,
      String(piece.title || "").slice(0, 300),
      JSON.stringify([openQ]),
      0.55,
      "fleet",
      "open",
      nowIso()
    ).run();
  } catch (e) { logCaught("emitReadingSignal", e); }
}
__name(emitReadingSignal, "emitReadingSignal");
async function persistPiece(env, piece, form, topic, model, quality, words, ground) {
  piece = stripPieceMark(piece); // ANALYSIS-SPLIT-1: the analysis line is never stored, shown or mailed
  var day = amsDayKey(/* @__PURE__ */ new Date());
  var salt = String(Date.now()) + topic.id + form;
  var slug = day + "-" + form + "-" + await sha16(salt);
  var anchorJson = JSON.stringify({ topic: topic.id, seam: [topic.a, topic.b].filter(Boolean), refs: (topic.anchors || []).map(function (a) { return a.ref; }) });
  await env.PERSONAL.prepare(
    "INSERT OR IGNORE INTO companion_pieces(slug, form, title, subtitle, lede, body_md, anchor_json, quality_json, word_count, day, created_at, ground_text) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(slug, form, String(piece.title).slice(0, 300), String(piece.subtitle || "").slice(0, 300), String(piece.lede || "").slice(0, 2e3), String(piece.body_md), anchorJson, JSON.stringify(quality || {}), words, day, nowIso(), String(ground || "")).run();
  emitReadingSignal(env, piece, form, slug).catch(function (eLog) { logCaught("persistPiece", eLog); });
  try {
    var vecs = await embed(env, [String(piece.title) + NL + String(piece.lede || "") + NL + String(piece.body_md).slice(0, 5e3)]);
    if (vecs.length && env.VZ) {
      await env.VZ.upsert([{
        id: "companion-" + slug,
        values: vecs[0],
        metadata: { kind: "companion-piece", slug, form, title: String(piece.title).slice(0, 200), day }
      }]);
    }
  } catch (e) { logCaught("persistPiece", e); }
  try {
    await env.MEDIA.put("companion/" + day + "/" + slug + ".md", String(piece.body_md), {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" }
    });
  } catch (e) { logCaught("persistPiece", e); }
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
__name2(persistPiece, "persistPiece");
__name22(persistPiece, "persistPiece");
async function logRun(env, form, model, topic, status, detail, ms) {
  try {
    await env.PERSONAL.prepare(
      "INSERT INTO companion_runs(run_at, form, model, topic, status, detail, ms) VALUES(?,?,?,?,?,?,?)"
    ).bind(nowIso(), form, String(model || ""), String(topic || ""), status, String(detail || "").slice(0, 1200), ms).run();
  } catch (e) { logCaught("logRun", e); }
}
__name(logRun, "logRun");
__name2(logRun, "logRun");
__name22(logRun, "logRun");
async function sendMail(env, piece, slug, day) {
  // COMPANION-VERIFY-1: nothing is mailed, to the owner or to subscribers, unless the piece passed the accuracy audit (fail closed).
  if (!(await pieceVerified(env, slug))) return { ok: false, error: "piece not verified, nothing mailed (fail closed)" };
  var subject = piece.title + " (" + formLabel(piece.form || "essay") + ")";
  var body = (/^\s*#/.test(String(piece.body_md || "")) ? "" : piece.lede ? plainCredit(piece.lede) + NL + NL : "") + plainCredit(String(piece.body_md).slice(0, 2e4)) + NL + NL + "Read online: " + String(piece.link || "");
  // MAIL-SUPPRESSION-1 (2026-10-17): rwnquni@outlook.com is listed in BOTH email_suppression and
  // contact_ledger, so sendOne() returned {suppressed:true} and every owner reading was dropped
  // silently while the send was logged as fine. Owner mail goes through the owner-notice path,
  // which bypasses suppression by design and still honours calendar_meta owner_notice_enabled.
  return await sendOwnerNotice(env, subject, body, "reading");
}
__name(sendMail, "sendMail");
__name2(sendMail, "sendMail");
__name22(sendMail, "sendMail");
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
__name2(mailOut, "mailOut");
__name22(mailOut, "mailOut");
async function sendOne(env, to, subject, body, pre) {
  // BROADCAST-BATCH-1 (1.12.2): a caller that already read the opt-out lists for a batch passes them (pre.checked, pre.set),
  // so a broadcast spends no per-recipient lookups.
  if (pre && pre.checked) { if (pre.set.has(String(to).toLowerCase())) return { ok: false, suppressed: true, to: to }; }
  // SUPPRESSION-1 (2026-09-22): honour opt-out stored in qnfo-audit before any direct send.
  else try { if (env.AUDIT) { const _s = await env.AUDIT.prepare("SELECT 1 FROM email_suppression WHERE lower(email)=?1").bind(String(to).toLowerCase()).first(); if (_s) return { ok: false, suppressed: true, to: to }; const _l = await env.AUDIT.prepare("SELECT suppress FROM contact_ledger WHERE lower(email)=?1").bind(String(to).toLowerCase()).first(); if (_l && _l.suppress) return { ok: false, suppressed: true, to: to }; } } catch (e) { logCaught("sendOne", e); }
  var listHeaders = pre && pre.unsub ? { "List-Unsubscribe": "<" + pre.unsub + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : null;
  if (env.SEND_EMAIL) {
    try {
      var sendPayload = { to, from: "rowan.quni@qnfo.org", subject, text: body };
      if (listHeaders) sendPayload.headers = listHeaders;
      await env.SEND_EMAIL.send(sendPayload);
      return { ok: true, via: "send_email" };
    } catch (e) {
      return { ok: false, error: "send_email: " + String(e && e.message || e) };
    }
  }
  if (!env.EMAIL) return { ok: false, error: "no email path" };
  try {
    var emailPayload = { to, from: "rowan.quni@qnfo.org", subject, body };
    if (listHeaders) emailPayload.headers = listHeaders;
    var resp = await env.EMAIL.fetch("https://email.internal/send", {
      method: "POST",
      // EMAIL-CALLER-PROPS-1 (#1923): qnfo-email 2.5.1+ authenticates this binding by its props (wrangler.toml); no key copy.
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload)
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
__name(sendOne, "sendOne");
__name2(sendOne, "sendOne");
__name22(sendOne, "sendOne");
function subBase(env, origin) {
  return origin || "https://reading.q08.org";
}
__name(subBase, "subBase");
__name2(subBase, "subBase");
__name22(subBase, "subBase");
function escXml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
__name(escXml, "escXml");
__name2(escXml, "escXml");
__name22(escXml, "escXml");
function toRfc822(d) {
  try {
    return new Date(d).toUTCString();
  } catch (e) {
    return (/* @__PURE__ */ new Date()).toUTCString();
  }
}
__name(toRfc822, "toRfc822");
__name2(toRfc822, "toRfc822");
__name22(toRfc822, "toRfc822");
function subscribePage(msg) {
  var Q = String.fromCharCode(34);
  return "<div class=sub>" + (msg ? "<p>" + escHtml(msg) + "</p>" : "") + "<form method=post action=/subscribe><input type=email name=email placeholder=" + Q + "you@example.com" + Q + " required><button type=submit>Subscribe</button></form><p class=mut>One email per new piece. Unsubscribe anytime.</p></div>";
}
__name(subscribePage, "subscribePage");
__name2(subscribePage, "subscribePage");
__name22(subscribePage, "subscribePage");
async function handleSubscribe(request, env, u, p) {
  try {
    await ensureSchema(env);
  } catch (e) { logCaught("handleSubscribe", e); }
  if (p === "/confirm") {
    var t0 = u.searchParams.get("t") || "";
    await env.PERSONAL.prepare("UPDATE companion_subscribers SET status = 'confirmed', confirmed_at = ? WHERE token = ? AND status != 'unsubscribed'").bind(nowIso(), t0).run();
    return html(page("Confirmed", shell(subscribePage("You are subscribed. Thank you."))));
  }
  if (p === "/unsubscribe") {
    var t1 = u.searchParams.get("t") || "";
    await env.PERSONAL.prepare("UPDATE companion_subscribers SET status = 'unsubscribed' WHERE token = ?").bind(t1).run();
    return html(page("Unsubscribed", shell(subscribePage("You have been unsubscribed."))));
  }
  var email = "";
  try {
    var ct = request.headers.get("Content-Type") || "";
    if (ct.indexOf("application/json") >= 0) {
      var b = await request.json();
      email = b && b.email || "";
    } else if (ct.indexOf("form") >= 0) {
      var fd = await request.formData();
      email = fd.get("email") || "";
    }
  } catch (e) { logCaught("handleSubscribe", e); }
  email = String(email || u.searchParams.get("email") || "").trim().toLowerCase();
  if (!email) {
    return html(page("Subscribe", shell("<h2>Subscribe</h2>" + subscribePage(""))));
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return html(page("Subscribe", shell("<h2>Subscribe</h2>" + subscribePage("Enter a valid email address."))), 400);
  }
  var token = await sha16(email + ":" + (env.COMPANION_KEY || "pc") + ":sub");
  await env.PERSONAL.prepare("INSERT INTO companion_subscribers(email, status, token, created_at) VALUES(?, 'pending', ?, ?) ON CONFLICT(email) DO UPDATE SET token = excluded.token, status = CASE WHEN status = 'confirmed' THEN 'confirmed' ELSE 'pending' END").bind(email, token, nowIso()).run();
  var link = subBase(env, u.origin) + "/confirm?t=" + token;
  await sendOne(env, email, "Confirm your subscription", "Tap to confirm: " + link);
  return html(page("Subscribe", shell("<h2>Almost there</h2>" + subscribePage("Check your inbox for a confirmation link."))));
}
__name(handleSubscribe, "handleSubscribe");
__name2(handleSubscribe, "handleSubscribe");
__name22(handleSubscribe, "handleSubscribe");
async function feedXml(env, u) {
  try {
    await ensureSchema(env);
  } catch (e) { logCaught("feedXml", e); }
  var q = await env.PERSONAL.prepare("SELECT slug, title, lede, day, created_at FROM companion_pieces WHERE " + VISIBLE_SQL + " ORDER BY id DESC LIMIT 30").all();
  var rows = q.results || [];
  var base = subBase(env, u.origin);
  var items = "";
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var link = base + "/p/" + r.slug;
    items += "<item><title>" + escXml(r.title) + "</title><link>" + link + "</link><guid>" + link + "</guid><pubDate>" + toRfc822(r.created_at || r.day) + "</pubDate><description>" + escXml(String(r.lede || "").slice(0, 400)) + "</description></item>";
  }
  var Q = String.fromCharCode(34);
  var xml = "<?xml version=" + Q + "1.0" + Q + " encoding=" + Q + "UTF-8" + Q + "?><rss version=" + Q + "2.0" + Q + "><channel><title>Reading</title><link>" + base + "</link><description>Written for one reader. Shared with anyone who wants to follow along.</description>" + items + "</channel></rss>";
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
__name(feedXml, "feedXml");
__name2(feedXml, "feedXml");
__name22(feedXml, "feedXml");
// ---- BROADCAST-BATCH-1 (1.12.2, agent_issues 2042) ----
// A send run reads at most SEND_CAP_PER_RUN confirmed subscribers after the run's cursor, reads their opt-outs in batches of
// SUPP_CHUNK (email_suppression and contact_ledger.suppress, two queries per batch), sends, and stores the cursor in
// companion_broadcasts (key = piece slug, or "digest:<day>"). The hourly tick resumes an unfinished run. If the opt-out read
// fails the run stops before any send (fail closed) and the cursor stays, so the next tick retries.
var SEND_CAP_PER_RUN = 250;
var SUPP_CHUNK = 50;
async function suppressedSet(env, emails) {
  var set = new Set();
  if (!env.AUDIT) return set;
  var list = emails.map(function (e) { return String(e).toLowerCase(); });
  for (var i = 0; i < list.length; i += SUPP_CHUNK) {
    var chunk = list.slice(i, i + SUPP_CHUNK), ph = chunk.map(function () { return "?"; }).join(",");
    var s1 = env.AUDIT.prepare("SELECT lower(email) AS e FROM email_suppression WHERE lower(email) IN (" + ph + ")");
    var r1 = await s1.bind.apply(s1, chunk).all();
    var s2 = env.AUDIT.prepare("SELECT lower(email) AS e FROM contact_ledger WHERE suppress AND lower(email) IN (" + ph + ")");
    var r2 = await s2.bind.apply(s2, chunk).all();
    ((r1 && r1.results) || []).concat((r2 && r2.results) || []).forEach(function (r) { set.add(String(r.e)); });
  }
  return set;
}
async function ensureSendRuns(env) {
  await env.PERSONAL.prepare("CREATE TABLE IF NOT EXISTS companion_broadcasts (key TEXT PRIMARY KEY, last_id INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, suppressed INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, origin TEXT, started_at TEXT, updated_at TEXT)").run();
}
async function sendRunState(env, key, origin) {
  await ensureSendRuns(env);
  await env.PERSONAL.prepare("INSERT OR IGNORE INTO companion_broadcasts (key, origin, started_at, updated_at) VALUES (?1, ?2, ?3, ?3)").bind(key, origin || null, nowIso()).run();
  return await env.PERSONAL.prepare("SELECT * FROM companion_broadcasts WHERE key = ?1").bind(key).first();
}
async function sendRun(env, key, origin, mailFor) {
  var st = await sendRunState(env, key, origin);
  if (st && st.done) return { ok: true, key: key, done: true, already: true, sent: 0, failed: 0, suppressed: 0 };
  var last = st ? Number(st.last_id) || 0 : 0;
  var q = await env.PERSONAL.prepare("SELECT id, email, token FROM companion_subscribers WHERE status = 'confirmed' AND id > ?1 ORDER BY id LIMIT " + SEND_CAP_PER_RUN).bind(last).all();
  var rows = (q && q.results) || [];
  var supp;
  try { supp = await suppressedSet(env, rows.map(function (r) { return r.email; })); }
  catch (e) { return { ok: false, key: key, error: "opt-out lists unreadable, nothing sent (fail closed): " + String(e && e.message || e).slice(0, 120), resume: true }; }
  var sent = 0, failed = 0, suppressed = 0;
  for (var i = 0; i < rows.length; i++) {
    var m = mailFor(rows[i]);
    var rr = await sendOne(env, rows[i].email, m.subject, m.body, { checked: true, set: supp, unsub: m.unsub });
    if (rr && rr.ok) sent++;
    else if (rr && rr.suppressed) suppressed++;
    else failed++;
    last = rows[i].id;
  }
  var done = rows.length < SEND_CAP_PER_RUN ? 1 : 0;
  await env.PERSONAL.prepare("UPDATE companion_broadcasts SET last_id = ?1, sent = sent + ?2, failed = failed + ?3, suppressed = suppressed + ?4, done = ?5, updated_at = ?6 WHERE key = ?7").bind(last, sent, failed, suppressed, done, nowIso(), key).run();
  return { ok: true, key: key, sent: sent, failed: failed, suppressed: suppressed, batch: rows.length, done: !!done, resume: !done };
}
function digestMail(day, list, base) {
  return function (s) {
    var unsub = base + "/unsubscribe?t=" + s.token;
    return { subject: "Reading \u2014 daily digest", body: "Reading \u2014 daily digest (" + day + ")" + NL + NL + list + NL + NL + "Unsubscribe: " + unsub, unsub: unsub };
  };
}
async function digestList(env, day, base) {
  var pr = await env.PERSONAL.prepare("SELECT slug, title, form FROM companion_pieces WHERE day = ? AND " + VISIBLE_SQL + " ORDER BY id ASC").bind(day).all();
  var rows = pr.results || [];
  return { n: rows.length, list: rows.map(function (r) { return "- " + r.title + " \u2014 " + base + "/p/" + r.slug; }).join(NL) };
}
function pieceMail(prow, base, link) {
  return function (s) {
    var unsub = base + "/unsubscribe?t=" + s.token;
    return { subject: prow.title, body: (/^\s*#/.test(String(prow.body_md || "")) ? "" : prow.lede ? prow.lede + NL + NL : "") + String(prow.body_md).slice(0, 2e4) + NL + NL + "Read online: " + link + NL + NL + "Unsubscribe: " + unsub, unsub: unsub };
  };
}
// The hourly tick continues the oldest unfinished run (one per tick, so a tick never sends more than SEND_CAP_PER_RUN).
async function resumeSendRuns(env) {
  // the tick creates the cursor table, so the resume read never meets a missing table and the table's presence shows 1.12.2 runs
  await ensureSendRuns(env);
  var t = await env.PERSONAL.prepare("SELECT key, origin FROM companion_broadcasts WHERE done = 0 ORDER BY started_at LIMIT 1").first();
  if (!t) return { ok: true, idle: true };
  var base = "https://reading.q08.org";
  if (String(t.key).indexOf("digest:") === 0) {
    var day = String(t.key).slice(7), dl = await digestList(env, day, base);
    return await sendRun(env, t.key, null, digestMail(day, dl.list, base));
  }
  var pr = await env.PERSONAL.prepare("SELECT * FROM companion_pieces WHERE slug = ?").bind(t.key).all();
  var prow = (pr.results || [])[0];
  if (!prow) { await env.PERSONAL.prepare("UPDATE companion_broadcasts SET done = 1, updated_at = ?1 WHERE key = ?2").bind(nowIso(), t.key).run(); return { ok: false, key: t.key, error: "piece gone; run closed" }; }
  if (!(await pieceVerified(env, t.key))) { await env.PERSONAL.prepare("UPDATE companion_broadcasts SET done = 1, updated_at = ?1 WHERE key = ?2").bind(nowIso(), t.key).run(); return { ok: false, key: t.key, error: "piece not verified or retracted; run closed (fail closed)" }; }
  var b2 = subBase(env, t.origin);
  return await sendRun(env, t.key, t.origin, pieceMail(prow, b2, b2 + "/p/" + t.key));
}
// ---- BROADCAST-BATCH-1 end ----
// PERSONAL-RESILIENCE-1: confirmed subscribers, paged by id (the old single LIMIT 500 silently dropped everyone after the 500th).
async function confirmedSubscribers(env) {
  var all = [], last = 0;
  for (var page = 0; page < 40; page++) {
    var q = await env.PERSONAL.prepare("SELECT id, email, token FROM companion_subscribers WHERE status = 'confirmed' AND id > ?1 ORDER BY id LIMIT 500").bind(last).all();
    var rows = (q && q.results) || [];
    for (var i = 0; i < rows.length; i++) all.push(rows[i]);
    if (rows.length < 500) break;
    last = rows[rows.length - 1].id;
  }
  return all;
}
async function broadcast(env, slug, origin) {
  if (!env.EMAIL) return { ok: false, error: "no email binding" };
  try {
    var pr = await env.PERSONAL.prepare("SELECT * FROM companion_pieces WHERE slug = ?").bind(slug).all();
    var prow = (pr.results || [])[0];
    if (!prow) return { ok: false, error: "no piece" };
    if (!(await pieceVerified(env, slug))) return { ok: false, error: "piece not verified, nothing mailed (fail closed)" };
    // BROADCAST-BATCH-1: one capped, resumable run per piece; the hourly tick sends the rest.
    var base = subBase(env, origin);
    return await sendRun(env, slug, base, pieceMail(prow, base, base + "/p/" + slug));
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
__name(broadcast, "broadcast");
__name2(broadcast, "broadcast");
__name22(broadcast, "broadcast");
async function sendDigest(env) {
  if (!env.EMAIL) return { ok: false, error: "no email binding" };
  try {
    var day = amsDayKey(/* @__PURE__ */ new Date());
    var base = "https://reading.q08.org";
    var dl = await digestList(env, day, base);
    if (!dl.n) return { ok: true, skipped: "no pieces today", pieces: 0 };
    // BROADCAST-BATCH-1: one capped, resumable run per day ("digest:<day>"); the hourly tick sends the rest.
    var out = await sendRun(env, "digest:" + day, null, digestMail(day, dl.list, base));
    out.pieces = dl.n;
    return out;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
__name(sendDigest, "sendDigest");
__name2(sendDigest, "sendDigest");
__name22(sendDigest, "sendDigest");
// ---- Accuracy layer (COMPANION-VERIFY-1, 1.14.0; pattern ported from q08-signal-engine Q08-VERIFY-1) -------------------------
// Owner directive 2026-10-10: published content is 100% accurate and independently fact-checked, every claim verifiable against
// the supplied source text; if a check or reviewer is unavailable nothing is published. A piece becomes visible (site, feed,
// API) and mailable (owner, subscribers, digest) only when companion_audits holds a 'pass' row for it, and that row is written
// only after (1) the deterministic grounding check (every capitalised name, year and figure occurs in the source material) and
// (2) two reviewers from model families other than the writer's found no unsupported claim. A piece that later fails the same
// test is retracted in public (companion_retractions: 410 notice, gone from index, feed, API and mail). Reversible by deleting
// the companion_retractions row.
var REVIEW_MAX_TOKENS = 8000; // COMPANION-FACTCHECK-POOL-1: reasoning reviewers spent 4000 before any verdict; banned small models stay banned
var REVIEW_TIMEOUT_MS = 11e4;
var MODEL_FAMILY = {
  "@cf/nvidia/nemotron-3-120b-a12b": "nvidia",
  "@cf/openai/gpt-oss-120b": "openai",
  "@cf/moonshotai/kimi-k2.6": "moonshot",
  "@cf/deepseek-ai/deepseek-v4-pro-0813": "deepseek",
  "@cf/zai-org/glm-5.3": "zai",
  "deepseek-chat": "deepseek",
  "deepseek-reasoner": "deepseek"
};
// Reviewers, non-reasoning first so that a verdict does not spend its whole budget thinking. Banned models stay banned.
var REVIEW_POOL = [
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/openai/gpt-oss-120b",
  "@cf/moonshotai/kimi-k2.6",
  "@cf/deepseek-ai/deepseek-v4-pro-0813",
  "@cf/zai-org/glm-5.3"
];
function familyOf(id) { return MODEL_FAMILY[id] || "unknown:" + String(id || "").split("/")[1]; }
function seedOf(str) { var h = 0, t = String(str || ""); for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return Math.abs(h); }
// Up to k reviewers, one per family, none from the family in `exclude`; the start rotates with `seed`.
function pickReviewers(exclude, k, seed) {
  var ex = {}; (exclude || []).forEach(function (f) { ex[f] = 1; });
  var n = REVIEW_POOL.length, start = Math.abs(seed | 0) % n, out = [], seen = {};
  for (var i = 0; i < n && out.length < k; i++) {
    var id = REVIEW_POOL[(start + i) % n], f = familyOf(id);
    if (ex[f] || seen[f] || !modelAllowed(id)) continue;
    seen[f] = 1; out.push(id);
  }
  return out;
}
var GROUND_LEAD = new Set(["the","a","an","in","on","at","when","if","but","and","so","as","that","this","these","those","it","its","each","every","most","some","no","for","with","without","before","after","once","while","because","since","what","where","who","why","how","then","there","here","not","only","even","still","yet","or","nor","by","from","to","of","their","his","her","our","your","one","two","three","such","both","many","any","all","i","we","you","he","she","they","my","whether","although","though","until","unless","instead","perhaps","suppose","imagine","consider","now","today","later","earlier","first","second","third","finally","meanwhile","however","which","whose","than","also","just","every","another","other","either","neither","same","more","less","few","several","unlike","like","despite","across","through","during","under","over","between","among","within","against","beyond","per","via","consequently","therefore","thus","hence","moreover","furthermore","similarly","likewise","otherwise","accordingly","additionally","specifically","ultimately","eventually","typically","usually","often","sometimes","rather","indeed","western","eastern","northern","southern","central"]);
var GROUND_OK = new Set(["january","february","march","april","may","june","july","august","september","october","november","december","monday","tuesday","wednesday","thursday","friday","saturday","sunday","arxiv","wikipedia","markdown","json","html","gpu","cpu","vpn","api","ai","llm","sdk","ceo","cto","url","dns","pdf","csv","sql","usb","ram","ssd","gps","ui","ux","os",
  // GROUND-DESCRIPTOR-1: title and street abbreviations are words, not names ("St.", "Mt.", "Dr." were rejected as names not in the source)
  "st","mt","dr","mr","mrs","ms","prof","jr","sr","vol","no","ft","ave","rd","blvd","inc","ltd","co","fig","vs","etc","al"]);
// GROUND-DESCRIPTOR-1 (1.16.1, issues 2222/2354): a capitalised single word shaped like a nationality, regional or derived adjective
// ("American", "Midwestern", "Archival", "Victorian") describes, it does not name an entity; runs 5128-5134 rejected five drafts of one
// topic for "American" and "Midwestern" alone (5131 had no other problem). Such a word is left to the two-family fact-check like
// acronyms are. A multi-word name is still checked word by word, so "American Planning Association" absent from the source still fails.
var GROUND_DESCRIPTOR_RE = /^(?:[a-z]{3,}(?:an|ian|ern|ese|ic|ist)|[a-z]{2,}ish|[a-z]{4,}al)$/; // GROUND-MATCHER-2: "Irish" (2 letters before -ish)
// A word whose stem the source contains is grounded ("archival" from "archive", "american" from "america", "midwestern" from "midwest").
function stemGrounded(w, words) {
  var stems = [], m = /^([a-z]{4,}?)(?:ians?|ans?|ern|ese|ish|ists?|ic|al|ed|ing|es|s)$/.exec(w);
  if (m) stems.push(m[1]);
  for (var i = 0; i < stems.length; i++) {
    var s = stems[i];
    if (words.has(s) || words.has(s + "e") || words.has(s + "a") || words.has(s + "y") || words.has(s + "ia") || words.has(s + "es")) return true;
  }
  return false;
}
function groundWords(text) {
  // GROUND-HYPHEN-1: unicode hyphens count as '-', and a hyphenated source name also grants its parts ("Dex-One2Many" -> dex, one2many),
  // because the draft's tokenizer splits a name at a non-ASCII hyphen and every such name was rejected as "not in the source".
  // GROUND-UNICODE-1 (1.23.2): words are read with every letter, not only a-z ("Otávio", "Associação"), and also kept without accents
  var set = new Set(); String(text || "").normalize("NFC").toLowerCase().replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[‘’]/g, "'").replace(/[\p{L}\p{N}][\p{L}\p{N}'.-]*/gu, function (w) {
    w = w.replace(/[.'-]+$/, ""); set.add(w); if (foldAccents(w) !== w) set.add(foldAccents(w)); if (w.indexOf("-") > 0) w.split("-").forEach(function (part) { if (part) set.add(part); }); set.add(w.replace(/'s$/, "")); if (w.length > 3 && w.charAt(w.length - 1) === "s") set.add(w.slice(0, -1)); else set.add(w + "s"); return "";
  });
  return set;
}
// GROUND-UNICODE-1 (1.23.2, companion_runs 5766 of 2026-10-13 22:09 UTC: "grounding: name not in the source: Ot"): the name check read
// words as runs of a-z, so "Otávio" became "Ot" and "vio"; the needle "Ot" matched "not" and "other", and no repair could use it. Names are
// read with every Unicode letter and compared with and without accents ("Otavio" in a draft matches "Otávio" in the source).
function foldAccents(w) { return String(w || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function groundNumbers(text) {
  var set = new Set(); (String(text || "").match(/\d[\d,]*(?:\.\d+)?/g) || []).forEach(function (n) { set.add(n.replace(/,/g, "").replace(/\.0+$/, "")); }); return set;
}
// Deterministic check: names, years and figures in `text` that `ground` does not contain. Returns a list of problem strings.
// REJECT-CONTEXT-1: the text around each flagged item (60 characters each side, at most 6 items), so a grounding false positive is diagnosable from the run log.
function problemContext(text, problems) {
  var t = String(text || ""), out = [];
  (problems || []).slice(0, 6).forEach(function (p) {
    // REJECT-CONTEXT-2: the needle is the text after the last label ("grounding: name not in the source: X" has two labels; stripping one left
    // "name not in the source: X", which no draft contains, so every "in context:" field in companion_runs was empty)
    var q = String(p).replace(/^.*:\s*/, ""), i = q ? t.indexOf(q) : -1;
    if (i >= 0) out.push(q + " => \u2026" + t.slice(Math.max(0, i - 60), i + q.length + 60).replace(/\s+/g, " ") + "\u2026");
  });
  return out.join(" | ").slice(0, 900);
}
function groundingProblems(text, ground, opts) {
  var o = opts || {}, nowYear = Number(String(o.today || nowIso().slice(0, 10)).slice(0, 4));
  var body = String(text || "").normalize("NFC").replace(/^#+[ \t]+(.*)$/gm, function (m, h) { return h.toLowerCase(); }).replace(/\(?(?:This|A|An) hypothetical[^)]*\)?/gi, " ");
  var words = groundWords(ground), nums = groundNumbers(ground), out = [], seen = {};
  function add(kind, v) { var k = kind + v.toLowerCase(); if (seen[k]) return; seen[k] = 1; out.push(kind + ": " + v); }
  // figures: every number must be in the source, except small counts, future years and (forecasts) probabilities and horizons
  var nre = /\$?\d[\d,]*(?:\.\d+)?\s*(%|percent|days?|weeks?|months?|quarters?|years?|hours?)?/gi, m;
  while ((m = nre.exec(body))) {
    var raw = m[0], digits = raw.replace(/[^\d.]/g, "").replace(/\.$/, "").replace(/\.0+$/, "");
    if (!digits || digits.indexOf(",") >= 0) continue;
    var plain = m[0].replace(/[$,\s]/g, "").replace(/(%|percent|days?|weeks?|months?|quarters?|years?|hours?)$/i, "");
    var num = plain.replace(/,/g, "");
    if (nums.has(num) || nums.has(num.replace(/\.0+$/, ""))) continue;
    // YEAR-RANGE-1 (1.23.3, companion_runs 5777-5795 of 2026-10-13 23:01 UTC: the source says "the famine of 1770 and 1771", the drafts wrote
    // "1770-71" and "71" was flagged three times): the two-digit end of a year range is read as the full year it abbreviates
    var yr = /^\d\d$/.test(num) && !m[1] ? /(1[0-9]|20)(\d\d)\s*[-\u2010-\u2015\u2212]\s*$/.exec(body.slice(Math.max(0, m.index - 7), m.index)) : null;
    if (yr && Number(num) > Number(yr[2]) && nums.has(yr[1] + num)) continue;
    var unit = (m[1] || "").toLowerCase(), val = Number(num);
    var isYear = /^(1[0-9]|20)\d\d$/.test(num) && !unit;
    if (isYear && val >= nowYear && o.forecast) continue;
    if (o.forecast && (unit === "%" || unit === "percent")) continue;
    if (o.forecast && /^(days?|weeks?|months?|quarters?|years?)$/.test(unit)) continue;
    if (!isYear && !unit && /^\d{1,2}$/.test(num) && val <= 10 && raw.indexOf("$") < 0) continue;
    // CENTURY-ORDINAL-1 (1.23.4, companion_runs 5821: "early-21st-century" was flagged "figure not in the source: 21"): a century ordinal is no figure
    if (!unit && /^\d{1,2}$/.test(num) && /^(?:st|nd|rd|th)[\s\u2010-\u2015-]+centur/i.test(body.slice(m.index + m[0].length, m.index + m[0].length + 14))) continue;
    if (!isYear && !unit && /^\d$/.test(num)) continue;
    add(isYear ? "year not in the source" : "figure not in the source", raw.trim());
  }
  // names: capitalised words or phrases that are not at the start of a sentence and are absent from the source
  // GROUND-MATCHER-2 (1.19.2): a sentence also ends at terminal punctuation followed by a closing quote, bracket or markdown emphasis
  // ("It's a trap!” Delivered ...", "documents.** Records from ..."); the next sentence's opener was read as a name (runs 5121-5276).
  var sentences = body.split(/(?<=[.!?:;—][”’"')\]*_]*)\s+|\n+/);
  sentences.forEach(function (sent) {
    var toks = sent.match(/[\p{L}\p{N}][\p{L}\p{N}&'.’-]*|[,;]/gu) || []; // GROUND-UNICODE-1
    var i = 0;
    while (i < toks.length) {
      var t = toks[i];
      if (!/^\p{Lu}/u.test(t) || /^\p{Lu}$/u.test(t) && toks[i + 1] && !/^\p{Lu}/u.test(toks[i + 1])) { i++; continue; }
      var j = i, phrase = [];
      while (j < toks.length && /^\p{Lu}[\p{L}\p{N}&'.’-]*$/u.test(toks[j])) { phrase.push(toks[j]); j++; if (toks[j] && /^(of|the|for|de|do|da|dos|das|von|van|del|la)$/i.test(toks[j]) && toks[j + 1] && /^\p{Lu}/u.test(toks[j + 1])) { phrase.push(toks[j]); j++; } }
      phrase = phrase.filter(function (w) { return !/^[A-Z]{2,5}s?[.,;:]?$/.test(w) && !/^[A-Z][.,;:]?$/.test(w) && !/^(?:[A-Z]\.){2,}[A-Z]?[.,;:]?$/.test(w); }); // acronyms, initials, single letters (SINGLE-LETTER-1: "S", "Model B") and dotted initialisms (U.S., D.C.) are left to the two-family fact-check
      var lead = 0; while (lead < phrase.length - 1 && GROUND_LEAD.has(phrase[lead].toLowerCase().replace(/[^a-z]/g, ""))) lead++;
      var core = phrase.slice(lead);
      var first = (i === 0);
      // OPENER-WORD-1: the first word of a sentence is capitalised by position ("Should InstantFusion", "Translating ImageNet"); when it leads a longer
      // capitalised phrase the rest is still checked, the opener alone is not read as part of the name.
      var opener = first && lead === 0 && core.length > 1;
      if (opener) core = core.slice(1);
      if (core.length && !(core.length === 1 && first && lead === 0 && !opener) && !(core.length === 1 && GROUND_LEAD.has(core[0].toLowerCase()))) {
        var joined = core.join(" ").replace(/[’]/g, "'");
        var low = joined.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, " ").replace(/\s+/g, " ").trim();
        if (low && !GROUND_OK.has(low)) {
          var miss = low.split(" ").filter(function (w) { return w && !GROUND_OK.has(w) && !GROUND_LEAD.has(w) && !words.has(w) && !words.has(foldAccents(w)) && !words.has(w.replace(/'s$/, "")) && !words.has(w.replace(/'$/, "")) && !/^\d+$/.test(w) && !stemGrounded(w, words); });
          if (miss.length === 1 && core.length === 1 && GROUND_DESCRIPTOR_RE.test(miss[0])) miss = []; // GROUND-DESCRIPTOR-1
          if (miss.length) add("name not in the source", joined);
        }
      }
      i = Math.max(j, i + 1);
    }
  });
  // QUOTE-GROUND-1 (1.21.1, companion_runs 5459-5473 of 2026-10-13 13:00 UTC): four drafts in one run invented a critic's quotation for
  // their objection ("the Kahn system was merely a minor improvement on earlier methods") or moved a real quotation to another subject;
  // the critic caught each, one attempt at a time. A quotation of QUOTE_MIN_WORDS or more words must occur verbatim (normalised) in the
  // source material; the message carries the quotation itself, so the grounding repair deletes its sentence before any reviewer reads it.
  var qre = /["\u201c]([^"\u201c\u201d\n]{8,400})["\u201d]/g, qm;
  var gnorm = " " + normForMatch(ground) + " ";
  while ((qm = qre.exec(String(text || "")))) {
    var quote = qm[1].trim(), qn = normForMatch(quote);
    if (qn.split(" ").filter(Boolean).length < QUOTE_MIN_WORDS) continue;
    if (gnorm.indexOf(" " + qn + " ") >= 0 || gnorm.indexOf(qn) >= 0) continue;
    add("quotation not in the source", '"' + quote.slice(0, 120) + '"');
  }
  // BLOCKQUOTE-GROUND-1 (1.21.5, companion_runs 5550 of 2026-10-13 15:08 UTC): the last draft of the run set an invented Ehrenburg
  // quotation as a markdown blockquote ("> ..."), which has no quotation marks, so the check above never saw it and the critic rejected
  // the draft (grounding=0). A blockquote is a quotation: its text must occur verbatim in the source material too.
  var blocks = [], cur = null;
  String(text || "").split("\n").forEach(function (l) {
    if (/^\s*>/.test(l)) { if (!cur) { cur = []; blocks.push(cur); } cur.push(l.replace(/^\s*>\s?/, "")); } else cur = null;
  });
  blocks.forEach(function (lines) {
    var bq = lines.join(" ").replace(/^[\s"\u201c]+|[\s"\u201d]+$/g, "").trim();
    var bn = normForMatch(bq);
    if (bn.split(" ").filter(Boolean).length < QUOTE_MIN_WORDS) return;
    if (gnorm.indexOf(" " + bn + " ") >= 0 || gnorm.indexOf(bn) >= 0) return;
    add("quotation not in the source", '"' + bq.slice(0, 120) + '"');
  });
  return out.slice(0, 14);
}
var QUOTE_MIN_WORDS = 5;
var FACTCHECK_PROMPT = [
  "You are a strict fact-checker for a publication that must contain no unsupported claim. You are given SOURCE MATERIAL and a DRAFT.",
  "If the DRAFT contains a line <!-- analysis -->, the text after that line is the writer's marked analysis. There, list only concrete factual assertions the SOURCE MATERIAL does not contain: an event that happened, a named person, organisation, rule or place doing or saying something, a date, a number, a quotation, a study or precedent. Reasoning, conditionals, generalisations and claims about incentives, constraints or what parties are motivated to do are never violations in that section. The text before the line is checked by every rule below.",
  "List every sentence or clause in the DRAFT, headings and title included, that asserts something about the real world and is not stated in, or a direct paraphrase of, the SOURCE MATERIAL. That covers events, dates, people, organisations, places, works, products, laws, institutions, numbers, quotations, studies, historical episodes and precedents, claims about what the reader does or has done, and statements that a practice or fact is 'known' or 'common'.",
  "A heading or the title labels what follows it: list one only when it states a specific fact (a name, date, number, event or quotation) the SOURCE MATERIAL does not support. A heading that frames or interprets the sourced content of its section is not a violation.",
  "Your own knowledge does not count as support, even if you are sure the claim is true: if it is not in the SOURCE MATERIAL, it is unsupported. A claim that distorts what the SOURCE MATERIAL says (a changed number, a stronger or different relationship, a cause where the source gives only a sequence) is unsupported too. These are NOT violations: analysis and interpretation the writer frames as such ('the incentive is ...', 'this means ...', 'the system rewards ...') that introduces no new name, date, number, event or quotation; a synonym that keeps the source's meaning ('commonly called' where the source says 'frequently called'), reasoning that follows from the source's facts and is presented as reasoning, conditional statements that follow from them, mentions of the source itself (the Wikipedia article, the arXiv paper), definitions, and a clearly labelled hypothetical that names no real person, organisation, product, date or number.",
  "Example of the expected answer: {\"unsupported\": [\"FACT: the road was finished in 1952 -- date not in source\", \"INFERENCE: so the builders worked under pressure -- reasoning from the source\"], \"verdict\": \"fail\"}.",
  "Label each item you list. FACT: a specific real-world assertion: something happened, exists, was said, decided, built or measured; any name of a person, organisation, work, product or place; any date, number, count or quotation; any study, event or precedent. INFERENCE: reasoning, interpretation, generalisation or consequence the writer draws from the source's facts, with no specific name, date, number or quotation of its own. When unsure, label it FACT.",
  "Answer with exactly one JSON object and nothing else: {\"unsupported\": [up to 8 items, each starting with 'FACT: ' or 'INFERENCE: ', then a short quotation copied from the DRAFT, then ' -- ' and the reason in a few words], \"verdict\": \"pass\" or \"fail\"}. verdict is \"fail\" when any FACT item is listed, else \"pass\"."
].join("\n");
// COMPANION-FACT-INFERENCE-1 (1.17.0; pattern of q08-signal-engine 0.13.2-0.15.2). Run 5334 failed on items that were the piece's own
// reasoning ("Their reliance on oak ... underscores a commitment") next to real fact errors ("without the benefit of iron tools -- source
// does not mention iron tools"). Each item is labelled; only FACT items fail a draft and unlabelled items count as FACT, so the check stays
// fail-closed. An item is read as an INFERENCE when it is labelled so, or when its reason calls it reasoning, interpretation, generalisation
// or a paraphrase and names no date, figure, name or quotation, or when its quoted text has no digit, quotation or capitalised name and uses
// reasoning wording. Names, years and figures are refused deterministically by groundingProblems before any reviewer runs.
var INFERENCE_REASON_RE = /\b(analy\w*|evaluat\w*|fram(?:e|es|ed|ing)|judge?ments?|inferen\w*|interpret\w*|generali[sz]\w*|assum\w*|speculat\w*|paraphras\w*|reasoning|opinion|editoriali[sz]\w*|characteri[sz]\w*)\b/i;
var FACT_REASON_RE = /\b(dates?|years?|numbers?|figures?|statistics?|names?|quot\w*|percent\w*|prices?|counts?|amounts?|fabricat\w*|invent\w*|false|wrong|incorrect|contradict\w*)\b/i;
// The reason objects only to the wording ("not a direct quote", "slightly different wording"): the content is in the source.
// FACT-WORDING-1 (1.19.4, run 5391 of 2026-10-13): reviewers failed "commonly called" because the source says "frequently called".
// A reason of the form source says 'A', not 'B' where A and B are short, carry no digit and differ in exactly one word is a wording
// difference, not a fact error; a swap of the whole phrase ("delegating" for "forwarding") still counts as a fact.
var SWAP_REASON_RE = /\b(?:source|it|the article|the text|the paper)\s+(?:says|uses|has|reads|states|writes|calls it)\s+['"\u2018\u201c]([^'"\u2019\u201d]{1,60})['"\u2019\u201d]\s*,?\s*(?:not|rather than|instead of)\s+['"\u2018\u201c]([^'"\u2019\u201d]{1,60})['"\u2019\u201d]/i;
function oneWordSwap(reason) {
  var m = SWAP_REASON_RE.exec(String(reason || ""));
  if (!m) return false;
  var a = m[1].toLowerCase().trim().split(/\s+/), b = m[2].toLowerCase().trim().split(/\s+/);
  if (a.length !== b.length || a.length < 2 || a.length > 4 || /\d/.test(m[1] + m[2])) return false;
  var diff = 0, wa = "", wb = "";
  for (var k = 0; k < a.length; k++) if (a[k] !== b[k]) { diff++; wa = a[k]; wb = b[k]; }
  return diff === 1 && sameSynonymGroup(wa, wb);
}
// Only a swap inside one of these groups is wording; any other one-word change ("new" for "old") can change the fact and stays a fact.
var SYNONYM_GROUPS = [
  ["commonly", "frequently", "often", "usually", "typically", "generally", "widely", "regularly"],
  ["called", "named", "termed", "known", "referred", "described"],
  ["uses", "employs", "utilizes", "utilises", "applies"], ["use", "employ", "utilize", "utilise", "apply"],
  ["shows", "demonstrates", "indicates", "illustrates", "suggests"], ["show", "demonstrate", "indicate", "illustrate"],
  ["about", "around", "approximately", "roughly", "nearly", "almost"],
  ["large", "big", "major", "substantial"], ["small", "little", "minor"],
  ["begin", "start", "commence"], ["began", "started", "commenced"], ["build", "construct"], ["built", "constructed"],
  ["make", "create", "produce"], ["made", "created", "produced"], ["help", "assist", "aid"], ["important", "significant", "key", "central"]
];
function sameSynonymGroup(x, y) {
  x = String(x || "").replace(/[^a-z]/g, ""); y = String(y || "").replace(/[^a-z]/g, "");
  return !!x && !!y && SYNONYM_GROUPS.some(function (g) { return g.indexOf(x) >= 0 && g.indexOf(y) >= 0; });
}
function wordingOnly(reason) { reason = String(reason || ""); if (oneWordSwap(reason)) return true; return /\b(?:as an? (?:direct|exact|verbatim) quot\w*|not (?:a )?(?:direct|exact|verbatim) quot\w*|verbatim|exact wording|different wording|worded differently|paraphras\w*)\b/i.test(reason) && !/\b(?:dates?|years?|numbers?|figures?|names?|percent\w*|prices?|fabricat\w*|invent\w*|false|wrong|incorrect|contradict\w*)\b/i.test(reason); }
function reasonIsInference(item) {
  // Unwrap JSON‑style items first so that a reviewer’s object output is handled like normal text.
  var txt = factItemText(item);
  var i = String(txt).lastIndexOf(" -- ");
  if (i < 0) return false;
  var reason = String(txt).slice(i + 4);
  var saysSupported = /\bin (?:the )?source\b/i.test(reason) && !/\bnot (?:[\w-]+ ){0,2}in (?:the )?source\b/i.test(reason) && !/\b(?:no|nothing|absent|missing|lacks?)\b/i.test(reason);
  if (wordingOnly(reason)) return true;
  return (INFERENCE_REASON_RE.test(reason) || saysSupported) && !FACT_REASON_RE.test(reason);
}
var REASONING_MARK_RE = /\b(incentives?|pressures?|mechanisms?|structures?|repeats?|wherever|whenever|because|therefore|thus|hence|so that|cannot|can|could|may|might|would|should|tends?|likely|underscores?|suggests?|implies|means|translates?|prevent\w*|despite|based on|leads? to|result\w* in|unless|if|weak|stronger|weaker)\b/i;
var GENERAL_MARK_RE = /\b(wherever|whenever|any|every|mechanisms?|patterns?|incentives?|structures?|if|unless|therefore|thus|hence|would|could|might|tends?)\b/i;
function claimIsReasoning(item, labelledFact) {
  var s = String(item), i = s.lastIndexOf(" -- ");
  if (i < 0) return false;
  var claim = s.slice(0, i).trim(), reason = s.slice(i + 4);
  if (FACT_REASON_RE.test(reason) || /["“‘'][^"”’']{3,}["”’']/.test(reason)) return false;
  if (/[0-9"“”]/.test(claim)) return false;
  if (claim.split(/\s+/).slice(1).some(function (w) { return /^[^a-z]*[A-Z]/.test(w) && w !== "I"; })) return false;
  // COMPANION-SYSTEMS-ANALYSIS-1 (1.20.0, parity with q08-signal-engine 0.18.0 Q08-CONTEXT-1): a FACT-labelled item whose own reason calls it
  // analysis or interpretation ("analytical claims not stated in source") is reasoning when its shape carries no name, number or quotation.
  return labelledFact ? (GENERAL_MARK_RE.test(claim) || INFERENCE_REASON_RE.test(reason)) : REASONING_MARK_RE.test(claim);
}
// COMPANION-REVIEWER-HYGIENE-1 (1.43.3, agent_issues 1000298, pillar personal; patch; port of q08-signal-engine 0.36.0 Q08-REVIEWER-HYGIENE-1; PR 4447
// had added one regex line to reasonIsInference and no test, which this replaces). Reviewer output is read as what it is before it is classified:
// (1) an item the reviewer printed as an object inside a string (JSON text such as {"fact":"FACT: ... -- reason"} or {"claim": ..., "verdict": ...},
// also fenced) is unwrapped to its claim and reason, so the prune has the sentence and not JSON to look for; (2) an item with no claim text at all
// (the word "reason", an empty claim, only a reason) is set aside, and a fail that names nothing else still fails closed (parseFactVerdict);
// (3) an item whose own closing clause says the claim is supported ("..., so supported", "... matches source", "..., which the source supports")
// is acquitted, neither deleted nor failed, unless that clause also says not, no, absent, missing, lacks and the like. A label (FACT) does not
// skip the test. A fail that names any other item still fails, and no check on names, years, figures or the two-family rule is touched.
function unwrapJsonItem(str) {
  var t = String(str);
  if (/^\s*```/.test(t)) t = t.replace(/^\s*```[a-z]*\s*/i, "").replace(/\s*```\s*$/, "");
  if (!/^\s*\{\s*"/.test(t)) return t;
  try { var o = JSON.parse(t); if (o && typeof o === "object" && !Array.isArray(o)) { var r = factItemText(o); if (r) return r; } } catch (e) { /* truncated or malformed: take the value below */ }
  var m = t.match(/^\s*\{\s*"(fact|inference)"\s*:\s*"((?:[^"\\]|\\.)*)/i);
  if (!m) return t;
  var v = m[2].replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
  return /^\**\s*(FACT|INFERENCE)\s*\**\s*[:\-]/i.test(v) ? v : m[1].toUpperCase() + ": " + v;
}
function itemHasNoClaim(item) {
  var s = String(item).replace(/^\s*\**\s*(?:FACT|INFERENCE)\s*\**\s*[:\-]\s*/i, "").trim();
  if (/^--/.test(s)) return true;
  var i = s.lastIndexOf(" -- "), claim = i >= 0 ? s.slice(0, i) : s;
  return normForMatch(claim).replace(/\b(?:reason|claim|fact|inference|none|null|na|n a)\b/g, "").trim().length < 1;
}
var SUPPORT_SRC = "(?:the )?(?:source|source material|source text|article)";
var SUPPORT_SUBJ = "(?:it|this|that|the claim|the sentence|the statement)";
// the whole closing clause says supported (q08's forms, plus "matches source" and "the source supports it" for PR 4447's phrase and its kin)
var SUPPORTED_CLAUSE_RE = new RegExp("^(?:(?:so|therefore|thus|hence|and|still|yet|which)\\s+)*(?:"
  + "(?:" + SUPPORT_SUBJ + "\\s+(?:is|are)\\s+)?(?:(?:fully|directly|in fact)\\s+)?(?:supported(?:\\s+by\\s+" + SUPPORT_SRC + ")?|(?:in|stated in|found in)\\s+" + SUPPORT_SRC + ")"
  + "|(?:" + SUPPORT_SUBJ + "\\s+)?(?:matches|matched)\\s+" + SUPPORT_SRC
  + "|" + SUPPORT_SRC + "\\s+(?:supports|confirms|states|backs|says so)(?:\\s+(?:it|this|that|the claim))?"
  + ")$");
// PR 4447's own two endings, kept: a clause that ends "matches source" or "so supported" after other plain words
var SUPPORTED_ENDING_RE = new RegExp("(?:^|\\s)(?:(?:matches|matched)\\s+" + SUPPORT_SRC + "|so\\s+supported|which\\s+" + SUPPORT_SRC + "\\s+(?:supports|confirms))$");
// a clause that denies, doubts or qualifies the support is never an acquittal
var SUPPORT_DENIAL_RE = /\b(?:not|no|never|none|nothing|neither|nor|un\w+|partly|partially|only|but|cannot|can't|absent|missing|lacks?|lacking|without|invented|fabricated|wrong|incorrect|false|contradict\w*)\b|n't|\?/;
// the reason, anywhere in it, says the source lacks the claim: "missing from source, so supported" contradicts itself and stays a failure
var SUPPORT_GAP_RE = /\b(?:absent|missing|lacks?|lacking|nowhere|no mention|not mentioned|does not mention|doesn't mention)\b|\bnot (?:[\w-]+ ){0,2}(?:in|stated in|found in|mentioned in) (?:the )?(?:source|article|text)\b/;
function reviewerSaysSupported(item) {
  var s = String(item), i = s.lastIndexOf(" -- ");
  if (i < 0) return false;
  if (SUPPORT_GAP_RE.test(s.slice(i + 4).toLowerCase())) return false;
  var parts = s.slice(i + 4).split(/\s+--\s+|[;,.:\u2014]/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
  var last = (parts.length ? parts[parts.length - 1] : "").replace(/[\s!)\]'"\u2019\u201d*_]+$/, "");
  return !!last && !SUPPORT_DENIAL_RE.test(last) && (SUPPORTED_CLAUSE_RE.test(last) || SUPPORTED_ENDING_RE.test(last));
}
function factItemText(x) {
  if (x == null) return "";
  if (typeof x === "string") return unwrapJsonItem(x);
  if (typeof x !== "object") return String(x);
  var lk = Object.keys(x).filter(function (k) { return /^(fact|inference)$/i.test(k) && typeof x[k] === "string" && x[k].trim(); });
  if (lk.length === 1) { var kv = x[lk[0]].trim(); return /^\**\s*(FACT|INFERENCE)\s*\**\s*[:\-]/i.test(kv) ? kv : lk[0].toUpperCase() + ": " + kv; }
  var pick = function (keys) { for (var i = 0; i < keys.length; i++) { if (x[keys[i]] != null && String(x[keys[i]]).trim()) return String(x[keys[i]]).trim(); } return ""; };
  var label = pick(["label", "type", "kind", "category"]).toUpperCase();
  var claim = pick(["claim", "quote", "quotation", "text", "sentence", "item", "excerpt"]);
  var reason = pick(["reason", "why", "explanation", "note", "issue"]);
  if (!claim) return JSON.stringify(x).slice(0, 260);
  return ((label === "FACT" || label === "INFERENCE") ? label + ": " : "") + claim + (reason ? " -- " + reason : "");
}
function splitFactItems(items) {
  var facts = [], inferences = [], acquitted = [];
  (items || []).forEach(function (x) {
    var s = String(x).replace(/\s+/g, " ").trim();
    if (!s) return;
    if (itemHasNoClaim(s)) return; // COMPANION-REVIEWER-HYGIENE-1: no claim text to check, delete or fail on; a fail that names nothing else still fails closed (parseFactVerdict)
    if (reviewerSaysSupported(s)) { acquitted.push(s.slice(0, 260)); return; } // COMPANION-REVIEWER-HYGIENE-1: the reviewer's own closing clause says it is supported
    var m = s.match(/^\**\s*(FACT|INFERENCE)\s*\**\s*[:\-]\s*/i);
    var rest = m ? s.slice(m[0].length) : s;
    var cut = rest.lastIndexOf(" -- ");
    if (m && (m[1].toUpperCase() === "INFERENCE" || claimIsReasoning(rest, true) || (cut > 0 && wordingOnly(rest.slice(cut + 4))))) inferences.push(rest.slice(0, 260));
    else if (!m && (reasonIsInference(s) || claimIsReasoning(s))) inferences.push(s.slice(0, 260));
    else facts.push(rest.slice(0, 260));
  });
  return { facts: facts.filter(Boolean), inferences: inferences.filter(Boolean), acquitted: acquitted };
}
function parseFactVerdict(text) {
  // VERDICT-TOLERANT-1: a reviewer that wraps its JSON in prose, trails off before the closing brace or prints the JSON twice still gave a verdict.
  var t = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  var o = null, m = t.match(/\{[\s\S]*\}/);
  if (m) { try { o = JSON.parse(m[0]); } catch (e) { o = null; } }
  if (!o) {
    var vm = t.match(/"verdict"\s*:\s*"(pass|fail)"/gi);
    if (!vm) return null;
    var last = vm[vm.length - 1].match(/(pass|fail)/i)[1];
    var um = t.match(/"unsupported"\s*:\s*\[([\s\S]*?)(?:\]|"verdict")/i), items = [];
    if (um) { var re = /"((?:[^"\\]|\\.)*)"/g, x; while ((x = re.exec(um[1]))) { if (x[1].trim()) items.push(x[1]); } }
    o = { verdict: last, unsupported: items };
  }
  var v = String(o && o.verdict || "").toLowerCase().trim();
  if (v !== "pass" && v !== "fail") return null;
  var listed = Array.isArray(o.unsupported) ? o.unsupported.map(factItemText).map(function (x) { return x.replace(/\s+/g, " ").trim(); }).filter(Boolean).slice(0, 8) : [];
  // COMPANION-FACT-INFERENCE-1: the verdict follows the FACT items. A fail that names nothing stays a fail (fail-closed); a fail or pass that
  // names only INFERENCE items is a pass with those sentences to delete when the draft can spare them.
  var sp = splitFactItems(listed), u = sp.facts;
  if (u.length) v = "fail";
  else if (v === "fail" && !sp.inferences.length && !sp.acquitted.length) u = ["the reviewer rejected the draft without naming a claim"]; // COMPANION-REVIEWER-HYGIENE-1: contentless items are set aside, so a fail that names nothing else still fails closed
  else v = "pass";
  return { verdict: v, unsupported: u, inferences: sp.inferences, acquitted: sp.acquitted.length };
}
// Workers AI returns `response` as a parsed OBJECT when a model replies with bare JSON (llama, qwen): String() of it is "[object Object]",
// so the verdict parser rejected it (found in q08-signal-engine run 312). Normalise any reply shape to text.
function aiReplyText(resp) {
  if (!resp) return "";
  var r = resp.response;
  if (r !== undefined && r !== null && r !== "") return typeof r === "string" ? r : JSON.stringify(r);
  var m = resp.choices && resp.choices[0] && resp.choices[0].message;
  var c = m && m.content;
  if (Array.isArray(c)) c = c.map(function (p) { return typeof p === "string" ? p : (p && p.text) || ""; }).join("");
  if (c && typeof c !== "string") c = JSON.stringify(c);
  return c || "";
}
// EK-3 (roadmap row 1750, agent_issues 1000714): the even-keel check. Until 1.44.17 the reviewer was chosen from a family called "ensemble-policy-1", which
// no model has (MODEL_FAMILY names nvidia, openai, moonshot, deepseek and zai), so balanceCheck answered "unavailable" for every piece, verifyPiece
// ignored an unavailable check, and companion_audits.balance_score is NULL on every row, 2026-10-28 to 2026-11-04. The reviewer is now chosen by
// afBalanceReviewers (_shared/analysis-form.js): a family other than the writer's, one that has not judged the piece when there is one, asked after
// the grounding check and both fact-check judges have passed it. Measured 2026-11-04 on 16 published pieces with kimi-k2.6 and nemotron (31 scores):
// min 68, max 90, one score under 70; three one-sided polemics and three balanced essays on the same topics scored 0 to 25 and 88 to 95 with
// kimi, nemotron and gpt-oss alike, so the bar of 70 separates them and costs a published piece about one verdict in thirty.
var BALANCE_MIN_SCORE = AF_BALANCE_MIN_SCORE;
var BALANCE_PROMPT = AF_BALANCE_PROMPT;
var BALANCE_TIMEOUT_MS = 6e4;
var BALANCE_ASKS = 2;
function parseBalanceScore(text) { return afParseBalanceScore(text); }
async function balanceCheckOne(env, modelId, draft) {
  try {
    var body = BALANCE_PROMPT + "\n\n" + todayLine() + "\n\n--- DRAFT ---\n" + String(draft).trim().slice(0, 30000);
    var resp = await aiRunAttr(env, "personal-companion", "balance", modelId, Object.assign({ messages: [{ role: "user", content: body }], max_tokens: REVIEW_MAX_TOKENS, temperature: 0.1 }, factCheckExtra(modelId)), { gateway: { id: "default", skipCache: true }, signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS) });
    var out = aiReplyText(resp);
    var s = parseBalanceScore(out);
    if (s) { s.model = modelId; s.family = familyOf(modelId); return s; }
    return { failed: true, model: modelId, error: "no balance score in reply (" + String(out).length + " chars)" };
  } catch (e) { return { failed: true, model: modelId, error: String(e && e.message || e).slice(0, 140) }; }
}
// judged: the fact-check judges (their families are the ones the piece has already been read by). Fails open ("unavailable") when no reviewer answers;
// verifyPiece records that, and only after the grounding check and the fact-check have passed.
async function balanceCheck(env, draft, writerModel, seedText, judged) {
  var wf = writerModel ? familyOf(writerModel) : "";
  var avoid = (judged || []).map(function (j) { return j && (j.family || familyOf(j.model)); }).filter(Boolean);
  var order = afBalanceReviewers(REVIEW_POOL, { familyOf: familyOf, allowed: modelAllowed, writerFamily: wf, avoid: avoid, sick: await sickReviewers(env), seed: seedOf(seedText) });
  if (!order.length) return { unavailable: true, reason: "no reviewer from a family other than the writer's", score: null, tried: [] };
  var tried = [];
  for (var i = 0; i < order.length && i < BALANCE_ASKS; i++) {
    var res = await balanceCheckOne(env, order[i], draft);
    if (!res.failed) {
      var v = afBalanceVerdict(res);
      return { unavailable: false, ok: v.state === "pass", score: v.score, parts: v.parts, reason: v.reason, model: res.model, family: res.family };
    }
    tried.push(String(order[i]).split("/").pop() + ": " + res.error);
  }
  return { unavailable: true, reason: "no balance score from " + tried.length + " reviewer(s) (" + tried.join(" | ").slice(0, 300) + ")", score: null, tried: tried };
}
// FACTCHECK-NOTHINK-1 (measured 2026-10-12 against the live models with the same fact-check prompt): reasoning reviewers spent 4-9 s thinking about a
// task that needs a comparison. These per-model switches return the same verdict in 0.7-2.6 s. Models without a measured switch get none.
function factCheckExtra(modelId) {
  var m = String(modelId || "").toLowerCase();
  if (m.indexOf("kimi") >= 0 || m.indexOf("deepseek") >= 0) return { chat_template_kwargs: { thinking: false } };
  if (m.indexOf("nemotron") >= 0) return { chat_template_kwargs: { enable_thinking: false } };
  if (m.indexOf("gpt-oss") >= 0) return { reasoning: { effort: "low" } };
  return {};
}
async function factCheckOne(env, modelId, draft, ground) {
  try {
    var body = FACTCHECK_PROMPT + "\n\n" + todayLine() + "\n\n--- SOURCE MATERIAL ---\n" + String(ground).slice(0, GROUND_MAX + 2000) + "\n\n--- DRAFT ---\n" + String(draft).trim().slice(0, 30000);
    var resp = await aiRunAttr(env, "personal-companion", "factcheck", modelId, Object.assign({ messages: [{ role: "user", content: body }], max_tokens: REVIEW_MAX_TOKENS, temperature: 0.1 }, factCheckExtra(modelId)), { gateway: { id: "default", skipCache: true }, signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS) });
    var out = aiReplyText(resp);
    var v = parseFactVerdict(out);
    if (v) { v.model = modelId; v.family = familyOf(modelId); return v; }
    return { failed: true, model: modelId, error: "no verdict in reply (" + String(out).length + " chars)" };
  } catch (e) { return { failed: true, model: modelId, error: String(e && e.message || e).slice(0, 140) }; }
}
// FACTCHECK-FIRST-TWO-1 + REVIEWER-HEALTH-1 (1.19.6, agent_issues 2222; companion_runs 5404-5408 of 2026-10-13 11:00 UTC): every
// verification took 220 s, because each of its two rounds waited the full REVIEW_TIMEOUT_MS for glm-5.3 (10 of its 11 fact-check calls
// that day failed after about 108 s) while the other reviewer had long answered. Three verifications spent the run's budget, and the
// prune stopped with 3 items left after removing 8 and 8. Two reviewers are now kept in flight, and a failed one is replaced at once by
// the next untried reviewer. A third is asked when two verdicts are not in after FACTCHECK_HEDGE_MS, so one slow reviewer costs
// seconds, not the timeout. The check ends on the second valid verdict from a second family. A reviewer that failed at least half of at
// least REVIEWER_SICK_MIN_CALLS fact-check calls today (qnfo-audit ai_call_counters) is asked last. The rule is unchanged: two valid
// verdicts from two families other than the writer's, else nothing publishes. Each failed reviewer is still retried once before
// "unavailable".
var FACTCHECK_HEDGE_MS = 45e3;
var REVIEWER_SICK_MIN_CALLS = 3;
var __reviewerHealth = { at: 0, sick: {}, db: null };
async function sickReviewers(env) {
  var db = env && (env.AUDIT || env.AUDIT_DB);
  if (!db) return {};
  if (__reviewerHealth.db === db && Date.now() - __reviewerHealth.at < 600e3) return __reviewerHealth.sick;
  var sick = {};
  try {
    var day = new Date().toISOString().slice(0, 10);
    var r = await db.prepare("SELECT model, calls, errors FROM ai_call_counters WHERE day = ?1 AND worker = 'personal-companion' AND purpose = 'factcheck'").bind(day).all();
    ((r && r.results) || []).forEach(function (x) { if (Number(x.calls) >= REVIEWER_SICK_MIN_CALLS && Number(x.errors) * 2 >= Number(x.calls)) sick[x.model] = 1; });
  } catch (e) { console.error("REVIEWER-HEALTH-1 read failed: " + String(e && e.message || e).slice(0, 160)); return {}; }
  __reviewerHealth = { at: Date.now(), sick: sick, db: db };
  return sick;
}
function orderByHealth(ids, sick) {
  sick = sick || {};
  return ids.filter(function (id) { return !sick[id]; }).concat(ids.filter(function (id) { return !!sick[id]; }));
}
function gatherVerdicts(env, ids, draft, ground, hedgeMs) {
  return new Promise(function (resolve) {
    var got = [], lastFail = {}, tried = {}, retried = {}, queue = ids.slice(), inflight = 0, done = false, timer = null;
    function finish() { if (done) return; done = true; if (timer) clearTimeout(timer); resolve({ got: got, lastFail: lastFail, tried: tried }); }
    function onResult(r) {
      inflight--;
      if (done) return;
      if (r && !r.failed && got.length < 2 && !got.some(function (g) { return g.family === r.family; })) { got.push(r); delete lastFail[r.model]; }
      else if (r && r.failed) lastFail[r.model] = r;
      if (got.length >= 2) return finish();
      fill();
      if (inflight === 0) finish();
    }
    function launch(id) {
      tried[id] = 1; inflight++;
      factCheckOne(env, id, draft, ground).then(onResult, function (e) { onResult({ failed: true, model: id, error: String(e && e.message || e).slice(0, 140) }); });
    }
    function next() {
      while (queue.length) { var id = queue.shift(); if (!got.some(function (g) { return g.model === id; })) { launch(id); return true; } }
      var again = Object.keys(lastFail).filter(function (m) { return !retried[m]; })[0];
      if (!again) return false;
      retried[again] = 1; launch(again); return true;
    }
    function fill() { while (!done && inflight < 2 - got.length && next()) {} }
    fill();
    if (inflight === 0) return finish();
    if (hedgeMs > 0) timer = setTimeout(function () { timer = null; if (!done) next(); }, hedgeMs);
  });
}
// Two valid verdicts from two different families, neither the writer's. Fewer than two valid verdicts is "unavailable": fail closed.
// COMPANION-FACTCHECK-PARALLEL-1 (1.15.8, issues 2222 and 2106) asked reviewers in parallel instead of one after another; 1.19.6 (above)
// stops waiting for the slowest one.
async function factCheck(env, draft, ground, writerModel, seedText) {
  var wf = writerModel ? familyOf(writerModel) : "";
  var ids = orderByHealth(pickReviewers(wf ? [wf] : [], 5, seedOf(seedText)), await sickReviewers(env)), failures = [];
  var gv = await gatherVerdicts(env, ids, draft, ground, FACTCHECK_HEDGE_MS), got = gv.got, lastFail = gv.lastFail;
  Object.keys(lastFail).forEach(function (m) { failures.push(lastFail[m]); });
  failures = failures.map(function (r) { return String(r.model).split("/").pop() + ": " + r.error; });
  if (got.length < 2) return { ok: false, unavailable: true, unsupported: [], judges: got, reason: "fewer than two fact-check verdicts from other model families (" + failures.join(" | ").slice(0, 400) + ")" };
  var uns = [], inf = []; got.forEach(function (g) { g.unsupported.forEach(function (u) { if (uns.indexOf(u) < 0) uns.push(u); }); (g.inferences || []).forEach(function (u) { if (inf.indexOf(u) < 0) inf.push(u); }); });
  return { ok: got.every(function (g) { return g.verdict === "pass"; }), unavailable: false, unsupported: uns.slice(0, 10), inferences: inf.slice(0, 12), judges: got, reason: "" };
}
// Full verification of one draft: deterministic grounding first (free), then the two-family review. `text` includes the title.
// ANALYSIS-SPLIT-1 (1.22.0; owner 2026-10-13 11:26 UTC "lacking in context and big-picture systems analysis", q08-signal-engine 0.19.0
// Q08-ANALYSIS-SPLIT-1, runs 376-378): the writer is required to analyse, and the critic and fact-check read every sentence of the
// analysis by the reporting rule, so analysis was pruned or rejected as unsupported. The writer marks where its analysis begins with a
// line <!-- analysis -->; the reporting before it keeps every rule; after it, the critic and the fact-check count only concrete invented
// facts (names, dates, numbers, events, rules, quotations, studies). The deterministic name, year and figure check (groundingProblems)
// still reads the whole text. Guard rails: the reporting before the line holds at least ANALYSIS_MIN_REPORT characters and the analysis
// at most ANALYSIS_MAX_SHARE of the body; otherwise the line is removed before review and the whole draft is held to the full rule. The
// line is removed before a piece is stored, so no reader, mail or feed ever sees it.
var ANALYSIS_MARK = "<!-- analysis -->";
var ANALYSIS_MARK_RE = /^[ \t]*<!--\s*analysis\s*-->[ \t]*$/im;
var ANALYSIS_MAX_SHARE = 0.6, ANALYSIS_MIN_REPORT = 600;
function stripAnalysisMark(text) { return String(text || "").replace(/\n?[ \t]*<!--\s*analysis\s*-->[ \t]*\n?/gi, "\n").replace(/\n{3,}/g, "\n\n").trim(); }
function analysisSplitOk(text) {
  var t = String(text || ""), m = t.match(ANALYSIS_MARK_RE);
  if (!m) return false;
  var i = t.indexOf(m[0]);
  var bodyLen = function (x) { return String(x).replace(/^#.*$/mg, "").replace(/\s+/g, " ").trim().length; };
  var rep = bodyLen(t.slice(0, i)), ana = bodyLen(stripAnalysisMark(t.slice(i + m[0].length)));
  return ana > 0 && rep >= ANALYSIS_MIN_REPORT && ana / (rep + ana) <= ANALYSIS_MAX_SHARE && !ANALYSIS_MARK_RE.test(t.slice(i + m[0].length));
}
// ANALYSIS-SPLIT-DIAG-1 (1.22.3, companion_runs 5637-5650 of 2026-10-13 19:01 UTC): the critic still rejected "feedback loop" and
// "motives" claims, and the log could not say whether the draft carried the line or the guard rails dropped it. The critique stage row
// now says which: "analysis marked 41% after 1630 chars", "analysis unmarked", or "analysis dropped: <rail>".
function analysisSplitInfo(text) {
  var t = String(text || ""), m = t.match(ANALYSIS_MARK_RE);
  if (!m) return "analysis unmarked";
  var i = t.indexOf(m[0]);
  var bodyLen = function (x) { return String(x).replace(/^#.*$/mg, "").replace(/\s+/g, " ").trim().length; };
  var rep = bodyLen(t.slice(0, i)), ana = bodyLen(stripAnalysisMark(t.slice(i + m[0].length))), share = rep + ana ? Math.round(100 * ana / (rep + ana)) : 0;
  if (analysisSplitOk(t)) return "analysis marked " + share + "% after " + rep + " chars";
  var why = ana <= 0 ? "empty analysis" : rep < ANALYSIS_MIN_REPORT ? "report " + rep + " chars < " + ANALYSIS_MIN_REPORT : ana / (rep + ana) > ANALYSIS_MAX_SHARE ? "analysis " + share + "% > " + Math.round(100 * ANALYSIS_MAX_SHARE) + "%" : "more than one line";
  return "analysis dropped: " + why;
}
// ANALYSIS-AUTO-1 (1.22.5; q08-signal-engine 0.19.2 Q08-ANALYSIS-AUTO-1; companion_runs 5637-5664 of 2026-10-13 19:01 UTC, where the critic
// still read "feedback loop" and "motives" as invented facts): a writer that leaves the line out gets one placed for it, at the first
// body paragraph (the third or later) written in reasoning language, and only where the guard rails hold; the analysis is still checked
// for concrete invented facts, so only reasoning is spared the sentence-by-sentence rule.
var ANALYSIS_VOCAB_RE = /\b(incentives?|rewards?|punish\w*|pays?|gains?|loses?|costs?|because|therefore|that means|which means|so that|feedback|loop|the system|systems?|structur\w*|constrain\w*|trade-?offs?|leverage|motivat\w*|if\b[^.]{0,80}\bthen)\b/i;
function autoMarkAnalysis(body, prefix) {
  var t = String(body || ""), pre = String(prefix || "");
  if (ANALYSIS_MARK_RE.test(t)) return t;
  var parts = t.split(/\n{2,}/), idx = [];
  parts.forEach(function (p, i) { if (p.trim() && !/^\s*#/.test(p)) idx.push(i); });
  for (var k = 2; k < idx.length; k++) {
    if (!ANALYSIS_VOCAB_RE.test(parts[idx[k]])) continue;
    var cand = parts.slice(0, idx[k]).concat([ANALYSIS_MARK], parts.slice(idx[k])).join("\n\n");
    if (analysisSplitOk(pre + cand)) return cand;
  }
  return t;
}
// SPLIT-LEDE-1 (1.22.6, companion_runs 5673 and 5682 of 2026-10-13 20:02 UTC: "analysis dropped: report 0 chars" and "323 chars"): the lede
// is stored apart from the body, so the rails measured the reporting in the body alone and dropped every split the writer marked after
// its lede. The rails now measure the lede and the body together, as the fact-check (pieceText) always did.
function splitText(piece) { return (piece && piece.lede ? String(piece.lede) + "\n\n" : "") + String(piece && piece.body_md || ""); }
// ANALYSIS-REMARK-1 (1.23.1, companion_runs 5703 and 5742 of 2026-10-13 21:02 and 22:02 UTC): the first draft of both runs put the line
// right after its lede, so 93% of the piece was marked analysis and the rails dropped the split. A line the writer placed where the rails
// fail is removed and placed again by the unmarked-draft rule; where no paragraph holds the rails the draft goes unmarked (the full rule),
// as a dropped split did.
function withAutoMark(piece) {
  if (!piece || !piece.body_md) return piece;
  var pre = piece.lede ? String(piece.lede) + "\n\n" : "", body = String(piece.body_md);
  if (ANALYSIS_MARK_RE.test(body) && !analysisSplitOk(pre + body)) body = stripAnalysisMark(body);
  var am = autoMarkAnalysis(body, pre);
  return am === String(piece.body_md) ? piece : Object.assign({}, piece, { body_md: am });
}
// What the critic and the reviewers read: the marked draft when the guard rails hold, else the draft without the line.
function reviewText(text) { var t = String(text || ""); return !ANALYSIS_MARK_RE.test(t) || analysisSplitOk(t) ? t : stripAnalysisMark(t); }
function stripPieceMark(piece) {
  if (!piece) return piece;
  return Object.assign({}, piece, { lede: piece.lede ? stripAnalysisMark(piece.lede) : piece.lede, body_md: stripAnalysisMark(piece.body_md) });
}
async function verifyPiece(env, text, ground, writerModel, seedText, opts) {
  var det = groundingProblems(stripAnalysisMark(text), ground, opts);
  if (det.length) return { ok: false, stage: "grounding", problems: det, judges: [], unavailable: false };
  var fc = await factCheck(env, reviewText(text), ground, writerModel, seedText);
  if (fc.unavailable) return { ok: false, stage: "factcheck", problems: ["fact-check unavailable: " + fc.reason], judges: fc.judges, unavailable: true, balance: null };
  if (!fc.ok) return { ok: false, stage: "factcheck", problems: fc.unsupported.map(function (u) { return "unsupported claim: " + u; }), judges: fc.judges, unavailable: false, balance: null };
  // EK-3: the even-keel reviewer reads a draft only after the deterministic gate and both fact-check judges passed it (class A layers first, no model call
  // spent on a draft that is about to be pruned). opts.noBalance skips it: the audit of published pieces judges accuracy, and a one-sided piece is not retracted.
  var bal = opts && opts.noBalance ? null : await balanceCheck(env, reviewText(text), writerModel, seedText, fc.judges);
  if (bal && !bal.unavailable && !bal.ok) return { ok: false, stage: "balance", problems: ["one-sided: " + (bal.reason || ("score " + (bal.score == null ? "unknown" : bal.score)))], judges: fc.judges.concat(bal.model ? [{ model: bal.model, family: bal.family, verdict: "balance-fail" }] : []), unavailable: false, balance: bal };
  return { ok: true, stage: "pass", problems: [], judges: fc.judges, unavailable: false, inferences: fc.inferences || [], balance: bal };
}
// Everything a reader is shown: title, subtitle, lede (stored apart from the body when the piece does not open with a heading) and body.
function pieceText(piece) { return "# " + String(piece.title || "") + "\n\n" + (piece.subtitle ? String(piece.subtitle) + "\n\n" : "") + (piece.lede ? String(piece.lede) + "\n\n" : "") + String(piece.body_md || ""); }
var __accSchemaDb = null;
async function ensureAccuracySchema(env) {
  if (__accSchemaDb && __accSchemaDb === env.PERSONAL) return true;
  try {
    await env.PERSONAL.prepare("CREATE TABLE IF NOT EXISTS companion_audits (slug TEXT PRIMARY KEY, verdict TEXT NOT NULL, stage TEXT, models TEXT, problems_json TEXT, checked_at TEXT NOT NULL)").run();
    await env.PERSONAL.prepare("CREATE TABLE IF NOT EXISTS companion_retractions (slug TEXT PRIMARY KEY, reason TEXT, claims_json TEXT, retracted_at TEXT NOT NULL)").run();
    await ensureColumns(env.PERSONAL, "companion_pieces", { ground_text: "TEXT" });
    // Add a column to store the separate‑family balance score for each piece.
    await ensureColumns(env.PERSONAL, "companion_audits", { balance_score: "INTEGER" });
    __accSchemaDb = env.PERSONAL;
    return true;
  } catch (e) {
    console.error("companion accuracy schema failed: " + String(e && e.message || e).slice(0, 200));
    return false;
  }
}
// A piece is visible and mailable only with a passing audit row and no retraction. Used as a WHERE fragment on companion_pieces.
var VISIBLE_SQL = "slug IN (SELECT slug FROM companion_audits WHERE verdict = 'pass') AND slug NOT IN (SELECT slug FROM companion_retractions)";
async function pieceVerified(env, slug) {
  try {
    await ensureAccuracySchema(env);
    var r = await env.PERSONAL.prepare("SELECT 1 AS ok FROM companion_pieces WHERE slug = ?1 AND " + VISIBLE_SQL).bind(slug).first();
    return !!r;
  } catch (e) { return false; }
}
async function recordAudit(env, slug, verdict, stage, vr) {
  await ensureAccuracySchema(env);
  await env.PERSONAL.prepare("INSERT OR REPLACE INTO companion_audits (slug, verdict, stage, models, problems_json, checked_at, balance_score) VALUES (?,?,?,?,?,?,?)")
    .bind(
      slug,
      verdict,
      stage,
      (function () {
        var m = ((vr && vr.judges) || []).map(function (j) { return j.model; });
        if (vr && vr.balance && vr.balance.model) m.push(vr.balance.model);
        return m.join(",");
      })(),
      JSON.stringify(((vr && vr.problems) || []).slice(0, 10)),
      nowIso(),
      (vr && vr.balance && typeof vr.balance.score === "number") ? vr.balance.score : null
    )
    .run();
}
// Retracts a piece in public: its URL keeps answering with a notice, it leaves the index, feed, API and every mail run.
async function retractPiece(env, slug, reason, claims) {
  await ensureAccuracySchema(env);
  await env.PERSONAL.prepare("INSERT OR REPLACE INTO companion_retractions (slug, reason, claims_json, retracted_at) VALUES (?,?,?,?)")
    .bind(slug, String(reason || "").slice(0, 400), JSON.stringify((claims || []).slice(0, 8)), nowIso()).run();
  try {
    if (env.AUDIT) await env.AUDIT.prepare("UPDATE signals SET status = 'retracted' WHERE id = ?1").bind("reading:" + slug).run();
  } catch (e) { logCaught("retractPiece", e); }
  return { ok: true, slug: slug };
}
// Cron step. Pieces with no audit row: one with no recorded source material cannot be verified and is withdrawn (no model call);
// one with stored source material is verified now. A reviewer outage writes nothing (retried next tick); a failure retracts.
async function auditPublished(env, limit) {
  if (!(await ensureAccuracySchema(env))) return { ok: false, reason: "schema" };
  var rows = await env.PERSONAL.prepare(
    "SELECT slug, title, subtitle, lede, body_md, ground_text FROM companion_pieces WHERE slug NOT IN (SELECT slug FROM companion_retractions) AND slug NOT IN (SELECT slug FROM companion_audits) ORDER BY id DESC LIMIT ?1"
  ).bind(limit || 3).all();
  var res = { checked: 0, passed: 0, retracted: 0, withdrawn: 0, deferred: 0 };
  for (var p of (rows.results || [])) {
    if (!p.ground_text || String(p.ground_text).length < 500) {
      await recordAudit(env, p.slug, "unverifiable", "no-source-record", { judges: [], problems: ["no source material was recorded for this piece"] });
      await retractPiece(env, p.slug, "Withdrawn: no record of the source material this piece was written from exists, so its claims cannot be verified.", []);
      res.withdrawn++;
      continue;
    }
    var vr = await verifyPiece(env, pieceText(p), p.ground_text, "", "audit:" + p.slug, { noBalance: true });
    if (vr.unavailable) { res.deferred++; continue; }
    res.checked++;
    if (vr.ok) { await recordAudit(env, p.slug, "pass", vr.stage, vr); res.passed++; continue; }
    await recordAudit(env, p.slug, "fail", vr.stage, vr);
    await retractPiece(env, p.slug, "Retracted after an accuracy audit: the piece contained claims its source material does not support (" + vr.stage + " check).", vr.problems);
    res.retracted++;
  }
  return Object.assign({ ok: true }, res);
}
function renderRetraction(r, p, keyQS) {
  var claims = []; try { claims = JSON.parse(r.claims_json || "[]"); } catch (e) { claims = []; }
  var date = String(r.retracted_at || "").slice(0, 10);
  var list = claims.length ? "<p>Examples of what could not be verified:</p><ul>" + claims.slice(0, 5).map(function (c) { return "<li>" + escHtml(c) + "</li>"; }).join("") + "</ul>" : "";
  var body = "<div class=meta>Retracted " + escHtml(date) + "</div><h2>Retracted: " + escHtml(p && p.title || "this piece") + "</h2><p>" + escHtml(r.reason || "") +
    " Every piece is now checked against its source material by two independent reviewers before it is shown or mailed; earlier pieces are audited, and any that fail are withdrawn and listed on the <a href=/retractions" + (keyQS || "") + ">retractions page</a>.</p>" + list +
    "<footer><a href=/" + (keyQS || "") + ">back to index</a></footer>";
  return page("Retracted", shell(body), '<meta name="robots" content="noindex">');
}
function renderRetractions(rows, keyQS) {
  var items = (rows || []).map(function (r) { return "<li>" + escHtml(r.title || r.slug) + " &mdash; retracted " + escHtml(String(r.retracted_at || "").slice(0, 10)) + ". " + escHtml(r.reason || "") + "</li>"; }).join("");
  var body = "<h2>Corrections and retractions</h2><p>Pieces are shown only when their claims are supported by their source material. When one is found not to be, it is withdrawn and listed here.</p>" + (items ? "<ul>" + items + "</ul>" : "<p>No piece has been retracted.</p>") + "<footer><a href=/" + (keyQS || "") + ">back to index</a></footer>";
  return page("Retractions", shell(body), '<meta name="robots" content="noindex">');
}
function factRevisionPrompt(problems, ground) {
  return "FACT REVISION. Independent fact-checkers rejected the draft below. Every item in the list is a claim the source material does not support." + NL +
    "Return the SAME piece in the SAME output format (a single # heading with the title, then the prose), with each such name, date, figure or claim deleted, or replaced by reasoning that follows from the source material, or by a labelled hypothetical that names no real person, organisation, product, date or number. Add no new facts. Keep everything else, including the length." + NL + NL +
    "Problems:" + NL + "- " + problems.slice(0, 12).join(NL + "- ");
}

// COMPANION-VERIFY-1 (1.14.0): the publish path. Nothing is persisted before it passes (1) the editorial validation with the
// deterministic grounding check, (2) the adversarial reader, whose outage fails closed, and (3) the two-family fact-check, whose
// outage fails closed. There is no forced publish: when every draft fails, nothing is published and the stall detector says so.
var REVISE_BEFORE_MS = 42e4;
// COMPANION-FACT-PRUNE-1: a prune round starts only before 660 s, so the round (one review, at most REVIEW_TIMEOUT_MS) and the persist finish
// inside the 15-minute cron wall; reviewers answer in 1-3 s with reasoning off (FACTCHECK-NOTHINK-1).
var PRUNE_ROUNDS = 5;
var PRUNE_START_BEFORE_MS = 66e4;
// COMPANION-STALL-YIELD-1 (1.37.0, agent_issues 100064; 46 of 61 generation runs in the 24 h to 2026-10-19 11:50Z ended "time budget spent after 2
// attempts", the 11:00Z one at 734 s). The mirror of q08-signal-engine Q08-YIELD-1's repeat-class stop: a prune round that flags only the kinds
// of claim an earlier round already flagged and pruned, and no fewer of them, is the same defect again (the writer invents at a steady rate),
// so a further round, its full re-verification and the model revision that follows are not spent on the draft; the attempt ends and the next
// one writes a new draft. A claim has one of four classes, read from the claim text only (never from personal data): a figure (any digit, so a
// year, date, count or percentage), a quotation, a name (a capitalised word after the first) or an assertion (anything else).
// The loop is cut only after two prune rounds have been answered (PRUNE_REPEAT_AFTER), and never while the list is shrinking: a round that flags
// FEWER items than the one before is converging, and the documented 8, 8, 3 path that ends in a pass continues. The reviewers' list is capped at
// 8 items, so 8 after 8 can hide a shrinking longer list; it is cut only when that holds on the third verdict as well, i.e. 8, 8, 8.
// A round whose pruned draft is blocked by validation (the handoff trail r1 -7, r2 -6, r3 blocked: lede does not name the subject) while its
// classes recur does not keep the draft for the extension revision either.
var PRUNE_REPEAT_AFTER = 2;
function pruneClassOf(item) {
  var s = String(item || "").replace(/^\s*unsupported claim:\s*/i, "").replace(/^\**\s*(?:FACT|INFERENCE)\s*\**\s*[:\-]\s*/i, "");
  var cut = s.lastIndexOf(" -- "), claim = cut > 0 ? s.slice(0, cut) : s;
  if (/\d/.test(claim)) return "figure";
  if (/["“”]/.test(claim)) return "quotation";
  if (claim.trim().split(/\s+/).slice(1).some(function (w) { return /^[^a-z]*[A-Z]/.test(w) && w !== "I"; })) return "name";
  return "assertion";
}
function pruneClassesOf(problems) {
  var out = [];
  (problems || []).forEach(function (p) { var c = pruneClassOf(p); if (out.indexOf(c) < 0) out.push(c); });
  return out.sort();
}
// history: one { classes, n } per verdict an earlier prune round answered, oldest first; problems: the verdict now on the draft.
// Returns { classes, recurring, stop, why }: recurring when every class of this verdict was flagged before; stop when it is also no smaller than the verdict before.
function pruneRepeat(history, problems) {
  var classes = pruneClassesOf(problems), seen = {}, h = history || [];
  h.forEach(function (x) { (x.classes || []).forEach(function (c) { seen[c] = 1; }); });
  var recurring = h.length > 0 && classes.length > 0 && classes.every(function (c) { return seen[c]; });
  var n = (problems || []).length, prev = h.length ? h[h.length - 1].n : 0;
  var stop = recurring && h.length >= PRUNE_REPEAT_AFTER && n >= prev;
  return { classes: classes, recurring: recurring, stop: stop, why: recurring ? "repeat " + classes.join("/") + " (" + n + " items after " + prev + ")" : "" };
}
// COMPANION-STALL-YIELD-1: a run has GEN_BUDGET_MS and each attempt costs what the longest attempt of this run cost (compose, critique, fact-check,
// prune re-verifies and the revision all count). An attempt started with less than that left is cut off by the wall or ends in a rejection after
// the budget, and its AI spend buys nothing. Returns "" to go on, or the words for the stage row. The first attempt has no measure and always starts.
function attemptBudgetStop(elapsedMs, attemptCostMs, budgetMs) {
  var left = budgetMs - elapsedMs;
  if (!(attemptCostMs > 0) || left >= attemptCostMs) return "";
  return Math.max(0, Math.round(left / 1000)) + " s left, an attempt cost " + Math.round(attemptCostMs / 1000) + " s";
}
// COMPANION-SERIAL-TITLE-1 (agent_issues 1000299, pillar personal; patch): the serial prompt tells the writer to keep the running work's
// title, and the duplicate-title check in generate() then rejected a draft for doing exactly that, after a full 1,800 to 2,400 word compose,
// and told the writer to choose a completely different title, which the prompt forbids: the same input retried against a check it cannot
// pass. For the serial form the installment title is now set here, from the running title and the number of chapters already published
// plus one ("<running title>, part N"); the duplicate-title check is unchanged and still runs on the result, and every other form is
// untouched. A title the writer chose that is not the running title is left alone. The counts in the issue (167 rejections in 14 days,
// 153 full composes with no piece on 2026-10-17, 129 with one on 2026-10-24) were read by the issue's audit, not re-read here.
var SERIAL_PART_SUFFIX_RE = /[\s,:;.\-–—]*\(?\b(?:part|installment|chapter|episode)\s+(?:\d{1,6}|[ivx]{1,5})\)?\s*$/i;
var SERIAL_TITLE_BUMP_MAX = 25;
function serialBaseTitle(t) {
  var s = String(t == null ? "" : t).replace(/\s+/g, " ").trim();
  var b = s.replace(SERIAL_PART_SUFFIX_RE, "").trim();
  return b || s;
}
// chapters already published: a number from companion_series.chapters; null, empty, text, negative, NaN or absurd counts are 0
function serialChaptersDone(chapters) {
  var n = Number(chapters);
  return Number.isFinite(n) && n > 0 && n <= 99999 ? Math.floor(n) : 0;
}
function serialInstallmentTitle(runningTitle, chapters) {
  var base = serialBaseTitle(runningTitle).slice(0, 270);
  if (!base) return "";
  return base + ", part " + (serialChaptersDone(chapters) + 1);
}
function serialTitleKey(t) { return serialBaseTitle(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
// the writer's title is the running title (case, punctuation and an installment suffix aside)
function serialTitleMatches(title, runningTitle) {
  var a = serialTitleKey(title);
  return a.length > 0 && a === serialTitleKey(runningTitle);
}
// the piece with its installment title; the same object when it is not a serial piece, there is no running work or the writer chose another title
function withInstallmentTitle(piece, form, run) {
  if (form !== "serial" || !piece || !run || !serialTitleMatches(piece.title, run.title)) return piece;
  var t = serialInstallmentTitle(run.title, run.chapters);
  return t && t !== piece.title ? Object.assign({}, piece, { title: t }) : piece;
}
// the same, stepping past a number a published piece already holds (a series row whose count fell behind its pieces would otherwise
// reject the same title on every run); titleExists(lowercased title) answers from companion_pieces
async function freeInstallmentPiece(piece, form, run, titleExists) {
  var first = withInstallmentTitle(piece, form, run);
  if (first === piece) return piece;
  var done = serialChaptersDone(run.chapters);
  for (var k = 0; k < SERIAL_TITLE_BUMP_MAX; k++) {
    var cand = serialInstallmentTitle(run.title, done + k);
    var taken = false;
    try { taken = await titleExists(cand.toLowerCase().trim()); } catch (eTx) { logCaught("freeInstallmentPiece", eTx); }
    if (!taken) return cand === piece.title ? piece : Object.assign({}, piece, { title: cand });
  }
  return first;
}
async function generate(env, form, opts) {
  var t0 = Date.now();
  opts = opts || {};
  var gg = await criticGroundingGates(env); // GATE-SEPARATION-1: false unless ops_config companion_critic_grounding_gate is on
  var topic = null;
  var model = "";
  try {
    await ensureSchema(env);
    await logRun(env, form, "", "", "stage", "schema ok, writer order " + await loadWriterOrder(env), Date.now() - t0); // WRITER-FAMILY-1
    topic = await pickTopic(env, form);
    await logRun(env, form, "", topic.id, "stage", "topic", Date.now() - t0);
    var profile = await loadProfile(env);
    var life = await loadLife(env);
    var continuity = await loadContinuity(env, form);
    await logRun(env, form, "", topic.id, "stage", "context " + profile.length + "/" + life.length + "/" + continuity.length, Date.now() - t0);
    var anchors = (topic.anchors || []).slice();
    var serialRun = null; // COMPANION-SERIAL-TITLE-1: the running work's title and chapter count, null for a first installment
    if (form === "serial") {
      try {
        var sr = await env.PERSONAL.prepare("SELECT title, thesis, last_lines, chapters FROM companion_series ORDER BY id DESC LIMIT 1").first();
        if (sr) {
          anchors.push({ kind: "previous installment", ref: "previous installment", title: squish(sr.title || ""), text: squish(String(sr.thesis || "") + " " + String(sr.last_lines || "")).slice(0, 1600) });
          serialRun = { title: squish(sr.title || ""), chapters: sr.chapters };
        }
      } catch (eSr) { logCaught("generate", eSr); }
    }
    var installmentTitle = ""; // COMPANION-SERIAL-TITLE-1: the title this attempt gave the installment, "" when none
    await logRun(env, form, "", topic.id, "stage", "anchorKinds " + anchors.map(function(x) {
      return x.kind;
    }).join(","), Date.now() - t0);
    await logRun(env, form, "", topic.id, "stage", "anchors " + anchors.length + (topic.diag ? " (" + topic.diag + ")" : ""), Date.now() - t0);
    if (anchors.length < 2) {
      await logRun(env, form, "", topic.id, "blocked", "insufficient anchors: " + (topic.diag || "no source returned usable text"), Date.now() - t0);
      return { ok: false, error: "insufficient anchors: " + (topic.diag || "") };
    }
    var ground = anchorsText(anchors);
    var vopts = { subject: topic.a }; // COMPANION-LEDE-1: the lede must name the subject (essay and notes)
    var repairOpts = { subject: topic.a, floorShare: REPAIR_FLOOR_SHARE };
    var attempt = 0;
    var best = null;
    var feedback = "";
    var failClosed = "";
    var attemptStartedAt = 0, attemptCostMs = 0; // COMPANION-STALL-YIELD-1: the longest attempt of this run, measured
    while (attempt < 5) {
      if (attemptStartedAt) attemptCostMs = Math.max(attemptCostMs, Date.now() - attemptStartedAt);
      // COMPANION-FALLBACK-TUNE-1: no new attempt once GEN_BUDGET_MS is spent, so the run ends with a logged failure
      // instead of being killed by the 15-minute cron wall mid-attempt (2026-10-07 12:00Z run: killed in attempt 3).
      if (Date.now() - t0 > GEN_BUDGET_MS) {
        await logRun(env, form, model, topic.id, "stage", "time budget spent after " + attempt + " attempts", Date.now() - t0);
        break;
      }
      // COMPANION-STALL-YIELD-1: nor an attempt with less budget left than the longest attempt of this run cost. The row keeps the
      // "time budget spent" lead, so the stall digest and its day query count it as the time-budget stage they already know.
      var budgetStop = attemptBudgetStop(Date.now() - t0, attemptCostMs, GEN_BUDGET_MS);
      if (budgetStop) {
        await logRun(env, form, model, topic.id, "stage", "time budget spent after " + attempt + " attempts (" + budgetStop + "; no attempt is started that cannot finish inside the budget)", Date.now() - t0);
        break;
      }
      attempt++;
      attemptStartedAt = Date.now();
      await logRun(env, form, "", topic.id, "stage", "compose attempt " + attempt, Date.now() - t0);
      var comp = await composePiece(env, form, topic, anchors, life, profile, continuity, feedback);
      model = comp.model;
      await logRun(env, form, model, topic.id, "stage", "composed " + String(comp.piece && comp.piece.body_md || "").length + (comp.error ? " err: " + String(comp.error).slice(0, 400) : ""), Date.now() - t0);
      var piece = comp.piece;
      if (!piece) {
        continue;
      }
      var split = splitLongLede(piece);
      if (split !== piece) {
        await logRun(env, form, model, topic.id, "stage", "lede split: " + String(piece.lede || "").split(/\s+/).filter(Boolean).length + " -> " + String(split.lede || "").split(/\s+/).filter(Boolean).length + " words", Date.now() - t0);
        piece = split;
      }
      piece = withAutoMark(piece); // ANALYSIS-AUTO-1: the critique row reports whether the line was written or placed
      var v = validatePiece(piece, form, ground, vopts);
      if (!v.ok) {
        var gr = repairGroundingDraft(piece, v.problems, form, ground, vopts);
        if (gr && gr.ok) {
          await logRun(env, form, model, topic.id, "stage", "grounding repair: removed " + gr.removed + " sentences", Date.now() - t0);
          piece = gr.piece;
          v = gr.v;
        } else if (gr && gr.piece) {
          // COMPANION-PUBLISH-REPAIR-1: only the length is left; the extend path below gets the cleaned draft, not the one with the flagged sentences
          await logRun(env, form, model, topic.id, "stage", "grounding repair: removed " + gr.removed + " sentences; still short (" + gr.v.problems.join("; ") + "), extending the cleaned draft", Date.now() - t0);
          piece = gr.piece;
          v = gr.v;
        }
      }
      if (!v.ok) {
        await logRun(env, form, model, topic.id, "rejected", "validate: " + v.problems.join("; ") + " || in context: " + problemContext(String(piece.title || "") + "\n" + String(piece.lede || "") + "\n" + String(piece.body_md || ""), v.problems) + " || raw: " + String(comp.raw || "").slice(0, 300), Date.now() - t0);
        feedback = "The previous draft failed validation for these reasons: " + v.problems.join("; ") + ". Fix them and try again. Remove every name, year and figure that is not in the source material.";
        // COMPANION-FALLBACK-TUNE-1: a draft whose only problem is being short is extended, not rewritten from scratch
        // (12:00Z run: gpt-oss drafts of 1591 and 1764 words against the 2000-word essay floor were thrown away).
        var shortOnly = expandFeedback(v.problems, form, piece);
        if (shortOnly) feedback = shortOnly;
        else {
          // COMPANION-STALL-YIELD-1 (1.37.0): and one whose only problem is being over the ceiling is cut, not rewritten
          var longOnly = shortenFeedback(v.problems, form, piece);
          if (longOnly) {
            feedback = longOnly;
            await logRun(env, form, model, topic.id, "stage", "shorten: " + v.problems[0] + " against a ceiling of " + LENGTH_CEILING[form] + ", the next attempt cuts this draft instead of rewriting it", Date.now() - t0);
          }
        }
        continue;
      }
      var dup = await similarExists(env, String(piece.title) + NL + String(piece.body_md), null);
      if (dup) {
        await logRun(env, form, model, topic.id, "rejected", "too similar to " + dup.slug + " (" + dup.score.toFixed(3) + ")", Date.now() - t0);
        continue;
      }
      // LIKE-PATTERN-50-1 (1.25.4): D1 refuses a LIKE or GLOB pattern over 50 bytes ("LIKE or GLOB pattern too complex", worker_logs
      // 2026-10-14 03:03 and 03:09), so a 60-character key plus "%" skipped this check on every long lede; 48 + "%" fits.
      var openKey = String(piece.lede || String(piece.body_md || "").split(NL)[0] || "").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 48);
      if (openKey.length > 40) {
        try {
          var odCheck = await env.PERSONAL.prepare(
            "SELECT slug FROM companion_pieces WHERE replace(replace(replace(lower(substr(lede,1,120)),' ',''),'.',''),'-','') LIKE ? LIMIT 1"
          ).bind(openKey + "%").all();
          if ((odCheck.results || []).length > 0) {
            await logRun(env, form, model, topic.id, "rejected", "duplicate opening: same lede as existing piece", Date.now() - t0);
            feedback = "The previous draft opened with the same sentences as an existing piece. Open on a different particular.";
            continue;
          }
        } catch (e) { logCaught("generate", e); }
      }
      // COMPANION-SERIAL-TITLE-1: a serial installment takes the running title with its number before the duplicate-title check below,
      // which stays as it was for the result and for every other form
      installmentTitle = "";
      if (form === "serial" && serialRun) {
        var sPiece = await freeInstallmentPiece(piece, form, serialRun, async function (low) {
          var tx = await env.PERSONAL.prepare("SELECT slug FROM companion_pieces WHERE lower(title) = ? LIMIT 1").bind(low).all();
          return (tx.results || []).length > 0;
        });
        if (sPiece !== piece) {
          piece = sPiece;
          installmentTitle = sPiece.title;
          await logRun(env, form, model, topic.id, "stage", "serial title: the installment takes the running title with its number (COMPANION-SERIAL-TITLE-1)", Date.now() - t0);
        }
      }
      var titleLow = String(piece.title || "").toLowerCase().trim();
      if (titleLow.length > 4) {
        try {
          var dtCheck = await env.PERSONAL.prepare(
            "SELECT slug FROM companion_pieces WHERE lower(title) = ? LIMIT 1"
          ).bind(titleLow).all();
          if ((dtCheck.results || []).length > 0) {
            await logRun(env, form, model, topic.id, "rejected", "duplicate title: " + piece.title, Date.now() - t0);
            feedback = "The previous draft had a title that already exists. Choose a completely different angle and title.";
            continue;
          }
        } catch (e) { logCaught("generate", e); }
      }
      await logRun(env, form, model, topic.id, "stage", "critique (" + analysisSplitInfo(splitText(piece)) + ")", Date.now() - t0); // ANALYSIS-SPLIT-DIAG-1
      var crit = await critiquePiece(env, piece, form, ground);
      if (!crit) {
        // fail closed: an unavailable reader is not a pass (before 1.14.0 a missing critique scored a neutral 5 and passed)
        failClosed = "critic unavailable";
        await logRun(env, form, model, topic.id, "rejected", "critic unavailable (fail closed)", Date.now() - t0);
        continue;
      }
      var q = crit;
      var sc = gateWorst(q, form, gg), worst = sc.worst, worstName = sc.worstName;
      if (sc.missing) failClosed = "critic returned no score";
      var floorForForm = form === "notes" ? ACCEPT_FLOOR_NOTES : ACCEPT_FLOOR_ESSAY;
      // REFRAME-REPAIR-1 (1.23.0): reasoning stated as fact is rewritten as reasoning before any sentence is deleted for it
      // REFRAME-TRIGGER-2 (1.23.3, companion_runs 5783 and 5791: "systems=3 :: invents causal mechanisms", "objection=2 :: invents fiscal
      // mechanisms"): the critic folds invented mechanisms into whichever score is lowest, so the edit also runs on a systems rejection or
      // whenever the critic quotes text it calls invented; it is still kept only when it passes or grounding stays its weakest score
      if (worst < floorForForm && (worstName === "grounding" || worstName === "argument" || worstName === "systems" || criticQuotes(q.why, pieceText(piece), q.invented).length > 0) && Date.now() - t0 < REFRAME_START_BEFORE_MS) {
        var rf = await reframePiece(env, piece, ground, q.why, q.invented);
        var rfv = rf.piece ? validatePiece(rf.piece, form, ground, repairOpts) : null;
        if (rf.piece && !rfv.ok) rf.why = "edit failed validation: " + rfv.problems.slice(0, 2).join("; ").slice(0, 160);
        if (rfv && rfv.ok) {
          await logRun(env, form, model, topic.id, "stage", "reframe: " + rf.why + ", re-reading (" + analysisSplitInfo(splitText(rf.piece)) + ")", Date.now() - t0);
          var critR = await critiquePiece(env, rf.piece, form, ground);
          var scR = critR ? gateWorst(critR, form, gg) : null;
          // ANALYSIS-REMARK-1 (1.23.1, companion_runs 5743-5744: an edit read voice=1 replaced a grounding=0 draft and so skipped the prune): the
          // edit is kept when the critic passes it, or when grounding is still its weakest score and no lower, so the critic prune continues on it
          if (scR && !scR.missing && (scR.worst >= floorForForm || (scR.worstName === "grounding" && scR.worst >= worst))) { piece = rf.piece; v = rfv; q = critR; sc = scR; worst = sc.worst; worstName = sc.worstName; }
          else await logRun(env, form, model, topic.id, "stage", "reframe kept the draft: " + (scR ? "the edit read " + scR.worstName + "=" + scR.worst : "critic unavailable"), Date.now() - t0);
        } else await logRun(env, form, model, topic.id, "stage", "reframe kept the draft: " + rf.why, Date.now() - t0);
      }
      // CRITIC-PRUNE-1 (1.21.3, companion_runs 5455-5507 of 2026-10-13 13:00-14:06 UTC: nine of ten drafts were rejected by the critic for
      // one or two invented facts it quoted, e.g. "Fourteen companies serve under the battalion", and each rejection threw the whole draft
      // away for a new one with new inventions). A grounding rejection that quotes text the draft contains deletes those sentences, the way
      // the fact-check prune does, and the critic reads the cleaned draft once more; the two-family fact-check still follows.
      // CRITIC-PRUNE-2 (1.21.4, companion_runs 5519-5532 of 2026-10-13 15:00 UTC): each re-read found one more invented detail (a motive
      // stated as fact, a misquoted line, an inflated phrase), the way the fact-check prune converges over rounds (8, 8, 3); the prune
      // repeats up to CRITIC_PRUNE_ROUNDS times while the critic quotes text the draft contains and the cleaned draft holds its floors.
      if (worst < floorForForm && worstName === "grounding") {
        var rq = criticQuotes(q.why, pieceText(piece), q.invented);
        // RUBRIC-NO-QUOTE-1 (1.26.1): a grounding 0 that quotes no passage the piece contains named no invented claim (companion_runs 6103:
        // "the piece never mentions these specific details", an omission); the same critic re-reads with that rule too
        var rqSrc = rq.length ? quotesAllSourced(ground, rq) : null; // CRITIC-QUOTE-SOURCED-1
        var rrNote = !rq.length ? rubricNoQuoteNote() : analysisSplitOk(splitText(piece)) && quotesAllInAnalysis(piece, rq) ? rubricRereadNote(rq) : rqSrc ? sourcedRereadNote(rqSrc) : "";
        if (rrNote) {
          var critRR = await critiquePiece(env, piece, form, ground, rrNote);
          var scRR = critRR ? gateWorst(critRR, form, gg) : null;
          await logRun(env, form, model, topic.id, "stage", "rubric re-read: " + (rq.length ? rq.length + (rqSrc && rrNote.indexOf("the source material states each") >= 0 ? " quoted passages the source states" : " quoted passages all in the marked analysis") : "no quoted passage the piece contains") + "; " + (scRR ? (scRR.missing ? "no score" : scRR.worstName + "=" + scRR.worst) : "critic unavailable"), Date.now() - t0);
          if (scRR && !scRR.missing) { critRR.rubric_reread = { quotes: rq.length, first: worstName + "=" + worst }; q = critRR; sc = scRR; worst = sc.worst; worstName = sc.worstName; }
        }
      }
      for (var cround = 1; cround <= CRITIC_PRUNE_ROUNDS && worst < floorForForm && worstName === "grounding"; cround++) {
        var cq = criticQuotes(q.why, pieceText(piece), q.invented);
        var cpr = cq.length ? pruneUnsupported(piece, cq.map(function (x) { return "unsupported claim: " + x; })) : null;
        var cpv = cpr && cpr.removed.length ? validatePiece(cpr.piece, form, ground, repairOpts) : null;
        if (!(cpv && cpv.ok)) break;
        await logRun(env, form, model, topic.id, "stage", "critic prune r" + cround + ": removed " + cpr.removed.length + " sentences, re-reading", Date.now() - t0);
        var crit2 = await critiquePiece(env, cpr.piece, form, ground);
        if (!crit2) break;
        piece = cpr.piece; v = cpv; q = crit2;
        sc = gateWorst(q, form, gg); worst = sc.worst; worstName = sc.worstName;
        if (sc.missing) failClosed = "critic returned no score";
      }
      if (worst < floorForForm) {
        await logRun(env, form, model, topic.id, "rejected", "critique " + worstName + "=" + worst + " :: " + String(q.why || ""), Date.now() - t0);
        feedback = "REVISE the previous draft: keep its strong parts, fix its weak ones. Previous scores: specificity=" + q.specificity + " argument=" + q.argument + " objection=" + q.objection + " voice=" + q.voice + (q.grounding !== undefined ? " grounding=" + q.grounding : "") + (q.systems !== undefined ? " systems=" + q.systems : "") + ". Weakest was " + worstName + ". Why: " + String(q.why || "") + ".";
        continue;
      }
      // GATE-SEPARATION-1: the critic's grounding is advisory; the sentences it quotes as invented are deleted once when the draft can spare
      // them (it still validates at the repair floor), and the fact-check below judges accuracy on the cleaned draft
      if (!gg && Number.isFinite(Number(q.grounding)) && Number(q.grounding) < ACCEPT_FLOOR_NOTES) {
        var gq = criticQuotes(q.why, pieceText(piece), q.invented);
        var gpr = gq.length ? pruneUnsupported(piece, gq.map(function (x) { return "unsupported claim: " + x; })) : null;
        var gpv = gpr && gpr.removed.length ? validatePiece(gpr.piece, form, ground, repairOpts) : null;
        if (gpv && gpv.ok) { piece = gpr.piece; v = gpv; }
        await logRun(env, form, model, topic.id, "stage", "critic grounding " + q.grounding + " (advisory): " + (gpv && gpv.ok ? "removed " + gpr.removed.length + " quoted sentences" : gq.length ? "kept the draft (" + (gpv ? gpv.problems.slice(0, 2).join("; ").slice(0, 120) : "nothing located") + ")" : "no quoted passage") + "; the fact-check judges accuracy", Date.now() - t0);
      }
      // the fact-check: two reviewers from other model families; one corrective revision when time allows
      await logRun(env, form, model, topic.id, "stage", "fact-check", Date.now() - t0);
      var vr = await verifyPiece(env, pieceText(piece), ground, model, topic.id + ":" + attempt, {});
      var finalPiece = piece;
      // COMPANION-FACT-PRUNE-1 (1.17.0): before any model revision, delete exactly the sentences the reviewers quoted as FACT errors and
      // verify the result again in full (grounding and both reviewers), up to PRUNE_ROUNDS rounds while a round can still finish inside the
      // cron wall. The pruned draft is held to REPAIR_FLOOR_SHARE of the floor and must keep a lede that names the subject.
      var pruneTrail = [];
      // PRUNE-THEN-EXTEND-1 (1.19.4, run 5389-5391 of 2026-10-13): the prune deleted the 9 quoted sentences and was blocked only because
      // the cleaned draft fell to 701 words; the corrective revision then rewrote the unpruned draft and drew new objections. A cleaned
      // draft whose only problem is its length is kept, and the revision extends it from the source instead of revising the original.
      var prunedShort = null;
      var pruneSeen = [], pruneStopped = ""; // COMPANION-STALL-YIELD-1: { classes, n } of each verdict a prune round answered; why the loop was cut
      for (var pround = 1; pround <= PRUNE_ROUNDS && !vr.ok && !vr.unavailable && vr.stage === "factcheck" && Date.now() - t0 < PRUNE_START_BEFORE_MS; pround++) {
        var prep = pruneRepeat(pruneSeen, vr.problems);
        if (prep.stop) { pruneStopped = prep.why; pruneTrail.push("r" + pround + " stopped: " + prep.why + ", no further round, revision or extension is spent on this draft"); break; }
        var pr = pruneUnsupported(finalPiece, vr.problems, { headings: true }); // HEADING-LABEL-1
        if (!pr.removed.length) { pruneTrail.push("r" + pround + " located nothing"); break; }
        var pv = validatePiece(pr.piece, form, ground, repairOpts);
        if (!pv.ok) {
          pruneTrail.push("r" + pround + " -" + pr.removed.length + " blocked: " + pv.problems.slice(0, 2).join("; ").slice(0, 120));
          // COMPANION-STALL-YIELD-1 (1.37.0): blocked while the classes of claim recur (r1 -7, r2 -6, r3 blocked): the extension is not spent
          if (prep.recurring) { pruneStopped = prep.why; pruneTrail.push("r" + pround + " stopped: " + prep.why + " and the pruned draft is blocked, no revision or extension is spent on this draft"); break; }
          // LEDE-PRUNE-EXTEND-1 (1.21.6): a cleaned draft blocked only by its length and/or a lede that lost the subject's name is kept too
          if (pruneBlockFixable(pv.problems, form)) prunedShort = { piece: pr.piece, words: pv.words, problems: pv.problems };
          break;
        }
        pruneSeen.push({ classes: prep.classes, n: (vr.problems || []).length });
        pruneTrail.push("r" + pround + " -" + pr.removed.length + " (" + pv.words + " words)");
        await logRun(env, form, model, topic.id, "stage", "fact prune r" + pround + ": removed " + pr.removed.length + " sentences, re-verifying", Date.now() - t0);
        finalPiece = pr.piece; v = pv;
        vr = await verifyPiece(env, pieceText(finalPiece), ground, model, topic.id + ":" + attempt + ":p" + pround, {});
      }
      if (pruneTrail.length) await logRun(env, form, model, topic.id, "stage", "fact prune trail: " + pruneTrail.join(", ") + (vr.ok ? " -> pass" : ""), Date.now() - t0);
      if (!vr.ok && !vr.unavailable && !pruneStopped && Date.now() - t0 < REVISE_BEFORE_MS) {
        var extendFb = prunedShort ? pruneRepairFeedback(prunedShort.problems, form, { title: prunedShort.piece.title, body_md: (prunedShort.piece.lede ? prunedShort.piece.lede + NL + NL : "") + prunedShort.piece.body_md }, topic.a) : null;
        await logRun(env, form, model, topic.id, "rejected", "fact-check " + vr.stage + ": " + vr.problems.slice(0, 4).join(" | ").slice(0, 600) + (prunedShort && extendFb ? " (extending the pruned draft, " + prunedShort.words + " words: " + prunedShort.problems.map(function (x) { return String(x).slice(0, 40); }).join("; ") + ")" : " (one corrective revision)"), Date.now() - t0);
        if (prunedShort && extendFb) finalPiece = prunedShort.piece;
        var rev = extendFb
          ? await composePiece(env, form, topic, anchors, life, profile, continuity, extendFb + NL + NL + "Add no name, date, figure or claim that the source material does not state.")
          : await composePiece(env, form, topic, anchors, life, profile, continuity, "", { title: finalPiece.title, body_md: (finalPiece.lede ? finalPiece.lede + NL + NL : "") + finalPiece.body_md, problems: vr.problems, note: vr.stage === "balance" ? afBalanceRevisionNote(vr.balance && vr.balance.reason) : "" });
        var rp = rev && rev.piece ? withAutoMark(splitLongLede(rev.piece)) : null; // ANALYSIS-AUTO-1
        // the revision keeps the draft's title when it dropped the "# " line (composePiece then falls back to the topic name)
        if (rp && !/^\s*(?:```[^\n]*\n)?\s*# /.test(String(rev.raw || ""))) rp.title = finalPiece.title;
        var rv = rp ? validatePiece(rp, form, ground, repairOpts) : { ok: false, problems: ["fact revision produced no draft"] };
        // REVISION-REPAIR-1 (1.21.2, companion_runs 5486-5488 of 2026-10-13 14:00 UTC): the first draft to pass the critic since 1.20.0 lost
        // 8 fact-check sentences to the prune (687 words), was extended from the source, and the extension failed validation outright; a
        // fresh draft goes through the deterministic grounding repair before it is judged, the revision did not. It does now.
        if (rp && !rv.ok) {
          var rgr = repairGroundingDraft(rp, rv.problems, form, ground, repairOpts);
          if (rgr && rgr.ok) {
            await logRun(env, form, model, topic.id, "stage", "revision repair: removed " + rgr.removed + " sentences", Date.now() - t0);
            rp = rgr.piece; rv = rgr.v;
          }
        }
        if (rp && rv.ok) {
          vr = await verifyPiece(env, pieceText(rp), ground, rev.model, topic.id + ":" + attempt + ":rev", {});
          if (vr.ok) { finalPiece = rp; model = rev.model; v = rv; }
        } else {
          // the revision's own problems first: they are why it failed, and the log keeps only the first 600 characters
          vr = { ok: false, stage: "revision", problems: (rv.problems || []).concat(vr.problems || []), judges: [], unavailable: false };
        }
      }
      if (vr.unavailable) {
        failClosed = "fact-check unavailable";
        await logRun(env, form, model, topic.id, "rejected", "fact-check unavailable (fail closed): " + vr.problems.join("; ").slice(0, 300), Date.now() - t0);
        break;
      }
      if (!vr.ok) {
        await logRun(env, form, model, topic.id, "rejected", "fact-check " + vr.stage + ": " + vr.problems.slice(0, 4).join(" | ").slice(0, 600), Date.now() - t0);
        feedback = vr.stage === "balance" ? afBalanceRetryFeedback(vr.balance && vr.balance.reason) : "The previous draft was rejected by independent fact-checkers; every item is a claim the source material does not support. Write a new draft that uses only facts copied word-for-word from the source material with a quoted citation after each, and no outside knowledge: " + vr.problems.slice(0, 4).join(" | ");
        continue;
      }
      // COMPANION-FACT-INFERENCE-1: sentences the reviewers listed as the piece's own reasoning are deleted when the draft can spare them
      // (it still validates at the repair floor); deletion cannot add a fact, so no second review is needed.
      if ((vr.inferences || []).length) {
        var pi = pruneUnsupported(finalPiece, vr.inferences.map(function (u) { return "unsupported claim: " + u; }));
        var piv = pi.removed.length ? validatePiece(pi.piece, form, ground, repairOpts) : null;
        if (piv && piv.ok) { finalPiece = pi.piece; v = piv; }
        await logRun(env, form, model, topic.id, "stage", "inference prune: " + (piv && piv.ok ? "removed " + pi.removed.length + " sentences" : pi.removed.length ? "kept (" + piv.problems.slice(0, 2).join("; ").slice(0, 120) + ")" : "located nothing") + " of " + vr.inferences.length + " items", Date.now() - t0);
      }
      // FINAL-READ-1 (1.22.4; session_01BCBpN3cZdS57dweqCs9rwt audit 2026-10-13 18:40 UTC, the q08-signal-engine 0.21.0 failure mode
      // outward-prose-unjudged-final-text): the critic read the draft before the fact-check, and the fact prune, the extension or
      // revision and the inference prune then changed the text that was stored, with the earlier draft's scores. When the text to be
      // stored differs from the critic's last read, the critic reads it again; below the floor, or no reader, the attempt is rejected
      // (fail closed), and the stored scores are this final read's.
      if (pieceText(finalPiece) !== pieceText(piece)) {
        await logRun(env, form, model, topic.id, "stage", "final read (" + analysisSplitInfo(splitText(finalPiece)) + ")", Date.now() - t0);
        var qf = await critiquePiece(env, finalPiece, form, ground);
        if (!qf) {
          failClosed = "critic unavailable";
          await logRun(env, form, model, topic.id, "rejected", "final read: critic unavailable (fail closed)", Date.now() - t0);
          continue;
        }
        var sfin = gateWorst(qf, form, gg);
        // ANALYSIS-RULE-REREAD-1: the final read gets the same one rubric re-read when its grounding quotes all lie in the marked analysis
        if (!sfin.missing && sfin.worst < floorForForm && sfin.worstName === "grounding") {
          var rqf = criticQuotes(qf.why, pieceText(finalPiece), qf.invented);
          var rqfSrc = rqf.length ? quotesAllSourced(ground, rqf) : null; // CRITIC-QUOTE-SOURCED-1
          var rrNoteF = !rqf.length ? rubricNoQuoteNote() : analysisSplitOk(splitText(finalPiece)) && quotesAllInAnalysis(finalPiece, rqf) ? rubricRereadNote(rqf) : rqfSrc ? sourcedRereadNote(rqfSrc) : "";
          if (rrNoteF) {
            var qfr = await critiquePiece(env, finalPiece, form, ground, rrNoteF);
            var sfr = qfr ? gateWorst(qfr, form, gg) : null;
            await logRun(env, form, model, topic.id, "stage", "final rubric re-read: " + (rqf.length ? rqf.length + (rqfSrc && rrNoteF.indexOf("the source material states each") >= 0 ? " quoted passages the source states" : " quoted passages all in the marked analysis") : "no quoted passage the piece contains") + "; " + (sfr ? (sfr.missing ? "no score" : sfr.worstName + "=" + sfr.worst) : "critic unavailable"), Date.now() - t0);
            if (sfr && !sfr.missing) { qfr.rubric_reread = { quotes: rqf.length, first: sfin.worstName + "=" + sfin.worst }; qf = qfr; sfin = sfr; }
          }
        }
        if (sfin.missing || sfin.worst < floorForForm) {
          await logRun(env, form, model, topic.id, "rejected", "final read " + sfin.worstName + "=" + sfin.worst + " :: " + String(qf.why || ""), Date.now() - t0);
          feedback = "REVISE the previous draft: keep its strong parts, fix its weak ones. The final reading of the fact-checked text scored " + sfin.worstName + "=" + sfin.worst + ". Why: " + String(qf.why || "") + ".";
          continue;
        }
        q = qf;
      }
      q.gate = "passed";
      q.factcheck = { stage: vr.stage, models: (vr.judges || []).map(function (j) { return j.model; }), pruned: pruneTrail.join(", ") };
      // EK-3: the even-keel result is stored with the piece (quality_json.balance) and as companion_audits.balance_score; a check that could not run says so
      q.balance = afBalanceRecord(vr.balance);
      await logRun(env, form, model, topic.id, "stage", "even-keel: " + (q.balance.state === "unavailable" ? "unavailable (" + q.balance.reason + "), published after the grounding check and both fact-check judges passed" : q.balance.state + " " + q.balance.score + " by " + String(q.balance.model).split("/").pop() + " (" + q.balance.family + ")"), Date.now() - t0);
      // COMPANION-SERIAL-TITLE-1: a reframe, a prune or the fact revision can hand the title back as the bare running title
      if (installmentTitle && finalPiece.title !== installmentTitle && serialTitleMatches(finalPiece.title, serialRun && serialRun.title)) finalPiece = Object.assign({}, finalPiece, { title: installmentTitle });
      best = { piece: finalPiece, quality: q, words: v.words, vr: vr };
      break;
    }
    if (!best) {
      await logRun(env, form, model, topic.id, "failed", "no piece survived the gate" + (failClosed ? " (" + failClosed + ")" : ""), Date.now() - t0);
      return { ok: false, error: "no piece survived the gate" + (failClosed ? " (" + failClosed + ")" : "") };
    }
    var slug = await persistPiece(env, best.piece, form, topic, model, best.quality, best.words, ground);
    await recordAudit(env, slug, "pass", best.vr.stage, best.vr);
    if (topic.cacheId) { try { await env.PERSONAL.prepare("UPDATE companion_anchor_cache SET done = 1 WHERE id = ?").bind(topic.cacheId).run(); } catch (eCd) { logCaught("top", eCd); } }
    await logRun(env, form, model, topic.id, "ok", slug, Date.now() - t0);
    return { ok: true, slug, form, title: best.piece.title, words: best.words, quality: best.quality, topic: topic.id, model };
  } catch (e) {
    await logRun(env, form, model, topic ? topic.id : "", "error", String(e && e.message || e), Date.now() - t0);
    return { ok: false, error: String(e && e.message || e) };
  }
}
__name(generate, "generate");
__name2(generate, "generate");
__name22(generate, "generate");
// ---- CRON-SINGLE-TRIGGER-1:BEGIN (pure; replayed by scripts/cron-single-trigger.test.mjs)
// CRON-SINGLE-TRIGGER-1 (2026-10-02, #1785, pillar: core). The account held 84 cron expressions against the fleet budget
// of 50. This worker now registers ONE hourly trigger; each tick runs every entry of CRON_TABLE (the former trigger list,
// unchanged) that fired in the hour ending at the tick, through the same dispatcher as before. An entry on the hour runs
// at its minute; one at :15 or :30 runs at the next full hour. Hourly keeps the 15-minute CPU limit of a cron trigger.
var TICK_CRON = "0 * * * *";
var CRON_TABLE = ["0 * * * *", "0 21 * * *"];
var TICK_PARALLEL = false;
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
// COMPANION-PUBLISH-STALL-AUTO-1 (1.13.0, 2026-10-07, pillar core): reading.q08.org went silent for 48h (2026-10-05 08:06Z
// onward) while the steward wrote "collapse" to companion_runs every hour and nothing outside this worker read it. The
// q08 stallDetector pattern, ported: every hourly tick writes companion_hours_since_last_piece into
// qnfo-audit.metric_registry, files one agent_issue when no piece landed for STALL_MIN minutes and the last two generation
// runs failed (with their causes), and closes it with evidence when a piece lands. No model call.
// SLA-120M-COMPANION-1 (1.25.5, agent_issues 2565; owner directive 2026-10-14: "No SLA shall ever exceed 120 minutes", measured at
// 10-minute resolution): the stall issue is filed after 120 minutes without a piece while the last two generation runs failed (was 12 h),
// and closed once a piece is younger than that. The hourly metric keeps its name and unit for its readers.
// COMPANION-STALL-YIELD-1 (1.37.0, agent_issues 100064): STALL_MIN is 120 again (PR 2745 raised it to 180 and changed no yield; 5099dca3
// restored it and stall-detector.test.mjs now pins the 119/121-minute boundary). The closer no longer closes on one piece: 99975 was closed
// by the 04:04:54Z piece and 100064 was filed 07:00:43Z, three hours later, the eighth refile since 2026-10-07, so the issue's age,
// evidence and priority restarted each time while the 08, 12 and 16 UTC slots published nothing. A calendar window cannot tell a recovery from
// an ordinary gap (the piece before 99975's closer was 15.6 h old, so a 24 h window passed it), so recovery is judged against the stall itself:
// an open issue closes when (1) the newest piece is younger than STALL_MIN, (2) the second newest piece also landed AFTER that issue was filed
// (two pieces since the filing) and (3) the stall did not recur between those two pieces, i.e. no two consecutive failed or blocked generation
// runs (the detector's own definition of a stall, below) lie between them. Rule (2) alone was not enough: for 2934 (filed 2026-10-18T11:00:11Z)
// the pieces 12:27:32Z and 2026-10-19T04:04:51Z are both after the filing, so it would have closed at the 04:04Z piece with 15.6 h of stall
// between them and been refiled hours later, which is the cycle this release removes. Until all three hold the open issue is kept and refreshed
// by the stalled branch. What was read (qnfo-audit agent_issues and reading.q08.org/feed.xml, 2026-10-19 ~19:10Z): 2934 and 99975 were closed at
// 2026-10-18T13:00:12Z and 2026-10-19T04:04:54Z on the pieces 12:27:32Z and 04:04:51Z, and 100064 (filed 07:00:43Z) is open with the newest
// piece at 04:04:51Z, before its filing. Everything in stall-detector.test.mjs that lies after the 04:04:51Z piece, and the failed runs in the
// empty slots (companion_runs is in the private personal-life D1 and was not read), is modelled, not measured. The "latest model-call
// error" in the digest is read from the same 24 h window as the rest of the digest (it quoted a 2026-10-17 spend-limit row).
var STALL_MIN = 120;
var STALL_TITLE = "COMPANION-PUBLISH-STALL-AUTO-1";
// PUBLISH-STALL-DIGEST-1 (1.19.0, fleet audit 2026-10-13; the q08-signal-engine 0.17.2 pattern). The stall issue was filed once and never
// refreshed: agent_issues 2222 still said "published nothing for 13h" after 73 h, with no word on which stage failed, so no doer acted.
// Every stalled tick now rewrites the open issue: the hours in the title, a 24 h breakdown of the stage each rejected attempt ended at
// (and runs that ran out of time), the newest rejection details, and priority critical after 24 h. A new issue is inserted only when none
// is open. Failures are logged, never swallowed. The auto-close with evidence on recovery is unchanged.
function stallAttemptStage(detail) {
  var d = String(detail || "");
  if (/^time budget spent/.test(d)) return "time budget";
  if (/^critique |^critic |^final read/.test(d)) return "critique";
  if (/^fact-check/.test(d)) return "fact-check";
  if (/^validate:/.test(d)) {
    var head = d.split(" || ")[0];
    if (/banned:/.test(head)) return "validate-banned";
    if (/(?:essay|notes|serial) length \d+/.test(head)) return "validate-length";
    if (/grounding:/.test(head)) return "validate-grounding";
    if (/\blede\b/.test(head)) return "validate-lede";
    return "validate-other";
  }
  return "other";
}
function companionStallDigest(rows) {
  var n = {}, order = [];
  (rows || []).forEach(function (r) { var k = stallAttemptStage(r && r.detail); if (!n[k]) { n[k] = 0; order.push(k); } n[k]++; });
  return order.sort(function (x, y) { return n[y] - n[x]; }).map(function (k) { return k + " " + n[k]; }).join(", ");
}
function stallLog(at, e) { console.error(JSON.stringify({ at: "personal-companion." + at, error: String(e && e.message || e).slice(0, 300) })); }
// COMPANION-STALL-YIELD-1: true when two consecutive generation runs (ok, failed or blocked; the steward is not one) between the two pieces both failed or
// were blocked, i.e. the stall the detector files on happened in between. statuses: the run statuses between the pieces, oldest first.
function stallRecurred(statuses) {
  var streak = 0;
  for (var i = 0; i < (statuses || []).length; i++) {
    if (statuses[i] === "ok") streak = 0;
    else if (++streak >= 2) return true;
  }
  return false;
}
// EK-3 (1.45.0, roadmap row 1750): the even-keel check is measured, counts only (no text leaves the personal plane). scored_share: of the audit rows that passed in the
// 7 days to now, the share that carry a balance_score, i.e. the check ran and answered (it was 0 of 20 rows before this version). hold_share: of the drafts that
// reached the even-keel reviewer in the same window (the scored passes plus the attempts it stopped at stage balance), the share it stopped: a wall would show here
// before it shows as a stall. Written each hourly tick into the two metrics the migration registers; an unregistered metric updates no row.
async function writeBalanceMetrics(env, now) {
  try {
    var since = new Date(now - 7 * 864e5).toISOString();
    var a = await env.PERSONAL.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN balance_score IS NOT NULL THEN 1 ELSE 0 END) AS scored FROM companion_audits WHERE verdict = 'pass' AND checked_at >= ?1").bind(since).first();
    var h = await env.PERSONAL.prepare("SELECT COUNT(*) AS held FROM companion_runs WHERE status = 'rejected' AND run_at >= ?1 AND detail LIKE 'fact-check balance:%'").bind(since).first();
    var passes = Number(a && a.n) || 0, scored = Number(a && a.scored) || 0, held = Number(h && h.held) || 0;
    var scoredShare = passes ? Math.round(1000 * scored / passes) / 1000 : null;
    var holdShare = scored + held ? Math.round(1000 * held / (scored + held)) / 1000 : null;
    var stamp = new Date(now).toISOString();
    var put = "UPDATE metric_registry SET last_value = ?2, last_refreshed = ?3, state = 'MEASURED' WHERE metric = ?1";
    await env.AUDIT.prepare(put).bind("companion_balance_scored_share_7d", scoredShare == null ? null : String(scoredShare), stamp).run();
    await env.AUDIT.prepare(put).bind("companion_balance_hold_share_7d", holdShare == null ? null : String(holdShare), stamp).run();
    return { passes: passes, scored: scored, held: held, scoredShare: scoredShare, holdShare: holdShare };
  } catch (e) { stallLog("balance.metric", e); return null; }
}
async function companionStallDetector(env, nowMs) {
  if (!env.AUDIT || !env.PERSONAL) return { skipped: "no binding" };
  var now = nowMs || Date.now();
  var lastTwo = await env.PERSONAL.prepare("SELECT slug, created_at FROM companion_pieces ORDER BY id DESC LIMIT 2").all();
  var pieceRows = (lastTwo && lastTwo.results) || [];
  var lastRow = pieceRows[0] || null, prevRow = pieceRows[1] || null;
  var lastMs = lastRow && lastRow.created_at ? Date.parse(String(lastRow.created_at)) : 0;
  var prevMs = prevRow && prevRow.created_at ? Date.parse(String(prevRow.created_at)) : 0;
  var hours = lastMs ? Math.round((now - lastMs) / 36e5 * 10) / 10 : null;
  var ageMin = lastMs ? (now - lastMs) / 6e4 : null; // COMPANION-STALL-YIELD-1: the SLA is judged on the exact age; the hours above are rounded to 0.1 h (6 minutes) for the metric
  try {
    await env.AUDIT.prepare("UPDATE metric_registry SET last_value = ?2, last_refreshed = ?3, state = 'MEASURED' WHERE metric = ?1").bind("companion_hours_since_last_piece", hours == null ? null : String(hours), new Date(now).toISOString()).run();
  } catch (eM) { stallLog("stall.metric", eM); }
  await writeBalanceMetrics(env, now);
  var open = await env.AUDIT.prepare("SELECT id, created_at FROM agent_issues WHERE status='open' AND title LIKE ?1 ORDER BY id DESC").bind(STALL_TITLE + ":%").all();
  var openRows = (open && open.results) || [];
  var openIds = openRows.map(function (o) { return o.id; });
  if (ageMin != null && ageMin < STALL_MIN) {
    // COMPANION-STALL-YIELD-1: one fresh piece is not a recovery. An issue is recovered when the second newest piece also landed after the
    // issue was filed (created_at is epoch ms, as the insert below writes it) and the stall did not recur between the two pieces: two pieces
    // since the stall began that follow each other without two failed generation runs in between (a gap of 15.6 h with two failed slots is the stall).
    var recovered = openRows.filter(function (o) { return prevMs > (Number(o.created_at) || 0); });
    if (recovered.length) {
      var between = null;
      try {
        var bq = await env.PERSONAL.prepare("SELECT status FROM companion_runs WHERE status IN ('ok','failed','blocked') AND form <> 'steward' AND run_at > ?1 AND run_at < ?2 ORDER BY id ASC LIMIT 500").bind(new Date(prevMs).toISOString(), new Date(lastMs).toISOString()).all();
        between = ((bq && bq.results) || []).map(function (r) { return r.status; });
      } catch (eB) { stallLog("stall.between", eB); } // unreadable: the issue is held and the next hourly tick reads it again
      if (between === null || stallRecurred(between)) recovered = [];
    }
    if (openRows.length && !recovered.length) return { hours: hours, closed: 0, held: openRows.length };
    for (var i = 0; i < recovered.length; i++) {
      var ev = "personal-companion " + VERSION + " stall detector: piece " + lastRow.slug + " created " + lastRow.created_at + " (" + hours + "h ago) and piece " + prevRow.slug + " created " + prevRow.created_at + ", both after issue " + recovered[i].id + " was filed at " + new Date(Number(recovered[i].created_at) || 0).toISOString() + " and no two failed generation runs between them, at " + new Date(now).toISOString();
      await env.AUDIT.prepare("UPDATE issue_triage SET close_evidence=?1 WHERE issue_id=?2").bind(ev, recovered[i].id).run().catch(function (e) { stallLog("stall.close-evidence", e); });
      await env.AUDIT.prepare("UPDATE agent_issues SET status='closed', close_channel='auto-recovery', updated_at=?1 WHERE id=?2").bind(now, recovered[i].id).run();
    }
    return recovered.length < openRows.length ? { hours: hours, closed: recovered.length, held: openRows.length - recovered.length } : { hours: hours, closed: recovered.length };
  }
  var fr = await env.PERSONAL.prepare("SELECT run_at, status, model, topic, detail FROM companion_runs WHERE status IN ('ok','failed','blocked') AND form <> 'steward' ORDER BY id DESC LIMIT 2").all();
  var runs = (fr && fr.results) || [];
  if (runs.length < 2 || runs.some(function (r) { return r.status === "ok"; })) return { hours: hours, stalled: false };
  var since = new Date(now - 864e5).toISOString();
  var dayQ = await env.PERSONAL.prepare("SELECT id, status, detail FROM companion_runs WHERE run_at >= ?1 AND form <> 'steward' AND (status = 'rejected' OR (status = 'stage' AND detail LIKE 'time budget spent%')) ORDER BY id DESC LIMIT 200").bind(since).all();
  var dayRows = (dayQ && dayQ.results) || [];
  var runsQ = await env.PERSONAL.prepare("SELECT COUNT(*) n FROM companion_runs WHERE run_at >= ?1 AND form <> 'steward' AND status IN ('failed','blocked')").bind(since).first();
  var newest = dayRows.filter(function (r) { return r.status === "rejected"; }).slice(0, 3).map(function (r) { return "#" + r.id + " " + stallAttemptStage(r.detail) + ": " + String(r.detail || "").split(" || ")[0].slice(0, 400); }).join(" | ");
  var causes = runs.map(function (r) { return r.run_at + " " + (r.model || "-") + " " + (r.topic || "") + ": " + String(r.detail || "").slice(0, 400); }).join(" | ");
  var errs = await env.PERSONAL.prepare("SELECT detail FROM companion_runs WHERE status='stage' AND detail LIKE '%err:%' AND run_at >= ?1 ORDER BY id DESC LIMIT 1").bind(since).first(); // COMPANION-STALL-YIELD-1: the same 24 h as the digest
  var title = STALL_TITLE + ": reading.q08.org published nothing for " + (hours == null ? "ever" : Math.round(hours) + "h") + "; last 2 generation runs failed";
  var desc = "Filed and refreshed automatically by personal-companion " + VERSION + " companionStallDetector (PUBLISH-STALL-DIGEST-1), " + new Date(now).toISOString() + ". Stage each rejected attempt ended at, last 24 h (" + dayRows.length + " rows, " + ((runsQ && runsQ.n) || 0) + " failed or blocked runs): " + (companionStallDigest(dayRows) || "none") + ". Newest rejections: " + (newest || "none") + ". Last 2 generation runs: " + causes + (errs && errs.detail ? ". Latest model-call error (last 24 h): " + String(errs.detail).slice(0, 300) : "") + ". Fix the stage with the most attempts first; the full rows are in companion_runs (personal-life D1). Closes itself with evidence when the newest piece is younger than " + STALL_MIN + " minutes and two pieces have landed since this issue was filed with no two failed generation runs between them.\ncode-task: repo=qnfo-workers path=personal-companion/worker.js";
  var prio = hours == null || hours >= 24 ? "critical" : "high";
  if (openIds.length) {
    await env.AUDIT.prepare("UPDATE agent_issues SET title=?1, description=?2, priority=?3, updated_at=?4 WHERE id=?5").bind(title, desc, prio, now, openIds[0]).run();
    return { hours: hours, stalled: true, open: openIds[0], updated: true, priority: prio };
  }
  await env.AUDIT.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) SELECT ?1, ?2, 'personal-companion', 'reliability', ?5, 'open', ?3, ?3 WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status='open' AND title LIKE ?4)").bind(title, desc, now, STALL_TITLE + ":%", prio).run();
  return { hours: hours, stalled: true, filed: true, priority: prio };
}
var worker_default = {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" } }); // SEO-HYGIENE-1: a private tool / private reading surface, kept out of search engines
    var u = new URL(request.url);
    var p = u.pathname;
    // WELLBEING-LOOP-1: check-in page, done/no links, and the read API. Handles its own auth
    // (WELLBEING_TOKEN, or the companion key) because it answers before authorized() runs.
    if (p === "/api/wellbeing" || p.startsWith("/wb/")) {
      var wbRes = null;
      try { wbRes = await WBW.handleWellbeing(request, env, { send: wellbeingSend }); }
      catch (eWbH) { console.error("wellbeing-route:", String(eWbH && eWbH.stack || eWbH)); return json({ ok: false, error: { message: String(eWbH && eWbH.message || eWbH) } }, 500); }
      if (wbRes) return wbRes;
    }
    // TRAVEL-CHAT-1: travel.q08.org is the planner's own address; its front page is the chat.
    if (u.hostname === "travel.q08.org" && (p === "/" || p === "")) return Response.redirect(u.origin + "/travel", 302);
    // TRAVEL-PLANNER-1: signed option pages (/travel/o/<id>), the chat (/travel, TRAVEL-CHAT-1) and the bearer API (/api/travel).
    // Handles its own auth.
    if (p === "/api/travel" || p === "/api/travel/run" || p === "/travel" || p.startsWith("/travel/")) {
      try { var trRes = await TRV.handleTravel(request, env, travelDeps(env)); if (trRes) return trRes; }
      catch (eTr) { console.error(JSON.stringify({ evt: "travel-route:caught", error: String(eTr && eTr.message || eTr).slice(0, 300) })); return json({ ok: false, error: { message: "travel route failed" } }, 500); }
    }
    if (request.method === "OPTIONS") return json({ ok: true });
    if (p === "/health") {
      var n = 0, last = null, acc = null;
      try {
        await ensureAccuracySchema(env);
        var r = await env.PERSONAL.prepare("SELECT COUNT(*) n FROM companion_pieces WHERE " + VISIBLE_SQL).all();
        n = ((r.results || [])[0] || {}).n || 0;
        var r2 = await env.PERSONAL.prepare("SELECT slug, title, form, day FROM companion_pieces WHERE " + VISIBLE_SQL + " ORDER BY id DESC LIMIT 1").all();
        last = (r2.results || [])[0] || null;
        var r3 = await env.PERSONAL.prepare("SELECT (SELECT COUNT(*) FROM companion_audits WHERE verdict = 'pass') passed, (SELECT COUNT(*) FROM companion_retractions) retracted, (SELECT COUNT(*) FROM companion_pieces WHERE slug NOT IN (SELECT slug FROM companion_audits) AND slug NOT IN (SELECT slug FROM companion_retractions)) unaudited").first();
        acc = r3 || null;
      } catch (e) { logCaught("fetch", e); }
      return json({ ok: true, version: VERSION, capabilities: ["companion-writing", "morning-brief", "subscriber-feed", "feedback", "owner-prompts", "accuracy-verify", "retractions"], limitations: ["every route except /health needs the companion key (?k=)", "writes at most 5 pieces a day, only at the generation hours (UTC) listed here", "the writer is DeepSeek via the personal plane's own key (BYOK), outside the qnfo AI router", "a piece is shown and mailed only after a deterministic grounding check and a two-family fact-check against its source material; if either is unavailable nothing is published (COMPANION-VERIFY-1)", "the morning brief goes only to the owner's address", "the morning brief and owner questions bypass email_suppression by design; the owner stops them with one row: UPDATE calendar_meta SET v='0' WHERE k='owner_notice_enabled' (qnfo-audit; INSERT it if absent; 0/off/false/no stops, anything else or no row means on)", "an unsent brief claim older than 90 minutes is retried hourly between 08:00 and 12:00 Amsterdam; an owner question whose worker died mid-send is retried after 6 hours, so a very rare duplicate is possible"], pieces: n, last, rhythm: RHYTHM, writer: WRITER_MODEL, writer_essay: WRITER_MODEL_ESSAY, topics: "live (Wikipedia, arXiv)", accuracy: acc, gen_hours_utc: GEN_HOURS_UTC, max_per_day: MAX_PIECES_PER_DAY, models: MODELS });
    }
    if (!authorized(request, env)) {
      return json({ error: { message: "unauthorized: append ?k=KEY" } }, 401);
    }
    if (p === "/sitemap.xml") {
      await ensureSchema(env);
      var sitemapRows = await env.PERSONAL.prepare("SELECT slug FROM companion_pieces WHERE " + VISIBLE_SQL + " ORDER BY id DESC LIMIT 50000").all();
      var sitemapUrls = ["<url><loc>" + escXml(u.origin + "/") + "</loc></url>"];
      var publishedPages = sitemapRows.results || [];
      for (var si = 0; si < publishedPages.length; si++) {
        var pageUrl = new URL("/p/" + encodeURIComponent(String(publishedPages[si].slug)), u.origin).toString();
        sitemapUrls.push("<url><loc>" + escXml(pageUrl) + "</loc></url>");
      }
      var sitemap = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + sitemapUrls.join("") + "</urlset>";
      return new Response(sitemap, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
    }
    if (p === "/api/ping") {
      var ping = {};
      for (var pi = 0; pi < MODELS.length; pi++) {
        var t0p = Date.now();
        try {
          var rp = await aiRunAttr(env, "personal-companion", "probe-ping", MODELS[pi], { messages: [{ role: "user", content: "Reply with the single word: ready" }], max_tokens: 16 }, { gateway: { id: "default" }, signal: AbortSignal.timeout(3e4) });
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
          var rq = await aiRunAttr(env, "personal-companion", "probe-gen", cand[ci], {
            messages: [
              { role: "system", content: "Write plain scholarly prose. No filler, no emojis, no meta-commentary." },
              { role: "user", content: "Write three short paragraphs, about 250 words total, summarising the text that follows in plain prose. Text: The probe checks only that the model returns prose within the token budget." }
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
    if (p === "/api/f" || p === "/api/feedback") {
      var slug = u.searchParams.get("slug") || "";
      var sig = u.searchParams.get("s") || u.searchParams.get("signal") || "";
      if (slug && sig) {
        try {
          await env.PERSONAL.prepare("INSERT INTO companion_feedback(slug, signal, note, created_at) VALUES(?,?,?,?)").bind(slug, sig.slice(0, 40), (u.searchParams.get("note") || "").slice(0, 500), nowIso()).run();
        } catch (e) { logCaught("fetch", e); }
      }
      return Response.redirect(new URL("/p/" + slug + (u.searchParams.get("k") ? "?k=" + u.searchParams.get("k") : ""), u.origin).toString(), 302);
    }
    if (p === "/api/pieces") {
      await ensureSchema(env);
      var lim = Number(u.searchParams.get("limit")) || 30;
      var f2 = u.searchParams.get("form") || "";
      var sql = f2 ? "SELECT slug, form, title, subtitle, lede, word_count, day, created_at, anchor_json, quality_json FROM companion_pieces WHERE form = ? AND " + VISIBLE_SQL + " ORDER BY id DESC LIMIT ?" : "SELECT slug, form, title, subtitle, lede, word_count, day, created_at, anchor_json, quality_json FROM companion_pieces WHERE " + VISIBLE_SQL + " ORDER BY id DESC LIMIT ?";
      var st = f2 ? env.PERSONAL.prepare(sql).bind(f2, lim) : env.PERSONAL.prepare(sql).bind(lim);
      var rr = await st.all();
      return json({ ok: true, count: (rr.results || []).length, pieces: rr.results || [] });
    }
    if (p.indexOf("/api/piece/") === 0) {
      await ensureSchema(env);
      var s3 = p.slice(11);
      var q3 = await env.PERSONAL.prepare("SELECT * FROM companion_pieces WHERE slug = ? AND " + VISIBLE_SQL).bind(s3).all();
      var row3 = (q3.results || [])[0];
      if (!row3) return json({ error: { message: "not found" } }, 404);
      return json({ ok: true, piece: row3 });
    }
    if (p === "/api/retractions" || p === "/retractions") {
      await ensureSchema(env);
      var rq = await env.PERSONAL.prepare("SELECT r.slug, r.reason, r.claims_json, r.retracted_at, p.title FROM companion_retractions r LEFT JOIN companion_pieces p ON p.slug = r.slug ORDER BY r.retracted_at DESC LIMIT 200").all();
      if (p === "/api/retractions") return json({ ok: true, count: (rq.results || []).length, retractions: rq.results || [] });
      return html(renderRetractions(rq.results || [], env.COMPANION_KEY && u.searchParams.get("k") ? "?k=" + u.searchParams.get("k") : ""));
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
            try {
              await broadcast(env, o.slug, "https://reading.q08.org");
            } catch (e) { logCaught("fetch", e); }
          }
        })().catch(function (eLog) { logCaught("fetch", eLog); }));
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
    if (p === "/subscribe" || p === "/confirm" || p === "/unsubscribe") {
      return handleSubscribe(request, env, u, p);
    }
    if (p === "/feed.xml" || p === "/feed" || p === "/rss") {
      return feedXml(env, u);
    }
    if (p === "/" || p === "") {
      await ensureSchema(env);
      var filter = u.searchParams.get("form") || "";
      var sql2 = filter ? "SELECT slug, form, title, lede, word_count, day FROM companion_pieces WHERE form = ? AND " + VISIBLE_SQL + " ORDER BY id DESC LIMIT 200" : "SELECT slug, form, title, lede, word_count, day FROM companion_pieces WHERE " + VISIBLE_SQL + " ORDER BY id DESC LIMIT 200";
      var st2 = filter ? env.PERSONAL.prepare(sql2).bind(filter) : env.PERSONAL.prepare(sql2);
      var rows = await st2.all();
      var res = html(renderIndex(rows.results || [], keyQS, filter));
      if (cookie) res.headers.set("Set-Cookie", cookie);
      return res;
    }
    if (p.indexOf("/p/") === 0) {
      var s = p.slice(3);
      await ensureSchema(env);
      var rt = await env.PERSONAL.prepare("SELECT r.reason, r.claims_json, r.retracted_at, p.title FROM companion_retractions r LEFT JOIN companion_pieces p ON p.slug = r.slug WHERE r.slug = ?").bind(s).first();
      if (rt) return new Response(renderRetraction(rt, { title: rt.title }, keyQS), { status: 410, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      var q = await env.PERSONAL.prepare("SELECT * FROM companion_pieces WHERE slug = ? AND " + VISIBLE_SQL).bind(s).all();
      var row = (q.results || [])[0];
      if (!row) return html(page("Not found", shell("<p>No such piece, or it has not passed the accuracy check.</p>")), 404);
      var res2 = html(renderPiece(row, keyQS));
      if (cookie) res2.headers.set("Set-Cookie", cookie);
      return res2;
    }
    return json({ error: { message: "not found", version: VERSION } }, 404);
  },
  async scheduled(event, env, ctx) {
    return cronTickDispatch(event, async function (event) {
    if (event.cron === "0 21 * * *") {
      ctx.waitUntil(sendDigest(env).catch(function (eLog) { logCaught("scheduled", eLog); }));
      return;
    }
    ctx.waitUntil((async function() {
      var hbOk = 1;
      // BROADCAST-BATCH-1: continue an unfinished broadcast or digest before anything else on the hourly tick.
      try { await resumeSendRuns(env); } catch (eR) { console.log("resumeSendRuns: " + String(eR && eR.message || eR)); }
      try { await ensureSchema(env); var _au = await auditPublished(env, 40); if (_au && (_au.retracted || _au.withdrawn || _au.deferred)) console.log("accuracy-audit: " + JSON.stringify(_au)); } catch (eAu) { console.error("accuracy-audit:", String(eAu && eAu.message || eAu)); }
      try {
        var nowUtc = /* @__PURE__ */ new Date();
        var utcHour = nowUtc.getUTCHours();
        var isGenHour = GEN_HOURS_UTC.indexOf(utcHour) >= 0;
        // COMPANION-SOURCES-1: a generation that was blocked before any model call (no source material) is retried at the next
        // hourly tick instead of waiting for the next generation hour; it costs nothing while blocked and stays within the daily cap.
        var retryBlocked = !isGenHour && (await blockedRetryDue(env) || await starvedRetryDue(env));
        var genHold = (isGenHour || retryBlocked) ? await generationHold(env) : null;
        if (genHold) await logRun(env, "steward", "", "steward", "held", "generation held: ops_config companion_generation = " + genHold.value + (genHold.note ? " (" + genHold.note + ")" : ""), 0);
        if ((isGenHour || retryBlocked) && !genHold) {
          var day = amsDayKey(nowUtc);
          var dayCount = await env.PERSONAL.prepare(
            "SELECT COUNT(*) n FROM companion_pieces WHERE day = ?"
          ).bind(day).all();
          var todayN = ((dayCount.results || [])[0] || {}).n || 0;
          if (todayN < await readingQuota(env)) {
            var form = RHYTHM[amsWeekday(nowUtc)];
            var out = await generate(env, form, {});
            if (out && out.ok) {
              try {
                var pr = await env.PERSONAL.prepare("SELECT * FROM companion_pieces WHERE slug = ?").bind(out.slug).all();
                var prow = (pr.results || [])[0];
                if (prow) {
                  prow.link = "https://reading.q08.org/p/" + out.slug;
                  await sendMail(env, prow, out.slug, prow.day);
                }
              } catch (e) { logCaught("scheduled", e); }
            }
          }
        }
        await steward(env);
        await mirrorPipeline(env); // EXTERNAL-PROPERTIES-1 (it logs its own failure)
        try { await companionStallDetector(env); } catch (eSt) { console.error("stall-detector:", String(eSt && eSt.message || eSt)); }
        if (utcHour >= 6) await sendMorningBrief(env);
        // WELLBEING-LOOP-1: morning check-in + at most one ask, with expiry. Idempotent per hour.
        try { var _wb = await WBW.wellbeingTick(env, { send: wellbeingSend }); if (_wb && (_wb.sent || _wb.skipped || _wb.drift)) console.log("wellbeing-tick: " + JSON.stringify(_wb)); } catch (eWb) { console.error("wellbeing-tick:", String(eWb && eWb.message || eWb)); }
        // TRAVEL-PLANNER-1: next-stop proposals, weekly ideas and the day-before check-in note. Idempotent per hour.
        try { var _tr = await TRV.travelTick(env, travelDeps(env)); if (_tr && (_tr.proposed || _tr.notices || _tr.booked || _tr.error)) console.log(JSON.stringify({ evt: "travel-tick", result: _tr })); } catch (eTr) { console.error(JSON.stringify({ evt: "travel-tick:caught", error: String(eTr && eTr.message || eTr).slice(0, 300) })); }
        try { var _lf = await queueLedgerFollowUp(env); if (_lf.error) console.error("ledger-followup:", _lf.error); } catch (eLf) { console.error("ledger-followup:", String(eLf && eLf.message || eLf)); }
        try { var _cm = await refreshConnectionMetrics(env); if (_cm.error) console.error("connection-metrics:", _cm.error); } catch (eCm) { console.error("connection-metrics:", String(eCm && eCm.message || eCm)); }
        try { var _uq = await flagUndeliverableQuestions(env); if (_uq.error) console.error("owner-question-undeliverable:", _uq.error); } catch (eUq) { console.error("owner-question-undeliverable:", String(eUq && eUq.message || eUq)); }
        try { var _op = await deliverOwnerPrompts(env); if (_op.error) console.error("owner-prompts:", _op.error); } catch (eOp) { console.error("owner-prompts:", String(eOp && eOp.message || eOp)); }
      } catch (e) { hbOk = 0; logCaught("scheduled", e); }
      // CRON-ONLY-HEARTBEAT-1 (FLEET-HARDENING-2, agent_issues 2397): the hourly tick ends with its fleet_heartbeat row (ok=0 when the tick
      // threw); the write never throws or masks the tick's own error
      try {
        if (env.AUDIT) await env.AUDIT.prepare("INSERT INTO fleet_heartbeat (worker, version, ts, ok) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(worker) DO UPDATE SET version=excluded.version, ts=excluded.ts, ok=excluded.ok").bind("personal-companion", VERSION, new Date().toISOString(), hbOk).run();
      } catch (eHb) { logCaught("scheduled:heartbeat", eHb); }
    })());
    if (env.VAULT) ctx.waitUntil(VaultIndexer.run(env).catch(function(e) { console.error("vault-indexer:", e && e.message || e); }));
    });
  }
};
// ---- vault-indexer (folded from the standalone vault-indexer 0.1.20 script, VAULT-INDEXER-FOLD-1, 2026-10-01) ----
// The standalone worker disappeared unrecorded around 2026-09-25 (worker_live_audit 404, no worker_removals row),
// so the Obsidian vault (obsidian-vault R2, ~7.7k notes) stopped being indexed into the personal-life Vectorize
// index the personal twin retrieves from. It now runs here on the hourly cron, namespaced so its helpers cannot
// collide with this worker's own. Its unauthenticated /run and /drain routes were not carried over.
var VaultIndexer = (function() {
  var VERSION = "0.1.21-folded";
  var WORKER = "personal-companion:vault-indexer";
  var MAX_LIST_PAGES = 100;
  var MAX_DOCS = 250;
  var MAX_BYTES = 262144;
  var CHUNK_SIZE = 900;
  var CHUNK_OVERLAP = 120;
  var MAX_CHUNKS = 24;
  var GET_CONCURRENCY = 16;
  var EMBED_CONCURRENCY = 3;
  var RUN_DEADLINE_MS = 200000;
  var PATH_PREFIX = "obsidian/";
  var SKIP_PREFIXES = [".obsidian/", "releases/", "Attachments/", "Archive/", ".git/"];
  var INGEST_ROOTS = ["notes/", "Inbox/", "Projects/", "Areas/", "Resources/"];
  var MD_RE = /\.(md|markdown|mdx|txt)$/i;

  function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json" } }); }
  function basename(k) { var p = k.split("/"); return p[p.length - 1] || k; }
  function chunkArr(a, n) { var o = []; for (var i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }
  function extOf(key) { var i = key.lastIndexOf("."); return i >= 0 ? key.slice(i + 1).toLowerCase() : ""; }
  function sanitize(s, max) { return String(s || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/[\uD800-\uDFFF]/g, "").trim().slice(0, max || 800); }

  function chunkText(text, size, overlap) {
    size = size || CHUNK_SIZE; overlap = overlap || CHUNK_OVERLAP;
    var out = [];
    var clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
    var n = clean.length;
    if (n < 60) return out;
    var i = 0;
    while (i < n) {
      var end = i + size;
      if (end > n) end = n;
      else {
        var lastNl = clean.lastIndexOf("\n", end);
        if (lastNl > i + size * 0.5) end = lastNl;
        else { var lastSp = clean.lastIndexOf(" ", end); if (lastSp > i + size * 0.5) end = lastSp; }
      }
      var c = clean.slice(i, end).trim();
      if (c.length >= 40) out.push(c);
      if (end >= n) break;
      if (end <= i) break;
      i = end - overlap;
      if (out.length >= MAX_CHUNKS) break;
    }
    return out;
  }

  var CATEGORY_KEYWORDS = [
    ["finance", ["bank", "statement", "tax", "invoice", "receipt", "mortgage", "rent", "insurance", "salary"]],
    ["health", ["medical", "doctor", "clinic", "prescription", "vaccin", "hospital", "therapy"]],
    ["legal", ["contract", "agreement", "will", "power of attorney", "court", "lawsuit", "notary"]],
    ["housing", ["apartment", "lease", "landlord", "property", "utilities", "electricity"]],
    ["identity", ["passport", "driving license", "residence permit", "visa", "birth certificate"]],
    ["work", ["resume", "cv", "interview", "offer letter", "employment", "reference"]],
    ["travel", ["flight", "boarding", "itinerary", "hotel", "booking", "ticket"]],
    ["education", ["diploma", "transcript", "degree", "course", "university", "certificate"]],
    ["personal", ["family", "photo", "journal", "diary", "letter"]]
  ];
  function categorize(text, key) {
    var hay = (text + " " + key).toLowerCase();
    var best = "general", bestScore = 0;
    for (var i = 0; i < CATEGORY_KEYWORDS.length; i++) {
      var cat = CATEGORY_KEYWORDS[i][0], kws = CATEGORY_KEYWORDS[i][1], score = 0;
      for (var j = 0; j < kws.length; j++) if (hay.indexOf(kws[j]) >= 0) score++;
      if (score > bestScore) { bestScore = score; best = cat; }
    }
    return bestScore > 0 ? best : "general";
  }

  async function sha256hex(s) {
    var d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(d.slice(0, 16))).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  function inScope(key) {
    if (SKIP_PREFIXES.some(function (p) { return key.indexOf(p) === 0; })) return false;
    if (!MD_RE.test(key)) return false;
    return INGEST_ROOTS.some(function (p) { return key.indexOf(p) === 0; });
  }

  async function getFull(env, key) {
    try {
      if (!MD_RE.test(key)) return null;
      var head = await env.VAULT.head(key);
      var big = head && head.size > MAX_BYTES;
      var o = big ? await env.VAULT.get(key, { range: { offset: 0, length: MAX_BYTES } }) : await env.VAULT.get(key);
      if (!o) return null;
      return await o.text();
    } catch (e) { return null; }
  }

  async function run(env, cap) {
    var t0 = Date.now();
    var s = { scanned: 0, changed: 0, indexed: 0, chunks: 0, vectors: 0, skipped: 0, reconciled: 0, locked: false, errors: 0, notes: [] };

    // Overlap lock: one run at a time. TTL takeover (4 min) if a prior run died without releasing.
    var nowIso = new Date().toISOString();
    var haveLock = false;
    try {
      await env.PERSONAL.prepare("INSERT INTO vault_indexer_lock(id,started,owner) VALUES (1,?1,?2)").bind(nowIso, WORKER).run();
      haveLock = true;
    } catch (e) {
      var lockRow = null;
      try { lockRow = await env.PERSONAL.prepare("SELECT started FROM vault_indexer_lock WHERE id=1").first(); } catch (e2) { logCaught("run", e2); }
      var age = lockRow && lockRow.started ? (Date.now() - Date.parse(lockRow.started)) : 1e9;
      if (age < 240000) { s.locked = true; s.notes.push("locked"); s.elapsedMs = Date.now() - t0; return s; }
      try { await env.PERSONAL.prepare("UPDATE vault_indexer_lock SET started=?1, owner=?2 WHERE id=1").bind(nowIso, WORKER).run(); haveLock = true; } catch (e3) { logCaught("run", e3); }
    }

    var reg = new Map();
    try {
      var r0 = await env.PERSONAL.prepare("SELECT path,size,modified FROM files WHERE path LIKE 'obsidian/%'").all();
      (r0.results || []).forEach(function (x) { reg.set(x.path, x.size + "|" + x.modified); });
    } catch (e) { s.errors++; s.notes.push("registry-read-fail"); }

    var all = [], cursor = undefined, pages = 0;
    do {
      var listed;
      try { listed = await env.VAULT.list({ cursor: cursor, limit: 1000 }); }
      catch (e) { s.errors++; s.notes.push("list-fail"); break; }
      cursor = listed.truncated ? listed.cursor : undefined;
      pages++;
      var objs = listed.objects || [];
      for (var i = 0; i < objs.length; i++) { all.push(objs[i]); s.scanned++; }
    } while (cursor && pages < MAX_LIST_PAGES);

    var completeList = !cursor;
    var changed = [];
    var seenPaths = new Set();
    for (var a = 0; a < all.length; a++) {
      var o = all[a];
      if (!inScope(o.key)) continue;
      var path = PATH_PREFIX + o.key;
      seenPaths.add(path);
      var sig = o.size + "|" + (o.uploaded ? o.uploaded.toISOString() : "");
      if (reg.get(path) === sig) continue;
      changed.push({ key: o.key, obj: o, path: path });
    }
    s.changed = changed.length;

    if (completeList) {
      var stale = [];
      reg.forEach(function (_v, p) { if (!seenPaths.has(p)) stale.push(p); });
      var staleGroups = chunkArr(stale, 50);
      for (var dg2 = 0; dg2 < staleGroups.length; dg2++) {
        try {
          var dstmts = [];
          for (var gi = 0; gi < staleGroups[dg2].length; gi++) {
            dstmts.push(env.PERSONAL.prepare("DELETE FROM chunks WHERE path=?1").bind(staleGroups[dg2][gi]));
            dstmts.push(env.PERSONAL.prepare("DELETE FROM files WHERE path=?1").bind(staleGroups[dg2][gi]));
          }
          await env.PERSONAL.batch(dstmts);
          s.reconciled += staleGroups[dg2].length;
        } catch (e) { s.errors++; }
      }
    }

    var work = changed.slice(0, cap || MAX_DOCS);
    var texts = new Array(work.length);
    for (var b = 0; b < work.length; b += GET_CONCURRENCY) {
      var slice = work.slice(b, b + GET_CONCURRENCY);
      var ts = await Promise.all(slice.map(function (w) { return getFull(env, w.key); }));
      for (var j = 0; j < slice.length; j++) texts[b + j] = ts[j];
    }

    var prepared = new Array(work.length);
    for (var eb = 0; eb < work.length; eb += EMBED_CONCURRENCY) {
      if (Date.now() - t0 > RUN_DEADLINE_MS * 0.65) { s.notes.push("deadline-embed@" + eb); break; }
      var eslice = work.slice(eb, eb + EMBED_CONCURRENCY);
      await Promise.all(eslice.map(async function (w, k) {
        var idx = eb + k;
        var text = texts[idx];
        if (text === null) { s.notes.push("null:" + String(w.key).slice(-34)); prepared[idx] = null; return; }
        var chs = chunkText(text);
        if (chs.length === 0) { prepared[idx] = { skip: true, w: w }; return; }
        var resp = null, lastErr = "";
        for (var attempt = 0; attempt < 3 && !resp; attempt++) {
          try { resp = await aiRunAttr(env, "personal-companion", "embed-index", "@cf/baai/bge-base-en-v1.5", { text: chs }, { gateway: { id: "default" } }); }
          catch (e) {
            lastErr = String((e && e.message) || e);
            var rt = /429|1010|rate.?limit|throttl|overload|503|502|504|busy|timeout/i.test(lastErr) && !/spend limit|2045|budget|quota/i.test(lastErr);
            if (!rt && attempt >= 1) break;
            var backoff = Math.min(3000, 400 * Math.pow(2, attempt)) + Math.floor(Math.random() * 400);
            await new Promise(function (r) { setTimeout(r, backoff); });
          }
        }
        if (!resp) { prepared[idx] = { error: true, msg: "embed:" + lastErr.slice(0, 90), w: w }; return; }
        var vectors = (resp && resp.data) || [];
        var valid = vectors.filter(function (v) { return Array.isArray(v) && v.length === 768; }).map(function (v) { return v.map(function (z) { return Number.isFinite(z) ? z : 0; }); });
        if (valid.length === 0) { prepared[idx] = { error: true, w: w }; return; }
        prepared[idx] = { w: w, chs: chs, valid: valid, cat: categorize(chs.join(" "), w.key) };
      }));
    }

    for (var x = 0; x < work.length; x++) {
      if (Date.now() - t0 > RUN_DEADLINE_MS) { s.notes.push("deadline-acct@" + x); break; }
      var p = prepared[x];
      if (p === null) { s.skipped++; continue; }
      if (p.skip) { s.skipped++; try { var sw = p.w; await env.PERSONAL.prepare("INSERT INTO files (path,type,size,modified,indexed_at,chunks,title,category,wbs,qnfo_link) VALUES (?1,?2,?3,?4,?5,0,?6,'general',NULL,NULL) ON CONFLICT(path) DO UPDATE SET type=?2,size=?3,modified=?4,indexed_at=?5,chunks=0,title=?6").bind(sw.path, extOf(sw.key), sw.obj.size, (sw.obj.uploaded ? sw.obj.uploaded.toISOString() : new Date().toISOString()), new Date().toISOString(), basename(sw.key)).run(); } catch (e) { logCaught("run", e); } continue; }
      if (p.error) { s.errors++; if (p.msg) s.notes.push(p.msg); if (p.w) { try { var ew = p.w; var fr = await env.PERSONAL.prepare("SELECT fails,last_at FROM embed_failures WHERE path=?1").bind(ew.path).first(); var prevAt = (fr && fr.last_at) ? Date.parse(fr.last_at) : 0; var stale = (Date.now() - prevAt) > 3600000; var nf = ((fr && fr.fails && !stale) ? fr.fails : 0) + 1; if (nf >= 3) { await env.PERSONAL.prepare("INSERT INTO files (path,type,size,modified,indexed_at,chunks,title,category,wbs,qnfo_link) VALUES (?1,?2,?3,?4,?5,0,?6,'embed-failed',NULL,NULL) ON CONFLICT(path) DO UPDATE SET type=?2,size=?3,modified=?4,indexed_at=?5,chunks=0,title=?6").bind(ew.path, extOf(ew.key), ew.obj.size, (ew.obj.uploaded ? ew.obj.uploaded.toISOString() : new Date().toISOString()), new Date().toISOString(), basename(ew.key)).run(); await env.PERSONAL.prepare("DELETE FROM embed_failures WHERE path=?1").bind(ew.path).run(); } else { await env.PERSONAL.prepare("INSERT INTO embed_failures (path,fails,last_at) VALUES (?1,?2,?3) ON CONFLICT(path) DO UPDATE SET fails=?2,last_at=?3").bind(ew.path, nf, new Date().toISOString()).run(); } } catch (e) { logCaught("run", e); } } continue; }
      var w = p.w;
      var dg = await sha256hex(w.path);
      var vecBatch = [], chunkStmts = [];
      for (var ci = 0; ci < p.valid.length; ci++) {
        var id = dg + ":" + ci;
        vecBatch.push({ id: id, values: p.valid[ci], metadata: { path: w.path, type: extOf(w.key), chunk: String(ci), category: String(p.cat), modified: String(w.obj.uploaded ? w.obj.uploaded.toISOString() : ""), text: sanitize(p.chs[ci], 800) } });
        chunkStmts.push(env.PERSONAL.prepare("INSERT INTO chunks (id,path,chunk_idx,text_len) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET path=?2,chunk_idx=?3,text_len=?4").bind(id, w.path, ci, p.chs[ci].length));
      }
      var vzOk = false;
      for (var va = 0; va < 3 && !vzOk; va++) {
        try { await env.VZ.upsert(vecBatch); vzOk = true; }
        catch (e) { if (va < 2) await new Promise(function (r) { setTimeout(r, 300 * (va + 1)); }); else s.notes.push("vz-upsert:" + String((e && e.message) || e).slice(0, 90)); }
      }
      if (!vzOk) { s.errors++; continue; }
      s.vectors += vecBatch.length; s.chunks += vecBatch.length;
      try { await env.PERSONAL.batch(chunkStmts); } catch (e) { logCaught("run", e); }
      try {
        var mod = w.obj.uploaded ? w.obj.uploaded.toISOString() : new Date().toISOString();
        await env.PERSONAL.prepare("INSERT INTO files (path,type,size,modified,indexed_at,chunks,title,category,wbs,qnfo_link) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL,NULL) ON CONFLICT(path) DO UPDATE SET type=?2,size=?3,modified=?4,indexed_at=?5,chunks=?6,title=?7,category=?8").bind(w.path, extOf(w.key), w.obj.size, mod, new Date().toISOString(), p.valid.length, basename(w.key), p.cat).run();
        s.indexed++;
      } catch (e) { s.errors++; }
    }

    try {
      await env.PERSONAL.prepare("INSERT INTO vault_indexer_runs (started,finished,scanned,changed,indexed,chunks,skipped,reconciled,errors,notes) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)").bind(new Date(t0).toISOString(), new Date().toISOString(), s.scanned, s.changed, s.indexed, s.chunks, s.skipped, s.reconciled, s.errors, JSON.stringify((s.notes || []).slice(0, 50))).run();
    } catch (e) { logCaught("run", e); }

    if (haveLock) { try { await env.PERSONAL.prepare("DELETE FROM vault_indexer_lock WHERE id=1").run(); } catch (e) { logCaught("run", e); } }
    // VAULT-INDEXER-FOLD-1: the standalone script self-reported its VERSION to the deploy-guard ledger.
    // As a member of personal-companion it is versioned by its host, so that report is dropped.
    var selfreport = "folded:personal-companion";

    try {
      await env.VAULT.put("_meta/vault-indexer.status.json", JSON.stringify({ ts: new Date().toISOString(), scanned: s.scanned, changed: s.changed, indexed: s.indexed, chunks: s.chunks, reconciled: s.reconciled, errors: s.errors, selfreport: selfreport }), { httpMetadata: { contentType: "application/json" } });
    } catch (e) { logCaught("run", e); }

    s.elapsedMs = Date.now() - t0;
    return s;
  }
  return { run: run, VERSION: VERSION };
})();

// OWNER-PROMPTS-1 (2026-10-03, pillar: personal): the personal system asks Rowan questions instead of waiting to be asked.
// Producers (calendar-api) write rows into qnfo-audit.owner_questions with the message and its one-tap links already composed;
// this worker only DELIVERS, from its existing hourly tick (no new cron, no model call). Owner notices go through
// the native SEND_EMAIL binding (fallback: qnfo-email /send with handoff:true, the owner-notice path HANDOFF-ALLOWLIST-1); the
// digest opt-out list (email_suppression) is left untouched. Caps: PROMPT_DAILY_CAP per Amsterdam day, one mail per tick,
// PROMPT_MAX_ATTEMPTS tries per row, quiet hours 22:00-08:00 Amsterdam. Failures are written to the row, never swallowed.
var PROMPT_DAILY_CAP = 2;
var PROMPT_MAX_ATTEMPTS = 5;
var PROMPT_OWNER = "rwnquni@outlook.com";
// COMPANION-STALE-1 (1.33.0): a question about yesterday's concert is worth asking the next morning, not a week later. A queued
// question older than this is never mailed (nor listed as waiting); it stays in owner_questions unsent as the record.
var QUESTION_FRESH_MS = 36 * 36e5;
// A reminder whose date passed more than this long ago is not repeated in the brief every morning; the brief counts it once.
var REMINDER_STALE_MS = 3 * 864e5;
function promptQuietHour(ms) {
  var h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", hour12: false }).format(new Date(ms)));
  return h >= 22 || h < 8;
}
// MORNING-BRIEF-OWNER-NOTICE-1: one shared owner-notice sender. Goes to the owner's own address only (the recipient is a
// constant, never a parameter), never reads or writes email_suppression, so the 2026-09-22 digest opt-out keeps silencing
// essay mail while the owner's own transactional mail (morning brief, owner questions) arrives.
// PERSONAL-RESILIENCE-1: shared helpers.
// Owner kill switch: qnfo-audit.calendar_meta (k, v) row owner_notice_enabled. 0/off/false/no/disabled stops the morning brief and
// owner questions; a missing row, any other value or an unreadable table means on (default on).
async function ownerNoticeEnabled(env) {
  try {
    if (!env.AUDIT) return true;
    var r = await env.AUDIT.prepare("SELECT v FROM calendar_meta WHERE k = 'owner_notice_enabled'").first();
    if (!r || r.v == null) return true;
    return ["0", "off", "false", "no", "disabled"].indexOf(String(r.v).trim().toLowerCase()) < 0;
  } catch (e) { return true; }
}
// Guarded ALTER: add a column only when PRAGMA table_info does not list it; a concurrent duplicate-column error is not a failure.
async function ensureColumns(db, table, cols) {
  var info = await db.prepare("PRAGMA table_info(" + table + ")").all();
  var have = {}; ((info && info.results) || []).forEach(function (c) { have[c.name] = 1; });
  for (var name in cols) {
    if (have[name]) continue;
    try { await db.prepare("ALTER TABLE " + table + " ADD COLUMN " + name + " " + cols[name]).run(); }
    catch (e) { if (!/duplicate column/i.test(String(e && e.message || e))) throw e; }
  }
}
// The UTC instant of 00:00 Europe/Amsterdam on the Amsterdam day of ms (winter UTC+1, summer UTC+2).
function amsMidnightUtcMs(ms) {
  var day = amsDayKey(new Date(ms));
  var base = new Date(day + "T00:00:00Z").getTime();
  for (var off = 2; off >= 1; off--) {
    var t = base - off * 36e5;
    if (amsDayKey(new Date(t)) === day && amsDayKey(new Date(t - 6e4)) !== day) return t;
  }
  return base - 2 * 36e5;
}
function sqlStamp(ms) { return new Date(ms).toISOString().replace("T", " ").slice(0, 19); }
// SLA-120M-COMPANION-1 (1.25.5): a claim left by a worker that died is retried after 120 minutes (was 6 h). The claim is not a lease on
// work in progress: the mail either left or it did not, and a longer expiry only moved when a rare duplicate could go out, not whether.
var PROMPT_CLAIM_STALE_MS = 120 * 6e4;
var BRIEF_RETRY_AFTER_MS = 90 * 6e4;
// COMPANION-EMAIL-OPT-IN-1 (1.33.0, owner 2026-10-19: "What the world doesn't need is more email"): the companion reaches the
// owner through the app at personal-api /companion and its Web Push, not the inbox. wellbeing_config email_mode (personal-life,
// set on the companion's Data tab) decides what may still be mailed: "off" (the default: nothing), "daily" (the morning brief
// only) or "all" (the old behaviour). A crisis follow-up is mailed in every mode: it is rare, only on risk words, and safety
// outranks inbox quiet.
var EMAIL_MODES = ["off", "daily", "all"];
async function companionEmailMode(env) {
  try {
    if (!env.PERSONAL) return "off";
    var r = await env.PERSONAL.prepare("SELECT value FROM wellbeing_config WHERE key = 'email_mode'").first();
    var v = r && r.value != null ? String(r.value).replace(/"/g, "").trim().toLowerCase() : "off";
    return EMAIL_MODES.indexOf(v) >= 0 ? v : "off";
  } catch (e) { return "off"; }
}
function emailKindAllowed(mode, kind) {
  if (kind === "crisis") return true;
  if (mode === "all") return true;
  return mode === "daily" && kind === "brief";
}
var OWNER_NOTICE_FROM = [{ email: "companion@q08.org", name: "Companion" }, "rowan.quni@qnfo.org"];
async function sendOwnerNotice(env, subject, text, kind) {
  if (!env.SEND_EMAIL && !env.EMAIL) return { ok: false, error: "no mail binding" };
  // TRAVEL-SIGNIN-MAIL-1 (2026-10-26, owner screenshot: "Email me a code" refused with "companion e-mail is off"): a sign-in
  // code is mail the owner asked for that minute, so it skips the quiet-inbox settings; without it no one can sign in.
  var _signin = kind === "signin";
  if (!_signin && !(await ownerNoticeEnabled(env))) return { ok: false, disabled: true, error: "owner notices disabled (calendar_meta owner_notice_enabled)" };
  var _mode = _signin ? "all" : await companionEmailMode(env);
  if (!emailKindAllowed(_mode, kind || "other")) return { ok: false, disabled: true, app: true, mode: _mode, error: "companion e-mail is " + _mode + " (wellbeing_config email_mode); the app and push carry " + (kind || "this") };
  subject = String(subject == null ? "" : subject).replace(/[\r\n]+/g, " ").slice(0, 200);
  text = String(text == null ? "" : text).slice(0, 20000);
  try {
    if (env.SEND_EMAIL) {
      // DOMAIN-PLANE-1 / DOMAIN-PLANE-OWNER-MAIL-1 (issue 100229): personal mail comes from the personal domain first
      // (companion@q08.org, the sender personal-api's sign-in code uses), then from the proven qnfo.org sender when the binding
      // refuses it. Subscriber mail (sendOne) keeps its sender.
      var _lastErr = null;
      for (var _fi = 0; _fi < OWNER_NOTICE_FROM.length; _fi++) {
        try {
          await env.SEND_EMAIL.send({ to: PROMPT_OWNER, from: OWNER_NOTICE_FROM[_fi], subject: subject, text: text });
          return { ok: true, via: "send_email", from: typeof OWNER_NOTICE_FROM[_fi] === "string" ? OWNER_NOTICE_FROM[_fi] : OWNER_NOTICE_FROM[_fi].email };
        } catch (eFrom) { _lastErr = eFrom; }
      }
      throw _lastErr;
    }
    var resp = await env.EMAIL.fetch("https://email.internal/send", {
      method: "POST",
      // EMAIL-CALLER-PROPS-1 (#1923): qnfo-email 2.5.1+ authenticates this binding by its props (wrangler.toml); no key copy.
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: PROMPT_OWNER, from: "rowan.quni@qnfo.org", subject: subject, body: text, handoff: true })
    });
    if (!resp.ok) return { ok: false, error: "email " + resp.status + " " + String(await resp.text().catch(function () { return ""; })).slice(0, 200) };
    return { ok: true, via: "email" };
  } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 240) }; }
}
function wellbeingSend(env, to, subject, body, kind) { return sendOwnerNotice(env, subject, body, kind || "nudge"); }
// TRAVEL-PLANNER-1: the travel module mails through the owner-notice path and counts its model calls like every other caller.
function travelDeps(env) {
  return {
    send: function (subject, body) { return sendOwnerNotice(env, subject, body, "travel"); },
    sendCode: function (subject, body) { return sendOwnerNotice(env, subject, body, "signin"); },
    ai: function (model, input) { return aiRunAttr(env, "personal-companion", "travel-planner", model, input); },
    // TRAVEL-CHAT-1: the chat's model menu obeys the same ban list as every other model call here
    modelAllowed: modelAllowed,
    // Cloudflare Access public keys (only read when travel_config access_team and access_aud are set); edge-cached 1 h
    accessCerts: async function (team) {
      var r = await fetch("https://" + encodeURIComponent(team) + ".cloudflareaccess.com/cdn-cgi/access/certs", { cf: { cacheTtl: 3600, cacheEverything: true } });
      return r.ok ? r.json() : { keys: [] };
    },
    // TRAVEL-TRIP-1: weather and place lookups for the trip view, Open-Meteo hosts only (no key; forecasts edge-cached 30 min)
    http: async function (url) {
      var h = new URL(url).hostname;
      if (["api.open-meteo.com", "archive-api.open-meteo.com", "geocoding-api.open-meteo.com"].indexOf(h) < 0) throw new Error("host not allowed: " + h);
      var r = await fetch(url, { cf: { cacheTtl: 1800, cacheEverything: true } });
      if (!r.ok) throw new Error(h + " " + r.status);
      return r.json();
    }
  };
}
async function deliverOwnerPrompts(env, nowMs) {
  var out = { sent: 0, skipped: "", error: null };
  if (!env.AUDIT) { out.skipped = "no AUDIT binding"; return out; }
  if (!env.SEND_EMAIL && !env.EMAIL) { out.skipped = "no mail binding"; return out; }
  nowMs = nowMs || Date.now();
  try {
    if (!(await ownerNoticeEnabled(env))) { out.skipped = "owner notices disabled"; return out; }
    // COMPANION-EMAIL-OPT-IN-1: checked before the claim, so a mode that mails no questions spends no attempt on them.
    if (!emailKindAllowed(await companionEmailMode(env), "question")) { out.skipped = "companion e-mail mode"; return out; }
    await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS owner_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ref TEXT, subject TEXT NOT NULL, body TEXT NOT NULL, priority INTEGER DEFAULT 5, not_before TEXT, created_at TEXT DEFAULT (datetime('now')), sent_at TEXT, attempts INTEGER DEFAULT 0, last_error TEXT, UNIQUE(kind, ref))").run();
    await ensureColumns(env.AUDIT, "owner_questions", { claimed_at: "TEXT", flagged_at: "TEXT" });
    if (promptQuietHour(nowMs)) { out.skipped = "quiet hours"; return out; }
    var nowStr = sqlStamp(nowMs);
    var cnt = await env.AUDIT.prepare("SELECT count(*) n FROM owner_questions WHERE sent_at >= ?1").bind(sqlStamp(amsMidnightUtcMs(nowMs))).first();
    if (cnt && cnt.n >= PROMPT_DAILY_CAP) { out.skipped = "daily cap"; return out; }
    var staleStr = sqlStamp(nowMs - PROMPT_CLAIM_STALE_MS);
    var row = await env.AUDIT.prepare("SELECT id, subject, body FROM owner_questions WHERE sent_at IS NULL AND attempts < ?1 AND (not_before IS NULL OR not_before <= ?2) AND (claimed_at IS NULL OR claimed_at <= ?3) AND created_at >= ?4 ORDER BY priority, id LIMIT 1").bind(PROMPT_MAX_ATTEMPTS, nowStr, staleStr, sqlStamp(nowMs - QUESTION_FRESH_MS)).first();
    if (!row) { out.skipped = "queue empty"; return out; }
    // PERSONAL-RESILIENCE-1: claim the row (attempt counted) BEFORE the mail leaves, so a worker death or a failed sent_at write
    // cannot make the next tick mail the same question again. A failed send releases the claim; a claim whose worker died is
    // retried only after PROMPT_CLAIM_STALE_MS.
    var claim = await env.AUDIT.prepare("UPDATE owner_questions SET claimed_at = ?2, attempts = attempts + 1 WHERE id = ?1 AND sent_at IS NULL AND (claimed_at IS NULL OR claimed_at <= ?3)").bind(row.id, nowStr, staleStr).run();
    if (!claim || !claim.meta || !claim.meta.changes) { out.skipped = "claimed elsewhere"; return out; }
    var nr;
    try { nr = await sendOwnerNotice(env, row.subject, row.body, "question"); } catch (eSend) { nr = { ok: false, error: String(eSend && eSend.message || eSend).slice(0, 240) }; }
    if (!nr || !nr.ok) {
      var err = (nr && nr.error) || "send failed";
      await env.AUDIT.prepare("UPDATE owner_questions SET claimed_at = NULL, last_error = ?2 WHERE id = ?1").bind(row.id, err).run();
      out.error = err;
    } else {
      out.sent = 1;
      var marked = false;
      for (var t = 0; t < 2 && !marked; t++) {
        try { await env.AUDIT.prepare("UPDATE owner_questions SET sent_at = ?2, last_error = NULL WHERE id = ?1").bind(row.id, nowStr).run(); marked = true; } catch (eMark) { out.error = "sent but sent_at not recorded: " + String(eMark && eMark.message || eMark).slice(0, 160); }
      }
      if (marked) out.error = null;
    }
  } catch (e) { out.error = String(e && e.message || e).slice(0, 240); }
  return out;
}
// CONNECTION-LEDGER-1 step 2 (2026-10-04, pillar: personal): a person who is due in the Ledger (personal-life v_ledger_due)
// becomes ONE owner question, kind follow-up, ref <person id>-<ISO week>, so the same person is asked at most once a week and the
// whole system at most once a day. Template text only, no model call. Ledger rows are read, never copied: the question carries
// the name and the place, nothing else. The reply-not-needed line keeps the mail from reading as a chore.
function isoWeekKey(ms) {
  var d = new Date(ms); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  var dn = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - dn);
  var y = d.getUTCFullYear(); var wk = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return y + "-W" + (wk < 10 ? "0" : "") + wk;
}
function ledgerText(v, max) { return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
var OWNER_QUESTIONS_DDL = "CREATE TABLE IF NOT EXISTS owner_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ref TEXT, subject TEXT NOT NULL, body TEXT NOT NULL, priority INTEGER DEFAULT 5, not_before TEXT, created_at TEXT DEFAULT (datetime('now')), sent_at TEXT, attempts INTEGER DEFAULT 0, last_error TEXT, UNIQUE(kind, ref))";
async function queueLedgerFollowUp(env, nowMs) {
  var out = { queued: 0, skipped: "", error: null };
  if (!env.AUDIT || !env.PERSONAL) { out.skipped = "no binding"; return out; }
  nowMs = nowMs || Date.now();
  try {
    await env.AUDIT.prepare(OWNER_QUESTIONS_DDL).run();
    var day = amsDayKey(new Date(nowMs));
    var startUtc = sqlStamp(amsMidnightUtcMs(nowMs));
    var cnt = await env.AUDIT.prepare("SELECT count(*) n FROM owner_questions WHERE kind = 'follow-up' AND created_at >= ?1").bind(startUtc).first();
    if (cnt && cnt.n >= 1) { out.skipped = "daily cap"; return out; }
    var due = await env.PERSONAL.prepare("SELECT id, name, met_where, days_since FROM v_ledger_due LIMIT 10").all();
    var rows = (due && due.results) || [];
    if (!rows.length) { out.skipped = "nobody due"; return out; }
    var wk = isoWeekKey(nowMs);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]; var name = ledgerText(r.name, 80); if (!name) continue;
      var where = ledgerText(r.met_where, 80);
      var draft = "Hi " + name + (where ? ", good to meet you at " + where + ". " : ", it was good to see you. ") + "Want to get a coffee sometime?";
      var body = "It has been " + (Number(r.days_since) || 0) + " days since you last had contact with " + name + ". A draft you can copy:" + NL + NL + draft + NL + NL + "Replying here is not needed.";
      var res = await env.AUDIT.prepare("INSERT OR IGNORE INTO owner_questions (kind, ref, subject, body, priority) VALUES ('follow-up', ?1, ?2, ?3, 4)").bind(String(r.id) + "-" + wk, "Message " + name + "?", body).run();
      if (res && res.meta && res.meta.changes > 0) { out.queued = 1; break; }
    }
    if (!out.queued) out.skipped = "already asked this week";
  } catch (e) { out.error = String(e && e.message || e).slice(0, 240); }
  return out;
}
// CONNECTION-LEDGER-1 step 3 + CONNECTION-ENGAGEMENT-1: the two connection metrics live in two databases, so no registry
// refresh query can compute both; this worker (the metrics' owner) writes their values into qnfo-audit.metric_registry each tick.
// ledger_people_seen_twice: personal-life v_ledger_seen_twice.seen_twice. owner_question_answer_rate_14d: answered / sent over
// kind after-event only (a triage ref is an ISO week, not a calendar id, so it can never match a feedback row) in 14 days, answered = a calendar_feedback row for the same calendar id (the question's ref)
// within 48h of the send; NULL (unreadable, never 0) under 6 sent so a quiet fortnight cannot breach.
var ANSWER_RATE_SQL = "SELECT COUNT(*) sent, SUM(CASE WHEN EXISTS (SELECT 1 FROM calendar_feedback f WHERE f.cal_id = CAST(q.ref AS INTEGER) AND f.ts >= q.sent_at AND f.ts <= datetime(q.sent_at, '+48 hours')) THEN 1 ELSE 0 END) answered FROM owner_questions q WHERE q.kind = 'after-event' AND q.sent_at IS NOT NULL AND q.sent_at >= datetime('now', '-14 days')";
async function refreshConnectionMetrics(env) {
  var out = { seen_twice: null, answer_rate: null, error: null };
  if (!env.AUDIT) return out;
  var stamp = new Date().toISOString().slice(0, 19) + "Z";
  try {
    if (env.PERSONAL) {
      var st = await env.PERSONAL.prepare("SELECT seen_twice FROM v_ledger_seen_twice").first();
      if (st && st.seen_twice != null) {
        out.seen_twice = Number(st.seen_twice);
        await env.AUDIT.prepare("UPDATE metric_registry SET last_value = ?2, last_refreshed = ?3 WHERE metric = ?1").bind("ledger_people_seen_twice", String(out.seen_twice), stamp).run();
      }
    }
    var ar = await env.AUDIT.prepare(ANSWER_RATE_SQL).first();
    var sent = ar ? Number(ar.sent) || 0 : 0;
    if (sent >= 6) out.answer_rate = Math.round(1000 * (Number(ar.answered) || 0) / sent) / 1000;
    await env.AUDIT.prepare("UPDATE metric_registry SET last_value = ?2, last_refreshed = ?3 WHERE metric = ?1").bind("owner_question_answer_rate_14d", out.answer_rate == null ? "n/a" : String(out.answer_rate), stamp).run();
  } catch (e) { out.error = String(e && e.message || e).slice(0, 240); }
  return out;
}
// OWNER-QUESTION-UNDELIVERABLE-1: a question that hit the attempt cap without ever being sent would otherwise sit silently;
// file one medium agent_issues row per subject (deduped on an open row with the same title).
async function flagUndeliverableQuestions(env) {
  var out = { filed: 0 };
  try {
    if (!env.AUDIT) return out;
    await ensureColumns(env.AUDIT, "owner_questions", { claimed_at: "TEXT", flagged_at: "TEXT" });
    var rows = await env.AUDIT.prepare("SELECT id, subject, attempts, last_error FROM owner_questions WHERE attempts >= ?1 AND sent_at IS NULL AND flagged_at IS NULL ORDER BY id LIMIT 10").bind(PROMPT_MAX_ATTEMPTS).all();
    var list = (rows && rows.results) || [];
    for (var i = 0; i < list.length; i++) {
      var q = list[i], title = "OWNER-QUESTION-UNDELIVERABLE-1: " + q.subject;
      var open = await env.AUDIT.prepare("SELECT id FROM agent_issues WHERE title = ?1 AND status = 'open' LIMIT 1").bind(title).first();
      var now = Date.now();
      // flagged once per row (flagged_at), so closing the issue while the row is still stuck does not refile it
      if (open) { await env.AUDIT.prepare("UPDATE owner_questions SET flagged_at = ?2 WHERE id = ?1").bind(q.id, sqlStamp(now)).run(); continue; }
      var desc = "owner_questions id " + q.id + " has " + q.attempts + " failed delivery attempts and was never sent. last_error: " + String(q.last_error || "none").slice(0, 200) + ". Charter pillar: personal. Fix the send path (sendOwnerNotice / SEND_EMAIL), then reset attempts to 0 so the hourly tick resends it.";
      await env.AUDIT.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) VALUES (?1, ?2, 'personal-companion', 'personal', 'medium', 'open', ?3, ?3)").bind(title, desc, now).run();
      await env.AUDIT.prepare("UPDATE owner_questions SET flagged_at = ?2 WHERE id = ?1").bind(q.id, sqlStamp(now)).run();
      out.filed++;
    }
  } catch (e) { out.error = String(e && e.message || e).slice(0, 240); }
  return out;
}
__name(flagUndeliverableQuestions, "flagUndeliverableQuestions");
function splitStaleTasks(tasks, nowMs) {
  var fresh = [], stale = [], seen = {};
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i]; if (!t) continue;
    var id = t.id || t.title; if (seen[id]) continue; seen[id] = 1;
    var due = t.due ? Date.parse(String(t.due).length === 10 ? t.due + "T23:59:59Z" : t.due) : NaN;
    if (isFinite(due) && nowMs - due > REMINDER_STALE_MS) stale.push(t); else fresh.push(t);
  }
  return { fresh: fresh, stale: stale };
}
async function sendMorningBrief(env, nowMs) {
  try {
    nowMs = nowMs || Date.now();
    if (!(await ownerNoticeEnabled(env))) return { ok: true, skipped: "owner notices disabled" };
    if (!emailKindAllowed(await companionEmailMode(env), "brief")) return { ok: true, skipped: "companion e-mail mode" };
    await env.PERSONAL.prepare("CREATE TABLE IF NOT EXISTS companion_morning_brief (date TEXT PRIMARY KEY, sent_at TEXT NOT NULL)").run();
    // PERSONAL-RESILIENCE-1: claimed_at + sent. A row from before this column exists reads sent=1 (the column default).
    await ensureColumns(env.PERSONAL, "companion_morning_brief", { claimed_at: "TEXT", sent: "INTEGER DEFAULT 1" });
    var day = amsDayKey(new Date(nowMs));
    var already = await env.PERSONAL.prepare("SELECT date, sent, claimed_at, sent_at FROM companion_morning_brief WHERE date = ?").bind(day).first();
    var retryFrom = null;
    if (already) {
      if (already.sent !== 0) return { ok: true, skipped: "already sent" };
      // an unsent claim: the worker died (or the release failed) between claim and send; retry once it is 90 min old,
      // only inside 08:00-12:00 Amsterdam
      var cl = Date.parse(already.claimed_at || already.sent_at);
      if (!(nowMs - cl >= BRIEF_RETRY_AFTER_MS)) return { ok: true, skipped: "claim in flight" };
      var hr = Number(amsParts(new Date(nowMs)).hour);
      if (!(hr >= 8 && hr < 12)) return { ok: true, skipped: "retry window closed" };
      retryFrom = already.claimed_at || already.sent_at;
    }
    var br = await env.PERSONAL.prepare("SELECT payload FROM daily_briefs WHERE date = ?").bind(day).first();
    if (!br || !br.payload) return { ok: true, skipped: "no brief yet" };
    var b = null;
    try { b = JSON.parse(br.payload); } catch (e) { return { ok: false, error: "parse" }; }
    if (!b) return { ok: true, skipped: "empty" };
    var L = [];
    L.push("Morning - " + day);
    L.push("");
    if (b.weather && b.weather.text) L.push("Weather: " + b.weather.text);
    var today = (b.calendar && b.calendar.today) || [];
    L.push("");
    if (today.length) {
      L.push("Today:");
      for (var i = 0; i < today.length; i++) {
        var e = today[i];
        L.push("- " + (e.title || "") + (e.location ? " @ " + e.location : "") + (e.calendar === "suggestion" || e.status === "tentative" ? " (suggestion)" : ""));
      }
    } else {
      L.push("Today: nothing scheduled.");
    }
    // COMPANION-STALE-1: the brief repeated reminders dated 2026-09-05..11 every morning in October. A reminder long past its date
    // is counted once, with where to sort it, instead of being listed again.
    var split = splitStaleTasks(((b.open && b.open.tasks) || []).concat((b.open && b.open.stale) || []), nowMs);
    var tasks = split.fresh;
    if (tasks.length) {
      L.push("");
      L.push("Open tasks:");
      for (var j = 0; j < tasks.length; j++) L.push("- " + (tasks[j].title || ""));
    }
    if (split.stale.length) {
      L.push("");
      L.push(split.stale.length + " older reminder" + (split.stale.length === 1 ? " is" : "s are") + " past " + (split.stale.length === 1 ? "its" : "their") + " date. Mark them done or drop them on the Do tab: https://me.q08.org");
    }
    var up = (b.calendar && b.calendar.upcoming7) || [];
    var ups = [];
    for (var k = 0; k < up.length && k < 6; k++) {
      var u = up[k];
      if (today.length && u && u.id && today[0].id === u.id) continue;
      ups.push("- " + (u.title || "") + (u.location ? " @ " + u.location : "") + (u.dtstart ? " (" + String(u.dtstart).slice(0, 10) + ")" : ""));
    }
    if (ups.length) {
      L.push("");
      L.push("Coming up:");
      for (var m = 0; m < ups.length; m++) L.push(ups[m]);
    }
    L.push("");
    // CAL-FEED-ROTATE-1 (2026-10-01): the personal feed URL was hard-coded here, in a public repository, so anyone could
    // subscribe to the owner's personal calendar. Read the current token at send time (calendar_meta in qnfo-audit, written
    // by calendar-api); after a rotation the brief carries the new URL with no code change.
    try {
      var _ft = env.AUDIT ? await env.AUDIT.prepare("SELECT v FROM calendar_meta WHERE k='ics_token_personal'").first() : null;
      if (_ft && _ft.v) L.push("Calendar feed: https://pub-7e5e6cd48f4b43ebb55a5ee25093cb71.r2.dev/calendar/personal-" + _ft.v + ".ics");
    } catch (eFeed) { logCaught("sendMorningBrief", eFeed); }
    try {
      if (env.AUDIT) {
        var qs;
        try { qs = await env.AUDIT.prepare("SELECT q.subject, q.sent_at FROM owner_questions q WHERE ((q.sent_at IS NULL AND q.created_at >= datetime('now','-36 hours')) OR q.sent_at >= datetime('now','-2 days')) AND NOT (q.kind = 'after-event' AND EXISTS (SELECT 1 FROM calendar_feedback f WHERE f.cal_id = CAST(q.ref AS INTEGER))) ORDER BY q.sent_at IS NOT NULL, q.priority, q.id LIMIT 5").all(); } catch (eFb) { qs = await env.AUDIT.prepare("SELECT subject, sent_at FROM owner_questions WHERE (sent_at IS NULL AND created_at >= datetime('now','-36 hours')) OR sent_at >= datetime('now','-2 days') ORDER BY sent_at IS NOT NULL, priority, id LIMIT 5").all(); }
        var qr = (qs && qs.results) || [];
        if (qr.length) {
          L.push("");
          L.push("Questions waiting:");
          for (var qi = 0; qi < qr.length; qi++) L.push("- " + qr[qi].subject + (qr[qi].sent_at ? " (sent)" : " (queued)"));
        }
      }
    } catch (eQ) { logCaught("sendMorningBrief", eQ); }
    // WELLBEING-LOOP-1 / ONE-MORNING-MAIL-1: the check-in rides in this mail instead of arriving as
    // a second one fifteen minutes later. Guarded: a wellbeing failure must never stop the brief.
    try { var _wbL = await WBW.briefCheckinLines(env); if (_wbL && _wbL.length) { for (var _wl = 0; _wl < _wbL.length; _wl++) L.push(_wbL[_wl]); } } catch (eWbL) { logCaught("sendMorningBrief", eWbL); }
    var body = L.join(NL);
    // MORNING-BRIEF-CLAIM-1: claim the day before sending so two overlapping ticks cannot both mail it; a failed send
    // releases the claim so the next hourly tick retries.
    var stamp = new Date(nowMs).toISOString();
    var claim = retryFrom
      ? await env.PERSONAL.prepare("UPDATE companion_morning_brief SET claimed_at = ?2, sent_at = ?2 WHERE date = ?1 AND sent = 0 AND COALESCE(claimed_at, sent_at) = ?3").bind(day, stamp, retryFrom).run()
      : await env.PERSONAL.prepare("INSERT OR IGNORE INTO companion_morning_brief (date, sent_at, claimed_at, sent) VALUES (?, ?, ?, 0)").bind(day, stamp, stamp).run();
    if (!claim || !claim.meta || !claim.meta.changes) return { ok: true, skipped: "already sent" };
    var r;
    try { r = await sendOwnerNotice(env, "Morning - " + day, body, "brief"); } catch (eSend) { r = { ok: false, error: String(eSend && eSend.message || eSend) }; }
    if (!r || !r.ok) {
      try { await env.PERSONAL.prepare("DELETE FROM companion_morning_brief WHERE date = ? AND sent = 0").bind(day).run(); } catch (eRel) { console.error("morning-brief claim release:", String(eRel && eRel.message || eRel)); }
    } else {
      for (var mt = 0; mt < 2; mt++) {
        try { await env.PERSONAL.prepare("UPDATE companion_morning_brief SET sent = 1 WHERE date = ?").bind(day).run(); break; } catch (eMk) { console.error("morning-brief sent mark:", String(eMk && eMk.message || eMk)); }
      }
      // The check-in line went out in this mail, so record it: the standalone 07:45 path must not repeat it.
      try { await WBW.noteCheckinInBrief(env); } catch (eWbN) { logCaught("sendMorningBrief", eWbN); }
    }
    return r;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
__name(sendMorningBrief, "sendMorningBrief");

// True when the latest generation run ended "blocked" (it stopped before composing, so a retry spends no model calls).
async function blockedRetryDue(env) {
  try {
    var r = await env.PERSONAL.prepare("SELECT status FROM companion_runs WHERE status IN ('ok','failed','blocked','error') AND form <> 'steward' ORDER BY id DESC LIMIT 1").first();
    return !!(r && r.status === "blocked");
  } catch (e) { return false; }
}
// COMPANION-STARVED-RETRY-1 (1.15.6): a generation that failed (not blocked) waited for the next generation hour, 4 hours away, so five
// slots a day were the whole yield. While nothing has been published for 6 hours, the hourly tick retries a failed generation once its
// last run is at least 50 minutes old, up to 16 failed runs in 24 hours. The daily piece cap and the accuracy gate are unchanged.
var STARVED_RETRY_MIN_MS = 40 * 60000; // retired by STARVED-RETRY-SLA-1 (1.26.3): a run in progress, not a fixed bar, holds the retry back
// STARVED-RETRY-HOURLY-1 (1.21.7, 2026-10-13 17:01 UTC): the retry stopped once 16 runs had failed in 24 h, so after the 16:00 run nothing
// ran until the 20:00 generation hour, although 1.21.6 (topic screen, pruned-draft repair) had gone live at 16:14 and no run had used it.
// The cap is one retry per hourly tick (24 a day): it bounds a runaway loop, not the hourly retry itself. Spend is steered by the model
// choice at a breached cap, never by skipping a run (BUDGET-SOFT-ROUTE-1).
var STARVED_RETRY_MAX_24H = 24; // retired by STARVED-RETRY-SLA-1 (1.26.3); kept as a name for older readers, no longer read
// STARVED-RETRY-SLA-1 (1.26.3, agent_issues 2552; owner directive 2026-10-14: no SLA over 120 minutes, action at once past it): on
// 2026-10-14 the 08:00 UTC run ended at 08:34 (runs now take about 35 minutes), so the 09:00 tick was 26 minutes after it and under the
// 40-minute bar, and at 10:00 26 runs had failed in 24 h, over the cap of 24: neither tick ran, and companion 1.26.2 (live 09:02) waited
// for the 12:00 generation hour. A retry is now held back only while a run is in progress (a non-steward companion_runs row in the last
// STARVED_RETRY_QUIET_MS); the hourly tick itself is the bound (one retry per tick), and a spend cap steers the model, never skips a run
// (BUDGET-SOFT-ROUTE-1).
var STARVED_RETRY_QUIET_MS = 10 * 60000;
// COMPANION-GENERATION-SWITCH-1 (1.20.0, 2026-10-13): a no-deploy stop for the hourly generation. Off by default: an absent key, on, or a
// failed read (logged) lets generation run. A migration that sets qnfo-audit ops_config companion_generation to hold, off, paused or 0
// stops new pieces (and their subscriber mail) until a later migration sets it back; each stopped tick logs one companion_runs row. The
// manual /run route (companion key) and the worker's other jobs are unchanged. No row sets it: the owner wants reading.q08.org to publish
// (2026-10-13 05:2x and 11:26 UTC, "still no reading.q08.org content"), so the switch exists for an incident, not for a policy hold.
var GEN_HOLD_VALUES = ["hold", "held", "off", "paused", "pause", "0", "false", "no", "disabled"];
async function generationHold(env) {
  if (!env || !env.AUDIT) return null;
  try {
    var r = await env.AUDIT.prepare("SELECT value, note FROM ops_config WHERE key = 'companion_generation'").first();
    var v = String(r && r.value == null ? "" : (r ? r.value : "")).trim().toLowerCase();
    return v && GEN_HOLD_VALUES.indexOf(v) >= 0 ? { value: v, note: String(r.note || "").slice(0, 200) } : null;
  } catch (e) {
    console.error("COMPANION-GENERATION-HOLD-1 read failed: " + String(e && e.message || e).slice(0, 160));
    return null;
  }
}
var PIPE_PROPERTY = "reading.q08.org", PIPE_ID_PREFIX = "cr-", PIPE_WORKER = "personal-companion";
function PIPE_DB(env) { return env.PERSONAL; }
// companion_runs.run_at is ISO text ("2026-10-14T08:12:48.477Z")
function pipeSince(ms) { return new Date(ms).toISOString(); }
var PIPE_SELECT = "SELECT id, run_at, form, topic, status, detail FROM companion_runs WHERE id > ?1 AND run_at >= ?2 AND status IN ('ok', 'rejected') AND form <> 'steward' ORDER BY id LIMIT ?3";
function pipeItem(r) {
  var ok = r.status === "ok";
  return { id: r.id, flow: String(r.form || "essay"), title: String(r.topic || "").replace(/^wiki:/, ""), raw: ok ? "published: " + String(r.detail || "").slice(0, 120) : "rejected: " + String(r.detail || "").slice(0, 140),
    stage: ok ? "published" : "rejected", state: ok ? "done" : "rejected", since: String(r.run_at || "") };
}
// EXTERNAL-PROPERTIES-1 (owner 2026-10-14: '"By property" SHALL ALSO INCLUDE Q08.ORG AND READING.Q08.ORG'): the content page reads
// v_content_stage_summary in qnfo-audit, and this property's runs live in another database, so the worker mirrors its own finished items
// (the last PIPE_DAYS days, public fields only: the title and the stage) into qnfo-audit.content_external_items at the end of each tick.
// New rows only (ids above the newest mirrored one), in multi-row statements of PIPE_ROWS_PER_STMT rows (D1 binds at most 100 values
// per statement), and rows older than PIPE_DAYS are removed. A failure is logged and never stops the tick.
var PIPE_DAYS = 7, PIPE_ROWS_PER_STMT = 10, PIPE_MAX_ROWS = 700;
async function mirrorPipeline(env) {
  if (!env.AUDIT || !PIPE_DB(env)) return { ok: false, skipped: "no binding" };
  try {
    var last = await env.AUDIT.prepare("SELECT MAX(CAST(substr(item_id, ?2) AS INTEGER)) AS m FROM content_external_items WHERE property = ?1").bind(PIPE_PROPERTY, PIPE_ID_PREFIX.length + 1).first();
    var after = Number(last && last.m) || 0;
    var rows = ((await PIPE_DB(env).prepare(PIPE_SELECT).bind(after, pipeSince(Date.now() - PIPE_DAYS * 864e5), PIPE_MAX_ROWS).all()).results) || [];
    var items = rows.map(pipeItem).filter(Boolean);
    var stmts = [];
    for (var i = 0; i < items.length; i += PIPE_ROWS_PER_STMT) {
      var chunk = items.slice(i, i + PIPE_ROWS_PER_STMT), vals = [], binds = [];
      chunk.forEach(function (it) {
        vals.push("(?, ?, ?, ?, ?, ?, ?, ?)");
        binds.push(PIPE_PROPERTY, it.flow, PIPE_ID_PREFIX + it.id, String(it.title || "").slice(0, 160), String(it.raw || "").slice(0, 160), it.stage, it.state, it.since);
      });
      var st = env.AUDIT.prepare("INSERT OR REPLACE INTO content_external_items (property, flow, item_id, title, raw_status, stage, state, since) VALUES " + vals.join(", "));
      stmts.push(st.bind.apply(st, binds));
    }
    stmts.push(env.AUDIT.prepare("DELETE FROM content_external_items WHERE property = ?1 AND since < ?2").bind(PIPE_PROPERTY, new Date(Date.now() - PIPE_DAYS * 864e5).toISOString()));
    await env.AUDIT.batch(stmts);
    return { ok: true, mirrored: items.length };
  } catch (e) {
    console.error(JSON.stringify({ worker: PIPE_WORKER, where: "mirrorPipeline", error: String(e && e.message || e).slice(0, 300) }));
    return { ok: false, error: String(e && e.message || e).slice(0, 200) };
  }
}

async function starvedRetryDue(env) {
  try {
    var last = await env.PERSONAL.prepare("SELECT status, run_at FROM companion_runs WHERE status IN ('ok','failed','blocked','error') AND form <> 'steward' ORDER BY id DESC LIMIT 1").first();
    if (!last || (last.status !== "failed" && last.status !== "error")) return false;
    // STARVED-RETRY-BOUNDARY-1 (1.19.5): a failed run ends about 10 minutes into its tick (09:11:33 UTC on 2026-10-13), so the next
    // hourly tick (10:01:21) came 49.8 minutes later and the 50-minute bar skipped every other hour; 40 minutes clears a run of up to
    // 15 minutes (the cron wall) with margin.
    // STARVED-RETRY-SLA-1: only a run still in progress holds the retry back (its rows are newer than STARVED_RETRY_QUIET_MS)
    var busy = await env.PERSONAL.prepare("SELECT COUNT(*) n FROM companion_runs WHERE form <> 'steward' AND run_at > ?").bind(new Date(Date.now() - STARVED_RETRY_QUIET_MS).toISOString()).first();
    if (busy && Number(busy.n) > 0) return false;
    var ok = await env.PERSONAL.prepare("SELECT run_at FROM companion_runs WHERE status = 'ok' AND form <> 'steward' ORDER BY id DESC LIMIT 1").first();
    if (ok && Date.now() - new Date(ok.run_at).getTime() < 6 * 36e5) return false;
    return true;
  } catch (e) { return false; }
}
async function steward(env) {
  try {
    await ensureSchema(env);
    var n = Date.now();
    var okr = await env.PERSONAL.prepare("SELECT run_at FROM companion_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1").all();
    var lastOk = (okr.results || [])[0];
    var h = lastOk ? (n - new Date(lastOk.run_at).getTime()) / 36e5 : null;
    var r = await env.PERSONAL.prepare("SELECT status FROM companion_runs WHERE run_at > datetime('now','-24 hours') AND status IN ('ok','failed','rejected') ORDER BY id DESC LIMIT 200").all();
    var rows = r.results || [];
    var a = 0, o = 0;
    for (var i = 0; i < rows.length; i++) {
      a++;
      if (rows[i].status === "ok") o++;
    }
    var ar = a ? o / a : null;
    var d = "";
    if (h === null || h > 48) d = "stall: no successful piece in " + (h === null ? "ever" : h.toFixed(1) + "h");
    else if (ar !== null && a >= 8 && ar < 0.1) {
      // COMPANION-SOURCES-1: a collapse over a 24h window ends the moment the latest attempt is an accepted piece.
      var lt = await env.PERSONAL.prepare("SELECT status FROM companion_runs WHERE status IN ('ok','failed','rejected','blocked','error') AND form <> 'steward' ORDER BY id DESC LIMIT 1").first();
      if (!(lt && lt.status === "ok")) d = "collapse: accept rate " + Math.round(ar * 100) + "% over " + a + " attempts";
    }
    if (d) await env.PERSONAL.prepare("INSERT INTO companion_runs(run_at, form, model, topic, status, detail, ms) VALUES(?,?,?,?,?,?,?)").bind(nowIso(), "steward", "", "steward", "alert", d, 0).run();
    else {
      var la = await env.PERSONAL.prepare("SELECT status FROM companion_runs WHERE form = 'steward' ORDER BY id DESC LIMIT 1").first();
      if (la && la.status === "alert") await env.PERSONAL.prepare("INSERT INTO companion_runs(run_at, form, model, topic, status, detail, ms) VALUES(?,?,?,?,?,?,?)").bind(nowIso(), "steward", "", "steward", "resolved", "recovered: a piece was accepted" + (h === null ? "" : " " + h.toFixed(1) + "h ago"), 0).run();
    }
  } catch (e) { logCaught("steward", e); }
}
__name(steward, "steward");
__name2(steward, "steward");
__name22(steward, "steward");
var GenerationFlow = class extends WorkflowEntrypoint {
  static {
    __name(this, "GenerationFlow");
  }
  static {
    __name2(this, "GenerationFlow");
  }
  static {
    __name22(this, "GenerationFlow");
  }
  async run(event, step) {
    var form = event && event.payload && event.payload.form || RHYTHM[amsWeekday(/* @__PURE__ */ new Date())];
    var out = await step.do("generate", { timeout: "300 seconds" }, async () => {
      return await generate(this.env, form, {});
    });
    if (out && out.ok) {
      await step.do("publish", { timeout: "120 seconds" }, async () => {
        try {
          var pr = await this.env.PERSONAL.prepare("SELECT * FROM companion_pieces WHERE slug = ?").bind(out.slug).all();
          var prow = (pr.results || [])[0];
          if (prow && this.env.EMAIL) {
            prow.link = "https://reading.q08.org/p/" + out.slug;
            await sendMail(this.env, prow, out.slug, prow.day);
          }
        } catch (e) { logCaught("steward", e); }
      });
    }
    return out;
  }
};
// WORKERS-AI-SPEND-UNATTRIBUTED-RISING-1 (#1681): every env.AI.run in this worker goes through aiRunAttr, which adds a
// per-worker/purpose call counter to D1 ai_call_counters (one UPSERT per call, fail-soft, never blocks or alters the AI call).
// Copied from qnfo-fleet-control (workers cannot import across directories); same table/columns. No new paid service.
// Unlike fleet-control the counter write is NOT awaited (fire-and-forget, errors swallowed) so it can never add latency.
var AI_ATTR_DB_BINDINGS = ["AUDIT_DB","AUDIT","DB_AUDIT","QNFO_AUDIT"];
async function aiRunAttr(env, worker, purpose, model, input, opts) {
  var t0 = Date.now(), ok = 1;
  try { return await env.AI.run(model, input, opts); } catch (e) { ok = 0; throw e; }
  finally {
    try {
      var db = null;
      for (var bi = 0; bi < AI_ATTR_DB_BINDINGS.length && !db; bi++) db = env[AI_ATTR_DB_BINDINGS[bi]];
      if (db) {
        var ic = 0; try { ic = JSON.stringify(input && input.messages || input || "").length; } catch (e2) { console.error(JSON.stringify({ worker: worker, where: "aiRunAttr", error: String(e2 && e2.message || e2).slice(0, 300) })); }
        var day = new Date().toISOString().slice(0, 10);
        var ms = Date.now() - t0;
        var wr = (async function() {
          await db.prepare("CREATE TABLE IF NOT EXISTS ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, in_chars INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, PRIMARY KEY (day, worker, purpose, model))").run();
          await db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, in_chars, ms) VALUES (?1,?2,?3,?4,1,?5,?6,?7) ON CONFLICT(day, worker, purpose, model) DO UPDATE SET calls=calls+1, errors=errors+?5, in_chars=in_chars+?6, ms=ms+?7").bind(day, worker, purpose, String(model), ok ? 0 : 1, ic, ms).run();
        })();
        wr.catch(function (eLog) { console.error(JSON.stringify({ worker: worker, where: "aiRunAttr", error: String(eLog && eLog.message || eLog).slice(0, 300) })); });
      }
    } catch (e3) { console.error(JSON.stringify({ worker: worker, where: "aiRunAttr", error: String(e3 && e3.message || e3).slice(0, 300) })); }
  }
}
// end aiRunAttr
function groundingNeedles(problems) {
  var needles = [];
  (problems || []).forEach(function (p) {
    var rest = String(p).replace(/^grounding:\s*/i, "").trim();
    var q = rest.match(/"([^"]{2,})"/g);
    if (q) {
      q.forEach(function (m) { needles.push(m.slice(1, -1)); });
    } else {
      var ns = rest.match(/not in the source:\s*(.+)$/);
      if (ns) needles.push(ns[1].trim());
      else {
        var sq = rest.match(/'([^']{2,})'/g);
        if (sq) sq.forEach(function (m) { needles.push(m.slice(1, -1)); });
        else if (rest.length > 0 && rest.length < 120 && !/\bnot\b|\bfound\b|\bsource\b|\bunsupported\b/i.test(rest)) needles.push(rest);
      }
    }
  });
  return needles.filter(function (n, i, a) { return n.length > 0 && a.indexOf(n) === i; });
}
var __verify = { stallRecurred: stallRecurred, shortenFeedback: shortenFeedback, LENGTH_CEILING: LENGTH_CEILING, pruneClassOf: pruneClassOf, pruneClassesOf: pruneClassesOf, pruneRepeat: pruneRepeat, PRUNE_REPEAT_AFTER: PRUNE_REPEAT_AFTER, attemptBudgetStop: attemptBudgetStop, STALL_MIN: STALL_MIN, pruneHeadings: pruneHeadings, mirrorPipeline: mirrorPipeline, pipeItem: pipeItem, pipeSince: pipeSince, PIPE_SELECT: PIPE_SELECT, PIPE_PROPERTY: PIPE_PROPERTY, PIPE_ID_PREFIX: PIPE_ID_PREFIX, qualityWorst: qualityWorst, gateWorst: gateWorst, criticGroundingGates: criticGroundingGates, STARVED_RETRY_QUIET_MS: STARVED_RETRY_QUIET_MS, quotesAllSourced: quotesAllSourced, sourcedPassage: sourcedPassage, sourceSentences: sourceSentences, sourcedRereadNote: sourcedRereadNote, SOURCED_COVER: SOURCED_COVER, SENT_ABBREV_RE: SENT_ABBREV_RE, GROUND_MAX: GROUND_MAX, PRIMARY_SHARE: PRIMARY_SHARE, deleteSentences: deleteSentences, rubricNoQuoteNote: rubricNoQuoteNote, quotesAllInAnalysis: quotesAllInAnalysis, rubricRereadNote: rubricRereadNote, eventTitles: eventTitles, eventDay: eventDay, fetchEventTitles: fetchEventTitles, EVENT_POOL: EVENT_POOL, WRITER_LEAD: WRITER_LEAD, CF_FALLBACK_GPT_OSS: CF_FALLBACK_GPT_OSS, loadWriterOrder: loadWriterOrder, fallbackChain: fallbackChain, cutAtSentence: cutAtSentence, causalScore: causalScore, CAUSAL_MIN: CAUSAL_MIN, CAUSAL_CHARS: CAUSAL_CHARS, fitAnchors: fitAnchors, logCaught: logCaught, foldAccents: foldAccents, todayLine: todayLine, reframePiece: reframePiece, parseDraftMd: parseDraftMd, P_REFRAME: P_REFRAME, REFRAME_BAND: REFRAME_BAND, REFRAME_START_BEFORE_MS: REFRAME_START_BEFORE_MS, CF_FALLBACK: CF_FALLBACK, pieceWords: pieceWords, splitText: splitText, autoMarkAnalysis: autoMarkAnalysis, withAutoMark: withAutoMark, analysisSplitInfo: analysisSplitInfo, CRITIC_INVENTED_MAX: CRITIC_INVENTED_MAX, writerBand: writerBand, writerIsFallback: writerIsFallback, WRITER_TEMPERATURE_FB: WRITER_TEMPERATURE_FB, CRITIC_TEMPERATURE: CRITIC_TEMPERATURE, ANALYSIS_MARK: ANALYSIS_MARK, stripAnalysisMark: stripAnalysisMark, analysisSplitOk: analysisSplitOk, reviewText: reviewText, stripPieceMark: stripPieceMark, persistPiece: persistPiece, STARVED_RETRY_MAX_24H: STARVED_RETRY_MAX_24H, fetchWikiIntros: fetchWikiIntros, introScore: introScore, screenTopics: screenTopics, wikiAnchors: wikiAnchors, TOPIC_POOL: TOPIC_POOL, pruneBlockFixable: pruneBlockFixable, pruneRepairFeedback: pruneRepairFeedback, expandFeedback: expandFeedback, rankLinked: rankLinked, linkMentionScore: linkMentionScore, CRITIC_PRUNE_ROUNDS: CRITIC_PRUNE_ROUNDS, criticQuotes: criticQuotes, critiqueWorst: critiqueWorst, QUOTE_MIN_WORDS: QUOTE_MIN_WORDS, systemsFit: systemsFit, generationHold: generationHold, gatherVerdicts: gatherVerdicts, orderByHealth: orderByHealth, sickReviewers: sickReviewers, FACTCHECK_HEDGE_MS: FACTCHECK_HEDGE_MS, starvedRetryDue: starvedRetryDue, arxivWindow: arxivWindow, fetchWiki: fetchWiki, splitLongLede: splitLongLede, stallAttemptStage: stallAttemptStage, companionStallDigest: companionStallDigest, arxivIdOf: arxivIdOf, paperFullTextUrls: paperFullTextUrls, paperHtmlText: paperHtmlText, ledeProblems: ledeProblems, ledeOf: ledeOf, pruneUnsupported: pruneUnsupported, deleteSentences: deleteSentences, splitFactItems: splitFactItems, sourceLabel: sourceLabel, anchorsText: anchorsText, floorFor: floorFor, critiquePiece: critiquePiece, REPAIR_FLOOR_SHARE: REPAIR_FLOOR_SHARE, FALLBACK_FLOOR_RATIO: FALLBACK_FLOOR_RATIO, NOTES_OBJECTION_PLACEHOLDER: NOTES_OBJECTION_PLACEHOLDER, groundingNeedles: groundingNeedles, stemGrounded: stemGrounded, repairGroundingDraft: repairGroundingDraft, GROUNDING_PREFIX: GROUNDING_PREFIX, problemContext: problemContext, factCheckExtra: factCheckExtra, blockedRetryDue: blockedRetryDue, steward: steward, fetchCfg: fetchCfg, fetchUA: fetchUA, groundingProblems: groundingProblems, parseFactVerdict: parseFactVerdict, factCheck: factCheck, verifyPiece: verifyPiece, auditPublished: auditPublished, retractPiece: retractPiece, pieceVerified: pieceVerified, recordAudit: recordAudit, generate: generate, unwrapJsonItem: unwrapJsonItem, itemHasNoClaim: itemHasNoClaim, reviewerSaysSupported: reviewerSaysSupported, factItemText: factItemText, splitFactItems: splitFactItems, serialInstallmentTitle: serialInstallmentTitle, serialBaseTitle: serialBaseTitle, serialChaptersDone: serialChaptersDone, serialTitleMatches: serialTitleMatches, withInstallmentTitle: withInstallmentTitle, freeInstallmentPiece: freeInstallmentPiece, pickTopic: pickTopic, sendMail: sendMail, pickReviewers: pickReviewers, familyOf: familyOf, anchorsBlock: anchorsBlock, plainCredit: plainCredit, sourcesFoot: sourcesFoot, renderPiece: renderPiece, prompts: { P_STYLE: P_STYLE, P_ESSAY: P_ESSAY, P_NOTES: P_NOTES, P_SERIAL: P_SERIAL, P_CRITIQUE: P_CRITIQUE, FACTCHECK_PROMPT: FACTCHECK_PROMPT }, VISIBLE_SQL: VISIBLE_SQL, REVIEW_POOL: REVIEW_POOL };
Object.assign(__verify, { writeBalanceMetrics: writeBalanceMetrics, balanceCheck: balanceCheck, balanceCheckOne: balanceCheckOne, parseBalanceScore: parseBalanceScore, verifyPiece: verifyPiece, recordAudit: recordAudit, factRevisionPrompt: factRevisionPrompt, BALANCE_MIN_SCORE: BALANCE_MIN_SCORE, REVIEW_POOL: REVIEW_POOL, familyOf: familyOf });
Object.assign(__verify, { isContestedTopic: isContestedTopic, sourceHost: sourceHost, sourceViewpoint: sourceViewpoint, sourceCountry: sourceCountry, contestedSourcesOk: contestedSourcesOk });
export {
  __verify,
  GenerationFlow,
  deliverOwnerPrompts,
  broadcast,
  confirmedSubscribers,
  sendDigest,
  resumeSendRuns,
  suppressedSet,
  sendOwnerNotice,
  sendMorningBrief,
  flagUndeliverableQuestions,
  queueLedgerFollowUp,
  refreshConnectionMetrics,
  isoWeekKey,
  callModel,
  companionStallDetector,
  expandFeedback,
  validatePiece,
  worker_default as default
};
//# sourceMappingURL=worker.js.map

// ---- WEBMCP-FLEET-1:BEGIN (sourced from _shared/webmcp.js; applied by scripts/webmcp-apply.mjs; do not edit inside a worker) ----
// WEBMCP-FLEET-1 (2026-10-25, pillar reach, owner directive "implement WebMCP systemwide across the fleet").
//
// WHAT. WebMCP (https://blog.cloudflare.com/webmcp/, August 2026) is a browser standard, shipping experimentally in
// Chrome 146, that appears in the page as document.modelContext: a site registers MCP tools with registerTool() so an
// agent visiting the page can call the site's own operations instead of guessing its way through a page built for
// humans. Cloudflare's developer preview offers a zone toggle that injects a bridge and two packs (c2pa, and a proxy
// to the site's own MCP server). That toggle is Dashboard-only and this fleet's token may not write zone Snippets
// (probed 2026-10-25: HTTP 403 "snippets are not allowed", and GET /user/tokens 403 so no wider token can be minted),
// so the fleet carries its own implementation, which is also the only version that can expose QNFO's real operations.
//
// HOW. Three pieces, all same-origin, all served by the worker that already answers the page:
//   1. GET /.webmcp/bridge.js   the browser-side module: finds document.modelContext, reads the manifest, registers
//                               every tool, and returns without registering anything when the browser has no WebMCP.
//   2. GET /.webmcp/packs.json  the machine-readable manifest (also readable by a non-browser agent).
//   3. an HTMLRewriter step on 200 HTML responses appending one <script type="module" src="/.webmcp/bridge.js">.
//
// WHY same-origin only. The bridge runs in the visitor's page with the visitor's session. A tool that reached another
// origin would hand this origin's tools to a page we do not own, and a proxy that took a caller-supplied absolute URL
// would be an SSRF surface on every page of every host. Every request template below is a path, resolved against the
// page's own origin, and read_page refuses anything that is not a path on this origin.
//
// WHY this is not a false capability claim (DECLARED-NOT-WORKING-1). The manifest is generated from the same table the
// bridge registers from, and every endpoint in it was answered 200 by a live probe on 2026-10-25 before shipping. The
// bridge reports what actually happened in window.__webmcp: supported=false when the browser has no modelContext, and
// registered=<n> only after registerTool() returned. Measured 2026-10-25 before this shipped: ideas /api/proposals
// answered 503 and was REMOVED from the manifest rather than advertised; ideas /api/sessions, q08 /api/metrics and
// POST ask.qwav.tech/api/ask answered 200. scripts/webmcp-verify.mjs re-probes every host and every tool endpoint.
//
// ROLLBACK. Revert the deploy of a worker to its previous version; the block is inert code for a browser without
// modelContext and cannot change a page's rendered output for any other client.
var WM_VERSION = "1.2.0";
var WM_BRIDGE_PATH = "/.webmcp/bridge.js";
var WM_PACKS_PATH = "/.webmcp/packs.json";
var WM_MANIFEST_PATH = "/.webmcp/manifest.json";
// WM_MANIFEST_URL is the path the bridge reads, and it is deliberately OUTSIDE /.webmcp/: Cloudflare's own WebMCP
// preview owns that prefix at the edge when a zone has it switched on (measured 2026-10-25: /.webmcp/bridge.js answer
// 75,756 bytes of the platform bundle and /.webmcp/packs.json answer 404 without ever reaching the worker), so a
// manifest under that prefix is invisible on exactly the zone with the most traffic. /api/webmcp/ is ours end to end.
var WM_MANIFEST_URL = "/api/webmcp/manifest.json";
var WM_MCP_PATH = "/mcp";
var WM_MCP_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"];
var WM_MAX_TEXT = 40000;

// WM_PACK_DEFS: the whole tool surface. `request` is a same-origin template. `{name}` in a path or a query value is
// replaced from the call arguments; an argument that is absent drops its query key rather than sending "undefined".
var WM_PACK_DEFS = {
  site: {
    title: "This site",
    description: "Read the site the visitor is looking at: the page in front of them, any page on this origin, and the sitemap.",
    tools: [
      {
        name: "get_page_context",
        description: "Return the page the visitor is on: its URL, title, description, its section headings and any text the visitor has selected. Call this first to learn where you are.",
        inputSchema: { type: "object", properties: {} },
        local: "page_context"
      },
      {
        name: "read_page",
        description: "Fetch a path on this site and return its text (HTML reduced to readable text, or the raw body for JSON/Markdown/plain). Paths are relative to this origin.",
        inputSchema: { type: "object", properties: { path: { type: "string", description: "A path on this site, e.g. /about" }, max_chars: { type: "number", description: "Truncate the text to this many characters (default 20000)" } }, required: ["path"] },
        request: { method: "GET", path: "{path}" }
      },
      {
        name: "list_site_pages",
        description: "List the URLs published in this site's sitemap.xml.",
        inputSchema: { type: "object", properties: { limit: { type: "number", description: "Maximum URLs to return (default 100)" } } },
        request: { method: "GET", path: "/sitemap.xml", extract: "loc" }
      }
    ]
  },
  papers: {
    title: "QNFO living papers",
    description: "Search, read and question the QNFO research corpus: full texts as Markdown, a JSON metadata API, and a deterministic digest of any paper.",
    tools: [
      {
        name: "search_papers",
        description: "Full-text search over the QNFO papers corpus. Returns matching papers with slug, title, authors and abstract.",
        inputSchema: { type: "object", properties: { q: { type: "string", description: "Search words" }, limit: { type: "number", description: "1-50, default 10" } }, required: ["q"] },
        request: { method: "GET", path: "/api/papers", query: { q: "{q}", limit: "{limit}" } }
      },
      {
        name: "get_paper",
        description: "Metadata for one paper by slug: title, authors, abstract, DOI, version, dates, licence and the URLs of its Markdown and PDF.",
        inputSchema: { type: "object", properties: { slug: { type: "string", description: "Paper slug, e.g. ultrametric-intelligence" } }, required: ["slug"] },
        request: { method: "GET", path: "/api/papers/{slug}" }
      },
      {
        name: "get_paper_markdown",
        description: "The full text of one paper as Markdown. Use this to read or quote a paper.",
        inputSchema: { type: "object", properties: { slug: { type: "string" }, max_chars: { type: "number" } }, required: ["slug"] },
        request: { method: "GET", path: "/papers/{slug}.md", accept: "text/markdown" }
      },
      {
        name: "get_paper_digest",
        description: "A deterministic digest of one paper written from its own sentences: the abstract, the claim, the figures it reports, how it is done, what would falsify it, where the claim stops, and a map of where to read.",
        inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
        request: { method: "GET", path: "/api/quickread/{slug}" }
      }
    ]
  },
  fleet: {
    title: "QNFO fleet",
    description: "The live state of the QNFO Cloudflare fleet: health, spend, what needs attention and what changed.",
    tools: [
      {
        name: "fleet_status",
        description: "Fleet verdict and what the fleet is waiting on a human to do.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/human" }
      },
      {
        name: "fleet_attention",
        description: "Everything the fleet currently flags as needing attention.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/attention" }
      },
      {
        name: "fleet_cost",
        description: "Cost per surface over the current windows.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/cost" }
      },
      {
        name: "fleet_areas",
        description: "The functional areas of the fleet with their state.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/areas" }
      }
    ]
  },
  ideas: {
    title: "QNFO ideas",
    description: "The QNFO idea hub: the open idea threads.",
    tools: [
      {
        name: "list_ideas",
        description: "List the open idea threads in the hub.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/sessions" }
      }
    ]
  },
  signals: {
    title: "q08 signal organism",
    description: "Signals, forecasts and run metrics of the q08 signal organism.",
    tools: [
      {
        name: "list_signals",
        description: "The latest signals emitted by the organism.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/signals" }
      },
      {
        name: "list_forecasts",
        description: "Open and resolved forecasts with their outcomes.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/forecasts" }
      },
      {
        name: "signal_metrics",
        description: "Organism run metrics.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/metrics" }
      }
    ]
  },
  ask: {
    title: "Ask QWAV",
    description: "Ask a question over the QNFO corpus and read recent questions.",
    tools: [
      {
        name: "ask_corpus",
        description: "Ask a research question and get an answer grounded in the QNFO corpus with its sources.",
        inputSchema: { type: "object", properties: { q: { type: "string", description: "The question" } }, required: ["q"] },
        request: { method: "POST", path: "/api/ask", body: { q: "{q}" } }
      },
      {
        name: "recent_questions",
        description: "Recently asked questions and their answers.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/recent" }
      },
      {
        name: "corpus_stats",
        description: "Index statistics for the corpus behind this search.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/stats" }
      }
    ]
  },
  ipatent: {
    title: "iPatent",
    description: "Search the disclosure corpus, read its status, and get invention suggestions.",
    tools: [
      {
        name: "search_disclosures",
        description: "Search the iPatent disclosure corpus.",
        inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
        request: { method: "GET", path: "/api/search", query: { q: "{q}" } }
      },
      {
        name: "ipatent_status",
        description: "Corpus and pipeline status.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/status" }
      }
    ]
  },
  mind: {
    title: "mind.q08.org",
    description: "The inside reading surface: its corpus entries and shelves.",
    tools: [
      {
        name: "list_entries",
        description: "Every entry in the mind corpus with its shelf.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/entries.json" }
      }
    ]
  }
};

// WM_HOST_PACKS: which packs a host advertises. A host absent here gets the site pack only, so a new surface is
// agent-readable the moment it is deployed and never advertises a tool it cannot answer.
var WM_HOST_PACKS = {
  "qnfo.org": ["site", "papers"],
  "www.qnfo.org": ["site", "papers"],
  "papers.qnfo.org": ["site", "papers"],
  "archive.qnfo.org": ["site"],
  "legal.qnfo.org": ["site"],
  "qnfo.org:email": ["site"],
  "fleet.qnfo.org": ["site", "fleet"],
  "ideas.qnfo.org": ["site", "ideas"],
  "q08.org": ["site", "signals"],
  "www.q08.org": ["site", "signals"],
  "ask.qwav.tech": ["site", "ask"],
  "ask.qwav.org": ["site", "ask"],
  "ipatent.qnfo.org": ["site", "ipatent"],
  "ipatent.me": ["site", "ipatent"],
  "www.ipatent.me": ["site", "ipatent"],
  "mind.q08.org": ["site", "mind"]
};

// wmHost accepts a URL or a bare hostname (the manifest and the tests both call it with either) and never throws: an
// unknown shape yields "", which lands on the site pack rather than on a tool nobody verified.
function wmHost(url) {
  try {
    var s = typeof url === "string" ? url : String(url && url.hostname || url || "");
    if (s.indexOf("://") >= 0) {
      try { s = new URL(s).hostname; } catch (e2) { return ""; }
    }
    s = s.split("/")[0].split("?")[0].split("#")[0];
    return s.toLowerCase().replace(/:\d+$/, "");
  } catch (e) {
    return "";
  }
}
function wmPackIds(host) {
  var h = wmHost(host);
  return (WM_HOST_PACKS[h] || ["site"]).filter(function (id) { return !!WM_PACK_DEFS[id]; });
}
function wmPacks(host) {
  var out = [];
  var ids = wmPackIds(host);
  for (var i = 0; i < ids.length; i++) {
    var d = WM_PACK_DEFS[ids[i]];
    var tools = [];
    for (var j = 0; j < d.tools.length; j++) {
      var t = d.tools[j];
      tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema, local: t.local || null, request: t.request || null });
    }
    out.push({ id: ids[i], title: d.title, description: d.description, tools: tools });
  }
  return out;
}
function wmManifest(host, worker) {
  var packs = wmPacks(host);
  var n = 0;
  for (var i = 0; i < packs.length; i++) n += packs[i].tools.length;
  return {
    schema_version: "webmcp/v1",
    implementation: "qnfo-webmcp",
    version: WM_VERSION,
    worker: worker || "",
    host: wmHost(host),
    generated_from: "_shared/webmcp.js",
    bridge: WM_BRIDGE_PATH,
    standard: "https://blog.cloudflare.com/webmcp/",
    surface: { document_modelContext: true, navigator_modelContext_fallback: true, degrades_silently: true },
    pack_ids: wmPackIds(host),
    tool_count: n,
    packs: packs
  };
}

// The browser-side module. Written as lines, not a template literal, so nothing in it can be re-interpreted by the
// worker's own bundler and so a diff of this array is a diff of the shipped script.
function wmBridgeSource() {
  var L = [
    "/* QNFO WebMCP bridge " + WM_VERSION + " - generated from _shared/webmcp.js; do not edit. */",
    "(() => {",
    "  if (window.__webmcp && window.__webmcp.bridge) return;",
    "  const state = window.__webmcp = { bridge: true, version: '" + WM_VERSION + "', supported: false, mode: 'init', packs: [], tools: [], registered: 0, errors: [] };",
    "  const ctx = () => {",
    "    try {",
    "      if (document.modelContext && typeof document.modelContext.registerTool === 'function') return document.modelContext;",
    "      if (navigator.modelContext && typeof navigator.modelContext.registerTool === 'function') return navigator.modelContext;",
    "    } catch (e) { state.errors.push('context:' + e); }",
    "    return null;",
    "  };",
    "  const trunc = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '\\n[... ' + (s.length - n) + ' more characters]' : s; };",
    "  const html2text = (s) => String(s || '')",
    "    .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ').replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')",
    "    .replace(/<\\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, '\\n').replace(/<[^>]+>/g, ' ')",
    "    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '\"').replace(/&#39;/g, \"'\")",
    "    .replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();",
    "  const fill = (tpl, args) => String(tpl || '').replace(/\\{([a-z0-9_]+)\\}/gi, (m, k) => {",
    "    const v = args && args[k];",
    "    return v == null ? '' : String(v);",
    "  });",
    "  const text = (body, isErr) => ({ content: [{ type: 'text', text: body }], isError: !!isErr });",
    "  const pageContext = () => {",
    "    const heads = [];",
    "    document.querySelectorAll('h1,h2,h3').forEach((h) => { if (heads.length < 40) heads.push(h.tagName.toLowerCase() + ': ' + (h.textContent || '').trim().slice(0, 160)); });",
    "    const desc = document.querySelector('meta[name=\"description\"]');",
    "    const sel = String(window.getSelection ? window.getSelection() : '').slice(0, 4000);",
    "    const out = { url: location.href, path: location.pathname, title: document.title, description: desc ? desc.getAttribute('content') : '', lang: document.documentElement.getAttribute('lang') || '', headings: heads, selected_text: sel,",
    "      tools_available: state.tools, packs: state.packs, webmcp_supported: state.supported };",
    "    return text(JSON.stringify(out, null, 1));",
    "  };",
    "  async function call(tool, args) {",
    "    const r = tool.request || {};",
    "    let path = fill(r.path, args);",
    "    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return text('refused: the path must be relative to this site, not an absolute URL', true);",
    "    path = '/' + String(path).replace(/^\\/+/, '');",
    "    const qs = new URLSearchParams();",
    "    if (r.query) for (const k of Object.keys(r.query)) { const v = args && args[k] != null ? args[k] : null; if (v !== null) qs.set(k, String(v)); }",
    "    const url = path + (qs.toString() ? '?' + qs.toString() : '');",
    "    const init = { method: r.method || 'GET', credentials: 'same-origin', headers: { 'accept': r.accept || 'application/json, text/html;q=0.9, text/plain;q=0.8' } };",
    "    if (init.method === 'POST') { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(args || {}); }",
    "    const res = await fetch(url, init);",
    "    const raw = await res.text();",
    "    if (!res.ok) return text('HTTP ' + res.status + ' for ' + url + '\\n' + trunc(raw, 2000), true);",
    "    const ct = (res.headers.get('content-type') || '').toLowerCase();",
    "    const cap = Number(args && args.max_chars) > 0 ? Number(args.max_chars) : 20000;",
    "    if (r.extract === 'loc') {",
    "      const locs = Array.from(raw.matchAll(/<loc>([^<]+)<\\/loc>/gi)).map((m) => m[1]);",
    "      const limit = Number(args && args.limit) > 0 ? Number(args.limit) : 100;",
    "      return text(JSON.stringify({ count: locs.length, urls: locs.slice(0, limit) }, null, 1));",
    "    }",
    "    if (ct.indexOf('json') >= 0) return text(trunc(raw, 40000));",
    "    if (ct.indexOf('html') >= 0) return text(trunc(html2text(raw), cap));",
    "    return text(trunc(raw, cap));",
    "  }",
    "  function toolHandler(tool) {",
    "    return async (args) => {",
    "      try {",
    "        if (tool.local === 'page_context') return pageContext();",
    "        return await call(tool, args || {});",
    "      } catch (e) { state.errors.push(tool.name + ':' + e); return text(tool.name + ' failed: ' + (e && e.message || e), true); }",
    "    };",
    "  }",
    "  async function install(target) {",
    "    const man = state.manifest;",
    "    let n = 0;",
    "    for (const pack of (man.packs || [])) {",
    "      for (const tool of (pack.tools || [])) {",
    "        try {",
    "          await target.registerTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, execute: toolHandler(tool) });",
    "          n++;",
    "        } catch (e) { state.errors.push('register:' + tool.name + ':' + e); }",
    "      }",
    "    }",
    "    state.registered = n;",
    "    state.mode = n ? 'registered' : 'failed';",
    "    return n;",
    "  }",
    "  state.install = install;",
    "  (async () => {",
    "    try {",
    "      const platform = document.querySelector('script[src*=\"/.webmcp/bridge.js\"]:not([data-webmcp])');",
    "      state.platform_bridge = !!platform;",
    "      const res = await fetch('/api/webmcp/manifest.json', { credentials: 'same-origin', headers: { accept: 'application/json' } });",
    "      if (!res.ok) { state.mode = 'no-manifest'; state.errors.push('manifest http ' + res.status); return; }",
    "      state.manifest = await res.json();",
    "      state.packs = (state.manifest.packs || []).map((p) => p.id);",
    "      state.tools = (state.manifest.packs || []).flatMap((p) => (p.tools || []).map((t) => t.name));",
    "      const c = ctx();",
    "      state.supported = !!c;",
    "      if (!c) { state.mode = 'standalone'; return; }",
    "      // Cloudflare's own bridge is on this page (its zone toggle is on): it registers the same tools through /mcp.",
    "      // Registering them a second time would collide on tool names, so ours stands down and says so.",
    "      if (state.platform_bridge) { state.mode = 'platform'; return; }",
    "      await install(c);",
    "    } catch (e) { state.mode = 'error'; state.errors.push(String(e)); }",
    "  })();",
    "})();"
  ];
  return L.join(String.fromCharCode(10)) + String.fromCharCode(10);
}

// wmToolUrl builds the same-origin request a tool describes. Both executors use it: the browser bridge (which calls
// over HTTP with the visitor's session) and the MCP endpoint below (which calls the worker's own router). One builder
// means a tool cannot mean one thing in a browser and another in the MCP surface.
function wmToolUrl(tool, args) {
  var r = tool.request || {};
  var fill = function (tpl) {
    return String(tpl == null ? "" : tpl).replace(/\{([a-z0-9_]+)\}/gi, function (m, k) {
      var v = args && args[k];
      return v == null ? "" : String(v);
    });
  };
  var path = fill(r.path);
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  path = "/" + path.replace(/^\/+/, "");
  var qs = [];
  if (r.query) {
    for (var k in r.query) {
      if (!Object.prototype.hasOwnProperty.call(r.query, k)) continue;
      var v = args && args[k] != null ? args[k] : null;
      if (v !== null) qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(fill(r.query[k])));
    }
  }
  return path + (qs.length ? "?" + qs.join("&") : "");
}
function wmStripHtml(s) {
  return String(s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function wmTrunc(s, n) {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n) + "\n[... " + (s.length - n) + " more characters]" : s;
}
function wmToolResult(text, isError) {
  return { content: [{ type: "text", text: text }], isError: isError ? true : undefined };
}

// wmExecTool runs one tool through the worker's own router. No subrequest: the captured original fetch is called as a
// function, so the tool sees exactly the response a visitor would get, at the cost of no extra invocation.
async function wmExecTool(tool, args, request, origFetch, env, ctx) {
  if (!tool || !tool.request) {
    return wmToolResult("page_context is answered in the browser by the bridge; a server-side caller has no page.", true);
  }
  var target = wmToolUrl(tool, args);
  if (!target) return wmToolResult("refused: a tool path must be relative to this site, not an absolute URL", true);
  var origin = new URL(request.url).origin;
  var init = { method: String(tool.request.method || "GET").toUpperCase(), headers: {} };
  if (init.method === "POST") {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(args || {});
  } else {
    init.headers["accept"] = tool.request.accept || "application/json";
  }
  var res = await origFetch(new Request(origin + target, init), env, ctx);
  var raw = await res.text();
  if (!res.ok) return wmToolResult("HTTP " + res.status + " for " + target + "\n" + wmTrunc(raw, 2000), true);
  var ct = (res.headers.get("Content-Type") || "").toLowerCase();
  if (ct.indexOf("html") >= 0) return wmToolResult(wmTrunc(wmStripHtml(raw), 20000));
  return wmToolResult(wmTrunc(raw, WM_MAX_TEXT));
}
function wmFindTool(host, name) {
  var packs = wmPacks(host);
  for (var i = 0; i < packs.length; i++) {
    for (var j = 0; j < packs[i].tools.length; j++) if (packs[i].tools[j].name === name) return packs[i].tools[j];
  }
  return null;
}
function wmMcpCard(host, workerName) {
  var man = wmManifest(host, workerName);
  return {
    schema_version: "mcp/server-card/v1",
    serverInfo: { name: "qnfo-webmcp", version: WM_VERSION, title: "QNFO " + (man.host || "site") },
    description: "The same-origin MCP server behind this site's WebMCP tools. Discovered by Cloudflare's WebMCP bridge (pack mcp-server-client) and by any MCP client that speaks JSON-RPC over HTTP.",
    transport: { type: "http", path: WM_MCP_PATH, methods: ["POST", "GET", "DELETE"], protocolVersions: WM_MCP_PROTOCOLS },
    capabilities: { tools: { listChanged: false } },
    tool_count: man.tool_count,
    packs: man.pack_ids,
    standard: "https://blog.cloudflare.com/webmcp/"
  };
}
async function wmRpc(msg, request, env, ctx, origFetch, workerName) {
  var u = new URL(request.url);
  var host = u.hostname;
  var id = msg && Object.prototype.hasOwnProperty.call(msg, "id") ? msg.id : null;
  var method = msg && msg.method ? String(msg.method) : "";
  var params = (msg && msg.params) || {};
  var isNotification = !msg || !Object.prototype.hasOwnProperty.call(msg, "id") || msg.id === null;
  var reply = function (result) { return { jsonrpc: "2.0", id: id, result: result }; };
  var fail = function (code, message) { return { jsonrpc: "2.0", id: id, error: { code: code, message: message } }; };
  if (!msg || msg.jsonrpc !== "2.0" || !method) return isNotification ? null : fail(-32600, "invalid request");
  if (method === "initialize") {
    var asked = String(params.protocolVersion || "");
    var ver = WM_MCP_PROTOCOLS.indexOf(asked) >= 0 ? asked : WM_MCP_PROTOCOLS[1];
    return reply({
      protocolVersion: ver,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "qnfo-webmcp", version: WM_VERSION, title: "QNFO " + host },
      instructions: "Tools published by " + host + ". Every tool reads the same public data the page shows; nothing here takes a credential, and nothing reaches another origin."
    });
  }
  if (method.indexOf("notifications/") === 0) return null;
  if (method === "ping") return reply({});
  if (method === "tools/list") {
    var man = wmManifest(host, workerName);
    var tools = [];
    for (var i = 0; i < man.packs.length; i++) {
      for (var j = 0; j < man.packs[i].tools.length; j++) {
        var t = man.packs[i].tools[j];
        tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
      }
    }
    return reply({ tools: tools });
  }
  if (method === "tools/call") {
    var name = String(params.name || "");
    var tool = wmFindTool(host, name);
    if (!tool) return fail(-32602, "unknown tool: " + name);
    try {
      var result = await wmExecTool(tool, params.arguments || {}, request, origFetch, env, ctx);
      return reply(result);
    } catch (e) {
      return reply(wmToolResult(name + " failed: " + String((e && e.message) || e), true));
    }
  }
  return isNotification ? null : fail(-32601, "method not found: " + method);
}

// wmMcp answers the site's MCP endpoint. Cloudflare's WebMCP bridge (pack mcp-server-client, data-mcp-url defaulting to
// /mcp) runs initialize -> notifications/initialized -> tools/list -> tools/call against it with the visitor's session,
// so the fleet's tools reach document.modelContext through the platform's own implementation wherever the zone toggle
// is on, and through /.webmcp/bridge.js where it is not.
async function wmMcp(request, env, ctx, origFetch, workerName) {
  try {
    if (!request) return null;
    var u = new URL(request.url);
    if ((u.pathname.replace(/\/+$/, "") || "/") !== WM_MCP_PATH) return null;
    var m = String(request.method || "GET").toUpperCase();
    var h = { "X-WebMCP": WM_VERSION };
    if (m === "GET" || m === "HEAD") {
      var card = JSON.stringify(wmMcpCard(u.hostname, workerName));
      return new Response(m === "HEAD" ? null : card, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-WebMCP": WM_VERSION } });
    }
    if (m === "DELETE" || m === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (m !== "POST") return wmJson({ error: "method not allowed" }, 405, "no-store");
    var body = null;
    try {
      body = await request.json();
    } catch (e) {
      return wmJson({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400, "no-store");
    }
    var batch = Array.isArray(body);
    var msgs = batch ? body : [body];
    var out = [];
    for (var i = 0; i < msgs.length; i++) {
      var r = await wmRpc(msgs[i], request, env, ctx, origFetch, workerName);
      if (r) out.push(r);
    }
    if (!out.length) return new Response(null, { status: 202, headers: h });
    return wmJson(batch ? out : out[0], 200, "no-store");
  } catch (e) {
    return null;
  }
}

function wmJson(body, status, cache) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache || "public, max-age=300", "X-WebMCP": WM_VERSION }
  });
}

// wmRoute answers the bridge and the manifest and nothing else. Returns null for every other request, so a caller can
// run it before its own router without changing any existing behaviour.
function wmRoute(request, workerName) {
  try {
    if (!request) return null;
    var u = new URL(request.url);
    var p = u.pathname;
    var isManifest = p === WM_PACKS_PATH || p === WM_MANIFEST_PATH || p === WM_MANIFEST_URL;
    if (p !== WM_BRIDGE_PATH && !isManifest) return null;
    var m = String(request.method || "GET").toUpperCase();
    if (m !== "GET" && m !== "HEAD") return wmJson({ error: "method not allowed" }, 405, "no-store");
    var host = u.hostname;
    if (p === WM_BRIDGE_PATH) {
      var js = wmBridgeSource();
      var h = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-WebMCP": WM_VERSION, "X-Content-Type-Options": "nosniff" };
      return new Response(m === "HEAD" ? null : js, { status: 200, headers: h });
    }
    var man = wmManifest(host, workerName || "");
    man.paths = { bridge: WM_BRIDGE_PATH, packs: WM_MANIFEST_URL, manifest: WM_MANIFEST_URL, mcp: WM_MCP_PATH };
    var hh = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-WebMCP": WM_VERSION };
    return new Response(m === "HEAD" ? null : JSON.stringify(man), { status: 200, headers: hh });
  } catch (e) {
    return null;
  }
}

// The HTMLRewriter handler. It appends the module tag at the end of <head>; a page without a head, a non-200, a
// non-HTML body or a browser we cannot detect all pass through untouched.
// wmPlatformOn: hosts whose zone has Cloudflare own WebMCP preview switched on. Measured 2026-10-25: qnfo.org,
// papers, ideas, fleet and ipatent each carried the platform tag (data-packs="c2pa,mcp-server-client") and
// /.webmcp/bridge.js resolved to the 75,756-byte platform bundle before this worker was reached. The platform
// bundle keeps only the pack names it bundles and does NOT fall back to its defaults, so a second tag carrying
// "site,papers" downloads the same bundle again, registers nothing and logs two warnings. On those hosts this
// worker supplies /mcp and lets the platform bridge register it.
function wmPlatformOn(host) {
  var h = wmHost(host);
  return h === "qnfo.org" || h.slice(-9) === ".qnfo.org";
}
function wmInjector(host, workerName) {
  var ids = wmPackIds(host);
  var packs = ids.join(",");
  var tag = '<script type="module" src="' + WM_BRIDGE_PATH + '" data-webmcp="' + WM_VERSION + '" data-packs="' + packs + '" data-mcp-url="' + WM_MCP_PATH + '" data-worker="' + String(workerName || "").replace(/"/g, "") + '"></script>';
  return {
    element: function (el) {
      try { el.append(tag, { html: true }); } catch (e) { logCaught("wmInjector.append", e); }
    }
  };
}
function wmWithHtml(res, request, workerName) {
  try {
    if (!res || !request) return res;
    var m = String(request.method || "GET").toUpperCase();
    if (m !== "GET") return res;
    if (res.status !== 200) return res;
    var ct = (res.headers.get("Content-Type") || "").toLowerCase();
    if (ct.indexOf("text/html") !== 0) return res;
    if (typeof HTMLRewriter === "undefined") return res;
    var u = new URL(request.url);
    if (wmPlatformOn(u.hostname)) return res;
    if (u.pathname.indexOf("/.webmcp/") === 0 || u.pathname === WM_MCP_PATH) return res;
    var out = new HTMLRewriter().on("head", wmInjector(u.hostname, workerName)).transform(res);
    // A rewritten body no longer matches the origin's Content-Length/ETag; left in place they truncate or mis-cache
    // the page. The X-WebMCP marker is what scripts/webmcp-verify.mjs reads without parsing 200 KB of HTML.
    try {
      out.headers.delete("Content-Length");
      out.headers.delete("ETag");
      out.headers.set("X-WebMCP", WM_VERSION);
    } catch (e2) { logCaught("wmWithHtml.headers", e2); }
    return out;
  } catch (e) {
    return res;
  }
}

// wmAttach wraps a worker's default export so every response passes through the steps above. It is a property
// assignment on the exported object, so the runtime sees it on every invocation, and it is idempotent.
function wmAttach(target, workerName) {
  try {
    if (!target || typeof target.fetch !== "function" || target.__wm === WM_VERSION) return target;
    var orig = target.fetch;
    var name = workerName || "";
    target.fetch = async function (request, env, ctx) {
      var routed = wmRoute(request, name);
      if (routed) return routed;
      var mcp = await wmMcp(request, env, ctx, orig, name);
      if (mcp) return mcp;
      var res = await orig.call(this, request, env, ctx);
      return wmWithHtml(res, request, name);
    };
    target.__wm = WM_VERSION;
    return target;
  } catch (e) {
    return target;
  }
}
// ---- WEBMCP-FLEET-1:END ----
// ---- WEBMCP-FLEET-1:ATTACH personal-companion ----
wmAttach(worker_default, "personal-companion");
// ---- BP26-EDGE-SECURITY-1:BEGIN (2026-10-26, agent_issues 1000356, pillar security) ----
// The zone adds HSTS and nosniff to q08.org hosts; the pages themselves sent no Referrer-Policy and no frame protection (reading.q08.org) or no frame protection (travel.q08.org),
// so any site could frame them. This wraps the final fetch handler (outside the WebMCP wrapper) and adds the three headers a route has not set itself. The response is copied
// only when a header is missing, because a redirect or an upstream response has immutable headers; a WebSocket upgrade is returned as it is.
function edgeSecure(res) {
  try {
    if (!res || res.status === 101 || res.webSocket) return res;
    var h = res.headers;
    if (h.get("Referrer-Policy") && h.get("X-Frame-Options") && h.get("X-Content-Type-Options")) return res;
    var out = new Response(res.body, res);
    if (!out.headers.get("Referrer-Policy")) out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (!out.headers.get("X-Frame-Options")) out.headers.set("X-Frame-Options", "DENY");
    if (!out.headers.get("X-Content-Type-Options")) out.headers.set("X-Content-Type-Options", "nosniff");
    return out;
  } catch (e) {
    return res;
  }
}
(function edgeAttach(target) {
  var inner = target.fetch;
  target.fetch = async function (request, env, ctx) {
    return edgeSecure(await inner.call(this, request, env, ctx));
  };
})(worker_default);
// ---- BP26-EDGE-SECURITY-1:END ----
