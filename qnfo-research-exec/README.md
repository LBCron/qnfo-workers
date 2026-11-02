# qnfo-research-exec

> Self-doc header (FLEET-SELF-DOC-1)
> Purpose: research pipeline and version_queue drain (in-house publishV2 + KG + R2 + GitHub copy)
> Canonical source: this directory (QNFO/qnfo-workers)
> Version: worker.js VERSION + /health (see fleet-drift scan)

Deployed-current discipline: deployed-current.worker.js mirrors the live bundle;
regenerate via: wrangler deploy --dry-run --outdir dist && cp dist/worker.js deployed-current.worker.js

## Publishing (NOZ-DOI-1, 0.12.3)

**Revised-paper layout (PAPER-FORMAT-2).** `_shared/paper-format.js` is the canonical
formatter for new and revised publications, the folded reviser and errata publisher,
and the web/PDF readers. Wrapped titles use the record title, header metadata is
retained in YAML instead of printed as prose, and the actual abstract and wrapped
section headings are normalized without rewriting scientific text.
`paperFormatTick` scans 100 public papers per 10-minute tick using a durable keyset
cursor in `ops_config.paper_format_state`. It covers imported papers too; it never
changes status or version, and compare-and-swap updates cannot overwrite a concurrent
revision. `PAPER-LEDGER-1` archives prior bodies and metadata. Failures are logged
and retried on subsequent sweeps; `fm-revised-paper-formatting` requires a fresh,
complete zero-repair/zero-error sweep. Existing R2 drift, research-repository sync
and PDF freshness loops propagate repairs; a successful D1 write is not proof that
all derived artifacts have refreshed.

Artifact synchronization covers published, distributed and external-preprint
papers, including imports without queue rows or existing repository directories.
R2 freshness compares actual content even when byte lengths agree. Clean mirror
batches record their corpus size/offset and repository ticks record their cursor
in the existing durable events, so artifact coverage is auditable independently
of canonical-body convergence.

After editing the formatter, run `node _shared/inline-paper-format.mjs` then
`node qnfo-pdf/build.mjs`. The shared, gateway, research executor and PDF
`paper-format`/typesetting suites exercise the committed copies.

Operational `cloud_ops_events` writes supply a unique UUID `id` and UTC ISO timestamp, including deferred errata confirmation,
backup pruning and publication gate events (0.42.1). A logging failure is reported explicitly; it does not settle the queue row.
The errata-hub confirmation source and folded copy stay identical. Regression coverage: `errata-confirm-cost.test.mjs`.

A paper is published in-house: its papers.qnfo.org page is its address, and `doi`, `zenodo_doi` and `zenodo_url` are written NULL on
every new or revised paper row. The version_queue drain (`publishV2`) updates the papers row, the knowledge-graph node
(`paper:<slug>`), the R2 copy and the GitHub copy, and queues the social post; it calls no outside registrar. The earlier
deposit, version-request, metadata-edit and related-link stages are removed. Offline test: `node qnfo-research-exec/inhouse-publish.test.mjs`.

## Research repository deposit (REPO-DEPOSIT-1, 0.35.0)

A run and its paper are written to `QNFO/qnfo-research` as **one Git Data API commit** (`repo-deposit.mjs`, inlined into `worker.js`
between the `REPO-DEPOSIT-BEGIN/END` markers; `node qnfo-research-exec/inline-repo-deposit.mjs` re-inlines it): `runs/cycle-N/<slug>/`
(grounding, drafts, the reconciled paper, reviews, verification, `MANIFEST.json` v2, `ro-crate-metadata.json`) plus `papers/<slug>/`
(or the `programFor` directory) with `paper.md`, `README.md` and `provenance.json`. A refused ref update is retried on the new head, GitHub's
blob id is compared with ours, and the manifest is read back at the new commit; a deposit is reported `ok` only after both. Every attempt is a
`research_run_ledger` row (D1), `GET /repo-ledger` reads it, `fm-research-run-deposit` expects 0 failures.

The 10-minute tick (`repoSyncTick`) also retries a deposit that errored, restores the gaps listed in the repository's
`provenance/known-gaps.json` (a run file only if its sha256 equals the manifest's), and compares `research_repo_sync_batch` published papers
with their git copy, committing the ones that differ. Until `QNFO/qnfo-research` carries `provenance/IMPORT.json` a run goes to the legacy
`qnfo-ensemble-research` (still atomic, v2 manifest) and no paper text is written. ops_config: `research_repo_target` (auto | legacy |
consolidated), `research_repo_sync`, `research_repo_restore`, `research_repo_archive`, `research_repo_sync_batch`; off/legacy revert it without a deploy.
`repoCatchupTick` finishes the consolidation: it dispatches the `ensemble-catchup.yml` workflow while the legacy repository has cycles `runs/` lacks or its
history is not yet an ancestor of `main` (the repository merges squash-only, so the import PR drops the imported commits; the workflow links them with a
content-neutral merge) and, once none are missing, the history is linked and 3 consolidated deposits are ledgered, files one `portfolio_actions` archive
request for the legacy repository (PORTFOLIO-ARCHIVE-1).
Suites: `repo-deposit.test.mjs` (module, fake Git Data API with a concurrent writer, a lost response, 5xx, a corrupt blob, a byte-identical
parity golden shared with `tools/provenance.py`) and `repo-deposit-wiring.test.mjs` (the real worker functions). Operations:
`docs/RESEARCH-PROVENANCE.md`.

## Accuracy layer (ACCURACY-GROUND-1, 0.12.0, owner directive 2026-10-10)

Generated text states only what the text it was given states. Instructions specify process and style, never topics or example nouns.

- Writer, reconcile and review preambles: every statement about a cited work must be derivable from that work's supplied bibliography entry; a thin entry is said to be thin; an unsupported statement about a cited work or the outside world is a HARD review finding.
- Reviser member (qnfo-paper-reviser 1.3.x): the auditor's `low` label is not trusted. `guardSeverity` demotes a `low` edit to `high` (flagged, recorded as an unconfirmed internal erratum, never applied) unless its category is a surface category (prose, format, meta, changelog), its replacement is at most 240 characters, every name, figure, year and link in it already occurs in the paper, and at most two content words are new. A terminology bridge between fields is an assertion and is `high`.
- Errata members (errata-hub 1.5.x, respond 0.5.x): `enforceCorrectionGrounding` makes a draft high risk (never sent by errata-publish) when its clarification, acknowledgement or changelog holds a name, year, figure, DOI or link found in neither the errata email nor the paper; a corrected reference must therefore come from the email or the paper. The classifier's `paper_doi` must occur in the email.
- The deterministic check is `ungroundedTerms`, the same method as q08-signal-engine `groundingProblems` (Q08-VERIFY-1). Suites: `ground.test.mjs` here, `qnfo-paper-reviser/ground.test.mjs`.

## Class quotas and the errata share (RESEARCH-PRIORITY-STARVATION-1, 0.44.3)

`claimNew` (and the single-stage `run()`) first try the bounded errata lane, then share one quota selector across atomic and fallback claims. The 24-row in-flight window allocates 8 slots to proposals, at most 14 to remediation revisions (`source_id` starting `revision:`), and 2 to other sources. The least-filled class relative to its allocation goes next; the remaining slots are reserved for proposals when needed to meet their floor. Missing classes lend unused slots, but revisions cannot exceed 14. Existing researching and publish-ready rows count toward the window; fallback updates recheck the selector to prevent races from bypassing quotas.

Within each class, score descending is the normal order. Every fourth class claim selects the oldest row waiting more than 72 hours, preserving recurring FIFO progress even for low-score rows and retried proposals. The turn uses the class's cumulative attempts, so finishing a row does not reset the rotation. Parked/deferred rows are not admitted or modified. Suites: `claim-order-owner.test.mjs`, `claim-quota.test.mjs`. Live acceptance after canonical deployment is a 24-hour proposal publication count greater than zero and at least 20% of remediation publications, with no parked-pool growth; offline admission tests do not establish that outcome.

Errata remediation rows (`source='remediation'`, `source_id` `errata:<queue_id>`) belong to the other-source class. Their dedicated lane also gives them a bounded share: one claim per window, only below the total 24-row in-flight limit. The window is the `errata_claim_interval_hours` ops_config knob (default 20, clamped to 1..168; `off` or `0` disables the lane; an unreadable value keeps the default). A claim is made only when no `claim` event for `claimed errata:…` exists inside the window and no errata row is still in flight. The window is read from that event, not from `claimed_at`, because the failure paths clear `claimed_at` and a failing row must not reopen the window. Inside the lane, never-attempted rows come first, a row that already holds a draft (stage `complete`, `review`, `revise` or `verify`) before a fresh one, then oldest first, so a row that failed rotates behind the others. A fault returns null and the normal claim runs. No spending target is raised and `/budget` is unchanged. Suite: `errata-claim-fair.test.mjs`. Whether the target of 7 errata papers published per 7 days is met is read from live D1 (`research_queue`, `cloud_ops_events` kind `errata-claim-fair`), not from this suite.
