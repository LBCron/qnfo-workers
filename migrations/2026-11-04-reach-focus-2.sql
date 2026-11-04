-- REACH-FOCUS-2 (2026-11-04, charter pillar reach, program QNFO.REACH). Owner words 2026-11-04: the selling point is building AI systems that research (a slow, tedious process), ask the right questions
-- (the Universal Ignorance Audit), and deploy and maintain themselves with autonomous code fixes: one ecosystem. This is the positioning copy ORG-LABEL-1 said waits for the owner.
-- MEASURED 2026-11-04: qnfo.org/work-with-me leads with energy per correct answer (JPCUB) and a five-offer list, and has no offer for building or reviewing an autonomous research system. 4 realtime users sat on that page.
-- WHAT THIS CHANGES: (1) reach_audience_matrix employer and AI-researcher rows carry the new message, (2) one ROADMAP-1 row with a doer for the page. qnfo-gateway/worker.js is held by session-yt-distribution until
-- 2026-11-04T23:03Z (work-locks), so no gateway edit is made here: the code loop or that session's successor takes the row.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE reach_audience_matrix SET message = 'Applied capability: an autonomous research and operations system on Cloudflare that reports its own failures and costs. One case study a month, first person.', updated_at = datetime('now') WHERE audience = 'employers-industry-leaders'
-- Rollback note: the ROADMAP-1 row stays as evidence.
-- CAUSE-MAPPED: registers no metric.
-- spof-review: a table text change read by planners only.

UPDATE reach_audience_matrix
SET message = 'I build AI systems that do research, ask the right questions and maintain themselves. One case study a month with live numbers, including what failed. One researcher with an AI-assisted pipeline, not a lab.',
    proof_asset = 'the fleet dashboard, the Universal Ignorance Audit and its library, merged code-fix pull requests',
    updated_at = datetime('now')
WHERE audience = 'employers-industry-leaders';

UPDATE reach_audience_matrix
SET message = 'The Universal Ignorance Audit as a method others can run, and a falsifiable finding: the reproduction that found the Agentic Collapse trajectory does not follow from its equations.',
    updated_at = datetime('now')
WHERE audience = 'ai-ml-safety-researchers';

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH REACH-FOCUS-1.4: qnfo.org/work-with-me leads with the owner pitch, AI systems that research, ask the right questions and maintain themselves',
 'code-task: repo=qnfo-workers path=qnfo-gateway/worker.js' || char(10) ||
 'code-anchor: var WWM_OFFERS = [' || char(10) ||
 'code-probe: {"paths": ["qnfo-gateway/worker.js"], "contains": "REACH-FOCUS-1.4"}' || char(10) || char(10) ||
 'Charter pillar reach (program QNFO.REACH). Metric it should move: engaged sessions on qnfo.org/work-with-me and inbound email from it (GA4 host qnfo.org, 89 engaged of 217 sessions in 28 days), engaged_reader_sessions_7d. See docs/REACH-PLAYBOOK.md section 0.' || char(10) ||
 'Owner words 2026-11-04: the selling point is building AI systems that research (a slow, tedious process), ask the right questions (the Universal Ignorance Audit), and deploy and maintain themselves with autonomous code fixes, a whole ecosystem.' || char(10) ||
 'Evidence: the live page leads with energy per correct answer (JPCUB) and offers JPCUB assessment, agent-operation review, talks, collaboration and roles. It has no offer for building or reviewing an autonomous research system, and the hero lede never says the pitch.' || char(10) ||
 'EDIT: (1) add a first WWM_OFFERS entry with key research-systems: build or review an AI system that researches, asks the right questions (Universal Ignorance Audit) and maintains itself through tested code-fix pull requests. forWho: teams that need research or analysis done at a pace people cannot, and want it checkable. get: a working pipeline scoped to their domain, the failure ledger method, a cost report. status: say plainly that this is one researcher with an AI-assisted pipeline and link the live fleet dashboard (https://fleet.qnfo.org) and the ignorance-audit library as proof. (2) Rewrite the hero lede in the wwm hero so its second sentence is the pitch before the JPCUB sentence. (3) Change the count text Five ways to six. Keep the JPCUB offer. Mark the change with REACH-FOCUS-1.4. qnfo-gateway/worker.js was claimed by session-yt-distribution until 2026-11-04T23:03Z: take the work claim before editing and bump VERSION with scripts/worker_release.py.' || char(10) ||
 'Definition of done: merged and verified live (curl https://qnfo.org/work-with-me contains research-systems), engaged sessions on the page measured 14 days after deploy and recorded in issue_triage.close_evidence.',
 'session:reach-focus', 'feature', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH REACH-FOCUS-1.4%');
