#!/usr/bin/env node
// scripts/agent_loop_replay.mjs: RM-DSH-REPLAY-1 (roadmap row 1804, charter pillar autonomy, cost).
//
// WHAT   Keyless transcript replay for the fleet's agent loops, with one assertion borrowed from the DeepSeek harness
//        (docs/COMPOSIO-INTEGRATION.md section 1): what the model was shown equals what was logged. A transcript is JSONL, one
//        {"model", "request", "response"} object per model call. A replay serves the recorded responses in order and fails at the
//        first call whose model or request differs from the log, naming the path of the first divergence. No network, no secret,
//        no model: a loop that is replayed cannot spend a neuron.
// WHY    A loop's behaviour is a function of what it sends and receives. When the request a loop builds changes (a prompt edit, a
//        reordered tool catalog, a timestamp that crept into the cached prefix) the replay names the field; when it does not,
//        the loop's decisions can be checked against a fixed transcript without a model.
// USAGE  node scripts/agent_loop_replay.mjs <transcript.jsonl> --handler <module.mjs> [--input <input.json>] [--expect <result.json>]
//        The handler module exports default async function run({ ai, fetch, input }) and returns a JSON result. `ai.run(model,
//        request, options)` is the Workers AI binding shape (env.AI.run in qnfo-code-orchestrator ai()); `fetch(url, init)` serves
//        OpenAI-style chat completion bodies for loops that call a model over HTTP. Exit 0 = every call matched and every recorded
//        call was consumed (and the result equals --expect when given); exit 1 = divergence, with the reason on stderr.
// RECORD recordingAI(realAI, sink) and recordingFetch(realFetch, sink) wrap a live client and push entries to `sink`;
//        serializeTranscript(entries) writes them. serializeTranscript refuses an entry that holds a secret-looking string
//        (a transcript holds prompts, so it is as sensitive as the log it came from): scrub with redactEntry first.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export class ReplayDivergence extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "ReplayDivergence";
    this.detail = detail || {};
  }
}

// Stable JSON: object keys sorted, so key order never counts as a divergence.
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) if (value[k] !== undefined) out[k] = canonicalize(value[k]);
    return out;
  }
  return value;
}

// The path of the first difference between two JSON values, or null when they are equal. Paths read like request.messages[1].content.
export function firstDivergence(expected, actual, path = "$") {
  if (expected === actual) return null;
  const te = Array.isArray(expected) ? "array" : expected === null ? "null" : typeof expected;
  const ta = Array.isArray(actual) ? "array" : actual === null ? "null" : typeof actual;
  if (te !== ta) return { path, expected: describe(expected), actual: describe(actual) };
  if (te === "array") {
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
      if (i >= expected.length) return { path: path + "[" + i + "]", expected: "(absent)", actual: describe(actual[i]) };
      if (i >= actual.length) return { path: path + "[" + i + "]", expected: describe(expected[i]), actual: "(absent)" };
      const d = firstDivergence(expected[i], actual[i], path + "[" + i + "]");
      if (d) return d;
    }
    return null;
  }
  if (te === "object") {
    const keys = new Set(Object.keys(expected).concat(Object.keys(actual)));
    for (const k of Array.from(keys).sort()) {
      const e = expected[k], a = actual[k];
      if (e === undefined && a === undefined) continue;
      if (e === undefined) return { path: path + "." + k, expected: "(absent)", actual: describe(a) };
      if (a === undefined) return { path: path + "." + k, expected: describe(e), actual: "(absent)" };
      const d = firstDivergence(e, a, path + "." + k);
      if (d) return d;
    }
    return null;
  }
  return { path, expected: describe(expected), actual: describe(actual) };
}

function describe(v) {
  const s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v === undefined ? null : v);
  return s.length > 120 ? s.slice(0, 117) + "..." : s;
}

// Parse a JSONL transcript. A blank line is skipped; a malformed line or an entry without model/request/response is an error that
// names the line, never a silent skip (a skipped call would shift every later pairing).
export function parseTranscript(text) {
  const entries = [];
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch (e) { throw new ReplayDivergence("transcript line " + (i + 1) + " is not JSON: " + String(e.message).slice(0, 80), { line: i + 1 }); }
    if (!o || typeof o !== "object" || typeof o.model !== "string" || !("request" in o) || !("response" in o)) {
      throw new ReplayDivergence("transcript line " + (i + 1) + " needs model (string), request and response", { line: i + 1 });
    }
    entries.push({ model: o.model, request: o.request, response: o.response });
  }
  return entries;
}

// One cursor over the transcript shared by the ai and fetch clients, so a loop that mixes both is replayed in call order.
export function createReplay(entries) {
  let next = 0;
  const seen = [];
  function take(model, request) {
    if (next >= entries.length) {
      throw new ReplayDivergence("call " + (next + 1) + " has no recorded counterpart: the loop made more model calls than the transcript holds (" + entries.length + ")", { call: next + 1, extra: true });
    }
    const e = entries[next];
    if (e.model !== model) {
      throw new ReplayDivergence("call " + (next + 1) + " model differs: logged " + JSON.stringify(e.model) + ", sent " + JSON.stringify(model), { call: next + 1, path: "$.model" });
    }
    const d = firstDivergence(canonicalize(e.request), canonicalize(request));
    if (d) {
      throw new ReplayDivergence("call " + (next + 1) + " request differs from the log at " + d.path + ": logged " + d.expected + ", sent " + d.actual, { call: next + 1, path: d.path, expected: d.expected, actual: d.actual });
    }
    seen.push({ model, request });
    next += 1;
    return e.response;
  }
  return {
    // Workers AI binding shape: env.AI.run(model, request, options).
    ai: { run: async function (model, request) { return take(model, request === undefined ? null : request); } },
    // fetch shape for OpenAI-style bodies: the model comes from the JSON body, the response is served as JSON.
    fetch: async function (url, init) {
      let body = null;
      try { body = JSON.parse(String((init && init.body) || "null")); } catch (e) { throw new ReplayDivergence("call " + (next + 1) + " fetch body is not JSON", { call: next + 1 }); }
      const model = body && typeof body.model === "string" ? body.model : "";
      const response = take(model, body);
      return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
    },
    // After the loop returns: every recorded call must have been made, else the loop skipped a step the log shows.
    finish() {
      if (next < entries.length) {
        throw new ReplayDivergence("the loop stopped after " + next + " of " + entries.length + " logged calls: call " + (next + 1) + " was never made", { call: next + 1, missing: true });
      }
      return { calls: next };
    },
    seen,
  };
}

const TOKEN_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
];
const SECRET_KEY = /^(?:api[_-]?key|authorization|x-api-key|token|access[_-]?token|password|secret|client[_-]?secret)$/i;

function walk(value, fn) {
  if (Array.isArray(value)) return value.map(function (v) { return walk(v, fn); });
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = typeof value[k] === "string" && SECRET_KEY.test(k) && value[k].length >= 8 && value[k] !== "[REDACTED]" ? fn(value[k], true) : walk(value[k], fn);
    return out;
  }
  return typeof value === "string" ? fn(value, false) : value;
}

// The first secret-looking thing in an entry (a token shape in any string, or a secret-named key holding a value), or null.
export function findSecret(entry) {
  let found = null;
  walk(entry, function (s, keyed) {
    if (found) return s;
    if (keyed) { found = "secret-named key"; return s; }
    for (const p of TOKEN_PATTERNS) { p.lastIndex = 0; if (p.test(s)) { found = p.source.slice(0, 30); break; } }
    return s;
  });
  return found;
}

// Replace secret-looking values with a fixed marker; the entry stays valid JSON with the same shape.
export function redactEntry(entry) {
  return walk(entry, function (s, keyed) {
    if (keyed) return "[REDACTED]";
    let out = s;
    for (const p of TOKEN_PATTERNS) out = out.replace(p, "[REDACTED]");
    return out;
  });
}

export function serializeTranscript(entries) {
  return entries.map(function (e, i) {
    const bad = findSecret(e);
    if (bad) throw new ReplayDivergence("entry " + (i + 1) + " holds a secret-looking string (" + bad + "); run redactEntry first", { entry: i + 1 });
    return JSON.stringify(canonicalize({ model: e.model, request: e.request, response: e.response }));
  }).join("\n") + (entries.length ? "\n" : "");
}

export function recordingAI(realAI, sink) {
  return { run: async function (model, request, options) {
    const response = await realAI.run(model, request, options);
    sink.push({ model, request: JSON.parse(JSON.stringify(request === undefined ? null : request)), response: JSON.parse(JSON.stringify(response === undefined ? null : response)) });
    return response;
  } };
}

export function recordingFetch(realFetch, sink) {
  return async function (url, init) {
    const res = await realFetch(url, init);
    const copy = res.clone();
    let body = null, response = null;
    try { body = JSON.parse(String((init && init.body) || "null")); } catch (e) { body = null; }
    try { response = await copy.json(); } catch (e) { response = null; }
    sink.push({ model: body && typeof body.model === "string" ? body.model : "", request: body, response });
    return res;
  };
}

// Replay one transcript through a handler. Returns {ok, calls, result} or throws ReplayDivergence.
export async function replay(entries, handler, input, expected) {
  const r = createReplay(entries);
  const result = await handler({ ai: r.ai, fetch: r.fetch, input });
  const fin = r.finish();
  if (expected !== undefined) {
    const d = firstDivergence(canonicalize(expected), canonicalize(result === undefined ? null : result));
    if (d) throw new ReplayDivergence("the loop's result differs from the expected result at " + d.path + ": expected " + d.expected + ", got " + d.actual, { path: d.path, result: true });
  }
  return { ok: true, calls: fin.calls, result };
}

async function main(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[++i]; else args._.push(argv[i]);
  }
  if (!args._[0] || !args.handler) {
    console.error("usage: node scripts/agent_loop_replay.mjs <transcript.jsonl> --handler <module.mjs> [--input <input.json>] [--expect <result.json>]");
    return 2;
  }
  const entries = parseTranscript(readFileSync(args._[0], "utf8"));
  const mod = await import(pathToFileURL(resolve(args.handler)).href);
  if (typeof mod.default !== "function") { console.error("handler module must export default async function run({ ai, fetch, input })"); return 2; }
  const input = args.input ? JSON.parse(readFileSync(args.input, "utf8")) : undefined;
  const expected = args.expect ? JSON.parse(readFileSync(args.expect, "utf8")) : undefined;
  try {
    const out = await replay(entries, mod.default, input, expected);
    console.log("agent_loop_replay ok: " + out.calls + " call(s) matched the log");
    return 0;
  } catch (e) {
    if (e instanceof ReplayDivergence) { console.error("agent_loop_replay DIVERGED: " + e.message); return 1; }
    throw e;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).then(function (code) { process.exit(code); }, function (e) { console.error(String(e && e.stack || e)); process.exit(2); });
}
