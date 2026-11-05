// BP26-RETENTION-CARD-1 offline suite: replays migrations/2026-11-05-bp26-retention-card-reopen.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, a BACKUP table the file creates before it changes anything); the body deletes and drops nothing; card 189 is reopened only
// when it was closed at birth on its default (a card the owner resolved is left alone); the reopened card keeps its IDENTITY-BOUND line, its default in effect and names a closing probe; the DELTA-NOTE is
// added to issue 1000481 once (a replay changes nothing); no row of personal data and no retention_policy row is touched; the Rollback line restores the card and strips the note.
// Output MUST contain "0 failed" on success.   node migrations/bp26-retention-card-reopen.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-bp26-retention-card-reopen.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(header.some((l) => /^-- BACKUP: bak_20261105_bp26_retention_card\s*$/.test(l)) && /CREATE TABLE IF NOT EXISTS bak_20261105_bp26_retention_card AS SELECT/.test(body), "the BACKUP table is created before the first UPDATE");
ok(body.indexOf("CREATE TABLE IF NOT EXISTS bak_20261105_bp26_retention_card") < body.indexOf("UPDATE human_actions"), "backup precedes the change");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the body deletes and drops nothing");
ok(!/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(retention_policy|emails|email_raw_archive|email_loop_quarantine|subscribers|metric_registry)\b/i.test(body), "no personal-data table, policy row or metric is touched");
ok(!/\b(LIKE|GLOB)\s+'[^']{51,}'/i.test(body) && !/\bLIKE\s+'%[^']{47,}%'/i.test(body), "no LIKE or GLOB pattern over 50 bytes");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link");

const rollback = header.find((l) => /^-- Rollback:/.test(l)).replace(/^-- Rollback:\s*/, "");
const CARD_WHY = "IDENTITY-BOUND: deleting or blanking mail bodies is irreversible.";

function world(cardStatus, resolution) {
  const w = new DatabaseSync(":memory:");
  w.exec(`
CREATE TABLE human_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, title TEXT NOT NULL, why TEXT, default_in_effect TEXT, action TEXT, url TEXT, sev TEXT DEFAULT 'normal', due TEXT, status TEXT DEFAULT 'open', source TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), resolved_at TEXT, resolution TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, description TEXT, updated_at INTEGER);
CREATE TABLE emails (id INTEGER PRIMARY KEY AUTOINCREMENT, body_text TEXT, received_at TEXT);
INSERT INTO emails (body_text, received_at) VALUES ('keep me', date('now','-40 days'));
INSERT INTO agent_issues (id, status, description) VALUES (1000481, 'open', 'METRIC-TRIGGER #14502'), (1000482, 'open', 'other');
`);
  w.prepare("INSERT INTO human_actions (slug, title, why, default_in_effect, status, resolved_at, resolution) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("bp26-retention-enforce", "Decide whether the fleet deletes", CARD_WHY, "Report-only: nothing is deleted", cardStatus, cardStatus === "open" ? null : "2026-10-26 18:44:05", resolution);
  return w;
}
const card = (w) => w.prepare("SELECT status, resolved_at, resolution, why, default_in_effect FROM human_actions WHERE slug = 'bp26-retention-enforce'").get();
const issue = (w, id) => w.prepare("SELECT description FROM agent_issues WHERE id = ?").get(id).description;

// closed at birth on its default: reopened
{
  const w = world("resolved", "DEFAULT-ADOPTED-1: closed at birth on its stated default (owner directive 2026-10-12). Reopen with status=open.");
  w.exec(body);
  const c = card(w);
  ok(c.status === "open" && c.resolved_at === null && c.resolution === null, "a card closed at birth on its default is reopened", c);
  ok(c.why.startsWith(CARD_WHY) && c.why.includes("IDENTITY-BOUND"), "the IDENTITY-BOUND line is kept");
  ok(/retention_enforce/.test(c.why) && /Closing probe/.test(c.why), "the reopened text names the closing probe on ops_config retention_enforce");
  ok(c.default_in_effect === "Report-only: nothing is deleted", "the default in effect is unchanged");
  ok(issue(w, 1000481).includes("DELTA-NOTE (breach-bp26, 2026-11-05) retention") && issue(w, 1000481).includes("IDENTITY-BOUND"), "issue 1000481 gets the disposition and the IDENTITY-BOUND line");
  ok(issue(w, 1000482) === "other", "another issue is untouched");
  ok(w.prepare("SELECT body_text FROM emails").get().body_text === "keep me", "no mail body is blanked");
  ok(w.prepare("SELECT COUNT(*) n FROM bak_20261105_bp26_retention_card").get().n === 1, "the backup holds the original card row");
  const before = JSON.stringify([card(w), issue(w, 1000481)]);
  w.exec(body);
  ok(JSON.stringify([card(w), issue(w, 1000481)]) === before, "a replay changes nothing");
  w.exec(rollback);
  const r = card(w);
  ok(r.status === "resolved" && String(r.resolution).startsWith("DEFAULT-ADOPTED-1") && r.why === CARD_WHY, "the Rollback line restores the card", r);
  ok(issue(w, 1000481) === "METRIC-TRIGGER #14502" || issue(w, 1000481).startsWith("METRIC-TRIGGER #14502"), "the Rollback line strips the note", issue(w, 1000481).slice(-80));
  ok(!/DELTA-NOTE \(breach-bp26, 2026-11-05\) retention/.test(issue(w, 1000481)), "no DELTA-NOTE remains after the rollback");
}

// resolved by the owner: left alone
{
  const w = world("resolved", "owner answered keep on 2026-11-06");
  w.exec(body);
  const c = card(w);
  ok(c.status === "resolved" && c.resolution === "owner answered keep on 2026-11-06" && c.why === CARD_WHY, "a card the owner resolved is not reopened", c);
}

// already open: unchanged
{
  const w = world("open", null);
  w.exec(body);
  ok(card(w).why === CARD_WHY, "an open card is not rewritten");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
