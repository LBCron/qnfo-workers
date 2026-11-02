-- METRIC-LEVER-RESPONSE-VALIDATION-1 (2026-11-02, pillar autonomy; issue 1000391).
-- The lever-review workflow treated any nonempty agent output as a replacement lever. A read-only qnfo-audit
-- check found 63 recently reported responses without a code-task/anchor/edit or corrected-target/evidence pair;
-- request 1141 for issue 1000391 was only tool-step narration. Require actionable output, retry malformed answers,
-- and keep them off the issue description.
-- Prediction: malformed responses after this migration are never reported or used as a 3-day cooldown; valid
-- replacement levers remain reportable. The metric remains open until its existing convergence probe passes.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_metric_lever_validation
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261102_metric_lever_validation WHERE id = 'management-personas'), version = (SELECT version FROM bak_20261102_metric_lever_validation WHERE id = 'management-personas'), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = 'management-personas'; DELETE FROM remediation_contracts WHERE class = 'fm-metric-lever-nonactionable'; DELETE FROM failure_modes WHERE fm_key = 'metric-lever-nonactionable'; DELETE FROM capability_ledger WHERE capability = 'metric-lever-response-validation';

CREATE TABLE IF NOT EXISTS bak_20261102_metric_lever_validation AS
SELECT id, definition, version, (SELECT COALESCE(MAX(id), 0) FROM cf_agent_requests) AS request_watermark
FROM fleet_tasks
WHERE id = 'management-personas';

UPDATE fleet_tasks
SET definition = json_set(
  json_set(
    json_set(
      definition,
      '$.steps[' || (SELECT key FROM json_each(definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-request') || '].sql',
      replace(
        replace(
          (SELECT json_extract(value, '$.sql') FROM json_each(definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-request'),
          'COALESCE(r.result, '''') NOT LIKE ''(the model returned no text)%''',
          '((COALESCE(r.result, '''') LIKE ''%code-task: repo=qnfo-workers path=%'' AND COALESCE(r.result, '''') LIKE ''%code-anchor:%'' AND COALESCE(r.result, '''') LIKE ''%EDIT:%'') OR (COALESCE(r.result, '''') LIKE ''%CORRECTED TARGET:%'' AND COALESCE(r.result, '''') LIKE ''%EVIDENCE:%''))'
        ),
        'Answer in under 250 words: why the metric is not moving (the producer or root cause), and a different lever: a code-task line (repo=qnfo-workers path=<file>) with a code-anchor (verbatim text that occurs once in that file) and the exact edit, or a corrected target with the evidence that the current one is wrong.',
        'Return at most 250 words in exactly one form, with no tool-status text: ROOT CAUSE: <producer or cause>; code-task: repo=qnfo-workers path=<file>; code-anchor: <unique verbatim line>; EDIT: <exact change>. OR ROOT CAUSE: <cause>; CORRECTED TARGET: <operator and value>; EVIDENCE: <why the current target is wrong, from its formula or source>. A response without the required lever fields is not accepted and will be requested again.'
      )
    ),
    '$.steps[' || (SELECT key FROM json_each(definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-report') || '].sql',
    replace(
      (SELECT json_extract(value, '$.sql') FROM json_each(definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-report'),
      'COALESCE(r.result, '''') NOT LIKE ''(the model returned no text)%''',
      '((COALESCE(r.result, '''') LIKE ''%code-task: repo=qnfo-workers path=%'' AND COALESCE(r.result, '''') LIKE ''%code-anchor:%'' AND COALESCE(r.result, '''') LIKE ''%EDIT:%'') OR (COALESCE(r.result, '''') LIKE ''%CORRECTED TARGET:%'' AND COALESCE(r.result, '''') LIKE ''%EVIDENCE:%''))'
    )
  ),
  '$.steps[' || (SELECT key FROM json_each(definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-mark') || '].sql',
  replace(
    (SELECT json_extract(value, '$.sql') FROM json_each(definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-mark'),
    'COALESCE(r.result, r.error, '''') = ''''',
    'COALESCE(r.result, r.error, '''') = '''' OR NOT ((COALESCE(r.result, '''') LIKE ''%code-task: repo=qnfo-workers path=%'' AND COALESCE(r.result, '''') LIKE ''%code-anchor:%'' AND COALESCE(r.result, '''') LIKE ''%EDIT:%'') OR (COALESCE(r.result, '''') LIKE ''%CORRECTED TARGET:%'' AND COALESCE(r.result, '''') LIKE ''%EVIDENCE:%''))'
  )
),
version = version + 1,
updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas'
  AND EXISTS (SELECT 1 FROM json_each(definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-request')
  AND (
    instr((SELECT json_extract(value, '$.sql') FROM json_each(definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-request'), 'Answer in under 250 words:') > 0
    OR instr((SELECT json_extract(value, '$.sql') FROM json_each(definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-request'), 'COALESCE(r.result, '''') NOT LIKE ''(the model returned no text)%''') > 0
    OR instr((SELECT json_extract(value, '$.sql') FROM json_each(definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-report'), 'COALESCE(r.result, '''') NOT LIKE ''(the model returned no text)%''') > 0
    OR instr((SELECT json_extract(value, '$.sql') FROM json_each(definition, '$.steps') WHERE json_extract(value, '$.name') = 'lever-mark'), 'OR NOT ((COALESCE(r.result') = 0
  );

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES
  ('metric-lever-nonactionable', 'manager lever reviews mark non-actionable output as reported',
   'the management-personas workflow accepted any nonempty agent response as a replacement lever',
   'require a code-task with anchor and exact edit or a corrected target with evidence; retry other results',
   'fm-metric-lever-nonactionable', 'fm-metric-lever-nonactionable', '2026-11-02', 1000391,
   'a post-migration lever review without the required lever fields is marked reported',
   'tool-status narration suppresses another review for three days without changing the metric',
   'metric lever review, metric issue descriptions, and manager follow-up');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to)
VALUES
  ('fm-metric-lever-nonactionable', 1000391,
   'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM cf_agent_requests r JOIN persona_actions p ON p.from_value = r.instance WHERE r.id > COALESCE((SELECT request_watermark FROM bak_20261102_metric_lever_validation WHERE id = ''management-personas''), 0) AND p.kind = ''lever-review'' AND p.to_value = ''reported'' AND r.status IN (''done'', ''failed'', ''error'') AND NOT ((COALESCE(r.result, '''') LIKE ''%code-task: repo=qnfo-workers path=%'' AND COALESCE(r.result, '''') LIKE ''%code-anchor:%'' AND COALESCE(r.result, '''') LIKE ''%EDIT:%'') OR (COALESCE(r.result, '''') LIKE ''%CORRECTED TARGET:%'' AND COALESCE(r.result, '''') LIKE ''%EVIDENCE:%''))',
   'd1-query', 1000, 1, 'active',
   'management-personas has the structured lever review workflow and its request watermark is preserved',
   'do not report or cool down on a response without a complete replacement lever',
   'program-manager:QNFO.OPS');

INSERT OR IGNORE INTO capability_ledger
  (capability, provenance, prerequisites, reliability, acquired_at, evidence)
VALUES
  ('metric-lever-response-validation', 'migrations/2026-11-02-metric-lever-response-validation.sql',
   'management-personas workflow, cf_agent_requests, persona_actions',
   0.5, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
   'Only a code-task with a unique anchor and exact edit, or a corrected target with evidence, is reported as a replacement lever; other answers are retried.');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot:1000391',
  'a replacement lever must be an actionable code change or an evidence-backed target correction; generic tool-status narration is not a completed review',
  'METRIC-LEVER-RESPONSE-VALIDATION-1: validate manager lever output before reporting it or applying the three-day retry cooldown',
  'Read-only qnfo-audit 2026-11-02: 63 recent reported lever reviews lacked either the code-task/anchor/edit fields or the corrected-target/evidence fields; request 1141 for issue 1000391 returned only tool-step narration. metrics_worsening_7d was 50 now and 35 seven days ago.',
  'pending',
  'management-personas lever requests, issue descriptions, and follow-up retries',
  'restore fleet_tasks.management-personas from bak_20261102_metric_lever_validation and remove this migration''s detector and capability rows',
  'metric-lever-response-validation',
  'new non-actionable lever responses reported after apply: 0; malformed answers no longer suppress a retry; metrics_worsening_7d remains open until its existing convergence probe passes',
  'No external reach gain; improves autonomy through actionable, verifiable remediation.',
  'Read-only qnfo-audit request/action audit; migrations/management-personas-5.test.mjs; scripts/apply_migrations.py --check'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'METRIC-LEVER-RESPONSE-VALIDATION-1:%');
