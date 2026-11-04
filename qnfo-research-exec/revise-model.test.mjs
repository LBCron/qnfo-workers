// RESEARCH-REVISE-RELIABLE-1: revise patch calls run gpt-oss-120b first and glm-5.3-flash second; the config restores glm first.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reviseModelPair } from "./worker.js";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.deepEqual(reviseModelPair(), ["@cf/openai/gpt-oss-120b", "@cf/zai-org/glm-5.3-flash"]);
assert.match(src, /research_revise_first/);
assert.equal((src.match(/aiText\(env, _rvPair\[0\]/g) || []).length, 1, "first patch call uses the pair");
assert.doesNotMatch(src, /aiText\(env, MODELS\[1\], _pprompt/, "no revise patch call keeps the old fixed order");
console.log("revise-model: all assertions passed");
