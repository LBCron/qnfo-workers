-- BP26-RETENTION-SWEEP-1 (2026-11-05, charter pillar security; roadmap_implementation row 1400, agent_issues 1000344, human_actions 189 bp26-retention-enforce): the TTL sweep of catalogue item 4.3,
-- built and dormant. scripts/retention_sweep.py (run by the table-sweep stage of scripts/continuity_snapshot.py in the remediation consumer's audits job) holds 19 compiled sweeps, one per
-- retention_policy row. It writes only the dry-run count into retention_policy.note until BOTH ops_config.retention_enforce = 'on' and the policy row says enforcement = 'enforce'; the switch
-- and the enforcement flag are the owner's answer to the open IDENTITY-BOUND card 189 (deleting mail-derived personal data is irreversible), so this file sets neither, touches no policy row and
-- leaves the card open. What it records:
--   1. ops_config.retention_enforce exists and reads 'off' (INSERT OR IGNORE: an existing value, including 'on', is never overwritten), so the card's closing probe has a row to read.
--   2. roadmap_implementation 1400 is 'partial' with the state of every clause of the catalogue item, read 2026-11-05.
--   3. The owner card gets one appended paragraph with a fact it did not have: the weekly R2 exports of qnfo-audit (five snapshots since 2026-10-13, emails.jsonl.gz 2.7 MB in the newest) have
--      no expiry rule, so a D1 sweep alone leaves every removed body in R2. The card stays open and its default (report only) stays in effect.
--   4. agent_issues BP26-RETENTION-EXPORTS-1 with a doer (code loop, scripts/cf_ops_actions.py) for the r2-lifecycle action that reads and, after the answer, sets the expiry.
--   5. decision_log: the sweep was built without being switched on, and why.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM ops_config WHERE key = 'retention_enforce' AND value = 'off'; UPDATE roadmap_implementation SET status = 'planned' WHERE id = 1400 AND status = 'partial'; UPDATE human_actions SET why = substr(why, 1, instr(why, ' BP26-RETENTION-SWEEP-1 (2026-11-05):') - 1) WHERE slug = 'bp26-retention-enforce' AND instr(why, ' BP26-RETENTION-SWEEP-1 (2026-11-05):') > 0; UPDATE agent_issues SET status = 'closed' WHERE status = 'open' AND title LIKE 'BP26-RETENTION-EXPORTS-1:%'; DELETE FROM decision_log WHERE actor = 'session-w2a' AND action LIKE 'BP26-RETENTION-SWEEP-1:%';

INSERT OR IGNORE INTO ops_config (key, value, note)
VALUES ('retention_enforce', 'off', 'BP26-RETENTION-SWEEP-1: scripts/retention_sweep.py blanks or deletes rows past each retention_policy period only while this reads on AND the policy row says enforce. The owner answers the card bp26-retention-enforce; until then every run is a dry run.');

UPDATE roadmap_implementation
SET status = 'partial',
    evidence = 'Read 2026-11-05, clause by clause of catalogue 4.3. Payload logging off for mail and no raw e-mail in logs: built and measured, pii_in_logs 0 (PR 7532 invocation_logs = false on four public workers; PR 7539 qnfo-email logs a stable token); the one remaining source, the qnfo-cloud-ops sendDigest recipient, is issue BP26-PII-LOGS-3 with a code-task. TTL sweeps: built, dormant. scripts/retention_sweep.py holds 19 compiled sweeps (blank or delete, batches of 100, floor of 7 days, refuses a registry row that differs from its spec, never deletes a suppressed or replied contact or an unsuppressed unsubscribe) and runs in the consumer audits job; with retention_enforce off it writes the exact would-blank count into retention_policy.note. records_past_retention reads 1004 (740 message bodies past 30 days, 53 raw messages, 105 quarantine bodies, 2 unconfirmed subscribers, 104 ipatent-db rows past 90 days) and stays an honest breach until the owner answers card 189 (open, IDENTITY-BOUND, default report-only in effect). Finding: the weekly R2 exports (export/qnfo-audit/20261013 to 20261104, five snapshots, emails.jsonl.gz in each, bucket lifecycle holds only the multipart-abort rule) are copies a D1 sweep does not reach: new exports blank the mail columns once the switch is on, the existing snapshots need the expiry of issue BP26-RETENTION-EXPORTS-1. Verified live after merge: the first dry-run note in retention_policy.',
    verified_at = NULL
WHERE id = 1400 AND status = 'planned';

UPDATE human_actions
SET why = why || ' BP26-RETENTION-SWEEP-1 (2026-11-05): the sweep is built and dormant (scripts/retention_sweep.py); its dry-run counts are in retention_policy.note, so this card quotes live numbers. Answering enforce is one migration (docs/RETENTION.md section 4), no build. One more fact for your answer: qnfo-backups holds five weekly full exports of qnfo-audit since 2026-10-13 (emails.jsonl.gz in each) with no expiry rule, so message bodies stay in those objects after a D1 sweep; new exports blank the mail columns once you answer enforce, and expiring the five existing snapshots is a separate irreversible deletion (issue BP26-RETENTION-EXPORTS-1) that applies nothing before your answer.',
    updated_at = datetime('now')
WHERE slug = 'bp26-retention-enforce' AND status = 'open' AND instr(why, ' BP26-RETENTION-SWEEP-1 (2026-11-05):') = 0;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'BP26-RETENTION-EXPORTS-1: cf-ops-actions r2-lifecycle reads the qnfo-backups lifecycle and, after the owner answers enforce, sets the expiry of the weekly exports',
'Charter pillar: security. Serves BP26-RETENTION-1 (agent_issues 1000344, roadmap row 1400, catalogue 4.3 TTL sweeps) and BP26-RETENTION-SWEEP-1.

Evidence read 2026-11-05 through the Cloudflare API: R2 bucket qnfo-backups has one lifecycle rule, Default Multipart Abort Rule (7 days); export/qnfo-audit/ holds five weekly snapshots (20261013, 20261020, 20261026, 20261101, 20261104), each with emails.jsonl.gz (2.7 MB in the newest) and email_raw_archive.jsonl.gz (1.6 MB); export/ipatent-db/ and export/q08-signal/ hold four each. Nothing expires, so the message bodies, raw messages and subscriber rows that scripts/retention_sweep.py removes from D1 stay in R2.

Change: scripts/cf_ops_actions.py gains the action r2-lifecycle BUCKET --model read|set (allowlist: qnfo-backups only). read prints the bucket lifecycle rules and writes nothing. set adds one rule, id retention-export-expiry, prefix export/, delete objects older than 35 days (30 days of Time Travel plus the weekly cadence), keeps the existing rules, reads the result back and prints the previous rules; it refuses unless ops_config.retention_enforce reads on (read through the D1 API in the same run) and reports ok false when the read-back does not show the rule. A suite in the style of scripts/cf_ops_gtg_test.py (picked up through a .test.mjs wrapper) covers: read writes nothing, set refused while the switch is off, set with the switch on keeps the multipart rule, a second set writes nothing, a rejected PUT reports ok false.

Not part of this issue and not done by it: the answer itself (human_actions 189, IDENTITY-BOUND). Expiring backups is irreversible, so set is dispatched by the fleet only after the owner answers enforce.

code-task: repo=qnfo-workers path=scripts/cf_ops_actions.py
code-anchor: def gtg_tag(zone_name: str, mode: str, token: str) -> int:
code-probe: {"paths": ["scripts/cf_ops_actions.py"], "contains": "r2-lifecycle"}',
'bp26-privacy', 'security', 'medium', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'BP26-RETENTION-EXPORTS-1:%');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session-w2a',
  'the rest of a row whose last step is IDENTITY-BOUND is still built (BRIEF category 4): the sweep ships, the switch and the policy flags stay with the owner because blanking or deleting mail-derived personal data cannot be undone',
  'BP26-RETENTION-SWEEP-1: scripts/retention_sweep.py built dormant behind ops_config.retention_enforce and retention_policy.enforcement; card 189 left open',
  'qnfo-audit retention_policy 19 rows all enforcement = report; records_past_retention 1004; human_actions 189 open; R2 qnfo-backups lifecycle read through the Cloudflare API: multipart-abort rule only, five weekly qnfo-audit exports with emails.jsonl.gz',
  'dry runs only until the owner answers; no value changed by this decision',
  'none until the switch is on; then up to 1000 rows per policy per run in the 19 tables of retention_policy',
  'set ops_config.retention_enforce to off (stops the sweep; a blanked or deleted value does not come back); revert the PR to remove the code',
  'the owner''s answer to card 189 becomes one migration instead of a build, and the card quotes exact would-blank counts',
  'records_past_retention stays 1004 until the answer, then falls to 0 within two heavy ticks of the last batch; retention_policy.note carries a dry-run count for all 19 policies after the next consumer run',
  0, 'retention_sweep selftest on sqlite stand-ins of the four databases; R2 lifecycle and export listing read live'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session-w2a' AND action LIKE 'BP26-RETENTION-SWEEP-1:%');
