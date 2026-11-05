import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(scriptDir, "..");
const moduleArgument = process.argv[2] || process.env.AI_CONTROL_MINIFLARE_MODULE;
if (!moduleArgument) {
  throw new Error("Pass the installed Miniflare package path as the first argument or set AI_CONTROL_MINIFLARE_MODULE.");
}
const miniflarePath = resolve(moduleArgument);
const miniflareRequire = createRequire(join(miniflarePath, "package.json"));
const { Miniflare, convertV4MiniflareOptions } = miniflareRequire(miniflarePath);
const packageInfo = miniflareRequire(join(miniflarePath, "package.json"));
const workerdInfo = miniflareRequire(miniflareRequire.resolve("workerd/package.json"));
const workerPath = join(repo, "qnfo-deploy-guard", "worker.js");
const migrationPath = join(repo, "migrations", "2026-11-03-owner-ai-control.sql");
const workerSource = await readFile(workerPath, "utf8");
const migration = await readFile(migrationPath, "utf8");
assert.match(workerSource, /withSession\("first-primary"\)/, "actual authority implementation explicitly starts every D1 state read on first-primary");
const migrationSql = migration.split("INSERT OR IGNORE INTO control_registry")[0].replace(/^\s*--.*$/gm, "");
assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS fleet_ai_control/);
assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS fleet_ai_control_audit/);

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = { ...publicKey.export({ format: "jwk" }), kid: "runtime-test-key", alg: "RS256", use: "sig" };
const issuer = "https://qnfo-runtime-test.cloudflareaccess.com";
const audience = "runtime-access-audience";
const ownerEmail = "runtime-owner@example.test";
const now = Math.floor(Date.now() / 1000);
const base64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function jwt(email = ownerEmail, overrides = {}) {
  const header = base64url({ alg: "RS256", kid: key.kid, typ: "JWT" });
  const payload = base64url({ iss: issuer, aud: audience, exp: now + 900, nbf: now - 1, email, email_verified: true, sub: "runtime-subject-1", ...overrides });
  const input = header + "." + payload;
  const signer = createSign("RSA-SHA256"); signer.update(input); signer.end();
  return input + "." + signer.sign(privateKey).toString("base64url");
}
const accessToken = jwt();
let jwksCalls = 0;
const outboundService = async (request) => {
  const url = new URL(request.url);
  assert.equal(url.origin, issuer, "all outbound requests are the local Access JWKS stub");
  assert.equal(url.pathname, "/cdn-cgi/access/certs");
  jwksCalls++;
  return Response.json({ keys: [key] }, { headers: { "content-type": "application/json" } });
};
const callerModule = `export default { async fetch(request, env) { return env.DEPLOY_GUARD.fetch(request); } };`;
const legacyOptions = {
  workers: [
    {
      name: "deploy-guard",
      rootPath: repo,
      scriptPath: workerPath,
      modules: true,
      compatibilityDate: "2026-11-03",
      bindings: { ACCESS_TEAM_DOMAIN: "qnfo-runtime-test.cloudflareaccess.com", ACCESS_AUD: audience, OWNER_EMAILS: ownerEmail },
      d1Databases: { AUDIT: "local-ai-control-authority" },
      outboundService,
    },
    {
      name: "deployment-caller",
      script: callerModule,
      modules: true,
      compatibilityDate: "2026-11-03",
      serviceBindings: { DEPLOY_GUARD: { name: "deploy-guard", props: { caller: "qnfo-fleet-dashboard-ui" } } },
    },
  ],
  logRequests: false,
  telemetry: { enabled: false },
};
const miniflare = new Miniflare(convertV4MiniflareOptions(legacyOptions));
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions++; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions++; }
function noCache(response, label) { equal(response.headers.get("cache-control"), "no-store", label + " no-store"); equal(response.headers.get("access-control-allow-origin"), null, label + " no permissive CORS"); }
async function invoke(path, { method = "GET", body, headers = {}, worker = "deploy-guard" } = {}) {
  const target = await miniflare.getWorker(worker);
  const request = new Request("https://runtime.test" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await target.fetch(request);
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { response, json, text };
}
async function owner(path, method = "GET", body) {
  return invoke(path, { method, body, headers: { "Cf-Access-Jwt-Assertion": accessToken, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) } });
}
try {
  const db = await miniflare.getD1Database("AUDIT", "deploy-guard");
  const migrationStatements = [];
  let currentStatement = "";
  let inTrigger = false;
  for (const line of migrationSql.split(/\r?\n/)) {
    currentStatement += line + "\n";
    if (/^\s*CREATE TRIGGER\b/i.test(line)) inTrigger = true;
    if (inTrigger && /^\s*END;\s*$/.test(line)) {
      migrationStatements.push(currentStatement.trim());
      currentStatement = "";
      inTrigger = false;
    } else if (!inTrigger && /;\s*$/.test(line) && currentStatement.trim()) {
      migrationStatements.push(currentStatement.trim());
      currentStatement = "";
    }
  }
  if (currentStatement.trim()) migrationStatements.push(currentStatement.trim());
  for (const statement of migrationStatements) await db.prepare(statement).run();
  const seeded = await db.prepare("SELECT id, paused, revision, reason, actor FROM fleet_ai_control WHERE id=1").first();
  check(seeded && seeded.id === 1 && seeded.paused === 0 && seeded.revision === 0, "actual migration SQL seeded the D1 singleton running at revision zero");
  const initialAudit = await db.prepare("SELECT COUNT(*) AS n FROM fleet_ai_control_audit").first();
  equal(initialAudit.n, 1, "insert trigger atomically logs initial state");

  const status = await owner("/ai-control");
  equal(status.response.status, 200, "owner status accepted through actual workerd worker");
  check(status.json.ok === true && status.json.paused === false && status.json.revision === 0, "status state");
  noCache(status.response, "status");
  check(jwksCalls === 1, "JWKS fetched from isolated local outbound stub");

  const spoof = await invoke("/ai-control/check", { headers: { "x-cf-worker-caller": "qnfo-fleet-dashboard-ui", "cf-access-authenticated-user-email": ownerEmail } });
  equal(spoof.response.status, 403, "public caller spoof headers denied");
  equal(spoof.json.error, "trusted_service_required", "spoof result");
  noCache(spoof.response, "spoof");

  const pause = await owner("/ai-control/pause", "POST", { reason: "workerd integration emergency pause" });
  equal(pause.response.status, 200, "owner pause accepted");
  check(pause.json.paused && pause.json.revision === 1, "pause increments revision");
  noCache(pause.response, "pause");

  const caller = await invoke("/ai-control/check", { worker: "deployment-caller" });
  equal(caller.response.status, 503, "real service binding ctx.props caller reaches worker while paused");
  check(caller.json.ok === false && caller.json.error === "ai_paused" && caller.json.paused === true && caller.json.revision === 1, "service binding sees paused primary state");
  noCache(caller.response, "trusted paused check");

  const resume = await owner("/ai-control/resume", "POST", { reason: "resume after integration check", expected_revision: 1 });
  equal(resume.response.status, 200, "CAS resume accepted at matching revision");
  check(resume.json.paused === false && resume.json.revision === 2, "resume increments revision and clears pause");
  noCache(resume.response, "resume");
  const runningCheck = await invoke("/ai-control/check", { worker: "deployment-caller" });
  equal(runningCheck.response.status, 200, "trusted service binding check allowed when running");
  check(runningCheck.json.ok && runningCheck.json.paused === false && runningCheck.json.revision === 2, "running check state");

  const secondPause = await owner("/ai-control/pause", "POST", { reason: "second pause defeats stale resume" });
  equal(secondPause.response.status, 200, "second pause accepted");
  equal(secondPause.json.revision, 3, "second pause advanced revision");
  const staleResume = await owner("/ai-control/resume", "POST", { reason: "stale resume must conflict", expected_revision: 2 });
  equal(staleResume.response.status, 409, "stale resume rejected");
  check(staleResume.json.error === "ai_control_conflict" && staleResume.json.state.paused && staleResume.json.state.revision === 3, "stale conflict preserves later pause");
  noCache(staleResume.response, "stale resume");

  const rows = await db.prepare("SELECT revision, paused, reason, actor FROM fleet_ai_control_audit ORDER BY id").all();
  check(JSON.stringify(rows.results.map((row) => row.revision)) === JSON.stringify([0, 1, 2, 3]), "trigger audit records every committed state including both pauses and resume");
  check(rows.results[1].actor === "owner:runtime-subject-1" && rows.results[1].reason === "workerd integration emergency pause", "audit actor and reason");

  await db.exec("DROP TABLE fleet_ai_control");
  const unavailable = await invoke("/ai-control/check", { worker: "deployment-caller" });
  equal(unavailable.response.status, 503, "missing D1 state fails closed through actual worker");
  check(unavailable.json.ok === false && unavailable.json.error === "ai_control_unavailable" && unavailable.json.paused === true, "unavailable response shape");
  noCache(unavailable.response, "unavailable check");

  check(workerSource.includes('withSession("first-primary")'), "backend source uses first-primary for each independently opened state operation");
  check(jwksCalls >= 4, "valid status/pause/resume calls verify Access JWT against local JWKS each time");
  console.log(JSON.stringify({ result: "PASS", assertions, miniflare: packageInfo.version, workerd: workerdInfo.version, node: process.version, jwksCalls, d1: "local workerd D1 with actual migration authority SQL", serviceProps: "serviceBindings props {caller: qnfo-fleet-dashboard-ui} exercised through Worker's fetch", primary: "first-primary session exercised by actual workerd D1; physical replica selection is not exposed by local runtime", production: "no production calls or mutations" }, null, 2));
} finally {
  await miniflare.dispose();
}
