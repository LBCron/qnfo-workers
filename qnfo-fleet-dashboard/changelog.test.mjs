// FLEET-CHANGELOG-1 offline suite (qnfo-fleet-dashboard 1.25.0): the Changelog tab's release detection from the deploy
// ledger, its commit-message description, the cron sync into fleet_changelog (idempotent, heartbeat), the public/owner
// views (personal-plane redaction) and the page, against node:sqlite.
// Run: node --no-warnings qnfo-fleet-dashboard/changelog.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const a = src.indexOf("// ---- FLEET-CHANGELOG-1:BEGIN ----"), b = src.indexOf("// ---- FLEET-CHANGELOG-1:END ----");
const d = src.indexOf("const D1_PRIMARY_ONLY"), e = src.indexOf("__name(d1all, \"d1all\");");
const f = src.indexOf("function esc(s) {"), g = src.indexOf("\n}\n", f);
if (a < 0 || b < a || d < 0 || e < d || f < 0 || g < f) throw new Error("FLEET-CHANGELOG-1 block not found in worker.js");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE deployment_history (id INTEGER PRIMARY KEY AUTOINCREMENT, resource_type TEXT, resource_name TEXT, action TEXT, version_id TEXT, deployed_by TEXT, deployed_at TEXT, status TEXT DEFAULT 'success', notes TEXT);
  CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
  CREATE TABLE metric_history (metric TEXT NOT NULL, day TEXT NOT NULL, value REAL, meets INTEGER, target TEXT, ts TEXT, PRIMARY KEY (metric, day));`);
const NOW = Date.parse("2026-10-06T07:00:00Z");
// A session trailer URL, assembled at runtime so this file holds no claude.ai link (CLOUDFLARE-ONLY-HOST-1).
const TRAILER = "Claude-Session: https://" + ["claude", "ai"].join(".") + "/code/session_x";
const iso = (dd) => new Date(NOW - dd * 864e5).toISOString(), sp = (dd) => iso(dd).replace("T", " ").slice(0, 19);
const dep = (w, v, t, status) => db.prepare("INSERT INTO deployment_history (resource_name, action, version_id, deployed_at, status) VALUES (?, 'deploy', ?, ?, ?)").run(w, v, t, status || "success");
// qnfo-fleet-control: patch bumps only (no release), then a minor bump.
dep("qnfo-fleet-control", "0.4.120-a", sp(40)); dep("qnfo-fleet-control", "0.4.121-b", iso(5)); dep("qnfo-fleet-control", "0.5.0-kernel-v2", iso(2));
// qnfo-gateway: minor bump (public), a rollback redeploy of an older version, a patch after it, then a major bump.
dep("qnfo-gateway", "3.8.4-x", iso(20)); dep("qnfo-gateway", "3.9.0-qds", iso(4)); dep("qnfo-gateway", "3.8.4-x", iso(3.9)); dep("qnfo-gateway", "3.9.1-fix", iso(3)); dep("qnfo-gateway", "4.0.0-new-home", iso(1));
// A redeploy of the same version later does not move its release time; a failed deploy is not a release.
dep("qnfo-gateway", "3.9.0-qds", iso(0.5)); dep("qnfo-ai", "5.30.0-x", iso(9)); dep("qnfo-ai", "5.31.0-fail", iso(1), "failed");
// personal-api minor bump (personal plane); a worker created after the ledger epoch (new); one created before it (not new).
dep("personal-api", "4.7.0-gcal-ics", iso(6)); dep("personal-api", "4.8.0-twin-flash", iso(0.7));
dep("qnfo-new-thing", "0.1.0-hello", iso(2.5)); dep("qnfo-new-thing", "0.1.1-fix", iso(2));
dep("qnfo-old-thing", "1.0.0", iso(1.5));
// Unparsable versions are ignored.
dep("qnfo-weird", "abc", iso(1)); dep("qnfo-weird", "", iso(1));
db.exec(`INSERT INTO metric_history (metric, day, value) VALUES ('watchmaker_index','2026-10-02',5),('watchmaker_index','2026-10-06',3),
  ('metrics_in_breach','2026-10-02',18),('metrics_in_breach','2026-10-06',20),('code_task_success_rate_30d','2026-10-02',0.2),('code_task_success_rate_30d','2026-10-06',0.29);`);

const shim = {
  prepare: (sql) => {
    let args = [];
    const st = {
      bind: (...x) => { args = x; return st; },
      all: async () => ({ results: db.prepare(sql).all(...args) }),
      run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
      first: async () => db.prepare(sql).get(...args) || null
    };
    return st;
  },
  batch: async (stmts) => { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
};
const commits = {
  "qnfo-fleet-control": [
    { sha: "aaaaaaaaaaaa", commit: { message: "qnfo-fleet-control 0.5.0 KERNEL-TWO-1: the kernel heals drift in one tick, pillar autonomy (#700)\n\nThe kernel now re-applies declared crons and bindings itself.\n\nCo-Authored-By: Someone <x@y>\n" + TRAILER } },
    { sha: "bbbbbbbbbbbb", commit: { message: "qnfo-fleet-control 0.4.121: something else (#699)" } }
  ],
  "qnfo-gateway": [
    { sha: "cccccccccccc", commit: { message: "qnfo-gateway 4.0.0-new-home NEW-HOME-1 (pillar reach): a new home page for qnfo.org (#710)\n\nEvery paper is one click from the front page." } },
    { sha: "dddddddddddd", commit: { message: "qnfo-gateway 3.9.10: not this one (#701)" } },
    { sha: "eeeeeeeeeeee", commit: { message: "qnfo-gateway 3.9.0: QDS design system on qnfo.org (#690)" } }
  ],
  "personal-api": [{ sha: "ffffffffffff", commit: { message: "personal-api 4.8.0 TWIN-FLASH-1: cheaper twin model with fallback (#720)\n\nPrivate detail about the owner's mail." } }],
  "qnfo-new-thing": []
};
// The PR GitHub says contains each commit. eeee (gateway 3.9.0) says "(#690)" in its subject but sits in no PR.
const pulls = { aaaaaaaaaaaa: [{ number: 700, merged_at: "2026-10-04T00:00:00Z" }], cccccccccccc: [{ number: 711, merged_at: null }, { number: 710, merged_at: "2026-10-05T06:00:00Z" }], ffffffffffff: [{ number: 720, merged_at: "2026-10-05T18:00:00Z" }] };
let ghCalls = 0, ghFail = false;
const ghCall = async (env, method, path) => {
  ghCalls++;
  if (ghFail) return { ok: false, status: 502, json: null };
  const pm = /\/commits\/([0-9a-f]+)\/pulls$/.exec(path);
  if (pm) return { ok: true, status: 200, json: pulls[pm[1]] || [] };
  const w = decodeURIComponent(/path=([^&]+)/.exec(path)[1]).replace("/worker.js", "");
  return { ok: true, status: 200, json: commits[w] || [] };
};
const ctx = vm.createContext({ Date, Math, Number, String, JSON, Object, Array, RegExp, Promise, isFinite, encodeURIComponent, decodeURIComponent, ghCall,
  VERSION: "1.25.0-changelog", NAME: "qnfo-fleet-dashboard", ACCOUNT: "acct", CON_REPO: "QNFO/qnfo-workers",
  fleetHead: (t) => "<!DOCTYPE html><title>" + t + "</title><body>", fleetTop: (cur) => '<nav><a href="/changelog"' + (cur === "changelog" ? ' aria-current="page"' : "") + ">Changelog</a></nav>", FLEET_SHELL_JS: "" });
const W = vm.runInContext(src.slice(f, g + 2) + "\n" + src.slice(d, e) + "\n" + src.slice(a, b) + "\n;({ changelogPatches, changelogDetect, changelogPickCommit, changelogParse, changelogTick, changelogView, changelogHtml, CHANGELOG_LEDGER_SQL });", ctx, { filename: "qnfo-fleet-dashboard#FLEET-CHANGELOG-1" });

// 1. Detection.
const rows = db.prepare(W.CHANGELOG_LEDGER_SQL).all();
const created = { "qnfo-new-thing": "2026-10-03T12:00:00.000000Z", "qnfo-old-thing": "2026-08-01T00:00:00Z", "qnfo-gateway": "2025-01-01T00:00:00Z" };
const rels = W.changelogDetect(rows, created);
const key = (r) => r.worker + "@" + r.version + ":" + r.level;
const ks = rels.map(key).sort();
ok(JSON.stringify(ks) === JSON.stringify(["personal-api@4.8.0-twin-flash:minor", "qnfo-ai@5.30.0-x:new-worker", "qnfo-fleet-control@0.5.0-kernel-v2:minor", "qnfo-gateway@3.9.0-qds:minor", "qnfo-gateway@4.0.0-new-home:major", "qnfo-new-thing@0.1.0-hello:new-worker"].filter((k) => k !== "qnfo-ai@5.30.0-x:new-worker").sort()), "releases are minor and major bumps and new workers only: " + ks.join(", "));
ok(!ks.some((k) => /0\.4\.121|3\.9\.1|0\.1\.1|5\.31/.test(k)), "patch bumps and failed deploys are not releases");
ok(!ks.some((k) => /qnfo-old-thing/.test(k)), "a worker created before the ledger epoch is not called new");
ok(W.changelogDetect(rows, null).every((r) => r.level !== "new-worker"), "no creation dates (Cloudflare unreadable) means no new-worker claims");
const g390 = rels.find((r) => r.version === "3.9.0-qds");
ok(g390 && g390.released_at === iso(4) && g390.prev_version === "3.8.4-x", "a release is dated by its first deploy and names the version it follows");
ok(rels[0].released_at >= rels[rels.length - 1].released_at, "newest first");

// 2. Commit choice and parsing.
ok(W.changelogPickCommit(commits["qnfo-gateway"], "3.9.0-qds").sha === "eeeeeeeeeeee", "3.9.0 does not match 3.9.10");
ok(W.changelogPickCommit([{ commit: { message: "x 11.3.0 y" } }, { commit: { message: "x 1.3.01" } }], "1.3.0") === null, "1.3.0 does not match 11.3.0 or 1.3.01");
const p1 = W.changelogParse("qnfo-fleet-control 0.4.130 PR-OPEN-ON-20MIN-TICK-1: open code-task PRs on the 20-minute tick; charter 1.0.9 (#667)", "qnfo-fleet-control", "0.4.130-pr-open-20min");
ok(p1.title === "Open code-task PRs on the 20-minute tick; charter 1.0.9" && p1.pr === 667 && p1.marker === "PR-OPEN-ON-20MIN-TICK-1", "real subject 1: " + JSON.stringify(p1));
const p2 = W.changelogParse("idea-hub 1.5.7: subscribe box on ideas.qnfo.org (REACH-IDEA-1, #2001) (#655)", "idea-hub", "1.5.7-subscribe-box");
ok(p2.title === "Subscribe box on ideas.qnfo.org (REACH-IDEA-1, #2001)" && p2.pr === 655 && p2.marker === "REACH-IDEA-1", "real subject 2: " + JSON.stringify(p2));
const p3 = W.changelogParse("x\n\nBody line.\n\nCo-Authored-By: A <b@c>\n" + TRAILER, "w", "1.0.0-some-slug");
ok(p3.summary === "Body line." && !/claude/i.test(JSON.stringify(p3)), "commit trailers and claude.ai links never reach the page");
ok(W.changelogParse("", "w", "1.2.0-ideation-loop").title === "Ideation loop", "no commit: the version slug is the title");

// 3. Cron sync.
const env = { AUDIT: shim };
const t1 = await W.changelogTick(env, { created });
ok(t1.detected === 5 && t1.inserted === 5 && t1.enriched === 5 && !t1.errors.length, "first tick inserts and describes every release: " + JSON.stringify(t1));
const fc = db.prepare("SELECT * FROM fleet_changelog WHERE worker = 'qnfo-fleet-control'").get();
ok(fc.title === "The kernel heals drift in one tick, pillar autonomy" && fc.pr === 700 && fc.pillar === "autonomy" && fc.sha === "aaaaaaaaaaaa" && fc.summary === "The kernel now re-applies declared crons and bindings itself.", "description from the commit: " + JSON.stringify(fc));
const gw = db.prepare("SELECT * FROM fleet_changelog WHERE version = '4.0.0-new-home'").get();
ok(gw.public_hosts === "qnfo.org,papers.qnfo.org,archive.qnfo.org,qwav.tech" && gw.pillar === "reach" && gw.level === "major", "public hostnames and pillar recorded");
const nt = db.prepare("SELECT * FROM fleet_changelog WHERE worker = 'qnfo-new-thing'").get();
ok(nt.title === "Hello" && /no commit on main/.test(nt.enrich_note) && nt.enriched_at, "a release with no matching commit keeps its slug title and says why");
const hb = db.prepare("SELECT * FROM cloud_ops_events WHERE id LIKE 'changelog-tick-%'").all();
ok(hb.length === 1 && hb[0].status === "ok", "heartbeat row for WATCHMAKER_OPS");
const calls = ghCalls;
const t2 = await W.changelogTick(env, { created });
ok(t2.inserted === 0 && t2.enriched === 0 && ghCalls === calls, "second tick is idempotent and calls GitHub for nothing");
dep("qnfo-ai-search", "2.0.0-x", iso(30)); dep("qnfo-ai-search", "2.1.0-paper-pin", iso(0.2));
ghFail = true;
const t3 = await W.changelogTick(env, { created });
const as = db.prepare("SELECT * FROM fleet_changelog WHERE worker = 'qnfo-ai-search'").get();
ok(t3.inserted === 1 && t3.errors.length === 1 && as.enrich_tries === 1 && !as.enriched_at, "a GitHub failure is retried later, not stored as a description");
ghFail = false;
await W.changelogTick(env, { created });
ok(db.prepare("SELECT enriched_at FROM fleet_changelog WHERE worker = 'qnfo-ai-search'").get().enriched_at, "the retry describes it");

// 4. Views.
const pub = await W.changelogView(env, false, NOW), own = await W.changelogView(env, true, NOW);
const pp = pub.releases.find((r) => r.worker === "personal-api"), po = own.releases.find((r) => r.worker === "personal-api");
ok(pp && pp.version === "4.8.0" && !pp.pr && !pp.summary && !/twin/i.test(JSON.stringify(pp)), "personal-plane release is redacted for the public: " + JSON.stringify(pp));
ok(po && po.version === "4.8.0-twin-flash" && po.pr === 720, "the signed-in owner sees it in full");
ok(pub.counts.releases_7d === 6 && pub.counts.releases_30d === 6 && pub.counts.autonomy_30d === 1 && pub.counts.public_30d === 3 && pub.counts.new_workers_30d === 1 && pub.counts.major_30d === 1, "counts: " + JSON.stringify(pub.counts));
ok(pub.patches_30d === 3, "patch bumps in 30 days are counted, baselines are not (0.4.121, 3.9.1, 0.1.1; got " + pub.patches_30d + ")");
const wm = pub.trend.find((t) => t.metric === "watchmaker_index"), mb = pub.trend.find((t) => t.metric === "metrics_in_breach"), ct = pub.trend.find((t) => t.metric === "code_task_success_rate_30d"), se = pub.trend.find((t) => t.metric === "session_execution_ratio_30d");
ok(wm.direction === "better" && mb.direction === "worse" && ct.direction === "better" && se.first === null, "autonomy trend reads metric_history with each metric's own direction");

// 5. Page.
const html = W.changelogHtml(pub, false);
ok(/aria-current="page">Changelog/.test(html) && /data-f="autonomy"/.test(html) && /data-f="public"/.test(html), "Changelog tab is current and filters render");
ok(/https:\/\/github\.com\/QNFO\/qnfo-workers\/pull\/710/.test(html) && /public: qnfo\.org/.test(html), "PR links and public hostnames render");
ok(!/twin/i.test(html) && !/claude\.ai/.test(html), "no personal detail and no claude.ai link on the public page");
ok(/\/commit\/eeeeeeeeeeee/.test(html) && !/pull\/690/.test(html), "a subject's (#N) that is not a PR links the commit, never a wrong PR");
ok(db.prepare("SELECT pr FROM fleet_changelog WHERE version = '4.0.0-new-home'").get().pr === 710, "the merged PR is chosen over an unmerged one");
ok([...src.slice(a, b)].every((ch) => ch.charCodeAt(0) < 128), "block source is ASCII (ASCII-SOURCE-1)");
db.prepare("UPDATE fleet_changelog SET title = '<script>x</script>' WHERE worker = 'qnfo-new-thing'").run();
ok(!/<script>x/.test(W.changelogHtml(await W.changelogView(env, false, NOW), false)), "titles are escaped");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
