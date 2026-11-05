# qnfo-events

Email -> event -> calendar/reminders intake worker (EMAIL-EVENT-CALENDAR-LIVE-1).

Parses forwarded event/appointment/confirmation mail (`.ics` VEVENT, TZID-aware -> UTC,
or AI extraction fallback) and writes it to calendar-api with `source=email`,
scheduling reminders at -1440 and -60 min.

- Bindings: D1 (qnfo-audit), AI, SEND_EMAIL (allowed: rwnquni@outlook.com), CAL_API (service -> calendar-api)
- Secrets: INGEST_TOKEN, CAL_EMAIL_TOKEN
- Cron: `*/5 * * * *` (reminder dispatch)
- Endpoints: `POST /ingest`, `POST /feedback`, `GET /run-reminders`, `GET /inbox|/reminders|/prefs`, `GET /health`
- D1 tables (qnfo-audit): event_inbox, event_reminders, event_feedback, event_prefs
- Canonical source: this directory. Deploy with `wrangler deploy` (or the Workers API).
