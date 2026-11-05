-- GITHUB-STEWARD-2 (#5530, charter pillar security; sweep cluster B-governance-code): the switch and the control record of qnfo-github-steward 0.16.0.
-- The steward now declares the default workflow token and workflow pull-request approval, secret scanning and push protection on public repositories, Actions and code scanning on
-- public forks, and the organisation website. ops_config steward_settings_enforce is off, dry or on. It is inserted as `dry`: the drift is computed hourly and reported on
-- GET https://qnfo-github-steward.q08.workers.dev/report (key settings) and nothing is written until the value is `on`. The control_registry row is the disposition record the
-- doctrine asks for with every new switch (critical path, tested alternate); the decision_log row carries the prediction.
-- The first `on` is a separate, recorded step: read the dry report, then UPDATE ops_config SET value = 'on' WHERE key = 'steward_settings_enforce' (revert: 'dry').
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM ops_config WHERE key = 'steward_settings_enforce'; DELETE FROM control_alternate_probes WHERE control = 'steward-settings-enforce' AND last_run_at IS NULL; DELETE FROM control_registry WHERE control = 'steward-settings-enforce'; DELETE FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'steward-declares-github-settings';
-- CAUSE-MAPPED: registers no metric_registry row.

INSERT OR IGNORE INTO ops_config (key, value, note) VALUES
  ('steward_settings_enforce', 'dry', 'GITHUB-STEWARD-2 (#5530): off = the steward reads no settings, dry = reads and reports drift on GET /report and writes nothing, on = writes the differences (default workflow token read, workflow PR approval false except QNFO/qnfo-workers, secret scanning + push protection on public repositories, Actions and code scanning off on public forks, organisation website when empty). Revert: dry.');

INSERT OR IGNORE INTO control_registry (control, location, kind, guards_against, critical_path, disposition, disposition_state, alternate_path, evidence)
VALUES ('steward-settings-enforce', 'ops_config steward_settings_enforce, read by qnfo-github-steward runReconcile (stewardSettingsModeRead)', 'kill-switch',
  'a settings write on a repository or the organisation that is wrong (a fork whose Actions are needed, a plan that refuses secret scanning, a workflow that needs a write token): the value dry computes and reports the same drift and writes nothing',
  0, 'keep', 'applied',
  'the value dry (the default) reports the drift without a write; GitHub''s own repository settings page is the manual alternate for any single repository; every refusal is recorded with its status and a trimmed text and never retried with another credential',
  'GITHUB-STEWARD-2: qnfo-github-steward/settings-reconcile.test.mjs (50 checks: diff per setting, qnfo-workers exception, forks, private and archived untouched, off/dry/on, convergence on a second run, 403 and 422, rate limit, read cap, org website); first run in dry mode reports counts on GET /report');

INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note, enabled) VALUES
 ('steward-settings-enforce',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM ops_config WHERE key = ''steward_settings_enforce'') = 0 THEN ''the ops_config row steward_settings_enforce is missing, so the steward falls back to dry but the off lever cannot be read'' WHEN (SELECT value FROM ops_config WHERE key = ''steward_settings_enforce'') NOT IN (''off'', ''dry'', ''on'') THEN ''ops_config steward_settings_enforce holds a value other than off, dry or on, and the steward reads anything else as dry'' ELSE ''ok'' END AS observed',
  'state probe, no window: the lever row and its value. The alternate is the value dry, which reports the same drift and writes nothing', 1);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:B-governance-code',
  'a reversible fleet decision takes the recommended option (DECISION-AUTOPROCEED-1): the steward declares the settings the 2026-10-30 fleet audit found undeclared, in dry mode first',
  'qnfo-github-steward 0.16.0 settings-reconcile, ops_config steward_settings_enforce = dry, control_registry row steward-settings-enforce',
  'docs/FLEET-AUDIT-2026-10-30.md section 4: no session could read these settings with a non-administrator credential; the steward credential can; secret scanning and push protection covered only qnfo-workers',
  'pending', 'public repositories of the QNFO organisation (about 45), forks (10), the organisation website; private repositories, archived repositories and rwnq8 are never touched',
  'set ops_config steward_settings_enforce to off or dry; re-enable Actions on a fork or turn secret scanning off in the repository settings if ever needed; nothing here deletes anything',
  'steward-declares-github-settings',
  'GET /report settings.drift lists the repositories off the declared state after the first dry run; after the value is set to on, the next run records fixed counts and the run after it records drift 0 for these settings (limitations excepted)',
  'none (security hygiene)', 'qnfo-github-steward/settings-reconcile.test.mjs (offline, fake GitHub); live read after deploy via GET /report'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'steward-declares-github-settings');
