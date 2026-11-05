-- BP26-PROVENANCE-KEY-1 (2026-11-05, charter pillar research; agent_issues 1000335 BP26-PROVENANCE-MARKING-1, roadmap_implementation row 1391; EU AI Act Art. 50(2) machine-readable marking due 2026-12-02).
-- Evidence read live 2026-11-05: https://papers.qnfo.org/.well-known/provenance-key.json answers 503 {"error":"provenance signing is not configured"}; https://q08.org/p/<slug>/provenance.json answers
-- "signed": false, "signature": null; qnfo-audit.asset_provenance holds 0 rows; living-paper holds 358 papers published or distributed since 2026-08-02. Root cause: the worker secret
-- PROVENANCE_SIGNING_KEY is absent on qnfo-gateway (and q08-signal-engine). docs/BP26-SECURITY-CLUSTER.md records the 2026-10-28 attempt: the session took the secret-lock lease, minted a key and ran
-- `wrangler secret put`; the harness permission check refused it. That refusal is handed over with its reason and is not retried by another route (doctrine readings (c) and (r)); no card existed for it
-- (a read of human_actions where slug like 'bp26%' on 2026-11-05 lists 173, 174, 175, 189, 195 and none for the key), so the step had no owner and no probe: a loose end (OWNER-NO-LOOSE-ENDS-1).
-- This file files the card (held open: IB-HELD-1, it carries the IDENTITY-BOUND: line) and the doer that resolves it when the step is done (qnfo-cloud-ops owner-steps-watch reads the key document).
-- The step is one line since scripts/mint_provenance_key.mjs writes the key to stdout only, so it pipes into wrangler without touching a screen, a file or the repository.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM human_actions WHERE slug = 'bp26-provenance-signing-key' AND status = 'open'; DELETE FROM agent_issues WHERE status = 'open' AND title = 'BP26-PROVENANCE-KEY-1: owner-steps-watch resolves the provenance signing key card when the key document answers 200'; DELETE FROM decision_log WHERE actor = 'session-c1-bp26' AND action LIKE 'BP26-PROVENANCE-KEY-1:%';

INSERT OR IGNORE INTO human_actions (slug, title, why, default_in_effect, action, sev, status, source) VALUES ('bp26-provenance-signing-key',
  'Put the provenance signing key on qnfo-gateway so papers.qnfo.org can sign its AI-provenance sidecars (EU AI Act Art. 50(2), due 2026-12-02)',
  'IDENTITY-BOUND: the key is the signature QNFO puts on its statement that an asset is AI-generated, and writing a Worker secret is an act the session permission check refused on 2026-10-28 (docs/BP26-SECURITY-CLUSTER.md, section Signing key), so the fleet does not retry it by another route. Live 2026-11-05: https://papers.qnfo.org/.well-known/provenance-key.json answers 503 "provenance signing is not configured", the q08.org piece sidecar says signed false, and qnfo-audit.asset_provenance has 0 rows, so provenance_marking_coverage is a measured 0 (358 papers published or distributed since 2026-08-02, none signed). Everything else is built and tested: the sidecar, the ledger, the hourly sweep that signs 40 papers an hour once a key exists (about 9 hours for the 358), the public key document, and the collector that measures coverage.',
  'The labels and JSON-LD flags stay live and every sidecar stays unsigned: no machine-readable marking that verifies, so Art. 50(2) is unmet from 2026-12-02 and provenance_marking_coverage stays 0. Nothing is signed in anyone''s name.',
  'Take the secret-lock lease for qnfo-gateway (POST https://qnfo-deploy-guard.q08.workers.dev/secret-lock/acquire {"worker":"qnfo-gateway","owner":"<you>","ttl_sec":300}), then run: node scripts/mint_provenance_key.mjs | npx wrangler secret put PROVENANCE_SIGNING_KEY --name qnfo-gateway   (the key goes from stdout into wrangler; it is printed nowhere and stored nowhere else), then release the lease. It resolves when https://papers.qnfo.org/.well-known/provenance-key.json answers 200 instead of 503; coverage then climbs toward 1.0 within about 9 hours. A C2PA manifest embedded in a PDF or image needs a CA-issued certificate and stays a separate decision (docs/BP26-SECURITY-CLUSTER.md).',
  'high', 'open', 'bp26-provenance');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'BP26-PROVENANCE-KEY-1: owner-steps-watch resolves the provenance signing key card when the key document answers 200',
'Charter pillar: research. Serves BP26-PROVENANCE-MARKING-1 (agent_issues 1000335, roadmap row 1391). Metric it should move: provenance_marking_coverage (0 measured on 2026-11-05) through the owner step that unblocks signing.

The owner card bp26-provenance-signing-key (human_actions) waits on one step, writing the Worker secret PROVENANCE_SIGNING_KEY on qnfo-gateway. Nothing notices when it is done, so the card would stay open after the work (OWNER-NO-LOOSE-ENDS-1). qnfo-cloud-ops OWNER-STEPS-WATCH-1 already resolves cards from public facts (OWNER_STEP_PROBES, jobOwnerStepsWatch).

Change: add a probe with slug bp26-provenance-signing-key and kind "provenance-key" to OWNER_STEP_PROBES (urls: https://papers.qnfo.org/.well-known/provenance-key.json) and a branch for it in ownerStepVerdict: done when the status is 200 and the JSON has profile "qnfo-provenance-sidecar/1" and at least one key with kid and x; the evidence names the kid, never more. Add a case to the worker suite that feeds a 503 (not done) and a 200 key document (done).

Closing probe: runtime-probe: {"url": "https://papers.qnfo.org/.well-known/provenance-key.json", "status": 200, "contains": "qnfo-provenance-sidecar/1"}

code-task: repo=qnfo-workers path=qnfo-cloud-ops/worker.js
code-anchor: function ownerStepVerdict(probe, res) {
code-probe: {"paths": ["qnfo-cloud-ops/worker.js"], "contains": "provenance-key"}',
'bp26-provenance', 'reliability', 'high', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'BP26-PROVENANCE-KEY-1: owner-steps-watch resolves the provenance signing key card when the key document answers 200');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session-c1-bp26',
  'a signing key for AI-provenance statements is an attestation in QNFO''s name and the Worker-secret write was refused by a permission check, so the fleet measures the gap honestly, makes the owner step one line, and does not retry the write through another route',
  'BP26-PROVENANCE-KEY-1: provenance_marking_coverage now measured from asset_provenance against the published papers and q08 pieces (0 until the key exists); human_actions card bp26-provenance-signing-key filed with a one-line step; scripts/mint_provenance_key.mjs mints the key to stdout only; doer filed to resolve the card on the key document',
  'live 2026-11-05: provenance-key.json 503, q08 sidecar signed false, asset_provenance 0 rows, living-paper 358 papers published or distributed since 2026-08-02',
  'metric moves from unknown to a measured 0 (honest), card held open for the owner; no key minted or written by this change',
  'one metric collector, one card, one issue row, one stdout-only script; nothing is signed or written to a Worker',
  'see the Rollback line of migrations/2026-11-05-bp26-provenance-key-card.sql; revert the collector with git revert',
  'the 2026-12-02 Art. 50(2) deadline has an owner, a one-line step and a measured number instead of an unknown',
  'provenance_marking_coverage: unknown -> 0.0 within one consumer run of the merge; -> above 0.9 within about 9 hours of the key landing',
  0, 'papers.qnfo.org key document and q08.org sidecar read live; asset_provenance and human_actions read from qnfo-audit'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session-c1-bp26' AND action LIKE 'BP26-PROVENANCE-KEY-1:%');
