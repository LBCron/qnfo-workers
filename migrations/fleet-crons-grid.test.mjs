// FLEET-CRON-GRID-1: a migration dated 2026-11-05 or later must not write a fleet_crons cron whose minute field is off the 5-minute grid. fleet-exec ticks every 5 minutes (CRON-TICK-5M-1), cron-watch
// (CRON-WATCH-1, v_cron_faults) files one CRON-FAULT-1 issue for each row whose minute is not a multiple of 5, and scripts/cron_rate_guard.py reads wrangler.toml only, so before this test nothing looked at the
// minute of a fleet_crons row at review time (four sources on 2026-11-04/05: management-personas-b/-c, staff-roster, roadmap-self-maintain-*, and the qnfo-memory-mcp wrangler cron).
// It reads the value a statement WRITES (an INSERT's literals, an UPDATE's SET clause), never the literal an UPDATE matches in its WHERE clause, and never a comment. A file that already merged with an
// off-grid literal is named in ALLOW with the migration that repairs it (shrink-only: the entry must still be needed and its repair must exist).
// Run: node migrations/fleet-crons-grid.test.mjs
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const FROM_DATE = "2026-11-05";
const ALLOW = { "2026-11-05-roadmap-self-maintain-split.sql": "2026-11-05-families-ops-c.sql" };

function stripComments(text) { return text.split("\n").map((l) => l.replace(/^\s*--.*$/, "")).join("\n"); }
// split into statements on a semicolon outside single quotes
function statements(text) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") q = !q;
    if (c === ";" && !q) { out.push(cur); cur = ""; } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
// index of the first " WHERE " outside single quotes
function whereAt(s) {
  let q = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "'") q = !q;
    else if (!q && /^\s+WHERE\s/i.test(s.slice(i, i + 8))) return i;
  }
  return -1;
}
const CRON = /'([0-9*\/,\-]+) ([0-9*\/,\-?A-Za-z]+) ([0-9*\/,\-?A-Za-z]+) ([0-9*\/,\-?A-Za-z]+) ([0-9*\/,\-?A-Za-z#]+)'/g;
function minuteOnGrid(field) {
  return field.split(",").every((tok) => {
    if (tok === "*") return true;
    let m = /^\*\/(\d+)$/.exec(tok); if (m) return Number(m[1]) % 5 === 0;
    m = /^(\d+)$/.exec(tok); if (m) return Number(m[1]) % 5 === 0;
    m = /^(\d+)-(\d+)\/(\d+)$/.exec(tok); if (m) return Number(m[1]) % 5 === 0 && Number(m[3]) % 5 === 0;
    return false;
  });
}
// the cron expressions a file writes into fleet_crons
function written(text) {
  const out = [];
  for (const raw of statements(stripComments(text))) {
    const s = raw.trim();
    let part = null;
    if (/^INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?fleet_crons"?/i.test(s)) part = s;
    else if (/^UPDATE\s+(?:OR\s+\w+\s+)?"?fleet_crons"?\s+SET\b/i.test(s)) { const w = whereAt(s); part = w < 0 ? s : s.slice(0, w); }
    if (!part) continue;
    for (const m of part.matchAll(CRON)) out.push(m[0].slice(1, -1));
  }
  return out;
}
const offGrid = (text) => written(text).filter((e) => !minuteOnGrid(e.split(" ")[0]));

// ---- the scanner on fixtures
ok(offGrid("INSERT INTO fleet_crons (name, cron_expr, task_id) VALUES ('a', '37 * * * *', 't');").join() === "37 * * * *", "an INSERT at :37 is flagged");
ok(offGrid("INSERT OR IGNORE INTO fleet_crons (name, cron_expr, task_id) SELECT c.name, c.cron_expr, 't' FROM (SELECT 'x' AS name, '31 * * * *' AS cron_expr UNION ALL SELECT 'y', '35 * * * *') c;").join() === "31 * * * *", "a UNION ALL insert flags only the off-grid row");
ok(offGrid("UPDATE fleet_crons SET cron_expr = '45 * * * *' WHERE name = 'a' AND cron_expr = '42 * * * *';").length === 0, "an UPDATE that moves a cron onto the grid is not flagged for the literal it matches");
ok(offGrid("UPDATE fleet_crons SET cron_expr = '47 * * * *' WHERE name = 'a';").join() === "47 * * * *", "an UPDATE that moves a cron off the grid is flagged");
ok(offGrid("-- Rollback: UPDATE fleet_crons SET cron_expr = '42 * * * *' WHERE name = 'a'\nSELECT 1;").length === 0, "a comment is never read");
for (const e of ["0 * * * *", "*/5 * * * *", "*/10 * * * *", "0,30 * * * *", "5 3 * * 1", "55 23 * * *"]) ok(offGrid("INSERT INTO fleet_crons (cron_expr) VALUES ('" + e + "');").length === 0, e + " is on the grid");
for (const e of ["*/7 * * * *", "1 * * * *", "0,32 * * * *", "59 23 * * *"]) ok(offGrid("INSERT INTO fleet_crons (cron_expr) VALUES ('" + e + "');").length === 1, e + " is off the grid");
ok(offGrid("INSERT INTO fleet_crons (name, cron_expr) VALUES ('self-audit-every-6h', '30 */6 * * *');").length === 0, "a numeric minute with a stepped hour is on the grid");

// ---- the repository
const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}.*\.sql$/.test(f) && f.slice(0, 10) >= FROM_DATE).sort();
ok(files.length > 0, "the scan sees migrations dated " + FROM_DATE + " or later", files.length);
const bad = [];
for (const f of files) {
  const off = offGrid(readFileSync(join(dir, f), "utf8"));
  if (off.length && !ALLOW[f]) bad.push(f + ": " + off.join(", "));
}
ok(bad.length === 0, "no migration dated " + FROM_DATE + " or later writes an off-grid fleet_crons minute (move it to a multiple of 5, or name it in ALLOW with the migration that repairs it)", bad);
for (const [f, fix] of Object.entries(ALLOW)) {
  ok(existsSync(join(dir, f)) && offGrid(readFileSync(join(dir, f), "utf8")).length > 0, "ALLOW entry " + f + " is still needed (shrink-only: remove it once the file no longer writes an off-grid minute)");
  ok(existsSync(join(dir, fix)) && /UPDATE fleet_crons SET cron_expr/.test(readFileSync(join(dir, fix), "utf8")), "ALLOW entry " + f + " names a repairing migration that exists and moves the cron", fix);
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
