-- QWAV-CROSS-SIMULATOR-PROBE-1 (2026-11-05, charter pillar research, program QNFO.OPS; agent_issues 1000642 = GitHub 5691, roadmap_implementation 1686 = GitHub 5563).
-- The contract issue-1000642 asked whether a code task or metric row mentioning the cross-check exists (a proxy that stayed false because the cross-check was merged by hand, not as a code task).
-- The definition of done is "a table of demo, simulator, agreement for every published demo". docs/QWAV-CROSS-SIMULATOR.md now carries that table for 7 of the 8 published demo
-- repositories (page-code comparisons against independent implementations, scripts/qwav_golden_crosscheck.py) and states "All published demos covered: no" while qwav-demos has no row;
-- scripts/qwav_golden_crosscheck.test.mjs fails when that line and the script's own coverage disagree. The probe below reads that line, so it passes only when the last repository is covered.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_f1e_qwav b WHERE b.class = remediation_contracts.class), verify_transport = (SELECT b.verify_transport FROM bak_20261105_f1e_qwav b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_f1e_qwav WHERE class IS NOT NULL); UPDATE agent_issues SET description = (SELECT b.description FROM bak_20261105_f1e_qwav b WHERE b.class = 'issue-1000642') WHERE id = 1000642 AND EXISTS (SELECT 1 FROM bak_20261105_f1e_qwav WHERE class = 'issue-1000642'); UPDATE roadmap_implementation SET status = (SELECT b.road_status FROM bak_20261105_f1e_qwav b WHERE b.class = 'issue-1000642'), evidence = (SELECT b.road_evidence FROM bak_20261105_f1e_qwav b WHERE b.class = 'issue-1000642') WHERE id = 1686 AND EXISTS (SELECT 1 FROM bak_20261105_f1e_qwav WHERE class = 'issue-1000642'); UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'ROADMAP-1: QNFO.OPS #qwav-demos:%' AND status = 'open' AND EXISTS (SELECT 1 FROM issue_triage WHERE issue_id = agent_issues.id AND close_evidence IS NOT NULL);
-- CAUSE-MAPPED: registers no metric_registry row.
-- spof-review: one probe text on one contract; no new loop, cron or gate.

CREATE TABLE IF NOT EXISTS bak_20261105_f1e_qwav AS
SELECT c.class AS class, c.verify_probe AS verify_probe, c.verify_transport AS verify_transport, a.description AS description,
       (SELECT r.status FROM roadmap_implementation r WHERE r.id = 1686) AS road_status, (SELECT r.evidence FROM roadmap_implementation r WHERE r.id = 1686) AS road_evidence
FROM remediation_contracts c JOIN agent_issues a ON a.id = c.issue_id
WHERE c.class = 'issue-1000642';

UPDATE remediation_contracts
SET verify_probe = '{"paths": ["docs/QWAV-CROSS-SIMULATOR.md"], "contains": "All published demos covered: yes"}',
    verify_transport = 'code-read'
WHERE class = 'issue-1000642';

UPDATE agent_issues
SET description = description || char(10) || char(10) ||
  'STATE (QWAV-CROSS-SIMULATOR-PROBE-1, 2026-11-05, session F1-research-reach/E): none of the published demo pages computes a quantum quantity, so the table is built with the independent implementation that fits each page (docs/QWAV-CROSS-SIMULATOR.md, "Agreement table"). 7 of the 8 published demo repositories have rows: the pages read on 2026-11-05 were replayed (scripts/qwav_page_replay.mjs runs each page''s own functions behind a stub DOM; docs/qwav-page-golden.json holds the inputs, the page outputs and each page''s sha256) and 5496 numbers were compared with Python implementations by a different method (digit strings, a re-implemented seeded generator and block means, Lance-Williams and Kruskal clustering, exact rational p-adic arithmetic, level counts); all agree (largest difference 7.9e-15). Remaining: qwav-demos (the 2026-08-04 consolidation; its monna-map-perspective page is byte-identical to a covered page, its other four pages are older and were not read) and a headless-browser read of the live pages. The closing probe now reads the line "All published demos covered: yes" of the document, which the script and its test keep in step with the table; the doer for the remainder is the ROADMAP-1 row QNFO.OPS #qwav-demos. Not verified: the live pages after 2026-11-05.',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 1000642 AND instr(description, 'STATE (QWAV-CROSS-SIMULATOR-PROBE-1') = 0;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS #qwav-demos: replay the four older qwav-demos pages and flip the coverage line',
       'Charter pillar: research. Program QNFO.OPS. Parent: agent_issues 1000642 (RM-QWAV-CROSS-SIMULATOR-1, GitHub 5691). docs/QWAV-CROSS-SIMULATOR.md ends its agreement table with the repository qwav-demos (2026-08-04 consolidation of earlier demos) marked not checked, and says All published demos covered: no.' || char(10) ||
       'Change: read the four older pages (QNFO/qwav-demos: convergence-explorer/index.html, error-confinement-demo/index.html, qpna-playground/index.html, hardware-visualizer/index.html; monna-map-perspective/index.html is byte-identical to the covered qwav-demo-monna-map-perspective page, git blob eaaf7a8a). For each, add a REPLAYS entry in scripts/qwav_page_replay.mjs that calls the page''s own functions on fixed inputs, an independent check in scripts/qwav_golden_crosscheck.py (method different from the page''s), the recorded output in docs/qwav-page-golden.json (node scripts/qwav_page_replay.mjs --golden docs/qwav-page-golden.json --page <id>=<index.html> --write), and a table row in docs/QWAV-CROSS-SIMULATOR.md. A page that only wraps one already covered gets a row that says so with its git blob. When every page has a row, set covered True for qwav-demos in PUBLISHED_DEMOS and change the document line to All published demos covered: yes; scripts/qwav_golden_crosscheck.test.mjs fails if the two disagree. Add a quantum simulator only for a page that computes a quantum state or dynamics (none of the seven read so far does).' || char(10) ||
       'Definition of done: the closing probe below; the pages are in another repository, so the check validates the page code as recorded (sha256 in the golden file), not the live page after a later edit.' || char(10) ||
       'code-task: repo=qnfo-workers path=scripts/qwav_golden_crosscheck.py' || char(10) ||
       'code-anchor: {"repo": "qwav-demos", "artifact": "-", "covered": False, "quantum_values": None,',
       'claude-session', 'reliability', 'medium', 'open', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #qwav-demos:%');

-- The code-probe line is added by an update: the line trigger (agent_issues_code_probe_upd) installs the code-read contract only when the line is new in the description.
UPDATE agent_issues
SET description = description || char(10) || 'code-probe: {"paths": ["docs/QWAV-CROSS-SIMULATOR.md"], "contains": "All published demos covered: yes"}',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE title LIKE 'ROADMAP-1: QNFO.OPS #qwav-demos:%' AND status = 'open' AND instr(description, 'code-probe: {') = 0;

UPDATE roadmap_implementation
SET status = 'partial',
    evidence = 'partial 2026-11-05: docs/QWAV-CROSS-SIMULATOR.md agreement table for 7 of 8 published demo repositories (scripts/qwav_golden_crosscheck.py, scripts/qwav_page_replay.mjs, docs/qwav-page-golden.json, 5496 page-code comparisons, all agree); no published demo computes a quantum quantity; qwav-demos not covered (agent_issues ROADMAP-1 QNFO.OPS #qwav-demos); closes on the line All published demos covered: yes'
WHERE id = 1686 AND status = 'planned';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session F1-research-reach/E (2026-11-04 open-issue sweep)',
       'a demo page whose own code is replayed on fixed inputs and compared with an independent implementation catches a wrong displayed number that the page''s own verifyMath would pass',
       'QWAV-CROSS-SIMULATOR-PROBE-1: replay the page code of seven published demos, compare 5496 numbers with independent Python implementations, replace the proxy probe of issue-1000642 with the document coverage line, file qwav-demos as a ROADMAP-1 row',
       'PR 6367 covered three demos by formula only and the document listed four as not read; the 2026-11-05 replay found all seven pages in agreement and one label problem (tree-distance "cophenetic distance" is depth(LCA)); contract issue-1000642 failed 212 times on a proxy',
       'scripts, docs and docs/qwav-page-golden.json on main; issue-1000642 stays open on a probe that only the last repository can satisfy',
       'scripts/qwav_golden_crosscheck.py, scripts/qwav_page_replay.mjs, docs/QWAV-CROSS-SIMULATOR.md, docs/qwav-page-golden.json; contract issue-1000642; roadmap row 1686',
       'revert the PR; Rollback line of migrations/2026-11-05-qwav-cross-simulator-probe.sql restores probe, description and roadmap row from bak_20261105_f1e_qwav',
       'a changed demo page is caught when the recorded page output disagrees with the independent value',
       'the contract issue-1000642 stays failing until qwav-demos has a row, then the code-read probe passes; no change to any metric',
       'no external reach change',
       'qwav_golden_crosscheck.py --selftest corrupts one page value per demo and requires a disagreement; qwav_page_replay.test.mjs; qwav_golden_crosscheck.test.mjs ties the document line to the script'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'QWAV-CROSS-SIMULATOR-PROBE-1:%');
