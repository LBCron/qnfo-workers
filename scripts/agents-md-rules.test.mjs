// CODE-ONLY-OUTPUT-1 (vendor-neutral half): AGENTS.md is read by Copilot, Kimi, Codex and Claude Code, so the
// rules that make output code must stay in it. The CLAUDE.md half is scripts/claude-md-rules.test.mjs.
import { readFileSync } from "node:fs";
const md = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
const need = ["CODE-ONLY-OUTPUT-1", "CLOSE-OWN-LOOPS-1", "CLOSED-LOOPS-1", "NO-STANDALONE-DOCS-1", "SDLC-OWN-1"];
let fail = 0;
for (const id of need) if (!md.includes(id)) { console.log("FAIL AGENTS.md lost rule " + id); fail++; }
if (!/The first thing after a request is the tool call/.test(md)) { console.log("FAIL CODE-ONLY-OUTPUT-1 lost its do-it-now line"); fail++; }
if (!/never a deliverable/.test(md)) { console.log("FAIL AGENTS.md lost the no-documents rule"); fail++; }
console.log("agents-md-rules: " + (need.length + 2 - fail) + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
