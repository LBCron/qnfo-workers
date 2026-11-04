import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const wrangler = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");

assert.equal(source, mirror, "deployed-current.worker.js mirrors worker.js");

const start = source.indexOf("async function infraSecret(");
const end = source.indexOf("\n__name(infraSecret", start);
assert.ok(start >= 0 && end > start, "infraSecret helper is present");
const infraSecret = new Function(`${source.slice(start, end)}\nreturn infraSecret;`)();

let storeReads = 0;
assert.equal(
  await infraSecret({
    CF_TOKEN_STORE: { async get() { storeReads++; return "store-test"; } },
    CF_TOKEN: "legacy-test"
  }, "CF_TOKEN_STORE", "CF_TOKEN"),
  "store-test",
  "Secrets Store is preferred over the legacy secret"
);
assert.equal(storeReads, 1, "the store binding is read once");
assert.equal(
  await infraSecret({ CF_TOKEN: "legacy-test" }, "CF_TOKEN_STORE", "CF_TOKEN"),
  "legacy-test",
  "the legacy secret remains available when the store binding is absent"
);
await assert.rejects(
  infraSecret({
    CF_TOKEN_STORE: { async get() { throw new Error("store unavailable"); } },
    CF_TOKEN: "legacy-test"
  }, "CF_TOKEN_STORE", "CF_TOKEN"),
  /store unavailable/,
  "a configured but failing store binding is not silently bypassed"
);

assert.match(wrangler, /\[\[secrets_store_secrets\]\]\s+binding = "CF_TOKEN_STORE"\s+store_id = "8ef28060302e4311b064ba3529493e8b"\s+secret_name = "CF_API_TOKEN"/);
// Every Cloudflare token read goes through the Secrets Store helper: at least the four original readers, plus any later one (REACH-AE-1 reachAeSql was the fifth), and no bare env.CF_TOKEN read.
assert.ok((source.match(/infraSecret\(env, "CF_TOKEN_STORE", "CF_TOKEN"\)/g) || []).length >= 4);
assert.equal((source.match(/env\.CF_TOKEN\b/g) || []).length, 0, "no code reads env.CF_TOKEN directly");
assert.match(source, /bindings: \["INFRA_TOKEN", "CF_ACCOUNT", "CF_TOKEN", "CF_TOKEN_STORE"\]/);

console.log("QNFO.INFRA Secrets Store migration checks passed");
