-- COLD-TIER-CADENCE-1 (2026-11-05, agent W2-F-C, charter pillar cost; roadmap row 119 RM-D1-RETENTION-1). Read live after PR 7783 (workflow run 41974383631, event 05:37:55Z): the cold stage moves about 20 chunks a run
-- (cron_fire_log 4,000 rows, fleet_runs 2,000, code_task_ctx_archive 64, fleet_probe_log 800, bp26_probe_results 1,600, remediation_verifications 12,000 copied) and the consumer runs about once an hour when no
-- merge triggers it. Backlog read 05:40Z: fleet_probe_log 50,080 rows older than 5 days (the old contract fm-cold-archive-lag has failed 9 attempts), cron_fire_log about 45,000 rows past its 3 days, fleet_runs about
-- 24,000 past its 7, 847 heavy blob rows less the 234 moved. At equal shares that is about 40 runs for fleet_probe_log alone. This file files the structural fix with a doer; the code change in the same pull request
-- caps the copy-only tier remediation_verifications at 3 chunks a run (it spent 6 of the 20 chunks without removing a row from D1).
-- PREDICTION: fleet_probe_log rows older than 5 days 50,080 -> under 1,000 (contract fm-cold-archive-lag passes) within about 12 hours of the weighting change that agent_issues COLD-TIER-CADENCE-1 asks for; this
-- file moves no metric by itself.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM agent_issues WHERE title LIKE 'COLD-TIER-CADENCE-1:%' AND source = 'session:w2f-c' AND status = 'open'
-- CAUSE-MAPPED: registers no metric.
-- spof-review: adds no worker, cron, D1 trigger, route or credential; it files one issue.

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'COLD-TIER-CADENCE-1: the cold tier drains a 50,000 row backlog at about 20 chunks an hour; weight the tier shares by backlog or run the stage on its own cadence',
 'Charter pillar: cost (D1 size and speed). Roadmap row 119 (RM-D1-RETENTION-1). Evidence (workflow run 41974383631, cloud_ops_events kind cold-tier 2026-11-05T05:37:55Z, v_cold_tier_status 05:38Z): with equal time shares (COLD-TIER-SHARE-1) every tier moves, but a run fits about 20 chunks of about 12 s (R2 put and get, five D1 round trips, the 1 s delete pauses) and remediation-consumer.yml runs about hourly unless a merge triggers it (qnfo-cloud-ops dispatches after 60 minutes idle). Backlog read 05:40Z: fleet_probe_log 50,080 rows older than 5 days (contract fm-cold-archive-lag: fail, 9 attempts), cron_fire_log about 45,000 rows past 3 days, fleet_runs about 24,000 past 7, code_task_ctx_archive about 800 heavy rows. fleet_probe_log went from 4,800 rows a run (before the shares) to 800, so the oldest backlog drains about 6 times slower than before.' || char(10) ||
 'EDIT (one or more, smallest first): (1) weight each tier share by its backlog: a tier whose last chunk was full keeps its share, one that returned a partial chunk hands the rest on (the run() loop of scripts/cold_tier.py already hands unused time on); (2) skip the per-batch delete pause when the previous statement took under 150 ms; (3) a lighter workflow that runs only scripts/cold_tier.py every 20 minutes (a new workflow is a .github change, by pull request, with a work claim); (4) an archive step that writes several chunks to R2 in parallel.' || char(10) ||
 'Definition of done: SELECT COUNT(*) FROM fleet_probe_log WHERE ts < now - 5 days reads under 1,000 (contract fm-cold-archive-lag passes), cron_fire_log and fleet_runs rows past their keep windows are under 2,000 each (read by cold_archive_ledger, never by COUNT(*) of the big tables), and the continuity step stays under its 8 minute timeout.' || char(10) ||
 'code-task: repo=qnfo-workers path=scripts/cold_tier.py' || char(10) ||
 'code-anchor: def run(d1, r2=None, now=None, sleep=time.sleep, tiers=None, deadline=None):' || char(10) ||
 'code-probe: {"paths": ["scripts/cold_tier.py"], "contains": "COLD-TIER-WEIGHT-1"}',
 'session:w2f-c', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'COLD-TIER-CADENCE-1:%' AND status = 'open');
