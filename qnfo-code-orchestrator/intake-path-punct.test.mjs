// INTAKE-PATH-PUNCT-1 (#7098): a code-task path written as "path=scripts/bp26_web.py;" was stored with its semicolon (ct_im1000518) and "qnfo-email/worker.js;" likewise
// (ct_im1000521), and the merge runner's scope match refused both (MERGE-SCOPE-AT-READ-1), parking them needs_human. The path token is the run of non-space characters, so
// intake now strips sentence punctuation and bracket or quote characters from both ends, for the first path, every companion path, and the anchor lookup that compares the
// issue's text with the stored path. Offline: the real cleanIntakePath source and the real INTAKE_MARK / INTAKE_MULTI patterns run in a vm.
// Output MUST contain "0 failed" on success.   node qnfo-code-orchestrator/intake-path-punct.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const grab = (re, what) => { const m = re.exec(src); ok(!!m, "found in worker.js: " + what); return m ? m[0] : ""; };
const code = [
  grab(/function cleanIntakePath\(p\) \{[^\n]*\}/, "cleanIntakePath"),
  grab(/const INTAKE_MARK = [^\n]*;/, "INTAKE_MARK"),
  grab(/const INTAKE_MULTI = [^\n]*;/, "INTAKE_MULTI")
].join("\n");
const ctx = vm.createContext({});
vm.runInContext(code + "\nthis.clean = cleanIntakePath; this.MARK = INTAKE_MARK; this.MULTI = INTAKE_MULTI;", ctx);
const clean = ctx.clean;

for (const [raw, want] of [
  ["scripts/bp26_web.py;", "scripts/bp26_web.py"], ["qnfo-email/worker.js;", "qnfo-email/worker.js"], ["qnfo-ai/worker.js.", "qnfo-ai/worker.js"],
  ["qnfo-ai/worker.js,", "qnfo-ai/worker.js"], ["(qnfo-ai/worker.js)", "qnfo-ai/worker.js"], ["`qnfo-ai/worker.js`", "qnfo-ai/worker.js"], ["\"docs/x.md\".", "docs/x.md"],
  ["scripts/x.py;;", "scripts/x.py"], ["scripts/x.py", "scripts/x.py"], ["migrations/2026-11-04-a.sql", "migrations/2026-11-04-a.sql"], ["qnfo-ai/deployed-current.worker.js", "qnfo-ai/deployed-current.worker.js"],
  [".github/workflows/a.yml", ".github/workflows/a.yml"], ["docs/a.b.md", "docs/a.b.md"], ["README.md", "README.md"], ["", ""], [null, ""], [undefined, ""]
]) ok(clean(raw) === want, "clean(" + JSON.stringify(raw) + ") = " + JSON.stringify(want), clean(raw));

// the real intake patterns on the real shapes
{
  const m = ctx.MARK.exec("Charter pillar: core.\ncode-task: repo=qnfo-workers path=scripts/bp26_web.py;\ncode-anchor: def main():");
  ok(m && m[2] === "scripts/bp26_web.py;" && clean(m[2]) === "scripts/bp26_web.py", "INTAKE_MARK captures the semicolon; cleaning removes it", m && m[2]);
  const mm = ctx.MULTI.exec("code-task: repo=qnfo-workers path=qnfo-ai/worker.js, path=qnfo-ai/deployed-current.worker.js;");
  const ps = mm && mm[2].trim().split(/[ \t]+/).map((x) => x.replace(/^path=/, "")).map(clean);
  ok(ps && ps[0] === "qnfo-ai/worker.js" && ps[1] === "qnfo-ai/deployed-current.worker.js", "a multi-path line is cleaned entry by entry", ps);
}

// the call sites
ok(/m\[2\] = cleanIntakePath\(m\[2\]\); extraPaths = extraPaths\.map\(cleanIntakePath\);/.test(src), "intake cleans the first path and every companion path before enqueueing");
ok(/cleanIntakePath\(hit\[2\]\) !== task\.path/.test(src), "the anchor lookup compares the cleaned issue path with the stored path");
ok(!/hit\[2\] !== task\.path/.test(src), "no raw comparison of the issue path remains");
const vv = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(src);
ok(vv && (Number(vv[2]) > 41 || (Number(vv[2]) === 41 && Number(vv[3]) >= 2)), "VERSION is at least 0.41.2", vv && vv[0]);
ok(src === readFileSync(join(here, "deployed-current.worker.js"), "utf8"), "worker.js and deployed-current.worker.js are identical");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
