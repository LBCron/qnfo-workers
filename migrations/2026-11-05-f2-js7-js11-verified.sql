-- F2 verification (2026-11-05, charter pillars reach and personal): roadmap JS-7 (1678) and JS-11 (1688) are verified from live D1 reads after qnfo-jobsearch 1.6.x ran on the hourly cron.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_f2_js7_js11
-- Rollback: UPDATE roadmap_implementation SET status = (SELECT b.status FROM bak_20261105_f2_js7_js11 b WHERE b.id = roadmap_implementation.id), evidence = (SELECT b.evidence FROM bak_20261105_f2_js7_js11 b WHERE b.id = roadmap_implementation.id), verified_at = (SELECT b.verified_at FROM bak_20261105_f2_js7_js11 b WHERE b.id = roadmap_implementation.id) WHERE id IN (SELECT id FROM bak_20261105_f2_js7_js11)
-- CAUSE-MAPPED: registers no metric_registry row.
-- Read live 2026-11-05 03:16Z (GET https://qnfo-jobsearch.q08.workers.dev/api/ops, 1.6.2): publicsector:werkenvoornederland 30 postings (2 before), publicsector:academictransfer 137 (5 before),
-- publicsector:euraxess 35, smartrecruiters:oecd 22, recruitee:sweco 179, every one with consecutive_fail 0; the run fetched 12,600 postings, 568 passed, 69 stored.
-- The contract of agent_issues 1000643 (probe replaced in 2026-11-05-f2-jobsearch-youtube-exuvia-dispositions.sql) passed and closed that issue (remediation_verifications 592769).
-- Each UPDATE below runs only while the same facts hold in jobsearch_feeds when the file is applied.
CREATE TABLE IF NOT EXISTS bak_20261105_f2_js7_js11 AS
SELECT id, status, evidence, verified_at FROM roadmap_implementation WHERE id IN (1678, 1688);

UPDATE roadmap_implementation
SET status = 'verified',
    verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = 'Verified live 2026-11-05 (qnfo-jobsearch 1.6.x, GET /api/ops 03:16Z): the SmartRecruiters reader returns smartrecruiters:oecd 22 postings and recruitee:sweco 179, both consecutive_fail 0 in jobsearch_feeds; per-feed health is jobsearch_feeds and /api/ops (PR 7423). The run fetched 12,600 postings, 568 passed, 69 stored (the 8-of-5,900 premise was stale before the change).'
WHERE id = 1678 AND item = 'JS-7' AND source = 'jobsearch-2026' AND status = 'planned'
  AND (SELECT COUNT(*) FROM jobsearch_feeds WHERE feed IN ('smartrecruiters:oecd', 'recruitee:sweco') AND consecutive_fail = 0 AND last_count > 0) = 2;

UPDATE roadmap_implementation
SET status = 'verified',
    verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = 'Verified live 2026-11-05 (qnfo-jobsearch 1.6.x, GET /api/ops 03:16Z): publicsector:werkenvoornederland 30 postings (2 before; sitemap plus JobPosting JSON-LD pages, PR 7423), publicsector:academictransfer 137 (5 before), publicsector:euraxess 35, all consecutive_fail 0 over the 02:15Z and 03:15Z runs; agent_issues 1000643 closed on its replaced probe (remediation_verifications 592769). robots.txt answers per site are recorded in the code above PUBLIC_SECTOR.'
WHERE id = 1688 AND item = 'JS-11' AND source = 'jobsearch-2026' AND status = 'planned'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000643 AND status = 'closed')
  AND COALESCE((SELECT last_count FROM jobsearch_feeds WHERE feed = 'publicsector:werkenvoornederland' AND consecutive_fail = 0), 0) >= 10
  AND COALESCE((SELECT last_count FROM jobsearch_feeds WHERE feed = 'publicsector:academictransfer' AND consecutive_fail = 0), 0) >= 10;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'coding-agent (F2 cluster)', 'JS-7 and JS-11 are verified when the new readers return postings with no feed failure after the deploy.',
 'Verify JS-7 and JS-11 in roadmap_implementation from the live feed counts.',
 'qnfo-jobsearch /api/ops 03:16Z: werkenvoornederland 30, academictransfer 137, euraxess 35, smartrecruiters:oecd 22, recruitee:sweco 179, consecutive_fail 0; issue 1000643 closed by remediation_verifications 592769.',
 'verified: JS-7 and JS-11', 'two roadmap_implementation rows and one decision_log row', 'Restore the rows from bak_20261105_f2_js7_js11; decision_log is append-only.',
 'Dutch public-sector, university and OECD postings reach the matcher', 'matches from the new feeds appear in jobsearch_matches over the next days; the owner decides on them', 'job search only, no audience reach claimed', 'GET /api/ops, jobsearch_feeds, remediation_verifications'
WHERE EXISTS (SELECT 1 FROM roadmap_implementation WHERE id IN (1678, 1688) AND status = 'verified')
  AND NOT EXISTS (SELECT 1 FROM decision_log WHERE action = 'Verify JS-7 and JS-11 in roadmap_implementation from the live feed counts.');
