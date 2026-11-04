# Policy gate replay (POLICY-GATE-1)

Charter pillar: security. Roadmap item RM-POLICY-SMT-GATE-1 (agent_issues 1000649, roadmap 1692). Extends BP26-PROMPT-INJECTION-1 (1000359). Sources: arXiv 2603.20449 (Z3 check of tool calls, full text read), 2610.12813 (VEPA, partly read).

## The gate today

`policyGateShadowDecision(name, args)` in `qnfo-ops/worker.js` is a pure function with three hand-written rules for the irreversible classes: email send (`email-send-existing-thread`), publish (`publish-explicit-confirmation`) and delete (`delete-explicit-confirmation`). `policyGateShadow` runs it before every tool dispatch and, in `ops_config policy_gate_mode` shadow (the default), writes one `cloud_ops_events` row of kind `policy-gate-shadow` per call a rule covers (`would_block` true or false, rule id, reason; never the arguments). It never blocks and its failure never fails a tool call. No solver is involved: a Worker cannot load Z3, so this is the deterministic predicate layer the paper's solver would check.

## Replay method

`node scripts/policy_gate_replay.mjs` loads the decision function from the worker source and replays labelled calls. A case is `{tool, args, label}`: label `block` is an incomplete or unconfirmed irreversible call the gate should flag, `allow` is a complete confirmed call or a call no rule covers. Precision is flagged-and-block over flagged, recall is flagged-and-block over block. `--events <file>` replays rows exported from `cloud_ops_events` (kind `ops_ai_tool`), labelled by what the authoritative check decided (rejected or error = block, ok = allow); `--min-precision` and `--min-recall` make it a gate. `qnfo-ops/policy-gate-replay.test.mjs` runs it in CI.

Production traffic is almost empty: `cloud_ops_events` holds no call of the three classes since 2026-09-01 except 15 `ops_d1_write` calls on 2026-10-29 (12 ok, 3 rejected). Ten of those are truncated in the audit log (600-character cap) and cannot be replayed; of the five that are whole, one is a delete (`DELETE FROM products WHERE slug=...`, confirmed, ok) and it is in the corpus as `real-2026-10-29-d1-delete`. So there is almost nothing to replay and the `policy-gate-shadow` row count stays 0 until an irreversible call happens. The measurement below is therefore on the hand-labelled corpus `qnfo-ops/policy-gate-corpus.json` (50 cases: 22 labelled block, 28 labelled allow, 10 of them ordinary-tool controls, 1 real production call). Say so whenever the number is quoted: it is a corpus measurement, not a traffic measurement.

## Replay result

Measured on 2026-11-05 on the corpus, before and after the one fix the first run motivated:

| | cases | flagged correctly (tp) | flagged wrongly (fp) | missed (fn) | precision | recall |
|:--|--:|--:|--:|--:|--:|--:|
| rules as shipped in 2.62.20 | 50 | 19 | 1 | 3 | 0.9500 | 0.8636 |
| after the D1 delete pattern fix (2.63.0) | 50 | 22 | 1 | 0 | 0.9565 | 1.0000 |

- The three misses were destructive SQL the first pattern could not see: a delete behind a leading `/* ... */` or `-- ...` comment and a `WITH ... DELETE`. The pattern now skips leading comments and a WITH clause.
- The one false positive is `SLACK_REMOVE_REACTION`: any slug containing `remove`, `delete` or `destroy` is treated as a deletion. It is the conservative side; narrowing it needs a per-toolkit list and would trade recall for precision.
- Calls outside the three classes are not covered, by design of the issue: `SLACK_SEND_MESSAGE`, `cf_worker_deploy`, `kv_put` overwrites and a mass `UPDATE` have no rule (`out_of_class` in the corpus; the test fails when a rule starts covering one, so the corpus and this table move together).

Failure mode stated plainly: a corpus written by the rule's author flatters the rule. The labels were written from the issue's three classes, not from observed traffic, so recall 1.0 here says the rules do what they were written to do and says nothing about calls nobody thought of. That is why the gate stays in shadow mode and why enforcement is a separate, later change that needs replay on real calls (`ROADMAP-1: QNFO.OPS RM-POLICY-SMT-GATE-1.2`).
