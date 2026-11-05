// BP26-AI-LABEL-1 (personal-companion 1.43.0): every reading.q08.org piece carries an "AI-generated" label in its meta line
// (EU AI Act Art. 50(4)). Source-level check of the renderer. Run: node personal-companion/ai-label.test.mjs
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const shared = readFileSync(new URL("../_shared/analysis-form.js", import.meta.url), "utf8"); // EK-6: the label lives in the shared analysis form
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) passed++; else { failed++; console.error("FAIL " + l); } };
const fn = src.slice(src.indexOf("function renderPiece(p, keyQS) {"), src.indexOf("__name(renderPiece"));
ok(fn.length > 100, "renderPiece found");
ok(/var body = "<div class=meta>"[^\n]*AI_LABEL_HTML[^\n]*<\/div><h2>"/.test(fn), "the piece meta line includes the AI label");
ok(/var AI_LABEL_HTML = afAiLabelHtml\(\);/.test(src), "the worker takes the label from the shared analysis form");
ok(/var AF_AI_LABEL_TEXT = "[^\n]*No human reviews pieces before they appear\.";/.test(shared) && /<span class=ai title=[^\n]*>AI-generated<\/span>/.test(shared), "the label says AI-generated and that no human reviews pieces");
console.log(passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
