#!/usr/bin/env node
// RM-SEEDED-CLAIM-HARNESS-1 and -2 (agent_issues 1000665, roadmap rows 1703; charter pillar research): seeds known-false claims (scripts/seeded-claims.json) in front of the
// deterministic gates of qnfo-research-exec and records whether each gate catches its seed:
//   fabricated-scan      fabricatedClaimScan (the first layer of claimAudit) on a clean paper body plus the seed sentence;
//   citation-gate        CITATION_GATE.citationGate with a stubbed index (a fabricated arXiv id, a real id under the wrong title, a dead DOI, a dead link);
//   verify-adjudication  adjudicateVerification on printed CLAIM lines (a wrong number, a script that says match=yes, a wrong digit).
// The gates are read from qnfo-research-exec/worker.js on this checkout, so the result is about the code that is deployed from main. Nothing is published, posted or
// written to a paper; the seeds exist only in memory and the stub index answers every lookup (no network). These are the deterministic layers: the model reviewers are not exercised.
//
// Usage: node scripts/seeded_claim_harness.mjs [--worker <path>] [--seeds <path>]
// Output (stdout, one JSON object): { ok, reason?, control_flagged, controls: [{gate, flagged}], runs: [{ seed_id, gate, kind, caught, detail }] }
// ok is false (and runs is empty) when a gate cannot be loaded or a clean control is flagged: a harness whose control fails measures nothing, and
// scripts/bp26_seeded.py then records no run (the metric stays unknown, never 0).
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const workerPath = arg("--worker", join(here, "..", "qnfo-research-exec", "worker.js"));
const seedsPath = arg("--seeds", join(here, "seeded-claims.json"));

const BODY = "# Bounds on step counts\n\n## Introduction\n\nThis paper derives a bound on the number of steps required.\n\n## Results\n\n";
const CONTROL = "The derivation follows from the lemma above and the bound is tight in the stated regime.";

export function loadScan(workerSrc) {
  const lines = workerSrc.split(/\r?\n/);
  const a = lines.findIndex((l) => l.startsWith("var CI_SKIP_HEAD_RE"));
  const b = lines.findIndex((l) => l.startsWith("function ciExtractPrompt"));
  if (a < 0 || b < 0 || b <= a) throw new Error("fabricatedClaimScan block not found in the worker (CI_SKIP_HEAD_RE .. ciExtractPrompt)");
  return new Function(lines.slice(a, b).join("\n") + "\nreturn fabricatedClaimScan;")();
}

// The stub index of one citation-gate case. arXiv API: an Atom feed with the entries of the known ids. doi.org handle API: 200 for a listed DOI, 404 otherwise.
// Crossref (title lookup): 404, so no title is judged for a DOI. Any other URL: the status the case lists, 404 when it is not listed.
export function stubFetch(index) {
  const idx = index || {};
  const json = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return async function (url) {
    const u = String(url);
    if (u.startsWith("https://export.arxiv.org/api/query")) {
      const ids = decodeURIComponent(u.split("id_list=")[1] || "").split(",").filter(Boolean);
      const entries = ids.filter((id) => idx.arxiv && idx.arxiv[id] !== undefined).map((id) => "<entry><id>http://arxiv.org/abs/" + id + "v1</id><title>" + idx.arxiv[id] + "</title></entry>");
      return new Response("<feed>" + entries.join("") + "</feed>", { status: 200 });
    }
    if (u.startsWith("https://doi.org/api/handles/")) {
      const doi = u.slice("https://doi.org/api/handles/".length).split("/").map(decodeURIComponent).join("/");
      return (idx.doi || []).indexOf(doi) >= 0 ? json(200, { responseCode: 1 }) : json(404, { responseCode: 100 });
    }
    if (u.startsWith("https://api.crossref.org/")) return json(404, {});
    const status = idx.pages && idx.pages[u];
    return new Response("<html></html>", { status: status === undefined ? 404 : status });
  };
}

async function citationCase(mod, c) {
  const res = await mod.CITATION_GATE.citationGate(String(c.body || ""), { fetch: stubFetch(c.index) });
  const first = res.failures[0];
  return { flagged: res.failures.length > 0, clean: res.failures.length === 0 && res.unverified.length === 0, detail: first ? "flagged as " + first.status + " (" + first.kind + " " + String(first.id).slice(0, 60) + ")" : res.unverified.length ? "unverified, not caught: " + String(res.unverified[0].note || "").slice(0, 80) : "the citation gate found no failing reference" };
}

function adjudicationCase(mod, c) {
  const adj = mod.adjudicateVerification(String(c.output || ""), c.claims || []);
  const bad = adj.rows.find((r) => r.decided && !r.match);
  return { flagged: adj.ran && adj.mismatches > 0, clean: adj.ran && adj.mismatches === 0, detail: bad ? "flagged as mismatch (" + bad.id + ": computed " + bad.computed + ", stated " + bad.expected + ")" : adj.ran ? "the adjudication found no mismatch" : "no CLAIM line was decided" };
}

// workerSrc: the text of the worker (the scan block is read from it); mod: the imported worker module (CITATION_GATE, adjudicateVerification).
export async function runHarness(workerSrc, seedDoc, mod) {
  const fail = (reason, extra) => Object.assign({ ok: false, reason: String(reason).slice(0, 200), control_flagged: null, controls: [], runs: [] }, extra || {});
  let scan;
  try { scan = mod && typeof mod.fabricatedClaimScan === "function" ? mod.fabricatedClaimScan : loadScan(workerSrc); } catch (e) { return fail(e && e.message || e); }
  const seeds = seedDoc.seeds || [];
  const needs = new Set(seeds.concat(seedDoc.controls || []).map((s) => s.gate || "fabricated-scan"));
  if (needs.has("citation-gate") && !(mod && mod.CITATION_GATE && typeof mod.CITATION_GATE.citationGate === "function")) return fail("CITATION_GATE is not exported by the worker");
  if (needs.has("verify-adjudication") && !(mod && typeof mod.adjudicateVerification === "function")) return fail("adjudicateVerification is not exported by the worker");
  const controls = [{ gate: "fabricated-scan", flagged: scan(BODY + CONTROL + "\n").length > 0 }];
  for (const c of seedDoc.controls || []) {
    try {
      const r = c.gate === "citation-gate" ? await citationCase(mod, c) : c.gate === "verify-adjudication" ? adjudicationCase(mod, c) : { flagged: false, clean: true };
      controls.push({ gate: c.gate, flagged: !r.clean });
    } catch (e) { controls.push({ gate: c.gate, flagged: true }); }
  }
  const flagged = controls.filter((c) => c.flagged);
  if (flagged.length) return fail("clean control was flagged by " + flagged.map((c) => c.gate).join(", ") + ": the gate is not a usable measurement", { control_flagged: true, controls });
  const runs = [];
  for (const s of seeds) {
    const gate = s.gate || "fabricated-scan";
    let caught = 0, detail;
    try {
      if (gate === "fabricated-scan") {
        const hits = scan(BODY + s.text + "\n");
        caught = hits.length > 0 ? 1 : 0;
        detail = hits.length ? "flagged as " + hits[0].kind : "not flagged by the deterministic scan";
      } else {
        const r = gate === "citation-gate" ? await citationCase(mod, s) : gate === "verify-adjudication" ? adjudicationCase(mod, s) : null;
        if (!r) return fail("seed " + s.id + " names the unknown gate " + gate);
        caught = r.flagged ? 1 : 0;
        detail = r.detail;
      }
    } catch (e) {
      caught = 0;
      detail = "the gate threw: " + String(e && e.message || e).slice(0, 120);
    }
    runs.push({ seed_id: s.id, gate, kind: s.kind || "", caught, detail });
  }
  return { ok: true, control_flagged: false, controls, runs };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let out;
  try {
    const mod = await import(pathToFileURL(workerPath).href);
    out = await runHarness(readFileSync(workerPath, "utf8"), JSON.parse(readFileSync(seedsPath, "utf8")), mod);
  } catch (e) {
    out = { ok: false, reason: "the worker could not be loaded: " + String(e && e.message || e).slice(0, 160), control_flagged: null, controls: [], runs: [] };
  }
  process.stdout.write(JSON.stringify(out) + "\n");
}
