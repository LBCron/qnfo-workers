// PLUS-2 / PLUS-5 offline suite: replays migrations/2026-11-05-plus-2-5-usage-digest.sql on node:sqlite against a fixture of the live layout.
// It does not depend on live state. Output MUST contain "0 failed" on success.   node migrations/plus-2-5.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../migrations/2026-11-05-plus-2-5-usage-digest.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "header opts in");
ok(/^-- CAUSE-MAPPED: /m.test(sql) && !/INTO metric_registry/i.test(sql), "registers no metric, says so");
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
const db = new DatabaseSync(":memory:");
const iso = (ms) => new Date(ms).toISOString();
const now = Date.now();
db.exec(`
CREATE TABLE fleet_tasks(id TEXT PRIMARY KEY, name TEXT, type TEXT, definition TEXT, timeout_ms INT, retries INT, version INT, enabled INT, updated_at TEXT);
CREATE TABLE product_registry(product TEXT PRIMARY KEY, host TEXT, worker TEXT, program_code TEXT, what_for TEXT, usage_metric TEXT, quality_measure TEXT, plus_cadence_h INT, last_plus_at TEXT, rest_until TEXT, misses_in_row INT, pluses_since_simplify INT, state TEXT DEFAULT 'active', created_at TEXT);
CREATE TABLE worker_usage_daily(day TEXT, script TEXT, requests_24h INT, errors_24h INT, requests_7d INT, errors_7d INT, source TEXT, ts TEXT, PRIMARY KEY(day, script));
CREATE TABLE youtube_videos(id INTEGER PRIMARY KEY, state TEXT, views INT, retention_read_at TEXT);
CREATE TABLE plus_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT, product_slug TEXT, plus TEXT, status TEXT, decided_at TEXT, product TEXT, title TEXT);
CREATE TABLE failure_modes(fm_key TEXT PRIMARY KEY, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius);
CREATE TABLE remediation_contracts(class TEXT PRIMARY KEY, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at);
CREATE TABLE decision_log(id INTEGER PRIMARY KEY, actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested);
`);
const fresh = iso(now - 20 * 3600e3), stale = iso(now - 60 * 3600e3);
const today = fresh.slice(0, 10);
const prod = db.prepare("INSERT INTO product_registry(product, host, worker, program_code, plus_cadence_h, state, created_at) VALUES (?,?,?,?,24,'active','2026-10-29')");
[["jobs", "jobs.q08.org", "qnfo-jobsearch"], ["papers", "papers.qnfo.org", "qnfo-gateway"], ["shorts-channel", "youtube", "qnfo-youtube-shorts"], ["gone", "x", "no-such-worker"], ["old", "y", "qnfo-old"]].forEach((r) => prod.run(r[0], r[1], r[2], "P"));
db.exec("INSERT INTO product_registry(product, host, worker, program_code, plus_cadence_h, state, created_at) VALUES ('rested','z','qnfo-jobsearch','P',24,'retired','2026-10-29')");
const wu = db.prepare("INSERT INTO worker_usage_daily VALUES (?,?,?,?,?,?,?,?)");
wu.run(today, "qnfo-jobsearch", 965, 0, 6126, 3, "cf", fresh);
wu.run(today, "qnfo-gateway", 26215, 0, 165043, 0, "cf", fresh);
wu.run(today, "qnfo-youtube-shorts", 926, 0, 5589, 0, "cf", fresh);
wu.run("2000-01-01", "qnfo-old", 1, 0, 9, 0, "cf", stale);
db.exec("INSERT INTO youtube_videos(state, views, retention_read_at) VALUES ('uploaded', NULL, NULL), ('uploaded', NULL, NULL)");
const steps = [{ type: "sql", name: "pl-ledger", db: "AUDIT", sql: "SELECT 1" }, { type: "sql", name: "pl-plus-keep-rate", db: "AUDIT", sql: "SELECT 1" }];
db.prepare("INSERT INTO fleet_tasks VALUES('management-personas-plus','n','workflow',?,120000,1,2,1,'x')").run(JSON.stringify({ steps }));
db.exec("INSERT INTO plus_ledger(product_slug, plus, status, decided_at, product, title) VALUES ('jobs','a','proposed','" + iso(now - 3600e3).replace("T", " ").slice(0, 19) + "','jobs','Group stretch matches')");

db.exec(body);
const U = (p) => db.prepare("SELECT usage_metric m, usage_window w, usage_value v, usage_errors e, usage_read_at r, usage_source s FROM product_registry WHERE product=?").get(p);
ok(U("jobs").v === 6126 && U("jobs").e === 3 && U("jobs").m === "worker_requests_7d" && U("jobs").w === "7d" && U("jobs").r === fresh, "a product takes its worker's newest snapshot (requests, errors, read time)");
ok(U("papers").v === 165043, "second product measured");
ok(/not people/.test(U("jobs").s), "the source states it is not a count of people");
ok(U("gone").v === null && U("gone").r === null, "a worker with no snapshot row is unmeasured (NULL), not 0");
ok(U("old").v === null, "a snapshot older than 36 hours is not served (the newest day has no row for it)");
ok(U("shorts-channel").m === "youtube_views_total" && U("shorts-channel").v === null && U("shorts-channel").r === null, "shorts-channel with no view read is NULL, never 0");
ok(U("rested").v === null, "a retired product is not written");

// the stored step statements run and are idempotent; a fresh view read fills shorts-channel
const def = JSON.parse(db.prepare("SELECT definition d FROM fleet_tasks WHERE id='management-personas-plus'").get().d);
const names = def.steps.map((s) => s.name).join(",");
ok(names === "pl-ledger,pl-plus-keep-rate,pl-usage,pl-usage-shorts,pl-digest", "three steps appended in order, existing steps kept: " + names);
ok(db.prepare("SELECT version v FROM fleet_tasks WHERE id='management-personas-plus'").get().v === 3, "task version bumped");
db.exec("UPDATE youtube_videos SET views = 12, retention_read_at = '" + fresh + "' WHERE id = 1");
for (const n of ["pl-usage", "pl-usage-shorts", "pl-digest"]) db.exec(def.steps.find((s) => s.name === n).sql);
ok(U("shorts-channel").v === 12 && U("shorts-channel").r === fresh, "pl-usage-shorts takes the view sum once a read exists");
ok(U("jobs").v === 6126, "pl-usage reruns without change");
db.exec("UPDATE worker_usage_daily SET ts = '" + stale + "' WHERE day = '" + today + "'");
db.exec(def.steps.find((s) => s.name === "pl-usage").sql);
ok(U("jobs").v === null && U("jobs").r === null && U("papers").v === null, "a stale snapshot makes usage unmeasured on the next step run");

// the digest: one row at apply; its text names the ledger rows or says nothing shipped; the step never writes a second row on a non-Monday
const D = db.prepare("SELECT * FROM plus_digest").all();
ok(D.length === 1 && D[0].day === new Date().toISOString().slice(0, 10), "one digest row at apply");
ok(D[0].in_flight === 1 && D[0].decided_7d === 1 && D[0].deployed_7d === 0 && D[0].reverted_7d === 0 && D[0].products === 5, "digest counts: " + JSON.stringify(D[0]));
ok(/no plus was deployed, kept or reverted yet\. 1 in flight\./.test(D[0].body_md), "an empty week says so: " + D[0].body_md);
db.exec("INSERT INTO plus_ledger(product_slug, plus, status, decided_at, product, title) VALUES ('jobs','b','deployed','" + new Date().toISOString().replace("T", " ").slice(0, 19) + "','jobs','Show the reason on every match')");
db.exec("DELETE FROM plus_digest");
db.exec(body.slice(body.indexOf("INSERT OR IGNORE INTO plus_digest"), body.indexOf("UPDATE fleet_tasks")));
const D2 = db.prepare("SELECT * FROM plus_digest").get();
ok(D2.deployed_7d === 1 && /- jobs: Show the reason on every match \[deployed\]/.test(D2.body_md), "a deployed plus is listed by product and title: " + D2.body_md);
ok(db.prepare("SELECT COUNT(*) n FROM plus_digest").get().n === 1, "INSERT OR IGNORE keeps one row a day");

// detectors: both probes execute, and read 0 / 1 as designed
const probe = (c) => db.prepare(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class=?").get(c).p).get();
ok(db.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE class IN ('fm-product-usage-unmeasured','fm-plus-digest-stale')").get().n === 2, "two detector contracts");
ok(db.prepare("SELECT COUNT(*) n FROM failure_modes WHERE fm_key IN ('product-usage-unmeasured','plus-digest-stale')").get().n === 2, "two failure modes");
ok(probe("fm-product-usage-unmeasured").expected === "0" && Number(probe("fm-product-usage-unmeasured").observed) >= 1, "usage detector sees the unmeasured products: " + JSON.stringify(probe("fm-product-usage-unmeasured")));
ok(probe("fm-plus-digest-stale").observed === "0", "digest detector reads 0 with a digest from today");
db.exec("UPDATE plus_digest SET day = '2000-01-01'");
ok(probe("fm-plus-digest-stale").observed === "1", "digest detector reads 1 when the newest digest is old");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'PLUS-2 and PLUS-5:%'").get().n === 1, "one decision_log row");
console.log(pass + " passed, " + fail + " failed");
