import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("function issueCodeDelivery(body) {");
const end = source.indexOf("\n}", start) + 2;
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
const body = context.issueCodeDelivery("code-task: repo=qnfo-workers path=w/worker.js");
assert.ok(body.includes("Definition of done (CODE-CHANGE-REQUIRED-1)"));
assert.ok(body.includes("linked PR"));
assert.ok(body.includes("code-task: repo=qnfo-workers path=w/worker.js"));
assert.equal(context.issueCodeDelivery(body), body);
assert.match(source, /function gh[\s\S]{0,500}issueCodeDelivery\(body\.body\)/);
console.log("code-delivery: passed");
