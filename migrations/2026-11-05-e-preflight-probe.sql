-- PREFLIGHT-PROBE-REAL-1 (2026-11-05, charter pillar reach; GitHub QNFO/qnfo-workers#6622; agent_issues 1001359 PUBLICATION-PREFLIGHT-FAIL-Q08; cluster E-metrics-portfolio).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_e_preflight_probe
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_e_preflight_probe b WHERE b.class = remediation_contracts.class), verify_transport = (SELECT b.verify_transport FROM bak_20261105_e_preflight_probe b WHERE b.class = remediation_contracts.class) WHERE class = 'issue-1001359' AND EXISTS (SELECT 1 FROM bak_20261105_e_preflight_probe b WHERE b.class = remediation_contracts.class)
-- CAUSE-MAPPED: no metric is registered here; this replaces one contract probe.
--
-- The preflight failed once, on 2026-11-02T18:01Z ("health served by q08-signal-engine: http 0 worker=null version=null"; the listing and the feed answered 200 in the same run). It has passed in every hourly run since:
-- cloud_ops_events kind publication_preflight, text "q08 ok", 2026-11-02T19:05Z to 2026-11-05T01:05Z, and q08.org/health answers {"worker":"q08-signal-engine","version":"0.44.0"} (read 2026-11-05).
-- qnfo-fleet-control publicationPreflight therefore tries to close the issue every hour ("q08 recovered; open issue 1001359", kind publication_preflight_recovered, last 2026-11-05T01:05:46Z), and the close
-- never sticks: the issue's contract probe joins service_registry to json_each(routes) and answers probe-error on every run, and a contract whose last verdict is not a pass refuses the close
-- (close-while-contract-fails). The probe also asked a different question from the issue's own definition of done (is the route listed in the registry, not does the surface serve its health).
-- The replacement reads exactly what the preflight records: the newest q08 publication_preflight event is ok and under 3 hours old (the preflight runs hourly).

CREATE TABLE IF NOT EXISTS bak_20261105_e_preflight_probe (class TEXT PRIMARY KEY, verify_probe TEXT, verify_transport TEXT);
INSERT OR IGNORE INTO bak_20261105_e_preflight_probe (class, verify_probe, verify_transport)
SELECT class, verify_probe, verify_transport FROM remediation_contracts WHERE class = 'issue-1001359';

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN (SELECT status FROM cloud_ops_events WHERE kind = ''publication_preflight'' AND text LIKE ''q08%'' ORDER BY ts DESC LIMIT 1) = ''ok'' AND (SELECT MAX(ts) FROM cloud_ops_events WHERE kind = ''publication_preflight'' AND text LIKE ''q08%'') > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-3 hours'') THEN ''ok'' ELSE ''the newest q08 publication_preflight event is not ok or is older than 3 hours'' END AS observed',
    verify_transport = 'd1-query',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1001359' AND issue_id = 1001359;
