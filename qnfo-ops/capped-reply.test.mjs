// OPS-CAPPED-REPLY-1 offline suite (qnfo-ops 2.59.1, agent_issues 1000446). No network: the Workers AI binding and the gateway stream are stubs. Measured 2026-10-26 on qnfo-audit.ops_ai_log:
// 15 rows in 14 days with completion_tokens exactly 8000 or 8192, 13 of them 19000 or more characters long and ending mid-sentence, logged ok = 1; ops-6a811b4c1aa914 was the reply to a public chat
// turn and begins "Good data. Now let me analyze". Cause: four sites copy reasoning_content into the reply when content is empty (callGLM, budgetFallback, callDeepSeekStream, streamFinalAnswer)
// and none reads finish_reason, so a turn that spent its whole output cap reasoning returned its chain of thought as the answer.
// Proves: when the turn stopped at the cap (finish_reason length) with no content and no tool call the reply is one honest line at each site, and that line contains none of the truncation phrases
// finalize() turns into ok = 0 (so ops_agent_empty_answers_7d is not fed); a reasoning-only turn that ended for another reason keeps the old copy; a turn with content, or with tool calls, is untouched.
// Run: node --no-warnings qnfo-ops/capped-reply.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };
const grab = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); return i >= 0 && j > i ? src.slice(i, j) : ""; };

ok(src === mirror, "deployed-current.worker.js is identical to worker.js");
const _v = (/^var VERSION = "(\d+)\.(\d+)\.(\d+)/m.exec(src) || []).slice(1).map(Number);
ok(_v.length === 3 && (_v[0] > 2 || (_v[0] === 2 && (_v[1] > 59 || (_v[1] === 59 && _v[2] >= 1)))), "VERSION is at least 2.59.1", _v);
ok(/OPS-CAPPED-REPLY-1/.test(src.split("\n")[33] || "") || /var VERSION = "[^"]*"; \/\* [^\n]*OPS-CAPPED-REPLY-1/.test(src), "the VERSION line carries the OPS-CAPPED-REPLY-1 tag");

const helper = grab("var OPS_CAPPED_LINE =", "async function callGLM(");
ok(helper.includes("function opsReasoningAsReply"), "the helper is found");
const { OPS_CAPPED_LINE, opsReasoningAsReply } = new Function(helper + "\nreturn { OPS_CAPPED_LINE, opsReasoningAsReply };")();
const CHAT_MODEL = (/^var UPSTREAM_CHAT_MODEL = "([^"]+)";/m.exec(src) || [])[1];
ok(CHAT_MODEL === "@cf/qwen/qwen3-30b-a3b-fp8", "the chat lane selects the evaluated Qwen model");
ok(opsReasoningAsReply("length", "chain of thought") === OPS_CAPPED_LINE, "finish_reason length: the honest line");
ok(opsReasoningAsReply("stop", "chain of thought") === "chain of thought" && opsReasoningAsReply(undefined, "r") === "r" && opsReasoningAsReply("tool_calls", "r") === "r", "any other finish reason: the old copy");
const truncMark = new RegExp((/const truncMark = \/([^\n]*)\/i;/.exec(src) || [])[1] || "NOMATCH", "i");
ok(!truncMark.test(OPS_CAPPED_LINE) && !/re-send/i.test(OPS_CAPPED_LINE), "the line holds none of finalize()'s truncation phrases (ok stays as the caller computed it)");
ok(!/chain of thought|reasoning_content/i.test(OPS_CAPPED_LINE) && OPS_CAPPED_LINE.length < 200, "the line is short and says what happened");

// callGLM
const glmSrc = grab("async function callGLM(", '__name(callGLM, "callGLM");');
const mkGlm = (reply) => new Function("OPS_CAPPED_LINE", "opsReasoningAsReply", "truncateToContext", "OPS_PROMPT_CTX", "UPSTREAM_CHAT_MODEL", glmSrc + "\nreturn callGLM;")(OPS_CAPPED_LINE, opsReasoningAsReply, (m) => m, 1e5, CHAT_MODEL);
const seenModels = [];
const wai = (msg, finish) => ({ WAI: { run: async (model) => { seenModels.push(model); return { choices: [{ message: msg, finish_reason: finish }], usage: { completion_tokens: 8000 } }; } } });
let res = await mkGlm()(wai({ role: "assistant", content: "", reasoning_content: "Good data. Now let me analyze" + " x".repeat(50) }, "length"), [{ role: "user", content: "q" }], 8000, null, {});
ok(res.choices[0].message.content === OPS_CAPPED_LINE && res.choices[0].finish_reason === "length" && res.usage.completion_tokens === 8000, "callGLM: a reasoning-only turn cut at the cap returns the honest line and keeps finish_reason length", res.choices[0]);
ok(seenModels[0] === CHAT_MODEL, "callGLM sends chat requests to Qwen");
res = await mkGlm()(wai({ role: "assistant", content: "", reasoning_content: "thinking out loud" }, "stop"), [{ role: "user", content: "q" }], 100, null, {});
ok(res.choices[0].message.content === "thinking out loud", "callGLM: a reasoning-only turn that ended normally keeps the old copy", res.choices[0]);
res = await mkGlm()(wai({ role: "assistant", content: "real answer", reasoning_content: "r" }, "length"), [{ role: "user", content: "q" }], 100, null, {});
ok(res.choices[0].message.content === "real answer", "callGLM: a turn with content is untouched even at the cap", res.choices[0]);
res = await mkGlm()(wai({ role: "assistant", content: "", reasoning_content: "r", tool_calls: [{ id: "c1", type: "function", function: { name: "t", arguments: "{}" } }] }, "length"), [{ role: "user", content: "q" }], 100, null, {});
ok(res.choices[0].message.content === "" && res.choices[0].message.tool_calls.length === 1, "callGLM: a turn with tool calls is untouched", res.choices[0]);

// budgetFallback
const bfSrc = grab("async function budgetFallback(", '__name(budgetFallback, "budgetFallback");');
const mkBf = () => new Function("OPS_CAPPED_LINE", "opsReasoningAsReply", "truncateToContext", "CODE_MODEL_CTX", "UPSTREAM_CHAT_MODEL", "UPSTREAM_CODE_MODEL", "console", bfSrc + "\nreturn budgetFallback;")(OPS_CAPPED_LINE, opsReasoningAsReply, (m) => m, 2e5, CHAT_MODEL, "@cf/moonshotai/kimi-k2.7-code", { log() {} });
let bf = await mkBf()(wai({ role: "assistant", content: "", reasoning_content: "long reasoning" }, "length"), [{ role: "user", content: "q" }], 8000, null, {});
ok(bf && bf.resp.choices[0].message.content === OPS_CAPPED_LINE && /free-fallback/.test(bf.servedBy), "budgetFallback: a capped reasoning-only free turn returns the honest line", bf && bf.resp.choices[0].message);
bf = await mkBf()(wai({ role: "assistant", content: "", reasoning_content: "long reasoning" }, "stop"), [{ role: "user", content: "q" }], 8000, null, {});
ok(bf.resp.choices[0].message.content === "long reasoning", "budgetFallback: a reasoning-only turn that ended normally keeps the old copy", bf.resp.choices[0].message);

// callDeepSeekStream
const dsSrc = grab("async function callDeepSeekStream(", '__name(callDeepSeekStream, "callDeepSeekStream");');
ok(dsSrc.length > 2000, "callDeepSeekStream is found");
const sse = (frames) => new Response(new ReadableStream({ start(c) { const enc = new TextEncoder(); for (const f of frames) c.enqueue(enc.encode("data: " + JSON.stringify(f) + "\n\n")); c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); } }), { status: 200 });
const mkDs = (frames, freeChat = async () => null) => {
  globalThis.fetch = async () => sse(frames);
  return new Function("OPS_CAPPED_LINE", "opsReasoningAsReply", "isAgentTranscript", "callGLM", "UPSTREAM_CHAT_MODEL", "truncateToContext", "OPS_PROMPT_CTX", "UPSTREAM_MODEL", "UPSTREAM_MODEL_FB", "UPSTREAM_TOOLCALL_MODEL", "agentLoopIncapable", "dsPaidBlocked", "dsPaidTrip", "budgetFallback", "isOAIUpstream", "gwMaxOut", "DEEPSEEK_URL", "opsUpstreamError", "firstFrameIdx", "console",
    dsSrc + "\nreturn callDeepSeekStream;")(OPS_CAPPED_LINE, opsReasoningAsReply, () => false, freeChat, CHAT_MODEL, (m) => m, 1e5, "deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-flash", async () => ({}), async () => false, async () => false, async () => null, () => false, () => 8192, "https://gateway.test/chat", async () => {}, () => -1, { log() {} });
};
const rf = (reasoning, finish) => [{ choices: [{ delta: { reasoning_content: reasoning } }] }, { choices: [{ delta: {}, finish_reason: finish }], usage: { completion_tokens: 8192 } }];
const chatResp = { choices: [{ message: { role: "assistant", content: "chat answer" } }] };
const chat = await mkDs([], async () => chatResp)({ WAI: {} }, [{ role: "user", content: "q" }], 8192, null, {});
ok(chat.resp === chatResp && chat.servedBy === CHAT_MODEL, "streaming no-tools chat uses the selected Qwen model");
let d = await mkDs(rf("Good data. Now let me analyze ".repeat(20), "length"))({}, [{ role: "user", content: "q" }], 8192, null, { upstreamModel: "deepseek/deepseek-v4-pro" });
ok(d.resp.choices[0].message.content === OPS_CAPPED_LINE && d.resp.choices[0].finish_reason === "length", "callDeepSeekStream: a reasoning-only stream cut at the cap returns the honest line", d.resp.choices[0]);
d = await mkDs(rf("short thought", "stop"))({}, [{ role: "user", content: "q" }], 8192, null, { upstreamModel: "deepseek/deepseek-v4-pro" });
ok(d.resp.choices[0].message.content === "short thought", "callDeepSeekStream: reasoning-only that ended with stop keeps the old copy", d.resp.choices[0]);
d = await mkDs([{ choices: [{ delta: { content: "an answer" } }] }, { choices: [{ delta: {}, finish_reason: "length" }] }])({}, [{ role: "user", content: "q" }], 8192, null, { upstreamModel: "deepseek/deepseek-v4-pro" });
ok(d.resp.choices[0].message.content === "an answer", "callDeepSeekStream: a stream with content is untouched at the cap", d.resp.choices[0]);
d = await mkDs([{ choices: [{ delta: { reasoning_content: "plan" } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "t", arguments: "{}" } }] } }] }, { choices: [{ delta: {}, finish_reason: "length" }] }])({}, [{ role: "user", content: "q" }], 8192, null, { upstreamModel: "deepseek/deepseek-v4-pro" });
ok(d.resp.choices[0].message.content === "plan" && d.resp.choices[0].message.tool_calls.length === 1, "callDeepSeekStream: a stream with a tool call keeps the old behaviour", d.resp.choices[0]);

// streamFinalAnswer is a closure inside handleChatCore: its two lines are read from the source
const sfa = grab("const streamFinalAnswer = ", "let finalized = false;");
ok(/let buf = "", reasoning = "", upFinish = "";/.test(sfa) && /chunk\.choices\[0\]\.finish_reason\) upFinish = chunk\.choices\[0\]\.finish_reason;/.test(sfa) && /content = opsReasoningAsReply\(upFinish, reasoning\);/.test(sfa), "streamFinalAnswer reads finish_reason and uses the helper");
ok(!/content = reasoning;/.test(sfa) && !/_g0\.content = String\(_g0\.reasoning_content\);/.test(src), "no site still copies reasoning into the reply unconditionally");
ok((src.match(/opsReasoningAsReply\(/g) || []).length === 5, "the helper is defined once and used at the four sites", (src.match(/opsReasoningAsReply\(/g) || []).length);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
