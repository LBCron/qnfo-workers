-- EK-2-COVERAGE-1 rescope (2026-11-05, charter pillar reach; session W2-G). The issue (id 1002100, migration 2026-11-05-ek2-coverage-1.sql) and its note (2026-11-05-ek2-coverage-note-1.sql) recommended a first slice
-- (a Wikipedia-cited-references adapter on reuse-permitting hosts). That slice was then measured and does not pay: of 25 contested candidates replayed through the real fetch and text extraction, 2 pass the full gate
-- (8 percent, the 7.7 percent the three adapters already give); of 37 page fetches 16 were HTTP 403 bot blocks, 15 were under the 2500-character floor, and 11 of the 14 pages that were fetched never name the topic
-- (the cited page supports another fact in the article). Leaving the old fix text in front of the doer would spend a code-loop slot on a change with no yield, so the description is replaced (old text kept in the backup).
-- Decision taken for the owner (DEFAULT-APPROVE-1, reversible): the gate stays as the owner's EK-2 specification; the supplier stays at three adapters; the only code change is the measure (the supply share), so a
-- later licence or gate decision has a baseline. News hosts (BBC, Guardian, Al Jazeera, DW, NPR, AP; 29 of 47 candidates by link count) only through a publisher API or licence the owner holds: an identity-bound step,
-- not built by scraping. The yield lever for readers is the per-attempt accept rate, tracked on the fact-check path, not the supplier.
-- Prediction: companion_contested_supply_share_7d exists within a day of the slice merging and reads about 0.08 (candidates that passed the gate over candidates asked).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_ek2_cov_rescope
-- Rollback: UPDATE agent_issues SET description = (SELECT b.description FROM bak_20261105_ek2_cov_rescope b WHERE b.id = agent_issues.id) WHERE id IN (SELECT id FROM bak_20261105_ek2_cov_rescope);
-- CAUSE-MAPPED: registers no metric_registry row.
-- NOOP-OK: the UPDATE is guarded by its own marker; a replay changes nothing.

CREATE TABLE IF NOT EXISTS bak_20261105_ek2_cov_rescope AS
SELECT id, description FROM agent_issues WHERE title LIKE 'EK-2-COVERAGE-1:%' AND status = 'open';

UPDATE agent_issues
SET description = 'Pillar reach, program QNFO.REACH, roadmap EK-2 (row 1749, deployed, not built), parent agent_issues 1000713. Read 2026-11-05 and replayed outside the worker (same queries and filters as fetchHansardSource, fetchGlobalVoicesSource, fetchGovUkSource): every call answers HTTP 200 in 85 to 4300 ms, so "none" is correct, not a defect. Of 52 distinct contested candidates the gate dropped 2026-10-30..11-05, 4 pass (Spanish Civil War, World War II, World War I, New Deal); the 04:00Z run on 2026-11-05 asked four candidates and got none from all three adapters. With a 5 percent accept rate the supplier is worth about 0.03 pieces a day.' || char(10) ||
'Measured alternatives (W2-G, 2026-11-05), none shipped: (a) Hansard speeches search as a fallback: 4 of 52, no gain. (b) Wikipedia-cited references on reuse-permitting hosts (un.org, loc.gov, archives.gov, history.state.gov, state.gov, cia.gov, gov.uk, parliament.uk, europa.eu, worldbank.org, nobelprize.org, nato.int, icj-cij.org, cvce.eu), real fetch and text extraction: 2 of 25 candidates pass the full gate (8 percent); of 37 page fetches 16 were HTTP 403, 15 were under the 2500-character floor and 11 of 14 fetched pages never name the topic. That slice is withdrawn. (c) Cited news hosts (BBC, Guardian, Al Jazeera, DW, NPR, AP) reach 29 of 47 candidates by link count, but their terms do not allow scraping their pages for generation: only through a publisher API or licence the owner holds (an identity-bound step).' || char(10) ||
'Decision (default in effect, reversible): the gate stays as the owner specified EK-2; the supplier stays at three adapters; the only code change here is the measure. Do not relax the gate to raise the count. The reader-facing lever is the per-attempt accept rate (3 pieces to 24 fact-check rejections since 2026-10-29; 39 of 75 unsupported claims read "not in source" or "not stated"; accepted and rejected runs read the same 4.5k to 6k characters of source, so thin sources are not the cause).' || char(10) ||
'Fix (the one slice): in personal-companion/worker.js write counts, from the run log and no text, of the contested candidates asked of the supplier and the candidates that passed contestedSourcesOk, as metric companion_contested_supply_share_7d (passed over asked, 7 days), beside writeSourceMetrics; register the metric by migration with its trigger or a named exemption and a cause mapping. Counts and public titles only; nothing from a piece leaves the personal plane.' || char(10) ||
'code-task: repo=qnfo-workers path=personal-companion/worker.js' || char(10) ||
'code-anchor: async function writeSourceMetrics(env, now) {' || char(10) ||
'code-probe: {"paths": ["personal-companion/worker.js"], "contains": "companion_contested_supply_share_7d"}',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE title LIKE 'EK-2-COVERAGE-1:%' AND status = 'open' AND instr(description, 'Measured alternatives (W2-G, 2026-11-05), none shipped') = 0;

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:W2-G-even-keel',
  'the EK-2 supplier is limited by the corpora of its adapters, not by a defect; widening it with free sources would not pay and widening it with news pages is not ours to scrape',
  'EK-2-COVERAGE-1: rescope the issue from a fourth adapter to the supply-share measure; keep the gate and the three adapters; the news-host route is an owner-held licence',
  'replays 2026-11-05: three adapters 4 of 52 dropped candidates; speeches fallback 4 of 52; cited reuse-permitting pages 2 of 25 through the real fetch (16 of 37 fetches HTTP 403, 15 under the floor, 11 of 14 off topic); cited hosts including news 29 of 47 by link count',
  'pending',
  'the description of one open agent_issue and one decision row; no worker, no gate, no cron',
  'the Rollback line of migrations/2026-11-05-ek2-coverage-rescope-1.sql (old text in bak_20261105_ek2_cov_rescope)',
  'contested-supply-share-measure',
  'companion_contested_supply_share_7d exists within 48 h of the slice merging',
  'No reach gain claimed: the decision avoids a change measured to gain nothing.',
  'five replays outside the worker over the real dropped candidates; run log of 2026-11-05 04:00Z'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'EK-2-COVERAGE-1: rescope%');
