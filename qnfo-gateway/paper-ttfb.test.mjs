// PAPER-TTFB-1: a paper page never waits for the plain-summary fill; the fill starts after the response through waitUntil.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const row = { slug: "slow-paper", title: "Slow paper", body_md: "# Slow paper\n\n## Abstract\n\nText about coordination.", abstract: "Text about coordination.", authors: '["R"]', keywords: "[]", doi: null, status: "published", version: "1.0.0", created_at: "2026-01-01", updated_at: "2026-01-01" };
const st = (all) => ({ bind() { return st(all); }, async all() { return { results: all }; }, async first() { return all[0] || null; }, async run() { return {}; } });
let aiCalls = 0;
const env = {
  LIVING_PAPER: { prepare(sql) { return st(/FROM papers/i.test(sql) ? [row] : []); } },
  QNFO_BUCKET: { async get() { return null; } }, RELEASES: { async head() { return null; } },
  AI: { async run() { aiCalls++; await new Promise((r) => setTimeout(r, 1500)); return { response: "" }; } }
};
const pending = [];
const ctx = { waitUntil(p) { pending.push(p); } };
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + String(d).slice(0, 200))); } };
const t0 = Date.now();
const r = await worker.fetch(new Request("https://papers.qnfo.org/papers/slow-paper", { headers: { Accept: "text/html" } }), env, ctx);
const ms = Date.now() - t0;
ok(r.status === 200, "the paper page renders", r.status);
ok(ms < 1200, "the page does not wait for the plain fill", ms + " ms");
ok(pending.length >= 1, "the fill is handed to waitUntil");
await Promise.allSettled(pending);
console.log("paper-ttfb: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
