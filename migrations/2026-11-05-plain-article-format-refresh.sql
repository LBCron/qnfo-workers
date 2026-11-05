-- APPLY-BY: ci
-- DB: living-paper
-- Rollback: UPDATE plain_article SET body_len = (SELECT b.body_len FROM bak_20261105_plain_article_len b WHERE b.slug = plain_article.slug) WHERE slug IN (SELECT slug FROM bak_20261105_plain_article_len);
-- COST-GATEWAY-ARTICLE-1 data side (2026-11-05, charter pillar: cost; issue 1002025; metrics workers_ai_cost_30d_usd, fleet_cost_pace_30d_usd).
--
-- Why: qnfo-gateway articleFill rebuilds a Quick Read plain-language article whenever the paper's version or LENGTH(body_md) differs from the article's
-- version and body_len. Read from living-paper 2026-11-05 03:40Z: 352 of the 728 articles were stale, ALL 352 with the SAME version (version differs: 0) and a body_len that differs
-- by at most 20 percent from the paper's (348 by at most 10 percent): the PAPER-CANONICAL-1 format sweep (ops_config paper_format_state: 396 bodies repaired at 01:51Z, 120 more
-- in the sweep running at 03:31Z) rewrites headings, spacing and reference blocks of published bodies, which moves LENGTH(body_md) by a few percent and nothing else. Each rebuild
-- is a kimi-k2.6 write plus a gpt-oss-120b verify and repair: about 2.5k neurons and 10 an hour, 21k neurons an hour (500k a day, USD 5.5) of the account's 80 to 100k an hour.
-- What: for ok articles whose paper has the same version and a body length within 20 percent of the article's, record the paper's current length as the article's body_len, so the
-- article is no longer selected. No article text, grade, verdict or version is touched; an article whose paper is revised in content (another version, or a length change over 20 percent)
-- stays stale and is still rebuilt, newest first, exactly as before. The old lengths are kept in bak_20261105_plain_article_len (the Rollback line restores them).
-- The code side (a material-change rule in articleFill so the next format sweep does not repeat this) is the code task COST-GATEWAY-ARTICLE-1 (agent_issues 1002025).
-- Prediction: stale articles 352 to about 0 right after apply; qnfo-gateway kimi-k2.6 neurons from about 21k an hour to under 5k an hour within 2 hours (new papers and the next sweep's
-- over-20-percent cases only); the account about -450k neurons a day. Verify: SELECT COUNT(*) FROM plain_article a JOIN papers p ON p.slug = a.slug WHERE a.status = 'ok' AND
-- a.body_len IS NOT LENGTH(p.body_md); the Cloudflare meter hourly kimi-k2.6 line; SELECT COUNT(*), MAX(generated_at) FROM plain_article WHERE generated_at > datetime('now', '-1 hour').

CREATE TABLE IF NOT EXISTS bak_20261105_plain_article_len AS
SELECT a.slug AS slug, a.version AS version, a.body_len AS body_len, a.generated_at AS generated_at
FROM plain_article a JOIN papers p ON p.slug = a.slug
WHERE a.status = 'ok'
  AND a.version IS COALESCE(p.version, '')
  AND a.body_len IS NOT LENGTH(p.body_md)
  AND a.body_len > 0
  AND ABS(LENGTH(p.body_md) - a.body_len) * 100 <= a.body_len * 20;

UPDATE plain_article
   SET body_len = (SELECT LENGTH(p.body_md) FROM papers p WHERE p.slug = plain_article.slug)
 WHERE slug IN (SELECT slug FROM bak_20261105_plain_article_len)
   AND status = 'ok'
   AND version IS (SELECT COALESCE(p.version, '') FROM papers p WHERE p.slug = plain_article.slug);
