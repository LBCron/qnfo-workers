// OPS-FAILOVER-1 offline suite: replays migrations/2026-11-04-c5-resilience-ops-failover.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped, no LIKE pattern over 50 bytes); metric ops_gateway_hosts_ok names its producer and keeps the [BP26] tag the collector
// framework writes through, with a trigger below 1 and a mapped cause; the filed degraded-mode issue carries a code-task, an anchor that occurs exactly once in qnfo-ops/worker.js and a marker that is absent today; row 5 keeps
// its old evidence, stays partial and names what remains; a replay changes nothing; the Rollback line puts every touched row back; the collector and the migration agree on the metric name.
// Output MUST contain "0 failed" on success.   node migrations/c5-resilience-ops-failover.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const sql = rd("./2026-11-04-c5-resilience-ops-failover.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the body deletes and drops nothing");
ok(!/CREATE\s+(TEMP\s+)?TRIGGER/i.test(body), "no D1 trigger is created (AGENT-ISSUES-TRIGGER-DEPTH-1)");
ok(!/INSERT\s+(OR\s+\w+\s+)?INTO\s+(spof_registry|spof_alternate_probes)/i.test(body), "no SPOF row is registered before the alternate host has been read by the runner");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai link");
const likes = [...body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)].map((m) => m[1]);
ok(likes.every((p) => Buffer.byteLength(p) <= 50), "no LIKE pattern over 50 bytes (D1 rejects it)", likes);

const rollback = header.find((l) => /^-- Rollback:/.test(l)).replace(/^-- Rollback:\s*/, "");
const w = new DatabaseSync(":memory:");
w.exec(`CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, state TEXT, refresh_class TEXT, last_value TEXT, last_refreshed TEXT);
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER, enabled INTEGER, notes TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT, cause_key TEXT, note TEXT, PRIMARY KEY (metric_key, cause_key));
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT);`);
const EVID = "VSM S1 / OODA act | backlog mining 2026-09-30";
w.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (5, 'RM-S1-REDUNDANCY-1', 'autonomy_scores', 'partial', ?)").run(EVID);
w.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (6, 'RM-OTHER', 'x', 'partial', 'untouched')").run();
const one = (q, ...a) => w.prepare(q).get(...a);
const snap = () => JSON.stringify([w.prepare("SELECT * FROM metric_registry").all(), w.prepare("SELECT * FROM analytics_metric_triggers").all(), w.prepare("SELECT * FROM metric_breach_cause").all(), w.prepare("SELECT title, description FROM agent_issues").all(), w.prepare("SELECT * FROM roadmap_implementation").all()]);

w.exec(sql);
const m = one("SELECT * FROM metric_registry WHERE metric = 'ops_gateway_hosts_ok'");
ok(m && m.source_of_truth.includes("scripts/bp26_opsfailover.py collect_ops_failover") && m.source_of_truth.endsWith("[BP26]"), "the metric names its producer and keeps the [BP26] tag", m && m.source_of_truth);
ok(m.state === "UNMEASURED" && m.last_value === null && m.refresh_class === null && m.target === "1" && m.kind === "guard", "it starts unmeasured with target 1 and no value written by hand", m);
const t = one("SELECT * FROM analytics_metric_triggers WHERE metric_key = 'ops_gateway_hosts_ok'");
ok(t && t.operator === "lt" && t.threshold === 1 && t.enabled === 1 && t.queue_target === "agent_issues", "the trigger fires below 1 and queues an issue", t);
ok(/Definition of done/.test(t.action) && /Do not remove a hostname/.test(t.action), "the trigger action names the lever and forbids shrinking the host list to pass");
ok(one("SELECT cause_key FROM metric_breach_cause WHERE metric_key = 'ops_gateway_hosts_ok'").cause_key === "heartbeat", "the cause is mapped in the same file (METRIC-CAUSE-AT-REGISTRATION-1)");

const issues = w.prepare("SELECT * FROM agent_issues").all();
ok(issues.length === 1 && issues[0].source === "session:c5-resilience" && issues[0].status === "open" && issues[0].category === "code", "one open code issue is filed", issues.map((i) => i.title));
const d = issues[0].description;
const path = (/code-task: repo=qnfo-workers path=(\S+)/.exec(d) || [])[1];
const anchor = (/\ncode-anchor: (.*)\n/.exec(d) || [])[1];
const probe = (/\ncode-probe: (\{.*\})/.exec(d) || [])[1];
ok(issues[0].title.startsWith("ROADMAP-1: QNFO.OPS OPS-DEGRADED-1:") && /Prediction:/.test(d) && /charter pillar autonomy/.test(d), "the issue is a ROADMAP-1 row with pillar and prediction");
ok(path === "qnfo-ops/worker.js" && anchor && probe, "it carries code-task, code-anchor and code-probe", { path, anchor, probe });
const file = rd("../" + path);
ok(file.split(anchor).length - 1 === 1, "the anchor occurs exactly once in " + path, anchor);
const marker = JSON.parse(probe);
// Earlier state (until 2026-11-05T05:13Z): the marker was absent from qnfo-ops/worker.js, so the code-probe failed until the fix landed:
//   ok(marker.contains === "OPS-DEGRADED-1" && d.includes(marker.contains) && !file.includes(marker.contains), "...absent from the file today...")
// OPS-DEGRADED-1 landed in PR 7726 (qnfo-ops 2.67.0, W2-E, live 05:14:59Z), so the marker is now in the file and the closing probe passes. A test that pinned the defect would fail by design on main.
ok(marker.contains === "OPS-DEGRADED-1" && d.includes(marker.contains) && file.includes(marker.contains), "the closing marker is named in the issue and is present in the file now that the fix landed (PR 7726), so the code-probe passes");
ok(/Retry-After/.test(d) && /fleet-graph impact/.test(d) && /does not need D1|do not need D1|that does not need D1/.test(d), "the issue names the Retry-After requirement, the blast-radius lookup and which tools stay up");

const r5 = one("SELECT status, evidence FROM roadmap_implementation WHERE id = 5");
ok(r5.status === "partial" && r5.evidence.startsWith(EVID) && r5.evidence.includes("C5-RESILIENCE-5") && /REMAINING/.test(r5.evidence) && /OPS-DEGRADED-1/.test(r5.evidence), "row 5 stays partial, keeps its old evidence and names what remains", r5);
ok(/pending the first runner pass after merge/.test(r5.evidence), "row 5 does not claim a live reading of the new metric");
ok(one("SELECT evidence FROM roadmap_implementation WHERE id = 6").evidence === "untouched", "other rows are untouched");

const before = snap();
w.exec(sql);
ok(before === snap(), "a replay changes nothing");

w.exec(rollback);
ok(one("SELECT COUNT(*) n FROM metric_registry").n === 0 && one("SELECT COUNT(*) n FROM analytics_metric_triggers").n === 0 && one("SELECT COUNT(*) n FROM metric_breach_cause").n === 0 && one("SELECT COUNT(*) n FROM agent_issues").n === 0, "the Rollback line removes the metric, trigger, cause and issue");
ok(one("SELECT evidence FROM roadmap_implementation WHERE id = 5").evidence === EVID, "the Rollback line restores row 5 exactly");

const collector = rd("../scripts/bp26_opsfailover.py");
ok(collector.includes('"ops_gateway_hosts_ok"') && sql.includes("scripts/bp26_opsfailover.py"), "the collector and the migration use the same metric name and path");
ok(/workers_dev\s*=\s*true/.test(rd("../qnfo-ops/wrangler.toml")), "qnfo-ops still declares workers_dev = true, the alternate hostname the collector reads");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
