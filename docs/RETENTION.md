# Data minimisation and retention policy — DRAFT for owner review

Status: **DRAFT, 2026-10-26** (BP26-RETENTION-1, agent_issues 1000344). Written by an automated fleet session. **Every period below is a proposal** (`retention_policy.policy_status = 'proposed'`); none is a statement of what the law requires of the owner. The only figure taken from outside is the catalogue's: the e-mail agent keeps message bodies at most 30 days (BP26 item 4.3). **Nothing is deleted by this policy today**: the fleet counts what is past each period and waits for the owner's decision (card `bp26-retention-enforce`, IDENTITY-BOUND, because deleting mail-derived personal data is irreversible). Related: docs/ROPA.md (the activities), docs/dpia/ (the risks).

## 1. How it works

- The registry is the table `retention_policy` in qnfo-audit (migrations/2026-10-26-bp26-privacy.sql): one row per policy with its database, table, the columns a sweep would blank, the period, whether it is personal data, the basis, and the read-only `SELECT COUNT(*)` that counts rows past the period that still hold the data.
- The 13 policies on qnfo-audit tables are counted hourly by the trigger `bp26_retention_heavy_tick` on `fleet_tick_heavy`. The 6 policies on other databases (ipatent-db, q08-signal, living-paper) are counted by `scripts/bp26_privacy.py collect_retention_other_dbs` in the remediation-consumer job, which writes the count into the row. The metric `records_past_retention` is the sum (target 0).
- `enforcement` is `report` for every row. The sweep exists since BP26-RETENTION-SWEEP-1 (2026-11-05) and is dormant: `scripts/retention_sweep.py`, run by the table-sweep stage of `scripts/continuity_snapshot.py` in the `audits` job of the remediation consumer, changes nothing unless `ops_config.retention_enforce = 'on'` AND the policy row says `enforcement = 'enforce'`. Until then each run is a dry run that writes the exact number of rows it would blank or delete into `retention_policy.note` (only when the text changed), so the owner's card quotes live numbers. No copy of removed content is made (a backup of personal data would keep what the policy removes); the record is the count and a `cloud_ops_events` row of kind `retention-sweep`.
- The personal plane (personal-life: the twin, the companion list) is not read by the research runner and is not counted here; its own periods are in the twin DPIA (open question 4).

## 2. The policies (proposed)

| Policy key | Database and table | What the sweep would blank or delete | Period | Why (proposal) | Past period on 2026-10-26 |
|---|---|---|---|---|---|
| `emails_bodies_30d` | qnfo-audit `emails` | body_text, body_html, headers_json | 30 days | Storage limitation; BP26 item 4.3 | **683** |
| `email_raw_archive_30d` | qnfo-audit `email_raw_archive` | raw_text | 30 days | The raw message holds everything the parsed body does plus attachments | **5** |
| `email_loop_quarantine_30d` | qnfo-audit `email_loop_quarantine` | body_text | 30 days | A copy kept only to explain why a message was not processed | **105** |
| `email_reply_queue_drafts_90d` | qnfo-audit `email_reply_queue` | draft_text, draft_proposed | 90 days | A draft quotes the sender; the decision row stays | 0 |
| `email_commands_180d` | qnfo-audit `email_commands` | command_text, result | 180 days | The owner's commands, kept to audit what the fleet did | 0 |
| `email_parse_failures_90d` | qnfo-audit `email_parse_failures` | content_hint | 90 days | The issue it raised carries the fix | 0 |
| `subscribers_pending_30d` | qnfo-audit `subscribers` | the row (an unconfirmed opt-in) | 30 days | No consent was ever given | 0 |
| `subscribers_unsubscribed_30d` | qnfo-audit `subscribers` | the row; `email_suppression` stays | 30 days | The suppression record is the minimal proof of an opt-out | 0 |
| `contact_ledger_1095d` | qnfo-audit `contact_ledger` | the row, unless suppressed | 1,095 days after last contact | Three years without contact; suppressed rows stay so nobody is approached twice | 0 |
| `mcp_log_90d` | qnfo-audit `mcp_log` | args, result | 90 days | Tool arguments and results can hold addresses and message text | 0 |
| `email_calendar_delivery_90d` | qnfo-audit `email_calendar_delivery` | finished rows | 90 days | A finished reminder or acknowledgement | 0 |
| `handoffs_email_180d` | qnfo-audit `handoffs` | summary, pending_work, next_action of strategic-mail handoffs | 180 days | A handoff summarises a sender and a snippet | 0 |
| `emails_metadata_365d` | qnfo-audit `emails` | the row (who, when, subject) | 365 days | Reply and audit trail for a year | 0 |
| `ipatent_sessions_90d` | ipatent-db `sessions` | the row (raw IP address, user agent; a legacy table, last written 2026-07-12) | 90 days | Counters keep what is needed | **11** (runner) |
| `ipatent_analytics_90d` | ipatent-db `analytics` | the row | 90 days | Legacy per-event analytics (last written 2026-07-12) with a raw IP address | **41** (runner) |
| `ipatent_submission_ip_90d` | ipatent-db `submissions` | ip_address, user_agent | 90 days | Not needed once the draft is delivered | **41** (runner) |
| `ipatent_submissions_730d` | ipatent-db `submissions` | the row | 730 days | Two years after writing unless the submitter asks to keep it | 0 (runner) |
| `q08_subscribers_pending_30d` | q08-signal `subscribers` | the row | 30 days | Unconfirmed opt-in | 0 (runner) |
| `living_paper_email_logs_30d` | living-paper `email_logs` | the row | 30 days | A mail log with sender, subject and body; empty today | 0 (runner) |

Total: 793 on qnfo-audit at apply, 886 after the runner's first count of the ipatent-db rows (11 + 41 + 41). The counts were read on 2026-10-26 before the migration was written; the live value is `SELECT last_value FROM metric_registry WHERE metric = 'records_past_retention'`.

## 3. Not in the registry, and why

- **Copies in the weekly R2 exports (read 2026-11-05).** `qnfo-backups` holds a full export of qnfo-audit every week since 2026-10-13 (`export/qnfo-audit/20261013` ... `20261104`, five snapshots; `emails.jsonl.gz` 2.7 MB and `email_raw_archive.jsonl.gz` 1.6 MB in the newest), the same for ipatent-db and q08-signal, and the bucket's lifecycle has only the default multipart-abort rule: nothing expires. A D1 sweep alone therefore leaves every body it removes in R2 for good. While `retention_enforce` is on, new exports set the mail-content columns to NULL (`EXPORT_BLANK` in `scripts/retention_sweep.py`; whole-row delete policies are not blanked in an export, which keeps the rows a restore needs). The five existing snapshots keep what they hold until an expiry rule or a rewrite removes them; deleting backups is irreversible and is part of the owner's answer (issue BP26-RETENTION-EXPORTS-1 builds the `r2-lifecycle` action; it applies nothing before the answer).
- **R2 objects and lifecycle rules.** The BP26 item also names R2 lifecycle rules. Which buckets hold personal data (ipatent `r2_key` documents, mail attachments if any) has not been read; this is a code task for the owners of qnfo-ipatent and qnfo-email.
- **AI Gateway.** Read from the Cloudflare API on 2026-10-26, gateway `default` has payload logging on (`collect_logs`), keeps up to 2,000,000 logs and deletes the oldest first (a count, not a period), caches responses for 2,628,288 s (about 30 days), has Logpush off and zero data retention off. Calls that name this gateway are stored there. The twin (personal-api) names it on every model call with no `collectLog` or `skipCache` option, so the owner's prompts and answers are held in the logs and the cache (docs/dpia/personal-twin.md, risk 2); the reply path of the e-mail agent and every model call of qnfo-ipatent name no gateway (read from the code the same day). BP26 item 4.3 asks for payload logging off on mail calls.
- **Workers Logs and GitHub Actions logs.** Retention of Workers Logs is set by the Cloudflare plan, not by a table. On 2026-10-26, the measured exposure was crawler `From` request headers: 57 to 83 address matches in each 2,000-event sample (the runner's measurement was 83, in qnfo-gateway, idea-hub and q08-signal-engine). A live 2,000-event sample on 2026-11-02 also found raw addresses in qnfo-email's platform-generated mail invocation fields (`$workers.event.mailFrom`, `$workers.event.rcptTo`, `source.message` and `$metadata.message`); no address values were retained. The qnfo-email Wrangler configuration disables invocation logs while keeping application logs and traces enabled.
- **Social replies metadata** (`social_replies`: a hash of the author and a text length) and **cloud_ops_events**: no personal content; a period of 365 days is proposed for the first and is not registered yet.
- **Published artifacts** (papers, essays, forecasts) are permanent by design; corrections and retractions follow BP26-CORRECTIONS-FEED-1.

## 4. What happens next

1. The owner answers the card: `enforce`, `adjust <policy_key> <days>` (the registry row is changed by a migration; the sweep refuses a period under 7 days), or `keep`.
2. On `enforce` the fleet runs one migration, nothing is built: `UPDATE retention_policy SET enforcement = 'enforce', policy_status = 'adopted'; INSERT OR REPLACE INTO ops_config (key, value, note) VALUES ('retention_enforce', 'on', 'owner answered enforce on <date>');`. The next table-sweep stage of the consumer (about every 40 minutes) blanks or deletes up to 1,000 rows per policy per run, in batches of 100; `records_past_retention` is expected to read 0 within two heavy ticks after the last batch. Blank policies run before delete policies.
3. Guards that hold whatever the answer: rows the never-email-twice record needs are never deleted (contact_ledger rows with `suppress = 1` or `reply_count > 0`, subscribers that unsubscribed without an `email_suppression` row); a registry row whose table differs from its compiled spec, or whose key has none, is refused; every statement is built from the compiled `SWEEPS` list, never from D1 text.
4. Stop: `UPDATE ops_config SET value = 'off' WHERE key = 'retention_enforce'`. There is no revert of a value already blanked or a row already deleted; that is why the switch is the owner's.
5. On `keep` the fleet records the periods as not adopted in `decision_log` and rescopes the metric to adopted policies.
6. Still open after an `enforce`: the existing R2 export snapshots (section 3) and the R2 objects of ipatent `r2_key` documents; both are separate irreversible deletions with their own issues.

## 5. Review log

| Date | Change | By |
|---|---|---|
| 2026-10-26 | First draft; periods are proposals | fleet session rem-a8-privacy (BP26-RETENTION-1) |
| 2026-11-05 | The sweep is built and dormant; the weekly R2 exports are named as copies the D1 sweep does not reach | W2-A (BP26-RETENTION-SWEEP-1, roadmap row 1400) |
