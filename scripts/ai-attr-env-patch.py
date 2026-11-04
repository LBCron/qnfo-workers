#!/usr/bin/env python3
"""
ai-attr-env-patch.py -- WORKERS-AI-ATTRIBUTION-1 (2026-10-01, agent_issues #1681).

Workers AI spend (209k neurons/24h, 1.07M/7d on 2026-10-01) could not be attributed to a worker:
aiInferenceAdaptiveGroups has no scriptName dimension, binding calls bypass AI Gateway logs, and the
ai_call_counters table (PR 243) covered 10 calls in 24h because only a few call sites used aiRunAttr.

This patch inserts one helper, __aiAttrEnv, into a worker and rebinds `env` at the top of each listed
handler. The helper returns a shallow copy of env whose Workers AI binding is a Proxy: every .run() is
passed through unchanged, then one fail-soft UPSERT records calls, errors, latency, input/output tokens
and neurons into qnfo-audit ai_call_counters (purpose='binding'). Neurons come from the returned usage
tokens and Cloudflare's published per-model rates; when no usage is returned the input is estimated at
chars/4. The original env object is never mutated, and an AI call never fails because of attribution.

Usage: python3 scripts/ai-attr-env-patch.py   (idempotent: skips a worker that already has the marker)
"""
import re
import sys

MARK = "WORKERS-AI-ATTRIBUTION-1"

HELPER = r'''// WORKERS-AI-ATTRIBUTION-1 (2026-10-01, #1681): per-worker Workers AI attribution. Returns a shallow env copy whose AI
// binding records each .run() (calls, errors, ms, tokens, neurons) into qnfo-audit ai_call_counters (purpose 'binding').
// Neurons = usage tokens x Cloudflare's published per-model rates (neurons per M tokens). Fail-soft; env is never mutated.
var __AI_ATTR_RATES = { "@cf/zai-org/glm-5.3": [127273, 400000], "@cf/zai-org/glm-5.3-flash": [13636, 45455], "@cf/nvidia/nemotron-3-120b-a12b": [45455, 136364], "@cf/moonshotai/kimi-k2.6": [86364, 363636], "@cf/moonshotai/kimi-k2.7-code": [86364, 363636], "@cf/openai/gpt-oss-120b": [31818, 68182], "@cf/openai/gpt-oss-20b": [18182, 27273], "@cf/deepseek-ai/deepseek-v4-pro-0813": [120000, 360000], "@cf/deepseek-ai/deepseek-v4-flash-0731": [40000, 120000], "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [26668, 204805], "@cf/qwen/qwen3-30b-a3b-fp8": [4625, 30475], "@cf/qwen/qwen3.8-27b": [40909, 290909], "@cf/baai/bge-base-en-v1.5": [6058, 0], "@cf/baai/bge-small-en-v1.5": [1841, 0], "@cf/baai/bge-large-en-v1.5": [18582, 0] };
function __aiAttrEnv(env, worker, aiKey, dbKey) {
  try {
    if (!env || env.__aiAttr) return env;
    var ai = env[aiKey], db = env[dbKey];
    if (!ai || typeof ai.run !== "function" || !db) return env;
    var wrapped = new Proxy(ai, { get: function (t, p) {
      if (p !== "run") { var v = Reflect.get(t, p); return typeof v === "function" ? v.bind(t) : v; }
      return async function (model, input, opts) {
        var t0 = Date.now(), ok = 1, res;
        try { res = await t.run(model, input, opts); return res; } catch (e) { ok = 0; throw e; }
        finally {
          try {
            var u = res && typeof res === "object" && res.usage || {};
            var chars = 0; try { chars = JSON.stringify(input && (input.messages || input.prompt || input.text) || input || "").length; } catch (e1) {}
            var inTok = Number(u.prompt_tokens || u.input_tokens || 0) || Math.round(chars / 4);
            var outTok = Number(u.completion_tokens || u.output_tokens || 0);
            var r = __AI_ATTR_RATES[String(model)] || [0, 0];
            var neurons = (inTok * r[0] + outTok * r[1]) / 1e6;
            await db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, in_chars, ms, in_tok, out_tok, neurons) VALUES (?1,?2,'binding',?3,1,?4,?5,?6,?7,?8,?9) ON CONFLICT(day, worker, purpose, model) DO UPDATE SET calls=calls+1, errors=errors+excluded.errors, in_chars=in_chars+excluded.in_chars, ms=ms+excluded.ms, in_tok=in_tok+excluded.in_tok, out_tok=out_tok+excluded.out_tok, neurons=neurons+excluded.neurons")
              .bind(new Date().toISOString().slice(0, 10), worker, String(model).slice(0, 120), ok ? 0 : 1, chars, Date.now() - t0, inTok, outTok, neurons).run();
          } catch (e2) {}
        }
      };
    } });
    var copy = Object.assign({}, env);
    copy[aiKey] = wrapped;
    copy.__aiAttr = 1;
    return copy;
  } catch (e) {
    return env;
  }
}
'''

# worker dir -> (worker name, AI binding, audit DB binding, [(handler signature line, env param name)])
TARGETS = {
    "qnfo-research-exec": ("qnfo-research-exec", "AI", "QNFO_AUDIT", ["  async scheduled(event, env, ctx) {", "  async fetch(request, env) {"]),
    "qnfo-ai": ("qnfo-ai", "AI", "QNFO_AUDIT", ["  async fetch(request, env, ctx) {"]),
    "qnfo-ops": ("qnfo-ops", "WAI", "QNFO_AUDIT", ["  async fetch(request, env, ctx) {", "  async scheduled(controller, env, ctx) {", "  async queue(batch, env, ctx) {"]),
    "q08-signal-engine": ("q08-signal-engine", "AI", "AUDIT", ["  async fetch(req, env, ctx) {", "  async scheduled(controller, env, ctx) {"]),
    # AI-METER-COVER-1 (2026-11-04, agent_issues 1001705): the Workers AI meter showed kimi-k2.7-code 6,571, kimi-k2.6 7,599 and
    # gpt-oss-120b 16,313 calls in 7 days against 873, 1,107 and 3,682 in ai_call_counters; on 2026-11-03 the counters held
    # 1.48M of the 3.56M neurons Cloudflare billed (42%). These six workers call env.AI.run with qnfo-audit bound and were never
    # wrapped, so their spend had no named caller and no budget lever could reach it.
    "qnfo-gateway": ("qnfo-gateway", "AI", "AUDIT", ["  async fetch(request, env, ctx) {", "  async scheduled(event, env, ctx) {"]),
    "qnfo-ai-calibration": ("qnfo-ai-calibration", "AI", "QNFO_AUDIT", ["  async fetch(request, env, ctx) {", "  async scheduled(controller, env, ctx) {"]),
    "qnfo-intent-orchestrator": ("qnfo-intent-orchestrator", "AI", "D1", ["  async scheduled(event, env, ctx) {", "  async fetch(request, env, ctx) {"]),
    "qnfo-infra": ("qnfo-infra", "AI", "AUDIT", ["  async scheduled(event, env, ctx) {", "  async fetch(request, env) {"]),
    "qnfo-memory-mcp": ("qnfo-memory-mcp", "AI", "AUDIT", ["  async fetch(request, env) {"]),
    "qnfo-youtube-shorts": ("qnfo-youtube-shorts", "AI", "QNFO_AUDIT", ["  async fetch(request, env, ctx) {", "  async scheduled(event, env, ctx) {"]),
}


def bump(src: str) -> str:
    # Both spellings occur (`var VERSION = "x"` and the minified `var VERSION="x"`); the patch number rises and the suffix is kept.
    m = re.search(r'var VERSION( ?= ?)"(\d+)\.(\d+)\.(\d+)(-[^"]*)?";', src)
    if not m:
        sys.exit("no VERSION")
    new = 'var VERSION%s"%s.%s.%d%s";' % (m.group(1), m.group(2), m.group(3), int(m.group(4)) + 1, m.group(5) or "")
    return src.replace(m.group(0), new, 1)


def main() -> int:
    for d, (name, aikey, dbkey, handlers) in TARGETS.items():
        p = d + "/worker.js"
        s = open(p).read()
        if MARK in s:
            print("skip", d, "(already patched)")
            continue
        for h in handlers:
            # Anchored at a line start: a folded member's handler indented four spaces must not match a two-space signature.
            line = "\n" + h + "\n"
            if s.count(line) != 1:
                sys.exit("%s: handler %r found %d times" % (d, h, s.count(line)))
            s = s.replace(line, line + '    env = __aiAttrEnv(env, "%s", "%s", "%s");\n' % (name, aikey, dbkey))
        i = s.index("export default {") if "export default {" in s else None
        anchor = "var VERSION"
        j = s.index(anchor)
        k = s.index("\n", j) + 1
        s = s[:k] + HELPER + s[k:]
        s = bump(s)
        open(p, "w").write(s)
        print("patched", d)
    return 0


if __name__ == "__main__":
    sys.exit(main())
