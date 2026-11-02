import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (condition, message) => { if (condition) pass++; else { fail++; console.log("FAIL " + message); } };
const main = src.slice(src.indexOf("var OPS_SYSTEM_PROMPT = ["), src.indexOf("var OPS_TOOLS = ["));
const publicMode = src.slice(src.indexOf("var OPS_PUBLIC_SYSTEM_PROMPT = ["), src.indexOf("function publicToolsPayload()"));

ok(main.includes("file the issue now") && main.includes("never offer to file it later") && main.includes("an issue write is authorized"), "authorized issue filing is immediate, not a conditional offer");
ok(publicMode.includes("only when the current request requires") && publicMode.includes("do not proactively offer owner access"), "owner login is invoked only for a request that needs it");
ok(publicMode.includes("required code-verification step as an authentication requirement") && publicMode.includes("6-digit code"), "the necessary one-time-code verification flow remains explicit");
ok(publicMode.includes("PUBLIC READ-ONLY") && publicMode.includes("cannot change anything"), "the public-mode read-only boundary remains explicit");
ok(src === mirror, "deployed-current.worker.js matches worker.js");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
