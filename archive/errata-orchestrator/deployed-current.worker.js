import { WorkflowEntrypoint } from "cloudflare:workers";

// qnfo-errata-orchestrator v1.0.0 (2026-09-02)
// ErrataWorkflow: durable orchestration of the three legacy errata workers via service bindings.
// watch -> respond -> publish. Each step calls the existing worker's /run/* endpoint with
// mode=live (default) or mode=dry, authenticated with the shared X-Erratta-Token.
// Canonical source: QNFO/qnfo-workers/errata-orchestrator/worker.js
const VERSION = "1.0.0";

function json(data, status) {
  if (status === void 0) status = 200;
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

function authorized(request, env) {
  // AUTH-FAIL-CLOSED-1 parity: fail closed if the token binding is missing
  if (!env.ERRATA_TOKEN) return false;
  return (request.headers.get("X-Erratta-Token") || "") === env.ERRATA_TOKEN;
}

async function callRun(env, binding, path, mode) {
  const url = "https://" + binding + "/run/" + path + "?mode=" + mode;
  const res = await env[binding].fetch(url, {
    headers: { "X-Erratta-Token": env.ERRATA_TOKEN || "" }
  });
  let body = null;
  try { body = await res.json(); } catch (e) { body = { parseError: e.message }; }
  return { status: res.status, worker: binding, body };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if ((url.pathname.startsWith("/run/") || url.pathname.startsWith("/debug/")) && !authorized(request, env)) {
      return json({ error: "unauthorized" }, 401);
    }
    if (url.pathname === "/health") {
      return json({
        ok: true, worker: "qnfo-errata-orchestrator", version: VERSION,
        bindings: {
          workflow: !!env.ERRATA_WORKFLOW,
          watch: !!env.ERRATA_WATCH, respond: !!env.ERRATA_RESPOND, publish: !!env.ERRATA_PUBLISH,
          auth: !!env.ERRATA_TOKEN
        },
        workflowClass: "ErrataWorkflow"
      });
    }
    if (url.pathname === "/run/workflow") {
      const mode = url.searchParams.get("mode") || "live";
      const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
      const inst = await env.ERRATA_WORKFLOW.create({
        id: (mode === "dry" ? "dry-" : "run-") + stamp + "-" + Math.random().toString(36).slice(2, 8),
        params: { trigger: "http", mode }
      });
      return json({ ok: true, instance: inst.id, mode, started: true });
    }
    return json({ error: "not found" }, 404);
  }
};

export class ErrataWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const payload = (event && event.payload) || {};
    const schedule = (event && event.schedule) || null;
    const mode = payload.mode || "live";
    const env = this.env;
    const retry = { limit: 3, delay: "5 seconds", backoff: "exponential" };

    const watch = await step.do("watch", { retries: retry, timeout: "150 seconds" }, async () => {
      return await callRun(env, "ERRATA_WATCH", "check", mode);
    });
    const respond = await step.do("respond", { retries: retry, timeout: "300 seconds" }, async () => {
      return await callRun(env, "ERRATA_RESPOND", "respond", mode);
    });
    const publish = await step.do("publish", { retries: retry, timeout: "300 seconds" }, async () => {
      return await callRun(env, "ERRATA_PUBLISH", "publish", mode);
    });

    return {
      ok: true,
      version: VERSION,
      mode,
      trigger: schedule ? "cron:" + schedule.cron : (payload.trigger || "http"),
      steps: {
        watch: { status: watch.status, scanned: (watch.body || {}).scanned, detectedCount: (watch.body || {}).detectedCount, error: (watch.body || {}).error },
        respond: { status: respond.status, processed: (respond.body || {}).processed, error: (respond.body || {}).error },
        publish: { status: publish.status, processed: (publish.body || {}).processed, error: (publish.body || {}).error }
      }
    };
  }
}
