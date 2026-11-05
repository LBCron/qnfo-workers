-- BLOCKER-REDTEAM-AUTO-3a (2026-11-05, charter pillar autonomy; metric unverified_blocker_claims).
-- PR 7335 (BLOCKER-REDTEAM-AUTO-3) let the runner record a signed false-belief-removed when every trigger phrase of a claim is negated. Its first live run (consumer run
-- 41937297805, 23:58Z) signed issue 3003 on the strength of "...the metric is not moving:** two producers are blocked by publication-quality gates": the "not" negates
-- "moving", not "blocked", so the claim is real and the signed verdict would hide it until the issue text changed. The runner now binds a negator to the four words before the
-- phrase (scripts/blocker_redteam_runner.py); this file removes the one wrong row (id 345), keeping a copy.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_blocker_redteam_3003
-- Rollback: INSERT INTO blocker_redteam SELECT * FROM bak_20261105_blocker_redteam_3003 WHERE id NOT IN (SELECT id FROM blocker_redteam); the backup table keeps the row.
-- spof-review: one ledger row.

CREATE TABLE IF NOT EXISTS bak_20261105_blocker_redteam_3003 AS
SELECT * FROM blocker_redteam
WHERE target = 'issue:3003' AND actor = 'blocker-redteam-runner' AND verdict = 'false-belief-removed'
  AND instr(evidence, 'every occurrence is negated') > 0 AND instr(evidence, 'two producers are blocked') > 0;

DELETE FROM blocker_redteam
WHERE target = 'issue:3003' AND actor = 'blocker-redteam-runner' AND verdict = 'false-belief-removed'
  AND instr(evidence, 'every occurrence is negated') > 0 AND instr(evidence, 'two producers are blocked') > 0;
