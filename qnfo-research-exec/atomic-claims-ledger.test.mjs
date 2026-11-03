// RM-CLAIMS-LEDGER-1: sentence-level claims are recorded separately from reference checks and only after publication.
// Run: node qnfo-research-exec/atomic-claims-ledger.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { extractAtomicClaims, writeAtomicClaimsLedger } from "./worker.js";

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE paper_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, version TEXT, claim_text TEXT NOT NULL,
  claim_kind TEXT, source_ref TEXT, verification_state TEXT NOT NULL DEFAULT 'unverified',
  verified_by TEXT, published_at TEXT NOT NULL DEFAULT (datetime('now')), verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec("CREATE UNIQUE INDEX idx_paper_claims_source_unique ON paper_claims (slug, claim_kind, source_ref)");
const env = { QNFO_AUDIT: { prepare(sql) {
  let args = [];
  const stmt = {
    bind(...values) { args = values; return stmt; },
    async run() { return db.prepare(sql).run(...args); }
  };
  return stmt;
} } };

const body = [
  "# Example paper",
  "",
  "## Introduction",
  "A cited result establishes a bounded relation between these quantities [1].",
  "This paper derives a second relation from its stated assumptions.",
  "",
  "```text",
  "This code-like example is not a paper claim.",
  "```",
  "",
  "## References",
  "[1] Example source. arXiv:1706.03762",
  "",
  "## Provenance and AI Involvement",
  "This pipeline statement is excluded from the paper claims."
].join("\n");
const refs = [{ kind: "arxiv", id: "1706.03762", status: "ok" }];

const claims = extractAtomicClaims(body, refs, "1.2.3");
assert.equal(claims.length, 2, "one record per reader-facing prose sentence");
assert.equal(claims[0].claim_text, "A cited result establishes a bounded relation between these quantities [1].");
assert.equal(claims[0].verification_state, "unverified", "reference existence does not verify its factual support");
assert.match(claims[0].source_ref, /1706\.03762/);
assert.equal(claims[1].verification_state, "unsupported", "a claim without a cited source is unsupported");
assert.match(claims[1].source_ref, /unsupported/);
assert.ok(claims.every((claim) => claim.claim_kind === "atomic"));

assert.deepEqual(await writeAtomicClaimsLedger(env, "example-paper", "1.2.3", body, refs), { written: 2 });
assert.deepEqual(await writeAtomicClaimsLedger(env, "example-paper", "1.2.3", body, refs), { written: 2 });
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM paper_claims").get().n, 2, "retries upsert instead of duplicating claims");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM paper_claims WHERE claim_kind='reference'").get().n, 0);
assert.deepEqual(await writeAtomicClaimsLedger(env, "", "1.2.3", body, refs), { written: 0 });

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const publish = source.slice(source.indexOf("async function publishStageV2("), source.indexOf("__name(publishStageV2"));
assert.ok(publish.indexOf("UPDATE research_queue SET status='published'") < publish.indexOf("writeAtomicClaimsLedger("),
  "atomic claims are persisted only after the queue row is marked published");
const citationGate = source.slice(source.indexOf("async function citationGateStep("), source.indexOf("async function persistCitations("));
assert.ok(!citationGate.includes("writeAtomicClaimsLedger("), "a held or failed publication is not included in atomic claim coverage");

db.close();
console.log("atomic-claims-ledger tests passed");
