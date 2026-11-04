// LIST-CAP-1 (2026-11-04): the migration fallback listed migrations/ through the GitHub contents API, which returns at most 1000
// entries of a directory (the directory holds 1485 files), so the newest files were never seen. A worker lists a directory with the
// git tree API (up to 100000 entries, a `truncated` flag) and a recursive tree read says what it does when `truncated` is true.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
for (const d of readdirSync(ROOT, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const f = join(ROOT, d.name, "worker.js");
  if (!existsSync(f)) continue;
  const t = readFileSync(f, "utf8");
  if (/\/contents\/migrations\?/.test(t) || /\/contents\/migrations["'`]\s*[,)]/.test(t)) { console.error(f + ": lists migrations/ through the contents API (capped at 1000 entries); use /git/trees/main:migrations"); bad++; }
  if (/git\/trees\/[^"'`]*recursive=1/.test(t) && !/truncated/.test(t)) { console.error(f + ": reads a recursive git tree and never looks at `truncated`"); bad++; }
}
if (bad) process.exit(1);
console.log("ok");
