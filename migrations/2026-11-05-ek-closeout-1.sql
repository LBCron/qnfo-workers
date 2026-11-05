-- EK-CLOSEOUT-1 (2026-11-05, charter pillar reach, program QNFO.REACH; roadmap even-keel-2026 rows 1748 EK-1, 1749 EK-2, 1750 EK-3, 1753 EK-6; agent_issues 1000713, 1000714, 1000716).
-- WHAT WAS READ LIVE (2026-11-05 03:30-03:50Z, personal plane counts only, no piece text copied here): personal-companion /health is 1.45.2 (PR 7551 merged 03:15:59Z, PR 7481 earlier).
-- EK-1: companion_pieces holds 2 of 101 rows with no stored lede (2026-11-04-essay-ab276e35317492a4, 2026-10-25-notes-3840be19d5dd6659); the live page of each carries exactly one class=lede paragraph and the index preview shows it.
-- EK-3: companion_audits newest passing row (2026-11-05T02:06:12Z) carries balance_score 88; the 20 older passing rows from 2026-10-28 carry NULL, so the check answers now (scored share of the five newest passes: 1 of 5).
--       companion_runs holds 0 rows 'fact-check balance:%' since 2026-10-28: no draft has been stopped at the balance stage yet, so the hold share reads 0 or NULL, not a wall.
-- EK-2: the supplier (Hansard, Global Voices, GOV.UK) is deployed; no visible piece cites a publisher other than Wikipedia and arXiv yet (companion_independent_source_pieces_30d reads 0). The outcome is not proven; the row is deployed, not built.
-- THE MEASURED CAUSE OF THE LOW YIELD (the coordinator's brief named the retraction rate 74 of 101; the rows say otherwise): companion_retractions holds 74 rows, all dated 2026-10-10, all pieces written before the
--   source record existed ("no source material was recorded", audit stage no-source-record); companion_audits holds 0 accuracy failures and 27 passes since 2026-10-15 (27 of 27). The /health "retracted 74" is a one-time
--   withdrawal of legacy pieces, not a rate. What cut the readers' supply is upstream of the audit: signals reading:* shows 9 pieces in 2026-10-22..28 and 3 in 2026-10-29..11-05, and companion_runs shows 26-29 runs a day
--   BLOCKED by the contested-topic gate ("only 1 full-text sources, topic dropped") on each day 2026-10-29..11-03 and 19 on 11-04, against 0 before 10-29. EK-2 (1.45.2) is the supplier for that gate.
-- WHAT THIS ADDS (no worker file, no cron): (1) the three metrics personal-companion 1.45.0/1.45.2 already write each hour (their UPDATE touched no row because nothing registered them) with triggers where a
--   threshold means something; (2) companion_pieces_published_7d, the outcome that was never measured (pieces visible in the last 7 days, from the signals mirror in this database; refreshed hourly by a fleet_tick trigger like
--   its siblings); (3) the rows of EK-1, EK-3 (built), EK-2 (deployed) and EK-6 (partial: the module is inlined into personal-companion only; q08 and research have 0 references) with their evidence; (4) real closing probes for issues
--   1000713 and 1000714 (1000714's probe counted papers and AI queries; 1000713's was a self-comparison and superseded); (5) three issues with doers for what the read found; (6) the decision and its prediction.
-- PREDICTION (decision_log, below): companion_pieces_published_7d >= 6 within 192 h (2026-11-13), from 3 now (9 in the 7 days before). Falsifier: under 4 on 2026-11-13 with EK-2 live means the supplier did not unblock the contested gate
--   and the yield cause is the fact-check stage (4 of 5 drafts rejected 'unsupported claim' on 2026-11-05). Failure mode of this measure: the signals mirror counts a piece when it is written, so a piece retracted later by the audit
--   (status retracted) leaves the count; a window of 7 days lags a fix by up to a week, so the first honest reading of EK-2 is the independent-source count and the daily run log.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_ek_closeout
-- Rollback: UPDATE roadmap_implementation SET status = (SELECT b.status FROM bak_20261105_ek_closeout b WHERE b.kind = 'roadmap' AND b.key = CAST(roadmap_implementation.id AS TEXT)), evidence = (SELECT b.a FROM bak_20261105_ek_closeout b WHERE b.kind = 'roadmap' AND b.key = CAST(roadmap_implementation.id AS TEXT)), verified_at = (SELECT b.b FROM bak_20261105_ek_closeout b WHERE b.kind = 'roadmap' AND b.key = CAST(roadmap_implementation.id AS TEXT)) WHERE id IN (SELECT CAST(key AS INTEGER) FROM bak_20261105_ek_closeout WHERE kind = 'roadmap'); UPDATE remediation_contracts SET status = (SELECT b.status FROM bak_20261105_ek_closeout b WHERE b.kind = 'contract' AND b.key = remediation_contracts.class), verify_probe = (SELECT b.a FROM bak_20261105_ek_closeout b WHERE b.kind = 'contract' AND b.key = remediation_contracts.class), verify_transport = (SELECT b.b FROM bak_20261105_ek_closeout b WHERE b.kind = 'contract' AND b.key = remediation_contracts.class) WHERE class IN (SELECT key FROM bak_20261105_ek_closeout WHERE kind = 'contract'); DELETE FROM remediation_contracts WHERE class IN ('rm-1748', 'rm-1749', 'rm-1750'); DROP TRIGGER IF EXISTS companion_yield_tick; DROP VIEW IF EXISTS v_companion_yield_7d; DELETE FROM analytics_metric_triggers WHERE metric_key IN ('companion_balance_scored_share_last5', 'companion_balance_hold_share_7d', 'companion_pieces_published_7d'); DELETE FROM metric_breach_cause WHERE metric_key IN ('companion_balance_scored_share_last5', 'companion_balance_hold_share_7d', 'companion_independent_source_pieces_30d', 'companion_pieces_published_7d'); DELETE FROM metric_registry WHERE metric IN ('companion_balance_scored_share_last5', 'companion_balance_hold_share_7d', 'companion_independent_source_pieces_30d', 'companion_pieces_published_7d'); DELETE FROM metric_unmeasured_exemptions WHERE metric_key IN ('companion_balance_scored_share_last5', 'companion_balance_hold_share_7d', 'companion_independent_source_pieces_30d'); DELETE FROM remediation_contracts WHERE class = 'fm-reading-yield-collapse'; DELETE FROM failure_modes WHERE fm_key = 'reading-yield-collapse'; DELETE FROM agent_issues WHERE source = 'session:W2-G-even-keel' AND status = 'open' AND (title LIKE 'READING-FEED-LEDE-1:%' OR title LIKE 'READING-HEALTH-ACCURACY-1:%' OR title LIKE 'EK-6-ADOPT-1:%');
-- spof-review: the yield reading has one producer, the companion_yield_tick trigger on fleet_tick (hourly, first ten minutes of the hour); the three EK readings have one producer, personal-companion companionStallDetector (hourly). fm-reading-yield-collapse fails when the yield reading is older than 3 hours.
-- runtime-probe (D1): SELECT metric, last_value, last_refreshed FROM metric_registry WHERE metric IN ('companion_pieces_published_7d', 'companion_balance_scored_share_last5', 'companion_independent_source_pieces_30d', 'companion_balance_hold_share_7d')
-- CAUSE-MAPPED: INSERT INTO metric_breach_cause below maps the four metrics (publishing) in this same file.
-- NOOP-OK: the first-reading UPDATE of companion_pieces_published_7d is idempotent; a replay rewrites the same reading.

-- ---- backup of the rows this file changes ---------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bak_20261105_ek_closeout AS
SELECT 'roadmap' AS kind, CAST(id AS TEXT) AS key, status AS status, evidence AS a, verified_at AS b FROM roadmap_implementation WHERE id IN (1748, 1749, 1750, 1753)
UNION ALL
SELECT 'contract', class, status, verify_probe, verify_transport FROM remediation_contracts WHERE class IN ('issue-1000713', 'issue-1000714');

-- ---- the reading: pieces visible in the last 7 days and in the 7 days before, from the signals mirror (indexed id range, public slugs, no text) -------------------------------------------------
CREATE VIEW IF NOT EXISTS v_companion_yield_7d AS
SELECT
  (SELECT COUNT(*) FROM signals WHERE id >= 'reading:' AND id < 'reading;' AND status <> 'retracted' AND created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')) AS pieces_7d,
  (SELECT COUNT(*) FROM signals WHERE id >= 'reading:' AND id < 'reading;' AND status <> 'retracted' AND created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-14 days') AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')) AS pieces_prev_7d;

-- ---- the metrics ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
INSERT OR IGNORE INTO metric_registry
  (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, last_value, last_refreshed, state, refresh_class)
VALUES
  ('companion_pieces_published_7d', 'surface', 'target',
   'Reading pieces written in the last 7 days that are not retracted: rows of signals with id reading:* (the mirror personal-companion writes when a piece publishes), created_at within 7 days; the previous 7 days are in v_companion_yield_7d (EK-CLOSEOUT-1)',
   'qnfo-audit.v_companion_yield_7d <- signals; refreshed hourly by trigger companion_yield_tick on fleet_tick',
   '3 on 2026-11-05 (2026-10-29..11-05) against 9 in 2026-10-22..28; 26-29 runs a day were blocked by the contested-topic gate on 2026-10-29..11-03',
   '>= 6 (the desk writes up to 5 a day at the generation hours; 9 a week was the rate before the source gate)', 'personal-companion',
   'personal-companion: the contested-topic supplier (EK-2) and the fact-check stage; trigger files a diagnosis issue when the week falls under 3', '1h', '< 6', '< 3', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', 'computed'),
  ('companion_balance_scored_share_last5', 'surface', 'target',
   'Of the five newest passing rows of companion_audits (personal-life D1), the share that carry a balance_score, i.e. the even-keel check ran and answered (personal-companion 1.45.0 writeBalanceMetrics, counts only)',
   'https://reading.q08.org/health version >= 1.45.2; written hourly by personal-companion companionStallDetector into this row',
   '0 of 20 passing rows from 2026-10-28 to 2026-11-04; 1 of 5 on 2026-11-05 (score 88 at 02:06Z)',
   '>= 0.6; 1.0 once five pieces have passed under 1.45.0', 'personal-companion', 'personal-companion afBalanceReviewers/balanceCheck (agent_issues 1000714); trigger files a code task when no newest-five pass is scored', '1h', '< 0.4', '< 0.2', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', NULL),
  ('companion_balance_hold_share_7d', 'surface', 'guard',
   'Of the drafts that reached the even-keel reviewer in the last 7 days (scored passes plus attempts stopped at stage balance), the share it stopped; written hourly by personal-companion, counts only (EK-3 guard: the check must not become a wall)',
   'https://reading.q08.org/health version >= 1.45.2; written hourly by personal-companion companionStallDetector into this row',
   'no draft stopped at stage balance from 2026-10-28 to 2026-11-05 (0 run rows)',
   '< 0.6', 'personal-companion', 'personal-companion balanceCheck threshold (70 of 100); trigger files a code task when more than 60 percent of the drafts it sees are stopped', '1h', '>= 0.4', '>= 0.6', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', NULL),
  ('companion_independent_source_pieces_30d', 'surface', 'target',
   'Visible reading pieces of the last 30 days whose sources footer holds a publisher other than Wikipedia and arXiv (anchor_json refs, counts only; personal-companion 1.45.2 writeSourceMetrics): the closing measure of agent_issues 1000713 (EK-2)',
   'https://reading.q08.org/health version >= 1.45.2; written hourly by personal-companion companionStallDetector into this row',
   '0 on 2026-11-05 (no piece yet; 5 of 45 contested candidates passed the source gate in the build-time replay)',
   '>= 1 after the first contested topic publishes; the share of contested pieces with three publishers is the later target', 'personal-companion',
   'exempt from a threshold trigger: agent_issues 1000713 (open, doer: the code loop) is the single signal for this gap and its closing probe reads this row; a trigger would file a second issue for the same producer', '1h', '< 1', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', NULL);

-- Hourly, in the first ten minutes (like its siblings), and once when this file is applied.
CREATE TRIGGER IF NOT EXISTS companion_yield_tick
AFTER INSERT ON fleet_tick
WHEN strftime('%M', 'now') < '10' OR NEW.source LIKE 'migration:%'
BEGIN
  UPDATE metric_registry
  SET last_value = (SELECT CAST(v.pieces_7d AS TEXT) FROM v_companion_yield_7d v),
      last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      state = 'MEASURED'
  WHERE metric = 'companion_pieces_published_7d';
END;

-- First reading, so the row carries a measured value the moment this merges.
UPDATE metric_registry
SET last_value = (SELECT CAST(v.pieces_7d AS TEXT) FROM v_companion_yield_7d v),
    last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    state = 'MEASURED'
WHERE metric = 'companion_pieces_published_7d';

-- ---- triggers (lever = a code task on personal-companion where one file holds the lever), causes ------------------------------------------------------------------------------------------------
INSERT OR IGNORE INTO analytics_metric_triggers
  (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
VALUES
  ('companion_balance_scored_share_last5', 'Reading gap: none of the five newest passing pieces carries an even-keel score', 'registry', 'lt', 0.2, 5,
   'Pillar reach. The even-keel check (EK-3) answers for none of the last five pieces that passed, which is the 2026-10-28..11-04 defect again (reviewer family empty, every answer unavailable). Read the cause first: SELECT checked_at, balance_score FROM companion_audits WHERE verdict = ''pass'' ORDER BY checked_at DESC LIMIT 5 in the personal-life D1 (counts and scores only), and companion_runs detail LIKE ''%balance%'' for the reviewer reply. Lever: in balanceCheck make a reviewer outage visible in the run detail and try the next family before failing open.' || char(10) ||
   'code-task: repo=qnfo-workers path=personal-companion/worker.js' || char(10) ||
   'code-anchor: async function balanceCheck(env, draft, writerModel, seedText, judged) {',
   'personal-companion', 'agent_issues', 72, 1,
   'EK-CLOSEOUT-1: threshold 0.2 is lt, so a share of 0.2 (one of five) is not a breach; the metric reads 1.0 after five pieces have passed under 1.45.0. Switch off with enabled = 0 on this row.'),
  ('companion_balance_hold_share_7d', 'Reading gap: the even-keel check stops more than 60 percent of the drafts it sees', 'registry', 'gt', 0.6, 5,
   'Pillar reach. The check has become a wall (EK-3 guard: it must not cut the yield). Read companion_runs detail LIKE ''fact-check balance:%'' for the reasons (counts by reason, no text) and the score distribution in companion_audits.balance_score. Lever: in balanceCheck the pass threshold (70 of 100) and the one revision with an even-keel note; lower the stop to a revision before a hold, never remove the check.' || char(10) ||
   'code-task: repo=qnfo-workers path=personal-companion/worker.js' || char(10) ||
   'code-anchor: async function balanceCheck(env, draft, writerModel, seedText, judged) {',
   'personal-companion', 'agent_issues', 72, 1,
   'EK-CLOSEOUT-1: written only when at least one draft reached the reviewer, NULL otherwise. Switch off with enabled = 0 on this row.'),
  ('companion_pieces_published_7d', 'Reading gap: fewer than 3 pieces published in the last 7 days', 'registry', 'lt', 3, 5,
   'Pillar reach. The desk wrote 9 pieces in 2026-10-22..28 and 3 in 2026-10-29..11-05. Read the causes from the run log by day (personal-life D1, counts only): SELECT substr(run_at,1,10) d, status, COUNT(*) FROM companion_runs WHERE run_at >= date(''now'',''-7 days'') GROUP BY d, status, and the blocked detail for ''contested-topic gate'' (EK-2 supplier) versus ''fact-check factcheck'' (unsupported claims). Fix the dominant stage at its producer; do not lower a gate to raise the count.',
   'personal-companion', 'agent_issues', 168, 1,
   'EK-CLOSEOUT-1: floor against a total collapse; the target is >= 6. The first diagnosis is the independent-source gate (agent_issues 1000713). Switch off with enabled = 0 on this row.');

-- The three readings personal-companion writes are NULL/UNMEASURED until its next hourly tick finds the registered rows; a valid producer gap of under an hour, not a missing producer.
INSERT OR IGNORE INTO metric_unmeasured_exemptions
  (metric_key, reason, ends_when, doer)
VALUES
  ('companion_balance_scored_share_last5', 'the producer is personal-companion companionStallDetector (writeBalanceMetrics, hourly); the row is registered by this file and the first write follows within the hour', 'the next hourly tick of personal-companion 1.45.2 or later writes a value', 'personal-companion'),
  ('companion_balance_hold_share_7d', 'the producer is personal-companion companionStallDetector (writeBalanceMetrics, hourly); the value is NULL by design when no draft reached the even-keel reviewer in 7 days', 'at least one draft has reached the even-keel reviewer in the last 7 days and the tick writes a number', 'personal-companion'),
  ('companion_independent_source_pieces_30d', 'the producer is personal-companion companionStallDetector (writeSourceMetrics, hourly); the row is registered by this file and the first write follows within the hour', 'the next hourly tick of personal-companion 1.45.2 or later writes a value', 'personal-companion');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
  ('companion_pieces_published_7d', 'publishing', 'EK-CLOSEOUT-1 2026-11-05: pieces written in 7 days; the cause is a stage of the reading pipeline (the contested-topic source gate blocked 26-29 runs a day 2026-10-29..11-03; fact-check rejects follow), read from companion_runs by stage.'),
  ('companion_balance_scored_share_last5', 'publishing', 'EK-CLOSEOUT-1 2026-11-05: the even-keel reviewer returned unavailable for every piece 2026-10-28..11-04; a low share is a reviewer-family or fail-open defect in balanceCheck.'),
  ('companion_balance_hold_share_7d', 'publishing', 'EK-CLOSEOUT-1 2026-11-05: share of drafts the even-keel check stops; a high share is the check becoming a wall in front of publication.'),
  ('companion_independent_source_pieces_30d', 'publishing', 'EK-CLOSEOUT-1 2026-11-05: pieces written on publishers beyond Wikipedia and arXiv; zero means the contested-topic supplier (Hansard, Global Voices, GOV.UK) produced no accepted topic.');

-- ---- the roadmap rows, each with the evidence read (never set before it) --------------------------------------------------------------------------------------------------------------------------
UPDATE roadmap_implementation
SET status = 'built', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = 'W2-G 2026-11-05, read live after PR 7481 (personal-companion 1.45.1; /health now 1.45.2): companion_pieces holds 2 of 101 rows with no stored lede (2026-11-04-essay-ab276e35317492a4 and 2026-10-25-notes-3840be19d5dd6659); https://reading.q08.org/p/<each slug> returns 200 with exactly one class=lede paragraph (the opening paragraph of the body) plus the AI label and the sources footer, and the index preview shows the same text. The probe piece 2026-10-27-notes-73c73cae08c3e06f keeps class=lede. Remainder, filed with a doer: the RSS item of a piece with no stored lede still has an empty description (READING-FEED-LEDE-1).'
WHERE id = 1748 AND item = 'EK-1' AND status = 'planned';

UPDATE roadmap_implementation
SET status = 'deployed', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = 'W2-G 2026-11-05: PR 7551 merged 2026-11-05T03:15:59Z, https://reading.q08.org/health reads version 1.45.2 (the Hansard, Global Voices and GOV.UK supplier for contested candidates). Outcome not yet proven: companion_independent_source_pieces_30d reads 0 (no visible piece cites a publisher beyond Wikipedia and arXiv) and the next generation hours are 04, 08, 12 UTC. Why it matters, measured: companion_runs shows 26-29 runs a day blocked by the contested-topic gate (only 1 full-text source, topic dropped) on 2026-10-29..11-03 and 19 on 11-04, 0 on any day before 10-29; pieces written fell from 9 (2026-10-22..28) to 3 (2026-10-29..11-05). Verified live when companion_independent_source_pieces_30d >= 1 (closing probe of agent_issues 1000713, replaced below); guard: companion_pieces_published_7d must not fall.'
WHERE id = 1749 AND item = 'EK-2' AND status = 'planned';

UPDATE roadmap_implementation
SET status = 'built', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = 'W2-G 2026-11-05, read live: PR 7449 (1.45.0) and PR 7551 deployed; companion_audits newest passing row 2026-11-05T02:06:12Z carries balance_score 88, the first score after 20 passing rows with NULL from 2026-10-28 (the reviewer family never existed); companion_balance_scored_share_last5 reads 0.2 (1 of 5) and moves to 1.0 as five pieces pass. Guard read: companion_audits 27 of 27 pass since 2026-10-15 and companion_runs has 0 rows stopped at stage balance, so the check is not a wall (companion_balance_hold_share_7d is registered with a 0.6 trigger by this migration). Not proven: one scored piece is one sample; the one-sided-draft path (revise once, then hold) has not fired live.'
WHERE id = 1750 AND item = 'EK-3' AND status = 'planned';

UPDATE roadmap_implementation
SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = 'W2-G 2026-11-05: PR 7382 (personal-companion 1.44.17) moved the form into _shared/analysis-form.js, inlined into personal-companion/worker.js between the ANALYSIS-FORM-1 markers by _shared/inline-analysis-form.mjs (68 references; the issue-1000716 code-read contract passes). q08-signal-engine/worker.js and qnfo-research-exec/worker.js hold 0 references: q08 writes its policy and science form in its own domainForm (Q08-DOMAIN-FORM-1, 0.44.0) and research keeps separate writers. Next slice filed with a doer: EK-6-ADOPT-1 (q08-signal-engine adopts the shared constants).'
WHERE id = 1753 AND item = 'EK-6' AND status = 'planned';

-- ---- closing probes that measure the outcome (the old ones counted papers and AI queries, or compared a status with itself) -----------------------------------------------------------------------
UPDATE remediation_contracts
SET status = 'active', verify_transport = 'd1-query',
    verify_probe = 'SELECT ''1'' AS expected, CASE WHEN COALESCE((SELECT last_refreshed FROM metric_registry WHERE metric = ''companion_balance_scored_share_last5''), '''') < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-3 hours'') THEN ''0'' WHEN CAST(COALESCE((SELECT last_value FROM metric_registry WHERE metric = ''companion_balance_scored_share_last5''), ''0'') AS REAL) >= 0.6 THEN ''1'' ELSE ''0'' END AS observed'
WHERE class = 'issue-1000714';

UPDATE remediation_contracts
SET status = 'active', verify_transport = 'd1-query',
    verify_probe = 'SELECT ''1'' AS expected, CASE WHEN COALESCE((SELECT last_refreshed FROM metric_registry WHERE metric = ''companion_independent_source_pieces_30d''), '''') < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-3 hours'') THEN ''0'' WHEN CAST(COALESCE((SELECT last_value FROM metric_registry WHERE metric = ''companion_independent_source_pieces_30d''), ''0'') AS REAL) >= 1 THEN ''1'' ELSE ''0'' END AS observed'
WHERE class = 'issue-1000713';

-- ---- the closing probes of the roadmap rows themselves: a built or deployed row is verified by the steward only from a passing rm-<id> contract (ROADMAP-BUILT-VERIFY-1) ------------------------
-- rm-1748 reads the page of the piece that has NO stored lede (a piece with one passes without the EK-1 change); rm-1750 reads the scored share; rm-1749 reads the independent-source count.
INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
SELECT 'rm-1748', NULL, 'ROADMAP-BUILT-VERIFY-1: roadmap item EK-1 (id 1748) is built and waits for its closing probe',
 'EK-1: PR 7481 (personal-companion 1.45.1) is on main; the piece 2026-11-04-essay-ab276e35317492a4 has an empty stored lede and its page must show the set-apart lede (afShownLede lifts the opening paragraph of the body)',
 '{"url": "https://reading.q08.org/p/2026-11-04-essay-ab276e35317492a4", "status": 200, "contains": "class=lede", "max_ms": 10000}',
 'runner-https', 48, 'qnfo-github-steward', 1, 'active', 'roadmap-dod-v1', datetime('now')
FROM roadmap_implementation WHERE id = 1748 AND item = 'EK-1' AND status IN ('built', 'deployed', 'implemented');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
SELECT 'rm-1750', NULL, 'ROADMAP-BUILT-VERIFY-1: roadmap item EK-3 (id 1750) is built and waits for its closing probe',
 'EK-3: personal-companion 1.45.0 (PR 7449) and 1.45.2 (PR 7551) are on main; the even-keel check answers for the pieces that pass: companion_balance_scored_share_last5 reaches 0.6 (three of the five newest passing audits carry a score), refreshed within 3 hours',
 'SELECT ''1'' AS expected, CASE WHEN COALESCE((SELECT last_refreshed FROM metric_registry WHERE metric = ''companion_balance_scored_share_last5''), '''') < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-3 hours'') THEN ''0'' WHEN CAST(COALESCE((SELECT last_value FROM metric_registry WHERE metric = ''companion_balance_scored_share_last5''), ''0'') AS REAL) >= 0.6 THEN ''1'' ELSE ''0'' END AS observed',
 'd1-query', 168, 'qnfo-github-steward', 1, 'active', 'roadmap-dod-v1', datetime('now')
FROM roadmap_implementation WHERE id = 1750 AND item = 'EK-3' AND status IN ('built', 'deployed', 'implemented');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
SELECT 'rm-1749', NULL, 'ROADMAP-BUILT-VERIFY-1: roadmap item EK-2 (id 1749) is deployed and waits for its closing probe',
 'EK-2: personal-companion 1.45.2 (PR 7551) is on main and the supplier answers in the run log (2026-11-05 04:00Z: hansard, globalvoices and govuk each asked for four contested candidates, all four returned none); verified when a visible piece cites a publisher beyond Wikipedia and arXiv (companion_independent_source_pieces_30d >= 1)',
 'SELECT ''1'' AS expected, CASE WHEN COALESCE((SELECT last_refreshed FROM metric_registry WHERE metric = ''companion_independent_source_pieces_30d''), '''') < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-3 hours'') THEN ''0'' WHEN CAST(COALESCE((SELECT last_value FROM metric_registry WHERE metric = ''companion_independent_source_pieces_30d''), ''0'') AS REAL) >= 1 THEN ''1'' ELSE ''0'' END AS observed',
 'd1-query', 336, 'qnfo-github-steward', 1, 'active', 'roadmap-dod-v1', datetime('now')
FROM roadmap_implementation WHERE id = 1749 AND item = 'EK-2' AND status IN ('built', 'deployed', 'implemented');

-- ---- the failure mode and its detector --------------------------------------------------------------------------------------------------------------------------------------------------------------
INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES
  ('reading-yield-collapse',
   'the reading desk publishes a third of its earlier supply for a week and nothing measures the supply, only the hours since the last piece',
   'the contested-topic source gate shipped without a supplier (EK-2): 26-29 runs a day were blocked from 2026-10-29, and the stall detector reads the hours since a piece, which a slow trickle of one piece every 2 to 3 days keeps under its 120 minute rule only when a run succeeds',
   'companion_pieces_published_7d is refreshed hourly by companion_yield_tick; the trigger files a diagnosis issue under 3 and this detector fails when the reading stops',
   'fm-reading-yield-collapse: companion_pieces_published_7d not refreshed in 3 hours, or under 3',
   'fm-reading-yield-collapse', '2026-11-05', NULL,
   'the metric row is missing, its last_refreshed is older than 3 hours, or its value is under 3',
   'readers get one piece every few days while the desk keeps running and spending',
   'reading.q08.org readers, the companion feed and mail, personal-companion generation spend');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status)
VALUES
  ('fm-reading-yield-collapse', NULL,
   'metric_registry holds companion_pieces_published_7d and trigger companion_yield_tick exists on fleet_tick',
   'failure-mode detector: read the run log by day and stage (personal-life D1, counts only); a contested-topic gate block points at wikiAnchors and the EK-2 supplier, fact-check rejects at factCheck; a stale reading means the companion_yield_tick trigger or v_companion_yield_7d is broken (EXPLAIN a zero-row INSERT INTO fleet_tick)',
   'SELECT ''1'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM metric_registry WHERE metric = ''companion_pieces_published_7d'') THEN ''0'' WHEN COALESCE((SELECT last_refreshed FROM metric_registry WHERE metric = ''companion_pieces_published_7d''), '''') < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-3 hours'') THEN ''0'' WHEN CAST(COALESCE((SELECT last_value FROM metric_registry WHERE metric = ''companion_pieces_published_7d''), ''0'') AS REAL) < 3 THEN ''0'' ELSE ''1'' END AS observed',
   'd1-query', 3, 'personal-companion', 1, 'active');

-- ---- what the read found, each with a doer and a closing probe ----------------------------------------------------------------------------------------------------------------------------------------
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'READING-FEED-LEDE-1: the RSS feed and the page head show nothing for a piece with no stored lede (the EK-1 lede is on the page and the index only)',
'Pillar reach, program QNFO.REACH, roadmap EK-1 (row 1748). Read live 2026-11-05: https://reading.q08.org/feed.xml holds an item for 2026-11-04-essay-ab276e35317492a4 with an empty description element, because feedXml selects the stored lede only while renderIndex and renderPiece read afShownLede(p) (which lifts the opening paragraph of the body). Every page also carries one generic meta description, so a shared link previews the same sentence for every piece.
Fix: in personal-companion/worker.js feedXml select substr(body_md, 1, 1500) beside lede and use afShownLede(r) for the description (400 characters); in renderPiece pass a per-piece meta description and og:title/og:description (the shown lede, 200 characters, escaped) through the extraHead argument of page(). Add a regression test beside personal-companion/no-source-lede.test.mjs for a piece with no stored lede in the feed and in the head. Counts and text of public pages only; nothing leaves the personal plane.
work-claim: personal-companion/worker.js is claimed by session breach-cost (COST-COMPANION-1, PR 7618) until 05:17Z; session W2-G-even-keel takes this when the claim lapses, the code loop otherwise.
code-task: repo=qnfo-workers path=personal-companion/worker.js
code-anchor: async function feedXml(env, u) {
runtime-probe: {"url": "https://reading.q08.org/feed.xml", "status": 200, "absent": "<description></description>"}',
'session:W2-G-even-keel', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'READING-FEED-LEDE-1:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'READING-HEALTH-ACCURACY-1: /health accuracy reports "retracted 74" for 74 legacy withdrawals and no audit failure, which reads as a 73 percent retraction rate',
'Pillar reach, program QNFO.REACH. Read live 2026-11-05 (personal-life D1, counts only): companion_retractions has 74 rows, all retracted_at 2026-10-10 with the reason "no source material was recorded" (pieces written before the source record existed; audit verdict unverifiable, stage no-source-record); companion_audits has 27 pass rows (2026-10-15 to 2026-11-05) and 0 fail rows. https://reading.q08.org/health prints accuracy passed 27, retracted 74, unaudited 0: a cumulative count that mixes a one-time withdrawal with audit outcomes, so it reads as a 73 percent failure rate that does not exist.
Fix: in personal-companion/worker.js split the accuracy object into passed, retracted_after_audit (audit verdict fail), withdrawn_no_source_record (audit stage no-source-record) and unaudited, plus passed_share_audited (passed over passed + retracted_after_audit, null when 0). Keep the old keys for one release so no reader of /health breaks. Add a test next to personal-companion/even-keel.test.mjs.
work-claim: personal-companion/worker.js is claimed by session breach-cost until 05:17Z; session W2-G-even-keel takes this when the claim lapses, the code loop otherwise.
code-task: repo=qnfo-workers path=personal-companion/worker.js
code-anchor: async function companionStallDetector(env, nowMs) {
runtime-probe: {"url": "https://personal-companion.q08.workers.dev/health", "status": 200, "contains": "withdrawn_no_source_record"}',
'session:W2-G-even-keel', 'optimization', 'low', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'READING-HEALTH-ACCURACY-1:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'EK-6-ADOPT-1: q08-signal-engine writes its policy and science form in its own domainForm; the shared analysis-form module (EK-6) is inlined into personal-companion only',
'Pillar reach, program QNFO.REACH, roadmap EK-6 (row 1753, now partial). Read 2026-11-05: _shared/analysis-form.js is inlined into personal-companion/worker.js (68 references) by _shared/inline-analysis-form.mjs; q08-signal-engine/worker.js and qnfo-research-exec/worker.js have 0 references. q08 0.44.0 (Q08-DOMAIN-FORM-1) added domainForm(domain) with its own wording of the structural-reading, objection and even-keel rules, so a form improvement lands twice.
Fix (first slice, q08 only): run node _shared/inline-analysis-form.mjs q08-signal-engine --anchor "<first line of the block insertion point>" to add the ANALYSIS-FORM-1 block, then build the text of domainForm from AF_SYSTEMS_RULE, AF_OBJECTION_RULE and AF_EVEN_KEEL_RULE with the policy and science wording kept as the only local part. Keep q08 behaviour identical (its tests: q08-signal-engine/*.test.mjs) and bump with scripts/worker_release.py. Research-exec adoption is the second slice.
code-task: repo=qnfo-workers path=q08-signal-engine/worker.js
code-anchor: function domainForm(domain) {
code-probe: {"paths": ["q08-signal-engine/worker.js"], "contains": "ANALYSIS-FORM-1:BEGIN"}',
'session:W2-G-even-keel', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'EK-6-ADOPT-1:%' AND status = 'open');

-- ---- the decision and its prediction, in the parsed form ---------------------------------------------------------------------------------------------------------------------------------------
INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:W2-G-even-keel',
  'the number of pieces readers get in a week is the outcome of the EK-2 supplier and the EK-3 check; a verdict that waits for a session to read the run log is a loose end',
  'EK-CLOSEOUT-1: register the EK measures personal-companion already writes plus companion_pieces_published_7d, replace the circular closing probes of issues 1000713 and 1000714, set the EK rows with the evidence read',
  'signals reading:* 9 pieces 2026-10-22..28 and 3 in 2026-10-29..11-05; companion_runs blocked by the contested-topic gate 26-29 a day 2026-10-29..11-03, 19 on 11-04, 0 before; companion_audits 27 pass, 0 fail; companion_retractions 74, all 2026-10-10, no source record; personal-companion /health 1.45.2; newest audit balance_score 88.',
  'pending',
  'four registry rows, three triggers, one view and one fleet_tick trigger, two contract probes, three issues, four roadmap rows; no worker and no cron',
  'the Rollback line of migrations/2026-11-05-ek-closeout-1.sql; bak_20261105_ek_closeout holds the prior roadmap rows and contract probes',
  'reading-yield-verdict',
  'companion_pieces_published_7d >= 6 within 192 h',
  'Readers: more pieces a week on contested topics from independent sources; reading.q08.org is the surface.',
  'reading.q08.org index, piece pages, feed.xml and /health read live; personal-life D1 counts; scripts/apply_migrations.py --check'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'EK-CLOSEOUT-1:%');

INSERT OR IGNORE INTO capability_ledger
  (capability, provenance, prerequisites, reliability, acquired_at, evidence)
VALUES
  ('reading-yield-verdict', 'migrations/2026-11-05-ek-closeout-1.sql',
   'signals mirror of published reading pieces, fleet_tick, calibration_scorer_tick',
   0.5, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
   'The weekly output of the reading desk is a registered, triggered metric with a prediction the calibration scorer settles; the EK-2 supplier gets its verdict from the hourly loop.');
