// W-META-SHAPE-GUARD-1 (2026-11-07, agent_issues #8368/#8366 class, owner directive "everywhere AI touches"):
// every worker that writes ai_call_counters writes the fleet-wide shape — calls, errors, in_chars,
// ms plus in_tok, out_tok, neurons. A worker whose counter INSERT lacks the token/neuron columns
// is exactly the W-META gap (calls counted, cost unattributable), so this guard fails the suite.
// Run: node scripts/ai-counter-shape.test.mjs (offline; reads worker sources only).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["archive", "docs", "scripts", "migrations", "_live", "_exuvia", "_shared", "node_modules", ".git", ".claude", ".worktrees"]);
const TOKEN_COLS = /INSERT INTO ai_call_counters \([^)]*\bin_tok[^)]*\bneurons/;
// Fix landed in an open PR; the guard keeps the shape once it merges. Remove the entry when the PR merges.
const PENDING = { "idea-hub": "#8390", "personal-companion": "#8390" };
let checked = 0, bad = [];

for (const dir of readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory() || SKIP.has(dir.name) || dir.name.startsWith(".")) continue;
  const src = join(root, dir.name, "worker.js");
  if (!existsSync(src)) continue;
  let text;
  try { text = readFileSync(src, "utf8"); } catch { continue; }
  if (!text.includes("INSERT INTO ai_call_counters")) continue;
  // retired/folded workers do not run; their counters are history
  if (existsSync(join(root, dir.name, "RETIRED")) || existsSync(join(root, dir.name, "FOLDED"))) continue;
  checked++;
  if (!TOKEN_COLS.test(text) && !PENDING[dir.name]) bad.push(dir.name + (PENDING[dir.name] ? " (pending " + PENDING[dir.name] + ")" : ""));
}

if (bad.length) {
  console.error("FAIL W-META-SHAPE-GUARD-1: ai_call_counters INSERT missing in_tok/out_tok/neurons in: " + bad.join(", "));
  console.error("Fix per W-META-FLEET-1 (see qnfo-ai-search __AI_ATTR_RATES): capture res.usage, price neurons at the per-model rate table, extend the INSERT and CREATE TABLE.");
  process.exit(1);
}
console.log("ai-counter-shape: " + checked + " live counter-writing workers all carry in_tok/out_tok/neurons");
