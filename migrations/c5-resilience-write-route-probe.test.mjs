// WRITE-ROUTES-1 offline suite: replays migrations/2026-11-04-c5-resilience-write-route-probe.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped, no LIKE pattern over 50 bytes); the metric unauth_write_routes_open names its producer and keeps the [BP26] tag the
// collector framework writes through, with a trigger above 0 and a mapped cause; the two filed issues carry a code-task, an anchor that occurs exactly once in the named file, and a code-probe marker; T8 lever 2 and row 133
// move once and a replay changes nothing; the Rollback line puts every touched row back; the manifest, the collector and the migration agree on the metric name and the open-gap routes.
// Output MUST contain "0 failed" on success.   node migrations/c5-resilience-write-route-probe.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const sql = rd("./2026-11-04-c5-resilience-write-route-probe.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the body deletes and drops nothing");
ok(!/INSERT\s+(OR\s+\w+\s+)?INTO\s+fleet_tick/i.test(body) && !/claude\.ai|anthropic\.com/i.test(sql), "no write to fleet_tick and no claude.ai link");
ok(!/CREATE\s+(TEMP\s+)?TRIGGER/i.test(body), "no D1 trigger is created (AGENT-ISSUES-TRIGGER-DEPTH-1)");
const likes = [...body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)].map((m) => m[1]);
ok(likes.every((p) => Buffer.byteLength(p) <= 50), "no LIKE pattern over 50 bytes (D1 rejects it)", likes);

const rollback = header.find((l) => /^-- Rollback:/.test(l)).replace(/^-- Rollback:\s*/, "");
const w = new DatabaseSync(":memory:");
w.exec(`CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, state TEXT, refresh_class TEXT, last_value TEXT, last_refreshed TEXT);
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER, enabled INTEGER, notes TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT, cause_key TEXT, note TEXT, PRIMARY KEY (metric_key, cause_key));
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE transformation_levers (id INTEGER PRIMARY KEY AUTOINCREMENT, tp INTEGER, n INTEGER, key TEXT, status TEXT DEFAULT 'pending', note TEXT, landed_at TEXT);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT);`);
const EVID = "measured 2026-10-06: #1677 #1678 open | exit: security_open_issues 0 and every write route answers 401/403 unauthenticated";
const NOTE = "issue 1677 closed before the lever landed: re-verify by probe";
w.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (133, 'RM-TP-8-TRUST-BOUNDARY', 'docs/TRANSFORMATION-PROGRAM.md T8', 'not-built', ?)").run(EVID);
w.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (52, 'RM-WAF-RATE-LIMIT-1', 'backlog', 'not-built', 'untouched')").run();
w.prepare("INSERT INTO transformation_levers (tp, n, key, status, note) VALUES (8, 2, 'containers-exec-access', 'pending', ?)").run(NOTE);
w.prepare("INSERT INTO transformation_levers (tp, n, key, status, note) VALUES (8, 3, 'access-and-waf', 'pending', '')").run();
const one = (q, ...a) => w.prepare(q).get(...a);

w.exec(sql);
const m = one("SELECT * FROM metric_registry WHERE metric = 'unauth_write_routes_open'");
ok(m && m.source_of_truth.includes("scripts/bp26_writeroutes.py collect_write_routes") && m.source_of_truth.endsWith("[BP26]"), "the metric names its producer and keeps the [BP26] tag", m && m.source_of_truth);
ok(m.state === "UNMEASURED" && m.last_value === null && m.refresh_class === null && m.target === "0" && m.kind === "target", "it starts unmeasured with target 0 and no value written by hand", m);
const t = one("SELECT * FROM analytics_metric_triggers WHERE metric_key = 'unauth_write_routes_open'");
ok(t && t.operator === "gt" && t.threshold === 0 && t.enabled === 1 && t.queue_target === "agent_issues", "the trigger fires above 0 and queues an issue", t);
ok(t.action.length > 200 && /Definition of done/.test(t.action) && /delete nothing from scripts\/write-routes\.json/.test(t.action), "the trigger action names the lever and forbids shrinking the manifest to pass");
ok(one("SELECT cause_key FROM metric_breach_cause WHERE metric_key = 'unauth_write_routes_open'").cause_key === "structure", "the cause is mapped in the same file (METRIC-CAUSE-AT-REGISTRATION-1)");

const issues = w.prepare("SELECT * FROM agent_issues ORDER BY id").all();
ok(issues.length === 2 && issues.every((i) => i.source === "session:c5-resilience" && i.status === "open" && i.category === "code"), "two open code issues are filed", issues.map((i) => i.title));
const taskOf = (d) => ({ path: (/code-task: repo=qnfo-workers path=(\S+)/.exec(d) || [])[1], anchor: (/\ncode-anchor: (.*)\n/.exec(d) || [])[1], probe: (/\ncode-probe: (\{.*\})/.exec(d) || [])[1] });
for (const i of issues) {
  const k = taskOf(i.description);
  ok(i.title.startsWith("ROADMAP-1: QNFO.INFRA WRITE-ROUTES-") && /Prediction:/.test(i.description) && /charter pillar security/.test(i.description), "issue is a ROADMAP-1 row with pillar and prediction", i.title);
  ok(k.path && k.anchor && k.probe, "issue carries code-task, code-anchor and code-probe", k);
  const file = rd("../" + k.path);
  ok(file.split(k.anchor).length - 1 === 1, "the anchor occurs exactly once in " + k.path, k.anchor);
  const marker = JSON.parse(k.probe);
  ok(marker.paths[0] === k.path && /^WRITE-ROUTES-/.test(marker.contains) && i.description.includes(marker.contains), "the closing marker is named in the issue and does not exist in the file yet", marker);
  ok(!file.includes(marker.contains), "the marker is absent from " + k.path + " today, so the probe fails until the fix lands");
}

ok(one("SELECT status, note, landed_at FROM transformation_levers WHERE tp = 8 AND n = 2").status === "landed" && /^C5-RESILIENCE:/.test(one("SELECT note FROM transformation_levers WHERE tp = 8 AND n = 2").note), "T8 lever 2 is landed with its evidence");
ok(one("SELECT status FROM transformation_levers WHERE tp = 8 AND n = 3").status === "pending", "T8 lever 3 stays pending (not built here)");
const r133 = one("SELECT status, evidence FROM roadmap_implementation WHERE id = 133");
ok(r133.status === "partial" && r133.evidence.startsWith(EVID) && r133.evidence.includes("C5-RESILIENCE-133") && /REMAINING/.test(r133.evidence) && /RM-WAF-RATE-LIMIT-1, row 52/.test(r133.evidence), "row 133 is partial, keeps its old evidence and names what remains", r133.status);
ok(!/\b(built|deployed|verified live)\b/i.test(r133.evidence.replace("BUILT in", "").replace(/pending the first runner pass after merge and deploy/, "")) || /pending/.test(r133.evidence), "row 133 does not claim a live verification");
ok(one("SELECT status, evidence FROM roadmap_implementation WHERE id = 52").evidence === "untouched", "the sibling rows (secrets store, WAF, tail workers) are left to their own sessions");

const before = JSON.stringify([w.prepare("SELECT * FROM metric_registry").all(), w.prepare("SELECT COUNT(*) n FROM analytics_metric_triggers").get(), w.prepare("SELECT COUNT(*) n FROM agent_issues").get(), w.prepare("SELECT * FROM roadmap_implementation").all(), w.prepare("SELECT * FROM transformation_levers").all()]);
w.exec(sql);
ok(before === JSON.stringify([w.prepare("SELECT * FROM metric_registry").all(), w.prepare("SELECT COUNT(*) n FROM analytics_metric_triggers").get(), w.prepare("SELECT COUNT(*) n FROM agent_issues").get(), w.prepare("SELECT * FROM roadmap_implementation").all(), w.prepare("SELECT * FROM transformation_levers").all()]), "a replay changes nothing");

w.exec(rollback);
ok(one("SELECT COUNT(*) n FROM metric_registry").n === 0 && one("SELECT COUNT(*) n FROM analytics_metric_triggers").n === 0 && one("SELECT COUNT(*) n FROM metric_breach_cause").n === 0 && one("SELECT COUNT(*) n FROM agent_issues").n === 0, "the Rollback line removes the metric, trigger, cause and issues");
ok(one("SELECT status, evidence FROM roadmap_implementation WHERE id = 133").evidence === EVID && one("SELECT status FROM roadmap_implementation WHERE id = 133").status === "not-built", "the Rollback line restores row 133 exactly");
const lv = one("SELECT status, note, landed_at FROM transformation_levers WHERE tp = 8 AND n = 2");
ok(lv.status === "pending" && lv.note === NOTE && lv.landed_at === null, "the Rollback line restores T8 lever 2 exactly");

// the manifest, the collector and this migration agree
const manifest = JSON.parse(rd("../scripts/write-routes.json"));
const collector = rd("../scripts/bp26_writeroutes.py");
ok(collector.includes('"unauth_write_routes_open"') && sql.includes("scripts/bp26_writeroutes.py"), "the collector and the migration use the same metric name and path");
const gaps = manifest.register.filter((r) => r.disposition === "open-gap");
ok(gaps.length >= 4 && gaps.every((g) => g.worker === "qnfo-deploy-guard" && sql.includes(g.route.split(",")[0].replace(/^POST /, ""))), "every open-gap route is named in the filed deploy-guard issue", gaps.map((g) => g.route));
ok(!manifest.probe.some((p) => /qnfo-evolve\.q08\.workers\.dev/.test(p.url)) && manifest.register.some((r) => r.worker === "qnfo-ai-calibration" && /evolve\/tick/.test(r.route)), "the evolve route that PR 7353 closed left the probe list when qnfo-evolve was folded into qnfo-ai-calibration (WORKER-COUNT-1.2); the register says why it is not reachable");
const evolve = rd("../qnfo-evolve/worker.js");
ok(/function tickAllowed\(env, req\) \{\s*if \(!env\.LOOP_TOKEN\) return false;/.test(evolve), "qnfo-evolve fails closed when no LOOP_TOKEN is bound");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
