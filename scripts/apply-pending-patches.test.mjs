// VERSION-FLOOR-1 offline suite for scripts/apply-pending-patches.py (the applier behind .github/workflows/apply-pending-patches.yml).
// On 2026-11-04 a dispatched run landed toolbudget-do-loop-parity-1-patch.py (2026-09-30) on branch fleet-bot/apply-pending-patches: its anchor still matched, so it would have
// replaced qnfo-ops VERSION "2.62.20-tool-arg-alias" with "2.38.14-do-loop-budget-parity" and added a second final round the file already had. Runs the real applier against a
// throw-away git repository and proves: a patch that lowers a worker bundle's VERSION core is reverted and reported (the file is byte-identical to HEAD afterwards), a patch
// that raises it still lands, a patch that keeps the VERSION still lands, an equal core with a different suffix is not a downgrade, and the retired toolbudget applier is skipped when
// the do-session bail record is in qnfo-ops/worker.js and run when it is absent.
// Run: node --no-warnings scripts/apply-pending-patches.test.mjs   -> prints "N passed, 0 failed"
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APPLIER = join(here, "apply-pending-patches.py");
const PY = ["python3", "python"].find((c) => spawnSync(c, ["-I", "-c", "import sys"], { encoding: "utf8" }).status === 0);
if (!PY) { console.log("apply-pending-patches.test: no python on this runner; skipped"); process.exit(0); }
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const git = (cwd, ...a) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...a], { cwd, encoding: "utf8" });

const worker = (v, extra = "") => 'var VERSION = "' + v + '";\n' + extra + "export default { fetch() { return new Response('ok'); } };\n";
// each fake patcher rewrites the VERSION literal of one worker bundle (a patch always edits the bundle and its mirror)
const patcher = (dir, newVersion) => [
  "import pathlib, re, sys",
  "root = pathlib.Path(__file__).resolve().parent.parent",
  "for name in ('worker.js', 'deployed-current.worker.js'):",
  "    p = root / '" + dir + "' / name",
  "    t = p.read_text(encoding='utf-8')",
  "    n = re.sub(r'var VERSION = \"[^\"]*\"', 'var VERSION = \"" + newVersion + "\"', t, count=1)",
  "    p.write_text(n, encoding='utf-8', newline='')",
  "print('APPLIED " + dir + " -> " + newVersion + "')",
  "",
].join("\n");

const run = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "apr-"));
  for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text, { newline: "" }); }
  git(dir, "init", "-q", "-b", "main"); git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "base");
  const r = spawnSync(PY, ["-I", APPLIER], { cwd: dir, encoding: "utf8", env: { ...process.env, REPO_ROOT: dir } });
  let report = {};
  try { report = JSON.parse(readFileSync(join(dir, "ci-status", "apply-pending-report.json"), "utf8")); } catch { /* reported below */ }
  const verdict = (name) => (report.results || []).find((x) => x.script === name)?.verdict;
  const read = (rel) => readFileSync(join(dir, rel), "utf8").replace(/\r\n/g, "\n"); // a Windows checkout restores CRLF; the comparison is about content
  return { dir, r, report, verdict, read };
};

// 1. a patch that lowers the VERSION is reverted and reported
{
  const base = worker("2.62.20-tool-arg-alias");
  const t = run({ "w1/worker.js": base, "w1/deployed-current.worker.js": base, "scripts/down-patch.py": patcher("w1", "2.38.14-old-literal") });
  ok(t.r.status === 0, "the applier ran to completion", t.r.stderr.slice(0, 300));
  ok(t.verdict("down-patch.py") === "version-downgrade-reverted", "a patch that lowers the VERSION is reverted and reported", t.report.results);
  ok(t.read("w1/worker.js") === base && t.read("w1/deployed-current.worker.js") === base, "both bundles are byte-identical to HEAD afterwards");
  ok(!(t.report.landed || []).includes("down-patch.py"), "it is not listed as landed", t.report.landed);
  ok((t.report.reverted || []).some((x) => x.script === "down-patch.py" && JSON.stringify(x.version_downgrade || []).includes("2.62.20") && JSON.stringify(x.version_downgrade).includes("2.38.14")), "the report names the committed and the lowered core", t.report.reverted);
  ok(/VERSION-FLOOR-1 down-patch\.py would lower/.test(t.r.stdout), "the log says why", t.r.stdout.slice(-400));
  rmSync(t.dir, { recursive: true, force: true });
}
// 2. a patch that raises the VERSION lands; one that keeps it lands; an equal core with another suffix is not a downgrade
{
  const base = worker("1.4.0-base");
  const t = run({
    "up/worker.js": base, "up/deployed-current.worker.js": base,
    "same/worker.js": base, "same/deployed-current.worker.js": base,
    "scripts/up-patch.py": patcher("up", "1.4.1-fix"),
    "scripts/same-core-patch.py": patcher("same", "1.4.0-other-suffix"),
  });
  ok(t.verdict("up-patch.py") === "landed" && t.read("up/worker.js").includes('"1.4.1-fix"'), "a patch that raises the VERSION lands", t.report.results);
  ok(t.verdict("same-core-patch.py") === "landed" && t.read("same/worker.js").includes('"1.4.0-other-suffix"'), "an equal numeric core with another suffix is not a downgrade", t.report.results);
  rmSync(t.dir, { recursive: true, force: true });
}
// 3. a downgrade in one patch does not undo another patch that landed earlier in the run
{
  const a = worker("3.0.0-a"), b = worker("5.1.0-b");
  const t = run({
    "a/worker.js": a, "a/deployed-current.worker.js": a, "b/worker.js": b, "b/deployed-current.worker.js": b,
    "scripts/a-patch.py": patcher("a", "3.0.1-a"),
    "scripts/b-down-patch.py": patcher("b", "1.0.0-b"),
  });
  ok(t.verdict("a-patch.py") === "landed" && t.read("a/worker.js").includes('"3.0.1-a"'), "an earlier landed patch survives", t.report.results);
  ok(t.verdict("b-down-patch.py") === "version-downgrade-reverted" && t.read("b/worker.js") === b, "the later downgrade is reverted alone", t.report.results);
  rmSync(t.dir, { recursive: true, force: true });
}
// 4. the retired toolbudget applier: skipped when the bail record is in the tree, run when it is not
const TOKEN = 'try { await logToolBudgetBail(this.env, "do-session", 0, "", maxIters, false); } catch (e) { }\n';
{
  const withBail = worker("2.62.20-tool-arg-alias", TOKEN);
  const t = run({ "qnfo-ops/worker.js": withBail, "scripts/toolbudget-do-loop-parity-1-patch.py": patcher("qnfo-ops", "2.38.14-do-loop-budget-parity") });
  ok((t.report.retired || []).includes("toolbudget-do-loop-parity-1-patch.py"), "the toolbudget applier is retired while the do-session bail record is present", t.report.retired);
  ok(t.verdict("toolbudget-do-loop-parity-1-patch.py") === undefined && t.read("qnfo-ops/worker.js") === withBail, "a retired applier is not run and the file is untouched", t.report.results);
  rmSync(t.dir, { recursive: true, force: true });
}
{
  const without = worker("2.62.20-tool-arg-alias");
  const t = run({ "qnfo-ops/worker.js": without, "scripts/toolbudget-do-loop-parity-1-patch.py": patcher("qnfo-ops", "2.38.14-do-loop-budget-parity").replace("'deployed-current.worker.js'", "'worker.js'") });
  ok(!(t.report.retired || []).includes("toolbudget-do-loop-parity-1-patch.py"), "without the bail record the applier is not retired", t.report.retired);
  ok(t.verdict("toolbudget-do-loop-parity-1-patch.py") === "version-downgrade-reverted" && t.read("qnfo-ops/worker.js") === without, "and if it runs anyway its VERSION downgrade is reverted", t.report.results);
  rmSync(t.dir, { recursive: true, force: true });
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
