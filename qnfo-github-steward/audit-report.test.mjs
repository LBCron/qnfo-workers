// FLEET-AUDIT-2026-10-30 report guard (#5529, pillar autonomy). The report is dated evidence: its figures are measurements of 2026-10-30 to 2026-11-01 and the text is not edited (the issue says so),
// so its SHA-256 is pinned here; a deliberate revision is a new dated file, not an edit. The report's section 4 table is the spec of GITHUB-STEWARD-2: each row has a counterpart in the steward's
// declared state, so a row cannot be dropped from the worker while the report still names it. The document index and the agent catalog list the report.
// Run: node --no-warnings qnfo-github-steward/audit-report.test.mjs   (exit 0 = all passed)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

const REPORT = "docs/FLEET-AUDIT-2026-10-30.md";
const report = read(REPORT);
ok(createHash("sha256").update(report).digest("hex") === "a2d6398aa535fdb58e7e32ca68fe7db411f6a44532140e777f3e3c111c270690", "the report text is unchanged (dated measurements are not edited; add a new dated file instead)");
ok(report.startsWith("# QNFO fleet audit, 2026-10-30\n") && report.endsWith("```\n"), "the report keeps its title and ends with its last reproduction block");
for (const h of ["## 0. Status on 2026-11-01", "## 4. Settings: the steward owns them", "## 5. For the fleet: PORTFOLIO-STANDARDS-1", "## 5b. Failure modes with no entry in the `failure_modes` registry", "## 6. Reproduce"]) ok(report.includes("\n" + h + "\n"), "section present: " + h);
ok(!/ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|AKIA[0-9A-Z]{8,}|cfat_[A-Za-z0-9]{8,}|BEGIN (RSA |EC )?PRIVATE KEY/.test(report), "the report holds no credential-shaped string (it is public)");

// the section 4 table -> the steward's declared state
const worker = read("qnfo-github-steward/worker.js");
const sec4 = report.slice(report.indexOf("## 4. Settings: the steward owns them"), report.indexOf("## 5. For the fleet"));
const rows = sec4.split("\n").filter((l) => /^\| /.test(l) && !/^\|---/.test(l) && !/^\| Setting /.test(l));
ok(rows.length === 7, "section 4 lists seven undeclared settings", rows.length);
const counterpart = [
  [/organisation `default_workflow_permissions`/, ["/orgs/\" + ORG + \"/actions/permissions/workflow", "org_actions_workflow"]],
  [/repository `default_workflow_permissions`/, ["DESIRED_WORKFLOW_PERMS", "default_workflow_permissions: \"read\""]],
  [/repository `can_approve_pull_request_reviews`/, ["can_approve_pull_request_reviews: false", "\"QNFO/qnfo-workers\": { can_approve_pull_request_reviews: true }"]],
  [/fork repositories, Actions/, ["fork_actions", "{ enabled: false }"]],
  [/fork repositories, code scanning/, ["fork_code_scanning", "code-scanning/default-setup", "not-configured"]],
  [/secret scanning and push protection/, ["secret_scanning_push_protection", "security_and_analysis"]],
  [/organisation website/, ["DESIRED_ORG_BLOG = \"https://qnfo.org\"", "org_blog"]],
];
for (const [re, needles] of counterpart) {
  const row = rows.find((r) => re.test(r));
  ok(!!row, "the report has the row " + re);
  ok(needles.every((n) => worker.includes(n)), "the steward declares it: " + re, needles.filter((n) => !worker.includes(n)));
}
ok(/ops_config steward_settings_enforce|steward_settings_enforce/.test(worker) && /dry/.test(worker), "the switch the report asks for (starts off or dry, read from GET /report) exists");

// the index and the catalog list the report
ok(read("docs/INDEX.md").includes("docs/FLEET-AUDIT-2026-10-30.md"), "docs/INDEX.md lists the report");
const catalog = JSON.parse(read("docs/agent-catalog.json"));
const flat = JSON.stringify(catalog);
ok(flat.includes("docs/FLEET-AUDIT-2026-10-30.md"), "docs/agent-catalog.json lists the report");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
