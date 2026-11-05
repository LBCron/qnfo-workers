// YT-13 (AI label and provenance) and YT-10 (centring) offline suite. Run: node --test qnfo-youtube-shorts/provenance-layout.test.mjs
// Proves: the render container's /provenance sidecar is fetched through the Durable Object (the route was missing), checked against the bytes that were downloaded and kept in R2 beside
// short.mp4; a missing, wrong or mismatching sidecar is a warn event and never fails a render; the mp4 carries standard description and copyright tags next to the comment; the
// centring helper puts a beat in the middle of the content band (container/test_layout.py, run here when python is available).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RenderContainer, storeProvenance, stagePoll, sha256Hex } from "./worker.js";

const here = dirname(fileURLToPath(import.meta.url));
const bytes = new TextEncoder().encode("not really an mp4, but the same bytes both sides");
const hex = createHash("sha256").update(bytes).digest("hex");
const prov = (over = {}) => JSON.stringify({ ai_generated: true, disclosure: "synthetic narration and generated animation", video_sha256: hex, slug: "demo", ...over });

function makeEnv({ provenance, provStatus = 200, state = "done" }) {
  const media = new Map(), events = [], sql = [];
  const container = {
    fetch: async (url) => {
      const u = new URL(url);
      if (u.pathname === "/poll") return new Response(JSON.stringify({ state, duration_s: 25.8 }), { status: 200 });
      if (u.pathname === "/download") return new Response(bytes, { status: 200 });
      if (u.pathname === "/provenance") return new Response(provenance === undefined ? "{}" : provenance, { status: provStatus });
      return new Response("nope", { status: 404 });
    },
  };
  return {
    media, events, sql,
    env: {
      RENDER: { idFromName: () => "id", get: () => container },
      MEDIA: { put: async (k, v) => { media.set(k, typeof v === "string" ? v : new Uint8Array(v)); } },
      QNFO_AUDIT: { prepare(q) { let args = []; return { bind(...a) { args = a; return this; }, async run() { sql.push({ q, args }); if (/INSERT INTO cloud_ops_events/.test(q)) events.push({ kind: args[2], text: args[3], status: args[6] }); return { meta: { changes: 1 } }; } }; } },
    },
  };
}
const row = { id: 5, slug: "demo", note: "submitted 2026-11-04T10:00:00Z" };

test("sha256Hex matches node's digest", async () => {
  assert.equal(await sha256Hex(bytes), hex);
});

test("a matching sidecar is kept in R2 next to the video", async () => {
  const t = makeEnv({ provenance: prov() });
  assert.equal(await storeProvenance(t.env, row, bytes), true);
  assert.equal(t.media.get("youtube/5/provenance.json"), prov());
  assert.equal(t.events.length, 0);
});

test("a sidecar for another file, a non-AI sidecar, a missing sidecar and junk are warned about and never stored", async () => {
  for (const [name, o] of [["another file", { provenance: prov({ video_sha256: "0".repeat(64) }) }], ["not ai_generated", { provenance: prov({ ai_generated: false }) }], ["404", { provenance: "{}", provStatus: 404 }], ["junk", { provenance: "<html>" }]]) {
    const t = makeEnv(o);
    assert.equal(await storeProvenance(t.env, row, bytes), false, name);
    assert.equal(t.media.has("youtube/5/provenance.json"), false, name);
    assert.equal(t.events.length, 1, name);
    assert.equal(t.events[0].kind, "youtube.provenance", name);
    assert.equal(t.events[0].status, "warn", name);
  }
});

test("stagePoll stores the video and the sidecar, marks the row rendered, and survives a bad sidecar", async () => {
  const good = makeEnv({ provenance: prov() });
  assert.equal(await stagePoll(good.env, row, 0), true);
  assert.deepEqual([...good.media.keys()].sort(), ["youtube/5/provenance.json", "youtube/5/short.mp4"]);
  assert.ok(good.sql.some((s) => /UPDATE youtube_videos SET state/.test(s.q) && s.args[0] === "rendered"), "the row is marked rendered");
  const bad = makeEnv({ provenance: prov({ video_sha256: "f".repeat(64) }) });
  assert.equal(await stagePoll(bad.env, row, 0), true, "a mismatching sidecar never fails the render");
  assert.deepEqual([...bad.media.keys()], ["youtube/5/short.mp4"]);
  assert.ok(bad.events.some((e) => e.kind === "youtube.provenance"));
});

test("the Durable Object proxies /provenance to the container", async () => {
  const seen = [];
  const port = { fetch: async (url) => { seen.push(String(url)); return new Response(url.includes("/health") ? "ok" : prov(), { status: 200 }); } };
  const stub = new RenderContainer({ container: { running: true, getTcpPort: () => port } }, {});
  const r = await stub.fetch(new Request("https://render.internal/provenance?id=5"));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ai_generated, true);
  assert.ok(seen.includes("http://container/provenance?id=5"), seen.join(" "));
});

test("the mp4 carries description and copyright tags next to the AI comment, and the sidecar stays", () => {
  const render = readFileSync(join(here, "container", "render.py"), "utf8");
  assert.match(render, /"-metadata", "comment=AI-generated/);
  assert.match(render, /"-metadata", "description=AI-generated content/);
  assert.match(render, /"-metadata", "copyright=QNFO\. AI-generated content\./);
  assert.match(render, /provenance\.json/);
});

test("YT-11: the manim render skips its scene hash and the result carries the stage timings (YT-RENDER-SPEED-1)", () => {
  const render = readFileSync(join(here, "container", "render.py"), "utf8");
  const cmd = render.slice(render.indexOf('[sys.executable, "-m", "manim", "render"'), render.indexOf('"ShortScene"]'));
  assert.ok(cmd.includes('"--disable_caching"'), "the manim command line disables the animation cache");
  assert.ok(cmd.includes('"-r", "1080,1920"') && cmd.includes('"--fps", "30"'), "the output size and frame rate are unchanged");
  assert.match(render, /"timings": timings/, "the result returns the per-stage seconds");
  for (const k of ["voice_s", "manim_s", "mux_s"]) assert.ok(render.includes('"' + k + '"'), k);
});

test("centre_dy keeps a beat in the middle of the content band (python container/test_layout.py)", (t) => {
  for (const py of ["python3", "python"]) {
    const r = spawnSync(py, ["-I", join(here, "container", "test_layout.py")], { encoding: "utf8" });
    if (r.error) continue;
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /ok/);
    return;
  }
  t.skip("no python on this runner");
});

test("the scene calls the helper inside a guard and imports sys for its message", () => {
  const scene = readFileSync(join(here, "container", "short_scene.py"), "utf8");
  assert.match(scene, /import json, math, os, re, sys/);
  assert.match(scene, /dy = centre_dy\(grp\.get_top\(\)\[1\], grp\.get_bottom\(\)\[1\]\)/);
  assert.match(scene, /except Exception as e:\s+print\("centre_dy skipped/);
});
