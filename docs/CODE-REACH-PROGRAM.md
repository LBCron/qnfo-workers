# Research code as reach (CODE-REACH-1)

Version 1.1.0, 2026-10-06 (1.1.0: code licensed under QNFO-ULA v2.1 Software Terms, owner direction the same day, `docs/license/`). Pillars `research` and `reach`. An input to `docs/STRATEGY.md` (which wins on research
identity and portfolio) and to the charter's H1 and H2 horizons. Owner question, 2026-10-06: *publishing reports and
text is one thing, but can we also increase impact and eyeballs with working, tested, practical code libraries, as paper
companions and standalone, and widen QNFO beyond quantum and QEC to AI, systems and mathematics, including formal
verification and AI research about AI research?*

**Short answer.** Yes, and the measurements say AI and metascience should lead it. The evidence is strong that QNFO has no
code surface at all, and that its AI work draws more human attention per paper than its quantum work. It is weak on
whether code will move citations: no QNFO library has existed long enough to measure that, so this program registers
the metrics first and states a prediction it can fail. Three libraries are built and tested in `research-code/`. The
first one already found a reproducibility defect in QNFO's most-downloaded paper. That finding is the strongest argument
for the program.

## 1. What was measured (2026-10-06, qnfo-audit, read in this session)

| Fact | Value | Source |
|---|---|---|
| Published records with a code companion | 0 of 575 | `paper_index` |
| Graded public QNFO repositories / stars on them | 35 / 3 in total (three repositories with one star each) | `portfolio_repos` |
| Installable packages (PyPI, npm) / software DOIs | 0 / 0 | repositories' contents; no `pyproject.toml` or `package.json` with a release |
| Demo repositories | 8, all HTML pages (QWAV demos), no library underneath | `portfolio_repos` tier demo |
| Papers by field (title keywords): n, mean downloads, mean views | AI and epistemics 33, 232, 82.8; quantum 133, 151, 44.9; mathematics 92, 107, 33.5; other physics and philosophy 317, 118, 94.6 | `paper_index` |
| Most-downloaded record | *AGENTIC COLLAPSE*: 3,251 downloads, 83 views | `paper_index` |
| Corpus mean downloads per view | 3.13 (Agentic Collapse: 39) | `paper_index` |
| Arxiv intake query terms | quantum, ultrametric, p-adic, energy only; no AI or formal-methods term | `qnfo-cloud-ops` `RESEARCH_SCAN_QUERY` |
| `idea_topic_concentration_30d` | 0.596 against a target of <= 0.50, in breach | `metric_registry`, `v_metric_trigger_state` |
| Licence of every QNFO repository, code included | QNFO-ULA v2.0 = CC BY-NC-SA 4.0 plus supplemental terms; v2.1 (drafted, `docs/license/`) gives code its own Software Terms | `QNFO/license` |

**Read the download numbers with care.** The Agentic Collapse record carries 80 files, and its downloads-per-view ratio
(39) is twelve times the corpus mean. Download counters count file downloads, so per-file fetches by harvesters and crawlers
plausibly account for most of that figure. Views are the better human signal, and on views AI and epistemics still lead
quantum (82.8 against 44.9 per paper). Without that one record, the AI mean is 138 downloads, below quantum. The
honest claim is "AI work draws more human views per paper", not "AI papers are downloaded more". The owner reports a
citation of Agentic Collapse; `citation_stats` holds no citation row for its DOI, so the citation tracker misses it.
That is a measurement gap of the kind #1754 found, and it is listed in section 8.

## 2. Why code, and the strongest case against it

Why it should work:
- A library is used, not only read. Every `pip install`, import and CI run is a returning user, and `CITATION.cff` turns
  use into citations that point back at the paper.
- Developer channels (GitHub search and topics, PyPI, Hacker News, the Lean community, awesome-lists) are audiences QNFO
  does not reach today. STRATEGY-1 section 3 already names the AI-for-science and engineering audiences; they read code.
- Reproduction is a credibility event in its own right. STRATEGY-1's review gate counts credibility events, and a
  companion that reproduces, or honestly fails to reproduce, a numbered claim is checkable by a stranger.
- Formal proofs cannot be argued with. A Lean file that builds is the strongest form of "evidence, not claims", and
  formal verification of mathematics is a fast-growing field in AI research.

The strongest case against:
1. **Licence.** CC BY-NC-SA is not a software licence: Creative Commons advises against it for code, and it says nothing
   about source code, hosting or patents. On 2026-10-06 the owner directed that code stay under the QNFO-ULA, updated for
   software, with its core tenet intact: any use that generates money needs a separate agreement. QNFO-ULA v2.1
   (`docs/license/`, waiting to be posted on `QNFO/license`) adds Software Terms (section 12): a non-commercial copyright
   and patent licence, file-level share-alike with source availability and a network clause, contribution terms, and a
   plain statement that QNFO code is source-available, not open source. The cost is still real, and stated here once:
   companies, paid services and permissively licensed projects cannot use QNFO code without a separate agreement, which
   caps industry adoption. Researchers, teachers, non-profits and public bodies are unaffected. Revisit if
   `research_code_stars_total` and the libraries' downloads stay flat after 90 days.
2. **Maintenance is verification debt.** Each library is contract surface. The rule in section 5 (tests, CI, a pinned
   toolchain, no network, no runtime dependency where avoidable) keeps each one small. A library nobody uses after six
   months is archived, never kept alive for its own sake (charter principle 3).
3. **Bad code costs more than no code.** An auto-generated library that does not run, or that silently disagrees with its
   paper, is a public credibility loss (STRATEGY-1 principle "reach follows credibility"). No library is generated in bulk
   by the pipeline. Each one is written against its paper's text and states what it reproduces and what it does not.
4. **Stars are not citations.** Stars are cheap and gameable. The headline is the use measures (downloads, dependents,
   software-DOI citations); stars are reported, not targeted.
5. **It can expose the corpus.** A companion that tests a paper may show the paper is wrong; this already happened (3.1).
   That is the point, but every such finding needs an errata path the same day, not a quiet repository.

## 3. What was built (research-code/, tested in CI by .github/workflows/research-code.yml)

### 3.1 agentic-collapse (AI; paper companion)

A dependency-free Python reference implementation of the paper's time-delayed stochastic system (phi, psi, U),
Euler-Maruyama with a rolling delay buffer and the Popperian Guillotine. It adds Monte Carlo collapse probabilities with
Wilson intervals, an "Epistemic Speed Limit" sweep (the largest drive a given lag can afford), and `check-paper`, which
checks the published trajectory against the published equations. 16 tests pass.

Findings, both pinned by tests:
1. **The v1 trajectory does not follow from the v1 equations.** The phi equation uses only alpha = 0.85 and
   gamma = 0.65, which the paper states. At the reported t = 10 state (phi 0.7812, psi 0.1241) the drift is -0.28 per
   time unit, 4.7 noise standard deviations per unit time, and the stable phi for that psi is 0.447. The plateau and the
   terminal state are off the nullcline too. The paper also leaves beta, lambda, kappa and mu unstated, so section 4
   cannot be regenerated. Unproven suspicion: the identical value 0.7812 at t = 10 and t = 100 hints that the numbers
   were written rather than simulated.
2. **The central qualitative claim is not reproduced under the assumed parameters.** At alpha = 0.6, T = 30, a longer
   lag *lowers* collapse probability (0.97 at tau = 0, 0.75 at tau = 3, 0.44 at tau = 6). The coupling pulls phi toward
   the verifier's state, and a lagged psi stays near zero longer. Whether the paper's claim holds anywhere depends on the
   unstated parameters.

Filed as `AGENTIC-COLLAPSE-REPRO-1` (high): a v2 through the errata path that states every parameter, regenerates
section 4 with the library and says which conclusions hold. It is the corpus's most-downloaded record, so it is also its
largest credibility exposure.

### 3.2 ignorance-audit (metascience; paper companion)

The Universal Ignorance Audit v0.3 as a library: the fifteen questions, verbatim and checked against the paper text, in
five phases. The administration protocol becomes machine checks: a target is stated, every question is answered, an
"inapplicable" answer carries a stretch, and the Question 15 answer seeds the next pass. `administer()` runs the audit
with any text model given as a plain function, with no provider built in, in depth order with earlier answers
scaffolding later ones. `score()` is the harness for the paper's own pre-registered claim CHECK 2028: what the audit
finds that a baseline verifier misses, per error category, with precision where ground truth exists. 20 tests pass.
This is the library that serves the accepted conference paper on ignorance auditing, and the one STRATEGY-1 calls "a
method others can use".

### 3.3 ultrametric-lean (mathematics and formal verification; paper companion)

Lean 4 proofs with no Mathlib dependency, so the whole check runs in seconds:
- the isosceles property;
- every point of a ball is a centre;
- balls are nested or disjoint;
- error confinement: if `d c x <= r < d c c'` then `d c' x = d c' c`;
- unique decoding at separation r + 1, against 2r + 1 in Hamming space, with a witness that the bound is tight.

`lake build` passes, and `#print axioms` shows only `propext`, `Quot.sound` and `Classical.choice` (no `sorryAx`).
These are textbook facts, not new mathematics. What is new is that the ultrametric programme's load-bearing lemmas are
checked instead of asserted, and the README says what is not formalized: that physical errors are ultrametric at all.

## 4. The program

Four tracks, led by the fields where the evidence is strongest. Each item names its paper and the claim it tests.

| Track | What | Next items, in order |
|---|---|---|
| A. Paper companions | one library per flagship that reproduces or tests a numbered claim, linked both ways (paper to library and library to paper) | agentic-collapse (done; v2 paper next); a JPCUB measurement harness and the LLM extension (joules per correct answer from a power trace and a verifier: the lead pillar's missing tool); the QCA toy model, the corpus's second most-downloaded record |
| B. Standalone tools | methods others can use without reading the paper | ignorance-audit (done); an "audit my AI-assisted paper" CLI that runs ignorance-audit plus claim, test and status extraction over a PDF; the fleet's coordination primitives (lease, work claim, remediation contract) as a small library for anyone running autonomous agents |
| C. Formal verification | Lean 4, Mathlib-compatible where possible | ultrametric-lean (done); port to Mathlib `IsUltrametricDist`; formalize the JPCUB anti-gaming definitions (a metric definition is where formal methods catch loopholes); state, and where possible prove, the QEC-Darwinism trade-off |
| D. AI research about AI research | the corpus as data | a dataset and paper on the reproducibility of AI-assisted research, built from the companions' results (3.1 is the first data point), the errata ledger and the review ledgers; an autoformalization benchmark: what share of the corpus's mathematical claims a model can state in Lean, and how many then build |

Breadth of the intake: RESEARCH-SCAN-LANES-1 (`qnfo-cloud-ops` 1.21.0) splits the daily arXiv scan into three lanes,
each its own query and quota: quantum and energy (unchanged), AI agents and epistemics, and formal verification. It
keeps the same ten results, five idea proposals and one extractor call a day. Each proposal names its lane, so the effect
on `idea_topic_concentration_30d` can be told apart from the two other levers that landed on it today (radar-hub
SIGNAL-INTAKE-SOURCES-1 and the idea-hub diversity hold). Outreach criteria are unchanged.

## 5. Definition of done for a library

1. The tested source lives in `research-code/<name>/`; each library also has a public repository mirror listed in
   `research-code/README.md`. Python libraries install directly from GitHub, and the Lean library builds from a checkout.
2. Tests run in CI on every change (`.github/workflows/research-code.yml`), offline, with a pinned toolchain.
3. The README carries the three STRATEGY-1 lines: **claim**, **test**, **status**, and a table of what the paper states
   versus what the library assumes. Any disagreement with the paper is a pinned test and an `agent_issues` row.
4. `CITATION.cff` (the paper as preferred citation), the QNFO-ULA v2.1
   `LICENSE`, an SPDX header in every source file (`LicenseRef-QNFO-ULA-2.1`, Appendix C), and the words
   "source-available", never "open source" (section 12.8).
5. No network access, no secret and no model provider inside the library. A model, if needed, is a function the user
   passes in.
6. Registered as a `research_code_libraries` row.

## 6. Measurement (migrations/2026-10-06-code-reach.sql)

| Metric | Definition | Target | Trigger |
|---|---|---|---|
| `research_code_public` | staged libraries whose repository is public in `portfolio_repos` | >= 3 | < 3 -> agent_issues |
| `research_code_stars_total` | stars on those repositories | report | exempt until 30 days after the first is public (no baseline) |
| `idea_topic_concentration_30d` (existing) | share of accepted ideas in the largest cluster | <= 0.50 | existing trigger |

Predictions, stated so they can fail:
- `idea_topic_concentration_30d` falls under 0.50 within 30 days of the 1.21.0 deploy. If it does not, read the
  accepted auto-scan proposals by lane. If AI and formal lanes are rejected at triage, the triage rubric is the
  bottleneck, not the intake.
- Within 90 days of the three repositories going public, at least one external use appears: a star or fork from outside
  the owner's account, a dependent, or a citation of a library. If none does, the licence is the first suspect (section
  2) and the owner is shown this number on the dashboard.

Guards: no library may be counted as public while its CI is red, and the program adds no worker, cron or model call.

## 7. Public distribution

The three public repositories already exist and are visible in the portfolio; `research_code_public` read 3 on
2026-11-02. The staging index links each public source and gives direct installation or build instructions. A package
registry or external identifier is not required for public source access.

The code stays under the QNFO-ULA, updated for software. Post v2.1 by copying
  `docs/license/for-QNFO-license/` to `QNFO/license` (the session was refused write access there). Four choices in it are
  the Licensor's and are listed in `docs/license/README.md`. Post v2.1 before the library repositories go public, so
  they never ship under CC terms.

## 8. Open items and failure modes

- `AGENTIC-COLLAPSE-REPRO-1`: the v2 paper.
- The Agentic Collapse citation the owner reports is absent from `citation_stats`; the citation tracker needs a source
  that sees it (Semantic Scholar or Google Scholar alerts), or the citing work is not in OpenAlex or DataCite.
- Selected works: Agentic Collapse is not among STRATEGY-1's selected works, and it should not be promoted until its v2
  exists. ignorance-audit and the accepted conference paper are the stronger lead for the AI-for-science audience now.
- Failure mode: a staged library may be public but its index or installation example can still direct readers to an
  unavailable package. `research-code/README.md` and the per-library installation instructions link directly to the
  public source and are covered by `research-code/public-mirrors.test.mjs`.
- Failure mode: the new arXiv lanes return off-topic hits (for example "agentic" chemistry papers). Each lane is
  category-bounded, and the lane name on every proposal makes the reject rate per lane measurable.
