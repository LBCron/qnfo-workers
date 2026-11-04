# QNFO Cloud Scheduler (qnfo-cloud-ops)

Models routed via AI Gateway dynamic routes -- see qnfo-ops issue QNFO/qnfo-ops#7.

Cloud replacement for the local DeepChat scheduled-task fleet.

- `worker.js` — single Worker hosting 12 jobs (11 cron + backfill; see AMS_SCHEDULE + JOBS in source)
- `metadata.json` — deploy metadata (bindings incl. OPS_VZ vectorize qnfo-cloud-ops; deploy via Workers API PUT multipart with `files` field)
- Cron triggers managed via the schedules API; DST self-adjust in weekly-ops.
- v1.2.0 SILENCE POLICY: personal inboxes receive ONLY the briefing with decision items, job failures, new DeepChat stable release, cost alert >$90, NLnet one-shot. Everything else lands in D1 cloud_ops_events + Vectorize index qnfo-cloud-ops (doc=cloud-ops, queryable via GET /search?q=).
- Secrets: INFRA_TOKEN, EMAIL_API_KEY, DIGEST_TO, GH_TOKEN, GMAIL_PASS, CF_TOKEN, OPS_ADMIN_TOKEN.
- Migration tracker: qnfo-audit.scheduler_migration.
