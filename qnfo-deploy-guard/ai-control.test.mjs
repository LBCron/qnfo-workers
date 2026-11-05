// AI-CONTROL-AUTHORITY-1 regression suite; run with `node qnfo-deploy-guard/ai-control.test.mjs`.
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const migration = await readFile(join(here, "..", "migrations", "2026-11-03-owner-ai-control.sql"), "utf8");
const { privateKey, publicKey: publicKey1 } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: otherPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey1.export({ format: "jwk" }), kid: "ai-control-test-key", alg: "RS256", use: "sig" };
const issuer = "https://qnfo-test.cloudflareaccess.com";
const audience = "qnfo-test-access-audience";
let activeKeys = [jwk];
let jwksStatus = 200;
let jwksRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  jwksRequests++;
  assert.equal(String(input), issuer + "/cdn-cgi/access/certs");
  return Response.json({ keys: activeKeys }, { status: jwksStatus });
};

function baseEnv(overrides = {}) {
  return {
    ACCESS_TEAM_DOMAIN: "qnfo-test.cloudflareaccess.com",
    ACCESS_AUD: audience,
    OWNER_EMAILS: "owner@example.test, second@example.test",
    ...overrides,
  };
}

function makeDb({ applyMigration = true } = {}) {
  const db = new DatabaseSync(":memory:");
  if (applyMigration) {
    db.exec(`
      CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT NOT NULL, kind TEXT NOT NULL, guards_against TEXT, critical_path INTEGER NOT NULL DEFAULT 0, disposition TEXT NOT NULL, disposition_state TEXT NOT NULL DEFAULT 'planned', alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT NOT NULL, issue_id INTEGER, reviewed_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE spof_registry (component TEXT PRIMARY KEY, critical_path TEXT NOT NULL, alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT NOT NULL, issue_id INTEGER, reviewed_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE belief_registry (belief_key TEXT PRIMARY KEY, claim TEXT NOT NULL, confidence REAL, evidence TEXT NOT NULL, probe_class TEXT NOT NULL, built_on TEXT, created_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
      CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h REAL, status TEXT, module TEXT, next_due_at TEXT);
      CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT NOT NULL, window_note TEXT, enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
    `);
    db.exec(migration);
  }
  const sessionOptions = [];
  let sessionError = null;
  const prepare = (sql) => {
    let args = [];
    const statement = {
      bind(...values) { args = values.map((value) => value === undefined ? null : value); return statement; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() {
        const result = db.prepare(sql).run(...args);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  };
  const env = {
    ...baseEnv(),
    AUDIT: {
      withSession(option) {
        sessionOptions.push(option);
        if (sessionError) throw sessionError;
        return { prepare };
      },
    },
  };
  return { db, env, sessionOptions, setSessionError(error) { sessionError = error; } };
}

function token(claimOverrides = {}, signingKey = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid, typ: "JWT" })).toString("base64url");
  const claims = {
    iss: issuer,
    aud: audience,
    exp: now + 600,
    nbf: now - 1,
    email: "owner@example.test",
    email_verified: true,
    sub: "access-subject-17",
    ...claimOverrides,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = header + "." + payload;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return signingInput + "." + signer.sign(signingKey).toString("base64url");
}

function ownerHeaders(claimOverrides = {}, signingKey) {
  return {
    "cf-access-jwt-assertion": token(claimOverrides, signingKey || privateKey),
    "content-type": "application/json",
  };
}

async function call(env, path, init = {}, ctx = {}) {
  return worker.fetch(new Request("https://qnfo-deploy-guard.q08.workers.dev" + path, init), env, ctx);
}
async function jsonCall(env, path, init = {}, ctx = {}) {
  const response = await call(env, path, init, ctx);
  return { response, body: await response.json() };
}
async function postOwner(env, path, data, headers = ownerHeaders()) {
  return jsonCall(env, path, { method: "POST", headers, body: JSON.stringify(data) });
}
function assertNoCacheNoCors(response, label) {
  assert.equal(response.headers.get("cache-control"), "no-store", label + " no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null, label + " has no permissive CORS");
}

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; }).catch((error) => {
    console.error("FAIL " + name + ": " + (error && error.stack || error));
    throw error;
  });
}

try {
  await test("migration creates a running singleton and append-only trigger-audited history", async () => {
    const { db } = makeDb();
    const state = db.prepare("SELECT * FROM fleet_ai_control WHERE id=1").get();
    assert.deepEqual({ paused: state.paused, revision: state.revision, reason: state.reason }, { paused: 0, revision: 0, reason: "initial running state" });
    assert.equal(state.actor, "migration:AI-CONTROL-AUTHORITY-1");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fleet_ai_control_audit").get().n, 1);
    assert.throws(() => db.prepare("DELETE FROM fleet_ai_control").run(), /singleton cannot be deleted/);
    assert.throws(() => db.prepare("UPDATE fleet_ai_control_audit SET reason='rewritten'").run(), /append-only/);
    assert.throws(() => db.prepare("DELETE FROM fleet_ai_control_audit").run(), /append-only/);
    assert.throws(() => db.prepare("UPDATE fleet_ai_control SET revision=revision+2 WHERE id=1").run(), /revision must increase/);
  });

  await test("public forwarded-email and caller headers cannot authenticate owner or machine routes", async () => {
    const { env } = makeDb();
    const before = jwksRequests;
    const owner = await jsonCall(env, "/ai-control", { headers: {
      "cf-access-authenticated-user-email": "owner@example.test",
      "x-forwarded-email": "owner@example.test",
    } });
    assert.equal(owner.response.status, 401);
    assert.equal(jwksRequests, before);
    assertNoCacheNoCors(owner.response, "spoofed owner status");
    const machine = await jsonCall(env, "/ai-control/check", { headers: { "x-cf-worker-caller": "qnfo-code-orchestrator" } });
    assert.equal(machine.response.status, 403);
    assert.deepEqual(machine.body, { ok: false, error: "trusted_service_required", paused: true });
    assertNoCacheNoCors(machine.response, "spoofed machine check");
  });

  await test("owner status accepts signed Access JWT for hostname or HTTPS-origin configuration", async () => {
    const { env, sessionOptions } = makeDb();
    const response = await jsonCall(env, "/ai-control", { headers: ownerHeaders() });
    assert.equal(response.response.status, 200);
    assert.deepEqual(
      { ok: response.body.ok, paused: response.body.paused, revision: response.body.revision, actor: response.body.actor },
      { ok: true, paused: false, revision: 0, actor: "migration:AI-CONTROL-AUTHORITY-1" },
    );
    assertNoCacheNoCors(response.response, "owner status");
    assert.ok(sessionOptions.length === 1 && sessionOptions[0] === "first-primary");
    const originConfig = baseEnv({ ACCESS_TEAM_DOMAIN: issuer + "/" });
    const anotherDb = makeDb();
    Object.assign(anotherDb.env, originConfig);
    const originStatus = await jsonCall(anotherDb.env, "/ai-control", { headers: ownerHeaders() });
    assert.equal(originStatus.response.status, 200);
    assertNoCacheNoCors(originStatus.response, "origin owner status");
  });

  await test("non-owner, unverified, expired, not-yet-valid, wrong-audience and bad-signature JWTs fail closed", async () => {
    const env = makeDb().env;
    const cases = [
      ["non-owner", { email: "intruder@example.test" }, undefined, 403],
      ["unverified", { email_verified: false }, undefined, 401],
      ["expired", { exp: Math.floor(Date.now() / 1000) - 1 }, undefined, 401],
      ["not yet valid", { nbf: Math.floor(Date.now() / 1000) + 60 }, undefined, 401],
      ["wrong audience", { aud: "different-audience" }, undefined, 401],
      ["wrong issuer", { iss: "https://attacker.cloudflareaccess.com" }, undefined, 401],
      ["bad signature", {}, otherPrivateKey, 401],
    ];
    for (const [label, claims, signer, status] of cases) {
      const response = await jsonCall(env, "/ai-control", { headers: ownerHeaders(claims, signer) });
      assert.equal(response.response.status, status, label);
      assertNoCacheNoCors(response.response, label);
    }
  });

  await test("missing auth configuration and JWKS failures are unavailable, never authenticated", async () => {
    const env = makeDb().env;
    for (const [field, value] of [["ACCESS_TEAM_DOMAIN", ""], ["ACCESS_AUD", ""], ["OWNER_EMAILS", ""]]) {
      const missingConfig = await jsonCall({ ...env, [field]: value }, "/ai-control", { headers: ownerHeaders() });
      assert.equal(missingConfig.response.status, 503, field);
      assert.equal(missingConfig.body.error, "owner_auth_unavailable", field);
      assertNoCacheNoCors(missingConfig.response, "missing " + field);
    }
    jwksStatus = 503;
    const assertion = token();
    const logs = [];
    const oldError = console.error;
    console.error = (message) => logs.push(String(message));
    let unavailable;
    try { unavailable = await jsonCall(env, "/ai-control", { headers: { "cf-access-jwt-assertion": assertion } }); }
    finally { console.error = oldError; }
    assert.equal(unavailable.response.status, 503);
    assert.equal(unavailable.body.error, "owner_auth_unavailable");
    assertNoCacheNoCors(unavailable.response, "JWKS unavailable");
    assert.ok(logs.some((message) => message.includes("owner-jwks")), "JWKS failure is logged");
    assert.ok(logs.every((message) => !message.includes(assertion)), "JWT never appears in logs");
    jwksStatus = 200;
    const invalidDomain = await jsonCall({ ...env, ACCESS_TEAM_DOMAIN: "https://attacker.example" }, "/ai-control", { headers: ownerHeaders() });
    assert.equal(invalidDomain.response.status, 503);
    assertNoCacheNoCors(invalidDomain.response, "invalid Access domain");
  });

  await test("trusted service-binding props permit machine checks; public header claims do not", async () => {
    const { env, sessionOptions } = makeDb();
    const running = await jsonCall(env, "/ai-control/check", {}, { props: { caller: "qnfo-code-orchestrator" } });
    assert.equal(running.response.status, 200);
    assert.deepEqual({ ok: running.body.ok, paused: running.body.paused, revision: running.body.revision }, { ok: true, paused: false, revision: 0 });
    assertNoCacheNoCors(running.response, "machine check");
    const invalid = await jsonCall(env, "/ai-control/check", {}, { props: { caller: "not a worker" } });
    assert.equal(invalid.response.status, 403);
    assert.equal(sessionOptions.at(-1), "first-primary");
  });

  await test("pause increments revision every time; resume CAS and later pause defeat stale resume", async () => {
    const { db, env, sessionOptions } = makeDb();
    const headers = ownerHeaders();
    let result = await postOwner(env, "/ai-control/pause", { reason: "emergency stop" }, headers);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.paused, true);
    assert.equal(result.body.revision, 1);
    assert.equal(result.body.actor, "owner:access-subject-17");
    assertNoCacheNoCors(result.response, "pause");

    result = await postOwner(env, "/ai-control/pause", { reason: "confirm stop" }, headers);
    assert.equal(result.body.revision, 2, "repeat pause advances revision");
    result = await postOwner(env, "/ai-control/resume", { reason: "stale resume", expected_revision: 1 }, headers);
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error, "ai_control_conflict");
    assert.deepEqual({ paused: result.body.state.paused, revision: result.body.state.revision }, { paused: true, revision: 2 });
    assertNoCacheNoCors(result.response, "conflict");
    assert.equal(db.prepare("SELECT MAX(revision) AS r FROM fleet_ai_control_audit").get().r, 2, "conflict does not audit a state change");

    result = await postOwner(env, "/ai-control/resume", { reason: "authorized resume", expected_revision: 2 }, headers);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.paused, false);
    assert.equal(result.body.revision, 3);
    assertNoCacheNoCors(result.response, "resume");

    result = await postOwner(env, "/ai-control/pause", { reason: "second emergency stop" }, headers);
    assert.equal(result.body.revision, 4);
    result = await postOwner(env, "/ai-control/resume", { reason: "delayed stale resume", expected_revision: 3 }, headers);
    assert.equal(result.response.status, 409);
    assert.equal(result.body.state.paused, true);
    assert.equal(result.body.state.revision, 4, "a stale resume cannot undo a later pause");

    result = await postOwner(env, "/ai-control/resume", { reason: "current resume", expected_revision: 4 }, headers);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.revision, 5);
    assert.equal(result.body.paused, false);
    const audit = db.prepare("SELECT revision, paused, reason, actor FROM fleet_ai_control_audit ORDER BY id").all();
    assert.deepEqual(audit.map((row) => row.revision), [0, 1, 2, 3, 4, 5]);
    assert.equal(audit[1].reason, "emergency stop");
    assert.equal(audit[1].actor, "owner:access-subject-17");
    assert.ok(sessionOptions.length >= 7 && sessionOptions.every((option) => option === "first-primary"));
  });

  await test("paused state is visible to owner and trusted callers while controls remain usable", async () => {
    const { env } = makeDb();
    let result = await postOwner(env, "/ai-control/pause", { reason: "pause for maintenance" });
    const revision = result.body.revision;
    const status = await jsonCall(env, "/ai-control", { headers: ownerHeaders() });
    assert.equal(status.response.status, 200);
    assert.equal(status.body.paused, true);
    assert.equal(status.body.revision, revision);
    assertNoCacheNoCors(status.response, "paused owner status");
    const check = await jsonCall(env, "/ai-control/check", {}, { props: { caller: "qnfo-ai" } });
    assert.equal(check.response.status, 503);
    assert.deepEqual({ ok: check.body.ok, error: check.body.error, paused: check.body.paused }, { ok: false, error: "ai_paused", paused: true });
    assertNoCacheNoCors(check.response, "paused machine check");
    result = await postOwner(env, "/ai-control/resume", { reason: "maintenance complete", expected_revision: revision });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.paused, false);
    assertNoCacheNoCors(result.response, "resume while paused");
    const health = await jsonCall(env, "/health");
    assert.equal(health.response.status, 200, "unrelated routes remain unchanged");
  });

  await test("invalid and oversized JSON or reasons are rejected", async () => {
    const env = makeDb().env;
    const headers = ownerHeaders();
    let result = await postOwner(env, "/ai-control/pause", { reason: "  " }, headers);
    assert.equal(result.response.status, 400);
    result = await postOwner(env, "/ai-control/pause", { reason: "x".repeat(501) }, headers);
    assert.equal(result.response.status, 400);
    result = await postOwner(env, "/ai-control/resume", { reason: "missing revision" }, headers);
    assert.equal(result.response.status, 400);
    const large = await jsonCall(env, "/ai-control/pause", {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: "x".repeat(3000) }),
    });
    assert.equal(large.response.status, 400);
    assertNoCacheNoCors(large.response, "oversized body");
  });

  await test("missing binding, table, row and failed first-primary session all fail closed", async () => {
    const noBinding = await jsonCall({}, "/ai-control/check", {}, { props: { caller: "qnfo-ai" } });
    assert.equal(noBinding.response.status, 503);
    assert.deepEqual(noBinding.body, { ok: false, error: "ai_control_unavailable", paused: true });
    assertNoCacheNoCors(noBinding.response, "missing binding");

    const missingTable = makeDb({ applyMigration: false });
    const tableFailure = await jsonCall(missingTable.env, "/ai-control/check", {}, { props: { caller: "qnfo-ai" } });
    assert.equal(tableFailure.response.status, 503);
    assert.equal(tableFailure.body.error, "ai_control_unavailable");
    assert.equal(missingTable.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='fleet_ai_control'").get().n, 0, "route does not create schema");

    const missingRow = makeDb();
    missingRow.db.exec("DROP TABLE fleet_ai_control");
    missingRow.db.exec("CREATE TABLE fleet_ai_control (id INTEGER PRIMARY KEY, paused INTEGER, revision INTEGER, updated_at TEXT, reason TEXT, actor TEXT)");
    const rowFailure = await jsonCall(missingRow.env, "/ai-control/check", {}, { props: { caller: "qnfo-ai" } });
    assert.equal(rowFailure.response.status, 503);
    assert.equal(rowFailure.body.error, "ai_control_unavailable");

    const failedSession = makeDb();
    failedSession.setSessionError(new Error("primary session refused"));
    const sessionFailure = await jsonCall(failedSession.env, "/ai-control/check", {}, { props: { caller: "qnfo-ai" } });
    assert.equal(sessionFailure.response.status, 503);
    assert.deepEqual(sessionFailure.body, { ok: false, error: "ai_control_unavailable", paused: true });
    assertNoCacheNoCors(sessionFailure.response, "failed session");

    const failedMutation = await postOwner(failedSession.env, "/ai-control/pause", { reason: "must not run" });
    assert.equal(failedMutation.response.status, 503);
    assert.equal(failedMutation.body.error, "ai_control_unavailable");
    assert.equal(failedSession.db.prepare("SELECT revision FROM fleet_ai_control WHERE id=1").get().revision, 0);
  });

  await test("only the exact authority paths are intercepted", async () => {
    const env = makeDb().env;
    const unknown = await jsonCall(env, "/ai-control/unknown");
    assert.equal(unknown.response.status, 404);
    const wrongMethod = await jsonCall(env, "/ai-control", { method: "POST" });
    assert.equal(wrongMethod.response.status, 404);
  });

  console.log(`${passed} passed, 0 failed`);
} finally {
  globalThis.fetch = originalFetch;
}
