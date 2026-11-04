import assert from "node:assert/strict";
import test from "node:test";
import worker, { aggregateGatewayCostLogs } from "./worker.js";

test("aggregates only the requested month and flags default gateway spend near its cap", () => {
  const report = aggregateGatewayCostLogs("default", [
    { created_at: "2026-10-01T00:00:00Z", provider: "OpenAI", model: "gpt-x", cost: 144, metadata: { worker: "alpha" } },
    { created_at: "2026-10-31T23:59:59Z", provider: "openai", model: "gpt-x", cost: 1, metadata: "{\"worker_name\":\"beta\"}" },
    { created_at: "2026-10-15T12:00:00Z", provider: "openai", model: "missing-cost", cost: null },
    { created_at: "2026-11-01T00:00:00Z", provider: "openai", model: "gpt-x", cost: 100 },
    { provider: "openai", model: "missing-timestamp", cost: 5 }
  ], "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z");

  assert.equal(report.requests, 3);
  assert.equal(report.cost_usd, 145);
  assert.equal(report.missing_cost_requests, 1);
  assert.equal(report.out_of_window_logs, 1);
  assert.equal(report.invalid_timestamp_logs, 1);
  assert.deepEqual(report.by_provider[0], {
    provider: "openai",
    requests: 3,
    cost_usd: 145,
    cap_usd: 180,
    cap_status: "near-cap"
  });
  assert.deepEqual(report.by_worker.map((entry) => entry.worker), ["alpha", "beta", "unattributed"]);
  assert.equal(report.by_provider_model_worker.length, 3);
});

test("applies the qnfo-infra gateway cap to each provider", () => {
  const report = aggregateGatewayCostLogs("qnfo-infra", [
    { created_at: "2026-10-15T12:00:00Z", provider: "workers_ai", model: "model-y", cost: 50 }
  ], "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z");

  assert.equal(report.by_provider[0].provider, "workers-ai");
  assert.equal(report.by_provider[0].cap_usd, 50);
  assert.equal(report.by_provider[0].cap_status, "over-cap");
});

test("the authenticated report route fetches the requested calendar month from both gateways", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    const gateway = parsed.pathname.split("/").at(-2);
    return new Response(JSON.stringify({
      success: true,
      result: [{ created_at: "2026-10-15T12:00:00Z", provider: "anthropic", model: "model-z", cost: 2, metadata: { worker: "test-worker" } }],
      result_info: { total_count: 1 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://qnfo-infra/gateway-cost-report?month=2026-10", {
      headers: { Authorization: ["Bearer", "test-token"].join(" ") }
    }), { INFRA_TOKEN: "test-token", CF_ACCOUNT: "test-account", CF_TOKEN: "test-token" });
    const report = await response.json();

    assert.equal(response.status, 200);
    assert.equal(report.complete, true);
    assert.deepEqual(calls.map((url) => url.pathname.split("/").at(-2)), ["default", "qnfo-infra"]);
    for (const url of calls) {
      const filters = JSON.parse(url.searchParams.get("filters"));
      assert.deepEqual(filters.map((filter) => filter.value[0]), ["2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"]);
      assert.equal(url.searchParams.get("per_page"), "50");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the report route does not expose upstream error details", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("sensitive upstream response", { status: 403 });
  try {
    const response = await worker.fetch(new Request("https://qnfo-infra/gateway-cost-report?month=2026-10", {
      headers: { Authorization: ["Bearer", "test-token"].join(" ") }
    }), { INFRA_TOKEN: "test-token", CF_ACCOUNT: "test-account", CF_TOKEN: "test-token" });
    const result = await response.json();

    assert.equal(response.status, 502);
    assert.deepEqual(result, { error: "gateway cost report unavailable" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
