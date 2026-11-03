// RM-AUTOROUTER-EVAL-1: bounded, authenticated replay of logged prompts against AI Gateway Auto Router.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "qnfo-ai-autorouter-"));
writeFileSync(join(dir, "worker.mjs"), readFileSync(new URL("./worker.js", import.meta.url), "utf8"));
const worker = (await import(pathToFileURL(join(dir, "worker.mjs")).href)).default;
const checks = [];
const ok = (condition, name, actual) => checks.push({ condition, name, actual });
const rows = [
  { id: "private-email", prompt: "Please email me at user@example.org", response: "Not replayed" },
  ...Array.from({ length: 6 }, (_, i) => ({
    id: "sample-" + i,
    ts: new Date().toISOString(),
    model: "dynamic/value",
    strategy: "ladder",
    complexity: "chat",
    domain: "general",
    prompt: "A safe evaluation prompt " + i,
    response: "Historical answer " + i,
    prompt_tokens: 8,
    completion_tokens: 4,
    cost_usd: 0.01,
    latency_ms: 100,
    streamed: 0
  }))
];
const calls = [];
const events = [];
let failAutoRouter = false;
const waits = [];
const ctx = { props: {}, waitUntil(p) { waits.push(Promise.resolve(p).catch(() => {})); } };
const env = () => ({
  ROUTER_AUTH_KEY: "test-key",
  SPEND_CAP_GATEWAY_USD: "100000",
  SPEND_CAP_TOTAL_USD: "100000",
  QNFO_AUDIT: {
    prepare(sql) {
      const st = { args: [] };
      st.bind = (...args) => { st.args = args; return st; };
      st.all = async () => ({ results: /FROM ai_queries/.test(sql) ? rows : [] });
      st.first = async () => null;
      st.run = async () => {
        if (/INSERT INTO cloud_ops_events/.test(sql)) events.push({ sql, args: st.args });
        return { meta: {} };
      };
      return st;
    }
  },
  AI: {
    async run(model, input, opts) {
      calls.push({ model, input, opts });
      if (failAutoRouter && model === "cloudflare/auto") throw new Error("provider details not returned");
      return {
        model: "openai/gpt-5-mini",
        response: "A comparable evaluation response",
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      };
    }
  }
});
const post = async (body, key = "test-key") => {
  const response = await worker.fetch(new Request("https://ai.test/internal/eval/autorouter-shadow", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(body)
  }), env(), ctx);
  return { status: response.status, json: await response.json() };
};

try {
  let r = await post({ confirm: true }, "wrong-key");
  ok(r.status === 401 && calls.length === 0, "unauthorized requests do not inspect or replay logs", r);
  r = await post({});
  ok(r.status === 400 && calls.length === 0, "prompt replay requires explicit confirmation", r);
  r = await post({ confirm: true, limit: 999 });
  await Promise.all(waits);
  ok(r.status === 200 && r.json.sampled === 5 && r.json.results.length === 5, "a requested limit above five is capped at five", r.json);
  ok(calls.filter((c) => c.model === "cloudflare/auto").length === 5, "only Auto Router is called for sampled records", calls.map((c) => c.model));
  ok(calls.every((c) => c.model === "cloudflare/auto" && c.opts.gateway.id === "default" && c.opts.gateway.cacheTtl === 0), "replays use uncached Cloudflare Auto Router on the existing gateway", calls.map((c) => c.opts));
  ok(calls.every((c) => c.input.messages.length === 1 && !/user@example.org/.test(JSON.stringify(c.input))), "obvious email addresses are excluded and each replay is bounded to one logged prompt");
  ok(events.length === 5 && events.every((e) => e.args[2].indexOf("A safe evaluation prompt") < 0 && !e.args[3].includes("Historical answer")), "event records contain hashes and metrics, not prompts or responses", events);
  ok(r.json.results.every((x) => x.quality_verdict === "unjudged" && x.exact_match === false && x.auto_cost_estimate_usd > 0 && x.cost_delta_usd === Math.round((x.auto_cost_estimate_usd - x.baseline_cost_usd) * 1e6) / 1e6), "quality is not overstated and known model costs are compared with the historical ladder cost", r.json.results);
  ok(r.json.quality_comparison.includes("proxies only"), "quality proxy fields are explicitly labeled", r.json.quality_comparison);

  rows.splice(0, rows.length, { ...rows[1], id: "failed-sample" });
  calls.length = 0;
  events.length = 0;
  failAutoRouter = true;
  r = await post({ confirm: true, limit: 1 });
  await Promise.all(waits);
  ok(r.status === 200 && r.json.results[0].status === "failed" && events.length === 1, "provider errors are recorded without returning provider text", r.json);
  ok(calls.length === 1 && calls[0].model === "cloudflare/auto", "Auto Router failures do not fall back to another model", calls.map((c) => c.model));

  const failed = checks.filter((c) => !c.condition);
  for (const c of failed) console.log("FAIL " + c.name + (c.actual !== undefined ? " :: " + JSON.stringify(c.actual).slice(0, 500) : ""));
  console.log((checks.length - failed.length) + " passed, " + failed.length + " failed");
  process.exitCode = failed.length ? 1 : 0;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
