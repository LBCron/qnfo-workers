-- F1-C open-issue sweep, part 2 (2026-11-05, pillar autonomy; GitHub 5593; roadmap 1710 BP26-SLO-FRESHNESS-1).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_f1c_slo_roadmap
-- Rollback: UPDATE roadmap_implementation SET status = (SELECT b.status FROM bak_20261105_f1c_slo_roadmap b WHERE b.id = roadmap_implementation.id), evidence = (SELECT b.evidence FROM bak_20261105_f1c_slo_roadmap b WHERE b.id = roadmap_implementation.id), verified_at = (SELECT b.verified_at FROM bak_20261105_f1c_slo_roadmap b WHERE b.id = roadmap_implementation.id) WHERE id IN (SELECT id FROM bak_20261105_f1c_slo_roadmap); the slo_definitions rows added here are the ones whose surface ends in #latency or is q08.org#freshness; decision_log is append-only and keeps its rows.
-- CAUSE-MAPPED: no metric is registered here (slo_definitions rows are not metrics; the new SLIs ride on the existing metric slo_attainment_28d_min as evidence rows).

-- WHAT THIS DOES (#5593 / roadmap 1710). scripts/bp26_web.py now records lat:<host> (home page under 2 s) for the 13 public hosts and fresh:q08.org (a q08 piece in the 24 hours before
-- 09:00 Central European time, one sample a day) beside the availability rows; scripts/bp26_slo.py evaluates a definition by the subject its source names and lets only an availability
-- definition open incidents or enter the merge lane's slo_budget_spent flag. The definitions are registered here: until 24 samples (latency) or ten days (freshness) exist their state is
-- immature, and a spent latency or freshness budget changes nothing but the row in slo_budget_state. The roadmap row moves to built, not verified: it is verified when the collector has
-- written the rows (VERIFY-LIVE-1).

CREATE TABLE IF NOT EXISTS bak_20261105_f1c_slo_roadmap AS
  SELECT id, status, evidence, verified_at FROM roadmap_implementation WHERE id = 1710;

-- (4) the SLI definitions: latency of each public surface and the research desk's freshness
INSERT OR IGNORE INTO slo_definitions (surface, sli, objective, window_days, source, owner) VALUES
 ('ai.qnfo.org#latency', 'latency: home page answers in under 2 s', 0.95, 28, 'bp26_probe_results lat:ai.qnfo.org', 'program-manager:QNFO.OPS'),
 ('archive.qnfo.org#latency', 'latency: home page answers in under 2 s', 0.95, 28, 'bp26_probe_results lat:archive.qnfo.org', 'program-manager:QNFO.OPS'),
 ('ask.qwav.tech#latency', 'latency: home page answers in under 2 s', 0.95, 28, 'bp26_probe_results lat:ask.qwav.tech', 'program-manager:QNFO.OPS'),
 ('fleet.qnfo.org#latency', 'latency: home page answers in under 2 s', 0.95, 28, 'bp26_probe_results lat:fleet.qnfo.org', 'program-manager:QNFO.OPS'),
 ('ideas.qnfo.org#latency', 'latency: home page answers in under 2 s', 0.95, 28, 'bp26_probe_results lat:ideas.qnfo.org', 'program-manager:QNFO.OPS'),
 ('ipatent.qnfo.org#latency', 'latency: home page answers in under 2 s', 0.95, 28, 'bp26_probe_results lat:ipatent.qnfo.org', 'program-manager:QNFO.OPS'),
 ('me.q08.org#latency', 'latency: home page answers in under 2 s', 0.95, 28, 'bp26_probe_results lat:me.q08.org', 'program-manager:QNFO.OPS'),
 ('papers.qnfo.org#latency', 'latency: home page answers in under 2 s', 0.95, 28, 'bp26_probe_results lat:papers.qnfo.org', 'program-manager:QNFO.OPS'),
 ('q08.org#latency', 'latency: home page answers in under 2 s', 0.95, 28, 'bp26_probe_results lat:q08.org', 'program-manager:QNFO.OPS'),
 ('qnfo.org#latency', 'latency: home page answers in under 2 s', 0.95, 28, 'bp26_probe_results lat:qnfo.org', 'program-manager:QNFO.OPS'),
 ('qwav.org#latency', 'latency: home page answers in under 2 s', 0.95, 28, 'bp26_probe_results lat:qwav.org', 'program-manager:QNFO.OPS'),
 ('reading.q08.org#latency', 'latency: home page answers in under 2 s', 0.95, 28, 'bp26_probe_results lat:reading.q08.org', 'program-manager:QNFO.OPS'),
 ('travel.q08.org#latency', 'latency: home page answers in under 2 s', 0.95, 28, 'bp26_probe_results lat:travel.q08.org', 'program-manager:QNFO.OPS'),
 ('q08.org#freshness', 'freshness: a q08 piece was published in the 24 hours before 09:00 Central European time', 0.9, 28, 'bp26_probe_results fresh:q08.org', 'program-manager:QNFO.OPS');


UPDATE roadmap_implementation
SET status = 'built',
    evidence = 'F1-C 2026-11-05: scripts/bp26_web.py records lat:<host> for the 13 public hosts and fresh:q08.org (one sample a day, read from q08-signal) beside avail:<host>; scripts/bp26_slo.py evaluates a definition by the subject its source names and keeps incidents and the merge-lane flag to availability; 14 definitions registered by migrations/2026-11-05-f1c-q08-reach-sweep.sql. Verified live when bp26_probe_results holds lat: rows for all 13 hosts and one fresh:q08.org row per day and slo_budget_state lists the 14 surfaces. Samples needed before a state other than immature: 24 (latency), 10 days (freshness).'
WHERE id = 1710 AND status = 'planned';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:F1-research-reach/C',
 'an SLO needs recorded history before it needs a gate, so latency and freshness are recorded and shown first and kept out of incidents and the merge lane flag',
 'BP26-SLO-FRESHNESS-1: lat:<host> and fresh:q08.org rows in scripts/bp26_web.py, definitions evaluated by their source subject in scripts/bp26_slo.py, 14 slo_definitions rows',
 'slo_definitions read 2026-11-05: 12 availability rows, no latency or freshness; docs/SLO-ERROR-BUDGETS.md said nothing records them; home page timings from the runner side 2026-11-05: 0.25 to 2.45 s (papers.qnfo.org slowest); bp26_web.py and bp26_slo.py selftests pass with the new cases',
 'PR open; live verification pending the next collect_web run on main',
 'two BP26 runner scripts, 14 slo_definitions rows, slo_budget_state rows for them; incidents, postmortems and ops_config slo_budget_spent are unchanged by construction (tested)',
 'revert the PR; the Rollback header restores the roadmap row; delete the 14 definition rows',
 'every public surface and the q08 research desk have a recorded latency and freshness history that slo_definitions can hold',
 'after the next collect_web run on main: bp26_probe_results holds lat: rows for 13 hosts and, after 09:00 Central European time, one fresh:q08.org row per day; slo_budget_state lists 14 more surfaces, all immature for the first days',
 'none directly; the figures make the q08 desk''s silence visible as a number',
 'bp26_web.py --selftest, bp26_slo.py --selftest, migrations/f1c-q08-reach-sweep.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'BP26-SLO-FRESHNESS-1: lat:<host>%');
