// SHORT-POSTS-1 offline suite (qnfo-social 0.22.0, roadmap YT-16): the Short rendered for a paper is posted natively to Bluesky (AT Protocol video upload)
// and Mastodon (media upload) inside the existing caps. In-memory SQLite D1, stubbed R2 and fetch; no network.
// Run: node qnfo-social/shorts-posts.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
const mod = await import("./worker.js");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + String(d).slice(0, 300))); } };

const mk = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE social_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, title TEXT, posts TEXT, status TEXT DEFAULT 'queued', posted_at TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT, error TEXT, flags TEXT, notes TEXT, post_uri TEXT);
CREATE TABLE social_media_posts (id TEXT PRIMARY KEY, platform TEXT NOT NULL, post_id TEXT, url TEXT, content_preview TEXT, published_at TEXT, buffer_id TEXT, project_id TEXT, paper_doi TEXT, status TEXT, engagement_metrics TEXT);
CREATE TABLE pipeline_flags (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE TABLE dissemination_tracker (id TEXT PRIMARY KEY, paper_slug TEXT, channel TEXT, action TEXT, post_id TEXT, posted_at TEXT, mode TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TABLE youtube_videos (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, rev TEXT, state TEXT NOT NULL, title TEXT, attempts INTEGER NOT NULL DEFAULT 0, note TEXT, duration_s REAL, video_id TEXT, privacy TEXT, synthetic INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, uploaded_at TEXT, views INTEGER);
INSERT INTO youtube_videos (id, slug, state, title, video_id, privacy, created_at, updated_at, uploaded_at) VALUES
 (1, 'old-short', 'uploaded', 'Old weak Short', 'AAAAAAAAAAA', 'public', '2026-10-27', '2026-10-27', '2026-10-27T12:00:00Z'),
 (2, 'new-short', 'uploaded', 'Why a number can be close to zero in two ways #Shorts', 'BBBBBBBBBBB', 'public', '2026-11-05', '2026-11-05', '2026-11-05T12:00:00Z'),
 (3, 'private-short', 'uploaded', 'Private', 'CCCCCCCCCCC', 'private', '2026-11-05', '2026-11-05', '2026-11-05T13:00:00Z'),
 (4, 'rendering-short', 'rendering', 'Not done', NULL, NULL, '2026-11-05', '2026-11-05', NULL);`);
  const lp = new DatabaseSync(":memory:");
  lp.exec(`CREATE TABLE papers (slug TEXT, title TEXT, abstract TEXT, status TEXT); INSERT INTO papers VALUES ('new-short','Closeness of numbers','A plain abstract about metrics.','published'),('private-short','P','a','published'),('old-short','Old','a','published');`);
  const wrap = (d) => ({ prepare(sql) { let a = []; const s = { bind(...x) { a = x.map((v) => (v === undefined ? null : v)); return s; }, async all() { return { results: d.prepare(sql).all(...a) }; }, async first() { return d.prepare(sql).get(...a) || null; }, async run() { const r = d.prepare(sql).run(...a); return { success: true, meta: { changes: Number(r.changes) } }; } }; return s; }, async batch(l) { for (const s of l) await s.run(); return []; } });
  return { db, DB: wrap(db), LIVING_PAPER: wrap(lp) };
};

let calls = [];
const R2 = (n) => ({ MEDIA: { async get(k) { if (!/^youtube\/\d+\/short\.mp4$/.test(k)) return null; return { size: n, async arrayBuffer() { return new Uint8Array(n).buffer; } }; } } });
let mastodonProcessing = 1;
globalThis.fetch = async (url, init) => {
  const u = String(url), method = (init && init.method) || "GET";
  calls.push({ u, method, init });
  const J = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: { "Content-Type": "application/json" } });
  if (u.endsWith("/com.atproto.server.createSession")) return J({ did: "did:plc:abc", accessJwt: "jwt", handle: "qnfo.bsky.social" });
  if (u.startsWith("https://plc.directory/")) return J({ service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://morel.us-east.host.bsky.network" }] });
  if (u.includes("/com.atproto.server.getServiceAuth")) return J({ token: "svc-token" });
  if (u.includes("/app.bsky.video.uploadVideo")) return J({ jobId: "job1", did: "did:plc:abc", state: "JOB_STATE_CREATED" });
  if (u.includes("/app.bsky.video.getJobStatus")) return J({ jobStatus: { jobId: "job1", state: "JOB_STATE_COMPLETED", blob: { $type: "blob", ref: { $link: "bafyvideo" }, mimeType: "video/mp4", size: 1234 } } });
  if (u.endsWith("/com.atproto.repo.createRecord")) return J({ uri: "at://did:plc:abc/app.bsky.feed.post/3kshort", cid: "c" });
  if (u.endsWith("/api/v2/media")) return J({ id: "m1" }, 202);
  if (u.includes("/api/v1/media/m1")) return new Response("{}", { status: mastodonProcessing-- > 0 ? 206 : 200 });
  if (u.endsWith("/api/v1/statuses")) return J({ id: "s1", url: "https://mstdn.science/@qnfo/s1" });
  if (u.startsWith("https://papers.qnfo.org/")) return new Response("<html>paper</html>", { status: 200 });
  return new Response("nf", { status: 404 });
};
// speed: the polling waits are two seconds; the stubs answer ready on the second look
const realSetTimeout = globalThis.setTimeout; globalThis.setTimeout = (f, ms, ...r) => realSetTimeout(f, Math.min(ms || 0, 5), ...r);

const base = (e) => Object.assign({ DB: e.DB, LIVING_PAPER: e.LIVING_PAPER, BSKY_HANDLE: "qnfo.bsky.social", BSKY_APP_PASS: "x", MASTODON_TOKEN: "tok" }, R2(2048));

// ---- pure helpers
ok(mod.shortsText("Why a number can be close to zero #Shorts", "s1").includes("Why a number can be close to zero\n"), "hashtags are dropped from the title");
ok(/papers\.qnfo\.org\/papers\/s1$/.test(mod.shortsText("T", "s1")), "the text ends in the paper link");
ok(/AI-generated voice/.test(mod.shortsText("T", "s1")), "the text says the voice is AI-generated");

// ---- first run: only the new, public, uploaded Short, on both platforms, one post each
let e = base(mk());
const dry = await mod.drainShorts(e, { dry: true });
ok(dry.platforms.bluesky === "dry:new-short" && dry.platforms.mastodon === "dry:new-short", "dry run names only the post-floor public Short", JSON.stringify(dry));
ok(!calls.some((c) => c.u.includes("uploadVideo") || c.u.endsWith("/api/v2/media")), "a dry run uploads nothing");

calls = [];
const r1 = await mod.drainShorts(e);
ok(r1.posted === 2, "one Short posted on each platform", JSON.stringify(r1));
const up = calls.find((c) => c.u.includes("/app.bsky.video.uploadVideo"));
ok(up && up.u.startsWith("https://video.bsky.app/xrpc/") && up.init.headers.Authorization === "Bearer svc-token" && up.init.headers["Content-Type"] === "video/mp4", "Bluesky upload uses the service-auth token on video.bsky.app");
const sa = calls.find((c) => c.u.includes("getServiceAuth"));
ok(sa && decodeURIComponent(sa.u).includes("aud=did:web:morel.us-east.host.bsky.network") && sa.u.includes("lxm=com.atproto.repo.uploadBlob"), "service auth is for the user's PDS", sa && sa.u);
const rec = JSON.parse(calls.find((c) => c.u.endsWith("/com.atproto.repo.createRecord")).init.body).record;
ok(rec.embed && rec.embed.$type === "app.bsky.embed.video" && rec.embed.video.ref.$link === "bafyvideo" && rec.embed.aspectRatio.height === 1920 && rec.embed.alt.includes("AI-generated voice"), "the record embeds the video blob at 9:16 with alt text", JSON.stringify(rec.embed));
ok(rec.text.includes("papers.qnfo.org/papers/new-short") && /\[AI-generated\]$/.test(rec.text), "the Bluesky text carries the paper link and the AI marker", rec.text);
ok(rec.facets && rec.facets[0].features[0].uri.includes("utm_source=bluesky"), "the link is UTM-tagged as every other post", JSON.stringify(rec.facets));
const mm = calls.find((c) => c.u.endsWith("/api/v1/statuses"));
const mbody = new URLSearchParams(String(mm.init.body));
ok(mbody.get("media_ids[]") === "m1" && mbody.get("visibility") === "public" && /\[AI-generated\]$/.test(mbody.get("status")) && mbody.get("status").includes("utm_source=mastodon"), "the Mastodon status attaches the media, is marked and tagged", mbody.toString());
ok(calls.filter((c) => c.u.includes("/api/v1/media/m1")).length >= 2, "Mastodon media is polled until the transcode is ready");
ok(mm.init.headers["Idempotency-Key"].startsWith("short-"), "the Mastodon post is idempotent");
const th = await e.DB.prepare("SELECT status, post_uri, posts FROM social_threads WHERE slug LIKE 'short-%'").all();
ok(th.results.length === 1 && th.results[0].status === "posted" && th.results[0].post_uri === "at://did:plc:abc/app.bsky.feed.post/3kshort", "Bluesky post is recorded in social_threads, so the weekly cap counts it", JSON.stringify(th.results));
const sm = await e.DB.prepare("SELECT platform, status FROM social_media_posts").all();
ok(sm.results.length === 1 && sm.results[0].platform === "buffer-mastodon", "Mastodon post is recorded in social_media_posts, so the channel cap counts it", JSON.stringify(sm.results));
const led = await e.DB.prepare("SELECT platform, state FROM social_video_posts ORDER BY platform").all();
ok(led.results.length === 2 && led.results.every((x) => x.state === "posted"), "the Short ledger has a posted row per platform", JSON.stringify(led.results));

// ---- second run: nothing left to post, nothing uploaded
calls = [];
const r2 = await mod.drainShorts(e);
ok(r2.posted === 0 && !calls.some((c) => c.u.includes("uploadVideo")), "a posted Short is never posted twice", JSON.stringify(r2));

// ---- gates
let g = base(mk());
await g.DB.prepare("INSERT INTO pipeline_flags (key, value, updated_at) VALUES ('social_paused','1',datetime('now'))").run();
calls = [];
const rp = await mod.drainShorts(g);
ok(rp.skipped === "paused" && calls.length === 0, "social_paused holds every Short post", JSON.stringify(rp));

g = base(mk());
await g.DB.prepare("INSERT INTO pipeline_flags (key, value, updated_at) VALUES ('social_video_since','2026-11-06','x')").run();
ok((await mod.drainShorts(g, { dry: true })).platforms.bluesky === "held:no-short", "social_video_since moves the quality floor");

g = base(mk());
await g.DB.prepare("INSERT INTO pipeline_flags (key, value, updated_at) VALUES ('social_channel_caps', '{\"mastodon\":0}', datetime('now'))").run();
const rc = await mod.drainShorts(g, { dry: true });
ok(rc.platforms.mastodon === "held:cap-0", "a Mastodon cap of 0 holds the video too", JSON.stringify(rc));

g = base(mk());
for (let i = 0; i < 40; i++) await g.DB.prepare("INSERT INTO social_media_posts (id, platform, post_id, published_at, status) VALUES (?1,'buffer-mastodon',?1,datetime('now'),'published')").bind("x" + i).run();
const rw = await mod.drainShorts(g, { dry: true });
ok(/^held:weekly-cap/.test(rw.platforms.mastodon), "a full Mastodon week holds the video", JSON.stringify(rw));

g = base(mk());
await g.LIVING_PAPER.prepare("UPDATE papers SET status = 'retracted' WHERE slug = 'new-short'").run();
calls = [];
const rr = await mod.drainShorts(g);
ok(rr.posted === 0 && !calls.some((c) => c.u.includes("uploadVideo")), "a paper that is no longer public is not promoted", JSON.stringify(rr));

g = base(mk());
await g.LIVING_PAPER.prepare("UPDATE papers SET title = 'An ultrametric view' WHERE slug = 'new-short'").run();
calls = [];
const rd = await mod.drainShorts(g);
ok(rd.posted === 0 && !calls.some((c) => c.u.includes("uploadVideo")), "a paper on the reach deny list is not promoted", JSON.stringify(rd));

g = Object.assign(base(mk()), { MEDIA: { async get() { return null; } } });
const rm = await mod.drainShorts(g);
ok(rm.posted === 0 && /short\.mp4 missing/.test(rm.platforms.bluesky), "a missing file is an error row, not a post", JSON.stringify(rm));
const le = await g.DB.prepare("SELECT attempts, state FROM social_video_posts WHERE platform='bluesky'").first();
ok(le && le.state === "error" && le.attempts === 1, "the failure is counted", JSON.stringify(le));
calls = [];
await mod.drainShorts(g);
ok(!calls.some((c) => c.u.includes("uploadVideo")), "a failed Short waits six hours before the next try");

console.log("shorts-posts: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
