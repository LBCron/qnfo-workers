-- GOV-TAIL-6 (2026-11-05, charter pillar autonomy; slice B-governance-tail of the issue-backlog cluster). Corrects GOV-TAIL-2 (#7384, migration_runs 1301).
-- GOV-TAIL-2 armed every open BLINDSPOT-1 issue with the generic probe "the latest probe of the belief passes" and, in doing so, overwrote six probes that another session had written for the same issues
-- after the circular birth template (they sat `active` when the backup bak_20261105_gov_tail2_contracts was taken): 1001679 (research queue rows older than 180 minutes), 1001684 (spof_registry rows with
-- no tested alternate), 1001685, 1001697 and 1001698 (the belief row is reconciled with the evidence: lower the belief), 1001699 (share of unowned breach cases classed by structured facts). Those
-- probes measure more than the generic one, so this file puts them back from the backup (only where the contract still holds the armed generic text).
-- The beliefs behind 1001685, 1001697 and 1001698 are refuted by D1 itself: model_floor_guard_runs holds green main runs of the model-floor-guard workflow, cloud_ops_events holds ai-skip events (the wait
-- path ran, 2026-11-02T14:11Z and earlier), and GOV-TAIL-2 added the control_alternate_probes rows. The issue text offers the fix ("lower the belief with evidence in belief_registry"), so each belief drops
-- to confidence 0.1 with that evidence appended; the restored probes then read consistent. The audit step `arm-closing-probes` never overwrites a probe that is active and does not observe the issue's own
-- status, so a probe a session writes later is kept.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE belief_registry SET confidence=(SELECT b.confidence FROM bak_20261105_gov_tail6_beliefs b WHERE b.belief_key=belief_registry.belief_key), evidence=(SELECT b.evidence FROM bak_20261105_gov_tail6_beliefs b WHERE b.belief_key=belief_registry.belief_key) WHERE belief_key IN (SELECT belief_key FROM bak_20261105_gov_tail6_beliefs); UPDATE fleet_tasks SET definition=(SELECT b.definition FROM bak_20261105_gov_tail6_task b WHERE b.id=fleet_tasks.id), updated_at=(SELECT b.updated_at FROM bak_20261105_gov_tail6_task b WHERE b.id=fleet_tasks.id) WHERE id IN (SELECT id FROM bak_20261105_gov_tail6_task); UPDATE remediation_contracts SET verify_probe=(SELECT b.verify_probe FROM bak_20261105_gov_tail6_contracts b WHERE b.class=remediation_contracts.class), last_verdict=(SELECT b.last_verdict FROM bak_20261105_gov_tail6_contracts b WHERE b.class=remediation_contracts.class), attempts=(SELECT b.attempts FROM bak_20261105_gov_tail6_contracts b WHERE b.class=remediation_contracts.class), module=(SELECT b.module FROM bak_20261105_gov_tail6_contracts b WHERE b.class=remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_gov_tail6_contracts);
-- The Rollback leaves the decision_log row: decision_log is append-only.

CREATE TABLE IF NOT EXISTS bak_20261105_gov_tail6_contracts AS
SELECT class, verify_probe, last_verdict, attempts, module FROM remediation_contracts
WHERE class IN ('issue-1001679', 'issue-1001684', 'issue-1001685', 'issue-1001697', 'issue-1001698', 'issue-1001699');

CREATE TABLE IF NOT EXISTS bak_20261105_gov_tail6_beliefs AS
SELECT belief_key, confidence, evidence FROM belief_registry
WHERE belief_key IN ('alt-unexercisable-model_floor_pr_check', 'alt-unexercisable-research-model-skip-gauge', 'alt-unexercisable-research-fallback-price-guard');

CREATE TABLE IF NOT EXISTS bak_20261105_gov_tail6_task AS
SELECT id, definition, updated_at FROM fleet_tasks WHERE id = 'blind-spot-audit';

-- 1. the six probes another session wrote, back from the GOV-TAIL-2 backup (only where the armed generic text is still in place and the backup holds a real probe)
UPDATE remediation_contracts
SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_gov_tail2_contracts b WHERE b.class = remediation_contracts.class),
    verify_transport = (SELECT b.verify_transport FROM bak_20261105_gov_tail2_contracts b WHERE b.class = remediation_contracts.class),
    module = (SELECT b.module FROM bak_20261105_gov_tail2_contracts b WHERE b.class = remediation_contracts.class),
    status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class IN ('issue-1001679', 'issue-1001684', 'issue-1001685', 'issue-1001697', 'issue-1001698', 'issue-1001699')
  AND instr(verify_probe, 'BLINDSPOT-ARMED-1') > 0
  AND EXISTS (SELECT 1 FROM bak_20261105_gov_tail2_contracts b WHERE b.class = remediation_contracts.class AND b.status = 'active'
              AND instr(b.verify_probe, 'BLINDSPOT-ARMED-1') = 0 AND instr(b.verify_probe, 'FROM agent_issues WHERE id = ') = 0);

-- 2. lower the three refuted beliefs, with the evidence that refutes them
UPDATE belief_registry
SET confidence = 0.1,
    evidence = evidence || ' | REFUTED 2026-11-05 (GOV-TAIL-6): model_floor_guard_runs now holds green runs of the model-floor-guard workflow on main (the workflow records every run), so a green run leaves a D1 record and the alternate is readable; control_alternate_probes holds the row for model_floor_pr_check (GOV-TAIL-2). Confidence lowered from 0.9 to 0.1.'
WHERE belief_key = 'alt-unexercisable-model_floor_pr_check' AND confidence >= 0.5 AND instr(evidence, 'GOV-TAIL-6') = 0
  AND EXISTS (SELECT 1 FROM model_floor_guard_runs WHERE conclusion = 'success')
  AND EXISTS (SELECT 1 FROM control_alternate_probes WHERE control = 'model_floor_pr_check');

UPDATE belief_registry
SET confidence = 0.1,
    evidence = evidence || ' | REFUTED 2026-11-05 (GOV-TAIL-6): cloud_ops_events holds ai-skip events (the gauge tripped and the wait path ran, first 2026-10-19T21:21Z, latest 2026-11-02T14:11Z, each followed by a finished research stage on 2026-11-02), and control_alternate_probes holds the row for research-model-skip-gauge (GOV-TAIL-2). Confidence lowered from 0.9 to 0.1.'
WHERE belief_key = 'alt-unexercisable-research-model-skip-gauge' AND confidence >= 0.5 AND instr(evidence, 'GOV-TAIL-6') = 0
  AND EXISTS (SELECT 1 FROM cloud_ops_events WHERE kind = 'ai-skip')
  AND EXISTS (SELECT 1 FROM control_alternate_probes WHERE control = 'research-model-skip-gauge');

UPDATE belief_registry
SET confidence = 0.1,
    evidence = evidence || ' | REFUTED 2026-11-05 (GOV-TAIL-6): cloud_ops_events holds ai-skip events whose text says no fallback at or under its price (the wait path of the price guard ran, latest 2026-11-02T14:11Z), and control_alternate_probes holds the row for research-fallback-price-guard (GOV-TAIL-2). Confidence lowered from 0.9 to 0.1.'
WHERE belief_key = 'alt-unexercisable-research-fallback-price-guard' AND confidence >= 0.5 AND instr(evidence, 'GOV-TAIL-6') = 0
  AND EXISTS (SELECT 1 FROM cloud_ops_events WHERE kind = 'ai-skip' AND instr(text, 'no fallback at or under its price') > 0)
  AND EXISTS (SELECT 1 FROM control_alternate_probes WHERE control = 'research-fallback-price-guard');

-- 3. the hourly arming step keeps a probe that is active and does not observe the issue's own status
UPDATE fleet_tasks
SET definition = replace(definition, 'AND instr(COALESCE(verify_probe, ''''), ''BLINDSPOT-ARMED-1'') = 0', 'AND instr(COALESCE(verify_probe, ''''), ''BLINDSPOT-ARMED-1'') = 0 AND (status <> ''active'' OR instr(COALESCE(verify_probe, ''''), ''FROM agent_issues WHERE id = '') > 0)'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'blind-spot-audit' AND instr(definition, 'arm-closing-probes') > 0
  AND instr(definition, 'OR instr(COALESCE(verify_probe, ''''), ''FROM agent_issues WHERE id = '') > 0)') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-issues-B-governance-tail',
  'a probe another session wrote that measures more than a generic one is never replaced by the generic one; a refuted belief is lowered with its evidence, not hidden by a quiet watcher',
  'GOV-TAIL-6: six probes overwritten by GOV-TAIL-2 restored from its backup, three refuted beliefs lowered to 0.1 with evidence, the arming step made non-destructive',
  'remediation_verifications 2026-11-04 23:59-00:11Z on classes issue-1001685, 1001697, 1001698, 1001699, 1001684, 1001679 read real measurements before GOV-TAIL-2 applied at 00:16Z; bak_20261105_gov_tail2_contracts holds the six probes; model_floor_guard_runs holds 1418 green runs; cloud_ops_events holds 5 ai-skip events',
  'migration merged through the canonical path; no worker bundle changed',
  'six remediation_contracts rows, three belief_registry rows, one fleet_tasks row',
  'the Rollback header restores the beliefs, the audit definition and the generic probes; the decision row stays (append-only)',
  'the BLINDSPOT belief issues close only when the belief is reconciled with the evidence, as their text says',
  'issues 1001685, 1001697 and 1001698 pass their restored probes within two consumer passes; no probe measuring more than the generic one is replaced again',
  'none',
  'offline suite migrations/gov-tail-6.test.mjs (GOV-TAIL-2 then GOV-TAIL-6 on fixtures; the step is run against an active real probe and a circular one); live reads of the verifications and the backup'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'GOV-TAIL-6:%');
