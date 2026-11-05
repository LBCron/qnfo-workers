-- KAIZEN-SCHEDULED-1 (2026-11-05, charter pillar: autonomy; roadmap row RM-KAIZEN-SCHEDULED-1, qnfo-audit.roadmap_implementation id 63).
-- Eleven kaizen_candidates rows read "scheduled" since 2026-09-04/08 (DISP-2026-09-08 registered them as work, none was ever closed). Each was re-read on 2026-11-05 against main and live D1:
--   shipped earlier   errata publish flip (qnfo-research-exec publishAction), errata-publish source in the repo, outreach cap status (OUTREACH-CAP-STATUS-1), the revision wave (REVISION-LOOP-1)
--   done by a sibling probe coverage (RM-PROBE-VERIFIED-COVERAGE-1, PR 7306: 36 of 36 live workers declare probes.json, allowlist empty)
--   moot or superseded  blank-audit alert cluster and the recurring C4 finding (qnfo-blank-audit, audit-hub and qnfo-auditor are RETIRED), per-record lifecycle scanner (REVISION-LOOP-1 and
--                     PAPER-LEDGER-1), risk-tiered kaizen auto-apply (every producer of kaizen_candidates is retired), weekly drift repair off the local cron (fleet-autoaudit and deployDriftCf run in the cloud)
--   still open        router quality weighting: routing already drops failing and degraded models from measured health, the graded step is filed with its doer (RM-KAIZEN-SCHEDULED-1.1)
-- Found while reading: contentSignalAudit (qnfo-fleet-control) re-files one failure-mode improvement every hour (170 rows with status queued since 2026-09-29): its dedupe misses the status queued
-- that the row reaches 43 minutes after filing. Filed with its doer (RM-KAIZEN-SCHEDULED-1.2); qnfo-fleet-control/worker.js was under another session claim (D1-observability) while this was written.
-- PREDICTION (decision_log): kaizen_candidates rows left scheduled 11 to 0 (10 resolved, 1 promoted); fleet_improvements rows filed per hour for the content-signal title 1 to 0 once the fix lands.
-- Falsifier: a resolved row whose cited enforcer is gone (the evidence names each so it can be re-read). Revert: the Rollback line restores status and evidence from bak_20261105_kaizen_scheduled.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_kaizen_scheduled
-- Rollback: UPDATE kaizen_candidates SET status = (SELECT b.status FROM bak_20261105_kaizen_scheduled b WHERE b.tbl = 'kaizen_candidates' AND b.rid = kaizen_candidates.rowid), evidence = (SELECT b.evidence FROM bak_20261105_kaizen_scheduled b WHERE b.tbl = 'kaizen_candidates' AND b.rid = kaizen_candidates.rowid) WHERE rowid IN (SELECT rid FROM bak_20261105_kaizen_scheduled WHERE tbl = 'kaizen_candidates'); UPDATE roadmap_implementation SET status = (SELECT b.status FROM bak_20261105_kaizen_scheduled b WHERE b.tbl = 'roadmap_implementation' AND b.rid = roadmap_implementation.id), evidence = (SELECT b.evidence FROM bak_20261105_kaizen_scheduled b WHERE b.tbl = 'roadmap_implementation' AND b.rid = roadmap_implementation.id) WHERE id IN (SELECT rid FROM bak_20261105_kaizen_scheduled WHERE tbl = 'roadmap_implementation');
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261105_kaizen_scheduled AS
SELECT 'kaizen_candidates' AS tbl, rowid AS rid, status, evidence FROM kaizen_candidates WHERE status = 'scheduled'
UNION ALL
SELECT 'roadmap_implementation', id, status, evidence FROM roadmap_implementation WHERE id = 63;

-- the two doers first, so the dispositions can name them
INSERT INTO agent_issues (title, description, source, category, priority, status)
SELECT 'ROADMAP-1: QNFO.OPS RM-KAIZEN-SCHEDULED-1.1: ROUTER-QUALITY-WEIGHT-1 route among healthy models by their measured error share, not uniformly',
 'code-task: repo=qnfo-workers path=qnfo-ai/worker.js
code-anchor: function autoRoute(cls, prompt, health) {
code-probe: {"paths": ["qnfo-ai/worker.js"], "contains": "ROUTER-QUALITY-WEIGHT-1"}
Charter pillar: cost (quality per dollar). Roadmap row RM-KAIZEN-SCHEDULED-1, kaizen candidate kc-20260904-router-selfopt. Read 2026-11-05: routing already uses measured health in a binary way: loadModelHealth reads ai_model_health (23 ok, 1 failing, updated 2026-11-05T00:00Z, fed by ai-health-prober and qnfo-ai-calibration) and autoRoute drops a failing or degraded model from its pool, then picks uniformly (seededPick) among the rest. What is missing is the graded step: a healthy model that fails or returns blank answers often is as likely to be picked as a clean one.
Slice: in loadModelHealth, after the ai_model_health read, read the last day of per-model calls and errors for qnfo-ai (ai_call_counters, or the per-model error counts in ai_queries; use the source that counts every routed call) and set status degraded on a model that has at least 50 calls and an error share of 0.3 or more; autoRoute already drops degraded models and falls back to the base pool when the pool empties. Mark the block ROUTER-QUALITY-WEIGHT-1. Keep the cache of 60 s. Test: a fixture with one noisy model in a pool is never picked while two clean ones remain, and a pool of only noisy models still answers.
Prediction: the 24 h error share of auto-routed calls falls by at least a quarter within 7 days of the deploy; guard: spend per call does not rise. Revert: remove the block.
Closing probe: the marker ROUTER-QUALITY-WEIGHT-1 is in qnfo-ai/worker.js (code-probe above).',
 'session:c4-kaizen', 'reliability', 'medium', 'open'
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND instr(title, 'RM-KAIZEN-SCHEDULED-1.1:') > 0);

INSERT INTO agent_issues (title, description, source, category, priority, status)
SELECT 'ROADMAP-1: QNFO.OPS RM-KAIZEN-SCHEDULED-1.2: contentSignalAudit re-files the same failure-mode improvement every hour (dedupe misses status queued)',
 'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js
code-anchor: async function contentSignalAudit(env) {
code-probe: {"paths": ["qnfo-fleet-control/worker.js"], "absent": "WHERE kind=''failure-mode'' AND title=?1 AND status IN (''proposed'',''approved'',''in_progress'') LIMIT 1"}
Charter pillar: autonomy. Roadmap row RM-KAIZEN-SCHEDULED-1 (kaizen candidate kc-20260904-kaizen-autoapply, the improvement queue). Measured 2026-11-05: qnfo-audit.fleet_improvements holds 170 rows with source content-signal, kind failure-mode and the same title ([q08] Opaque Computational Mediation of Expertise ...), one filed at :07 of every hour since 2026-09-29 (ids up to 3313), each moved to status queued 43 minutes later (id 3313: created 2026-11-04 19:07:49, updated 19:50:47). contentSignalAudit looks for an existing row with status IN (proposed, approved, in_progress) before filing, so the queued twin is invisible and the next run files again; the signal is a q08 signal that stays open.
Fix: make the existence check read every non-terminal status, at least add queued, so the title is filed once. Test: a fixture with a queued row of the same title files nothing. Leave the 170 rows alone (no deletes); a later sweep may fold them.
Prediction: content-signal rows filed per hour 1 to 0 for an unchanged signal. Revert: restore the old status list.
Closing probe: the old status list is gone from qnfo-fleet-control/worker.js (code-probe above).',
 'session:c4-kaizen', 'reliability', 'medium', 'open'
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND instr(title, 'RM-KAIZEN-SCHEDULED-1.2:') > 0);

-- the eleven dispositions (each keeps its original evidence)
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-SCHEDULED-1 2026-11-05: shipped. publishAction in qnfo-research-exec/worker.js (line 31690 on 2026-11-05) runs UPDATE errata_queue SET status published after a successful publish (and errata_actions to published); the errata members run inside qnfo-research-exec since ERRATA-FOLD-1 (2026-10-06); errata_queue holds a published row (2026-09-04 01:13)'
WHERE id = 'kc-20260904-errata-publish-flip' AND status = 'scheduled';
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-SCHEDULED-1 2026-11-05: shipped. qnfo-errata-publish/worker.js is committed in the repository (deploy-state sync 2026-09-08); the directory is FOLDED (2026-10-01) into errata-hub, itself FOLDED into qnfo-research-exec (ERRATA-FOLD-1, 2026-10-06), where the source lives as errataMod'
WHERE id = 'kc-20260904-errata-source-repo' AND status = 'scheduled';
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-SCHEDULED-1 2026-11-05: shipped. OUTREACH-CAP-STATUS-1 (#1662) in qnfo-cloud-ops jobOutreach (worker.js line 1965): reaching the daily cap sets out.capped and out.cap and is not pushed into out.errors; qnfo-outreach itself is RETIRED (2026-10-06)'
WHERE id = 'kc-20260904-outreach-cap-classify' AND status = 'scheduled';
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-SCHEDULED-1 2026-11-05: shipped as a recurring loop. REVISION-LOOP-1 revisionLoopTick (qnfo-research-exec/worker.js line 33740) queues published papers for revision hourly with a try ceiling per slug and version; metric papers_awaiting_revision 132 (trigger 9482) and paper_loop_revisions_24h 4.0 against a target of 6 (trigger 9481, below 1 files); task_dod_register 150 (quality revision wave) is done'
WHERE id = 'kc-20260908-quality-revision-wave' AND status = 'scheduled';
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-SCHEDULED-1 2026-11-05: done by RM-PROBE-VERIFIED-COVERAGE-1 (PR 7306): all 36 live worker directories declare a content-asserting probes.json and scripts/probes-allowlist.txt is empty (read on main 82411b12); the KV health-registry count of 17 of 75 is superseded by DEPLOY-PROBES-1 and PROBE-SYSTEMWIDE-1'
WHERE id = 'kc-20260908-fleet-probe-coverage' AND status = 'scheduled';
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-SCHEDULED-1 2026-11-05: moot. qnfo-blank-audit and audit-hub (its host) are RETIRED (2026-10-01, not deployed); issue_ledger source blank-audit holds 11 alert rows, all resolved, newest update 2026-09-13; the empty-answer measure that survives is metric ops_agent_empty_answers_7d (0, target 0)'
WHERE id = '38ba2a60' AND status = 'scheduled';
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-SCHEDULED-1 2026-11-05: moot. qnfo-auditor is RETIRED (2026-10-01, not deployed); C4 was job-silence (a recurring job with no event in 48 h); the surviving enforcers are LOOP-WATCH-1 (qnfo-fleet-control /loops) and the metrics fleet_exec_silent_min (0, trigger 9394) and silent_drops (0, trigger 3075)'
WHERE id = 'b5f69d3b' AND status = 'scheduled';
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-SCHEDULED-1 2026-11-05: superseded. The per-record version lifecycle is carried by REVISION-LOOP-1 (revisionLoopTick evaluates every published paper each tick by slug and version, with version_queue states drafted, publishing and gate-blocked) and PAPER-LEDGER-1 (paper_change_ledger: one immutable row per change); no last_scanned or next_scan column exists and none is needed while the loop re-evaluates all eligible papers'
WHERE id = 'kc-20260904-lifecycle-scan-unify' AND status = 'scheduled';
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-SCHEDULED-1 2026-11-05: superseded. Every producer of kaizen_candidates is retired (qnfo-kaizen 2026-10-06, qnfo-auditor and audit-hub 2026-10-01; newest candidate 2026-09-27), so an apply rung on this table would act on nothing. Improvements flow through fleet_improvements, ROADMAP-ORIGINATE-1 and the code loop, with DEFAULT-APPROVE-1 for reversible changes. A defect found in that flow is filed as ROADMAP-1 QNFO.OPS RM-KAIZEN-SCHEDULED-1.2 (contentSignalAudit re-files hourly)'
WHERE id = 'kc-20260904-kaizen-autoapply' AND status = 'scheduled';
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-SCHEDULED-1 2026-11-05: superseded by the cloud loop. fleet-autodeploy.yml runs scripts/fleet-autoaudit.py --audit and --apply (worker_live_audit 131 rows, newest 2026-11-04 23:40Z) and qnfo-fleet-control deployDriftCf keeps deploy_drift_cf (33 workers in sync, none drifting, 67 rows skipped as RETIRED, FOLDED, WRANGLER-ONLY or container); no repository path reads the device cron 42b1988c, so retiring it on the owner machine is device-side (GUARDS-LOCAL-ONLY-1)'
WHERE id = 'kc-20260904-drift-cloud-migrate' AND status = 'scheduled';
UPDATE kaizen_candidates SET status = 'promoted', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-SCHEDULED-1 2026-11-05: partial, next slice filed. Routing already drops failing and degraded models from measured health (loadModelHealth over ai_model_health: 23 ok, 1 failing, updated 2026-11-05T00:00Z; autoRoute okPool); the graded step is ROADMAP-1 QNFO.OPS RM-KAIZEN-SCHEDULED-1.1 (code-task qnfo-ai/worker.js, marker ROUTER-QUALITY-WEIGHT-1)'
WHERE id = 'kc-20260904-router-selfopt' AND status = 'scheduled';

UPDATE roadmap_implementation SET status = 'partial',
  evidence = 'RM-KAIZEN-SCHEDULED-1 (PR NUMBER): the 11 scheduled kaizen items are dispositioned with evidence read 2026-11-05. Shipped earlier: errata publish flip, errata-publish source in the repo, outreach cap status, the revision wave loop (REVISION-LOOP-1). Done by a sibling: probe coverage (PR 7306, 36 of 36). Moot or superseded: blank-audit alert cluster, recurring C4 finding, per-record lifecycle scanner, risk-tiered kaizen auto-apply, weekly drift repair off the local cron. Open: router quality weighting (ROADMAP-1 QNFO.OPS RM-KAIZEN-SCHEDULED-1.1, qnfo-ai) and the content-signal duplicate refile found on the way (RM-KAIZEN-SCHEDULED-1.2, qnfo-fleet-control); both carry code-task, anchor and code-probe lines for the code loop. Device side: the local cron 42b1988c is retired on the owner machine (GUARDS-LOCAL-ONLY-1)'
WHERE id = 63;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:c4-kaizen (KAIZEN-SCHEDULED-1)',
  'a scheduled kaizen item that was shipped by another path, retired with its worker or superseded by a running loop is closed with the evidence that shows it; only a real gap becomes an issue with a doer',
  'KAIZEN-SCHEDULED-1: ten scheduled kaizen_candidates resolved with the enforcer named, one promoted to ROADMAP-1 QNFO.OPS RM-KAIZEN-SCHEDULED-1.1, one more defect filed as RM-KAIZEN-SCHEDULED-1.2, roadmap row 63 evidence updated (status stays partial)',
  'main 82411b12 and live D1 read 2026-11-05: publishAction flips errata_queue; OUTREACH-CAP-STATUS-1 present; qnfo-kaizen, qnfo-auditor, audit-hub, qnfo-blank-audit and qnfo-outreach carry RETIRED markers; ai_model_health 23 ok and 1 failing; deploy_drift_cf 33 in sync; probes-allowlist.txt empty; fleet_improvements has 170 content-signal twins with status queued',
  'applied by migration', 'kaizen_candidates rows with status scheduled, roadmap_implementation id 63, two agent_issues rows; no code, gate, cap or probe changed',
  'the Rollback line of migrations/2026-11-05-kaizen-scheduled-dispositions.sql restores both tables from bak_20261105_kaizen_scheduled',
  'the kaizen register no longer carries work that is done, moot or superseded; the two real gaps have doers', 'kaizen_candidates left scheduled 11 to 0; content-signal refiles per hour 1 to 0 once RM-KAIZEN-SCHEDULED-1.2 lands',
  'none (internal quality)', 'node:sqlite fixture replay in migrations/kaizen-scheduled-dispositions.test.mjs; live reads of D1, main and the cited files on 2026-11-05'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'KAIZEN-SCHEDULED-1:%');
