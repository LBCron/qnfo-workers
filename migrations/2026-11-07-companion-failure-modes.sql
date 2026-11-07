-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM failure_modes WHERE key IN ('FM-COMPANION-NO-UI-VERIFICATION', 'FM-COMPANION-NO-RUNTIME-MONITORING', 'FM-COMPANION-NON-IDEMPOTENT-MIGRATION', 'FM-COMPANION-UNCLEAR-DOMAIN-SEPARATION', 'FM-COMPANION-INSUFFICIENT-SELF-AUDIT', 'FM-COMPANION-DELAYED-USER-FEEDBACK', 'FM-COMPANION-MIGRATION-PR-CLOSED', 'FM-COMPANION-WORK-CLAIM-NOT-RELEASED');

-- COMPANION-REGRESSION-FAILURE-MODES-1: Register 8 failure modes identified in comprehensive audit
-- of the Nov 4-7 companion UI regression incident (issue #8495).
--
-- Context: User reported "PERSONAL COMPANION REVERT BACK TO OLD SHITTY ONE" on Nov 7.
-- Root cause: PR #7009 (Nov 4) added fleetAsks() function showing fleet work items on personal companion.
-- Detection gap: 3 days (Nov 4-7).
--
-- This migration registers all 8 failure modes identified in the post-incident analysis,
-- each with root cause, remediation, and detection timestamp.

-- FM-1: No pre-merge UI verification
INSERT INTO failure_modes (key, root_cause, remediation, detected_at)
SELECT 
    'FM-COMPANION-NO-UI-VERIFICATION',
    'UX-JOURNEYS-1 missing for me.q08.org/companion - no automated pre-merge UI verification prevented detection of visual regression',
    'Added me.q08.org/companion to HOSTS array in scripts/ux-journeys/apps/public.journeys.mjs; created me-companion-regression-guard.journeys.mjs with specific checks for fleet content; filed issue #8512 for systemic UX journey coverage gaps',
    '2026-11-07 07:00:00'
WHERE NOT EXISTS (SELECT 1 FROM failure_modes WHERE key = 'FM-COMPANION-NO-UI-VERIFICATION');

-- FM-2: No runtime monitoring
INSERT INTO failure_modes (key, root_cause, remediation, detected_at)
SELECT 
    'FM-COMPANION-NO-RUNTIME-MONITORING',
    'No hourly runtime probe checking me.q08.org/companion for fleet content allowed 3-day detection gap',
    'Created migrations/2026-11-07-companion-regression-probes.sql with runtime probe checking every hour for absence of "For the Quniverse" text',
    '2026-11-07 07:00:00'
WHERE NOT EXISTS (SELECT 1 FROM failure_modes WHERE key = 'FM-COMPANION-NO-RUNTIME-MONITORING');

-- FM-3: Non-idempotent migration
INSERT INTO failure_modes (key, root_cause, remediation, detected_at)
SELECT 
    'FM-COMPANION-NON-IDEMPOTENT-MIGRATION',
    'Initial migration used INSERT VALUES without uniqueness guard, caught by review-gate',
    'Fixed to use INSERT SELECT with WHERE NOT EXISTS guards on all probe inserts; review-gate Medium severity finding prevented deployment',
    '2026-11-07 07:00:00'
WHERE NOT EXISTS (SELECT 1 FROM failure_modes WHERE key = 'FM-COMPANION-NON-IDEMPOTENT-MIGRATION');

-- FM-4: Unclear domain separation
INSERT INTO failure_modes (key, root_cause, remediation, detected_at)
SELECT 
    'FM-COMPANION-UNCLEAR-DOMAIN-SEPARATION',
    'DOMAIN-PLANE-1 policy (personal=q08.org, fleet=qnfo.org) exists but no code-level enforcement prevented fleet code in personal-api',
    'Created migrations/2026-11-07-domain-separation-personal-api.sql with code probe checking personal-api/worker.js has no "fleet" references; filed issue #8513 for systemic enforcement',
    '2026-11-07 07:00:00'
WHERE NOT EXISTS (SELECT 1 FROM failure_modes WHERE key = 'FM-COMPANION-UNCLEAR-DOMAIN-SEPARATION');

-- FM-5: Insufficient self-audit
INSERT INTO failure_modes (key, root_cause, remediation, detected_at)
SELECT 
    'FM-COMPANION-INSUFFICIENT-SELF-AUDIT',
    'PR #7009 self-audit did not include visual evidence or phone journey verification of UI changes',
    'Filed issue #8516 to strengthen self-audit gate requirements for UI changes (screenshots, journey passes); existing gate checks presence but not quality',
    '2026-11-07 07:00:00'
WHERE NOT EXISTS (SELECT 1 FROM failure_modes WHERE key = 'FM-COMPANION-INSUFFICIENT-SELF-AUDIT');

-- FM-6: Delayed user feedback loop
INSERT INTO failure_modes (key, root_cause, remediation, detected_at)
SELECT 
    'FM-COMPANION-DELAYED-USER-FEEDBACK',
    'Detection relied on owner manual testing 3 days post-deploy; no automated detection in deployment flow',
    'Runtime probes (FM-2 remediation) provide automated detection within 1 hour; UX journeys (FM-1 remediation) provide pre-merge detection',
    '2026-11-07 07:00:00'
WHERE NOT EXISTS (SELECT 1 FROM failure_modes WHERE key = 'FM-COMPANION-DELAYED-USER-FEEDBACK');

-- FM-7: Wrong response to review-gate finding
INSERT INTO failure_modes (key, root_cause, remediation, detected_at)
SELECT 
    'FM-COMPANION-MIGRATION-PR-CLOSED',
    'PR #8508 initially closed instead of fixed when review-gate identified non-idempotent migration',
    'Reopened PR #8508 with idempotent fix (INSERT SELECT + WHERE NOT EXISTS); correct response to review-gate finding is fix and push, not close',
    '2026-11-07 07:00:00'
WHERE NOT EXISTS (SELECT 1 FROM failure_modes WHERE key = 'FM-COMPANION-MIGRATION-PR-CLOSED');

-- FM-8: Work claim not released
INSERT INTO failure_modes (key, root_cause, remediation, detected_at)
SELECT 
    'FM-COMPANION-WORK-CLAIM-NOT-RELEASED',
    'Work claim not released when PR #8508 was closed; claim should be released on close even if PR not merged',
    'Work claim still active will expire after TTL; need to add explicit release on PR close to workflow or manual release; claim endpoint provides /work-lock/release',
    '2026-11-07 07:00:00'
WHERE NOT EXISTS (SELECT 1 FROM failure_modes WHERE key = 'FM-COMPANION-WORK-CLAIM-NOT-RELEASED');
