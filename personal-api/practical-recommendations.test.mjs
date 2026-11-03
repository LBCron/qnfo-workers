// Run: node personal-api/practical-recommendations.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as C from "./companion.js";

const now = "2026-11-02T12:00:00Z";
const base = { nowIso: now, day: "2026-11-02", hour: 13, tz: "Europe/Amsterdam", pushReady: true, cfg: {}, events: [], nextActions: [] };
for (const hour of [9, 13, 20]) {
  const p = C.planNudge({ ...base, hour, mood: {}, who5Due: true, unansweredStreak: 8, daysSinceSocial: 9, weekReady: "2026-10-26" });
  assert.equal(p.skip, "nothing-useful", "No mood, reflection, survey or presence filler");
}
const event = { title: "Museum tour", where: "Main gallery", startMs: Date.parse(now) + 3600e3, endMs: Date.parse(now) + 7200e3 };
const p = C.planNudge({ ...base, events: [event] });
assert.equal(p.kind, "cmp-agenda");
assert.match(p.ask, /Museum tour at 14:00 — Main gallery/);
assert.equal(C.pushPayloadFor(p).title, "Coming up");
assert.equal(C.pushPayloadFor(p).ask, false);
assert.equal(C.planNudge({ ...base, hour: 23, events: [event] }).skip, "quiet-hours");
assert.equal(C.planNudge({ ...base, cfg: { pause_until: "2099-01-01" }, events: [event] }).skip, "paused");
assert.equal(C.planNudge({ ...base, todays: [{}, {}, {}], events: [event] }).skip, "daily-cap");
assert.equal(C.planNudge({ ...base, events: [{ ...event, startMs: Date.parse(now) - 1000 }] }).skip, "during-event");
assert.equal(C.planNudge({ ...base, recent: [{ sent_at: now }], events: [event] }).skip, "min-gap");
assert.equal(C.planNudge({ ...base, nextActions: [{ id: "due", title: "Renew pass", due: "2026-11-02" }] }).kind, "cmp-deadline");
assert.equal(C.planNudge({ ...base, nextActions: [{ title: "Someday", due: "2027-01-01" }] }).skip, "nothing-useful");
const rec = { title: "Jazz", start: "2026-11-03T19:00:00Z", where: "Hall", why: "In Sampletown; matches jazz." };
const discovery = C.planNudge({ ...base, recommendations: [rec] });
assert.equal(discovery.kind, "cmp-discovery");
assert.match(discovery.ask, /matches jazz.*Not booked/);
assert.equal(C.planNudge({ ...base, recommendations: [rec], recent: [{ ask: discovery.ask, sent_at: "2026-11-01T10:00:00Z" }] }).skip, "nothing-useful");
assert.equal(C.chatFollowUp("CHECK-IN (once today)", "Jazz at 19:00."), "Jazz at 19:00.");
assert.ok(!C.PAGE_HTML.includes("v.appendChild(moodCard(t))"));
assert.ok(!C.PAGE_HTML.includes("Tell me how you are today"));
assert.match(C.PERSONA, /Never solicit mood/);

const db = new DatabaseSync(":memory:");
const env = { PERSONAL: { prepare(sql) {
  let args = [];
  const stmt = {
    bind(...a) { args = a; return stmt; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; }
  };
  return stmt;
} } };
await C.ensureSchema(env.PERSONAL, true);
const ctx = await C.chatContext(env, { nowIso: now }, "What is happening tonight?", true);
assert.ok(!ctx.includes("CHECK-IN (once today)"));
db.prepare("INSERT INTO wellbeing_config (key, value, updated_at) VALUES ('chat_checkin_day', '\"2026-11-02\"', 'x')").run();
await C.chatContext(env, { nowIso: now }, "3", false);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cmp_mood").get().n, 0, "A stale check-in cannot reinterpret a numeric reply as a mood");
assert.match(await C.chatContext(env, { nowIso: now }, "I want to kill myself", true), /SAFETY:/);
const today = await C.today(env, {});
assert.equal(today.who5_due, false);
assert.equal(today.agenda.prompt, null);
db.close();

const source = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const begin = source.indexOf("async function eventDiscoveryContext(");
const end = source.indexOf("// JSON-EXTRACT-BALANCED-1", begin);
assert.ok(begin > 0 && end > begin);
let lastQuery;
const load = new Function("CMP", "getLastLocation", "calList", "eventRecGuard", source.slice(begin, end) + "\nreturn { eventDiscoveryContext, eventMatch, personalEventRecommendations };");
const helpers = load(C, async (e) => e.loc, async (e) => ({ events: e.calendar || [] }), async () => ({ exclude: [], budgetSpent: false }));
const profile = [{ facet: "likes", label: "Jazz", statement: "Small live jazz performances" }, { facet: "dislikes", label: "Stadium", statement: "" }];
const mock = (loc, stays = []) => ({ loc, PERSONAL: { prepare(sql) {
  lastQuery = sql;
  const rows = sql.includes("FROM events") ? stays : profile;
  return { bind() { return this; }, async all() { return { results: rows }; } };
} } });
const at = Date.parse(now);
let context = await helpers.eventDiscoveryContext(mock({ city: "Sampletown", ts: now }), at);
assert.equal(context.city, "Sampletown");
assert.equal(context.location_source, "recent-location");
assert.ok(!lastQuery.includes("identity"), "No identity or research-plane reads");
context = await helpers.eventDiscoveryContext(mock({ city: "Oldtown", ts: "2026-10-01" }, [{ city: "Paris", country: "FR", start_date: "2026-11-01", end_date: "2026-11-04" }]), at);
assert.equal(context.city, "Paris", "A current stay replaces stale location history");
assert.equal((await helpers.eventDiscoveryContext(mock({ city: "Oldtown", ts: "2026-10-01" }), at)).city, null);
const match = (title, extra = {}) => helpers.eventMatch(context, { title, url: "https://events.example/jazz", ...extra });
assert.equal(match("Jazz in Paris").ok, true);
assert.equal(match("Jazz in Oldtown").reason, "not-local");
assert.equal(match("Football in Paris").reason, "no-personal-interest-match");
assert.equal(match("Jazz at Stadium Paris").reason, "personal-dislike");
assert.equal(match("Online jazz concert").ok, true);
assert.equal(match("Jazz in Paris", { url: "javascript:alert(1)" }).reason, "missing-source-link");
assert.equal(match("Jazz in Paris").why, "In Paris; matches Jazz.");
console.log("Practical recommendations and notification defaults passed");
