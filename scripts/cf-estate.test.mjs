// CF-ESTATE-1: runs scripts/cf_estate_test.py (python3, stdlib, no network, no token) from the suite runner, because the python script tests are listed one by one in
// deploy-gate.yml and this one needs no workflow edit (the ATTACH-MIND-LOCK-1 pattern). It also checks that the workflow exposes exactly the actions the script implements.
// Run: node --no-warnings scripts/cf-estate.test.mjs   -> prints "N passed, 0 failed"
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + String(x).slice(0, 800) : "")); } };
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const r = spawnSync("python3", ["-I", here("./cf_estate_test.py")], { encoding: "utf8" });
ok(r.status === 0, "the python suite exits 0", (r.stdout || "") + (r.stderr || ""));
ok(/\b\d+ passed, 0 failed/.test(r.stdout || ""), "the python suite prints 'N passed, 0 failed'", r.stdout);

const script = readFileSync(here("./cf_estate.py"), "utf8");
const wf = readFileSync(here("../.github/workflows/cf-estate.yml"), "utf8");
const actions = [...script.matchAll(/^ACTIONS = \(([^)]*)\)/gm)][0][1].match(/"[a-z0-9-]+"/g).map((s) => s.slice(1, -1)).filter((a) => a !== "doc-check");
ok(actions.length === 5, "five live actions (one per QNFO.INFRA project)", actions);
for (const a of actions) ok(wf.includes("- " + a), "the workflow offers " + a);
ok(/workflow_dispatch/.test(wf) && !/^\s+(push|pull_request|schedule):/m.test(wf), "dispatch only: no push, pull_request or schedule trigger (a report must not add a PR check or a run storm)");
ok(/permissions:\s*\n\s+contents: read/.test(wf), "the workflow token is read-only");
const writes = [...script.matchAll(/api\("(PUT|PATCH|DELETE)"/g)];
ok(writes.length === 0, "cf_estate.py has no PUT, PATCH or DELETE call: it never writes to Cloudflare", writes.map((w) => w[0]));
const posts = [...script.matchAll(/api\("POST", ([^,]+),/g)].map((m) => m[1]);
ok(posts.length === 2 && posts.some((p) => p.includes("graphql")) && posts.some((p) => p.includes("/query")), "the only POSTs are the GraphQL read and the D1 read query", posts);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
