// ATTENTION-LOOP-1 offline suite (qnfo-fleet-dashboard 1.24.0, pillar reach; owner directive 2026-10-06 07:44Z: granular
// human attention per outreach channel and item, audit automatically, do more of what gets noticed, promote better or stop
// what is not). Replays the ATTENTION-LOOP-1 block and the reach row builders from worker.js against an in-memory SQLite
// D1. Proves: the pure verdict rules (insufficient, stop, promote, improve, keep, re-test after 28 days, thresholds
// override), the share map, the efficacy grading, the bot-filtered per-item row builder; then one scorecard day over a
// fixture shaped like 2026-10-06 (a dozen Bluesky posts with one like and no referred visit, a few Buffer posts, outreach
// sends) writes the scorecard rows, the decisions with predictions, the share row qnfo-social reads, the metrics and the
// ledger; a second call the same day is throttled; a later day grades the decisions; a stopped channel is re-tested.
// Run: node qnfo-fleet-dashboard/attention.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const block = src.slice(src.indexOf("// ---- ATTENTION-LOOP-1:BEGIN"), src.indexOf("// ---- ATTENTION-LOOP-1:END"));
if (!block || block.indexOf("async function attentionScorecard(env, opts)") < 0) throw new Error("ATTENTION-LOOP-1 block not found in worker.js");
const helpers = src.slice(src.indexOf("var REACH_INGEST_AFTER_UTC_HOUR"), src.indexOf("function reachRumQuery(dims, geq, leq, extraFilter) {"));
if (!helpers || helpers.indexOf("function atRumExternalRows(groups, day)") < 0 || helpers.indexOf("function reachCapRows(") < 0) throw new Error("reach helpers not found in worker.js");
const hosts = src.slice(src.indexOf("var HA_PUBLIC_HOSTS"), src.indexOf("var HA_DAYS"));
if (!hosts || hosts.indexOf("HA_FLEET_HOST_RE") < 0) throw new Error("HUMAN-AUDIENCE-1 host constants not found");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };

const DDL = `CREATE TABLE reach_signals (date TEXT NOT NULL, source TEXT NOT NULL, channel TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metric TEXT NOT NULL, value REAL, quality TEXT, collected_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (date, source, channel, entity_type, entity_id, metric));
CREATE TABLE social_threads (id INTEGER PRIMARY KEY, slug TEXT, title TEXT, posts TEXT, status TEXT, posted_at TEXT, post_uri TEXT);
CREATE TABLE dissemination_tracker (id TEXT PRIMARY KEY, paper_slug TEXT, paper_title TEXT, channel TEXT, action TEXT, post_id TEXT, posted_at TEXT);
CREATE TABLE social_media_posts (id TEXT PRIMARY KEY, platform TEXT, post_id TEXT, buffer_id TEXT, project_id TEXT, published_at TEXT, status TEXT);
CREATE TABLE outreach_learner_sends (queue_id TEXT PRIMARY KEY, email TEXT, segment TEXT, sent_at TEXT, outcome TEXT);
CREATE TABLE outreach_learner_arms (segment TEXT PRIMARY KEY, sends INTEGER, positives INTEGER, stopped INTEGER);
CREATE TABLE subscribers (email TEXT PRIMARY KEY, status TEXT, source TEXT, created_at TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
INSERT INTO metric_registry (metric) VALUES ('attention_events_7d'), ('attention_per_post_7d'), ('pages_noticed_7d'), ('attention_channels_stopped'), ('attention_decision_efficacy_30d');`;
const db = new DatabaseSync(":memory:");
db.exec(DDL);
function d1(dbx) {
  return { prepare(sql) {
    let args = [];
    const s = {
      bind(...x) { args = x.map((v) => (v === undefined ? null : v)); return s; },
      async all() { return { results: dbx.prepare(sql).all(...args) }; },
      async first() { return dbx.prepare(sql).get(...args) || null; },
      async run() { const r = dbx.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
    };
    return s;
  }, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}
const sb = { console, Date, Math, JSON, Number, String, Object, Array, RegExp, Map, isFinite, VERSION: "1.24.0-test", NAME: "qnfo-fleet-dashboard", DAY_MS: 864e5, __name: (f) => f, __export: null };
sb.d1all = async function(dbx, sql, params) { let ps = dbx.prepare(sql); if (params && params.length) ps = ps.bind.apply(ps, params); const r = await ps.all(); return r.results || []; };
vm.createContext(sb);
vm.runInContext(hosts + "\n" + helpers + "\n" + block + "\n__export = { atBufferChannel, atBufferMetric, atReferrerChannel, atBlueskyUri, atBlueskyAttention, atThresholds, atVerdict, atShares, atEfficacy, atRumExternalRows, atShiftDay, atPooledRow, attentionScorecard, attentionLatest, AT_DEFAULT_THRESHOLDS, AT_SHARE };", sb, { filename: "attention-block" });
const T = sb.__export;

// ---------- pure helpers ----------
ok(T.atBufferChannel("buffer-twitter") === "x" && T.atBufferChannel("buffer-linkedin") === "linkedin", "Buffer platforms map to channels (twitter -> x)");
ok(T.atBufferMetric("Reactions") === "reactions" && T.atBufferMetric("Link Clicks") === "clicks" && T.atBufferMetric("Impressions") === "impressions" && T.atBufferMetric("Odd Thing") === "odd_thing", "Buffer metric labels normalise");
ok(T.atReferrerChannel("www.linkedin.com") === "linkedin" && T.atReferrerChannel("com.linkedin.android") === "linkedin" && T.atReferrerChannel("t.co") === "x" && T.atReferrerChannel("bsky.app") === "bluesky" && T.atReferrerChannel("mstdn.science") === "mastodon" && T.atReferrerChannel("www.google.com") === null, "referrer hosts map to channels; search engines do not");
ok(T.atBlueskyUri("at://did:plc:x/app.bsky.feed.post/1") === "at://did:plc:x/app.bsky.feed.post/1" && T.atBlueskyUri('{"bluesky":"at://did:plc:x/app.bsky.feed.post/2","linkedin":"buffer:abc"}') === "at://did:plc:x/app.bsky.feed.post/2" && T.atBlueskyUri("buffer:abc") === null, "a post_uri yields its Bluesky uri whether plain or JSON");
ok(T.atBlueskyAttention({ likes: 2, reposts: 1, quotes: 0, replies: 3 }, 3) === 4, "a 3-post thread's own two continuation replies are not attention");
ok(T.atThresholds('{"stop_per_item": 0.2, "min_items": "x"}').stop_per_item === 0.2 && T.atThresholds('{"min_items": "x"}').min_items === 5 && T.atThresholds("nonsense").promote_per_item === 1, "ops_config thresholds override only valid numbers");

// ---------- verdict rules ----------
const NOW = "2026-10-07T05:00:00.000Z";
const V = (s, prev, th) => T.atVerdict(s, prev || null, th || null, NOW);
ok(V({ items: 3, attention: 0, visits: 0 }).verdict === "INSUFFICIENT" && V({ items: 3 }).share === 1, "under 5 items the channel keeps full share: exploring, not judged");
let v = V({ items: 12, attention: 1, visits: 0 });
ok(v.verdict === "STOP" && v.share === 0 && v.retest_at === "2026-11-04T00:00:00Z" && /stop and shift/.test(v.reason), "12 items, 1 engagement, no visit: STOP with a re-test in 28 days (the 2026-10-06 Bluesky case)");
ok(V({ items: 12, attention: 1, visits: 5 }).verdict === "IMPROVE", "the same engagement with referred visits is not a stop (visits are attention)");
ok(V({ items: 9, attention: 0, visits: 0 }).verdict === "IMPROVE", "under 10 items a channel with no attention is improved, not stopped");
ok(V({ items: 6, attention: 9, visits: 0 }).verdict === "PROMOTE" && V({ items: 6, attention: 9 }).share === 1, "1.5 engagements per item: PROMOTE (up to the owner's cap, never above)");
ok(V({ items: 6, attention: 4, visits: 0 }).verdict === "KEEP", "0.67 per item: KEEP");
ok(V({ items: 6, attention: 2, visits: 0 }).verdict === "IMPROVE" && V({ items: 6, attention: 2 }).share === 0.5, "0.33 per item: IMPROVE at half share");
ok(V({ items: 12, attention: 1, visits: 0 }, null, T.atThresholds('{"stop_per_item": 0.05}')).verdict === "IMPROVE", "a lower stop threshold from ops_config keeps the channel");
v = V({ items: 12, attention: 1, visits: 0 }, { verdict: "STOP", retest_at: "2026-11-04T00:00:00Z" });
ok(v.verdict === "STOP" && v.share === 0 && v.retest_at === "2026-11-04T00:00:00Z", "a stopped channel stays stopped before its re-test date whatever the stale numbers say");
v = V({ items: 12, attention: 1, visits: 0 }, { verdict: "STOP", retest_at: "2026-10-01T00:00:00Z" });
ok(v.verdict === "RETEST" && v.share === 0.25 && v.retest_at === "2026-10-14T00:00:00Z", "past the re-test date: a week at a quarter share");
ok(V({ items: 12, attention: 1, attention7: 0 }, { verdict: "RETEST", retest_at: "2026-10-14T00:00:00Z" }).verdict === "RETEST", "the re-test week runs its course");
ok(V({ items: 12, attention: 1, attention7: 2 }, { verdict: "RETEST", retest_at: "2026-10-01T00:00:00Z" }).verdict === "IMPROVE", "a re-test that drew attention comes back at half share");
v = V({ items: 12, attention: 1, attention7: 0, visits7: 0 }, { verdict: "RETEST", retest_at: "2026-10-01T00:00:00Z" });
ok(v.verdict === "STOP" && v.retest_at === "2026-11-04T00:00:00Z", "a re-test that drew nothing stops again for another 28 days");
// ATTENTION-STOP-RELEASE-1 (agent_issues 100190): a stop needs no referred visit, so a stopped channel that has since drawn a referred
// visit or a utm human click is judged again by the normal rules; one with still none stays stopped until its re-test date.
const STOPPED = { verdict: "STOP", retest_at: "2026-11-04T00:00:00Z" };
v = V({ items: 209, attention: 4, visits: 0, clicks_human: 496 }, STOPPED);
ok(v.verdict === "IMPROVE" && v.share === 0.5 && v.retest_at === null && /engagements per item over 209 items/.test(v.reason), "a stopped channel with 496 utm human clicks leaves STOP: IMPROVE at half share (the 2026-10-26 Bluesky numbers)");
v = V({ items: 12, attention: 1, visits: 3 }, STOPPED);
ok(v.verdict === "IMPROVE" && v.share === 0.5, "a stopped channel with referred visits is judged again too");
v = V({ items: 12, attention: 14, visits: 0, clicks_human: 5 }, STOPPED);
ok(v.verdict === "PROMOTE" && v.share === 1, "a released channel that earns 1.17 engagements per item is promoted");
v = V({ items: 4, attention: 0, visits: 0, clicks_human: 12 }, STOPPED);
ok(v.verdict === "INSUFFICIENT" && v.share === 1, "a released channel under 5 items is explored at full share");
v = V({ items: 12, attention: 1, visits: 0, clicks_human: 9 }, { verdict: "STOP", retest_at: "2026-10-01T00:00:00Z" });
ok(v.verdict === "IMPROVE" && v.share === 0.5, "past its re-test date a channel with clicks is judged on its numbers, not sent to a re-test");
v = V({ items: 12, attention: 1, visits: 0, clicks_human: 0 }, STOPPED);
ok(v.verdict === "STOP" && v.share === 0 && v.retest_at === "2026-11-04T00:00:00Z", "a stop with no visit and no click stays stopped until its re-test date");
v = V({ items: 12, attention: 1, visits: 0, clicks_human: null }, STOPPED);
ok(v.verdict === "STOP" && v.share === 0, "unread utm clicks (null) are not a click: the channel stays stopped");
ok(V({ items: 12, attention: 1, visits: 0, clicks_human: 40 }).verdict === "IMPROVE", "the first-time rule is unchanged: with clicks the same numbers are not a stop");
ok(JSON.stringify(T.atShares({ bluesky: { share: 0 }, linkedin: { share: 0.5 }, x: null })) === JSON.stringify({ bluesky: 0, linkedin: 0.5, mastodon: 1, x: 1 }), "the share map carries every social channel; unmeasured ones read 1");
// ATTENTION-STOP-GRADE-1 (agent_issues 2467): a STOP is graded on the other channels, pooled; no rows reads unmeasured.
ok(T.atPooledRow([]) === null && T.atPooledRow([{ items: 4, attention: 1 }, { items: 0, attention: 0 }, { items: 4, attention: 3 }]).per_item === 0.5 && T.atPooledRow([{ items: 0, attention: 0 }]).per_item === 0, "pooled row: attention over items across channels, null without rows");
ok(T.atEfficacy({ items: 5, per_item: 0 }, { items: 5, per_item: 0.5 }).outcome === "improved" && T.atEfficacy({ items: 5, per_item: 1 }, { items: 5, per_item: 1.1 }).outcome === "flat" && T.atEfficacy({ items: 5, per_item: 1 }, { items: 5, per_item: 0.5 }).outcome === "worse" && T.atEfficacy(null, { items: 5, per_item: 1 }).outcome === "unmeasured", "efficacy: improved at +20%, worse at -20%, flat between, unmeasured without rows");
ok(T.atEfficacy({ items: 0, per_item: 0 }, { items: 0, per_item: 0 }).outcome === "unmeasured" && T.atEfficacy({ items: 5, per_item: 1 }, { items: 4, per_item: 0 }).outcome === "unmeasured", "a zero-to-zero comparison or a sparse 7-day window is not a measured flat outcome");

// ---------- the per-item row builder ----------
const rows = T.atRumExternalRows([
  { count: 20, dimensions: { requestHost: "papers.qnfo.org", requestPath: "/papers/jps-metric", refererHost: "www.google.com" } },
  { count: 10, dimensions: { requestHost: "papers.qnfo.org", requestPath: "/papers/jps-metric", refererHost: "qnfo.org" } },
  { count: 30, dimensions: { requestHost: "papers.qnfo.org", requestPath: "/papers/jps-metric", refererHost: "" } },
  { count: 10, dimensions: { requestHost: "qnfo.org", requestPath: "/about", refererHost: "t.co" } },
  { count: 50, dimensions: { requestHost: "fleet.qnfo.org", requestPath: "/", refererHost: "www.google.com" } },
  { count: 10, dimensions: { requestHost: "qnfo.org", requestPath: "/", refererHost: "qnfo-social.q08.workers.dev" } }
], "2026-10-06");
const ext = rows.filter((r) => r.metric === "external_pageviews"), cont = rows.filter((r) => r.metric === "continuation_pageviews");
ok(ext.length === 2 && ext.find((r) => r.entity_id === "jps-metric").value === 20 && ext.find((r) => r.entity_id === "jps-metric").entity_type === "paper" && ext.find((r) => r.entity_id === "qnfo.org/about").value === 10, "external loads per item: outside-fleet referrers only, papers classified as papers");
ok(cont.length === 1 && cont[0].entity_id === "jps-metric" && cont[0].value === 10, "a load from another public page is a continuation for that item");
ok(rows.every((r) => r.source === "cf-rum-human" && r.quality === "human") && !rows.some((r) => /fleet\.qnfo\.org/.test(r.entity_id)), "rows are human-quality and the owner's dashboard host is not a public item");

// ---------- one scorecard day over a 2026-10-06-shaped fixture ----------
const day = "2026-10-06";
const ins = db.prepare("INSERT INTO reach_signals (date, source, channel, entity_type, entity_id, metric, value, quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
// 12 Bluesky threads over the 28 days, one like on one of them, replies equal to each thread's own continuation.
for (let i = 1; i <= 12; i++) {
  const uri = "at://did:plc:q/app.bsky.feed.post/" + i;
  db.prepare("INSERT INTO social_threads (id, slug, title, posts, status, posted_at, post_uri) VALUES (?, ?, ?, ?, 'posted', ?, ?)").run(i, "slug-" + i, "Post " + i, JSON.stringify(["a https://papers.qnfo.org/papers/slug-" + i + "/", "b"]), "2026-09-" + String(10 + i).padStart(2, "0") + " 10:00:00", i % 2 ? uri : JSON.stringify({ bluesky: uri, linkedin: "buffer:x" }));
  ins.run(day, "bluesky", "bluesky", "post", uri, "likes", i === 5 ? 1 : 0, "human");
  ins.run(day, "bluesky", "bluesky", "post", uri, "replies", 1, "human");
  ins.run(day, "bluesky", "bluesky", "post", uri, "reposts", 0, "human");
}
// Buffer channel posts: 2 on LinkedIn (insufficient), 6 on X with 2 reactions each (promote), none on Mastodon.
db.prepare("INSERT INTO social_media_posts (id, platform, post_id, buffer_id, project_id, published_at, status) VALUES ('l1', 'buffer-linkedin', 'b1', 'b1', 'slug-1', '2026-10-02 09:00:00', 'published'), ('l2', 'buffer-linkedin', 'b2', 'b2', 'slug-2', '2026-10-04 09:00:00', 'published'), ('l3', 'buffer-linkedin', 'b3', 'b3', 'slug-3', '2026-08-01 09:00:00', 'failed')").run();
for (let i = 1; i <= 6; i++) { db.prepare("INSERT INTO social_media_posts (id, platform, post_id, buffer_id, project_id, published_at, status) VALUES (?, 'buffer-twitter', ?, ?, ?, ?, 'published')").run("x" + i, "bx" + i, "bx" + i, "slug-" + i, "2026-09-" + String(20 + i) + " 12:00:00"); ins.run(day, "buffer", "x", "post", "bx" + i, "reactions", 2, "human"); ins.run(day, "buffer", "x", "post", "bx" + i, "impressions", 100, "human"); }
// Referred human visits: LinkedIn 15, nothing from bsky.app (the app strips the Referer).
ins.run(day, "cf-rum-human", "web", "referrer", "www.linkedin.com", "pageviews", 14, "human");
ins.run(day, "cf-rum-human", "web", "referrer", "com.linkedin.android", "pageviews", 1, "human");
ins.run(day, "cf-rum-human", "web", "referrer", "www.google.com", "pageviews", 44, "human");
// Pages noticed from outside: 3 papers and 1 page.
ins.run(day, "cf-rum-human", "web", "paper", "slug-5", "external_pageviews", 9, "human");
ins.run(day, "cf-rum-human", "web", "paper", "slug-2", "external_pageviews", 3, "human");
ins.run(day, "cf-rum-human", "web", "paper", "slug-9", "external_pageviews", 1, "human");
ins.run(day, "cf-rum-human", "web", "page", "qnfo.org/about", "external_pageviews", 2, "human");
ins.run(day, "cf-rum-human", "web", "paper", "slug-5", "pageviews", 40, "human");
// Email: 10 sends, 2 positive, 1 negative; one arm stopped.
for (let i = 1; i <= 10; i++) db.prepare("INSERT INTO outreach_learner_sends (queue_id, email, segment, sent_at, outcome) VALUES (?, ?, 'qec:institutional', ?, ?)").run("q" + i, "p" + i + "@x.org", "2026-09-2" + (i % 9) + "T09:00:00Z", i <= 2 ? "positive" : i === 3 ? "negative" : null);
db.prepare("INSERT INTO outreach_learner_arms (segment, sends, positives, stopped) VALUES ('qec:institutional', 24, 2, 0), ('other:institutional', 60, 0, 1)").run();
db.prepare("INSERT INTO subscribers (email, status, source, created_at) VALUES ('a@x', 'subscribed', 'papers|/papers/slug-5|slug-5', '2026-10-03 10:00:00'), ('b@x', 'pending', 'qnfo.org', '2026-10-04 10:00:00')").run();

const env = { AUDIT: d1(db) };
const r1 = await T.attentionScorecard(env, { nowMs: Date.parse(NOW) });
ok(r1.day === day && !r1.throttled, "the scorecard runs for the last complete day");
const vb = r1.channels.bluesky.verdict, vx = r1.channels.x.verdict, vl = r1.channels.linkedin.verdict, vm2 = r1.channels.mastodon.verdict;
ok(r1.channels.bluesky.d28.items === 12 && r1.channels.bluesky.d28.attention === 1 && r1.channels.bluesky.d28.visits === 0, "Bluesky: 12 items, 1 engagement (own replies excluded), 0 referred visits");
ok(vb && vb.verdict === "STOP" && vb.share === 0, "Bluesky is stopped on that evidence: " + JSON.stringify(vb));
ok(r1.channels.x.d28.items === 6 && r1.channels.x.d28.attention === 12 && r1.channels.x.d28.impressions === 600 && vx.verdict === "PROMOTE", "X: 6 posts, 12 reactions, 600 impressions: PROMOTE");
ok(r1.channels.linkedin.d28.items === 0 && r1.channels.linkedin.d28.unmeasured === 2 && r1.channels.linkedin.d28.visits === 15 && vl.verdict === "INSUFFICIENT", "LinkedIn: 2 posts with no Buffer metric row (the failed August row excluded) are unmeasured, not scored as zero; 15 referred visits: too few measured items to judge (ATTENTION-UNMEASURED-1)");
ok(r1.channels.mastodon.d28.items === 0 && vm2.verdict === "INSUFFICIENT", "Mastodon: no post, not judged");
ok(r1.channels.email.d28.items === 10 && r1.channels.email.d28.attention === 3 && r1.channels.email.d28.positives === 2 && r1.channels.email.verdict.verdict === "KEEP" && /1 segment\(s\) stopped/.test(r1.channels.email.verdict.reason), "email: 10 sends, 3 replies, 2 positive; the outreach learner's stop rule is reported");
ok(r1.web.noticed_papers === 3 && r1.web.noticed_pages === 1 && r1.web.top_external[0].item === "slug-5" && r1.web.subscribers_by_source.length === 2, "web: 3 papers and 1 page noticed from outside, the busiest first; subscribers by source");
ok(JSON.stringify(r1.shares) === JSON.stringify({ bluesky: 0, linkedin: 1, mastodon: 1, x: 1 }), "shares: Bluesky 0, the rest 1");
const shareRow = db.prepare("SELECT value FROM ops_config WHERE key = 'attention_channel_share'").get();
const shareJson = JSON.parse(shareRow.value);
ok(shareJson.bluesky === 0 && shareJson.x === 1 && shareJson.day === day && shareJson.verdicts.bluesky === "STOP", "ops_config attention_channel_share carries the shares, the day and the verdicts for qnfo-social");
ok(db.prepare("SELECT COUNT(*) AS n FROM attention_scorecard WHERE day = ?").get(day).n === 11, "11 scorecard rows: 4 social x 2 windows, email x 2, web");
const dec = db.prepare("SELECT channel, from_verdict, to_verdict, to_share, verify_at, prediction FROM attention_decisions ORDER BY id").all();
ok(dec.length === 4 && dec.every((d) => d.from_verdict === null && d.verify_at === "2026-10-13") && dec.find((d) => d.channel === "bluesky").to_share === 0 && /no human reader is lost/.test(dec.find((d) => d.channel === "bluesky").prediction), "four first decisions, each with a prediction and a verify date 7 days out");
const m = Object.fromEntries(db.prepare("SELECT metric, last_value FROM metric_registry").all().map((r) => [r.metric, r.last_value]));
ok(m.attention_channels_stopped === "1" && m.pages_noticed_7d === "4" && /^n\/a/.test(m.attention_decision_efficacy_30d), "metrics: 1 channel stopped, 4 items noticed, efficacy not yet measurable: " + JSON.stringify(m));
ok(Number(m.attention_events_7d) === 15 + 15 && /^n\/a: no measured social post/.test(m.attention_per_post_7d), "attention_events_7d sums the week: 15 LinkedIn-referred loads + 15 external loads (the Bluesky and X posts and the sends are older than 7 days); the 2 LinkedIn posts have no metric row, so per post reads n/a, never 0: " + m.attention_events_7d + " / " + m.attention_per_post_7d);
const ev = db.prepare("SELECT status, text, meta FROM cloud_ops_events WHERE id = ?").get("attention-scorecard-" + day);
ok(ev && ev.status === "ok" && /bluesky STOP@0/.test(ev.text) && JSON.parse(ev.meta).last_ok, "the ledger row the watchmaker reads is written with the verdicts");
const r2 = await T.attentionScorecard(env, { nowMs: Date.parse(NOW) + 36e5 });
ok(r2.throttled === day, "a second run the same day is throttled");
// Eight days later: the decisions are graded; Bluesky stays stopped; X is still promoted.
const NOW2 = "2026-10-15T05:00:00.000Z";
const r3 = await T.attentionScorecard(env, { nowMs: Date.parse(NOW2) });
ok(r3.day === "2026-10-14" && r3.channels.bluesky.verdict.verdict === "STOP" && r3.shares.bluesky === 0, "a week later Bluesky is still stopped (re-test on 2026-11-04)");
ok(r3.efficacy.graded_now === 4 && db.prepare("SELECT COUNT(*) AS n FROM attention_decisions WHERE outcome IS NOT NULL").get().n === 4, "the four decisions are graded once their verify date passes");
ok(db.prepare("SELECT outcome FROM attention_decisions WHERE channel = 'x'").get().outcome === "unmeasured", "X's promotion is unmeasured: no X posts in the week before or after cannot establish a flat outcome");
{ const bs = db.prepare("SELECT outcome, outcome_detail FROM attention_decisions WHERE channel = 'bluesky' AND to_verdict = 'STOP'").get(); ok(bs && /^other channels fewer than 5 items/.test(bs.outcome_detail || "") && bs.outcome === "unmeasured", "the Bluesky STOP is graded against other channels pooled, but sparse periods stay unmeasured (ATTENTION-STOP-GRADE-1): " + JSON.stringify(bs)); }
ok(r3.efficacy.judged === 0 && /^n\/a/.test(db.prepare("SELECT last_value FROM metric_registry WHERE metric = 'attention_decision_efficacy_30d'").get().last_value), "sparse decision windows do not enter the efficacy denominator");
ok(r3.decisions.length === 0, "no verdict changed, no new decision");
// After the re-test date: a quarter share for a week.
const r4 = await T.attentionScorecard(env, { nowMs: Date.parse("2026-11-05T05:00:00.000Z") });
ok(r4.channels.bluesky.verdict.verdict === "RETEST" && r4.shares.bluesky === 0.25 && r4.decisions.some((d) => d.channel === "bluesky" && d.to === "RETEST"), "28 days after the stop, Bluesky is re-tested at a quarter share and the change is a decision");
const latest = await T.attentionLatest(env);
ok(latest.ok && latest.day === "2026-11-04" && latest.scorecard.length === 11 && latest.decisions.length >= 5 && latest.shares.value.bluesky === 0.25 && latest.rules.thresholds.stop_items === 10, "GET /api/attention serves the latest day, the decisions, the shares and the rules");

// ---------- ATTENTION-STOP-RELEASE-1 end to end (agent_issues 100190): the scorecard releases a stop that has utm human clicks ----------
// The 2026-10-06 shape: 12 Bluesky threads with one like and no referred visit, stopped on 2026-10-06 with a re-test on 2026-11-03.
// Twenty days later the channel has utm human clicks (reach_signals source utm, channel bluesky): the daily pass must not hold it at share 0.
async function stopWorld(clicks) {
  const d2 = new DatabaseSync(":memory:");
  d2.exec(DDL);
  const put = d2.prepare("INSERT INTO reach_signals (date, source, channel, entity_type, entity_id, metric, value, quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (let i = 1; i <= 12; i++) {
    const uri = "at://did:plc:q/app.bsky.feed.post/" + i;
    d2.prepare("INSERT INTO social_threads (id, slug, title, posts, status, posted_at, post_uri) VALUES (?, ?, ?, ?, 'posted', ?, ?)").run(i, "slug-" + i, "Post " + i, JSON.stringify(["a https://papers.qnfo.org/papers/slug-" + i + "/", "b"]), "2026-10-" + String(1 + i).padStart(2, "0") + " 10:00:00", uri);
    put.run("2026-10-19", "bluesky", "bluesky", "post", uri, "likes", i === 5 ? 1 : 0, "human");
    put.run("2026-10-19", "bluesky", "bluesky", "post", uri, "replies", 1, "human");
    put.run("2026-10-19", "bluesky", "bluesky", "post", uri, "reposts", 0, "human");
  }
  if (clicks) put.run("2026-10-18", "utm", "bluesky", "campaign", "slug-5", "clicks_human", clicks, "human");
  d2.exec("CREATE TABLE IF NOT EXISTS attention_scorecard (day TEXT NOT NULL, window_days INTEGER NOT NULL, channel TEXT NOT NULL, items INTEGER, attention REAL, per_item REAL, visits REAL, impressions REAL, verdict TEXT, share REAL, reason TEXT, retest_at TEXT, extra TEXT, created_at TEXT, PRIMARY KEY (day, window_days, channel))");
  d2.prepare("INSERT INTO attention_scorecard (day, window_days, channel, items, attention, per_item, visits, impressions, verdict, share, reason, retest_at, extra, created_at) VALUES ('2026-10-06', 28, 'bluesky', 12, 1, 0.083, 0, NULL, 'STOP', 0, '12 items drew 1 engagements', '2026-11-03T00:00:00Z', '{}', '2026-10-06T05:00:00Z')").run();
  return d2;
}
{
  const NOW3 = Date.parse("2026-10-20T05:00:00.000Z");
  const wc = await stopWorld(40);
  const rc = await T.attentionScorecard({ AUDIT: d1(wc) }, { nowMs: NOW3 });
  ok(rc.day === "2026-10-19" && rc.channels.bluesky.d28.items === 12 && rc.channels.bluesky.d28.clicks_human === 40, "the scorecard reads the 40 utm human clicks of the 28 days for Bluesky", rc.channels.bluesky.d28);
  ok(rc.channels.bluesky.verdict.verdict === "IMPROVE" && rc.shares.bluesky === 0.5, "a Bluesky stopped on 2026-10-06 with 40 utm human clicks is IMPROVE at half share on 2026-10-19, not held at 0", rc.channels.bluesky.verdict);
  const cfg = JSON.parse(wc.prepare("SELECT value FROM ops_config WHERE key = 'attention_channel_share'").get().value);
  ok(cfg.bluesky === 0.5 && cfg.verdicts.bluesky === "IMPROVE" && cfg.day === "2026-10-19", "ops_config attention_channel_share, the row qnfo-social reads, carries Bluesky at 0.5");
  ok(rc.decisions.some((d) => d.channel === "bluesky" && d.from === "STOP" && d.to === "IMPROVE" && d.share === 0.5), "the release is one recorded decision from STOP to IMPROVE", rc.decisions);
  ok(wc.prepare("SELECT last_value FROM metric_registry WHERE metric = 'attention_channels_stopped'").get().last_value === "0", "attention_channels_stopped reads 0");
  const wn = await stopWorld(0);
  const rn = await T.attentionScorecard({ AUDIT: d1(wn) }, { nowMs: NOW3 });
  ok(rn.channels.bluesky.verdict.verdict === "STOP" && rn.shares.bluesky === 0 && !rn.decisions.some((d) => d.channel === "bluesky"), "the same channel with no click stays stopped until its re-test date, and no Bluesky decision is recorded", rn.channels.bluesky.verdict);
}

// ---------- the source stays ASCII (ASCII-SOURCE-1) ----------
ok(!/[^\x00-\x7F]/.test(src), "worker.js is ASCII-only");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
