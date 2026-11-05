// RETIRE-FLEET-LEE-1 offline suite: replays migrations/2026-11-05-retire-fleet-lee.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped); only the qnfo-fleet-lee registry row moves to retired; a replay changes nothing and
// writes one decision row; the Rollback line restores state live; the repository record exists and names the owner decision.
// Output MUST contain "0 failed" on success.   node migrations/retire-fleet-lee.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-retire-fleet-lee.sql", import.meta.url), "utf8");
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
  w.exec(`CREATE TABLE service_registry (service TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'worker', version TEXT, base_url TEXT, updated_at TEXT, state TEXT NOT NULL DEFAULT 'live');
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
INSERT INTO service_registry (service, version, base_url, updated_at, state) VALUES
 ('qnfo-fleet-lee', 'unknown', 'https://lee.qnfo.org/api', '2026-11-05T05:30:14.776Z', 'live'),
 ('q08-mind', '1.0.0', 'https://mind.q08.org', '2026-11-05T05:00:00.000Z', 'live'),
 ('qnfo-ai', '5.48.0', 'https://qnfo-ai.q08.workers.dev', '2026-11-05T05:00:00.000Z', 'live');`);
  return w;
}
const rows = (w) => w.prepare("SELECT service, state FROM service_registry ORDER BY service").all().map((r) => r.service + "=" + r.state);

const w = world();
const before = rows(w);
w.exec(body);
const after = rows(w);
ok(w.prepare("SELECT state FROM service_registry WHERE service = 'qnfo-fleet-lee'").get().state === "retired", "qnfo-fleet-lee is retired");
ok(before.filter((r) => !r.startsWith("qnfo-fleet-lee=")).join("|") === after.filter((r) => !r.startsWith("qnfo-fleet-lee=")).join("|"), "no other registry row changes");
ok(w.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'RETIRE-FLEET-LEE-1:%'").get().n === 1, "one decision row");
const dl = w.prepare("SELECT predicted_outcome, rollback_path FROM decision_log").get();
ok(/fleet_journeys_failing\s*<=\s*\d+\s+within\s+\d+\s*h/.test(dl.predicted_outcome), "the decision row carries a prediction in the parser's metric form", dl);

w.exec(body);
ok(rows(w).join("|") === after.join("|"), "a replay changes nothing");
ok(w.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n === 1, "a replay writes no second decision row");

w.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
ok(w.prepare("SELECT state FROM service_registry WHERE service = 'qnfo-fleet-lee'").get().state === "live", "the Rollback line restores state live");

const marker = new URL("../qnfo-fleet-lee/RETIRED", import.meta.url);
ok(existsSync(marker), "qnfo-fleet-lee/RETIRED exists (the marker cf-ops-actions delete-worker requires)");
const text = existsSync(marker) ? readFileSync(marker, "utf8") : "";
ok(/fleet command line/i.test(text) && /authenticated owner/i.test(text) && /cf-ops-actions delete-worker/.test(text), "the record names the owner decision and the delete path");

console.log(pass + " passed, " + fail + " failed");
