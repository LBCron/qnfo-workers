import test from "node:test";
import assert from "node:assert/strict";
import { artPrompt, ART_STYLES, ART_MOTIFS, splitSentences, numTokens, validateBeats, capAllows, ttsEngine, directorPrompt, ctaBeat, rankByInterest, upgradesFirst, nextCandidate, parseSections, jsonFromText, buildMetadata, shapeOk, CRON_TABLE, VERSION } from "./worker.js";

const article = {
  title: "Why scientists stop testing ideas", short: "Safe stories pay better than risky guesses.",
  sections: [{ h: "The catch", paras: ["A guess must be right more than two times in three. At six in ten, the story pays better.", "Only one in ten testers is left."] }]
};

test("number words and digits normalise to the same tokens", () => {
  assert.deepEqual(numTokens("six in ten and 2,000 and 3.50"), ["6", "10", "2000", "3.5"]);
});
test("a beat whose numbers are in the article survives", () => {
  const b = { kind: "points", narr: "A guess must be right more than two times in three.", items: ["Right 2 in 3 times"] };
  assert.equal(validateBeats([b], article, []).kept.length, 1);
});
test("a beat with a number absent from the article is dropped", () => {
  const b = { kind: "stat", narr: "The model found 73 percent.", value: "73%", label: "share" };
  const v = validateBeats([b], article, []);
  assert.equal(v.kept.length, 0);
  assert.equal(v.dropped[0].why, "number-not-in-article");
  assert.deepEqual(v.dropped[0].numbers, ["73"]);
});
test("the checker model's unsupported indexes drop their beats", () => {
  const ok = { kind: "points", narr: "Safe stories pay better.", items: ["Safe stories win"] };
  const v = validateBeats([ok, Object.assign({}, ok)], article, [1]);
  assert.equal(v.kept.length, 1);
  assert.equal(v.dropped[0].why, "claim-not-in-article");
});
test("bad shapes and unknown kinds are dropped, not repaired", () => {
  assert.equal(shapeOk({ kind: "points", narr: "x", items: [] }), false);
  assert.equal(shapeOk({ kind: "bogus", narr: "x" }), false);
  assert.equal(shapeOk({ kind: "meter", narr: "x", need: 2, have: 0.5, need_label: "a", have_label: "b", axis_label: "c", verdict: "d" }), false);
  assert.equal(shapeOk({ kind: "hook", narr: "x", lines: ["a", "b"], hi: [5] }), false);
});
test("narration is capped so the Short stays under a minute", () => {
  const long = { kind: "points", narr: Array(200).fill("safe").join(" ") + ".", items: ["a"] };
  assert.equal(validateBeats([long], article, []).dropped[0].why, "too-long");
});
test("sentences split for TTS", () => {
  assert.deepEqual(splitSentences("One. Two? Three!  Four"), ["One.", "Two?", "Three!", "Four"]);
});
test("weekly cap is 28 (YT-CAP-1: 4 a day, inside the API quota)", () => { assert.equal(capAllows(27), true); assert.equal(capAllows(28), false); });
test("newest paper without a row is chosen", () => {
  const rows = [{ slug: "a" }, { slug: "b" }, { slug: "c" }];
  assert.equal(nextCandidate(rows, ["a"]).slug, "b");
  assert.equal(nextCandidate(rows, ["a", "b", "c"]), null);
});
test("article body JSON parses to sections", () => {
  assert.equal(parseSections(JSON.stringify([{ h: "x", paras: ["y"] }])).length, 1);
  assert.deepEqual(parseSections("not json"), []);
});
test("model JSON is extracted from fenced or thinking output", () => {
  assert.equal(jsonFromText("<think>hm</think>```json\n{\"a\":1}\n```").a, 1);
  assert.throws(() => jsonFromText("no braces"));
});
test("metadata is public by default, synthetic and links the article", () => {
  const m = buildMetadata({ title: "T", short: "S" }, "slug-1", "My title", 48);
  assert.equal(m.privacyStatus, "public");
  assert.equal(m.containsSyntheticMedia, true);
  assert.match(m.title, /#Shorts$/);
  assert.match(m.description, /Living papers and an open knowledge graph from the QNFO autonomous research fleet — https:\/\/qnfo\.org/);
  assert.match(m.description, /papers\.qnfo\.org\/papers\/slug-1\/quickread/);
  assert.match(m.description, /AI disclosure: the voice is synthetic/);
});
test("single hourly cron entry and a versioned worker", () => {
  assert.deepEqual(CRON_TABLE, ["0 * * * *"]);
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
});
import { spendUsd, spendAllows } from "./worker.js";
test("spend ledger arithmetic and the hard stop at 45 USD", () => {
  assert.ok(spendUsd("tts", 1000) > 0 && spendUsd("container", 600) > 0);
  assert.equal(spendAllows(44.99), true);
  assert.equal(spendAllows(45), false);
});
test("videos are public by default (owner directive 2026-10-27)", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  assert.match(src, /var PRIVACY = "public"/);
  assert.equal(buildMetadata({ title: "T", short: "S" }, "s", "t", 1).privacyStatus, "public");
});

import { spendUsd as _spend, shapeOk as _shape, validateBeats as _validate } from "./worker.js";
test("YT-QUALITY-1: new templates validate, bad ones are dropped", () => {
  assert.equal(_shape({ kind: "bignum", narr: "x", value: 350, frac: 1, label: "bits per second", sub: "normal" }), true);
  assert.equal(_shape({ kind: "bignum", narr: "x", value: "350", label: "bits" }), false);
  assert.equal(_shape({ kind: "flow", narr: "x", nodes: ["Source", "Filter", "Experience"] }), true);
  assert.equal(_shape({ kind: "flow", narr: "x", nodes: ["only one"] }), false);
  assert.equal(_shape({ kind: "compare", narr: "x", title: "t", items: [["Bandwidth", 0.68, "c1", "a third less"], ["Clarity", 0.5, "c2", "half"]] }), true);
  assert.equal(_shape({ kind: "compare", narr: "x", items: [["a", 2, "c1", "b"], ["c", 0.5, "c2", "d"]] }), false);
  assert.equal(_shape({ kind: "list", narr: "x", items: ["one point"] }), false);
  assert.equal(_shape({ kind: "list", narr: "x", items: ["one", "two"] }), true);
});
test("YT-QUALITY-1: a bignum value that is not in the article drops the beat", () => {
  const art = { title: "t", short: "Capacity is three hundred and fifty bits per second.", sections: [] };
  const good = { kind: "bignum", narr: "About three hundred and fifty bits per second.", value: 350, label: "bits per second" };
  const bad = { kind: "bignum", narr: "About five hundred bits per second.", value: 500, label: "bits per second" };
  const v = _validate([good, bad], art, []);
  assert.equal(v.kept.length, 1);
  assert.equal(v.dropped[0].why, "number-not-in-article");
});
test("YT-QUALITY-1: Aura spend is priced per character", () => {
  assert.ok(Math.abs(_spend("tts_aura", 1000) - 0.03) < 1e-9);
});

// ---------- YT-6 (agent_issues 1000597): retention read ----------
import { DatabaseSync } from "node:sqlite";
import * as W from "./worker.js";
test("YT-6: the Analytics report parses views and average view duration by video id", () => {
  const r = W.parseRetentionReport({ columnHeaders: [{ name: "video" }, { name: "views" }, { name: "averageViewDuration" }], rows: [["abc", 120, 31.5], ["def", 7, 4]] });
  assert.deepEqual(r, { abc: { views: 120, avg_view_duration_s: 31.5 }, def: { views: 7, avg_view_duration_s: 4 } });
  assert.deepEqual(W.parseRetentionReport({}), {});
  assert.deepEqual(W.parseRetentionReport({ columnHeaders: [{ name: "views" }], rows: [[1]] }), {});
});
test("YT-6: the Data API statistics parse to views per id and ignore a missing count", () => {
  assert.deepEqual(W.parseVideoStats({ items: [{ id: "a", statistics: { viewCount: "42" } }, { id: "b", statistics: {} }, { id: "c" }] }), { a: { views: 42 } });
});
test("YT-6: a read is due when never read or older than 55 minutes", () => {
  const now = Date.parse("2026-10-28T20:00:00Z");
  assert.equal(W.retentionDue(null, now), true);
  assert.equal(W.retentionDue("2026-10-28T19:30:00Z", now), false);
  assert.equal(W.retentionDue("2026-10-28T19:04:00Z", now), true);
  assert.equal(W.retentionDue("garbage", now), true);
});
test("YT-6: 401 and an insufficient-scope 403 are the missing consent; other failures are not called that", () => {
  assert.equal(W.retentionFailure(401, "{}"), "scope-missing");
  assert.equal(W.retentionFailure(403, '{"error":{"message":"Request had insufficient authentication scopes."}}'), "scope-missing");
  assert.equal(W.retentionFailure(403, '{"error":{"message":"quotaExceeded"}}'), "quota");
  assert.equal(W.retentionFailure(500, "boom"), "http-500");
});
function retentionEnv() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE youtube_videos (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, state TEXT, video_id TEXT, uploaded_at TEXT, updated_at TEXT, views INTEGER); CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);");
  db.prepare("INSERT INTO youtube_videos (slug, state, video_id, uploaded_at) VALUES ('s1', 'uploaded', 'v1', '2026-10-27T13:00:00Z'), ('s2', 'uploaded', 'v2', '2026-10-27T14:00:00Z'), ('s3', 'rendering', NULL, NULL)").run();
  const prep = (sql) => { let a = []; const s = { bind: (...x) => { a = x.map((v) => (v === undefined ? null : v)); return s; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }), run: async () => { const r = db.prepare(sql).run(...a); return { success: true, meta: { changes: Number(r.changes) } }; } }; return s; };
  return { db, env: { QNFO_AUDIT: { prepare: prep }, YT_CLIENT_ID: "i", YT_CLIENT_SECRET: "s", YT_REFRESH_TOKEN: "r" } };
}
test("YT-6: with the consent the read writes views and average view duration for the uploaded Shorts only", async () => {
  const { db, env } = retentionEnv();
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "tok" }));
    if (u.includes("/youtube/v3/videos")) return new Response(JSON.stringify({ items: [{ id: "v1", statistics: { viewCount: "50" } }, { id: "v2", statistics: { viewCount: "9" } }] }));
    if (u.includes("youtubeanalytics")) return new Response(JSON.stringify({ columnHeaders: [{ name: "video" }, { name: "views" }, { name: "averageViewDuration" }], rows: [["v1", 52, 21.25], ["v2", 9, 3]] }));
    return new Response("{}", { status: 404 });
  };
  try {
    const r = await W.readRetention(env, Date.parse("2026-10-28T20:00:00Z"));
    assert.equal(r.rows, 2); assert.equal(r.wrote, 2); assert.equal(r.failure, null);
    const rows = db.prepare("SELECT slug, views, avg_view_duration_s, retention_read_at FROM youtube_videos ORDER BY id").all();
    assert.deepEqual(rows.map((x) => [x.slug, x.views, x.avg_view_duration_s]), [["s1", 52, 21.25], ["s2", 9, 3], ["s3", null, null]]);
    assert.ok(rows[0].retention_read_at && rows[2].retention_read_at === null);
    const again = await W.readRetention(env, Date.parse("2026-10-28T20:10:00Z"));
    assert.equal(again.rows, 0);
  } finally { globalThis.fetch = real; }
});
test("YT-6: without the consent the read is refused, recorded once as a warning, and nothing is written (never a zero)", async () => {
  const { db, env } = retentionEnv();
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "tok" }));
    return new Response(JSON.stringify({ error: { message: "Request had insufficient authentication scopes." } }), { status: 403 });
  };
  try {
    const r = await W.readRetention(env, Date.parse("2026-10-28T20:00:00Z"));
    assert.equal(r.failure, "scope-missing"); assert.equal(r.wrote, 0);
    const rows = db.prepare("SELECT views, avg_view_duration_s, retention_read_at FROM youtube_videos").all();
    assert.ok(rows.every((x) => x.views === null && x.avg_view_duration_s === null && x.retention_read_at === null));
    const ev = db.prepare("SELECT kind, status, text FROM cloud_ops_events").all();
    assert.equal(ev.length, 1); assert.equal(ev[0].kind, "youtube.retention_scope"); assert.equal(ev[0].status, "warn"); assert.match(ev[0].text, /yt-analytics-consent/);
  } finally { globalThis.fetch = real; }
});
test("YT-6: no credentials means skipped, not an error", async () => {
  const { env } = retentionEnv();
  delete env.YT_REFRESH_TOKEN;
  assert.deepEqual(await W.readRetention(env), { skipped: "no-credentials" });
});

test("YT-3: the hourly worker wires eligible articles through server-side render, upload, and ledger", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const config = fs.readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");

  assert.deepEqual(CRON_TABLE, ["0 * * * *"]);
  assert.match(config, /crons = \["0 \* \* \* \*"\]/);
  assert.match(source, /SELECT slug, rev FROM plain_article WHERE status = 'ok' AND body IS NOT NULL AND words >= 200 ORDER BY generated_at DESC LIMIT 40/);
  assert.match(source, /nextCandidate\(cands, taken\)/);
  assert.match(source, /INSERT INTO youtube_videos \(slug, rev, state, privacy, synthetic, created_at, updated_at\) VALUES \(\?1, \?2, 'queued'/);
  assert.match(source, /stageDirect\(env, row\)/);
  assert.match(source, /ttsSentence\(env, sents\[j\]\)/);
  assert.match(source, /renderStub\(env\)\.fetch\("https:\/\/render\.internal\/submit"/);
  assert.match(source, /env\.MEDIA\.put\("youtube\/" \+ row\.id \+ "\/short\.mp4", bytes/);
  assert.match(source, /upload\/youtube\/v3\/videos\?uploadType=resumable/);
  assert.match(source, /setState\(env, row\.id, "uploaded", \{ video_id: uj\.id/);
});

test("YT-VOICE-1: the first attempt uses Kokoro, a retry re-voices with Aura", () => {
  assert.equal(ttsEngine(0), "kokoro");
  assert.equal(ttsEngine(undefined), "kokoro");
  assert.equal(ttsEngine(1), "aura");
  assert.equal(ttsEngine(3), "aura");
});

test("YT-SCRIPT-1: the director writes the whole script first, with an arc, and data kinds only for real figures", () => {
  const p = directorPrompt();
  for (const k of ["STEP 1, the script", "HOOK", "STAKES", "TURN", "PAYOFF", "never repeats it", "only when the article states those exact figures"]) assert.ok(p.includes(k), k);
  assert.ok(p.includes('"script"'));
});
test("YT-SCRIPT-1: the closing line varies by paper, is stable per paper and speaks no URL", () => {
  const a = ctaBeat("paper-a"), b = ctaBeat("paper-a");
  assert.equal(a.narr, b.narr);
  const seen = new Set(["a", "bb", "ccc", "dddd", "eeeee", "ffffff", "g7", "h88"].map((s) => ctaBeat(s).narr));
  assert.ok(seen.size >= 2);
  for (const n of seen) assert.ok(!/qnfo\.org|http|www/i.test(n));
});

test("YT-17: the paper outsiders read goes first; unread papers keep newest-first order; no data changes nothing", () => {
  const rows = [{ slug: "new" }, { slug: "mid" }, { slug: "old" }, { slug: "older" }];
  const out = rankByInterest(rows, [{ slug: "old", ext_30d: 4, pv_30d: 10 }, { slug: "mid", ext_30d: 0, pv_30d: 30 }, { slug: "older", ext_30d: 4, pv_30d: 2 }]);
  assert.deepEqual(out.map((r) => r.slug), ["old", "older", "mid", "new"]);
  assert.deepEqual(rankByInterest(rows, []).map((r) => r.slug), ["new", "mid", "old", "older"]);
  assert.deepEqual(rankByInterest(rows, null).map((r) => r.slug), ["new", "mid", "old", "older"]);
});

test("YT-UPGRADE-1: papers with an old-pipeline Short are re-made before new papers, order kept inside each group", () => {
  const rows = [{ slug: "n1" }, { slug: "o1" }, { slug: "n2" }, { slug: "o2" }];
  assert.deepEqual(upgradesFirst(rows, { o1: 1, o2: 1 }).map((r) => r.slug), ["o1", "o2", "n1", "n2"]);
  assert.deepEqual(upgradesFirst(rows, {}).map((r) => r.slug), ["n1", "o1", "n2", "o2"]);
});

test("YT-DIRECTOR-RETRY-1: a director with no valid beats asks the next source once; a rejected re-make is retried up to three times", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  assert.ok(src.includes("sources.slice(skip || 0)"));
  assert.ok(/aiJson\(env, directorPrompt\(\), text\.slice\(0, 9000\), 3500, 0\.7, 1\)/.test(src));
  assert.ok(src.includes("state = 'rejected' AND created_at >= ?1 AND attempts < 3"));
});

// YT-PACE-1 / YT-META-1 / YT-LINKEDIN-1 (0.8.0)
import { buildSocialCopy, dailyAllows, uploadCooldownUntil, buildMetadata as bm080 } from "./worker.js";
test("daily cap spaces uploads", () => { assert.equal(dailyAllows(3), true); assert.equal(dailyAllows(4), false); });
test("upload-limit cooldown note parses", () => {
  assert.equal(uploadCooldownUntil("yt-upload-limit-until:2026-11-07T00:00:00.000Z x"), "2026-11-07T00:00:00.000Z");
  assert.equal(uploadCooldownUntil("rendered: other"), null);
});
test("description leads with the article summary and tags links", () => {
  const m = bm080({ title: "T", short: "A first sentence. A second sentence." }, "slug-1", "Hook", 40);
  assert.ok(m.description.startsWith("A first sentence."));
  assert.match(m.description, /utm_source=youtube/);
});
test("social copy is built from the article only and fits the limits", () => {
  const c = buildSocialCopy({ title: "T", short: "x".repeat(900) }, "slug-1", "Hook", "abc123");
  assert.ok(c.linkedin.length <= 1200 && c.x.length <= 280);
  assert.match(c.linkedin, /https:\/\/youtu\.be\/abc123/);
});

// YT-QUALITY-2 / YT-AUDIT-1 (0.8.1)
import { scriptIssues, spokenTitle, ctaBeat as cta081 } from "./worker.js";
test("the closing line names the paper and speaks no URL", () => {
  const c = cta081("p1", "**Entropic Operational Paradigm:** A Study.");
  assert.match(c.narr, /Entropic Operational Paradigm: A Study|Entropic Operational Paradigm/);
  assert.ok(!/\*|http|qnfo\.org/i.test(c.narr));
  assert.ok(!/called \{t\}|\{t\}/.test(cta081("p1").narr));
});
test("spokenTitle trims long titles at a word", () => {
  assert.ok(spokenTitle("word ".repeat(40)).length <= 90);
});
test("script audit flags stock openers, hype, double 'this paper' and a self-written sign-off", () => {
  assert.deepEqual(scriptIssues("A tree grows slowly. It needs light. The result is plain."), []);
  assert.ok(scriptIssues("Imagine a world. Then it ends.").includes("stock opener"));
  assert.ok(scriptIssues("A fact. This groundbreaking idea matters.").some((x) => /hype/.test(x)));
  assert.ok(scriptIssues("This paper asks. This paper says so.").some((x) => /this paper/.test(x)));
  assert.ok(scriptIssues("A fact is here. Read the full article in the description.").some((x) => /sign-off/.test(x)));
});

// YT-AUDIT-1b (0.8.2): found by reading the real scripts of Shorts 23 to 25
import { beatIssues as bi082, scriptIssues as si082 } from "./worker.js";
test("storyboard audit flags repeated kinds and low variety", () => {
  assert.ok(bi082([{ kind: "hook" }, { kind: "flow" }, { kind: "flow" }]).length === 1);
  assert.ok(bi082([{ kind: "hook" }, { kind: "flow" }, { kind: "list" }, { kind: "flow" }, { kind: "hook" }]).some((x) => /fewer than four/.test(x)));
  assert.deepEqual(bi082([{ kind: "hook" }, { kind: "flow" }, { kind: "versus" }, { kind: "list" }, { kind: "bignum" }]), []);
});
test("script audit flags the stock pivot and a generic closing question", () => {
  assert.ok(si082("A fact. But here is the catch: it is assumed.").some((x) => /stock pivot/.test(x)));
  assert.ok(si082("A fact is given. What will you write first?").some((x) => /generic question/.test(x)));
});

test("YT-ART-1: art prompts are abstract, deterministic and vary across Shorts", () => {
  assert.equal(artPrompt("a", 0), artPrompt("a", 0));
  const set = new Set(); for (let i = 0; i < 30; i++) set.add(artPrompt("paper-" + i, 0));
  assert.ok(set.size >= 15, "prompts vary: " + set.size);
  const p = artPrompt("x", 3);
  assert.match(p, /no text/); assert.match(p, /no people/);
  for (const w of [...ART_STYLES, ...ART_MOTIFS]) assert.doesNotMatch(w, /\b(person|face|logo|text|number)\b/i);
});
