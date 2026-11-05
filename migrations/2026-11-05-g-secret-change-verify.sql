-- SECRET-VERIFY-1 (2026-11-05, pillar security and autonomy; agent_issues 1000944, 1000948, 1001184 = GitHub 5804, 5807, 6206). Cluster G-owner-security of the 2026-11-04 sweep.
-- Finding (read live 2026-11-05 03:50Z): qnfo-ops secretChangeWatch (SECRET-CHANGE-WATCH-1) files one issue per worker per day for every secret-triggered Cloudflare version
-- (values are never read), and nothing in the fleet can close it: no code writes the secret-verified event that 1000948's contract waits for, and 1000944 and 1001184 sit in 'monitoring'
-- with the verdict "stale: the filing loop qnfo-ops did not close it within 48h". Cloudflare names no changed binding, so the fleet cannot tell a rotation from an added name.
-- What the fleet can check on its own, and what these contracts now measure, is whether the worker has served healthy since the change: fleet_probe_log holds an http probe of every worker
-- about every 5 minutes (source qnfo-fleet-dashboard; qnfo-memory-mcp 202 of 202 ok, qnfo-fleet-lee 56 of 56 ok and 146 of 146 cf-api-list ok, qnfo-fleet-control 200 of 200 ok, since 2026-11-04T12:05Z),
-- and for qnfo-fleet-control the functional signals github_app_token_ok (GH_APP_PRIVATE_KEY mints an installation token) and remediation_tick_age_min (its D1 and internal tokens work).
-- A contract passes only with at least 24 probes after the change inside the last 48 hours, none failed in the last 12, and under 5 percent failed overall. This is LIVENESS evidence, not proof
-- that a credential still opens every door: the owner-held copies of these credentials (clients) and a rotated-out value that is no longer accepted are not readable by the fleet, and the
-- written review on each triage row says so. The class gets its producer as ROADMAP-1 SECRET-VERIFY-1 (qnfo-ops secretChangeWatch writes a secret-verified event from the same probe rows).
-- No cap, guard or probe is weakened: three probes that could never pass become probes that can pass or fail on the worker's real behaviour.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_g_secret_verify b WHERE b.k = remediation_contracts.class), status = (SELECT b.status FROM bak_20261105_g_secret_verify b WHERE b.k = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_g_secret_verify b WHERE b.k = remediation_contracts.class) WHERE class IN (SELECT k FROM bak_20261105_g_secret_verify); UPDATE agent_issues SET status = 'closed', close_channel = 'rollback:SECRET-VERIFY-1' WHERE title LIKE 'SECRET-VERIFY-1:%' AND status = 'open';

CREATE TABLE IF NOT EXISTS bak_20261105_g_secret_verify (k TEXT PRIMARY KEY, verify_probe TEXT, status TEXT, last_verdict TEXT);
INSERT OR IGNORE INTO bak_20261105_g_secret_verify (k, verify_probe, status, last_verdict)
SELECT class, verify_probe, status, last_verdict FROM remediation_contracts WHERE class IN ('issue-1000944', 'issue-1000948', 'issue-1001184');

-- 1000944 qnfo-memory-mcp, secret-triggered version 61 at 2026-10-31T16:58:20Z
UPDATE remediation_contracts
SET verify_probe = 'WITH p AS (SELECT ok, ts FROM fleet_probe_log WHERE name = ''qnfo-memory-mcp'' AND transport = ''http'' AND ts > ''2026-10-31T16:59:00Z'' AND ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-48 hours'')), last12 AS (SELECT ok FROM p ORDER BY ts DESC LIMIT 12) SELECT ''healthy'' AS expected, CASE WHEN (SELECT COUNT(*) FROM p) < 24 THEN ''pending: fewer than 24 http probes of qnfo-memory-mcp in the last 48 hours after the secret change'' WHEN (SELECT COUNT(*) FROM last12 WHERE ok = 0) > 0 THEN ''failing: an http probe failed within the last 12'' WHEN (SELECT 1.0 * SUM(1 - ok) / COUNT(*) FROM p) > 0.05 THEN ''degraded: more than 5 percent of http probes failed since the secret change'' ELSE ''healthy'' END AS observed',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000944' AND issue_id = 1000944;

-- 1000948 qnfo-fleet-lee, secret-triggered version 5 at 2026-10-31T17:24:55Z (cf-api-list probes until 2026-11-04T23:30Z, http after)
UPDATE remediation_contracts
SET verify_probe = 'WITH p AS (SELECT ok, ts FROM fleet_probe_log WHERE name = ''qnfo-fleet-lee'' AND transport IN (''http'', ''cf-api-list'') AND ts > ''2026-10-31T17:25:30Z'' AND ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-48 hours'')), last12 AS (SELECT ok FROM p ORDER BY ts DESC LIMIT 12) SELECT ''healthy'' AS expected, CASE WHEN (SELECT COUNT(*) FROM p) < 24 THEN ''pending: fewer than 24 probes of qnfo-fleet-lee in the last 48 hours after the secret change'' WHEN (SELECT COUNT(*) FROM last12 WHERE ok = 0) > 0 THEN ''failing: a probe failed within the last 12'' WHEN (SELECT 1.0 * SUM(1 - ok) / COUNT(*) FROM p) > 0.05 THEN ''degraded: more than 5 percent of probes failed since the secret change'' ELSE ''healthy'' END AS observed',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000948' AND issue_id = 1000948;

-- 1001184 qnfo-fleet-control, secret-triggered version 492 at 2026-11-01T16:25:50Z: http probes plus the two functional signals that exercise its tokens
UPDATE remediation_contracts
SET verify_probe = 'WITH p AS (SELECT ok, ts FROM fleet_probe_log WHERE name = ''qnfo-fleet-control'' AND transport = ''http'' AND ts > ''2026-11-01T16:26:30Z'' AND ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-48 hours'')), last12 AS (SELECT ok FROM p ORDER BY ts DESC LIMIT 12) SELECT ''healthy'' AS expected, CASE WHEN (SELECT COUNT(*) FROM p) < 24 THEN ''pending: fewer than 24 http probes of qnfo-fleet-control in the last 48 hours after the secret change'' WHEN (SELECT COUNT(*) FROM last12 WHERE ok = 0) > 0 THEN ''failing: an http probe failed within the last 12'' WHEN (SELECT 1.0 * SUM(1 - ok) / COUNT(*) FROM p) > 0.05 THEN ''degraded: more than 5 percent of http probes failed since the secret change'' WHEN COALESCE((SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = ''github_app_token_ok''), 0) <> 1 THEN ''failing: the GitHub App installation token is not minted (github_app_token_ok)'' WHEN COALESCE((SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = ''remediation_tick_age_min''), 9999) > 60 THEN ''failing: the remediation tick is older than 60 minutes'' ELSE ''healthy'' END AS observed',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1001184' AND issue_id = 1001184;

UPDATE issue_triage SET remediation = 'SECRET-VERIFY-1 review 2026-11-05: what the fleet can check is checked by the contract (liveness since the change from fleet_probe_log; for qnfo-fleet-control also github_app_token_ok and the remediation tick). Not checkable by the fleet and not claimed: that each changed credential still opens every door it is held for, the copies the owner holds in clients, and that a rotated-out value is refused (Cloudflare names no changed binding and the old value is never kept). No exposed value is involved: the event records worker, version number and time only.' WHERE issue_id IN (1000944, 1000948, 1001184);

-- The class gets its producer: a doer for the watch, with a code-probe that is absent today.
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'SECRET-VERIFY-1: SECRET-CHANGE-WATCH-1 files an issue per secret change that nothing can close; write a secret-verified event from the fleet probes',
 'code-task: repo=qnfo-workers path=qnfo-ops/worker.js' || char(10) ||
 'code-anchor: async function secretChangeWatch(env, lookbackMs) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-ops/worker.js"], "contains": "secret-verified"}' || char(10) ||
 'Charter pillar: security and autonomy (program QNFO.OPS). Metric it should move: the SECRET-CHANGE-OBSERVED issues open over 48 hours (1000944, 1000948, 1001184 on 2026-11-05) fall to 0 and stay there. Finding: secretChangeWatch files one issue per worker per day and no code writes the secret-verified event that the probe-agent contracts wait for. Change, in secretChangeWatch only: for each worker with a secret-change event, read qnfo-audit fleet_probe_log rows of that worker (name = worker, transport http or cf-api-list, ts after the newest secret-triggered version time); when at least 24 rows exist, none of the last 12 failed and under 5 percent failed overall, INSERT OR IGNORE one cloud_ops_events row (id secret-verified-<worker>-<version>, kind secret-verified, job qnfo-ops, status ok, meta {worker, version, probes, first_ok, last_ok, scope: "liveness"}; never a secret value). It must not close, edit or comment on any issue and must not run an HTTP request from the Worker to its own account (issue 1190). Done: a test proves the row is written only with enough healthy rows, never on a failed one and once per version; bump VERSION by a minor (new capability); keep deployed-current.worker.js identical. Written with migrations/2026-11-05-g-secret-change-verify.sql, which holds the per-issue probes this event generalises.',
 'session:G-owner-security', 'security', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'SECRET-VERIFY-1:%' AND status = 'open');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:G-owner-security',
       'a secret-triggered version of a worker that has served healthy probes ever since, with its token-dependent signals green, is verified for the legs the fleet can read; the legs it cannot read are named, not claimed',
       'SECRET-VERIFY-1: replace three never-passable secret-change contract probes with fleet_probe_log liveness probes, file the producer as a doer',
       'live reads 2026-11-05: fleet_probe_log http probes ok 202/202 (qnfo-memory-mcp), 56/56 and 146/146 (qnfo-fleet-lee), 200/200 (qnfo-fleet-control); 1000948 contract waits for a secret-verified event no code writes; 1000944 and 1001184 read "stale: the filing loop qnfo-ops did not close it within 48h"',
       'the three issues pass their contracts on the next runs and close with the probe verdict as evidence, or name the failing worker',
       'qnfo-audit remediation_contracts (3 rows), issue_triage remediation (3 rows), one new agent_issues row',
       'Rollback restores the three probes from bak_20261105_g_secret_verify and closes the new SECRET-VERIFY-1 issue (header)',
       'a secret change is followed by an automatic, outside-in liveness verdict',
       'issues 1000944, 1000948 and 1001184 close within about 3 hours of the merge',
       'no external reach change',
       'live fleet_probe_log reads; offline suite migrations/g-secret-change-verify.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'SECRET-VERIFY-1: replace three%');
