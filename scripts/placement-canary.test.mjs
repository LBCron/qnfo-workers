// SMART-PLACEMENT-CANARY-1 (ROADMAP-1 #5722; charter pillar cost): Smart Placement is declared one component at a time. The set below is the
// canary list; a [placement] table anywhere else, or a mode the canonical deploy ignores (qnfo-ops parseDeclaredPlacement accepts only "smart"),
// fails here so a second component is added on purpose, with its own measurement.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANARY = ["personal-api"];
let failed = 0, passed = 0;
const ok = (c, m, d) => { if (c) passed++; else { failed++; console.log("FAIL " + m + (d ? " :: " + d : "")); } };
const declared = [];
for (const d of readdirSync(root)) {
  const f = join(root, d, "wrangler.toml");
  if (!existsSync(f) || existsSync(join(root, d, "RETIRED")) || existsSync(join(root, d, "FOLDED"))) continue;
  const t = readFileSync(f, "utf8").replace(/#.*$/gm, "");
  const m = /^\[placement\][ \t]*\r?\n((?:[^\[\r\n][^\r\n]*\r?\n?|\r?\n)*)/m.exec(t);
  if (!m) continue;
  declared.push(d);
  ok(/^mode[ \t]*=[ \t]*"smart"[ \t]*$/m.test(m[1]), d + " declares mode = \"smart\" and no other mode", m[1]);
  ok(!/^(?!mode\b)\w+\s*=/m.test(m[1]), d + " declares no other placement key (the deploy ignores them)", m[1]);
}
ok(JSON.stringify(declared.sort()) === JSON.stringify(CANARY), "only the canary set declares [placement]", JSON.stringify(declared));
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
