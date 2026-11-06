// REVIEW-GATE-TAGGED-TEMPLATE-1: a tagged-template SQL injection claim is dropped; a real one on a concatenated query is kept.
import { spawnSync } from "node:child_process";
const code = `
import sys, importlib.util
spec = importlib.util.spec_from_file_location("rg", "scripts/review_gate.py"); rg = importlib.util.module_from_spec(spec); spec.loader.exec_module(rg)
diff = "diff --git a/w/index.ts b/w/index.ts\\n--- a/w/index.ts\\n+++ b/w/index.ts\\n@@ -1 +1,2 @@\\n+this.sql\`UPDATE runs SET x = \${tc} WHERE id = \${id}\`\\n+db.exec(\\"SELECT \\" + name)\\n"
trig = "an attacker controls id or tc and updates arbitrary rows in the runs table"
tagged = {"severity":"High","title":"Unrestricted SQL update","file":"w/index.ts","evidence":"this.sql\`UPDATE runs SET x = \${tc} WHERE id = \${id}\`","trigger":trig,"fix":"Use parameterized queries to prevent SQL injection"}
concat = {"severity":"High","title":"SQL injection via concatenation","file":"w/index.ts","evidence":'db.exec("SELECT " + name)',"trigger":"name comes from the request and is concatenated into the statement text","fix":"Bind name as a parameter"}
out = rg.vet([tagged, concat], diff, "m")
print(len(out), out[0]["title"] if out else "")
`;
const r = spawnSync("python3", ["-I", "-c", code], { encoding: "utf8" });
let fail = 0;
if (r.status !== 0 || r.stdout.trim() !== "1 SQL injection via concatenation") { console.log("FAIL " + r.stdout + r.stderr); fail++; }
console.log("review-gate-tagged: " + (1 - fail) + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
