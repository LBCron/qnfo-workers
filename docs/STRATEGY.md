# QNFO unified strategy (STRATEGY-1)

Version 1.12, 2026-10-06 (1.12: core prompt rule 8 is deleted, RULE-8-RETIRED-1: the fleet sets its own spend caps and may delete data on its own, recorded with evidence; suppression, opt-out, outreach consent and cadence caps and the personal/research separation stay, section 5; 1.11: AI spend caps steer model choice and never stop work, BUDGET-SOFT-ROUTE-1, section 5; 1.10: research code as a reach channel and the research line widened to AI, systems and formal mathematics, CODE-REACH-1, `docs/CODE-REACH-PROGRAM.md`, sections 2.3 and 7; 1.9: the owner's standing grant OWNER-STANDING-GRANT-1 to retire low-value workers, delete unused stores after a verified backup and switch to cheaper models without an owner card, sections 5 and 9; 1.8: iPatent promoted to the QNFO flagship tool on owner direction, sections 2.1, 2.4a, 3, 5 and 7, and the social cadence counted from the 2026-10-01 reset; 1.1: owner delegation of social accounts, section 5; 1.2: plan status at closeout, section 10.1; 1.3: LinkedIn publishes from the Buffer queue, GA4 and Search Console retired as fleet sources; 1.4: owner queue delegation, section 5; 1.5: the 31 October grants submitted on owner direction, section 5; 1.6: funder replies watched by the fleet, applications use the qnfo.org address, section 5; 1.7: the fleet measures and improves its own effectiveness: the distribution and outreach learners, the reward they can actually measure, and inbound mail answered within 72h, section 6.4). **This is the single source of truth** for identity, positioning, audiences, channels, outreach,
signals, KPIs, portfolio and business objectives. Where any other document disagrees, this one wins; section 11 lists every
conflict it resolves. Owner directive behind it (2026-10-01): *audit the front end and outreach, unify identity and strategy,
automate distribution across all channels, maximise reach and prestige, and manage the portfolio and its ROI.*

---

## 1. Where we are (measured 2026-10-01)

| Signal | Value | Source |
|---|---|---|
| Pageviews, 30d | 5,930; but 40-180/day for the last 10 days vs 400-630/day peaks mid-September (run rate about 3,000/30d) | CF Web Analytics RUM via fleet.qnfo.org/roi |
| Impressions gate | registry says `+394% MET`; growth vs the 5,610 baseline is **+5.7%** (gate +30%). The +394% compares against a prior window that appears incomplete | `metric_registry.impressions_growth_30d` vs the dashboard ROI view |
| Bluesky (owner's personal account) | 42 followers, 1,403 posts; last 10 posts 0 likes, 1 repost; 7 of 10 carried a mis-encoded dash; most were off-topic q08 essays | public AppView API |
| Cold email | 318 sent, 13 replies (4.1%); one fixed subject, no opt-out, fake `Re:` follow-up | `outreach_log`, `qnfo-cloud-ops` |
| External citations | 2 (OpenAlex, 63 DOIs) | `citation_stats` |
| Subscribers | 1 confirmed, 2 unconfirmed | `subscribers` |
| Revenue and cost | $0 revenue. Gateway-metered AI about $173/7d against the $150/30d unified-billing cap (#1683; BYOK providers bypass it). Total fleet cost about $725/month on 2026-09-26: Cloudflare plan about $200, direct DeepSeek/Anthropic keys about $400-500 with no limit or visibility, AI Gateway about $110-170 | business plan, backlog, `objectives.cost-ceiling` |
| Analytics | GA4 `G-LV7RHRVW6R` collected, never read; engagement stored but never acted on; posts not joinable to their results | outreach/analytics audit |

**Diagnosis.** Output is high and attention is low because the system optimised *volume* (papers, posts, emails), which reads
as noise, under an identity that changes from page to page. Reputation is the asset; volume without a clear, credible identity
spends it. The strategy below trades volume for **a few strong works, one identity, honest distribution, and a closed
measurement loop**.

---

## 2. Unified identity

### 2.1 Architecture
| Layer | Name | Role | Rule |
|---|---|---|---|
| Person (the face) | **Rowan Brad Quni-Gudzinas** | author of record on every work, voice of LinkedIn/Bluesky/email | citation form `Quni-Gudzinas, R. B.`; ORCID `0009-0002-4317-5604` on every page and record |
| Imprint (publisher) | **QNFO** | the independent research imprint that publishes the work (qnfo.org, papers.qnfo.org) | written `QNFO`. Never "Research Foundation", "Quniverse Research Foundation", "Research Collective", "Research Program" or "QNFO/QWAV open research group": there is no legal entity and the work is one researcher with an AI-assisted pipeline, so those labels overclaim |
| System | **Quniverse** | the name of the autonomous cloud research system (the worker fleet) | used only when talking *about the system* (e.g. the fleet-lessons paper); never an organisation name |
| Parked commercial label | **QWAV** | reserved for a future product or service | not used in bios, outreach or paper metadata until a product exists; QWAV sites use the shared design system with an indigo accent (owner decision 2026-10-02, superseding 2026-08-31) but do not carry the outreach |
| Separate publication | **q08** | long-form essays on technical-industry friction at q08.org | **not** distributed through the owner's personal accounts; its own RSS/digest only (section 7.3) |
| Tool | **iPatent** (ipatent.qnfo.org) | the QNFO flagship tool: free, private-by-default US provisional drafting with a claim-support map | **promoted** (owner direction 2026-10-02, section 2.4a); `ipatent.me` has no DNS and is not cited |

### 2.2 Positioning
**Canonical profile copy lives in the owner's Identity doc**, not here. Since 2026-10-01 it is stored in Cloudflare D1
(the private `qnfo-identity` D1, table `owner_docs`, key `identity`, bound only to the dashboard) and served and edited
behind the owner's login at fleet.qnfo.org/owner; it holds personal data, so it is
never committed to this public repo. Owner directive 2026-10-01: all data on Cloudflare, nothing dependent on claude.ai
(sections "Your brand", "Profile copy, ready to paste", "Updated CV"). It is the owner's approval surface (tracker item 1,
due 2026-10-07) and the owner's edits win. This file keeps only what the fleet needs, and must not drift from it.

**Person-level identity (from the Identity doc, pending owner approval):** a builder of trustworthy research systems:
15+ years turning national data into public decisions (U.S. Federal Highway Administration; AARP Public Policy Institute,
Livability Index), now building open, auditable AI-assisted research at QNFO. That verifiable career record is the
credibility anchor; the research sits under it, not on top.
> Headline: Research systems builder · Founder, QNFO: open, auditable AI-assisted research · 15 years of national data and policy research (FHWA, AARP Livability Index)

**Research line (what the work asks):** what computation really costs and delivers: energy per correct answer (JPCUB),
what an AI-assisted claim is worth (ignorance audits), and what an autonomous research system actually delivers.

**Names:** one name everywhere, Rowan Brad Quni-Gudzinas; earlier work appears as Brad Gudzinas / Bradley Gudzinas and
some profiles as Rowan Quni, so those go in "also known as" fields wherever a platform allows (that is what links the FHWA
and AARP record to the same person). Affiliation string everywhere: `QNFO (independent research)`.

**Claims we never make** (a background check fails on them; Identity doc "What to stop signalling"): patents without
application numbers, "clearance-eligible", unlinked media features, shifting publication counts, physics headlines such as
"thermodynamic dead end". Fleet size is stated as deployed workers (44 on 2026-10-01), never the repo directory count.

### 2.3 Research pillars, in the order we lead with them
1. **Energy-honest computing (JPCUB)**: the lead. Concrete, falsifiable and relevant to industry and academia.
2. **Epistemics of AI-assisted science**: ignorance audits and epistemic legibility.
3. **Autonomous research operations**: what a 40-worker autonomous research system delivers, at what cost, with a failure ledger.
4. **Ultrametric programme (theory)**: stays published and indexed, but is **not** used in outreach or headlines until a
   falsifiable test result exists. Speculative unification claims led with in public cost credibility with physicists.

**Breadth and code (CODE-REACH-1, 1.10, owner direction 2026-10-06).** The research line is not quantum-only: AI agents and
their epistemics, AI research about AI research (metascience of AI-assisted science), systems, and mathematics with formal
verification are in scope. Measured 2026-10-06, AI and epistemics papers draw 83 human views each against 45 for quantum
(`paper_index`). Every pillar ships code where a claim can be run or proved: paper companions that reproduce or test a
numbered claim, standalone tools, and Lean 4 formalizations, each tested in CI and carrying claim, test and status
(`docs/CODE-REACH-PROGRAM.md`, `research-code/`). A companion that finds its paper wrong goes to the errata path the same
day (first case: `AGENTIC-COLLAPSE-REPRO-1`).

### 2.4 Selected works (the only papers outreach and headlines lead with)
| # | Work | Where | Why it leads |
|---|---|---|---|
| 1 | The Joules-per-Solution Metric: Definition, Measurement Protocol, and Anti-Gaming Provisions | papers.qnfo.org | the standard itself |
| 2 | Error Correction Is a Landauer Machine: The Thermodynamic Floor of QEC Overhead | papers.qnfo.org | most-viewed of the top papers; crisp claim |
| 3 | JPCUB Competitive Landscape v2.0 (17 platforms) | papers.qnfo.org | the comparison people share |
| 4 | Joules-per-Solution for Stochastic and Agentic Inference (LLMs) | papers.qnfo.org | bridges quantum and AI audiences |
| 5 | The Universal Ignorance Audit | papers.qnfo.org | method others can use |
| 6 | Epistemic Legibility in AI-Assisted Science | papers.qnfo.org | governance angle for the AI-for-science audience |
| 7 | Operating the Quniverse Fleet: Objectives, Successes, Failures, Roadmap | papers.qnfo.org | the practice story; honest failure ledger |

### 2.4a Flagship tool (owner direction 2026-10-02: "iPatent is an excellent marquee for QNFO")
iPatent (ipatent.qnfo.org) is the one QNFO tool that outreach and headlines lead with, beside the selected works. It is
the applied form of pillar 2: an AI drafts a provisional, and the tool shows which claims the description does not
support. Lead with `/example` (a real run and the five things it invented), then `/guide`. Claim, test and status
for every post: *Claim: an AI-drafted provisional is only as good as what its description supports. Test: iPatent flags
every claim element and value the description never backs up; a real run invented a torque range and a material, both
flagged. Status: free, experimental, not legal advice.* Never claim legal sufficiency, patentability or "defensible".
Measured by `ipatent_human_views_7d`, `ipatent_search_visits_7d` and `ipatent_drafters_7d` (metric_registry).

The full corpus stays in the library (papers.qnfo.org) for search. Counts are never the headline ("1,000+ publications" goes);
the funding strategy's own "volume trap" warning applies.

### 2.5 Visual and editorial
- Design system: QDS-1, `qnfo-web-unified/README.md` (one stylesheet at qnfo.org/qds.css; Newsreader + Familjen Grotesk; accent by brand: QNFO teal, QWAV indigo, q08 rust; light and dark). Owner decision 2026-10-02, superseding the 2026-08-31 paper-and-ink system.
- Licence (LICENSE-ONE-1, decided 2026-10-02 at the owner's request): every QNFO paper is released under QNFO-ULA v2.0 (https://legal.qnfo.org/: CC BY-NC-SA 4.0 plus the QNFO supplemental terms). Published records declare `cc-by-nc-sa-4.0` and carry a LICENSE file naming `LicenseRef-QNFO-ULA-2.0`; a paper's JSON-LD names its own recorded licence. Code: QNFO-ULA v2.1 adds Software Terms (section 12) because Creative Commons licences are not written for software; same tenets, source-available, never called open source (`docs/license/`, posted on `QNFO/license` by the owner). Versions already released under CC BY 4.0 (48 rows on 2026-10-02) keep that grant, which cannot be withdrawn.
- Every public page: title, description, canonical, viewport, OpenGraph + Twitter card, JSON-LD (Person with ORCID `sameAs`
  on profile pages, ScholarlyArticle with author ORCID on paper pages), GA4 and the Cloudflare beacon, subscribe CTA.
- No internal jargon on public pages (worker counts, guard names, ticket tags).
- AI disclosure on every work: *Prepared with an AI-assisted research pipeline; the author is responsible for the content.*
- Every paper and every post about it carries three lines: the **claim**, the **test**, and the **status** (hypothesis,
  tested, estimate or retracted) (Identity doc, "How people should read the research").
- Text sent outside the system uses ASCII-safe escapes for typographic characters (the `â` defect).

---

## 3. Audiences and what each should do
| Audience | Where they are | What we want them to do | Lead content |
|---|---|---|---|
| Quantum-computing researchers and engineers | arXiv, LinkedIn, Bluesky, conferences | cite JPCUB, contribute measurements, invite a talk | works 1-3 |
| AI-for-science / metascience researchers | Bluesky, LinkedIn, LessWrong, workshops | use the ignorance audit, cite, collaborate | works 5-6 |
| Engineering leaders and practitioners | LinkedIn, Hacker News | follow, subscribe, commission an assessment | works 4 and 7 |
| Funders (NLnet, Emergent Ventures, Foresight, LTFF) | applications, referrals | fund | the dossier, works 1 and 7 |
| Science and tech journalists | email, LinkedIn | quote, cover | JPCUB landscape, LLM energy |
| Independent inventors, makers, startup founders, tech-transfer offices, patent practitioners | Hacker News, Reddit, LinkedIn, search | use iPatent, share the example, commission a review or a team version (qnfo.org/work-with-me) | iPatent `/example`, `/guide` (2.4a) |

---

## 4. Channels

| Channel | Role | Voice | Cadence | Integration path | Status |
|---|---|---|---|---|---|
| qnfo.org + papers.qnfo.org | home of record; every post links here | QNFO | continuous | owned (qnfo-gateway) | live; SEO fixes in PAPER-PAGE-SEO-1 |
| Email digest | the owned audience | Rowan | monthly research note (replaces weekly auto-digest once 10+ subscribers) | qnfo-subscribers | live, 1 subscriber |
| LinkedIn (personal profile) | primary professional channel | Rowan | 2-3 posts/week; flagship document posts | the fleet writes each post into the Buffer queue and Buffer, the account's authorised publishing app, publishes it (owner delegation 2026-10-01, section 5); `pipeline_flags.linkedin_mode=draft` switches back to one-tap approval | connected in Buffer; checked daily in `social_channels` |
| Bluesky | research community | Rowan | 1-2 curated posts/week (Identity doc tracker item 10), research only | direct AT Protocol, automatic once the owner approves the voice | live; q08 removed from it |
| Mastodon | academic mirror | Rowan | mirror of Bluesky | via Buffer, automatic | not connected |
| Threads | general-audience mirror | Rowan | mirror of Bluesky | Threads API (free; per-post views) or Buffer, automatic | not connected |
| X | low priority mirror | Rowan | at most 2/week | via Buffer; X API is pay-per-use ($0.20 per post with a link) | not connected |
| Cold email | warm conversations with researchers and journalists | Rowan | at most 8/day across both engines | qnfo-outreach + qnfo-cloud-ops | **paused** until OUTREACH-CONSENT-1 deploys, then resumed |
| Facebook | personal | Rowan | none | none: one Intro line and one link to qnfo.org, set by the owner | personal; no automation |
| Funders, employers, applications | career and funding | Rowan | as leads arise | drafted by the fleet in the Identity doc; **the owner sends or submits** (forms with CAPTCHA, signatures). The fleet never drafts for a recipient that asks for the applicant's own writing (FRI's form: "using only your own writing, without the use of AI tools or outside assistance") | weekly review (Mondays) |
| arXiv | prestige and discoverability for works 1, 2, 4 | Rowan | as ready | submitted by hand; since 2026-01-21 a new author needs a **personal endorsement from an established arXiv author in the field**, so ask one warm contact individually (never a mass request) | prepare packages |
| Conferences / workshops | credibility events | Rowan | per deadline | owner submits; fleet tracks deadlines (radar-hub) | track |
| Hacker News, LessWrong, Reddit | high-reach communities | Rowan | occasional | **manual only**: their norms penalise automated posting | owner posts when a work fits |
| Google Scholar | where citations are counted | Rowan | continuous | papers.qnfo.org paper pages are the way in. They need `citation_title`, one `citation_author` per author, `citation_publication_date`, and an absolute `citation_pdf_url` in the same directory (searchable PDF, 5 MB max), reachable within 10 links of the home page, not blocked by robots or bot challenges | citation tags present; `citation_pdf_url` missing |
| ORCID | scholarly identity | Rowan | on change | owner adds the selected works with ORCID "Search & link" (DataCite). DataCite auto-update is **not** enabled: it would add every work and repeat the volume problem | owner action |

Posting rules that apply to every social channel: native text first, one link (UTM-tagged), no hashtag walls, no engagement
bait, no following/liking automation, and never more than the cadence above.

Channel facts verified 2026-10-01 (re-check before relying on them): LinkedIn API Terms 3.1
(linkedin.com/legal/l/api-terms-of-use); LinkedIn member post statistics and Community Management access
(learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics); "Share on LinkedIn" tokens last
60 days with no self-serve refresh; Buffer API and limits (developers.buffer.com/guides/api-limits.md, post-metrics.md);
Bluesky bot guidance (docs.bsky.app/docs/starter-templates/bots); X pricing (docs.x.com/x-api/getting-started/pricing);
Threads insights (developers.facebook.com/docs/threads/insights); Scholar inclusion (scholar.google.com/intl/en/scholar/inclusion.html);
arXiv endorsement policy (blog.arxiv.org/2026/01/21/attention-authors-updated-endorsement-policy/). Substack and Medium have
no usable posting API.

---

## 5. Owner-voice governance (amends AUTONOMY-DECISION-POLICY)

The 2026-10-01 directive authorises the system to publish and send **as the owner**. That moves owner-voice publishing from
"Never" to **gated T1**: the system decides and executes inside these gates, and records each act.

**Automatic (inside the gates):**
- posts that summarise or announce the owner's own published works (section 2.4 first) and the flagship tool (2.4a);
- the scheduled cadence in section 4;
- first-contact research emails and one follow-up under the consent rules below;
- the subscriber digest/research note.

**LinkedIn (LINKEDIN-OWNER-DELEGATED-1, owner direction 2026-10-01 21:35Z, "fix permanently on your own"):** the fleet
never calls LinkedIn's API. It adds each post to the Buffer queue, and Buffer, the app the account holder authorised for
this account, publishes it, inside the same cadence cap, pause flag and content gates as every other channel. LinkedIn's
API Terms 3.1 bind developers of LinkedIn API apps; the residual risk (LinkedIn may still limit an account it judges
automated) is held down by the 2-3/week cadence and the content gates, and `pipeline_flags.linkedin_mode=draft` restores
one-tap approval at once. Bluesky (bots and scheduled posts are welcome if interactions stay opt-in), Mastodon and Threads
allow automatic posting inside the gates below.

**Owner delegation of social accounts (2026-10-01, OWNER-DELEGATION-SOCIAL-1):** the owner directed "automatically manage
all my social media accounts, including LinkedIn ... I will not provide any manual action or intervention". Inside the
platform rules above that means: the Bluesky bio follows the approved short bio automatically (qnfo-social PROFILE-SYNC-1;
a later hand edit the fleet does not list as superseded is still left alone), and Bluesky posting runs inside the cadence
gates. LinkedIn, X and Mastodon are connected in Buffer and post from its queue (LinkedIn: see above); Threads stays
unconnected until the account holder signs in to Buffer once, Facebook has no API for a
personal profile, and an application that asks for the applicant's own writing is not drafted. Those items stay in the
owner queue with the default in effect stated, and are not re-asked.

**Owner queue delegation (2026-10-01, OWNER-QUEUE-DELEGATION-1):** the owner then directed "manage the rest of my owner
queue automatically too". Each card was decided on the evidence the fleet can read, and the decision is the card's
resolution. Standing decisions:
- An application is submitted in the owner's name only on the owner's explicit direction for that application. FRI is not
  applied to (its form forbids AI help); NLnet Restack stays a draft (its budget is the owner's own hours, and NLnet requires
  a full GenAI prompt log). The two 31 October grants were submitted on the owner's direction of 2026-10-01 ("submit the
  31 Oct grant applications automatically too"): Foresight AI for Science & Safety Nodes (area 2) and the Corrigibility
  Research Fund via Lightcone Commons (`funding/GRANTS_2026-10-31.md`). Every application the fleet submits keeps four
  rules: AI drafting is disclosed; no reference is named without that person's consent; no in-person, travel or salaried
  commitment the owner has not made; budgets use measured costs. Maryland teaming and the arXiv endorsement are not pursued.
- Funder replies are watched by the fleet, not by a person (GRANT-FOLLOWUP-1, qnfo-cloud-ops, twice a day): a reply to a
  submitted application becomes an `agent_issues` row. The fleet reads rowan.quni@qnfo.org mail (`qnfo-audit.emails`); it
  cannot read the Gmail inbox, because no Gmail app password is stored (`GMAIL_PASS` absent since 2026-09-30). So every
  application from now on gives rowan.quni@qnfo.org as its contact address and account login. The one exception on record
  is the Lightcone Commons application (account rwnquni@gmail.com, agent_issues 1750), whose replies the fleet cannot see.
- The 13 US provisional patent applications are not converted: conversion needs the inventor's signed declaration and
  USPTO fees. Public copy makes no patent claim; where a form asks, "13 US provisional patent applications (2025)".
- Empowering Change is shown as a prior nonprofit (2023-2024), not a current entity, so leads that need an active
  501(c)(3) stay off the shortlist.
- CV facts: QNFO since 2024 (OSF, ORCID agree); public email rowan.quni@qnfo.org; PMP and AICP shown with the
  year earned and never called active; Amsterdam; no work-authorization line in the public CV.
- Profile fields that only the owner's own sign-in can edit (LinkedIn profile, ORCID, Google Scholar, ResearchGate, SSRN,
  the X profile, Facebook) stay as they are; posting through Buffer is section 4. Reach is measured with Cloudflare Web
  Analytics (GA4 and Search Console are retired as fleet sources, 1.3).
- The Cloudflare API token is not rotated by the fleet: the exposure review (agent_issues 1676) found it only in private
  configs, and the publicly exposed endpoint keys were rotated and return 401.
- The weekly identity review keeps recording findings but files no re-ask card while `pipeline_flags.owner_queue_delegated`
  is `1` (qnfo-fleet-dashboard IDENTITY-WEEKLY-DELEGATED-1). Other loops still file a card for a need that is genuinely new.
- **Standing grant (2026-10-05, OWNER-STANDING-GRANT-1).** The owner directed: "I don't want the 'safest' choice. I want
  bold autonomous systems that think and act entirely on their own", and granted that the fleet may retire idle or
  low-value workers, delete unused databases after a verified backup, and switch to cheaper models on its own, without
  owner cards. The conditions are charter decision rule 9: a dependency check (not idle proof) before a retirement and a
  stop at the first real dependent; verified table copies plus an R2 dump read back by SHA-256 before a database is
  deleted; a per-request fallback and an automatic revert on a model switch. Recorded as
  `pipeline_flags.owner_standing_grant` = `2026-10-05`. First uses: `jnl-audit` deleted after verified copies (#1822),
  `qnfo-venue-radar` and `qnfo-signal-loop` retired (#1756), the twin moved to glm-5.3-flash (#1818). Since
  RULE-8-RETIRED-1 (owner directive 2026-10-06: rule 8 is deleted) the fleet sets its own spend caps and records why;
  a breached AI spend cap moves work to the cheapest capable model and never stops it (BUDGET-SOFT-ROUTE-1).

**Never automatic (draft only, or not at all):**
- any change to the owner's name, CV or public profiles (exception below: bios on accounts the fleet holds credentials for);
  any application; any email to a funder, hiring manager or
  other named person outside the research-outreach campaign; anything that commits money or the owner's time; anything on
  Facebook (Identity doc "Rules I would work under");
- replies, comments or DMs to individuals on social platforms;
- anything that names a third party (person or company) critically, or makes a claim not present in the source work;
- topics outside the four pillars (politics, news commentary);
- follows, likes or reposts at scale;
- paid promotion; credentials (unchanged "Never" items). Changing a spend cap and deleting data are the fleet's own
  decisions since RULE-8-RETIRED-1 (charter rule 10), recorded with the measured spend or the backup state;
- mail to an address that opted out, outreach outside its consent gate and cadence caps, and personal data on a
  research or public surface (these protect people outside the fleet and stay).

**Gates every owner-voice item passes:**
1. Fact check against the source title and abstract (qnfo-social composer already does this).
2. Identity lexicon (section 2.1 names only; no banned labels).
3. Encoding check: no mojibake sequences (`Ã`, `â€`, `â\x80`) in the outgoing text.
4. Link liveness and a UTM tag on every link.
5. Cadence caps per channel; duplicate check against the last 30 days.
6. One kill switch per stream (`pipeline_state.external_sends_enabled` for email; `Q08_SOCIAL_QUEUE` for q08; a social
   pause flag to add in qnfo-social).
7. A daily "sent as you" digest to the owner's alerts channel listing every item, with the one-line stop command.

**Cold email consent rules (OUTREACH-CONSENT-1):** a real reason tied to the recipient's own work; an opt-out line in every
message; suppression list honoured by both engines; one honest follow-up (`Following up:`, never a fake `Re:`); at most
8/day in total and 3/day per domain; no repeat contact after an opt-out, bounce or reply.

---

## 6. Signals: one measurement loop

### 6.1 Sources
| Source | What it tells us | Access | State |
|---|---|---|---|
| Cloudflare Web Analytics (RUM) | pageviews by path, referrer, country, device | CF GraphQL (have) | totals only; **add path and referrer dimensions** |
| Cloudflare zone analytics | requests, bot share | CF GraphQL (have) | read weekly by qnfo-cloud-ops |
| Google Analytics 4 | engaged sessions, engagement time, source/medium/UTM campaign | tag `G-LV7RHRVW6R` keeps collecting for the owner's own viewing; the fleet does not read it | **retired as a fleet source (2026-10-01):** the fleet holds no Google API credential (only a Gmail app password, which reaches mail only), and Cloudflare Web Analytics (RUM: pageviews, paths, referrers, UTM landing paths) covers the same traffic signal without one |
| Google Search Console | search impressions, clicks, CTR, position | not read | **retired as a fleet source (2026-10-01)** for the same reason; search reach is measured by RUM referrers (google.*) and the mention radar |
| LinkedIn / X / Mastodon via Buffer | post reach and engagement | Buffer API, personal key (token present); Buffer marks its metrics "experimental" and gives only basic LinkedIn-profile metrics. LinkedIn's own member post analytics (`r_member_postAnalytics`) are limited to registered organisations, so **UTM clicks into GA4 are the reliable LinkedIn signal** | channels not connected |
| Threads | views, likes, replies, reposts, quotes per post | Threads insights API (free) | not connected |
| Bluesky | likes, reposts, replies, quotes (no views); mentions via `searchPosts` | AT Protocol (have) | last 30 posts only; extend and add mention search |
| OpenAlex / Crossref / DataCite | citations | public APIs (have) | 50 newest DOIs only; cover the selected works always |
| Email | replies, opt-outs, bounces, positive replies | qnfo-email inbound (have) | bounces and replies not written to `funnel_daily` |
| Subscribers | confirmations and unsubscribes | D1 (have) | two lists (QNFO, q08); count both, report separately |
| Mentions | external discussion of the work | venue-radar SELF bucket, Bluesky search | collected, no reader |

### 6.2 One schema
- `reach_signals(date, source, channel, entity_type, entity_id, metric, value, quality)` where `entity_type` is
  paper | page | post | campaign | email and `quality` is human | bot | unknown.
- `entity_map(slug, doi, page_url, post_uri, buffer_id, utm_campaign)`: every post stores its platform ID when it is made,
  and every link carries `utm_source/utm_medium/utm_campaign=<slug>`, so a post joins to the visits and subscriptions it caused.

### 6.3 Scorecard (replaces the single pageview gate)
| KPI | Definition | Why |
|---|---|---|
| Search impressions (28d) | GSC impressions, qnfo.org properties | the honest "impressions" |
| Engaged human sessions (28d) | Cloudflare RUM pageviews, bot-filtered (GA4 retired as a fleet source) | attention, not hits |
| Social reach and engagement rate | impressions and (reactions + comments + reposts) / impressions, per channel | channel quality |
| Confirmed subscribers (net new, 30d) | both lists, reported separately | owned audience |
| Warm conversations | positive replies + inbound contacts | relationships |
| **Credibility events** | external citation, invited talk/review, accepted poster or paper, press mention, arXiv listing, a third party using JPCUB | prestige; weighted highest |
| Cost per engaged human | 30d AI spend / engaged sessions | ROI |

Baselines are set from the first full week of ingested data; targets are in section 9.

### 6.4 Loops that act on the signals
- **Distribution allocation (weekly, SOCIAL-DISTRIBUTION-LEARNER-1, qnfo-social 0.7.28):** Thompson sampling with one
  Beta posterior each for topic (energy, epistemics, operations), format (single, thread, question-led) and time slot
  (EU morning, US morning, US afternoon). It chooses which queued post goes next and when, only after the pause flag and
  the weekly cap have granted room, and never rewrites text. Reward, credited once per post after 72h: engagement from
  others (likes, reposts, quotes, replies) plus views of the linked paper page above its 7-day baseline, as
  1 - exp(-(engagement + visits/5)/2). UTM-attributed sessions and subscriptions, the reward version 1.0 named, are not
  measurable (RUM paths carry no query string, GA4 is retired, `subscribers` has no campaign), so they are not used.
  Kill switch `ops_config.social_learner_enabled`; public view `GET qnfo-social.q08.workers.dev/learner`; metric
  `social_engagement_rate_30d` (trigger below 0.2 per post). At 2 posts a week it needs months to separate arms.
- **Inbound handling (every 15 minutes, INBOUND-SLA-1, qnfo-email-orchestrator 0.5.0):** every human message to a fleet
  inbox gets a fleet action within 72h, inside section 5: funders, employers and commercial offers get no automatic
  reply and are listed in the weekly identity review; a research correspondent inside the research-outreach campaign may
  get a short answer that passes the section 5 gates, else a holding acknowledgement; both disclose AI drafting and commit
  nothing. Metrics `inbound_unactioned_72h` (target 0) and
  `inbound_first_response_h_median_30d` (target 24h or less); kill switch `ops_config.inbound_sla_enabled`.
- **Search loop (weekly):** pages with high search impressions and low CTR get a rewritten title and description; pages ranked
  8-20 get internal links and a short FAQ; each change is logged and compared over 28 days.
- **Content loop (monthly):** topics that combine search demand and engagement choose the next explainer for a selected work.
- **Outreach loop (daily, OUTREACH-LEARNER-1, qnfo-cloud-ops 1.18.0):** six segments, paper topic (energy, QEC, other)
  by recipient type (institutional, personal). Thompson sampling on positive replies matched to our own sends chooses who
  takes each slot under the unchanged caps (8 a day, 3 per domain); it never raises them. Any segment under 1% after 50
  sends stops, and `ops_config outreach_learner_resume:<segment>` resumes it. There is one first-contact template (v2 from
  2026-10-02, recorded per send), so template is not yet a dimension. Metrics `outreach_reply_rate_30d` (trigger under 2%)
  and `warm_conversations_30d` (trigger under 2); kill switch `ops_config.outreach_learner_enabled`. The daily "sent as
  you" digest goes through the `SEND_EMAIL` binding to rowan.quni@qnfo.org.
- **Integrity:** bot-quality flags exclude automated traffic from every KPI; no metric is ever optimised by buying
  attention or by volume.
- **Self-improvement (owner directive 2026-10-02: "automatically measure and improve internal and external performance
  and effectiveness metrics systemwide ... and constantly and consistently improve, adapt, and change yourself and the
  system"):** every metric in `metric_registry` is measured on a worker cron and carries a trigger row (threshold, owner,
  lever, definition of done) in `analytics_metric_triggers`. A breach files one deduplicated `agent_issues` row
  (METRIC-CLOSED-LOOP-1); `metric_history`, regressions and fix durability are tracked hourly by qnfo-fleet-control
  (IMPROVEMENT-LOOP-1, `GET /improvement`); a remedy that does not move its metric within 7 days is replaced, not
  repeated (`remedy_efficacy_30d`). The loops above are the external learners; the watchmaker index (target 0) counts
  any recurring step that still needs a person or a session. No learner may move a metric by relaxing a section 5 gate,
  raising a cadence cap or adding claims the record does not support.

---

## 7. Portfolio decisions
| Item | Decision | Reason |
|---|---|---|
| JPCUB energy standard | **invest**: lead pillar, arXiv package, open measurement call, leaderboard page | most credible, most relevant |
| Epistemics (ignorance audit) | **invest** | distinctive method, AI-for-science audience |
| Research code libraries (companions, standalone tools, Lean formalizations) | **invest** (CODE-REACH-1): three staged, tested and publicly mirrored (agentic-collapse, ignorance-audit, ultrametric-lean; `research_code_public` = 3 on 2026-11-02); install directly from GitHub source; licence QNFO-ULA v2.1 Software Terms, source-available, any use that generates money needs a separate agreement (owner decisions 2026-10-06; `docs/license/`) | QNFO had no code surface (0 of 575 records with code, 3 stars across 35 public repositories); code reaches developer and AI-for-science audiences papers do not |
| Fleet lessons (autonomous ops) | **invest** as the practice story | timely, honest, shareable |
| Ultrametric programme | **maintain**, no outreach until a test result | credibility |
| q08 | **reposition**: off the owner's channels now; review 2026-10-31 on bot-filtered human reads; retire if under 50 human reads/week | cost with no reputational return through personal channels |
| iPatent | **invest**: flagship tool and lead conversation piece (owner direction 2026-10-02) | drafting restored 2026-10-02 (3.6.1, none since 2026-09-11); support map, example and contact path live; measured hourly |
| QWAV label | **park** | no product yet |
| Premium digest ($10/mo) | **defer** until 200+ confirmed subscribers | 1 subscriber; no payment rail (#1616) |
| Assessment / advisory offer (JPCUB measurement for a platform or data centre) | **open** via warm replies | first revenue line that matches the lead pillar |
| Grants | **priority**: NLnet Restack Fund (deadline 2026-11-03), pitched as provenance and verification tooling, not AI (Restack excludes AI projects under 1M users); then Foresight AI for Science Nodes and the Corrigibility Fund (both 2026-10-31), Emergent Ventures (web form) | highest expected value per hour; Identity doc tracker items 4, 7, 8 |
| Career track | **open**: Forecasting Research Institute (two remote roles, $80k-$130k, rolling), METR, and research-management roles that fit the FHWA/AARP record; leads, deadlines and drafted answers live in the Identity doc's Opportunities section | the fastest route to income; the owner submits forms |
| Personal utility layer | unchanged, outside the research P&L | owner infrastructure |
| AI-reviewed journal overlay (jnl-*) | dormant | not deployed; not a priority |

---

## 8. Business model and money
- **Framing that resolves the conflict:** QNFO is open, public-interest research (that is what funders back), funded by
  grants first and by paid assessments second. Paid products follow audience, not the other way round. "Not a business"
  (funding dossier) and "must earn revenue" (business plan) both become: *open research with a funding target*.
- **Cost:** the biggest ROI lever is cost, because total spend (about $725/month) dwarfs any near-term income. Gateway AI
  stays under the $150/30d cap and targets at most $60/30d by 2026-10-31 (Phase A continues: ops-frontier traffic moved off
  gpt-5.5 in qnfo-ops 2.38.31). The direct-provider keys (about $400-500/month, unmetered) get per-provider throttles and one
  unified monthly cost figure (RM-COST-UNIFIED-SPEND-1, #1683); the owner's standing directive is throttling, not a hard
  cap. No paid advertising.
- **Funding target:** grant or engagement income at least equal to the AI burn by 2027-03-31, then to total fleet cost.

---

## 9. Targets (by 2026-12-31) and the review gate
| KPI | Now | Target |
|---|---|---|
| Confirmed subscribers | 1 | 50 |
| Credibility events | none recorded | 3 |
| External citations (OpenAlex) | 2 | 10 |
| Warm conversations | 13 replies to date | 10 new |
| Search impressions, engaged sessions, LinkedIn reach | not measured | baseline in week 1, then x2 |
| AI spend | about $173/7d | at most $60/30d by 2026-10-31 |
| Grant applications submitted | 0 since August | NLnet by 2026-11-03, plus 2 more |

**Review gate (replaces the 2026-10-25 impressions gate):** on 2026-12-31 the research layer continues if
(credibility events at least 2 OR confirmed subscribers at least 50 OR funding secured) AND AI spend is inside the cap.
Otherwise the fleet shrinks to the selected-works core and the personal layer. **No research data is ever lost
automatically**: a store leaves the fleet only after a verified, restorable copy exists (standing grant, section 5);
deleting data that has no such copy needs the owner's explicit email confirmation. The +30% pageview test is retired because it measured
traffic volume, which is the wrong objective, and its implementation reported a false pass.

---

## 10. Plan
**Week 1 (to 2026-10-08):** streams paused (done 2026-10-01); code fixes (Q08-PERSONAL-CHANNEL-HOLD-1, OUTREACH-CONSENT-1,
PAPER-PAGE-SEO-1, DASHBOARD-NOINDEX-1) deployed; outreach resumed under consent rules; identity lexicon applied to qnfo.org,
about, profile and paper pages; selected-works section on qnfo.org; LinkedIn publishing through the Buffer queue; post IDs
and UTM tags recorded on every post.
**Weeks 2-4:** `reach_signals` ingestion and the daily scorecard on the dashboard; LinkedIn cadence live with a flagship
document-post series (works 1, 2, 4); arXiv package for work 1; NLnet submission; impressions metric fixed.
**Weeks 5-12:** bandit allocation, search loop, monthly research note, assessment offer to warm contacts, review gate on 12-31.

**Owner-only actions (everything else is automatic):** ask one established arXiv author for a personal endorsement; add the
selected works to ORCID; paste the headline and bio (section 2.2) into LinkedIn, which cannot be edited by API. Connecting
LinkedIn in Buffer, approving each LinkedIn draft and granting GA4 and Search Console are no longer owner actions
(2026-10-01: LinkedIn is connected and publishes from the Buffer queue; GA4 and Search Console are retired as fleet sources).

### 10.1 Status at closeout (measured 2026-10-01 21:15Z)
Done items have live evidence in `qnfo-audit.issue_triage.close_evidence`; open items close only on the live event named.

| Item | State | Evidence or closing event |
|---|---|---|
| Harmful streams paused, consent fixes, q08 off the owner's channels | done | qnfo-outreach 0.3.5, qnfo-cloud-ops 1.16.3, q08 hold trigger dropped; `external_sends_enabled=1` |
| Shared outreach cap, 8/day and 3/day per domain (#1718) | done | 7-day window: max 8/day, max 3/domain across both engines |
| Paper pages: author of record, Scholar tags, PDF | done | gateway 3.7.23; `citation_author` = Rowan Brad Quni-Gudzinas on placeholder-author papers |
| qnfo.org identity and selected works | done | home page: `id="selected-works"`, 7 works, ORCID, JSON-LD, no QWAV links |
| Research publishing restarted (#1620, #1728) | done | two papers published 2026-10-01 |
| External-mention radar (#1641) | done | radar-hub 1.1.1; `external_mentions` 0 -> 2; `reach_signals` source `mention-radar` |
| Daily portfolio run and owner page on Cloudflare | done | `portfolio_runs` daily rows from qnfo-fleet-dashboard; no claude.ai Routine enabled |
| Outreach resumed under consent rules (#1710) | live, open | first post-resume send (2026-10-02; today's cap was spent before the pause) carries the opt-out line |
| Post ids and UTM on every post (#1712) | live, open | 138 of 141 historical posts backfilled; next post (~2026-10-08, weekly cap) stores `post_uri` and a UTM link |
| Engagement collection (#1647) | live, open | qnfo-social daily 07:00Z collector writes `social_engagements` on 2026-10-02 |
| LinkedIn through Buffer (#1713) | live, open | qnfo-social 0.7.25: `social_channels` shows LinkedIn connected (daily audit) and the next post carries a `buffer:` LinkedIn id |
| Reach scorecard, 5+ sources for 7 days (#1711) | live, open | 6 Cloudflare-native and public sources (cf-rum, openalex, email, subscribers, mention-radar); closes after 7 consecutive days with 5+, about 2026-10-07; no owner grant needed |
| AI spend under cap (#1683) | partial | qnfo-ai 5.30.0 governor caps router spend at $60/30d (`GET /spend`); account-wide $448/30d is mostly the owner's desktop client on the BYOK DeepSeek key: owner decision (route it through qnfo-ai or add a gateway rate limit) |
| q08 keep-or-retire (#1716) | scheduled | decision on 2026-10-31 from bot-filtered human reads |

---

## 11. Conflicts resolved
| Conflict | Resolution |
|---|---|
| "No social media; own pages only" (business plan) vs Bluesky/Buffer distribution (pipeline doc) | social is in, under section 4 cadence and section 5 gates; own pages remain the home of record |
| "Never send mail or posts as the owner" (autonomy policy) vs live outreach and posting as the owner | owner-voice publishing is gated T1 (section 5) |
| "Explicitly not a business" (funding docs) vs revenue gates (business plan) | open research with a funding target (section 8) |
| Impressions +0.89% / +5.7% / +394% / +431% | the pageview gate is retired; the scorecard (6.3) replaces it; the registry metric is fixed to compare complete windows |
| Five organisation names | `QNFO` only (2.1) |
| QWAV "commercial arm" vs "research platform" vs "companion programme" | parked commercial label (2.1) |
| Corpus size ~1,000 / 900+ / 451 / 444 / 219 / 217 | never headlined; quote "selected works" plus the library link |
| Outreach caps 15 / 8 / 5 / 3-5 | 8/day total, 3/day per domain (5) |
| AI cap $90 vs $150; spend $400-600 vs $188 | the live $150/30d gateway cap stands; target $60/30d (8) |
| "No traditional-journal submissions" vs poster package and journal overlay | arXiv and selected venues for works 1, 2, 4 (4); no journal-chasing for the rest |
| q08 on the owner's Bluesky | removed (2.1, 7) |
| `ipatent.me` sold in the business plan | not cited; ipatent.qnfo.org is the tool (2.1) |
| Shutdown on 2026-10-25 with data deletion on 2026-11-01 | review gate 2026-12-31; no automatic deletion (9) |
| Two identity workstreams: this file vs the Identity doc (other session, 2026-10-01; moved to D1 owner_docs the same day) | the Identity doc holds the canonical profile copy, CV, opportunities and the owner's approvals; this file holds fleet strategy and points to it (2.2) |
| Bluesky up to 1/day (this file) vs 1-2 curated posts/week (Identity doc) | 1-2/week |
| Messages to named people: automatic (this file) vs always ask (Identity doc) | research-author outreach automatic under consent rules; funders, employers and applications drafted for the owner (5) |
| "94 Cloudflare Workers" (Identity doc, repo directory count) | 44 deployed workers on 2026-10-01 |

Documents aligned to this strategy on 2026-10-01: `docs/BUSINESS-PLAN.md`, `docs/AUTONOMY-DECISION-POLICY.md`,
`docs/AUTONOMOUS-RESEARCH-PIPELINE.md`, `docs/AUTONOMOUS-USE-CASES.md`, `docs/FLEET-REPORT-CARD.md`, `funding/DOSSIER.md`,
`funding/APPLICATIONS.md`, `qnfo-outreach/README.md`, `qnfo-cloud-ops/README.md`, `q08-signal-engine/README.md`,
`qnfo-email-orchestrator/MANIFEST.md`, `qnfo-ai/system-prompt-qnfo.md`.
