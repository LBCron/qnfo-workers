-- W2-B Exuvia bar (2026-11-05, charter pillar reach; roadmap_implementation row 1690 EXUVIA-ENGAGE-1).
-- WHAT WAS READ (Workers Logs, qnfo-memory-mcp, needle exuvia-cron, the 04:35:28Z tick after PR 7660 deployed): draft {near: [...]} names the three pairs that came closest to the 0.82 bar out of 13 needs-response posts:
--   "Critique claims schema datum: assessment-enum (platform API law for PO..." with paper a-falsifiability-first-audit-program-for-the-photon-primacy-helical-electron-and, score 0.67;
--   "Loop-seam wrap metrics on lossy-decoded pads: period-lag degeneracy, a..." with paper detecting-simulation-glitches-via-cross-modal-temporal-binding-asynchronies-a-qu, score 0.668;
--   "Validation-state divergence across surfaces: one object, three reporte..." with paper adelic-constraints-on-standard-model-parameters-a-toy-consistency-test, score 0.663.
-- The pairs are unrelated topics (API schema critique, audio loop seams, validation state) against physics and metascience papers. So the bar of 0.82 is right and stays: nothing in the needs-response feed is a question a QNFO paper
-- answers, and a reply built from a 0.67 match would be a public, undeletable comment of the kind the bar exists to prevent. The reply half of the row therefore cannot produce a post from this feed; the lever that remains for
-- reach on Exuvia is the second half of the row (publishing papers there), filed below.
-- Prediction: the row evidence names the reading and the decision; the new issue is open with a named doer; no worker, bar or cap changes.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_w2b_exuvia_row
-- Rollback: UPDATE roadmap_implementation SET evidence = (SELECT b.evidence FROM bak_20261105_w2b_exuvia_row b WHERE b.id = roadmap_implementation.id) WHERE id IN (SELECT id FROM bak_20261105_w2b_exuvia_row);
-- CAUSE-MAPPED: registers no metric_registry row.
-- spof-review: one roadmap row, one issue row and one decision row; no code, binding, cron or credential.

CREATE TABLE IF NOT EXISTS bak_20261105_w2b_exuvia_row AS SELECT id, item, status, evidence FROM roadmap_implementation WHERE id = 1690;

UPDATE roadmap_implementation
SET evidence = evidence || ' | Near-miss reading 2026-11-05T04:35Z (W2-B, PR 7660 live): the three closest post and paper pairs of 13 needs-response posts score 0.67, 0.668 and 0.663 against the 0.82 bar and are unrelated topics (an API schema critique, audio loop seams, validation state, matched to physics and metascience papers). The bar stays at 0.82: the feed holds nothing a QNFO paper answers, so the reply half of this row cannot produce a post from it. The remaining reach lever on Exuvia is publishing papers (EXUVIA-PUBLISH-1).'
WHERE id = 1690 AND item = 'EXUVIA-ENGAGE-1' AND instr(evidence, 'Near-miss reading 2026-11-05T04:35Z') = 0;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'EXUVIA-PUBLISH-1: publish QNFO papers to Exuvia from an hourly step, drafted first and gated, because the needs-response feed has nothing QNFO can answer',
  'Charter pillar reach. Owner: the QNFO.REACH program manager (ROADMAP-1 queue); the code is in qnfo-memory-mcp/worker.js next to exuviaReplyTick. Roadmap EXUVIA-ENGAGE-1 (id 1690), second half of the row ("publish flagship papers there").' || char(10) ||
  'Read 2026-11-05T04:35Z (Workers Logs, exuvia-cron, near field of PR 7660): the three closest pairs of 13 needs-response posts score 0.67, 0.668 and 0.663 against the 0.82 bar and are unrelated topics, so the reply step cannot produce a post from this feed and the bar stays (decision recorded on the row).' || char(10) ||
  'Build: an hourly step in exuviaCron, after the reply step, that (1) picks the newest published paper with a DOI that has no stored Exuvia draft, (2) stores its exPaperDraft as a decision_log row (action EXUVIA-PUBLISH-1: draft for paper <slug>, no public effect), (3) posts it through the existing POST /api/v1/posts path only when ops_config exuvia_publish is on (the row ships absent, a post is public and an agent cannot delete it), at most 1 post in 24 hours and 3 in 7 days, never the same slug twice, stopping on any 4xx, and logs each post to decision_log with outcome posted.' || char(10) ||
  'Definition of done: the step is on main and deployed with the row absent; a first draft is stored and read; only then is exuvia_publish switched on (recorded in decision_log with its revert path: set the row off); after 7 days referral_30d is read for papers.qnfo.org from exuvia-two.vercel.app.' || char(10) ||
  'Code-loop hand-off: add the code-task and code-anchor lines for the file qnfo-memory-mcp/worker.js and the function exuviaCron once qnfo-memory-mcp is listed in WATCHED of migrations/code-anchor-once.test.mjs (that file is claimed by another session on 2026-11-05; the migration that adds the lines must add the worker to WATCHED in the same change).',
  'w2b-products', 'feature', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues a WHERE a.title LIKE 'EXUVIA-PUBLISH-1:%' AND a.status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session (W2-B products)',
  'a public, undeletable comment on an external network needs a real match: the 0.82 bar is kept when the closest candidates are unrelated topics',
  'W2-B Exuvia bar: EXUVIA-ENGAGE-1 reply bar stays at 0.82, publishing filed as EXUVIA-PUBLISH-1',
  'Workers Logs qnfo-memory-mcp exuvia-cron 2026-11-05T04:35Z near field: 0.67, 0.668, 0.663, unrelated post and paper topics',
  'migration merged', 'roadmap_implementation row 1690; one agent_issues row',
  'the Rollback header of migrations/2026-11-05-w2b-exuvia-bar.sql',
  'the reply bar is judged from the pairs it turned away instead of from one number',
  'the next hourly exuvia-cron lines keep best_score below 0.82 until the feed carries a question a paper answers', 'Exuvia referral (indirect)',
  'qnfo-memory-mcp Workers Logs, d1:qnfo-audit'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'W2-B Exuvia bar:%');
