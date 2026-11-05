-- CF-CAPABILITY-ADOPT-1 (2026-11-05, charter pillar autonomy; RM-CAPABILITY-PRODUCT-LOOP-1, the adopt leg): registers cf_capability_undecided_14d, the count the new decision step of qnfo-fleet-control writes.
-- Rows of cloudflare_capability_catalog in status proposed or not_considered, older than 14 days, whose linked issue is not open (closed, missing or no link). Read 2026-11-05: 11 proposed + 4 not_considered rows, none with an open linked
-- issue, so the first value is 15; the step files at most 2 CF-CAPABILITY-DECIDE-1 issues a day (6 open at once) and links each row to its issue, which makes the row owned until that issue closes.
-- No trigger (the metric is the tracker of a loop that files its own issues, as cron_faults_open is for CRON-FAULT-1; a trigger would file the same work twice): CAUSE-MAPPED below, owner qnfo-fleet-control.
-- CAUSE-MAPPED: structure, the cause key of cf_changelog_open_proposals_14d (the sibling that counts only changelog-made rows), inserted below
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE metric_registry SET state = 'RETIRED' WHERE metric = 'cf_capability_undecided_14d';

INSERT OR IGNORE INTO metric_registry
  (metric, layer, kind, formula, source_of_truth, target, owner, disposition_actor, refresh_cadence, state)
VALUES
  ('cf_capability_undecided_14d', 'operational', 'lagging',
   'cloudflare_capability_catalog rows in status proposed or not_considered, first_seen more than 14 days ago, whose linked_issue is not an open agent_issues row (closed, missing or no link). Exempt from a trigger: the decision step of qnfo-fleet-control (CF-CAPABILITY-ADOPT-1) files one CF-CAPABILITY-DECIDE-1 issue per row, 2 a day and 6 open at most, and links the row to it; the count falls as rows are decided',
   'qnfo-audit.cloudflare_capability_catalog x agent_issues (qnfo-fleet-control cfdTick, hourly in the changelog tick)', '0', 'qnfo-fleet-control', 'fleet:cf-capability-adopt', '1h', 'UNMEASURED');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key) VALUES ('cf_capability_undecided_14d', 'structure');
