// RESEARCH-THROUGHPUT-1 (qnfo-research-exec 0.10.0, agent_issues 2175): N paper slots per round. Proves from the source:
// one in-flight snapshot per round is shared by every slot (slot k owns inflight[k], so no two slots advance one row); a
// free slot claims through claimNew (never run(), which would re-advance an in-flight row); a claim is guarded by
// status='queued' so racing slots cannot claim one row twice; width comes from ops_config research_parallel, capped,
// and 1 keeps the single-flight path. Run: node qnfo-research-exec/parallel-slots.test.mjs
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
const leased = src.slice(src.indexOf("async function runLeased("), src.indexOf("async function runLeased(") + 7000);
// 0.49.0 RESEARCH-TICK-ALLOWANCE-1: the round's width is roundWidth (the configured width, or what the tick allowance still buys).
// 0.16.0 AI-STAGE-ATTRIBUTION-2: every slot runs with its own attribution env (__attrSlotEnv), the same snapshot for all.
ok(/const inflight = \(await env\.QNFO_AUDIT\.prepare\(INFLIGHT_SQL\)\.bind\(roundWidth\)\.all\(\)\)\.results \|\| \[\];\s*round = await Promise\.all\(Array\.from\(\{ length: roundWidth \}, function\(_, k\) \{ return runSlot\(__attrSlotEnv\(env\), k, roundWidth, inflight\); \}\)\);/.test(leased), "one snapshot per round is passed to every slot");
ok(/round = \[await run\(env\)\];/.test(leased), "width 1 keeps the single-flight run()");
const slot = src.slice(src.indexOf("async function runSlot("), src.indexOf("async function claimNew("));
ok(/const row = inflight\[slot\];/.test(slot) && !/prepare\(INFLIGHT_SQL\)/.test(slot), "a slot reads its row from the shared snapshot, not its own query");
ok(/if \(inflight\.length >= width\) return \{ status: "ok", claimed: 0, slot \};\s*return Object\.assign\(await claimNew\(env\), \{ slot \}\);/.test(slot), "a free slot claims only below the width, through claimNew");
ok(!/await run\(env\)/.test(slot), "runSlot never calls run()");
const claim = src.slice(src.indexOf("async function claimNew("), src.indexOf("async function run(env)"));
ok(/WHERE id=\?3? AND id = \(" \+ RESEARCH_CLAIM_ID_SQL \+ "\) AND status='queued'/.test(claim) && /if \(!up \|\| !up\.meta \|\| !up\.meta\.changes\) return \{ status: "ok", claimed: 0 \};/.test(claim), "the fallback rechecks both the quota and status='queued'");
ok(/Math\.min\(n, RESEARCH_PARALLEL_MAX\)/.test(src) && /var RESEARCH_PARALLEL_MAX = 48;/.test(src) && /var RESEARCH_PARALLEL_DEFAULT = 2;/.test(src), "width is ops_config research_parallel, default 2, max 24 (SLA-DRAIN-2)");
ok(/let width = maxStages > 1 \? await researchParallel\(env\) : 1;/.test(leased), "the HTTP single-stage kick (maxStages 1) stays single-flight");
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
