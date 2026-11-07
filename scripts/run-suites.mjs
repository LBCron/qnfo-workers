#!/usr/bin/env node
// scripts/run-suites.mjs: SUITE-RUNNER-1 (transformation levers T1.10 and T5.4, pillar autonomy).
//
// WHAT   Runs the repository's offline suites (<worker>/*.test.mjs and scripts/*.test.mjs) so that no suite depends on
//        someone remembering to wire it into a workflow. With --changed-file it runs every suite of each changed worker
//        directory; when a changed directory is a control-plane worker (CONTROL_PLANE, mirrored from qnfo-fleet-control
//        TP_CONTROL_PLANE and checked by scripts/run-suites.test.mjs) or a shared path (scripts, .github, migrations, _shared,
//        or a root file, "."), it runs every suite in the repository (MERGE-BOUNDARY-GATE-1). --all runs every suite (push to
//        main, merge queue, manual dispatch). A suite that is red on main for a reason outside the change can be listed, with
//        an issue, a reason and an expiry, in scripts/suite-quarantine.txt: it then runs and is reported but does not fail the
//        run until the entry expires (the explicit, recorded override; an expired or malformed entry fails the run).
// WHY    On 2026-10-06, 19 suites were referenced by no workflow, and three of them (radar-hub away-gate, taste-learn,
//        title-noise) had been failing on main unnoticed. Code-loop PRs are only as safe as the suites that run on them,
//        and the control plane can only be opened to the loop (T1.8) once its PRs run the full set (T5.4).
// USAGE  node scripts/run-suites.mjs --all | --changed-file /tmp/changed.txt [--jobs 4] [--timeout 180] [--list]
//        Exit 1 when any selected suite fails or times out. No network, no secrets; suites are run with node.
import { readdirSync, existsSync, readFileSync, statSync, mkdtempSync, copyFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const CONTROL_PLANE = ["qnfo-fleet-control", "qnfo-ops", "qnfo-deploy-guard", "qnfo-containers-pilot", "qnfo-gateway", "qnfo-ai", "qnfo-autonomy-scorer", "qnfo-observability", "qnfo-code-orchestrator", "qnfo-code-agent"];
// "." stands for a change to a file at the repository root (deploy-targets.txt, the root worker.js and wrangler.toml); the workflow
// writes it into the changed-dirs file. `_shared` holds code copied into workers by their build scripts.
export const SHARED = ["scripts", ".github", "migrations", "_shared", "."];

// Every suite file in the repository, as relative paths, sorted.
/**
 * Finds the top-level test suites in a checkout.
 * @param {string} root Repository root.
 * @returns {string[]} Sorted suite paths relative to `root`.
 */
export function discover(root) {
  const out = [];
  for (const d of readdirSync(root).sort()) {
    if (d.startsWith(".") || d === "node_modules") continue;
    const p = join(root, d);
    let st; try { st = statSync(p); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    for (const f of readdirSync(p).sort()) if (f.endsWith(".test.mjs")) out.push(d + "/" + f);
  }
  return out;
}

// The suites a change needs: every suite of each changed directory plus the guards. The FULL set runs when the change touches a
// shared path (scripts, .github, migrations, _shared, a root file) or a control-plane worker (CONTROL_PLANE). History: PRS-SCOPE-1
// (2026-10-17) took the control plane out of the full-set rule because one worker's stale suite blocked every PR in the fleet;
// MERGE-BOUNDARY-GATE-1 (2026-10-19, agent_issues 2830) puts it back, because a control-plane change is the one that can break a
// suite in another directory, and the full set takes about two minutes and was green on that day (527 of 527). The failure PRS-SCOPE-1
// removed is handled by the quarantine file instead of by skipping suites. Every other worker still runs its own suites, so one
// worker's PR is not held by an unrelated directory.
// SUITE-GUARDS-ALWAYS-1 (2026-10-12): the repository-wide guard suites scan every suite or worker, so they run for any
// change at all; PR 946 (one worker) merged a range-regex VERSION pin that version-pin-guard refused on the next full-set run.
export const ALWAYS = ["scripts/version-pin-guard.test.mjs", "scripts/cron-single-trigger.test.mjs", "scripts/prompt-cache.test.mjs", "scripts/corruption-guard.test.mjs", "scripts/ai-counter-tokens.test.mjs"];
// SUITE-DEPENDENTS-1 (2026-10-19, agent_issues 2830 MERGE-BOUNDARY-GATE-1): a suite in one directory that reads a file of another
// ("../qnfo-gateway/worker.js", 15 suites on 2026-10-19, e.g. qnfo-email/unsub-link.test.mjs and qnfo-research-exec/ground.test.mjs)
// did not run when only that other directory changed, so a PR could merge green and break it on main. With a reader (the CLI
// passes one), select() also takes every suite whose text names "../<changed dir>/"; without one it is unchanged.
/**
 * Finds suites outside changed directories that read files from those directories.
 * @param {string[]} all Discovered suite paths.
 * @param {string[]} dirs Changed top-level directories.
 * @param {(suite: string) => string} read Reads a suite's source text.
 * @returns {string[]} Dependent suite paths.
 */
export function dependents(all, dirs, read) {
  if (typeof read !== "function" || !dirs.length) return [];
  const out = [];
  for (const s of all) {
    if (dirs.includes(s.split("/")[0])) continue;
    let t = "";
    try { t = String(read(s) || ""); } catch (e) { continue; }
    if (dirs.some((d) => t.includes("../" + d + "/"))) out.push(s);
  }
  return out;
}
/**
 * Selects suites for a change, widening to the full set for shared or control-plane paths.
 * @param {string[]} all Discovered suite paths.
 * @param {string[]} changedDirs Changed top-level directories; `"."` denotes a root-file change.
 * @param {(suite: string) => string} [read] Reads suite source to identify cross-directory dependencies.
 * @returns {{suites: string[], reason: string}} The selected suites and an explanation of the selection.
 */
export function select(all, changedDirs, read) {
  const dirs = Array.from(new Set((changedDirs || []).map((d) => String(d).trim()).filter(Boolean)));
  const wide = dirs.filter((d) => SHARED.includes(d) || CONTROL_PLANE.includes(d));
  if (wide.length) return { suites: all.slice(), reason: "full set: " + wide.join(", ") + " changed" };
  const dep = dependents(all, dirs, read);
  const picked = all.filter((s) => dirs.includes(s.split("/")[0]) || (dirs.length && ALWAYS.includes(s)) || dep.includes(s));
  return { suites: picked, reason: dirs.length ? "suites of " + dirs.join(", ") + " plus the repository guards" + (dep.length ? " and " + dep.length + " suite(s) that read them (" + dep.join(", ") + ")" : "") : "no worker directory changed" };
}

// MERGE-BOUNDARY-GATE-1 override: scripts/suite-quarantine.txt, one entry per line,
//   <dir>/<name>.test.mjs | <expires YYYY-MM-DD, at most QUARANTINE_MAX_DAYS ahead> | <issue or PR reference> | <reason, 10+ chars>
// A listed suite still runs. While its entry is live a failure is reported (::warning) and does not fail the run; a pass is reported as
// a stale entry. An entry past its expiry no longer excuses its suite (a red suite then fails the run again, a green one makes the
// line a warning to delete), and an entry with a horizon beyond the maximum or a malformed line FAILS the run, so an override cannot
// become permanent by being forgotten (the same expiring shape as scripts/cron-tempo-allowlist.txt) and a forgotten line cannot
// block a green fleet.
export const QUARANTINE_FILE = "scripts/suite-quarantine.txt";
export const QUARANTINE_MAX_DAYS = 7;
/**
 * Parses expiring suite-quarantine entries and reports malformed or stale entries.
 * @param {string} text Quarantine file contents.
 * @param {string} today Current date in `YYYY-MM-DD` form.
 * @returns {{active: Map<string, {suite: string, expires: string, ref: string, reason: string}>, problems: string[], warnings: string[]}}
 */
export function parseQuarantine(text, today) {
  const active = new Map(), problems = [], warnings = [];
  const t0 = Date.parse(today + "T00:00:00Z");
  String(text || "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const p = line.split("|").map((x) => x.trim());
    const where = QUARANTINE_FILE + ":" + (i + 1);
    if (p.length < 4 || !/^[^/\s]+\/[^/\s]+\.test\.mjs$/.test(p[0]) || !/^\d{4}-\d{2}-\d{2}$/.test(p[1]) || !p[2] || p[3].length < 10) { problems.push(where + ": malformed entry (need: suite | YYYY-MM-DD | issue | reason of 10+ characters)"); return; }
    const exp = Date.parse(p[1] + "T00:00:00Z");
    if (!(exp >= t0)) { warnings.push(where + ": the quarantine of " + p[0] + " expired " + p[1] + " and no longer excuses it (fix the suite or renew the entry with a new reason; delete the line when the suite is green)"); return; }
    if (exp > t0 + QUARANTINE_MAX_DAYS * 864e5) { problems.push(where + ": the expiry " + p[1] + " is more than " + QUARANTINE_MAX_DAYS + " days away"); return; }
    active.set(p[0], { suite: p[0], expires: p[1], ref: p[2], reason: p[3] });
  });
  return { active, problems, warnings };
}
// failed: result rows ({suite, code}). Returns the failures that still fail the run, the ones an override covers, and the live
// entries whose suite passed (stale: delete the line).
/**
 * Separates actual failures, quarantined failures, and quarantine entries for passing suites.
 * @param {{suite: string, code: number}[]} results Suite results.
 * @param {Map<string, {suite: string, expires: string, ref: string, reason: string}>} active Valid, unexpired overrides.
 * @returns {{real: object[], quarantined: object[], stale: object[]}}
 */
export function applyQuarantine(results, active) {
  const real = [], quarantined = [];
  for (const r of results.filter((x) => x.code !== 0)) { const q = active.get(r.suite); if (q) quarantined.push({ ...r, q }); else real.push(r); }
  const stale = [...active.values()].filter((q) => results.some((r) => r.suite === q.suite && r.code === 0));
  return { real, quarantined, stale };
}

// SUITE-SYNTAX-CHECK-1 (2026-10-13, failure mode version-note-comment-terminator): node --check every worker.js and
// deployed-current.worker.js of the changed worker directories (all worker directories with --all), before any suite. Only
// charter-guard (qnfo-fleet-control) and code-loop-test (qnfo-code-orchestrator) syntax-checked a worker before, so a
// VERSION note containing the two characters that close a block comment broke a worker that has no suite.
/**
 * Lists Worker entrypoint files that need syntax checks for the selected change.
 * @param {string} root Repository root.
 * @param {string[]} changedDirs Changed top-level directories.
 * @param {boolean} everyWorker Whether to include all directories containing `worker.js`.
 * @returns {string[]} Existing Worker entrypoints and deployment mirrors.
 */
export function syntaxTargets(root, changedDirs, everyWorker) {
  let dirs;
  if (everyWorker) dirs = readdirSync(root).filter((d) => !d.startsWith(".") && existsSync(join(root, d, "worker.js")));
  else dirs = Array.from(new Set((changedDirs || []).map((d) => String(d).trim()).filter((d) => d && !SHARED.includes(d))));
  const out = [];
  for (const d of dirs.sort()) for (const f of ["worker.js", "deployed-current.worker.js"]) if (existsSync(join(root, d, f))) out.push(d + "/" + f);
  return out;
}

// node 22 "--check" on a .js file that is an ES module exits 0 without parsing it as a module (module detection), so a
// worker with "export default" passed even with a syntax error; a module-shaped file is checked as a .mjs copy instead.
/**
 * Detects source with an import or export declaration that needs module-mode syntax checking.
 * @param {string} text Source text.
 * @returns {boolean} Whether the source appears to be an ES module.
 */
export function isModuleSource(text) { return /^\s*(export\s|import\s*[\w{*"'])/m.test(String(text || "")); }
function checkSyntax(root, file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let target = file;
    if (isModuleSource(readFileSync(join(root, file), "utf8"))) {
      target = join(mkdtempSync(join(tmpdir(), "syntax-")), file.replace(/[\\/]/g, "__") + ".mjs");
      copyFileSync(join(root, file), target);
    }
    const child = spawn(process.execPath, ["--check", target], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { out += b; });
    child.on("close", (code) => resolve({ suite: file + " (node --check)", code: code === null ? 124 : code, ms: Date.now() - t0, out }));
  });
}

// RUN-SUITES-HOUR-EDGE-1 (2026-10-20, CI-TEST-CLOCKS-1): a suite that reads the clock twice, or compares a clock-keyed digest across a few minutes, can
// straddle an hour or a UTC midnight (deploy-gate main run 39343415552 failed for five minutes a day). The suites are fixed one by one in CI-TEST-CLOCKS-1;
// this is the class fix: a suite is not started in the last HOUR_EDGE_GUARD_S seconds before an hour edge, so every suite runs whole on one side of every
// hour and midnight while it takes under that long. Returns the wait in ms (0 when the start is clear of the edge).
export const HOUR_EDGE_GUARD_S = 10;
/**
 * Returns a delay when starting now would put a suite across an hour boundary.
 * @param {number} nowMs Current time in milliseconds since the Unix epoch.
 * @param {number} [guardS=HOUR_EDGE_GUARD_S] Guard interval before the boundary, in seconds.
 * @returns {number} Milliseconds to wait, or zero when the start is safe.
 */
export function msUntilSafeStart(nowMs, guardS = HOUR_EDGE_GUARD_S) {
  const toEdge = 3600000 - (nowMs % 3600000);
  return toEdge <= guardS * 1000 ? toEdge + 1000 : 0;
}

async function runOne(root, suite, timeoutS) {
  const wait = msUntilSafeStart(Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, ["--no-warnings", suite], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { out += b; });
    const timer = setTimeout(() => { out += "\n[run-suites] timed out after " + timeoutS + " s"; child.kill("SIGKILL"); }, timeoutS * 1000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ suite, code: code === null ? 124 : code, ms: Date.now() - t0, out }); });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const root = process.cwd();
  const all = discover(root);
  let sel, syn;
  if (argv.includes("--all")) { sel = { suites: all, reason: "--all" }; syn = syntaxTargets(root, [], true); }
  else {
    const f = arg("--changed-file", null);
    if (!f || !existsSync(f)) { console.error("usage: run-suites.mjs --all | --changed-file <file of changed top-level dirs>"); process.exit(2); }
    const changed = readFileSync(f, "utf8").split(/\r?\n/);
    sel = select(all, changed, (suite) => readFileSync(join(root, suite), "utf8"));
    syn = syntaxTargets(root, changed, false);
  }
  console.log("SUITE-RUNNER-1: " + sel.suites.length + " of " + all.length + " suites (" + sel.reason + ")");
  // PR-GATE-SPEED-1 (2026-10-26): tell the workflow whether every discovered suite is about to run. deploy-gate has 56 named steps that each run
  // one discovered suite again, 150+ seconds of a 376-second gate (median of 30 green pull request runs); they now run only when this says scoped.
  // Written before any suite runs, so a runner that fails midway still reports the set it started; when the output file is missing the steps run.
  if (process.env.GITHUB_OUTPUT) { try { appendFileSync(process.env.GITHUB_OUTPUT, "mode=" + (sel.suites.length === all.length ? "full" : "scoped") + "\n"); } catch { /* the workflow then treats the mode as unknown and runs the named steps */ } }
  if (argv.includes("--list")) { sel.suites.forEach((s) => console.log("  " + s)); return; }
  const jobs = Math.max(1, Number(arg("--jobs", 4)) || 4), timeoutS = Math.max(10, Number(arg("--timeout", 180)) || 180);
  const queue = sel.suites.slice(), results = [];
  for (const file of syn) { const r = await checkSyntax(root, file); if (r.code !== 0) results.push(r); }
  console.log("SUITE-SYNTAX-CHECK-1: " + syn.length + " worker file(s) syntax-checked, " + results.length + " failed");
  await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) results.push(await runOne(root, queue.shift(), timeoutS)); }));
  results.sort((a, b) => a.suite.localeCompare(b.suite));
  // MERGE-BOUNDARY-GATE-1: the recorded override (scripts/suite-quarantine.txt). Read from the checkout, never from the network.
  const today = arg("--today", new Date().toISOString().slice(0, 10));
  const qf = join(root, QUARANTINE_FILE);
  const q = existsSync(qf) ? parseQuarantine(readFileSync(qf, "utf8"), today) : { active: new Map(), problems: [], warnings: [] };
  const split = applyQuarantine(results, q.active);
  const failed = split.real;
  for (const r of results) console.log((r.code === 0 ? "ok   " : q.active.has(r.suite) ? "QUAR " : "FAIL ") + String(r.ms).padStart(6) + " ms  " + r.suite);
  for (const r of failed) { console.log("\n::group::FAIL " + r.suite + " (exit " + r.code + ")"); console.log(r.out.split("\n").slice(-40).join("\n")); console.log("::endgroup::"); }
  for (const r of split.quarantined) console.log("::warning::SUITE-QUARANTINE-1 " + r.suite + " is red and quarantined until " + r.q.expires + " (" + r.q.ref + "): " + r.q.reason);
  for (const x of split.stale) console.log("::warning::SUITE-QUARANTINE-1 " + x.suite + " passes: delete its line in " + QUARANTINE_FILE);
  for (const w of q.warnings) console.log("::warning::SUITE-QUARANTINE-1 " + w);
  for (const p of q.problems) console.log("::error::SUITE-QUARANTINE-1 " + p);
  console.log("\nSUITE-RUNNER-1: " + (results.length - failed.length - split.quarantined.length) + " passed, " + failed.length + " failed" + (split.quarantined.length ? ", " + split.quarantined.length + " quarantined" : ""));
  process.exit(failed.length || q.problems.length ? 1 : 0);
}

// ENTRY-POINT-1 (2026-10-17): `import.meta.url === "file://" + process.argv[1]` is POSIX-only. On Windows
// process.argv[1] is "C:\\...\\run-suites.mjs", so the comparison never matched: the runner printed nothing and
// exited 0, i.e. it reported a pass without running a single suite. pathToFileURL normalises both sides.
function isEntry() {
  try { return import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; }
}
if (isEntry()) main();
