-- COMPAT-PROBE-REAL-1 (2026-11-05, charter pillar core; GitHub QNFO/qnfo-workers#5682, #5783, #5793; agent_issues 1000583, 1000843, 1000914; cluster E-metrics-portfolio).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_e_compat_probes
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_e_compat_probes b WHERE b.class = remediation_contracts.class), action = (SELECT b.action FROM bak_20261105_e_compat_probes b WHERE b.class = remediation_contracts.class) WHERE class IN ('issue-1000583', 'issue-1000843', 'issue-1000914') AND EXISTS (SELECT 1 FROM bak_20261105_e_compat_probes b WHERE b.class = remediation_contracts.class);
-- CAUSE-MAPPED: no metric is registered here; this edits three existing probe rows.
--
-- The three PORTFOLIO-UPGRADE-1 issues ask a worker's compatibility_date to advance. Their contract probes read worker_compat_state.days_behind and require it to equal 0,
-- which is days between the live date and TODAY: it is 0 only in the snapshot taken on the day of the deploy and 1 the next day whatever anyone does. A probe that is
-- true for at most one 6-hour snapshot (compatSnapshot in qnfo-ops runs every 6 h) can never close an issue durably, and it measures the calendar, not the exposure.
-- The exposure is flips_count: the number of Cloudflare default changes (qnfo-ops COMPAT_FLIPS) between the live date and today that the worker has not met. The fleet's own
-- closure rule for this family (migrations/2026-10-25-portfolio-gap-close-evidence.sql, PORTFOLIO-GAP-CLOSE-EVIDENCE-1) accepts days_behind below 30.
-- Read live 2026-11-05 00:10Z: qnfo-jobsearch live 2026-10-10, personal-watch live 2026-10-25, q08-mind live 2026-10-01, each with flips_count 0 (the newest entry in COMPAT_FLIPS is
-- 2026-10-01, Durable Objects, which none of the three uses; scripts/compat-risk-scan.mjs reads all three clean).
-- The code half is the same PR: each wrangler.toml moves its compatibility_date to 2026-11-04 with a `# compat-advance: reviewed 2026-11-05` line (qnfo-ops decideCompatAdvance applies
-- a reviewed, later, not-future date on the next canonical deploy; q08-mind deploys through mind-deploy.yml, which reads the date from its wrangler.toml).
-- The new probes pass only when the snapshot shows the ADVANCED live date (2026-11-04 or later) and no skipped default change, so they cannot pass on the state that exists today:
-- they measure the advance itself. They do not pass on a stale snapshot, and they stay true after the calendar moves on. voice-stt (1000915) is not touched here: it has no repository source.

CREATE TABLE IF NOT EXISTS bak_20261105_e_compat_probes (class TEXT PRIMARY KEY, verify_probe TEXT, action TEXT);
INSERT OR IGNORE INTO bak_20261105_e_compat_probes (class, verify_probe, action)
SELECT class, verify_probe, action FROM remediation_contracts WHERE class IN ('issue-1000583', 'issue-1000843', 'issue-1000914');

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''live compat date is 2026-11-04 or later and no Cloudflare default change was skipped'' AS expected, COALESCE((SELECT CASE WHEN live_date >= ''2026-11-04'' AND flips_count = 0 THEN ''live compat date is 2026-11-04 or later and no Cloudflare default change was skipped'' ELSE ''qnfo-jobsearch live_date='' || live_date || '' flips_count='' || flips_count || '' days_behind='' || COALESCE(days_behind, ''null'') END FROM worker_compat_state WHERE worker = ''qnfo-jobsearch'' ORDER BY checked_at DESC LIMIT 1), ''no worker_compat_state row for qnfo-jobsearch'') AS observed',
    action = 'COMPAT-PROBE-REAL-1: qnfo-jobsearch/wrangler.toml declares 2026-11-04 with a review line; the advance applies on the canonical deploy of the PR that carries it. The probe reads the newest worker_compat_state snapshot (qnfo-ops compatSnapshot, every 6 h) and passes on the advanced live date with no skipped default change, not on calendar age.',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000583' AND issue_id = 1000583;

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''live compat date is 2026-11-04 or later and no Cloudflare default change was skipped'' AS expected, COALESCE((SELECT CASE WHEN live_date >= ''2026-11-04'' AND flips_count = 0 THEN ''live compat date is 2026-11-04 or later and no Cloudflare default change was skipped'' ELSE ''personal-watch live_date='' || live_date || '' flips_count='' || flips_count || '' days_behind='' || COALESCE(days_behind, ''null'') END FROM worker_compat_state WHERE worker = ''personal-watch'' ORDER BY checked_at DESC LIMIT 1), ''no worker_compat_state row for personal-watch'') AS observed',
    action = 'COMPAT-PROBE-REAL-1: personal-watch/wrangler.toml declares 2026-11-04 with a review line; the advance applies on the canonical deploy of the PR that carries it. The probe reads the newest worker_compat_state snapshot and passes on the advanced live date with no skipped default change, not on calendar age.',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000843' AND issue_id = 1000843;

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''live compat date is 2026-11-04 or later and no Cloudflare default change was skipped'' AS expected, COALESCE((SELECT CASE WHEN live_date >= ''2026-11-04'' AND flips_count = 0 THEN ''live compat date is 2026-11-04 or later and no Cloudflare default change was skipped'' ELSE ''q08-mind live_date='' || live_date || '' flips_count='' || flips_count || '' days_behind='' || COALESCE(days_behind, ''null'') END FROM worker_compat_state WHERE worker = ''q08-mind'' ORDER BY checked_at DESC LIMIT 1), ''no worker_compat_state row for q08-mind'') AS observed',
    action = 'COMPAT-PROBE-REAL-1: q08-mind/wrangler.toml declares 2026-11-04 with a review line; mind-deploy.yml (wrangler deploy, the canonical path skips this WRANGLER-ONLY directory) applies it on the push that carries it. The probe reads the newest worker_compat_state snapshot and passes on the advanced live date with no skipped default change, not on calendar age.',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000914' AND issue_id = 1000914;
