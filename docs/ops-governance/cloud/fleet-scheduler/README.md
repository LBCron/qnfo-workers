# fleet-scheduler

Dynamic cron dispatcher (fleet consolidation 79->10, phase 1).

- `worker.js` — per-minute scheduled tick: reads `fleet_crons` from qnfo-audit D1, dispatches due jobs to fleet-executor via the EXECUTOR service binding, advances last_fired/next_fire.
- `metadata.json` — deploy metadata (AUDIT D1 + AI + EXECUTOR service binding); cron trigger `* * * * *` via schedules API.
- Endpoints: GET /health, POST /tick (manual evaluation of due crons — used for tests).
- Cron definitions are D1 data — scheduling changes are UPDATEs, not redeploys.
- v0.1.0 deployed 2026-09-10. Canonical: QNFO/qnfo-ops cloud/fleet-scheduler.
