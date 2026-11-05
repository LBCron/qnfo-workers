-- COST-Q08-YIELD-1 correction (2026-11-05, pillar cost, program QNFO.INFRA, roadmap RM-COST-PER-TASK-ALL-PATHS-1 row 15; session w2f-a).
-- agent_issues 1002036 (filed by migrations/2026-11-05-w2f-a-task-outcomes.sql, merged 04:02Z) blamed the model spend on forecast deferrals ("the same forecast source is re-tried
-- every tick") and asked for a FORECAST_DEFER_CAP. That cause was an inference from engine_runs status counts and it is wrong. Read afterwards, q08-signal engine_runs split by
-- source_kind and status (UTC days, 2026-11-03 and 11-04):
--   forecast / deferred      40 and 36 runs, 0 compose, 0 verify, 0 panel, 0 factcheck calls, 35 s of web research on average: no model spend.
--   hn+fulltext / gate_failed 33 and 35 runs: compose 96 and 91, verify + panel + factcheck 474 and 470 calls. This is the spend: about 2.7 compose and 13 reviewer calls per run.
--   every other kind          a few runs a day, all gate_failed, 0 published.
-- Published pieces: 2026-11-01 2, 11-02 2, 11-03 0, 11-04 0 (published_pieces), against 18 to 20 failed essay runs a day on 11-01 and 11-02 and 33 to 35 since. The gates reject on
-- "ensemble: the edited draft was still not worth reading (panel mean 2 of 5)" and "accuracy: figure/name not in the source". A defer cap would have saved wall time only, so the
-- issue's code-task, anchor and code-probe are replaced. Same issue id, same open state; the doer is still the code loop (code-task line) and the q08 plane's own owners.
-- CAUSE-MAPPED: no metric is registered in this file.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET title = 'COST-Q08-YIELD-1: q08-signal-engine spends about USD 1.18 a day and published nothing on 2026-11-03 and 2026-11-04: the same forecast source is re-tried every tick' WHERE id = 1002036 AND title LIKE 'COST-Q08-YIELD-1%';

UPDATE agent_issues SET
 title = 'COST-Q08-YIELD-1: q08-signal-engine spends about USD 1.18 a day and published nothing on 2026-11-03 and 2026-11-04: 68 essay drafts composed and reviewed (about 1,130 model calls) and every one rejected by the gates',
 updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
 description =
 'code-task: repo=qnfo-workers path=q08-signal-engine/worker.js' || char(10) ||
 'code-anchor: async function generate(env) {' || char(10) ||
 'code-probe: {"paths": ["q08-signal-engine/worker.js"], "contains": "Q08-GATE-RATE-1"}' || char(10) || char(10) ||
 'CORRECTED 2026-11-05 by session w2f-a. Pillar cost (program QNFO.INFRA), roadmap RM-COST-PER-TASK-ALL-PATHS-1 (row 15). Found by the per-task cost join of COST-TASK-OUTCOMES-1 (migrations/2026-11-05-w2f-a-task-outcomes.sql). The first text of this issue blamed forecast deferrals; that was wrong (see below) and its FORECAST_DEFER_CAP task is withdrawn.' || char(10) ||
 'Evidence (q08-signal engine_runs by source_kind and status, ai_call_counters; read 2026-11-05 05:00Z): 2026-11-03 and 2026-11-04 (UTC days) the essay path hn+fulltext ran 33 and 35 times and every run ended gate_failed (compose 96 and 91 calls, verify + panel + factcheck 474 and 470 calls, 0 published); the forecast path ended deferred 40 and 36 times with 0 model calls (35 s of web research each, "forecast research: 4 usable sources; need 6"). ai_call_counters q08-signal-engine 2026-11-04: 107,131 neurons (about USD 1.18) in 331 calls (kimi-k2.6 67 calls 46.6k, deepseek-v4-flash 89 calls 23k, gpt-oss-20b 97 calls 22k). Published pieces per day: 2 on 11-01, 2 on 11-02, 0 on 11-03, 0 on 11-04, 0 so far on 11-05. Gate reasons on 11-04 and 11-05: "ensemble: the edited draft was still not worth reading (panel mean 2 of 5)" and "accuracy: figure not in the source / name not in the source".' || char(10) ||
 'What this says: the quality gates are doing their job, but the writer now fails them on every run, and each failed run pays the whole chain (about 2.7 compose and 13 reviewer calls). Cost per published piece is unbounded while the failure rate is 100 percent. Two things to find out first, from engine_runs and the run errors: what changed between 2026-11-02 (20 failed, 2 ok) and 11-03 (33 failed, 0 ok) in the writer prompt, the source kind mix (fulltext vs summary) or the gate thresholds; and whether the failures cluster on one source family.' || char(10) ||
 'DO (this code-task): add a rate, not a hold (ANTIFRAGILE-1), at the top of generate: a constant Q08-GATE-RATE-1 limits composition attempts to 3 per hour while the last 12 essay runs (engine_runs, source_kind not forecast) all ended gate_failed, writes one skipped engine_runs row with the reason when it limits a tick, and lifts itself as soon as one run ends ok. Bump with python scripts/worker_release.py bump q08-signal-engine; test: 12 gate_failed rows limit the 4th attempt of an hour, one ok row lifts it. The q08 plane stays separate; this changes how often the paid chain runs, not what the gates accept (no gate threshold is touched).' || char(10) ||
 'Definition of done: merged and verified live: engine_runs rows with status gate_failed and source_kind not forecast fall from 33 to 35 a day to 3 a day per hour of limiting or fewer, q08-signal-engine neurons fall from 107k a day to under 60k while pieces published stays 0 or rises, and the writer/gate cause above is named on this issue in issue_triage.close_evidence. Prediction: -45 percent neurons for this worker (about USD 0.5 a day) and a named cause for the zero-publish streak.'
 WHERE id = 1002036 AND status = 'open' AND title LIKE 'COST-Q08-YIELD-1%';
