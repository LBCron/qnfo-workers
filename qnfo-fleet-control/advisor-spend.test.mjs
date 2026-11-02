// ADVISOR-SPEND-1 (qnfo-fleet-control 0.4.109): the 20-minute advisor reuses its advice while its finding set is unchanged,
// and counts an issue as filed only when the insert wrote a row.
// Run: node qnfo-fleet-control/advisor-spend.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const block = src.slice(src.indexOf("// ---- ADVISOR-SPEND-1:BEGIN"), src.indexOf("// ---- ADVISOR-SPEND-1:END"));
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(block + "\n__export = { advisorFindingSig, advisorReuse, ADVISOR_REUSE_MS };", sandbox);
const { advisorFindingSig, advisorReuse, ADVISOR_REUSE_MS } = sandbox.__export;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };

const backlog = { title: "OPEN-ISSUES-BACKLOG", detail: "58 open agent_issues" };
const degraded = { title: "MODEL-DEGRADED kimi-k2.6,glm-5.3-flash", detail: "degraded: kimi-k2.6,glm-5.3-flash" };
const sig1 = advisorFindingSig([backlog]);
const sig2 = advisorFindingSig([degraded, backlog]);
ok(sig1 === "OPEN-ISSUES-BACKLOG", "S1 the signature is the finding titles");
ok(sig2 === advisorFindingSig([backlog, degraded]), "S2 the signature does not depend on finding order");
ok(advisorFindingSig([{ title: "OPEN-ISSUES-BACKLOG", detail: "59 open agent_issues" }]) === sig1, "S3 a changed detail (the backlog count) is the same finding");
ok(sig2 !== sig1, "S4 a new finding changes the signature");
ok(advisorFindingSig([]) === "" && advisorFindingSig(null) === "", "S5 no findings, empty signature");

const now = Date.parse("2026-10-02T10:20:00Z");
const prior = { prior_suggestion: "Owner: qnfo-kaizen ...", prior_sig: sig1, prior_advice_ts: "2026-10-02T09:40:00Z" };
ok(advisorReuse(prior, sig1, now) === true, "R1 same findings, advice 40 minutes old: reuse (no model call)");
ok(advisorReuse(prior, sig2, now) === false, "R2 a new finding asks the models again");
ok(advisorReuse(Object.assign({}, prior, { prior_advice_ts: new Date(now - ADVISOR_REUSE_MS).toISOString() }), sig1, now) === false, "R3 advice a day old is asked again even when nothing changed");
ok(advisorReuse(Object.assign({}, prior, { prior_advice_ts: new Date(now - ADVISOR_REUSE_MS + 60000).toISOString() }), sig1, now) === true, "R4 advice just under a day old is reused");
ok(advisorReuse(Object.assign({}, prior, { prior_suggestion: "" }), sig1, now) === false, "R5 no prior advice: ask");
ok(advisorReuse(Object.assign({}, prior, { prior_sig: null }), sig1, now) === false, "R6 a prior run without a signature (before 0.4.109): ask");
ok(advisorReuse(Object.assign({}, prior, { prior_advice_ts: "garbage" }), sig1, now) === false, "R7 an unreadable advice time: ask");
ok(advisorReuse(Object.assign({}, prior, { prior_advice_ts: "2026-10-02T11:00:00Z" }), sig1, now) === false, "R8 advice dated in the future: ask");
ok(advisorReuse(null, sig1, now) === false && advisorReuse(prior, "", now) === false, "R9 no feedback or no findings: no reuse");

// Wiring in runAudit (the advisor module is an IIFE; its wiring is asserted on the source).
const run = src.slice(src.indexOf("async function runAudit(env)"), src.indexOf('__name(runAudit, "runAudit")'));
ok(/const finding_sig = advisorFindingSig\(findings\);/.test(run), "W1 runAudit computes the finding signature");
ok(/if \(findings\.length && advisorReuse\(fb0, finding_sig, Date\.now\(\)\)\) \{\s*suggestion = fb0\.prior_suggestion;/.test(run), "W2 a reuse sets the prior advice and skips the model branch");
ok(/\} else if \(findings\.length && env\.AI\) \{/.test(run), "W3 the model branch runs only when advice is not reused");
ok(run.indexOf("advisorReuse(") < run.indexOf("advisorProposal("), "W4 the reuse check comes before the proposal call");
ok(/if \(ins && ins\.meta && ins\.meta\.changes === 0\) refile_ignored\+\+;\s*else filed\+\+;/.test(run), "W5 filed counts only an insert that wrote a row");
ok(/filed, refile_ignored, finding_sig, advice_ts, suggestion/.test(run), "W6 the audit event records the signature, the advice time and ignored refiles");
ok(/fb\.prior_sig = st\.finding_sig \|\| null;/.test(src) && /fb\.prior_advice_ts = st\.advice_ts \|\| null;/.test(src), "W7 collectFeedback reads the prior signature and advice time");
const versionMatch = src.match(/^var VERSION = "(\d+)\.(\d+)\.(\d+)(?:-[^"]*)?";/m);
const version = versionMatch && versionMatch.slice(1).map(Number);
ok(!!version && (version[0] > 0 || version[1] > 4 || (version[1] === 4 && version[2] >= 109)), "W8 VERSION is 0.4.109 or later (a minimum, never a pin: 0.5.0 and above pass)");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
