// VERIFICATION-DEDUPE-1 offline suite: the trigger in migrations/2026-11-04-verification-dedupe.sql against node:sqlite.
// Run: node --no-warnings migrations/verification-dedupe.test.mjs   (exit 0 = all passed)
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(here, "2026-11-04-verification-dedupe.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x) : "")); } };
function fresh() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, probe_url TEXT, transport TEXT,
      expected TEXT, observed TEXT, pass INTEGER, verified_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), verifier TEXT, action_ref TEXT);`);
  db.exec(sql.split("INSERT OR IGNORE INTO control_registry")[0].split("\n").filter((l) => !l.startsWith("--")).join("\n")); // the trigger only: the registry rows need tables this suite does not build
  return db;
}
const ins = (db, issue, cls, pass, observed, verifier = "v1", at = null) =>
  db.prepare("INSERT INTO remediation_verifications (issue_id, class, transport, expected, observed, pass, verifier, verified_at) VALUES (?, ?, 't', 'e', ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ','now')))").run(issue, cls, observed, pass, verifier, at);
const count = (db) => db.prepare("SELECT COUNT(*) n FROM remediation_verifications").get().n;
{ // A: repeated failing row on an open issue is touched, not stored
  const db = fresh(); db.exec("INSERT INTO agent_issues VALUES (1,'open')");
  ins(db, 1, "c", 0, "x", "v1", "2026-01-01T00:00:00.000Z"); ins(db, 1, "c", 0, "x", "v2", "2026-01-02T00:00:00.000Z");
  const r = db.prepare("SELECT * FROM remediation_verifications").all();
  ok(r.length === 1 && r[0].verified_at === "2026-01-02T00:00:00.000Z" && r[0].verifier === "v2", "A1 open issue: repeat failure touched, one row", r);
}
{ // B: a changed observed value is stored
  const db = fresh(); db.exec("INSERT INTO agent_issues VALUES (1,'open')");
  ins(db, 1, "c", 0, "x"); ins(db, 1, "c", 0, "y");
  ok(count(db) === 2, "B1 changed observed is stored");
}
{ // C: a closed issue keeps every failing row (relapse counting)
  const db = fresh(); db.exec("INSERT INTO agent_issues VALUES (1,'closed')");
  ins(db, 1, "c", 0, "x"); ins(db, 1, "c", 0, "x"); ins(db, 1, "c", 0, "x");
  ok(count(db) === 3, "C1 closed issue: every failing row kept", count(db));
}
{ // D: an open issue keeps every passing row (a later pass may close it)
  const db = fresh(); db.exec("INSERT INTO agent_issues VALUES (1,'open')");
  ins(db, 1, "c", 1, "ok"); ins(db, 1, "c", 1, "ok");
  ok(count(db) === 2, "D1 open issue: every passing row kept", count(db));
}
{ // E: a repeated pass on a closed issue is touched
  const db = fresh(); db.exec("INSERT INTO agent_issues VALUES (1,'closed')");
  ins(db, 1, "c", 1, "ok"); ins(db, 1, "c", 1, "ok");
  ok(count(db) === 1, "E1 closed issue: repeat pass touched", count(db));
}
{ // F: a flip of pass is stored, then a repeat of the new state is touched
  const db = fresh(); db.exec("INSERT INTO agent_issues VALUES (1,'open')");
  ins(db, 1, "c", 0, "x"); ins(db, 1, "c", 1, "ok"); ins(db, 1, "c", 0, "x"); ins(db, 1, "c", 0, "x");
  ok(count(db) === 3, "F1 flips stored, repeat touched", count(db));
}
{ // G: other classes are independent
  const db = fresh(); db.exec("INSERT INTO agent_issues VALUES (1,'open')");
  ins(db, 1, "c1", 0, "x"); ins(db, 1, "c2", 0, "x");
  ok(count(db) === 2, "G1 classes are independent", count(db));
}
{ // H: the kill switch restores every insert
  const db = fresh(); db.exec("INSERT INTO agent_issues VALUES (1,'open'); INSERT INTO ops_config VALUES ('verification_dedupe','off')");
  ins(db, 1, "c", 0, "x"); ins(db, 1, "c", 0, "x");
  ok(count(db) === 2, "H1 ops_config verification_dedupe=off stores everything", count(db));
}
console.log("verification-dedupe: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
