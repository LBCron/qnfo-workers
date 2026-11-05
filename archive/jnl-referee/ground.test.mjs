// JNL-GROUND-1 offline suite (owner directive 2026-10-10: reviews state nothing that is not in the submitted text).
// Run: node jnl-referee/ground.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
const dir = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(join(dir, "worker.js")).href);
const G = mod.__ground;
let fails = 0, passes = 0;
const check = (l, c, x) => { if (c) passes++; else { fails++; console.log("FAIL " + l + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 400) : "")); } };

const sys = G.reviewerSystem("Reviewer A");
check("referee prompt forbids external citations and facts", /Use no external citation, source, fact, name, date or figure/.test(sys), sys);
check("referee prompt no longer permits recalled items", !/recalled items/.test(sys));
check("referee prompt does not ask for novelty of framing from memory", !/novelty of framing/.test(sys) && /related work supplied in the input/.test(sys));
check("novelty is neutral without supplied related work, whatever the model says", G.noveltyScore({ score_novelty: 10 }, false) === 5 && G.noveltyScore({ score_novelty: 1 }, false) === 5);
check("novelty is read only when related work is supplied", G.noveltyScore({ score_novelty: 9 }, true) === 9);
const hi = { score_soundness: 8, score_novelty: 1, score_clarity: 8, score_reproducibility: 8, confidence: "high" };
const a = G.decisionFrom([hi, Object.assign({}, hi, { score_novelty: 10 })], "text");
check("a memory-derived novelty score cannot move the decision", a.decision === "PUBLISH" && a.avg === 8, a);

// the bundled copy in jnl-pipeline carries the same prompt text and the same neutral novelty
const pipe = readFileSync(join(dir, "..", "jnl-pipeline", "worker.js"), "utf8");
check("pipeline prompt forbids external citations and facts", /Use no external citation, source, fact, name, date or figure/.test(pipe) && !/recalled items/.test(pipe));
check("pipeline decision mean ignores novelty", !/clampScore\(p\.score_novelty\)/.test(pipe) && /\/ 3;/.test(pipe));
check("pipeline mirror is identical", pipe === readFileSync(join(dir, "..", "jnl-pipeline", "deployed-current.worker.js"), "utf8"));
check("referee mirror is identical", readFileSync(join(dir, "worker.js"), "utf8") === readFileSync(join(dir, "deployed-current.worker.js"), "utf8"));
console.log(passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
