// RM-DURABLE-INTERRUPT-1 (qnfo-agents 0.8.2), offline. Regression for cf_agent_requests 2483: the approval host module was named "codemode:approval", and
// @cloudflare/computer refuses every host module that is not a ws:* name when the backend is constructed:
//   Host module "codemode:approval" must use a simple ws:* name, such as "ws:git".
// The pure checks run anywhere. When node_modules is installed (the deploy workflow does npm ci), the same module map is handed to the real WorkerJavaScriptBackend,
// and a copy renamed back to "codemode:approval" must be refused by it: the test fails on the old name, and shows that it can.
import { readFileSync, existsSync } from "node:fs";
import { register } from "node:module";
import { APPROVAL_MODULE, HOST_MODULE_SPECIFIER, APPROVAL_EXPORTS, approvalModules, approvalSource } from "./src/approval.js";
import { approvalPayload, APPROVAL_SUFFIX } from "./src/lib.js";

const here = (p) => new URL(p, import.meta.url);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };

const calls = [];
const unsafe = (fn) => fn;
const mods = approvalModules({ unsafe, sendEmail: async (i) => { calls.push(["email", i]); return { ok: true }; }, stagedAction: async (i) => { calls.push(["staged", i]); return { ok: true, staged: true }; } });

// the name and the shape
ok(HOST_MODULE_SPECIFIER.test(APPROVAL_MODULE) && APPROVAL_MODULE === "ws:approval", "the approval host module is a ws:* name");
ok(!HOST_MODULE_SPECIFIER.test("codemode:approval") && !HOST_MODULE_SPECIFIER.test("approval") && !HOST_MODULE_SPECIFIER.test("ws:") && !HOST_MODULE_SPECIFIER.test("ws:a/b"), "the rule rejects the old name, a bare name, an empty ws: and a path");
ok(Object.keys(mods).length === 1 && Object.keys(mods)[0] === APPROVAL_MODULE, "the map has exactly the approval module");
ok(Object.keys(mods[APPROVAL_MODULE]).sort().join() === APPROVAL_EXPORTS.slice().sort().join() && Object.values(mods[APPROVAL_MODULE]).every((f) => typeof f === "function"), "its exports are the three host functions");
ok(Object.keys(mods[APPROVAL_MODULE]).every((n) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n) && n !== "default" && n !== "then"), "export names are plain identifiers (the backend's EXPORT_NAME rule)");

// requestApproval asks the interrupt and reports only a yes
const asked = [];
const call = (answer) => ({ interrupt: async (p) => { asked.push(p); return answer; } });
const payload = approvalPayload("staged_action", "run_a1b2c3d4", "loop:x", { label: "rehearse publish" });
ok((await mods[APPROVAL_MODULE].requestApproval([payload], call({ approved: true }))) === true && asked.length === 1 && asked[0] === payload, "requestApproval interrupts with the payload and returns true on approved:true");
ok((await mods[APPROVAL_MODULE].requestApproval([payload], call({ approved: false }))) === false && (await mods[APPROVAL_MODULE].requestApproval([payload], call("yes"))) === false && (await mods[APPROVAL_MODULE].requestApproval([payload], call(undefined))) === false, "anything but approved:true is a no");
let refused = "";
const askedBefore = asked.length;
try { await mods[APPROVAL_MODULE].requestApproval([{ action: "delete_everything" }], call({ approved: true })); } catch (e) { refused = String(e.message); }
ok(/unsupported approval action/.test(refused) && asked.length === askedBefore, "an action outside the approval table never reaches the interrupt");
await mods[APPROVAL_MODULE].sendEmail([{ run_id: "r" }]);
await mods[APPROVAL_MODULE].stagedAction([{ run_id: "s" }]);
ok(calls.length === 2 && calls[0][0] === "email" && calls[1][0] === "staged", "the two side effects are the host's callbacks, run on demand");

// the source the isolate runs
for (const action of Object.keys(APPROVAL_SUFFIX)) {
  const src = approvalSource(action, JSON.stringify(approvalPayload(action, "run_a1b2c3d4", "loop:x", { label: "a b" })));
  const fn = action === "send_email" ? "sendEmail" : "stagedAction";
  ok(src.indexOf('from "' + APPROVAL_MODULE + '"') > 0 && src.indexOf("codemode:") < 0, action + ": the source imports the ws:* module and nothing else");
  ok(src.indexOf("import { requestApproval, " + fn + " }") === 0 && /export default async function\(\)/.test(src) && src.indexOf("await " + fn + "(request)") > 0, action + ": ask first, then run the one side effect");
  ok(src.indexOf("throw new Error(\"" + action + " was not approved\")") > 0, action + ": a no ends the run with an error");
}
const sep = approvalSource("staged_action", JSON.stringify({ label: "a" + String.fromCharCode(0x2028) + "b" + String.fromCharCode(0x2029) }));
ok(sep.indexOf(String.fromCharCode(0x2028)) < 0 && sep.indexOf(String.fromCharCode(0x2029)) < 0, "U+2028 and U+2029 are escaped out of the payload literal");

// index.ts uses the module through approval.js, never by a literal of its own
const ts = readFileSync(here("./src/index.ts"), "utf8");
ok(/modules: approvalModules\(\{/.test(ts) && /approvalSource\(action, JSON\.stringify\(input\)\)/.test(ts), "the Durable Object builds its modules and its source with src/approval.js");
ok(ts.indexOf("codemode:approval") < 0 && !/from \"codemode:/.test(ts), "the old \"codemode:approval\" specifier is gone from src/index.ts");
ok(/staged_action/.test(ts) && /markApprovalPending/.test(ts), "the pause is still recorded (onWait -> markApprovalPending)");

// the real backend, when it is installed
let real = "skipped (node_modules not installed)";
if (existsSync(here("./node_modules/@cloudflare/computer/package.json"))) {
  const hooks = 'export async function resolve(spec, ctx, next) { if (spec === "cloudflare:workers") return { url: "data:text/javascript," + encodeURIComponent("export class RpcTarget {} export class WorkerEntrypoint {}"), shortCircuit: true }; return next(spec, ctx); }';
  register("data:text/javascript," + encodeURIComponent(hooks), import.meta.url);
  const { WorkerJavaScriptBackend } = await import("@cloudflare/computer/backends/worker-javascript");
  const make = (modules) => new WorkerJavaScriptBackend({ loader: {}, id: "worker-javascript", onInterrupt: "replay", modules });
  let accepted = true, err = "";
  try { make(mods); } catch (e) { accepted = false; err = String(e.message); }
  ok(accepted, "the real WorkerJavaScriptBackend accepts the approval module map: " + err);
  let oldRefused = "";
  try { make({ "codemode:approval": mods[APPROVAL_MODULE] }); } catch (e) { oldRefused = String(e.message); }
  ok(/must use a simple ws:\* name/.test(oldRefused), "the same backend refuses the old name, so this test fails if the name regresses: " + (oldRefused || "(accepted)"));
  real = "ran against @cloudflare/computer";
}
console.log("approval-modules: real backend " + real);
console.log("qnfo-agents approval-modules.test: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
