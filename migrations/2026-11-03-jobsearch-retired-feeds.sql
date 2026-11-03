-- JOBSEARCH-RETIRED-FEEDS-1 (2026-11-03, charter pillar reach): keep historical feed errors visible without treating removed boards as active failures.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM jobsearch_feeds WHERE consecutive_fail >= 3) AS TEXT) AS observed' WHERE class = 'fm-jobsearch-feed-down'; UPDATE failure_modes SET detector = 'the fm-jobsearch-feed-down contract reads: jobsearch_feeds rows with consecutive_fail of 3 or more', trigger_condition = 'jobsearch_feeds rows with consecutive_fail of 3 or more' WHERE fm_key = 'jobsearch-feed-down';
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM jobsearch_feeds WHERE consecutive_fail >= 3 AND feed NOT IN (''greenhouse:cwi'', ''greenhouse:deepmind'', ''greenhouse:tno'')) AS TEXT) AS observed'
WHERE class = 'fm-jobsearch-feed-down';

UPDATE failure_modes
SET detector = 'the fm-jobsearch-feed-down contract reads: configured jobsearch_feeds rows with consecutive_fail of 3 or more; retired feeds remain visible for diagnosis but do not count as active failures',
    trigger_condition = 'configured jobsearch_feeds rows with consecutive_fail of 3 or more; retired board feeds do not count'
WHERE fm_key = 'jobsearch-feed-down';
