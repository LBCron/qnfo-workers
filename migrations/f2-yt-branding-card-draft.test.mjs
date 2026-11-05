// F2 follow-up (migrations/2026-11-05-f2-yt-branding-card-draft.sql) offline suite on SQLite: the open card gains the drafted-package text once, keeps its IDENTITY-BOUND line,
// the backup holds the old text, a replay and a card in any other state are left alone. Run: node migrations/f2-yt-branding-card-draft.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-f2-yt-branding-card-draft.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const hdr = sql.split(/\r?\n/).filter((l) => l.startsWith("--"));
ok(hdr.some((l) => l === "-- APPLY-BY: ci") && hdr.some((l) => l === "-- DB: qnfo-audit") && hdr.some((l) => l === "-- BACKUP: bak_20261105_f2_yt_card") && hdr.some((l) => l.startsWith("-- Rollback: ")), "header lines");
const fresh = (status = "open", source = "session:F2") => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE human_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, title TEXT, why TEXT, default_in_effect TEXT, action TEXT, status TEXT, source TEXT, updated_at TEXT)");
  db.prepare("INSERT INTO human_actions (slug, why, default_in_effect, action, status, source) VALUES ('yt-channel-branding-owner', 'IDENTITY-BOUND: the channel is the owner''s own account', 'old default', 'old action', ?, ?)").run(status, source);
  return db;
};
{
  const db = fresh();
  db.exec(sql);
  const c = db.prepare("SELECT * FROM human_actions").get();
  ok(/docs\/YOUTUBE-CHANNEL-PACKAGE\.md/.test(c.action) && /Studio/.test(c.action) && /ops_config yt_channel_branding/.test(c.action) && /^The channel stays/.test(c.default_in_effect), "the card points at the drafted package", c.action);
  ok(/^IDENTITY-BOUND: /.test(c.why) && c.status === "open", "the IDENTITY-BOUND line and the open state are kept");
  ok(!/claude|anthropic/i.test(JSON.stringify(c)), "no route to a chat product");
  const b = db.prepare("SELECT * FROM bak_20261105_f2_yt_card").get();
  ok(b.action === "old action" && b.default_in_effect === "old default", "the backup holds the old text", b);
  const once = c.action;
  db.exec(sql);
  ok(db.prepare("SELECT action FROM human_actions").get().action === once && db.prepare("SELECT action FROM bak_20261105_f2_yt_card").get().action === "old action", "a replay changes nothing and keeps the first backup");
}
for (const [status, source] of [["resolved", "session:F2"], ["open", "somebody else"]]) {
  const db = fresh(status, source);
  db.exec(sql);
  ok(db.prepare("SELECT action FROM human_actions").get().action === "old action", "left alone: " + status + " / " + source);
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
