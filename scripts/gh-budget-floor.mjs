#!/usr/bin/env node
// GH-BUDGET-FLOOR-1 (issue 7071, charter pillar core). The shared personal GitHub token (QNFO_GH_PAT, 5000 REST calls an hour) read 0/5000 twice on
// 2026-11-04 and stalled PR creation and every merge. A sweep or poller is a convenience; the merge lane is not. Before a sweep spends the token it
// reads GET /rate_limit (free, not counted) with the SAME token it will spend and yields when the remaining budget is under a floor.
//
//   node scripts/gh-budget-floor.mjs --floor 600 --class sweep [--token-env NAME]
//
// Prints one JSON line: {"remaining","limit","reset","floor","class","yield"}; a yield also prints "GH-BUDGET-YIELD {json}" (stable prefix, the
// source of the follow-up metric github_pat_budget_floor_hits_24h). Exit 0 = proceed, 78 = yield (the caller exits success with a log line).
// Class "lane" (merge lane, deploy) has floor 0 and never yields. A probe that errors or is unreachable proceeds: a failed probe never blocks merges.
// Floor: repository variable GH_BUDGET_FLOOR (env) overrides --floor, else 600. Floor 0 disables.
import { pathToFileURL } from "node:url";

export const DEFAULT_FLOOR = 600;
export const YIELD_EXIT = 78;
export const TOKEN_ENVS = ["GH_BUDGET_TOKEN", "GH_PAT_TOKEN", "ORG_TOKEN", "GH_ADMIN_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];

export function resolveFloor(cls, flag, envVal) {
  if (String(cls || "sweep") === "lane") return 0;
  for (const v of [envVal, flag]) {
    if (v === undefined || v === null || String(v).trim() === "") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return DEFAULT_FLOOR;
}

// checkBudget({token, floor, cls, fetchImpl, apiBase}) -> {remaining, limit, reset, floor, class, yield, probe}
export async function checkBudget(o) {
  const cls = o.cls === "lane" ? "lane" : "sweep";
  const floor = cls === "lane" ? 0 : Math.max(0, Number(o.floor) || 0);
  const out = { remaining: null, limit: null, reset: null, floor, class: cls, yield: false, probe: "skipped" };
  if (floor <= 0 || !o.token) return out;
  try {
    const res = await (o.fetchImpl || fetch)((o.apiBase || "https://api.github.com") + "/rate_limit", {
      headers: { authorization: "Bearer " + o.token, accept: "application/vnd.github+json", "user-agent": "gh-budget-floor", "x-github-api-version": "2022-11-28" }
    });
    if (!res || !res.ok) { out.probe = "error-http-" + (res && res.status); return out; }
    const body = await res.json();
    const core = body && body.resources && body.resources.core;
    if (!core || !Number.isFinite(Number(core.remaining))) { out.probe = "error-shape"; return out; }
    out.remaining = Number(core.remaining);
    out.limit = Number(core.limit);
    out.reset = Number.isFinite(Number(core.reset)) ? new Date(Number(core.reset) * 1000).toISOString() : null;
    out.probe = "ok";
    out.yield = out.remaining < floor;
  } catch (e) { out.probe = "error-" + String((e && e.message) || e).slice(0, 60); }
  return out;
}

export const yieldLine = (r, who) => "GH-BUDGET-YIELD " + JSON.stringify(Object.assign({ who: who || "", ts: new Date().toISOString() }, r));

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const env = process.env;
  const names = arg("--token-env") ? [arg("--token-env")] : TOKEN_ENVS;
  const token = names.map((n) => env[n]).find(Boolean) || "";
  const cls = arg("--class") === "lane" ? "lane" : "sweep";
  const r = await checkBudget({ token, cls, floor: resolveFloor(cls, arg("--floor"), env.GH_BUDGET_FLOOR) });
  console.log(JSON.stringify(r));
  if (r.yield) {
    console.log(yieldLine(r, env.GITHUB_WORKFLOW || arg("--who")));
    console.log("budget-floor: remaining=" + r.remaining + " floor=" + r.floor + " reset=" + r.reset + "; skipped");
    process.exitCode = YIELD_EXIT;
  }
}
function isEntry() { try { return import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; } }
if (isEntry()) main();
