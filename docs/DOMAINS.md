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
| `mind.q08.org` (custom domain and zone route) | personal | q08-mind (MIND-Q08-1, the inside reading surface) | yes; added by CF-ESTATE-1, served for weeks and absent from this table |
| `watch.q08.org` | personal | personal-watch | yes; added by CF-ESTATE-1 |
| `reading.q08.org` (custom domain) | personal | personal-companion | yes |
| `travel.q08.org` | personal | personal-companion | yes |
| `q08.org`, `www.q08.org` | personal | q08-signal-engine | yes |
| `personal.qnfo.org` | personal | personal-api | no, research domain: DOMAIN-PLANE-1:personal.qnfo.org (100228). Still answers, unchanged, for clients configured before 2026-10-19; every tracked document now gives `me.q08.org` |
| `qnfo.org`, `www.qnfo.org`, `legal.`, `papers.` (custom domain), `archive.`, `graph-api.` (custom domain) | research | qnfo-gateway | yes |
| `ai.qnfo.org` | research | qnfo-ai | yes |
| `ops.qnfo.org` | fleet | qnfo-ops | yes |
| `agents.qnfo.org` (custom domain) | fleet | qnfo-agents | yes; added by CF-ESTATE-1 |
| `lee.qnfo.org` (custom domain) | fleet | qnfo-fleet-lee (a live script with no source directory here; `python3 scripts/cf_estate.py worker-inventory` lists it as unmanaged) | kept; added by CF-ESTATE-1 |
| `hub.qnfo.org`, `design.qnfo.org`, `hensel.qnfo.org`, `measure.qnfo.org`, `quantum.qnfo.org`, `unity.qnfo.org` | research | Pages project `qnfo-hub` (six static landing pages of about 6 KB, titled "QNFO - Hub", served 200 on 2026-11-04; `www.qnfo.org` is also listed on that project and is shadowed by the qnfo-gateway route) | kept (static); added by CF-ESTATE-1 |
| `fleet.qnfo.org` | fleet | qnfo-fleet-dashboard | yes |
| `ideas.qnfo.org` | research | idea-hub | yes |
| `memory.qnfo.org` | fleet | qnfo-memory-mcp | yes |
| `research-exec.qnfo.org` | research | qnfo-research-exec | yes |
| `ipatent.qnfo.org`, `qnfo.org/ipatent*` | research | qnfo-ipatent | yes |
| `qnfo.org/email/*` | fleet | qnfo-email | yes |
| `analytics.`, `lifecycle.`, `scorecard.`, `fleet-executor.`, `fleet-scheduler.`, `agent-orchestrator.`, `qnfo-arxiv-radar.`, `qnfo-paper-reviser.`, `qnfo-secrets-audit.`, `qnfo-system-health.`, `qnfo-citation-watch.`, `qnfo-research-radar.`, `qnfo-calibration-audit.` `.qnfo.org` | research / fleet | qnfo-lifecycle (members) | yes |
| `qwav.org` | quantum | qnfo-gateway (route `qwav.org/*`, QWAV page, QWAV-DEMOS-1) | yes; canonical quantum host |
| `www.qwav.org`, `qwav.net`, `qwav.uk`, `www.qwav.uk`, `www.qwav.net` | quantum | qnfo-gateway or qnfo-lifecycle route, 301 to `https://qwav.org` | yes, a redirect |
| `score.qwav.tech` | quantum | zone redirect rule, 301 to `https://qwav.org/` | yes, a redirect |
| `deep.qwav.tech`, `primer.qwav.tech` | quantum | Pages project `qwav` (about 500 static research pages under `/papers/`, no other host serves them) | kept; do not detach without migrating those pages |
| `ask.qwav.org` | quantum | qnfo-ai-search | yes |
| `ask.qwav.tech` | quantum | qnfo-ai-search (zone route `ask.qwav.tech/*`; the Pages project `ask-qwav` also lists the name and is shadowed by the route) | no, quantum surface on `qwav.tech`, not `qwav.org`: DOMAIN-PLANE-1:ask.qwav.tech |
| `qwav.tech` | quantum | zone redirect rule, 301 to `https://qwav.org` | yes, a redirect |
| `www.qwav.tech` | quantum | zone redirect rule, 301 to `https://qwav.org`; added by CF-ESTATE-1 | yes, a redirect |
| `qwave.tech`, `q-wave.tech`, `www.qwave.tech`, `www.q-wave.tech` | quantum | zones active in the account, public DNS answers NXDOMAIN (registrar delegation lost, 2026-11-04; `dns-drift` reports `delegation_lost`; human_actions 65 and 102 are the registrar decisions) | no |
| `ipatent.me`, `www.ipatent.me` | research | spare zone with a 301 to `https://ipatent.qnfo.org`; public DNS answers NXDOMAIN (registration lapsed, human_actions 65 and 73; `dns-drift` reports `delegation_lost`, measured 2026-11-05), so nothing reaches the redirect | no |
| `empoweringchange.today`, `www.empoweringchange.today` | research | spare zone with a 301 to `https://qnfo.org`; public DNS answers NXDOMAIN (human_actions 65; `dns-drift` reports `delegation_lost`, measured 2026-11-05), so nothing reaches the redirect | no |
| `qnfo.net`, `qnfo.uk` | research | spare zones (CNAME to `qnfo.org`, zone redirect), 301 to `https://qnfo.org`; added by CF-ESTATE-1 | yes, a redirect |

Workers reached only by their `*.workers.dev` host serve machines (probes, service-binding callers). A check of `q08.workers.dev` strings in the
owner-facing workers on 2026-10-20 found origin calls and probes, not an address printed for the owner.

## Verification (CF-ESTATE-1, NEXT-QNFO.INFRA.DNS)

The host table above is checked against the account, not remembered:
- `python3 scripts/cf_estate.py doc-check` (offline, also a PR guard when this file changes): the table parses and the plane rules hold (personal hosts only on `q08.org`, every `q08.org` host personal, quantum hosts and `qwav.*` hosts agree). A row marked `no` is the record of a known wrong place, not a violation.
- `python3 scripts/cf_estate.py dns-drift --live` (workflow `cf-estate`, action `dns-drift`; the repository token): every documented host must be answered by a zone route, a worker custom domain, a Pages domain, a redirect rule or a DNS record (`missing`); every served host must be named here (`undocumented`); a Pages domain that a worker route also answers is `shadowed_pages` (the route wins and the deployment serves nothing); a CNAME to a `*.workers.dev` or `*.pages.dev` target that is no longer in the account is `dangling_target`; an unproxied record to either is `unproxied_web` (it answers 522 or 1014); a zone whose public NS differ from Cloudflare's assignment is `delegation_lost` (qwave.tech, q-wave.tech, ipatent.me and empoweringchange.today on 2026-11-05). `stray_redirect` is a redirect rule that names a host of another zone (it can never match). `missing`, `dangling_target`, `unproxied_web` and `plane_violation` are the hard findings (`--strict` exits 1 on them; the report run exits 0 and carries the count in `RESULT_JSON`).
- `pages-inventory` gives each Pages project a verdict (keep, active, document, retire-candidate) from the same table; `worker-inventory`, `r2-inventory` and `d1-query-report` are the other estate reports. A retirement or a detach is a separate, guarded step after a dependency check (CLAUDE.md, standing owner grant); these actions never write.
- `mcp.q08.org` (CNAME to `gateway.agents.cloudflare.com`) is a DNS-only record, not a served host of this fleet's workers, and is not listed.
