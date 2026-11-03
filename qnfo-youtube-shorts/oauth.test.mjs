import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import worker from "./worker.js";

const env = { YT_RUN_TOKEN: "test-run-token", YT_CLIENT_ID: "test-client", YT_CLIENT_SECRET: "test-client-secret" };
const scopes = ["youtube.upload", "youtube.readonly", "yt-analytics.readonly"].map(s => "https://www.googleapis.com/auth/" + s);
function request(path, body = {}, token = env.YT_RUN_TOKEN, method = "POST") {
  return new Request("https://shorts.example" + path, {
    method, headers: { "x-run-token": token, "content-type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {})
  });
}
async function consent(body = {}) {
  const response = await worker.fetch(request("/oauth/consent", body), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}

test("OAuth routes require the existing run token, POST, and configured client secrets", async () => {
  for (const path of ["/oauth/consent", "/oauth/exchange"]) {
    for (const token of ["", "wrong"]) {
      const response = await worker.fetch(request(path, {}, token), env);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal((await worker.fetch(request(path, {}, env.YT_RUN_TOKEN, "GET"), env)).status, 405);
    assert.equal((await worker.fetch(request(path), { ...env, YT_RUN_TOKEN: "" })).status, 401);
    assert.equal((await worker.fetch(request(path), { ...env, YT_CLIENT_SECRET: "" })).status, 503);
  }
});

test("consent requests all three scopes, offline consent, expiring state, and PKCE", async () => {
  const grant = await consent();
  const url = new URL(grant.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("client_id"), env.YT_CLIENT_ID);
  assert.deepEqual(url.searchParams.get("scope").split(" "), scopes);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:8765/");
  assert.equal(url.searchParams.get("state"), grant.state);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(grant.expires_in, 600);
  assert.notEqual((await consent()).state, grant.state);
  assert.ok(!JSON.stringify(grant).includes(env.YT_CLIENT_SECRET));
  assert.ok(!JSON.stringify(grant).includes(env.YT_RUN_TOKEN));
});

test("only Desktop app loopback redirects and bounded JSON objects are accepted", async () => {
  for (const redirect_uri of ["https://evil.example/", "http://localhost.evil.example/", "http://user@localhost/", "http://localhost/callback", "http://localhost/?x=1", "http://localhost/#fragment"]) {
    assert.equal((await worker.fetch(request("/oauth/consent", { redirect_uri }), env)).status, 400);
  }
  for (const redirect_uri of ["http://127.0.0.1:9000/", "http://[::1]:9000/"]) {
    assert.equal(new URL((await consent({ redirect_uri })).url).searchParams.get("redirect_uri"), redirect_uri);
  }
  for (const body of [null, [], "not an object"]) {
    assert.equal((await worker.fetch(request("/oauth/consent", body), env)).status, 400);
  }
  const invalid = request("/oauth/consent");
  assert.equal((await worker.fetch(new Request(invalid, { body: "{" }), env)).status, 400);
  assert.equal((await worker.fetch(request("/oauth/consent", { padding: "x".repeat(8192) }), env)).status, 413);
});

test("exchange rejects tampered, expired, and rotated-key states before calling Google", async t => {
  const grant = await consent();
  t.mock.method(globalThis, "fetch", () => { throw new Error("must not call Google"); });
  for (const body of [{}, { code: "test-code", state: grant.state + "x" }, { code: " ", state: grant.state }]) {
    assert.equal((await worker.fetch(request("/oauth/exchange", body), env)).status, 400);
  }
  const rotated = { ...env, YT_RUN_TOKEN: "test-rotated-run-token" };
  assert.equal((await worker.fetch(request("/oauth/exchange", { code: "test-code", state: grant.state }, rotated.YT_RUN_TOKEN), rotated)).status, 400);
  const future = Date.now() + 600001;
  t.mock.method(Date, "now", () => future);
  assert.equal((await worker.fetch(request("/oauth/exchange", { code: "test-code", state: grant.state }), env)).status, 400);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("exchange uses stored client credentials and PKCE, and returns only the validated refresh grant", async t => {
  const grant = await consent({ redirect_uri: "http://127.0.0.1:9000/" });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.equal(options.method, "POST");
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("client_id"), env.YT_CLIENT_ID);
    assert.equal(body.get("client_secret"), env.YT_CLIENT_SECRET);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), "test-code");
    assert.equal(body.get("redirect_uri"), "http://127.0.0.1:9000/");
    assert.equal(createHash("sha256").update(body.get("code_verifier")).digest("base64url"), new URL(grant.url).searchParams.get("code_challenge"));
    return Response.json({ access_token: "test-access", refresh_token: "test-refresh", scope: scopes.join(" "), id_token: "test-id" });
  });
  const response = await worker.fetch(request("/oauth/exchange", { code: "test-code", state: grant.state }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const result = await response.json();
  assert.equal(result.refresh_token, "test-refresh");
  assert.deepEqual(result.scopes, scopes);
  assert.match(result.install, /secret-lock lease/);
  for (const secret of ["test-access", "test-id", env.YT_CLIENT_SECRET, env.YT_RUN_TOKEN]) assert.ok(!JSON.stringify(result).includes(secret));
});

test("partial consent and missing refresh tokens cannot be mistaken for a usable grant", async t => {
  const grant = await consent();
  let token = { access_token: "test-access", refresh_token: "test-refresh", scope: scopes[0] };
  t.mock.method(globalThis, "fetch", async () => Response.json(token));
  const exchange = () => worker.fetch(request("/oauth/exchange", { code: "test-code", state: grant.state }), env);
  let response = await exchange();
  assert.equal(response.status, 403);
  const denied = await response.json();
  assert.deepEqual(denied.missing_scopes, scopes.slice(1));
  assert.equal(denied.refresh_token, undefined);
  token.scope = scopes.join(" ");
  delete token.refresh_token;
  assert.equal((await exchange()).status, 409);
  delete token.scope;
  assert.equal((await exchange()).status, 403);
});

test("Google errors and network exceptions never expose credentials or provider response bodies", async t => {
  const grant = await consent();
  const responseText = JSON.stringify({ error_description: env.YT_CLIENT_SECRET });
  t.mock.method(globalThis, "fetch", async () => new Response(responseText, { status: 400 }));
  const response = await worker.fetch(request("/oauth/exchange", { code: "test-code", state: grant.state }), env);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: "Google code exchange failed", upstream_status: 400 });
  globalThis.fetch.mock.mockImplementation(() => { throw new Error(env.YT_CLIENT_SECRET); });
  const failed = await worker.fetch(request("/oauth/exchange", { code: "test-code", state: grant.state }), env);
  assert.equal(failed.status, 502);
  assert.ok(!(await failed.text()).includes(env.YT_CLIENT_SECRET));
});

test("OAuth capability is advertised and the production mirror stays identical", async () => {
  const health = await (await worker.fetch(new Request("https://shorts.example/health"), {})).json();
  assert.ok(health.capabilities.includes("oauth-reconsent"));
  assert.equal(readFileSync(new URL("./worker.js", import.meta.url), "utf8"), readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8"));
});
