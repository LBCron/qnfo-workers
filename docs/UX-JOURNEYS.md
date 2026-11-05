# Phone journeys: every user-facing app is tested the way a person uses it (UX-JOURNEYS-1)

Owner, 2026-11-04: "Have you run UI UX and user testing on this for how would a user experience this using? Is it easy? This needs
to be baked into the fleet, not just for this app, but for anything. How would a user actually use this? And is it working?"

## The rule

Every app a person opens on `q08.org`, `qnfo.org` or `qwav.org` has phone journeys in `scripts/ux-journeys/apps/`, added in the PR
that creates or changes the app. A journey is a short script of what a person does: open, tap a button by its visible name, see
the result. It runs on a headless phone (Chromium at Pixel 7 size with touch, and every screen again at 360px) with no model call,
no key and no account.

- **New user-facing host**: add it to `HOSTS` in `apps/public.journeys.mjs` (open the home page, follow its first link) and a budget line.
- **New app with screens behind a sign-in or real flows**: add `apps/<app>.journeys.mjs` with one journey per everyday task, and a
  harness (`apps/<app>-harness.mjs`) that serves the app's real code with fake data, as `companion-harness.mjs` does for me.q08.org.
- **Budgets** (`budgets.json`): the most taps and typed fields each journey may take. Lower them when a change makes a task easier;
  raising one needs a reason in the PR. For the owner's companion, typing is 0 everywhere except the six-digit sign-in code (owner
  rule 2026-10-29: no free text, buttons and Dictate only).
- **The fleet dashboard** (`apps/fleet.journeys.mjs`, harness `apps/fleet-harness.mjs`, owner 2026-11-04: three screens, one-tap hand-back, a command
  line that works): the real `qnfo-fleet-dashboard/worker.js` on an in-memory D1 with the ops executor stubbed and every outside host answering 503, so each
  section degrades as it does when a source is down. Six journeys: see what needs me, hand an item back (1 tap), snooze (1 tap), Readers finishes loading
  with sources down, the Code tab signed out, and a one-tap command-line run (2 taps). A change to the home page, `/api/v3/*` or the hand-back path runs them.

## What is checked

| Check | Meaning | Outcome |
|---|---|---|
| journey finishes | every step found its button and the expected text appeared, no page exception | `broken` otherwise |
| taps, typed fields | counted per journey against `budgets.json` | `harder` when over |
| sideways scroll | page wider than the phone, at 412px and 360px | screen finding |
| tap targets | buttons and links under 24x24 px (WCAG 2.2 SC 2.5.8; inline links in a sentence exempt). Not counted, because no thumb reaches them (`isTapTarget` in `lib.mjs`, covered by `scripts/ux-journeys.test.mjs`): a control parked off the left or top edge of the page, an anti-bot honeypot (aria-hidden, tabindex -1, 12 px or less), and a checkbox or radio inside a label that is itself 24x24 or more (the label is the target) | screen finding |
| empty floating bar | a fixed or sticky element with no content (for example a toast whose hide rule lost to an id rule) | screen finding |
| accessibility | axe-core WCAG 2.0/2.1/2.2 A and AA, serious and critical | screen finding |
| console errors, 404/5xx | collected during the journey | screen finding |

- **Ask QWAV pages** (`apps/ask-qwav.journeys.mjs`, live only, ask.qwav.tech): `living-paper` (open `/paper/<slug>`, see the title and a drawn equation), `reproduce-record` (open `/reproduce/<slug>`, see the claim rows and the Run button; the button is not pressed because it downloads about 10 MB of Python) and `compute-padic` (open `/compute`, tap Compute, see the valuation table). Added with qnfo-ai-search 2.16.0 to 2.18.0 (roadmap rows 31, 36, 34, 38).
- **Papers** (`apps/papers.journeys.mjs`, live only): `paper-from-list` (open papers.qnfo.org, tap Read on the first paper, see its title, measure the paper page) and
  `paper-with-short` (open the page link `/api/paper-videos` hands out, see the embed). A screen finding of the public home pages names the host in its label
  (`home reading.q08.org`), since 13 hosts were all "home" in UX-SCREENS-1 1001734 and nobody could tell which worker owned a finding.

## When it runs

`.github/workflows/ux-journeys.yml`:

- **Pull request** that touches a journey or `personal-api/companion.js`: the local journeys run on the head and on the base; the
  check fails only when the PR makes a journey broken or harder that is fine on the base. The live journeys run as a report.
- **After every canonical deploy on main**, at most hourly (age of `ci-status/ux-journeys-live.json`), and on manual dispatch: live
  signed-out journeys on every public host and the local journeys of main. Each broken or harder journey becomes the
  `agent_issues` row `UX-JOURNEY-1: <app> / <journey>`, each app's screen findings `UX-SCREENS-1: <app> (<mode>)`; the run that sees
  it pass closes it through `issue_triage` with the run as evidence (`close_channel auto:ux-journeys`).

Live journeys are read-only: they never submit a form, never ask for a sign-in code and never send a message.

## Run it yourself

```
mkdir -p /tmp/uxm && (cd /tmp/uxm && npm init -y >/dev/null && npm i --no-save playwright@1.63.0 axe-core@4.10.2 && npx playwright install chromium)
UX_MODULES=/tmp/uxm/node_modules node scripts/ux-journeys/run.mjs --mode local --shots /tmp/shots   # or --mode live, --app companion
node scripts/ux-journeys.test.mjs                                                                      # offline selftest
```

## First run (2026-11-04, me.q08.org on main)

Four of seven everyday companion journeys worked. Broken: "Give me one thing" opened a Focus screen that said "Could not load Focus.
CMP is not defined" (the page called a server-only function); a check-in notification opened Today with no mood buttons; and an
empty black bar floated over every screen. All three were fixed in PR 7009, where all seven journeys pass.

First live run (same day, from the GitHub runner, PR 7028): 11 of 13 public hosts open on a phone and follow their first link. Broken:
ai.qnfo.org's chat page threw "Invalid regular expression" on load, so nothing on it worked (fixed in the same PR, qnfo-ai 5.46.1;
`scripts/inline-page-scripts.test.mjs` now parses every inline script of every page served from a template literal), and
papers.qnfo.org throws "Unexpected token '<'" (a script URL answered with an HTML page; filed as `UX-JOURNEY-1: public / papers-qnfo-org`
by the first run on main, with the URL). Most qnfo.org pages have header links 20px tall (filed as `UX-SCREENS-1: public (live)`).
