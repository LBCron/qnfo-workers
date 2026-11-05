// COMPANION-NO-TYPING-1:videos (agent_issues 1001637; q08-mind 2.3.0). The owner asked on 2026-10-29 for "something to do right now, videos
// are fine, no typing": a curated list of talks on how minds work, autism and ADHD, and a one-tap pick for Today.
// This suite holds the shape of data/videos.json (every link is a ted.com talk page, read live with HTTP 200 on 2026-11-05 when the entry was
// written; the date is in "checked"), the pick (a pure function of the day and the lane, so it needs no binding and stores nothing), the page
// that shows it, and that /now without kind=video is still the book pick. No network: the live reads are the dates in the data.
// Run: node q08-mind/videos.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");
const VIDEOS = JSON.parse(read("data/videos.json"));
const LANES = ["gentle", "steady", "deep"];
const QUESTIONS = ["mind", "condition", "place"];

// ---- the data ---------------------------------------------------------------------------------------------------------
assert.ok(VIDEOS.length >= 6, "at least six videos");
assert.equal(new Set(VIDEOS.map((v) => v.s)).size, VIDEOS.length, "slugs are unique");
assert.equal(new Set(VIDEOS.map((v) => v.l)).size, VIDEOS.length, "links are unique");
for (const v of VIDEOS) {
  assert.match(v.l, /^https:\/\/www\.ted\.com\/talks\/[a-z0-9_]+$/, `${v.s}: a ted.com talk page`);
  assert.ok(LANES.includes(v.lane), `${v.s}: lane ${v.lane}`);
  assert.ok(QUESTIONS.includes(v.q), `${v.s}: question ${v.q}`);
  assert.ok(Number.isInteger(v.min) && v.min > 0 && v.min <= 25, `${v.s}: minutes ${v.min}`);
  assert.ok(Number.isInteger(v.y) && v.y >= 2005 && v.y <= 2026, `${v.s}: year ${v.y}`);
  assert.match(v.checked, /^2026-\d\d-\d\d$/, `${v.s}: carries the date its link was read live`);
  for (const f of ["t", "w", "h"]) assert.ok(typeof v[f] === "string" && v[f].length >= 20, `${v.s}: ${f} is written out`);
  assert.ok(typeof v.a === "string" && v.a.length >= 5, `${v.s}: the speaker is named`);
  assert.ok(!/—/.test(JSON.stringify(v)), `${v.s}: no em dash in the text`);
}
for (const lane of LANES) assert.ok(VIDEOS.some((v) => v.lane === lane), `lane ${lane} has a video`);
assert.ok(VIDEOS.some((v) => v.lane === "gentle" && v.min <= 10), "the gentle lane has one short enough for a heavy day");

// ---- the worker -------------------------------------------------------------------------------------------------------
const src = read("worker.js");
const inlined = src.replace(/^import (\w+) from "\.\/data\/([\w-]+\.json)";$/gm, (_m, name, file) => `const ${name} = ${read("data/" + file).trim()};`);
assert.ok(!/^import /m.test(inlined), "no import is left in the inlined worker");
assert.ok(/import VIDEOS from "\.\/data\/videos\.json";/.test(src), "worker.js imports the video data");
const dir = mkdtempSync(join(tmpdir(), "mind-videos-"));
const realNow = Date.now;
try {
  const file = join(dir, "worker.mjs");
  writeFileSync(file, inlined);
  const worker = (await import(pathToFileURL(file).href)).default;
  const get = async (path, at) => {
    if (at !== undefined) Date.now = () => at;
    try {
      const r = await worker.fetch(new Request("https://mind.q08.org" + path), {}, { waitUntil() {} });
      return { status: r.status, body: await r.text(), cache: r.headers.get("cache-control") };
    } finally { Date.now = realNow; }
  };
  const DAY = 864e5;
  const t0 = Date.parse("2026-11-05T12:00:00Z");

  for (const lane of LANES) {
    const pool = VIDEOS.filter((v) => v.lane === lane);
    const seen = new Set();
    for (let d = 0; d < pool.length * 2; d++) {
      const r = await get("/now?kind=video&lane=" + lane, t0 + d * DAY);
      assert.equal(r.status, 200, `${lane}: /now?kind=video answers 200`);
      assert.equal(r.cache, "private, no-store", "the pick is never cached across days");
      const hit = pool.filter((v) => r.body.includes(`href="${v.l}"`));
      assert.equal(hit.length, 1, `${lane} day ${d}: exactly one video of the lane is shown`);
      assert.ok(!VIDEOS.some((v) => v.lane !== lane && r.body.includes(`href="${v.l}"`)), `${lane}: no video of another lane`);
      assert.ok(r.body.includes("Watch it on ted.com") && r.body.includes("Something to watch today"), "the page says what it is and where it goes");
      seen.add(hit[0].s);
    }
    assert.equal(seen.size, pool.length, `${lane}: the days rotate through every video of the lane`);
  }
  // same day, same pick; an unknown lane falls back to steady
  const a = await get("/now?kind=video&lane=gentle", t0), b = await get("/now?kind=video&lane=gentle", t0 + 3600e3);
  assert.equal(a.body, b.body, "two reads on one day show the same video");
  const odd = await get("/now?kind=video&lane=nonsense", t0), steady = await get("/now?kind=video&lane=steady", t0);
  assert.equal(odd.body.replace(/Lane: \w+\./, ""), steady.body.replace(/Lane: \w+\./, ""), "an unknown lane reads as steady");
  // /now without kind is still the book pick
  const book = await get("/now?lane=gentle", t0);
  assert.equal(book.status, 200);
  assert.ok(book.body.includes("Something to read today") && !book.body.includes("ted.com/talks"), "the book pick is unchanged");
  // JSON API and health
  const api = JSON.parse((await get("/api/entries.json")).body);
  assert.equal(api.videos.length, VIDEOS.length, "/api/entries.json lists the videos");
  const health = JSON.parse((await get("/health")).body);
  assert.equal(health.videos, VIDEOS.length, "/health counts the videos");
  assert.ok(health.capabilities.includes("video-pick"), "/health advertises video-pick");
  assert.ok(Array.isArray(api.books) && api.books.length === health.books, "books are untouched");
} finally {
  Date.now = realNow;
  rmSync(dir, { recursive: true, force: true });
}

// ---- the mirror -------------------------------------------------------------------------------------------------------
assert.equal(read("deployed-current.worker.js"), src, "deployed-current.worker.js is byte-identical to worker.js (mirror-guard)");
console.log("ok   q08-mind videos: data shape, rotation per lane, page, API, health, mirror");
