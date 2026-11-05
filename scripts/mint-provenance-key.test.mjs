// scripts/mint-provenance-key.test.mjs (BP26-PROVENANCE-MARKING-1): the key minter produces a key the gateway can use, and prints nothing but the key to stdout.
import { spawnSync } from "node:child_process";
import { roundTrip } from "./mint_provenance_key.mjs";
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (x !== undefined ? "  -> " + String(x).slice(0, 200) : "")); } };

const rt = await roundTrip();
ok("a minted Ed25519 key signs and verifies", rt.verified);
ok("the private JWK has exactly the fields the gateway reads (kty, crv, x, d)", rt.shape);

const run = spawnSync(process.execPath, ["scripts/mint_provenance_key.mjs"], { encoding: "utf8" });
let jwk = null; try { jwk = JSON.parse(run.stdout); } catch (e) { /* asserted below */ }
ok("stdout is one JSON object and stderr is empty", run.status === 0 && jwk && run.stderr === "", run.stderr);
ok("it is a private Ed25519 JWK", jwk && jwk.kty === "OKP" && jwk.crv === "Ed25519" && jwk.d && jwk.x && Object.keys(jwk).sort().join() === "crv,d,kty,x");
const run2 = spawnSync(process.execPath, ["scripts/mint_provenance_key.mjs"], { encoding: "utf8" });
ok("every run mints a different key", run2.stdout !== run.stdout);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
