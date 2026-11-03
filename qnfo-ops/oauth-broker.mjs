const REFRESH_INTERVAL_MS = 55 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_LEASE_MS = 30 * 1000;
const MAX_BODY_BYTES = 1024;
const PROVIDERS = {
  google: {
    clientId: "OAUTH_GOOGLE_CLIENT_ID",
    clientSecret: "OAUTH_GOOGLE_CLIENT_SECRET",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/calendar.events.readonly"
  },
  github: {
    clientId: "OAUTH_GITHUB_CLIENT_ID",
    clientSecret: "OAUTH_GITHUB_CLIENT_SECRET",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user"
  },
  slack: {
    clientId: "OAUTH_SLACK_CLIENT_ID",
    clientSecret: "OAUTH_SLACK_CLIENT_SECRET",
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scope: "users:read"
  }
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function digestHex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function encryptionKey(env) {
  const secret = String(env.OAUTH_BROKER_ENCRYPTION_KEY || "");
  if (new TextEncoder().encode(secret).length < 32) throw new Error("OAuth broker encryption key is unavailable");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function additionalData(recordId, provider, plane, type) {
  return new TextEncoder().encode([recordId, provider, plane, type].join(":"));
}

async function encryptRecord(env, recordId, provider, plane, type, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv,
    additionalData: additionalData(recordId, provider, plane, type)
  }, await encryptionKey(env), new TextEncoder().encode(JSON.stringify(value)));
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

async function decryptRecord(env, row) {
  try {
    const [version, iv, ciphertext] = String(row.encrypted_payload || "").split(".");
    if (version !== "v1" || !iv || !ciphertext) throw new Error("invalid envelope");
    const plaintext = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: fromBase64Url(iv),
      additionalData: additionalData(row.record_id, row.provider, row.data_plane, row.record_type)
    }, await encryptionKey(env), fromBase64Url(ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("OAuth broker record could not be decrypted");
  }
}

function providerConfig(env, provider) {
  const config = PROVIDERS[provider];
  if (!config || !env[config.clientId] || !env[config.clientSecret]) {
    throw new Error("OAuth provider is not configured");
  }
  return {
    ...config,
    clientId: String(env[config.clientId]),
    clientSecret: String(env[config.clientSecret])
  };
}

function validPlane(value) {
  return value === "personal" || value === "research";
}

function redirectUri(env) {
  const value = String(env.OAUTH_BROKER_REDIRECT_URI || "");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("OAuth callback is not configured");
  }
  if (parsed.protocol !== "https:" || parsed.pathname !== "/oauth/callback" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("OAuth callback is not configured");
  }
  return parsed.toString();
}

function rowId(type, provider, plane) {
  return `${type}:${provider}:${plane}`;
}

async function saveRecord(env, { id, provider, plane, type, value, expiresAt }) {
  const encrypted = await encryptRecord(env, id, provider, plane, type, value);
  await env.QNFO_AUDIT.prepare(
    "INSERT INTO oauth_broker_records (record_id, provider, data_plane, record_type, encrypted_payload, expires_at, lease_until, call_count, last_called_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, NULL, ?7) ON CONFLICT(record_id) DO UPDATE SET encrypted_payload=excluded.encrypted_payload, expires_at=excluded.expires_at, lease_until=0, updated_at=excluded.updated_at"
  ).bind(id, provider, plane, type, encrypted, expiresAt, Date.now()).run();
}

async function selectRecord(env, id) {
  return env.QNFO_AUDIT.prepare(
    "SELECT record_id, provider, data_plane, record_type, encrypted_payload, expires_at, lease_until, call_count, last_called_at FROM oauth_broker_records WHERE record_id=?1"
  ).bind(id).first();
}

async function selectToken(env, provider, plane) {
  const row = await selectRecord(env, rowId("token", provider, plane));
  return row ? { row, value: await decryptRecord(env, row) } : null;
}

function providerTokenFields(provider, response) {
  const userToken = provider === "slack" && response.authed_user ? response.authed_user : response;
  const accessToken = userToken.access_token || response.access_token;
  const refreshToken = userToken.refresh_token || response.refresh_token;
  if (typeof accessToken !== "string" || !accessToken || accessToken.length > 8192) {
    throw new Error("OAuth provider returned no usable token");
  }
  const seconds = Number(response.expires_in || userToken.expires_in || 0);
  return {
    access_token: accessToken,
    refresh_token: typeof refreshToken === "string" && refreshToken.length <= 8192 ? refreshToken : "",
    expires_at: Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : 0
  };
}

async function providerJson(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, redirect: "error" });
    const body = await response.json();
    if (!response.ok || body.ok === false) throw new Error("provider request failed");
    return body;
  } catch {
    throw new Error("OAuth provider request failed");
  }
}

async function exchangeCode(env, provider, code, redirect) {
  const config = providerConfig(env, provider);
  const fields = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirect,
    grant_type: "authorization_code"
  };
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  const body = new URLSearchParams(fields).toString();
  const response = await providerJson(config.tokenUrl, { method: "POST", headers, body });
  return providerTokenFields(provider, response);
}

async function refreshProviderToken(env, provider, token) {
  const config = providerConfig(env, provider);
  if (!token.refresh_token) throw new Error("OAuth refresh token is unavailable");
  const fields = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: token.refresh_token,
    grant_type: "refresh_token"
  };
  const response = await providerJson(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields).toString()
  });
  const refreshed = providerTokenFields(provider, response);
  if (!refreshed.refresh_token) refreshed.refresh_token = token.refresh_token;
  return refreshed;
}

async function consumeState(env, state) {
  const id = `state:${await digestHex(state)}`;
  const row = await env.QNFO_AUDIT.prepare(
    "DELETE FROM oauth_broker_records WHERE record_id=?1 AND record_type='state' RETURNING record_id, provider, data_plane, record_type, encrypted_payload, expires_at"
  ).bind(id).first();
  if (!row || row.expires_at <= Date.now()) return null;
  return decryptRecord(env, row);
}

async function beginAuthorization(request, env, authorized, caller) {
  if (!authorized || !["OPS_ROUTER_AUTH_KEY", "OPS_ROUTER_AUTH_KEY_2", "OPS_CLIENT_KEY", "OPS_OWNER_KEY"].some((key) => env[key])) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  let body;
  try {
    if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) return jsonResponse({ error: "request too large" }, 413);
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return jsonResponse({ error: "request too large" }, 413);
    body = JSON.parse(text);
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  const provider = String(body.provider || "");
  const plane = body.plane;
  if (!PROVIDERS[provider] || !validPlane(plane)) return jsonResponse({ error: "unsupported provider or data plane" }, 400);
  if (caller === "qnfo-fleet-dashboard" && plane !== "personal") return jsonResponse({ error: "data plane is not available to this caller" }, 403);
  try {
    const config = providerConfig(env, provider);
    const redirect = redirectUri(env);
    const stateBytes = crypto.getRandomValues(new Uint8Array(32));
    const state = base64Url(stateBytes);
    const now = Date.now();
    await saveRecord(env, {
      id: `state:${await digestHex(state)}`,
      provider,
      plane,
      type: "state",
      value: { provider, plane, redirect },
      expiresAt: now + STATE_TTL_MS
    });
    const url = new URL(config.authorizeUrl);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", redirect);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    if (provider === "slack") url.searchParams.set("user_scope", config.scope);
    else url.searchParams.set("scope", config.scope);
    if (provider === "google") {
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
    }
    return jsonResponse({ authorization_url: url.toString(), expires_at: now + STATE_TTL_MS });
  } catch {
    return jsonResponse({ error: "OAuth provider is not ready" }, 503);
  }
}

async function completeAuthorization(request, env, url) {
  const state = url.searchParams.get("state") || "";
  if (!state || state.length > 256) return jsonResponse({ error: "invalid or expired OAuth state" }, 400);
  let pending;
  try {
    pending = await consumeState(env, state);
  } catch {
    return jsonResponse({ error: "OAuth callback could not be completed" }, 503);
  }
  if (!pending) return jsonResponse({ error: "invalid or expired OAuth state" }, 400);
  if (url.searchParams.has("error") || !url.searchParams.get("code")) {
    return jsonResponse({ error: "OAuth consent was not completed" }, 400);
  }
  const code = url.searchParams.get("code");
  if (code.length > 4096) return jsonResponse({ error: "invalid OAuth callback" }, 400);
  try {
    const token = await exchangeCode(env, pending.provider, code, pending.redirect);
    token.last_refresh_at = Date.now();
    token.call_count = 0;
    await saveRecord(env, {
      id: rowId("token", pending.provider, pending.plane),
      provider: pending.provider,
      plane: pending.plane,
      type: "token",
      value: token,
      expiresAt: token.expires_at
    });
    return jsonResponse({ ok: true, provider: pending.provider, plane: pending.plane });
  } catch {
    return jsonResponse({ error: "OAuth token exchange failed" }, 502);
  }
}

async function claimRefresh(env, id, now) {
  return env.QNFO_AUDIT.prepare(
    "UPDATE oauth_broker_records SET lease_until=?1 WHERE record_id=?2 AND record_type='token' AND lease_until < ?3 RETURNING record_id, provider, data_plane, record_type, encrypted_payload, expires_at, lease_until, call_count, last_called_at"
  ).bind(now + REFRESH_LEASE_MS, id, now).first();
}

async function refreshClaimedToken(env, row, now) {
  try {
    const token = await decryptRecord(env, row);
    const refreshed = await refreshProviderToken(env, row.provider, token);
    refreshed.last_refresh_at = now;
    refreshed.call_count = Number(token.call_count || 0);
    await saveRecord(env, {
      id: row.record_id,
      provider: row.provider,
      plane: row.data_plane,
      type: "token",
      value: refreshed,
      expiresAt: refreshed.expires_at
    });
    return refreshed;
  } catch (error) {
    await env.QNFO_AUDIT.prepare("UPDATE oauth_broker_records SET lease_until=0 WHERE record_id=?1").bind(row.record_id).run().catch(() => {});
    throw error;
  }
}

async function accessToken(env, provider, plane) {
  const selected = await selectToken(env, provider, plane);
  if (!selected) throw new Error("OAuth connection is not available");
  const { row } = selected;
  let value = selected.value;
  if (value.expires_at && value.expires_at <= Date.now() + 30 * 1000) {
    if (!value.refresh_token) throw new Error("OAuth access token expired");
    const claimed = await claimRefresh(env, row.record_id, Date.now());
    if (claimed) value = await refreshClaimedToken(env, claimed, Date.now());
    else {
      const current = await selectToken(env, provider, plane);
      if (!current || (current.value.expires_at && current.value.expires_at <= Date.now() + 30 * 1000)) {
        throw new Error("OAuth token refresh is already in progress");
      }
      value = current.value;
    }
  }
  return { row, value };
}

async function readProvider(request, env, provider, plane, caller) {
  if (!validPlane(plane)) return jsonResponse({ error: "unsupported data plane" }, 400);
  if (caller === "qnfo-fleet-dashboard" && plane !== "personal") return jsonResponse({ error: "data plane is not available to this caller" }, 403);
  try {
    const { row, value } = await accessToken(env, provider, plane);
    let endpoint;
    let headers = { Authorization: "Bearer " + value.access_token, Accept: "application/json" };
    if (provider === "google") {
      const params = new URLSearchParams({
        maxResults: "10",
        singleEvents: "true",
        orderBy: "startTime",
        timeMin: new Date().toISOString()
      });
      endpoint = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`;
    } else if (provider === "github") {
      endpoint = "https://api.github.com/user";
      headers = { ...headers, "User-Agent": "qnfo-oauth-broker" };
    } else {
      endpoint = "https://slack.com/api/auth.test";
      headers = { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Bearer " + value.access_token };
    }
    let response;
    try {
      response = await fetch(endpoint, { method: provider === "slack" ? "POST" : "GET", headers, redirect: "error" });
    } catch {
      await env.QNFO_AUDIT.prepare("UPDATE oauth_broker_records SET call_count=call_count+1, last_called_at=?1 WHERE record_id=?2").bind(Date.now(), row.record_id).run();
      return jsonResponse({ error: "OAuth provider read failed" }, 502);
    }
    await env.QNFO_AUDIT.prepare("UPDATE oauth_broker_records SET call_count=call_count+1, last_called_at=?1 WHERE record_id=?2").bind(Date.now(), row.record_id).run();
    if (!response.ok) return jsonResponse({ error: "OAuth provider read failed" }, 502);
    const result = await response.json().catch(() => null);
    if (!result || result.ok === false) return jsonResponse({ error: "OAuth provider read failed" }, 502);
    if (provider === "google") {
      return jsonResponse({
        items: (Array.isArray(result.items) ? result.items : []).slice(0, 10).map((item) => ({
          id: String(item.id || "").slice(0, 200),
          summary: String(item.summary || "").slice(0, 500),
          start: item.start || null,
          end: item.end || null,
          status: String(item.status || "").slice(0, 40)
        }))
      });
    }
    if (provider === "github") {
      return jsonResponse({ login: result.login || null, id: result.id || null, name: result.name || null });
    }
    return jsonResponse({ ok: true, team: result.team || null, user: result.user || null });
  } catch {
    return jsonResponse({ error: "OAuth connection is unavailable" }, 503);
  }
}

export async function handleOAuthBroker(request, env, { path, method, authorized, caller = "" }) {
  if (!path.startsWith("/oauth/")) return null;
  if (!env.QNFO_AUDIT) return jsonResponse({ error: "OAuth broker storage is unavailable" }, 503);
  if (method === "POST" && path === "/oauth/authorize") {
    return beginAuthorization(request, env, authorized, caller);
  }
  if (method === "GET" && path === "/oauth/callback") {
    return completeAuthorization(request, env, new URL(request.url));
  }
  const match = path.match(/^\/oauth\/(google\/calendar|github\/profile|slack\/profile)$/);
  if (method === "POST" && match) {
    if (!authorized || !["OPS_ROUTER_AUTH_KEY", "OPS_ROUTER_AUTH_KEY_2", "OPS_CLIENT_KEY", "OPS_OWNER_KEY"].some((key) => env[key])) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    let body;
    try {
      if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) return jsonResponse({ error: "request too large" }, 413);
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return jsonResponse({ error: "request too large" }, 413);
      body = JSON.parse(text);
    } catch {
      return jsonResponse({ error: "invalid JSON body" }, 400);
    }
    const [provider, operation] = match[1].split("/");
    if (operation === "profile" || operation === "calendar") return readProvider(request, env, provider, body.plane, caller);
  }
  return jsonResponse({ error: "not found" }, 404);
}

export async function refreshOAuthBrokerTokens(env, now = Date.now()) {
  if (!env.QNFO_AUDIT) return { refreshed: 0, failed: 0 };
  await env.QNFO_AUDIT.prepare("DELETE FROM oauth_broker_records WHERE record_type='state' AND expires_at < ?1").bind(now).run();
  const result = await env.QNFO_AUDIT.prepare(
    "SELECT record_id, provider, data_plane, record_type, encrypted_payload, expires_at, lease_until, call_count, last_called_at FROM oauth_broker_records WHERE record_type='token' AND lease_until < ?1"
  ).bind(now).all();
  let refreshed = 0;
  let failed = 0;
  for (const row of result.results || []) {
    try {
      const token = await decryptRecord(env, row);
      if (!token.refresh_token || now - Number(token.last_refresh_at || 0) < REFRESH_INTERVAL_MS) continue;
      const claimed = await claimRefresh(env, row.record_id, now);
      if (!claimed) continue;
      await refreshClaimedToken(env, claimed, now);
      refreshed++;
    } catch {
      failed++;
    }
  }
  return { refreshed, failed };
}
