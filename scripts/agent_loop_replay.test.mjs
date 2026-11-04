// RM-DSH-REPLAY-1: offline suite for scripts/agent_loop_replay.mjs (no network, no model, no secret).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ReplayDivergence, canonicalize, firstDivergence, parseTranscript, createReplay, replay,
  findSecret, redactEntry, serializeTranscript, recordingAI, recordingFetch,
} from "./agent_loop_replay.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => join(here, "fixtures", "agent-replay", name);
const read = (name) => readFileSync(fx(name), "utf8");
let passed = 0;
async function t(name, fn) {
  try { await fn(); passed += 1; } catch (e) { console.error("FAIL " + name + ": " + (e && e.stack || e)); process.exitCode = 1; }
}
const handlerOf = async (name) => (await import(pathToFileURL(fx(name)).href)).default;

await t("canonicalize sorts keys and drops undefined", () => {
  assert.equal(JSON.stringify(canonicalize({ b: 1, a: { d: 2, c: undefined, e: [{ z: 1, y: 2 }] } })), '{"a":{"d":2,"e":[{"y":2,"z":1}]},"b":1}');
});

await t("firstDivergence names the path of the first difference", () => {
  assert.equal(firstDivergence({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] }), null);
  assert.deepEqual(firstDivergence({ a: [1, { b: "x" }] }, { a: [1, { b: "y" }] }), { path: "$.a[1].b", expected: '"x"', actual: '"y"' });
  assert.equal(firstDivergence({ a: 1 }, { a: 1, extra: true }).path, "$.extra");
  assert.equal(firstDivergence([1, 2], [1]).path, "$[1]");
  assert.equal(firstDivergence({ a: 1 }, { a: "1" }).path, "$.a");
});

await t("parseTranscript rejects a malformed or incomplete line by number", () => {
  assert.equal(parseTranscript(read("triage.transcript.jsonl")).length, 2);
  assert.throws(() => parseTranscript('{"model":"m","request":{},"response":{}}\nnot json'), /line 2 is not JSON/);
  assert.throws(() => parseTranscript('{"model":"m","request":{}}'), /line 1 needs model/);
  assert.equal(parseTranscript("\n\n").length, 0);
});

await t("an exact replay passes and the result matches the expected file", async () => {
  const out = await replay(parseTranscript(read("triage.transcript.jsonl")), await handlerOf("triage.handler.mjs"), JSON.parse(read("triage.input.json")), JSON.parse(read("triage.expect.json")));
  assert.equal(out.ok, true);
  assert.equal(out.calls, 2);
});

await t("key order in the request is not a divergence", async () => {
  const entries = parseTranscript(read("triage.transcript.jsonl"));
  entries[0].request = { messages: entries[0].request.messages, max_tokens: 16 };
  const out = await replay(entries, await handlerOf("triage.handler.mjs"), JSON.parse(read("triage.input.json")));
  assert.equal(out.calls, 2);
});

await t("one changed request field fails and names the path", async () => {
  const entries = parseTranscript(read("triage.transcript.jsonl"));
  entries[1].request.messages[0].content = "Write the single next action for a request.";
  await assert.rejects(replay(entries, await handlerOf("triage.handler.mjs"), JSON.parse(read("triage.input.json"))), (e) => {
    assert.ok(e instanceof ReplayDivergence);
    assert.equal(e.detail.call, 2);
    assert.equal(e.detail.path, "$.messages[0].content");
    assert.match(e.message, /call 2 request differs from the log at \$\.messages\[0\]\.content/);
    return true;
  });
});

await t("a different model fails before the request is compared", async () => {
  const entries = parseTranscript(read("triage.transcript.jsonl"));
  entries[0].model = "@cf/other/model";
  await assert.rejects(replay(entries, await handlerOf("triage.handler.mjs"), JSON.parse(read("triage.input.json"))), /call 1 model differs/);
});

await t("an extra call with no recorded counterpart fails", async () => {
  const entries = parseTranscript(read("triage.transcript.jsonl")).slice(0, 1);
  await assert.rejects(replay(entries, await handlerOf("triage.handler.mjs"), JSON.parse(read("triage.input.json"))), (e) => e.detail.extra === true && /more model calls than the transcript holds \(1\)/.test(e.message));
});

await t("a missing call (the loop stopped early) fails at finish", async () => {
  const entries = parseTranscript(read("triage.transcript.jsonl"));
  const r = createReplay(entries);
  await r.ai.run(entries[0].model, entries[0].request);
  assert.throws(() => r.finish(), (e) => e.detail.missing === true && /stopped after 1 of 2 logged calls/.test(e.message));
});

await t("a result that differs from the expected file fails", async () => {
  await assert.rejects(replay(parseTranscript(read("triage.transcript.jsonl")), await handlerOf("triage.handler.mjs"), JSON.parse(read("triage.input.json")), { label: "noise", action: "x" }), /result differs from the expected result at \$\.action/);
});

await t("the fetch client serves recorded OpenAI-style bodies and checks the request", async () => {
  const entries = parseTranscript(read("chat.transcript.jsonl"));
  const out = await replay(entries, await handlerOf("chat.handler.mjs"), { question: "What is the capital of France?" }, { answer: "Paris." });
  assert.equal(out.calls, 1);
  await assert.rejects(replay(parseTranscript(read("chat.transcript.jsonl")), await handlerOf("chat.handler.mjs"), { question: "What is the capital of Spain?" }), /request differs from the log at \$\.messages\[0\]\.content/);
});

await t("record then replay round-trips through the serialized transcript", async () => {
  const sink = [];
  const live = { run: async (model, request) => ({ response: request.messages[0].content.includes("Classify") ? "noise" : "Ignore it." }) };
  const handler = await handlerOf("triage.handler.mjs");
  const recorded = await handler({ ai: recordingAI(live, sink), input: { title: "Weekly digest ping" } });
  const text = serializeTranscript(sink);
  assert.equal(text.trim().split("\n").length, 2);
  const out = await replay(parseTranscript(text), handler, { title: "Weekly digest ping" }, recorded);
  assert.equal(out.calls, 2);
});

await t("recordingFetch copies the body and the response without consuming the response", async () => {
  const sink = [];
  const realFetch = async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 });
  const res = await recordingFetch(realFetch, sink)("https://x.invalid/", { method: "POST", body: JSON.stringify({ model: "m1", a: 1 }) });
  assert.deepEqual(await res.json(), { ok: 1 });
  assert.deepEqual(sink, [{ model: "m1", request: { model: "m1", a: 1 }, response: { ok: 1 } }]);
});

await t("secrets are found, redacted, and refused by serializeTranscript", () => {
  const bad = { model: "m", request: { headers: { authorization: "Bearer abcdefghijklmnop1234" }, messages: [{ role: "user", content: "key sk-abcdefghijklmnopqrstuv" }] }, response: {} };
  assert.ok(findSecret(bad));
  assert.throws(() => serializeTranscript([bad]), /secret-looking/);
  const clean = redactEntry(bad);
  assert.equal(findSecret(clean), null);
  assert.equal(clean.request.headers.authorization, "[REDACTED]");
  assert.match(clean.request.messages[0].content, /key \[REDACTED\]/);
  assert.doesNotThrow(() => serializeTranscript([clean]));
  assert.equal(findSecret({ model: "m", request: { messages: [{ role: "user", content: "no secrets here" }] }, response: {} }), null);
});

await t("the CLI exits 0 on a match and 1 on a divergence", () => {
  const run = (transcript, extra) => spawnSync(process.execPath, [join(here, "agent_loop_replay.mjs"), fx(transcript), "--handler", fx("triage.handler.mjs"), "--input", fx("triage.input.json")].concat(extra || []), { encoding: "utf8" });
  const ok = run("triage.transcript.jsonl", ["--expect", fx("triage.expect.json")]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /2 call\(s\) matched the log/);
  const bad = run("chat.transcript.jsonl");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /DIVERGED: call 1 model differs/);
  assert.equal(spawnSync(process.execPath, [join(here, "agent_loop_replay.mjs")], { encoding: "utf8" }).status, 2);
});

if (!process.exitCode) console.log("agent_loop_replay: PASS (" + passed + " checks)");
