-- SMART-PLACEMENT-READ-1 (2026-11-05, charter pillar infra; agent_issues 1000697, ROADMAP-1 QNFO.INFRA #1). The merged change for this item (PR 5135) made the qnfo-infra snapshot
-- PATCH a made-up placement field to /workers/scripts/<name>/settings for the ten heaviest D1 workers on every tick; Cloudflare answered "Content-Type must be one of:
-- multipart/form-data" for all ten (infra_state snapshot 2026-11-04T22:30Z: 0 patched, 10 errors), so the item read as merged while nothing changed. Placement is declared
-- per worker in wrangler.toml and sent by the canonical deploy (qnfo-ops PLACEMENT-DECLARED-APPLY-1), one component at a time (SMART-PLACEMENT-CANARY-1, personal-api first,
-- live: GET /accounts/<id>/workers/scripts/personal-api/settings shows placement.mode smart; qnfo-lifecycle shows {}). qnfo-infra 1.12.1 drops the failing PATCH and records
-- which of the heaviest D1 workers are on smart placement (d1.smart_placement.top_heavy_smart). The old closing probe expected "N patched, 0 errors" from the PATCH loop, which
-- cannot be satisfied by the declared path; the new probe reads the live placement of the heaviest D1 workers and passes only when every one is on smart placement.
-- The canary's re-read (the rule before a second component) is recorded on the issue: no error rise, latency effect not yet attributable.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_smart_placement_read b WHERE b.class = remediation_contracts.class), action = (SELECT b.action FROM bak_20261105_smart_placement_read b WHERE b.class = remediation_contracts.class), attempts = 0, last_verdict = NULL, next_due_at = datetime('now') WHERE class = 'issue-1000697' AND EXISTS (SELECT 1 FROM bak_20261105_smart_placement_read b WHERE b.class = 'issue-1000697'); UPDATE agent_issues SET description = substr(description, 1, instr(description, char(10) || 'SMART-PLACEMENT-REREAD-1') - 1) WHERE id = 1000697 AND instr(description, char(10) || 'SMART-PLACEMENT-REREAD-1') > 0

CREATE TABLE IF NOT EXISTS bak_20261105_smart_placement_read AS
SELECT class, issue_id, action, verify_probe, verify_transport, status, last_verdict FROM remediation_contracts WHERE class = 'issue-1000697';

UPDATE remediation_contracts
SET verify_probe = 'WITH latest AS (SELECT json_extract(data, ''$.d1.smart_placement'') AS sp FROM infra_state WHERE id = ''snapshot'' ORDER BY ts DESC LIMIT 1), c AS (SELECT json_array_length(json_extract(sp, ''$.top_heavy'')) AS top_n, json_array_length(json_extract(sp, ''$.top_heavy_smart'')) AS smart_n FROM latest) SELECT ''every heaviest D1 worker is on smart placement'' AS expected, CASE WHEN smart_n IS NULL THEN ''the snapshot has no top_heavy_smart yet (qnfo-infra 1.12.1 not live)'' WHEN top_n > 0 AND smart_n = top_n THEN ''every heaviest D1 worker is on smart placement'' ELSE smart_n || '' of '' || top_n || '' heaviest D1 workers are on smart placement'' END AS observed FROM c',
    action = 'SMART-PLACEMENT-READ-1: passes when the live settings of every one of the heaviest D1 workers read placement.mode smart. The route there is a [placement] table in the worker''s wrangler.toml, one component at a time after a re-read of the previous one (SMART-PLACEMENT-CANARY-1). Replaces the probe that expected the failed settings PATCH to report N patched, 0 errors.',
    attempts = 0, last_verdict = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000697' AND issue_id = 1000697
  AND verify_probe LIKE '%patch_errors%';

UPDATE agent_issues
SET description = description || char(10) || 'SMART-PLACEMENT-REREAD-1 2026-11-05T00:40Z (CF GraphQL workersInvocationsAdaptive for personal-api, 48 hourly rows 2026-11-03T00Z to 2026-11-05T00Z; canary live since 2026-11-04T16:53Z): errors 0 in every hour before and after, so the canary guard holds. p50 wall time was 187 to 315 ms through 2026-11-04T15Z and 4 to 12 ms from 17Z on, but requests an hour rose from 30 to 76 before to 112 to 167 after in the same hours (companion 4.36.0 added the hourly self-check and the one-thing push), so the median moved with the traffic mix and the fall cannot be credited to placement; p99 wall time did not improve (475 to 7,253 ms after, 478 to 52,120 ms before). Verdict: no error rise, latency effect unproven. The second component (a non-control-plane D1 worker from the top_heavy list) is declared in its wrangler.toml only after a per-route read of personal-api on or after 2026-11-06T17:00Z. The failing PATCH in the qnfo-infra snapshot is removed in qnfo-infra 1.12.1 (PR for SMART-PLACEMENT-READ-1).'
WHERE id = 1000697 AND status = 'open' AND instr(description, 'SMART-PLACEMENT-REREAD-1') = 0;
