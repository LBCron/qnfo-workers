// DOMAIN-PLANE-AUDIT-1 offline suite (agent_issues 100230).
// Applies migrations/2026-10-20-domain-plane-inventory-issues.sql on SQLite (node:sqlite) and proves: the header (APPLY-BY ci, DB qnfo-audit, one
// single-line Rollback, no DELETE or DROP in the body); two issues, one per misplaced host, each with a probe line that
// scripts/remediation_consumer.py's own parser accepts (read from its source: the key set) and that does not already pass; a replay is a no-op;
// the Rollback removes the two rows only; docs/DOMAINS.md carries the "## Inventory" section and names both hosts and the personal host.
// Run: node --no-warnings migrations/domain-plane-inventory-issues.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sql = readFileSync(join(here, "2026-10-20-domain-plane-inventory-issues.sql"), "utf8").replace(/\r\n/g, "\n");
const doc = readFileSync(join(root, "docs", "DOMAINS.md"), "utf8");
const consumer = readFileSync(join(root, "scripts", "remediation_consumer.py"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => new RegExp("^-- " + k + ": ").test(l)) || "").replace(new RegExp("^-- " + k + ": "), "");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && hdr("Rollback").length > 40, "one single-line Rollback");
ok(!/\bDELETE\b|\bDROP\b/i.test(body), "the body has no DELETE or DROP, so no BACKUP header is needed");
ok(!/claude\.ai|anthropic\.com/i.test(sql + doc), "no claude.ai or anthropic.com link in the migration or DOMAINS.md");

const DDL = "CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT)";
const db = new DatabaseSync(":memory:");
db.exec(DDL);
db.exec(sql);
let rows = db.prepare("SELECT * FROM agent_issues ORDER BY id").all();
ok(rows.length === 2 && rows.every((r) => r.status === "open" && r.category === "reach" && r.source === "session"), "two open reach issues", rows.length);
ok(rows[0].title.startsWith("DOMAIN-PLANE-1:ask.qwav.tech") && rows[1].title.startsWith("DOMAIN-PLANE-1:qwav.tech"), "one DOMAIN-PLANE-1:<host> title per misplaced host");
const probe = (r) => { const m = /^runtime-probe: (\{.*\})$/m.exec(r.description); return m ? JSON.parse(m[1]) : null; };
const allowedKeys = /unknown = set\(p\) - \{([^}]*)\}/.exec(consumer)[1].match(/"([a-z_]+)"/g).map((s) => s.replace(/"/g, ""));
for (const r of rows) {
  const p = probe(r);
  ok(p && Object.keys(p).every((k) => allowedKeys.includes(k)) && p.url.startsWith("https://"), "the runtime probe of " + r.title.slice(0, 40) + " is a spec the consumer accepts", p);
  ok(/Definition of done:/.test(r.description), "a definition of done is stated");
}
const askP = probe(rows[0]), apexP = probe(rows[1]);
ok(askP.url === "https://ask.qwav.org/health" && askP.status === 200 && askP.contains === "qnfo-ai-search", "ask probe reads ask.qwav.org/health for the worker name (that host has no route today)");
ok(apexP.status === 301 && apexP.redirect_to === "https://qwav.org" && /^https:\/\/qwav\.tech\//.test(apexP.url), "apex probe is a no-follow 301 check (redirect_to), which the apex's current 200 does not satisfy");
ok(/code-task: repo=qnfo-workers path=scripts\/attach-ask-qwav-route\.py/.test(rows[0].description), "the Ask issue hands the code loop its file");

db.exec(sql);
ok(db.prepare("SELECT count(*) n FROM agent_issues").get().n === 2, "a replay inserts nothing while the issues are open");
db.prepare("UPDATE agent_issues SET status = 'closed' WHERE id = 1").run();
db.exec(sql);
ok(db.prepare("SELECT count(*) n FROM agent_issues").get().n === 3, "a closed issue is re-filed by the same file (the open-title guard)");

db.prepare("INSERT INTO agent_issues (title, status, source, category) VALUES ('unrelated', 'open', 'session', 'reach')").run();
db.exec(hdr("Rollback"));
const left = db.prepare("SELECT title, status FROM agent_issues ORDER BY id").all();
ok(left.length === 2 && left.some((x) => x.title === "unrelated") && left.some((x) => x.status === "closed"), "the Rollback removes the open rows it filed and nothing else", left);

ok(/^## Inventory$/m.test(doc), "docs/DOMAINS.md carries the ## Inventory section");
const inv = doc.slice(doc.indexOf("## Inventory"));
ok(inv.includes("me.q08.org") && inv.includes("personal.qnfo.org") && inv.includes("DOMAIN-PLANE-1:ask.qwav.tech") && /\| `qwav\.tech` \| quantum \| zone redirect rule, 301 to `https:\/\/qwav\.org` \| yes, a redirect/.test(inv), "the inventory names the personal host, the old personal host, the misplaced ask.qwav.tech with its issue and qwav.tech as the redirect QWAV-PAGES-RETIRE-1 (#7017) made it");
ok(/\| `reading\.q08\.org`/.test(inv) && /\| `travel\.q08\.org`/.test(inv) && /\| `fleet\.qnfo\.org`/.test(inv) && /\| `qwav\.org`/.test(inv), "the inventory covers every plane's flagship hosts");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
