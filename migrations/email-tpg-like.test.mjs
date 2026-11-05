// EMAIL-TPG-LIKE-1 (2026-11-05): email_reply_queue_terminal_parent_guard built a LIKE pattern from NEW.sender ('%' || lower(NEW.sender) || '%'). D1 refuses a pattern over 50 bytes at
// run time and 139 of 1,017 senders are 49 bytes or longer, so the guarded UPDATE failed with "pattern too complex" for them. node:sqlite has no 50-byte cap, so this suite pins the SHAPE
// (no LIKE pattern is built from a column in the new trigger) and proves the new trigger decides every case like the old one, except the sender that held a LIKE wildcard.
// Output MUST contain "0 failed" on success.   node migrations/email-tpg-like.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const here = (p) => new URL(p, import.meta.url);
const oldSql = readFileSync(here("./2026-10-01-email-reply-terminal-parent-guard.sql"), "utf8");
const newSql = readFileSync(here("./2026-11-05-email-terminal-parent-guard-instr.sql"), "utf8");
let checks = 0, failures = 0;
const ok = (c, m, d) => { checks++; if (!c) { failures++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const trigger = (text) => {
  const m = /CREATE TRIGGER (?:IF NOT EXISTS )?email_reply_queue_terminal_parent_guard[\s\S]*?\nEND;/.exec(text);
  return m ? m[0].replace("CREATE TRIGGER IF NOT EXISTS", "CREATE TRIGGER") : null;
};
const oldTrg = trigger(oldSql), newTrg = trigger(newSql);
ok(!!oldTrg && !!newTrg, "both trigger definitions are in the migrations");

// the pattern literal bytes of every LIKE in the new trigger are fixed and short, and no LIKE operand is a column or an expression
const likes = [...newTrg.matchAll(/\bLIKE\s+([^\n]*)/gi)].map((m) => m[1]);
ok(likes.length === 2 && likes.every((x) => /^'[^'|]*'/.test(x) && !/\|\|/.test(x)), "the new trigger has only literal LIKE patterns (no pattern built from a column)", likes);
ok(!/LIKE\s+'%'\s*\|\|/i.test(newTrg), "no LIKE '%' || column || '%' in the new trigger");
ok(/instr\(lower\(o\.recipient\), lower\(NEW\.sender\)\) > 0/.test(newTrg), "the containment test is instr(lower(recipient), lower(sender))");
ok(/LIKE\s+'%'\s*\|\|\s*lower\(NEW\.sender\)/i.test(oldTrg), "the old trigger had the dynamic pattern (the defect this migration removes)");

const DDL = `
CREATE TABLE emails (id INTEGER PRIMARY KEY, sender TEXT, recipient TEXT, body_text TEXT, status TEXT, received_at TEXT);
CREATE TABLE email_parse_failures (email_id INTEGER, resolved_at TEXT);
CREATE TABLE email_reply_queue (id INTEGER PRIMARY KEY, email_id INTEGER, sender TEXT, human_score INTEGER, decision TEXT DEFAULT 'pending', skip_reason TEXT);`;
const build = (trg) => { const db = new DatabaseSync(":memory:"); db.exec(DDL); db.exec(trg); return db; };
const long = "a-very-long-sender-name-with-a-subaddress+tag-123456@a-long-university-department.example.org"; // 92 bytes
const wild = "a_c@example.org";

function scenario(db, name, parent, queue, outbound) {
  db.exec("DELETE FROM emails; DELETE FROM email_reply_queue; DELETE FROM email_parse_failures;");
  db.prepare("INSERT INTO emails (id, sender, recipient, body_text, status, received_at) VALUES (1, ?, 'owner@qnfo.org', ?, ?, '2026-11-01T10:00:00Z')").run(queue.sender, parent.body, parent.status);
  if (outbound) db.prepare("INSERT INTO emails (id, sender, recipient, body_text, status, received_at) VALUES (2, 'owner@qnfo.org', ?, 'answer', 'sent', '2026-11-01T12:00:00Z')").run(outbound);
  db.prepare("INSERT INTO email_reply_queue (id, email_id, sender, human_score) VALUES (1, 1, ?, ?)").run(queue.sender, queue.score);
  try {
    db.prepare("UPDATE email_reply_queue SET decision = 'closed', skip_reason = 'terminal-parent: auto' WHERE id = 1").run();
    return "allowed";
  } catch (e) {
    return /EMAIL-REPLY-TERMINAL-PARENT-GUARD-1/.test(String(e.message)) ? "refused" : "error:" + String(e.message).slice(0, 80);
  }
}

const cases = [
  ["empty parent body is refused", { body: null, status: "received" }, { sender: "alice@example.org", score: 0 }, null, "refused"],
  ["a human reply with no outbound answer is refused", { body: "hello", status: "received" }, { sender: "bob@example.org", score: 3 }, null, "refused"],
  ["a human reply with an outbound answer is allowed", { body: "hello", status: "received" }, { sender: "bob@example.org", score: 3 }, "bob@example.org", "allowed"],
  ["a spam parent is allowed", { body: "hello", status: "spam" }, { sender: "bob@example.org", score: 3 }, null, "allowed"],
  ["a low-score parent is allowed", { body: "hello", status: "received" }, { sender: "carol@example.org", score: 0 }, null, "allowed"],
  ["a 92-byte sender with an outbound answer is allowed", { body: "hello", status: "received" }, { sender: long, score: 3 }, long, "allowed"],
  ["a 92-byte sender with no outbound answer is refused", { body: "hello", status: "received" }, { sender: long, score: 3 }, null, "refused"],
  ["the sender match is case-insensitive", { body: "hello", status: "received" }, { sender: "Bob@Example.org", score: 3 }, "bob@example.org", "allowed"],
];
const dbOld = build(oldTrg), dbNew = build(newTrg);
for (const [name, parent, queue, outbound, want] of cases) {
  const a = scenario(dbOld, name, parent, queue, outbound), b = scenario(dbNew, name, parent, queue, outbound);
  ok(b === want, "new trigger: " + name, { got: b, want });
  ok(a === b, "old and new decide alike: " + name, { old: a, now: b });
}
// the one deliberate difference: a sender with a LIKE wildcard ('_' read as any character) no longer matches a different address
const w1 = scenario(dbOld, "wild", { body: "hello", status: "received" }, { sender: wild, score: 3 }, "abc@example.org");
const w2 = scenario(dbNew, "wild", { body: "hello", status: "received" }, { sender: wild, score: 3 }, "abc@example.org");
ok(w1 === "allowed" && w2 === "refused", "an underscore in the sender is a literal character now, not a wildcard", { old: w1, now: w2 });

ok(/DROP TRIGGER IF EXISTS email_reply_queue_terminal_parent_guard/.test(newSql) && /BACKUP: bak_20261105_email_tpg_trigger/.test(newSql) && /CREATE TABLE IF NOT EXISTS bak_20261105_email_tpg_trigger/.test(newSql), "the drop is backed up by a table the file creates first");

console.log(checks + " checks, " + failures + " failed");
process.exit(failures ? 1 : 0);
