// MODULE-SOURCE-SCOPE-1: mergeScopeWhy lets a worker's source module through, in step with qnfo-fleet-control cmScope.
import { readFileSync } from "node:fs";
import assert from "node:assert";
import vm from "node:vm";
const o = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const f = readFileSync(new URL("../qnfo-fleet-control/worker.js", import.meta.url), "utf8");
const sl = (s, a, b) => { const i = s.indexOf("\n" + a) + 1; return s.slice(i, s.indexOf("\n" + b, i)); };
const pd = 'const PLAN_DENY_WORKERS = ["qnfo-observability", "qnfo-autonomy-scorer"];';
const rs = /function repoSlug\([\s\S]*?\n}\n/.exec(o)[0];
const csd = /const CM_SCRIPT_DENY = [^;]*;|var CM_SCRIPT_DENY = [^;]*;/.exec(o)?.[0] || "";
const ctx = vm.createContext({});
vm.runInContext(pd + "\n" + rs + "\n" + csd + "\n" + sl(o, "function mergeScopeWhy(", "async function enqueue(") + "\nthis.f = mergeScopeWhy;", ctx);
const why = (p) => ctx.f("qnfo-workers", p);
assert.equal(why("personal-api/worker.js"), null, "single-file worker still in scope");
assert.equal(why("personal-api/companion.js"), null, "a worker's source module is in scope");
assert.equal(why("qnfo-fleet-dashboard/registry.js"), null);
for (const p of ["qnfo-observability/fleet.js", "personal-api/companion.test.mjs", "personal-api/inline-companion.mjs", "scripts/helper.js", "docs/x.js", "migrations/x.js", "personal-api/sub/x.js"]) assert.ok(why(p), p + " stays out of scope");
assert.ok(f.includes("MODULE-SOURCE-SCOPE-1") && o.includes("MODULE-SOURCE-SCOPE-1"));
console.log("ok");
