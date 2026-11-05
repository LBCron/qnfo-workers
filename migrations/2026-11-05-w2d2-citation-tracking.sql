-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET evidence = 'VSM S4 / OODA observe | backlog mining 2026-09-30', verified_at = NULL WHERE id = 29 AND item = 'RM-CITATION-TRACKING-ALL-DOIS-1'; DELETE FROM agent_issues WHERE status = 'open' AND title LIKE 'CITATION-TRACKING-1:%';
-- RM-CITATION-TRACKING-ALL-DOIS-1 (roadmap_implementation 29, charter pillar research; session w2d2, 2026-11-05). Evidence only: the row stays partial. The code change belongs in qnfo-infra/worker.js
-- (the indexerMod member), which was under another session's claim (W2-C-composio-console, W2-H-3258) when this was filed, so the doer is the code loop.
--
-- Why only 124 impact_scores rows, and why the rest are missed (read live 2026-11-05):
--   * The premise is gone. NOZ-DOI-1 (owner directive 2026-10-10): the deposit-registrar account is closed and every DOI under 10.5281 is dead; living-paper holds 0 such identifiers (papers.doi is set on 1 of 1098 papers,
--     zenodo_doi on 0; 125 doi_flagged and 121 zenodo_doi_flagged rows hold the flagged ones). The 217 DOIs the row names no longer exist as paper identifiers.
--   * 122 of the 124 impact_scores rows are 10.5281 DOIs, last written 2026-10-10T06:30Z; the other two are the placeholder pending... and 10.64898/2026.07.27.740886 (last written 2026-10-17).
--     citation_stats holds 5221 rows, none for a registrar DOI after 2026-10-10 and one DOI a day (crossref and openalex) until 2026-10-17.
--   * The collector is healthy: the daily slot "30 6 * * *" of qnfo-infra logged ok every day (cron_fire_log, 2026-10-24 to 2026-11-04, 190 to 515 s). runImpact selects papers with doi IS NOT NULL AND doi NOT LIKE
--     '10.5281/%', which is 0 papers from 2026-10-18 and 1 paper since 2026-11-04T23:31Z (kkr-coarse-graining-threshold, external_preprint, DOI written by paperFormatTick), so the next 06:30Z run writes it.
--   * The set the collector can measure is therefore 1 of 726 public papers; the other 725 have no identifier a DOI-keyed source can look up, and no batch size, window or source failure explains the gap.
--   * A real defect found on the way: the open route https://qnfo-infra.q08.workers.dev/indexer/stats still returns the dead 10.5281 DOIs (its query has no prefix filter), which NOZ-DOI-1 forbids on any output.
--   * OpenAlex now rate-limits anonymous use ("Anonymous search is temporarily rate-limited ... use a free API key", read 2026-11-05) and runImpact turns every non-200 into a silent null.
UPDATE roadmap_implementation
SET evidence = 'Read live 2026-11-05 (w2d2): the 217-DOI premise is obsolete (NOZ-DOI-1: registrar closed, 10.5281 DOIs dead; living-paper papers.doi set on 1 of 1098, zenodo_doi on 0). impact_scores 124 rows, 122 under 10.5281 (last written 2026-10-10), 10.64898/2026.07.27.740886 last 2026-10-17; the qnfo-infra slot "30 6 * * *" runs ok daily (cron_fire_log) over the 0 to 1 eligible DOIs, so nothing is missed by batch size, window or a failing source. Open: /indexer/stats serves 10.5281 DOIs (NOZ-DOI-1 breach) and runImpact hides OpenAlex rate limits; filed as CITATION-TRACKING-1 with the code loop as doer (qnfo-infra/worker.js was claimed by W2-C and W2-H). Identifier-free impact (readers) is read from engaged_reader_sessions_7d and paper_readership.ext_30d.',
    verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 29 AND item = 'RM-CITATION-TRACKING-ALL-DOIS-1';

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'CITATION-TRACKING-1: /indexer/stats stops serving closed-registry DOIs and reports collection coverage; runImpact shows OpenAlex rate limits',
'Charter pillar: research. Serves RM-CITATION-TRACKING-ALL-DOIS-1 (roadmap_implementation 29). Read live 2026-11-05: https://qnfo-infra.q08.workers.dev/indexer/stats returns the top 20 impact_scores rows, all 10.5281 DOIs (NOZ-DOI-1, owner directive 2026-10-10: the registrar is closed, those DOIs are dead and no output may carry them; NO-REGISTRAR-1 put a prefix guard in the readers and this one has none).

Change in qnfo-infra/worker.js, indexerMod:
1. case "/stats": add AND doi NOT LIKE ''10.5281/%'' to the query, and return a coverage object next to top: public_papers (living-paper papers published or distributed), eligible_dois (papers with doi not null and not under 10.5281), scored_dois (eligible DOIs whose impact_scores.updated_at is within 3 days) and last_collected (max updated_at of the eligible ones). The coverage object makes the real gap visible (1 eligible DOI of 726 public papers on 2026-11-05).
2. runImpact / fetchJson: count non-200 answers by status (429 and the rest) per source in the returned object and in the cron log line, so an OpenAlex anonymous rate limit is a number and not a silent null; pass api_key=<env.OPENALEX_API_KEY> to OpenAlex when the secret is present (a key needs the owner e-mail click, so no key is minted here). Add a case to a qnfo-infra suite that feeds a 429 and a 200.

Do not delete impact_scores or citation_stats rows keyed by 10.5281 DOIs: DOI-ZENODO-INVENTORY-1 kept them as records.

Closing probe: runtime-probe below (the route must not name the registry prefix and must carry the coverage object).

runtime-probe: {"url": "https://qnfo-infra.q08.workers.dev/indexer/stats", "status": 200, "contains": "public_papers", "absent": "10.5281/"}
code-task: repo=qnfo-workers path=qnfo-infra/worker.js
code-anchor: async function runImpact(env, commit, limit) {',
'session-w2d2', 'code', 'medium', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'CITATION-TRACKING-1:%');
