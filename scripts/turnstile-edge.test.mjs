// TURNSTILE-EDGE-1 / OTP-DO-RATE-1 (BP26-EDGE-SECURITY-1): the shared Turnstile block is identical in every worker that serves a public form, behaves as specified
// (fail-open ONLY while the secret binding is absent, fail-closed once it is bound), and each form's page carries the widget the BP26 collector looks for.
// Run: node scripts/turnstile-edge.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x) : "")); } };
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const BLOCK_RX = /\/\/ BEGIN TURNSTILE-EDGE-1\n[\s\S]*?\/\/ END TURNSTILE-EDGE-1\n/;

const snippet = read("scripts/turnstile-edge.snippet.js");
const block = (BLOCK_RX.exec(snippet) || [])[0];
ok(!!block, "the snippet file carries the marked block");

// every worker that serves a public form carries the block verbatim, and its deployed mirror is identical
const WORKERS = ["idea-hub", "qnfo-ipatent", "qnfo-ai-search", "qnfo-fleet-dashboard", "personal-companion", "q08-signal-engine"];
for (const w of WORKERS) {
  const src = read(w + "/worker.js");
  ok(src.includes(block), w + ": carries the shared Turnstile block unchanged");
  ok(src === read(w + "/deployed-current.worker.js"), w + ": deployed-current.worker.js mirrors worker.js");
  ok((src.match(/\/\/ BEGIN TURNSTILE-EDGE-1/g) || []).length === 1, w + ": exactly one copy");
  ok(/turnstileVerify\(env,/.test(src), w + ": a handler calls turnstileVerify");
  ok(/turnstileWidget\(/.test(src.replace(block, "")), w + ": a page renders the widget");
}
ok(/\/\/ BEGIN TURNSTILE-EDGE-1/.test(read("personal-companion/travel.js")), "personal-companion: the source module travel.js carries the block (worker.js is generated from it)");

// the block holds no secret value: a sitekey is public, TURNSTILE_SECRET is read from the environment only
ok(/TURNSTILE_SITEKEY_DEFAULT = "0x4[A-Za-z0-9_-]{15,40}"/.test(block), "the default sitekey is a public 0x4... key");
ok(!/secret\s*[:=]\s*["'][^"']{8,}["']/i.test(block), "no literal secret in the block");
ok(/env\.TURNSTILE_SECRET/.test(block) && !/TURNSTILE_SECRET\s*=\s*["']/.test(block), "the secret is only read from env");
ok(/^[\x00-\x7f]*$/.test(block), "the block is ASCII (the deploy uploads Latin-1)");

// behaviour
async function run(env, token, ip, action, fetchImpl) {
  const ctx = { URLSearchParams, AbortSignal, JSON, String, Promise, fetch: fetchImpl || (async () => { throw new Error("no network in this test"); }) };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  ctx.__env = env; ctx.__token = token; ctx.__ip = ip; ctx.__action = action;
  return await vm.runInContext("turnstileVerify(__env, __token, __ip, __action)", ctx);
}
const calls = [];
const good = async (url, init) => { calls.push({ url, body: String(init.body) }); return { ok: true, json: async () => ({ success: true, action: "a1", hostname: "x" }) }; };
let r = await run({}, undefined, "1.1.1.1", "a1");
ok(r.ok === true && r.skipped === true, "no TURNSTILE_SECRET: fail-open (deploy order is safe)", r);
r = await run(null, "", "", "a1");
ok(r.ok === true && r.skipped === true, "no env at all: fail-open", r);
r = await run({ TURNSTILE_SECRET: "s" }, undefined, "", "a1");
ok(r.ok === false && r.reason === "missing-token", "secret bound, no token: refused", r);
r = await run({ TURNSTILE_SECRET: "s" }, "x".repeat(2049), "", "a1");
ok(r.ok === false, "secret bound, oversized token: refused", r);
r = await run({ TURNSTILE_SECRET: "s" }, "tok", "9.9.9.9", "a1", good);
ok(r.ok === true && r.reason === "verified", "secret bound, valid token: accepted", r);
ok(calls.length === 1 && calls[0].url === "https://challenges.cloudflare.com/turnstile/v0/siteverify" && /secret=s/.test(calls[0].body) && /response=tok/.test(calls[0].body) && /remoteip=9\.9\.9\.9/.test(calls[0].body), "siteverify gets secret, response and remoteip", calls);
r = await run({ TURNSTILE_SECRET: "s" }, "tok", "", "other", good);
ok(r.ok === false && r.reason === "action-mismatch", "a token minted for another action is refused", r);
r = await run({ TURNSTILE_SECRET: "s" }, "tok", "", "a1", async () => ({ ok: true, json: async () => ({ success: false, "error-codes": ["timeout-or-duplicate"] }) }));
ok(r.ok === false && /rejected/.test(r.reason), "a rejected or replayed token is refused", r);
r = await run({ TURNSTILE_SECRET: "s" }, "tok", "", "a1", async () => ({ ok: false, status: 503, json: async () => ({}) }));
ok(r.ok === false, "siteverify HTTP error: fail-closed once the secret is bound", r);
r = await run({ TURNSTILE_SECRET: "s" }, "tok", "", "a1");
ok(r.ok === false && r.reason === "siteverify-error", "siteverify unreachable: fail-closed once the secret is bound", r);

// widget markup is what scripts/bp26_web.py TURNSTILE_RX detects
{
  const ctx = { String };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  const w = vm.runInContext('turnstileWidget(null, "my action!")', ctx);
  ok(/class="cf-turnstile"/.test(w) && /data-sitekey="0x4/.test(w) && /data-action="myaction"/.test(w), "widget markup: cf-turnstile div with sitekey and a sanitised action", w);
  ok(/data-appearance="interaction-only"/.test(w), "widget is invisible unless a challenge is needed");
  const w2 = vm.runInContext('turnstileWidget({TURNSTILE_SITEKEY:"0x4OVERRIDE"}, "a")', ctx);
  ok(/data-sitekey="0x4OVERRIDE"/.test(w2), "TURNSTILE_SITEKEY overrides the default");
  ok(/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/.test(vm.runInContext("TURNSTILE_SCRIPT", ctx)), "the api.js script tag is the official one");
}

// the dashboard's OTP rate limiter: per-address sliding window, fail-open without the binding
{
  const src = read("qnfo-fleet-dashboard/worker.js");
  ok(/OTP_LIMITER/.test(read("qnfo-fleet-dashboard/wrangler.toml")) && /\[exports\.OtpRateLimiter\]/.test(read("qnfo-fleet-dashboard/wrangler.toml")), "dashboard wrangler.toml declares the OTP_LIMITER binding and the sqlite class");
  ok(/export \{\s*worker_default as default,\s*OtpRateLimiter\s*\}/.test(src), "dashboard exports the OtpRateLimiter class");
  for (const scope of ["cmd-code", "cmd-verify", "owner-login"]) ok(src.includes('otpRateLimit(env, request, "' + scope + '"'), "dashboard limits " + scope);
  const a = src.indexOf("var OtpRateLimiter = class"), b = src.indexOf("function otpLimited");
  ok(a > 0 && b > a, "limiter source located");
  const store = new Map();
  const ctx = { Response, Request, Date, Math, Number, JSON, Promise };
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b), ctx);
  const state = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, setAlarm: async () => {}, deleteAll: async () => store.clear() } };
  ctx.__state = state;
  vm.runInContext("var __rl = new OtpRateLimiter(__state)", ctx);
  const hit = async (limit, win) => (await vm.runInContext("__rl", ctx).fetch(new Request("https://x/hit", { method: "POST", body: JSON.stringify({ limit, window_ms: win }) }))).json();
  const out = [];
  for (let i = 0; i < 7; i++) out.push((await hit(5, 600000)).ok);
  ok(out.slice(0, 5).every(Boolean) && out[5] === false && out[6] === false, "five hits pass, the sixth and seventh are refused", out);
  const blocked = await hit(5, 600000);
  ok(blocked.ok === false && blocked.retry_after_ms > 0, "a refusal carries retry_after_ms", blocked);
  const noBinding = vm.runInContext('otpRateLimit({}, new Request("https://x/"), "s", 5, 1000)', ctx);
  ok((await noBinding).ok === true, "no OTP_LIMITER binding: fail-open (the D1 counters still apply)");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
