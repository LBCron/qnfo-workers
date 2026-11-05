// FLEET-LESSONS-GATES-1 suite (roadmap rows RM-GATE-C1, C3, D4, H1, H2, H3; charter pillar autonomy): scripts/fleet_lessons_gates.py is the offline,
// repository half of six fleet-lessons ledger gates that were audited `local-only` (the guards run on the owner's machine, agent_issues 1686).
// Proves, on fixture trees built from the real guard scripts plus one small mutation each, that every gate fails for the defect its ledger entry
// names and passes for the fix, that the real checkout is clean, and that a missing input fails closed. No network, no live state.
// Run: node scripts/fleet-lessons-gates.test.mjs   -> prints "N passed, 0 failed"
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (c, m, d) => { if (c) passed++; else { failed++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + String(d).slice(0, 700))); } };
const py = process.platform === "win32" ? "python" : "python3";
const run = (root, only) => spawnSync(py, ["-I", join(repo, "scripts", "fleet_lessons_gates.py"), "--root", root].concat(only ? ["--only", only] : []), { encoding: "utf8", timeout: 120000 });
const OPS = "docs/ops-governance/scripts";

// the real checkout is clean, with one status line per gate
const real = run(repo);
ok(real.status === 0 && !/VIOLATION/.test(real.stdout), "this checkout passes every gate", real.stdout);
for (const g of ["C1", "C3", "D4", "E2", "H1", "H2", "H3"]) ok(new RegExp("FLEET-LESSONS-GATES " + g + " ok").test(real.stdout), "gate " + g + " reports ok on this checkout", real.stdout);

const FILES = ["model_guard.py", "ops-settings-guard.py", "sync_system_prompt.py", "local-config-selfheal.py", "customPrompts-canonical.json", "chatbox-providers-canonical.json",
  "backup_agentdb_chunked.py", "purge-agent-snapshots.py", "skill_pull.py", "chatbox-prompt-guard.py", "chatbox-system-prompt-canonical.txt",
  "dr_validate_schema.py", "fleet-manifest-sweep.py", "fleet-wiring-sweep.py", "stale-binding-guard.py", "report-card-autonomy.py", "buffer_post.py"].map((f) => OPS + "/" + f);
const STUBS = {
  "qnfo-ops/worker.js": 'var OPS_PUBLIC_MODEL = "ops";\nvar OPS_PUBLIC_ALIAS = { "ops": 1, "ops-exec": 1 };\n',
  "qnfo-ai/worker.js": 'data: [{ id: "qnfo", object: "model", created: 171e7, owned_by: "qnfo", capabilities: ["chat"] }]\n',
  "personal-api/worker.js": '{ id: "personal", object: "model", created: 1787241600 }\n',
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "fl-gates-"));
  for (const f of FILES) { mkdirSync(join(root, dirname(f)), { recursive: true }); copyFileSync(join(repo, f), join(root, f)); }
  for (const [f, t] of Object.entries(STUBS)) { mkdirSync(join(root, dirname(f)), { recursive: true }); writeFileSync(join(root, f), t); }
  mkdirSync(join(root, "scripts"), { recursive: true });
  return root;
}
const edit = (root, rel, fn) => { const p = join(root, rel); writeFileSync(p, fn(readFileSync(p, "utf8"))); };
const put = (root, rel, text) => { mkdirSync(join(root, dirname(rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
const gate = (r, g) => (r.stdout.match(new RegExp("^VIOLATION " + g + " .*$", "gm")) || []);

const base = fixture();
try {
  const r0 = run(base);
  ok(r0.status === 0 && !/VIOLATION/.test(r0.stdout), "the fixture tree built from the real guards and stub workers is clean", r0.stdout);

  // ---- C1: client state mirrored into the enforcing guard --------------------------------------------------------------------------------
  edit(base, OPS + "/ops-settings-guard.py", (t) => t.replace(/DESIRED_KEYS = \{"providerId": "QNFO-OPS", "modelId": "ops"\}/, 'DESIRED_KEYS = {"providerId": "AI-GATEWAY", "modelId": "openai/gpt-4.1"}'));
  let r = run(base);
  ok(r.status === 1 && gate(r, "C1").some((l) => /diverged across the guards/.test(l) && /ops-settings-guard\.DESIRED_KEYS=AI-GATEWAY\/openai\/gpt-4\.1/.test(l)), "C1: a guard that still encodes a different default key is reported with both values", r.stdout);
  ok(gate(r, "C1").every((l) => !/:\d+:/.test(l)), "C1: finding lines carry no line numbers (regression_gate compares text)", gate(r, "C1").join("\n"));
  copyFileSync(join(repo, OPS, "ops-settings-guard.py"), join(base, OPS, "ops-settings-guard.py"));

  edit(base, OPS + "/local-config-selfheal.py", (t) => t.replace(/STATUS_WHITELIST = \{"QNFO-OPS": "ops"/, 'STATUS_WHITELIST = {"QNFO-OPS": "ops-exec"'));
  r = run(base, "C1");
  ok(r.status === 1 && gate(r, "C1").some((l) => /provider-status tables diverged/.test(l)), "C1: the two provider-status tables must agree", r.stdout);
  copyFileSync(join(repo, OPS, "local-config-selfheal.py"), join(base, OPS, "local-config-selfheal.py"));

  edit(base, OPS + "/customPrompts-canonical.json", (t) => t.replace('"content": "AUDIT INFRASTRUCTURE:', '"content": "AUDIT INFRASTRUCTURE: default AI-GATEWAY/openai/gpt-4.1 -'));
  r = run(base, "C1");
  ok(r.status === 1 && gate(r, "C1").some((l) => /superseded default id gpt-4\.1/.test(l)), "C1: a template that carries the superseded default is reported", r.stdout);
  copyFileSync(join(repo, OPS, "customPrompts-canonical.json"), join(base, OPS, "customPrompts-canonical.json"));

  edit(base, OPS + "/customPrompts-canonical.json", (t) => t.replace("DEEPCHAT-DEFAULT-MODEL-1", "DEEPCHAT-DEFAULT-MODEL-1 (pinned to nothing in particular)").replace(/QNFO-OPS\/ops/g, "QNFO-OPS / ops"));
  r = run(base, "C1");
  ok(r.status === 1 && gate(r, "C1").some((l) => /states the default-model invariant but does not name QNFO-OPS\/ops/.test(l)), "C1: a template that states the invariant must name the live pair", r.stdout);
  copyFileSync(join(repo, OPS, "customPrompts-canonical.json"), join(base, OPS, "customPrompts-canonical.json"));

  put(base, OPS + "/chatbox-system-prompt-canonical.txt", 'default {"providerId": "AI-GATEWAY", "modelId": "gpt-4.1"}\n');
  r = run(base, "C1");
  ok(gate(r, "C1").some((l) => /names default key AI-GATEWAY\/gpt-4\.1/.test(l)), "C1: a canonical prompt that names another default key is reported", r.stdout);
  copyFileSync(join(repo, OPS, "chatbox-system-prompt-canonical.txt"), join(base, OPS, "chatbox-system-prompt-canonical.txt"));

  rmSync(join(base, OPS, "model_guard.py"));
  r = run(base, "C1");
  ok(r.status === 1 && gate(r, "C1").some((l) => /model_guard\.py: cannot read the enforcing guard/.test(l)), "C1: a missing guard fails closed", r.stdout);
  copyFileSync(join(repo, OPS, "model_guard.py"), join(base, OPS, "model_guard.py"));

  // ---- C3: the pinned default must resolve in the runtime registry -------------------------------------------------------------------
  put(base, "qnfo-ops/worker.js", 'var OPS_PUBLIC_MODEL = "ops-next";\nvar OPS_PUBLIC_ALIAS = { "ops-next": 1 };\n');
  r = run(base, "C3");
  ok(r.status === 1 && gate(r, "C3").some((l) => /qnfo-ops\/worker\.js: advertises model ops-next, the client pins ops/.test(l)), "C3: a runtime worker that advertises another id than the client pins is reported", r.stdout);
  put(base, "qnfo-ops/worker.js", STUBS["qnfo-ops/worker.js"].replace('{ "ops": 1, "ops-exec": 1 }', '{ "ops-exec": 1 }'));
  r = run(base, "C3");
  ok(gate(r, "C3").some((l) => /OPS_PUBLIC_ALIAS does not accept the pinned default model ops/.test(l)), "C3: the alias table must accept the pinned default", r.stdout);
  put(base, "qnfo-ops/worker.js", STUBS["qnfo-ops/worker.js"]);
  edit(base, OPS + "/chatbox-providers-canonical.json", (t) => t.replace('"modelId": "personal"', '"modelId": "personal-2"'));
  r = run(base, "C3");
  ok(gate(r, "C3").some((l) => /provider personal-twin does not list model personal/.test(l)), "C3: the client provider registry must list the pinned model", r.stdout);
  copyFileSync(join(repo, OPS, "chatbox-providers-canonical.json"), join(base, OPS, "chatbox-providers-canonical.json"));
  rmSync(join(base, "personal-api/worker.js"));
  r = run(base, "C3");
  ok(gate(r, "C3").some((l) => /personal-api\/worker\.js: cannot read the runtime worker/.test(l)), "C3: an unreadable runtime worker fails closed", r.stdout);
  put(base, "personal-api/worker.js", STUBS["personal-api/worker.js"]);
  edit(base, OPS + "/model_guard.py", (t) => t.replace(/DESIRED_KEY = \{"providerId": "QNFO-OPS"/, 'DESIRED_KEY = {"providerId": "AI-GATEWAY"'));
  r = run(base);
  ok(gate(r, "C1").some((l) => /diverged across the guards/.test(l)) && gate(r, "C3").some((l) => /no single default-model key/.test(l)), "C3: with the guards diverged there is no single key to resolve (C1 reports the divergence)", r.stdout);
  copyFileSync(join(repo, OPS, "model_guard.py"), join(base, OPS, "model_guard.py"));
  r = run(base);
  ok(r.status === 0, "the fixture is clean again after the restores", r.stdout);

  // ---- D4: platform-correct command form -------------------------------------------------------------------------------------------------
  put(base, "scripts/wrap.py", 'import subprocess\nsubprocess.run(["npx", "--yes", "wrangler", "deploy"], check=True)\n');
  r = run(base, "D4");
  ok(r.status === 1 && gate(r, "D4").some((l) => /scripts\/wrap\.py: process argv starts with the bare command 'npx'/.test(l)), "D4: a bare npx argv in a subprocess wrapper is reported", r.stdout);
  put(base, "scripts/wrap.py", 'import shutil, subprocess\nNPX = shutil.which("npx")\nsubprocess.run([NPX, "--yes", "wrangler", "deploy"], check=True)\nsubprocess.run(["wrangler", "whoami"])\n');
  ok(run(base, "D4").status === 0, "D4: a file that resolves the command with shutil.which passes");
  put(base, "scripts/wrap.py", 'import os, subprocess\nW = "wrangler.cmd" if os.name == "nt" else "wrangler"\nsubprocess.run(["wrangler", "whoami"])\n');
  ok(run(base, "D4").status === 0, "D4: a file with an os.name branch passes");
  put(base, "scripts/wrap.py", 'import subprocess\nsubprocess.run(["python", "x.py"])\nsubprocess.run(["node", "--check", "w.js"])\n');
  ok(run(base, "D4").status === 0, "D4: commands that exist on Windows as .exe (python, node) are not flagged");
  put(base, "scripts/wrap.py", 'import subprocess\nTOOLS = ["npm", "pnpm", "yarn"]\nsubprocess.run(["echo", "x"])\n');
  ok(run(base, "D4").status === 0, "D4: a table of tool names that is never run as an argv is not flagged");
  put(base, "scripts/wrap.py", 'import subprocess\ncmd = ["wrangler", "deploy"]\nsubprocess.check_call(cmd)\n');
  r = run(base, "D4");
  ok(r.status === 1 && gate(r, "D4").some((l) => /bare command 'wrangler'/.test(l)), "D4: an argv built in a variable and then run is reported", r.stdout);
  put(base, "scripts/wrap.py", 'import subprocess\nsubprocess.run(["npx", "x"\n');
  r = run(base, "D4");
  ok(r.status === 1 && gate(r, "D4").some((l) => /scripts\/wrap\.py: cannot be parsed as Python/.test(l)), "D4: a script the gate cannot parse is a finding, not a silent pass", r.stdout);
  put(base, "scripts/wrap.py", '\ufeffimport subprocess\nsubprocess.run(["npx", "x"])\n');
  r = run(base, "D4");
  ok(gate(r, "D4").some((l) => /bare command 'npx'/.test(l)), "D4: a script saved with a BOM is still read", r.stdout);
  rmSync(join(base, "scripts/wrap.py"));
  put(base, "scripts/launch.mjs", 'import { spawnSync } from "node:child_process";\nspawnSync("npm", ["test"], { stdio: "inherit" });\n');
  r = run(base, "D4");
  ok(r.status === 1 && gate(r, "D4").some((l) => /scripts\/launch\.mjs: spawns the bare command 'npm'/.test(l)), "D4: a bare npm spawn in a node script is reported", r.stdout);
  put(base, "scripts/launch.mjs", 'import { spawnSync } from "node:child_process";\nspawnSync("npm", ["test"], { shell: process.platform === "win32" });\n');
  ok(run(base, "D4").status === 0, "D4: a node script with win32 handling passes");
  rmSync(join(base, "scripts/launch.mjs"));

  // ---- E2: secrets are read from their file stores ----------------------------------------------------------------------------------------
  put(base, OPS + "/probe_env.py", 'import os\nTOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")\nif not TOKEN:\n    print("missing")\n');
  r = run(base, "E2");
  ok(r.status === 1 && gate(r, "E2").some((l) => /probe_env\.py: reads CLOUDFLARE_API_TOKEN from the process environment only/.test(l)), "E2: an env-only read of a credential is reported with its name", r.stdout);
  put(base, OPS + "/probe_env.py", 'import os\nA = os.environ["GH_TOKEN"]\nB = os.getenv("SERVICE_API_KEY")\nC = os.environ.get("APP_SECRET")\nD = os.environ.get("DB_PASSWORD")\n');
  r = run(base, "E2");
  ok(gate(r, "E2").some((l) => ["GH_TOKEN", "SERVICE_API_KEY", "APP_SECRET", "DB_PASSWORD"].every((n) => l.includes(n))), "E2: subscript, getenv and get reads of *TOKEN, *_KEY, *SECRET and *PASSWORD all count", r.stdout);
  put(base, OPS + "/probe_env.py", 'import os\nA = os.environ.get("TEMP")\nB = os.environ.get("BACKUP_CHUNK_BYTES")\nC = os.environ.get("CF_ACCOUNT_ID")\nD = os.environ.get("QNFO_WORKERS_DIR")\n');
  ok(run(base, "E2").status === 0, "E2: variables that are not credentials are not flagged");
  put(base, OPS + "/probe_env.py", 'import os\nos.environ["GH_TOKEN"] = "x"\ndel os.environ["GH_TOKEN"]\nS = os.environ.get("SORT_KEY")\nB = os.environ.get("BYPASS")\nC = os.environ.get("CACHE_KEY")\n');
  ok(run(base, "E2").status === 0, "E2: writing a variable, and names such as SORT_KEY, CACHE_KEY and BYPASS, are not credential reads");
  put(base, OPS + "/probe_env.py", 'from os import environ\nT = environ.get("GH_TOKEN")\n');
  ok(gate(run(base, "E2"), "E2").some((l) => /probe_env\.py: reads GH_TOKEN/.test(l)), "E2: a read through `from os import environ` counts");
  put(base, OPS + "/probe_env.py", 'import os\n# the key may be in ~/.env\nT = os.environ.get("GH_TOKEN")\n');
  ok(run(base, "E2").status === 1, "E2: a comment that names the file store is not a read of it");
  for (const store of ['os.path.expanduser("~/.env")', 'r"C:\\Users\\X\\tokens\\cloudflare"', 'os.path.join(HOME, ".qnfo", "t")', 'r"C:/Users/X/.deepchat/secrets/t.txt"']) {
    put(base, OPS + "/probe_env.py", 'import os\nTOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")\nP = ' + store + '\n');
    ok(run(base, "E2").status === 0, "E2: a script that also names the file store " + store.slice(0, 40) + " passes");
  }
  rmSync(join(base, OPS, "probe_env.py"));

  // ---- H1: independent purge sweeps for backup orphans -----------------------------------------------------------------------------------
  edit(base, OPS + "/backup_agentdb_chunked.py", (t) => t.replace("    purge_orphan_snapshots()  # RM-GATE-H1", "    pass  # RM-GATE-H1"));
  r = run(base, "H1");
  ok(r.status === 1 && gate(r, "H1").some((l) => /backup_agentdb_chunked\.py: creates agent-snapshot-\* files but does not purge orphans of earlier runs before its first snapshot/.test(l)), "H1: a snapshot writer that does not purge orphans first is reported", r.stdout);
  copyFileSync(join(repo, OPS, "backup_agentdb_chunked.py"), join(base, OPS, "backup_agentdb_chunked.py"));
  edit(base, OPS + "/backup_agentdb_chunked.py", (t) => t.replace("    purge_orphan_snapshots()  # RM-GATE-H1: before the free-space gate below, so freed orphans count toward it\n", "").replace("        t1 = snapshot(db_src, 'settings')", "        t1 = snapshot(db_src, 'settings')\n        purge_orphan_snapshots()"));
  r = run(base, "H1");
  ok(gate(r, "H1").some((l) => /does not purge orphans of earlier runs before its first snapshot/.test(l)), "H1: a purge that runs after the first snapshot is too late and is reported", r.stdout);
  copyFileSync(join(repo, OPS, "backup_agentdb_chunked.py"), join(base, OPS, "backup_agentdb_chunked.py"));
  edit(base, OPS + "/backup_agentdb_chunked.py", (t) => t.replace(/        for _p in \(t1, t2\):\n            if _p and os\.path\.exists\(_p\):\n                try: os\.remove\(_p\)\n                except Exception: pass/, "        pass"));
  r = run(base, "H1");
  ok(gate(r, "H1").some((l) => /removes them in no finally block of main\(\)/.test(l)), "H1: cleanup outside a finally block of main() is reported (another function's finally does not count)", r.stdout);
  copyFileSync(join(repo, OPS, "backup_agentdb_chunked.py"), join(base, OPS, "backup_agentdb_chunked.py"));
  edit(base, OPS + "/backup_agentdb_chunked.py", (t) => t.replace("float(os.environ.get('SNAPSHOT_ORPHAN_MIN_AGE_MIN') or '180')", "float(os.environ.get('SNAPSHOT_ORPHAN_MIN_AGE_MIN') or '1440')"));
  r = run(base, "H1");
  ok(gate(r, "H1").some((l) => /backup_agentdb_chunked\.py: its own orphan cutoff defaults to 1440 minutes/.test(l)), "H1: the snapshot writer's own purge cutoff is bounded too", r.stdout);
  copyFileSync(join(repo, OPS, "backup_agentdb_chunked.py"), join(base, OPS, "backup_agentdb_chunked.py"));
  edit(base, OPS + "/purge-agent-snapshots.py", (t) => t.replace('"SNAPSHOT_ORPHAN_MIN_AGE_MIN") or "180"', '"SNAPSHOT_ORPHAN_MIN_AGE_MIN") or "1440"'));
  r = run(base, "H1");
  ok(gate(r, "H1").some((l) => /purge-agent-snapshots\.py: the orphan cutoff defaults to 1440 minutes/.test(l)), "H1: a purge sweep that waits a day for an orphan is reported", r.stdout);
  edit(base, OPS + "/purge-agent-snapshots.py", () => 'AGE_HOURS = 24\n');
  r = run(base, "H1");
  ok(gate(r, "H1").some((l) => /no SNAPSHOT_ORPHAN_MIN_AGE_MIN cutoff/.test(l)), "H1: a purge sweep with no orphan cutoff is reported", r.stdout);
  copyFileSync(join(repo, OPS, "purge-agent-snapshots.py"), join(base, OPS, "purge-agent-snapshots.py"));

  // ---- H2: registry membership verified before reliance ---------------------------------------------------------------------------------
  edit(base, OPS + "/skill_pull.py", (t) => t.replace(/missing = verify_membership\(skill_dirs, args\.dest\)/, "missing = []"));
  r = run(base, "H2");
  ok(r.status === 1 && gate(r, "H2").some((l) => /main\(\) never calls verify_membership/.test(l)), "H2: a pull that never verifies membership is reported", r.stdout);
  copyFileSync(join(repo, OPS, "skill_pull.py"), join(base, OPS, "skill_pull.py"));
  edit(base, OPS + "/skill_pull.py", (t) => t.replace(/    missing = \[\]\n    for sd in src_dirs:[\s\S]*?    return sorted\(missing\)/, "    return []"));
  r = run(base, "H2");
  ok(gate(r, "H2").some((l) => /verify_membership reported \[\] for a fixture missing beta and a SKILL\.md for gamma/.test(l)), "H2: a verifier that counts files and misses an absent skill is reported", r.stdout);
  copyFileSync(join(repo, OPS, "skill_pull.py"), join(base, OPS, "skill_pull.py"));
  edit(base, OPS + "/skill_pull.py", (t) => t.replace(/(not usable in the destination[^\n]*\n)\s+sys\.exit\(2\)/, "$1            pass"));
  r = run(base, "H2");
  ok(r.status === 1 && gate(r, "H2").some((l) => /missing skill does not end the run with an exit code/.test(l)), "H2: a membership check whose result never ends the run is reported", r.stdout);
  copyFileSync(join(repo, OPS, "skill_pull.py"), join(base, OPS, "skill_pull.py"));
  edit(base, OPS + "/skill_pull.py", (t) => t.replace("def verify_membership(", "def verify_other("));
  r = run(base, "H2");
  ok(gate(r, "H2").some((l) => /has no importable verify_membership/.test(l)), "H2: a script without the verifier is reported", r.stdout);
  copyFileSync(join(repo, OPS, "skill_pull.py"), join(base, OPS, "skill_pull.py"));

  // ---- H3: junction / hardlink probe before any dedupe deletion ----------------------------------------------------------------------
  put(base, OPS + "/dedupe_skills.py", 'import os, shutil\n\ndef sweep(path):\n    shutil.rmtree(path)\n');
  r = run(base, "H3");
  ok(r.status === 1 && gate(r, "H3").some((l) => /dedupe_skills\.py: rmtree in sweep\(\) deletes without a junction\/hardlink probe/.test(l)), "H3: a tree deletion with no link probe is reported", r.stdout);
  put(base, OPS + "/dedupe_skills.py", 'import os, shutil\n\ndef sweep(path):\n    if os.path.islink(path):\n        return\n    shutil.rmtree(path)\n');
  ok(run(base, "H3").status === 0, "H3: the same deletion behind os.path.islink passes");
  put(base, OPS + "/dedupe_skills.py", 'import os, shutil\n\ndef sweep(path):\n    if os.path.realpath(path) != path:\n        return\n    shutil.rmtree(path)\n');
  ok(run(base, "H3").status === 0, "H3: realpath counts as a link probe");
  put(base, OPS + "/dedupe_skills.py", 'import shutil\n\ndef sweep(path):\n    shutil.rmtree(path)  # link-probe-exempt: path is a mkdtemp directory made above\n');
  ok(run(base, "H3").status === 0, "H3: an exemption with a reason passes");
  put(base, OPS + "/dedupe_skills.py", 'import shutil\n\ndef sweep(path):\n    shutil.rmtree(path)  # link-probe-exempt:\n');
  ok(run(base, "H3").status === 1, "H3: an exemption without a reason does not count");
  put(base, OPS + "/dedupe_skills.py", 'import os\n\ndef remove_duplicates(paths):\n    for p in paths[1:]:\n        os.remove(p)\n');
  r = run(base, "H3");
  ok(r.status === 1 && gate(r, "H3").some((l) => /remove in remove_duplicates\(\) deletes without a junction/.test(l)), "H3: a file deletion inside a duplicate-removing function is reported", r.stdout);
  put(base, OPS + "/dedupe_skills.py", 'import shutil\n\ndef sweep(path):\n    # link-probe-exempt:\n    shutil.rmtree(path)\n');
  ok(run(base, "H3").status === 1, "H3: an empty exemption on the line above does not count (the reason must be on the same line)");
  put(base, OPS + "/dedupe_skills.py", 'import shutil\n\ndef sweep(path):\n    # link-probe-exempt: path is a mkdtemp directory made above\n    shutil.rmtree(path)\n');
  ok(run(base, "H3").status === 0, "H3: an exemption with a reason alone on the line above counts");
  put(base, OPS + "/dedupe_skills.py", 'def remove_duplicates(names):\n    seen = []\n    for n in names:\n        if n in seen:\n            seen.remove(n)\n    return seen\n');
  ok(run(base, "H3").status === 0, "H3: list.remove inside a duplicate-removing function is not a file deletion");
  put(base, OPS + "/dedupe_skills.py", 'from pathlib import Path\n\ndef dedupe(paths):\n    for p in paths[1:]:\n        Path(p).unlink()\n');
  ok(run(base, "H3").status === 1, "H3: Path.unlink inside a dedupe function is reported");
  put(base, OPS + "/dedupe_skills.py", 'import os\n\ndef cleanup(p):\n    os.remove(p)\n');
  ok(run(base, "H3").status === 0, "H3: a plain file deletion outside a dedupe function is not a dedupe deletion");
  rmSync(join(base, OPS, "dedupe_skills.py"));
} finally { rmSync(base, { recursive: true, force: true }); }

// the real owner-machine scripts keep the properties the gates read (so a refactor that drops them fails here and in the PR guard alike)
const text = (f) => readFileSync(join(repo, f), "utf8");
ok(/purge_orphan_snapshots\(\)/.test(text(OPS + "/backup_agentdb_chunked.py")), "the backup script calls purge_orphan_snapshots");
ok(/is_link\(target\)/.test(text(OPS + "/skill_pull.py")) && /verify_membership\(skill_dirs/.test(text(OPS + "/skill_pull.py")), "skill_pull probes the destination link and verifies membership");
ok(existsSync(join(repo, "scripts", "fleet_lessons_gates.py")), "the gate script is in scripts/");

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
