// LEDGER-TRUTH-E-2 offline suite. Run: node migrations/e-unmapped-causes.test.mjs
// Every registered metric with an enabled trigger gets a cause (so /api/triage `unmapped` stays empty when one first breaches), and a detector flags the next one that has none.
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT NOT NULL, note TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT);
INSERT INTO metric_registry VALUES ('breaches_unmapped', '1', NULL);
CREATE TABLE trig (metric_key TEXT, hit INTEGER);
CREATE VIEW v_metric_trigger_state AS SELECT metric_key, hit FROM trig;
CREATE VIEW v_breach_by_cause AS SELECT 'unmapped' AS cause_key, COUNT(*) AS breaches FROM trig t WHERE t.hit = 1 AND NOT EXISTS (SELECT 1 FROM metric_breach_cause m WHERE m.metric_key = t.metric_key);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, next_due_at TEXT);
INSERT INTO metric_breach_cause VALUES ('audit_coverage', 'measurement', 'a session mapped this with better evidence');`);
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL " + m); } };
const sql = readFileSync(new URL("./2026-11-05-e-unmapped-causes.sql", import.meta.url), "utf8");
const names = [...sql.matchAll(/^ \('([a-z0-9_]+)', '([a-z-]+)', 'LEDGER-TRUTH-E-2 rule-derived 2026-11-05'\)/gm)].map((m) => [m[1], m[2]]);
const causes = new Set(["spend", "issue-backlog", "code-loop", "owner-routing", "publishing", "heartbeat", "structure", "measurement", "breach-doctor"]);
ok(names.length === 153, "153 mapping rows: " + names.length);
ok(new Set(names.map((n) => n[0])).size === names.length, "no metric is mapped twice in the file");
ok(names.every((n) => causes.has(n[1])), "every cause_key is one of the fleet's nine causes: " + names.filter((n) => !causes.has(n[1])).map((n) => n.join("=")));
// a breaching metric with no row is counted unmapped; the same one mapped by the file is not
for (const m of ["audit_coverage", "cloudflare_token_ok", "papers_fabricated_claims_open", "tick_completion_5m_24h", "owner_queue_fleet_cards_open", "youtube_spend_usd_month"]) db.prepare("INSERT INTO trig VALUES (?, 1)").run(m);
db.exec("INSERT INTO trig VALUES ('brand_new_metric_registered_by_worker_code', 1), ('healthy_metric', 0)");
const unmapped = () => db.prepare("SELECT COUNT(*) n FROM v_breach_by_cause").get().n;
// the detector installs with the file, so its probe is replayed before and after the mapping
db.exec(sql);
const probe = () => db.prepare(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-breach-unmapped'").get().p).get();
ok(probe().expected === "0" && probe().observed === "1", "after the file only the metric nobody mapped is flagged: " + JSON.stringify(probe()));
ok(db.prepare("SELECT cause_key FROM metric_breach_cause WHERE metric_key = 'audit_coverage'").get().cause_key === "measurement", "a mapping made by a session is not overwritten");
const row = (k) => db.prepare("SELECT cause_key c FROM metric_breach_cause WHERE metric_key = ?").get(k);
ok(row("cloudflare_token_ok").c === "structure" && row("papers_fabricated_claims_open").c === "publishing" && row("tick_completion_5m_24h").c === "heartbeat" && row("owner_queue_fleet_cards_open").c === "owner-routing" && row("youtube_spend_usd_month").c === "spend", "spot checks of the rule");
db.exec("INSERT INTO metric_breach_cause VALUES ('brand_new_metric_registered_by_worker_code', 'code-loop', 'a session')");
ok(probe().observed === "0", "once a session maps the new metric the detector reads 0");
ok(db.prepare("SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'breach-unmapped' AND probe_class = 'fm-breach-unmapped' AND issue_id = 1000706").get().n === 1, "the failure mode is registered with its detector class");
const c = db.prepare("SELECT status, module, verify_transport, escalate_to FROM remediation_contracts WHERE class = 'fm-breach-unmapped'").get();
ok(c.status === "active" && c.module === "failure-mode" && c.verify_transport === "d1-query", "the detector contract has the shape of the other failure-mode detectors");
const before = db.prepare("SELECT COUNT(*) n FROM metric_breach_cause").get().n;
db.exec(sql);
ok(db.prepare("SELECT COUNT(*) n FROM metric_breach_cause").get().n === before && db.prepare("SELECT COUNT(*) n FROM failure_modes").get().n === 1, "re-running changes nothing");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- CAUSE-MAPPED: /m.test(sql), "migration header lines");
console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
