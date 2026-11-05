// RM-SEEDED-CLAIM-HARNESS-2 (roadmap row 1703): offline suite for scripts/seeded_claim_harness.mjs and scripts/seeded-claims.json. No network (the citation gate runs on a stub index), no model.
// Proves: the real worker's gates load, every clean control passes through every gate, the seeds that the gates are built to catch are caught, a flagged control or a missing gate makes the
// run unusable (the metric stays unknown, never 0), a gate that throws scores a miss, and the stub index answers like the real ones. It does not pin which seeds are currently missed:
// a gate gap is data for seeded_claim_runs, and fixing the gate must not break this suite.
// Run: node --no-warnings scripts/seeded_claim_harness.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runHarness, stubFetch, loadScan } from "./seeded_claim_harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = join(here, "..", "qnfo-research-exec", "worker.js");
const workerSrc = readFileSync(workerPath, "utf8");
const seedDoc = JSON.parse(readFileSync(join(here, "seeded-claims.json"), "utf8"));
const mod = await import(pathToFileURL(workerPath).href);
let pass = 0;
const t = async (name, fn) => { try { await fn(); pass++; } catch (e) { console.log("FAIL " + name + " :: " + (e && e.stack || e)); process.exitCode = 1; } };

await t("the seed file is well formed: unique ids, known gates, a control for every non-scan gate", () => {
  assert.equal(seedDoc.version, 2);
  const ids = seedDoc.seeds.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  const gates = new Set(seedDoc.seeds.map((s) => s.gate));
  assert.deepEqual(Array.from(gates).sort(), ["citation-gate", "fabricated-scan", "verify-adjudication"]);
  for (const g of ["citation-gate", "verify-adjudication"]) assert.ok(seedDoc.controls.some((c) => c.gate === g), "control for " + g);
  assert.ok(seedDoc.seeds.filter((s) => s.gate === "fabricated-scan").length >= 6, "the original six scan seeds stay");
});
await t("the real gates run, every control is clean, and the seeds they are built to catch are caught", async () => {
  const out = await runHarness(workerSrc, seedDoc, mod);
  assert.equal(out.ok, true, JSON.stringify(out).slice(0, 300));
  assert.equal(out.control_flagged, false);
  assert.deepEqual(out.controls.map((c) => c.flagged), [false, false, false]);
  assert.equal(out.runs.length, seedDoc.seeds.length);
  const caught = (id) => out.runs.find((r) => r.seed_id === id).caught;
  for (const id of ["S01-survey", "S02-assign", "S03-raters", "S04-peer", "S05-pilot", "S06-n"]) assert.equal(caught(id), 1, id);
  for (const id of ["S11-fabricated-arxiv", "S13-dead-doi", "S14-dead-link", "S15-wrong-number", "S16-script-says-yes", "S17-wrong-digit"]) assert.equal(caught(id), 1, id);
  assert.ok(out.runs.every((r) => (r.caught === 0 || r.caught === 1) && typeof r.detail === "string" && r.detail.length > 0 && r.gate));
});
await t("the scan can also be read from the worker text when no module is given", async () => {
  assert.equal(typeof loadScan(workerSrc), "function");
  const out = await runHarness(workerSrc, { seeds: [seedDoc.seeds[0]] });
  assert.equal(out.ok, true);
  assert.deepEqual(out.runs.map((r) => [r.seed_id, r.caught]), [["S01-survey", 1]]);
});
await t("a flagged control makes the run unusable", async () => {
  const badMod = Object.assign({}, mod, { CITATION_GATE: { citationGate: async () => ({ failures: [{ kind: "arxiv", id: "x", status: "not-found" }], unverified: [] }) } });
  const out = await runHarness(workerSrc, seedDoc, badMod);
  assert.equal(out.ok, false);
  assert.equal(out.control_flagged, true);
  assert.match(out.reason, /clean control was flagged by citation-gate/);
  assert.deepEqual(out.runs, []);
});
await t("a gate that is not exported, or an unknown gate, makes the run unusable", async () => {
  const noAdj = Object.assign({}, mod, { adjudicateVerification: undefined });
  assert.match((await runHarness(workerSrc, seedDoc, noAdj)).reason, /adjudicateVerification is not exported/);
  assert.match((await runHarness(workerSrc, seedDoc, {})).reason, /CITATION_GATE is not exported/);
  const unknown = await runHarness(workerSrc, { seeds: [{ id: "X", gate: "mystery" }], controls: [] }, mod);
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /unknown gate mystery/);
  assert.equal((await runHarness("no scan block here", { seeds: [] })).ok, false);
});
await t("a gate that throws on a seed scores a miss with the reason", async () => {
  const throwing = Object.assign({}, mod, { adjudicateVerification: (out) => { if (/computed=6 expected=7/.test(out)) throw new Error("boom"); return mod.adjudicateVerification(out, []); } });
  const out = await runHarness(workerSrc, { seeds: [seedDoc.seeds.find((s) => s.id === "S15-wrong-number")], controls: seedDoc.controls }, throwing);
  assert.equal(out.ok, true);
  assert.equal(out.runs[0].caught, 0);
  assert.match(out.runs[0].detail, /the gate threw: boom/);
});
await t("the stub index answers like the real arXiv, handle and page lookups", async () => {
  const f = stubFetch({ arxiv: { "1706.03762": "Attention Is All You Need" }, doi: ["10.1000/real"], pages: { "https://example.org/ok": 200 } });
  const feed = await (await f("https://export.arxiv.org/api/query?max_results=2&id_list=1706.03762,2999.99999")).text();
  assert.match(feed, /<id>http:\/\/arxiv\.org\/abs\/1706\.03762v1<\/id><title>Attention Is All You Need<\/title>/);
  assert.doesNotMatch(feed, /2999\.99999/);
  assert.equal((await f("https://doi.org/api/handles/10.1000/real")).status, 200);
  assert.equal((await f("https://doi.org/api/handles/10.9999/nope")).status, 404);
  assert.equal((await f("https://api.crossref.org/works/10.1000/real")).status, 404);
  assert.equal((await f("https://example.org/ok")).status, 200);
  assert.equal((await f("https://example.org/missing")).status, 404);
  assert.equal((await stubFetch(undefined)("https://example.org/x")).status, 404);
});

console.log("seeded_claim_harness: " + pass + " passed" + (process.exitCode ? ", FAILED" : ", 0 failed"));
