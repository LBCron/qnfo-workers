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
ok(by["w-direct"] && by["w-direct"].paths.join() === "direct" && by["w-direct"].direct.join() === "api.deepseek.com", "a provider host is a direct path", by["w-direct"]);
ok(by["w-router"] && by["w-router"].paths.join() === "router", "a service binding to qnfo-ai is a router path", by["w-router"]);
ok(by["w-gateway-only"] && by["w-gateway-only"].paths.join() === "gateway", "gateway.ai.cloudflare.com is a gateway path", by["w-gateway-only"]);
ok(by["w-ledger"] && by["w-ledger"].metered && by["w-ledger"].meters.includes("ai_spend_ledger"), "a ledger write counts as metered", by["w-ledger"]);

const f = findings(rows, { baseline: {}, directAllow: {} });
const kinds = f.map((x) => x.dir + ":" + x.kind).sort();
ok(JSON.stringify(kinds) === JSON.stringify(["w-bare:binding-unmetered", "w-direct:direct-provider"]), "findings: the bare binding caller and the unlisted provider host, nothing else", kinds);
const live = { expires: "2999-01-01", why: "AI-METER-COVER-3x" };
ok(findings(rows, { baseline: { "w-bare": live }, directAllow: { "w-direct": "y" } }).length === 0, "a baseline line and a DIRECT_ALLOW line each clear their finding");
const exp = findings(rows, { baseline: { "w-bare": { expires: "2026-11-01", why: "old" } }, directAllow: { "w-direct": "y" }, today: "2026-11-05" }).map((x) => x.dir + ":" + x.kind);
ok(JSON.stringify(exp) === JSON.stringify(["w-bare:baseline-expired"]), "a baseline line past its date is a finding whether or not the worker was fixed", exp);
const bad2 = findings(rows, { baseline: { "w-bare": { why: "no date" } }, directAllow: { "w-direct": "y" } }).map((x) => x.dir + ":" + x.kind);
ok(JSON.stringify(bad2) === JSON.stringify(["w-bare:baseline-malformed"]), "a baseline line without an expiry date is malformed", bad2);
const stale = staleBaseline(rows, { baseline: { "w-bare": live, "w-metered": live, "w-gone": live } }).map((x) => x.dir).sort();
ok(JSON.stringify(stale) === JSON.stringify(["w-gone", "w-metered"]), "a baseline line for a metered or vanished worker is a note, not a failure", stale);
ok(findings(rows, { baseline: { "w-bare": live, "w-metered": live, "w-gone": live }, directAllow: { "w-direct": "y" } }).length === 0, "so the single-file change that wraps a worker never turns main red");
rmSync(root, { recursive: true, force: true });

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
