-- CF-ESTATE-1 corrections (2026-11-05, pillar core; follow-up of PR 7413 and migrations/2026-11-04-c4-next-infra-roadmap-closeout.sql, which merged and applied at 00:52Z).
-- Three statements in the texts that file wrote were stronger than what was read, and one count was short. The merged file is not edited (the runner re-applies an edited file,
-- MIGRATION-NO-CLOBBER-1); each correction is appended once to the text it corrects (an instr guard makes a replay a no-op).
--   * DNS: public DNS answers NXDOMAIN for FOUR of the twelve zones, not two: qwave.tech, q-wave.tech, ipatent.me and empoweringchange.today (DNS over HTTPS read 2026-11-05 for all
--     twelve; the other eight answer julian and melinda.ns.cloudflare.com). docs/DOMAINS.md said ipatent.me and empoweringchange.today were working redirects; it now says no.
--   * WORK: the qnfo-workers registry row is state retired and was updated at 2026-11-04T23:00Z; "retired since" read more into it than the row records.
--   * D1: that the cron-faults migrations of 2026-11-04 took cron_fault_seen out of the top statements is the likely cause, not a measured one.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET description = substr(description, 1, instr(description, char(10) || char(10) || 'CORRECTION 2026-11-05 (c4-next):') - 1) WHERE source = 'cf-estate-1' AND instr(description, char(10) || char(10) || 'CORRECTION 2026-11-05 (c4-next):') > 0; UPDATE roadmap_implementation SET evidence = substr(evidence, 1, instr(evidence, ' Correction 2026-11-05 (c4-next):') - 1) WHERE id = 612 AND instr(evidence, ' Correction 2026-11-05 (c4-next):') > 0;
-- spof-review: data change only; no cron, trigger, binding, host or credential.

UPDATE agent_issues
SET description = description || char(10) || char(10) || 'CORRECTION 2026-11-05 (c4-next): the service_registry row of qnfo-workers is state retired and was updated at 2026-11-04T23:00Z; the text above said retired since that time, which the row does not record.',
    updated_at = datetime('now')
WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.WORK #1: %'
  AND instr(description, 'CORRECTION 2026-11-05 (c4-next):') = 0;

UPDATE agent_issues
SET description = description || char(10) || char(10) || 'CORRECTION 2026-11-05 (c4-next): public DNS answers NXDOMAIN for four of the twelve zones, not two: qwave.tech, q-wave.tech, ipatent.me and empoweringchange.today (DNS over HTTPS read 2026-11-05 for all twelve; the other eight answer julian and melinda.ns.cloudflare.com). The registrar cards are human_actions 65, 73 and 102 (resolved). docs/DOMAINS.md said ipatent.me and empoweringchange.today were working redirects and now says no. dns-drift reports all four as delegation_lost; this issue does not change a registration.',
    updated_at = datetime('now')
WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.DNS #1: %'
  AND instr(description, 'CORRECTION 2026-11-05 (c4-next):') = 0;

UPDATE agent_issues
SET description = description || char(10) || char(10) || 'CORRECTION 2026-11-05 (c4-next): that two cron-faults migrations of 2026-11-04 (cron-faults-task-scan, cron-faults-task-join-order) took cron_fault_seen out of the top statements is the likely cause and was not measured: no d1-query-report ran before and after them. This issue exists to make that comparison possible.',
    updated_at = datetime('now')
WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.D1 #1: %'
  AND instr(description, 'CORRECTION 2026-11-05 (c4-next):') = 0;

UPDATE roadmap_implementation
SET evidence = evidence || ' Correction 2026-11-05 (c4-next): public DNS answers NXDOMAIN for four zones, not two (qwave.tech, q-wave.tech, ipatent.me, empoweringchange.today; registrar cards human_actions 65, 73, 102); the DOMAINS.md rows of the last two said a working redirect and now say no.'
WHERE id = 612 AND item = 'NEXT-QNFO.INFRA.DNS' AND instr(evidence, 'PR 7413') > 0 AND instr(evidence, ' Correction 2026-11-05 (c4-next):') = 0;
