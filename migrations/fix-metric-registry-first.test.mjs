// Layer 6 fix test: metric_registry INSERT must come BEFORE metric_breach_cause INSERT
// Tests that metric is registered with all required fields before breach cause mapping
// Validates against actual D1 trigger that requires source_of_truth, disposition_actor, refresh_cadence

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-07-fix-metric-registry-first.sql", import.meta.url), "utf8");
const body = sql.split("\n").filter(l => !l.startsWith("--") && l.trim()).join("\n");

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };

// Actual schemas from ab-length-retry.test.mjs and metric-family-cluster-b.sql
function world() {
  const w = new DatabaseSync(":memory:");
  // metric_registry schema with METRIC-INTEGRITY-1 trigger
  w.exec(`
    CREATE TABLE metric_registry (
      metric TEXT PRIMARY KEY,
      layer TEXT,
      kind TEXT,
      formula TEXT,
      source_of_truth TEXT,
      baseline TEXT,
      target TEXT,
      owner TEXT,
      disposition_actor TEXT,
      refresh_cadence TEXT,
      warning_band TEXT,
      kill_band TEXT,
      last_value TEXT,
      last_refreshed TEXT,
      state TEXT,
      refresh_class TEXT
    );
    
    -- METRIC-INTEGRITY-1: source_of_truth, disposition_actor and refresh_cadence are mandatory
    CREATE TRIGGER metric_registry_source_required_ins
    BEFORE INSERT ON metric_registry
    FOR EACH ROW
    WHEN NEW.source_of_truth IS NULL OR trim(NEW.source_of_truth)=''
      OR NEW.disposition_actor IS NULL OR trim(NEW.disposition_actor)=''
      OR NEW.refresh_cadence IS NULL OR trim(NEW.refresh_cadence)=''
    BEGIN
      SELECT RAISE(ABORT,'METRIC-INTEGRITY-1: source_of_truth, disposition_actor and refresh_cadence are mandatory');
    END;
    
    CREATE TABLE metric_breach_cause (
      metric_key TEXT PRIMARY KEY,
      cause_key TEXT NOT NULL,
      note TEXT
    );
    
    CREATE TABLE remediation_contracts (
      class TEXT PRIMARY KEY,
      issue_id INTEGER,
      precondition TEXT NOT NULL,
      action TEXT NOT NULL,
      verify_probe TEXT NOT NULL,
      verify_transport TEXT NOT NULL,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      escalate_to TEXT NOT NULL,
      expected_cadence_h INTEGER,
      status TEXT DEFAULT 'active',
      ts TEXT DEFAULT (datetime('now')),
      last_attempt_at TEXT,
      last_verdict TEXT,
      module TEXT,
      budget_ms INTEGER DEFAULT 45000,
      next_due_at TEXT,
      max_items INTEGER DEFAULT 5,
      requires_container INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      deferred_since TEXT
    );
    
    -- Pre-populate with existing voice STT contract
    INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, status)
    VALUES ('rt-live-voice-stt', 8501, 'TRUE', 'file_issue', 'SELECT 1', 'd1-query', 'owner', 'active');
  `);
  return w;
}

// Test 1: Migration applies without errors
const w1 = world();
try {
  w1.exec(body);
  ok(true, "migration applies without METRIC-INTEGRITY-1 error");
} catch (e) {
  ok(false, "migration should not raise METRIC-INTEGRITY-1", { error: e.message });
}

// Test 2: Metric is registered in metric_registry with ALL required fields
const metric = w1.prepare("SELECT * FROM metric_registry WHERE metric = 'research_deferred_pool_pct'").get();
ok(metric !== undefined, "research_deferred_pool_pct exists in metric_registry");
ok(metric.source_of_truth === 'qnfo-audit.research_pool', "source_of_truth is set", metric.source_of_truth);
ok(metric.disposition_actor === 'analytics_metric_triggers research_deferred_pool_pct -> agent_issues', "disposition_actor is set", metric.disposition_actor);
ok(metric.refresh_cadence === '10m', "refresh_cadence is set", metric.refresh_cadence);
ok(metric.state === 'PENDING', "state is PENDING before first refresh", metric.state);

// Test 3: Breach cause mapping exists AFTER metric registration
const cause = w1.prepare("SELECT * FROM metric_breach_cause WHERE metric_key = 'research_deferred_pool_pct'").get();
ok(cause !== undefined, "breach cause mapping exists");
ok(cause.cause_key === 'research-execution', "cause key is research-execution", cause.cause_key);

// Test 4: Remediation contracts are correct
const runtime = w1.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-8495-runtime'").get();
ok(runtime !== undefined, "runtime contract exists");
ok(runtime.verify_transport === 'runner-https', "runtime uses runner-https transport");
ok(JSON.parse(runtime.verify_probe).absent === "For the Quniverse", "runtime probe checks for absence of fleet content");

const code = w1.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-8495-code'").get();
ok(code !== undefined, "code contract exists");
ok(code.verify_transport === 'code-read', "code uses code-read transport");
ok(JSON.parse(code.verify_probe).absent === "function fleetAsks", "code probe checks for absence of fleetAsks function");

// Test 5: Voice STT contract status updated
const voice = w1.prepare("SELECT status FROM remediation_contracts WHERE class = 'rt-live-voice-stt'").get();
ok(voice.status === 'removed', "voice STT contract marked removed", voice.status);

// Test 6: Idempotency - re-applying doesn't error or duplicate
const w2 = world();
w2.exec(body);
w2.exec(body); // Second application
const metrics = w2.prepare("SELECT COUNT(*) AS n FROM metric_registry WHERE metric = 'research_deferred_pool_pct'").get();
ok(metrics.n === 1, "metric not duplicated on re-apply", metrics.n);
const causes = w2.prepare("SELECT COUNT(*) AS n FROM metric_breach_cause WHERE metric_key = 'research_deferred_pool_pct'").get();
ok(causes.n === 1, "breach cause not duplicated on re-apply", causes.n);

// Test 7: Validate SQL doesn't use non-existent columns
ok(!body.includes("hit_action"), "migration doesn't reference non-existent hit_action column");
ok(!body.includes("description"), "migration doesn't reference non-existent description column in remediation_contracts");
ok(!body.includes("verify_cadence_h"), "migration doesn't reference non-existent verify_cadence_h column");
ok(!body.includes("metric_name"), "migration doesn't reference non-existent metric_name column");

// Test 8: Statement order is correct (metric_registry BEFORE metric_breach_cause)
const statements = body.split(";").filter(s => s.trim());
const metricRegIdx = statements.findIndex(s => s.includes("INSERT OR REPLACE INTO metric_registry"));
const breachCauseIdx = statements.findIndex(s => s.includes("INSERT OR IGNORE INTO metric_breach_cause"));
ok(metricRegIdx >= 0 && breachCauseIdx >= 0 && metricRegIdx < breachCauseIdx, 
   "metric_registry INSERT comes BEFORE metric_breach_cause INSERT", 
   { metricRegIdx, breachCauseIdx });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
