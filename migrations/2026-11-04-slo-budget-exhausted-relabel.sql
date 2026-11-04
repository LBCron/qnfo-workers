-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE bp26_probe_results SET ok = (SELECT b.ok FROM bak_20261104_slo_budget_exhausted b WHERE b.id = bp26_probe_results.id), detail = (SELECT b.detail FROM bak_20261104_slo_budget_exhausted b WHERE b.id = bp26_probe_results.id) WHERE id IN (SELECT id FROM bak_20261104_slo_budget_exhausted)
-- SLO-PROBE-BUDGET-1 (2026-11-04, pillar core; issues 1000675 papers.qnfo.org, 1000676 qnfo.org, 1000677 qwav.org, 1000678 travel.q08.org and their SLO-POSTMORTEM-ACTION-1 reopen loop).
-- scripts/bp26_web.py recorded a host it never fetched as a failed availability sample. The BP26 producers share one wall-clock budget (BP26_BUDGET_S); when it is spent
-- Ctx.http answers Resp(0 ..., "budget-exhausted") without sending a request, and collect_web wrote ok = 0, detail "down: budget-exhausted", for every host fetched after the
-- cutoff. Read from qnfo-audit on 2026-11-04: 27 such rows in 3 runs (2026-10-31T00:54:09Z, 2026-11-04T18:11:33Z and one more); in the run of 18:11:33Z 13 of 14 surfaces
-- "failed" at once, which is the prober running out of time, not 13 hosts going down together. Each run opened an availability incident, a postmortem draft whose root cause
-- reads "unreachable: the probe could not complete a request", and an SLO-POSTMORTEM-ACTION-1 issue per surface. The code fix (bp26_web.py, same PR) records such a sample as
-- not sampled (ok NULL); slo_history() and bp26_slo.py already leave ok NULL out (ok IS NOT NULL), so this file gives the existing rows the same meaning: no observation.
-- Nothing is deleted: the 27 rows keep their id, run_at, metric and subject; ok becomes NULL and detail says what they were. The before-state is in
-- bak_20261104_slo_budget_exhausted (Rollback restores it). CAUSE-MAPPED: no metric is registered here.

CREATE TABLE IF NOT EXISTS bak_20261104_slo_budget_exhausted AS
  SELECT id, run_at, metric, subject, ok, detail, producer FROM bp26_probe_results
   WHERE metric = 'slo_attainment_28d_min' AND subject LIKE 'avail:%' AND detail = 'down: budget-exhausted';

UPDATE bp26_probe_results
   SET ok = NULL,
       detail = 'not sampled: budget-exhausted (relabelled SLO-PROBE-BUDGET-1; was down: budget-exhausted, the probe''s own time budget ran out before this host was fetched)'
 WHERE metric = 'slo_attainment_28d_min' AND subject LIKE 'avail:%' AND detail = 'down: budget-exhausted'
   AND id IN (SELECT id FROM bak_20261104_slo_budget_exhausted);
