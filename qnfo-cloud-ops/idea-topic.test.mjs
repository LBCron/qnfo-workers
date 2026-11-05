// IDEA-TOPIC-METRIC-1 (1.19.1, #1947) + TOPIC-CLUSTERS-DERIVED-1 (1.28.0, ACCURACY-FLEET-2a, agent_issues 2281) offline suite.
// Proves: the topic clusters are derived from the data (no fixed table: the worker source holds no IDEA_TOPIC_CLUSTERS), by a
// deterministic rule (same result in any row order; producer boilerplate dropped; terms grouped by co-occurrence; a seed
// nothing joins is dropped); a text goes to the first cluster that shares a term with it; no data gives no clusters and no
// value; the daily companion re-derives the clusters, caches them in ops_config idea_topic_clusters and recomputes
// metric_registry idea_topic_concentration_30d from ACCEPTed idea_proposals of the last 30 days over the idea text; a cache
// write failure is reported (status error with its reason), never swallowed, and the metric is still written.
// Run: node qnfo-cloud-ops/idea-topic.test.mjs   -> prints "N passed, 0 failed" (Node 22: node:sqlite)
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const IMPORT = 'import { connect } from "cloudflare:sockets";';
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
if (!src.includes(IMPORT)) throw new Error("worker.js import line changed: update the loader in this test");
const patched = src.replace(IMPORT, "var connect = function () { throw new Error('sockets are stubbed in this test'); };") +
  "\nexport { topicCluster as __cluster, topicTerms as __terms, deriveTopicClusters as __derive, loadTopicClusters as __load, ideaTopicConcentration as __conc, jobIdeaTopicMetric as __job, CRON_COMPANIONS as __comp, JOBS as __jobs, AMS_SCHEDULE as __sched, TOPIC_CACHE_KEY as __key };\n";
const mod = await import("data:text/javascript;base64," + Buffer.from(patched).toString("base64"));

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 400) : "")); } };

// 1. No fixed topic table remains (the issue's code probe).
ok(!src.includes("var IDEA_TOPIC_CLUSTERS = ["), "worker.js holds no IDEA_TOPIC_CLUSTERS table");

// 2. Terms: function words dropped, plurals folded, numbers dropped, accents folded.
ok(JSON.stringify(mod.__terms("The Glaciers of the moraines, 2024 Théories and theories")) === JSON.stringify(["glacier", "moraine", "theory"]), "terms: lower-case, stopwords and numbers out, plurals folded, accents folded, unique", mod.__terms("The Glaciers of the moraines, 2024 Théories and theories"));

// 3. Derivation from a fixture: a producer's boilerplate is dropped, co-occurring terms group, the order of rows does not matter.
const rows = [];
for (let i = 0; i < 5; i++) rows.push({ name: "auto-feed", idea: "Harvested from the feed: glacier moraine sediment layer " + i });
for (let i = 0; i < 5; i++) rows.push({ name: "auto-feed", idea: "Harvested from the feed: lattice braid anyon exchange " + i });
for (let i = 0; i < 4; i++) rows.push({ name: "owner-corpus", idea: "Lattice braid defects and their exchange rules, note " + i });
rows.push({ name: "owner", idea: "Seasonal ledger of household chores" });
rows.push({ name: "owner", idea: "Household ledger reconciliation" });
rows.push({ name: "owner", idea: "Ledger for the household garden" });
const d = mod.__derive(rows);
ok(d.docs === rows.length, "every row is a document", d.docs);
ok(d.template_terms.includes("harvested") && d.template_terms.includes("feed") && !d.template_terms.includes("glacier"), "a term in 90% of one producer's 10+ texts is boilerplate and dropped; a term in half of them is not", d.template_terms);
const labels = d.clusters.map((c) => c.label);
ok(labels[0] === "braid" && d.clusters[0].terms.includes("lattice") && d.clusters[0].terms.includes("exchange") && d.clusters[0].terms.includes("anyon"), "the most frequent terms seed the first cluster (ties alphabetical) and co-occurring terms join it", d.clusters);
ok(labels.includes("glacier") && d.clusters.find((c) => c.label === "glacier").terms.includes("moraine"), "a second co-occurrence group is its own cluster", d.clusters);
ok(labels.includes("household") && d.clusters.find((c) => c.label === "household").terms.includes("ledger"), "the owner's own small group is a cluster too", d.clusters);
ok(!labels.includes("harvested") && !labels.includes("feed"), "boilerplate never labels a cluster", labels);
ok(JSON.stringify(mod.__derive(rows.slice().reverse())) === JSON.stringify(d), "the derivation does not depend on row order");
const lone = mod.__derive([{ name: "a", idea: "solitary walrus" }, { name: "b", idea: "solitary heron" }, { name: "c", idea: "solitary bison" }]);
ok(lone.clusters.length === 0, "a frequent term nothing co-occurs with (a generic word) seeds no cluster", lone.clusters);
ok(mod.__derive([]).clusters.length === 0 && mod.__derive(null).clusters.length === 0, "no data: no clusters (no fallback topic list)");

// 4. Classifier over the derived clusters: first cluster sharing a term, else other.
ok(mod.__cluster("Braid group actions on glacier flow", d.clusters) === "braid", "first cluster wins when a text shares terms with two");
ok(mod.__cluster("Moraine dating", d.clusters) === "glacier", "a joined term places a text in its cluster");
ok(mod.__cluster("Urban mobility and bus timetables", d.clusters) === "other", "anything else is other");
ok(mod.__cluster("Braid", []) === "other", "no clusters: other");

// 5. Concentration: largest cluster share over the idea text; no clusters gives no value.
const c = mod.__conc([{ idea: "lattice braid" }, { idea: "glacier" }, { idea: "anyon exchange", rationale: "glacier glacier" }, { idea: "bus" }], d.clusters);
ok(c.accepted_30d === 4 && c.top === "braid" && c.share === 0.5 && c.by_cluster.braid === 2 && c.by_cluster.other === 1, "share is the largest cluster over all accepted items; only the idea text counts", c);
ok(mod.__conc([], d.clusters).share === null && mod.__conc([{ idea: "braid" }], []).share === null, "no rows or no clusters gives no value");

// 6. The job: re-derives (even over a fresh cache), caches in ops_config, reads only ACCEPT rows in 30 days, writes the registry row.
function stmtOn(dbx, sql) {
  let args = [];
  const q = sql.replace(/\?(\d+)/g, "?");
  const self = {
    bind(...a) { args = a; return self; },
    async all() { return { results: dbx.prepare(q).all(...args) }; },
    async first() { return dbx.prepare(q).get(...args) || null; },
    async run() { const r = dbx.prepare(q).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; }
  };
  return self;
}
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE idea_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, idea TEXT NOT NULL, contact TEXT, status TEXT DEFAULT 'new', ip_hash TEXT, created_at TEXT DEFAULT (datetime('now')), decision TEXT, score REAL, rationale TEXT, triaged_at TEXT);
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, last_value TEXT, last_refreshed TEXT, state TEXT);
  CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT DEFAULT (datetime('now')));
  INSERT INTO metric_registry (metric, layer, kind, last_value, last_refreshed) VALUES ('idea_topic_concentration_30d', 'fleet', 'guard', '0.588', '2026-10-04T09:14:00Z'), ('other_metric', 'fleet', 'x', '7', 'then');`);
const ins = db.prepare("INSERT INTO idea_proposals (name, idea, decision, rationale, created_at) VALUES (?, ?, ?, ?, ?)");
const iso = (dd) => new Date(Date.now() - dd * 864e5).toISOString();
const sq = (dd) => new Date(Date.now() - dd * 864e5).toISOString().slice(0, 19).replace("T", " ");
for (let i = 0; i < 3; i++) ins.run("owner-corpus", "Lattice braid exchange note " + i, "ACCEPT", "", iso(1 + i));
ins.run("auto-scan", "Glacier moraine dating", "ACCEPT", "", sq(2));
ins.run("auto-scan", "Glacier moraine flow", "ACCEPT", "", sq(3));
ins.run("auto-scan", "Glacier moraine survey", "ACCEPT", "braid braid", iso(4));
for (let i = 0; i < 4; i++) ins.run("auto-scan", "Lattice braid exchange scan " + i, "ACCEPT", "", iso(5 + i));
for (let i = 0; i < 3; i++) ins.run("intake:journal-x", "Sparrow flight energetics " + i, "ACCEPT", "", iso(6 + i));
ins.run("auto-scan", "Lattice braid under noise", "HOLD", "", iso(1));
ins.run("auto-scan", "Lattice braid old idea", "ACCEPT", "", iso(40));
ins.run("auto-scan", "Lattice braid very old idea", "ACCEPT", "", iso(120));
db.prepare("INSERT INTO ops_config (key, value) VALUES (?, ?)").run(mod.__key, JSON.stringify({ derived_at: new Date().toISOString(), clusters: [{ label: "stale", terms: ["glacier"] }] }));
const env = { AUDIT: { prepare: (sql) => stmtOn(db, sql) } };
const r = await mod.__job(env);
const row = db.prepare("SELECT last_value, last_refreshed FROM metric_registry WHERE metric='idea_topic_concentration_30d'").get();
ok(r.status === "ok" && r.notes.accepted_30d === 10 && r.notes.owner_sourced_30d === 3 && r.notes.share === 0.4 && r.notes.derived_docs === 11, "job derives over 90 days from the generated accepts only (11: the 3 owner rows, the HOLD and the 120-day-old row excluded, TOPIC-DERIVE-GENERATED-1) and measures the 10 generated accepts of 30 days at share 0.4, the 3 owner rows counted apart (OWNER-EXEMPT-METRIC-1)", r.notes);
ok(r.notes.all_sources.accepted_30d === 13 && r.notes.all_sources.top === "braid" && r.notes.all_sources.share === 0.538, "the all-sources share (owner rows included) rides in the notes, nothing is hidden", r.notes.all_sources);
ok(!r.notes.clusters.includes("stale") && r.notes.clusters.length >= 2, "the daily job re-derives even when the cache is fresh", r.notes.clusters);
ok(r.notes.by_cluster.glacier === 3, "the rationale does not move a row (glacier rows whose rationale says braid stay glacier)", r.notes.by_cluster);
const cached = JSON.parse(db.prepare("SELECT value FROM ops_config WHERE key = ?").get(mod.__key).value);
ok(cached.docs === 11 && JSON.stringify(cached.clusters) === JSON.stringify(r.notes.cluster_terms) && typeof cached.derived_at === "string", "the derived clusters are cached in ops_config for idea-hub", cached);
ok(row.last_value === "0.4" && row.last_refreshed !== "2026-10-04T09:14:00Z", "registry row updated", row);
ok(db.prepare("SELECT last_value FROM metric_registry WHERE metric='other_metric'").get().last_value === "7", "no other registry row touched");

// 7. loadTopicClusters: a fresh cache is served; a stale or broken one is re-derived.
const fresh = await mod.__load(env.AUDIT, false);
ok(fresh.source === "cache" && JSON.stringify(fresh.clusters) === JSON.stringify(cached.clusters), "a fresh cache is read, not re-derived", fresh.source);
db.prepare("UPDATE ops_config SET value = ? WHERE key = ?").run(JSON.stringify({ derived_at: iso(5), clusters: [] }), mod.__key);
ok((await mod.__load(env.AUDIT, false)).source === "derived", "a cache older than 72 h is re-derived");
db.prepare("UPDATE ops_config SET value = 'not json' WHERE key = ?").run(mod.__key);
const broken = await mod.__load(env.AUDIT, false);
ok(broken.source === "derived" && /^read: /.test(broken.cache_error || "") && broken.clusters.length >= 2, "an unreadable cache is reported and re-derived", broken);

// 8. A cache write failure is reported, never swallowed; the metric is still written.
const db2 = new DatabaseSync(":memory:");
db2.exec(`CREATE TABLE idea_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, idea TEXT NOT NULL, decision TEXT, rationale TEXT, created_at TEXT);
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT);
  INSERT INTO metric_registry VALUES ('idea_topic_concentration_30d', '0.9', 'then');`);
const ins2 = db2.prepare("INSERT INTO idea_proposals (name, idea, decision, created_at) VALUES (?, ?, 'ACCEPT', ?)");
for (let i = 0; i < 3; i++) ins2.run("owner", "Lattice braid exchange " + i, iso(1));
for (let i = 0; i < 5; i++) ins2.run("auto-scan", "Lattice braid exchange " + i, iso(1));
for (let i = 0; i < 5; i++) ins2.run("auto-scan", "Glacier moraine survey " + i, iso(1));
const r2 = await mod.__job({ AUDIT: { prepare: (sql) => stmtOn(db2, sql) } });
ok(r2.status === "error" && /ops_config idea_topic_clusters cache write: /.test(r2.reason || "") && db2.prepare("SELECT last_value FROM metric_registry").get().last_value === "0.5", "no ops_config table: status error with the reason, metric still written", r2);

// 9. No accepted ideas: no clusters, no value, registry untouched.
const db3 = new DatabaseSync(":memory:");
db3.exec(`CREATE TABLE idea_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, idea TEXT NOT NULL, decision TEXT, rationale TEXT, created_at TEXT);
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT);
  CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
  INSERT INTO metric_registry VALUES ('idea_topic_concentration_30d', '0.9', 'then');`);
const r3 = await mod.__job({ AUDIT: { prepare: (sql) => stmtOn(db3, sql) } });
ok(r3.status === "ok" && /no derived topic clusters/.test(r3.notes.skipped || "") && db3.prepare("SELECT last_value FROM metric_registry").get().last_value === "0.9", "no accepted ideas: skipped, registry untouched", r3);

// 9b. OWNER-EXEMPT-METRIC-1: owner-sourced rows are exempt; fewer than 10 generated accepts leaves the registry untouched.
const db4 = new DatabaseSync(":memory:");
db4.exec(`CREATE TABLE idea_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, idea TEXT NOT NULL, decision TEXT, rationale TEXT, created_at TEXT);
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT);
  CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
  INSERT INTO metric_registry VALUES ('idea_topic_concentration_30d', '0.9', 'then');`);
const ins4 = db4.prepare("INSERT INTO idea_proposals (name, idea, decision, created_at) VALUES (?, ?, 'ACCEPT', ?)");
for (let i = 0; i < 32; i++) ins4.run("owner-corpus", "Lattice braid exchange note " + i, iso(1));
for (let i = 0; i < 8; i++) ins4.run("owner-corpus", "Quasar jet spectra " + i, iso(1));
for (let i = 0; i < 5; i++) ins4.run("auto-scan", "Glacier moraine survey " + i, iso(1));
for (let i = 0; i < 4; i++) ins4.run("auto-scan", "Alpine lichen growth " + i, iso(1));
const r4 = await mod.__job({ AUDIT: { prepare: (sql) => stmtOn(db4, sql) } });
ok(r4.status === "ok" && /fewer than 10 generated/.test(r4.notes.skipped || "") && db4.prepare("SELECT last_value FROM metric_registry").get().last_value === "0.9" && r4.notes.owner_sourced_30d === 40, "9 generated accepts: skipped with the reason, registry untouched, the 40 owner rows counted apart", r4.notes);
ins4.run("auto-scan", "Alpine lichen growth 4", iso(1));
const r5 = await mod.__job({ AUDIT: { prepare: (sql) => stmtOn(db4, sql) } });
ok(r5.notes.accepted_30d === 10 && r5.notes.top === "glacier" && r5.notes.share === 0.5 && r5.notes.all_sources.accepted_30d === 50 && r5.notes.all_sources.top === "other" && r5.notes.all_sources.share === 0.8 && db4.prepare("SELECT last_value FROM metric_registry").get().last_value === "0.5", "10 generated accepts: the metric is the generated share (0.5) while the all-sources share (0.8: the 40 owner notes fall in no cluster derived from the generated accepts) stays visible", r5.notes);
ok(db4.prepare("SELECT COUNT(*) n FROM idea_proposals WHERE lower(name) LIKE '%owner%'").get().n === 40, "fixture control: 40 owner rows");

// 9c. TOPIC-DERIVE-GENERATED-1 (agent_issues 2047, trigger 1238, 2026-11-04): the clusters are derived from the generated accepts, not from the owner's notebook.
// The failure: 1,211 of 1,333 derivation documents were owner-corpus rows, the first cluster took the notebook's generic vocabulary (model, matter, derive, state ...)
// and 21 of the 29 generated accepts fell in it (0.724) although 12 were about quantum physics (0.414). Fixture: 60 notebook rows in one generic vocabulary, 12 generated
// accepts in two topics, ten of which carry a generic word of the notebook. Derived from everything the first cluster is the notebook's and holds those ten (share 0.833);
// derived from the generated rows the clusters are the two topics and the share is 0.5.
const db5 = new DatabaseSync(":memory:");
db5.exec(`CREATE TABLE idea_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, idea TEXT NOT NULL, decision TEXT, rationale TEXT, created_at TEXT);
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT);
  CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
  INSERT INTO metric_registry VALUES ('idea_topic_concentration_30d', '0.724', 'then');`);
const ins5 = db5.prepare("INSERT INTO idea_proposals (name, idea, decision, created_at) VALUES (?, ?, 'ACCEPT', ?)");
// The notebook's words rotate (no word is in 90% of its rows, so none is dropped as the producer's boilerplate), as the real notebook's did.
for (let i = 0; i < 60; i++) ins5.run(i % 4 < 2 ? "owner-corpus" : "owner-chat", "Item: " + [i % 5 ? "model" : "", i % 2 === 0 ? "matter" : "", i % 3 === 0 ? "state" : "", i % 7 < 4 ? "derive" : ""].filter(Boolean).join(" "), iso(2));
// Twelve generated accepts in two topics; ten of them also carry a generic word the notebook uses (state, matter).
for (let i = 0; i < 6; i++) ins5.run("auto-scan", "Quantum error correction decoder variant " + i + (i < 5 ? " in the state space" : ""), iso(3));
for (let i = 0; i < 6; i++) ins5.run("intake:arxiv-x", "Glacier moraine dating survey " + i + (i < 5 ? " of matter transport" : ""), iso(3));
const ownerBlind = await mod.__job({ AUDIT: { prepare: (sql) => stmtOn(db5, sql) } });
const terms5 = ownerBlind.notes.cluster_terms.flatMap((c) => c.terms);
ok(ownerBlind.notes.derived_docs === 12, "the derivation reads the 12 generated accepts and none of the 60 owner rows", ownerBlind.notes);
const clusterOf5 = (w) => ownerBlind.notes.cluster_terms.findIndex((c) => c.terms.includes(w));
ok(!terms5.includes("model") && !terms5.includes("derive") && clusterOf5("quantum") >= 0 && clusterOf5("glacier") >= 0 && clusterOf5("quantum") !== clusterOf5("glacier") && clusterOf5("state") === clusterOf5("quantum") && clusterOf5("matter") === clusterOf5("glacier"), "no cluster is the notebook's: the two generated topics are the clusters and the generic words join the topic they occur in", ownerBlind.notes.cluster_terms);
ok(ownerBlind.notes.share === 0.5 && ownerBlind.notes.accepted_30d === 12 && ownerBlind.notes.owner_sourced_30d === 60 && db5.prepare("SELECT last_value FROM metric_registry").get().last_value === "0.5", "the metric reads 0.5 (6 of 12), not the 1.0 of an owner-derived cluster set", ownerBlind.notes);
ok(mod.__cluster("Item: model derive", ownerBlind.notes.cluster_terms) === "other", "an owner note in the notebook's vocabulary is not placed in a generated topic");
const pooled = mod.__derive(db5.prepare("SELECT name, idea FROM idea_proposals ORDER BY id").all());
const pooledConc = mod.__conc(db5.prepare("SELECT idea FROM idea_proposals WHERE name NOT LIKE '%owner%'").all(), pooled.clusters);
ok(pooled.clusters[0].terms.includes("model") && pooled.clusters[0].terms.includes("state") && pooledConc.top === pooled.clusters[0].label && pooledConc.share > 0.8, "control: derived from everything (the old rule) the first cluster is the notebook's and 10 of the 12 generated accepts fall in it (share 0.833)", [pooled.clusters, pooledConc]);
const hubSrc5 = readFileSync(new URL("../idea-hub/worker.js", import.meta.url), "utf8");
ok(src.includes("lower(COALESCE(name, '')) NOT LIKE '%owner%'") && hubSrc5.includes("lower(COALESCE(name, '')) NOT LIKE '%owner%'"), "both workers derive over the non-owner producers (the shared block's TOPIC_GENERATED_SQL)");

// 9d. TOPIC-TEMPLATE-FAMILY-1 (2026-11-05): the radar intake names one producer per feed (intake:<feed>) and every feed appends the same trailer to its text. Each feed alone has
// fewer than 10 texts, so the producer-boilerplate rule never fired and the trailer (source, http, fits) became a topic that held every intake text, whatever its field (2026-11-04:
// 15 intake texts from seven fields, 11 of the 29 generated accepts). A producer is the name up to its first ":" now.
const feedRows = [];
const feedTopics = ["Glacier moraine dating", "Lattice braid exchange", "Sparrow flight energetics"];
for (let i = 0; i < 12; i++) feedRows.push({ name: "intake:feed-" + (i % 6), idea: feedTopics[i % 3] + " study " + i + ". Source: http link fits" });
const fam = mod.__derive(feedRows);
ok(["source", "http", "fits", "link"].every((w) => fam.template_terms.includes(w)), "the trailer shared by the intake:<feed> producers is dropped as one producer's boilerplate", fam.template_terms);
ok(fam.clusters.length === 3 && !fam.clusters.some((c) => c.terms.includes("source") || c.terms.includes("http") || c.terms.includes("fits")), "the three fields stay three clusters; the trailer is no cluster", fam.clusters);
const famShare = mod.__conc(feedRows.map((r) => ({ idea: r.idea })), fam.clusters);
ok(famShare.share === 0.333 && famShare.by_cluster.other === undefined, "the share is the true 4 of 12, not the whole intake in one trailer cluster", famShare);
const lowFeeds = mod.__derive(feedRows.slice(0, 9));
ok(lowFeeds.template_terms.length === 0, "fewer than 10 texts in the family: no boilerplate is inferred", lowFeeds.template_terms);
ok(mod.__derive([{ name: "auto-feed", idea: "x" }]).docs === 1 && mod.__derive([{ idea: "Harvested feed glacier" }]).docs === 1, "names without a colon (or no name) are their own producer, as before");

// 10. Wiring: the metric keeps its own daily schedule slot.
ok(typeof mod.__jobs["idea-topic-metric"] === "function", "job is in the dispatch map");
ok(mod.__sched["idea-topic-metric"] && mod.__sched["idea-topic-metric"].days === "*" && mod.__sched["idea-topic-metric"].times.join() === "06:25", "runs in its own daily slot");
ok(!(mod.__comp["quality-score"] || []).includes("idea-topic-metric"), "does not run as an hourly quality-score companion");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
