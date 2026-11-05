-- GOV-TAIL-4 (2026-11-05, charter pillar core; slice B-governance-tail of the issue-backlog cluster). Follows GOV-TAIL-1..3 (#7331, #7384, #7418).
-- 1. Root cause of PORTFOLIO-WRITE-FAILED-1 (issues 1001804, 1001805, 1001806, filed by LOOP-WATCH-1, each on a superseded circular contract, so three orphans): every hourly portfolio
--    sync since 2026-11-04T16:05Z ends `partial` with `PUT HTTP 409 on main` for QNFO/qnfo-workers/docs/PORTFOLIO.md and the same 409 on master for the two QNFO/.github files
--    (portfolio_sync_runs 773-778). Run 772 and every run before it was ok. The repository ruleset `require-build` (id 26544275, required_status_checks on the default branch, bypass
--    only the repository admin role) was created 2026-11-04T16:47:22+01:00, i.e. 15:47Z, 18 minutes before the first failed run: the contents API answers a direct PUT to a branch with a
--    required status check with 409, and pfRetryPut (PORTFOLIO-PUT-RETRY-1) retries a 409 as a moved branch, which never clears. The daily charter commit (charterCommitOnce, 03:10Z, the same
--    PUT shape) meets the same rule at its next run. The fix is in qnfo-fleet-control (commit through a branch and one pull request, reused, never one per hourly run), a child issue with a
--    code-task line and a code-probe carries it; this file gives the three issues a live closing probe (the newest portfolio_sync_runs row is ok) and the cause.
-- 2. METRIC-CAUSE: two metrics registered after GOV-TAIL-1 breach with no metric_breach_cause row and keep issue 1000817 failing: human_wait_oldest_days (owner-routing, its twin
--    human_wait_oldest_min is mapped there) and observability_enabled_share (structure, a deployed-Workers settings share like workers_idle_7d). INSERT OR IGNORE keeps a mapping a session made.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET description=(SELECT b.description FROM bak_20261105_gov_tail4_issues b WHERE b.id=agent_issues.id) WHERE id IN (SELECT id FROM bak_20261105_gov_tail4_issues); UPDATE remediation_contracts SET verify_probe=(SELECT b.verify_probe FROM bak_20261105_gov_tail4_contracts b WHERE b.class=remediation_contracts.class), status=(SELECT b.status FROM bak_20261105_gov_tail4_contracts b WHERE b.class=remediation_contracts.class), last_verdict=(SELECT b.last_verdict FROM bak_20261105_gov_tail4_contracts b WHERE b.class=remediation_contracts.class), attempts=(SELECT b.attempts FROM bak_20261105_gov_tail4_contracts b WHERE b.class=remediation_contracts.class), next_due_at=(SELECT b.next_due_at FROM bak_20261105_gov_tail4_contracts b WHERE b.class=remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_gov_tail4_contracts); DELETE FROM metric_breach_cause WHERE note='GOV-TAIL-4';
-- The Rollback leaves the child issue and the decision_log row (append-only); close the child by its own probe.

CREATE TABLE IF NOT EXISTS bak_20261105_gov_tail4_issues AS
SELECT id, description FROM agent_issues WHERE id IN (1001804, 1001805, 1001806);

CREATE TABLE IF NOT EXISTS bak_20261105_gov_tail4_contracts AS
SELECT class, verify_probe, status, last_verdict, attempts, next_due_at FROM remediation_contracts WHERE class IN ('issue-1001804', 'issue-1001805', 'issue-1001806');

UPDATE agent_issues
SET description = description || char(10) || 'ROOT-CAUSE (GOV-TAIL-4 2026-11-05): the PUT 409 is a repository rule, not a moved branch. Ruleset require-build (id 26544275, required_status_checks on the default branch, bypass only the repository admin role) was created 2026-11-04T15:47Z; the first failed portfolio run is 16:05Z (portfolio_sync_runs 773) and every run before it was ok. pfRetryPut retries a 409 as a moved branch, which never clears. The charter commit (charterCommitOnce, 03:10Z daily) uses the same PUT and meets the rule next. Fix: commit through one reused branch and pull request in qnfo-fleet-control (child issue PORTFOLIO-WRITE-VIA-PR-1). The closing probe reads the newest portfolio_sync_runs row.',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id IN (1001804, 1001805, 1001806) AND status = 'open' AND instr(description, 'GOV-TAIL-4') = 0;

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN (SELECT status FROM portfolio_sync_runs ORDER BY id DESC LIMIT 1) = ''ok'' THEN ''ok'' '
  || 'ELSE ''the newest portfolio sync run is '' || COALESCE((SELECT status FROM portfolio_sync_runs ORDER BY id DESC LIMIT 1), ''missing'') || '': '' || COALESCE((SELECT substr(writes, 1, 160) FROM portfolio_sync_runs ORDER BY id DESC LIMIT 1), '''') END AS observed',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class IN ('issue-1001804', 'issue-1001805', 'issue-1001806') AND issue_id IN (1001804, 1001805, 1001806)
  AND instr(verify_probe, 'portfolio_sync_runs') = 0;

-- the producer-side fix has a doer: a code task on qnfo-fleet-control (CODE-LOOP-CONTROL-PLANE-1), source session* is a trusted origin
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'PORTFOLIO-WRITE-VIA-PR-1: direct commits of docs/PORTFOLIO.md, the QNFO/.github portfolio files and the charter block to the default branch are refused (409) since ruleset require-build',
  'Charter pillar: core. Root cause measured 2026-11-05 (GOV-TAIL-4): ruleset require-build (id 26544275, required_status_checks on the default branch, bypass only the repository admin role) was created 2026-11-04T15:47Z. The first failed portfolio sync is portfolio_sync_runs 773 at 16:05Z, every hourly run since ends partial with PUT HTTP 409 on all three targets (QNFO/qnfo-workers docs/PORTFOLIO.md on main, QNFO/.github PORTFOLIO.md and profile/README.md on master), and pfRetryPut retries the 409 as a moved branch, which never clears. charterCommitOnce (daily 03:10Z) uses the same direct PUT and will meet the same rule.'
  || char(10) || 'Change in qnfo-fleet-control only: when the PUT answers 409 and the message names a rule or required status check, write the file to one reused branch (for example fleet/portfolio-sync) and open or update ONE pull request into the default branch (title naming PORTFOLIO-LOOP-1, no check-skipping marker in the message, so the required checks run and the stale-PR lane merges it); never one pull request per hourly run, and none when the rendered content equals the base. Apply the same helper to charterCommitOnce. Keep PORTFOLIO-PUT-RETRY-1 for a genuine moved branch. Add a case to qnfo-fleet-control/put-retry-ledger.test.mjs with a stubbed 409 rule response. Mark the change with the string PORTFOLIO-WRITE-VIA-PR-1 in a comment so the probe can see it.'
  || char(10) || 'Closing: the newest portfolio_sync_runs row is ok (issues 1001804, 1001805 and 1001806 carry that probe).'
  || char(10) || 'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js'
  || char(10) || 'code-anchor: async function pfCommitOnce(env, repo, path, content, message, mode) {'
  || char(10) || 'code-probe: {"paths": ["qnfo-fleet-control/worker.js"], "contains": "PORTFOLIO-WRITE-VIA-PR-1"}',
  'session:breach-issues-B-governance-tail', 'reliability', 'high', 'open',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND instr(title, 'PORTFOLIO-WRITE-VIA-PR-1') = 1);

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
 ('human_wait_oldest_days', 'owner-routing', 'GOV-TAIL-4'),
 ('observability_enabled_share', 'structure', 'GOV-TAIL-4');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-issues-B-governance-tail',
  'a failure that starts minutes after a repository rule appears is that rule until shown otherwise, and a filer that retries a rule violation as a moved branch will never clear it',
  'GOV-TAIL-4: root cause of the hourly portfolio write failures recorded on its three issues with a live probe, child issue PORTFOLIO-WRITE-VIA-PR-1 filed with a code task and a code probe, two breach causes mapped',
  'ruleset require-build id 26544275 created 2026-11-04T15:47Z (GitHub rulesets API, required_status_checks on the default branch, bypass repository admin role); portfolio_sync_runs 773-778 partial with PUT HTTP 409 on main and master since 16:05Z, run 772 and earlier ok; charter_snapshots commit_sha last written 2026-11-04T03:10Z',
  'migration merged through the canonical path; no worker bundle changed, no ruleset touched',
  'three agent_issues descriptions and contracts, one new agent_issues row, two metric_breach_cause rows',
  'the Rollback header restores the three descriptions and contracts and removes the two cause rows; the child issue is closed by its own probe',
  'the three orphan portfolio issues get a live path and a named fix with a doer; the charter commit failure is caught before 03:10Z instead of after',
  'orphan_issues_no_live_path falls by 3; the child issue gets a code task from the planner within an hour; portfolio_sync_runs returns to ok once the change is deployed',
  'none',
  'offline suite migrations/gov-tail-4.test.mjs; live reads of the rulesets API, portfolio_sync_runs and the fleet-control source (pfCommitOnce occurs once)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'GOV-TAIL-4:%');
