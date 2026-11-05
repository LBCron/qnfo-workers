// FLEET-AI-CONTROL-1: inlined by scripts/fleet-ai-control-sync.mjs; no cached allows.
function fleetAiStopped(error) {
  return !!error && (error.code === "ai_paused" || error.code === "ai_control_unavailable");
}
async function fleetAiAssert(env) {
  var timeoutId;
  try {
    var db = env && env[FLEET_AI_AUDIT_BINDING];
    if (!db || typeof db.withSession !== "function") throw new Error("primary audit session unavailable");
    var row = await Promise.race([
      db.withSession("first-primary").prepare("SELECT paused, revision FROM fleet_ai_control WHERE id=1").first(),
      new Promise(function (_, reject) { timeoutId = setTimeout(function () { reject(new Error("AI control read timed out")); }, 3000); })
    ]);
    if (!row || (row.paused !== 0 && row.paused !== 1) || !Number.isSafeInteger(row.revision) || row.revision < 0) {
      throw new Error("invalid or uninitialized AI control state");
    }
    if (row.paused === 1) {
      var paused = new Error("Owner has paused fleet AI");
      paused.code = "ai_paused";
      paused.retryable = false;
      throw paused;
    }
  } catch (error) {
    if (fleetAiStopped(error)) throw error;
    console.error(JSON.stringify({ event: "ai_control_unavailable", error: String(error && error.message || error) }));
    var unavailable = new Error("AI dispatch refused: emergency control unavailable");
    unavailable.code = "ai_control_unavailable";
    unavailable.retryable = false;
    throw unavailable;
  } finally {
    clearTimeout(timeoutId);
  }
}
async function fleetAiRun(env, binding, ...args) {
  await fleetAiAssert(env);
  return binding.run(...args);
}
function fleetAiBillableUrl(input) {
  var url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  var host = url.hostname.toLowerCase();
  return /(^|\.)gateway\.ai\.cloudflare\.com$/.test(host)
    || /^(api\.(deepseek|openai|anthropic|groq|together|cerebras|mistral)\.(com|ai)|openrouter\.ai|generativelanguage\.googleapis\.com|[a-z0-9-]+-aiplatform\.googleapis\.com)$/.test(host)
    || (host === "api.cloudflare.com" && /\/(ai\/(run|v1)|autorag|ai-search|browser-rendering)\//.test(url.pathname));
}
async function fleetAiFetch(env, fetcher, input, init) {
  if (fleetAiBillableUrl(input)) {
    await fleetAiAssert(env);
    if (new URL(typeof input === "string" || input instanceof URL ? input : input.url).hostname === "gateway.ai.cloudflare.com") {
      var request = new Request(input, init);
      var headers = new Headers(request.headers);
      if (!headers.has("cf-aig-metadata")) headers.set("cf-aig-metadata", JSON.stringify({ worker: FLEET_AI_WORKER }));
      var tagged = new Request(request, { headers: headers });
      var response = fleetAiCheckedResponse(await fetcher(tagged.clone()));
      for (var attempt = 1; response && [502, 503, 504].includes(response.status) && attempt <= 2; attempt++) {
        await new Promise(resolve => setTimeout(resolve, Math.min(1000 * attempt, 2000) + Date.now() % 250));
        await fleetAiAssert(env);
        try {
          response = fleetAiCheckedResponse(await fetcher(tagged.clone()));
        } catch (error) {
          if (fleetAiStopped(error)) throw error;
          console.error(JSON.stringify({ event: "ai_gateway_retry_failed", error: String(error && error.message || error) }));
          return response;
        }
      }
      return response;
    }
  }
  return fleetAiCheckedResponse(await fetcher(input, init));
}
function fleetAiCheckedResponse(response) {
  var code = response && response.status === 503 && response.headers.get("x-fleet-ai-control");
  if (code === "ai_paused" || code === "ai_control_unavailable") {
    var error = new Error("AI dispatch refused by upstream emergency control");
    error.code = code;
    error.retryable = false;
    throw error;
  }
  return response;
}
async function fleetAiServiceFetch(env, binding, input, init) {
  await fleetAiAssert(env);
  return fleetAiCheckedResponse(await binding.fetch(input, init));
}
async function fleetAiBackground(env) {
  try {
    await fleetAiAssert(env);
    return true;
  } catch (error) {
    if (!fleetAiStopped(error)) throw error;
    console.warn(JSON.stringify({ event: "ai_background_deferred", reason: error.code }));
    return false;
  }
}
function fleetAiResponse(error) {
  return new Response(JSON.stringify({ ok: false, error: error.code, paused: true }), {
    status: 503,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-fleet-ai-control": error.code }
  });
}
async function fleetAiWorkflowWait(env, step, name) {
  for (var check = 0; ; check++) {
    var running = await step.do("ai-control-" + name + "-" + check, { retries: { limit: 0 } }, () => fleetAiBackground(env));
    if (running) return;
    await step.sleep("ai-paused-" + name + "-" + check, "10 minutes");
  }
}
