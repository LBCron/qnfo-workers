-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS remediation_verification_dedupe_detector_ins; DELETE FROM control_alternate_probes WHERE control = 'verification-dedupe-detectors'; DELETE FROM control_registry WHERE control = 'verification-dedupe-detectors';
-- CAUSE-MAPPED: registers no metric_registry row.
-- C4-FM5-DETECTOR-DEDUPE-1 (2026-11-05, charter pillar cost; roadmap_implementation 1758 FM-5; slice 1 of issue ROADMAP-1: QNFO.OPS #fm5-issueless-dedupe, filed by PR 7398).
-- Measured 2026-11-04T17:27Z to 23:43Z (qnfo-audit): 5,166 rows inserted into remediation_verifications, 4,441 with issue_id NULL, and about 4,100 of those equal the previous row of their class in
-- pass, expected and observed. VERIFICATION-DEDUPE-1 (remediation_verification_dedupe_ins) only fires with an issue_id. The largest repeat group is the standing detectors: fm- d1-query passing
-- 1,076 of 1,139 rows, fm- code-read passing 359 of 363. FM-CADENCE-1 (2026-11-05, c9-failure-modes) then exempted fm- and belief- contracts from the steady-state back-off so each is probed every
-- 22 to 45 minutes (v_failure_mode_status calls a detector unprobed after 60 minutes) and states the price itself: fm- rows a day go from about 4,000 to about 11,000.
-- The freshness a detector needs is the newest verified_at and the newest pass; neither needs a new row when the new row repeats the old one. The trigger below touches the previous row instead of
-- inserting when ALL of these hold: the row is a pass of an issue-less class starting with fm- or belief- (case-sensitive GLOB) on a transport other than runner-https and external-https; the previous
-- row of the class is also an issue-less pass with the same expected, observed, transport and probe_url (so a row written by another writer, such as scripts/trigger_depth_sweep.py whose rows the closing probe
-- of issue 1001212 selects by verifier, is never refreshed by the consumer, and a probe on another transport never refreshes a trusted row past the transport guard); the new row is not older than the previous
-- one (a restore or backfill with an old timestamp is stored, not allowed to move the latest row back); and both fall on the same UTC day. The last condition is the daily checkpoint: the first probe of each
-- UTC day is stored, so a stable detector keeps one row per day, stays inside both windows of v_output_quality_remediation_cohort (which needs a row in the current and the previous week) and in the
-- per-day rollup and the id-ordered archive of scripts/cold_tier.py, which both assume that rows follow time.
-- Kept as rows: every failing row (v_belief_status.falsification_hits and the recurrence counters count them), every flip of pass, expected or observed, every runtime row (runtime_verified_share_24h is
-- their share and must not fall; 12.7 on 2026-11-04), every issue-linked row (its own trigger), the first probe of each UTC day. Readers checked on the live definitions: v_failure_mode_status and
-- v_belief_status read MAX(verified_at) and the newest row's pass (touch-safe), recurrence_guard_tick and remediation_reopen_on_relapse_d1 are issue-linked or fail-only, the UPDATE guards
-- (evidence_guard_upd, transport_guard_upd) fire on columns this touch does not write, the writers (scripts/remediation_consumer.py, qnfo-fleet-control rtRemediationTick) never read back an insert.
-- Independent review (a second reader, 2026-11-05) found the verifier, transport, timestamp and day-window cases above; each is a test in migrations/c4-fm5-detector-dedupe.test.mjs.
-- Kill switch: ops_config verification_dedupe = off (the same key as VERIFICATION-DEDUPE-1) stores every row again without a deploy.
-- Left in the issue: the failing repeats of goal-* classes (1,424 rows in 5.3 hours, 244 classes: v_goal_dod counts failing rows since the last pass, so that view must count a touched row first)
-- and the runtime probes.
-- Prediction (metric, direction, size): fm- and belief- rows inserted per day about one per detector per UTC day (some 450) instead of the 11 thousand FM-CADENCE-1 projects (the id range of the last 3000
-- inserts holds about 40 percent fm-/belief- rows now and falls to about 15 percent within 6 hours); failure_modes_unprobed_pct and failure_modes_recurring do not rise (verified_at of the touched row
-- stays fresh); runtime_verified_share_24h rises (the non-runtime denominator shrinks), remediation_latest_pass_pct_7d (62.7) and issue_wontfix_share_7d (0.0) not worse.
-- Falsified if a detector reads unprobed while its contract passes (then the touch missed it: switch off and read).

CREATE TRIGGER IF NOT EXISTS remediation_verification_dedupe_detector_ins BEFORE INSERT ON remediation_verifications
WHEN NEW.class IS NOT NULL AND NEW.issue_id IS NULL AND NEW.pass = 1
  AND (NEW.class GLOB 'fm-*' OR NEW.class GLOB 'belief-*')
  AND COALESCE(NEW.transport, '') NOT IN ('runner-https', 'external-https')
  AND COALESCE((SELECT value FROM ops_config WHERE key = 'verification_dedupe'), 'on') <> 'off'
  AND EXISTS (SELECT 1 FROM (SELECT pass, expected, observed, issue_id, transport, probe_url, verified_at FROM remediation_verifications WHERE class = NEW.class ORDER BY id DESC LIMIT 1) p
              WHERE p.pass = 1 AND p.issue_id IS NULL AND p.expected IS NEW.expected AND p.observed IS NEW.observed
                AND p.transport IS NEW.transport AND p.probe_url IS NEW.probe_url
                AND date(p.verified_at) = date(NEW.verified_at) AND julianday(NEW.verified_at) >= julianday(p.verified_at))
BEGIN
  UPDATE remediation_verifications SET verified_at = NEW.verified_at, verifier = COALESCE(NEW.verifier, verifier)
  WHERE id = (SELECT id FROM remediation_verifications WHERE class = NEW.class ORDER BY id DESC LIMIT 1);
  SELECT RAISE(IGNORE);
END;

INSERT OR IGNORE INTO control_registry (control, location, kind, guards_against, critical_path, disposition, disposition_state, alternate_path, evidence)
VALUES ('verification-dedupe-detectors', 'trigger remediation_verification_dedupe_detector_ins on remediation_verifications', 'filter',
  'row growth and scan cost from identical passing repeats of standing detectors (fm-, belief-) that FM-CADENCE-1 probes every 22 to 45 minutes',
  0, 'keep', 'applied', 'ops_config verification_dedupe = off stores every row again without a deploy (offline suite migrations/c4-fm5-detector-dedupe.test.mjs); the first probe of each UTC day is always stored',
  '2026-11-04 17:27Z to 23:43Z: 4,441 of 5,166 inserts had no issue, about 4,100 repeated the previous row; fm- passing repeats 1,435; FM-CADENCE-1 projects fm- rows from 4,000 to 11,000 a day');

INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note, enabled)
VALUES ('verification-dedupe-detectors',
  'SELECT ''ok'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM ops_config WHERE key = ''verification_dedupe'') OR EXISTS (SELECT 1 FROM ops_config WHERE key = ''verification_dedupe'' AND value IN (''on'', ''off'')) THEN ''ok'' ELSE ''ops_config verification_dedupe holds a value the triggers do not read (use on or off), so the kill switch cannot be trusted'' END AS observed',
  '60', 1);

UPDATE agent_issues
SET description = description || char(10) || char(10) || 'C4-FM5-DETECTOR-DEDUPE-1 (2026-11-05): slice 1 shipped. An identical passing repeat of an issue-less fm- or belief- standing detector (same expected, observed, transport and probe_url, same UTC day, transport other than runner-https and external-https) touches verified_at and verifier of the previous row instead of inserting; the first probe of each UTC day is stored (trigger remediation_verification_dedupe_detector_ins, kill switch ops_config verification_dedupe = off). Left in this issue: (1) the failing repeats of goal-* classes, 1,424 rows in 5.3 hours over 244 classes: v_goal_dod counts failing rows since the last pass (fails_since_pass), so that view has to count a touched row (verified_at span or contract attempts) before those repeats are deduped; (2) the runtime probes (rt-*, runner-https), whose rows are the numerator of runtime_verified_share_24h. The closing probe below is unchanged.'
WHERE title LIKE 'ROADMAP-1: QNFO.OPS #fm5-issueless-dedupe:%' AND status = 'open' AND instr(COALESCE(description, ''), 'C4-FM5-DETECTOR-DEDUPE-1') = 0;

UPDATE roadmap_implementation
SET evidence = evidence || ' | C4-FM5-DETECTOR-DEDUPE-1 (2026-11-05): slice 1 of the issue-less dedupe is live: identical passes of fm- and belief- standing detectors touch the previous row, one stored row per detector per UTC day (trigger remediation_verification_dedupe_detector_ins); FM-CADENCE-1 probes those detectors every 22 to 45 minutes, which would have added about 7,000 rows a day.'
WHERE id = 1758 AND instr(COALESCE(evidence, ''), 'C4-FM5-DETECTOR-DEDUPE-1') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:c4-fm',
  'a detector needs a fresh verified_at and a current pass, not a new row for every identical answer; freshness and row cost are separate requirements',
  'C4-FM5-DETECTOR-DEDUPE-1: BEFORE INSERT trigger touches the previous row for an identical passing repeat of an issue-less fm- or belief- class on a non-runtime transport within one UTC day; control and alternate probe registered',
  '2026-11-04T17:27Z to 23:43Z: 4,441 of 5,166 inserts issue-less, about 4,100 repeats, fm- passing repeats 1,435; FM-CADENCE-1 (2026-11-05) states fm- rows go from about 4,000 to about 11,000 a day; readers checked on live definitions and by an independent review',
  'pending canonical migration; measured by the share of fm-/belief- rows in the last 3000 ids and failure_modes_unprobed_pct',
  'remediation_verifications inserts for fm- and belief- classes on d1-query and code-read transports; no other writer or reader changes',
  'ops_config verification_dedupe = off (instant), or the Rollback line of migrations/2026-11-05-c4-fm5-detector-dedupe.sql',
  'standing detectors keep a fresh verified_at without a row per probe',
  'fm- and belief- inserts per day about one per detector per UTC day instead of 11 thousand; failure_modes_unprobed_pct, failure_modes_recurring and runtime_verified_share_24h do not worsen',
  'not a reach change; D1 row growth and scan cost',
  'node:sqlite suite migrations/c4-fm5-detector-dedupe.test.mjs (repeat pass touched, flip stored, failing rows kept, runtime transports kept, issue-linked rows untouched, other writers, transport and probe_url mismatch, old timestamp, day checkpoint, kill switch, coexistence with VERIFICATION-DEDUPE-1 and the guards)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:c4-fm' AND capability_gain = 'standing detectors keep a fresh verified_at without a row per probe');
