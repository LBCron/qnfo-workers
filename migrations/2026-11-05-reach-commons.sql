-- REACH-COMMONS-1 (2026-11-05, charter pillars reach and research; blue-sky roadmap docs/BLUE-SKY-ROADMAP-2026-11.md B5, B6, B7, B11; roadmap_implementation rows 3261 RM-BS-PAPERS-AS-AGENTS-1,
-- 3262 RM-BS-QUANTUM-COMMONS-1, 3263 RM-BS-SELF-AUDITING-JOURNAL-1, 3267 RM-BS-OPEN-DATA-COMMONS-1; session W2-I).
-- THE GAP, READ 2026-11-05: B5 predicts "agent and answer-engine referrals become a measured series within 14 days (today there is none)". The two halves exist in separate stores:
-- what AI crawlers and assistants FETCH is in living-paper seo_crawl_log (gateway, per bot and path kind), what they SEND is a referrer host in qnfo-audit reach_signals (cf-rum-human, reach-ae).
-- Over the 7 complete days 2026-10-29..11-04 AI crawlers and assistants fetched 12,239 answered pages (amazonbot 3,499; gptbot 3,462; claudebot 2,672; oai-searchbot 1,637; perplexitybot 825;
-- chatgpt-user 92; ccbot 52) and the 5,187 referrer-attributed human page loads of the same days contained 0 from an answer engine (chatgpt.com, perplexity.ai, claude.ai, gemini.google.com, copilot ...).
-- The same day the Cloudflare zone settings were read (GET /zones/{id}/bot_management, Cloudflare MCP): qnfo.org, qwav.org and q08.org all read ai_bots_protection, crawler_protection, ai_training,
-- ai_search, ai_user and every ai_agents entry "disabled" and fight_mode false: no AI-crawler block exists, so the fetches are not being turned away.
-- THIS FILE adds: the table ai_referrer_hosts (the referrer hosts counted as an answer engine; an INSERT adds one, no deploy); the views v_ai_reach_daily (30-day series) and v_ai_reach_7d (the
-- reading); four metrics: ai_assistant_fetches_7d and answer_engine_referrals_7d (observational, the two halves of the kill rule in B5, refreshed hourly on fleet_tick), ai_crawler_block_zones (guard,
-- written daily by qnfo-infra 1.14.0, trigger above 0) and atlas_export_age_h (guard on the daily open-data export, trigger above 48 h); one hourly refresh trigger; the cause mappings; decision_log; and the
-- follow-up issues, each with a code-task, an anchor and a closing probe. The collectors are in qnfo-infra (collectAgentReads, collectAiCrawlProbe, publishAtlas); until its first fire the two fetch/export
-- metrics read UNMEASURED (NULL), never 0.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS reach_commons_tick; DROP VIEW IF EXISTS v_ai_reach_7d; DROP VIEW IF EXISTS v_ai_reach_daily; DROP TABLE IF EXISTS ai_referrer_hosts; DELETE FROM metric_breach_cause WHERE metric_key IN ('ai_assistant_fetches_7d', 'answer_engine_referrals_7d', 'ai_crawler_block_zones', 'atlas_export_age_h'); DELETE FROM analytics_metric_triggers WHERE metric_key IN ('ai_crawler_block_zones', 'atlas_export_age_h'); DELETE FROM metric_registry WHERE metric IN ('ai_assistant_fetches_7d', 'answer_engine_referrals_7d', 'ai_crawler_block_zones', 'atlas_export_age_h'); UPDATE agent_issues SET status = 'closed' WHERE source = 'session:W2-I' AND title LIKE 'ROADMAP-1:%' AND status = 'open'; DELETE FROM decision_log WHERE actor = 'session:W2-I' AND capability_gain = 'ai-reach-series';
-- spof-review: one producer per series, qnfo-infra's hourly fire (its infra_state rows agent_reads, ai_crawl_probe and atlas_export hold the last success and atlas_export_age_h turns a stale export into an issue);
-- one refresh trigger on fleet_tick (first ten minutes of each hour).
-- CAUSE-MAPPED: INSERT INTO metric_breach_cause below maps all four metrics in this same file.
-- METRIC-EXEMPT: ai_assistant_fetches_7d and answer_engine_referrals_7d are the two sides of the B5 kill rule (agent reads up while external referrals stay flat ends the investment beyond the basics); a rate between them is a decision for the managers, not a breach, so no trigger of their own.
-- NOOP-OK: the first-reading UPDATEs of the registry rows are idempotent; a replay rewrites the same readings.

CREATE TABLE IF NOT EXISTS ai_referrer_hosts (
  host TEXT PRIMARY KEY,
  engine TEXT NOT NULL,
  note TEXT
);

INSERT OR IGNORE INTO ai_referrer_hosts (host, engine, note) VALUES
  ('chatgpt.com', 'chatgpt', 'ChatGPT web'), ('chat.openai.com', 'chatgpt', 'ChatGPT legacy host'), ('perplexity.ai', 'perplexity', NULL), ('www.perplexity.ai', 'perplexity', NULL),
  ('claude.ai', 'claude', NULL), ('gemini.google.com', 'gemini', NULL), ('copilot.microsoft.com', 'copilot', NULL), ('copilot.com', 'copilot', NULL),
  ('you.com', 'you', NULL), ('phind.com', 'phind', NULL), ('poe.com', 'poe', NULL), ('meta.ai', 'meta-ai', NULL), ('grok.com', 'grok', NULL),
  ('chat.mistral.ai', 'mistral', NULL), ('chat.deepseek.com', 'deepseek', NULL), ('kimi.com', 'kimi', NULL), ('chat.qwen.ai', 'qwen', NULL), ('duck.ai', 'duckduckgo-ai', NULL);

-- the daily series (last 30 days): fetches by the AI crawlers and assistants the gateway recognises (answered requests only), and answer-engine referrals from the two instruments
CREATE VIEW IF NOT EXISTS v_ai_reach_daily AS
SELECT date,
  CAST(COALESCE(SUM(CASE WHEN source = 'seo-crawl' AND entity_type = 'bot' AND entity_id IN ('gptbot', 'oai-searchbot', 'chatgpt-user', 'claudebot', 'perplexitybot', 'ccbot', 'amazonbot') THEN value END), 0) AS INTEGER) AS ai_fetches,
  CAST(COALESCE(SUM(CASE WHEN source = 'seo-crawl' AND entity_type = 'bot' AND entity_id = 'chatgpt-user' THEN value END), 0) AS INTEGER) AS ai_user_fetches,
  CAST(COALESCE(SUM(CASE WHEN source = 'cf-rum-human' AND entity_type = 'referrer' AND entity_id IN (SELECT host FROM ai_referrer_hosts) THEN value END), 0) AS INTEGER) AS answer_engine_referrals,
  CAST(COALESCE(SUM(CASE WHEN source = 'reach-ae' AND entity_type = 'referrer' AND entity_id IN (SELECT host FROM ai_referrer_hosts) THEN value END), 0) AS INTEGER) AS answer_engine_referrals_edge,
  CAST(COALESCE(SUM(CASE WHEN source = 'cf-rum-human' AND entity_type = 'referrer' THEN value END), 0) AS INTEGER) AS referrer_loads
FROM reach_signals
WHERE date >= date('now', '-30 days')
  AND ((source = 'seo-crawl' AND channel = 'agent' AND entity_type = 'bot') OR (source IN ('cf-rum-human', 'reach-ae') AND entity_type = 'referrer'))
GROUP BY date;

-- the reading: 7 complete UTC days; fetch_days and referral_days say how many of them carry data (a metric reads only from 5 days)
CREATE VIEW IF NOT EXISTS v_ai_reach_7d AS
SELECT
  COUNT(CASE WHEN ai_fetches > 0 THEN 1 END) AS fetch_days,
  COALESCE(SUM(ai_fetches), 0) AS ai_fetches,
  COALESCE(SUM(ai_user_fetches), 0) AS ai_user_fetches,
  COUNT(CASE WHEN referrer_loads > 0 THEN 1 END) AS referral_days,
  COALESCE(SUM(answer_engine_referrals), 0) AS answer_engine_referrals,
  COALESCE(SUM(answer_engine_referrals_edge), 0) AS answer_engine_referrals_edge,
  COALESCE(SUM(referrer_loads), 0) AS referrer_loads
FROM v_ai_reach_daily
WHERE date >= date('now', '-7 days') AND date < date('now');

INSERT OR IGNORE INTO metric_registry
  (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, last_value, last_refreshed, state, refresh_class)
VALUES
  ('ai_assistant_fetches_7d', 'reach', 'leading',
   'Answered (HTTP 200 to 399) fetches by AI crawlers and assistants (gptbot, oai-searchbot, chatgpt-user, claudebot, perplexitybot, ccbot, amazonbot) over the 7 complete UTC days before today, from reach_signals source seo-crawl (collectAgentReads in qnfo-infra copies the gateway''s living-paper seo_crawl_log hourly); NULL below 5 days of data. Read beside answer_engine_referrals_7d (B5 kill rule).',
   'qnfo-audit.v_ai_reach_7d <- reach_signals seo-crawl <- living-paper.seo_crawl_log; refreshed hourly by trigger reach_commons_tick on fleet_tick',
   '12,239 (2026-10-29..11-04, read from seo_crawl_log directly)', 'observe: B5 kill rule compares it with answer_engine_referrals_7d', 'qnfo-gateway',
   'REACH-FOCUS: per-paper markdown, quickread and llms.txt are the surfaces these agents read; docs/BLUE-SKY-ROADMAP-2026-11.md B5', '1h', NULL, NULL,
   NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', 'computed'),
  ('answer_engine_referrals_7d', 'reach', 'leading',
   'Human page loads over the 7 complete UTC days before today whose referrer host is in ai_referrer_hosts (chatgpt.com, perplexity.ai, claude.ai, gemini.google.com, copilot.microsoft.com ...), from reach_signals source cf-rum-human, entity_type referrer; NULL below 5 days of referrer data. The edge instrument (reach-ae) is read beside it in v_ai_reach_7d.',
   'qnfo-audit.v_ai_reach_7d <- reach_signals cf-rum-human referrer rows; refreshed hourly by trigger reach_commons_tick on fleet_tick',
   '0 of 5,187 referrer-attributed loads (2026-10-29..11-04)', 'maximize: B5 predicts external-referrer loads per paper rise 0.12 to 0.3 within 90 days', 'qnfo-gateway',
   'the paper surfaces for agents (markdown, quickread, llms.txt, citation cards); docs/BLUE-SKY-ROADMAP-2026-11.md B5', '1h', NULL, NULL,
   NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', 'computed'),
  ('ai_crawler_block_zones', 'reach', 'guard',
   'Count of the fleet zones (qnfo.org, qwav.org, q08.org) whose Cloudflare bot management settings would block or charge an AI crawler: ai_bots_protection, content_bots_protection, crawler_protection, ai_training, ai_search, ai_user or an ai_agents entry not disabled/allow, or fight_mode on. Written once a day by qnfo-infra collectAiCrawlProbe (GET /zones/{id}/bot_management); NULL (UNMEASURED) when any zone cannot be read.',
   'qnfo-infra infra_state ai_crawl_probe (last success) and metric_registry.last_value',
   '0 (all three zones read all-disabled on 2026-11-05)', '0', 'qnfo-infra',
   'restore the setting that blocks (docs/DOMAINS.md; the fleet policy is open access with Content-Signal ai-train yes)', '24h', '> 0', NULL,
   NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', 'worker-written'),
  ('atlas_export_age_h', 'reach', 'guard',
   'Hours since the last successful daily open-data export (infra_state atlas_export, written by qnfo-infra publishAtlas after the four R2 objects under atlas/ai-science-failures/ are put); NULL before the first export.',
   'qnfo-audit.infra_state atlas_export; refreshed hourly by trigger reach_commons_tick on fleet_tick',
   'new 2026-11-05', '<= 48', 'qnfo-infra',
   'the atlas_export_error infra_state row names the last failure; code-task on qnfo-infra publishAtlas', '1h', '> 36', '> 72',
   NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', 'computed');

CREATE TRIGGER IF NOT EXISTS reach_commons_tick
AFTER INSERT ON fleet_tick
WHEN strftime('%M', 'now') < '10' OR NEW.source LIKE 'migration:%'
BEGIN
  UPDATE metric_registry
  SET last_value = (SELECT CASE WHEN fetch_days >= 5 THEN CAST(ai_fetches AS TEXT) END FROM v_ai_reach_7d),
      last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      state = CASE WHEN (SELECT fetch_days FROM v_ai_reach_7d) >= 5 THEN 'MEASURED' ELSE 'UNMEASURED' END
  WHERE metric = 'ai_assistant_fetches_7d';
  UPDATE metric_registry
  SET last_value = (SELECT CASE WHEN referral_days >= 5 THEN CAST(answer_engine_referrals AS TEXT) END FROM v_ai_reach_7d),
      last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      state = CASE WHEN (SELECT referral_days FROM v_ai_reach_7d) >= 5 THEN 'MEASURED' ELSE 'UNMEASURED' END
  WHERE metric = 'answer_engine_referrals_7d';
  UPDATE metric_registry
  SET last_value = (SELECT CAST(ROUND((julianday('now') - julianday(ts)) * 24, 1) AS TEXT) FROM infra_state WHERE id = 'atlas_export'),
      last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      state = CASE WHEN EXISTS (SELECT 1 FROM infra_state WHERE id = 'atlas_export') THEN 'MEASURED' ELSE 'UNMEASURED' END
  WHERE metric = 'atlas_export_age_h';
END;

-- first readings now (idempotent)
UPDATE metric_registry
SET last_value = (SELECT CASE WHEN fetch_days >= 5 THEN CAST(ai_fetches AS TEXT) END FROM v_ai_reach_7d),
    last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    state = CASE WHEN (SELECT fetch_days FROM v_ai_reach_7d) >= 5 THEN 'MEASURED' ELSE 'UNMEASURED' END
WHERE metric = 'ai_assistant_fetches_7d';
UPDATE metric_registry
SET last_value = (SELECT CASE WHEN referral_days >= 5 THEN CAST(answer_engine_referrals AS TEXT) END FROM v_ai_reach_7d),
    last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    state = CASE WHEN (SELECT referral_days FROM v_ai_reach_7d) >= 5 THEN 'MEASURED' ELSE 'UNMEASURED' END
WHERE metric = 'answer_engine_referrals_7d';

INSERT INTO analytics_metric_triggers
  (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
SELECT
  'ai_crawler_block_zones', 'Reach guard: a fleet zone has an AI-crawler block enabled (the policy is open access)', 'registry', 'gt', 0, 4,
  'Pillar reach. Read which zone and setting: SELECT data FROM infra_state WHERE id = ''ai_crawl_probe'' (zones[].signals). The fleet allows AI crawlers on purpose (robots.txt allows them, Content-Signal says search yes, ai-input yes, ai-train yes; OPEN-ACCESS-1), and AI crawlers fetched 12,239 pages in 7 days. Find the change (Cloudflare zone audit log, cf-ops-actions report) and restore the setting to disabled; a deliberate block needs a recorded decision_log row naming the owner decision. A zone the probe cannot read leaves the metric UNMEASURED and files nothing: read infra_state ai_crawl_probe_error for the refusal.',
  'qnfo-infra', 'agent_issues', 24, 1,
  'REACH-COMMONS-1: guard on B5; fires only on a real block, never on an unreadable zone.'
WHERE NOT EXISTS (SELECT 1 FROM analytics_metric_triggers WHERE metric_key = 'ai_crawler_block_zones');

INSERT INTO analytics_metric_triggers
  (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
SELECT
  'atlas_export_age_h', 'Reach guard: the open-data atlas export is more than 48 hours old', 'registry', 'gt', 48, 4,
  'Pillar research. The daily export of the AI-written-science failure record (R2 qnfo atlas/ai-science-failures/) has not succeeded for two days. Read the last failure: SELECT data FROM infra_state WHERE id = ''atlas_export_error''. Check the R2 binding ATLAS_R2 and the two reads (internal_errata, papers) in qnfo-infra publishAtlas.' || char(10) ||
  'code-task: repo=qnfo-workers path=qnfo-infra/worker.js' || char(10) ||
  'code-anchor: async function publishAtlas(env, nowMs) {',
  'qnfo-infra', 'agent_issues', 24, 1,
  'REACH-COMMONS-1: freshness guard; NULL (no export yet) files nothing.'
WHERE NOT EXISTS (SELECT 1 FROM analytics_metric_triggers WHERE metric_key = 'atlas_export_age_h');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
  ('ai_assistant_fetches_7d', 'measurement', 'REACH-COMMONS-1 2026-11-05: observational; a fall means the gateway stopped logging a bot or the collector stopped, not that agents left.'),
  ('answer_engine_referrals_7d', 'measurement', 'REACH-COMMONS-1 2026-11-05: observational; a change is read against ai_assistant_fetches_7d and v_ai_reach_daily before any action.'),
  ('ai_crawler_block_zones', 'structure', 'REACH-COMMONS-1 2026-11-05: a zone setting (bot management) drifted to block AI crawlers; repair is the setting, not the metric.'),
  ('atlas_export_age_h', 'publishing', 'REACH-COMMONS-1 2026-11-05: the daily export did not complete; repair is qnfo-infra publishAtlas or its R2 binding.');

-- follow-up slices, each with a doer (the code loop via code-task), an anchor that occurs once and a closing probe
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH ATLAS-GATEWAY-ROUTE-1: serve the open-data atlas under papers.qnfo.org/data/ai-science-failures/ and list it in llms.txt (RM-BS-OPEN-DATA-COMMONS-1 slice 2)',
 'QNFO.REACH; charter pillar research; metric: dataset reads (seo_crawl_log kind api) and external references; doer: qnfo-gateway via qnfo-code-orchestrator. Slice 1 (qnfo-infra 1.14.0) writes errata.jsonl, papers-status.jsonl, DATACARD.md and manifest.json daily to R2 bucket qnfo under atlas/ai-science-failures/, public today only at the r2.dev address https://pub-426be63219f54be3932467bcbaf805f5.r2.dev/atlas/ai-science-failures/manifest.json (rate-limited, not a name a person can remember). Build: in qnfo-gateway add GET /data/ai-science-failures/<file> that streams that R2 key (QNFO_BUCKET binding, files limited to the four names, Content-Type and ETag from the object, CORS *, Cache-Control 1 h), an HTML landing page at /data/ai-science-failures that renders DATACARD.md and carries schema.org Dataset JSON-LD (name, license LicenseRef-QNFO-ULA-2.1 with its URL, distribution with the sha256 from the manifest, isAccessibleForFree true, a creator), and one line each in llms.txt (Open data section), the sitemap and /openapi.json. No tokens (OPEN-ACCESS-1).' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-gateway/worker.js' || char(10) ||
 'code-anchor: async function handleLlmsTxt(env) {' || char(10) ||
 'runtime-probe: {"url":"https://papers.qnfo.org/data/ai-science-failures/manifest.json","status":200,"contains":"qnfo-ai-written-science-failures"}' || char(10) ||
 'code-probe: {"paths":["qnfo-gateway/worker.js"],"contains":"ATLAS-GATEWAY-ROUTE-1"}',
 'session:W2-I', 'code', 'medium', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH ATLAS-GATEWAY-ROUTE-1:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.RSCH PAPER-AUDIT-STATUS-PAGE-1: show each paper''s audit status above the fold (open findings, provenance and human review, link to the record) (RM-BS-SELF-AUDITING-JOURNAL-1 slice 2)',
 'QNFO.RSCH; charter pillar research; metric: papers_with_open_high_errata_pct and reader reports per paper; doer: qnfo-gateway via qnfo-code-orchestrator. Slice 1 (qnfo-infra 1.14.0) publishes papers-status.jsonl (per published paper: errata_total, errata_open, errata_closed, errata_resolved, errata_rejected, last_errata_detected_at, provenance, human_review_recorded) next to the errata record. Build: on every paper page (handlePaperDetail) add a compact audit-status block above the abstract, marked data-audit-status, that reads internal_errata through the AUDIT binding (counts for this slug, cached 1 h; never the text of an open finding) and paper_provenance (already read for the AI label), and says in plain words: how many findings are open and how many were answered, that the paper is fleet-generated with no human review recorded unless paper_provenance names a reviewer, and links to the record (/data/ai-science-failures) and to the reader-report form. The challenge queue already exists as the reader-report flow; do not build a second one. No score, no badge that claims quality.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-gateway/worker.js' || char(10) ||
 'code-anchor: async function handlePaperDetail(request, env, path, ctx) {' || char(10) ||
 'runtime-probe: {"url":"https://papers.qnfo.org/papers/twisted-cuprate-twistronics","status":200,"contains":"data-audit-status"}' || char(10) ||
 'code-probe: {"paths":["qnfo-gateway/worker.js"],"contains":"PAPER-AUDIT-STATUS-PAGE-1"}',
 'session:W2-I', 'code', 'medium', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.RSCH PAPER-AUDIT-STATUS-PAGE-1:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH PAPERS-MD-NEGOTIATE-1: a paper URL answers Accept: text/markdown with its markdown mirror and advertises it (RM-BS-PAPERS-AS-AGENTS-1 slice 2)',
 'QNFO.REACH; charter pillar reach; metric: ai_assistant_fetches_7d (fetch kind paper-md share) and answer_engine_referrals_7d; doer: qnfo-gateway via qnfo-code-orchestrator. Measured 2026-11-05 on https://papers.qnfo.org/papers/twisted-cuprate-twistronics: the .md mirror answers 200 text/markdown and /api/quickread/<slug>?q= answers from the paper text, but the HTML URL ignores Accept: text/markdown (returns text/html) and sends no Link rel=alternate to the mirror. AI assistants fetched 12,239 pages in the 7 days to 2026-11-04 (v_ai_reach_7d), almost all as HTML. Build: in handlePaperDetail answer a request whose Accept prefers text/markdown with the same body as handlePaperMarkdown (Vary: Accept, Content-Type text/markdown, x-markdown-tokens), and add Link: <.../papers/<slug>.md>; rel="alternate"; type="text/markdown" to the HTML response; keep the canonical Link on the .md. Cache keys must include Accept.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-gateway/worker.js' || char(10) ||
 'code-anchor: async function handlePaperMarkdown(env, slug, host) {' || char(10) ||
 'code-probe: {"paths":["qnfo-gateway/worker.js"],"contains":"PAPERS-MD-NEGOTIATE-1"}',
 'session:W2-I', 'code', 'medium', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH PAPERS-MD-NEGOTIATE-1:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH QWAV-CERTS-SERVE-1: serve the demo certificates at qwav.org/certificates.json and show a verified badge on the demo hub (RM-BS-QUANTUM-COMMONS-1 slice 2)',
 'QNFO.REACH; charter pillar research; metric: verified-demo share (docs/qwav-certificates.json verified_share, 7 of 8 on 2026-11-05) and engaged sessions on qwav.org; doer: qnfo-gateway via qnfo-code-orchestrator. Slice 1 added docs/qwav-certificates.json, generated by scripts/qwav_golden_crosscheck.py --write-certificates and held fresh by its test: per demo repository the status, the number of named quantity checks, the independent methods, what is certified, the replayed page sha256, and a standing line that nothing here certifies a quantum state, hardware result or advantage claim (the demos compute tree arithmetic, docs/QWAV-CROSS-SIMULATOR.md). Build: GET /certificates.json on the qwav.org host in qnfo-gateway serving that file (fetch https://raw.githubusercontent.com/QNFO/qnfo-workers/main/docs/qwav-certificates.json, cached 1 h, CORS *, the repository is public), and on the demo hub (renderQwavHTML) one badge line per demo that says verified, the number of checks, the method and the sentence what it does not certify, linking the JSON. The unread qwav-demos consolidation shows as not checked, never verified. Related and already filed: QWAV-DISCOVERY-1 (llms.txt, feed, sitemap, real 404s for qwav.org).' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-gateway/worker.js' || char(10) ||
 'code-anchor: function renderQwavHTML(host) {' || char(10) ||
 'runtime-probe: {"url":"https://qwav.org/certificates.json","status":200,"contains":"qwav-certificates/1"}' || char(10) ||
 'code-probe: {"paths":["qnfo-gateway/worker.js"],"contains":"QWAV-CERTS-SERVE-1"}',
 'session:W2-I', 'code', 'medium', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH QWAV-CERTS-SERVE-1:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.RSCH ATLAS-HF-MIRROR-1: mirror the open-data atlas as a Hugging Face dataset with the data card (RM-BS-OPEN-DATA-COMMONS-1 slice 3)',
 'QNFO.RSCH; charter pillar research; doer: program-manager:QNFO.RSCH. IDENTITY-BOUND: a Hugging Face dataset is created under the owner''s own Hugging Face account and needs a write token only the owner can mint (no token exists in the fleet); no session or loop may create that account or enter that token. Everything else is built by slice 1: the files, the data card and the manifest are public at the r2.dev address https://pub-426be63219f54be3932467bcbaf805f5.r2.dev/atlas/ai-science-failures/ so the upload is a copy. The card also needs the licence question settled (the papers are LicenseRef-QNFO-ULA-2.1, CC BY-NC-SA 4.0 plus supplemental terms; Hugging Face asks for a licence identifier). The public Iceberg catalog read with DuckDB-WASM (B11 W2, CF-B-26) is a separate slice and waits on whether anonymous catalog reads are allowed (unverified).' || char(10) ||
 'runtime-probe: {"url":"https://huggingface.co/api/datasets/QNFO/ai-written-science-failures","status":200,"contains":"ai-written-science-failures"}',
 'session:W2-I', 'code', 'low', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.RSCH ATLAS-HF-MIRROR-1:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH AI-REFERRAL-UTM-1: count answer-engine visits that arrive with utm_source and no referrer (RM-BS-PAPERS-AS-AGENTS-1 validity)',
 'QNFO.REACH; charter pillar reach; metric: answer_engine_referrals_7d; doer: qnfo-infra via qnfo-code-orchestrator. Validity gap in the series this migration starts: answer_engine_referrals_7d counts a referrer host (cf-rum-human). ChatGPT appends utm_source=chatgpt.com to the links it cites and some assistants send no referrer, so those visits read as direct in the series. The edge stream already carries the value: qnfo-gateway writes blob5 = utm_source on every human page load (reach-ae), but collectReachAe reads only blob2 host, blob3 path and blob4 referrer. Build: add a third read in collectReachAe, GROUP BY day, blob4, blob5 over rows with blob5 not empty, write them to reach_signals as entity_type ref-utm with entity_id <referrer or direct>|<utm_source> (the referrer rows keep their meaning), and in v_ai_reach_daily count a ref-utm row toward answer_engine_referrals_edge when its utm part is in ai_referrer_hosts and its referrer part is not (no double count with the referrer rows). Compare the edge and RUM figures for 14 days before changing which one the metric reads.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-infra/worker.js' || char(10) ||
 'code-anchor: async function collectReachAe(env) {' || char(10) ||
 'code-probe: {"paths":["qnfo-infra/worker.js"],"contains":"AI-REFERRAL-UTM-1"}',
 'session:W2-I', 'code', 'low', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH AI-REFERRAL-UTM-1:%' AND status = 'open');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:W2-I',
  'agent reads and answer-engine referrals must be one measured series before any investment in agent-facing surfaces is judged (B5 kill rule), and a public dataset of the fleet''s own failure record is the most direct reader value for B11',
  'REACH-COMMONS-1: ai_referrer_hosts, v_ai_reach_daily, v_ai_reach_7d, four metrics, one refresh trigger, two metric triggers, cause mappings and six follow-up issues; the collectors live in qnfo-infra 1.14.0',
  'seo_crawl_log 2026-10-29..11-04: 12,239 answered fetches by AI crawlers and assistants; reach_signals cf-rum-human referrers: 0 of 5,187 loads from an answer engine; Cloudflare bot_management read on the three zones: every AI-crawler setting disabled',
  'pending', 'qnfo-audit: one table, two views, four registry rows, one trigger on fleet_tick, two metric triggers, five issues; qnfo-infra: three fail-open collectors, one R2 binding',
  'the Rollback line of migrations/2026-11-05-reach-commons.sql; qnfo-infra: remove the REACH-COMMONS-1 block and the ATLAS_R2 binding',
  'ai-reach-series',
  'ai_assistant_fetches_7d reads about 12k and answer_engine_referrals_7d reads 0 within an hour of the first collector run; the ratio is the number B5 kill rule uses; atlas_export_age_h reads under 24 after the first daily export',
  'agent fetch and answer-engine referral series; open dataset of the fleet failure record (new public surface)',
  'node qnfo-infra/reach-commons.test.mjs; node migrations/reach-commons.test.mjs (SQLite fixture with the production table definitions); live: GET atlas manifest on r2.dev, D1 reads of v_ai_reach_7d and infra_state'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:W2-I' AND capability_gain = 'ai-reach-series');
