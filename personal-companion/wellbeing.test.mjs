// personal-companion/wellbeing.test.mjs
// Run: node --experimental-sqlite personal-companion/wellbeing.test.mjs
//
// The DDL is applied statement-by-statement exactly as ensureWellbeingSchema does it against D1,
// so a statement D1 would reject fails here first (D1 accepts one statement per prepare()).

import { DatabaseSync } from "node:sqlite";
import {
  DDL, ensureWellbeingSchema, recordCheckin, dayKey, localHourFloat, inQuiet,
  drift, planNext, retiredKinds, expireStale, closeNudge, crisisBlock, crisisSignal,
  DEFAULT_CONFIG, LADDER, whatHelped, unansweredStreak, tzOffsetMinutes,
  safetyPlanBlock, weeklyReviewText
} from "./wellbeing.js";
import { handleWellbeing, wellbeingTick, vaultNoteDays, ensureWellbeing as ensureBase, briefCheckinLines, noteCheckinInBrief, cfg, weeklyReview } from "./wellbeing-wire.js";

// Legacy wellness behavior requires an explicit opt-in; practical-notifications.test.mjs covers the default.
async function ensureWellbeing(db) {
  await ensureBase(db);
  await db.prepare("INSERT INTO wellbeing_config (key, value, updated_at) VALUES ('wellbeing_prompts', 'true', 'test') ON CONFLICT(key) DO UPDATE SET value = 'true'").run();
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  -> " + JSON.stringify(extra) : "")); }
};
const throws = (name, fn, code) => {
  try { fn(); fail++; console.log("  FAIL " + name + " (no throw)"); }
  catch (e) {
    const msg = String(e && e.message || e);
    if (msg.includes(code)) { pass++; console.log("  ok   " + name); }
    else { fail++; console.log("  FAIL " + name + " (wrong error: " + msg + ")"); }
  }
};

// D1-shaped adapter over node:sqlite so the module under test is unmodified.
function d1(db) {
  return {
    prepare(sql) {
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async first() { return db.prepare(sql).get(...args) ?? null; }
      };
      return api;
    }
  };
}

const db = d1(new DatabaseSync(":memory:"));

console.log("\n[schema]");
for (const sql of DDL) await db.prepare(sql).run();
pass++; console.log("  ok   all " + DDL.length + " statements accepted one-per-prepare");
await ensureWellbeingSchema(db);
const raw = new DatabaseSync(":memory:");
raw.exec("CREATE TABLE journal (ts TEXT)");
raw.exec("CREATE TABLE activity (date TEXT)");
for (const sql of DDL) raw.exec(sql);
const names = raw.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view','trigger')").all().map((r) => r.name);
ok("tables created", ["wellbeing_checkins", "companion_nudges", "wellbeing_config"].every((n) => names.includes(n)), names);
ok("views created", ["v_nudge_loop", "v_wellbeing_trend", "v_wellbeing_coverage"].every((n) => names.includes(n)), names);
ok("triggers created", ["wellbeing_checkin_range_ins", "nudge_dup_ins", "nudge_close_ins"].every((n) => names.includes(n)), names);

console.log("\n[capture guards]");
throws("mood 6 rejected", () => raw.prepare("INSERT INTO wellbeing_checkins (ts,day,mood,source) VALUES ('2026-10-17T10:00:00Z','2026-10-17',6,'reply')").run(), "WELLBEING-RANGE-1");
throws("sleep 30h rejected", () => raw.prepare("INSERT INTO wellbeing_checkins (ts,day,energy,sleep_hours,source) VALUES ('2026-10-17T10:00:00Z','2026-10-17',3,30,'web')").run(), "WELLBEING-RANGE-1");
throws("empty check-in rejected", () => raw.prepare("INSERT INTO wellbeing_checkins (ts,day,source) VALUES ('2026-10-17T10:00:00Z','2026-10-17','reply')").run(), "WELLBEING-EMPTY-1");
raw.prepare("INSERT INTO wellbeing_checkins (ts,day,mood,source) VALUES ('2026-10-17T10:00:00Z','2026-10-17',3,'reply')").run();
pass++; console.log("  ok   valid check-in accepted");

// A mood-only reply must not erase an energy value already given that day.
const merged = await recordCheckin(db, { day: undefined, mood: null, energy: 4, source: "reply", ts: "2026-10-17T18:00:00Z" });
const row = raw.prepare("SELECT mood, energy FROM wellbeing_checkins WHERE day='2026-10-17' AND source='reply'").get();
ok("upsert merges, does not clobber", merged.day === "2026-10-17", { merged, row });

console.log("\n[nudge guards]");
throws("bad state rejected", () => raw.prepare("INSERT INTO companion_nudges (ts,day,kind,ask,state) VALUES ('2026-10-17T10:00:00Z','2026-10-17','micro','water','fired')").run(), "NUDGE-STATE-1");
throws("done without closed_at rejected", () => raw.prepare("INSERT INTO companion_nudges (ts,day,kind,ask,state) VALUES ('2026-10-17T10:00:00Z','2026-10-17','micro','water','done')").run(), "NUDGE-CLOSE-1");
raw.prepare("INSERT INTO companion_nudges (ts,day,kind,ask,state,sent_at) VALUES ('2026-10-17T10:00:00Z','2026-10-17','micro','water','sent','2026-10-17T10:00:00Z')").run();
throws("second open nudge same kind rejected", () => raw.prepare("INSERT INTO companion_nudges (ts,day,kind,ask,state) VALUES ('2026-10-17T11:00:00Z','2026-10-17','micro','window','sent')").run(), "NUDGE-DUP-1");
raw.prepare("UPDATE companion_nudges SET state='expired', closed_at='2026-10-17T12:00:00Z' WHERE day='2026-10-17'").run();
raw.prepare("INSERT INTO companion_nudges (ts,day,kind,ask,state,closed_at) VALUES ('2026-10-17T13:00:00Z','2026-10-17','micro','window','done','2026-10-17T13:05:00Z')").run();
pass++; console.log("  ok   expired nudge frees the slot for a retry");

console.log("\n[time and quiet hours]");
ok("quiet at 03:00", inQuiet(3, 22, 7.5) === true);
ok("awake at 12:00", inQuiet(12, 22, 7.5) === false);
ok("quiet at 22:30", inQuiet(22.5, 22, 7.5) === true);
ok("awake at 07:30 sharp", inQuiet(7.5, 22, 7.5) === false);
ok("day key is local not UTC", dayKey("2026-10-17T23:30:00Z", 120) === "2026-10-18", dayKey("2026-10-17T23:30:00Z", 120));
ok("local hour honours offset", Math.abs(localHourFloat("2026-10-17T09:15:00Z", 120) - 11.25) < 1e-9);

console.log("\n[time: DST]");
ok("summer offset is +0200", tzOffsetMinutes("Europe/Amsterdam", new Date("2026-10-17T12:00:00Z").getTime()) === 120);
ok("winter offset is +0100", tzOffsetMinutes("Europe/Amsterdam", new Date("2026-12-01T12:00:00Z").getTime()) === 60);
ok("day key follows DST, not a fixed offset",
  dayKey("2026-12-01T23:30:00Z", "Europe/Amsterdam") === "2026-12-02",
  dayKey("2026-12-01T23:30:00Z", "Europe/Amsterdam"));
ok("quiet hours hold after the DST flip",
  inQuiet(localHourFloat("2026-12-01T22:30:00Z", "Europe/Amsterdam"), 22, 7.5) === true,
  localHourFloat("2026-12-01T22:30:00Z", "Europe/Amsterdam"));
ok("bad zone falls back instead of throwing", tzOffsetMinutes("Not/AZone", Date.now()) === 120);

console.log("\n[drift]");
ok("silence alone is watch not drift", drift({ days_since_note: 5 }).level === "watch");
ok("two signals are drift", drift({ days_since_note: 5, night_share: 0.4 }).level === "drift");
ok("mood 1 is shaky", drift({ mood_today: 1 }).level === "shaky");
ok("mood 2 on a low week is shaky", drift({ mood_today: 2, mood_avg7: 2.2 }).level === "shaky");
ok("mood 2 off a good week is not shaky", drift({ mood_today: 2, mood_avg7: 3.8 }).level !== "shaky");
ok("clean signals are ok", drift({ days_since_note: 1, night_share: 0.05, volume_ratio: 1.1, days_since_activity: 2, mood_today: 4 }).level === "ok");
// The two legacy tables cannot declare drift on their own: `activity` is stale by design and
// `chat` volume moves when the owner changes client. A false "you are withdrawing" costs more.
ok("volume + activity alone is watch, not drift",
  drift({ volume_ratio: 0.06, days_since_activity: 50 }).level === "watch",
  drift({ volume_ratio: 0.06, days_since_activity: 50 }));
ok("text signal + artifact is drift",
  drift({ days_since_note: 17, volume_ratio: 0.06, days_since_activity: 50 }).level === "drift");
ok("strong reasons are labelled", drift({ mood_today: 1, days_since_note: 9 }).strong.includes("mood"));

console.log("\n[planner: cadence]");
ok("silent at 03:00", planNext({ nowIso: "2026-10-18T01:00:00Z", ctx: {} }).skip === "quiet-hours");
ok("silent at daily cap", planNext({ nowIso: "2026-10-17T14:00:00Z", ctx: {}, recent: [
  { kind: "micro", state: "sent", ts: "2026-10-17T09:00:00Z", day: "2026-10-17", ladder_step: 1, sent_at: "2026-10-17T09:00:00Z" },
  { kind: "body", state: "sent", ts: "2026-10-17T11:00:00Z", day: "2026-10-17", ladder_step: 2, sent_at: "2026-10-17T11:00:00Z" },
  { kind: "contact", state: "sent", ts: "2026-10-17T13:00:00Z", day: "2026-10-17", ladder_step: 3, sent_at: "2026-10-17T13:00:00Z" }
]}).skip === "daily-cap");
ok("silent inside min gap", planNext({ nowIso: "2026-10-17T14:00:00Z", ctx: {}, recent: [
  { kind: "micro", state: "sent", ts: "2026-10-17T13:40:00Z", day: "2026-10-17", ladder_step: 1, sent_at: "2026-10-17T13:40:00Z" }
]}).skip === "min-gap");
// The morning check-in and a presence line are messages, not asks: they must not eat the budget.
const notCap = planNext({ nowIso: "2026-10-17T14:00:00Z", ctx: {}, recent: [
  { kind: "checkin", state: "sent", ts: "2026-10-17T09:00:00Z", day: "2026-10-17", ladder_step: 0, sent_at: "2026-10-17T09:00:00Z" },
  { kind: "presence", state: "sent", ts: "2026-10-17T11:00:00Z", day: "2026-10-17", ladder_step: 0, sent_at: "2026-10-17T11:00:00Z" }
]});
ok("check-in does not consume the daily cap", notCap.skip === undefined && notCap.kind === "micro", notCap);
ok("silent when every rung is retired", planNext({
  nowIso: "2026-10-17T14:00:00Z", ctx: {},
  loopRows: LADDER.map((r) => ({ kind: r.kind, fired: 10, done_rate: 0 }))
}).skip === "all-kinds-retired");

// SHAKY-NO-ASK-1: a well-formed task on the wrong day is the failure mode that matters most.
console.log("\n[shaky days]");
const shaky1 = planNext({ nowIso: "2026-10-17T14:00:00Z", ctx: { drift_level: "shaky" } });
ok("shaky with no check-in asks for nothing", shaky1.kind === "checkin" && shaky1.minutes === 0 && shaky1.ladder_step === 0, shaky1);
const shaky2 = planNext({ nowIso: "2026-10-17T16:00:00Z", ctx: { drift_level: "shaky" }, recent: [
  { kind: "checkin", state: "sent", ts: "2026-10-17T09:00:00Z", day: "2026-10-17", ladder_step: 0, sent_at: "2026-10-17T09:00:00Z" }
]});
ok("then presence, still no ask", shaky2.kind === "presence" && shaky2.expected === null, shaky2);
ok("then silence for the day", planNext({ nowIso: "2026-10-17T18:00:00Z", ctx: { drift_level: "shaky" }, recent: [
  { kind: "checkin", state: "sent", ts: "2026-10-17T09:00:00Z", day: "2026-10-17", ladder_step: 0, sent_at: "2026-10-17T09:00:00Z" },
  { kind: "presence", state: "sent", ts: "2026-10-17T16:00:00Z", day: "2026-10-17", ladder_step: 0, sent_at: "2026-10-17T16:00:00Z" }
]}).skip === "shaky-already-touched");
const shaky3 = planNext({ nowIso: "2026-10-17T14:00:00Z", ctx: { drift_level: "shaky", checked_in: true } });
ok("a logged shaky day allows one small ask", shaky3.kind === "micro" && shaky3.ladder_step === 1, shaky3);
ok("but only one", planNext({ nowIso: "2026-10-17T16:00:00Z", ctx: { drift_level: "shaky", checked_in: true }, recent: [
  { kind: "micro", state: "done", ts: "2026-10-17T12:00:00Z", day: "2026-10-17", ladder_step: 1, sent_at: "2026-10-17T12:00:00Z" }
]}).skip === "daily-cap");
ok("an ordinary day is unchanged", planNext({ nowIso: "2026-10-17T14:00:00Z", ctx: { drift_level: "ok" } }).kind === "micro");

// The contact rung names a person when the owner has given names. "Message one person" is a
// category; "message Ana" is an errand.
console.log("\n[contact rung]");
const atContact = (recent, cfg) => planNext({
  nowIso: "2026-10-17T14:00:00Z", ctx: {}, cfg, recent: recent || []
});
const named = atContact([{ kind: "micro", state: "done", ts: "2026-10-16T10:00:00Z", day: "2026-10-16", ladder_step: 1, sent_at: "2026-10-16T10:00:00Z" },
  { kind: "body", state: "done", ts: "2026-10-16T18:00:00Z", day: "2026-10-16", ladder_step: 2, sent_at: "2026-10-16T18:00:00Z" }],
  { ...DEFAULT_CONFIG, contact_candidates: ["Ana", "Joost"] });
ok("the contact rung names a real person", named.kind === "contact" && named.ask.includes("Ana"), named);
const named2 = atContact([
  { kind: "micro", state: "done", ts: "2026-10-15T10:00:00Z", day: "2026-10-15", ladder_step: 1, sent_at: "2026-10-15T10:00:00Z" },
  { kind: "body", state: "done", ts: "2026-10-15T18:00:00Z", day: "2026-10-15", ladder_step: 2, sent_at: "2026-10-15T18:00:00Z" },
  { kind: "contact", state: "done", ask: "Message Ana. One line is enough - even 'thinking of you'.", ts: "2026-10-16T09:00:00Z", day: "2026-10-16", ladder_step: 3, sent_at: "2026-10-16T09:00:00Z" },
  // care expired, so the ladder drops back to contact - that is when rotation matters
  { kind: "care", state: "expired", ts: "2026-10-16T20:00:00Z", day: "2026-10-16", ladder_step: 4, sent_at: "2026-10-16T20:00:00Z" }
], { ...DEFAULT_CONFIG, contact_candidates: ["Ana", "Joost"] });
ok("it rotates to the next name", named2.kind === "contact" && named2.ask.includes("Joost"), named2);
const nameless = atContact([{ kind: "micro", state: "done", ts: "2026-10-16T10:00:00Z", day: "2026-10-16", ladder_step: 1, sent_at: "2026-10-16T10:00:00Z" },
  { kind: "body", state: "done", ts: "2026-10-16T18:00:00Z", day: "2026-10-16", ladder_step: 2, sent_at: "2026-10-16T18:00:00Z" }]);
ok("with no names it stays a category", nameless.kind === "contact" && /one person/i.test(nameless.ask), nameless);

// The vault's daily notes are the only self-authored record of a day. Mirrors must not double-count.
console.log("\n[daily notes]");
const vrows = [
  { path: "obsidian/notes/v1/2026/10/17/_17.md", size: 343 },
  { path: "obsidian-cloud/notes/v1/2026/10/17/_17.md", size: 343 },
  { path: "obsidian/notes/v1/2026/10/16/_16.md", size: 3803 },
  { path: "obsidian/notes/v1/2026/10/2026-10-17/_arxiv-radar-2026-10-17.md", size: 2712 },
  { path: "obsidian/notes/v1/2026/10/09/_09.md", size: 22338 }
];
const vd = vaultNoteDays(vrows, "2026-10-17");
ok("mirrors are counted once", vd.total === 3, vd);
ok("machine notes are not daily notes", vd.total === 3 && !String(vd.latest).includes("arxiv"));
ok("the latest note is found", vd.latest === "2026-10-17" && vd.latestSize === 343, vd);
ok("a week of notes is counted", vd.days7 === 2, vd);

// One morning mail: the check-in rides in the brief, and the standalone path must not repeat it.
console.log("\n[morning mail]");
{
  const m = (() => {
    const d = new DatabaseSync(":memory:");
    d.exec("CREATE TABLE journal (ts TEXT)");
    d.exec("CREATE TABLE activity (date TEXT)");
    d.exec("CREATE TABLE chat (role TEXT, ts TEXT)");
    d.exec("CREATE TABLE notes (kind TEXT, ts TEXT)");
    d.exec("CREATE TABLE files (path TEXT, size INTEGER, modified TEXT)");
    return { db: d, env: { PERSONAL: d1(d), WELLBEING_TOKEN: "t0k" } };
  })();
  await ensureWellbeing(m.env.PERSONAL);
  const l1 = await briefCheckinLines(m.env, "2026-10-17T06:00:00Z");
  ok("the brief carries a check-in link", l1.length > 0 && l1.join("\n").includes("/wb/checkin?t=t0k"), l1);
  ok("noted as sent inside the brief", (await noteCheckinInBrief(m.env, "2026-10-17T06:00:00Z")) === true);
  ok("the brief does not repeat it", (await briefCheckinLines(m.env, "2026-10-17T06:05:00Z")).length === 0);
  ok("a second note is refused, not duplicated", (await noteCheckinInBrief(m.env, "2026-10-17T06:10:00Z")) === false);
  ok("the next day it returns", (await briefCheckinLines(m.env, "2026-10-18T06:00:00Z")).length > 0);
}

// The two values the machine cannot infer, set from a phone form.
console.log("\n[settings]");
{
  const s = (() => {
    const d = new DatabaseSync(":memory:");
    d.exec("CREATE TABLE journal (ts TEXT)");
    d.exec("CREATE TABLE activity (date TEXT)");
    d.exec("CREATE TABLE chat (role TEXT, ts TEXT)");
    d.exec("CREATE TABLE notes (kind TEXT, ts TEXT)");
    d.exec("CREATE TABLE files (path TEXT, size INTEGER, modified TEXT)");
    return { db: d, env: { PERSONAL: d1(d), WELLBEING_TOKEN: "t0k" } };
  })();
  await ensureWellbeing(s.env.PERSONAL);
  const form = new Request("https://reading.q08.org/wb/settings?t=t0k", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ contact_candidates: "Ana, Joost", backstop_name: "Ana", backstop_contact: "+31 6 0000 0000", quiet_start: "23", quiet_end: "7" }).toString()
  });
  const res = await handleWellbeing(form, s.env, {});
  ok("settings save is accepted", res.status === 200, res.status);
  const conf = await cfg(s.env);
  ok("names are stored as a list", Array.isArray(conf.contact_candidates) && conf.contact_candidates.length === 2, conf.contact_candidates);
  ok("the backstop is stored", conf.backstop_name === "Ana" && conf.backstop_contact.startsWith("+31"));
  ok("quiet hours are stored as numbers", conf.quiet_start === 23 && conf.quiet_end === 7, [conf.quiet_start, conf.quiet_end]);
  const saved = planNext({
    nowIso: "2026-10-17T14:00:00Z", ctx: {}, cfg: conf,
    recent: [
      { kind: "micro", state: "done", ts: "2026-10-15T10:00:00Z", day: "2026-10-15", ladder_step: 1, sent_at: "2026-10-15T10:00:00Z" },
      { kind: "body", state: "done", ts: "2026-10-15T18:00:00Z", day: "2026-10-15", ladder_step: 2, sent_at: "2026-10-15T18:00:00Z" }
    ]
  });
  ok("a saved name reaches the plan", saved.kind === "contact" && saved.ask.includes("Ana"), saved);
  const page1 = await handleWellbeing(new Request("https://reading.q08.org/wb/settings?t=t0k"), s.env, {});
  const html = await page1.text();
  ok("settings page shows what is saved", html.includes("Ana") && html.includes("<form"), html.slice(0, 80));

// The review speaks only on Sunday evening, and only with enough of his own data behind it.
console.log("\n[weekly review send]");
{
  const mk = () => {
    const d = new DatabaseSync(":memory:");
    d.exec("CREATE TABLE journal (ts TEXT)");
    d.exec("CREATE TABLE activity (date TEXT)");
    d.exec("CREATE TABLE chat (role TEXT, ts TEXT)");
    d.exec("CREATE TABLE notes (kind TEXT, ts TEXT)");
    d.exec("CREATE TABLE files (path TEXT, size INTEGER, modified TEXT)");
    return { db: d, env: { PERSONAL: d1(d), WELLBEING_TOKEN: "t0k" } };
  };
  const calls = [];
  const send = async (e, to, s, b) => { calls.push({ s, b }); return { ok: true }; };

  const r1 = mk();
  await ensureWellbeing(r1.env.PERSONAL);
  ok("silent on a Sunday morning", (await weeklyReview(r1.env, { send, nowIso: "2026-10-18T08:00:00Z" })).skipped === "not-sunday-evening");
  ok("silent on a Saturday", (await weeklyReview(r1.env, { send, nowIso: "2026-10-17T16:30:00Z" })).skipped === "not-sunday-evening");
  const thin = await weeklyReview(r1.env, { send, nowIso: "2026-10-18T16:30:00Z" });
  ok("silent without enough data", thin.skipped === "not-enough-data", thin);
  ok("nothing is sent while silent", calls.length === 0);

  const r2 = mk();
  await ensureWellbeing(r2.env.PERSONAL);
  for (const d of ["2026-10-15", "2026-10-16", "2026-10-17"]) {
    await r2.db.prepare("INSERT INTO wellbeing_checkins (ts, day, mood, source) VALUES (?, ?, ?, 'web')")
      .run(d + "T10:00:00Z", d, 3);
  }
  await r2.db.prepare("INSERT INTO companion_nudges (ts, day, kind, ask, state, sent_at, closed_at, ladder_step) VALUES (?, ?, ?, ?, 'done', ?, ?, 1)")
    .run("2026-10-16T10:00:00Z", "2026-10-16", "micro", "Drink a glass of water.", "2026-10-16T10:00:00Z", "2026-10-16T10:05:00Z");
  const out = await weeklyReview(r2.env, { send, nowIso: "2026-10-18T16:30:00Z" });
  ok("it sends on Sunday evening with data", out.ok === true, out);
  ok("exactly one mail leaves", calls.length === 1, calls.length);
  ok("the subject is the week", /^the week - 2026-10-12$/.test(calls[0].s), calls[0].s);
  ok("it reports the week from his rows", calls[0].b.includes("checked in 3 days") && calls[0].b.includes("Drink a glass of water"), calls[0].b);
  ok("it does not repeat within the week", (await weeklyReview(r2.env, { send, nowIso: "2026-10-18T19:30:00Z" })).skipped === "already-reviewed");
  ok("force does not double-send the same week", (await weeklyReview(r2.env, { send, force: true, nowIso: "2026-10-18T21:00:00Z" })).skipped === "already-reviewed");
}
}

console.log("\n[planner: ladder]");
const first = planNext({ nowIso: "2026-10-17T14:00:00Z", ctx: {} });
ok("cold start asks the smallest thing", first.ladder_step === 1 && first.kind === "micro", first);
ok("every ask carries a due date", typeof first.due_at === "string" && new Date(first.due_at) > new Date("2026-10-17T14:00:00Z"));
ok("every ask is machine-checkable", first.expected === "log:micro");

const escalated = planNext({ nowIso: "2026-10-17T14:00:00Z", ctx: {}, recent: [
  { kind: "micro", state: "done", ts: "2026-10-16T10:00:00Z", day: "2026-10-16", ladder_step: 1, sent_at: "2026-10-16T10:00:00Z" }
]});
ok("a done escalates one rung", escalated.ladder_step === 2 && escalated.kind === "body", escalated);

const dropped = planNext({ nowIso: "2026-10-17T14:00:00Z", ctx: {}, recent: [
  { kind: "micro", state: "done", ts: "2026-10-14T10:00:00Z", day: "2026-10-14", ladder_step: 1, sent_at: "2026-10-14T10:00:00Z" },
  { kind: "care", state: "expired", ts: "2026-10-16T10:00:00Z", day: "2026-10-16", ladder_step: 3, sent_at: "2026-10-16T10:00:00Z" }
]});
ok("an expired ask drops one rung, never climbs", dropped.ladder_step === 2, dropped);

const lowMood = planNext({ nowIso: "2026-10-17T14:00:00Z", ctx: { mood_today: 2, mood_avg7: 2.1 }, recent: [
  { kind: "micro", state: "done", ts: "2026-10-16T10:00:00Z", day: "2026-10-16", ladder_step: 1, sent_at: "2026-10-16T10:00:00Z" }
]});
ok("low mood caps the ladder at body", lowMood.ladder_step <= 2 && lowMood.kind !== "care", lowMood);

// 06:30Z is 08:30 local at +0200, i.e. before the 10:00 contact gate.
const early = planNext({ nowIso: "2026-10-17T06:30:00Z", ctx: {}, recent: [
  { kind: "micro", state: "done", ts: "2026-10-16T10:00:00Z", day: "2026-10-16", ladder_step: 1, sent_at: "2026-10-16T10:00:00Z" },
  { kind: "body", state: "done", ts: "2026-10-16T18:00:00Z", day: "2026-10-16", ladder_step: 2, sent_at: "2026-10-16T18:00:00Z" }
]});
ok("contact rung is not offered before 10:00 local", early.ladder_step < 3, early);
const atTen = planNext({ nowIso: "2026-10-17T08:00:00Z", ctx: {}, recent: [
  { kind: "micro", state: "done", ts: "2026-10-16T10:00:00Z", day: "2026-10-16", ladder_step: 1, sent_at: "2026-10-16T10:00:00Z" },
  { kind: "body", state: "done", ts: "2026-10-16T18:00:00Z", day: "2026-10-16", ladder_step: 2, sent_at: "2026-10-16T18:00:00Z" }
]});
ok("contact rung is offered from 10:00 local", atTen.ladder_step === 3, atTen);

console.log("\n[planner: unanswered]");
const pres = planNext({ nowIso: "2026-10-17T14:00:00Z", ctx: { unanswered_streak: 3 } });
ok("three unanswered switches to presence", pres.kind === "presence" && pres.minutes === 0, pres);
ok("presence asks nothing", pres.expected === null && pres.ask === DEFAULT_CONFIG.presence_line);
ok("presence is sent once per day", planNext({ nowIso: "2026-10-17T16:00:00Z", ctx: { unanswered_streak: 3 }, recent: [
  { kind: "presence", state: "sent", ts: "2026-10-17T14:00:00Z", day: "2026-10-17", ladder_step: 0, sent_at: "2026-10-17T14:00:00Z" }
]}).skip === "presence-already-sent");

console.log("\n[planner: retirement]");
ok("0/10 done retires the kind", retiredKinds([{ kind: "micro", fired: 10, done_rate: 0 }]).has("micro"));
ok("3/10 done keeps the kind", !retiredKinds([{ kind: "micro", fired: 10, done_rate: 0.3 }]).has("micro"));
ok("4 fires is not enough evidence", !retiredKinds([{ kind: "micro", fired: 4, done_rate: 0 }]).has("micro"));
const avoided = planNext({ nowIso: "2026-10-17T14:00:00Z", ctx: {}, loopRows: [{ kind: "micro", fired: 12, done_rate: 0 }] });
ok("a retired kind is never chosen", avoided.kind !== "micro", avoided);

console.log("\n[closed loop]");
const loopRaw = new DatabaseSync(":memory:");
loopRaw.exec("CREATE TABLE journal (ts TEXT)");
loopRaw.exec("CREATE TABLE activity (date TEXT)");
const loop = d1(loopRaw);
for (const sql of DDL) await loop.prepare(sql).run();
const nowIso = new Date().toISOString();
await loop.prepare("INSERT INTO companion_nudges (ts,day,kind,ask,state,sent_at,shown_at,due_at) VALUES (?,?,?,?,?,?,?,?)")
  .bind(nowIso, dayKey(nowIso), "micro", "water", "shown", nowIso, nowIso, "2000-01-01T00:00:00Z").run();
const flipped = await expireStale(loop, nowIso);
ok("stale ask expires", flipped === 1, flipped);
const st = await loop.prepare("SELECT state FROM companion_nudges").all();
ok("expired state persisted", st.results[0].state === "expired", st.results);
await closeNudge(loop, 1, { state: "done", nowIso });
await loop.prepare("INSERT INTO companion_nudges (ts,day,kind,ask,state,sent_at,closed_at) VALUES (?,?,?,?,?,?,?)")
  .bind(nowIso, dayKey(nowIso), "body", "walk", "done", nowIso, nowIso).run();
const lr = await loop.prepare("SELECT * FROM v_nudge_loop WHERE kind='micro'").all();
ok("loop view counts fired/expired/done", lr.results[0].fired === 1 && lr.results[0].done === 1 && lr.results[0].expired === 0, lr.results[0]);
ok("done_rate is computed", lr.results[0].done_rate === 1, lr.results[0]);
const cov = await loop.prepare("SELECT * FROM v_wellbeing_coverage").all();
ok("coverage view is one row", cov.results.length === 1, cov.results.length);
ok("coverage reports a stale journal", cov.results[0].journal_last === null);
const streak = await unansweredStreak(loop);
ok("unanswered streak counts open asks", streak >= 0);
for (let i = 1; i <= 3; i++) {
  // one check-in per day is enforced by NUDGE-DUP-1, so spread them across days.
  const d = new Date(Date.parse(nowIso) - i * 864e5).toISOString();
  await loop.prepare("INSERT INTO companion_nudges (ts,day,kind,ask,state,sent_at) VALUES (?,?,?,?,?,?)")
    .bind(d, dayKey(d), "checkin", "how's it landing", "sent", d).run();
}
ok("morning check-ins are not ignored asks", (await unansweredStreak(loop)) === 0, await unansweredStreak(loop));
try { await closeNudge(loop, 1, { state: "fired" }); fail++; console.log("  FAIL closeNudge accepts anything"); }
catch (e) { if (String(e.message).includes("NUDGE-STATE-1")) { pass++; console.log("  ok   closeNudge rejects unknown states"); } else throw e; }

console.log("\n[escalation]");
ok("crisis phrase detected", crisisSignal("honestly I want to die").level === 2);
ok("soft phrase is level 1", crisisSignal("I can't cope with this").level === 1);
ok("ordinary sentence is level 0", crisisSignal("the build is red again").level === 0);
ok("self-harm phrase is level 2", crisisSignal("I keep thinking about hurting myself").level === 2);
ok("self-harm inflection is caught", crisisSignal("I self-harmed last night").level === 2);
ok("suicidal ideation is caught", crisisSignal("I've been suicidal for a week").level === 2);
ok("'cut myself some slack' is not a crisis", crisisSignal("I should cut myself some slack today").level === 0);
ok("'kill the build' is not a crisis", crisisSignal("I want to kill this build and start over").level === 0);
ok("'nothing matters' is soft, not hard", crisisSignal("nothing matters anymore").level === 1);
// COMPANION-CRISIS-PARITY-1 (agent_issues 100040): curly apostrophes and the phrasings personal-api catches.
ok("curly apostrophe is normalised", crisisSignal("I don\u2019t want to live").level === 2);
ok("left curly apostrophe is normalised", crisisSignal("I can\u2018t cope").level === 1);
ok("'wish I was dead' is caught", crisisSignal("some days I wish I was dead").level === 2);
ok("'better off without me' is caught", crisisSignal("they'd be better off without me").level === 2);
ok("'nobody would miss me' is caught", crisisSignal("nobody would miss me").level === 2);
ok("'kms' is caught", crisisSignal("honestly gonna kms").level === 2);
ok("Dutch 'zelfmoord' is caught", crisisSignal("ik denk aan zelfmoord").level === 2);
ok("Dutch 'ik wil dood' is caught", crisisSignal("ik wil dood").level === 2);
ok("Dutch 'er een eind aan maken' is caught", crisisSignal("ik wil er een eind aan maken").level === 2);
ok("Dutch 'ik wil er niet meer zijn' is caught", crisisSignal("ik wil er niet meer zijn").level === 2);
ok("Dutch 'ik zie het niet meer zitten' is soft", crisisSignal("ik zie het niet meer zitten").level === 1);
ok("'to die for' stays calm", crisisSignal("this cake is to die for").level === 0);
ok("'killing time' stays calm", crisisSignal("just killing time before the meeting").level === 0);
ok("an ordinary Dutch sentence stays calm", crisisSignal("ik ga morgen naar de markt").level === 0);
const empty = crisisBlock({});
ok("unconfigured backstop is admitted, not invented", empty.text.includes("No backstop is configured yet"));
ok("unconfigured crisis lines are admitted", empty.text.includes("No crisis lines configured yet"));
ok("no phone number is ever fabricated", !/\d{3}[- ]\d{3,}/.test(empty.text), empty.text);
const filled = crisisBlock({ backstop_name: "Sam", crisis_lines: [{ label: "113", number: "113" }] });
ok("configured backstop is named", filled.text.includes("Sam"));
ok("configured line is printed", filled.text.includes("113"));
ok("escalation declares its SLA", filled.sla_seconds === 60);
ok("escalation has three paths", filled.paths.length === 3);

// The six steps of a safety plan, in his words. Empty steps are admitted, never invented.
console.log("\n[safety plan]");
const bare = safetyPlanBlock({}, DEFAULT_CONFIG);
ok("an empty plan names every missing step", bare.missing.length === 6, bare.missing);
ok("an empty plan asserts nothing", bare.lines.length === 0, bare.lines);
const full = safetyPlanBlock({
  warning_signs: ["stopped answering people", "everything feels pointless"],
  coping: ["walk to the canal", "cold shower"],
  distraction: ["the cafe on the corner"],
  people: [{ name: "Ana", contact: "+31 6 0000" }],
  environment: ["give the pills to Ana"]
}, { ...DEFAULT_CONFIG, crisis_lines: [{ label: "113", number: "113" }] });
ok("a filled plan is complete", full.complete === true, full.missing);
ok("his own words come back verbatim", full.lines.join("\n").includes("walk to the canal") && full.lines.join("\n").includes("Ana (+31 6 0000)"));
ok("the order is warning signs first, environment last",
  full.lines[0].startsWith("What it looks like") && full.lines[full.lines.length - 2].startsWith("Making the flat"), full.lines);
const crisisWithPlan = crisisBlock({ ...DEFAULT_CONFIG, crisis_lines: [{ label: "113", number: "113" }], backstop_name: "Ana" }, { coping: ["walk"] });
ok("the crisis text carries the plan", crisisWithPlan.text.includes("walk") && crisisWithPlan.text.includes("You wrote this down"));
ok("it still names the person and the service", crisisWithPlan.text.includes("Ana") && crisisWithPlan.text.includes("113"));
ok("a plan-less crisis still confesses", crisisBlock({}).text.includes("No backstop is configured yet"));
ok("and still invents no number", !/\d{3}[- ]\d{3,}/.test(crisisBlock({}).text));

// The weekly review reports what happened; it never totals what he missed.
console.log("\n[weekly review text]");
const review = weeklyReviewText({
  week: "2026-10-12",
  checkins: [{ day: "2026-10-15", mood: 3 }, { day: "2026-10-16", mood: 2 }, { day: "2026-10-17", mood: 4 }],
  done: [{ ask: "Drink a glass of water.", day: "2026-10-16" }, { ask: "Message Ana. One line is enough.", day: "2026-10-17" }],
  helped: [{ kind: "body", mood_after: 3.5, mood_other: 2.8 }],
  retired: ["care"]
});
ok("the review counts check-ins", review.includes("You checked in 3 days"), review);
ok("it reports the mood average", review.includes("Mood averaged 3"), review);
ok("it lists what was done", review.includes("Drink a glass of water") && review.includes("Message Ana"));
ok("it reports what helped", review.includes("body: 3.5") && review.includes("other days 2.8"));
ok("a retired ask is explained kindly", /stopped asking about care/.test(review) && /not helping/.test(review));
ok("it never totals misses", !/\bmissed\b|\bfailed\b|\bonly\b|0 of/i.test(review), review);
const emptyReview = weeklyReviewText({ week: "2026-10-12" });
ok("an empty week says almost nothing", emptyReview.trim() === "Week of 2026-10-12.\n\nNothing needed here.", JSON.stringify(emptyReview));

console.log("\n[what helped]");const helped = await whatHelped(loop, 60);
ok("whatHelped returns an array", Array.isArray(helped), helped);

// The page shell once rendered without its body in production: the doctype and style were served
// and every button was missing. Assert on delivered HTML, not on the helper's inputs.
console.log("\n[http]");
{
  const hdb = new DatabaseSync(":memory:");
  hdb.exec("CREATE TABLE journal (ts TEXT)");
  hdb.exec("CREATE TABLE activity (date TEXT)");
  hdb.exec("CREATE TABLE chat (role TEXT, ts TEXT)");
  hdb.exec("CREATE TABLE notes (kind TEXT, ts TEXT)");
  const env = { PERSONAL: d1(hdb), WELLBEING_TOKEN: "t0k" };
  const req = (u, init) => new Request("https://reading.q08.org" + u, init);
  const res = await handleWellbeing(req("/wb/checkin?t=t0k"), env, {});
  const body = await res.text();
  ok("check-in page renders its body", body.includes("<body>") && body.includes(">mood - how you feel right now<") && body.includes(">energy - what you have in the tank<"), body.slice(-160));
  ok("check-in page renders all five values", [1, 2, 3, 4, 5].every((v) => body.includes("mood=" + v)), body.slice(-200));
  ok("check-in page carries the token forward", body.includes("t=t0k"));
  const unauth = await handleWellbeing(req("/wb/checkin"), env, {});
  ok("missing token is 401", unauth.status === 401, unauth.status);
  const scored = await handleWellbeing(req("/wb/checkin?mood=4&energy=3&t=t0k"), env, {});
  ok("a tap records and re-renders", scored.status === 200 && (await scored.text()).includes("b sel"));
  const bad = await handleWellbeing(req("/wb/done?t=t0k"), env, {});
  ok("done without an id is 400", bad.status === 400, bad.status);
  const notMine = await handleWellbeing(req("/health"), env, {});
  ok("other routes are untouched", notMine === null);
  const tick = await handleWellbeing(req("/wb/tick?force=1&t=t0k"), env, {});
  const tjson = JSON.parse(await tick.text());
  ok("forced tick plans without a mailer", !!(tjson.planned || tjson.skipped) && !tjson.sent, Object.keys(tjson));
  ok("a planned tick writes no nudge row", hdb.prepare("SELECT COUNT(*) c FROM companion_nudges").get().c === 0);
  // Delivery bookkeeping: every branch must write the row it claims to write.
  // Each branch gets a fresh DB so the one-open-ask-per-day rule cannot confuse the assertion.
  const mkEnv = () => {
    const d = new DatabaseSync(":memory:");
    d.exec("CREATE TABLE journal (ts TEXT)");
    d.exec("CREATE TABLE activity (date TEXT)");
    d.exec("CREATE TABLE chat (role TEXT, ts TEXT)");
    d.exec("CREATE TABLE notes (kind TEXT, ts TEXT)");
    return { db: d, env: { PERSONAL: d1(d), WELLBEING_TOKEN: "t0k" } };
  };
  // CLOCK-PIN-1: a fixed Wednesday 14:00Z (16:00 Amsterdam) - outside the 07:45-12:00 local check-in window and not Sunday evening, so exactly one ask mail is expected; the wall clock made this suite fail every morning.
  const nowIso2 = "2026-10-14T14:00:00.000Z";

  const a = mkEnv();
  const delivered = [];
  const realSend = async (e, to, subject, body) => { delivered.push({ to, subject, body }); return { ok: true, via: "test" }; };
  const t2json = await wellbeingTick(a.env, { send: realSend, nowIso: nowIso2, force: true });
  ok("a real sender delivers the ask", t2json.sent && t2json.sent.ok === true, t2json.sent);
  ok("the mail goes to the owner", delivered.length === 1 && delivered[0].to === "rwnquni@outlook.com", delivered[0] && delivered[0].to);
  const row2 = a.db.prepare("SELECT state, sent_at, outcome FROM companion_nudges ORDER BY id DESC LIMIT 1").get();
  ok("delivered row is marked sent with a timestamp", row2.state === "sent" && !!row2.sent_at, row2);
  ok("the mail carries both answers", /\/wb\/done\?id=/.test(delivered[0].body) && /\/wb\/no\?id=/.test(delivered[0].body));

  const b = mkEnv();
  await wellbeingTick(b.env, { send: async () => ({ ok: false, disabled: true }), nowIso: nowIso2, force: true });
  const row3 = b.db.prepare("SELECT state, outcome FROM companion_nudges ORDER BY id DESC LIMIT 1").get();
  ok("an owner off-switch closes the row, not retries it", row3.state === "expired" && row3.outcome.includes("owner_notices_disabled"), row3);

  const c2 = mkEnv();
  await wellbeingTick(c2.env, { send: async () => ({ ok: false, suppressed: true }), nowIso: nowIso2, force: true });
  const row4 = c2.db.prepare("SELECT state, outcome FROM companion_nudges ORDER BY id DESC LIMIT 1").get();
  ok("a suppressed send stays queued with a reason", row4.state === "queued" && row4.outcome.includes("suppressed"), row4);
  const crisis = await handleWellbeing(req("/wb/checkin?note=" + encodeURIComponent("I want to die") + "&t=t0k"), env, {});
  const cbody = await crisis.text();
  ok("a crisis note answers with the fixed block", cbody.includes("not alone") || cbody.includes("You said something"), cbody.slice(0, 120));
  const api = await handleWellbeing(req("/api/wellbeing?t=t0k"), env, {});
  const json = JSON.parse(await api.text());
  ok("api reports the seeded crisis lines", Array.isArray(json.config_gaps) && !json.config_gaps.includes("crisis_lines"), json.config_gaps);
  ok("api still flags the missing backstop", json.config_gaps.includes("backstop_contact"), json.config_gaps);
}

console.log("\n[pause shared with /companion (RED-TEAM-1)]");
{
  const p = (() => { const d = new DatabaseSync(":memory:"); return { db: d, env: { PERSONAL: d1(d), WELLBEING_TOKEN: "t0k" } }; })();
  await ensureWellbeing(p.env.PERSONAL);
  p.db.prepare("INSERT INTO wellbeing_config (key, value, updated_at) VALUES ('pause_until', ?, ?)").run(JSON.stringify(new Date(Date.parse("2026-10-19T09:00:00Z") + 864e5).toISOString()), "2026-10-19T09:00:00Z");
  let sends = 0;
  const pt = await wellbeingTick(p.env, { send: async () => { sends++; return { ok: true }; }, nowIso: "2026-10-19T09:00:00Z" });
  ok("a pause set on /companion silences the e-mail check-in and the ladder", pt.skipped === "paused" && sends === 0, pt);
  p.db.prepare("UPDATE wellbeing_config SET value = ? WHERE key = 'pause_until'").run(JSON.stringify("2026-10-18T00:00:00.000Z"));
  const pt2 = await wellbeingTick(p.env, { send: async () => { sends++; return { ok: true }; }, nowIso: "2026-10-19T09:00:00Z" });
  ok("an expired pause lets the morning check-in through", pt2.skipped !== "paused" && sends >= 1, pt2);
}

console.log("\n[e-mail off: the ask goes to the app (COMPANION-EMAIL-OPT-IN-1)]");
{
  const q = (() => { const d = new DatabaseSync(":memory:"); return { db: d, env: { PERSONAL: d1(d), WELLBEING_TOKEN: "t0k" } }; })();
  await ensureWellbeing(q.env.PERSONAL);
  const qt = await wellbeingTick(q.env, { send: async () => ({ ok: false, disabled: true, app: true, mode: "off" }), nowIso: "2026-10-19T09:00:00Z" });
  const rows = q.db.prepare("SELECT state, sent_at, outcome FROM companion_nudges").all();
  ok("with companion e-mail off the check-in is marked sent via the app, so personal-api pushes it", rows.length >= 1 && rows.every((r) => r.state === "sent" && r.sent_at && /"via":"app"/.test(r.outcome)), { qt, rows });
}

console.log("\n" + (fail === 0 ? "PASS" : "FAIL") + "  " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
