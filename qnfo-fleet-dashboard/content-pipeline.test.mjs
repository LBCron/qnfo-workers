// CONTENT-PIPELINE-1 offline suite (qnfo-fleet-dashboard 1.37.0): the migration applied to node:sqlite (stage catalogue,
// transition ledger triggers, v_content_pipeline stage and state mapping, SLA verdicts, the fleet_tick metric refresh), then
// /api/content shaping, the page and the hourly release-gate metric against it.
// Run: node --no-warnings qnfo-fleet-dashboard/content-pipeline.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); if (a < 0 || b < a) throw new Error("not found in worker.js: " + from); return src.slice(a, b); };
const block = cut("// ---- CONTENT-PIPELINE-1:BEGIN ----", "// ---- CONTENT-PIPELINE-1:END ----");
const kpi = cut("// ---- FLEET-KPI-1:BEGIN ----", "// ---- FLEET-KPI-1:END ----");
const outcomes = cut("/* CODE-OUTCOMES:BEGIN", "/* CODE-OUTCOMES:END */"); // the KPI block builds its code-task read from the shared outcome SQL
const d1allSrc = cut("const D1_PRIMARY_ONLY", "__name(d1all, \"d1all\");");
const escSrc = cut("function esc(s) {", "__name(esc, \"esc\");");
const migration = readFileSync(new URL("../migrations/2026-10-14-03-content-pipeline.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };

const NOW = Date.now();
const iso = (hAgo) => new Date(NOW - hAgo * 36e5).toISOString();
const sq = (hAgo) => iso(hAgo).slice(0, 19).replace("T", " ");
const audit = new DatabaseSync(":memory:");
audit.exec(`CREATE TABLE research_queue (id TEXT PRIMARY KEY, source TEXT, idea TEXT, status TEXT, stage TEXT, claimed_at TEXT, completed_at TEXT, published_at TEXT, paper_slug TEXT, created_at TEXT);
  CREATE TABLE research_ready (id TEXT PRIMARY KEY, ready_at TEXT NOT NULL);
  CREATE TABLE idea_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, idea TEXT, contact TEXT, status TEXT, created_at TEXT, triaged_at TEXT);
  CREATE TABLE version_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, title TEXT, status TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE paper_revision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, title TEXT, status TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE errata_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT, claim TEXT, status TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE internal_errata (id TEXT PRIMARY KEY, target_ref TEXT, claim_text TEXT, status TEXT, detected_at TEXT, updated_at TEXT);
  CREATE TABLE social_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, title TEXT, status TEXT, posted_at TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE dissemination_tracker (id TEXT PRIMARY KEY, paper_slug TEXT, paper_title TEXT, channel TEXT, action TEXT, posted_at TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE fleet_tick (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
  CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER, enabled INTEGER, notes TEXT);
  CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);`);
// Rows that exist before the migration: no ledger event, so the view falls back to the row's own timestamps.
const ins = (sql, ...a) => audit.prepare(sql).run(...a);
ins("INSERT INTO research_queue (id, idea, status, stage, created_at) VALUES ('r-def', 'Deferred idea', 'deferred', NULL, ?)", iso(50));
ins("INSERT INTO research_queue (id, idea, status, stage, created_at) VALUES ('r-q', 'Ready idea', 'queued', NULL, ?)", iso(30));
ins("INSERT INTO research_ready (id, ready_at) VALUES ('r-q', ?)", iso(1));
ins("INSERT INTO research_queue (id, idea, status, stage, claimed_at, created_at) VALUES ('r-rev', 'In review', 'researching', 'review', ?, ?)", iso(2), iso(40));
ins("INSERT INTO research_queue (id, idea, status, stage, claimed_at, created_at) VALUES ('r-ens', 'Drafting', 'researching', 'ensemble', ?, ?)", iso(8), iso(40));
ins("INSERT INTO research_queue (id, idea, status, stage, claimed_at, created_at) VALUES ('r-held', 'Held', 'held', 'verify', ?, ?)", iso(3), iso(40));
ins("INSERT INTO research_queue (id, idea, status, stage, published_at, created_at) VALUES ('r-pub', 'Published one', 'published', 'done', ?, ?)", iso(5), iso(60));
ins("INSERT INTO research_queue (id, idea, status, stage, created_at) VALUES ('r-wf', 'Parked', 'wontfix', 'parked', ?)", iso(90));
ins("INSERT INTO idea_proposals (name, idea, contact, status, created_at) VALUES ('auto-scan', 'A machine idea', NULL, 'new', ?)", iso(3));
ins("INSERT INTO idea_proposals (name, idea, contact, status, created_at) VALUES ('owner-corpus', 'Private corpus text', 'x', 'new', ?)", iso(1));
ins("INSERT INTO idea_proposals (name, idea, status, created_at, triaged_at) VALUES ('auto-scan', 'Held idea', 'triaged_hold', ?, ?)", iso(200), iso(199));
ins("INSERT INTO idea_proposals (name, idea, status, created_at, triaged_at) VALUES ('auto-scan', 'Accepted idea', 'triaged_accepted', ?, ?)", iso(20), iso(19));
ins("INSERT INTO version_queue (slug, title, status, created_at, updated_at) VALUES ('v1', 'Version in gate', 'gate-blocked', ?, ?)", sq(10), sq(10));
ins("INSERT INTO paper_revision_log (slug, title, status, created_at, updated_at) VALUES ('p1', 'Quarantined', 'quarantined', ?, ?), ('p2', 'Needs work', 'needs-substantive-revision', ?, ?)", sq(500), sq(500), sq(400), sq(400));
ins("INSERT INTO errata_queue (subject, status, created_at, updated_at) VALUES ('Erratum', 'audited', ?, ?)", sq(2), sq(2));
ins("INSERT INTO internal_errata (id, claim_text, status, detected_at) VALUES ('ie1', 'Claim', 'open', ?)", iso(30));
ins("INSERT INTO social_threads (slug, title, status, posted_at, created_at, updated_at) VALUES ('s1', 'Thread', 'posted', ?, ?, ?), ('s2', 'Rejected thread', 'rejected', NULL, ?, ?)", sq(4), sq(5), sq(4), sq(6), sq(6));
ins("INSERT INTO dissemination_tracker (id, paper_title, channel, action, created_at) VALUES ('d-old', 'Old paper', 'bluesky', 'queued', ?), ('d-unv', 'Unverified', 'buffer/x', 'post-unverified', ?)", sq(300), sq(2000));

audit.exec(migration);
audit.exec(migration); // idempotent: CREATE ... IF NOT EXISTS, INSERT OR IGNORE, guarded INSERTs
const one = (sql, ...a) => audit.prepare(sql).get(...a);
const all = (sql, ...a) => audit.prepare(sql).all(...a);
ok(one("SELECT COUNT(*) n FROM content_stages").n === 12, "twelve stages in the catalogue");
ok(one("SELECT COUNT(*) n FROM analytics_metric_triggers").n === 2 && one("SELECT COUNT(*) n FROM decision_log").n === 1, "a second apply adds no duplicate trigger or decision row");
ok(one("SELECT refresh_cadence c FROM metric_registry WHERE metric = 'content_items_over_stage_sla'").c === "*/10", "the cadence is a canonical token");
const row = (flow, id) => one("SELECT * FROM v_content_pipeline WHERE flow = ? AND item_id = ?", flow, String(id));
let x = row("research", "r-def");
ok(x.stage === "queued" && x.state === "waiting" && x.over_sla === 1 && x.age_h >= 49.9, "a deferred unclaimed row waits in queued and is past the 24 h SLA");
x = row("research", "r-q");
ok(x.stage === "queued" && x.state === "waiting" && x.over_sla === 0 && x.age_h < 2, "a ready row is aged from research_ready, not from its creation");
x = row("research", "r-rev");
ok(x.stage === "review" && x.state === "active" && x.over_sla === 0, "review/researching is active in review");
x = row("research", "r-ens");
ok(x.stage === "draft" && x.state === "active" && x.over_sla === 1, "ensemble is writing; 8 h is past the 6 h SLA");
x = row("research", "r-held");
ok(x.stage === "review" && x.state === "held", "a held row keeps its stage and is held");
ok(row("research", "r-pub").stage === "published" && row("research", "r-pub").state === "done" && row("research", "r-pub").over_sla === 0, "published is done and never over SLA");
ok(row("research", "r-wf").stage === "rejected" && row("research", "r-wf").state === "rejected", "wontfix/parked is rejected");
const ideas = all("SELECT item_id, title, stage, state FROM v_content_pipeline WHERE flow = 'idea' ORDER BY CAST(item_id AS INTEGER)");
ok(ideas[0].title === "A machine idea" && ideas[0].stage === "intake" && ideas[0].state === "waiting", "a machine idea shows its text in intake");
ok(ideas[1].title === "(owner-corpus idea 2)" && !JSON.stringify(ideas).includes("Private corpus"), "an owner-corpus idea shows its source and id only");
ok(ideas[2].state === "parked" && ideas[3].state === "done" && ideas[3].stage === "triage", "HOLD is parked, ACCEPT is done at triage (handed to research)");
ok(row("version", 1).stage === "review" && row("version", 1).state === "blocked" && row("version", 1).over_sla === 1, "a gate-blocked version is blocked in review, past SLA");
ok(row("revision", 1).state === "parked" && row("revision", 2).state === "parked" && row("revision", 2).stage === "revise", "quarantined and needs-substantive-revision are parked, not counted against an SLA");
ok(row("errata", 1).stage === "correct" && row("errata", 1).state === "active", "an audited erratum is being corrected");
ok(row("internal-errata", "ie1").state === "waiting" && row("internal-errata", "ie1").over_sla === 1, "an open fleet erratum waits; 30 h is past the 24 h SLA");
ok(row("social-thread", 1).state === "done" && row("social-thread", 2).stage === "rejected", "posted is done, rejected is rejected");
ok(row("dissemination", "d-old").state === "waiting" && row("dissemination", "d-old").over_sla === 1 && row("dissemination", "d-unv").state === "parked", "an old queued post is past SLA; post-unverified is parked");

// The ledger: a status or stage change writes one event and the age restarts from it.
audit.prepare("UPDATE research_queue SET status = 'researching', stage = 'ground', claimed_at = ? WHERE id = 'r-def'").run(iso(0));
audit.prepare("UPDATE research_queue SET claimed_at = ? WHERE id = 'r-rev'").run(iso(0)); // no status or stage change: no event
let ev = all("SELECT * FROM content_stage_events WHERE flow = 'research'");
ok(ev.length === 1 && ev[0].item_id === "r-def" && ev[0].from_status === "deferred" && ev[0].to_status === "researching" && ev[0].to_stage === "ground", "one event per real transition, none for a claim refresh");
x = row("research", "r-def");
ok(x.stage === "research" && x.state === "active" && x.age_h < 0.1 && x.over_sla === 0, "after the transition the row is in research and its age restarts");
audit.prepare("INSERT INTO idea_proposals (name, idea, status, created_at) VALUES ('auto-miner', 'New', 'new', ?)").run(iso(0));
audit.prepare("UPDATE dissemination_tracker SET action = 'posted', posted_at = ? WHERE id = 'd-old'").run(sq(0));
ok(one("SELECT COUNT(*) n FROM content_stage_events WHERE flow = 'idea' AND from_status IS NULL").n === 1 && one("SELECT to_status s FROM content_stage_events WHERE flow = 'dissemination'").s === "posted", "inserts and action changes are recorded too");
const sum = all("SELECT * FROM v_content_stage_summary");
const st = (p, s) => sum.find((r) => r.property === p && r.stage === s);
ok(st("papers.qnfo.org", "review").in_flight === 3 && st("papers.qnfo.org", "review").held === 1 && st("papers.qnfo.org", "review").blocked === 1, "summary counts review items by state");
ok(st("social", "distribute").finished_24h >= 2, "items finished in the last day are counted");
const overNow = one("SELECT SUM(over_sla) n FROM v_content_pipeline").n;
audit.prepare("INSERT INTO fleet_tick (source) VALUES ('test')").run();
ok(one("SELECT last_value v FROM metric_registry WHERE metric = 'content_items_over_stage_sla'").v === String(overNow) && overNow >= 3, "every fleet tick writes the over-SLA count (" + overNow + ")");

// ---- the worker code against this database
const living = new DatabaseSync(":memory:");
living.exec("CREATE TABLE papers (slug TEXT, status TEXT, release_gate_pass INTEGER, release_gate_reason TEXT)");
living.exec("INSERT INTO papers VALUES ('a', 'published', 1, 'ok score=80'), ('b', 'published', 0, 'quality:thin score=40 missing=refs<3'), ('c', 'published', NULL, NULL), ('d', 'published', 0, NULL), ('e', 'quarantined', 0, 'quality:quarantine-candidate score=10'), ('f', 'draft', NULL, NULL)");
const q08 = new DatabaseSync(":memory:");
q08.exec(`CREATE TABLE signal_log (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT);
  CREATE TABLE q08_audits (slug TEXT, verdict TEXT, stage TEXT, checked_at TEXT);
  CREATE TABLE published_pieces (id INTEGER PRIMARY KEY, slug TEXT, title TEXT, published_at TEXT);
  CREATE TABLE q08_retractions (slug TEXT, reason TEXT, retracted_at TEXT);`);
q08.exec(`INSERT INTO signal_log (status, created_at) VALUES ('published', '${sq(5)}'), ('gate_failed', '${sq(6)}'), ('gate_failed', '${sq(7)}');
  INSERT INTO q08_audits VALUES ('x', 'fail', 'grounding', '${iso(4)}'), ('y', 'pass', 'publish', '${iso(3)}');
  INSERT INTO published_pieces (slug, title, published_at) VALUES ('x', 'X', '${iso(4)}'), ('y', 'Y', '${iso(3)}');
  INSERT INTO q08_retractions VALUES ('x', 'unsupported', '${iso(2)}');`);
let reads = 0;
const shimOf = (db) => ({ prepare: (sql) => { let args = []; const s = { bind: (...a) => { args = a; return s; }, all: async () => { reads++; return { results: db.prepare(sql).all(...args) }; }, run: async () => db.prepare(sql).run(...args) }; return s; } });
const ctx = vm.createContext({ VERSION: "1.37.0-test", NAME: "qnfo-fleet-dashboard", FLEET_SHELL_JS: "", fleetHead: (t) => "<html><title>" + t + "</title><body>", fleetTop: (cur) => "<nav data-current=\"" + cur + "\"></nav>", console, Date, JSON, Math, Object, Promise, String, Number, Array, Set, isFinite });
vm.runInContext(d1allSrc + escSrc + outcomes + kpi + block + "\nthis.C = { contentData, contentHtml, contentGateMetric, reset: function() { contentCache = null; } };", ctx);
const C = ctx.C, env = { AUDIT: shimOf(audit), LIVING: shimOf(living), Q08: shimOf(q08) };
const j = (o) => JSON.parse(JSON.stringify(o));
const v = j(await C.contentData(env, NOW));
ok(v.schema_version === "content-pipeline/v1" && v.unreadable.length === 0, "every read succeeds: " + JSON.stringify(v.unreadable));
ok(v.board.length === 12 && v.board[0].stage === "intake" && v.board[11].stage === "rejected" && v.board[11].terminal === true, "the board is the catalogue in order");
const b = (s) => v.board.find((x) => x.stage === s);
ok(b("review").in_flight === 3 && b("review").over_sla >= 1 && b("review").enforced_by.includes("qnfo-research-exec"), "the review card holds its counts and its enforcer");
ok(v.totals.over_sla === overNow && v.totals.in_flight > 0 && v.totals.published_7d === 1, "totals match the view (over SLA " + v.totals.over_sla + ")");
ok(v.flow.daily.length === 14 && v.flow.daily[13].entered === 0 && v.flow.daily.some((d) => d.published === 1), "flow balance: 14 days, zero is zero when the read succeeded");
ok(v.papers.gate.pass === 1 && v.papers.gate.thin === 1 && v.papers.gate.unscored === 2 && v.papers.live_failing_gate === 3, "living-paper: 1 pass, 1 thin, 2 never scored (a 0 with no reason is unscored)");
ok(v.q08.pieces.total === 2 && v.q08.pieces.live === 1 && v.q08.retractions.total === 1 && v.q08.signals.length === 2 && v.q08.gates.length === 2, "q08: pieces, live after retractions, gates");
ok(!JSON.stringify(v).includes("Private corpus"), "no owner-corpus idea text in the JSON");
const before = reads;
await C.contentData(env, NOW + 1000);
ok(reads === before, "a second call inside the TTL reads nothing");
const html = C.contentHtml(await C.contentData(env, NOW + 1000), false);
ok(html.includes("<title>Content pipeline</title>") && html.includes('data-current="content"') && html.includes('id="line"') && html.includes("cp-hot"), "the page renders the line with a past-SLA stage marked");
ok(html.includes("Every read succeeded") && html.includes("reading.q08.org") && !html.includes("Private corpus"), "the page names its sources and keeps redacted text out");
// A missing view (migration not applied yet) leaves the rest standing and says so.
C.reset();
const bare = new DatabaseSync(":memory:");
bare.exec("CREATE TABLE research_queue (id TEXT, status TEXT, created_at TEXT, published_at TEXT, completed_at TEXT)");
const v2 = j(await C.contentData({ AUDIT: shimOf(bare), LIVING: shimOf(living), Q08: shimOf(q08) }, NOW));
ok(v2.totals.in_flight === null && v2.board.length === 0 && v2.papers.live_failing_gate === 3 && v2.unreadable.some((u) => u.read === "v_content_stage_summary"), "without the migration: null, not 0, and the other panels stand");
const html2 = C.contentHtml(v2, false);
ok(html2.includes("not measured") && html2.includes("has not applied yet"), "the page says what is not measured and why");
// The hourly metric: written once, then throttled.
audit.prepare("UPDATE metric_registry SET last_refreshed = '2026-01-01T00:00:00Z' WHERE metric = 'papers_live_failing_release_gate'").run();
const m1 = j(await C.contentGateMetric(env));
ok(m1.value === 3 && one("SELECT last_value v FROM metric_registry WHERE metric = 'papers_live_failing_release_gate'").v === "3", "the gate metric counts published papers whose gate is not 1");
ok(j(await C.contentGateMetric(env)).throttled === true, "a second run within the hour is throttled");
ok(j(await C.contentGateMetric({ AUDIT: shimOf(audit) })).skipped === "binding missing", "no living binding: skipped, not thrown");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
