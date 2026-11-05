-- BP26-WEB-DECISIONS-1 (2026-11-05, charter pillar security; breach triggers 14504 non_essential_cookies_set, 14505 third_party_trackers, 14494 a11y_violations_serious, 14497 ai_label_coverage)
-- The decision_log record (DOCTRINE-1: every autonomous decision, with its revert path and prediction) for the two changes of the bp26-web slice that are not a code revert away:
--   1. GTG-TAG-1: the qwav.tech zone's Google Tag Gateway automatic tag set-up (setUpTag) was switched OFF through cf-ops-actions gtg-tag (run 41961530884, 2026-11-05T03:26Z, RESULT_JSON ok true,
--      before {"enabled": true, "endpoint": "/dmzj", "hideOriginalIp": true, "measurementId": "G-3VW2SVSSRH", "setUpTag": true}, after the same with setUpTag false). It is a Cloudflare zone setting, so
--      reverting the PR does not undo it: `gh workflow run cf-ops-actions.yml -f action=gtg-tag -f target=qwav.tech -f model=on` does.
--   2. BP26-CONSENT-1: the Google tag of qnfo.org, papers.qnfo.org, qwav.org and archive.qnfo.org loads only after the visitor presses Allow (qnfo-gateway 3.58.0, PR 7315).
-- Both cost the owner GA4 measurement (property G-3VW2SVSSRH for the qwav.tech zone; G-LV7RHRVW6R reduced to consenting visitors), which is stated in the rows.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM decision_log WHERE instr(action, 'GTG-TAG-1:') = 1 OR instr(action, 'BP26-CONSENT-1:') = 1;
-- BACKUP: decision_log
-- spof-review: append-only log rows; nothing reads them but the doctrine scorecard.

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'breach-bp26-web',
       'a tag the edge writes into every page before any visitor choice cannot be gated by a Worker, so the only lever for non_essential_cookies_set and third_party_trackers is the zone setting that injects it; the repository token and the allowlisted cf-ops-actions path are the sanctioned route for a Cloudflare step',
       'GTG-TAG-1: cf-ops-actions gtg-tag qwav.tech --model off: Google Tag Gateway setUpTag true -> false (endpoint, measurement id, hideOriginalIp, enabled unchanged), read back ok',
       'run 41961396425 (read) printed setUpTag true with measurementId G-3VW2SVSSRH; run 41961530884 (off) printed before and after; ask.qwav.tech HTML with the producer user agent: 0 matches for G-3VW2SVSSRH, googletagmanager and /dmzj/ after, 2 matches before; bp26_probe_results third_party_trackers had ask.qwav.tech -> googletagmanager.com, non_essential_cookies_set had _ga and _ga_3VW2SVSSRH',
       'applied 2026-11-05T03:26Z',
       'every HTML page of the qwav.tech zone (ask.qwav.tech, qwav.tech hosts) stops carrying the Google tag and its cookies; the owner loses automatic GA4 measurement of that zone (property G-3VW2SVSSRH)',
       'gh workflow run cf-ops-actions.yml -f action=gtg-tag -f target=qwav.tech -f model=on (restores setUpTag true; the previous config is in the run log of 41961530884)',
       'an allowlisted, tested, read-back-verified action for the Google Tag Gateway of one zone (scripts/cf_ops_actions.py gtg-tag, scripts/cf_ops_gtg_test.py)',
       'third_party_trackers 1 -> 0 and non_essential_cookies_set 2 -> 0 on the first collect_web run after the change (hourly)',
       'none (a privacy measure; the cost is stated in blast_radius)',
       'cloudflare api read and write of one zone setting, curl of ask.qwav.tech with the producer user agent, bp26_probe_results'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE instr(action, 'GTG-TAG-1:') = 1);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'breach-bp26-web',
       'the owner wants GA4 collecting (GA4-COLLECT-RESTORE-1, 2026-10-25) and the BP26 practice wants no non-essential cookie before consent; a consent loader satisfies both for visitors who agree and is honest for those who do not',
       'BP26-CONSENT-1: qnfo-gateway 3.58.0 replaces the unconditional gtag.js on qnfo.org, papers.qnfo.org, qwav.org and archive.qnfo.org with /qds-consent.js, which injects it only after Allow (webdriver, Global Privacy Control and Do Not Track count as No)',
       'PR 7315 merged; live: qnfo.org, papers.qnfo.org, qwav.org, archive.qnfo.org and a paper page carry 0 googletagmanager references and one loader reference; end-to-end in Edge: No thanks stores denied and sends 0 Google requests, Allow loads gtag.js and sets _ga and _ga_LV7RHRVW6R, Turn analytics off on /privacy clears them; collect_web 2026-11-04T23:57Z: third_party_trackers 5 -> 1, non_essential_cookies_set 3 -> 2',
       'applied 2026-11-05T00:00Z (3.58.1 shortened the notice)',
       'GA4 engagedSessions (READER-YIELD-1) now counts only visitors who pressed Allow; automated visitors no longer reach GA4; Cloudflare Web Analytics, the UTM ledger and external-referrer loads are unchanged',
       'revert PR 7315 and 7422 (the tag returns to every visitor); consent.test.mjs pins the behaviour',
       'a tested consent gate for any gateway page (qnfo-gateway/consent.test.mjs, 35 assertions)',
       'third_party_trackers 5 -> 1 and non_essential_cookies_set 3 -> 2 on the next collect_web run',
       'engaged_reader_sessions_7d falls to consenting visitors; the validity of the measure rises (no datacenter automation)',
       'papers.qnfo.org, qnfo.org, qwav.org, archive.qnfo.org live HTML, Edge end-to-end click test, bp26_probe_results'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE instr(action, 'BP26-CONSENT-1:') = 1);
