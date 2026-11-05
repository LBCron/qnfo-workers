// REACH-COMMONS-1 offline suite (qnfo-infra; blue-sky roadmap rows 3261, 3263, 3267). No network: Cloudflare's API is a stub fetch, R2 is a stub bucket, qnfo-audit and living-paper are
// node:sqlite databases with the live columns of the tables the block reads and writes. Proves: the agent-read rows (AI crawler fetches from seo_crawl_log into reach_signals) count
// only answered fetches, back-fill eight days once and then two, and are idempotent; the AI-crawler probe flags exactly the bot-management settings that block or charge a crawler,
// runs once a day, and leaves the metric UNMEASURED (never 0) when a zone cannot be read; the atlas export publishes the paper errata with the finder and confirmer model parsed from
// the evidence line, leaves out reader-submitted reports, withholds a text field that looks like a credential, reports per-paper status with a human review only when one is named,
// writes sha256 values that match the bytes it put, and records its failure instead of throwing.
// Run: node --no-warnings qnfo-infra/reach-commons.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
const a = src.indexOf("// ---- REACH-COMMONS-1:BEGIN"), b = src.indexOf("// ---- REACH-COMMONS-1:END");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };
ok(a > 0 && b > a, "the block is found between its markers");
ok(!/\*\//.test(src.slice(a, b)), "no comment terminator inside the block");
ok(/var VERSION = "1\.(1[3-9]|[2-9]\d)\./.test(src), "VERSION is at least 1.13");
const sched = src.slice(src.indexOf("async function runScheduled"));
ok(/collectAgentReads\(env\)/.test(sched.slice(0, 6000)) && /collectAiCrawlProbe\(env\)/.test(sched.slice(0, 6000)) && /publishAtlas\(env\)/.test(sched.slice(0, 6000)), "runScheduled calls the three collectors on every fire");
ok(/\[\[r2_buckets\]\]\s*\nbinding = "ATLAS_R2"\s*\nbucket_name = "qnfo"/.test(toml), "wrangler.toml declares ATLAS_R2 on the public bucket qnfo");
ok(/"ai-reach-series", "ai-crawl-probe", "open-data-atlas"/.test(src), "/health lists the three capabilities");
ok(!/10\.5281|zenodo/i.test(src.slice(a, b)), "no retired deposit prefix or host in the block (NOZ-DOI-1)");

const secret = async (env, k, legacy) => env[legacy];
const sandbox = { fetchImpl: null, calls: [] };
const make = new Function("sandbox", "infraSecret", "VERSION", "fetch", src.slice(a, b) + "\nreturn { RC_ERRATA_SQL, RC_PAPERS_SQL, rcCrawlRows, rcBlockSignals, rcErrataRecord, rcPaperRows, rcSecretShaped, rcDataCard, collectAgentReads, collectAiCrawlProbe, publishAtlas, rcDue };");
const L = make(sandbox, secret, "1.13.0-test", (url, init) => { sandbox.calls.push({ url, init }); return sandbox.fetchImpl(url, init); });

const wrap = (db) => ({
  prepare(sql) {
    const st = db.prepare(sql);
    const mk = (vals) => ({ run: async () => st.run(...vals), first: async () => (st.get(...vals) || null), all: async () => ({ results: st.all(...vals) }), stmt: st, vals });
    const o = mk([]); o.bind = (...v) => mk(v); return o;
  },
  batch: async (list) => { for (const s of list) await s.run(); }
});
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const mkAudit = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE reach_signals (date TEXT NOT NULL, source TEXT NOT NULL, channel TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metric TEXT NOT NULL, value REAL, quality TEXT CHECK (quality IN ('human','bot','unknown')), collected_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (date, source, channel, entity_type, entity_id, metric));" +
    "CREATE TABLE infra_state (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, data TEXT);" +
    "CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);" +
    "INSERT INTO metric_registry VALUES ('ai_crawler_block_zones', NULL, NULL, 'UNMEASURED');" +
    "CREATE TABLE internal_errata (id TEXT PRIMARY KEY, target_kind TEXT NOT NULL, target_ref TEXT NOT NULL, detected_at TEXT NOT NULL, detected_by TEXT, severity TEXT DEFAULT 'high', claim_text TEXT, falsification TEXT, evidence TEXT, remediation TEXT, status TEXT DEFAULT 'open', owner TEXT, updated_at TEXT DEFAULT (datetime('now')));");
  return db;
};
const mkLiving = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE seo_crawl_log (day TEXT NOT NULL, bot TEXT NOT NULL, host TEXT NOT NULL, kind TEXT NOT NULL, status INTEGER NOT NULL DEFAULT 0, n INTEGER NOT NULL DEFAULT 1, last_ts TEXT NOT NULL, PRIMARY KEY (day, bot, host, kind, status));" +
    "CREATE TABLE papers (slug TEXT, title TEXT, version TEXT, status TEXT, last_revised_at TEXT, body_md TEXT);" +
    "CREATE TABLE paper_provenance (slug TEXT PRIMARY KEY, provenance TEXT NOT NULL DEFAULT 'fleet-generated', reviewed_by TEXT);");
  return db;
};

// ---- 1. agent-read rows
const g = L.rcCrawlRows([
  { day: "2026-11-04", bot: "GPTBot", kind: "paper", status: 200, n: 10 },
  { day: "2026-11-04", bot: "gptbot", kind: "paper", status: 301, n: 5 },
  { day: "2026-11-04", bot: "gptbot", kind: "paper-md", status: 200, n: 7 },
  { day: "2026-11-04", bot: "gptbot", kind: "paper", status: 404, n: 99 },     // not answered: dropped
  { day: "2026-11-04", bot: "gptbot", kind: "paper", status: 500, n: 99 },     // error: dropped
  { day: "", bot: "gptbot", kind: "paper", status: 200, n: 4 },                // no day: dropped
  { day: "2026-11-04", bot: "", kind: "paper", status: 200, n: 4 },            // no bot: dropped
  { day: "2026-11-04", bot: "claudebot", kind: "paper", status: 200, n: 0 },   // zero: dropped
  { day: "2026-11-03", bot: "claudebot", kind: "llms", status: 200, n: "3" }]);
const gv = (d, t, id) => (g.find((r) => r[0] === d && r[1] === t && r[2] === id) || [])[3];
ok(gv("2026-11-04", "bot", "gptbot") === 22, "bot rows sum the answered fetches of every kind (200 and 3xx), lower-cased", g);
ok(gv("2026-11-04", "bot-kind", "gptbot|paper") === 15 && gv("2026-11-04", "bot-kind", "gptbot|paper-md") === 7, "bot-kind rows keep the kind apart");
ok(gv("2026-11-03", "bot", "claudebot") === 3 && !g.some((r) => r[2] === "claudebot" && r[0] === "2026-11-04"), "a numeric string counts; a zero group is dropped");
ok(g.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && ["bot", "bot-kind"].includes(r[1]) && Number.isFinite(r[3]) && r[3] > 0), "every row has an ISO day, a known type and a positive number");
ok(L.rcCrawlRows(null).length === 0, "null gives no rows");

// ---- 2. collectAgentReads against real SQLite
{
  const audit = mkAudit(), living = mkLiving();
  const ins = living.prepare("INSERT INTO seo_crawl_log VALUES (?, ?, 'papers.qnfo.org', ?, ?, ?, '2026-11-05T00:00:00Z')");
  ins.run(day(1), "gptbot", "paper", 200, 30); ins.run(day(1), "gptbot", "paper-md", 200, 5); ins.run(day(1), "oai-searchbot", "paper", 200, 9);
  ins.run(day(6), "claudebot", "paper", 200, 12); ins.run(day(20), "claudebot", "paper", 200, 77);
  const env = { AUDIT: wrap(audit), LIVING: wrap(living) };
  const r1 = await L.collectAgentReads(env);
  ok(r1.backfill === true && r1.rows === 7, "the first run back-fills eight days and skips older rows", r1);
  const rows = audit.prepare("SELECT date, entity_type, entity_id, value, quality, source, channel, metric FROM reach_signals ORDER BY date, entity_type, entity_id").all();
  ok(rows.every((x) => x.source === "seo-crawl" && x.channel === "agent" && x.metric === "fetches" && x.quality === "bot"), "rows carry source seo-crawl, channel agent, metric fetches, quality bot", rows[0]);
  ok(rows.find((x) => x.date === day(1) && x.entity_type === "bot" && x.entity_id === "gptbot").value === 35, "gptbot total is the sum of its kinds");
  ok(!rows.some((x) => x.date === day(20)), "a row older than the window is not read");
  living.prepare("UPDATE seo_crawl_log SET n = 40 WHERE bot = 'gptbot' AND kind = 'paper'").run();
  const r2 = await L.collectAgentReads(env);
  ok(r2.backfill === false, "the second run reads only two days");
  const total = audit.prepare("SELECT value v FROM reach_signals WHERE entity_type = 'bot' AND entity_id = 'gptbot'").get().v;
  ok(total === 45 && audit.prepare("SELECT COUNT(*) c FROM reach_signals").get().c === rows.length, "the upsert is idempotent and takes the newer count", total);
  const st = JSON.parse(audit.prepare("SELECT data FROM infra_state WHERE id = 'agent_reads'").get().data);
  ok(st.rows >= 1 && st.version === "1.13.0-test", "state row written", st);
  const bad = await L.collectAgentReads({ AUDIT: wrap(mkAudit()), LIVING: { prepare() { throw new Error("D1 overloaded"); } } });
  ok(bad.error && /overloaded/.test(bad.error), "a read failure is returned, not thrown", bad);
  const aBad = mkAudit();
  await L.collectAgentReads({ AUDIT: wrap(aBad), LIVING: { prepare() { throw new Error("D1 overloaded"); } } });
  ok(!aBad.prepare("SELECT 1 x FROM infra_state WHERE id = 'agent_reads'").get() && !!aBad.prepare("SELECT 1 x FROM infra_state WHERE id = 'agent_reads_error'").get(), "a failed read keeps the back-fill pending (error row only)");
  ok((await L.collectAgentReads({})).skipped, "no bindings: skipped");
}

// ---- 3. AI-crawler block signals
const live = { enable_js: false, fight_mode: false, ai_bots_protection: "disabled", content_bots_protection: "disabled", crawler_protection: "disabled", ai_training: "disabled", ai_search: "disabled", ai_user: "disabled",
  ai_agents: { anthropic_agent: "disabled", google_agent: "disabled", instinct: "disabled", muse: "disabled", openai_agent: "disabled" }, is_robots_txt_managed: false, cf_robots_variant: "policy_only" };
ok(L.rcBlockSignals(live).length === 0, "the settings read on 2026-11-05 (everything disabled) are open", L.rcBlockSignals(live));
ok(L.rcBlockSignals({ ...live, ai_bots_protection: "block" }).join() === "ai_bots_protection=block", "ai_bots_protection=block is a block");
ok(L.rcBlockSignals({ ...live, fight_mode: true, ai_training: "block", ai_agents: { openai_agent: "block", muse: "allow", google_agent: "disabled" } }).join() === "ai_training=block,fight_mode=true,ai_agents.openai_agent=block", "fight mode, a training block and an agent block are all listed", L.rcBlockSignals({ ...live, fight_mode: true, ai_training: "block", ai_agents: { openai_agent: "block" } }));
ok(L.rcBlockSignals(null).length === 0 && L.rcBlockSignals({ ai_search: "allow", crawler_protection: false }).length === 0, "allow, false and missing values are open");

// ---- 4. AI-crawler probe: gate, verdict, UNMEASURED on a failed read
{
  const cf = (zones) => async (url) => {
    const u = new URL(url);
    if (u.pathname === "/client/v4/zones") { const z = zones[u.searchParams.get("name")]; return new Response(JSON.stringify({ result: z === "missing" ? [] : [{ id: "id-" + u.searchParams.get("name") }] }), { status: 200 }); }
    const m = /\/zones\/id-(.+)\/bot_management/.exec(u.pathname);
    const z = zones[m[1]];
    if (z === "denied") return new Response('{"errors":[{"code":9109,"message":"Unauthorized to access requested resource"}]}', { status: 403 });
    return new Response(JSON.stringify({ result: z }), { status: 200 });
  };
  const audit = mkAudit();
  const env = { AUDIT: wrap(audit), CF_TOKEN: "t", CF_ACCOUNT: "acct" };
  sandbox.fetchImpl = cf({ "qnfo.org": live, "qwav.org": live, "q08.org": { ...live, ai_bots_protection: "block" } });
  const t0 = Date.parse("2026-11-05T06:30:00Z");
  const p1 = await L.collectAiCrawlProbe(env, t0);
  ok(p1.blocked === 1 && p1.errors === 0, "one zone with a block is counted", p1);
  let m = audit.prepare("SELECT last_value v, state s FROM metric_registry WHERE metric = 'ai_crawler_block_zones'").get();
  ok(m.v === "1" && m.s === "MEASURED", "the metric reads 1 and MEASURED", m);
  const stz = JSON.parse(audit.prepare("SELECT data FROM infra_state WHERE id = 'ai_crawl_probe'").get().data);
  ok(stz.zones.length === 3 && stz.zones.find((z) => z.zone === "q08.org").signals[0] === "ai_bots_protection=block" && stz.zones.find((z) => z.zone === "qnfo.org").blocked === false, "state lists each zone's signals", stz);
  ok(sandbox.calls.every((c) => /^Bearer t$/.test(c.init.headers.Authorization) && !c.init.method), "only GET calls with the bearer token");
  const calls = sandbox.calls.length;
  const p2 = await L.collectAiCrawlProbe(env, t0 + 3600 * 1000);
  ok(p2.skipped && sandbox.calls.length === calls, "an hour later the probe is skipped and calls nothing");
  sandbox.fetchImpl = cf({ "qnfo.org": live, "qwav.org": live, "q08.org": live });
  const p3 = await L.collectAiCrawlProbe(env, t0 + 21 * 3600 * 1000);
  m = audit.prepare("SELECT last_value v, state s FROM metric_registry WHERE metric = 'ai_crawler_block_zones'").get();
  ok(p3.blocked === 0 && m.v === "0" && m.s === "MEASURED", "after 21 hours it runs again; no block reads 0 and MEASURED", m);
  sandbox.fetchImpl = cf({ "qnfo.org": live, "qwav.org": "denied", "q08.org": live });
  const p4 = await L.collectAiCrawlProbe(env, t0 + 50 * 3600 * 1000);
  m = audit.prepare("SELECT last_value v, state s FROM metric_registry WHERE metric = 'ai_crawler_block_zones'").get();
  ok(p4.errors === 1 && m.v === null && m.s === "UNMEASURED", "a zone that cannot be read leaves the metric NULL and UNMEASURED, never 0", m);
  const sty = JSON.parse(audit.prepare("SELECT data FROM infra_state WHERE id = 'ai_crawl_probe_error'").get().data);
  ok(JSON.parse(audit.prepare("SELECT data FROM infra_state WHERE id = 'ai_crawl_probe'").get().data).blocked === 0, "the success row keeps the last good run; the failure goes to its own row");
  ok(/HTTP 403/.test(sty.zones.find((z) => z.zone === "qwav.org").error), "the refusal text is recorded", sty);
  sandbox.fetchImpl = cf({ "qnfo.org": { ...live, crawler_protection: "block" }, "qwav.org": "denied", "q08.org": live });
  const p4b = await L.collectAiCrawlProbe({ AUDIT: wrap(audit), CF_TOKEN: "t" }, t0 + 100 * 3600 * 1000);
  m = audit.prepare("SELECT last_value v, state s FROM metric_registry WHERE metric = 'ai_crawler_block_zones'").get();
  ok(p4b.errors === 1 && p4b.blocked === 1 && m.v === "1" && m.s === "MEASURED", "a block seen in a readable zone is reported even while another zone cannot be read", m);
  sandbox.fetchImpl = cf({ "qnfo.org": "missing" });
  const p5 = await L.collectAiCrawlProbe({ AUDIT: wrap(mkAudit()), CF_TOKEN: "t" }, t0);
  ok(p5.errors === 3, "a zone that is not in the account is an error, not an open zone", p5);
}

// ---- 5. atlas records
ok(L.rcSecretShaped("key sk-abcdefghijklmnopqrstuv123456") && L.rcSecretShaped("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123") && L.rcSecretShaped("-----BEGIN RSA PRIVATE KEY-----") && L.rcSecretShaped("ghp_" + "a".repeat(30)), "credential shapes are recognised");
ok(L.rcSecretShaped("x-loop-token: abcdef0123456789") && L.rcSecretShaped("X-Loop-Token=abcdef0123456789"), "a loop-token header value is recognised");
ok(!L.rcSecretShaped("the exponent e^-117 and the gap of 25 meV at 4 K; skeleton-key-argument") && !L.rcSecretShaped(""), "ordinary science text is not");
const E = (o) => ({ id: "pl-x-1.0.0-0", target_ref: "paper-x", detected_at: "2026-11-04T22:01:56.893Z", detected_by: "qnfo-lifecycle PAPER-LEARN-1", severity: "high", claim_text: "claim", falsification: "why", evidence: "found by @cf/zai-org/glm-5.3-flash and confirmed by @cf/openai/gpt-oss-120b against version 1.0.0: The text ...", remediation: "revise", status: "open", updated_at: "2026-11-04T22:01:56Z", ...o });
const st0 = () => ({ redacted: 0, reader_reports_excluded: 0 });
let s0 = st0();
let rec = L.rcErrataRecord(E(), s0);
ok(rec.paper_slug === "paper-x" && rec.finder_model === "@cf/zai-org/glm-5.3-flash" && rec.confirmer_model === "@cf/openai/gpt-oss-120b" && rec.paper_version === "1.0.0" && rec.ai_generated === true && rec.detector === "qnfo-lifecycle PAPER-LEARN-1", "finder, confirmer and version are parsed from the evidence line", rec);
rec = L.rcErrataRecord(E({ evidence: "no models named here" }), s0);
ok(rec.finder_model === null && rec.confirmer_model === null && rec.paper_version === null, "a different evidence wording leaves the model fields null");
ok(L.rcErrataRecord(E({ detected_by: "reader-report (READER-REPORT-1), confirmed by openai/gpt-oss-120b" }), s0) === null && s0.reader_reports_excluded === 1, "a reader-submitted report is left out and counted");
ok(L.rcErrataRecord(E({ target_ref: "" }), s0) === null && L.rcErrataRecord(null, s0) === null, "a row without a paper reference is not published");
rec = L.rcErrataRecord(E({ claim_text: "see sk-abcdefghijklmnopqrstuv123456 here", falsification: "x".repeat(5000) }), s0);
ok(rec.claim === null && s0.redacted === 1 && rec.falsification.length === 3000 && rec.falsification.endsWith("..."), "a credential-shaped field is withheld whole and counted; a long field is clipped", [rec.claim, rec.falsification.length]);
rec = L.rcErrataRecord(E({ claim_text: "contact rowan.quni@example.com or write to a.b+c@sub.example.org about it" }), s0);
ok(rec.claim === "contact [email] or write to [email] about it" && s0.redacted === 1, "e-mail addresses are replaced in place and do not withhold the field", rec.claim);
const pr = L.rcPaperRows(
  [{ slug: "paper-x", title: "X", version: "1.0.0", status: "published", provenance: "fleet-generated", reviewed_by: null },
   { slug: "paper-y", title: "Y", version: "2.0.0", status: "published", provenance: "ai-assisted-human-reviewed", reviewed_by: "Dr R" },
   { slug: "paper-z", title: "Z", version: "1.0.0", status: "published", provenance: "ai-assisted-human-reviewed", reviewed_by: "  " },
   { slug: "paper-w", title: "W", version: "1.0.0", status: "published", provenance: null, reviewed_by: null }],
  [{ paper_slug: "paper-x", status: "open", detected_at: "2026-11-02" }, { paper_slug: "paper-x", status: "closed", detected_at: "2026-11-03" }, { paper_slug: "paper-x", status: "rejected", detected_at: "2026-11-01" }, { paper_slug: "paper-y", status: "resolved", detected_at: "2026-10-30" }]);
const px = pr.find((p) => p.slug === "paper-x");
ok(px.errata_total === 3 && px.errata_open === 1 && px.errata_closed === 1 && px.errata_rejected === 1 && px.last_errata_detected_at === "2026-11-03" && px.human_review_recorded === false, "per-paper counts and last detection", px);
ok(pr.find((p) => p.slug === "paper-y").human_review_recorded === true && pr.find((p) => p.slug === "paper-z").human_review_recorded === false && pr.find((p) => p.slug === "paper-w").provenance === "fleet-generated", "a human review is recorded only with a named reviewer; a missing provenance is fleet-generated");
ok(pr.find((p) => p.slug === "paper-w").errata_total === 0 && pr.find((p) => p.slug === "paper-w").last_errata_detected_at === null, "a paper with no findings reads zero with a null date");

// ---- 6. publishAtlas end to end
{
  const audit = mkAudit(), living = mkLiving();
  const ie = audit.prepare("INSERT INTO internal_errata (id, target_kind, target_ref, detected_at, detected_by, severity, claim_text, falsification, evidence, remediation, status) VALUES (?, ?, ?, ?, ?, 'high', 'claim', 'why', ?, 'rem', ?)");
  ie.run("e1", "paper", "alpha", "2026-11-04T10:00:00Z", "qnfo-lifecycle PAPER-LEARN-1", "found by m1 and confirmed by m2 against version 1.0.0: text", "open");
  ie.run("e2", "paper", "alpha", "2026-11-03T10:00:00Z", "qnfo-lifecycle PAPER-LEARN-1", "found by m1 and confirmed by m2 against version 1.0.0: text", "closed");
  ie.run("e3", "paper", "beta", "2026-11-02T10:00:00Z", "qnfo-research-exec CLAIM-INTEGRITY-1", "claim integrity", "rejected");
  ie.run("e4", "paper", "beta", "2026-11-02T11:00:00Z", "reader-report (READER-REPORT-1), confirmed by openai/gpt-oss-120b", "a reader wrote", "open");
  ie.run("e5", "chat_log", "some-chat", "2026-11-02T11:00:00Z", "x", "not a paper", "resolved");
  const ip = living.prepare("INSERT INTO papers (slug, title, version, status, last_revised_at, body_md) VALUES (?, ?, ?, ?, '2026-11-04T00:00:00Z', 'BODY MUST NOT BE READ')");
  ip.run("alpha", "Alpha", "1.0.0", "published"); ip.run("beta", "Beta", "1.1.0", "distributed"); ip.run("gamma", "Gamma", "1.0.0", "published"); ip.run("draft-one", "Draft", "0.1.0", "draft");
  living.prepare("INSERT INTO paper_provenance VALUES ('alpha', 'fleet-generated', NULL)").run();
  const puts = [];
  const bucket = { put: async (key, body, opts) => { puts.push({ key, body, opts }); } };
  const env = { AUDIT: wrap(audit), LIVING: wrap(living), ATLAS_R2: bucket };
  const t0 = Date.parse("2026-11-05T06:30:00Z");
  const r = await L.publishAtlas(env, t0);
  ok(r.errata === 3 && r.papers === 3, "three paper findings (a reader report and a chat-log row are out) and three published papers", r);
  ok(puts.map((p) => p.key).join() === "atlas/ai-science-failures/errata.jsonl,atlas/ai-science-failures/papers-status.jsonl,atlas/ai-science-failures/DATACARD.md,atlas/ai-science-failures/manifest.json", "four objects, data first and the manifest last", puts.map((p) => p.key));
  const byKey = Object.fromEntries(puts.map((p) => [p.key.split("/").pop(), p]));
  ok(/ndjson/.test(byKey["errata.jsonl"].opts.httpMetadata.contentType) && /markdown/.test(byKey["DATACARD.md"].opts.httpMetadata.contentType) && /json/.test(byKey["manifest.json"].opts.httpMetadata.contentType) && /max-age=3600/.test(byKey["manifest.json"].opts.httpMetadata.cacheControl), "content types and a public cache header");
  const lines = byKey["errata.jsonl"].body.trim().split("\n").map((x) => JSON.parse(x));
  ok(lines.length === 3 && lines.every((x) => x.ai_generated === true && x.paper_slug) && !lines.some((x) => /reader wrote/.test(JSON.stringify(x))), "errata.jsonl has the three records and no reader text");
  ok(!JSON.stringify(puts).includes("BODY MUST NOT BE READ"), "no paper body is read or published");
  const man = JSON.parse(byKey["manifest.json"].body);
  const sha = (t) => createHash("sha256").update(t).digest("hex");
  ok(man.files["errata.jsonl"].sha256 === sha(byKey["errata.jsonl"].body) && man.files["papers-status.jsonl"].sha256 === sha(byKey["papers-status.jsonl"].body) && man.files["errata.jsonl"].bytes === Buffer.byteLength(byKey["errata.jsonl"].body), "manifest sha256 and bytes match what was put");
  ok(man.counts.errata === 3 && man.counts.papers === 3 && man.counts.papers_with_findings === 2 && man.counts.papers_with_open_findings === 1 && man.counts.reader_reports_excluded === 1 && man.counts.papers_human_reviewed === 0, "manifest counts", man.counts);
  const card = byKey["DATACARD.md"].body;
  ok(/LicenseRef-QNFO-ULA-2\.1/.test(card) && /## Contamination/.test(card) && /## Limits/.test(card) && /reader-submitted reports/.test(card) && card.includes(man.files["errata.jsonl"].sha256) && /ai_generated/.test(card) && /not an external editor/.test(card), "the data card states licence, limits, contamination, exclusions and the file hashes");
  const stt = JSON.parse(audit.prepare("SELECT data FROM infra_state WHERE id = 'atlas_export'").get().data);
  ok(stt.errata === 3 && /manifest\.json$/.test(stt.url), "state row names the manifest URL", stt);
  const again = await L.publishAtlas(env, t0 + 3600 * 1000);
  ok(again.skipped && puts.length === 4, "an hour later nothing is written");
  const later = await L.publishAtlas(env, t0 + 21 * 3600 * 1000);
  ok(later.errata === 3 && puts.length === 8, "after 21 hours it publishes again");

  // failures are recorded, not thrown
  const a2 = mkAudit();
  const noBucket = await L.publishAtlas({ AUDIT: wrap(a2), LIVING: wrap(living) }, t0);
  ok(noBucket.error && /ATLAS_R2/.test(JSON.parse(a2.prepare("SELECT data FROM infra_state WHERE id = 'atlas_export_error'").get().data).error), "no bucket binding: an error row, no throw");
  const a3 = mkAudit();
  const bad = await L.publishAtlas({ AUDIT: wrap(a3), LIVING: { prepare() { throw new Error("D1 overloaded"); } }, ATLAS_R2: bucket }, t0);
  ok(bad.error && /overloaded/.test(bad.error), "a read failure is returned");
  const a4 = mkAudit();
  a4.prepare("INSERT INTO internal_errata (id, target_kind, target_ref, detected_at, detected_by, status) VALUES ('r1', 'paper', 'alpha', '2026-11-01', 'reader-report (x)', 'open')").run();
  const n = puts.length;
  const empty = await L.publishAtlas({ AUDIT: wrap(a4), LIVING: wrap(living), ATLAS_R2: bucket }, t0);
  ok(empty.error && puts.length === n, "when every errata row is excluded nothing is written (the public file is never replaced by an empty one)");
  // a record that suddenly shrinks by more than half is not published over the good one
  const aShrink = mkAudit();
  aShrink.prepare("INSERT INTO infra_state VALUES ('atlas_export', '2026-11-01T00:00:00Z', 'atlas_export', '{\"errata\": 100}')").run();
  for (const id of ["e1", "e2", "e3"]) { const r0 = audit.prepare("SELECT * FROM internal_errata WHERE id = ?").get(id); aShrink.prepare("INSERT INTO internal_errata (id, target_kind, target_ref, detected_at, detected_by, severity, claim_text, falsification, evidence, remediation, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(r0.id, r0.target_kind, r0.target_ref, r0.detected_at, r0.detected_by, r0.severity, r0.claim_text, r0.falsification, r0.evidence, r0.remediation, r0.status); }
  const putsShrink = puts.length;
  const shrunk = await L.publishAtlas({ AUDIT: wrap(aShrink), LIVING: wrap(living), ATLAS_R2: bucket }, t0);
  ok(shrunk.error && /fell from 100 to 3/.test(shrunk.error) && puts.length === putsShrink && !!aShrink.prepare("SELECT 1 x FROM infra_state WHERE id = 'atlas_export_error'").get(), "a record that shrinks by more than half is not published", shrunk);
  const a5 = mkAudit();
  const failing = await L.publishAtlas({ AUDIT: wrap(a5), LIVING: wrap(living), ATLAS_R2: { put: async () => { throw new Error("R2 503"); } } }, t0);
  ok(failing.error && /R2 write/.test(failing.error), "an R2 failure is returned");
  ie.run("e9", "paper", "alpha", "2026-11-04T11:00:00Z", "qnfo-lifecycle PAPER-LEARN-1", "found by m1 and confirmed by m2 against version 1.0.0: x", "open");
  const a6 = mkAudit();
  a6.prepare("INSERT INTO internal_errata (id, target_kind, target_ref, detected_at, detected_by, status, evidence) VALUES ('z1', 'paper', 'alpha', '2026-11-04', 'qnfo-lifecycle PAPER-LEARN-1', 'open', 'found by m1 and confirmed by m2 against version 1.0.0: x')").run();
  const envFail = { AUDIT: wrap(a6), LIVING: wrap(living), ATLAS_R2: { put: async () => { throw new Error("R2 503"); } } };
  await L.publishAtlas(envFail, t0);
  ok(!a6.prepare("SELECT 1 x FROM infra_state WHERE id = 'atlas_export'").get() && !!a6.prepare("SELECT 1 x FROM infra_state WHERE id = 'atlas_export_error'").get(), "a failed run writes only its error row, so the 20-hour gate stays open");
  const putsBefore = puts.length;
  const retry = await L.publishAtlas({ ...envFail, ATLAS_R2: bucket }, t0 + 3600 * 1000);
  ok(retry.errata === 1 && puts.length === putsBefore + 4, "the next fire retries and publishes", retry);
}

// ---- 7. the SQL the worker runs is the SQL the probes explain
const probes = JSON.parse(readFileSync(new URL("./probes.json", import.meta.url), "utf8"));
const explained = JSON.stringify(probes.d1);
ok(explained.includes("seo_crawl_log") && explained.includes("internal_errata") && explained.includes("paper_provenance") && explained.includes("ai_crawler_block_zones"), "probes.json explains the new statements (crawl log, errata, provenance join, metric update)");
ok(probes.d1.reduce((n, x) => n + x.explain.length, 0) <= 6, "probes.json stays within the six D1 statements DEPLOY-PROBES-1 allows");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
