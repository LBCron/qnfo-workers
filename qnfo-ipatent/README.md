# qnfo-ipatent — Inventor Disclosure Assistant (ipatent.qnfo.org)

**Version:** 3.7.0 (2026-10-02; reach: example page, share card, byline, value check) · 3.6.x support map, latency · 3.5.1 page metrics · 3.5.0 private by default, findable, honest copy · **Worker:** qnfo-ipatent · **Live:** https://ipatent.qnfo.org
## Purpose
Free experimental US-provisional patent disclosure drafting assistant, grounded in the
QNFO/QWAV patent corpus (33,500+ semantic segments). Turns an inventor description into
an 8-section USPTO-style draft with claims, using RAG over the ipatent-corpus Vectorize
index and a Workers-AI drafting model.

## What v3.4 added (adaptive, IP-domain suggestions — SUGGESTION-DOMAIN-1)

**v3.4.1:** clean technical-field taxonomy on the public suggestion surface — internal corpus
folder labels (`99_Brutal_Cleanup`, `Early_Drafts_202507`) are mapped to clean USPTO-style
fields via `cleanField()` on `/api/suggest` + `/api/idea` display surfaces (SOFT-N3 closure).

**v3.4.2:** prior-art closeness warning on /api/draft + result banner - when the description scores >=0.80 against an existing corpus filing, the response carries prior_art (flag/top_title/top_score/section) and the UI shows an amber PRIOR-ART CLOSENESS WARNING.
- `GET /api/suggest` — adaptive suggestion endpoint, IP-domain only:
  - `field` param → technical-field completions from `FIELD_SUGGESTIONS`.
  - empty `q` → rotating corpus examples (light metadata) for starter chips.
  - `q` ≥ 3 chars → `similar` corpus filings (embed + Vectorize search) for
    type-ahead "WHILE YOU TYPE" guidance.
  - Personal/ops actions (email, tasks, reminders, social) are NEVER suggested.
- `GET /api/idea?i=N` — deterministic example load by index (was random-only).
- Landing page: STARTERS chips (corpus examples, load into the form for editing),
  WHILE YOU TYPE corpus-guidance strip, and a Technical Field datalist.

## What v3.5.0 changed (pillars: security, reach)
- **PRIVATE-BY-DEFAULT-1.** An unfiled invention is confidential: a public listing of it is a pre-filing disclosure
  (fatal to novelty under EPC Art. 54). Nothing is stored unless the inventor ticks "keep a private copy"; a private
  draft writes only a metadata row (`title = '[private]'`, empty text) so the rate limit still counts. Every new row
  stores a salted SHA-256 of the IP, never the raw IP. Submission ids use `crypto.getRandomValues`.
- **DISCLOSURE-LIST-CLOSED-1.** `/api/disclosures` needs `X-Admin-Token` (secret `IPATENT_ADMIN_TOKEN`; 404 when unset).
  `/api/status` no longer lists recent titles. A saved draft is reachable only by its capability link `/d/<id>` (noindex).
- **CANONICAL-HOST-1.** `qnfo.org/ipatent*` pages 301 to `ipatent.qnfo.org` (they served a 200 duplicate);
  `/ipatent/api/*` still answers. HEAD is answered on pages.
- **FINDABLE-1.** `/robots.txt`, `/sitemap.xml`, canonical, Open Graph, JSON-LD (WebApplication, Article) with the
  ORCID author, and an indexable `/guide` (what a provisional protects, what to include, fees, pre-filing secrecy).
- **SUPPORT-GAPS-1.** Drafts end with a ninth section listing under-described features, needed drawings and statements
  that go beyond the inventor's text — the 35 U.S.C. 112(a) support problem a provisional exists to solve.
- Copy now matches the record (STRATEGY-1 s2): no "real filings", "defensible", "zero-cost", stale model name or
  `ipatent.me`; the corpus is described as the author's own draft disclosures. Download (.html) and print buttons.

## What v3.5.1 added (PAGE-METRICS-1, pillar reach)
iPatent had no pageview measurement. Each GET of `/` or `/guide` adds 1 to `page_views(day, path, source)` where source is
`search`, `qnfo`, `referral`, `direct`, `internal` or `crawler` (user-agent heuristic). No IP, user agent, cookie or
referrer URL is stored. `GET /api/metrics` serves 7d and 30d aggregates (views by source, guide views, drafts, saved
drafts, distinct drafters); qnfo-fleet-control IMPROVEMENT-LOOP-1 (SURFACE-METRICS-1) reads them hourly into
`metric_registry` as `ipatent_human_views_7d`, `ipatent_search_visits_7d`, `ipatent_crawler_hits_7d`, `ipatent_drafters_7d`.

## What v3.6.0 added (pillar: reach; the audit's phase 2, first slice)
- **SUPPORT-MAP-1.** Every claim element is matched, deterministically and at no model cost, to the numbered paragraph
  that shares most of its distinctive terms: supported (>= 60%), weak (>= 35%) or unsupported, with the terms not found.
  Shown under the draft and in the document. It checks wording, not legal sufficiency.
- **Numbered paragraphs.** Field, background, summary and detailed description are numbered [0001]... in USPTO style
  (Patent Center flags specifications without paragraph numbering).
- **COMPLETENESS-METER-1.** While typing: problem, parts, how it works, concrete values, alternatives, figures, length.
  Advisory, never blocking.
- **COST-GUARD-1.** At most 150 drafts in 24 hours across all users (the per-IP limit did not bound the total).
- **INDEXNOW-1.** `/<key>.txt` proves ownership for IndexNow (Bing, Yandex, Seznam, Naver; not Google).

## What v3.7.0 added (pillar: reach)
- **EXAMPLE-1:** `/example` renders one real, unedited run (2026-10-02, gpt-oss-120b, 39 s) with the live support map and
  the five things the run invented. It is the honest demonstration and the page to share.
- **VALUE-CHECK-1:** a number in a claim element that appears nowhere in the specification makes the element unsupported
  (the live run's invented 0.5 to 2.0 N·m torque and Shore A 40 to 60 are now caught).
- **Share card** `/og.jpg` (1200x630) on every page; share links (LinkedIn, Bluesky, X, email) with UTM tags.
- **Byline and contact:** the author, ORCID and a "Work with me" link (qnfo.org/work-with-me, UTM-tagged) on the landing
  page, the guide, the example and under every draft.

## What v3.8.0 added (pillar: reach)
- **SUBSCRIBE-1:** a subscribe box on the landing page posts to `/api/subscribe`, forwarded to qnfo-subscribers (double
  opt-in, honeypot, its own rate limit) with source `ipatent`, the same path as qnfo.org.
- **LLMS-1:** `/llms.txt` describes the tool, its pages, its limits and the contact path for AI answer engines.

## Endpoints
| Route | Method | Purpose |
|---|---|---|
| / | GET | Landing UI |
| /api/draft | POST | Draft disclosure (rate-limited 20/hr/IP) |
| /api/suggest | GET | Adaptive IP-domain suggestions |
| /api/idea?i=N | GET | Corpus example (random or by index) |
| /api/search?q= | GET | Corpus semantic search |
| /api/disclosures | GET | Submissions list (X-Admin-Token only) |
| /guide | GET | Provisional application guide (indexable) |
| /robots.txt, /sitemap.xml | GET | Crawl surface |
| /d/:id | GET | Saved draft by capability link (noindex) |
| /api/submission/:id | GET | One saved submission (private drafts 404) |
| /api/status | GET | Version/model/stats |
| /api/metrics | GET | 7d/30d aggregate page and draft metrics (no personal data) |
| /register | GET | Open register of defensive publications: disclosures whose inventors chose to publish them (REGISTER-1, 3.21.0) |
| /register/:slug | GET | One published disclosure: og tags, cite-as line, SHA-256 fingerprint; 410 after withdrawal |
| /register/publish, /register/withdraw | GET | The consent form and the withdrawal form (noindex) |
| /api/register, /api/register/:slug | GET | The register as JSON (no personal data) |
| /api/register/publish | POST | Publish a saved draft: needs `consent: true` and the current `consent_version`; returns a withdrawal code once |
| /api/register/withdraw | POST | Withdraw with the withdrawal code or the private link; removes the text |
| /api/register/takedown | POST | Remove a record (X-Admin-Token only) |
| /api/cost | GET | Measured model cost per completed draft, 30 days, from qnfo-audit `ai_call_counters` (neurons, tokens, USD at the published neuron rate). A cost, not a price |

## Deploy
- Canonical source: `QNFO/qnfo-workers/qnfo-ipatent` (restored 2026-09-03 from the
  deployed v3.3 bundle; this directory is the canonical repo home).
- `wrangler deploy` from this directory (wrangler.toml reproduces the live binding set:
  D1 `IPATENT_DB` ipatent-db, R2 `IPATENT_R2` ipatent, Vectorize `DISCLOSURES_VZ`
  ipatent-corpus, AI).
- Verify after deploy: `/health` version + `/api/status` bindings true.
- Live custom route: ipatent.qnfo.org (verified). qnfo.org gateway 301s /ipatent here.

## Drafts state only what the inventor supplied (IPATENT-GROUND-1, 3.16.0)

Owner directive 2026-10-10. The disclosure prompt carries process and style only:

- Background uses only the inventor's text; a statement about existing approaches must be the inventor's and is labelled
  "(Stated by the inventor; not verified against the prior art.)". The prompt asks for no novelty statement and no claim category
  the description does not support.
- Retrieved disclosures reach the prompt as section headings only (`ipStructureReference`): no title, field or text.
- The inventor declaration is a fixed text that makes no statement of novelty.
- After drafting, `ipGroundSections` checks the draft against the inventor's text (title, field, description, mechanism card): a
  Background sentence the text does not support is removed; a sentence with a figure, DOI, link, author citation or novelty word the
  inventor did not give is removed; a claim reciting such a figure is removed with its dependents; each removal is listed under
  SUPPORT GAPS so the inventor can supply the detail and redraft.
- `IDEA_BANK` (prefilled example inputs for the form) and `EXAMPLE_SECTIONS` (the static /example page) are demonstration content
  shown to people; neither is sent to a model.

Suite: `node qnfo-ipatent/ground.test.mjs`.

## What v3.21.0 added: the open register of defensive publications (REGISTER-1, RM-BS-DEFENSIVE-PUBLICATION-1; pillar research)

A defensive publication puts an invention into the public record so nobody can patent it later. The register publishes a saved draft only after an
explicit, recorded consent:

- The holder of a draft's private link opens `/register/publish`, sees a preview of what will be published (title, length, start of the text), reads the
  consent text and ticks a box that is never pre-ticked. The server stores the exact consent text, its version (`dp-consent-1`) and the time with the
  record. A stale version or `consent` other than `true` is refused.
- Only the draft's disclosure text is published: never the print version (it carries the inventor's e-mail), never the inventor's name unless the person types
  a name to show. Drafts that were not saved, private drafts and automated drafts cannot be published; a text under 400 characters or with more than five links is refused;
  at most 30 new records in 24 hours.
- Each record has its own address `/register/dp-xxxxxxxxxx` (a random id; the private draft id is never shown), og tags, JSON-LD, a cite-as line and a SHA-256
  fingerprint of `iPatent-DP-v1`, LF, title, LF, text. The date is this server's clock, not a notary's.
- Withdrawal (the withdrawal code shown once, or the private link) blanks the text, title and name and keeps the id, dates, fingerprint and consent record; the page then
  answers 410 and leaves the sitemap. An admin takedown (`X-Admin-Token`) does the same with a recorded reason.
- Storage: table `public_disclosures` in `ipatent-db`, created lazily by the first publish (`CREATE TABLE IF NOT EXISTS`); reads treat a missing table as an empty register.
- Limits: the register can check only that the person holds the private link, so it cannot prove they are the inventor (the consent text says so). No DOI is minted
  yet; that is a separate, consented step. Not legal advice; not a filing; nobody checks a published text.

Suite: `node qnfo-ipatent/register.test.mjs`. Phone journey: `scripts/ux-journeys/apps/ipatent.journeys.mjs`.
