-- BP26-PAPERVER-COUNT-1 (2026-11-05, charter pillar research; breach paper_version_immutability, trigger 14493, agent_issues 1000672; practice BP26-PAPER-PIDS-1, 1000338).
-- WHAT WAS MEASURED (living-paper, read-only, 2026-11-04 23:40Z): the producer scripts/bp26_paperver.py read the violating versions with `ORDER BY slug LIMIT 500` and counted the rows in Python, so the
--   metric could never read below 1 - 500/728 = 0.3132, and it did read exactly 0.3132. The same predicate counted in SQL gives 675 distinct (slug, version) pairs whose body changed in place in the 30-day window
--   of 728 published, distributed or external_preprint papers: the true value is 0.0728, not 0.3132. The measure was too kind, not too harsh.
-- WHO WRITES THEM (distinct papers in the window): qnfo-research-exec 585 (the paper-format representation waves PAPER-FORMAT-2 on 2026-11-02 and PAPER-CANONICAL-1, still sweeping: paper_format_state cursor at the
--   letter m, 162 repaired in the current sweep at 23:31Z, about 100 papers an hour), session backfills 125 (REVISED-STANDARD-1 and the 2026-10-26 leftovers cleanups), one session 45. paperFormatTick writes with
--   `updated_at=updated_at` and its ledger reason says "text, version and revision date unchanged": the waves are deliberate and keep the version, which is exactly what the metric counts as an in-place edit.
-- FIX (scripts/bp26_paperver.py, offline suite in its --selftest, 650+1 violations counted in full): COUNT(*) over one shared predicate; only the 40 evidence rows are limited; the note names the writers (first two
--   segments of the ledger actor, so a loop is told apart from its worker), the in-place edits of the last 24 hours (the inflow that must reach 0 for the window to start clearing) and the first day the window can clear.
--   The lever review's other proposal, a denominator by versions, is subsumed: papers holds one row per slug, so published versions and published papers are the same 728.
-- PREDICTION: paper_version_immutability 0.3132 -> 0.0728 at the first consumer run after the merge (a correction downward, stated here so it is not read as a regression of the practice); it cannot recover before
--   30 days after the last in-place edit (about 2026-12-05 if the PAPER-CANONICAL-1 sweep ends this week and no new rule wave follows). The inflow figure in the note is the leading indicator.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE metric_registry SET source_of_truth = 'living-paper paper_change_ledger (to compute) [BP26]' WHERE metric = 'paper_version_immutability'; UPDATE agent_issues SET description = substr(description, 1, instr(description, char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05): producer defect') - 1) WHERE instr(description, char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05): producer defect') > 0; DELETE FROM decision_log WHERE instr(action, 'BP26-PAPERVER-COUNT-1:') = 1
-- CAUSE-MAPPED: no metric is registered here; this edits the source_of_truth text of an existing metric and appends a note to an existing issue.

UPDATE metric_registry SET source_of_truth = 'living-paper paper_change_ledger: distinct (slug, version) pairs of published, distributed or external_preprint papers whose body fingerprint changed under the same version in the last 30 days, counted in SQL without a row limit, over the published papers; scripts/bp26_paperver.py on the remediation-consumer runner; the note names the writers, the in-place edits of the last 24 h and the first day the window can clear; a ledger write-path proxy, no per-version hash is stored yet (PAPER-PIDS-PIN-1, agent_issues 1001859) [BP26]'
  WHERE metric = 'paper_version_immutability';

UPDATE agent_issues
SET description = description || char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05): producer defect found and fixed. The violating versions were read with LIMIT 500 and counted in Python, so the metric could not read below 0.3132 (1 - 500/728); the ledger holds 675 distinct in-place (slug, version) pairs in the window, true value 0.0728. scripts/bp26_paperver.py now counts with COUNT(*), names the writers, the 24 h inflow and the first day the window can clear. The lever-review denominator proposal is subsumed (papers holds one row per slug). Writers in the window, distinct papers: qnfo-research-exec 585 (paperFormatTick, PAPER-FORMAT-2 and PAPER-CANONICAL-1, which keep version and revision date by design and are still sweeping at about 100 papers an hour), session backfills 125 and 45. The practice cannot recover before 30 days after the last in-place edit (about 2026-12-05 if the sweep ends this week and no new rule wave follows). Doers: drift is flagged per served version by PAPER-PIDS-PIN-1 (agent_issues 1001859, qnfo-gateway); the writer rule is that a writer which changes the body of a published version bumps the version, or is recorded once as a re-baselining with the ledger reason naming it, and it binds the PR that adds the next normalization rule to paperFormatTick (qnfo-research-exec/worker.js, a file under a live claim at the time of writing, and the sweep in flight is a one-time conversion). Closing probe: this issue''s contract (metric 14493 at 1).',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1000672 AND status = 'open' AND instr(description, 'DELTA-NOTE (breach-bp26-reach, 2026-11-05): producer defect') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'breach-bp26-reach', 'a metric that counts rows through a LIMIT can read a value no practice change can improve; the count must be taken in SQL',
       'BP26-PAPERVER-COUNT-1: scripts/bp26_paperver.py counts the in-place edits with COUNT(*) instead of a 500-row list, and names the writers, the 24 h inflow and the first clear day',
       'living-paper paper_change_ledger, same predicate in SQL: 675 distinct (slug, version) in 30 days against 728 published papers; the producer read exactly 500 (0.3132 = 1 - 500/728); writers: qnfo-research-exec 585, session backfills 125 and 45; offline selftest with 651 violations',
       'applied by migration', 'paper_version_immutability only; no paper, ledger row or writer is changed',
       'the Rollback line restores the registry text; reverting scripts/bp26_paperver.py restores the capped count',
       'the metric reads the real in-place edit count and says who writes them and when the window can clear',
       'paper_version_immutability 0.3132 -> 0.0728 at the first consumer run after the merge (a downward correction); no recovery before about 2026-12-05',
       'none', 'd1:living-paper paper_change_ledger (SELECT only via the Cloudflare D1 REST), offline selftest'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE instr(action, 'BP26-PAPERVER-COUNT-1:') = 1);
