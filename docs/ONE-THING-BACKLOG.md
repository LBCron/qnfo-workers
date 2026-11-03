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
