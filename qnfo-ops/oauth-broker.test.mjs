import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handleOAuthBroker, refreshOAuthBrokerTokens } from "./oauth-broker.mjs";

class MemoryD1 {
  records = new Map();

  prepare(sql) {
    let values = [];
    const db = this;
    return {
      bind(...args) {
        values = args;
        return this;
      },
      async run() {
        if (sql.startsWith("INSERT INTO oauth_broker_records")) {
          const [record_id, provider, data_plane, record_type, encrypted_payload, expires_at, updated_at] = values;
          const old = db.records.get(record_id);
          db.records.set(record_id, {
            record_id, provider, data_plane, record_type, encrypted_payload, expires_at,
            lease_until: 0, call_count: old?.call_count || 0,
            last_called_at: old?.last_called_at || null, updated_at
          });
          return { success: true };
        }
        if (sql.startsWith("UPDATE oauth_broker_records SET call_count=call_count+1")) {
          const [last_called_at, record_id] = values;
          const row = db.records.get(record_id);
          if (row) Object.assign(row, { last_called_at, call_count: row.call_count + 1 });
          return { success: true };
        }
        if (sql.startsWith("UPDATE oauth_broker_records SET lease_until=0")) {
          const row = db.records.get(values[0]);
          if (row) row.lease_until = 0;
          return { success: true };
        }
        if (sql.startsWith("DELETE FROM oauth_broker_records WHERE record_type='state'")) {
          for (const [id, row] of db.records) {
            if (row.record_type === "state" && row.expires_at < values[0]) db.records.delete(id);
          }
          return { success: true };
        }
        throw new Error(`Unexpected SQL run: ${sql}`);
      },
      async first() {
        if (sql.startsWith("SELECT record_id")) return db.records.get(values[0]) || null;
        if (sql.startsWith("DELETE FROM oauth_broker_records")) {
          const row = db.records.get(values[0]);
          if (!row || row.record_type !== "state") return null;
          db.records.delete(values[0]);
          return { ...row };
        }
        if (sql.startsWith("UPDATE oauth_broker_records SET lease_until=?1")) {
          const [lease_until, record_id, now] = values;
          const row = db.records.get(record_id);
          if (!row || row.record_type !== "token" || row.lease_until >= now) return null;
          row.lease_until = lease_until;
          return { ...row };
        }
        throw new Error(`Unexpected SQL first: ${sql}`);
      },
      async all() {
        if (sql.startsWith("SELECT record_id")) {
          return { results: [...db.records.values()].filter((row) => row.record_type === "token" && row.lease_until < values[0]).map((row) => ({ ...row })) };
        }
        throw new Error(`Unexpected SQL all: ${sql}`);
      }
    };
  }
}

function makeEnv() {
  return {
    QNFO_AUDIT: new MemoryD1(),
    OPS_ROUTER_AUTH_KEY: "configured-test-key",
    OAUTH_BROKER_ENCRYPTION_KEY: "test-encryption-key-with-at-least-32-bytes",
    OAUTH_BROKER_REDIRECT_URI: "https://broker.example/oauth/callback",
    OAUTH_GOOGLE_CLIENT_ID: "google-client",
    OAUTH_GOOGLE_CLIENT_SECRET: "google-secret",
    OAUTH_GITHUB_CLIENT_ID: "github-client",
    OAUTH_GITHUB_CLIENT_SECRET: "github-secret",
    OAUTH_SLACK_CLIENT_ID: "slack-client",
    OAUTH_SLACK_CLIENT_SECRET: "slack-secret"
  };
}

function request(path, method, body) {
  return new Request(`https://broker.example${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function broker(env, path, method, body, options = {}) {
  const req = request(path, method, body);
  return handleOAuthBroker(req, env, {
    path,
    method,
    authorized: options.authorized ?? true,
    caller: options.caller || ""
  });
}

async function connect(env, provider, plane = "personal") {
  const started = await broker(env, "/oauth/authorize", "POST", { provider, plane });
  assert.equal(started.status, 200);
  const authorizationUrl = new URL((await started.json()).authorization_url);
  const state = authorizationUrl.searchParams.get("state");
  assert.ok(state);
  const callbackUrl = `/oauth/callback?${new URLSearchParams({ state, code: `${provider}-code` })}`;
  const completed = await handleOAuthBroker(new Request(`https://broker.example${callbackUrl}`), env, {
    path: "/oauth/callback", method: "GET"
  });
  assert.equal(completed.status, 200);
  assert.deepEqual(await completed.json(), { ok: true, provider, plane });
  return { authorizationUrl, callbackUrl };
}

test("OAuth authorization is authenticated, state is one-use, and provider tokens are encrypted", async (t) => {
  const env = makeEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ access_token: "google-access", refresh_token: "google-refresh", expires_in: 3600 });
  t.after(() => { globalThis.fetch = originalFetch; });
  const unauthorized = await broker(env, "/oauth/authorize", "POST", { provider: "google", plane: "personal" }, { authorized: false });
  assert.equal(unauthorized.status, 401);

  const { authorizationUrl, callbackUrl } = await connect(env, "google");
  assert.equal(authorizationUrl.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.events.readonly");
  assert.equal(authorizationUrl.searchParams.get("access_type"), "offline");
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), env.OAUTH_BROKER_REDIRECT_URI);
  assert.equal(env.QNFO_AUDIT.records.has(`state:${authorizationUrl.searchParams.get("state")}`), false);

  const tokenRow = env.QNFO_AUDIT.records.get("token:google:personal");
  assert.ok(tokenRow.encrypted_payload.startsWith("v1."));
  assert.equal(tokenRow.encrypted_payload.includes("google-access"), false);
  assert.equal(tokenRow.encrypted_payload.includes("google-refresh"), false);
  assert.equal([...env.QNFO_AUDIT.records.values()].filter((row) => row.record_type === "state").length, 0);

  const replay = await handleOAuthBroker(new Request(`https://broker.example${callbackUrl}`), env, { path: "/oauth/callback", method: "GET" });
  assert.equal(replay.status, 400);
});

test("Google Calendar reads use a refreshed token and meter the provider call", async (t) => {
  const env = makeEnv();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const target = new URL(url);
    calls.push({ target, options });
    if (target.hostname === "oauth2.googleapis.com") {
      const grantType = new URLSearchParams(options.body).get("grant_type");
      return grantType === "refresh_token"
        ? Response.json({ access_token: "google-access-2", expires_in: 3600 })
        : Response.json({ access_token: "google-access-1", refresh_token: "google-refresh", expires_in: 3600 });
    }
    if (target.hostname === "www.googleapis.com") {
      return Response.json({ items: [{ id: "event-1", summary: "Planning", start: { dateTime: "2026-11-03T10:00:00Z" } }] });
    }
    throw new Error("unexpected provider");
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await connect(env, "google");
  const initialToken = env.QNFO_AUDIT.records.get("token:google:personal");
  const baseTime = Date.now();
  const refresh = await refreshOAuthBrokerTokens(env, baseTime + 56 * 60 * 1000);
  assert.deepEqual(refresh, { refreshed: 1, failed: 0 });

  const response = await broker(env, "/oauth/google/calendar", "POST", { plane: "personal" });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items.map((item) => item.id), ["event-1"]);
  const calendarCall = calls.find(({ target }) => target.hostname === "www.googleapis.com");
  assert.equal(calendarCall.options.headers.Authorization, ["Bear", "er ", "google-access-2"].join(""));
  assert.equal(calendarCall.options.redirect, "error");
  assert.ok(env.QNFO_AUDIT.records.get("token:google:personal").call_count === 1);
  assert.notEqual(env.QNFO_AUDIT.records.get("token:google:personal").encrypted_payload, initialToken.encrypted_payload);
});

test("GitHub and Slack use narrow scopes and separate plane records", async (t) => {
  const env = makeEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const target = new URL(url);
    if (target.hostname === "github.com") return Response.json({ access_token: "github-access" });
    if (target.hostname === "api.github.com") {
      assert.equal(options.headers.Authorization, ["Bear", "er ", "github-access"].join(""));
      return Response.json({ login: "qnfo", id: 7 });
    }
    if (target.hostname === "slack.com" && target.pathname === "/api/oauth.v2.access") {
      return Response.json({ ok: true, authed_user: { access_token: "slack-access", refresh_token: "slack-refresh", expires_in: 3600 } });
    }
    if (target.hostname === "slack.com" && target.pathname === "/api/auth.test") {
      assert.equal(options.headers.Authorization, ["Bear", "er ", "slack-access"].join(""));
      return Response.json({ ok: true, team: "Research", user: "Agent" });
    }
    throw new Error("unexpected provider");
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const { authorizationUrl: githubUrl } = await connect(env, "github", "research");
  assert.equal(githubUrl.searchParams.get("scope"), "read:user");
  const githubRead = await broker(env, "/oauth/github/profile", "POST", { plane: "research" });
  assert.equal(githubRead.status, 200);
  assert.deepEqual(await githubRead.json(), { login: "qnfo", id: 7, name: null });

  const { authorizationUrl: slackUrl } = await connect(env, "slack", "research");
  assert.equal(slackUrl.searchParams.get("user_scope"), "users:read");
  const slackRead = await broker(env, "/oauth/slack/profile", "POST", { plane: "research" });
  assert.equal(slackRead.status, 200);
  assert.deepEqual(await slackRead.json(), { ok: true, team: "Research", user: "Agent" });

  const forbidden = await broker(env, "/oauth/authorize", "POST", { provider: "google", plane: "research" }, { caller: "qnfo-fleet-dashboard" });
  assert.equal(forbidden.status, 403);
  assert.ok(env.QNFO_AUDIT.records.has("token:github:research"));
  assert.equal(env.QNFO_AUDIT.records.has("token:github:personal"), false);
  assert.ok(env.QNFO_AUDIT.records.get("token:slack:research").call_count === 1);
});

test("migration keeps only encrypted broker records and enforces provider and plane partitions", async () => {
  const sql = await readFile(new URL("../migrations/2026-11-02-oauth-broker.sql", import.meta.url), "utf8");
  assert.match(sql, /-- APPLY-BY: ci/);
  assert.match(sql, /-- DB: qnfo-audit/);
  assert.match(sql, /encrypted_payload TEXT NOT NULL/);
  assert.match(sql, /CHECK \(data_plane IN \('personal', 'research'\)\)/);
  assert.match(sql, /CHECK \(provider IN \('google', 'github', 'slack'\)\)/);
  assert.doesNotMatch(sql, /\b(access_token|refresh_token)\b/i);
});
