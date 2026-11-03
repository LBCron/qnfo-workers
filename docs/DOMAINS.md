# Which domain a surface lives on (DOMAIN-PLANE-1)

Owner directive, 2026-10-19 (verbatim): "all of this needs to be, routed through a subdomain. So for personal shit, use q08.org.
For research shit, use qnfo.org. Or for, in particular, stuff that's quantum computing, use qwave.org. ... Make this consumer
friendly. I'm the end user. I'm the consumer. Make it friendly and easy for me to remember."

| Plane | Domain | Examples |
|---|---|---|
| Personal (the owner's own life, the personal plane) | `q08.org` | `me.q08.org` (the companion: personal-api), `reading.q08.org` (personal-companion) |
| Research, the fleet and QNFO's public work | `qnfo.org` | `fleet.qnfo.org`, `archive.qnfo.org`, `ops.qnfo.org` |
| Quantum computing | `qwav.org` | `qwav.org`, `ask.qwav.org` |

The owner wrote "qwave.org"; the zone in the account is `qwav.org` (with `qwav.tech`), so quantum-computing surfaces use `qwav.org`.

Rules for every loop and session:
- A surface a person opens or types (a page, an app, an address in an e-mail) is on its plane's domain, on a short name a person
  can remember. A `*.workers.dev` host is an origin for machines and probes, never the address given to the owner.
- Personal surfaces never sit on `qnfo.org` or `qwav.org`, and research surfaces never on `q08.org` (the personal/research
  separation holds for addresses too). Mail about personal matters is sent from a `q08.org` sender where the zone allows it.
- The owner signs in with an e-mailed one-time code, never a key or token (OPEN-ACCESS-1, COMPANION-LOGIN-1). Keys stay for tools.
- A new host is attached through the repository token (zone route plus a proxied record, the pattern in
  `scripts/attach-me-q08-route.py` and `scripts/attach-surface-routes.py`) and verified from outside the account.
- A surface found on the wrong domain gets a `DOMAIN-PLANE-1:<host>` issue in `agent_issues`; it is moved by the loop or PR that
  owns the worker, keeping the old host as a redirect so links already sent keep working.

## Inventory

DOMAIN-PLANE-AUDIT-1 (agent_issues 100230), read 2026-10-20 from the fleet graph (`GET https://qnfo-memory-mcp.q08.workers.dev/fleet-graph/find?query=route:&kind=route`
and `kind=custom_domain`, then `/fleet-graph/impact?id=route:<pattern>&depth=1` for the serving worker, graph built 2026-10-20T05:39Z, 46 zone routes and
3 custom domains) and from a live `GET /` of each host a person opens. A host that is not listed here is a machine origin (`*.workers.dev`, service
bindings) or has no route. The graph reads routes and custom domains only; a name attached some other way is found by the repository token's zone read
(`scripts/cf_ops_actions.py`, the actions in its header). Regenerate this table when a route is attached; a host on the wrong plane gets its own
`DOMAIN-PLANE-1:<host>` issue (migrations/2026-10-20-domain-plane-inventory-issues.sql filed the two below).

| Host | Plane | Worker | Right place? |
|---|---|---|---|
| `me.q08.org` | personal | personal-api (the companion, `/v1`, `/mcp`) | yes; the address given to the owner |
| `jobs.q08.org` | personal | qnfo-jobsearch (the job matches page; zone route by `scripts/attach-jobs-q08-route.py`, DOMAIN-PLANE-1:jobs.q08.org, agent_issues 1000582) | yes; owner-facing address, verified 2026-11-02 by the live route and `/health` probe |
| `reading.q08.org` (custom domain) | personal | personal-companion | yes |
| `travel.q08.org` | personal | personal-companion | yes |
| `q08.org`, `www.q08.org` | personal | q08-signal-engine | yes |
| `personal.qnfo.org` | personal | personal-api | no, research domain: DOMAIN-PLANE-1:personal.qnfo.org (100228). Still answers, unchanged, for clients configured before 2026-10-19; every tracked document now gives `me.q08.org` |
| `qnfo.org`, `www.qnfo.org`, `legal.`, `papers.` (custom domain), `archive.`, `graph-api.` (custom domain) | research | qnfo-gateway | yes |
| `ai.qnfo.org` | research | qnfo-ai | yes |
| `ops.qnfo.org` | fleet | qnfo-ops | yes |
| `fleet.qnfo.org` | fleet | qnfo-fleet-dashboard | yes |
| `ideas.qnfo.org` | research | idea-hub | yes |
| `memory.qnfo.org` | fleet | qnfo-memory-mcp | yes |
| `research-exec.qnfo.org` | research | qnfo-research-exec | yes |
| `ipatent.qnfo.org`, `qnfo.org/ipatent*` | research | qnfo-ipatent | yes |
| `qnfo.org/email/*` | fleet | qnfo-email | yes |
| `analytics.`, `lifecycle.`, `scorecard.`, `fleet-executor.`, `fleet-scheduler.`, `agent-orchestrator.`, `qnfo-arxiv-radar.`, `qnfo-paper-reviser.`, `qnfo-secrets-audit.`, `qnfo-system-health.`, `qnfo-citation-watch.`, `qnfo-research-radar.`, `qnfo-calibration-audit.` `.qnfo.org` | research / fleet | qnfo-lifecycle (members) | yes |
| `qwav.org`, `www.qwav.org` | quantum | Pages project (301 to `/papers/`) | yes; canonical quantum host |
| `ask.qwav.tech` | quantum | qnfo-ai-search | no, quantum surface on `qwav.tech`, not `qwav.org`: DOMAIN-PLANE-1:ask.qwav.tech |
| `qwav.tech` | quantum | qnfo-gateway | no, quantum apex answering 200 on `qwav.tech`: DOMAIN-PLANE-1:qwav.tech |
| `qwav.net`, `www.qwav.net` | quantum | qnfo-lifecycle | spare name; the lifecycle worker answers it (SPARE-DOMAIN-CANON-1 covers `qwav.uk`, `qwave.tech`, `q-wave.tech`) |
| `qwav.uk`, `qwave.tech`, `q-wave.tech` (and `www.`) | quantum | spare zone, 301 to `https://qwav.org` | yes, a redirect (SPARE-DOMAIN-CANON-1) |
| `ipatent.me`, `www.ipatent.me` | research | spare zone, 301 to `https://ipatent.qnfo.org` | yes, a redirect |
| `www.empoweringchange.today` | research | spare zone, 301 to `https://qnfo.org` | yes, a redirect |

Workers reached only by their `*.workers.dev` host serve machines (probes, service-binding callers). A check of `q08.workers.dev` strings in the
owner-facing workers on 2026-10-20 found origin calls and probes, not an address printed for the owner.
