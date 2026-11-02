# agentic-collapse

Reference implementation of the model in *AGENTIC COLLAPSE: A Time-Delayed Cybernetic Framework for Epistemic
Stability in Autonomous AI Systems* (Rowan Brad Quni-Gudzinas, papers.qnfo.org).

An autonomous agent's generative drive (phi) outruns a verifier that sees it with a lag (psi), dissonance builds up as
epistemic potential (U), and a "Popperian Guillotine" resets the agent when U crosses a threshold. This package runs
that model, measures collapse probabilities with confidence intervals, and sweeps the "Epistemic Speed Limit": the
fastest generative drive a given verification lag can afford.

- **Claim (the paper's):** with noise on U and a finite threshold, an open-ended agent loop crosses the threshold
  eventually, and a lagged verifier makes the crossing likelier.
- **Test:** `collapse_stats` and `speed_limit` measure it; `tests/` pins the behaviour, `check-paper` checks the
  published trajectory against the published equations.
- **Status:** reference implementation 0.1.0. The first half of the claim is reproduced; the second is not, under the
  default assumptions (see Findings). Four parameters the paper needs but does not state are assumed (below).

```
pip install git+https://github.com/QNFO/agentic-collapse.git
pip install .                         # from a local checkout
agentic-collapse run --seed 0         # one trajectory, a row every 10 time units
agentic-collapse stats --runs 500     # collapse probability with a 95% Wilson interval
agentic-collapse speed-limit --runs 200
agentic-collapse check-paper          # published v1 states vs the published phi equation
```

```python
from agentic_collapse import Params, simulate, collapse_stats
tr = simulate(Params(tau=1.0), seed=42)
print(tr.first_collapse, tr.resets)
print(collapse_stats(Params(tau=1.0), runs=500).wilson_interval())
```

## What the paper states and what this package assumes

| Parameter | Value | Source |
|---|---|---|
| alpha, gamma, k, tau, U_crit | 0.85, 0.65, 2.5, 3.0, 0.88 | paper, section 3.2 |
| sigma_phi, sigma_U, dt, T, S(0) | 0.06, 0.03, 0.05, 100, (0.15, 0.0, 0.1) | paper, sections 3.1 and 3.3 |
| beta, lambda, kappa, mu | 1.0, 0.5, 0.1, 0.5 | **assumed**: needed to run the model, not stated in v1 |
| clipping phi, psi to [0, 1], U >= 0 | on | **assumed**: phi and psi are described as probabilities |
| reset target | S(0), delay history discarded | **assumed** from "return to a safe baseline state" |

Collapse probabilities and the speed limit depend on the assumed values; report them with any result
(`agentic-collapse stats` prints them).

## Findings

### 1. The v1 trajectory does not follow from the v1 equations

The phi equation uses only alpha and gamma, which the paper states. At the reported state for t = 10
(phi = 0.7812, psi = 0.1241) its drift is -0.28 per time unit, about 4.7 noise standard deviations per unit time, and
the stable phi for that psi is 0.447. The reported plateau (phi about 0.92, psi about 0.71) and terminal state also sit
above the phi nullcline with negative drift. So the trajectory in section 4 cannot come from the stated phi equation
and parameters alone. `tests/test_paper_consistency.py` pins this, and the result does not depend on any assumed
parameter. The model and its qualitative conclusions (lag makes collapse likelier; a threshold reset bounds damage)
are reproduced here; the specific numbers in section 4 are not.

### 2. Under the default assumptions, a longer lag lowers collapse probability at moderate drive

With alpha = 0.6 and T = 30 (100 seeded runs each), the collapse probability is 0.97 at tau = 0, 0.75 at tau = 3 and
0.44 at tau = 6. The coupling term -gamma(phi - psi(t - tau)) pulls phi toward the verifier's state; a lagged psi stays
near zero longer, so phi decays and dissonance stays low. At alpha >= 0.85 every lag collapses within T = 30. This is
conditional on the four assumed parameters; it shows that the paper's central qualitative claim needs those parameters
stated before it can be tested. `test_lag_effect_under_default_assumptions` pins it.

## Licence

Source-available under the QNFO Unified License Agreement v2.1 (`LicenseRef-QNFO-ULA-2.1`), whose Software Terms
(section 12) cover code: free for personal use, teaching, published research and non-profit or public work, with a
patent license for those uses. Any use that generates money, including use inside a company, a paid or ad-funded
service, or paid deliverables, needs a separate agreement (section 10.7). Changes you share stay under the same
license, with their source. This is not an open source license (section 12.8). Full text: `LICENSE` and
https://legal.qnfo.org/.
