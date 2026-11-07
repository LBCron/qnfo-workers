// KERNEL-PERSONAL-PRIVACY-1: synthetic personal content never reaches AUDIT.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const module = await import("data:text/javascript;base64," + Buffer.from(source + "\nexport { logChat, recordPersonalKernelTelemetry };\n").toString("base64"));
const original = readFileSync(new URL("../migrations/2026-11-06-kernel-everywhere.sql", import.meta.url), "utf8");
const correction = readFileSync(new URL("../migrations/2026-11-07-kernel-personal-privacy.sql", import.meta.url), "utf8");
const privateMarker = "SYNTHETIC_PRIVATE_HEALTH_LOCATION_8729";
const now = "2026-11-07T12:00:00Z";
const audit = new DatabaseSync(":memory:");
audit.exec(`
CREATE TABLE doctrine_lineage (version TEXT PRIMARY KEY, adopted_at TEXT, source TEXT, file TEXT, parent TEXT, note TEXT);
CREATE TABLE ops_ai_log (id TEXT PRIMARY KEY, ts TEXT, response TEXT, completion_tokens INTEGER);
CREATE TABLE owner_prompts (id TEXT PRIMARY KEY, ts TEXT, prompt TEXT, response TEXT);
CREATE TABLE session_records (session_id TEXT PRIMARY KEY, created_at TEXT, summary TEXT, handoff_notes TEXT);
CREATE TABLE ask_events (id TEXT PRIMARY KEY, ts TEXT, answer TEXT);
CREATE TABLE chatbox_conversations (id TEXT PRIMARY KEY, ts TEXT, source TEXT, response TEXT);
CREATE TABLE false_stop_phrases (phrase TEXT PRIMARY KEY, pattern_key TEXT, scope TEXT);
CREATE TABLE false_stop_hits (id INTEGER PRIMARY KEY, ts TEXT DEFAULT CURRENT_TIMESTAMP, source TEXT, reply_id TEXT, reply_ts TEXT, pattern_key TEXT, phrase TEXT, excerpt TEXT, UNIQUE(source, reply_id, pattern_key));
INSERT INTO false_stop_phrases VALUES
('if you want', 'conditional-offer', 'reply'), ('shall i', 'conditional-offer', 'reply'),
('two options', 'menu', 'reply'), ('permission check', 'disposition', 'disposition'),
('user private text', 'friction', 'user');
`);
audit.exec(original);
audit.prepare("INSERT INTO personal_replies VALUES ('legacy', ?1, 'personal-api', ?2)").run(now, privateMarker + " if you want");
assert.equal(audit.prepare("SELECT COUNT(*) n FROM v_false_stop_candidates WHERE source='personal_replies'").get().n, 1);
audit.exec(correction);
assert.equal(audit.prepare("SELECT COUNT(*) n FROM v_agent_replies WHERE source='personal_replies'").get().n, 0);
assert.equal(audit.prepare("SELECT COUNT(*) n FROM v_false_stop_candidates WHERE source='personal_replies'").get().n, 0);
assert.equal(audit.prepare("SELECT COUNT(*) n FROM personal_replies").get().n, 1); // No personal row read or deleted by correction.
audit.exec(correction);
assert.equal(audit.prepare("SELECT COUNT(*) n FROM bak_20261107_kernel_public_views").get().n, 2);

const auditCalls = [];
const wrap = (db, calls = []) => ({
  prepare(sql) {
    const call = { sql, values: [] }; calls.push(call);
    const statement = {
      bind(...values) { call.values = values; return statement; },
      async all() { return { results: db.prepare(sql).all(...call.values) }; },
      async run() { db.prepare(sql).run(...call.values); return { success: true }; }
    };
    return statement;
  },
  async batch(statements) { return Promise.all(statements.map((s) => s.run())); }
});
const personal = new DatabaseSync(":memory:");
const env = { AUDIT: wrap(audit, auditCalls), PERSONAL: wrap(personal), AI: { async run() { return { data: [] }; } } };
// Exercise the real caller with private content in every user-controlled field.
await module.logChat(env, privateMarker + " prompt", privateMarker + " if you want, shall I?", privateMarker + " thread", privateMarker + " UA", "personal-twin-chat");
const rows = () => audit.prepare("SELECT * FROM false_stop_hits ORDER BY id").all();
assert.equal(personal.prepare("SELECT COUNT(*) n FROM chat WHERE content LIKE ?").get("%" + privateMarker + "%").n, 2);
assert.deepEqual(rows().map((r) => r.pattern_key).sort(), ["conditional-offer", "report-as-question"]);
assert.equal(new Set(rows().map((r) => r.reply_id)).size, 1); // Count once per reply/category.
assert.match(rows()[0].reply_id, /^personal-kernel-[0-9a-f-]{36}$/);
assert.ok(rows().every((r) => r.source === "personal-api.kernel" && r.phrase === r.pattern_key && r.excerpt === "[personal reply classified locally; content withheld]"));
assert.ok(!JSON.stringify(auditCalls).includes(privateMarker));
assert.ok(!JSON.stringify(rows()).includes(privateMarker));
assert.ok(auditCalls.every((c) => !/CREATE TABLE|personal_replies/.test(c.sql)));

const before = rows().length;
await module.recordPersonalKernelTelemetry(env, privateMarker + ' "if you want" and `shall i`', "personal-twin-chat", now);
await module.recordPersonalKernelTelemetry(env, privateMarker + " if you want, permission check refused?", "personal-twin-chat", now);
await module.recordPersonalKernelTelemetry(env, privateMarker + " finished.", "personal-twin-chat", now);
assert.equal(rows().length, before); // Quoted signatures, dispositions, and clean answers do not count.
const beforeCalls = auditCalls.length;
for (const model of ["tool", "mcp-tool"]) await module.recordPersonalKernelTelemetry(env, privateMarker + " if you want?", model, now);
await module.recordPersonalKernelTelemetry({}, privateMarker, "personal-twin-chat", now);
assert.equal(auditCalls.length, beforeCalls); // Tool traces and absent binding are skipped before I/O.

audit.prepare("INSERT INTO false_stop_phrases VALUES ('sensitive trigger', ?, 'reply')").run(privateMarker);
await module.recordPersonalKernelTelemetry(env, "sensitive trigger", "personal-twin-chat", now);
assert.equal(rows().length, before); // Registry strings cannot become arbitrary exported categories.
await module.recordPersonalKernelTelemetry(env, "Two options, if you want, if you want", "personal-twin-chat", now);
assert.equal(rows().length, before + 2);
assert.ok(!JSON.stringify(auditCalls).includes(privateMarker));

const logs = [];
const oldLog = console.log;
console.log = (...args) => logs.push(args);
try {
  await module.recordPersonalKernelTelemetry({ AUDIT: { prepare() { throw new Error(privateMarker); } } }, privateMarker + " if you want", "personal-twin-chat", now);
} finally { console.log = oldLog; }
assert.deepEqual(logs, [["personal-api kernel telemetry unavailable"]]);
// A shared scanner pass still works and does not reinsert/duplicate personal category hits.
audit.exec("INSERT OR IGNORE INTO false_stop_hits (source, reply_id, reply_ts, pattern_key, phrase, excerpt) SELECT source, reply_id, reply_ts, pattern_key, phrase, excerpt FROM v_false_stop_candidates");
assert.equal(rows().length, before + 2);
assert.ok(!JSON.stringify(rows()).includes(privateMarker));
// All existing registry categories survive the privacy boundary, including later additions.
for (const category of ["narration", "sole-safeguard", "text-as-output", "you-as-actor"]) {
  const phrase = category + " signature";
  audit.prepare("INSERT INTO false_stop_phrases VALUES (?, ?, 'reply')").run(phrase, category);
  await module.recordPersonalKernelTelemetry(env, privateMarker + " " + phrase, "personal-twin-chat", now);
  assert.equal(rows().at(-1).pattern_key, category);
}
assert.equal(rows().length, before + 6);
assert.ok(!JSON.stringify(auditCalls).includes(privateMarker));
audit.exec(/^-- Rollback: (.+)$/m.exec(correction)[1]);
assert.equal(audit.prepare("SELECT COUNT(*) n FROM v_agent_replies WHERE source='personal_replies'").get().n, 0);
personal.close(); audit.close();
console.log("kernel-privacy: passed (local scan, category-only telemetry, caller boundary, exclusions, fail-soft logs, corrective migration replay)");
