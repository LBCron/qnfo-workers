// C4-FM5-DETECTOR-DEDUPE-1 offline suite for migrations/2026-11-05-c4-fm5-detector-dedupe.sql (roadmap_implementation 1758 FM-5, slice 1 of the issue-less dedupe).
// Replays the trigger on node:sqlite next to the live ones it must coexist with (VERIFICATION-DEDUPE-1 from migrations/2026-11-04-verification-dedupe.sql, the evidence guard and the transport guard
// as read live 2026-11-05) and proves: an identical passing repeat of an issue-less fm- or belief- class by the same writer on the same UTC day is touched, not stored; a changed answer, a failing
// row, a flip, a first row, the first probe of a new UTC day, a row from another writer (probe_url), another transport and a row older than the latest are stored; runtime transports, other classes,
// lower-case and wildcard-lookalike class names and issue-linked rows are left to their own rules; only the LATEST row of a class is touched; the guards still abort what they aborted; the kill
// switch restores every insert; a second apply changes nothing. The cases come from a second reader's review of the first version (verifier-filtered reader, transport bypass, restore with an old
// timestamp, cohort windows). State-independent: no live read. Run: node --no-warnings migrations/c4-fm5-detector-dedupe.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const here = new URL("./", import.meta.url);
const sql = readFileSync(new URL("2026-11-05-c4-fm5-detector-dedupe.sql", here), "utf8").replace(/\r\n/g, "\n");
const old = readFileSync(new URL("2026-11-04-verification-dedupe.sql", here), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration headers present");
ok(sql.indexOf("-- APPLY-BY: ci") < 1000, "the APPLY-BY header sits in the first 1000 bytes (the consumer's migration sweep reads the first 4000 characters only)");
ok(!/\bDELETE\b|\bDROP\b/i.test(sql.replace(/^--.*$/gm, "")), "no DELETE or DROP in the body (a trigger and registry rows only)");

const mk = (liveDefault = false) => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE transport_trust (transport TEXT PRIMARY KEY, trusted INTEGER);
INSERT INTO transport_trust VALUES ('d1-query', 1), ('code-read', 1), ('runner-https', 1), ('external-https', 1), ('d1-query@q08-signal', 1);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, probe_url TEXT, transport TEXT,
  expected TEXT, observed TEXT, pass INTEGER, verified_at TEXT DEFAULT (${liveDefault ? "datetime('now')" : "strftime('%Y-%m-%dT%H:%M:%fZ','now')"}), verifier TEXT, action_ref TEXT);
CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT, kind TEXT, guards_against TEXT, critical_path INTEGER, disposition TEXT, disposition_state TEXT, alternate_path TEXT, evidence TEXT);
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT NOT NULL, window_note TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, status TEXT, evidence TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER remediation_verification_evidence_guard_ins BEFORE INSERT ON remediation_verifications WHEN NEW.pass=1 AND (NEW.expected IS NULL OR trim(NEW.expected)='' OR NEW.observed IS NULL OR trim(NEW.observed)='') BEGIN SELECT RAISE(ABORT,'VACUOUS-VERIFICATION-EVIDENCE-1: pass=1 requires non-empty expected AND observed (issue 1458)'); END;
CREATE TRIGGER remediation_verification_transport_guard_ins BEFORE INSERT ON remediation_verifications WHEN NEW.pass=1 AND NOT EXISTS (SELECT 1 FROM transport_trust t WHERE t.transport=NEW.transport AND t.trusted=1) BEGIN SELECT RAISE(ABORT,'unclassified-or-untrusted-verification-transport'); END;
`);
  // VERIFICATION-DEDUPE-1, the trigger only (the registry rows after it need tables this suite builds differently)
  db.exec(old.split("INSERT OR IGNORE INTO control_registry")[0].split("\n").filter(l => !l.startsWith("--")).join("\n"));
  db.exec("INSERT INTO agent_issues (id, title, description, status) VALUES (1001920, 'ROADMAP-1: QNFO.OPS #fm5-issueless-dedupe: x', 'text', 'open'), (5, 'x', 'y', 'open'), (6, 'x', 'y', 'closed')");
  db.exec("INSERT INTO roadmap_implementation VALUES (1758, 'FM-5', 'verified', 'FM-5 live: 18960 rows.')");
  return db;
};
const D1 = "2026-11-05", D2 = "2026-11-06";
const ins = (db, issue, cls, pass, observed, o = {}) =>
  db.prepare("INSERT INTO remediation_verifications (issue_id, class, transport, probe_url, expected, observed, pass, verifier, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(issue, cls, o.transport ?? "d1-query", o.url ?? "d1:remediation_contracts/" + cls, o.expected ?? "0", observed, pass, o.verifier ?? "consumer", o.at ?? D1 + " 00:00:00");
const rows = (db, cls) => db.prepare("SELECT id, pass, observed, verified_at, verifier, probe_url, transport FROM remediation_verifications WHERE class = ? ORDER BY id").all(cls);

{ // A: an identical passing repeat of an fm- detector is touched
  const db = mk(); db.exec(sql);
  ins(db, null, "fm-x", 1, "0", { verifier: "v1", at: D1 + " 00:00:00" }); ins(db, null, "fm-x", 1, "0", { verifier: "v2", at: D1 + " 00:22:00" }); ins(db, null, "fm-x", 1, "0", { verifier: "v3", at: D1 + " 00:44:00" });
  const r = rows(db, "fm-x");
  ok(r.length === 1 && r[0].verified_at === D1 + " 00:44:00" && r[0].verifier === "v3", "A: two identical passes are touched, one row keeps the newest verified_at and verifier", r);
}
{ // B: a changed observed value, a failing row and the pass after it are all stored
  const db = mk(); db.exec(sql);
  ins(db, null, "fm-x", 1, "0"); ins(db, null, "fm-x", 1, "1"); ins(db, null, "fm-x", 0, "3"); ins(db, null, "fm-x", 1, "0");
  ok(rows(db, "fm-x").length === 4, "B: a changed answer, a failure and the pass after it are stored", rows(db, "fm-x"));
  ins(db, null, "fm-w", 0, "0"); ins(db, null, "fm-w", 1, "0");
  ok(rows(db, "fm-w").length === 2, "B2: a pass is never taken for a repeat of a failing row, even with the same expected and observed text", rows(db, "fm-w"));
}
{ // C: a failing detector keeps every failing row (the counters count them)
  const db = mk(); db.exec(sql);
  ins(db, null, "fm-x", 0, "3"); ins(db, null, "fm-x", 0, "3"); ins(db, null, "fm-x", 0, "3");
  ok(rows(db, "fm-x").length === 3, "C: failing repeats are all stored", rows(db, "fm-x"));
}
{ // D: belief- passes are deduped, belief- failures are kept
  const db = mk(); db.exec(sql);
  ins(db, null, "belief-b", 1, "held"); ins(db, null, "belief-b", 1, "held"); ins(db, null, "belief-b", 0, "x"); ins(db, null, "belief-b", 0, "x");
  ok(rows(db, "belief-b").length === 3, "D: belief- pass repeat touched, failing repeats kept", rows(db, "belief-b"));
}
{ // E: runtime transports keep every row (the runtime share is their rows)
  const db = mk(); db.exec(sql);
  ins(db, null, "fm-x", 1, "0", { transport: "runner-https" }); ins(db, null, "fm-x", 1, "0", { transport: "runner-https" });
  ins(db, null, "fm-y", 1, "0", { transport: "external-https" }); ins(db, null, "fm-y", 1, "0", { transport: "external-https" });
  ok(rows(db, "fm-x").length === 2 && rows(db, "fm-y").length === 2, "E: runner-https and external-https repeats are stored");
}
{ // F: other classes, class-name lookalikes and issue-linked rows are not this trigger's
  const db = mk(); db.exec(sql);
  ins(db, null, "goal-A", 1, "0"); ins(db, null, "goal-A", 1, "0"); ins(db, null, "rt-live-x", 1, "0"); ins(db, null, "rt-live-x", 1, "0");
  ok(rows(db, "goal-A").length === 2 && rows(db, "rt-live-x").length === 2, "F1: goal- and rt- classes keep every row");
  for (const c of ["fmx-a", "fm_x", "FM-x", "Fm-x", "BELIEF-q", "xfm-x"]) { ins(db, null, c, 1, "0"); ins(db, null, c, 1, "0"); }
  ok(["fmx-a", "fm_x", "FM-x", "Fm-x", "BELIEF-q", "xfm-x"].every(c => rows(db, c).length === 2), "F2: fmx-, fm_x, FM-x, Fm-x, BELIEF-q and xfm-x are not standing detectors (GLOB is case-sensitive and has no wildcard lookalike)");
  ins(db, 5, "fm-issue", 1, "0"); ins(db, 5, "fm-issue", 1, "0");
  ok(rows(db, "fm-issue").length === 2, "F3: a pass on an OPEN issue keeps every row (VERIFICATION-DEDUPE-1 rule, not touched by this trigger)");
  ins(db, 6, "fm-closed", 1, "0"); ins(db, 6, "fm-closed", 1, "0");
  ok(rows(db, "fm-closed").length === 1, "F4: a repeat pass on a CLOSED issue is still touched by VERIFICATION-DEDUPE-1 (coexistence)");
  // a mixed sequence: an issue-linked row then an issue-less repeat of it, and the reverse
  ins(db, 5, "fm-mix", 1, "0"); ins(db, null, "fm-mix", 1, "0"); ins(db, null, "fm-mix2", 1, "0"); ins(db, 5, "fm-mix2", 1, "0");
  ok(rows(db, "fm-mix").length === 2 && rows(db, "fm-mix2").length === 2, "F5: an issue-less row never touches an issue-linked row, nor the reverse");
}
{ // G: classes are independent; a changed expected is stored
  const db = mk(); db.exec(sql);
  ins(db, null, "fm-a", 1, "0"); ins(db, null, "fm-b", 1, "0"); ins(db, null, "fm-a", 1, "0", { expected: "1" });
  ok(rows(db, "fm-a").length === 2 && rows(db, "fm-b").length === 1, "G: classes are independent and a changed expected is stored");
}
{ // H: the kill switch restores every insert
  const db = mk(); db.exec(sql); db.exec("INSERT INTO ops_config VALUES ('verification_dedupe', 'off')");
  ins(db, null, "fm-x", 1, "0"); ins(db, null, "fm-x", 1, "0"); ins(db, null, "fm-x", 1, "0");
  ok(rows(db, "fm-x").length === 3, "H: verification_dedupe = off stores every row");
  db.exec("UPDATE ops_config SET value = 'on'"); ins(db, null, "fm-x", 1, "0");
  ok(rows(db, "fm-x").length === 3, "H2: and 'on' dedupes again");
}
{ // I: the guards still refuse what they refused, also with a trusted row of the class already stored
  const db = mk(); db.exec(sql);
  let e1 = null, e2 = null, e3 = null;
  try { ins(db, null, "fm-x", 1, ""); } catch (e) { e1 = String(e.message); }
  try { ins(db, null, "fm-x", 1, "0", { transport: "carrier-pigeon" }); } catch (e) { e2 = String(e.message); }
  ins(db, null, "fm-t", 1, "0");
  try { ins(db, null, "fm-t", 1, "0", { transport: "carrier-pigeon", url: "d1:remediation_contracts/fm-t" }); } catch (e) { e3 = String(e.message); }
  ok(/VACUOUS-VERIFICATION-EVIDENCE-1/.test(e1 || "") && /untrusted-verification-transport/.test(e2 || ""), "I1: the evidence and transport guards abort a first row", [e1, e2]);
  ok(/untrusted-verification-transport/.test(e3 || "") && rows(db, "fm-t").length === 1 && rows(db, "fm-t")[0].transport === "d1-query", "I2: an untrusted transport that repeats a trusted row is still aborted, not ignored, and the trusted row is not touched", [e3, rows(db, "fm-t")]);
}
{ // J: only the LATEST row of a class is touched, the touch keeps the id and does not trip the UPDATE guards
  const db = mk(); db.exec(sql);
  ins(db, null, "fm-x", 1, "0", { at: D1 + " 01:00:00" }); ins(db, null, "fm-x", 0, "3", { at: D1 + " 02:00:00" }); ins(db, null, "fm-x", 1, "0", { at: D1 + " 03:00:00" });
  db.exec("CREATE TRIGGER remediation_verification_evidence_guard_upd BEFORE UPDATE OF pass,expected,observed ON remediation_verifications WHEN NEW.pass=1 AND (NEW.expected IS NULL OR trim(NEW.expected)='' OR NEW.observed IS NULL OR trim(NEW.observed)='') BEGIN SELECT RAISE(ABORT,'x'); END");
  db.exec("CREATE TRIGGER remediation_verification_transport_guard_upd BEFORE UPDATE OF pass, transport ON remediation_verifications WHEN NEW.pass=1 AND NOT EXISTS (SELECT 1 FROM transport_trust t WHERE t.transport=NEW.transport AND t.trusted=1) BEGIN SELECT RAISE(ABORT,'y'); END");
  const before = rows(db, "fm-x");
  ins(db, null, "fm-x", 1, "0", { verifier: "v9", at: D1 + " 05:00:00" });
  const after = rows(db, "fm-x");
  ok(after.length === 3 && after[2].id === before[2].id && after[2].verified_at === D1 + " 05:00:00" && after[2].verifier === "v9" && after[0].verified_at === D1 + " 01:00:00" && after[1].verified_at === D1 + " 02:00:00", "J: only the latest row is touched (id kept); the older pass and the failure keep their times", after);
}
{ // K: 24 hourly probes leave one row per UTC day (the daily checkpoint); the freshness readers see the last probe
  const db = mk(); db.exec(sql);
  for (let i = 0; i < 24; i++) ins(db, null, "fm-x", 1, "0", { at: D1 + " " + String(i).padStart(2, "0") + ":00:00" });
  for (let i = 0; i < 24; i++) ins(db, null, "fm-x", 1, "0", { at: D2 + " " + String(i).padStart(2, "0") + ":30:00" });
  const r = rows(db, "fm-x");
  const last = db.prepare("SELECT MAX(verified_at) m, (SELECT pass FROM remediation_verifications WHERE class = 'fm-x' ORDER BY id DESC LIMIT 1) p FROM remediation_verifications WHERE class = 'fm-x'").get();
  ok(r.length === 2 && r[0].verified_at === D1 + " 23:00:00" && r[1].verified_at === D2 + " 23:30:00" && last.m === D2 + " 23:30:00" && last.p === 1, "K: two days of hourly probes leave two rows (one per UTC day), each with its last verified_at", r);
  // ISO timestamps with T and Z (the default format of some writers) fall on the same day
  ins(db, null, "fm-y", 1, "0", { at: "2026-11-05T00:10:00.000Z" }); ins(db, null, "fm-y", 1, "0", { at: "2026-11-05T09:10:00.000Z" }); ins(db, null, "fm-y", 1, "0", { at: "2026-11-06T00:10:00.000Z" });
  ok(rows(db, "fm-y").length === 2, "K2: ISO timestamps follow the same day rule", rows(db, "fm-y"));
}
{ // L: another writer's row is never refreshed, and does not refresh another writer's row (verifier-filtered readers keep their rows)
  const db = mk(); db.exec(sql);
  ins(db, null, "fm-trigger-depth-compile", 1, "ok", { expected: "ok", verifier: "trigger-depth-sweep", url: "trigger-depth-sweep", at: D1 + " 01:00:00" });
  ins(db, null, "fm-trigger-depth-compile", 1, "ok", { expected: "ok", verifier: "remediation-consumer@abc", at: D1 + " 01:22:00" });
  ins(db, null, "fm-trigger-depth-compile", 1, "ok", { expected: "ok", verifier: "remediation-consumer@abc", at: D1 + " 01:44:00" });
  ins(db, null, "fm-trigger-depth-compile", 1, "ok", { expected: "ok", verifier: "trigger-depth-sweep", url: "trigger-depth-sweep", at: D1 + " 02:00:00" });
  const r = rows(db, "fm-trigger-depth-compile");
  const sweep = db.prepare("SELECT COUNT(*) n, MAX(verified_at) m FROM remediation_verifications WHERE class = 'fm-trigger-depth-compile' AND verifier = 'trigger-depth-sweep'").get();
  ok(r.length === 3 && sweep.n === 2 && sweep.m === D1 + " 02:00:00" && r[1].verified_at === D1 + " 01:44:00", "L: the sweep's rows keep their verifier and time; the consumer's repeats touch only the consumer's row", r);
}
{ // M: another transport never refreshes a row, a row older than the latest is stored (restore or backfill)
  const db = mk(); db.exec(sql);
  ins(db, null, "fm-x", 1, "0", { transport: "d1-query", at: D1 + " 10:00:00" }); ins(db, null, "fm-x", 1, "0", { transport: "code-read", at: D1 + " 10:22:00" });
  ok(rows(db, "fm-x").length === 2, "M1: the same answer on another transport is stored, not a touch of the first transport's row", rows(db, "fm-x"));
  ins(db, null, "fm-r", 1, "0", { at: D1 + " 10:00:00" }); ins(db, null, "fm-r", 1, "0", { at: D1 + " 08:00:00", verifier: "archived" });
  const r = rows(db, "fm-r");
  ok(r.length === 2 && r[0].verified_at === D1 + " 10:00:00" && r[0].verifier === "consumer", "M2: a restored row with an older timestamp is stored; the latest row does not move back", r);
}
{ // N: the live column default (datetime('now')) is populated inside the BEFORE trigger; the touch carries it
  const db = mk(true); db.exec(sql);
  db.exec("INSERT INTO remediation_verifications (issue_id, class, transport, probe_url, expected, observed, pass, verifier, verified_at) VALUES (NULL, 'fm-d', 'd1-query', 'u', '0', '0', 1, 'a', datetime('now'))");
  db.exec("INSERT INTO remediation_verifications (issue_id, class, transport, probe_url, expected, observed, pass, verifier) VALUES (NULL, 'fm-d', 'd1-query', 'u', '0', '0', 1, 'b')");
  const r = rows(db, "fm-d");
  ok(r.length === 1 && r[0].verifier === "b" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(r[0].verified_at), "N: an insert that omits verified_at (live default) is touched with the default value", r);
}
{ // O: the registry rows, the issue note and the row evidence, once
  const db = mk(); db.exec(sql);
  const snap = d => JSON.stringify([d.prepare("SELECT COUNT(*) n FROM control_registry").get(), d.prepare("SELECT COUNT(*) n FROM control_alternate_probes").get(), d.prepare("SELECT COUNT(*) n FROM decision_log").get(), d.prepare("SELECT description FROM agent_issues WHERE id = 1001920").get(), d.prepare("SELECT evidence FROM roadmap_implementation").get(), d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'remediation_verification_dedupe_detector_ins'").get()]);
  const before = snap(db); db.exec(sql);
  ok(snap(db) === before, "O1: a second apply changes nothing");
  ok(/C4-FM5-DETECTOR-DEDUPE-1/.test(db.prepare("SELECT description d FROM agent_issues WHERE id = 1001920").get().d) && /goal-\* classes/.test(db.prepare("SELECT description d FROM agent_issues WHERE id = 1001920").get().d), "O2: the issue says what is left");
  ok(db.prepare("SELECT evidence e FROM roadmap_implementation").get().e.startsWith("FM-5 live: 18960 rows.") && db.prepare("SELECT status s FROM roadmap_implementation").get().s === "verified", "O3: row 1758 keeps its status and gets the slice appended");
  const probe = db.prepare("SELECT probe_sql p FROM control_alternate_probes WHERE control = 'verification-dedupe-detectors'").get().p;
  ok(String(db.prepare(probe).get().observed) === "ok", "O4: the alternate probe reads ok with no kill switch row");
  db.exec("INSERT INTO ops_config VALUES ('verification_dedupe', 'maybe')");
  ok(String(db.prepare(probe).get().observed) !== "ok", "O5: and flags a value the triggers do not read");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
