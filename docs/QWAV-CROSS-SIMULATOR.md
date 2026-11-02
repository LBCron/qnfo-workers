# qwav demo cross-check (RM-QWAV-CROSS-SIMULATOR-1)

Charter pillar: **research**. Issue: agent_issues 1000642 (docs/SCOUT-ROADMAP-2026-10.md). Survey made 2026-10-28 from the demo repositories on GitHub
(`QNFO/qwav-demo-*`, each a single `index.html` plus README; the two read in full were `qwav-demo-error-confinement` and
`qwav-demo-hardware-visualizer`, a third, `qwav-demo-bt-qec`, was searched for simulator terms).

## What the survey found (the premise of the roadmap item does not hold as written)

The item asks to run each demo's golden value on "one independent quantum simulator" (eigenkit, ffsim, QuTiP, Cirq/qsim). The golden values that exist are
not quantum-simulation outputs:

| Demo | Golden values in the code | Quantum content | Independent check that fits |
|---|---|---|---|
| qwav-demo-error-confinement | `verifyMath`: total nodes (p^(d+1)-1)/(p-1), leaves p^d, subtree sizes | none: a rooted p-ary tree and the strong triangle inequality | explicit tree construction, independent counts and ultrametric triple checks in `scripts/qwav_golden_crosscheck.py` |
| qwav-demo-bt-qec | default p=2, d=3: 15 nodes, 8 deepest-level nodes, 14 non-root nodes | QEC wording and tree arithmetic; no quantum state or dynamics | explicit tree construction checks displayed node/depth/redundancy values |
| qwav-demo-hardware-visualizer | p=3, d=3: 40 atoms, levels 1+3+9+27, 39 parent-child gate edges | illustrative lattice and gate edges; no physical blockade distances or quantum dynamics | independent layer and edge counts; no quantum simulator is warranted for these displayed values |
| qwav-demo-tree-distance, qwav-demo-ultrametric-convergence, qwav-demo-qpna-classifier, qwav-demo-monna-map-perspective | not read yet | tree and clustering geometry | second implementation (scipy cophenetic distance, networkx) |

So the table the item asks for ("demo, simulator, agreement") is built with the independent method that fits each demo; a quantum simulator is named only
where a demo computes a quantum quantity. Forcing a simulator onto a tree identity would produce an agreement that proves nothing.

## Implemented

`python3 scripts/qwav_golden_crosscheck.py` independently builds the trees by explicit expansion, recounts all node layers and subtree sizes, checks the QEC
redundancy values and the hardware visualizer's parent-child edge count, and checks the strong triangle inequality on up to 27 leaves. It prints a demo-specific
agreement table; `python3 scripts/qwav_golden_crosscheck.py --selftest` checks the known displayed values and is run by
`scripts/qwav_golden_crosscheck.test.mjs` in the existing offline suite runner.

## Still to do (owner: the code loop, one demo per task)

1. `qwav-demo-tree-distance`, `qwav-demo-ultrametric-convergence`, `qwav-demo-qpna-classifier`, and `qwav-demo-monna-map-perspective`: list the numbers each page computes and displays.
2. Add the independent check that fits for each published demo, with a selftest case and its agreement recorded here.
3. The demos live in other repositories, so this check validates documented formulas and known displayed values, not the live pages' JavaScript. Re-read each page
   when its formulas change; a quantum simulator belongs only where a demo actually computes quantum-state or dynamics values.

## Failure mode

The check validates the demo's stated formulas, not that the demo's JavaScript implements them: a demo that displays a wrong number while its `verifyMath`
passes is not caught here. Closing that gap needs the page's computed values (a headless-browser read), which is not built.
