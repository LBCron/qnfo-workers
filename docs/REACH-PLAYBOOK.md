# Reach playbook (REACH-FOCUS-1)

Charter pillar **reach**, program QNFO.REACH. Migration `migrations/2026-11-04-reach-focus-1.sql`. Owner brief 2026-11-04: not enough people see the QNFO products; reach employers, academics and
industry leaders; be seen as a pioneer; right message on the right channel for the right people; a focused net, not a wide one; a channel nobody looks at is the wrong channel.

## 0. Positioning (owner, 2026-11-04)

The selling point is one ecosystem, in three parts that prove each other:
1. **AI systems that do research**, the slow and tedious part: finding, reading, drafting, checking.
2. **Asking the right questions**: the Universal Ignorance Audit and its `ignorance-audit` library turn "what do we not know here" into a method others can run.
3. **Deploy and maintain themselves**: the fleet monitors itself, files its own defects and fixes its own code through tested, reviewed, canaried pull requests, and reports what that costs and where it fails.

Every message below leads with this and shows a proof a stranger can open (paper, library, live dashboard), never an adjective. Today `qnfo.org/work-with-me` leads with energy per correct answer (JPCUB); the system-building pitch is not
on it. `REACH-FOCUS-1.4` moves it to the top. Honest limit (ORG-LABEL-1): one researcher with an AI-assisted pipeline, not a lab, and the copy says so.

## 1. What the numbers say (GA4 `/api/ga4/overview`, 28 days to 2026-11-03, and `v_channel_impact_7d`)

| Channel | Posts a week | GA4 sessions : engaged (10 days) | Reading |
|---|---|---|---|
| X | 14 | 19 : 17 | The only social channel readers act on (89 percent engaged). Small sample: one or two posts may carry it. |
| Organic search | n/a | 87 : 46 (28 days) | Largest scalable source. Papers already carry Highwire `citation_*` tags, ScholarlyArticle JSON-LD, `llms.txt`, a sitemap and open robots; the gap is not technical. |
| LinkedIn | 6 | 20 : 5 | Real but thin. The audience is people who hire and commission. |
| Bluesky | 21 | 22 : 1 | 642 counted clicks, 1 engaged session: the clicks are automation. |
| Substack Notes | 38 | 110 : 0 | A fifth of all social posts, zero engaged sessions. |
| Mastodon | 10 | 9 : 0 | Small; the audience (scholar.social) is right, the message is a generic thread. |
| Email | 18 | 0 clicks | Review with the subscriber pipeline; not changed here. |

About 107 social posts a week produce 43 engaged organic-social sessions in 28 days. Posting more is not the lever. READER-YIELD-1 (`docs/READER-YIELD.md`) showed the same from the paper side: output swung 2 to 89 papers a day and
externally sourced engaged sessions stayed at 44 a week.

## 2. What the research says, and its limits

- Randomised evidence is weak. The ESC cardiology trial linked active Twitter promotion to more attention and citations, but #TweetTheJournal (PMC10899730) found no significant difference in Mendeley readers or citations at one year.
  Social promotion buys attention, not authority. A thought-leader position comes from credibility events: a reproduction, working code, a self-found error, a claim a stranger can check.
- Practitioner sources (Sprout Social, LinkedIn guides, Forbes 2026 trends) agree on direction, not on proof: fewer, deeper posts (2-3 a week on LinkedIn), niche communities over mass followings, original data over commentary,
  human voice over generated volume. They are marketing blogs; treat them as hypotheses to measure here.
- Nothing found compares Hacker News, LessWrong or Reddit with social channels for independent researchers. That is a gap, so the plan below measures it.

**Strongest argument against this plan.** The audience may be small by nature: independent, unaffiliated work in quantum error correction and p-adic methods has few readers anywhere, and no channel choice changes that. Then the
honest lever is the credibility assets in section 4, which take longer than a channel change and may not pay back for months.

## 3. Audiences, channels and messages (also seeded in `reach_audience_matrix`)

One message does not fit every channel. Each audience gets one lead channel, one message, one proof asset and one measure.

| Audience | Lead channels | Message | Proof asset | Who acts |
|---|---|---|---|---|
| Quantum and mathematical-physics academics | Search, X, Mastodon (scholar.social) | The claim in one sentence, the check a reader can run, the limits. No hype words. | Paper page with citation tags; Zenodo DOI; `research-code` companion | fleet |
| AI, ML and AI-safety researchers | LessWrong / Alignment Forum, Hacker News, X | A falsifiable finding. Lead story: "we ran our own most-downloaded paper's code and found its trajectory does not follow from its equations" (`docs/CODE-REACH-PROGRAM.md` 3.1). | `agentic-collapse`, `ignorance-audit` libraries | owner posts, fleet drafts |
| Employers and industry leaders | LinkedIn, `qnfo.org/work-with-me` | The section 0 pitch in first person: I build AI systems that research, ask the right questions and maintain themselves. One case study a month with live numbers, including what failed. | The fleet itself, live dashboards, code | fleet drafts, 3 a week via Buffer |
| Developers and formal-methods people | GitHub topics, Show HN, Lean Zulip | Something that runs: `lake build` passes, `pip install`, tests. | `ultrametric-lean`, libraries | owner posts |
| Anyone asking a question | Search | Page title and first paragraph answer the question in plain words. | Existing paper pages | fleet |
| Subscribers | Substack, email | A weekly digest of three papers, not 38 notes. | Digest | fleet |

Rules that do not bend: no automated posting to Hacker News, Reddit or LessWrong (their terms and norms forbid it, and a ban costs the account); no mass cold email; no engagement pods, bought followers or fake accounts; every
outreach respects consent, suppression and opt-out. Channels that forbid automation get a drafted pack for the owner to post by hand, once a week.

## 4. The plan, in order

1. **Credibility first (this is what makes a thought leader).** Publish the Agentic Collapse reproduction as an errata-backed v2 and as a short, stand-alone post written for AI researchers (`AGENTIC-COLLAPSE-REPRO-1`). A
   team that shows its own error is rarer and more quotable than another paper.
2. **Concentrate the automated channels where readers act.** Done in this change: X cap 14 to 21 a week, Mastodon 14 to 7 (`pipeline_flags.social_channel_caps`, old value saved in `bak_20261104_reach_focus_caps`). Filed:
   Substack Notes to a weekly digest (`REACH-FOCUS-1.2`), Bluesky to roll-ups plus the best paper a day.
3. **One message per channel (`REACH-FOCUS-1.1`).** Today `composePrompt` writes the same five-post Bluesky thread for everyone. X gets a single hook plus the check; Mastodon gets field hashtags and the check; LinkedIn gets a first-person
   practitioner note for hiring audiences.
4. **A weekly human-post pack (`REACH-FOCUS-1.3`).** Once a week the fleet picks the paper outsiders already read (`v_paper_readers_top`) and drafts a Hacker News title, a LessWrong post and a scholar.social post, as one card for the
   owner to post by hand (IDENTITY-BOUND: these channels forbid automation). Five minutes a week of owner time, aimed at the venues with the biggest single-day audiences.
5. **Measure and stop.** A channel with 50 or more sessions and under 5 percent engaged for 28 days drops to a weekly digest. Review on 2026-12-02 against section 5.

## 5. Prediction and what falsifies it

Logged in `decision_log`: `engaged_reader_sessions_7d >= 55 within 21 d` (baseline 44 externally sourced a week on 2026-11-03). Falsified if X engaged sessions fall back below 8 a week after the cap rise (the 17 came from one or two
posts, not from the channel), or if total engaged sessions do not rise within 21 days while posts to Substack and Bluesky fall; then revert the caps (Rollback line of the migration) and treat reach as a credibility problem, step 1.
Failure modes: X may throttle an account that posts 21 near-identical threads a week (REACH-FOCUS-1.1 is the remedy); the weekly pack adds owner load against the `owner_load` North Star target of 2; GA4 undercounts readers with
blockers.
