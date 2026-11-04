-- SYSTEM-MAP-1 (2026-11-04, charter pillar core; also cost): two findings from the Vectorize audit behind docs/SYSTEM-MAP.md, each filed with a doer.
-- Evidence (Cloudflare API and GraphQL vectorizeV2QueriesAdaptiveGroups, read 2026-11-04): index qnfo-repos holds 24146 vectors, is bound to no worker, and
-- had 0 queries in the 7 days to 2026-11-04T20:00Z, while its only writer (scripts/repo_content_index.py, run by artifacts-canonical-sync.yml with --max-chunks 900,
-- Workers AI @cf/baai/bge-base-en-v1.5 over REST) was still writing at 2026-11-04T20:38Z. REST embeds bypass the fleet's ai_call_counters (bge is under 1k neurons a day there
-- against about 53k on the Cloudflare meter), so this writer is the leading suspect for the unattributed bge neurons. Nothing reads it.
-- The second finding: a scratch D1 drill-restore-qnfo-audit-state-20261104200902 (3.2 MB) was still alive an hour after its drill, although d1_restore_drill.py deletes its scratch.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM agent_issues WHERE title IN ('SYSTEM-MAP-1: stop embedding repository content into Vectorize qnfo-repos until a reader exists', 'SYSTEM-MAP-1: sweep stale drill-restore scratch D1 databases at drill start') AND status = 'open';

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'SYSTEM-MAP-1: stop embedding repository content into Vectorize qnfo-repos until a reader exists',
'Charter pillar: cost. Metric it should move: Workers AI bge-base neurons a day on the Cloudflare meter (about 53k) and the unattributed share of workers_ai spend.

Evidence: Vectorize index qnfo-repos has 24146 vectors (768-d), no worker binding, and 0 queries in 7 days (GraphQL vectorizeV2QueriesAdaptiveGroups); fleet-graph resource vz:qnfo-repos has no edges. Its only writer is scripts/repo_content_index.py (workflow artifacts-canonical-sync.yml step "Index repository content into D1 + Vectorize + graph", --max-repos 6 --max-chunks 900 per run), which embeds every new blob through the Workers AI REST API and upserts the vectors. Nothing queries them, so every neuron of that embedding is spent on an index nobody reads. The D1 file index and graph stats from the same script do have readers and stay.

Change (reversible, recommended default): in scripts/repo_content_index.py the embed and Vectorize upsert leg runs only when the environment variable REPO_VZ_EMBED is "on" (default off, logged once per run as embed_leg=off); the D1 file index (repo_file_index) and graph stats still run, and files indexed while the leg is off are marked so that turning it on later embeds them. Do not delete the index or its vectors (retirement is a separate decision after 14 days without a reader). Prediction: bge neurons on the meter fall from about 53k a day to under 5k within 48 h; verify with the Cloudflare GraphQL aiInferenceAdaptive by model and with GET /accounts/{id}/vectorize/v2/indexes/qnfo-repos/info (vectorCount stops growing).

code-task: repo=qnfo-workers path=scripts/repo_content_index.py
code-anchor:         pieces = chunk(text)[:12]
code-probe: {"paths": ["scripts/repo_content_index.py"], "contains": "REPO_VZ_EMBED"}',
'system-map-1', 'cost', 'high', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'SYSTEM-MAP-1: stop embedding repository content into Vectorize qnfo-repos until a reader exists');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'SYSTEM-MAP-1: sweep stale drill-restore scratch D1 databases at drill start',
'Charter pillar: core. The fleet graph (live scope) lists D1 databases drill-restore-qnfo-audit-state-20261104200902 (3.2 MB) and -20261104205749 (8 KB); the first was still alive an hour after its drill although scripts/d1_restore_drill.py documents that its scratch database is always deleted afterwards (the delete in cleanup() is caught and printed as scratch-delete-failed, and a killed runner never reaches it). A leaked scratch DB is a map and cost distraction and was counted as a real database (12 tables) in the first draft of docs/SYSTEM-MAP.md.

Change: at the start of each drill, list D1 databases whose name starts with drill-restore- and whose embedded timestamp is older than 60 minutes, and delete them (same Cloudflare call as cleanup(), name-prefix and age guarded, never any other database); print drill-restore-sweep with the names swept. Closing probe: no drill-restore- database older than 120 minutes in the live graph (fg_node scope live, kind d1).

code-task: repo=qnfo-workers path=scripts/d1_restore_drill.py
code-anchor:                     CS.cf("DELETE", "/accounts/%s/d1/database/%s" % (RC.ACCOUNT, uuid))
code-probe: {"paths": ["scripts/d1_restore_drill.py"], "contains": "drill-restore-sweep"}',
'system-map-1', 'reliability', 'medium', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'SYSTEM-MAP-1: sweep stale drill-restore scratch D1 databases at drill start');
