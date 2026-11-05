// W2-E fold follow-ups offline suite: replays migrations/2026-11-05-w2e-fold-followups.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, BACKUP named for the Rollback delete, nothing deleted in the body, no LIKE pattern over 50 bytes); two open ROADMAP-1 code issues are filed once
// (a replay files nothing, an open twin blocks a second row), each carrying pillar, prediction, closing marker, code-task, code-anchor and code-probe; the code-anchor occurs exactly once in the named file and the closing
// marker is absent from it today (so the issue cannot close before the work); the Rollback line removes both rows and no other row.
// Not asserted against the repository on purpose: that an anchor occurs once or a marker is absent is true only until the filed work lands, and a suite pinning it turns main red the day the fix merges (PR 7726 did that to c5-resilience-ops-failover.test.mjs). The issue row carries the anchor and the probe; the consumer checks them live.
// Output MUST contain "0 failed" on success.   node migrations/w2e-fold-followups.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const sql = rd("migrations/2026-11-05-w2e-fold-followups.sql");
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
ok(rows.length === 2 && rows.every((r) => r.status === "open" && r.category === "code" && /^ROADMAP-1: QNFO\.INFRA (UNBIND-VERIFY-RETRY-1|BINDING-INSTALL-FETCH-1):/.test(r.title)), "two open ROADMAP-1 code issues are filed", rows.map((r) => r.title.slice(0, 60)));
for (const r of rows) {
  const d = r.description;
  const path = (/code-task: repo=qnfo-workers path=(\S+)/.exec(d) || [])[1];
  const anchor = (/\ncode-anchor: (.*)\n/.exec(d) || [])[1];
  const probe = (/\ncode-probe: (\{.*\})/.exec(d) || [])[1];
  ok(path && anchor && probe && /charter pillar core/.test(d) && /Prediction:/.test(d) && /Closing marker:/.test(d) && d.split("\n").pop().startsWith("code-probe: "),"issue carries pillar, prediction, marker, code-task, code-anchor and code-probe (the probe block is last)", r.title.slice(0, 70));
  const marker = JSON.parse(probe);
  ok(marker.paths[0] === path && /^(UNBIND-VERIFY-RETRY-1|BINDING-INSTALL-FETCH-1)$/.test(marker.contains) && d.includes(marker.contains) && d.includes(anchor), "the closing marker and the code-anchor are named in the issue", marker);
}
ok(w.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 3, "the unrelated issue is untouched");
w.exec(sql);
ok(w.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 3, "a replay files nothing");
w.exec(sql.split("\n").find((l) => l.startsWith("-- Rollback: ")).slice("-- Rollback: ".length));
const left = w.prepare("SELECT title FROM agent_issues").all();
ok(left.length === 1 && left[0].title === "other issue", "the Rollback line removes both rows and only them", left);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
