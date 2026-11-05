-- MIRROR-ALL-WORK-1 (2026-11-05, pillar autonomy; owner instruction in the roadmap/backlog session: "make sure all roadmap/blue-sky items are recorded in github as
-- projects/issues for automatic future completion by any llm code agent").
--
-- ISSUE-CONSOLIDATE-1 (2026-10-26) took 120 free-text catalogue sources out of the GitHub issue mirror (they stayed on the Projects board and /roadmap). Measured
-- 2026-11-05: about 60 of their rows are unfinished work (status partial, not-built, built, enforced-*, open), so a code agent browsing GitHub Issues could not find them.
-- This puts back every source that still holds an unfinished row, EXCEPT the registries that already have a twin ticket or a verifier of their own:
-- projects (a GitHub milestone each), metric-breach (METRIC-TRIGGER twins), failure_modes (registry with detectors) and quniverse-fleet-lessons (a lessons ledger the
-- roadmap steward verifies from rm-<id> contracts). qnfo-github-steward mirrors the restored sources within its per-tick limit; the issue body carries the
-- definition of done (CODE-CHANGE-REQUIRED-1) and the Copilot assignment sweep applies as for every mirrored issue.
-- Revert: restore mirrored and reason from bak_20261105_roadmap_mirror_scope (the steward closes the re-excluded mirrors not_planned, 40 per tick).
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_roadmap_mirror_scope
-- Rollback: UPDATE roadmap_mirror_scope SET mirrored = (SELECT b.mirrored FROM bak_20261105_roadmap_mirror_scope b WHERE b.source = roadmap_mirror_scope.source), reason = (SELECT b.reason FROM bak_20261105_roadmap_mirror_scope b WHERE b.source = roadmap_mirror_scope.source) WHERE source IN (SELECT source FROM bak_20261105_roadmap_mirror_scope)

CREATE TABLE IF NOT EXISTS bak_20261105_roadmap_mirror_scope AS SELECT * FROM roadmap_mirror_scope;

UPDATE roadmap_mirror_scope
   SET mirrored = 1,
       reason = 'MIRROR-ALL-WORK-1 (owner 2026-11-05): holds unfinished work, so it is a GitHub issue again; was: ' || reason,
       decided_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
 WHERE mirrored = 0
   AND source IN (
     SELECT DISTINCT r.source
       FROM roadmap_implementation r
      WHERE r.status NOT IN ('verified', 'superseded', 'retired', 'enforced-verified', 'implemented', 'deployed')
        AND r.source NOT IN ('projects', 'metric-breach', 'failure_modes', 'agent_issues', 'goals')
        AND r.source NOT LIKE 'quniverse-fleet-lessons%');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, predicted_outcome)
VALUES ('session:roadmap-backlog-completion',
        'The owner wants every unfinished roadmap item as a GitHub issue that any code agent can pick up cold; the 2026-10-26 consolidation hid about 60 of them.',
        'roadmap_mirror_scope: mirrored 0 -> 1 for every source that still holds an unfinished roadmap row (registries with twin tickets excluded).',
        'Read 2026-11-05: 304 unfinished roadmap rows sit in non-mirrored sources, of which about 60 are work rows; 51 roadmap mirrors were open on GitHub.',
        'applied by migration',
        'GitHub issue count rises by about 60; the steward mirrors 40 per tick; Copilot assignment is bounded at 12 open PRs.',
        'Rollback line of migrations/2026-11-05-roadmap-mirror-all-work-1.sql (from bak_20261105_roadmap_mirror_scope).',
        'Open GitHub issues with a roadmap_implementation mirror body rise from about 51 to about 110 within 3 hours; no guard worsens.');
