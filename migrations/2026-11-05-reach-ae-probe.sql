-- REACH-AE-1 (2026-11-05, charter pillar reach; GitHub QNFO/qnfo-workers#5727; agent_issues 1000699 ROADMAP-1 QNFO.REACH #1): the closing probe of the first-party reach stream, and the doer for its writer half.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_reach_ae_probe
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_reach_ae_probe b WHERE b.k = 'issue-1000699'), action = (SELECT b.action FROM bak_20261105_reach_ae_probe b WHERE b.k = 'issue-1000699'), module = (SELECT b.module FROM bak_20261105_reach_ae_probe b WHERE b.k = 'issue-1000699') WHERE class = 'issue-1000699' AND EXISTS (SELECT 1 FROM bak_20261105_reach_ae_probe b WHERE b.k = 'issue-1000699'); DELETE FROM agent_issues WHERE title LIKE 'REACH-AE-1b:%' AND status = 'open';
-- CAUSE-MAPPED: no metric is registered here; this edits one existing probe row and files one issue.
--
-- Why the old probe cannot be the measure: it counted analytics_ae_events rows with source reach, gateway, hub or pageview in the last 7 days. That table holds 12 rows, the last
-- on 2026-09-05, written only by qnfo-analytics, which is RETIRED; nothing in the fleet writes it, so the probe could never read the stream the issue asks for. The Workers
-- Analytics Engine datasets on the account are qnfo_fleet (qnfo-observability's own fleet pings, 23,717 rows on 2026-11-04, none per page) and qnfo_ops (18 rows, last 2026-09-11);
-- there is no per-page reach event anywhere. pageviews_30d and referral_30d are measured, from CF Web Analytics (cf-rum, cf-rum-human) and GA4 rows in reach_signals, but through
-- a JavaScript beacon, not from our own edge.
--
-- What this change builds (the issue's lever: write dataset events from the fetch handlers, read back through the SQL API in a collector):
--   * qnfo-infra 1.12.0 (this PR): the read-back. Hourly, it sums the last two days of dataset qnfo_reach through the Analytics Engine SQL API and upserts day-level rows into
--     reach_signals (source reach-ae, channel web, metric pageloads, entity types host, referrer and page; quality unknown, because automation that does not declare itself is not
--     separable at the edge). It records its run or its last error in infra_state id reach_ae. The SQL API answers a dataset that does not exist yet with zero rows, so the read-back
--     is safe to deploy before the writer. The no-op recordReach stub (a write to env.REACH.put, a binding never declared) is removed.
--   * REACH-AE-1b (filed below with a doer): qnfo-gateway writes one data point per human-class HTML page load to qnfo_reach through ONE binding (REACH_AE), after the page is built and
--     never awaited. It waits on the gateway claim held by another session and on the code loop's queue, so it is a code-task, not prose.
-- The probe below is the issue's real definition of done: first-party reach rows exist and are fresh. It fails until the writer is deployed, and says why (the collector state).

CREATE TABLE IF NOT EXISTS bak_20261105_reach_ae_probe (k TEXT PRIMARY KEY, verify_probe TEXT, verify_transport TEXT, action TEXT, module TEXT, status TEXT);
INSERT OR IGNORE INTO bak_20261105_reach_ae_probe (k, verify_probe, verify_transport, action, module, status)
SELECT class, verify_probe, verify_transport, action, module, status FROM remediation_contracts WHERE class = 'issue-1000699';

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''first-party AE reach rows collected in the last 3 hours'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM reach_signals WHERE source = ''reach-ae'' AND collected_at >= datetime(''now'', ''-3 hours'')) THEN ''first-party AE reach rows collected in the last 3 hours'' ELSE ''no reach-ae rows in the last 3 hours, collector state: '' || COALESCE((SELECT substr(data, 1, 160) FROM infra_state WHERE id = ''reach_ae''), ''none'') END AS observed',
    verify_transport = 'd1-query',
    action = 'REACH-AE-1: the probe reads reach_signals rows written by the qnfo-infra read-back (1.12.0) of dataset qnfo_reach; it passes once the qnfo-gateway writer (REACH-AE-1b) is deployed and an hour has run. The old probe read analytics_ae_events, a table only the retired qnfo-analytics wrote.',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000699' AND issue_id = 1000699;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'REACH-AE-1b: qnfo-gateway writes one Analytics Engine data point per human page load (writer half of 1000699)',
'Charter pillar: reach. Serves ROADMAP-1 QNFO.REACH #1 (agent_issues 1000699, GitHub #5727): the read-back is shipped in qnfo-infra 1.12.0 and reads dataset qnfo_reach; nothing writes it yet. Metric it should move: first-party referral attribution coverage (the closing probe of 1000699 reads reach_signals source reach-ae).

Change in qnfo-gateway: add ONE Analytics Engine binding to qnfo-gateway/wrangler.toml, [[analytics_engine_datasets]] binding = "REACH_AE", dataset = "qnfo_reach" (the only binding for this dataset in the fleet; run impact on worker:qnfo-gateway first and cover what it returns). In the fetch tail of the exported handler, immediately after the UTM-CLICK-LEDGER-1 block (utmClickRow / utmRecord), add reachAeEvent(request, served) and, when it returns an event, env.REACH_AE.writeDataPoint(event) inside a try block: synchronous, never awaited, never changing the response, skipped when the binding is absent. reachAeEvent returns null unless the method is GET, the status 200, the Content-Type text/html, the host one of the reach-layer hosts (RL_HOSTS), the path is not /health, and the User-Agent is not matched by UTM_BOT_RE (declared bots are already in the seo crawl ledger). The event is { blobs: ["reach", host, path (no query, at most 200 characters), refHost, utmSource, country], doubles: [1], indexes: [host] } where refHost is the Referer hostname lower-cased, "self" when it is one of the fleet hosts, "" when absent; utmSource is utmClean(utm_source); country the two-letter cf.country. Never the IP, the User-Agent string, the full Referer or any query value. The blob positions are what qnfo-infra REACH_AE_HOST_SQL and REACH_AE_PAGE_SQL read (blob2 host, blob3 path, blob4 referrer host): change them together. Offline test with a stub binding: a human HTML 200 writes one point with those blobs; a bot, a 404, a JSON response, /health, HEAD and a missing binding write none; a throwing binding does not change the response.

Verify live: after the deploy and one hourly qnfo-infra run, the closing probe of 1000699 passes and SELECT COUNT(*) FROM reach_signals WHERE source = ''reach-ae'' is above 0.

code-task: repo=qnfo-workers path=qnfo-gateway/worker.js
code-anchor: function utmClickRow(request, res, nowMs) {
code-probe: {"paths": ["qnfo-gateway/worker.js"], "contains": "REACH_AE.writeDataPoint"}',
'reach-ae-1b', 'feature', 'high', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'REACH-AE-1b:%');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested, outcome_matched)
SELECT
  'coding-agent (F1-research-reach/B)',
  'The issue asks for a first-party per-page reach stream; the existing closing probe reads a table the retired qnfo-analytics wrote, so it measures nothing, and the gateway file is held by two other sessions, so the writer cannot be edited now.',
  'Ship the read-back (qnfo-infra 1.12.0), replace the closing probe with one on the rows the read-back writes, and file the gateway writer as a code-task with its design.',
  'Analytics Engine SQL on 2026-11-04: SHOW TABLES lists qnfo_fleet and qnfo_ops only; qnfo_ops has 18 rows (last 2026-09-11); qnfo_fleet has fleet pings, none per page; a query on the missing dataset qnfo_reach answers 0 rows without an error. analytics_ae_events holds 12 rows, last 2026-09-05. qnfo-analytics is RETIRED.',
  'probe replaced; read-back deployed with the PR; writer filed',
  'one remediation_contracts row, one new issue, qnfo-infra hourly fire (one extra SQL call and at most 1500 reach_signals upserts)',
  'Restore the contract row from bak_20261105_reach_ae_probe (the Rollback line); the read-back is reverted by reverting the qnfo-infra release; the decision_log is append-only.',
  'reach-ae-readback',
  'Once REACH-AE-1b is deployed and one hourly run has passed, reach_signals source reach-ae gains rows every hour and the closing probe passes; referral attribution can then be compared with cf-rum-human and ga4.',
  'No audience reach increase is claimed; this makes first-party attribution measurable.',
  'Analytics Engine SQL API; qnfo-audit reach_signals, analytics_ae_events and remediation_contracts',
  NULL
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE capability_gain = 'reach-ae-readback');
