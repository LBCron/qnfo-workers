-- W2-D1 / roadmap rows 31 RM-VISION-LIVING-PAPER-1, 36 RM-VISION-REPRODUCE-BUTTON-1, 34 RM-VISION-ULTRAMETRIC-PLAYGROUND-1, 38 RM-VISION-COMPUTE-CLOUD-1 (2026-11-05, charter pillar research): first vertical slice of each is live, the next slices are filed with a doer.
-- Live reads (2026-11-05): qnfo-ai-search 2.16.0 (PR 7734) /paper and /api/paper, 2.17.0 (PR 7764) /reproduce and /api/reproduce, 2.18.0 (PR 7777) /compute; each page answered 200 with its marker, /api/reproduce returned the ledger row, the script and 16 claims for a paper
-- whose recorded server run ended with exit 1 (ModuleNotFoundError: No module named 'sympy'), and a real browser ran that script from the live origin in 30.3 s and printed 16 claims, 16 match.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET status = 'not-built', verified_at = NULL, evidence = substr(evidence, 1, instr(evidence, ' | W2-D1') - 1) WHERE id IN (31, 34, 36, 38) AND instr(evidence, ' | W2-D1') > 0; DELETE FROM agent_issues WHERE status = 'open' AND source = 'w2d1-roadmap' AND (title LIKE 'LIVING-PAPER-2:%' OR title LIKE 'LIVING-PAPER-3:%' OR title LIKE 'REPRODUCE-3:%' OR title LIKE 'REPRODUCE-4:%' OR title LIKE 'COMPUTE-2:%');

UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = evidence || ' | W2-D1 slice 1 live 2026-11-05 (PR 7734, qnfo-ai-search 2.16.0): GET /paper/<slug> on ask.qwav.org shows a published paper with equations drawn by KaTeX (read live: 19 display and 268 inline equations, 287 drawn, on ultrametric-tree-encoding-...), a tap on an equation asks the ASK-PLAIN path with the paper pinned and the live answer said the distance from x to z never exceeds the larger of x to y or y to z, explain-selected-text and an ask-this-paper box share that path (no new model call path, no new binding); /api/paper cached an hour per slug. Next slices filed: LIVING-PAPER-2 (links from papers.qnfo.org), LIVING-PAPER-3 (parameter playground).'
  WHERE id = 31;

UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = evidence || ' | W2-D1 slice 1 live 2026-11-05 (PR 7764, qnfo-ai-search 2.17.0): GET /reproduce/<slug> and /api/reproduce show a paper''s recorded verification script, the claims extracted for it and the output recorded on the server (read live for ultrametric-state-counting-...: cycle-417, 8687-character script, 16 claims, recorded exit 1 with ModuleNotFoundError sympy), and a button runs the script in the reader''s browser with Pyodide 0.29.5 in a Web Worker (loader fetched with an integrity hash): run live on ask.qwav.org, finished in 30.3 s, 16 claims, 16 match. Server compute spent: none. Measured on the public research repository: 455 of 617 paper directories hold a verification.py; of the 40 most recent recorded runs 35 ended with exit 1 and 34 of those import sympy or mpmath. Next slices filed: REPRODUCE-3 (count the runs), REPRODUCE-4 (the generator and the server runtime disagree about packages), LIVING-PAPER-2, LIVING-PAPER-3.'
  WHERE id = 36;

UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = evidence || ' | W2-D1 slice 1 live 2026-11-05 (PR 7777, qnfo-ai-search 2.18.0): already there (read live): ten qwav.org demos, all HTTP 200, cover ultrametric geometry (tree distance sandbox, ultrametric convergence), fault-tolerance simulation (error confinement, staircase redundancy, virtual qubit showdown) and visualisers; the word valuation occurs in none of them. Built: GET /compute, an exact p-adic valuation, absolute value, digits, ultrametric distance and ball calculator that runs in the page and sends nothing, linked with the demos. Not one integrated app: the demos stay separate pages. Next slice filed: COMPUTE-2.'
  WHERE id = 34;

UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = evidence || ' | W2-D1 slice 1 live 2026-11-05 (PR 7777, qnfo-ai-search 2.18.0): GET /compute holds two browser-run calculators, p-adic valuation (exact fractions, digits, distances, balls) and Laws of Form reduction (calling and crossing step by step, truth table for up to five letters), and Reproduce runs a paper''s own script in the browser (PR 7764). Not built: ultrametric embeddings (COMPUTE-2) and the primary algebra''s initials. Phone journeys for the three pages added to scripts/ux-journeys.'
  WHERE id = 38;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'LIVING-PAPER-2: papers.qnfo.org paper pages offer the living view and the reproduction',
'Charter pillar: reach (roadmap rows 31 RM-VISION-LIVING-PAPER-1 and 36 RM-VISION-REPRODUCE-BUTTON-1). Doer: the code loop (code-task below). Metric it should move: requests to ask.qwav.org/paper/<slug> and /reproduce/<slug> (Workers Observability for qnfo-ai-search) and ask_events rows whose query starts with [paper:.

Evidence: the living paper (qnfo-ai-search 2.16.0, PR 7734) and the reproduction page (2.17.0, PR 7764) are reachable from the ask.qwav.org nav and the concept navigator only; a reader on papers.qnfo.org, where the papers are read, is never sent there. 728 papers are published; 455 of 617 research directories hold a verification script.

Change: on the paper page (handlePaperDetail), add two links to the existing action row: "Read with live equations" to https://ask.qwav.org/paper/<slug> and "Reproduce its computations" to https://ask.qwav.org/reproduce/<slug>. The link is plain text and an anchor; no new binding or script. Add the two addresses to the page test.

Closes when: a paper page on papers.qnfo.org carries both links (runtime-probe on a paper page for the first address) and the first ask.qwav.org/paper/<slug> request with a papers.qnfo.org referrer is seen.

code-task: repo=qnfo-workers path=qnfo-gateway/worker.js
code-anchor: async function handlePaperDetail(request, env, path, ctx) {
code-probe: {"paths": ["qnfo-gateway/worker.js"], "contains": "ask.qwav.org/paper/"}',
'w2d1-roadmap', 'roadmap', 'medium', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'LIVING-PAPER-2:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'LIVING-PAPER-3: parameter playground, edit a constant in a paper''s script and re-run it in the browser',
'Charter pillar: research (roadmap row 31 RM-VISION-LIVING-PAPER-1, the "parameter playgrounds" third of the vision). Doer: the code loop (code-task below). Metric it should move: browser runs of edited scripts (counted by REPRODUCE-3).

Evidence: /reproduce/<slug> (qnfo-ai-search 2.17.0) runs a recorded script unchanged. A reader cannot ask "what if p were 7" without leaving the page. Verified live 2026-11-05: the cycle-417 script ran in 30.3 s with sympy in the browser, so a re-run is cheap after the first load (the runtime stays cached).

Change: on the Reproduce page, list the top-level numeric assignments of the script (NAME = number) as number inputs, rewrite the script text with the new values, and run it with the same worker; show the edited lines beside the recorded ones and mark the table "edited" so it is never read as the recorded claim check. Text-only DOM writes, same integrity-checked loader.

Closes when: a test drives the page script with a fake worker and shows the rewritten code reaching the worker, and the live page lists the inputs for the cycle-417 paper.

code-task: repo=qnfo-workers path=qnfo-ai-search/worker.js
code-anchor: function startRun(){
code-probe: {"paths": ["qnfo-ai-search/worker.js"], "contains": "LIVING-PARAMS-1"}',
'w2d1-roadmap', 'roadmap', 'medium', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'LIVING-PAPER-3:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'REPRODUCE-3: count the browser runs of recorded scripts and what they find',
'Charter pillar: research (roadmap row 36 RM-VISION-REPRODUCE-BUTTON-1). Doer: the code loop (code-task below). Metric it registers: reproduce_runs_7d (target at least 10) and reproduce_match_share_7d (runs whose script reports every claim matched).

Evidence: the Reproduce page (qnfo-ai-search 2.17.0) runs entirely in the reader''s browser, so the fleet never sees a run: the only signal is the edge request for the record. A paper whose script fails in the browser, or reports a mismatch, is exactly what the research loop should hear about.

Change: POST /api/reproduce/result {slug, run_id, ok, claims, matched, secs} from the page after a run (a beacon, no cookie, no identifier), validated against the ledger row, stored in a new qnfo-audit table with a per-address hourly cap (the ask_rate table pattern), and read by two metric rows registered in the same migration with their triggers and a metric_breach_cause mapping (METRIC-CAUSE-AT-REGISTRATION-1). A run that reports a mismatch files a REPRODUCE-MISMATCH-1 issue for the paper. The page says what it sends.

Closes when: migrations carry the table and the metric rows, the beacon test passes, and reproduce_runs_7d reads a number from a real browser run.

code-task: repo=qnfo-workers path=qnfo-ai-search/worker.js
code-anchor: async function reproRoute(request, env, ctx) {
code-probe: {"paths": ["qnfo-ai-search/worker.js"], "contains": "REPRODUCE-RESULT-1"}',
'w2d1-roadmap', 'roadmap', 'medium', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'REPRODUCE-3:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'REPRODUCE-4: the verification generator writes scripts that import packages the server sandbox lacks',
'Charter pillar: research (roadmap row 36 RM-VISION-REPRODUCE-BUTTON-1; output quality). Doer: the code loop (code-task below). Metric it should move: the share of recorded verification runs that end with exit 0.

Evidence (public research repository, read 2026-11-05): of the 40 most recent recorded runs (cycles 411 to 450), 35 ended with exit 1; 34 of those scripts import sympy or mpmath and the other is a 159-byte file that is not Python (SyntaxError); the five that exited 0 import only math. The two reports read in full say ModuleNotFoundError: No module named sympy. The VERIFY_GEN prompt already says "stdlib only: math, fractions", so the generator ignores it and the sandbox cannot run the result: for most papers the recorded verification proves nothing either way, and the report then falls back to a text-level recomputation. In a browser the same scripts run (Pyodide loads sympy and mpmath).

Change: in stageVerify, check the generated script''s imports against the stdlib list the prompt names before it runs; on a violation regenerate once with the offending module named in the prompt, and when it still imports outside the list record the run as needs-browser (a line in verification.md the Reproduce page can show) instead of an exit 1 that reads as a failed check. Also reject a script body that is not Python (the cycle-450 file). A test covers the import check.

Closes when: the next 10 recorded runs carry either exit 0 or a needs-browser line, and none ends with ModuleNotFoundError.

code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js
code-anchor: async function stageVerify(env, row) {
code-probe: {"paths": ["qnfo-research-exec/worker.js"], "contains": "REPRODUCE-STDLIB-1"}',
'w2d1-roadmap', 'roadmap', 'high', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'REPRODUCE-4:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'COMPUTE-2: an ultrametric embedding calculator in the browser (the third item of the compute cloud)',
'Charter pillar: research (roadmap rows 38 RM-VISION-COMPUTE-CLOUD-1 and 34 RM-VISION-ULTRAMETRIC-PLAYGROUND-1). Doer: the code loop (code-task below). Metric it should move: visits to /compute that run the third calculator.

Evidence: /compute (qnfo-ai-search 2.18.0) has the p-adic valuation and the Laws of Form calculators; the row also names ultrametric embeddings, which none of the ten qwav.org demos computes from a user''s own numbers (the tree distance sandbox shows distances on a given tree).

Change: a third calculator on /compute: paste a symmetric distance matrix of up to 12 points, compute the subdominant ultrametric (the largest ultrametric below it: minimax path distance, single linkage), show it as a matrix beside the input, draw the merge order as nested brackets, and report the distortion (largest and mean change). Exact arithmetic where the input is a fraction. No request, no script from outside, tests like the other two calculators.

Closes when: the page script test covers the embedding of a known matrix and a refusal of an asymmetric one, and the live /compute shows the third heading.

code-task: repo=qnfo-workers path=qnfo-ai-search/worker.js
code-anchor: function padic(){
code-probe: {"paths": ["qnfo-ai-search/worker.js"], "contains": "COMPUTE-EMBED-1"}',
'w2d1-roadmap', 'roadmap', 'medium', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'COMPUTE-2:%');
