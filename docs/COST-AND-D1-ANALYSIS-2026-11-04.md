# Cost and D1 analysis, 2026-11-04 (COST-D1-DRILL-1, pillar cost)

Every number below was read in this session on 2026-11-04 between 14:30Z and 15:40Z. Sources: Cloudflare GraphQL `d1AnalyticsAdaptiveGroups`, `d1QueriesAdaptiveGroups`, `aiInferenceAdaptiveGroups` (account meter), D1 tables `ai_call_counters` and `ai_spend_ledger`, and `GET https://fleet.qnfo.org/api/cost`.

## 1. Is D1 the right database?

- D1 is the reliability bottleneck, not the cost driver. qnfo-audit is one 1.5 GB database with 878 tables and a single writer. In the 24 h to 2026-11-04 14:00Z: 680,614 queries, 2.39 billion rows read, 1.16 million rows written, 3.3 h of database time. The overload error ("Too many resources consumed within a 10 second window") comes from heavy single statements, not from volume: a `fleet_tick` insert fires 52 triggers inside one statement (8 s each), and `v_output_quality_headline` scanned 1.5M rows per call.
- At list price (rows read $0.001 per million beyond 25 billion a month; not checked against an invoice in this session) 2.39 billion rows a day is about $47 a month. The fleet cost view (`/api/cost`) has no D1 line at all. D1 is small money.
- Read replication on qnfo-audit was `disabled`; it is `auto` since 2026-11-04 15:36Z (PATCH /d1/database, verified by GET). Nothing changes until a read path asks for a replica with `db.withSession("first-unconstrained")`. The errors name `D1DatabaseSessionAlwaysPrimary`, so every read today lands on the primary.
- Better homes for the heavy parts, in order of payoff:
  1. Read paths onto replicas (this change, issue COST-D1-DRILL-1a).
  2. Write-only telemetry (`cloud_ops_events` 6.7k rows a day, `remediation_verifications` 18k a day, `ai_call_counters`) off the primary: batch per tick, or Workers Analytics Engine, which has no single-writer limit.
  3. Trigger cascades (`fleet_tick`, 52 triggers) replaced by one scheduled reader.
  4. Split the hot operational tables (`fleet_tick`, `fleet_runs`, `cloud_ops_events`) into a second D1 database so one heavy statement cannot block the audit tables.

## 2. Where the money goes

Account meter (Workers AI), 7 days to 2026-11-04, about $155 (about $22 a day):

| model | calls | USD | note |
|---|---|---|---|
| kimi-k2.7-code | 6,571 | 42.8 | counters show 873 calls: 7.5x unmetered |
| deepseek-v4.1-flash-1017 | 18,863 | 35.9 | qnfo-agents issue-probe-agent, 147.7M input tokens in 24 h, unmetered (PR 6936 meters it, PR 6940 caps it) |
| kimi-k2.6 | 7,599 | 32.0 | counters show 1,107 calls: 6.9x unmetered, caller unknown |
| gpt-oss-120b | 16,313 | 31.5 | counters show 3,682 |
| glm-5.3-flash | 9,906 | 21.9 | research-exec, 8.5% error rate |
| glm-5.3 | 1,100 | 13.3 | code loop |

By worker (counters, 7 days): qnfo-code-orchestrator $41, qnfo-research-exec $41, everything else under $7. The counters explain about $100 of the $155.

The `/api/cost` pace of $1,151 a month is about $690 measured plus $450 "owner_direct_unverified" ($15 a day, "UNVERIFIED owner-stated monthly figure, no API sees it"). That $450 is not fleet-controlled and not measured; it is 39% of the headline.

## 3. What can be cut without touching output

Evidence-backed, in order of size. None removes a stage or a reviewer.

1. issue-probe-agent: $36 a week was re-sending about 32k tokens per step. Step cap 16 to 6 (PR 6936) and 2 asks per issue (PR 6940): expected cut 70 to 85% of that line, about $25 to $30 a week.
2. Code loop first rung: kimi-k2.7-code at about $0.04 a call, gpt-oss-120b first rung (PR 6921, "equal merge rate") at about $0.003 a call: about $20 a week if the merge rate holds. The merge rate must be re-read after 7 days.
3. Meter the unmetered calls (about 5,700 kimi-k2.7-code and 6,500 kimi-k2.6): $35 a week has no named caller, so nothing can be aimed at it yet (issue COST-D1-DRILL-1b).
4. research-exec: 14% of glm-5.3-flash calls error and are retried. 117k neurons per publication against a 20k target is a volume question for the research session, not a model one.

A 90% cut is not reachable from these without removing work: the measured, attributable, safely cuttable spend is about 40 to 50% of the Workers AI line. The $450 unverified line is outside the fleet.
