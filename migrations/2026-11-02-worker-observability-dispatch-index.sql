-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP INDEX IF EXISTS idx_fleet_issue_dispatch_category_state

CREATE INDEX IF NOT EXISTS idx_fleet_issue_dispatch_category_state
  ON fleet_issue_dispatch (category, state);
