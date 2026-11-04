// personal-watch offline suite. Run: node personal-watch/worker.test.mjs
// Proves: health names the worker, the page client script parses, the queue interleaves sources from stubbed feeds, a mood filters.
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
const here = dirname(fileURLToPath(import.meta.url));
const w = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };

const config = readFileSync(join(here, "wrangler.toml"), "utf8");
// A minimum, not an exact date: the date advances with each COMPAT-ADVANCE wave (a pinned literal broke on every advance).
const compatDate = (/^compatibility_date\s*=\s*"(\d{4}-\d{2}-\d{2})"\s*$/m.exec(config) || [])[1] || "";
const compatReviewed = (/^#\s*compat-advance:\s*reviewed\s+(\d{4}-\d{2}-\d{2})/m.exec(config) || [])[1] || "";
ok(compatDate >= "2026-10-25", "compatibility date is at or after the 2026-10-25 fleet baseline: " + compatDate);
ok(compatReviewed >= compatDate, "a compat-advance review line is dated on or after the declared date: " + compatReviewed);
const traces = config.split(/^\s*\[/m).find((section) => section.startsWith("observability.traces]")) || "";
ok(/^enabled\s*=\s*true\s*$/m.test(traces), "Workers traces are explicitly enabled, not just logs");

const yt = (n) => "<feed>" + [1, 2, 3, 4].map((i) => `<entry><yt:videoId>${n}${i}</yt:videoId><title>${n} t${i}</title></entry>`).join("") + "</feed>";
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.includes("youtube.com/feeds")) return new Response(yt(url.slice(-6)));
  if (url.includes("vimeo.com")) return new Response("<rss><item><title>V</title><link>https://vimeo.com/channels/staffpicks/123</link></item></rss>");
  if (url.includes("archive.org")) return new Response(JSON.stringify({ response: { docs: [{ identifier: "a1", title: "A" }] } }));
  return new Response("", { status: 404 });
};

const h = await (await w.fetch(new Request("https://x/health"))).json();
ok(h.worker === "personal-watch" && /^\d+\.\d+\.\d+/.test(h.version), "health names worker and version");
const page = await (await w.fetch(new Request("https://x/"))).text();
const clientScript = page.match(/<script>([\s\S]*)<\/script>/)[1];
let parses = true; try { new Function(clientScript); } catch (e) { parses = false; }
ok(parses, "page client script parses");
ok(!/onclick\s*=/.test(clientScript) && clientScript.includes("data-mood") && clientScript.includes("data-action"), "page uses delegated mood and feedback controls");
ok(readFileSync(join(here, "worker.js"), "utf8") === readFileSync(join(here, "deployed-current.worker.js"), "utf8"), "deployed worker mirror matches source");
const q = (await (await w.fetch(new Request("https://x/api/queue"))).json()).queue;
ok(q.some((v) => v.src === "youtube") && q.some((v) => v.src === "vimeo" && v.id === "123") && q.some((v) => v.src === "archive"), "queue mixes youtube, vimeo, archive");
ok(q.slice(1).every((v, i) => v.by !== q[i].by) || q.length < 3, "no source twice in a row");
const calm = (await (await w.fetch(new Request("https://x/api/queue?mood=calm"))).json()).queue;
ok(calm.length > 0 && calm.every((v) => v.mood === "calm"), "mood filter holds");
ok((await w.fetch(new Request("https://x/nope"))).status === 404, "unknown path 404");

const videos = [
  { src: "archive", id: "a1", title: "A", by: "Channel A", mood: "wonder" },
  { src: "archive", id: "b1", title: "B", by: "Channel B", mood: "craft" },
  { src: "archive", id: "b2", title: "B again", by: "Channel B", mood: "craft" },
  { src: "archive", id: "c1", title: "C", by: "Channel C", mood: "weird" }
];
const tick = () => new Promise((resolve) => setImmediate(resolve));
function clientHarness(failFetch = false) {
  const nodes = new Map(), requests = [], store = {};
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: "", textContent: "", listeners: {}, addEventListener(type, cb) { this.listeners[type] = cb; } });
    return nodes.get(id);
  };
  const document = { getElementById: node, addEventListener() {} };
  const context = {
    document,
    window: {},
    localStorage: store,
    fetch: async (url) => {
      requests.push(String(url));
      if (failFetch) return { ok: false };
      const requestedMood = new URL(String(url), "https://watch.test").searchParams.get("mood");
      return { ok: true, json: async () => ({ queue: videos.filter((v) => !requestedMood || v.mood === requestedMood) }) };
    },
    encodeURIComponent,
    YT: { Player() {} }
  };
  runInNewContext(clientScript, context);
  return {
    context,
    nodes,
    requests,
    async click(dataset) {
      node("bar").listeners.click({ target: { closest: () => ({ dataset }) } });
      await tick();
    }
  };
}
const client = clientHarness();
await tick();
ok(client.nodes.get("bar").innerHTML.includes('data-mood="wonder"') && client.nodes.get("bar").innerHTML.includes('data-action="like"'), "rendered category and feedback buttons expose working action data");
await client.click({ action: "next" });
await client.click({ action: "like" });
ok(JSON.parse(client.context.localStorage.watchState).likes.some((x) => x.by === "Channel B"), "like feedback is saved locally");
await client.click({ mood: "for-you" });
ok(client.context.Q[0]?.by === "Channel B", "For You ranks explicitly liked channels first");
ok(client.requests.every((url) => !url.includes("Channel B") && !url.includes("watchState")), "personal preferences are never sent to the worker");
await client.click({ mood: "weird" });
ok(client.requests.at(-1).includes("?mood=weird") && client.context.Q.length === 1 && client.context.Q[0].mood === "weird", "mood controls request and show the selected category");
await client.click({ action: "next" });
ok(client.nodes.get("info").textContent.includes("No unseen picks") && client.requests.length < 8, "recent videos are not repeated or endlessly reloaded");
const skip = clientHarness();
await tick();
await skip.click({ action: "skip-channel" });
ok(JSON.parse(skip.context.localStorage.watchState).banned.includes("Channel A"), "not this channel persists a local channel preference");
const offline = clientHarness(true);
await tick();
ok(offline.nodes.get("info").textContent.includes("could not load"), "feed failures show a recoverable message");
console.log(`personal-watch: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
