import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const migrationPath = 'migrations/2026-11-07-fix-migration-schema-errors-v2.sql';
const migration = readFileSync(new URL(`../${migrationPath}`, import.meta.url), 'utf8');
// Exact statement that failed in apply-migrations run 42373519725.
const previousRegistration = `INSERT OR REPLACE INTO metric_registry (
  metric, kind, target, polarity, formula, state
) VALUES ('research_deferred_pool_pct', 'quality', '10', 'lower_is_better',
  'Percentage of research queue in deferred state', 'MEASURED');`;
const table = (file, name) => {
  const sql = readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
  const match = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\);`));
  assert.ok(match, `canonical ${name} definition exists`);
  return match[0];
};
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(table('2026-11-06-kernel-everywhere.sql', 'personal_replies'));
  db.exec('CREATE INDEX idx_personal_replies_ts ON personal_replies(ts)');
  db.exec(table('2026-10-08-10-queue-sla.sql', 'fleet_tick'));
  db.exec(table('2026-10-26-breach-one-meaning.sql', 'metric_breach_cause'));
  // Live sqlite_master contract, verified against qnfo-audit on 2026-11-07.
  db.exec(`CREATE TABLE metric_registry (
    metric TEXT PRIMARY KEY, layer TEXT NOT NULL, kind TEXT NOT NULL,
    formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT,
    disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT,
    last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT
  );
  CREATE TRIGGER metric_integrity BEFORE INSERT ON metric_registry
  WHEN COALESCE(NEW.source_of_truth, '') = ''
    OR COALESCE(NEW.disposition_actor, '') = ''
    OR COALESCE(NEW.refresh_cadence, '') = ''
  BEGIN SELECT RAISE(ABORT, 'METRIC-INTEGRITY-1'); END;
  CREATE TABLE remediation_contracts (
    class TEXT PRIMARY KEY, issue_id INTEGER, verify_transport TEXT, verify_probe TEXT,
    expected_cadence_h REAL, precondition TEXT, action TEXT, max_attempts INTEGER,
    escalate_to TEXT, status TEXT, module TEXT
  );
  INSERT INTO remediation_contracts(class, status) VALUES ('rt-live-voice-stt', 'active');`);
  return db;
}

const broken = fixture();
assert.throws(() => broken.exec(previousRegistration), /no column named polarity/);
broken.close();
console.log('PASS reproduces the production polarity failure against the live schema');

const db = fixture();
assert.throws(() => db.exec("INSERT INTO metric_registry(metric, layer, kind) VALUES ('invalid', 'operational', 'leading')"), /METRIC-INTEGRITY-1/);
db.exec(migration);
const metric = db.prepare("SELECT * FROM metric_registry WHERE metric = 'research_deferred_pool_pct'").get();
assert.equal(metric.layer, 'operational');
assert.equal(metric.kind, 'leading');
assert.equal(metric.source_of_truth, 'qnfo-audit.research_pool');
assert.equal(metric.refresh_cadence, '10m');
assert.equal(metric.target, '< 0.2');
assert.equal(metric.state, 'PENDING');
assert.equal(db.prepare('SELECT cause_key FROM metric_breach_cause').get().cause_key, 'research-execution');
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts WHERE class LIKE 'issue-8495-%' AND status = 'active'").get().n, 2);
assert.equal(db.prepare("SELECT status FROM remediation_contracts WHERE class = 'rt-live-voice-stt'").get().status, 'superseded');
console.log('PASS executes the entire recovery with mandatory metric integrity fields and cause mapping');

db.exec(`UPDATE metric_registry SET last_value = '0.1', last_refreshed = 'observed', state = 'MEASURED';`);
db.exec(migration);
assert.deepEqual({ ...db.prepare('SELECT last_value, last_refreshed, state FROM metric_registry').get() },
  { last_value: '0.1', last_refreshed: 'observed', state: 'MEASURED' });
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM metric_breach_cause').get().n, 1);
assert.equal(db.prepare("SELECT status FROM bak_20261107_fix_schema_errors WHERE class = 'rt-live-voice-stt'").get().status, 'active');
console.log('PASS replay preserves measured values, state, original backup, and unique registrations');

// Generate ages relative to SQLite's clock, so the retention assertions never expire.
db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000)
  INSERT INTO personal_replies(id, ts) SELECT 'expired-' || x, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-31 days') FROM n;
  INSERT INTO personal_replies(id, ts) VALUES ('recent', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-29 days'));
  INSERT INTO personal_replies(id, ts) VALUES ('expired-sqlite', datetime('now', '-30 days', '-1 hour'));
  INSERT INTO personal_replies(id, ts) VALUES ('recent-sqlite', datetime('now', '-30 days', '+1 hour'));
  INSERT INTO fleet_tick(source) VALUES ('regression-test');`);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM personal_replies').get().n, 3);
assert.ok(db.prepare("SELECT id FROM personal_replies WHERE id = 'recent'").get());
assert.ok(db.prepare("SELECT id FROM personal_replies WHERE id = 'recent-sqlite'").get());
db.exec("INSERT INTO fleet_tick(source) VALUES ('regression-test-replay')");
assert.deepEqual(db.prepare('SELECT id FROM personal_replies ORDER BY id').all().map(row => row.id), ['recent', 'recent-sqlite']);
const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM personal_replies WHERE ts < date('now', '-29 days') AND julianday(ts) < julianday('now', '-30 days') ORDER BY ts LIMIT 1000").all();
assert.ok(plan.some(row => row.detail.includes('idx_personal_replies_ts')));
console.log('PASS real fleet ticks prune expired replies in indexed batches of 1000 and retain recent replies');
db.close();
