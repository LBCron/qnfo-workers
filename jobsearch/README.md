# jobsearch: verified-claims job matcher (JOBSEARCH-POC-1)

Run: `python -I run.py --out out --cache out_cache.json` · Test: `python -I test_jobsearch.py`

## Pipeline
1. **Ingest** (`sources.py`): public ATS APIs (Greenhouse, Lever, Ashby) + Remotive + Arbeitnow. No LinkedIn/Indeed scraping (LinkedIn User Agreement s8.2).
2. **Gate + score** (`match.py`): deterministic and explainable. Hard gates (seniority, role family, location), then title fit (40) + evidence clusters (45, needs 2+ keyword hits each) + uncommon-intersection bonus (15). Auth, degree, and location doubts become `OWNER CHECK` flags, never silent assumptions.
3. **Tailor** (`tailor.py`): resume and note are assembled only from sentences in `facts.json` (the claim ledger, from the verified CV).
4. **Verify** (`tailor.verify`): every output line must carry a tag and equal its ledger sentence; numbers must exist in the ledger; unclaimed technologies/credentials are rejected; quoted posting terms must appear in the posting. A failure blocks the artifact.
5. **Outbox**: `out/<job>/{resume,note}.md` + `meta.json` with `status: pending_owner_approval`.

## Why not "100% user-free outreach"
- Auto-apply tools measured at 0.4-6% response; recruiters reject unpersonalized AI output (62% in one 925-person survey); tools are documented inventing skills. Reputation risk is asymmetric: one fabricated claim costs more than 100 missed applications.
- LinkedIn bans bot messaging/scraping (account restriction). Mass cold email to harvested recruiter addresses breaches GDPR/ePrivacy for an Amsterdam sender.
- So: discovery, matching, tailoring, verification run unattended; **sending** is gated by approval. Nothing here sends anything.

## Ledger gaps the owner must fill (`unverified_needs_owner` in facts.json)
Work authorization (NL/EU/US), salary floor, languages, relocation tolerance. Until filled, matching flags rather than assumes.

## Next steps (not built)
- Approved-send path through each ATS's own apply URL (human click) or Gmail draft creation.
- Owned-surface publishing: JSON-LD `Person` + CV page on qnfo.org generated from the same ledger.
- Optional LLM re-rank (reason about fit only; may not write claims; output run through `verify_freeform`).
- Scheduled run as a worker cron writing to D1 `agent_issues`/owner queue.

## Server-side operation (qnfo-jobsearch worker, JOBSEARCH-1 / JOBSEARCH-OPS-1)
Runs entirely on Cloudflare: hourly cron (minute 15), D1 `qnfo-audit` (`jobsearch_*` tables), web UI at `/`, JSON API at `/api`.
- **Sign in** (UI "Sign in" or `POST /api/auth/request` then `POST /api/auth/verify {"code":"123456"}`): a 6-digit code is e-mailed to the ledger address through qnfo-email; 3 codes an hour, 5 tries a code, 12-hour session (cookie `jobs_session`, or the returned token as `Authorization: Bearer`). `x-loop-token` is accepted as a second path if that secret is ever set.
- **Operate**: `GET /api/ops` (200 ok / 503 degraded) lists the eight `fm-jobsearch-*` checks, feed health, counts and the last run. `POST /api/run` triggers a run (10-minute cooldown). `GET /api/runs` shows history.
- **Self-maintenance**: unfinished runs are closed by the next run; feeds are retried once and tracked; postings gone upstream become `expired` after 48 h (only when their feed answered); duplicates across boards are merged; expired/rejected rows are deleted after 90 days.
- **Change the ledger**: edit `jobsearch/facts.json` and the same object in `qnfo-jobsearch/worker.js` (a node test fails if they differ), raise `ledger_verified_on` only after re-checking the CV, bump the worker VERSION, PR to main.
- **Failure modes** are registered in `failure_modes` / `remediation_contracts` by `migrations/2026-10-27-jobsearch-ops.sql`.

## Does the matching help? (JOBSEARCH-OUTCOME-1, qnfo-jobsearch 1.2.0)
Mark what happens on the page: **Mark applied**, then **Got a reply**, **Interview**, **Offer** (an application with no reply after 21 days becomes `no_reply` by itself). Every change is an append-only row in `jobsearch_events`.
- `GET /api/outcomes`: funnel (matches, approved, applied, replies, interviews, offers) overall and by tier, the reply rate of applications 21 to 90 days old, and the reply rate by tier. Under 10 such applications the rate is **unknown** and nothing is published.
- Metrics (written each run, `metric_registry`): `jobsearch_reply_rate_90d` (target >= 0.06, trigger under 0.03; 0.06 is the one independent figure, an untailored auto-apply test), `jobsearch_interview_rate_90d` and `jobsearch_applied_30d` (named exemptions). The outcome row is in `output_quality_measures` (role outcome); the claim verifier stays a proxy and is not counted.
- If tier A does not reply more than tier B after enough applications, the score weights are not predictive and the trigger sends the code loop to `qnfo-jobsearch/worker.js` (never the verifier).

## Roadmap and handoff (JOBSEARCH-HANDOFF-1)
Rows `JS-1` to `JS-9` in `roadmap_implementation` (source `jobsearch-2026`). Built: JS-1 to JS-4. Handed to server-side doers, each with a closing probe: JS-5 `jobs.q08.org` (issue `DOMAIN-PLANE-1:jobs.q08.org`), JS-6 AI re-rank (`JOBSEARCH-LLM-RERANK-1`, code loop), JS-7 more sources (`JOBSEARCH-SOURCES-1`, code loop), JS-8 the two owner-only ledger facts (card `jobsearch-ledger-owner-answers`, contract `owner-card-jobsearch-ledger`, fed by `jobsearch_meta.ledger_open_questions`), JS-9 weight tuning (metric trigger `jobsearch_reply_rate_90d`). Automatic sending to recruiters is declined by design. Nothing needs a session: the worker runs hourly and `GET /api/ops` reports its health.

## Search profile (JOBSEARCH-PROFILE-1, qnfo-jobsearch 1.3.0): the worker is now the source of truth for matching
The Python files are the original reference and no longer match the worker. The search is driven by what the owner says:
- **Preferences**: yes/no questions on the page (`GET/POST /api/prefs`): where (Netherlands and remote by default; other EU, US and elsewhere on-site only if you say yes), which role families (policy, transport and planning, data, product, program, research, consulting, nonprofit, GIS, contracts, social policy, climate, AI, quantum, teaching), level, contract work. Saving re-runs the search at once and retires matches that no longer fit.
- **Check a job**: paste a link (read through its schema.org JobPosting data when the page has it) or the posting text; `POST /api/analyze` returns the verdict, why, the parts of your record that fit, the gaps (tools or years not in your ledger), whether it would appear in your search and why not, and a verified resume and note for that job. "More like this" and "Not for me" teach the search; rejecting or applying to a match teaches it too (a word in 2 or more rejected titles and no liked ones is down-ranked).
- **Rejected matches stay hidden** (status filter "All, including rejected" shows them).
- **Feeds**: 56 (ATS boards, The Muse, Jobicy, Remotive, Arbeitnow). Dutch government, universities and consultancies publish no open feed; use Check a job for those and see issue JOBSEARCH-NL-PUBLIC-SECTOR-1.

## The CV lives in the worker now (JOBSEARCH-CV-1, qnfo-jobsearch 1.5.0)
`facts.json` is the original ledger and is kept for history; it no longer drives anything. The claim bank is `jobsearch_bank` in D1, seeded from `BANK_SEED` in `qnfo-jobsearch/worker.js` and edited on the worker's own page, `/cv` (jobs.q08.org/cv): a yes/no interview, a review queue for claims the verified CV does not contain, roles, achievements, publications, education, skills, backup and restore. Every resume and note sentence is still copied from the bank and re-verified line by line; every change keeps the previous version (`jobsearch_bank_history`) and writes under an optimistic lock.
- **Search follows the CV**: evidence in a posting that the CV can back up scores in full, evidence it lacks scores less and is named ("not in your CV yet"); the "Check a job" answer lists CV gaps with the interview questions that close them.
- **Decided means decided**: a role the owner rejected, applied to or approved never comes back under another id, board or location (key: employer + title without brackets). Decided rows are kept for good; only their drafts are cleared after 90 days.
- **Learning**: a rejection carries a reason (field, level, place, employer, already handled, other). "Field" counts double for the title words, "level", "place" and "already handled" teach nothing about the words, "employer" penalises the employer at once, several rejections at one employer drop it.
- **Wider net**: stated preferences (place, level, contract type, switched-off families) become a penalty and the tier `C` "stretch" label instead of a drop; research-engineering titles pass when the posting matches the record. Hard noise (sales, legal, recruiting, residence-restricted remote) is still excluded. Sources added: Recruitee boards, RemoteOK, Himalayas, the Hacker News "Who is hiring" thread, search queries on Remotive and Jobicy, and 30 more company boards, each probed live.

## Profile pack (PROFILE-PACK-1)
`python -I profile_pack.py --out out_profile [--live pasted_profile.txt]` builds a paste-ready LinkedIn/job-board pack (`profile.md`) and a JSON-LD `Person` (`person.jsonld`) from `facts.json`. Every line is verified against the ledger; `--live` reports which headline, bullets and skills are missing from a pasted copy of the live profile (drift). LinkedIn has no profile-write API and bans bots (s8.2), so the pack is applied by the owner or in the owner's own signed-in browser, not by a server-side bot. Test: `python -I test_profile_pack.py`.
