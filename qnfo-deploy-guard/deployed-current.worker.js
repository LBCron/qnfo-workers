// qnfo-deploy-guard v1.4.4 (SCHEDULED-FLEET-PROBE-SHARING-1 #6669: share scheduled fleet census; OPS-PROBE-TIMEOUT-RECOVERY-1: retry a timed-out ops probe once and cancel outstanding requests; DEPLOY-LEDGER-EVENT-ORDER-1: use deploy event timestamps instead of insertion order when selecting the last code deployment, so a delayed historical mirror cannot supersede a newer canonical deploy; WORKERS-BUILDS-TOMBSTONE-1: a content-verified Workers Builds deploy of the retired repository-root stub is LEDGERED as TOMBSTONE-STUB instead of filing UNLOGGED-MUTATION/UNCOORDINATED-DEPLOY; CLAIM-TERMINAL-RELEASE-1; SECOND-PATH-CANONICAL-1: a successful deploy by canonical-deploy.yml's second path, direct_content_deploy, is not a non-canonical deploy; LEASE-TOKEN-CSPRNG-1: lease tokens come from crypto.getRandomValues; SECRET-ONLY-LEDGER-1: a ledgered secret rotation is not a code deploy for NON-CANONICAL-DEPLOY-1) - deploy lock + secret lock + work claims (one procedure: the D1 work_claims ledger and the code loop's tasks are read and written by /work-lock) + concurrent-mutation detector + cost watchdog + heartbeat (expected_version enforcement + per-session attribution + registry version refresh on redeploy + NON-CANONICAL-DEPLOY-1 detection excluding synthetic/test rows AND failed canonical attempts + SETTINGS-ONLY ledger rows + DEPLOY-TICKET-AUTORESOLVE-1 + CAPABILITY-SNAPSHOT-1 + WORK-CLAIM-1 + WORK-CLAIM-UNIFY-1)
// Worker Contract v1: VERSION constant + GET /health
// Data: https://ops.qnfo.org/fleet (modified_on per worker) + https://ops.qnfo.org/cost (spend)
// NOTE: source of truth is this file; GET /workers/scripts/<name> TRUNCATES large bodies - never patch from a GET.
var LEDGER_GRACE_MS = 180000;
var VERSION = "1.4.6"; /* SCHEDULED-FLEET-PROBE-SHARING-1 (#6669): reuse the same scheduled fleet probe across scan and capability snapshot. */ /* OPS-PROBE-TIMEOUT-RECOVERY-1 (#6429): bounded retry and request cleanup. */ /* 1.4.1 DEPLOY-LEDGER-EVENT-ORDER-1: use deploy event time, not ledger insertion order, when choosing the last code deploy. 1.4.0 BP26-LEASES-KILLSWITCH-1 (2026-10-28, pillar autonomy, agent_issues 1000361; minor: two capabilities and a decision this worker now takes on its own). (a) Global kill switch: ops_config fleet_kill_switch = on makes workAcquire (fresh claims and renewals) and POST /lock/acquire (deploy locks and secret leases) answer 503 reason kill-switch, so no new claim, deploy or secret write starts while it is on; releases, reads, the sweep and /health keep working; the first refusal in five minutes writes one cloud_ops_events row of kind kill-switch.observed; GET /kill-switch reads the state. The flag is read with a 30 second cache, off when the row or table is absent. (b) Fencing tokens: every fresh work claim takes the next fence number for its path (work_claims.fence, migration 2026-10-28-bp26-leases-killswitch.sql; the claim still works while the column is absent), acquire and renew return it, and POST /work-lock/check {key, token, fence} answers valid only when the token holds the live claim and the fence is the live one, so a writer that lost its lease cannot pass. docs/KILL-SWITCH-DRILL.md and docs/LEASES-FENCING.md. prior 1.3.34-codeagent */ /* LEASE-EXPIRY-SWEEP-1 (2026-10-26, orphaned_leases 215): a work_claims row past expires_at and never released is closed with outcome expired on every acquire and on the 20-minute tick, so the BP26 lease metric counts sessions that died holding a claim and then settles. */ /* COMPAT-RISK-TIMER-NAME-1 (2026-10-25, unblocks red main): the four fetch-timeout blocks named their setTimeout handle `t`, and a DIFFERENT `t` (a timestamp from ms(row.ts)) in another function is compared numerically within 60 lines, so scripts/compat-risk-scan.mjs linked them by name across function scopes and reported timer-ids for a worker that never reads a timer id as a number. Renamed to timerId; scan is clean and the guard keeps its full meaning. */ /* WORKERS-BUILDS-TOMBSTONE-1 (2026-10-25, agent_issues 1000142): a Workers Builds rebuild of the retired repository-root stub is ledgered, not filed. CLAIM-TERMINAL-RELEASE-1 (2026-10-18): CODE_TASK_DONE now includes superseded, so the guard stops counting a superseded task as live work on its file. */
var WORKER = "qnfo-deploy-guard";
var LOCK_PREFIX = "deploylock:";
var DENY_PREFIX = "deploydeny:";
var SNAP_KEY = "deploywatch:snapshot";
var REPORT_KEY = "deploywatch:report";
var THR_KEY = "guard:cost_thresholds";
var DEFAULT_TTL = 900; var MAX_TTL = 7200;
var FLEET_URLS = ["https://ops.qnfo.org/fleet", "https://qnfo-ops.q08.workers.dev/fleet"];
var COST_URLS = ["https://ops.qnfo.org/cost", "https://qnfo-ops.q08.workers.dev/cost"];
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }); }
function nowIso() { return new Date().toISOString(); }
// LEASE-TOKEN-CSPRNG-1 (1.3.24, WORKERS-STANDARDS-1): a lease token is a bearer secret (whoever holds it can release or
// renew the deploy lock, a secret lock or a work claim), so it comes from crypto.getRandomValues, not Math.random. Same
// shape as before: 16 characters of [a-z0-9]. Bytes at or above 252 are redrawn so every character is equally likely.
var TOK_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function tok() {
  var out = "";
  while (out.length < 16) {
    var buf = crypto.getRandomValues(new Uint8Array(24));
    for (var i = 0; i < buf.length && out.length < 16; i++) { if (buf[i] < 252) out += TOK_ALPHABET[buf[i] % 36]; }
  }
  return out;
}
function ms(s) { if (!s) return NaN; var v = new Date(String(s).replace(" ", "T") + (String(s).indexOf("Z") >= 0 ? "" : "Z")).getTime(); return isNaN(v) ? NaN : v; }
// OPS-PROBE-TIMEOUT-RECOVERY-1 (#6429): race both URLs through body parsing, cancel outstanding
// requests on every exit, and retry a shared timeout once with a fresh signal. The explicit
// deadline also bounds a fetch/body that does not settle on abort; persistent failures still log.
function getJson(urls, tout, probe) {
  return (async function () {
    var timeoutMs = tout || 15000;
    for (var attempt = 0; attempt < 2; attempt++) {
      var c = new AbortController();
      var timedOut = false;
      var timerId;
      var deadline = new Promise(function (_, reject) {
        timerId = setTimeout(function () {
          timedOut = true;
          reject(new Error("TimeoutError: exceeded " + timeoutMs + "ms"));
          c.abort();
        }, timeoutMs);
      });
      var attempts = urls.map(function (u) {
        return Promise.resolve().then(function () { return fetch(u, { signal: c.signal, headers: { accept: "application/json" } }); }).then(function (r) {
          if (!r.ok) throw new Error("status " + r.status);
          return r.json().then(function (j) {
            if (!j) throw new Error("empty body");
            return { ok: true, j: j, url: u };
          });
        }).catch(function (e) {
          var host = "unknown endpoint";
          try { host = new URL(u).host; } catch (_) {} // standards-ok: URL label fallback only; the request failure is logged below.
          var name = String((e && e.name) || "Error");
          var message = String((e && e.message) || e || "request rejected").slice(0, 160);
          throw new Error(host + ": " + name + ": " + message);
        });
      });
      try { return await Promise.race([Promise.any(attempts), deadline]); }
      catch (e) {
        if (timedOut && attempt === 0) continue;
        var reasons = e && Array.isArray(e.errors) ? e.errors : [];
        var detail = reasons.length ? reasons.map(function (reason) { return String((reason && reason.message) || reason); }).join("; ") : String((e && e.message) || e);
        console.error(JSON.stringify({ evt: "deploy-guard:getJson:caught", probe: probe || "unknown", error: detail.slice(0, 500), attempts: attempt + 1 }));
        return { ok: false, j: null, url: null };
      }
      finally { clearTimeout(timerId); c.abort(); }
    }
  })();
}
// DECISION (2026-09-21): the lock is backed by D1 deploy_locks (STRONGLY consistent). It was on KV,
// whose reads are eventually consistent: a release followed by an immediate acquire could still observe
// the stale lock and refuse (live-reproduced: acquire -> release(released:true) -> acquire REFUSED).
async function sha256hex(s) { var b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))); var a = new Uint8Array(b), o = ""; for (var i = 0; i < a.length; i++) o += ("0" + a[i].toString(16)).slice(-2); return o; }
async function readLock(env, w) { var rows = await auditAll(env, "SELECT worker, owner, since, expires_at, expected_version FROM deploy_locks WHERE worker=?1 AND typeof(expires_at) IN ('integer','real') AND expires_at > ?2 LIMIT 1", [w, Date.now()]); return (rows && rows.length) ? rows[0] : null; }
async function auditRun(env, sql, params) { try { var st = env.AUDIT.prepare(sql); return await st.bind.apply(st, params || []).run(); } catch (e) { return { ok: false, error: String(e && e.message || e) }; } }
async function auditAll(env, sql, params) { try { var st = env.AUDIT.prepare(sql); var b = params && params.length ? st.bind.apply(st, params) : st; var r = await b.all(); return (r && r.results) || []; } catch (e) { return []; } }
async function fileIssue(env, title, desc, priority) {
  var ex = await auditAll(env, "SELECT id FROM agent_issues WHERE status=?1 AND title=?2 LIMIT 1", ["open", title]);
  if (ex && ex.length) return { filed: false, existing: ex[0].id };
  var now = Date.now();
  // 4000, not 900: a coalesced burst carries its full worker list, and autoResolve() parses it back. At 900 a
  // 48-worker list was cut mid-array, which would leave the ticket unparseable and therefore never resolvable.
  var res = await auditRun(env, "INSERT INTO agent_issues (title, description, source, category, priority, status, linked_session, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)", [title, String(desc).slice(0, 4000), "qnfo-deploy-guard", "reliability", priority || "high", "open", "qnfo-deploy-guard/" + VERSION, now, now]);
  return { filed: true, ok: res && res.ok !== false, error: res && res.error };
}
// ALERTS-CHAIN-NO-CONSUMER-1 (2026-09-23): deploy-guard alerts are INFORMATIONAL self-notifications -
// the actionable output is the agent_issues it files. Writing digested=0 fed a queue with no consumer,
// permanently sticking the alerts integration chain (9 of 10 undigested). Self-digest (digested=1): the
// alert is a log entry, not a pending queue item.
async function fileAlert(env, level, message) { await auditRun(env, "INSERT INTO alerts (source, level, message, digested, created_at) VALUES (?1,?2,?3,1,?4)", ["qnfo-deploy-guard", level, String(message).slice(0, 500), nowIso()]); }
// REGISTRY-UNREGISTERED-WORKER-2 (2026-09-21): register-at-deploy. Any live worker absent from
// service_registry (the census authority) gets a stub row immediately, cutting the drift window
// from qnfo-register-guard's 24h to <=10min. The daily register-guard still does the full reconcile.
async function ensureRegistry(env, fleet) {
  var added = [];
  try {
    var have = await auditAll(env, "SELECT service FROM service_registry", []);
    var set = {}; for (var i = 0; i < have.length; i++) set[have[i].service] = 1;
    for (var j = 0; j < (fleet || []).length; j++) {
      var w = String((fleet[j] && fleet[j].name) || ""); if (!w || set[w]) continue;
      await auditRun(env, "INSERT OR IGNORE INTO service_registry (service, kind, version, base_url, purpose, capabilities, routes, tools, models, deps, updated_at, state) VALUES (?1,'worker',NULL,?2,'AUTO-REGISTERED by deploy-guard: live worker absent from the registry (register-at-deploy); purpose/bindings pending full reconcile','[]','[\"/health\']','','','[]',?3,'live')", [w, "https://" + w + ".q08.workers.dev", nowIso()]);
      set[w] = 1; added.push(w);
    }
  } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:ensureRegistry:caught", error: String((e && e.message) || e) })); }
  return added;
}
// REGISTRY-VERSION-CURRENCY-1 (2026-09-21): on redeploy, fetch the worker's live /health and
// UPDATE service_registry.version. The prior register-at-deploy wrote only a first-seen stub
// (version NULL or stale), so /lock/acquire's expected_version check compared against a stale
// value and refused valid redeploys with a false "version-mismatch".
async function refreshRegistryVersion(env, w, explicitVer) {
  try {
    // FM6 VERIFY-BEFORE-ADVANCE (2026-09-26): always read the LIVE /health first. The old form
    // let explicitVer (the deployer's CLAIMED version) win unconditionally, so a FAILED deploy
    // that still POSTed /ledger with to=<claim> advanced service_registry.version and wedged
    // every later deploy (registry-as-truth, deploy-guard expected_version). Now the claim is
    // recorded ONLY when the live worker agrees; a claim the live worker does not report is
    // REFUSED (no registry write), so a failed deploy can never wedge the guard.
    var liveVer = "";
    try {
      var url = "https://" + w + ".q08.workers.dev/health";
      var c = new AbortController(); var timerId = setTimeout(function () { c.abort(); }, 8000);
      var r = await fetch(url, { signal: c.signal, headers: { accept: "application/json" } });
      clearTimeout(timerId);
      if (r.ok) { var j = await r.json(); if (j && j.version) liveVer = String(j.version); }
    } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:refreshRegistryVersion:caught", error: String((e && e.message) || e) })); }
    var ver = "";
    if (explicitVer && String(explicitVer)) {
      if (liveVer && liveVer !== String(explicitVer)) return null;
      ver = String(explicitVer);
    } else if (liveVer) {
      ver = liveVer;
    }
    if (!ver) return null;
    await auditRun(env, "UPDATE service_registry SET version=?1, updated_at=?2 WHERE service=?3", [ver, nowIso(), w]);
    return ver;
  } catch (e) { return null; }
}
// ANOMALY-BURST-COALESCE-1 (2026-09-30): fileIssue() dedupes only by exact open title and the per-worker title
// embeds the worker name, so one bulk out-of-band mutation of N workers filed N separate high-priority tickets in a
// single scan (48 DEPLOY-UNLOGGED-MUTATION issues in ~9 s, half of the open agent_issues backlog: file rate beat
// close rate). When more than BURST_MAX distinct workers share an anomaly type in one scan, replace them with ONE
// fleet-level anomaly that carries the count and the full worker list, so nothing is lost and one open ticket
// (deduped by its stable title) covers the whole event. A genuine one-off (<= BURST_MAX) still files per worker.
var BURST_MAX = 3;
var BURST_TYPES = ["unlogged-mutation", "uncoordinated-deploy"];
function coalesceBursts(list) {
  var out = list.slice();
  for (var bt = 0; bt < BURST_TYPES.length; bt++) {
    var type = BURST_TYPES[bt];
    var grp = out.filter(function (x) { return x.type === type; });
    if (grp.length <= BURST_MAX) continue;
    out = out.filter(function (x) { return x.type !== type; });
    var names = grp.map(function (x) { return x.worker; });
    out.push({ type: type, worker: "fleet", count: grp.length, workers: names });
  }
  return out;
}
// DEPLOY-TICKET-AUTORESOLVE-1 (2026-09-30): the guard FILED tickets but nothing ever CLOSED them. Measured: 48 of
// the 106 open agent_issues were deploy-guard rows, most superseded minutes later by a ledgered canonical redeploy
// (fleet_deploys ids 915-1005, 15:51-15:54Z) -- file rate beat close rate by construction. A ticket now resolves
// on POSITIVE evidence only, re-evaluated every scan:
//   event anomalies (unlogged-mutation / uncoordinated-deploy, per worker or a coalesced fleet burst) resolve when
//     the worker is no longer live, OR a successful ledgered deploy postdates the ticket and nothing mutated after
//     it, OR worker_live_audit verified the live code == repo canonical (SYNC, content-hash) after the ticket and
//     nothing mutated after that verification;
//   state anomalies (non-canonical-deploy / lock-contention / cost-threshold) resolve when this scan no longer
//     observes them.
// Never resolved: a ticket whose anomaly re-occurs in this scan, or any ticket when the fleet probe failed.
// LIMITATION, STATED: the SYNC rule proves the live CODE is canonical; it cannot attribute a settings-only change.
// That is why settings mutators now ledger themselves (SETTINGS-ONLY-LEDGER-1, fleet-control obs reassert).
function isSettingsOnly(note) { return String(note || "").indexOf("SETTINGS-ONLY") === 0; }
function isLaterDeploy(candidate, current) {
  if (!current) return true;
  var candidateTs = ms(candidate && candidate.ts), currentTs = ms(current && current.ts);
  if (!isFinite(candidateTs)) return !isFinite(currentTs) && Number(candidate.id || 0) > Number(current.id || 0);
  if (!isFinite(currentTs)) return true;
  return candidateTs > currentTs || (candidateTs === currentTs && Number(candidate.id || 0) > Number(current.id || 0));
}
// SECRET-ONLY-LEDGER-1 (v1.3.23, 2026-10-05, agent_issues 1976): a secret PUT also bumps the worker's CF version, so its
// writer ledgers it (it satisfies the unlogged-mutation rule), but it changes no code. On 2026-10-04 12:36Z the k1 rotation on
// qnfo-ops (fleet_deploys 3419, actor "deepchat/ops secret-rotate", to_sha "k1-rotated") became qnfo-ops's "last code deploy"
// and raised DEPLOY-NON-CANONICAL-DEPLOY: fleet although the fleet self-audit read qnfo-ops SYNC (version and sha256) with
// main. A row whose note starts SECRET-ONLY, or whose actor or note names a secret rotate/put/set and which carries no code
// version, is not a code deploy for NON-CANONICAL-DEPLOY-1. Secret changes stay watched by qnfo-ops SECRET-CHANGE-WATCH-1.
function isSecretOnly(row) {
  var n = String(row && row.note || ""), a = String(row && row.actor || ""), v = String(row && row.to_sha || "");
  if (n.indexOf("SECRET-ONLY") === 0) return true;
  return /secret[- ]?(rotat|put|set\b|change)/i.test(a + " " + n) && !/^v?\d+\.\d+/.test(v);
}
// SECOND-PATH-CANONICAL-1 (v1.3.25, 2026-10-13, agent_issues 2391): canonical-deploy.yml has a second deploy path
// (DEPLOY-SECOND-PATH-1, agent_issues 2178): when /ops/deploy does not answer for a target, scripts/direct_content_deploy.py
// PUTs the same main code to Cloudflare's /content endpoint and ledgers it in deployment_history as deployed_by
// "canonical-deploy/direct_content_deploy" (mirrored into fleet_deploys with that actor). That is the canonical workflow's own
// path, so a successful row of it is not a non-canonical deploy; its note lacks "opsDeploy route", so every fallback (idea-hub,
// 2026-10-13 06:54Z, fleet_deploys 5795) raised DEPLOY-NON-CANONICAL-DEPLOY: fleet again and issue_refile_reopen reopened 2391.
// A failed attempt of the second path (ok 0) is still flagged, as a failed canonical attempt is.
var SECOND_PATH_ACTOR = "canonical-deploy/direct_content_deploy";
function isSecondPath(row) { return String(row && row.actor || "") === SECOND_PATH_ACTOR; }
// WORKERS-BUILDS-TOMBSTONE-1 (v1.3.29, 2026-10-25, agent_issues 1000142): the repository root of QNFO/qnfo-workers
// carries a RETIRED stub (worker.js answers 410 for every path) and the Cloudflare Workers Builds (git integration)
// rebuilds it as worker "qnfo-workers" on every non-[skip ci] push. That path writes no fleet_deploys row and holds no
// lock, so every build filed UNLOGGED-MUTATION + UNCOORDINATED-DEPLOY (agent_issues 1000135/1000136, 2026-10-25 07:37Z).
// The deploy is benign and owner-configured; the correct record is a ledger row, not a ticket.
//
// The test is CONTENT, never name alone, so it cannot launder a real deploy:
//   * two DISTINCT paths must return the SAME 410 body (the stub's fetch ignores the request; a real worker would 404
//     on the random path, and a worker that special-cased / to look inert would fail the second path);
//   * that body must carry the retired-stub marker and stay under 1024 bytes;
//   * only worker "qnfo-workers" is eligible.
// A code deploy through the root config answers 200 or a different body, and still fires both tickets.
var TOMBSTONE_WORKER = "qnfo-workers";
var TOMBSTONE_MARK = "stale duplicate of qnfo-paper-indexer";
var TOMBSTONE_MAX_BYTES = 1024;
// Like isSettingsOnly/isSecretOnly, a tombstone row is a real mutation but NOT a code deploy: it satisfies the
// unlogged-mutation rule and must never stand in for the worker's last code deploy (NON-CANONICAL-DEPLOY-1) nor
// supersede unknown code in workerSettled().
function isTombstoneOnly(note) { return String(note || "").indexOf("TOMBSTONE-STUB") === 0; }
async function tombstoneBody(name) {
  if (name !== TOMBSTONE_WORKER) return null;
  var out = [];
  var paths = ["/", "/__tombstone_probe"];
  for (var i = 0; i < paths.length; i++) {
    try {
      var c = new AbortController(); var timerId = setTimeout(function () { c.abort(); }, 8000);
      var r = await fetch("https://" + name + ".q08.workers.dev" + paths[i], { signal: c.signal, headers: { accept: "application/json" } });
      clearTimeout(timerId);
      if (r.status !== 410) return null;
      var b = await r.text();
      if (b.length >= TOMBSTONE_MAX_BYTES || b.indexOf(TOMBSTONE_MARK) < 0) return null;
      out.push(b);
    } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:tombstoneBody:caught", error: String((e && e.message) || e) })); return null; }
  }
  return out[0] === out[1] ? out[0] : null;
}
async function ledgerTombstone(env, name) {
  var body = await tombstoneBody(name);
  if (!body) return false;
  var note = "TOMBSTONE-STUB: Workers Builds deploy of the retired repository-root stub for " + name + " (HTTP 410, " + body.length + " B, identical body on / and /__tombstone_probe, no bindings); benign and owner-configured (qnfo-workers/wrangler.toml). Not a code deploy.";
  var r = await auditRun(env, "INSERT INTO fleet_deploys (worker, actor, session_id, from_sha, to_sha, source_path, ok, note, ts) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)", [name, "workers-builds/git-integration", null, null, null, "workers-builds", 1, note.slice(0, 400), nowIso()]);
  return !(r && r.ok === false);
}
var MUT_SLACK_MS = 180000;
// WRANGLER-CONTAINER-LEDGER-1 (#1708/#1709): qnfo-code-orchestrator is also a container worker deployed by wrangler
// (deploy-code-orchestrator.yml) because canonical-deploy skips any directory with [[containers]]. It is NOT in qnfo-ops
// _CONTAINER_WORKERS (it never reaches /ops/deploy), so this list is the pilot (which mirrors qnfo-ops) plus the orchestrator.
var CONTAINER_WORKERS = ["qnfo-containers-pilot", "qnfo-code-orchestrator"];
var EVENT_TYPES = { "UNLOGGED-MUTATION": "unlogged-mutation", "UNCOORDINATED-DEPLOY": "uncoordinated-deploy" };
function workerSettled(w, since, rc) {
  if (rc.haveLive && !rc.liveNames[w]) return "worker no longer live (retired/disposed)";
  var mo = rc.snapshot[w] ? ms(rc.snapshot[w].mo) : NaN;
  // best = newest successful CODE deploy after the ticket; lastLogged = newest successful ledger row of any kind.
  // A SETTINGS-ONLY row can cover a later mutation, but it can never be the deploy that supersedes unknown code.
  var rows = rc.ledgerBy[w] || []; var best = null; var lastLogged = -Infinity;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].ok === 0) continue;
    var t = ms(rows[i].ts);
    if (!isFinite(t)) continue;
    if (t > lastLogged) lastLogged = t;
    if (!isSettingsOnly(rows[i].note) && !isTombstoneOnly(rows[i].note) && t > since && (!best || t > best.t)) best = { t: t, r: rows[i] };
  }
  if (best && (!isFinite(mo) || mo <= lastLogged + MUT_SLACK_MS)) return "superseded by ledgered deploy fleet_deploys.id=" + best.r.id + " at " + best.r.ts + " (" + String(best.r.note || "").slice(0, 60) + ")";
  var au = rc.audit[w];
  if (au && Number(au.match) === 1 && au.note === "SYNC") {
    var pt = ms(au.probed_at);
    if (isFinite(pt) && pt > since && (!isFinite(mo) || mo <= pt)) return "live code verified == repo canonical (worker_live_audit SYNC at " + au.probed_at + ", after the last mutation " + (rc.snapshot[w] ? rc.snapshot[w].mo : "?") + ")";
  }
  return null;
}
function burstWorkers(desc) {
  try { var j = JSON.parse(desc); if (j && Array.isArray(j.workers)) return j.workers; } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:burstWorkers:caught", error: String((e && e.message) || e) })); }
  return null;
}
async function autoResolve(env, rc) {
  var out = [];
  if (!rc.haveLive) return out;
  var open = await auditAll(env, "SELECT id, title, description, created_at FROM agent_issues WHERE status='open' AND source='qnfo-deploy-guard'", []);
  for (var i = 0; i < open.length; i++) {
    var it = open[i]; var title = String(it.title || ""); var reason = null;
    var m = /^DEPLOY-([A-Z-]+): (.+)$/.exec(title);
    var since = Number(it.created_at) || 0;
    if (m && EVENT_TYPES[m[1]]) {
      var type = EVENT_TYPES[m[1]]; var w = m[2];
      if (w !== "fleet") {
        if (rc.seen[type + "|" + w]) continue;
        reason = workerSettled(w, since, rc);
      } else {
        var ws = burstWorkers(it.description);
        if (!ws || !ws.length) continue;
        var why = [];
        for (var k = 0; k < ws.length; k++) {
          if (rc.seen[type + "|" + ws[k]]) { why = null; break; }
          var r1 = workerSettled(ws[k], since, rc);
          if (!r1) { why = null; break; }
          why.push(ws[k]);
        }
        if (why) reason = "all " + why.length + " burst workers settled (ledgered redeploy or verified SYNC after the burst)";
      }
    } else if (title === "DEPLOY-NON-CANONICAL-DEPLOY: fleet" && rc.nonCanon.length === 0) {
      reason = "no live worker's last code deploy is non-canonical any more";
    } else if (title === "DEPLOY-LOCK-CONTENTION: fleet" && rc.denials === 0) {
      reason = "no lock denials in this scan";
    } else if (title === "COST-THRESHOLD-BREACH: qnfo-ops" && rc.cost && !(rc.cost.day_usd > rc.cost.thresholds.day_usd || rc.cost.month_usd > rc.cost.thresholds.month_usd)) {
      reason = "spend back under thresholds (day " + rc.cost.day_usd + ", 30d " + rc.cost.month_usd + ")";
    }
    if (!reason) continue;
    var note = "\n\nRESOLVED " + nowIso() + " by qnfo-deploy-guard/" + VERSION + " (DEPLOY-TICKET-AUTORESOLVE-1): " + reason;
    // issue_close_evidence_required (qnfo-audit trigger) ABORTs any close whose issue_triage row carries no
    // close_evidence, so the evidence is written FIRST (upsert: rows predating the autotriage trigger have none).
    var ev = await auditRun(env, "INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, remediation, close_evidence) VALUES (?1, 'DEPLOY-TICKET-AUTORESOLVE-1', 'resolved', 'qnfo-deploy-guard', datetime('now'), 'auto-resolve on positive evidence', ?2) ON CONFLICT(issue_id) DO UPDATE SET close_evidence=excluded.close_evidence, triage_state='resolved'", [it.id, "qnfo-deploy-guard/" + VERSION + ": " + reason]);
    if (ev && ev.ok === false) { out.push({ id: it.id, title: title, reason: reason, ok: false, error: "evidence write failed: " + ev.error }); continue; }
    var up = await auditRun(env, "UPDATE agent_issues SET status='resolved', close_channel='deploy-guard-autoresolve', updated_at=?1, description=substr(COALESCE(description,'') || ?2, 1, 6000) WHERE id=?3 AND status='open'", [Date.now(), note, it.id]);
    out.push({ id: it.id, title: title, reason: reason, ok: !(up && up.ok === false) });
  }
  return out;
}
async function scan(env, fleetProbe) {
  var t0 = Date.now();
  var fp = await (fleetProbe || getJson(FLEET_URLS, 15000, "fleet"));
  if (typeof fp.ok !== "boolean") fp.ok = true;
  var ca = await getJson(COST_URLS, 10000, "cost");
  var cost = null;
  if (ca.ok && ca.j) {
    var thr = { day_usd: 10, month_usd: 150 };
    try { var tv = await env.FLEET_CONFIG.get(THR_KEY); if (tv) thr = JSON.parse(tv); } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:scan:caught", error: String((e && e.message) || e) })); }
    var day = (ca.j.utc_day && ca.j.utc_day.cost) || 0;
    var month = (ca.j.last_30d && ca.j.last_30d.cost) || 0;
    cost = { day_usd: day, month_usd: month, cap_per_utc_day: ca.j.cap_per_utc_day, thresholds: thr };
  }
  var ledger = await auditAll(env, "SELECT id, worker, actor, to_sha, ts, note, ok FROM fleet_deploys ORDER BY id", []);
  var lastLedger = {}; var ledgerBy = {};
  for (var i = 0; i < ledger.length; i++) { lastLedger[ledger[i].worker] = ledger[i]; (ledgerBy[ledger[i].worker] = ledgerBy[ledger[i].worker] || []).push(ledger[i]); }
  var prev = {}; try { var pv = await env.FLEET_CONFIG.get(SNAP_KEY); if (pv) prev = JSON.parse(pv) || {}; } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:scan:caught", error: String((e && e.message) || e) })); }
  var active = {};
  try { var al = await auditAll(env, "SELECT worker, owner, since, expires_at FROM deploy_locks WHERE typeof(expires_at) IN ('integer','real') AND expires_at > ?1", [Date.now()]); for (var j = 0; j < al.length; j++) active[al[j].worker] = al[j]; } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:scan:caught", error: String((e && e.message) || e) })); }
  var denials = [];
  try { var dn = await env.FLEET_CONFIG.list({ prefix: DENY_PREFIX }); for (var d = 0; d < dn.keys.length; d++) { var dv = await env.FLEET_CONFIG.get(dn.keys[d].name); if (dv) { try { denials.push(JSON.parse(dv)); } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:scan:caught", error: String((e && e.message) || e) })); } } } } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:scan:caught", error: String((e && e.message) || e) })); }
  var fleet = (fp.ok && fp.j && fp.j.fleet) ? fp.j.fleet : [];
  var regAdded = [];
  try { regAdded = await ensureRegistry(env, fleet); } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:scan:caught", error: String((e && e.message) || e) })); }
  var snapshot = {}; var changed = []; var anomalies = []; var tombstoned = [];
  for (var k = 0; k < fleet.length; k++) {
    var ww = fleet[k]; var mo = ww.modified_on || null;
    snapshot[ww.name] = { mo: mo, at: nowIso() };
    var was = prev[ww.name];
    if (was && was.mo && mo && String(was.mo) !== String(mo)) {
      var lg = lastLedger[ww.name] || null;
      // FAILED-LEDGER-ROW-1 (v1.3.11): a FAILED latest ledger row (ok=0) is STILL a logged mutation.
      // Reading ok=0 as "no row" misclassified a failed deploy as an unlogged-mutation (high) -- the
      // canonical false-positive (qnfo-artifacts 2026-09-24: 08:26 deploy WAS ledgered at 08:26:54 but
      // ok=0). The failure itself is still surfaced by the non-canonical-deploy pass below
      // (nlr.ok === 0), so no signal is lost.
      var logged = !!(lg && isFinite(ms(lg.ts)) && isFinite(ms(mo)) && ms(lg.ts) >= ms(mo) - 180000);
      // LEDGER-GRACE-1 (1.4.6, issues 6854 and 6864): the canonical deploy changes modified_on first and writes its fleet_deploys rows
      // a second or more later (qnfo-subscribers 2026-11-04 01:11:50.97 modified, rows 01:11:51.38 to 01:11:55.68; qnfo-ipatent 2026-11-03
      // 23:41:03.74 modified, reconcile row stamped the same instant), so a scan that lands in between filed uncoordinated-deploy for a deploy
      // that was ledgered moments later. A change under 3 minutes old with no row yet is kept as the previous snapshot and judged again
      // on the next scan, when the row is there; one still unledgered after the grace is filed as before.
      if (!logged && isFinite(ms(mo)) && Date.now() - ms(mo) < LEDGER_GRACE_MS) { snapshot[ww.name] = was; continue; }
      // WORKERS-BUILDS-TOMBSTONE-1: a Workers Builds rebuild of the retired repo-root stub is a real mutation with no
      // lock and no ledger row. Content-verify it against the live response and LEDGER it instead of filing. Any doubt
      // (probe failed, unexpected status/body/size, name mismatch) returns false and the normal anomaly path still runs.
      if (!logged && ww.name === TOMBSTONE_WORKER) {
        try { if (await ledgerTombstone(env, ww.name)) { logged = true; tombstoned.push(ww.name); } }
        catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:scan:caught", error: String((e && e.message) || e) })); }
      }
      var rec = { type: logged ? "deploy-observed" : "unlogged-mutation", worker: ww.name, from_mod: was.mo, to_mod: mo, ledger_to: lg ? lg.to_sha : null, ledger_ts: lg ? lg.ts : null, lock_owner: active[ww.name] ? active[ww.name].owner : null, lock_held: !!active[ww.name] };
      changed.push(rec);
      if (!logged) anomalies.push(rec);
      if (!logged && !active[ww.name]) anomalies.push({ type: "uncoordinated-deploy", worker: ww.name, to_mod: mo });
    }
  }
  if (denials.length) anomalies.push({ type: "lock-contention", worker: "fleet", count: denials.length, sample: denials.slice(-3) });
  if (cost && (cost.day_usd > cost.thresholds.day_usd || cost.month_usd > cost.thresholds.month_usd)) anomalies.push({ type: "cost-threshold", worker: "qnfo-ops", day_usd: cost.day_usd, month_usd: cost.month_usd, thresholds: cost.thresholds });
  // NON-CANONICAL-DEPLOY-1 (v1.3.8): flag workers whose most recent ledgered deploy did NOT use the
  // canonical route (POST /ops/deploy -> note "server-side deploy (opsDeploy route)"). with-lock /
  // redeploy-script paths POST /ledger (so they pass the unlogged-mutation rule) yet bypass the
  // canonical sequence (uncached GitHub-source fetch + binding preservation). Aggregated to one anomaly.
  var liveNames = {}; for (var lw = 0; lw < fleet.length; lw++) liveNames[fleet[lw].name] = 1;
  var haveLive = fleet.length > 0;
  // SETTINGS-ONLY-LEDGER-1 (v1.3.17): a settings PATCH (e.g. fleet-control's observability reassert) bumps CF
  // modified_on without touching code, so its mutator now ledgers it with a "SETTINGS-ONLY" note. That row must
  // satisfy the unlogged-mutation rule above (it IS logged) but must NOT stand in for the worker's last CODE
  // deploy here, or every reassert would make a canonically deployed worker look non-canonical.
  var lastCode = {}; for (var lc = 0; lc < ledger.length; lc++) { if (!isSettingsOnly(ledger[lc].note) && !isSecretOnly(ledger[lc]) && !isTombstoneOnly(ledger[lc].note) && isLaterDeploy(ledger[lc], lastCode[ledger[lc].worker])) lastCode[ledger[lc].worker] = ledger[lc]; }
  var nonCanon = [];
  for (var ncw in lastCode) {
    if (ncw.indexOf("__") === 0) continue; // test namespace (e.g. __e2e__) - not a real deploy target
    // FLEET-GHOST-LEDGER-1 (v1.3.12): a retired/ghost worker (present only in the ledger, absent from the
    // live fleet) is not a deploy target -- its stale row must not permanently drive the aggregate (canonical
    // offender: qnfo-fleet-advisor, retired, last ledger row 2026-09-09). Guarded by haveLive so a failed
    // fleet probe cannot silently disable the non-canonical check.
    if (haveLive && !liveNames[ncw]) continue;
    var nlr = lastCode[ncw] || {};
    var nnote = String(nlr.note || "");
    if (/self-test|deliberately/i.test(nnote)) continue; // deliberate detector self-tests (e.g. ops-gateway)
    // CONTAINER-CANONICAL-1 (v1.3.17): /ops/deploy REFUSES container workers by design (a /content PUT through it
    // drops [[containers]]; qnfo-ops _CONTAINER_WORKERS, canonical-deploy.yml CANONICAL-SKIP-CONTAINERS-1), so for
    // them the container-aware deployers (raw_put.py with CONTAINER-CONFIG-PRESERVE-1, restore_container_config.py)
    // ARE the canonical path. Without this, the fleet non-canonical ticket could never clear.
    if (CONTAINER_WORKERS.indexOf(ncw) >= 0) { if (nlr.ok === 0) nonCanon.push(ncw); continue; }
    if (isSecondPath(nlr)) { if (nlr.ok === 0) nonCanon.push(ncw); continue; } // SECOND-PATH-CANONICAL-1
    if (nnote.indexOf("opsDeploy route") < 0 || nlr.ok === 0) nonCanon.push(ncw); // non-canonical path OR a FAILED canonical attempt (ok:0 carries the canonical note)
  }
  if (nonCanon.length) anomalies.push({ type: "non-canonical-deploy", worker: "fleet", count: nonCanon.length, sample: nonCanon.slice(0, 12) });
  var seen = {}; var uniq = []; for (var m = 0; m < anomalies.length; m++) { var key = anomalies[m].type + "|" + anomalies[m].worker; if (!seen[key]) { seen[key] = 1; uniq.push(anomalies[m]); } }
  uniq = coalesceBursts(uniq);
  var filed = [];
  for (var n = 0; n < uniq.length; n++) {
    var a = uniq[n]; var title;
    if (a.type === "cost-threshold") title = "COST-THRESHOLD-BREACH: qnfo-ops";
    else title = "DEPLOY-" + String(a.type).toUpperCase() + ": " + (a.worker || "fleet");
    var pr = (a.type === "unlogged-mutation" || a.type === "uncoordinated-deploy" || a.type === "cost-threshold") ? "high" : "medium";
    var res = await fileIssue(env, title, JSON.stringify(a), pr);
    if (res.filed) filed.push({ title: title, ok: res.ok });
  }
  if (filed.length) await fileAlert(env, "warn", "deploy-guard filed " + filed.length + " ticket(s): " + filed.map(function (f) { return f.title; }).join("; "));
  var resolved = [];
  if (fp.ok) {
    var audit = {};
    try { var ar = await auditAll(env, "SELECT worker, match, note, probed_at FROM worker_live_audit", []); for (var ai = 0; ai < ar.length; ai++) audit[ar[ai].worker] = ar[ai]; } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:scan:caught", error: String((e && e.message) || e) })); }
    try { resolved = await autoResolve(env, { haveLive: haveLive, liveNames: liveNames, snapshot: snapshot, ledgerBy: ledgerBy, audit: audit, seen: seen, nonCanon: nonCanon, denials: denials.length, cost: cost }); } catch (e) { resolved = [{ error: String(e && e.message || e).slice(0, 200) }]; }
    if (resolved.length) await fileAlert(env, "info", "deploy-guard auto-resolved " + resolved.length + " ticket(s): " + resolved.map(function (r) { return r.id; }).join(","));
  }
  var ok = fp.ok ? 1 : 0;
  try { await auditRun(env, "INSERT INTO fleet_heartbeat (worker,version,ts,ok) VALUES (?1,?2,?3,?4) ON CONFLICT(worker) DO UPDATE SET version=excluded.version, ts=excluded.ts, ok=excluded.ok", [WORKER, VERSION, nowIso(), ok]); } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:scan:caught", error: String((e && e.message) || e) })); }
  var report = { ts: nowIso(), version: VERSION, fleet_probe_ok: fp.ok, fleet_url: fp.url, workers_seen: fleet.length, changed_since_last: changed.length, tombstoned: tombstoned, anomalies: uniq, filed: filed, resolved: resolved, non_canonical: nonCanon, active_locks: Object.keys(active), recent_denials: denials.length, registry_added: regAdded, cost: cost, baseline: Object.keys(prev).length === 0, elapsed_ms: Date.now() - t0 };
  try { await env.FLEET_CONFIG.put(SNAP_KEY, JSON.stringify(snapshot), { expirationTtl: 604800 }); } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:scan:caught", error: String((e && e.message) || e) })); }
  try { await env.FLEET_CONFIG.put(REPORT_KEY, JSON.stringify(report), { expirationTtl: 604800 }); } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:scan:caught", error: String((e && e.message) || e) })); }
  if (fp.ok) { try { var dn2 = await env.FLEET_CONFIG.list({ prefix: DENY_PREFIX }); for (var z = 0; z < dn2.keys.length; z++) { await env.FLEET_CONFIG.delete(dn2.keys[z].name); } } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:scan:caught", error: String((e && e.message) || e) })); } }
  return report;
}
// CAPABILITY-SNAPSHOT-1 (2026-10-01, charter gate C6, issue #1628): qnfo-ops /capability-audit measures the capability
// contract (non-empty capabilities and limitations on /health) from capability_audit_snapshot, because a worker cannot
// fetch a sibling *.workers.dev URL without the global_fetch_strictly_public flag (IN-WORKER-PROBE-BLOCKED-1). The only
// writer was scripts/capability-feed.py, which read a key from a desktop client database, so the snapshot went 11 days
// stale and the gate read "violated". This worker has the flag and already reads live /health for registry versions,
// so it refreshes the snapshot itself: every live worker in /fleet, at most once per CAP_EVERY_MS, from the cron.
// A probe that fails leaves that worker's previous row untouched (its ts then shows how old it is); rows for workers no
// longer live are removed so the conformance denominator is the live fleet.
var CAP_EVERY_MS = 6 * 3600 * 1000;
var CAP_KEY = "capsnap:last";
function capJson(list, max) {
  if (!Array.isArray(list)) list = [list];
  list = list.slice();
  for (var i = 0; i < list.length; i++) {
    if (typeof list[i] === "string") list[i] = list[i].slice(0, 400);
  }
  while (JSON.stringify(list).length > max && list.length > 1) list.pop();
  while (JSON.stringify(list).length > max && list.length && typeof list[list.length - 1] === "string") {
    var s = list[list.length - 1];
    if (s.length === 0) break;
    list[list.length - 1] = s.slice(0, s.length - 1);
  }
  return JSON.stringify(list);
}
async function capabilitySnapshot(env, force, fleetProbe) {
  var last = null;
  try { var lv = await env.FLEET_CONFIG.get(CAP_KEY); if (lv) last = JSON.parse(lv); } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:capabilitySnapshot:caught", error: String((e && e.message) || e) })); }
  var lastMs = last && last.ts ? ms(last.ts) : NaN;
  var minGap = force ? 600000 : CAP_EVERY_MS;
  if (isFinite(lastMs) && Date.now() - lastMs < minGap) return { ran: false, reason: "fresh", last: last };
  var fp = await (fleetProbe || getJson(FLEET_URLS, 15000, "capability-snapshot-fleet"));
  var fleet = (fp.ok && fp.j && fp.j.fleet) ? fp.j.fleet : [];
  if (!fleet.length) return { ran: false, reason: "fleet probe failed" };
  await auditRun(env, "CREATE TABLE IF NOT EXISTS capability_audit_snapshot (service TEXT PRIMARY KEY, version TEXT, capabilities TEXT, limitations TEXT, ts TEXT)", []);
  var names = fleet.map(function (w) { return String((w && w.name) || ""); }).filter(Boolean);
  var out = { ts: nowIso(), live: names.length, probed: 0, stored: 0, failed: [], conforming: 0, non_conforming: [], removed: 0 };
  async function one(name) {
    try {
      var c = new AbortController(); var timerId = setTimeout(function () { c.abort(); }, 8000);
      var r = await fetch("https://" + name + ".q08.workers.dev/health", { signal: c.signal, headers: { accept: "application/json", "user-agent": "qnfo-deploy-guard-capability/1.0" } });
      clearTimeout(timerId);
      out.probed++;
      if (!r.ok) { out.failed.push(name + ":" + r.status); return; }
      var j = await r.json().catch(function () { return null; });
      if (!j || typeof j !== "object") { out.failed.push(name + ":no-json"); return; }
      var caps = j.capabilities;
      if (typeof caps === "string") caps = caps.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      if (!Array.isArray(caps)) caps = caps && typeof caps === "object" ? Object.keys(caps) : [];
      var lims = Array.isArray(j.limitations) ? j.limitations : [];
      var ver = j.version || j.VERSION || null;
      var w = await auditRun(env, "INSERT INTO capability_audit_snapshot (service, version, capabilities, limitations, ts) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(service) DO UPDATE SET version=excluded.version, capabilities=excluded.capabilities, limitations=excluded.limitations, ts=excluded.ts", [name, ver != null ? String(ver) : null, capJson(caps, 4000), capJson(lims, 4000), out.ts]);
      if (w && w.ok !== false) out.stored++;
      if (caps.length && lims.length) out.conforming++;
      else out.non_conforming.push(name + ":" + (!lims.length ? "missing-limitations" : "empty-capabilities"));
    } catch (e) { out.failed.push(name + ":" + String((e && e.name) || "error")); }
  }
  // Six at a time: a Worker invocation may hold six connections waiting for headers.
  for (var i = 0; i < names.length; i += 6) await Promise.all(names.slice(i, i + 6).map(one));
  try {
    var have = await auditAll(env, "SELECT service FROM capability_audit_snapshot", []);
    var live = {}; for (var k = 0; k < names.length; k++) live[names[k]] = 1;
    for (var h = 0; h < have.length; h++) {
      if (!live[have[h].service]) { await auditRun(env, "DELETE FROM capability_audit_snapshot WHERE service=?1", [have[h].service]); out.removed++; }
    }
  } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:one:caught", error: String((e && e.message) || e) })); }
  try { await env.FLEET_CONFIG.put(CAP_KEY, JSON.stringify(out), { expirationTtl: 604800 }); } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:one:caught", error: String((e && e.message) || e) })); }
  return Object.assign({ ran: true }, out);
}
function changes(r) { return (r && r.meta && typeof r.meta.changes === "number") ? r.meta.changes : (r && typeof r.changes === "number" ? r.changes : 0); }
// One D1 deploy_locks lease (deploy locks, secrets:<worker>, work:<key>). Returns [http status, body]. quiet=true records no
// lock denial (a refused work claim is the claim doing its job, not the deploy contention DEPLOY-LOCK-CONTENTION counts).
async function acquireLease(env, b, quiet) {
  var w4 = String(b.worker || "");
  if (!w4) return [400, { error: "worker required" }];
  var tn = Number(b.ttl_sec || DEFAULT_TTL); if (!isFinite(tn)) tn = DEFAULT_TTL;
  var ttl = Math.min(Math.max(tn, 60), MAX_TTL);
  var now4 = Date.now();
  // expected_version optimistic-concurrency check (registry-as-truth): reject a deploy that
  // assumes a stale current version. Enforced only when the worker is registered.
  if (b.expected_version) {
    var reg = await auditAll(env, "SELECT version FROM service_registry WHERE service=?1 LIMIT 1", [w4]);
    var curVer = reg && reg.length ? reg[0].version : null;
    if (curVer && String(curVer) !== String(b.expected_version)) {
      return [409, { acquired: false, reason: "version-mismatch", worker: w4, expected_version: String(b.expected_version), current_version: curVer }];
    }
  }
  var actor4 = String(b.actor || b.owner || "unknown");
  var sid4 = b.session_id ? String(b.session_id) : null;
  await auditRun(env, "DELETE FROM deploy_locks WHERE (typeof(expires_at) IN ('integer','real') AND expires_at <= ?1) OR (typeof(expires_at)='text' AND datetime(expires_at) < datetime('now'))", [now4]);
  var raw4 = tok(); var th4 = await sha256hex(raw4);
  var ins4 = await auditRun(env, "INSERT INTO deploy_locks (worker, token_hash, owner, actor, session_id, since, expires_at, expected_version) SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE NOT EXISTS (SELECT 1 FROM deploy_locks WHERE worker=?1 AND expires_at > ?6)", [w4, th4, String(b.owner || "unknown"), actor4, sid4, now4, now4 + ttl * 1000, b.expected_version || null]);
  if (ins4 && ins4.ok === false) return [500, { error: "lock_db_unavailable", detail: ins4.error }];
  if (!changes(ins4)) {
    var cur = await readLock(env, w4);
    if (!quiet) { try { await env.FLEET_CONFIG.put(DENY_PREFIX + Date.now() + "-" + tok(), JSON.stringify({ worker: w4, owner: String(b.owner || "unknown"), held_by: cur ? cur.owner : null, at: nowIso() }), { expirationTtl: 3600 }); } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:acquireLease:caught", error: String((e && e.message) || e) })); } }
    return [409, { acquired: false, holder: cur ? cur.owner : "unknown", held_by: cur ? cur.owner : "unknown", held_since: cur ? cur.since : null, expires_at: cur ? new Date(cur.expires_at).toISOString() : null }];
  }
  return [200, { acquired: true, token: raw4, holder: String(b.owner || "unknown"), expires_at: new Date(now4 + ttl * 1000).toISOString() }];
}
async function releaseLease(env, w5, tk) {
  if (!w5 || !tk) return [400, { error: "worker and token required" }];
  var th5 = await sha256hex(tk);
  var del5 = await auditRun(env, "DELETE FROM deploy_locks WHERE worker=?1 AND token_hash=?2", [w5, th5]);
  if (del5 && del5.ok === false) return [500, { released: false, reason: "lock_db_unavailable" }];
  if (!changes(del5)) return [409, { released: false, reason: "token mismatch or no lock" }];
  return [200, { released: true }];
}
// WORK-CLAIM-1 (2026-10-02, pillar autonomy): concurrent agent sessions duplicated work three times in one day (two fixes of
// one JS-verifier root cause, PR 447 and the publish check in PR 441; two fixes of one q08 test, PRs 453 and 456; the
// qnfo-fleet-dashboard VERSION claimed twice at 1.17.2, 1.17.3, 1.17.8 and 1.18.x across five PRs). A work claim is the same
// D1 deploy_locks lease as the secret lock, under "work:<key>", where <key> is "issue:<agent_issues id>" or
// "file:<repo-relative path>". It is advisory: it stops only a session that asks first (CLAUDE.md "Work claims").
// An issue claim also writes the holder into agent_issues.linked_session (live issues only), which stays as attribution after
// release; GET /work-locks is the live truth. GET /work-locks is open (OPEN-ACCESS-1): key, holder, since and expiry,
// never a token or its hash. Acquire with the held token renews (extends) the claim instead of refusing its own holder.
var WORK_PREFIX = "work:"; var WORK_DEFAULT_TTL = 3600;
var ISSUE_DONE = ["closed", "resolved", "wontfix", "duplicate", "done"];
function workKey(k) {
  var s = String(k == null ? "" : k).trim();
  var m = /^issue:#?(\d{1,9})$/.exec(s);
  if (m) return "issue:" + Number(m[1]);
  m = /^file:(.+)$/.exec(s);
  if (!m) return null;
  var p = m[1].replace(/\\/g, "/").replace(/^(?:\.\/|\/)+/, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  if (!p || p.length > 200 || !/^[A-Za-z0-9._\/-]+$/.test(p) || /(^|\/)\.\.?(\/|$)/.test(p)) return null;
  return "file:" + p;
}
function isoMs(v) { var n = Number(v); return (isFinite(n) && n > 0) ? new Date(n).toISOString() : (v == null ? null : String(v)); }
var WORK_KEY_ERROR = "key must be issue:<agent_issues id> or file:<repo-relative path>";
// WORK-CLAIM-UNIFY-1 (2026-10-02): a second claim procedure landed the same day (WORK-CLAIMS-1, PR 480: the D1 table
// work_claims and the view v_work_claims_active, which also lists the code loop's unfinished code_tasks). Neither saw the
// other: the sessions holding scripts/ci_watchdog.py (work_claims) and qnfo-fleet-dashboard (work-lock) each fixed the same
// API-quota defect in parallel (PRs 480 and 495). Now /work-lock is the one procedure and the D1 ledger is its record:
//  * a fresh acquire is refused when another session holds an unexpired work_claims row on the same path (or issue);
//  * every acquire and refusal returns in_flight: the code loop's unfinished tasks on that path, to review, not duplicate;
//  * an acquire writes the work_claims row (path, intent, holder, issue_id, pr, expires_at); a renewal extends it; a
//    release sets released_at, pr and outcome. GET /work-locks lists the ledger rows and code-loop tasks too.
// Both tables are optional: when one is absent the claim degrades to the WORK-CLAIM-1 lease alone.
var CODE_TASK_DONE = ["merged", "closed", "superseded", "publish_failed", "needs_human", "failed", "reverted"]; // CLAIM-TERMINAL-RELEASE-1 (0.18.14): superseded is done
function holderId(s) { var m = /session_[A-Za-z0-9]+/.exec(String(s || "")); return m ? m[0] : String(s || "").trim().toLowerCase(); }
function isoS(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"); }
function claimTarget(wk) { return wk.indexOf("file:") === 0 ? { path: wk.slice(5), issue: null } : { path: wk, issue: Number(wk.slice(6)) }; }
async function ledgerRows(env, wk, nowMs) {
  var t = claimTarget(wk);
  return await auditAll(env, "SELECT id, path, intent, holder, issue_id, pr, claimed_at, expires_at FROM work_claims WHERE released_at IS NULL AND expires_at > ?1 AND (path = ?2 OR (?3 IS NOT NULL AND issue_id = ?3)) ORDER BY claimed_at", [isoS(nowMs), t.path, t.issue]);
}
// The issue id is bound as text for the LIKE: a JS number can bind as REAL, and '[issue #' || 1810.0 never matches.
async function codeLoopRows(env, wk) {
  var t = claimTarget(wk); var ph = CODE_TASK_DONE.map(function (_, i) { return "?" + (i + 3); }).join(",");
  var rows = await auditAll(env, "SELECT id, path, substr(goal,1,200) AS goal, status, created_at FROM code_tasks WHERE status NOT IN (" + ph + ") AND (path = ?1 OR (?2 IS NOT NULL AND goal LIKE '[issue #' || ?2 || ']%')) ORDER BY created_at", [t.path, t.issue == null ? null : String(t.issue)].concat(CODE_TASK_DONE));
  return rows.map(function (x) { return { kind: "code-loop", path: x.path, intent: x.goal, holder: "qnfo-code-orchestrator:" + x.id, status: x.status, since: x.created_at }; });
}
// LEASE-EXPIRY-SWEEP-1: an expired claim is already free (every read filters expires_at > now); closing the row makes the ledger say so
// (released_at = expires_at, outcome expired) instead of leaving it for orphaned_leases to count. Never touches a live claim.
async function sweepExpiredClaims(env, nowMs) {
  var r = await auditRun(env, "UPDATE work_claims SET released_at = expires_at, outcome = COALESCE(outcome, 'expired') WHERE released_at IS NULL AND expires_at <= ?1", [isoS(nowMs)]);
  return changes(r) || 0;
}
// BP26-LEASES-KILLSWITCH-1: the global kill switch. One ops_config row, read with a 30 second cache; absent or any value but "on" is off.
var KS_CACHE = { at: 0, on: false };
async function killSwitchOn(env) {
  var n = Date.now();
  if (n - KS_CACHE.at < 30000) return KS_CACHE.on;
  var rows = await auditAll(env, "SELECT value FROM ops_config WHERE key = 'fleet_kill_switch'");
  KS_CACHE = { at: n, on: rows.length > 0 && String(rows[0].value).trim().toLowerCase() === "on" };
  return KS_CACHE.on;
}
async function killSwitchObserved(env, what) {
  var since = new Date(Date.now() - 300000).toISOString();
  var ex = await auditAll(env, "SELECT id FROM cloud_ops_events WHERE kind = 'kill-switch.observed' AND job = ?1 AND ts > ?2 LIMIT 1", [WORKER, since]);
  if (ex.length) return;
  await auditRun(env, "INSERT INTO cloud_ops_events (id, ts, kind, text, job, status) VALUES (?1, ?2, 'kill-switch.observed', ?3, ?4, 'ok')", ["ks-" + WORKER + "-" + Date.now(), new Date(Date.now()).toISOString(), "refused " + what + " while fleet_kill_switch = on", WORKER]);
}
async function killSwitchRefusal(env, what, extra) {
  await killSwitchObserved(env, what);
  return [503, Object.assign({ acquired: false, reason: "kill-switch", note: "ops_config fleet_kill_switch is on: no new claim, deploy or secret write starts; releases and reads still work" }, extra || {})];
}
// Fencing: the live fence of a claim, null when the column or row is absent.
async function liveFence(env, path, holder) {
  var r = await auditAll(env, "SELECT fence FROM work_claims WHERE released_at IS NULL AND path = ?1 AND holder = ?2 ORDER BY id DESC LIMIT 1", [path, holder]);
  return r.length && r[0].fence != null ? Number(r[0].fence) : null;
}
async function workCheck(env, b) {
  b = (b && typeof b === "object") ? b : {};
  var wk = workKey(b.key);
  if (!wk) return [400, { error: WORK_KEY_ERROR }];
  if (!b.token) return [400, { error: "token required" }];
  var th = await sha256hex(String(b.token));
  var rows = await auditAll(env, "SELECT owner FROM deploy_locks WHERE worker = ?1 AND token_hash = ?2 AND typeof(expires_at) IN ('integer','real') AND expires_at > ?3 LIMIT 1", [WORK_PREFIX + wk, th, Date.now()]);
  if (!rows.length) return [409, { key: wk, valid: false, reason: "token does not hold a live claim" }];
  var fence = await liveFence(env, claimTarget(wk).path, rows[0].owner);
  if (b.fence != null && fence != null && Number(b.fence) !== fence) return [409, { key: wk, valid: false, reason: "stale fence", fence: fence }];
  if (await killSwitchOn(env)) return [503, { key: wk, valid: false, reason: "kill-switch", fence: fence }];
  return [200, { key: wk, valid: true, holder: rows[0].owner, fence: fence }];
}
function ledgerView(x) { return { kind: "session", path: x.path, intent: x.intent, holder: x.holder, issue_id: x.issue_id, pr: x.pr, since: x.claimed_at, expires_at: x.expires_at }; }
async function workAcquire(env, b) {
  b = (b && typeof b === "object") ? b : {};
  var wk = workKey(b.key);
  if (!wk) return [400, { error: WORK_KEY_ERROR }];
  var wo = String(b.owner || "").trim().slice(0, 120);
  if (!wo) return [400, { error: "owner required (your session id)" }];
  var lk = WORK_PREFIX + wk;
  var tn = Number(b.ttl_sec || WORK_DEFAULT_TTL); if (!isFinite(tn)) tn = WORK_DEFAULT_TTL;
  var ttl = Math.min(Math.max(tn, 60), MAX_TTL);
  var tgt = claimTarget(wk);
  var intent = String(b.intent || "").trim().slice(0, 300) || ("claimed via /work-lock by " + wo);
  var prN = Number(b.pr); prN = (isFinite(prN) && prN > 0) ? Math.floor(prN) : null;
  var nowA = Date.now();
  await sweepExpiredClaims(env, nowA);
  if (await killSwitchOn(env)) return await killSwitchRefusal(env, "work claim " + wk, { key: wk });
  var loop = await codeLoopRows(env, wk);
  if (b.token) {
    var up = await auditRun(env, "UPDATE deploy_locks SET expires_at=?1 WHERE worker=?2 AND token_hash=?3 AND typeof(expires_at) IN ('integer','real') AND expires_at > ?4", [nowA + ttl * 1000, lk, await sha256hex(String(b.token)), nowA]);
    if (changes(up)) {
      var held = await readLock(env, lk);
      var hOwner = held ? held.owner : wo;
      await auditRun(env, "UPDATE work_claims SET expires_at=?1, pr=COALESCE(?2, pr) WHERE released_at IS NULL AND path=?3 AND holder=?4", [isoS(nowA + ttl * 1000), prN, tgt.path, hOwner]);
      return [200, { acquired: true, renewed: true, key: wk, token: String(b.token), holder: hOwner, fence: await liveFence(env, tgt.path, hOwner), expires_at: new Date(nowA + ttl * 1000).toISOString(), in_flight: loop }];
    }
    // The token no longer holds the claim (expired or reaped): fall through to a fresh acquire, which issues a new token.
  }
  var me = holderId(wo);
  var others = (await ledgerRows(env, wk, nowA)).filter(function (x) { return holderId(x.holder) !== me; });
  if (others.length) {
    var o1 = others[0];
    return [409, { key: wk, acquired: false, reason: "work_claims", holder: o1.holder, since: o1.claimed_at, expires_at: o1.expires_at, intent: o1.intent, pr: o1.pr, in_flight: others.map(ledgerView).concat(loop) }];
  }
  var r = await acquireLease(env, { worker: lk, owner: wo, actor: wo, ttl_sec: ttl }, true);
  var out = Object.assign({ key: wk }, r[1]); delete out.held_by;
  if (r[0] === 409 && out.held_since != null) { out.since = isoMs(out.held_since); delete out.held_since; }
  out.in_flight = loop;
  if (r[0] === 200) {
    var fr = await auditAll(env, "SELECT COALESCE(MAX(fence), 0) + 1 AS f FROM work_claims WHERE path = ?1", [tgt.path]);
    var fenceN = fr.length && fr[0].f != null ? Number(fr[0].f) : null;
    var insW = fenceN == null ? { ok: false } : await auditRun(env, "INSERT INTO work_claims (path, intent, holder, issue_id, pr, claimed_at, expires_at, fence) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)", [tgt.path, intent, wo, tgt.issue, prN, isoS(nowA), isoS(nowA + ttl * 1000), fenceN]);
    if (fenceN == null || (insW && insW.ok === false)) {
      fenceN = null;
      await auditRun(env, "INSERT INTO work_claims (path, intent, holder, issue_id, pr, claimed_at, expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7)", [tgt.path, intent, wo, tgt.issue, prN, isoS(nowA), isoS(nowA + ttl * 1000)]);
    }
    out.fence = fenceN;
  }
  if (r[0] === 200 && wk.indexOf("issue:") === 0) {
    var iid = Number(wk.slice(6));
    var ir = await auditAll(env, "SELECT status FROM agent_issues WHERE id=?1", [iid]);
    var ist = ir.length ? ir[0].status : null; var linked = false;
    if (ist != null && ISSUE_DONE.indexOf(String(ist).toLowerCase()) < 0) {
      linked = changes(await auditRun(env, "UPDATE agent_issues SET linked_session=?1 WHERE id=?2", [wo, iid])) > 0;
    }
    out.issue = { id: iid, status: ist, linked_session: linked ? wo : null };
  }
  return [r[0], out];
}
async function workList(env) {
  var now6 = Date.now(); var rows;
  try {
    var st6 = env.AUDIT.prepare("SELECT worker, owner, since, expires_at FROM deploy_locks WHERE substr(worker,1,5)='work:' AND typeof(expires_at) IN ('integer','real') AND expires_at > ?1 ORDER BY expires_at");
    rows = ((await st6.bind(now6).all()) || {}).results || [];
  } catch (e) { return [503, { error: "lock_db_unavailable" }]; }
  var claims = rows.map(function (x) { return { key: String(x.worker).slice(WORK_PREFIX.length), holder: x.owner, since: isoMs(x.since), expires_at: isoMs(x.expires_at), ttl_left_sec: Math.max(0, Math.round((Number(x.expires_at) - now6) / 1000)) }; });
  // WORK-CLAIM-UNIFY-1: the ledger rows (including ones written straight into work_claims) and the code loop's tasks.
  var led = (await auditAll(env, "SELECT path, intent, holder, issue_id, pr, claimed_at, expires_at FROM work_claims WHERE released_at IS NULL AND expires_at > ?1 ORDER BY claimed_at", [isoS(now6)])).map(ledgerView);
  var ph6 = CODE_TASK_DONE.map(function (_, i) { return "?" + (i + 1); }).join(",");
  var cl = (await auditAll(env, "SELECT id, path, substr(goal,1,200) AS goal, status, created_at FROM code_tasks WHERE status NOT IN (" + ph6 + ") ORDER BY created_at", CODE_TASK_DONE)).map(function (x) { return { kind: "code-loop", path: x.path, intent: x.goal, holder: "qnfo-code-orchestrator:" + x.id, status: x.status, since: x.created_at }; });
  var inf = led.concat(cl);
  return [200, { claims: claims, count: claims.length, in_flight: inf, in_flight_count: inf.length, now: new Date(now6).toISOString(), rule: "take POST /work-lock/acquire {key, owner, intent} before starting an issue or a file; skip a key another session holds; review in_flight work on the same path instead of writing a second fix" }];
}
export default {
  async scheduled(event, env, ctx) { var fleetProbe = getJson(FLEET_URLS, 15000, "scheduled-fleet"); ctx.waitUntil(sweepExpiredClaims(env, Date.now()).catch(function (e) { console.error(JSON.stringify({ evt: "deploy-guard:claim-sweep:caught", error: String((e && e.message) || e) })); })); ctx.waitUntil(scan(env, fleetProbe).catch(function (e) { console.error(JSON.stringify({ evt: "deploy-guard:workList:caught", error: String((e && e.message) || e) })); })); ctx.waitUntil(capabilitySnapshot(env, false, fleetProbe).catch(function (e) { console.error(JSON.stringify({ evt: "deploy-guard:workList:caught", error: String((e && e.message) || e) })); })); },
  async fetch(request, env, ctx) {
    var url = new URL(request.url); var p = url.pathname;
    // CONCURRENT-SESSION-SHARED-SECRET-CLOBBER-1 (#1701): shared-secret mutations (rotate/PUT of a worker secret) are
    // serialized through the same D1 deploy_locks lease under the key "secrets:<worker>" (separate from deploy locks).
    // A session POSTs /secret-lock/acquire {worker, owner, ttl_sec}, mutates, then verifies on the next-cycle re-probe and
    // POSTs /secret-lock/release {worker, token}. The lease expires (ttl 60s..MAX_TTL) so a dead session never blocks forever.
    if ((p === "/secret-lock/acquire" || p === "/secret-lock/release") && request.method === "POST") {
      var sb = await request.json().catch(function () { return {}; });
      if (!sb.worker) return json({ error: "worker required" }, 400);
      sb.worker = "secrets:" + String(sb.worker); delete sb.expected_version;
      p = "/lock/" + p.slice("/secret-lock/".length);
      request = new Request(url.origin + p, { method: "POST", body: JSON.stringify(sb) });
    }
    // WORK-CLAIM-1: POST /work-lock/acquire {key, owner, ttl_sec<=7200[, intent, pr, token to renew]},
    // POST /work-lock/release {key, token[, pr, outcome]}, GET /work-locks (open; never a token).
    if (p === "/work-lock/acquire" && request.method === "POST") { var wa = await workAcquire(env, await request.json().catch(function () { return {}; })); return json(wa[1], wa[0]); }
    if (p === "/work-lock/release" && request.method === "POST") {
      var wrb = (await request.json().catch(function () { return {}; })) || {}; var wrk = workKey(wrb.key);
      if (!wrk) return json({ error: WORK_KEY_ERROR }, 400);
      var wHeld = await readLock(env, WORK_PREFIX + wrk);
      var wr = await releaseLease(env, WORK_PREFIX + wrk, String(wrb.token || ""));
      if (wr[0] === 200 && wHeld) {
        // WORK-CLAIM-UNIFY-1: close the ledger row with what came of the work.
        var wpr = Number(wrb.pr); wpr = (isFinite(wpr) && wpr > 0) ? Math.floor(wpr) : null;
        var wout = /^(merged|closed|duplicate|abandoned|done|backoff)$/.test(String(wrb.outcome || "")) ? String(wrb.outcome) : null;
        await auditRun(env, "UPDATE work_claims SET released_at=?1, pr=COALESCE(?2, pr), outcome=COALESCE(?3, outcome) WHERE released_at IS NULL AND path=?4 AND holder=?5", [isoS(Date.now()), wpr, wout, claimTarget(wrk).path, wHeld.owner]);
      }
      return json(Object.assign({ key: wrk }, wr[1]), wr[0]);
    }
    if (p === "/work-lock/check" && request.method === "POST") { var wck = await workCheck(env, await request.json().catch(function () { return {}; })); return json(wck[1], wck[0]); }
    if (p === "/kill-switch" && request.method === "GET") { KS_CACHE.at = 0; return json({ kill_switch: (await killSwitchOn(env)) ? "on" : "off", flag: "ops_config fleet_kill_switch", worker: WORKER, version: VERSION, now: nowIso() }); }
    if (p === "/work-locks" && request.method === "GET") { var wl = await workList(env); return json(wl[1], wl[0]); }
    if (p === "/health") return json({ ok: true, worker: WORKER, version: VERSION, ts: nowIso(), capabilities: ["deploy-lock", "secret-lock", "work-claim", "fencing-token", "kill-switch", "ledger", "mutation-detector", "cost-watchdog", "capability-snapshot"], limitations: ["D1 lease, not a distributed consensus lock", "work claims are advisory: they stop only a session that asks first", "detects a mutation only on the next 20-minute scan", "capability snapshot at most every 6 hours (POST /capability-snapshot forces one, 10-minute floor)"] });
    if (p === "/report" && request.method === "GET") { var rp = await env.FLEET_CONFIG.get(REPORT_KEY); return json(rp ? JSON.parse(rp) : { ts: null }); }
    if (p === "/locks" && request.method === "GET") { var lr = await auditAll(env, "SELECT worker, owner, since, expires_at, expected_version FROM deploy_locks WHERE expires_at > ?1", [Date.now()]); return json({ locks: lr, now: nowIso() }); }
    if (p.indexOf("/lock/") === 0 && request.method === "GET") { var w3 = p.slice(6); try { w3 = decodeURIComponent(w3); } catch (e) { w3 = p.slice(6); } return json({ worker: w3, lock: await readLock(env, w3), now: nowIso() }); }
    if (p === "/lock/acquire" && request.method === "POST") {
      var b = await request.json().catch(function () { return {}; });
      if (await killSwitchOn(env)) { var ksr = await killSwitchRefusal(env, "lock " + String(b.worker || ""), { worker: String(b.worker || "") }); return json(ksr[1], ksr[0]); }
      var la = await acquireLease(env, b, false);
      return json(la[1], la[0]);
    }
    if (p === "/lock/release" && request.method === "POST") {
      var b5 = await request.json().catch(function () { return {}; });
      var lr5 = await releaseLease(env, String(b5.worker || ""), String(b5.token || ""));
      return json(lr5[1], lr5[0]);
    }
    if (p === "/ledger" && request.method === "POST") {
      var bl = await request.json().catch(function () { return {}; }); if (!bl.worker) return json({ error: "worker required" }, 400);
      var rl = await auditRun(env, "INSERT INTO fleet_deploys (worker, actor, session_id, from_sha, to_sha, source_path, ok, note, ts) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)", [String(bl.worker), String(bl.actor || "unknown"), bl.session_id ? String(bl.session_id) : null, bl.from || null, bl.to || null, bl.source_path || null, bl.ok === false ? 0 : 1, String(bl.note || "").slice(0, 400), nowIso()]);
      try { await ensureRegistry(env, [{ name: String(bl.worker) }]); } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:fetch:caught", error: String((e && e.message) || e) })); }
      var refreshedVer = null;
      try { refreshedVer = await refreshRegistryVersion(env, String(bl.worker), bl.version || bl.to || bl.to_version); } catch (e) { console.error(JSON.stringify({ evt: "deploy-guard:fetch:caught", error: String((e && e.message) || e) })); }
      return json({ logged: true, ok: rl && rl.ok !== false, error: rl && rl.error, registry_version: refreshedVer });
    }
    if (p === "/thresholds" && request.method === "POST") { var bt = await request.json().catch(function () { return {}; }); await env.FLEET_CONFIG.put(THR_KEY, JSON.stringify({ day_usd: Number(bt.day_usd || 10), month_usd: Number(bt.month_usd || 150) })); return json({ set: true }); }
    if (p === "/scan" && (request.method === "POST" || request.method === "GET")) {
  try {
    return json(await scan(env));
  } catch (e) {
    console.error(JSON.stringify({ evt: "deploy-guard:scan:failed", error: String((e && e.message) || e) }));
    return json({ error: "scan_failed", details: String(e && e.message || e) }, 500);
  }
}
    if (p === "/capability-snapshot" && request.method === "GET") { var cs = await env.FLEET_CONFIG.get(CAP_KEY); return json(cs ? JSON.parse(cs) : { ts: null }); }
    if (p === "/capability-snapshot" && request.method === "POST") { return json(await capabilitySnapshot(env, true)); }
    return json({ error: "not_found", worker: WORKER }, 404);
  }
};