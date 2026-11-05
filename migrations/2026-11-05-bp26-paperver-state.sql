-- BP26-PAPERVER-STATE-1 (2026-11-05, charter pillar research; breach paper_version_immutability, trigger 14493, agent_issues 1000672; practice BP26-PAPER-PIDS-1, 1000338).
-- Follows migrations/2026-11-05-bp26-paperver-count.sql (the producer counts the in-place edits in SQL instead of through LIMIT 500). Records what the corrected producer shows at 03:20Z, in its own file because
-- the earlier files are already applied (an edited, applied migration is re-applied by the runner, MIGRATION-NO-CLOBBER-1).
-- MEASURED (living-paper paper_change_ledger, read-only): metric 0.0275, about 708 of 728 published papers edited in place in the 30-day window. The writer is the PAPER-CANONICAL-1 backfill of paperFormatTick
--   (qnfo-research-exec, PR 7241 merged 2026-11-04 23:01, review fixes 23:05), a one-time conversion of every stored body to the new-release shape that keeps version and revision date by design. Edits that change
--   the body fingerprint per hour: 88 at 01Z, 56 at 02Z, 1 at 03Z. The passes after the first only set subtitle and keywords with an identical body fingerprint, which the metric does not count. The inflow has ended.
-- WHAT THIS FILE DOES: appends one DELTA-NOTE to agent_issues 1000672. It changes no metric, trigger, target or paper. The metric is a guard (metric_registry.kind = 'guard') and is not exempted, scoped or
--   re-baselined: every edit stays counted until it ages out of the window.
-- PREDICTION: paper_version_immutability stays near 0.03 until the edits of 2026-11-02 to 2026-11-05 leave the 30-day window, then rises to 1.0 on about 2026-12-05 if no further in-place edit lands. The
--   producer's note carries the inflow of the last 24 hours (the leading indicator) and the first day the window can clear.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET description = substr(description, 1, instr(description, char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05c)') - 1) WHERE instr(description, char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05c)') > 0
-- CAUSE-MAPPED: no metric is registered here; this appends a note to an existing issue.

UPDATE agent_issues
SET description = description || char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05c): state read at 03:20Z with the corrected producer: 0.0275, about 708 of 728 papers edited in place in the window. The writer is the PAPER-CANONICAL-1 backfill of paperFormatTick (qnfo-research-exec, PR 7241 merged 2026-11-04 23:01, review fixes 23:05), a one-time conversion of every stored body to the new-release shape that keeps version and revision date by design. Body-changing edits per hour: 88 at 01Z, 56 at 02Z, 1 at 03Z; the later passes only set subtitle and keywords with an identical body fingerprint, which is not counted. The inflow has ended, so the window can start clearing: with no further in-place edit it holds none from about 2026-12-05. The metric is a guard (kind guard) and is not exempted, scoped or re-baselined: the edits stay counted until they age out. Forward rule, as in the note above: a writer that changes the body of a published version bumps the version, so the next normalization rule is a version-bumping revision or a recorded re-baselining in its own PR. Closing probe: this issue''s contract (metric 14493 at 1, not before about 2026-12-05).',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1000672 AND status = 'open' AND instr(description, 'DELTA-NOTE (breach-bp26-reach, 2026-11-05c)') = 0;
