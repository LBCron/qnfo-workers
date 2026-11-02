import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-issue-age-secondary-probe.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT, window_note TEXT);
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, created_at INTEGER);
  CREATE VIEW v_issue_age_ladder AS SELECT id, 1 AS breach FROM agent_issues;
  CREATE TABLE issue_age_actions (issue_id INTEGER, rung TEXT);
  CREATE TABLE v_sla_breaches (id INTEGER, breach_type TEXT);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  INSERT INTO control_alternate_probes VALUES ('issue-age-repair-secondary-notice', 'old probe', 'old window');
`);

db.exec(migration);
const probe = db.prepare("SELECT probe_sql FROM control_alternate_probes WHERE control = 'issue-age-repair-secondary-notice'").get().probe_sql;
const observed = () => db.prepare(probe).get().observed;
assert.match(
  db.prepare("SELECT window_note FROM control_alternate_probes WHERE control = 'issue-age-repair-secondary-notice'").get().window_note,
  /allow 15 minutes/
);
const now = Math.floor(Date.now() / 1000) * 1000;
const insertIssue = db.prepare("INSERT INTO agent_issues VALUES (?, ?)");

insertIssue.run(1, now - (24 * 60 + 5) * 60000);
insertIssue.run(2, now - (24 * 60 + 20) * 60000);
assert.equal(observed(), "an overdue issue has no issue_age_actions row");

db.prepare("INSERT INTO issue_age_actions VALUES (2, '24h')").run();
assert.equal(observed(), "an overdue issue is absent from v_sla_breaches");

db.prepare("INSERT INTO v_sla_breaches VALUES (2, 'issue-age-24h')").run();
assert.equal(observed(), "ok", "a newly crossed breach gets one task interval to be recorded");

db.prepare("UPDATE agent_issues SET created_at = ? WHERE id = 1").run(now - (24 * 60 + 16) * 60000);
assert.equal(observed(), "an overdue issue has no issue_age_actions row", "a breach still fails after the scheduler grace");

db.prepare("INSERT INTO issue_age_actions VALUES (1, '24h')").run();
db.prepare("INSERT INTO v_sla_breaches VALUES (1, 'issue-age-24h')").run();
assert.equal(observed(), "ok");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);

db.exec(migration.match(/^-- Rollback: (.+)$/m)[1]);
assert.deepEqual(
  { ...db.prepare("SELECT probe_sql, window_note FROM control_alternate_probes WHERE control = 'issue-age-repair-secondary-notice'").get() },
  { probe_sql: "old probe", window_note: "old window" },
  "rollback restores the prior probe definition"
);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'bak_20261102_issue_age_secondary_probe'").get().n, 0);

console.log("issue-age-secondary-probe: all passed");
db.close();
