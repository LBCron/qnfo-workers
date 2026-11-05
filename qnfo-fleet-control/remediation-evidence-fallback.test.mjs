// SLA-AND-PATHS-1 path B conformance (2026-10-17, owner directive: every step carries an SLA and more than one path to
// its definition of done). remediation_verifications has seven triggers; when an INSERT there fails, the row must still
// land in the trigger-free sink remediation_evidence, or the evidence - and the autoclose/reopen it feeds - is lost.
// Run: node qnfo-fleet-control/remediation-evidence-fallback.test.mjs
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };

// 1. the helper exists and writes the sink, not the trigger-bearing table
const helper = src.slice(src.indexOf("async function verificationFallback("), src.indexOf("async function remediationContractsTick("));
ok(helper.length > 0, "verificationFallback is defined");
ok(/INSERT INTO remediation_evidence/.test(helper), "the fallback writes remediation_evidence");
ok(!/INSERT INTO remediation_verifications/.test(helper), "the fallback does not write the trigger-bearing table");
ok(/path\)\s*VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, 'B:evidence-table'\)/.test(helper), "the sink row is labelled path B");
ok(/return true;/.test(helper) && /catch \(eFB\)/.test(helper), "a second failure is caught and logged, never thrown");

// 2. every insert into remediation_verifications is followed by a fall-through in its catch
const inserts = (src.match(/INSERT INTO remediation_verifications/g) || []).length;
const calls = (src.match(/await verificationFallback\(/g) || []).length;
// MONITORING-PASS-1 (agent_issues 1000744): the count is derived, not a literal. A new verification writer (the monitoring pass) adds an insert and must add its fall-through
// in the same patch; the literal 3 made that a two-file patch the code loop could not verify ("patch too large"). The three original writers stay pinned in section 3.
ok(inserts >= 3, "at least the three original inserts into remediation_verifications remain (got " + inserts + ")");
ok(calls === inserts, "each insert has exactly one fall-through call in its catch (inserts " + inserts + ", calls " + calls + ")");

// 3. the three call sites carry the same verdict the primary write intended
ok(/verificationFallback\(db, c\.issue_id, c\.class, probeUrl, transport, "", "\(no expected value\)", 0,/.test(src), "vacuous insert falls through as pass 0");
ok(/verificationFallback\(db, c\.issue_id, c\.class, probeUrl, transport, es, "\(null\)", 0,/.test(src), "null-observed insert falls through as pass 0");
ok(/verificationFallback\(db, c\.issue_id, c\.class, probeUrl, transport, es, os, passed,/.test(src), "normal insert falls through with its computed pass");

// 4. a swallowed failure is no longer silent for the previously empty catch
ok(!/\} catch \(eV\) \{\}/.test(src), "the vacuous catch is no longer empty");

console.log("remediation-evidence-fallback: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
