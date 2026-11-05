# events-radar worker (QNFO.OPS.009 — supersedes conference-radar QNFO.OPS.008, 2026-09-02)

Weekly cron scan (`0 5 * * 1` UTC) of event/calendar pages across ALL active QNFO
research domains: conferences, workshops, seminars, colloquia, webinars, meetups,
summer schools, lectures and submission deadlines (WBS.TAXONOMY 2026-08-29 domains:
ADL/UMP/SLB/INM/QD/CMP/JPC/SR/CON/CGS/ODR/PBO/CFE/LOG).

Every dated event is scored on two axes:
- **Relevance** — keyword hits against the 14 active-domain taxonomies over the event
  snippet; venue-level domain affinity counts as weak evidence when the snippet has no
  keyword hit. Relevance 0 (no evidence) is excluded from Top picks.
- **Attendance friction** — kind (webinar 0 … conference 5) + delivery (online 0 …
  onsite 3) + cost (free 0 … paid 2).
- **priority = 10 × relevance ÷ (1 + friction)** — by design a free 1-hour relevant
  webinar (friction 0) outranks a paid conference requiring travel (friction 10).

Parallel scan of 24 curated venues (per-venue 8s AbortController timeout; one venue
down never kills the scan), extracts dated event entries (heuristic regex), verifies a
canonical high-value catalog against live source pages (VERIFIED / CANDIDATE-UNVERIFIED),
flags submission deadlines (PASSED/IMMINENT/UPCOMING/FUTURE), renders a markdown radar
report, delivers to obsidian-writer (R2 vault -> D:/Obsidian) and qnfo-email
(alerts@qnfo.org), and persists to D1 qnfo-audit.events_radar (dedup on slug via
INSERT OR REPLACE).

Endpoints:
- GET /           -> latest report (markdown)
- GET /?run=1     -> trigger scan now (JSON result)
- GET /health     -> { ok, worker, version }
- scheduled()     -> weekly cron trigger

Deploy (canonical source = this repo dir):
`cd qnfo-workers/events-radar && npx wrangler deploy`
Secret: `EMAIL_API_KEY` (x-api-key for qnfo-email /send) — same value as conference-radar.

Supersession: conference-radar (QNFO.OPS.008) kept deployed for rollback but its weekly
cron was disabled on 2026-09-02 after events-radar v1.0.0 verified live; events_radar is
the canonical radar table, conference_radar is historical.
