// DASHBOARD-FULL-ACCESS-1 offline suite (qnfo-fleet-dashboard 1.31.0). Proves: a model leg that qnfo-ai refuses with 401
// (the binding lost its props after a dashboard secret edit, 2026-10-12) or 5xx runs the same Workers AI model through the
// direct AI binding and answers; a timeout is not retried there; the console reads the inbox (list, search, one message in
// full) only with the owner's session; identity is readable and never writable from the console; wrangler.toml declares the
// AI binding and the new service bindings with props.caller.
// Run: node qnfo-fleet-dashboard/full-access.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error("cut " + a); return src.slice(i, j); };

ok(/\[ai\]\s*binding = "AI"/.test(toml), "wrangler.toml declares the direct AI binding");
for (const [b, s] of [["SVC_QNFO_EMAIL", "qnfo-email"], ["SVC_QNFO_CLOUD_OPS", "qnfo-cloud-ops"], ["SVC_QNFO_FLEET_CONTROL", "qnfo-fleet-control"]]) {
  ok(new RegExp('binding = "' + b + '"\\s*service = "' + s + '"\\s*environment = "production"\\s*props = \\{ caller = "qnfo-fleet-dashboard" \\}').test(toml), b + " is declared with props.caller");
  ok(new RegExp('"' + s + '": "' + b + '"').test(src), "CON_SVC routes call " + s + " through " + b);
}
ok(/mail \[word\|id\]/.test(src), "help lists the mail command");

// --- model legs ---
const race = cut("var ASK_MODELS = ", "async function sha256hex(").replace("var ASK_HEDGE_MS = 4e3;", "var ASK_HEDGE_MS = 150;")
  + "\n" + cut("// One model call with a real abort", "// One plain-English answer: models raced");
const mk = () => { const sb = { AbortController, setTimeout, clearTimeout, Date, JSON, Math, String, Promise, Array, Object, Error, Number }; vm.createContext(sb);
  vm.runInContext(race + "\n__f = { cmdRaceModels, cmdModelCall };", sb); return sb.__f; };
const resp = (status, content) => ({ ok: status === 200, status, json: async () => ({ choices: [{ message: { content } }] }) });
{
  const f = mk(), runs = [];
  const env = { SVC_QNFO_AI: { fetch: async () => resp(401, "") }, AI: { run: async (id, inp) => { runs.push({ id, inp }); return { choices: [{ message: { content: "direct answer" } }] }; } } };
  const r = await f.cmdRaceModels(env, [{ role: "user", content: "q" }], 5000);
  ok(r.ok && r.text === "direct answer" && /\(direct\)$/.test(r.model), "a 401 from qnfo-ai is answered by the same model over the direct binding", r);
  ok(runs[0] && runs[0].id === "@cf/zai-org/glm-5.3-flash" && runs[0].inp.reasoning_effort === "low" && runs[0].inp.max_tokens === 700, "the direct leg keeps the model, low effort and the 700-token bound", runs[0]);
}
{
  const f = mk();
  const env = { SVC_QNFO_AI: { fetch: async () => resp(503, "") }, AI: { run: async () => ({ response: "legacy shape" }) } };
  const r = await f.cmdModelCall(env, "gpt-oss-120b", [{ role: "user", content: "q" }], 3000);
  ok(r.ok && r.text === "legacy shape", "a 5xx falls through too, and the { response } shape is read", r);
}
{
  const f = mk();
  const env = { SVC_QNFO_AI: { fetch: async () => resp(401, "") }, AI: { run: async () => { throw new Error("AiError: capacity"); } } };
  const r = await f.cmdModelCall(env, "glm-5.3-flash", [{ role: "user", content: "q" }], 3000);
  ok(!r.ok && /http 401; direct: AiError: capacity/.test(r.error), "when both paths fail, the error names both", r);
}
{
  const f = mk(); let called = 0;
  const env = { SVC_QNFO_AI: { fetch: async () => resp(401, "") } };
  const r = await f.cmdModelCall(env, "glm-5.3-flash", [{ role: "user", content: "q" }], 3000);
  ok(!r.ok && /no direct AI binding/.test(r.error), "without the AI binding the refusal is reported plainly", r);
  const env2 = { SVC_QNFO_AI: { fetch: async () => resp(400, "") }, AI: { run: async () => { called++; return "x"; } } };
  const r2 = await f.cmdModelCall(env2, "glm-5.3-flash", [{ role: "user", content: "q" }], 3000);
  ok(!r2.ok && called === 0, "a 400 (a bad request, not a refusal) is not retried on the direct path", r2);
}

// --- console: mail and identity ---
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE emails (id INTEGER PRIMARY KEY, sender TEXT, recipient TEXT, subject TEXT, received_at TEXT, status TEXT, classification TEXT, headers_json TEXT, body_text TEXT);
INSERT INTO emails VALUES (7, 'Editor <editor@theresearchletters.org>', 'rwnquni@qnfo.org', 'Invitation to review', '2026-10-12T08:00:00Z', 'received', 'person', '{}', 'Dear Dr Quni,\n\nWe invite you to review a manuscript. ' || printf('%.7000c', 'x'));
INSERT INTO emails VALUES (8, 'alerts@qnfo.org', 'rwnquni@qnfo.org', 'internal', '2026-10-12T09:00:00Z', 'processed', NULL, '{}', 'tick');`);
const D1 = { prepare(sql) { const st = db.prepare(sql); let args = []; const o = { bind(...a) { args = a; return o; }, async all() { return { results: st.all(...args) }; }, async first() { return st.get(...args) || null; }, async run() { const r = st.run(...args); return { meta: { changes: r.changes } }; } }; return o; } };
const con = cut("const D1_PRIMARY_ONLY", "__name(d1all") + "\n" + cut("var CON_DBS = ", "var CON_MAX_ROWS")
  + "\n" + cut("function conIsOwner(owner) {", "// SQL text with string literals") + "\n" + cut("// DASHBOARD-FULL-ACCESS-1 (1.31.0): the inbox", "// Action commands: the same shape")
  + "\nasync function conSqlRead() { return { ok: true, text: 'read' }; }\nasync function conLogs() { return { text: 'logs' }; }\nfunction conDbOf(w) { w = String(w || '').toLowerCase(); return CON_DBS[w] ? w : null; }"
  + "\n" + cut("async function conSqlWrite(", "async function conFirst(");
const sb = { JSON, Math, String, Number, Promise, Array, Object, Error, RegExp, Date }; vm.createContext(sb);
vm.runInContext(con.replace(/async function conIssue[\s\S]*?(?=async function conRead)/, "") + "\n__c = { conRead, conSqlWrite, CON_DBS };", sb);
const C = sb.__c, env = { AUDIT: D1, IDENTITY: D1 }, owner = { session: { stepup: false } };
{
  const r = await C.conRead(env, "mail", {}, null);
  ok(r && r.ok === false && r.need === "code" && !/Invitation/.test(JSON.stringify(r)), "a visitor gets the sign-in prompt and no mail content", r);
  const l = await C.conRead(env, "mail", {}, owner);
  ok(/#7 .*editor@theresearchletters\.org.*Invitation to review/.test(l.text) && !/alerts@qnfo\.org/.test(l.text), "mail lists inbound messages, the fleet's own mail left out", l.text);
  const s = await C.conRead(env, "mail theresearchletters", {}, owner);
  ok(/#7/.test(s.text) && s.actions[0].cmd === "mail 7", "mail <word> searches and offers to open each one", s);
  const one = await C.conRead(env, "inbox 7", {}, owner);
  ok(/Subject: Invitation to review/.test(one.text) && /We invite you to review a manuscript/.test(one.text) && one.text.length > 5000 && one.text.length < 6600, "mail <id> reads the message in full (up to 6000 characters)", one.text.length);
  ok(one.actions[0].cmd === "draft a reply to message #7" && one.actions[0].label === "Reply" && one.actions[1].cmd === "spam 7" && one.actions[2].cmd === "mail theresearchletters.org", "the reader offers Reply (a complete draft, MAIL-REPLY-INSTRUCTION-1), Spam and more from the sender", one.actions);
}
{
  ok(sb.__c.CON_DBS.q08 === "Q08" && sb.__c.CON_DBS.identity === "IDENTITY", "sql reads q08 and identity");
  const w = await C.conSqlWrite(env, "identity", "UPDATE owner_docs SET body = 'x' WHERE key = 'identity'");
  ok(w.ok === false && /read-only/.test(w.error), "identity is never written from the console", w);
  const r = await C.conRead(env, "sql identity select key from owner_docs", {}, null);
  ok(r && r.need === "code", "reading identity needs the owner's code", r);
}
// --- MAIL-ASK-1: questions about mail reach the message text; journal call-for-paper mail is a solicitation ---
{
  const sb2 = { RegExp, String }; vm.createContext(sb2);
  vm.runInContext(cut("var MAIL_SOLICIT_RX = ", "var MAIL_NO_CARD") + "\n" + cut("var MAIL_ASK_RX = ", "async function mailAskFacts(") + "\n__m = { MAIL_SOLICIT_RX, MAIL_ASK_RX, MAIL_FOLLOWUP_RX, mailDomainNamed };", sb2);
  const M = sb2.__m;
  const subj = "We Invite Your Research Article for Upcoming Issue: International Journal of Quantum Technologies";
  const body = 'Dear Dr. Rowan Brad Quni-Gudzinas,\r\n\r\nYour posted article: "Dimensionless Physics: A Unified Framework" fits for\r\nour journal scope.\r\n\r\nGreetings from our esteemed International Journal of Quantum Technologies\r\nISSN: 3068-9090 database.\r\n\r\nEasy to contribute: submit your full-length article to this mail as an\r\nattachment before October 27th, 2026';
  ok(M.MAIL_SOLICIT_RX.test(subj) && M.MAIL_SOLICIT_RX.test(body), "emails 989/990 (theresearchletters.org call for papers) read as a solicitation, by subject and by body");
  for (const real of ["Could you look at my paper draft before Friday?", "I would like to invite your group to collaborate on a grant", "Re: your article on emergent gravity - a question about eq. 4", "Thank you for the talk; can we meet next week?"]) ok(!M.MAIL_SOLICIT_RX.test(real), "a person's mail stays a person: " + real);
  ok(M.MAIL_ASK_RX.test("WHAT'S UP WITH RESEARCHLETTERS EMAILS?"), "plural 'emails' is a mail question (the 2026-10-12 miss)");
  ok(M.mailDomainNamed("WHAT'S UP WITH RESEARCHLETTERS EMAILS?", "theresearchletters.org") && !M.mailDomainNamed("what about letters", "theresearchletters.org"), "a typed name without the 'the' or the TLD finds the card's domain");
  ok(M.MAIL_ASK_RX.test("AND WHAT DO THEY SAY? DON'T WASTE MY TIME HERE!") && M.MAIL_FOLLOWUP_RX.test("AND WHAT DO THEY SAY?"), "the follow-up 'and what do they say?' reads the mail cards");
  ok(/body_text = mailBodyHead\(f\.body, 1500\)/.test(src) && /substr\(COALESCE\(body_text, ''\), 1, 1600\) AS body_head FROM emails WHERE \(lower\(sender\)/.test(src), "the owner's Ask context carries up to 1500 characters of each message");
}
// --- INBOX-REPLY-1: the owner replies and marks spam from the dashboard ---
{
  const db2 = new DatabaseSync(":memory:");
  db2.exec(`CREATE TABLE emails (id INTEGER PRIMARY KEY, sender TEXT, recipient TEXT, subject TEXT, headers_json TEXT, status TEXT, body_text TEXT);
  CREATE TABLE email_reply_queue (id INTEGER PRIMARY KEY, email_id INTEGER, decision TEXT, sent_at TEXT, updated_at TEXT, skip_reason TEXT);
  CREATE TABLE email_sender_policy (id INTEGER PRIMARY KEY AUTOINCREMENT, pattern TEXT, kind TEXT, auto_reply_ok INTEGER, note TEXT);
  INSERT INTO emails VALUES (984, 'kottevarun@gmail.com', 'rowan.quni@qnfo.org', 'Your router_calibrate.py in qnfo-workers', '{}', 'processed', 'Hi Rowan');
  INSERT INTO emails VALUES (989, 'parker.knight@theresearchletters.org', 'rowan.quni@qnfo.org', 'We Invite Your Research Article', '{}', 'processed', 'x');
  INSERT INTO emails VALUES (990, 'parker.knight@theresearchletters.org', 'rowan.quni@qnfo.org', 'We Invite Your Research Article', '{}', 'processed', 'x');
  INSERT INTO emails VALUES (5, 'alerts@qnfo.org', 'qnfo@qnfo.org', 'tick', '{}', 'processed', 'x');
  INSERT INTO email_reply_queue VALUES (63, 984, 'escalate', NULL, NULL, 'x'), (65, 989, 'skip', NULL, NULL, 'x'), (66, 990, 'held', NULL, NULL, 'x');`);
  const D = { prepare(sql) { const st = db2.prepare(sql); let a = []; const o = { bind(...x) { a = x; return o; }, async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a) || null; }, async run() { const r = st.run(...a); return { meta: { changes: r.changes } }; } }; return o; } };
  const sent = [];
  const svc = { fetch: async (u, o) => { sent.push({ u, b: JSON.parse(o.body) }); db2.prepare("UPDATE emails SET status = 'replied' WHERE id = ?").run(JSON.parse(o.body).reply_to_id); return { ok: true, status: 200, json: async () => ({ success: true }) }; } };
  const code = cut("// INBOX-REPLY-1 (1.31.0", "// Read commands. Returns null") + "\n" + cut("const D1_PRIMARY_ONLY", "__name(d1all") + "\n" + cut("function conClip(s, n) {", "function conCmd(") + "\nasync function mailFacts() { return [{}]; }\n__r = { conMailReply, conMailSpam };";
  const sb3 = { JSON, Math, String, Number, Promise, Array, Object, Error, RegExp, Date, AbortSignal }; vm.createContext(sb3); vm.runInContext(code, sb3);
  const R = sb3.__r;
  const r1 = await R.conMailReply({ AUDIT: D, SVC_QNFO_EMAIL: svc }, 984, "Thank you, happy to help. Send me the draft.");
  ok(r1.ok && sent[0].b.to === "kottevarun@gmail.com" && sent[0].b.from === "rowan.quni@qnfo.org" && sent[0].b.subject === "Re: Your router_calibrate.py in qnfo-workers" && sent[0].b.reply_to_id === 984 && /\/send$/.test(sent[0].u), "reply sends through qnfo-email /send as the address it was written to, Re: subject, original marked", sent[0]);
  ok(db2.prepare("SELECT decision FROM email_reply_queue WHERE id = 63").get().decision === "sent" && db2.prepare("SELECT status FROM emails WHERE id = 984").get().status === "replied", "the queue row closes as sent and the message is replied");
  const r2 = await R.conMailReply({ AUDIT: D }, 989, "hello");
  ok(!r2.ok && /binding is not installed/.test(r2.error) && sent.length === 1, "without the binding nothing is sent and it says so", r2);
  const r3 = await R.conMailReply({ AUDIT: D, SVC_QNFO_EMAIL: svc }, 5, "hello");
  ok(!r3.ok && /fleet address/.test(r3.error) && sent.length === 1, "fleet mail is never replied to", r3);
  const r4 = await R.conMailSpam({ AUDIT: D }, [989, 990]);
  ok(r4.ok && db2.prepare("SELECT COUNT(*) n FROM emails WHERE id IN (989, 990) AND status = 'spam'").get().n === 2 && db2.prepare("SELECT decision FROM email_reply_queue WHERE id = 66").get().decision === "skip" && db2.prepare("SELECT COUNT(*) n FROM email_sender_policy WHERE pattern = 'parker.knight@theresearchletters.org' AND kind = 'junk'").get().n === 1, "spam marks both, closes the held row and adds the sender to the junk policy once", r4);
  ok(/var CON_OPS = [\s\S]*mailreply: \{ destructive: true/.test(src), "sending in the owner's name needs a fresh code (destructive)");
  ok(/data-fleet-cmd="draft a reply to message #' \+ Math\.max/.test(src) && /closest\('\[data-fleet-cmd\]'\)/.test(src) && !/Open the qnfo inbox and reply/.test(src), "inbox cards carry Reply, Read and Spam; the card no longer sends the owner elsewhere");
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
