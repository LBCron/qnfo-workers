// BACKLOG-LATEST-PASS-1 offline suite (qnfo-lifecycle 1.11.2, backlog member 2.0.7; charter pillar: autonomy; agent_issues 2222).
// Proves: the verified-remediation closure reads only the issue's LATEST remediation_verifications row and closes only when that row
// passed within LATEST_PASS_MAX_H hours, naming the row in close_evidence; an older pass behind a newer failure never closes an issue
// (2222 was closed at 02:01 UTC on 2026-10-14 from a 2026-10-09 pass while its 01:44 verification failed); the folded reference copy
// carries the same lines.
// Run: node qnfo-lifecycle/backlog-latest-pass.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const guest = readFileSync(new URL("../qnfo-backlog-exec/worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

for (const [name, s] of [["host", src], ["reference", guest]]) {
  const blk = s.slice(s.indexOf("// BACKLOG-LATEST-PASS-1 (2.0.7"), s.indexOf("await env.AUDIT.prepare(\"UPDATE agent_issues SET updated_at=?1 WHERE id=?2 AND status='open'\")"));
  ok(blk.length > 200, name + ": the rule is present", blk.length);
  ok(/FROM remediation_verifications WHERE issue_id=\?1 ORDER BY id DESC LIMIT 1"/.test(blk), name + ": it reads the latest verification row, whatever its verdict");
  ok(!/pass=1 AND verified_at >= datetime\('now','-7 days'\)/.test(s), name + ": the any-pass-in-7-days query is gone");
  ok(/Number\(vr\.pass\) === 1 && Number\.isFinite\(vrMs\) && now - vrMs <= LATEST_PASS_MAX_H \* 36e5/.test(blk), name + ": it closes only when that row passed and is fresh");
  ok(/await (?:closeIssue|closeIssueGuarded)\(env, row\.id, now, null, evidence\);/.test(blk) && /"BACKLOG-LATEST-PASS-1 latest verification #" \+ vr\.id \+ " pass at " \+ vr\.verified_at/.test(blk), name + ": the close evidence names the verification row");
  ok(/var LATEST_PASS_MAX_H = 3;/.test(s), name + ": the freshness window is 3 hours");
  ok(!/catch \(e\) \{\}\s*\n\s*const vrMs/.test(blk), name + ": a failed read is logged, not swallowed");
}

// the freshness parse the rule uses, on D1's two timestamp shapes
const parse = (v) => Date.parse(String(v || "").replace(" ", "T") + (/[zZ]$/.test(String(v || "")) ? "" : "Z"));
const now = Date.parse("2026-10-14T02:01:00Z"), H = 36e5;
ok(now - parse("2026-10-14 01:44:22") <= 3 * H, "a D1 datetime() stamp from 17 minutes earlier is fresh");
ok(now - parse("2026-10-09 18:00:31") > 3 * H, "the 2026-10-09 pass that closed 2222 is stale");
ok(now - parse("2026-10-14T00:30:00Z") <= 3 * H && now - parse("2026-10-13T22:00:00Z") > 3 * H, "ISO stamps parse the same way");
ok(!Number.isFinite(parse("")), "a missing stamp never counts as fresh");

const hv = (src.match(/^var VERSION = "(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
ok(hv.length === 3 && (hv[0] > 1 || (hv[0] === 1 && (hv[1] > 11 || (hv[1] === 11 && hv[2] >= 2)))), "host VERSION is at least 1.11.2", hv);
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
