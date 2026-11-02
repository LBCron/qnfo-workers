-- ORPHAN-METRIC-SUCCESSOR-1 (2026-11-02, pillar autonomy; issue 2816). Trigger 1959 is disabled and its meaning is carried
-- by enabled trigger 9901. The open child was repeatedly reopened by a failed metric-relapse contract after its successor
-- was closed or monitoring-only. Rearm the successor's real D1 metric probe, then supersede the child only when the successor
-- is open and at least as urgent, the trigger/dependency facts still hold, and no other live claim owns either issue.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE issue_triage SET triage_state=(SELECT triage_state FROM bak_20261102_orphan_metric_successor WHERE issue_id=2816 AND contract_class='issue-2816'),rc=(SELECT triage_rc FROM bak_20261102_orphan_metric_successor WHERE issue_id=2816 AND contract_class='issue-2816'),owner=(SELECT triage_owner FROM bak_20261102_orphan_metric_successor WHERE issue_id=2816 AND contract_class='issue-2816'),sla_due_at=(SELECT triage_sla_due_at FROM bak_20261102_orphan_metric_successor WHERE issue_id=2816 AND contract_class='issue-2816'),close_evidence=(SELECT triage_close_evidence FROM bak_20261102_orphan_metric_successor WHERE issue_id=2816 AND contract_class='issue-2816') WHERE issue_id=2816 AND rc='orphan-metric-successor-1'; UPDATE agent_issues SET status=(SELECT issue_status FROM bak_20261102_orphan_metric_successor WHERE issue_id=2816 AND contract_class='issue-2816'),close_channel=(SELECT issue_close_channel FROM bak_20261102_orphan_metric_successor WHERE issue_id=2816 AND contract_class='issue-2816'),updated_at=(SELECT issue_updated_at FROM bak_20261102_orphan_metric_successor WHERE issue_id=2816 AND contract_class='issue-2816') WHERE id=2816 AND status='closed' AND close_channel LIKE 'auto:triage-sync:%'; UPDATE remediation_contracts SET status=(SELECT contract_status FROM bak_20261102_orphan_metric_successor b WHERE b.issue_id=remediation_contracts.issue_id AND b.contract_class=remediation_contracts.class),last_verdict=(SELECT contract_last_verdict FROM bak_20261102_orphan_metric_successor b WHERE b.issue_id=remediation_contracts.issue_id AND b.contract_class=remediation_contracts.class),next_due_at=(SELECT contract_next_due_at FROM bak_20261102_orphan_metric_successor b WHERE b.issue_id=remediation_contracts.issue_id AND b.contract_class=remediation_contracts.class),attempts=(SELECT contract_attempts FROM bak_20261102_orphan_metric_successor b WHERE b.issue_id=remediation_contracts.issue_id AND b.contract_class=remediation_contracts.class) WHERE issue_id IN (2816,100301) AND EXISTS (SELECT 1 FROM bak_20261102_orphan_metric_successor b WHERE b.issue_id=remediation_contracts.issue_id AND b.contract_class=remediation_contracts.class);

CREATE TABLE IF NOT EXISTS bak_20261102_orphan_metric_successor (
  issue_id INTEGER NOT NULL,
  contract_class TEXT NOT NULL,
  issue_status TEXT,
  issue_close_channel TEXT,
  issue_updated_at INTEGER,
  triage_rc TEXT,
  triage_state TEXT,
  triage_owner TEXT,
  triage_sla_due_at TEXT,
  triage_close_evidence TEXT,
  contract_status TEXT,
  contract_last_verdict TEXT,
  contract_next_due_at TEXT,
  contract_attempts INTEGER,
  PRIMARY KEY (issue_id, contract_class)
);

INSERT OR IGNORE INTO bak_20261102_orphan_metric_successor
  (issue_id, contract_class, issue_status, issue_close_channel, issue_updated_at, triage_rc, triage_state, triage_owner, triage_sla_due_at, triage_close_evidence, contract_status, contract_last_verdict, contract_next_due_at, contract_attempts)
SELECT a.id, c.class, a.status, a.close_channel, a.updated_at, t.rc, t.triage_state, t.owner, t.sla_due_at, t.close_evidence, c.status, c.last_verdict, c.next_due_at, c.attempts
FROM agent_issues a
JOIN issue_triage t ON t.issue_id = a.id
JOIN remediation_contracts c ON c.issue_id = a.id
WHERE a.id IN (2816, 100301);

UPDATE remediation_contracts
SET status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-100301' AND issue_id = 100301
  AND status = 'monitoring' AND last_verdict LIKE 'monitoring:metric-condition%'
  AND verify_transport = 'd1-query' AND verify_probe LIKE '%id = 9901%'
  AND EXISTS (
    SELECT 1
    FROM agent_issues child
    JOIN analytics_metric_triggers old_trigger ON old_trigger.id = 1959
    JOIN metric_deps d ON d.child_metric = old_trigger.metric_key
    JOIN analytics_metric_triggers parent_trigger ON parent_trigger.metric_key = d.parent_metric
    JOIN agent_issues successor ON successor.id = 100301
    WHERE child.id = 2816 AND child.status = 'open'
      AND old_trigger.enabled = 0 AND d.active = 1 AND d.relation = 'disabled-duplicate'
      AND parent_trigger.id = 9901 AND parent_trigger.enabled = 1
      AND parent_trigger.queue_target = 'agent_issues'
      AND successor.status = 'open' AND successor.title LIKE 'METRIC-TRIGGER-9901-%'
      AND CASE successor.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
          <= CASE child.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
      AND NOT EXISTS (
        SELECT 1 FROM work_claims w
        WHERE (w.issue_id IN (2816, 100301) OR w.path IN ('issue:2816', 'issue:100301'))
          AND w.released_at IS NULL AND w.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          AND w.holder <> 'copilot-2816-fix-autonomy-gap-issue'
      )
  );

UPDATE remediation_contracts
SET status = 'superseded', last_verdict = 'superseded:carried-by-enabled-successor', next_due_at = NULL
WHERE issue_id = 2816 AND status IN ('active', 'holding')
  AND EXISTS (
    SELECT 1 FROM remediation_contracts successor_contract
    JOIN agent_issues successor ON successor.id = successor_contract.issue_id
    JOIN analytics_metric_triggers parent_trigger ON parent_trigger.id = 9901 AND parent_trigger.enabled = 1
    JOIN analytics_metric_triggers old_trigger ON old_trigger.id = 1959 AND old_trigger.enabled = 0
    JOIN metric_deps d ON d.child_metric = old_trigger.metric_key AND d.parent_metric = parent_trigger.metric_key
    WHERE successor_contract.class = 'issue-100301' AND successor_contract.issue_id = 100301
      AND successor_contract.status = 'active'
      AND successor.status = 'open' AND successor.title LIKE 'METRIC-TRIGGER-9901-%'
      AND d.active = 1 AND d.relation = 'disabled-duplicate'
      AND CASE successor.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
          <= CASE (SELECT priority FROM agent_issues WHERE id = 2816) WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
      AND NOT EXISTS (
        SELECT 1 FROM work_claims w
        WHERE (w.issue_id IN (2816, 100301) OR w.path IN ('issue:2816', 'issue:100301'))
          AND w.released_at IS NULL AND w.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          AND w.holder <> 'copilot-2816-fix-autonomy-gap-issue'
      )
  );

UPDATE issue_triage
SET rc = 'orphan-metric-successor-1', triage_state = 'closed', owner = 'qnfo-fleet-control',
    close_evidence = 'SUPERSEDED BY #100301: trigger 1959 is disabled and its active disabled-duplicate dependency names issues_over_24h_no_doer; enabled trigger 9901 is the successor, and open issue #100301 carries its rearmed D1 metric-condition probe at equal or higher priority. The stale relapse contract on #2816 is superseded with this disposition so the disabled trigger cannot reopen the duplicate. Closed by migration ORPHAN-METRIC-SUCCESSOR-1 from trigger, dependency, contract, priority, issue and claim facts.'
WHERE issue_id = 2816 AND triage_state = 'triaged' AND COALESCE(close_evidence, '') = ''
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 2816 AND status = 'open')
  AND EXISTS (
    SELECT 1 FROM remediation_contracts c
    JOIN agent_issues successor ON successor.id = c.issue_id
    JOIN analytics_metric_triggers parent_trigger ON parent_trigger.id = 9901 AND parent_trigger.enabled = 1
    JOIN analytics_metric_triggers old_trigger ON old_trigger.id = 1959 AND old_trigger.enabled = 0
    JOIN metric_deps d ON d.child_metric = old_trigger.metric_key AND d.parent_metric = parent_trigger.metric_key
    WHERE c.class = 'issue-100301' AND c.issue_id = 100301 AND c.status = 'active'
      AND c.verify_transport = 'd1-query' AND c.verify_probe LIKE '%id = 9901%'
      AND successor.status = 'open' AND successor.title LIKE 'METRIC-TRIGGER-9901-%'
      AND d.active = 1 AND d.relation = 'disabled-duplicate'
      AND CASE successor.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
          <= CASE (SELECT priority FROM agent_issues WHERE id = 2816) WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
  )
  AND NOT EXISTS (
    SELECT 1 FROM work_claims w
    WHERE (w.issue_id IN (2816, 100301) OR w.path IN ('issue:2816', 'issue:100301'))
      AND w.released_at IS NULL AND w.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      AND w.holder <> 'copilot-2816-fix-autonomy-gap-issue'
  )
  AND NOT EXISTS (
    SELECT 1 FROM agent_issues twin
    WHERE twin.id <> 2816 AND twin.status = 'open'
      AND lower(trim(twin.title)) = lower(trim((SELECT title FROM agent_issues WHERE id = 2816)))
  );

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested, outcome_matched)
SELECT 'qnfo-workers:2026-11-02-orphan-metric-successor-1',
       'Disabled trigger 1959 is safely superseded only while its mapped trigger 9901 and the open successor issue retain a real D1 metric probe.',
       'Rearmed issue 100301 metric probe and superseded issue 2816 with its stale relapse contracts.',
       'Migration eligibility requires the disabled trigger, active disabled-duplicate dependency, enabled successor trigger, open successor with an equal-or-higher priority, machine-readable metric probe, and no other live claim.',
       'applied',
       'Issues 2816 and 100301, their remediation contracts, and the next issues_without_next_action refresh.',
       'Rollback restores the backed-up triage, issue, and contract state from bak_20261102_orphan_metric_successor.',
       'Prevents a disabled metric trigger relapse from reopening a superseded issue while preserving the enabled successor probe.',
       'At the next issue refresh, issues_without_next_action decreases by one as #100301 regains an active probe; issue 2816 remains superseded.',
       'One duplicate trigger issue removed from the autonomy backlog without claiming the successor metric recovered.',
       'D1 facts and SQLite migration regression test; live deployment probe remains pending CI migration application.',
       NULL
WHERE EXISTS (SELECT 1 FROM issue_triage WHERE issue_id = 2816 AND rc = 'orphan-metric-successor-1' AND triage_state = 'closed')
  AND NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'qnfo-workers:2026-11-02-orphan-metric-successor-1');
