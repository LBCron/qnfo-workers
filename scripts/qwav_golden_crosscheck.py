#!/usr/bin/env python3
"""RM-QWAV-CROSS-SIMULATOR-1 (agent_issues 1000642, charter pillar research): independent second implementations of the numbers the published
QWAV demos (QNFO/qwav-demo-*, one index.html each) compute and display.

Two layers, both offline:

1. FORMULA layer (since PR 6367). The error-confinement, BT-QEC and hardware-visualizer demos check a rooted p-ary tree of depth d against three closed
   forms (total nodes (p^(d+1)-1)/(p-1), leaves p^d, subtree sizes). This script builds the tree explicitly (breadth first, parent lists, no formula in the
   construction), recounts those quantities and checks the strong triangle inequality of the tree ultrametric on every triple.
2. PAGE layer. docs/qwav-page-golden.json holds fixed inputs and the outputs that each page's OWN code returned for them
   (scripts/qwav_page_replay.mjs runs the page's functions in Node behind a stub DOM). This script recomputes every one of those numbers by a different
   method and compares: the tree-distance page against base-p digit strings (instead of its explicit tree and LCA walk), the ultrametric-convergence page
   against its seeded generator re-implemented here and direct block means (instead of its recursive means), the Q-PNA classifier against Lance-Williams
   and Kruskal clustering with a two-pass Pearson (instead of its pairwise recomputation and raw sums), the Monna map page against exact rational p-adic
   digits (instead of its floating recurrence), and the two QEC pages and the hardware visualizer against level counts.

None of this is a quantum simulator: no published demo computes a quantum state, amplitude or dynamics (see docs/QWAV-CROSS-SIMULATOR.md). The method
column of the table names the independent implementation that fits each demo; a simulator is named only where a demo computes a quantum quantity.

Usage:
  python3 scripts/qwav_golden_crosscheck.py            print the agreement table (markdown) and exit 1 on any disagreement
  python3 scripts/qwav_golden_crosscheck.py --json     the same as JSON
  python3 scripts/qwav_golden_crosscheck.py --inputs   print the fixed inputs (the inputs section of docs/qwav-page-golden.json)
  python3 scripts/qwav_golden_crosscheck.py --coverage print the published-demo coverage lines used by docs/QWAV-CROSS-SIMULATOR.md
  python3 scripts/qwav_golden_crosscheck.py --certificates          print the per-demo certificates (JSON, RM-BS-QUANTUM-COMMONS-1)
  python3 scripts/qwav_golden_crosscheck.py --write-certificates    write them to docs/qwav-certificates.json
  python3 scripts/qwav_golden_crosscheck.py --selftest offline suite
"""
import itertools
import json
import math
import os
import sys
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN_PATH = os.path.join(HERE, "..", "docs", "qwav-page-golden.json")

CASES = [
    ("qwav-demo-error-confinement", 2, 3),
    ("qwav-demo-bt-qec", 2, 3),
    ("qwav-demo-hardware-visualizer", 3, 3),
]

# Every published demo repository, what the page computes, and whether a check exists for it. A repository is covered when the table has a formula row
# and a page row for it (a repository whose pages were not read is listed as not covered, never left out).
PUBLISHED_DEMOS = [
    {"repo": "qwav-demo-error-confinement", "artifact": "A1", "covered": True, "quantum_values": False},
    {"repo": "qwav-demo-ultrametric-convergence", "artifact": "A3", "covered": True, "quantum_values": False},
    {"repo": "qwav-demo-qpna-classifier", "artifact": "A2", "covered": True, "quantum_values": False},
    {"repo": "qwav-demo-tree-distance", "artifact": "A4", "covered": True, "quantum_values": False},
    {"repo": "qwav-demo-hardware-visualizer", "artifact": "A5", "covered": True, "quantum_values": False},
    {"repo": "qwav-demo-bt-qec", "artifact": "-", "covered": True, "quantum_values": False},
    {"repo": "qwav-demo-monna-map-perspective", "artifact": "-", "covered": True, "quantum_values": False},
    {"repo": "qwav-demos", "artifact": "-", "covered": False, "quantum_values": None,
     "note": "consolidation (2026-08-04): monna-map-perspective/index.html is byte-identical to the replayed page (git blob eaaf7a8a); convergence-explorer, error-confinement-demo, qpna-playground and hardware-visualizer are older, smaller pages and were not read"},
]


def coverage_verdict(all_covered):
    return "All published demos covered: %s" % ("yes" if all_covered else "no")


def coverage():
    covered = [d["repo"] for d in PUBLISHED_DEMOS if d["covered"]]
    missing = [d["repo"] for d in PUBLISHED_DEMOS if not d["covered"]]
    return {"covered": covered, "not_covered": missing, "all": not missing}


# ------------------------------------------------------------------ formula layer (PR 6367)
def build(p, depth):
    """Rooted p-ary tree by breadth-first expansion: parent[i] for node i, depth_of[i]; root is node 0."""
    parent, dep = [-1], [0]
    frontier = [0]
    for lvl in range(1, depth + 1):
        nxt = []
        for node in frontier:
            for _ in range(p):
                parent.append(node)
                dep.append(lvl)
                nxt.append(len(parent) - 1)
        frontier = nxt
    return parent, dep


def subtree_size(parent, node):
    """Size of the subtree rooted at node, by counting descendants (walk each other node's parent chain)."""
    n = 0
    for i in range(len(parent)):
        j = i
        while j != -1:
            if j == node:
                n += 1
                break
            j = parent[j]
    return n


def lca_depth(parent, dep, a, b):
    anc = set()
    x = a
    while x != -1:
        anc.add(x)
        x = parent[x]
    y = b
    while y not in anc:
        y = parent[y]
    return dep[y]


def check_case(demo, p, depth):
    parent, dep = build(p, depth)
    total = len(parent)
    levels = [sum(1 for d in dep if d == lvl) for lvl in range(depth + 1)]
    leaves = levels[depth]
    formula_total = (p ** (depth + 1) - 1) // (p - 1)
    formula_leaves = p ** depth
    formula_levels = [p ** lvl for lvl in range(depth + 1)]
    formula_total_redundancy = sum(formula_levels[1:])
    sub_ok = all(
        subtree_size(parent, node) == (p ** (depth - dep[node] + 1) - 1) // (p - 1)
        for node in range(total)
    )
    # ultrametric distance between leaves: 2 * (depth - depth of the lowest common ancestor); strong triangle inequality on all triples
    leaf_ids = [i for i, d in enumerate(dep) if d == depth]
    ultra_ok, triples = True, 0
    sample = leaf_ids if len(leaf_ids) <= 27 else leaf_ids[:27]
    for a, b, c in itertools.combinations(sample, 3):
        dab = 2 * (depth - lca_depth(parent, dep, a, b))
        dbc = 2 * (depth - lca_depth(parent, dep, b, c))
        dac = 2 * (depth - lca_depth(parent, dep, a, c))
        triples += 1
        if not (dac <= max(dab, dbc) and dab <= max(dac, dbc) and dbc <= max(dab, dac)):
            ultra_ok = False
    base = {"demo": demo, "method": "explicit tree expansion vs closed form", "p": p, "depth": depth}
    rows = [
        dict(base, quantity="total nodes", counted=total, closed_form=formula_total, agree=total == formula_total),
        dict(base, quantity="nodes by depth", counted=levels, closed_form=formula_levels, agree=levels == formula_levels),
        dict(base, quantity="leaf count", counted=leaves, closed_form=formula_leaves, agree=leaves == formula_leaves),
        dict(base, quantity="total non-root redundancy", counted=total - 1, closed_form=formula_total_redundancy, agree=total - 1 == formula_total_redundancy),
        dict(base, quantity="subtree sizes (all nodes)", counted="all", closed_form="all", agree=sub_ok),
        dict(base, quantity="strong triangle inequality (%d leaf triples)" % triples, counted="holds" if ultra_ok else "fails", closed_form="holds", agree=ultra_ok),
    ]
    if demo == "qwav-demo-hardware-visualizer":
        gate_edges = sum(1 for node in parent if node != -1)
        rows.append(dict(base, quantity="parent-child gate edges", counted=gate_edges, closed_form=total - 1, agree=gate_edges == total - 1))
    return rows


# ------------------------------------------------------------------ fixed inputs of the page layer
def _lcg(seed):
    state = [seed % (1 << 64)]

    def nxt():
        state[0] = (state[0] * 6364136223846793005 + 1442695040888963407) % (1 << 64)
        return (state[0] >> 11) / float(1 << 53)
    return nxt


def _points_ok(points):
    """No two pairwise distances closer than 1e-7: a tie would let two correct clusterings merge in a different order."""
    ds = sorted(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in itertools.combinations(points, 2))
    return all(y - x > 1e-7 for x, y in zip(ds, ds[1:]))


def _qpna_sets():
    r = _lcg(2026)
    nested = []
    for li, count in enumerate((1, 3, 8)):
        rad = 0.14 + li * 0.2
        for k in range(count):
            a = k / count * 2 * math.pi + li * 0.7
            nested.append([round(0.5 + rad * math.cos(a) + (r() - 0.5) * 0.024, 5), round(0.5 + rad * math.sin(a) + (r() - 0.5) * 0.024, 5)])
    centers = [(0.32, 0.34), (0.62, 0.28), (0.3, 0.68), (0.68, 0.66)]
    branched = []
    for cx, cy in centers:
        for _ in range(4):
            g = [sum(r() for _ in range(4)) - 2 for _ in range(2)]
            branched.append([round(cx + g[0] * 0.05, 5), round(cy + g[1] * 0.05, 5)])
    uniform = [[round(r(), 5), round(r(), 5)] for _ in range(20)]
    sets = [("nested-12", nested), ("branched-16", branched), ("uniform-20", uniform)]
    for name, pts in sets:
        if not _points_ok(pts):
            raise SystemExit("qwav inputs: tied distances in set " + name)
    return [{"name": n, "points": p} for n, p in sets]


def _td_sample(p, d):
    n = p ** d
    base = {0, 1, p - 1, p, p * p - 1, p * p, n // 2 - 1, n // 2, n - p, n - 1}
    return sorted(s for s in base if 0 <= s < n)


def inputs():
    td = []
    for p in (2, 3, 5):
        for d in (3, 4, 5, 6):
            sample = _td_sample(p, d)
            td.append({"p": p, "d": d, "pairs": [[a, b] for a, b in itertools.combinations(sample, 2)]})
    xs = [0, 1, 2, 3, 4, 5, 7, 8, 9, 25, 27, 100, 125, 625, 1000, 1 << 20, -1, -2, -3, -4, -5, -7, -8, -9, -25, -27, -100, -125, -1000, -(1 << 20)]
    return {
        "tree-distance": {"configs": td},
        "ultrametric-convergence": {"configs": [{"p": p, "d": d, "seed": s} for p, d, s in ((3, 5, 42), (2, 3, 42), (2, 6, 42), (5, 3, 42), (3, 6, 7), (5, 4, 2026))]},
        "qpna-classifier": {"sets": _qpna_sets()},
        "monna-map-perspective": {"primes": [2, 3, 5], "xs": xs, "depths": [1, 3, 5, 8]},
        "hardware-visualizer": {},
        "error-confinement": {
            "configs": [{"p": p, "d": d} for p in (2, 3, 5) for d in (1, 2, 3, 4, 5, 6)],
            "probe_depth_fractions": [0, 0.34, 0.67, 1],
            "readout_cases": [
                {"p": 2, "d": 3, "depth_of_error": 1, "index": 0}, {"p": 2, "d": 3, "depth_of_error": 3, "index": 7},
                {"p": 3, "d": 4, "depth_of_error": 2, "index": 5}, {"p": 5, "d": 3, "depth_of_error": 0, "index": 0},
                {"p": 5, "d": 3, "depth_of_error": 3, "index": 100}, {"p": 3, "d": 6, "depth_of_error": 1, "index": 2},
            ],
        },
        "bt-qec": {"configs": [{"p": p, "d": d} for p in (2, 3, 5) for d in (1, 2, 3, 4, 5, 6)], "probe_depth_fractions": [0, 0.34, 0.67, 1]},
    }


# ------------------------------------------------------------------ helpers
def close(a, b, rel=1e-12, absolute=1e-15):
    return abs(a - b) <= max(absolute, rel * max(abs(a), abs(b)))


def js_round(x):
    """Math.round: halves round up."""
    return math.floor(x + 0.5)


class Tally:
    """Collects the comparisons of one quantity into one table row: how many were made, how many disagreed, the worst difference."""

    def __init__(self, demo, method, quantity):
        self.demo, self.method, self.quantity = demo, method, quantity
        self.n = 0
        self.bad = []
        self.worst = 0.0

    def eq(self, independent, page, label=""):
        self.n += 1
        if independent != page:
            self.bad.append("%s independent %r page %r" % (label, independent, page))

    def near(self, independent, page, rel=1e-12, absolute=1e-15, label=""):
        self.n += 1
        diff = abs(independent - page)
        self.worst = max(self.worst, diff)
        if not close(independent, page, rel, absolute):
            self.bad.append("%s independent %r page %r" % (label, independent, page))

    def row(self):
        ok = self.n > 0 and not self.bad
        shown = "%d compared" % self.n + (", max abs diff %.2e" % self.worst if self.worst else ", all identical")
        return {"demo": self.demo, "method": self.method, "quantity": self.quantity, "counted": shown if ok else "; ".join(self.bad[:3]) or "nothing compared",
                "closed_form": "page code", "agree": ok}


# ------------------------------------------------------------------ tree-distance (A4): base-p digit strings
def td_digits(slot, p, d):
    out = []
    for _ in range(d):
        out.append(slot % p)
        slot //= p
    return out[::-1]


def td_lca_depth(sa, sb, p, d):
    """Depth of the lowest common ancestor of two leaves = length of the common prefix of their base-p digit strings."""
    da, db = td_digits(sa, p, d), td_digits(sb, p, d)
    k = 0
    while k < d and da[k] == db[k]:
        k += 1
    return k


def td_ultra(sa, sb, p, d):
    return Fraction(1, p ** td_lca_depth(sa, sb, p, d))


def td_triples_ok(p, d):
    """Strong triangle inequality and triadic rigidity (the two largest of three ultrametric distances are equal), by digit strings.
    All triples when the tree has at most 64 leaves, otherwise the triples of the sampled leaves."""
    n = p ** d
    slots = list(range(n)) if n <= 64 else _td_sample(p, d)
    checked = 0
    for a, b, c in itertools.combinations(slots, 3):
        dist = sorted([td_ultra(a, b, p, d), td_ultra(b, c, p, d), td_ultra(a, c, p, d)], reverse=True)
        checked += 1
        if dist[0] != dist[1]:
            return False, checked
    return True, checked


def check_tree_distance(out):
    demo, method = "qwav-demo-tree-distance", "base-p digit strings (prefix = LCA depth)"
    t_counts, t_coph, t_ult, t_eucl, t_slot = (Tally(demo, method, q) for q in (
        "tree size and leaf count (p in 2,3,5; d in 3..6)", "depth(LCA), shown as \"cophenetic distance\"", "ultrametric distance p^-depth(LCA)",
        "leaf Euclidean distance as the page defines it (0.3 x slot difference)", "leaf i has slot i (digit order)"))
    t_tri = Tally(demo, method, "triadic rigidity: two largest ultrametric distances equal")
    pair_total = 0
    for cfg in out["configs"]:
        p, d = cfg["p"], cfg["d"]
        t_counts.eq((p ** (d + 1) - 1) // (p - 1), cfg["nodes"], "nodes p=%d d=%d" % (p, d))
        t_counts.eq(p ** d, cfg["leaves"], "leaves p=%d d=%d" % (p, d))
        for i, j, sa, sb, coph, ult, eucl in cfg["rows"]:
            pair_total += 1
            t_slot.eq((i, j), (sa, sb), "slots")
            t_coph.eq(td_lca_depth(i, j, p, d), coph, "coph p=%d d=%d %d,%d" % (p, d, i, j))
            t_ult.near(float(td_ultra(i, j, p, d)), ult, 1e-12, 0.0, "ult p=%d d=%d %d,%d" % (p, d, i, j))
            t_eucl.near(0.3 * abs(i - j), eucl, 1e-12, 1e-15, "eucl p=%d d=%d %d,%d" % (p, d, i, j))
        n = p ** d
        triple = sorted([float(td_ultra(0, n // 2, p, d)), float(td_ultra(n // 2, n - 1, p, d)), float(td_ultra(0, n - 1, p, d))], reverse=True)
        for a, b in zip(triple, sorted(cfg["verify_triple"], reverse=True)):
            t_tri.near(a, b, 1e-12, 0.0, "verify triple p=%d d=%d" % (p, d))
        ok, checked = td_triples_ok(p, d)
        t_tri.eq(True, ok, "triples p=%d d=%d" % (p, d))
    t_verify = Tally(demo, method, "page Verify button: 7 checks, 7 pass")
    t_verify.eq((7, 7), (out["verify_default"]["total"], out["verify_default"]["passed"]), "verify")
    rows = [t.row() for t in (t_counts, t_slot, t_coph, t_ult, t_eucl, t_tri, t_verify)]
    rows[2]["quantity"] += " (%d sampled leaf pairs)" % pair_total
    return rows


# ------------------------------------------------------------------ ultrametric-convergence (A3): seeded generator and block means
def mulberry32(seed):
    """The seeded generator the page uses (mulberry32), on 32-bit integers."""
    state = [seed & 0xFFFFFFFF]
    mask = 0xFFFFFFFF

    def imul(a, b):
        return (a * b) & mask

    def nxt():
        state[0] = (state[0] + 0x6D2B79F5) & mask
        a = state[0]
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & mask) ^ t
        return ((t ^ (t >> 14)) & mask) / 4294967296
    return nxt


def um_variance(values):
    m = 0.0
    for v in values:
        m += v
    m /= len(values)
    s = 0.0
    for v in values:
        s += (v - m) * (v - m)
    return s / len(values)


def um_between_within(leaves, p, k):
    """Variance of the leaves after grouping them in blocks of p^k, by direct block means, and the mean within-block variance."""
    size = p ** k
    blocks = [leaves[i:i + size] for i in range(0, len(leaves), size)]
    means = [sum(b) / len(b) for b in blocks]
    display = [m for m in means for _ in range(size)]
    within = sum(um_variance(b) for b in blocks) / len(blocks)
    return um_variance(display), within


def check_ultrametric(out):
    demo, method = "qwav-demo-ultrametric-convergence", "seeded generator re-implemented, direct block means, law of total variance"
    t_prng, t_leaf, t_series, t_mono, t_total = (Tally(demo, method, q) for q in (
        "mulberry32(42): first six values (bit for bit)", "leaf values and root mean", "variance after coarse-graining k = 0..d",
        "variance never rises with k and is 0 at the root", "law of total variance: Var(leaves) = Var(block means) + mean within-block Var"))
    g = mulberry32(42)
    for i, v in enumerate(out["prng_42"]):
        t_prng.eq(g(), v, "prng[%d]" % i)
    for run in out["runs"]:
        p, d, seed = run["p"], run["d"], run["seed"]
        rng = mulberry32(seed)
        leaves = [rng() for _ in range(p ** d)]
        t_leaf.eq((p ** (d + 1) - 1) // (p - 1), run["nodes"], "nodes")
        t_leaf.eq(leaves[:4], run["first_leaves"], "first leaves seed %d" % seed)
        t_leaf.eq(leaves[-1], run["last_leaf"], "last leaf seed %d" % seed)
        t_leaf.near(sum(leaves) / len(leaves), run["root_value"], 1e-12, 1e-15, "root mean p=%d d=%d" % (p, d))
        series = []
        for k in range(d + 1):
            between, within = um_between_within(leaves, p, k)
            series.append(between)
            t_series.near(between, run["series"][k], 1e-12, 1e-14, "var p=%d d=%d k=%d" % (p, d, k))
            t_total.near(um_variance(leaves), between + within, 1e-12, 1e-14, "total variance p=%d d=%d k=%d" % (p, d, k))
        t_mono.eq(True, all(b <= a + 1e-15 for a, b in zip(run["series"], run["series"][1:])) and run["series"][d] < 1e-12, "page series monotone p=%d d=%d" % (p, d))
        t_mono.eq(True, all(b <= a + 1e-15 for a, b in zip(series, series[1:])) and series[d] < 1e-12, "independent series monotone p=%d d=%d" % (p, d))
    t_verify = Tally(demo, method, "page Verify button: 6 checks, 6 pass")
    t_verify.eq((6, 6), (out["verify_default"]["total"], out["verify_default"]["passed"]), "verify")
    return [t.row() for t in (t_prng, t_leaf, t_series, t_mono, t_total, t_verify)]


# ------------------------------------------------------------------ qpna-classifier (A2): Lance-Williams, Kruskal, two-pass Pearson
def dist2(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def lance_williams(points, linkage):
    """Agglomerative clustering on a distance matrix updated by the Lance-Williams recurrence. Returns (heights, sizes, cophenetic matrix)."""
    n = len(points)
    d = {(i, j): dist2(points[i], points[j]) for i in range(n) for j in range(i + 1, n)}
    members = {i: [i] for i in range(n)}
    key = lambda a, b: (a, b) if a < b else (b, a)
    heights, sizes = [], []
    coph = [[0.0] * n for _ in range(n)]
    next_id = n
    while len(members) > 1:
        (a, b), h = min(d.items(), key=lambda kv: (kv[1], kv[0]))
        for x in members[a]:
            for y in members[b]:
                coph[x][y] = coph[y][x] = h
        na, nb = len(members[a]), len(members[b])
        new = next_id
        next_id += 1
        for c in list(members):
            if c in (a, b):
                continue
            dac, dbc = d[key(a, c)], d[key(b, c)]
            if linkage == "single":
                v = min(dac, dbc)
            elif linkage == "complete":
                v = max(dac, dbc)
            else:
                v = (na * dac + nb * dbc) / (na + nb)
            d[key(new, c)] = v
        for c in list(members):
            d.pop(key(a, c), None)
            d.pop(key(b, c), None)
        members[new] = members.pop(a) + members.pop(b)
        heights.append(h)
        sizes.append(na + nb)
    return heights, sizes, coph


def kruskal_single(points):
    """Single linkage as the minimum spanning tree: merge heights are its edge weights in ascending order, cophenetic distance the bottleneck."""
    n = len(points)
    edges = sorted((dist2(points[i], points[j]), i, j) for i in range(n) for j in range(i + 1, n))
    parent = list(range(n))
    groups = {i: [i] for i in range(n)}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    coph = [[0.0] * n for _ in range(n)]
    heights = []
    for w, i, j in edges:
        ri, rj = find(i), find(j)
        if ri == rj:
            continue
        for x in groups[ri]:
            for y in groups[rj]:
                coph[x][y] = coph[y][x] = w
        groups[ri] += groups.pop(rj)
        parent[rj] = ri
        heights.append(w)
    return heights, coph


def pearson_two_pass(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    return 0.0 if sxx == 0 or syy == 0 else sxy / math.sqrt(sxx * syy)


def shown_matches(text, exact):
    """The page prints fmt(v): toFixed(4) from 1, toPrecision(4) from 1e-3, toExponential(2) below; compare to the shown precision."""
    try:
        got = float(text)
    except ValueError:
        return False
    return abs(got - exact) <= max(6e-3 * abs(exact), 1e-4)


def check_qpna(out):
    demo, method = "qwav-demo-qpna-classifier", "Lance-Williams and Kruskal clustering, two-pass Pearson"
    t_h, t_s, t_c, t_p, t_k, t_sh = (Tally(demo, method, q) for q in (
        "merge heights, in merge order (single, complete, average linkage)", "merged cluster sizes", "cophenetic distance of every pair",
        "cophenetic correlation coefficient (CPCC)", "single linkage by minimum spanning tree: heights and cophenetic distances",
        "readouts the page prints: 1 - CPCC, CPCC, clusters at half the top height"))
    sets = {s["name"]: s for s in inputs()["qpna-classifier"]["sets"]}
    for s in out["sets"]:
        pts = sets[s["name"]]["points"]
        n = len(pts)
        x = [dist2(pts[i], pts[j]) for i in range(n) for j in range(i + 1, n)]
        for lk, res in s["results"].items():
            heights, sizes, coph = lance_williams(pts, lk)
            label = "%s %s" % (s["name"], lk)
            t_h.eq(len(heights), len(res["heights"]), label + " merges")
            for a, b in zip(heights, res["heights"]):
                t_h.near(a, b, 1e-9, 1e-12, label + " height")
            t_s.eq(sizes, res["sizes"], label + " sizes")
            upper = [coph[i][j] for i in range(n) for j in range(i + 1, n)]
            for a, b in zip(upper, res["cophenetic_upper"]):
                t_c.near(a, b, 1e-9, 1e-12, label + " cophenetic")
            cp = pearson_two_pass(x, upper)
            t_p.near(cp, res["cpcc"], 1e-9, 1e-12, label + " cpcc")
            if lk == "single":
                kh, kc = kruskal_single(pts)
                for a, b in zip(kh, res["heights"]):
                    t_k.near(a, b, 1e-9, 1e-12, label + " mst height")
                for a, b in zip([kc[i][j] for i in range(n) for j in range(i + 1, n)], res["cophenetic_upper"]):
                    t_k.near(a, b, 1e-9, 1e-12, label + " mst cophenetic")
            shown = res["shown"]
            cut = max(heights) * 0.5
            clusters = max(1, n - sum(1 for h in heights if h <= cut))
            t_sh.eq(True, shown_matches(shown["one_minus_cpcc"], 1 - cp), label + " 1-CPCC shown " + shown["one_minus_cpcc"])
            t_sh.eq(True, shown_matches(shown["cpcc"], cp), label + " CPCC shown " + shown["cpcc"])
            t_sh.eq(str(clusters), shown["clusters_at_half_height"], label + " clusters")
    return [t.row() for t in (t_h, t_s, t_c, t_p, t_k, t_sh)]


# ------------------------------------------------------------------ monna-map-perspective: exact rational p-adic digits
PADIC_K = 24


def exact_digits(x, p, k=PADIC_K):
    """First k p-adic digits of an integer, from x mod p^k (negative integers included): exact integer arithmetic, no borrow loop."""
    r = x % (p ** k)
    out = []
    for _ in range(k):
        out.append(r % p)
        r //= p
    return out


def exact_monna(x, p, k=PADIC_K):
    return sum(Fraction(d, p ** i) for i, d in enumerate(exact_digits(x, p, k)))


def check_monna(out):
    demo, method = "qwav-demo-monna-map-perspective", "exact rational arithmetic (fractions) on p-adic digits"
    t_dig, t_val, t_gold, t_row, t_grid = (Tally(demo, method, q) for q in (
        "p-adic digits of 30 integers incl. negatives (p = 2, 3, 5)", "M(x) = sum d_k p^-k, exact rationals against the page's floating recurrence", "golden-value gate: seven identities and smoothness, p = 2, 3, 5 at four depths",
        "readout table: M(p^k) = p^-k, rendered size 1/(1+p^-k), naive size p^k", "2D grid: point count, largest M, corners"))
    tol = 1e-6
    for pr in out["primes"]:
        p = pr["p"]
        for x, value, digits in pr["values"]:
            t_dig.eq(exact_digits(x, p), digits, "digits x=%d p=%d" % (x, p))
            t_val.near(float(exact_monna(x, p)), value, 1e-12, 1e-14, "M(%d) p=%d" % (x, p))
        for n_blk in pr["verify"]:
            exp_names = ["M(1) = 1", "M(p) = 1/p", "M(p^2) = 1/p^2", "M(-1) = p", "M(-p^2) = 1/p", "M(1+p) = 1 + 1/p", "naive ratio p^{k+1}/p^k = p", "rendered smooth (no p-fold jumps, k=0..n)"]
            t_gold.eq(exp_names, [t["name"] for t in n_blk["tests"]], "names")
            exact = [exact_monna(1, p), exact_monna(p, p), exact_monna(p * p, p), exact_monna(-1, p), exact_monna(-p * p, p), exact_monna(1 + p, p)]
            expected = [Fraction(1), Fraction(1, p), Fraction(1, p * p), Fraction(p), Fraction(1, p), 1 + Fraction(1, p)]
            for got, want, t in zip(exact, expected, n_blk["tests"]):
                t_gold.eq(True, abs(got - want) <= Fraction(tol) * max(1, abs(want)), "independent gate " + t["name"] + " p=%d" % p)
                t_gold.eq(True, t["pass"], "page pass flag " + t["name"] + " p=%d n=%d" % (p, n_blk["n"]))
                t_gold.near(float(got), t["got"], 1e-12, 1e-14, "page value " + t["name"])
            smooth = all((1 + Fraction(1, p ** k)) / (1 + Fraction(1, p ** (k + 1))) < p for k in range(n_blk["n"]))
            t_gold.eq(True, smooth and n_blk["tests"][7]["pass"], "smooth p=%d n=%d" % (p, n_blk["n"]))
            t_gold.eq(True, n_blk["tests"][6]["pass"] and abs(n_blk["tests"][6]["got"] - p) < 1e-12, "naive ratio p=%d" % p)
        for k, r, size, raw, norm in pr["k_rows"]:
            t_row.near(float(Fraction(1, p ** k)), r, 1e-12, 1e-15, "r_k p=%d k=%d" % (p, k))
            t_row.near(float(1 / (1 + Fraction(1, p ** k))), size, 1e-12, 1e-15, "size p=%d k=%d" % (p, k))
            t_row.eq(p ** k, raw, "naive raw p=%d k=%d" % (p, k))
            t_row.near(p ** (k - 8), norm, 1e-12, 1e-15, "naive norm p=%d k=%d" % (p, k))
        g = {2: 4, 3: 3, 5: 2}[p]
        for gr in pr["grid"]:
            nn = p ** min(gr["n"], g)
            mvals = [exact_monna(i, p) for i in range(nn)]
            t_grid.eq(nn * nn, gr["count"], "count p=%d n=%d" % (p, gr["n"]))
            t_grid.near(float(max(mvals)), gr["max_x"], 1e-12, 1e-14, "max x p=%d n=%d" % (p, gr["n"]))
            t_grid.near(float(max(mvals)), gr["max_y"], 1e-12, 1e-14, "max y p=%d n=%d" % (p, gr["n"]))
            t_grid.near(float(mvals[-1]), gr["last"][0], 1e-12, 1e-14, "last p=%d n=%d" % (p, gr["n"]))
            t_grid.eq(True, nn * nn <= 729 and max(mvals) < p * Fraction(105, 100), "draw cap and plot scale p=%d n=%d" % (p, gr["n"]))
    return [t.row() for t in (t_dig, t_val, t_gold, t_row, t_grid)]


# ------------------------------------------------------------------ hardware-visualizer, error-confinement, bt-qec: level counts
def depth_of_id(node_id, p):
    """Depth of a node from its breadth-first id: ids are handed out level by level, so the depth is where the running total passes the id."""
    depth, total, width = 0, 1, 1
    while node_id >= total:
        width *= p
        total += width
        depth += 1
    return depth


def check_hardware(out):
    demo, method = "qwav-demo-hardware-visualizer", "level counts of a 3-ary tree of depth 3"
    t = Tally(demo, method, "atoms, gate edges, atoms per level, parent one level up, unique ids")
    parent, dep = build(3, 3)
    t.eq(len(parent), out["atoms"], "atoms")
    t.eq(len(parent) - 1, out["gates"], "gates")
    t.eq({str(k): sum(1 for d in dep if d == k) for k in range(4)}, out["by_depth"], "by depth")
    t.eq(True, out["every_atom_has_parent_one_level_up"] and out["ids_unique"], "structure")
    return [t.row()]


def check_bttree(demo, out, readouts):
    method = "breadth-first id numbering and level counts"
    t_n, t_lv, t_err, t_red = (Tally(demo, method, q) for q in (
        "node count per tree (p in 2,3,5; d in 1..6)", "nodes per depth", "nodes affected by an error at a node (subtree size), 12 probe nodes per tree",
        "redundancy readouts: total, leaf level, staircase"))
    for cfg in out["trees"]:
        p, d = cfg["p"], cfg["d"]
        total = (p ** (d + 1) - 1) // (p - 1)
        t_n.eq(total, cfg["nodes"], "nodes p=%d d=%d" % (p, d))
        t_lv.eq([p ** k for k in range(d + 1)], cfg["by_depth"], "levels p=%d d=%d" % (p, d))
        for node_id, depth, size in cfg["error_sizes"]:
            t_err.eq(depth_of_id(node_id, p), depth, "depth of id %d p=%d d=%d" % (node_id, p, d))
            t_err.eq((p ** (d - depth + 1) - 1) // (p - 1), size, "subtree size id %d p=%d d=%d" % (node_id, p, d))
        if "subtree_size_root" in cfg:
            t_err.eq(total, cfg["subtree_size_root"], "root subtree p=%d d=%d" % (p, d))
        if "total_redundancy" in cfg:
            t_red.eq(sum(p ** k for k in range(1, d + 1)), cfg["total_redundancy"], "total redundancy p=%d d=%d" % (p, d))
            t_red.eq(p ** d, cfg["leaf_redundancy"], "leaf redundancy p=%d d=%d" % (p, d))
            t_red.eq([p ** k for k in range(d + 1)], cfg["staircase"], "staircase p=%d d=%d" % (p, d))
    rows = [t_n.row(), t_lv.row(), t_err.row()]
    if t_red.n:
        rows.append(t_red.row())
    if "verify_p2_d3" in out:
        t_v = Tally(demo, method, "page golden-value gate at p=2, d=3: 15 nodes, 8 leaves, all subtree sizes")
        t_v.eq([15, 8, "all"], [r["computed"] for r in out["verify_p2_d3"]], "computed")
        t_v.eq(True, all(r["pass"] for r in out["verify_p2_d3"]), "pass")
        rows.append(t_v.row())
    if readouts is not None:
        t_r = Tally(demo, method, "error readouts the page prints: affected, safe, confinement percent")
        for case in readouts:
            p, d = case["p"], case["d"]
            total = (p ** (d + 1) - 1) // (p - 1)
            affected = (p ** (d - case["depth_of_error"] + 1) - 1) // (p - 1)
            safe = total - affected
            s = case["shown"]
            t_r.eq((str(total), str(case["depth_of_error"]), str(affected), str(safe), "%d%%" % js_round(safe / total * 100)),
                   (s["nodes"], s["err_depth"], s["affected"], s["safe"], s["confinement"]), "readout p=%d d=%d" % (p, d))
        rows.append(t_r.row())
    return rows


PAGE_CHECKS = [
    ("tree-distance", lambda g: check_tree_distance(g["page_outputs"]["tree-distance"])),
    ("ultrametric-convergence", lambda g: check_ultrametric(g["page_outputs"]["ultrametric-convergence"])),
    ("qpna-classifier", lambda g: check_qpna(g["page_outputs"]["qpna-classifier"])),
    ("monna-map-perspective", lambda g: check_monna(g["page_outputs"]["monna-map-perspective"])),
    ("hardware-visualizer", lambda g: check_hardware(g["page_outputs"]["hardware-visualizer"])),
    ("error-confinement", lambda g: check_bttree("qwav-demo-error-confinement", g["page_outputs"]["error-confinement"], g["page_outputs"]["error-confinement"].get("readouts"))),
    ("bt-qec", lambda g: check_bttree("qwav-demo-bt-qec", g["page_outputs"]["bt-qec"], None)),
]


def load_golden(path=GOLDEN_PATH):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def page_rows(golden):
    rows = []
    for demo_id, fn in PAGE_CHECKS:
        if demo_id not in golden.get("page_outputs", {}):
            rows.append({"demo": "qwav-demo-" + demo_id, "method": "page replay", "quantity": "page outputs recorded in docs/qwav-page-golden.json",
                         "counted": "missing", "closed_form": "page code", "agree": False})
            continue
        rows.extend(fn(golden))
    return rows


def run():
    rows = []
    for demo, p, d in CASES:
        rows.extend(check_case(demo, p, d))
    rows.extend(page_rows(load_golden()))
    return rows


def table(rows):
    out = ["| demo | method | quantity | independent | demo (formula or page code) | agree |", "|---|---|---|---|---|---|"]
    for r in rows:
        where = " (p=%d, d=%d)" % (r["p"], r["depth"]) if "p" in r else ""
        out.append("| %s | %s | %s%s | %s | %s | %s |" % (r["demo"], r["method"], r["quantity"], where, r["counted"], r["closed_form"], "yes" if r["agree"] else "NO"))
    return "\n".join(out)


# ------------------------------------------------------------------ certificates (RM-BS-QUANTUM-COMMONS-1, docs/BLUE-SKY-ROADMAP-2026-11.md B6)
# A certificate says what an independent implementation reproduced, and nothing about quantum hardware: the scout found the published demos compute tree
# arithmetic, so each certificate carries `certifies` (the printed numbers it covers) and the standing `does_not_certify` line. The file is generated, never
# hand-edited, and qwav_golden_crosscheck.test.mjs fails when it differs from what this script produces, so a changed page or formula cannot leave a stale one.
CERT_PATH = os.path.join(HERE, "..", "docs", "qwav-certificates.json")
CERT_DOES_NOT_CERTIFY = ("No quantum state, amplitude, energy, dynamics, hardware result or quantum-advantage claim: none of these demos computes one. "
                         "The independent implementation is not a quantum simulator; it is a different method for the same printed numbers.")
CERT_CERTIFIES = {
    "qwav-demo-error-confinement": "node, leaf, level and subtree counts and the confinement percent the page prints for p = 2, 3, 5 at depths 1 to 6",
    "qwav-demo-ultrametric-convergence": "the seeded leaf values, the variance after coarse-graining at each level and the Verify button's readout",
    "qwav-demo-qpna-classifier": "single, complete and average linkage merge heights, the cophenetic matrix, the CPCC and the clusters at half height",
    "qwav-demo-tree-distance": "depth of the lowest common ancestor, p^-depth, leaf Euclidean distance, the triadic rigidity and the Verify button's readout",
    "qwav-demo-hardware-visualizer": "the 40 atoms, 39 gate edges and the atoms per level 1/3/9/27",
    "qwav-demo-bt-qec": "node count, redundancy per level, total redundancy and the nodes an error affects",
    "qwav-demo-monna-map-perspective": "the Monna map of integers (negatives included), the seven golden identities and the rendered and naive sizes",
}


def certificates(rows=None, golden=None):
    rows = run() if rows is None else rows
    golden = load_golden() if golden is None else golden
    by_demo = {}
    for r in rows:
        by_demo.setdefault(r["demo"], []).append(r)
    pages = golden.get("pages", {})
    certs = []
    for d in PUBLISHED_DEMOS:
        repo = d["repo"]
        mine = by_demo.get(repo, [])
        page = pages.get(repo.replace("qwav-demo-", "", 1), {})
        item = {"demo": repo, "artifact": d["artifact"], "covered": bool(d["covered"] and mine),
                "quantum_values": d["quantum_values"]}
        if item["covered"]:
            item.update({
                "status": "verified" if all(r["agree"] for r in mine) else "disagreement",
                "checks": len(mine),
                "checks_agreeing": sum(1 for r in mine if r["agree"]),
                "independent_methods": sorted({r["method"] for r in mine}),
                "certifies": CERT_CERTIFIES.get(repo, ""),
                "page_url": page.get("url", ""),
                "page_sha256": page.get("sha256", ""),
                "page_bytes": page.get("bytes", 0),
            })
        else:
            item.update({"status": "not-checked", "checks": 0, "checks_agreeing": 0, "independent_methods": [], "certifies": "",
                         "page_url": "", "page_sha256": "", "page_bytes": 0, "note": d.get("note", "")})
        certs.append(item)
    checked = [c for c in certs if c["status"] != "not-checked"]
    verified = sum(1 for c in certs if c["status"] == "verified")
    return {
        "schema": "qwav-certificates/1",
        "about": "RM-BS-QUANTUM-COMMONS-1: what an independent implementation reproduced for each published QWAV demo. Generated by scripts/qwav_golden_crosscheck.py --write-certificates; see docs/QWAV-CROSS-SIMULATOR.md.",
        "recorded": golden.get("recorded", ""),
        "does_not_certify": CERT_DOES_NOT_CERTIFY,
        "demos_total": len(certs),
        "demos_verified": verified,
        "verified_share": round(verified / len(certs), 4) if certs else 0,
        "all_checked_agree": bool(checked) and all(c["status"] == "verified" for c in checked),
        "certificates": certs,
    }


def certificates_json(**kw):
    return json.dumps(certificates(**kw), indent=2, ensure_ascii=False) + "\n"


def selftest():
    fails = []
    rows = run()
    if not rows or not all(r["agree"] for r in rows):
        fails.append("some case disagrees: %r" % [r for r in rows if not r["agree"]][:3])
    expected = {
        ("qwav-demo-bt-qec", "total nodes"): 15,
        ("qwav-demo-bt-qec", "nodes by depth"): [1, 2, 4, 8],
        ("qwav-demo-bt-qec", "leaf count"): 8,
        ("qwav-demo-bt-qec", "total non-root redundancy"): 14,
        ("qwav-demo-hardware-visualizer", "total nodes"): 40,
        ("qwav-demo-hardware-visualizer", "nodes by depth"): [1, 3, 9, 27],
        ("qwav-demo-hardware-visualizer", "parent-child gate edges"): 39,
    }
    for key, value in expected.items():
        row = next((r for r in rows if (r["demo"], r["quantity"]) == key), None)
        if row is None or row["counted"] != value or not row["agree"]:
            fails.append("%s %s expected %r, got %r" % (key[0], key[1], value, row))
    parent, dep = build(2, 3)
    if len(parent) != 15 or sum(1 for d in dep if d == 3) != 8:
        fails.append("p=2 d=3 must have 15 nodes and 8 leaves")
    # the check bites: a broken tree (one leaf missing) must disagree with the closed form
    if len(parent[:-1]) == (2 ** 4 - 1) // (2 - 1):
        fails.append("a tree missing a node must not match the formula")
    # every published demo with a covered flag has a formula row and a page row in the table
    demos_in_table = {r["demo"] for r in rows}
    for d in PUBLISHED_DEMOS:
        if d["covered"] and d["repo"] not in demos_in_table:
            fails.append("covered demo %s has no row" % d["repo"])
        if d["covered"] and not any(r["demo"] == d["repo"] and r["method"] != "explicit tree expansion vs closed form" for r in rows):
            fails.append("covered demo %s has no page-layer row" % d["repo"])
    # the recorded inputs are the inputs of this script (the replay reads them, so they cannot drift)
    golden = load_golden()
    if golden.get("inputs") != json.loads(json.dumps(inputs())):
        fails.append("docs/qwav-page-golden.json inputs differ from inputs(); regenerate with --inputs and rerun scripts/qwav_page_replay.mjs")
    # the independent implementations bite: a corrupted page value must be reported as a disagreement
    bad = json.loads(json.dumps(golden))
    bad["page_outputs"]["ultrametric-convergence"]["runs"][0]["series"][1] += 1e-6
    bad["page_outputs"]["tree-distance"]["configs"][0]["rows"][0][4] += 1
    bad["page_outputs"]["monna-map-perspective"]["primes"][0]["values"][0][1] += 1e-3
    bad["page_outputs"]["qpna-classifier"]["sets"][0]["results"]["average"]["cpcc"] += 1e-6
    bad["page_outputs"]["error-confinement"]["trees"][0]["error_sizes"][0][2] += 1
    for demo_id, fn in PAGE_CHECKS:
        if demo_id in ("hardware-visualizer", "bt-qec"):
            continue
        if all(r["agree"] for r in fn(bad)):
            fails.append("a corrupted %s page value was not detected" % demo_id)
    # mulberry32 is the page's generator: known first values for seed 42 (recorded from the page's own code)
    g = mulberry32(42)
    first = [g() for _ in range(2)]
    if first != golden["page_outputs"]["ultrametric-convergence"]["prng_42"][:2]:
        fails.append("mulberry32 differs from the page: %r" % first)
    # exact p-adic digits: -1 is all (p-1), -p^2 starts with two zeros
    if exact_digits(-1, 3) != [2] * PADIC_K or exact_digits(-9, 3)[:3] != [0, 0, 2]:
        fails.append("exact p-adic digits are wrong")
    # Lance-Williams and Kruskal agree with each other on a fixed set (an independent check of the independent check)
    pts = golden["inputs"]["qpna-classifier"]["sets"][2]["points"]
    lw = lance_williams(pts, "single")
    kr = kruskal_single(pts)
    if any(abs(a - b) > 1e-12 for a, b in zip(lw[0], kr[0])):
        fails.append("single linkage by Lance-Williams and by Kruskal disagree")
    cov = coverage()
    if cov["all"] or "qwav-demos" not in cov["not_covered"]:
        fails.append("coverage must list qwav-demos as not covered until its subdirectories are read")
    # certificates: one entry per published repository, a not-covered repository is never shown verified, no certificate claims a quantum quantity
    c = certificates(rows=[{"demo": "qwav-demo-bt-qec", "method": "m", "quantity": "q", "counted": 1, "closed_form": 1, "agree": True},
                           {"demo": "qwav-demo-tree-distance", "method": "m", "quantity": "q", "counted": 1, "closed_form": 2, "agree": False}],
                     golden={"recorded": "2026-01-01", "pages": {"bt-qec": {"url": "u", "sha256": "s", "bytes": 1}}})
    st = {x["demo"]: x["status"] for x in c["certificates"]}
    if len(c["certificates"]) != len(PUBLISHED_DEMOS):
        fails.append("certificates must list every published repository")
    if st.get("qwav-demo-bt-qec") != "verified" or st.get("qwav-demo-tree-distance") != "disagreement" or st.get("qwav-demos") != "not-checked":
        fails.append("certificate status must be verified / disagreement / not-checked from the rows: %r" % st)
    if c["all_checked_agree"] or c["demos_verified"] != 1:
        fails.append("one disagreeing demo must clear all_checked_agree")
    if "quantum" not in c["does_not_certify"].lower():
        fails.append("the standing does_not_certify line is required")
    print("qwav_golden_crosscheck selftest %s" % ("ok" if not fails else "FAILED: " + "; ".join(fails)))
    return 0 if not fails else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    if "--inputs" in sys.argv:
        print(json.dumps(inputs()))
        sys.exit(0)
    if "--coverage" in sys.argv:
        cov = coverage()
        print(coverage_verdict(cov["all"]))
        print("Covered: " + ", ".join(cov["covered"]))
        print("Not covered: " + (", ".join(cov["not_covered"]) or "none"))
        sys.exit(0)
    if "--certificates" in sys.argv:
        sys.stdout.write(certificates_json())
        sys.exit(0)
    if "--write-certificates" in sys.argv:
        with open(CERT_PATH, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(certificates_json())
        print("wrote " + os.path.normpath(CERT_PATH))
        sys.exit(0)
    res = run()
    print(json.dumps(res) if "--json" in sys.argv else table(res))
    sys.exit(0 if all(r["agree"] for r in res) else 1)
