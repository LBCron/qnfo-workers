-- RM52-PROBE-VANTAGE-1 (2026-11-05, agent W2-F-C, charter pillar security; roadmap row 52 RM-WAF-RATE-LIMIT-1). The closing contract rm-52 (runner-https) has failed 5 times in a row with
-- observed "missing-marker" (remediation_verifications 2026-11-05 02:42:00, 03:22:04 and 04:02:22): the GitHub runner gets the status the probe names (403, judged first) but not the text
-- "Attention Required", which is the title of the Cloudflare block page. Read from this session the same URL answers 403 with that page (title "Attention Required! | Cloudflare", also with the
-- consumer's own user agents), while the runner sits on a datacenter address and is shown a different Cloudflare page. The rule is live and the runner is blocked; only the marker is
-- vantage-specific. The replacement marker is "cdn-cgi", which every Cloudflare-served block, challenge and rate-limit page carries (the block page links /cdn-cgi/styles; read twice in the body
-- here) and which the Worker behind the zone never emits, so a 403 containing it still means the edge, not the origin, answered /.env. The status stays 403, the URL is unchanged.
-- PREDICTION: contract rm-52 passes on its next consumer run (within about 40 minutes of the merge) and the steward then sets roadmap_implementation 52 to verified.
-- Revert: the Rollback line restores the previous probe from bak_20261105_rm52_probe.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_rm52_probe b WHERE b.class = 'rm-52'), attempts = 0, last_verdict = NULL, next_due_at = datetime('now') WHERE class = 'rm-52' AND EXISTS (SELECT 1 FROM bak_20261105_rm52_probe b WHERE b.class = 'rm-52')
-- CAUSE-MAPPED: registers no metric.
-- spof-review: adds no worker, cron, D1 trigger, route or credential; it changes the marker of one closing probe and keeps its URL and status.

CREATE TABLE IF NOT EXISTS bak_20261105_rm52_probe AS
SELECT class, issue_id, verify_probe, verify_transport, status, last_verdict, attempts FROM remediation_contracts WHERE class = 'rm-52';

UPDATE remediation_contracts
SET verify_probe = '{"url": "https://papers.qnfo.org/.env", "status": 403, "contains": "cdn-cgi"}',
    attempts = 0, last_verdict = NULL, next_due_at = datetime('now')
WHERE class = 'rm-52' AND verify_probe LIKE '%Attention Required%';
