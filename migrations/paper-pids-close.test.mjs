// PAPER-PIDS-CLOSE-1 offline suite (migrations/2026-11-05-paper-pids-close.sql; GitHub #5694, #5695, #5577, #6620).
// The file replaces three closing probes with runner-https probes of behaviour that is already deployed, so this suite proves, without any live state:
//   * every new probe passes the consumer's own parser rules (allowed keys, https, allowlisted host, marker length) and re-arms its contract;
//   * each marker is text the real worker prints: the gateway for /api/papers/<slug> (sha256 field) and /papers/<slug>/cite.cff, qnfo-subscribers for /health
//     (worker name, VERSION at or above 1.5.5), so a later change of the JSON shape or the route fails here and not silently in production;
//   * the file is idempotent, files its successor issue exactly once, closes nothing by hand, and its Rollback line restores the three contracts and the roadmap row.
// Run: node migrations/paper-pids-close.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sql = readFileSync(join(here, "2026-11-05-paper-pids-close.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

// ---- the migration replayed on SQLite with the live layout of the touched tables
const mk = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, ts TEXT, last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER, next_due_at TEXT, max_items INTEGER, requires_container INTEGER, attempts INTEGER, deferred_since TEXT);
    CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE roadmap_proposals (id INTEGER PRIMARY KEY, program_code TEXT, request_instance TEXT, title TEXT, rationale TEXT, path TEXT, anchor_line TEXT, status TEXT, issue_id INTEGER, task_id TEXT, pr_url TEXT, outcome TEXT, deployed_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, triage_state TEXT, close_evidence TEXT);
    CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
    CREATE TABLE decision_predictions (decision_id INTEGER, kind TEXT, subject TEXT, op TEXT, value REAL, due_at TEXT, origin TEXT);
    CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'append-only'); END;
    CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'append-only'); END;
    CREATE TRIGGER decision_predictions_parse AFTER INSERT ON decision_log WHEN instr(COALESCE(NEW.predicted_outcome, ''), ' within ') > 0
      BEGIN INSERT INTO decision_predictions (decision_id, kind, subject, op, value, due_at, origin) VALUES (NEW.id, 'metric', 'x', '>', 0, 'x', 'parsed'); END;`);
  const old = "WITH l AS (SELECT 1) SELECT 'a' AS expected, 'b' AS observed FROM l";
  const ins = db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, last_verdict, attempts, next_due_at) VALUES (?, ?, 'ISSUE-PROBE-AGENT-1', 'VACUOUS-PROBE-V3-1: old', ?, 'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'probe-template-v3-generic', 'fail', 200, '2026-11-04 22:51:15')");
  ins.run("issue-1000646", 1000646, old); ins.run("issue-1000647", 1000647, old); ins.run("issue-1001408", 1001408, old);
  ins.run("issue-424242", 424242, old);
  db.exec("INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, status, evidence) VALUES (1698, 'RM-PAPER-PIDS-1', 'bp26-research-2026-10-28', 't', 'worker', 'planned', 'docs/x.md'), (1699, 'RM-OTHER', 's', 't', 'worker', 'planned', 'keep')");
  db.exec("INSERT INTO roadmap_proposals (id, issue_id, status, outcome) VALUES (1671, 1001408, 'building', 'merged')");
  return db;
};
const snap = (db) => JSON.stringify([
  db.prepare("SELECT class, verify_probe, verify_transport, action, module, status, attempts, last_verdict FROM remediation_contracts ORDER BY class").all(),
  db.prepare("SELECT * FROM roadmap_implementation ORDER BY id").all(),
  db.prepare("SELECT * FROM roadmap_proposals ORDER BY id").all(),
  db.prepare("SELECT title, status, priority FROM agent_issues ORDER BY id").all(),
  db.prepare("SELECT COUNT(*) n FROM decision_log").get(),
]);

const db = mk();
const before = snap(db);
db.exec(sql);
const after = snap(db);
ok(before !== after, "the migration changes the world");

// 1. the contracts
const rows = db.prepare("SELECT * FROM remediation_contracts WHERE class IN ('issue-1000646','issue-1000647','issue-1001408') ORDER BY class").all();
ok(rows.length === 3, "three contracts are re-armed", rows.map((r) => r.class));
ok(rows.every((r) => r.verify_transport === "runner-https" && r.status === "active" && r.last_verdict === null && r.attempts === 0 && r.deferred_since === null && !!r.next_due_at), "each is runner-https, active, with a clean verdict and attempts");
ok(rows.every((r) => !/VACUOUS-PROBE-V3-1/.test(r.action)), "the placeholder action text is gone");
ok(db.prepare("SELECT verify_probe, last_verdict FROM remediation_contracts WHERE class = 'issue-424242'").get().last_verdict === "fail", "another issue's contract is untouched");

// 2. the probes obey the consumer's parser (scripts/remediation_consumer.py parse_https_probe / host_allowed)
const src = readFileSync(join(root, "scripts", "remediation_consumer.py"), "utf8");
const hosts = (/HTTPS_HOSTS = \(([^)]*)\)/.exec(src) || ["", ""])[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
const allowedKeys = new Set(["url", "status", "contains", "absent", "min_version", "max_ms", "redirect_to"]);
const probes = {};
for (const r of rows) {
  let p = null; try { p = JSON.parse(r.verify_probe); } catch (e) { /* reported below */ }
  ok(p && Object.keys(p).every((k) => allowedKeys.has(k)), r.class + ": only keys the consumer accepts", r.verify_probe);
  const u = new URL(p.url);
  ok(u.protocol === "https:" && hosts.some((h) => u.hostname === h || u.hostname.endsWith("." + h)), r.class + ": https and an allowlisted host", u.hostname);
  ok(p.status === 200 && (!p.contains || (p.contains.length > 0 && p.contains.length <= 200)) && (!p.absent || p.absent.length <= 200), r.class + ": status 200 and bounded markers");
  probes[r.class] = p;
}
ok(probes["issue-1000646"].url === "https://papers.qnfo.org/api/papers/scale-invariant-physics" && probes["issue-1000647"].url === "https://papers.qnfo.org/papers/scale-invariant-physics/cite.cff" && probes["issue-1001408"].url === "https://qnfo-subscribers.q08.workers.dev/health", "each probe reads the surface its issue is about");
ok(probes["issue-1001408"].min_version === "1.5.5", "the digest probe gates on the release that added the forward link (1.5.5)");

// 3. each marker is printed by the real worker (stubbed stores, no network)
const CUR = "# Title\n\nCurrent body, version 2.0.\n";
const prow = { slug: "alpha", title: "Alpha", authors: '["Rowan Brad Quni-Gudzinas"]', abstract: "Abs", created_at: "2026-07-01 00:00:00", updated_at: "2026-10-01 00:00:00", first_published_at: "2026-07-01", last_revised_at: "2026-10-01 00:00:00", version_semver: "2.0", version_count: 2, doi: null, version: "v2.0", language: "en", keywords: "[]", license: "CC-BY-4.0", body_md: CUR };
const stmt = (s) => { const st = { a: [], bind(...a) { st.a = a; return st; }, async all() { return { results: [] }; }, async first() { if (/COUNT/.test(s)) return { n: 1 }; return st.a[st.a.length - 1] === "alpha" ? prow : null; }, async run() { return {}; } }; return st; };
const genv = { LIVING_PAPER: { prepare: stmt }, DB: { prepare: stmt }, QNFO_BUCKET: { get: async () => null } };
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response("", { status: 404 });
const gw = (await import(pathToFileURL(join(root, "qnfo-gateway", "worker.js")).href)).default;
const get = async (path) => { const r = await gw.fetch(new Request("https://papers.qnfo.org" + path), genv, { waitUntil() {} }); return { s: r.status, t: await r.text(), h: r.headers }; };
let r = await get("/api/papers/alpha");
const sha = createHash("sha256").update(CUR).digest("hex");
ok(r.s === 200 && r.t.includes(probes["issue-1000646"].contains) && !r.t.toLowerCase().includes(probes["issue-1000646"].absent.toLowerCase()), "/api/papers/<slug> prints the sha256 marker and never a null hash", r.t.slice(0, 200));
ok(JSON.parse(r.t).sha256 === sha, "and the hash is the sha256 of the body");
r = await get("/papers/alpha/v/2.0");
ok(r.s === 200 && r.h.get("X-Content-SHA256") === sha, "the immutable version URL carries the same hash in X-Content-SHA256");
r = await get("/papers/alpha/cite.cff");
ok(r.s === 200 && r.t.includes(probes["issue-1000647"].contains) && /yaml/.test(r.h.get("Content-Type")), "/papers/<slug>/cite.cff prints the CFF marker", r.t.slice(0, 120));
for (const [ext, ct] of [["bib", /bibtex/], ["csl.json", /csl\+json/]]) { r = await get("/papers/alpha/cite." + ext); ok(r.s === 200 && ct.test(r.h.get("Content-Type")), "/papers/<slug>/cite." + ext + " answers 200 with its media type", [r.s, r.h.get("Content-Type")]); }
globalThis.fetch = realFetch;
const sub = (await import(pathToFileURL(join(root, "qnfo-subscribers", "worker.js")).href)).default;
const senv = { AUDIT: { prepare: () => ({ first: async () => ({ c: 1, p: 0, total: 1 }), all: async () => ({ results: [] }), bind() { return this; } }) } };
const hr = await sub.fetch(new Request("https://qnfo-subscribers.q08.workers.dev/health"), senv, { waitUntil() {} });
const ht = await hr.text();
const core = (v) => (/^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(String(v)) || []).slice(1).map(Number);
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
ok(hr.status === 200 && ht.includes(probes["issue-1001408"].contains), "qnfo-subscribers /health prints the worker marker in compact JSON", ht.slice(0, 120));
ok(cmp(core(JSON.parse(ht).version), core(probes["issue-1001408"].min_version)) >= 0, "and its VERSION is at or above the probe's min_version", JSON.parse(ht).version);
ok(/lines\.push\(SITE \+ "\/\?utm_source=digest&utm_campaign=digest-forward"\);\s*lines\.push\(""\);\s*lines\.push\("Unsubscribe: "/.test(readFileSync(join(root, "qnfo-subscribers", "worker.js"), "utf8")), "digestText still prints the digest-forward link immediately before the Unsubscribe line");

// 4. the roadmap row, the proposal, the successor issue, the decision
ok(db.prepare("SELECT status FROM roadmap_implementation WHERE id = 1698").get().status === "verified" && db.prepare("SELECT verified_at FROM roadmap_implementation WHERE id = 1698").get().verified_at, "RM-1698 is verified with a time and evidence");
ok(db.prepare("SELECT status FROM roadmap_implementation WHERE id = 1699").get().status === "planned", "another roadmap row is untouched");
const rp = db.prepare("SELECT * FROM roadmap_proposals WHERE id = 1671").get();
ok(rp.status === "deployed" && rp.outcome === "merged and verified live" && /pull\/6621$/.test(rp.pr_url) && rp.deployed_at, "proposal 1671 is deployed with its pull request", rp);
const issues = db.prepare("SELECT * FROM agent_issues").all();
ok(issues.length === 1 && /^PAPER-PIDS-PIN-1:/.test(issues[0].title) && issues[0].status === "open", "exactly one successor issue is filed, open", issues.map((i) => i.title));
ok(/code-task: repo=qnfo-workers path=qnfo-gateway\/worker\.js\ncode-anchor: async function handlePaperVersion\(env, slug, version, head\) \{\ncode-probe: /.test(issues[0].description), "the successor carries a code-task, an anchor and a code-probe, each on its own line");
const gwSrc = readFileSync(join(root, "qnfo-gateway", "worker.js"), "utf8");
ok(gwSrc.split("async function handlePaperVersion(env, slug, version, head) {").length === 2, "the anchor occurs exactly once in qnfo-gateway/worker.js");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM decision_predictions").get().n === 0, "one decision_log row and no accidental prediction parse (no ' within ' in predicted_outcome)");
ok(db.prepare("SELECT COUNT(*) n FROM issue_triage").get().n === 0, "no issue is closed by hand (the consumer pass and the autoclose trigger close them)");

// 5. idempotent
db.exec(sql);
ok(snap(db) === after, "applying the file twice changes nothing more");

// 6. headers and rollback
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: bak_20261105_paper_pids_close$/m.test(sql), "the runner header lines are present");
ok(!/INSERT[^;]*INTO\s+metric_registry/i.test(sql), "no metric is registered (so no breach cause to map)");
const rollback = /^-- Rollback: (.*)$/m.exec(sql)[1];
db.exec(rollback);
const c0 = db.prepare("SELECT verify_probe, verify_transport, action, module FROM remediation_contracts WHERE class = 'issue-1000646'").get();
ok(c0.verify_transport === "d1-query" && /VACUOUS-PROBE-V3-1/.test(c0.action) && c0.module === "probe-template-v3-generic" && /^WITH l AS/.test(c0.verify_probe), "the Rollback line restores a contract", c0);
ok(db.prepare("SELECT status, evidence FROM roadmap_implementation WHERE id = 1698").get().status === "planned", "the Rollback line restores the roadmap row");
ok(db.prepare("SELECT status FROM roadmap_proposals WHERE id = 1671").get().status === "building" && db.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 0, "the Rollback line restores the proposal and removes the open successor");

console.log(pass + " passed, " + fail + " failed");
process.exitCode = fail ? 1 : 0;
