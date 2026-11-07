-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM failure_modes WHERE fm_key LIKE 'fm-branch-cleanup-%'; DELETE FROM metric_registry WHERE metric LIKE '%branches_unmerged%'; DROP TABLE IF EXISTS branch_deletion_audit;
-- BACKUP: failure_modes
-- CAUSE-MAPPED: All metrics are guards without breach triggers (metric-family-guard)

-- BRANCH-CLEANUP-FAILURE-MODES-1: Record failure modes from the careless branch cleanup incident
-- Root cause: Rushed execution without verification of merge status
-- Date: 2026-11-07
-- Incident: 4 branches with unmerged work were deleted; recovered from dangling commits

-- Failure mode 1: Deleting branches without checking merge status
INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen)
VALUES (
  'fm-branch-cleanup-no-merge-check',
  'Branch deleted without verifying merge status',
  'Script deleted branches based on naming patterns and open PR status only, without checking git log main..branch to verify all commits were merged',
  'Always run git log main..branch before deletion. If output is non-empty, branch has unmerged commits. Use scripts/safe_branch_cleanup.py which checks this. Add pre-deletion CI check.',
  'code: scripts/safe_branch_cleanup.py with merge check',
  'fm-branch-cleanup-no-merge-check',
  '2026-11-07 08:00:00'
) ON CONFLICT (fm_key) DO UPDATE SET
  remediation = EXCLUDED.remediation;

-- Failure mode 2: No dry-run mode for destructive operations
INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen)
VALUES (
  'fm-branch-cleanup-no-dry-run',
  'Destructive operation executed without dry-run verification',
  'Branch cleanup script had no --dry-run mode to preview what would be deleted before executing',
  'All destructive scripts must have --dry-run mode as default. Require explicit --live flag for actual deletion. Preview must show: branch name, last commit date, unmerged commit count, PR status.',
  'code: scripts/safe_branch_cleanup.py with --dry-run default',
  'fm-branch-cleanup-no-dry-run',
  '2026-11-07 08:00:00'
) ON CONFLICT (fm_key) DO UPDATE SET
  remediation = EXCLUDED.remediation;

-- Failure mode 3: No verification of dangling commits before claiming success
INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen)
VALUES (
  'fm-branch-cleanup-no-dangling-check',
  'Cleanup completed without checking for orphaned commits',
  'Script did not run git fsck --lost-found after deletion to verify no commits became dangling/unreachable',
  'After any branch deletion: (1) run git fsck --lost-found, (2) if dangling commits exist, examine with git show, (3) create recovery branches if work found, (4) document in cleanup report',
  'code: scripts/safe_branch_cleanup.py with fsck verification',
  'fm-branch-cleanup-no-dangling-check',
  '2026-11-07 08:00:00'
) ON CONFLICT (fm_key) DO UPDATE SET
  remediation = EXCLUDED.remediation;

-- Failure mode 4: Insufficient audit trail
INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen)
VALUES (
  'fm-branch-cleanup-no-audit-log',
  'Branch deletions not logged with sufficient detail for recovery',
  'Deletion script did not log: final commit SHA, last commit message, author, date, files changed. Recovery required git fsck archaeology.',
  'Before deleting branch, log to deletion_audit table: branch name, HEAD SHA, last commit message/author/date, unmerged commit count, reason for deletion. Enable recovery without fsck.',
  'd1-query: SELECT COUNT(*) FROM branch_deletion_audit',
  'fm-branch-cleanup-no-audit-log',
  '2026-11-07 08:00:00'
) ON CONFLICT (fm_key) DO UPDATE SET
  remediation = EXCLUDED.remediation;

-- Failure mode 5: No branch protection policy
INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen)
VALUES (
  'fm-branch-cleanup-no-protection-policy',
  'No documented policy for which branches are protected from cleanup',
  'Beyond "main" and open-PR branches, no clear policy existed for: recent branches, branches matching certain patterns, branches from specific authors',
  'Document branch protection policy: (1) all unmerged branches, (2) branches < 7 days old, (3) branches starting with recovery/, (4) branches in PROTECTED_BRANCH_PATTERNS list. Check policy before any deletion.',
  'code: scripts/safe_branch_cleanup.py with protection policy',
  'fm-branch-cleanup-no-protection-policy',
  '2026-11-07 08:00:00'
) ON CONFLICT (fm_key) DO UPDATE SET
  remediation = EXCLUDED.remediation;

-- Metric: Branches with unmerged commits that exist for >30 days
-- Note: metric_registry.metric is the key; there is no metric_name column
INSERT INTO metric_registry (
  metric,
  layer,
  kind,
  formula,
  source_of_truth,
  baseline,
  target,
  owner,
  disposition_actor,
  refresh_cadence,
  state,
  refresh_class
) VALUES (
  'branches_unmerged_over_30d',
  'repository',
  'guard',
  'COUNT of branches with commits not in main that are older than 30 days; checked via git log main..branch',
  'git log origin/main..origin/<branch> (daily workflow)',
  'new 2026-11-07',
  '<= 10',
  'scripts/safe_branch_cleanup.py',
  'fm-branch-cleanup-no-merge-check: scripts/safe_branch_cleanup.py with merge verification',
  'daily',
  'active',
  'daily'
) ON CONFLICT (metric) DO UPDATE SET
  formula = EXCLUDED.formula,
  target = EXCLUDED.target,
  disposition_actor = EXCLUDED.disposition_actor,
  state = EXCLUDED.state;

-- Remediation contracts for each failure mode
INSERT INTO remediation_contracts (
  class,
  verify_transport,
  verify_probe,
  expected_cadence_h,
  hit_action,
  description
) VALUES
(
  'fm-branch-cleanup-no-merge-check',
  'code-read',
  '{"paths": ["scripts/safe_branch_cleanup.py"], "contains": "def check_unmerged_commits"}',
  1,
  'code',
  'Verify safe_branch_cleanup.py exists and checks merge status'
),
(
  'fm-branch-cleanup-no-dry-run',
  'code-read',
  '{"paths": ["scripts/safe_branch_cleanup.py"], "contains": "dry_run: bool = True"}',
  1,
  'code',
  'Verify safe_branch_cleanup.py has dry-run mode'
),
(
  'fm-branch-cleanup-no-dangling-check',
  'code-read',
  '{"paths": ["scripts/safe_branch_cleanup.py"], "contains": "git fsck --lost-found"}',
  1,
  'code',
  'Verify safe_branch_cleanup.py checks for dangling commits'
)
ON CONFLICT (class) DO UPDATE SET
  verify_probe = EXCLUDED.verify_probe,
  description = EXCLUDED.description;

-- Create audit table for branch deletions
CREATE TABLE IF NOT EXISTS branch_deletion_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_name TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  last_commit_message TEXT,
  last_commit_author TEXT,
  last_commit_date TEXT,
  unmerged_commit_count INTEGER,
  deletion_reason TEXT,
  deleted_by TEXT,
  deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  recovery_branch TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_branch_deletion_audit_branch ON branch_deletion_audit(branch_name);
CREATE INDEX IF NOT EXISTS idx_branch_deletion_audit_date ON branch_deletion_audit(deleted_at);

-- Insert recovery log for the 4 recovered branches
INSERT INTO branch_deletion_audit (
  branch_name,
  head_sha,
  last_commit_message,
  last_commit_author,
  last_commit_date,
  unmerged_commit_count,
  deletion_reason,
  deleted_by,
  deleted_at,
  recovery_branch,
  notes
) VALUES
(
  'unknown-branch-1',
  '1503509158011ad28bbb1d06c4a8e429bb1dc930',
  'RM-31: review fixes for the living paper page',
  'Rowan Brad Quni-Gudzinas',
  '2026-11-05 05:31:23',
  1,
  'Mass cleanup without merge verification',
  'github-copilot-session',
  '2026-11-07 08:00:00',
  'recovery/rm-31-living-paper-fixes',
  'Recovered from dangling commits after careless cleanup'
),
(
  'unknown-branch-2',
  'ef044c676976c4323638d5e8c6feb26f871bf0df',
  'CHAOS-DRILL-CONTRACT-PROBE-1: chaos-drill issue contracts',
  'Rowan Brad Quni-Gudzinas',
  '2026-11-05 00:21:08',
  1,
  'Mass cleanup without merge verification',
  'github-copilot-session',
  '2026-11-07 08:00:00',
  'recovery/chaos-drill-contract-probe',
  'Recovered from dangling commits after careless cleanup'
),
(
  'unknown-branch-3',
  'b506b0c7a0fcbefed6e718eba03b418983e4eea8',
  'STATUS-ONLY-PR-1: apply-pending-patches fix',
  'Rowan Brad Quni-Gudzinas',
  '2026-11-05 00:39:04',
  1,
  'Mass cleanup without merge verification',
  'github-copilot-session',
  '2026-11-07 08:00:00',
  'recovery/status-only-pr-fix',
  'Recovered from dangling commits after careless cleanup'
),
(
  'unknown-branch-4',
  'b20c7878177d3159b43e227569d924316ca3305e',
  'RM-BS-HONEST-MEASURE-1: honest measure handoff',
  'Rowan Brad Quni-Gudzinas',
  '2026-11-05 07:02:49',
  1,
  'Mass cleanup without merge verification',
  'github-copilot-session',
  '2026-11-07 08:00:00',
  'recovery/honest-measure-handoff',
  'Recovered from dangling commits after careless cleanup'
);
