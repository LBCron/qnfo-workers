// PUSH-GATE-1: the script exits 1 on a failing suite and 0 on a clean one.
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const root = mkdtempSync(join(tmpdir(), "pushgate-"));
mkdirSync(join(root, "scripts")); mkdirSync(join(root, "wk"));
copyFileSync(new URL("./pre_push_check.py", import.meta.url).pathname, join(root, "scripts/pre_push_check.py"));
writeFileSync(join(root, "wk/a.test.mjs"), 'console.log("FAIL seeded"); process.exit(1);');
const bad = spawnSync("python3", ["-I", join(root, "scripts/pre_push_check.py"), "wk", "--skip-guard"], { encoding: "utf8" });
writeFileSync(join(root, "wk/a.test.mjs"), 'console.log("ok");');
const good = spawnSync("python3", ["-I", join(root, "scripts/pre_push_check.py"), "wk", "--skip-guard"], { encoding: "utf8" });
let fail = 0;
if (bad.status !== 1 || !/FAIL a.test.mjs/.test(bad.stdout)) { console.log("FAIL failing suite must exit 1: " + bad.status + bad.stdout); fail++; }
if (good.status !== 0) { console.log("FAIL clean suite must exit 0: " + good.status + good.stdout); fail++; }
console.log("pre_push_check: " + (2 - fail) + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
