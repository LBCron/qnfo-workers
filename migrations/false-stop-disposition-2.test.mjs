// FALSE-STOP-DISPOSITION-2 offline suite: replays migrations/2026-11-05-false-stop-disposition-2.sql on SQLite with the live shape of v_false_stop_candidates
// (read from qnfo-audit on 2026-11-05) and short fixtures with the shape of the replies the contract probe of issue-1001266 still named.
// Proves: a conditional offer whose reply also states a refusal with its reason ("requires a D1 `DELETE`", a quoted "no code is waiting" tool answer) stops being a
// candidate; a bare conditional offer stays a candidate and a hit; already counted hits of the two replies move to false_stop_hits_dispositioned and nothing else
// does; a reply with a menu or a question that only mentions D1 is not hidden by the new phrases; a second apply changes nothing; the contract probe reads 0.
// Run: node migrations/false-stop-disposition-2.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-false-stop-disposition-2.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const d = new DatabaseSync(":memory:");
d.exec(`
CREATE TABLE false_stop_phrases (phrase TEXT PRIMARY KEY, pattern_key TEXT NOT NULL, scope TEXT NOT NULL CHECK (scope IN ('reply', 'user', 'disposition')));
CREATE TABLE false_stop_hits (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), source TEXT NOT NULL, reply_id TEXT NOT NULL, reply_ts TEXT, pattern_key TEXT NOT NULL, phrase TEXT, excerpt TEXT, UNIQUE (source, reply_id, pattern_key));
CREATE TABLE v_agent_replies (source TEXT, reply_id TEXT, reply_ts TEXT, body TEXT);
CREATE TABLE owner_prompts (id TEXT, ts TEXT, prompt TEXT);
CREATE VIEW v_false_stop_candidates AS
SELECT r.source, r.reply_id, r.reply_ts, p.pattern_key, p.phrase,
       substr(r.body, MAX(1, instr(lower(r.body), p.phrase) - 60), 200) AS excerpt
  FROM v_agent_replies r JOIN false_stop_phrases p ON p.scope = 'reply'
       AND instr(replace(replace(lower(r.body), '"' || p.phrase || '"', ''), char(96) || p.phrase || char(96), ''), p.phrase) > 0
  WHERE NOT EXISTS (SELECT 1 FROM false_stop_phrases d WHERE d.scope = 'disposition' AND instr(lower(r.body), d.phrase) > 0)
UNION ALL
SELECT r.source, r.reply_id, r.reply_ts, 'report-as-question', '?', substr(r.body, MAX(1, length(r.body) - 200), 201)
  FROM v_agent_replies r
  WHERE substr(rtrim(r.body, ' ' || char(9) || char(10) || char(13)), -1) = '?'
    AND NOT EXISTS (SELECT 1 FROM false_stop_phrases d WHERE d.scope = 'disposition' AND instr(lower(r.body), d.phrase) > 0)
UNION ALL
SELECT 'owner_prompts.prompt', o.id, replace(substr(o.ts, 1, 19), 'T', ' '), p.pattern_key, p.phrase,
       substr(o.prompt, MAX(1, instr(lower(COALESCE(o.prompt, '')), p.phrase) - 60), 200)
  FROM owner_prompts o JOIN false_stop_phrases p ON p.scope = 'user' AND instr(lower(COALESCE(o.prompt, '')), p.phrase) > 0;
`);
const ph = d.prepare("INSERT INTO false_stop_phrases (phrase, pattern_key, scope) VALUES (?, ?, ?)");
for (const [p, k, s] of [["if you want", "conditional-offer", "reply"], ["let me know if", "conditional-offer", "reply"], ["alternatively", "menu", "reply"],
  ["refused", "disposition", "disposition"], ["waiting to be verified", "disposition", "disposition"], ["wasn't accepted", "disposition", "disposition"],
  ["has to be emailed first", "disposition", "disposition"], ["requires a d1 delete", "disposition", "disposition"]]) ph.run(p, k, s);

const rep = d.prepare("INSERT INTO v_agent_replies (source, reply_id, reply_ts, body) VALUES ('ops_ai_log', ?, '2026-11-02 17:00:00', ?)");
rep.run("ops-del", "The tokens remain stored in `emails`. If you want them actually gone, that requires a D1 `DELETE`, which is a destructive write I have not performed. Say the word and I will back up first.");
rep.run("ops-code", "The tool returned exactly this:\n\n```json\n{\"ok\":false,\"error\":\"no code is waiting; call owner_login for a new one\"}\n```\n\nIf you want owner access, a fresh code has to be requested.");
rep.run("ops-bare", "Done, filed in persistent memory. If you want it as a formal agent issue, that is a one-line addition.");
rep.run("ops-menu", "The D1 migration is ready. Alternatively the change could go through the worker; if you want the first, say so.");
const hit = d.prepare("INSERT INTO false_stop_hits (id, ts, source, reply_id, reply_ts, pattern_key, phrase, excerpt) VALUES (?, '2026-11-02T17:00:24Z', 'ops_ai_log', ?, '2026-11-02 17:00:00', 'conditional-offer', 'if you want', 'x')");
hit.run(16, "ops-del"); hit.run(21, "ops-code"); hit.run(35, "ops-bare"); hit.run(36, "ops-menu");

const cand = () => d.prepare("SELECT DISTINCT reply_id FROM v_false_stop_candidates WHERE pattern_key = 'conditional-offer' ORDER BY reply_id").all().map((r) => r.reply_id);
ok(JSON.stringify(cand()) === JSON.stringify(["ops-bare", "ops-code", "ops-del", "ops-menu"]), "before the migration the two refusal replies are conditional-offer candidates", cand());

// the contract probe of issue-1001266, as written in remediation_contracts
const probe = "WITH cand AS (SELECT c.reply_id, lower(v.body) AS b FROM v_false_stop_candidates c JOIN v_agent_replies v ON v.source = c.source AND v.reply_id = c.reply_id WHERE c.pattern_key = 'conditional-offer') SELECT '0' AS expected, CAST((SELECT count(*) FROM cand WHERE (instr(cand.b,'waiting to be verified') > 0 OR instr(cand.b,'wasn''t accepted') > 0 OR instr(cand.b,'has to be emailed first') > 0 OR instr(cand.b,'requires a d1') > 0 OR instr(cand.b,'no code is waiting') > 0) AND NOT EXISTS (SELECT 1 FROM false_stop_phrases d WHERE d.scope = 'disposition' AND instr(cand.b, lower(d.phrase)) > 0)) AS TEXT) AS observed";
ok(d.prepare(probe).get().observed === "2", "the probe reads 2 before the migration", d.prepare(probe).get());

d.exec(sql);
ok(JSON.stringify(cand()) === JSON.stringify(["ops-bare", "ops-menu"]), "after the migration only the bare offer and the menu reply remain candidates", cand());
const pr = d.prepare(probe).get();
ok(pr.expected === pr.observed && pr.observed === "0", "the contract probe reads 0 (expected equals observed)", pr);
const hits = d.prepare("SELECT id FROM false_stop_hits ORDER BY id").all().map((r) => r.id);
ok(JSON.stringify(hits) === JSON.stringify([35, 36]), "the bare offer and the menu hits stay counted", hits);
const moved = d.prepare("SELECT id, migration, disposition_phrases FROM false_stop_hits_dispositioned ORDER BY id").all();
ok(moved.length === 2 && moved[0].id === 16 && moved[1].id === 21 && moved.every((m) => m.migration === "FALSE-STOP-DISPOSITION-2"), "hits 16 and 21 moved with the migration tag", moved);
ok(/requires a d1 `delete`/.test(moved[0].disposition_phrases) && /no code is waiting/.test(moved[1].disposition_phrases), "each moved hit names the phrase that classed it", moved);
ok(d.prepare("SELECT COUNT(*) AS n FROM false_stop_phrases WHERE scope = 'disposition'").get().n === 7, "two phrases were added to the five seeded dispositions");

// narrowness: a reply that only mentions D1 is not a disposition
d.prepare("INSERT INTO v_agent_replies (source, reply_id, reply_ts, body) VALUES ('ops_ai_log', 'ops-d1', '2026-11-02 18:00:00', 'The change requires a D1 migration. Would you like me to proceed? Let me know if you want it.')").run();
ok(cand().includes("ops-d1"), "a reply that says 'requires a D1 migration' and offers is still a candidate", cand());

d.exec(sql);
ok(d.prepare("SELECT COUNT(*) AS n FROM false_stop_hits_dispositioned").get().n === 2 && d.prepare("SELECT COUNT(*) AS n FROM false_stop_phrases").get().n === 10, "a second apply changes nothing");
ok(/^-- BACKUP: false_stop_hits_dispositioned/m.test(sql) && /^-- Rollback: INSERT OR IGNORE INTO false_stop_hits/m.test(sql) && /^-- APPLY-BY: ci/m.test(sql) && /^-- DB: qnfo-audit/m.test(sql), "header carries APPLY-BY, DB, BACKUP and Rollback");
console.log("false-stop-disposition-2: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
