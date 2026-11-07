// W-META-GUARD-1 (2026-11-06, agent_issues 1002314-1002318 class): every worker that writes ai_call_counters
// records out_tok and neurons, so cost and output stay attributable per purpose everywhere AI runs in the fleet.
// The W-META findings (idea-hub/triage 1010 calls, owner-corpus 278, personal-companion/factcheck 667, embed-index 168)
// all had counters that counted calls but zero output tokens and zero neurons. This guard scans every worker entry:
// a worker whose worker.js INSERTs into ai_call_counters without the out_tok and neurons columns fails here instead of
// shipping another unattributed consumer. Runs for every change via ALWAYS in scripts/run-suites.mjs.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const rows = [];
for (const d of readdirSync(root).sort()) {
  if (d.startsWith(".") || d === "node_modules") continue;
  let st; try { st = statSync(join(root, d)); } catch { continue; }
  if (!st.isDirectory()) continue;
  let src;
  try { src = readFileSync(join(root, d, "worker.js"), "utf8"); } catch { continue; }
  const inserts = src.match(/INSERT INTO ai_call_counters[^"]*/g) || [];
  for (const ins of inserts) {
    if (!/out_tok/.test(ins) || !/neurons/.test(ins)) {
      rows.push(d + ": ai_call_counters INSERT without out_tok/neurons: " + ins.slice(0, 120));
    }
  }
}
if (rows.length) {
  console.error("W-META-GUARD-1 FAIL\n  " + rows.join("\n  "));
  process.exit(1);
}
console.log("W-META-GUARD-1 PASS: every ai_call_counters writer records out_tok and neurons");
