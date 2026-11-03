// personal-api/companion-calendar.test.mjs (COMPANION-CALENDAR-AWARE-1, agent_issues 100200, pillar personal)
// planNudge reads the day's events: no ask during a timed event, a lighter day at three or more events, one short "after <event>"
// check-in once a social or heavy event has ended. Pure planner cases, then the events reader against an in-memory personal-life.
// Run: node personal-api/companion-calendar.test.mjs
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as C from "./companion.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
function d1(db) {
  return {
    prepare(sql) {
      let args = [];
      const api = {
        bind(...a) { args = a.map((x) => (x === undefined ? null : x)); return api; },
        async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async first() { return db.prepare(sql).get(...args) ?? null; }
      };
      return api;
    }
  };
}

const NOW = "2026-10-14T12:00:00.000Z"; // Wednesday, 14:00 in Amsterdam (CEST)
const nowMs = Date.parse(NOW);
const min = (n) => nowMs + n * 60000;
const ev = (from, to, extra) => Object.assign({ title: "Event", startMs: min(from), endMs: min(to), allDay: false, social: false, heavy: false }, extra || {});
const base = (over) => Object.assign({
  nowIso: NOW, hour: 14, cfg: { wellbeing_prompts: true }, todays: [], recent: [], unansweredStreak: 0, retired: new Set(),
  mood: { today: 3, energy_today: null, avg7: 3, avg2: 3 }, checkinSentToday: false, journalToday: true, lastUserIso: null,
  actionsDoneToday: 1, nextActions: [{ id: "t1", title: "Pay the invoice", energy: "low", minutes: 10, context: "@computer", ts: "a" }],
  dueCards: 0, pushReady: true, crisisLevel24h: 0, receptive: null, activityBank: [], helps: null, daysSinceSocial: 0, events: []
}, over || {});

console.log("\n[baseline: no calendar, nothing changes]");
{
  const p = C.planNudge(base());
  ok("an ordinary quiet afternoon still gets the one small thing", p.kind === "cmp-next", p);
  ok("an empty events list and a missing one plan the same", C.planNudge(base({ events: undefined })).kind === "cmp-next");
}

console.log("\n[no ask during an event]");
{
  ok("a timed event that is on holds the ask", C.planNudge(base({ events: [ev(-20, 40)] })).skip === "during-event");
  ok("it holds a morning check-in too", C.planNudge(base({ hour: 9.5, nowIso: "2026-10-14T07:30:00.000Z", events: [{ title: "Standup", startMs: Date.parse("2026-10-14T07:00:00Z"), endMs: Date.parse("2026-10-14T08:00:00Z"), allDay: false, social: false, heavy: false }], mood: { today: null, avg7: null, avg2: null } })).skip === "during-event");
  ok("and a low-day care line", C.planNudge(base({ mood: { today: 1, avg7: 3, avg2: 1 }, events: [ev(-5, 30)] })).skip === "during-event");
  ok("an event that has not started yet does not", C.planNudge(base({ events: [ev(30, 90)] })).kind === "cmp-next");
  ok("one that ended a minute ago does not", C.planNudge(base({ events: [ev(-60, -1)] })).kind === "cmp-next");
  ok("the end is exclusive, the start inclusive", C.planNudge(base({ events: [ev(-60, 0)] })).kind === "cmp-next" && C.planNudge(base({ events: [ev(0, 30)] })).skip === "during-event");
  ok("an all-day item never blocks a slot", C.planNudge(base({ events: [{ title: "Conference", startMs: null, endMs: null, allDay: true, social: false, heavy: false }] })).kind === "cmp-next");
  ok("risk words are answered even during an event (care is never held)", C.planNudge(base({ crisisLevel24h: 2, events: [ev(-20, 40)] })).kind === "cmp-care");
  ok("quiet hours and the cap still come first", C.planNudge(base({ hour: 23, events: [ev(-20, 40)] })).skip === "quiet-hours" && C.planNudge(base({ todays: [1, 2, 3].map((i) => ({ kind: "k" + i, state: "done", ask: "x", ts: "2026-10-14T05:00:00Z" })), events: [ev(-20, 40)] })).skip === "daily-cap");
}

console.log("\n[a lighter day]");
{
  const three = [ev(-300, -240, { title: "A" }), ev(120, 180, { title: "B" }), ev(240, 300, { title: "C" })];
  const sent = (n) => Array.from({ length: n }, (_, i) => ({ kind: "cmp-k" + i, state: "done", ask: "x", ts: "2026-10-14T0" + (i + 1) + ":00:00Z", sent_at: "2026-10-14T0" + (i + 1) + ":00:00Z" }));
  ok("with three events the last slot of the cap stays free: 2 of 3 sent -> no optional ask", C.planNudge(base({ events: three, todays: sent(2) })).skip === "light-day");
  ok("the same day with two events would still ask", C.planNudge(base({ events: three.slice(0, 2), todays: sent(2) })).kind === "cmp-next");
  ok("with three events and one sent, an optional ask still goes out", C.planNudge(base({ events: three, todays: sent(1) })).kind === "cmp-next");
  const mixed = [{ id: "big", title: "Write the report", energy: "medium", minutes: 30, ts: "a" }, { id: "tiny", title: "Water the plants", energy: "low", minutes: 5, ts: "b" }];
  const mood4 = { today: 4, energy_today: 4, avg7: 4, avg2: 4 };
  ok("normally a good-energy day is offered the bigger step", C.planNudge(base({ mood: mood4, nextActions: [mixed[0]] })).action_id === "big");
  const lp = C.planNudge(base({ mood: mood4, events: three, nextActions: mixed }));
  ok("a lighter day offers only the smallest step", lp.action_id === "tiny" && /light-day/.test(lp.reason), lp);
  ok("and with only a bigger step on the list it offers that no bigger than low energy allows", C.planNudge(base({ mood: mood4, events: three, nextActions: [mixed[0]] })).action_id !== "big");
  ok("three events are the threshold, not two", C.LIGHT_DAY_EVENTS === 3);
}

console.log("\n[after a social or heavy event]");
{
  const dinner = (end, extra) => ev(end - 120, end, Object.assign({ title: "Dinner with Sam", social: true }, extra));
  const p = C.planNudge(base({ events: [dinner(-20)] }));
  ok("a social event that ended 20 minutes ago gets a short check-in naming it", p.kind === "cmp-after" && p.ask === C.afterEventText("Dinner with Sam") && /After Dinner with Sam/.test(p.ask) && /after-event social/.test(p.reason), p);
  ok("a heavy one (a dentist visit) does too", C.planNudge(base({ events: [ev(-90, -10, { title: "Dentist", heavy: true })] })).kind === "cmp-after");
  ok("an ordinary meeting does not", C.planNudge(base({ events: [ev(-90, -10, { title: "Standup" })] })).kind === "cmp-next");
  ok("two hours later it is too late", C.planNudge(base({ events: [dinner(-130)] })).kind === "cmp-next");
  ok("once a day, however many events", C.planNudge(base({ events: [dinner(-20)], todays: [{ kind: "cmp-after", state: "done", ask: "x", ts: "2026-10-14T10:00:00Z" }] })).kind === "cmp-next");
  ok("not when he has already logged a mood since it ended", C.planNudge(base({ events: [dinner(-20)], lastMoodIso: min(-5) && new Date(min(-5)).toISOString() })).kind === "cmp-next");
  ok("a mood from before it ended does not count", C.planNudge(base({ events: [dinner(-20)], lastMoodIso: new Date(min(-200)).toISOString() })).kind === "cmp-after");
  ok("not on a low day (care already speaks)", C.planNudge(base({ events: [dinner(-20)], mood: { today: 1, avg7: 3, avg2: 1 } })).kind === "cmp-care");
  ok("not once the kind has been retired by never landing", C.planNudge(base({ events: [dinner(-20)], retired: new Set(["cmp-after"]) })).kind === "cmp-next");
  ok("not while another event is on", C.planNudge(base({ events: [dinner(-20), ev(-5, 25, { title: "Call" })] })).skip === "during-event");
  ok("it respects quiet hours", C.planNudge(base({ hour: 22.5, nowIso: "2026-10-14T20:30:00.000Z", events: [dinner(-20, { startMs: Date.parse("2026-10-14T18:10:00Z"), endMs: Date.parse("2026-10-14T20:10:00Z") })] })).skip === "quiet-hours");
  const long = C.planNudge(base({ events: [ev(-60, -5, { title: "x".repeat(200), social: true })] }));
  ok("a long title is cut", long.ask.length < 140, long.ask.length);
}

console.log("\n[its push and answer]");
{
  const row = { id: 9, kind: "cmp-after", ask: C.afterEventText("Therapy") };
  const pl = C.pushPayloadFor(row);
  ok("the push says what it is, opens the mood picker and has no Did-it buttons", pl.title === "How did it go?" && pl.url === "/companion#mood" && pl.ask === false, pl);
  const disc = C.discreetPayload(pl, undefined);
  ok("the event name stays off the lock screen by default", disc.body === "A note for you, whenever you're ready." && !JSON.stringify(disc).includes("Therapy"));
  ok("the kind is known to the companion", C.NUDGE_KINDS.includes("cmp-after") && C.DISCREET_KINDS.includes("cmp-after"));
}

console.log("\n[reading the events]");
const mk = async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE events (id TEXT PRIMARY KEY, category TEXT, title TEXT, venue TEXT, city TEXT, country TEXT, start_date TEXT, end_date TEXT, energy INTEGER, energy_label TEXT)");
  const env = { PERSONAL: d1(raw) };
  await C.ensureSchema(env.PERSONAL, true);
  let n = 0;
  const add = (cat, title, st, en, label) => raw.prepare("INSERT INTO events (id, category, title, start_date, end_date, energy_label) VALUES (?,?,?,?,?,?)").run("e" + (++n), cat, title, st, en, label || null);
  return { raw, env, add };
};
{
  ok("eventMs: an offset is exact", C.eventMs("2026-10-14T13:30:00+02:00", "Asia/Bangkok") === Date.parse("2026-10-14T11:30:00Z"));
  ok("eventMs: no offset is local time in the zone given", C.eventMs("2026-10-14T13:30", "Europe/Amsterdam") === Date.parse("2026-10-14T11:30:00Z") && C.eventMs("2026-10-14T13:30", "Asia/Bangkok") === Date.parse("2026-10-14T06:30:00Z"));
  ok("eventMs: a date alone, junk and null are null", C.eventMs("2026-10-14", "UTC") === null && C.eventMs("soon", "UTC") === null && C.eventMs(null, "UTC") === null);
  const rows = [
    { title: "Birthday dinner", category: "event", start: "2026-10-14T19:00", end: "2026-10-14T22:00" },
    { title: "Dentist", category: "", start: "2026-10-14T13:30", end: "2026-10-14T14:30" },
    { title: "Conference", category: "conference", start: "2026-10-13", end: "2026-10-15" },
    { title: "Night shift", category: "", start: "2026-10-13T22:00", end: "2026-10-15T09:00" },
    { title: "Elsewhere", category: "", start: "2026-10-20T10:00", end: "2026-10-20T11:00" },
    { title: "Hotel", category: "lodging", start: "2026-10-12", end: "2026-10-16" },
    { title: "Dentist", category: "", start: "2026-10-14T13:30", end: "2026-10-14T14:30" },
    { title: "", category: "", start: "2026-10-14T13:30", end: "" },
    { title: "Yoga", category: "", start: "2026-10-14T08:00", end: "" }
  ];
  const out = C.normalizeEvents(rows, "2026-10-14", "Europe/Amsterdam");
  const by = (t) => out.find((e) => e.title === t);
  ok("the day's events are kept, others and lodging dropped, duplicates merged", out.length === 5 && !by("Elsewhere") && !by("Hotel") && out.filter((e) => e.title === "Dentist").length === 1, out.map((e) => e.title));
  ok("a conference row dated by days and a multi-day shift are all-day (they count, they never block)", by("Conference").allDay === true && by("Night shift").allDay === true && by("Conference").startMs === null);
  ok("social by name, heavy by name or category", by("Birthday dinner").social === true && by("Dentist").heavy === true && by("Yoga").social === false && by("Yoga").heavy === false);
  ok("a timed event with no end gets a default length", by("Yoga").endMs - by("Yoga").startMs === C.EVENT_DEFAULT_MIN * 60000 && by("Dentist").endMs - by("Dentist").startMs === 3600000);
  const hv = C.normalizeEvents([{ title: "Meeting", category: "", start: "2026-10-14T10:00", end: "", energy_label: "heavy" }, { title: "Pitch day", category: "", start: "2026-10-14T15:00", end: "" }], "2026-10-14", "Europe/Amsterdam");
  ok("an energy label of heavy makes it heavy, and a heavy event with no end runs two hours", hv[0].heavy === true && hv[0].endMs - hv[0].startMs === C.EVENT_HEAVY_MIN * 60000 && hv[1].heavy === true);
  ok("a category of social marks it social", C.normalizeEvents([{ title: "Evening", category: "social", start: "2026-10-14T20:00", end: "2026-10-14T23:00" }], "2026-10-14", "UTC")[0].social === true);
}
{
  C.clearEventCache();
  const { env, add, raw } = await mk();
  add("event", "Dentist", "2026-10-14T13:30", "2026-10-14T14:30");
  add("lodging", "Hotel", "2026-10-12", "2026-10-16");
  let calls = 0;
  const deps = {
    calendar: async () => { calls++; return { ok: true, events: [
      { title: "Dentist", dtstart: "2026-10-14T13:30:00+02:00", dtend: "2026-10-14T14:30:00+02:00", calendar: "google" },
      { title: "Birthday dinner", dtstart: "2026-10-14T19:00:00+02:00", dtend: "2026-10-14T22:00:00+02:00", calendar: "google" },
      { title: "Public holiday", dtstart: "2026-10-14", all_day: true, calendar: "google" },
      { title: "Radar idea", dtstart: "2026-10-14T16:00:00+02:00", calendar: "suggestion", source: "personal-radar" }
    ] }; }
  };
  const evs = await C.loadEvents(env, deps, "2026-10-14", "Europe/Amsterdam");
  ok("events table and calendar merge: the duplicate dentist counts once, holidays and radar suggestions are left out", evs.length === 2 && evs.map((e) => e.title).sort().join() === "Birthday dinner,Dentist", evs.map((e) => e.title));
  await C.loadEvents(env, deps, "2026-10-14", "Europe/Amsterdam");
  ok("the calendar answer is kept for a couple of minutes (one read)", calls === 1);
  C.clearEventCache();
  const slow = await C.loadEvents(env, { calendarTimeoutMs: 20, calendar: () => new Promise(() => {}) }, "2026-10-14", "Europe/Amsterdam");
  ok("a calendar that does not answer costs 3 s at most and leaves the table's events", slow.length === 1 && slow[0].title === "Dentist");
  C.clearEventCache();
  const boom = await C.loadEvents(env, { calendar: async () => { throw new Error("google down"); } }, "2026-10-14", "Europe/Amsterdam");
  ok("a calendar that throws is ignored", boom.length === 1);
  const none = await C.loadEvents(env, undefined, "2026-10-14", "Europe/Amsterdam");
  ok("no calendar reader: the table alone", none.length === 1);
  raw.exec("DROP TABLE events");
  ok("no events table: no events, nothing thrown", (await C.loadEvents(env, undefined, "2026-10-14", "Europe/Amsterdam")).length === 0);
}

console.log("\n[the tick and Today use it]");
{
  C.clearEventCache();
  const { env, add, raw } = await mk();
  raw.prepare("INSERT INTO cmp_push_subs (endpoint, p256dh, auth, created_at) VALUES ('https://push.example/x', 'p', 'a', '2026-10-01T00:00:00Z')").run();
  add("event", "Dentist", "2026-10-14T13:30", "2026-10-14T14:30");
  const during = await C.companionTick(env, {}, { nowIso: NOW, dryRun: true });
  ok("a tick during the dentist plans nothing", during.plan.skip === "during-event", during.plan);
  const after = await C.companionTick(env, {}, { nowIso: "2026-10-14T12:45:00.000Z", dryRun: true });
  ok("a tick after an appointment does not ask how it felt", after.plan.skip === "nothing-useful", after.plan);
  const st = await C.gatherState(env, NOW);
  ok("state carries the events and the last mood time", st.events.length === 1 && st.events[0].heavy === true && st.lastMoodIso === null);
  await C.recordMood(env, null, { score: 3 });
  const st2 = await C.gatherState(env);
  ok("a mood tap is the last mood time", typeof st2.lastMoodIso === "string");
  add("event", "Standup", "2026-10-14T09:00", "2026-10-14T09:15");
  add("event", "Lunch", "2026-10-14T12:00", "2026-10-14T13:00");
  const t = await C.today(env, {});
  ok("Today reports the load (these dates are in the past, so it counts only what falls on today's date)", typeof t.events_today === "number" && typeof t.light_day === "boolean" && typeof t.busy_now === "boolean");
  const html = C.PAGE_HTML;
  ok("the page says a full day once and gives an after-event ask no Did-it buttons", /A full day \('\+t\.events_today\+' things on\)/.test(html) && /'cmp-checkin','cmp-after'/.test(html));
  raw.exec("DELETE FROM companion_nudges");
  const id = raw.prepare("INSERT INTO companion_nudges (ts, day, kind, ladder_step, ask, state, sent_at) VALUES (?, ?, 'cmp-after', 0, 'After Dentist: how are you?', 'sent', ?)").run(new Date().toISOString(), C.dayKey(new Date().toISOString()), new Date().toISOString()).lastInsertRowid;
  await C.recordMood(env, null, { score: 4 });
  ok("logging a mood answers an open after-event ask", raw.prepare("SELECT state FROM companion_nudges WHERE id = ?").get(Number(id)).state === "done");
}

console.log("\n[worker.js parity]");
{
  const w = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  ok("worker.js carries COMPANION-CALENDAR-AWARE-1 (the issue's closing probe)", w.includes("COMPANION-CALENDAR-AWARE-1"));
  ok("worker.js hands the companion the twin's calendar reader", w.includes("calendar: (env, from, to) => calList(env, from, to, 40)"));
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
