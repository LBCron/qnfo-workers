-- BP26-DMARC-FOREIGN-1 (2026-11-05, charter pillar reach; breach dmarc_aligned_pass_rate, trigger 14506, agent_issues 1000524; practice BP26-EMAIL-AUTH-1, agent_issues 1000347).
-- WHAT WAS MEASURED (qnfo-audit.email_raw_archive, the six Google aggregate reports that ended in the 7-day window, decoded read-only on 2026-11-04 23:00Z; no address stored):
--   9 messages. 6 are the fleet's Cloudflare Email Service sender (104.30.x): DKIM pass for qnfo.org (selector cf-bounce) and cloudflare-smtp.org (cf2024-1), SPF pass for cf-bounce.qnfo.org,
--   both aligned results pass, disposition none: 6 of 6. The other 3 come from one address that is not ours (reports 1158, 1160, 1186): header_from qnfo.org (2) and qwav.org (1), no DKIM
--   signature at all, SPF of the domain itself softfail, and Google applied the published p=reject. The metric counted them as unaligned: 6 of 9 = 0.667, below 0.99.
-- ROOT CAUSE: a measure defect, not a sending defect. The producer divided by every message in the report, so the policy doing its job (a stranger forging the domain is rejected) lowered the
--   metric, and no change to the fleet's DNS or senders could raise it while any forger exists. The target 0.99 is about the fleet's own mail aligning.
-- FIX (scripts/bp26_reach.py is_foreign_source, offline suite in its --selftest): a record leaves the denominator only when ALL hold: it failed both aligned checks, the receiver rejected or
--   quarantined it, it carries no DKIM signature, and the only SPF evaluation is of the header_from domain itself with a negative result. A forgery the receiver DELIVERED, a signed message that
--   fails, and an SPF pass for a foreign bounce domain (a misconfigured third-party sender) stay counted as failures. The raw rate and the number of excluded messages and source addresses
--   stay in the note, and a window with only forgeries reads unknown, never 1.0. Nothing is stored about a source address.
-- PREDICTION: dmarc_aligned_pass_rate 0.6667 -> 1.0 (6 of 6) at the first consumer run after the merge, and it stays 1.0 while the sender's mail aligns; it falls only when a delivered or misaligned
--   message from a real sender appears. Guards unchanged (a producer change only). Verify: SELECT last_value, last_refreshed FROM metric_registry WHERE metric = 'dmarc_aligned_pass_rate'.
-- NOT CHANGED, and why: qwav.org publishes no cf2024-1 DKIM selector (bp26_dns_email_auth shows dkim_cf_selector 0 for it); no report from qwav.org shows a message from our sender, so the metric does
--   not depend on it, but the row dns:qwav.org stays at 0 in bp26_probe_results until qwav.org sends through Cloudflare Email Service or the selector is added. That is evidence for the owner of the zone.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE metric_registry SET source_of_truth = 'DMARC aggregate reports (google.com, lolipop.jp, ...) stored as raw MIME in qnfo-audit.email_raw_archive, parsed by scripts/bp26_reach.py collect_dmarc on the remediation-consumer runner: aligned pass (dkim or spf) / all messages, last 7 days; DNS state in bp26_dns_email_auth [BP26]' WHERE metric = 'dmarc_aligned_pass_rate'; DELETE FROM decision_log WHERE instr(action, 'BP26-DMARC-FOREIGN-1:') = 1
-- spof-review: no new single point of failure; the classification runs inside the existing collector and fails open to the raw count when a record has no auth_results.

UPDATE metric_registry SET source_of_truth = 'DMARC aggregate reports (google.com, lolipop.jp, ...) stored as raw MIME in qnfo-audit.email_raw_archive, parsed by scripts/bp26_reach.py collect_dmarc on the remediation-consumer runner: aligned pass (dkim or spf) / messages from the fleet''s own senders, last 7 days; a message counts as a foreign forgery and leaves the denominator only when it failed both aligned checks, the receiver rejected or quarantined it, it has no DKIM signature and the SPF result is for the header_from domain itself and negative (BP26-DMARC-FOREIGN-1); the raw rate is kept in the note; DNS state in bp26_dns_email_auth [BP26]'
  WHERE metric = 'dmarc_aligned_pass_rate';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'breach-bp26-reach', 'the target 0.99 on dmarc_aligned_pass_rate is about the fleet''s own mail aligning; a forger rejected under p=reject is the policy working, not a sending defect',
       'BP26-DMARC-FOREIGN-1: collect_dmarc excludes from the denominator only the records that are provably a stranger forging the domain and that the receiver rejected or quarantined; delivered forgeries, signed failures and foreign-bounce SPF passes stay counted',
       'six Google aggregate reports of the window decoded read-only: the Cloudflare sender 6 of 6 aligned, one foreign address 3 messages, no DKIM signature, SPF softfail for the domain itself, disposition reject under p=reject; scripts/bp26_reach.py --selftest',
       'applied by migration', 'dmarc_aligned_pass_rate and its trigger 14506; no DNS, sender or policy change',
       'the Rollback line restores the registry text; reverting scripts/bp26_reach.py restores the raw count',
       'the metric separates a sending defect from a successful policy rejection',
       'dmarc_aligned_pass_rate 0.6667 -> 1.0 at the first consumer run after the merge; trigger 14506 stops firing and issue 1000524 closes on its probe',
       'none', 'd1:qnfo-audit email_raw_archive (SELECT only), Cloudflare D1 REST decode of the zip attachments, offline selftest'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE instr(action, 'BP26-DMARC-FOREIGN-1:') = 1);
