// BREACH-PLAYBOOK-TAINT-1 (2026-11-05): replays every statement in migrations/*.sql that writes breach_playbooks, in file-name order, into a scratch table and runs each ENABLED row
// through the production validator (bdValidateRule, sliced out of qnfo-fleet-control/worker.js). A playbook the doctor drops as tainted never acts and adds one taint-drop event per tick
// (doctor_taint_violations_24h); IAR-R1-live-doer (2026-11-02) carried a semicolon inside a string literal for three days before anything noticed, because its own test ran the
// validator but a failing test on main is only seen after the merge. This suite also refuses a LIKE/GLOB pattern over D1's 50 bytes in any playbook SQL (run-time "pattern too complex").
// Output MUST contain "0 failed" on success.   node migrations/breach-playbooks-validate.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

const here = (p) => new URL(p, import.meta.url);
const worker = readFileSync(here("../qnfo-fleet-control/worker.js"), "utf8");
const A = "// ---- BREACH-DOCTOR-1:BEGIN ----", B = "// ---- BREACH-DOCTOR-1:END ----";
const kw = worker.match(/^var __RT_WRITE_KW = \[[^\]]*\];$/m)[0];
const block = worker.slice(worker.indexOf(A), worker.indexOf(B));
const cx = vm.createContext({ Date, Number, String, parseInt, Math, JSON, Object, Array, RegExp, Error, Promise, isFinite, console: { error() {}, log() {} }, VERSION: "0.63.0-test", crypto: globalThis.crypto, TextEncoder, Uint8Array });
vm.runInContext(kw + "\n" + block + "\nthis.api = { bdValidateRule };", cx);
const api = cx.api;

let failures = 0, checks = 0;
const ok = (c, m, d) => { checks++; if (!c) { failures++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 500))); } };

// Split a migration into statements: ' strings ('' escapes), -- comments and ; terminators.
function statements(text) {
  const out = [];
  let cur = "", i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === "'") {
      let j = i + 1;
      for (;;) { const k = text.indexOf("'", j); if (k < 0) { j = n; break; } if (text[k + 1] === "'") { j = k + 2; continue; } j = k + 1; break; }
      cur += text.slice(i, j); i = j; continue;
    }
    if (ch === "-" && text[i + 1] === "-") { const k = text.indexOf("\n", i); i = k < 0 ? n : k; continue; }
    if (ch === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const files = readdirSync(here("./")).filter((f) => f.endsWith(".sql")).sort();
const db = new DatabaseSync(":memory:");
const baseSql = readFileSync(here("./2026-10-26-breach-doctor.sql"), "utf8");
const create = statements(baseSql).find((s) => /^CREATE TABLE (IF NOT EXISTS )?breach_playbooks\b/i.test(s));
ok(!!create, "the base migration creates breach_playbooks");
db.exec(create);
const WRITES = /^(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+"?breach_playbooks"?\b/i;
let replayed = 0, skipped = [];
for (const f of files) {
  const text = readFileSync(here("./" + f), "utf8");
  if (!/breach_playbooks/.test(text)) continue;
  for (const s of statements(text)) {
    if (!WRITES.test(s)) continue;
    try { db.exec(s); replayed++; } catch (e) { skipped.push(f + ": " + String(e.message).slice(0, 120)); }
  }
}
ok(replayed >= 10, "playbook statements replayed from the migrations", { replayed });
ok(skipped.length === 0, "every playbook statement replays on a bare breach_playbooks table (a subselect on another table would need a stub)", skipped.slice(0, 5));

const rows = db.prepare("SELECT * FROM breach_playbooks WHERE enabled = 1 ORDER BY rule_id").all();
ok(rows.length >= 20, "enabled playbooks after the replay", rows.length);
const LIKE = /\b(?:LIKE|GLOB)\s+('+)((?:[^']|'')*?)\1(?!')/gi;
for (const r of rows) {
  const v = api.bdValidateRule(r);
  ok(v.ok === true, "playbook " + r.rule_id + " passes the production validator (a tainted rule never acts)", v);
  for (const col of ["trigger_sql", "action_sql", "revert_sql", "verify_sql"]) {
    const text = String(r[col] || "");
    ok(text.indexOf(";") === -1, r.rule_id + "." + col + " holds no semicolon");
    for (const m of text.matchAll(LIKE)) {
      const bytes = new TextEncoder().encode(m[2]).length;
      ok(bytes <= 50, r.rule_id + "." + col + " LIKE/GLOB pattern is " + bytes + " bytes (D1 refuses over 50)", m[2].slice(0, 60));
    }
  }
}
const iar = rows.find((r) => r.rule_id === "IAR-R1-live-doer");
ok(iar && Number(iar.version) === 2, "IAR-R1-live-doer is at version 2 after 2026-11-05-iar-r1-live-doer-v2.sql", iar && iar.version);

console.log(checks + " checks, " + failures + " failed");
process.exit(failures ? 1 : 0);
