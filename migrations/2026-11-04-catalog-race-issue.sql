-- CATALOG-RACE-1 (2026-11-04, charter pillar core; velocity). The generated docs inventory (docs/INDEX.md, docs/agent-catalog.json) turned main red three times in
-- one evening (ci-watchdog issues 7219, 7246; the `scans` check of PRs 7229 and 7239): every PR that adds a doc passes alone, because its `scans` step runs
-- `node scripts/build-agent-catalog.mjs --check` against the state of main at that moment; two such PRs merged close together leave main stale, the full sweep
-- (docs/agent-library.test.mjs) goes red, and every open PR then fails `scans` until someone regenerates by hand (PRs 7221, 7229, 7248 were exactly that).
-- Filed with a doer so the cause is fixed once.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM agent_issues WHERE title = 'CATALOG-RACE-1: a stale docs inventory on main must not fail unrelated pull requests' AND status = 'open';

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'CATALOG-RACE-1: a stale docs inventory on main must not fail unrelated pull requests',
'Charter pillar: core (velocity). Metric it should move: pull requests blocked by `scans` for a catalog they did not touch (3 PRs and 2 red full sweeps on 2026-11-04) and main-red minutes.

Evidence: ci-watchdog issues 7219 and 7246 (docs/agent-library.test.mjs red); PR 7229 and PR 7239 failed `scans` with "Stale documentation inventory: docs/INDEX.md, docs/agent-catalog.json"; hand regenerations in PRs 7221, 7229, 7248.

Change: make the PR-time check scoped. In scripts/build-agent-catalog.mjs add a mode (for example --check --changed <file-list>) that fails only when the catalog is stale for a document the pull request itself added, removed or changed (and for the entrypoint hashes), and prints a warning, not a failure, for drift the PR did not cause; pr-checks.yml `scans` uses it. The full `--check` stays strict on push to main (deploy-gate and docs/agent-library.test.mjs), and the post-merge path regenerates by a single writer (the existing fleet-bot pull request path, scripts/push_head.sh) instead of by every author. Regression test: a fixture with an unrelated stale entry passes the scoped check and fails the strict one.

code-task: repo=qnfo-workers path=scripts/build-agent-catalog.mjs
code-anchor: export function checkCatalog(root = ROOT) {
code-probe: {"paths": ["scripts/build-agent-catalog.mjs"], "contains": "--changed"}',
'catalog-race-1', 'reliability', 'high', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'CATALOG-RACE-1: a stale docs inventory on main must not fail unrelated pull requests');
