// CMD-RUN-HEARTBEAT-1 offline suite: the run ledger stamps progress per step and the abandonment sweep reads it. Run: node --no-warnings qnfo-agents/run-heartbeat.test.mjs
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./src/index.ts", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
ok(/ALTER TABLE runs ADD COLUMN last_beat_ms/.test(src) && /ALTER TABLE runs ADD COLUMN last_tool/.test(src), "both heartbeat columns are added with a guarded ALTER");
ok(/COALESCE\(last_beat_ms, created_ms\) < /.test(src), "the sweep measures the last step, falling back to the start");
ok(/onStepFinish: \(st: any\)/.test(src) && /UPDATE runs SET last_beat_ms/.test(src), "each finished step stamps the heartbeat");
ok(/\(last tool: /.test(src), "an abandoned run's error names its last tool");
ok(!/WHERE status IN \('queued', 'running'\) AND created_ms < \$\{cut\}`;\s*\n\s*\}/.test(src.split("onStart()")[1].slice(0, 1500)), "the old created_ms-only sweep is gone from onStart");
console.log("run-heartbeat: " + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
