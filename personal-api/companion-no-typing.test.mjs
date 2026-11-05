// personal-api/companion-no-typing.test.mjs (COMPANION-NO-TYPING-1)
import assert from "node:assert/strict";
import fs from "node:fs";
import * as C from "./companion.js";

const today = "2026-11-04";
const u = C.aiUseSummary([{ day: today, calls: 3, neurons: 1000 }, { day: "2026-11-02", calls: 7, neurons: 9000 }], today);
assert.equal(u.today.calls, 3);
assert.equal(u.week.calls, 10);
assert.equal(u.today.usd, 0.011);
assert.equal(u.line, "AI used today: 3 times, about $0.01. This week: 10, about $0.11.");
assert.equal(C.aiUseSummary([], today).line, "AI used today: 0 times, about $0.00. This week: 0, about $0.00.");
console.log("ok   AI use is a plain number with a price");

let bound = null;
const env = { AUDIT: { prepare: (sql) => ({ bind: (d) => { bound = { sql, d }; return { all: async () => ({ results: [{ day: today, calls: 1, neurons: 0 }] }) }; } }) } };
const r = await C.aiUse(env, Date.parse(today + "T12:00:00Z"));
assert.equal(r.today.calls, 1);
assert.match(bound.sql, /worker = 'personal-api'/);
assert.equal(bound.d, "2026-10-29");
assert.equal((await C.aiUse({}, Date.now())).ok, false);
console.log("ok   AI use reads counts only, for this worker, the last seven days");

const page = C.PAGE_HTML;
for (const box of ["cap-text", "chat-in", "j-text"]) assert.ok(page.includes("dictate(this,'" + box + "')"), "Dictate beside " + box);
assert.ok(page.includes("/companion/api/dictate"));
for (const t of ["Got something done", "Went outside", "Hard day", "What can I do right now?", "Give me one thing", "Read something", "Watch something", "kind=video", "AI cost"]) assert.ok(page.includes(t), t);
console.log("ok   every words box has Dictate, journal has one-tap lines, Today asks what to do now");

const src = fs.readFileSync(new URL("./companion.js", import.meta.url), "utf8");
assert.ok(src.includes('r === "dictate" && m === "POST"') && src.includes('r === "ai-use" && m === "GET"'));
const worker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(worker.includes("COMPANION-NO-TYPING-1"));
assert.equal(worker, fs.readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8"));
console.log("ok   inlined worker carries it and the mirror matches");
