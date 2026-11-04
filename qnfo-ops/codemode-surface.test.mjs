// CODEMODE-SURFACE-1 (RM-CODEMODE-MCP-SURFACE-1, agent_issues 1000639): the opt-in code-mode MCP surface is two tools over the unchanged catalogue, every tools/list and tools/call
// answer logs its size to cloud_ops_events kind ops-surface-size with the columns that table really has (the first logger inserted a nonexistent `size` column and wrote nothing),
// and the pair is no longer part of the default catalogue the model and the REST list see.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
assert.equal(source, mirror, "deployed-current.worker.js mirrors worker.js");

const grab = (start, end) => {
  const i = source.indexOf(start), j = source.indexOf(end, i);
  assert.ok(i >= 0 && j > i, "region " + start + " is present");
  return source.slice(i, j);
};
const toolsSrc = grab("var OPS_TOOLS = [", "\nfunction toolsPayload") ;
const routeSrc = grab("var OPS_REST_TOOL_NAMES", "// DEPLOY-DRIFT-CF-1");

const logged = [];
const executed = [];
const state = { rows: [] };
const lib = new Function("VERSION", "randId", "iso", "json", "ownerKeyOk", "ownerKeyRejected", "execTool", "ideaSubmit", "queueRead", "ownerOtpSend", "ownerOtpVerify", "CORS_HEADERS", "opsRunState",
  toolsSrc + "\n" + routeSrc + "\nreturn { OPS_TOOLS, OPS_CODEMODE_TOOLS, opsRestToolList, opsCodemodeSearch, opsSurfaceOf, opsSurfaceSizeLog, ownerRestRoutes };")(
  "9.9.9-test", (() => { let n = 0; return (p) => p + "test" + n++; })(), () => "2026-11-05T00:00:00.000Z",
  (body, status) => ({ status: status || 200, body }),
  async () => true, () => ({ status: 401 }),
  async (env, name, rawArgs) => { executed.push([name, JSON.parse(rawArgs)]); return { ok: true, text: JSON.stringify({ ok: true, tool: name }) }; },
  async () => ({}), async () => ({}), async () => ({}), async () => ({}), {}, async (env, id) => ({ ok: true, run_id: id })
);

// the default catalogue: no code-mode pair, no function-bearing entries
const names = lib.OPS_TOOLS.map((t) => t.name);
assert.ok(!names.includes("ops_search") && !names.includes("ops_execute"), "the code-mode pair is not part of the default catalogue");
assert.equal(new Set(names).size, names.length, "tool names are unique");
for (const t of lib.OPS_TOOLS) {
  assert.equal(typeof t.exec, "undefined", t.name + " carries no function");
  assert.equal(typeof t.parameters, "object", t.name + " declares parameters");
}
assert.deepEqual(lib.OPS_CODEMODE_TOOLS.map((t) => t.name), ["ops_search", "ops_execute"]);

// search
const hits = lib.opsCodemodeSearch("graph");
assert.ok(hits.some((h) => h.name === "fleet_graph"), "keyword search finds a catalogue tool by name or description");
assert.ok(hits.every((h) => typeof h.description === "string" && !h.description.includes("\n")), "one description line per hit");
assert.deepEqual(lib.opsCodemodeSearch(""), [], "an empty query finds nothing");
assert.deepEqual(lib.opsCodemodeSearch("zzzz-no-such-tool"), []);
assert.equal(lib.opsSurfaceOf("ops_search"), "codemode");
assert.equal(lib.opsSurfaceOf("ops_execute"), "codemode");
assert.equal(lib.opsSurfaceOf("fleet_status"), "default");

// the logger writes the real cloud_ops_events columns
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, text TEXT, meta TEXT, job TEXT, status TEXT)");
const env = {
  QNFO_AUDIT: {
    prepare(sql) {
      return {
        bind(...v) {
          return { run: async () => { db.prepare(sql.replace(/\?\d+/g, "?")).run(...v); logged.push(sql); return { success: true }; } };
        }
      };
    }
  }
};
assert.equal(await lib.opsSurfaceSizeLog(env, "tools/list", "default", 41566, 0), true);
const row = db.prepare("SELECT kind, text, job, status, meta FROM cloud_ops_events").get();
assert.equal(row.kind, "ops-surface-size");
assert.equal(row.text, "tools/list");
assert.equal(row.job, "qnfo-ops");
assert.deepEqual(JSON.parse(row.meta), { surface: "default", chars: 41566, req_chars: 0 });
assert.equal(await lib.opsSurfaceSizeLog({}, "tools/list", "default", 1, 0), false, "no audit store, no write, no throw");
assert.ok(!/INSERT INTO cloud_ops_events \(id, ts, kind, job, size\)/.test(source), "the nonexistent size column is gone");
assert.ok(!/CREATE TABLE IF NOT EXISTS cloud_ops_events \(id TEXT PRIMARY KEY, ts TEXT, kind TEXT, job TEXT, size INTEGER\)/.test(source), "the wrong-schema CREATE TABLE is gone");

// the route: default list unchanged, codemode list is the pair, calls go through execTool, sizes are logged for both surfaces
function req(path, body) {
  return { url: "https://ops.qnfo.org" + path, method: "POST", headers: { get: (k) => (k.toLowerCase() === "authorization" ? "Bearer test" : null) }, json: async () => body };
}
const call = async (path, body) => {
  const r = await lib.ownerRestRoutes(req(path, body), env, path.split("?")[0], "POST");
  return r.body;
};
const dflt = await call("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
assert.equal(dflt.result.tools.length, lib.opsRestToolList(true).length);
assert.ok(!dflt.result.tools.some((t) => t.name === "ops_search"), "the default MCP list does not carry the pair");
const cm = await call("/mcp?surface=codemode", { jsonrpc: "2.0", id: 2, method: "tools/list" });
assert.deepEqual(cm.result.tools.map((t) => t.name), ["ops_search", "ops_execute"]);
const sizeRows = () => db.prepare("SELECT text, meta FROM cloud_ops_events WHERE kind = 'ops-surface-size' ORDER BY rowid").all().map((r) => ({ text: r.text, ...JSON.parse(r.meta) }));
let rowsNow = sizeRows();
assert.equal(rowsNow.length, 3, "one logged size per answer");
assert.deepEqual(rowsNow.slice(1).map((r) => [r.text, r.surface]), [["tools/list", "default"], ["tools/list", "codemode"]]);
assert.ok(rowsNow[1].chars > 20 * rowsNow[2].chars, "the code-mode list is a small fraction of the default list");
assert.equal(rowsNow[1].chars, JSON.stringify(dflt).length, "the logged size is the answer size");

const search = await call("/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ops_search", arguments: { query: "fleet_graph" } } });
assert.equal(search.result.isError, false);
assert.ok(JSON.parse(search.result.content[0].text).some((h) => h.name === "fleet_graph"));
const exec = await call("/mcp", { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "ops_execute", arguments: { name: "fleet_status", args: {} } } });
assert.equal(exec.result.isError, false);
assert.deepEqual(executed.pop(), ["fleet_status", {}], "ops_execute runs the named tool through execTool");
const execTool2 = await call("/mcp", { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "ops_execute", arguments: { tool: "fleet_status" } } });
assert.equal(execTool2.result.isError, false, "tool is accepted as an alias of name");
executed.length = 0;
const rec = await call("/mcp", { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "ops_execute", arguments: { name: "ops_execute" } } });
assert.equal(rec.result.isError, true);
assert.match(rec.result.content[0].text, /recursive/);
const nf = await call("/mcp", { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "ops_execute", arguments: { name: "no_such_tool" } } });
assert.equal(nf.result.isError, true);
assert.match(nf.result.content[0].text, /tool not found/);
assert.deepEqual(executed, [], "neither a recursive nor an unknown name reaches execTool");
await call("/mcp", { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "fleet_status", arguments: {} } });
rowsNow = sizeRows();
const callRows = rowsNow.slice(3);
assert.deepEqual(callRows.map((r) => [r.text, r.surface]), [
  ["tools/call:ops_search", "codemode"], ["tools/call:ops_execute", "codemode"], ["tools/call:ops_execute", "codemode"],
  ["tools/call:ops_execute", "codemode"], ["tools/call:ops_execute", "codemode"], ["tools/call:fleet_status", "default"]
], "every call is logged with its surface, the default surface included");
assert.ok(callRows.every((r) => r.chars > 0 && r.req_chars > 0), "request and answer sizes are both logged");

// the run-state route
const rs = await lib.ownerRestRoutes({ url: "https://ops.qnfo.org/v1/run-state?run_id=job-9", method: "GET", headers: { get: () => "Bearer test" } }, env, "/v1/run-state", "GET");
assert.equal(rs.body.run_id, "job-9");

console.log("codemode-surface tests: ok");
