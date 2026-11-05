#!/usr/bin/env node
// scripts/mint_provenance_key.mjs (BP26-PROVENANCE-MARKING-1, roadmap row 1391; owner card bp26-provenance-signing-key)
//
// Mints the Ed25519 key qnfo-gateway signs provenance sidecars with (worker secret PROVENANCE_SIGNING_KEY, a private JWK as JSON) and writes it to STANDARD OUTPUT ONLY, so it
// can be piped straight into `wrangler secret put` and never lands on a screen, in a file, in shell history or in the repository:
//
//     node scripts/mint_provenance_key.mjs | npx wrangler secret put PROVENANCE_SIGNING_KEY --name qnfo-gateway
//
// (take the secret-lock lease for qnfo-gateway first: POST https://qnfo-deploy-guard.q08.workers.dev/secret-lock/acquire, CLAUDE.md "Shared secrets").
// The gateway derives the public key and its kid from the private JWK and serves both at https://papers.qnfo.org/.well-known/provenance-key.json; that URL answering
// 200 instead of 503 is the proof the secret landed. Nothing here prints the key to stderr; `--selftest` mints a throwaway key and checks a sign/verify round trip
// without printing it.
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

export async function mint() {
  const pair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
  return { jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, d: jwk.d }, pair };
}

export async function roundTrip() {
  const { jwk, pair } = await mint();
  const data = new TextEncoder().encode("qnfo-provenance-sidecar/1 selftest");
  const sig = await webcrypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, data);
  const verified = await webcrypto.subtle.verify({ name: "Ed25519" }, pair.publicKey, sig, data);
  return { verified, shape: jwk.kty === "OKP" && jwk.crv === "Ed25519" && typeof jwk.x === "string" && typeof jwk.d === "string" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--selftest")) {
    const r = await roundTrip();
    console.log(r.verified && r.shape ? "mint_provenance_key selftest ok" : "mint_provenance_key selftest FAILED");
    process.exit(r.verified && r.shape ? 0 : 1);
  }
  const { jwk } = await mint();
  process.stdout.write(JSON.stringify(jwk));
}
