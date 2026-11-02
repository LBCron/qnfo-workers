// GH-WEBHOOK-INTAKE-1 (#1627, pillar autonomy): complete the existing receiver's
// registration through the settings runner, never through a session credential.
import { randomBytes } from "node:crypto";

export const WEBHOOK_URL = "https://qnfo-fleet-control.q08.workers.dev/gh/webhook";
export const WEBHOOK_EVENTS = ["pull_request", "check_suite", "push"];
const GUARD = "https://qnfo-deploy-guard.q08.workers.dev";
const WORKER = "qnfo-fleet-control";
const HOOKS = "/repos/QNFO/qnfo-workers/hooks";

function matches(hook) {
  return hook?.name === "web" && hook.active === true &&
    hook.config?.url === WEBHOOK_URL && hook.config?.content_type === "json" &&
    String(hook.config?.insecure_ssl) === "0" &&
    JSON.stringify([...(hook.events || [])].sort()) === JSON.stringify([...WEBHOOK_EVENTS].sort());
}

export async function setupWebhook(api, mode, fetchImpl, env, options = {}) {
  const sensitive = [env.GH_ADMIN_TOKEN, env.GITHUB_TOKEN, env.CLOUDFLARE_API_TOKEN].filter(Boolean);
  const scrub = (value) => {
    let text = JSON.stringify(value);
    for (const secret of sensitive) text = text.split(secret).join("[redacted]");
    return JSON.parse(text);
  };
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  let lease;
  const checkLease = () => {
    if (!lease || Date.parse(lease.expires_at) <= now() + 15000 || !Number.isFinite(Date.parse(lease.expires_at))) {
      throw new Error("webhook secret lease is missing or expiring; no further writes");
    }
  };
  const request = async (url, method = "GET", body, headers = {}) => {
    if (method === "PUT") checkLease();
    const response = await fetchImpl(url, {
      method, redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (response.status < 200 || response.status >= 300 || data.success === false) {
      throw new Error(`${method} ${url}: ${response.status} ${data.message || (data.errors ? JSON.stringify(data.errors) : text)}`);
    }
    return data;
  };
  const github = async (method, path, body) => {
    if (method !== "GET") checkLease();
    const response = await api.call(method, path, body);
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${response.message}`);
    return response.body;
  };
  const findHooks = async () => {
    const hooks = [];
    for (let page = 1; ; page++) {
      const batch = await github("GET", `${HOOKS}?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error("malformed hook list");
      hooks.push(...batch.filter((hook) => hook.config?.url === WEBHOOK_URL));
      if (batch.length < 100) return hooks;
      if (page >= 10) throw new Error("hook list exceeds bounded scan; nothing changed");
    }
  };
  const waitFor = async (predicate) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const status = await request(WEBHOOK_URL);
      if (predicate(status)) return status;
      if (attempt < 5) await sleep(5000);
    }
    throw new Error("receiver verification timed out; keep issue 2582 open");
  };
  const waitForTestDelivery = async (id, started, previousIds) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const deliveries = await github("GET", `${HOOKS}/${id}/deliveries?per_page=100`);
      if (!Array.isArray(deliveries)) throw new Error("malformed GitHub webhook delivery list");
      const delivery = deliveries.find((item) => {
        const deliveredAt = Date.parse(item?.delivered_at);
        return item?.event === "ping" && !previousIds.has(String(item.id)) &&
          Number.isFinite(deliveredAt) && deliveredAt >= started - 1000 && deliveredAt <= now();
      });
      if (delivery) {
        if (Number(delivery.status_code) !== 200) {
          throw new Error(`GitHub test delivery returned HTTP ${delivery.status_code}`);
        }
        return delivery;
      }
      if (attempt < 5) await sleep(5000);
    }
    throw new Error("GitHub test delivery verification timed out; keep issue 2582 open");
  };
  let result;
  try {
    if (!["dry", "live"].includes(mode)) throw new Error("mode must be dry or live");
    const hooks = await findHooks();
    if (hooks.length > 1) throw new Error("multiple hooks use the receiver URL; nothing changed");
    const hook = hooks[0];
    if (hook && (!Number.isSafeInteger(hook.id) || hook.id <= 0 || hook.name !== "web")) {
      throw new Error("unexpected hook identity; nothing changed");
    }
    const before = await request(WEBHOOK_URL);
    if (before.route !== "gh-webhook-intake" || typeof before.configured !== "boolean") {
      throw new Error("unexpected receiver status; nothing changed");
    }
    const desired = {
      name: "web", active: true, events: WEBHOOK_EVENTS,
      config: { url: WEBHOOK_URL, content_type: "json", insecure_ssl: "0" }
    };
    if (mode === "dry") return { ok: true, action: "gh-webhook", mode, configured: before.configured, hook_id: hook?.id || null, desired };
    if (!env.GH_ADMIN_TOKEN) throw new Error("no GH_ADMIN_TOKEN; nothing changed");
    const installSecret = !before.configured || !hook || !hook.active;
    if (installSecret && (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || "") || !env.CLOUDFLARE_API_TOKEN)) {
      throw new Error("webhook secret installation needs the runner's Cloudflare account and token; nothing changed");
    }
    lease = await request(`${GUARD}/secret-lock/acquire`, "POST", {
      worker: WORKER, owner: `github-settings-${env.GITHUB_RUN_ID || "local"}`, ttl_sec: 300
    });
    if (!lease.acquired || typeof lease.token !== "string" || !lease.token) {
      lease = null;
      throw new Error("webhook secret lease not acquired; nothing changed");
    }
    sensitive.push(lease.token);
    // Re-read after acquiring: another setup may have completed while we waited.
    const currentHooks = await findHooks();
    if (currentHooks.length !== hooks.length || currentHooks[0]?.id !== hook?.id) {
      throw new Error("webhook state changed during setup; rerun after the lease is released");
    }
    const currentHook = hook ? await github("GET", `${HOOKS}/${hook.id}`) : null;
    const current = await request(WEBHOOK_URL);
    if (current.configured !== before.configured || (currentHook && (currentHook.name !== "web" || currentHook.config?.url !== WEBHOOK_URL))) {
      throw new Error("webhook state changed during setup; rerun after the lease is released");
    }
    let id = hook?.id;
    if (installSecret) {
      const cf = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER}`;
      const headers = { Authorization: "Bearer " + env.CLOUDFLARE_API_TOKEN };
      await request(`${cf}/settings`, "GET", undefined, headers);
      const secret = randomBytes(32).toString("hex");
      sensitive.push(secret);
      // Stage an inactive hook first: a refused registration never changes the
      // Worker, and a partial setup can be safely resumed without reading secrets.
      const staged = await github(hook ? "PATCH" : "POST", hook ? `${HOOKS}/${id}` : HOOKS, {
        ...desired, active: false, config: { ...desired.config, secret }
      });
      id = staged?.id;
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("GitHub returned an invalid hook id");
      await request(`${cf}/secrets`, "PUT", { name: "GH_WEBHOOK_SECRET", type: "secret_text", text: secret }, headers);
      await waitFor((status) => status.configured === true);
    }
    if (installSecret || !matches(currentHook)) await github("PATCH", `${HOOKS}/${id}`, desired);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("GitHub returned an invalid hook id");
    const after = await github("GET", `${HOOKS}/${id}`);
    if (!matches(after)) throw new Error("GitHub hook read-back does not match the requested configuration");
    const priorDeliveries = await github("GET", `${HOOKS}/${id}/deliveries?per_page=100`);
    if (!Array.isArray(priorDeliveries)) throw new Error("malformed GitHub webhook delivery list");
    const priorDeliveryIds = new Set(priorDeliveries.map((delivery) => String(delivery?.id)));
    const started = now();
    await github("POST", `${HOOKS}/${id}/tests`);
    const delivered = await waitForTestDelivery(id, started, priorDeliveryIds);
    result = { ok: true, action: "gh-webhook", mode, hook_id: id, verified_delivery_at: delivered.delivered_at, verified_delivery_status: Number(delivered.status_code), poll_kept_as_second_path: true };
  } catch (error) {
    result = { ok: false, action: "gh-webhook", mode, error: String(error.message || error) };
  } finally {
    if (lease) {
      try {
        const released = await request(`${GUARD}/secret-lock/release`, "POST", { worker: WORKER, token: lease.token });
        if (released.released !== true) throw new Error("webhook secret lease release was not confirmed");
      } catch (error) {
        result = { ...result, ok: false, release_error: String(error.message || error) };
      }
    }
  }
  return scrub(result);
}
