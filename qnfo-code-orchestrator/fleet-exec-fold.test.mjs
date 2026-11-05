// FLEET-EXEC-FOLD-1 (qnfo-code-orchestrator 0.3.18, agent_issues 1756) offline suite. No network, synthetic data.
// Proves: the fleet-exec code runs unchanged as the member fleetExecMod (only its VERSION line and its export differ); the
// host's */10 tick runs the member's fleet_crons dispatcher with only AUDIT (the host's AUDIT_DB) and AI, and the handler
// does not resolve before the member's waitUntil work is done; the member runs even when the host's own loop is skipped
// (no AI binding); GET /fleet-exec/health answers as the member without the host's token, and nothing else of the member is
// reachable; fleet-exec carries a FOLDED marker.
// Run: node qnfo-code-orchestrator/fleet-exec-fold.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync, existsSync } from "node:fs";
const atLeast = (v, min) => { const a = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || "")), b = min.split(".").map(Number); if (!a) return false; for (let i = 0; i < 3; i++) { if (+a[i + 1] !== b[i]) return +a[i + 1] > b[i]; } return true; }; // semver minimum, so a minor bump keeps passing
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const guest = readFileSync(new URL("../fleet-exec/worker.js", import.meta.url), "utf8");
const mod = await import("data:text/javascript;base64," + Buffer.from(src + "\nexport { fleetExecMod as __member, FLEET_EXEC_VERSION as __mv, VERSION as __hv };\n").toString("base64"));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

{
  // D1-TRIGGER-DEPTH-1 (0.9.0): the member's scheduled handler logs a failed tick and feeds fleet_tick, so its swallowing
  // catch line is the one allowed change to the frozen guest (fleet-exec is FOLDED; the member evolves here).
  const allowed = (l) => l.startsWith("var VERSION = ") || l.startsWith("export default schedDefault") || l.trim() === "try { await runTick(env); } catch (e) {}" || /^async function executeTask\(task, env\) \{/.test(l.trim()) || /^return \{ type: "workflow", steps_run: results\.length/.test(l.trim()) || l.trim() === "const result = await executeTask(task, env);" || l.trim() === "results.push(await executeStep(steps[i], env));" || /^await env\.AUDIT\.prepare\("UPDATE fleet_runs SET status = '(ok|failed)', finished_at = \?1, (result|error) = \?2 WHERE id = \?3"\)\.bind\(done, (resStr|msg), runId\)\.run\(\);$/.test(l.trim()) || l.trim() === 'await env.AUDIT.prepare("INSERT INTO codeparse_events (artifact, kind, source, status, err, ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")' || l.trim().startsWith('.bind(status === "accepted" ? JSON.stringify(art) : null, "event"'); // STEP-TIMING-1 (0.43.0): per-step timing and progress in the member's executeTask; FLEET-STEP-DEADLINE-1: each step runs through runStepGuarded, the run row's closing writes retry when refused as overloaded and the audit event is best effort
  const missing = guest.split("\n").filter((l) => l.trim() && !src.includes(l.trim()));
  ok(missing.every(allowed) && missing.some((l) => l.startsWith("var VERSION = ")) && /feedFleetTick\(env\)/.test(src), "every fleet-exec line is in the host except its VERSION line, its export and the logged tick catch", missing.map((l) => l.slice(0, 60)));
  ok(atLeast(mod.__hv, "0.3.18") && mod.__mv === "1.0.4-folded" && (src.match(/var VERSION = "/g) || []).length === 1, "host 0.3.18 or later, member 1.0.4-folded, one quoted VERSION constant", [mod.__hv, mod.__mv]);
}

// a recording D1: fleet_crons has one due row; the executor reads fleet_tasks and writes fleet_runs
function mkDb() {
  const sql = [];
  const prepare = (q) => { let a = []; const s = {
    bind(...x) { a = x; return s; },
    async run() { sql.push({ q, a }); return { success: true, meta: { changes: 1, last_row_id: 1 } }; },
    async first() { sql.push({ q, a }); if (/FROM fleet_tasks/.test(q)) return { id: "t1", name: "probe", type: "sql", definition: JSON.stringify({ sql: "SELECT 1 AS one" }), timeout_ms: 30000, retries: 1, enabled: 1 }; return null; },
    async all() { sql.push({ q, a }); if (/FROM fleet_crons/.test(q)) return { results: [{ name: "c1", task_id: "t1", cron_expr: "*/10 * * * *", enabled: 1 }] }; return { results: [{ one: 1 }] }; }
  }; return s; };
  return { prepare, sql };
}

// the */10 tick runs the member with the mapped bindings and awaits it
{
  const db = mkDb();
  const real = mod.__member.scheduled;
  let seenEnv = null, done = false;
  mod.__member.scheduled = async (ev, env, c) => { seenEnv = env; c.waitUntil(new Promise((r) => setTimeout(() => { done = true; r(); }, 50))); };
  const ai = { run: async () => ({ response: "x" }) };
  await mod.default.scheduled({ cron: "*/10 * * * *", scheduledTime: Date.now() }, { AUDIT_DB: db }, { waitUntil() {} });
  ok(seenEnv && seenEnv.AUDIT === db && Object.keys(seenEnv).sort().join() === "AI,AUDIT", "the member gets AUDIT = AUDIT_DB and AI only", seenEnv && Object.keys(seenEnv));
  ok(done, "the handler awaits the member's waitUntil work (the host's own loop was skipped: no AI binding)");
  mod.__member.scheduled = real;
  // the real member: one due fleet_crons row is dispatched to the executor and recorded
  const db2 = mkDb();
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  await mod.default.scheduled({ cron: "*/10 * * * *", scheduledTime: Date.now() }, { AUDIT_DB: db2 }, { waitUntil() {} });
  ok(db2.sql.some((x) => /FROM fleet_crons WHERE enabled = 1/.test(x.q)) && db2.sql.some((x) => /UPDATE fleet_crons SET last_fired/.test(x.q)) && db2.sql.some((x) => /INSERT INTO fleet_runs/.test(x.q)), "the member's dispatcher reads fleet_crons, records fleet_runs and advances next_fire through the host's AUDIT_DB", db2.sql.map((x) => x.q.slice(0, 50)));
}

// routes
{
  const h = await mod.default.fetch(new Request("https://qnfo-code-orchestrator.q08.workers.dev/fleet-exec/health"), { AUDIT_DB: mkDb() });
  const j = await h.json();
  ok(h.status === 200 && j.worker === "fleet-exec" && j.version === "1.0.4-folded", "GET /fleet-exec/health answers as the member without the host token", j);
  const p = await mod.default.fetch(new Request("https://qnfo-code-orchestrator.q08.workers.dev/fleet-exec/health", { method: "POST" }), { AUDIT_DB: mkDb() });
  ok(p.status === 401, "a POST to /fleet-exec/health falls through to the host's token gate", p.status);
  const r = await mod.default.fetch(new Request("https://qnfo-code-orchestrator.q08.workers.dev/fleet-exec/run", { method: "POST" }), { AUDIT_DB: mkDb() });
  ok(r.status === 401, "no other member route is reachable without the host token", r.status);
}
ok(existsSync(new URL("../fleet-exec/FOLDED", import.meta.url)), "fleet-exec carries a FOLDED marker");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
