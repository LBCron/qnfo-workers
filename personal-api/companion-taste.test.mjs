// personal-api/companion-taste.test.mjs (COMPANION-TASTE-1, COMPANION-FAST-CAPTURE-1, COMPANION-VOICE-1, COMPANION-HOME-1; pillar personal)
// Thumbs up/down on every line of Today: a thumbs-down hides the line everywhere and for good, taste ranks and filters suggestions,
// a vote can be taken back, the votes are in export/delete, capture answers before it sorts, and the page carries the one-screen home.
// Run: node personal-api/companion-taste.test.mjs
import { DatabaseSync } from "node:sqlite";
import * as C from "./companion.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
function d1(db) {
  return { prepare(sql) { let args = []; const api = {
    bind(...a) { args = a.map((x) => (x === undefined ? null : x)); return api; },
    async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async first() { return db.prepare(sql).get(...args) ?? null; } }; return api; } };
}
const raw = new DatabaseSync(":memory:");
const r2 = new Map();
const env = { PERSONAL: d1(raw), MEDIA: { async put(k, v) { r2.set(k, v); }, async get(k) { return r2.has(k) ? { body: r2.get(k) } : null; } } };
await C.ensureSchema(env.PERSONAL);

console.log("[pure taste]");
ok("fbKey normalises case and punctuation", C.fbKey("  Jazz Night @ Bimhuis! ") === "jazz night bimhuis");
ok("tokens drop short and common words", JSON.stringify(C.tasteTokens("The Jazz night at 8")) === '["jazz","night"]');
const rows = [{ key: C.fbKey("Jazz night Bimhuis"), kind: "radar", label: "Jazz night Bimhuis", vote: -1 }, { key: C.fbKey("Jazz brunch"), kind: "radar", label: "Jazz brunch", vote: -1 }, { key: C.fbKey("Chess club"), kind: "radar", label: "Chess club", vote: 1 }];
const items = [{ title: "Jazz night Bimhuis" }, { title: "Jazz festival weekend" }, { title: "Quiet walk" }, { title: "Chess club" }, { title: "Chess puzzles evening" }];
const radar = C.applyTaste(items, rows, (e) => e.title, { suggest: true }).map((e) => e.title);
ok("an exact thumbs-down is gone, a 2-vote leaning drops lookalikes", !radar.includes("Jazz night Bimhuis") && !radar.includes("Jazz festival weekend"), radar);
ok("liked and lookalikes rank first", radar[0] === "Chess club" && radar.indexOf("Chess puzzles evening") < radar.indexOf("Quiet walk"), radar);
const plan = C.applyTaste([{ title: "Jazz festival weekend" }, { title: "Dentist" }], rows, (e) => e.title);
ok("calendar lines are only hidden on an exact thumbs-down, never reordered or dropped by taste", plan.length === 2 && plan[0].title === "Jazz festival weekend");

console.log("[api]");
ok("bad kind refused", (await C.recordFeedback(env, { kind: "x", label: "a", vote: 1 })).ok === false);
ok("bad vote refused", (await C.recordFeedback(env, { kind: "event", label: "a", vote: 5 })).ok === false);
raw.prepare("INSERT INTO tasks (id, ts, title, status, source) VALUES ('t1', '2026-11-04T08:00:00Z', 'Renew parking permit', 'open', 'companion')").run();
const down = await C.recordFeedback(env, { kind: "todo", label: "Renew parking permit", vote: -1, id: "t1" });
ok("thumbs-down is stored", down.ok && down.disliked === 1);
ok("a disliked to-do leaves the open list", raw.prepare("SELECT status FROM tasks WHERE id='t1'").get().status === "dropped");
const filtered = await C.tasteFilterToday(env, { next_actions: [{ id: "t1", title: "Renew parking permit" }, { id: "t2", title: "Call mum" }], one_thing: { id: "t1", title: "Renew parking permit" }, agenda: { today: [{ title: "Standup" }], soon: [], radar: [{ title: "Chess club" }], mail: { items: [] } } });
ok("Today drops the disliked to-do and the one-thing falls to the next", filtered.next_actions.length === 1 && filtered.one_thing && filtered.one_thing.id === "t2", filtered);
await C.recordFeedback(env, { kind: "event", label: "Standup", vote: -1 });
const f2 = await C.tasteFilterToday(env, { next_actions: [], agenda: { today: [{ title: "Standup" }, { title: "Dentist" }], soon: [], radar: [], mail: { items: [] } } });
ok("a disliked calendar line is hidden, the rest stays", f2.agenda.today.length === 1 && f2.agenda.today[0].title === "Dentist");
const back = await C.recordFeedback(env, { kind: "todo", label: "Renew parking permit", vote: 0, id: "t1" });
ok("taking the vote back restores the to-do", back.ok && raw.prepare("SELECT status FROM tasks WHERE id='t1'").get().status === "open");
await C.recordFeedback(env, { kind: "radar", label: "Chess club", vote: 1 });
const sum = await C.tasteSummary(env);
ok("summary lists likes, dislikes and the words it leans on", sum.liked.length === 1 && sum.disliked.length === 1 && sum.leaning_to.includes("chess") && sum.leaning_away_from.includes("standup"), sum);
ok("votes are in the privacy export list and deletable", C.PRIVACY_TABLES.some((t) => t.table === "cmp_feedback"));

console.log("[http]");
const bg = []; const ctx = { waitUntil(p) { bg.push(p); } };
const hdeps = { auth: async (r) => r.headers.get("Authorization") === "Bearer k", version: "t", doStub: () => ({ fetch: async () => new Response("{}") }) };
const post = (path, body) => C.handleCompanion(new Request("https://x/companion/api/" + path, { method: "POST", headers: { Authorization: "Bearer k", "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, ctx, hdeps);
const r1 = await post("feedback", { kind: "mail", label: "Newsletter", vote: -1 });
ok("POST /feedback needs the key and answers", r1.status === 200 && (await r1.json()).ok);
ok("feedback without a key is refused", (await C.handleCompanion(new Request("https://x/companion/api/feedback", { method: "POST", body: "{}" }), env, ctx, hdeps)).status === 401);
const cap = await (await post("capture", { text: "I want to end it all" })).json();
ok("a risk note still gets the fixed lines in the same reply, before sorting", cap.ok && cap.sorting === true && cap.processed && cap.processed.crisis, cap);

console.log("[page]");
const html = C.PAGE_HTML;
ok("quick-add bar with voice and photo sits above Today", /id="composer"[\s\S]*id="qc-mic"[\s\S]*id="qc-img"[\s\S]*id="v-today"/.test(html));
ok("on-device speech recognition with a local-processing request", html.includes("SpeechRecognition") && html.includes("processLocally"));
ok("thumbs on events, to-dos, suggestions, mail and nudges", ["'event'", "'radar'", "'todo'", "'mail'", "'nudge'"].every((k) => html.includes("thumbs(" + k) || html.includes("kind||" + k) || html.includes("'" + k.slice(1, -1) + "'")) && html.includes("/companion/api/feedback"));
ok("More keeps secondary tabs behind one button", html.includes('id="nav-more"') && /class="sec"/.test(html));
ok("taste pane on the Data tab", html.includes('id="taste"') && html.includes("Take back"));
console.log("[photo]");
{
  let visionCalls = 0;
  const pdeps = Object.assign({}, hdeps, { vision: async () => { visionCalls++; return { ok: true, text: "What it is: a parking permit letter" }; }, llm: async () => null });
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "photo.jpg");
  fd.append("text", "Code: ABC-123");
  const res = await C.handleCompanion(new Request("https://x/companion/api/capture", { method: "POST", headers: { Authorization: "Bearer k" }, body: fd }), env, ctx, pdeps);
  const j = await res.json();
  ok("a photo is stored and answered before any vision call", j.ok && j.kind === "image" && j.sorting === true && visionCalls === 0, j);
  await Promise.all(bg.splice(0));
  const row = raw.prepare("SELECT raw_text, status FROM cmp_inbox WHERE id = ?").get(j.id);
  ok("the description is written afterwards and keeps the text the phone read", visionCalls === 1 && /Code: ABC-123/.test(row.raw_text) && /parking permit/.test(row.raw_text) && row.status === "processed", row);
}
ok("page shrinks and reads photos on the phone", C.PAGE_HTML.includes("prepImage") && C.PAGE_HTML.includes("TextDetector") && C.PAGE_HTML.includes("BarcodeDetector") && C.PAGE_HTML.includes("1280"));
ok("manifest has voice, photo and note shortcuts and the page opens them", C.MANIFEST.shortcuts.length >= 3 && ["#voice", "#photo", "#note"].every((h) => C.MANIFEST.shortcuts.some((x) => x.url === "/companion" + h)) && C.PAGE_HTML.includes("h==='voice'"));
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
