// ATOMIC-CLAIMS-LEDGER-1 (RM-CLAIMS-LEDGER-1, roadmap row 1702) offline suite, beside atomic-claims-ledger.test.mjs (the API pin from PR 6619). node:sqlite stands in for D1.
// Proves: the sentence extractor keeps reader-facing prose only (no headings, code, display maths, tables, References, Provenance, Acknowledgements) and does not split
// at abbreviations or decimals; citations map to the reference list (ranges and lists included); a sentence sharing a three-digit numeric literal with a recomputed claim is
// verified, with a failed recomputation refuted, with neither unverified (cited) or unsupported (uncited); a short number never links a sentence to a claim; the verify stage
// keeps claims beyond its cap as unverified; stageVerify saves the hand-over only when it routes to publish; the write is chunked, upserting and never throws;
// publishStageV2 writes it after the paper is marked published, with the gate's references and the hand-over.
// Run: node --no-warnings qnfo-research-exec/atomic-claims-verify.test.mjs
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stageVerify, extractAtomicClaims, writeAtomicClaimsLedger, verifyClaimsLedger, saveVerifyLedger, readVerifyLedger } from "./worker.js";

let pass = 0;
const t = async (name, fn) => { try { await fn(); pass++; } catch (e) { console.log("FAIL " + name + " :: " + (e && e.stack || e)); process.exitCode = 1; } };
globalThis.setTimeout = (fn) => { fn(); return 0; };

const BODY = [
  "# A Paper",
  "",
  "## Abstract",
  "We report a derivation of the thermal energy at 310 K. The result is 4.2800e-21 J, which agrees with Smith et al. [1] and with the review in [2, 3]. See Fig. 3 for details.",
  "",
  "## Results",
  "- The prefactor is 1.537e-6 for the rotational channel [1-2].",
  "| a | b |",
  "| 1 | 2 |",
  "Table 2 lists the parameters used throughout the analysis.",
  "",
  "$$",
  "E = k_B T",
  "$$",
  "",
  "The ratio of 3.5 to 1 is stated without a source.",
  "```python",
  "print('not a claim at all, just code')",
  "```",
  "",
  "## References",
  "[1] First work. arXiv:2401.00001",
  "[2] Second work. doi:10.1000/xyz123",
  "[3] QNFO paper. https://papers.qnfo.org/papers/some-paper",
  "",
  "## Acknowledgements",
  "We thank the reviewers for their careful reading of the manuscript.",
  "",
  "## Provenance and AI Involvement",
  "This pipeline statement is excluded from the paper claims.",
].join("\n");

await t("only reader-facing prose becomes a claim, and sentences are not split at abbreviations or decimals", () => {
  const c = extractAtomicClaims(BODY, [], "1.0.0");
  const texts = c.map((x) => x.claim_text);
  assert.deepEqual(texts, [
    "We report a derivation of the thermal energy at 310 K.",
    "The result is 4.2800e-21 J, which agrees with Smith et al. [1] and with the review in [2, 3].",
    "See Fig. 3 for details.",
    "The prefactor is 1.537e-6 for the rotational channel [1-2].",
    "The ratio of 3.5 to 1 is stated without a source.",
  ]);
  assert.ok(c.every((x) => x.claim_kind === "atomic" && x.version === "1.0.0"));
});
await t("citations map to the reference list, ranges and lists included, and an uncited sentence is unsupported", () => {
  const c = extractAtomicClaims(BODY, [], "1.0.0");
  assert.equal(c[0].verification_state, "unsupported");
  assert.match(c[0].source_ref, /^unsupported#[0-9a-f]{8}$/);
  assert.match(c[1].source_ref, /^arxiv:2401\.00001\+doi:10\.1000\/xyz123\+ref:3#/);
  assert.equal(c[1].verification_state, "unverified");
  assert.match(c[3].source_ref, /^arxiv:2401\.00001\+doi:10\.1000\/xyz123#/);
  assert.equal(new Set(c.map((x) => x.source_ref)).size, c.length, "every source_ref is distinct");
});
await t("a repeated sentence gets a distinct key; the cap bounds a long paper", () => {
  const rep = extractAtomicClaims("The same observation is made twice in this paper.\n\nThe same observation is made twice in this paper.", [], null);
  assert.equal(rep.length, 2);
  assert.notEqual(rep[0].source_ref, rep[1].source_ref);
  assert.equal(rep[0].version, null);
  const long = Array.from({ length: 450 }, (_, i) => "This is distinct sentence number " + (i + 1) + " of a long paper.").join(" ");
  assert.equal(extractAtomicClaims(long, [], null).length, 400);
  assert.deepEqual(extractAtomicClaims("", [], null), []);
  assert.deepEqual(extractAtomicClaims(undefined, undefined, undefined), []);
});
await t("the verify hand-over turns a matching sentence into verified and a failed one into refuted", () => {
  const ledger = [
    { id: "Q1", statement: "Thermal energy k_B*T = 4.2800e-21 J", state: "verified", by: "verify-script" },
    { id: "Q2", statement: "Prefactor tau = 1.537e-6 s", state: "refuted", by: "verify-text" },
    { id: "Q3", statement: "Some value 9.99 m", state: "unverified", by: "verify-script" },
  ];
  const c = extractAtomicClaims(BODY, [], "1", ledger);
  const byText = (s) => c.find((x) => x.claim_text.indexOf(s) === 0);
  assert.equal(byText("The result is 4.2800e-21 J").verification_state, "verified");
  assert.equal(byText("The result is 4.2800e-21 J").verified_by, "verify-script+literal");
  assert.equal(byText("The prefactor").verification_state, "refuted");
  assert.equal(byText("The prefactor").verified_by, "verify-text+literal");
  assert.equal(byText("The ratio of 3.5").verification_state, "unsupported", "a three-digit number is needed to link a sentence to a claim: 3.5 is two digits");
  assert.equal(byText("We report").verification_state, "unsupported", "310 shares no claim literal");
});
await t("a short number never links a sentence to a claim", () => {
  const c = extractAtomicClaims("The value is 12 in these units.", [], null, [{ id: "Q1", statement: "the value 12 units", state: "verified", by: "verify-script" }]);
  assert.equal(c[0].verification_state, "unsupported");
});
await t("a reference the citation gate refuted makes its sentence refuted", () => {
  const c = extractAtomicClaims("A result is cited here [1].\n\n## References\n[1] Work. arXiv:2401.00001", [{ kind: "arxiv", id: "2401.00001", status: "not-found" }], null);
  assert.equal(c[0].verification_state, "refuted");
  assert.equal(c[0].verified_by, "citation-gate");
});

// ---- the write ------------------------------------------------------------------------------------------------------------------
const DDL = "CREATE TABLE paper_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, version TEXT, claim_text TEXT NOT NULL, claim_kind TEXT, source_ref TEXT, verification_state TEXT NOT NULL DEFAULT 'unverified', verified_by TEXT, published_at TEXT NOT NULL DEFAULT (datetime('now')), verified_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));";
const UNIQUE = readFileSync(new URL("../migrations/2026-11-01-paper-claims-unique.sql", import.meta.url), "utf8");
function mk(o) {
  const opts = Object.assign({ batch: true, fail: false }, o);
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  db.exec(UNIQUE);
  const batches = [];
  const stmt = (sql) => {
    let args = [];
    const s = { bind(...a) { args = a; return s; }, async run() { if (opts.fail) throw new Error("D1_ERROR: no such table: paper_claims"); const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
      async first() { return db.prepare(sql).get(...args) || null; }, async all() { return { results: db.prepare(sql).all(...args) }; } };
    return s;
  };
  const QNFO_AUDIT = { prepare: stmt };
  if (opts.batch) QNFO_AUDIT.batch = async (list) => { batches.push(list.length); db.exec("BEGIN"); try { for (const s of list) await s.run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } };
  return { env: { QNFO_AUDIT }, db, batches };
}
const dbRows = (db, slug) => db.prepare("SELECT claim_kind, source_ref, verification_state, verified_by, verified_at, version FROM paper_claims WHERE slug = ? ORDER BY id").all(slug);

await t("the write is chunked, upserts on a retry, and keeps reference rows apart", async () => {
  const m = mk();
  m.db.prepare("INSERT INTO paper_claims (slug, claim_kind, claim_text, source_ref, verification_state) VALUES ('p1', 'reference', 'a ref', 'arxiv:2401.00001', 'verified')").run();
  const body = Array.from({ length: 95 }, (_, i) => "This is distinct sentence number " + (i + 1) + " of a long paper.").join(" ");
  const ledger = [{ id: "Q1", statement: "distinct number 95 value", state: "verified", by: "verify-script" }];
  const r = await writeAtomicClaimsLedger(m.env, "p1", "2.0.0", body, [], ledger);
  assert.deepEqual(r, { written: 95 });
  assert.deepEqual(m.batches, [40, 40, 15]);
  const rows = dbRows(m.db, "p1");
  assert.equal(rows.length, 96);
  assert.equal(rows.filter((x) => x.claim_kind === "atomic").length, 95);
  assert.equal(rows.filter((x) => x.claim_kind === "reference").length, 1);
  assert.deepEqual(await writeAtomicClaimsLedger(m.env, "p1", "2.0.1", body, [], ledger), { written: 95 });
  const again = dbRows(m.db, "p1");
  assert.equal(again.length, 96, "a retry updates instead of duplicating");
  assert.ok(again.filter((x) => x.claim_kind === "atomic").every((x) => x.version === "2.0.1"));
});
await t("without batch support the statements run one by one", async () => {
  const m = mk({ batch: false });
  assert.deepEqual(await writeAtomicClaimsLedger(m.env, "p2", "1", "A claim is made in this sentence of the paper.", [], []), { written: 1 });
  assert.equal(dbRows(m.db, "p2").length, 1);
});
await t("no slug, no binding, no sentence and a failing database never throw", async () => {
  const m = mk();
  assert.deepEqual(await writeAtomicClaimsLedger(m.env, "", "1", "A claim is made in this sentence of the paper.", [], []), { written: 0 });
  assert.deepEqual(await writeAtomicClaimsLedger({}, "p", "1", "A claim is made in this sentence of the paper.", [], []), { written: 0 });
  assert.deepEqual(await writeAtomicClaimsLedger(m.env, "p", "1", "# Only a heading", [], []), { written: 0 });
  const f = mk({ fail: true });
  const r = await writeAtomicClaimsLedger(f.env, "p3", "1", "A claim is made in this sentence of the paper.", [], []);
  assert.equal(r.written, 0);
  assert.match(r.error, /no such table/);
});

// ---- the verify stage's hand-over ----------------------------------------------------------------------------------------------
await t("verifyClaimsLedger: states follow the recomputation; the cap, duplicates and junk are handled", () => {
  const ex = [{ id: "Q1", statement: "a = 1" }, { id: "Q2", statement: "b = 2" }, { id: "Q3", statement: "c = 3" }, { id: "Q4", statement: "d = 4" }];
  const adj = { basis: "script", rows: [{ id: "Q1", computed: "1", expected: "1", decided: true, match: true }, { id: "Q2", computed: "9", expected: "2", decided: true, match: false }, { id: "Q3", computed: "x", expected: "none", decided: false, match: false }] };
  const l = verifyClaimsLedger(ex, adj, 16);
  assert.deepEqual(l.map((c) => [c.id, c.state]), [["Q1", "verified"], ["Q2", "refuted"], ["Q3", "unverified"], ["Q4", "unverified"]]);
  assert.match(l[2].basis, /could not be decided/);
  assert.match(l[3].basis, /no CLAIM line printed/);
  assert.equal(verifyClaimsLedger(ex, { basis: "text", rows: [] }, 16)[0].by, "verify-text");
  const big = Array.from({ length: 20 }, (_, i) => ({ id: "Q" + (i + 1), statement: "claim " + (i + 1) }));
  const lb = verifyClaimsLedger(big, { basis: "script", rows: big.slice(0, 16).map((c) => ({ id: c.id, computed: "1", expected: "1", decided: true, match: true })) }, 16);
  assert.deepEqual([lb.filter((c) => c.state === "verified").length, lb.filter((c) => c.state === "unverified").length], [16, 4]);
  assert.match(lb[16].basis, /beyond the per-pass claim cap/);
  const dup = verifyClaimsLedger([{ id: "Q1", statement: "x".repeat(900) }, { id: "q1", statement: "y" }, { statement: "no id" }, null], null, 16);
  assert.deepEqual(dup.map((c) => c.id), ["Q1", "q1#2", "Q3", "Q4"]);
  assert.equal(dup[0].statement.length, 300);
  assert.deepEqual(verifyClaimsLedger(undefined, undefined, 16), []);
});
await t("saveVerifyLedger and readVerifyLedger round-trip and tolerate a failing store", async () => {
  const store = new Map();
  const env = { MIRROR: { async put(k, v) { store.set(k, v); }, async get(k) { return store.has(k) ? { text: async () => store.get(k) } : null; } } };
  assert.equal(await saveVerifyLedger(env, { id: "r1" }, [{ id: "Q1", statement: "s" }], { basis: "script", rows: [{ id: "Q1", computed: "1", expected: "1", decided: true, match: true }] }), 1);
  assert.equal((await readVerifyLedger(env, { id: "r1" }))[0].state, "verified");
  assert.deepEqual(await readVerifyLedger(env, { id: "missing" }), []);
  store.set("pipeline/bad/claims-ledger.json", "{not json");
  assert.deepEqual(await readVerifyLedger(env, { id: "bad" }), []);
  const down = { MIRROR: { async put() { throw new Error("R2 down"); }, async get() { throw new Error("R2 down"); } } };
  assert.equal(await saveVerifyLedger(down, { id: "r2" }, [{ id: "Q1", statement: "s" }], null), 1);
  assert.deepEqual(await readVerifyLedger(down, { id: "r2" }), []);
  assert.equal(await saveVerifyLedger({}, { id: "r3" }, [], null), 0);
});

const SENT = "The derivation in this paragraph restates an input value with its source and shows the arithmetic step that follows from it. ";
const sec = (h, n) => "## " + h + "\n\n" + SENT.repeat(n) + "\n\n";
const paperMd = "# A paper about a plant\n\n## Abstract\n\nContext, gap, approach, result and practice are stated here in order.\n\n"
  + sec("1. Introduction", 24) + sec("2. Background and Related Work", 24) + sec("3. Methods", 24) + sec("4. Analysis", 24)
  + sec("5. Results", 24) + sec("6. Discussion", 24) + sec("7. Practical Implications and Engineering Pathways", 24) + sec("8. Conclusion", 8)
  + "## References\n\n" + Array.from({ length: 8 }, (_, i) => "[" + (i + 1) + "] Work " + (i + 1) + ". arXiv:2401.0000" + i).join("\n") + "\n";
function verifyEnv(claims, pilotOut) {
  const store = { "pipeline/v1/reconciled.md": paperMd, "pipeline/v1/grounding.md": "" };
  const D1 = { prepare() { const q = { bind() { return q; }, async run() { return { meta: { changes: 1 } }; }, async first() { return null; }, async all() { return { results: [] }; } }; return q; } };
  const MIRROR = { async get(k) { const v = store[k]; return v == null ? null : { text: async () => v }; }, async put(k, v) { store[k] = v; } };
  const AI = { async run(model, input) {
    const p = input.messages[0].content;
    if (p.includes("=== TASK: VERIFY_EXTRACT ===")) return { response: JSON.stringify(claims) };
    if (p.includes("=== TASK: VERIFY_GEN ===")) return { response: "```python\nprint('CLAIM Q1: computed=1 expected=1 match=yes')\n```" };
    return { response: "" };
  } };
  const CONTAINERS_PILOT = { async fetch() { return new Response(JSON.stringify({ ok: true, result: { exitCode: 0, stdout: pilotOut, stderr: "" } })); } };
  return { env: { AI, QNFO_AUDIT: D1, MIRROR, CONTAINERS_PILOT }, store };
}
const vrow = () => ({ id: "v1", context: JSON.stringify({ cycles: 1, verifyPass: 0 }), recover_count: 0, source: "idea-hub", stage: "verify", status: "researching" });

await t("stageVerify saves the hand-over with the decided state when the pass routes to publish", async () => {
  const v = verifyEnv([{ id: "Q1", statement: "x equals 1", inputs: "x = 1", formula: "x" }], "CLAIM Q1: computed=1 expected=1 match=yes\nVERIFICATION SUMMARY: 1 claims, 1 match, 0 mismatch");
  const res = await stageVerify(v.env, vrow());
  assert.equal(res.stage, "verify->publish", JSON.stringify(res));
  assert.deepEqual(JSON.parse(v.store["pipeline/v1/claims-ledger.json"]).map((c) => [c.id, c.state, c.by]), [["Q1", "verified", "verify-script"]]);
});
await t("stageVerify counts the claims beyond the cap as unverified", async () => {
  const claims = Array.from({ length: 20 }, (_, i) => ({ id: "Q" + (i + 1), statement: "claim " + (i + 1), inputs: "x", formula: "x" }));
  const v = verifyEnv(claims, Array.from({ length: 16 }, (_, i) => "CLAIM Q" + (i + 1) + ": computed=1 expected=1 match=yes").join("\n"));
  const res = await stageVerify(v.env, vrow());
  assert.equal(res.stage, "verify->publish", JSON.stringify(res));
  const ledger = JSON.parse(v.store["pipeline/v1/claims-ledger.json"]);
  assert.deepEqual([ledger.length, ledger.filter((c) => c.state === "verified").length, ledger.filter((c) => c.state === "unverified").length], [20, 16, 4]);
});
await t("stageVerify saves an empty hand-over for a qualitative paper and none when it goes back to revise", async () => {
  const q = verifyEnv([], "");
  assert.equal((await stageVerify(q.env, vrow())).stage, "verify->publish");
  assert.equal(q.store["pipeline/v1/claims-ledger.json"], "[]");
  const bad = verifyEnv([{ id: "Q1", statement: "x equals 1", inputs: "x = 1", formula: "x" }], "CLAIM Q1: computed=7 expected=1 match=no");
  assert.equal((await stageVerify(bad.env, vrow())).stage, "verify->revise");
  assert.equal(bad.store["pipeline/v1/claims-ledger.json"], undefined);
});

await t("publishStageV2 writes the ledger after the paper is marked published, from the gate's references and the hand-over", () => {
  const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const i = src.indexOf("async function publishStageV2(");
  const body = src.slice(i, src.indexOf("__name(publishStageV2", i));
  const published = body.indexOf("UPDATE research_queue SET status='published'");
  const call = body.indexOf("writeAtomicClaimsLedger(env, slug, paper.version, paper.body_md, cg && cg.result && cg.result.refs, await readVerifyLedger(env, row))");
  assert.ok(published > 0 && call > published, "the call follows the published update");
  assert.equal(body.split("writeAtomicClaimsLedger(").length - 1, 1, "one call site");
});

console.log("atomic-claims-verify: " + pass + " passed" + (process.exitCode ? ", FAILED" : ", 0 failed"));
