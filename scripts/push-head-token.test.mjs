// MAIN-PUSH-POLICY-3 offline suite: every workflow step that calls `scripts/push_head.sh code` carries a token.
// push_head.sh code opens the pull request through the REST API and reads GH_TOKEN or GITHUB_TOKEN ("no token to open a pull request" otherwise, exit 1). GitHub Actions does not export
// the workflow token as an environment variable by itself, so a step must set one. apply-pending-patches (dispatched run 41917344297, 2026-11-04 21:34Z) pushed its branch,
// printed "no token to open a pull request; the change waits on branch fleet-bot/apply-pending-patches" five times and ended red with the change stranded; applier-doctor,
// apply-unmangle-worker-js and mirror-sync carried the same call without the token and had only not yet had anything to land.
// Run: node --no-warnings scripts/push-head-token.test.mjs  -> prints "N passed, 0 failed"
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, ".github", "workflows");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const TOKEN = /^\s+(?:GH_TOKEN|GITHUB_TOKEN):\s*\$\{\{\s*(?:github\.token|secrets\.GITHUB_TOKEN|secrets\.QNFO_GH_PAT)\s*\}\}\s*$/m;
const callers = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".yml"))) {
  const text = readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n");
  if (!/push_head\.sh code\b/.test(text.replace(/^\s*#.*$/gm, ""))) continue;
  const steps = text.split(/\n      - (?=name:|id:|uses:|run:)/).slice(1);
  const jobEnv = TOKEN.test(text.slice(0, text.search(/\n    steps:/)));
  for (const s of steps) {
    if (!/push_head\.sh code\b/.test(s.replace(/^\s*#.*$/gm, ""))) continue;
    const name = (s.match(/^name:\s*(.*)$/m) || [, "(unnamed step)"])[1].slice(0, 60);
    callers.push(f + ": " + name);
    ok(jobEnv || TOKEN.test(s), f + ' step "' + name + '" sets GH_TOKEN (or GITHUB_TOKEN) for push_head.sh code', s.slice(0, 200));
  }
}
ok(callers.length >= 4, "the four known callers are found (apply-pending-patches, applier-doctor, apply-unmangle-worker-js, mirror-sync)", callers);
for (const f of ["apply-pending-patches.yml", "applier-doctor.yml", "apply-unmangle-worker-js.yml", "mirror-sync.yml"]) ok(callers.some((c) => c.startsWith(f + ":")), f + " is among the callers", callers);
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
