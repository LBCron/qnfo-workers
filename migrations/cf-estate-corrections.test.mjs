// CF-ESTATE-1 corrections offline suite: migrations/2026-11-05-c4-next-infra-corrections.sql appends one correction to each issue text it corrects and to the DNS roadmap row,
// once, and the Rollback removes exactly that text. Run: node --no-warnings migrations/cf-estate-corrections.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "2026-11-05-c4-next-infra-corrections.sql"), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => new RegExp("^-- " + k + ": ").test(l)) || "").replace(new RegExp("^-- " + k + ": "), "");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit" && lines.filter((l) => /^-- Rollback: /.test(l)).length === 1, "header: APPLY-BY ci, DB qnfo-audit, one Rollback");
ok(!/^\s*(DELETE|DROP)\b/im.test(body) && !/CREATE\s+TRIGGER/i.test(body), "no DELETE, DROP or trigger");

const mk = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, status TEXT, updated_at TEXT)");
  db.exec("CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, status TEXT, evidence TEXT)");
  for (const k of ["WORK", "PAGE", "DNS", "D1", "R2"]) db.prepare("INSERT INTO agent_issues (title, description, source, status) VALUES (?, ?, 'cf-estate-1', 'open')").run("ROADMAP-1: QNFO.INFRA." + k + " #1: x", "original " + k);
  db.prepare("INSERT INTO agent_issues (title, description, source, status) VALUES ('ROADMAP-1: QNFO.INFRA.DNS #1: x', 'other source', 'someone-else', 'open')").run();
  db.prepare("INSERT INTO roadmap_implementation VALUES (612, 'NEXT-QNFO.INFRA.DNS', 'partial', 'Deliverable (PR 7413, x).')").run();
  db.prepare("INSERT INTO roadmap_implementation VALUES (610, 'NEXT-QNFO.INFRA.WORK', 'partial', 'Deliverable (PR 7413, x).')").run();
  return db;
};
const db = mk();
db.exec(sql);
const d = Object.fromEntries(db.prepare("SELECT title, description FROM agent_issues WHERE source = 'cf-estate-1'").all().map((r) => [r.title.split(" ")[1], r.description]));
ok(d["QNFO.INFRA.WORK"].includes("CORRECTION 2026-11-05") && d["QNFO.INFRA.DNS"].includes("four of the twelve zones") && d["QNFO.INFRA.D1"].includes("was not measured"), "WORK, DNS and D1 issues carry their correction");
ok(d["QNFO.INFRA.PAGE"] === "original PAGE" && d["QNFO.INFRA.R2"] === "original R2", "PAGE and R2 are untouched");
ok(db.prepare("SELECT description FROM agent_issues WHERE source = 'someone-else'").get().description === "other source", "an issue of another source is untouched");
ok(db.prepare("SELECT evidence FROM roadmap_implementation WHERE id = 612").get().evidence.includes("four zones, not two") && db.prepare("SELECT evidence FROM roadmap_implementation WHERE id = 610").get().evidence === "Deliverable (PR 7413, x).", "only row 612 is corrected");
db.exec(sql);
ok(db.prepare("SELECT COUNT(*) n FROM agent_issues WHERE description LIKE '%CORRECTION 2026-11-05%'").get().n === 3 && (db.prepare("SELECT evidence FROM roadmap_implementation WHERE id = 612").get().evidence.match(/Correction 2026-11-05/g) || []).length === 1, "a replay appends nothing more");
const db2 = mk();
db2.prepare("UPDATE roadmap_implementation SET evidence = 'auto: mapped' WHERE id = 612").run();
db2.exec(sql);
ok(db2.prepare("SELECT evidence FROM roadmap_implementation WHERE id = 612").get().evidence === "auto: mapped", "a row the loop already rewrote is left alone");
db.exec(hdr("Rollback"));
ok(db.prepare("SELECT description FROM agent_issues WHERE title LIKE '%DNS%' AND source = 'cf-estate-1'").get().description === "original DNS" && db.prepare("SELECT evidence FROM roadmap_implementation WHERE id = 612").get().evidence === "Deliverable (PR 7413, x).", "the Rollback restores the original texts exactly");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
