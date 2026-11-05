-- C6-S2 (cluster C6-COST-INFRA-SECURITY, charter pillars security, cost, core; roadmap_implementation rows 51, 52, 54, 55, 118, 119), read and built 2026-11-05.
-- Row 52 BUILT+VERIFIED: cf-ops-actions edge-rules (PR 7332, 7431) wrote one Free-plan rate-limiting rule on each of qnfo.org, q08.org and qwav.tech and a scanner-path rule on qnfo.org; burst and scanner reads are in the evidence text.
-- Row 55 BUILT+VERIFIED in a better form than a Tail Worker: ERROR-DETAIL-CAPTURE-1 already copies every Workers Logs error event into worker_logs; the one worker below full sampling (q08-mind) was raised by cf-ops-actions obs-sampling (run 41944054759).
-- Row 51 PARTIAL (inventory built, root cause of the empty Secrets Store found, next slices filed), row 54 IDENTITY-BOUND card, row 119 PARTIAL (what shipped, two missing slices filed), row 118 not built here (the qnfo-gateway claim; filed with its finished code).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET status = CASE WHEN id = 54 THEN 'owner-decision' ELSE 'not-built' END, evidence = substr(evidence, 1, instr(evidence, ' | C6-S2 ') - 1) WHERE id IN (51, 52, 54, 55, 118, 119) AND instr(evidence, ' | C6-S2 ') > 0; DELETE FROM remediation_contracts WHERE class IN ('rm-52', 'rm-55') AND module = 'roadmap-dod-v1'; DELETE FROM human_actions WHERE slug = 'deepchat-db-encryption-1'; DELETE FROM agent_issues WHERE source = 'session:c6-s2' AND status = 'open'; DELETE FROM decision_log WHERE actor = 'session:c6-s2'
-- CAUSE-MAPPED: registers no metric_registry row; it edits roadmap rows, adds two roadmap-dod-v1 contracts, one owner card, decision_log rows and six issues.

-- ROW 52: edge rules, built and read live.
UPDATE roadmap_implementation
SET status = 'built',
    evidence = COALESCE(evidence, '') || ' | C6-S2 2026-11-05 BUILT+VERIFIED. All 12 zones are Free (one rate-limiting rule and five custom rules each), so the rules are the fleet''s whole allowance on the three zones with public write routes. scripts/cf_ops_actions.py edge-rules (PR 7332, 7431; offline suite scripts/cf_ops_edge_rules_test.py, 57 checks) wrote with the repository token, which the session connector cannot do (7500): qnfo.org http_ratelimit 20 POSTs per 10 s per address and data centre on ideas.qnfo.org, ipatent.qnfo.org, fleet.qnfo.org /api/cmd/ and qnfo.org /email/, plus an http_request_firewall_custom block of /.env, /.git/, /wp-admin, /wp-login, /phpmyadmin and xmlrpc.php; q08.org 10 per 10 s on /subscribe and /travel/login; qwav.tech 15 per 10 s on ask.qwav.tech /api/*. Read live: 30 POSTs in 1.8 s to ask.qwav.tech/api/feedback gave 19 x 400 and 11 x 429, 25 to q08.org/subscribe 12 x 400 and 13 x 429, 40 to ideas.qnfo.org/api/subscribe 21 x 400 and 19 x 429, one POST 12 s later 400 again; papers.qnfo.org/.env and /wp-login.php 403, /robots.txt and /.well-known/security.txt 200 (run 41943363642). Refused on the Free plan, verbatim: not entitled: the use of field http.request.headers.names is not allowed, an higher Advanced Rate Limiting plan is required (run 41942246628), so ops.qnfo.org and ai.qnfo.org (keyed routes, CI runners call in bursts) are left to their keys. Revert: cf-ops-actions edge-rules --model revert. Not covered: qnfo-containers-pilot answers on workers.dev, which no zone rule reaches (SEC-CONTAINERS-PILOT-SHELL-STATIC-TOKEN-1 stays with its own issue).'
WHERE id = 52 AND item = 'RM-WAF-RATE-LIMIT-1' AND status = 'not-built';

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
SELECT 'rm-52', NULL, 'ROADMAP-BUILT-VERIFY-1: roadmap item RM-WAF-RATE-LIMIT-1 (id 52) is built, deployed or implemented and waits for its closing probe',
 'RM-WAF-RATE-LIMIT-1: the qnfo.org zone rule set written by cf-ops-actions edge-rules answers the scanner path /.env from the edge (403 with the Cloudflare block page, 404 from the Worker before); the three rate-limiting rules were read live by a 30 to 40 POST burst per zone on 2026-11-05 (429 for the part above the limit)',
 '{"url": "https://papers.qnfo.org/.env", "status": 403, "contains": "Attention Required"}', 'runner-https', 48, 'qnfo-github-steward', 1, 'active', 'roadmap-dod-v1', datetime('now')
FROM roadmap_implementation WHERE id = 52 AND item = 'RM-WAF-RATE-LIMIT-1' AND status IN ('built', 'deployed', 'implemented');

-- ROW 55: unsampled exception capture is live fleet-wide; no Tail Worker is needed.
UPDATE roadmap_implementation
SET status = 'built',
    evidence = COALESCE(evidence, '') || ' | C6-S2 2026-11-05 BUILT+VERIFIED by a cheaper mechanism than a Tail Worker. qnfo-ops ERROR-DETAIL-CAPTURE-1 (2.38.40) copies every error event Workers Logs holds into worker_logs every 30 minutes, and Workers Logs sampled at 1 on 38 of 39 workers: worker_logs held 398 exception rows from 18 workers in one hour (last ingested 2026-11-04T23:02Z) and 1,046 rows in 3 hours. A tail_consumers worker would bill one invocation per batch of events for the same data, and no worker has one (0 of 39 scripts list tail_consumers or a tail handler). The one gap, q08-mind at 0.1, was raised to 1 with cf-ops-actions obs-sampling (run 41944054759, patch 200, before/after read back; traces block unchanged); q08-mind is wrangler-only (the canonical path skips its directory), so its wrangler.toml must say the same or the next wrangler deploy reverts it: filed as OBS-SAMPLING-2. Cap: ERROR-DETAIL-CAPTURE-1 keeps at most 200 events per 35-minute window, so a worker that throws more than that in one window is still truncated; the per-window count is in cloud_ops_events error-capture-tick.'
WHERE id = 55 AND item = 'RM-TAIL-WORKERS-1' AND status = 'not-built';

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
SELECT 'rm-55', NULL, 'ROADMAP-BUILT-VERIFY-1: roadmap item RM-TAIL-WORKERS-1 (id 55) is built, deployed or implemented and waits for its closing probe',
 'RM-TAIL-WORKERS-1: unsampled exception capture across the fleet through ERROR-DETAIL-CAPTURE-1; worker_logs held telemetry error rows from 18 workers in one hour and 1,046 rows in 3 hours on 2026-11-05, and 39 of 39 workers log at sampling 1 after obs-sampling run 41944054759',
 'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(DISTINCT script_name) FROM worker_logs WHERE ts_ms > (strftime(''%s'', ''now'') - 10800) * 1000 AND event_type LIKE ''telemetry:%'') >= 5 THEN ''ok'' ELSE ''worker_logs holds telemetry error rows from fewer than 5 workers in 3 hours'' END AS observed',
 'd1-query', 48, 'qnfo-github-steward', 1, 'active', 'roadmap-dod-v1', datetime('now')
FROM roadmap_implementation WHERE id = 55 AND item = 'RM-TAIL-WORKERS-1' AND status IN ('built', 'deployed', 'implemented');

-- ROW 51: Secrets Store. The inventory and the root cause are built; the install path and the first fleet-minted credential are filed with doers.
UPDATE roadmap_implementation
SET status = 'partial',
    evidence = COALESCE(evidence, '') || ' | C6-S2 2026-11-05 PARTIAL. Built: cf-ops-actions secrets-inventory (PR 7332), read-only, names/ages/store bindings only, no value, id or comment in the public log. Read live (run 41934447956): 39 workers, 28 hold secrets, 112 secret bindings, 70 distinct names, 12 names on 3 or more workers (CF_API_TOKEN 6, GITHUB_TOKEN 5, CF_TOKEN 5, EMAIL_API_KEY, INTENT_TOKEN, REGISTRY_TOKEN and DEEPSEEK_API_KEY 3 to 4); Secrets Store default_secrets_store (created 2026-05-27) holds 30 entries, 25 older than 90 days (last change 2026-07-04 to 2026-10-14) and ZERO live bindings. Root cause: qnfo-infra/wrangler.toml declares [[secrets_store_secrets]] CF_TOKEN_STORE -> CF_API_TOKEN and infraSecret() prefers the store, but qnfo-ops installDeclaredBindings has no secrets_store_secrets case, so the binding never reached the live worker (live types: ai, d1, secret_text, vectorize); the inventory now reports it as declared_not_live. Not switched on blind: the store entry CF_API_TOKEN was last modified 2026-07-04, its value cannot be read, and binding it before a refresh would move qnfo-infra to a possibly rotated-out token. Filed with doers: SECRETS-STORE-BIND-1 (installer case behind an allowlist, qnfo-ops/worker.js, file claimed by another session) and SECRETS-STORE-ADOPT-1 (first fleet-minted credential in the store and one-PATCH rotation, scripts/cf_ops_actions.py). Provider keys (Cloudflare, GitHub, DeepSeek, Zenodo, Buffer) are minted by the owner and stay with the owner.'
WHERE id = 51 AND item = 'RM-SECRETS-STORE-1' AND status = 'not-built';

-- ROW 54: the database is a file on the owner's machine.
UPDATE roadmap_implementation
SET evidence = COALESCE(evidence, '') || ' | C6-S2 2026-11-05 IDENTITY-BOUND card deepchat-db-encryption-1 (default in effect, nothing else for the fleet to build). The 1.3 GB DeepChat database is a local file on the owner''s computer: no session, loop or worker can open it, and the passphrase has to be the owner''s. Fleet side read 2026-11-05: R2 bucket deepchat holds settings backups (2026-07-13, 2026-08-31, including database-security.json at 110 bytes) and agent.db.gz copies of about 100 MB (2026-08-31); R2 encrypts every object at rest with Cloudflare-managed keys, the files are plain SQLite after download.'
WHERE id = 54 AND item = 'RM-DEEPCHAT-DB-ENCRYPTION-1' AND status = 'not-built';
UPDATE roadmap_implementation SET status = 'owner-decision' WHERE id = 54 AND item = 'RM-DEEPCHAT-DB-ENCRYPTION-1' AND status = 'not-built';

INSERT OR IGNORE INTO human_actions (slug, title, why, default_in_effect, action, sev, status, source)
VALUES ('deepchat-db-encryption-1',
  'Turn on DeepChat database encryption on your computer (RM-DEEPCHAT-DB-ENCRYPTION-1)',
  'IDENTITY-BOUND: the 1.3 GB DeepChat database is a file on your own computer and the passphrase must be yours; no session, loop or worker can open the file or choose the passphrase. Read 2026-11-05: R2 bucket deepchat holds settings backups (2026-07-13 and 2026-08-31, among them app-settings.json of 68,945 bytes and mcp-settings.json, which DeepChat may keep provider keys in) and agent.db.gz copies of about 100 MB (2026-08-31). R2 encrypts every object at rest with Cloudflare-managed keys, but the copies are plain SQLite after download. Losing the passphrase loses the chat history.',
  'Nothing changes until you act: the local database stays as it is and the fleet touches no file on your computer. The recommended default is chosen: DeepChat built-in database encryption with a passphrase kept in your password manager, plus device encryption (BitLocker) on the drive that holds the DeepChat data folder.',
  'In DeepChat open Settings, then Data or Database security, turn on database encryption, set a passphrase and store it in your password manager; restart DeepChat and confirm your history opens. In Windows Settings, Privacy and security, Device encryption (or BitLocker), confirm the system drive is on. If you turn encryption on, the next settings backup uploaded to R2 deepchat/backups/ replaces the plain ones; delete the 2026-07-13 and 2026-08-31 copies afterwards if they hold provider keys you still use, or rotate those keys. Mark this card done. Closing signal: your Done click on this card (no fleet probe can read the local file, by design); the next backup''s database-security.json (110 bytes on 2026-08-31) will carry the new setting.',
  'normal', 'open', 'session:c6-s2');

-- ROW 119: what shipped, and the two slices that existed only as prose.
UPDATE roadmap_implementation
SET status = 'partial',
    evidence = COALESCE(evidence, '') || ' | C6-S2 2026-11-05 PARTIAL, read live. qnfo-audit tables 941 -> 800 and bak_ tables 300 -> 153 in one evening (BAK-TABLE-SWEEP-1, PR 7194; sqlite_master read 2026-11-04 23:15Z); the file 1.49 GB -> 1.38 GB; COLD-TIER-1 (PR 7236, 7239; scripts/cold_tier.py) archived and pruned 24,800 fleet_probe_log rows in 31 R2 objects and 800 bp26_probe_results rows, 0 unverified (v_cold_tier_status); RETENTION-SWEEP-1 (PR 6986) and RETENTION-PRUNE-SPREAD-1 (PR 7077) shortened and spread the deletes; docs/RETENTION.md and retention_policy hold the personal-data periods (13 policies, report mode). Vectorize cap: fleet_budget vectorize_indexes 10 of 10; the index with no reader, qnfo-repos (24,146 vectors, 0 queries in 7 days), is agent_issues 1001823 (in flight in the code loop). Still prose only before this file, now issues with doers: COLD-TIER-2 (cron_fire_log, fleet_runs, cloud_ops_events, analytics_action_log into scripts/cold_tier.py TIERS) and BLOB-TIER-1 (code_task_ctx_archive 47.6 MB, paper_integrity_backups, email_raw_archive, errata_actions and version_queue bodies to R2). Open elsewhere: 1001676 (RETENTION-SWEEP-1), 1001778 to 1001780 (D1-SPLIT telemetry database).'
WHERE id = 119 AND item = 'RM-D1-RETENTION-1' AND status = 'not-built';

-- ROW 118: finished and tested, held back only by a file claim.
UPDATE roadmap_implementation
SET evidence = COALESCE(evidence, '') || ' | C6-S2 2026-11-05 NOT YET DEPLOYED. Read live: papers.qnfo.org served 19,761 requests in 24 h, 15,669 of them uncached 200s (cacheStatus none, a Worker response is never held by the zone cache), 0 edge 5xx in the last 3 days (the 504s of 2026-09 no longer occur; PAPER-TTFB-1 moved the plain fill out of the request), first byte 1.5 to 1.8 s for a 99 KB paper page that reads the living-paper database six or more times; ai.qnfo.org POSTs show no 400 in 24 h (the qwen3.8-27b router 400 of issue 489 is gone). Built: PAPER-EDGE-CACHE-1, a Cache API wrapper for handlePaperDetail (fresh 5 min, stale-while-revalidate 24 h, stale-if-error 7 days, version-tagged, one background rebuild per colo and slug, X-Edge-Cache header), 27-check suite qnfo-gateway/paper-edge-cache.test.mjs; the 43 other gateway suites pass and the mirror check of about-labels waits for the version bump. Held back by the work claim on qnfo-gateway/worker.js (REACH-AE-1b and three code-loop tasks); filed as PAPER-EDGE-CACHE-1 with the finished code on branch rm-c6-s2-edge.'
WHERE id = 118 AND item = 'RM-EDGE-CACHE-PAPERS-1' AND status = 'not-built';

-- Decisions taken for the owner under DEFAULT-APPROVE-1, each with its revert path.
INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'session:c6-s2',
 'The owner wants the edge to stop bursts on the public write routes now (roadmap row 52, standing yes); the Free plan allows one rate-limiting rule per zone, so the rule must be generous enough never to touch a person or a runner.',
 'Wrote the marked edge rules on qnfo.org (rate limit + scanner-path block), q08.org and qwav.tech with cf-ops-actions edge-rules, after a dry run and with an automatic restore on a 403/429 smoke failure.',
 'Runs 41934332823 (dry), 41942246628 (live: q08.org and qwav.tech written, qnfo.org refused for the header field), 41943363642 (live qnfo.org). Busiest legitimate write route: 144 requests a day from all addresses together (GraphQL, 24 h).',
 'Bursts above 20, 10 or 15 POSTs in 10 s from one address and data centre get 429 for 10 s; scanner paths get 403 at the edge; every must-answer host kept answering 200.',
 'Three zones, 10 s blocks, public write routes and scanner paths only; ops.qnfo.org and ai.qnfo.org are untouched.',
 'cf-ops-actions edge-rules --target <zone> --model revert removes exactly the rules whose description carries RM-WAF-RATE-LIMIT-1 and keeps every other rule.',
 'Edge rate limiting and a scanner block on three zones, written and reverted by an allowlisted action',
 'Worker invocations on scanner paths and write-route bursts fall; guard: no must-answer host turns 403 or 429.',
 'ask.qwav.tech /api/feedback, q08.org /subscribe, ideas.qnfo.org /api/subscribe, papers.qnfo.org /.env, /wp-login.php, /robots.txt, /.well-known/security.txt'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:c6-s2' AND action LIKE 'Wrote the marked edge rules%');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'session:c6-s2',
 'Unsampled exception capture across the fleet is worth more than the logging events q08-mind adds (events used 4.9 M of 20 M free).',
 'Raised Workers Logs head_sampling_rate of q08-mind from 0.1 to 1 with cf-ops-actions obs-sampling.',
 'Run 41944054759: before 0.1 (logs and top level), after 1, traces block unchanged, patch HTTP 200; the other 38 workers were already at 1.',
 'Every exception of q08-mind reaches worker_logs through ERROR-DETAIL-CAPTURE-1; 39 of 39 workers now log at 1.',
 'One worker, observability settings only; no binding, secret or code touched.',
 'cf-ops-actions has no revert for this; PATCH /workers/scripts/q08-mind/script-settings with observability head_sampling_rate 0.1, or a wrangler deploy of the current wrangler.toml (still 0.1 until OBS-SAMPLING-2 lands).',
 'Full-rate exception capture on the last sampled worker',
 'worker_logs rows for q08-mind rise to its true exception count.',
 'q08-mind settings read back before and after'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:c6-s2' AND action LIKE 'Raised Workers Logs head_sampling%');

-- Issues with doers: nothing above is left as prose.
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'OBS-SAMPLING-2: q08-mind/wrangler.toml declares head_sampling_rate = 1 (live raised by cf-ops-actions obs-sampling; the next wrangler deploy would revert it)',
'Charter pillar: core (observability). Roadmap row 55 (RM-TAIL-WORKERS-1). Evidence: cf-ops-actions obs-sampling run 41944054759 raised q08-mind Workers Logs sampling 0.1 -> 1 (read back from /settings); q08-mind/wrangler.toml still says head_sampling_rate = 0.1 and the directory is wrangler-only (the canonical path skips it), so the next wrangler deploy would restore 0.1 and 90 percent of its exceptions would again never reach worker_logs.' || char(10) ||
'EDIT: in q08-mind/wrangler.toml set the [observability] head_sampling_rate to 1 and keep the traces block as it is. The file may be under another session''s claim; the code loop takes it when the claim lapses.' || char(10) ||
'Definition of done: the file says head_sampling_rate = 1 and GET /accounts/{id}/workers/scripts/q08-mind/settings reads logs.head_sampling_rate 1 after the next deploy.' || char(10) ||
'code-task: repo=qnfo-workers path=q08-mind/wrangler.toml' || char(10) ||
'code-anchor: head_sampling_rate = 0.1' || char(10) ||
'code-probe: {"paths": ["q08-mind/wrangler.toml"], "absent": "head_sampling_rate = 0.1"}',
'session:c6-s2', 'optimization', 'low', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'OBS-SAMPLING-2:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'SECRETS-STORE-BIND-1: qnfo-ops installDeclaredBindings has no secrets_store_secrets case, so a declared Secrets Store binding never goes live (0 live store bindings on 39 workers)',
'Charter pillar: security. Roadmap row 51 (RM-SECRETS-STORE-1). Evidence (cf-ops-actions secrets-inventory run 41934447956, 2026-11-04): 39 workers, 112 secret bindings, 70 distinct names; Secrets Store default_secrets_store holds 30 entries and 0 workers bind it. qnfo-infra/wrangler.toml declares [[secrets_store_secrets]] CF_TOKEN_STORE -> CF_API_TOKEN and infraSecret() prefers the store, but the live worker carries ai, d1, secret_text and vectorize bindings only: installDeclaredBindings (qnfo-ops) installs d1, r2, kv, ai, services, vectorize, DO, queue, workflow, send_email, browser, ai_search, analytics_engine and artifacts, nothing for the store.' || char(10) ||
'EDIT: add a secrets_store_secrets case giving { type: "secrets_store_secret", name, store_id, secret_name }, installed ONLY when ops_config secrets_store_bind_allow (comma list of secret names, default empty) names the secret_name AND GET /accounts/{id}/secrets_store/stores/{store_id}/secrets finds it with scope workers; a failed or empty read skips the binding with a note and never fails the deploy. The allowlist is the guard: the CF_API_TOKEN entry was last modified 2026-07-04, its value cannot be read, and binding it before a refresh would move qnfo-infra to a possibly rotated-out token. Nothing changes until a name is allowlisted.' || char(10) ||
'Definition of done: a qnfo-ops test for the parser (declared + allowlisted -> binding present; not allowlisted -> absent; store read fails -> absent and the deploy proceeds); after the first allowlisted name and a canonical deploy, cf-ops-actions secrets-inventory shows it in store_bindings_live and declared_not_live is empty. The file qnfo-ops/worker.js is under another session''s work claim; the code loop takes it when the claim lapses.' || char(10) ||
'code-task: repo=qnfo-workers path=qnfo-ops/worker.js' || char(10) ||
'code-anchor: else if (s.name === "artifacts") decl.push({ type: "artifacts", name: nm });' || char(10) ||
'code-probe: {"paths": ["qnfo-ops/worker.js"], "contains": "secrets_store_secrets"}',
'session:c6-s2', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'SECRETS-STORE-BIND-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'SECRETS-STORE-ADOPT-1: move the first fleet-minted credential (INFRA_TOKEN) into the Secrets Store and rotate it with one PATCH',
'Charter pillar: security. Roadmap row 51 (RM-SECRETS-STORE-1). Evidence (secrets-inventory run 41934447956): 12 secret names sit on 3 or more workers, so one rotation today is 3 to 6 separate secret writes under 3 to 6 leases; INFRA_TOKEN (personal-api, qnfo-ai, qnfo-infra, qnfo-tools-mcp), INTENT_TOKEN, REGISTRY_TOKEN, SYNC_TOKEN, CAL_TOKEN, PILOT_TOKEN and EMAIL_API_KEY are fleet-minted bearer tokens, not provider keys. A store entry bound by every consumer changes with one PATCH and no redeploy.' || char(10) ||
'EDIT: a cf-ops-actions action secrets-store-adopt NAME that, under the secret-lock lease of each consumer, (1) mints a random value in the runner and never prints it, (2) writes it to a new store entry NAME with scope workers, (3) writes the same value to each consumer''s legacy secret so both paths agree, (4) after SECRETS-STORE-BIND-1 allowlists NAME and the consumers declare the binding, proves each consumer reads it, then (5) rotates with one PATCH of the store entry and probes old value 401 and new value 200 on the owning route. Provider keys (Cloudflare, GitHub, DeepSeek, Zenodo, Buffer) are minted by the owner and stay out of scope; a step the owner alone can take is an IDENTITY-BOUND card, not a workaround.' || char(10) ||
'Definition of done: INFRA_TOKEN is bound from the store on all four consumers (secrets-inventory store_bindings_live), one rotation drill passed with the old value refused, and the runbook line is in docs. Depends on SECRETS-STORE-BIND-1.' || char(10) ||
'code-task: repo=qnfo-workers path=scripts/cf_ops_actions.py' || char(10) ||
'code-anchor: def secrets_inventory(acct: str, token: str, now: float | None = None, root: str = ".") -> int:' || char(10) ||
'code-probe: {"paths": ["scripts/cf_ops_actions.py"], "contains": "secrets-store-adopt"}',
'session:c6-s2', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'SECRETS-STORE-ADOPT-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'COLD-TIER-2: cron_fire_log, fleet_runs, cloud_ops_events and analytics_action_log join scripts/cold_tier.py TIERS (docs/D1-TIERING-2026-11.md section 5, slice 1)',
'Charter pillar: cost (D1 speed and size). Roadmap row 119 (RM-D1-RETENTION-1). Evidence: COLD-TIER-1 is live (v_cold_tier_status 2026-11-04 23:05Z: fleet_probe_log 24,800 rows archived and pruned in 31 objects, bp26_probe_results 800, 0 unverified); docs/D1-TIERING-2026-11.md section 5 lists the next four tables as prose only (cron_fire_log 63,803 rows / 12.4 MB at 4,500 a day, fleet_runs 53,429 / 24.4 MB at 3,800, cloud_ops_events 148,440 / 37.1 MB at 6,700, analytics_action_log 20,455 / 9.6 MB at 800).' || char(10) ||
'EDIT: add one TIERS entry per table (ts column, keep_days 3 for cron_fire_log, 7 for fleet_runs, 14 for non-housekeeping cloud_ops_events, 30 for analytics_action_log, rollup dims, latest key where the newest row per key must stay) and extend the --selftest with one case each; same order as COLD-TIER-1: rollup, R2 object read back by sha and ids, ledger row, then deletes of at most 400 ids. The legacy retention triggers keep deleting at their own ages until the ledger gate (separate step).' || char(10) ||
'Definition of done: v_cold_tier_status lists the four tables with unverified 0 and the row counts of the four tables fall toward their keep windows (read by cold_archive_ledger, never by COUNT(*) of the big tables). The file scripts/cold_tier.py is under the work claim of session d1-slim-tiering; that session or the code loop takes it.' || char(10) ||
'code-task: repo=qnfo-workers path=scripts/cold_tier.py' || char(10) ||
'code-anchor: def archive_chunk(d1, r2, t, rows, now=None, sleep=time.sleep):' || char(10) ||
'code-probe: {"paths": ["scripts/cold_tier.py"], "contains": "cron_fire_log"}',
'session:c6-s2', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'COLD-TIER-2:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'BLOB-TIER-1: blob columns with no reader move to R2 and are nulled in D1 (code_task_ctx_archive, paper_integrity_backups, email_raw_archive, errata_actions and version_queue bodies)',
'Charter pillar: cost (D1 size). Roadmap row 119 (RM-D1-RETENTION-1). Evidence (docs/D1-TIERING-2026-11.md section 2, row bytes read 2026-11-04): code_task_ctx_archive 346 rows / 47.6 MB (no reader found), errata_actions 57.8 MB, version_queue 28.0 MB, paper_integrity_backups 9.7 MB (a backup of papers inside the database it backs up), email_raw_archive 5.5 MB (private path only, never the public repository); about 150 MB of the 1.38 GB file, listed in the document as prose.' || char(10) ||
'EDIT: for each table write the rows as JSONL.gz to qnfo-backups/cold/qnfo-audit/<table>/ with the COLD-TIER-1 read-back (sha256 and ids) and a cold_archive_ledger row, then UPDATE the blob column to NULL (the BLOB-TRIM-1 pattern, at most 400 rows a statement) and keep ids and status columns. email_raw_archive uses the private bucket path only. Restore: gunzip and INSERT OR IGNORE.' || char(10) ||
'Definition of done: the five tables hold their blob columns as NULL for rows older than 30 days, each has a verified ledger row, and `SELECT * FROM v_cold_tier_status` lists them with unverified 0. The file scripts/cold_tier.py is under the work claim of session d1-slim-tiering; that session or the code loop takes it.' || char(10) ||
'code-task: repo=qnfo-workers path=scripts/cold_tier.py' || char(10) ||
'code-anchor: def run(d1, r2=None, now=None, sleep=time.sleep, tiers=None, deadline=None):' || char(10) ||
'code-probe: {"paths": ["scripts/cold_tier.py"], "contains": "code_task_ctx_archive"}',
'session:c6-s2', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'BLOB-TIER-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'PAPER-EDGE-CACHE-1: papers.qnfo.org paper pages are served from the colo edge cache (fresh 5 min, stale-while-revalidate, stale-if-error); finished code on branch rm-c6-s2-edge',
'Charter pillar: reach (speed) and cost (living-paper reads). Roadmap row 118 (RM-EDGE-CACHE-PAPERS-1). Evidence read 2026-11-05: papers.qnfo.org served 19,761 requests in 24 h, 15,669 uncached 200s; a paper page takes 1.5 to 1.8 s to first byte (99 KB) because every view reads the living-paper database six or more times, and a Worker response is never held by the zone cache. 0 edge 5xx in the last 3 days, so the 504s are gone; the cache is for speed and for the next D1 overload.' || char(10) ||
'STATE: the change is written and tested. Branch rm-c6-s2-edge (origin) wraps handlePaperDetail as a Cache API layer: key host + slug; hit while built by this VERSION and younger than 5 minutes; stale-revalidating up to 24 h with one background rebuild per colo and slug (a 30 s lock key); stale-if-error for any stored copy up to 7 days; a copy built by another VERSION is never served as fresh; only GET html 200 pages without a token query are stored; X-Edge-Cache says hit, stale-revalidating, miss, stale-if-error or bypass; a failing Cache API falls back to the plain handler. qnfo-gateway/paper-edge-cache.test.mjs (27 checks) passes, as do the 43 other gateway suites (the mirror check of about-labels waits for the version bump). It waits only for the work claim on qnfo-gateway/worker.js (REACH-AE-1b, held by session F1-research-reach/B, and three code-loop tasks).' || char(10) ||
'EDIT: cherry-pick the branch commit onto main when the claim is free, run python scripts/worker_release.py bump qnfo-gateway --minor --note "PAPER-EDGE-CACHE-1", add a probes.json entry for a paper page, merge.' || char(10) ||
'Definition of done: curl -sI https://papers.qnfo.org/papers/distinction-lattice-framework twice answers x-edge-cache: hit on the second with a first byte under 0.4 s (1.5 to 1.8 s before), and the 24 h count of uncached 200s on papers.qnfo.org falls below half.' || char(10) ||
'code-task: repo=qnfo-workers path=qnfo-gateway/worker.js' || char(10) ||
'code-anchor: async function handlePaperDetail(request, env, path, ctx) {' || char(10) ||
'code-probe: {"paths": ["qnfo-gateway/worker.js"], "contains": "PAPER-EDGE-CACHE-1"}',
'session:c6-s2', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'PAPER-EDGE-CACHE-1:%');
