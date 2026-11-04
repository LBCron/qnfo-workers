-- BP26-AXE-1 (2026-11-04, charter pillar security; breach trigger 14494 a11y_violations_serious; follows PR 5141 BP26-A11Y-LABELS-1)
-- WHAT WAS WRONG: a11y_violations_serious read 4 (ai.qnfo.org label x1, me.q08.org label x3) in the collect_web run of 2026-10-28T19:19Z and has read 4 since. PR 5141 labelled those controls the same day.
--   scripts/bp26_web.py a11y_findings() is a static lower bound that cannot certify zero, so by design it writes the metric only when it finds something ("zero cannot be certified without
--   axe-core"). A defect that is fixed therefore never clears: the stored 4 is a stale reading, not a state of any page. MEASURED 2026-11-04 with axe-core 4.10.2 in Edge headless (desktop 1280x800,
--   tags wcag2a/wcag2aa/wcag21aa/wcag22aa, serious + critical only) on the home page of qnfo.org, papers.qnfo.org, q08.org, qwav.org, ideas.qnfo.org, archive.qnfo.org, fleet.qnfo.org, ai.qnfo.org, me.q08.org,
--   reading.q08.org, travel.q08.org and ask.qwav.tech: 0 violations on each; ipatent.qnfo.org timed out in the probe (navigation, not a finding).
-- WHAT THIS DOES: the metric's producer becomes the real axe-core run. scripts/bp26_axe.mjs (Playwright + axe-core, installed by the ux-journeys workflow for its phone journeys) writes a report; scripts/bp26_axe.py
--   turns it into the metric and one evidence row per page; the ux-journeys workflow runs both after a deploy (at most hourly). This file only corrects the metric's source_of_truth text so the registry names the
--   real producer; it keeps the [BP26] tag the framework requires before it will write the metric. The first axe run replaces the stale 4.
-- PREDICTION: a11y_violations_serious 4 -> 0 within one ux-journeys run after the merge (about 60 minutes); if axe finds a real violation the metric reads that number instead and the evidence rows name page and rule.
-- Revert: the Rollback line restores the previous text; the workflow step is removed by reverting the PR.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE metric_registry SET source_of_truth = 'scripts/bp26_web.py collect_web: a static lower bound of serious and critical axe-core violations (html-has-lang, document-title, image-alt, meta-viewport, form-field label, button-name, link-name) on the fetched public pages; written only when above zero, because zero cannot be certified without an axe-core run; one row per page in bp26_probe_results [BP26]' WHERE metric = 'a11y_violations_serious';
-- spof-review: the producer runs in the ux-journeys workflow (continue-on-error); when it does not run the stored value is simply not refreshed and metric_staleness_breach_rec records the gap. scripts/bp26_web.py still writes its static count when it is above zero.

UPDATE metric_registry
   SET source_of_truth = 'scripts/bp26_axe.mjs + scripts/bp26_axe.py (BP26-AXE-1): serious and critical axe-core rule violations (WCAG 2.0, 2.1, 2.2 A and AA; one per page and rule) on the home page of every public HTML host of bp26_web.py HTML_HOSTS, the papers index and one paper page, run in headless Chromium by the ux-journeys workflow after a deploy (at most hourly); scripts/bp26_web.py collect_web still writes its static lower bound whenever that finds something; one row per page in bp26_probe_results [BP26]'
 WHERE metric = 'a11y_violations_serious' AND instr(source_of_truth, '[BP26]') > 0;
