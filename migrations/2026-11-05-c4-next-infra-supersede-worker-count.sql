-- CF-ESTATE-1 duplicate (2026-11-05, pillar core; follow-up of PR 7413). The WORK next-slice issue that migrations/2026-11-04-c4-next-infra-roadmap-closeout.sql filed
-- ("ROADMAP-1: QNFO.INFRA.WORK #1: worker_count and worker_count_disagreement must not count the qnfo-workers tombstone", id 1001932) asks for the change that
-- agent_issues 1001901 (ROADMAP-1: QNFO.INFRA WORKER-COUNT-1.1: census tombstone class, worker_count_disagreement 1 to 0) already asks for: the same function
-- (workerCountDiff in qnfo-fleet-control/worker.js), the same third argument, the same metric. 1001901 was filed at 2026-11-04T23:07Z by the WORKER-COUNT-1 program (PR 7393), before
-- 1001932 existed, and carries the fuller design (service_registry retired joined to a worker_live_audit row with http 410 and a TOMBSTONE_410 note). I did not search for it before filing.
-- This file closes the duplicate with the surviving id (its code-read contract is superseded the way roadmap-self-maintain supersedes a contract) and maps the survivor to
-- QNFO.INFRA.WORK instead, so the project keeps an open mapped issue with a doer (the steward leaves an open issue on an active catalogue project alone,
-- PS-KEEP-CATALOGUE-PROJECT-1). 1001901 was placed on W.qnfo-fleet-control / QNFO.OPS by the steward although its own text says program QNFO.INFRA; the new row matches the text.
-- The other four issues of that file were searched for duplicates on 2026-11-05 (titles for Pages project, r2.dev, dns-prune, DNS record, d1-query-report, R2 bucket): none.
-- Row 610 names the survivor. The open no-mapped-work gap rows of the five QNFO.INFRA.* projects (days 2026-11-04 and 2026-11-05, written by portfolio-execute step 4 before the first
-- migration applied) are closed here with the condition that raised them gone: each project now has an open mapped issue. Left alone, portfolio-autopilot step 0 closes them only
-- when their day is older than yesterday (2026-11-07). Nothing is deleted.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE issue_triage SET triage_state = 'triaged', close_evidence = NULL WHERE issue_id IN (SELECT id FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.WORK #1: %') AND close_evidence LIKE 'superseded by agent_issues 1001901%'; UPDATE remediation_contracts SET status = 'active', last_verdict = NULL WHERE last_verdict = 'superseded:issue-1001901' AND class IN (SELECT 'issue-' || id FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.WORK #1: %'); UPDATE issue_project_map SET project_code = 'W.qnfo-fleet-control', program_code = 'QNFO.OPS' WHERE issue_id IN (SELECT id FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA WORKER-COUNT-1.1: %') AND project_code = 'QNFO.INFRA.WORK'; UPDATE roadmap_implementation SET evidence = substr(evidence, 1, instr(evidence, ' Supersede 2026-11-05 (c4-next):') - 1) WHERE id = 610 AND instr(evidence, ' Supersede 2026-11-05 (c4-next):') > 0; UPDATE portfolio_gaps SET status = 'open', resolved_at = NULL WHERE kind = 'no-mapped-work' AND entity IN ('QNFO.INFRA.WORK', 'QNFO.INFRA.PAGE', 'QNFO.INFRA.DNS', 'QNFO.INFRA.D1', 'QNFO.INFRA.R2') AND resolved_at >= '2026-11-05';
-- spof-review: data change only; no cron, trigger, binding, host or credential.

UPDATE remediation_contracts
SET status = 'superseded', last_verdict = 'superseded:issue-1001901', last_attempt_at = datetime('now')
WHERE class IN (SELECT 'issue-' || id FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.WORK #1: %')
  AND status = 'active'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA WORKER-COUNT-1.1: %' AND status = 'open');

UPDATE issue_triage
SET triage_state = 'closed',
    close_evidence = 'superseded by agent_issues 1001901 (ROADMAP-1: QNFO.INFRA WORKER-COUNT-1.1): the same change in the same function, qnfo-fleet-control/worker.js workerCountDiff with a tombstones argument, the same metric worker_count_disagreement 1 to 0; 1001901 was filed at 2026-11-04T23:07Z, before this issue, and is open with a code-task, a code-anchor and a code-probe. Read 2026-11-05: 1001901 open, contract issue-1001901 active.'
WHERE issue_id IN (SELECT id FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.WORK #1: %' AND status = 'open')
  AND triage_state <> 'closed'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA WORKER-COUNT-1.1: %' AND status = 'open');

INSERT OR REPLACE INTO issue_project_map (issue_id, project_code, program_code, kind, updated_at)
SELECT a.id, 'QNFO.INFRA.WORK', 'QNFO.INFRA', 'fix', datetime('now')
FROM agent_issues a
WHERE a.title LIKE 'ROADMAP-1: QNFO.INFRA WORKER-COUNT-1.1: %' AND a.status = 'open'
  AND EXISTS (SELECT 1 FROM projects WHERE project_code = 'QNFO.INFRA.WORK');

UPDATE roadmap_implementation
SET evidence = evidence || ' Supersede 2026-11-05 (c4-next): the next slice named above, tombstone-aware worker_count, is the same change as agent_issues 1001901 (WORKER-COUNT-1.1, filed 2026-11-04T23:07Z by the WORKER-COUNT-1 program). The duplicate was closed as superseded by it and 1001901 is now mapped to QNFO.INFRA.WORK.'
WHERE id = 610 AND item = 'NEXT-QNFO.INFRA.WORK' AND instr(evidence, 'PR 7413') > 0 AND instr(evidence, ' Supersede 2026-11-05 (c4-next):') = 0;

UPDATE portfolio_gaps
SET status = 'closed', resolved_at = COALESCE(resolved_at, datetime('now'))
WHERE kind = 'no-mapped-work' AND status = 'open'
  AND entity IN ('QNFO.INFRA.WORK', 'QNFO.INFRA.PAGE', 'QNFO.INFRA.DNS', 'QNFO.INFRA.D1', 'QNFO.INFRA.R2')
  AND EXISTS (SELECT 1 FROM issue_project_map m JOIN agent_issues a ON a.id = m.issue_id WHERE m.project_code = portfolio_gaps.entity AND a.status = 'open');
