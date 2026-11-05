// HEALTH-CONTRACT-1 (agent_issues 2852, capability_contract_conformance) offline suite for qnfo-artifacts/worker.js.
//
// qnfo-deploy-guard snapshots `capabilities` and `limitations` from every live worker's /health, and qnfo-fleet-control grades the
// share of workers whose two lists are both non-empty. qnfo-artifacts declared capabilities and no limitations, so the snapshot read
// an empty limitations list for it. This suite loads the worker the way the deployer ships it (one self-contained module, no imports),
// calls the real fetch handler and pins: both lists are non-empty strings, the limits they state are the constants the routes
// enforce, and /health still reports the namespace state next to them.
//
// Run: node qnfo-artifacts/health-contract.test.mjs

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

ok(!/^\s*import\s/m.test(src), "worker.js has no top-level import (the deployer PUTs it verbatim)");
const body = src.replace(/^export default /m, "var __default = ");
const mod = new Function("console", body + "\n;return { VERSION, MAX_TTL, DEFAULT_TTL, NAME_RE, NAMESPACES, CAPABILITIES, LIMITATIONS, handlers: __default };")({ log() {}, error() {} });

const get = async (env, p) => { const r = await mod.handlers.fetch(new Request("https://qnfo-artifacts.example" + p), env); return { status: r.status, body: await r.json() }; };
const nsStub = { list: async () => ({ repos: [], cursor: null }) };

{
  const { status, body: h } = await get({ ARTIFACTS: nsStub, ARTIFACTS_RWNQ8: nsStub, OPS_ROUTER_AUTH_KEY: "k" }, "/health");
  ok(status === 200 && h.status === "ok" && h.worker === "qnfo-artifacts" && h.version === mod.VERSION, "/health answers ok with the worker and version", h);
  ok(Array.isArray(h.capabilities) && h.capabilities.length >= 5 && h.capabilities.every((c) => typeof c === "string" && c.length > 3), "/health declares at least five non-empty capabilities", h.capabilities);
  ok(Array.isArray(h.limitations) && h.limitations.length >= 5 && h.limitations.every((l) => typeof l === "string" && l.length > 20), "/health declares at least five non-empty limitations", h.limitations);
  ok(JSON.stringify(h.capabilities) === JSON.stringify(mod.CAPABILITIES) && JSON.stringify(h.limitations) === JSON.stringify(mod.LIMITATIONS), "/health returns the module's contract constants");
  ok(Array.isArray(h.namespaces) && h.namespaces.length === 2 && h.missing_bindings.length === 0 && h.auth_required_for_writes === true, "the namespace and auth state is still reported next to the contract", h);
}
{
  // The contract must be declared even when the worker is degraded: the snapshot probe reads whatever /health returns.
  const { body: h } = await get({}, "/health");
  ok(h.status === "degraded" && h.capabilities.length > 0 && h.limitations.length > 0 && h.auth_required_for_writes === false, "a degraded /health (no bindings, no key) still declares both lists", h);
}
{
  const L = mod.LIMITATIONS.join("\n");
  ok(L.includes("at most " + mod.MAX_TTL + " seconds") && L.includes("default " + mod.DEFAULT_TTL), "the token lifetime limit is built from MAX_TTL and DEFAULT_TTL");
  ok(L.includes(mod.NAME_RE.source) && mod.NAME_RE.test("a-b.c") && !mod.NAME_RE.test("-bad"), "the repository name limit is built from NAME_RE");
  ok(/default-deny/.test(L) && /OPS_ROUTER_AUTH_KEY/.test(L) && /writes_disabled/.test(L), "the write limit names the default-deny key rule");
  ok(mod.NAMESPACES.every((n) => L.includes(n)), "the namespace limit names every namespace the worker serves", mod.NAMESPACES);
  // The stated page bounds are the ones the routes use: guard against the limits drifting from the code.
  ok(/Math\.min\(Math\.max\(Number\(url\.searchParams\.get\("limit"\)\) \|\| 25, 1\), 100\)/.test(src) && /Math\.min\(Number\(url\.searchParams\.get\("limit"\)\) \|\| 20, 100\)/.test(src) && /Math\.min\(Number\(url\.searchParams\.get\("limit"\)\) \|\| 200, 500\)/.test(src), "the stated /repos, /log and /tree bounds (100/25, 100/20, 500/200) are the ones the routes apply");
  ok(/\.slice\(0, 1024\)/.test(src), "the stated 1024-character description cut is in the create route");
  // No route may delete or write file content, or the first limitation is false.
  ok(!/\.delete\(|writeFile\(|\.commit\(|method === "DELETE"/.test(src), "the worker has no delete or file-write call, so the 'no route deletes or writes' limit holds");
}

console.log(fail ? fail + " failed, " + pass + " passed" : pass + " passed, 0 failed");
process.exit(fail ? 1 : 0);
