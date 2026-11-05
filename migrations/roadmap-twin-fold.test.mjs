// ROADMAP-TWIN-FOLD-1 offline suite for migrations/2026-11-05-roadmap-twin-fold.sql (real SQLite with the close guards of qnfo-audit).
// Proves: three twins are superseded by their open twin and the fourth is moot against a closed twin; a twin whose wording differs, or whose twin is not in the state the file read, stays open;
// the evidence names the successor; the close channel is named before the triage sync can default it; replay changes nothing; the rollback reopens.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migration = readFileSync(fileURLToPath(new URL("./2026-11-05-roadmap-twin-fold.sql", import.meta.url)), "utf8");
const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
assert.ok(rollback);
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
const body = migration.replace(/^--.*$/gm, "");

const make = ({ twin2Status = "open", twin3Status = "closed", reword1798 = false } = {}) => {
  const d = new DatabaseSync(":memory:");
  d.exec(`
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, title TEXT, close_channel TEXT, updated_at INTEGER);
    CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, triage_state TEXT, owner TEXT, triaged_at TEXT, close_evidence TEXT);
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, last_verdict TEXT, last_attempt_at TEXT, next_due_at TEXT);
    CREATE TRIGGER issue_close_evidence_required BEFORE UPDATE OF status ON agent_issues
    WHEN NEW.status IN ('closed', 'resolved', 'wontfix') AND OLD.status NOT IN ('closed', 'resolved', 'wontfix')
    BEGIN SELECT RAISE(ABORT, 'close-without-evidence') WHERE NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND COALESCE(t.close_evidence, '') <> ''); END;
    CREATE TRIGGER triage_close_sync_issue_upd AFTER UPDATE OF triage_state ON issue_triage
    WHEN NEW.triage_state IN ('closed', 'closed-refuted', 'wontfix')
    BEGIN UPDATE agent_issues SET status = 'closed', close_channel = COALESCE(close_channel, 'auto:triage-sync:' || NEW.owner), updated_at = 1 WHERE id = NEW.issue_id AND status = 'open'; END;
  `);
  const add = (id, status, title, channel = null) => { d.prepare("INSERT INTO agent_issues VALUES (?, ?, ?, ?, 1)").run(id, status, title, channel); d.prepare("INSERT INTO issue_triage VALUES (?, 'triaged', 'qnfo-fleet-control', NULL, NULL)").run(id); };
  add(1001719, "open", "ROADMAP-1: QNFO.REACH READER-YIELD-1.1: classify automated fetchers as bots in the UTM ledger so outreach clicks mean readers");
  add(1001720, "open", "ROADMAP-1: QNFO.REACH READER-YIELD-1.2: pageviews_30d flaps between 0, 10000, 25000 and the true 19.7k; derive it from the ledger");
  add(1001721, twin3Status, "ROADMAP-1: QNFO.REACH READER-YIELD-1.3: give the papers an outsider reached a second post, from v_paper_readers_top", twin3Status === "closed" ? "auto:verified-remediation-trigger" : null);
  add(1001722, twin2Status, "ROADMAP-1: QNFO.REACH READER-YIELD-1.4: GA4 ingest by campaign and country, so engaged sessions are attributable to posts");
  add(1001797, "open", "ROADMAP-1: QNFO.REACH #2131: Classify automated fetchers as bots in the UTM ledger so outreach clicks mean readers");
  add(1001798, "open", reword1798 ? "ROADMAP-1: QNFO.REACH #2132: something else entirely about pageviews" : "ROADMAP-1: QNFO.REACH #2132: pageviews_30d flaps between 0, 10000, 25000 and the true 19.7k; derive it from the ledger");
  add(1001799, "open", "ROADMAP-1: QNFO.REACH #2133: Give the papers an outsider reached a second post, from v_paper_readers_top");
  add(1001800, "open", "ROADMAP-1: QNFO.REACH #2134: GA4 ingest by campaign and country, so engaged sessions are attributable to posts");
  for (const id of [1001797, 1001798, 1001799, 1001800]) d.prepare("INSERT INTO remediation_contracts (class, issue_id, status, last_verdict) VALUES (?, ?, 'superseded', 'superseded:closure-observing-probe-at-birth')").run("issue-" + id, id);
  return d;
};
const st = (d, id) => d.prepare("SELECT status, close_channel FROM agent_issues WHERE id = ?").get(id);
const ev = (d, id) => d.prepare("SELECT close_evidence FROM issue_triage WHERE issue_id = ?").get(id).close_evidence;

{
  const d = make();
  d.exec(body);
  for (const id of [1001797, 1001798, 1001799, 1001800]) { assert.equal(st(d, id).status, "closed", id + " closed"); assert.equal(st(d, id).close_channel, "session:breach-remediation"); }
  assert.match(ev(d, 1001797), /^SUPERSEDED BY #1001719:/);
  assert.match(ev(d, 1001798), /^SUPERSEDED BY #1001720:/);
  assert.match(ev(d, 1001800), /^SUPERSEDED BY #1001722:/);
  assert.match(ev(d, 1001799), /^MOOT: the same roadmap item is issue 1001721/);
  for (const id of [1001719, 1001720, 1001721, 1001722]) assert.equal(st(d, id).status, id === 1001721 ? "closed" : "open", "the twin " + id + " is untouched");
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM bak_20261105_roadmap_twins").get().n, 4);
  const snap = JSON.stringify([d.prepare("SELECT * FROM agent_issues ORDER BY id").all(), d.prepare("SELECT * FROM issue_triage ORDER BY issue_id").all()]);
  d.exec(body);
  assert.equal(JSON.stringify([d.prepare("SELECT * FROM agent_issues ORDER BY id").all(), d.prepare("SELECT * FROM issue_triage ORDER BY issue_id").all()]), snap, "replay changes nothing");
  d.exec(rollback);
  for (const id of [1001797, 1001798, 1001799, 1001800]) { assert.equal(st(d, id).status, "open", "rollback reopens " + id); assert.equal(d.prepare("SELECT triage_state FROM issue_triage WHERE issue_id = ?").get(id).triage_state, "triaged"); }
}
{
  const d = make({ reword1798: true });
  d.exec(body);
  assert.equal(st(d, 1001798).status, "open", "a twin with different wording stays open");
  assert.equal(st(d, 1001797).status, "closed");
}
{
  const d = make({ twin2Status: "closed" }); // the successor of 1001800 is no longer open: a supersede needs an open successor
  d.exec(body);
  assert.equal(st(d, 1001800).status, "open", "no open successor, no supersede");
}
{
  const d = make({ twin3Status: "open" }); // 1001721 reopened: the moot close needs the twin closed
  d.exec(body);
  assert.equal(st(d, 1001799).status, "open", "a moot close needs the twin closed");
}
console.log("roadmap-twin-fold.test: all assertions passed");
