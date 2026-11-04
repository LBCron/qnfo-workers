// CLOUD-OPS-EVENTS-TRIGGER-COST-1 offline suite: replays migrations/2026-11-04-cloud-ops-events-trigger-cost.sql on an in-memory
// SQLite and proves: (a) the new tool_error_rate_filer_v3_ins files the same agent_issues as the old one for every ts format
// (T/Z, 19-char space, short, NULL) and every threshold arm; (b) the planner seeks idx_coe_kind_text_ts for the 24h counts and
// idx_sha_dispatched_open for the self-heal reaper; (c) the reaper still reaps; (d) the file is idempotent; (e) rollback restores
// the old trigger from the backup table. Run: node migrations/cloud-ops-events-trigger-cost.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-04-cloud-ops-events-trigger-cost.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };

const m = sql.match(/CREATE TRIGGER tool_error_rate_filer_v3_ins[\s\S]*?\nEND;/);
ok(!!m, "new trigger found in migration");
const NEW_TRIG = m[0];
// The old trigger is the new one with the five `e.ts >=` comparisons wrapped in substr(,1,19), exactly as read from sqlite_master.
const OLD_TRIG = NEW_TRIG.replace(/e\.ts >= strftime/g, "substr(e.ts,1,19) >= strftime");
ok((OLD_TRIG.match(/substr\(e\.ts,1,19\)/g) || []).length === 5, "old trigger has five substr comparisons");
ok(!/substr\(e\.ts/.test(NEW_TRIG), "new trigger has none");

const REAPER = `CREATE TRIGGER self_heal_reap_stale_v2_ins AFTER INSERT ON cloud_ops_events WHEN NEW.kind = 'ops_ai_tool' BEGIN UPDATE self_heal_actions SET status='verified-failed', verified_at=datetime('now') WHERE status='dispatched' AND verified_at IS NULL AND replace(substr(ts,1,19),' ','T') < strftime('%Y-%m-%dT%H:%M:%S','now','-2 hours'); END`;

function freshDb(variant) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
    CREATE INDEX idx_coe_kind_text_ts ON cloud_ops_events(kind, text, ts);
    CREATE TABLE tool_error_exclusions (pattern TEXT PRIMARY KEY);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE self_heal_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, ref TEXT, action TEXT, ts TEXT, status TEXT, verified_at TEXT, claim TEXT, confidence REAL);`);
  db.exec(OLD_TRIG);
  db.exec(REAPER);
  if (variant === "new") db.exec(sql);
  return db;
}

const iso = (minAgo, fmt) => {
  const d = new Date(Date.now() - minAgo * 60000).toISOString();
  if (fmt === "T") return d;                       // 2026-11-04T10:00:00.000Z
  if (fmt === "space") return d.slice(0, 19).replace("T", " "); // 19 chars, space
  if (fmt === "t19") return d.slice(0, 19);        // 19 chars, T
  return d;
};

// Scenario: for a given tool, N calls and E errors, ts in the given format; the last insert is the trigger firing.
function run(variant, { calls, errors, fmt, old = 0, excl = false, tool = "t1" }) {
  const db = freshDb(variant);
  if (excl) db.prepare("INSERT INTO tool_error_exclusions VALUES ('EXCLUDED')").run();
  const ins = db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, status) VALUES (?,?,?,?,?,?)");
  let n = 0;
  for (let i = 0; i < old; i++) ins.run("o" + n++, iso(60 * 24 + 5 + i, "T"), "ops_ai_tool", tool, "{}", "error"); // outside the 24h window
  for (let i = 0; i < calls - errors; i++) ins.run("c" + n++, iso(10 + i, fmt), "ops_ai_tool", tool, "{}", "ok");
  for (let i = 0; i < errors; i++) ins.run("e" + n++, iso(5 + i, fmt), "ops_ai_tool", tool, excl && i % 2 ? "EXCLUDED" : "{}", "error");
  ins.run("other", iso(1, fmt), "canonical_refresh", tool, "{}", "error");
  const issues = db.prepare("SELECT title, priority, status FROM agent_issues ORDER BY id").all();
  return issues.map((r) => `${r.title}|${r.priority}|${r.status}`);
}

const scenarios = [
  { calls: 5, errors: 5, fmt: "T" },            // below the 20-call sample
  { calls: 30, errors: 12, fmt: "T" },          // 12/30 = 0.4 >= 0.25 -> files
  { calls: 100, errors: 12, fmt: "T" },         // 12% and < 60 -> no file
  { calls: 100, errors: 12, fmt: "T", old: 50 },// old errors outside the window must not count
  { calls: 80, errors: 62, fmt: "T" },          // raw-volume arm >= 60
  { calls: 30, errors: 12, fmt: "space" },      // 19-char space ts
  { calls: 30, errors: 12, fmt: "t19" },        // 19-char T ts (no suffix)
  { calls: 30, errors: 12, fmt: "T", excl: true },
  { calls: 60, errors: 30, fmt: "t19", tool: "t2" },
];
for (const s of scenarios) {
  const a = run("old", s), b = run("new", s);
  ok(JSON.stringify(a) === JSON.stringify(b), "same issues old vs new " + JSON.stringify(s), { old: a, new: b });
}
// at least one scenario must actually file, so the comparison is not vacuous
ok(run("new", scenarios[1]).length === 1 && run("new", scenarios[4]).length === 1, "filing arms are exercised");
ok(run("new", scenarios[2]).length === 0, "no-file arm is exercised");

// Boundary: ts exactly equal to the cutoff prefix and NULL ts agree between the two expressions.
{
  const db = new DatabaseSync(":memory:");
  const X = "2026-11-03T10:00:00";
  for (const ts of [X, X + ".000Z", "2026-11-03T09:59:59.999Z", "2026-11-03 10:00:00", "2026-11-03", null, ""]) {
    const a = db.prepare("SELECT substr(?,1,19) >= ? AS v").get(ts, X).v;
    const b = db.prepare("SELECT ? >= ? AS v").get(ts, X).v;
    ok(a === b, "boundary equivalence for " + JSON.stringify(ts), { a, b });
  }
}

// Planner: the 24h count seeks the (kind,text,ts) index; the reaper scans the partial index only.
{
  const db = freshDb("new");
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM cloud_ops_events e WHERE e.kind='ops_ai_tool' AND e.text = 'x' AND e.ts >= '2026-01-01T00:00:00'").all().map((r) => r.detail).join(" ");
  ok(/idx_coe_kind_text_ts \(kind=\? AND text=\? AND ts>\?\)/.test(plan), "range seek on ts", plan);
  const oldPlan = db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM cloud_ops_events e WHERE e.kind='ops_ai_tool' AND e.text = 'x' AND substr(e.ts,1,19) >= '2026-01-01T00:00:00'").all().map((r) => r.detail).join(" ");
  ok(!/ts>\?/.test(oldPlan), "old form cannot seek ts", oldPlan);
  const rp = db.prepare("EXPLAIN QUERY PLAN UPDATE self_heal_actions SET status='x' WHERE status='dispatched' AND verified_at IS NULL AND replace(substr(ts,1,19),' ','T') < '2026-11-04T00:00:00'").all().map((r) => r.detail).join(" ");
  ok(/idx_sha_dispatched_open/.test(rp), "reaper uses partial index", rp);
}

// Reaper behaviour is unchanged: stale dispatched rows are reaped on an ops_ai_tool insert, fresh and verified ones are not.
for (const variant of ["old", "new"]) {
  const db = freshDb(variant);
  const sh = db.prepare("INSERT INTO self_heal_actions (kind, ts, status, verified_at) VALUES ('k',?,?,?)");
  sh.run(iso(3 * 60, "T"), "dispatched", null);      // stale -> reaped
  sh.run(iso(30, "T"), "dispatched", null);          // fresh -> kept
  sh.run(iso(3 * 60, "space"), "dispatched", null);  // stale, space format -> reaped
  sh.run(iso(3 * 60, "T"), "dispatched", "2026-01-01"); // verified -> kept
  sh.run(iso(3 * 60, "T"), "ok", null);              // other status -> kept
  db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, status) VALUES ('r', ?, 'ops_ai_tool', 'x', 'ok')").run(iso(0, "T"));
  const st = db.prepare("SELECT status FROM self_heal_actions ORDER BY id").all().map((r) => r.status);
  ok(JSON.stringify(st) === JSON.stringify(["verified-failed", "dispatched", "verified-failed", "dispatched", "ok"]), "reaper result " + variant, st);
}

// Idempotent: second apply changes nothing; backup holds the OLD trigger text; rollback restores it.
{
  const db = freshDb("new");
  db.exec(sql);
  const cnt = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name='tool_error_rate_filer_v3_ins'").get().c;
  ok(cnt === 1, "one trigger after double apply");
  // The backup in this fresh DB was taken from the old trigger on first apply.
  const bak = db.prepare("SELECT sql FROM bak_20261104_coe_filer_trigger").all();
  ok(bak.length === 1 && /substr\(e\.ts,1,19\)/.test(bak[0].sql), "backup holds old trigger", bak.length);
  db.exec("DROP INDEX IF EXISTS idx_sha_dispatched_open; DROP TRIGGER IF EXISTS tool_error_rate_filer_v3_ins;");
  db.exec(bak[0].sql);
  const cur = db.prepare("SELECT sql FROM sqlite_master WHERE name='tool_error_rate_filer_v3_ins'").get().sql;
  ok(/substr\(e\.ts,1,19\)/.test(cur), "rollback restored old trigger");
  ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='idx_sha_dispatched_open'").get(), "rollback dropped index");
}

console.log(`cloud-ops-events-trigger-cost: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
