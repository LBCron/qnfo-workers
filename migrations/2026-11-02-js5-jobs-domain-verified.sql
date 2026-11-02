-- RM-1676 (JS-5): record the existing jobs.q08.org owner-facing route as verified only after its runner probe passes.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_js5_jobs_domain_verified
-- Rollback: UPDATE roadmap_implementation SET status = (SELECT status FROM bak_20261102_js5_jobs_domain_verified WHERE id = 1676), evidence = (SELECT evidence FROM bak_20261102_js5_jobs_domain_verified WHERE id = 1676), verified_at = (SELECT verified_at FROM bak_20261102_js5_jobs_domain_verified WHERE id = 1676) WHERE id = 1676 AND EXISTS (SELECT 1 FROM bak_20261102_js5_jobs_domain_verified WHERE id = 1676)

CREATE TABLE IF NOT EXISTS bak_20261102_js5_jobs_domain_verified AS
SELECT id, status, evidence, verified_at
FROM roadmap_implementation
WHERE id = 1676 AND item = 'JS-5' AND source = 'jobsearch-2026' AND status = 'planned';

UPDATE roadmap_implementation
SET status = 'verified',
    verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = 'jobs.q08.org is routed to qnfo-jobsearch: the attach-jobs-q08-route workflow artifact reports verified=true and the live runner-https contract for issue-1000582 passed the exact GET https://jobs.q08.org/health probe (HTTP 200, worker qnfo-jobsearch). A live read also confirmed the proxied originless AAAA record and jobs.q08.org/* zone route.'
WHERE id = 1676
  AND item = 'JS-5'
  AND source = 'jobsearch-2026'
  AND status = 'planned'
  AND EXISTS (
    SELECT 1
    FROM agent_issues
    WHERE id = 1000582
      AND status = 'closed'
      AND instr(description, 'runtime-probe: {"url": "https://jobs.q08.org/health", "status": 200, "contains": "qnfo-jobsearch"}') > 0
  )
  AND EXISTS (
    SELECT 1
    FROM remediation_contracts
    WHERE class = 'issue-1000582'
      AND issue_id = 1000582
      AND status IN ('active', 'holding')
      AND verify_transport = 'runner-https'
      AND verify_probe = '{"url": "https://jobs.q08.org/health", "status": 200, "contains": "qnfo-jobsearch"}'
      AND last_verdict = 'pass'
      AND last_attempt_at >= datetime('now', '-60 minutes')
  );

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested, outcome_matched)
SELECT
  'coding-agent (RM-1676)',
  'The existing owner-facing address is serving qnfo-jobsearch and its exact runner-https health probe passed within the last 60 minutes.',
  'Verify JS-5 in roadmap_implementation when its closed issue and passing health-probe evidence agree.',
  'The attach workflow artifact reports verified=true; the issue-1000582 runner-https probe returns HTTP 200 with qnfo-jobsearch; the live zone read confirms jobs.q08.org/* and its proxied AAAA record.',
  'verified: JS-5 owner-facing address',
  'roadmap_implementation row 1676 and one decision_log row',
  'Restore roadmap row 1676 from bak_20261102_js5_jobs_domain_verified; the decision_log is append-only.',
  'js5-owner-facing-domain-verified',
  'JS-5 moves from planned to verified only when its exact health probe is recently passing; no route, worker, or personal data is changed.',
  'No audience reach increase is claimed; the existing personal-plane address becomes verified in the authoritative roadmap.',
  'Cloudflare zone route and DNS reads; jobs.q08.org/health; qnfo-audit issue and runner-https contract',
  1
WHERE EXISTS (
  SELECT 1
  FROM roadmap_implementation
  WHERE id = 1676 AND item = 'JS-5' AND source = 'jobsearch-2026' AND status = 'verified'
)
AND EXISTS (
  SELECT 1
  FROM bak_20261102_js5_jobs_domain_verified
  WHERE id = 1676
)
AND NOT EXISTS (
  SELECT 1
  FROM decision_log
  WHERE action = 'Verify JS-5 in roadmap_implementation when its closed issue and passing health-probe evidence agree.'
);
