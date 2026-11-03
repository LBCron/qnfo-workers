// UTF8-DEPLOY-1: worker source fetched from GitHub (base64 of UTF-8 bytes) must reach the upload as the same text.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const block = src.slice(src.indexOf("// ---- UTF8-DEPLOY-1:BEGIN"), src.indexOf("// ---- UTF8-DEPLOY-1:END"));
const ctx = { atob, TextDecoder, Uint8Array, String };
vm.createContext(ctx);
vm.runInContext(block + "\n__f = b64Utf8;", ctx);
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const sample = 'var VERSION = "1.0.0"; const re = /[x×]/; const t = "Home · Papers ↑ “q” … éè \u{1F600}";\n';
const b64 = Buffer.from(sample, "utf8").toString("base64").replace(/(.{60})/g, "$1\n");
ok(ctx.__f(b64) === sample, "base64 of UTF-8 (wrapped like the GitHub API) decodes to the original text");
ok(Buffer.from(ctx.__f(b64), "utf8").equals(Buffer.from(sample, "utf8")), "re-encoding for the upload gives the original bytes (no double encoding)");
ok(ctx.__f(Buffer.from("plain ascii", "utf8").toString("base64")) === "plain ascii", "ASCII is unchanged");
// every GitHub-content decode in the deploy path goes through the helper
const oauthStart = src.indexOf("// SINGLE-MODULE-INLINE-1: oauth-broker.mjs");
const oauthEnd = src.indexOf("// end inline qnfo-ops/oauth-broker.mjs", oauthStart);
const deploySrc = oauthStart >= 0 && oauthEnd >= 0 ? src.slice(0, oauthStart) + src.slice(src.indexOf("\n", oauthEnd) + 1) : src;
const raw = (deploySrc.replace(/^\s*\/\/.*$/gm, "").match(/atob\(/g) || []).length;
ok(oauthStart >= 0 && oauthEnd >= 0 && raw === 1, "the deploy path uses atob only inside b64Utf8 (found " + raw + ")");
console.log(fails + " failure(s)");
process.exit(fails ? 1 : 0);
