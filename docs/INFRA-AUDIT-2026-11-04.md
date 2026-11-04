# Infrastructure and AI-spend audit, 2026-11-04 (pillar: cost)

Owner question: is the infrastructure bloated, and why do Workers AI neurons and input tokens cost so much? Numbers below were read
on 2026-11-04 from the Cloudflare API (D1, Vectorize, AI Gateway logs, GraphQL `aiInferenceAdaptiveGroups`) and `qnfo-audit`.

## Workers AI, last 24 h (Cloudflare meter)
About 3.16M neurons and 194M input tokens (about $35/day).

| Model | Calls | Input tokens | Neurons |
|---|---|---|---|
| deepseek-v4.1-flash-1017 | 7,596 | 147.7M | 1.20M |
| gpt-oss-120b | 2,648 | 10.5M | 0.56M |
| kimi-k2.6 | 1,097 | 3.6M | 0.49M |
| glm-5.3-flash | 1,407 | 18.5M | 0.40M |

AI Gateway logs (13:41-14:37 UTC): `qnfo-agents` on deepseek-v4.1-flash-1017 made 184 calls and 5.9M input tokens, about 95% of
the account's input tokens, about 32k tokens per call. The caller is `issue-probe-agent` (migrations/2026-10-26-issue-probe-agent.sql):
1,624 runs in 9 days, one issue re-asked up to 28 times, 377 of 827 issues got an applied check.

Change made 2026-11-04: `ops_config issue_probe_agent_per_hour` 12 -> 2 (decision_log row, revert: set back to 12).
Prediction: deepseek-v4.1-flash-1017 neurons fall at least 70% within 24 h (baseline 1.20M per 24 h). Verify with the same GraphQL query.

Metering gap: `ai_spend_ledger` records about 3M Workers AI input tokens a day against 194M on Cloudflare's meter, so about 98% of
usage is outside the ledger and the fleet_budget caps never see it.

## D1
11 databases. `qnfo-audit` is 1.49 GB: 863 tables (257 are `bak_*`), 214 views, 287 triggers, 217 indexes. Triggers write about 5.7
rows per write; 342M rows read in 3 h on 2026-11-04 is the cause of the "D1 DB is overloaded" tickets.

## Vectorize (10 indexes, about 262k vectors)
Used: personal-life 155k, qwav-research-v2 59k, qnfo-ai-log 10.6k, qnfo-handoffs 3.6k, qnfo-ops-semcache 294.
Candidates to retire: qnfo-infra (3 vectors), qnfo-tasks (111, last write 2026-07-17), qnfo-notes (5.5k, last write 2026-08-10),
ipatent-corpus (7.5k, last write 2026-08-04), qnfo-repos (20.5k, bound in no wrangler.toml).

## Workers
39 live; the repository has 133 directories, 77 with a RETIRED or FOLDED marker.

## Next, in order
1. Meter every Workers AI call into `ai_spend_ledger` (qnfo-ai gateway path) so caps see real spend.
2. Measure per-table reads in `qnfo-audit` (indexed sampling, not full scans); drop `bak_*` tables older than 14 days after a backup export.
3. Retire the Vectorize candidates above after `impact` on each binding (FLEET-GRAPH-1).
4. Cap attempts per issue in issue-probe-agent (at most 2) and trim its context per step.
