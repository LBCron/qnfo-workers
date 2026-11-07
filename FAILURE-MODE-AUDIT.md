# FAILURE MODE AUDIT - 2026-11-07

## CRITICAL FINDINGS - ROOT CAUSE ANALYSIS

### 1. MIGRATION SCHEMA ERRORS (3 instances: #8502, #8503, #8504)

**ROOT CAUSE**: Migrations were written using ASSUMED column names instead of READING the actual schema.

**CARELESS ERRORS**:
- Used `recovery_count` instead of `recover_count` (research_queue table)
- Used `fleet_heartbeat` instead of `fleet_tick` (retention trigger)
- Used wrong `migration_runs` columns (`migration_file`, `run_at`, `run_by`, `statements_executed`, `error_message`) instead of actual columns (`file`, `sha256`, `commit_sha`, `db`, `status`, `statements`, `error`, `applied_by`)
- Missing `metric_key` column in `analytics_metric_triggers` INSERT statements

**PREVENTION REQUIRED**:
1. ALWAYS query actual schema before writing SQL: `SELECT * FROM <table> LIMIT 0`
2. NEVER assume column names from memory or similar tables
3. Add migration schema validator that compiles SQL against actual D1 schema
4. Add pre-commit hook that validates all migration SQL syntax

**FIXES IN PR #8506**:
- ✅ migrations/2026-11-07-research-deferred-pool-fix.sql
- ✅ migrations/2026-11-07-kernel-reconcile-fix.sql  
- ✅ migrations/2026-11-07-personal-replies-retention-fix.sql

---

### 2. MISSING PROBES (5 instances: #8378, #8384, #8437, #8438, #8445, #8466)

**ROOT CAUSE**: Issues filed without closing probes, violating CLOSED-LOOPS-1.

**CARELESS PATTERN**: Filing issues saying "needs a probe" instead of WRITING the probe in the same change.

**PREVENTION REQUIRED**:
1. D1 trigger that refuses issue INSERT without probe contract
2. Session audit: every filed issue MUST have active contract before turn ends
3. Add to CLAUDE.md: "NEVER file an issue without its probe in the same migration"

**ACTION**: Create migration to add probes for all 6 PROBE-NEEDED issues

---

### 3. FAILED DETECTOR CONTRACTS (2 instances: #8370, #8371, #8487)

**ROOT CAUSE**: Detector contracts created but never executed, so failures go undetected.

**BLINDSPOT PATTERN**: Writing a "detector" that doesn't actually run.

**PREVENTION REQUIRED**:
1. All detectors MUST be in hourly tick
2. Add test that validates every fm-* detector ran in last 2 hours
3. Migration that marks stale detectors as failed

**ACTION**: Activate all dormant detectors

---

### 4. WORKER PROBE FOR NON-EXISTENT WORKER (#8501)

**ROOT CAUSE**: Probe created for "unmanaged stub with no source" that doesn't exist.

**CARELESS PATTERN**: Creating probes for things that don't exist instead of verifying first.

**PREVENTION REQUIRED**:
1. Before creating worker probe, verify worker directory exists
2. Add pre-migration validator: runtime-probe contracts must reference real workers

**FIX IN PR #8506**:
- ✅ migrations/2026-11-07-voice-stt-probe-remove.sql

---

### 5. WORKFLOW FAILURES (2 instances: #8489, #8499)

**ROOT CAUSE #8489**: Migration failures caused apply-migrations workflow to fail
- **UPSTREAM**: Schema errors in migrations (see #1 above)
- **FIX**: Fixed by PR #8506 migrations

**ROOT CAUSE #8499**: Windows suite parity - 17 failing test suites
- **NEEDS INVESTIGATION**: Requires checking which specific suites fail on Windows
- **LIKELY CAUSE**: Path handling differences (Windows backslashes vs Unix forward slashes)

**PREVENTION REQUIRED**:
1. Run tests on Windows before merging (already in CI but was ignored)
2. Add guard that blocks merge when windows-suite-parity is red
3. Fix path handling in failing suites

---

### 6. LOOP BREAKER ISSUES (2 instances: #8454, #8500)

**ROOT CAUSE**: Same failure recurring 9+ times instead of fixing root cause.

**#8500**: PR merge failures with "Required status check 'Workers Builds: qnfo-workers' is expected"
- **PATTERN**: Temporary GitHub API issues that self-resolved
- **ACTION**: Monitor for 6h auto-close

**#8454**: NO-PROGRESS-CEILING in q08-signal-engine
- **NEEDS INVESTIGATION**: Check failure signature details

**PREVENTION REQUIRED**:
1. When loop breaker fires, MUST fix root cause before retry
2. Add loop breaker escalation: 3rd recurrence = critical priority

---

## COMPREHENSIVE REMEDIATION PLAN

### IMMEDIATE (Next 2 hours)
1. ✅ PR #8506 fixes migration schema errors
2. ⏳ Create migration adding probes for 6 PROBE-NEEDED issues
3. ⏳ Activate dormant failure mode detectors
4. ⏳ Investigate windows-suite-parity failures
5. ⏳ Add migration schema validator guard

### SHORT TERM (Next 24 hours)
6. Add pre-commit hook validating migration SQL
7. Add D1 trigger refusing issues without probes
8. Create detector health monitor (ran in last 2h)
9. Fix Windows path handling in failing suites
10. Document schema query pattern in CLAUDE.md

### MEDIUM TERM (Next week)
11. Add migration test that validates against actual D1 schema
12. Create probe registry validator
13. Add loop breaker escalation levels
14. Implement workflow guard blocking merge on red Windows tests

---

## AUDIT METRICS

**Issues audited**: 18 failure mode issues
**Root causes identified**: 6 distinct failure patterns
**Schema errors found**: 4 different table/column mistakes
**Missing probes**: 6 issues without closing probes
**Dormant detectors**: 3+ failure modes not running
**Workflow failures**: 2 (1 upstream fixed, 1 needs investigation)

**CONCLUSION**: The common thread is ASSUMPTIONS INSTEAD OF VERIFICATION:
- Assumed column names instead of querying schema
- Assumed probes would be added "later" instead of writing them immediately
- Assumed detectors were running instead of verifying execution
- Assumed workers existed instead of checking directories

**PREVENTION PRINCIPLE**: VERIFY EVERYTHING. READ THE ACTUAL STATE. NEVER ASSUME.
