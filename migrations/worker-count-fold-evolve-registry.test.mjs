// WORKER-COUNT-1.2 registry half offline suite: replays migrations/2026-11-05-worker-count-fold-evolve-registry.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped, decision_log only inserted into); the qnfo-evolve registry row goes worker/live -> member/retired
// with the host base_url and no other row changes (so the census, which compares live scripts with kind worker and state live, no longer reads it as only-in-registry); the three named contracts are
// superseded with the reason and every other contract keeps its state (including the model-eval liveness contract and the qnfo-workers tombstone contract); one standing liveness contract reads the member
// route on the host; lever 3/16 follows the code; the 1001902 note is written once; one decision row carries a prediction the live parser reads (worker_count <= 38 within 3 h); a replay changes nothing;
// an already retired row is not re-stamped; the Rollback line puts rows, contracts, lever and note back. The repository half of the fold (PR 7447) is on this checkout.
// Output MUST contain "0 failed" on success.   node migrations/worker-count-fold-evolve-registry.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const sql = rd("migrations/2026-11-05-worker-count-fold-evolve-registry.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 500))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/\b(UPDATE|DELETE\s+FROM|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE\s+INTO)\s+(decision_log|issue_lifecycle)\b/i.test(body), "APPEND-ONLY-LINT-1: decision_log is only inserted into");
ok(!/INSERT\s+(OR\s+\w+\s+)?INTO\s+fleet_tick/i.test(body) && !/claude\.ai|anthropic\.com/i.test(sql), "no write to fleet_tick and no claude.ai or anthropic.com link");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");

// the repository half of the fold (PR 7447) is on this checkout
ok(existsSync(new URL("qnfo-evolve/FOLDED", root)), "qnfo-evolve/FOLDED exists (the marker cf-ops-actions delete-worker reads)");
ok(!/^qnfo-evolve\s/m.test(rd("deploy-targets.txt")), "deploy-targets.txt no longer lists qnfo-evolve");
ok(/binding = "CH_QNFO_EVOLVE"\r?\nservice = "qnfo-ai-calibration"\r?\nprops = \{ caller = "qnfo-ops", member = "qnfo-evolve" \}/.test(rd("qnfo-ops/wrangler.toml")), "qnfo-ops/wrangler.toml binds CH_QNFO_EVOLVE to the host with props.member");
ok(/qnfoEvolveFoldMod/.test(rd("qnfo-ai-calibration/worker.js")) && /\/evolve\/health/.test(rd("qnfo-ai-calibration/probes.json")), "the host carries the member and probes its route");

const calib = rd("migrations/2026-10-12-22-calibration-scorer.sql");
const pt0 = calib.indexOf("CREATE TRIGGER IF NOT EXISTS decision_predictions_parse"), pt1 = calib.indexOf("\nEND;", pt0) + 5;
const PARSE_TRIGGER = calib.slice(pt0, pt1);

function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE service_registry (service TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'worker', version TEXT, base_url TEXT, purpose TEXT, capabilities TEXT, routes TEXT, tools TEXT, models TEXT, deps TEXT, updated_at TEXT, state TEXT NOT NULL DEFAULT 'live');
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER DEFAULT 3, escalate_to TEXT, expected_cadence_h INTEGER DEFAULT 1, status TEXT DEFAULT 'active', ts TEXT, last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, next_due_at TEXT);
CREATE TABLE transformation_levers (id INTEGER PRIMARY KEY AUTOINCREMENT, tp INTEGER NOT NULL, n INTEGER NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, wave TEXT NOT NULL, path TEXT, status TEXT NOT NULL DEFAULT 'pending', updated_at TEXT, UNIQUE(tp, n));
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, status TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'decision_log is append-only'); END;
CREATE TABLE decision_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL, op TEXT NOT NULL, value REAL, value2 REAL, due_at TEXT NOT NULL, origin TEXT NOT NULL, scored_at TEXT, UNIQUE (decision_id, kind, subject, op));`);
  w.exec(PARSE_TRIGGER);
  w.prepare("INSERT INTO metric_registry (metric, last_value) VALUES ('worker_count', '39')").run();
  const sr = w.prepare("INSERT INTO service_registry (service, kind, version, base_url, purpose, state, updated_at) VALUES (?, 'worker', ?, ?, ?, ?, '2026-11-05T01:00:14Z')");
  sr.run("qnfo-evolve", "0.2.12-revert-a339688", "https://qnfo-evolve.q08.workers.dev", "EVOLVE-1 gap registers", "live");
  sr.run("qnfo-ai-calibration", "1.7.0", "https://qnfo-ai-calibration.q08.workers.dev", "model health", "live");
  sr.run("qnfo-model-eval", "1.8.4", "https://qnfo-model-eval.q08.workers.dev", "model eval", "live");
  sr.run("qnfo-workers", "unknown", "https://qnfo-workers.q08.workers.dev", null, "retired");
  sr.run("qnfo-evolve-sibling", "1.0.0", "https://x", "a name that starts the same way", "live");
  const rc = w.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, last_verdict, next_due_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  rc.run("rt-live-qnfo-evolve", null, '{"url": "https://qnfo-evolve.q08.workers.dev/health"}', "runner-https", "active", "pass", "2026-11-05 02:00:00");
  rc.run("issue-1001819", 1001819, '{"url": "https://qnfo-evolve.q08.workers.dev/health", "status": 200}', "runner-https", "holding", "pass", "2026-11-05 02:00:00");
  rc.run("issue-1001828", 1001828, '{"url": "https://qnfo-evolve.q08.workers.dev/health", "status": 200}', "runner-https", "holding", "pass", "2026-11-05 02:00:00");
  rc.run("issue-1000156", 1000156, "SELECT 1", "d1-query", "holding", "pass", "2026-11-05 02:00:00");
  rc.run("rt-live-qnfo-model-eval", null, '{"url": "https://qnfo-model-eval.q08.workers.dev/health"}', "runner-https", "active", "pass", "2026-11-05 02:00:00");
  rc.run("fm-evolve-wip-planner-mismatch", null, "SELECT 1", "d1-query", "active", "pass", "2026-11-05 02:00:00");
  rc.run("issue-2995", 2995, "SELECT 1", "d1-query", "closed", "pass", null);
  w.prepare("INSERT INTO transformation_levers (tp, n, key, title, kind, wave, path, status, updated_at) VALUES (3, 16, 'fold-evolve-into-cloud-ops', 't', 'refactor', 'W1', 'qnfo-cloud-ops/worker.js', 'dispatched', '2026-11-05T00:30:00Z')").run();
  w.prepare("INSERT INTO transformation_levers (tp, n, key, title, kind, wave, path, status, updated_at) VALUES (3, 17, 'fold-model-eval-into-calibration', 't', 'refactor', 'W1', 'qnfo-ai-calibration/worker.js', 'dispatched', '2026-11-05T00:30:00Z')").run();
  w.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1001902, 'ROADMAP-1: QNFO.INFRA WORKER-COUNT-1.2: fold qnfo-evolve', 'original text', 'open')").run();
  return w;
}
const q1 = (w, s, ...p) => w.prepare(s).get(...p);
const qa = (w, s, ...p) => w.prepare(s).all(...p);
const reg = (w, s) => q1(w, "SELECT kind, state, version, base_url, purpose, updated_at FROM service_registry WHERE service = ?", s);
const cst = (w, c) => (q1(w, "SELECT status s FROM remediation_contracts WHERE class = ?", c) || {}).s;

const w = world();
w.exec(sql);
const ev = reg(w, "qnfo-evolve");
ok(ev.kind === "member" && ev.state === "retired" && ev.version === "0.2.12-folded" && ev.base_url === "https://qnfo-ai-calibration.q08.workers.dev/evolve" && /member of qnfo-ai-calibration/.test(ev.purpose), "qnfo-evolve is a retired member served by the host", ev);
ok(reg(w, "qnfo-ai-calibration").state === "live" && reg(w, "qnfo-model-eval").state === "live" && reg(w, "qnfo-workers").state === "retired" && reg(w, "qnfo-evolve-sibling").state === "live" && reg(w, "qnfo-evolve-sibling").kind === "worker", "no other registry row changed (the host, another worker, the tombstone, a name that starts the same way)");
// the census reads kind worker and state live; after the file the removed script is not a registry-only name
{
  const liveScripts = new Set(["qnfo-ai-calibration", "qnfo-model-eval", "qnfo-workers", "qnfo-evolve-sibling"]);
  const onlyRegistry = qa(w, "SELECT service FROM service_registry WHERE kind = 'worker' AND state = 'live'").map((r) => r.service).filter((s) => !liveScripts.has(s));
  ok(onlyRegistry.length === 0, "the registry holds no live worker row for a script that is gone", onlyRegistry);
}
for (const c of ["rt-live-qnfo-evolve", "issue-1001819", "issue-1001828"]) ok(cst(w, c) === "superseded" && /^superseded:WORKER-COUNT-1\.2/.test(q1(w, "SELECT last_verdict v FROM remediation_contracts WHERE class = ?", c).v), c + " is superseded with the reason");
ok(cst(w, "issue-1000156") === "holding" && cst(w, "rt-live-qnfo-model-eval") === "active" && cst(w, "fm-evolve-wip-planner-mismatch") === "active" && cst(w, "issue-2995") === "closed", "no other contract changed state (the tombstone contract, model-eval liveness, the evolve detector that reads the tables the member still writes, a closed one)");
const member = q1(w, "SELECT status, verify_transport, verify_probe, module FROM remediation_contracts WHERE class = 'rt-live-qnfo-evolve-member'");
ok(member && member.status === "active" && member.verify_transport === "runner-https" && JSON.parse(member.verify_probe).url === "https://qnfo-ai-calibration.q08.workers.dev/evolve/health" && JSON.parse(member.verify_probe).contains === "qnfo-evolve", "the member route has a standing liveness contract on the host", member);
ok(q1(w, "SELECT path p FROM transformation_levers WHERE tp = 3 AND n = 16").p === "qnfo-ai-calibration/worker.js" && q1(w, "SELECT path p FROM transformation_levers WHERE tp = 3 AND n = 17").p === "qnfo-ai-calibration/worker.js", "lever 16 follows the code to the host, lever 17 is untouched");
ok(q1(w, "SELECT (length(description) - length(replace(description, 'WORKER-COUNT-1.2 2026-11-05', ''))) / length('WORKER-COUNT-1.2 2026-11-05') c FROM agent_issues WHERE id = 1001902").c === 1 && /^original text/.test(q1(w, "SELECT description d FROM agent_issues WHERE id = 1001902").d), "issue 1001902 keeps its text and carries the dated note once");
const dec = qa(w, "SELECT actor, predicted_outcome FROM decision_log");
ok(dec.length === 1 && /^session:breach-cost-retire/.test(dec[0].actor), "one decision row");
const pred = qa(w, "SELECT subject, op, value, CAST(round((julianday(due_at) - julianday('now')) * 24) AS INTEGER) h FROM decision_predictions");
ok(pred.length === 1 && pred[0].subject === "worker_count" && pred[0].op === "<=" && pred[0].value === 38 && Math.abs(pred[0].h - 3) <= 1, "the live parser reads worker_count <= 38 within 3 h", pred);

{ // replay
  const snap = () => JSON.stringify([qa(w, "SELECT service, kind, state, version, updated_at FROM service_registry ORDER BY service"), qa(w, "SELECT class, status, last_verdict FROM remediation_contracts ORDER BY class"), qa(w, "SELECT n, path, updated_at FROM transformation_levers ORDER BY n"), qa(w, "SELECT id, description FROM agent_issues"), qa(w, "SELECT action FROM decision_log"), qa(w, "SELECT decision_id, subject FROM decision_predictions")]);
  const s1 = snap();
  w.exec(sql);
  ok(snap() === s1, "a second apply changes nothing");
}
{ // a row that is not a live worker is left alone
  const x = world();
  x.prepare("UPDATE service_registry SET state = 'retired', updated_at = '2026-11-01T00:00:00Z' WHERE service = 'qnfo-evolve'").run();
  x.exec(sql);
  ok(reg(x, "qnfo-evolve").updated_at === "2026-11-01T00:00:00Z" && reg(x, "qnfo-evolve").kind === "worker", "an already retired row keeps its kind and updated_at");
}
{ // rollback
  const r = world();
  const fresh = JSON.stringify([qa(r, "SELECT service, kind, state, version, base_url, purpose, updated_at FROM service_registry ORDER BY service"), qa(r, "SELECT class, status, last_verdict, next_due_at FROM remediation_contracts ORDER BY class"), qa(r, "SELECT n, path, updated_at FROM transformation_levers ORDER BY n"), qa(r, "SELECT id, description FROM agent_issues")]);
  r.exec(sql);
  r.exec(sql.split("\n").find((l) => l.startsWith("-- Rollback: ")).slice("-- Rollback: ".length));
  const back = JSON.stringify([qa(r, "SELECT service, kind, state, version, base_url, purpose, updated_at FROM service_registry ORDER BY service"), qa(r, "SELECT class, status, last_verdict, next_due_at FROM remediation_contracts ORDER BY class"), qa(r, "SELECT n, path, updated_at FROM transformation_levers ORDER BY n"), qa(r, "SELECT id, description FROM agent_issues")]);
  ok(back === fresh, "Rollback restores the registry row, the contracts (and removes the new one), the lever path and the issue text byte for byte");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
