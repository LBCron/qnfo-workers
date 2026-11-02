// SOCIAL-DISTRIBUTION-LEARNER-1 offline suite (qnfo-social 0.7.28). Drives the real worker.js (drainQueue,
// drainDissemination, the weekly update, the metric and GET /learner) against an in-memory SQLite D1 with the production
// schemas (metric_registry with its METRIC-INTEGRITY-1 and cadence triggers) and a stubbed fetch, with a seeded RNG.
// Proves: classification into topic x format arms (q08 and pillar 4 never arms); slots; the Beta sampler; the posterior is
// prior + credited rewards only; the reward (72h snapshot, thread self-reply removed, RUM views over baseline) is counted
// once and only after the window; a closed window without a snapshot is no-data; the drain never posts past the weekly
// cap or the pause flag, holds a decision until its slot, posts only the chosen row, keeps its posts 24h apart, still applies
// the content gate; the posterior steers the choice; the kill switch restores the old order; a learner that cannot persist
// its decision falls back to the old order; the weekly tick (Monday or catch-up) writes the ledger row the watchmaker
// reads; social_engagement_rate_30d is registered with the required fields, counts only posts since the epoch and never
// overwrites a row another owner holds; migrations/2026-10-02-social-distribution-learner.sql registers the identical
// definition and one trigger that the real v_metric_trigger_state (METRIC-CLOSED-LOOP-1) judges; GET /learner is open.
// Run: node qnfo-social/social-learner.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { versionAtLeast } from "../scripts/version-at-least.mjs";
const mod = await import("./worker.js");
const W = mod.default;

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TABLE social_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, title TEXT, posts TEXT, status TEXT DEFAULT 'queued', posted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')), retry_count INTEGER DEFAULT 0, error TEXT, doi TEXT, abstract TEXT, flags TEXT, notes TEXT, updated_at TEXT, post_uri TEXT);
CREATE TABLE dissemination_tracker (id TEXT PRIMARY KEY, paper_slug TEXT NOT NULL, paper_doi TEXT, paper_title TEXT, channel TEXT NOT NULL, action TEXT NOT NULL DEFAULT 'posted',
  post_url TEXT, post_id TEXT, post_text_snippet TEXT, mode TEXT, fallback INTEGER DEFAULT 0, posted_at TEXT, pages_url TEXT, github_url TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), retry_count INTEGER DEFAULT 0);
CREATE TABLE pipeline_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, level TEXT, message TEXT, digested INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE social_engagements (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, post_id TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL DEFAULT 0,
  note TEXT, collected_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(platform, post_id, metric, collected_at));
CREATE TABLE reach_signals (date TEXT NOT NULL, source TEXT NOT NULL, channel TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metric TEXT NOT NULL, value REAL,
  quality TEXT CHECK (quality IN ('human','bot','unknown')), collected_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (date, source, channel, entity_type, entity_id, metric));
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT NOT NULL, kind TEXT NOT NULL, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT,
  disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE TRIGGER metric_registry_source_required_ins BEFORE INSERT ON metric_registry FOR EACH ROW WHEN NEW.source_of_truth IS NULL OR trim(NEW.source_of_truth)='' OR NEW.disposition_actor IS NULL OR trim(NEW.disposition_actor)='' OR NEW.refresh_cadence IS NULL OR trim(NEW.refresh_cadence)='' BEGIN SELECT RAISE(ABORT,'METRIC-INTEGRITY-1'); END;
CREATE TRIGGER metric_registry_cadence_canonical_ins BEFORE INSERT ON metric_registry FOR EACH ROW WHEN NEW.refresh_cadence IS NOT NULL AND trim(NEW.refresh_cadence) <> '' AND ( instr(trim(NEW.refresh_cadence),' ') > 0 OR NOT ( lower(trim(NEW.refresh_cadence)) IN ('hourly','daily','weekly','monthly') OR trim(NEW.refresh_cadence) GLOB '*/[0-9]*' OR trim(NEW.refresh_cadence) GLOB '[0-9]*m' OR trim(NEW.refresh_cadence) GLOB '[0-9]*h' ) ) BEGIN SELECT RAISE(ABORT,'METRIC-CADENCE-CANONICAL-1'); END;`);

// D1 shim: batch returns one result per statement, as D1 does.
function stmtOn(conn, sql) {
  let args = [];
  const exec = () => /^\s*(SELECT|WITH)\b/i.test(sql) ? { results: conn.prepare(sql).all(...args) } : (() => { const r = conn.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; })();
  const s = {
    bind(...x) { args = x.map((v) => (v === undefined ? null : v)); return s; },
    async all() { return { results: conn.prepare(sql).all(...args) }; },
    async first() { return conn.prepare(sql).get(...args) || null; },
    async run() { const r = conn.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    _exec: exec
  };
  return s;
}
const DB = { prepare: (sql) => stmtOn(db, sql), async batch(list) { return list.map((s) => s._exec()); } };
const env = { DB, BSKY_HANDLE: "qnfo.bsky.social", BSKY_APP_PASS: "x", AI: {}, SOCIAL_WEEKLY_CAP: "2" }; // the suite pins the weekly cap it was written for (the default is 7 since Q08-OPEN-1)

let records = [];
const roots = () => records.filter((r) => !r.reply).length;   // a thread is one post: its replies are not new posts
globalThis.fetch = async (url, init) => {
  const u = String(url), body = init && init.body ? String(init.body) : "";
  const J = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: { "Content-Type": "application/json" } });
  if (u.includes("createSession")) return J({ accessJwt: "jwt", did: "did:plc:me", handle: "qnfo.bsky.social" });
  if (u.includes("createRecord")) { records.push(JSON.parse(body).record); return J({ uri: "at://did:plc:me/app.bsky.feed.post/r" + records.length, cid: "c" + records.length }); }
  if (u.includes("public.api.bsky.app/xrpc/app.bsky.feed.getPosts")) return J({ posts: new URL(u).searchParams.getAll("uris").map((x) => ({ uri: x, likeCount: 1, repostCount: 0, replyCount: 0, quoteCount: 0 })) });
  if (u.startsWith("https://papers.qnfo.org/")) return new Response("<html>" + u + "</html>", { status: 200 });
  return new Response("not found", { status: 404 });
};
function mulberry32(a) { return function() { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-3);
const T = (s) => Date.parse(s);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
function reset() {
  db.exec("DELETE FROM social_threads; DELETE FROM dissemination_tracker; DELETE FROM pipeline_flags; DELETE FROM ops_config; DELETE FROM cloud_ops_events; DELETE FROM social_engagements; DELETE FROM reach_signals; DELETE FROM alerts; DELETE FROM sqlite_sequence WHERE name = 'social_threads';");
  try { db.exec("DELETE FROM social_learner_posts"); } catch (e) {}
  records = [];
}
const addThread = (slug, title, doi, posts, o) => { o = o || {}; db.prepare("INSERT INTO social_threads (slug, title, doi, posts, status, flags, notes, posted_at, post_uri) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(slug, title, doi, JSON.stringify(posts), o.status || "queued", o.flags || null, o.notes || null, o.posted_at || null, o.post_uri || null); return Number(one("SELECT id FROM social_threads WHERE slug = ?", slug).id); };
const addDissem = (id, slug, doi, title, o) => { o = o || {}; db.prepare("INSERT INTO dissemination_tracker (id, paper_slug, paper_doi, paper_title, channel, action, pages_url, post_id, posted_at) VALUES (?, ?, ?, ?, 'bluesky', ?, ?, ?, ?)").run(id, slug, doi, title, o.action || "queued", "https://papers.qnfo.org/papers/" + slug + "/", o.post_id || null, o.posted_at || null); };
const JPS = ["Claim: one energy benchmark across domains: joules per correct answer.\nTest: 14 benchmarks surveyed; a protocol with anti-gaming rules.\nStatus: proposed standard; preprint.\nhttps://papers.qnfo.org/papers/joules-per-solution-metric"];
const FLEETQ = ["Can a self-maintaining research and publishing system operate for a year with no code written by its human operator? The Quniverse did.", "It runs on Cloudflare.", "Read: https://papers.qnfo.org/papers/quniverse-fleet-lessons"];
const ULTRA = ["The ultrametric programme proposes a p-adic structure for spacetime. https://papers.qnfo.org/papers/ultrametric-intelligence"];
const Q08 = ["An essay on vendor friction https://q08.org/p/2026-10-01-x"];
const pendingState = () => { const r = one("SELECT value FROM ops_config WHERE key = 'social_learner_pending'"); return r ? JSON.parse(r.value) : null; };
const decisionEvents = () => all("SELECT id, meta FROM cloud_ops_events WHERE kind = 'social-learner-decision' ORDER BY id");
const slotTick = (day, slot) => T(day + "T" + String(mod.LEARNER_SLOTS[slot][0]).padStart(2, "0") + ":30:00Z");

// ---------- 1. Classification ----------
let c = mod.learnerClassify({ slug: "jps-metric", title: "The Joules-per-Solution Metric", doi: "10.1000/t.21637028", posts: JSON.stringify(JPS) }, "thread");
ok(c.topic === "energy" && c.format === "single" && c.n_posts === 1 && c.link_slug === "joules-per-solution-metric", "launch-queue claim/test/status post: energy (selected-work DOI), single, links the paper slug");
c = mod.learnerClassify({ slug: "fleet", title: "Operating the Quniverse Fleet", doi: "10.1000/t.23003473", posts: JSON.stringify(FLEETQ) }, "thread");
ok(c.topic === "operations" && c.format === "question" && c.n_posts === 3, "composer thread with a question hook: operations (keyword), question");
c = mod.learnerClassify({ slug: "t", title: "JPCUB landscape", posts: JSON.stringify(["Gate speed, not cooling, dominates energy per correct answer.", "Second.", "Third https://papers.qnfo.org/papers/jpcub-competitive-landscape"]) }, "thread");
ok(c.topic === "energy" && c.format === "thread", "statement-hook thread: thread");
ok(mod.learnerClassify({ slug: "e", title: "Universal Ignorance Audit", doi: "10.1000/t.21901984", posts: JSON.stringify(["A method others can use."]) }, "thread").topic === "epistemics", "selected work 5 maps to epistemics");
ok(mod.learnerClassify({ slug: "q", title: "x", posts: JSON.stringify(Q08) }, "thread").topic === null, "a q08 post is never an arm");
ok(mod.learnerClassify({ slug: "q2", title: "JPCUB", doi: "10.1000/t.21637028", posts: JSON.stringify(Q08) }, "thread").topic === null, "a q08 link wins over a selected DOI: never an arm");
ok(mod.learnerClassify({ slug: "u", title: "Ultrametric intelligence", posts: JSON.stringify(ULTRA) }, "thread").topic === null, "pillar 4 (ultrametric) is not an arm");
c = mod.learnerClassify({ id: "d1", paper_slug: "braid-x", paper_doi: "10.1000/t.23086421", paper_title: "Braid Group Representations, Modular Data, and the Classification of Majorana Zero Modes", pages_url: "https://papers.qnfo.org/papers/braid-x/" }, "dissem");
ok(c.topic === "research" && c.format === "single" && c.link_slug === "braid-x", "dissemination card on an unlisted topic: single, the generic arm research (LEARNER-ARMS-2: a post that links a paper is never stored without an arm)");
c = mod.learnerClassify({ id: "d1", paper_slug: "braid-x", paper_title: "Braid Group Representations, Modular Data, and the Classification of Majorana Zero Modes", pages_url: "https://papers.qnfo.org/papers/braid-x/" }, "dissem", { categories: { "braid-x": "physics" } });
ok(c.topic === "physics", "the paper's own shelf (paper_category) names the arm when the post links the paper");
ok(mod.learnerClassify({ id: "d2", paper_slug: "llm", paper_doi: "10.1000/t.21945415", paper_title: "Joules-per-Solution for Stochastic and Agentic Inference" }, "dissem").topic === "energy", "dissemination card of selected work 4: energy");
ok(mod.learnerClassify({ id: "d3", paper_slug: "v", paper_title: "Why Vertices, Not Points? Vertex-Anchored Braiding" }, "dissem").format === "question", "a title that asks a question is question-led");
ok(!mod.learnerIsQuestion("Claim: 0.5 J per answer. Is it right?") && mod.learnerIsQuestion("What does 1.5 J mean? Read on.") && mod.learnerIsQuestion("Is it? https://x.org/a?b=1"), "question detection: first sentence only, decimals are not sentence ends");

// ---------- 2. Slots ----------
const hours = { 0: null, 4: null, 6: null, 8: "eu-morning", 10: "eu-morning", 12: null, 14: "us-morning", 16: "us-morning", 18: "us-afternoon", 20: "us-afternoon", 22: null };
ok(Object.keys(hours).every((h) => mod.learnerSlotOf(T("2026-10-06T" + String(h).padStart(2, "0") + ":30:00Z")) === hours[h]), "the :30 ticks map to eu-morning 08/10, us-morning 14/16, us-afternoon 18/20, none otherwise");

// ---------- 3. Beta sampler ----------
let rng = mulberry32(7), s = 0;
for (let i = 0; i < 4000; i++) s += mod.learnerBeta(3, 7, rng);
ok(near(s / 4000, 0.3, 0.015), "Beta(3,7) draws average 0.3 (" + (s / 4000).toFixed(3) + ")");
let inRange = true; s = 0;
for (let i = 0; i < 2000; i++) { const x = mod.learnerBeta(0.5, 0.5, rng); if (!(x >= 0 && x <= 1)) inRange = false; const y = mod.learnerBeta(1, 1, rng); s += y; if (!(y >= 0 && y <= 1)) inRange = false; }
ok(inRange && near(s / 2000, 0.5, 0.03), "Beta(0.5,0.5) and Beta(1,1) draws stay in [0,1]; the uniform prior averages 0.5");
ok(near(mod.learnerBeta(2, 2, () => 0.5), 0.5, 0.2) && mod.learnerBeta(5, 5, () => 0.999999) >= 0, "a degenerate RNG cannot hang the sampler");

// ---------- 4. Posterior = prior + credited rewards only ----------
reset();
await mod.ensureLearnerSchema(env);
const insL = (key, topic, format, slot, status, reward) => db.prepare("INSERT INTO social_learner_posts (post_key, topic, format, slot, status, reward, posted_at) VALUES (?, ?, ?, ?, ?, ?, '2026-10-06T08:30:00.000Z')").run(key, topic, format, slot, status, reward);
insL("a", "energy", "single", "eu-morning", "credited", 0.8);
insL("b", "energy", "single", "eu-morning", "credited", 0.2);
insL("c", "operations", "question", null, "credited", 0.5);
insL("d", "epistemics", "thread", "us-morning", "pending", null);
insL("e", "epistemics", "thread", "us-morning", "no-data", null);
let post = await mod.learnerPosterior(env);
ok(near(post.topic.energy.a, 2) && near(post.topic.energy.b, 2) && post.topic.energy.n === 2, "energy: alpha 1+0.8+0.2, beta 1+0.2+0.8");
ok(near(post.topic.operations.a, 1.5) && near(post.topic.operations.b, 1.5) && post.topic.epistemics.n === 0 && post.topic.epistemics.a === 1, "pending and no-data rows leave the prior untouched");
ok(post.format.single.n === 2 && post.format.question.n === 1 && post.format.thread.n === 0 && post.slot["eu-morning"].n === 2 && post.slot["us-morning"].n === 0 && post.slot["us-afternoon"].n === 0, "format and slot marginals count the same credited posts; a post with no slot leaves the slot prior alone");

// ---------- 5. Reward pieces ----------
const snap = [{ metric: "likes", value: 2, collected_at: "2026-10-08" }, { metric: "reposts", value: 1, collected_at: "2026-10-08" }, { metric: "replies", value: 1, collected_at: "2026-10-08" }, { metric: "quotes", value: 0, collected_at: "2026-10-08" }, { metric: "likes", value: 1, collected_at: "2026-10-07" }];
ok(mod.learnerEngagementOf(snap, 5).e === 3 && mod.learnerEngagementOf(snap, 1).e === 4 && mod.learnerEngagementOf(snap, 1).snapshot_day === "2026-10-08", "engagement: the latest snapshot per metric; a thread's own first reply is not counted");
ok(mod.learnerEngagementOf([], 1) === null, "no snapshot is no measurement, not zero");
ok(near(mod.learnerRewardOf({ e: 1 }, null).reward, 0.3935) && near(mod.learnerRewardOf({ e: 0 }, 10).reward, 0.6321) && mod.learnerRewardOf({ e: 0 }, null).reward === 0, "r = 1 - exp(-(e + v/5)/2)");

// ---------- 6. The reward is counted once, only after the 72h window ----------
reset();
const P0 = "2026-10-06 08:30:00", P0ms = T("2026-10-06T08:30:00Z");
const tJ = addThread("jps-metric", "The Joules-per-Solution Metric", "10.1000/t.21637028", JPS, { status: "posted", posted_at: P0, post_uri: "at://did:plc:me/app.bsky.feed.post/p1", flags: "selected" });
const tF = addThread("fleet-q", "Operating the Quniverse Fleet", "10.1000/t.23003473", FLEETQ, { status: "posted", posted_at: "2026-10-06 18:30:00", post_uri: JSON.stringify({ bluesky: "at://did:plc:me/app.bsky.feed.post/p2", linkedin: "buffer:9" }) });
addThread("q08-essay", "x", null, Q08, { status: "posted", posted_at: "2026-10-06 10:30:00", post_uri: "at://did:plc:me/app.bsky.feed.post/p3" });
addThread("old", "JPCUB", "10.1000/t.21821767", JPS, { status: "posted", posted_at: "2026-09-30 10:30:00", post_uri: "at://did:plc:me/app.bsky.feed.post/p0" });
addDissem("res-u", "ultrametric-intelligence", null, "Ultrametric intelligence", { action: "posted", post_id: "at://did:plc:me/app.bsky.feed.post/p4", posted_at: "2026-10-07 02:30:00" });
addDissem("res-e", "statements-to-questions", "10.1000/t.22026592", "Epistemic Legibility in AI-Assisted Science", { action: "posted", post_id: "at://did:plc:me/app.bsky.feed.post/p5", posted_at: "2026-10-06 14:30:00" });
const se = (uri, day, m) => { for (const k of Object.keys(m)) db.prepare("INSERT INTO social_engagements (platform, post_id, metric, value, note, collected_at) VALUES ('bluesky', ?, ?, ?, 'qnfo-social', ?)").run(uri, k, m[k], day); };
se("at://did:plc:me/app.bsky.feed.post/p1", "2026-10-07", { likes: 1, reposts: 0, replies: 0, quotes: 0 });
se("at://did:plc:me/app.bsky.feed.post/p1", "2026-10-09", { likes: 3, reposts: 1, replies: 1, quotes: 0 });   // 07:00Z on 10-09 is 70.5h after posting: inside
se("at://did:plc:me/app.bsky.feed.post/p1", "2026-10-10", { likes: 9, reposts: 4, replies: 2, quotes: 1 });   // 94.5h: outside
se("at://did:plc:me/app.bsky.feed.post/p2", "2026-10-08", { likes: 0, reposts: 0, replies: 1, quotes: 0 });   // the thread's own reply only
// CF RUM: every day from 09-29 to 10-08 ingested (site row); the JPS paper has 2 views a day before the post, 6+9+3 after.
for (let d = 29; d <= 38; d++) {
  const day = d <= 30 ? "2026-09-" + d : "2026-10-" + String(d - 30).padStart(2, "0");
  db.prepare("INSERT INTO reach_signals (date, source, channel, entity_type, entity_id, metric, value, quality) VALUES (?, 'cf-rum', 'web', 'site', '(all)', 'pageviews', 100, 'unknown')").run(day);
  const v = { "2026-10-06": 6, "2026-10-07": 9, "2026-10-08": 3 }[day] ?? 2;
  db.prepare("INSERT INTO reach_signals (date, source, channel, entity_type, entity_id, metric, value, quality) VALUES (?, 'cf-rum', 'web', 'paper', 'joules-per-solution-metric', 'pageviews', ?, 'unknown')").run(day, v);
}
mod.setLearnerRng(mulberry32(11));
let up = await mod.learnerWeeklyUpdate(env, P0ms + 71 * 36e5);
ok(up.discovered === 5 && up.credited === 0, "the weekly update files the five posts since the epoch (not the 09-30 one) and credits nothing inside a window (" + JSON.stringify({ d: up.discovered, c: up.credited }) + ")");
const lp = (k) => one("SELECT * FROM social_learner_posts WHERE post_key = ?", k);
ok(lp("thread:" + tJ).status === "pending" && lp("thread:" + tJ).chosen_by === "scheduler" && lp("thread:" + tJ).slot === "eu-morning" && lp("thread:" + tF).format === "question" && lp("thread:" + tF).bsky_uri === "at://did:plc:me/app.bsky.feed.post/p2", "a post the learner did not choose is filed with its arms, slot from its hour and its Bluesky uri");
ok(all("SELECT status FROM social_learner_posts WHERE post_key IN ('dissem:res-u') OR slug = 'q08-essay'").every((r) => r.status === "not-arm"), "the q08 and ultrametric posts are filed as not-arm");
ok(!lp("thread:" + one("SELECT id FROM social_threads WHERE slug = 'old'").id), "a post before the epoch is not filed");
up = await mod.learnerWeeklyUpdate(env, P0ms + 75 * 36e5);
const rj = lp("thread:" + tJ);
ok(rj.status === "credited" && rj.engagement === 5 && rj.visits === 12 && near(rj.reward, 1 - Math.exp(-(5 + 12 / 5) / 2), 1e-4), "after 72h: e = 3+1+1 from the 10-09 snapshot (10-10 ignored), v = 18 - 3 x 2 = 12, r = 1 - exp(-3.7) (" + JSON.stringify({ e: rj.engagement, v: rj.visits, r: rj.reward }) + ")");
ok(lp("thread:" + tF).status === "pending" && up.waiting >= 1 && up.discovered === 0, "a post whose window is still open waits; filed posts are not filed again");
up = await mod.learnerWeeklyUpdate(env, P0ms + 200 * 36e5);
const rf = lp("thread:" + tF), re = lp("dissem:res-e");
ok(rf.status === "credited" && rf.engagement === 0 && rf.visits === 0 && rf.reward === 0 && JSON.parse(rf.reward_detail).visits.status === "ok", "a thread whose only reply is its own earns 0; its paper had no views on ingested days, so v = 0");
let vz = await mod.learnerVisits(env, "joules-per-solution-metric", "2026-10-08");
ok(vz.visits === null && /RUM day 2026-10-09 not ingested/.test(vz.status), "a window day RUM has not ingested makes v unavailable (e alone)");
vz = await mod.learnerVisits(env, "joules-per-solution-metric", "2026-09-30");
ok(vz.visits === null && /baseline has 1 ingested days/.test(vz.status), "a baseline under 3 ingested days makes v unavailable");
ok((await mod.learnerVisits(env, null, "2026-10-06")).visits === null, "a post without a papers.qnfo.org link has no v");
ok(re.status === "no-data" && re.reward === null, "a closed window with no engagement snapshot is no-data, final");
post = await mod.learnerPosterior(env);
ok(post.topic.energy.n === 1 && post.topic.operations.n === 1 && post.topic.epistemics.n === 0 && near(post.topic.energy.a, 1 + rj.reward, 1e-4), "credited posts move only their own arms; no-data moves nothing");
const before = JSON.stringify(post);
up = await mod.learnerWeeklyUpdate(env, P0ms + 400 * 36e5);
ok(up.credited === 0 && up.no_data === 0 && JSON.stringify(await mod.learnerPosterior(env)) === before, "a second and third update credit nothing again");
ok(one("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'social-learner-reward' AND id = ?", "social-learner-reward-thread:" + tJ).n === 1 && one("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'social-learner-reward'").n === 3, "each reward update is logged once (two credited, one no-data)");
const rev = JSON.parse(one("SELECT meta FROM cloud_ops_events WHERE id = ?", "social-learner-reward-thread:" + tJ).meta);
ok(rev.arms.topic === "energy" && near(rev.update.alpha_plus + rev.update.beta_plus, 1) && rev.detail.engagement.snapshot_day === "2026-10-09", "the reward event carries the arms, alpha/beta increments and the snapshot used");
ok(up.next_week_allocation && ["topic", "format", "slot"].every((d) => near(Object.values(up.next_week_allocation[d]).reduce((a, b) => a + b, 0), 1, 0.01)), "next week's allocation is a probability per dimension");

// ---------- 7. The drain: caps, pause, slot hold, the chosen row only, 24h spacing, gates ----------
const seedQueue = () => {
  reset();
  const ids = {};
  // the dissemination row is a pillar-4 paper (p-adic), so it stays a non-arm row; a plain paper is an arm since LEARNER-ARMS-2
  ids.ultra = addThread("ultra", "Ultrametric intelligence", null, ULTRA);
  ids.q08 = addThread("q08-x", "q08", null, Q08);
  ids.jps = addThread("jps-metric", "The Joules-per-Solution Metric", "10.1000/t.21637028", JPS, { flags: "selected" });
  ids.fleet = addThread("fleet-q", "Operating the Quniverse Fleet", "10.1000/t.23003473", FLEETQ);
  addDissem("res-b", "braid-x", "10.1000/t.23086421", "p-adic Braid Group Representations and Modular Data");
  return ids;
};
let ids = seedQueue();
db.exec("INSERT INTO social_threads (slug, title, posts, status, posted_at) VALUES ('w1', 'w', '[]', 'posted', datetime('now','-1 day')), ('w2', 'w', '[]', 'posted', datetime('now','-2 days'))");
mod.setLearnerRng(mulberry32(3));
let q = await mod.drainQueue(env, { nowMs: slotTick("2026-10-06", "eu-morning") });
ok(q.skipped === "weekly-cap" && records.length === 0 && !pendingState() && decisionEvents().length === 0, "weekly cap reached: the learner is never asked, nothing is posted or decided");
db.exec("DELETE FROM social_threads WHERE slug IN ('w1','w2')");
db.exec("INSERT INTO pipeline_flags (key, value) VALUES ('social_paused', '1')");
q = await mod.drainQueue(env, { nowMs: slotTick("2026-10-06", "eu-morning") });
let d = await mod.drainDissemination(env, { nowMs: slotTick("2026-10-06", "eu-morning") });
ok(q.skipped === "paused" && d.skipped === "paused" && records.length === 0 && !pendingState(), "pause flag: both drains post nothing and the learner decides nothing");
db.exec("DELETE FROM pipeline_flags");
const OFF = T("2026-10-06T04:30:00Z");
q = await mod.drainQueue(env, { nowMs: OFF });
let st = pendingState();
ok(q.posted === 0 && q.learner && q.learner.held === "slot" && st && st.decision && records.length === 0, "off-slot tick: the learner decides, then holds (" + JSON.stringify(q.learner) + ")");
const dec = st.decision;
ok(dec.source === "thread" && [ids.jps, ids.fleet].includes(Number(dec.id)) && dec.topic && Object.keys(mod.LEARNER_SLOTS).includes(dec.slot), "the choice is an arm row (never the ultrametric, q08 or braid row) with a slot");
let ev = decisionEvents();
const evm = ev.length ? JSON.parse(ev[0].meta) : {};
ok(ev.length === 1 && Object.keys(evm.decision.samples.topic).length === mod.LEARNER_TOPICS.length && Object.keys(evm.decision.samples.format).length === 3 && Object.keys(evm.decision.samples.slot).length === 3 && evm.candidates.length === 5 && evm.candidates.filter((x) => x.score !== null).length === 2, "the decision is logged with every draw and the five scored candidates (two arms)");
d = await mod.drainDissemination(env, { nowMs: OFF });
ok(d.posted === 0 && d.learner.held === "slot" && records.length === 0, "the dissemination drain holds too: it cannot use the capacity the learner is saving");
q = await mod.drainQueue(env, { nowMs: OFF + 2 * 36e5 + (mod.learnerSlotOf(OFF + 2 * 36e5) === dec.slot ? 36e5 * 12 : 0) });
ok(decisionEvents().length === 1 && pendingState().decision.decided_at === dec.decided_at, "a later off-slot tick keeps the same decision (no re-draw)");
const AT = slotTick("2026-10-06", dec.slot);
q = await mod.drainQueue(env, { nowMs: AT });
const postedRows = all("SELECT id, status FROM social_threads WHERE status = 'posted'");
ok(q.posted === 1 && roots() === 1 && postedRows.length === 1 && postedRows[0].id === Number(dec.id), "at its slot the chosen row, and only it, is posted (" + JSON.stringify(q) + ")");
const lrow = one("SELECT * FROM social_learner_posts WHERE post_key = ?", "thread:" + dec.id);
ok(lrow && lrow.chosen_by === "learner" && lrow.status === "pending" && lrow.slot === dec.slot && lrow.topic === dec.topic && JSON.parse(lrow.decision).samples && lrow.bsky_uri === "at://did:plc:me/app.bsky.feed.post/r1", "the post is filed pending with its decision and Bluesky uri");
d = await mod.drainDissemination(env, { nowMs: AT });
ok(!d.posted && ((d.learner && d.learner.held === "spacing") || d.skipped === "spacing") && roots() === 1, "the cap had room for two, the tick posted one: learner posts are 24h apart");
q = await mod.drainQueue(env, { nowMs: AT + 22 * 36e5 });
ok(!q.posted && ((q.learner && q.learner.held === "spacing") || q.skipped === "spacing") && roots() === 1, "22h later still nothing: the spacing holds");
ok(all("SELECT status FROM social_threads WHERE id IN (?, ?)", ids.ultra, ids.q08).every((r) => r.status === "queued") && one("SELECT action FROM dissemination_tracker WHERE id = 'res-b'").action === "queued", "rows the learner did not choose stay queued, untouched");

// A simulated week of ticks: never more than the weekly cap, every learner post inside its decided slot.
ids = seedQueue();
addThread("jpcub-17", "Energy per correct answer across 17 quantum platforms", "10.1000/t.21821767", ["Claim: gate speed, not cooling, dominates energy per correct answer. https://papers.qnfo.org/papers/jpcub-competitive-landscape"], { flags: "selected" });
addDissem("res-llm", "llm-jps", "10.1000/t.21945415", "Joules-per-Solution for Stochastic and Agentic Inference");
const rowsBefore = one("SELECT COUNT(*) n FROM social_threads").n + one("SELECT COUNT(*) n FROM dissemination_tracker").n;
mod.setLearnerRng(mulberry32(99));
let outsideSlot = 0;
for (let h = 0; h < 7 * 24; h += 2) {
  const now = T("2026-10-07T00:30:00Z") + h * 36e5;
  const n0 = roots();
  await mod.drainQueue(env, { nowMs: now });
  await mod.drainDissemination(env, { nowMs: now });
  if (roots() - n0 > 1) outsideSlot += 100;
  if (roots() > n0 && mod.learnerSlotOf(now) === null) outsideSlot++;
}
const lposts = all("SELECT post_key, slot, posted_at, chosen_by FROM social_learner_posts");
const gaps = all("SELECT posted_at FROM social_learner_posts ORDER BY posted_at").map((r) => Date.parse(r.posted_at)).map((x, i, arr) => i ? x - arr[i - 1] : Infinity);
ok(roots() >= 1 && roots() <= 2 && outsideSlot === 0 && gaps.every((g) => g >= 24 * 36e5), "a week of 84 ticks posts at most the weekly cap (2), 24h+ apart, only inside a slot (" + roots() + " posts)");
ok(lposts.length === roots() && lposts.every((r) => r.chosen_by === "learner" && mod.learnerSlotOf(Date.parse(r.posted_at)) === r.slot), "every post was the learner's choice, posted in the slot it drew");
ok(one("SELECT COUNT(*) n FROM social_threads").n + one("SELECT COUNT(*) n FROM dissemination_tracker").n === rowsBefore, "the learner never creates a post: the queues hold the same rows");
ok(lposts.every((r) => !/ultra|q08|braid/.test(r.post_key)) && all("SELECT status FROM social_threads WHERE slug IN ('ultra','q08-x')").every((r) => r.status === "queued"), "arm rows go first: the non-arm rows were never chosen while arm rows waited");

// The content gate still applies to a learner choice: only a q08 row queued -> suppressed at its slot, nothing posted.
reset();
const onlyQ = addThread("q08-only", "q08", null, Q08);
mod.setLearnerRng(mulberry32(5));
q = await mod.drainQueue(env, { nowMs: OFF });
const dq = pendingState().decision;
ok(dq.via_arms === false && Number(dq.id) === onlyQ && dq.topic === null, "with no arm row queued, the learner falls back to the old order (in a sampled slot)");
q = await mod.drainQueue(env, { nowMs: slotTick("2026-10-06", dq.slot) });
ok(one("SELECT status FROM social_threads WHERE id = ?", onlyQ).status !== "suppressed", "the content gate no longer suppresses a q08 row the learner chose (Q08-OPEN-1)");

// ---------- 8. The posterior steers the choice; the prior explores ----------
reset();
await mod.ensureLearnerSchema(env);
for (let i = 0; i < 20; i++) { insL("good" + i, "operations", "question", "us-afternoon", "credited", 0.95); insL("bad" + i, "energy", "single", "eu-morning", "credited", 0.02); }
const cands = [
  { source: "thread", id: 1, arms: { topic: "energy", format: "single", slug: "jps" } },
  { source: "thread", id: 2, arms: { topic: "operations", format: "question", slug: "fleet" } },
  { source: "thread", id: 3, arms: { topic: null, format: "single", slug: "ultra" } }
];
post = await mod.learnerPosterior(env);
const share = { ops: 0, slot: { "eu-morning": 0, "us-morning": 0, "us-afternoon": 0 } };
for (let k = 0; k < 200; k++) { const x = mod.learnerChoose(cands, post, mulberry32(1000 + k), OFF); if (x.id === 2) share.ops++; share.slot[x.slot]++; }
ok(share.ops >= 194, "after 20 strong and 20 weak rewards the learner picks the operations question post over the selected energy post (" + share.ops + "/200)");
ok(share.slot["us-afternoon"] >= 168 && share.slot["us-afternoon"] <= 194 && share.slot["us-morning"] >= 6 && share.slot["eu-morning"] <= 4, "the slot follows its posterior (us-afternoon, expected 91%) while the untried us-morning keeps being explored (expected 9%) (" + JSON.stringify(share.slot) + ")");
const prior = mod.learnerPrior();
const picks = { 1: 0, 2: 0, 3: 0 };
for (let k = 0; k < 300; k++) picks[mod.learnerChoose(cands, prior, mulberry32(5000 + k), OFF).id]++;
ok(picks[1] >= 90 && picks[2] >= 90 && picks[3] === 0, "under the prior both arm rows are explored and the non-arm row is never preferred (" + JSON.stringify(picks) + ")");

// ---------- 9. Kill switch; a learner that cannot persist falls back ----------
ids = seedQueue();
db.exec("INSERT INTO ops_config (key, value) VALUES ('social_learner_enabled', '0')");
q = await mod.drainQueue(env, { nowMs: OFF });
ok(q.posted >= 1 && one("SELECT status FROM social_threads WHERE id = ?", ids.jps).status === "posted" && !("learner" in q) && !pendingState() && decisionEvents().length === 0, "social_learner_enabled=0: the 0.7.27 order and timing (selected row first, posted at an off-slot tick), no decision");
ok((await mod.learnerEnabled(env)).on === false, "'0' is off");
db.exec("UPDATE ops_config SET value = 'off' WHERE key = 'social_learner_enabled'");
ok((await mod.learnerEnabled(env)).on === false, "'off' is off");
db.exec("UPDATE ops_config SET value = '1' WHERE key = 'social_learner_enabled'");
ok((await mod.learnerEnabled(env)).on === true, "'1' is on");
db.exec("DELETE FROM ops_config WHERE key = 'social_learner_enabled'");
ok((await mod.learnerEnabled(env)).on === true, "absent is on");
ok((await mod.learnerEnabled({ DB: { prepare() { throw new Error("no such table: ops_config"); } } })).on === false, "an unreadable switch is off (the old behaviour)");
db.exec("INSERT INTO ops_config (key, value) VALUES ('social_learner_enabled', 'off')");
let wk = await mod.learnerWeeklyTick(env, T("2026-10-12T07:00:00Z"));
ok(wk.disabled === true && one("SELECT status FROM cloud_ops_events WHERE id = 'social-learner-update-2026-10-12'").status === "skipped", "switched off, the weekly update records 'skipped' and changes nothing");
db.exec("DELETE FROM ops_config");
ids = seedQueue();
const noWrite = { prepare(sql) { if (/INSERT INTO ops_config/.test(sql)) throw new Error("ops_config is read-only"); return DB.prepare(sql); }, batch: DB.batch };
q = await mod.drainQueue({ ...env, DB: noWrite }, { nowMs: OFF });
ok(q.posted >= 1 && one("SELECT status FROM social_threads WHERE id = ?", ids.jps).status === "posted" && q.learner && /not persisted/.test(q.learner.error), "a decision that cannot be persisted falls back to the old order (" + JSON.stringify(q.learner) + ")");

// ---------- 10. Weekly tick: Mondays or catch-up; the watchmaker's proof ----------
reset();
const proof = () => one("SELECT MAX(json_extract(meta, '$.last_ok')) AS last FROM cloud_ops_events WHERE id >= 'social-learner-update-' AND id < 'social-learner-update.'").last;
wk = await mod.learnerWeeklyTick(env, T("2026-10-09T07:00:00Z"));
ok(!wk.not_due && one("SELECT status FROM cloud_ops_events WHERE id = 'social-learner-update-2026-10-09'").status === "ok" && proof() === "2026-10-09T07:00:00.000Z", "a first run on any day (no completed update yet) runs and writes the ledger row the watchmaker reads");
wk = await mod.learnerWeeklyTick(env, T("2026-10-10T07:00:00Z"));
ok(wk.not_due === true, "Saturday after a Friday run: not due");
wk = await mod.learnerWeeklyTick(env, T("2026-10-12T07:00:00Z"));
ok(!wk.not_due && proof() === "2026-10-12T07:00:00.000Z", "Monday: due");
wk = await mod.learnerWeeklyTick(env, T("2026-10-13T07:00:00Z"));
ok(wk.not_due === true, "Tuesday after Monday: not due");
wk = await mod.learnerWeeklyTick(env, T("2026-10-20T07:00:00Z"));
ok(!wk.not_due && proof() === "2026-10-20T07:00:00.000Z", "a missed Monday is caught up the next day (7 days since the last completed update)");
const lm = JSON.parse(one("SELECT meta FROM cloud_ops_events WHERE id = 'social-learner-update-2026-10-20'").meta);
ok(lm.result && lm.result.posterior && lm.result.next_week_allocation && lm.version, "the ledger row carries the posterior and next week's allocation");

// ---------- 11. metric_registry social_engagement_rate_30d ----------
reset();
const NOWM = T("2026-10-20T07:10:00Z");
addThread("m1", "JPS", null, JPS, { status: "posted", posted_at: "2026-10-10 08:30:00", post_uri: "at://did:plc:me/app.bsky.feed.post/m1" });
addThread("m2", "Fleet", null, FLEETQ, { status: "posted", posted_at: "2026-10-12 14:30:00", post_uri: "at://did:plc:me/app.bsky.feed.post/m2" });
addThread("m3", "late", null, JPS, { status: "posted", posted_at: "2026-10-19 14:30:00", post_uri: "at://did:plc:me/app.bsky.feed.post/m3" });   // window still open
addDissem("m4", "x", null, "X", { action: "posted", post_id: "at://did:plc:me/app.bsky.feed.post/m4", posted_at: "2026-10-11 18:30:00" });   // no snapshot
se("at://did:plc:me/app.bsky.feed.post/m1", "2026-10-12", { likes: 2, reposts: 1, replies: 0, quotes: 0 });
se("at://did:plc:me/app.bsky.feed.post/m2", "2026-10-14", { likes: 0, reposts: 0, replies: 2, quotes: 0 });
se("at://did:plc:me/app.bsky.feed.post/m3", "2026-10-20", { likes: 5, reposts: 0, replies: 0, quotes: 0 });
let rt = await mod.learnerEngagementRate(env, NOWM);
let mr = one("SELECT * FROM metric_registry WHERE metric = 'social_engagement_rate_30d'");
ok(rt.posts === 3 && rt.with_data === 2 && rt.rate === 2 && mr && mr.last_value === "2" && mr.owner === "qnfo-social" && mr.refresh_cadence === "daily" && mr.source_of_truth && mr.disposition_actor && mr.formula, "rate = (3 + 1) / 2 posts with data (the open window and the unmeasured post are left out); registered with the METRIC-INTEGRITY-1 fields (" + JSON.stringify(rt) + ")");
db.exec("UPDATE metric_registry SET formula = 'central definition' WHERE metric = 'social_engagement_rate_30d'");
se("at://did:plc:me/app.bsky.feed.post/m2", "2026-10-15", { likes: 4, reposts: 0, replies: 2, quotes: 0 });
rt = await mod.learnerEngagementRate(env, NOWM + 864e5);
mr = one("SELECT * FROM metric_registry WHERE metric = 'social_engagement_rate_30d'");
ok(mr.formula === "central definition" && mr.last_value === "4" && rt.registry.written === true, "an existing qnfo-social row keeps its definition and takes the new value");
db.exec("UPDATE metric_registry SET owner = 'qnfo-fleet-dashboard', last_value = '7' WHERE metric = 'social_engagement_rate_30d'");
rt = await mod.learnerEngagementRate(env, NOWM + 2 * 864e5);
mr = one("SELECT * FROM metric_registry WHERE metric = 'social_engagement_rate_30d'");
ok(mr.last_value === "7" && rt.registry.written === false && /qnfo-fleet-dashboard/.test(rt.registry.reason), "a row another owner registered centrally is left to that owner");
db.exec("DELETE FROM metric_registry");
db.exec("DELETE FROM social_threads; DELETE FROM dissemination_tracker");
rt = await mod.learnerEngagementRate(env, NOWM);
ok(rt.rate === null && /^n\/a: /.test(one("SELECT last_value FROM metric_registry WHERE metric = 'social_engagement_rate_30d'").last_value), "no measured post: the value says n/a, not 0");
for (let i = 0; i < 40; i++) {
  addThread("bulk" + i, "b", null, JPS, { status: "posted", posted_at: "2026-10-1" + (i % 6) + " 0" + (i % 10) + ":30:00", post_uri: "at://did:plc:me/app.bsky.feed.post/b" + i });
  se("at://did:plc:me/app.bsky.feed.post/b" + i, "2026-10-1" + (i % 6 + 1), { likes: 1, reposts: 0, replies: 0, quotes: 0 });
}
rt = await mod.learnerEngagementRate(env, NOWM);
ok(rt.posts === 40 && rt.with_data === 40 && rt.rate === 1, "40 posts are read in two windowed queries (33 per query) and all counted (" + JSON.stringify({ p: rt.posts, d: rt.with_data, r: rt.rate }) + ")");
addThread("pre-epoch", "q08 era", null, Q08, { status: "posted", posted_at: "2026-09-25 10:30:00", post_uri: "at://did:plc:me/app.bsky.feed.post/old1" });
se("at://did:plc:me/app.bsky.feed.post/old1", "2026-09-26", { likes: 50, reposts: 0, replies: 0, quotes: 0 });
rt = await mod.learnerEngagementRate(env, T("2026-10-08T07:10:00Z"));
ok(rt.posts === 0 && rt.rate === null && rt.window[0] === "2026-10-02 00:00:00", "posts before the 2026-10-02 epoch (the q08 flood) never enter the rate");

// A roll-up's tracker time is its earlier Substack announcement, not its Bluesky post time.
reset();
const NOWR = T("2026-11-02T07:10:00Z");
const rollUri = "at://did:plc:me/app.bsky.feed.post/3myoouytiis2r"; // 2026-10-25T07:32:07.585Z
const openUri = "at://did:plc:me/app.bsky.feed.post/3mzc35cjqqv25"; // 2026-11-02T00:32:06.118Z
addDissem("delayed-roll", "delayed", null, "Delayed", { action: "posted", post_id: rollUri, posted_at: "2026-09-20 08:00:00" });
addDissem("duplicate-roll", "duplicate", null, "Duplicate", { action: "posted", post_id: rollUri, posted_at: "2026-09-21 08:00:00" });
addDissem("open-roll", "open", null, "Open", { action: "posted", post_id: openUri, posted_at: "2026-10-20 08:00:00" });
addDissem("legacy-roll", "legacy", null, "Legacy", { action: "posted", post_id: "at://did:plc:me/app.bsky.feed.post/legacy", posted_at: "2026-10-20 08:00:00" });
se(rollUri, "2026-10-27", { likes: 3, reposts: 0, replies: 0, quotes: 0 });
se(rollUri, "2026-10-29", { likes: 99, reposts: 0, replies: 0, quotes: 0 }); // outside 72h
se(openUri, "2026-10-21", { likes: 100, reposts: 0, replies: 0, quotes: 0 });
se("at://did:plc:me/app.bsky.feed.post/legacy", "2026-10-22", { likes: 1, reposts: 0, replies: 0, quotes: 0 });
rt = await mod.learnerEngagementRate(env, NOWR);
ok(rt.posts === 2 && rt.with_data === 2 && rt.engagements === 4 && rt.rate === 2, "delayed roll-up uses its Bluesky window even when announced before the epoch; deduplicated, open window excluded, legacy time retained (" + JSON.stringify(rt) + ")");
for (let i = 0; i < 301; i++) addDissem("open-copy-" + i, "open-copy-" + i, null, "Open copy", { action: "posted", post_id: openUri, posted_at: "2026-10-21 08:00:00" });
rt = await mod.learnerEngagementRate(env, NOWR);
ok(rt.posts === 2 && rt.with_data === 2 && rt.rate === 2, "newer announcements cannot hide an eligible older roll-up behind the old 300-row source limit");
rt = await mod.learnerEngagementRate(env, T("2026-12-10T07:10:00Z"));
ok(rt.posts === 0 && rt.rate === null, "corrected post times still age out of the rolling 30-day window");

// METRIC-CLOSED-LOOP-1: the migration registers the same definition and a trigger the real v_metric_trigger_state judges.
const mig = readFileSync(new URL("../migrations/2026-10-02-social-distribution-learner.sql", import.meta.url), "utf8");
const loop = readFileSync(new URL("../migrations/2026-10-02-metric-closed-loop.sql", import.meta.url), "utf8");
const viewSql = loop.slice(loop.indexOf("CREATE VIEW v_metric_trigger_state AS"), loop.indexOf("FROM raw;") + "FROM raw;".length);
db.exec("CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT UNIQUE, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER DEFAULT 5, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER DEFAULT 168, enabled INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT (datetime('now')));" +
  "CREATE TABLE analytics_dash_records (metric TEXT, value TEXT); CREATE TABLE analytics_dash_meta (key TEXT, value TEXT);" + viewSql);
db.exec("DELETE FROM metric_registry");
db.exec(mig);
db.exec(mig);   // idempotent
const reg = one("SELECT * FROM metric_registry WHERE metric = ?", mod.LEARNER_METRIC), D = mod.LEARNER_METRIC_DEF;
ok(reg && reg.formula === D.formula && reg.source_of_truth === D.source && reg.baseline === D.baseline && reg.target === D.target && reg.disposition_actor === D.actor && reg.warning_band === D.warning && reg.kill_band === D.kill && reg.owner === "qnfo-social" && reg.refresh_cadence === "daily" && reg.refresh_class === "computed", "the migration and the worker register the identical definition");
const trg = all("SELECT * FROM analytics_metric_triggers WHERE metric_key = ?", mod.LEARNER_METRIC);
ok(trg.length === 1 && trg[0].operator === "lt" && trg[0].threshold === 0.2 && trg[0].owner === "qnfo-social" && trg[0].queue_target === "agent_issues" && trg[0].enabled === 1 && /Definition of done/.test(trg[0].action) && /GET https:\/\/qnfo-social\.q08\.workers\.dev\/learner/.test(trg[0].action), "one trigger row (re-running adds none) with a threshold, owner, lever and definition of done");
const judge = () => one("SELECT val, hit FROM v_metric_trigger_state WHERE metric_key = ?", mod.LEARNER_METRIC);
db.exec("DELETE FROM social_threads; DELETE FROM dissemination_tracker; DELETE FROM social_engagements");
await mod.learnerEngagementRate(env, NOWM);
ok(/^n\/a: /.test(one("SELECT last_value FROM metric_registry WHERE metric = ?", mod.LEARNER_METRIC).last_value) && judge().hit === null, "before any closed window the value is n/a and the trigger is unreadable, not in breach");
addThread("j1", "JPS", null, JPS, { status: "posted", posted_at: "2026-10-10 08:30:00", post_uri: "at://did:plc:me/app.bsky.feed.post/j1" });
addThread("j2", "JPS", null, JPS, { status: "posted", posted_at: "2026-10-11 08:30:00", post_uri: "at://did:plc:me/app.bsky.feed.post/j2" });
se("at://did:plc:me/app.bsky.feed.post/j1", "2026-10-11", { likes: 0, reposts: 0, replies: 0, quotes: 0 });
se("at://did:plc:me/app.bsky.feed.post/j2", "2026-10-12", { likes: 0, reposts: 0, replies: 0, quotes: 0 });
await mod.learnerEngagementRate(env, NOWM);
ok(judge().val === 0 && judge().hit === 1, "0 engagements per post: the trigger is in breach (val 0, hit 1)");
se("at://did:plc:me/app.bsky.feed.post/j2", "2026-10-13", { likes: 1, reposts: 0, replies: 0, quotes: 0 });
await mod.learnerEngagementRate(env, NOWM);
ok(judge().val === 0.5 && judge().hit === 0, "0.5 engagements per post: inside the threshold (hit 0)");

// ---------- 12. GET /learner is open; the 07:00Z cron runs the metric and the weekly tick ----------
reset();
ids = seedQueue();
mod.setLearnerRng(mulberry32(8));
await mod.drainQueue(env, { nowMs: OFF });
const res = await W.fetch(new Request("https://qnfo-social.q08.workers.dev/learner"), env);
const jl = await res.json();
ok(res.status === 200 && jl.enabled === true && jl.posterior && jl.posterior.topic.energy && jl.pending && jl.pending.slot && Array.isArray(jl.recent) && jl.next_week_allocation, "GET /learner needs no token and shows the posterior, the pending decision and recent posts");
ok((await W.fetch(new Request("https://qnfo-social.q08.workers.dev/threads"), env)).status === 401, "the write and admin routes still need the token");
const bare = new DatabaseSync(":memory:");
bare.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT)");
const jb = await (await W.fetch(new Request("https://qnfo-social.q08.workers.dev/learner"), { DB: { prepare: (sql) => stmtOn(bare, sql) } })).json();
ok(jb.posterior && jb.posterior.slot["us-morning"].a === 1 && /prior/.test(jb.note) && Array.isArray(jb.recent) && jb.recent.length === 0 && !bare.prepare("SELECT name FROM sqlite_master WHERE name = 'social_learner_posts'").get(), "before the first learner run GET /learner shows the prior and creates nothing");
{
  const _ce = console.error; console.error = () => {};
  const er = await W.fetch(new Request("https://qnfo-social.q08.workers.dev/learner"), { DB: { prepare: () => { throw new Error("D1_ERROR secret-internal-detail at stmtOn"); } } });
  console.error = _ce;
  const ej = await er.json();
  ok(er.status === 200 && ej.posterior_error === "posterior unavailable" && ej.pending_error === "pending unavailable" && ej.recent_error === "recent unavailable" && ej.switch === "switch unreadable, old order" && !/secret-internal-detail|D1_ERROR|stmtOn/.test(JSON.stringify(ej)), "GET /learner on a failing D1 names the unavailable parts and exposes no exception text (CodeQL js/stack-trace-exposure)");
}
const hj = await (await W.fetch(new Request("https://qnfo-social.q08.workers.dev/health"), env)).json();
ok(versionAtLeast(hj.version, "0.7.29") && hj.capabilities.includes("distribution-learner"), "/health names the learner");
reset();
await W.scheduled({ cron: "0 7 * * *" }, env);
const today = new Date().toISOString().slice(0, 10);
const eng = one("SELECT meta FROM cloud_ops_events WHERE id = ?", "social-engagement-" + today);
ok(eng && JSON.parse(eng.meta).result.rate_30d && one("SELECT status FROM cloud_ops_events WHERE id = ?", "social-learner-update-" + today).status === "ok", "the 07:00Z cron records the 30-day rate with the engagement run and runs the learner's first weekly update");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
