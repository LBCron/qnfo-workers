// qnfo-agents approval pause (RM-DURABLE-INTERRUPT-1): the host module and the source that @cloudflare/computer runs. Pure, no imports beyond lib.js, so the offline suite
// can hand the same module map to the real WorkerJavaScriptBackend and see whether it accepts it.
//
// 0.8.2 (2026-11-05): the module was named "codemode:approval". The backend accepts a host module only under a ws:* specifier
// (HOST_SPECIFIER = /^ws:[A-Za-z0-9][A-Za-z0-9._-]*$/ in @cloudflare/computer/backends/worker-javascript), so constructing the backend threw
// 'Host module "codemode:approval" must use a simple ws:* name, such as "ws:git".' for every approval: cf_agent_requests 2483 (approval_selftest) failed on it,
// and so would every send_email approval since 0.8.0. The name lives here, once, with the rule beside it.
import { APPROVAL_SUFFIX, emailApprovalGranted } from "./lib.js";

export const APPROVAL_MODULE = "ws:approval";
export const HOST_MODULE_SPECIFIER = /^ws:[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const APPROVAL_EXPORTS = ["requestApproval", "sendEmail", "stagedAction"];

// h.unsafe is unsafeToRepeat from @cloudflare/computer; h.sendEmail(input) and h.stagedAction(input) are the host's side effects, run once after the answer.
export function approvalModules(h) {
  return {
    [APPROVAL_MODULE]: {
      requestApproval: async ([input], call) => {
        if (!input || !APPROVAL_SUFFIX[String(input.action)]) throw new Error("unsupported approval action");
        return emailApprovalGranted(await call.interrupt(input));
      },
      sendEmail: h.unsafe(async ([input]) => h.sendEmail(input)),
      // The staging step sends nothing: it only completes the run, so the pause, the restart and the resume can be proved without an identity-bound side effect.
      stagedAction: h.unsafe(async ([input]) => h.stagedAction(input))
    }
  };
}

// The module source the isolate runs: ask, then act once on a yes. payloadJson is JSON.stringify of the approval payload; U+2028 and U+2029 are escaped so the
// literal stays one line in every JavaScript engine.
export function approvalSource(action, payloadJson) {
  const fn = action === "send_email" ? "sendEmail" : "stagedAction";
  const payload = String(payloadJson).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return "import { requestApproval, " + fn + " } from \"" + APPROVAL_MODULE + "\";\n" +
    "export default async function() {\n" +
    "  const request = " + payload + ";\n" +
    "  if (!(await requestApproval(request))) throw new Error(\"" + action + " was not approved\");\n" +
    "  return await " + fn + "(request);\n" +
    "}";
}
