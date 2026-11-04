// MIGRATION-GUARD-1 offline suite: .github/workflows/migration-guard.yml runs the header and no-clobber check of every added or changed migration as a check of its own
// that fails the pull request (deploy-gate runs the same command, but advisory on a pull request by design). #5366 merged an edit to the already-applied
// migrations/2026-10-29-plussing-3.sql that MIGRATION-NO-CLOBBER-1 refuses; apply-migrations replayed it on production D1.
// This runs the workflow's real command in throwaway git repositories (a base on main, a pull request branch) against the real scripts/apply_migrations.py.
// Proves: an edit of an applied migration that rewrites a live fleet_tasks row fails; restoring a content the file already had passes (the #5366 revert);
// a valid new migration passes; a REAPPLY-OK edit passes; a change that touches no migration passes without calling the script; the workflow is a blocking,
// uniquely named, read-only check with full history.
// Run: node scripts/migration-guard.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 500))); } };

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const yml = readFileSync(join(root, ".github", "workflows", "migration-guard.yml"), "utf8");

// ---- the workflow itself ----
// PR-CHECK-CAP-5-1: the guard's steps run on a pull request as steps of the `suites` job in pr-checks.yml, gated by the migrations path flag; this file keeps the step source.
const prChecks = readFileSync(join(root, ".github", "workflows", "pr-checks.yml"), "utf8");
ok(/migration_guard=true/.test(prChecks) && /\^migrations\//.test(prChecks) && /steps\.f\.outputs\.migration_guard == 'true'/.test(prChecks) && /apply_migrations\.py --check/.test(prChecks) && /view_premerge\.py/.test(prChecks), "it runs on pull requests that touch migrations");
ok(/^  migration-guard:$/m.test(yml), "the job is named migration-guard (the lane reads checks by name; `guard` is version-bump-guard's)");
ok(!/continue-on-error/.test(yml), "no step is advisory: a refusal fails the check");
ok(/permissions:\n  contents: read\n/.test(yml) && !/(pull-requests|issues|actions|id-token): write/.test(yml), "the token is read-only");
ok(/fetch-depth: 0/.test(yml), "full history, because the guard reads every earlier content of a changed file");
ok(/BASE_REF: \$\{\{ github\.base_ref \}\}/.test(yml) && !/run:[^\n]*\$\{\{/.test(yml), "the base ref travels through env, not into the shell text");
ok(/apply_migrations\.py --check --base "origin\/\$BASE_REF"/.test(yml), "it runs the same --check with --base as deploy-gate");

// ---- extract the real step script ----
const lines = yml.split("\n");
const at = lines.findIndex((l) => /- name: Check the added and changed migrations/.test(l));
const runAt = lines.findIndex((l, i) => i > at && /^\s*run: \|\s*$/.test(l));
const indent = lines[runAt].match(/^\s*/)[0].length + 2;
const body = [];
for (let i = runAt + 1; i < lines.length; i++) {
  if (lines[i].trim() === "") { body.push(""); continue; }
  if (lines[i].match(/^\s*/)[0].length < indent) break;
  body.push(lines[i].slice(indent));
}
const script = body.join("\n");
ok(/git diff --name-only --diff-filter=AM/.test(script) && /exit 0/.test(script), "the real step script was extracted", script.slice(0, 100));

// ---- throwaway repositories ----
const HDR = "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: DELETE FROM fleet_tasks WHERE id='t';\n";
const V1 = HDR + "INSERT OR REPLACE INTO fleet_tasks (id, definition) VALUES ('t', '{\"steps\":[{\"type\":\"sql\",\"name\":\"s1\",\"db\":\"AUDIT\",\"sql\":\"SELECT 1\"}]}');\n";
const V2 = V1 + "-- a comment added later\n";
const NEW_OK = "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: DELETE FROM ops_config WHERE key = 'x_flag';\nINSERT OR IGNORE INTO ops_config (key, value) VALUES ('x_flag', '1');\n";

function repo(baseVersions, pr) {
  const dir = mkdtempSync(join(tmpdir(), "migration-guard-"));
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "scripts")); mkdirSync(join(dir, "migrations"));
  copyFileSync(join(root, "scripts", "apply_migrations.py"), join(dir, "scripts", "apply_migrations.py"));
  writeFileSync(join(dir, "README.md"), "x\n");
  git("add", "-A"); git("commit", "-q", "-m", "base");
  for (const v of baseVersions) { writeFileSync(join(dir, "migrations", "m.sql"), v); git("add", "-A"); git("commit", "-q", "-m", "m.sql"); }
  git("update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git("checkout", "-q", "-b", "pr");
  pr(dir);
  git("add", "-A"); git("commit", "-q", "-m", "pr");
  return dir;
}
function run(dir) {
  const r = spawnSync("bash", ["-e", "-c", script], { cwd: dir, env: Object.assign({}, process.env, { BASE_REF: "main" }), encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
const w = (dir, f, t) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), t); };
const dirs = [];
const scenario = (baseVersions, pr) => { const d = repo(baseVersions, pr); dirs.push(d); return run(d); };

try {
  let r = scenario([V1], (d) => w(d, "migrations/m.sql", V2));
  ok(r.code === 1 && /MIGRATION-NO-CLOBBER-1/.test(r.out), "an edit of a merged migration that rewrites a live fleet_tasks row FAILS the check", r);

  // the #5366 sequence: v1 applied, v2 (an edit) merged, the pull request restores v1
  r = scenario([V1, V2], (d) => w(d, "migrations/m.sql", V1));
  ok(r.code === 0 && /"ok": true/.test(r.out), "restoring a content the file already had passes (the #5366 revert)", r);

  r = scenario([V1], (d) => w(d, "migrations/m.sql", V1 + "-- a genuinely new line\n"));
  ok(r.code === 1 && /MIGRATION-NO-CLOBBER-1/.test(r.out), "a new line is still refused even though the file has history", r);

  r = scenario([V1], (d) => w(d, "migrations/m.sql", "-- REAPPLY-OK: the definition is intentionally re-asserted\n" + V2));
  ok(r.code === 0, "a REAPPLY-OK line allows an intended re-run", r);

  r = scenario([V1], (d) => w(d, "migrations/new.sql", NEW_OK));
  ok(r.code === 0 && /new\.sql/.test(r.out) && /"ok": true/.test(r.out), "a valid new migration passes", r);

  r = scenario([V1], (d) => w(d, "migrations/bad.sql", "CREATE TABLE t_bad (x INTEGER);\n"));
  ok(r.code === 1 && /bad\.sql/.test(r.out), "a new migration with SQL and no header is refused", r);

  r = scenario([V1], (d) => w(d, "README.md", "changed\n"));
  ok(r.code === 0 && /no migration changed/.test(r.out) && !/apply_migrations/.test(r.out), "a change that touches no migration passes without running the check", r);
} finally { for (const d of dirs) rmSync(d, { recursive: true, force: true }); }

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
