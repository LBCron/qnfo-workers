// OUTREACH-ASK-FACTS-1 offline suite (qnfo-fleet-dashboard 1.50.0, agent_issues 100097, pillar reach).
// The owner asked the Ask panel "WHAT OUTREACH 'NEEDS CONTACT'?" and was told "CONTEXT has no outreach/contact queue", because the context
// carried the queue, decision, system and business facts and never read qnfo-audit.outreach_queue (on 2026-10-19 it held 8 needs-contact rows,
// arXiv-radar candidates with no author address yet). This suite runs the real functions sliced from worker.js against that table's shape
// in node:sqlite. Proves: the explicit question is answered from the table without the model, and naming the papers; a question about
// outreach carries the facts first in CONTEXT, where a long queue cannot cut them off, with a rule telling the model what they are; the
// no-model fallback prints them; the address and author columns are never selected and a decoy address and name cannot appear; a read
// error is reported as unreadable, never as an empty queue; an empty queue says so.
// Run: node --no-warnings qnfo-fleet-dashboard/outreach-ask.test.mjs   (exit 0 = all passed)
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); return i >= 0 && j > i ? src.slice(i, j) : ""; };

const helpers = cut("function squash(s) {", "__name(squash") + "\n" + cut("const D1_PRIMARY_ONLY", "__name(d1all");
const outreach = cut("var OUTREACH_Q = ", "// MAIL-DRAFT-1 (1.34.0");
const intent = cut("var CMD_FIXALL_RX = ", "var CMD_PROBE_DEAD_RX");
const ctxBlock = cut("function askContextObj(v, mail, outreach) {", "var ASK_MAIL_RULE");
const askBlock = cut("var ASK_MAIL_RULE = ", "// OWNER-KEYS-VIEW-1");
const fb = cut("function cmdModelReason(err) {", "// What the owner reads for a request that has no answer at all");
ok([helpers, outreach, intent, ctxBlock, askBlock, fb].every((p) => p.length > 100), "every function under test is found in worker.js", [helpers, outreach, intent, ctxBlock, askBlock, fb].map((p) => p.length));

const seen = [];
const sb = new Function("cmdIssuesDigest", "cmdQueryLogs", "cmdRaceModels", "CMD_AI_BUDGET_MS", "mailAnswerText", "cmdQueue",
  helpers + "\n" + outreach + "\n" + intent + "\n" + ctxBlock + "\n" + askBlock + "\n" + fb +
  "\nreturn { OUTREACH_Q, CMD_OUTREACH_RX, outreachFacts, outreachFactsText, cmdIntent, askContextObj, askContext, runAsk, cmdFallback, ASK_OUTREACH_RULE };")(
  async () => "issues", async () => "logs", async (env, messages) => { seen.push(messages); return { ok: true, text: "model answer", model: "stub" }; }, 1000, () => "", () => []);

const live = [ // the 2026-10-19 shape: eight arXiv-radar candidates waiting for an address
  ["2610.23840v1", "Demonstration of Logical Error Suppression in a Surface Code Memory on a Cloud-Accessible IBM Superconducting Processor"],
  ["2610.23844v1", "ModeCast: One-Shot Prediction of Linear MHD Eigenmodes and Growth Rates in Tokamaks"],
  ["2610.23837v1", "SparseMax-dSTL: Sound Robustness with Horizon-Independent Gradient Allocation for Temporal Logic Trajectory Optimizatio"],
  ["2610.23826v1", "Self-Building Labs"], ["2610.23850v1", "Entering the Era of Circumplanetary Ring Detection with Direct Imaging"],
  ["2610.23849v1", "Blind Precise Assembly: Proprioceptive Sim-to-Real Peg-in-Hole for Diverse Parts"],
  ["2610.23848v1", "Geometric Viewpoint of L-infinity Estimates for Linearized Monge-Ampere Equations"],
  ["2610.23847v1", "Behavioral Couplings: From Formation to Behavioral Emergence in Language Models"]];
const mk = (opts = {}) => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE outreach_queue (id TEXT PRIMARY KEY, paper_id TEXT, author TEXT, email TEXT, reason TEXT, status TEXT, created_at TEXT, attempts INTEGER, error TEXT)");
  const ins = db.prepare("INSERT INTO outreach_queue VALUES (?,?,?,?,?,?,?,?,?)");
  if (!opts.empty) live.forEach((r, i) => ins.run("aq-" + i, r[0], "", null, "arxiv-radar widened: " + r[1], "needs-contact", "2026-10-19 09:00:" + String(47 + i).padStart(2, "0"), 0, null));
  if (!opts.empty) ins.run("aq-x", "2610.99999v1", "Dr. Secret Name", "secret@example.org", "contact Dr. Secret Name at secret@example.org", "needs-email", "2026-10-19 08:00:00", 2, "email lookup failed (HTML+e-print), attempt 2 (outreach-lookup)");
  for (let i = 0; i < 9; i++) ins.run("p" + i, "2610.1" + i, "A. Person", "someone" + i + "@example.org", "arxiv-radar widened: pending paper " + i, "pending", "2026-10-18 09:00:00", 0, null);
  for (let i = 0; i < 5; i++) ins.run("s" + i, "2609." + i, "B. Person", "sent" + i + "@example.org", "x", "sent", "2026-10-01 09:00:00", 1, null);
  if (opts.broken) db.exec("DROP TABLE outreach_queue");
  return { AUDIT: { prepare: (sql) => { const st = db.prepare(sql); return { all: async () => ({ results: st.all() }) }; } } };
};

// 1. recognising the question
const asks = ["WHAT OUTREACH 'NEEDS CONTACT'?", "which outreach needs contact", "what is in needs-contact", "outreach papers waiting for an author email", "Which outreach is awaiting a contact address?"];
ok(asks.every((q) => sb.CMD_OUTREACH_RX.test(q)), "the owner's question and its variants are answered from the table", asks.filter((q) => !sb.CMD_OUTREACH_RX.test(q)));
const nots = ["status", "How is outreach doing?", "update my contact page", "who needs contact info for the mail from acme?", "fix all the issues", "what is the fleet status"];
ok(nots.every((q) => !sb.CMD_OUTREACH_RX.test(q)), "unrelated questions are not taken by the outreach intent", nots.filter((q) => sb.CMD_OUTREACH_RX.test(q)));
ok(sb.OUTREACH_Q.test("How is outreach doing?") && sb.OUTREACH_Q.test("needs contact") && !sb.OUTREACH_Q.test("fleet status"), "a question about outreach reads the facts for the model");

// 2. the facts
const f = await sb.outreachFacts(mk());
ok(f.waiting_total === 9 && f.waiting.length === 9 && f.by_status.find((r) => r.status === "needs-contact").n === 8, "counts by status and nine waiting rows (8 needs-contact, 1 needs-email)", { t: f.waiting_total, s: f.by_status });
ok(f.waiting[0].status === "needs-email" && f.waiting[1].paper_id === "2610.23840v1" && f.waiting[1].title === live[0][1].slice(0, 140), "oldest first, title without the arxiv-radar prefix", f.waiting.slice(0, 2));
const blob = JSON.stringify(f);
ok(!/secret@example\.org|Dr\. Secret Name|someone\d@example\.org|A\. Person|sent\d@example\.org/.test(blob), "no address or author name is in the facts, even from a row that carries them", blob.slice(0, 200));
ok(f.waiting.find((w) => w.paper_id === "2610.99999v1").title === null, "a title is shown only for the arxiv-radar shape of reason");
const selects = [...src.slice(src.indexOf("async function outreachFacts"), src.indexOf("function outreachFactsText")).matchAll(/SELECT (.*?) FROM outreach_queue/g)].map((m) => m[1]);
ok(selects.length === 2 && selects.every((s) => !/\b(author|email)\b/i.test(s)), "the address and author columns are never selected", selects);

// 3. the text
const txt = sb.outreachFactsText(f);
ok(live.every((r) => txt.indexOf(r[0]) >= 0) && txt.indexOf("Self-Building Labs") >= 0 && /9 papers are waiting for an author address/.test(txt), "the answer names every waiting paper", txt.slice(0, 200));
ok(/every 120 minutes/.test(txt) && /3 failed lookups/.test(txt) && /11:00 Amsterdam/.test(txt) && !/no outreach|no queue/i.test(txt), "it says what the status means and never that there is no queue");
const empty = sb.outreachFactsText(await sb.outreachFacts(mk({ empty: true })));
ok(/No paper is waiting for an author address/.test(empty), "an empty waiting list says so", empty);
const err = await sb.outreachFacts(mk({ broken: true }));
const errTxt = sb.outreachFactsText(err);
ok(err.error && /could not be read/.test(errTxt) && !/No paper is waiting/.test(errTxt), "a read error is reported as unreadable, not as an empty queue", errTxt);

// 4. the deterministic answer
const di = await sb.cmdIntent(mk(), "WHAT OUTREACH 'NEEDS CONTACT'?", { holder: false });
ok(di && di.intent === "outreach-needs-contact" && di.text.indexOf("2610.23840v1") >= 0 && Array.isArray(di.actions) && di.actions.length === 0, "the explicit question gets the data answer with no actions", di && di.intent);
ok((await sb.cmdIntent(mk(), "how is the fleet", {})) === null, "any other question still goes on to the model");

// 5. CONTEXT for the model
const v = { items: Array.from({ length: 12 }, (_, i) => ({ key: "k" + i, title: "t" + i, why: "w".repeat(380), source: "s" })), upcoming: [], decision: { verdict: "continue", risk: "low", headline: "h", reasons: ["r"], flips: [] }, system: { verdict: "ok", errors: 0, warnings: 0, probes_ok: 1, probes_total: 1 } };
const ctx = sb.askContextObj(v, null, f);
ok(Object.keys(ctx)[0] === "outreach", "outreach is the first key of the context", Object.keys(ctx));
const json = sb.askContext(v, null, f);
ok(json.length <= 6e3 && json.indexOf("2610.23840v1") >= 0 && json.indexOf("Self-Building Labs") >= 0, "a long queue cannot cut the outreach facts off the 6000-character context", json.length);
ok(sb.askContext(v, null, null).indexOf("outreach") < 0, "without outreach facts the context is as before");
seen.length = 0; await sb.runAsk({}, "what outreach needs contact", v, null, f);
ok(seen.length === 1 && seen[0][0].content.indexOf(sb.ASK_OUTREACH_RULE) >= 0 && seen[0][0].content.indexOf("2610.23840v1") >= 0, "the model is told what CONTEXT.outreach is and is given it", seen[0] && seen[0][0].content.length);
seen.length = 0; await sb.runAsk({}, "how is the fleet", v, null, null);
ok(seen[0][0].content.indexOf("CONTEXT.outreach") < 0, "the rule is added only when the facts are");

// 6. the no-model fallback
const fbk = sb.cmdFallback({ v: null, outreach: f }, "glm: timeout 13s");
ok(fbk.indexOf("2610.23840v1") >= 0 && !/does not cover this question/.test(fbk), "the fallback answers an outreach question from the stored facts", fbk.slice(0, 160));
ok(/does not cover this question/.test(sb.cmdFallback({ v: null }, "x")), "a question with no topical facts is still told so plainly");

// 7. wiring
ok(/if \(OUTREACH_Q\.test\(text\)\) c\.outreach = await outreachFacts\(env\);/.test(src) && (src.match(/OUTREACH_Q\.test\(text\)/g) || []).length === 2, "the open Ask job and the command line both read the facts when asked");
ok(/runAsk\(env, text, v, c\.mail, c\.outreach\)/.test(src) && /askContextObj\(v, c\.mail, c\.outreach\)/.test(src), "both paths hand the facts to the context");
{ const m = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(src); ok(m && Number(m[1]) * 1e6 + Number(m[2]) * 1e3 + Number(m[3]) >= 1050000, "VERSION is at least 1.50.0", m && m[0]); }
console.log(fail ? fail + " failed, " + pass + " passed" : pass + " passed, 0 failed");
process.exit(fail ? 1 : 0);
