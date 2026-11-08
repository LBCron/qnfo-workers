#!/usr/bin/env node
// CODEMODE-SURFACE-1 (RM-CODEMODE-MCP-SURFACE-1, agent_issues 1000639): the static half of the before/after measurement. It reads qnfo-ops/worker.js (never runs it) and prints the size of
// the MCP tools/list answer on the default surface (the whole OPS_TOOLS catalogue) and on the opt-in code-mode surface (OPS_CODEMODE_TOOLS: ops_search + ops_execute), in characters and in
// estimated tokens (chars / 4). That is what a client pays once per session before its first call. Tokens per task and task success on 20 tasks need live runs; the live sizes of every
// tools/list and tools/call answer are logged to cloud_ops_events kind ops-surface-size by the MCP route (qnfo-ops 2.63.0), and docs/CODEMODE-EVAL.md has the method.
// Usage: node scripts/codemode_surface_size.mjs [--check] [--worker qnfo-ops/worker.js]
//        node scripts/codemode_surface_size.mjs --eval [--tasks scripts/codemode-eval-tasks.json] [--mcp-url ...] [--router-url ...] [--model qnfo]
// The --eval mode is the live half: ROADMAP-1, the 20-task before/after on both MCP surfaces, recorded as "## Result on 20 tasks".
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

// ---------------------------------------------------------------------------
// The live half: the 20-task before/after on both MCP surfaces.
// Each task has: id, prompt (a fixed operator task), surface (the MCP tools
// the client is allowed to call), and check (a deterministic success test on
// the final tool result of the run: a regex the result must match).
// The model is always the same one from the router (model qnfo), so no judge
// and no model pair changes between the two arms (ENSEMBLE-POLICY-1).
// ---------------------------------------------------------------------------

export const DEFAULT_EVAL_TASKS = [
  { id: 1, prompt: "List the open roadmap items for RM-CODEMODE-MCP-SURFACE-1 and their status.", check: "RM-CODEMODE-MCP-SURFACE-1" },
  { id: 2, prompt: "Find the issue that dispatched RED-DRAIN-1 and give its number.", check: "1001874" },
  { id: 3, prompt: "Show the current version of qnfo-ops recorded in the ops index.", check: "2\\.6[0-9]" },
  { id: 4, prompt: "Report the definition of done for the code-mode eval in docs/CODEMODE-EVAL.md.", check: "20" },
  { id: 5, prompt: "Give the character count of the default tools/list surface from the last size log.", check: "[0-9]{3,}" },
  { id: 6, prompt: "Name the two tools on the opt-in code-mode surface.", check: "ops_search" },
  { id: 7, prompt: "Find cloud_ops_events of kind ops-surface-size from the last 24 hours and count them.", check: "[0-9]+" },
  { id: 8, prompt: "Which agent issue tracks the code-mode surface work? Give its number.", check: "1000639" },
  { id: 9, prompt: "Show the roadmap entry that lists ROADMAP-1 and its dispatch.", check: "ROADMAP-1" },
  { id: 10, prompt: "Report the token estimate of the code-mode tools/list answer.", check: "[0-9]+" },
  { id: 11, prompt: "Find the last five cloud_ops_events entries for the MCP route and list their kinds.", check: "ops-" },
  { id: 12, prompt: "Give the share of the code-mode surface relative to the default surface, as logged.", check: "[0-9.]+" },
  { id: 13, prompt: "List the tools on the default OPS surface by name.", check: "ops_" },
  { id: 14, prompt: "Find the doc that defines tokens per task for MCP clients and give its path.", check: "CODEMODE-EVAL" },
  { id: 15, prompt: "Report whether ops_execute appears in the default catalogue (yes or no, with evidence).", check: "(yes|no)" },
  { id: 16, prompt: "Show the last dispatch row for QNFO.OPS and its roadmap id.", check: "1683|QNFO\\.OPS" },
  { id: 17, prompt: "Count the tools in the default catalogue as recorded in the size log.", check: "[0-9]+" },
  { id: 18, prompt: "Find the slice evidence for OPS-RM-SLICES-1 and summarize what shipped in qnfo-ops 2.63.0.", check: "2\\.63\\.0" },
  { id: 19, prompt: "Report the event kind used for live surface size logging.", check: "ops-surface-size" },
  { id: 20, prompt: "Give the issue number and title for the RED-DRAIN-1 dispatch that asked for the 20-task run.", check: "1001874" }
];

export function tasksFromJson(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw) || raw.length !== 20) throw new Error("codemode-eval-tasks.json must be an array of exactly 20 tasks");
  for (const t of raw) {
    if (typeof t.id !== "number" || typeof t.prompt !== "string" || typeof t.check !== "string") {
      throw new Error("each task needs number id, string prompt, string check");
    }
    // The check is a regex the final tool result must match: deterministic, no model judge.
    new RegExp(t.check);
  }
  return raw;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

async function mcpCall(url, method, params, codemode) {
  const headers = { "content-type": "application/json" };
  if (codemode) headers["x-ops-codemode"] = "1";
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || {} })
  });
  const text = await res.text();
  return { text, json: JSON.parse(text) };
}

async function routerComplete(url, model, messages, tools, maxTurns) {
  // One task run: a plain tool loop against the same router model for both arms.
  const chars = { tools: 0, calls: 0, model: 0 };
  const list = await mcpCall(url.mcp, "tools/list", {}, tools === "codemode");
  chars.tools += list.text.length;
  const names = ((list.json && list.json.result && list.json.result.tools) || []).map((t) => t.name);
  const convo = [...messages];
  let finalToolResult = "";
  for (let turn = 0; turn < (maxTurns || 8); turn++) {
    const res = await fetch(url.router, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages: convo, tools: names.map((n) => ({ type: "function", function: { name: n } })), stream: false })
    });
    const out = await res.json();
    const choice = out.choices && out.choices[0];
    const msg = (choice && choice.message) || {};
    chars.model += JSON.stringify(msg).length;
    convo.push(msg);
    const toolCalls = msg.tool_calls || [];
    if (!toolCalls.length) break;
    for (const tc of toolCalls) {
      const call = await mcpCall(url.mcp, "tools/call", { name: tc.function.name, arguments: JSON.parse(tc.function.arguments || "{}") }, tools === "codemode");
      chars.calls += call.text.length;
      finalToolResult = call.text;
      convo.push({ role: "tool", tool_call_id: tc.id, content: call.text.slice(0, 4000) });
    }
  }
  return { chars, finalToolResult };
}

async function runEval() {
  const tasksPath = arg("--tasks", new URL("./codemode-eval-tasks.json", import.meta.url).pathname);
  const mcpUrl = arg("--mcp-url", process.env.OPS_MCP_URL || "http://127.0.0.1:8787/mcp");
  const routerUrl = arg("--router-url", process.env.OPS_ROUTER_URL || "http://127.0.0.1:8080/v1/chat/completions");
  const model = arg("--model", "qnfo"); // ENSEMBLE-POLICY-1: same model for both arms, no judge.
  let tasks;
  if (existsSync(tasksPath)) {
    tasks = tasksFromJson(tasksPath);
  } else {
    tasks = DEFAULT_EVAL_TASKS;
    writeFileSync(tasksPath, JSON.stringify(tasks, null, 2) + "\n");
  }
  const arms = ["default", "codemode"];
  const rows = [];
  for (const task of tasks) {
    for (const arm of arms) {
      const r = await routerComplete({ mcp: mcpUrl, router: routerUrl }, model, [{ role: "user", content: task.prompt }], arm);
      const ok = new RegExp(task.check).test(r.finalToolResult);
      const tokens = Math.ceil((r.chars.tools + r.chars.calls + r.chars.model) / 4);
      rows.push({ id: task.id, arm, success: ok, tokens, tools_chars: r.chars.tools, calls_chars: r.chars.calls, model_chars: r.chars.model });
      process.stderr.write("task " + task.id + " " + arm + ": " + (ok ? "ok" : "fail") + " " + tokens + " tokens\n");
    }
  }
  const summary = (arm) => {
    const a = rows.filter((r) => r.arm === arm);
    const ok = a.filter((r) => r.success).length;
    const tok = a.reduce((s, r) => s + r.tokens, 0);
    return { arm, successes: ok + "/20", tokens_total: tok, tokens_per_task: Math.ceil(tok / 20) };
  };
  const before = summary("default");
  const after = summary("codemode");
  const out = {
    model,
    mcp_url: mcpUrl,
    tasks: tasksPath,
    rows,
    "## Result on 20 tasks": [
      "## Result on 20 tasks",
      "",
      "| surface | successes | tokens/task |",
      "|---|---|---|",
      "| before (default tools/list) | " + before.successes + " | " + before.tokens_per_task + " |",
      "| after (code-mode tools/list) | " + after.successes + " | " + after.tokens_per_task + " |",
      "",
      "tokens per task moved " + (before.tokens_per_task - after.tokens_per_task) + " (positive is the reduction). Successes must not drop: " +
        (after.successes >= before.successes ? "PASS" : "FAIL")
    ].join("\n")
  };
  console.log(JSON.stringify(out, null, 2));
  console.log(out["## Result on 20 tasks"]);
  const afterOk = Number(after.successes.split("/")[0]);
  const beforeOk = Number(before.successes.split("/")[0]);
  if (afterOk < beforeOk) { console.error("verification FAILED: successes dropped on the code-mode surface"); process.exit(1); }
  console.error("codemode 20-task run ok");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--eval")) {
    runEval().catch((e) => { console.error(String(e && e.stack ? e.stack : e)); process.exit(1); });
  } else {
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
}
