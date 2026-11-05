# Attach workflows manifest (TP-3b, roadmap row RM-TP-3-FOOTPRINT-TEARDOWN, lever 8 continued)

Charter pillar: core. Classification of the 8 workflows under `.github/workflows/` matching `attach-*.yml`, read from `origin/main` at 2fc57e0c
(2026-11-05). Same method and the same rule as `archive/APPLIER-WORKFLOWS-MANIFEST.md` (TP-3a): a one-shot workflow whose effect is live and
which nothing references is deleted; anything in doubt stays.

What each one is. A self-triggering, idempotent, fail-closed route attacher: `on: push` of its own file or of `scripts/attach-<name>.py`, plus
`workflow_dispatch`, no schedule, no `workflow_run`, no caller. It waits for the canonical deploy of the target worker, creates a zone route (and an
originless proxied record when the name has none), verifies the host from outside the account and writes `ci-status/attach-<name>.json` back to main.
Removing the workflow removes only the automatic re-run when the file or script is edited; the script, its test and the ci-status record (the route ids
that roll the route back) stay.

How each was judged. (a) triggers read from the `on:` block; (b) references: a search of every tracked file for the stem (workflows, scripts, docs,
migrations, worker sources), split into live references (`workflow_run`, `uses`, a dispatch) and prose or history; none of the 8 is named by another
workflow's `workflow_run` or `uses`; (c) the last result in `ci-status/attach-<name>.json` (`status`, `stage`, `verified`, `ts`); (d) the host, read
from outside the account on 2026-11-05 ~00:30Z: `GET https://<host>/health` answers 200 and names the worker.

| workflow | host and worker | last recorded result | host read from outside | verdict |
|---|---|---|---|---|
| attach-jobs-q08-route | jobs.q08.org, qnfo-jobsearch | ok, verify, verified true (2026-11-01T17:18:59Z) | 200, worker qnfo-jobsearch 1.5.1 | delete |
| attach-me-q08-route | me.q08.org, personal-api | ok, verify, verified true (2026-11-01T17:19:32Z) | 200, worker personal-api 4.36.1 | delete |
| attach-mind-q08-route | mind.q08.org, q08-mind | ok, verify, verified true (2026-11-01T17:19:00Z) | 200, worker q08-mind 2.3.0 | delete |
| attach-watch-q08-route | watch.q08.org, personal-watch | ok, verify, verified true (2026-11-01T17:19:01Z) | 200, worker personal-watch 1.1.1 | delete |
| attach-travel-host | travel.q08.org, personal-companion | ok (2026-11-01T17:19:05Z), no verify stage recorded | 200, version 1.44.16-codeagent (the personal-companion series) | delete |
| attach-ask-qwav-route | ask.qwav.org and ask.qwav.tech, qnfo-ai-search | **failed** at stage redirect (2026-11-01T17:19:57Z) | ask.qwav.org 200; ask.qwav.tech 200, but the script's definition of done is a 301 to ask.qwav.org | keep: the redirect it exists to create is not there |
| attach-lifecycle-custom-domain | lifecycle.qnfo.org, qnfo-lifecycle | **failed** at stage fallback-route (2026-11-01T17:19:28Z), http 409 code 10020 "A route with the same pattern already exists (used by Worker: qnfo-lifecycle)": the route it exists to create was already there and points at the right worker | GET /health 200, worker qnfo-lifecycle 1.18.1 (read 2026-11-05 ~03:40Z, W2-E, TP-3B-ATTACH-1) | delete |
| attach-surface-routes | archive.qnfo.org, qwav.org, www.qwav.org, qwav.tech, qnfo-gateway | mixed: archive.qnfo.org present and verified; qwav.tech created, not verified, rolled back | archive.qnfo.org 200; qwav.org 200; www.qwav.org and qwav.tech answer 301 to qwav.org | keep: partly rolled back, and DOMAINS.md names it as the pattern |

Counts: delete 6, keep 2 (workflows 76 to 70; attach-lifecycle-custom-domain joined the deletions in TP-3B-ATTACH-1, 2026-11-05: its one failure is an
idempotent "route already exists" answer, see its row). The two kept workflows are a defect list, not a verdict: each one's last run failed or rolled back, so
each needs either a fix that lets its script finish (then it is spent and joins this list) or a retirement with the evidence that its host is served
some other way. attach-surface-routes is not retired on the 301s alone: its last record lists ipatent.me, qwave.tech, q-wave.tech and
empoweringchange.today (and their www names) as present but unverified, and those names did not connect from outside on 2026-11-05 (curl status 000). They are filed with that wording in `agent_issues` (TP-3b follow-up, migration `2026-11-04-c5-resilience-footprint-tp3b.sql`).

To attach a new host again: copy `scripts/attach-me-q08-route.py` and write a workflow of the same shape (`git show 2fc57e0c:.github/workflows/attach-me-q08-route.yml`
is the template; a copy of the deleted file is in git history). `docs/DOMAINS.md` has the table and the plane rule.
