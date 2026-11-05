// FOLD-RETURN-ORDER-1 (2026-11-05, charter pillar core; cost: WORKER-COUNT-1.3). The qnfo-model-eval member folded into this host returned its default
// export before the guest's trailing top-level statements (`var CRON_GRID_RETRIES = 3;`, `var CRON_GRID_CFG = {...}`), because the fold kit turned
// `export default {` into an inline `return {`. Those assignments never ran, so the member's `scheduled` threw "Cannot read properties of undefined
// (reading 'tick')" on every hourly tick and every 6-hourly battery (CF-OBS group 264a6cbb, 2026-11-05T03:00Z). qnfo-model-eval-fold.test.mjs replaces
// the member's scheduled with a stub, so it could not see it. This suite (1) loads the real host and calls the real member `scheduled` for both of its
// crons with a recording D1 stub, and (2) pins the shape that caused it: in every member IIFE nothing but the closing return follows the last top-level
// `return`, and no top-level var/let/const sits after it.
// Run: node --no-warnings qnfo-ai-calibration/member-statics.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

// 1. Shape: every folded member IIFE (`var <name> = (function () {` ... `})();` at column 0).
{
  const lines = src.split("\n");
  let members = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^var (\w+) = \(function \(\) \{/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith("})();")) j++;
    members++;
    const ret = [];
    for (let k = i + 1; k < j; k++) if (/^return( |\{|;|$)/.test(lines[k])) ret.push(k);
    ok(ret.length >= 1, m[1] + " has a top-level return", ret.length);
    if (!ret.length) continue;
    const last = ret[ret.length - 1];
    const stranded = [];
    for (let k = last + 1; k < j; k++) if (/^(var|let|const|class) /.test(lines[k])) stranded.push((k + 1) + ": " + lines[k].slice(0, 60));
    ok(stranded.length === 0, m[1] + ": no top-level declaration follows its return (those statements would never run)", stranded);
  }
  ok(members >= 2, "the host carries at least the evolve and model-eval members", members);
}

// 2. Behaviour: the real member scheduled, both crons, no throw. cloudflare:* imports are empty functions under node.
{
  const stubbed = src.replace(/^import \{([^}]*)\} from "cloudflare:[^"]+";$/gm, (_, names) => names.split(",").map((n) => n.trim()).filter(Boolean).map((n) => { const p = n.split(/\s+as\s+/); return "function " + (p[1] || p[0]).trim() + "() {}"; }).join("\n"));
  const mod = await import("data:text/javascript;base64," + Buffer.from(stubbed + "\nexport { qnfoModelEvalFoldMod as __member };").toString("base64"));
  const M = mod.__member;
  ok(M && typeof M.scheduled === "function" && typeof M.fetch === "function", "the model-eval member exposes fetch and scheduled", Object.keys(M || {}));
  const stmt = { bind: () => stmt, run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) };
  const env = { AUDIT: { prepare: () => stmt, batch: async () => [] }, AI: { run: async () => ({}) } };
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})), passThroughOnException() {} };
  for (const cron of ["20 * * * *", "17 */6 * * *"]) {
    let err = null;
    try { await M.scheduled({ cron, scheduledTime: Date.now(), type: "scheduled", tickEntry: true }, env, ctx); } catch (e) { err = String(e && e.message || e); }
    ok(err === null, "member scheduled(" + cron + ") does not throw", err);
  }
  await Promise.allSettled(pending);
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
