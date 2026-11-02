// Run: node scripts/gh-webhook-setup.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupWebhook, WEBHOOK_URL, WEBHOOK_EVENTS } from "./gh-webhook-setup.mjs";
import { run } from "./github-settings-actions.mjs";

const NOW = Date.parse("2026-11-01T15:00:00Z");
const ROOT = new URL("../", import.meta.url).pathname;
const ENV = { GH_ADMIN_TOKEN: "test-admin", CLOUDFLARE_API_TOKEN: "test-cloudflare", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), GITHUB_RUN_ID: "123" };
const hook = (extra = {}) => ({
  id: 42, name: "web", active: true, events: WEBHOOK_EVENTS,
  config: { url: WEBHOOK_URL, content_type: "json", insecure_ssl: "0" }, ...extra
});
function fixture(options = {}) {
  const state = { hooks: options.hooks || [], configured: !!options.configured, log: [], secret: null, delivered: false, deliveries: [], releases: 0, clock: NOW };
  const response = (status, body) => ({ status, text: async () => JSON.stringify(body) });
  const api = {
    async call(method, path, body) {
      state.log.push({ method, path, body });
      if (options.refuse === method) return { ok: false, status: 403, message: "Resource not accessible by integration" };
      if (method === "GET" && path.includes("/deliveries?")) return { ok: true, body: state.deliveries };
      if (method === "GET" && path.includes("?")) {
        const page = Number(new URL("https://api.github.com" + path).searchParams.get("page"));
        return { ok: true, body: options.pageOne && page === 1 ? options.pageOne : state.hooks };
      }
      if (method === "GET") return { ok: true, body: state.hooks[0] };
      if (method === "POST" && path.endsWith("/tests")) {
        state.delivered = !options.noDelivery;
        if (state.delivered) {
          state.deliveries.push({
            id: 700,
            event: options.deliveryEvent || "ping",
            delivered_at: new Date(options.oldDelivery ? NOW - 2000 : state.clock).toISOString(),
            status_code: options.deliveryStatus ?? 200
          });
        }
        return { ok: true, body: null };
      }
      state.hooks = [hook({ ...body, config: { ...body.config, secret: undefined } })];
      return { ok: true, body: state.hooks[0] };
    }
  };
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    state.log.push({ method: init.method, path: url, body });
    assert.equal(init.redirect, "error", "fleet requests cannot redirect credentials or secrets");
    if (url === WEBHOOK_URL) return response(200, {
      route: options.badRoute ? "other" : "gh-webhook-intake", configured: state.configured,
      last: state.delivered ? { ts: new Date(options.oldDelivery ? NOW - 1000 : NOW).toISOString() } : null
    });
    if (url.endsWith("/secret-lock/acquire")) {
      if (options.race) state.hooks = [hook()];
      if (options.expire) state.clock += 300000;
      return response(200, { acquired: !options.locked, token: "test-lease", expires_at: new Date(NOW + 300000).toISOString() });
    }
    if (url.endsWith("/secret-lock/release")) {
      state.releases++;
      return response(200, { released: !options.releaseFailure });
    }
    assert.equal(init.headers.Authorization, "Bearer " + ENV.CLOUDFLARE_API_TOKEN);
    if (options.cfRefusal) return response(403, { errors: [{ message: "Authentication error" }] });
    if (url.endsWith("/settings")) return response(200, { success: true, result: {} });
    assert.ok(url.endsWith("/secrets"));
    assert.equal(body.name, "GH_WEBHOOK_SECRET");
    assert.equal(body.type, "secret_text");
    assert.match(body.text, /^[a-f0-9]{64}$/);
    state.secret = body.text;
    state.configured = true;
    return response(200, { success: true });
  };
  const execute = (mode = "live", env = ENV) => setupWebhook(api, mode, fetchImpl, env, { sleep: async () => {}, now: () => state.clock });
  return { state, api, fetchImpl, execute };
}
const writes = (state) => state.log.filter((call) => call.method !== "GET");

{
  const f = fixture();
  const result = await f.execute("dry", {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.desired.events, WEBHOOK_EVENTS);
  assert.equal(writes(f.state).length, 0, "dry mode needs no Cloudflare token and never writes");
}
{
  const f = fixture();
  const result = await f.execute();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.verified_delivery_at, new Date(NOW).toISOString());
  assert.equal(result.verified_delivery_status, 200);
  const install = f.state.log.find((call) => call.method === "PUT");
  const registration = f.state.log.find((call) => call.path.endsWith("/hooks") && call.method === "POST");
  assert.equal(registration.body.config.secret, install.body.text, "both sides receive the same dedicated secret");
  assert.equal(f.state.releases, 1);
  const output = JSON.stringify(result);
  for (const secret of [f.state.secret, "test-lease", ENV.CLOUDFLARE_API_TOKEN, ENV.GH_ADMIN_TOKEN]) assert.ok(!output.includes(secret));
}
{
  const f = fixture({ configured: true, hooks: [hook()] });
  assert.equal((await f.execute("live", { GH_ADMIN_TOKEN: ENV.GH_ADMIN_TOKEN })).ok, true);
  assert.equal(f.state.log.filter((call) => call.method === "PUT" || call.method === "PATCH").length, 0, "rerun does not rotate a configured secret");
  assert.equal(f.state.releases, 1);
}
{
  const f = fixture({ configured: true, hooks: [hook({ events: ["push"] })] });
  assert.equal((await f.execute()).ok, true);
  const patch = f.state.log.find((call) => call.method === "PATCH");
  assert.deepEqual(patch.body.events, WEBHOOK_EVENTS);
  assert.equal(patch.body.config.secret, undefined, "configuration repair preserves the existing secret");
  assert.equal(f.state.secret, null);
}
{
  const f = fixture({ configured: true, hooks: [hook({ active: false })] });
  assert.equal((await f.execute()).ok, true);
  const patch = f.state.log.find((call) => call.method === "PATCH");
  assert.equal(patch.body.active, false, "an interrupted setup can restage an inactive hook");
  assert.equal(patch.body.config.secret, f.state.secret);
  assert.equal(f.state.hooks[0].active, true);
}
{
  const f = fixture({ pageOne: Array.from({ length: 100 }, (_, i) => hook({ id: i + 100, config: { url: "https://example.org" } })) });
  assert.equal((await f.execute("dry", {})).ok, true);
  assert.equal(f.state.log.filter((call) => call.path.includes("/hooks?")).length, 2, "scan follows pagination before creating a hook");
}
for (const options of [{ locked: true }, { badRoute: true }, { hooks: [hook(), hook({ id: 43 })] }, { hooks: [hook({ id: "../other" })] }]) {
  const f = fixture(options);
  assert.equal((await f.execute()).ok, false);
  assert.equal(f.state.secret, null);
  assert.equal(f.state.log.filter((call) => call.path.startsWith("/repos/") && call.method !== "GET").length, 0);
}
for (const options of [{ race: true }, { expire: true }, { cfRefusal: true }]) {
  const f = fixture(options);
  assert.equal((await f.execute()).ok, false);
  assert.equal(f.state.secret, null, "races, expiring leases and refused reads prevent a secret write");
  assert.equal(f.state.releases, 1);
}
{
  const f = fixture({ refuse: "POST" });
  const result = await f.execute();
  assert.equal(result.ok, false);
  assert.match(result.error, /403 Resource not accessible by integration/);
  assert.equal(f.state.secret, null, "a refused registration never changes the Worker secret");
  assert.equal(f.state.releases, 1);
  assert.equal(f.state.log.filter((call) => call.method === "POST" && call.path.endsWith("/hooks")).length, 1, "a refused GitHub write is not retried");
}
for (const options of [{ noDelivery: true }, { oldDelivery: true }, { deliveryStatus: 503 }, { releaseFailure: true }]) {
  const f = fixture(options);
  assert.equal((await f.execute()).ok, false, "registration alone, an old row or a failed release is not success");
  assert.equal(f.state.releases, 1);
}
for (const env of [{}, { GH_ADMIN_TOKEN: ENV.GH_ADMIN_TOKEN }]) {
  const f = fixture();
  assert.equal((await f.execute("live", env)).ok, false);
  assert.equal(writes(f.state).length, 0, "missing credentials cause no writes");
}
{
  const f = fixture();
  let generated;
  f.api.call = async (method, path, body) => {
    if (method === "GET" && path.includes("?")) return { ok: true, body: [] };
    generated = body?.config?.secret;
    return { ok: false, status: 422, message: `${body?.config?.secret} test-lease ${ENV.CLOUDFLARE_API_TOKEN}` };
  };
  const output = JSON.stringify(await f.execute());
  for (const secret of [generated, "test-lease", ENV.CLOUDFLARE_API_TOKEN]) assert.ok(!output.includes(secret), "error responses cannot echo secrets");
}
{
  let calls = 0;
  const result = await run("gh-webhook", "dry", ROOT, async (url, init) => {
    calls++;
    assert.equal(init.redirect, "error");
    if (url.startsWith("https://api.github.com")) return { status: 200, text: async () => "[]" };
    return { status: 200, text: async () => JSON.stringify({ route: "gh-webhook-intake", configured: false }) };
  }, { GITHUB_TOKEN: "test-read" });
  assert.equal(result.ok, true);
  assert.equal(calls, 2, "the existing settings CLI dispatches the webhook action");
  const workflow = readFileSync(new URL("../.github/workflows/github-settings-actions.yml", import.meta.url), "utf8");
  assert.match(workflow, /- gh-webhook/);
  assert.match(workflow, /paths:\s+- scripts\/gh-webhook-setup\.mjs/);
  assert.ok(!workflow.includes("secrets.GH_WEBHOOK_SECRET"), "the secret is generated only in the locked runner");
}
console.log("GH-WEBHOOK-INTAKE-1 setup tests passed");
