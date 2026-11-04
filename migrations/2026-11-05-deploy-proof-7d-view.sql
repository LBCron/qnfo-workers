-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_deploy_proof_7d
-- DEPLOY-PROOF-VIEW-1 (2026-11-05, charter pillar: autonomy; DEPLOY-PROBES-1 and REVIEW-GATE-1, docs/DEPLOY-PROOF-2026-11.md).
-- The owner brief asked for before/after counts of probe-fail and red-main events one week after the post-deploy probes and the review gate ship. This view is that read-out:
-- `SELECT * FROM v_deploy_proof_7d` answers it in one row, for any later week too, so the follow-up is a query and not a session's memory.
--   probe_runs / probe_runs_failed  cloud_ops_events kind canary-functional (one row per canary run that had probes; status fail = at least one probe failed)
--   reverts                        DEPLOY-PROBE-REVERTED-1 issues (a non-control-plane push reverted or its revert opened as a pull request)
--   control_plane_reverts          CONTROL-PLANE-REVERTED-1 issues (the VERSION canary and the probes of the seven control-plane workers)
--   failures_filed                 DEPLOY-PROBE-FAILED-1 issues (a failure that reverted nothing: pre-existing, a mistyped marker, observe mode, a created worker)
--   canary_failed                  DEPLOY-PROBE-CANARY-FAILED-1 and CONTROL-PLANE-CANARY-FAILED-1 issues (a revert that could not be made)
--   review_gate_runs / _usd        cloud_ops_events kind review-gate (one row per reviewed head, meta.usd the cost of its model calls)
--   workflow_failed_issues         WORKFLOW-FAILED-1 issues (a workflow failed on main: the red-main proxy the 2026-11-04 measurement used)
-- A read-only view over cloud_ops_events (indexed on kind, ts) and agent_issues; no trigger reads it and nothing writes it. The window is a rolling seven days from now.
-- CAUSE-MAPPED: no metric is registered here; this adds one view.
CREATE VIEW IF NOT EXISTS v_deploy_proof_7d AS
SELECT
  (SELECT COUNT(*) FROM cloud_ops_events WHERE kind = 'canary-functional' AND ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')) AS probe_runs,
  (SELECT COUNT(*) FROM cloud_ops_events WHERE kind = 'canary-functional' AND status = 'fail' AND ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')) AS probe_runs_failed,
  (SELECT COUNT(*) FROM agent_issues WHERE title LIKE 'DEPLOY-PROBE-REVERTED-1%' AND created_at > CAST(strftime('%s', 'now', '-7 days') AS INTEGER) * 1000) AS reverts,
  (SELECT COUNT(*) FROM agent_issues WHERE title LIKE 'CONTROL-PLANE-REVERTED-1%' AND created_at > CAST(strftime('%s', 'now', '-7 days') AS INTEGER) * 1000) AS control_plane_reverts,
  (SELECT COUNT(*) FROM agent_issues WHERE title LIKE 'DEPLOY-PROBE-FAILED-1%' AND created_at > CAST(strftime('%s', 'now', '-7 days') AS INTEGER) * 1000) AS failures_filed,
  (SELECT COUNT(*) FROM agent_issues WHERE (title LIKE 'DEPLOY-PROBE-CANARY-FAILED-1%' OR title LIKE 'CONTROL-PLANE-CANARY-FAILED-1%') AND created_at > CAST(strftime('%s', 'now', '-7 days') AS INTEGER) * 1000) AS canary_failed,
  (SELECT COUNT(*) FROM cloud_ops_events WHERE kind = 'review-gate' AND ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')) AS review_gate_runs,
  (SELECT ROUND(COALESCE(SUM(CASE WHEN json_valid(meta) THEN json_extract(meta, '$.usd') END), 0), 4) FROM cloud_ops_events WHERE kind = 'review-gate' AND ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')) AS review_gate_usd,
  (SELECT COUNT(*) FROM agent_issues WHERE title LIKE 'WORKFLOW-FAILED-1%' AND created_at > CAST(strftime('%s', 'now', '-7 days') AS INTEGER) * 1000) AS workflow_failed_issues;
