-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM analytics_metric_triggers WHERE metric_key IN ('paper_ledger_chain_breaks', 'paper_ledger_unsealed_min', 'adr014_new_publication_violations'); DELETE FROM metric_breach_cause WHERE metric_key IN ('paper_ledger_chain_breaks', 'paper_ledger_unsealed_min', 'adr014_new_publication_violations', 'adr014_legacy_byline_papers'); DELETE FROM metric_registry WHERE metric IN ('paper_ledger_chain_breaks', 'paper_ledger_unsealed_min', 'adr014_new_publication_violations', 'adr014_legacy_byline_papers'); DELETE FROM remediation_contracts WHERE class IN ('fm-paper-ledger-chain-broken', 'fm-adr014-authorship-violated'); DELETE FROM failure_modes WHERE fm_key IN ('paper-ledger-chain-broken', 'adr014-authorship-violated'); DELETE FROM control_registry WHERE control IN ('paper-ledger-chain', 'adr014-publish-authorship'); DELETE FROM capability_ledger WHERE capability = 'tamper-evident paper revision ledger with a cross-database anchor'; DELETE FROM human_actions WHERE slug = 'adr-013-014-text-restore' AND status = 'open'; DELETE FROM agent_issues WHERE status = 'open' AND title LIKE 'PAPER-LEDGER-SIGN-1:%'; DELETE FROM agent_issues WHERE status = 'open' AND title LIKE 'ADR014-ENFORCE-PROMOTE-1:%'; DELETE FROM agent_issues WHERE status = 'open' AND title LIKE 'ADR014-LEGACY-BYLINE-1:%'; DELETE FROM agent_issues WHERE status = 'open' AND title LIKE 'ADR013-ULA-PIN-1:%'; DELETE FROM agent_issues WHERE status = 'open' AND title LIKE 'ADR-TEXT-PROBE-1:%'; the append-only decision_log row stays
-- CONTROL-PROBE: none (the alternates of both controls are living-paper statements: the SQL views and the one-statement mode switch live in the living-paper database, which the qnfo-audit drill cannot read; their detectors fm-paper-ledger-chain-broken and fm-adr014-authorship-violated are d1-query@living-paper contracts that run hourly)
-- CAUSE-MAPPED: all four metrics map their breach cause below (publishing, structure, heartbeat); adr014_legacy_byline_papers is observational and exempt from a trigger.
-- METRIC-EXEMPT: adr014_legacy_byline_papers is observational: it counts the organisation-byline papers first published before the ADR objects existed (2026-09-02) and shrinks only as those papers are revised (ADR014-LEGACY-BYLINE-1); a trigger on it would breach until a revision policy that the owner has not set exists.
-- RM-ADR-013-014-ENFORCEMENT-1 (roadmap_implementation 115, charter pillar security; session w2d2, 2026-11-05). Registers what migrations/living-paper/2026-11-05-w2d2-paper-ledger-chain.sql and qnfo-lifecycle 1.19.0 build:
-- the tamper-evident paper ledger (hash chain, cross-database anchor), the ADR-014 publish check, their controls, failure modes with live detectors, four metrics (three with triggers), the decision and the next slices.
-- Row 115 itself is set in a later migration, after the live reads (VERIFY-LIVE-1).
--
-- Measured 2026-11-05 before the change: paper_change_ledger holds 3178 rows (1..3178, contiguous) with append-only triggers but no chain, no anchor and no signature; 726 papers are published or distributed,
-- 276 of them with an organisation byline (first published 2025-01-01 to 2026-08-04), 450 name the owner, and the 296 first published since 2026-09-01 all do; the R2 objects adr/ADR-013-LEGAL-IMMUTABILITY.md and
-- adr/ADR-014-AUTHORSHIP-MANDATE.md (bucket qnfo-audit, 310 bytes each, uploaded 2026-09-02T14:59Z) contain the stdout of a failed wrangler download, not the decisions.

INSERT OR IGNORE INTO control_registry (control, location, kind, guards_against, critical_path, disposition, disposition_state, alternate_path, alternate_tested_at, evidence)
VALUES (
  'paper-ledger-chain',
  'living-paper paper_ledger_chain and triggers paper_ledger_chain_valid, _no_update, _no_delete; qnfo-audit paper_ledger_seals; qnfo-lifecycle 1.19.0 paperLedgerChainTick (migrations/living-paper/2026-11-05-w2d2-paper-ledger-chain.sql)',
  'guard',
  'a rewrite of the paper revision ledger (PAPER-LEDGER-1) by a writer that drops its append-only triggers: an edited, deleted or back-dated ledger row, an edited kept body, or a chain rebuilt over a rewritten ledger',
  0,
  'keep',
  'applied',
  'the SQL checks (v_paper_ledger_chain_breaks and v_paper_ledger_chain_body_breaks) run from any D1 reader without the worker; the hash recomputation and the anchor comparison also run on demand through GET /paper-ledger/chain?verify=1; DROP TRIGGER paper_ledger_chain_valid stops new sealing without touching the data, and a stalled sealer is visible as paper_ledger_unsealed_min above 120',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  'Scratch SQLite suite qnfo-lifecycle/paper-ledger-chain.test.mjs (58 cases): sealing, contiguity and previous-hash triggers, a refused skipped or repeated row, two racing sealers, an edited ledger row, a deleted chain row, a deleted ledger row, a back-dated ledger row, an edited body, an archive fingerprint that disagrees, and a chain forged consistently in living-paper that only the anchor in qnfo-audit catches. Live evidence is recorded in the status migration after the first ticks.'
);

INSERT OR IGNORE INTO control_registry (control, location, kind, guards_against, critical_path, disposition, disposition_state, alternate_path, alternate_tested_at, evidence)
VALUES (
  'adr014-publish-authorship',
  'living-paper adr_enforcement (rule adr014-publish-authorship), adr014_publish_audit, triggers trg_papers_adr014_publish_ins and trg_papers_adr014_publish_upd (migrations/living-paper/2026-11-05-w2d2-paper-ledger-chain.sql)',
  'guard',
  'a paper published or distributed with an organisation byline or no author instead of the individual author (ADR-014)',
  0,
  'keep',
  'applied',
  'mode observe (shipped) records the paper in adr014_publish_audit and lets the write through; UPDATE adr_enforcement SET mode = ''enforce'' refuses it with ADR-014-AUTHORSHIP-BLOCKED; mode ''off'' skips the check; every mode change is one statement and needs no deploy',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  'Scratch SQLite suite (same file): observe records an insert, a first publication by update and an authors change on a public paper; a restore from quarantine, an external preprint and a draft are never recorded; enforce refuses the insert and the first publication and lets the same draft publish once it names the owner; off does nothing. Replay against production: 0 of the 296 papers first published since 2026-09-01 would have been refused.'
);

INSERT OR IGNORE INTO capability_ledger (capability, provenance, prerequisites, reliability, acquired_at, last_exercised_at, evidence)
VALUES (
  'tamper-evident paper revision ledger with a cross-database anchor',
  'RM-ADR-013-014-ENFORCEMENT-1, 2026-11-05 (living-paper paper_ledger_chain; qnfo-audit paper_ledger_seals; qnfo-lifecycle 1.19.0)',
  'PAPER-LEDGER-1 ledger and bodies; the hourly qnfo-lifecycle tick; qnfo-audit paper_ledger_seals',
  'offline suite 58 of 58; live reads recorded after the first ticks',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  'SELECT * FROM v_paper_ledger_chain_status; SELECT * FROM v_paper_ledger_chain_breaks; SELECT * FROM v_paper_ledger_chain_body_breaks; GET https://qnfo-lifecycle.q08.workers.dev/paper-ledger/chain?verify=1; SELECT * FROM v_adr014_authorship_status (living-paper); SELECT * FROM paper_ledger_seals ORDER BY id DESC LIMIT 5 (qnfo-audit)'
);

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES (
  'paper-ledger-chain-broken',
  'The paper revision ledger no longer matches the hash chain sealed over it, or the chain no longer matches its anchor',
  'PAPER-LEDGER-1 made ledger rows append-only with triggers, which a writer with schema rights can drop; nothing could show afterwards that a row had been edited, deleted or back-dated (ADR-013 asks for published artifacts that cannot change without a trace).',
  'paper_ledger_chain (sha256 over the row and the body it kept, each row naming the previous hash), the head anchored in qnfo-audit paper_ledger_seals, SQL checks in v_paper_ledger_chain_breaks and v_paper_ledger_chain_body_breaks and the worker recomputation in qnfo-lifecycle; a break is a plc-break-* event and the paper_ledger_chain_breaks metric.',
  'fm-paper-ledger-chain-broken d1-query@living-paper: the chain exists, has no SQL-visible break and is sealed to within 120 minutes',
  'fm-paper-ledger-chain-broken',
  '2026-11-05',
  NULL,
  'a ledger or chain row is edited, deleted or inserted below the head, a kept body changes, or the sealer stops',
  'v_paper_ledger_chain_breaks and v_paper_ledger_chain_body_breaks list the seq and kind; paper_ledger_chain_breaks above 0; paper_ledger_unsealed_min above 120',
  'the audit trail of every public paper revision'
);

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES (
  'adr014-authorship-violated',
  'A paper is published or distributed with an organisation byline instead of the individual author',
  'ADR-014 (attribution is always the individual) had no check at publish; 276 papers first published 2025-01-01 to 2026-08-04 carry QNFO Research, QNFO or QNFO Research Agent. The publisher has named the owner since 2026-09 (qnfo-research-exec AUTHOR), so the gap is the missing check, not a live producer.',
  'living-paper triggers record (observe) or refuse (enforce) a first publication or an authors change that does not name the owner; v_adr014_authorship_violations lists the exact papers with their era; adr014_new_publication_violations counts the since-ADR ones.',
  'fm-adr014-authorship-violated d1-query@living-paper: no paper first published since 2026-09-02 lacks the owner in authors',
  'fm-adr014-authorship-violated',
  '2026-11-05',
  NULL,
  'a writer publishes a paper whose authors do not name Quni-Gudzinas',
  'v_adr014_authorship_status.violations_since_adr above 0; rows in adr014_publish_audit',
  'public bylines, citation exports and licence attribution of the affected papers'
);

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES (
  'fm-paper-ledger-chain-broken',
  NULL,
  'migrations/living-paper/2026-11-05-w2d2-paper-ledger-chain.sql applied and qnfo-lifecycle 1.19.0 deployed',
  'failure-mode detector',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM paper_ledger_chain) = 0 THEN ''chain not started'' WHEN (SELECT sql_breaks FROM v_paper_ledger_chain_status) > 0 THEN ''chain breaks: '' || (SELECT sql_breaks FROM v_paper_ledger_chain_status) WHEN (SELECT unsealed_min FROM v_paper_ledger_chain_status) > 120 THEN ''unsealed for '' || (SELECT unsealed_min FROM v_paper_ledger_chain_status) || '' min'' ELSE ''ok'' END AS observed',
  'd1-query@living-paper',
  1000,
  'qnfo-ops',
  1,
  'active',
  'failure-mode'
);

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES (
  'fm-adr014-authorship-violated',
  NULL,
  'migrations/living-paper/2026-11-05-w2d2-paper-ledger-chain.sql applied',
  'failure-mode detector',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT violations_since_adr FROM v_adr014_authorship_status) = 0 THEN ''ok'' ELSE ''papers since the ADR without the owner: '' || (SELECT violations_since_adr FROM v_adr014_authorship_status) END AS observed',
  'd1-query@living-paper',
  1000,
  'qnfo-ops',
  1,
  'active',
  'failure-mode'
);

INSERT OR IGNORE INTO metric_registry
  (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, state, refresh_class)
VALUES
  ('paper_ledger_chain_breaks', 'operational', 'guard',
   'SQL-visible chain breaks (v_paper_ledger_chain_breaks and v_paper_ledger_chain_body_breaks) + open plc-break-* events (a ledger or body row whose recomputed hash differs) + seals whose chain row is missing or differs',
   'living-paper.v_paper_ledger_chain_status + qnfo-audit.cloud_ops_events + paper_ledger_seals (qnfo-lifecycle PAPER-LEDGER-CHAIN-1)', 'unmeasured at rollout', '0',
   'qnfo-lifecycle', 'trigger gt 0', '1h', '> 0', '> 0', 'UNMEASURED', 'computed'),
  ('paper_ledger_unsealed_min', 'operational', 'leading',
   'minutes since the chain head was sealed while paper_change_ledger rows wait to be sealed (0 when none wait)',
   'living-paper.v_paper_ledger_chain_status (qnfo-lifecycle PAPER-LEDGER-CHAIN-1)', 'unmeasured at rollout', '<= 120',
   'qnfo-lifecycle', 'trigger gt 120', '1h', '> 90', '> 120', 'UNMEASURED', 'computed'),
  ('adr014_new_publication_violations', 'operational', 'guard',
   'public papers (published, distributed) first published on or after 2026-09-02 whose authors do not name Quni-Gudzinas',
   'living-paper.v_adr014_authorship_status.violations_since_adr (qnfo-lifecycle PAPER-LEDGER-CHAIN-1)', '0 at rollout', '0',
   'qnfo-lifecycle', 'trigger gt 0', '1h', '> 0', '> 0', 'UNMEASURED', 'computed'),
  ('adr014_legacy_byline_papers', 'operational', 'leading',
   'public papers first published before 2026-09-02 whose authors do not name Quni-Gudzinas (organisation bylines)',
   'living-paper.v_adr014_authorship_status.violations_legacy (qnfo-lifecycle PAPER-LEDGER-CHAIN-1)', '276 on 2026-11-05', 'observational; falls as papers are revised',
   'qnfo-lifecycle', 'exempt: observational count of papers that predate the ADR', '1h', 'n/a', 'n/a', 'UNMEASURED', 'computed');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
  ('paper_ledger_chain_breaks', 'structure', 'METRIC-CAUSE-AT-REGISTRATION-1: the paper ledger or its chain was changed outside the append-only path'),
  ('paper_ledger_unsealed_min', 'heartbeat', 'METRIC-CAUSE-AT-REGISTRATION-1: the qnfo-lifecycle hourly tick or its sealing step stopped'),
  ('adr014_new_publication_violations', 'publishing', 'METRIC-CAUSE-AT-REGISTRATION-1: a publish path wrote a byline that is not the individual author'),
  ('adr014_legacy_byline_papers', 'publishing', 'METRIC-CAUSE-AT-REGISTRATION-1: observational count of pre-ADR organisation bylines');

INSERT OR IGNORE INTO analytics_metric_triggers
  (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
VALUES
  ('paper_ledger_chain_breaks',
   'PAPER-LEDGER-CHAIN-1: the paper revision ledger does not match its hash chain or its anchor',
   'registry', 'gt', 0, 9,
   'Charter pillar: security. Read SELECT seq, kind, detail FROM v_paper_ledger_chain_breaks UNION ALL SELECT seq, kind, detail FROM v_paper_ledger_chain_body_breaks (living-paper), the open events SELECT id, text FROM cloud_ops_events WHERE id >= ''plc-break-'' AND id < ''plc-break.'' AND status = ''break'', and GET https://qnfo-lifecycle.q08.workers.dev/paper-ledger/chain?verify=1. Name which writer touched the row (the ledger keeps actor and reason; a dropped trigger shows in sqlite_master), restore the row from paper_change_bodies or the R2 copy, and record the finding. Do not edit or delete a chain row or a seal: they are append-only on purpose. Definition of done: paper_ledger_chain_breaks = 0 at the latest metric refresh.'
     || char(10) || 'code-task: repo=qnfo-workers path=qnfo-lifecycle/worker.js'
     || char(10) || 'code-anchor: async function paperLedgerChainTick(env, opts) {',
   'qnfo-lifecycle', 'agent_issues', 24, 1, 'RM-ADR-013-014-ENFORCEMENT-1'),
  ('paper_ledger_unsealed_min',
   'PAPER-LEDGER-CHAIN-1: paper ledger rows wait more than 120 minutes to be sealed',
   'registry', 'gt', 120, 7,
   'Charter pillar: security. The qnfo-lifecycle hourly tick seals new ledger rows; read SELECT * FROM v_paper_ledger_chain_status (living-paper) for the head, the unsealed rows and the minutes since the head was sealed, SELECT text FROM cloud_ops_events WHERE job = ''paper-ledger-chain'' ORDER BY ts DESC LIMIT 5 for the last run, and the qnfo-lifecycle fire log (cron_fire_log cron_name like ''qnfo-lifecycle%''). Causes: the hourly tick not firing, a thrown step before the sealing step, the chain trigger refusing a page (a gap or a repeated previous hash), or a missing binding. Definition of done: paper_ledger_unsealed_min <= 120 at the latest metric refresh.'
     || char(10) || 'code-task: repo=qnfo-workers path=qnfo-lifecycle/worker.js'
     || char(10) || 'code-anchor: async function paperLedgerChainTick(env, opts) {',
   'qnfo-lifecycle', 'agent_issues', 24, 1, 'RM-ADR-013-014-ENFORCEMENT-1'),
  ('adr014_new_publication_violations',
   'ADR-014: a paper published since the ADR does not name the individual author',
   'registry', 'gt', 0, 8,
   'Charter pillar: security. Read SELECT slug, status, authors, first_public_at FROM v_adr014_authorship_violations WHERE era = ''since-adr'' and SELECT slug, event, authors, actor FROM adr014_publish_audit ORDER BY id DESC LIMIT 20 (living-paper); the actor column names the writer. Fix the producer so it writes the owner (qnfo-research-exec sets AUTHOR), and correct the listed papers through the PAPER-LEDGER-1 path (set papers.change_actor and papers.change_reason in the same UPDATE of authors); never withdraw a paper for this. Definition of done: adr014_new_publication_violations = 0 at the latest metric refresh.'
     || char(10) || 'code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js'
     || char(10) || 'code-anchor: async function paperFormatTick(env, opts) {',
   'qnfo-research-exec', 'agent_issues', 24, 1, 'RM-ADR-013-014-ENFORCEMENT-1');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session-w2d2',
       'The two ADR texts cannot be read (both R2 objects hold failed-download stdout), so the rule enforced is the one the fleet already states in code and docs: the individual author, Rowan Brad Quni-Gudzinas, is named in authors; an organisation byline is not an author. ADR-014 is read as a check at publish (the roadmap row says authorship verification at publish), so the 276 legacy organisation bylines are listed and counted, not rewritten in place: a published version stays as published (ADR-013) and a legacy paper takes the owner byline when it is next revised.',
       'RM-ADR-013-014-ENFORCEMENT-1: add a sha256 hash chain over paper_change_ledger anchored in a second database, a verification (SQL views, hourly recomputation, an open status route), and a publish-time authorship check in observe mode with a one-statement switch to enforce; register the controls, failure modes, detectors and metrics.',
       'Read live 2026-11-05: ledger 3178 rows contiguous with append-only triggers only; 726 public papers, 276 organisation bylines first published 2025-01-01 to 2026-08-04, 0 among the 296 first published since 2026-09-01; R2 adr/ADR-013-LEGAL-IMMUTABILITY.md and adr/ADR-014-AUTHORSHIP-MANDATE.md are 310 bytes of wrangler stdout each; qnfo-research-exec AUTHOR constant names the owner.',
       'applied through the canonical path (living-paper migration, qnfo-audit migrations, qnfo-lifecycle 1.19.0); live reads are recorded in the status migration',
       'living-paper triggers on papers (observe mode writes only to adr014_publish_audit), paper_ledger_chain, qnfo-audit paper_ledger_seals, one hourly step in qnfo-lifecycle, four metric_registry rows',
       'DROP TRIGGER list in the header of migrations/living-paper/2026-11-05-w2d2-paper-ledger-chain.sql; UPDATE adr_enforcement SET mode = ''off'' stops the publish check at once; revert the qnfo-lifecycle deploy to stop sealing; chain, seal and audit rows stay as the record',
       'tamper-evident paper revision ledger with a cross-database anchor',
       'paper_ledger_chain_breaks stays 0 and paper_ledger_unsealed_min stays under 120 once the first catch-up has sealed the 3178 existing rows (about 7 hourly ticks at 500 rows a call); adr014_new_publication_violations stays 0; adr014_legacy_byline_papers reads 276 and falls only as papers are revised',
       'no external reach change',
       'node:sqlite suite with the real ledger migration and the real worker functions (58 cases); production replay of the publish rule over 1098 papers'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'RM-ADR-013-014-ENFORCEMENT-1: add a sha%');

INSERT OR IGNORE INTO human_actions (slug, title, why, default_in_effect, action, sev, status, source) VALUES ('adr-013-014-text-restore',
  'Restore the text of ADR-013 (legal immutability) and ADR-014 (authorship mandate): both R2 objects hold failed-download output',
  'IDENTITY-BOUND: the two ADRs are the owner''s own accepted decisions and only the owner holds their text; a session cannot re-author them without writing decisions in the owner''s name. Read live 2026-11-05: R2 bucket qnfo-audit, keys adr/ADR-013-LEGAL-IMMUTABILITY.md and adr/ADR-014-AUTHORSHIP-MANDATE.md (uploaded 2026-09-02T14:59Z) are 310 bytes each and read "Downloading ... from qnfo-assets. Download complete." (the stdout of a failed wrangler r2 object get written over the file). qnfo-audit.adr holds a different ADR-013 (WBS-keyed R2). The fleet enforces the rule its own code and docs state (the individual author is named; a published artifact is never changed without a trace), recorded in decision_log, and will compare that rule with the restored text.',
  'The enforcement stays on the rule recorded in decision_log (session-w2d2, RM-ADR-013-014-ENFORCEMENT-1); the publish check stays in observe mode until the text confirms or corrects it.',
  'Put the original files back: wrangler r2 object put qnfo-audit/adr/ADR-013-LEGAL-IMMUTABILITY.md --file <your copy> --remote (and the same for ADR-014-AUTHORSHIP-MANDATE.md), or tell the fleet where the originals are. It resolves when both objects are larger than 1000 bytes and no longer contain the word wrangler (ADR-TEXT-PROBE-1 reads them).',
  'medium', 'open', 'adr-enforcement');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ADR-TEXT-PROBE-1: owner-steps-watch resolves the ADR text card when both R2 objects hold a real document',
'Charter pillar: security. Serves RM-ADR-013-014-ENFORCEMENT-1 (roadmap_implementation 115). The owner card adr-013-014-text-restore waits on one step (the original ADR files put back into R2 bucket qnfo-audit, adr/). Nothing notices when it is done, so the card would stay open after the work (OWNER-NO-LOOSE-ENDS-1).

Change: add a probe with slug adr-013-014-text-restore to OWNER_STEP_PROBES in qnfo-cloud-ops and a branch in ownerStepVerdict: done when GET /accounts/<account>/r2/buckets/qnfo-audit/objects/adr/ADR-013-LEGAL-IMMUTABILITY.md and .../ADR-014-AUTHORSHIP-MANDATE.md (the Cloudflare API token cloud-ops already holds as CF_TOKEN) both answer 200 with more than 1000 bytes and a body that does not contain the word wrangler; the evidence names the byte counts, never the text. Add a case to the worker suite that feeds the 310-byte wrangler output (not done) and a 2 KB document (done).

Closing probe: code-probe below (the code state is the defect until the branch exists).

code-task: repo=qnfo-workers path=qnfo-cloud-ops/worker.js
code-anchor: async function jobOwnerStepsWatch(env) {
code-probe: {"paths": ["qnfo-cloud-ops/worker.js"], "contains": "adr-013-014-text-restore"}',
'session-w2d2', 'code', 'medium', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'ADR-TEXT-PROBE-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'PAPER-LEDGER-SIGN-1: sign the paper ledger seals (HMAC) once the signing key exists',
'Charter pillar: security. Serves RM-ADR-013-014-ENFORCEMENT-1 (roadmap_implementation 115). The chain and its anchor are tamper-evident but not signed: someone who can write both living-paper and qnfo-audit can still rebuild both. A signature with a key that is in neither database closes that.

Change in qnfo-lifecycle paperLedgerChainTick: when the Worker secret PROVENANCE_SIGNING_KEY (or LEDGER_SEAL_KEY) is present, sign "head_seq:head_hash" with it for each new paper_ledger_seals row (add a signature column to paper_ledger_seals by migration, nullable, append-only as before), verify the signature of the newest three seals in plcCheckAnchors, and include "signature" in the GET /paper-ledger/chain seals list. With no key the behaviour is unchanged. The key itself is the existing owner step bp26-provenance-signing-key (human_actions, IDENTITY-BOUND: writing a Worker secret was refused to a session on 2026-10-28); this issue builds everything else and does not mint or write a key.

Closing probe: runtime-probe below (the route lists a signature per seal once seals are signed).

runtime-probe: {"url": "https://qnfo-lifecycle.q08.workers.dev/paper-ledger/chain", "status": 200, "contains": "\"signature\""}
code-task: repo=qnfo-workers path=qnfo-lifecycle/worker.js
code-anchor: async function paperLedgerChainTick(env, opts) {',
'session-w2d2', 'code', 'medium', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'PAPER-LEDGER-SIGN-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ADR014-ENFORCE-PROMOTE-1: promote the ADR-014 publish check from observe to enforce when seven days are clean',
'Charter pillar: security. Serves RM-ADR-013-014-ENFORCEMENT-1 (roadmap_implementation 115). living-paper adr_enforcement rule adr014-publish-authorship ships in mode observe (decision_log, session-w2d2). Replay over production found 0 of the 296 papers first published since 2026-09-01 would be refused.

Change in qnfo-lifecycle paperLedgerChainTick: when the rule is in mode observe, set_at is seven or more days old, adr014_publish_audit has no row from the last seven days and v_adr014_authorship_status.violations_since_adr is 0, run UPDATE adr_enforcement SET mode = ''enforce'', set_at = now WHERE rule = ''adr014-publish-authorship'' AND mode = ''observe'' on living-paper and write one cloud_ops_events row (kind adr014-promote) naming the counts it read. The revert is the same statement with ''off''. A tick that finds an audit row leaves the rule in observe and names the writer (the actor column) in the event.

Closing probe: code-probe below (the code state is the defect until the promotion exists; the D1 state follows seven days later).

code-task: repo=qnfo-workers path=qnfo-lifecycle/worker.js
code-anchor: async function paperLedgerChainTick(env, opts) {
code-probe: {"paths": ["qnfo-lifecycle/worker.js"], "contains": "ADR014-ENFORCE-PROMOTE-1"}',
'session-w2d2', 'code', 'medium', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'ADR014-ENFORCE-PROMOTE-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ADR014-LEGACY-BYLINE-1: a legacy organisation-byline paper takes the owner byline when it is next revised',
'Charter pillar: security. Serves RM-ADR-013-014-ENFORCEMENT-1 (roadmap_implementation 115). Metric it moves: adr014_legacy_byline_papers (276 on 2026-11-05, observational). The list is SELECT slug, authors, first_public_at FROM v_adr014_authorship_violations WHERE era = ''legacy'' (living-paper).

Decision (decision_log, session-w2d2): a published version is not edited in place for its byline (ADR-013); the paper takes the owner byline when the pipeline next writes a new version of it, through the PAPER-LEDGER-1 path (papers.change_actor and papers.change_reason set in the same UPDATE, so the ledger keeps the old authors in meta_before). Revert: the ledger row names the previous authors.

Change in qnfo-research-exec paperFormatTick (the sweep that already rewrites stored papers and sets a per-paper change_reason): when it writes a paper whose authors do not name the owner, set authors to the AUTHOR constant in the same UPDATE and say so in change_reason; never change status. The file is under another session''s claim at the time of filing; the code loop takes it when the claim lapses.

Closing probe: code-probe below.

code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js
code-anchor: async function paperFormatTick(env, opts) {
code-probe: {"paths": ["qnfo-research-exec/worker.js"], "contains": "ADR014-LEGACY-BYLINE-1"}',
'session-w2d2', 'code', 'low', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'ADR014-LEGACY-BYLINE-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ADR013-ULA-PIN-1: pin the hash of each published QNFO-ULA version and alert when a published version changes',
'Charter pillar: security. Serves RM-ADR-013-014-ENFORCEMENT-1 (roadmap_implementation 115). ADR-013 as the docs quote it: each published version of the QNFO-ULA is immutable (docs/license/for-QNFO-license/README.md). The paper ledger now has a hash chain; the licence texts have only a size and corruption check (qnfo-lifecycle runUlaCheck: at least 64000 bytes, three corruption patterns).

Change in runUlaCheck: keep a table ula_version_pins in qnfo-audit (migration, append-only: version, url, sha256, first_seen, a BEFORE UPDATE/DELETE abort) holding the sha256 of the body served at legal.qnfo.org, qnfo.org/legal/license and qnfo.org/legal/license for the current version; a served body whose hash differs from the pinned hash of the same version is a finding (result.findings, verdict DEGRADED, a cloud_ops_events row kind ula-changed) and never overwrites the pin. A new version is a new pin.

Closing probe: code-probe below.

code-task: repo=qnfo-workers path=qnfo-lifecycle/worker.js
code-anchor: async function runUlaCheck(env) {
code-probe: {"paths": ["qnfo-lifecycle/worker.js"], "contains": "ula_version_pins"}',
'session-w2d2', 'code', 'low', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'ADR013-ULA-PIN-1:%');
