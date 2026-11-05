// Exercises the deployment control plane through its real fetch and scheduled handlers.
// Cloudflare, GitHub, and D1 are replaced with offline fixtures.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const originalFetch = globalThis.fetch;
const origin = "https://qnfo-fleet-deploy.test";
const adminHeaders = { Authorization: "Bearer admin-token", "Content-Type": "application/json" };
const selfHealHeaders = { Authorization: "Bearer selfheal-token", "Content-Type": "application/json" };
const sourcePath = "qnfo-workers/main/qnfo-gateway/deployed-current.worker.js";

function makeHarness({ sourceCode = "", deployedCode = "", putSuccess = true, verificationCode } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE fleet_deploy_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE fleet_deploys (
      id INTEGER PRIMARY KEY AUTOINCREMENT, worker TEXT, actor TEXT, from_sha TEXT, to_sha TEXT,
      source_path TEXT, ok INTEGER, note TEXT, ts TEXT
    );
    CREATE TABLE fleet_drift_report (
      id INTEGER PRIMARY KEY AUTOINCREMENT, worker TEXT, deployed_version TEXT,
      canonical_version TEXT, source_path TEXT, note TEXT, ts TEXT
    );
    CREATE TABLE fleet_improvements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, target TEXT, kind TEXT, title TEXT,
      detail TEXT, priority TEXT, status TEXT, evidence TEXT, updated_at TEXT,
      UNIQUE(target, kind, title)
    );
    CREATE TABLE task_dod_register (
      id INTEGER PRIMARY KEY, title TEXT, due TEXT, owner TEXT, status TEXT
    );
    CREATE TABLE fleet_probe_log (id INTEGER PRIMARY KEY, name TEXT, body TEXT, ok INTEGER);
  `);

  const AUDIT = {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) {
          values = args.map((value) => value === undefined ? null : value);
          return statement;
        },
        async first() {
          return db.prepare(sql).get(...values) || null;
        },
        async all() {
          return { results: db.prepare(sql).all(...values) };
        },
        async run() {
          const result = db.prepare(sql).run(...values);
          return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        }
      };
      return statement;
    }
  };

  const bucket = new Map();
  const CANONICAL = {
    async get(key) {
      return bucket.get(key) || null;
    },
    async put(key, value, options) {
      bucket.set(key, { code: String(value), customMetadata: options && options.customMetadata });
    }
  };

  let liveCode = deployedCode;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("raw.githubusercontent.com/") && url.endsWith(sourcePath)) {
      return new Response(sourceCode, { status: 200 });
    }
    if (url.endsWith("/workers/scripts?per_page=100")) {
      return Response.json({ result: [{ id: "qnfo-gateway" }] });
    }
    if (url.endsWith("/content/v2")) {
      const content = verificationCode === undefined ? liveCode : verificationCode;
      return new Response(content, { status: content ? 200 : 404 });
    }
    if (url.endsWith("/content") && init.method === "PUT") {
      if (putSuccess) liveCode = sourceCode;
      return Response.json({ success: putSuccess }, { status: putSuccess ? 200 : 400 });
    }
    return new Response("not found", { status: 404 });
  };

  const env = {
    AUDIT,
    CANONICAL,
    CF_DEPLOY_TOKEN: "cf-deploy-token",
    DEPLOY_ADMIN_TOKEN: "admin-token",
    SELFHEAL_TOKEN: "selfheal-token"
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const call = (path, init = {}) => worker.fetch(new Request(origin + path, init), env, ctx);
  const post = (path, body, headers = adminHeaders) => call(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  return { db, env, calls, call, post, getLiveCode: () => liveCode };
}

let passed = 0;
let failed = 0;
async function test(name, run) {
  try {
    await run();
    passed++;
    console.log("PASS " + name);
  } catch (error) {
    failed++;
    console.error("FAIL " + name + ": " + (error && error.stack || error));
  }
}

const classicSource = 'var VERSION = "2.1.0";\naddEventListener("fetch", () => {});';
const moduleSource = 'var VERSION = "2.1.0";\nexport default { fetch() {} };';

try {
  await test("health is public and protected routes reject missing credentials", async () => {
    const h = makeHarness();
    const health = await h.call("/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: "ok", worker: "qnfo-fleet-deploy", version: "0.4.11", enabled: false, auto_heal: false
    });

    const denied = await h.post("/redeploy", { worker: "qnfo-gateway" }, {});
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { error: "unauthorized" });
    assert.equal(h.calls.length, 0, "unauthorized requests must not reach GitHub or Cloudflare");
  });

  await test("self-heal credentials can read but cannot mutate improvements", async () => {
    const h = makeHarness();
    const read = await h.call("/improvements", { headers: selfHealHeaders });
    assert.equal(read.status, 200);
    assert.equal((await read.json()).counts.total, 0);

    assert.equal((await h.post("/improvements", { title: "unauthorized" }, selfHealHeaders)).status, 404);
    assert.equal((await h.post("/improvements/resolve", { id: 1, status: "done" }, selfHealHeaders)).status, 404);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM fleet_improvements").get().n, 0);
  });

  await test("redeploy refuses invalid names, self-deploy, and a closed kill switch before fetching sources", async () => {
    const h = makeHarness();
    let response = await h.post("/redeploy", { worker: "../qnfo-gateway" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).note, "invalid name");

    response = await h.post("/redeploy", { worker: "qnfo-fleet-deploy" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).note, "self-redeploy refused");

    response = await h.post("/redeploy", { worker: "qnfo-gateway" });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).note, "kill-switch closed");
    assert.equal(h.calls.length, 0);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM fleet_deploys").get().n, 0);
  });

  await test("redeploy requires a canonical source with a VERSION marker", async () => {
    const missing = makeHarness();
    await missing.db.prepare("INSERT INTO fleet_deploy_state (key, value) VALUES ('enabled', '1')").run();
    let response = await missing.post("/redeploy", { worker: "qnfo-gateway" });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).note, "no canonical source");

    const unversioned = makeHarness({ sourceCode: "export default { fetch() {} };" });
    await unversioned.db.prepare("INSERT INTO fleet_deploy_state (key, value) VALUES ('enabled', '1')").run();
    response = await unversioned.post("/redeploy", { worker: "qnfo-gateway" });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).note, "canonical has no VERSION marker");
    assert.equal(unversioned.calls.filter((call) => call.init.method === "PUT").length, 0);
  });

  await test("matching versions are audited as no-ops and never uploaded", async () => {
    const h = makeHarness({ sourceCode: classicSource, deployedCode: classicSource });
    await h.db.prepare("INSERT INTO fleet_deploy_state (key, value) VALUES ('enabled', '1')").run();
    const response = await h.post("/redeploy", { worker: "qnfo-gateway" });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.note, "no-op");
    assert.equal(h.calls.filter((call) => call.init.method === "PUT").length, 0);
    assert.deepEqual(
      { ...h.db.prepare("SELECT worker, from_sha, to_sha, ok, note FROM fleet_deploys").get() },
      { worker: "qnfo-gateway", from_sha: "2.1.0", to_sha: "2.1.0", ok: 1, note: "no-op version match" }
    );
  });

  await test("successful redeploys activate the 60-second cooldown", async () => {
    const h = makeHarness({ sourceCode: classicSource, deployedCode: classicSource });
    await h.db.prepare("INSERT INTO fleet_deploy_state (key, value) VALUES ('enabled', '1')").run();
    assert.equal((await h.post("/redeploy", { worker: "qnfo-gateway" })).status, 200);

    const response = await h.post("/redeploy", { worker: "qnfo-gateway" });
    assert.equal(response.status, 429);
    assert.equal((await response.json()).note, "cooldown 60s");
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM fleet_deploys").get().n, 1);
  });

  await test("classic workers upload canonical code and require deployed-version verification", async () => {
    const oldCode = 'var VERSION = "2.0.9";';
    const h = makeHarness({ sourceCode: classicSource, deployedCode: oldCode });
    await h.db.prepare("INSERT INTO fleet_deploy_state (key, value) VALUES ('enabled', '1')").run();
    const response = await h.post("/redeploy", { worker: "qnfo-gateway" });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.direction, "upgrade");
    assert.equal(body.source, sourcePath);
    assert.equal(body.bytes, classicSource.length);
    assert.equal(h.getLiveCode(), classicSource);
    const upload = h.calls.find((call) => call.init.method === "PUT");
    assert.ok(upload);
    assert.equal(upload.init.headers.Authorization, "Bearer cf-deploy-token");
    assert.equal(upload.init.headers["Content-Type"], "application/javascript");
    assert.equal(upload.init.body, classicSource);
    assert.deepEqual(
      { ...h.db.prepare("SELECT worker, actor, from_sha, to_sha, source_path, ok FROM fleet_deploys").get() },
      { worker: "qnfo-gateway", actor: "deploy", from_sha: "2.0.9", to_sha: "2.1.0", source_path: sourcePath, ok: 1 }
    );
  });

  await test("module workers use multipart upload and declare worker.js as the main module", async () => {
    const h = makeHarness({ sourceCode: moduleSource, deployedCode: 'var VERSION = "2.0.9";' });
    await h.db.prepare("INSERT INTO fleet_deploy_state (key, value) VALUES ('enabled', '1')").run();
    const response = await h.post("/redeploy", { worker: "qnfo-gateway" });
    assert.equal(response.status, 200);

    const upload = h.calls.find((call) => call.init.method === "PUT");
    assert.ok(upload);
    assert.ok(upload.init.body instanceof FormData);
    assert.equal(upload.init.body.get("metadata").type, "application/json");
    assert.deepEqual(JSON.parse(await upload.init.body.get("metadata").text()), { main_module: "worker.js" });
    assert.equal(await upload.init.body.get("worker.js").text(), moduleSource);
  });

  await test("failed uploads return 502 and leave a failed audit record", async () => {
    const oldCode = 'var VERSION = "2.0.9";';
    const h = makeHarness({ sourceCode: classicSource, deployedCode: oldCode, putSuccess: false });
    await h.db.prepare("INSERT INTO fleet_deploy_state (key, value) VALUES ('enabled', '1')").run();
    const response = await h.post("/redeploy", { worker: "qnfo-gateway" });
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.ok, false);
    assert.match(body.note, /HTTP 400/);
    assert.equal(h.db.prepare("SELECT ok FROM fleet_deploys").get().ok, 0);
    assert.equal(h.getLiveCode(), oldCode);

    const unverified = makeHarness({
      sourceCode: classicSource,
      deployedCode: oldCode,
      verificationCode: oldCode
    });
    await unverified.db.prepare("INSERT INTO fleet_deploy_state (key, value) VALUES ('enabled', '1')").run();
    const verifyResponse = await unverified.post("/redeploy", { worker: "qnfo-gateway" });
    const verifyBody = await verifyResponse.json();
    assert.equal(verifyResponse.status, 502);
    assert.match(verifyBody.note, /PUT-ok but deployed still 2\.0\.9/);
    assert.equal(unverified.db.prepare("SELECT ok FROM fleet_deploys").get().ok, 0);
    assert.equal(unverified.getLiveCode(), classicSource, "the fixture accepted the upload while verification stayed stale");
  });

  await test("admin improvement mutations validate, persist, and bound evidence", async () => {
    const h = makeHarness();
    let response = await h.post("/improvements", {});
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "title required" });

    response = await h.post("/improvements", {
      source: "manual", target: "qnfo-gateway", kind: "fix", title: "Add regression coverage",
      detail: "A detailed note", priority: "P1"
    });
    const created = await response.json();
    assert.equal(response.status, 200);
    assert.equal(created.ok, true);

    response = await h.post("/improvements/resolve", { id: created.id, status: "done", evidence: "verified".repeat(100) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "done");
    const row = h.db.prepare("SELECT target, kind, title, status, evidence FROM fleet_improvements WHERE id=?1").get(created.id);
    assert.deepEqual(
      { target: row.target, kind: row.kind, title: row.title, status: row.status, evidenceLength: row.evidence.length },
      { target: "qnfo-gateway", kind: "fix", title: "Add regression coverage", status: "done", evidenceLength: 500 }
    );
  });

  await test("health reports distinguish unhealthy workers from missing coverage and deduplicate findings", async () => {
    const h = makeHarness();
    const probes = [
      { worker: "healthy-worker", status: 200 },
      { worker: "failed-worker", status: 503 },
      { worker: "network-worker", status: 0 },
      { worker: "cloudflare-error", status: 530 },
      { worker: "qnfo-fleet-deploy", status: 500 },
      { worker: "", status: 500 }
    ];
    const response = await h.post("/health-report", { probes });
    const report = (await response.json()).report;
    assert.equal(response.status, 200);
    assert.deepEqual(
      { healthy: report.healthy, unhealthy: report.unhealthy, coverage: report.coverage },
      { healthy: 1, unhealthy: 1, coverage: 2 }
    );
    assert.deepEqual(report.filed.map((row) => row.worker), ["failed-worker", "network-worker", "cloudflare-error"]);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM fleet_improvements").get().n, 3);

    await h.post("/health-report", { probes });
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM fleet_improvements").get().n, 3);
  });

  await test("scheduled scans report drift but only heal when auto-heal and deploy are enabled", async () => {
    const h = makeHarness({ sourceCode: classicSource, deployedCode: 'var VERSION = "2.0.9";' });
    await worker.scheduled({}, h.env, {});
    assert.equal(h.calls.filter((call) => call.init.method === "PUT").length, 0);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM fleet_drift_report WHERE note='canonical-ahead'").get().n, 1);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM fleet_deploys").get().n, 0);

    await h.db.prepare("INSERT INTO fleet_deploy_state (key, value) VALUES ('enabled', '1')").run();
    await h.db.prepare("INSERT INTO fleet_deploy_state (key, value) VALUES ('auto_heal', '1')").run();
    await worker.scheduled({}, h.env, {});
    assert.equal(h.calls.filter((call) => call.init.method === "PUT").length, 1);
    assert.equal(h.getLiveCode(), classicSource);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM fleet_deploys WHERE ok=1").get().n, 1);
  });

  await test("scheduled auto-heal never rolls back a worker deployed ahead of canonical", async () => {
    const deployedCode = 'var VERSION = "3.0.0";';
    const h = makeHarness({ sourceCode: classicSource, deployedCode });
    await h.db.prepare("INSERT INTO fleet_deploy_state (key, value) VALUES ('enabled', '1')").run();
    await h.db.prepare("INSERT INTO fleet_deploy_state (key, value) VALUES ('auto_heal', '1')").run();
    await worker.scheduled({}, h.env, {});

    assert.equal(h.calls.filter((call) => call.init.method === "PUT").length, 0);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM fleet_drift_report WHERE note='deployed-ahead'").get().n, 1);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM fleet_deploys").get().n, 0);
    assert.equal(h.getLiveCode(), deployedCode);
  });
} finally {
  globalThis.fetch = originalFetch;
}

console.log(passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
