// EVOLVE-JSON-1: the self-repair loop's reader of a model reply (code inside a JSON string).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const block = src.slice(src.indexOf("// ---- EVOLVE-JSON-1:BEGIN"), src.indexOf("// ---- EVOLVE-JSON-1:END"));
const sb = {};
vm.createContext(sb);
vm.runInContext(block + "\n__export = { evFirstObject, evEscapeControlsInStrings, evParseJson };", sb);
const { evParseJson } = sb.__export;
let fails = 0;
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const good = '{"anchor": "var a = 1;", "replacement": "var a = 2;", "rationale": "x", "confidence": 0.8}';
check(evParseJson(good).replacement === "var a = 2;", "a clean object parses");
check(evParseJson("Here is the fix:\n```json\n" + good + "\n```\nDone.").confidence === 0.8, "fences and prose around the object are ignored");
const raw = '{"anchor": "function f() {\n\treturn 1;\n}", "replacement": "function f() {\n\treturn 2;\n}", "confidence": 0.7}';
check(evParseJson(raw) && evParseJson(raw).replacement === "function f() {\n\treturn 2;\n}", "real line breaks and tabs inside a string are read as written");
check(evParseJson('{"anchor": "if (a) { b(\\"}\\"); }", "replacement": "x", "confidence": 1}').anchor === 'if (a) { b("}"); }', "braces and escaped quotes inside a string do not end the object");
check(evParseJson('{"skip": "the excerpt lacks the code"} trailing {"other": 1}').skip === "the excerpt lacks the code", "the first balanced object is taken");
check(evParseJson("") === null && evParseJson("no json here") === null && evParseJson('{"anchor": "cut off') === null && evParseJson("{anchor: 1}") === null, "an empty, truncated or non-JSON reply is null, never a guess");
check(/EV_LAST_RAW \? " \(" \+ EV_LAST_RAW \+ "\)"/.test(src), "a model-skip row carries the head of the reply");

const modelStart = src.indexOf("async function evModelJson(env, model, system, user) {");
const modelEnd = src.indexOf("\n__name(evModelJson", modelStart);
const aiTextStart = src.indexOf("function evAiText(r) {");
const aiTextEnd = src.indexOf("\n__name(evAiText", aiTextStart);
const ai = { console: { error() {} } };
vm.createContext(ai);
vm.runInContext(
  block + "\n" + src.slice(aiTextStart, aiTextEnd) +
  "\nvar EV_LAST_RAW = ''; var EV_REASKED = false;\n" + src.slice(modelStart, modelEnd) +
  "\n__export = { evModelJson, getLastRaw: () => EV_LAST_RAW, getReasked: () => EV_REASKED };",
  ai
);
let calls = [], replies = [];
ai.aiRunAttr = async (...args) => { calls.push(args); return replies.shift(); };
const reply = (content, finish_reason = "stop") => ({ choices: [{ message: { content }, finish_reason }] });
const valid = '{"anchor":"function f() { return 1; }","replacement":"function f() { return 2; }","confidence":0.8}';

replies = [reply("", "length"), reply(valid)];
calls = [];
let parsed = await ai.__export.evModelJson({}, "model", "system", "prompt");
check(parsed && parsed.confidence === 0.8 && calls.length === 2, "an empty length-limited reply is re-asked once and the second object is parsed");
check(calls[0][4].max_tokens === 2500 && calls[1][4].max_tokens === 6000 && JSON.stringify(calls[0][4].messages) === JSON.stringify(calls[1][4].messages), "a length-limited retry raises only its token budget and reuses the original messages");
check(calls[1][4].messages.length === 3 && /empty/i.test(calls[1][4].messages[2].content) && /json/i.test(calls[1][4].messages[2].content), "an empty reply explains why no JSON parse error can be supplied");
check(ai.__export.getReasked() === true && ai.__export.getLastRaw() === "", "a successful retry is recorded without retaining a failure note");
check(/model: model, reasked: EV_REASKED/.test(src), "the proposal records whether its model reply needed a retry");

replies = [reply("not JSON from the first reply"), reply(valid)];
calls = [];
parsed = await ai.__export.evModelJson({}, "model", "system", "prompt");
check(parsed && calls.length === 2 && calls[1][4].max_tokens === 2500, "an unparseable non-empty reply is re-asked once at the normal token budget");
check(calls[1][4].messages.length === 3 && calls[1][4].messages[2].content.includes("not JSON from the first reply"), "the retry includes the parse failure excerpt in a follow-up message");

const malformed = '{"anchor": }';
let expectedParseError = "";
try { JSON.parse(malformed); } catch (error) { expectedParseError = error.message; }
replies = [reply(malformed, "length"), reply(valid)];
calls = [];
parsed = await ai.__export.evModelJson({}, "model", "system", "prompt");
check(parsed && calls.length === 2 && calls[1][4].max_tokens === 6000, "a malformed length-limited JSON object is re-asked once with the larger token budget");
check(calls[1][4].messages.length === 3 && calls[1][4].messages[2].content.includes(expectedParseError), "the retry includes the JSON parser's diagnostic even when the first reply was truncated");

replies = [reply("", ""), reply(valid)];
calls = [];
parsed = await ai.__export.evModelJson({}, "model", "system", "prompt");
check(parsed && calls[1][4].max_tokens === 6000, "an empty reply without a finish reason still gets the larger token budget");

replies = [reply(valid)];
calls = [];
parsed = await ai.__export.evModelJson({}, "model", "system", "prompt");
check(parsed && calls.length === 1 && ai.__export.getReasked() === false, "a parseable first reply is not re-asked");

replies = [reply("first malformed reply"), reply("final malformed retry")];
calls = [];
parsed = await ai.__export.evModelJson({}, "model", "system", "prompt");
check(parsed === null && calls.length === 2 && ai.__export.getLastRaw().includes("final malformed retry") && !ai.__export.getLastRaw().includes("first malformed reply"), "a failed re-ask retains its own reply in the model-skip note");

replies = [reply("", "length"), reply("", "length")];
calls = [];
parsed = await ai.__export.evModelJson({}, "model", "system", "prompt");
check(parsed === null && calls.length === 2 && ai.__export.getReasked() === false, "two unparseable replies stop after exactly one retry");
check(ai.__export.getLastRaw().includes("empty reply") && ai.__export.getLastRaw().includes("finish length"), "the final parse failure is retained for the model-skip note");

console.log(fails + " failure(s)");
process.exit(fails ? 1 : 0);
