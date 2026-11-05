// SECRETS-STORE-BIND-1 (qnfo-ops 2.65.0, agent_issues 1001969 and 1001981, roadmap RM-SECRETS-STORE-1), offline suite. No network.
// Proves, by running the worker's own installDeclaredBindings and cfWorkerDeploy against a recorded fetch (GitHub contents API for
// wrangler.toml, Cloudflare GET /bindings, GET /settings, GET /secrets_store/..., PUT script) and a stub of ops_config:
//   - a [[secrets_store_secrets]] block is parsed, but the binding goes live only when ops_config secrets_store_bind_allow names its
//     secret (or worker:secret), the store lists the entry with the workers scope, and the store read succeeded;
//   - an empty or unreadable allowlist, an unreadable store, a missing entry or a wrong scope bind nothing, never throw, and leave
//     every other declared binding exactly as before (no Cloudflare store call at all when nothing is allowlisted);
//   - a deploy Cloudflare refuses is sent once more without the store bindings that deploy added, and a live store binding is kept.
// ADVERSARIAL: does not prove Cloudflare accepts a secrets_store_secret binding from this token. The live proof is cf-ops-actions
// secrets-inventory showing the name in store_bindings_live after the first allowlisted canonical deploy.
// Run: node --no-warnings qnfo-ops/secrets-store-bind.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x) : "")); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const vm = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(src);
ok(vm && (Number(vm[1]) > 2 || (Number(vm[1]) === 2 && Number(vm[2]) >= 65)), "VERSION is at least 2.65.0", vm && vm[0]);

const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); ok(i > 0 && j > i, "anchor found: " + a); return i > 0 && j > i ? src.slice(i, j) : ""; };
function harness(h) {
  const body = [
    'var CF_ACCOUNT_ID = "acct"; var VERSION = "9.9.9-test";',
    "function iso() { return '2026-11-05T10:00:00.000Z'; }",
    "var FLEET = [];",
    "async function probeService() { return {}; }",
    "async function cfWorkerRead() { return { ok: true, version: '1.0.0' }; }",
    "async function recordDeployLedger(env, row) { h.ledger.push(row); return { ok: true }; }",
    "function __name() {} function __name2() {} function __name22() {}",
    cut("function b64Utf8(", "// ---- UTF8-DEPLOY-1:END"),
    cut("var CF_RETRY_MAX = ", "\nasync function cfWorkerDeploy("),
    cut("var COMPAT_FLIPS = [", "\nvar OBS_KEYS = "),
    cut("var OBS_KEYS = ", "\n__name(installDeclaredBindings"),
    cut("async function cfWorkerDeploy(env, args) {", "\n__name(cfWorkerDeploy"),
    "return { cfWorkerDeploy, installDeclaredBindings, secretsStoreBinding, parseSecretsStoreAllow, selectSecretsStoreBindings };"
  ].join("\n");
  return new Function("h", "fetch", "setTimeout", body)(h, h.fetch, (fn) => { fn(); return 0; });
}
const STORE = "8ef28060302e4311b064ba3529493e8b";
// h.toml: wrangler.toml of worker "w"; h.allow: the ops_config value (string, null = no row, "THROW" = unreadable); h.store: array of
// store entries, a number = the HTTP status of the store read; h.live: live bindings; h.refuse(meta): true -> a definite 400 on that PUT.
function cf(h) {
  h.raw = []; h.puts = []; h.ledger = []; h.storeCalls = []; h.allowReads = 0;
  h.env = {
    CF_API_TOKEN: "t",
    QNFO_AUDIT: {
      prepare(sql) {
        return { async first() { h.allowReads++; if (!/secrets_store_bind_allow/.test(sql)) throw new Error("unexpected sql " + sql); if (h.allow === "THROW") throw new Error("d1 overloaded"); return h.allow == null ? null : { value: h.allow }; } };
      }
    }
  };
  h.fetch = async (url, init) => {
    const u = String(url);
    const J = (o, s) => ({ ok: (s || 200) < 300, status: s || 200, json: async () => o, text: async () => JSON.stringify(o), clone() { return this; }, headers: { get() { return null; } } });
    if (u.startsWith("https://api.github.com/")) return /\/contents\/w\/wrangler\.toml\?ref=main$/.test(u) ? J({ content: Buffer.from(h.toml, "utf8").toString("base64") }) : J({ message: "Not Found" }, 404);
    if (u.includes("/secrets_store/stores/")) {
      h.storeCalls.push(u);
      if (typeof h.store === "number") return J({ success: false, errors: [{ code: 10000, message: "denied" }] }, h.store);
      return J({ success: true, result: h.store || [], result_info: { page: 1, total_pages: 1 } });
    }
    if (u.endsWith("/bindings")) return J({ result: JSON.parse(JSON.stringify(h.live || [])) });
    if (u.endsWith("/settings")) return J({ result: { compatibility_date: "2026-08-01", compatibility_flags: [] } });
    if (init && init.method === "PUT") {
      const m = /name="metadata"\r\nContent-Type: application\/json\r\n\r\n([\s\S]*?)\r\n--/.exec(String(init.body));
      const meta = JSON.parse(m[1]);
      h.raw.push(m[1]);
      h.puts.push(meta);
      if (h.refuse && h.refuse(meta)) return J({ success: false, errors: [{ code: 10000, message: "refused by test" }] }, 400);
      return J({ success: true, result: { id: "w", etag: "e" } });
    }
    throw new Error("unexpected fetch " + u);
  };
  return h;
}
const D1 = '[[d1_databases]]\nbinding = "DB"\ndatabase_name = "db"\ndatabase_id = "d1-id"\n';
const STORE_BLOCK = '\n[[secrets_store_secrets]]\nbinding = "CF_TOKEN_STORE"\nstore_id = "' + STORE + '"\nsecret_name = "CF_API_TOKEN"\n';
const BASE = 'name = "w"\nmain = "worker.js"\ncompatibility_date = "2026-08-01"\n\n' + D1 + STORE_BLOCK;
const ENTRY = { name: "CF_API_TOKEN", scopes: ["workers"], status: "active" };
const WANT = { type: "secrets_store_secret", name: "CF_TOKEN_STORE", store_id: STORE, secret_name: "CF_API_TOKEN" };
const D1B = { type: "d1", name: "DB", id: "d1-id" };
const install = async (h) => { cf(h); return harness(h).installDeclaredBindings(h.env, "w"); };
const SRC = 'var VERSION = "1.0.1"; export default { fetch() { return new Response("ok"); } };';
const deploy = async (h) => { cf(h); return harness(h).cfWorkerDeploy(h.env, { worker: "w", content: SRC, version: "1.0.1" }); };

// ---- pure
{
  const P = harness(cf({ toml: "" }));
  ok(eq(P.secretsStoreBinding("B", { store_id: STORE, secret_name: "CF_API_TOKEN" }), { type: "secrets_store_secret", name: "B", store_id: STORE, secret_name: "CF_API_TOKEN" }), "a complete block gives { type, name, store_id, secret_name }");
  for (const bad of [[null, { store_id: STORE, secret_name: "X" }], ["B", { secret_name: "X" }], ["B", { store_id: STORE }], ["B", { store_id: "short", secret_name: "X" }], ["B", { store_id: STORE, secret_name: "has space" }], ["B", { store_id: STORE, secret_name: "" }], ["B", null]]) {
    ok(P.secretsStoreBinding(bad[0], bad[1]) === null, "an incomplete or malformed block is ignored", bad);
  }
  ok(eq(P.parseSecretsStoreAllow("CF_API_TOKEN, qnfo-infra:INFRA_TOKEN;  CF_API_TOKEN\nBAD!NAME"), ["CF_API_TOKEN", "qnfo-infra:INFRA_TOKEN"]), "allowlist: comma, semicolon and whitespace separated, de-duplicated, malformed names dropped");
  ok(eq(P.parseSecretsStoreAllow(null), []) && eq(P.parseSecretsStoreAllow(""), []) && eq(P.parseSecretsStoreAllow("  ,; "), []), "allowlist: empty and null -> []");
  ok(eq(P.parseSecretsStoreAllow(":X"), []) && eq(P.parseSecretsStoreAllow("w:"), []), "allowlist: a half-written worker:secret is dropped");
  const decl = [WANT];
  const sel = (allow, entries) => P.selectSecretsStoreBindings("w", decl, allow, entries);
  ok(sel([], { [STORE]: [ENTRY] }).bound.length === 0 && /not in secrets_store_bind_allow/.test(sel([], { [STORE]: [ENTRY] }).skipped[0].reason), "not allowlisted -> absent");
  ok(eq(sel(["CF_API_TOKEN"], { [STORE]: [ENTRY] }).bound, [WANT]), "allowlisted by secret name and present with the workers scope -> bound");
  ok(eq(sel(["w:CF_API_TOKEN"], { [STORE]: [ENTRY] }).bound, [WANT]), "allowlisted for this worker -> bound");
  ok(sel(["other:CF_API_TOKEN"], { [STORE]: [ENTRY] }).bound.length === 0, "allowlisted for another worker -> absent");
  ok(sel(["CF_API_TOKEN"], { [STORE]: null }).bound.length === 0 && /store unreadable/.test(sel(["CF_API_TOKEN"], { [STORE]: null }).skipped[0].reason), "store read failed -> absent");
  ok(sel(["CF_API_TOKEN"], {}).bound.length === 0 && sel(["CF_API_TOKEN"], undefined).bound.length === 0, "no store data -> absent");
  ok(/not in the store/.test(sel(["CF_API_TOKEN"], { [STORE]: [{ name: "OTHER", scopes: ["workers"] }] }).skipped[0].reason), "entry missing from the store -> absent");
  ok(/workers scope/.test(sel(["CF_API_TOKEN"], { [STORE]: [{ name: "CF_API_TOKEN", scopes: ["ai_gateway"] }] }).skipped[0].reason) && sel(["CF_API_TOKEN"], { [STORE]: [{ name: "CF_API_TOKEN" }] }).bound.length === 0, "entry without the workers scope -> absent");
}

// ---- installer
{
  let h = { toml: BASE, allow: null, store: [ENTRY] };
  let ins = await install(h);
  ok(eq(ins.bindings, [D1B]) && h.storeCalls.length === 0, "no allowlist row: only the d1 binding, and the store is never called", ins.bindings);
  ok(/secrets_store_secrets: 1 declared, 0 bound, skipped CF_TOKEN_STORE:not in secrets_store_bind_allow/.test(ins.note || ""), "the note says what was skipped", ins.note);

  h = { toml: BASE, allow: "", store: [ENTRY] };
  ins = await install(h);
  ok(eq(ins.bindings, [D1B]) && h.storeCalls.length === 0, "empty allowlist: nothing bound, no store call");

  h = { toml: BASE, allow: "CF_API_TOKEN", store: [ENTRY] };
  ins = await install(h);
  ok(eq(ins.bindings, [D1B, WANT]) && ins.installed === 2, "allowlisted and listed with the workers scope: the store binding comes after the others", ins.bindings);
  ok(h.storeCalls.length === 1 && h.storeCalls[0].includes("/stores/" + STORE + "/secrets"), "exactly one store read, of the declared store", h.storeCalls);
  ok(ins.note === "secrets_store_secrets: 1 declared, 1 bound", "the note counts the bound binding", ins.note);

  h = { toml: BASE, allow: "w:CF_API_TOKEN", store: [ENTRY] };
  ok(eq((await install(h)).bindings, [D1B, WANT]), "worker:secret form binds this worker");
  h = { toml: BASE, allow: "qnfo-infra:CF_API_TOKEN", store: [ENTRY] };
  ins = await install(h);
  ok(eq(ins.bindings, [D1B]) && h.storeCalls.length === 0, "worker:secret for another worker binds nothing and reads nothing");

  h = { toml: BASE, allow: "CF_API_TOKEN", store: 403 };
  ins = await install(h);
  ok(eq(ins.bindings, [D1B]) && /store unreadable/.test(ins.note), "store read 403: skipped with a note, the d1 binding survives", ins);

  h = { toml: BASE, allow: "CF_API_TOKEN", store: [] };
  ok(eq((await install(h)).bindings, [D1B]), "secret absent from the store: not bound");
  h = { toml: BASE, allow: "CF_API_TOKEN", store: [{ name: "CF_API_TOKEN", scopes: [] }] };
  ok(eq((await install(h)).bindings, [D1B]), "store entry without the workers scope: not bound");

  h = { toml: BASE, allow: "THROW", store: [ENTRY] };
  ins = await install(h);
  ok(eq(ins.bindings, [D1B]) && /allowlist unreadable/.test(ins.note) && h.storeCalls.length === 0, "allowlist unreadable: none bound, nothing thrown, no store call", ins);

  h = { toml: 'name = "w"\n' + STORE_BLOCK.replace('store_id = "' + STORE + '"\n', ""), allow: "CF_API_TOKEN", store: [ENTRY] };
  ins = await install(h);
  ok(ins.bindings.length === 0 && h.allowReads === 0, "a block without store_id is ignored before anything is read", ins);

  const two = BASE + '\n[[secrets_store_secrets]]\nbinding = "INFRA_TOKEN_STORE"\nstore_id = "' + STORE + '"\nsecret_name = "INFRA_TOKEN"\n';
  h = { toml: two, allow: "INFRA_TOKEN", store: [ENTRY, { name: "INFRA_TOKEN", scopes: ["workers"] }] };
  ins = await install(h);
  ok(eq(ins.bindings, [D1B, { type: "secrets_store_secret", name: "INFRA_TOKEN_STORE", store_id: STORE, secret_name: "INFRA_TOKEN" }]) && h.storeCalls.length === 1, "two declared, one allowlisted: only that one, one store read", ins.bindings);

  h = { toml: 'name = "w"\n' + D1, allow: "CF_API_TOKEN", store: [ENTRY] };
  ins = await install(h);
  ok(eq(ins.bindings, [D1B]) && h.allowReads === 0 && ins.note === null, "no store block: no allowlist read, the note is what it was", ins);
}

// ---- cfWorkerDeploy
{
  let h = { toml: BASE, allow: null, store: [ENTRY], live: [] };
  let r = await deploy(h);
  ok(r.ok && h.puts.length === 1 && eq(h.puts[0].bindings, [D1B]), "default: the upload carries no store binding", h.puts[0] && h.puts[0].bindings);
  ok(/secrets_store_secrets: 1 declared, 0 bound/.test(h.ledger[0].notes) && /not in secrets_store_bind_allow/.test(h.ledger[0].notes), "default: the ledger row records the skip", h.ledger[0].notes);

  h = { toml: BASE, allow: "CF_API_TOKEN", store: [ENTRY], live: [] };
  r = await deploy(h);
  ok(r.ok && h.puts.length === 1 && eq(h.puts[0].bindings, [D1B, WANT]) && r.bindings_installed === 2, "allowlisted: the upload carries the store binding", h.puts[0] && h.puts[0].bindings);
  ok(/secrets_store_secrets: 1 declared, 1 bound/.test(h.ledger[0].notes), "allowlisted: the ledger row records it", h.ledger[0].notes);

  h = { toml: BASE, allow: "CF_API_TOKEN", store: [ENTRY], live: [], refuse: (m) => m.bindings.some((b) => b.type === "secrets_store_secret") };
  r = await deploy(h);
  ok(r.ok && h.puts.length === 2 && eq(h.puts[1].bindings, [D1B]) && r.bindings_installed === 1 && /secrets_store_secrets refused, deployed without CF_TOKEN_STORE/.test(r.binding_install_note), "a refused store binding: the deploy goes out once more without it", { puts: h.puts.length, note: r.binding_install_note });

  const LIVE = [D1B, { type: "secrets_store_secret", name: "CF_TOKEN_STORE", store_id: STORE, secret_name: "CF_API_TOKEN" }, { type: "secret_text", name: "CF_TOKEN" }];
  h = { toml: BASE, allow: null, store: [ENTRY], live: LIVE };
  r = await deploy(h);
  ok(r.ok && eq(h.puts[0].bindings, [D1B, LIVE[1]]), "a live store binding is kept with an empty allowlist (live wins, secret_text is still left out)", h.puts[0] && h.puts[0].bindings);
  h = { toml: BASE, allow: "CF_API_TOKEN", store: [ENTRY], live: LIVE, refuse: (m) => m.bindings.some((b) => b.type === "secrets_store_secret") };
  r = await deploy(h);
  ok(!r.ok && h.puts.length === 1, "a refusal caused by a LIVE store binding is not retried away (nothing live is removed)", { ok: r.ok, puts: h.puts.length });
}

// ---- wiring
ok(src.indexOf('else if (s.name === "secrets_store_secrets")') > src.indexOf('else if (s.name === "artifacts")'), "the section case follows the other binding types");
ok(src.indexOf("if (!resp.ok) {\n      // SECRETS-STORE-BIND-1") > src.indexOf("if (!resp.ok && _placementOut) {") && src.indexOf("if (!resp.ok) {\n      // SECRETS-STORE-BIND-1") < src.indexOf("if (!resp.ok && _sendEmailBefore.length) {"), "the store fallback sits between the placement and send_email fallbacks");
{
  const c0 = src.indexOf("/* SECRETS-STORE-BIND-1"), c1 = src.indexOf("var SECRETS_STORE_ID_RE");
  ok(c0 > 0 && c1 > c0 && src.slice(c0, c1).trimEnd().endsWith("*/") && src.slice(c0 + 2, c1).trimEnd().slice(0, -2).indexOf("*/") === -1, "the explanatory block comment closes once, at its end (a stray close would end it early)");
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
