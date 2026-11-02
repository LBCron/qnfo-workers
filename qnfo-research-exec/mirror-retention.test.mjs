// MIRROR-DRIFT-1 + PAPER-BODY-RETENTION-1 (qnfo-research-exec 0.38.0; agent_issues 1000037, 1000012 defect B, 1000039). Offline: node:sqlite as D1, a fake R2 bucket, no network.
// Proves: the mirror drift tick checks every public status and compares actual R2 contents even when UTF-8 byte lengths agree, rewrites a stale or missing copy with a read-back, leaves
// a correct copy and a retracted paper's notice alone, walks the whole corpus in total / batch ticks with no cursor, repairs at most MD_REPAIR_MAX copies a tick, reports an R2 failure
// without throwing, and obeys ops_config mirror_drift = off and mirror_drift_batch; the body retention tick keeps the newest N snapshots and the oldest of a slug, deletes only
// snapshots older than the age floor, can be forced past the floor for a verification run, reports the row and character totals every run, never throws, and obeys paper_body_prune
// = off, paper_body_keep and paper_body_keep_days;
// Run: node --no-warnings qnfo-research-exec/mirror-retention.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mirrorDriftTick, paperBodyRetentionTick } from "./worker.js";
import { versionAtLeast } from "../scripts/version-at-least.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };

function d1(db) {
  return { prepare(sql) {
    let args = [];
    const o = { bind(...a) { args = a.map((v) => (v === undefined ? null : v)); return o; },
      async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; } };
    return o;
  } };
}
function bucket(o = {}) {
  const store = new Map(), calls = { head: 0, put: 0 };
  return { store, calls,
    async head(k) { calls.head++; if (o.headThrows) throw new Error("R2 head failed"); return store.has(k) ? { size: Buffer.byteLength(store.get(k), "utf8") } : null; },
    async put(k, v) { calls.put++; if (o.putThrows === k) throw new Error("R2 put refused"); store.set(k, String(v)); },
    async get(k) { return store.has(k) ? { text: async () => store.get(k) } : null; } };
}

// ---------------------------------------------------------------- the code is wired and exported
ok(/MIRROR-DRIFT-1/.test(src) && /PAPER-BODY-RETENTION-1/.test(src), "the markers of both issues are on main (code-probe)");
ok(versionAtLeast(src.match(/var VERSION = "([^"]+)"/)?.[1], "0.38.0"), "the worker is 0.38.0 or later");
ok(/await mirrorDriftTick\(env\)/.test(src) && /await paperBodyRetentionTick\(env\)/.test(src) && /getUTCMinutes\(\) === 0/.test(src), "the scheduled handler runs the drift tick every tick and the retention tick at minute 0");

// ---------------------------------------------------------------- mirror drift
function paperWorld() {
  const lp = new DatabaseSync(":memory:");
  lp.exec("CREATE TABLE papers (slug TEXT PRIMARY KEY, status TEXT, body_md TEXT)");
  const au = new DatabaseSync(":memory:");
  au.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT)");
  return { lp, au, env: (m) => ({ LIVING_PAPER: d1(lp), QNFO_AUDIT: d1(au), MIRROR: m }) };
}
{
  const { lp, au, env } = paperWorld();
  const m = bucket();
  const add = (slug, status, body, mirror) => { lp.prepare("INSERT INTO papers VALUES (?, ?, ?)").run(slug, status, body); if (mirror !== undefined) m.store.set("papers/" + slug + ".md", mirror); };
  const uni = "Schrödinger – α ≈ 0.5 → done. ".repeat(40);
  add("a-ok", "published", "plain body ".repeat(50), "plain body ".repeat(50));
  add("b-stale", "published", "the corrected paper text ".repeat(60), "a 1,742 character retraction notice");
  add("c-missing", "distributed", "a paper with no mirror object ".repeat(30));
  add("d-unicode-ok", "published", uni, uni);
  add("e-unicode-stale", "published", uni, uni.replace(/ö/g, "o"));
  add("f-retracted", "retracted", "retraction notice body", "retraction notice body");
  add("g-retracted-other", "retracted", "the notice", "something else entirely");
  add("h-empty", "published", "", undefined);
  ok(Buffer.byteLength(uni) !== uni.length, "fixture: the unicode body has more bytes than characters");
  const out = await mirrorDriftTick(env(m), { batch: 60, now: 0 });
  ok(out.checked === 5 && out.drifted === 3 && out.repaired === 3 && out.errors.length === 0, "published and distributed papers with a body are checked (5), the three that differ are rewritten", out);
  ok(m.store.get("papers/b-stale.md") === lp.prepare("SELECT body_md b FROM papers WHERE slug = 'b-stale'").get().b, "a stale copy becomes the body of the paper");
  ok(m.store.get("papers/c-missing.md") !== undefined, "a missing object is written");
  ok(m.store.get("papers/e-unicode-stale.md") === uni, "a copy that has the same character count but other bytes is rewritten (size is read in bytes)");
  ok(m.store.get("papers/g-retracted-other.md") === "something else entirely" && !m.store.has("papers/h-empty.md"), "a retracted paper's mirror (the notice by design) and an empty body are left alone");
  const puts = m.calls.put;
  const out2 = await mirrorDriftTick(env(m), { batch: 60, now: 0 });
  ok(out2.drifted === 0 && out2.repaired === 0 && m.calls.put === puts, "a second run changes nothing", out2);
}
{
  const { lp, env } = paperWorld();
  const m = bucket();
  lp.prepare("INSERT INTO papers VALUES ('imported','external_preprint','correct body')").run();
  m.store.set("papers/imported.md", "outdate body");
  ok(Buffer.byteLength("correct body") === Buffer.byteLength("outdate body"), "fixture: stale and current content have equal byte lengths");
  const result = await mirrorDriftTick(env(m), { batch: 2, now: 0 });
  ok(result.checked === 1 && result.repaired === 1 && result.errors.length === 0, "external preprints with equal-size stale mirrors are repaired", result);
  ok(m.store.get("papers/imported.md") === "correct body", "the read-back verified mirror contains the actual corrected text");
}
{
  // rotation: batch 2 over 7 papers covers every paper in ceil(7 / 2) ticks
  const { lp, env } = paperWorld();
  const m = bucket();
  for (let i = 0; i < 7; i++) lp.prepare("INSERT INTO papers VALUES (?, 'published', ?)").run("p" + i, "body " + i + " ".repeat(10));
  const seen = new Set();
  let slot = 1000;
  for (let t = 0; t < 4; t++) {
    const before = new Set(m.store.keys());
    const r = await mirrorDriftTick(env(m), { batch: 2, now: (slot + t) * 600000 });
    ok(r.checked === 2, "a tick checks exactly the batch", r);
    for (const k of m.store.keys()) if (!before.has(k)) seen.add(k);
  }
  ok(seen.size === 7, "four ticks of two cover all seven papers (no cursor)", [...seen]);
}
{
  // at most MD_REPAIR_MAX rewrites a tick, an R2 failure is reported without throwing, the switches
  const { lp, au, env } = paperWorld();
  const m = bucket();
  for (let i = 0; i < 14; i++) lp.prepare("INSERT INTO papers VALUES (?, 'published', ?)").run("q" + String(i).padStart(2, "0"), "text " + i);
  const r = await mirrorDriftTick(env(m), { batch: 60, now: 0 });
  ok(r.drifted === 14 && r.repaired === 10, "at most 10 copies are rewritten in one tick", r);
  const r2 = await mirrorDriftTick(env(m), { batch: 60, now: 0 });
  ok(r2.repaired === 4 && r2.drifted === 4, "the next tick finishes the rest", r2);
  const bad = bucket({ putThrows: "papers/q00.md" });
  const r3 = await mirrorDriftTick(env(bad), { batch: 60, now: 0 });
  ok(r3.errors.length === 1 && r3.errors[0].slug === "q00" && r3.errors[0].error.includes("R2 put refused") && r3.repaired === 10, "an R2 put failure is one error entry and the other copies are still written (the cap counts rewrites that worked)", r3);
  const headFail = await mirrorDriftTick(env(bucket({ headThrows: true })), { batch: 60, now: 0 });
  ok(headFail.errors.length === 14 && headFail.repaired === 0, "an R2 head failure is reported per paper and never thrown", headFail.errors.length);
  au.prepare("INSERT INTO ops_config VALUES ('mirror_drift', 'off')").run();
  const off = await mirrorDriftTick(env(bucket()), { batch: 60, now: 0 });
  ok(off.skipped === true && /mirror_drift = off/.test(off.reason), "ops_config mirror_drift = off stops it", off);
  au.prepare("DELETE FROM ops_config").run();
  au.prepare("INSERT INTO ops_config VALUES ('mirror_drift_batch', '3')").run();
  const b3 = await mirrorDriftTick(env(bucket()), { now: 0 });
  ok(b3.checked === 3, "ops_config mirror_drift_batch sets the batch", b3);
  au.prepare("UPDATE ops_config SET value = '500' WHERE key = 'mirror_drift_batch'").run();
  ok((await mirrorDriftTick(env(bucket()), { now: 0 })).checked === 14, "the batch is capped at 60 (all 14 here)");
  const none = await mirrorDriftTick({ LIVING_PAPER: d1(lp), QNFO_AUDIT: d1(au) }, { now: 0 });
  ok(none.skipped === true, "no MIRROR binding: skipped");
}

// ---------------------------------------------------------------- body retention
function backupWorld() {
  const lp = new DatabaseSync(":memory:");
  lp.exec("CREATE TABLE paper_body_backups (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, version TEXT, status TEXT, title TEXT, body_md TEXT NOT NULL, captured_at TEXT NOT NULL, reason TEXT)");
  const au = new DatabaseSync(":memory:");
  au.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT)");
  const add = (slug, n, daysAgo) => { for (let i = 0; i < n; i++) lp.prepare("INSERT INTO paper_body_backups (slug, version, body_md, captured_at) VALUES (?, ?, ?, datetime('now', ?))").run(slug, "v" + i, "body of " + slug + " v" + i, "-" + (daysAgo - i * 0.01) + " days"); };
  const count = (slug) => lp.prepare("SELECT COUNT(*) n FROM paper_body_backups WHERE slug = ?").get(slug).n;
  const ids = (slug) => lp.prepare("SELECT version v FROM paper_body_backups WHERE slug = ? ORDER BY id").all(slug).map((r) => r.v);
  return { lp, au, env: { LIVING_PAPER: d1(lp), QNFO_AUDIT: d1(au) }, add, count, ids };
}
{
  const w = backupWorld();
  w.add("old-15", 15, 200); w.add("young-15", 15, 3); w.add("small-4", 4, 300); w.add("mixed", 13, 200);
  const r = await paperBodyRetentionTick(w.env);
  ok(r.enabled === true && r.rows === 15 + 15 + 4 + 13 && r.chars > 0, "the tick reports the row count and the character total", r);
  ok(w.count("old-15") === 11, "a slug edited 15 times, all older than 90 days, is left with 11 rows (the newest 10 and the oldest)", w.ids("old-15"));
  ok(w.ids("old-15")[0] === "v0" && w.ids("old-15").slice(1).join() === "v5,v6,v7,v8,v9,v10,v11,v12,v13,v14", "the oldest snapshot and the newest ten are the ones kept", w.ids("old-15"));
  ok(w.count("young-15") === 15, "snapshots younger than the 90-day floor are never deleted, however many", w.count("young-15"));
  ok(w.count("small-4") === 4, "a slug with fewer than 12 snapshots is untouched");
  ok(w.count("mixed") === 11 && r.slugs === 2 && r.deleted === 4 + 2, "the totals count what was deleted (4 + 2 here)", r);
  const r2 = await paperBodyRetentionTick(w.env);
  ok(r2.deleted === 0 && r2.rows === 11 + 15 + 4 + 11, "a second run deletes nothing and the row count falls", r2);
  const f = await paperBodyRetentionTick(w.env, { days: 0, keep: 5 });
  ok(w.count("young-15") === 6 && w.ids("young-15")[0] === "v0" && w.ids("young-15").slice(1).join() === "v10,v11,v12,v13,v14" && f.deleted === 9 + 5 + 5, "forced past the age floor (days 0, keep 5) it still keeps the newest five and the oldest of every slug", { ids: w.ids("young-15"), f });
}
{
  const w = backupWorld();
  w.add("cfg", 20, 200);
  w.au.prepare("INSERT INTO ops_config VALUES ('paper_body_keep', '3'), ('paper_body_keep_days', '30')").run();
  const r = await paperBodyRetentionTick(w.env);
  ok(w.count("cfg") === 4 && r.keep === 3 && r.days === 30, "paper_body_keep and paper_body_keep_days set the bound (3 newest and the oldest)", { c: w.count("cfg"), r });
  w.au.prepare("DELETE FROM ops_config").run();
  w.au.prepare("INSERT INTO ops_config VALUES ('paper_body_prune', 'off')").run();
  w.add("cfg2", 20, 200);
  const off = await paperBodyRetentionTick(w.env);
  ok(off.enabled === false && w.count("cfg2") === 20, "paper_body_prune = off stops it", off);
  w.au.prepare("DELETE FROM ops_config").run();
  const broken = await paperBodyRetentionTick({ LIVING_PAPER: { prepare: () => { throw new Error("D1_ERROR: boom"); } }, QNFO_AUDIT: d1(w.au) });
  ok(typeof broken.error === "string" && broken.error.includes("D1_ERROR"), "a database failure is a field of the result, never a throw", broken);
  w.add("bulk", 30, 400);
  for (let i = 0; i < 40; i++) w.add("s" + i, 12, 400);
  w.au.prepare("DELETE FROM ops_config").run();
  const big = await paperBodyRetentionTick(w.env);
  ok(big.slugs <= 25, "at most 25 slugs are pruned in one run", big);
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
