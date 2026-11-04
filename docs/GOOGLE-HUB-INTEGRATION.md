# Google, GitHub and Cloudflare as one system (GOOGLE-HUB-1)

Charter pillar: **reach**. Cloudflare is the hub: every Google or GitHub read is made by a
Worker with a service credential held as a Worker secret, so nobody signs in to OAuth.
Measured 2026-11-04.

## What is connected now

| Link | Mechanism | Evidence |
|---|---|---|
| Google Analytics 4 → Cloudflare | `GA4_SA_KEY` service account `ga4-reader@gen-lang-client-0589613911`, Data API, qnfo-fleet-dashboard `ga4Ingest` daily 02:00 UTC | `/api/ga4`: 137 rows for 2026-11-03; page `/analytics`, JSON `/api/ga4/overview` (2,519 active users, 28 days) |
| Search Console → Cloudflare | same key, scope `webmasters.readonly`, `gscIngest`, property `sc-domain:qnfo.org` | `/api/ga4` `gsc_runs`: 16 rows for 2026-11-01; **no reader page** (`/api/gsc*` 404) |
| Google Cloud → Cloudflare | `GCP_SA_KEY`, qnfo-cloud-ops hourly `gcp-inventory`, read-only; 48 APIs enabled in project 254457120993 | session-gcp-integration-1026 |
| GitHub → Cloudflare | canonical-deploy.yml calls qnfo-ops `/ops/deploy`; Quniverse Copilot agent reads Cloudflare through MCP | docs/GITHUB-CLOUD-QUNIVERSE.md |
| Cloudflare → search engines | IndexNow workflows, Zaraz GA4 tag | `.github/workflows/indexnow-*.yml` |
| GitHub security | CodeQL, Dependabot security updates, secret scanning + push protection all on | repo settings read 2026-11-04 |

## What is unused (free allowance not taken)

| # | Service | Free allowance | Status |
|---|---|---|---|
| 1 | Search Console view (queries, pages, countries, CTR, position, sitemaps) | API free, 1,200 queries/min | ingest only; page filed as GOOGLE-HUB-1 |
| 2 | URL Inspection API + sitemap status | 2,000 inspections/day/property | not used |
| 3 | PageSpeed Insights + CrUX API | free key quota | not used |
| 4 | GA4 → BigQuery export | BigQuery sandbox 10 GB storage + 1 TB queries/month | BigQuery not enabled in the project |
| 5 | Gemini API free tier | rate-limited free models | not a qnfo-ai fallback leg |
| 6 | Cloud Storage always-free (US regions) | 5 GB | no R2 backup mirror (continuity needs two providers) |
| 7 | GitHub Pages / Discussions / Projects | free on public repos | Pages and Discussions off on qnfo-workers |
| 8 | GitHub Actions | unlimited minutes on a public repository | already the CI runner |

Org plan is `free` with 10 private repositories; Copilot agent credits, not Actions minutes, are the
binding GitHub limit (see ASSIGN-COPILOT-ISSUES-1 in CLAUDE.md).

## Boundaries

- Service-account keys are lifted into Worker secrets only through the secret lock; this file never holds a value.
- Enabling a Google API or IAM role is an action in the owner's Google account: it is proposed with an `IDENTITY-BOUND:` card, one service at a time, read-only first.
- Personal data stays in `personal-api`; none of these feeds touch it.

## Next steps (each filed as an `agent_issues` row by migrations/2026-11-04-google-hub-gsc-overview.sql)

1. `/search` + `/api/gsc/overview` in qnfo-fleet-dashboard (code-task, claimed by the code loop on the file until its current task ends).
2. Rows 2-6 above, one per change, each with a `cloud_ops_events` kind as its proof.
