// AI-METER-AE-1 (roadmap RM-ANALYTICS-ENGINE-METERS-1, pillar cost, agent_issues 1001927): spendRecord writes one Workers Analytics Engine data point per routed model
// call (binding AI_METER, dataset qnfo_ai_calls) BEFORE the D1 guard, so a D1 overload that makes the ledger skip its row no longer hides the call. The write is guarded:
// no binding writes nothing, a throwing binding is logged and never reaches the caller, and the ledger write is unchanged. Run: node qnfo-ai/ai-meter-ae.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
let ok = 0, bad = 0;
const t = (name, cond, info) => { if (cond) ok++; else { bad++; console.log("FAIL " + name, info === undefined ? "" : JSON.stringify(info).slice(0, 400)); } };
const grab = (re) => { const m = re.exec(src); if (!m) throw new Error("not found: " + re); return m[0]; };

const sStart = src.indexOf("function spendRecord(");
const sEnd = src.indexOf("\nfunction spendUsageOf(", sStart);
t("spendRecord found", sStart >= 0 && sEnd > sStart);
const spendRecordSrc = src.slice(sStart, sEnd);
const code = [
  grab(/function aiMeterPoint\([\s\S]*?\n\}\n/),
  grab(/function aiMeterWrite\([\s\S]*?\n\}\n/),
  spendRecordSrc,
].join("\n");

const logs = [];
function sandbox(overrides) {
  const ledger = [];
  const ctx = vm.createContext(Object.assign({
    console: { error: (m) => logs.push(String(m)) },
    __spendState: { pending: {}, by: {} },
    spendDay: () => "2026-11-05",
    spendUsd: (p, m, i, o) => (i * 1 + o * 4) / 1e6,
    spendEnsure: async () => {},
    spendPriceFallback: () => false,
    d1AttrWriteSkip: () => false,
    d1OverloadTrip: () => false,
    __ledger: ledger,
  }, overrides || {}));
  vm.runInContext(code + "\nthis.aiMeterPoint = aiMeterPoint; this.aiMeterWrite = aiMeterWrite; this.spendRecord = spendRecord;", ctx);
  return ctx;
}
const fakeDb = (ledger) => ({ prepare: (sql) => ({ bind: (...a) => ({ run: async () => { ledger.push({ sql, a }); } }) }) });
const tick = () => new Promise((r) => setTimeout(r, 5));

// the point
{
  const c = sandbox();
  const p = c.aiMeterPoint("workers-ai", "@cf/zai-org/glm-5.3-flash", "qnfo-ops", 2000.4, 100, 0.0123, 50, {});
  t("a point carries provider, model, caller and outcome as blobs", JSON.stringify(p.blobs) === JSON.stringify(["workers-ai", "@cf/zai-org/glm-5.3-flash", "qnfo-ops", "ok"]), p.blobs);
  t("calls, in_tok, out_tok, usd and cached_tok are the five doubles", JSON.stringify(p.doubles) === JSON.stringify([1, 2000, 100, 0.0123, 50]), p.doubles);
  t("the caller is the one index", JSON.stringify(p.indexes) === JSON.stringify(["qnfo-ops"]), p.indexes);
  const r = c.aiMeterPoint("workers-ai", "m", "x", 10, 10, 0, 0, { refused: true });
  t("a refused call is outcome refused with 0 calls, as in the ledger", r.blobs[3] === "refused" && r.doubles[0] === 0, r);
  const d = c.aiMeterPoint("workers-ai", "m", "x", 10, 10, 0, 0, { downgraded: true });
  t("a downgraded call is outcome downgraded with 0 calls", d.blobs[3] === "downgraded" && d.doubles[0] === 0, d);
  const long = c.aiMeterPoint("p".repeat(100), "m".repeat(300), "c".repeat(200), NaN, undefined, undefined, -5, {});
  t("long names are cut and bad numbers are 0", long.blobs[0].length === 40 && long.blobs[1].length === 120 && long.blobs[2].length === 80 && long.indexes[0].length <= 90 && long.doubles.every((x) => x === 0 || x === 1), long);
  t("an index stays under the 96-byte Analytics Engine limit", Buffer.byteLength(long.indexes[0]) <= 96);
}

// the guarded write
{
  const c = sandbox();
  t("no env: nothing written, no throw", c.aiMeterWrite(undefined, {}) === false);
  t("no binding: nothing written, no throw", c.aiMeterWrite({}, {}) === false);
  t("a binding without writeDataPoint writes nothing", c.aiMeterWrite({ AI_METER: {} }, {}) === false);
  const seen = [];
  t("a working binding gets the point", c.aiMeterWrite({ AI_METER: { writeDataPoint: (p) => seen.push(p) } }, { a: 1 }) === true && seen.length === 1 && seen[0].a === 1);
  logs.length = 0;
  t("a throwing binding is logged and returns false", c.aiMeterWrite({ AI_METER: { writeDataPoint: () => { throw new Error("analytics down"); } } }, {}) === false && logs.some((l) => /analytics down/.test(l)), logs);
}

// spendRecord: the point is written before the D1 guard
{
  const pts = [];
  const env = { AI_METER: { writeDataPoint: (p) => pts.push(p) }, __spendCaller: "qnfo-ops" };
  const c = sandbox();
  c.spendRecord(env, "workers-ai", "@cf/zai-org/glm-5.3-flash", 1000, 100, {});
  t("with no D1 binding the call is still recorded in Analytics Engine", pts.length === 1 && pts[0].blobs[2] === "qnfo-ops" && pts[0].doubles[0] === 1, pts);
  const skipped = sandbox({ d1AttrWriteSkip: () => true });
  const led2 = skipped.__ledger;
  skipped.spendRecord(Object.assign({ QNFO_AUDIT: fakeDb(led2) }, env), "workers-ai", "m", 10, 10, {});
  await tick();
  t("while D1 is overloaded the ledger row is skipped but the point is written", pts.length === 2 && led2.length === 0, { pts: pts.length, ledger: led2.length });
  const live = sandbox();
  const led3 = live.__ledger;
  live.spendRecord(Object.assign({ QNFO_AUDIT: fakeDb(led3) }, env), "workers-ai", "m", 10, 10, {});
  await tick();
  t("with D1 healthy both the ledger row and the point are written", pts.length === 3 && led3.length >= 1 && /INSERT INTO ai_spend_ledger/.test(led3[0].sql), { pts: pts.length, ledger: led3.map((x) => x.sql.slice(0, 40)) });
  t("the ledger caller and the point caller agree", led3[0].a[2] === "qnfo-ops" && pts[2].blobs[2] === "qnfo-ops", { led: led3[0] && led3[0].a, pt: pts[2].blobs });
  const anon = sandbox(), led4 = anon.__ledger;
  const pts4 = [];
  anon.spendRecord({ AI_METER: { writeDataPoint: (p) => pts4.push(p) }, QNFO_AUDIT: fakeDb(led4) }, "deepseek", "deepseek-chat", 10, 10, {});
  await tick();
  t("with no caller set both say public", pts4[0].blobs[2] === "public" && led4[0].a[2] === "public", { pt: pts4[0].blobs, led: led4[0] && led4[0].a });
  const boom = sandbox(), led5 = boom.__ledger;
  let threw = null;
  try { boom.spendRecord({ AI_METER: { writeDataPoint: () => { throw new Error("analytics down"); } }, QNFO_AUDIT: fakeDb(led5) }, "workers-ai", "m", 10, 10, {}); } catch (e) { threw = e; }
  await tick();
  t("a throwing Analytics Engine binding never reaches the caller and the ledger row is still written", threw === null && led5.length >= 1, { threw: String(threw), ledger: led5.length });
  const pending = sandbox();
  pending.spendRecord({}, "workers-ai", "m", 1e6, 0, {});
  t("the in-isolate pending spend is still counted when nothing can be written", Object.keys(pending.__spendState.pending).length === 1);
}

// the source order and the binding declaration
{
  const body = spendRecordSrc;
  const iPoint = body.indexOf("aiMeterWrite(env, aiMeterPoint(");
  const iGuard = body.indexOf("d1AttrWriteSkip()");
  t("the Analytics Engine write comes before the D1 guard in spendRecord", iPoint > 0 && iGuard > iPoint, { iPoint, iGuard });
  t("wrangler.toml declares the AI_METER dataset", /\[\[analytics_engine_datasets\]\]\s*\nbinding = "AI_METER"\s*\ndataset = "qnfo_ai_calls"/.test(toml));
  t("only one AI_METER binding is declared", (toml.match(/binding = "AI_METER"/g) || []).length === 1);
}

console.log(ok + " passed, " + bad + " failed");
process.exit(bad ? 1 : 0);
