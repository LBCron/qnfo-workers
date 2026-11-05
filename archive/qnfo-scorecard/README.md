# qnfo-scorecard

Systems-level report card worker (AF-1 integration).

- `worker.js` — scores the fleet as a SYSTEM against autonomy/intelligence rubrics (SAE-J3016-adapted, NIST ALFUS, Sheridan-Verplank LOA, VSM, OODA closure, AF-1 ladder L0-L3, ALVE-1, Watchmaker Index). Emits envelope `kind=report-card`, self-records into `codeparse_events` (mini-validator before write).
- `wrangler.toml` — deploy config (AUDIT D1 binding).
- Endpoints: GET /health (Worker Contract v1), GET /api/report-card.
- Grade bands: A>=90 (human-level autonomy target), B>=75, C>=60, D>=45, F<45. A is scored, never claimed without evidence.
- v1.0.0 deployed 2026-09-10. Canonical: QNFO/qnfo-workers qnfo-scorecard.
