// EVOLVE-1 offline suite: proves the organ that turns the fleet's own gap registers into named work.
//
// It loads qnfo-evolve/worker.js the way the deployer ships it (one self-contained script, no
// imports -- canonical-deploy PUTs worker.js verbatim, so an import would ship as an unresolved
// specifier), stubs only addEventListener, and pins the four decisions that matter:
//   1. a step whose path list is literally "none automatic" is single-path, not healthy;
//   2. a gap keeps one stable key across ticks, so dedupe cannot re-file it every quarter hour;
//   3. the filed issue names the live worker AND the file AND a query for its definition of done --
//      the exact shape 67 of 128 plans were refused for missing on 2026-10-17;
//   4. the budget holds: never more than the per-tick cap, never past the open-filing cap.
//
// Run: node qnfo-evolve/evolve.test.mjs

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");

let pass = 0, fail = 0;
const ok = (c, m, d) => {
  if (c) pass++;
  else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); }
};

/* Load without a bundler: the module has no imports, so the source can be evaluated as one body.
 * `export default {` is rewritten to a local binding so the same file that ships to Cloudflare is the
 * file under test. */
const body = src.replace(/^export default /m, "var __default = ");
const mod = new Function("console", body + "\n;return { isSinglePath, gapKey, buildIssue, pickNew, isDenied, DENY_WORKERS, VERSION, SOURCE, MAX_OPEN, MAX_NEW_PER_TICK, WIP_CEILING_DEFAULT, WIP_CEILING_MAX, WIP_TERMINAL_STATUSES, WIP_HANDOFF_STATUSES, WIP_EXCLUDED_STATUSES, WIP_ATTEMPTS, WIP_STALE_MIN, WIP_PARK_PER_TICK, recoverWip, tickAllowed, CAPABILITIES, LIMITATIONS, handlers: __default };")
  ({ log() {}, error() {} });

ok(/^\d+\.\d+\.\d+/.test(mod.VERSION), "VERSION is semver-shaped", mod.VERSION);
ok(mod.SOURCE === "qnfo-evolve|EVOLVE-1", "source carries the loop identity", mod.SOURCE);

/* Raw-PUT safety: the deployed artefact is this file, so it must be a self-contained ES module. */
ok(!/^\s*import\s/m.test(src), "worker.js has no top-level import");
ok(/^export default \{/m.test(src), "worker.js exports the default handler set");
ok(typeof mod.handlers.fetch === "function", "default export has a fetch handler");
ok(typeof mod.handlers.scheduled === "function", "default export has a scheduled handler");

/* 1. single-path detection, including the fleet's own "none automatic" wording. */
ok(mod.isSinglePath('["a","b"]') === false, "two paths is not single-path");
ok(mod.isSinglePath('["none automatic beyond research-review-error","session doer"]') === true,
  '"none automatic" counts as single-path even beside a manual path');
ok(mod.isSinglePath('["a"]') === true, "one path is single-path");
ok(mod.isSinglePath("") === true, "an empty register entry is single-path");
ok(mod.isSinglePath('["re-dispatch","park","session"]') === false, "three paths is not single-path");

/* 2. stable keys. */
const k1 = mod.gapKey("single-path", "queue:code-task-stalled", "unfinished code task not updated");
const k2 = mod.gapKey("single-path", "queue:code-task-stalled", "unfinished code task not updated");
const k3 = mod.gapKey("single-path", "queue:issue-unremediated", "no doer");
ok(k1 === k2, "the same gap keeps the same key");
ok(k1 !== k3, "a different gap gets a different key");
ok(/^single-path:[0-9a-f]{8}$/.test(k1), "key shape is kind:hash", k1);

/* 3. the filed issue is farmable: worker, file, reproduce, definition of done. */
const row = {
  process: "queue:research-head-stalled",
  step: "rows queued or researching and no qnfo-research-exec done-ok event in 60 min",
  sla_min: 60,
  evidence: { paths: '["none automatic beyond research-review-error","session doer with close evidence"]' },
  probe: "SELECT COUNT(*) AS n FROM v_process_path_gaps WHERE process = 'queue:research-head-stalled'"
};
const issue = mod.buildIssue("single-path", row, "qnfo-research-exec", "qnfo-research-exec/worker.js");
ok(issue.title.startsWith("EVOLVE-1: "), "title carries the marker", issue.title);
ok(issue.title.includes("queue:research-head-stalled"), "title names the process", issue.title);
ok(issue.description.includes("worker: qnfo-research-exec"), "names the live worker");
ok(issue.description.includes("file: qnfo-research-exec/worker.js"), "names the file");
ok(issue.description.includes("reproduce: SELECT COUNT(*)"), "carries a query to reproduce");
ok(issue.description.includes("definition of done:"), "carries a definition of done");
ok(issue.description.includes("0 rows"), "done is a query result, not prose");
ok(issue.priority === "high", "single-path is high priority", issue.priority);
ok(issue.key === mod.gapKey("single-path", row.process, row.step), "issue key matches the gap", issue.key);

/* A quote in a step name must not break the probe SQL. */
const quoted = mod.buildIssue("single-path", { process: "p", step: "it's broken", probe: "SELECT 1" }, "qnfo-social", "qnfo-social/worker.js");
ok(quoted.description.includes("it's broken"), "quotes survive into the issue text");

/* 4. budget and dedupe. */
const cands = [
  { key: "a", title: "A" }, { key: "b", title: "B" },
  { key: "c", title: "C" }, { key: "d", title: "D" }
];
ok(mod.pickNew(cands, [], 10, 2).length === 2, "per-tick cap is honoured");
ok(mod.pickNew(cands, [], 1, 2).length === 1, "room cap is honoured");
ok(mod.pickNew(cands, ["a", "b"], 10, 5).map((x) => x.key).join("") === "cd", "open filings are deduped");
ok(mod.pickNew(cands, [], 0, 2).length === 0, "no room means no filing");

/* The cron must satisfy CRON_RATE_GUARD-1 (>= 10 minutes between fires, circular). */
const cronLine = (toml.match(/^crons\s*=\s*\[([^\]]+)\]/m) || [])[1] || "";
const minutes = cronLine.trim().replace(/"/g, "").split(",").map((s) => parseInt(s, 10));
ok(minutes.length >= 1 && minutes.every((m) => m >= 0 && m < 60), "cron minutes parse", minutes);
minutes.sort((a, b) => a - b);
let minGap = 60 - minutes[minutes.length - 1] + minutes[0];
for (let i = 1; i < minutes.length; i++) minGap = Math.min(minGap, minutes[i] - minutes[i - 1]);
ok(minGap >= 10, "cron spacing is at least 10 minutes", minGap);

/* The charter pillar comment charter-guard.py reads must be present and be a real pillar key. */
ok(/# charter-pillar: autonomy/.test(toml), "wrangler.toml declares a charter pillar");
ok(/binding = "AUDIT"/.test(toml), "the AUDIT binding is declared");

/* 5. the deny list mirrors PLAN_DENY_WORKERS, so EVOLVE-1 cannot file work the loop must refuse. */
ok(mod.isDenied("qnfo-code-orchestrator") === true, "the code loop itself is denied");
ok(mod.isDenied("qnfo-fleet-control") === true, "fleet-control is denied");
ok(mod.isDenied("qnfo-research-exec") === false, "research-exec is farmable");
ok(mod.isDenied("qnfo-gateway") === false, "qnfo-gateway is canaried, so it is farmable");
ok(mod.isDenied("qnfo-ai") === false, "qnfo-ai is canaried, so it is farmable");
ok(mod.DENY_WORKERS.indexOf("qnfo-ai") < 0 && mod.DENY_WORKERS.indexOf("qnfo-gateway") < 0,
  "the canaried pair is absent from the deny list");

/* 6. a register step carries bracketed history up to 300 chars; the title must stay readable. */
const longStep = mod.buildIssue("single-path", {
  process: "queue:code-task-stalled",
  step: "unfinished code task not updated for 180 min [SLA-120M-1 2026-10-14: SLA 180 -> 120 min, measured every 10 min; owner directive: no SLA exceeds 120 minutes]",
  probe: "SELECT 1"
}, "qnfo-social", "qnfo-social/worker.js");
ok(longStep.title.length <= 150, "the title is bounded for a long register step", longStep.title.length);
ok(longStep.title.includes("queue:code-task-stalled"), "the bounded title still names the process");
ok(longStep.description.includes("SLA 180 -> 120 min"), "the full step survives in the body");

/* 7. the close path must satisfy the fleet's close-evidence trigger before it changes status. */
ok(/issue_triage/.test(src), "the close path writes issue_triage");
ok(/close_evidence/.test(src), "the close path supplies close_evidence");
ok(src.indexOf("close_evidence") < src.indexOf("close_channel = 'evolve-auto'"),
  "evidence is written before the status changes (issue_close_evidence_required)");

/* 8. WIP-RECOVERY-1 uses the shared planner ceiling and active-task status set, while staying timid. */
ok(mod.WIP_CEILING_DEFAULT === 12, "the fallback matches the planner's default", mod.WIP_CEILING_DEFAULT);
ok(mod.WIP_CEILING_MAX === 48, "the shared ceiling is bounded by the planner's maximum", mod.WIP_CEILING_MAX);
ok(/key = 'code_plan_wip'/.test(src), "the planner's shared ceiling is read from ops_config");
ok(/status NOT IN \("\s*\+ placeholders/.test(src), "active WIP excludes terminal and handoff states");
ok(JSON.stringify(mod.WIP_TERMINAL_STATUSES) === JSON.stringify(["merged", "closed", "publish_failed", "needs_human", "failed", "reverted", "superseded"]),
  "terminal statuses match the planner's done set");
ok(JSON.stringify(mod.WIP_HANDOFF_STATUSES) === JSON.stringify(["branch_pushed", "published", "pr_open"]),
  "handoff statuses do not consume planner WIP");
ok(mod.WIP_ATTEMPTS === 6, "a task is only parked after 6 attempts", mod.WIP_ATTEMPTS);
ok(mod.WIP_STALE_MIN === 10, "a task is not parked while it may be mid-attempt", mod.WIP_STALE_MIN);
ok(/if \(wip < ceiling\) return parked/.test(src), "recovery is inert while the queue is not blocked");
ok(/INSERT OR REPLACE INTO ops_config/.test(src), "the row is backed up before it is parked");
ok(src.indexOf("INSERT OR REPLACE INTO ops_config") < src.indexOf("SET status = 'failed'"),
  "the backup is written before the status changes");
ok(/WHERE id = \? AND status = 'queued'/.test(src), "the park cannot clobber a task another actor moved");
ok(/attempts >= \?/.test(src), "the attempt floor is a bound parameter, not a string");

const wipEvents = [];
const wipSql = [];
const wipTask = { id: "stale-1", status: "queued", attempts: 6, updated_at: "2026-10-25T15:40:00Z" };
const wipDb = {
  prepare(sql) {
    wipSql.push(sql);
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      async all() {
        if (/key = 'code_plan_wip'/.test(sql)) return { results: [{ value: "40" }] };
        if (/FROM code_tasks WHERE status NOT IN/.test(sql)) {
          wipEvents.push(["count-params", params]);
          return { results: [{ n: 40, queued: 8, oldest_updated_at: "2026-10-25T15:40:00Z" }] };
        }
        if (/SELECT \* FROM code_tasks/.test(sql)) return { results: [wipTask] };
        throw new Error("unexpected query: " + sql);
      },
      async run() {
        if (/INSERT OR REPLACE INTO ops_config/.test(sql)) {
          wipEvents.push(["backup", params[0]]);
          return { meta: { changes: 1 } };
        }
        if (/UPDATE code_tasks SET status = 'failed'/.test(sql)) {
          wipEvents.push(["park", params[2]]);
          return { meta: { changes: 1 } };
        }
        throw new Error("unexpected write: " + sql);
      }
    };
  }
};
const wipOut = { ts: "2026-10-25T16:00:00.000Z" };
const parked = await mod.recoverWip({ AUDIT: wipDb }, wipOut);
ok(parked[0] === "stale-1:6", "queued work can be parked at the shared planner ceiling", parked);
ok(wipOut.wip === 40 && wipOut.wip_queued === 8 && wipOut.wip_ceiling === 40,
  "recovery records total active WIP separately from queued candidates", wipOut);
ok(wipOut.wip_oldest_age_min === 20, "the ledger measurement includes oldest active-task age", wipOut);
ok(JSON.stringify(wipEvents[0][1]) === JSON.stringify(mod.WIP_EXCLUDED_STATUSES),
  "the active-task count binds every planner terminal and handoff status", wipEvents);
ok(wipEvents[1][0] === "backup" && wipEvents[2][0] === "park",
  "the backup precedes parking", wipEvents);
ok(wipEvents[1][1].endsWith("20261025160000"), "same-day recovery backups have distinct run timestamps", wipEvents);
ok(wipSql.some((sql) => /status = 'queued' AND attempts >= \?/.test(sql)),
  "only exhausted queued tasks are eligible for parking");
const fractionalWipDb = {
  prepare(sql) {
    return {
      bind() { return this; },
      async all() {
        if (/key = 'code_plan_wip'/.test(sql)) return { results: [{ value: "0.5" }] };
        return { results: [{ n: 0, queued: 0, oldest_updated_at: null }] };
      }
    };
  }
};
const fractionalOut = { ts: "2026-10-25T16:00:00.000Z" };
await mod.recoverWip({ AUDIT: fractionalWipDb }, fractionalOut);
ok(fractionalOut.wip_ceiling === 1, "a positive fractional config is bounded to a nonzero ceiling", fractionalOut);
const unavailableConfigOut = { ts: "2026-10-25T16:00:00.000Z", skipped: [] };
await mod.recoverWip({ AUDIT: { prepare() { throw new Error("D1 unavailable"); } } }, unavailableConfigOut);
ok(unavailableConfigOut.skipped.some((s) => s.includes("wip-config: D1 unavailable")),
  "a failed shared-setting read is reported and skips recovery instead of using a guessed ceiling", unavailableConfigOut);

/* 9. HEALTH-CONTRACT-1 (agent_issues 2852, capability_contract_conformance): /health declares non-empty capabilities[] and
 * limitations[]. qnfo-deploy-guard snapshots exactly those two keys from every live /health and a worker with either one
 * empty counts against the fleet's conformance, so the suite reads them through the real fetch handler. */
const healthEnv = { AUDIT: { prepare: function () { return { all: function () { return Promise.resolve({ results: [{ ts: "2026-10-19T00:00:00Z", scanned: 1, filed: 0, closed: 0 }] }); } }; } } };
const hres = await mod.handlers.fetch(new Request("https://qnfo-evolve.example/health"), healthEnv);
const health = await hres.json();
ok(hres.status === 200 && health.ok === true && health.version === mod.VERSION, "/health answers ok with the version", health);
ok(Array.isArray(health.capabilities) && health.capabilities.length >= 5 && health.capabilities.every((c) => typeof c === "string" && c.length > 10), "/health declares at least five non-empty capabilities", health.capabilities);
ok(Array.isArray(health.limitations) && health.limitations.length >= 5 && health.limitations.every((c) => typeof c === "string" && c.length > 10), "/health declares at least five non-empty limitations", health.limitations);
ok(health.limitations.some((l) => l.includes("at most " + mod.MAX_NEW_PER_TICK + " issues per tick") && l.includes(mod.MAX_OPEN + " open filings")), "the filing limit on /health is built from the constants the tick uses");
ok(health.limitations.some((l) => l.includes(mod.WIP_ATTEMPTS + " attempts") && l.includes(mod.WIP_STALE_MIN + " minutes") && l.includes("at most " + mod.WIP_PARK_PER_TICK + " times")), "the wip-recovery limit on /health is built from the constants the recovery uses");
ok(health.limitations.some((l) => /never edits code/.test(l)) && health.capabilities.some((c) => /^auto-close/.test(c)), "the contract states what the worker refuses to do and what it closes itself");
ok(health.last_run && health.last_run.scanned === 1, "the last run is still reported next to the contract", health.last_run);

/* 10. EVOLVE-TICK-FAILCLOSED-1 (RM-TP-8-TRUST-BOUNDARY): POST /tick is a write route (it files and closes agent_issues), and this
 * worker holds no secret by design, so "no LOOP_TOKEN bound" must mean closed. Measured live 2026-11-04T23:04Z: an anonymous
 * empty-body POST answered 200 with a tick summary. None of these cases may touch D1 unless the token matches. */
const mkReq = (token) => new Request("https://qnfo-evolve.example/tick", { method: "POST", headers: token === undefined ? {} : { "x-loop-token": token } });
ok(mod.tickAllowed({}, mkReq()) === false, "no LOOP_TOKEN bound and no header: the tick is refused");
ok(mod.tickAllowed({}, mkReq("anything")) === false, "no LOOP_TOKEN bound and a header: still refused (the route fails closed)");
ok(mod.tickAllowed({ LOOP_TOKEN: "" }, mkReq("")) === false, "an empty LOOP_TOKEN never matches an empty header");
ok(mod.tickAllowed({ LOOP_TOKEN: "s3cret" }, mkReq()) === false, "a bound token and no header: refused");
ok(mod.tickAllowed({ LOOP_TOKEN: "s3cret" }, mkReq("wrong")) === false, "a bound token and a wrong header: refused");
ok(mod.tickAllowed({ LOOP_TOKEN: "s3cret" }, mkReq("s3cret")) === true, "a bound token and the matching header: allowed");
let touched = 0;
const spyEnv = { AUDIT: { prepare() { touched++; throw new Error("D1 must not be read for an unauthenticated tick"); } } };
const anon = await mod.handlers.fetch(mkReq(), spyEnv);
ok(anon.status === 403 && touched === 0, "an anonymous POST /tick answers 403 and reads no D1", { status: anon.status, touched });
const wrong = await mod.handlers.fetch(mkReq("nope"), Object.assign({ LOOP_TOKEN: "s3cret" }, spyEnv));
ok(wrong.status === 403 && touched === 0, "a wrong x-loop-token answers 403 and reads no D1", { status: wrong.status, touched });
const good = await mod.handlers.fetch(mkReq("s3cret"), Object.assign({ LOOP_TOKEN: "s3cret" }, spyEnv));
ok(good.status !== 403 && touched > 0, "the right x-loop-token passes the gate and runs the tick", { status: good.status, touched });
ok(mod.CAPABILITIES.some((c) => /^manual-tick/.test(c) && /fail closed/.test(c)), "the manual-tick capability says the route fails closed");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
