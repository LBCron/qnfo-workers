# qwav demo cross-check (RM-QWAV-CROSS-SIMULATOR-1)

Charter pillar: **research**. Issue: agent_issues 1000642 (docs/SCOUT-ROADMAP-2026-10.md). First survey 2026-10-28 (error-confinement, hardware-visualizer, a search of
bt-qec); every other published demo page was read on 2026-11-05 from the GitHub Pages sites (`https://qnfo.github.io/qwav-demo-*/`, and
`https://qwav-demo-bt-qec.pages.dev/`), each a single `index.html` with one inline script.

## What the survey found (the premise of the roadmap item does not hold as written)

The item asks to run each demo's golden value on "one independent quantum simulator" (eigenkit, ffsim, QuTiP, Cirq/qsim). None of the seven published demo pages
computes a quantum state, amplitude, energy or dynamics. What they compute and print is tree combinatorics (node, leaf and subtree counts, LCA depth, ultrametric
distance), seeded random numbers averaged over a tree, single-/complete-/average-linkage clustering of 2D points, and the Monna map M(x) = sum d_k p^-k of integers.
A quantum simulator has nothing to compute for these values; forcing one onto a tree identity would produce an agreement that proves nothing. The table the item asks
for ("demo, simulator, agreement") is therefore built with the independent implementation that fits each page, and the simulator column says so.

## Agreement table (every published demo repository)

Counts are comparisons made by `python3 scripts/qwav_golden_crosscheck.py` on 2026-11-05 between the independent implementation and (a) the closed form the demo
states, and (b) the number the page's own function returned for the same input, recorded in `docs/qwav-page-golden.json`. Largest absolute difference in the last column.

| Demo (artifact) | What the page computes and shows | Independent implementation (quantum simulator: none fits) | Page-code comparisons | Agree | Largest difference |
|---|---|---|---|---|---|
| qwav-demo-error-confinement (A1) | total nodes, leaves, subtree size of an error, safe nodes, confinement percent, p = 2,3,5, depth 1..6 | explicit tree expansion; breadth-first id numbering and level counts | 494 | yes | 0 |
| qwav-demo-ultrametric-convergence (A3) | seeded leaf values (mulberry32), variance after coarse-graining k = 0..d, the Verify button | the generator re-implemented bit for bit; direct block means; law of total variance | 109 | yes | 1.1e-16 |
| qwav-demo-qpna-classifier (A2) | single/complete/average linkage merge heights, cophenetic matrix, CPCC, clusters at half height, the readouts it prints | Lance-Williams recurrence, Kruskal minimum spanning tree (single linkage), two-pass Pearson | 1738 | yes | 7.9e-15 |
| qwav-demo-tree-distance (A4) | depth(LCA), p^-depth(LCA), leaf Euclidean distance, triadic rigidity, the Verify button | base-p digit strings (LCA depth = common prefix), exhaustive triples up to 64 leaves | 2029 | yes | 0 |
| qwav-demo-hardware-visualizer (A5) | 40 atoms, 39 gate edges, atoms per level 1/3/9/27 | explicit tree expansion, level counts | 4 | yes | 0 |
| qwav-demo-bt-qec | node count, redundancy per level, total redundancy, staircase, nodes affected by an error | explicit tree expansion, level counts | 522 | yes | 0 |
| qwav-demo-monna-map-perspective | M(x) of integers incl. negatives, the seven golden identities, rendered/naive sizes, 2D grid | exact rational arithmetic (`fractions`) on p-adic digits from x mod p^24 | 600 | yes | 2.7e-15 |
| qwav-demos (consolidation; 1 of 5 pages identical to a row above) | four older pages not read | none yet | 0 | not checked | - |

All published demos covered: no

The last line is the output of `python3 scripts/qwav_golden_crosscheck.py --coverage` and `scripts/qwav_golden_crosscheck.test.mjs` fails when this document and the
script disagree. It reads `yes` only when `qwav-demos` (the 2026-08-04 consolidation repository) has a row. Of its five subdirectories, `monna-map-perspective/index.html` is byte-identical
to the page replayed above (git blob `eaaf7a8a`, compared 2026-11-05); `convergence-explorer` (7.3 KB), `error-confinement-demo` (10.2 KB), `qpna-playground` (15.5 KB) and
`hardware-visualizer` (11.0 KB, with a bundled three.js) are older and much smaller than the `qwav-demo-*` artifacts (27.8, 38.3, 28.6 and 17.4 KB) and were not read, so this item stays open until they have a row.

## How it works

1. `scripts/qwav_golden_crosscheck.py` (the independent implementations, the table, `--selftest`, `--inputs`, `--coverage`).
2. `docs/qwav-page-golden.json`: `inputs` (fixed, written by `--inputs`; the selftest fails if they drift from the script), `page_outputs` (what the page's own functions
   returned), `pages` (url, size and sha256 of the `index.html` replayed, so a changed page shows in the diff).
3. `scripts/qwav_page_replay.mjs` runs a page's inline script in a Node `vm` context behind a stub DOM and calls the page's own pure functions (`buildTree`, `reseed`,
   `agglomerate`, `monnaRational`, `BTTree`, `verifyMath`, `updateReadouts`, ...) on the recorded inputs. It draws nothing. `scripts/qwav_page_replay.test.mjs` covers it.
4. The selftest corrupts one recorded page value per demo and requires the comparison to report a disagreement, so an agreement row cannot be vacuous.

Refreshing after a page changes (or to add a demo):

```
curl -s https://qnfo.github.io/qwav-demo-tree-distance/ -o tree-distance.html          # one file per page, outside the repository
node scripts/qwav_page_replay.mjs --golden docs/qwav-page-golden.json --page tree-distance=tree-distance.html --write
python3 scripts/qwav_golden_crosscheck.py --selftest && python3 scripts/qwav_golden_crosscheck.py
```

## Observations for the demo owners (found while reading the pages; none is an independent-implementation disagreement)

- qwav-demo-tree-distance: the readout called "Cophenetic Distance" is `depth(LCA)`. It grows as two leaves get closer, while a cophenetic distance (the height at which two
  leaves join, as in scipy `cophenet`) shrinks; here that height would be `d - depth(LCA)`. The check agrees with the page's stated formula `d_coph = depth(LCA)`,
  not with the usual meaning of the word. The "Euclidean Distance" between leaves is `0.3 x |slot difference|`, an embedding artefact of the drawing.
- qwav-demo-qpna-classifier draws its point clouds and the neural baseline's initial weights with `Math.random()`, so no number it shows on screen is reproducible. The clustering
  and CPCC code is checked on fixed point sets (three sets of 12, 16 and 20 points, three linkages); the data generators and the baseline's accuracy are not.
- qwav-demo-monna-map-perspective: its golden-value gate tolerance (1e-6) is wider than the page's actual error (3e-15 against exact arithmetic); the gate is sound, not tight.

## Limits (state these whenever the table is quoted)

- The pages are in other repositories. The check validates the page code as recorded (sha256 in `docs/qwav-page-golden.json`), on the inputs listed there, not the live page
  after a later edit and not browser rendering: re-record when a page changes. A headless-browser read of the live numbers is not built.
- Only the pure functions are replayed. Canvas drawing, event handling, the guided tours and the neural baseline are not.
- Sampled inputs: tree-distance compares 489 leaf pairs of 12 trees (all triples for trees of up to 64 leaves, sampled triples above); error sizes are compared at 12 probe nodes per tree.

## Certificates (RM-BS-QUANTUM-COMMONS-1, 2026-11-05)

`docs/qwav-certificates.json` is the machine-readable form of the table: one entry per published demo repository with its status (`verified` when every check agrees, `disagreement`,
or `not-checked` for `qwav-demos`), the number of named quantity checks, the independent methods, what the certificate covers (`certifies`), the replayed page URL and sha256. Every
file carries the standing line that it certifies no quantum state, hardware result or advantage claim, because none of these demos computes one. It is generated by
`python3 scripts/qwav_golden_crosscheck.py --write-certificates` and `scripts/qwav_golden_crosscheck.test.mjs` fails when it is stale. `verified_share` (demos verified over demos
published) is the measure the blue-sky roadmap B6 names; it reads 7 of 8 until `qwav-demos` is read. Serving it at `qwav.org` and showing a badge on each demo page is the next
slice (a qnfo-gateway change, filed as an issue with a doer).

## Still to do

- `qwav-demos`: read the four older subdirectories and add a replay for each (ROADMAP-1 row filed with agent_issues 1000642); then flip the coverage line above.
- A quantum simulator (QuTiP, Cirq/qsim, eigenkit) belongs in CI only if a demo starts computing quantum-state or dynamics values. Until then installing one would add a heavy
  dependency that checks nothing; the check for such a demo is added in the same change as the demo.
