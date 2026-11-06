// CODE-ONLY-OUTPUT-1: the standing rules that make output code must stay in CLAUDE.md.
import { readFileSync } from "node:fs";
const md = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");
const need = ["CODE-ONLY-OUTPUT-1", "DOC-IS-CODE-1", "SELF-AUDIT-1", "NO-STANDALONE-DOCS-1", "SDLC-OWN-1", "NEVER-STOP-1", "CLOSED-LOOPS-1"];
let fail = 0;
for (const id of need) if (!md.includes(id)) { console.log("FAIL CLAUDE.md lost rule " + id); fail++; }
if (!/Do the work in the turn it is identified/.test(md)) { console.log("FAIL CODE-ONLY-OUTPUT-1 lost its do-it-now line"); fail++; }
console.log("claude-md-rules: " + (need.length + 1 - fail) + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
