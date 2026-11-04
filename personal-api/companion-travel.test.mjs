// personal-api/companion-travel.test.mjs (COMPANION-TRAVEL-TZ-1, agent_issues 100199, pillar personal)
// While a lodging row covers now, the companion's day (quiet hours, check-in windows, day keys) runs in that place's zone.
// Run: node personal-api/companion-travel.test.mjs
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
const mk = async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE events (id TEXT PRIMARY KEY, category TEXT, title TEXT, venue TEXT, city TEXT, country TEXT, start_date TEXT, end_date TEXT, energy INTEGER, energy_label TEXT)");
  const env = { PERSONAL: d1(raw) };
  await C.ensureSchema(env.PERSONAL, true);
  let n = 0;
  const stay = (city, country, start, end, cat) => raw.prepare("INSERT INTO events (id, category, title, city, country, start_date, end_date) VALUES (?,?,?,?,?,?,?)").run("e" + (++n), cat || "lodging", "Stay in " + city, city, country, start, end);
  return { raw, env, stay };
};
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

console.log("\n[the zone table]");
{
  const bad = [];
  for (const [k, v] of Object.entries(Object.assign({}, C.COUNTRY_TZ, C.CITY_TZ))) { try { new Intl.DateTimeFormat("en-US", { timeZone: v }); } catch (e) { bad.push(k + "=" + v); } }
  ok("every zone in the tables is a real IANA zone", bad.length === 0, bad);
  ok("a country with one zone: Nepal, Thailand, Japan, India, Portugal", C.placeTz("Pokhara", "NP") === "Asia/Kathmandu" && C.placeTz("Bangkok", "TH") === "Asia/Bangkok" && C.placeTz("", "jp") === "Asia/Tokyo" && C.placeTz("Goa", "IN") === "Asia/Kolkata" && C.placeTz("Lisbon", "PT") === "Europe/Lisbon");
  ok("a country name works as well as the two-letter code", C.placeTz("", "Thailand") === "Asia/Bangkok" && C.placeTz("", "United Kingdom") === "Europe/London");
  ok("a country with several zones needs a known city", C.placeTz("New York", "US") === "America/New_York" && C.placeTz("Los Angeles", "US") === "America/Los_Angeles" && C.placeTz("Perth", "AU") === "Australia/Perth" && C.placeTz("Sydney", "AU") === "Australia/Sydney" && C.placeTz("Ubud", "ID") === "Asia/Makassar");
  ok("an unknown place in such a country is null, never a guess", C.placeTz("Smalltown", "US") === null && C.placeTz("", "AU") === null && C.placeTz("Omsk-ish", "RU") === null);
  ok("a city beats its country (Canary Islands, Azores)", C.placeTz("Tenerife", "ES") === "Atlantic/Canary" && C.placeTz("Ponta Delgada", "PT") === "Atlantic/Azores");
  ok("accents and a trailing region do not matter", C.placeTz("São Paulo", "BR") === "America/Sao_Paulo" && C.placeTz("Kraków, Lesser Poland", "PL") === "Europe/Warsaw");
  ok("junk is null", C.placeTz("", "") === null && C.placeTz(null, null) === null && C.placeTz("Atlantis", "XX") === null);
}

console.log("\n[which stay covers now (pure)]");
{
  const rows = [{ city: "Bangkok", country: "TH", start_date: "2026-10-12", end_date: "2026-10-16" }];
  ok("a night in the stay covers it, in the stay's own zone", C.stayAt(rows, "2026-10-14T03:30:00Z") && C.stayAt(rows, "2026-10-14T03:30:00Z").tz === "Asia/Bangkok");
  ok("Bangkok past midnight counts: 18:00Z on the 15th is 01:00 on the 16th there, check-out morning still covers", !!C.stayAt(rows, "2026-10-15T18:00:00Z"));
  ok("check-out day before noon still covers, after noon does not", !!C.stayAt(rows, "2026-10-16T04:00:00Z") && C.stayAt(rows, "2026-10-16T06:00:00Z") === null);
  ok("before check-in it does not", C.stayAt(rows, "2026-10-11T12:00:00Z") === null);
  ok("a stay whose end is not after its start is ignored", C.stayAt([{ city: "Bangkok", country: "TH", start_date: "2026-10-14", end_date: "2026-10-14" }], "2026-10-14T05:00:00Z") === null);
  ok("an unknown place or a malformed row is ignored", C.stayAt([{ city: "Smalltown", country: "US", start_date: "2026-10-12", end_date: "2026-10-16" }, { city: "Bangkok", country: "TH", start_date: "soon", end_date: "later" }], "2026-10-14T05:00:00Z") === null);
  const two = [{ city: "Bangkok", country: "TH", start_date: "2026-10-12", end_date: "2026-10-16" }, { city: "Tokyo", country: "JP", start_date: "2026-10-16", end_date: "2026-10-20" }];
  ok("where stays meet, the later check-in wins from its day on", C.stayAt(two, "2026-10-16T02:00:00Z").tz === "Asia/Tokyo" && C.stayAt(two, "2026-10-15T08:00:00Z").tz === "Asia/Bangkok");
  ok("the place is labelled for Today", C.stayAt(rows, "2026-10-14T03:30:00Z").place === "Bangkok" && C.stayAt([{ city: "new york", country: "US", start_date: "2026-10-12", end_date: "2026-10-16" }], "2026-10-14T15:00:00Z").place === "New York");
}

console.log("\n[the day runs in the zone in force]");
{
  const { env, stay, raw } = await mk();
  const cfg = await C.loadCfg(env);
  const at = "2026-10-14T03:30:00Z";
  ok("no stay: home time", (await C.effectiveTz(env, at, cfg)).tz === cfg.tz && (await C.effectiveTz(env, at, cfg)).away === null);
  stay("Bangkok", "TH", "2026-10-12", "2026-10-16");
  const e = await C.effectiveTz(env, at, cfg);
  ok("a lodging row covering now moves the day to that place", e.tz === "Asia/Bangkok" && e.away.place === "Bangkok" && e.away.tz === "Asia/Bangkok" && e.away.until === "2026-10-16", e);
  stay("Amsterdam", "NL", "2026-10-10", "2026-10-30");
  ok("a stay at home leaves it at home (no 'times follow you' line)", (await C.effectiveTz(env, "2026-10-25T10:00:00Z", cfg)).away === null);
  ok("a travel row alone changes nothing", (await C.effectiveTz(env, "2026-10-20T10:00:00Z", cfg)).away === null);
  const st = await C.gatherState(env, at);
  ok("state: hour and day are Bangkok's (10:30 on the 14th), not Amsterdam's (05:30)", Math.abs(st.hour - 10.5) < 0.01 && st.day === "2026-10-14" && st.tz === "Asia/Bangkok" && st.away && st.away.place === "Bangkok", { hour: st.hour, day: st.day, tz: st.tz });
  const late = await C.gatherState(env, "2026-10-14T20:30:00Z");
  ok("state: 20:30Z is already the next morning there (03:30 on the 15th), where it is 22:30 at home", late.day === "2026-10-15" && Math.abs(late.hour - 3.5) < 0.01, { day: late.day, hour: late.hour });
  raw.exec("DELETE FROM events");
  const home = await C.gatherState(env, at);
  ok("state without a stay is home time again", home.away === null && home.tz === cfg.tz && home.hour < 8, { hour: home.hour });
}

console.log("\n[quiet hours and check-ins follow the traveller]");
{
  const { env, stay, raw } = await mk();
  raw.prepare("INSERT INTO cmp_push_subs (endpoint, p256dh, auth, created_at) VALUES ('https://push.example/x', 'p', 'a', '2026-10-01T00:00:00Z')").run();
  const at = "2026-10-14T03:30:00Z";
  const homePlan = await C.companionTick(env, {}, { nowIso: at, dryRun: true });
  ok("at home 03:30Z is 05:30 local: quiet hours", homePlan.plan.skip === "quiet-hours", homePlan.plan);
  stay("Bangkok", "TH", "2026-10-12", "2026-10-16");
  const away = await C.companionTick(env, {}, { nowIso: at, dryRun: true });
  ok("the same instant in Bangkok is 10:30: not quiet hours (mood check-ins are off by default, so the plan may be nothing-useful)", away.plan.skip !== "quiet-hours", away.plan);
  const night = await C.companionTick(env, {}, { nowIso: "2026-10-14T18:30:00Z", dryRun: true });
  ok("and 18:30Z is 01:30 there: quiet, though it is 20:30 at home", night.plan.skip === "quiet-hours", night.plan);
  const fixed = C.planNudge(Object.assign({}, await C.gatherState(env, "2026-10-14T16:30:00Z"), { pushReady: true }));
  ok("23:30 in Bangkok is quiet too", fixed.skip === "quiet-hours", fixed);
}

console.log("\n[day keys of what he writes]");
{
  const { env, stay, raw } = await mk();
  const base = Date.now() - 5 * 864e5;
  const d0 = ymd(base), d1_ = ymd(base + 864e5);
  stay("Bangkok", "TH", ymd(base - 3 * 864e5), ymd(base + 4 * 864e5));
  const at = d0 + "T20:30:00.000Z";
  const m = await C.recordMood(env, null, { score: 4, at });
  ok("a mood tapped at 20:30Z is filed under Bangkok's next day, not the home day", m.ok && m.day === d1_ && raw.prepare("SELECT day FROM cmp_mood WHERE id = ?").get(m.id).day === d1_, { day: m.day, d0, d1_ });
  const wb = raw.prepare("SELECT day FROM wellbeing_checkins").get();
  ok("the shared check-in row has the same day", wb.day === d1_);
  const j = await C.addJournal(env, null, { content: "a night market", at });
  ok("a journal line likewise", raw.prepare("SELECT date FROM journal WHERE id = ?").get(j.id).date === d1_);
  raw.exec("DELETE FROM events");
  const m2 = await C.recordMood(env, null, { score: 3, at: d0 + "T21:30:00.000Z" });
  ok("at home the same kind of tap keeps the home day", m2.ok && m2.day === d0, m2.day);
}

console.log("\n[Today says so]");
{
  const { env, stay, raw } = await mk();
  const t0 = await C.today(env, {});
  ok("home: no travel line data", t0.travel === null);
  stay("Bangkok", "TH", ymd(Date.now() - 2 * 864e5), ymd(Date.now() + 3 * 864e5));
  const t1 = await C.today(env, {});
  ok("abroad: Today carries the place and zone", t1.travel && t1.travel.place === "Bangkok" && t1.travel.tz === "Asia/Bangkok", t1.travel);
  const html = C.PAGE_HTML;
  ok("the page prints 'Times follow you: <place>'", /Times follow you: '\+t\.travel\.place/.test(html));
  const st = await C.gatherState(env);
  const exp = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const got = String(Math.floor(st.hour)).padStart(2, "0");
  ok("the live state hour is Bangkok's hour", exp.slice(0, 2) === got, { exp, got });
  raw.exec("DROP TABLE events");
  const t2 = await C.today(env, {});
  ok("no events table at all: home time, nothing thrown", t2.travel === null);
}

console.log("\n[worker.js parity]");
{
  const w = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  ok("worker.js carries COMPANION-TRAVEL-TZ-1 (the issue's closing probe)", w.includes("COMPANION-TRAVEL-TZ-1"));
  ok("worker.js carries the stay logic", w.includes("export const COUNTRY_TZ".replace("export ", "")) && w.includes("function stayAt(rows, atIso)"));
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
