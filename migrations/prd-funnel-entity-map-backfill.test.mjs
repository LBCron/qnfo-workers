// PRD-FUNNEL-BACKFILL-1 offline suite: migrations/2026-11-05-prd-funnel-entity-map-backfill.sql on node:sqlite twice.
// Proves: the eight named published papers without an entity_map row get (slug, page_url = https://papers.qnfo.org/papers/<slug>, updated_at) and nothing else; an existing row is not
// overwritten; a paper outside the list, or one that is not published, is not touched; the v_prd_funnel_publications logic then reads has_deposit and has_page_mapping 1 for them; a replay
// changes nothing and the backup keeps the first list.
// Run: node migrations/prd-funnel-entity-map-backfill.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-prd-funnel-entity-map-backfill.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
function statements(text) {
  const body = text.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  const out = []; let cur = "", q = false;
  for (const c of body) { if (c === "'") q = !q; if (c === ";" && !q) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += c; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const S = statements(sql);
const SLUGS = [...sql.matchAll(/^\s+'([a-z0-9-]+)'[,)]/gm)].map((m) => m[1]);
ok(SLUGS.length === 8, "the file names eight slugs", SLUGS.length);
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE research_queue (id TEXT PRIMARY KEY, paper_slug TEXT, status TEXT, doi TEXT, published_at TEXT);
CREATE TABLE entity_map (slug TEXT PRIMARY KEY, doi TEXT, page_url TEXT, utm_campaign TEXT, post_uri TEXT, buffer_id TEXT, updated_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE decision_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER, kind TEXT, subject TEXT, op TEXT, value REAL, due_at TEXT, origin TEXT, UNIQUE(decision_id, kind, subject));`);
const rq = db.prepare("INSERT INTO research_queue (id, paper_slug, status, published_at) VALUES (?, ?, ?, '2026-10-19T02:21:00Z')");
SLUGS.forEach((s, i) => rq.run("r" + i, s, i === 7 ? "queued" : "published"));        // the eighth is not published: it must not be mapped
rq.run("other", "some-other-published-paper", "published");                            // outside the list
db.prepare("INSERT INTO entity_map (slug, page_url, doi, updated_at) VALUES (?, 'https://example.org/keep', '10.1/keep', '2026-10-01T00:00:00Z')").run(SLUGS[0]);   // an existing row
const run = () => { for (const s of S) db.exec(s); };
run();
const rows = db.prepare("SELECT slug, page_url, doi, utm_campaign, post_uri, buffer_id, updated_at FROM entity_map ORDER BY slug").all();
const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
ok(rows.length === 7, "six new rows plus the existing one (the unpublished and the unlisted paper get none)", rows.map((r) => r.slug.slice(0, 20)));
for (const s of SLUGS.slice(1, 7)) ok(bySlug[s] && bySlug[s].page_url === "https://papers.qnfo.org/papers/" + s && bySlug[s].doi === null && bySlug[s].post_uri === null && bySlug[s].buffer_id === null && bySlug[s].utm_campaign === null && /^\d{4}-\d\d-\d\dT/.test(bySlug[s].updated_at), s.slice(0, 30) + ": page_url only", bySlug[s]);
ok(bySlug[SLUGS[0]].page_url === "https://example.org/keep" && bySlug[SLUGS[0]].doi === "10.1/keep", "an existing row is not overwritten");
ok(!bySlug[SLUGS[7]] && !bySlug["some-other-published-paper"], "the unpublished paper and the paper outside the list are not mapped");
// the funnel's own evidence rule for a mapped paper
const ev = db.prepare("SELECT CASE WHEN COALESCE(NULLIF(trim(q.doi),''),NULLIF(trim(e.doi),'')) IS NOT NULL OR trim(COALESCE(e.page_url,''))<>'' THEN 1 ELSE 0 END has_deposit, CASE WHEN trim(COALESCE(e.page_url,''))<>'' THEN 1 ELSE 0 END has_page_mapping FROM research_queue q LEFT JOIN entity_map e ON e.slug = q.paper_slug WHERE q.paper_slug = ?").get(SLUGS[3]);
ok(ev.has_deposit === 1 && ev.has_page_mapping === 1, "the funnel reads a mapped paper as deposited and page-mapped", ev);
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_prd_entity_map").get().n === 6, "the backup lists the six papers that lacked a row (published, listed, unmapped)");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM decision_predictions").get().n === 1, "one decision and one prediction");
const snap = () => JSON.stringify([db.prepare("SELECT * FROM entity_map ORDER BY slug").all(), db.prepare("SELECT * FROM bak_20261105_prd_entity_map ORDER BY slug").all()]);
const before = snap();
run();
ok(snap() === before, "a replay changes nothing (the backup keeps the first list)");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
