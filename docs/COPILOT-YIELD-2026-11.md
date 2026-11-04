# Copilot assignment yield, 2026-11-04 (COPILOT-YIELD-1)

Pillar: cost. Question: where does assigning GitHub Copilot to an auto-filed issue produce merged code, and where does it only spend a session?

## Measured (read 2026-11-04)

Source: GitHub search `is:pr author:app/copilot-swe-agent created:>=2026-10-28` returned 576 pull requests, all created 2026-10-30 to 2026-11-04 (the agent's first PRs in this repository
fall in that window, so "7 days" is 5 days of data); 563 of them say `Fixes #N`. Each issue number was joined in `qnfo-audit` through `gh_issue_links` to `agent_issues`
(family = title prefix); `with_codetask` = the issue description carries a `code-task:` line. Closed PRs only (none were open).

| Family | Copilot PRs | Merged | Avg h to merge | Issues with a `code-task:` line |
|---|---|---|---|---|
| METRIC-TRIGGER-* | 127 | 100 (79%) | 2.3 | 43 |
| ISSUE-AGE-24H-REPAIR-1 | 18 | 18 | 7.3 | 0 |
| LOOP-BREAKER-1 | 12 | 10 | 3.4 | 0 |
| CF-OBS-ISSUE-1 | 10 | 9 | 7.9 | 10 (all) |
| METRIC-REGRESSION-1 | 9 | 7 | 27.7 | 0 |
| CODE-LOOP-EXHAUSTED-1 | 9 | 9 | 1.7 | 0 |
| ROOT-CAUSE-1 | 8 | 5 | 5.9 | 0 |
| PROBE-NEEDED-1 | 7 | 7 | 0.4 | 0 |
| BREACH-DOCTOR-1 | 7 | 7 | 9.1 | 5 |
| WORKFLOW-FAILED-1 | 6 | 3 | 5.3 | 0 |
| FLEET-JOURNEY-FAILED-1 | 6 | 5 | 1.3 | 0 |
| ROADMAP-1 | 5 | 5 | 2.8 | 3 |
| CHAOS-DRILL-FAILED-1 | 5 | 4 | 3.8 | 0 |
| RUNTIME-PROBE-FAIL-1 | 4 | 4 | 1.3 | 0 |
| OWNER-TASK-* (4 ids) | 8 | 2 | 0.3 | 0 |
| CITE-FULLTEXT-1 | 2 | 0 | | 0 |
| BP26-EDGE-SECURITY-1 | 2 | 0 | | 0 |
| CLOSEOUT-HANDOFF-* | 2 | 0 | | 0 |
| content_items_over_stage_sla | 2 | 0 | | 0 |
| MAIN-RULESET-PUSH-IDENTITY-1 | 2 | 0 | | 2 (all) |

Overall: 416 of 576 PRs merged (72%); 740 issues have ever been assigned to Copilot, 505 of the 2026-10-28 cohort, and 494 of those reached a PR.

What this contradicts: the premise that the symptom mirrors (LOOP-BREAKER, CHAOS-DRILL, CF-OBS, PROBE-NEEDED, RUNTIME-PROBE-FAIL) have a merge yield below 20%. They merge at 71 to 100%.
No sampled family with n >= 5 falls under 20%. Two cautions on that number: (1) "merged" is a lane merge of a green PR, not proof the change fixed the defect (the output-quality
rule applies; re-check `close_evidence` on a sample before trusting it); (2) `search` returns no `changed_files`, so a merged near-empty PR is not separated out. Empty drafts are closed by
EMPTY-FINISHED-DRAFT-1 and show as unmerged; they are the 28% not merged.

The real waste is duplication: 72 of the 563 PRs (about 13%) fix an issue whose description already names a `code-task:` for the code loop. CF-OBS-ISSUE-1 and MAIN-RULESET-PUSH-IDENTITY-1
have it on 100% of issues, METRIC-TRIGGER-* on 34%. For those the code loop opens the PR and Copilot opens a second one on the same file (the two PRs conflict, one is closed).

## Policy change (scripts/assign-copilot-sweep.mjs, `familyDenied`)

Excluded, with no extra GitHub read (the search item already carries the title and body):

1. Records another loop owns, from the measured 0-of-N families and the families that are reports, not defects: `OWNER-TASK*`, `INTENT-TASK*`, `CLOSEOUT-HANDOFF*`,
   `content_items_over_stage_sla`, `CITE-FULLTEXT-1`, `BP26-*` (children have doers), `RESEARCH-TERMINAL*`, `STALE-PR-*`.
   Evidence level: the first five have 0 merged of 2 to 8 PRs; `RESEARCH-TERMINAL` and `STALE-PR-*` produced no PR in the window (prior judgment, not a measured yield; re-measure below).
2. Any issue whose body has a `code-task: repo=...` line (the code loop holds it), except the code loop's own failure mirrors `CODE-LOOP-EXHAUSTED-1`, `CODE-MERGE-REFUSED-1`,
   `CODE-TASK-NEEDS-SESSION-1`, which stay assignable as the second path (they merged 9 of 9, 2 of 3).
3. Never filtered: the issue that fired the run, and `ci-watchdog` (red main).

Unchanged: trust check, never assign a person, 12 open Copilot PR cap, credit canary and cooldown, 170-read budget. Kill switch: repository variable `ASSIGN_COPILOT_FAMILY_FILTER=off`
(the script reads it from the environment; the workflow needs a one-line `env:` mapping to expose the variable, left out because `.github/` changes are not made in this PR; unset means on).
Existing assignments are not touched.

## Predicted saving

- Duplicate sessions removed: 72 PRs over 5.2 days = about 14 assignments/day (13% of volume), plus the records in rule 1 (8 PRs in the window, about 1.5/day). Total about 15 of 108 PRs/day.
- Credits: one Copilot cloud-agent session is billed as one premium request (GitHub pricing, assumption, not read from the account), so about 15 premium requests/day, about 450/month.
  Unmeasured: tokens per session; the owner's "millions of tokens" is per session, so the saving scales with the 15/day.
- Second-order: fewer conflicting PRs for the lane and the 12-slot cap (frees about 1 in 7 slots).
- Prediction to verify: share of Copilot PRs fixing a `code-task:` issue drops from 13% to under 2% within 3 days, and the Copilot merge share stays at or above 72%. If the code loop's
  merge rate on those issues is lower than Copilot's, revert by setting the variable to `off` and replace the rule.

## Re-measure

```
for p in 1 2 3 4 5 6; do gh api -X GET search/issues -f q='repo:QNFO/qnfo-workers is:pr author:app/copilot-swe-agent created:>=2026-10-30' -f per_page=100 -f page=$p > sp$p.json; sleep 5; done
node scripts/copilot-yield.mjs sp1.json sp2.json sp3.json sp4.json sp5.json sp6.json > q.sql   # prints one read-only SELECT for qnfo-audit
```

Cost: 6 REST reads of the search bucket. Add `created:>=<date>` after the change date to compare cohorts. Test: `node scripts/assign-copilot-sweep.test.mjs`.
