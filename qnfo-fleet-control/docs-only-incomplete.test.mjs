// DOCS-ONLY-INCOMPLETE-1: the lane and the code loop send a documentation-only pull request back for implementation.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { hasCodeChanges } from "../scripts/code-delivery.mjs";
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "worker.js"), "utf8");
const a = src.indexOf("var CM_DOCS_ONLY_RE"), b = src.indexOf('__name(cmDocsOnly, "cmDocsOnly");');
const sb = { __name: () => {} };
vm.createContext(sb);
vm.runInContext(src.slice(a, b) + "\n__export = { cmDocsOnly };", sb);
const { cmDocsOnly } = sb.__export;
let fails = 0;
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
check(cmDocsOnly(["docs/X.md"], "").docs_only === true, "docs/*.md alone is docs-only");
check(cmDocsOnly(["CLAUDE.md", "docs/Y.md"], "").docs_only === true, "CLAUDE.md plus docs is docs-only");
check(cmDocsOnly(["docs/X.md", "migrations/a.sql"], "").docs_only === false, "a migration makes it code");
check(cmDocsOnly(["w/worker.js"], "").docs_only === false, "worker.js is code");
check(cmDocsOnly(["docs/PORTFOLIO.md"], "").docs_only === true, "generated docs still require code in their PR");
check(cmDocsOnly(["docs/X.md"], "x\nImplemented in: #5300").docs_only === true, "another PR does not satisfy this PR's DoD");
check(cmDocsOnly(["docs/X.md"], "docs-exempt: generated").docs_only === true, "prose cannot exempt a PR from code delivery");
check(cmDocsOnly([], "").docs_only === true, "an empty diff fails code delivery");
for (const files of [[], [{ filename: "report.json" }], [{ filename: "docs/sample.js" }], [{ filename: "scripts/fix.py" }], [{ filename: "w/worker.js", additions: 0, deletions: 0 }], [{ filename: ".github/workflows/check.yml", additions: 1, deletions: 0 }]]) {
  check(cmDocsOnly(files, "").docs_only === !hasCodeChanges(files), "fleet and lifecycle agree on " + JSON.stringify(files));
}
check(/cmOpenDecide[\s\S]{0,1600}cmDocsOnly\(g\.files/.test(src), "code loop checks before opening a PR");
check(/bhMergeDecide[\s\S]{0,2500}cmDocsOnly\(files, pr\.body\)/.test(src), "lane calls the check");
check(/var dod = cmDocsOnly\(g\.files, pr\.body\); if \(dod\.docs_only\) return refuse/.test(src), "code loop calls the check");
const openStart = src.indexOf("async function evOpenPr(");
const openEnd = src.indexOf('__name(evOpenPr, "evOpenPr");', openStart);
let writes = [], unchangedTree = true;
const opener = vm.createContext({
  b64encode: (text) => Buffer.from(text).toString("base64"),
  evApi: async (_env, method, path, body) => {
    if (method === "POST") writes.push({ path, body });
    const replies = {
      "/git/ref/heads/main": { object: { sha: "base" } },
      "/git/commits/base": { tree: { sha: "base-tree" } },
      "/git/blobs": { sha: "blob" }, "/git/trees": { sha: unchangedTree ? "base-tree" : "changed-tree" },
      "/git/commits": { sha: "commit" }, "/git/refs": {}, "/pulls": { number: 123 }
    };
    return { ok: true, status: 200, j: replies[path] };
  }
});
vm.runInContext(src.slice(openStart, openEnd), opener);
let result = await opener.evOpenPr({}, 1, "w", "w", "code", "Fix", "Refs #7");
check(!result.ok && /CODE-CHANGE-REQUIRED-1/.test(result.why) && !writes.some((w) => w.path === "/pulls"),
  "evolve never opens an unchanged-tree PR");
unchangedTree = false;
writes = [];
result = await opener.evOpenPr({}, 1, "w", "w", "changed code", "Fix", "Refs #7");
const opened = writes.find((w) => w.path === "/pulls");
check(result.ok && opened.body.body.includes("Definition of done (CODE-CHANGE-REQUIRED-1)") && opened.body.body.includes("Refs #7"),
  "evolve code PRs carry linkage and mandatory code-change DoD");
process.exit(fails ? 1 : 0);
