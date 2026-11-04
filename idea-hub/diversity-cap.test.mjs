// IDEA-DIVERSITY-CAP-1 (idea-hub 1.5.8, #1947, trigger 1238 idea_topic_concentration_30d) offline suite. Runs the worker's
// own triageProposals in a vm against an in-memory SQLite D1 and a counting Workers AI stub, and the metric's own
// classifier (qnfo-cloud-ops TOPIC-CLUSTERS-DERIVED-1 shared block + ideaTopicConcentration, sliced from that file) on the
// same rows. TOPIC-CLUSTERS-DERIVED-1 (idea-hub 1.10.0, agent_issues 2281): the clusters are data, so this suite supplies
// them as a fixture through the ops_config idea_topic_clusters cache the workers read.
// Proves: the shared derivation block is identical in both workers and neither holds a fixed topic table; an ACCEPT from any
// source whose cluster would exceed half of the 30-day accepts waits as deferred_diversity with its score kept, is not queued
// for research and is not counted by the metric; owner-corpus rows are prioritized ahead of generated scans; other clusters
// still pass; below DIVERSITY_MIN_N nothing is held; held rows are
// released best score first, with no model call, only when the share allows (an ai_spend cap no longer matters, 1.6.0), with the hold
// note stripped; a held row that left the 30-day window becomes a terminal HOLD and is never released; the run publishes
// the held count and the share, and that share equals the metric's reading of the same rows; a missing cache is re-derived
// from the accepted ideas and written back; with no derived clusters nothing is held. Section 14 (DIVERSITY-GENERATED-CAP-1, 1.17.1): a generated
// proposal is also held when its cluster would exceed half of the 30-day GENERATED accepts (owner producers and "other" are not), released when that share allows.
// Run: node --no-warnings idea-hub/diversity-cap.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { stripWorkerDefaultExport } from "../scripts/worker-source-test.mjs";
const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };

// 1. Parity with the metric's classifier (qnfo-cloud-ops jobIdeaTopicMetric): one shared derivation block, no fixed table.
const hubSrc = readFileSync(join(here, "worker.js"), "utf8");
const opsSrc = readFileSync(join(here, "..", "qnfo-cloud-ops", "worker.js"), "utf8");
const BEGIN = "// TOPIC-CLUSTERS-DERIVED-1 BEGIN shared block.", END = "// TOPIC-CLUSTERS-DERIVED-1 END shared block.";
const block = (src) => { const a = src.indexOf(BEGIN), b = src.indexOf(END, a); return a < 0 || b < a || src.indexOf(BEGIN, a + 1) >= 0 ? null : src.slice(a, b + END.length); };
ok(block(hubSrc) !== null && block(hubSrc) === block(opsSrc), "the TOPIC-CLUSTERS-DERIVED-1 shared block in idea-hub is identical to qnfo-cloud-ops (the metric's classifier)", [String(block(hubSrc)).length, String(block(opsSrc)).length]);
ok(!hubSrc.includes("var IDEA_TOPIC_CLUSTERS = [") && !opsSrc.includes("var IDEA_TOPIC_CLUSTERS = ["), "neither worker holds the fixed IDEA_TOPIC_CLUSTERS table (agent_issues 2281 code probe)");
const oa = opsSrc.indexOf(BEGIN), ob = opsSrc.indexOf("async function jobIdeaTopicMetric", oa);
const metric = {};
vm.runInNewContext(opsSrc.slice(oa, ob) + "\nm.ideaTopicConcentration = ideaTopicConcentration;", { m: metric, __name: () => {} });
ok(typeof metric.ideaTopicConcentration === "function", "the metric's ideaTopicConcentration loads from qnfo-cloud-ops");
// The clusters as data (what the derivation caches in ops_config idea_topic_clusters); terms are topicTerms output.
const CLUSTERS = [{ label: "quantum", terms: ["quantum", "qubit"] }, { label: "ultrametric", terms: ["ultrametric", "adic", "bruhat", "adelic", "archimedean"] }, { label: "energy", terms: ["landauer", "entropy"] }];

// 2. Harness.
const src = stripWorkerDefaultExport(hubSrc.replace(/export default\s*\{/, "var __default = {"));
const sb = { console: { log: () => {}, error: () => {} }, Date, JSON, Math, Number, String, RegExp, Set, Map, Array, Object, Promise, URL, Response, Request, Headers, TextEncoder, crypto, fetch: async () => { throw new Error("no network"); } };
vm.createContext(sb);
vm.runInContext(src + "\n__x = { triageProposals, proposalCluster, diversityBlocks, loadTopicClusters, TOPIC_CACHE_KEY, DIVERSITY_MAX_SHARE, DIVERSITY_MIN_N };", sb);
const api = sb.__x;
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE idea_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, idea TEXT NOT NULL, contact TEXT, status TEXT DEFAULT 'new', ip_hash TEXT, created_at TEXT, decision TEXT, score REAL, rationale TEXT, triaged_at TEXT);
CREATE TABLE fleet_budget (node_class TEXT PRIMARY KEY, cap REAL, target REAL, current REAL, unit TEXT, updated_at TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TABLE fleet_heartbeat (worker TEXT PRIMARY KEY, version TEXT, ts TEXT, ok INTEGER);
CREATE TABLE research_queue (id TEXT PRIMARY KEY, source TEXT, source_id TEXT, idea TEXT, summary TEXT, score REAL, decision TEXT, status TEXT, created_at TEXT, UNIQUE(source, source_id));
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);`);
db.prepare("INSERT INTO ops_config (key, value) VALUES (?, ?)").run(api.TOPIC_CACHE_KEY, JSON.stringify({ version: 1, derived_at: new Date().toISOString(), docs: 0, clusters: CLUSTERS }));
const d1 = { prepare(sql) { let a = []; const q = sql.replace(/\?(\d+)/g, "?"); const st = { bind(...x) { a = x; return st; }, async all() { return { results: db.prepare(q).all(...a) }; }, async first() { return db.prepare(q).get(...a) ?? null; }, async run() { const r = db.prepare(q).run(...a); return { meta: { changes: Number(r.changes) } }; } }; return st; } };
const calls = [];
let card = { novelty: 0.9, technical_merit: 0.9, impact_potential: 0.8, exposure_potential: 0.8, feasibility: 0.9, risk: 0.1, rationale: "solid", hook: "h" };
const AI = { async run(model) { calls.push(model); return { response: JSON.stringify(card) }; } };
const env = { QNFO_AUDIT: d1, AI };
db.prepare("INSERT INTO fleet_budget (node_class, cap, current) VALUES ('ai_spend:total', 150, 10)").run();
const ago = (days) => new Date(Date.now() - days * 86400e3).toISOString();
const add = (name, idea, at, contact) => Number(db.prepare("INSERT INTO idea_proposals (name, idea, contact, status, created_at) VALUES (?, ?, ?, 'new', ?)").run(name, idea, contact || "", at).lastInsertRowid);
const accepted = (name, idea, at) => db.prepare("INSERT INTO idea_proposals (name, idea, contact, status, created_at, decision, score, rationale, triaged_at) VALUES (?, ?, '', 'triaged_accepted', ?, 'ACCEPT', 0.8, 'seed', ?)").run(name, idea, at, at);
const row = (id) => db.prepare("SELECT * FROM idea_proposals WHERE id = ?").get(id);
const queued = (id) => db.prepare("SELECT COUNT(*) n FROM research_queue WHERE source = 'proposal' AND source_id = ?").get(String(id)).n;
const metricNow = () => metric.ideaTopicConcentration(db.prepare("SELECT name, idea, rationale FROM idea_proposals WHERE decision = 'ACCEPT' AND replace(substr(created_at, 1, 19), 'T', ' ') >= datetime('now', '-30 day')").all(), CLUSTERS);

// 3. Below DIVERSITY_MIN_N accepts nothing is held, even a lopsided mix.
for (let i = 0; i < 5; i++) accepted("auto-scan", "Surface code decoder variant " + i + " for quantum memories", ago(3));
let q1 = add("auto-scan", "Biased-noise quantum error correction thresholds", ago(0.1));
let out = await api.triageProposals(env);
ok(row(q1).status === "triaged_accepted" && queued(q1) === 1 && out.diversity_held === 0, "with fewer than DIVERSITY_MIN_N accepts in the window a quantum ACCEPT passes", out);

// 4. 7 quantum of 12 (plus the one above = 7 of 12): the next generated quantum ACCEPT is held, score kept, not queued.
accepted("auto-reentry", "Why ultrametric trees encode hierarchy", ago(4));
accepted("auto-reentry", "p-adic analysis of scaling ratios", ago(5));
accepted("think-loop", "Landauer limits for ratio-based operations", ago(6));
accepted("auto-miner", "Graph colouring bounds for sparse expanders", ago(7));
accepted("auto-scan", "Topological qubit braiding statistics", ago(8));
accepted("auto-reentry", "Entropy production in open systems", ago(9));
let m0 = metricNow();
ok(m0.accepted_30d === 12 && m0.by_cluster.quantum === 7, "seeded window: 7 quantum of 12 accepts", m0);
const held1 = add("auto-scan", "Concatenated quantum codes under leakage", ago(0.05));
calls.length = 0;
out = await api.triageProposals(env);
let r = row(held1);
ok(calls.length >= 2, "the held row was scored by the models (the hold comes after the ACCEPT score)", calls.length);
ok(r.status === "deferred_diversity" && r.decision === "DEFER-DIVERSITY" && r.score > 0.7 && queued(held1) === 0, "a generated quantum ACCEPT that would make quantum 8 of 13 waits as deferred_diversity, score kept, not queued", r);
ok(/^\[diversity hold [^\]]*quantum would be 62% of 30-day accepts, cap 50%\] solid$/.test(r.rationale), "the hold note says why and keeps the model rationale", r.rationale);
ok(out.diversity_held === 1 && out.diversity && out.diversity.top === "quantum" && out.diversity.share === m0.share, "the run reports the hold and the same share the metric reads", out);
ok(metricNow().accepted_30d === 12, "the held row is not counted by the metric");

// 5. Owner and intake rows obey the cap too; another cluster still passes.
const own = add("owner-chat", "Owner note: quantum Zeno bounds on cryogenic logic", ago(0.04), "owner");
const intake = add("intake:physics-feeds", "Qubit thermometry in biology labs", ago(0.03));
const ultra = add("auto-scan", "Bruhat-Tits buildings as indexing structures", ago(0.02));
out = await api.triageProposals(env);
ok(row(own).status === "deferred_diversity" && row(own).decision === "DEFER-DIVERSITY" && queued(own) === 0, "an owner-authored idea cannot bypass the 50% cap", row(own));
ok(row(intake).status === "deferred_diversity" && row(intake).decision === "DEFER-DIVERSITY" && queued(intake) === 0, "an intake:<family> idea cannot bypass the 50% cap", row(intake));
ok(row(ultra).status === "triaged_accepted" && queued(ultra) === 1, "a generated ultrametric ACCEPT passes while quantum is capped", row(ultra).status);
ok(row(held1).status === "deferred_diversity" && out.diversity_released === 0, "held quantum rows stay held while quantum is above half", out);

// 6. A HOLD decision is untouched by the cap.
card = Object.assign({}, card, { novelty: 0.1, technical_merit: 0.1 });
const low = add("auto-scan", "Yet another quantum decoder heuristic", ago(0.01));
out = await api.triageProposals(env);
ok(row(low).status === "triaged_hold" && row(low).decision === "HOLD", "a low-scoring proposal is a plain HOLD, not a diversity hold", row(low));
card = Object.assign({}, card, { novelty: 0.9, technical_merit: 0.9 });

// 7. A second held row with a lower score; then enough non-quantum accepts that exactly one quantum release fits.
const held2 = add("auto-scan", "Qubit recycling in distillation factories", ago(0.009));
card = Object.assign({}, card, { novelty: 0.85, technical_merit: 0.85 });
out = await api.triageProposals(env);
card = Object.assign({}, card, { novelty: 0.9, technical_merit: 0.9 });
ok(row(held2).status === "deferred_diversity" && row(held2).score < row(held1).score, "a second, lower-scored quantum ACCEPT is held too", [row(held1).score, row(held2).score]);
// quantum 9 of 15 now; 4 non-quantum accepts make it 9 of 19, so one more quantum is 10 of 20 = 0.5 (allowed) and a second is 11 of 21 (blocked).
for (let i = 0; i < 4; i++) accepted("auto-reentry", "Adelic product formula variant " + i, ago(2));
db.prepare("UPDATE fleet_budget SET current = 999 WHERE node_class = 'ai_spend:total'").run();
calls.length = 0;
out = await api.triageProposals(env);
// BUDGET-SOFT-ROUTE-1 (idea-hub 1.6.0): a breached ai_spend cap no longer holds the release back.
r = row(held1);
ok(out.budget_breached === true && out.diversity_released === 3 && r.status === "triaged_accepted" && r.decision === "ACCEPT" && queued(held1) === 1, "even while an ai_spend cap is breached, the share allows three held quantum ideas to be released and queued", { out, r });
db.prepare("UPDATE fleet_budget SET current = 10 WHERE node_class = 'ai_spend:total'").run();
ok(r.rationale === "solid" && calls.length === 0, "the release makes no model call and strips the hold note", { rationale: r.rationale, calls: calls.length });
ok(row(held2).status === "deferred_diversity" && queued(held2) === 0, "the lower-scored held row stays held: a second release would exceed the cap", row(held2).status);
const m1 = metricNow();
ok(m1.by_cluster.quantum === 10 && m1.accepted_30d === 20 && m1.share === 0.5 && out.diversity.share === m1.share, "after the release the metric reads 10 of 20 = 0.5, the same share the run publishes", { m1, d: out.diversity });

// 8. A held row that leaves the 30-day window is a terminal HOLD, never released.
db.prepare("UPDATE idea_proposals SET created_at = ? WHERE id = ?").run(ago(31), held2);
for (let i = 0; i < 6; i++) accepted("auto-reentry", "Non-archimedean metric learning " + i, ago(1));
out = await api.triageProposals(env);
r = row(held2);
ok(r.status === "triaged_hold" && r.decision === "HOLD" && /^\[diversity hold expired/.test(r.rationale) && queued(held2) === 0 && out.diversity_expired === 1, "a held row older than the window becomes a terminal HOLD, even when the share would now allow it", { r, out });

// 9. Published state.
const ev = JSON.parse(db.prepare("SELECT meta FROM cloud_ops_events WHERE id = 'idea-triage-budget'").get().meta);
ok(ev.diversity_held_total === 0 && ev.diversity && typeof ev.diversity.share === "number" && "diversity_released_run" in ev, "the run publishes held count and share in cloud_ops_events idea-triage-budget", ev);
ok(db.prepare("SELECT COUNT(*) n FROM idea_proposals WHERE status = 'deferred_diversity'").get().n === 0, "no row is left in deferred_diversity");

// 10. Clusters are data: the run read the cache; a missing cache is re-derived from the accepted ideas and written back.
ok(out.diversity.topics && out.diversity.topics.source === "cache" && out.diversity.clusters.join(",") === "quantum,ultrametric,energy", "triage read the cached clusters", out.diversity);
db.prepare("DELETE FROM ops_config").run();
out = await api.triageProposals(env);
const cacheRow = db.prepare("SELECT value FROM ops_config WHERE key = ?").get(api.TOPIC_CACHE_KEY);
const rederived = cacheRow && JSON.parse(cacheRow.value);
ok(out.diversity.topics.source === "derived" && rederived && rederived.docs > 0 && Array.isArray(rederived.clusters) && rederived.clusters.length > 0 && out.diversity.clusters.join(",") === rederived.clusters.map((c) => c.label).join(","), "with no cache, triage derives the clusters from the accepted ideas and writes the cache", { topics: out.diversity.topics, clusters: rederived && rederived.clusters });
ok(rederived.clusters.every((c) => c.terms.length >= 2 && c.terms[0] === c.label), "each derived cluster is labelled by its seed and has a co-occurring term", rederived.clusters);

// 11. No derived clusters (no accepted ideas): every text is other and nothing is held.
ok(api.proposalCluster("Concatenated quantum codes", []) === "other", "no clusters: other");
ok(api.diversityBlocks({ n: 50, by: { other: 50 }, clusters: [] }, "other") === false, "no clusters: the cap holds nothing, even at a 100% share");
ok(api.diversityBlocks({ n: 50, by: { quantum: 50 }, clusters: CLUSTERS }, "quantum") === true, "with clusters the cap still holds");

// 12. Owner-corpus proposals win the one available slot ahead of older generated scans.
db.prepare("DELETE FROM idea_proposals").run();
db.prepare("DELETE FROM research_queue").run();
db.prepare("INSERT INTO ops_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
  .run(api.TOPIC_CACHE_KEY, JSON.stringify({ version: 1, derived_at: new Date().toISOString(), docs: 0, clusters: CLUSTERS }));
for (let i = 0; i < 5; i++) accepted("auto-scan", "Quantum decoder threshold " + i, ago(i + 1));
for (let i = 0; i < 6; i++) accepted("auto-reentry", "Ultrametric structure " + i, ago(i + 6));
const oldScan = add("auto-scan", "Quantum threshold for a new decoder family", ago(10));
const ownerCorpus = add("owner-corpus", "Quantum threshold from the owner's research notebook", ago(1), "owner");
out = await api.triageProposals(env);
ok(row(ownerCorpus).status === "triaged_accepted" && queued(ownerCorpus) === 1, "the owner-corpus proposal uses the available share before the older scan", row(ownerCorpus));
ok(row(oldScan).status === "deferred_diversity" && queued(oldScan) === 0, "the older generated scan waits when it would exceed the share after owner-corpus acceptance", row(oldScan));
ok(out.diversity.share === 0.5 && metricNow().share === 0.5, "owner-corpus priority still preserves the exact 50% metric cap", { out: out.diversity, metric: metricNow() });

// 13. Owner-corpus held proposals also win release over a higher-scored generated scan.
db.prepare("DELETE FROM idea_proposals").run();
db.prepare("DELETE FROM research_queue").run();
for (let i = 0; i < 5; i++) accepted("auto-scan", "Quantum decoder threshold " + i, ago(i + 1));
for (let i = 0; i < 6; i++) accepted("auto-reentry", "Ultrametric structure " + i, ago(i + 6));
const deferredScan = add("auto-scan", "Quantum threshold for a generated decoder family", ago(2));
const deferredCorpus = add("owner-corpus", "Quantum threshold from the owner's notebook", ago(1), "owner");
db.prepare("UPDATE idea_proposals SET status='deferred_diversity', decision='DEFER-DIVERSITY', score=0.99, rationale='[diversity hold seeded] solid' WHERE id=?").run(deferredScan);
db.prepare("UPDATE idea_proposals SET status='deferred_diversity', decision='DEFER-DIVERSITY', score=0.1, rationale='[diversity hold seeded] solid' WHERE id=?").run(deferredCorpus);
out = await api.triageProposals(env);
ok(row(deferredCorpus).status === "triaged_accepted" && queued(deferredCorpus) === 1, "a lower-scored owner-corpus row wins release over the scan", row(deferredCorpus));
ok(row(deferredScan).status === "deferred_diversity" && queued(deferredScan) === 0, "the higher-scored scan remains held after the corpus uses the available share", row(deferredScan));
ok(out.diversity.share === 0.5 && metricNow().share === 0.5, "releasing owner-corpus first preserves the same 50% metric cap", { out: out.diversity, metric: metricNow() });

// 14. DIVERSITY-GENERATED-CAP-1 (1.17.1, agent_issues 2047, trigger 1238): the cap also binds the population the metric measures. 40 owner-corpus notes in one cluster (energy)
// leave the all-sources share of quantum at 6 of 50, so the all-sources check never held a generated quantum accept while the 10 generated accepts were 6 quantum (the
// metric: 0.6). The generated check holds the next generated quantum accept, lets other clusters and the owner's notes through, and releases when the generated share allows.
db.prepare("DELETE FROM idea_proposals").run();
db.prepare("DELETE FROM research_queue").run();
db.prepare("INSERT INTO ops_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
  .run(api.TOPIC_CACHE_KEY, JSON.stringify({ version: 1, derived_at: new Date().toISOString(), docs: 0, clusters: CLUSTERS }));
for (let i = 0; i < 40; i++) accepted("owner-corpus", "Landauer entropy bound note " + i, ago(1 + (i % 20)));
for (let i = 0; i < 6; i++) accepted("auto-scan", "Quantum decoder threshold " + i, ago(2 + i));
for (let i = 0; i < 4; i++) accepted("auto-reentry", "Ultrametric structure " + i, ago(8 + i));
const mixG = { n: 50, by: { energy: 40, quantum: 6, ultrametric: 4 }, gen_n: 10, gen_by: { quantum: 6, ultrametric: 4 }, clusters: CLUSTERS };
ok(api.diversityBlocks(mixG, "quantum") === false, "control: the all-sources check alone does not hold a quantum accept (7 of 51)");
ok(api.diversityBlocks(mixG, "quantum", "auto-scan") === true, "a generated quantum accept is held by the generated check (7 of 11 generated accepts)");
ok(api.diversityBlocks(mixG, "quantum", "owner-corpus") === false && api.diversityBlocks(mixG, "quantum", "owner-chat") === false, "the owner's own producers are not held by the generated check");
ok(api.diversityBlocks(mixG, "ultrametric", "auto-reentry") === false, "another generated cluster passes (5 of 11)");
ok(api.diversityBlocks({ n: 50, by: { energy: 40, other: 10 }, gen_n: 10, gen_by: { other: 10 }, clusters: CLUSTERS }, "other", "auto-scan") === false, "'other' is never held by the generated check");
ok(api.diversityBlocks({ n: 50, by: { energy: 41, quantum: 9 }, gen_n: 9, gen_by: { quantum: 9 }, clusters: CLUSTERS }, "quantum", "auto-scan") === false, "below DIVERSITY_MIN_N generated accepts the generated check holds nothing");
const gHeld = add("auto-scan", "Quantum threshold for a new decoder family", ago(0.05));
const gPass = add("auto-reentry", "Ultrametric structure of hierarchical codes", ago(0.04));
const oPass = add("owner-corpus", "Quantum threshold from the notebook", ago(0.03), "owner");
out = await api.triageProposals(env);
ok(row(gHeld).status === "deferred_diversity" && row(gHeld).decision === "DEFER-DIVERSITY" && queued(gHeld) === 0 && /^\[diversity hold [^\]]*quantum would be 64% of 30-day generated accepts, cap 50%\] solid$/.test(row(gHeld).rationale), "the generated quantum accept waits, and the note names the generated population", row(gHeld));
ok(row(gPass).status === "triaged_accepted" && queued(gPass) === 1, "a generated ultrametric accept passes", row(gPass));
ok(row(oPass).status === "triaged_accepted" && queued(oPass) === 1, "an owner-corpus quantum note passes: only the all-sources check applies to it", row(oPass));
ok(out.diversity.generated && out.diversity.generated.n === 11 && out.diversity.generated.top === "quantum" && out.diversity.generated.by_cluster.quantum === 6 && out.diversity.generated.by_cluster.ultrametric === 5 && out.diversity.n === 52, "the run publishes the generated mix next to the all-sources mix (the owner note is not in the generated count)", out.diversity);
// Four more generated accepts in the energy cluster: quantum is 6 of 15, so one more is 7 of 16 and the held row is released with no model call.
for (let i = 0; i < 4; i++) accepted("auto-reentry", "Landauer entropy bound variant " + i, ago(1));
calls.length = 0;
out = await api.triageProposals(env);
ok(row(gHeld).status === "triaged_accepted" && queued(gHeld) === 1 && row(gHeld).rationale === "solid" && out.diversity_released === 1 && calls.length === 0, "when the generated share allows, the held row is released with its note stripped and no model call", { r: row(gHeld), out });
ok(out.diversity.generated.n === 16 && out.diversity.generated.top === "quantum" && out.diversity.generated.share === 0.438, "after the release the generated share is 7 of 16", out.diversity.generated);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
