// PROBE-AUTHOR-BINDING-1 offline suite (qnfo-fleet-control, 2026-10-26, charter pillar autonomy). rtAuthorLivePathProbe (PROBE-AUTHOR-LIVEPATH-1) was written to author the probe of an
// orphan issue with one cheap Workers AI call, and it never ran: remediation.probe-authored has 0 events ever against 77 PROBE-NEEDED-1 filings in 7 days. Three independent defects, none
// reachable by an earlier test (no suite referenced the function):
//   1. it read the model from env["qnfo-ai"] || env.qnfo_ai, a binding this worker has never had (wrangler.toml declares [ai] binding AI), and returned false silently;
//   2. it read the reply only as body.response or body.result, while a chat model answers choices[0].message.content;
//   3. its decision_log insert used the columns (ts, decision, reason), which the table does not have (it requires ts, actor, assumption, action, evidence, outcome, blast_radius, rollback_path).
// PROBE-AUTHOR-HARDEN-1 (0.52.1, agent_issues 1000266) adds the second half, once the author could run: it must refuse (1) private tables, (2) self-confirming probes, (3) deferral-shaped
// probes, with an enum reason on the existing remediation.probe-author-reject event that never carries the probe text. probe-author.fixture.json holds the live qnfo-audit sqlite_master
// names (captured 2026-10-26, 603 tables, 194 views, names only) and the live definitions of the allowlisted views, so the allowlist constant is checked against the real schema and every live
// object is swept: only an allowlisted one may pass the static check.
// Review pass 2 (shipped as 0.53.3): an allowlisted table still holds free text, and a filter on cloud_ops_events kind is dodged by a wildcard, a concatenation, char() or an id pattern, so the dry run's
// expected AND observed must each be a number or one short token (letters, digits, _ . : + -, at most 64 characters), refused as private-table: free-text value; and a probe that reads no allowlisted
// object in table position, calls random() or randomblob(), or shadows an object with a CTE measures nothing and is refused.
// Review pass 3 (shipped as 0.53.3): the CTE shadow gate sees every SQLite spelling of a CTE head (a column list, AS MATERIALIZED, AS NOT MATERIALIZED, any position of the WITH list, a word, quoted or string-literal
// name), and the release note and the worker comment state the residual as it is: the value gate runs once, on the birth dry run, the hourly engine writes a later pass's expected and observed untruncated
// into remediation_verifications, and the shape gate is not a content gate (the table allowlist and the cloud_ops_events kind filter are the privacy boundary).
// Review pass 4 (0.53.3): main moved to 0.53.2 while the work was in review, so the passes ship as 0.53.3 and the note is found by its "review pass" label and compared as a minimum, not pinned to one number. The residual is
// stated with every sink the untruncated later-pass value reaches: remediation_verifications, and the runner consumer's run log, which the remediation-consumer workflow commits to main of the public repository; and
// PROBE-REVIEW-1 is not called a privacy control (it judges the definition of done only). The sink claims are checked against scripts/remediation_consumer.py and the workflow, so the text cannot drift from the code.
// Slices rtFlagOff, the reply reader, aiRunAttr and the probe-author block out of worker.js and runs them against an in-memory SQLite D1 and a fake env.AI.
// Output MUST contain "0 failed" on success.   node qnfo-fleet-control/probe-author.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
const fixture = JSON.parse(readFileSync(new URL("./probe-author.fixture.json", import.meta.url), "utf8"));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const cut = (from, to, start = 0) => { const a = src.indexOf(from, start), b = src.indexOf(to, a + from.length); if (a < 0 || b < a) throw new Error("block not found in worker.js: " + from); return src.slice(a, b); };
const live = (name) => { const m = new RegExp("var " + name + " = ([^;]+);").exec(src); if (!m) throw new Error(name + " not found"); return m[0]; };
const code = [
  cut("async function rtFlagOff(db, key) {", "async function rtCloseEventSince"),
  live("RT_LIVEPATH_MAX_PER_DAY"),
  cut("var CM_REVIEW_EFFORT =", "// A removed long line directly followed by its replacement"),
  cut("async function aiRunAttr(", "// PROMPT-CACHE-COUNT-4: one ai_cache_counters increment") + cut("function aiCacheRow(", "\n}\n", src.indexOf("function aiCacheRow(")) + "\n}\n",
  cut("var RT_PROBE_AUTHOR_MAX_PER_TICK = 3;", "var rtLivePathRetryAt = 0;"),
].join("\n");
const consoleErrors = [];
const cx = vm.createContext({ Date, Number, String, parseInt, Math, JSON, Object, Array, RegExp, isFinite, console: { error(...args) { consoleErrors.push(args); }, log() {} }, __name: (f) => f });
// the names the hardening adds are looked up one by one, so this suite still loads (and fails its own checks) against a worker that predates them
vm.runInContext(code + `
this.api = { rtAuthorLivePathProbe, setTick(k) { rtProbeAuthorTickKey = k; }, authorDailyLimit: RT_PROBE_AUTHOR_MAX_PER_DAY };
for (const n of ["rtProbeAuthorValidSql", "rtProbeAuthorFamily", "RT_PROBE_AUTHOR_ALLOW", "RT_PROBE_AUTHOR_REASONS", "RT_PROBE_AUTHOR_SELF_RE", "RT_PROBE_AUTHOR_MAX_SQL", "RT_PROBE_AUTHOR_MAX_OBSERVED"]) { try { this.api[n] = eval(n); } catch (e) { } }`, cx);
const api = cx.api;
const { rtAuthorLivePathProbe, setTick } = api;

const liveTables = fixture.tables, liveViews = fixture.views, liveObjects = liveTables.concat(liveViews);
function mk(withLiveNames) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, status TEXT DEFAULT 'open', priority TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT '', verify_probe TEXT NOT NULL DEFAULT '', verify_transport TEXT NOT NULL DEFAULT '', max_attempts INTEGER DEFAULT 3, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', last_verdict TEXT, attempts INTEGER DEFAULT 0, next_due_at TEXT, module TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE portfolio_gaps (id INTEGER PRIMARY KEY, status TEXT);
INSERT INTO portfolio_gaps VALUES (1, 'open'), (2, 'open'), (3, 'closed');`);
  if (withLiveNames) {
    // every live object name exists as a one-column table so that a probe naming it is syntactically real; sqlite_ names are the engine's own
    for (const n of liveObjects) if (!/^sqlite_/.test(n)) db.exec('CREATE TABLE IF NOT EXISTS "' + n + '" (id INTEGER)');
  }
  const stmt = (sql) => { let args = []; const self = { bind(...x) { args = x.map((v) => (v === undefined ? null : v)); return self; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async first() { return db.prepare(sql).get(...args) ?? null; }, async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; } }; return self; };
  return { db, h: { prepare: stmt } };
}
const goodProbe = "SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps WHERE status = 'open'";           // 0 expected, 2 observed: not vacuous, an operational table
const chat = (text) => ({ choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
const orphan = (db, id = 4242) => { db.prepare("INSERT INTO agent_issues (id, title, status, priority) VALUES (?, 'ORPHAN-1: portfolio gaps are not closed', 'open', 'medium')").run(id); return { id, title: "ORPHAN-1: portfolio gaps are not closed" }; };
const events = (db, kind) => db.prepare("SELECT * FROM cloud_ops_events WHERE kind = ?").all(kind);

{ // the reply in the chat shape, through the binding this worker really has: the probe is authored, recorded and logged
  const { db, h } = mk(); const o = orphan(db); setTick(1);
  const calls = [];
  const env = { AI: { run: async (model, input) => { calls.push({ model, input }); return chat(goodProbe); } }, AUDIT: h };
  const done = await rtAuthorLivePathProbe(h, env, o);
  ok(done === true, "a probe is authored through env.AI with a chat-shaped reply", done);
  ok(calls.length === 1 && /glm/.test(calls[0].model), "the cheap model is asked once", calls.map((c) => c.model));
  const c = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-4242'").get();
  ok(c && c.status === "active" && c.module === "probe-author-1" && c.verify_probe === goodProbe, "the contract holds the authored probe, active, module probe-author-1", c);
  ok(events(db, "remediation.probe-authored").length === 1, "a remediation.probe-authored event is written");
  const d = db.prepare("SELECT * FROM decision_log").all();
  ok(d.length === 1 && /4242/.test(d[0].action) && /superseded/.test(d[0].rollback_path) && d[0].actor && d[0].evidence && d[0].outcome && d[0].blast_radius, "a decision_log row is written with the table's real columns", d);
  ok(d.length === 1 && /observed: 2\)/.test(d[0].evidence) && d[0].evidence.indexOf(goodProbe) > 0, "the decision_log evidence names the observed value and the probe", d[0] && d[0].evidence);
}
{ // the reply in the legacy shape
  const { db, h } = mk(); const o = orphan(db); setTick(2);
  const env = { AI: { run: async () => ({ response: "```sql\n" + goodProbe + "\n```" }) }, AUDIT: h };
  ok((await rtAuthorLivePathProbe(h, env, o)) === true, "a legacy {response} reply is read too, fences stripped");
}
{ // the platform refuses reasoning_effort for the model: one plain retry
  const { db, h } = mk(); const o = orphan(db); setTick(3);
  const seen = [];
  const env = { AI: { run: async (m, input) => { seen.push(Object.keys(input)); if ("reasoning_effort" in input) throw new Error("unsupported parameter reasoning_effort"); return chat(goodProbe); } }, AUDIT: h };
  ok((await rtAuthorLivePathProbe(h, env, o)) === true && seen.length === 2 && !seen[1].includes("reasoning_effort"), "a refused reasoning_effort is retried plain", seen);
}
{ // the old assumption: a binding called qnfo-ai is not what this worker has, and is not consulted
  const { db, h } = mk(); const o = orphan(db); setTick(4);
  const env = { "qnfo-ai": { run: async () => chat(goodProbe) }, AUDIT: h };
  ok((await rtAuthorLivePathProbe(h, env, o)) === false, "a binding named qnfo-ai is not used");
  const ev = events(db, "remediation.probe-author-reject");
  ok(ev.length === 1 && /no-ai-binding/.test(ev[0].text), "a missing AI binding is recorded as an event, not silent", ev);
}
{ // rejections are recorded, once per issue per hour
  const { db, h } = mk(); const o = orphan(db); setTick(5);
  const vac = { AI: { run: async () => chat("SELECT 1 AS expected, 1 AS observed FROM portfolio_gaps LIMIT 1") }, AUDIT: h };
  ok((await rtAuthorLivePathProbe(h, vac, o)) === false, "a vacuous probe is rejected");
  setTick(6); await rtAuthorLivePathProbe(h, vac, o);
  const ev = events(db, "remediation.probe-author-reject");
  ok(ev.length === 1 && /vacuous/.test(ev[0].text), "the vacuous reject is one event for the hour", ev);
  const w = { AI: { run: async () => chat("WITH t AS (SELECT 1) DELETE FROM portfolio_gaps") }, AUDIT: h };
  setTick(7); ok((await rtAuthorLivePathProbe(h, w, orphan(db, 4243))) === false, "a write statement is rejected");
  ok(events(db, "remediation.probe-author-reject").some((e) => /write keyword/.test(e.text)), "the static reject names its reason");
  const cl = db.prepare("SELECT COUNT(*) n FROM remediation_contracts").get().n;
  ok(cl === 0, "no contract is written for a rejected probe", cl);
}
{ // an empty reply and a thrown error are recorded and leave the issue as it was
  const { db, h } = mk(); const o = orphan(db); setTick(8);
  ok((await rtAuthorLivePathProbe(h, { AI: { run: async () => chat("") }, AUDIT: h }, o)) === false, "an empty reply returns false");
  ok(events(db, "remediation.probe-author-reject").some((e) => /empty/.test(e.text)), "the empty reply is recorded");
  setTick(9); const o2 = orphan(db, 4244);
  ok((await rtAuthorLivePathProbe(h, { AI: { run: async () => { throw new Error("capacity"); } }, AUDIT: h }, o2)) === false, "a model error returns false");
  ok(events(db, "remediation.probe-author-reject").some((e) => /model-error/.test(e.text)), "the model error is recorded");
}
{ // the per-tick bound and the ops_config switch still hold
  const { db, h } = mk(); setTick(10);
  const env = { AI: { run: async () => chat(goodProbe) }, AUDIT: h };
  const r = []; for (const id of [5001, 5002, 5003, 5004]) r.push(await rtAuthorLivePathProbe(h, env, orphan(db, id)));
  ok(JSON.stringify(r) === "[true,true,true,false]", "three probes a tick, then the bound", r);
  setTick(11); db.prepare("INSERT INTO ops_config (key, value) VALUES ('rt_probe_author', 'off')").run();
  ok((await rtAuthorLivePathProbe(h, env, orphan(db, 5005))) === false, "ops_config rt_probe_author = off stops it");
}
{ // rejected authoring attempts consume the per-tick allowance too
  const { db, h } = mk(); setTick(12);
  let calls = 0;
  const env = { AI: { run: async () => { calls++; return chat("SELECT 1 AS expected, 1 AS observed FROM portfolio_gaps LIMIT 1"); } }, AUDIT: h };
  const outcomes = [];
  for (const id of [5101, 5102, 5103, 5104]) outcomes.push(await rtAuthorLivePathProbe(h, env, orphan(db, id)));
  ok(calls === 3 && JSON.stringify(outcomes) === "[false,false,false,false]", "three failed probes consume the tick budget before the fourth model call", { calls, outcomes });
  ok(api.authorDailyLimit === 120, "successful authored probes are limited to 120 per day", api.authorDailyLimit);
}

// ---- PROBE-AUTHOR-HARDEN-1 ----
// against a worker that predates the hardening these fall back to "nothing is private, nothing is allowlisted", so every check below fails on its own merits instead of the suite crashing
const REASONS = api.RT_PROBE_AUTHOR_REASONS || [], ALLOW = api.RT_PROBE_AUTHOR_ALLOW || [], valid = api.rtProbeAuthorValidSql, family = api.rtProbeAuthorFamily || (() => null);
ok(Array.isArray(REASONS) && JSON.stringify(Array.from(REASONS)) === JSON.stringify(["private-table", "self-confirming", "deferral-shape", "not-allowlisted", "too-long"]), "the reject reasons are the five-code enum", REASONS);
ok(typeof valid === "function" && typeof api.rtProbeAuthorFamily === "function" && Array.isArray(ALLOW) && ALLOW.length > 20, "the hardening exposes its validator, family test and allowlist");
const allow = Array.isArray(ALLOW) ? Array.from(ALLOW) : [];
const reasonOf = (bad) => { const m = /^(private-table|self-confirming|deferral-shape|not-allowlisted|too-long)\b/.exec(String(bad)); return m ? m[1] : bad; };
const live1 = mk(true);   // one database that has every live object name, for the static checks
const check = async (sql, id = 4242) => (typeof valid === "function" ? valid(live1.h, sql, id) : "validator missing");
const nameWords = (text) => (String(text).toLowerCase().match(/[a-z_][a-z0-9_]*/g) || []);
const selfRe = api.RT_PROBE_AUTHOR_SELF_RE || /(?!)/;

{ // the allowlist is a constant checked against the live schema: it cannot name a private or bookkeeping object, or one that is not there
  const liveSet = new Set(liveObjects);
  ok(liveTables.length >= 590 && liveViews.length >= 190, "the fixture mirrors the live sqlite_master (tables and views)", [liveTables.length, liveViews.length]);
  ok(new Set(allow).size === allow.length, "the allowlist has no duplicate");
  ok(allow.every((n) => liveSet.has(n)), "every allowlisted object exists in the live schema fixture", allow.filter((n) => !liveSet.has(n)));
  ok(allow.every((n) => family(n) === null), "no allowlisted object belongs to a private family", allow.filter((n) => family(n) !== null));
  ok(selfRe && allow.every((n) => !selfRe.test(n)), "no allowlisted object is the loop's own bookkeeping", selfRe && allow.filter((n) => selfRe.test(n)));
  ok(allow.every((n) => !/^sqlite_|^pragma_/.test(n)), "no engine table is allowlisted");
  const allowedViews = allow.filter((n) => liveViews.includes(n));
  ok(allowedViews.length > 0 && allowedViews.every((v) => typeof fixture.view_sql[v] === "string"), "every allowlisted view has its live definition in the fixture", allowedViews);
  for (const v of allowedViews) {
    const touched = nameWords(fixture.view_sql[v]).filter((w) => w !== v && liveSet.has(w));
    ok(touched.length > 0 && touched.every((w) => family(w) === null && !(selfRe && selfRe.test(w))), "the definition of allowlisted view " + v + " reads no private or bookkeeping object", touched);
  }
  // the families are real: many live objects are private, and each of the spec's families has at least one live (or named) member
  const privLive = liveObjects.filter((n) => family(n) !== null);
  ok(privLive.length > 100, "the private families cover more than 100 live objects", privLive.length);
  const spec = { mail: ["emails", "email_raw_archive", "event_inbox", "email_reply_queue"], message: ["social_replies", "social_threads"], contact: ["contact_ledger"], subscriber: ["subscribers", "subscriber_digest_runs"], identity: ["saas_identity_anchors"],
    owner: ["owner_codes", "owner_sessions", "owner_docs", "owner_prompts", "owner_chat_codes"], personal: ["personal_radar", "invest_facts", "ipatent_submissions", "human_responses", "human_actions", "notes_intake", "device_tasks"], credential: ["credential_registry", "deploy_tokens"],
    session: ["audit_sessions", "chat_sessions"], chat: ["chat", "chat_logs", "chatbox_conversations", "llm_gateway_log", "mcp_log", "ops_ai_log", "ask_events"], outreach: ["outreach_queue", "outreach_log"], suppression: ["email_suppression", "opt_out_list"], calendar: ["calendar", "calendar_feedback", "events", "event_prefs"], draft: ["notes_drafts", "reply_drafts"] };
  for (const f of Object.keys(spec)) for (const n of spec[f]) ok(family(n) !== null, "family " + f + ": " + n + " is private", [n, family(n)]);
  for (const f of Object.keys(spec)) ok(spec[f].some((n) => family(n) === f), "family " + f + " is named by its own label for at least one member", f);
  ok(["cloud_ops_events", "metric_registry", "portfolio_gaps", "code_tasks", "cost_daily"].every((n) => family(n) === null), "the operational objects the fleet probes are not private");
}
{ // fail closed: every live object is swept; only an allowlisted one passes the static check, every other one is refused with an enum reason
  const accepted = [], byCode = {}, wrong = [];
  for (const n of liveObjects) {
    const bad = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM " + n);
    if (bad === null) { accepted.push(n); continue; }
    const code = reasonOf(bad); byCode[code] = (byCode[code] || 0) + 1;
    if (!REASONS.includes(code)) wrong.push([n, bad]);
    if (family(n) !== null && code !== "private-table") wrong.push([n, bad]);
  }
  ok(accepted.length === allow.length && accepted.every((n) => allow.includes(n)) && allow.every((n) => accepted.includes(n)), "only the allowlisted objects pass the static check across the whole live schema", { accepted: accepted.length, allow: allow.length, extra: accepted.filter((n) => !allow.includes(n)), missing: allow.filter((n) => !accepted.includes(n)) });
  ok(wrong.length === 0, "every refused live object carries an enum reason, and a private one is private-table", wrong.slice(0, 5));
  ok((byCode["private-table"] || 0) > 100 && (byCode["self-confirming"] || 0) > 20 && (byCode["not-allowlisted"] || 0) > 100, "the sweep produces all three object reasons", byCode);
}

// the forms a table name can take in SQLite; the first group must also be real SQLite (checked below), so the bypass being closed is not a fiction
const forms = (X) => [
  ["plain", `SELECT 0 AS expected, COUNT(*) AS observed FROM ${X}`, true],
  ["upper case", `SELECT 0 AS expected, COUNT(*) AS observed FROM ${X.toUpperCase()}`, true],
  ["subquery", `SELECT 0 AS expected, (SELECT COUNT(*) FROM ${X}) AS observed FROM portfolio_gaps`, true],
  ["exists", `SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps WHERE EXISTS (SELECT 1 FROM ${X})`, true],
  ["join", `SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps g JOIN ${X} x ON x.id = g.id`, true],
  ["left join", `SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps g LEFT JOIN ${X} x ON x.id = g.id`, true],
  ["comma join", `SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps g, ${X} x`, true],
  ["comma join first", `SELECT 0 AS expected, COUNT(*) AS observed FROM ${X} x, portfolio_gaps g`, true],
  ["cte", `WITH t AS (SELECT * FROM ${X}) SELECT 0 AS expected, COUNT(*) AS observed FROM t`, true],
  ["double quoted", `SELECT 0 AS expected, COUNT(*) AS observed FROM "${X}"`, true],
  ["backtick", "SELECT 0 AS expected, COUNT(*) AS observed FROM `" + X + "`", true],
  ["bracketed", `SELECT 0 AS expected, COUNT(*) AS observed FROM [${X}]`, true],
  ["schema qualified", `SELECT 0 AS expected, COUNT(*) AS observed FROM main.${X}`, true],
  ["schema qualified quoted", `SELECT 0 AS expected, COUNT(*) AS observed FROM "main"."${X}"`, true],
  ["string literal as identifier", `SELECT 0 AS expected, COUNT(*) AS observed FROM '${X}'`, true],
  ["IN table", `SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps WHERE id IN ${X}`, true],
  ["IN string", `SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps WHERE id IN '${X}'`, true],
  ["block comment", `SELECT 0 AS expected, COUNT(*) AS observed FROM /* hidden */ ${X}`, true],
  ["line comment", `SELECT 0 AS expected, COUNT(*) AS observed FROM -- hidden\n ${X}`, true],
  ["tabs and newlines", `SELECT 0 AS expected, COUNT(*) AS observed FROM\n\t${X}`, true],
  ["apostrophe in a double-quoted alias", `SELECT 0 AS expected, (SELECT COUNT(*) AS "a'b" FROM ${X}) AS observed, 5 AS "c'd"`, true],
  ["apostrophe in a backtick alias", "SELECT 0 AS expected, (SELECT COUNT(*) AS `a'b` FROM " + X + ") AS observed, 5 AS `c'd`", true],
  ["apostrophe in a bracket alias", `SELECT 0 AS expected, (SELECT COUNT(*) AS [a'b] FROM ${X}) AS observed, 5 AS [c'd]`, true],
  ["quoted string holding a FROM", `SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps WHERE status <> 'from ${X}' OR EXISTS (SELECT 1 FROM ${X})`, true],
];
{ // the SQL really runs in SQLite for these shapes: a stricter or looser parser than the real one would make this suite a fiction
  const { db } = mk(true);
  let badForms = [];
  for (const [label, sql] of forms("emails")) { try { db.prepare(sql).all(); } catch (e) { badForms.push([label, String(e.message).slice(0, 80)]); } }
  ok(badForms.length === 0, "every table-name form tested below is accepted by SQLite itself", badForms);
}
{ // (1) PRIVACY: every private family, every form, refused as private-table before anything runs
  const reps = { mail: "emails", "mail archive": "email_raw_archive", inbox: "event_inbox", message: "social_replies", thread: "social_threads", contact: "contact_ledger", subscriber: "subscribers", identity: "saas_identity_anchors",
    owner: "owner_codes", "owner sessions": "owner_sessions", "owner docs": "owner_docs", personal: "personal_radar", credential: "credential_registry", token: "deploy_tokens", session: "chat_sessions", chat: "chat_logs", conversation: "chatbox_conversations",
    outreach: "outreach_queue", suppression: "email_suppression", calendar: "calendar", draft: "notes_drafts", invest: "invest_facts", human: "human_responses", "llm log": "llm_gateway_log" };
  const missed = [];
  for (const [fam, tbl] of Object.entries(reps)) {
    if (!liveObjects.includes(tbl)) { live1.db.exec('CREATE TABLE IF NOT EXISTS "' + tbl + '" (id INTEGER)'); }   // a family member the live schema does not have today is created for the check
    for (const [label, sql] of forms(tbl)) {
      const bad = await check(sql);
      if (reasonOf(bad) !== "private-table") missed.push([fam, tbl, label, String(bad).slice(0, 60)]);
    }
  }
  ok(missed.length === 0, "private tables of every family are refused in every form (subquery, join, comma-join, CTE, quoted, bracketed, string, comment, apostrophe tricks)", missed.slice(0, 6));
  ok(missed.length === 0 && Object.keys(reps).length >= 24, "the privacy sweep covered " + Object.keys(reps).length + " tables x " + forms("x").length + " forms");
  // a private name that does not exist is still refused as private, never reported as a missing table
  const ghost = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps, subscribers_ghost_copy");
  ok(reasonOf(ghost) === "private-table", "a private-looking name that is not in the schema is still private-table", ghost);
  // cloud_ops_events carries the rows of every loop, private families among them (live kinds: outreach, subscribers-send, owner-local-ingest, identity-weekly, secret-watch-tick, secret-change)
  for (const lit of ["kind = 'outreach'", "kind = 'outreach-learner'", "kind = 'subscribers-send'", "kind = 'owner-local-ingest'", "kind = 'identity-weekly'", "kind = 'secret-watch-tick'", "kind = 'secret-change'", "kind LIKE 'owner%'", "text LIKE '%email%'", "text LIKE '%send an email to the contact%'"]) {
    const bad = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM cloud_ops_events WHERE " + lit);
    ok(reasonOf(bad) === "private-table", "an event filter naming a private family is private-table: " + lit, bad);
  }
  const okKind = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM cloud_ops_events WHERE kind = 'workflow-failure-intake' AND ts > strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day') AND status = 'error' AND text NOT LIKE '%timeout%'");
  const okSession = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM pr_sla_state WHERE waits_on = 'session'");
  ok(okKind === null && okSession === null, "an ordinary event kind passes, and the word session in another table's filter is not an event filter", [okKind, okSession]);
  // a CTE alias that only looks private is not a table: its body is what is scanned
  const alias = await check("WITH mail_counts AS (SELECT COUNT(*) AS n FROM portfolio_gaps) SELECT 0 AS expected, n AS observed FROM mail_counts");
  ok(alias === null, "a CTE alias named like a private family is not itself a table", alias);
  // comments are skipped as SQLite skips them: an apostrophe or a private name inside one is neither a parse error nor a table read
  const cmt = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps /* it's not the emails table */");
  const cmt2 = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps -- it's the subscribers note");
  ok(cmt === null && cmt2 === null, "a comment holding an apostrophe or a private name is skipped, not parsed", [cmt, cmt2]);
  const sneaky = await check("WITH mail_counts AS (SELECT COUNT(*) AS n FROM emails) SELECT 0 AS expected, n AS observed FROM mail_counts");
  ok(reasonOf(sneaky) === "private-table", "the body of that CTE is still scanned", sneaky);
}
{ // (1b) a table that is neither private nor bookkeeping but not on the list is refused too; so are engine tables and functions
  for (const t of ["ops_config", "fleet_probe_log", "cmd_log", "worker_logs", "cf_agent_requests", "analytics_dash_records", "portfolio_health", "v_cost_forecast", "v_fleet_metrics", "tasks", "goals", "projects"]) {
    const bad = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM " + t);
    ok(reasonOf(bad) === "not-allowlisted", "an operational table off the list is not-allowlisted: " + t, bad);
  }
  for (const sql of ["SELECT 0 AS expected, COUNT(*) AS observed FROM sqlite_master", "SELECT 0 AS expected, COUNT(*) AS observed FROM sqlite_schema", "SELECT 0 AS expected, COUNT(*) AS observed FROM pragma_table_info('portfolio_gaps')", "SELECT 0 AS expected, COUNT(*) AS observed FROM main.sqlite_master"]) {
    const bad = await check(sql);
    ok(reasonOf(bad) === "not-allowlisted", "an engine table or function is not-allowlisted: " + sql.slice(46, 80), bad);
  }
  const inFn = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps WHERE status IN pragma_table_info('portfolio_gaps')");
  ok(reasonOf(inFn) === "not-allowlisted", "an engine table function in an IN clause (no FROM) is not-allowlisted", inFn);
  const hit = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps WHERE status IN (SELECT name FROM ops_config)");
  ok(reasonOf(hit) === "not-allowlisted", "an unlisted table reached through a subquery is not-allowlisted", hit);
  const prototype = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM constructor");
  const proto2 = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM __proto__");
  ok(/does not exist/.test(prototype) && /does not exist/.test(proto2), "an Object.prototype name is a missing table, not an accepted one", [prototype, proto2]);
}

{ // (2) SELF-CONFIRMING: the loop's own bookkeeping, the author's own events and module, the target's own contract class
  const cases = {
    "decision_log": "SELECT 'ok' AS expected, CASE WHEN EXISTS (SELECT 1 FROM decision_log WHERE actor LIKE '%probe-author%' AND action LIKE '%issue 4242%') THEN 'ok' ELSE 'no log' END AS observed",
    "decision_log plain": "SELECT 1 AS expected, COUNT(*) AS observed FROM decision_log WHERE action LIKE '%4242%'",
    "decision_predictions": "SELECT 0 AS expected, COUNT(*) AS observed FROM decision_predictions",
    "decision_outcomes": "SELECT 0 AS expected, COUNT(*) AS observed FROM decision_outcomes",
    "remediation_contracts": "SELECT 'active' AS expected, status AS observed FROM remediation_contracts WHERE class = 'issue-4242'",
    "remediation_contracts other class": "SELECT 0 AS expected, COUNT(*) AS observed FROM remediation_contracts WHERE status = 'failed'",
    "remediation_verifications": "SELECT 0 AS expected, COUNT(*) AS observed FROM remediation_verifications WHERE pass = 0",
    "remediation_evidence": "SELECT 0 AS expected, COUNT(*) AS observed FROM remediation_evidence",
    "v_remediation_evidence_all": "SELECT 0 AS expected, COUNT(*) AS observed FROM v_remediation_evidence_all WHERE pass = 0",
    "v_remediation_latest_per_action": "SELECT 0 AS expected, COUNT(*) AS observed FROM v_remediation_latest_per_action",
    "issue_triage": "SELECT 'closed' AS expected, close_evidence AS observed FROM issue_triage",
    "issue_lifecycle": "SELECT 0 AS expected, COUNT(*) AS observed FROM issue_lifecycle WHERE status = 'open'",
    "issue_events": "SELECT 0 AS expected, COUNT(*) AS observed FROM issue_events",
    "agent_issues count of open": "SELECT 0 AS expected, COUNT(*) AS observed FROM agent_issues WHERE status = 'open' AND title LIKE 'ORPHAN-1%'",
    "agent_issues other row": "SELECT 0 AS expected, COUNT(*) AS observed FROM agent_issues WHERE id = 4243",
    "agent_issues target status": "SELECT 'closed' AS expected, status AS observed FROM agent_issues WHERE id = 4242",
    "agent_issues tombstone": "SELECT 0 AS expected, COUNT(*) AS observed FROM agent_issues_tombstone",
    "an issues view": "SELECT 0 AS expected, COUNT(*) AS observed FROM v_issue_age",
    "work_claims": "SELECT 0 AS expected, COUNT(*) AS observed FROM work_claims",
    "closure view": "SELECT 0 AS expected, COUNT(*) AS observed FROM v_closure_relapses",
    "authored event kind": "SELECT 'ok' AS expected, CASE WHEN EXISTS (SELECT 1 FROM cloud_ops_events WHERE kind = 'remediation.probe-authored') THEN 'ok' ELSE 'none' END AS observed",
    "reject event kind": "SELECT 0 AS expected, COUNT(*) AS observed FROM cloud_ops_events WHERE kind = 'remediation.probe-author-reject'",
    "filed event kind": "SELECT 0 AS expected, COUNT(*) AS observed FROM cloud_ops_events WHERE kind='remediation.probe-needed-filed'",
    "remediation kind wildcard": "SELECT 0 AS expected, COUNT(*) AS observed FROM cloud_ops_events WHERE kind LIKE 'remediation.%'",
    "remediation kind in list": "SELECT 0 AS expected, COUNT(*) AS observed FROM cloud_ops_events WHERE kind IN ('x', 'REMEDIATION.probe-error')",
    "remediation kind prefix without the dot": "SELECT 0 AS expected, COUNT(*) AS observed FROM cloud_ops_events WHERE kind LIKE 'remediation%'",
    "event text of the author": "SELECT 0 AS expected, COUNT(*) AS observed FROM cloud_ops_events WHERE text LIKE 'issue=4242%'",
    "event text of the author, spaced": "SELECT 0 AS expected, COUNT(*) AS observed FROM cloud_ops_events WHERE text LIKE '%issue = 4243 %'",
    "event id of the author": "SELECT 0 AS expected, COUNT(*) AS observed FROM cloud_ops_events WHERE id LIKE 'par-%'",
    "event id of the filer": "SELECT 0 AS expected, COUNT(*) AS observed FROM cloud_ops_events WHERE id LIKE 'PNF-%'",
    "author module literal": "SELECT 0 AS expected, COUNT(*) AS observed FROM code_tasks WHERE model = 'probe-author-1'",
    "author module underscore": "SELECT 0 AS expected, COUNT(*) AS observed FROM code_tasks WHERE model = 'probe_author'",
    "probe-needed family": "SELECT 0 AS expected, COUNT(*) AS observed FROM code_tasks WHERE goal LIKE 'PROBE-NEEDED-1%'",
    "own contract class": "SELECT 0 AS expected, COUNT(*) AS observed FROM code_tasks WHERE goal = 'issue-4242'",
    "own contract class underscore": "SELECT 0 AS expected, COUNT(*) AS observed FROM code_tasks WHERE goal = 'Issue_4242'",
    "own contract class spaced": "SELECT 0 AS expected, COUNT(*) AS observed FROM code_tasks WHERE goal LIKE '%issue 4242%'",
    "decision_log through a join": "SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps g JOIN decision_log d ON d.id = g.id",
    "decision_log through a quoted name": 'SELECT 0 AS expected, COUNT(*) AS observed FROM "decision_log"',
    "remediation in a CTE": "WITH r AS (SELECT * FROM remediation_verifications) SELECT 0 AS expected, COUNT(*) AS observed FROM r",
  };
  const missed = [];
  for (const [label, sql] of Object.entries(cases)) { const bad = await check(sql); if (reasonOf(bad) !== "self-confirming") missed.push([label, String(bad).slice(0, 70)]); }
  ok(missed.length === 0, "self-confirming probes are refused as self-confirming (" + Object.keys(cases).length + " forms)", missed);
  // a probe about another issue's class, and a legitimate read of the event ledger, are not
  const other = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM code_tasks WHERE goal = 'issue-4243'");
  const prefix = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM code_tasks WHERE goal = 'issue-42421'");
  ok(other === null && prefix === null, "another issue's class (and a longer number that starts with the same digits) is not the target's own", [other, prefix]);
  const distinctFrom = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps WHERE status IS DISTINCT FROM 'closed' AND status IS NOT DISTINCT FROM 'open'");
  ok(distinctFrom === null, "IS DISTINCT FROM is not a table list", distinctFrom);
  const legit = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM cloud_ops_events WHERE kind = 'workflow.failed' AND ts > strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day')");
  ok(legit === null, "a read of cloud_ops_events for an ordinary kind is accepted", legit);
}

// end to end: the fake model answers a probe, the real function decides
let tickN = 100;
async function attempt(sql, { id = 4242, live = true, setup } = {}) {
  const { db, h } = mk(live); if (setup) setup(db); const o = orphan(db, id); setTick(++tickN);
  const seen = [];
  const env = { AI: { run: async (model, input) => { seen.push(input); return chat(sql); } }, AUDIT: h };
  const done = await rtAuthorLivePathProbe(h, env, o);
  return { done, db, seen, rejects: events(db, "remediation.probe-author-reject"), authored: events(db, "remediation.probe-authored"), contract: db.prepare("SELECT * FROM remediation_contracts WHERE class = ?").get("issue-" + id), log: db.prepare("SELECT * FROM decision_log").all() };
}
const refused = (r, code) => r.done === false && !r.contract && r.authored.length === 0 && r.log.length === 0 && r.rejects.length === 1 && r.rejects[0].kind === "remediation.probe-author-reject" && new RegExp("issue=\\d+ " + code + ":").test(r.rejects[0].text);
{ // a legitimate operational probe is still authored end to end, and the prompt lists operational tables only
  const r = await attempt(goodProbe);
  ok(r.done === true && r.contract && r.contract.status === "active" && r.contract.verify_probe === goodProbe && r.rejects.length === 0, "a legitimate operational probe is accepted end to end", r.rejects.map((e) => e.text));
  const prompt = r.seen.length ? r.seen[0].messages[0].content : "";
  const promptWords = nameWords(prompt);
  ok(allow.length > 0 && allow.every((n) => prompt.indexOf(n) >= 0), "the prompt lists every allowlisted object");
  const named = Array.from(new Set(promptWords.filter((w) => liveObjects.includes(w))));
  ok(named.every((w) => allow.includes(w)), "the prompt names no live object outside the allowlist, and so no private table", named.filter((w) => !allow.includes(w)));
  ok(/never start with the word pending/.test(prompt) && /at most 600 characters/.test(prompt), "the prompt asks for a non-pending observed value within 600 characters");
  ok(!/reads pending while the defect stands/.test(prompt), "the prompt no longer asks for a pending observation");
  // the rows that reach the open ledgers are bounded
  const ev = r.authored[0], dl = r.log[0];
  ok(ev && ev.text.length <= 400 && dl && dl.evidence.length < 1000, "the authored event is at most 400 characters and the decision_log evidence under 1000", [ev && ev.text.length, dl && dl.evidence.length]);
}
{ // the privacy refusal end to end, with the closing probe's wording in the event, and no probe text
  const marker = "zzmark7731";
  const sql = "SELECT 0 AS expected, (SELECT COUNT(*) FROM emails WHERE subject = 'a" + marker + "') AS observed";
  const r = await attempt(sql);
  ok(refused(r, "private-table"), "an emails probe is refused with a private-table reject event and no contract", [r.done, r.rejects.map((e) => e.text)]);
  ok(r.rejects.length === 1 && /private-table/.test(r.rejects[0].text) && r.rejects[0].text.indexOf(marker) < 0 && r.rejects[0].text.toLowerCase().indexOf("subject") < 0 && r.rejects[0].text.indexOf("SELECT") < 0, "the reject event holds the code and never the probe text", r.rejects[0] && r.rejects[0].text);
  const closing = r.db.prepare("SELECT 'ok' AS expected, CASE WHEN EXISTS (SELECT 1 FROM cloud_ops_events WHERE kind='remediation.probe-author-reject' AND ts > strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day') AND text LIKE '%private-table%') THEN 'ok' ELSE 'none' END AS observed").get();
  ok(closing.observed === "ok", "the closing probe of issue 1000266 reads ok after a private-table reject", closing);
  for (const [tbl, forms2] of [["subscribers", [1, 9, 14, 15]], ["owner_codes", [0, 4, 16]], ["chat_logs", [5, 13, 20]], ["credential_registry", [2, 10, 22]]]) {
    const fl = forms(tbl);
    for (const ix of forms2) {
      const rr = await attempt(fl[ix][1] + " /* " + marker + " */");
      ok(refused(rr, "private-table") && rr.rejects[0].text.indexOf(marker) < 0, "e2e " + tbl + " (" + fl[ix][0] + ") is refused as private-table without the probe text", rr.rejects.map((e) => e.text));
    }
  }
}
{ // the self-confirming attack of the adversarial review, end to end: the install itself must not be able to make the probe pass
  const attack = "SELECT 'ok' AS expected, CASE WHEN EXISTS (SELECT 1 FROM decision_log WHERE actor LIKE '%probe-author%' AND action LIKE '%issue 4242%') THEN 'ok' ELSE 'zzmark8842' END AS observed";
  const r = await attempt(attack);
  ok(refused(r, "self-confirming") && r.rejects[0].text.indexOf("zzmark8842") < 0, "the decision_log self-confirming probe is refused, no contract, no event text with the probe", r.rejects.map((e) => e.text));
  const kinds = await attempt("SELECT 'ok' AS expected, CASE WHEN EXISTS (SELECT 1 FROM cloud_ops_events WHERE kind = 'remediation.probe-authored') THEN 'ok' ELSE 'no' END AS observed");
  ok(refused(kinds, "self-confirming"), "the probe-authored event self-confirming probe is refused", kinds.rejects.map((e) => e.text));
  const ownClass = await attempt("SELECT 0 AS expected, COUNT(*) AS observed FROM code_tasks WHERE goal LIKE '%issue-4242%'");
  ok(refused(ownClass, "self-confirming"), "a probe on the target's own contract class is refused", ownClass.rejects.map((e) => e.text));
  const issuesRead = await attempt("SELECT 0 AS expected, COUNT(*) AS observed FROM agent_issues WHERE status = 'open'");
  ok(refused(issuesRead, "self-confirming"), "a probe that counts open issues is refused (the issue ledger is the loop's own bookkeeping)", issuesRead.rejects.map((e) => e.text));
}
{ // (3) DEFERRAL SHAPE: pending and empty observations are deferrals to rtIsDeferral, so the contract could never fail or pass
  const shapes = {
    "pending": "SELECT 'ok' AS expected, 'pending' AS observed FROM portfolio_gaps LIMIT 1",
    "pending with reason": "SELECT 'ok' AS expected, 'pending: ' || COUNT(*) || ' gaps open' AS observed FROM portfolio_gaps",
    "PENDING upper": "SELECT 'ok' AS expected, 'PENDING: 2 gaps' AS observed FROM portfolio_gaps LIMIT 1",
    "Pending mixed": "SELECT 'ok' AS expected, 'Pending - 2 gaps' AS observed FROM portfolio_gaps LIMIT 1",
    "pending then padded": "SELECT 'ok' AS expected, '   pending: 2' AS observed FROM portfolio_gaps LIMIT 1",
    "measured pending": "SELECT 'ok' AS expected, 'pending: ' || COUNT(*) || ' > 0 (target 0)' AS observed FROM portfolio_gaps WHERE status = 'open'",
    "empty string": "SELECT 'ok' AS expected, '' AS observed FROM portfolio_gaps LIMIT 1",
    "blank": "SELECT 'ok' AS expected, '   ' AS observed FROM portfolio_gaps LIMIT 1",
    "null": "SELECT 'ok' AS expected, NULL AS observed FROM portfolio_gaps LIMIT 1",
    "no observed column": "SELECT 'ok' AS expected, COUNT(*) AS n FROM portfolio_gaps",
    "no expected column": "SELECT COUNT(*) AS observed FROM portfolio_gaps",
  };
  for (const [label, sql] of Object.entries(shapes)) {
    const r = await attempt(sql);
    ok(refused(r, "deferral-shape"), "deferral shape refused: " + label, [r.done, r.rejects.map((e) => e.text), r.contract]);
  }
  const fine = await attempt("SELECT 'ok' AS expected, CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE COUNT(*) END AS observed FROM portfolio_gaps WHERE status = 'open'");
  ok(fine.done === true && fine.contract && fine.rejects.length === 0, "a probe that reads a count against ok (no pending text) is accepted", fine.rejects.map((e) => e.text));
  const word = await attempt("SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps WHERE status = 'pending'");
  ok(word.done === false && word.rejects.length === 1 && !/deferral-shape/.test(word.rejects[0].text) && /vacuous/.test(word.rejects[0].text), "the literal 'pending' in a WHERE clause is not the observed value (here the vacuity gate, not the shape gate, answers)", word.rejects.map((e) => e.text));
}
{ // too-long: a probe over 600 characters, an observed value over 200
  const base = "SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps WHERE status = 'open'";
  const exact = (base + " /* " + "x".repeat(600 - base.length - 7) + " */");
  ok(exact.length === 600, "the fixture probe is exactly 600 characters", exact.length);
  const r600 = await attempt(exact);
  ok(r600.done === true, "a probe of exactly 600 characters is accepted", r600.rejects.map((e) => e.text));
  const over = base + " /* " + "x".repeat(601 - base.length - 7) + " */";
  ok(over.length === 601, "the long probe is 601 characters", over.length);
  const r601 = await attempt(over);
  ok(refused(r601, "too-long") && r601.rejects[0].text.indexOf("xxxx") < 0, "a probe of 601 characters is refused as too-long, without its text", r601.rejects.map((e) => e.text));
  const longObs = await attempt("SELECT 'ok' AS expected, '" + "y".repeat(65) + "' AS observed FROM portfolio_gaps LIMIT 1");
  ok(refused(longObs, "too-long") && longObs.rejects[0].text.indexOf("yyyy") < 0, "an observed value over 64 characters is refused as too-long, without the value", longObs.rejects.map((e) => e.text));
  const long201 = await attempt("SELECT 'ok' AS expected, '" + "y".repeat(201) + "' AS observed FROM portfolio_gaps LIMIT 1");
  ok(refused(long201, "too-long") && long201.rejects[0].text.indexOf("yyyy") < 0, "an observed value of 201 characters is refused as too-long, without the value", long201.rejects.map((e) => e.text));
  const longExp = await attempt("SELECT '" + "y".repeat(65) + "' AS expected, COUNT(*) AS observed FROM portfolio_gaps");
  ok(refused(longExp, "too-long") && longExp.rejects[0].text.indexOf("yyyy") < 0, "an expected value over 64 characters is refused as too-long, without the value", longExp.rejects.map((e) => e.text));
  const okObs = await attempt("SELECT 'ok' AS expected, '" + "y".repeat(64) + "' AS observed FROM portfolio_gaps LIMIT 1");
  ok(okObs.done === true && okObs.log.length === 1 && okObs.log[0].evidence.indexOf("y".repeat(64)) > 0 && okObs.log[0].evidence.indexOf("y".repeat(65)) < 0, "an observed value of 64 characters is accepted and stored whole, never longer", okObs.rejects.map((e) => e.text));
  ok(api.RT_PROBE_AUTHOR_MAX_OBSERVED === 64, "the value limit is 64 characters", api.RT_PROBE_AUTHOR_MAX_OBSERVED);
}
// ---- PROBE-AUTHOR-HARDEN-1, second pass (review findings): free text out of allowlisted tables, and probes that measure nothing ----
// An allowlisted table still holds free text. These rows are what a live cloud_ops_events, code_tasks, research_queue and fleet_improvements hold (an outreach event with an address in it, an error with another).
const seedText = (db) => db.exec(`
CREATE TABLE code_tasks (id INTEGER PRIMARY KEY, goal TEXT, last_error TEXT, model TEXT);
CREATE TABLE research_queue (id INTEGER PRIMARY KEY, idea TEXT, summary TEXT, context TEXT);
CREATE TABLE fleet_improvements (id INTEGER PRIMARY KEY, title TEXT);
INSERT INTO cloud_ops_events (id, ts, kind, text, job, status) VALUES
 ('seed-1', '2026-10-26T09:00:00.000Z', 'workflow.failed', 'job build failed with a timeout', 'x', 'warn'),
 ('tok-seed', '2026-10-26T09:30:00.000Z', 'note', 'jane.doe@gmail.com', 'x', 'ok'),
 ('outr-seed', '2026-10-26T10:00:00.000Z', 'outreach', 'sent to jane.doe@gmail.com about the grant', 'qnfo-outreach', 'ok');
INSERT INTO code_tasks (id, goal, last_error, model) VALUES (1, 'email jane.doe@gmail.com the draft', 'smtp refused for bob@example.org after a retry', 'm');
INSERT INTO research_queue (id, idea, summary, context) VALUES (1, 'ask carol@example.net about the grant', 'carol wrote back about the grant', 'thread with carol@example.net and dave@example.com');
INSERT INTO fleet_improvements (id, title) VALUES (1, 'call dave@example.com on Friday'), (2, 'ping erin@example.com');`);
const LEAK = /jane|gmail|bob|carol|dave|erin|example|grant|timeout|@/i;
{ // (4) FREE TEXT: every dodge of the review is refused after the dry run as private-table: free-text value, with no contract, no authored event, no decision_log row, and no value in the reject event
  const dodges = {
    "latest event text, unfiltered": "SELECT 'none' AS expected,(SELECT text FROM cloud_ops_events ORDER BY ts DESC LIMIT 1) AS observed",
    "event text with a LIKE '%@%' filter": "SELECT 'none' AS expected,(SELECT text FROM cloud_ops_events WHERE text LIKE '%@%' ORDER BY ts DESC LIMIT 1) AS observed",
    "kind LIKE 'out%'": "SELECT 'none' AS expected,(SELECT text FROM cloud_ops_events WHERE kind LIKE 'out%' ORDER BY ts DESC LIMIT 1) AS observed",
    "kind built by concatenation": "SELECT 'none' AS expected,(SELECT text FROM cloud_ops_events WHERE kind='out'||'reach' ORDER BY ts DESC LIMIT 1) AS observed",
    "kind built by char()": "SELECT 'none' AS expected,(SELECT text FROM cloud_ops_events WHERE kind=char(111,117,116,114,101,97,99,104) ORDER BY ts DESC LIMIT 1) AS observed",
    "id LIKE 'outr%'": "SELECT 'none' AS expected,(SELECT text FROM cloud_ops_events WHERE id LIKE 'outr%' LIMIT 1) AS observed",
    "an address that is the whole text (a token with an @)": "SELECT 'none' AS expected,(SELECT text FROM cloud_ops_events WHERE id = 'tok-seed') AS observed",
    "group_concat of fleet_improvements.title": "SELECT 'none' AS expected,(SELECT group_concat(title,' | ') FROM fleet_improvements) AS observed",
    "code_tasks.goal": "SELECT 'none' AS expected,(SELECT goal FROM code_tasks LIMIT 1) AS observed",
    "code_tasks.last_error": "SELECT 'none' AS expected,(SELECT last_error FROM code_tasks LIMIT 1) AS observed",
    "research_queue.idea": "SELECT 'none' AS expected,(SELECT idea FROM research_queue LIMIT 1) AS observed",
    "research_queue.summary": "SELECT 'none' AS expected,(SELECT summary FROM research_queue LIMIT 1) AS observed",
    "research_queue.context": "SELECT 'none' AS expected,(SELECT context FROM research_queue LIMIT 1) AS observed",
    "a JSON object built from a row": "SELECT 'none' AS expected,(SELECT json_object('t', text) FROM cloud_ops_events WHERE id = 'outr-seed') AS observed",
    "two columns joined with a comma": "SELECT 'none' AS expected,(SELECT kind || ',' || job FROM cloud_ops_events WHERE id = 'outr-seed') AS observed",
  };
  { // the dodges are real: in plain SQLite each of the cloud_ops_events and table ones returns the address, so refusing them is not a fiction
    const { db } = mk(false); seedText(db);
    const leaking = Object.entries(dodges).filter(([label]) => !/token|json|comma|group_concat|context|summary/.test(label)).filter(([, sql]) => !LEAK.test(String(db.prepare(sql).get().observed))).map(([label]) => label);
    ok(leaking.length === 0, "each text dodge returns an address or a sentence in plain SQLite", leaking);
  }
  const missed = [], leaked = [];
  for (const [label, sql] of Object.entries(dodges)) {
    const r = await attempt(sql, { live: false, setup: seedText });
    if (!(refused(r, "private-table") && /private-table: free-text value in observed$/.test(r.rejects[0].text))) missed.push([label, r.done, r.rejects.map((e) => e.text), !!r.contract]);
    if (r.rejects.length && LEAK.test(r.rejects[0].text)) leaked.push([label, r.rejects[0].text]);
  }
  ok(missed.length === 0, "every free-text dodge (" + Object.keys(dodges).length + ") is refused as private-table: free-text value, with no contract, event or decision_log row", missed.slice(0, 4));
  ok(leaked.length === 0, "no reject event carries the seeded text", leaked.slice(0, 3));
  // the expected column is a value too
  const exp1 = await attempt("SELECT (SELECT text FROM cloud_ops_events LIMIT 1) AS expected, 0 AS observed", { live: false, setup: seedText });
  ok(refused(exp1, "private-table") && /free-text value in expected$/.test(exp1.rejects[0].text) && !LEAK.test(exp1.rejects[0].text), "free text in the expected column is refused as private-table, without the value", exp1.rejects.map((e) => e.text));
  const exp2 = await attempt("SELECT (SELECT goal FROM code_tasks LIMIT 1) AS expected, COUNT(*) AS observed FROM portfolio_gaps", { live: false, setup: seedText });
  ok(refused(exp2, "private-table") && /free-text value in expected$/.test(exp2.rejects[0].text), "free text in expected beside a count is refused too", exp2.rejects.map((e) => e.text));
  // short values that are not a number or a token are free text too
  for (const [label, obs] of [["a short phrase", "COUNT(*) || ' gaps open'"], ["a comma", "'a,b'"], ["a JSON object", "'{\"a\":1}'"], ["an @", "'a@b'"], ["a slash", "'a/b'"], ["a newline", "'a' || char(10) || 'b'"], ["a double quote", "'a\"b'"], ["a percent sign", "'50%'"], ["a leading space is trimmed but an inner one is not", "' a b'"]]) {
    const r = await attempt("SELECT 'ok' AS expected, " + obs + " AS observed FROM portfolio_gaps LIMIT 1");
    ok(refused(r, "private-table") && /free-text value in observed$/.test(r.rejects[0].text), "a value with " + label + " is refused as free text", r.rejects.map((e) => e.text));
  }
  // numbers and tokens pass: a count, a negative decimal, an ok token, a timestamp, a version, a short id
  const goodValues = { "a count": "COUNT(*)", "a negative decimal": "COUNT(*) - 2.5", "a float": "COUNT(*) / 3.0", "an ok token": "'done'", "a timestamp": "(SELECT MAX(ts) FROM cloud_ops_events)", "a status token": "(SELECT status FROM cloud_ops_events LIMIT 1)", "a version": "'0.52.1-patch'", "a plus and a colon": "'a+b:c_d.e'" };
  for (const [label, obs] of Object.entries(goodValues)) {
    const r = await attempt("SELECT 'ok' AS expected, " + obs + " AS observed FROM portfolio_gaps LIMIT 1", { live: false, setup: seedText });
    ok(r.done === true && r.contract && r.contract.status === "active" && r.rejects.length === 0, "a value that is " + label + " is accepted", r.rejects.map((e) => e.text));
  }
  const ts = await attempt("SELECT 'ok' AS expected, MAX(ts) AS observed FROM cloud_ops_events", { live: false, setup: seedText });
  ok(ts.done === true && ts.log.length === 1 && ts.log[0].evidence.indexOf("(observed: 2026-10-26T10:00:00.000Z)") > 0 && !LEAK.test(ts.log[0].evidence.replace(/^model \S+/, "")), "the decision_log evidence holds the bounded token and the objects read, never a text value", ts.log[0] && ts.log[0].evidence);
  ok(ts.log.length === 1 && /static check passed \(reads cloud_ops_events, operational objects on the allowlist\)/.test(ts.log[0].evidence), "the decision_log evidence names what the probe reads", ts.log[0] && ts.log[0].evidence);
  const nul = await attempt("SELECT NULL AS expected, COUNT(*) AS observed FROM portfolio_gaps");
  ok(refused(nul, "deferral-shape") && /expected is empty$/.test(nul.rejects[0].text), "an empty expected value is a deferral shape", nul.rejects.map((e) => e.text));
  // the number-or-token shape applies to the birth dry run's first row only; a later pass re-runs the same read-only SQL and writes the first row untruncated (the residual the worker's note and comment state)
  ok(/RT_PROBE_AUTHOR_VALUE_RE/.test(src) && api.RT_PROBE_AUTHOR_MAX_OBSERVED === 64, "the value rule is a named constant of 64 characters");
  { // the residual is real, so the note must say it: a branch not taken at birth returns free text of any length from an allowlisted table, and the shape gate lets a 64-character slice of a text column through
    const branch = "SELECT 'done' AS expected, CASE WHEN (SELECT COUNT(*) FROM portfolio_gaps) > 100 THEN (SELECT text FROM cloud_ops_events WHERE id = 'outr-seed') ELSE 'open' END AS observed";
    const r = await attempt(branch, { live: false, setup: seedText });
    ok(r.done === true && r.contract && r.contract.verify_probe === branch && r.log.length === 1 && r.log[0].evidence.indexOf("(observed: open)") > 0, "residual (a): a probe whose untaken branch reads event text is accepted at birth (the value gate saw 'open')", r.rejects.map((e) => e.text));
    for (let i = 10; i < 130; i++) r.db.prepare("INSERT INTO portfolio_gaps VALUES (?, 'open')").run(i);
    const later = r.db.prepare(r.contract.verify_probe).get();
    ok(String(later.observed).length > 40 && /jane\.doe@gmail\.com/.test(String(later.observed)), "residual (a): on a later pass the stored SQL returns the event text, which the engine copies as it is", later);
    const hexed = await attempt("SELECT 'done' AS expected, hex(substr((SELECT text FROM cloud_ops_events WHERE id = 'tok-seed'), 1, 8)) AS observed FROM portfolio_gaps LIMIT 1", { live: false, setup: seedText });
    const subbed = await attempt("SELECT 'done' AS expected, substr((SELECT text FROM cloud_ops_events WHERE id = 'tok-seed'), 1, 8) AS observed FROM portfolio_gaps LIMIT 1", { live: false, setup: seedText });
    ok(hexed.done === true && subbed.done === true && subbed.log[0].evidence.indexOf("(observed: jane.doe)") > 0, "residual (b): hex() or substr() of a text column is a token of at most 64 characters that passes the shape gate, so the shape gate is not a content gate", [hexed.rejects.map((e) => e.text), subbed.rejects.map((e) => e.text)]);
  }
  { // the engine's d1-query branch is what the note describes: the first row, expected and observed written whole
    const eng = src.slice(src.indexOf("var r = await qdb.prepare(q).first();"), src.indexOf("var r = await qdb.prepare(q).first();") + 900);
    ok(/qdb\.prepare\(q\)\.first\(\)/.test(eng) && /es = exp == null \? "" : String\(exp\)\.trim\(\); os = obs == null \? "" : String\(obs\)\.trim\(\);/.test(eng) && !/\.slice\(|\.substr/.test(eng), "the hourly engine reads the first row and keeps expected and observed whole (no slice), as the note states", eng.slice(0, 200));
    ok(/INSERT INTO remediation_verifications \([^)]*\) VALUES \(\?1, \?2, \?3, \?4, \?5, \?6, \?7, \?8\)"\)\.bind\(c\.issue_id, c\.class, probeUrl, transport, es, os, passed,/.test(src), "the engine binds es and os, not a truncated copy, into remediation_verifications");
  }
}
{ // (5) MEASURES NOTHING: a probe that reads no allowlisted object in table position, flips on random(), or shadows an object with a CTE can pass a later hourly verification with no measurement
  const reviewer = {
    "random() alone": "SELECT 'ok' AS expected,CASE WHEN random()%2=0 THEN 'ok' ELSE 'no' END AS observed",
    "the clock alone": "SELECT 'ok' AS expected,CASE WHEN CAST(strftime('%s','now') AS INTEGER)%2=0 THEN 'ok' ELSE 'no' END AS observed",
    "two constants": "SELECT 0 AS expected,1 AS observed",
    "a CTE of constants": "WITH t AS (SELECT 5 AS n) SELECT 0 AS expected, n AS observed FROM t",
    "a table name only inside a string literal": "SELECT 0 AS expected, CASE WHEN 'portfolio_gaps' = 'x' THEN 0 ELSE 1 END AS observed",
    "a table name only as a column alias": "SELECT 0 AS expected, 1 AS portfolio_gaps, 2 AS observed",
  };
  const missed = [];
  for (const [label, sql] of Object.entries(reviewer)) {
    const bad = await check(sql), r = await attempt(sql);
    if (!(reasonOf(bad) === "not-allowlisted" && /reads no operational table/.test(bad))) missed.push([label, "static", bad]);
    if (!(refused(r, "not-allowlisted") && /reads no operational table$/.test(r.rejects[0].text))) missed.push([label, "e2e", r.done, r.rejects.map((e) => e.text)]);
  }
  ok(missed.length === 0, "a probe that reads no operational table is refused as not-allowlisted: reads no operational table (" + Object.keys(reviewer).length + " shapes, static and end to end)", missed.slice(0, 4));
  const rnd = {
    "random() with a table": "SELECT 'ok' AS expected, CASE WHEN random() % 2 = 0 THEN 'ok' ELSE 'no' END AS observed FROM portfolio_gaps LIMIT 1",
    "RANDOM () spaced and upper case": "SELECT 'ok' AS expected, CASE WHEN RANDOM () % 2 = 0 THEN 'ok' ELSE 'no' END AS observed FROM portfolio_gaps LIMIT 1",
    "randomblob()": "SELECT 'ok' AS expected, CASE WHEN hex(randomblob(1)) < '80' THEN 'ok' ELSE 'no' END AS observed FROM portfolio_gaps LIMIT 1",
    "random() in a subquery": "SELECT 0 AS expected, (SELECT COUNT(*) FROM portfolio_gaps WHERE id > abs(random()) % 5) AS observed",
    "random() with a comment before the parenthesis": "SELECT 'ok' AS expected, CASE WHEN random /* x */ () % 2 = 0 THEN 'ok' ELSE 'no' END AS observed FROM portfolio_gaps LIMIT 1",
  };
  const rmiss = [];
  for (const [label, sql] of Object.entries(rnd)) {
    const bad = await check(sql), r = await attempt(sql);
    if (!(reasonOf(bad) === "self-confirming" && /random/.test(bad))) rmiss.push([label, "static", bad]);
    if (!refused(r, "self-confirming")) rmiss.push([label, "e2e", r.done, r.rejects.map((e) => e.text)]);
  }
  ok(rmiss.length === 0, "a probe that calls random() or randomblob() is refused as self-confirming (" + Object.keys(rnd).length + " shapes, static and end to end)", rmiss.slice(0, 4));
  const shadow = await check("WITH portfolio_gaps AS (SELECT 1 AS id) SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps");
  ok(reasonOf(shadow) === "not-allowlisted" && /shadows/.test(shadow), "a CTE named like a real object does not count as a read of it", shadow);
  const shadowE2E = await attempt("WITH portfolio_gaps AS (SELECT 1 AS id) SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps");
  ok(refused(shadowE2E, "not-allowlisted"), "the CTE shadow is refused end to end", shadowE2E.rejects.map((e) => e.text));
  { // review pass 3: every spelling SQLite gives a CTE head shadows the object just the same. The body is the clock (3 + epoch % 3), so expected 9 never equals observed and the vacuity gate cannot catch it.
    const clk = "3 + CAST(strftime('%s','now') AS INTEGER) % 3", tail = " SELECT 9 AS expected, n AS observed FROM portfolio_gaps";
    const spellings = {
      "a column list": `WITH portfolio_gaps(n) AS (SELECT ${clk})${tail}`,
      "a column list with a space before it": `WITH portfolio_gaps (n) AS (SELECT ${clk})${tail}`,
      "AS MATERIALIZED": `WITH portfolio_gaps AS MATERIALIZED (SELECT ${clk} AS n)${tail}`,
      "AS NOT MATERIALIZED": `WITH portfolio_gaps AS NOT MATERIALIZED (SELECT ${clk} AS n)${tail}`,
      "a column list and AS MATERIALIZED": `WITH portfolio_gaps(n) AS MATERIALIZED (SELECT ${clk})${tail}`,
      "a column list and AS NOT MATERIALIZED": `WITH portfolio_gaps(n) AS NOT MATERIALIZED (SELECT ${clk})${tail}`,
      "two names in the column list": `WITH portfolio_gaps(a, n) AS (SELECT 1, ${clk})${tail}`,
      "second in a list": `WITH a AS (SELECT 1 AS id), portfolio_gaps AS (SELECT ${clk} AS n)${tail}`,
      "second in a list with a column list": `WITH a(id) AS (SELECT 1), portfolio_gaps(n) AS (SELECT ${clk})${tail}`,
      "second in a list with MATERIALIZED": `WITH a AS (SELECT 1 AS id), portfolio_gaps(n) AS MATERIALIZED (SELECT ${clk})${tail}`,
      "WITH RECURSIVE and a column list": `WITH RECURSIVE portfolio_gaps(n) AS (SELECT ${clk})${tail}`,
      "a double-quoted name and a column list": `WITH "portfolio_gaps"(n) AS (SELECT ${clk})${tail}`,
      "a bracketed name and a column list": `WITH [portfolio_gaps](n) AS (SELECT ${clk})${tail}`,
      "a backtick name and MATERIALIZED": "WITH `portfolio_gaps` AS MATERIALIZED (SELECT " + clk + " AS n)" + tail,
      "a string-literal name": `WITH 'portfolio_gaps' AS (SELECT ${clk} AS n)${tail}`,
      "a string-literal name and a column list": `WITH 'portfolio_gaps'(n) AS (SELECT ${clk})${tail}`,
      "upper case": `WITH PORTFOLIO_GAPS(N) AS NOT MATERIALIZED (SELECT ${clk})${tail}`,
      "comments between the tokens": `WITH portfolio_gaps /* c */ (n) /* d */ AS /* e */ NOT /* f */ MATERIALIZED /* g */ (SELECT ${clk})${tail}`,
    };
    const run = new DatabaseSync(":memory:"); run.exec("CREATE TABLE portfolio_gaps (id INTEGER PRIMARY KEY, status TEXT); INSERT INTO portfolio_gaps VALUES (1, 'open'), (2, 'open'), (3, 'closed');");
    const fake = [], smiss = [];
    for (const [label, sql] of Object.entries(spellings)) {
      let row = null; try { row = run.prepare(sql).get(); } catch (e) { row = String(e && e.message); }
      // the bypass is real: SQLite runs the statement, the CTE wins the name, and the table is never read (observed is the clock value 3 to 5, expected 9)
      if (!(row && typeof row === "object" && row.expected === 9 && row.observed >= 3 && row.observed <= 5)) fake.push([label, row]);
      const bad = await check(sql), r = await attempt(sql);
      if (!(reasonOf(bad) === "not-allowlisted" && /a CTE shadows the object name portfolio_gaps/.test(bad))) smiss.push([label, "static", bad]);
      if (!(refused(r, "not-allowlisted") && /a CTE shadows the object name portfolio_gaps$/.test(r.rejects[0].text))) smiss.push([label, "e2e", r.done, r.rejects.map((e) => e.text)]);
    }
    ok(fake.length === 0, "each shadow spelling is real SQLite that returns the clock value and never reads the table (" + Object.keys(spellings).length + " spellings)", fake.slice(0, 4));
    ok(smiss.length === 0, "a CTE head with a column list, AS [NOT] MATERIALIZED, a second position, a quoted or string name shadows the object and is refused as not-allowlisted, static and end to end (" + Object.keys(spellings).length + " spellings)", smiss.slice(0, 4));
    // the same spellings over a real read are accepted, and so is a column-list CTE whose name only looks private
    const legitCte = {
      "a column list": "WITH t(n) AS (SELECT COUNT(*) FROM portfolio_gaps WHERE status = 'open') SELECT 0 AS expected, n AS observed FROM t",
      "a column list over the plain count of the review": "WITH t(n) AS (SELECT COUNT(*) FROM portfolio_gaps) SELECT 0 AS expected, n AS observed FROM t",
      "AS MATERIALIZED": "WITH t AS MATERIALIZED (SELECT COUNT(*) AS n FROM portfolio_gaps) SELECT 0 AS expected, n AS observed FROM t",
      "AS NOT MATERIALIZED": "WITH t AS NOT MATERIALIZED (SELECT COUNT(*) AS n FROM portfolio_gaps) SELECT 0 AS expected, n AS observed FROM t",
      "a column list and AS NOT MATERIALIZED": "WITH t(n) AS NOT MATERIALIZED (SELECT COUNT(*) FROM portfolio_gaps) SELECT 0 AS expected, n AS observed FROM t",
      "two CTEs, each with a column list": "WITH a(n) AS (SELECT COUNT(*) FROM portfolio_gaps), b(m) AS (SELECT COUNT(*) FROM pr_sla_state) SELECT 0 AS expected, n + m AS observed FROM a, b",
      "a column-list CTE named like a private family": "WITH mail_counts(n) AS (SELECT COUNT(*) FROM portfolio_gaps) SELECT 0 AS expected, n AS observed FROM mail_counts",
      "WITH RECURSIVE with a column list": "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 3) SELECT 0 AS expected, (SELECT COUNT(*) FROM portfolio_gaps) + n AS observed FROM t WHERE n = 3",
    };
    const lmiss = [];
    for (const [label, sql] of Object.entries(legitCte)) {
      const bad = await check(sql), r = await attempt(sql);
      if (bad !== null) lmiss.push([label, "static", bad]);
      if (!(r.done === true && r.contract && r.contract.status === "active" && r.rejects.length === 0)) lmiss.push([label, "e2e", r.done, r.rejects.map((e) => e.text)]);
    }
    ok(lmiss.length === 0, "a CTE with a column list or AS [NOT] MATERIALIZED over a real read is accepted, and its name is no table (" + Object.keys(legitCte).length + " forms)", lmiss.slice(0, 4));
    // the body of a column-list CTE is still scanned, and a private name inside it is still private
    const body = await check("WITH mail_counts(n) AS (SELECT COUNT(*) FROM emails) SELECT 0 AS expected, n AS observed FROM mail_counts");
    const body2 = await check("WITH t(n) AS MATERIALIZED (SELECT COUNT(*) FROM decision_log) SELECT 0 AS expected, n AS observed FROM t");
    const body3 = await check("WITH t(n) AS NOT MATERIALIZED (SELECT COUNT(*) FROM ops_config) SELECT 0 AS expected, n AS observed FROM t");
    ok(reasonOf(body) === "private-table" && reasonOf(body2) === "self-confirming" && reasonOf(body3) === "not-allowlisted", "the body of a column-list or MATERIALIZED CTE is still scanned", [body, body2, body3]);
    // a function call or a CAST in front of AS ( is no CTE head: the name stays a table
    const castLike = await check("SELECT 0 AS expected, CAST(COUNT(*) AS INTEGER) AS observed FROM portfolio_gaps");
    const castParen = await check("SELECT 0 AS expected, CAST(COUNT(*) AS VARCHAR(10)) AS observed FROM portfolio_gaps");
    ok(castLike === null && castParen === null, "CAST(x AS type) and CAST(x AS type(n)) register no CTE", [castLike, castParen]);
  }
  // none of these is a call or a constant-only probe
  const fine = [
    "SELECT 1 AS expected, COUNT(*) AS observed FROM portfolio_gaps WHERE status LIKE '%random(%'",
    "SELECT 1 AS expected, COUNT(*) AS random FROM portfolio_gaps",
    "SELECT 0 AS expected, (SELECT COUNT(*) FROM portfolio_gaps WHERE status = 'open') AS observed",
    "WITH t AS (SELECT COUNT(*) AS n FROM portfolio_gaps) SELECT 0 AS expected, n AS observed FROM t",
    "SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps g JOIN metric_registry m ON m.rowid = g.id",
    "SELECT 0 AS expected, COUNT(*) AS observed FROM cloud_ops_events WHERE ts > strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hour')",
  ];
  const wrong = [];
  for (const sql of fine) { const bad = await check(sql); if (bad !== null) wrong.push([sql.slice(0, 60), bad]); }
  ok(wrong.length === 0, "random( inside a string literal, a column named random, a read in a subquery, a CTE over a table, a join and a clock window are not refused", wrong);
  // what the probe reads is reported to the caller
  const info = {}; const v = await valid(live1.h, "SELECT 0 AS expected, (SELECT COUNT(*) FROM portfolio_gaps) + (SELECT COUNT(*) FROM pr_sla_state) AS observed FROM portfolio_gaps", 4242, info);
  ok(v === null && JSON.stringify(info.reads) === JSON.stringify(["portfolio_gaps", "pr_sla_state"]), "the validator reports the allowlisted objects a passing probe reads", [v, info]);
  const info2 = {}; await valid(live1.h, "SELECT 0 AS expected, 1 AS observed", 4242, info2);
  ok(info2.reads === undefined, "a refused probe reports no reads", info2);
}
{ // every new reject is the existing event kind, with a code from the enum, once, and the fast static checks still answer their own way
  const outcomes = [];
  for (const sql of ["SELECT 0 AS expected, COUNT(*) AS observed FROM emails", "SELECT 0 AS expected, COUNT(*) AS observed FROM decision_log", "SELECT 'ok' AS expected, 'pending: 2' AS observed FROM portfolio_gaps LIMIT 1", "SELECT 0 AS expected, COUNT(*) AS observed FROM ops_config", "SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps " + "-- " + "z".repeat(600)]) {
    const r = await attempt(sql); outcomes.push([r.rejects.length === 1 ? r.rejects[0].kind : "none", r.rejects.length === 1 ? /^issue=\d+ ([a-z-]+):/.exec(r.rejects[0].text)?.[1] : null]);
  }
  ok(outcomes.every((o) => o[0] === "remediation.probe-author-reject" && REASONS.includes(o[1])) && JSON.stringify(outcomes.map((o) => o[1])) === JSON.stringify(["private-table", "self-confirming", "deferral-shape", "not-allowlisted", "too-long"]), "each of the five codes is written as remediation.probe-author-reject", outcomes);
  const unparse = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps WHERE status = 'open");
  const paren = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM (SELECT 1 FROM portfolio_gaps");
  const ascii = await check("SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps WHERE status = 'é'");
  ok(/does not parse/.test(unparse) && /does not parse/.test(paren) && /ASCII/.test(ascii) && [unparse, paren, ascii].every((b) => reasonOf(b) === b), "unterminated quotes, unbalanced parentheses and non-ASCII are the older static-reject text", [unparse, paren, ascii]);
  const old = [await check("SELECT 0 AS expected, COUNT(*) AS observed FROM portfolio_gaps; DELETE FROM portfolio_gaps"), await check("UPDATE portfolio_gaps SET status = 'x'"), await check("SELECT needs-machine-probe AS expected, 1 AS observed")];
  ok(old[0] === "more than one statement" && old[1] === "not a single SELECT or WITH" && old[2] === "needs-machine-probe marker", "the older static rejects keep their text", old);
}
{ // the tick hands the author its AI binding: until 0.52.1 the call site passed none and every call ended in no-ai-binding
  const tickSrc = src.slice(src.indexOf("await rtEscalateStaleDeferrals(db, out);"));
  ok(tickSrc.indexOf("await rtEnsureLivePath(db, out, env);") > 0 && tickSrc.indexOf("await rtEnsureLivePath(db, out, env);") < 400, "the remediation tick passes env to rtEnsureLivePath");
  ok(/function rtEnsureLivePath\(db, out, env\)/.test(src) && /rtAuthorLivePathProbe\(db, env, rows\[i\]\)/.test(src), "rtEnsureLivePath hands env on to the author");
}
{ // VERSION: a patch above main's 0.52.0 (the doctor engine); the note is a // line under the VERSION-LINE-SPLIT-1 header, as its neighbours are, and not on the VERSION line
  const v = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(src), vAt = src.search(/var VERSION = "/), hAt = src.indexOf("// VERSION-LINE-SPLIT-1 (agent_issues 100220)");
  ok(v && (Number(v[1]) > 0 || Number(v[2]) > 52 || (Number(v[2]) === 52 && Number(v[3]) >= 1)), "VERSION is at least 0.52.1", v && v[0]);
  ok(hAt > 0 && hAt < vAt && /\n\/\/ 0\.52\.1 PROBE-AUTHOR-HARDEN-1 /.test(src.slice(hAt, vAt)), "the release note is a comment line between the VERSION-LINE-SPLIT-1 header and the VERSION statement");
  ok(src.slice(vAt, src.indexOf("\n", vAt)).indexOf("PROBE-AUTHOR-HARDEN-1") < 0, "the release note is not on the VERSION line");
  // the note is found by its label, whatever number a later rebase gives it, and compared as a minimum: it must sit above 0.53.2 (main's last, the doctor validator) and VERSION must be at least the note's own number
  const rp = /\n\/\/ (\d+)\.(\d+)\.(\d+) PROBE-AUTHOR-HARDEN-1 review pass /.exec(src.slice(hAt, vAt)), key = (a, b, c) => Number(a) * 1e8 + Number(b) * 1e4 + Number(c);
  ok(rp && v && key(rp[1], rp[2], rp[3]) >= key(0, 53, 3) && key(v[1], v[2], v[3]) >= key(rp[1], rp[2], rp[3]), "the review-pass note is a comment line under the header, above main's 0.53.2, and VERSION is at least the note's number", rp && rp[0].trim());
}
{ // the review-pass note and the comment above RT_PROBE_AUTHOR_MAX_SQL state the residual as it is (review passes 3 and 4), and no longer claim a bound or a control the code does not have
  const hAt = src.indexOf("// VERSION-LINE-SPLIT-1 (agent_issues 100220)"), vAt = src.search(/var VERSION = "/);
  const note = (src.slice(hAt, vAt).split("\n").find((l) => /^\/\/ \d+\.\d+\.\d+ PROBE-AUTHOR-HARDEN-1 review pass /.test(l)) || "");
  ok(note.length > 0, "the review-pass note is present");
  ok(!/at most 64 characters of that token alphabet/.test(note) && !/a value is at most 64 characters/.test(note), "the note no longer says a later value is at most 64 characters");
  ok(/untruncated into remediation_verifications/.test(note) && /text of any length from an allowlisted table/.test(note), "the note says the hourly re-verification writes the first row untruncated, so a branch not taken at birth can return text of any length");
  ok(/not a content gate/.test(note) && /hex\(\) or substr\(\)/.test(note) && /allowlist and the literal cloud_ops_events kind filter remain the privacy boundary/.test(note), "the note says the shape gate is not a content gate and names the privacy boundary");
  ok(/PROBE-REVIEW-1/.test(note) && /no privacy criterion/.test(note) && /is not a control on this residual/.test(note) && !/compensating layer/.test(note), "the note says PROBE-REVIEW-1 has no privacy criterion and is not a control on the residual, and no longer calls it the compensating layer");
  ok(/ci-status\/remediation-consumer\.json/.test(note) && /public QNFO\/qnfo-workers repository/.test(note) && /scripts\/remediation_consumer\.py/.test(note) && /remediation_verifications/.test(note), "the note names both sinks of the untruncated later-pass value, the public run log among them");
  ok(/Nothing re-checks the shape of a later pass's value yet/.test(note) && /sink guard/.test(note), "the note says nothing re-checks a later pass's value yet and names the sink guard as the follow-up");
  ok(/column list, AS MATERIALIZED or AS NOT MATERIALIZED/.test(note), "the note names the CTE spellings the shadow gate covers");
  const cAt = src.indexOf("var RT_PROBE_AUTHOR_MAX_SQL = 600;"), cmt = src.slice(src.lastIndexOf("// PROBE-AUTHOR-HARDEN-1 (qnfo-fleet-control 0.52.1", cAt), cAt);
  ok(/UNTRUNCATED/.test(cmt) && !/the open verification ledger is bounded/.test(cmt) && /rtProbeAuthorCteHead/.test(cmt), "the comment above RT_PROBE_AUTHOR_MAX_SQL says the verification ledger copy is untruncated and does not call it bounded");
  ok(/ci-status\/remediation-consumer\.json/.test(cmt) && /public QNFO\/qnfo-workers repository/.test(cmt) && /scripts\/remediation_consumer\.py/.test(cmt), "the comment names the runner consumer's public run log as a sink of the untruncated value");
  ok(/no privacy criterion/.test(cmt) && /not a control on this residual/.test(cmt) && !/compensating layer/.test(cmt), "the comment says PROBE-REVIEW-1 has no privacy criterion and is not a control on the residual");
}
{ // the sink claims in the note and the comment are true of the code they describe (a claim about another file is read from that file)
  const consumer = readFileSync(new URL("../scripts/remediation_consumer.py", import.meta.url), "utf8");
  const wf = readFileSync(new URL("../.github/workflows/remediation-consumer.yml", import.meta.url), "utf8");
  const d1fn = consumer.slice(consumer.indexOf("def consume_d1("), consumer.indexOf("def next_due_offset("));
  ok(d1fn.length > 200 && /rec\["observed"\] = obs\b(?!\s*\[)/.test(d1fn) && /rec\["expected"\] = exp\b(?!\s*\[)/.test(d1fn), "the consumer's d1 path copies expected and observed into its run log with no slice");
  ok(/due_at IS NULL OR datetime\(next_due_at\) <= datetime\('now'\)/.test(consumer) && /next_due_at = NULL/.test(src.slice(src.indexOf("async function rtAuthorLivePathProbe"))), "an authored contract has next_due_at NULL and the consumer selects a NULL next_due_at, so it is probed at once");
  ok(/ci-status\/remediation-consumer\.json/.test(wf) && /git add ci-status\/remediation-consumer\.json/.test(wf), "the remediation-consumer workflow commits ci-status/remediation-consumer.json");
}
ok(mirror === src, "the deployed-current mirror is identical to worker.js");
ok(consoleErrors.length === 0, "probe-author rejections are recorded without error-level console logs", consoleErrors);
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
