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
// background work (ctx.waitUntil) is collected and awaited, not raced against a timer
const pending = [];
const ctxStub = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); return p; } };
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
const config = readFileSync(join(here, "wrangler.toml"), "utf8");
const configHead = config.split(/^\s*\[/m)[0];
const workerSource = readFileSync(join(here, "worker.js"), "utf8");
ok(config.includes("# charter-pillar: personal") && workerSource.startsWith("// qnfo-jobsearch: verified-claims job matcher (JOBSEARCH-1). Charter pillar: personal."), "jobsearch is classified under the personal charter pillar");
const compatDate = (configHead.match(/^\s*compatibility_date\s*=\s*"(\d{4}-\d{2}-\d{2})"/m) || [])[1];
ok(compatDate >= "2026-10-10", "compatibility date includes the reviewed default changes", compatDate);
ok(/^# compat-advance: reviewed \d{4}-\d{2}-\d{2}$/m.test(config), "compatibility date has its review marker");

const JOB = { id: "t:1", company: "Acme", title: "Research Program Manager", location: "Amsterdam, Netherlands", url: "https://x/1",
  desc: "Lead our research program and research operations. LLM evaluation, responsible AI, public sector work, government agencies. Audit and reproducibility." };
ok(T.has("policy analystical", ["policy analyst"]).length === 0 && T.has("policy analyst", ["policy analyst"]).length === 1, "role keywords require a right word boundary");
ok(T.has("government agencies", ["government agenc*"]).length === 1, "explicit role keyword stems retain intended suffix matches");
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
ok(T.scoreJob({ ...JOB, location: "", desc: JOB.desc + " The team is based in Amsterdam." }).drops.some((x) => x.includes("no location in the posting")), "missing feed locations are dropped even when a city appears elsewhere in the description");
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
{
  const now = Date.now(), applied = now - 40 * 86400000;
  const history = [
    ...Array.from({ length: 5 }, (_, i) => ({ applied_ms: applied, replied: i < 4, features: ["cluster:urban_planning"] })),
    ...Array.from({ length: 5 }, (_, i) => ({ applied_ms: applied, replied: i === 0, features: ["cluster:policy_research"] }))
  ];
  const weights = T.outcomeScoreWeights(history, now);
  const calibratedJob = { ...JOB, title: "Senior Research Program Manager", desc: "Research program management, research operations, urban planning, land use and spatial planning." };
  const base = T.scoreJob(calibratedJob);
  const calibrated = T.scoreJob(calibratedJob, T.makeCtx({}, [], weights));
  ok(weights["cluster:urban_planning"] > 0 && weights["cluster:policy_research"] < 0, "outcome weights favor reply-associated features and reduce non-reply-associated features", weights);
  ok(base.tier === "B" && calibrated.score > base.score && calibrated.score - base.score <= 12, "reply-associated evidence raises a posting's score, by at most 12 points", { base, calibrated });
  ok(Object.keys(T.outcomeScoreWeights(history.slice(1), now)).length === 0, "fewer than ten mature applications do not tune weights");
  ok(Object.keys(T.outcomeScoreWeights(history.map((row) => ({ ...row, applied_ms: now - 10 * 86400000 })), now)).length === 0, "applications younger than 21 days do not tune weights");
}
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
const call = async (path, init, e = env) => { const r = await w.fetch(new Request("https://x" + path, init), e, ctxStub); return [r.status, await r.json().catch(() => null), r]; };
{
  const ui = await w.fetch(new Request("https://x/"), env, ctxStub);
  const page = await ui.text();
  ok(ui.status === 200 && page.includes('id="signin"') && page.includes("id='signbox'") && page.includes('id="scode"'), "the real UI keeps sign-in and code entry inline");
}
await w.scheduled({}, env, ctxStub);
await settle();
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
ok((await call("/api/ledger"))[1].facts.length >= 14, "ledger served");
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
await w.scheduled({}, env, ctxStub); await settle();
ok((await call("/api/matches?status=all"))[1].matches[0].status === "rejected" && (await call("/api/matches"))[1].count === 0, "rerun upsert keeps the owner decision and the rejected match stays hidden");
// cooldown
ok((await call("/api/run", { method: "POST" }))[0] === 429, "run cooldown");

// ---------------- JOBSEARCH-OPS-1
{
  // the verified claims of the original ledger (jobsearch/facts.json) are all still in the CV bank seed, word for word (credentials moved to education and certifications)
  const file = JSON.parse(readFileSync(join(here, "../jobsearch/facts.json"), "utf8"));
  const seedFacts = Object.fromEntries(T.BANK_SEED.facts.map((f) => [f.id, f]));
  const moved = file.facts.filter((f) => !f.cluster.includes("credentials") && f.id !== "F15");
  ok(moved.every((f) => seedFacts[f.id] && seedFacts[f.id].text === f.text), "every verified claim of the original ledger is in the CV bank seed", moved.filter((f) => !seedFacts[f.id] || seedFacts[f.id].text !== f.text).map((f) => f.id));
  ok(T.dedupeKey({ company: "A", title: "X  Y", location: "NL" }) === T.dedupeKey({ company: "a", title: "x y", location: "nl" }), "dedupe key normalises");
  ok(T.feedPrefix("greenhouse:anthropic") === "gh:anthropic:" && T.feedPrefix("remotive:data") === "rm:", "feed prefixes");
  ok(["cwi", "deepmind", "tno"].every((slug) => !T.BOARDS.greenhouse.includes(slug)), "Greenhouse feeds with persistent HTTP 404s are excluded");
  ok(["cwi", "deepmind", "tno"].every((slug) => !T.BOARDS.greenhouse.includes(slug)), "Greenhouse feeds with persistent HTTP 404s are excluded");

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
  await w.scheduled({}, env2, ctxStub); await new Promise((r) => setTimeout(r, 4000));
  const st = (i) => db.prepare("SELECT status FROM jobsearch_matches WHERE id=?").get(i)?.status;
  ok(st("gh:anthropic:gone") === "expired", "match gone from an answering feed expires", st("gh:anthropic:gone"));
  ok(st("lv:palantir:keep") === "pending_owner_approval", "a failed feed expires nothing");
  const feed = db.prepare("SELECT * FROM jobsearch_feeds WHERE feed='lever:palantir'").get();
  ok(feed && feed.consecutive_fail >= 1 && /boom/.test(feed.last_error), "feed failure recorded", feed);
  const stuck = db.prepare("SELECT finished_at, errors_json FROM jobsearch_runs WHERE finished_at IS NOT NULL AND errors_json LIKE '%did not finish%'").get();
  ok(!!stuck, "run left open for an hour is closed by the next run");
  for (const feed of ["greenhouse:cwi", "greenhouse:deepmind", "greenhouse:tno"])
    db.prepare("INSERT INTO jobsearch_feeds (feed, last_error, consecutive_fail) VALUES (?, 'HTTP 404', 126)").run(feed);
  const ops = (await call("/api/ops", {}, env2));
  ok(ops[1].checks.length === 8 && ops[1].checks.find((c) => c.fm === "jobsearch-auth-unavailable").ok, "ops report lists 8 checks, auth ok", ops[1].checks.filter((c) => !c.ok));
  ok(ops[1].checks.find((c) => c.fm === "jobsearch-feed-down").ok && ops[1].feeds.filter((f) => !f.active && f.consecutive_fail === 126).length === 3, "retired failing feeds remain visible but do not degrade active feed health");
  ok(ops[1].checks.find((c) => c.fm === "jobsearch-cron-stalled").ok, "ops: cron fresh");
  db.prepare("UPDATE jobsearch_feeds SET consecutive_fail=3 WHERE feed='greenhouse:anthropic'").run();
  const activeFailure = (await call("/api/ops", {}, env2))[1];
  ok(!activeFailure.checks.find((c) => c.fm === "jobsearch-feed-down").ok, "three failures on an active feed still fail the detector");
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
  await w.scheduled({}, envO, ctxStub); await new Promise((r) => setTimeout(r, 4000));
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
  const snapshotWhy = JSON.stringify(["title in your lane: research", "evidence in the posting: ai_systems"]);
  ins.run("snapshot", ago(40), "B", "pending_owner_approval");
  db.prepare("UPDATE jobsearch_matches SET why_json=? WHERE id='snapshot'").run(snapshotWhy);
  const appliedStatus = await call("/api/matches/snapshot/status", { method: "POST", headers: tokHdr, body: JSON.stringify({ status: "applied" }) }, envO);
  const snapshotNote = db.prepare("SELECT note FROM jobsearch_events WHERE match_id='snapshot' AND event='applied'").get()?.note;
  ok(appliedStatus[0] === 200 && T.parseApplicationSnapshot(snapshotNote)?.features.includes("cluster:ai_systems"), "application event captures its score features");
  db.prepare("UPDATE jobsearch_matches SET tier='A', score=99, why_json='[]' WHERE id='snapshot'").run();
  const snapOutcomes = (await call("/api/outcomes", {}, envO))[1];
  ok(snapOutcomes.by_tier.B.applied === 3 && snapOutcomes.by_tier.A.applied === 9, "outcome tiers use the application-time score after later rescoring", snapOutcomes.by_tier);
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


// ---------------- JOBSEARCH-CV-1 (1.5.0): CV bank, decided postings stay decided, learning from reasons, wider net
{
  // keys: one role at one employer, whatever the id, location or bracketed tag
  ok(T.normKey({ company: "Adyen N.V.", title: "Senior Product Manager (Amsterdam)" }) === T.normKey({ company: "adyen", title: "senior product manager [remote]" }), "normKey ignores legal suffix, brackets and case");
  ok(T.normKey({ company: "Adyen", title: "Senior Product Manager" }) !== T.normKey({ company: "Adyen", title: "Product Manager" }), "normKey keeps different roles apart");
  // wider net: stated preferences become a stretch label, hard noise stays out
  const tokyo = { ...JOB, location: "Tokyo, Japan", title: "Senior Policy Advisor" };
  const wideT = T.evaluate(tokyo, T.makeCtx({}), true);
  ok(T.evaluate(tokyo, T.makeCtx({})).status === "excluded" && wideT.status === "ok" && wideT.tier === "C" && wideT.flags.some((f) => f.startsWith("OUTSIDE YOUR PREFERENCES")), "wide mode keeps a role outside the stated places as a flagged stretch", wideT);
  ok(T.evaluate({ ...JOB, title: "Sales Lead, Research" }, T.makeCtx({}), true).status === "excluded", "wide mode still drops hard noise");
  ok(T.evaluate({ ...JOB, location: "Remote - US only" }, T.makeCtx({}), true).status === "excluded", "wide mode still drops postings that restrict residence");
  const eng = { ...JOB, title: "Research Engineer, Evaluations", desc: JOB.desc };
  ok(T.evaluate(eng, T.makeCtx({}), true).status === "ok" && T.evaluate(eng, T.makeCtx({})).status === "excluded", "a research-engineering title passes in wide mode when the posting matches the record");
  ok(T.evaluate({ ...eng, desc: "We build code." }, T.makeCtx({}), true).status === "excluded", "an engineering title with no evidence in the posting stays out");
  ok(T.evaluate({ ...JOB, title: "Staff Engineer, Research Platform" }, T.makeCtx({}), true).status === "excluded", "a plain engineer title stays out");
  const [kept, ex] = T.rank([tokyo, { ...JOB, id: "t:2", title: "Receptionist" }], T.makeCtx({}), true);
  ok(kept.length === 1 && kept[0].match.tier === "C", "rank keeps stretch matches in wide mode", { kept: kept.length, ex });
  // evidence the CV lacks counts for less and is named
  const physDesc = JOB.desc + " Theoretical physics, renormalization, effective field theory.";
  const withCv = T.scoreJob({ ...JOB, desc: physDesc }, T.makeCtx({}, [], {}, new Set(["research_mgmt"])));
  const fullCv = T.scoreJob({ ...JOB, desc: physDesc }, T.makeCtx({}, [], {}, new Set(["research_mgmt", "ai_systems", "research_integrity", "federal", "policy_research", "physics_theory"])));
  ok(withCv.why.some((x) => x.startsWith("not in your CV yet") && x.includes("physics_theory")) && fullCv.score > withCv.score, "evidence the CV cannot back up scores lower and is listed", { a: withCv.score, b: fullCv.score });
  // learning from reasons
  const fb = (title, company, reason, verdict = "dislike") => ({ title, company, verdict, reason });
  ok(T.makeCtx({}, [fb("Senior Widget Specialist", "Acme", "field")]).learned.block.has("widget"), "one 'wrong field' rejection blocks the title words");
  ok(!T.makeCtx({}, [fb("Senior Widget Specialist", "Acme", "level")]).learned.block.has("widget"), "a 'wrong level' rejection teaches nothing about the words");
  const c2 = T.makeCtx({}, [fb("A one", "Adyen", "other"), fb("B two", "Adyen N.V.", "other")]);
  ok(c2.learned.coPen.has("adyen") && !c2.learned.coDrop.has("adyen"), "two rejections at one employer penalise it");
  ok(T.makeCtx({}, [fb("A", "Adyen", "company")]).learned.coPen.has("adyen"), "'not this employer' penalises at once");
  ok(T.makeCtx({}, [fb("A", "Adyen", "company"), fb("B", "Adyen", "other")]).learned.coDrop.has("adyen"), "enough rejections drop the employer");
  ok(!T.makeCtx({}, [fb("A", "Adyen", "applied"), fb("B", "Adyen", "applied")]).learned.coPen.has("adyen"), "'already handled' is not a dislike of the employer");
  const adyen = { ...JOB, company: "Adyen", title: "Senior Policy Advisor" };
  ok(T.evaluate(adyen, T.makeCtx({}, [fb("A", "Adyen", "company"), fb("B", "Adyen", "other")])).status === "excluded", "a dropped employer's roles are excluded");
}
{
  // decided postings never come back under another id; the owner's decision outlives retention; pending twins are not listed twice
  const E = { ...env, LOOP_TOKEN: "secret-test-token" };
  db.prepare("DELETE FROM jobsearch_matches").run(); db.prepare("DELETE FROM jobsearch_feedback").run(); db.prepare("DELETE FROM jobsearch_runs").run();
  const ins = db.prepare("INSERT INTO jobsearch_matches (id, first_seen, last_seen, company, title, location, url, tier, score, why_json, flags_json, verified, status) VALUES (?1, ?2, ?2, 'OpenAI', 'Research Program Manager, Frontier Assurance', 'Amsterdam', 'u', 'A', 80, '[]', '[]', 1, ?3)");
  ins.run("ab:openai:older", new Date(Date.now() - 100 * 86400000).toISOString(), "rejected");
  globalThis.fetch = async (u) => {
    const j = (o) => new Response(JSON.stringify(o), { status: 200 });
    if (u.includes("api.ashbyhq.com/posting-api/job-board/openai")) return j({ jobs: [{ id: "reposted", title: "Research Program Manager, Frontier Assurance", location: "Amsterdam", jobUrl: "https://jobs/re", descriptionPlain: JOB.desc }, { id: "fresh", title: "Research Operations Lead, Safety", location: "Amsterdam", jobUrl: "https://jobs/fresh", descriptionPlain: JOB.desc }] });
    return j(u.includes("lever") ? [] : { jobs: [], data: [] });
  };
  await w.scheduled({}, E, ctxStub); await settle();
  const ids = db.prepare("SELECT id, status FROM jobsearch_matches ORDER BY id").all();
  ok(!ids.some((r) => r.id === "ab:openai:reposted") && ids.some((r) => r.id === "ab:openai:fresh"), "a rejected role reposted under a new id is not listed again; a new role is", ids);
  const run1 = db.prepare("SELECT excluded_json FROM jobsearch_runs ORDER BY id DESC LIMIT 1").get();
  ok(/already decided or already listed/.test(run1.excluded_json), "the run reports how many were suppressed", run1.excluded_json);
  // the rejected row survives retention (only its drafts are dropped)
  db.prepare("UPDATE jobsearch_matches SET resume_md='r', note_md='n' WHERE id='ab:openai:older'").run();
  db.prepare("UPDATE jobsearch_runs SET started_at=? WHERE id=(SELECT MAX(id) FROM jobsearch_runs)").run(new Date(Date.now() - 3600000).toISOString());
  await w.scheduled({}, E, ctxStub); await settle();
  const old = db.prepare("SELECT status, resume_md FROM jobsearch_matches WHERE id='ab:openai:older'").get();
  ok(old && old.status === "rejected" && old.resume_md === null, "a rejected row is kept for good, only its drafts are cleared", old);
  // a pending twin under another id is not listed twice
  db.prepare("INSERT INTO jobsearch_matches (id, first_seen, last_seen, company, title, location, url, tier, score, why_json, flags_json, verified, status) VALUES ('ab:openai:twin', ?1, ?1, 'OpenAI', 'Research Operations Lead, Safety', 'Amsterdam', 'u', 'A', 80, '[]', '[]', 1, 'pending_owner_approval')").run(new Date().toISOString());
  db.prepare("DELETE FROM jobsearch_matches WHERE id='ab:openai:fresh'").run();
  db.prepare("UPDATE jobsearch_runs SET started_at=? WHERE id=(SELECT MAX(id) FROM jobsearch_runs)").run(new Date(Date.now() - 3600000).toISOString());
  await w.scheduled({}, E, ctxStub); await settle();
  ok(db.prepare("SELECT COUNT(*) AS n FROM jobsearch_matches WHERE title LIKE 'Research Operations Lead%'").get().n === 1, "a pending role already listed under another id is not stored twice");
  // the list filters by status in SQL, so rejected rows cannot push live ones out of the window
  const lst = (await call("/api/matches", {}, E))[1];
  ok(lst.matches.every((x) => x.status !== "rejected"), "the default list hides rejected matches");
  // rejection with a reason is stored and validated
  const tkn = { "x-loop-token": "secret-test-token", "content-type": "application/json" };
  const rid = lst.matches[0].id;
  const refused = await call("/api/matches/" + encodeURIComponent(rid) + "/status", { method: "POST", headers: tkn, body: JSON.stringify({ status: "rejected", reason: "because" }) }, E);
  const stored = await call("/api/matches/" + encodeURIComponent(rid) + "/status", { method: "POST", headers: tkn, body: JSON.stringify({ status: "rejected", reason: "field" }) }, E);
  ok(refused[0] === 400 && stored[0] === 200 && db.prepare("SELECT reason FROM jobsearch_feedback ORDER BY id DESC LIMIT 1").get().reason === "field", "a rejection stores its reason; an unknown reason is refused", [refused[0], stored[0]]);
  globalThis.fetch = realFetch;
}
{
  // new fetchers tolerate odd answers
  globalThis.fetch = async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 });
  ok((await T.FETCHERS.remoteok()).length === 0 && (await T.FETCHERS.himalayas(2)).length === 0 && (await T.FETCHERS.hn()).length === 0 && (await T.FETCHERS.recruitee("x")).length === 0, "the new fetchers return nothing on an unexpected answer");
  globalThis.fetch = async (u) => {
    if (u.includes("search_by_date")) return new Response(JSON.stringify({ hits: [{ title: "Ask HN: Who is hiring? (November 2026)", objectID: "99" }] }), { status: 200 });
    if (u.includes("story_99")) return new Response(JSON.stringify({ hits: [
      { objectID: "1", parent_id: 99, comment_text: "Acme | Research Scientist | Amsterdam, NL | ONSITE<p>We study things." },
      { objectID: "2", parent_id: 5, comment_text: "reply" }, { objectID: "3", parent_id: 99, comment_text: "just a sentence" }] }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  const hn = await T.FETCHERS.hn();
  ok(hn.length === 1 && hn[0].company === "Acme" && hn[0].title === "Research Scientist" && /Amsterdam/.test(hn[0].location) && hn[0].url.endsWith("id=1"), "Hacker News 'Who is hiring' comments become postings", hn);
  globalThis.fetch = realFetch;
}
{
  // the CV bank: interview, review, edit, lock, backup, resume per job
  const E = { ...env, LOOP_TOKEN: "secret-test-token" };
  const H = { "x-loop-token": "secret-test-token", "content-type": "application/json" };
  const cv = (path, body) => call(path, { method: "POST", headers: H, body: JSON.stringify(body) }, E);
  ok((await call("/api/cv", {}, E))[0] === 401 && (await call("/api/cv/answer", { method: "POST", body: "{}" }, E))[0] === 401 && (await call("/api/cv/export", {}, E))[0] === 401, "the CV API needs the owner's sign-in");
  const st0 = (await call("/api/cv", { headers: H }, E))[1];
  ok(st0.questions.length === 43 && st0.roles.length === 11 && st0.review.length === 3 && st0.facts.length === 14, "the CV starts from the verified record: 11 roles, 14 achievements, 3 claims to review", { q: st0.questions.length, r: st0.roles.length, v: st0.review.length, f: st0.facts.length });
  ok(!JSON.stringify(st0.facts).includes("10M") && !JSON.stringify(st0.facts).includes("patent"), "unconfirmed claims are not in the record");
  ok((await cv("/api/cv/answer", { qid: "nope", answer: "y" }))[0] === 400 && (await cv("/api/cv/answer", { qid: "phys_renorm", answer: "maybe" }))[0] === 400, "bad interview input refused");
  const a1 = await cv("/api/cv/answer", { qid: "phys_renorm", answer: "y", facts: [{ text: "Applied dimensional regularization and renormalization in a quantum field theory thesis calculation.", role: "R999" }] });
  const st1 = (await call("/api/cv", { headers: H }, E))[1];
  const nf = st1.facts.find((f) => f.source === "interview:phys_renorm");
  ok(a1[0] === 200 && nf && nf.role === "" && nf.tags.includes("physics_theory") && st1.questions.find((q) => q.id === "phys_renorm").answer === "y", "a yes answer stores the owner's own sentence under the question's tags; an unknown role becomes none", nf);
  ok(!JSON.stringify((await call("/api/ledger", {}, E))[1]).includes("dimensional regularization"), "the public ledger never shows what the owner adds in the interview");
  const qft = { ...JOB, title: "Research Scientist, Theoretical Physics", location: "Amsterdam", desc: "Theoretical physics: quantum field theory, renormalization, effective field theory, statistical mechanics. Research scientist." };
  const qm = T.evaluate(qft), qres = T.buildResume(qft, qm), qbad = T.verify(qres, qft);
  ok(qres.includes("dimensional regularization") && qbad.length === 0, "the owner's new achievement reaches the resume and the resume still verifies", qbad);
  ok(T.verify(qres.replace("dimensional regularization", "dimensional reguralization"), qft).length > 0, "an altered sentence is rejected");
  ok(/^## Experience/m.test(qres) && /\*\*Founder\*\*, QNFO/.test(qres) && /## Selected work/.test(qres) && /## Education/.test(qres) && /## Skills/.test(qres) && /## Earlier roles/.test(qres), "the resume has roles with titles, selected work, education, skills and earlier roles");
  ok(T.verify(qres.replace("**Founder**", "**Chief Founder**"), qft).length > 0 && T.verify(qres.replace(/· Python/, "· Haskell"), qft).length > 0, "a changed role title or an invented skill is rejected");
  // review: confirm needs the bracket filled, reject removes
  ok((await cv("/api/cv/review", { id: "V3", action: "confirm" }))[0] === 400, "a claim with a bracketed gap cannot be confirmed as it stands");
  ok((await cv("/api/cv/review", { id: "V3", action: "confirm", text: "Inventor on U.S. patent 1,234,567 in quantum computing." }))[0] === 200, "a filled-in claim can be confirmed");
  ok((await cv("/api/cv/review", { id: "V1", action: "reject" }))[0] === 200 && (await call("/api/cv", { headers: H }, E))[1].review.length === 1, "a rejected claim is removed from review");
  // edit sections
  ok((await cv("/api/cv/set", { roles: [{ id: "R1", title: "", org: "x", start: "2020", end: "present" }] }))[0] === 400, "a role without a title is refused");
  ok((await cv("/api/cv/set", { summary: "New summary.", education: ["A", "", "B"], person: { location: "Utrecht, Netherlands" } }))[0] === 200, "summary, lists and contact can be edited");
  const st2 = (await call("/api/cv", { headers: H }, E))[1];
  ok(st2.summary === "New summary." && st2.education.length === 2 && st2.person.location === "Utrecht, Netherlands", "edits persist", st2.education);
  ok(T.buildResume(JOB, T.evaluate(JOB)).includes("New summary.") && T.verify(T.buildResume(JOB, T.evaluate(JOB)), JOB).length === 0, "resumes use the edited CV and verify");
  // backup and restore
  const exp = await call("/api/cv/export", { headers: H }, E);
  ok(exp[0] === 200 && exp[1].version === 2 && exp[1].facts.length === st2.facts.length, "export returns the whole CV");
  ok((await cv("/api/cv/import", { version: 1 }))[0] === 400, "a file that is not a CV export is refused");
  ok((await cv("/api/cv/set", { summary: "Changed after backup." }))[0] === 200 && (await cv("/api/cv/import", exp[1]))[0] === 200 && (await call("/api/cv", { headers: H }, E))[1].summary === "New summary.", "restoring a backup brings the CV back");
  ok(db.prepare("SELECT COUNT(*) AS n FROM jobsearch_bank_history").get().n >= 5, "every change keeps the previous version");
  // optimistic lock: a write that loses the race re-reads and re-applies; a write that always loses fails with 409
  let tries = 0;
  const done = await T.mutateBank(E, (b) => { tries++; if (tries === 1) db.prepare("UPDATE jobsearch_bank SET rev = rev + 1").run(); b.summaries[0].text = "Merged after a conflict."; return b; });
  ok(tries === 2 && done.summaries[0].text === "Merged after a conflict.", "a conflicting write is retried on fresh data", tries);
  let always = 0, err;
  try { await T.mutateBank(E, (b) => { always++; db.prepare("UPDATE jobsearch_bank SET rev = rev + 1").run(); return b; }); } catch (e) { err = e; }
  ok(err && err.status === 409 && always === 4, "a write that keeps losing fails with 409, not a silent overwrite", { always, err: err && err.message });
  // history + gaps through "check a job"
  globalThis.fetch = realFetch;
  const an = await cv("/api/analyze", { input: "Research Scientist, Quantum. Quantum field theory and Monte Carlo simulation, python. Amsterdam.", title: "Research Scientist", company: "Acme", location: "Amsterdam" });
  ok(an[0] === 200 && Array.isArray(an[1].cv_gaps) && an[1].draft.resume, "check a job returns CV gaps and a draft", an[1] && an[1].error);
  const hist = (await call("/api/cv/history", { headers: H }, E))[1];
  ok(hist.items.length >= 1 && (await call("/api/cv/history/" + hist.items[0].id, { headers: H }, E))[1].resume_md.includes("Experience"), "a built resume is kept in history");
  const page = await call("/cv", {}, E);
  ok(page[2].headers.get("content-type").includes("text/html"), "the CV page is served");
}

globalThis.fetch = realFetch;
console.log(`qnfo-jobsearch: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
