# qnfo-venue-radar

Multi-venue read radar (QNFO.LW.003, 2026-09-03). Fully-autonomous research-signal intake into the
qnfo-audit D1 for written-content venues that expose machine-readable surfaces but gate writes
behind human accounts (platform policy):

- LessWrong + Alignment Forum - shared official agent API (/api/search markdown), one surface.
- EA Forum - RSS feed (forum.effectivealtruism.org/feed.xml). No public REST API (404).
- Hacker News - Algolia JSON API (read).

Keyword buckets: EFF (energy efficiency computing), LAN (Landauer/reversible/thermodynamic limits),
BRA (brain efficiency), AIE (AI energy costs), QNT (Margolus-Levitin/quantum speed limit),
SELF (PaQit/QNFO self-watch).

## Deploy

    cd qnfo-workers/qnfo-venue-radar
    wrangler d1 execute qnfo-audit --remote --file=migrations/001_venue_radar.sql
    wrangler deploy

## Verify

    curl https://qnfo-venue-radar.<workers-subdomain>.workers.dev/health
    curl "https://qnfo-venue-radar.<workers-subdomain>.workers.dev/?run=1"

## Tables (qnfo-audit D1)

- venue_signal - one row per kept hit (UNIQUE venue+external_id+query dedupe).
- venue_radar_runs - per-venue audit rows (status/fetched/kept/detail).
- venue_radar_config - venue_radar_enabled kill switch (0 halts), last_run_utc backoff,
  review_due_at 2026-10-03 (30-day relevance/Vectorize review marker).

No email. No secrets.
