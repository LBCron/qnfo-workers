// qnfo-jobsearch offline suite. Run: node qnfo-jobsearch/worker.test.mjs
// Proves: the verifier rejects tampering, gates hold, a full run over stubbed feeds stores verified drafts, the API and UI answer,
// approval needs the token, an unverified draft cannot be approved, and the run cooldown holds.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const w = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const T = w.__test;
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const config = readFileSync(join(here, "wrangler.toml"), "utf8");
const configHead = config.split(/^\s*\[/m)[0];
const compatDate = (configHead.match(/^\s*compatibility_date\s*=\s*"(\d{4}-\d{2}-\d{2})"/m) || [])[1];
ok(compatDate >= "2026-10-10", "compatibility date includes the reviewed default changes", compatDate);
ok(/^# compat-advance: reviewed \d{4}-\d{2}-\d{2}$/m.test(config), "compatibility date has its review marker");

const JOB = { id: "t:1", company: "Acme", title: "Research Program Manager", location: "Amsterdam, Netherlands", url: "https://x/1",
  desc: "Lead our research program and research operations. LLM evaluation, responsible AI, public sector work, government agencies. Audit and reproducibility." };
const m = T.evaluate(JOB), res = T.buildResume(JOB, m), note = T.buildNote(JOB, m);
ok(m.status === "ok", "clean job matches", m);
ok(T.verify(res, JOB).length === 0 && T.verify(note, JOB).length === 0, "clean artifacts verify");
ok(T.verify(res.replace("44+", "400+"), JOB).length > 0, "inflated number rejected");
ok(T.verify(res + "- Expert in Kubernetes. <!--F:F06-->\n", JOB).length > 0, "invented skill rejected");
ok(T.verify(note + "I also hold a PhD.\n", JOB).length > 0, "untagged line rejected");
ok(T.verify(note.replace(/"[^"]+"/, '"quantum cryptography"'), JOB).length > 0, "foreign quoted term rejected");
for (const [title, loc] of [["Sales Lead, Research", "Amsterdam"], ["Intern, Research Program", "Amsterdam"], ["Research Program Manager", "Remote - US only"], ["Staff Engineer, Research Platform", "Amsterdam"], ["Senior AI Governance Counsel", "Amsterdam"], ["Product Marketing, Data Products", "Amsterdam"], ["Forward Deployed Product Manager, Public Sector", "Amsterdam"]])
  ok(T.evaluate({ ...JOB, title, location: loc }).status === "excluded", "gate " + title + " / " + loc);
const jobAt = (location, title = "Senior Policy Advisor") => ({ ...JOB, title, location });
ok(T.evaluate(jobAt("Tokyo, Japan")).status === "excluded", "elsewhere is off by default");
const tk = T.evaluate(jobAt("Tokyo, Japan"), T.makeCtx({ loc_world: true }));
ok(tk.status === "ok" && tk.flags.some((f) => f.includes("visa")), "elsewhere comes back flagged when selected", tk);
ok(T.evaluate(jobAt("San Francisco, CA")).status === "excluded", "US on-site is off by default (the owner lives in Amsterdam)");
ok(T.evaluate(jobAt("San Francisco, CA"), T.makeCtx({ loc_us: true })).flags.some((f) => f.startsWith("LOCATION")), "US on-site flagged when selected");
ok(T.evaluate(jobAt("Berlin, Germany")).status === "excluded" && T.evaluate(jobAt("Berlin, Germany"), T.makeCtx({ loc_eu: true })).status === "ok", "other EU country only when selected");
ok(T.evaluate(jobAt("Amsterdam, Netherlands")).status === "ok" && T.evaluate(jobAt("Remote, Europe")).status === "ok" && T.evaluate(jobAt("Amsterdam; San Francisco")).status === "ok", "Amsterdam, EU remote and mixed lists pass");
// role families come from the whole record, not only AI
for (const title of ["Senior Policy Advisor", "Senior Transport Planner", "Lead Data Scientist", "Head of Analytics", "Senior Program Manager", "Senior Product Manager, Data Platform", "Senior Consultant, Mobility", "Executive Director", "Senior GIS Analyst", "Contracts Manager"]) {
  const r = T.evaluate({ ...JOB, title, desc: "Amsterdam role.", location: "Amsterdam" });
  ok(r.status === "ok", "in lane: " + title, r);
}
ok(T.evaluate(jobAt("Amsterdam", "Senior Transport Planner"), T.makeCtx({ fam_transport: false })).status === "excluded", "a family switched off drops its titles");
ok(T.evaluate(jobAt("Amsterdam", "Policy Analyst"), T.makeCtx({ lvl_mid: false })).status === "excluded", "below-senior titles drop when the owner says no");
const dis = T.makeCtx({}, [{ title: "Analytics Operations Specialist", verdict: "dislike" }, { title: "Operations Analytics Specialist", verdict: "dislike" }, { title: "Policy Advisor Housing", verdict: "like" }]);
ok(dis.learned.block.has("analytics") && dis.learned.boost.has("housing") && !dis.learned.block.has("policy"), "two dislikes block a word, a like boosts one");
const an = T.scoreJob(jobAt("Tokyo, Japan"), T.makeCtx({}), "analyze");
ok(an.drops.length > 0 && an.fit > 0, "analysis keeps the fit when the gates would drop the job", an);
ok(T.evaluate(jobAt("Amsterdam", "Product Marketing Manager")).status === "excluded" && T.evaluate(jobAt("Amsterdam", "Senior AI Governance Counsel")).status === "excluded", "marketing and legal titles stay out");
ok(T.evaluate({ ...JOB, desc: JOB.desc + " A PhD is required." }).flags.some((f) => f.startsWith("DEGREE")), "PhD flag");
ok(T.stripHtml("&lt;p&gt;Hello &amp;amp; <b>world</b>&lt;/p&gt;").includes("Hello & world"), "html decode");

// ---- D1 shim over node:sqlite
const db = new DatabaseSync(":memory:");
db.exec(readFileSync(join(here, "../migrations/2026-10-27-jobsearch.sql"), "utf8"));
const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a),
  run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
  first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }) });
const env = { JOBS_DB: { prepare: (s) => stmt(s), batch: async (a) => { for (const x of a) await x.run(); return []; } }, LOOP_TOKEN: "secret-test-token" };

// ---- stub feeds: one good posting, one engineer; every other feed returns nothing
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  const j = (o) => new Response(JSON.stringify(o), { status: 200 });
  if (u.includes("api.ashbyhq.com/posting-api/job-board/openai")) return j({ jobs: [
    { id: "a1", title: "Research Program Manager, Frontier Assurance", location: "Amsterdam", isRemote: false, jobUrl: "https://jobs/a1", descriptionPlain: JOB.desc },
    { id: "a2", title: "Staff Software Engineer", location: "Amsterdam", jobUrl: "https://jobs/a2", descriptionPlain: "code" }] });
  if (u.includes("boards-api.greenhouse.io/v1/boards/anthropic")) return j({ jobs: [] });
  const publicListings = {
    "werkenvoornederland.nl/vacatures": '<a href="/vacatures/intern-policy-research">Intern, Policy Research</a>',
    "academictransfer.com/en/jobs/": '<a href="/en/jobs/intern-policy-research">Intern, Policy Research</a>',
    "euraxess.ec.europa.eu/jobs/search": '<a href="/jobs/intern-policy-research">Intern, Policy Research</a>',
  };
  const publicListing = Object.entries(publicListings).find(([path]) => u.includes(path));
  if (publicListing) return new Response(publicListing[1], { status: 200, headers: { "content-type": "text/html" } });
  return j(u.includes("lever") ? [] : { jobs: [], data: [] });
};
const call = async (path, init, e = env) => { const r = await w.fetch(new Request("https://x" + path, init), e, { waitUntil: (p) => p }); return [r.status, await r.json().catch(() => null), r]; };
await w.scheduled({}, env, { waitUntil: (p) => p });
await new Promise((r) => setTimeout(r, 50));
const runs = (await call("/api/runs"))[1].runs;
ok(runs.length === 1 && runs[0].stored === 1 && runs[0].blocked === 0, "run stored 1 verified match", runs[0]);
const publicFeeds = db.prepare("SELECT feed, last_count, last_error FROM jobsearch_feeds WHERE feed LIKE 'publicsector:%' ORDER BY feed").all();
ok(publicFeeds.length === 3 && publicFeeds.every((f) => f.last_count === 1 && !f.last_error), "public-sector listing pages yield one posting each", publicFeeds);
const list = (await call("/api/matches"))[1];
ok(list.count === 1 && list.matches[0].title.startsWith("Research Program Manager") && list.matches[0].status === "pending_owner_approval", "list", list);
const id = list.matches[0].id;
const one = (await call("/api/matches/" + encodeURIComponent(id)))[1];
ok(one.verified === 1 && one.resume_md.includes("Federal Highway") && !one.note_md.includes("<!--"), "detail has clean verified artifacts");
ok((await call("/api/matches?tier=A"))[1].count === 1 && (await call("/api/matches?tier=B"))[1].count === 0, "tier filter");
ok((await call("/api/ledger"))[1].facts.length >= 15, "ledger served");
ok((await call("/health"))[1].version.startsWith("1."), "health");
const ui = await call("/", undefined);
ok(ui[2].headers.get("content-type").includes("text/html"), "UI html");
// auth + state machine
const post = (hdr, body) => call("/api/matches/" + encodeURIComponent(id) + "/status", { method: "POST", headers: { "content-type": "application/json", ...hdr }, body: JSON.stringify(body) });
ok((await post({}, { status: "approved" }))[0] === 401, "no token -> 401");
ok((await post({ "x-loop-token": "wrong-token-xxx" }, { status: "approved" }))[0] === 401, "bad token -> 401");
ok((await post({ "x-loop-token": "secret-test-token" }, { status: "sent" }))[0] === 400, "bad status -> 400");
ok((await post({ "x-loop-token": "secret-test-token" }, { status: "approved" }))[0] === 200, "approve with token");
ok((await call("/api/matches?status=approved"))[1].count === 1, "status persisted");
ok((await call("/api/matches/" + id + "/status", { method: "POST", body: "{}" }, { ...env, LOOP_TOKEN: undefined }))[0] === 503, "writes disabled without secret");
db.prepare("UPDATE jobsearch_matches SET verified=0, blocked_reason='x', resume_md=NULL WHERE id=?").run(id);
ok((await post({ "x-loop-token": "secret-test-token" }, { status: "approved" }))[0] === 409, "unverified draft cannot be approved");
ok((await post({ "x-loop-token": "secret-test-token" }, { status: "rejected" }))[0] === 200, "unverified draft can be rejected");
// rerun keeps decision
await w.scheduled({}, env, { waitUntil: (p) => p }); await new Promise((r) => setTimeout(r, 50));
ok((await call("/api/matches?status=all"))[1].matches[0].status === "rejected" && (await call("/api/matches"))[1].count === 0, "rerun upsert keeps the owner decision and the rejected match stays hidden");
// cooldown
ok((await call("/api/run", { method: "POST" }))[0] === 429, "run cooldown");

// ---------------- JOBSEARCH-OPS-1
{
  // ledger embedded in the worker equals jobsearch/facts.json (root cause of ledger drift)
  const file = JSON.parse(readFileSync(join(here, "../jobsearch/facts.json"), "utf8"));
  ok(JSON.stringify(file) === JSON.stringify(T.LEDGER) || JSON.stringify(file.facts) === JSON.stringify(T.LEDGER.facts), "embedded ledger facts equal jobsearch/facts.json");
  ok(T.LEDGER.ledger_verified_on === file.ledger_verified_on, "ledger date parity");
  ok(T.dedupeKey({ company: "A", title: "X  Y", location: "NL" }) === T.dedupeKey({ company: "a", title: "x y", location: "nl" }), "dedupe key normalises");
  ok(T.feedPrefix("greenhouse:anthropic") === "gh:anthropic:" && T.feedPrefix("remotive:data") === "rm:", "feed prefixes");

  // e-mailed-code sign-in with a stubbed qnfo-email
  const sent = [];
  const env2 = { ...env, LOOP_TOKEN: undefined, EMAIL: { fetch: async (u, init) => { sent.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); } } };
  const [s1, b1] = await call("/api/auth/request", { method: "POST" }, env2);
  ok(s1 === 200 && b1.sent && /\*\*\*@/.test(b1.to) && !JSON.stringify(b1).includes("rwnquni"), "request sends a code and masks the address", b1);
  const code = (sent[0].body.match(/\b(\d{6})\b/) || [])[1];
  ok(sent.length === 1 && sent[0].to === "rwnquni@outlook.com" && sent[0].notify === true && /^\d{6}$/.test(code), "mail goes to the owner only", sent[0]);
  const [s2] = await call("/api/auth/request", { method: "POST" }, env2);
  ok(s2 === 200 && sent.length === 1, "second request within a minute sends nothing");
  const wrong = String((+code + 1) % 1000000).padStart(6, "0");
  const ver = (c) => call("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: c }) }, env2);
  ok((await ver(wrong))[0] === 401, "wrong code refused");
  ok((await ver("12ab"))[0] === 400, "malformed code refused");
  const [s3, b3, r3] = await ver(code);
  const cookie = r3.headers.get("set-cookie") || "";
  ok(s3 === 200 && /jobs_session=[0-9a-f]{64}/.test(cookie) && /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Strict/.test(cookie) && b3.token.length === 64, "correct code opens a session cookie", cookie);
  ok((await ver(code))[0] !== 200, "a code works once");
  const sess = cookie.split(";")[0];
  ok(db.prepare("SELECT token_hash FROM jobsearch_sessions").all().every((r) => r.token_hash !== b3.token), "only a hash of the session token is stored");
  ok((await call("/api/auth/me", { headers: { cookie: sess } }, env2))[1].signed_in === true, "me: signed in");
  ok((await call("/api/auth/me", {}, env2))[1].signed_in === false, "me: signed out without cookie");
  db.prepare("UPDATE jobsearch_matches SET verified=1, resume_md='r', note_md='n', status='pending_owner_approval' WHERE id=?").run(id);
  const stat = (hdr, st) => call("/api/matches/" + encodeURIComponent(id) + "/status", { method: "POST", headers: { "content-type": "application/json", ...hdr }, body: JSON.stringify({ status: st }) }, env2);
  ok((await stat({}, "approved"))[0] === 401, "no session -> 401");
  ok((await stat({ cookie: sess }, "approved"))[0] === 200, "session cookie approves");
  ok((await stat({ authorization: "Bearer " + b3.token }, "applied"))[0] === 200, "bearer token works for API clients");
  await call("/api/auth/logout", { method: "POST", headers: { cookie: sess } }, env2);
  ok((await stat({ cookie: sess }, "rejected"))[0] === 401, "logout revokes the session");
  // brute force: 5 wrong tries kill the code
  db.prepare("DELETE FROM jobsearch_codes").run();
  db.prepare("INSERT INTO jobsearch_codes (code_hash, salt, created_ms, expires_ms) VALUES ('x','s',?,?)").run(Date.now(), Date.now() + 60000);
  let last5;
  for (let k = 0; k < 5; k++) last5 = await ver("000000");
  ok(last5[0] === 429, "the 5th wrong try locks the code", last5);
  ok((await ver("000000"))[0] !== 200, "a locked code is not accepted afterwards");
  // two e-mailed codes are both valid; either opens a session
  db.prepare("DELETE FROM jobsearch_codes").run();
  const mk = async (c, salt) => db.prepare("INSERT INTO jobsearch_codes (code_hash, salt, created_ms, expires_ms) VALUES (?,?,?,?)").run(await (async () => { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + c)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); })(), salt, Date.now(), Date.now() + 600000);
  await mk("111111", "a"); await mk("222222", "b");
  ok((await ver("111111"))[0] === 200, "an older unexpired code still works");
  ok((await ver("222222"))[0] === 200, "the newer code works too");
  // request cap: 3 per hour
  db.prepare("DELETE FROM jobsearch_codes").run();
  const t = Date.now();
  for (let k = 0; k < 6; k++) db.prepare("INSERT INTO jobsearch_codes (code_hash, salt, created_ms, expires_ms, used) VALUES ('x','s',?,?,1)").run(t - (k + 2) * 120000, t + 1);
  const capped = await call("/api/auth/request", { method: "POST" }, env2);
  ok(capped[0] === 429 && capped[1].retry_after_minutes > 0 && capped[1].enter_existing_code === true, "code requests capped at 6 per hour, answer says when to retry", capped[1]);
  ok((await call("/api/auth/request", { method: "POST" }, { ...env, EMAIL: undefined }))[0] === 503, "no EMAIL binding -> 503, not a crash");

  // lifecycle, feed health, self-heal
  db.prepare("INSERT INTO jobsearch_runs (started_at) VALUES (?)").run(new Date(Date.now() - 3600000).toISOString());
  db.prepare("INSERT INTO jobsearch_matches (id, first_seen, last_seen, company, title, location, url, tier, score, why_json, flags_json, verified, status) VALUES ('gh:anthropic:gone', ?1, ?1, 'A', 'Old role', 'x', 'u', 'B', 50, '[]', '[]', 1, 'pending_owner_approval')").run(new Date(Date.now() - 5 * 86400000).toISOString());
  db.prepare("INSERT INTO jobsearch_matches (id, first_seen, last_seen, company, title, location, url, tier, score, why_json, flags_json, verified, status) VALUES ('lv:palantir:keep', ?1, ?1, 'P', 'Old role 2', 'x', 'u', 'B', 50, '[]', '[]', 1, 'pending_owner_approval')").run(new Date(Date.now() - 5 * 86400000).toISOString());
  globalThis.fetch = async (u) => {
    if (u.includes("lever.co")) throw new Error("boom");               // palantir feed down: its match must survive
    if (u.includes("boards-api.greenhouse.io/v1/boards/anthropic")) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    return new Response(JSON.stringify({ jobs: [], data: [] }), { status: 200 });
  };
  db.prepare("DELETE FROM jobsearch_codes").run();
  await w.scheduled({}, env2, { waitUntil: (p) => p }); await new Promise((r) => setTimeout(r, 4000));
  const st = (i) => db.prepare("SELECT status FROM jobsearch_matches WHERE id=?").get(i)?.status;
  ok(st("gh:anthropic:gone") === "expired", "match gone from an answering feed expires", st("gh:anthropic:gone"));
  ok(st("lv:palantir:keep") === "pending_owner_approval", "a failed feed expires nothing");
  const feed = db.prepare("SELECT * FROM jobsearch_feeds WHERE feed='lever:palantir'").get();
  ok(feed && feed.consecutive_fail >= 1 && /boom/.test(feed.last_error), "feed failure recorded", feed);
  const stuck = db.prepare("SELECT finished_at, errors_json FROM jobsearch_runs WHERE finished_at IS NOT NULL AND errors_json LIKE '%did not finish%'").get();
  ok(!!stuck, "run left open for an hour is closed by the next run");
  const ops = (await call("/api/ops", {}, env2));
  ok(ops[1].checks.length === 8 && ops[1].checks.find((c) => c.fm === "jobsearch-auth-unavailable").ok, "ops report lists 8 checks, auth ok", ops[1].checks.filter((c) => !c.ok));
  ok(ops[1].checks.find((c) => c.fm === "jobsearch-cron-stalled").ok, "ops: cron fresh");
  ok(db.prepare("SELECT v FROM jobsearch_meta WHERE k='ledger_verified_on'").get().v === "2026-10-01", "ledger date recorded each run");
  ok((await call("/health", {}, env2))[1].ledger_verified_on === "2026-10-01", "health shows ledger date");
  ok(db.prepare("SELECT v FROM jobsearch_meta WHERE k='ledger_open_questions'").get().v === String(T.LEDGER.unverified_needs_owner.length), "open ledger questions recorded each run for the owner-card probe");
}

// ---------------- JOBSEARCH-OUTCOME-1
{
  db.exec("CREATE TABLE IF NOT EXISTS metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT DEFAULT 'UNMEASURED')");
  for (const m of ["jobsearch_reply_rate_90d", "jobsearch_interview_rate_90d", "jobsearch_applied_30d"]) db.prepare("INSERT OR IGNORE INTO metric_registry (metric) VALUES (?)").run(m);
  const sess2 = { cookie: "" };
  // sign in once more to drive the status route through the API
  const sentCodes = [];
  const envO = { ...env, LOOP_TOKEN: "secret-test-token", EMAIL: { fetch: async (u, init) => { sentCodes.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); } } };
  const tokHdr = { "x-loop-token": "secret-test-token", "content-type": "application/json" };
  const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
  db.prepare("DELETE FROM jobsearch_events").run();
  db.prepare("DELETE FROM jobsearch_matches").run();
  const ins = db.prepare("INSERT INTO jobsearch_matches (id, first_seen, last_seen, company, title, location, url, tier, score, why_json, flags_json, verified, status) VALUES (?1, ?2, ?2, 'C', 'T', 'L', 'u', ?3, 70, '[]', '[]', 1, ?4)");
  const ev = db.prepare("INSERT INTO jobsearch_events (match_id, event, ts) VALUES (?, ?, ?)");
  // under 10 mature applications: rate unknown, nothing written
  for (let k = 0; k < 4; k++) { ins.run("o" + k, ago(40), "A", "applied"); ev.run("o" + k, "applied", ago(35)); }
  ev.run("o0", "replied", ago(30));
  let o = (await call("/api/outcomes", {}, envO))[1];
  ok(o.reply_rate_90d === null && /unknown/.test(o.reading) && o.mature_applied_90d === 4, "under 10 mature applications the rate is unknown", o);
  ok(o.funnel.applied === 4 && o.funnel.replied === 1, "funnel counts", o.funnel);
  // ten mature applications: 4 replies, 2 interviews
  for (let k = 4; k < 10; k++) { ins.run("o" + k, ago(40), k < 8 ? "A" : "B", "applied"); ev.run("o" + k, "applied", ago(35)); }
  ev.run("o1", "replied", ago(30)); ev.run("o2", "interview", ago(28)); ev.run("o3", "interview", ago(27)); ev.run("o1", "offer", ago(20));
  ins.run("young", ago(5), "A", "applied"); ev.run("young", "applied", ago(3));   // too young to count
  o = (await call("/api/outcomes", {}, envO))[1];
  ok(o.mature_applied_90d === 10 && o.reply_rate_90d === 0.4 && o.interview_rate_90d === 0.3, "rates over mature applications only", o);
  ok(o.applied_30d === 1 && o.by_tier.A.applied >= 7, "applied_30d and tier funnel", o);
  // the run publishes the metrics
  db.prepare("UPDATE jobsearch_runs SET started_at = ? WHERE id = (SELECT MAX(id) FROM jobsearch_runs)").run(ago(1));
  globalThis.fetch = async () => new Response(JSON.stringify({ jobs: [], data: [] }), { status: 200 });
  await w.scheduled({}, envO, { waitUntil: (p) => p }); await new Promise((r) => setTimeout(r, 4000));
  const mv = (k) => db.prepare("SELECT last_value, state FROM metric_registry WHERE metric=?").get(k);
  ok(mv("jobsearch_reply_rate_90d").last_value === "0.4" && mv("jobsearch_reply_rate_90d").state === "MEASURED" && mv("jobsearch_applied_30d").last_value === "1", "run writes the outcome metrics", [mv("jobsearch_reply_rate_90d"), mv("jobsearch_applied_30d")]);
  // no reply in 21 days closes the application automatically (o4..o9 never replied and were applied 35 days ago)
  ok(db.prepare("SELECT status FROM jobsearch_matches WHERE id='o5'").get().status === "no_reply" && db.prepare("SELECT status FROM jobsearch_matches WHERE id='o1'").get().status === "applied", "no reply in 21 days becomes no_reply; replied stays", db.prepare("SELECT id, status FROM jobsearch_matches").all());
  ok(db.prepare("SELECT COUNT(*) AS n FROM jobsearch_events WHERE event='no_reply'").get().n >= 5, "no_reply events are logged");
  // owner status changes are logged as events; outcome statuses are accepted
  const st = await call("/api/matches/young/status", { method: "POST", headers: tokHdr, body: JSON.stringify({ status: "replied" }) }, envO);
  ok(st[0] === 200 && db.prepare("SELECT event FROM jobsearch_events WHERE match_id='young' ORDER BY id DESC LIMIT 1").get().event === "replied", "outcome status is an event", st);
  ok((await call("/api/matches/young/status", { method: "POST", headers: tokHdr, body: JSON.stringify({ status: "hired" }) }, envO))[0] === 400, "unknown status refused");
  ok((await call("/api/outcomes", {}, envO))[1].by_tier.A.replied >= 1, "tier funnel sees replies");
  globalThis.fetch = realFetch;
}

// ---------------- JOBSEARCH-PROFILE-1 (API)
{
  const sessEnv = { ...env, LOOP_TOKEN: "secret-test-token", EMAIL: { fetch: async () => new Response("{}", { status: 200 }) } };
  const H = { "x-loop-token": "secret-test-token", "content-type": "application/json" };
  const post = (path, body, e = sessEnv) => call(path, { method: "POST", headers: H, body: JSON.stringify(body) }, e);
  const pr = (await call("/api/prefs", {}, sessEnv))[1];
  ok(pr.survey.length >= 20 && pr.survey.every((q) => q.q && q.group), "survey served", pr.survey.length);
  ok((await call("/api/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, sessEnv))[0] === 401, "saving preferences needs sign-in");
  ok((await post("/api/prefs", { answers: { nope: true } }))[0] === 400 && (await post("/api/prefs", { answers: { loc_us: "yes" } }))[0] === 400, "unknown question and non-boolean answers refused");
  globalThis.fetch = async () => new Response(JSON.stringify({ jobs: [], data: [] }), { status: 200 });
  const saved = await call("/api/prefs", { method: "POST", headers: H, body: JSON.stringify({ answers: { loc_us: true, fam_edu: false } }) }, sessEnv);
  ok(saved[0] === 200 && saved[1].rerun === true, "saving works and re-runs the search", saved);
  ok((await call("/api/prefs", {}, sessEnv))[1].survey.find((q) => q.id === "loc_us").answer === true, "answers persist");
  // rejected matches stay hidden
  db.prepare("DELETE FROM jobsearch_matches").run();
  const ins2 = db.prepare("INSERT INTO jobsearch_matches (id, first_seen, last_seen, company, title, location, url, tier, score, why_json, flags_json, verified, status) VALUES (?1, ?2, ?2, 'C', ?3, 'L', 'u', 'B', 50, '[]', '[]', 1, ?4)");
  ins2.run("h1", new Date().toISOString(), "Kept role", "pending_owner_approval"); ins2.run("h2", new Date().toISOString(), "Rejected role", "rejected");
  ok((await call("/api/matches", {}, sessEnv))[1].matches.map((x) => x.id).join() === "h1", "rejected matches are hidden by default");
  ok((await call("/api/matches?status=all", {}, sessEnv))[1].count === 2, "status=all shows them");
  // a rejection teaches the search
  const rj = await call("/api/matches/h1/status", { method: "POST", headers: H, body: JSON.stringify({ status: "rejected" }) }, sessEnv);
  ok(rj[0] === 200 && db.prepare("SELECT verdict FROM jobsearch_feedback ORDER BY id DESC LIMIT 1").get().verdict === "dislike", "a rejection is logged as a dislike");
  // check a job
  const txt = "Senior Policy Advisor, Housing\nWe need a senior policy advisor for public policy research on housing affordability across the Netherlands. You lead survey and statistical analysis, manage the research programme and work with government agencies. Python and Tableau a plus. 8 years of experience.";
  const chk = await post("/api/analyze", { input: txt, company: "Acme", location: "Amsterdam" });
  ok(chk[0] === 200 && chk[1].verdict && chk[1].would_appear_in_your_search === true && chk[1].strengths.length >= 3 && chk[1].gaps.some((g) => /tableau/i.test(g)) && chk[1].draft.resume, "analyze a pasted posting: verdict, strengths, gaps, draft", chk[1]);
  ok(!/<!--/.test(chk[1].draft.note) && chk[1].draft.resume.includes("Federal Highway"), "the draft is clean and from the ledger");
  const chk2 = await post("/api/analyze", { input: txt, company: "Acme", location: "Tokyo, Japan" });
  ok(chk2[1].would_appear_in_your_search === false && chk2[1].why_not_in_search.length > 0, "analysis says why a job would not appear");
  ok((await post("/api/analyze", { input: "" }))[0] === 400, "empty input refused");
  // user test 2026-10-28: pasted text carries its own location, a long one-line paste gets a short title, "gis" is not found inside "strategist"
  const pasted = await post("/api/analyze", { input: "Senior Transport Policy Analyst, Gemeente Amsterdam. Location: Amsterdam, Netherlands. 8+ years in transport planning and public policy research." });
  ok(pasted[1].location === "Amsterdam, Netherlands", "location read from pasted text: " + pasted[1].location);
  ok(pasted[1].title.length < 60, "short title from a one-line paste: " + pasted[1].title);
  ok(!pasted[1].why.join(" ").includes("gis"), "no gis lane from a transport posting");
  const strat = await post("/api/analyze", { input: "Senior Creative Strategist for paid social and online video campaigns.", title: "Senior Creative Strategist", company: "Acme", location: "Amsterdam" });
  ok(!strat[1].why.join(" ").includes("lane: gis"), "gis not matched inside strategist: " + strat[1].why.join(" "));
  ok((await call("/api/analyze", { method: "POST", body: "{}" }, sessEnv))[0] === 401, "analyze needs sign-in");
  const ssrf = await post("/api/analyze", { input: "https://127.0.0.1/admin" });
  ok(ssrf[0] === 422 && /public website/.test(ssrf[1].error), "private hosts are refused", ssrf);
  const html = '<html><head><title>x</title><script type="application/ld+json">' + JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "Senior Transport Planner", hiringOrganization: { name: "City of Utrecht" }, jobLocation: { address: { addressLocality: "Utrecht", addressCountry: "NL" } }, description: "<p>Lead transport planning and travel demand modelling for the municipality. Statistics and GIS.</p>" }) + "</script></head><body></body></html>";
  globalThis.fetch = async (u) => new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  const viaUrl = await post("/api/analyze", { input: "https://jobs.example.org/posting/1" });
  ok(viaUrl[0] === 200 && viaUrl[1].title === "Senior Transport Planner" && viaUrl[1].company === "City of Utrecht" && viaUrl[1].location.includes("Utrecht"), "a job link is read through its JobPosting data", viaUrl);
  const lk = await post("/api/feedback", { title: "Senior Transport Planner", company: "City of Utrecht", verdict: "like" });
  ok(lk[0] === 200 && (await post("/api/feedback", { title: "x", verdict: "maybe" }))[0] === 400, "feedback stored, bad verdict refused");
  globalThis.fetch = realFetch;
}

globalThis.fetch = realFetch;
console.log(`qnfo-jobsearch: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
