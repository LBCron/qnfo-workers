# fleet-executor

Models routed via AI Gateway dynamic routes -- see qnfo-ops issue QNFO/qnfo-ops#7.

Dynamic task execution engine (fleet consolidation 79->10, phase 1).

- `worker.js` — executes tasks defined as DATA in qnfo-audit D1: reads `fleet_tasks` rows (type: sql|ai|http), runs them, writes the `fleet_runs` execution ledger.
- `metadata.json` — deploy metadata (AUDIT D1 + AI bindings); deployed via Workers API PUT multipart (main_module worker.js).
- Endpoints: GET /health, POST /run {task_id, cron_name?}.
- Task definitions are D1 data — new "workers" are INSERTs into fleet_tasks + fleet_crons, not new bundles.
- v0.1.0 deployed 2026-09-10. Canonical: QNFO/qnfo-ops cloud/fleet-executor.
