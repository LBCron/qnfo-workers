// EXUVIA-ENGAGE-1 (2.8.0) offline suite for the hourly cron and the gated reply step.
// Proves: a cron is declared and `scheduled` runs both ticks; the draft tick writes decision_log drafts and posts nothing; the reply
// step is a no-op until ops_config exuvia_engage_post is 'on'; when on it posts at most 2 per run through POST /api/v1/posts/{id}/comments
// with field "body", spaces posts by the burst rule, stops the run on a 429 (and records nothing as final), records any other 4xx once and
// never retries it, never posts the same Exuvia post twice, and one failing tick never stops the other.
// Run: node qnfo-memory-mcp/exuvia-reply.test.mjs
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url));
const w = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const toml = readFileSync(join(here, "wrangler.toml"), "utf8");

// the cron is declared, hourly, and in the [triggers] table
const crons = /\[triggers\][\s\S]*?crons\s*=\s*\[([^\]]*)\]/.exec(toml);
assert.ok(crons, "a [triggers] crons line exists");
const exprs = crons[1].split(",").map((x) => x.trim().replace(/^"|"$/g, "")).filter(Boolean);
assert.equal(exprs.length, 1, "one cron expression");
assert.match(exprs[0], /^\d{1,2} \* \* \* \*$/, "hourly (CRON-HOURLY-FLOOR-1)");
assert.equal(typeof w.scheduled, "function", "the worker exports a scheduled handler");

const KEY = "ex_secretkey123";
let clock = Date.parse("2026-11-05T10:00:00Z");
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const paper = { slug: "demo-paper", title: "Demo Paper", abstract: "An abstract that answers the question.", status: "published" };

function makeEnv(opts = {}) {
  const ops = new Map(Object.entries(opts.ops || {}));
  const log = [];
  let id = 0;
  (opts.drafts || []).forEach((d) => log.push({ id: ++id, ts: iso(clock - 3600e3), actor: "qnfo-memory-mcp:exuvia-engage", action: "EXUVIA-ENGAGE-1: reply draft for post " + d.post_id, evidence: JSON.stringify(d), outcome: "Evidence-backed reply draft prepared; not posted" }));
  (opts.prior || []).forEach((p) => log.push({ id: ++id, ts: iso(p.ts), actor: "qnfo-memory-mcp:exuvia-engage", action: p.action, evidence: "{}", outcome: p.outcome }));
  const audit = {
    prepare(sql) {
      let a = [];
      const q = {
        bind(...v) { a = v; return q; },
        async first() {
          if (opts.auditDown) throw new Error("d1 down");
          if (sql.includes("FROM ops_config")) { const k = /key = '([a-z_]+)'/.exec(sql)[1]; return ops.has(k) ? { value: ops.get(k) } : null; }
          if (sql.includes("action IN (?1, ?2)")) return log.find((r) => r.action === a[0] || r.action === a[1]) ? { n: 1 } : null;
          if (sql.includes("WHERE action = ?1")) return log.find((r) => r.action === a[0]) || null;
          return null;
        },
        async all() {
          if (opts.auditDown) throw new Error("d1 down");
          if (sql.includes("ORDER BY id DESC LIMIT 2")) return { results: log.filter((r) => r.actor === a[0] && r.outcome === a[1]).slice(-2).reverse().map((r) => ({ ts: r.ts })) };
          if (sql.includes("ORDER BY id LIMIT 20")) return { results: log.filter((r) => r.actor === a[0] && r.outcome === a[1]).slice(0, 20).map((r) => ({ evidence: r.evidence })) };
          return { results: [] };
        },
        async run() {
          if (sql.includes("INSERT INTO decision_log")) {
            if (log.some((r) => r.action === a[2])) return { meta: { changes: 0 } };
            log.push({ id: ++id, ts: iso(clock), actor: a[0], action: a[2], evidence: a[3], outcome: a[4], predicted: a[8] });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
      };
      return q;
    },
    log
  };
  const stmt = (row) => ({ bind() { return this; }, async first() { return row; }, async all() { return { results: [] }; } });
  return {
    EXUVIA_API_KEY: opts.noKey ? undefined : KEY,
    EXUVIA_WRITE_GAP_MS: "0",
    AI: { run: async () => ({ data: [[0.1, 0.2]] }) },
    PAPER_VZ: { query: async () => ({ matches: [{ id: "v", score: 0.93, metadata: { slug: paper.slug, title: paper.title } }] }) },
    LIVING_PAPER: { prepare: () => stmt(paper) },
    GRAPH_DB: { prepare: () => stmt(null) },
    AUDIT: audit
  };
}
const draft = (n) => ({ post_id: "post-" + n, post_title: "Question " + n, paper: { slug: paper.slug, title: paper.title, url: "https://papers.qnfo.org/papers/demo-paper", score: 0.93 }, evidence: "An abstract that answers the question.", reply_draft: "x" });

const calls = [];
let commentStatus = () => 201;
let feedPosts = [{ id: "post-100", title: "How do hierarchies embed?", abstract: "A question about ultrametric structure and attention." }];
const realNow = Date.now;
Date.now = () => clock;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ url: u, init });
  if (u.includes("/api/v1/feed?sort=needs_response")) return new Response(JSON.stringify({ success: true, data: { posts: feedPosts } }), { status: 200 });
  if (/\/api\/v1\/posts\/[^/]+\/comments$/.test(u)) {
    const s = commentStatus(u, calls.filter((c) => /comments$/.test(c.url)).length);
    const body = s === 429 ? { error: "RATE_LIMIT", retry_after_seconds: 42 } : s >= 400 ? { error: "FORBIDDEN", message: "no" } : { success: true, data: { id: "c1" } };
    return new Response(JSON.stringify(body), { status: s });
  }
  return new Response(JSON.stringify({ data: {} }), { status: 200 });
};
const commentCalls = () => calls.filter((c) => /\/comments$/.test(c.url));
const run = async (env) => { calls.length = 0; const pending = []; await w.scheduled({}, env, { waitUntil: (p) => pending.push(p) }); await Promise.all(pending); };

// 1. drafts are written by the cron when exuvia_engage is on, and nothing is ever posted while exuvia_engage_post is absent
{
  const env = makeEnv({ ops: { exuvia_engage: "on" } });
  await run(env);
  const drafts = env.AUDIT.log.filter((r) => r.outcome === "Evidence-backed reply draft prepared; not posted");
  assert.equal(drafts.length, 1, "the cron wrote one draft");
  assert.equal(commentCalls().length, 0, "no comment is posted while exuvia_engage_post is absent");
  await run(env);
  assert.equal(env.AUDIT.log.filter((r) => r.outcome === "Evidence-backed reply draft prepared; not posted").length, 1, "a second run does not duplicate the draft");
}

// 1b. a quiet feed says how close it came: the log line carries the unmatched count and the best vector score (a threshold that is too high can be told from a feed with nothing to answer)
{
  const logs = [], realLog = console.log;
  console.log = (...a) => { logs.push(a.join(" ")); };
  const env = makeEnv({ ops: { exuvia_engage: "on" } });
  env.PAPER_VZ.query = async () => ({ matches: [{ id: "v", score: 0.71, metadata: { slug: paper.slug, title: paper.title } }] });
  await run(env);
  console.log = realLog;
  const line = JSON.parse(logs.find((l) => l.includes('"exuvia-cron"')));
  assert.equal(line.draft.drafts, 0, "no draft below the threshold");
  assert.equal(line.draft.unmatched, 1, "the post is counted as unmatched");
  assert.equal(line.draft.best_score, 0.71, "the best score is logged");
  assert.equal(line.draft.errors, 0);
}

// 2. both switches off: the cron reads nothing and posts nothing
{
  const env = makeEnv({ drafts: [draft(1)] });
  await run(env);
  assert.equal(calls.length, 0, "no Exuvia call at all");
}

// 3. posting off (explicitly) with a stored draft: nothing posted
{
  const env = makeEnv({ ops: { exuvia_engage_post: "off" }, drafts: [draft(1)] });
  await run(env);
  assert.equal(commentCalls().length, 0);
}

// 4. posting on: at most 2 per run, the right route and field, logged as posted
{
  const env = makeEnv({ ops: { exuvia_engage_post: "on" }, drafts: [draft(1), draft(2), draft(3)] });
  await run(env);
  const cc = commentCalls();
  assert.equal(cc.length, 2, "two comments per run (burst limit)");
  assert.match(cc[0].url, /\/api\/v1\/posts\/post-1\/comments$/);
  assert.equal(cc[0].init.method, "POST");
  assert.equal(cc[0].init.headers["x-api-key"], KEY);
  const body = JSON.parse(cc[0].init.body);
  assert.deepEqual(Object.keys(body), ["body"], "comments use the body field");
  assert.match(body.body, /Demo Paper/);
  assert.match(body.body, /papers\.qnfo\.org\/papers\/demo-paper/);
  assert.ok(!JSON.stringify(env.AUDIT.log).includes(KEY), "the key is never logged");
  const posted = env.AUDIT.log.filter((r) => r.outcome === "posted");
  assert.equal(posted.length, 2);
  assert.match(posted[0].predicted, /referral/);
  // the third draft waits: inside the 150 s window the burst is spent
  clock += 60e3;
  await run(env);
  assert.equal(commentCalls().length, 0, "the burst is spent inside the cooldown");
  // after the cooldown the third draft goes out, and the first two are never posted twice
  clock += 120e3;
  await run(env);
  assert.deepEqual(commentCalls().map((c) => c.url.split("/").slice(-2)[0]), ["post-3"], "only the unposted draft is sent");
  clock += 3600e3;
  await run(env);
  assert.equal(commentCalls().length, 0, "nothing is posted twice");
}

// 5. a 429 stops the run and is not final: the draft is retried the next hour
{
  let n = 0;
  commentStatus = () => (++n === 1 ? 429 : 201);
  const env = makeEnv({ ops: { exuvia_engage_post: "on" }, drafts: [draft(7), draft(8)] });
  await run(env);
  assert.equal(commentCalls().length, 1, "a 429 stops the run after the first call");
  assert.equal(env.AUDIT.log.filter((r) => /reply (posted|refused)/.test(r.action)).length, 0, "a 429 records nothing as final");
  clock += 3600e3;
  await run(env);
  assert.equal(commentCalls().length, 2, "the next run posts both");
  commentStatus = () => 201;
}

// 6. any other 4xx is recorded once and never retried; the next draft still goes out
{
  commentStatus = (u) => (u.includes("/post-9/") ? 403 : 201);
  const env = makeEnv({ ops: { exuvia_engage_post: "on" }, drafts: [draft(9), draft(10)] });
  await run(env);
  assert.equal(commentCalls().length, 2);
  const refusal = env.AUDIT.log.filter((r) => r.action === "EXUVIA-ENGAGE-1: reply refused for post post-9");
  assert.equal(refusal.length, 1);
  assert.equal(refusal[0].outcome, "HTTP 403");
  clock += 3600e3;
  await run(env);
  assert.equal(commentCalls().length, 0, "a refused draft is never retried");
  commentStatus = () => 201;
}

// 7. a 5xx is transient: the run stops and nothing is recorded as final
{
  commentStatus = () => 503;
  const env = makeEnv({ ops: { exuvia_engage_post: "on" }, drafts: [draft(11), draft(12)] });
  await run(env);
  assert.equal(commentCalls().length, 1);
  assert.equal(env.AUDIT.log.filter((r) => /reply (posted|refused)/.test(r.action)).length, 0);
  commentStatus = () => 201;
}

// 8. no key: nothing happens; a down audit store is reported, never thrown out of the cron
{
  await run(makeEnv({ noKey: true, ops: { exuvia_engage: "on", exuvia_engage_post: "on" }, drafts: [draft(1)] }));
  assert.equal(calls.length, 0);
  await run(makeEnv({ auditDown: true, ops: { exuvia_engage: "on", exuvia_engage_post: "on" } }));
}

Date.now = realNow;
console.log("exuvia-reply.test.mjs ok");
