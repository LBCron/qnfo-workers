# The QNFO portfolio (QNFO-PORTFOLIO-1)

Portfolio policy 1.0.1, 2026-10-01 (1.0.1: the loop repairs hygiene itself, PORTFOLIO-HYGIENE-1). The QNFO GitHub organisation is the public face of everything the Quniverse
produces: the fleet, the research programs, the papers' source, the demos, the licence and the organisation profile.
This document is the policy half of the portfolio; the live half (section 5, between the `PORTFOLIO-LIVE` markers) is
regenerated daily by `qnfo-fleet-control` (PORTFOLIO-LOOP-1) from the live organisation and the program registry.
The same evaluation also rewrites the public mirror `QNFO/.github/PORTFOLIO.md` and the portfolio index in the
organisation profile README, so every surface says the same thing on the same day.

Owner directive (2026-10-01): check every QNFO repository and unify, consolidate and link all resources as one
portfolio, automatically and without further involvement.

## 1. What was found (2026-10-01)

| Fact | Value |
|---|---|
| Repositories in the organisation | 122 (116 public and private non-forks, plus 11 forks) |
| Archived | 74 |
| Active, non-fork | 42, of which 10 private |
| Active public repositories without a licence file | 36 of 42 (the organisation's licence lives in `QNFO/license` and is not propagated) |
| Active public repositories without a description or topics | 8 each |
| Existing inventories | three, all stale and disagreeing: `QNFO/.github/PORTFOLIO.md` (knowledge-graph snapshot of 2026-08-13), `qnfo-audit.repo_inventory` (49 rows from July under the owner's personal account), the WBS table in the organisation profile README |
| Weekly status writer | `qnfo-cloud-ops` already rewrites `QNFO/.github/PORTFOLIO-STATUS.md` (counts only) |
| Program registry | `portfolio-state.program_registry`: 79 WBS rows, 17 programs, of which 15 name a GitHub repository |

The repositories are real and mostly fine; the portfolio layer around them was hand-made and had stopped being
maintained. The fix is the same as for the charter: one measured register, three generated surfaces, no hand editing.

## 2. One portfolio, four surfaces

| Surface | Where | What it holds | Written by |
|---|---|---|---|
| Register | D1 `qnfo-audit.portfolio_repos` (+ `portfolio_sync_runs`) | one row per repository: tier, charter pillar, visibility, WBS codes, hygiene flags, last push | PORTFOLIO-LOOP-1, daily |
| Live JSON | `GET https://qnfo-fleet-control.q08.workers.dev/portfolio` | the register and the last sync run | served from D1 |
| This document | `QNFO/qnfo-workers/docs/PORTFOLIO.md` | policy (sections 1 to 4) and the live block (section 5) | hand (policy) + loop (live block) |
| Public mirror | `QNFO/.github/PORTFOLIO.md` and the `PORTFOLIO-LIVE` block in `QNFO/.github/profile/README.md` | the public inventory and the index on the organisation landing page | loop, fully generated |

Superseded, kept for history, no longer written: `qnfo-audit.repo_inventory`, the hand-written WBS table in the
profile README (the generated index sits above it), the 2026-08-13 snapshot text of `QNFO/.github/PORTFOLIO.md`.
The WBS codes themselves stay canonical in `portfolio-state.program_registry`; the loop reads them, never writes them.

## 3. Tiers and the rules that assign them

Every repository gets exactly one tier, in this order of precedence, and every tier maps to one charter pillar
(`docs/QUNIVERSE-CHARTER.md` section 3.2). The rules are `pfTier` in `qnfo-fleet-control/worker.js`; the lists are
short on purpose, so a new platform or governance repository is a one-line change there.

| Tier | Rule | Pillar | Graded for hygiene |
|---|---|---|---|
| archived | GitHub `archived` flag | research (legacy) | no |
| fork | GitHub `fork` flag | core | no |
| platform | named in `PF_PLATFORM`: qnfo-workers, qnfo-ops, qnfo-skills, qnfo-schemas, infrastructure, qnfo-infra, qnfo-releases, qnfo-model-router, qnfo-errata-pipeline, qnfo-setup-bootstrap, qnfo-fleet-issues, qwav-platform, personal-life-workers, qnfo-ensemble-research | core | yes |
| governance | `.github`, `license`, `gitbook` | autonomy | yes |
| client-config | `deepchat`, `.deepchat`, `qnfo-config-backup` (private) | personal | no, and never named publicly |
| demo | `qwav-demo-*`, `qwav-demos` | reach | yes |
| research | everything else | research | yes |

Hygiene flags on graded repositories: `no-description`, `no-license`, `no-topics`, `dormant-<n>d` (no push for more
than 120 days). The hygiene score is the share of graded public repositories with none of the first three flags;
private repositories are counted, never named and never repaired, so they do not enter the score (HYGIENE-SCOPE-1).

## 4. Portfolio rules (binding on every session and worker)

1. **A repository is a portfolio item or it does not exist.** A new QNFO repository names its tier (by the rules above)
   and, if it is research, a WBS code in `program_registry` within one sync. The loop fills an empty `github_repo`
   itself when the registry row's slug equals the repository name or the repository's description names the code
   (PORTFOLIO-HYGIENE-1); it lists the rest every day until a session registers them.
2. **Fewer, linked, described.** Every active public repository carries a description, topics and a licence. The
   licence is the QNFO Unified License Agreement v2.0 (`QNFO/license`, SPDX `LicenseRef-QNFO-ULA-2.0`), which applies
   by its own scope to every repository of the organisation, code included; GitHub reports it as `NOASSERTION`, which
   counts as licensed. The loop repairs the gaps itself, at most 12 actions per sync: a missing LICENSE file is created
   from `QNFO/license` (never replaced), an empty description is taken from the README's first real paragraph (a
   line of labelled fields such as "Status: ... | Phase: ..." is never used), missing topics are the tier baseline plus
   the slugs of the programs served. A description the loop wrote is re-derived every sync and corrected or cleared
   when the README changes; a description a person wrote is never touched. Every action is a `portfolio_actions` row
   (`GET /portfolio` lists the last forty) and the next sync measures it; `portfolio_hygiene` is graded in the charter
   under the autonomy pillar (target >= 0.9).
3. **Archive, do not delete.** A research repository that is dormant for 120+ days and has no WBS code is an archive
   candidate. The loop proposes; a session archives (reversible), or the loop does when an explicit `portfolio_actions`
   row asks for it (`action = archive-request`, `status = requested`, written by an issue or a session: REPO-ARCHIVE-1,
   2026-10-06, because the session GitHub proxy refuses repository settings writes). Nothing is ever deleted.
4. **Private stays private.** Private repositories are counted in every surface and named in none.
5. **One identity.** Public text says `QNFO` (the imprint) and names Rowan Brad Quni-Gudzinas as author of record;
   never "Research Foundation", "Collective" or "Program" as an organisation name (STRATEGY-1 section 2.1).
6. **The fleet is the writer.** Portfolio surfaces are regenerated by the loop; a hand edit to a generated surface is
   overwritten on the next sync. Policy changes go through a pull request to this document and `pfTier`.
7. **Public pages are part of the portfolio.** Repositories with GitHub Pages (`has_pages`) and a homepage are linked
   from the inventory; the fleet's own sites (qnfo.org, papers.qnfo.org, fleet.qnfo.org) are linked from the mirror.

How it runs: `portfolioSyncIfStale` on the kernel's hourly cron (syncs when the last successful run is older than
20 hours, within 50 minutes after a partial run or after a run that took hygiene actions, and on the first tick after
every kernel deploy, so a change to the loop verifies itself within the hour and a backlog of flagged repositories
clears at twelve an hour; DEPLOY-SYNC-1), `POST /portfolio/sync` with the admin token on demand. A failed
organisation fetch writes nothing. Every run is a `portfolio_sync_runs` row with the per-surface commit status.
`charter-guard` fails CI if this document loses its markers; `portfolio.test.mjs` replays the organisation fixture
through the classifier and the three renderers on every pull request that touches the kernel.

## 5. Live register

<!-- PORTFOLIO-LIVE:BEGIN -->
_Generated by qnfo-fleet-control PORTFOLIO-LOOP-1 at 2026-11-03T03:01:06.663Z from the live GitHub organisation and portfolio-state.program_registry. Do not edit by hand. Live JSON: `GET https://qnfo-fleet-control.q08.workers.dev/portfolio`._

### Scoreboard

| Signal | Value |
|---|---|
| Repositories in the organisation | 130 (10 private) |
| Active, graded public repositories (platform, governance, research, demo) | 35 |
| Hygiene score (description, licence and topics all present) | 1 |
| Dormant graded repositories (no push for 120+ days) | 0 |
| Research repositories with no WBS program code | 3 |
| WBS codes linked to a repository | 72 of 85 in program_registry |

### Tiers

| Tier | Meaning | Repositories |
|---|---|---|
| platform | the fleet, its tooling and infrastructure (charter pillar core) | 10 |
| governance | organisation profile, licence and documentation (pillar autonomy) | 3 |
| research | active research programs and papers (pillar research) | 17 |
| demo | interactive demonstrations and sites (pillar reach) | 8 |
| client-config | private client configuration and backups (pillar personal; never public) | 3 |
| fork | forks of upstream tooling kept for reference (pillar core) | 10 |
| archived | completed or superseded work, read-only (pillar research) | 79 |
| **all** | 10 private (counted, never listed) | **130** |

### Platform: the fleet, its tooling and infrastructure (charter pillar core)

| Repository | Description | WBS | Last push | Hygiene |
|---|---|---|---|---|
| [qnfo-workers](https://github.com/QNFO/qnfo-workers) | The source of the Quniverse: the Cloudflare Workers fleet that operates, heals, audits, publishes and promotes | - | 2026-11-03 | ok |
| [qnfo-ops](https://github.com/QNFO/qnfo-ops) | Operations & Governance — Audit, Handoff, Policy, Skills, WBS Migration | - | 2026-11-01 | ok |
| [qnfo-skills](https://github.com/QNFO/qnfo-skills) | QNFO DeepChat skills — 28 skills including cloudflare-deployer, qnfo-agent, publication-publisher. Redundant b | - | 2026-11-01 | ok |
| [qnfo-releases](https://github.com/QNFO/qnfo-releases) | QNFO paper releases repository | - | 2026-11-01 | ok |
| [qwav-platform](https://github.com/QNFO/qwav-platform) | QWAV Platform: Cloudflare worker source (papers-server, ask-qwav, archive, deep-qwav-meta), papers HTML, boots | QWAV.PLT | 2026-11-01 | ok |
| [qnfo-infra](https://github.com/QNFO/qnfo-infra) | Cloudflare Infrastructure — D1, DNS, Pages, R2, Vectorize, Workers | - | 2026-10-30 | ok |
| [qnfo-schemas](https://github.com/QNFO/qnfo-schemas) | Implements P0 (foundation) of QNFO.CODEPARSE.SCOPE.v1: every instruction, chat, prompt, skill, and response ge | - | 2026-10-30 | ok |

### Governance: organisation profile, licence and documentation (pillar autonomy)

| Repository | Description | WBS | Last push | Hygiene |
|---|---|---|---|---|
| [.github](https://github.com/QNFO/.github) | QNFO organization profile and public transparency dashboard — mission, research programs, funding posture, gov | QNFO.GOV, QNFO.GOV.001 | 2026-11-03 | ok |
| [gitbook](https://github.com/QNFO/gitbook) | GitBook content | - | 2026-11-01 | ok |
| [license](https://github.com/QNFO/license) | QNFO Content License Agreement | - | 2026-11-01 | ok |

### Research: active research programs and papers (pillar research)

| Repository | Description | WBS | Last push | Hygiene |
|---|---|---|---|---|
| [qnfo-research](https://github.com/QNFO/qnfo-research) | QNFO Research Artifacts — papers, releases, WBS plans, review reports, and project files. Separate from qnfo-s | QNFO.RES, QNFO.RES.001, QNFO.RES.002, QNFO.RES.003, QNFO.RES.005, QNFO.RES.004, QNFO.RES.006, QNFO.RES.007, QNFO.RES.008, QNFO.INM.001, QNFO.RES.009, QNFO.RES.010, QNFO.RES.011, QNFO.RES.012, QNFO.RES.013, QNFO.RES.014, QNFO.RES.015, QNFO.RES.016, QNFO.RES.017, QNFO.RES.018, QNFO.RES.019, QNFO.RES.020, QNFO.RES.021, QNFO.JPC.002, QNFO.RES.022, QNFO.RES.023, QNFO.CGS.002, QNFO.JPC.003, QNFO.RES.024, QNFO.RES.026, QNFO.RES.027, QNFO.RES.028, QNFO.RES.029, QNFO.RES.030, QNFO.RES.031, QNFO.RES.032 | 2026-11-03 | ok |
| [agentic-collapse](https://github.com/QNFO/agentic-collapse) | QNFO research code: agentic-collapse. Staged and tested in QNFO/qnfo-workers/research-code/agentic-collapse. | - | 2026-11-02 | ok |
| [ultrametric-lean](https://github.com/QNFO/ultrametric-lean) | QNFO research code: ultrametric-lean. Staged and tested in QNFO/qnfo-workers/research-code/ultrametric-lean. | - | 2026-11-02 | ok |
| [ignorance-audit](https://github.com/QNFO/ignorance-audit) | QNFO research code: ignorance-audit. Staged and tested in QNFO/qnfo-workers/research-code/ignorance-audit. | - | 2026-11-02 | ok |
| [QWAV](https://github.com/QNFO/QWAV) ([site](https://qnfo.github.io/QWAV/)) | QWAV | QWAV | 2026-11-01 | ok |
| [infomatics](https://github.com/QNFO/infomatics) | Infomatics: Mathematics of Information-as-Fundamental - A research program investigating information as the fu | QNFO.INM | 2026-11-01 | ok |
| [adelic-shannon-theory](https://github.com/QNFO/adelic-shannon-theory) | Adelic Shannon Theory: generalising information theory to the adele ring. p-adic entropy, AUM channel capacity | QNFO.ADL.001, QNFO.ADL.002, QNFO.ADL.003 | 2026-10-30 | ok |
| [laws-of-form](https://github.com/QNFO/laws-of-form) | Laws of Form program: Spencer-Brown calculus, quantum laws of form, primordial mark, knowing patterns, verb le | QNFO.SLB, QNFO.SLB.001, QNFO.SLB.002 | 2026-10-30 | ok |
| [cwi-qec-poster-2026](https://github.com/QNFO/cwi-qec-poster-2026) | CWI Summer School on QA/QEC 2026 poster | QNFO.QEC.002 | 2026-10-30 | ok |
| [qec-darwinism-ultrametric](https://github.com/QNFO/qec-darwinism-ultrametric) | QNFO.UMP.004: QEC-Darwinism tradeoff in ultrametric spaces | QNFO.QEC.001 | 2026-10-30 | ok |
| [cfpe](https://github.com/QNFO/cfpe) | CFPE program: Cascading Bayesian Foresight Engine -- methodology, paradigm forecast, 100-year forecast. Consol | QNFO.CFE | 2026-10-30 | ok |
| [odr-thesis](https://github.com/QNFO/odr-thesis) | ODR Thesis: The Compton count as the only primitive — Bruhat-Tits tree as the coordinate system of physics. 5- | QNFO.ODR, QNFO.ODR.001 | 2026-10-30 | ok |
| [ultrametric-physics](https://github.com/QNFO/ultrametric-physics) | Ultrametric Physics program: p-adic valuation, ultrametric geometry, adelic QFT, arithmetic gauge, ultrametric | QNFO.UMP, QNFO.UMP.003, QNFO.UMP.005, QNFO.CON.002, QNFO.UMP.006, QNFO.UMP.007, QNFO.UMP.010, QNFO.UMP.011, QNFO.UMP.012, QNFO.UMP.013, QNFO.UMP.014 | 2026-10-30 | ok |
| [consilient-gap-synthesis](https://github.com/QNFO/consilient-gap-synthesis) | A meta-synthesis project mapping every known gap, open item, stalled phase, deferred publication, and unsolved | QNFO.CGS, QNFO.CGS.001 | 2026-10-30 | ok |
| [revolutionary-quantum-guide](https://github.com/QNFO/revolutionary-quantum-guide) | A revolutionary beginner's guide to quantum computing — one that starts with "why don't we have quantum comput | QWAV.GDE | 2026-10-30 | ok |
| [informational-universe](https://github.com/QNFO/informational-universe) | QNFO.INM.001: The Informational Universe — information as the primary substrate | QNFO.INM.002, QNFO.INM.001 | 2026-10-30 | ok |
| [reentrant-distinctions](https://github.com/QNFO/reentrant-distinctions) | A Unified Treatise on the Loop, the Tree, and the Constants of Self-Reference | QNFO.SLB.003 | 2026-10-30 | ok |

### Demo: interactive demonstrations and sites (pillar reach)

| Repository | Description | WBS | Last push | Hygiene |
|---|---|---|---|---|
| [qwav-demos](https://github.com/QNFO/qwav-demos) | QWAV interactive demos: convergence explorer, error confinement, QPNA playground, hardware visualizer. Consoli | QWAV.DEM | 2026-11-01 | ok |
| [qwav-demo-monna-map-perspective](https://github.com/QNFO/qwav-demo-monna-map-perspective) | QWAV demo placeholder: the Monna map perspective on the Bruhat-Tits tree, which reads the digits of a p-adic n | - | 2026-11-01 | ok |
| [qwav-demo-qpna-classifier](https://github.com/QNFO/qwav-demo-qpna-classifier) ([site](https://qnfo.github.io/qwav-demo-qpna-classifier/)) | QWAV Artifact A2 — Q-PNA Classifier Playground: glass-box ultrametric classification. Live agglomerative clust | - | 2026-10-30 | ok |
| [qwav-demo-hardware-visualizer](https://github.com/QNFO/qwav-demo-hardware-visualizer) ([site](https://qnfo.github.io/qwav-demo-hardware-visualizer/)) | QWAV Artifact A5 — Hardware Pathway Visualizer: 40-atom neutral atom tree lattice with Rydberg blockade gates, | - | 2026-10-30 | ok |
| [qwav-demo-tree-distance](https://github.com/QNFO/qwav-demo-tree-distance) ([site](https://qnfo.github.io/qwav-demo-tree-distance/)) | QWAV Artifact A4 — Tree Distance Sandbox: cophenetic vs Euclidean vs ultrametric distance, triadic rigidity th | - | 2026-10-30 | ok |
| [qwav-demo-ultrametric-convergence](https://github.com/QNFO/qwav-demo-ultrametric-convergence) ([site](https://qnfo.github.io/qwav-demo-ultrametric-convergence/)) | QWAV Artifact A3 — Ultrametric Convergence Explorer: upward-monotonic diversity collapse in tree geometry. Coa | - | 2026-10-30 | ok |
| [qwav-demo-error-confinement](https://github.com/QNFO/qwav-demo-error-confinement) ([site](https://qnfo.github.io/qwav-demo-error-confinement/)) | QWAV Artifact A1 — Error Confinement Live Demo: interactive Bruhat-Tits tree showing strong-triangle-inequalit | - | 2026-10-30 | ok |
| [qwav-demo-bt-qec](https://github.com/QNFO/qwav-demo-bt-qec) ([site](https://qwav-demo-bt-qec.pages.dev)) | Interactive BT-Tree QEC demo: staircase redundancy, error confinement, QEC-Darwinism tradeoff on ultrametric s | - | 2026-10-30 | ok |

### Forks kept for reference

[cloudflare-skill-forks](https://github.com/QNFO/cloudflare-skill-forks), [mcp](https://github.com/QNFO/mcp), [claude-skills](https://github.com/QNFO/claude-skills), [qm](https://github.com/QNFO/qm), [claude-code-tresor](https://github.com/QNFO/claude-code-tresor), [gaios](https://github.com/QNFO/gaios), [claude-code-aso-skill](https://github.com/QNFO/claude-code-aso-skill), [agent-skills-discovery-rfc](https://github.com/QNFO/agent-skills-discovery-rfc), [playwright-mcp](https://github.com/QNFO/playwright-mcp), [workers-mcp](https://github.com/QNFO/workers-mcp)

### Archived (read-only)

[qnfo-ensemble-research](https://github.com/QNFO/qnfo-ensemble-research), [alpha-pi-helix](https://github.com/QNFO/alpha-pi-helix), [symbol-metric-neutrality](https://github.com/QNFO/symbol-metric-neutrality), [trapped-ion-posner-connection](https://github.com/QNFO/trapped-ion-posner-connection), [ultrametric-tree-resistance](https://github.com/QNFO/ultrametric-tree-resistance), [agentic-ai-deep-tech-research](https://github.com/QNFO/agentic-ai-deep-tech-research), [zenodo-automation](https://github.com/QNFO/zenodo-automation), [ultrametric-tree-universality](https://github.com/QNFO/ultrametric-tree-universality), [tree-and-shadow-viz](https://github.com/QNFO/tree-and-shadow-viz), [nested-semantic-graph](https://github.com/QNFO/nested-semantic-graph), [hardware-pathway](https://github.com/QNFO/hardware-pathway), [tree-distance](https://github.com/QNFO/tree-distance), [ultrametric-convergence](https://github.com/QNFO/ultrametric-convergence), [ultrametric-game-of-life](https://github.com/QNFO/ultrametric-game-of-life), [Q-PNA](https://github.com/QNFO/Q-PNA), [ultrametric-error-confinement](https://github.com/QNFO/ultrametric-error-confinement), [Physics-of-Rationalization](https://github.com/QNFO/Physics-of-Rationalization), [Beyond-Belief](https://github.com/QNFO/Beyond-Belief), [qnfo-errata-pipeline](https://github.com/QNFO/qnfo-errata-pipeline), [infrastructure](https://github.com/QNFO/infrastructure), [wbs-6-synthesis](https://github.com/QNFO/wbs-6-synthesis), [computing-machines](https://github.com/QNFO/computing-machines), [measurement-stratigraphy](https://github.com/QNFO/measurement-stratigraphy), [29-schism-synthesis](https://github.com/QNFO/29-schism-synthesis), [zbw-qnfo-unified](https://github.com/QNFO/zbw-qnfo-unified), [the-two-level-lie](https://github.com/QNFO/the-two-level-lie), [ostrowski-dimensionless-reformulation](https://github.com/QNFO/ostrowski-dimensionless-reformulation), [non-anthropocentric-natural-units](https://github.com/QNFO/non-anthropocentric-natural-units), [no-thing-there](https://github.com/QNFO/no-thing-there), [harmonische-paradigma](https://github.com/QNFO/harmonische-paradigma), [harmonic-adelic-completions](https://github.com/QNFO/harmonic-adelic-completions), [cross-domain-phase2](https://github.com/QNFO/cross-domain-phase2), [continuum-trilogy](https://github.com/QNFO/continuum-trilogy), [consilience-physics-numtheory](https://github.com/QNFO/consilience-physics-numtheory), [jpcub-validation](https://github.com/QNFO/jpcub-validation), [huang-2025-quantum-advantage-audit](https://github.com/QNFO/huang-2025-quantum-advantage-audit), [adelic-particle-spectrum](https://github.com/QNFO/adelic-particle-spectrum), [adelic-langlands-physics](https://github.com/QNFO/adelic-langlands-physics), [adelic-epistemological-foundations](https://github.com/QNFO/adelic-epistemological-foundations), [adelic-cross-domain-program](https://github.com/QNFO/adelic-cross-domain-program), [adelic-cross-domain](https://github.com/QNFO/adelic-cross-domain), [acrp04-five-smooth-audit](https://github.com/QNFO/acrp04-five-smooth-audit), [qnfo-consilient-synthesis](https://github.com/QNFO/qnfo-consilient-synthesis), [acrp06-vpmax-extension](https://github.com/QNFO/acrp06-vpmax-extension), [29-schisms-deepdive](https://github.com/QNFO/29-schisms-deepdive), [autaxys-ontological-closure](https://github.com/QNFO/autaxys-ontological-closure), [acrp07-qubit-delusion-valuation](https://github.com/QNFO/acrp07-qubit-delusion-valuation), [acrp07-valuation-qubit-delusion](https://github.com/QNFO/acrp07-valuation-qubit-delusion), [ultrametric-p-adic-metrology](https://github.com/QNFO/ultrametric-p-adic-metrology), [acrp08-paradigm-forecast](https://github.com/QNFO/acrp08-paradigm-forecast), [finite-precision-oc-convergence](https://github.com/QNFO/finite-precision-oc-convergence), [composite-radix-theory](https://github.com/QNFO/composite-radix-theory), [substrate-is-algorithm](https://github.com/QNFO/substrate-is-algorithm), [boundary-ultrametricity](https://github.com/QNFO/boundary-ultrametricity), [ultrametric-consilience-atlas](https://github.com/QNFO/ultrametric-consilience-atlas), [qwav-decade](https://github.com/QNFO/qwav-decade), [counterfactual-physics](https://github.com/QNFO/counterfactual-physics), [qnfo-unified-plan](https://github.com/QNFO/qnfo-unified-plan), [the-informational-universe](https://github.com/QNFO/the-informational-universe), [zbw-p5-capstone](https://github.com/QNFO/zbw-p5-capstone), [tate-adelic-template](https://github.com/QNFO/tate-adelic-template), [hidden-radix-pqc](https://github.com/QNFO/hidden-radix-pqc), [bqnn-classical-baseline](https://github.com/QNFO/bqnn-classical-baseline), [rosetta-fractal-math](https://github.com/QNFO/rosetta-fractal-math), [measure-theoretic-artifacts-adelic](https://github.com/QNFO/measure-theoretic-artifacts-adelic), [systemwide-audit-2026-07](https://github.com/QNFO/systemwide-audit-2026-07), [waveform-vs-quantum](https://github.com/QNFO/waveform-vs-quantum), [stacked-ring-review](https://github.com/QNFO/stacked-ring-review), [s10-observer-research](https://github.com/QNFO/s10-observer-research), [cancellation-rule-research](https://github.com/QNFO/cancellation-rule-research), [numerata](https://github.com/QNFO/numerata), [shor-assumptions](https://github.com/QNFO/shor-assumptions), [0pus](https://github.com/QNFO/0pus), [ai-411](https://github.com/QNFO/ai-411), [aiq-bios](https://github.com/QNFO/aiq-bios)

### Portfolio actions the loop proposes (it never archives or deletes on its own)

- Research repositories to register in portfolio-state.program_registry: agentic-collapse, ultrametric-lean, ignorance-audit

### Hygiene actions the loop took this sync (PORTFOLIO-HYGIENE-1; the next sync measures them)

- consilient-gap-synthesis: description-revise unchanged (still the README's first paragraph)
- qnfo-schemas: description-revise unchanged (still the README's first paragraph)
- qnfo-workers: description-revise unchanged (still the README's first paragraph)
- qwav-demo-monna-map-perspective: description-revise unchanged (still the README's first paragraph)
- reentrant-distinctions: description-revise unchanged (still the README's first paragraph)
- revolutionary-quantum-guide: description-revise unchanged (still the README's first paragraph)
<!-- PORTFOLIO-LIVE:END -->
