-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_sla_graph_fm_1
-- Rollback: DROP VIEW IF EXISTS v_content_pipeline; DROP VIEW IF EXISTS v_failure_mode_status; then re-create both from the 'view' rows of bak_20261105_sla_graph_fm_1 (its v column is the CREATE VIEW text read live on 2026-11-05); restore the two probes with UPDATE remediation_contracts SET verify_probe = (SELECT v FROM bak_20261105_sla_graph_fm_1 WHERE kind = 'probe' AND k = remediation_contracts.class) WHERE class IN ('fm-sla-metric-overlap', 'fm-view-alias-capture'); put the six failure_modes.probe_class values back from the 'fm' rows, set the three fm-suite-clock-baseline / fm-suite-clock-same-ms / fm-watchdog-green-on-wrong-ref contracts back to status 'holding', DELETE FROM remediation_contracts WHERE class IN ('fm-neuron-attribution-gap', 'fm-catalog-status-contradicts-use', 'fm-decision-model-called-as-chat', 'fm-diagnosis-raw-markup', 'fm-diagnosis-unresolved-anchor', 'fm-close-no-dwell'); DELETE FROM metric_breach_cause WHERE metric_key IN ('domain_manager_briefs', 'blindspots_open', 'site_ux_score_min', 'staff_roles_acting_24h', 'broken_views') AND note LIKE 'SLA-GRAPH-FM-1%'; restore metric_registry.formula of content_items_over_stage_sla and failure_modes_recurring from the 'metric' rows.
--
-- SLA-GRAPH-FM-1 (2026-11-05, charter pillar autonomy; cluster sla-graph-fm of the fleet breach audit).
-- Metrics: content_items_over_stage_sla 1673 (target 0), sla_breaches_over_120m 1889 (trigger 565), failure_modes_recurring 208 (target 0).
--
-- WHAT WAS READ (qnfo-audit, 2026-11-04 22:30-23:20Z, before this file)
--   content_items_over_stage_sla by flow, state and status (over 120 minutes):
--     research deferred 1329 + 73 + 1 (stage queued, state waiting)     the RESEARCH-BACKPRESSURE-1 pool: rows the ready queue has not admitted, aged up to 160 hours
--     research merged 91 (state active)                                  RESEARCH-SYNTH-1 and RESEARCH-SYNTH-2 set status 'merged' on a duplicate that was folded into a
--                                                                        survivor (or on a dissolved synthesis row): the row is finished and nothing reads it again
--     idea deferred_diversity 73, errata audited 11 + internal-blocked 4, idea new 5, research queued/ground 81 + 2   real waits, untouched here
--   Defect 1, the deferred pool is measured twice and from the wrong clock. migrations/2026-10-13-02-research-backpressure.sql made the pool
--     visible and bounded on purpose (research_ready_cap, released by priority as slots free), measured its wait "from readiness" (research_ready.ready_at,
--     which v_content_pipeline already uses for status queued) and gave it its own metric, research_deferred_pool (trigger 5394, 1378 now). v_content_pipeline
--     maps status deferred to state waiting with the row's created_at as its clock, so 1,403 rows count as past a 120 minute stage SLA for the whole time they sit
--     in a pool whose admission rate is the throughput limit, and again under research_deferred_pool. The pool is not hidden by this file: research_deferred_pool
--     and its trigger are unchanged and remain the owner of that backlog.
--   Defect 2, finished rows counted as stuck (the CONTENT-PIPELINE-SLA-1 defect again). status 'merged' fell into the view's ELSE 'active'.
--   Defect 3, failure_modes_recurring counts 129 detectors as "has not run in 60 minutes" that run exactly as designed. remediation_consumer.py steady_state_cadence
--     (FM-5, cost) re-probes a contract whose last six verifications passed with the same observed value every 2 hours (next_due_at = last attempt + 105 minutes), and
--     the consumer starts about hourly, so such a detector is probed every 2 hours; v_failure_mode_status flagged it unprobed after 60 minutes. Read: 129 unprobed,
--     120 of them last verified 21:12-21:16Z with next_due_at 22:57-23:01Z (105 minutes), the 22:xx batch absent. The two definitions disagree and the stricter one cannot be met.
--   Defect 4, nine failure modes never had a running detector. Six carry probe_class 'd1-query' (a transport, not a contract class: decision-model-called-as-chat,
--     neuron-attribution-gap, catalog-status-contradicts-use from MODEL-MATRIX-1, and diagnosis-raw-markup, diagnosis-unresolved-anchor, close-no-dwell whose probes sit in
--     issue-contracts the consumer does not run as detectors). Three have a code-read contract left in status 'holding' with attempts 0 (suite-clock-baseline,
--     suite-clock-same-ms, watchdog-green-on-wrong-ref); the consumer selects 'active' contracts only. fm-detector-contract-not-armed reads 9, the same nine.
--   Defect 5, two detectors still measure the issue population the SLA no longer uses. 2026-11-01-issue-sla-scope.sql moved issues_open_over_120m to
--     v_sla_bound_issue_age (153 issues) while fm-sla-metric-overlap and fm-view-alias-capture still counted v_issue_age (about 480): the first reads -325, the second
--     reads 0 for a figure that is consistent. Both probes, with v_sla_bound_issue_age, read 0 and 1 live.
--   Defect 6, five metrics authored 2026-11-04 carry a "-- CAUSE-MAPPED" comment but no metric_breach_cause row: fm-metric-cause-registration-missing reads 5.
--
-- WHAT THIS FILE DOES
--   1. v_content_pipeline is re-created with the same columns in the same order. Research status deferred maps to state parked (the vocabulary the view already
--      uses for a deliberate hold; parked is outside the SLA states), status merged maps to rejected like wontfix. Nothing else changes (the live text was read
--      from sqlite_master). The over-SLA populations that remain are real waits.
--   2. v_failure_mode_status is re-created with the same columns. A detector is unprobed when it has no verification, or its newest one is older than its window:
--      120 minutes when its last attempt produced a verdict (SLA-120M-1: no SLA over 120 minutes), 180 minutes when its own schedule is the FM-5 steady state
--      (next_due_at at least 90 minutes after the last attempt: 105 minutes plus the hourly consumer start), 60 minutes (unchanged) when the last attempt produced
--      no verdict (probe-error, deferred, vacuous): that detector is not judging anything. A stalled consumer is still seen within 3 hours.
--   3. The two stale probes follow v_sla_bound_issue_age.
--   4. The nine unarmed detectors are armed: the three holding contracts become active, six contracts are created (three from the failure_modes detector text, three
--      copies of the issue probes) and their failure_modes.probe_class points at them. They read their real state from the first run; three of them are live defects
--      today (6 models with calls and 0 neurons, 1 rejected model in use, 1 decision model failing every call) and stay counted as recurring until MODEL-MATRIX-1 lands.
--   5. The five metric_breach_cause rows. 6. Metric formula text, a decision_log row and scored predictions.
--
-- WHAT IT DOES NOT DO (INTEGRITY-GUARDS-1)
--   No threshold, trigger, cap, guard or probe is removed or loosened beyond item 2 above; research_deferred_pool (1378 against 120) keeps breaching and keeps its issue.
--   No row is deleted. Prediction (logged below): content_items_over_stage_sla falls from about 1,600 to about 190 and sla_breaches_over_120m from about 1,800 to about 400 at
--   the first 10-minute tick (a change in what is counted, not remediation: the deferred pool is still 1378); failure_modes_recurring from 208-215 to about 85 (the
--   73 recurring detectors are live defects owned elsewhere); fm-sla-metric-overlap, fm-view-alias-capture and fm-detector-contract-not-armed read their expected value.
-- spof-review: no new cron, binding or credential. Two views replaced, probe texts and contract rows, five cause rows.

-- 0. Backup of what this file replaces (BACKUP-CREATES-1).
CREATE TABLE IF NOT EXISTS bak_20261105_sla_graph_fm_1 AS
  SELECT 'view' AS kind, name AS k, sql AS v FROM sqlite_master WHERE name IN ('v_content_pipeline', 'v_failure_mode_status')
  UNION ALL SELECT 'probe', class, verify_probe FROM remediation_contracts WHERE class IN ('fm-sla-metric-overlap', 'fm-view-alias-capture')
  UNION ALL SELECT 'fm', fm_key, probe_class FROM failure_modes WHERE fm_key IN ('decision-model-called-as-chat', 'neuron-attribution-gap', 'catalog-status-contradicts-use', 'diagnosis-raw-markup', 'diagnosis-unresolved-anchor', 'close-no-dwell')
  UNION ALL SELECT 'contract', class, status FROM remediation_contracts WHERE class IN ('fm-suite-clock-baseline', 'fm-suite-clock-same-ms', 'fm-watchdog-green-on-wrong-ref')
  UNION ALL SELECT 'metric', metric, formula FROM metric_registry WHERE metric IN ('content_items_over_stage_sla', 'failure_modes_recurring');

-- 1. v_content_pipeline: deferred is a pool (parked), merged is finished (rejected).
DROP VIEW IF EXISTS v_content_pipeline;
CREATE VIEW v_content_pipeline AS
SELECT p.property, p.flow, p.item_id, p.title, p.raw_status, p.stage, p.state,
  strftime('%Y-%m-%dT%H:%M:%SZ', COALESCE((SELECT MAX(e.ts) FROM content_stage_events e WHERE e.flow = p.flow AND e.item_id = p.item_id), p.since_fallback)) AS since,
  ROUND((julianday('now') - julianday(COALESCE((SELECT MAX(e.ts) FROM content_stage_events e WHERE e.flow = p.flow AND e.item_id = p.item_id), p.since_fallback))) * 24, 1) AS age_h,
  s.sla_min,
  CASE WHEN p.state IN ('waiting', 'active', 'held', 'blocked') AND s.sla_min IS NOT NULL
        AND (julianday('now') - julianday(COALESCE((SELECT MAX(e.ts) FROM content_stage_events e WHERE e.flow = p.flow AND e.item_id = p.item_id), p.since_fallback))) * 1440 > s.sla_min
       THEN 1 ELSE 0 END AS over_sla
FROM (
  SELECT * FROM (
    SELECT 'papers.qnfo.org' AS property, 'research' AS flow, CAST(q.id AS TEXT) AS item_id, substr(COALESCE(q.idea, q.paper_slug, q.id), 1, 160) AS title,
      q.status || CASE WHEN q.stage IS NULL THEN '' ELSE '/' || q.stage END AS raw_status,
      CASE WHEN q.status = 'published' THEN 'published'
           WHEN q.status IN ('wontfix', 'merged') OR q.stage = 'parked' THEN 'rejected'
           WHEN q.status IN ('queued', 'deferred') AND q.claimed_at IS NULL AND COALESCE(q.stage, 'ground') = 'ground' THEN 'queued'
           WHEN COALESCE(q.stage, 'ground') = 'ground' THEN 'research'
           WHEN q.stage IN ('ensemble', 'reconcile', 'complete') THEN 'draft'
           WHEN q.stage IN ('review', 'verify', 'gate') THEN 'review'
           WHEN q.stage = 'revise' THEN 'revise'
           WHEN q.stage IN ('publish', 'done') THEN 'publish'
           ELSE 'research' END AS stage,
      CASE WHEN q.status = 'published' THEN 'done'
           WHEN q.status IN ('wontfix', 'merged') OR q.stage = 'parked' THEN 'rejected'
           WHEN q.status = 'held' THEN 'held'
           WHEN q.status IN ('failed', 'error', 'gate-blocked') THEN 'blocked'
           WHEN q.status = 'deferred' THEN 'parked'
           WHEN q.status = 'queued' THEN 'waiting'
           ELSE 'active' END AS state,
      CASE WHEN q.status = 'published' THEN COALESCE(q.published_at, q.completed_at, q.created_at)
           WHEN q.status = 'queued' THEN COALESCE((SELECT r.ready_at FROM research_ready r WHERE r.id = q.id), q.created_at)
           ELSE COALESCE(q.claimed_at, q.created_at) END AS since_fallback
    FROM research_queue q
    UNION ALL
    SELECT 'idea-hub', 'idea', CAST(i.id AS TEXT),
      CASE WHEN i.name LIKE 'auto-%' OR i.name LIKE 'intake:%' OR i.name = 'think-loop' THEN substr(COALESCE(i.idea, ''), 1, 160)
           ELSE '(' || COALESCE(NULLIF(i.name, ''), 'submitted') || ' idea ' || i.id || ')' END, i.status,
      CASE WHEN i.status IN ('new') THEN 'intake' WHEN i.status = 'rejected' THEN 'rejected' ELSE 'triage' END,
      CASE WHEN i.status = 'new' THEN 'waiting'
           WHEN i.status IN ('deferred_budget', 'deferred_diversity') THEN 'held'
           WHEN i.status = 'triaged_hold' THEN 'parked'
           WHEN i.status IN ('triaged_accepted', 'ensemble-registered') THEN 'done'
           WHEN i.status = 'rejected' THEN 'rejected'
           ELSE 'waiting' END,
      COALESCE(i.triaged_at, i.created_at)
    FROM idea_proposals i
    UNION ALL
    SELECT 'papers.qnfo.org', 'version', CAST(v.id AS TEXT), substr(COALESCE(v.title, v.slug, ''), 1, 160), v.status,
      CASE WHEN v.status = 'queued' THEN 'revise' WHEN v.status IN ('drafted', 'gate-blocked') THEN 'review' WHEN v.status = 'publishing' THEN 'publish'
           WHEN v.status = 'published' THEN 'published' WHEN v.status = 'wontfix' THEN 'rejected' ELSE 'revise' END,
      CASE WHEN v.status = 'queued' THEN 'waiting' WHEN v.status IN ('drafted', 'publishing') THEN 'active' WHEN v.status IN ('gate-blocked', 'error') THEN 'blocked'
           WHEN v.status = 'published' THEN 'done' WHEN v.status = 'wontfix' THEN 'rejected' ELSE 'waiting' END,
      COALESCE(v.updated_at, v.created_at)
    FROM version_queue v
  )
  UNION ALL
  SELECT * FROM (
    SELECT 'papers.qnfo.org', 'revision', CAST(r.id AS TEXT), substr(COALESCE(r.title, r.slug, ''), 1, 160), r.status,
      CASE WHEN r.status IN ('already-revised', 'published', 'claim-corrected', 'claim-withdrawn', 'integrity-restored') THEN 'published' WHEN r.status IN ('wontfix', 'claim-retracted', 'thin-prior-work-rejected', 'thin-prior-work-skipped') THEN 'rejected' WHEN r.status = 'quarantined' THEN 'review' ELSE 'revise' END,
      CASE WHEN r.status IN ('already-revised', 'published', 'claim-corrected', 'claim-withdrawn', 'integrity-restored') THEN 'done' WHEN r.status IN ('wontfix', 'claim-retracted', 'thin-prior-work-rejected', 'thin-prior-work-skipped') THEN 'rejected'
           WHEN r.status IN ('needs-substantive-revision', 'quarantined', 'loop-revision-queued', 'thin-prior-work-queued', 'flagged') THEN 'parked' ELSE 'waiting' END,
      COALESCE(r.updated_at, r.created_at)
    FROM paper_revision_log r
    UNION ALL
    SELECT 'papers.qnfo.org', 'errata', CAST(x.id AS TEXT), substr(COALESCE(x.subject, x.claim, ''), 1, 160), x.status,
      CASE WHEN x.status IN ('rejected', 'no-paper') THEN 'rejected' ELSE 'correct' END,
      CASE WHEN x.status IN ('published', 'resolved', 'implemented', 'closed') THEN 'done' WHEN x.status IN ('rejected', 'no-paper') THEN 'rejected'
           WHEN x.status = 'error' THEN 'blocked' WHEN x.status = 'audited' THEN 'active' ELSE 'waiting' END,
      COALESCE(x.updated_at, x.created_at)
    FROM errata_queue x
    UNION ALL
    SELECT 'papers.qnfo.org', 'internal-errata', CAST(n.id AS TEXT), substr(COALESCE(n.claim_text, n.target_ref, ''), 1, 160), n.status,
      CASE WHEN n.status = 'rejected' THEN 'rejected' ELSE 'correct' END,
      CASE WHEN n.status IN ('resolved', 'closed') THEN 'done' WHEN n.status = 'rejected' THEN 'rejected' ELSE 'waiting' END,
      COALESCE(n.updated_at, n.detected_at)
    FROM internal_errata n
    WHERE NOT EXISTS (SELECT 1 FROM errata_queue q WHERE q.subject = n.id)
  )
  UNION ALL
  SELECT * FROM (
    SELECT 'social', 'social-thread', CAST(t.id AS TEXT), substr(COALESCE(t.title, t.slug, ''), 1, 160), t.status,
      CASE WHEN t.status IN ('rejected', 'suppressed') THEN 'rejected' ELSE 'distribute' END,
      CASE WHEN t.status = 'posted' THEN 'done' WHEN t.status IN ('rejected', 'suppressed') THEN 'rejected'
           WHEN t.status IN ('failed', 'link-dead', 'misrouted') THEN 'blocked' WHEN t.status = 'posting' THEN 'active' ELSE 'waiting' END,
      CASE WHEN t.status = 'posted' THEN COALESCE(t.posted_at, t.updated_at, t.created_at) ELSE COALESCE(t.updated_at, t.created_at) END
    FROM social_threads t
    UNION ALL
    SELECT 'social', 'dissemination', CAST(d.id AS TEXT), substr(COALESCE(d.channel || ': ', '') || COALESCE(d.paper_title, d.paper_slug, ''), 1, 160), d.action,
      CASE WHEN d.action IN ('suppressed', 'link-dead', 'misrouted') THEN 'rejected' ELSE 'distribute' END,
      CASE WHEN d.action IN ('posted', 'done') THEN 'done' WHEN d.action IN ('suppressed', 'link-dead', 'misrouted') THEN 'rejected'
           WHEN d.action = 'post-unverified' THEN 'parked' WHEN d.action IN ('failed', 'held') THEN 'blocked' WHEN d.action = 'posting' THEN 'active' ELSE 'waiting' END,
      CASE WHEN d.action IN ('posted', 'done') THEN COALESCE(d.posted_at, d.updated_at, d.created_at) ELSE d.created_at END
    FROM dissemination_tracker d
  )
) p
LEFT JOIN content_stages s ON s.stage = p.stage;

-- 2. v_failure_mode_status: the freshness window follows the detector's own schedule (see the header, Defect 3).
DROP VIEW IF EXISTS v_failure_mode_status;
CREATE VIEW v_failure_mode_status AS
SELECT f.fm_key, f.failure_mode, f.probe_class,
  (SELECT MAX(v.verified_at) FROM remediation_verifications v WHERE v.class = f.probe_class) AS last_probed,
  CASE
    WHEN f.probe_class IS NULL THEN 'ci-guarded'
    WHEN (SELECT MAX(v.verified_at) FROM remediation_verifications v WHERE v.class = f.probe_class) IS NULL
      OR (SELECT MAX(v.verified_at) FROM remediation_verifications v WHERE v.class = f.probe_class) < datetime('now', '-' || COALESCE((SELECT CASE
           WHEN c.last_verdict IS NULL OR c.last_verdict NOT IN ('pass', 'fail') THEN 60
           WHEN c.next_due_at IS NOT NULL AND c.last_attempt_at IS NOT NULL AND (julianday(c.next_due_at) - julianday(c.last_attempt_at)) * 1440 >= 90 THEN 180
           ELSE 120 END FROM remediation_contracts c WHERE c.class = f.probe_class), 60) || ' minutes') THEN 'unprobed'
    WHEN (SELECT v.pass FROM remediation_verifications v WHERE v.class = f.probe_class ORDER BY v.id DESC LIMIT 1) = 1 THEN 'absent'
    ELSE 'recurring'
  END AS status
FROM failure_modes f;

-- 3. The two probes that still counted the pre-scope issue population (Defect 5).
UPDATE remediation_contracts
SET verify_probe = replace(verify_probe, 'SELECT ''i'' || id AS k FROM v_issue_age WHERE age_min > 120', 'SELECT ''i'' || id AS k FROM v_sla_bound_issue_age'),
    last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'fm-sla-metric-overlap' AND instr(verify_probe, 'FROM v_issue_age WHERE age_min > 120') > 0;
UPDATE remediation_contracts
SET verify_probe = replace(verify_probe, 'issues_open_over_120m = (SELECT COUNT(*) FROM v_issue_age WHERE age_min > 120)', 'issues_open_over_120m = (SELECT COUNT(*) FROM v_sla_bound_issue_age)'),
    last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'fm-view-alias-capture' AND instr(verify_probe, 'issues_open_over_120m = (SELECT COUNT(*) FROM v_issue_age WHERE age_min > 120)') > 0;

-- 4. Arm the nine unarmed detectors (Defect 4).
UPDATE remediation_contracts SET status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class IN ('fm-suite-clock-baseline', 'fm-suite-clock-same-ms', 'fm-watchdog-green-on-wrong-ref') AND status = 'holding';

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
  escalate_to, expected_cadence_h, status, ts, module, budget_ms, max_items, requires_container, attempts, next_due_at) VALUES
('fm-neuron-attribution-gap', NULL, 'MODEL-MATRIX-1 failure mode neuron-attribution-gap', 'failure-mode detector',
 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM (SELECT model FROM ai_call_counters WHERE day >= date(''now'', ''-7 days'') GROUP BY model HAVING SUM(calls) > 100 AND SUM(neurons) = 0)) AS TEXT) AS observed',
 'd1-query', 3, 'qnfo-fleet-control', 1, 'active', datetime('now'), 'failure-mode', 45000, 5, 0, 0, datetime('now')),
('fm-catalog-status-contradicts-use', NULL, 'MODEL-MATRIX-1 failure mode catalog-status-contradicts-use', 'failure-mode detector',
 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM cf_model_catalog c WHERE c.status = ''rejected'' AND EXISTS (SELECT 1 FROM ai_call_counters a WHERE a.day >= date(''now'', ''-7 days'') AND a.calls > 0 AND (a.model = c.model_id OR a.model = c.slug OR ''@cf/'' || a.model = c.model_id))) AS TEXT) AS observed',
 'd1-query', 3, 'qnfo-fleet-control', 1, 'active', datetime('now'), 'failure-mode', 45000, 5, 0, 0, datetime('now')),
('fm-decision-model-called-as-chat', NULL, 'MODEL-MATRIX-1 failure mode decision-model-called-as-chat', 'failure-mode detector',
 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM (SELECT model FROM ai_call_counters WHERE day >= date(''now'', ''-7 days'') AND model LIKE ''%jev%'' GROUP BY model HAVING SUM(calls) > 0 AND SUM(errors) >= SUM(calls))) AS TEXT) AS observed',
 'd1-query', 3, 'qnfo-fleet-control', 1, 'active', datetime('now'), 'failure-mode', 45000, 5, 0, 0, datetime('now'));

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
  escalate_to, expected_cadence_h, status, ts, module, budget_ms, max_items, requires_container, attempts, next_due_at)
SELECT 'fm-diagnosis-raw-markup', NULL, 'even-keel FM-1 (agent_issues 1000717)', 'failure-mode detector', verify_probe, verify_transport, 3, 'qnfo-fleet-control', 1, 'active', datetime('now'), 'failure-mode', 45000, 5, 0, 0, datetime('now')
FROM remediation_contracts WHERE class = 'issue-1000717' AND verify_transport = 'd1-query';
INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
  escalate_to, expected_cadence_h, status, ts, module, budget_ms, max_items, requires_container, attempts, next_due_at)
SELECT 'fm-diagnosis-unresolved-anchor', NULL, 'even-keel FM-2 (agent_issues 1000718)', 'failure-mode detector', verify_probe, verify_transport, 3, 'qnfo-fleet-control', 1, 'active', datetime('now'), 'failure-mode', 45000, 5, 0, 0, datetime('now')
FROM remediation_contracts WHERE class = 'issue-1000718' AND verify_transport = 'd1-query';
INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
  escalate_to, expected_cadence_h, status, ts, module, budget_ms, max_items, requires_container, attempts, next_due_at)
SELECT 'fm-close-no-dwell', NULL, 'even-keel FM-3 (agent_issues 1000719)', 'failure-mode detector', verify_probe, verify_transport, 3, 'qnfo-fleet-control', 1, 'active', datetime('now'), 'failure-mode', 45000, 5, 0, 0, datetime('now')
FROM remediation_contracts WHERE class = 'issue-1000719' AND verify_transport = 'd1-query';

UPDATE failure_modes SET probe_class = 'fm-' || fm_key
WHERE fm_key IN ('decision-model-called-as-chat', 'neuron-attribution-gap', 'catalog-status-contradicts-use', 'diagnosis-raw-markup', 'diagnosis-unresolved-anchor', 'close-no-dwell')
  AND probe_class = 'd1-query'
  AND EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.class = 'fm-' || failure_modes.fm_key AND c.status = 'active');

-- 5. Cause rows for the five metrics authored without one (Defect 6). Vocabulary: the keys metric_breach_cause already uses.
INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
 ('domain_manager_briefs', 'heartbeat', 'SLA-GRAPH-FM-1: fewer manager and product briefs in the latest tick means the domain-managers task stopped producing; the lever is its run (fleet_runs), not a budget'),
 ('blindspots_open', 'issue-backlog', 'SLA-GRAPH-FM-1: open BLINDSPOT-1 issues are a backlog of unowned findings; the lever is a doer on each, read in v_issue_queue'),
 ('site_ux_score_min', 'publishing', 'SLA-GRAPH-FM-1: the lowest site UX check score of an active product host; the lever is the page that scored lowest in site_ux_checks'),
 ('staff_roles_acting_24h', 'heartbeat', 'SLA-GRAPH-FM-1: personas with a persona_actions row in 24 hours; a fall means the staff-roster task or the persona runs stopped'),
 ('broken_views', 'structure', 'SLA-GRAPH-FM-1: a qnfo-audit view whose EXPLAIN fails; the lever is the view definition named by view_health, fixed by migration');

-- 6. What each metric counts now, so the step down is not read as remediation.
UPDATE metric_registry SET formula = formula || ' SLA-GRAPH-FM-1 (2026-11-05): research rows in status deferred (the RESEARCH-BACKPRESSURE-1 pool, measured by research_deferred_pool) are state parked, and status merged (RESEARCH-SYNTH-1/2 folded duplicates) is rejected, so neither counts as a stage wait; about 1,500 rows left the count at the first tick.'
WHERE metric = 'content_items_over_stage_sla' AND instr(formula, 'SLA-GRAPH-FM-1') = 0;
UPDATE metric_registry SET formula = formula || ' SLA-GRAPH-FM-1 (2026-11-05): a detector is unprobed after 120 minutes since its newest verification (180 when its schedule is the FM-5 steady state of 105 minutes, 60 when its last attempt produced no verdict), no longer a flat 60 minutes that the steady-state schedule could not meet.'
WHERE metric = 'failure_modes_recurring' AND instr(formula, 'SLA-GRAPH-FM-1') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-sla-graph-fm', 'a stage SLA counts waits the executor owes; a pool that backpressure holds on purpose and a row that was folded into another are not waits, and a detector must be judged by the schedule it actually runs on',
  'SLA-GRAPH-FM-1: v_content_pipeline maps research deferred to parked and merged to rejected; v_failure_mode_status uses a 120/180/60 minute window by schedule; fm-sla-metric-overlap and fm-view-alias-capture follow v_sla_bound_issue_age; nine unarmed failure-mode detectors armed; five metric_breach_cause rows',
  'read 2026-11-04 22:30-23:20Z: content_items_over_stage_sla by status: deferred 1403, merged 91, idea deferred_diversity 73, errata 15, idea new 5, research queued 83; failure modes: 129 unprobed (120 of them in FM-5 steady state, next_due_at 105 minutes after the last probe), 79 recurring, 9 never armed; fm-sla-metric-overlap -325 against v_issue_age 480 vs v_sla_bound_issue_age 153',
  'migration merged', 'two views replaced, two probe texts, nine detector contracts, five cause rows, two formula texts',
  'see the Rollback header and bak_20261105_sla_graph_fm_1',
  'a stage SLA breach lists only real waits; a detector that stalls for 3 hours shows as unprobed; every failure mode has a running detector',
  'content_items_over_stage_sla about 1,600 to about 190; sla_breaches_over_120m about 1,800 to about 400; failure_modes_recurring 208-215 to about 85; research_deferred_pool unchanged at about 1,380',
  'the breach list the 10-minute escalation acts on names the queues that are slow, not a pool that is bounded on purpose',
  'd1:qnfo-audit v_content_pipeline, v_failure_mode_status, v_sla_over_120m, remediation_contracts, failure_modes, metric_breach_cause'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE instr(action, 'SLA-GRAPH-FM-1:') = 1);

INSERT OR IGNORE INTO decision_predictions (decision_id, kind, subject, op, value, due_at, origin)
SELECT d.id, 'metric', p.subject, p.op, p.value, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', p.due), 'seeded'
FROM decision_log d JOIN (
  SELECT 'content_items_over_stage_sla' AS subject, '<=' AS op, 400 AS value, '+3 hours' AS due
  UNION ALL SELECT 'sla_breaches_over_120m', '<=', 565, '+3 hours'
  UNION ALL SELECT 'failure_modes_recurring', '<=', 120, '+6 hours'
) p ON instr(d.action, 'SLA-GRAPH-FM-1:') = 1;
