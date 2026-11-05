-- BLUESKY-2026-11 (2026-11-05, charter pillar reach): the ASK-CANONICAL-1 issue filed by migrations/2026-11-05-bluesky-roadmap.sql omitted that the canonical host is pinned on purpose by an existing test.
-- qnfo-ai-search/sitemap.test.mjs (added by PR 4117, "Publish canonical sitemap for ask WebMCP surface") asserts ask.qwav.tech as the canonical host for BOTH ask.qwav.tech and ask.qwav.org, and
-- the WebMCP verifier (scripts/webmcp-verify.mjs) and qnfo-gateway's Ask link also name the .tech host, so the change is a coordinated host move, not a one-line edit.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET description = substr(description, 1, instr(description, char(10) || char(10) || 'NOTE (BLUESKY-2026-11, 2026-11-05):') - 1) WHERE title LIKE 'ROADMAP-1: QNFO.REACH ASK-CANONICAL-1:%' AND instr(description, 'NOTE (BLUESKY-2026-11, 2026-11-05):') > 0;

UPDATE agent_issues
SET description = description || char(10) || char(10) || 'NOTE (BLUESKY-2026-11, 2026-11-05): the .tech canonical is pinned on purpose. qnfo-ai-search/sitemap.test.mjs (PR 4117) asserts https://ask.qwav.tech/ as the sitemap loc and the robots Sitemap line for both hosts, and scripts/webmcp-verify.mjs and the qnfo.org Ask link (qnfo-gateway) name the .tech host. Change them together in one PR: update that test to the .org constant, repoint the verifier and the gateway link, keep /api paths answering on both hosts, and add the 301 only after a probe shows ask.qwav.org answers 200 for / and /sitemap.xml. Also the cache key at https://ask.qwav.tech/__answer/ is a synthetic key, not a host dependency: leave it.',
    updated_at = unixepoch() * 1000
WHERE title LIKE 'ROADMAP-1: QNFO.REACH ASK-CANONICAL-1:%' AND status = 'open'
  AND instr(description, 'NOTE (BLUESKY-2026-11, 2026-11-05):') = 0;
