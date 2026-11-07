// COST-COMPANION-1 offline suite (personal-companion, charter pillar: cost; breach metrics workers_ai_cost_30d_usd, fleet_cost_pace_30d_usd).
// Measured 2026-11-04 from the AI Gateway logs and qnfo-audit: the companion spent about 18k neurons on every hourly tick (a deepseek-v4-pro
// writer call and a fact-check panel) while its 24 hour accept rate sat at 3 to 5 percent, and glm-5.3 answered every fact-check with 8000
// completion tokens and no parseable verdict (about 3.8k neurons a call, never an error in ai_call_counters, so REVIEWER-HEALTH-1 never
// demoted it). Proves: (1) a reply without a verdict is counted as one error in the reviewer's counter row, a valid verdict is not;
// (2) three such calls make sickReviewers ask the reviewer last; (3) while the accept rate is collapsed (at least 8 attempts, under 10
// percent) the retry waits COLLAPSE_RETRY_MIN_MS after the last finished attempt, otherwise it is unchanged; (4) an accepted piece or fewer
// than 8 attempts leaves the hourly retry as it was.
// Run: node personal-companion/cost-companion.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { importWorker } from "./_harness-import-worker.mjs";
const IMPORT = 'import { WorkflowEntrypoint } from "cloudflare:workers";';
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mod = await importWorker(() => (src.replace(IMPORT, "var WorkflowEntrypoint = class {};") + "\n//" + Math.random()), new URL("./", import.meta.url));
const V = mod.__verify;
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 600) : "")); } };
const GLM = "@cf/zai-org/glm-5.3";
const KIMI = "@cf/moonshotai/kimi-k2.6";
const PASS = '{"unsupported":[],"verdict":"pass"}';
const day = new Date().toISOString().slice(0, 10);

// ---- (1) a reply with no verdict is one error in the counter row ---------------------------------------------------------------------
function envWith(replies) {
  const writes = [];
  const AUDIT = { prepare: (sql) => ({ run: async () => ({}), bind: (...a) => ({ run: async () => { writes.push({ sql, a }); return {}; }, all: async () => ({ results: [] }) }) }) };
  const notes = () => writes.filter((x) => /INSERT INTO ai_call_counters/.test(x.sql) && /DO UPDATE SET errors = errors \+ 1/.test(x.sql));
  const AI = { run: async (model) => { const r = replies[model]; if (r instanceof Error) throw r; return { response: r }; } };
  return { env: { AI, AUDIT }, writes, notes };
}
{
  const w = envWith({ [GLM]: "Let me think about this draft carefully. First, the source says", [KIMI]: PASS });
  const a = await V.factCheckOne(w.env, GLM, "# Title\n\nA draft.", "source text");
  await new Promise((r) => setTimeout(r, 20));
  ok(a.failed === true && /no verdict in reply/.test(a.error), "a truncated reasoning reply is a failed review", a);
  const notes = w.notes().filter((x) => /'factcheck'/.test(x.sql));
  ok(notes.length === 1 && notes[0].a[0] === day && notes[0].a[1] === GLM, "the empty reply is counted once for the reviewer and the UTC day", notes);
  ok(/calls, errors/.test(notes[0].sql) && /,0,1,0,0,0,0,0\)/.test(notes[0].sql) && /DO UPDATE SET errors = errors \+ 1/.test(notes[0].sql), "the note adds one error and no call (aiRunAttr adds the call)", notes[0].sql);

  const w2 = envWith({ [KIMI]: PASS });
  const b = await V.factCheckOne(w2.env, KIMI, "# Title\n\nA draft.", "source text");
  await new Promise((r) => setTimeout(r, 20));
  ok(!b.failed && b.verdict === "pass" && w2.notes().length === 0, "a valid verdict writes no error", { b, notes: w2.notes().length });

  const w3 = envWith({ [GLM]: new Error("model down") });
  const c = await V.factCheckOne(w3.env, GLM, "# Title\n\nA draft.", "source text");
  ok(c.failed === true && w3.notes().length === 0, "a thrown call is left to aiRunAttr, not double counted", { c, notes: w3.notes().length });

  // no database bound: nothing throws
  const d = await V.factCheckOne({ AI: { run: async () => ({ response: "no json here" }) } }, GLM, "# T\n\nbody", "s");
  ok(d.failed === true, "without an audit database the note is skipped and the review still fails closed", d);
}

// ---- (2) three empty replies in a day demote the reviewer ---------------------------------------------------------------------------
{
  const rows = [{ model: GLM, calls: 3, errors: 3 }, { model: KIMI, calls: 6, errors: 0 }];
  const AUDIT = { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) };
  const s = await V.sickReviewers({ AUDIT });
  ok(s[GLM] === 1 && !s[KIMI], "after three empty replies the reviewer is sick and asked last, a healthy one is not", s);
}

// ---- (3)/(4) the collapsed-day retry brake ------------------------------------------------------------------------------------------
function personal(attempts, lastAgoMs) {
  const rows = attempts.map((status) => ({ status }));
  return { prepare: (sql) => ({ bind: () => ({}), all: async () => ({ results: rows }), first: async () => (/ORDER BY id DESC LIMIT 1/.test(sql) ? { run_at: new Date(Date.now() - lastAgoMs).toISOString() } : null) }) };
}
const MIN = 60000;
{
  ok(V.COLLAPSE_RETRY_MIN_MS >= 100 * MIN && V.COLLAPSE_RETRY_MIN_MS <= 170 * MIN, "the brake holds about three hourly ticks (between 100 and 170 minutes)", V.COLLAPSE_RETRY_MIN_MS);
  const collapsed = ["failed", "rejected", "rejected", "failed", "rejected", "rejected", "failed", "rejected", "rejected", "failed", "rejected", "rejected"];
  ok(await V.collapsedRetryHold({ PERSONAL: personal(collapsed, 50 * MIN) }) === true, "collapsed day, last attempt 50 minutes ago: the next hourly tick waits");
  ok(await V.collapsedRetryHold({ PERSONAL: personal(collapsed, 110 * MIN) }) === true, "collapsed day, last attempt 110 minutes ago: the second tick waits too");
  ok(await V.collapsedRetryHold({ PERSONAL: personal(collapsed, 170 * MIN) }) === false, "collapsed day, last attempt 170 minutes ago: the third tick retries");
  const fewer = ["failed", "rejected", "rejected", "failed"];
  ok(await V.collapsedRetryHold({ PERSONAL: personal(fewer, 10 * MIN) }) === false, "under 8 attempts is not a collapse: the hourly retry is unchanged");
  const healthy = ["ok", "rejected", "failed", "rejected", "ok", "rejected", "failed", "ok", "rejected", "rejected"];
  ok(await V.collapsedRetryHold({ PERSONAL: personal(healthy, 10 * MIN) }) === false, "a 30 percent accept rate is not a collapse: the hourly retry is unchanged");
  const nine = ["ok", "rejected", "rejected", "rejected", "failed", "rejected", "rejected", "rejected", "rejected", "failed"]; // 10 percent exactly
  ok(await V.collapsedRetryHold({ PERSONAL: personal(nine, 10 * MIN) }) === false, "exactly 10 percent accepted is not under the steward's collapse bar");
}

// the retry decision itself: a failed last run, no run in progress, the last accepted piece old: due, unless the brake holds
function retryEnv(attempts, lastAgoMs) {
  const rows = attempts.map((status) => ({ status }));
  return { PERSONAL: { prepare: (sql) => ({
    bind: () => ({ first: async () => (/COUNT\(\*\) n FROM companion_runs/.test(sql) ? { n: 0 } : null) }),
    all: async () => ({ results: rows }),
    first: async () => {
      if (/status IN \('ok','failed','blocked','error'\) AND form <> 'steward' ORDER BY id DESC LIMIT 1/.test(sql) && /SELECT status, run_at/.test(sql)) return { status: "failed", run_at: new Date(Date.now() - lastAgoMs).toISOString() };
      if (/status = 'ok' AND form <> 'steward'/.test(sql)) return { run_at: new Date(Date.now() - 20 * 36e5).toISOString() };
      if (/status IN \('ok','failed','rejected','blocked','error'\) AND form <> 'steward'/.test(sql)) return { run_at: new Date(Date.now() - lastAgoMs).toISOString() };
      return null;
    } }) } };
}
{
  const collapsed = ["failed", "rejected", "rejected", "failed", "rejected", "rejected", "failed", "rejected", "rejected", "failed"];
  ok(await V.starvedRetryDue(retryEnv(collapsed, 60 * MIN)) === false, "starvedRetryDue: a collapsed day does not retry 60 minutes after the last attempt");
  ok(await V.starvedRetryDue(retryEnv(collapsed, 180 * MIN)) === true, "starvedRetryDue: a collapsed day retries once the last attempt is 180 minutes old");
  const healthy = ["ok", "rejected", "failed", "rejected", "ok", "rejected", "failed", "ok", "rejected", "rejected"];
  ok(await V.starvedRetryDue(retryEnv(healthy, 60 * MIN)) === true, "starvedRetryDue: an ordinary failed run is still retried on the next hourly tick");
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
