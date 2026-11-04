-- RELAPSE-HOLD-1 (2026-11-04, charter pillar autonomy; issue-closing quality, NEVER-STOP-1 owner directive 2026-11-04).
-- Evidence (qnfo-audit issue_lifecycle, 7 days to 2026-11-04T16:36Z): 989 opened, 1,334 dispositioned, 661 reopened; the last 24 h 304 closes and 150 reopens (CF-OBS 67/97, METRIC-TRIGGER 38/38, FLEET-JOURNEY 16/19, CRON-FAULT 15/30, all other families 14/120), so about half of the closes did not hold
-- (closure_branching_ratio_24h 0.509, target 0.2, trigger 9510). 236 of the 661 reopens were the issue's first reopen, 425 were repeats. By family (reopens / closes, 7 days): METRIC-TRIGGER 224/221,
-- CF-OBS-ISSUE-1 114/216, FLEET-JOURNEY-FAILED-1 88/109, SLO-POSTMORTEM-ACTION-1 65/66 (one issue, 1000808; open since 2026-11-03T06:58Z on a failing probe, no reopen since), METRIC-REGRESSION-1 38/61. Time from close to reopen: 28 % under 1 h,
-- 44 % under 2 h, 70 % under 6 h.
-- Three causes, each read from rows:
--   1. The two-pass rule counted a pass made BEFORE the reopen as the first of two. Issue 1001278 was reopened 10:42Z (2026-11-02), its next probe row at 10:53Z passed and the previous pass was 10:23Z, so one
--      post-reopen pass closed it again (4 reopens). 352 of 583 reopens had no verification row at all between close and reopen, 137 had only passes: the probe did not see the relapse.
--   2. The first close in a family that already relapses took one pass (reopened_count = 0 skipped every check).
--   3. The CF-OBS-ISSUE-1 birth probe passes when the Cloudflare group is `resolved`. Cloudflare sets that 12 to 120 s after a burst ends (fleet_issue_dispatch payload statusUpdated minus lastObserved:
--      1001291 25 s, 1001278 12 s), so the probe passes seconds after the last error, and the next burst reopens the issue. Two closed issues (100560, 1000144) read status active with errors every few minutes.
-- Change: (a) v_issue_close_hold gives each issue a hold in minutes: 120 after three or more reopens, 60 after one or two, 20 when its family is in issue_recurrence_now with a reopen in 7 days, else 0
--   (unchanged first-pass close); ops_config relapse_close_hold = off sets every hold to 0 without a deploy. (b) remediation_verification_autoclose_ins/_upd close an issue with a hold only when the
--   previous verification of the class passed and the passes since the last reopen and the last failure span at least the hold (all other clauses byte for byte as of 2026-11-03, plus an early
--   issue-is-open check that the body already applied). (c) The CF-OBS birth triggers and the contracts of OPEN CF-OBS issues (and of closed ones whose group has been quiet for six hours) drop the
--   resolved-status shortcut: a group passes when it has no usable observation time (resolved) or has been quiet for six hours. The 24 closed issues whose group was seen within six hours keep
--   the old probe for now, so nothing reopens by this migration (live 2026-11-04: of 77 closed contracts 53 quiet and 24 seen within six hours, of 53 open contracts 52 seen within six hours); a follow-up retunes them after the 24 h reading. (d) v_issue_relapse_7d and the metric
--   issue_relapse_families_7d (families with 5 or more closes and a relapse rate above 0.5) with its trigger and cause. (e) Three follow-up code tasks for the closers outside these triggers (two journey closers, the improvement loop), which close on the first passing reading.
-- Prediction (decision_log): closure_branching_ratio_24h 0.509 falls to 0.35 or lower within 7 days, reopens per 24 h 149 to 105 or fewer, CF-OBS reopens per 24 h 67 to 35 or fewer.
--   Guards: issue_wontfix_share_7d stays at most 1, remediation_latest_pass_pct_7d does not fall below 60. Cost, disclosed: held issues stay open up to 120 minutes longer after their first pass,
--   so issues_open_over_120m and open_agent_issues can rise by the number of relapsing issues closed in that window (tolerance +40 and +60); a rise beyond that reverts the hold with the kill switch.
-- Rollback: set ops_config relapse_close_hold = off (hold 0, instant); full: DROP TRIGGER IF EXISTS remediation_verification_autoclose_ins, _upd, contract_probe_templates_family_birth and _reassert, recreate the four from the rows kind 'trigger' of bak_20261104_relapse_hold, restore contracts from its kind 'contract' rows (verify_probe, action), DROP VIEW IF EXISTS v_issue_close_hold, v_issue_relapse_7d, DROP TRIGGER IF EXISTS issue_relapse_families_tick, DELETE the metric, trigger and cause rows of issue_relapse_families_7d, DELETE the rows of relapse-close-hold from control_alternate_probes and control_registry.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_relapse_hold

CREATE TABLE IF NOT EXISTS bak_20261104_relapse_hold (
  kind TEXT NOT NULL,
  record_key TEXT NOT NULL,
  old_value TEXT NOT NULL,
  PRIMARY KEY (kind, record_key)
);

INSERT OR IGNORE INTO bak_20261104_relapse_hold (kind, record_key, old_value)
SELECT 'trigger', name, sql FROM sqlite_master
WHERE type = 'trigger' AND name IN ('remediation_verification_autoclose_ins', 'remediation_verification_autoclose_upd',
                                   'contract_probe_templates_family_birth', 'contract_probe_templates_family_reassert');

INSERT OR IGNORE INTO bak_20261104_relapse_hold (kind, record_key, old_value)
SELECT 'contract', k.class, json_object('verify_probe', k.verify_probe, 'action', k.action, 'status', k.status)
FROM remediation_contracts k
WHERE k.module = 'issue-birth-probe-families'
  AND instr(k.verify_probe, 'state = ''resolved'' OR (state <> ''resolved'' AND json_valid(payload) AND') > 0;

-- The close hold of an issue, in minutes of continuous passing verification after its last reopen (0 = the first pass closes it, as before).
DROP VIEW IF EXISTS v_issue_close_hold;
CREATE VIEW v_issue_close_hold AS
SELECT x.issue_id, x.family, x.reopened_count,
  CASE WHEN COALESCE((SELECT o.value FROM ops_config o WHERE o.key = 'relapse_close_hold'), 'on') = 'off' THEN 0
       WHEN x.reopened_count >= 3 THEN 120
       WHEN x.reopened_count >= 1 THEN 60
       WHEN EXISTS (SELECT 1 FROM issue_recurrence_now r WHERE r.family = x.family AND r.reopens_7d >= 1) THEN 20
       ELSE 0 END AS hold_min
FROM (
  SELECT a.id AS issue_id,
    COALESCE((SELECT t.reopened_count FROM issue_triage t WHERE t.issue_id = a.id), 0) AS reopened_count,
    CASE WHEN a.title LIKE 'METRIC-TRIGGER-%' THEN substr(a.title, 1, 14 + instr(substr(a.title, 16), '-'))
         ELSE substr(a.title, 1, MIN(CASE WHEN instr(a.title, ' ') > 0 THEN instr(a.title, ' ') ELSE 999 END,
                                      CASE WHEN instr(a.title, ':') > 0 THEN instr(a.title, ':') ELSE 999 END) - 1) END AS family
  FROM agent_issues a
) x;

-- Relapse by family over 7 days: closes that did not hold. family is the coarse key of v_issue_family_throughput (METRIC-TRIGGER is one family).
DROP VIEW IF EXISTS v_issue_relapse_7d;
CREATE VIEW v_issue_relapse_7d AS
WITH per_issue AS (
  SELECT l.issue_id,
    CASE WHEN a.title LIKE 'METRIC-TRIGGER-%' THEN 'METRIC-TRIGGER'
         ELSE substr(a.title, 1, MIN(CASE WHEN instr(a.title, ' ') > 0 THEN instr(a.title, ' ') ELSE 999 END,
                                      CASE WHEN instr(a.title, ':') > 0 THEN instr(a.title, ':') ELSE 999 END) - 1) END AS family,
    SUM(l.event = 'dispositioned') AS closes, SUM(l.event = 'reopened') AS reopens
  FROM issue_lifecycle l JOIN agent_issues a ON a.id = l.issue_id
  WHERE l.ts >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days') AND l.event IN ('dispositioned', 'reopened')
  GROUP BY l.issue_id
), ranked AS (
  SELECT p.issue_id, p.family, p.closes, p.reopens,
    ROW_NUMBER() OVER (PARTITION BY p.family ORDER BY p.reopens DESC, p.issue_id DESC) AS rn
  FROM per_issue p
)
SELECT r.family, SUM(r.closes) AS closes_7d, SUM(r.reopens) AS reopens_7d, SUM(r.reopens > 0) AS issues_reopened_7d,
  ROUND(1.0 * SUM(r.reopens) / MAX(1, SUM(r.closes)), 3) AS relapse_rate_7d, MAX(r.reopens) AS max_reopens_one_issue,
  MAX(CASE WHEN r.rn = 1 THEN r.issue_id END) AS worst_issue_id
FROM ranked r
WHERE r.family <> ''
GROUP BY r.family;

DROP TRIGGER IF EXISTS remediation_verification_autoclose_ins;
CREATE TRIGGER remediation_verification_autoclose_ins AFTER INSERT ON remediation_verifications
WHEN NEW.pass = 1
  AND EXISTS (SELECT 1 FROM agent_issues ao WHERE ao.id = NEW.issue_id AND ao.status = 'open')
  AND COALESCE(NEW.verifier, '') NOT LIKE 'qnfo-fleet-control/monitoring-pass@%'
  AND NOT EXISTS (
    SELECT 1
    FROM agent_issues a
    JOIN analytics_metric_triggers mt
      ON substr(a.title, 1, length('METRIC-TRIGGER-' || mt.id || '-')) = 'METRIC-TRIGGER-' || mt.id || '-'
    LEFT JOIN v_metric_trigger_state ms ON ms.id = mt.id
    WHERE a.id = NEW.issue_id AND mt.enabled = 1 AND COALESCE(ms.hit, 1) <> 0
  )
  AND NOT EXISTS (SELECT 1 FROM remediation_contracts c2 WHERE c2.issue_id = NEW.issue_id AND c2.class <> COALESCE(NEW.class, '')
                  AND c2.status IN ('active', 'holding')
                  AND (SELECT v2.pass FROM remediation_verifications v2 WHERE v2.class = c2.class AND COALESCE(v2.observed, '') <> ''
                       AND (lower(trim(v2.observed)) NOT LIKE 'pending%' OR (v2.observed GLOB '*[0-9]*' AND (v2.observed LIKE '%ceiling%' OR lower(v2.observed) LIKE '%target%' OR lower(v2.observed) LIKE '%threshold%' OR lower(v2.observed) LIKE '%limit%' OR lower(v2.observed) LIKE '%fewer than%' OR lower(v2.observed) LIKE '%more than%' OR v2.observed LIKE '% <= %' OR v2.observed LIKE '% >= %' OR v2.observed LIKE '% < %' OR v2.observed LIKE '% > %'))) ORDER BY v2.id DESC LIMIT 1) = 0)
  AND (NOT EXISTS (SELECT 1 FROM v_issue_close_hold h WHERE h.issue_id = NEW.issue_id AND (h.reopened_count > 0 OR h.hold_min > 0))
       OR ((SELECT v3.pass FROM remediation_verifications v3 WHERE v3.class = NEW.class AND v3.id < NEW.id AND COALESCE(v3.observed, '') <> '' AND (lower(trim(v3.observed)) NOT LIKE 'pending%' OR (v3.observed GLOB '*[0-9]*' AND (v3.observed LIKE '%ceiling%' OR lower(v3.observed) LIKE '%target%' OR lower(v3.observed) LIKE '%threshold%' OR lower(v3.observed) LIKE '%limit%' OR lower(v3.observed) LIKE '%fewer than%' OR lower(v3.observed) LIKE '%more than%' OR v3.observed LIKE '% <= %' OR v3.observed LIKE '% >= %' OR v3.observed LIKE '% < %' OR v3.observed LIKE '% > %'))) ORDER BY v3.id DESC LIMIT 1) = 1
           AND (SELECT CASE WHEN h2.hold_min = 0 THEN 1
                            WHEN (julianday(NEW.verified_at) - julianday((SELECT MIN(vr.verified_at) FROM remediation_verifications vr WHERE vr.class = NEW.class AND vr.pass = 1 AND vr.id <= NEW.id AND COALESCE(vr.observed, '') <> '' AND (lower(trim(vr.observed)) NOT LIKE 'pending%' OR (vr.observed GLOB '*[0-9]*' AND (vr.observed LIKE '%ceiling%' OR lower(vr.observed) LIKE '%target%' OR lower(vr.observed) LIKE '%threshold%' OR lower(vr.observed) LIKE '%limit%' OR lower(vr.observed) LIKE '%fewer than%' OR lower(vr.observed) LIKE '%more than%' OR vr.observed LIKE '% <= %' OR vr.observed LIKE '% >= %' OR vr.observed LIKE '% < %' OR vr.observed LIKE '% > %')))
                   AND vr.id > COALESCE((SELECT MAX(vf.id) FROM remediation_verifications vf WHERE vf.class = NEW.class AND vf.pass = 0 AND vf.id < NEW.id AND COALESCE(vf.observed, '') <> '' AND (lower(trim(vf.observed)) NOT LIKE 'pending%' OR (vf.observed GLOB '*[0-9]*' AND (vf.observed LIKE '%ceiling%' OR lower(vf.observed) LIKE '%target%' OR lower(vf.observed) LIKE '%threshold%' OR lower(vf.observed) LIKE '%limit%' OR lower(vf.observed) LIKE '%fewer than%' OR lower(vf.observed) LIKE '%more than%' OR vf.observed LIKE '% <= %' OR vf.observed LIKE '% >= %' OR vf.observed LIKE '% < %' OR vf.observed LIKE '% > %')))), 0)
                   AND julianday(vr.verified_at) > COALESCE((SELECT MAX(julianday(l.ts)) FROM issue_lifecycle l WHERE l.issue_id = NEW.issue_id AND l.event = 'reopened'), 0)))) * 1440.0 >= h2.hold_min THEN 1
                            ELSE 0 END
                FROM v_issue_close_hold h2 WHERE h2.issue_id = NEW.issue_id) = 1))
  AND NOT (COALESCE((SELECT t4.reopened_count FROM issue_triage t4 WHERE t4.issue_id = NEW.issue_id), 0) >= 1
           AND EXISTS (SELECT 1 FROM remediation_contracts cv WHERE cv.issue_id = NEW.issue_id AND cv.status IN ('active', 'holding') AND cv.action LIKE 'VACUOUS-PROBE%'))
BEGIN
  INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, close_evidence)
  SELECT NEW.issue_id, 'verified-remediation', 'closed', 'fleet-autoremediation', datetime('now','+7 days'),
         'remediation_verifications#' || NEW.id || ' pass=1 class=' || COALESCE(NEW.class,'') || ' transport=' || NEW.transport || ' verified_at=' || COALESCE(NEW.verified_at, datetime('now'))
  WHERE EXISTS (SELECT 1 FROM agent_issues WHERE id = NEW.issue_id AND status = 'open')
    AND NOT EXISTS (SELECT 1 FROM remediation_contracts cb WHERE cb.issue_id = NEW.issue_id AND cb.status IN ('active', 'holding')
                    AND COALESCE(cb.last_verdict, '') IN ('fail', 'vacuous-probe-result', 'probe-error', 'probe-not-machine-executable', 'probe-same-account-host'))
  ON CONFLICT(issue_id) DO UPDATE SET close_evidence = excluded.close_evidence WHERE COALESCE(issue_triage.close_evidence,'') = '';
  UPDATE agent_issues SET status='closed', close_channel='auto:verified-remediation-trigger', updated_at = CAST(strftime('%s','now') AS INTEGER)*1000
  WHERE id = NEW.issue_id AND status = 'open'
    AND NOT EXISTS (SELECT 1 FROM remediation_contracts cb WHERE cb.issue_id = NEW.issue_id AND cb.status IN ('active', 'holding')
                    AND COALESCE(cb.last_verdict, '') IN ('fail', 'vacuous-probe-result', 'probe-error', 'probe-not-machine-executable', 'probe-same-account-host'));
END;

DROP TRIGGER IF EXISTS remediation_verification_autoclose_upd;
CREATE TRIGGER remediation_verification_autoclose_upd AFTER UPDATE OF pass ON remediation_verifications
WHEN NEW.pass = 1 AND COALESCE(OLD.pass,0) <> 1
  AND EXISTS (SELECT 1 FROM agent_issues ao WHERE ao.id = NEW.issue_id AND ao.status = 'open')
  AND COALESCE(NEW.verifier, '') NOT LIKE 'qnfo-fleet-control/monitoring-pass@%'
  AND NOT EXISTS (
    SELECT 1
    FROM agent_issues a
    JOIN analytics_metric_triggers mt
      ON substr(a.title, 1, length('METRIC-TRIGGER-' || mt.id || '-')) = 'METRIC-TRIGGER-' || mt.id || '-'
    LEFT JOIN v_metric_trigger_state ms ON ms.id = mt.id
    WHERE a.id = NEW.issue_id AND mt.enabled = 1 AND COALESCE(ms.hit, 1) <> 0
  )
  AND NOT EXISTS (SELECT 1 FROM remediation_contracts c2 WHERE c2.issue_id = NEW.issue_id AND c2.class <> COALESCE(NEW.class, '')
                  AND c2.status IN ('active', 'holding')
                  AND (SELECT v2.pass FROM remediation_verifications v2 WHERE v2.class = c2.class AND COALESCE(v2.observed, '') <> ''
                       AND (lower(trim(v2.observed)) NOT LIKE 'pending%' OR (v2.observed GLOB '*[0-9]*' AND (v2.observed LIKE '%ceiling%' OR lower(v2.observed) LIKE '%target%' OR lower(v2.observed) LIKE '%threshold%' OR lower(v2.observed) LIKE '%limit%' OR lower(v2.observed) LIKE '%fewer than%' OR lower(v2.observed) LIKE '%more than%' OR v2.observed LIKE '% <= %' OR v2.observed LIKE '% >= %' OR v2.observed LIKE '% < %' OR v2.observed LIKE '% > %'))) ORDER BY v2.id DESC LIMIT 1) = 0)
  AND (NOT EXISTS (SELECT 1 FROM v_issue_close_hold h WHERE h.issue_id = NEW.issue_id AND (h.reopened_count > 0 OR h.hold_min > 0))
       OR ((SELECT v3.pass FROM remediation_verifications v3 WHERE v3.class = NEW.class AND v3.id < NEW.id AND COALESCE(v3.observed, '') <> '' AND (lower(trim(v3.observed)) NOT LIKE 'pending%' OR (v3.observed GLOB '*[0-9]*' AND (v3.observed LIKE '%ceiling%' OR lower(v3.observed) LIKE '%target%' OR lower(v3.observed) LIKE '%threshold%' OR lower(v3.observed) LIKE '%limit%' OR lower(v3.observed) LIKE '%fewer than%' OR lower(v3.observed) LIKE '%more than%' OR v3.observed LIKE '% <= %' OR v3.observed LIKE '% >= %' OR v3.observed LIKE '% < %' OR v3.observed LIKE '% > %'))) ORDER BY v3.id DESC LIMIT 1) = 1
           AND (SELECT CASE WHEN h2.hold_min = 0 THEN 1
                            WHEN (julianday(NEW.verified_at) - julianday((SELECT MIN(vr.verified_at) FROM remediation_verifications vr WHERE vr.class = NEW.class AND vr.pass = 1 AND vr.id <= NEW.id AND COALESCE(vr.observed, '') <> '' AND (lower(trim(vr.observed)) NOT LIKE 'pending%' OR (vr.observed GLOB '*[0-9]*' AND (vr.observed LIKE '%ceiling%' OR lower(vr.observed) LIKE '%target%' OR lower(vr.observed) LIKE '%threshold%' OR lower(vr.observed) LIKE '%limit%' OR lower(vr.observed) LIKE '%fewer than%' OR lower(vr.observed) LIKE '%more than%' OR vr.observed LIKE '% <= %' OR vr.observed LIKE '% >= %' OR vr.observed LIKE '% < %' OR vr.observed LIKE '% > %')))
                   AND vr.id > COALESCE((SELECT MAX(vf.id) FROM remediation_verifications vf WHERE vf.class = NEW.class AND vf.pass = 0 AND vf.id < NEW.id AND COALESCE(vf.observed, '') <> '' AND (lower(trim(vf.observed)) NOT LIKE 'pending%' OR (vf.observed GLOB '*[0-9]*' AND (vf.observed LIKE '%ceiling%' OR lower(vf.observed) LIKE '%target%' OR lower(vf.observed) LIKE '%threshold%' OR lower(vf.observed) LIKE '%limit%' OR lower(vf.observed) LIKE '%fewer than%' OR lower(vf.observed) LIKE '%more than%' OR vf.observed LIKE '% <= %' OR vf.observed LIKE '% >= %' OR vf.observed LIKE '% < %' OR vf.observed LIKE '% > %')))), 0)
                   AND julianday(vr.verified_at) > COALESCE((SELECT MAX(julianday(l.ts)) FROM issue_lifecycle l WHERE l.issue_id = NEW.issue_id AND l.event = 'reopened'), 0)))) * 1440.0 >= h2.hold_min THEN 1
                            ELSE 0 END
                FROM v_issue_close_hold h2 WHERE h2.issue_id = NEW.issue_id) = 1))
  AND NOT (COALESCE((SELECT t4.reopened_count FROM issue_triage t4 WHERE t4.issue_id = NEW.issue_id), 0) >= 1
           AND EXISTS (SELECT 1 FROM remediation_contracts cv WHERE cv.issue_id = NEW.issue_id AND cv.status IN ('active', 'holding') AND cv.action LIKE 'VACUOUS-PROBE%'))
BEGIN
  INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, close_evidence)
  SELECT NEW.issue_id, 'verified-remediation', 'closed', 'fleet-autoremediation', datetime('now','+7 days'),
         'remediation_verifications#' || NEW.id || ' pass=1 class=' || COALESCE(NEW.class,'') || ' transport=' || NEW.transport || ' verified_at=' || COALESCE(NEW.verified_at, datetime('now'))
  WHERE EXISTS (SELECT 1 FROM agent_issues WHERE id = NEW.issue_id AND status = 'open')
    AND NOT EXISTS (SELECT 1 FROM remediation_contracts cb WHERE cb.issue_id = NEW.issue_id AND cb.status IN ('active', 'holding')
                    AND COALESCE(cb.last_verdict, '') IN ('fail', 'vacuous-probe-result', 'probe-error', 'probe-not-machine-executable', 'probe-same-account-host'))
  ON CONFLICT(issue_id) DO UPDATE SET close_evidence = excluded.close_evidence WHERE COALESCE(issue_triage.close_evidence,'') = '';
  UPDATE agent_issues SET status='closed', close_channel='auto:verified-remediation-trigger', updated_at = CAST(strftime('%s','now') AS INTEGER)*1000
  WHERE id = NEW.issue_id AND status = 'open'
    AND NOT EXISTS (SELECT 1 FROM remediation_contracts cb WHERE cb.issue_id = NEW.issue_id AND cb.status IN ('active', 'holding')
                    AND COALESCE(cb.last_verdict, '') IN ('fail', 'vacuous-probe-result', 'probe-error', 'probe-not-machine-executable', 'probe-same-account-host'));
END;

-- CF-OBS-ISSUE-1 birth probe: a Cloudflare group's resolved status no longer passes by itself (Cloudflare sets it 12 to 120 s after a burst ends).
DROP TRIGGER IF EXISTS contract_probe_templates_family_birth;
CREATE TRIGGER contract_probe_templates_family_birth
AFTER INSERT ON remediation_contracts
WHEN NEW.status = 'needs-machine-probe'
  AND NEW.issue_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM agent_issues a
    WHERE a.id = NEW.issue_id
      AND (
        (a.title LIKE 'METRIC-UNMEASURED-1: % has metrics with no value'
          AND length(substr(a.title, 22, length(a.title) - 47)) > 0)
        OR
        (a.title LIKE 'CF-OBS-ISSUE-1:%'
          AND instr(COALESCE(a.description, ''), 'cf-obs-id: ') > 0
          AND instr(substr(a.description, instr(a.description, 'cf-obs-id: ') + 11), char(10)) > 1)
      )
  )
BEGIN
  UPDATE remediation_contracts
  SET status = 'active',
      verify_transport = 'd1-query',
      module = 'issue-birth-probe-families',
      attempts = 0,
      last_verdict = NULL,
      next_due_at = datetime('now'),
      precondition = CASE
        WHEN EXISTS (
          SELECT 1 FROM agent_issues a
          WHERE a.id = NEW.issue_id AND a.title LIKE 'METRIC-UNMEASURED-1:%'
        ) THEN 'METRIC-UNMEASURED-1: metric_improvement_now contains this owner''s unmeasured metrics'
        ELSE 'CF-OBS-ISSUE-1: fleet_issue_dispatch records this group as active or quiet'
      END,
      action = CASE
        WHEN EXISTS (
          SELECT 1 FROM agent_issues a
          WHERE a.id = NEW.issue_id AND a.title LIKE 'METRIC-UNMEASURED-1:%'
        ) THEN 'FM-4 measuring probe: close only when this owner has no unmeasured non-BP26 metrics'
        ELSE 'FM-4 measuring probe: close only when the Cloudflare issue group has been quiet for six hours (RELAPSE-HOLD-1: a resolved status alone is not quiet)'
      END,
      verify_probe = CASE
        WHEN EXISTS (
          SELECT 1 FROM agent_issues a
          WHERE a.id = NEW.issue_id AND a.title LIKE 'METRIC-UNMEASURED-1:%'
        ) THEN
          'WITH owner_metrics AS (SELECT verdict, bp26 FROM metric_improvement_now WHERE owner = ' ||
          quote((SELECT substr(a.title, 22, length(a.title) - 47) FROM agent_issues a WHERE a.id = NEW.issue_id)) ||
          ') SELECT ''0'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM owner_metrics) ' ||
          'THEN CAST((SELECT COUNT(*) FROM owner_metrics WHERE verdict = ''unmeasured'' AND bp26 = 0) AS TEXT) ' ||
          'ELSE ''missing'' END AS observed'
        ELSE
          'WITH dispatch AS (SELECT state, payload FROM fleet_issue_dispatch WHERE fingerprint = ' ||
          quote('cf-obs-' || (SELECT substr(a.description, instr(a.description, 'cf-obs-id: ') + 11, instr(substr(a.description, instr(a.description, 'cf-obs-id: ') + 11), char(10)) - 1) FROM agent_issues a WHERE a.id = NEW.issue_id)) ||
          ') SELECT ''1'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM dispatch WHERE (state = ''resolved'' AND NOT (json_valid(payload) AND COALESCE(CAST(json_extract(payload, ''$.lastObserved'') AS INTEGER), 0) > 0)) OR ' ||
          '(json_valid(payload) AND CAST(json_extract(payload, ''$.lastObserved'') AS INTEGER) > 0 ' ||
          'AND CAST(json_extract(payload, ''$.lastObserved'') AS INTEGER) <= (CAST(strftime(''%s'', ''now'') AS INTEGER) - 21600) * 1000)) ' ||
          'THEN ''1'' WHEN EXISTS (SELECT 1 FROM dispatch) THEN ''0'' ELSE ''missing'' END AS observed'
      END
  WHERE class = NEW.class AND status = 'needs-machine-probe';
END;

DROP TRIGGER IF EXISTS contract_probe_templates_family_reassert;
CREATE TRIGGER contract_probe_templates_family_reassert
AFTER UPDATE OF verify_probe ON remediation_contracts
WHEN NEW.module = 'issue-birth-probe-families'
  AND NEW.verify_transport = 'd1-query'
  AND instr(NEW.verify_probe, 'ELSE ''missing'' END AS observed') = 0
  AND EXISTS (
    SELECT 1 FROM agent_issues a
    WHERE a.id = NEW.issue_id
      AND a.title LIKE 'CF-OBS-ISSUE-1:%'
      AND instr(COALESCE(a.description, ''), 'cf-obs-id: ') > 0
      AND instr(substr(a.description, instr(a.description, 'cf-obs-id: ') + 11), char(10)) > 1
  )
BEGIN
  UPDATE remediation_contracts
  SET verify_probe =
      'WITH dispatch AS (SELECT state, payload FROM fleet_issue_dispatch WHERE fingerprint = ' ||
      quote('cf-obs-' || (SELECT substr(a.description, instr(a.description, 'cf-obs-id: ') + 11, instr(substr(a.description, instr(a.description, 'cf-obs-id: ') + 11), char(10)) - 1) FROM agent_issues a WHERE a.id = NEW.issue_id)) ||
      ') SELECT ''1'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM dispatch WHERE (state = ''resolved'' AND NOT (json_valid(payload) AND COALESCE(CAST(json_extract(payload, ''$.lastObserved'') AS INTEGER), 0) > 0)) OR ' ||
      '(json_valid(payload) AND CAST(json_extract(payload, ''$.lastObserved'') AS INTEGER) > 0 ' ||
      'AND CAST(json_extract(payload, ''$.lastObserved'') AS INTEGER) <= (CAST(strftime(''%s'', ''now'') AS INTEGER) - 21600) * 1000)) ' ||
      'THEN ''1'' WHEN EXISTS (SELECT 1 FROM dispatch) THEN ''0'' ELSE ''missing'' END AS observed'
  WHERE class = NEW.class AND module = 'issue-birth-probe-families' AND verify_probe = NEW.verify_probe;
END;

-- Contracts of OPEN CF-OBS issues, and of closed ones whose group has not been seen for six hours, get the tightened probe. A closed issue whose group was seen within six hours keeps
-- the old probe for now, so this migration reopens nothing by itself (its own relapse measurement stays clean); those contracts are retuned by the follow-up after the 24 h reading.
UPDATE remediation_contracts
SET verify_probe = replace(verify_probe, 'state = ''resolved'' OR (state <> ''resolved'' AND json_valid(payload) AND', '(state = ''resolved'' AND NOT (json_valid(payload) AND COALESCE(CAST(json_extract(payload, ''$.lastObserved'') AS INTEGER), 0) > 0)) OR (json_valid(payload) AND'),
    action = replace(action, 'FM-4 measuring probe: close only when the Cloudflare issue group is resolved or has been quiet for six hours', 'FM-4 measuring probe: close only when the Cloudflare issue group has been quiet for six hours (RELAPSE-HOLD-1: a resolved status alone is not quiet)')
WHERE module = 'issue-birth-probe-families'
  AND instr(verify_probe, 'state = ''resolved'' OR (state <> ''resolved'' AND json_valid(payload) AND') > 0
  AND (issue_id IN (SELECT id FROM agent_issues WHERE status = 'open')
       OR (issue_id IN (SELECT id FROM agent_issues WHERE status IN ('closed', 'resolved'))
           AND NOT EXISTS (
             SELECT 1 FROM fleet_issue_dispatch d
             WHERE d.fingerprint = substr(remediation_contracts.verify_probe, instr(remediation_contracts.verify_probe, 'fingerprint = ''') + 15,
                                          instr(substr(remediation_contracts.verify_probe, instr(remediation_contracts.verify_probe, 'fingerprint = ''') + 15), '''') - 1)
               AND CASE WHEN json_valid(d.payload) THEN COALESCE(CAST(json_extract(d.payload, '$.lastObserved') AS INTEGER), 0) ELSE 0 END
                   > (CAST(strftime('%s', 'now') AS INTEGER) - 21600) * 1000)));

-- (d) The measure: families whose closes do not hold.
INSERT OR IGNORE INTO metric_registry
  (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, last_value, last_refreshed, state, refresh_class)
VALUES
  ('issue_relapse_families_7d', 'operational', 'target',
   'Count of v_issue_relapse_7d rows with closes_7d >= 5 and relapse_rate_7d > 0.5 (reopens divided by closes in 7 days); 0 when no family relapses on more than half of its closes',
   'qnfo-audit.v_issue_relapse_7d (RELAPSE-HOLD-1)',
   CAST((SELECT COUNT(*) FROM v_issue_relapse_7d WHERE closes_7d >= 5 AND relapse_rate_7d > 0.5) AS TEXT),
   '0 (no family with 5 or more closes in 7 days relapses on more than half of them)', 'qnfo-fleet-control',
   'analytics_metric_triggers -> evaluateMetricTriggers (qnfo-fleet-control)', '1h', '> 0', '> 3',
   CAST((SELECT COUNT(*) FROM v_issue_relapse_7d WHERE closes_7d >= 5 AND relapse_rate_7d > 0.5) AS TEXT),
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'MEASURED', 'computed');

INSERT OR IGNORE INTO analytics_metric_triggers
  (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
VALUES
  ('issue_relapse_families_7d', 'Issue closes do not hold: a family reopens more than half of what it closes', 'registry', 'gt', 0, 4,
   'RELAPSE-HOLD-1: read SELECT * FROM v_issue_relapse_7d WHERE closes_7d >= 5 AND relapse_rate_7d > 0.5 ORDER BY reopens_7d DESC and take the top family. For its worst_issue_id read the closing probe (SELECT verify_probe FROM remediation_contracts WHERE issue_id = <worst_issue_id>) and the rows of remediation_verifications between each close and the next reopen in issue_lifecycle. A probe that passes while the defect persists measures the absence of a log line: replace it (UPDATE remediation_contracts on class issue-<id>, or the birth template trigger for new issues) with one that reads the defect itself, and give the closer that bypasses remediation_verification_autoclose_* (grep close_channel in agent_issues for the channel) the same stability window. Done: the family leaves the view or its relapse_rate_7d is 0.5 or lower at two refreshes, with remediation_latest_pass_pct_7d and issue_wontfix_share_7d no worse.',
   'qnfo-fleet-control', 'agent_issues', 2, 1,
   'RELAPSE-HOLD-1: per-family relapse measure; the hold itself is v_issue_close_hold, switched off with ops_config relapse_close_hold = off.');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note)
VALUES ('issue_relapse_families_7d', 'issue-backlog',
        'METRIC-CAUSE-AT-REGISTRATION-1 2026-11-04: a family that reopens more than half of what it closes has a closing path (probe or closer) that passes while the defect persists; the repair is that path, so the cause is the issue backlog and its closing quality.');

CREATE TRIGGER IF NOT EXISTS issue_relapse_families_tick
AFTER INSERT ON fleet_tick
WHEN strftime('%M', 'now') < '10' OR NEW.source LIKE 'migration:%'
BEGIN
  UPDATE metric_registry
  SET last_value = CAST((SELECT COUNT(*) FROM v_issue_relapse_7d WHERE closes_7d >= 5 AND relapse_rate_7d > 0.5) AS TEXT),
      last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      state = 'MEASURED'
  WHERE metric = 'issue_relapse_families_7d';
END;

-- The hold is a control (doctrine section 16): recorded with its reason, its kill switch and its measured effect.
INSERT OR IGNORE INTO control_registry
  (control, location, kind, guards_against, critical_path, disposition, disposition_state, alternate_path, alternate_tested_at, evidence, issue_id)
VALUES
  ('relapse-close-hold', 'view v_issue_close_hold read by triggers remediation_verification_autoclose_ins and remediation_verification_autoclose_upd (qnfo-audit)', 'hold',
   'an issue closed on one pass in a relapsing family, or on a pass that counts evidence from before its reopen, and reopened within hours',
   0, 'keep', 'applied',
   'ops_config relapse_close_hold = off sets every hold to 0 (the first pass closes, as before 2026-11-04) without a deploy; the hold is at most 120 minutes of continuous passing verification after the last reopen, so it expires with the evidence',
   '2026-11-04',
   'RELAPSE-HOLD-1: 661 reopens against 1,334 closes in 7 days, 236 of them first reopens; 28 % of relapses came within 1 h and 44 % within 2 h of the close. Measured effect: closure_branching_ratio_24h and v_issue_relapse_7d; reverted by the kill switch if issues_open_over_120m rises more than 40 or open_agent_issues more than 60 without the ratio falling.',
   NULL);

INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note, enabled)
VALUES ('relapse-close-hold',
  'SELECT ''ok'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM ops_config WHERE key = ''relapse_close_hold'') OR EXISTS (SELECT 1 FROM ops_config WHERE key = ''relapse_close_hold'' AND value IN (''on'', ''off'')) THEN ''ok'' ELSE ''ops_config relapse_close_hold holds a value v_issue_close_hold does not read (use on or off), so the kill switch cannot be trusted'' END AS observed',
  '60', 1);

-- (e) The two journey closers and the improvement loop close on the first passing reading and have no hold; a doer is named for each (code loop).
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS #relapse-2: qnfo-fleet-control closes a journey issue only after two passing runs apart in time',
       'Charter pillar: autonomy. Program QNFO.OPS. Metric to move: closure_branching_ratio_24h (0.509 on 2026-11-04) and issue_relapse_families_7d. FLEET-JOURNEY-FAILED-1 reopened 88 times against 109 closes in 7 days; 36 % of those reopens came within 1 h of the close. The close path jrnIssue in qnfo-fleet-control/worker.js closes the issue on the first run that passes (close_channel auto-recovery) and the GitHub runner in scripts/fleet_journeys.py does the same, so a flapping journey is closed and reopened every few runs.' || char(10) ||
       'Change: in jrnIssue close an open journey issue only when the previous journey_runs row of the same journey and runner (cf) also passed, at least 10 minutes before this run and after the issue''s last reopen (issue_lifecycle event reopened); otherwise keep it open and log fleet-control:journeys:issue:close-deferred. Tag the change RELAPSE-HOLD-1 in a comment. Definition of done: a regression test in qnfo-fleet-control/journeys.test.mjs, VERSION bumped with the mirror, and v_issue_relapse_7d reads FLEET-JOURNEY-FAILED-1 relapse_rate_7d at or below 0.5 seven days after the deploy.' || char(10) ||
       'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) ||
       'code-anchor: // JOURNEY-CLOSE-CONTRACT-AWARE-1: the closing probe owns recovery while its contract still fails.' || char(10) ||
       'code-probe: {"paths": ["qnfo-fleet-control/worker.js"], "contains": "RELAPSE-HOLD-1"}',
       'claude-session', 'reliability', 'high', 'open', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #relapse-2:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS #relapse-3: the GitHub journey runner closes a journey issue only after two passing runs apart in time',
       'Charter pillar: autonomy. Program QNFO.OPS. Metric to move: closure_branching_ratio_24h and issue_relapse_families_7d. scripts/fleet_journeys.py record() closes every open FLEET-JOURNEY-FAILED-1 issue of a journey on the first gha run that passes all steps (close_channel auto-recovery), the second closer next to qnfo-fleet-control jrnIssue (issue relapse-2). 88 reopens against 109 closes in 7 days.' || char(10) ||
       'Change: before the UPDATE that sets status closed, require that the previous gha journey_runs row of the same journey (the run before the one just inserted) also passed, at least 10 minutes earlier and after the issue''s last reopen; otherwise append to actions "kept open: first passing run". Tag the change RELAPSE-HOLD-1 in a comment. Definition of done: a case in the script selftest, and v_issue_relapse_7d reads FLEET-JOURNEY-FAILED-1 relapse_rate_7d at or below 0.5 seven days after the deploy.' || char(10) ||
       'code-task: repo=qnfo-workers path=scripts/fleet_journeys.py' || char(10) ||
       'code-anchor: other = d1("SELECT ok FROM journey_runs WHERE journey = ?1 AND runner <> ''gha'' AND ts > ?2 ORDER BY id DESC LIMIT 1", [r["journey"], since])' || char(10) ||
       'code-probe: {"paths": ["scripts/fleet_journeys.py"], "contains": "RELAPSE-HOLD-1"}',
       'claude-session', 'reliability', 'high', 'open', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #relapse-3:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS #relapse-4: the improvement loop closes a METRIC-REGRESSION-1 issue only after the metric stayed inside its target for two loop runs',
       'Charter pillar: autonomy. Program QNFO.OPS. Metric to move: closure_branching_ratio_24h and issue_relapse_families_7d. METRIC-REGRESSION-1 reopened 38 times against 61 closes in 7 days (8 issues; 1000756 beliefs_unverified_60m 21 times, 1000240 5 times), 35 of them on issues closed by improvementLoopTick (close_channel auto:fleet-control/improvement-loop), which closes on the first hourly reading that is back inside the target (evidence "metric back inside its target; no longer a finding").' || char(10) ||
       'Change: in improvementLoopTick close an open METRIC-REGRESSION-1 issue only when the previous improvement_loop_runs row also read the metric inside its target, and when the issue has been reopened before require the last two readings, at least 50 minutes apart and after the issue''s last reopen (issue_lifecycle event reopened); otherwise count it in close_deferred and keep it open. Tag the change RELAPSE-HOLD-1 in a comment. Definition of done: a regression test next to the existing improvement-loop suite, VERSION bumped with the mirror, and v_issue_relapse_7d reads METRIC-REGRESSION-1 relapse_rate_7d at or below 0.5 seven days after the deploy.' || char(10) ||
       'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) ||
       'code-anchor: // IL-CLOSE-VS-PROBE-1: the contract for this issue still fails its probe; a close now would abort on' || char(10) ||
       'code-probe: {"paths": ["qnfo-fleet-control/worker.js"], "contains": "RELAPSE-HOLD-1"}',
       'claude-session', 'reliability', 'high', 'open', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #relapse-4:%');

-- Failure mode and its detector: a later migration that recreates the autoclose triggers from older text would silently drop the hold.
INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, symptom, blast_radius)
VALUES ('single-pass-close-relapse',
  'An issue is auto-closed on a pass that proves no stability, then reopens within hours: a pass from before its reopen counts as the first of two, the first close of a relapsing family takes one pass, and a probe passes on a status set seconds after the last error',
  'remediation_verification_autoclose_ins/upd checked only that the previous verification row of the class passed, not when the passing run began relative to the last reopen, and the CF-OBS birth probe accepted Cloudflare''s resolved status',
  'RELAPSE-HOLD-1: v_issue_close_hold sets a hold of 20, 60 or 120 minutes of continuous passes since the last reopen; the CF-OBS probe needs six quiet hours; v_issue_relapse_7d and metric issue_relapse_families_7d measure the outcome',
  'fm-relapse-hold-present: both autoclose triggers read v_issue_close_hold, expected 2',
  'fm-relapse-hold-present', '2026-11-04',
  '661 reopens against 1,334 closes in 7 days (2026-11-04)', 'closure_branching_ratio_24h, drain ratio and open backlog all worsen because closed issues reopen');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES
  ('fm-relapse-hold-present', NULL, 'RELAPSE-HOLD-1', 'failure-mode detector: both remediation autoclose triggers read v_issue_close_hold',
   'SELECT ''2'' AS expected, CAST((SELECT COUNT(*) FROM sqlite_master WHERE type = ''trigger'' AND name IN (''remediation_verification_autoclose_ins'', ''remediation_verification_autoclose_upd'') AND instr(sql, ''v_issue_close_hold'') > 0) AS TEXT) AS observed',
   'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now'));

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:issue-relapse-hold',
  'A close that does not hold is worse than an open issue: the reopen costs a second triage, hides the defect for hours and halves the drain ratio. A hold of at most 120 minutes on issues that already relapsed is cheaper than the churn.',
  'RELAPSE-HOLD-1: autoclose triggers require continuous passes since the last reopen for the hold in v_issue_close_hold; CF-OBS probe measures six quiet hours instead of Cloudflare''s resolved status; v_issue_relapse_7d, metric issue_relapse_families_7d, control relapse-close-hold, detector fm-relapse-hold-present, three closer code tasks (two journey closers, the improvement loop).',
  'qnfo-audit 2026-11-04: 7 days 989 opened, 1,334 dispositioned, 661 reopened (236 first reopens); 24 h 304 closes, 150 reopens; closure_branching_ratio_24h 0.509; 583 reopens with a prior close: 28 % within 1 h, 44 % within 2 h, 70 % within 6 h; 352 had no verification row between close and reopen, 137 only passes; issue 1001278 closed on the 10:53Z pass using the 10:23Z pass from before its 10:42Z reopen; Cloudflare resolved status set 12 to 120 s after lastObserved.',
  'pending canonical migration; measured after deploy by closure_branching_ratio_24h, v_issue_relapse_7d and the guards',
  'issue closing on qnfo-audit (two triggers, one view), open CF-OBS contracts, no code path and no spend; closed issues are not touched',
  'ops_config relapse_close_hold = off (instant), or the Rollback line of migrations/2026-11-04-relapse-hold-1.sql with bak_20261104_relapse_hold',
  'every issue family that relapses is held until its passes span a stability window, and the relapse rate per family is measured hourly',
  'closure_branching_ratio_24h 0.509 falls to 0.35 or lower and reopens per 24 h from 150 to 105 or fewer within 7 days of the deploy, CF-OBS-ISSUE-1 reopens per 24 h from 67 to 35 or fewer; issue_wontfix_share_7d stays at most 1 and remediation_latest_pass_pct_7d at least 60; issues_open_over_120m may rise by up to 40 and open_agent_issues by up to 60 (held issues stay open longer); a larger rise without the ratio falling reverts the hold',
  'not a reach change; closing quality for every issue family',
  'node:sqlite suite migrations/relapse-hold-1.test.mjs (post-reopen pass, hold tiers, kill switch, CF-OBS probe, view, metric, idempotent re-apply); scripts/apply_migrations.py --check; live read of the same queries on qnfo-audit'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'RELAPSE-HOLD-1:%');
