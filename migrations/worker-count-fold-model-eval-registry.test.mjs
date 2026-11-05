// WORKER-COUNT-1.3 registry half offline suite (W2-E, 2026-11-05): replays migrations/2026-11-05-worker-count-fold-model-eval-registry.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped, decision_log only inserted into); the qnfo-model-eval registry row goes worker/live -> member/retired
// with the host base_url and no other row changes (so the census, which compares live scripts with kind worker and state live, no longer reads it as only-in-registry); rt-live-qnfo-model-eval is superseded with
// the reason and every other contract keeps its state (the qnfo-evolve member contract, the tombstone contract, a closed one); one standing liveness contract reads the member route on the host; the closing
// contracts issue-1001902 and issue-1001903, superseded at birth by the circular template, get a probe that MEASURES the fold (registry row retired and worker_count at or below 38 / 37): the probe fails on
// the pre-fold registry, passes on the folded one and is a read-only SELECT with equal-string expected/observed; lever 3/17 is landed once; the issue notes are written once; one decision row carries a
// prediction the live parser reads (worker_count <= 37 within a few hours); a replay changes nothing; an already retired row is not re-stamped; the Rollback line puts rows, contracts, lever and notes back.
// The repository half of the fold (PR 7523, repaired by PR 7624) is on this checkout.
// Output MUST contain "0 failed" on success.   node migrations/worker-count-fold-model-eval-registry.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const sql = rd("migrations/2026-11-05-worker-count-fold-model-eval-registry.sql");
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

// the repository half of the fold (PR 7523 and 7624) is on this checkout
ok(existsSync(new URL("qnfo-model-eval/FOLDED", root)), "qnfo-model-eval/FOLDED exists (the marker cf-ops-actions delete-worker read)");
ok(!/^qnfo-model-eval\s/m.test(rd("deploy-targets.txt")), "deploy-targets.txt no longer lists qnfo-model-eval");
ok(/binding = "CH_QNFO_MODEL_EVAL"\r?\nservice = "qnfo-ai-calibration"\r?\nprops = \{ caller = "qnfo-ops", member = "qnfo-model-eval" \}/.test(rd("qnfo-ops/wrangler.toml")), "qnfo-ops/wrangler.toml binds CH_QNFO_MODEL_EVAL to the host with props.member");
ok(/qnfoModelEvalFoldMod/.test(rd("qnfo-ai-calibration/worker.js")) && /\/model-eval\/health/.test(rd("qnfo-ai-calibration/probes.json")), "the host carries the member and probes its route");

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
  w.exec("ALTER TABLE transformation_levers ADD COLUMN note TEXT; ALTER TABLE transformation_levers ADD COLUMN landed_at TEXT;");
  w.prepare("INSERT INTO metric_registry (metric, last_value) VALUES ('worker_count', '38')").run();
  const sr = w.prepare("INSERT INTO service_registry (service, kind, version, base_url, purpose, state, updated_at) VALUES (?, 'worker', ?, ?, ?, ?, '2026-11-05T03:07:00Z')");
  sr.run("qnfo-model-eval", "1.8.4-codeagent", "https://qnfo-model-eval.q08.workers.dev", "CF-MODEL-EVAL-1 original purpose", "live");
  sr.run("qnfo-ai-calibration", "1.8.1", "https://qnfo-ai-calibration.q08.workers.dev", "model health", "live");
  sr.run("qnfo-evolve", "0.2.12-folded", "https://qnfo-ai-calibration.q08.workers.dev/evolve", "EVOLVE-1", "retired");
  sr.run("qnfo-workers", "unknown", "https://qnfo-workers.q08.workers.dev", null, "retired");
  sr.run("qnfo-model-eval-sibling", "1.0.0", "https://x", "a name that starts the same way", "live");
  const rc = w.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, last_verdict, next_due_at, precondition) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  rc.run("rt-live-qnfo-model-eval", null, '{"url": "https://qnfo-model-eval.q08.workers.dev/health"}', "runner-https", "active", "pass", "2026-11-05 04:00:00", "standing liveness");
  rc.run("rt-live-qnfo-evolve-member", null, '{"url": "https://qnfo-ai-calibration.q08.workers.dev/evolve/health"}', "runner-https", "active", "pass", "2026-11-05 04:00:00", "standing liveness");
  rc.run("issue-1000156", 1000156, "SELECT 1", "d1-query", "holding", "pass", "2026-11-05 04:00:00", "tombstone");
  rc.run("issue-1001902", 1001902, "SELECT 'closed' AS expected, NULL AS observed", "d1-query", "superseded", "superseded:closure-observing-probe-at-birth", null, "birth template");
  rc.run("issue-1001903", 1001903, "SELECT 'closed' AS expected, NULL AS observed", "d1-query", "superseded", "superseded:closure-observing-probe-at-birth", null, "birth template");
  rc.run("issue-2995", 2995, "SELECT 1", "d1-query", "closed", "pass", null, "closed one");
  w.prepare("INSERT INTO transformation_levers (tp, n, key, title, kind, wave, path, status, updated_at, note) VALUES (3, 16, 'fold-evolve-into-cloud-ops', 't', 'refactor', 'W1', 'qnfo-ai-calibration/worker.js', 'dispatched', '2026-11-05T00:30:00Z', 'adopted: 1.2')").run();
  w.prepare("INSERT INTO transformation_levers (tp, n, key, title, kind, wave, path, status, updated_at, note) VALUES (3, 17, 'fold-model-eval-into-calibration', 't', 'refactor', 'W1', 'qnfo-ai-calibration/worker.js', 'dispatched', '2026-11-05T00:30:00Z', 'adopted: ROADMAP-1 issue WORKER-COUNT-1.3 (session-task)')").run();
  w.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1001902, 'ROADMAP-1: QNFO.INFRA WORKER-COUNT-1.2: fold qnfo-evolve', 'original text 1.2', 'open')").run();
  w.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1001903, 'ROADMAP-1: QNFO.INFRA WORKER-COUNT-1.3: fold qnfo-model-eval', 'original text 1.3', 'open')").run();
  return w;
}
const q1 = (w, s, ...p) => w.prepare(s).get(...p);
const qa = (w, s, ...p) => w.prepare(s).all(...p);
const reg = (w, s) => q1(w, "SELECT kind, state, version, base_url, purpose, updated_at FROM service_registry WHERE service = ?", s);
const cst = (w, c) => (q1(w, "SELECT status s FROM remediation_contracts WHERE class = ?", c) || {}).s;
const probe = (w, cls) => { const p = q1(w, "SELECT verify_probe v FROM remediation_contracts WHERE class = ?", cls).v; return w.prepare(p).get(); };

const w = world();
// the closing probes fail before the registry half (the defect is present) ...
{
  const pre = world();
  pre.exec(sql);
  pre.prepare("UPDATE service_registry SET state = 'live', kind = 'worker' WHERE service = 'qnfo-model-eval'").run();
  ok(probe(pre, "issue-1001903").expected === "1" && probe(pre, "issue-1001903").observed === "0", "the 1.3 probe FAILS while the registry still says live", probe(pre, "issue-1001903"));
}
w.exec(sql);
const me = reg(w, "qnfo-model-eval");
ok(me.kind === "member" && me.state === "retired" && me.version === "1.8.4-folded" && me.base_url === "https://qnfo-ai-calibration.q08.workers.dev/model-eval" && /member of qnfo-ai-calibration/.test(me.purpose), "qnfo-model-eval is a retired member served by the host", me);
ok(reg(w, "qnfo-ai-calibration").state === "live" && reg(w, "qnfo-evolve").state === "retired" && reg(w, "qnfo-workers").state === "retired" && reg(w, "qnfo-model-eval-sibling").state === "live" && reg(w, "qnfo-model-eval-sibling").kind === "worker", "no other registry row changed");
{
  const liveScripts = new Set(["qnfo-ai-calibration", "qnfo-workers", "qnfo-model-eval-sibling"]);
  const onlyRegistry = qa(w, "SELECT service FROM service_registry WHERE kind = 'worker' AND state = 'live'").map((r) => r.service).filter((s) => !liveScripts.has(s));
  ok(onlyRegistry.length === 0, "the registry holds no live worker row for a script that is gone", onlyRegistry);
}
ok(cst(w, "rt-live-qnfo-model-eval") === "superseded" && /^superseded:WORKER-COUNT-1\.3/.test(q1(w, "SELECT last_verdict v FROM remediation_contracts WHERE class = 'rt-live-qnfo-model-eval'").v), "rt-live-qnfo-model-eval is superseded with the reason");
ok(cst(w, "issue-1000156") === "holding" && cst(w, "rt-live-qnfo-evolve-member") === "active" && cst(w, "issue-2995") === "closed", "no other contract changed state (tombstone, evolve member, a closed one)");
const member = q1(w, "SELECT status, verify_transport, verify_probe, module FROM remediation_contracts WHERE class = 'rt-live-qnfo-model-eval-member'");
ok(member && member.status === "active" && member.verify_transport === "runner-https" && JSON.parse(member.verify_probe).url === "https://qnfo-ai-calibration.q08.workers.dev/model-eval/health" && JSON.parse(member.verify_probe).contains === "qnfo-model-eval" && member.module === "runtime-liveness-v1", "the member liveness contract reads the member route on the host", member);
for (const [cls, issue] of [["issue-1001902", 1001902], ["issue-1001903", 1001903]]) {
  const c = q1(w, "SELECT status, verify_transport, verify_probe, last_verdict FROM remediation_contracts WHERE class = ?", cls);
  ok(c.status === "active" && c.verify_transport === "d1-query" && c.last_verdict === null && /^SELECT '1' AS expected, CASE WHEN/.test(c.verify_probe) && !/;/.test(c.verify_probe) && !/\b(insert|update|delete|drop|alter|create|replace)\b/i.test(c.verify_probe), cls + " gets an active read-only measuring probe", c);
}
ok(probe(w, "issue-1001902").expected === probe(w, "issue-1001902").observed, "the 1.2 closing probe passes on the folded world (registry retired, worker_count 38 <= 38)", probe(w, "issue-1001902"));
{ // 1.3 needs the count to have fallen
  const x = world(); x.exec(sql);
  ok(probe(x, "issue-1001903").observed === "0", "while worker_count still reads 38 the 1.3 probe stays failing (the fold is not counted until the census says so)", probe(x, "issue-1001903"));
  x.prepare("UPDATE metric_registry SET last_value = '37' WHERE metric = 'worker_count'").run();
  ok(probe(x, "issue-1001903").expected === probe(x, "issue-1001903").observed, "and passes once worker_count reads 37", probe(x, "issue-1001903"));
}
const lv = q1(w, "SELECT status, path, note FROM transformation_levers WHERE tp = 3 AND n = 17");
ok(lv.status === "landed" && lv.path === "qnfo-ai-calibration/worker.js" && /^adopted: ROADMAP-1 issue WORKER-COUNT-1\.3/.test(lv.note) && /W2E-FOLD-1\.3/.test(lv.note), "lever 3/17 is landed and keeps its note", lv);
ok(q1(w, "SELECT status s FROM transformation_levers WHERE tp = 3 AND n = 16").s === "dispatched", "lever 3/16 is not touched here");
for (const [id, tag, orig] of [[1001902, "WORKER-COUNT-1.2 2026-11-05 (W2-E", "original text 1.2"], [1001903, "WORKER-COUNT-1.3 2026-11-05 (W2-E)", "original text 1.3"]]) {
  const d = q1(w, "SELECT description d FROM agent_issues WHERE id = ?", id).d;
  ok(d.startsWith(orig) && d.split(tag).length === 2, "issue " + id + " keeps its text and gets the dated note once");
}
const dec = qa(w, "SELECT actor, predicted_outcome FROM decision_log");
ok(dec.length === 1 && /^session:W2-E/.test(dec[0].actor), "one decision row");
const pred = qa(w, "SELECT subject, op, value FROM decision_predictions");
ok(pred.length >= 1 && pred.some((p) => p.subject === "worker_count" && p.op === "<=" && p.value === 37), "the live parser reads worker_count <= 37", pred);

{ // replay
  const snap = () => JSON.stringify([qa(w, "SELECT service, kind, state, version, updated_at FROM service_registry ORDER BY service"), qa(w, "SELECT class, status, last_verdict, verify_probe FROM remediation_contracts ORDER BY class"), qa(w, "SELECT n, status, path, note, updated_at FROM transformation_levers ORDER BY n"), qa(w, "SELECT id, description FROM agent_issues ORDER BY id"), qa(w, "SELECT COUNT(*) c FROM decision_log")]);
  const s1 = snap();
  w.exec(sql);
  ok(snap() === s1, "a second apply changes nothing");
}
{ // a row that is not a live worker is left alone
  const x = world();
  x.prepare("UPDATE service_registry SET state = 'retired', updated_at = '2026-11-01T00:00:00Z' WHERE service = 'qnfo-model-eval'").run();
  x.exec(sql);
  ok(reg(x, "qnfo-model-eval").updated_at === "2026-11-01T00:00:00Z" && reg(x, "qnfo-model-eval").kind === "worker", "an already retired row keeps its kind and updated_at");
}
{ // rollback
  const r = world();
  const grab = () => JSON.stringify([qa(r, "SELECT service, kind, state, version, base_url, purpose, updated_at FROM service_registry ORDER BY service"), qa(r, "SELECT class, status, last_verdict, verify_probe, precondition, next_due_at FROM remediation_contracts ORDER BY class"), qa(r, "SELECT n, status, path, note, landed_at, updated_at FROM transformation_levers ORDER BY n"), qa(r, "SELECT id, description FROM agent_issues ORDER BY id")]);
  const fresh = grab();
  r.exec(sql);
  ok(grab() !== fresh, "(sanity) the migration changed something");
  r.exec(sql.split("\n").find((l) => l.startsWith("-- Rollback: ")).slice("-- Rollback: ".length));
  ok(grab() === fresh, "Rollback restores the registry row, the contracts (and removes the new one), the lever and the issue texts byte for byte");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
