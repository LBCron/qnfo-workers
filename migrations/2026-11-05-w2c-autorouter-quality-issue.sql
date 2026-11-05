-- AUTOROUTER-QUALITY-1 (2026-11-05, agent W2-C; charter pillar cost; roadmap row 1695 RM-AUTOROUTER-EVAL-1, parent agent_issues 1000652): the schedule issue AUTOROUTER-SHADOW-SCHEDULE-1 makes the shadow
-- evaluation run, but the parent's definition of done is a comparison of cost AND quality, and the shadow route cannot deliver the quality half: autoRouterShadowRun (qnfo-ai) keeps
-- only SHA-256 hashes of the baseline and Auto Router replies and the verdict is fixed at "unjudged", so no judge can read the two answers afterwards. This files the missing piece with a doer
-- and a closing probe, and records the gap on the parent and on the roadmap row, so the row is not read as finished when the first nine cost rows arrive.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET evidence = (SELECT b.evidence FROM bak_20261105_w2c_autorouter b WHERE b.id = roadmap_implementation.id) WHERE id IN (SELECT id FROM bak_20261105_w2c_autorouter); UPDATE agent_issues SET description = substr(description, 1, instr(description, char(10) || 'DELTA-NOTE (W2-C, 2026-11-05) quality') - 1) WHERE instr(description, char(10) || 'DELTA-NOTE (W2-C, 2026-11-05) quality') > 0
-- BACKUP: bak_20261105_w2c_autorouter

CREATE TABLE IF NOT EXISTS bak_20261105_w2c_autorouter AS SELECT * FROM roadmap_implementation WHERE id = 1695;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'AUTOROUTER-QUALITY-1: the Auto Router shadow evaluation keeps only reply hashes, so the quality half of RM-AUTOROUTER-EVAL-1 cannot be judged',
 'Charter pillar: cost. Doer: qnfo-ai via qnfo-code-orchestrator. Roadmap row 1695, parent agent_issues 1000652 (definition of done: the comparison is recorded with cost per task and quality delta; the judge is non-model or from a disjoint family, ENSEMBLE-POLICY-1). autoRouterShadowRun (qnfo-ai/worker.js) records selected model, latency, cost delta, exact_match and output_length_ratio per replayed prompt as cloud_ops_events kind autorouter-shadow, but stores only baseline_response_sha256 and auto_response_sha256 and sets quality_verdict to unjudged, so the two answers cannot be compared after the run. Scheduling the run (AUTOROUTER-SHADOW-SCHEDULE-1) therefore yields cost evidence only. Change: judge inside the run, while both answers are in memory: a pairwise comparison by a model of a family disjoint from both the baseline and cloudflare/auto (the fleet roster has glm-5.3-flash and llama-3.3-70b; pick the one whose family differs), once with each order, a prompt that sees only the question and the two anonymous answers, scored better, worse or tie for the Auto Router answer; record the verdict in the same event (quality_verdict better, same, worse, split or unjudged when the judge fails) and add judge_model and the two order verdicts to the event meta. Keep no answer text. The judge call is governed by spendGovern like the replay itself and is skipped, not failed, at a cap. Add an offline test with fake answers for the four verdicts and the failure case. Mark the change with a comment containing AUTOROUTER-QUALITY-1. Done: at least 9 autorouter-shadow events from three consecutive days with a quality_verdict other than unjudged on at least 6 of them, and a one-paragraph reading of cost_delta_usd against the verdict counts written in docs/AUTOROUTER-EVAL.md from the rows; adopt Auto Router for a class only if the cost falls and no guard worsens (the parent issue says so).' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-ai/worker.js' || char(10) ||
 'code-anchor: async function autoRouterShadowRun(env, limit) {',
 'session', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'AUTOROUTER-QUALITY-1:%' AND status = 'open');

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''6'' AS expected, CAST(MIN(6, (SELECT COUNT(*) FROM cloud_ops_events WHERE kind = ''autorouter-shadow'' AND status = ''ok'' AND ts >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-4 days'') AND json_extract(meta, ''$.quality_verdict'') IN (''better'', ''same'', ''worse'', ''split''))) AS TEXT) AS observed',
    verify_transport = 'd1-query', status = 'active', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'), expected_cadence_h = 24, module = 'autorouter-quality',
    precondition = 'AUTOROUTER-QUALITY-1: the shadow evaluation records reply hashes only and a fixed unjudged verdict',
    action = 'the code loop adds an in-run pairwise judge from a disjoint model family; judged events are the evidence'
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'AUTOROUTER-QUALITY-1:%' AND status = 'open' ORDER BY id DESC LIMIT 1);

UPDATE agent_issues
SET description = description || char(10) || 'DELTA-NOTE (W2-C, 2026-11-05) quality: the schedule issue AUTOROUTER-SHADOW-SCHEDULE-1 makes the evaluation run daily and so produces the cost half of the comparison; the quality half needs AUTOROUTER-QUALITY-1 because autoRouterShadowRun keeps reply hashes only and a fixed unjudged verdict. This issue stays open until both have recorded evidence.',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1000652 AND status = 'open' AND description NOT LIKE '%DELTA-NOTE (W2-C, 2026-11-05) quality%';

UPDATE roadmap_implementation
SET evidence = evidence || ' | W2-C 2026-11-05: scheduling the run gives the cost half only; autoRouterShadowRun stores reply hashes and a fixed unjudged verdict, so the quality delta of the issue''s definition of done needs an in-run judge from a disjoint model family (AUTOROUTER-QUALITY-1, doer qnfo-ai through the code loop, probe: 6 judged events in 4 days).'
WHERE id = 1695 AND item = 'RM-AUTOROUTER-EVAL-1' AND evidence NOT LIKE '%AUTOROUTER-QUALITY-1%';
