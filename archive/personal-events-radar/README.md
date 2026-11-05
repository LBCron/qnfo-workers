# personal-events-radar worker (QNFO.OPS.010 Stage B, 2026-09-02)

PERSONAL-QNFO-SEPARATION-1 rebuild (v1.1.0): the personal plane scans PERSONAL-LIFE venues
only - museums (Rijksmuseum, Van Gogh, Stedelijk), Concertgebouw, Vondelpark Openluchttheater
(he volunteers there), and I amsterdam city culture listings. NO work/research interest
taxonomy, NO research venues. Work events live in events-radar (work plane); trips and booked
personal events live in the personal-life attendance ledger.

Weekly cron scan (Tue 05:30 UTC). Hard gates applied in order:

1. standing filter - QPL / CWI topics excluded (profile facet, conf 0.95)
2. Schengen exit deadline 2026-10-17 - onsite Amsterdam events blocked on/after that date
3. in-person TRAVEL budget - local Amsterdam events are exempt; H2 2026 travel budget SPENT
4. room-question gate - venue affinity ranks energizing venues up
5. tasting-menu protocol - 3-5 cheap local experiments over the next 90 days

Cleared events (relevance >= 3 + keyword evidence) are POSTed to calendar-api
/events?plane=personal (source=personal-radar, status=tentative); dedupe key = venue+dtstart.
Report persisted to D1 qnfo-audit.personal_radar and delivered to obsidian-writer
(section "Personal Events Radar").

Endpoints:
- GET /           -> latest report (markdown)
- GET /?run=1     -> trigger scan now (JSON result)
- GET /health     -> { ok, worker, version }
- scheduled()     -> weekly cron trigger

Deploy (working copy only; canonical source = the GitHub remote):
cd qnfo-workers/personal-events-radar && wrangler deploy
