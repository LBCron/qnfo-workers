// GITHUB-STEWARD-2 offline suite (#5530, pillar security) and the BP26-KILLSWITCH-READERS-1 reader of this worker. No network: global fetch is a fake GitHub and env.AUDIT a tiny fake D1.
//
// Proves: the desired-state diff for each declaration (default workflow token read, workflow pull-request approval false except in QNFO/qnfo-workers, secret scanning and push protection
// on public repositories, Actions and code scanning off on public forks, the organisation website when empty); private repositories, archived repositories and the personal account are
// never read or written; mode off reads nothing, dry (the default) reads and reports and writes nothing, on writes only differences and a second run converges to zero drift; a 403 is a
// recorded refusal with its status, a 422 is a limitation, a rate limit latches and stops further reads; the per-run read cap holds; the kill switch stops a scheduled run, is cached,
// fails open and records one observed event.
// Run: node qnfo-github-steward/settings-reconcile.test.mjs   (exit 0 = all passed)
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } };

const tmp = join(mkdtempSync(join(tmpdir(), "gs2-")), "w.mjs");
writeFileSync(tmp, readFileSync(join(here, "worker.js"), "utf8") + "\nexport { reconcileRepo as __rr, reconcileOrg as __ro, stewardSettingsPlan as __plan, stewardSettingsMode as __mode, stewardSettingsModeRead as __modeRead, killSwitchOn as __ks, killSwitchObserved as __kso, stewardScheduled as __sched, VERSION as __v, STEWARD_SETTINGS_READ_CAP as __cap };\n");
let instance = 0;
const load = async () => import(pathToFileURL(tmp).href + "?i=" + (++instance));
let W = await load();

{ const [maj, min] = W.__v.split(/[.-]/).map(Number); ok(maj > 0 || min >= 16, "the worker is at least 0.16.0 (a minimum, so the next bump does not break this suite)", W.__v); }

const pub = (n, extra) => Object.assign({ full_name: "QNFO/" + n, private: false, fork: false, archived: false, default_branch: "main" }, extra || {});

// ---- the mode switch
ok(W.__mode("off") === "off" && W.__mode("on") === "on" && W.__mode("ON ") === "on" && W.__mode("dry") === "dry" && W.__mode(undefined) === "dry" && W.__mode("whatever") === "dry" && W.__mode(null) === "dry", "mode: off and on are exact, everything else is dry");

// ---- the pure plan
const clean = { workflow: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false } };
const saOn = { security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "enabled" } } };
ok(W.__plan(pub("a"), saOn, clean).length === 0, "plan: a repository that matches needs nothing");
{
  const p = W.__plan(pub("a"), saOn, { workflow: { default_workflow_permissions: "write", can_approve_pull_request_reviews: true } });
  ok(p.length === 1 && p[0].field === "workflow_permissions" && p[0].method === "PUT" && p[0].path === "/repos/QNFO/a/actions/permissions/workflow" && p[0].body.default_workflow_permissions === "read" && p[0].body.can_approve_pull_request_reviews === false, "plan: write token and approval allowed -> PUT read / false", p);
}
{
  const p = W.__plan(pub("qnfo-workers"), saOn, { workflow: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false } });
  ok(p.length === 1 && p[0].body.can_approve_pull_request_reviews === true && p[0].body.default_workflow_permissions === "read", "plan: qnfo-workers is declared with can_approve_pull_request_reviews true", p);
  ok(W.__plan(pub("qnfo-workers"), saOn, { workflow: { default_workflow_permissions: "read", can_approve_pull_request_reviews: true } }).length === 0, "plan: qnfo-workers with approval already allowed needs nothing");
}
{
  const p = W.__plan(pub("a"), { security_and_analysis: { secret_scanning: { status: "disabled" }, secret_scanning_push_protection: { status: "enabled" } } }, clean);
  ok(p.length === 1 && p[0].field === "secret_scanning" && p[0].method === "PATCH" && p[0].path === "/repos/QNFO/a" && p[0].body.security_and_analysis.secret_scanning.status === "enabled" && !("secret_scanning_push_protection" in p[0].body.security_and_analysis), "plan: only the disabled secret-scanning field is written", p);
  const q = W.__plan(pub("a"), { security_and_analysis: { secret_scanning: { status: "disabled" }, secret_scanning_push_protection: { status: "disabled" } } }, clean);
  ok(q.length === 1 && Object.keys(q[0].body.security_and_analysis).length === 2, "plan: both fields when both are off", q);
  ok(W.__plan(pub("a"), {}, clean).length === 0 && W.__plan(pub("a"), null, clean).length === 0, "plan: no security_and_analysis in the body (a credential without Administration) -> nothing written");
}
{
  const fork = pub("some-fork", { fork: true });
  const p = W.__plan(fork, saOn, { actions: { enabled: true }, codeScanning: { state: "configured" } });
  ok(p.length === 2 && p[0].field === "fork_actions" && p[0].body.enabled === false && p[0].method === "PUT" && p[1].field === "fork_code_scanning" && p[1].body.state === "not-configured" && p[1].method === "PATCH", "plan: a fork gets Actions off and code scanning not-configured", p);
  ok(W.__plan(fork, saOn, { actions: { enabled: false }, codeScanning: { state: "not-configured" } }).length === 0, "plan: a fork already off needs nothing");
  ok(W.__plan(fork, saOn, { actions: { enabled: true }, codeScanning: null }).length === 1, "plan: an unreadable code-scanning answer plans only the Actions change");
  ok(W.__plan(fork, saOn, { workflow: { default_workflow_permissions: "write", can_approve_pull_request_reviews: true } }).length === 0, "plan: a fork is not given the workflow-token declaration or secret scanning");
}
ok(W.__plan(pub("p", { private: true }), saOn, { workflow: { default_workflow_permissions: "write" } }).length === 0, "plan: a private repository is never touched");
ok(W.__plan(pub("p", { archived: true }), saOn, { workflow: { default_workflow_permissions: "write" } }).length === 0, "plan: an archived repository is never touched");
ok(W.__plan({ full_name: "rwnq8/x", private: false, fork: false, archived: false }, saOn, { workflow: { default_workflow_permissions: "write" } }).length === 0, "plan: the personal account is never touched");

// ---- a fake GitHub and a fake D1
let calls = [];
const state = {};   // path -> body served by GET; PUT/PATCH on a path mutate it so a second run converges
function reply(status, body, headers) { return { status, headers: { get: (k) => (headers && headers[k.toLowerCase()]) || null }, text: async () => (body === undefined ? "" : JSON.stringify(body)) }; }
function resetWorld() {
  calls = [];
  for (const k of Object.keys(state)) delete state[k];
  state["/repos/QNFO/a"] = { default_branch: "main", private: false, delete_branch_on_merge: true, allow_auto_merge: true, allow_update_branch: true, allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, has_projects: false, security_and_analysis: { secret_scanning: { status: "disabled" }, secret_scanning_push_protection: { status: "disabled" } } };
  state["/repos/QNFO/a/actions/permissions/workflow"] = { default_workflow_permissions: "write", can_approve_pull_request_reviews: true };
  state["/repos/QNFO/qnfo-workers"] = JSON.parse(JSON.stringify(state["/repos/QNFO/a"]));
  state["/repos/QNFO/qnfo-workers/actions/permissions/workflow"] = { default_workflow_permissions: "write", can_approve_pull_request_reviews: false };
  state["/repos/QNFO/f"] = { ...JSON.parse(JSON.stringify(state["/repos/QNFO/a"])), fork: true };
  state["/repos/QNFO/f/actions/permissions"] = { enabled: true };
  state["/repos/QNFO/f/code-scanning/default-setup"] = { state: "configured" };
  state["/repos/QNFO/priv"] = { ...JSON.parse(JSON.stringify(state["/repos/QNFO/a"])), private: true };
  state["/orgs/QNFO"] = { default_repository_permission: "read", members_can_create_public_repositories: false, has_organization_projects: true, blog: "" };
  state["/orgs/QNFO/actions/permissions/workflow"] = { default_workflow_permissions: "write", can_approve_pull_request_reviews: true };
}
let refuse = {};   // "METHOD path" -> [status, body]
function fakeFetch() {
  return async (url, init) => {
    const path = String(url).replace("https://api.github.com", "");
    const method = (init && init.method) || "GET";
    calls.push(method + " " + path);
    if (refuse[method + " " + path]) { const [st, b, h] = refuse[method + " " + path]; return reply(st, b, h); }
    if (/\/branches\/main\/protection$/.test(path)) return reply(200, {});
    if (method === "GET") return state[path] ? reply(200, state[path]) : reply(404, { message: "Not Found" });
    const body = init && init.body ? JSON.parse(init.body) : {};
    if (!(path in state)) return reply(404, { message: "Not Found" });
    if (path === "/repos/QNFO/f/actions/permissions" && method === "PUT") state[path].enabled = body.enabled;
    else if (path.endsWith("/code-scanning/default-setup")) state[path].state = body.state;
    else if (path.endsWith("/actions/permissions/workflow")) Object.assign(state[path], body);
    else if (path === "/orgs/QNFO") Object.assign(state[path], body);
    else if (/^\/repos\/QNFO\/[^/]+$/.test(path) && body.security_and_analysis) { const sa = state[path].security_and_analysis; for (const k of Object.keys(body.security_and_analysis)) sa[k] = body.security_and_analysis[k]; }
    return reply(200, {});
  };
}
globalThis.fetch = fakeFetch();
const R = () => ({ drift: [], limitations: [], errors: [], repos_fixed: 0, repos_protected: 0 });
const repoWrites = () => calls.filter((c) => /^(PUT|PATCH|POST) /.test(c) && !/branches\/main\/protection/.test(c));
const env = { GITHUB_TOKEN: "t" };
const listed = (n, extra) => Object.assign({ full_name: "QNFO/" + n, private: false, fork: false, archived: false, default_branch: "main" }, extra || {});

// ---- mode off: nothing read, nothing written
resetWorld();
{
  const res = R(); res.settings_mode = "off";
  await W.__rr(env, listed("a"), res);
  ok(!calls.some((c) => /actions\/permissions|code-scanning/.test(c)) && res.settings === undefined, "off: no settings read and no settings object", calls);
}

// ---- dry (the default): reads and reports, writes nothing
resetWorld();
{
  const res = R(); res.settings_mode = "dry";
  await W.__rr(env, listed("a"), res);
  await W.__rr(env, listed("f", { fork: true }), res);
  await W.__rr(env, listed("priv", { private: true }), res);
  const w = repoWrites();
  ok(w.length === 0, "dry: no PUT, PATCH or POST at all", w);
  ok(calls.includes("GET /repos/QNFO/a/actions/permissions/workflow") && calls.includes("GET /repos/QNFO/f/actions/permissions") && calls.includes("GET /repos/QNFO/f/code-scanning/default-setup"), "dry: the three reads happen", calls);
  ok(!calls.some((c) => /QNFO\/priv\/(actions|code-scanning)/.test(c)), "dry: a private repository gets no settings read", calls);
  const d = res.settings.drift;
  ok(res.settings.mode === "dry" && d.workflow_permissions === 1 && d.secret_scanning === 1 && d.fork_actions === 1 && d.fork_code_scanning === 1 && Object.keys(res.settings.fixed).length === 0 && res.settings.repos_considered === 2, "dry: drift counted per setting, nothing fixed, the private repository not considered", res.settings);
}

// ---- on: writes only differences; a second run converges to zero drift
resetWorld();
{
  const res = R(); res.settings_mode = "on";
  await W.__rr(env, listed("a"), res);
  await W.__rr(env, listed("qnfo-workers"), res);
  await W.__rr(env, listed("f", { fork: true }), res);
  const w = calls.filter((c) => /^(PUT|PATCH) /.test(c) && !/branches/.test(c));
  ok(w.includes("PUT /repos/QNFO/a/actions/permissions/workflow") && w.includes("PUT /repos/QNFO/qnfo-workers/actions/permissions/workflow") && w.includes("PUT /repos/QNFO/f/actions/permissions") && w.includes("PATCH /repos/QNFO/f/code-scanning/default-setup") && w.includes("PATCH /repos/QNFO/a") && w.includes("PATCH /repos/QNFO/qnfo-workers"), "on: every difference is written", w);
  ok(state["/repos/QNFO/a/actions/permissions/workflow"].default_workflow_permissions === "read" && state["/repos/QNFO/a/actions/permissions/workflow"].can_approve_pull_request_reviews === false, "on: a ends with a read-only token that cannot approve");
  ok(state["/repos/QNFO/qnfo-workers/actions/permissions/workflow"].can_approve_pull_request_reviews === true && state["/repos/QNFO/qnfo-workers/actions/permissions/workflow"].default_workflow_permissions === "read", "on: qnfo-workers keeps can_approve_pull_request_reviews true with a read token");
  ok(state["/repos/QNFO/f/actions/permissions"].enabled === false && state["/repos/QNFO/f/code-scanning/default-setup"].state === "not-configured", "on: the fork ends with Actions off and code scanning not configured");
  ok(Object.values(res.settings.fixed).reduce((x, y) => x + y, 0) >= 6, "on: fixed counted", res.settings.fixed);
  calls = [];
  const res2 = R(); res2.settings_mode = "on";
  await W.__rr(env, listed("a"), res2);
  await W.__rr(env, listed("qnfo-workers"), res2);
  await W.__rr(env, listed("f", { fork: true }), res2);
  ok(Object.keys(res2.settings.drift).length === 0 && Object.keys(res2.settings.fixed).length === 0 && repoWrites().length === 0, "on: the second run records zero drift and writes nothing", { s: res2.settings, w: repoWrites() });
}

// ---- refusals: 403 is recorded with its status, 422 is a limitation, nothing is retried with another credential
resetWorld();
refuse = { "PUT /repos/QNFO/a/actions/permissions/workflow": [403, { message: "Resource not accessible by integration" }], "PATCH /repos/QNFO/a": [422, { message: "Secret scanning is not available for this repository" }] };
{
  const res = R(); res.settings_mode = "on";
  await W.__rr(env, listed("a"), res);
  const s = res.settings;
  ok(s.refused.length === 1 && s.refused[0].repo === "QNFO/a" && s.refused[0].field === "workflow_permissions" && s.refused[0].status === 403 && /not accessible/.test(s.refused[0].why), "refusal: a 403 is recorded with repo, field, status and text", s.refused);
  ok(s.limitations.length === 1 && /secret_scanning \(422/.test(s.limitations[0]), "refusal: a 422 is a limitation", s.limitations);
  ok(calls.filter((c) => c === "PUT /repos/QNFO/a/actions/permissions/workflow").length === 1, "refusal: the write is attempted once, not retried", calls);
  ok(res.errors.length === 0, "refusal: not an error entry", res.errors);
}
refuse = {};

// ---- the read cap
resetWorld();
{
  const res = R(); res.settings_mode = "dry";
  res.settings = { mode: "dry", repos_considered: 0, reads: W.__cap, drift: {}, fixed: {}, refused: [], limitations: [], org_actions_workflow: null, org_blog: null };
  await W.__rr(env, listed("a"), res);
  ok(!calls.some((c) => /actions\/permissions/.test(c)) && res.settings.drift.workflow_permissions === undefined, "cap: with the per-run read budget spent no settings read is made and nothing is guessed", calls);
}

// ---- the organisation: reports the token defaults, writes the website only when empty and only in on
resetWorld();
{
  const res = R(); res.settings_mode = "dry";
  await W.__ro(env, res);
  ok(res.settings.org_actions_workflow.default_workflow_permissions === "write" && res.settings.org_actions_workflow.can_approve_pull_request_reviews === true, "org: both workflow-token values are reported", res.settings.org_actions_workflow);
  ok(!calls.some((c) => /^(PUT|PATCH) \/orgs\/QNFO\/actions/.test(c)), "org: the organisation workflow-token defaults are never written");
  ok(res.settings.drift.org_blog === 1 && !calls.some((c) => c === "PATCH /orgs/QNFO" && false) && state["/orgs/QNFO"].blog === "", "org dry: an empty website is counted and not written", res.settings);
}
resetWorld();
{
  const res = R(); res.settings_mode = "on";
  await W.__ro(env, res);
  ok(state["/orgs/QNFO"].blog === "https://qnfo.org" && res.settings.fixed.org_blog === 1, "org on: the empty website is set to https://qnfo.org", state["/orgs/QNFO"]);
  calls = [];
  const res2 = R(); res2.settings_mode = "on";
  await W.__ro(env, res2);
  ok(!calls.some((c) => c === "PATCH /orgs/QNFO") && !res2.settings.drift.org_blog, "org on: a second run (website set) writes nothing");
}
resetWorld();
state["/orgs/QNFO"].blog = "https://example.org/own";
{
  const res = R(); res.settings_mode = "on";
  await W.__ro(env, res);
  ok(state["/orgs/QNFO"].blog === "https://example.org/own", "org on: a website someone set is never overwritten");
}

// ---- a rate limit latches: no further settings read
W = await load();
resetWorld();
refuse = { "GET /repos/QNFO/a/actions/permissions/workflow": [429, { message: "rate limit" }, { "retry-after": "30" }] };
{
  const res = R(); res.settings_mode = "on";
  await W.__rr(env, listed("a"), res);
  const before = calls.length;
  await W.__rr(env, listed("f", { fork: true }), res);
  ok(!calls.slice(before).some((c) => /QNFO\/f\/(actions|code-scanning)/.test(c)), "rate limit: after a 429 the next repository's settings are not read", calls.slice(before));
  ok(repoWrites().length === 0, "rate limit: nothing is written", repoWrites());
}
refuse = {};

// ---- the mode read from ops_config
function fakeAudit(rows, opts) {
  const o = opts || {};
  const events = [];
  return {
    events,
    prepare(sql) {
      return { bind(...args) {
        return {
          async first() {
            if (o.fail) throw new Error("D1 DB is overloaded");
            if (/FROM ops_config WHERE key = 'steward_settings_enforce'/.test(sql)) return rows.steward_settings_enforce === undefined ? null : { value: rows.steward_settings_enforce };
            if (/FROM ops_config WHERE key = 'fleet_kill_switch'/.test(sql)) return rows.fleet_kill_switch === undefined ? null : { value: rows.fleet_kill_switch };
            if (/FROM cloud_ops_events WHERE kind = 'kill-switch.observed'/.test(sql)) return events.length ? { id: events[0].id } : null;
            return null;
          },
          async run() { if (/INSERT INTO cloud_ops_events/.test(sql)) events.push({ id: args[0], ts: args[1], text: args[2] }); return { meta: { changes: 1 } }; },
          async all() { return { results: [] }; }
        };
      }, async first() { return this.bind().first(); } };
    }
  };
}
ok(await W.__modeRead({}) === "dry", "mode read: no D1 binding -> dry");
ok(await W.__modeRead({ AUDIT: fakeAudit({}) }) === "dry", "mode read: no row -> dry");
ok(await W.__modeRead({ AUDIT: fakeAudit({ steward_settings_enforce: "on" }) }) === "on" && await W.__modeRead({ AUDIT: fakeAudit({ steward_settings_enforce: "off" }) }) === "off", "mode read: the row decides");
ok(await W.__modeRead({ AUDIT: fakeAudit({}, { fail: true }) }) === "dry", "mode read: a D1 error -> dry, never throws");

// ---- the kill switch
W = await load();
globalThis.fetch = async () => { throw new Error("no network call may happen while the kill switch is on"); };
{
  const audit = fakeAudit({ fleet_kill_switch: "on" });
  const e1 = { AUDIT: audit, GITHUB_TOKEN: "t" };
  ok(await W.__ks(e1) === true, "kill switch: on is read");
  await W.__sched({ cron: "5,15,25,35,45,55 * * * *" }, e1, { waitUntil() {} });
  ok(audit.events.length === 1 && /fleet_kill_switch = on/.test(audit.events[0].text), "kill switch: a scheduled run stops before any GitHub call and records one observed event", audit.events);
  await W.__sched({ cron: "15 * * * *" }, e1, { waitUntil() {} });
  ok(audit.events.length === 1, "kill switch: a second run inside five minutes adds no second event (and the flag is served from the 30 s cache)", audit.events);
}
W = await load();
{
  const e2 = { AUDIT: fakeAudit({}, { fail: true }) };
  const errs = []; const oe = console.error; console.error = (m) => errs.push(String(m));
  ok(await W.__ks(e2) === false, "kill switch: an unreadable row fails open (off)");
  console.error = oe;
  ok(errs.some((m) => /failed_open/.test(m)), "kill switch: the failed read is logged", errs);
}
W = await load();
ok(await W.__ks({ AUDIT: fakeAudit({ fleet_kill_switch: "off" }) }) === false && (await load().then((M) => M.__ks({ AUDIT: fakeAudit({ fleet_kill_switch: "ON" }) }))) === true && (await load().then((M) => M.__ks({ AUDIT: fakeAudit({}) }))) === false, "kill switch: off and absent are off; the value is trimmed and case-insensitive");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
