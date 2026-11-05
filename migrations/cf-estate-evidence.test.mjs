// CF-ESTATE-1 evidence suite: migrations/2026-11-05-c4-next-infra-roadmap-evidence.sql appends one text per roadmap row 610 to 614, once, keeps the status the loop set, and the Rollback
// removes exactly that text. Run: node --no-warnings migrations/cf-estate-evidence.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "2026-11-05-c4-next-infra-roadmap-evidence.sql"), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => new RegExp("^-- " + k + ": ").test(l)) || "").replace(new RegExp("^-- " + k + ": "), "");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit" && lines.filter((l) => /^-- Rollback: /.test(l)).length === 1, "header: APPLY-BY ci, DB qnfo-audit, one Rollback");
ok(!/^\s*(DELETE|DROP)\b/im.test(body) && !/CREATE\s+TRIGGER/i.test(body) && !/\bSET status\b/i.test(body), "no DELETE, DROP or trigger, and no status is set");

const KEYS = [[610, "WORK", "41946523643", "1001901"], [611, "PAGE", "41949283584", "1001933"], [612, "DNS", "41949290583", "1001934"], [613, "D1", "41946532220", "1001936"], [614, "R2", "41946485239", "1001937"]];
const auto = "auto (ROADMAP-SELF-MAINTAIN-1): work is mapped to the project (1 issues in issue_project_map)";
const mk = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, status TEXT, evidence TEXT)");
  for (const [id, k] of KEYS) db.prepare("INSERT INTO roadmap_implementation VALUES (?, ?, 'verified', ?)").run(id, "NEXT-QNFO.INFRA." + k, auto);
  db.prepare("INSERT INTO roadmap_implementation VALUES (999, 'NEXT-OTHER', 'verified', 'other')").run();
  return db;
};
const db = mk();
db.exec(sql);
const rows = db.prepare("SELECT id, status, evidence FROM roadmap_implementation ORDER BY id").all();
ok(rows.filter((r) => r.id !== 999).every((r) => r.status === "verified" && r.evidence.startsWith(auto + " CF-ESTATE-1 live 2026-11-05:")), "each row keeps its status and the loop text, then the appended evidence", rows.map((r) => r.evidence.slice(0, 40)));
ok(rows.find((r) => r.id === 999).evidence === "other", "another row is untouched");
for (const [id, k, run, issue] of KEYS) {
  const e = rows.find((r) => r.id === id).evidence;
  ok(e.includes("run " + run) && e.includes("agent_issues " + issue), k + " names its workflow run and its mapped issue", e.slice(-200));
}
db.exec(sql);
ok(db.prepare("SELECT evidence FROM roadmap_implementation WHERE id = 610").get().evidence.split("CF-ESTATE-1 live 2026-11-05:").length === 2, "a replay appends nothing more");
db.exec(hdr("Rollback"));
ok(db.prepare("SELECT COUNT(*) n FROM roadmap_implementation WHERE evidence = ?").get(auto).n === 5, "the Rollback restores the loop text exactly");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
