// W2-F-C offline suite: replays migrations/2026-11-05-w2f-c-secrets-store-allow.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped in the body); ops_config gets the secrets_store_bind_allow key EMPTY
// (a value already set is never overwritten), both issues get one dated note, one decision_log row is written, a replay changes nothing, and the Rollback line puts it back.
// It does not read live state. Output MUST contain "0 failed" on success.   node migrations/w2f-c-secrets-store-allow.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-w2f-c-secrets-store-allow.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one single-line Rollback header");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");
ok(!/metric_registry/i.test(body), "registers no metric, so no breach cause is owed");
ok(!/secret_value|CF_API_TOKEN\s*=|Bearer\s/i.test(sql), "no secret value in the file");

function world(allow) {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);`);
  w.prepare("INSERT INTO agent_issues (id, title, description) VALUES (1001969, 't1', 'd1'), (1001981, 't2', 'd2'), (5, 'other', 'untouched')").run();
  if (allow !== undefined) w.prepare("INSERT INTO ops_config (key, value) VALUES ('secrets_store_bind_allow', ?)").run(allow);
  return w;
}
const snap = (w) => JSON.stringify({ c: w.prepare("SELECT key, value, note FROM ops_config ORDER BY key").all(), a: w.prepare("SELECT id, description FROM agent_issues ORDER BY id").all(), d: w.prepare("SELECT actor, action FROM decision_log").all() });

{
  const w = world();
  w.exec(sql);
  const c = w.prepare("SELECT value, note FROM ops_config WHERE key = 'secrets_store_bind_allow'").get();
  ok(c && c.value === "" && /empty|Empty/.test(c.note), "the allowlist key is created empty", c);
  const a = Object.fromEntries(w.prepare("SELECT id, description FROM agent_issues").all().map((r) => [r.id, r.description]));
  ok(a[1001969].startsWith("d1\nSECRETS-STORE-BIND-1 2026-11-05: ") && a[1001981].startsWith("d2\nSECRETS-STORE-BIND-1 2026-11-05: ") && a[5] === "untouched", "both issues get one dated note, others are untouched");
  ok(w.prepare("SELECT count(*) n FROM decision_log WHERE actor = 'session:w2f-c'").get().n === 1, "one decision_log row");
  const s1 = snap(w);
  w.exec(sql);
  ok(snap(w) === s1, "a replay changes nothing");
  w.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
  const r = w.prepare("SELECT count(*) n FROM ops_config").get().n;
  const back = Object.fromEntries(w.prepare("SELECT id, description FROM agent_issues").all().map((x) => [x.id, x.description]));
  ok(r === 0 && back[1001969] === "d1" && back[1001981] === "d2", "the Rollback line removes the empty key and the notes", { r, back });
}
{
  const w = world("CF_API_TOKEN");
  w.exec(sql);
  ok(w.prepare("SELECT value FROM ops_config WHERE key = 'secrets_store_bind_allow'").get().value === "CF_API_TOKEN", "an allowlist already set is never overwritten");
  w.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
  ok(w.prepare("SELECT count(*) n FROM ops_config").get().n === 1, "the Rollback keeps a non-empty allowlist");
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
