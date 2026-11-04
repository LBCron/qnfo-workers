# Research publication pipeline (P1 pre-flight to P8 publish + post-publish)

## 1 PRE-FLIGHT: slug/WBS free via git ls-remote + registry check; take publish-lock.
- WHY: A registry P0/no-DOI row does not prove the slug is free; two sessions on one RES.*.P8 created duplicates (PUBLISH-LOCK-1).
- SCOPE: portfolio-state lock row: session_id + wbs_code + target concept.
- CONNECTOR: PROOF

## 2 TITLE-EXISTENCE CHECK: query Zenodo for the exact title before creating any deposit.
- WHY: A PUBLISHED record with the same title on a different concept = BLOCK and reconcile (TITLE-EXISTENCE-PRE-PUBLISH-1, canonical 22044217/22044106 race).
- SCOPE: GET https://zenodo.org/api/records?q=title:"<exact-title>" + D1/KG/registry slug check.
- CONNECTOR: PROOF

## 3 SOURCE COMPLETENESS: collect ALL provenance files before deposit.
- WHY: .md/.html/.pdf is MINIMUM not complete provenance (PUBLICATION SOURCE COMPLETENESS).
- SCOPE: references.bib, citation-audit.md, PROJECT-PLAN.md, README.md, docs/deep-research.md, artifacts/*, external-search/*, GitHub provenance via related_identifiers.
- CONNECTOR: PROOF

## 4 COMPUTATIONAL VERIFICATION: every quantitative claim verified in code, artifacts deposited.
- WHY: Unreproducible tables are a publish blocker (COMPUTATIONAL-VERIFICATION-1, canonical QCA Toy Model v1.0 -> v1.1.2).
- SCOPE: artifacts/verification/ in the deposit.
- CONNECTOR: PROOF

## 5 DEPOSIT: Zenodo deposit with FINAL frontmatter; verify no <RESERVED> DOI and file list matches.
- WHY: Published records are immutable; a placeholder DOI or wrong file list is permanent until a new version (ZENODO-PLACEHOLDER-DOI-1).
- SCOPE: Deposit draft + bucket uploads + metadata.
- CONNECTOR: PROOF

## 6 PUBLISH: publish the record; verify concept DOI + version count.
- WHY: How-to-Cite must cite the concept DOI, not the v1 record DOI (ZENODO-CONCEPT-DOI-CITE-1).
- SCOPE: Publish API + conceptrecid read-back.
- CONNECTOR: PROOF

## 7 POST-PUBLISH ASSERT: frontmatter parity probe (version/date/doi/title all current).
- WHY: The publish flow half-updates frontmatter; 7/7 recently published rows carried stale doi/title (FRONTMATTER-SYNC-PARTIAL-1).
- SCOPE: body_md frontmatter + D1 columns.
- CONNECTOR: PROOF

## 8 R2 MIRROR: mirror to qnfo-releases YYYY/MM/<slug>/ + distribution_status=distributed + r2_path.
- WHY: Missing mirror = HARD finding (R2-MIRROR-AFTER-PUBLISH-1).
- SCOPE: Canonical qnfo-releases bucket (NOT 'releases').
- CONNECTOR: PROOF

## 9 STORE SYNC: D1/KG/registry parity after publish.
- WHY: Website serves live D1 columns; a new-version publish is NOT live until doi + body_md + zenodo_doi + version are written (WEBSITE-SYNC-COLUMNS-1, REGISTRY-LAG-PARITY-1).
- SCOPE: living-paper columns + KG node properties + program_registry.
- CONNECTOR: PROOF

## 10 VERIFY LIVE: papers.qnfo.org/papers/<slug> shows the new record DOI and ZERO old-record DOI.
- WHY: Closeout claims publication completion only with the live page proof.
- SCOPE: curl the live URL.
- CONNECTOR: PROOF

The publish pipeline is a proof chain: each step produces evidence the next step cites. No step may be skipped; the live-page verification closes the loop.
