-- C8-MOOT-NEWVERSION-1 (2026-11-05, charter pillar research; cluster C8-PROJECTS-GOALS of the roadmap and backlog completion sweep). Correction of my own PR 7442 (C8-GOALS-NO-DOD-1).
-- That migration filed agent_issues 1001931 "ROADMAP-1: QNFO.RSCH #c8-stuck-newversion: publishV2 recovers a Zenodo newversion draft that refuses new files" with a code-task line for qnfo-research-exec/worker.js, from
-- goal research-exec-newversion-draft-cleanup. The premise was wrong: my read looked for the Zenodo error phrases and found none, and I concluded the handling was unbuilt; it did not check that the Zenodo path itself is gone.
-- Read 2026-11-05 01:50Z: qnfo-research-exec/worker.js has 0 mentions of zenodo (case-insensitive); publishing is in-house (NOZ-DOI-1, INHOUSE-PUBLISH-2/3 #2137, suite qnfo-research-exec/inhouse-publish.test.mjs); the goal itself was retired by the
-- C4-GATES closeout at 2026-11-05T01:18Z (goal_lifecycle action closeout-retired). So no code change is wanted, and the open code-task line would let the code loop try to build a Zenodo recovery branch in a worker with no Zenodo path.
-- This file rewrites the issue's description (an UPDATE of the description is what re-installs the closing contract): the code-task and code-anchor lines are removed, the closing probe becomes the fact that makes the issue moot
-- (the worker carries no zenodo text), and the autoclose trigger closes it on the next pass with that evidence. Nothing is closed by hand.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET description = (SELECT b.description FROM bak_20261105_c8_moot_issue b WHERE b.id = agent_issues.id), updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE id IN (SELECT id FROM bak_20261105_c8_moot_issue)
-- CAUSE-MAPPED: no metric is registered here.

CREATE TABLE IF NOT EXISTS bak_20261105_c8_moot_issue AS SELECT id, description FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.RSCH #c8-stuck-newversion:%';

UPDATE agent_issues SET description = 'MOOT, corrected 2026-11-05 by the session that filed it (C8-PROJECTS-GOALS, PR 7442 filed this on a wrong premise). Goal research-exec-newversion-draft-cleanup asked for a recovery branch for a Zenodo newversion draft that refuses new files. Read 2026-11-05 01:50Z: qnfo-research-exec/worker.js has 0 mentions of zenodo; publishing is in-house (NOZ-DOI-1, INHOUSE-PUBLISH-2/3 #2137, suite qnfo-research-exec/inhouse-publish.test.mjs); the goal was retired by the C4-GATES closeout at 2026-11-05T01:18Z. No code change is wanted: the defect cannot occur in a worker with no Zenodo deposit path. Charter pillar: research. Definition of done: the worker carries no zenodo text (the code-probe below reads absent); the first passing verification closes this issue.' || char(10) || 'code-probe: {"paths": ["qnfo-research-exec/worker.js"], "absent": "zenodo"}',
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE title LIKE 'ROADMAP-1: QNFO.RSCH #c8-stuck-newversion:%' AND status = 'open' AND instr(description, 'MOOT, corrected') = 0;
