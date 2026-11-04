// YT-VIDEO-EMBED-1 (roadmap YT-15): the Short made from a paper is embedded on its paper page and quick read, with a VideoObject in the JSON-LD;
// a paper with no uploaded row, a private row or an unreadable table shows nothing and still renders.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const body = "# Embedded paper\n\n## Abstract\n\nText about coordination in ultrametric spaces and why it matters.\n\n## Method\n\nWe measure things carefully and report 12 results.\n";
const mkRow = (slug) => ({ slug, title: "Embedded paper", body_md: body, abstract: "Text about coordination.", authors: '["R"]', keywords: "[]", doi: null, status: "published", version: "1.0.0", created_at: "2026-10-01", updated_at: "2026-10-02" });
const st = (all) => ({ bind() { return st(all); }, async all() { return { results: all }; }, async first() { return all[0] || null; }, async run() { return {}; } });
const VID = [{ slug: "with-video", video_id: "abcDEF12345", title: "Embedded paper in plain language", duration_s: 41.6, uploaded_at: "2026-11-02T10:00:00.000Z" },
  { slug: "bad-id", video_id: "x<script>", title: "", duration_s: 0, uploaded_at: "" }];
let auditMode = "rows", auditCalls = 0;
const mkEnv = () => ({
  LIVING_PAPER: { prepare(sql) { const m = /slug = \?/i.test(sql) ? null : null; return { bind(...a) { const slug = a[0]; return st(/FROM papers/i.test(sql) ? [mkRow(slug)] : []); }, async all() { return { results: [] }; }, async first() { return null; }, async run() { return {}; } }; } },
  AUDIT: { prepare(sql) { if (/youtube_videos/i.test(sql)) auditCalls++; if (auditMode === "throw") throw new Error("no such table: youtube_videos"); return st(/youtube_videos/i.test(sql) ? VID : []); } },
  QNFO_BUCKET: { async get() { return null; } }, RELEASES: { async head() { return null; } }, AI: { async run() { return { response: "" }; } }
});
const ctx = { waitUntil() {} };
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + String(d).slice(0, 300))); } };
const get = (env, path) => worker.fetch(new Request("https://papers.qnfo.org" + path, { headers: { Accept: "text/html" } }), env, ctx);

let env = mkEnv();
let r = await get(env, "/papers/with-video"); let h = await r.text();
ok(r.status === 200, "paper page renders", r.status);
ok(h.includes('src="https://www.youtube-nocookie.com/embed/abcDEF12345'), "nocookie embed present");
ok(/<iframe[^>]*loading="lazy"/.test(h), "embed is lazy-loaded");
ok(h.includes("AI-generated voice"), "AI disclosure is shown next to the embed");
ok(h.includes('"@type":"VideoObject"') && h.includes("https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg") && h.includes('"duration":"PT42S"') && h.includes('"uploadDate":"2026-11-02"'), "VideoObject JSON-LD with thumbnail, duration and upload date");
ok(h.indexOf("yt-short") > h.indexOf('id="doc"') && h.indexOf("yt-short") < h.indexOf("We measure things"), "the video sits before the paper body");

r = await get(env, "/papers/no-video"); h = await r.text();
ok(r.status === 200 && !h.includes("youtube-nocookie") && !h.includes("VideoObject"), "no row, no embed and no JSON-LD");
r = await get(env, "/papers/bad-id"); h = await r.text();
ok(r.status === 200 && !h.includes("youtube-nocookie"), "an invalid video id is never embedded");

r = await get(env, "/papers/with-video/quickread"); h = await r.text();
ok(r.status === 200 && h.includes("youtube-nocookie.com/embed/abcDEF12345") && h.includes("noindex"), "the quick read carries the embed and stays noindex");

r = await get(env, "/api/paper-videos"); const j = await r.json();
ok(r.status === 200 && j.count === 1 && j.items[0].slug === "with-video" && j.items[0].embed.endsWith("abcDEF12345"), "list route returns only valid rows", JSON.stringify(j));

const before = auditCalls; await get(env, "/papers/with-video"); await get(env, "/papers/with-video");
ok(auditCalls === before, "the map is cached: no extra audit read per request", auditCalls - before);

auditMode = "throw"; env = mkEnv();
r = await get(env, "/papers/with-video"); h = await r.text();
ok(r.status === 200 && !h.includes("youtube-nocookie"), "an unreadable table shows nothing and the page still renders", r.status);

console.log("video-embed: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
