// W2-F-C offline suite: replays migrations/2026-11-05-w2f-c-cold-tier-cadence.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped in the body); COLD-TIER-CADENCE-1 is filed once (a replay changes nothing) with the routing, anchor and
// probe lines the code loop reads; the code-anchor occurs once in scripts/cold_tier.py and the code-probe string is not there yet; the copy-only tier is capped at 3 chunks; the Rollback line removes the issue.
// It does not read live state. Output MUST contain "0 failed" on success.   node migrations/w2f-c-cold-tier-cadence.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const rd = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const sql = rd("./2026-11-05-w2f-c-cold-tier-cadence.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one single-line Rollback header");
ok(header.some((l) => /^-- CAUSE-MAPPED: /.test(l)) && !/metric_registry/i.test(body), "registers no metric and says so");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");

const w = new DatabaseSync(":memory:");
w.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER)");
w.exec(sql);
const i = w.prepare("SELECT * FROM agent_issues WHERE title LIKE 'COLD-TIER-CADENCE-1:%'").get();
ok(i && i.status === "open" && /code-task: repo=qnfo-workers path=scripts\/cold_tier\.py/.test(i.description) && /code-anchor: def run\(d1, r2=None, now=None, sleep=time\.sleep, tiers=None, deadline=None\):/.test(i.description) && /code-probe: \{/.test(i.description), "the issue carries the routing, anchor and probe lines", i && i.description.slice(-300));
w.exec(sql);
ok(w.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 1, "a replay files nothing more");
w.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
ok(w.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 0, "the Rollback line removes the issue");

const py = rd("../scripts/cold_tier.py");
ok(py.split("def run(d1, r2=None, now=None, sleep=time.sleep, tiers=None, deadline=None):").length - 1 === 1, "the code-anchor occurs once in scripts/cold_tier.py");
ok(py.indexOf("COLD-TIER-WEIGHT-1") === -1, "the code-probe string is not in the file yet");
ok(/"table": "remediation_verifications"[^\n]*"mode": "copy"[\s\S]{0,200}"chunks": 3/.test(py), "the copy-only tier is capped at 3 chunks a run");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
