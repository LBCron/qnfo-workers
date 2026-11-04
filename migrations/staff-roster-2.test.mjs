import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-04-staff-roster-2.sql", import.meta.url), "utf8");
const steps = JSON.parse(sql.match(/definition = '(\{.*?\})', version/s)[1].replace(/''/g, "'")).steps;
const ux = steps.find((s) => s.name === "ux-request").sql;
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE product_registry (product TEXT, host TEXT, worker TEXT, program_code TEXT, state TEXT);
CREATE TABLE site_ux_checks (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), product TEXT, host TEXT, status INTEGER, ms INTEGER, bytes INTEGER, score INTEGER, findings TEXT);
CREATE TABLE cf_agent_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, requester TEXT, kind TEXT, prompt TEXT, instance TEXT, priority TEXT, status TEXT DEFAULT 'queued', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE roadmap_proposals (id INTEGER PRIMARY KEY, request_instance TEXT, status TEXT);
INSERT INTO product_registry VALUES ('q08-home','q08.org','q08-signal-engine','QNFO.REACH','active'),('travel','travel.q08.org','personal-companion','QNFO.PERSONAL','active'),('papers','papers.qnfo.org','qnfo-gateway','QNFO.RSCH','active'),('jobs','jobs.q08.org','qnfo-jobsearch','QNFO.PERSONAL','active');
INSERT INTO site_ux_checks (product,host,status,ms,bytes,score,findings) VALUES
 ('q08-home','q08.org',200,3056,9000,88,'[{"k":"slow","d":12,"n":3056}]'),
 ('travel','travel.q08.org',401,426,900,100,'[{"k":"auth-gated","d":0,"n":1}]'),
 ('papers','papers.qnfo.org',200,300,9000,100,'[]'),
 ('papers','papers.qnfo.org/papers/x',200,300,9000,80,'[{"k":"no-viewport","d":15,"n":1},{"k":"no-lang","d":5,"n":1}]'),
 ('jobs','jobs.q08.org',200,300,9000,96,'[]');
`);
db.exec(ux);
let r = db.prepare("SELECT instance, prompt FROM cf_agent_requests").all();
assert.equal(r.length, 1, "cap of one per run");
db.exec("DELETE FROM cf_agent_requests");
db.exec("UPDATE site_ux_checks SET ts = strftime('%Y-%m-%dT%H:%M:%SZ','now','-5 hours') WHERE product = 'q08-home'");
db.exec(ux);
r = db.prepare("SELECT instance, prompt FROM cf_agent_requests").all();
assert.equal(r.length, 1);
assert.match(r[0].instance, /-ux-papers-/, "worst page of papers filed, auth-gated travel and healthy jobs skipped");
assert.match(r[0].prompt, /papers\.qnfo\.org\/papers\/x/, "prompt names the page");
db.exec("DELETE FROM cf_agent_requests");
db.exec("UPDATE site_ux_checks SET ts = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE product = 'q08-home'; UPDATE site_ux_checks SET score = 99, findings = '[]' WHERE product = 'papers'");
db.exec(ux);
r = db.prepare("SELECT instance FROM cf_agent_requests").all();
assert.equal(r.length, 1);
assert.match(r[0].instance, /-ux-q08-home-/, "a slow page files even at score 88");
console.log("staff-roster-2: ok");
