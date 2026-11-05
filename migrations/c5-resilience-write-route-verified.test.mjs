// WRITE-ROUTES-2 offline suite: replays migrations/2026-11-04-c5-resilience-write-route-verified.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped, no LIKE pattern over 50 bytes); row 133 keeps its status and its earlier evidence, gains one reading that names the open routes, the doers and what is still open, and does
// not claim the exit; a replay changes nothing; the Rollback line restores the row; the routes it names as refused are the ones scripts/write-routes.json still probes or registers.
// Output MUST contain "0 failed" on success.   node migrations/c5-resilience-write-route-verified.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const sql = rd("./2026-11-04-c5-resilience-write-route-verified.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body) && !/CREATE\s+(TEMP\s+)?TRIGGER/i.test(body), "the body deletes, drops and creates no trigger");
const likes = [...body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)].map((m) => m[1]);
ok(likes.every((p) => Buffer.byteLength(p) <= 50), "no LIKE pattern over 50 bytes (D1 rejects it)", likes);

const rollback = header.find((l) => /^-- Rollback:/.test(l)).replace(/^-- Rollback:\s*/, "");
const w = new DatabaseSync(":memory:");
w.exec("CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT);");
const EVID = "measured 2026-10-06 | exit: every write route answers 401/403 unauthenticated || C5-RESILIENCE-133 2026-11-05: partial. BUILT in the c5-resilience write-route-probe pull request";
w.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (133, 'RM-TP-8-TRUST-BOUNDARY', 'T8', 'partial', ?)").run(EVID);
w.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (52, 'RM-WAF-RATE-LIMIT-1', 'backlog', 'not-built', 'untouched')").run();
const one = (q, ...a) => w.prepare(q).get(...a);

w.exec(sql);
const r = one("SELECT status, evidence FROM roadmap_implementation WHERE id = 133");
ok(r.status === "partial" && r.evidence.startsWith(EVID) && r.evidence.includes("C5-RESILIENCE-133B"), "row 133 stays partial and keeps its earlier evidence", r.status);
ok(/unauth_write_routes_open = 2/.test(r.evidence) && /01:09:59Z/.test(r.evidence) && /14 routes probed, 2 OPEN, 12 refused/.test(r.evidence), "it quotes the reading and its timestamp");
ok(/qnfo-deploy-guard POST \/scan/.test(r.evidence) && /qnfo-research-exec POST \/run/.test(r.evidence) && /1001877/.test(r.evidence) && /1001878/.test(r.evidence), "it names the two open routes and their doers");
ok(/exit .* is not met/.test(r.evidence) && /levels? 3 to 5|levers 3 to 5/.test(r.evidence), "it says the exit is not met and which levers are not built");
ok(one("SELECT evidence FROM roadmap_implementation WHERE id = 52").evidence === "untouched", "the sibling rows are untouched");
const again = JSON.stringify(w.prepare("SELECT * FROM roadmap_implementation").all());
w.exec(sql);
ok(again === JSON.stringify(w.prepare("SELECT * FROM roadmap_implementation").all()), "a replay changes nothing");
w.exec(rollback);
ok(one("SELECT evidence FROM roadmap_implementation WHERE id = 133").evidence === EVID, "the Rollback line restores row 133 exactly");

// the routes the file calls refused are still either probed or registered in the manifest
const manifest = JSON.parse(rd("../scripts/write-routes.json"));
const probed = new Set(manifest.probe.map((p) => new URL(p.url).pathname));
for (const path of ["/mcp", "/mcp/messages", "/exec", "/v1/tools/call", "/ops/deploy", "/send", "/intent", "/code-sessions", "/ab/run"]) ok(probed.has(path), "still probed: " + path);
ok(probed.has("/scan") && probed.has("/run"), "the two open routes are still in the probe list, so the metric keeps counting them");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
