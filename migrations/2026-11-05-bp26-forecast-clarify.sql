-- BP26-FORECAST-CLARIFY-1 (2026-11-05, charter pillar research; breach forecast_resolution_criteria_complete, trigger 14490, agent_issues 1000671; practice BP26-FORECAST-HYGIENE-1, 1000337).
-- WHAT WAS MEASURED (q08-signal D1, read-only, 2026-11-04 23:00Z): three open forecasts (ids 2, 3, 4, published 2026-10-26, before the 0.38.0 gate), 0 of 3 complete. Forecast 3 (Broadcom) and 4 (TrendForce)
--   name a source and a date but state no edge-case rule; forecast 2 (PJM) names its source only in watch_urls and states no edge-case rule either. New forecasts are gated (validateForecast), but none has been
--   published since 2026-10-26 (q08_forecasts holds 4 rows), and the share is taken over OPEN forecasts, so it could not move.
-- WHY THE EARLIER FIX NEVER FIRED: FORECAST-CRITERIA-REPUBLISH-1 (issue 1000740, closed) added a sweep that voids and republishes. It read q08_forecasts.resolution_text, which is the settling verdict and NULL on every
--   open row, so it skipped every row; it tested the literal words "source" and "edge case" instead of the three patterns the metric and the gate use; and it called generateForecast(env, { replaceId }) although
--   that function takes a start time and runs the whole compose pipeline. Made to work it would have voided three live public forecasts and spent three compose runs on an unbounded retry.
-- FIX (q08-signal-engine, offline suite q08-signal-engine/forecast-clarify.test.mjs, 17 checks): the published text stays immutable. A legacy forecast gains one dated, append-only clarification beside it
--   (table q08_forecast_clarifications, one row per forecast and kind, update and delete refused by trigger), written from facts the row already holds: watch_urls as the source, the horizon as the date, and the
--   settling rule resolveForecasts already applies (evidence dated on or before the horizon; undecidable after four weekly checks is void and unscored). It documents how the resolver behaves; it changes no outcome
--   and no score. A forecast whose source cannot be named from its own record is left alone, so that gap stays visible. The page shows the clarification under the original text, /api/forecasts carries it,
--   and scripts/bp26_forecast.py reads resolution plus clarification (it falls back to the bare text while the table does not exist).
-- PREDICTION: forecast_resolution_criteria_complete 0 -> 1.0 (3 of 3) at the first producer run after the worker deploys and its next cron tick; stays 1.0 while every new forecast passes the gate. Guard: no forecast
--   is voided, regenerated or rescored (the suite asserts it).
-- ALSO CORRECTS my note of the same day on agent_issues 1000670 (migrations/2026-11-05-bp26-ib-cards-and-latency-notes.sql): lever (1), one remediation row per paper, is already in routeHighRiskErrata (groups by slug,
--   merges into an unstarted row; 4 residual duplicates predate it); the throttle on remediation is RESEARCH-BACKPRESSURE-1 with RB-ERRATA-SHARE-1 (488 remediation rows deferred at "ready queue at capacity (192)") and
--   revision_loop_mode off, which is the cost lane.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM agent_issues WHERE instr(title, 'BP26-EMAIL-AUTH-1 (implement): q08.org publishes DMARC') = 1 AND status = 'open' AND source = 'session'; UPDATE metric_registry SET source_of_truth = 'q08-signal.q08_forecasts [BP26]' WHERE metric = 'forecast_resolution_criteria_complete'; UPDATE agent_issues SET description = substr(description, 1, instr(description, char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05b)') - 1) WHERE instr(description, char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05b)') > 0; DELETE FROM decision_log WHERE instr(action, 'BP26-FORECAST-CLARIFY-1:') = 1
-- CAUSE-MAPPED: no metric is registered here; this edits the source_of_truth text of an existing metric and appends notes to existing issues.

UPDATE metric_registry SET source_of_truth = 'q08-signal.q08_forecasts: share of OPEN forecasts whose resolution text, read together with its dated clarification in q08_forecast_clarifications, names a source, a date and an edge-case rule (three text patterns, the same as the generation gate), scripts/bp26_forecast.py on the remediation-consumer runner; a legacy forecast gains the clarification from the q08-signal-engine cron sweep (BP26-FORECAST-CLARIFY-1) [BP26]'
  WHERE metric = 'forecast_resolution_criteria_complete';

UPDATE agent_issues
SET description = description || char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05b): measure checked, valid; the practice was the gap. The three open forecasts (published 2026-10-26, before the 0.38.0 gate) state no edge-case rule and forecast 2 names its source only in watch_urls. The FORECAST-CRITERIA-REPUBLISH-1 sweep (issue 1000740) read resolution_text (NULL on open rows), used different patterns and called generateForecast with the wrong arguments, so it never fired and would have voided public forecasts if made to. Replaced by BP26-FORECAST-CLARIFY-1 in q08-signal-engine: a dated, append-only clarification table beside the immutable text, written from watch_urls, the horizon and the settling rule the resolver already applies; nothing voided, regenerated or rescored. Predicted 0 -> 1.0 after the deploy and the next cron tick. Closing probe: this issue''s contract (metric 14490 at 1).',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1000671 AND status = 'open' AND instr(description, 'DELTA-NOTE (breach-bp26-reach, 2026-11-05b)') = 0;

UPDATE agent_issues
SET description = description || char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05b): the earlier note that a backfill of legacy forecasts is not allowed holds for the published text and is respected: BP26-FORECAST-CLARIFY-1 adds dated clarifications in a separate append-only table (q08_forecast_clarifications) and leaves claim, probability, horizon, resolution text and timestamp as published.',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1000337 AND status = 'open' AND instr(description, 'DELTA-NOTE (breach-bp26-reach, 2026-11-05b)') = 0;

UPDATE agent_issues
SET description = description || char(10) || 'DELTA-NOTE (breach-bp26-reach, 2026-11-05b): correction to the note above. Lever (1) is already in code: routeHighRiskErrata (qnfo-research-exec) groups errata by paper and merges them into an unstarted remediation row (ERRATA-HIGHRISK-ROUTE-1); the 4 duplicates that fm-errata-remediation-duplicate still reads predate it. The throttle is RESEARCH-BACKPRESSURE-1 with RB-ERRATA-SHARE-1 (qnfo-fleet-control): 488 remediation rows are deferred at "ready queue at capacity (192)" and revision_loop_mode is off, so the lane is bounded by executor capacity and the research budget, not by routing. That is the cost lane; this issue stays open on it.',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1000670 AND status = 'open' AND instr(description, 'DELTA-NOTE (breach-bp26-reach, 2026-11-05b)') = 0;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'BP26-EMAIL-AUTH-1 (implement): q08.org publishes DMARC with no rua, so the mail sent from digest@q08.org and companion@q08.org is never measured',
 'Charter pillar: reach. Practice BP26-EMAIL-AUTH-1 (#1000347), metric dmarc_aligned_pass_rate (fixed to count only the fleet''s own senders by BP26-DMARC-FOREIGN-1, PR 7296). Measured 2026-11-05 by DNS-over-HTTPS and the Cloudflare API: _dmarc.q08.org is "v=DMARC1; p=reject;" with no rua, while q08-signal-engine (digest@q08.org) and personal-companion (companion@q08.org) send list mail from q08.org; qnfo.org, qwav.org and qwav.tech each publish rua=mailto:dmarc@<their domain>. No aggregate report for q08.org ever arrives, so the 7-day window cannot show whether that mail aligns (bp26_dns_email_auth: dmarc_rua 0 for q08.org). Email Routing on q08.org is enabled and ready, its catch-all forwards to qnfo@qnfo.org, which qnfo-email already archives, so dmarc@q08.org needs no new routing and, being inside the policy domain, no external-destination authorization record.' || char(10) ||
 'Change: set the TXT record of _dmarc.q08.org to "v=DMARC1; p=reject; rua=mailto:dmarc@q08.org;" (add the tag only; p and the absent sp stay as they are, so no mail is treated differently). The fleet writes DNS with the repository token through scripts/cf_ops_actions.py (workflow cf-ops-actions.yml lists its actions as a choice): add an allowlisted action dmarc-rua ZONE (zone q08.org only, refuses when a rua is already present or the record is not exactly the one measured, saves the previous content in its RESULT_JSON, verifies over DoH), with an offline test. Both files were under live claims on 2026-11-05, so this is a session task, not a code-loop task (the loop cannot merge .github/).' || char(10) ||
 'Definition of done: bp26_dns_email_auth shows dmarc_rua 1 for q08.org, and within two days bp26_probe_results has a dmarc:q08.org row from a parsed report. Revert: restore the previous record content printed by the action.',
 'session', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE instr(title, 'BP26-EMAIL-AUTH-1 (implement): q08.org publishes DMARC') = 1 AND status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'breach-bp26-reach', 'a published forecast keeps its words and its timestamp; what it may gain is a dated clarification of how it is settled, never a rewrite, a void or a regeneration',
       'BP26-FORECAST-CLARIFY-1: q08-signal-engine writes an append-only clarification (source from watch_urls, date from the horizon, the settling rule the resolver already applies) for open forecasts whose resolution text lacks one of the three parts, and the metric reads both',
       'q08-signal q08_forecasts: three open forecasts, 0 of 3 complete, none published since 2026-10-26; the FORECAST-CRITERIA-REPUBLISH-1 sweep reads resolution_text (NULL) and passes a wrong argument to generateForecast; offline suites forecast-clarify (17 checks), forecast-hygiene, forecast, forecast-ledger, forecast-research',
       'applied by migration', 'forecast_resolution_criteria_complete and the forecast pages of q08.org; no published field changes',
       'the Rollback line restores the registry text; reverting q08-signal-engine stops new clarifications (existing rows are append-only by design and harmless)',
       'a legacy forecast can be completed without voiding it',
       'forecast_resolution_criteria_complete 0 -> 1.0 after the deploy and the next cron tick',
       'none', 'd1:q08-signal q08_forecasts (SELECT only), node:sqlite replay of the real wording'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE instr(action, 'BP26-FORECAST-CLARIFY-1:') = 1);
