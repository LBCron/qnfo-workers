// BP26-AI-ACT-ART50-1: every OpenAI-compatible twin reply begins with its AI disclosure.
// Run: node personal-api/ai-api-disclosure.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const withExports = source + "\nexport { discloseTwinAi as __discloseTwinAi, TWIN_AI_DISCLOSURE as __TWIN_AI_DISCLOSURE };\n";
const worker = await import("data:text/javascript;base64," + Buffer.from(withExports).toString("base64"));
const { __discloseTwinAi: disclose, __TWIN_AI_DISCLOSURE: disclosure } = worker;

assert.equal(disclose("Hello."), disclosure + "\n\nHello.");
assert.equal(disclose(disclosure + "\n\nHello."), disclosure + "\n\nHello.");
assert.equal(disclose(""), disclosure);
assert.equal((source.match(/discloseTwinAi\(CMP\.chatFollowUp\(companionContext,/g) || []).length, 3);

console.log("4 passed, 0 failed");
