/**
 * performance.test.mjs -- offline regression lock for PERFORMANCE-LOOP-1 (qnfo-fleet-control 0.4.91).
 * Slices the PERFORMANCE-LOOP-1 block out of worker.js and proves, with synthetic facts:
 *   - the five KPIs: a KPI whose inputs are missing, stale or too thin is UNMEASURED with its reason, never 0, and its
 *     registry text carries no digit a reader could parse;
 *   - lever bounds: min/max/step, the STRATEGY cap on an owner-voice lever (none means it never moves), the q08 review lock;
 *   - the experiment plan: a lever moves only when a trigger names it, watches the lever's metric, is hit now and on 3
 *     consecutive metric_history days and asks for the direction the lever moves; one per metric and per lever, 3
 *     fleet-wide, a 7-day cooldown per lever, the kill switch stops starts only;
 *   - keep or revert on the noise threshold max(5% of |baseline|, one baseline sd), with a grace period;
 * then replays the hourly tick against an in-memory SQLite D1 (node:sqlite, Node 22+) carrying the live guard triggers,
 * with METRIC-CLOSED-LOOP-1's migration and migrations/2026-10-02-performance-loop.sql applied: compare-and-swap writes on
 * ops_config, keep, revert (row deleted when the knob was absent), superseded, the once-a-day ledger, unreadable inputs
 * write no ledger row, and remedy_efficacy_30d counting kept and reverted experiments.
 * Output MUST contain "0 failed" on success; charter-guard.yml greps for exactly that string.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const BEGIN = "// ---- PERFORMANCE-LOOP-1:BEGIN", END = "// ---- PERFORMANCE-LOOP-1:END ----";
const a = src.indexOf(BEGIN), b = src.indexOf(END);
if (a < 0 || b < 0 || b < a) { console.error("FAIL PERFORMANCE-LOOP-1 block markers missing"); console.log("1 failed"); process.exit(1); }
const sandbox = { VERSION: "test-perf", console, Date, Math, JSON, Number, String, Object, Array, RegExp, isNaN, isFinite, __export: null };
vm.createContext(sandbox);
vm.runInContext(src.slice(a, b + END.length) + "\n__export = { perfNumStrict, perfNaText, perfMttr, perfDeployFail, perfWorkerHealth, perfCredibility, perfCitationCoverage, perfMetricsEvaluate, perfLeverBounds, perfLeverValue, perfExperimentPlan, perfDecideExperiment, perfBreachStreak, perfEnabled, performanceLoopTick, perfExperimentsStatus, PERF_LEVERS, PERF_METRICS, PERF_STRATEGY_CAPS, PERF_SELECTED_DOIS, PERF_DDL };", sandbox, { filename: "performance-block.js" });
const P = sandbox.__export;
const migDir = join(here, "..", "migrations");

let passed = 0, failed = 0;
function eq(actual, expected, label) { if (actual === expected) { passed++; return; } failed++; console.error(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`); }
function ok(cond, label) { eq(!!cond, true, label); }
// CI-TEST-CLOCKS-1 (2026-10-20): NOW was the literal 2026-10-20T10:00:00Z, written when that day was still ahead. The ledger section below judges
// remedy_efficacy_30d with SQL on the real clock and re-dates the first decision to real yesterday with realIso(); "day 23" is NOW + 23 days and the
// lever rests PERF_EXP_COOLDOWN_D = 7 days after a decision, so from the real day 2026-11-07 (NOW + 18 days) the re-dated decision was under 7 days
// before "day 23" and the second step never started (seven assertions failed). NOW is now 10:00Z of the real day, so the pinned clock and the
// real one stay within a day of each other whenever the suite runs.
const NOW = (() => { const d = new Date(); d.setUTCHours(10, 0, 0, 0); return d.getTime(); })();
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const day = (n, base) => dayOf((base || NOW) - n * 864e5);
const h = (n, base) => new Date((base || NOW) - n * 36e5).toISOString();
const noDigits = (s) => !/\d/.test(String(s));

// --- strict numbers and digit-free n/a texts ---------------------------------------------------------------------
eq(P.perfNumStrict("59.82"), 59.82, "a plain number parses");
eq(P.perfNumStrict("+5.7%"), 5.7, "a signed percentage parses");
eq(P.perfNumStrict("n/a: prior window has 27 of 30 days"), null, "a reason with digits is not a number");
eq(P.perfNumStrict(null), null, "null is not a number");
ok(noDigits(P.perfNaText("OpenAlex readings cover 3 of the 7 selected works in 90 days (needs 4)")), "the registry n/a text carries no digit");
ok(/^n\/a: /.test(P.perfNaText("x")), "the registry n/a text starts with n/a");

// --- issue MTTR ---------------------------------------------------------------------------------------------------
const closed = (hours) => hours.map((x) => ({ created_at: NOW - x * 36e5 - 864e5, updated_at: NOW - 864e5 }));
let r = P.perfMttr({ closed_issues: closed([1, 2, 3, 4, 5, 6, 7, 8, 9]) });
eq(r.value, null, "9 closures: unmeasured");
ok(/9 issues closed/.test(r.why), "the reason names the count");
r = P.perfMttr({ closed_issues: closed([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100]) });
eq(r.value, 6, "the median of 11 closures");
eq(r.detail.closed_30d, 11, "the sample size is reported");
eq(P.perfMttr({}).value, null, "unreadable issues: unmeasured");
eq(P.perfMttr({ closed_issues: [{ created_at: NOW, updated_at: NOW - 36e5 }].concat(closed([1, 1, 1, 1, 1, 1, 1, 1, 1])) }).value, null, "a close before its creation is dropped, leaving 9");

// --- deploy failure rate --------------------------------------------------------------------------------------------
eq(P.perfDeployFail({ deploys: [{ worker: "a", n: 19, okn: 19 }] }).value, null, "19 deploys: unmeasured");
r = P.perfDeployFail({ deploys: [{ worker: "a", n: 80, okn: 76 }, { worker: "b", n: 20, okn: 20 }] });
eq(r.value, 0.04, "4 failed of 100");
eq(r.detail.dominant, "a", "one worker with every failure dominates");
r = P.perfDeployFail({ deploys: [{ worker: "a", n: 50, okn: 48 }, { worker: "b", n: 50, okn: 47 }, { worker: "c", n: 50, okn: 47 }] });
eq(r.detail.dominant, null, "no worker with half the failures: none dominates");
eq(P.perfDeployFail({ deploys: null }).value, null, "unreadable ledger: unmeasured");

// --- worker health ------------------------------------------------------------------------------------------------
const wla = (w, http, note, ageH) => ({ worker: w, http, note, probed_at: new Date(NOW - ageH * 36e5).toISOString().replace("T", " ").slice(0, 19) });
r = P.perfWorkerHealth({ live_audit: [wla("a", 200, "SYNC", 1), wla("b", null, "CRON_ONLY", 1), wla("c", 500, "DOWN", 1), wla("d", 404, "NOT_DEPLOYED", 1), wla("e", 404, "NOT_A_WORKER", 1), wla("retired", 410, "TOMBSTONE_410 selfstate-probe http up=retired", 1)] }, NOW);
eq(r.value, 0.3333, "one failing of three live (CRON_ONLY is healthy; NOT_DEPLOYED and NOT_A_WORKER are not live)");
eq(r.detail.failing.join(), "c", "the failing worker is named");
r = P.perfWorkerHealth({ live_audit: [wla("a", 200, "SYNC", 1), wla("b", null, "CRON_ONLY", 1), wla("c", 500, "DOWN", 1), wla("no-health", 404, "UNMANAGED_NO_HEALTH", 1), wla("retired", 410, "TOMBSTONE_410 selfstate-probe http up=retired", 1)] }, NOW);
eq(r.value, 0.5, "a retired tombstone is excluded, while an unmanaged worker without /health remains a live failure");
eq(r.detail.live, 4, "only active workers contribute to the health rate denominator");
eq(r.detail.failing.join(), "c,no-health", "both live health failures remain visible");
ok(P.PERF_METRICS.find((m) => m.metric === "worker_health_failure_rate").formula.includes("TOMBSTONE_"), "the registered metric formula documents retired tombstone exclusion");
eq(P.perfWorkerHealth({ live_audit: [wla("a", 200, "SYNC", 30)] }, NOW).value, null, "a live audit over 26h old: unmeasured");
eq(P.perfWorkerHealth({ live_audit: [wla("d", 404, "NOT_DEPLOYED", 1)] }, NOW).value, null, "no live worker: unmeasured");

// --- credibility events and citation coverage -----------------------------------------------------------------------
const D = P.PERF_SELECTED_DOIS;
for (let i = 1; i <= 7; i++) D.push("10.9999/selected." + i); // fixture identifiers: the production list is empty (NOZ-DOI-1)
const cite = (doi, value, ageD) => ({ doi, value, collected_at: new Date(NOW - ageD * 864e5).toISOString() });
r = P.perfCredibility({ selected_citations: [cite(D[0], 0, 30), cite(D[0], 0, 1), cite(D[1], 0, 1), cite(D[2], 0, 1)], mentions: [], attested: null }, NOW);
eq(r.value, null, "3 of 7 selected works covered and nothing attested: unmeasured, not 0");
ok(/3 of the 7/.test(r.why), "the reason names the coverage");
r = P.perfCredibility({ selected_citations: [cite(D[0], 1, 60), cite(D[0], 3, 1), cite(D[1], 0, 1), cite(D[2], 0, 1), cite(D[3], 2, 1)], mentions: [{ source: "bluesky", author: "someone.bsky.social" }, { source: "datacite", author: "Univ X" }, { source: "crossref", author: "qnfo.org" }], attested: null }, NOW);
eq(r.value, 3, "2 new citations + 1 non-social third-party mention (own author excluded, social not counted)");
eq(r.detail.social_mentions_not_counted, 1, "the social mention is listed");
r = P.perfCredibility({ selected_citations: [cite(D[0], 2, 30), cite(D[0], 2, 1), cite(D[1], 0, 1), cite(D[2], 0, 1), cite(D[3], 0, 1)], mentions: [{ source: "openalex-citation", author: "", title: "cited_by_count=2 for " + D[0] }], attested: null }, NOW);
eq(r.value, 0, "CREDIBILITY-CITATION-DEDUPE-1: an openalex-citation mention row is not a second count of the citation term (2026-10-05 self-citation read 1)");
eq(r.detail.citation_mentions_not_counted, 1, "the citation mention row is listed, not counted");
r = P.perfCredibility({ selected_citations: [cite(D[0], 1, 60), cite(D[0], 3, 1), cite(D[1], 0, 1), cite(D[2], 0, 1)], mentions: [{ source: "openalex-citation", author: "" }, { source: "datacite", author: "Univ X" }], attested: null }, NOW);
eq(r.value, null, "coverage rules unchanged: 3 of 7 tracked and nothing attested stays unmeasured");
r = P.perfCredibility({ selected_citations: [], mentions: [], attested: { value: "2", updated_at: h(48) } }, NOW);
eq(r.value, 2, "an attested count stands when coverage is thin");
r = P.perfCredibility({ selected_citations: [cite(D[0], 0, 1), cite(D[1], 0, 1), cite(D[2], 0, 1), cite(D[3], 0, 1)], mentions: [], attested: { value: "1", updated_at: h(100 * 24) } }, NOW);
eq(r.value, 0, "an attestation older than 90 days is ignored; four covered works with no event read 0");
eq(P.perfCredibility({ selected_citations: null, mentions: [] }, NOW).value, null, "unreadable citations: unmeasured");
r = P.perfCitationCoverage({ selected_recent: [{ doi: D[0] }, { doi: D[1].toUpperCase() }, { doi: "10.9999/other.1" }], citations_last: h(5) }, NOW);
eq(r.value, 2, "two selected works in the last 3 days (case-insensitive, others ignored)");
eq(r.detail.missing.length, 5, "the five missing works are listed");
eq(P.perfCitationCoverage({ selected_recent: [], citations_last: h(80) }, NOW).value, null, "a collection over 72h old: unmeasured");
const rs = P.perfMetricsEvaluate({}, NOW);
eq(rs.length, 5, "five KPIs");
ok(rs.every((x) => x.value === null && x.state === "UNMEASURED" && noDigits(x.registry_value)), "empty facts: every KPI unmeasured with a digit-free registry text");

// --- lever bounds ---------------------------------------------------------------------------------------------------
const q08 = P.PERF_LEVERS.find((l) => l.key === "q08-cadence");
ok(q08 && q08.ops_config_key === "q08_max_per_day" && q08.metric === "fleet_ai_run_rate_30d_usd", "the seeded lever is the q08 cadence on the fleet's own AI run rate");
eq(JSON.stringify(P.perfLeverBounds(q08, {})), JSON.stringify({ min: 2, max: 10 }), "q08 bounds 2..10");
eq(P.perfLeverValue(q08, {}), 10, "an absent knob is its reader's default (10)");
eq(P.perfLeverValue(q08, { q08_max_per_day: "abc" }), 10, "a non-numeric knob is the default, as dailyCap() reads it");
eq(JSON.stringify(P.perfLeverBounds(q08, { q08_review_2026_10_31: "{\"decision\":\"cut-cadence\"}", q08_max_per_day: "2" })), JSON.stringify({ min: 2, max: 2 }), "after the q08 review the loop never raises the cap above what the review set");
const bsky = { key: "bsky-cadence", metric: "social_engagement_rate_30d", ops_config_key: "bsky_posts_week", min: 0, max: 7, step: 1, default_value: 1, direction: 1, effect: "higher", owner_voice: 1, cap_key: "bluesky_posts_week", eval_days: 14 };
eq(JSON.stringify(P.perfLeverBounds(bsky, {})), JSON.stringify({ min: 0, max: P.PERF_STRATEGY_CAPS.bluesky_posts_week }), "an owner-voice lever is capped at the STRATEGY cadence (2 Bluesky posts a week)");
eq(P.perfLeverBounds(Object.assign({}, bsky, { cap_key: "nope" }), {}), null, "an owner-voice lever without a STRATEGY cap never moves");
eq(P.perfLeverBounds(Object.assign({}, q08, { step: 0 }), {}), null, "a zero step never moves");
eq(P.perfEnabled({}), true, "absent kill switch: on");
eq(P.perfEnabled({ perf_loop_enabled: "OFF" }), false, "kill switch off (case-insensitive)");
eq(P.perfEnabled({ perf_loop_enabled: "1" }), true, "kill switch '1': on");

// --- experiment plan ------------------------------------------------------------------------------------------------
const TRIG = { id: 354, metric_key: "fleet_ai_run_rate_30d_usd", operator: "gt", threshold: 15, action: "Pillar cost. ... Experiment lever perf-lever:q08-cadence: ...", hit: 1 };
const series = (metric, vals) => vals.map((v, k) => ({ metric, day: day(k), value: v }));   // vals[k] = k days ago
const facts = (o) => Object.assign({ triggers: [TRIG], history: series("fleet_ai_run_rate_30d_usd", [60, 59, 58, 61, 60, 59, 60]), experiments: [], ops: {} }, o || {});
let plan = P.perfExperimentPlan(facts(), NOW);
eq(plan.starts.length, 1, "a hit trigger naming the lever, breached 3+ days: one start");
let st = plan.starts[0];
eq(st.from_value + "->" + st.to_value, "10->8", "one step down from the default");
eq(st.from_raw, null, "the knob was absent");
eq(st.baseline, 59.5714, "baseline = mean of the 7 days up to the start");
eq(st.dir, "lower", "a 'gt' trigger asks for lower");
eq(st.eval_after, new Date(NOW + 14 * 864e5).toISOString(), "evaluated after the lever's 14-day window");
const skipWhy = (p) => (p.skipped[0] || {}).why || "";
plan = P.perfExperimentPlan(facts({ triggers: [Object.assign({}, TRIG, { action: "no lever named" })] }), NOW);
ok(plan.starts.length === 0 && /no enabled trigger names/.test(skipWhy(plan)), "a trigger that does not name the lever moves nothing");
plan = P.perfExperimentPlan(facts({ triggers: [Object.assign({}, TRIG, { metric_key: "unified_cost_usd_30d" })] }), NOW);
ok(plan.starts.length === 0 && /another metric/.test(skipWhy(plan)), "a trigger on another metric cannot move the lever");
plan = P.perfExperimentPlan(facts({ triggers: [Object.assign({}, TRIG, { hit: 0 })] }), NOW);
ok(plan.starts.length === 0 && /not hit now/.test(skipWhy(plan)), "a trigger that is not hit now moves nothing");
plan = P.perfExperimentPlan(facts({ triggers: [Object.assign({}, TRIG, { hit: null })] }), NOW);
ok(plan.starts.length === 0, "an unreadable trigger (hit NULL) moves nothing");
plan = P.perfExperimentPlan(facts({ history: series("fleet_ai_run_rate_30d_usd", [60, 59, 9, 61, 60]) }), NOW);
ok(plan.starts.length === 0 && /2 consecutive/.test(skipWhy(plan)), "breached on only 2 consecutive days: no start");
plan = P.perfExperimentPlan(facts({ history: series("fleet_ai_run_rate_30d_usd", [60, 59, 58, 61, 60, 59, 60]).slice(1) }), NOW);
eq(plan.starts.length, 1, "today's point not written yet: the streak counts back from yesterday");
plan = P.perfExperimentPlan(facts({ triggers: [Object.assign({}, TRIG, { operator: "lt" })], history: series("fleet_ai_run_rate_30d_usd", [1, 1, 1, 1]) }), NOW);
ok(plan.starts.length === 0 && /asks for higher/.test(skipWhy(plan)), "a trigger asking for the opposite direction moves nothing");
plan = P.perfExperimentPlan(facts({ ops: { perf_loop_enabled: "0" } }), NOW);
ok(plan.starts.length === 0 && plan.enabled === false && /kill switch/.test(skipWhy(plan)), "kill switch: no start");
plan = P.perfExperimentPlan(facts({ ops: { q08_max_per_day: "2" } }), NOW);
ok(plan.starts.length === 0 && /at its bound/.test(skipWhy(plan)), "at the floor: no start");
plan = P.perfExperimentPlan(facts({ ops: { q08_max_per_day: "1" } }), NOW);
ok(plan.starts.length === 0 && /outside the loop's bounds/.test(skipWhy(plan)), "a knob someone set below the floor is left alone");
plan = P.perfExperimentPlan(facts({ ops: { q08_max_per_day: "7" } }), NOW);
eq(plan.starts[0] && plan.starts[0].to_value, 5, "steps from the live value");
plan = P.perfExperimentPlan(facts({ ops: { q08_max_per_day: "3" } }), NOW);
eq(plan.starts[0] && plan.starts[0].to_value, 2, "a step that would pass the floor stops at the floor");
plan = P.perfExperimentPlan(facts({ history: series("fleet_ai_run_rate_30d_usd", [60, 59, 58]).concat([{ metric: "fleet_ai_run_rate_30d_usd", day: day(20), value: 5 }]) }), NOW);
eq(plan.starts.length, 1, "3 points in the last 7 days are enough for a baseline");
const running = { id: 1, lever: "q08-cadence", metric: "fleet_ai_run_rate_30d_usd", trigger_id: 354, dir: "lower", from_value: null, to_value: "8", started_at: h(48), eval_after: new Date(NOW + 12 * 864e5).toISOString(), baseline: 60, baseline_sd: 1, decision: "running" };
plan = P.perfExperimentPlan(facts({ experiments: [running] }), NOW);
ok(plan.starts.length === 0 && /running/.test(skipWhy(plan)) && plan.evaluations.length === 1 && plan.evaluations[0].d.decision === "wait", "one running experiment per metric and lever; it waits for its window");
plan = P.perfExperimentPlan(facts({ experiments: [Object.assign({}, running, { decision: "kept", decided_at: h(3 * 24) })] }), NOW);
ok(plan.starts.length === 0 && /cooldown/.test(skipWhy(plan)), "a decision under 7 days old: cooldown");
plan = P.perfExperimentPlan(facts({ experiments: [Object.assign({}, running, { decision: "kept", decided_at: h(8 * 24) })] }), NOW);
eq(plan.starts.length, 1, "8 days after a kept step the lever may take the next one");
plan = P.perfExperimentPlan(facts({ experiments: [Object.assign({}, running, { decision: "reverted", decided_at: h(8 * 24) })] }), NOW);
ok(plan.starts.length === 0 && /replaced, not repeated/.test(skipWhy(plan)), "a reverted lever is not repeated within 30 days (CLAUDE.md: replace a remedy that did not work)");
plan = P.perfExperimentPlan(facts({ experiments: [Object.assign({}, running, { decision: "reverted", decided_at: h(31 * 24) })] }), NOW);
eq(plan.starts.length, 1, "after the 30-day rest a reverted lever may be tried once more");
plan = P.perfExperimentPlan(facts({ experiments: [Object.assign({}, running, { decision: "superseded", decided_at: h(8 * 24) })] }), NOW);
eq(plan.starts.length, 1, "a superseded experiment proves nothing about the lever: only the cooldown applies");
plan = P.perfExperimentPlan(facts({ experiments: [running], ops: { perf_loop_enabled: "off" } }), NOW + 20 * 864e5);
ok(plan.starts.length === 0 && plan.evaluations.length === 1 && plan.evaluations[0].d.decision === "reverted", "kill switch: a running experiment is still decided at the end of its window (here: no points after the grace, reverted)");
plan = P.perfExperimentPlan(facts({ experiments: [Object.assign({}, running, { eval_after: new Date(NOW - 1).toISOString(), started_at: new Date(NOW - 10 * 864e5).toISOString() })], history: series("fleet_ai_run_rate_30d_usd", [50, 50, 50, 50, 50, 50, 50]) }), NOW);
ok(plan.evaluations[0].d.decision === "kept" && plan.starts.length === 0 && /cooldown/.test(skipWhy(plan)), "a decision taken in the same run starts the lever's cooldown");
// fleet-wide cap and per-metric dedupe with synthetic levers (restored afterwards)
const extra = ["x1", "x2", "x3"].map((k) => ({ key: k, metric: "m_" + k, ops_config_key: "knob_" + k, min: 0, max: 10, step: 1, default_value: 5, direction: -1, effect: "lower", owner_voice: 0, eval_days: 14 }));
const leversBefore = P.PERF_LEVERS.length;
extra.forEach((l) => P.PERF_LEVERS.push(l));
const trigX = extra.map((l, i) => ({ id: 900 + i, metric_key: l.metric, operator: "gte", threshold: 1, action: "perf-lever:" + l.key, hit: 1 }));
const histX = extra.reduce((acc, l) => acc.concat(series(l.metric, [9, 9, 9, 9])), []);
plan = P.perfExperimentPlan(facts({ triggers: [TRIG].concat(trigX), history: series("fleet_ai_run_rate_30d_usd", [60, 59, 58, 61]).concat(histX) }), NOW);
eq(plan.starts.length, 3, "at most 3 experiments start fleet-wide");
ok(plan.skipped.some((s) => /fleet-wide cap/.test(s.why)), "the fourth is held by the fleet cap");
extra.forEach(() => P.PERF_LEVERS.pop());
eq(P.PERF_LEVERS.length, leversBefore, "synthetic levers removed");
// Q08-SELF-TUNE-1 (0.4.120): the q08-temperature lever answers trigger #537 (lt -> "higher") in the same direction.
const q08t = P.PERF_LEVERS.find((l) => l.key === "q08-temperature");
ok(!!q08t && q08t.metric === "q08_gate_pass_rate_7d" && q08t.effect === "higher" && q08t.direction === -1 && q08t.min === 0.4 && q08t.max === 0.8 && q08t.owner_voice === 0 && q08t.lock_key === "q08_review_2026_10_31", "q08-temperature lever: gate pass rate, effect higher, bounded 0.4..0.8, no owner voice, review lock");

// --- keep or revert -------------------------------------------------------------------------------------------------
const hx = (vals, base) => { const o = {}; vals.forEach((v, k) => { o[day(k, base)] = v; }); return o; };   // vals[k] = k days before base
const START = NOW - 14 * 864e5;
const exp = { id: 7, started_at: new Date(START).toISOString(), eval_after: new Date(NOW - 1).toISOString(), baseline: 60, baseline_sd: 1, dir: "lower" };
let d = P.perfDecideExperiment(Object.assign({}, exp, { eval_after: new Date(NOW + 1).toISOString() }), hx([50, 50, 50]), NOW);
eq(d.decision, "wait", "before eval_after: wait");
d = P.perfDecideExperiment(exp, hx([55, 56, 54, 55, 55, 56, 54]), NOW);
eq(d.decision, "kept", "lower by 5 against a threshold of max(3, 1): kept");
eq(d.threshold, 3, "threshold = 5% of the baseline when that exceeds one sd");
d = P.perfDecideExperiment(exp, hx([58, 58, 58, 58, 58, 58, 58]), NOW);
eq(d.decision, "reverted", "lower by 2 against a threshold of 3: reverted (noise)");
d = P.perfDecideExperiment(Object.assign({}, exp, { model_score: Number.MAX_VALUE }), hx([58, 58, 58, 58, 58, 58, 58]), NOW);
eq(d.decision, "reverted", "a favorable model score cannot promote a change that fails the deterministic metric gate");
d = P.perfDecideExperiment(Object.assign({}, exp, { model_score: -Number.MAX_VALUE }), hx([55, 56, 54, 55, 55, 56, 54]), NOW);
eq(d.decision, "kept", "an unfavorable model score cannot override a change that passes the deterministic metric gate");
d = P.perfDecideExperiment(Object.assign({}, exp, { baseline_sd: 6 }), hx([55, 55, 55, 55, 55, 55, 55]), NOW);
ok(d.decision === "reverted" && d.threshold === 6, "a noisy baseline (sd 6) raises the threshold above the 5% floor");
d = P.perfDecideExperiment(Object.assign({}, exp, { dir: "higher", baseline: 0.02, baseline_sd: 0 }), hx([0.03, 0.03, 0.03]), NOW);
eq(d.decision, "kept", "a higher-is-better metric that rose beyond noise: kept");
d = P.perfDecideExperiment(exp, hx([50, 50]), NOW);
eq(d.decision, "wait", "2 points after the window, within grace: wait");
d = P.perfDecideExperiment(Object.assign({}, exp, { eval_after: new Date(NOW - 8 * 864e5).toISOString() }), hx([50, 50]), NOW);
eq(d.decision, "reverted", "still under 3 points after the grace period: reverted");
const shortExp = Object.assign({}, exp, { started_at: new Date(NOW - 2 * 864e5).toISOString() });
d = P.perfDecideExperiment(shortExp, hx([40, 40, 40, 40, 40]), NOW);
ok(d.decision === "wait" && d.n === 2, "points on or before the start day are not counted as observed");
eq(P.perfBreachStreak({ [day(0)]: 11, [day(1)]: 12, [day(2)]: 9 }, { operator: "gt", threshold: 10 }, day(0)), 2, "the breach streak stops at the first day inside the threshold");

// --- the tick against an in-memory D1 -------------------------------------------------------------------------------
let sqlite = null;
try { sqlite = await import("node:sqlite"); } catch (e) { sqlite = null; }
if (!sqlite) {
  console.log("performance.test: node:sqlite unavailable (Node < 22); D1 replay skipped");
} else {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT NOT NULL, kind TEXT NOT NULL, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE TRIGGER metric_registry_source_required_ins BEFORE INSERT ON metric_registry FOR EACH ROW WHEN NEW.source_of_truth IS NULL OR trim(NEW.source_of_truth)='' OR NEW.disposition_actor IS NULL OR trim(NEW.disposition_actor)='' OR NEW.refresh_cadence IS NULL OR trim(NEW.refresh_cadence)='' BEGIN SELECT RAISE(ABORT,'METRIC-INTEGRITY-1'); END;
CREATE TRIGGER metric_registry_cadence_canonical_ins BEFORE INSERT ON metric_registry FOR EACH ROW WHEN NEW.refresh_cadence IS NOT NULL AND trim(NEW.refresh_cadence) <> '' AND ( instr(trim(NEW.refresh_cadence),' ') > 0 OR NOT ( lower(trim(NEW.refresh_cadence)) IN ('hourly','daily','weekly','monthly') OR trim(NEW.refresh_cadence) GLOB '*/[0-9]*' OR trim(NEW.refresh_cadence) GLOB '[0-9]*m' OR trim(NEW.refresh_cadence) GLOB '[0-9]*h' ) ) BEGIN SELECT RAISE(ABORT,'METRIC-CADENCE-CANONICAL-1'); END;
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT UNIQUE, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER DEFAULT 5, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER DEFAULT 168, enabled INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE analytics_action_log (id INTEGER PRIMARY KEY AUTOINCREMENT, trigger_id INTEGER, fired_at TEXT DEFAULT (datetime('now')), metric_value REAL, action TEXT, queue_target TEXT, status TEXT DEFAULT 'fired', notes TEXT);
CREATE TABLE analytics_dash_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE analytics_dash_records (metric TEXT PRIMARY KEY, value TEXT);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, definition TEXT NOT NULL, timeout_ms INTEGER NOT NULL DEFAULT 30000, retries INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
CREATE TABLE metric_history (metric TEXT NOT NULL, day TEXT NOT NULL, value REAL, meets INTEGER, target TEXT, ts TEXT, PRIMARY KEY (metric, day));
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT DEFAULT 'open', created_at INTEGER, updated_at INTEGER, close_channel TEXT);
CREATE TABLE fleet_deploys (id INTEGER PRIMARY KEY AUTOINCREMENT, worker TEXT, ok INTEGER, ts TEXT);
CREATE TABLE worker_live_audit (worker TEXT PRIMARY KEY, http INTEGER, live_version TEXT, note TEXT, probed_at TEXT);
CREATE TABLE citation_stats (id TEXT PRIMARY KEY, doi TEXT, source TEXT, metric TEXT, value REAL, collected_at TEXT);
CREATE TABLE external_mentions (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, source TEXT, title TEXT, url TEXT, author TEXT, score INTEGER, created TEXT, first_seen TEXT);
CREATE TABLE invest_facts (key TEXT PRIMARY KEY, value TEXT, evidence TEXT, updated_at TEXT);
`);
  // METRIC-CLOSED-LOOP-1 is live; this change applies on top of it. The metric-refresh task exists with no steps.
  db.prepare("INSERT INTO fleet_tasks (id, name, type, definition) VALUES ('metric-refresh', 'metric refresh', 'workflow', '{\"steps\":[]}')").run();
  db.exec(readFileSync(join(migDir, "2026-10-02-metric-closed-loop.sql"), "utf8"));
  const migration = readFileSync(join(migDir, "2026-10-02-performance-loop.sql"), "utf8");
  // qnfo-fleet-control 0.4.90 FLEET-RUN-RATE-1 seeds its trigger on its first tick (here: before the migration lands)
  db.prepare("INSERT INTO analytics_metric_triggers (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes) VALUES ('fleet_ai_run_rate_30d_usd', 'Fleet AI run-rate above $15/30d', 'registry', 'gt', 15, 'high', 'Read ai_call_counters ... Close when metric_registry.fleet_ai_run_rate_30d_usd <= 15.', 'qnfo-fleet-control', 'agent_issues', 168, 1, 'seeded by FLEET-RUN-RATE-1')").run();
  db.exec(migration);
  db.exec(migration);   // idempotent
  const one = (sql, ...x) => db.prepare(sql).get(...x);
  const T = one("SELECT id, action FROM analytics_metric_triggers WHERE metric_key = 'fleet_ai_run_rate_30d_usd'");
  ok(T && T.action.split("perf-lever:q08-cadence").length === 2 && /^Read ai_call_counters/.test(T.action), "the migration names the lever on the code-seeded run-rate trigger, once, keeping its action");
  {
    // the other order: the migration lands before the kernel seeds the trigger
    const db2 = new sqlite.DatabaseSync(":memory:");
    db2.exec("CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT UNIQUE, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER DEFAULT 5, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER DEFAULT 168, enabled INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT (datetime('now'))); CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT NOT NULL, kind TEXT NOT NULL, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT); CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, definition TEXT NOT NULL, timeout_ms INTEGER, retries INTEGER, version INTEGER, enabled INTEGER, updated_at TEXT);");
    db2.exec(migration);
    const t2 = db2.prepare("SELECT operator, threshold, action FROM analytics_metric_triggers WHERE metric_key = 'fleet_ai_run_rate_30d_usd'").get();
    ok(t2 && t2.operator === "gt" && t2.threshold === 15 && t2.action.split("perf-lever:q08-cadence").length === 2, "migration first: the run-rate trigger is created with FLEET-RUN-RATE-1's fields and the lever token");
  }
  for (const m of ["issue_mttr_h_30d", "deploy_failure_rate_7d", "worker_health_failure_rate", "credibility_events_90d", "selected_works_citation_coverage"]) {
    const t = one("SELECT threshold, owner, action, enabled FROM analytics_metric_triggers WHERE metric_key = ?", m);
    ok(t && t.enabled === 1 && t.threshold !== null && t.owner && /Definition of done/.test(t.action), "trigger with threshold, owner, lever and DoD: " + m);
  }
  // The five reach KPIs other workers compute carry their trigger in the migration that registers them (one owner per
  // trigger, in the writer's units); this migration must not add a second one.
  for (const [m, f] of [["social_engagement_rate_30d", "2026-10-02-social-distribution-learner.sql"], ["outreach_reply_rate_30d", "2026-10-02-outreach-learner-metrics.sql"], ["warm_conversations_30d", "2026-10-02-outreach-learner-metrics.sql"], ["inbound_first_response_h_median_30d", "2026-10-02-inbound-sla.sql"], ["inbound_contacts_30d", "2026-10-02-work-with-me-triggers.sql"]]) {
    const src = readFileSync(join(here, "..", "migrations", f), "utf8");
    ok(src.includes("('" + m + "', '") && /INSERT OR IGNORE INTO analytics_metric_triggers/.test(src) && one("SELECT COUNT(*) n FROM analytics_metric_triggers WHERE metric_key = ?", m).n === 0, "trigger for " + m + " is owned by " + f + ", not duplicated here");
  }
  eq(one("SELECT COUNT(*) n FROM analytics_metric_triggers WHERE metric_key = 'engaged_human_sessions_28d'").n, 0, "engaged_human_sessions_28d is the named exemption");
  eq(one("SELECT COUNT(*) n FROM metric_registry WHERE metric IN ('issue_mttr_h_30d','deploy_failure_rate_7d','worker_health_failure_rate','credibility_events_90d','selected_works_citation_coverage','engaged_human_sessions_28d')").n, 6, "the six KPI rows pass the registry guards");
  const def = one("SELECT definition FROM fleet_tasks WHERE id = 'metric-refresh'").definition;
  ok(JSON.parse(def) && def.split("perf_experiments").length === 2, "remedy_efficacy_30d's step now reads perf_experiments, once, and stays valid JSON");
  const refreshSql = JSON.parse(def).steps.map((s) => s.sql).find((s) => /remedy_efficacy_30d/.test(s));

  db.prepare("INSERT INTO metric_registry (metric, layer, kind, source_of_truth, target, disposition_actor, refresh_cadence, last_value, last_refreshed) VALUES ('fleet_ai_run_rate_30d_usd', 'fleet', 'leading', 's', '<= 15', 'a', 'hourly', '28.4', ?)").run(h(1));
  const issueTitle = "METRIC-TRIGGER-" + T.id + "-FLEET-AI-RUN-RATE-30D-USD: Fleet AI run-rate above $15/30d";
  db.prepare("INSERT INTO agent_issues (title, description, status, created_at, updated_at) VALUES (?, 'trigger issue', 'open', ?, ?)").run(issueTitle, NOW - 864e5, NOW - 864e5);
  const setHist = (vals, base) => vals.forEach((v, k) => db.prepare("INSERT INTO metric_history (metric, day, value) VALUES ('fleet_ai_run_rate_30d_usd', ?, ?) ON CONFLICT(metric, day) DO UPDATE SET value = excluded.value").run(day(k, base), v));
  setHist([60, 59, 58, 61, 60, 59, 60]);
  // KPI inputs: enough closures for MTTR, a healthy live audit; the rest stay thin (unmeasured)
  for (let i = 0; i < 12; i++) db.prepare("INSERT INTO agent_issues (title, status, created_at, updated_at) VALUES (?, 'closed', ?, ?)").run("old " + i, NOW - (i + 2) * 36e5 - 864e5, NOW - 864e5);
  db.prepare("INSERT INTO worker_live_audit (worker, http, note, probed_at) VALUES ('w1', 200, 'SYNC', ?)").run(h(1).replace("T", " ").slice(0, 19));

  function stmtOn(sql) {
    let args = [];
    const self = {
      bind(...x) { args = x.map((v) => (v === undefined ? null : v)); return self; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
    };
    return self;
  }
  const env = { AUDIT: { prepare: (sql) => stmtOn(sql) } };
  const knob = () => { const x = one("SELECT value FROM ops_config WHERE key = 'q08_max_per_day'"); return x ? x.value : null; };

  let t = await P.performanceLoopTick(env, { nowMs: NOW - 2 * 36e5 });
  ok(t.experiments && /after 9:00Z/.test(t.experiments.skipped), "before 09:00Z: the KPIs refresh, no experiment runs");
  eq(one("SELECT last_value v FROM metric_registry WHERE metric = 'issue_mttr_h_30d'").v, "7.5", "MTTR measured from 12 closures (median of 2..13h)");
  const unm = one("SELECT last_value v, state FROM metric_registry WHERE metric = 'credibility_events_90d'");
  ok(unm.state === "UNMEASURED" && /^n\/a: /.test(unm.v) && noDigits(unm.v), "credibility events: UNMEASURED with a digit-free reason, never 0");
  eq(one("SELECT last_value v FROM metric_registry WHERE metric = 'worker_health_failure_rate'").v, "0", "a healthy live audit reads 0 (a measured zero)");
  eq(one("SELECT COUNT(*) n FROM perf_runs").n, 0, "no experiment ledger row before 09:00Z");

  t = await P.performanceLoopTick(env, { nowMs: NOW });
  eq(t.experiments.started.length, 1, "tick 1: the hit trigger starts one experiment");
  eq(knob(), "8", "tick 1: ops_config q08_max_per_day 10 -> 8 (inserted: the knob was absent)");
  let e1 = one("SELECT * FROM perf_experiments ORDER BY id DESC LIMIT 1");
  ok(e1.decision === "running" && e1.from_value === null && e1.to_value === "8" && e1.trigger_id === T.id && e1.dir === "lower", "tick 1: the ledger row records the step, the trigger and the direction");
  eq(one("SELECT current FROM perf_levers WHERE key = 'q08-cadence'").current, "8", "tick 1: perf_levers.current follows the knob");
  ok(/experiment \d+ started/.test(one("SELECT description FROM agent_issues WHERE title = ?", issueTitle).description), "tick 1: the trigger's open issue records the start");
  eq(one("SELECT updated_at u FROM agent_issues WHERE title = ?", issueTitle).u, NOW - 864e5, "tick 1: the note does not touch updated_at");
  eq(one("SELECT COUNT(*) n FROM perf_runs WHERE kind = 'experiments'").n, 1, "tick 1: one ledger row");
  t = await P.performanceLoopTick(env, { nowMs: NOW + 36e5 });
  ok(/already ran/.test(t.experiments.skipped), "tick 2: once per UTC day");
  t = await P.performanceLoopTick(env, { nowMs: NOW + 864e5 });
  ok(t.experiments.started.length === 0 && t.experiments.decided.length === 0 && t.experiments.running === 1, "next day: the experiment is still running, nothing new starts");

  // keep: Workers AI cost fell from ~60 to ~54 after the step
  const D15 = NOW + 15 * 864e5;
  setHist([54, 54, 55, 53, 54, 54, 55], D15);
  t = await P.performanceLoopTick(env, { nowMs: D15 });
  eq(t.experiments.decided.join(), e1.id + " kept", "day 15: improved beyond noise, kept");
  eq(knob(), "8", "day 15: the kept value stays");
  e1 = one("SELECT * FROM perf_experiments WHERE id = ?", e1.id);
  ok(e1.decision === "kept" && e1.observed !== null && e1.threshold !== null && e1.decided_at, "day 15: decision, observed and threshold recorded");
  eq(t.experiments.started.length, 0, "day 15: the cooldown holds the next step");

  // remedy_efficacy_30d counts the kept experiment (the trigger firing log is empty here). Its SQL judges against the real
  // clock, so the decision is re-dated to yesterday for this check.
  const realIso = (dd) => new Date(Date.now() - dd * 864e5).toISOString();
  db.prepare("UPDATE perf_experiments SET decided_at = ? WHERE id = ?").run(realIso(1), e1.id);
  db.exec(refreshSql);
  eq(one("SELECT last_value v FROM metric_registry WHERE metric = 'remedy_efficacy_30d'").v, "1.0", "remedy_efficacy_30d counts a kept experiment as a remedy that worked");

  // after the cooldown, still breaching: a second step 8 -> 6; it does not help and is reverted to 8
  const D23 = NOW + 23 * 864e5;
  setHist([54, 54, 55, 53, 54, 54, 55], D23);
  t = await P.performanceLoopTick(env, { nowMs: D23 });
  eq(knob(), "6", "day 23: after the cooldown a second step 8 -> 6");
  const e2 = one("SELECT * FROM perf_experiments ORDER BY id DESC LIMIT 1");
  eq(e2.from_value, "8", "day 23: from the kept value");
  const D38 = D23 + 15 * 864e5;
  setHist([54, 55, 54, 53, 55, 54, 54], D38);
  t = await P.performanceLoopTick(env, { nowMs: D38 });
  eq(t.experiments.decided.join(), e2.id + " reverted", "day 38: no improvement beyond noise, reverted");
  eq(knob(), "8", "day 38: compare-and-swap restored 8");
  db.prepare("UPDATE perf_experiments SET decided_at = ? WHERE id = ?").run(realIso(40), e1.id);
  db.prepare("UPDATE perf_experiments SET decided_at = ? WHERE id = ?").run(realIso(1), e2.id);
  db.exec(refreshSql);
  eq(one("SELECT last_value v FROM metric_registry WHERE metric = 'remedy_efficacy_30d'").v, "0.0", "remedy_efficacy_30d counts the reverted experiment (the kept one is older than 30 days)");

  // a reverted lever rests 30 days (a remedy that did not move its metric is replaced, not repeated)
  db.prepare("UPDATE perf_experiments SET decided_at = ? WHERE id = ?").run(new Date(D38).toISOString(), e2.id);
  setHist([54, 55, 54, 53, 55, 54, 54], D38 + 8 * 864e5);
  t = await P.performanceLoopTick(env, { nowMs: D38 + 8 * 864e5 });
  ok(t.experiments.started.length === 0 && t.experiments.skipped.some((x) => /replaced, not repeated/.test(x.why)) && knob() === "8", "8 days after the revert: the lever rests, nothing starts");
  // superseded: someone (the q08 review) changes the knob during an experiment; the revert leaves it alone
  db.prepare("UPDATE perf_experiments SET decided_at = ? WHERE id = ?").run(new Date(D38 - 31 * 864e5).toISOString(), e2.id);
  const D46 = D38 + 9 * 864e5;
  setHist([54, 55, 54, 53, 55, 54, 54], D46);
  t = await P.performanceLoopTick(env, { nowMs: D46 });
  eq(knob(), "6", "day 47: a new step once the rest has passed");
  const e3 = one("SELECT * FROM perf_experiments ORDER BY id DESC LIMIT 1");
  db.prepare("UPDATE ops_config SET value = '2' WHERE key = 'q08_max_per_day'").run();
  const D61 = D46 + 15 * 864e5;
  setHist([54, 54, 54, 54, 54, 54, 54], D61);
  t = await P.performanceLoopTick(env, { nowMs: D61 });
  eq(t.experiments.decided.join(), e3.id + " superseded", "a knob changed by someone else is not reverted: superseded");
  eq(knob(), "2", "the other writer's value stands");
  ok(/no longer holds/.test(one("SELECT note FROM perf_experiments WHERE id = ?", e3.id).note), "the ledger says why");

  // revert to absent: the row is deleted, as it was before the experiment
  db.prepare("DELETE FROM ops_config WHERE key = 'q08_max_per_day'").run();
  db.prepare("UPDATE perf_experiments SET decided_at = ? WHERE decision <> 'running'").run(new Date(D61 - 30 * 864e5).toISOString());
  const D62 = D61 + 864e5;
  setHist([54, 54, 54, 54, 54, 54, 54], D62);
  t = await P.performanceLoopTick(env, { nowMs: D62 });
  eq(knob(), "8", "a fresh step from the absent default 10 -> 8");
  const e4 = one("SELECT * FROM perf_experiments ORDER BY id DESC LIMIT 1");
  const D77 = D62 + 15 * 864e5;
  setHist([54, 54, 54, 54, 54, 54, 54], D77);
  // kill switch on: no new experiments, the running one is still decided
  db.prepare("INSERT INTO ops_config (key, value) VALUES ('perf_loop_enabled', '0')").run();
  t = await P.performanceLoopTick(env, { nowMs: D77 });
  eq(t.experiments.decided.join(), e4.id + " reverted", "kill switch: the running experiment is still decided (reverted)");
  eq(knob(), null, "reverting an experiment on an absent knob deletes the row");
  eq(t.experiments.enabled, false, "the ledger row records the kill switch");
  db.prepare("UPDATE perf_experiments SET decided_at = ? WHERE decision <> 'running'").run(new Date(D77 - 30 * 864e5).toISOString());
  t = await P.performanceLoopTick(env, { nowMs: D77 + 864e5 });
  ok(t.experiments.started.length === 0 && knob() === null, "kill switch: nothing starts");
  ok(/kill switch on/.test(one("SELECT note FROM perf_runs WHERE kind = 'experiments' ORDER BY id DESC LIMIT 1").note), "the ledger note names the kill switch");
  db.prepare("DELETE FROM ops_config WHERE key = 'perf_loop_enabled'").run();

  // unreadable inputs write no ledger row (the watchmaker then sees the evaluator stall)
  db.exec("DROP VIEW v_metric_trigger_state");
  const before = one("SELECT COUNT(*) n FROM perf_runs").n;
  t = await P.performanceLoopTick(env, { nowMs: D77 + 2 * 864e5 });
  ok(t.experiments.error && /triggers/.test(t.experiments.error) && one("SELECT COUNT(*) n FROM perf_runs").n === before && knob() === null, "no trigger state: no decision, no ledger row");

  const status = await P.perfExperimentsStatus(env);
  ok(status.loop === "PERFORMANCE-LOOP-1" && status.levers.length === P.PERF_LEVERS.length && status.finished.length >= 4 && status.running.length === 0, "the /improvement experiments section lists the levers and the finished experiments");
  ok(!JSON.stringify(status).includes("@"), "the read-out carries no address");
}

// PERF-PIN-1: a pinned lever never moves; a blank pin pins nothing.
eq(P.perfLeverBounds(q08, { "perf_pin:q08-cadence": "owner cap, card 58" }), null, "a pinned lever has no bounds");
eq(JSON.stringify(P.perfLeverBounds(q08, { "perf_pin:q08-cadence": "  " })), JSON.stringify({ min: 2, max: 10 }), "a blank pin pins nothing");
plan = P.perfExperimentPlan(facts({ ops: { "perf_pin:q08-cadence": "owner cap" } }), NOW);
ok(plan.starts.length === 0, "pinned: no experiment on the q08 cadence");
console.log(`performance.test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
