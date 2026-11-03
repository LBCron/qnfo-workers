import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-03-jobsearch-retired-feeds.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, verify_probe TEXT);
  CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, detector TEXT, trigger_condition TEXT);
  CREATE TABLE jobsearch_feeds (feed TEXT PRIMARY KEY, consecutive_fail INTEGER);
  INSERT INTO remediation_contracts VALUES ('fm-jobsearch-feed-down', 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM jobsearch_feeds WHERE consecutive_fail >= 3) AS TEXT) AS observed');
  INSERT INTO failure_modes VALUES ('jobsearch-feed-down', 'old detector', 'old condition');
  INSERT INTO jobsearch_feeds VALUES ('greenhouse:cwi', 126);
  INSERT INTO jobsearch_feeds VALUES ('greenhouse:deepmind', 126);
  INSERT INTO jobsearch_feeds VALUES ('greenhouse:tno', 126);
  INSERT INTO jobsearch_feeds VALUES ('greenhouse:anthropic', 3);`);

db.exec(migration);
const probe = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class='fm-jobsearch-feed-down'").get().verify_probe;
const result = db.prepare(probe).get();
assert.equal(result.expected, "0");
assert.equal(result.observed, "1");
assert.match(db.prepare("SELECT detector FROM failure_modes WHERE fm_key='jobsearch-feed-down'").get().detector, /retired feeds remain visible/);

db.prepare("UPDATE jobsearch_feeds SET consecutive_fail=0 WHERE feed='greenhouse:anthropic'").run();
assert.equal(db.prepare(probe).get().observed, "0");
