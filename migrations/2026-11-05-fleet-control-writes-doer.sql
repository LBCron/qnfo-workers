-- FLEET-CONTROL-WRITES-1 (2026-11-05, charter pillar autonomy; cluster D1-observability of the open-issue sweep).
-- GitHub 5764 (agent_issues 1000798), 5753 (agent_issues 1000772) and 5213 (its dispatch mirror).
--
-- WHAT WAS MEASURED (qnfo-audit SELECT only, 2026-11-05)
--   charter_snapshots ids 30 to 34 (the five newest daily snapshots) hold exactly 180000 characters with json_valid 0, and GET https://qnfo-fleet-control.q08.workers.dev/charter answers
--   source snapshot with snapshot.state null. The two earlier code-loop attempts on these groups (PR 6641 wrapped console.log, PR 6534 changed an advisor INSERT) did not touch the cause.
--   The ready, tested fix is on branch d1obs/fleet-control-unique-writes (commit c3271de9, qnfo-fleet-control 0.65.1 with snapshot-and-unique-writes.test.mjs, 23 checks that fail 8 on main).
--   It is not a pull request because file:qnfo-fleet-control/worker.js was claimed by other sessions continuously from 2026-11-05T00:54Z (c5-observe, breach-reach-journeys, B-governance-code
--   until 03:19Z); the doctrine's work claim says skip a file another session holds. This row hands it to the code loop, which queues behind the claim, with the branch as the reference patch.
--
-- WHAT THIS FILE DOES
--   Files one issue FLEET-CONTROL-WRITES-1 with the code-task / code-anchor / code-probe triple and the three changes in words. It closes itself when the code-probe
--   (qnfo-fleet-control/worker.js contains CHARTER-SNAPSHOT-VALID-1) passes, i.e. when the branch or an equivalent change has merged. The D1 contracts of 1000798 (json_valid of the newest
--   snapshot) and 1000772 (no exception for 7 days) stay the outcome probes.
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'FLEET-CONTROL-WRITES-1:%' AND source = 'session:D1-observability'
-- CAUSE-MAPPED: no metric is registered here.

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'FLEET-CONTROL-WRITES-1: charter snapshot stored cut at 180000 characters (GET /charter has state null), journey rename into the open-title index, advisor INSERT with an unmatched ON CONFLICT (GitHub 5764, 5753, 5213)',
 'QNFO.OPS; charter pillar autonomy. Three writes of qnfo-fleet-control/worker.js that the live schema or the data refuses, each measured on 2026-11-05. (1) charterTick stores JSON.stringify(ev).slice(0, 180000): the state is larger, so charter_snapshots ids 30 to 34 are cut at exactly 180000 characters (json_valid 0), charterLatest logs "Unterminated string in JSON at position 180000" (164 occurrences, Cloudflare group 2633d0f0, agent_issues 1000798) and GET /charter answers snapshot.state null. Fix: charterSnapshotJson(ev, max) returns JSON.stringify(ev) when it fits and otherwise halves the largest lists in turn (roadmap, metrics, objectives, shutdown, pillars, mvp) until it fits, names the cut in snapshot_trimmed, and falls back to a headline-only state; the INSERT binds charterSnapshotJson(ev). (2) jrnIssue renames the first open FLEET-JOURNEY-FAILED-1 issue of a journey to the title of the failure at hand; when another open issue of the journey already carries that title the UPDATE violates idx_agent_issues_open_title_ci (60 occurrences, group bddc26cc, agent_issues 1000772; loop-heartbeats had ids 1000918 and 1000928 open together 2026-10-31 11:00 to 19:16Z). Fix: SELECT an open twin with the new title first; if one exists update its description and updated_at and return; else rename as before. (3) The advisor audit INSERT INTO agent_issues ends in ON CONFLICT(title) DO UPDATE (PR 6534); both unique title indexes are partial (WHERE status = open), D1 answers ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint, and the empty catch hid it, so no advisor finding has been filed since. Fix: ON CONFLICT DO NOTHING (an ignored conflict stays counted by the existing if (ins.meta.changes === 0) refile_ignored++ else filed++, which advisor-spend.test.mjs W5 pins) and log the filing error with evt fleet-control:advisor:file. Reference patch: branch d1obs/fleet-control-unique-writes, commit c3271de9 (git cherry-pick it, re-bump the VERSION with python scripts/worker_release.py bump, copy the mirror). Regression test: qnfo-fleet-control/snapshot-and-unique-writes.test.mjs (reproduces the UNIQUE and the ON CONFLICT errors on a schema with both partial indexes). Guards: no probe is loosened; the snapshot keeps every field it kept before unless it would not fit.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) ||
 'code-anchor: ev.breaches.length, JSON.stringify(ev).slice(0, 180000), sha, commit.sha || null' || char(10) ||
 'code-probe: {"paths":["qnfo-fleet-control/worker.js"],"contains":"CHARTER-SNAPSHOT-VALID-1"}',
 'session:D1-observability', 'reliability', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'FLEET-CONTROL-WRITES-1:%' AND status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D1-observability',
  'a tested fix for a file other sessions hold in turn is handed to the owning loop with its reference patch rather than written over their claim or left as prose',
  'FLEET-CONTROL-WRITES-1: doer filed for the charter snapshot truncation, the journey rename and the advisor INSERT in qnfo-fleet-control, with branch d1obs/fleet-control-unique-writes as the reference patch',
  'work-locks 2026-11-05 00:54Z to 03:19Z: file:qnfo-fleet-control/worker.js held by c5-observe, breach-reach-journeys, B-governance-code in succession; charter_snapshots ids 30 to 34 json_valid 0; snapshot-and-unique-writes.test.mjs fails 8 checks on main and passes 23 on the branch',
  'migration merged; doer open',
  'one agent_issues row',
  'Rollback line of migrations/2026-11-05-fleet-control-writes-doer.sql',
  'the fix reaches main through the code loop or a session as soon as the claim frees',
  'GET /charter has a snapshot with a state again after the next 03:10Z tick that follows the deploy; issue-1000798 reads json_valid 1',
  'none',
  'live LIMITed D1 reads, offline suite on the branch'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'FLEET-CONTROL-WRITES-1:%');
