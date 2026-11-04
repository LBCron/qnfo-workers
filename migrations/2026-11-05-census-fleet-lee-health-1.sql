-- CENSUS-FLEET-LEE-HEALTH-1 (2026-11-05, charter pillar core; FLEET-JOURNEY-FAILED-1 binding-census, agent_issues 1000750).
-- Measured 2026-11-04 23:02Z: the binding-census journey fails on both runners with one name, qnfo-fleet-lee (cf runner 22:40Z "no worker unhealthy through the census": healthy false;
-- gha runner 22:19Z "census sees every worker": healthy null). qnfo-ops /fleet reads qnfo-fleet-lee as { healthy: null, http: 404, probe: "registry-http",
-- error: "cf-1042-no-published-route", base_url: "https://qnfo-fleet-lee.q08.workers.dev" } and, when the 6 s workers.dev fetch times out under D1 load, as healthy false.
-- Cause: qnfo-fleet-lee is an unmanaged worker that is served on its custom domain only. Its workers.dev subdomain is disabled on purpose (scripts/deploy-drift-guard.py
-- UNMANAGED_WORKERS_DEV_EXPECTED = {"qnfo-fleet-lee": False}), so every census probe of the registry base_url gets Cloudflare error 1042 or a timeout, while
-- https://lee.qnfo.org/api/health answers 200 {"ok":true,...} (the same URL scripts/deploy-drift-guard.py names in UNMANAGED_HEALTH_URLS). The census appends /health
-- to service_registry.base_url (qnfo-ops fleetStatus, compatHealthProbe), and lee serves its health at /api/health and answers 404 at /health, so the base that works is
-- https://lee.qnfo.org/api. mind.q08.org and agents.qnfo.org are probed the same way (registry-http through a custom domain, healthy true).
-- Why a registry row and not code: qnfo-ops registryRefresh/sweeps only INSERT OR IGNORE the base_url and UPDATE version/updated_at (checked in qnfo-ops/worker.js), so the value
-- is durable; qnfo-ops/worker.js is under another session's claim and needs no change.
-- Prediction: binding-census passes on the next run of both runners after this applies (qnfo-ops /fleet: qnfo-fleet-lee healthy true, probe registry-http, http 200),
-- unhealthyCount 0 and unprobedCount 0; fleet_journeys_failing falls by one.
-- Verify: GET https://qnfo-ops.q08.workers.dev/fleet -> the qnfo-fleet-lee row; GET https://qnfo-fleet-control.q08.workers.dev/journeys -> binding-census ok for cf and gha.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE service_registry SET base_url = 'https://qnfo-fleet-lee.q08.workers.dev', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE service = 'qnfo-fleet-lee';
-- spof-review: one registry value; the readers (qnfo-ops census and compat probe, qnfo-fleet-control /state registry probe, qnfo-fleet-dashboard) append /health to it.

UPDATE service_registry
   SET base_url = 'https://lee.qnfo.org/api', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE service = 'qnfo-fleet-lee' AND base_url = 'https://qnfo-fleet-lee.q08.workers.dev';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'breach-reach-journeys',
  'a worker whose workers.dev host is disabled on purpose is judged through its custom domain; the census appends /health to the registry base_url, so the base must end where the health route starts',
  'CENSUS-FLEET-LEE-HEALTH-1: service_registry.base_url of qnfo-fleet-lee set to https://lee.qnfo.org/api so the census probes /api/health (200) instead of the disabled workers.dev host (cf-1042 / timeout)',
  'qnfo-ops /fleet 2026-11-04T23:01Z: qnfo-fleet-lee healthy null, http 404, cf-1042-no-published-route; binding-census cf 22:40Z failed "no worker unhealthy" (qnfo-fleet-lee), gha 22:19Z failed "census sees every worker" (qnfo-fleet-lee); curl https://lee.qnfo.org/api/health = 200 {"ok":true}, /health = 404; deploy-drift-guard.py UNMANAGED_HEALTH_URLS names the same URL',
  'applied by migration', 'one service_registry row; no code, no binding, no cron',
  'the Rollback line puts the workers.dev base_url back',
  'the census reads the one unmanaged custom-domain worker healthy', 'fleet_journeys_failing <= 2 within 3 h', 'none',
  'curl lee.qnfo.org/api/health; d1:service_registry; qnfo-ops /fleet; qnfo-fleet-control /journeys'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'CENSUS-FLEET-LEE-HEALTH-1:%');
