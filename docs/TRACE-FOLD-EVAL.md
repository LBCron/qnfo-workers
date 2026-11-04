# Event ledger and folded run state for long qnfo-ops runs (TRACE-FOLD-1)

Charter pillar: autonomy. Roadmap item RM-TRACE-FOLD-1 (agent_issues 1000650, roadmap 1693). Sources: arXiv 2609.01466 (ledger plus fold, full text read), 2610.08364 (turn-axis timeline, partly read). The paper benchmark used its own tasks (n=30), so the gain is re-measured here before it is kept.

## What shipped (qnfo-ops 2.63.0)

- `qnfo-audit.ops_run_events` (`run_id, seq, ts, kind, tool, args_sha, ok, bytes_out, detail`) gets one row per tool call of a long run. The loops that own a run id write it next to the audit row: the job workflow with its job id, the agent Durable Object with its conversation id (`opsRunEventAppend`). The main chat loop has no run id and writes nothing. Arguments are hashed (16 hex characters of SHA-256), never stored; `detail` holds `{ms, status, error}` with the error capped at 160 characters. A write failure never fails the call.
- `kind` is `tool`, or `tool-rejected` for a caller-input mistake (`arg_error`, `rejected`, `user_code_error`), so the fold counts real errors apart from wrong arguments. A `not_found` answer is an ok call.
- `foldRunState(events)` is a pure function that returns the typed run state: `calls`, `tools_used`, `tool_counts`, `errors` (at most 20), `error_count`, `rejected_count`, `last_error`, `bytes_out_total`, `open_items`, `first_ts`, `last_ts`.
- `GET /v1/run-state?run_id=<id>` (owner key, like `/v1/tools`) reads up to 1000 events of one run and returns `{run_id, truncated, state}`.

The first appender, inside `logToolEvent`, read the run id from the model's own tool arguments (never present) and omitted the `NOT NULL` `seq` column, so the table was empty from 2026-10-28; `qnfo-ops/trace-fold.test.mjs` now writes through the real DDL.

## How the 20 long tasks are measured

1. A long task is a run with at least 10 tool calls (`ops_run_events` rows per `run_id`).
2. Baseline: the same task through current context handling (`opsBoundRound` compaction of the raw transcript), tokens per task from `ops_ai_log` (`prompt_tokens + completion_tokens` for the job id) and success from the job's final status.
3. Treatment: the same task with the folded run state (from `GET /v1/run-state`) injected in place of the compacted transcript prefix; same measures.
4. Keep the fold only if tokens per task fall with no silent truncation and no drop in task success. The sample size is itself measurable: `SELECT COUNT(*) FROM (SELECT run_id FROM ops_run_events GROUP BY run_id HAVING COUNT(*) >= 10)`.

## Pending: the 20-long-task result

Reading the fold into the agent context in place of the raw transcript, and the per-run token timeline over `ops_ai_log`, are the later tasks the issue names. They are filed as `ROADMAP-1: QNFO.OPS RM-TRACE-FOLD-1.2`, with this file as the code anchor. The issue stays open until the measured tokens per task and task success on 20 long tasks are recorded here.
