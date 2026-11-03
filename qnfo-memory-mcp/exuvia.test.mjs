// EXUVIA-ENGAGE-1 offline suite: evidence-backed response drafts are logged without posting, and public publishing still
// requires confirm=true and a key. Run: node qnfo-memory-mcp/exuvia.test.mjs
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { versionAtLeast } from "../scripts/version-at-least.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const w = (await import(pathToFileURL(join(here, "worker.js")).href)).default;

const KEY = "ex_secretkey123";
const paper = { slug: "demo-paper", title: "Demo Paper", doi: "10.1234/demo", authors: "A", abstract: "An abstract.", body_md: "word ".repeat(5000), status: "published" };
const stmt = (rows, one) => ({ bind() { return this; }, async first() { return one; }, async all() { return { results: rows }; } });
const env = (key, engage = "off") => {
  const decisions = new Map();
  const audit = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() {
          if (sql.includes("ops_config")) return { value: engage };
          if (sql.includes("decision_log")) return decisions.get(args[0]) || null;
          return null;
        },
        async run() {
          if (sql.includes("INSERT INTO decision_log")) {
            decisions.set(args[2], { evidence: args[3], predicted_outcome: args[8], reach_gain: args[9], surfaces_tested: args[10] });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
      };
    },
    decisions
  };
  return {
  MCP_TOKEN: "t", ...(key ? { EXUVIA_API_KEY: KEY } : {}),
  AI: { run: async () => ({ data: [[0.1, 0.2]] }) },
  PAPER_VZ: { query: async () => ({ matches: [{ id: "vec:demo", score: 0.91, metadata: { slug: paper.slug, title: paper.title } }] }) },
  LIVING_PAPER: { prepare: () => stmt([], paper) },
  GRAPH_DB: { prepare: () => stmt([{ rel: "cites", id: "n1", label: "Concept", name: "Ultrametric" }], null) },
  AUDIT: audit
  };
};
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  const u = String(url);
  if (u.endsWith("/api/v1/capabilities")) return new Response(JSON.stringify({ data: { limits: { content_max_chars: 50000 } } }), { status: 200 });
  if (u.endsWith("/api/v1/posts")) return new Response(JSON.stringify({ success: true, data: { id: "p1" } }), { status: 201 });
  if (u.includes("/api/v1/feed?sort=needs_response")) return new Response(JSON.stringify({ success: true, data: { posts: [{ id: "p100", title: "Research question", abstract: "How do hierarchies embed?" }] } }), { status: 200 });
  if (u.includes("/api/v1/posts/")) return new Response(JSON.stringify({ data: { post: { id: "p9", title: "Ultrametric question", abstract: "How do hierarchies embed?" } } }), { status: 200 });
  return new Response(JSON.stringify({ data: { identity: "me" } }), { status: 200 });
};
const rpc = async (e, name, args) => {
  const r = await w.fetch(new Request("https://x/mcp", { method: "POST", headers: { Authorization: "Bearer t" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), e);
  const j = await r.json();
  return { isError: j.result.isError, out: JSON.parse(j.result.content[0].text) };
};

const h = await (await w.fetch(new Request("https://x/health"), env())).json();
assert.ok(versionAtLeast(h.version, "2.7.0"), "version " + h.version);
assert.equal(h.exuvia_key, false);
assert.equal((await (await w.fetch(new Request("https://x/health"), env(true))).json()).exuvia_key, true);
const list = await (await w.fetch(new Request("https://x/mcp", { method: "POST", headers: { Authorization: "Bearer t" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), env())).json();
const names = list.result.tools.map((t) => t.name);
for (const n of ["exuvia_status", "exuvia_feed", "exuvia_paper_post_draft", "exuvia_publish_paper", "exuvia_kg_context", "exuvia_engage"]) assert.ok(names.includes(n), n);

let r = await rpc(env(), "exuvia_status", {});
assert.equal(r.out.key_configured, false);
assert.equal(r.out.limits.content_max_chars, 50000);
assert.ok(!JSON.stringify(r.out).includes(KEY));

r = await rpc(env(), "exuvia_paper_post_draft", { slug: "demo-paper" });
assert.equal(r.isError, false);
assert.equal(r.out.truncated, true);
assert.ok(r.out.post.content_markdown.length <= 50000);
assert.match(r.out.post.content_markdown, /Ultrametric/);
assert.match(r.out.post.content_markdown, /doi\.org\/10\.1234\/demo/);
assert.ok(r.out.post.tags.length <= 10);

calls.length = 0;
r = await rpc(env(true), "exuvia_publish_paper", { slug: "demo-paper" });
assert.equal(r.out.dry_run, true);
assert.equal(calls.length, 0, "dry run sends nothing");
r = await rpc(env(), "exuvia_publish_paper", { slug: "demo-paper", confirm: true });
assert.equal(r.isError, true);
assert.equal(calls.length, 0, "no key sends nothing");
r = await rpc(env(true), "exuvia_publish_paper", { slug: "demo-paper", confirm: true });
assert.equal(r.isError, false);
assert.equal(calls.length, 1);
assert.equal(calls[0].init.method, "POST");
assert.equal(calls[0].init.headers["x-api-key"], KEY);
assert.ok(!JSON.stringify(r.out).includes(KEY));

calls.length = 0;
r = await rpc(env(true), "exuvia_kg_context", { post_id: "p9" });
assert.equal(r.out.post.id, "p9");
assert.match(r.out.query, /Ultrametric question/);
r = await rpc(env(), "exuvia_kg_context", {});
assert.equal(r.isError, true);
r = await rpc(env(), "exuvia_feed", {});
assert.equal(r.isError, true);

const disabled = env(true, "off");
r = await rpc(disabled, "exuvia_engage", {});
assert.equal(r.out.skipped, "exuvia engagement disabled");
assert.equal(calls.some((c) => c.url.includes("/api/v1/feed?sort=needs_response")), false, "disabled tick does not read Exuvia");
r = await rpc(env(), "exuvia_engage", {});
assert.equal(r.out.skipped, "no exuvia key");

const engaged = env(true, "on");
calls.length = 0;
r = await rpc(engaged, "exuvia_engage", {});
assert.equal(r.isError, false);
assert.equal(r.out.drafts.length, 1);
assert.equal(r.out.drafts[0].post_id, "p100");
assert.equal(r.out.drafts[0].paper.slug, "demo-paper");
assert.match(r.out.drafts[0].reply_draft, /Demo Paper/);
assert.match(r.out.drafts[0].reply_draft, /papers\.qnfo\.org\/papers\/demo-paper/);
assert.equal(engaged.AUDIT.decisions.size, 1, "draft decision logged once");
assert.match(Array.from(engaged.AUDIT.decisions.values())[0].predicted_outcome, /no public effect/);
assert.match(Array.from(engaged.AUDIT.decisions.values())[0].reach_gain, /unmeasured/);
assert.match(Array.from(engaged.AUDIT.decisions.values())[0].surfaces_tested, /decision_log/);
assert.equal(calls.some((c) => c.url.includes("/api/v1/feed?sort=needs_response&limit=10")), true);
assert.equal(calls.some((c) => c.init && c.init.method === "POST" && c.url.includes("/comments")), false, "reply is never posted");
r = await rpc(engaged, "exuvia_engage", {});
assert.equal(r.out.drafts.length, 1, "existing audited draft is returned");
assert.equal(engaged.AUDIT.decisions.size, 1, "repeat tick does not duplicate the decision");

const weakMatch = env(true, "on");
weakMatch.PAPER_VZ.query = async () => ({ matches: [{ id: "vec:weak", score: 0.81, metadata: { slug: paper.slug } }] });
r = await rpc(weakMatch, "exuvia_engage", {});
assert.equal(r.out.drafts.length, 0, "weakly related papers are not drafted as answers");

const unpublishedMatch = env(true, "on");
unpublishedMatch.LIVING_PAPER.prepare = () => stmt([], null);
r = await rpc(unpublishedMatch, "exuvia_engage", {});
assert.equal(r.out.drafts.length, 0, "unpublished papers are not cited");

r = await rpc(env(true, "on"), "exuvia_feed", { path: "feed/needs-response" });
assert.equal(r.isError, false);
assert.equal(calls.some((c) => c.url.includes("/api/v1/feed?sort=needs_response")), true, "needs-response path uses documented feed sort");

console.log("exuvia.test.mjs ok");
