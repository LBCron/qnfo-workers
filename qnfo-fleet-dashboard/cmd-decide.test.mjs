// DASH-OWNER-ACTIONS-1 offline suite (qnfo-fleet-dashboard 1.70.0, agent_issues 100360). Owner report 2026-10-20: "Fleet command line
// not executing. Need easier way to approve owner items and diagnose/resolve issues and problems from fleet dashboard." The approvals
// the owner typed (11:20, 11:21 and 11:34Z) went to the AI path and, when three router legs timed out, nothing executed.
// Proves: approve, decline, diagnose, retry and resolve are parsed in code and never call a model (T1, T12); a bare approve lists the
// candidates and never guesses (T2); a bare six-digit issue id is not read as a sign-in code unless one is waiting, and reject/ratify of a
// non-objective id is decline/approve (T3, T4); an approval is the owner session's own, destructive (fresh code) and writes the card,
// human_responses, the OWNER-DECISION stamp and ONE hand-off task that names the items, the doer and the closing probe, without
// claiming anything was applied (T5-T8); a numbered card is decided item by item and closes when every item is decided (T9); when the
// model does not answer, the matched intent comes back as tappable buttons that are stored (T10); resolve closes only on a passing
// probe (T11); diagnose is an open read that hides titles from a stranger (T12); cmdFallback keeps working alone in a vm (T13); the
// card buttons are the owner's only, 44 px, wrapped for a 360 px phone and delegated so the 15 s refresh keeps them (T14); retry (T15).
// Review round (1.70.0): the hand-off is filed BEFORE anything is recorded and an approval never spends an Ask slot (T17); Approve and Decline
// are offered only for a card that asks for a decision and is not a legal, signing, money, credential or account step (T18); a card with
// no issue still hands the fleet a task it can act on, and a pick-one card needs the option (T19); a sentence that merely starts with a
// verb belongs to the model, and retry runs unasked only for 'retry <reference>' (T20); 'investigate ...' and 'diagnose ...' sentences go to the model too, while the verb alone or with a reference stays a command (T20m, T20n).
// Review round 2 (1.70.0): the Ask cap exempts only the server's own hand-off marker, never text a stranger controls (T17h-l); a PR, run or
// commit number in a card's text is never an issue id (T21).
// Review round 3 (1.70.0): two approvals are two tasks under main's OWNER-PROMPT-TWIN-LINK-1 twin check, because the hand-off opens with what tells decisions apart and
// is never twin-linked (T22); a card in any status other than open is read by key only by the signed-in owner or a token holder, never by a stranger (T23).
// Review round 4 (1.70.0, after FLEET-STATUS-1 made the home page statusPageHtml): the Needs-you cards of / carry the decision block for the signed-in owner
// only, computed per request and never inside the cached public document or /api/status (T24); the hand-off is never longer than the 1800 characters the issue
// body keeps, with a dozen long items too (T25); a repeat approve files no second hand-off and a decline of an approved item says it was already handed to the
// fleet and is not undone (T26); 'why 2026 papers were pulled?' is not a diagnosis of agent_issues 2026 (T27). T14 and T18 read /classic, which keeps the old page.
// Follow-up (1.70.1, two reviewers of the merged head): a receipt card ('Closed for you', human_actions.source owner-request-issue) is a receipt on the typed path
// and the server path too, whatever its title says (T28); the hard-marker gate FAILS CLOSED, so with default_approve_markers unreadable or empty no card that asks
// for a decision offers Approve or Decline, for each of the 73 live patterns (T29, T18h).
// Run: node qnfo-fleet-dashboard/cmd-decide.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
globalThis.fetch = async () => new Response("{}", { status: 503 });

const STATE = { schema_version: "fleet-state/v1", generated_at: new Date().toISOString(), version: "t", verdict: "HEALTHY", window: {}, fleet: { workers: 44 }, totals: {}, scheduled: [], audits: [], probes: [], integration: {}, report_card: {}, chains: [], device: {}, issues: [], issue_counts: { err: 0, warn: 0, total: 0 }, queues: [], coverage: {}, unattributed_errors: 0, recovered_workers: [], error_workers: [], loop: {}, meta: {}, refresh_ms: 1 };
const LOOP = "loop-secret-123";
const SLUG = "uia-source-fidelity-100140";
const DESC = [
  "Found 2026-10-19 while red-teaming the poster. Each item names the defect and the fix; done = each paper body corrected and republished as a new version.",
  "",
  "1) ai4metascience-ignorance-audit section 2 names the wrong analysed paper. Fix: point 2026b to papers.qnfo.org/papers/qwave-qudit-advantage.",
  "2) ignorance-ai-pipeline-synthesis section 2 contradicts itself on who contributed what. Fix: one consistent account.",
  "3) universal-ignorance-audit references: Whitcomb et al. is cited as 91(1) 95-120; correct is 94(3), 509-539.",
  "4) universal-ignorance-audit method paper: the meta-audit sibling list omits willful ignorance. Clarify which of the final 15 came from it.",
  "5) The forensic analyses are called independent, but the author contributions say the author wrote them.",
  "6) The poster source repository carries the old figure numbers.",
  "7) The registry entry needs a new version number.",
  "TRIAGE: owner qnfo-ops; doer is the revision and errata path (REVISION-LOOP-1, qnfo-research-exec)."
].join("\n");

// the live hard markers of DEFAULT-APPROVE-1 (default_approve_markers kind 'hard': 73 rows, SELECTed live 2026-10-26 and compared with this array: identical)
const HARD = ["% payment %", "% payments %", "%payment decision%", "%invoice%", "%bank %", "%credit card%", "%billing account%", "%billing plan%", "%billing project%", "%purchase%", "%wire transfer%", "%top up%", "%top-up%", "% fund %", "%prepaid%", "%subscri%", "% pay %", "% paid %", "% fee %", "% fees %", "%renew%", "%registrar%", "%refund%", "%wallet%", "%$_%", "% legal %", "% signature %", "%signing%", "% sign the %", "%patent applic%", "% dpa %", "% dpa,%", "%irreversible%", "%delete%", "%wipe%", "%erase%", "%truncate%", "%drop table%", "%destroy%", "%unbacked%", "%api key%", "%oauth%", "%sign in to%", "%sign-in%", "%log in to%", "%login link%", "%login code%", "%password%", "%credential%", "%rotate%", "%secret%", "%token%", "%grant access%", "%your name%", "%owner's name%", "%mailbox%", "%email from%", "%send an email%", "%send email%", "%@_%._%", "%visibility%", "%make public%", "%be public%", "%one-time code%", "%verification code%", "%privacy of %", "%gdpr%", "%personal data%", "%suppress%", "%opt-out%", "%opt out%", "%unsubscribe%", "%consent%"];
function mk(extra = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE fleet_dashboard_state (id INTEGER PRIMARY KEY, updated_at TEXT, state_json TEXT, refresh_ms INTEGER);
  CREATE TABLE fleet_loop_meta (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE human_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, title TEXT NOT NULL, why TEXT, default_in_effect TEXT, action TEXT, url TEXT, sev TEXT DEFAULT 'normal', due TEXT, status TEXT DEFAULT 'open', source TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), resolved_at TEXT, resolution TEXT);
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT DEFAULT 'optimization', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER, pipeline_stage TEXT, predicate_id TEXT, recheck_count INTEGER DEFAULT 0, close_channel TEXT);
  CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT NOT NULL, triage_state TEXT NOT NULL DEFAULT 'triaged', owner TEXT NOT NULL, sla_due_at TEXT NOT NULL, triaged_at TEXT DEFAULT (datetime('now')), remediation TEXT, close_evidence TEXT, reopened_count INTEGER NOT NULL DEFAULT 0);
  CREATE TRIGGER issue_close_evidence_required BEFORE UPDATE OF status ON agent_issues WHEN NEW.status IN ('closed','resolved','wontfix') AND OLD.status NOT IN ('closed','resolved','wontfix') AND NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND t.close_evidence IS NOT NULL AND TRIM(t.close_evidence) <> '') BEGIN SELECT RAISE(ABORT,'close-without-evidence'); END;
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER DEFAULT 3, escalate_to TEXT, status TEXT DEFAULT 'active', last_attempt_at TEXT, last_verdict TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0);
  CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, probe_url TEXT, transport TEXT, expected TEXT, observed TEXT, pass INTEGER NOT NULL, verified_at TEXT DEFAULT (datetime('now')), verifier TEXT);
  CREATE TABLE work_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT, intent TEXT, holder TEXT, issue_id INTEGER, pr INTEGER, claimed_at TEXT, expires_at TEXT, released_at TEXT, outcome TEXT);
  CREATE TABLE issue_plans (issue_id INTEGER PRIMARY KEY, planned_at TEXT, outcome TEXT, detail TEXT, task_id TEXT, path TEXT, model TEXT, attempts INTEGER);
  CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo TEXT, path TEXT, goal TEXT, status TEXT, step TEXT, attempts INTEGER, branch TEXT, pr_url TEXT, last_error TEXT, merge_state TEXT, merge_note TEXT, updated_at TEXT);
  CREATE TABLE intents (id TEXT PRIMARY KEY, desire TEXT, source TEXT, device TEXT, type TEXT, domain TEXT, priority TEXT, summary TEXT, due TEXT, status TEXT, wbs_code TEXT, created_at TEXT, processed_at TEXT, triage_decision TEXT);
  CREATE TABLE goals (id INTEGER PRIMARY KEY, goal_type TEXT, status TEXT, created_at TEXT, statement TEXT, alignment TEXT, updated_at TEXT);
  CREATE TABLE default_approve_markers (kind TEXT NOT NULL, pattern TEXT NOT NULL, note TEXT, added_at TEXT, PRIMARY KEY (kind, pattern));
  CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
  CREATE TABLE breach_diagnoses (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, case_key TEXT, family TEXT, rule_id TEXT, rule_version INTEGER DEFAULT 1, cause_class TEXT, facts_json TEXT, action_kind TEXT DEFAULT 'none', action_ref TEXT, state TEXT DEFAULT 'diagnosed', mode TEXT DEFAULT 'on', attempts INTEGER DEFAULT 0, verify_passes INTEGER DEFAULT 0, error_code TEXT, diagnosed_at TEXT, applied_at TEXT, verified_at TEXT);
  CREATE VIEW v_breach_diagnosis_current AS SELECT d.* FROM breach_diagnoses d WHERE d.id = (SELECT MAX(x.id) FROM breach_diagnoses x WHERE x.issue_id = d.issue_id);
  CREATE TABLE breach_selfheal_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')), check_class TEXT, subject TEXT NOT NULL, action TEXT, revert TEXT, evidence TEXT);
  CREATE TABLE v_issue_age_ladder (id INTEGER, title TEXT, priority TEXT, source TEXT, age_h REAL, doer TEXT, plan_outcome TEXT, planned_at TEXT, plan_reason TEXT, rung TEXT, breach INTEGER);
  CREATE VIEW v_issue_queue AS SELECT ROW_NUMBER() OVER (ORDER BY q.prank, q.id) AS pos, q.* FROM (SELECT a.id, CASE a.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END AS prank, a.priority, a.title, a.category, a.source, t.owner, t.triage_state, CASE WHEN COALESCE(a.description,'') LIKE '%code-task:%' THEN 1 ELSE 0 END AS has_code_task, CASE WHEN EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = a.id AND c.status = 'active') THEN 1 ELSE 0 END AS has_contract, a.linked_session, a.created_at, a.updated_at FROM agent_issues a LEFT JOIN issue_triage t ON t.issue_id = a.id WHERE a.status = 'open') q;`);
  if (extra.noMarkers) db.exec("DROP TABLE default_approve_markers");
  else if (!extra.emptyMarkers) for (const pat of HARD) db.prepare("INSERT INTO default_approve_markers (kind, pattern, note) VALUES ('hard', ?, 'live')").run(pat);
  db.prepare("INSERT INTO fleet_dashboard_state VALUES (1,?,?,1)").run(new Date().toISOString(), JSON.stringify(STATE));
  if (!extra.noCard) db.prepare("INSERT INTO human_actions (slug,title,why,default_in_effect,action,source) VALUES (?,?,?,?,?,?)").run(SLUG, "UIA-SOURCE-FIDELITY-1: approve or decline the seven fixes to the Ignorance Audit papers", "IDENTITY-BOUND: edits to the author's own paper bodies (authorship attribution and wording); loops never rewrite owner-authored papers.", "The papers stay as published.", "Approve or decline each of the seven fixes in agent_issues 100140. On approval the fleet applies them through the owner-document edit path and the issue closes on its own probe.", "claude-session");
  if (extra.second) db.prepare("INSERT INTO human_actions (slug,title,why,default_in_effect,action,source) VALUES ('pick-pricing-model','Pick one pricing model for the API','The owner chooses; no loop can.','The current model stays.','Approve: model A (flat) or model B (metered).','claude-session')").run();
  if (extra.shapes) {
    const ins = db.prepare("INSERT INTO human_actions (slug,title,why,default_in_effect,action,source) VALUES (?,?,?,?,?,?)");
    ins.run("tilburg-dis-phd-inquiry-send", "Send the PhD inquiry to Tilburg DIS", "IDENTITY-BOUND: it goes out in the owner's name from the owner's mailbox; a loop cannot send it.", "No inquiry is sent.", "Read the drafted inquiry and send an email from your address.", "claude-session");
    ins.run("domain-renewal-qnfo", "Renew qnfo.org before it expires", "IDENTITY-BOUND: the renewal is paid with the owner's money at the registrar.", "The domain lapses.", "Pay the renewal at the registrar.", "claude-session");
    ins.run("eb1a-statement-email984", "Sign or decline the EB-1A statement", "IDENTITY-BOUND: a legal statement in the owner's name; its signature is a legal act.", "Nothing is signed.", "Sign or decline the EB-1A recommendation statement.", "claude-session");
    ins.run("approve-logo-refresh", "Approve the refreshed logo", "The owner picks the brand; no loop can.", "The current logo stays.", "Approve the refreshed logo shown on the brand page, or decline it.", "claude-session");
  }
  if (extra.plain) db.prepare("INSERT INTO human_actions (slug,title,why,action,source) VALUES ('orcid-link-works','Add the selected works to ORCID','issue 1001 found the gap','act','owner-only:x')").run();
  // OWNER-REQUEST-RECEIPT-1: the card the close trigger writes when an owner-request issue ends ('Closed for you'); its title can hold the word Approve
  if (extra.receipt) {
    db.prepare("INSERT INTO human_actions (slug,title,why,default_in_effect,action,source) VALUES ('issue-1000100',?,?,?,?,'owner-request-issue')").run("OWNER-TASK-op-mvln7t9l2192: Approve the refreshed logo", "Your request (issue 1000100) was closed by the fleet with evidence.", "Nothing is waiting on you.", "Open fleet.qnfo.org and decide or dismiss this card.");
    db.prepare("INSERT INTO agent_issues (id,title,description,category,priority,status,created_at,updated_at) VALUES (1000100,'OWNER-TASK-op-mvln7t9l2192: Approve the refreshed logo','Approve the refreshed logo.','owner','medium','closed',1791217360000,1791217360000)").run();
  }
  for (const [slug, title, why, action] of extra.cards || []) db.prepare("INSERT INTO human_actions (slug,title,why,action,source) VALUES (?,?,?,?,'claude-session')").run(slug, title, why, action);
  if (extra.noSource) db.exec("ALTER TABLE human_actions DROP COLUMN source");
  db.prepare("INSERT INTO agent_issues (id,title,description,category,priority,created_at,updated_at) VALUES (100140,'UIA-SOURCE-FIDELITY-1: fix factual inconsistencies in the Ignorance Audit papers found while red-teaming the poster',?,'pipeline','medium',1791217360000,1791217360000)").run(DESC);
  db.prepare("INSERT INTO agent_issues (id,title,description,category,priority,created_at,updated_at) VALUES (1001,'METRIC-TRIGGER-7: pageviews low','The lever is X.','analytics','medium',1791217360000,1791217360000)").run();
  db.prepare("INSERT INTO agent_issues (id,title,description,category,priority,created_at,updated_at) VALUES (1002,'CRIT thing','nothing','reliability','critical',1791217360000,1791217360000)").run();
  db.prepare("INSERT INTO issue_triage (issue_id,rc,owner,sla_due_at) VALUES (100140,'AUTOTRIAGE-2','qnfo-ops',datetime('now'))").run();
  db.prepare("INSERT INTO issue_triage (issue_id,rc,owner,sla_due_at) VALUES (1001,'AUTOTRIAGE-2','qnfo-ops',datetime('now'))").run();
  db.prepare("INSERT INTO remediation_contracts (class,issue_id,verify_probe,verify_transport,last_verdict,attempts,max_attempts,escalate_to,next_due_at) VALUES ('issue-100140',100140,'SELECT 1','d1-query','fail',230,3,'qnfo-fleet-control','2026-10-26 06:04:30')").run();
  db.prepare("INSERT INTO remediation_contracts (class,issue_id,verify_probe,verify_transport,last_verdict,attempts,max_attempts,escalate_to) VALUES ('METRIC-7',1001,'SELECT 1','d1-query','fail',1,3,'qnfo-ops')").run();
  db.prepare("INSERT INTO v_issue_age_ladder (id,title,priority,age_h,doer,plan_outcome,plan_reason,rung) VALUES (100140,'t','medium',163.1,NULL,'not-code','content correction of owner papers','24h')").run();
  const prep = (sql) => { let a = []; const q = { bind(...x) { a = x.map((v) => (v === undefined ? null : v)); return q; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async run() { const r = db.prepare(sql).run(...a); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }, async first() { return db.prepare(sql).get(...a) || null; } }; return q; };
  const aiCalls = [], svcCalls = [];
  const ai = extra.ai || (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: "model answer", actions: [] }) } }] }), { status: 200 }));
  const m = mailer();
  const env = Object.assign({ AUDIT: { prepare: prep, async batch(list) { const out = []; db.exec("BEGIN"); try { for (const s of list) out.push(await s.run()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return out; } }, LOOP_TOKEN: LOOP, SEND_EMAIL: m.SEND_EMAIL, SVC_QNFO_AI: { fetch: async (u, o) => { aiCalls.push(o); return ai(u, o); } }, SVC_QNFO_OPS: { fetch: async (u, o) => { svcCalls.push({ u, o }); return new Response("ops ok", { status: 200 }); } } }, extra.env || {});
  return { env, db, aiCalls, svcCalls, m };
}
const pending = [];
const ctx = { waitUntil(p) { pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };
const O = "https://fleet.qnfo.org";
const call = (env, path, init) => worker.fetch(new Request(O + path, init), env, ctx);
const post = (env, path, body, headers) => call(env, path, { method: "POST", headers: Object.assign({ "Content-Type": "application/json", "x-fleet-ui": "1" }, headers || {}), body: JSON.stringify(body) });
const cmd = (env, text, headers) => post(env, "/api/cmd", { text, from: "" }, headers);
const run = (env, op, args, headers) => post(env, "/api/cmd/run", { op, args }, headers);
const flush = async () => { while (pending.length) await pending.shift(); };
function mailer() { const sent = []; return { sent, SEND_EMAIL: { async send(m) { sent.push(m); return { messageId: "m" + sent.length }; } } }; }
async function signIn(env, db, m) {
  try { db.prepare("UPDATE owner_codes SET created_ms = created_ms - 120000").run(); } catch (err) { /* first sign-in: the table is created by the first request */ }
  await post(env, "/api/cmd/code", {});
  const code = /(\d{6})/.exec(m.sent[m.sent.length - 1].subject)[1];
  const r = await post(env, "/api/cmd/verify", { code });
  return { Cookie: /fleet_cmd=[0-9a-f]{64}/.exec(r.headers.get("Set-Cookie"))[0] };
}
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };
const rows = (db, sql, ...a) => db.prepare(sql).all(...a);
const one = (db, sql, ...a) => db.prepare(sql).get(...a);
const noModel = (e) => e.aiCalls.length === 0 && e.svcCalls.length === 0;
// ONE-TAP-DECISIONS-1 (1.71.0): Approve and Decline are one-tap buttons (data-dec-op, data-dec-args) that run at the tap; tap() is the attribute string of one
const tap = (op, key, items) => 'data-dec-op="' + op + '" data-dec-args="' + JSON.stringify(items ? { key, items } : { key }).replace(/"/g, "&quot;") + '"';
// the buttons of a rendered page as { label, op, args }, read the way the browser script reads them
const taps = (html) => [...html.matchAll(/<button type="button" class="[^"]*" data-dec-op="(approve|decline)" data-dec-args="([^"]*)">([^<]*)</g)].map((m) => ({ op: m[1], args: JSON.parse(m[2].replace(/&quot;/g, '"')), label: m[3] }));

// T1. the five lines the owner typed (and the long sentence) are commands: no model call, one approve button, destructive
{
  const e = mk();
  const lines = ["Approve UIA-SOURCE-FIDELITY-1", "Approve each of the seven fixes in agent_issues 100140. Items 2, 4 and 5 are authorship wording; 6 and 7 sit in an external repository and a registry.", "Approve", "approve 100140", "approve #100140", "authorize issue 100140", "ratify ha:" + SLUG];
  for (const l of lines) {
    const r = await cmd(e.env, l); const j = await r.json();
    const a = (j.actions || []).find((x) => x.op === "approve");
    ok(r.status === 200 && j.kind === "answer" && a && a.destructive === true && a.args.key === "ha:" + SLUG && a.args.issue === 100140, "T1 '" + l.slice(0, 40) + "' is an approve button for the 100140 card", j);
    ok(a && a.args.items.length === 7 && /all 7 fixes of issue 100140 \(UIA-SOURCE-FIDELITY-1\)/.test(a.label), "T1b '" + l.slice(0, 30) + "' approves all seven and says so", a && a.label);
  }
  const r = await cmd(e.env, "decline 100140"); const j = await r.json();
  const d = (j.actions || []).find((x) => x.op === "decline");
  ok(d && d.destructive === false && d.args.items.length === 7, "T1c decline is a button that is not destructive", j);
  await flush();
  ok(noModel(e) && rows(e.db, "SELECT id FROM cmd_log WHERE kind = 'ai'").length === 0, "T1d none of them reached the AI path (no model call, no ai row in cmd_log)", { ai: e.aiCalls.length, svc: e.svcCalls.length });
  ok(rows(e.db, "SELECT * FROM human_responses").length === 0 && one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "open", "T1e typing never decides anything");
}
// T2. a bare approve: the one decision card; with a second one, buttons and no op
{
  const e = mk();
  let j = await (await cmd(e.env, "approve")).json();
  ok(j.actions && j.actions.some((a) => a.op === "approve" && a.args.key === "ha:" + SLUG), "T2 a bare approve resolves to the one owner-gated card", j);
  const e2 = mk({ second: true, plain: true });
  j = await (await cmd(e2.env, "approve")).json();
  ok(!(j.actions || []).some((a) => a.op) && (j.actions || []).filter((a) => /^approve /.test(a.cmd || "")).length === 2 && /Pick one/.test(j.text), "T2b with two decision cards a bare approve returns two choices and no op (the plain card is not offered)", j);
  ok((j.actions || []).some((a) => a.cmd === "approve ha:pick-pricing-model"), "T2c each choice is a typed command with the exact key");
  const e3 = mk({ noCard: true });
  j = await (await cmd(e3.env, "approve")).json();
  ok(/Nothing is waiting on a decision/.test(j.text) && !(j.actions || []).some((a) => a.op), "T2d with nothing waiting it says so", j);
  j = await (await cmd(e2.env, "approve 100140 7")).json();
  ok((j.actions || []).some((a) => a.op === "approve" && a.args.items.join() === "7"), "T2e a number after the id is an item, not a queue number", j);
  j = await (await cmd(e2.env, "approve 424242")).json();
  ok(/Nothing matches|No open owner card/.test(j.text) && !(j.actions || []).some((a) => a.op), "T2f an unknown explicit reference is said plainly, never guessed", j);
  j = await (await cmd(e2.env, "approve zzzqq")).json();
  ok(j.kind === "pending" && !(j.actions || []).some((a) => a.op), "T2g a word that names nothing is not a reference: the model gets the line", j);
}
// T3. a bare six-digit line is an issue id unless a sign-in code is waiting
{
  const e = mk();
  let j = await (await cmd(e.env, "100140")).json();
  ok(/#100140 \[medium\] open/.test(j.text || "") && !/code/i.test(j.error || ""), "T3 100140 with no code waiting is 'issue 100140'", j);
  await post(e.env, "/api/cmd/code", {});
  ok(rows(e.db, "SELECT id FROM owner_codes WHERE used_ms IS NULL").length === 1, "T3a a code is now waiting");
  const r = await cmd(e.env, "100140"); j = await r.json();
  ok(r.status === 401 && /not right/.test(j.error || ""), "T3b with a code waiting a bare six digits is still a code attempt", j);
  ok(one(e.db, "SELECT tries FROM owner_codes").tries === 1, "T3c and it counted as a try");
}
// T4. reject/ratify of an id that is not an objective revision
{
  const e = mk();
  e.db.prepare("INSERT INTO goals (id, goal_type, status, statement) VALUES (12, 'objective-revision', 'proposed', 'Weight cost 0.2')").run();
  let j = await (await cmd(e.env, "reject 100140")).json();
  ok((j.actions || []).some((a) => a.op === "decline" && a.args.key === "ha:" + SLUG) && !(j.actions || []).some((a) => a.op === "reject"), "T4 'reject 100140' is a decline of the card, not an objective op", j);
  j = await (await cmd(e.env, "ratify 100140")).json();
  ok((j.actions || []).some((a) => a.op === "approve"), "T4b 'ratify 100140' is an approve", j);
  j = await (await cmd(e.env, "reject 12")).json();
  ok((j.actions || []).some((a) => a.op === "reject" && a.args.id === 12), "T4c 'reject 12' is still the objective revision", j);
  j = await (await cmd(e.env, "ratify objective #12")).json();
  ok((j.actions || []).some((a) => a.op === "ratify" && a.args.id === 12), "T4d 'ratify objective #12' is unchanged", j);
}
// T5. a stranger gets the button, then the code prompt, and nothing is written
{
  const e = mk();
  const j = await (await cmd(e.env, "approve 100140")).json();
  const a = j.actions.find((x) => x.op === "approve");
  const r = await run(e.env, a.op, a.args); const jr = await r.json();
  ok(r.status === 401 && jr.need === "code", "T5 running it without the owner's code is refused (need: code)", jr);
  const d = await run(e.env, "decline", a.args);
  ok(d.status === 401 && (await d.json()).need === "code", "T5b so is a decline");
  ok(rows(e.db, "SELECT * FROM human_responses").length === 0 && one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "open" && rows(e.db, "SELECT * FROM owner_prompts").length === 0, "T5c no row was written");
  ok(!/Whitcomb|forensic/.test(j.text), "T5d a stranger's preview does not show the text of the items", j.text);
}
// T6. the loop token holds no identity-bound decision
{
  const e = mk();
  const H = { "x-loop-token": LOOP };
  const j = await (await cmd(e.env, "approve 100140", H)).json();
  const a = j.actions.find((x) => x.op === "approve");
  for (const op of ["approve", "decline"]) {
    const r = await run(e.env, op, a.args, H); const jr = await r.json();
    ok(r.status === 400 && jr.ok === false && /own decision|email-code session/.test(jr.error), "T6 the loop token cannot " + op + " (" + (jr.error || "").slice(0, 50) + ")", jr);
  }
  ok(rows(e.db, "SELECT * FROM human_responses").length === 0 && one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "open", "T6b nothing changed");
}
// T7. approve needs a code from the last 15 minutes; decline does not
{
  const e = mk();
  const C = await signIn(e.env, e.db, e.m);
  const j = await (await cmd(e.env, "approve 100140", C)).json();
  const a = j.actions.find((x) => x.op === "approve");
  ok(!j.executed && a.destructive, "T7 a signed-in owner still gets a confirm button, never an auto-run approval", j);
  e.db.prepare("UPDATE owner_sessions SET verified_ms = verified_ms - 20 * 60000").run();
  let r = await run(e.env, "approve", a.args, C), jr = await r.json();
  ok(r.status === 401 && jr.need === "stepup" && rows(e.db, "SELECT * FROM human_responses").length === 0 && one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "open", "T7a after 20 minutes approve asks for a fresh code and writes nothing", jr);
  const dj = await (await cmd(e.env, "decline 100140 3 why the wording is the author's own", C)).json();
  const da = dj.actions.find((x) => x.op === "decline");
  r = await run(e.env, "decline", da.args, C); jr = await r.json();
  ok(r.status === 200 && jr.ok && one(e.db, "SELECT kind, credential FROM human_responses").kind === "decline", "T7b a decline runs on the 12 h session without a fresh code", jr);
  const C2 = await signIn(e.env, e.db, e.m);
  r = await run(e.env, "approve", a.args, C2); jr = await r.json();
  ok(r.status === 200 && jr.ok, "T7c with a fresh code the same approve succeeds", jr);
}
// T8. an approval: card, human_responses, issue stamp, ONE hand-off task; nothing claimed as applied
{
  const e = mk();
  const C = await signIn(e.env, e.db, e.m);
  const j = await (await cmd(e.env, "Approve each of the seven fixes in agent_issues 100140.", C)).json();
  const a = j.actions.find((x) => x.op === "approve");
  ok(/Whitcomb|91\(1\)/.test(j.text) && /1\) /.test(j.text) && /7\) /.test(j.text), "T8 the owner's preview lists the seven items", j.text);
  const r = await run(e.env, "approve", a.args, C); const jr = await r.json();
  ok(r.status === 200 && jr.ok, "T8a the approval runs", jr);
  const card = one(e.db, "SELECT status, resolution FROM human_actions WHERE slug = ?", SLUG);
  ok(card.status === "resolved" && /^approve via dashboard by owner \(fleet\.qnfo\.org, emailed code\): approved 1-7/.test(card.resolution), "T8b the card is resolved and says what was approved", card);
  const hr = rows(e.db, "SELECT key, kind, note, credential FROM human_responses");
  ok(hr.length === 1 && hr[0].key === "ha:" + SLUG && hr[0].kind === "approve" && hr[0].credential === "owner-session" && hr[0].note === "items 1-7; issue 100140;", "T8c one human_responses row, credential owner-session, a readable note with the items and the issue", hr);
  const d = one(e.db, "SELECT description FROM agent_issues WHERE id = 100140").description;
  ok(/OWNER-DECISION approve items 1-7 on card ha:uia-source-fidelity-100140/.test(d) && /not applied by this line/.test(d), "T8d the issue carries an OWNER-DECISION line that does not claim the papers changed", d.slice(-300));
  const tasks = rows(e.db, "SELECT prompt, mode FROM owner_prompts WHERE mode = 'task'");
  ok(tasks.length === 1 && /OWNER-DECISION from fleet\.qnfo\.org/.test(tasks[0].prompt), "T8e exactly ONE hand-off task is filed through the task route", tasks.length);
  const p = tasks[0].prompt;
  ok(/APPROVED items 1-7 of 7/.test(p) && /1\) ai4metascience-ignorance-audit section 2/.test(p) && /7\) The registry entry/.test(p) && /the full text of each is in issue 100140/.test(p), "T8f it names every approved item (clipped to fit, with the issue that holds the full text)", p);
  ok(/Card: UIA-SOURCE-FIDELITY-1: approve or decline the seven fixes/.test(p) && /Asked: Approve or decline each of the seven fixes in agent_issues 100140/.test(p) && p.length <= 1800 && /Closing probe: remediation contract issue-100140/.test(p.slice(-400)), "T8f2 it carries the card's title and what it asks, fits the 1800 characters the issue body keeps, and still ends with the doer and the closing probe", p.length);
  ok(/revision and errata path of qnfo-research-exec/.test(p) && /remediation contract issue-100140/.test(p) && /Close issue 100140 only with that evidence/.test(p), "T8g it names the doer (the revision and errata path) and the issue's closing probe", p);
  ok(rows(e.db, "SELECT id FROM agent_issues WHERE title LIKE 'OWNER-TASK-%'").length === 1 && jr.text.indexOf("issue ") >= 0, "T8h the task became an issue the issue loop reads", jr.text);
  ok(/Nothing has been applied yet/.test(jr.text) && !/papers (were|are|have been) (changed|corrected|updated|applied)|were applied|fixes (are|were) applied/.test(jr.text), "T8i the reply never claims the papers changed", jr.text);
  const again = await run(e.env, "approve", a.args, C); const ja = await again.json();
  ok(ja.ok && /already resolved/.test(ja.text) && rows(e.db, "SELECT * FROM human_responses").length === 1 && rows(e.db, "SELECT * FROM owner_prompts WHERE mode = 'task'").length === 1, "T8j a second tap changes nothing and files no second task", ja);
}
// T9. item by item: 1-5 approved, 6 and 7 declined with a reason; the card closes only when all seven are decided
{
  const e = mk();
  const C = await signIn(e.env, e.db, e.m);
  const typed = async (text, op) => { const j = await (await cmd(e.env, text, C)).json(); const a = (j.actions || []).find((x) => x.op === op); return a ? await (await run(e.env, op, a.args, C)).json() : { ok: false, preview: j }; };
  let jr = await typed("approve 100140 1-5", "approve");
  ok(jr.ok && one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "open" && /6-7 left/.test(jr.text), "T9 approving 1-5 leaves the card open with 6-7 left", jr);
  const t1 = rows(e.db, "SELECT prompt FROM owner_prompts WHERE mode = 'task'");
  ok(t1.length === 1 && /APPROVED items 1-5 of 7/.test(t1[0].prompt) && !/6\) The poster/.test(t1[0].prompt) && /Not approved here \(declined or still undecided\): 6-7/.test(t1[0].prompt), "T9a the hand-off names 1-5 only and leaves 6-7 alone", t1[0] && t1[0].prompt);
  jr = await typed("decline 100140 6,7 why the repository and registry are not mine", "decline");
  ok(jr.ok && one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "resolved", "T9b declining 6,7 closes the card (some approved: resolved)", jr);
  ok(rows(e.db, "SELECT * FROM owner_prompts WHERE mode = 'task'").length === 1, "T9c a decline files no task");
  const resolution = one(e.db, "SELECT resolution FROM human_actions WHERE slug = ?", SLUG).resolution;
  ok(/approved 1-5, declined 6-7/.test(resolution) && /the repository and registry are not mine/.test(resolution), "T9d the resolution says both, with the reason", resolution);
  const iss = one(e.db, "SELECT description FROM agent_issues WHERE id = 100140").description;
  ok(/OWNER-DECISION approve items 1-5/.test(iss) && /OWNER-DECISION decline items 6-7/.test(iss), "T9e the issue carries both decisions", iss.slice(-500));
  const e2 = mk();
  const C2 = await signIn(e2.env, e2.db, e2.m);
  const j2 = await (await cmd(e2.env, "approve all 100140 except 6", C2)).json();
  ok(j2.actions.find((x) => x.op === "approve").args.items.join() === "1,2,3,4,5,7", "T9f 'except 6' leaves item 6 out", j2.actions);
  const j3 = await (await cmd(e2.env, "approve 100140 9", C2)).json();
  ok(/no item 9/.test(j3.text) && !(j3.actions || []).some((x) => x.op), "T9g an item that is not on the card is refused", j3);
  const j4 = await (await cmd(e2.env, "decline 100140 all", C2)).json();
  const r4 = await run(e2.env, "decline", j4.actions.find((x) => x.op === "decline").args, C2);
  ok((await r4.json()).ok && one(e2.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "dismissed" && rows(e2.db, "SELECT * FROM owner_prompts").length === 0, "T9h declining everything dismisses the card and files nothing");
}
// T10. the model is down (504): the matched intent comes back as buttons, stored; the quick buttons show while it thinks
{
  const e = mk({ ai: async () => new Response("{}", { status: 504 }) });
  const r = await cmd(e.env, "Could you please approve each of the seven fixes in agent_issues 100140 for me?"); const j = await r.json();
  ok(r.status === 202 && j.kind === "pending" && j.quick && j.quick.actions.some((a) => a.cmd === "approve ha:" + SLUG), "T10 the 202 carries quick buttons for what the line asks", j);
  await flush();
  const jb = await (await call(e.env, "/api/cmd/job/" + j.id)).json();
  ok(jb.status === "fallback" && jb.actions.some((a) => a.cmd === "approve ha:" + SLUG) && jb.actions.some((a) => a.cmd === "decline ha:" + SLUG) && jb.actions.some((a) => /^diagnose /.test(a.cmd)), "T10a the fallback answer has Approve, Decline and Diagnose buttons", jb);
  ok(!/Nothing was changed/.test(jb.answer) && /did not answer just now \(it timed out|the model service answered HTTP 504|unavailable|timed out/.test(jb.answer) && /UIA-SOURCE-FIDELITY-1/.test(jb.answer) && /none has run yet/.test(jb.answer), "T10b the answer is the match, not the generic stored-data block", jb.answer);
  const row = one(e.db, "SELECT actions_json, status FROM cmd_log WHERE id = ?", j.id);
  ok(row.status === "fallback" && JSON.parse(row.actions_json).length >= 3, "T10c actions_json is stored on the fallback row", row);
  const e2 = mk({ ai: async () => new Response("{}", { status: 504 }) });
  const j2 = await (await cmd(e2.env, "how is the weather in the data center")).json();
  await flush();
  const b2 = await (await call(e2.env, "/api/cmd/job/" + j2.id)).json();
  ok(j2.quick === undefined && /does not cover this question/.test(b2.answer) && b2.actions.map((a) => a.cmd).join() === "queue,suggest,issues", "T10d a line with no match keeps the stored-data answer and adds queue, suggest and issues buttons", b2);
  const e3 = mk();
  const j3 = await (await cmd(e3.env, "tell me about the fleet's papers")).json();
  ok(j3.kind === "pending" && j3.quick === undefined, "T10e an ordinary question has no quick block", j3);
  const j4 = await (await cmd(e3.env, "how many pageviews did the Ignorance Audit papers get in 2026, about 123456?")).json();
  ok(j4.kind === "pending" && j4.quick === undefined, "T10f a number and words that happen to match a card do not make buttons without a decision word", j4);
}
// T11. resolve closes only on evidence
{
  const e = mk();
  const C = await signIn(e.env, e.db, e.m);
  let j = await (await cmd(e.env, "resolve 100140", C)).json();
  ok(/cannot be resolved from its probe/.test(j.text) && /no verification/.test(j.text) && !(j.actions || []).some((a) => a.op), "T11 with no verification resolve refuses and offers diagnose", j);
  e.db.prepare("INSERT INTO remediation_verifications (issue_id, class, observed, pass, verified_at, verifier) VALUES (100140, 'issue-100140', '0 rows', 0, '2026-10-26 05:00:00', 'remediation-tick')").run();
  j = await (await cmd(e.env, "resolve 100140", C)).json();
  ok(/newest check FAILED/.test(j.text) && !(j.actions || []).some((a) => a.op), "T11a a failing newest check refuses", j);
  e.db.prepare("INSERT INTO remediation_verifications (issue_id, class, observed, expected, pass, verified_at, verifier) VALUES (100140, 'issue-100140', 'papers carry 94(3), 509-539', '1', 1, '2026-10-26 06:00:00', 'remediation-tick')").run();
  j = await (await cmd(e.env, "resolve 100140", C)).json();
  const a = (j.actions || []).find((x) => x.op === "iclose");
  ok(a && a.destructive && a.args.id === 100140 && /passed at 2026-10-26 06:00:00 \(remediation-tick\): observed papers carry 94\(3\), 509-539/.test(a.args.evidence), "T11b a passing newest check proposes the destructive iclose with that evidence", j);
  const r = await run(e.env, "iclose", a.args, C);
  ok((await r.json()).ok && one(e.db, "SELECT status FROM agent_issues WHERE id = 100140").status === "closed" && /passed at/.test(one(e.db, "SELECT close_evidence FROM issue_triage WHERE issue_id = 100140").close_evidence), "T11c the close runs behind the fresh code and stores the evidence");
  j = await (await cmd(e.env, "resolve 1001 the pageview probe reads 5000 views in the last hour", C)).json();
  ok((j.actions || []).some((x) => x.op === "iclose" && x.args.evidence.indexOf("5000 views") >= 0), "T11d typed evidence is used when given", j);
  j = await (await cmd(e.env, "resolve all the issues", C)).json();
  await flush();
  ok(/Nothing was changed\. "Fix all the issues"/.test(j.text || "") || j.kind === "pending" || /open fleet issues/.test(j.text || ""), "T11e 'resolve all the issues' still reaches the fix-all digest, not the resolver", j);
  const e2 = mk({ plain: true });
  const C2 = await signIn(e2.env, e2.db, e2.m);
  const jc = await (await cmd(e2.env, "resolve orcid-link-works", C2)).json();
  ok((jc.actions || []).some((x) => x.op === "done" && x.args.key === "ha:orcid-link-works"), "T11f resolving a card is done", jc);
}
// T12. diagnose is an open read; titles only for the owner
{
  const e = mk();
  e.db.prepare("INSERT INTO breach_selfheal_actions (check_class, subject, action) VALUES ('post-deploy-errors', 'qnfo-ops', 'reverted the deploy of qnfo-ops 2.1.0')").run();
  e.db.prepare("INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, first_seen, issue_id) VALUES ('uia-source', 'owner papers drift from their sources', 'rc', 'rem', 'd', '2026-10-19', 100140)").run();
  e.db.prepare("INSERT INTO work_claims (path, intent, holder, issue_id, claimed_at, expires_at) VALUES ('issue:1001', 'fixing the lever', 'session_Z', 1001, ?, ?)").run(new Date().toISOString(), new Date(Date.now() + 36e5).toISOString());
  e.db.prepare("INSERT INTO issue_plans (issue_id, planned_at, outcome, task_id, path) VALUES (1001, '2026-10-26', 'planned', 'ct-1', 'qnfo-ops/worker.js')").run();
  e.db.prepare("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, pr_url, merge_state, updated_at) VALUES ('ct-1', 'qnfo-workers', 'qnfo-ops/worker.js', 'g', 'pr', 'merge', 1, 'https://github.com/QNFO/qnfo-workers/pull/42', 'pending', '2026-10-26')").run();
  let j = await (await cmd(e.env, "diagnose")).json();
  ok(j.ok !== false && /blocked/.test(j.text) && /#100140/.test(j.text) && !/factual inconsistencies/.test(j.text) && (j.actions || []).some((a) => a.cmd === "diagnose 100140"), "T12 bare diagnose lists the blocked issues as buttons, without titles for a stranger", j);
  j = await (await cmd(e.env, "diagnose 100140")).json();
  ok(j.ok !== false && /Diagnosis of #100140 \[medium\] open \(pipeline; titles are shown to the signed-in owner\)/.test(j.text) && !/Ignorance Audit/.test(j.text), "T12a diagnose <id> is open to a stranger and hides the title", j.text);
  ok(/Closing probe issue-100140: active, last verdict fail/.test(j.text) && /attempt 230 of 3/.test(j.text) && /next check 2026-10-26 06:04/.test(j.text), "T12b it names the contract verdict, attempts and the next probe time", j.text);
  ok(/Doer: none assigned, planner verdict not-code, age rung 24h/.test(j.text) && /Failure mode uia-source/.test(j.text), "T12c the doer and plan come from v_issue_age_ladder; the failure mode is shown", j.text);
  ok(/What this means: It is waiting on your decision/.test(j.text) && !(j.actions || []).some((a) => /^approve/.test(a.cmd || "")), "T12d it says in plain words that the owner card is what it waits on (a stranger gets no approve button)", j.text);
  ok(noModel(e), "T12e no model was called");
  j = await (await cmd(e.env, "diagnose 1001")).json();
  ok(/Live work claim: session_Z until/.test(j.text) && /Code task ct-1: pr\/merge/.test(j.text) && /pull\/42/.test(j.text) && /Self-heal \(breach_selfheal_actions, qnfo-ops/.test(j.text) && /What this means: session_Z is working on it/.test(j.text), "T12f a live claim, the code task with its PR, and the self-heal rows for the issue's owner are shown", j.text);
  const C = await signIn(e.env, e.db, e.m);
  j = await (await cmd(e.env, "diagnose UIA-SOURCE-FIDELITY-1", C)).json();
  ok(/Ignorance Audit papers/.test(j.text) && (j.actions || []).some((a) => a.cmd === "approve ha:" + SLUG) && (j.actions || []).some((a) => a.cmd === "decline ha:" + SLUG) && (j.actions || []).some((a) => a.cmd === "retry 100140"), "T12g the owner sees the title, Approve, Decline and Retry buttons", j);
  j = await (await cmd(e.env, "why 100140", C)).json();
  ok(/Diagnosis of #100140/.test(j.text), "T12h 'why <id>' is a diagnosis", j);
  // T12j-m. the doctor ledger: one line from v_breach_diagnosis_current, enums and ids only, never facts_json or action_ref
  e.db.prepare("INSERT INTO breach_diagnoses (issue_id, case_key, family, rule_id, rule_version, cause_class, facts_json, action_kind, action_ref, state, mode, verify_passes, diagnosed_at) VALUES (1001, 'k1', 'probe-needed', 'PN-R1', 2, 'probe-missing', '{\"secret\":\"FACTS-LEAK\"}', 'sql', 'REF-LEAK', 'verifying', 'on', 1, '2026-10-26T11:00:00Z')").run();
  j = await (await cmd(e.env, "diagnose 1001")).json();
  ok(/Breach doctor: probe-missing \(rule PN-R1 v2, probe-needed\), on mode, verifying, action sql, 1 verify pass, diagnosed 2026-10-26T11:00:00Z/.test(j.text), "T12j diagnose shows the doctor's latest diagnosis of the issue", j.text);
  ok(!/FACTS-LEAK|REF-LEAK/.test(j.text), "T12k facts_json and action_ref are never read into the answer", j.text);
  ok(/What this means: session_Z is working on it/.test(j.text), "T12l a live work claim still outranks the doctor in the plain-words meaning", j.text);
  e.db.prepare("DELETE FROM work_claims").run();
  e.db.prepare("UPDATE code_tasks SET last_error = NULL, pr_url = NULL").run();
  j = await (await cmd(e.env, "diagnose 1001")).json();
  ok(/What this means: The breach doctor is working on it \(rule PN-R1, verifying\)/.test(j.text), "T12m with no claim or task in the way a live on-mode diagnosis is the meaning", j.text);
  e.db.prepare("INSERT INTO breach_diagnoses (issue_id, case_key, family, rule_id, cause_class, action_kind, state, mode, diagnosed_at) VALUES (1001, 'k1', 'probe-needed', 'playbook-gap', 'unclassified', 'none', 'diagnosed', 'measure', '2026-10-26T12:00:00Z')").run();
  j = await (await cmd(e.env, "diagnose 1001")).json();
  ok(/Breach doctor: unclassified \(rule playbook-gap v1, probe-needed\), measure mode, diagnosed, no playbook acts on it/.test(j.text) && !/The breach doctor is working on it/.test(j.text), "T12n the newest row wins; a measure-mode classification says no playbook acts and claims no work", j.text);
  j = await (await cmd(e.env, "diagnose 100140")).json();
  ok(!/Breach doctor:/.test(j.text), "T12o an issue the doctor has not diagnosed prints no doctor line", j.text);
  j = await (await cmd(e.env, "why is the sky blue")).json();
  ok(j.kind === "pending", "T12i a 'why' question about nothing the fleet holds still goes to the model", j);
  j = await (await cmd(e.env, "why is open_agent_issues 254 against < 0, and what is the smallest fix?")).json();
  ok(j.kind === "pending", "T12i2 the metric Diagnose control's question stays with the model", j);
  j = await (await cmd(e.env, "why is issue 100140 stuck?")).json();
  ok(/Diagnosis of #100140/.test(j.text), "T12i3 'why is issue <id> stuck' is a diagnosis", j);
  j = await (await cmd(e.env, "what is wrong with 100140")).json();
  ok(/Diagnosis of #100140/.test(j.text), "T12j 'what is wrong with <id>' is a diagnosis", j);
  e.db.prepare("INSERT INTO remediation_verifications (issue_id, class, observed, pass, verified_at) VALUES (1001, 'METRIC-7', 'ok', 1, '2026-10-26 07:00:00')").run();
  j = await (await cmd(e.env, "diagnose 1001", C)).json();
  ok((j.actions || []).some((a) => a.cmd === "resolve 1001") && /Closing probe METRIC-7/.test(j.text), "T12k a passing probe offers Resolve", j);
  j = await (await cmd(e.env, "diagnose 424242")).json();
  ok(/Nothing matches|No issue/.test(j.text || j.error || ""), "T12l an unknown id is said plainly", j);
}
// T13. cmdFallback alone in a vm (the offline suites cut it out of the worker): the 2-argument form is unchanged, the 3-argument form returns the match
{
  const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
  const fb = cut("function cmdModelReason(err) {", "// What the owner reads for a request that has no answer at all");
  const sb = { String, JSON, Math, Date, Array, Object }; vm.createContext(sb);
  vm.runInContext(fb + "\n__f = { cmdFallback };", sb);
  const f = sb.__f;
  const plain = f.cmdFallback({ v: null }, "glm: timeout 13s");
  ok(/does not cover this question/.test(plain) && /Nothing was changed/.test(plain), "T13 the 2-argument fallback is the stored-data answer, unchanged", plain);
  const withLocal = f.cmdFallback({ v: null }, "glm: timeout 13s", { matched: true, text: "Matched: X.", actions: [{ cmd: "approve ha:x", label: "Approve" }] });
  ok(/These are the actions I can take without it/.test(withLocal) && /Matched: X\./.test(withLocal) && !/Nothing was changed/.test(withLocal) && !/does not cover/.test(withLocal), "T13a with a match it is the match and says nothing has run", withLocal);
  const unmatched = f.cmdFallback({ v: null }, "glm: timeout 13s", { matched: false, text: "", actions: [{ cmd: "queue", label: "Queue" }] });
  ok(/does not cover this question/.test(unmatched), "T13b an unmatched local result keeps the stored-data answer", unmatched);
}
// T14. the cards: buttons for the signed-in owner only, per item on a numbered card, 44 px, wrapped on a phone, kept by the refresh
{
  const e = mk({ plain: true });
  const stranger = await (await call(e.env, "/classic")).text();
  ok(!/data-fleet-cmd="approve /.test(stranger) && !/class="dec"/.test(stranger) && !/Approve 1</.test(stranger), "T14 a signed-out visitor sees no decision buttons", stranger.length);
  ok(/data-fleet-cmd="info ha:uia-source-fidelity-100140"/.test(stranger), "T14a (the public Details button is still there)");
  const C = await signIn(e.env, e.db, e.m);
  const owner = await (await call(e.env, "/classic", { headers: C })).text();
  ok(/<div class="dec" data-dec="ha:uia-source-fidelity-100140">/.test(owner), "T14b the signed-in owner sees the decision block on the owner-gated card", owner.slice(0, 200));
  for (let n = 1; n <= 7; n++) ok(owner.includes(tap("approve", "ha:" + SLUG, [n]) + ">Approve " + n + "<") && owner.includes(tap("decline", "ha:" + SLUG, [n]) + ">Decline " + n + "<"), "T14c item " + n + " has its own Approve and Decline");
  ok(owner.includes(tap("approve", "ha:" + SLUG) + ">Approve all 7<") && owner.includes(tap("decline", "ha:" + SLUG) + ">Decline all<") && owner.includes('data-fleet-cmd="diagnose ha:' + SLUG + '">Diagnose<') && /Decide each part: 0 of 7 decided/.test(owner), "T14d Approve all, Decline all and Diagnose are on the card", owner.slice(0, 100));
  ok(!/data-dec="ha:orcid-link-works"/.test(owner), "T14e a plain action card gets no decision block");
  ok(/\.dec button\{min-height:44px;min-width:44px/.test(owner) && /\.dec-i\{display:flex;flex-wrap:wrap/.test(owner) && /\.dec-t\{flex:1 1 240px;min-width:0/.test(owner) && /@media \(max-width:420px\)\{\.dec-b,\.dec-all\{width:100%\}/.test(owner), "T14f 44 px targets, wrapping rows and a 360 px rule are in the page CSS");
  ok(!/\.dec[^{]*:hover/.test(owner), "T14g nothing depends on hover");
  ok(/document\.addEventListener\('click',function\(e\)\{var t=e\.target&&e\.target\.closest&&e\.target\.closest\('\[data-fleet-cmd\]'\)/.test(owner), "T14h the click handler is delegated on document, so the refreshed #live fragment keeps working buttons");
  const frag = await (await call(e.env, "/?frag=1", { headers: C })).text();
  ok(frag.includes(tap("approve", "ha:" + SLUG, [3])), "T14i the 15 s fragment carries the same buttons", frag.length);
  const cs = /<script>(\(function\(\)\{var f=document\.getElementById\('cform'\)[\s\S]*?)<\/script>/.exec(owner);
  let parsed = true; try { new Function(cs[1]); } catch (err) { parsed = String(err); }
  ok(cs && parsed === true && /function acts\(p,list,c\)/.test(cs[1]) && /if\(j\.quick\)quick\(c,j\.quick\)/.test(cs[1]), "T14j the command-line script still parses and shows j.quick while the model thinks", parsed);
  await run(e.env, "decline", { key: "ha:" + SLUG, issue: 100140, items: [2], note: "" }, C);
  const after = await (await call(e.env, "/classic", { headers: C })).text();
  ok(/Decide each part: 1 of 7 decided/.test(after) && /&#10007; declined/.test(after) && after.includes(tap("approve", "ha:" + SLUG, [1, 3, 4, 5, 6, 7]) + ">Approve the 6 left<"), "T14k a decided item shows its state and the card offers the undecided rest", after.slice(after.indexOf('class="dec"'), after.indexOf('class="dec"') + 1800));
  const left = await (await cmd(e.env, "approve ha:" + SLUG + " 1, 3-7", C)).json();
  ok(left.actions.find((x) => x.op === "approve").args.items.join() === "1,3,4,5,6,7" && /Already decided: 2 decline/.test(left.text), "T14k2 the button's own command parses to the six undecided items", left);
  const single = mk({ noCard: true, second: true });
  const C3 = await signIn(single.env, single.db, single.m);
  const sp = await (await call(single.env, "/classic", { headers: C3 })).text();
  ok(sp.includes('data-fleet-fill="approve ha:pick-pricing-model ">Approve an option<') && !sp.includes(tap("approve", "ha:pick-pricing-model")) && sp.includes(tap("decline", "ha:pick-pricing-model") + ">Decline<"), "T14l a pick-one card gets 'Approve an option' (it fills the command line), Decline and Diagnose, never a bare Approve", sp.slice(0, 80));
  const plainDec = mk({ noCard: true, shapes: true });
  const C4 = await signIn(plainDec.env, plainDec.db, plainDec.m);
  const pp = await (await call(plainDec.env, "/classic", { headers: C4 })).text();
  ok(pp.includes(tap("approve", "ha:approve-logo-refresh") + ">Approve<") && pp.includes(tap("decline", "ha:approve-logo-refresh") + ">Decline<") && pp.includes('data-fleet-cmd="diagnose ha:approve-logo-refresh">Diagnose<'), "T14m a card that asks to be approved gets plain Approve, Decline and Diagnose", pp.slice(0, 80));
}
// T15. retry
{
  const e = mk({ ai: async () => new Response("{}", { status: 504 }) });
  const C = await signIn(e.env, e.db, e.m);
  let j = await (await cmd(e.env, "retry 100140", C)).json();
  ok(j.ok && j.executed === "iretry" && /due now/.test(j.text) && /has not run yet/.test(j.text), "T15 retry <issue> marks the closing probe due now and says it has not run", j);
  const k = one(e.db, "SELECT next_due_at, attempts FROM remediation_contracts WHERE class = 'issue-100140'");
  ok(k.attempts === 230 && Math.abs(Date.parse(k.next_due_at.replace(" ", "T") + "Z") - Date.now()) < 120000, "T15a next_due_at is now and attempts are untouched", k);
  ok(/retry: closing probe issue-100140 marked due now/.test(one(e.db, "SELECT description FROM agent_issues WHERE id = 100140").description), "T15b the issue carries the stamp");
  j = await (await cmd(e.env, "retry 1002", C)).json();
  ok(j.ok === false && /no active remediation contract/.test(j.error), "T15c an issue with no contract says so", j);
  const s = await (await cmd(e.env, "retry 100140")).json();
  ok(!s.executed && s.actions[0].op === "iretry", "T15d a stranger gets a button, not a run", s);
  const q = await (await cmd(e.env, "what is the state of the cloud", C)).json();
  await flush();
  const r1 = await (await cmd(e.env, "retry", C)).json();
  ok(r1.kind === "pending", "T15e a bare retry asks the last unanswered question again (through the model path)", r1);
  await flush();
  const row = one(e.db, "SELECT text FROM cmd_log WHERE id = ?", r1.id);
  ok(row.text === "what is the state of the cloud", "T15f with the text of that question", row);
  const e2 = mk();
  const j2 = await (await cmd(e2.env, "retry")).json();
  ok(/no unanswered question/.test(j2.text), "T15g with nothing to retry it says so", j2);
  j = await (await cmd(e.env, "retry run 123456789", C)).json();
  ok(j.ok === false || j.executed === "rerun", "T15h 'retry run <id>' maps to the existing rerun", j);
}
// T16. the help and the model's allowed commands
{
  const e = mk();
  const j = await (await cmd(e.env, "help")).json();
  ok(/approve \[<card>\] \[items\]/.test(j.text) && /diagnose \[<issue>\]/.test(j.text) && /resolve <issue> \[evidence\]/.test(j.text) && /snooze <item>/.test(j.text), "T16 help lists the new verbs and keeps the old ones", j.text.slice(-900));
  const rx = /var CON_AI_CMD = (\/.*\/i);/.exec(src);
  const re = new Function("return " + rx[1])();
  ok(re.test("diagnose 100140") && re.test("approve ha:uia-source-fidelity-100140 3") && re.test("decline 100140") && !re.test("approve 100140; drop table x") && !re.test("sql! delete from notes"), "T16a the model may propose typing diagnose, approve and decline, nothing else", rx[1].slice(0, 120));
}
// T17. the hand-off is filed BEFORE anything is recorded, and an approval never spends an Ask slot
const OWNER_PROMPTS_DDL = "CREATE TABLE IF NOT EXISTS owner_prompts (id TEXT PRIMARY KEY, ts TEXT DEFAULT (datetime('now')), mode TEXT, prompt TEXT, status TEXT, response TEXT, model TEXT, intent_id TEXT, error TEXT, issue_id INTEGER, visitor TEXT)";
const HUMAN_RESPONSES_DDL = "CREATE TABLE IF NOT EXISTS human_responses (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, kind TEXT NOT NULL, note TEXT, until TEXT, ts TEXT DEFAULT (datetime('now')), credential TEXT, issue_id INTEGER)";
const preview100140 = async (e, C) => (await (await cmd(e.env, "approve 100140", C)).json()).actions.find((x) => x.op === "approve");
{
  // a. the daily cap of the Ask route is used up: the owner's own approval is still filed and decided
  const e = mk({ env: { OWNER_PROMPTS_DAILY_CAP: "1" } });
  e.db.exec(OWNER_PROMPTS_DDL);
  e.db.prepare("INSERT INTO owner_prompts (id, mode, prompt, status) VALUES ('op-ask1', 'ask', 'how are things', 'answered')").run();
  const C = await signIn(e.env, e.db, e.m);
  const a = await preview100140(e, C);
  const r = await run(e.env, "approve", a.args, C); const jr = await r.json();
  ok(r.status === 200 && jr.ok && one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "resolved" && rows(e.db, "SELECT id FROM owner_prompts WHERE mode = 'task'").length === 1, "T17 with the Ask cap used up (cap 1, one Ask today) the approval is still filed and the card resolved", jr);
  const route = await post(e.env, "/api/owner/prompt", { text: "list the open owner cards", mode: "task" }, C);
  ok(route.status === 429, "T17a the Ask route itself still refuses at its cap (the cap is unchanged)", route.status);
  // b. the hand-off is not an Ask: with a cap of 1 and no Ask yet, one approval leaves the Ask route open
  const e2 = mk({ env: { OWNER_PROMPTS_DAILY_CAP: "1" } });
  const C2 = await signIn(e2.env, e2.db, e2.m);
  const a2 = await preview100140(e2, C2);
  await run(e2.env, "approve", a2.args, C2);
  const route2 = await post(e2.env, "/api/owner/prompt", { text: "list the open owner cards", mode: "task" }, C2);
  ok(rows(e2.db, "SELECT id FROM owner_prompts WHERE prompt LIKE 'OWNER-DECISION from %'").length === 1 && route2.status === 200, "T17b the approval's hand-off row does not count against the Ask cap (the next Ask is accepted)", route2.status);
}
{
  // c. the hand-off cannot be filed: nothing is recorded, the card stays open, the same tap files it
  const e = mk();
  const C = await signIn(e.env, e.db, e.m);
  const a = await preview100140(e, C);
  e.db.exec("CREATE TRIGGER t_nointents BEFORE INSERT ON intents BEGIN SELECT RAISE(ABORT, 'intents unavailable'); END");
  let r = await run(e.env, "approve", a.args, C), jr = await r.json();
  ok(jr.ok === false && /hand-off to the fleet could not be filed/.test(jr.error) && /still open/.test(jr.error) && /Tap Approve again/.test(jr.error), "T17c a hand-off that cannot be filed says so and says nothing was recorded", jr);
  ok(one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "open" && one(e.db, "SELECT COUNT(*) n FROM human_responses").n === 0 && !/OWNER-DECISION/.test(one(e.db, "SELECT description FROM agent_issues WHERE id = 100140").description) && one(e.db, "SELECT COUNT(*) n FROM owner_prompts").n === 0, "T17d the card is open, no human_responses row, no OWNER-DECISION line, no task row");
  e.db.exec("DROP TRIGGER t_nointents");
  r = await run(e.env, "approve", a.args, C); jr = await r.json();
  ok(jr.ok && one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "resolved" && rows(e.db, "SELECT id FROM owner_prompts WHERE mode = 'task'").length === 1 && one(e.db, "SELECT COUNT(*) n FROM human_responses WHERE kind = 'approve'").n === 1, "T17e the second tap files the task once, records the approval and resolves the card", jr);
  // d. the task is filed but the decision cannot be written: the retry finds the same task and files no second one
  const e2 = mk();
  const C2 = await signIn(e2.env, e2.db, e2.m);
  const a2 = await preview100140(e2, C2);
  e2.db.exec(HUMAN_RESPONSES_DDL);
  e2.db.exec("CREATE TRIGGER t_norec BEFORE INSERT ON human_responses WHEN NEW.kind = 'approve' BEGIN SELECT RAISE(ABORT, 'responses unavailable'); END");
  r = await run(e2.env, "approve", a2.args, C2); jr = await r.json();
  ok(jr.ok === false && /hand-off task was filed/.test(jr.error) && /Tap Approve again/.test(jr.error) && one(e2.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "open" && rows(e2.db, "SELECT id FROM owner_prompts WHERE mode = 'task'").length === 1, "T17f a decision that cannot be written after the task was filed says the task exists and the card stays open", jr);
  e2.db.exec("DROP TRIGGER t_norec");
  r = await run(e2.env, "approve", a2.args, C2); jr = await r.json();
  ok(jr.ok && /already queued/.test(jr.text) && rows(e2.db, "SELECT id FROM owner_prompts WHERE mode = 'task'").length === 1 && rows(e2.db, "SELECT id FROM agent_issues WHERE title LIKE 'OWNER-TASK-%'").length === 1 && one(e2.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "resolved", "T17g the retry finds the same task: one task row, one OWNER-TASK issue, the card resolved", jr);
}
{
  // e. the exemption is the server's marker, not the text: a stranger's Ask (or task) that merely starts with the hand-off words still counts
  const eh = mk({ env: { OWNER_PROMPTS_DAILY_CAP: "1" } });
  const Ch = await signIn(eh.env, eh.db, eh.m);
  const ah = await preview100140(eh, Ch);
  await run(eh.env, "approve", ah.args, Ch);
  ok(one(eh.db, "SELECT visitor FROM owner_prompts WHERE mode = 'task'").visitor === "owner-decision", "T17h the real hand-off row carries the server's marker (visitor owner-decision), which askVisitor() can never produce");
  const lookalike = (i) => "OWNER-DECISION from fleet.qnfo.org: the owner APPROVED item " + i;
  const sweep = async (cap, mode, text, hdr) => {
    const x = mk({ env: { OWNER_PROMPTS_DAILY_CAP: String(cap) } });
    const codes = [];
    for (let i = 1; i <= 6; i++) codes.push((await post(x.env, "/api/owner/prompt", { text: text(i), mode }, Object.assign({ "CF-Connecting-IP": "203.0.113." + i }, hdr || {}))).status);
    await flush();
    return { codes: codes.join(), stored: rows(x.db, "SELECT id FROM owner_prompts").length };
  };
  const plain = await sweep(2, "ask", (i) => "how are things today, question " + i);
  ok(plain.codes === "200,200,429,429,429,429" && plain.stored === 2, "T17i (control) six plain Asks from six visitors at a cap of 2: two are answered, four refused", plain);
  const fake = await sweep(2, "ask", lookalike);
  ok(fake.codes === plain.codes && fake.stored === 2, "T17j six stranger Asks that start 'OWNER-DECISION from' are counted exactly like plain ones (429 at the cap, two rows stored)", fake);
  const strangerTask = await sweep(2, "task", lookalike);
  ok(strangerTask.codes === "403,403,403,403,403,403" && strangerTask.stored === 0, "T17k a stranger cannot file mode task at all (the route refuses it)", strangerTask);
  const loopTask = await sweep(2, "task", lookalike, { "x-loop-token": LOOP });
  ok(loopTask.codes === "200,200,429,429,429,429" && loopTask.stored === 2, "T17l even a token holder's task that starts 'OWNER-DECISION from' is counted: only the server's own marker is exempt", loopTask);
}
// T18. Approve and Decline only for a card that ASKS for a decision and is not a legal, signing, money, credential or account step
{
  const e = mk({ noCard: true, shapes: true });
  const C = await signIn(e.env, e.db, e.m);
  const page = await (await call(e.env, "/classic", { headers: C })).text();
  ok(!page.includes('data-dec="ha:tilburg-dis-phd-inquiry-send"') && !page.includes('data-dec="ha:domain-renewal-qnfo"'), "T18 an IDENTITY-BOUND card that asks for no decision (send an e-mail, renew a domain) gets no decision block");
  const eb = 'ha:eb1a-statement-email984';
  ok(page.includes('data-dec="' + eb + '"') && page.includes('data-fleet-cmd="diagnose ' + eb + '">Diagnose<') && page.includes(tap("done", eb) + ">Done<") && !page.includes('data-fleet-cmd="approve ' + eb) && !page.includes('data-fleet-cmd="decline ' + eb) && /Only you can take this step/.test(page), "T18a the signing card (it says 'decline') shows Diagnose and Done only", page.slice(page.indexOf('data-dec="' + eb + '"'), page.indexOf('data-dec="' + eb + '"') + 600));
  ok(page.includes(tap("approve", "ha:approve-logo-refresh") + ">Approve<"), "T18b a plain decision card still has its Approve");
  for (const k of ["eb1a-statement-email984", "tilburg-dis-phd-inquiry-send", "domain-renewal-qnfo"]) {
    for (const verb of ["approve", "decline"]) {
      const j = await (await cmd(e.env, verb + " ha:" + k, C)).json();
      ok(!(j.actions || []).some((x) => x.op === verb) && (j.actions || []).some((x) => /^diagnose /.test(x.cmd || "")), "T18c typing '" + verb + " ha:" + k + "' offers no " + verb + " button, only Diagnose and Done", j);
      const r = await run(e.env, verb, { key: "ha:" + k, issue: null, items: null, note: "", title: "x" }, C); const jr = await r.json();
      ok(jr.ok === false && /does not ask for a decision|yours alone/.test(jr.error), "T18d running " + verb + " on " + k + " is refused by the server", jr);
    }
  }
  ok(one(e.db, "SELECT COUNT(*) n FROM human_actions WHERE status = 'open'").n === 4 && rows(e.db, "SELECT id FROM owner_prompts").length === 0 && one(e.db, "SELECT COUNT(*) n FROM human_responses").n === 0, "T18e nothing was resolved, recorded or handed to the fleet for any of the three");
  const j = await (await cmd(e.env, "diagnose ha:eb1a-statement-email984", C)).json();
  ok(/only you can take/.test(j.text) && !/Approve or decline it here/.test(j.text) && (j.actions || []).some((x) => x.cmd === "done " + eb), "T18f diagnose says it is the owner's own step and offers Done", j.text);
  // a marker added to default_approve_markers is honoured (the logo card turns into an owner-only step)
  const e2 = mk({ noCard: true, shapes: true });
  e2.db.prepare("INSERT INTO default_approve_markers (kind, pattern) VALUES ('hard', '%brand page%')").run();
  const C2 = await signIn(e2.env, e2.db, e2.m);
  const p2 = await (await call(e2.env, "/classic", { headers: C2 })).text();
  ok(!p2.includes('data-fleet-cmd="approve ha:approve-logo-refresh') && p2.includes(tap("done", "ha:approve-logo-refresh") + ">Done<"), "T18g a hard marker added in D1 takes effect on the next page", p2.length);
  // the markers cannot be read: the gate FAILS CLOSED (the embedded list is not a copy of the live one), so the logo card is owner-only too
  const e3 = mk({ noCard: true, shapes: true, noMarkers: true });
  const C3 = await signIn(e3.env, e3.db, e3.m);
  const p3 = await (await call(e3.env, "/classic", { headers: C3 })).text();
  ok(!p3.includes('data-fleet-cmd="approve ' + eb) && p3.includes(tap("done", eb) + ">Done<") && !p3.includes('data-fleet-cmd="approve ha:approve-logo-refresh') && p3.includes(tap("done", "ha:approve-logo-refresh") + ">Done<") && p3.includes('data-fleet-cmd="diagnose ha:approve-logo-refresh">Diagnose<'), "T18h without the markers table every decision card (the signing card and the logo card) offers Diagnose and Done only");
  // the 100140 card (authors' papers, IDENTITY-BOUND) is not a hard card
  const e4 = mk();
  const C4 = await signIn(e4.env, e4.db, e4.m);
  const p4 = await (await call(e4.env, "/classic", { headers: C4 })).text();
  ok(p4.includes(tap("approve", "ha:" + SLUG, [3]) + ">Approve 3<"), "T18i the seven-fix paper card keeps its buttons");
  // the alternate path of the gate (control_registry dash-owner-decision-hard-marker-gate): the owner's own step is closed with Done, which Approve never did
  const dn = await (await run(e.env, "done", { key: eb, title: "Sign or decline the EB-1A statement" }, C)).json();
  ok(dn.ok !== false && one(e.db, "SELECT status FROM human_actions WHERE slug = ?", "eb1a-statement-email984").status === "resolved" && rows(e.db, "SELECT id FROM owner_prompts").length === 0, "T18j Done on the signing card resolves it and files nothing for the fleet (the gate's alternate path works)", dn);
}
// T19. a card with no issue still hands the fleet a task it can act on; a pick-one card needs the option
{
  const e = mk({ noCard: true, shapes: true });
  const C = await signIn(e.env, e.db, e.m);
  const j = await (await cmd(e.env, "approve ha:approve-logo-refresh", C)).json();
  const a = (j.actions || []).find((x) => x.op === "approve");
  ok(a && a.args.issue === null, "T19 a card that names no issue previews an approve", j);
  const r = await run(e.env, "approve", a.args, C); const jr = await r.json();
  const p = (rows(e.db, "SELECT prompt FROM owner_prompts WHERE mode = 'task'")[0] || {}).prompt || "";
  ok(jr.ok && /Card: Approve the refreshed logo/.test(p) && /Asked: Approve the refreshed logo shown on the brand page/.test(p) && /Why: The owner picks the brand/.test(p) && /No issue is linked to this card/.test(p) && /the card text above is the whole brief/.test(p), "T19a the task carries the card's title, what it asks, why, and says no issue is linked", p);
  ok(/no issue is linked to this card, so there is no closing probe to cite/.test(jr.text) && !/closing probe of issue/.test(jr.text) && !/the loop that owns issue/.test(jr.text), "T19b the reply says what was filed: no issue, no closing probe, no named issue doer", jr.text);
  ok(one(e.db, "SELECT status FROM human_actions WHERE slug = 'approve-logo-refresh'").status === "resolved", "T19c the card is resolved");
  // pick one
  const e2 = mk({ noCard: true, second: true });
  const C2 = await signIn(e2.env, e2.db, e2.m);
  let j2 = await (await cmd(e2.env, "approve ha:pick-pricing-model", C2)).json();
  ok(!(j2.actions || []).some((x) => x.op) && /asks you to pick one/.test(j2.text) && (j2.actions || []).some((x) => x.fill === "approve ha:pick-pricing-model "), "T19d a bare approve on a pick-one card asks for the option and offers to fill the command line", j2);
  const rb = await run(e2.env, "approve", { key: "ha:pick-pricing-model", issue: null, items: null, note: "", title: "x" }, C2); const jb = await rb.json();
  ok(jb.ok === false && /pick one/.test(jb.error) && one(e2.db, "SELECT status FROM human_actions WHERE slug = 'pick-pricing-model'").status === "open" && rows(e2.db, "SELECT id FROM owner_prompts").length === 0, "T19e the server refuses a pick-one approval with no option and records nothing", jb);
  j2 = await (await cmd(e2.env, "approve ha:pick-pricing-model model B (metered) why cheaper to run", C2)).json();
  const a2 = (j2.actions || []).find((x) => x.op === "approve");
  ok(a2 && a2.args.choice === "model B (metered)" && a2.args.note === "cheaper to run", "T19f the typed option is the choice and the reason is separate", a2 && a2.args);
  const r2 = await run(e2.env, "approve", a2.args, C2); const jr2 = await r2.json();
  const p2 = (rows(e2.db, "SELECT prompt FROM owner_prompts WHERE mode = 'task'")[0] || {}).prompt || "";
  ok(jr2.ok && /Chosen option \(the owner's words\): model B \(metered\)/.test(p2) && /Card: Pick one pricing model for the API/.test(p2) && /Asked: Approve: model A \(flat\) or model B \(metered\)\./.test(p2), "T19g the task names the chosen option beside the card's own question", p2);
  ok(/model B \(metered\)/.test(one(e2.db, "SELECT resolution FROM human_actions WHERE slug = 'pick-pricing-model'").resolution) && /choice: model B \(metered\)/.test(one(e2.db, "SELECT note FROM human_responses WHERE kind = 'approve'").note), "T19h the choice is on the card's resolution and in human_responses");
  // nothing a doer could act on: no issue and no action text
  const e3 = mk({ noCard: true });
  e3.db.prepare("INSERT INTO human_actions (slug,title,why,action,source) VALUES ('approve-empty','Approve the thing','','Approve','x')").run();
  const C3 = await signIn(e3.env, e3.db, e3.m);
  const r3 = await run(e3.env, "approve", { key: "ha:approve-empty", issue: null, items: null, note: "", title: "x" }, C3); const j3 = await r3.json();
  ok(j3.ok === false && /names no issue and carries no action text/.test(j3.error) && one(e3.db, "SELECT status FROM human_actions WHERE slug = 'approve-empty'").status === "open" && rows(e3.db, "SELECT id FROM owner_prompts").length === 0, "T19i a card with nothing to apply is left open and no task is filed", j3);
}
// T20. a sentence that merely starts with a verb is the model's; retry runs unasked only for 'retry <reference>'
{
  const e = mk({ second: true, ai: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: "model answer", actions: [] }) } }] }), { status: 200 }) });
  const C = await signIn(e.env, e.db, e.m);
  const NL = ["Resolve next fleet open item and deploy", "Resolve all content queues", "RESOLVE ALL FLEET DASHBOARD PAGES AND DEPLOY", "Resolve GitHub PR #3608 and #3445 conflicts and merge to main", "Approve the Living Papers launch post", "Retry the failed deploy of PR #1001 and tell me why", "approve PR #1001", "approve zzzqq", "approve papers", "Approve 3 of the proposals"];
  let ip = 0;
  for (const l of NL) {
    for (const H of [{ "CF-Connecting-IP": "203.0.113." + (++ip) }, C]) {
      const j = await (await cmd(e.env, l, H)).json();
      ok(j.kind === "pending" && !/Nothing matches/.test(j.text || "") && !(j.actions || []).some((x) => x.op) && !j.executed, "T20 '" + l.slice(0, 44) + "' (" + (H === C ? "owner" : "visitor") + ") goes to the model, not to the verb grammar", j);
    }
  }
  await flush();
  ok(e.aiCalls.length >= NL.length, "T20a the model was called for each of them", e.aiCalls.length);
  ok(one(e.db, "SELECT next_due_at FROM remediation_contracts WHERE class = 'METRIC-7'").next_due_at === null && one(e.db, "SELECT COUNT(*) n FROM cmd_log WHERE kind = 'action'").n === 0, "T20b no probe was marked due and no action ran for any of them");
  const q = await (await cmd(e.env, "Approve the Living Papers launch post", { "CF-Connecting-IP": "198.51.100.1" })).json();
  ok(q.quick === undefined, "T20c one shared word ('papers') does not put the 100140 card's buttons beside the answer", q);
  const q2 = await (await cmd(e.env, "approve pricing model", { "CF-Connecting-IP": "198.51.100.2" })).json();
  ok(q2.kind === "pending" && q2.quick && q2.quick.actions.some((x) => x.cmd === "approve ha:pick-pricing-model"), "T20d two title words ('pricing model') are a match: a button beside the model's answer, never a run", q2);
  // the strict forms are commands
  let j = await (await cmd(e.env, "retry #1001", C)).json();
  ok(j.executed === "iretry", "T20e 'retry #1001' runs for the signed-in owner", j);
  j = await (await cmd(e.env, "retry 100140 please", C)).json();
  ok(!j.executed && j.actions && j.actions[0].op === "iretry" && /waits for your tap/.test(j.text), "T20f 'retry 100140 please' comes back as a button to tap", j);
  j = await (await cmd(e.env, "retry issue 100140", C)).json();
  ok(j.executed === "iretry", "T20g 'retry issue 100140' (nothing after the reference) runs", j);
  j = await (await cmd(e.env, "resolve 1001 the pageview probe reads 5000 views in the last hour", C)).json();
  ok((j.actions || []).some((x) => x.op === "iclose"), "T20h 'resolve <id> <evidence>' is still a command", j);
  j = await (await cmd(e.env, "approve 1001.")).json();
  ok(j.kind === "answer" && /No open owner card names issue 1001/.test(j.text || ""), "T20i0 a reference followed by a full stop is still a reference (answered in code, not sent to the model)", j);
  j = await (await cmd(e.env, "approve 424242 7")).json();
  ok(/Nothing matches|No open owner card/.test(j.text || ""), "T20i an explicit reference that resolves to nothing is said plainly", j);
  // the owner's own short lines (cmd_log 2026-10-24 00:10Z: "Approve all", "Approve") still resolve to the decision that waits
  const e1 = mk();
  for (const l of ["Approve all", "approve it", "Approve everything", "approve 1-5"]) {
    j = await (await cmd(e1.env, l)).json();
    ok(j.kind === "answer" && (j.actions || []).some((x) => x.op === "approve" && x.args.key === "ha:" + SLUG), "T20j '" + l + "' previews the one decision that waits", j);
  }
  j = await (await cmd(e.env, "Approve all")).json();
  ok(!(j.actions || []).some((x) => x.op) && /Pick one/.test(j.text), "T20k 'Approve all' with two decisions waiting asks which, and runs nothing", j);
}
// T20m. 'investigate ...' and 'diagnose ...' follow the same rule as approve, decline, retry and resolve: a sentence that merely starts with the verb is the
// model's (reviewers' reproduction at c65c6538: 'Investigate why the dashboard is slow' answered "Nothing matches", and 'investigate the Ignorance Audit papers'
// answered with the 100140 card because the single word 'papers' matched its title). The verb is a command only alone, or when a reference opens the argument.
{
  const e = mk({ second: true });
  e.db.prepare("INSERT INTO human_actions (slug,title,why,default_in_effect,action,source) VALUES ('dash-copy','Review the dashboard copy','The owner words the copy.','The copy stays.','Read the dashboard copy and say what to change.','claude-session')").run();
  const C = await signIn(e.env, e.db, e.m);
  const SENT = ["Investigate why the dashboard is slow", "investigate the slow dashboard", "diagnose the stuck integration chain", "diagnose why metrics are off target", "Investigate why https://papers.qnfo.org/papers/foo returns 404 and fix it", "investigate the Ignorance Audit papers", "Investigate why the deploy of qnfo-ops failed yesterday", "diagnose the deploy failures this week", "diagnose the dashboard latency and fix it", "investigate real-time lag", "diagnose real-time dashboard lag", "diagnose qnfo-ops deploy failures", "Diagnosis the stuck integration chain", "investigate cross-platform pricing model drift"];
  let ip = 0;
  for (const l of SENT) {
    for (const H of [{ "CF-Connecting-IP": "203.0.114." + (++ip) }, C]) {
      const j = await (await cmd(e.env, l, H)).json();
      ok(j.kind === "pending" && !/Nothing matches|Diagnosis of/.test(j.text || "") && !(j.actions || []).some((x) => x.op || /^diagnose/.test(x.cmd || "")) && !j.executed, "T20m '" + l.slice(0, 44) + "' (" + (H === C ? "owner" : "visitor") + ") goes to the model, not to the diagnose grammar", j);
    }
  }
  await flush();
  ok(e.aiCalls.length >= SENT.length * 2, "T20m1 the model was called for every one of them, owner and visitor", e.aiCalls.length);
  ok(rows(e.db, "SELECT id FROM cmd_log WHERE kind = 'answer'").length === 0 && one(e.db, "SELECT COUNT(*) n FROM cmd_log WHERE kind = 'action'").n === 0, "T20m2 none was answered in code and no action ran");
}
{
  // the strict forms stay commands and never call a model
  const e = mk({ second: true });
  e.db.prepare("INSERT INTO human_actions (slug,title,why,default_in_effect,action,source) VALUES ('dash-copy','Review the dashboard copy','The owner words the copy.','The copy stays.','Read the dashboard copy and say what to change.','claude-session')").run();
  const st = Object.assign({}, STATE, { scheduled: [{ name: "qnfo-ops", status: "OK", purpose: "ops", req24: 10, expected24: 10 }] });
  e.db.prepare("UPDATE fleet_dashboard_state SET state_json = ?").run(JSON.stringify(st));
  const C = await signIn(e.env, e.db, e.m);
  const CMD = [["Diagnose", /blocked/], ["diagnose UIA-SOURCE-FIDELITY-1", /Diagnosis of the owner card ha:uia-source-fidelity-100140|Diagnosis of #100140/], ["Investigate UIA-SOURCE-FIDELITY-1", /Diagnosis of/], ["investigate 100140", /Diagnosis of #100140/], ["diagnose #100140", /Diagnosis of #100140/], ["diagnose issue 100140", /Diagnosis of #100140/], ["diagnose ha:" + SLUG, /Diagnosis of the owner card ha:uia-source-fidelity-100140/], ["Diagnose HA:" + SLUG.toUpperCase(), /Nothing matches|Diagnosis of/], ["diagnose dash-copy", /Diagnosis of the owner card ha:dash-copy/], ["diagnose 100140 please", /Diagnosis of #100140/], ["diagnose qnfo-ops", /qnfo-ops - OK/], ["Diagnose Qnfo-Ops", /qnfo-ops - OK/], ["diagnose 424242", /Nothing matches|No issue/], ["diagnose 424242 please", /Nothing matches|No issue/], ["diagnose issue 424242", /Nothing matches|No issue/], ["investigate ha:no-such-card", /Nothing matches/], ["diagnose UIA-NO-SUCH-THING-1", /Nothing matches/]];
  let ip = 0;
  for (const [l, re] of CMD) {
    for (const H of [{ "CF-Connecting-IP": "203.0.115." + (++ip) }, C]) {
      const j = await (await cmd(e.env, l, H)).json();
      ok(j.kind === "answer" && re.test(j.text || ""), "T20n '" + l + "' (" + (H === C ? "owner" : "visitor") + ") is answered in code", j);
    }
  }
  await flush();
  ok(noModel(e), "T20n1 no model was called for any of them", { ai: e.aiCalls.length, svc: e.svcCalls.length });
  // a stranger's answer to the sentences carries no card title (the one-word 'dashboard' match used to name the dash-copy card)
  const j = await (await cmd(e.env, "investigate why the dashboard is slow", { "CF-Connecting-IP": "203.0.116.1" })).json();
  ok(j.kind === "pending" && !/dashboard copy|dash-copy/i.test(JSON.stringify(j)), "T20n2 the sentence names no card for a stranger", j);
}
// T21. a PR, run or commit number in a card's own text is never read as an agent_issues id (agent_issues 1001 exists and is unrelated)
{
  const mkpr = () => {
    const x = mk({ noCard: true });
    x.db.prepare("INSERT INTO human_actions (slug,title,why,default_in_effect,action,source) VALUES (?,?,?,?,?,?)").run("switch-summariser-model", "Approve switching the summariser model (PR #1001)", "The owner picks the model; the evidence is in issue 100140.", "The current model stays.", "Approve merging PR #1001 and run #1002, or decline it.", "claude-session");
    x.db.prepare("INSERT INTO human_actions (slug,title,why,default_in_effect,action,source) VALUES (?,?,?,?,?,?)").run("approve-pr-only", "Approve merging PR #1001", "The owner decides; pull request #1001 changes the footer.", "The footer stays.", "Approve merging PR #1001 or decline it. Commit #1002 is the head.", "claude-session");
    return x;
  };
  const e = mkpr();
  const C = await signIn(e.env, e.db, e.m);
  const j = await (await cmd(e.env, "approve ha:switch-summariser-model", C)).json();
  const a = (j.actions || []).find((x) => x.op === "approve");
  ok(a && a.args.issue === 100140, "T21 the primary issue is the one the card names as an issue (100140), never the PR number (1001)", a && a.args);
  const r = await run(e.env, "approve", a.args, C); const jr = await r.json();
  const p = (rows(e.db, "SELECT prompt FROM owner_prompts WHERE mode = 'task'")[0] || {}).prompt || "";
  ok(jr.ok && /issue 100140/.test(p) && !/issue 1001\b/.test(p) && !/METRIC-TRIGGER-7|METRIC-7/.test(p) && !/issue 1002\b/.test(p), "T21a the hand-off names issue 100140 and its probe, not the issue 1001 or 1002 rows that share the PR numbers", p.slice(-500));
  ok(/OWNER-DECISION/.test(one(e.db, "SELECT description FROM agent_issues WHERE id = 100140").description) && !/OWNER-DECISION/.test(one(e.db, "SELECT description FROM agent_issues WHERE id = 1001").description) && !/OWNER-DECISION/.test(one(e.db, "SELECT description FROM agent_issues WHERE id = 1002").description), "T21b only issue 100140 is stamped; the issues 1001 and 1002 are untouched");
  ok(!/METRIC-TRIGGER-7/.test(jr.text || "") && !/issue 1001\b/.test(jr.text || ""), "T21c the reply to the owner does not name the unrelated issue", jr.text);
  // a card that names only a PR has no issue at all
  const e2 = mkpr();
  const C2 = await signIn(e2.env, e2.db, e2.m);
  const j2 = await (await cmd(e2.env, "approve ha:approve-pr-only", C2)).json();
  const a2 = (j2.actions || []).find((x) => x.op === "approve");
  ok(a2 && a2.args.issue === null, "T21d a card whose only number is a PR number names no issue", a2 && a2.args);
  const r2 = await run(e2.env, "approve", a2.args, C2); const jr2 = await r2.json();
  const p2 = (rows(e2.db, "SELECT prompt FROM owner_prompts WHERE mode = 'task'")[0] || {}).prompt || "";
  ok(jr2.ok && /No issue is linked to this card/.test(p2) && !/OWNER-DECISION/.test(one(e2.db, "SELECT description FROM agent_issues WHERE id = 1001").description) && !/OWNER-DECISION/.test(one(e2.db, "SELECT description FROM agent_issues WHERE id = 1002").description), "T21e the hand-off says no issue is linked and no issue row is stamped", p2.slice(-400));
  // an issue reference written with # still counts, and "issue #1001" is an issue even beside a PR number
  const e3 = mk({ noCard: true });
  e3.db.prepare("INSERT INTO human_actions (slug,title,why,default_in_effect,action,source) VALUES (?,?,?,?,?,?)").run("approve-both", "Approve the fix for #100140 (PR #1001)", "The owner decides; also see issue #1001.", "The fix stays unapplied.", "Approve the fix or decline it.", "claude-session");
  const C3 = await signIn(e3.env, e3.db, e3.m);
  const j3 = await (await cmd(e3.env, "approve ha:approve-both", C3)).json();
  const a3 = (j3.actions || []).find((x) => x.op === "approve");
  ok(a3 && a3.args.issue === 100140, "T21f '#100140' still counts as an issue, and 'PR #1001' does not displace it", a3 && a3.args);
}
// T22. two approvals are two tasks. OWNER-PROMPT-TWIN-LINK-1 (bec42c88): ownerRequestIssue returns an OPEN owner-request ticket whose title text after
// the first ': ' is equal, and ownerNotesRoute keeps about 152 characters of the prompt there, so a hand-off whose first 152 characters match
// another's was silently attached to the first one's ticket ("Handed to the fleet as ONE task (issue N)" twice, one OWNER-TASK issue). What tells
// two decisions apart is now at the start of the text, and the server's own hand-off is never linked to a twin at all.
{
  const approveVia = async (e, C, line) => {
    const j = await (await cmd(e.env, line, C)).json();
    const a = (j.actions || []).find((x) => x.op === "approve");
    return a ? await (await run(e.env, "approve", a.args, C)).json() : { ok: false, preview: j };
  };
  const win = (title) => String(title).slice(String(title).indexOf(": ") + 2);
  const card = (db, slug, title, action) => db.prepare("INSERT INTO human_actions (slug,title,why,default_in_effect,action,source) VALUES (?,?,?,?,?,?)").run(slug, title, "The owner decides; no loop can.", "The current state stays.", action, "claude-session");
  const check = (e, keys, tag, replies) => {
    const issues = rows(e.db, "SELECT id, title FROM agent_issues WHERE title LIKE 'OWNER-TASK-%' ORDER BY id");
    const tasks = rows(e.db, "SELECT prompt, issue_id FROM owner_prompts WHERE mode = 'task' ORDER BY ts, rowid");
    ok(issues.length === keys.length && new Set(issues.map((x) => x.id)).size === keys.length, tag + " one OWNER-TASK issue per approval (" + keys.length + ")", issues);
    ok(tasks.length === keys.length && new Set(tasks.map((x) => x.issue_id)).size === keys.length && tasks.every((x) => x.issue_id), tag + "a every hand-off row carries its own issue id", tasks.map((x) => x.issue_id));
    const ids = replies.map((j) => (/Handed to the fleet as ONE task \(issue (\d+)\)/.exec(j.text || "") || [])[1]);
    ok(ids.every(Boolean) && new Set(ids).size === keys.length && !replies.some((j) => /already queued/.test(j.text || "")), tag + "b each reply names a different issue and none says the task was already queued", ids);
    ok(tasks.every((x, i) => { const at = x.prompt.indexOf("owner card " + keys[i]); return at >= 0 && at + ("owner card " + keys[i]).length <= 120; }), tag + "c the card key lies within the first 120 characters of each hand-off (independent of the twin check)", tasks.map((x) => x.prompt.slice(0, 130)));
    ok(issues.every((x, i) => win(x.title).indexOf("owner card " + keys[i]) >= 0) && new Set(issues.map((x) => win(x.title).toLowerCase())).size === keys.length, tag + "d the text the twin check compares (after the first ': ' of the ticket title) names its own card and differs between approvals", issues.map((x) => win(x.title)));
  };
  // a. decisions with no items: slugs that share their first letters, and the pair a reviewer proved collapsing
  for (const pair of [["approve-site-banner-refresh", "approve-site-footer-refresh"], ["brand-colour-choice", "brand-voice-guide"]]) {
    const e = mk({ noCard: true });
    for (const slug of pair) card(e.db, slug, "Approve the " + slug.replace(/-/g, " "), "Approve the " + slug.replace(/-/g, " ") + " shown on the site, or decline it.");
    const C = await signIn(e.env, e.db, e.m);
    const replies = [];
    for (const slug of pair) replies.push(await approveVia(e, C, "approve ha:" + slug));
    ok(replies.every((j) => j.ok), "T22 both approvals (" + pair[0] + ", " + pair[1] + ") run", replies);
    check(e, pair.map((s) => "ha:" + s), "T22 " + pair[0].slice(0, 12), replies);
  }
  // b. one item approved on each of two cards that name an issue of seven items each: the same 'item 1 of 7' on both
  {
    const e = mk();
    e.db.prepare("INSERT INTO agent_issues (id,title,description,category,priority,created_at,updated_at) VALUES (100150,'UIA-SOURCE-FIDELITY-2: fix factual inconsistencies in the second set of papers',?,'pipeline','medium',1791217360000,1791217360000)").run(DESC);
    card(e.db, "uia-source-fidelity-100150", "UIA-SOURCE-FIDELITY-2: approve or decline the seven fixes to the second set of papers", "Approve or decline each of the seven fixes in agent_issues 100150.");
    const C = await signIn(e.env, e.db, e.m);
    const r1 = await approveVia(e, C, "approve 100140 1");
    const r2 = await approveVia(e, C, "approve 100150 1");
    ok(r1.ok && r2.ok, "T22e one item approved on each of two cards", [r1, r2]);
    check(e, ["ha:" + SLUG, "ha:uia-source-fidelity-100150"], "T22f", [r1, r2]);
    const r3 = await approveVia(e, C, "approve 100140 2");
    ok(r3.ok && rows(e.db, "SELECT id FROM agent_issues WHERE title LIKE 'OWNER-TASK-%'").length === 3 && /decision 2/.test(rows(e.db, "SELECT prompt FROM owner_prompts WHERE mode = 'task' ORDER BY ts, rowid")[2].prompt), "T22g a second approval on the same card (item 2) is a third task and says it is decision 2", r3);
  }
}
// T23. a stranger reads only the open cards. A card in any other status (rerouted at birth by the AFTER INSERT triggers, resolved, dismissed) was never on
// the page, so a key typed into diagnose, approve or an Ask sentence answers "Nothing matches" with no title, why, action or default; the signed-in owner
// (and a token holder) still read it.
{
  const PRIVATE = ["private reasoning text", "do the private action", "private default text", "Vendor exit plan", "Rotation schedule"];
  const mkp = (extra) => {
    const x = mk(extra);
    const ins = x.db.prepare("INSERT INTO human_actions (slug,title,why,default_in_effect,action,source,status) VALUES (?,?,?,?,?,?,?)");
    ins.run("secret-rerouted", "Vendor exit plan for the Q3 contract", "IDENTITY-BOUND: private reasoning text for the owner only.", "private default text", "Approve: do the private action, or decline it.", "claude-session", "rerouted");
    ins.run("old-resolved-card", "Rotation schedule for the staging keys", "old why text", "old default", "Approve the old schedule or decline it.", "claude-session", "resolved");
    ins.run("old-dismissed-card", "Rotation schedule for the prod keys", "old dismissed why", "old default", "Approve the schedule or decline it.", "claude-session", "dismissed");
    return x;
  };
  const e = mkp();
  const leaks = (t) => PRIVATE.filter((w) => String(t || "").indexOf(w) >= 0);
  for (const line of ["diagnose ha:secret-rerouted", "approve ha:old-resolved-card", "decline ha:old-dismissed-card", "diagnose ha:old-resolved-card", "Diagnose HA:Secret-Rerouted", "retry ha:secret-rerouted", "resolve ha:old-resolved-card"]) {
    const j = await (await cmd(e.env, line)).json();
    ok(/Nothing matches/.test(j.text || "") && leaks(JSON.stringify(j)).length === 0 && !(j.actions || []).some((x) => x.op), "T23 a stranger's '" + line + "' answers Nothing matches and carries no card text", j);
  }
  // an Ask sentence that merely contains the key: the quick buttons and the model-down fallback read the same lookup
  const sentence = "Could you please diagnose ha:secret-rerouted and approve ha:old-resolved-card for me?";
  const q = await (await cmd(e.env, sentence, { "CF-Connecting-IP": "198.51.100.7" })).json();
  ok(q.quick === undefined && leaks(JSON.stringify(q)).length === 0, "T23a a stranger's Ask sentence naming those keys gets no quick buttons and no card text", q);
  const d = mkp({ ai: async () => new Response("{}", { status: 504 }) });
  const jd = await (await cmd(d.env, sentence)).json();
  await flush();
  const bd = await (await call(d.env, "/api/cmd/job/" + jd.id)).json();
  ok(bd.status === "fallback" && leaks(JSON.stringify(bd)).length === 0 && !(bd.actions || []).some((x) => /ha:(secret-rerouted|old-resolved-card)/.test(x.cmd || "")), "T23b the model-down fallback for that sentence names none of them either", bd);
  // the open card is still read by anyone: the page lists it
  let j = await (await cmd(e.env, "diagnose ha:" + SLUG)).json();
  ok(/Diagnosis of the owner card ha:uia-source-fidelity-100140/.test(j.text || "") && /Why it is yours/.test(j.text || ""), "T23c an open card (on the page) is still diagnosed for a stranger", j);
  j = await (await cmd(e.env, "diagnose ha:no-such-card")).json();
  ok(/Nothing matches/.test(j.text || ""), "T23d a key that matches no card says so", j);
  // the signed-in owner and a token holder still read a card in any status
  const C = await signIn(e.env, e.db, e.m);
  for (const [who, H] of [["owner", C], ["token holder", { "x-loop-token": LOOP }]]) {
    j = await (await cmd(e.env, "diagnose ha:secret-rerouted", H)).json();
    ok(/Why it is yours: IDENTITY-BOUND: private reasoning text/.test(j.text || "") && /To do: Approve: do the private action/.test(j.text || "") && /If you wait: private default text/.test(j.text || ""), "T23e the " + who + " still reads the rerouted card's text", j);
  }
  j = await (await cmd(e.env, "approve ha:old-resolved-card", C)).json();
  ok(/Rotation schedule for the staging keys' is already resolved/.test(j.text || "") && !(j.actions || []).some((x) => x.op), "T23f the owner's approve of a resolved card says it is already resolved, with its title", j);
  j = await (await cmd(e.env, "approve ha:secret-rerouted", C)).json();
  ok(/is already rerouted; nothing to approve/.test(j.text || "") && !(j.actions || []).some((x) => x.op), "T23g and of a rerouted one", j);
  ok(rows(e.db, "SELECT * FROM human_responses").length === 0 && rows(e.db, "SELECT id FROM owner_prompts").length === 0, "T23h none of it recorded or filed anything");
}
// T24. the home page since FLEET-STATUS-1 (statusPageHtml): its Needs-you cards carry the decision block for the SIGNED-IN OWNER ONLY. The block is
// computed per request (statusOwnerDecisions) and is never part of fleetStatusData, which is cached for everyone, or of /api/status, which is public:
// the numbered items are the text of an agent_issues row, which can be private.
{
  const ITEM = "names the wrong analysed paper";
  const mkStatus = () => {
    const x = mk({ plain: true, shapes: true, second: true });
    // readable metrics make the status document cacheable, so the owner's request below primes the cache a stranger then reads
    x.db.exec("CREATE TABLE v_fleet_metrics (metric TEXT, title TEXT, operator TEXT, threshold REAL, value REAL, breach INTEGER, priority INTEGER, kind TEXT, measured_at TEXT, program_code TEXT, good TEXT, value_7d_ago REAL)");
    x.db.prepare("INSERT INTO v_fleet_metrics VALUES ('m1', 'Metric one', 'gt', 0, 0, 0, 1, 'target', ?, 'QNFO.OPS', 'down', 0)").run(new Date().toISOString());
    return x;
  };
  const e = mkStatus();
  const strangerPage = async () => await (await call(e.env, "/overview")).text();
  const strangerJson = async () => await (await call(e.env, "/api/status")).text();
  const leak = (t) => ({ dec: /class="dec"|data-dec=|data-fleet-cmd="approve |data-fleet-cmd="decline |data-fleet-fill="approve |Approve all|Decide each part/.test(t), item: t.indexOf(ITEM) >= 0, fleetTick: t.indexOf("window.fleetTick=function") >= 0 });
  const none = { dec: false, item: false, fleetTick: false };
  const s0 = await strangerPage();
  ok(JSON.stringify(leak(s0)) === JSON.stringify(none) && /id="st-needs"/.test(s0) && /id="st-hero"/.test(s0) && s0.includes('href="/classic#queue">Act on it<'), "T24 a stranger's home page lists the cards with 'Act on it' and carries no decision block, no issue item text and no owner script", leak(s0));
  const C = await signIn(e.env, e.db, e.m);
  const own = await (await call(e.env, "/overview", { headers: C })).text();
  ok(/<div class="dec" data-dec="ha:uia-source-fidelity-100140">/.test(own) && /Decide each part: 0 of 7 decided/.test(own), "T24a the signed-in owner's home page carries the decision block on the owner-gated card", own.length);
  for (let n = 1; n <= 7; n++) ok(own.includes(tap("approve", "ha:" + SLUG, [n]) + ">Approve " + n + "<") && own.includes(tap("decline", "ha:" + SLUG, [n]) + ">Decline " + n + "<"), "T24b item " + n + " has its own Approve and Decline on the home page");
  ok(own.includes(tap("approve", "ha:" + SLUG) + ">Approve all 7<") && own.includes('data-fleet-cmd="diagnose ha:' + SLUG + '">Diagnose<') && own.includes(ITEM), "T24c Approve all, Diagnose and the item text are on the owner's card");
  ok(own.includes('data-fleet-fill="approve ha:pick-pricing-model ">Approve an option<') && own.includes(tap("approve", "ha:approve-logo-refresh") + ">Approve<"), "T24d a pick-one card fills the command line and a plain decision card has Approve");
  const hard = "ha:eb1a-statement-email984";
  ok(own.includes('data-dec="' + hard + '"') && own.includes(tap("done", hard) + ">Done<") && own.includes('data-fleet-cmd="diagnose ' + hard + '">Diagnose<') && !own.includes('data-fleet-cmd="approve ' + hard) && !own.includes('data-fleet-cmd="decline ' + hard), "T24e a signing card on the home page offers Diagnose and Done only");
  ok(!own.includes('data-dec="ha:domain-renewal-qnfo"') && !own.includes('data-dec="ha:tilburg-dis-phd-inquiry-send"') && !own.includes('data-dec="ha:orcid-link-works"'), "T24f cards that ask for no decision get no block");
  const ownScript = /<script>\(function\(\)\{function swap\(d,id\)[\s\S]*?<\/script>/.exec(own);
  let parsed = true; try { new Function(ownScript[0].replace(/^<script>|<\/script>$/g, "")); } catch (err) { parsed = String(err); }
  ok(ownScript && parsed === true && /window\.fleetTick=function/.test(ownScript[0]) && /document\.getElementById\('cout'\)/.test(own) && /window\.fleetTick\)\{rev=j\.revision;window\.fleetTick\(true\)\}else location\.reload\(\)/.test(own), "T24g the owner's page swaps its hero and Needs-you section after an action (and when the poll finds a change while an answer is on screen) instead of reloading over the answer", parsed);
  ok(/document\.addEventListener\('click',function\(e\)\{var t=e\.target&&e\.target\.closest&&e\.target\.closest\('\[data-fleet-cmd\]'\)/.test(own), "T24h the delegated click handler of the command line is on the page, so the buttons run");
  // the cache was primed by the owner's request: a stranger still reads the public page, and neither JSON nor page ever holds the owner's block
  const s1 = await strangerPage(), j1 = await strangerJson();
  ok(JSON.stringify(leak(s1)) === JSON.stringify(none) && s1.includes("Act on it"), "T24i after the owner's request primed the cache a stranger still gets no block, no item text, no owner script", leak(s1));
  const jo = await (await call(e.env, "/api/status", { headers: C })).text();
  ok(!leak(j1).dec && !leak(j1).item && !leak(jo).dec && !leak(jo).item && !/"decision"|OWNER-DECISION/.test(j1 + jo), "T24j /api/status holds no decision block and no issue item text, for a stranger or for the owner", { stranger: leak(j1), owner: leak(jo) });
  ok(JSON.parse(j1).needs_you.items.every((it) => Object.keys(it).sort().join() === "action,age_days,if_you_wait,key,source,title,urgent,url,why"), "T24k the document's item shape is unchanged (no decision field)", Object.keys(JSON.parse(j1).needs_you.items[0] || {}));
  // a decided item shows on the owner's home page; the stranger's page is the same as before
  await run(e.env, "decline", { key: "ha:" + SLUG, issue: 100140, items: [2], note: "" }, C);
  const after = await (await call(e.env, "/overview", { headers: C })).text();
  ok(/Decide each part: 1 of 7 decided/.test(after) && /&#10007; declined/.test(after) && after.includes(tap("approve", "ha:" + SLUG, [1, 3, 4, 5, 6, 7]) + ">Approve the 6 left<"), "T24l a decided item shows its state on the home page and the card offers the undecided rest");
  // a card closed since the cached document was built: the owner is told, and offered no button for it
  const rr = await run(e.env, "approve", { key: "ha:" + SLUG, issue: 100140, items: [1, 3, 4, 5, 6, 7], note: "" }, C);
  ok((await rr.json()).ok && one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "resolved", "T24m (setup) the last six items are approved and the card resolves");
  const closed = await (await call(e.env, "/overview", { headers: C })).text();
  ok(closed.includes("Decided: this card leaves the list within a minute.") && !closed.includes('data-dec="ha:' + SLUG + '"') && !closed.includes('data-fleet-cmd="approve ha:' + SLUG), "T24n a card that closed while the document was cached reads 'Decided' with no button", closed.length);
  const s2 = await strangerPage();
  ok(JSON.stringify(leak(s2)) === JSON.stringify(none) && !s2.includes("Decided: this card leaves"), "T24o and the stranger's page never shows the owner's note", leak(s2));
  // an owner whose decision read fails keeps the page: the cards keep their buttons and Details
  const f = mkStatus();
  const Cf = await signIn(f.env, f.db, f.m);
  f.db.exec("DROP TABLE agent_issues");
  const fp = await call(f.env, "/overview", { headers: Cf });
  const ft = await fp.text();
  ok(fp.status === 200 && ft.includes('data-fleet-cmd="info ha:' + SLUG + '">Details<') && ft.includes('data-dec="ha:' + SLUG + '"') && !ft.includes(ITEM), "T24p without the issue table the page still renders, the card keeps Approve and Decline for the whole card and no item text appears", fp.status);
  ok(noModel(e) && noModel(f), "T24q no model was called");
}
// T25. the hand-off text is never longer than the 1800 characters the issue body keeps (ownerNotesRoute), whatever the items: its first line (the card key)
// and its closing lines (doer, closing probe) are always inside; items that do not fit are named by number, the issue holds their text.
{
  const e = mk({ noCard: true });
  const twelve = [];
  for (let n = 1; n <= 12; n++) twelve.push(n + ") Item number " + n + " of the long list asks for a correction that runs to a great many words so that every one of the twelve lines is as long as a line can be before the parser cuts it at its limit of two hundred and sixty characters, which is more than the whole hand-off can afford twelve times over.");
  e.db.prepare("INSERT INTO agent_issues (id,title,description,category,priority,created_at,updated_at) VALUES (100500,'LONGLIST-1: twelve corrections',?,'pipeline','medium',1791217360000,1791217360000)").run("Twelve corrections.\n\n" + twelve.join("\n"));
  e.db.prepare("INSERT INTO human_actions (slug,title,why,default_in_effect,action,source) VALUES ('longlist-100500','LONGLIST-1: approve or decline the twelve corrections','IDENTITY-BOUND: the corrections change the author''s own text.','The text stays as published.','Approve or decline each of the twelve fixes in agent_issues 100500.','claude-session')").run();
  const C = await signIn(e.env, e.db, e.m);
  const j = await (await cmd(e.env, "approve 100500", C)).json();
  const a = (j.actions || []).find((x) => x.op === "approve");
  ok(a && a.args.items.length === 12, "T25 the card lists all twelve items", j);
  const r = await (await run(e.env, "approve", a.args, C)).json();
  const t = rows(e.db, "SELECT prompt FROM owner_prompts WHERE mode = 'task'");
  const text = t[0] && t[0].prompt || "";
  ok(r.ok && t.length === 1 && text.length <= 1800 && text.length > 1000, "T25a the hand-off of twelve long items is filed and fits the 1800 characters the issue body keeps", { ok: r.ok, len: text.length });
  ok(text.split("\n")[0].includes("on owner card ha:longlist-100500 (decision 1, issue 100500") && /Doer: the loop that owns issue 100500/.test(text) && /Closing probe: remediation contract issue-100500/.test(text) && /not evidence|is not the evidence/.test(text), "T25b the card key is in the first line and the doer and the closing probe are in the text", text.slice(0, 200));
  ok(/Apply exactly these approved items and nothing else \(the full text of each is in issue 100500\)|Apply exactly these approved items and nothing else: 1-12 \(the full text of each is in issue 100500\)/.test(text), "T25c the items are listed or named by number, pointing at the issue that holds their text", text.slice(300, 700));
  const body = one(e.db, "SELECT description FROM agent_issues WHERE title LIKE 'OWNER-TASK-%' ORDER BY id DESC LIMIT 1").description;
  ok(body.includes(text.split("\n").pop()) && body.includes("Closing probe: remediation contract issue-100500"), "T25d the issue body made from it keeps the whole text, closing lines included", body.length);
  // few short items: the text of each is kept
  const e2 = mk();
  const C2 = await signIn(e2.env, e2.db, e2.m);
  const j2 = await (await cmd(e2.env, "approve 100140 1-2", C2)).json();
  await run(e2.env, "approve", j2.actions.find((x) => x.op === "approve").args, C2);
  const t2 = rows(e2.db, "SELECT prompt FROM owner_prompts WHERE mode = 'task'")[0].prompt;
  ok(t2.length <= 1800 && /1\) ai4metascience-ignorance-audit section 2 names the wrong analysed paper/.test(t2) && /2\) ignorance-ai-pipeline-synthesis section 2 contradicts itself/.test(t2), "T25e two short items keep their own text", t2.length);
  // the budget is one number
  ok(/var DEC_HANDOFF_MAX = 1800;/.test(src) && !/slice\(0, 1990\)/.test(src.slice(src.indexOf("function decHandoffText"), src.indexOf("async function decApprovalCount"))), "T25f one constant holds the budget and the clip");
}
// T26. an approval is handed to the fleet once, when it is made: a second approve of the same item files no second hand-off, and a decline of an
// approved item says it was already handed to the fleet and is not undone (and records nothing: the item stays approved).
{
  const e = mk();
  const C = await signIn(e.env, e.db, e.m);
  const typed = async (text, op) => { const j = await (await cmd(e.env, text, C)).json(); const a = (j.actions || []).find((x) => x.op === op); return a ? { j, r: await (await run(e.env, op, a.args, C)).json() } : { j, r: null }; };
  const tasks = () => rows(e.db, "SELECT prompt FROM owner_prompts WHERE mode = 'task' AND visitor = 'owner-decision' ORDER BY ts, rowid");
  const resp = (kind) => rows(e.db, "SELECT note FROM human_responses WHERE kind = ? ORDER BY id", kind);
  let x = await typed("approve 100140 1-3", "approve");
  ok(x.r && x.r.ok && tasks().length === 1 && resp("approve").length === 1, "T26 (setup) items 1-3 are approved: one hand-off, one decision row", x.r);
  // a second approve of item 3
  x = await typed("approve 100140 3", "approve");
  ok(!x.r && /Item 3 is already approved and was handed to the fleet; nothing was filed again\./.test(x.j.text) && !(x.j.actions || []).some((a) => a.op), "T26a the preview of a repeat approve says so and offers no Approve button", x.j);
  const rep = await (await run(e.env, "approve", { key: "ha:" + SLUG, issue: 100140, items: [3], note: "" }, C)).json();
  ok(rep.ok && /Item 3 is already approved and was handed to the fleet; nothing was filed again\./.test(rep.text) && tasks().length === 1 && resp("approve").length === 1, "T26b running it anyway files no second hand-off and records no second row", rep);
  ok((one(e.db, "SELECT description FROM agent_issues WHERE id = 100140").description.match(/OWNER-DECISION approve/g) || []).length === 1, "T26c the issue carries one OWNER-DECISION approve line");
  // a decline of an approved item
  x = await typed("decline 100140 3", "decline");
  ok(!x.r && /Item 3 was already approved and handed to the fleet; declining it does not undo that, so it stays approved and nothing was recorded\./.test(x.j.text) && !(x.j.actions || []).some((a) => a.op), "T26d the preview of a decline of an approved item says it was handed to the fleet and is not undone, with no Decline button", x.j);
  const dec = await (await run(e.env, "decline", { key: "ha:" + SLUG, issue: 100140, items: [3], note: "changed my mind" }, C)).json();
  ok(dec.ok && /Item 3 was already approved and handed to the fleet; declining it does not undo that/.test(dec.text) && resp("decline").length === 0 && one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "open" && tasks().length === 1, "T26e running it records no decline, leaves the card open and the task in place", dec);
  // mixed selections go ahead for the rest
  x = await typed("decline 100140 3-4", "decline");
  ok(x.r && x.r.ok && /Item 4 left/.test(x.r.text) === false && /Item 3 was already approved and handed to the fleet; declining it does not undo that, so it stays approved and is left out of this decline\./.test(x.j.text + "\n" + x.r.text) && resp("decline").length === 1 && /items 4(;|$)/.test(resp("decline")[0].note), "T26f declining 3-4 declines item 4 only and says item 3 stays approved", { j: x.j.text, r: x.r && x.r.text, rows: resp("decline") });
  x = await typed("approve 100140 3-5", "approve");
  ok(x.r && x.r.ok && tasks().length === 2 && /APPROVED items 4-5 of 7/.test(tasks()[1].prompt) && !/APPROVED items 3/.test(tasks()[1].prompt) && /Item 3 is already approved and was handed to the fleet; it is left out of this one\./.test(x.r.text) && /Approved 4-5/.test(x.r.text), "T26g approving 3-5 hands over items 4 and 5 only (3 was handed over; 4, declined a moment ago, may be approved after all)", { tasks: tasks().map((t) => t.prompt.slice(0, 120)), r: x.r && x.r.text });
  ok(resp("approve").length === 2, "T26h the repeat of item 3 added no decision row (two approve rows: 1-3 and 4-5)", resp("approve"));
}
// T27. 'why <number>' is a diagnosis only when the number says it is an issue ('issue 100140', 'agent_issues 100140', '#100140') or is the whole argument
{
  const e = mk();
  e.db.prepare("INSERT INTO agent_issues (id,title,description,category,priority,created_at,updated_at) VALUES (2026,'The year row','x','analytics','medium',1791217360000,1791217360000)").run();
  const say = async (t) => await (await cmd(e.env, t)).json();
  for (const t of ["why 2026 papers were pulled?", "Why 2026 papers were pulled", "what is wrong with 2026 papers", "why is 2026 so slow?", "why 100140 is blocked"]) {
    const j = await say(t);
    ok(j.kind === "pending" && !/Diagnosis of #/.test(j.text || ""), "T27 '" + t + "' goes to the model, not to a diagnosis of the issue its first number happens to be", j);
  }
  for (const [t, id] of [["why 2026?", 2026], ["why 100140", 100140], ["why #100140?", 100140], ["why is issue 100140 stuck?", 100140], ["why agent_issues 100140", 100140], ["what is wrong with 2026", 2026], ["why is #2026 blocked", 2026]]) {
    const j = await say(t);
    ok(new RegExp("Diagnosis of #" + id + " ").test(j.text || ""), "T27a '" + t + "' is a diagnosis of #" + id, j);
  }
  const k = await say("diagnose 2026 papers");
  ok(/Diagnosis of #2026 /.test(k.text || ""), "T27b the explicit verb keeps its reading (diagnose <number> ...)", k);
  ok(noModel(e) === false, "T27c (control) the model was asked for the sentences above");
}
// T28. a receipt card ('Closed for you', human_actions.source owner-request-issue) asks for no decision even when its title says Approve: the typed path,
// the candidate list and /api/cmd/run all treat it as a receipt (the queue excludes receipts, so decOpenCards and cmdDecide read them from human_actions)
{
  const RK = "ha:issue-1000100";
  const e = mk({ receipt: true });
  const C = await signIn(e.env, e.db, e.m);
  const bare = await (await cmd(e.env, "approve", C)).json();
  ok((bare.actions || []).some((a) => a.op === "approve" && a.args.key === "ha:" + SLUG) && !/Pick one/.test(bare.text || "") && !(bare.actions || []).some((a) => /1000100/.test(JSON.stringify(a))), "T28 a bare approve resolves to the single real decision card; the receipt is not offered as a second choice", bare);
  for (const verb of ["approve", "decline"]) {
    const j = await (await cmd(e.env, verb + " " + RK, C)).json();
    ok(!(j.actions || []).some((a) => a.op === verb) && /asks for no decision/.test(j.text || "") && (j.actions || []).some((a) => a.op === "done" && a.args.key === RK), "T28a typing '" + verb + " " + RK + "' previews no " + verb + " button: it says the card asks for no decision and offers Done", j);
    const k = await (await cmd(e.env, verb + " 1000100", C)).json();
    ok(!(k.actions || []).some((a) => a.op === verb), "T28b '" + verb + " 1000100' (the issue the receipt names) offers no " + verb + " button", k);
    const r = await run(e.env, verb, { key: RK, issue: 1000100, items: null, note: "", title: "x" }, C); const jr = await r.json();
    ok(jr.ok === false && /asks for no decision/.test(jr.error || "") && /Mark it done/.test(jr.error || ""), "T28c /api/cmd/run " + verb + " on the receipt is refused: asks for no decision, mark it done", jr);
  }
  ok(one(e.db, "SELECT status FROM human_actions WHERE slug = 'issue-1000100'").status === "open" && one(e.db, "SELECT COUNT(*) n FROM human_responses").n === 0 && rows(e.db, "SELECT id FROM owner_prompts").length === 0 && one(e.db, "SELECT COUNT(*) n FROM agent_issues").n === 4 && one(e.db, "SELECT description FROM agent_issues WHERE id = 1000100").description === "Approve the refreshed logo.", "T28d nothing was resolved, recorded, stamped or handed to the fleet (no OWNER-DECISION hand-off for a request the owner merely filed)");
  // the real card is unaffected, and Done (the receipt's own alternate) still clears the receipt
  const real = await (await cmd(e.env, "approve 100140", C)).json();
  ok((real.actions || []).some((a) => a.op === "approve" && a.args.items.length === 7), "T28e the real decision card still previews its approve", real);
  const dn = await (await run(e.env, "done", { key: RK, title: "x" }, C)).json();
  ok(dn.ok !== false && one(e.db, "SELECT status FROM human_actions WHERE slug = 'issue-1000100'").status === "resolved", "T28f Done clears the receipt", dn);
  // a stranger: the preview is open and still offers no approve for the receipt
  const e1 = mk({ receipt: true });
  const s = await (await cmd(e1.env, "approve " + RK)).json();
  ok(!(s.actions || []).some((a) => a.op === "approve"), "T28g a stranger's typed approve on the receipt previews nothing either", s);
  // a database without the source column reads every card as a card (collectHumanActions does too): no error, and the real card is still decidable
  const e2 = mk({ receipt: true, noSource: true });
  const j2 = await (await cmd(e2.env, "approve 100140")).json();
  ok(j2.kind === "answer" && (j2.actions || []).some((a) => a.op === "approve" && a.args.key === "ha:" + SLUG), "T28h without the source column the typed path still answers and the real card is decidable", j2);
}
// T29. the hard-marker gate FAILS CLOSED. DEC_HARD_FALLBACK_RX is not a copy of the live list ('Fund a stronger code-loop model', a text holding an e-mail
// address, 'unbacked rows are wiped', 'enter the login code', 'use the login link' and a bare 'pay' or 'paid' are hard live and pass it), so with the markers
// unreadable (the table dropped, as a D1 error would) or empty every card that asks for a decision offers Diagnose and Done only: page, typed verb and server.
{
  const sample = (pat) => pat.replace(/_/g, "x").replace(/%/g, " ");
  const named = [["fund", "Fund a stronger code-loop model so the planner stops falling back."], ["email", "Reply to ops@example.org about the grant."], ["unbacked", "Rows with no backup: unbacked rows are wiped on Friday."], ["logincode", "To continue, enter the login code that was sent to you."], ["loginlink", "To continue, use the login link in the message."], ["pay", "Please pay now."], ["paid", "It was paid last week."]];
  // (a) the named cases on the page (/classic shows the first eight decision cards), with the table dropped and with the table empty
  for (const variant of [{ noMarkers: true }, { emptyMarkers: true }]) {
    const label = variant.noMarkers ? "markers table dropped" : "markers table empty";
    const e = mk(Object.assign({ noCard: true, cards: named.map(([k, why]) => ["hc-" + k, "Approve the hardcase", why, "Approve or decline it."]) }, variant));
    const C = await signIn(e.env, e.db, e.m);
    const page = await (await call(e.env, "/classic", { headers: C })).text();
    for (const [k] of named) {
      const key = "ha:hc-" + k;
      ok(page.includes('data-dec="' + key + '"') && page.includes('data-fleet-cmd="diagnose ' + key + '">Diagnose<') && page.includes(tap("done", key) + ">Done<") && !page.includes('data-fleet-cmd="approve ' + key) && !page.includes('data-fleet-cmd="decline ' + key), "T29 (" + label + ") '" + k + "' shows Diagnose and Done only", page.slice(page.indexOf('data-dec="' + key + '"'), page.indexOf('data-dec="' + key + '"') + 400));
    }
  }
  // (b) every one of the 73 live patterns, as card text, with the table dropped: typed verbs and /api/cmd/run refuse, nothing is written
  const cards = HARD.map((pat, i) => ["hp-" + i, "Approve the hardcase", "Context" + sample(pat) + "end.", "Approve or decline it."]);
  const e = mk({ noCard: true, noMarkers: true, cards });
  const C = await signIn(e.env, e.db, e.m);
  const ref = mk({ noCard: true, cards });
  let sane = 0, closedN = 0;
  for (let i = 0; i < HARD.length; i++) {
    const key = "ha:hp-" + i, text = " approve the hardcase context" + sample(HARD[i]) + "end. approve or decline it. ";
    if (one(ref.db, "SELECT lower(?) LIKE ? AS m", text, HARD[i]).m === 1) sane++;
    for (const verb of ["approve", "decline"]) {
      const j = await (await cmd(e.env, verb + " " + key, C)).json();
      const r = await run(e.env, verb, { key, issue: null, items: null, note: "", title: "x" }, C); const jr = await r.json();
      if (!(j.actions || []).some((a) => a.op === "approve" || a.op === "decline") && (j.actions || []).some((a) => /^diagnose /.test(a.cmd || "")) && jr.ok === false && /yours alone/.test(jr.error || "")) closedN++;
      else ok(false, "T29a '" + HARD[i] + "' with the markers unreadable: " + verb + " must offer Diagnose/Done only and be refused by the server", { j, jr });
    }
  }
  ok(sane === HARD.length, "T29b each sample text matches its own live LIKE pattern (so each is hard live)", sane);
  ok(closedN === HARD.length * 2, "T29c all " + HARD.length + " live patterns x approve and decline fail closed with the markers unreadable", closedN);
  ok(one(e.db, "SELECT COUNT(*) n FROM human_actions WHERE status = 'open'").n === HARD.length && one(e.db, "SELECT COUNT(*) n FROM human_responses").n === 0 && rows(e.db, "SELECT id FROM owner_prompts").length === 0, "T29d nothing was resolved, recorded or handed to the fleet");
  const bare = await (await cmd(e.env, "approve", C)).json();
  ok(/Nothing is waiting on a decision/.test(bare.text || "") && !(bare.actions || []).some((a) => a.op), "T29e a bare approve offers none of them", bare);
  // (c) control: with the live markers readable the same card is hard too (the table is the authority when it can be read)
  const Cr = await signIn(ref.env, ref.db, ref.m);
  const live = await (await cmd(ref.env, "approve ha:hp-3", Cr)).json();
  ok(!(live.actions || []).some((a) => a.op === "approve") && /yours alone/.test(live.text || ""), "T29f with the live markers readable the same card is hard", live);
  // (d) a card that matches no marker is decidable when the table is readable: a readable list does not fail closed
  const ok2 = mk({ noCard: true, shapes: true });
  const C2 = await signIn(ok2.env, ok2.db, ok2.m);
  const j2 = await (await cmd(ok2.env, "approve ha:approve-logo-refresh", C2)).json();
  ok((j2.actions || []).some((a) => a.op === "approve"), "T29g with the markers readable a decision card that matches none is decidable", j2);
}

// ---- ONE-TAP-DECISIONS-1 (1.71.0, owner request 2026-10-26: "I need one click/tap actions: approve, etc ... action oriented, at a glance, one tap").
// Before: a signed-out phone showed only Details, and a signed-in tap on Approve only previewed (a second tap confirmed, a fresh code stood behind it).
// T30. the buttons run at the tap: the markup the page renders, read the way the browser script reads it, is executed through /api/cmd/run
{
  const e = mk({ plain: true });
  const C = await signIn(e.env, e.db, e.m);
  const page = await (await call(e.env, "/classic", { headers: C })).text();
  const t = taps(page).filter((x) => x.args.key === "ha:" + SLUG);
  ok(t.length === 2 + 14 && t[0].op === "approve" && t[0].label === "Approve all 7" && t[1].op === "decline" && t[1].label === "Decline all", "T30 the card opens with Approve all and Decline all, then the per-item buttons", t.slice(0, 3));
  const before = rows(e.db, "SELECT * FROM human_responses").length;
  const r = await run(e.env, t[0].op, t[0].args, C); const jr = await r.json();
  ok(r.status === 200 && jr.ok === true, "T30a one tap on Approve all runs: no preview, no confirm", jr);
  ok(rows(e.db, "SELECT * FROM human_responses WHERE kind = 'approve' AND credential = 'owner-session'").length >= 1 && rows(e.db, "SELECT * FROM human_responses").length > before && one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "resolved", "T30b the approval is recorded as the owner session's own and the card resolves");
  ok(rows(e.db, "SELECT * FROM owner_prompts WHERE visitor = 'owner-decision'").length === 1 && /OWNER-DECISION from fleet\.qnfo\.org/.test(rows(e.db, "SELECT prompt FROM owner_prompts WHERE visitor = 'owner-decision'")[0].prompt), "T30c exactly one hand-off task reaches the fleet");
  const again = await (await run(e.env, t[0].op, t[0].args, C)).json();
  ok(again.ok === true && rows(e.db, "SELECT * FROM owner_prompts WHERE visitor = 'owner-decision'").length === 1, "T30d a second tap files no second task", again);
  ok(noModel(e), "T30e no model was called");
}
// T31. a single item taps through too (the item buttons carry their number), and a decline is one tap and writes its row
{
  const e = mk({ plain: true });
  const C = await signIn(e.env, e.db, e.m);
  const page = await (await call(e.env, "/classic", { headers: C })).text();
  const t = taps(page).filter((x) => x.args.key === "ha:" + SLUG);
  const d3 = t.find((x) => x.op === "decline" && x.args.items && x.args.items[0] === 3);
  const r = await run(e.env, d3.op, d3.args, C); const jr = await r.json();
  ok(r.status === 200 && jr.ok === true && rows(e.db, "SELECT * FROM human_responses WHERE kind = 'decline' AND credential = 'owner-session'").length === 1, "T31 Decline 3 is one tap and writes one decline row", jr);
  ok(one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "open", "T31a the card stays open until every item is decided");
  const after = await (await call(e.env, "/classic", { headers: C })).text();
  const rest = taps(after).find((x) => x.op === "approve" && x.label === "Approve the 6 left");
  ok(rest && rest.args.items.join() === "1,2,4,5,6,7", "T31b the card then offers the six undecided items in one tap", rest);
  const r2 = await run(e.env, rest.op, rest.args, C);
  ok(r2.status === 200 && one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "resolved", "T31c and that tap resolves it");
}
// T32. the fresh-code rule stands behind the button: a stale step-up answers need: stepup (the page asks for the code in place and repeats the tap), a
// stranger's tap needs the code, the loop token cannot make the decision, and nothing is written in any of the three
{
  const e = mk({ plain: true });
  const C = await signIn(e.env, e.db, e.m);
  const t = taps(await (await call(e.env, "/classic", { headers: C })).text()).find((x) => x.op === "approve" && x.label === "Approve all 7");
  e.db.prepare("UPDATE owner_sessions SET verified_ms = verified_ms - 20 * 60000").run();
  let r = await run(e.env, t.op, t.args, C), jr = await r.json();
  ok(r.status === 401 && jr.need === "stepup", "T32 a tap after 20 minutes asks for the code in place (need: stepup)", jr);
  r = await run(e.env, t.op, t.args); jr = await r.json();
  ok(r.status === 401 && jr.need === "code", "T32a a signed-out tap asks for the code (need: code)", jr);
  r = await run(e.env, t.op, t.args, { "x-loop-token": LOOP });
  ok(r.status === 400 && (await r.json()).ok === false, "T32b the loop token cannot tap it");
  ok(rows(e.db, "SELECT * FROM human_responses").length === 0 && rows(e.db, "SELECT * FROM owner_prompts").length === 0 && one(e.db, "SELECT status FROM human_actions WHERE slug = ?", SLUG).status === "open", "T32c nothing was written");
}
// T33. at a glance: for the signed-in owner a decision card shows its buttons BEFORE its reading and folds the reading; a card that asks for a step only the owner can
// take keeps its reading open (the instruction is the point); a stranger gets ONE sign-in button, no decision button, no item text and no owner script
{
  const e = mk({ plain: true });
  const C = await signIn(e.env, e.db, e.m);
  const page = await (await call(e.env, "/classic", { headers: C })).text();
  const at = page.indexOf('data-dec="ha:' + SLUG + '"');
  const card = page.slice(page.lastIndexOf("<article", at), page.indexOf("</article>", at));
  ok(card.indexOf("Approve all 7") > 0 && card.indexOf("Approve all 7") < card.indexOf("Why you") && /<details class="it-more"><summary>Why, what if you wait, what to do<\/summary>/.test(card), "T33 the owner's decision card has its buttons before the reading, and the reading is folded", card.slice(0, 200));
  ok(/<details class="dec-det"><summary class="dec-h">Decide each part: 0 of 7 decided<\/summary>/.test(card), "T33a the seven parts are folded under one summary, so the card is short on a phone");
  const strangerPage = await (await call(e.env, "/classic")).text();
  ok(strangerPage.includes('data-dec-signin>Email me a code to decide<') && !/Sign in|sign out/i.test(strangerPage) && !/data-dec-op=/.test(strangerPage) && strangerPage.indexOf("names the wrong analysed paper") < 0 && strangerPage.indexOf("window.fleetTick=function") < 0, "T33b a stranger gets 'Email me a code to decide' and no decision button, no item text, no owner script");
  const hard = strangerPage.indexOf('data-dec-signin') > 0;
  ok(hard, "T33c (the sign-in button is on the cards that ask for a decision)");
  const home = await (await call(e.env, "/overview")).text();
  ok(!/data-dec-op=/.test(home) && home.indexOf("names the wrong analysed paper") < 0, "T33d the stranger's home page carries no decision button and no item text");
}
// T34. the one-tap script parses, posts to /api/cmd/run, asks for the emailed code in place and is on every page that carries the command line
{
  const e = mk({ plain: true });
  const stranger = await (await call(e.env, "/classic")).text();
  const scripts = [...stranger.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const js = scripts.find((x) => x.indexOf("data-dec-op") >= 0 && x.indexOf("/api/cmd/run") >= 0);
  let parsed = false; try { new vm.Script(js); parsed = true; } catch (err) { parsed = String(err); }
  ok(js && parsed === true, "T34 the one-tap script parses", parsed);
  ok(/post\('\/api\/cmd\/run',\{op:op,args:args\}\)/.test(js) && /j\.need/.test(js) && /\/api\/cmd\/code/.test(js) && /\/api\/cmd\/verify/.test(js) && /x-fleet-ui/.test(js) && /ev\.target\.closest/.test(js), "T34a it posts op and args, shows the code step in place and uses the same headers as the command line");
  ok(/location\.reload/.test(js) && /window\.fleetTick/.test(js), "T34b a signed-in page refreshes through the poll, and a page without one reloads");
  const home = await (await call(e.env, "/overview")).text();
  ok(home.indexOf("data-dec-op") >= 0 && home.indexOf("data-dec-signin") >= 0, "T34c the home page carries the same script");
  ok(/\.dec button\{min-height:44px/.test(stranger) && /\.dec \.dec-main \.dec-y/.test(stranger) && /min-height:52px/.test(stranger), "T34d the main buttons are 52 px tall on a phone");
}

// ---- ONE-TAP-ACTIONS-1 (1.71.0): the owner's home page. A card that is not a decision (or a derived item) carries one-tap Done / Snooze / Not doing instead of a link
// to /classic, what can be decided in one tap comes first, and the heading says how the list splits.
// T35. quick actions run at the tap through /api/cmd/run
{
  const x = mk({ plain: true, shapes: true, second: true });
  x.db.exec("CREATE TABLE v_fleet_metrics (metric TEXT, title TEXT, operator TEXT, threshold REAL, value REAL, breach INTEGER, priority INTEGER, kind TEXT, measured_at TEXT, program_code TEXT, good TEXT, value_7d_ago REAL)");
  x.db.prepare("INSERT INTO v_fleet_metrics VALUES ('m1', 'Metric one', 'gt', 0, 0, 0, 1, 'target', ?, 'QNFO.OPS', 'down', 0)").run(new Date().toISOString());
  const C = await signIn(x.env, x.db, x.m);
  const home = await (await call(x.env, "/overview", { headers: C })).text();
  const orcid = home.slice(home.indexOf("Add the selected works to ORCID"), home.indexOf("Add the selected works to ORCID") + 1800);
  ok(orcid.includes(tap("done", "ha:orcid-link-works") + ">Done<") && orcid.includes(tap("snooze", "ha:orcid-link-works").replace('{&quot;key&quot;:&quot;ha:orcid-link-works&quot;}', '{&quot;key&quot;:&quot;ha:orcid-link-works&quot;,&quot;days&quot;:3}') + ">Snooze 3 days<") && orcid.includes(tap("dismiss", "ha:orcid-link-works") + ">Not doing<"), "T35 a card that is not a decision has Done, Snooze 3 days and Not doing at the tap", orcid.slice(0, 160));
  ok(orcid.includes('data-fleet-cmd="info ha:orcid-link-works">Details<') && !/Act on it/.test(home), "T35a the owner's cards say Details, not 'Act on it' (a link to another page)");
  const bs = taps(home);
  ok(bs.every((b) => b.op === "approve" || b.op === "decline"), "T35b (taps() reads approve and decline only)", bs.length);
  // run what the Done button carries
  const done = [...home.matchAll(/data-dec-op="done" data-dec-args="([^"]*)"/g)].map((m) => JSON.parse(m[1].replace(/&quot;/g, '"')));
  const d = done.find((a) => a.key === "ha:orcid-link-works");
  const r = await run(x.env, "done", d, C); const jr = await r.json();
  ok(r.status === 200 && jr.ok === true && one(x.db, "SELECT status FROM human_actions WHERE slug = 'orcid-link-works'").status === "resolved", "T35c one tap on Done resolves the card through /api/cmd/run", jr);
  const sn = [...home.matchAll(/data-dec-op="snooze" data-dec-args="([^"]*)"/g)].map((m) => JSON.parse(m[1].replace(/&quot;/g, '"')));
  const s1 = sn.find((a) => a.key && a.days === 3);
  const r2 = await run(x.env, "snooze", s1, C); const j2 = await r2.json();
  ok(r2.status === 200 && j2.ok === true && rows(x.db, "SELECT * FROM human_responses WHERE kind = 'snooze'").length === 1, "T35d one tap on Snooze 3 days snoozes", j2);
  // a stranger is told nothing new: the old link, no quick button
  const strangerHome = await (await call(x.env, "/overview")).text();
  ok(/Act on it/.test(strangerHome) && !/data-dec-op=/.test(strangerHome.replace(/<script>[\s\S]*?<\/script>/g, "")), "T35e a stranger keeps 'Act on it' and gets no quick button");
  const order = [...home.matchAll(/<article class="card item[^"]*">[\s\S]*?<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);
  const iUia = order.findIndex((t) => /UIA-SOURCE/.test(t)), iOrcid = order.findIndex((t) => /ORCID/.test(t));
  ok(iUia >= 0 && iOrcid >= 0 && iUia < iOrcid, "T35f the card that can be decided in one tap comes before the card that is yours to do", order);
  ok(/class="meta st-split">\d+ to decide in one tap/.test(home), "T35g the heading says how many are one tap", home.slice(home.indexOf("st-split") - 20, home.indexOf("st-split") + 120));
}

// T36. the classic page (/classic, the page the owner reads on a phone): the same one-tap Done / Snooze / Not doing on a card that is not a decision, no confirm dialog
{
  const e = mk({ plain: true });
  const C = await signIn(e.env, e.db, e.m);
  const page = await (await call(e.env, "/classic", { headers: C })).text();
  const at = page.indexOf("Add the selected works to ORCID");
  const card = page.slice(at, page.indexOf("</article>", at));
  ok(card.includes(tap("done", "ha:orcid-link-works") + ">Done<") && card.includes(tap("dismiss", "ha:orcid-link-works") + ">Not doing<") && card.includes('data-fleet-cmd="info ha:orcid-link-works">Details<') && card.includes('data-act="note">Add note<'), "T36 the classic card has Done, Not doing, Details and Add note", card.slice(0, 200));
  ok(!card.includes('data-act="done"') && !card.includes('data-act="snooze"'), "T36a and no old confirm-dialog button for Done or Snooze on it");
  const d = JSON.parse(/data-dec-op="done" data-dec-args="([^"]*)"/.exec(card)[1].replace(/&quot;/g, '"'));
  const r = await run(e.env, "done", d, C);
  ok(r.status === 200 && one(e.db, "SELECT status FROM human_actions WHERE slug = 'orcid-link-works'").status === "resolved", "T36b one tap on Done resolves it", await r.text());
  const stranger = await (await call(e.env, "/classic")).text();
  ok(!/data-dec-op=/.test(stranger) && !stranger.includes('data-act="done"'), "T36c a stranger still sees no control that changes the fleet");
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
