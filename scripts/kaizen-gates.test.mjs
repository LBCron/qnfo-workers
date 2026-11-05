// KAIZEN-GATES-1 suite (RM-KAIZEN-GATE-CANDIDATES-1): scripts/kaizen_gates.py holds the repository-checkable kaizen gates. Every gate has a clean fixture
// that passes and a seeded violation that fails, built in a temporary tree (the suite never reads the live repository).
// Run: node scripts/kaizen-gates.test.mjs   -> prints "N passed, 0 failed"
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };
const PY = ["python3", "python"].find((p) => spawnSync(p, ["--version"], { encoding: "utf8" }).status === 0);
if (!PY) throw new Error("no python on PATH");
const GATES = join(here, "kaizen_gates.py");
const run = (args, input) => { const r = spawnSync(PY, ["-I", GATES, ...args], { encoding: "utf8", input, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }); return { code: r.status, out: (r.stdout || "") + (r.stderr || "") }; };

const PAIR = '{"providerId": "QNFO-OPS", "modelId": "ops"}';
function put(root, rel, text) { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); }
function tree() {
  const root = mkdtempSync(join(tmpdir(), "kaizen-gates-"));
  put(root, "scripts/ux-journeys/apps/fleet.journeys.mjs", 'const signedIn = async (u) => { await u.see("Needs you"); };\n  { id: "see-what-needs-me", title: "x" }\n');
  put(root, ".github/workflows/canonical-deploy.yml", "python3 scripts/deploy_probes.py --baseline\npython3 scripts/canary_revert.py --targets t\n");
  put(root, "scripts/pr_fast_guards.py", 'GUARDS = [("worker-load-gate", 1)]\n');
  put(root, "qnfo-fleet-dashboard/probes.json", JSON.stringify({ http: [{ url: "https://fleet.qnfo.org/health", contains: ["x"] }, { url: "https://fleet.qnfo.org/", contains: ["<title>Fleet</title>"] }] }));
  put(root, ".github/workflows/fleet-autodeploy.yml", "run: python scripts/mirror-guard.py\nrun: python scripts/fleet-autoaudit.py --audit\n");
  put(root, "scripts/fleet-autoaudit.py", "# NEVER auto-applied: repo-BEHIND workers\n");
  put(root, "scripts/deploy-drift-guard.py", "x = 1\n");
  put(root, "scripts/mirror-guard.py", "x = 1\n");
  put(root, "qnfo-a/wrangler.toml", 'name = "qnfo-a"\n[[services]]\nbinding = "B"\nservice = "qnfo-b"\n');
  put(root, "qnfo-a/worker.js", "export default {};\n");
  put(root, "qnfo-b/wrangler.toml", 'name = "qnfo-b"\n');
  put(root, "qnfo-b/worker.js", "export default {};\n");
  put(root, "qnfo-gone/wrangler.toml", 'name = "qnfo-gone"\n');
  put(root, "qnfo-gone/RETIRED", "retired\n");
  put(root, "docs/ops-governance/scripts/model_guard.py", "DESIRED_KEY = " + PAIR + "  # x\n");
  put(root, "docs/ops-governance/scripts/sync_system_prompt.py", "MODEL_DICT = " + PAIR + "  # x\n");
  put(root, "docs/ops-governance/scripts/ops-settings-guard.py", "DESIRED_KEYS = " + PAIR + "  # x\n");
  put(root, "docs/ops-governance/scripts/customPrompts-canonical.json", JSON.stringify([{ id: "1", name: "CMD A", content: "DEEPCHAT-DEFAULT-MODEL-1 = QNFO-OPS/ops" }, { id: "2", name: "CMD B", content: "no model key" }]));
  put(root, "qnfo-bill/worker.js", "const cents = Number(r.amount_due); const usd = cents / 100;\n");
  return root;
}
const gate = (root, key) => run(["--root", root, "--only", key]);
const bad = (r, key) => r.code === 1 && r.out.includes("KAIZEN-GATE " + key + " VIOLATION");

// ---- clean tree: every gate passes, and the registry lists the six
{
  const root = tree();
  const r = run(["--root", root]);
  ok(r.code === 0 && /6 gate\(s\), 0 violation/.test(r.out), "a clean tree passes all six gates", r);
  ok(run(["--list"]).out.trim().split(/\r?\n/).length === 6, "six repository gates are registered");
  ok(run(["--only", "NOPE-1"]).code === 2, "an unknown gate in --only is a usage error (fail closed)");

  // RED-INVENTORY-1
  put(root, "scripts/ux-journeys/apps/fleet.journeys.mjs", 'const x = 1;\n');
  ok(bad(gate(root, "RED-INVENTORY-1"), "RED-INVENTORY-1"), "RED-INVENTORY-1: the see-what-needs-me journey removed fails");
  rmSync(root, { recursive: true, force: true });
}

// ---- BUILD-GATE-NOT-RUNTIME-GATE-1
{
  const root = tree();
  put(root, ".github/workflows/canonical-deploy.yml", "python3 scripts/deploy_probes.py --baseline\n");
  ok(bad(gate(root, "BUILD-GATE-NOT-RUNTIME-GATE-1"), "BUILD-GATE-NOT-RUNTIME-GATE-1"), "canary_revert dropped from canonical-deploy fails");
  put(root, ".github/workflows/canonical-deploy.yml", "scripts/deploy_probes.py scripts/canary_revert.py\n");
  ok(gate(root, "BUILD-GATE-NOT-RUNTIME-GATE-1").code === 0, "wiring restored passes");
  put(root, "qnfo-fleet-dashboard/probes.json", JSON.stringify({ http: [{ url: "https://fleet.qnfo.org/health", contains: ["x"] }] }));
  const r = gate(root, "BUILD-GATE-NOT-RUNTIME-GATE-1");
  ok(bad(r, "BUILD-GATE-NOT-RUNTIME-GATE-1") && /besides \/health/.test(r.out), "a dashboard that probes only /health fails", r);
  put(root, "scripts/pr_fast_guards.py", "GUARDS = []\n");
  ok(bad(gate(root, "BUILD-GATE-NOT-RUNTIME-GATE-1"), "BUILD-GATE-NOT-RUNTIME-GATE-1"), "worker-load-gate dropped from pr_fast_guards fails");
  rmSync(root, { recursive: true, force: true });
}

// ---- DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1
{
  const root = tree();
  ok(gate(root, "DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1").code === 0, "a binding to a live worker passes");
  put(root, "qnfo-a/wrangler.toml", 'name = "qnfo-a"\n[[services]]\nbinding = "G"\nservice = "qnfo-gone"\n');
  let r = gate(root, "DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1");
  ok(bad(r, "DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1") && /qnfo-gone/.test(r.out) && /RETIRED or FOLDED/.test(r.out), "a binding to a RETIRED worker fails", r);
  put(root, "qnfo-a/wrangler.toml", 'name = "qnfo-a"\n[[services]]\nbinding = "G"\nservice = "qnfo-nowhere"\nprops = { caller = "qnfo-a" }\n');
  r = gate(root, "DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1");
  ok(bad(r, "DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1") && /no worker directory/.test(r.out), "a binding to a worker with no directory fails", r);
  put(root, "qnfo-a/wrangler.toml", 'name = "qnfo-a"\n[[tail_consumers]]\nservice = "qnfo-gone"\n');
  ok(bad(gate(root, "DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1"), "DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1"), "a tail consumer on a retired worker fails");
  put(root, "qnfo-a/wrangler.toml", 'name = "qnfo-a"\n[[durable_objects.bindings]]\nname = "D"\nclass_name = "C"\nscript_name = "qnfo-gone"\n');
  ok(bad(gate(root, "DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1"), "DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1"), "a durable object script_name on a retired worker fails");
  put(root, "qnfo-a/wrangler.toml", 'name = "qnfo-a"\n[[env.production.services]]\nbinding = "G"\nservice = "qnfo-nowhere"\n');
  ok(bad(gate(root, "DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1"), "DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1"), "an env-scoped service binding is read too");
  // a retired worker's own stale binding never deploys, so it is not a violation; a binding by name (not directory) resolves
  put(root, "qnfo-a/wrangler.toml", 'name = "qnfo-a"\n');
  put(root, "qnfo-gone/wrangler.toml", 'name = "qnfo-gone"\n[[services]]\nbinding = "X"\nservice = "qnfo-nowhere"\n');
  ok(gate(root, "DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1").code === 0, "a RETIRED worker's own bindings are ignored");
  put(root, "dir-differs/wrangler.toml", 'name = "qnfo-renamed"\n');
  put(root, "qnfo-a/wrangler.toml", 'name = "qnfo-a"\n[[services]]\nbinding = "R"\nservice = "qnfo-renamed"\n');
  ok(gate(root, "DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1").code === 0, "a binding is resolved by the toml name, not the directory name");
  rmSync(root, { recursive: true, force: true });
}

// ---- LIVE-AHEAD-OF-REPO-UNCOMMITTED-1
{
  const root = tree();
  put(root, ".github/workflows/fleet-autodeploy.yml", "run: python scripts/mirror-guard.py\n");
  ok(bad(gate(root, "LIVE-AHEAD-OF-REPO-UNCOMMITTED-1"), "LIVE-AHEAD-OF-REPO-UNCOMMITTED-1"), "fleet-autodeploy without the audit step fails");
  put(root, ".github/workflows/fleet-autodeploy.yml", "run: python scripts/mirror-guard.py\nrun: python scripts/fleet-autoaudit.py --audit\n");
  put(root, "scripts/fleet-autoaudit.py", "# apply mode redeploys anything\n");
  ok(bad(gate(root, "LIVE-AHEAD-OF-REPO-UNCOMMITTED-1"), "LIVE-AHEAD-OF-REPO-UNCOMMITTED-1"), "an audit that no longer names the repo-BEHIND refusal fails");
  rmSync(root, { recursive: true, force: true });
}

// ---- CURRENCY-UNIT-TRAP-1
{
  const root = tree();
  put(root, "qnfo-bill/worker.js", "const due = Number(r.amount_due); report(due);\n");
  let r = gate(root, "CURRENCY-UNIT-TRAP-1");
  ok(bad(r, "CURRENCY-UNIT-TRAP-1") && r.out.includes("qnfo-bill/worker.js"), "a worker that reads amount_due and never names the unit fails", r);
  put(root, "qnfo-bill/worker.js", "const due = Number(r.amount_due) / 100; report(due);\n");
  ok(gate(root, "CURRENCY-UNIT-TRAP-1").code === 0, "dividing by 100 declares the unit");
  put(root, "qnfo-bill/worker.js", "// Billing amounts are USD CENTS\nconst due = Number(pj.result.amount_paid);\n");
  ok(gate(root, "CURRENCY-UNIT-TRAP-1").code === 0, "a CENTS comment declares the unit");
  put(root, "qnfo-bill/worker.js", 'const bal = await billing("billing/credit-balance");\n');
  ok(bad(gate(root, "CURRENCY-UNIT-TRAP-1"), "CURRENCY-UNIT-TRAP-1"), "the credit-balance route without a unit fails");
  put(root, "scripts/cost.py", 'inv = get("ai-gateway/billing/invoice-preview")\nusd = inv["amount_due"]\n');
  ok(bad(gate(root, "CURRENCY-UNIT-TRAP-1"), "CURRENCY-UNIT-TRAP-1"), "a script under scripts/ is read too");
  rmSync(join(root, "scripts/cost.py"));
  put(root, "qnfo-bill/RETIRED", "retired\n");
  ok(gate(root, "CURRENCY-UNIT-TRAP-1").code === 0, "a retired worker is not scanned");
  rmSync(join(root, "qnfo-bill/RETIRED"));
  put(root, "qnfo-bill/worker.js", "const cents = 1; const usd = cents / 100;\n");
  put(root, "scripts/x.test.mjs", 'const o = { amount_due: 5 };\n');
  r = gate(root, "CURRENCY-UNIT-TRAP-1");
  ok(r.code === 0 && !r.out.includes("x.test.mjs"), "a test file is not scanned", r);
  rmSync(root, { recursive: true, force: true });
}

// ---- STALE-TEMPLATE-MODELKEY-1
{
  const root = tree();
  const store = "docs/ops-governance/scripts/customPrompts-canonical.json";
  put(root, store, JSON.stringify([{ id: "1", name: "CMD UPDATE", content: "DEEPCHAT-DEFAULT-MODEL-1 = AI-GATEWAY/openai/gpt-4.1" }]));
  let r = gate(root, "STALE-TEMPLATE-MODELKEY-1");
  ok(bad(r, "STALE-TEMPLATE-MODELKEY-1") && /superseded model key gpt-4\.1/.test(r.out), "a template that carries the superseded key fails", r);
  put(root, store, JSON.stringify([{ id: "1", name: "CMD UPDATE", content: "DEEPCHAT-DEFAULT-MODEL-1 (both JSON model keys flash)" }]));
  r = gate(root, "STALE-TEMPLATE-MODELKEY-1");
  ok(bad(r, "STALE-TEMPLATE-MODELKEY-1") && /never names the live default QNFO-OPS\/ops/.test(r.out), "an invariant that omits the live default fails", r);
  put(root, store, JSON.stringify([{ id: "1", name: "T", content: "x", template: "uses gpt-4.1" }]));
  ok(bad(gate(root, "STALE-TEMPLATE-MODELKEY-1"), "STALE-TEMPLATE-MODELKEY-1"), "the template field is read as well as content");
  put(root, store, "not json");
  ok(bad(gate(root, "STALE-TEMPLATE-MODELKEY-1"), "STALE-TEMPLATE-MODELKEY-1"), "an unparseable store fails");
  put(root, store, JSON.stringify([]));
  put(root, "docs/ops-governance/scripts/sync_system_prompt.py", 'MODEL_DICT = {"providerId": "AI-GATEWAY", "modelId": "openai/gpt-4.1"}\n');
  r = gate(root, "STALE-TEMPLATE-MODELKEY-1");
  ok(bad(r, "STALE-TEMPLATE-MODELKEY-1") && /disagree/.test(r.out), "guard copies of the default that disagree fail", r);
  rmSync(join(root, "docs/ops-governance/scripts/sync_system_prompt.py"));
  r = gate(root, "STALE-TEMPLATE-MODELKEY-1");
  ok(bad(r, "STALE-TEMPLATE-MODELKEY-1") && /no default model key literal/.test(r.out), "a guard copy that is missing fails closed", r);
  rmSync(root, { recursive: true, force: true });
}

// ---- GATEWAY-RUNWAY-BRAKE-1 (command line, over the JSON of the gateway GET)
{
  const good = { rate_limiting_limit: 300, rate_limiting_interval: 60, authentication: true, spend_limits: { enabled: true, rules: [{ enabled: true, limitType: "cost", limit: 180 }] } };
  const cfg = (o) => JSON.stringify({ success: true, result: { ...good, ...o } });
  const g = (o) => run(["--gateway-config", "-"], cfg(o));
  ok(g({}).code === 0, "the live shape of 2026-11-05 (300 per 60 s, authentication, a cost rule) passes", g({}));
  ok(g({ rate_limiting_limit: 18000, rate_limiting_interval: 3600 }).code === 0, "300 per minute written as 18000 per hour passes");
  ok(/looser than 300/.test(g({ rate_limiting_limit: 1200 }).out), "the pre-brake 1200 per minute fails");
  ok(/no request-rate brake/.test(g({ rate_limiting_limit: null }).out), "no rate limit fails");
  ok(/authentication is off/.test(g({ authentication: false }).out), "authentication off fails");
  ok(/token-volume/.test(g({ spend_limits: { enabled: false, rules: [] } }).out), "no spend limit fails: the rate brake cannot catch token-volume burn");
  ok(/token-volume/.test(g({ spend_limits: { enabled: true, rules: [{ enabled: false, limitType: "cost", limit: 100 }] } }).out), "a disabled spend rule does not count");
  ok(run(["--gateway-config", "-"], "not json").code === 2, "unreadable input is a usage error (fail closed)");
}

// ---- TEMPLATE-RUNTIME-INJECTION-PARITY-1 (command line)
{
  const root = tree();
  const store = join(root, "store.json");
  const body = "Line one\nLine two: DEEPCHAT-DEFAULT-MODEL-1 = QNFO-OPS/ops\nLine three";
  writeFileSync(store, JSON.stringify([{ id: "1", name: "CMD UPDATE (HOLISTIC)", content: body }, { id: "2", name: "CMD DEPLOY", content: "other" }]));
  const inj = (t) => { const p = join(root, "inj.txt"); writeFileSync(p, t); return run(["--root", root, "--template-parity", p, "--store", store, "--name", "CMD UPDATE (HOLISTIC)"]); };
  ok(inj(body).code === 0, "an injected text equal to the store entry passes");
  ok(inj(body.replace(/\n/g, "\r\n") + "  \n").code === 0, "line endings and trailing blanks are not a difference");
  let r = inj("Line one\nLine two: DEEPCHAT-DEFAULT-MODEL-1 = AI-GATEWAY/openai/gpt-4.1\nLine three");
  ok(r.code === 1 && /first difference at line 2/.test(r.out) && /superseded model key gpt-4\.1/.test(r.out) && /never names the live default QNFO-OPS\/ops/.test(r.out), "a stale snapshot injected over a clean store is caught (the 2026-09-27 case)", r);
  r = run(["--root", root, "--template-parity", join(root, "inj.txt"), "--store", store]);
  ok(r.code === 1, "without --name the text must equal some entry", r);
  r = run(["--root", root, "--template-parity", join(root, "inj.txt"), "--store", store, "--name", "NOPE"]);
  ok(r.code === 1 && /no store entry named 'NOPE'/.test(r.out), "an unknown template name fails", r);
  ok(run(["--template-parity", join(root, "missing.txt"), "--store", store]).code === 2, "an unreadable input is a usage error");
  rmSync(root, { recursive: true, force: true });
}

// ---- the module is registered as a strict fast guard
{
  const src = readFileSync(join(here, "pr_fast_guards.py"), "utf8");
  ok(/\("kaizen-gates"/.test(src) && /scripts\/kaizen_gates\.py/.test(src), "pr_fast_guards.py registers the kaizen-gates guard");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
