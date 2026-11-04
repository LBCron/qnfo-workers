// MIGRATION-FALLBACK-1 (qnfo-cloud-ops 1.44.0): the Cloudflare-side migration applier, with a fake GitHub and a fake D1.
// Run: node qnfo-cloud-ops/migration-fallback.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { versionAtLeast } from "../scripts/version-at-least.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
let fails = 0;
const check = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (!c && x !== undefined ? " -- " + JSON.stringify(x) : "")); if (!c) fails++; };
const a = src.indexOf("// ---- MIGRATION-FALLBACK-1:BEGIN"), b = src.indexOf("// ---- MIGRATION-FALLBACK-1:END");
check(a > 0 && b > a, "the pure block is marked");
const sb = { Date, Math, Number, String, Array, Object, JSON, crypto, TextEncoder, console, WORKER_NAME: "qnfo-cloud-ops", __name: (f) => f };
vm.createContext(sb);
const jobStart = src.indexOf("async function mfSha256"), jobEnd = src.indexOf('__name(jobRepoSnapshot, "jobRepoSnapshot");');
vm.runInContext(src.slice(a, b) + src.slice(b, jobEnd) + "\n__x = { mfSplit, mfEligible, jobMigrationFallback, jobRepoSnapshot };", sb);
const { mfSplit, mfEligible, jobMigrationFallback, jobRepoSnapshot } = sb.__x;
sb.ghHeaders = () => ({});

const trig = "CREATE TRIGGER t AFTER INSERT ON x BEGIN INSERT INTO y VALUES (1); END;";
const s1 = mfSplit("-- c;\nCREATE TABLE a (v TEXT);\nINSERT INTO a VALUES ('x;y'), ('it''s');\n" + trig);
check(s1.length === 4 && s1[1].includes("'x;y'") && s1[1].includes("it''s"), "the splitter keeps ; inside quotes (a trigger body splits, which is why trigger files are never taken)", s1);
const ok = "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: x\nCREATE TABLE IF NOT EXISTS a (v TEXT);\nINSERT INTO a VALUES ('1');\n";
check(mfEligible(ok).ok && mfEligible(ok).statements.length === 2, "an opted-in plain file is eligible");
check(!mfEligible(ok.replace("APPLY-BY: ci", "APPLY-BY: none")).ok, "not opted in");
check(mfEligible(ok.replace("APPLY-BY: ci", "APPLY-BY: none (cf-fallback drill: only the Cloudflare fallback applies this)")).ok, "the drill header is taken (the runner declares it a skip)");
check(!mfEligible(ok.replace("qnfo-audit", "living-paper")).ok, "another database is left to the runner");
check(!mfEligible(ok + "DELETE FROM a;").ok && !mfEligible(ok + "DROP TABLE a;").ok, "destructive files keep the runner's backup check");
check(!mfEligible(ok + trig).ok, "trigger files keep the runner's depth canary");
check(!mfEligible(ok + "INSERT OR REPLACE INTO ops_config (key, value) VALUES ('a','b');").ok, "ops_config writes are left to the runner");
check(!mfEligible("-- APPLY-BY: ci\n-- DB: qnfo-audit\n").ok, "a file with no statements is not applied");

// --- the job against a fake GitHub and an in-memory D1 (node:sqlite)
let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch { DatabaseSync = null; }
if (!DatabaseSync) { console.log("SKIP job run: node:sqlite unavailable"); }
else {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE migration_runs (id INTEGER PRIMARY KEY, file TEXT, sha256 TEXT, commit_sha TEXT, db TEXT, status TEXT, statements TEXT, error TEXT, applied_by TEXT, applied_at TEXT DEFAULT (datetime('now')));CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, status TEXT, text TEXT, job TEXT);");
  const env = { AUDIT: { prepare(sql) { const st = db.prepare(sql); let args = []; const o = { bind(...x) { args = x; return o; }, async run() { st.run(...args); return {}; }, async all() { return { results: st.all(...args) }; } }; return o; } } };
  const now = Date.parse("2026-11-04T18:00:00Z");
  const files = {
    "2026-11-04-old-merge.sql": ok.replace("a (v", "fb_a (v").replace("INTO a", "INTO fb_a"),
    "2026-11-04-fresh.sql": ok.replace("a (v", "fb_b (v").replace("INTO a", "INTO fb_b"),
    "2026-11-04-bad.sql": ok.replace("a (v", "fb_c (v").replace("INSERT INTO a VALUES ('1')", "INSERT INTO nope_missing VALUES (1)"),
    "2026-11-04-trigger.sql": ok + trig,
    "2026-10-01-ancient.sql": ok,
  };
  const age = { "2026-11-04-old-merge.sql": "2026-11-04T16:00:00Z", "2026-11-04-fresh.sql": "2026-11-04T17:50:00Z", "2026-11-04-bad.sql": "2026-11-04T16:10:00Z", "2026-11-04-trigger.sql": "2026-11-04T16:00:00Z" };
  const doFetch = async (url, init) => {
    const u = new URL(url), p = decodeURIComponent(u.pathname);
    const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => "" });
    if (p.endsWith("/git/trees/main:migrations")) return json({ tree: Object.keys(files).map((path) => ({ path, type: "blob" })) });
    const m = /\/contents\/migrations\/(.+)$/.exec(p);
    if (m) return { ok: true, status: 200, text: async () => files[m[1]] };
    if (p.endsWith("/commits")) { const f = u.searchParams.get("path").split("/").pop(); return json([{ sha: "abc" + f.length, commit: { committer: { date: age[f] } } }]); }
    return { ok: false, status: 404 };
  };
  const rep = await jobMigrationFallback(env, { now, fetch: doFetch });
  check(rep.applied.length === 1 && rep.applied[0] === "2026-11-04-old-merge.sql", "a stale eligible file is applied", rep);
  check(db.prepare("SELECT COUNT(*) AS n FROM fb_a").get().n === 1, "its statements ran in the database");
  check(rep.skipped.some((x) => x.startsWith("2026-11-04-fresh.sql")), "a young merge is left to the runner first", rep.skipped);
  check(rep.skipped.some((x) => x.startsWith("2026-11-04-trigger.sql")), "a trigger file is left to the runner", rep.skipped);
  check(rep.failed.length === 1 && /statement 2/.test(rep.failed[0]), "a failing statement is recorded, not hidden", rep.failed);
  check(!rep.applied.concat(rep.failed).some((x) => x.includes("ancient")), "files older than two days are not touched");
  const rows = db.prepare("SELECT file, status, applied_by FROM migration_runs ORDER BY id").all();
  check(rows.length === 2 && rows.every((r) => r.applied_by === "cf:migration-fallback") && rows[0].status === "ok" && rows[1].status === "error", "ledger rows carry the fallback's name", rows);
  const rep2 = await jobMigrationFallback(env, { now, fetch: doFetch });
  check(rep2.applied.length === 0 && rep2.failed.length === 0, "a second tick applies nothing twice and does not retry the failed content", rep2);
  check(db.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'migration-fallback'").get().n === 1, "one event for the run that did work");

  // REPO-SNAPSHOT-1: snapshot to a fake R2 while GitHub works, then force every GitHub read to fail and apply from the snapshot.
  const store = new Map();
  const r2 = { async head(k) { const o = store.get(k); return o ? { customMetadata: o.m } : null; }, async put(k, v, o) { store.set(k, { v, m: o && o.customMetadata, uploaded: new Date("2026-11-04T16:00:00Z") }); },
    async get(k) { const o = store.get(k); return o ? { text: async () => o.v } : null; },
    async list({ prefix }) { return { objects: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, o]) => ({ key: k, uploaded: o.uploaded })) }; } };
  const blobFetch = async (url, init) => { const u = new URL(url), p = decodeURIComponent(u.pathname); const b = /\/git\/blobs\/(.+)$/.exec(p);
    if (b) return { ok: true, status: 200, text: async () => files[b[1].replace(/^sha-/, "")] };
    if (p.endsWith("/git/trees/main:migrations")) return { ok: true, status: 200, json: async () => ({ tree: Object.keys(files).map((path) => ({ path, type: "blob", sha: "sha-" + path })) }) };
    return { ok: false, status: 404 }; };
  const snap = await jobRepoSnapshot({}, { now, fetch: blobFetch, r2 });
  check(snap.copied === 4 && !store.has("repo-snapshot/migrations/2026-10-01-ancient.sql"), "the snapshot keeps the last week of migrations in R2", snap);
  const snap2 = await jobRepoSnapshot({}, { now, fetch: blobFetch, r2 });
  check(snap2.copied === 0 && snap2.have === 4, "an unchanged snapshot copies nothing", snap2);
  db.exec("DELETE FROM migration_runs; DROP TABLE fb_a; DROP TABLE IF EXISTS fb_c");
  const down = async () => { throw new Error("getaddrinfo ENOTFOUND api.github.com"); };
  const rep3 = await jobMigrationFallback(env, { now, fetch: down, r2 });
  check(rep3.source === "r2-snapshot" && rep3.applied.includes("2026-11-04-old-merge.sql"), "with every GitHub read failing, the fallback applies from the R2 snapshot", rep3);
  check(db.prepare("SELECT COUNT(*) AS n FROM migration_runs WHERE commit_sha = 'r2-snapshot' AND status = 'ok'").get().n >= 1, "the ledger row names the snapshot as its source");
}
check(/runs\.push\(jobMigrationFallback\(env\)/.test(src) && /"migration-fallback": jobMigrationFallback/.test(src), "the 10-minute tick and POST /run?job=migration-fallback run it");
check(versionAtLeast((/var VERSION = "([^"]+)"/.exec(src) || [])[1], "1.45.0"), "VERSION is at least 1.45.0");
console.log(fails ? fails + " failed" : "all passed");
if (fails) process.exit(1);
