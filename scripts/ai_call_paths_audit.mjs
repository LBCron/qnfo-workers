#!/usr/bin/env node
// scripts/ai_call_paths_audit.mjs: AI-CALL-PATHS-AUDIT-1 (roadmap RM-COST-FREE-FIRST-PARITY-1, pillar cost).
//
// WHAT   Lists every worker directory that can call a model and says which cost path each call takes, so "one cost policy per
//        path" is read from the code instead of from a one-off audit (the 2026-10-01 audit covered 28 workers by hand).
//        Paths: binding (the Workers AI binding, env.AI.run), router (a service binding to qnfo-ai, which meters and prices
//        the call), gateway (gateway.ai.cloudflare.com direct), direct (a provider's own API host).
//        A binding call is metered when the worker wraps its binding with __aiAttrEnv (every call lands in ai_call_counters)
//        or writes ai_call_counters itself. A direct provider call is allowed only in DIRECT_ALLOW, with its reason.
// WHY    ai-attr-cover.test.mjs lists six workers by name, so a new AI-calling worker was never checked; the cost policy of
//        a path nobody listed was nobody's. Cloudflare's meter showed 2.4x the fleet counters on 2026-11-04 because one
//        caller (qnfo-agents) was outside every list. This audit finds callers by what the code does, not by a list.
// USAGE  node scripts/ai_call_paths_audit.mjs [--json]      exit 1 when a worker is outside the policy and not on UNMETERED_BASELINE
//        The baseline only shrinks and expires: a line past its date fails, a line whose worker is metered now is a NOTE (delete it).
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Provider hosts a worker may call itself. Everything else must go through the Workers AI binding, qnfo-ai or the gateway.
export const DIRECT_ALLOW = {
  "qnfo-ai-calibration": "stress-tests the provider by design (RM-COST-UNIFIED-SPEND-1 audit 2026-10-01)",
  "personal-companion": "the personal plane's BYOK writer, at most 5 pieces a day, kept apart under PERSONAL-QNFO-SEPARATION-1",
  "qnfo-ai": "the research gateway: provider routes are its job and it prices every call (spendRecord)",
  "qnfo-ops": "the ops executor's provider ladder; every call lands in cost_router_metrics and the gateway ledger",
};

// Workers that call the Workers AI binding without metering today, each with the issue that closes it and an expiry. SHRINK-ONLY and EXPIRING (the
// shape of scripts/cron-tempo-allowlist.txt): a line past its expiry is a finding whether or not the worker is metered by then, so the list cannot rot.
// A line whose worker has become metered is only a note (stale), so the single-file change that wraps the worker never fails main for leaving this
// file alone, and the next change here removes the line.
export const UNMETERED_BASELINE = {
  "qnfo-model-eval": { expires: "2026-11-12", why: "benchmark calls (6 sites): file claimed by a code-loop task on 2026-11-05, fix filed as AI-METER-COVER-3a (code-task on qnfo-model-eval/worker.js)" },
  "qnfo-fleet-dashboard": { expires: "2026-11-12", why: "ask-panel and cmd calls (2 sites): file claimed by another session on 2026-11-05, fix filed as AI-METER-COVER-3b (code-task on qnfo-fleet-dashboard/worker.js)" },
};

const BINDING_RUN = /\bAI\.run\(/;
const PROVIDER_HOSTS = /api\.deepseek\.com|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.groq\.com|openrouter\.ai|api\.mistral\.ai|api\.together\.xyz/g;
const GATEWAY_HOST = /gateway\.ai\.cloudflare\.com/;
const ATTR_WRAP = /__aiAttrEnv\(/;
const COUNTER_WRITE = /INTO ai_call_counters/;
const LEDGER_WRITE = /INTO ai_spend_ledger/;
const AE_WRITE = /AI_METER\.writeDataPoint|aiMeterPoint\(/;

function retired(dir) { return existsSync(join(dir, "RETIRED")) || existsSync(join(dir, "FOLDED")); }

/** Service bindings named qnfo-ai in a wrangler.toml (a worker that reaches the router). */
function routerBinding(toml) {
  return /\[\[services\]\][^[]*?service\s*=\s*"qnfo-ai"/s.test(toml);
}

/**
 * Reads every <dir>/worker.js under root and classifies how it reaches a model.
 * @param {string} root Repository root.
 * @returns {Array<{dir:string,paths:string[],metered:boolean,meters:string[],direct:string[]}>}
 */
export function auditWorkers(root) {
  const out = [];
  for (const d of readdirSync(root).sort()) {
    if (d.startsWith(".") || d === "node_modules") continue;
    const dir = join(root, d);
    let st; try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory() || retired(dir)) continue;
    const wj = join(dir, "worker.js");
    if (!existsSync(wj)) continue;
    const src = readFileSync(wj, "utf8");
    const tomlPath = join(dir, "wrangler.toml");
    const toml = existsSync(tomlPath) ? readFileSync(tomlPath, "utf8") : "";
    const paths = [];
    if (BINDING_RUN.test(src)) paths.push("binding");
    if (routerBinding(toml)) paths.push("router");
    if (GATEWAY_HOST.test(src)) paths.push("gateway");
    const direct = [...new Set(src.match(PROVIDER_HOSTS) || [])].sort();
    if (direct.length) paths.push("direct");
    if (!paths.length) continue;
    const meters = [];
    if (ATTR_WRAP.test(src)) meters.push("ai_call_counters:wrapper");
    else if (COUNTER_WRITE.test(src)) meters.push("ai_call_counters:own");
    if (LEDGER_WRITE.test(src)) meters.push("ai_spend_ledger");
    if (AE_WRITE.test(src)) meters.push("analytics-engine");
    out.push({ dir: d, paths, metered: meters.length > 0, meters, direct });
  }
  return out;
}

/** Findings against the policy: unmetered binding callers, unlisted direct callers, and stale baseline lines. */
export function findings(rows, opts = {}) {
  const baseline = opts.baseline || UNMETERED_BASELINE, directAllow = opts.directAllow || DIRECT_ALLOW;
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const f = [];
  for (const r of rows) {
    if (r.paths.includes("binding") && !r.metered && !(r.dir in baseline)) f.push({ dir: r.dir, kind: "binding-unmetered", detail: "calls env.AI.run with no __aiAttrEnv wrapper and no ai_call_counters write" });
    if (r.paths.includes("direct") && !(r.dir in directAllow)) f.push({ dir: r.dir, kind: "direct-provider", detail: "calls " + r.direct.join(", ") + " itself; use the binding, qnfo-ai or the gateway, or add the worker to DIRECT_ALLOW with a reason" });
  }
  for (const [d, e] of Object.entries(baseline)) {
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.expires || "")) || !e.why) f.push({ dir: d, kind: "baseline-malformed", detail: "an UNMETERED_BASELINE line needs { expires: YYYY-MM-DD, why }" });
    else if (e.expires < today) f.push({ dir: d, kind: "baseline-expired", detail: "expired " + e.expires + ": wrap the worker with __aiAttrEnv and delete the line (" + e.why + ")" });
  }
  return f;
}

/** Baseline lines that are no longer needed (the worker is metered now, or no longer calls a model). Notes, never failures. */
export function staleBaseline(rows, opts = {}) {
  const baseline = opts.baseline || UNMETERED_BASELINE;
  const byDir = new Map(rows.map((r) => [r.dir, r]));
  const n = [];
  for (const d of Object.keys(baseline)) {
    const r = byDir.get(d);
    if (!r) n.push({ dir: d, detail: "no longer calls a model: delete the line" });
    else if (r.metered) n.push({ dir: d, detail: "metered now: delete the line" });
  }
  return n;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const rows = auditWorkers(root);
  const bad = findings(rows), notes = staleBaseline(rows);
  if (process.argv.includes("--json")) console.log(JSON.stringify({ workers: rows, findings: bad }, null, 1));
  else {
    for (const r of rows) console.log(r.dir.padEnd(28), r.paths.join("+").padEnd(22), (r.meters.join(",") || "UNMETERED").padEnd(44), r.direct.join(","));
    console.log(rows.length + " AI-calling workers, " + rows.filter((r) => r.metered).length + " metered, " + bad.length + " finding(s)");
    for (const x of bad) console.log("FINDING " + x.dir + " [" + x.kind + "] " + x.detail);
    for (const x of notes) console.log("NOTE " + x.dir + " baseline: " + x.detail);
  }
  process.exit(bad.length ? 1 : 0);
}
