import assert from "node:assert/strict";
import { trimCells, compactMessages, capResult, LEAN_RESULT_CHARS, LEAN_CELL_CHARS } from "./src/lib.js";

// AGENTS-INPUT-CUT-1: wide cells are shortened, earlier tool rounds shrink, the newest round and non-tool messages stay whole.
const wide = "x".repeat(5000);
const rows = trimCells([{ id: 1, body: wide, n: 7 }]);
assert.equal(rows[0].id, 1); assert.equal(rows[0].n, 7);
assert.ok(rows[0].body.length < LEAN_CELL_CHARS + 40 && rows[0].body.includes("+4700 chars"));
assert.ok(LEAN_RESULT_CHARS <= 3000);

const tr = (id, v) => ({ role: "tool", content: [{ type: "tool-result", toolCallId: id, toolName: "fleet_sql", output: { type: "json", value: v } }] });
const asst = (id) => ({ role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName: "fleet_sql", input: {} }] });
const big = { ok: true, results: [{ a: "y".repeat(4000) }] };
const msgs = [{ role: "system", content: "s" }, { role: "user", content: "u".repeat(900) }, asst("1"), tr("1", big), asst("2"), tr("2", big)];
const out = compactMessages(msgs);
assert.equal(out.length, msgs.length);
assert.equal(out[1].content.length, 900, "user prompt untouched");
assert.ok(JSON.stringify(out[3]).length < 600, "round 1 result shrunk: " + JSON.stringify(out[3]).length);
assert.ok(out[3].content[0].output.value.includes("earlier result trimmed"));
assert.equal(JSON.stringify(out[5]), JSON.stringify(msgs[5]), "newest round whole");
assert.equal(out[3].content[0].toolCallId, "1"); // pairing with the tool call is kept
assert.deepEqual(compactMessages([{ role: "user", content: "a" }]), [{ role: "user", content: "a" }]);
const tiny = [asst("1"), tr("1", { ok: true }), asst("2")];
assert.equal(JSON.stringify(compactMessages(tiny)[1]), JSON.stringify(tiny[1]), "small results stay whole");
// size effect over a 6-step turn: cumulative input chars, with and without compaction
let before = 0, after = 0, hist = [{ role: "user", content: "u".repeat(1800) }];
for (let k = 1; k <= 6; k++) { hist = hist.concat([asst(String(k)), tr(String(k), big)]); before += JSON.stringify(hist).length; after += JSON.stringify(compactMessages(hist)).length; }
assert.ok(after < before * 0.5, `compaction halves cumulative input (${after} vs ${before})`);
assert.equal(capResult({ ok: true, a: "z".repeat(10000) }, 1000).truncated, true);
console.log("lean-compact: ok", Math.round((1 - after / before) * 100) + "% fewer chars over 6 steps");
