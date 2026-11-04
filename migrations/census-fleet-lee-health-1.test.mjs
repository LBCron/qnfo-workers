// CENSUS-FLEET-LEE-HEALTH-1 offline suite: replays migrations/2026-11-05-census-fleet-lee-health-1.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped); the qnfo-fleet-lee registry row moves from its disabled workers.dev host to
// the custom-domain API base the census appends /health to; no other registry row changes; a replay changes nothing and writes one decision row; the Rollback line restores the row.
// Output MUST contain "0 failed" on success.   node migrations/census-fleet-lee-health-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-census-fleet-lee-health-1.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one single-line Rollback header");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/\b(UPDATE|DELETE\s+FROM|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE\s+INTO)\s+(decision_log|issue_lifecycle)\b/i.test(body), "APPEND-ONLY-LINT-1: decision_log is only inserted into");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");

function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE service_registry (service TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'worker', version TEXT, base_url TEXT, updated_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
INSERT INTO service_registry (service, version, base_url, updated_at) VALUES
 ('qnfo-fleet-lee', 'unknown', 'https://qnfo-fleet-lee.q08.workers.dev', '2026-11-04T23:00:14.360Z'),
 ('q08-mind', '1.0.0', 'https://mind.q08.org', '2026-11-04T23:00:00.000Z'),
 ('qnfo-agents', '1.0.0', 'https://agents.qnfo.org', '2026-11-04T23:00:00.000Z'),
 ('qnfo-ai', '5.45.0', 'https://qnfo-ai.q08.workers.dev', '2026-11-04T23:00:00.000Z');`);
  return w;
}
const rows = (w) => w.prepare("SELECT service, base_url FROM service_registry ORDER BY service").all().map((r) => r.service + "=" + r.base_url);

const w = world();
const before = rows(w);
w.exec(body);
const after = rows(w);
const lee = w.prepare("SELECT base_url, version FROM service_registry WHERE service = 'qnfo-fleet-lee'").get();
ok(lee.base_url === "https://lee.qnfo.org/api", "qnfo-fleet-lee base_url is the custom-domain API base", lee);
ok(lee.base_url + "/health" === "https://lee.qnfo.org/api/health", "the census, which appends /health, reaches the health route lee serves");
ok(before.filter((r) => !r.startsWith("qnfo-fleet-lee=")).join("|") === after.filter((r) => !r.startsWith("qnfo-fleet-lee=")).join("|"), "no other registry row changes");
ok(w.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'CENSUS-FLEET-LEE-HEALTH-1:%'").get().n === 1, "one decision row");
const dl = w.prepare("SELECT predicted_outcome, rollback_path FROM decision_log").get();
ok(/fleet_journeys_failing\s*<=\s*\d+\s+within\s+\d+\s*h/.test(dl.predicted_outcome), "the decision row carries a prediction in the parser's metric form", dl);

w.exec(body);
ok(rows(w).join("|") === after.join("|"), "a replay changes nothing");
ok(w.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n === 1, "a replay writes no second decision row");

const rb = rollback[0].replace(/^-- Rollback:\s*/, "");
w.exec(rb);
ok(w.prepare("SELECT base_url FROM service_registry WHERE service = 'qnfo-fleet-lee'").get().base_url === "https://qnfo-fleet-lee.q08.workers.dev", "the Rollback line restores the workers.dev base_url");

// a row someone already pointed elsewhere is left alone
const x = world();
x.exec("UPDATE service_registry SET base_url = 'https://lee.qnfo.org/api' WHERE service = 'qnfo-fleet-lee'");
x.exec(body);
ok(x.prepare("SELECT base_url FROM service_registry WHERE service = 'qnfo-fleet-lee'").get().base_url === "https://lee.qnfo.org/api", "an already-correct row is untouched");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
