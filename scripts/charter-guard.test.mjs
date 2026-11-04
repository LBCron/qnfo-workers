// CHARTER-PILLAR-EVERY-TOML-1 suite (TP-3.9, issue 6796; charter pillar core): charter-guard.py fails on a live wrangler.toml that
// declares no `# charter-pillar:` line or names a key the charter does not grade, and passes on this checkout.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0, passed = 0;
const ok = (c, m, d) => { if (c) passed++; else { failed++; console.log("FAIL " + m + (d ? " :: " + d : "")); } };

const py = process.platform === "win32" ? "python" : "python3";
const run = (root) => spawnSync(py, [join(repo, "scripts", "charter-guard.py")], { env: Object.assign({}, process.env, { CHARTER_ROOT: root }), encoding: "utf8" });

const real = run(repo);
ok(real.status === 0 && /CHARTER-GUARD PASS/.test(real.stdout) && /missing_pillar_line=0/.test(real.stdout), "this checkout passes with every live wrangler.toml carrying a pillar", real.stdout + real.stderr);

const root = mkdtempSync(join(tmpdir(), "charter-guard-"));
try {
  for (const f of ["docs/QUNIVERSE-CHARTER.md", "docs/PORTFOLIO.md", "qnfo-fleet-control/worker.js"]) {
    mkdirSync(join(root, dirname(f)), { recursive: true });
    copyFileSync(join(repo, f), join(root, f));
  }
  mkdirSync(join(root, "demo-a"));
  writeFileSync(join(root, "demo-a", "wrangler.toml"), 'name = "demo-a"\nmain = "worker.js"\n# charter-pillar: core\n');
  ok(run(root).status === 0, "a live worker with a known pillar passes");

  mkdirSync(join(root, "demo-b"));
  writeFileSync(join(root, "demo-b", "wrangler.toml"), 'name = "demo-b"\nmain = "worker.js"\n');
  const r = run(root);
  ok(r.status === 1 && /C6 live worker directory demo-b\//.test(r.stdout), "a live worker with no pillar line fails with C6", r.stdout);

  writeFileSync(join(root, "demo-b", "wrangler.toml"), 'name = "demo-b"\n# charter-pillar: bogus\n');
  const u = run(root);
  ok(u.status === 1 && /names unknown pillar 'bogus'/.test(u.stdout), "an unknown pillar key fails with C6", u.stdout);

  writeFileSync(join(root, "demo-b", "RETIRED"), "retired\n");
  ok(run(root).status === 0, "a RETIRED directory is not graded");
} finally { rmSync(root, { recursive: true, force: true }); }

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
