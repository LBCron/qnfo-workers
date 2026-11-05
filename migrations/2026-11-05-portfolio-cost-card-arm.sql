-- PORTFOLIO-COST-CARD-1 follow-up (2026-11-05): arm the closing probe of the issue that migrations/2026-11-05-portfolio-cost-card-issue.sql filed.
-- Read live 2026-11-05 04:30Z: issue 1002064 was born with the generic contract issue-1002064 in status superseded (superseded:closure-observing-probe-at-birth) and no live closing path, because the
-- code-probe trigger agent_issues_code_probe_upd fires on an UPDATE of description (an INSERT leaves the generic contract; see memory relapse-hold-1, "an INSERT leaves the generic superseded contract").
-- This UPDATE rewrites only the whitespace of the code-probe JSON (the trigger fires when that segment differs), so the trigger installs the active code-read contract (module code-probe-line-v1) that the
-- consumer runs against main: it passes when the card INSERT is gone from qnfo-fleet-dashboard/worker.js.
-- Prediction: contract issue-1002064 is active with verify_transport code-read after the apply; the issue closes on its own once the dashboard change is on main.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET description = replace(description, '"paths":["qnfo-fleet-dashboard/worker.js"],"absent":', '"paths": ["qnfo-fleet-dashboard/worker.js"], "absent":') WHERE title LIKE 'PORTFOLIO-COST-CARD-1:%' AND status = 'open';
-- Closing probe: SELECT status FROM remediation_contracts WHERE class = 'issue-1002064'; -- active

UPDATE agent_issues
SET description = replace(description, '"paths": ["qnfo-fleet-dashboard/worker.js"], "absent":', '"paths":["qnfo-fleet-dashboard/worker.js"],"absent":'),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE title LIKE 'PORTFOLIO-COST-CARD-1:%' AND status = 'open'
  AND instr(description, '"paths": ["qnfo-fleet-dashboard/worker.js"], "absent":') > 0;
