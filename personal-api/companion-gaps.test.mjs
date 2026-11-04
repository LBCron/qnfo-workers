// personal-api/companion-gaps.test.mjs (COMPANION-GAPS-1, 2026-11-04)
// Run: node personal-api/companion-gaps.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import * as C from "./companion.js";

// COMPANION-ONE-THING-PUSH-1: check-ins off, nothing due, no event: an open next action still reaches the phone once, at midday.
const now = "2026-11-04T12:00:00Z";
const base = { nowIso: now, day: "2026-11-04", hour: 13, tz: "Europe/Amsterdam", pushReady: true, cfg: {}, events: [], mood: {} };
const foam = { id: "task-foam", title: "Go to Foam", minutes: 30, energy: "medium", context: "@outside" };
const p = C.planNudge({ ...base, nextActions: [foam] });
assert.equal(p.kind, "cmp-next");
assert.equal(p.action_id, "task-foam");
assert.match(p.ask, /^One thing for now: Go to Foam \(30 min\)/);
assert.ok(!/feel|mood|how are you/i.test(p.ask), "a plain offer, not a feelings question");
assert.equal(C.pushPayloadFor(p).ask, true, "Did it / Not today buttons");
assert.equal(C.planNudge({ ...base, hour: 9, nextActions: [foam] }).skip, "nothing-useful", "not before 11:00");
assert.equal(C.planNudge({ ...base, hour: 18, nextActions: [foam] }).skip, "nothing-useful", "not after 17:00");
assert.equal(C.planNudge({ ...base, lastUserIso: "2026-11-04T11:30:00Z", nextActions: [foam] }).skip, "nothing-useful", "not while in the app");
assert.equal(C.planNudge({ ...base, actionsDoneToday: 1, nextActions: [foam] }).skip, "nothing-useful", "not after something is done");
assert.equal(C.planNudge({ ...base, todays: [{ kind: "cmp-next" }], nextActions: [foam] }).skip, "nothing-useful", "once a day");
assert.equal(C.planNudge({ ...base, retired: new Set(["cmp-next"]), nextActions: [foam] }).skip, "nothing-useful", "a retired kind stays off");
assert.equal(C.planNudge({ ...base, nextActions: [{ ...foam, due: "2027-01-01" }] }).skip, "nothing-useful", "not a future task");
assert.equal(C.planNudge({ ...base, hour: 23, nextActions: [foam] }).skip, "quiet-hours");
assert.equal(C.planNudge({ ...base, cfg: { pause_until: "2099-01-01" }, nextActions: [foam] }).skip, "paused");
console.log("ok   with check-ins off, one open thing reaches the phone once at midday");

// COMPANION-DUE-WORDS-1
assert.equal(C.dueFromWords("Go to Foam today", "2026-11-04"), "2026-11-04");
assert.equal(C.dueFromWords("call the GP tomorrow", "2026-11-04"), "2026-11-05");
assert.equal(C.dueFromWords("boodschappen vanavond", "2026-11-04"), "2026-11-04");
assert.equal(C.dueFromWords("morgen fietsen", "2026-11-30"), "2026-12-01");
assert.equal(C.dueFromWords("jazz hub Badcuyp", "2026-11-04"), "");
assert.equal(C.dueFromWords("today", "bad"), "");
console.log("ok   today / tomorrow / vandaag / morgen become a date");

// COMPANION-CAPTURE-DEDUPE-1: a repeat of the same words in 30 minutes answers with the earlier item and stores nothing.
let inserts = 0, sqls = [];
const prev = { id: "inb-prev", result_json: JSON.stringify({ type: "reference", title: "Contra — restaurant & jazz bar" }) };
const env = { PERSONAL: { prepare: (sql) => { sqls.push(sql); return { bind: (...a) => ({ first: async () => (/FROM cmp_inbox WHERE ts >= \?/.test(sql) ? prev : null), run: async () => { if (/INSERT INTO cmp_inbox/.test(sql)) inserts++; return {}; }, all: async () => ({ results: [] }) }) }; } } };
const r = await C.capture(env, {}, { text: "Contra — restaurant & jazz bar", defer: true });
assert.equal(r.duplicate, true);
assert.equal(r.id, "inb-prev");
assert.equal(r.processed.type, "reference");
assert.equal(inserts, 0);
assert.ok(sqls.some((q) => /json_extract\(result_json, '\$\.title'\)/.test(q)), "matches a just-sorted photo's title too");
console.log("ok   the same note twice is one note, with no second sorting call");

// COMPANION-VOICE-FALLBACK-1 and the cheaper twin fallback.
const page = C.PAGE_HTML;
assert.ok(!/Type it, or use/.test(page), "never asks to type");
assert.ok(page.includes("function qcRec(){") && page.includes("dictate(mic,'qc-text',capText)"), "quick-add mic falls back to recording");
const worker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(worker.includes('var TWIN_PREVIOUS = "@cf/deepseek-ai/deepseek-v4-flash-0731"'));
assert.ok(worker.indexOf('"@cf/deepseek-ai/deepseek-v4-pro-0813"\n  // 120,000') > worker.indexOf('"@cf/moonshotai/kimi-k2.6",'), "deepseek-v4-pro is the last resort");
assert.ok(worker.includes("COMPANION-ONE-THING-PUSH-1") && worker.includes("dueFromWords"));
assert.equal(worker, fs.readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8"));
console.log("ok   voice never asks to type; twin fallback is the cheaper model; mirror matches");

// COMPANION-NO-TYPING-1:do-tab and :dictate-rest (agent_issues 1001638, 1001639).
assert.ok(page.includes("dictate(this,'a-title')"), "Do tab: Dictate for the title");
for (const t of ["Tidy one surface", "10-minute walk", "Reply to one message", "One Quniverse task"]) assert.ok(page.includes(">" + t + "</button>"), "preset " + t);
assert.ok(page.includes("setMin(this,5)") && page.includes("setMin(this,15)") && page.includes("setMin(this,30)") && !page.includes('id="a-min" aria-label="Minutes" type="number"'), "minutes are 5/15/30 buttons");
assert.ok(page.includes("dictate(this,'c-front')") && page.includes("dictate(this,'c-back')"), "Learn card has Dictate");
assert.ok(page.includes("dictateLine(this,'sp-'+f[0])"), "each safety-plan field has Dictate");
console.log("ok   Do tab, Learn cards and the safety plan need no typing");

// COMPANION-NO-TYPING-1:shortcut (agent_issues 1001642): a home-screen shortcut opens Focus.
assert.ok(C.MANIFEST.shortcuts.some((x) => x.url === "/companion#focus"));
assert.ok(page.includes("if(h==='focus'){history.replaceState(null,'','/companion');go('focus');return}"));
console.log("ok   a home-screen shortcut opens Focus");

// COMPANION-CLARIFY-SHORT-1: short verb-first notes and bare replies are sorted without a model.
let llmCalls = 0;
const deps = { llm: async () => { llmCalls++; return '{"type":"reference","title":"x"}'; } };
assert.equal((await C.clarify({}, deps, "Go to Foam today")).type, "action");
assert.equal((await C.clarify({}, deps, "Thank you.")).type, "trash");
assert.equal((await C.clarify({}, deps, "Yes.")).by, "rules");
assert.equal(llmCalls, 0, "no model call for short notes");
await C.clarify({}, deps, "So I want a command line for my personal companion that captures everything");
assert.equal(llmCalls, 1, "longer notes still go to the sorter");
console.log("ok   short notes and bare replies cost no AI call");

// COMPANION-SELFCHECK-1 and COMPANION-TO-FLEET-1 on a real SQLite database.
{
  const { DatabaseSync } = await import("node:sqlite");
  const mk = (raw) => ({ prepare: (sql) => { const st = raw.prepare(sql); const w = (b) => ({ first: async () => st.get(...b) || null, all: async () => ({ results: st.all(...b) }), run: async () => { const r = st.run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; } }); return Object.assign(w([]), { bind: (...b) => w(b) }); } });
  const p = new DatabaseSync(":memory:"), a = new DatabaseSync(":memory:");
  p.exec(`CREATE TABLE cmp_push_subs (endpoint TEXT, failures INTEGER, last_ok TEXT, last_error TEXT);
    CREATE TABLE tasks (id TEXT, status TEXT, gtd TEXT);
    CREATE TABLE companion_nudges (id INTEGER PRIMARY KEY, kind TEXT, ask TEXT, sent_at TEXT, outcome TEXT);
    CREATE TABLE cmp_inbox (id TEXT, ts TEXT, kind TEXT, raw_text TEXT, status TEXT, result_json TEXT);
    CREATE TABLE wellbeing_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    INSERT INTO cmp_push_subs VALUES ('e', 0, '2026-11-02T07:15:00Z', NULL);
    INSERT INTO tasks VALUES ('t1', 'open', 'next');
    INSERT INTO companion_nudges (kind, ask, sent_at, outcome) VALUES ('cmp-presence', 'here', '2026-11-02T06:30:00Z', '{"via":"push","subs":1,"ok":1}');
    INSERT INTO cmp_inbox VALUES ('inb-1', '2026-11-04T13:36:59Z', 'voice', 'input tokens are the cost driver for worker AI on Cloudflare', 'processed', '{"type":"project","title":"Reduce input token costs"}');`);
  a.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE issue_triage (issue_id INTEGER, triage_state TEXT, close_evidence TEXT);`);
  const env = { PERSONAL: mk(p), AUDIT: mk(a) };
  const r1 = await C.selfCheck(env, "2026-11-05T15:00:00Z");
  assert.ok(r1.filed.includes("push-silence"), "two days of silence files an issue");
  assert.ok(r1.filed.includes("fleet-asks-waiting"));
  assert.ok(!r1.filed.includes("inbox-stuck") && !r1.filed.includes("feelings-ask"));
  const r2 = await C.selfCheck(env, "2026-11-05T16:00:00Z");
  assert.equal(r2.filed.length, 0, "one issue per problem, not one per hour");
  const sent = await C.sendToFleet(env, "inb-1");
  assert.ok(sent.ok && sent.issue_id);
  const iss = a.prepare("SELECT title, description, category FROM agent_issues WHERE id = ?").get(sent.issue_id);
  assert.match(iss.title, /^OWNER-VOICE-2026-11-04:reduce-input-token-costs/);
  assert.match(iss.description, /input tokens are the cost driver/);
  assert.equal((await C.sendToFleet(env, "inb-1")).already, true, "sent once");
  p.exec("INSERT INTO companion_nudges (kind, ask, sent_at, outcome) VALUES ('cmp-next', 'One thing for now: x', '2026-11-05T16:30:00Z', '{\"via\":\"push\",\"subs\":1,\"ok\":1}')");
  for (const id of a.prepare("SELECT id FROM agent_issues").all().map((x) => x.id)) a.prepare("INSERT INTO issue_triage VALUES (?, 'triaged', NULL)").run(id);
  const r3 = await C.selfCheck(env, "2026-11-05T17:00:00Z");
  assert.ok(r3.closed.includes("push-silence") && r3.closed.includes("fleet-asks-waiting"), "recovered checks close their issues with the measurement");
  assert.match(a.prepare("SELECT close_evidence FROM issue_triage t JOIN agent_issues i ON i.id = t.issue_id WHERE i.title = 'COMPANION-SELFCHECK-1:push-silence'").get().close_evidence, /COMPANION-SELFCHECK-1 measured/);
  const src = fs.readFileSync(new URL("./companion.js", import.meta.url), "utf8");
  assert.ok(/res\.selfcheck = await selfCheck\(agent\.env\)/.test(src), "runs from the companion's own tick, hourly");
  assert.ok(page.includes("Send to the Quniverse") && page.includes("For the Quniverse"));
  console.log("ok   hourly self-check files and closes its own issues; one tap sends a dictated ask to the fleet");
}

// FOCUS-CMP-1: the page carries its own focusOptions (CMP is server-side only; Focus showed "CMP is not defined").
assert.ok(page.includes("var CMP={focusOptions:function focusOptions("), "Focus has focusOptions on the phone");
// Today does not show the next action twice (Next action card and To do list).
assert.ok(page.includes("return !(t.one_thing&&x.id===t.one_thing.id)"));
console.log("ok   Focus loads on the phone; Today lists the next action once");
assert.ok(page.includes("#toast.hide{display:none}"), "the empty toast bar is hidden");
assert.ok(page.includes("MOOD-HASH-1") && page.includes("c=moodCard(t);v.insertBefore("), "a check-in tap shows the mood scale even with prompts off");
console.log("ok   no empty toast bar; a check-in tap always has something to answer");
assert.ok(page.includes("a{display:inline-block;padding:4px 0;min-height:24px}"), "links are at least 24px tall (WCAG 2.5.8)");
