// METRIC-REFRESHER-FROZEN-FORMAT-1 offline suite: migrations/2026-11-05-metric-refresher-frozen-format.sql on node:sqlite.
// Proves: the old probe text (strftime ISO comparison) counts a fresh space-form row as frozen; the rewritten probe judges both timestamp shapes by instant: fresh rows in either
// shape are not counted, stale rows in either shape are, per cadence class; retired and never-refreshed rows are not counted; the selfheal probe follows; replay changes nothing.
// Run: node migrations/metric-refresher-frozen-format.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-metric-refresher-frozen-format.sql", import.meta.url), "utf8");
const orig = readFileSync(new URL("./2026-11-05-selfheal-metrics-restore.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
function statements(text) {
  const body = text.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  const out = []; let cur = "", q = false;
  for (const c of body) { if (c === "'") q = !q; if (c === ";" && !q) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += c; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const S = statements(sql);
// the two probes as the earlier migration created them (extracted from its INSERT, not retyped)
const grab = (cls) => { const i = orig.indexOf("('" + cls + "'"); const j = orig.indexOf("'SELECT", i); const k = orig.indexOf("'d1-query'", j); return orig.slice(j, k).trim().replace(/,$/, "").slice(1, -1).replace(/''/g, "'"); };
const OLD_FROZEN = grab("fm-metric-refresher-frozen"), OLD_SELF = grab("fm-selfheal-metrics-stale");
ok(/strftime\(/.test(OLD_FROZEN) && /strftime\(/.test(OLD_SELF), "the earlier probes are found in their migration");
const iso = (h) => new Date(Date.now() - h * 36e5).toISOString().replace(/\.\d+Z$/, "Z");
const spc = (h) => iso(h).replace("T", " ").replace("Z", "");
function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_refreshed TEXT, state TEXT, refresh_cadence TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, verify_probe TEXT, last_verdict TEXT, attempts INTEGER, next_due_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);`);
  const m = db.prepare("INSERT INTO metric_registry VALUES (?, ?, ?, ?)");
  m.run("fresh_space_fast", spc(0.1), "MEASURED", "10m");     // the false positive of the old probe
  m.run("fresh_iso_fast", iso(0.1), "MEASURED", "*/10");
  m.run("stale_space_fast", spc(5), "MEASURED", "10m");
  m.run("stale_iso_fast", iso(5), "MEASURED", "*/10");
  m.run("fresh_space_daily", spc(30), "MEASURED", "daily");
  m.run("stale_space_daily", spc(50), "MEASURED", "daily");
  m.run("stale_iso_hourly", iso(20), "MEASURED", "hourly");
  m.run("fresh_iso_hourly", iso(2), "MEASURED", "1h");
  m.run("retired_stale", iso(400), "RETIRED", "daily");
  m.run("never", null, "UNMEASURED", "daily");
  for (const x of ["merges_undeployed_over_60m", "code_pr_merge_share_7d", "code_prs_unmerged_over_120m", "errata_confirm_stalled", "research_stage_stalled", "publish_rate_ratio_24h", "post_deploy_error_workers"]) m.run(x, spc(0.2), "MEASURED", "*/10");
  m.run("research_budget_member_share", spc(4), "MEASURED", "*/10");   // stale: 4 hours
  const c = db.prepare("INSERT INTO remediation_contracts VALUES (?, ?, 'pass', 7, '2026-11-05 00:00:00')");
  c.run("fm-metric-refresher-frozen", OLD_FROZEN); c.run("fm-selfheal-metrics-stale", OLD_SELF);
  return db;
}
const probe = (db, cls) => db.prepare(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls).p).get();
const db = build();
ok(Number(probe(db, "fm-metric-refresher-frozen").observed) > 5, "the old probe counts fresh space-form rows as frozen (the defect)", probe(db, "fm-metric-refresher-frozen"));
for (const s of S) db.exec(s);
const f = probe(db, "fm-metric-refresher-frozen");
ok(f.expected === "0" && f.observed === "5", "the new probe counts the five stale rows (space or ISO, per cadence) and nothing else", f);
const sh = probe(db, "fm-selfheal-metrics-stale");
ok(sh.expected === "0" && sh.observed === "1", "the selfheal probe counts the one stale selfheal metric and not the fresh space-form ones", sh);
const row = db.prepare("SELECT last_verdict v, attempts a FROM remediation_contracts WHERE class = 'fm-metric-refresher-frozen'").get();
ok(row.v === null && row.a === 0, "both detectors are re-armed");
const WRITE_KW = ["insert into", "update ", "delete from", "drop table", "drop index", "alter table", "create table", "create index", "create trigger", "attach ", "detach ", "pragma ", "replace into", "vacuum"];
const p1 = db.prepare("SELECT verify_probe p FROM remediation_contracts").all().map((r) => r.p.toLowerCase());
ok(p1.every((p) => /^select/.test(p) && !WRITE_KW.some((w) => p.replace(/replace\(/g, "").includes(w))), "both probes stay literal read-only selects");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM bak_20261105_refresher_frozen_probe").get().n === 2, "one decision and a two-row backup");
const snap = () => JSON.stringify([db.prepare("SELECT * FROM remediation_contracts ORDER BY class").all(), db.prepare("SELECT COUNT(*) n FROM decision_log").all()]);
const before = snap();
for (const s of S) db.exec(s);
ok(snap() === before, "a second run changes nothing");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
