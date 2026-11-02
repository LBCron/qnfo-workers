-- PAPER-FORMAT-2, charter pillar research; GitHub issue QNFO/qnfo-workers#6227.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET status='inactive' WHERE class IN ('fm-revised-paper-formatting','fm-revised-paper-public-layout'); worker revert stops the sweep; prior paper bodies remain in paper_change_ledger/paper_change_bodies.
-- Baseline: the reported public mirror has a split H1, a false Abstract containing
-- OF AGENCY, metadata after a subtitle, and a second real ABSTRACT.
-- PREDICTION: publication and both renderers share one formatter; the first
-- complete sweep repairs historical layouts, the next verifies zero changes.

INSERT OR IGNORE INTO failure_modes
  (fm_key,failure_mode,root_cause,remediation,detector,probe_class,first_seen,trigger_condition,symptom,blast_radius)
VALUES (
  'revised-paper-formatting',
  'Revised papers expose split titles, byline metadata, duplicate abstracts and wrapped headings',
  'A first-line title heuristic fabricated an abstract from title continuations; metadata cleanup stopped at subtitles; only one producer normalized output and PDF source drifted from its shipped bundle',
  'PAPER-FORMAT-2 shares deterministic normalization across queue publication, folded reviser, errata publication, HTML and PDF; a keyset sweep repairs every public paper with immutable history and optimistic concurrency; existing mirror/repository/PDF loops refresh artifacts',
  'Shared formatter, renderer and D1 regression suites; hourly full-sweep convergence and freshness probe',
  'fm-revised-paper-formatting',
  '2026-11-02',
  'A complete paper_format_state sweep still repaired papers, recorded errors, or is more than 120 minutes old',
  'The reported algorithmic-necessity-of-agency paper prints OF AGENCY as its abstract and Author/Contact/ORCID as body paragraphs',
  'All public revised and imported papers, paper pages, PDFs and research mirrors'
);

INSERT OR IGNORE INTO remediation_contracts
  (class,issue_id,precondition,action,verify_probe,verify_transport,max_attempts,escalate_to,expected_cadence_h,status,module,next_due_at)
VALUES (
  'fm-revised-paper-formatting',
  NULL,
  'PAPER-FORMAT-2 full-corpus formatting sweep has converged',
  'failure-mode detector: check paper_format_state.lastSweep. Repair at the shared formatter, not individual paper pages. qnfo-research-exec owns the recurring sweep; source and artifact histories remain immutable.',
  'SELECT ''clean'' AS expected, CASE WHEN json_extract(value,''$.lastSweep.rules'')=''PAPER-FORMAT-2'' AND json_extract(value,''$.lastSweep.checked'')>0 AND json_extract(value,''$.lastSweep.repaired'')=0 AND json_extract(value,''$.lastSweep.errors'')=0 AND datetime(json_extract(value,''$.lastSweep.at'')) >= datetime(''now'',''-120 minutes'') THEN ''clean'' ELSE ''pending or dirty'' END AS observed FROM (SELECT (SELECT value FROM ops_config WHERE key=''paper_format_state'') AS value)',
  'd1-query',
  3,
  'qnfo-research-exec',
  1,
  'active',
  'failure-mode',
  datetime('now')
);

INSERT INTO decision_log
  (actor,assumption,action,evidence,outcome,blast_radius,rollback_path,capability_gain,predicted_outcome,reach_gain,surfaces_tested)
VALUES (
  'copilot:paper-format-2',
  'Bibliographic layout can be repaired deterministically without modifying scientific claims, paper status or version',
  'Use one formatter at publication and rendering boundaries and run a provenance-preserving public-corpus repair',
  'GitHub issue 6227; reported paper opening; matched public-mirror audit and regression suites',
  'pending production verification',
  'Public paper layouts and derived artifacts only',
  'Revert worker changes; prior bodies and metadata are archived by PAPER-LEDGER-1',
  'Consistent revised-paper typesetting with recurring corpus convergence detection',
  'A complete sweep followed by a zero-repair sweep; no metadata prose or false abstract on the reported page',
  'Readable, citable revised publications without withdrawing papers',
  'canonical public paper mirror; shared formatter; gateway HTML; PDF renderer; SQLite-backed D1 repair'
);

INSERT OR IGNORE INTO remediation_contracts
  (class,issue_id,precondition,action,verify_probe,verify_transport,max_attempts,escalate_to,expected_cadence_h,status,module,next_due_at)
VALUES (
  'fm-revised-paper-public-layout',
  NULL,
  'PAPER-FORMAT-2 is deployed at the public paper surface',
  'failure-mode detector: verify the reported public paper retains its real abstract and does not print the split title continuation as an abstract paragraph',
  '{"url":"https://papers.qnfo.org/papers/algorithmic-necessity-of-agency","status":200,"contains":"This treatise presents a comprehensive theoretical synthesis","absent":"<p>OF AGENCY</p>"}',
  'runner-https',
  3,
  'qnfo-research-exec',
  1,
  'active',
  'failure-mode',
  datetime('now')
);
