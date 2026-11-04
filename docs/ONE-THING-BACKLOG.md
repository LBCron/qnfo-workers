# One Thing / Focus backlog and roadmap

Owner request: productive activity without required typing, with Yes/No controls, one-tap choices, checklists, and no additional LLM spend.

## Architecture (fixed)

- Product surface: **Focus** inside `https://me.q08.org/companion`.
- Canonical source: `QNFO/qnfo-workers`, `personal-api/companion.js` (inlined into `personal-api/worker.js`); `deployed-current.worker.js` is the byte-identical mirror.
- Runtime: existing `personal-api` Cloudflare Worker on the `quniverse` account.
- State: existing D1 `tasks`, `cmp_activities`, and `cmp_activity_log` tables through existing authenticated APIs. Timer and handoff progress are session-local; the cost checklist and preferences are browser-local only, not cross-device sync.
- Delivery: pull request to `main`, then the existing `canonical-deploy.yml` / `qnfo-ops` deployment path.
- Cost: no model call, new Worker, database, binding, route, subscription, or mirrored ticket system.

## Closeout — native Focus follow-through

- [x] Keep Focus inside the existing companion with button/checklist controls and visible keyboard focus.
- [x] Offer 5 / 15 / 30-minute choices. Recommendations use existing actions and activities APIs, include only next actions that fit the time and selected energy, and filter activities by active state, duration, and energy.
- [x] Provide a local start / pause / resume / reset timer. It is optional, ephemeral, and makes no background request.
- [x] Record completion through the existing action and activity APIs.
- [x] Copy a one-click session handoff with the current goal, completed items, an eligible next action, and time/energy/checklist constraints. The read and clipboard write occur only after the button is pressed.
- [x] Keep the free token/subscription checklist in this browser only. It makes no provider calls, purchases, or subscription changes.
- [x] Keep the existing Data-tab export and delete APIs.
- [x] Keep one-tap Qniverse presets in the existing action backlog.

## Explicitly rejected

- [x] Restore from a backup file: rejected for now because the current export spans related personal stores, while the companion has no validated, transactional, conflict-safe restore path. A file picker alone would not prevent partial or unsafe writes; no import route or UI is added.
- [x] Duplicate voice capture beside Focus: the existing Capture flow already supports voice, and a duplicate adds no evidenced benefit.
- [x] Rank recommendations from activity ratings: defer until Focus usage evidence supports changing recommendation order.
- [x] Calendar-aware suggestions: not needed for this follow-through and no Focus usage evidence calls for it.
- [x] Home-screen shortcuts: defer until usage evidence shows Focus is the main entry point.
- [x] Standalone or localhost prototype: not deployed; it is not the canonical UI.

## Canonical path

Open `https://me.q08.org/companion`, choose **Focus**, and use its time/energy choices, timer, checklist, and handoff buttons. Use **Data → Download everything** for a portable export. The standalone prototype remains undeployed. Changes ship only through a pull request and the canonical deployment workflow.

## Zero typing and visible cost (COMPANION-NO-TYPING-1, owner 2026-10-29)

Owner, 2026-10-29 (dictated): "I'm not going to fill in any free text ... if you want free text from me ... ask me to dictate";
"I need yes, no buttons ... checklists"; "if I keep using LLMs, the cost keeps adding up"; "write it to backlogs". The owner's
therapist raised possible autism on 2026-10-28: structure, clear finish lines and predictable choices, no open-ended prompts.
Idleness is distressing, so "what can I do right now" must always have an answer.

Shipped in personal-api 4.33.0 (companion 1.18.0):

- [x] Dictate beside every box that takes words (Talk, Journal, Capture). The phone records, the server writes the words with
      Workers AI Whisper (`POST /companion/api/dictate`, nothing stored). Browser speech recognition is not used: it does not
      work for the owner.
- [x] Journal: one-tap lines (Got something done, Went outside, Talked to someone, Learned something, Rested, Hard day).
- [x] Today opens with "What can I do right now?": Give me one thing (Focus), Read something (mind.q08.org pick), Talk (dictate).
- [x] AI cost as one number: `GET /companion/api/ai-use` reads personal-api's rows of `qnfo-audit.ai_call_counters` (counts
      only) for today and the last 7 days, priced at Workers AI list price ($0.011 per 1,000 neurons). Shown on Focus and Data.

Backlog (`agent_issues` 1001637-1001643, family `COMPANION-NO-TYPING-1:*`; the fleet is the doer):

1. [ ] **Videos** (`COMPANION-NO-TYPING-1:videos`): a curated `q08-mind/data/videos.json` (talks and explainers on how minds
       work, autism and ADHD from autistic and clinical authors, no guru material), `/now?kind=video` and a "Watch something"
       button on Today. Deterministic, no model. Each URL checked live before it is added.
2. [ ] **Do tab without typing** (`:do-tab`): preset next-action chips (tidy one surface, a 10-minute walk, reply to one
       message, one Qniverse task) and Dictate for the title; the minutes box becomes 5/15/30 buttons.
3. [ ] **Dictate everywhere else** (`:dictate-rest`): Learn card front/back and each safety-plan field get Dictate.
4. [ ] **Qniverse 15-minute tasks from the fleet backlog** (`:qniverse-tasks`): Focus offers one item a person can do in a
       quarter hour (rate a post, read a new paper's abstract and tap good/unclear, check one fleet.qnfo.org card), read
       from the open queue, Done/Not now, no typing.
5. [ ] **Cheaper Talk** (`:talk-cost`): answer the common one-tap asks (what's on today, what's next) from D1 without a model
       call; cache identical asks for 10 minutes; daily AI-use number on Today when above $0.10.
6. [ ] **Home-screen shortcut** (`:shortcut`): manifest `shortcuts` entry that opens Focus directly.
7. [ ] **Repair two red suites** (`:red-suites`): `companion-reading.test.mjs` (guide no longer lists the reading pick) and
       `companion-travel.test.mjs` fail on main as of 2026-11-04, before this change.
