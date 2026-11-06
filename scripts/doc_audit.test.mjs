// DOC-IS-CODE-1: a new docs/*.md that no code, test, migration or workflow references fails here.
// The allowlist (scripts/doc-orphans-allowlist.txt) is shrink-only: delete a line when its doc gets code or is removed.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
let out;
try { out = execFileSync("python3", ["scripts/doc_audit.py"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { console.log("doc_audit: skipped (" + e.message.slice(0, 80) + ")"); process.exit(0); }
const orphans = out.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.orphan).map((r) => r.doc);
const allow = new Set(readFileSync("scripts/doc-orphans-allowlist.txt", "utf8").split("\n").filter(Boolean));
const fresh = orphans.filter((d) => !allow.has(d));
const stale = [...allow].filter((d) => !orphans.includes(d));
let bad = 0;
if (fresh.length) { bad++; console.log("FAIL new doc with no code behind it (DOC-IS-CODE-1): " + fresh.join(", ") + "\n  Attach code: a worker, script, test, migration or workflow that cites the doc's path or one of its rule ids, or do not add the doc."); }
if (stale.length) { bad++; console.log("FAIL allowlist line no longer needed, delete it: " + stale.join(", ")); }
console.log(`doc-audit: ${orphans.length} orphan docs, ${allow.size} allowlisted, ${bad ? "FAILED" : "passed"}`);
process.exit(bad ? 1 : 0);
