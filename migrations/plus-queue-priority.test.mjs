// PLUS-QUEUE-PRIORITY-1 offline suite: replays migrations/2026-11-05-plus-queue-priority.sql on node:sqlite against a fixture of the live pl-research and pl-plus-keep-rate steps.
// Proves: a shed request no longer uses the day's cap, the requests are filed at priority high, a preface-only answer does not use the product's day while a TITLE: answer does, the
// keep-rate step is UNMEASURED with no verdict and real with one, the legacy ledger row is rejected, a replay changes nothing. No live state is read.
// Output MUST contain "0 failed" on success.   node --no-warnings migrations/plus-queue-priority.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, "2026-11-05-plus-queue-priority.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const hdr = (k) => (sql.split("\n").find((l) => l.startsWith("-- " + k + ": ")) || "").slice(k.length + 4).trim();
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit" && hdr("BACKUP") === "bak_20261105_plus_queue" && hdr("Rollback").length > 60, "the header opts in with a backup and one Rollback line");
ok(sql.split("\n").filter((l) => /^-- Rollback: /.test(l)).length === 1 && !/decision_log/i.test(hdr("Rollback")), "one single-line Rollback that leaves the append-only decision_log alone");
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(!/\bDROP\b/i.test(body) && !/\bDELETE\b/i.test(body), "the body deletes and drops nothing");

// the live step shapes (reduced to the clauses the migration touches and the ones that decide the outcome)
const research = "INSERT INTO cf_agent_requests (requester, kind, prompt, instance, priority) SELECT 'program-manager:' || r.program_code, 'run', 'ask ' || r.product, 'roadmap-' || r.program_code || '-plus-' || r.product || '-' || strftime('%Y%m%d', 'now'), 'medium' FROM v_product_plus_due d JOIN product_registry r ON r.product = d.product WHERE d.in_flight = 0 AND NOT EXISTS (SELECT 1 FROM cf_agent_requests q WHERE q.instance = 'roadmap-' || r.program_code || '-plus-' || r.product || '-' || strftime('%Y%m%d', 'now') AND (q.status IN ('queued', 'running') OR (q.status = 'done' AND COALESCE(q.result, '') NOT LIKE '(the model returned no text)%' AND COALESCE(q.result, '') <> ''))) AND (SELECT COUNT(*) FROM cf_agent_requests q WHERE q.instance LIKE 'roadmap-%-plus-%-' || strftime('%Y%m%d', 'now')) < COALESCE((SELECT CAST(value AS INTEGER) FROM ops_config WHERE key = 'product_plus_daily_cap'), 3) ORDER BY d.hours_since_plus DESC LIMIT 3";
const keep = "UPDATE metric_registry SET last_value = CAST(ROUND(1.0 * (SELECT COUNT(*) FROM plus_ledger WHERE status = 'kept' AND decided_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days')) / MAX(1, (SELECT COUNT(*) FROM plus_ledger WHERE status IN ('kept', 'reverted') AND decided_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days'))), 3) AS TEXT), last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED' WHERE metric = 'plus_keep_rate_30d'";
const DDL = `
CREATE TABLE fleet_tasks(id TEXT PRIMARY KEY, definition TEXT, version INT, updated_at TEXT);
CREATE TABLE ops_config(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE product_registry(product TEXT PRIMARY KEY, program_code TEXT);
CREATE TABLE cf_agent_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, requester TEXT, kind TEXT, prompt TEXT, instance TEXT, priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'queued', result TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE TABLE plus_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT, product TEXT, status TEXT, issue_id INTEGER, evidence TEXT, outcome TEXT, decided_at TEXT);
CREATE TABLE metric_registry(metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL DEFAULT 'p', action TEXT NOT NULL DEFAULT 'a', verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL DEFAULT 'q', expected_cadence_h INTEGER, status TEXT DEFAULT 'active');
CREATE TABLE decision_log(id INTEGER PRIMARY KEY, actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested);
CREATE VIEW v_product_plus_due AS SELECT p.product, 150 AS hours_since_plus, (SELECT COUNT(*) FROM plus_ledger l WHERE l.product = p.product AND l.status IN ('proposed','building','reverting')) AS in_flight FROM product_registry p;
`;
const mk = () => {
  const d = new DatabaseSync(":memory:");
  d.exec(DDL);
  d.prepare("INSERT INTO fleet_tasks VALUES ('management-personas-plus', ?, 7, 'x')").run(JSON.stringify({ steps: [{ type: "sql", name: "pl-research", db: "AUDIT", sql: research }, { type: "sql", name: "pl-plus-keep-rate", db: "AUDIT", sql: keep }, { type: "sql", name: "pl-other", db: "AUDIT", sql: "SELECT 1" }] }));
  for (const [p, c] of [["jobs", "QNFO.PERSONAL"], ["travel", "QNFO.PERSONAL"], ["papers", "QNFO.RSCH"], ["q08-home", "QNFO.REACH"], ["companion-today", "QNFO.PERSONAL"]]) d.prepare("INSERT INTO product_registry VALUES (?, ?)").run(p, c);
  d.prepare("INSERT INTO metric_registry VALUES ('plus_keep_rate_30d', '0.0', 'x', 'MEASURED')").run();
  return d;
};
const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const req = (d, product, prog, status, result, error) => d.prepare("INSERT INTO cf_agent_requests (requester, kind, prompt, instance, priority, status, result, error) VALUES ('program-manager:' || ?, 'run', 'p', 'roadmap-' || ? || '-plus-' || ? || '-' || ?, 'medium', ?, ?, ?)").run(prog, prog, product, today, status, result, error);
const step = (d, name) => JSON.parse(d.prepare("SELECT definition FROM fleet_tasks WHERE id='management-personas-plus'").get().definition).steps.find((s) => s.name === name).sql;
const newRows = (d, before) => d.prepare("SELECT instance i, priority p FROM cf_agent_requests WHERE id > ? ORDER BY id").all(before);
const lastId = (d) => (d.prepare("SELECT COALESCE(MAX(id), 0) m FROM cf_agent_requests").get().m);

// ---- the defect as it is today: three shed requests use the whole cap of the day ----
let d = mk();
req(d, "jobs", "QNFO.PERSONAL", "failed", null, "shed: waited over 110 minutes under the daily neuron budget (QNFO-AGENTS-BUDGET-1)");
req(d, "travel", "QNFO.PERSONAL", "failed", null, "shed: waited over 110 minutes under the daily neuron budget (QNFO-AGENTS-BUDGET-1)");
req(d, "papers", "QNFO.RSCH", "failed", null, "shed: waited over 110 minutes under the daily neuron budget (QNFO-AGENTS-BUDGET-1)");
let b = lastId(d);
d.exec(research);
ok(newRows(d, b).length === 0, "before: three shed requests use the cap, nothing is filed", newRows(d, b));

// ---- apply ----
d.exec(body);
const v = d.prepare("SELECT version v FROM fleet_tasks").get().v;
ok(v === 11, "the task version rises by one per edit (four edits)", v);
const defn = JSON.parse(d.prepare("SELECT definition FROM fleet_tasks").get().definition);
ok(defn.steps.length === 3 && defn.steps[2].sql === "SELECT 1", "the other steps are untouched");
b = lastId(d);
d.exec(step(d, "pl-research"));
let rows = newRows(d, b);
ok(rows.length === 3 && rows.every((r) => r.p === "high"), "after: three requests are filed at priority high although three shed ones exist", rows);

// a second run files nothing: the three new ones are queued
b = lastId(d);
d.exec(step(d, "pl-research"));
ok(newRows(d, b).length === 0, "queued requests count against the cap and the product dedupe: a second run files nothing", newRows(d, b));

// ---- the cap still binds on requests that reached the queue's worker ----
d = mk(); d.exec(body);
req(d, "jobs", "QNFO.PERSONAL", "done", "TITLE: a plus\nWHY: x", null);
req(d, "travel", "QNFO.PERSONAL", "done", "TITLE: a plus\nWHY: x", null);
req(d, "papers", "QNFO.RSCH", "queued", null, null);
b = lastId(d); d.exec(step(d, "pl-research"));
ok(newRows(d, b).length === 0, "three requests that were not shed use the cap: nothing more is filed", newRows(d, b));

// ---- a preface-only answer does not use the product's day; a TITLE answer does ----
d = mk(); d.exec(body);
req(d, "jobs", "QNFO.PERSONAL", "done", "I'll start by reading the jobs worker from the user's side.", null);
req(d, "travel", "QNFO.PERSONAL", "done", "TITLE: Show the next flight first\nWHY: x", null);
b = lastId(d); d.exec(step(d, "pl-research"));
rows = newRows(d, b);
const names = rows.map((r) => r.i.split("-plus-")[1].replace(/-\d{8}$/, ""));
ok(names.includes("jobs") && !names.includes("travel"), "the preface-only product is asked again, the product with a TITLE answer is not", names);
ok(rows.length >= 1 && rows.length <= 3, "the cap is read once per run, as before: with two used the run may file up to its LIMIT 3 (unchanged behaviour)", rows);
d = mk(); d.exec(body);
req(d, "jobs", "QNFO.PERSONAL", "done", "**TITLE:** Group stretch matches\nWHY: x", null);
b = lastId(d); d.exec(step(d, "pl-research"));
ok(!newRows(d, b).some((r) => /-plus-jobs-/.test(r.i)), "a markdown TITLE answer counts as the answer");

// ---- keep rate: unmeasured with no verdict, real with one ----
d = mk(); d.exec(body);
d.exec(step(d, "pl-plus-keep-rate"));
let m = d.prepare("SELECT last_value v, state s FROM metric_registry WHERE metric='plus_keep_rate_30d'").get();
ok(m.v === null && m.s === "UNMEASURED", "no kept or reverted plus: UNMEASURED with no value (it read 0.0 before)", m);
d.exec("INSERT INTO plus_ledger (product, status, decided_at) VALUES ('jobs','kept', strftime('%Y-%m-%dT%H:%M:%SZ','now')), ('travel','reverted', strftime('%Y-%m-%dT%H:%M:%SZ','now'))");
d.exec(step(d, "pl-plus-keep-rate"));
m = d.prepare("SELECT last_value v, state s FROM metric_registry WHERE metric='plus_keep_rate_30d'").get();
ok(m.v === "0.5" && m.s === "MEASURED", "one kept, one reverted: 0.5 MEASURED", m);
d.exec("UPDATE plus_ledger SET status = 'reverted'");
d.exec(step(d, "pl-plus-keep-rate"));
m = d.prepare("SELECT last_value v, state s FROM metric_registry WHERE metric='plus_keep_rate_30d'").get();
ok(m.v === "0.0" && m.s === "MEASURED", "all reverted: a real 0.0 still breaches", m);

// ---- the legacy ledger row ----
d = mk();
d.exec("INSERT INTO plus_ledger (id, product, status, issue_id, evidence, decided_at) VALUES (1, 'companion-today', 'proposed', NULL, 'Migrated from the legacy product plus ledger', '2026-10-29 12:29:00')");
d.exec("INSERT INTO plus_ledger (id, product, status, issue_id, evidence, decided_at) VALUES (2, 'jobs', 'building', 1001801, 'proposal #2152 (x)', '2026-11-04 19:52:46')");
ok(d.prepare("SELECT in_flight n FROM v_product_plus_due WHERE product='companion-today'").get().n === 1, "before: the legacy row keeps companion-today in flight");
d.exec(body);
const l1 = d.prepare("SELECT status s, outcome o FROM plus_ledger WHERE id=1").get(), l2 = d.prepare("SELECT status s FROM plus_ledger WHERE id=2").get();
ok(l1.s === "rejected" && /^superseded: legacy/.test(l1.o) && l2.s === "building", "the legacy row is rejected with its reason, the row in build is untouched", [l1, l2]);
ok(d.prepare("SELECT in_flight n FROM v_product_plus_due WHERE product='companion-today'").get().n === 0, "companion-today leaves in flight");

// ---- replay and a changed definition ----
d = mk(); d.exec(body);
const snap = () => JSON.stringify([d.prepare("SELECT definition, version FROM fleet_tasks").all(), d.prepare("SELECT COUNT(*) n FROM decision_log").get()]);
const s1 = snap(); d.exec(body);
ok(snap() === s1, "a replay changes nothing and writes no second decision row");
ok(d.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "one decision_log row");
d = mk();
d.exec("UPDATE fleet_tasks SET definition = replace(definition, 'ORDER BY d.hours_since_plus DESC', 'ORDER BY d.hours_since_plus ASC')");
const base = d.prepare("SELECT definition x FROM fleet_tasks").get().x;
d.exec("UPDATE fleet_tasks SET definition = replace(definition, '''medium'' FROM v_product_plus_due', '''low'' FROM v_product_plus_due')");
const changed = d.prepare("SELECT definition x FROM fleet_tasks").get().x;
d.exec(body);
const partial = d.prepare("SELECT definition x, version v FROM fleet_tasks").get();
ok(partial.x.includes("'low' FROM v_product_plus_due") && !partial.x.includes("'high' FROM v_product_plus_due") && partial.x.includes("NOT LIKE 'shed:%'") && partial.v === 10 && changed !== base, "an edit whose old text is gone is not applied, the other three still are", partial.v);

// ---- Rollback ----
d = mk(); d.exec(body);
d.exec("INSERT INTO plus_ledger (id, product, status, issue_id, evidence, decided_at) VALUES (1, 'companion-today', 'proposed', NULL, 'Migrated from the legacy product plus ledger', '2026-10-29 12:29:00')");
d.exec(body);
d.exec(hdr("Rollback"));
const rb = d.prepare("SELECT definition x, version v FROM fleet_tasks").get();
ok(rb.x.includes("'medium' FROM v_product_plus_due") && rb.v >= 12, "the Rollback restores the saved definition", rb.v);
ok(d.prepare("SELECT status s FROM plus_ledger WHERE id=1").get().s === "proposed", "the Rollback restores the legacy row");

// ---- the detector ----
d = mk(); d.exec(body);
const probe = d.prepare("SELECT verify_probe p, verify_transport t, status s FROM remediation_contracts WHERE class = 'fm-plus-requests-unanswered'").get();
ok(probe && probe.t === "d1-query" && probe.s === "active" && d.prepare("SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'plus-requests-unanswered'").get().n === 1, "one failure mode and one active d1-query detector");
const read = () => d.prepare(probe.p).get();
let r = read();
ok(r.expected === "ok" && /^no plus request answered with a TITLE line in 24 hours while 5 products are due$/.test(r.observed), "products due and no answer: the detector names the gap", r);
req(d, "jobs", "QNFO.PERSONAL", "done", "I'll start by reading the jobs worker.", null);
ok(read().observed !== "ok", "a preface-only answer does not satisfy it");
req(d, "travel", "QNFO.PERSONAL", "done", "TITLE: x WHY: y", null);
ok(read().observed === "ok", "an answered request with a TITLE line reads ok");
d.exec("DELETE FROM cf_agent_requests; DELETE FROM product_registry");
ok(read().observed === "ok", "no product due: ok");
const bd = d.prepare("SELECT COUNT(*) n FROM remediation_contracts").get().n;
d.exec(body);
ok(d.prepare("SELECT COUNT(*) n FROM remediation_contracts").get().n === bd && d.prepare("SELECT COUNT(*) n FROM failure_modes").get().n === 1, "a replay adds no second failure mode or contract");

// ---- the migration check ----
const PY = ["python3", "python"].find((cmd) => spawnSync(cmd, ["-I", "-c", "import sys"], { encoding: "utf8" }).status === 0);
if (PY) {
  const chk = spawnSync(PY, ["-I", join(here, "..", "scripts", "apply_migrations.py"), "--check", FILE], { encoding: "utf8" });
  ok(chk.status === 0 && /"ok": true/.test(chk.stdout), "the file passes scripts/apply_migrations.py --check", chk.stdout + chk.stderr);
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
