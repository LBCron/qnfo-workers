-- RM-BS-WEEKLY-SIGNAL-1 (2026-11-05, charter pillar reach, program QNFO.REACH; roadmap_implementation row 3272): redraft the first live weekly-signal issue with the fixed drafter (qnfo-subscribers 1.6.1).
-- Read live after PR 7744: the draft for 2026-11-08 (drafted 2026-11-05 05:00:31Z by 1.6.0, owner mailed 05:00:32Z) carried raw TeX in an item title ("$\mathbb{Z}_2$") and, for one paper, a Check sentence that started
-- mid-passage ("Observation (b) is the sharpest ..."). 1.6.1 flattens TeX in titles, quotes a Check or Limits excerpt only from the first sentence of the passage and otherwise says the test is stated in formulas.
-- The draft was never reviewed, so it is copied whole (the backup holds every row of the table) and deleted; the next hourly tick drafts the 2026-11-08 issue again and mails the owner the corrected draft once more. A draft the owner already
-- approved or rejected is left alone (the DELETE names status draft and reviewed_at IS NULL).
-- Prediction: weekly_signal_issues has a draft for 2026-11-08 whose body_text has no dollar sign and no mathbb within the hour after this applies (drafted_at later than this migration).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_weekly_signal_draft1
-- Rollback: INSERT OR IGNORE INTO weekly_signal_issues SELECT * FROM bak_20261105_weekly_signal_draft1;
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261105_weekly_signal_draft1 AS SELECT * FROM weekly_signal_issues;

DELETE FROM weekly_signal_issues WHERE send_date = '2026-11-08' AND status = 'draft' AND reviewed_at IS NULL;
