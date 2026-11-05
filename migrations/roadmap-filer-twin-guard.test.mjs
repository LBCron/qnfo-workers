// ROADMAP-TWIN-GUARD-1 offline suite for migrations/2026-11-05-roadmap-filer-twin-guard.sql (real SQLite).
// The rm-file statement below keeps the real WHERE clause of fleet_tasks management-personas step 45 byte for byte (read 2026-11-05) and shortens only the column list.
// Proves: the guard is added once; a proposal whose title a session already filed (open, or closed in the last 3 days) is not filed, in any program-code form; an unrelated proposal and an old closed twin are filed;
// the 3-open-per-program cap, the id dedupe and the switches still work; replay is a no-op; a step that is not rm-file at index 45 is not touched; the rollback removes exactly the guard.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migration = readFileSync(fileURLToPath(new URL("./2026-11-05-roadmap-filer-twin-guard.sql", import.meta.url)), "utf8");
const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
assert.ok(rollback);
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
const body = migration.replace(/^--.*$/gm, "");

const RM_FILE = "INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) SELECT 'ROADMAP-1: ' || p.program_code || ' #' || p.id || ': ' || p.title, 'code-task: repo=qnfo-workers path=' || p.path || char(10) || p.anchor_line, 'management-personas', 'feature', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM roadmap_proposals p LEFT JOIN roadmap_proposal_meta m ON m.proposal_id = p.id AND m.kind = 'strategic' WHERE p.status = 'proposed' AND (SELECT COUNT(*) FROM agent_issues i WHERE i.status = 'open' AND i.source = 'management-personas' AND i.title LIKE 'ROADMAP-1: ' || p.program_code || ' #%') < 3 AND NOT EXISTS (SELECT 1 FROM agent_issues i WHERE i.title LIKE 'ROADMAP-1: ' || p.program_code || ' #' || p.id || ':%') AND instr(COALESCE((SELECT value FROM ops_config WHERE key = 'code_merge_trusted_sources'), ''), 'management-personas|ROADMAP-1:') > 0 AND COALESCE((SELECT value FROM ops_config WHERE key = 'persona_actions'), 'on') <> 'off' AND COALESCE((SELECT value FROM ops_config WHERE key = 'roadmap_originate'), 'on') <> 'off'";
const steps = (name45 = "rm-file") => { const a = []; for (let i = 0; i < 45; i++) a.push({ type: "sql", name: "s" + i, sql: "SELECT " + i }); a.push({ type: "sql", name: name45, sql: RM_FILE }); a.push({ type: "sql", name: "after", sql: "SELECT 'x'" }); return a; };

const make = ({ name45 = "rm-file" } = {}) => {
  const d = new DatabaseSync(":memory:");
  d.exec(`
    CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER, updated_at TEXT);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE roadmap_proposals (id INTEGER PRIMARY KEY, program_code TEXT, title TEXT, path TEXT, anchor_line TEXT, status TEXT);
    CREATE TABLE roadmap_proposal_meta (proposal_id INTEGER, kind TEXT);
    CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO ops_config VALUES ('code_merge_trusted_sources', 'x,management-personas|ROADMAP-1:,y');
  `);
  d.prepare("INSERT INTO fleet_tasks VALUES ('management-personas', ?, 7, 'x')").run(JSON.stringify({ steps: steps(name45) }));
  return d;
};
const NOW = Math.floor(Date.now() / 1000) * 1000;
const issue = (d, title, status, ageDays = 0, source = "session:reader-yield") => d.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) VALUES (?, '', ?, 'feature', 'high', ?, ?, ?)").run(title, source, status, NOW - ageDays * 864e5, NOW - ageDays * 864e5);
const proposal = (d, id, code, title) => d.prepare("INSERT INTO roadmap_proposals VALUES (?, ?, ?, 'a/worker.js', 'anchor', 'proposed')").run(id, code, title);
const step45 = (d) => JSON.parse(d.prepare("SELECT definition FROM fleet_tasks").get().definition).steps[45].sql;
const run = (d) => { const before = d.prepare("SELECT COUNT(*) AS n FROM agent_issues").get().n; d.exec(step45(d)); return d.prepare("SELECT COUNT(*) AS n FROM agent_issues").get().n - before; };

const TWIN = "pageviews_30d flaps between 0, 10000, 25000 and the true 19.7k; derive it from the ledger";
{
  const d = make();
  d.exec(body);
  const s = step45(d);
  assert.equal((s.match(/ROADMAP-TWIN-GUARD-1/g) || []).length, 1, "the guard is added once");
  assert.equal(JSON.parse(d.prepare("SELECT definition FROM fleet_tasks").get().definition).steps.length, 47, "no step added or lost");
  assert.equal(d.prepare("SELECT version FROM fleet_tasks").get().version, 8);
  const snap = d.prepare("SELECT definition, version FROM fleet_tasks").get();
  d.exec(body);
  assert.deepEqual({ ...d.prepare("SELECT definition, version FROM fleet_tasks").get() }, { ...snap }, "replay is a no-op");
  d.exec(rollback);
  assert.equal(step45(d), RM_FILE, "the rollback removes exactly the guard");
}
{ // the live failure: a session filed the item first with its own item code
  const d = make(); d.exec(body);
  issue(d, "ROADMAP-1: QNFO.REACH READER-YIELD-1.2: " + TWIN, "open", 0.4);
  proposal(d, 2132, "QNFO.REACH", TWIN);
  assert.equal(run(d), 0, "an open session twin blocks the manager copy");
  const bare = make(); // the same facts without the guard: the manager copy is filed (this is the live failure)
  issue(bare, "ROADMAP-1: QNFO.REACH READER-YIELD-1.2: " + TWIN, "open", 0.4);
  proposal(bare, 2132, "QNFO.REACH", TWIN);
  assert.equal(run(bare), 1, "without the guard the twin is filed");
}
{ // closed twin: blocked for 3 days, free after
  const d = make(); d.exec(body);
  issue(d, "ROADMAP-1: QNFO.REACH READER-YIELD-1.3: " + TWIN, "closed", 1);
  proposal(d, 2133, "QNFO.REACH", TWIN);
  assert.equal(run(d), 0, "a twin closed a day ago blocks (it shipped or was folded)");
  const e = make(); e.exec(body);
  issue(e, "ROADMAP-1: QNFO.REACH READER-YIELD-1.3: " + TWIN, "closed", 5);
  proposal(e, 2133, "QNFO.REACH", TWIN);
  assert.equal(run(e), 1, "a twin closed five days ago does not");
}
{ // unrelated, different program, and the old guards
  const d = make(); d.exec(body);
  issue(d, "ROADMAP-1: QNFO.REACH READER-YIELD-1.2: " + TWIN, "open", 0.4);
  proposal(d, 1, "QNFO.OPS", "Cache-aside /api/managers so the dashboard-load journey stops paying 2.4 s");
  proposal(d, 2, "QNFO.REACH", "Group stretch matches so the real matches get decided first on the Today card");
  assert.equal(run(d), 2, "unrelated proposals are filed");
  assert.equal(run(d), 0, "the id dedupe still holds (already filed)");
  const e = make(); e.exec(body);
  for (let i = 0; i < 3; i++) issue(e, "ROADMAP-1: QNFO.OPS #" + (900 + i) + ": something " + i, "open", 0.2, "management-personas");
  proposal(e, 5, "QNFO.OPS", "a fourth manager item in the same program should wait for the cap");
  assert.equal(run(e), 0, "the 3-open cap per program still holds");
  const f = make(); f.exec(body);
  f.exec("UPDATE ops_config SET value = 'off' WHERE 1=0; INSERT INTO ops_config VALUES ('roadmap_originate', 'off')");
  proposal(f, 6, "QNFO.OPS", "a fifth manager item while the switch is off is never filed");
  assert.equal(run(f), 0, "roadmap_originate off still stops it");
  const g = make(); g.exec(body);
  proposal(g, 7, "QNFO.OPS", "short");
  assert.equal(run(g), 1, "a title under 20 characters is not matched against others (and is filed)");
}
{ // not rm-file at index 45: untouched
  const d = make({ name45: "other-step" });
  const before = d.prepare("SELECT definition FROM fleet_tasks").get().definition;
  d.exec(body);
  assert.equal(d.prepare("SELECT definition FROM fleet_tasks").get().definition, before, "a definition whose step 45 is not rm-file is not touched");
}
console.log("roadmap-filer-twin-guard.test: all assertions passed");
