// AI-CALL-PATHS-AUDIT-1 (roadmap RM-COST-FREE-FIRST-PARITY-1, pillar cost): the audit finds AI-calling workers by what their code does, and the repository
// passes it. Part 1 runs the audit on small fixture trees (a metered binding caller, an unmetered one, a provider host nobody listed, a stale baseline line).
// Part 2 runs it on this repository: no unmetered Workers AI caller outside the shrink-only baseline, no unlisted provider host, and the discovery is not
// silently empty (the big callers are found).
// Run: node scripts/ai-call-paths-audit.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { auditWorkers, findings, staleBaseline, UNMETERED_BASELINE, DIRECT_ALLOW } from "./ai_call_paths_audit.mjs";

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };

// ---- fixtures
const root = mkdtempSync(join(tmpdir(), "ai-paths-"));
const worker = (dir, js, toml = "", marker = null) => {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, "worker.js"), js);
  if (toml) writeFileSync(join(root, dir, "wrangler.toml"), toml);
  if (marker) writeFileSync(join(root, dir, marker), "x");
};
worker("w-metered", "env = __aiAttrEnv(env, 'w-metered', 'AI', 'DB'); await env.AI.run('m', {});");
worker("w-own", "await env.AI.run('m', {}); await db.prepare(\"INSERT INTO ai_call_counters (day) VALUES (?1)\").run();");
worker("w-bare", "const r = await env.AI.run('m', {});");
worker("w-direct", "await fetch('https://api.deepseek.com/v1/chat/completions');");
worker("w-router", "await env.QNFO_AI.fetch('https://qnfo-ai/v1/chat/completions');", "[[services]]\nbinding = \"QNFO_AI\"\nservice = \"qnfo-ai\"\n");
worker("w-gateway-only", "await fetch('https://gateway.ai.cloudflare.com/v1/a/b/workers-ai');");
worker("w-wai", "const r = await env.WAI.run('m', {});");
worker("w-none", "export default { fetch() { return new Response('hi'); } };");
worker("w-retired", "await env.AI.run('m', {});", "", "RETIRED");
worker("w-folded", "await env.AI.run('m', {});", "", "FOLDED");
worker("w-ledger", "await env.AI.run('m', {}); db.prepare('INSERT INTO ai_spend_ledger (day) VALUES (?1)');");

const rows = auditWorkers(root);
const by = Object.fromEntries(rows.map((r) => [r.dir, r]));
ok(!by["w-none"] && !by["w-retired"] && !by["w-folded"], "a worker with no model call, a RETIRED and a FOLDED directory are not listed", Object.keys(by));
ok(by["w-metered"] && by["w-metered"].metered && by["w-metered"].meters.includes("ai_call_counters:wrapper"), "__aiAttrEnv counts as metered", by["w-metered"]);
ok(by["w-own"] && by["w-own"].metered && by["w-own"].meters.includes("ai_call_counters:own"), "an own ai_call_counters write counts as metered", by["w-own"]);
ok(by["w-bare"] && !by["w-bare"].metered && by["w-bare"].paths.join() === "binding", "a bare env.AI.run is an unmetered binding caller", by["w-bare"]);
ok(by["w-wai"] && by["w-wai"].paths.join() === "binding" && !by["w-wai"].metered, "a binding named WAI is a binding caller too (qnfo-ops)", by["w-wai"]);
ok(by["w-direct"] && by["w-direct"].paths.join() === "direct" && by["w-direct"].direct.join() === "api.deepseek.com", "a provider host is a direct path", by["w-direct"]);
ok(by["w-router"] && by["w-router"].paths.join() === "router", "a service binding to qnfo-ai is a router path", by["w-router"]);
ok(by["w-gateway-only"] && by["w-gateway-only"].paths.join() === "gateway", "gateway.ai.cloudflare.com is a gateway path", by["w-gateway-only"]);
ok(by["w-ledger"] && by["w-ledger"].metered && by["w-ledger"].meters.includes("ai_spend_ledger"), "a ledger write counts as metered", by["w-ledger"]);

const f = findings(rows, { baseline: {}, directAllow: {} });
const kinds = f.map((x) => x.dir + ":" + x.kind).sort();
ok(JSON.stringify(kinds) === JSON.stringify(["w-bare:binding-unmetered", "w-direct:direct-provider", "w-wai:binding-unmetered"]), "findings: the two unmetered binding callers and the unlisted provider host, nothing else", kinds);
const live = { expires: "2999-01-01", why: "AI-METER-COVER-3x" };
ok(findings(rows, { baseline: { "w-bare": live, "w-wai": live }, directAllow: { "w-direct": "y" } }).length === 0, "a baseline line and a DIRECT_ALLOW line each clear their finding");
const exp = findings(rows, { baseline: { "w-bare": { expires: "2026-11-01", why: "old" }, "w-wai": live }, directAllow: { "w-direct": "y" }, today: "2026-11-05" }).map((x) => x.dir + ":" + x.kind);
ok(JSON.stringify(exp) === JSON.stringify(["w-bare:baseline-expired"]), "a baseline line past its date is a finding whether or not the worker was fixed", exp);
const bad2 = findings(rows, { baseline: { "w-bare": { why: "no date" }, "w-wai": live }, directAllow: { "w-direct": "y" } }).map((x) => x.dir + ":" + x.kind);
ok(JSON.stringify(bad2) === JSON.stringify(["w-bare:baseline-malformed"]), "a baseline line without an expiry date is malformed", bad2);
const stale = staleBaseline(rows, { baseline: { "w-bare": live, "w-wai": live, "w-metered": live, "w-gone": live } }).map((x) => x.dir).sort();
ok(JSON.stringify(stale) === JSON.stringify(["w-gone", "w-metered"]), "a baseline line for a metered or vanished worker is a note, not a failure", stale);
ok(findings(rows, { baseline: { "w-bare": live, "w-wai": live, "w-metered": live, "w-gone": live }, directAllow: { "w-direct": "y" } }).length === 0, "so the single-file change that wraps a worker never turns main red");
rmSync(root, { recursive: true, force: true });

// ---- FOLD-KIT-1 members: audited as their own rows, never read as metered because the host wraps its own env
{
  const r2 = mkdtempSync(join(tmpdir(), "ai-paths-fold-"));
  const put = (dir, js) => { mkdirSync(join(r2, dir), { recursive: true }); writeFileSync(join(r2, dir, "worker.js"), js); };
  const block = (name, body) => "// ---- FOLD-KIT-1:" + name + ":BEGIN (WORKER-COUNT-X) ----\nvar " + name.replace(/\W/g, "_") + " = (function () {\n" + body + "\n})();\n// ---- FOLD-KIT-1:" + name + ":END ----\n";
  // the host wraps its own env and calls the model itself; its member calls the model with the raw env
  put("h-bare", "env = __aiAttrEnv(env, 'h-bare', 'AI', 'DB'); await env.AI.run('host', {});\n" + block("m-bare", "async function f(env) { return env.AI.run('member', {}); }"));
  // the member wraps the env it was handed
  put("h-wrapped", "env = __aiAttrEnv(env, 'h-wrapped', 'AI', 'DB'); await env.AI.run('host', {});\n" + block("m-wrapped", "async function f(env) { env = __aiAttrEnv(env, 'm-wrapped', 'AI', 'AUDIT'); return env.AI.run('member', {}); }"));
  // the host makes no model call of its own: only the member row exists, and it is unmetered although the host text holds a wrapper
  put("h-only-member", "function __aiAttrEnv() {}\n" + block("m-only", "async function f(env) { return env.AI.run('member', {}); }"));
  // a member that makes no model call is not listed
  put("h-quiet", "env = __aiAttrEnv(env, 'h-quiet', 'AI', 'DB'); await env.AI.run('host', {});\n" + block("m-quiet", "function f() { return 1; }"));
  // a member that writes its own counters is metered
  put("h-own", "env = __aiAttrEnv(env, 'h-own', 'AI', 'DB'); await env.AI.run('host', {});\n" + block("m-own", "async function f(env) { await env.AI.run('member', {}); db.prepare('INSERT INTO ai_call_counters (day) VALUES (?1)'); }"));
  const fr = auditWorkers(r2), fb = Object.fromEntries(fr.map((r) => [r.dir, r]));
  ok(fb["h-bare:m-bare"] && !fb["h-bare:m-bare"].metered && fb["h-bare:m-bare"].member_of === "h-bare", "an unwrapped member of a wrapped host is an unmetered row of its own", fb["h-bare:m-bare"]);
  ok(fb["h-bare"] && fb["h-bare"].metered, "the host row stays metered by its own wrapper", fb["h-bare"]);
  ok(fb["h-wrapped:m-wrapped"] && fb["h-wrapped:m-wrapped"].metered && fb["h-wrapped:m-wrapped"].meters.includes("ai_call_counters:wrapper"), "a member that wraps the env it is handed is metered", fb["h-wrapped:m-wrapped"]);
  ok(fb["h-only-member:m-only"] && !fb["h-only-member:m-only"].metered, "a wrapper elsewhere in the host text does not meter the member", fb["h-only-member:m-only"]);
  ok(!fb["h-only-member"], "a host whose only model call is in its member has no row of its own", Object.keys(fb));
  ok(!fb["h-quiet:m-quiet"] && fb["h-quiet"], "a member with no model call is not listed; the host is", Object.keys(fb));
  ok(fb["h-own:m-own"] && fb["h-own:m-own"].metered && fb["h-own:m-own"].meters.includes("ai_call_counters:own"), "a member's own ai_call_counters write counts as metered", fb["h-own:m-own"]);
  const fk = findings(fr, { baseline: {}, directAllow: {} }).map((x) => x.dir + ":" + x.kind).sort();
  ok(JSON.stringify(fk) === JSON.stringify(["h-bare:m-bare:binding-unmetered", "h-only-member:m-only:binding-unmetered"]), "findings: the two unmetered members, nothing else", fk);
  ok(findings(fr, { baseline: { "h-bare:m-bare": { expires: "2999-01-01", why: "AI-METER-COVER-3a" }, "h-only-member:m-only": { expires: "2999-01-01", why: "x" } }, directAllow: {} }).length === 0, "a baseline line named <host>:<member> clears a member's finding");
  const st = staleBaseline(fr, { baseline: { "h-wrapped:m-wrapped": { expires: "2999-01-01", why: "x" }, "h-gone:m": { expires: "2999-01-01", why: "x" } } }).map((x) => x.dir).sort();
  ok(JSON.stringify(st) === JSON.stringify(["h-gone:m", "h-wrapped:m-wrapped"]), "a baseline line for a member that is metered now, or gone, is a note", st);
  rmSync(r2, { recursive: true, force: true });
}

// ---- this repository
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const real = auditWorkers(repo);
const realBy = Object.fromEntries(real.map((r) => [r.dir, r]));
ok(real.length >= 20, "the discovery finds the fleet's AI-calling workers (at least 20)", real.length);
for (const d of ["qnfo-research-exec", "qnfo-code-orchestrator", "qnfo-ai", "qnfo-ops", "qnfo-agents"]) ok(realBy[d], "found " + d);
ok(realBy["qnfo-email"] && realBy["qnfo-email"].metered, "qnfo-email's voice-draft calls are metered (AI-METER-COVER-2)", realBy["qnfo-email"]);
ok(realBy["qnfo-agents"] && realBy["qnfo-agents"].metered && realBy["qnfo-agents"].meters.includes("ai_spend_ledger"), "qnfo-agents is metered through the ledger", realBy["qnfo-agents"]);
const bad = findings(real);
ok(bad.length === 0, "no AI-calling worker outside the cost policy: " + bad.map((x) => x.dir + " [" + x.kind + "] " + x.detail).join(" | "), bad);
for (const [d, e] of Object.entries(UNMETERED_BASELINE)) ok(/AI-METER-COVER-3/.test(e.why) && /^\d{4}-\d{2}-\d{2}$/.test(e.expires), "every baseline line names the issue that closes it and an expiry: " + d, e);
for (const [d, why] of Object.entries(DIRECT_ALLOW)) ok(String(why).length > 20, "every direct-provider allowance states its reason: " + d);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
