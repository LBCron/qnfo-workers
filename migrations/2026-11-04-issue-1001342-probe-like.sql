-- PROBE-LIKE-OVER-LIMIT-1001342 (2026-11-04, charter pillar autonomy; failure mode fm-probe-like-pattern-over-limit).
-- The closing probe of contract issue-1001342 ends in  text LIKE 'upstream 429 at callDeepSeekStream (deepseek/deepseek-v4-flash)%'  (64 bytes). D1 refuses a LIKE pattern over 50 bytes
-- (HTTP 400, code 7500, "LIKE or GLOB pattern too complex"), so the probe can never run; the contract has held on its last pass of 05:31Z. The same test as a prefix compare,
-- substr(text, 1, 63) = '<same text without the %>', returns on the live database (26 events of that kind, 90 rows read).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = replace(verify_probe, 'substr(text, 1, 63) = ''upstream 429 at callDeepSeekStream (deepseek/deepseek-v4-flash)''', 'text LIKE ''upstream 429 at callDeepSeekStream (deepseek/deepseek-v4-flash)%''') WHERE class = 'issue-1001342';
-- spof-review: one probe text on one contract.

UPDATE remediation_contracts
SET verify_probe = replace(verify_probe,
  'text LIKE ''upstream 429 at callDeepSeekStream (deepseek/deepseek-v4-flash)%''',
  'substr(text, 1, 63) = ''upstream 429 at callDeepSeekStream (deepseek/deepseek-v4-flash)''')
WHERE class = 'issue-1001342' AND verify_probe LIKE '%callDeepSeekStream (deepseek/deepseek-v4-flash)%%';
