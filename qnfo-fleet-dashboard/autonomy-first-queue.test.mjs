// DASHBOARD-AUTONOMY-FIRST-1 offline suite (qnfo-fleet-dashboard 1.27.0, agent_issues 2171). Proves: the SCALE_BACK
// investment verdict no longer becomes an owner queue card (KILL and a due gate still do) and /api/human says
// spend_decision "fleet"; a research, pipeline, paper or queue question reads research_queue facts (status counts, active
// stages, newest published, oldest queued) and the no-model fallback prints them; the 15-minute cron feeds fleet_tick
// directly with the 9-minute dedupe (D1-TRIGGER-DEPTH-1). Run: node qnfo-fleet-dashboard/autonomy-first-queue.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

// 1. The owner queue: the decision card fires on KILL or a due gate, never on SCALE_BACK.
const cardLine = src.split("\n").find((l) => l.includes('items.unshift({ key: "decision"'));
ok(cardLine && /decision\.verdict === "KILL"/.test(cardLine) && !/verdict === "SCALE_BACK" \|\|/.test(cardLine), "SCALE_BACK is not a condition of the owner decision card", cardLine && cardLine.slice(0, 160));
const hv = src.slice(src.indexOf("async function humanView("), src.indexOf("async function humanView(") + 8000);
ok(/schema_version: "fleet-human\/v2",\s*spend_decision: "fleet",/.test(hv), "/api/human carries spend_decision fleet");

// 2. Research facts for Ask and its fallback.
const block = src.slice(src.indexOf("var RESEARCH_Q = "), src.indexOf("async function cmdAnswer("));
const helpers = src.slice(src.indexOf("function squash(s) {"), src.indexOf("__name(squash")) + "\n" + src.slice(src.indexOf("const D1_PRIMARY_ONLY"), src.indexOf("__name(d1all"));
const sb = {}; vm.createContext(sb);
vm.runInContext(helpers + "\n" + block + "\n__f = { RESEARCH_Q, researchFacts, researchFactsText };", sb);
const { RESEARCH_Q, researchFacts, researchFactsText } = sb.__f;
ok(["What's current/pending research pipeline/queue?", "which papers shipped", "queue?"].every((q) => RESEARCH_Q.test(q)) && !RESEARCH_Q.test("status"), "research questions are recognised");
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE research_queue (id TEXT PRIMARY KEY, idea TEXT, status TEXT, stage TEXT, created_at TEXT, published_at TEXT, paper_slug TEXT)");
const ins = db.prepare("INSERT INTO research_queue VALUES (?,?,?,?,?,?,?)");
ins.run("r1", "Oldest queued idea about entropy", "queued", null, "2026-10-01 10:00:00", null, null);
ins.run("r2", "Second idea", "queued", null, "2026-10-05 10:00:00", null, null);
ins.run("r3", "In review", "review", "review", "2026-10-03 10:00:00", null, null);
ins.run("r4", "Shipped", "published", "done", "2026-09-30 10:00:00", "2026-10-07T12:00:00Z", "entropy-paper");
const d1 = { prepare(sql) { const st = { bind(...a) { st.a = a; return st; }, async all() { return { results: db.prepare(sql).all(...(st.a || [])) }; } }; return st; } };
const r = await researchFacts({ AUDIT: d1 });
ok(r.by_status.find((x) => x.status === "queued").n === 2 && r.newest_published.paper_slug === "entropy-paper" && r.oldest_queued.id === "r1" && r.active_stages.some((x) => x.stage === "review"), "researchFacts reads counts, stages, newest published and oldest queued", r);
const t = researchFactsText(r);
ok(/^Research pipeline: /.test(t) && t.includes("queued 2") && t.includes("entropy-paper") && t.includes("Oldest queued since 2026-10-01"), "the fallback text answers the question asked", t);
const broken = await researchFacts({ AUDIT: { prepare() { throw new Error("no such table: research_queue"); } } });
ok(broken.error && /unreadable/.test(researchFactsText(broken)), "an unreadable table is said plainly, never thrown", broken);
ok(/if \(c && c\.research\) lines\.push\("", researchFactsText\(c\.research\)\);/.test(src) && /if \(RESEARCH_Q\.test\(text\)\) c\.research = await researchFacts\(env\);/.test(src), "cmdAnswer reads the facts and cmdFallback prints them");

// 3. The cron's fleet_tick producer (D1-TRIGGER-DEPTH-1).
// FLEET-TICK-ISOLATE-1 (1.49.2): the insert lives in feedFallbackTick (guard string + plain insert + OR IGNORE retry); scheduled() calls it first.
ok(/"INSERT INTO fleet_tick \(source\) SELECT 'cron:qnfo-fleet-dashboard'" \+ guard/.test(src) && /const guard = " WHERE NOT EXISTS \(SELECT 1 FROM fleet_tick WHERE ts > strftime\('%Y-%m-%dT%H:%M:%SZ', 'now', '-9 minutes'\)\)"\s*\+ " OR NOT EXISTS \(SELECT 1 FROM fleet_tick WHERE source LIKE 'cron:qnfo-fleet-dashboard%' AND ts > strftime\('%Y-%m-%dT%H:%M:%SZ', 'now', '-360 minutes'\)\)";/.test(src) && /const tickOk = await feedFallbackTick\(env\);/.test(src), "the 15-minute cron feeds fleet_tick with the 9-minute dedupe");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
