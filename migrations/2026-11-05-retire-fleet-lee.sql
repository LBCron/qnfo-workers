-- RETIRE-FLEET-LEE-1 (2026-11-05, charter pillar security; owner decision 2026-11-05: Lee runs only from the fleet command line for the authenticated owner, with no separate external-facing subdomain or route).
-- qnfo-fleet-lee, the standalone Lee host (lee.qnfo.org), is retired: qnfo-fleet-lee/RETIRED is the repository record and the live script is deleted by cf-ops-actions delete-worker after this merges.
-- This file marks the service_registry row retired first, so the binding census (qnfo-ops /fleet, journey binding-census) stops probing a host that is about to be removed (OPS-FLEET-RETIRED-1 skips retired rows).
-- Prediction: binding-census keeps passing on both runners across the deletion and lee.qnfo.org/api/health stops answering 200.
-- Verify: GET https://qnfo-ops.q08.workers.dev/fleet shows the qnfo-fleet-lee row retired; curl -I https://lee.qnfo.org/api/health is not 200 after the delete; GET https://qnfo-fleet-control.q08.workers.dev/journeys binding-census ok.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE service_registry SET state = 'live', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE service = 'qnfo-fleet-lee';
-- spof-review: one registry value; the readers (qnfo-ops census, qnfo-fleet-control /state registry probe, qnfo-fleet-dashboard) already skip state retired.

UPDATE service_registry
   SET state = 'retired', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE service = 'qnfo-fleet-lee' AND state <> 'retired';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session-open-issues',
  'the owner reads Lee only in the authenticated fleet command line; a standalone external host adds exposure and no capability',
  'RETIRE-FLEET-LEE-1: service_registry state of qnfo-fleet-lee set to retired; qnfo-fleet-lee/RETIRED added; the live script is deleted by cf-ops-actions delete-worker after the merge',
  'owner decision 2026-11-05 in session; qnfo-fleet-dashboard 1.95.2 live with RM-LEE-CMD-1 (cf reads and lee: in the command line, owner session only); fleet graph impact worker:qnfo-fleet-lee depth 3: no binders',
  'applied by migration', 'one service_registry row; the live standalone script and its custom domain after the delete',
  'the Rollback line restores state live; the standalone host is redeployed from the source repository named in the RETIRED file',
  'Lee is reachable only through the authenticated command line', 'fleet_journeys_failing <= 2 within 3 h', 'none',
  'curl lee.qnfo.org/api/health; d1:service_registry; qnfo-ops /fleet; qnfo-fleet-control /journeys'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'RETIRE-FLEET-LEE-1:%');
