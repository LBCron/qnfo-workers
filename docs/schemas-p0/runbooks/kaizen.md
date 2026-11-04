# Kaizen ops cycle (continuous-improvement watchtower)

## 1 COLLECT CYCLE EVIDENCE: ops_ai_log failures, agent_issues, fleet drift, kaizen_candidates.
- WHY: Failed chats and drift auto-file tickets that feed the digest (KAIZEN-CHAT-FAIL-1).
- SCOPE: qnfo-audit D1 read.
- CONNECTOR: BY

## 2 DISPOSITION CANDIDATES SAME-CYCLE: every kaizen_candidate resolved/fixed/wontfix with evidence, never left 'proposed' past its due.
- WHY: 4 candidates sat 'proposed' across two weekly windows (KAIZEN-DISPOSITION-GAP-1).
- SCOPE: kaizen_candidates.status transitions.
- CONNECTOR: PROOF

## 3 GUARD SWEEP: prompt-store-verify.py, scheduler-guard.py, model_guard.py, adversarial-guard.py all exit 0.
- WHY: Guards are the code-parsable enforcement surface; a failing guard blocks the cycle.
- SCOPE: Local guard suite run with evidence captured.
- CONNECTOR: PROOF

## 4 DUAL-WRITE PARITY: 7 prompt stores byte-identical + header==footer==title + 11/11 CMD templates.
- WHY: Footer-drift and template-count regressions are the classic silent prompt-store bugs (PROMPT-PARITY-1).
- SCOPE: All prompt stores + CMD template stores.
- CONNECTOR: PROOF

## 5 REGISTER DISPOSITION: resolve open task_dod_register rows autonomously (execute now / dated-scheduled / cancel-with-rationale); v_waiting_on_human == 0.
- WHY: Owner-assigned-only closeouts are forbidden; user-free resolution is standing (USER-FREE-RESOLUTION-1, NO-DEFERRED-ZERO-1).
- SCOPE: task_dod_register + intent queues.
- CONNECTOR: PROOF

## 6 SKILL VERSION BUMP: bump every skill changed this cycle with a changelog entry.
- WHY: SKILL version drift breaks the N-2 drift check and the skill registry (SKILL-REGISTRY-GAP-1).
- SCOPE: Owned skills only.
- CONNECTOR: PROOF

## 7 CLOSEOUT: handoffs + wbs_state written; zero user-deferred items.
- WHY: Canonical closeout tables are qnfo-audit.handoffs + wbs_state (CLOSEOUT-HANDOFF-TABLE-1).
- SCOPE: Same-turn evidence for every 'done' claim.
- CONNECTOR: PROOF

The kaizen cycle turns evidence into change in one pass: collect, disposition, sweep, verify parity, resolve, bump, close. No step waits for a human.
