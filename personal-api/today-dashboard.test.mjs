// personal-api/today-dashboard.test.mjs (TODAY-DASHBOARD-1, pillar personal)
// Run: node personal-api/today-dashboard.test.mjs
import vm from "node:vm";
import * as C from "./companion.js";

let bad = 0;
const ok = (name, cond, extra) => { if (!cond) { bad++; console.log("FAIL", name, extra === undefined ? "" : JSON.stringify(extra)); } else console.log("ok  ", name); };

// 1. the page's own scripts still parse with the new Today cards in them
const scripts = [...C.PAGE_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
ok("the page has a script", scripts.length > 0);
let parsed = true;
try { for (const sc of scripts) new vm.Script(sc.replace(/__VERSION__/g, "x")); } catch (e) { parsed = e.message; }
ok("every page script parses", parsed === true, parsed);
ok("Today renders the agenda cards", C.PAGE_HTML.includes("renderAgenda(v,t)") && C.PAGE_HTML.includes("Your day") && C.PAGE_HTML.includes("In your inbox"));

// 2. agenda() with a calendar and a mail index
const st = { day: "2026-10-29" };
const mailRows = [{ sender: "a@example.org", subject: "Hello", received_at: "2026-10-29T06:00:00Z", category: null }];
const env = (rows) => ({ PERSONAL: { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) } });
const cal = { ok: true, google: "ics", note: "n", events: [
  { title: "Dentist", dtstart: "2026-10-29T09:00:00Z", dtend: "2026-10-29T10:00:00Z", location: "Main St", source: "google" },
  { title: "Walk with Sam", dtstart: "2026-10-31T10:00:00Z", source: "google" },
  { title: "Jazz night", dtstart: "2026-10-30T20:00:00Z", calendar: "suggestion", source: "personal-radar" }
] };
const a = await C.agenda(env(mailRows), { calendar: async () => cal }, st);
ok("today's event is in today, not soon", a.today.length === 1 && a.today[0].title === "Dentist" && a.today[0].where === "Main St", a.today);
ok("a later event is in soon", a.soon.length === 1 && a.soon[0].title === "Walk with Sam", a.soon);
ok("a radar idea is only in radar, never in the day", a.radar.length === 1 && a.radar[0].title === "Jazz night" && !a.today.concat(a.soon).some((e) => e.title === "Jazz night"));
ok("the calendar state is passed through", a.calendar.state === "ics", a.calendar);
ok("recent mail is listed", a.mail.items.length === 1 && a.mail.items[0].subject === "Hello" && a.mail.note === null, a.mail);
ok("there is no unsolicited reflection question", a.prompt === null && (await C.agenda(env([]), {}, st)).prompt === null);

// 3. nothing connected: honest statements, no throw
const none = await C.agenda(env([]), { calendar: async () => null }, st);
ok("a calendar that does not answer says so", none.calendar.state === "unreachable" && /did not answer/.test(none.calendar.note), none.calendar);
ok("no mail says mail is not connected", none.mail.items.length === 0 && /not connected/.test(none.mail.note), none.mail);
const boom = await C.agenda({ PERSONAL: { prepare: () => { throw new Error("no table"); } } }, { calendar: async () => { throw new Error("x"); } }, st);
ok("errors degrade to notes, not exceptions", boom.calendar.state === "unreachable" && !!boom.mail.note, boom);

if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
