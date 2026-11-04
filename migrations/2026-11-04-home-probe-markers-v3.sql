-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = '{"url": "https://fleet.qnfo.org/", "status": 200, "contains": ".fx-r{"}' WHERE class = 'fm-page-css-never-sent'; UPDATE remediation_contracts SET verify_probe = '{"url": "https://fleet.qnfo.org/", "status": 200, "contains": "Fix it"}' WHERE class = 'issue-1000784';
-- HOME-PROBE-MARKERS-V3-1 (2026-11-04, charter pillars core and autonomy; owner request: three-screen dashboard, V3-DASH-1, PRs 6923/6943/6979).
-- Cause: the home page at https://fleet.qnfo.org/ is now a static three-screen shell (dashboard 1.82.0 and later), and two contracts that are NOT PAGE-LIVENESS-1 rows still probe
-- the old home for markers only the old page carried: fm-page-css-never-sent (".fx-r{") and issue-1000784 (DASHBOARD-FIX-IT-1, "Fix it"). Measured on 2026-11-04 ~16:40Z: GET /
-- holds neither, GET /overview (the old page, kept) holds both, and GET / holds ".hero{border-radius". Left alone, the detector fails for a page that works and the issue never closes.
-- Scope: the two PAGE-LIVENESS-1 contracts broken by the same redesign (rt-page-fleet-queue, rt-page-qwav-home) are repointed by migrations/2026-11-04-17-page-liveness-markers.sql
-- (PR 7030, #7018); this file does not touch them, so the two migrations never write the same row.
-- Fix: fm-page-css-never-sent probes the new home on its inline CSS; issue-1000784 probes the old page where the one-tap Fix it buttons live.
-- Only UPDATEs of two contract rows (no DELETE or DROP); the old probe specs are in the Rollback line.

UPDATE remediation_contracts SET verify_probe = '{"url": "https://fleet.qnfo.org/", "status": 200, "contains": ".hero{border-radius"}' WHERE class = 'fm-page-css-never-sent';
UPDATE remediation_contracts SET verify_probe = '{"url": "https://fleet.qnfo.org/overview", "status": 200, "contains": "Fix it"}' WHERE class = 'issue-1000784';
