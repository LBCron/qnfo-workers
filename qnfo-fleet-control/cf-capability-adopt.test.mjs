/**
 * cf-capability-adopt.test.mjs -- offline suite for CF-CAPABILITY-ADOPT-1 (qnfo-fleet-control, RM-CAPABILITY-PRODUCT-LOOP-1, the adopt leg).
 * Replays the CF-CHANGELOG-LOOP-1 block of worker.js against an in-memory SQLite copy of the tables it reads and writes (real SQL, no mocks of the statements) and proves:
 * a proposed or not_considered row older than 14 days whose linked issue is not open (closed, missing or no link) is undecided; one with an open linked issue, a younger one and a
 * decided status are not; the tick counts them into cf_capability_undecided_14d, files at most 2 deduped CF-CAPABILITY-DECIDE-1 issues a day, proposed rows first and oldest first,
 * links the row to the new issue (so it counts as owned), stays inside the work-in-progress cap, does not file twice inside 20 hours or when an open issue of that title exists,
 * and never zeroes the metric when the catalog cannot be read.
 * Output MUST contain "0 failed" on success.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const BEGIN = "// ---- CF-CHANGELOG-LOOP-1:BEGIN", END = "// ---- CF-CHANGELOG-LOOP-1:END ----";
const a = src.indexOf(BEGIN), b = src.indexOf(END);
if (a < 0 || b < a) { console.error("FAIL cf-changelog block markers missing"); console.log("1 failed"); process.exit(1); }

let passed = 0, failed = 0;
const eq = (actual, expected, label) => { if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; } failed++; console.error(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`); };
const ok = (c, label) => eq(!!c, true, label);

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE cloudflare_capability_catalog (slug TEXT PRIMARY KEY, need TEXT NOT NULL, product TEXT NOT NULL, when_to_choose TEXT, status TEXT NOT NULL DEFAULT 'not_considered', linked_issue INTEGER, metric_ref TEXT, first_seen TEXT DEFAULT (datetime('now')), last_synced TEXT DEFAULT (datetime('now')));
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);
CREATE TABLE scheduler_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
INSERT INTO metric_registry (metric, last_value) VALUES ('cf_capability_undecided_14d', 'x'), ('unified_cost_usd_30d', '12.5');
INSERT INTO agent_issues (id, title, status) VALUES (1683, 'closed one', 'closed'), (1700, 'open one', 'open');
`);
const NOW = Date.parse("2026-11-05T06:00:00Z");
const day = (n) => new Date(NOW - n * 86400000).toISOString().replace("T", " ").slice(0, 19);
const add = (slug, status, ageDays, linked, metric) => db.prepare("INSERT INTO cloudflare_capability_catalog (slug, need, product, when_to_choose, status, linked_issue, metric_ref, first_seen) VALUES (?, ?, ?, 'when', ?, ?, ?, ?)").run(slug, "need " + slug, "Product " + slug, status, linked, metric, day(ageDays));
add("old-closed", "proposed", 35, 1683, "unified_cost_usd_30d");
add("old-nolink", "proposed", 30, null, null);
add("old-missing", "proposed", 34, 99999, null);
add("old-open", "proposed", 40, 1700, null);
add("young", "proposed", 3, null, null);
add("decided", "in_use", 50, null, null);
add("rejected", "rejected", 50, null, null);
add("old-nc", "not_considered", 20, null, null);
add("newest-proposed", "proposed", 15, null, null);

let readable = true;
const env = { AUDIT: { prepare(sql) {
  let args = [];
  const st = {
    bind(...x) { args = x; return st; },
    async all() { if (!readable && /FROM cloudflare_capability_catalog/.test(sql)) throw new Error("D1_ERROR: D1 DB is overloaded"); return { results: db.prepare(sql).all(...args) }; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  };
  return st;
} } };
const sandbox = { env, console: { error() {}, log() {} }, VERSION: "test", timedFetch: null, Date, Math, JSON, Number, String, Object, Array, RegExp, isNaN, TextDecoder, __export: null,
  charterRows: async (e, sql) => { try { return (await e.AUDIT.prepare(sql).all()).results || []; } catch (x) { return []; } },
  charterOne: async (e, sql) => { try { return await e.AUDIT.prepare(sql).first(); } catch (x) { return null; } } };
vm.createContext(sandbox);
vm.runInContext(src.slice(a, b + END.length) + "\n__export = { cfdUndecided, cfdIssueText, cfdTick, cfdSafe, CFD_ROWS_SQL, CFD_CAP_DAY, CFD_WIP_MAX, CFD_AGE_DAYS };", sandbox, { filename: "cf-changelog-block.js" });
const C = sandbox.__export;

// pure half
const rows = db.prepare(C.CFD_ROWS_SQL).all();
eq(rows.length, 7, "the catalog read returns only proposed and not_considered rows");
const und = C.cfdUndecided(rows, NOW).map((r) => r.slug);
eq(und.slice().sort(), ["newest-proposed", "old-closed", "old-missing", "old-nc", "old-nolink"], "undecided: closed, missing and absent links count; an open link, a young row and a decided status do not");
eq(und, ["old-closed", "old-missing", "old-nolink", "newest-proposed", "old-nc"], "proposed first, oldest first, not_considered last");
const link = rows.find((r) => r.slug === "old-closed");
ok(/previous link was issue 1683 \(closed\)/.test(C.cfdIssueText(link, "12.5")) && /unified_cost_usd_30d \(now 12\.5\)/.test(C.cfdIssueText(link, "12.5")), "the issue text carries the old link, the metric and its value");
ok(/no linked issue/.test(C.cfdIssueText(rows.find((r) => r.slug === "old-nolink"), null)) && /none named/.test(C.cfdIssueText(rows.find((r) => r.slug === "old-nolink"), null)), "and says so when there is none");
ok(/Definition of done/.test(C.cfdIssueText(link, null)) && /wontfix/.test(C.cfdIssueText(link, null)), "and states the definition of done");

// the tick
let out = await C.cfdTick(env, NOW);
eq([out.undecided, out.filed], [5, 2], "first tick: 5 undecided, 2 filed (the daily cap)");
const filed = db.prepare("SELECT id, title, source, status FROM agent_issues WHERE title LIKE 'CF-CAPABILITY-DECIDE-1:%' ORDER BY id").all();
eq(filed.map((i) => i.title), ["CF-CAPABILITY-DECIDE-1: old-closed", "CF-CAPABILITY-DECIDE-1: old-missing"], "the two oldest proposed rows");
ok(filed.every((i) => i.status === "open" && i.source === "cf-capability"), "filed open with the cf-capability source");
eq(db.prepare("SELECT linked_issue FROM cloudflare_capability_catalog WHERE slug = 'old-closed'").get().linked_issue, filed[0].id, "the row links the new issue");
eq(db.prepare("SELECT last_value FROM metric_registry WHERE metric = 'cf_capability_undecided_14d'").get().last_value, "5", "the metric counts the 5 undecided rows before filing");
ok(db.prepare("SELECT updated_at FROM scheduler_state WHERE key = 'cf_capability_decide'").get(), "the filing is stamped");

out = await C.cfdTick(env, NOW + 3600000);
eq([out.undecided, out.filed, out.skipped], [3, 0, "filed within 20h"], "an hour later: the 3 remaining are counted (the linked ones are owned) and nothing is filed again");
eq(db.prepare("SELECT last_value FROM metric_registry WHERE metric = 'cf_capability_undecided_14d'").get().last_value, "3", "the metric follows");

out = await C.cfdTick(env, NOW + 21 * 3600000);
eq([out.undecided, out.filed], [3, 2], "after 20 hours: two more are filed");
eq(db.prepare("SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'CF-CAPABILITY-DECIDE-1:%'").get().n, 4, "four decision issues exist");

// a closed decision issue frees its row to be decided again only if the row is still undecided; an open one of that title is reused, never duplicated
db.exec("UPDATE agent_issues SET status = 'closed' WHERE title = 'CF-CAPABILITY-DECIDE-1: old-closed'; UPDATE cloudflare_capability_catalog SET status = 'in_use' WHERE slug = 'old-closed'");
db.exec("UPDATE scheduler_state SET updated_at = '2026-01-01T00:00:00Z'");
db.exec("DELETE FROM cloudflare_capability_catalog WHERE slug = 'old-nc'; UPDATE cloudflare_capability_catalog SET linked_issue = NULL WHERE slug = 'old-missing'");
out = await C.cfdTick(env, NOW + 48 * 3600000);
eq(db.prepare("SELECT COUNT(*) n FROM agent_issues WHERE title = 'CF-CAPABILITY-DECIDE-1: old-missing'").get().n, 1, "an open issue of that title is reused, not duplicated");
eq(db.prepare("SELECT linked_issue FROM cloudflare_capability_catalog WHERE slug = 'old-missing'").get().linked_issue, filed[1].id, "and the row is relinked to it");

// work-in-progress cap
db.exec("UPDATE scheduler_state SET updated_at = '2026-01-01T00:00:00Z'");
for (let i = 0; i < 6; i++) db.prepare("INSERT INTO agent_issues (title, status) VALUES (?, 'open')").run("CF-CAPABILITY-DECIDE-1: filler-" + i);
add("another", "proposed", 60, null, null);
out = await C.cfdTick(env, NOW + 72 * 3600000);
eq([out.filed, out.skipped], [0, "decision issues at their work-in-progress cap"], "at the work-in-progress cap nothing is filed");

// an unreadable catalog never zeroes the metric
db.exec("UPDATE metric_registry SET last_value = '7' WHERE metric = 'cf_capability_undecided_14d'");
readable = false;
out = await C.cfdTick(env, NOW + 80 * 3600000);
eq([out.skipped, db.prepare("SELECT last_value FROM metric_registry WHERE metric = 'cf_capability_undecided_14d'").get().last_value], ["catalog unreadable", "7"], "an unreadable catalog leaves the metric alone");
const safe = await C.cfdSafe({ AUDIT: { prepare() { throw new Error("boom"); } } });
ok(safe && typeof safe === "object" && !safe.filed, "a binding that throws never breaks the changelog tick (cfdSafe)");
readable = true;

// nothing undecided
db.exec("UPDATE cloudflare_capability_catalog SET status = 'in_use'");
out = await C.cfdTick(env, NOW + 90 * 3600000);
eq([out.undecided, out.skipped], [0, "none undecided"], "nothing undecided: nothing filed");
eq(db.prepare("SELECT last_value FROM metric_registry WHERE metric = 'cf_capability_undecided_14d'").get().last_value, "0", "and the metric reads 0");

// wiring
ok(/async function cfChangelogIfStale\(env\)[\s\S]{0,700}cfdSafe\(env\)[\s\S]{0,200}cfdSafe\(env\)/.test(src), "cfChangelogIfStale runs the adopt step on the fresh and the stale path");
ok(src === readFileSync(join(here, "deployed-current.worker.js"), "utf8"), "deployed-current.worker.js is identical to worker.js");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
