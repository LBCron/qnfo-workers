-- CLOSE-PROBE-CIRCULAR-1 regression (2026-11-07). Owner-facing effect: issues with deferral probes can now close when
-- their measuring contracts pass, without waiting for the deferral probe to pass.
--
-- WHY
-- migrations/2026-10-28-verification-deferred-7d-cluster-a.sql rewrote BACKFILL-1 contracts of open issues into probes
-- whose expected value is 'closed-with-evidence'. Such a probe can only pass AFTER the issue is closed. The D1 trigger
-- issue_close_evidence_required (CLOSE-BINDS-TO-PROBE-1) blocks closure while ANY contract of the issue has a failing
-- verdict (D1_ERROR: close-while-contract-fails, SQLITE_CONSTRAINT_TRIGGER). The two together are a deadlock: the
-- issue cannot close because the probe fails, and the probe cannot pass because the issue is not closed.
--
-- migrations/2026-10-19-close-probe-circularity.sql already addressed this class by retiring closure-observing probes
-- of the generic template. The 10-28 deferral migration reintroduced it by writing a different closure-observing probe
-- for a different purpose (verification deferral). A guard that blocks on a closure-observing probe must exclude that
-- probe class, otherwise CLOSE-PROBE-CIRCULAR-1 recurs on every deferral sweep.
--
-- MEASURED BEFORE (qnfo-audit, 2026-11-07 06:15Z)
--   102 contracts match instr(verify_probe,'closed-with-evidence')>0, one per issue. 38 of those issues are open.
--   circular-only-open = 0, so every affected issue also carries a real measuring contract - the deferral probe never
--   adds signal, it only gates.
--
-- LIVE INSTANCE FIXED TODAY: issue 100310 - deferral contract verdict=fail, sibling measuring contract verdict=pass
-- (2026-11-07 05:34:03, ci_gate_audit red gate merges 14d = 0, re-measured live by ops). Retired the deferral contract
-- (status='retired', 1 row) and closed 100310 with the measuring evidence (agent_issues.close_channel=auto:verified-
-- remediation-trigger).
--
-- WHAT THIS DOES
--   Replaces issue_close_evidence_required in place. The new trigger excludes deferral probes (those that check for
--   'closed-with-evidence') from the blocking set, so a closure may proceed when all MEASURING contracts pass, without
--   waiting for the deferral probe to pass. The deferral probe then passes on the next run after the close, as it was
--   designed to do.
--
-- WHAT THIS DOES NOT DO (stated so it is not read as complete)
--   The GENERATOR that writes deferral probes is unchanged. This migration only changes the guard so that the probes
--   it creates do not block. A future change may stop writing deferral probes entirely if they prove to add no signal;
--   that is a separate issue.
--
-- SAFETY
--   Replaces one trigger in place. The agent_issues trigger count stays at 23 (AGENT-ISSUES-TRIGGER-DEPTH-1). The
--   close-without-evidence check is unchanged, and the close-while-contract-fails check now reads: WHERE EXISTS (a
--   failing contract) AND NOT (all failing contracts are deferral probes). Re-running is a no-op: the trigger is
--   already replaced. The backup saves the old trigger definition from sqlite_master.
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261107_close_probe_circular_trigger
-- Rollback: Execute the CREATE TRIGGER statement from bak_20261107_close_probe_circular_trigger WHERE name='issue_close_evidence_required';
-- SPOF: issue_close_evidence_required trigger has no alternate path by design - single enforcement point for evidence-based closure. Redundancy is in the contracts that feed it (d1-query, runner-https, code-read transports). A failed trigger means issues close without evidence, detected by issue_wontfix_share_7d guard metric.
--
-- Verify after apply (also added as test in migrations/deferral-probes-not-blocking.test.mjs):
--   SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='issue_close_evidence_required';  -- 1
--   SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='agent_issues';                -- 23
--   Simulate: an issue with deferral-fail + measuring-pass should be closeable; measuring-fail should still be refused.

CREATE TABLE IF NOT EXISTS bak_20261107_close_probe_circular_trigger AS
SELECT type, name, tbl_name, sql
  FROM sqlite_master
 WHERE type = 'trigger' AND name = 'issue_close_evidence_required';

DROP TRIGGER IF EXISTS issue_close_evidence_required;

CREATE TRIGGER issue_close_evidence_required
BEFORE UPDATE OF status ON agent_issues
WHEN NEW.status IN ('closed','resolved','wontfix') AND OLD.status NOT IN ('closed','resolved','wontfix')
BEGIN
  -- unchanged: a closure must record what was observed
  SELECT RAISE(ABORT,'close-without-evidence')
    WHERE NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND t.close_evidence IS NOT NULL AND TRIM(t.close_evidence) <> '');

  -- new: exclude deferral probes (those checking 'closed-with-evidence') from blocking
  -- A claim that the defect is GONE must agree with the fleet's measuring probes, but deferral probes observe the
  -- effect (closure) rather than the remedy, so they cannot pass before the close they would block.
  SELECT RAISE(ABORT,'close-while-contract-fails')
    WHERE NEW.status IN ('closed','resolved')
      AND EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = NEW.id
                    AND c.status IN ('active','holding')
                    AND COALESCE(c.last_verdict,'') IN ('fail','vacuous-probe-result','probe-error','probe-not-machine-executable','probe-same-account-host')
                    -- exclude deferral probes from the blocking set (CLOSE-PROBE-CIRCULAR-1 regression fix 2026-11-07)
                    AND NOT (COALESCE(c.verify_probe,'') LIKE '%closed-with-evidence%'));
END;
