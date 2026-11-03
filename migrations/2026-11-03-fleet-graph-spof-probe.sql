-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM spof_alternate_probes WHERE component = 'fleet-graph build' AND window_note = 'FLEET-GRAPH-SPOF-PROBE-1: a successful cadence dispatch is followed by a successful graph build'
-- FLEET-GRAPH-SPOF-PROBE-1 (issue 1000613, charter pillar autonomy): the registered graph alternate had no chaos probe, leaving the SPOF metric unchanged despite successful cadence dispatches. Require an accepted repository_dispatch and a subsequent successful build; the existing six-hour chaos drill stamps the register only when both events are present.
INSERT OR IGNORE INTO spof_alternate_probes (component, probe_sql, exercise, window_note, enabled)
VALUES (
  'fleet-graph build',
  'SELECT ''ok'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM cloud_ops_events AS cadence WHERE cadence.kind = ''fleet-graph-cadence'' AND cadence.status = ''ok'' AND instr(cadence.text, ''HTTP 204'') > 0 AND julianday(cadence.ts) > julianday(''now'', ''-7 days'') AND EXISTS (SELECT 1 FROM cloud_ops_events AS build WHERE build.kind = ''fleet-graph'' AND build.status = ''ok'' AND julianday(build.ts) BETWEEN julianday(cadence.ts) AND julianday(cadence.ts, ''+15 minutes''))) THEN ''ok'' ELSE ''no successful cadence dispatch followed by a graph build within 15 minutes in 7 days'' END AS observed',
  NULL,
  'FLEET-GRAPH-SPOF-PROBE-1: a successful cadence dispatch is followed by a successful graph build',
  1
);
