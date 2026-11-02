// DOCTRINE-LEDGERS-20261012 offline suite for migrations/2026-10-12-20 to -25 (KERNEL-REGISTRIES-1, TICK-DRIVER-ROSTER-1,
// CALIBRATION-SCORER-1, SLA-MECHANISMS-1, REGISTER-DISPOSITIONS-1, RECURRENCE-GUARD-TWIN-1; agent_issues 2231, 2235, 2241, 2232, 2233, 2234, 2251, 2192,
// 2194, 2193, 2195, 2197, 1297, 2148, 2294-2297, 2364, 2365). It applies the six files, twice each, to an in-memory SQLite database built from the qnfo-audit objects they touch (sql
// read from sqlite_master on 2026-10-12) and checks what each fleet_tick trigger wrote. Every file ends by inserting a
// fleet_tick row, so applying a file is also a run of its trigger. Run: node migrations/doctrine-ledgers-20261012.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const SCHEMA = String.raw`
-- Local fixture: the qnfo-audit objects the 2026-10-12-2x migrations touch (sql read from sqlite_master on 2026-10-12).
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT DEFAULT 'optimization', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER, pipeline_stage TEXT DEFAULT NULL, predicate_id TEXT, recheck_count INTEGER DEFAULT 0, close_channel TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT NOT NULL, triage_state TEXT NOT NULL DEFAULT 'triaged', owner TEXT NOT NULL, sla_due_at TEXT NOT NULL, triaged_at TEXT DEFAULT (datetime('now')), remediation TEXT, close_evidence TEXT, reopened_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, event TEXT NOT NULL, from_status TEXT, to_status TEXT, has_evidence INTEGER, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE TABLE analytics_metric_triggers(id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT UNIQUE, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER DEFAULT 5, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER DEFAULT 168, enabled INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT NOT NULL, kind TEXT NOT NULL, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE TABLE metric_history (metric TEXT NOT NULL, day TEXT NOT NULL, value REAL, meets INTEGER, target TEXT, ts TEXT, PRIMARY KEY (metric, day));
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT DEFAULT (datetime('now')), last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER DEFAULT 45000, next_due_at TEXT, max_items INTEGER DEFAULT 5, requires_container INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, action_ref INTEGER, probe_url TEXT, transport TEXT NOT NULL, expected TEXT, observed TEXT, pass INTEGER NOT NULL, verified_at TEXT DEFAULT (datetime('now')), verifier TEXT);
CREATE INDEX idx_remediation_verifications_issue_ts ON remediation_verifications (issue_id, verified_at);
CREATE TABLE fleet_tick (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), source TEXT NOT NULL);
CREATE TABLE fleet_heartbeat (worker TEXT PRIMARY KEY, version TEXT, ts TEXT, ok INTEGER);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TABLE decision_outcomes (id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER NOT NULL, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), observed_outcome TEXT NOT NULL, matched INTEGER NOT NULL, evidence TEXT NOT NULL, actor TEXT NOT NULL);
CREATE VIEW v_decision_calibration AS SELECT d.id, d.ts, d.actor, d.action, d.predicted_outcome, COALESCE(d.outcome_matched, (SELECT o.matched FROM decision_outcomes o WHERE o.decision_id = d.id ORDER BY o.id DESC LIMIT 1)) AS matched FROM decision_log d;
CREATE TABLE doctrine_lineage (version TEXT PRIMARY KEY, adopted_at TEXT NOT NULL, source TEXT NOT NULL, file TEXT NOT NULL, parent TEXT, note TEXT);
CREATE TABLE capability_ledger (capability TEXT PRIMARY KEY, provenance TEXT NOT NULL, prerequisites TEXT, reliability TEXT, acquired_at TEXT NOT NULL, last_exercised_at TEXT, evidence TEXT NOT NULL);
CREATE TABLE belief_registry (belief_key TEXT PRIMARY KEY, claim TEXT NOT NULL, confidence REAL, evidence TEXT NOT NULL, probe_class TEXT NOT NULL, built_on TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE TABLE spof_registry (component TEXT PRIMARY KEY, critical_path TEXT, alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT, issue_id INTEGER, reviewed_at TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE blocker_redteam (id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, claim TEXT, attempt TEXT NOT NULL, verdict TEXT NOT NULL CHECK (verdict IN ('false-belief-removed', 'confirmed-with-evidence', 'workaround-built')), evidence TEXT NOT NULL, actor TEXT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE TABLE queue_sla (stuck_type TEXT PRIMARY KEY, queue TEXT NOT NULL, definition TEXT NOT NULL, cycle_min INTEGER NOT NULL, sla_min INTEGER NOT NULL, auto_fix TEXT NOT NULL, owner TEXT NOT NULL, summary_column TEXT NOT NULL);
CREATE TABLE queue_sla_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), stuck_type TEXT NOT NULL, n INTEGER NOT NULL, note TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
CREATE TABLE human_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, title TEXT, why TEXT, default_in_effect TEXT, action TEXT, url TEXT, sev TEXT, due TEXT, status TEXT, source TEXT, created_at TEXT, updated_at TEXT, resolved_at TEXT, resolution TEXT);
CREATE VIEW v_human_action_gate AS SELECT id, slug, status, source, title, CASE WHEN t LIKE '%IDENTITY-BOUND:%' THEN 'owner' WHEN t LIKE '%pull request%' THEN 'fleet' WHEN t LIKE '%token%' THEN 'owner' ELSE 'fleet' END AS gate FROM (SELECT *, ' ' || COALESCE(title, '') || ' ' || COALESCE(why, '') || ' ' || COALESCE(action, '') || ' ' || COALESCE(default_in_effect, '') || ' ' AS t FROM human_actions);
CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo TEXT, path TEXT, goal TEXT, status TEXT, step TEXT, attempts INTEGER, model TEXT, ctx TEXT, branch TEXT, pr_url TEXT, last_error TEXT, lease_until TEXT, created_at TEXT, updated_at TEXT, merged_by TEXT, merged_sha TEXT, merged_at TEXT, merge_state TEXT, merge_note TEXT, green_since TEXT, nochecks_sha TEXT, nochecks_since TEXT, pr_opened_by TEXT, pr_opened_at TEXT, version_to TEXT, deployed_at TEXT, revert_cid INTEGER, merge_checked_at TEXT);
CREATE TABLE work_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT, intent TEXT, holder TEXT, issue_id INTEGER, pr INTEGER, claimed_at TEXT, expires_at TEXT, released_at TEXT, outcome TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE INDEX idx_coe_kind_ts ON cloud_ops_events (kind, ts);
CREATE INDEX idx_coe_job_ts ON cloud_ops_events (job, ts);
CREATE TABLE ops_ai_log (id TEXT PRIMARY KEY, ts TEXT, model TEXT, strategy TEXT, complexity TEXT, domain TEXT, prompt TEXT, response TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, cost_usd REAL, latency_ms INTEGER, tool_calls TEXT, source TEXT, ua TEXT, streamed INTEGER, ok INTEGER, upstream_model TEXT, job_id TEXT);
CREATE TABLE owner_prompts (id TEXT PRIMARY KEY, ts TEXT, mode TEXT, prompt TEXT, status TEXT, response TEXT, model TEXT, intent_id TEXT, error TEXT, issue_id INTEGER, visitor TEXT, retries INTEGER);
CREATE TABLE session_records (session_id TEXT PRIMARY KEY, wbs_code TEXT, agent_name TEXT, summary TEXT, decisions_made TEXT, files_changed TEXT, commits TEXT, infrastructure_changes TEXT, handoff_notes TEXT, execution_ratio REAL, total_tasks INTEGER, completed_tasks INTEGER, started_at TEXT, completed_at TEXT, created_at TEXT);
CREATE TABLE service_registry (service TEXT PRIMARY KEY, kind TEXT, version TEXT, base_url TEXT, purpose TEXT, capabilities TEXT, routes TEXT, tools TEXT, models TEXT, deps TEXT, updated_at TEXT, state TEXT);
CREATE TABLE worker_live_audit (worker TEXT PRIMARY KEY, http INTEGER, live_version TEXT, registry_before TEXT, match INTEGER, note TEXT, probed_at TEXT);
CREATE TABLE ai_calibration_results (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, ts INTEGER, probe TEXT, target TEXT, status TEXT, latency_ms INTEGER, detail TEXT);
CREATE TABLE fleet_deploys (id INTEGER PRIMARY KEY AUTOINCREMENT, worker TEXT, actor TEXT, from_sha TEXT, to_sha TEXT, source_path TEXT, ok INTEGER, note TEXT, ts TEXT, session_id TEXT);
CREATE TABLE migration_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT NOT NULL, sha256 TEXT NOT NULL, commit_sha TEXT, db TEXT, status TEXT NOT NULL, statements INTEGER, error TEXT, applied_by TEXT, applied_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE research_queue (id TEXT PRIMARY KEY, status TEXT, stage TEXT, claimed_at TEXT, error TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE research_review_seen (id TEXT PRIMARY KEY, first_seen TEXT);
CREATE TABLE research_hold_seen (id TEXT PRIMARY KEY, first_seen TEXT);
CREATE TABLE intents (id TEXT PRIMARY KEY, status TEXT, created_at TEXT);
CREATE TABLE outreach_queue (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT, error TEXT);
CREATE TABLE zenodo_exit_ledger (id INTEGER PRIMARY KEY, status TEXT);
CREATE TABLE continuity_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, tables_json TEXT, rows_total INTEGER, bytes INTEGER, sha256 TEXT, r2_prefix TEXT, artifact TEXT, time_travel_bookmark TEXT, integrity REAL, ok INTEGER, note TEXT);
CREATE TABLE objectives (id INTEGER PRIMARY KEY AUTOINCREMENT, objective_key TEXT, statement TEXT, source TEXT, ratified_by TEXT, ratified_on TEXT, version INTEGER, status TEXT);
CREATE TABLE goals (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_key TEXT, statement TEXT, goal_type TEXT, parent_objective TEXT, alignment TEXT, source TEXT, score REAL, priority INTEGER, status TEXT, dod TEXT, owner TEXT, adopted_at TEXT, completed_at TEXT, retired_at TEXT, created_at TEXT, updated_at TEXT, program_code TEXT);
CREATE TABLE issue_age_bumps (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, from_priority TEXT, to_priority TEXT, age_h INTEGER, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE VIEW v_issue_queue AS SELECT ROW_NUMBER() OVER (ORDER BY q.prank, q.id) AS pos, q.* FROM (SELECT a.id, CASE a.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END AS prank, a.priority, a.title, a.category, a.source, t.owner, t.triage_state, CASE WHEN COALESCE(a.description, '') LIKE '%code-task:%' THEN 1 ELSE 0 END AS has_code_task, CASE WHEN EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = a.id AND c.status = 'active') THEN 1 ELSE 0 END AS has_contract, a.linked_session, a.created_at, a.updated_at FROM agent_issues a LEFT JOIN issue_triage t ON t.issue_id = a.id WHERE a.status = 'open') q;
CREATE VIEW v_blocker_claims AS
SELECT 'issue:' || a.id AS target, a.title AS text, a.created_at AS created_ms FROM agent_issues a
WHERE a.status = 'open' AND a.created_at < (CAST(strftime('%s', 'now') AS INTEGER) - 3600) * 1000
  AND (lower(a.title || ' ' || COALESCE(a.description, '')) LIKE '%owner only%' OR lower(a.title || ' ' || COALESCE(a.description, '')) LIKE '%owner-only%'
    OR lower(a.title || ' ' || COALESCE(a.description, '')) LIKE '%needs a token%' OR lower(a.title || ' ' || COALESCE(a.description, '')) LIKE '%no token%'
    OR lower(a.title || ' ' || COALESCE(a.description, '')) LIKE '%needs the owner%' OR lower(a.title || ' ' || COALESCE(a.description, '')) LIKE '%cannot be done%'
    OR lower(a.title || ' ' || COALESCE(a.description, '')) LIKE '%blocked%' OR lower(COALESCE(a.description, '')) LIKE '%session-task:%')
  AND NOT EXISTS (SELECT 1 FROM blocker_redteam r WHERE r.target = 'issue:' || a.id AND r.ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours'))
UNION ALL
SELECT 'card:' || h.id, h.title, CAST(strftime('%s', h.created_at) AS INTEGER) * 1000 FROM human_actions h
WHERE h.status = 'open' AND datetime(h.created_at) < datetime('now', '-60 minutes')
  AND NOT EXISTS (SELECT 1 FROM blocker_redteam r WHERE r.target = 'card:' || h.id AND r.ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours'));
CREATE VIEW v_stuck_summary AS
SELECT
  (SELECT COUNT(*) FROM research_queue q JOIN research_review_seen s ON s.id = q.id
     WHERE q.status = 'review' AND s.first_seen < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-60 minutes')) AS research_review_error,
  (CASE WHEN (SELECT COUNT(*) FROM research_queue WHERE status IN ('queued', 'researching')) > 0
     AND NOT EXISTS (SELECT 1 FROM cloud_ops_events WHERE job = 'qnfo-research-exec' AND kind = 'done' AND status = 'ok'
       AND ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-60 minutes')) THEN 1 ELSE 0 END) AS research_head_stalled,
  (SELECT COUNT(*) FROM research_queue WHERE status = 'queued' AND datetime(created_at) < datetime('now', '-180 minutes')) AS research_queued_180m,
  (SELECT COUNT(*) FROM intents WHERE status = 'pending' AND datetime(created_at) < datetime('now', '-60 minutes')) AS intents_pending,
  (SELECT COUNT(*) FROM outreach_queue WHERE status IN ('needs-email', 'needs-contact')
     AND datetime(created_at) < datetime('now', '-180 minutes')) AS outreach_waiting,
  (SELECT COUNT(*) FROM code_tasks WHERE status NOT IN ('merged', 'closed', 'publish_failed', 'needs_human', 'failed', 'reverted')
     AND datetime(updated_at) < datetime('now', '-180 minutes')) AS code_tasks_stalled,
  (SELECT COUNT(*) FROM agent_issues a WHERE a.status = 'open' AND NOT EXISTS (SELECT 1 FROM remediation_verifications v
     WHERE v.issue_id = a.id AND v.verified_at > datetime('now', '-60 minutes'))) AS issues_unprobed_60m,
  (SELECT COUNT(*) FROM agent_issues a WHERE a.status = 'open' AND a.created_at < (CAST(strftime('%s', 'now') AS INTEGER) - 10800) * 1000
     AND COALESCE(a.description, '') NOT LIKE '%code-task:%'
     AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = a.id AND c.status = 'active' AND c.verify_probe NOT LIKE 'needs%')
     AND NOT EXISTS (SELECT 1 FROM work_claims w WHERE w.issue_id = a.id AND w.released_at IS NULL
       AND w.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))) AS issues_without_doer_3h,
  (CASE WHEN NOT EXISTS (SELECT 1 FROM cloud_ops_events WHERE kind = 'zenodo-exit' AND ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-180 minutes'))
     THEN (SELECT COUNT(*) FROM zenodo_exit_ledger WHERE status = 'pending') ELSE 0 END) AS zenodo_exit_pending_stalled,
  (SELECT COUNT(*) FROM research_queue q JOIN research_hold_seen h ON h.id = q.id
     WHERE q.status = 'held' AND h.first_seen < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-360 minutes')) AS research_held_over_sla;
CREATE VIEW v_trust_ledger AS
SELECT surface_class, ok, fail,
  ROUND((ok + 5.0) / (ok + fail + 10.0), 3) AS trust,
  CASE WHEN (ok + 5.0) / (ok + fail + 10.0) < 0.3 THEN 'observed'
       WHEN (ok + 5.0) / (ok + fail + 10.0) < 0.5 THEN 'assisted'
       WHEN (ok + 5.0) / (ok + fail + 10.0) < 0.6 THEN 'delegated'
       WHEN (ok + 5.0) / (ok + fail + 10.0) < 0.7 THEN 'autonomous'
       WHEN (ok + 5.0) / (ok + fail + 10.0) < 0.8 THEN 'self-directed'
       WHEN (ok + 5.0) / (ok + fail + 10.0) < 0.9 THEN 'self-modifying'
       ELSE 'self-extending' END AS ladder,
  evidence
FROM (
  SELECT * FROM (
    SELECT 'migration:apply' AS surface_class, COALESCE(SUM(status = 'ok'), 0) AS ok, COALESCE(SUM(status <> 'ok'), 0) AS fail, 'migration_runs, 30 days' AS evidence
      FROM migration_runs WHERE applied_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days')
    UNION ALL
    SELECT 'code-loop:merge', COALESCE(SUM(status = 'merged'), 0), COALESCE(SUM(status IN ('reverted', 'failed', 'publish_failed')), 0), 'code_tasks, 30 days'
      FROM code_tasks WHERE updated_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days')
    UNION ALL
    SELECT 'research:publish', COALESCE(SUM(status = 'published'), 0), COALESCE(SUM(status = 'wontfix'), 0), 'research_queue rows created in 30 days'
      FROM research_queue WHERE created_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days')
  )
  UNION ALL
  SELECT * FROM (
    SELECT 'deploy:fallback', COALESCE(SUM(status = 'ok'), 0), COALESCE(SUM(status <> 'ok'), 0), 'cloud_ops_events deploy-fallback'
      FROM cloud_ops_events WHERE kind = 'deploy-fallback'
    UNION ALL
    SELECT 'claim:reap', COALESCE(SUM(status = 'ok'), 0), COALESCE(SUM(status <> 'ok'), 0), 'cloud_ops_events claim-reaper'
      FROM cloud_ops_events WHERE kind = 'claim-reaper'
    UNION ALL
    SELECT 'continuity:snapshot', COALESCE(SUM(ok = 1), 0), COALESCE(SUM(ok = 0), 0), 'continuity_snapshots'
      FROM continuity_snapshots
  )
);
-- two agent_issues triggers that matter for the paths under test
CREATE TRIGGER issue_lifecycle_au AFTER UPDATE OF status ON agent_issues WHEN COALESCE(OLD.status, '') <> COALESCE(NEW.status, '')
BEGIN INSERT INTO issue_lifecycle (issue_id, event, from_status, to_status, has_evidence) VALUES (NEW.id, CASE WHEN NEW.status = 'open' THEN 'reopened' ELSE 'dispositioned' END, OLD.status, NEW.status, 1); END;
CREATE TRIGGER issue_close_evidence_required BEFORE UPDATE OF status ON agent_issues WHEN NEW.status IN ('closed','resolved','wontfix') AND OLD.status NOT IN ('closed','resolved','wontfix') AND NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND t.close_evidence IS NOT NULL AND TRIM(t.close_evidence) <> '') BEGIN SELECT RAISE(ABORT,'close-without-evidence'); END;
CREATE TABLE ask_events (id TEXT PRIMARY KEY, ts TEXT, qhash TEXT, query TEXT, answer TEXT);
CREATE TABLE chatbox_conversations (id TEXT PRIMARY KEY, thread_id TEXT, source TEXT, worker TEXT, model TEXT, messages_json TEXT, prompt TEXT, response TEXT, ts TEXT, ua TEXT);
CREATE TABLE task_dod_register (id INTEGER PRIMARY KEY AUTOINCREMENT, source_table TEXT, source_row_id TEXT, wbs_code TEXT, title TEXT, owner TEXT, gtd_context TEXT, epic_id TEXT, sprint_id TEXT, dod TEXT, status TEXT, evidence_pointer TEXT, due TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE worker_usage_daily (day TEXT NOT NULL, script TEXT NOT NULL, requests_24h INTEGER, errors_24h INTEGER, requests_7d INTEGER, errors_7d INTEGER, source TEXT, ts TEXT, PRIMARY KEY (day, script));
CREATE UNIQUE INDEX idx_agent_issues_open_title_ci ON agent_issues(lower(trim(title))) WHERE status = 'open';
`;
const SEED = String.raw`
INSERT INTO metric_registry (metric,layer,kind,source_of_truth,refresh_cadence,state,refresh_class,last_value) VALUES
 ('tick_slot_coverage_24h','operational','target','x','1h','MEASURED','computed',NULL),('owner_dispatched_items_7d','operational','target','x','1h','MEASURED','computed',NULL),
 ('unverified_blocker_claims','operational','target','x','10m','MEASURED','computed','35'),('mttr_h_7d','operational','target','x','1h','MEASURED','computed','455'),
 ('issues_unprobed_60m','operational','target','x','10m','MEASURED','computed','20'),('failure_modes_recurring','operational','target','x','10m','MEASURED','computed','3'),
 ('continuity_snapshot_age_h','operational','target','x','1h','MEASURED','computed','5.9'),('code_goal_success_rate_30d','operational','target','x','1h','MEASURED','computed','0.517'),
 ('stuck_items_over_sla','operational','target','x','10m','MEASURED','computed','40'),('never_measured','operational','target','x','1h','UNMEASURED','computed',NULL);
INSERT INTO metric_history (metric,day,value) VALUES ('unverified_blocker_claims','2026-10-11',35),('unverified_blocker_claims','2026-10-12',35),('issues_unprobed_60m','2026-10-11',24),
 ('failure_modes_recurring','2026-10-11',3),('continuity_snapshot_age_h','2026-10-09',13.2),('mttr_h_7d','2026-10-09',445.5);
INSERT INTO ops_ai_log (id,ts,response,source) VALUES ('a1',strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 minutes'),'Here is the answer. Would you like me to deploy it?','public'),
 ('a2',strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 minutes'),'Done: deployed 1.2.3 and verified.','public'),
 ('a3',strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 minutes'),'The push was refused by the permission check; shall I stop? IDENTITY-BOUND: owner card 5.','public'),
 ('a4',strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),'Two options: A or B. Alternatively C.','public'),
 ('a5',strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),'Either way, two options remain.','public'),
 ('a6',strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'),'There are two options here.','public');
INSERT INTO ask_events (id,ts,query,answer) VALUES ('k1',strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes'),'q','The paper derives it. You could also read section 2.'),('k2',strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes'),'q',NULL);
INSERT INTO chatbox_conversations (id,source,worker,response,ts) VALUES ('c1','chatbox','qnfo-ai','Which direction should this take?',strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes')),('c2','other','qnfo-ai','Alternatively the lemma holds.',strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes'));
INSERT INTO task_dod_register (id,title,owner,status,evidence_pointer,due,updated_at) VALUES (328,'a','agent','open','ev328','2026-10-03','2026-09-26 09:19:36'),(331,'b','agent','open','ev331','2026-10-03','x'),(341,'c','agent','open',NULL,'2026-10-03','x'),(345,'d','agent','open','ev345','2026-10-03','x'),(333,'e','agent','open','ev333','2026-10-04','x');
INSERT INTO owner_prompts (id,ts,prompt,response) VALUES ('o1',strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes'),'Why do I keep having to ask for this every time','ok, done');
INSERT INTO session_records (session_id,summary,handoff_notes,created_at) VALUES ('s1','did x','Let me know if you want the rest', datetime('now','-10 minutes'));
INSERT INTO objectives (objective_key,statement,status,ratified_on) VALUES ('o-core','keep it running','ACTIVE','2026-10-01');
INSERT INTO goals (goal_key,statement,goal_type,status) VALUES ('g1','ship','instrumental','adopted'),('g2','old','instrumental','superseded');
INSERT INTO agent_issues (title,description,source,category,priority,status,created_at,updated_at) VALUES
 ('OWNER-TASK-1 a','d','owner-chat','autonomy','high','open',strftime('%s','now','-2 days')*1000,strftime('%s','now')*1000),
 ('B','code-task: repo=qnfo-workers path=x/worker.js','chat-1','autonomy','medium','open',strftime('%s','now','-1 days')*1000,strftime('%s','now')*1000),
 ('C','x','qnfo-fleet-control','reach','critical','open',strftime('%s','now','-5 minutes')*1000,strftime('%s','now')*1000),
 ('D closed','x','loop','core','low','closed',strftime('%s','now','-9 days')*1000,strftime('%s','now','-3 days')*1000),
 ('E no triage','x','loop','core','low','open',strftime('%s','now','-4 hours')*1000,strftime('%s','now')*1000),
 ('METRIC-TRIGGER-3061-UNVERIFIED-BLOCKER-CLAIMS: Red team','a blocked thing','qnfo-fleet-control','autonomy','high','open',strftime('%s','now','-4 hours')*1000,strftime('%s','now')*1000),
 ('F blocked claim','this is blocked on a token','loop','core','low','open',strftime('%s','now','-4 hours')*1000,strftime('%s','now')*1000),
 ('G held','x','loop','core','low','open',strftime('%s','now','-4 hours')*1000,strftime('%s','now')*1000);
INSERT INTO agent_issues (title,description,source,category,priority,status,created_at,updated_at) VALUES
 ('METRIC-TRIGGER-9-TWIN: refiled metric issue','old copy','qnfo-fleet-control','core','high','closed',strftime('%s','now','-9 days')*1000,strftime('%s','now','-3 days')*1000),
 ('metric-trigger-9-twin: Refiled metric issue ','open copy','qnfo-fleet-control','core','high','open',strftime('%s','now','-2 days')*1000,strftime('%s','now','-2 days')*1000);
INSERT INTO issue_triage (issue_id,rc,owner,sla_due_at,close_evidence) VALUES (9,'r','qnfo-ops','x','TRIGGER-RECOVERY-1: recovered'),(10,'r','qnfo-ops','x',NULL);
INSERT INTO issue_triage (issue_id,rc,owner,sla_due_at,close_evidence) VALUES (1,'r','qnfo-ops','x',NULL),(2,'r','qnfo-ops','x',NULL),(3,'r','qnfo-ops','x',NULL),(4,'r','qnfo-ops','x','evidence of close');
INSERT INTO migration_runs (file,sha256,status) VALUES ('a','b','ok');
INSERT INTO code_tasks (id,goal,status,created_at,updated_at,merged_at) VALUES ('ct1','[issue #2] B','merged',strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes'),strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 minutes'),strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 minutes'));
INSERT INTO work_claims (path,holder,issue_id,claimed_at,expires_at) VALUES ('issue:1','session_x',1,strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 hours'),strftime('%Y-%m-%dT%H:%M:%SZ','now','+1 hours'));
INSERT INTO fleet_deploys (worker,ok,ts) VALUES ('qnfo-ops',1,strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 days')),('qnfo-ops',0,strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 days'));
INSERT INTO fleet_tick (source) VALUES ('cron:qnfo-code-orchestrator');
INSERT INTO service_registry (service,kind,state,capabilities) VALUES ('qnfo-pdf','worker','live','["pdf-render"]'),('qnfo-ai','worker','live','["chat","ensemble"]'),('personal-api','worker','live','["chat"]'),('idea-hub','worker','live','[]'),('qnfo-subscribers','worker','live','subscribers;welcome-email'),('qnfo-social','worker','live',NULL),('old','worker','retired','["x"]');
INSERT INTO worker_live_audit (worker,http,probed_at) VALUES ('qnfo-pdf',200,datetime('now','-2 hours')),('qnfo-ai',200,datetime('now','-2 hours')),('personal-api',500,datetime('now','-2 hours')),('idea-hub',200,datetime('now','-2 hours')),('qnfo-subscribers',200,datetime('now','-2 hours')),('qnfo-social',200,datetime('now','-2 hours'));
INSERT INTO ai_calibration_results (ts,probe,target,status) VALUES (strftime('%s','now')*1000-3600000,'model','glm-5.3','pass'),(strftime('%s','now')*1000-3600000,'model','deepseek-v4-flash','fail'),(strftime('%s','now')*1000-3600000,'routing','ensemble/math','pass');
INSERT INTO remediation_contracts (class,issue_id,precondition,action,verify_probe,verify_transport,escalate_to,expected_cadence_h,status,next_due_at,last_attempt_at,max_attempts) VALUES
 ('issue-1',1,'p','a','SELECT 1','d1-query','x',24,'active',datetime('now','+20 hours'),datetime('now','-4 hours'),3),
 ('issue-8',8,'p','a','SELECT 1','d1-query','x',1,'holding',datetime('now','+20 hours'),datetime('now','-4 hours'),3),
 ('issue-4',4,'p','a','SELECT 1','d1-query','x',1,'active',datetime('now','+20 minutes'),datetime('now','-40 minutes'),3),
 ('issue-3',3,'p','a','SELECT 1','d1-query','x',1,'active',datetime('now','+20 minutes'),datetime('now','-40 minutes'),3);
INSERT INTO remediation_contracts (class,issue_id,precondition,action,verify_probe,verify_transport,escalate_to,expected_cadence_h,status,next_due_at,last_attempt_at,max_attempts,last_verdict) VALUES
 ('issue-9',9,'p','a','SELECT 1','d1-query','x',1,'holding',datetime('now','+20 minutes'),datetime('now','-40 minutes'),3,'fail'),
 ('issue-10',10,'p','a','SELECT 1','d1-query','x',1,'active',datetime('now','+20 minutes'),datetime('now','-40 minutes'),3,'fail');
INSERT INTO remediation_verifications (issue_id,class,transport,expected,observed,pass,verified_at) VALUES (9,'issue-9','d1-query','1','0',0,datetime('now','-50 hours')),(9,'issue-9','d1-query','1','0',0,datetime('now','-40 hours')),(9,'issue-9','d1-query','1','0',0,datetime('now','-4 hours')),(10,'issue-10','d1-query','1','0',0,datetime('now','-30 minutes'));
INSERT INTO remediation_verifications (issue_id,class,transport,expected,observed,pass,verified_at) VALUES (1,'issue-1','d1-query','1','0',0,datetime('now','-30 minutes')),(NULL,'fm-x','d1-query','0','0',1,datetime('now','-30 minutes')),
 (4,'issue-4','d1-query','1','0',0,datetime('now','-50 hours')),(4,'issue-4','d1-query','1','0',0,datetime('now','-40 hours')),(4,'issue-4','d1-query','1','pending: x',0,datetime('now','-30 hours')),(4,'issue-4','d1-query','1','0',0,datetime('now','-3 hours'));
INSERT INTO cloud_ops_events (id,ts,kind,job,status) VALUES ('e1',strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes'),'code-task.intake','qnfo-code-orchestrator','ok'),('e2',strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes'),'fleet-observability-digest','qnfo-observability','ok'),('e3',strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes'),'done','qnfo-research-exec','ok');
INSERT INTO decision_log (id,ts,actor,assumption,action,evidence,outcome,blast_radius,rollback_path,predicted_outcome) VALUES
 (18,'2026-10-09T09:50:38Z','s','a','a','e','o','b','r','free text'),(22,'2026-10-09T10:17:26Z','s','a','a','e','o','b','r','free text'),
 (31,'2026-10-11T08:20:09Z','s','a','a','e','o','b','r','free text'),(34,'2026-10-11T09:14:04Z','s','a','a','e','o','b','r','free text'),
 (36,'2026-10-11T09:31:17Z','s','a','a','e','o','b','r','free text'),(37,'2026-10-11T09:37:34Z','s','a','a','e','o','b','r','free text'),
 (38,'2026-10-11T15:01:06Z','s','a','a','e','o','b','r','free text');
INSERT INTO queue_sla (stuck_type,queue,definition,cycle_min,sla_min,auto_fix,owner,summary_column) VALUES ('intent-untriaged','intents','d',10,60,'f','o','intents_pending');
`;
const FILES = ["2026-10-12-20-kernel-registries.sql", "2026-10-12-21-tick-driver-roster.sql", "2026-10-12-22-calibration-scorer.sql", "2026-10-12-23-sla-mechanisms.sql", "2026-10-12-24-register-dispositions.sql", "2026-10-12-25-recurrence-guard-twin.sql"];
const db = new DatabaseSync(":memory:");
db.exec(SCHEMA);
db.exec(SEED);
const all = (sql) => db.prepare(sql).all();
const one = (sql) => db.prepare(sql).get();
const metric = (m) => { const r = one("SELECT last_value v, last_refreshed r FROM metric_registry WHERE metric = '" + m + "'"); return r ? r.v : undefined; };
// CI-TEST-CLOCKS-1 (2026-10-20): the calibration migration seeds decision 38's prediction as due 2026-10-25T15:01:06Z, and the scorer reads the real
// clock when the migration's last statement ticks it. From that instant the suite's "a prediction that is not due is left unscored" failed on main and on
// every full-suite pull request. The fixture applies the migration with that one due date moved to 30 days after the run, so decision 38 is not due on any
// day the suite runs; the migration file itself is unchanged, and the assertion that the literal is still there keeps the substitution from going silent.
const SEEDED_NOT_DUE = "2026-10-25T15:01:06Z";
const NOT_DUE = new Date(Date.now() + 30 * 864e5).toISOString().replace(/\.\d{3}Z$/, "Z");
for (const f of FILES) {
  let sql = readFileSync(new URL("./" + f, import.meta.url), "utf8");
  if (f === "2026-10-12-22-calibration-scorer.sql") {
    ok(sql.split(SEEDED_NOT_DUE).length === 2, "the calibration migration seeds decision 38's prediction with the one due date this fixture moves out of reach");
    sql = sql.replace(SEEDED_NOT_DUE, NOT_DUE);
  }
  let err = null;
  try { db.exec(sql); db.exec(sql); } catch (e) { err = String(e && e.message || e); }
  ok(err === null, f + " applies, and applies again unchanged", err);
  ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql), f + " carries the runner header");
  ok(!/\b(?:LIKE|GLOB)\s+'[^']{51,}'/.test(sql), f + " has no LIKE or GLOB literal over 50 bytes");
}

// 1. KERNEL-REGISTRIES-1: the false-stop scan, the stored trust ledger, the registries and the two orphaned metrics.
const hits = all("SELECT source, reply_id, pattern_key FROM false_stop_hits ORDER BY 1, 2, 3").map((r) => r.source + "/" + r.reply_id + "/" + r.pattern_key);
ok(hits.includes("ops_ai_log/a1/conditional-offer") && hits.includes("ops_ai_log/a1/report-as-question") && hits.includes("session_records/s1/conditional-offer"), "a conditional offer and a report ending in a question are recorded", hits);
ok(!hits.some((h) => h.includes("/a2/")), "a plain report of done work is not a hit", hits);
ok(!hits.some((h) => h.includes("/a3/")), "a reply that states a refusal with its reason is a disposition, not a false stop (readings n and p)", hits);
ok(hits.includes("owner_prompts.prompt/o1/friction"), "a friction phrase in the owner's message is recorded", hits);
ok(hits.includes("ask_events/k1/menu") && hits.includes("chatbox_conversations/c1/missing-direction") && hits.includes("chatbox_conversations/c1/report-as-question") && !hits.some((h) => h.includes("/c2/")), "qnfo-ai-search answers and chat-client replies are scanned; pipeline calls that are not chat replies are not", hits);
ok(new Set(hits).size === hits.length, "one row per (source, reply, signature) however often the scan runs", hits);
ok(metric("false_stops_7d") === String(hits.length), "false_stops_7d counts the hits", metric("false_stops_7d"));
const props = all("SELECT source, status FROM doctrine_proposals ORDER BY 1").map((r) => r.source + ":" + r.status);
ok(props.includes("false_stop:menu:ops_ai_log:proposed") && props.includes("friction:owner_prompts:o1:proposed") && props.length === 2, "three hits of one signature from one source, and a friction signal, each become one proposal", props);
ok(one("SELECT COUNT(*) n FROM false_stop_register").n === 9, "the register holds the nine signatures");
const tl = all("SELECT surface || ':' || action_class k, ok, fail, trust_score, ladder_position FROM trust_ledger");
ok(tl.length === 10 && tl.every((r) => r.trust_score >= 0 && r.trust_score <= 1 && r.ladder_position), "trust_ledger holds one row per (surface, action_class) with a score and a ladder position", tl);
const canon = tl.find((r) => r.k === "deploy:canonical");
ok(canon && canon.ok === 1 && canon.fail === 1 && canon.trust_score === 0.5 && canon.ladder_position === "delegated", "trust is (ok + 5) / (ok + fail + 10) with the kernel ladder", canon);
ok(metric("trust_ledger_min") === "0.5", "trust_ledger_min reads the baseline while no class has 10 outcomes", metric("trust_ledger_min"));
db.exec("UPDATE trust_ledger SET ladder_position = 'observed' WHERE surface = 'deploy' AND action_class = 'canonical'");
db.exec("INSERT INTO fleet_tick (source) VALUES ('migration:test')");
const tr = all("SELECT from_ladder, to_ladder FROM trust_transitions WHERE surface = 'deploy' AND action_class = 'canonical'");
ok(tr.length === 1 && tr[0].from_ladder === "observed" && tr[0].to_ladder === "delegated", "a ladder change is recorded once in trust_transitions", tr);
ok(all("SELECT surface FROM trust_transitions WHERE from_ladder = to_ladder").length === 0, "an unchanged ladder position records nothing");
ok(metric("tick_slot_coverage_24h") !== null && metric("owner_dispatched_items_7d") === "0", "the two metrics that lost their refresher are refreshed again (issue 2192)", [metric("tick_slot_coverage_24h"), metric("owner_dispatched_items_7d")]);
const os = all("SELECT objective_key, class, status FROM objective_space ORDER BY 1").map((r) => r.objective_key + "/" + r.class + "/" + r.status);
ok(os.join() === "goal:g1/derived/graduated,objective:o-core/standing/graduated", "objective_space holds ratified objectives as standing and adopted goals as derived", os);
ok(one("SELECT COUNT(*) n FROM vocabulary_register WHERE propagated_to_fleet = 1").n === 21, "the kernel's 21 defined terms are in the vocabulary register");
const ma = Object.fromEntries(all("SELECT status, COUNT(*) n FROM metric_authorship GROUP BY 1").map((r) => [r.status, r.n]));
ok(ma.graduated >= 7 && ma.probation >= 1 && one("SELECT status FROM metric_authorship WHERE metric = 'never_measured'").status === "probation", "a metric with a value is graduated, one without stays on probation", ma);
ok(one("SELECT COUNT(*) n FROM metric_authorship WHERE metric = 'driver_drain_24h'").n === 1, "a metric registered later is recorded at birth by the trigger");
const dir = all("SELECT direction, confidence, acted_on FROM inferred_direction");
ok(dir.length === 1 && dir[0].direction === "category:autonomy" && dir[0].confidence === 1 && dir[0].acted_on === 1, "the owner's filings of 7 days become one inferred direction, acted on once the driver view exists", dir);

// 2. TICK-DRIVER-ROSTER-1.
const steps = all("SELECT step, ok, evidence FROM tick_runs WHERE tick_id = (SELECT MAX(tick_id) FROM tick_runs) ORDER BY step");
ok(steps.map((s) => s.step).join() === "advance,compare,dispatch,emit,log,probe,pull,reconcile,refresh,report,verify", "the eleven section 1 steps are written for the hour slot", steps.map((s) => s.step));
ok(steps.every((s) => s.ok === 1 && s.evidence), "each step is ok from its ledger evidence", steps.filter((s) => s.ok !== 1));
ok(metric("tick_sequence_completion_24h") === "1.0", "tick_sequence_completion_24h = complete slots / slots due", metric("tick_sequence_completion_24h"));
db.exec("DELETE FROM cloud_ops_events WHERE kind IN ('fleet-observability-digest', 'changelog-tick')");
db.exec("INSERT INTO fleet_tick (source) VALUES ('migration:test')");
ok(one("SELECT ok FROM tick_runs WHERE step = 'report'").ok === 0 && metric("tick_sequence_completion_24h") === "0.0", "a step with no evidence is written ok 0 and the slot is not complete", metric("tick_sequence_completion_24h"));
const q = all("SELECT pos, id, priority, aged, score, impact, probability, capability_gain, reach_gain, remediation_cost, trust, direction FROM v_issue_queue_v2 ORDER BY pos");
ok(q[0].id === 3 && q[0].priority === "critical", "critical leads the queue whatever its score (PRIORITY-QUEUE-1)", q[0]);
ok(q.slice(1).every((r, i, a) => i === 0 || a[i - 1].aged > r.aged || (a[i - 1].aged === r.aged && a[i - 1].score >= r.score)), "after critical: items older than one tick first, then by the doctrine score", q.map((r) => r.id + ":" + r.aged + ":" + r.score));
const q2 = q.find((r) => r.id === 2);
ok(q2 && Math.abs(q2.score - 3 * q2.probability * (4 + 1) * (1 / 2) * q2.trust * (1 + 1)) < 0.01 && q2.remediation_cost === 2, "score = impact x probability x (capability + reach) x (1 / cost) x trust x (1 + direction)", q2);
db.exec("INSERT INTO issue_priority_scores (issue_id, impact, scored_by) VALUES (5, 5, 'test')");
ok(one("SELECT impact FROM v_issue_queue_v2 WHERE id = 5").impact === 5, "an issue_priority_scores row overrides the default factor");
const pulls = all("SELECT puller, issue_id, via FROM queue_pulls ORDER BY issue_id").map((r) => r.puller + "/" + r.issue_id + "/" + r.via);
ok(pulls.join() === "session_x/1/work_claim,qnfo-code-orchestrator/2/code_task", "the last day's code tasks and issue claims are backfilled as pulls", pulls);
db.exec("INSERT INTO code_tasks (id, goal, status, created_at, updated_at) VALUES ('ct2', '[issue #7] fix', 'queued', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");
db.exec("INSERT INTO code_tasks (id, goal, status, created_at, updated_at) VALUES ('ct3', 'no issue here', 'queued', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");
db.exec("INSERT INTO work_claims (path, holder, issue_id, claimed_at, expires_at) VALUES ('issue:5', 'session_y', 5, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 hours')), ('file:x', 'session_y', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 hours'))");
ok(one("SELECT COUNT(*) n FROM queue_pulls").n === 4 && one("SELECT COUNT(*) n FROM queue_pulls WHERE issue_id = 7 AND via = 'code_task'").n === 1, "a new code task for an issue and a new issue claim each record one pull; other rows record none", all("SELECT issue_id, via FROM queue_pulls"));
db.exec("INSERT INTO fleet_tick (source) VALUES ('migration:test')");
const dd = one("SELECT (SELECT COUNT(DISTINCT issue_id) FROM queue_pulls) p, (SELECT COUNT(*) FROM agent_issues WHERE status = 'open' OR id IN (SELECT issue_id FROM queue_pulls)) e");
ok(dd.p === 4 && Number(metric("driver_drain_24h")) === Math.round(1000 * dd.p / dd.e) / 1000, "driver_drain_24h = distinct issues pulled / issues eligible", [metric("driver_drain_24h"), dd]);
// METRIC-TRIGGER-4989 / issue 2459: a successful empty intake poll is pull evidence even when no issue was actually claimed.
db.exec("CREATE TEMP TABLE saved_tick_queue_pulls AS SELECT * FROM queue_pulls; DELETE FROM queue_pulls; UPDATE cloud_ops_events SET kind = 'code-task.intake-idle' WHERE id = 'e1'; INSERT INTO fleet_tick (source) VALUES ('migration:test')");
const idlePull = one("SELECT ok, evidence FROM tick_runs WHERE step = 'pull'");
ok(idlePull.ok === 1 && idlePull.evidence === "1 code-task.intake events, 0 queue_pulls rows in 65 min", "the real tick trigger accepts idle-intake evidence with no queue pulls (issue 2459)", idlePull);
db.exec("INSERT INTO queue_pulls SELECT * FROM saved_tick_queue_pulls; DROP TABLE saved_tick_queue_pulls; UPDATE cloud_ops_events SET kind = 'code-task.intake' WHERE id = 'e1'");
const roster = all("SELECT capability, executor, kind, healthy FROM v_executor_roster");
ok(roster.some((r) => r.capability === "chat" && r.executor === "personal-api" && r.healthy === 0) && roster.some((r) => r.capability === "chat" && r.executor === "qnfo-ai" && r.healthy === 1), "the roster has one row per (capability, executor) with health from the live probe");
ok(roster.some((r) => r.capability === "worker:qnfo-subscribers") && roster.some((r) => r.capability === "worker:qnfo-social") && !roster.some((r) => r.executor === "old"), "a live worker without a JSON capability list still has a roster row; a retired worker has none");
ok(roster.some((r) => r.kind === "model" && r.executor === "deepseek-v4-flash" && r.healthy === 0) && roster.some((r) => r.kind === "mechanism" && r.healthy === null), "model routes are graded by their probes; capability_ledger rows are listed with unknown health");
ok(metric("roster_members_degraded") === "2" && metric("roster_capabilities_single_executor") === "4", "roster metrics count degraded executors and single-executor capabilities", [metric("roster_members_degraded"), metric("roster_capabilities_single_executor")]);
ok(one("SELECT threshold t FROM analytics_metric_triggers WHERE metric_key = 'roster_capabilities_single_executor'").t === 4, "the single-executor trigger floor is the value measured at apply");

const fu = all("SELECT title, description d FROM agent_issues WHERE title LIKE 'BACKLOG-DRIVER-PULLER-1:%' OR title LIKE 'WATCHMAKER-TICK-LEDGER-1:%' ORDER BY title");
ok(fu.length === 2 && fu.every((r) => r.d.split("\n").filter((l) => /^code-task: repo=qnfo-workers path=\S+\/worker\.js$/.test(l)).length === 1 && r.d.split("\n").some((l) => /^code-anchor: \S/.test(l)) && r.d.split("\n").some((l) => { try { return /^code-probe: /.test(l) && JSON.parse(l.slice(12)).contains; } catch (e) { return false; } })), "the two worker follow-ups are filed once, each with code-task, code-anchor and code-probe lines of their own", fu.map((r) => r.title));
ok(fu[0].d.includes("code-anchor: SELECT id, title, description, source FROM agent_issues WHERE status='open' AND description LIKE '%code-task:%'"), "the intake anchor is the verbatim text of the orchestrator query");

// 3. CALIBRATION-SCORER-1.
const out = Object.fromEntries(all("SELECT decision_id, matched, actor, observed_outcome FROM decision_outcomes").map((r) => [r.decision_id, r]));
ok(out[18] && out[18].matched === 1 && out[22].matched === 1 && out[31].matched === 0 && out[34].matched === 0 && out[36].matched === 0, "due predictions are scored against the snapshot of their due day", Object.values(out).map((r) => r.decision_id + ":" + r.matched));
ok(Object.values(out).every((r) => r.actor === "calibration-scorer") && /issues_unprobed_60m <= 10.*observed 24.*miss/.test(out[34].observed_outcome) && /failure_modes_recurring <= 2/.test(out[34].observed_outcome), "a decision with two predictions gets one outcome row that matches only if both do", out[34]);
ok(!out[38] && one("SELECT scored_at s FROM decision_predictions WHERE decision_id = 38").s === null, "a prediction that is not due is left unscored");
ok(one("SELECT COUNT(*) n FROM decision_outcomes").n === one("SELECT COUNT(DISTINCT decision_id) n FROM decision_outcomes").n, "a decision is scored once however often the tick runs");
let appendOnly = false;
try { db.exec("UPDATE decision_log SET outcome_matched = 1 WHERE id = 18"); } catch (e) { appendOnly = true; }
ok(appendOnly, "decision_log stays append-only; the verdict lives in decision_outcomes");
const ins = (p) => Number(db.prepare("INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, predicted_outcome) VALUES ('t', 'a', 'a', 'e', 'o', 'b', 'r', ?)").run(p).lastInsertRowid);
const d1 = ins("mttr_h_7d >= 24.5 within 36 hours; and more text"), d2 = ins("issue 4 closed within 3 days"), d3 = ins("free text that settles within reason"), d4 = ins(null), d5 = ins("not_a_metric < 5 within 2 h");
const pp = (id) => one("SELECT kind, subject, op, value, due_at FROM decision_predictions WHERE decision_id = " + id);
ok(pp(d1) && pp(d1).subject === "mttr_h_7d" && pp(d1).op === ">=" && pp(d1).value === 24.5 && pp(d1).due_at > one("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+35 hours') t").t, "a prediction in the parsed form becomes a row with its metric, bound and deadline", pp(d1));
ok(pp(d2) && pp(d2).kind === "issue" && pp(d2).subject === "4" && pp(d2).op === "closed", "an issue prediction is parsed", pp(d2));
ok(!pp(d3) && !pp(d4) && !pp(d5), "free text, an empty prediction and an unknown metric write nothing and never fail the insert");
db.prepare("INSERT INTO queue_sla_actions (stuck_type, n, note) VALUES ('intent-untriaged', 2, '5,6')").run();
const qd = one("SELECT id, action, predicted_outcome, blast_radius FROM decision_log WHERE actor = 'queue-sla-tick' AND action LIKE '%intent-untriaged%'");
ok(qd && qd.predicted_outcome === "stuck_items_over_sla <= 40 within 1 h" && qd.blast_radius === "2 row(s) of intents" && pp(qd.id) && pp(qd.id).subject === "stuck_items_over_sla", "a queue_sla auto-fix is logged as a decision whose prediction is parsed for scoring", qd);
ok(metric("predictions_unscored_over_sla") === "0" && /calibration scorer ran/.test(one("SELECT evidence e FROM tick_runs WHERE step = 'compare'").e), "the scorer reports its queue and writes the compare step of the tick");

// 4. SLA-MECHANISMS-1.
const tri = Object.fromEntries(all("SELECT issue_id, rc, reopened_count FROM issue_triage").map((r) => [r.issue_id, r]));
ok([5, 6, 7, 8].every((i) => tri[i] && tri[i].rc === "AUTOTRIAGE-TICK-1") && one("SELECT triage_gap g FROM v_stuck_summary").g === 0, "an open issue without a triage row gets one on the tick (issue 2197)", Object.keys(tri));
const con = Object.fromEntries(all("SELECT class, status, expected_cadence_h c, (julianday(next_due_at) - julianday(last_attempt_at)) * 1440 gap FROM remediation_contracts WHERE issue_id IS NOT NULL").map((r) => [r.class, r]));
ok(Math.round(con["issue-1"].gap) === 55 && con["issue-1"].c === 1 && Math.round(con["issue-8"].gap) === 55 && con["issue-8"].status === "holding", "a contract of an open issue due a day ahead is pulled back to 55 minutes after its last attempt; a hold stays a hold", con);
ok(Math.round(con["issue-3"].gap) === 60, "a contract already due within the hour is left alone", con["issue-3"]);
ok(one("SELECT contracts_cadence_drift d FROM v_stuck_summary").d === 0, "v_stuck_summary counts cadence drift");
const g = all("SELECT issue_id, class, fails, applied FROM recurrence_guard_actions");
ok(g.length === 1 && g[0].issue_id === 4 && g[0].fails === 3 && g[0].applied === 1, "a closed issue whose contract failed max_attempts times since the closure is recorded once ('pending: x' is a deferral and is not counted)", g);
const i4 = one("SELECT status, description d FROM agent_issues WHERE id = 4");
ok(i4.status === "open" && /RECURRENCE-GUARD-SQL-1/.test(i4.d) && /Prior close_evidence: evidence of close/.test(i4.d), "the issue is reopened with the failure and its prior close evidence", i4);
ok(tri[4].reopened_count === 1 && one("SELECT close_evidence e FROM issue_triage WHERE issue_id = 4").e === null && one("SELECT COUNT(*) n FROM issue_lifecycle WHERE issue_id = 4 AND event = 'reopened'").n === 1, "its triage row is reset once and the reopen is in issue_lifecycle", tri[4]);
ok(one("SELECT COUNT(*) n FROM queue_sla_actions WHERE stuck_type = 'closure-relapse' AND note LIKE 'reopened:%'").n === 1, "the reopen is logged once as a queue_sla action");
db.exec("UPDATE ops_config SET value = 'off' WHERE key = 'queue_sla_autofix'; INSERT OR IGNORE INTO ops_config (key, value) VALUES ('queue_sla_autofix', 'off')");
db.exec("INSERT INTO agent_issues (title, description, source, status, created_at, updated_at) VALUES ('H', 'x', 'loop', 'open', 1, 1)");
db.exec("INSERT INTO fleet_tick (source) VALUES ('migration:test')");
ok(one("SELECT COUNT(*) n FROM issue_triage WHERE issue_id = (SELECT MAX(id) FROM agent_issues)").n === 0, "ops_config queue_sla_autofix = off stops the fixes");
const claims = all("SELECT target FROM v_blocker_claims").map((r) => r.target);
ok(claims.includes("issue:7") && !claims.includes("issue:6"), "the blocker metric's own trigger issue is not counted as a blocker claim; a real claim still is (issue 2195)", claims);
db.exec("UPDATE remediation_contracts SET status = 'holding' WHERE class = 'issue-1'");
db.exec("UPDATE agent_issues SET description = 'plain' WHERE id = 1; UPDATE work_claims SET released_at = 'x' WHERE issue_id = 1");
ok(one("SELECT COUNT(*) n FROM agent_issues a WHERE a.id = 1 AND a.status = 'open' AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = a.id AND c.status IN ('active', 'holding') AND c.verify_probe NOT LIKE 'needs%')").n === 0, "a holding contract counts as a doer in issues_without_doer_3h (issue 2193)");
ok(one("SELECT COUNT(*) n FROM bak_20261012_sla_views").n === 2 && one("SELECT COUNT(*) n FROM queue_sla WHERE stuck_type IN ('issue-triage-gap', 'contract-cadence-drift', 'closure-relapse', 'prediction-unscored', 'doctrine-proposal-waiting', 'tick-step-missed')").n === 6, "the replaced views are backed up and every new queue has its queue_sla row");
const k = one("SELECT * FROM v_stuck_summary_kernel");
ok(k.predictions_unscored_over_sla === 0 && k.doctrine_proposals_waiting === 0 && typeof k.tick_steps_missed_last_slot === "number", "v_stuck_summary_kernel reads the three kernel queues", k);
for (const p of all("SELECT class, verify_probe FROM remediation_contracts WHERE class IN ('fm-metric-refresher-replaced', 'fm-contract-cadence-drift', 'fm-closure-relapse-unreopened', 'fm-triage-gap')")) {
  let r = null; try { r = one(p.verify_probe); } catch (e) { r = { err: String(e.message) }; }
  ok(r && r.expected === "0" && typeof r.observed === "string", "detector " + p.class + " runs and returns expected and observed", r);
}

// 5. REGISTER-DISPOSITIONS-1.
const reg = Object.fromEntries(all("SELECT id, status, evidence_pointer e FROM task_dod_register").map((r) => [r.id, r]));
ok(reg[328].status === "cancelled" && reg[345].status === "cancelled" && reg[331].status === "done" && reg[341].status === "done" && reg[333].status === "open", "the four register rows are terminal; a row outside the change is untouched", Object.values(reg).map((r) => r.id + ":" + r.status));
ok(/^ev328 \| REGISTER-DISPOSITIONS-1 2026-10-12: superseded/.test(reg[328].e) && reg[328].e.split("REGISTER-DISPOSITIONS-1").length === 2 && /agent_issues 2075/.test(reg[345].e), "each row keeps its old evidence and gains one disposition line naming its successor", reg[328].e);
ok(one("SELECT COUNT(*) n FROM bak_20261012_register_rows WHERE status = 'open'").n === 4, "the rows are backed up as they were");
ok(metric("workers_idle_7d") === null, "workers_idle_7d reads NULL while there is no fresh usage snapshot", metric("workers_idle_7d"));
db.exec("INSERT INTO worker_usage_daily (day, script, requests_7d, ts) SELECT date('now'), service, 50, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM service_registry WHERE state = 'live' AND service <> 'idea-hub'");
db.exec("INSERT INTO worker_usage_daily (day, script, requests_7d, ts) VALUES (date('now'), 'qnfo-x1', 9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), (date('now'), 'qnfo-x2', 9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), (date('now'), 'qnfo-x3', 9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), (date('now'), 'qnfo-x4', 9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), (date('now'), 'qnfo-x5', 9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");
db.exec("UPDATE worker_usage_daily SET requests_7d = 2 WHERE script = 'qnfo-pdf'");
db.exec("INSERT INTO fleet_tick (source) VALUES ('migration:test')");
ok(metric("workers_idle_7d") === "2", "a live worker under 3 requests in 7 days, and one absent from the snapshot, are counted idle", metric("workers_idle_7d"));

// 6. RECURRENCE-GUARD-TWIN-1: a closed issue whose title is open again (agent_issues 2364, 2365).
ok(one("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'idx_agent_issues_open_title_ci'").n === 1, "the fixture carries the unique open-title index of the live database");
let uniq = false;
try { db.exec("UPDATE agent_issues SET status = 'open' WHERE id = 9"); } catch (e) { uniq = /UNIQUE/.test(String(e.message)); }
ok(uniq, "reopening the closed copy by hand is refused by the index (the failure of 2026-10-12 08:04Z)");
const c9 = one("SELECT status, description d FROM agent_issues WHERE id = 9"), c10 = one("SELECT status, description d, updated_at u FROM agent_issues WHERE id = 10");
ok(c9.status === "closed" && !/REOPENED/.test(c9.d), "a closed issue with an open twin is not reopened", c9);
ok(c10.d.split("RELAPSE ").length === 2 && /closed issue #9 has the same title and its contract issue-9 failed 3x/.test(c10.d), "the open twin carries one dated relapse line, however many ticks ran", c10.d);
const tn = all("SELECT closed_issue_id, twin_issue_id, noted FROM recurrence_twin_notes");
ok(tn.length === 1 && tn[0].closed_issue_id === 9 && tn[0].twin_issue_id === 10 && tn[0].noted === 1, "one twin note per closure", tn);
const k9 = one("SELECT status, last_verdict v FROM remediation_contracts WHERE class = 'issue-9'");
ok(k9.status === "superseded" && k9.v === "superseded:open-twin" && one("SELECT status FROM remediation_contracts WHERE class = 'issue-10'").status === "active", "the closed copy's contract is superseded; the twin keeps its own", k9);
ok(one("SELECT COUNT(*) n FROM recurrence_guard_actions WHERE issue_id = 9").n === 0 && one("SELECT COUNT(*) n FROM recurrence_guard_actions WHERE issue_id = 4").n === 1, "no action row for the twin case; one for the issue that was reopened");
ok(one("SELECT COUNT(*) n FROM queue_sla_actions WHERE stuck_type = 'closure-relapse' AND note LIKE 'noted on the open twin%'").n === 1 && one("SELECT COUNT(*) n FROM queue_sla_actions WHERE stuck_type = 'closure-relapse' AND note LIKE 'reopened:%'").n === 1, "each kind of action is logged once", all("SELECT note FROM queue_sla_actions WHERE stuck_type = 'closure-relapse'"));
db.exec("UPDATE ops_config SET value = 'on' WHERE key = 'queue_sla_autofix'");
db.exec("INSERT INTO recurrence_guard_actions (issue_id, class, fails, applied) VALUES (77, 'issue-77', 3, 1)");
db.exec("INSERT INTO agent_issues (id, title, description, source, status, created_at, updated_at) VALUES (77, 'closed, no twin, already actioned', 'x', 'loop', 'closed', 1, strftime('%s', 'now', '-3 days') * 1000)");
db.exec("INSERT INTO issue_triage (issue_id, rc, owner, sla_due_at, close_evidence) VALUES (77, 'r', 'o', 'x', 'evidence')");
db.exec("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, status, max_attempts) VALUES ('issue-77', 77, 'p', 'a', 'SELECT 1', 'd1-query', 'x', 'active', 3)");
db.exec("DROP TRIGGER remediation_reopen_on_relapse_d1");
db.exec("INSERT INTO remediation_verifications (issue_id, class, transport, expected, observed, pass, verified_at) VALUES (77, 'issue-77', 'd1-query', '1', '0', 0, datetime('now', '-5 hours')), (77, 'issue-77', 'd1-query', '1', '0', 0, datetime('now', '-4 hours')), (77, 'issue-77', 'd1-query', '1', '0', 0, datetime('now', '-3 hours'))");
db.exec("INSERT INTO fleet_tick (source) VALUES ('migration:test')");
db.exec("INSERT INTO fleet_tick (source) VALUES ('migration:test')");
ok(one("SELECT COUNT(*) n FROM recurrence_guard_actions WHERE issue_id = 77").n === 1, "an issue and class with an action after its latest closure gets no second action row", all("SELECT id, issue_id, applied FROM recurrence_guard_actions"));
ok(one("SELECT COUNT(*) n FROM recurrence_twin_notes").n === 1 && one("SELECT description d FROM agent_issues WHERE id = 10").d.split("RELAPSE ").length === 2, "further ticks add no note and no line");
// the same rule in the per-verification trigger (REMEDIATION-REOPEN-2), recreated by the migration file
db.exec(readFileSync(new URL("./2026-10-12-25-recurrence-guard-twin.sql", import.meta.url), "utf8"));
db.exec("INSERT INTO agent_issues (id, title, description, source, status, created_at, updated_at) VALUES (81, 'Twin pair B', 'x', 'loop', 'closed', 1, strftime('%s', 'now', '-1 hours') * 1000), (82, 'twin pair b', 'x', 'loop', 'open', 1, 1), (83, 'no twin C', 'x', 'loop', 'closed', 1, strftime('%s', 'now', '-1 hours') * 1000)");
db.exec("INSERT INTO issue_triage (issue_id, rc, owner, sla_due_at, close_evidence) VALUES (81, 'r', 'o', 'x', 'evidence'), (83, 'r', 'o', 'x', 'evidence')");
db.exec("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, status, max_attempts) VALUES ('issue-81', 81, 'p', 'a', 'SELECT 1', 'd1-query', 'x', 'active', 2), ('issue-83', 83, 'p', 'a', 'SELECT 1', 'd1-query', 'x', 'holding', 2)");
let vErr = null;
try { for (let i = 0; i < 3; i++) db.exec("INSERT INTO remediation_verifications (issue_id, class, transport, expected, observed, pass) VALUES (81, 'issue-81', 'd1-query', '1', '0', 0), (83, 'issue-83', 'd1-query', '1', '0', 0)"); } catch (e) { vErr = String(e.message); }
ok(vErr === null && one("SELECT COUNT(*) n FROM remediation_verifications WHERE class = 'issue-81'").n === 3, "a failing verdict on a closed issue with an open twin is stored (it was refused before)", vErr);
ok(one("SELECT status FROM agent_issues WHERE id = 81").status === "closed" && one("SELECT status FROM agent_issues WHERE id = 83").status === "open" && one("SELECT status FROM remediation_contracts WHERE class = 'issue-83'").status === "active", "the per-verification rule leaves the twin case closed and still reopens an issue without a twin");
const fmq = one("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-reopen-hits-open-twin'");
ok(fmq && one(fmq.p).expected === "0" && one(fmq.p).observed === "0", "detector fm-reopen-hits-open-twin runs and reads 0 once the closed copies are superseded", fmq && one(fmq.p));

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
