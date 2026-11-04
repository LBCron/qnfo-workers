// CALIBRATION-TASK-TRUTH-1 (qnfo-ai-calibration 1.5.0, agent_issues 2338) offline suite. Replays the task-truth block from
// worker.js against an in-memory SQLite D1 and a stubbed router. Proves: the generator is deterministic per UTC hour and the
// expected value is computed, never listed; the integer extractor; the pair table (n11, n10, n01, n00, kappa); one row per
// item and model; the probe runs once an hour; a failed or empty call writes no row while a reply with text and no integer is
// wrong; truth_probe_items 0 turns it off; 30-day retention; /truth leaves out a reply served by another model. No network.
// Run: node qnfo-ai-calibration/task-truth.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { versionAtLeast } from "../scripts/version-at-least.mjs";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

const a = src.indexOf("// ---- CALIBRATION-TASK-TRUTH-1:BEGIN");
const b = src.indexOf("// ---- CALIBRATION-TASK-TRUTH-1:END ----");
if (a < 0 || b < a) throw new Error("CALIBRATION-TASK-TRUTH-1 block not found in worker.js");
const block = src.slice(a, b);
const runPoolSrc = src.slice(src.indexOf("async function runPool("), src.indexOf('__name(runPool, "runPool");'));

function d1(db) {
  // like D1, bind() returns a new statement; a batch holds several bound statements at once
  const stmt = (sql, args) => ({
    bind(...x) { return stmt(sql, x); },
    async run() { db.prepare(sql).run(...args); return { success: true }; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(list) { for (const s of list) await s.run(); return []; } };
}
const MODELS = ["m-a", "m-b", "m-c"];
function load(handler, cfg) {
  const calls = [];
  const jfetch = async (env, url, headers, body) => { calls.push(body); return handler(body); };
  const cfgGet = async (env, key, def) => (cfg && cfg[key] != null ? cfg[key] : key === "truth_every_hours" ? "1" : def);
  const mod = new Function("ALL_MODELS", "jfetch", "cfgGet", "__name",
    runPoolSrc + "\n" + block + "\nreturn { truthItems, truthExtract, truthPairs, truthTick, truthReport, TRUTH_KEEP_MS };")(MODELS, jfetch, cfgGet, (f) => f);
  return { mod, calls };
}
const expectedOf = (prompt) => {
  const m = /Compute (\d+) ([-+*]) (\d+)\./.exec(prompt);
  const x = Number(m[1]), y = Number(m[3]);
  return String(m[2] === "+" ? x + y : m[2] === "-" ? x - y : x * y);
};
const reply = (model, content, extra) => ({ status: 200, data: Object.assign({ model, choices: [{ message: { content } }] }, extra || {}) });
const NOW = 1791900000000, HOUR = Math.floor(NOW / 36e5);

// generator: deterministic per hour, computed answers, varied across hours
{
  const { mod } = load(() => ({ status: 500, data: null }));
  const i1 = mod.truthItems(HOUR, 3), i2 = mod.truthItems(HOUR, 3), i3 = mod.truthItems(HOUR + 1, 3);
  ok(JSON.stringify(i1) === JSON.stringify(i2), "the same hour gives the same items");
  ok(JSON.stringify(i1) !== JSON.stringify(i3), "the next hour gives different items");
  ok(i1.every((it, k) => it.expected === expectedOf(it.prompt) && it.item_id === "h" + HOUR + "-" + k), "each expected value is computed from its own prompt and item ids carry the hour", i1);
  let kinds = new Set();
  for (let h = 0; h < 60; h++) mod.truthItems(HOUR + h, 3).forEach((it) => kinds.add(/ ([-+*]) /.exec(it.prompt)[1]));
  ok(kinds.size === 3, "sums, differences and products all occur", [...kinds]);
  ok(mod.truthItems(HOUR, 0).length === 0, "zero items is an empty set");
}

// extractor
{
  const { mod } = load(() => ({ status: 500, data: null }));
  const e = mod.truthExtract;
  ok(e("391") === "391" && e("  42\n") === "42", "a bare integer");
  ok(e("17 * 23 = 391") === "391", "the last integer wins");
  ok(e("The answer is 1,234.") === "1234" && e("1,234,567") === "1234567", "thousands separators are dropped");
  ok(e("-17") === "-17" && e("100 - 50 = 50") === "50" && e("5 - 8 = -3") === "-3", "negative numbers and spaced minus signs");
  ok(e("no idea") === null && e("") === null && e(null) === null, "no integer is null");
}

// pair table
{
  const { mod } = load(() => ({ status: 500, data: null }));
  const rows = [];
  const add = (item, model, c) => rows.push({ item_id: item, model, correct: c });
  // a and b agree on every item (kappa 1); c is right exactly where a is wrong
  [1, 1, 0, 0].forEach((c, k) => { add("i" + k, "a", c); add("i" + k, "b", c); add("i" + k, "c", c ? 0 : 1); });
  const t = mod.truthPairs(rows);
  const ab = t.pairs.find((p) => p.a === "a" && p.b === "b"), ac = t.pairs.find((p) => p.a === "a" && p.b === "c");
  ok(ab.n11 === 2 && ab.n00 === 2 && ab.n10 === 0 && ab.n01 === 0 && ab.kappa === 1, "identical answers: kappa 1", ab);
  ok(ac.n10 === 2 && ac.n01 === 2 && ac.n11 === 0 && ac.n00 === 0 && ac.kappa === -1, "opposite answers: kappa -1", ac);
  ok(t.pairs.length === 3 && t.models.length === 3 && t.models[0].n === 4 && t.models[0].correct === 2, "three pairs and per-model counts", t);
  const same = mod.truthPairs([{ item_id: "x", model: "a", correct: 1 }, { item_id: "x", model: "b", correct: 1 }]);
  ok(same.pairs[0].n === 1 && same.pairs[0].kappa === null, "one all-right item leaves kappa undefined, not a number");
  const part = mod.truthPairs([{ item_id: "x", model: "a", correct: 1 }, { item_id: "y", model: "b", correct: 0 }]);
  ok(part.pairs[0].n === 0 && part.pairs[0].kappa === null, "items only one model answered are not paired");
}

// the probe against SQLite
{
  const db = new DatabaseSync(":memory:");
  const env = { QNFO_AUDIT: d1(db), QNFO_ROUTER_KEY: "k" };
  // m-a always right, m-b always wrong, m-c answers in words with no number
  const handler = (body) => {
    const exp = expectedOf(body.messages[0].content);
    if (body.model === "m-a") return reply("m-a", exp);
    if (body.model === "m-b") return reply("m-b", String(Number(exp) + 1));
    return reply("m-c", "I cannot say");
  };
  const { mod, calls } = load(handler, { truth_every_hours: "1" });
  const r1 = await mod.truthTick(env, NOW);
  ok(r1.ran === true && r1.items === 2 && calls.length === 6, "first tick asks every model every item (2 items x 3 models)", { r1, n: calls.length });
  ok(calls.every((c) => c.max_tokens === 16 && c.stream === false), "each call is max_tokens 16, not streamed");
  ok(calls.every((c) => c.hedge === false), "each call opts out of the router hedge (TURN-BUDGET-1 fast lane), so the asked model answers");
  const rows = db.prepare("SELECT * FROM ai_calibration_truth ORDER BY item_id, model").all();
  ok(rows.filter((x) => x.model === "m-a").length === 2 && rows.filter((x) => x.model === "m-a").every((x) => x.correct === 1 && x.got === x.expected && x.served_by === "m-a"), "a right model has right rows with its served_by");
  ok(rows.filter((x) => x.model === "m-b").length === 2 && rows.filter((x) => x.model === "m-b").every((x) => x.correct === 0 && x.got !== x.expected), "a wrong model has wrong rows");
  const cRows = rows.filter((x) => x.model === "m-c");
  ok(cRows.length === 2 && cRows.every((x) => x.correct === 0 && x.got === ""), "text without an integer is a wrong answer with an empty got", cRows);
  ok(rows.length + r1.unscorable + r1.errors === 6, "every call is a row, unscorable or an error", { rows: rows.length, r1 });
  const again = await mod.truthTick(env, NOW + 30 * 6e4);
  ok(again.ran === false && again.reason === "done this hour" && calls.length === 6, "the second */30 tick of the hour makes no call");
  const next = await mod.truthTick(env, NOW + 36e5);
  ok(next.ran === true && calls.length === 12, "the next hour runs again");
  const rep = await mod.truthReport(env, NOW + 36e5);
  ok(rep.ok && rep.rows === db.prepare("SELECT COUNT(*) n FROM ai_calibration_truth").get().n && rep.pairs.length === 3, "GET /truth reports all three pairs", rep);
  ok(rep.pairs.find((p) => p.a === "m-a" && p.b === "m-b").n10 === rep.pairs.find((p) => p.a === "m-a" && p.b === "m-b").n, "m-a right and m-b wrong gives only n10");
}

// failures, empty replies, off switch, retention, served_by
{
  const db = new DatabaseSync(":memory:");
  const env = { QNFO_AUDIT: d1(db), QNFO_ROUTER_KEY: "k" };
  let L = load(() => ({ status: 503, data: { error: "down" } }), { truth_every_hours: "1" });
  let r = await L.mod.truthTick(env, NOW);
  ok(r.ran === true && r.rows === 0 && r.errors === 6, "a router that is down writes no row", r);
  ok((await L.mod.truthTick(env, NOW + 6e4)).ran === true, "no rows means the next tick of the hour tries again");
  L = load((body) => reply(body.model, "   "), { truth_every_hours: "1" });
  r = await L.mod.truthTick(env, NOW);
  ok(r.rows === 0 && r.unscorable === 6, "an empty reply (a reasoning model out of tokens) is unscorable, not wrong", r);
  L = load(() => { throw new Error("boom"); }, { truth_every_hours: "1" });
  r = await L.mod.truthTick(env, NOW);
  ok(r.rows === 0 && r.errors === 6 && !r.error, "a thrown call is counted and never escapes", r);

  L = load((body) => reply(body.model, "1"), { truth_probe_items: "0" });
  r = await L.mod.truthTick(env, NOW);
  ok(r.ran === false && r.reason === "off" && L.calls.length === 0, "truth_probe_items 0 turns the probe off");
  L = load((body) => reply(body.model, "1"), { truth_probe_items: "junk" });
  r = await L.mod.truthTick(env, NOW);
  ok(r.items === 2, "an unreadable item count falls back to 2", r);
  L = load((body) => reply(body.model, "1"), { truth_probe_items: "9" });
  r = await L.mod.truthTick(env, NOW + 36e5);
  ok(r.items === 2, "an item count above 5 falls back to 2", r);

  // retention
  const old = NOW - 31 * 864e5;
  db.prepare("INSERT INTO ai_calibration_truth VALUES ('truth-old', ?, 'o-0', 'm-a', '1', '1', 1, 'm-a', 5)").run(old);
  L = load((body) => reply(body.model, expectedOf(body.messages[0].content)));
  await L.mod.truthTick(env, NOW + 2 * 36e5);
  ok(db.prepare("SELECT COUNT(*) n FROM ai_calibration_truth WHERE run_id = 'truth-old'").get().n === 0, "rows older than 30 days are deleted");
  ok(db.prepare("SELECT COUNT(*) n FROM ai_calibration_truth WHERE run_id = 'truth-" + (HOUR + 2) + "'").get().n === 6, "the new hour's rows stay");

  // served_by: a fallback's answer stays in the table and out of the pair table
  const db2 = new DatabaseSync(":memory:");
  const env2 = { QNFO_AUDIT: d1(db2), QNFO_ROUTER_KEY: "k" };
  L = load((body) => body.model === "m-b" ? reply("m-a", expectedOf(body.messages[0].content), { _router: { served_by: "m-a" } }) : reply(body.model, expectedOf(body.messages[0].content), { _router: { served_by: body.model } }));
  await L.mod.truthTick(env2, NOW);
  ok(db2.prepare("SELECT COUNT(*) n FROM ai_calibration_truth WHERE model = 'm-b' AND served_by = 'm-a'").get().n === 2, "the row for m-b records that m-a answered");
  const rep = await L.mod.truthReport(env2, NOW);
  ok(rep.excluded_served_by_other === 2 && !rep.models.some((m) => m.model === "m-b") && rep.pairs.length === 1, "the pair table leaves out the fallback's rows", rep);
}

// COST-CUT-CALIBRATION-1: the default cadence is every 6th UTC hour; truth_every_hours 1 restores hourly
{
  const db = new DatabaseSync(":memory:");
  const env = { QNFO_AUDIT: d1(db), QNFO_ROUTER_KEY: "k" };
  const six = (h) => 1000000 * 6 * 36e5 + h * 36e5; // an hour index divisible by 6, plus h hours
  const L = load((body) => reply(body.model, expectedOf(body.messages[0].content)), { truth_every_hours: "6" });
  const on = await L.mod.truthTick(env, six(0));
  ok(on.ran === true && L.calls.length === 6, "an hour divisible by 6 runs", on);
  const off = await L.mod.truthTick(env, six(1));
  ok(off.ran === false && off.reason === "cadence" && L.calls.length === 6, "the hours between make no call", off);
  const hourly = load((body) => reply(body.model, "1"), { truth_every_hours: "1" });
  ok((await hourly.mod.truthTick(env, six(1))).ran === true, "truth_every_hours 1 restores the hourly probe");
}

// the worker wiring
ok(/path === "\/truth" && request\.method === "GET"\) return json\(await truthReport\(env, Date\.now\(\)\)\)/.test(src), "GET /truth is served, open like the other aggregate reads");
ok(/Promise\.allSettled\(\[member, calibration\(env, "cron"\), truthTick\(env, Date\.now\(\)\)\]\)/.test(src), "the cron tick runs the truth probe beside the calibration");
const v = /var VERSION = "([^"]+)"/.exec(src)[1];
ok(versionAtLeast(v, "1.5.1"), "VERSION is at least 1.5.1 (the hedge opt-out)", v);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
