// PAPER-LEDGER-CHAIN-1 offline suite (RM-ADR-013-014-ENFORCEMENT-1, charter pillar security). Run: node qnfo-lifecycle/paper-ledger-chain.test.mjs   -> prints "N passed, 0 failed"
// Runs the real ledger migration (PAPER-LEDGER-1), the real chain migration and the real qnfo-lifecycle functions against SQLite (node:sqlite) with a D1-shaped wrapper:
// sealing, the append-only and contiguity triggers, tamper detection (edited ledger row, deleted chain row, back-dated ledger row, rewritten chain with an intact anchor),
// the sticky break event and its resolution, and the ADR-014 publish check in observe, enforce and off modes.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const W = (await import("./worker.js")).default;
const P = W.__paperLedgerChain;
const ledgerSql = readFileSync(new URL("../migrations/living-paper/2026-10-26-paper-change-ledger.sql", import.meta.url), "utf8");
const provenanceSql = readFileSync(new URL("../migrations/2026-11-01-paper-provenance-metadata.sql", import.meta.url), "utf8");
const chainSql = readFileSync(new URL("../migrations/living-paper/2026-11-05-w2d2-paper-ledger-chain.sql", import.meta.url), "utf8");
const sealsSql = readFileSync(new URL("../migrations/2026-11-05-w2d2-paper-ledger-seals.sql", import.meta.url), "utf8");

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 700) : "")); } };
const throws = (fn, re, m) => { try { fn(); ok(false, m + " (did not throw)"); } catch (e) { ok(re.test(String(e && e.message || e)), m, String(e && e.message || e)); } };

function d1(dbx) {
  const stmt = (sql) => { let args = []; const self = { sql, bind(...a) { args = a; return self; }, exec() { return dbx.prepare(sql).run(...args); },
    async all() { return { results: dbx.prepare(sql).all(...args) }; }, async first() { return dbx.prepare(sql).get(...args) || null; }, async run() { const r = dbx.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; } }; return self; };
  return { prepare: stmt, async batch(stmts) { dbx.exec("BEGIN"); try { for (const s of stmts) s.exec(); dbx.exec("COMMIT"); } catch (e) { dbx.exec("ROLLBACK"); throw e; } return stmts.map(() => ({ success: true })); } };
}
// the migration runner splits statements itself; here a file is executed whole (node:sqlite parses BEGIN..END trigger bodies)
function mkLiving() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE papers (identifier TEXT PRIMARY KEY, title TEXT DEFAULT '', authors TEXT DEFAULT '[]', abstract TEXT, doi TEXT, version TEXT DEFAULT '1.0.0', subtitle TEXT, license TEXT, keywords TEXT, journal TEXT, paper_type TEXT, zenodo_doi TEXT, categories TEXT, "references" TEXT,
    slug TEXT, status TEXT, body_md TEXT, updated_at TEXT, release_gate_pass INTEGER DEFAULT 0, release_gate_at TEXT, release_gate_reason TEXT, identifier_type TEXT, first_published_at TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE paper_body_backups (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, version TEXT, status TEXT, title TEXT, body_md TEXT NOT NULL, captured_at TEXT NOT NULL, reason TEXT);
    CREATE TABLE publication_gate_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, run_at TEXT DEFAULT (datetime('now')), slug TEXT, status TEXT, mode TEXT, decision TEXT, reason TEXT, score INTEGER, quality_flag TEXT, body_len INTEGER, has_abstract INTEGER, refs INTEGER, gate_version TEXT);`);
  db.exec(ledgerSql);
  db.exec(provenanceSql);
  db.exec(chainSql);
  return db;
}
function mkAudit() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);
    CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);`);
  for (const m of ["paper_ledger_chain_breaks", "paper_ledger_unsealed_min", "adr014_new_publication_violations", "adr014_legacy_byline_papers"]) db.prepare("INSERT INTO metric_registry (metric) VALUES (?)").run(m);
  db.exec(sealsSql);
  return db;
}
const OWNER = '["Rowan Brad Quni-Gudzinas"]';
function seed(db, n) {
  db.prepare("INSERT INTO papers (identifier, slug, status, authors, body_md) VALUES ('p1', 'one', 'published', ?, ?)").run(OWNER, "# One\n\n" + "a".repeat(300));
  for (let i = 1; i < n; i++) db.prepare("UPDATE papers SET body_md = ?, change_actor = ?, change_reason = ? WHERE slug = 'one'").run("# One v" + i + "\n\n" + String.fromCharCode(97 + (i % 20)).repeat(300 + i), "test:edit:" + i, "edit " + i);
}
const metric = (a, name) => a.prepare("SELECT last_value v, state FROM metric_registry WHERE metric = ?").get(name);

{ // sealing: every ledger row gets a chain row, in order, hashes chain, bodies are committed, the anchor is written
  const db = mkLiving(), au = mkAudit(); seed(db, 8);
  const ledgerN = db.prepare("SELECT COUNT(*) n FROM paper_change_ledger").get().n;
  const env = { LIVING_PAPER: d1(db), QNFO_AUDIT: d1(au) };
  const r = await P.tick(env, { nowMs: Date.parse("2026-11-05T10:00:00Z") });
  ok(r.status === "ok" && r.sealed === ledgerN && r.head_seq === ledgerN && r.anchored === true, "the first tick seals every ledger row and anchors the head", r);
  const chain = db.prepare("SELECT * FROM paper_ledger_chain ORDER BY seq").all();
  ok(chain.length === ledgerN && chain[0].prev_hash === "genesis" && chain.every((c, i) => i === 0 || c.prev_hash === chain[i - 1].row_hash), "the chain starts at genesis and every row names the previous hash");
  ok(chain.every((c) => /^sha256:[0-9a-f]{64}$/.test(c.row_hash)), "row hashes are sha256:<hex>");
  const withBody = db.prepare("SELECT COUNT(*) n FROM paper_change_bodies").get().n;
  ok(chain.filter((c) => c.body_sha256).length === withBody && withBody > 0, "each kept body is committed in its chain row", { withBody });
  ok(au.prepare("SELECT COUNT(*) n FROM paper_ledger_seals").get().n === 1 && au.prepare("SELECT head_hash h FROM paper_ledger_seals").get().h === chain[chain.length - 1].row_hash, "the head hash is anchored in the audit database");
  ok(db.prepare("SELECT * FROM v_paper_ledger_chain_breaks").all().length === 0, "a clean chain has no SQL-visible breaks");
  ok(r.breaks === 0 && r.hash_breaks === 0 && r.anchor_breaks === 0 && r.unsealed_rows === 0, "a clean chain reports no breaks and nothing unsealed", r);
  ok(metric(au, "paper_ledger_chain_breaks").v === "0" && metric(au, "paper_ledger_chain_breaks").state === "MEASURED" && metric(au, "paper_ledger_unsealed_min").v === "0", "the break and lag metrics are published");
  // a second tick with nothing new seals nothing and writes no second seal
  const r2 = await P.tick(env, { nowMs: Date.parse("2026-11-05T11:00:00Z") });
  ok(r2.sealed === 0 && r2.anchored === false && au.prepare("SELECT COUNT(*) n FROM paper_ledger_seals").get().n === 1, "a tick with nothing new seals nothing and anchors nothing", r2);
  // new ledger rows are sealed next
  db.prepare("UPDATE papers SET body_md = ?, change_actor = 't:x', change_reason = 'more' WHERE slug = 'one'").run("# One v99\n\n" + "z".repeat(400));
  const r3 = await P.tick(env, { nowMs: Date.parse("2026-11-05T12:00:00Z") });
  ok(r3.sealed === 1 && r3.head_seq === ledgerN + 1 && au.prepare("SELECT COUNT(*) n FROM paper_ledger_seals").get().n === 2, "a new ledger row is sealed on the next tick and anchored again", r3);
  // the page size and the per-call cap
  const db2 = mkLiving(); seed(db2, 30);
  const s2 = await P.seal({ LIVING_PAPER: d1(db2) }, { maxRows: 12, page: 5 });
  ok(s2.sealed === 12 && db2.prepare("SELECT COUNT(*) n FROM paper_ledger_chain").get().n === 12, "a call seals at most maxRows, in pages", s2);
  const s3 = await P.seal({ LIVING_PAPER: d1(db2) }, { maxRows: 1000, page: 7 });
  ok(db2.prepare("SELECT COUNT(*) n FROM paper_ledger_chain").get().n === db2.prepare("SELECT COUNT(*) n FROM paper_change_ledger").get().n, "the next call carries on from the head and finishes", s3);
}
{ // the triggers: append-only, next row only, previous hash only
  const db = mkLiving(); seed(db, 6);
  await P.seal({ LIVING_PAPER: d1(db) }, {});
  throws(() => db.exec("UPDATE paper_ledger_chain SET row_hash = 'x' WHERE seq = 1"), /append-only/, "a chain row cannot be updated");
  throws(() => db.exec("DELETE FROM paper_ledger_chain WHERE seq = 1"), /append-only/, "a chain row cannot be deleted");
  const head = db.prepare("SELECT seq, row_hash FROM paper_ledger_chain ORDER BY seq DESC LIMIT 1").get();
  db.prepare("UPDATE papers SET body_md = ?, change_actor = 't:y', change_reason = 'r1' WHERE slug = 'one'").run("# n1\n\n" + "q".repeat(500));
  db.prepare("UPDATE papers SET body_md = ?, change_actor = 't:y', change_reason = 'r2' WHERE slug = 'one'").run("# n2\n\n" + "w".repeat(500));
  const good = "sha256:" + "a".repeat(64);
  throws(() => db.prepare("INSERT INTO paper_ledger_chain (seq, prev_hash, row_hash, sealed_by) VALUES (?, ?, ?, 't')").run(head.seq + 2, head.row_hash, good), /next ledger row/, "a chain row that skips a ledger row is refused");
  throws(() => db.prepare("INSERT INTO paper_ledger_chain (seq, prev_hash, row_hash, sealed_by) VALUES (?, ?, ?, 't')").run(head.seq + 1, good, good), /previous row hash/, "a chain row with the wrong previous hash is refused");
  throws(() => db.prepare("INSERT INTO paper_ledger_chain (seq, prev_hash, row_hash, sealed_by) VALUES (?, ?, 'not-a-hash', 't')").run(head.seq + 1, head.row_hash), /sha256/, "a malformed hash is refused");
  throws(() => db.prepare("INSERT INTO paper_ledger_chain (seq, prev_hash, row_hash, sealed_by) VALUES (?, ?, ?, 't')").run(head.seq, head.row_hash, good), /next ledger row/, "a repeat of the head is refused");
  throws(() => db.prepare("INSERT INTO paper_ledger_chain (seq, prev_hash, row_hash, sealed_by) VALUES (99999, ?, ?, 't')").run(head.row_hash, good), /next ledger row/, "a chain row for a ledger row that does not exist is refused");
  db.prepare("INSERT INTO paper_ledger_chain (seq, prev_hash, row_hash, sealed_by) VALUES (?, ?, ?, 't')").run(head.seq + 1, head.row_hash, good);
  ok(db.prepare("SELECT COUNT(*) n FROM paper_ledger_chain").get().n === head.seq + 1, "the next ledger row with the right previous hash is accepted");
  // two sealers racing: the second page is refused whole
  const db2 = mkLiving(); seed(db2, 10);
  const e2 = { LIVING_PAPER: d1(db2) };
  const [a, b] = await Promise.allSettled([P.seal(e2, { maxRows: 100, page: 100 }), P.seal(e2, { maxRows: 100, page: 100 })]);
  ok(db2.prepare("SELECT COUNT(*) n FROM paper_ledger_chain").get().n === db2.prepare("SELECT COUNT(*) n FROM paper_change_ledger").get().n && db2.prepare("SELECT * FROM v_paper_ledger_chain_breaks").all().length === 0,
    "two sealers at once leave one clean chain (the loser's page is refused whole)", [a.status, b.status]);
}
{ // tamper: each way of changing the record is caught
  const mk = async () => { const db = mkLiving(), au = mkAudit(); seed(db, 9); const env = { LIVING_PAPER: d1(db), QNFO_AUDIT: d1(au) }; await P.tick(env, { nowMs: Date.parse("2026-11-05T10:00:00Z") }); return { db, au, env }; };
  { // 1. a ledger row edited after the triggers were dropped
    const { db, au, env } = await mk();
    db.exec("DROP TRIGGER paper_change_ledger_no_update");
    db.exec("UPDATE paper_change_ledger SET actor = 'someone-else', reason = 'rewritten' WHERE seq = 3");
    const r = await P.tick(env, { nowMs: Date.parse("2026-11-05T11:00:00Z"), verifyRows: 100 });
    ok(r.hash_breaks >= 1 && r.breaks >= 1, "an edited ledger row is caught by the hash recomputation", r);
    ok(au.prepare("SELECT status FROM cloud_ops_events WHERE id = 'plc-break-hash-mismatch-3'").get()?.status === "break", "the finding is recorded as a break event");
    ok(Number(metric(au, "paper_ledger_chain_breaks").v) >= 1, "the break metric is above zero");
    // the finding is sticky: it stays after the window moves on
    const r2 = await P.tick(env, { nowMs: Date.parse("2026-11-05T12:00:00Z"), verifyRows: 1 });
    ok(r2.hash_breaks >= 1, "the finding stays open while the row is still wrong", r2);
    // restoring the row resolves it
    db.exec("UPDATE paper_change_ledger SET actor = (SELECT actor FROM (SELECT 'test:edit:2' AS actor)), reason = 'edit 2' WHERE seq = 3");
    const orig = db.prepare("SELECT actor, reason FROM paper_change_ledger WHERE seq = 3").get();
    ok(orig.actor === "test:edit:2", "fixture: the row was put back", orig);
    const r3 = await P.tick(env, { nowMs: Date.parse("2026-11-05T13:00:00Z"), verifyRows: 1 });
    ok(r3.hash_breaks === 0 && au.prepare("SELECT status FROM cloud_ops_events WHERE id = 'plc-break-hash-mismatch-3'").get().status === "resolved", "a row that hashes true again resolves its finding", r3);
  }
  { // 2. a chain row deleted (triggers dropped)
    const { db } = await mk();
    db.exec("DROP TRIGGER paper_ledger_chain_no_delete");
    db.exec("DELETE FROM paper_ledger_chain WHERE seq = 4");
    const br = db.prepare("SELECT seq, kind FROM v_paper_ledger_chain_breaks").all();
    ok(br.some((b) => b.kind === "link" && b.seq === 5) && br.some((b) => b.kind === "ledger-row-unsealed-below-head" && b.seq === 4), "a deleted chain row shows as a broken link and an unsealed ledger row", br);
  }
  { // 3. a ledger row deleted (triggers dropped)
    const { db } = await mk();
    db.exec("DROP TRIGGER paper_change_ledger_no_delete");
    db.exec("DELETE FROM paper_change_ledger WHERE seq = 2");
    ok(db.prepare("SELECT kind FROM v_paper_ledger_chain_breaks").all().some((b) => b.kind === "ledger-row-missing"), "a deleted ledger row shows as ledger-row-missing");
  }
  { // 4. a ledger row inserted below the head
    const { db } = await mk();
    db.prepare("INSERT INTO paper_change_ledger (seq, slug, kind, fields_changed, actor) VALUES (0, 'one', 'update', 'status', 'forger')").run();
    ok(db.prepare("SELECT kind FROM v_paper_ledger_chain_breaks").all().some((b) => b.kind === "ledger-row-unsealed-below-head"), "a back-dated ledger row shows as unsealed below the head");
  }
  { // 5. a body added to a row sealed without one, and an archive proof that disagrees
    const { db } = await mk();
    const noBody = db.prepare("SELECT c.seq s FROM paper_ledger_chain c WHERE c.body_sha256 IS NULL ORDER BY c.seq LIMIT 1").get();
    db.prepare("INSERT INTO paper_change_bodies (seq, slug, body_md) VALUES (?, 'one', 'late body')").run(noBody.s);
    ok(db.prepare("SELECT kind FROM v_paper_ledger_chain_body_breaks").all().some((b) => b.kind === "body-added-after-seal") && db.prepare("SELECT sql_breaks FROM v_paper_ledger_chain_status").get().sql_breaks >= 1, "a body added after sealing is flagged and counted in the status");
    const withBody = db.prepare("SELECT c.seq s FROM paper_ledger_chain c WHERE c.body_sha256 IS NOT NULL ORDER BY c.seq LIMIT 1").get();
    db.prepare("INSERT INTO paper_change_body_archive (seq, r2_key, bytes, fingerprint) VALUES (?, 'k', 1, ?)").run(withBody.s, "sha256:" + "0".repeat(64));
    ok(db.prepare("SELECT kind FROM v_paper_ledger_chain_body_breaks").all().some((b) => b.kind === "body-archive-mismatch"), "an archive fingerprint that differs from the sealed body hash is flagged");
  }
  { // 6. a kept body edited in place: caught by the body re-hash in the verification window
    const { db, env } = await mk();
    db.exec("DROP TRIGGER paper_change_bodies_no_update");
    const row = db.prepare("SELECT c.seq s FROM paper_ledger_chain c WHERE c.body_sha256 IS NOT NULL ORDER BY c.seq LIMIT 1").get();
    db.prepare("UPDATE paper_change_bodies SET body_md = 'rewritten history' WHERE seq = ?").run(row.s);
    const v = await P.verifyRows(env.LIVING_PAPER, 0, 100);
    ok(v.bad.some((b) => b.seq === row.s && b.kind === "body-hash-mismatch"), "a body edited in place fails the body hash check", v);
  }
  { // 7. the whole chain rewritten consistently in living-paper: only the anchor in the other database catches it
    const { db, au, env } = await mk();
    db.exec("DROP TRIGGER paper_ledger_chain_no_update; DROP TRIGGER paper_ledger_chain_no_delete; DROP TRIGGER paper_change_ledger_no_update");
    db.exec("UPDATE paper_change_ledger SET reason = 'history rewritten' WHERE seq = 2");
    db.exec("DELETE FROM paper_ledger_chain");
    db.exec("DROP TRIGGER paper_ledger_chain_valid");
    // re-seal from scratch over the rewritten ledger: a perfectly consistent chain
    const stmts = []; let prev = "genesis";
    for (const r of db.prepare("SELECT * FROM paper_change_ledger ORDER BY seq").all()) {
      const body = db.prepare("SELECT body_md FROM paper_change_bodies WHERE seq = ?").get(r.seq);
      const bs = body ? await P.sha(body.body_md) : null; const h = await P.hash(prev, r, bs);
      db.prepare("INSERT INTO paper_ledger_chain (seq, prev_hash, row_hash, body_sha256, sealed_by) VALUES (?, ?, ?, ?, 'forger')").run(r.seq, prev, h, bs); prev = h;
    }
    ok(db.prepare("SELECT * FROM v_paper_ledger_chain_breaks").all().length === 0, "fixture: the forged chain is internally consistent (SQL sees nothing wrong)");
    const r = await P.tick(env, { nowMs: Date.parse("2026-11-05T11:00:00Z") });
    ok(r.anchor_breaks >= 1 && r.breaks >= 1, "a consistently rewritten chain is caught by the anchor in the audit database", r);
    ok(Number(metric(au, "paper_ledger_chain_breaks").v) >= 1, "the break metric reflects the anchor break");
  }
}
{ // sealer lag: 0 while nothing waits, small while a backlog is being worked off, large when the sealer has stopped
  const db = mkLiving(), au = mkAudit(); seed(db, 12);
  const env = { LIVING_PAPER: d1(db), QNFO_AUDIT: d1(au) };
  const first = await P.tick(env, { maxRows: 5, page: 5 });
  ok(first.sealed === 5 && first.unsealed_rows > 0 && first.unsealed_min <= 1, "while a backlog is being worked off the lag is the time since the last seal, not the age of the backlog", first);
  const rest = await P.tick(env, {});
  ok(rest.unsealed_rows === 0 && rest.unsealed_min === 0, "with nothing waiting the lag is 0", rest);
  db.exec("DROP TRIGGER paper_ledger_chain_no_update");
  db.exec("UPDATE paper_ledger_chain SET sealed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours') WHERE seq = (SELECT MAX(seq) FROM paper_ledger_chain)");
  db.prepare("UPDATE papers SET body_md = ?, change_actor = 't:z', change_reason = 'late' WHERE slug = 'one'").run("# late " + "k".repeat(500));
  const st = db.prepare("SELECT unsealed_rows, unsealed_min FROM v_paper_ledger_chain_status").get();
  ok(st.unsealed_rows === 1 && st.unsealed_min >= 179 && st.unsealed_min <= 182, "a sealer that stopped three hours ago while a row waits reads about 180 minutes", st);
}
{ // missing tables degrade quietly (a deploy that lands before the migration)
  const db = new DatabaseSync(":memory:");
  const r = await P.tick({ LIVING_PAPER: d1(db), QNFO_AUDIT: d1(mkAudit()) }, {});
  ok(r.skipped && /not installed/.test(r.skipped), "without the chain table the tick is skipped, not failed", r);
  const r2 = await P.tick({}, {});
  ok(r2.skipped && /LIVING_PAPER/.test(r2.skipped), "without the binding the tick is skipped", r2);
}
{ // the open status route's data
  const db = mkLiving(), au = mkAudit(); seed(db, 5);
  const env = { LIVING_PAPER: d1(db), QNFO_AUDIT: d1(au) };
  await P.tick(env, {});
  const s = await P.status(env, true);
  ok(s.chain_rows === db.prepare("SELECT COUNT(*) n FROM paper_change_ledger").get().n && /^sha256:/.test(s.head_hash) && s.seals.length === 1 && s.verified.hash_breaks === 0 && s.verified.anchor_breaks === 0, "the status route reports head, seals and a fresh verification", s);
}
{ // window rotation covers every row over time
  const seen = new Set(); const rows = 450, size = 100;
  for (let h = 0; h < 12; h++) { const off = P.windowOffset(h * 36e5, rows, size); for (let i = 0; i < size; i++) seen.add((off + i) % rows); }
  ok(seen.size === rows, "the hourly verification window visits every chain row within a day", seen.size);
  ok(P.windowOffset(0, 50, 100) === 0, "a chain smaller than the window is verified whole");
}
{ // ADR-014 at publish: observe records, enforce refuses, restores and external preprints are not first publications
  const db = mkLiving();
  const ins = (id, status, authors) => db.prepare("INSERT INTO papers (identifier, slug, status, authors, body_md) VALUES (?, ?, ?, ?, 'x')").run(id, id, status, authors);
  const audit = () => db.prepare("SELECT slug, event FROM adr014_publish_audit ORDER BY id").all();
  ins("ok1", "published", OWNER); ins("ok2", "distributed", "Rowan Brad Quni-Gudzinas"); ins("ext", "external_preprint", "Some Other Author"); ins("dr", "draft", '["QNFO Research"]');
  ok(audit().length === 0, "the owner byline, an external preprint and a draft are not recorded");
  ins("bad1", "published", '["QNFO Research"]'); ins("bad2", "published", null);
  ok(audit().length === 2 && audit()[0].event === "insert", "observe: an organisation byline or none is recorded and the write goes through", audit());
  ok(db.prepare("SELECT COUNT(*) n FROM papers WHERE slug IN ('bad1','bad2')").get().n === 2, "observe lets the write through");
  db.prepare("UPDATE papers SET status = 'published' WHERE slug = 'dr'").run();
  ok(audit().some((a) => a.slug === "dr" && a.event === "update"), "the first move from draft to published with an organisation byline is recorded");
  db.prepare("UPDATE papers SET status = 'quarantined' WHERE slug = 'bad1'").run();
  const n = audit().length;
  db.prepare("UPDATE papers SET status = 'published' WHERE slug = 'bad1'").run();
  ok(audit().length === n, "a restore from quarantine is not a first publication and is not recorded");
  db.prepare("UPDATE papers SET authors = '[\"QNFO Research\"]' WHERE slug = 'ok1'").run();
  ok(audit().length === n + 1, "changing a published owner byline to an organisation byline is recorded");
  throws(() => db.exec("DELETE FROM adr014_publish_audit"), /append-only/, "the publish audit is append-only");
  const st = db.prepare("SELECT * FROM v_adr014_authorship_status").get();
  ok(st.publish_mode === "observe" && st.public_papers >= 5 && st.violations >= 3, "the status view counts public papers and violations", st);
  db.exec("UPDATE adr_enforcement SET mode = 'enforce' WHERE rule = 'adr014-publish-authorship'");
  throws(() => ins("bad3", "published", '["QNFO"]'), /ADR-014-AUTHORSHIP-BLOCKED/, "enforce: an organisation byline is refused at insert");
}
{ // enforce on update path, off mode, and era split
  const db = mkLiving();
  db.prepare("INSERT INTO papers (identifier, slug, status, authors, body_md) VALUES ('d1', 'd1', 'draft', '[\"QNFO Research\"]', 'x')").run();
  db.exec("UPDATE adr_enforcement SET mode = 'enforce' WHERE rule = 'adr014-publish-authorship'");
  throws(() => db.prepare("UPDATE papers SET status = 'published' WHERE slug = 'd1'").run(), /ADR-014-AUTHORSHIP-BLOCKED/, "enforce: publishing a draft with an organisation byline is refused");
  db.prepare("UPDATE papers SET authors = ? WHERE slug = 'd1'").run(OWNER);
  db.prepare("UPDATE papers SET status = 'published' WHERE slug = 'd1'").run();
  ok(db.prepare("SELECT status FROM papers WHERE slug = 'd1'").get().status === "published", "enforce: the same draft publishes once it names the owner");
  db.exec("UPDATE adr_enforcement SET mode = 'off' WHERE rule = 'adr014-publish-authorship'");
  db.prepare("INSERT INTO papers (identifier, slug, status, authors, body_md) VALUES ('o1', 'o1', 'published', '[\"QNFO\"]', 'x')").run();
  ok(db.prepare("SELECT COUNT(*) n FROM adr014_publish_audit").get().n === 0, "off: nothing is recorded or refused");
  db.prepare("INSERT INTO papers (identifier, slug, status, authors, body_md, first_published_at) VALUES ('old', 'old', 'published', '[\"QNFO Research\"]', 'x', '2026-08-04')").run();
  db.prepare("INSERT INTO papers (identifier, slug, status, authors, body_md, first_published_at) VALUES ('new', 'new', 'published', '[\"QNFO Research\"]', 'x', '2026-09-10')").run();
  const era = Object.fromEntries(db.prepare("SELECT slug, era FROM v_adr014_authorship_violations").all().map((r) => [r.slug, r.era]));
  ok(era.old === "legacy" && era.new === "since-adr", "violations are split into legacy and since-adr by first public date", era);
  const au = mkAudit();
  const r = await P.tick({ LIVING_PAPER: d1(db), QNFO_AUDIT: d1(au) }, {});
  ok(r.adr014 && r.adr014.since_adr >= 1 && r.adr014.legacy >= 1 && Number(metric(au, "adr014_new_publication_violations").v) === r.adr014.since_adr && Number(metric(au, "adr014_legacy_byline_papers").v) === r.adr014.legacy, "the tick publishes the authorship metrics", r.adr014);
}
{ // D1 rejects a compound SELECT of more than 5 terms: count the UNION ALL terms of every view in the chain migration
  const views = chainSql.split("CREATE VIEW IF NOT EXISTS ").slice(1).map((v) => ({ name: v.split(" ")[0], terms: v.split(";")[0].split("UNION").length }));
  ok(views.length === 5, "the chain migration defines five views", views);
  for (const v of views) ok(v.terms <= 5, "view " + v.name + " stays within 5 compound terms (D1 limit)", v.terms);
}
{ // the open route: a deploy that lands before the migration answers 503 and logs nothing; an installed chain answers 200
  const errs = []; const origErr = console.error; console.error = (...a) => { errs.push(a.join(" ")); };
  try {
    const bare = await W.fetch(new Request("https://x/paper-ledger/chain"), { LIVING_PAPER: d1(new DatabaseSync(":memory:")) }, {});
    const body = await bare.json();
    ok(bare.status === 503 && body.installed === false, "before the migration the route answers 503 installed:false", [bare.status, body]);
    ok(errs.length === 0, "a missing table is not logged as an error (no observability issue)", errs);
    const db = mkLiving(), au = mkAudit(); seed(db, 4);
    const env = { LIVING_PAPER: d1(db), QNFO_AUDIT: d1(au) };
    await P.tick(env, {});
    const live = await W.fetch(new Request("https://x/paper-ledger/chain?verify=1"), env, {});
    const lb = await live.json();
    ok(live.status === 200 && lb.marker === "PAPER-LEDGER-CHAIN-1" && lb.verified.hash_breaks === 0, "an installed chain answers 200 with a clean verification", [live.status, lb]);
    ok(live.headers.get("cache-control") === "public, max-age=60", "the route is cached for a minute");
  } finally { console.error = origErr; }
}
{ // source pins
  const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  ok(/var PLC_COLS = \[/.test(src) && src.includes("PAPER-LEDGER-CHAIN-1:BEGIN") && src.includes("PAPER-LEDGER-CHAIN-1:END"), "the chain block is delimited in worker.js");
  ok(src.includes('u.pathname === "/paper-ledger/chain"'), "the open status route is served");
  const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
  ok(mirror === src, "deployed-current.worker.js is identical to worker.js");
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
