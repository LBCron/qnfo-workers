-- GRADUAL-PREVIEW-VISIBILITY-RETRY-1 (issue 1001243; charter pillar autonomy).
-- A single preview smoke request received HTTP 200 from the old version immediately after a new version upload.
-- Bounded retries now wait for the uploaded VERSION before allowing a staged traffic shift.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'fm-gradual-preview-version-not-visible'; DELETE FROM failure_modes WHERE fm_key = 'gradual-preview-version-not-visible'

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES
  ('gradual-preview-version-not-visible',
   'staged deploy preview health answers before the uploaded version is visible',
   'the preview smoke check made one request immediately after upload, so a successful response from the prior version was treated as a permanent failure',
   'GRADUAL-PREVIEW-VISIBILITY-RETRY-1: retry the preview check within a bounded window and shift traffic only after the uploaded VERSION is observed',
   'fm-gradual-preview-version-not-visible: the bounded preview retry remains in scripts/gradual_deploy.py',
   'fm-gradual-preview-version-not-visible', '2026-11-01', 1001243,
   'a preview override request returns HTTP 200 without the uploaded VERSION immediately after upload',
   'canonical-deploy fails despite the previous worker continuing to answer health checks',
   'gradual deployments and the main-branch deploy gate');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES
  ('fm-gradual-preview-version-not-visible', NULL, 'GRADUAL-PREVIEW-VISIBILITY-RETRY-1', 'failure-mode detector',
   '{"paths":["scripts/gradual_deploy.py"],"contains":"PREVIEW_SMOKE_ATTEMPTS = 6"}',
   'code-read', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot:issue-1001243',
  'an HTTP 200 preview response may still serve the prior version while the uploaded version becomes visible',
  'GRADUAL-PREVIEW-VISIBILITY-RETRY-1: poll preview health for the uploaded VERSION before shifting staged traffic',
  'canonical-deploy run 41355839963: qnfo-model-eval returned HTTP 200 without VERSION 1.8.4-codeagent on its first preview request; subsequent main deploys succeeded on other workers',
  'bounded retries retain the fail-closed rollout gate while allowing transient preview propagation',
  'gradual deploy preview checks and canonical-deploy CI self-test',
  'revert the script and workflow changes; remove this detector and failure-mode row with the migration rollback',
  'transient preview propagation no longer causes a false deploy failure; no staged traffic shifts before the expected VERSION is observed',
  'preview-related false failures fall to zero while failed or mismatched previews still stop the rollout',
  'no direct reach gain; canonical deployment reliability improves',
  'offline delayed-visibility and exhausted-retry tests; canonical-deploy self-test on each deployment'
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action = 'GRADUAL-PREVIEW-VISIBILITY-RETRY-1: poll preview health for the uploaded VERSION before shifting staged traffic'
);
