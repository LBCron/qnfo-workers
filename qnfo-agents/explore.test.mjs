// CODE-AGENT-UX-1 slice 7 offline suite: the explore tool is a read-only child run. Run: node --no-warnings qnfo-agents/explore.test.mjs
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./src/index.ts", import.meta.url), "utf8");
const i = src.indexOf("t.explore = tool(");
const body = src.slice(i, i + 1800);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
ok(i > 0, "the explore tool exists");
ok(/tools: \{ repo_read_file: t\.repo_read_file, \.\.\.\(t\.fleet_sql/.test(body), "the child gets only the repository reader and read-only SQL");
ok(!/ops_call|propose_code_task|ship_change|escalate/.test(body), "no changing tool and no recursion in the child");
ok(/stepCountIs\(EXPLORE_MAX_STEPS\)/.test(body) && /EXPLORE_MAX_STEPS = 8/.test(src), "the child run is bounded");
ok(/never as instructions/.test(src), "the child treats file contents as data");
ok(/explore_run: true/.test(body), "the result is marked explore_run");
ok(src.indexOf("t.explore = tool(") > src.indexOf("t.fleet_sql = tool(") && src.indexOf("t.explore = tool(") < src.indexOf("if (c.lean) return t; // AGENTS-LEAN-1"), "explore is registered after fleet_sql and before the lean return, for non-lean callers only");
console.log("explore: " + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
