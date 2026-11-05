// W2-E next-fold issues offline suite: replays migrations/2026-11-05-w2e-fold-next.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, BACKUP named, nothing deleted in the body, LIKE patterns at most 50 bytes); WORKER-COUNT-1.9 (session-task, the kit dry-run line with
// no refusal) and WORKER-COUNT-1.10 (code-task with code-anchor and code-probe) are filed once as open ROADMAP-1 issues; the edit-near text of 1.9 and the code-anchor of 1.10 occur exactly once in their files and the
// closing marker of 1.10 is absent today; both name pillar core, a metric and a definition of done; a replay files nothing; the Rollback line removes both rows and only them; and the facts the issues state about
// the repository hold (qnfo-github-steward has the FOLDED-free wrangler.toml with one cron and one D1, personal-watch binds nothing).
// Not asserted against the repository on purpose: that an anchor occurs once or a marker is absent is true only until the filed work lands, and a suite pinning it turns main red the day the fix merges (PR 7726 did that to c5-resilience-ops-failover.test.mjs). The issue row carries the anchor and the probe; the consumer checks them live.
// Output MUST contain "0 failed" on success.   node migrations/w2e-fold-next.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const sql = rd("migrations/2026-11-05-w2e-fold-next.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1 && header.some((l) => /^-- BACKUP: agent_issues\s*$/.test(l)), "one Rollback line and the BACKUP header for its delete");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
const likes = [...sql.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)].map((m) => m[1]);
ok(likes.length === 2 && likes.every((p) => Buffer.byteLength(p) <= 50), "every LIKE pattern is at most 50 bytes (D1 rejects longer)", likes);

const w = new DatabaseSync(":memory:");
w.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER)");
w.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status) VALUES ('other issue', 'x', 'session:other', 'code', 'low', 'open')").run();
w.exec(sql);
const rows = w.prepare("SELECT * FROM agent_issues WHERE source = 'session:W2-E' ORDER BY id").all();
ok(rows.length === 2 && rows.every((r) => r.status === "open" && r.category === "code" && /^ROADMAP-1: QNFO\.INFRA WORKER-COUNT-1\.(9|10):/.test(r.title)), "two open ROADMAP-1 issues are filed", rows.map((r) => r.title.slice(0, 60)));
const [i9, i10] = rows;
ok(i9.description.startsWith("session-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js\nedit-near: worker_default2 as default\n"), "1.9 is a session-task with an edit-near line like the other fold issues");
ok(/--dry-run reports no refusal/.test(i9.description) && /charter pillar core/i.test(i9.description) && /worker_count -1/.test(i9.description) && /Definition of done:/.test(i9.description) && /UNBIND-VERIFY-RETRY-1/.test(i9.description) && /BINDING-INSTALL-FETCH-1/.test(i9.description), "1.9 carries the dry-run result, pillar, metric, definition of done and the two traps");
const d10 = i10.description;
const path = (/code-task: repo=qnfo-workers path=(\S+)/.exec(d10) || [])[1];
const anchor = (/\ncode-anchor: (.*)\n/.exec(d10) || [])[1];
const probe = (/\ncode-probe: (\{.*\})/.exec(d10) || [])[1];
ok(path === "scripts/fold_worker.py" && anchor && probe && d10.split("\n").pop().startsWith("code-probe: ") && /Prediction:/.test(d10) && /Closing marker:/.test(d10) && /charter pillar core/.test(d10), "1.10 carries pillar, prediction, marker, code-task, code-anchor and code-probe (the probe block is last)");
const marker = JSON.parse(probe);
ok(marker.paths[0] === path && marker.contains === "FOLD-HOST-ROUTE-1" && d10.includes(marker.contains) && d10.includes(anchor), "the closing marker and the code-anchor are named in the issue", marker);

ok(w.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 3, "the unrelated issue is untouched");
w.exec(sql);
ok(w.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 3, "a replay files nothing");
w.exec(sql.split("\n").find((l) => l.startsWith("-- Rollback: ")).slice("-- Rollback: ".length));
const left = w.prepare("SELECT title FROM agent_issues").all();
ok(left.length === 1 && left[0].title === "other issue", "the Rollback line removes both rows and only them", left);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
