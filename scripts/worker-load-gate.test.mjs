// MERGE-BOUNDARY-GATE-1 offline suite (scripts/worker-load-gate.mjs, agent_issues 2830).
// Proves, on synthetic worker directories in a temp root: the WELLBEING-LOOP-1 break (a relative ESM import in worker.js, 6c60b59a,
// 2026-10-17) is rejected as relative-import while `node --check` accepts the same file; a bare package, a syntax error, a
// top-level throw (TDZ) and a top-level network call are each rejected with their own class; the Workers-only modules and
// service-worker syntax load; a drifted deployed-current.worker.js is checked and an identical one is not loaded twice.
// Also: every real worker entry in this repository loads, and every name a worker imports from a cloudflare: module is in the stub.
// Run: node --no-warnings scripts/worker-load-gate.test.mjs   -> prints "N passed, 0 failed"
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { classify, workerEntries, checkOne, STUB_SOURCES } from "./worker-load-gate.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };

const root = mkdtempSync(join(tmpdir(), "load-gate-"));
function worker(dir, files) {
  mkdirSync(join(root, dir), { recursive: true });
  for (const [f, t] of Object.entries(files)) writeFileSync(join(root, dir, f), t);
}
const GOOD = 'export default { fetch() { return new Response("ok"); } };\n';

worker("good", { "worker.js": GOOD, "deployed-current.worker.js": GOOD });
worker("cfmods", { "worker.js": 'import { DurableObject, WorkflowEntrypoint, RpcTarget, env, tracing } from "cloudflare:workers";\nimport { EmailMessage } from "cloudflare:email";\nimport { connect } from "cloudflare:sockets";\nimport { Buffer } from "node:buffer";\nexport class D extends DurableObject {}\nexport class W extends WorkflowEntrypoint {}\ntracing.enterSpan("probe", (span) => span);\n' + GOOD });
worker("svcworker", { "worker.js": 'addEventListener("fetch", (e) => e.respondWith(new Response("ok")));\n' });
// the 2026-10-17 break: valid syntax, a sibling module that exists on disk, a deploy that uploads one module
worker("wellbeing", { "worker.js": 'import { wellbeingTick } from "./wellbeing-wire.js";\nexport default { fetch() { return new Response(String(wellbeingTick)); } };\n', "wellbeing-wire.js": "export const wellbeingTick = 1;\n" });
worker("parentrel", { "worker.js": 'import { x } from "../wellbeing/wellbeing-wire.js";\n' + GOOD });
worker("barepkg", { "worker.js": 'import { hono } from "hono";\n' + GOOD });
worker("syntax", { "worker.js": "export default { fetch() { return new Response( } };\n" });
worker("tdz", { "worker.js": "const a = b + 1;\nconst b = 2;\n" + GOOD });
worker("toplevelfetch", { "worker.js": 'await fetch("https://example.com/");\n' + GOOD });
worker("drift", { "worker.js": GOOD, "deployed-current.worker.js": 'import { x } from "./x.js";\n' + GOOD });
worker("nomod", { "readme.md": "no worker here" });
worker("missingname", { "worker.js": 'import { Nope } from "cloudflare:workers";\n' + GOOD });

const entries = workerEntries(root);
ok(entries.includes("good/worker.js") && !entries.includes("good/deployed-current.worker.js"), "an identical mirror is not loaded twice", entries);
ok(entries.includes("drift/deployed-current.worker.js"), "a drifted mirror is loaded as well", entries);
ok(!entries.some((e) => e.startsWith("nomod/")), "a directory without worker.js is skipped");
ok(workerEntries(root, ["good"]).join() === "good/worker.js", "--only narrows to the named directories");

const by = {};
for (const e of entries) by[e] = await checkOne(root, e, 20);
ok(by["good/worker.js"].ok, "a plain module worker loads", by["good/worker.js"]);
ok(by["cfmods/worker.js"].ok, "cloudflare:workers tracing, :email, :sockets and node: builtins load against the stubs", by["cfmods/worker.js"]);
ok(by["svcworker/worker.js"].ok, "service-worker syntax (addEventListener at the top level) loads", by["svcworker/worker.js"]);
ok(!by["wellbeing/worker.js"].ok && by["wellbeing/worker.js"].cls === "relative-import", "WELLBEING-LOOP-1 replay: a relative import in worker.js is rejected as relative-import", by["wellbeing/worker.js"]);
ok(!by["parentrel/worker.js"].ok && by["parentrel/worker.js"].cls === "relative-import", "a ../ import is rejected the same way", by["parentrel/worker.js"]);
ok(!by["barepkg/worker.js"].ok && by["barepkg/worker.js"].cls === "unresolved-import", "a bare package nothing bundles is unresolved-import", by["barepkg/worker.js"]);
ok(!by["syntax/worker.js"].ok && by["syntax/worker.js"].cls === "syntax-error", "a syntax error is syntax-error", by["syntax/worker.js"]);
ok(!by["tdz/worker.js"].ok && by["tdz/worker.js"].cls === "eval-error" && /before initialization|ReferenceError/.test(by["tdz/worker.js"].msg), "a top-level TDZ throw is eval-error (node --check cannot see it)", by["tdz/worker.js"]);
ok(!by["toplevelfetch/worker.js"].ok && by["toplevelfetch/worker.js"].cls === "eval-error" && /no network/.test(by["toplevelfetch/worker.js"].msg), "a top-level network call is eval-error: the gate has no network", by["toplevelfetch/worker.js"]);
ok(!by["drift/deployed-current.worker.js"].ok && by["drift/deployed-current.worker.js"].cls === "relative-import", "a drifted deployed-current.worker.js is checked on its own", by["drift/deployed-current.worker.js"]);
ok(!by["missingname/worker.js"].ok && by["missingname/worker.js"].cls === "unresolved-import", "a name the stub does not export fails loudly, so the stub list is kept complete", by["missingname/worker.js"]);

// `node --check` is the check the suite runner had; it passes the 2026-10-17 file, which is the gap this gate closes
const chk = spawnSync(process.execPath, ["--check", join(root, "wellbeing", "worker.js")], { encoding: "utf8" });
ok(chk.status === 0, "node --check accepts the relative-import worker (why a syntax check alone let it merge)", chk.stderr);

// the CLI exits 1 on the broken tree and 0 on the good one, and --json is machine readable
let r = spawnSync(process.execPath, ["--no-warnings", join(repo, "scripts", "worker-load-gate.mjs"), "--root", root, "--json"], { encoding: "utf8" });
let j = null; try { j = JSON.parse(r.stdout.trim().split("\n").pop()); } catch (e) { /* asserted below */ }
ok(r.status === 1 && j && j.failed >= 6 && j.failures.some((f) => f.cls === "relative-import"), "the CLI exits 1 and lists the failures as JSON", { status: r.status, out: r.stdout.slice(0, 200) });
r = spawnSync(process.execPath, ["--no-warnings", join(repo, "scripts", "worker-load-gate.mjs"), "--root", root, "--only", "good,cfmods,svcworker"], { encoding: "utf8" });
ok(r.status === 0 && /3 of 3 worker entries load, 0 failed/.test(r.stdout), "the CLI exits 0 on loadable workers", r.stdout.slice(0, 200));

// classification is pure
ok(classify("Error: LOAD-GATE-RELATIVE-IMPORT ./a.js") === "relative-import" && classify("ERR_MODULE_NOT_FOUND Error: Cannot find package 'x'") === "unresolved-import" && classify("SyntaxError: Unexpected token '}'") === "syntax-error" && classify("TypeError: x is not a function") === "eval-error", "classify() maps each message to its class");

// the real fleet: every worker entry on this checkout loads (the gate is green at birth), and the stub covers every imported name
const real = workerEntries(repo);
// RM-REPO-DEAD-SOURCES-1 (2026-11-05): retired directories move to archive/<name>/ (PRs 7674, 7697, 7708 moved 30 directories; the count read 89 after batch 2), so a floor of 90 turned main red
// after the second batch. The floor now follows the fleet: the charter caps live workers at 30, and 38 are live, so fewer than 30 entries means the scan found nothing.
ok(real.length >= 30, "the repository has its worker directories (at least the charter cap of 30)", real.length);
const bad = [];
const queue = real.slice();
await Promise.all(Array.from({ length: 8 }, async () => { while (queue.length) { const e = queue.shift(); const x = await checkOne(repo, e, 30); if (!x.ok) bad.push(x); } }));
ok(bad.length === 0, "every worker entry in this repository loads", bad.map((b) => b.file + " " + b.cls + " " + b.msg));
const names = new Set();
for (const d of readdirSync(repo)) {
  const f = join(repo, d, "worker.js");
  if (d.startsWith(".") || !existsSync(f)) continue;
  for (const m of readFileSync(f, "utf8").matchAll(/^\s*import\s*\{([^}]*)\}\s*from\s*["']cloudflare:(\w+)["']/gm)) {
    for (const n of m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) names.add(m[2] + ":" + n);
  }
}
const missing = [...names].filter((x) => { const [mod, n] = x.split(":"); return !new RegExp("export (class|const|function) " + n + "\\b|export const [^;]*\\b" + n + "\\b").test(STUB_SOURCES[mod] || ""); });
ok(names.size >= 5 && missing.length === 0, "the stubs export every cloudflare: name a worker imports", { names: [...names], missing });

rmSync(root, { recursive: true, force: true });
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
