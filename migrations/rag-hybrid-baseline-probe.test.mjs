// RAG-HYBRID-BASELINE-1 (agent_issues 1000640): the closing probes written by migrations/2026-11-05-rag-hybrid-baseline-probe.sql.
// Offline: the probe texts are read out of the migration and run on an in-memory SQLite with the production shapes of ask_evals and experiments.
// They must not pass on a state like the one before the rerank parameter was wired (ask_evals id 60: change rerank=true, no rerank_calls) and must pass on a real pair.
// Run: node migrations/rag-hybrid-baseline-probe.test.mjs   (Node 22; node:sqlite)
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "2026-11-05-rag-hybrid-baseline-probe.sql"), "utf8");
let failed = 0, passed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("FAIL " + m); } }

const probes = [...sql.matchAll(/SET verify_probe = '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
ok(probes.length === 2, "the migration sets two probes (the parent and the parity follow-up): " + probes.length);
const [pairProbe, parityProbe] = probes;
ok(!/;/.test(pairProbe + parityProbe), "no semicolon in a probe (PROBE-SEMICOLON-LINT-1)");
ok(pairProbe.includes("ASK-TUNE-R-%-rerank") && pairProbe.includes("LIKE 'rerank=%'"), "the parent probe reads the rerank pair and its experiment");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration headers are present");
ok(!/\bDELETE\b|\bDROP\b/i.test(sql.replace(/^--.*$/gm, "")), "the migration deletes and drops nothing");

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE ask_evals (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, kind TEXT NOT NULL, cfg TEXT, n INTEGER, score REAL, detail TEXT);" +
    "CREATE TABLE experiments (id TEXT PRIMARY KEY, name TEXT, hypothesis TEXT, kind TEXT, treatment TEXT, control TEXT, outcome_metric TEXT, baseline_date TEXT, status TEXT, owner TEXT, created_at TEXT);");
  return db;
}
const ev = (db, kind, detail) => db.prepare("INSERT INTO ask_evals (ts, kind, cfg, n, score, detail) VALUES ('2026-11-06T03:44:00Z', ?, 'c0', 16, 0.9, ?)").run(kind, JSON.stringify(detail));
const xp = (db, id, status) => db.prepare("INSERT INTO experiments (id, status) VALUES (?, ?)").run(id, status);
const run = (db, probe) => db.prepare(probe).get();

{
  const db = fixture();
  // The shape of the pair recorded on 2026-11-02 (ask_evals ids 59 and 60): no rerank_calls, because the flag did not reach corpusSearch.
  ev(db, "retrieval-champion", { mrr: 0.9531, recall: 1, mean_ms: 3507, n: 16 });
  ev(db, "retrieval-challenger", { change: "rerank=true", mrr: 0.9531, recall: 1, mean_ms: 802, n: 16 });
  xp(db, "ASK-TUNE-R-2026-11-02-rerank", "rejected");
  const r = run(db, pairProbe);
  ok(r.expected === "ok" && r.observed !== "ok", "a pair without rerank_calls does not satisfy the parent probe: " + r.observed);
}
{
  const db = fixture();
  ev(db, "retrieval-champion", { mrr: 0.95, recall: 1, mean_ms: 900, n: 16, rerank: true, rerank_calls: 16 });
  ev(db, "retrieval-challenger", { change: "rerank=false", mrr: 0.95, recall: 1, mean_ms: 700, n: 16, rerank: false, rerank_calls: 0 });
  let r = run(db, pairProbe);
  ok(r.observed !== "ok", "a recorded pair is not enough while its experiment has no decision: " + r.observed);
  xp(db, "ASK-TUNE-R-2026-11-06-rerank", "rejected");
  r = run(db, pairProbe);
  ok(r.expected === "ok" && r.observed === "ok", "a pair with mean_ms and rerank_calls on both arms and a decided experiment passes: " + r.observed);
}
{
  const db = fixture();
  // The challenger row of another key must not be read as the rerank pair, and a champion row far from the challenger is not its partner.
  ev(db, "retrieval-champion", { mrr: 0.95, mean_ms: 900, n: 16, rerank: true, rerank_calls: 16 });
  for (let i = 0; i < 4; i++) ev(db, "retrieval-challenger", { change: "max_sources=8", mrr: 0.95, mean_ms: 900, n: 16, rerank: true, rerank_calls: 16 });
  ev(db, "retrieval-challenger", { change: "rerank=false", mrr: 0.95, mean_ms: 700, n: 16, rerank: false, rerank_calls: 0 });
  xp(db, "ASK-TUNE-R-2026-11-06-rerank", "adopted");
  ok(run(db, pairProbe).observed !== "ok", "the challenger must follow its own champion row within three ids");
}
{
  const db = fixture();
  let r = run(db, parityProbe);
  ok(r.expected === "ok" && r.observed.startsWith("rerank pairs recorded: 0"), "the parity probe reports the pair count and the missing decision: " + r.observed);
  for (let i = 0; i < 3; i++) { ev(db, "retrieval-champion", { rerank: true, rerank_calls: 16, mean_ms: 1 }); ev(db, "retrieval-challenger", { change: "rerank=false", rerank: false, rerank_calls: 0, mean_ms: 1 }); }
  r = run(db, parityProbe);
  ok(r.observed.startsWith("rerank pairs recorded: 3"), "three pairs without a decision still do not pass: " + r.observed);
  xp(db, "RAG-RERANK-PARITY-1", "adopted");
  r = run(db, parityProbe);
  ok(r.expected === "ok" && r.observed === "ok", "three pairs and a decided RAG-RERANK-PARITY-1 experiment pass: " + r.observed);
}

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
