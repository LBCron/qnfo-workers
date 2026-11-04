// TEXT-QUALITY-LOOP-1 offline suite (qnfo-fleet-dashboard 1.22.2, agent_issues 1895): GET /api/generators reads the
// inventory migration's rows from D1 and proves each generator's latest run with the fixed GENERATOR_RUNS queries, against
// node:sqlite with the migration applied and the proof tables in both timestamp formats.
// Run: node --no-warnings qnfo-fleet-dashboard/generators.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mig = readFileSync(new URL("../migrations/2026-10-05-text-generator-inventory.sql", import.meta.url), "utf8");
const a = src.indexOf("var GENERATOR_RUNS = {"), b = src.indexOf("// WATCHMAKER-INDEX-1 (1.14.0");
const d = src.indexOf("const D1_PRIMARY_ONLY"), e = src.indexOf("__name(d1all, \"d1all\");");
if (a < 0 || b < a || d < 0 || e < d) throw new Error("TEXT-QUALITY-LOOP-1 block not found in worker.js");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };

const db = new DatabaseSync(":memory:");
db.exec(mig);
db.exec(`CREATE TABLE signals (id INTEGER PRIMARY KEY, source TEXT, ts TEXT);
  CREATE TABLE ask_events (id INTEGER PRIMARY KEY, ts TEXT);
  CREATE TABLE errata_actions (id INTEGER PRIMARY KEY, created_at TEXT);
  CREATE TABLE research_queue (id INTEGER PRIMARY KEY, published_at TEXT);
  CREATE TABLE social_threads (id INTEGER PRIMARY KEY, posted_at TEXT);
  CREATE TABLE email_reply_queue (id INTEGER PRIMARY KEY, sent_at TEXT);
  CREATE TABLE self_questions (id INTEGER PRIMARY KEY, ts TEXT);
  CREATE TABLE paper_revision_log (id INTEGER PRIMARY KEY, created_at TEXT);
  CREATE TABLE chat (id INTEGER PRIMARY KEY, ts TEXT);`);
const NOW = Date.parse("2026-10-05T19:00:00Z");
const iso = (dd) => new Date(NOW - dd * 864e5).toISOString(), sp = (dd) => iso(dd).replace("T", " ").slice(0, 19);
db.exec(`INSERT INTO signals (source, ts) VALUES ('q08', '${iso(1)}'), ('q08', '${iso(10)}'), ('reading', '${iso(2)}');
  INSERT INTO ask_events (ts) VALUES ('${iso(0.1)}');
  INSERT INTO errata_actions (created_at) VALUES ('${sp(34)}');
  INSERT INTO research_queue (published_at) VALUES ('${iso(0.3)}'), (NULL);
  INSERT INTO social_threads (posted_at) VALUES ('${sp(2)}'), ('${sp(3)}'), (NULL);
  INSERT INTO email_reply_queue (sent_at) VALUES ('${sp(8)}');
  INSERT INTO self_questions (ts) VALUES ('${iso(0.8)}');
  INSERT INTO paper_revision_log (created_at) VALUES ('${sp(0.3)}');
  INSERT INTO chat (ts) VALUES ('${iso(0.04)}');`);
const shim = { prepare: (sql) => { let args = []; const st = { bind: (...x) => { args = x; return st; }, all: async () => ({ results: db.prepare(sql).all(...args) }) }; return st; } };
const ctx = vm.createContext({ Date, Math, Number, String, JSON, Object });
const W = vm.runInContext(src.slice(d, e) + "\n" + src.slice(a, b) + "\n;({ generatorInventory, GENERATOR_RUNS });", ctx, { filename: "qnfo-fleet-dashboard#TEXT-QUALITY-LOOP-1" });

const r = await W.generatorInventory({ AUDIT: shim }, NOW);
const by = Object.fromEntries(r.generators.map((g) => [g.generator, g]));
ok(r.ok && r.count === 12 && r.complete === 12, "12 generators, every one with the four fields filled (count " + r.count + ", complete " + r.complete + ")");
ok(Object.keys(W.GENERATOR_RUNS).every((k) => by[k]), "every GENERATOR_RUNS key names an inventory row");
ok(r.generators.every((g) => !g.run.note || /^no per-call row/.test(g.run.note)), "every proof query runs (no 'proof query failed')");
ok(by["q08-essay"].run.runs_7d === 1 && by["q08-essay"].run.last_run === iso(1), "q08: latest published piece and only the one inside 7 days");
ok(by["social-thread"].run.runs_7d === 2 && by["email-auto-answer"].run.runs_7d === 0 && by["errata-correction"].run.runs_7d === 0, "space-format tables use a space-format cutoff");
ok(by["paper-ask"].run.last_run === null && /no per-call row/.test(by["paper-ask"].run.note) && by["patent-disclosure"].run.runs_7d === null, "generators without a qnfo-audit run row say so instead of reading 0");
ok(r.with_cross_family_read === 3 && by["companion-essay"].fields_none.includes("outcome_metric"), "gaps are counted, not hidden (cross-family reads " + r.with_cross_family_read + ")");
ok(r.ran_7d === 8, "8 generators ran within 7 days in the fixture (errata 34d and email 8d are outside) (got " + r.ran_7d + ")");
db.exec("DROP TABLE text_generator_inventory");
const broken = await W.generatorInventory({ AUDIT: shim }, NOW);
ok(broken.ok === false && /unreadable/.test(broken.error), "a missing inventory table is an error, not an empty list");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
