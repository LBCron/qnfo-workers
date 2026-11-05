// RM-TP-3-FOOTPRINT-TEARDOWN TP-3b offline suite: replays migrations/2026-11-04-c5-resilience-footprint-tp3b.sql on node:sqlite and checks the repository against what the migration and archive/ATTACH-WORKFLOWS-MANIFEST.md say.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, no LIKE pattern over 50 bytes, no trigger); lever 3.9 moves from session to landed once, lever 3.8 gains one note; the three filed issues carry a code-task, an anchor that
// occurs exactly once in the named file and a marker that is absent today; row 128 keeps its old evidence and stays partial; a replay changes nothing and the Rollback line restores every row; and, in the repository, the five deleted attach
// workflows are gone and nothing names them as a dependency, the three kept ones exist with a failed or rolled-back last result, the manifest agrees, their scripts and ci-status records (the rollback ids) stay, and every live worker
// directory still declares a charter pillar (lever 9).
// Output MUST contain "0 failed" on success.   node migrations/c5-resilience-footprint-tp3b.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const rd = (p) => readFileSync(join(here, p), "utf8");
const sql = rd("./2026-11-04-c5-resilience-footprint-tp3b.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the body deletes and drops nothing");
ok(!/CREATE\s+(TEMP\s+)?TRIGGER/i.test(body) && !/INSERT\s+(OR\s+\w+\s+)?INTO\s+metric_registry/i.test(body), "no trigger and no metric is registered (a breach on workflow count would send the code loop after CI)");
const likes = [...body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)].map((m) => m[1]);
ok(likes.every((p) => Buffer.byteLength(p) <= 50), "no LIKE pattern over 50 bytes (D1 rejects it)", likes);

const rollback = header.find((l) => /^-- Rollback:/.test(l)).replace(/^-- Rollback:\s*/, "");
const w = new DatabaseSync(":memory:");
w.exec(`CREATE TABLE transformation_levers (id INTEGER PRIMARY KEY AUTOINCREMENT, tp INTEGER, n INTEGER, key TEXT, status TEXT, note TEXT, landed_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT);`);
const N9 = "needs a session: a repo lever: not a single-file edit", N8 = "issue 2019 closed";
const EVID = "measured 2026-10-06: 42 live, 51 RETIRED/FOLDED dirs | exit: worker_count <= 24, d1 <= 8, workflows <= 25";
w.prepare("INSERT INTO transformation_levers (tp, n, key, status, note) VALUES (3, 9, 'charter-pillar-on-every-toml', 'session', ?)").run(N9);
w.prepare("INSERT INTO transformation_levers (tp, n, key, status, note, landed_at) VALUES (3, 8, 'archive-and-appliers', 'landed', ?, '2026-10-12T15:00:40.960Z')").run(N8);
w.prepare("INSERT INTO transformation_levers (tp, n, key, status, note) VALUES (3, 6, 'd1-ten-to-eight', 'pending', '')").run();
w.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (128, 'RM-TP-3-FOOTPRINT-TEARDOWN', 'docs/TRANSFORMATION-PROGRAM.md T3', 'partial', ?)").run(EVID);
const one = (q, ...a) => w.prepare(q).get(...a);
const snap = () => JSON.stringify([w.prepare("SELECT * FROM transformation_levers").all(), w.prepare("SELECT title, description FROM agent_issues").all(), w.prepare("SELECT * FROM roadmap_implementation").all()]);

w.exec(sql);
const l9 = one("SELECT status, note, landed_at FROM transformation_levers WHERE tp = 3 AND n = 9");
ok(l9.status === "landed" && l9.landed_at && /^C5-RESILIENCE:/.test(l9.note) && /check C6/.test(l9.note), "T3 lever 9 is landed with its evidence", l9);
const l8 = one("SELECT status, note FROM transformation_levers WHERE tp = 3 AND n = 8");
ok(l8.status === "landed" && l8.note.startsWith(N8) && l8.note.includes("C5-RESILIENCE-TP3B") && /TP-3D-ARCHIVE-DEAD-DIRS-1/.test(l8.note), "T3 lever 8 keeps its note and says which half is open", l8);
ok(one("SELECT status FROM transformation_levers WHERE tp = 3 AND n = 6").status === "pending", "the D1 lever is not marked as done (it is filed, not built)");

const issues = w.prepare("SELECT * FROM agent_issues ORDER BY id").all();
ok(issues.length === 3 && issues.every((i) => i.source === "session:c5-resilience" && i.status === "open" && i.category === "code" && /^ROADMAP-1: QNFO\.INFRA TP-3[BCD]-/.test(i.title)), "three open ROADMAP-1 code issues are filed", issues.map((i) => i.title.slice(0, 60)));
for (const i of issues) {
  const d = i.description;
  const path = (/code-task: repo=qnfo-workers path=(\S+)/.exec(d) || [])[1];
  const anchor = (/\ncode-anchor: (.*)\n/.exec(d) || [])[1];
  const probe = (/\ncode-probe: (\{.*\})/.exec(d) || [])[1];
  ok(path && anchor && probe && /charter pillar core/.test(d) && /Prediction:/.test(d), "issue carries pillar, prediction, code-task, code-anchor and code-probe", i.title.slice(0, 60));
  const file = readFileSync(join(root, path), "utf8");
  ok(file.split(anchor).length - 1 === 1, "the anchor occurs exactly once in " + path, anchor);
  const marker = JSON.parse(probe);
  ok(marker.paths[0] === path && /^TP-3[BCD]-/.test(marker.contains) && d.includes(marker.contains) && !file.includes(marker.contains), "the closing marker is named in the issue and absent from the file today", marker);
}
const d1issue = issues.find((i) => /TP-3C-D1-FOLD-1/.test(i.title)).description;
ok(/0458a344-090d-4264-a0e0-c95d7fa237f3/.test(d1issue) && /D1-SPLIT/.test(d1issue) && /ops audit trail|ops_ai_tool/.test(d1issue), "the D1 issue names the database, the opposite D1-SPLIT direction and the usage check");
const r = one("SELECT status, evidence FROM roadmap_implementation WHERE id = 128");
ok(r.status === "partial" && r.evidence.startsWith(EVID) && r.evidence.includes("C5-RESILIENCE-128") && /REMAINING/.test(r.evidence) && /1001901 to 1001908/.test(r.evidence), "row 128 stays partial, keeps its evidence and names what remains and who owns the workers", r.status);
ok(!/\b(done|complete|verified)\b/i.test(r.evidence.replace(/is done \(TP-3a/g, "")) || /REMAINING/.test(r.evidence), "row 128 does not claim completion");

const before = snap();
w.exec(sql);
ok(before === snap(), "a replay changes nothing");
w.exec(rollback);
const l9b = one("SELECT status, note, landed_at FROM transformation_levers WHERE tp = 3 AND n = 9");
ok(l9b.status === "session" && l9b.note === N9 && l9b.landed_at === null, "the Rollback line restores lever 9");
ok(one("SELECT note FROM transformation_levers WHERE tp = 3 AND n = 8").note === N8, "the Rollback line restores lever 8 exactly");
ok(one("SELECT COUNT(*) n FROM agent_issues").n === 0, "the Rollback line removes the three issues");
ok(one("SELECT evidence FROM roadmap_implementation WHERE id = 128").evidence === EVID, "the Rollback line restores row 128 exactly");

// the repository agrees with the migration and the manifest
const wf = join(root, ".github", "workflows");
const gone = ["attach-jobs-q08-route", "attach-me-q08-route", "attach-mind-q08-route", "attach-watch-q08-route", "attach-travel-host", "attach-lifecycle-custom-domain"]; // the last one joined in TP-3B-ATTACH-1 (2026-11-05)
const kept = ["attach-ask-qwav-route", "attach-surface-routes"];
for (const g of gone) {
  ok(!existsSync(join(wf, g + ".yml")), "workflow deleted: " + g);
  ok(existsSync(join(root, "scripts", g + ".py")), "its script stays: " + g);
  ok(existsSync(join(root, "ci-status", g + ".json")), "its ci-status record (the route ids that roll the route back) stays: " + g);
}
for (const k of kept) {
  ok(existsSync(join(wf, k + ".yml")), "workflow kept: " + k);
  const st = JSON.parse(readFileSync(join(root, "ci-status", k + ".json"), "utf8"));
  ok(st.status === "failed" || JSON.stringify(st).includes('"rolled_back": true') || JSON.stringify(st).includes('"rolled_back":true'), "its last recorded result is not ok: " + k, { status: st.status });
}
const others = readdirSync(wf).filter((f) => f.endsWith(".yml")).map((f) => [f, readFileSync(join(wf, f), "utf8")]);
for (const g of gone) {
  const refs = others.filter(([, t]) => new RegExp("(workflow_run[\\s\\S]{0,200}|uses:\\s*\\./\\.github/workflows/|gh workflow run\\s+)" + g).test(t)).map(([f]) => f);
  ok(refs.length === 0, "no workflow depends on " + g, refs);
}
const man = rd("../archive/ATTACH-WORKFLOWS-MANIFEST.md");
const rows = man.split("\n").filter((l) => /^\| attach-/.test(l));
ok(rows.length === 8, "the manifest has one row per attach workflow", rows.length);
for (const g of gone) ok(rows.some((l) => l.startsWith("| " + g + " ") && /\| delete \|$/.test(l)), "manifest verdict is delete: " + g);
for (const k of kept) ok(rows.some((l) => l.startsWith("| " + k + " ") && /\| keep: /.test(l)), "manifest verdict is keep: " + k);
ok(/delete 6, keep 2/.test(man), "the manifest counts delete 6, keep 2 (TP-3B-ATTACH-1 retired attach-lifecycle-custom-domain)");
ok(!/attach-(jobs|me|mind|watch)-q08-route, |attach-travel-host,/.test(rd("../docs/MAIN-PUSH-POLICY.md")), "docs/MAIN-PUSH-POLICY.md no longer lists the deleted workflows as main-pushers");

// lever 9 stays true: every live worker directory declares a charter pillar
const live = readdirSync(root).filter((d) => !d.startsWith(".") && statSync(join(root, d)).isDirectory() && existsSync(join(root, d, "wrangler.toml")) && !existsSync(join(root, d, "RETIRED")) && !existsSync(join(root, d, "FOLDED")));
const missing = live.filter((d) => !/^\s*#\s*charter-pillar:\s*[a-z-]+/m.test(readFileSync(join(root, d, "wrangler.toml"), "utf8")));
ok(live.length >= 20 && missing.length === 0, "every live worker directory declares # charter-pillar: (" + live.length + " live)", missing);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
