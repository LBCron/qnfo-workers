#!/usr/bin/env node
// CODEMODE-SURFACE-1 (RM-CODEMODE-MCP-SURFACE-1, agent_issues 1000639): the static half of the before/after measurement. It reads qnfo-ops/worker.js (never runs it) and prints the size of
// the MCP tools/list answer on the default surface (the whole OPS_TOOLS catalogue) and on the opt-in code-mode surface (OPS_CODEMODE_TOOLS: ops_search + ops_execute), in characters and in
// estimated tokens (chars / 4). That is what a client pays once per session before its first call. Tokens per task and task success on 20 tasks need live runs; the live sizes of every
// tools/list and tools/call answer are logged to cloud_ops_events kind ops-surface-size by the MCP route (qnfo-ops 2.63.0), and docs/CODEMODE-EVAL.md has the method.
// Usage: node scripts/codemode_surface_size.mjs [--check] [--worker qnfo-ops/worker.js]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function surfaceSizes(workerSource) {
  const s = workerSource.replace(/\r\n/g, "\n");
  const a = s.indexOf("var OPS_TOOLS = [");
  const b = s.indexOf("\n];\nfunction toolsPayload", a);
  const c = s.indexOf("var OPS_CODEMODE_TOOLS = [");
  const d = s.indexOf("\n];\n", c);
  if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error("OPS_TOOLS or OPS_CODEMODE_TOOLS not found in the worker source");
  const tools = new Function(s.slice(a, b + 3) + "\nreturn OPS_TOOLS;")();
  const codemode = new Function(s.slice(c, d + 3) + "\nreturn OPS_CODEMODE_TOOLS;")();
  const dflt = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })) } });
  const cm = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: codemode } });
  return {
    default_tools: tools.length,
    default_chars: dflt.length,
    default_tokens_est: Math.ceil(dflt.length / 4),
    codemode_tools: codemode.length,
    codemode_chars: cm.length,
    codemode_tokens_est: Math.ceil(cm.length / 4),
    codemode_share_of_default: Number((cm.length / dflt.length).toFixed(4)),
    catalogue_has_pair: tools.some((t) => t.name === "ops_search" || t.name === "ops_execute")
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const wi = process.argv.indexOf("--worker");
  const path = wi > 0 ? process.argv[wi + 1] : new URL("../qnfo-ops/worker.js", import.meta.url);
  const r = surfaceSizes(readFileSync(path, "utf8"));
  console.log(JSON.stringify(r, null, 2));
  if (process.argv.includes("--check")) {
    const bad = [];
    if (r.catalogue_has_pair) bad.push("the code-mode pair is inside the default catalogue");
    if (r.codemode_tools !== 2) bad.push("the code-mode surface is not exactly two tools");
    if (r.codemode_share_of_default > 0.05) bad.push("the code-mode list is more than 5 percent of the default list");
    if (bad.length) { console.error("codemode surface check FAILED: " + bad.join("; ")); process.exit(1); }
    console.error("codemode surface check ok");
  }
}
