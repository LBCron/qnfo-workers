-- RM-BS-PERSONAL-PLANE-1 slice 1 (blue-sky roadmap B10, row 3266; PER-02, CF-B-11; charter pillar personal; W2-J 2026-11-05).
-- WHAT  Two measured facts the roadmap's personal-plane bet is missing, as data rather than prose, and the keyed-memory slice queued for the one file that is claimed:
--       (1) personal_plane_audit_deps: which qnfo-audit tables each personal-plane worker reads or writes, read from the fleet graph (GET /fleet-graph/worker?worker=<name>, 2026-11-05 04:34Z).
--           The roadmap feared "a rewrite of every shared read". Measured: personal-api touches 4 audit tables (ai_cache_counters, ai_call_counters, cron_fire_log, fleet_heartbeat), all fleet plumbing;
--           personal-companion touches 14, of which three are the fleet's issue pipeline (agent_issues, issue_triage, metric_registry) plus signals and owner_questions. personal-watch and q08-mind bind nothing.
--           The personal-life D1 holds 37 (personal-api) and 19 (personal-companion) tables used by those workers. This is the scope of CF-B-11 (separate Cloudflare account): a service-binding intake
--           for the companion's fleet writes and a heartbeat/ledger intake for both, not a rewrite of every read.
--       (2) v_personal_plane_cost_30d: the personal plane's own cost line ("personal cost becomes a visible separate line"): Workers AI neurons, calls and list-price USD per worker over 30 days,
--           with the share of the fleet's neurons. Workers: personal-api, personal-companion, personal-watch, q08-mind (the twin and its pages), q08-signal-engine and qnfo-jobsearch (pillar personal).
--           Read 2026-11-05: q08-signal-engine 3,606,104 neurons (USD 39.67 at list price) in 30 days is nearly all of it; personal-api 11,562 neurons (USD 0.13); personal-companion 0 neurons and 10,706
--           calls (it calls an external provider, so its USD is not in this counter: cost_basis says so).
--       (3) the keyed-memory slice (facts supersede, instructions immutable, weekly injection canary; PER-02) as an issue with code-task, anchor and probe for personal-api/worker.js, which the code
--           loop holds until 05:16Z for task ct_im1001641 (work-lock read 2026-11-05 04:40Z): taking a second claim on that file would duplicate work, so it is queued, not written.
-- SEPARATION: this file reads and writes qnfo-audit only; it names no personal-life row and queries no research store. Nothing in it lets the personal plane read the research plane.
-- PREDICTION: v_personal_plane_cost_30d is readable by the dashboard and the owner (no change in spend); the isolation scope shrinks from "every shared read" to 4 + 14 audit tables, so CF-B-11 is
--             sized as an M, not an L; the keyed-memory task moves from queued to merged within 24 hours of the file claim lapsing.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_personal_plane_cost_30d; DROP TABLE IF EXISTS personal_plane_audit_deps; DROP TABLE IF EXISTS personal_plane_workers
-- CAUSE-MAPPED: registers no metric_registry row.
-- spof-review: adds no worker, cron, trigger, route or credential.

CREATE TABLE IF NOT EXISTS personal_plane_workers (
  worker TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  binds_audit INTEGER NOT NULL,
  personal_life_tables INTEGER,
  cost_basis TEXT NOT NULL,
  read_at TEXT NOT NULL,
  note TEXT
);

INSERT OR IGNORE INTO personal_plane_workers (worker, role, binds_audit, personal_life_tables, cost_basis, read_at, note) VALUES
 ('personal-api', 'personal twin: chat, calendar, tasks, memory, MCP tools (me.q08.org, personal.qnfo.org)', 1, 37, 'workers-ai-neurons', '2026-11-05T04:34:00Z', 'bindings AI, AUDIT, PERSONAL, VZ, MEDIA, CAL_API, SEND_EMAIL, PERSONAL_TWIN_AGENT'),
 ('personal-companion', 'companion loop: briefs, reading, travel, owner questions (reading.q08.org, travel.q08.org)', 1, 19, 'external-provider-calls (neurons not counted)', '2026-11-05T04:34:00Z', 'bindings AI, AUDIT, PERSONAL, VZ, MEDIA, VAULT, EMAIL, GEN_FLOW, SEND_EMAIL; calls api.deepseek.com'),
 ('personal-watch', 'watch.q08.org page', 0, 0, 'workers-ai-neurons', '2026-11-05T04:34:00Z', 'no bindings'),
 ('q08-mind', 'mind.q08.org page', 0, 0, 'workers-ai-neurons', '2026-11-05T04:34:00Z', 'no bindings'),
 ('q08-signal-engine', 'q08.org signal scraping and essays (pillar personal)', 1, 0, 'workers-ai-neurons', '2026-11-05T04:34:00Z', 'binds its own d1 q08-signal and AUDIT'),
 ('qnfo-jobsearch', 'jobs.q08.org matcher (pillar personal)', 1, 0, 'workers-ai-neurons', '2026-11-05T04:34:00Z', 'binds AUDIT');

CREATE TABLE IF NOT EXISTS personal_plane_audit_deps (
  worker TEXT NOT NULL,
  audit_table TEXT NOT NULL,
  access TEXT NOT NULL,
  kind TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (worker, audit_table)
);

INSERT OR IGNORE INTO personal_plane_audit_deps (worker, audit_table, access, kind, read_at) VALUES
 ('personal-api', 'ai_cache_counters', 'writes', 'fleet plumbing (AI meter)', '2026-11-05T04:34:00Z'),
 ('personal-api', 'ai_call_counters', 'reads,writes', 'fleet plumbing (AI meter)', '2026-11-05T04:34:00Z'),
 ('personal-api', 'cron_fire_log', 'reads,writes', 'fleet plumbing (cron grid)', '2026-11-05T04:34:00Z'),
 ('personal-api', 'fleet_heartbeat', 'writes', 'fleet plumbing (heartbeat)', '2026-11-05T04:34:00Z'),
 ('personal-companion', 'agent_issues', 'reads,writes', 'fleet issue pipeline', '2026-11-05T04:34:00Z'),
 ('personal-companion', 'ai_call_counters', 'creates,reads,writes', 'fleet plumbing (AI meter)', '2026-11-05T04:34:00Z'),
 ('personal-companion', 'calendar_feedback', 'reads', 'fleet calendar data', '2026-11-05T04:34:00Z'),
 ('personal-companion', 'calendar_meta', 'reads', 'fleet calendar data', '2026-11-05T04:34:00Z'),
 ('personal-companion', 'companion_runs', 'reads', 'companion run ledger', '2026-11-05T04:34:00Z'),
 ('personal-companion', 'contact_ledger', 'reads', 'contact ledger', '2026-11-05T04:34:00Z'),
 ('personal-companion', 'content_external_items', 'reads,writes', 'external content queue', '2026-11-05T04:34:00Z'),
 ('personal-companion', 'email_suppression', 'reads', 'outreach suppression (consent)', '2026-11-05T04:34:00Z'),
 ('personal-companion', 'fleet_heartbeat', 'writes', 'fleet plumbing (heartbeat)', '2026-11-05T04:34:00Z'),
 ('personal-companion', 'issue_triage', 'writes', 'fleet issue pipeline', '2026-11-05T04:34:00Z'),
 ('personal-companion', 'metric_registry', 'writes', 'fleet metric pipeline', '2026-11-05T04:34:00Z'),
 ('personal-companion', 'ops_config', 'reads', 'fleet config', '2026-11-05T04:34:00Z'),
 ('personal-companion', 'owner_questions', 'creates,reads,writes', 'owner question queue', '2026-11-05T04:34:00Z'),
 ('personal-companion', 'signals', 'writes', 'signal ledger', '2026-11-05T04:34:00Z');

CREATE VIEW IF NOT EXISTS v_personal_plane_cost_30d AS
SELECT w.worker AS worker, w.cost_basis AS cost_basis,
  COALESCE(SUM(c.calls), 0) AS calls, CAST(ROUND(COALESCE(SUM(c.neurons), 0)) AS INTEGER) AS neurons,
  ROUND(MAX(0, COALESCE(SUM(c.neurons), 0)) / 1000.0 * 0.011, 2) AS usd_list_price,
  ROUND(100.0 * COALESCE(SUM(c.neurons), 0) / MAX((SELECT SUM(neurons) FROM ai_call_counters WHERE day >= date('now', '-30 days')), 1), 3) AS pct_of_fleet_neurons
FROM personal_plane_workers w
LEFT JOIN ai_call_counters c ON c.worker = w.worker AND c.day >= date('now', '-30 days')
GROUP BY w.worker, w.cost_basis;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.PERSONAL W2-J-PERS-2: personal-api keyed memory (facts supersede, instructions immutable) and a weekly injection canary',
 'code-task: repo=qnfo-workers path=personal-api/worker.js' || char(10) ||
 'code-anchor: async function memoryAdd(env, args) {' || char(10) ||
 'code-probe: {"paths": ["personal-api/worker.js"], "contains": "memory_keyed"}' || char(10) || char(10) ||
 'Charter pillar personal (program QNFO.PERSONAL); roadmap row RM-BS-PERSONAL-PLANE-1 (3266), blue-sky B10 (PER-02). Claim note: personal-api/worker.js is held by the code loop for task ct_im1001641 (read 04:40Z until 05:16Z, renewed at 05:02Z to 06:32Z); take file:personal-api/worker.js when it lapses or the holder releases, and do not touch the research plane or any qnfo-audit table other than cloud_ops_events/fleet_heartbeat.' || char(10) ||
 'Today (read 2026-11-05): memory_add/memory_list/memory_forget (worker.js lines ~1246-1280) write and delete rows of personal-life.facts by statement only: no key, so a changed fact (a new address) is a second row beside the old one; and any model-callable tool can forget any row, so an injected instruction in a retrieved note can delete what the owner told the twin. facts are read in six places (loadFactsNotes, loadPrimeContext, the brief, the MCP route, the chat prefix, the DO).' || char(10) ||
 'DO: (1) CREATE TABLE IF NOT EXISTS memory_keyed (id, key, statement, kind CHECK (kind IN (''fact'', ''instruction'')), ts, superseded_by, source) in personal-life with BEFORE UPDATE and BEFORE DELETE triggers that RAISE for kind = ''instruction'' rows; never ALTER facts (the six readers swallow errors and would lose all memory on a missing column); (2) tool memory_set {key, statement}: inserts a fact row and sets superseded_by on the previous live row with the same key, refusing a key that holds an instruction; (3) instructions are added only by an owner-authenticated route (the API_KEY bearer route, not in the model-callable TOOLS registry); (4) loadFactsNotes renders live keyed facts under MEMORIZED FACTS (DATA ONLY) and instructions in a separate OWNER INSTRUCTIONS section, both capped, canary keys excluded; (5) memoryInjectionCanary(env): once a week from scheduledOnce (gate on the last cloud_ops_events kind personal-memory-canary), writes a synthetic fact whose text is an injection payload under key canary:inject (superseding last week''s), asserts it renders inside the DATA section only, that memory_set cannot overwrite the immutable canary:immutable instruction and that UPDATE/DELETE on it abort, and records ok/fail counts (no private text) in cloud_ops_events. Tests: node:sqlite fixture in personal-api/ following tool-trace-memory.test.mjs (import the worker as a data URL, export the new functions).' || char(10) ||
 'Definition of done: merged and verified live: a cloud_ops_events row kind personal-memory-canary with status ok within a week of the deploy, memory_keyed exists in personal-life with the two triggers, and memory_set twice on one key leaves one live row; recorded in issue_triage.close_evidence.',
 'session:w2-j', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.PERSONAL W2-J-PERS-2%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.PERSONAL W2-J-PERS-3: personal-companion writes to the fleet issue pipeline through one intake instead of binding qnfo-audit tables',
 'code-task: repo=qnfo-workers path=personal-companion/worker.js' || char(10) ||
 'code-anchor: async function companionStallDetector(env, nowMs) {' || char(10) ||
 'code-probe: {"paths": ["personal-companion/worker.js"], "absent": "INSERT INTO agent_issues"}' || char(10) || char(10) ||
 'Charter pillar personal (program QNFO.PERSONAL); roadmap row RM-BS-PERSONAL-PLANE-1 (3266), blue-sky B10 W3 (CF-B-11, move the personal workers to a separate Cloudflare account). Measured scope (personal_plane_audit_deps): personal-companion writes agent_issues, issue_triage, metric_registry, signals, fleet_heartbeat and reads 9 more audit tables; personal-api only 4 plumbing tables. Cross-account D1 bindings do not exist, so every one of these is a rewrite to a call.' || char(10) ||
 'DO (smallest first, one PR): the two agent_issues inserts (companionStallDetector, line ~7458, and flagUndeliverableQuestions, line ~8266, of personal-companion/worker.js) become one function that posts to an intake the fleet already owns (qnfo-ops queue/issue route through a service binding, or qnfo-cloud-ops), keeping the personal/research separation: the issue text carries no personal content. Verify with impact on d1t:qnfo-audit.agent_issues first. Then the same for issue_triage and metric_registry writes.' || char(10) ||
 'Definition of done: merged and verified live: personal_plane_audit_deps rows for agent_issues, issue_triage and metric_registry are removed by a later migration after the fleet graph shows no qnfo-audit write from personal-companion to them; recorded in issue_triage.close_evidence.',
 'session:w2-j', 'optimization', 'low', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.PERSONAL W2-J-PERS-3%' AND status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:w2-j (blue-sky B10)',
  'the personal plane can be isolated in steps if the shared surface is known; the roadmap assumed it was every shared read',
  'RM-BS-PERSONAL-PLANE-1 slice 1: personal_plane_audit_deps (18 rows), personal_plane_workers (6), v_personal_plane_cost_30d, two queued issues (keyed memory + canary; companion intake)',
  'fleet graph /fleet-graph/worker read 2026-11-05 04:34Z: personal-api 4 qnfo-audit tables (all plumbing), personal-companion 14; ai_call_counters 30 days: q08-signal-engine 3,606,104 neurons, personal-api 11,562, personal-companion 0 with 10,706 calls; work-lock: personal-api/worker.js held by ct_im1001641 until 05:16Z',
  'measured scope and a separate cost line; the code slice is queued behind the file claim', 'two tables, one view, two issues; no personal data read or written',
  'the Rollback header of migrations/2026-11-05-rm-bs-personal-plane-1.sql',
  'the isolation scope and the personal cost line are data a loop can read',
  'CF-B-11 sized by 18 audit-table dependencies instead of an open-ended rewrite; personal cost visible as one view', 'none', 'fleet-graph worker reads, D1 reads of ai_call_counters, work-lock read'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'RM-BS-PERSONAL-PLANE-1 slice 1:%');
