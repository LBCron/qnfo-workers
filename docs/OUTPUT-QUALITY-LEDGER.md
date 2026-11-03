# Output quality ledger (OUTPUT-QUALITY-LEDGER-1)

Charter pillar: **reach** (quality of what the fleet publishes), with **research** for papers. Migration:
`migrations/2026-10-26-output-quality-ledger.sql`; suite: `migrations/output-quality-ledger.test.mjs`.

Owner directive 2026-10-26, verbatim: "HOW ARE WE MEASURING FLEET QUALITY? WITH SO MANY METRICS AND SO MANY ISSUES/BREACHES OVERWHELMING AND DAUNTING TO FULLY
RESOLVE, DO NOT LOSE SIGHT OF CONTINUED DRIVE TO BETTER QUALITY OUTPUTS OF ALL KINDS (PAPERS/POSTS/PUBLICATIONS/PROMOTION/CODE/ETC). IS THE FLEET ACTUALLY GETTING
"BETTER" AND HOW WOULD WE KNOW?"

## Why a ledger

The fleet had 284 registered metrics and 67 in breach on 2026-10-26, and almost none said whether an output was good. Three of them had kind `quality`, all for the
ask product. Clearing breaches, closing issues and passing gates measure the fleet's housekeeping, not its output. Five measured facts the ledger is built on:

| Finding (2026-10-26) | Evidence |
|---|---|
| The paper score's mean rose while the papers did not improve | `quality_scores` mean 64.2 (10-08) -> 73.2 (10-25); the same 464 papers fell 64.3 -> 61.4 (24 up, 275 down). 230 newer papers at 96-98 joined the pool. |
| The score cannot show improvement any more | score = min(len/100,40) + min(3*refs,30) + 15*lit + 15*verif; 81% of papers first scored in the last 14 days are at or above 95; new papers are 28-33k characters against 68k for the old ones, with 14-15 references against 6. |
| Over half the published papers carry a known defect | 361 of 694 papers have an open high-severity erratum (PAPER-LEARN-1 and the reviser; 676 rows); 1122 detected and 446 closed in 7 days. Sampled rows quote a claim and a falsification (the GOE and GUE pair correlations called identical). |
| Most q08 essays were later retracted | 131 of 145 `published_pieces` have a `q08_retractions` row (57/57, 17/17, 31/31, 20/20, 6/17, 0/3 by ISO week 37 to 42); 124 of the 131 by the accuracy audit as claims the source does not support. The in-line gate now rejects most drafts (109 `gate_failed` runs in 3 days); no essay has been published since 2026-10-24. |
| The one paper evaluation is not an evaluation | `research_golden_runs`: `false_positive_rate = 1 - catch_rate` in 240 of 240 rows; model and prompt versions blank; written only when a paper fails its first verify. |

## Three rules

1. **A pool average is not evidence.** Compare the same items a week apart (`paper_same_paper_score_delta_7d`), or items made after a change with items made before.
2. **A gate pass is not quality.** A gate keeps known-bad output out. It does not say whether output is improving; q08's gate and panel passed pieces the audit later retracted.
3. **Every surface has an outcome measure, or is reported as a gap.** An unmeasured surface is never green: the headline says `improving_with_gaps`.

## Measure classes

`output_quality_measures` classifies a measure; only `outcome` counts toward the verdict.

| Role | Judged by | Counts toward verdict |
|---|---|---|
| `outcome` | something the generator cannot satisfy: readers, people, a falsifying reviewer, a probe that passes after the fix | yes |
| `proxy` | a rule the generator can satisfy (the structural paper score, the citation-number check) | no; never a target |
| `validity` | whether a measure or a judge is itself trustworthy (score saturation, the golden-run complement, panel effective votes) | no; a finding about the instrument |

| Surface | Outcome measures | Proxies / validity |
|---|---|---|
| papers | `papers_with_open_high_errata_pct` (lower), `errata_high_net_inflow_7d` (lower) | `paper_same_paper_score_delta_7d`, `paper_new_score_saturation_14d`, `golden_run_complement_share_30d` |
| essays (q08) | `q08_human_reads_7d`; `q08_retraction_rate_30d` (written by q08-signal-engine 0.36.0) | `q08_panel_effective_votes_30d` |
| promotion | `outreach_human_clicks_7d`, `outreach_clicks_per_post_7d`, `social_engagement_rate_30d` | |
| site | `engaged_human_sessions_28d` | |
| code | `code_task_success_rate_30d`, `remediation_latest_pass_pct_7d` | |
| ask | `ask_helpful_rate_30d` (visitor ratings; unmeasured below 10 ratings in 30 days) | `ask_citation_validity_7d`; `ask_plain_share_7d` |
| job applications | `jobsearch_reply_rate_90d` (replies, interviews and offers among applications at least 21 days old; unmeasured below 10 mature applications) | |

A measure's `polarity` says which direction is better; `tol_rel` and `tol_abs` set the smallest move that counts (the larger of the two applies), so noise reads `flat`.

## How to read it

```sql
SELECT * FROM v_output_quality_headline;      -- better / worse / flat / unmeasured, gaps, verdict
SELECT * FROM v_output_quality_by_surface;    -- one verdict per surface
SELECT metric, surface, role, prev_value, now_value, moved FROM v_output_quality_verdict ORDER BY surface, role;
```

`moved` is `better`, `worse`, `flat`, `insufficient_history` (no value seven days back) or `stale` (the latest value is over two days old). Fewer than three measured
outcomes is `insufficient_history`. The first verdict on 2026-10-26 (live `metric_history`, the errata measures not yet started): `improving_with_gaps`, 6 better, 1 flat,
gaps `papers` and `ask`: promotion, site, code and reads are up week on week (clicks 373 -> 695, sessions 12,440 -> 16,330, code success 0.40 -> 0.47), while the surface
that holds the fleet's main product has no trend yet and 52% of its papers have an open high-severity erratum.

For `remediation_latest_pass_pct_7d`, the verdict's values instead come from `v_output_quality_remediation_cohort`: latest verdicts for the same subjects
(issue ID, otherwise contract class) in adjacent seven-day windows ending on the latest snapshot day. New-only and dropped subjects cannot bias the trend;
no matched subjects means `insufficient_history`. The all-subject integrity guard and its `metric_history` values remain unchanged.

## What acts on it

- `papers_with_open_high_errata_pct` (trigger, over 10): one issue; levers are reviser throughput, the producer of the repeated claim shape, and revising or unpublishing papers
  that cannot be fixed. It is not closed by rejecting errata or narrowing the reviewer's sweep.
- `output_quality_outcomes_worse` (trigger, over 0): one issue when any outcome measure moved the wrong way beyond tolerance; the fix is at the measure's producer.
- `golden_run_complement_share_30d` (trigger, over 0.1): a code task on `qnfo-research-exec/worker.js`.
- Exempt, with reasons in the migration: `errata_high_net_inflow_7d`, `paper_same_paper_score_delta_7d`, `paper_new_score_saturation_14d`, `output_quality_outcomes_unmeasured`.

The measures are written by `output_quality_heavy_tick`, a trigger on `fleet_tick_heavy` (never on `fleet_tick`, FLEET-TICK-SPLIT-1), each statement gated on its metric being
50 minutes old. `metric_history` (qnfo-fleet-control, daily) supplies the history; the new measures have none for a week, and `output_quality_outcomes_unmeasured` shows it.

## Caveats and what would falsify the ledger

- Errata come from a model reviewer; its errors correlate with the writers (ENSEMBLE-POLICY-1). A wider sweep raises the count without a worse paper, so read the share with the
  net inflow, and keep the belief probe `belief-paper-learn-errata-are-defects` (falsified if the fleet rejects over half of what it closes).
- Reads include reads of retracted essays; clicks are not satisfaction. Promotion and site improving is evidence of reach, not of correctness.
- Not yet measured: the quality of posts beyond clicks, an owner or reader verdict on papers. Ask ratings remain a sparse, self-selected outcome; job-application outcomes remain unknown until the mature-application sample reaches 10.
- The ledger is wrong if the verdict reads `improving` while errata, retractions or reader complaints rise; that is a `validity` finding to fix in `output_quality_measures`, not a reason to
  add a measure that agrees.
