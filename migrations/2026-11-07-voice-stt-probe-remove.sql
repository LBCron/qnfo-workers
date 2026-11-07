-- Remove voice-stt liveness probe - worker does not exist (issue #8501)
-- The rt-live-voice-stt probe was added in RUNTIME-LIVENESS-GAP-1 (migrations/2026-10-26-runtime-liveness-gap.sql) for
-- "an unmanaged stub with no source here". The worker voice-stt.q08.workers.dev does not exist (error 1042) and has no
-- source directory in this repository. The probe fails with 404 and files RUNTIME-PROBE-FAIL-1 issue #8501 every hour.
-- Fix: supersede the probe. If voice-stt is deployed later, its deploy can restore the probe.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET status = 'active', next_due_at = datetime('now'), last_verdict = 'restored: rollback voice-stt-probe-remove' WHERE class = 'rt-live-voice-stt' AND module = 'runtime-liveness-v1'
-- BACKUP: none

UPDATE remediation_contracts
SET status = 'superseded',
    last_verdict = 'superseded: worker does not exist (error 1042), no source in qnfo-workers; probe files RUNTIME-PROBE-FAIL-1 hourly with no fix path'
WHERE class = 'rt-live-voice-stt'
  AND module = 'runtime-liveness-v1'
  AND status = 'active';
