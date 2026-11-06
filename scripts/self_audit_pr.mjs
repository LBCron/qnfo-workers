// SELF-AUDIT-1 deterministic gate (owner directive 2026-11-06): a PR body must show the work was checked against real
// output and must name one gap the author was not thinking about, with a doer or a filed issue. The text rule in
// CLAUDE.md is not enforced by prose; this check is. Also rejects a docs-only PR (NO-STANDALONE-DOCS-1).
//   node scripts/self_audit_pr.mjs --body body.txt --files files.txt
// pr-checks.yml skips bot authors (Copilot, Dependabot) before calling this.
import { readFileSync } from "node:fs";

const CODE = /\.(js|mjs|py|sql|ya?ml|toml|sh)$/;
const DOC = /\.(md|txt|pdf)$/i;

export function checkPr({ body = "", files = [] }) {
  const f = [];
  const parts = body.split(/^#{1,4}[ \t]*/m);
  const hit = parts.find((p) => /^self-audit[ \t]*(\r?\n|$)/i.test(p));
  const section = hit ? [hit] : null;
  const s = hit ? hit.replace(/^[^\n]*\n?/, "") : "";
  if (!section) f.push("missing a 'Self-audit' section");
  if (section && !/real output[:\s]/i.test(s)) f.push("Self-audit has no 'Real output:' line (what the live route, CI run or row actually showed)");
  if (section && !/not thinking about:[ \t]*[^\n]{12,}/i.test(s)) f.push("Self-audit has no 'Not thinking about:' line naming a concrete gap");
  if (section && !/\b(fixed|filed|issue\s*#\d+|code-task:)/i.test(s)) f.push("the named gap has no fix in this PR, issue number or code-task: line");
  const code = files.filter((x) => CODE.test(x));
  const docs = files.filter((x) => DOC.test(x));
  if (docs.length && !code.length) f.push(`docs-only PR (${docs.length} doc files, no code): a document ships with its code`);
  return { ok: f.length === 0, failures: f };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
  const body = readFileSync(a("--body"), "utf8");
  const files = readFileSync(a("--files"), "utf8").split("\n").filter(Boolean);
  const r = checkPr({ body, files });
  for (const x of r.failures) console.log("FAIL SELF-AUDIT-1: " + x);
  console.log(`self-audit-pr: ${r.ok ? "passed" : "FAILED"}`);
  process.exit(r.ok ? 0 : 1);
}
