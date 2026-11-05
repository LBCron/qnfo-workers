-- F2 follow-up (2026-11-05, charter pillar security): agent_issues 1001965 YT-C2PA-1 was filed without a probe line, and the birth template of its contract was superseded (CLOSE-PROBE-CIRCULAR-1), so nothing measured it.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET description = substr(description, 1, instr(description, char(10) || 'code-probe: {"paths": ["qnfo-youtube-shorts/container/render.py"]') - 1) WHERE id = 1001965 AND instr(description, char(10) || 'code-probe: {"paths": ["qnfo-youtube-shorts/container/render.py"]') > 0
-- CAUSE-MAPPED: registers no metric_registry row.
-- The probe line is the one PROBE-LINE-SWEEP-1 turns into a code-read contract: the issue closes when qnfo-youtube-shorts/container/render.py (on main) names c2pa, which the definition of done asks for.
UPDATE agent_issues
SET description = description || char(10) || 'code-probe: {"paths": ["qnfo-youtube-shorts/container/render.py"], "contains": "c2pa"}',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1001965
  AND title LIKE 'YT-C2PA-1:%'
  AND status = 'open'
  AND instr(description, 'code-probe: {"paths": ["qnfo-youtube-shorts/container/render.py"]') = 0;

INSERT OR REPLACE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
SELECT 'issue-' || a.id, a.id, 'probe line in the issue (PROBE-LINE-SWEEP-1)', 'the doer fixes the defect; scripts/remediation_consumer.py reads main and closes the issue when render.py names c2pa',
  '{"paths": ["qnfo-youtube-shorts/container/render.py"], "contains": "c2pa"}', 'code-read', 3, 'qnfo-fleet-control', 1, 'active', 'probe-line-sweep-v1', datetime('now')
FROM agent_issues a
WHERE a.id = 1001965 AND a.title LIKE 'YT-C2PA-1:%' AND a.status = 'open';
