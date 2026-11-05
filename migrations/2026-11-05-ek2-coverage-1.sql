-- EK-2-COVERAGE-1 (2026-11-05, charter pillar reach, program QNFO.REACH; roadmap EK-2 row 1749, agent_issues 1000713; found by session W2-G).
-- WHAT WAS MEASURED (2026-11-05, personal plane counts and public Wikipedia titles only, nothing stored): personal-companion 1.45.2 deployed the EK-2 supplier (Hansard, Global Voices, GOV.UK) at 03:16Z.
-- The 04:00Z run asked all three for four contested candidates (Suez Crisis, Vietnamization, Blaine Act, United States Office of War Information) and all three answered none for all four.
-- Reproduced outside the worker with the same queries and filters: every call answered HTTP 200 in 85 to 4300 ms (no timeout, no block), so none is not a defect in the adapters: the corpora do not hold these topics.
--   Hansard's debates search matches debate TITLES and the API holds 1997 onward; Global Voices' WordPress search returns six loosely matching posts and the relevance filter correctly keeps none; GOV.UK news
--   stories mention an old crisis once in passing and the "discusses it" filter correctly drops them.
-- Replay over the 52 distinct contested candidates the gate dropped 2026-10-30..11-05 (the 70 listed in companion_runs, 52 replayed): the gate needs Wikipedia plus two of the three adapters answering;
--   4 of 52 pass (7.7 percent: Spanish Civil War, World War II, World War I, New Deal), 48 get at most one adapter. A Hansard fallback that searches speeches (385 hits for "Suez Crisis") was built and replayed: 4 of 52, no
--   gain, so it was not shipped. The build-time replay read 5 of 45 (11 percent): the same figure.
-- WHY IT MATTERS: the desk's pieces written fell from 9 (2026-10-22..28) to 3 (2026-10-29..11-05). Before 2026-10-29 the yield was brute force (100 to 170 rejected or failed log rows a day for 1 to 4 pieces, a 2 to 5 percent
--   accept rate); the gate removed the contested candidates and the retry brake (PR 7618) now waits three ticks under a 10 percent accept rate. With 4 of 52 candidates suppliable and a 5 percent accept rate, EK-2 as built is
--   worth about 0.03 pieces a day. The supplier works; its coverage is the limit. The honest remainder of EK-2 (row 1749 stays deployed, not built) is a supplier with coverage of history and non-UK topics.
-- THIS FILE files that remainder as an issue with a doer and a measuring probe; it changes no worker and no gate (the gate is the owner's EK-2 specification and is not relaxed).
-- Prediction: after a Wikipedia-cited-references adapter, at least 25 percent of replayed dropped candidates pass the gate (from 7.7) and companion_independent_source_pieces_30d reaches 1 within 7 days.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM agent_issues WHERE title LIKE 'EK-2-COVERAGE-1:%' AND status = 'open' AND source = 'session:W2-G-even-keel';
-- CAUSE-MAPPED: registers no metric_registry row.

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'EK-2-COVERAGE-1: the contested-topic supplier (Hansard, Global Voices, GOV.UK) answers for 4 of 52 dropped candidates; the pool is history and non-UK topics outside those corpora',
'Pillar reach, program QNFO.REACH, roadmap EK-2 (row 1749, deployed, not built), parent agent_issues 1000713. Read 2026-11-05 and replayed outside the worker (same queries and filters as fetchHansardSource, fetchGlobalVoicesSource, fetchGovUkSource): all calls answer HTTP 200 in 85 to 4300 ms, so "none" is correct, not a defect. 52 distinct contested candidates dropped by the gate 2026-10-30..11-05: 4 pass (Spanish Civil War, World War II, World War I, New Deal), 48 get at most one adapter; a Hansard speeches-search fallback also scored 4 of 52. The build-time replay read 5 of 45. The 04:00Z run on 2026-11-05 asked four candidates and got none from all three adapters.
Effect: with a 5 percent accept rate the supplier is worth about 0.03 pieces a day; pieces written fell from 9 (2026-10-22..28) to 3 (2026-10-29..11-05).
Fix (first slice): add a fourth adapter to gatherContestedSources in personal-companion/worker.js that reads the references a Wikipedia article cites (MediaWiki prop=extlinks for the primary topic), keeps only hosts registered in AF_SOURCE_PROFILES with a country and a viewpoint (add the hosts the owner would accept as independent: national archives and parliaments, UN and ICJ documents, the BBC archive, public broadcasters; each profile row names its country and standpoint), fetches the page, extracts the main text with stripTags and the existing length floor, and returns the same anchor shape; the gate (contestedSourcesOk) stays unchanged. Write the supply share (candidates asked, candidates that passed the gate) as counts into metric companion_contested_supply_share_7d from the run log (no text), registered by migration with its trigger.
Do not relax the gate to raise the count. Counts and public titles only; nothing from a piece leaves the personal plane.
code-task: repo=qnfo-workers path=personal-companion/worker.js
code-anchor: async function gatherContestedSources(primary) {
code-probe: {"paths": ["personal-companion/worker.js"], "contains": "companion_contested_supply_share_7d"}',
'session:W2-G-even-keel', 'optimization', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'EK-2-COVERAGE-1:%' AND status = 'open');
