# ultrametric-lean

Machine-checked proofs, in Lean 4 with no dependencies beyond the toolchain, of the ultrametric facts the QNFO
ultrametric programme relies on (for example *The Ultrametric Program: One Structural Object Across Seven Research
Domains, and Its Falsifiable Tests*, papers.qnfo.org, and the
QEC-Darwinism work in `QNFO/qec-darwinism-ultrametric`). Public source:
[QNFO/ultrametric-lean](https://github.com/QNFO/ultrametric-lean).

| Theorem | Statement |
|---|---|
| `isosceles` | if `d x y ≠ d y z` then `d x z = max (d x y) (d y z)` |
| `ball_any_center` | every point of a closed ball is a centre of it |
| `ball_nested_or_disjoint` | for `r ≤ s`, a radius-`r` ball is inside a radius-`s` ball or disjoint from it |
| `confinement` | if `d c x ≤ r < d c c'` then `d c' x = d c' c`: an error inside a codeword's ball is invisible to every other codeword's distance |
| `unique_decoding` | codewords separated by more than `r` decode every error of size at most `r` uniquely (Hamming space needs `2r + 1`) |
| `separation_r_not_enough` | the bound is tight: separation `r` is not enough |

- **Claim:** ultrametric codes decode uniquely at separation `r + 1`, against `2r + 1` for Hamming codes.
- **Test:** `lake build` checks every proof; CI fails if any theorem depends on `sorryAx`.
- **Status:** proved for natural-number-valued ultrametrics (tree depths; p-adic distances on a bounded valuation
  range after reindexing). These are textbook facts, not new mathematics; the point is that the programme's
  load-bearing lemmas are now checked, not asserted. What is not formalized: that a physical error model is ultrametric
  in the first place, which is the empirical claim the programme has to test.

```
git clone https://github.com/QNFO/ultrametric-lean.git
cd ultrametric-lean
lake build                         # toolchain pinned in lean-toolchain
lake env lean AxiomCheck.lean      # lists the axioms each theorem uses
```

Next steps: port to Mathlib's real-valued `IsUltrametricDist`, then formalize the programme's own claims (the
QEC-Darwinism trade-off, staircase redundancy) where they are precise enough to state.

## Licence

Source-available under the QNFO Unified License Agreement v2.1 (`LicenseRef-QNFO-ULA-2.1`), whose Software Terms
(section 12) cover code: free for personal use, teaching, published research and non-profit or public work, with a
patent license for those uses. Any use that generates money, including use inside a company, a paid or ad-funded
service, or paid deliverables, needs a separate agreement (section 10.7). Changes you share stay under the same
license, with their source. This is not an open source license (section 12.8). Full text: `LICENSE` and
https://legal.qnfo.org/.
