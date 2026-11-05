// W2-F-C offline suite: replays migrations/2026-11-05-w2f-c-owner-docs-audit-copies.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, BACKUP table, one Rollback line); the three stale copies are deleted only when key, length and updated_at match what was verified
// against qnfo-identity (a newer write to the same key is left for the dashboard sync); the backup table holds metadata and no body; other keys are untouched; a replay changes nothing;
// the failure mode and its contract read 0 on an empty table and 1 once a row exists; the file never prints a body. It does not read live state. Output MUST contain "0 failed" on success.
//   node migrations/w2f-c-owner-docs-audit-copies.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-w2f-c-owner-docs-audit-copies.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(header.some((l) => /^-- BACKUP: bak_20261105_owner_docs_audit_meta\s*$/.test(l)), "the BACKUP header names the metadata table");
ok(header.some((l) => /^-- CAUSE-MAPPED: /.test(l)), "registers no metric and says so");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link");
ok(Array.from(sql.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");
const dels = sql.split("\n").filter((l) => /^DELETE FROM /.test(l));
ok(dels.length === 3 && dels.every((l) => /^DELETE FROM owner_docs WHERE key = '[a-z0-9-]+' AND length\(body_md\) = \d+ AND updated_at = '[0-9: -]+';$/.test(l)), "three deletes, each guarded by key, length and updated_at", dels);

function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE owner_docs (key TEXT PRIMARY KEY, title TEXT, body_md TEXT, source TEXT, visibility TEXT, updated_at TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h INTEGER, status TEXT, precondition TEXT, action TEXT, escalate_to TEXT, module TEXT, next_due_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);`);
  const ins = w.prepare("INSERT INTO owner_docs (key, title, body_md, source, visibility, updated_at) VALUES (?, ?, ?, 's', 'private', ?)");
  ins.run("email-voice-v1", "Email voice", "x".repeat(3180), "2026-10-12 08:44:36");
  ins.run("fleet-backlog-plan-2026-10-12", "Plan", "y".repeat(2414), "2026-10-12 08:52:40");
  ins.run("patch-goal-room-1", "Patch", "z".repeat(4727), "2026-10-12 09:02:08");
  return w;
}
const snap = (w) => JSON.stringify([w.prepare("SELECT key, updated_at FROM owner_docs").all(), w.prepare("SELECT key, body_len FROM bak_20261105_owner_docs_audit_meta").all(), w.prepare("SELECT class FROM remediation_contracts").all(), w.prepare("SELECT action FROM decision_log").all()]);

{
  const w = world();
  w.prepare("INSERT INTO owner_docs (key, title, body_md, source, visibility, updated_at) VALUES ('other-doc', 'o', 'keep me', 's', 'private', '2026-10-30 00:00:00')").run();
  w.exec(sql);
  ok(JSON.stringify(w.prepare("SELECT key FROM owner_docs").all()) === JSON.stringify([{ key: "other-doc" }]), "the three stale copies are gone, another key is untouched");
  const cols = w.prepare("PRAGMA table_info(bak_20261105_owner_docs_audit_meta)").all().map((x) => x.name);
  ok(!cols.includes("body_md") && cols.includes("body_len") && cols.includes("key") && cols.includes("updated_at"), "the backup table holds metadata and no body", cols);
  ok(w.prepare("SELECT COUNT(*) n FROM bak_20261105_owner_docs_audit_meta").get().n === 3, "the backup table holds the three rows");
  ok(w.prepare("SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'owner-docs-audit-copy'").get().n === 1 && w.prepare("SELECT COUNT(*) n FROM decision_log WHERE actor = 'session:w2f-c'").get().n === 1, "failure mode and decision_log row written once");
  const s1 = snap(w);
  w.exec(sql);
  ok(snap(w) === s1, "a replay changes nothing");
  const probe = () => ({ ...w.prepare(w.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-owner-docs-audit-copy'").get().p).get() });
  ok(JSON.stringify(probe()) === JSON.stringify({ expected: "0", observed: "1" }), "the contract reads the table size (1 row: the unrelated test row)", probe());
  w.prepare("DELETE FROM owner_docs").run();
  ok(JSON.stringify(probe()) === JSON.stringify({ expected: "0", observed: "0" }), "an empty table is healthy", probe());
}
{
  // a newer write to the same key after the check is not deleted: the sync owns it
  const w = world();
  w.prepare("UPDATE owner_docs SET body_md = 'newer text', updated_at = '2026-11-05 03:00:00' WHERE key = 'email-voice-v1'").run();
  w.exec(sql);
  const left = w.prepare("SELECT key FROM owner_docs").all();
  ok(JSON.stringify(left) === JSON.stringify([{ key: "email-voice-v1" }]), "a changed row survives the guarded delete", left);
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
