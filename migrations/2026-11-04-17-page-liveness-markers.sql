-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = '{"url": "https://qwav.org/", "status": 200, "contains": "QWAV Research Papers", "max_ms": 10000}', status = 'superseded' WHERE class = 'rt-page-qwav-home'; UPDATE remediation_contracts SET verify_probe = '{"url": "https://fleet.qnfo.org/", "status": 200, "contains": "your queue", "max_ms": 15000}' WHERE class = 'rt-page-fleet-queue'
-- PAGE-LIVENESS-MARKERS-1 (2026-11-04, pillar core, issues 1000986 and 1001520 PROBE-NEEDED-1). Two standing liveness
-- contracts from PAGE-LIVENESS-1 asserted marker text that the redesigned pages no longer carry, so they failed on a healthy page:
-- rt-page-qwav-home wanted "QWAV Research Papers" (qwav.org now renders "QWAV - benchmarked in joules per solution", 200 in 0.2 s)
-- and rt-page-fleet-queue wanted "your queue" (fleet.qnfo.org v3 shows Now / Readers / Code with the heading "Is it running?").
-- Markers were read from the live pages on 2026-11-04 16:40 UTC; the other 19 page contracts were fetched the same minute and
-- all still carry theirs. rt-page-qwav-home was also status superseded (probe-unusable, attempts 729, due since 2026-11-03 23:43), so it never re-ran; it is re-armed active with attempts 0. The probe contract stays runner-https and hourly; the autoclose trigger closes RUNTIME-PROBE-FAIL-1 on the first pass.
-- CAUSE-MAPPED: no metric is registered here; this edits two existing probe rows.
UPDATE remediation_contracts SET verify_probe = '{"url": "https://qwav.org/", "status": 200, "contains": "benchmarked in joules per solution", "max_ms": 10000}', status = 'active', attempts = 0, last_verdict = NULL, next_due_at = datetime('now') WHERE class = 'rt-page-qwav-home';
UPDATE remediation_contracts SET verify_probe = '{"url": "https://fleet.qnfo.org/", "status": 200, "contains": "Is it running?", "max_ms": 15000}', next_due_at = datetime('now') WHERE class = 'rt-page-fleet-queue';
