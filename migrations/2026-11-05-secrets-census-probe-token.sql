-- PROBE-SINK-TOKEN-1 (2026-11-05, charter pillar autonomy; metric contracts_unexecutable_open 1). Contract issue-1000698 (ROADMAP-1 QNFO.INFRA #2) took the probe
-- migrations/2026-11-05-secrets-census-1.sql wrote, and kept module = 'probe-author-1' from its birth. For a contract of that module the sink guard (rtSinkGuard, qnfo-fleet-control;
-- PROBE-AUTHOR-SINK-GUARD-1) accepts only an expected and an observed value that is one short token (letters, digits, _ . : + -, at most 64 characters), because the value is copied
-- untruncated into remediation_verifications and the consumer's run log. The census probe returns sentences, so every run of the in-worker tick ended 'probe-error: free-text-value'
-- (cloud_ops_events 2026-11-05T02:31Z) and the contract has counted in contracts_unexecutable_open since. Same measurement, short tokens: expected 'ok'; observed 'ok' when the store
-- bindings cover the per-worker secret_text bindings, 'no-census' while the snapshot has no secrets_census, otherwise '<store bindings>:<secret_text bindings>' (for example 0:112).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_issue_1000698_probe
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_issue_1000698_probe b WHERE b.class = remediation_contracts.class), attempts = 0, last_verdict = NULL, next_due_at = datetime('now') WHERE class = 'issue-1000698'

CREATE TABLE IF NOT EXISTS bak_20261105_issue_1000698_probe AS
SELECT class, issue_id, verify_probe, verify_transport, module, status, last_verdict FROM remediation_contracts WHERE class = 'issue-1000698';

UPDATE remediation_contracts SET
  verify_probe = 'WITH c AS (SELECT json_extract(data, ''$.secrets_census.store_bindings'') AS s, json_extract(data, ''$.secrets_census.secret_text'') AS t FROM infra_state WHERE id = ''snapshot'' ORDER BY ts DESC LIMIT 1) SELECT ''ok'' AS expected, CASE WHEN s IS NULL THEN ''no-census'' WHEN t = 0 OR s >= t THEN ''ok'' ELSE s || '':'' || t END AS observed FROM c',
  attempts = 0, last_verdict = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000698' AND issue_id = 1000698 AND instr(verify_probe, 'secrets store bindings cover the per-worker secret_text bindings') > 0;
