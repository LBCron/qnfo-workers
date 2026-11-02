import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(join(tmpdir(), "sync-version-capture-"));
const scripts = join(root, "scripts");
mkdirSync(scripts);

try {
  const files = [
    "patch-sync-version-capture-1.py",
    "deploy-drift-guard.py",
    "fleet-autoaudit.py",
  ];
  const before = new Map();
  for (const file of files) {
    const source = join(repo, "scripts", file);
    const target = join(scripts, file);
    copyFileSync(source, target);
    before.set(file, readFileSync(target, "utf8"));
  }

  const result = spawnSync("python3", [join(scripts, files[0])], {
    encoding: "utf8",
    env: { ...process.env, REPO_ROOT: root },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /fleet-autoaudit\.py: already applied/);
  for (const file of files.slice(1)) {
    assert.equal(readFileSync(join(scripts, file), "utf8"), before.get(file));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
