// W2-B YT-6 code-done offline suite: replays migrations/2026-11-05-w2b-yt6-code-done.sql on node:sqlite and checks that the issue no longer carries a code-task line the code loop would parse, keeps its code-probe
// line, is untouched otherwise, and that a second run changes nothing. No live state is read. Output MUST contain "0 failed" on success.   node migrations/w2b-yt6-code-done.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../migrations/2026-11-05-w2b-yt6-code-done.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "header opts in");
ok(/^-- CAUSE-MAPPED: /m.test(sql) && !/INTO metric_registry/i.test(sql), "registers no metric, says so");
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE agent_issues(id INTEGER PRIMARY KEY, title TEXT, status TEXT, description TEXT, updated_at INTEGER)");
const before = "Pillar reach, project YT.SHORTS, roadmap YT-6. Doer: code loop.\ncode-task: repo=qnfo-workers path=qnfo-youtube-shorts/worker.js\ncode-probe: {\"paths\": [\"qnfo-youtube-shorts/worker.js\"], \"contains\": \"averageViewDuration\"}\n\nCODE-TASK-MERGE-RUNNER-1: code task ct_w04kcuw6lsucwa was refused by the merge runner";
db.prepare("INSERT INTO agent_issues VALUES (1000597, 'YT-6', 'open', ?, 1)").run(before);
db.prepare("INSERT INTO agent_issues VALUES (1001978, 'YT-VOICE-RETRY-1', 'open', 'code-task: repo=qnfo-workers path=qnfo-youtube-shorts/worker.js\ncode-anchor: function ttsEngine(attempts) {', 1)").run();
db.exec(body);
const row = db.prepare("SELECT description d, status s, updated_at u FROM agent_issues WHERE id = 1000597").get();
ok(!/^code-task:/m.test(row.d) && !/code-task: repo=/.test(row.d), "no line the code loop parses as a code task is left");
ok(/^code-done \(W2-B 2026-11-05\)/m.test(row.d) && /1002003/.test(row.d) && /human_actions 233/.test(row.d), "the replacement says where the remaining step lives");
ok(/^code-probe: \{"paths": \["qnfo-youtube-shorts\/worker\.js"\], "contains": "averageViewDuration"\}$/m.test(row.d), "the code-probe line is kept");
ok(/CODE-TASK-MERGE-RUNNER-1: code task ct_w04kcuw6lsucwa/.test(row.d), "the refusal history is kept");
ok(row.s === "open" && row.u > 1, "the issue stays open and is marked updated");
ok(/^code-task: repo=qnfo-workers path=qnfo-youtube-shorts\/worker\.js$/m.test(db.prepare("SELECT description d FROM agent_issues WHERE id = 1001978").get().d), "YT-VOICE-RETRY-1 keeps its code task: that one is a real worker.js change");
ok(db.prepare("SELECT description d FROM bak_20261105_w2b_yt6_issue WHERE id = 1000597").get().d === before, "the backup holds the original text");
db.exec(body);
ok(db.prepare("SELECT description d FROM agent_issues WHERE id = 1000597").get().d === row.d, "a second run changes nothing");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
