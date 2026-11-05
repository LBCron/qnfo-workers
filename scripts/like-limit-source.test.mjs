// LIKE-LIMIT-SOURCE-1 (2026-11-05): D1 refuses a LIKE or GLOB pattern longer than 50 bytes when the statement runs ("LIKE or GLOB pattern too complex"). On 2026-11-04 that one
// limit stopped v_cron_fault_due (cron-watch and blind-spot-audit failed on every run, 30 and 9 fails), contract issue-1001342 and, as stored SQL, the IAR-R1-live-doer playbook; the
// migration check (scripts/apply_migrations.py) sees a literal in a migration, but a statement written in worker or script source reaches D1 without passing it. This suite scans every
// live worker.js and every script for a static LIKE/GLOB literal over 50 bytes, so the next one fails in the pull request instead of in production. A pattern built at run time
// from a column ('%' || col || '%') cannot be seen statically: use instr() for anything that holds free text (EMAIL-TPG-LIKE-1 fixed the sender case).
// Directories with a RETIRED or FOLDED marker are not deployed and are skipped; so are the deployed-current mirrors (identical to worker.js) and test files.
// Output MUST contain "0 failed" on success.   node scripts/like-limit-source.test.mjs
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const LIMIT = 50;
let checks = 0, failures = 0;
const ok = (c, m, d) => { checks++; if (!c) { failures++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const PAT = /\b(?:LIKE|GLOB)\s+'((?:[^'\n\\]|'')*)'/gi;
export function longPatterns(text) {
  const out = [];
  for (const m of text.matchAll(PAT)) {
    const lit = m[1].split("''").join("'");
    const bytes = Buffer.byteLength(lit, "utf8");
    if (bytes > LIMIT) out.push({ line: text.slice(0, m.index).split("\n").length, bytes, lit: lit.slice(0, 70) });
  }
  return out;
}

// self-test of the scanner
ok(longPatterns("x LIKE 'abc%'").length === 0, "a short literal passes");
ok(longPatterns("WHERE t LIKE '" + "a".repeat(51) + "'").length === 1, "a 51-byte literal is found");
ok(longPatterns("WHERE t LIKE '" + "a".repeat(50) + "'").length === 0, "a 50-byte literal is allowed");
ok(longPatterns("WHERE t NOT GLOB '" + "é".repeat(30) + "'").length === 1, "the limit is bytes, not characters");

const skipDir = (d) => existsSync(join(root, d, "RETIRED")) || existsSync(join(root, d, "FOLDED"));
const files = [];
for (const d of readdirSync(root)) {
  const p = join(root, d);
  let st; try { st = statSync(p); } catch { continue; }
  if (!st.isDirectory() || d === "node_modules" || d === ".git" || d === "archive" || d === "docs" || d === "migrations" || d === "audits" || skipDir(d)) continue;
  for (const f of readdirSync(p)) {
    if (f === "deployed-current.worker.js" || /\.test\.(m?js)$/.test(f) || /_test\.py$/.test(f)) continue;
    if (/\.(js|mjs|py)$/.test(f)) files.push(join(p, f));
  }
}
ok(files.length > 300, "source files scanned", files.length);
const hits = [];
for (const f of files) {
  let text; try { text = readFileSync(f, "utf8"); } catch { continue; }
  for (const h of longPatterns(text)) hits.push(f.slice(root.length) + ":" + h.line + " " + h.bytes + "B " + h.lit);
}
ok(hits.length === 0, "no static LIKE/GLOB literal over " + LIMIT + " bytes in worker or script source (use instr() or a shorter prefix)", hits.slice(0, 8));

console.log(checks + " checks, " + failures + " failed");
process.exit(failures ? 1 : 0);
