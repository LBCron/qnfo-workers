#!/usr/bin/env node
// scripts/qwav_page_replay.mjs: RM-QWAV-CROSS-SIMULATOR-1 (agent_issues 1000642, charter pillar research).
//
// WHAT   Runs the pure functions of a published QWAV demo page (QNFO/qwav-demo-*, one inline <script> per index.html) in a Node vm context behind
//        a stub DOM, on the inputs recorded in docs/qwav-page-golden.json, and writes what the PAGE'S OWN CODE returned into the same file
//        (page_outputs). scripts/qwav_golden_crosscheck.py then recomputes every one of those numbers with an independent Python implementation
//        and compares them offline (no network, no browser). That closes, for the pages replayed here, the gap the cross-check document used to
//        state: a demo that displays a wrong number while its own verifyMath passes is caught when the independent value disagrees with the
//        recorded page value.
// USAGE  node scripts/qwav_page_replay.mjs --golden docs/qwav-page-golden.json --page tree-distance=<index.html> [--page ...] [--write]
//        Without --write the outputs are printed only. The page files are fetched by the person refreshing the golden file (the pages are static
//        GitHub Pages sites); the sha256 of each page is stored so a changed page is visible in the diff of the golden file.
// LIMITS The stub DOM draws nothing, so rendering code is not exercised; randomness the pages take from Math.random (the Q-PNA classifier's point
//        clouds and its neural baseline) is replaced by the fixed inputs of the golden file or not replayed.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";

export function extractScript(html) {
  const found = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (found.length !== 1) throw new Error("expected exactly one inline <script>, found " + found.length);
  return found[0][1];
}

// A DOM that accepts everything: any property is a callable stub, a set is remembered (so textContent written by the page can be read back).
function makeStub(store) {
  store = store || {};
  return new Proxy(function () {}, {
    get(_t, k) {
      if (Object.prototype.hasOwnProperty.call(store, k)) return store[k];
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === "then") return undefined;
      if (k === "length") return 0;
      if (k === "getBoundingClientRect") return () => ({ width: 800, height: 500, left: 0, top: 0, right: 800, bottom: 500 });
      if (k === "getContext") return () => makeStub();
      if (k === "style" || k === "dataset") return {};
      return makeStub();
    },
    set(_t, k, v) { store[k] = v; return true; },
    apply() { return makeStub(); },
  });
}

export function makeContext() {
  const elements = new Map();
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, makeStub({})); return elements.get(id); },
    querySelector() { return makeStub(); },
    querySelectorAll() { return []; },
    createElement() { return makeStub(); },
    addEventListener() {},
    body: makeStub(),
  };
  const window = makeStub({ devicePixelRatio: 1 });
  const sandbox = {
    window, document, navigator: makeStub(), console: { log() {}, table() {}, warn() {}, error() {}, info() {} },
    localStorage: { getItem: () => "1", setItem() {} }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, performance: { now: () => 0 }, alert() {},
  };
  sandbox.globalThis = sandbox;
  return { context: vm.createContext(sandbox), elements, sandbox };
}

export function loadPage(html) {
  const env = makeContext();
  vm.runInContext(extractScript(html), env.context, { filename: "page.js", timeout: 60000 });
  return env;
}

const text = (env, id) => String(env.elements.get(id) ? env.elements.get(id).textContent : "");

// ---- per-demo replays: they call the page's own functions and return plain JSON
const REPLAYS = {
  "tree-distance"(env, input) {
    env.sandbox.INPUT = input;
    return vm.runInContext(`(function () {
      const out = { configs: [] };
      for (const cfg of INPUT.configs) {
        const tree = buildTree(cfg.p, cfg.d);
        S.p = cfg.p; S.d = cfg.d; S.tree = tree;
        const leaves = tree.filter(n => n.leaf);
        const rows = cfg.pairs.map(([i, j]) => [i, j, leaves[i].slot, leaves[j].slot, copheneticDist(leaves[i], leaves[j]), ultrametricDist(leaves[i], leaves[j]), euclideanDist(leaves[i], leaves[j])]);
        const n = leaves.length, a = leaves[0], b = leaves[Math.floor(n / 2)], c = leaves[n - 1];
        out.configs.push({ p: cfg.p, d: cfg.d, nodes: tree.length, leaves: n, rows, verify_triple: [ultrametricDist(a, b), ultrametricDist(b, c), ultrametricDist(a, c)] });
      }
      S.p = 3; S.d = 4; rebuild(); randomPair();
      const v = verifyMath();
      out.verify_default = { total: v.total, passed: v.passed, failed: v.failed };
      return out;
    })()`, env.context, { timeout: 60000 });
  },
  "ultrametric-convergence"(env, input) {
    env.sandbox.INPUT = input;
    return vm.runInContext(`(function () {
      const out = { runs: [] };
      for (const cfg of INPUT.configs) {
        S.p = cfg.p; S.d = cfg.d; S.tree = buildTree(cfg.p, cfg.d);
        rng = mulberry32(cfg.seed); reseed();
        const series = [];
        for (let k = 0; k <= cfg.d; k++) { S.k = k; series.push(variance(leafDisplayValues())); }
        S.k = 0;
        const leaves = S.tree.filter(n => n.leaf).map(n => S.nodeValues[n.index]);
        out.runs.push({ p: cfg.p, d: cfg.d, seed: cfg.seed, nodes: S.tree.length, leaves: leaves.length, series, first_leaves: leaves.slice(0, 4), last_leaf: leaves[leaves.length - 1], root_value: S.nodeValues[0] });
      }
      const g = mulberry32(42);
      out.prng_42 = [g(), g(), g(), g(), g(), g()];
      const v = verifyMath();
      out.verify_default = { total: v.total, passed: v.passed, failed: v.failed };
      return out;
    })()`, env.context, { timeout: 120000 });
  },
  "qpna-classifier"(env, input) {
    env.sandbox.INPUT = input;
    const out = vm.runInContext(`(function () {
      const out = { sets: [] };
      for (const set of INPUT.sets) {
        const pts = set.points.map((q, i) => ({ x: q[0], y: q[1], label: 0, id: i }));
        const n = pts.length, res = {};
        for (const lk of ["single", "complete", "average"]) {
          const r = agglomerate(pts, lk);
          const upper = [];
          for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) upper.push(r.cophen[i][j]);
          res[lk] = { heights: r.merges.map(m => m.h), sizes: r.merges.map(m => m.size), cophenetic_upper: upper, cpcc: cpcc(pts, r.cophen) };
        }
        out.sets.push({ name: set.name, n, results: res });
      }
      return out;
    })()`, env.context, { timeout: 120000 });
    // the displayed readouts (text the page writes for the last linkage run) are read back per linkage in a second pass
    for (const set of out.sets) {
      const input_set = input.sets.find((s) => s.name === set.name);
      env.sandbox.ONE = input_set;
      for (const lk of ["single", "complete", "average"]) {
        env.sandbox.LK = lk;
        vm.runInContext(`(function () {
          const pts = ONE.points.map((q, i) => ({ x: q[0], y: q[1], label: 0, id: i }));
          const r = agglomerate(pts, LK);
          S.points = pts; S.merges = r.merges; S.cophenetic = r.cophen; S.lk = LK; S.n = pts.length;
          try { updateReadouts(); } catch (e) {}
        })()`, env.context, { timeout: 60000 });
        set.results[lk].shown = { one_minus_cpcc: text(env, "cophVal"), cpcc: text(env, "cpccVal"), clusters_at_half_height: text(env, "clustVal") };
      }
    }
    return out;
  },
  "monna-map-perspective"(env, input) {
    env.sandbox.INPUT = input;
    return vm.runInContext(`(function () {
      const out = { primes: [] };
      for (const p of INPUT.primes) {
        const values = INPUT.xs.map(x => { const m = monnaRational(x, p); return [x, m.value, pAdicDigits(x, p, 24)]; });
        const k_rows = [];
        for (let k = 0; k <= 8; k++) { const r = renderedSize(k, p), nv = naiveSize(k, p, 8); k_rows.push([k, r.r, r.size, nv.raw, nv.norm]); }
        const verify = [];
        for (const n of INPUT.depths) verify.push({ n, tests: verifyMath(p, n).map(t => ({ name: t.name, exp: t.exp, got: t.got, pass: t.pass })) });
        const grid = [];
        for (const n of INPUT.depths) { const pts = gridPoints(n, p); let mx = 0, my = 0; for (const q of pts) { if (q.x > mx) mx = q.x; if (q.y > my) my = q.y; } grid.push({ n, count: pts.length, max_x: mx, max_y: my, first: [pts[0].x, pts[0].y], last: [pts[pts.length - 1].x, pts[pts.length - 1].y] }); }
        out.primes.push({ p, values, k_rows, verify, grid });
      }
      return out;
    })()`, env.context, { timeout: 60000 });
  },
  "hardware-visualizer"(env) {
    return vm.runInContext(`(function () {
      buildAtoms();
      const depth = {};
      S.atoms.forEach(a => { depth[a.depth] = (depth[a.depth] || 0) + 1; });
      const parents = S.atoms.filter(a => a.parent !== -1).every(a => S.atoms.some(b => b.id === a.parent && b.depth === a.depth - 1));
      return { atoms: S.atoms.length, gates: S.gates.length, by_depth: depth, every_atom_has_parent_one_level_up: parents, ids_unique: new Set(S.atoms.map(a => a.id)).size === S.atoms.length };
    })()`, env.context, { timeout: 60000 });
  },
  "error-confinement"(env, input) { return bttreeReplay(env, input, true); },
  "bt-qec"(env, input) { return bttreeReplay(env, input, false); },
};

// The two QEC pages share the BTTree class; the error-confinement page also shows the affected/safe/confinement readouts of an injected error.
function bttreeReplay(env, input, withReadouts) {
  env.sandbox.INPUT = input;
  env.sandbox.WITH_READOUTS = withReadouts;
  const out = vm.runInContext(`(function () {
    const out = { trees: [] };
    for (const cfg of INPUT.configs) {
      const t = new BTTree(cfg.p, cfg.d);
      const sizes = INPUT.probe_depth_fractions.flatMap(f => {
        const level = t.nodesByDepth[Math.min(cfg.d, Math.floor(f * (cfg.d + 1)))];
        return [level[0], level[Math.floor(level.length / 2)], level[level.length - 1]].map(nd => [nd.id, nd.depth, t.getErrorSubtree(nd.id).size]);
      });
      const row = { p: cfg.p, d: cfg.d, nodes: t.nodeCount, by_depth: Object.keys(t.nodesByDepth).map(k => t.nodesByDepth[k].length), error_sizes: sizes };
      if (typeof t.subtreeSize === "function") row.subtree_size_root = t.subtreeSize(0);
      if (typeof t.getTotalRedundancy === "function") { row.total_redundancy = t.getTotalRedundancy(); row.leaf_redundancy = t.getRedundancy(cfg.d); row.staircase = t.getStaircase(cfg.d).map(s => s.r); }
      out.trees.push(row);
    }
    if (typeof verifyMath === "function") {
      const v = verifyMath(new BTTree(2, 3));
      out.verify_p2_d3 = v.results.map(r => ({ name: r.name, computed: r.computed, expected: r.expected, pass: r.pass }));
    }
    return out;
  })()`, env.context, { timeout: 120000 });
  if (withReadouts) {
    out.readouts = [];
    for (const cfg of input.readout_cases) {
      env.sandbox.CASE = cfg;
      vm.runInContext(`(function () {
        tree = new BTTree(CASE.p, CASE.d); rdr.tree = tree;
        const probe = tree.nodesByDepth[CASE.depth_of_error][CASE.index];
        rdr.errId = probe.id; rdr.errSet = tree.getErrorSubtree(probe.id);
        try { updateStats(); } catch (e) {}
      })()`, env.context, { timeout: 60000 });
      out.readouts.push({ ...cfg, shown: { nodes: text(env, "statNodes"), err_depth: text(env, "statErrDepth"), affected: text(env, "statAffected"), safe: text(env, "statSafe"), confinement: text(env, "statConfinement") } });
    }
  }
  return out;
}

export function replay(id, html, input) {
  if (!REPLAYS[id]) throw new Error("no replay for " + id);
  return REPLAYS[id](loadPage(html), input || {});
}
export const REPLAY_IDS = Object.keys(REPLAYS);

function main(argv) {
  const opts = { pages: [], golden: "docs/qwav-page-golden.json", write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--golden") opts.golden = argv[++i];
    else if (argv[i] === "--page") opts.pages.push(argv[++i]);
    else if (argv[i] === "--write") opts.write = true;
    else throw new Error("unknown argument " + argv[i]);
  }
  const golden = JSON.parse(readFileSync(opts.golden, "utf8"));
  golden.pages = golden.pages || {};
  golden.page_outputs = golden.page_outputs || {};
  for (const spec of opts.pages) {
    const [id, file] = spec.split("=");
    const html = readFileSync(file, "utf8");
    const out = replay(id, html, (golden.inputs || {})[id]);
    golden.page_outputs[id] = out;
    golden.pages[id] = Object.assign({}, golden.pages[id], { sha256: createHash("sha256").update(html).digest("hex"), bytes: Buffer.byteLength(html) });
    console.log("replayed " + id + " (" + Buffer.byteLength(html) + " bytes of page)");
  }
  if (opts.write) {
    const keys = Object.keys(golden);
    const lines = keys.map((k) => "  " + JSON.stringify(k) + ": " + (k === "page_outputs" || k === "inputs"
      ? "{\n" + Object.keys(golden[k]).map((id) => "    " + JSON.stringify(id) + ": " + JSON.stringify(golden[k][id])).join(",\n") + "\n  }"
      : JSON.stringify(golden[k])));
    writeFileSync(opts.golden, "{\n" + lines.join(",\n") + "\n}\n");
    console.log("wrote " + opts.golden);
  }
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
