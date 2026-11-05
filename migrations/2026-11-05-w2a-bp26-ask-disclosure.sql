-- W2A-BP26-ASK-DISCLOSURE-1 (2026-11-05, charter pillar security; roadmap_implementation row 1397, agent_issues 1000341 BP26-AI-ACT-ART50-1): the part of the AI-label work that PR 7698 missed
-- by a few minutes (the pull request merged while this commit was being pushed; a merged migration is never edited, so it is a file of its own).
-- Read live 2026-11-05 by an independent scan of the visible text of 11 public hosts (home page plus up to three content pages each): an AI label is visible on qnfo.org, papers.qnfo.org pages,
-- archive.qnfo.org, ideas.qnfo.org and its pages, q08.org and its pieces and reading.q08.org pieces; none on ask.qwav.tech (the public question box: its title says research assistant, its footer
-- says Workers AI, no sentence says an AI system writes the answers), none on qwav.org and none on the ipatent guide pages (whether that copy is AI-written was not established).
-- ai_interaction_disclosure measures three surfaces (ipatent, the twin, the e-mail agent), so the question box is not in the metric. Two issues with doers close that: the sentence on the page, and the
-- surface in the collector.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_w2a_ask_disclosure
-- Rollback: UPDATE roadmap_implementation SET evidence = (SELECT b.evidence FROM bak_20261105_w2a_ask_disclosure b WHERE b.id = roadmap_implementation.id) WHERE id IN (SELECT id FROM bak_20261105_w2a_ask_disclosure); UPDATE agent_issues SET status = 'closed' WHERE status = 'open' AND title LIKE 'BP26-AI-ASK-DISCLOSURE-%';
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261105_w2a_ask_disclosure AS
SELECT id, evidence FROM roadmap_implementation WHERE id = 1397;

UPDATE roadmap_implementation
SET evidence = evidence || ' Independent scan of the visible text (2026-11-05, 11 public hosts, home page and up to three content pages each): an AI label is visible on qnfo.org, papers.qnfo.org pages, archive.qnfo.org, ideas.qnfo.org and its pages, q08.org and its pieces and reading.q08.org pieces; none on ask.qwav.tech, the public question box (it names a research assistant and, in the footer, Workers AI, but no sentence that an AI system writes the answers; ai_interaction_disclosure does not count this surface): agent_issues BP26-AI-ASK-DISCLOSURE-1 (the sentence on the page) and -2 (the surface in the collector). qwav.org and the ipatent guide pages carry no label either; whether that copy is AI-written was not established.'
WHERE id = 1397 AND status = 'partial' AND instr(evidence, 'Independent scan of the visible text') = 0;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'BP26-AI-ASK-DISCLOSURE-1: ask.qwav.tech says at the question box that an AI language model writes every answer',
'Charter pillar: security. Serves BP26-AI-ACT-ART50-1 (agent_issues 1000341, roadmap row 1397, EU AI Act Article 50(1): a person who interacts with an AI system is told so unless that is obvious).

Evidence read 2026-11-05: the visible text of https://ask.qwav.tech/ says "Ask the QNFO research corpus. Answers are written only from the program''s published papers", names a "QNFO research assistant" in the title and mentions Workers AI only in the footer. No sentence tells the visitor that an AI system writes the answer. A scan of the visible text of 11 public hosts finds the AI label on papers, q08.org pieces, reading.q08.org pieces, ideas.qnfo.org and qnfo.org, so this is the one public question box without it.

Change in qnfo-ai-search: in the PAGE template the lede sentence gains one sentence, stated after reading how an answer is produced: "An AI language model writes every answer here; a person does not review it before it is shown." (if the pipeline has a human step the sentence says what it is). Keep the text visible (not in a script or an attribute). Add a case to the worker suite that fetches the page and checks the sentence, and bump the version with scripts/worker_release.py. The file is under another session''s claim at the time of writing; the code loop takes it after the claim.

Closing probe: runtime-probe below.

code-task: repo=qnfo-workers path=qnfo-ai-search/worker.js
code-anchor: <p class="lede">Answers are written only from the program''s published papers.
runtime-probe: {"url": "https://ask.qwav.tech/", "status": 200, "contains": "AI language model writes every answer"}',
'bp26-ai-act', 'security', 'medium', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'BP26-AI-ASK-DISCLOSURE-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'BP26-AI-ASK-DISCLOSURE-2: ai_interaction_disclosure counts the ask.qwav.tech question box as a fourth surface',
'Charter pillar: security. Serves BP26-AI-ACT-ART50-1 (agent_issues 1000341, roadmap row 1397). ai_interaction_disclosure reads 0.6667 over three surfaces (ipatent, the twin, the e-mail agent); the public question box of ask.qwav.tech is an AI interaction that no row measures, so the metric cannot show the gap that BP26-AI-ASK-DISCLOSURE-1 closes.

Change in scripts/bp26_web.py (the collector that already owns has_visible_disclosure and DISCLOSURE_RX): add a helper ask_disclosure_rows(ctx) that fetches https://ask.qwav.tech/, applies the existing visible-text disclosure test and adds the row subject "ask.qwav.tech question box" to the ai_interaction_disclosure rows, so the ratio is over four surfaces. The file is held by session breach-bp26-web at the time of writing; this issue waits for that claim, and the code loop takes it afterwards.

Closing probe: the code-probe below, and the next collect_web run lists the subject.

code-task: repo=qnfo-workers path=scripts/bp26_web.py
code-anchor: def has_visible_disclosure(page):
code-probe: {"paths": ["scripts/bp26_web.py"], "contains": "ask_disclosure_rows"}',
'bp26-ai-act', 'security', 'low', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'BP26-AI-ASK-DISCLOSURE-2:%');
