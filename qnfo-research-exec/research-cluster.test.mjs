// RESEARCH-CLUSTER-1 (qnfo-research-exec 0.37.0, errata-hub 1.9.0; agent_issues 1000292, 1000293, 1000294, 1000295, 1000287, 1000328). Offline: node:sqlite as D1, no network.
// Proves: (1) the internal confirm excerpt is centred on the passage a claim quotes (with or without an At: anchor, across whitespace and quote style) and falls back
// to the first window when no quotation can be located; (2) errata routing makes one remediation row per paper, appends an erratum that arrives while that row still
// waits, holds one that arrives while the row is being worked, and caps new rows per run; routed errata are verified when a remediation row of the paper publishes after
// the routing; (3) a new paper whose [n] has no References entry, or that cites itself, fails finalGates and the switch turns it off; (4) the review prompt carries the
// cross-section consistency check; (5) the dead 5-a-day cap is gone and the park sweep leaves an hourly heartbeat; (6) errata-hub is folded into the host with two confirm overrides.
// Run: node --no-warnings qnfo-research-exec/research-cluster.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { finalGates, danglingCitations, citeRangeOn } from "./worker.js";
import { versionAtLeast } from "../scripts/version-at-least.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const hub = readFileSync(join(here, "..", "errata-hub", "worker.js"), "utf8");
const confirmMigration = readFileSync(join(here, "..", "migrations", "2026-11-01-errata-confirm-attempts.sql"), "utf8");
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

// ---------------------------------------------------------------- (1) confirm excerpt
{
  const block = (s) => s.slice(s.indexOf("// ---- ERRATA-INTERNAL-CONFIRM-1:BEGIN"), s.indexOf("// ---- ERRATA-INTERNAL-CONFIRM-1:END"));
  const hostConfirm = block(src);
  const foldedHostConfirm = hostConfirm.replace(/^CONFIRM_MODEL_OTHER = "@cf\/zai-org\/glm-5\.3";\nINTERNAL_CONFIRM_MAX = 20;\n/m, "");
  ok(hostConfirm.length > 1000 && foldedHostConfirm === block(hub), "the host confirm block matches errata-hub apart from the two host-specific overrides");
  const mod = new Function(block(src) + "\nreturn { confirmExcerpt, CONFIRM_EXCERPT_MAX };")();
  const fnOnly = new Function(src.match(/^var CONFIRM_EXCERPT_MAX = [^;]+;/m)[0] + "\n" + src.match(/^function confirmExcerpt\(body, claim\) \{[\s\S]*?\n\}/m)[0] + "\nreturn confirmExcerpt;")();
  ok(typeof fnOnly === "function", "confirmExcerpt is one self-contained function (qnfo-lifecycle/paper-learn-anchor.test.mjs evaluates it on its own)");
  const MAX = mod.CONFIRM_EXCERPT_MAX;
  const filler = (n, tag) => (tag + " lorem ipsum dolor sit amet consectetur. ").repeat(Math.ceil(n / 41)).slice(0, n);
  const passage = "the bootstrap interval for the lattice constant excludes zero at the stated level";
  const body = filler(45000, "head") + " " + passage + ". " + filler(15000, "tail");
  ok(body.length > 56000, "the synthetic body is longer than twice the window", body.length);

  const none = mod.confirmExcerpt(body, "the claim names nothing in quotes");
  ok(none.length === MAX && none === body.slice(0, MAX) && none.indexOf(passage) < 0, "no quotation: the first window is kept", none.length);
  const anch = mod.confirmExcerpt(body, 'Defect. At: "' + passage + '" The claim.');
  ok(anch.length === MAX && anch.indexOf(passage) >= 0, "an At: anchor centres the window on its passage");
  const quoted = mod.confirmExcerpt(body, 'The paper says "' + passage + '" but the table disagrees.');
  ok(quoted.length === MAX && quoted.indexOf(passage) >= 0, "a quoted fragment without an anchor centres the window (PAPER-CONFIRM-FALLBACK-1)");
  const curly = mod.confirmExcerpt(body, "The paper says “" + passage + "” but the table disagrees.");
  ok(curly.indexOf(passage) >= 0, "typographic quotes around the fragment are read");
  const single = mod.confirmExcerpt(body, "Defect: '" + passage + "' (Section 5.3).");
  ok(single.length === MAX && single.indexOf(passage) >= 0 && fnOnly(body, "Defect: '" + passage + "' (Section 5.3).").indexOf(passage) >= 0, "a single-quoted fragment (the common PAPER-LEARN-1 style) centres the window");
  const poss = mod.confirmExcerpt(body, "The author's text says 'the bootstrap interval for the lattice constant excludes zero at the stated level' and the model's state differs.");
  ok(poss.indexOf(passage) >= 0, "apostrophes inside words are not quotation marks");
  const elided = mod.confirmExcerpt(body, "It says 'zzzz not in this paper at all anywhere ... " + passage + "' in 5.3");
  ok(elided.indexOf(passage) >= 0, "a quotation split by an ellipsis is tried piece by piece");
  const lead = mod.confirmExcerpt(body, "Prose with 'a short one' and then 'also not long' only.");
  ok(lead === body.slice(0, MAX), "quoted pieces under 16 characters anchor nothing");
  const wrapped = body.replace(passage, passage.replace(/ /g, "\n  "));
  const ws = mod.confirmExcerpt(wrapped, 'It says "' + passage + '" here.');
  ok(ws.length === MAX && ws.indexOf("lattice\n  constant") >= 0, "a passage broken across lines in the paper is still located");
  const apos = body.replace(passage, "the author’s bootstrap interval for the lattice constant excludes zero at the stated level");
  const aq = mod.confirmExcerpt(apos, "It says \"the author's bootstrap interval for the lattice constant excludes zero\" here.");
  ok(aq.indexOf("author’s bootstrap") >= 0, "an apostrophe in curly or straight style does not hide the passage");
  const tail = body.slice(0, 59000) + " " + passage + " end.";
  const near = mod.confirmExcerpt(tail, 'It says "' + passage + '".');
  ok(near.length === MAX && near.indexOf(passage) >= 0, "a passage near the end keeps a full window", near.length);
  const short = mod.confirmExcerpt(body, 'It says "short quote".');
  ok(short === body.slice(0, MAX), "a quotation under 16 characters is not an anchor");
  const weird = mod.confirmExcerpt(body, 'It says "a.b(c)[d]*{e}+f|g^h$i\\j k l m n o p".');
  ok(weird === body.slice(0, MAX), "regular-expression characters in a quotation are literals and never throw");
  const missing = mod.confirmExcerpt(body, 'It says "a passage that the paper does not contain at all, anywhere".');
  ok(missing === body.slice(0, MAX), "a quotation the paper does not contain keeps the first window");
  const second = mod.confirmExcerpt(body, 'It says "not in the paper at all, nowhere to be found" and also "' + passage + '".');
  ok(second.indexOf(passage) >= 0, "the second quoted fragment is tried when the first is not in the paper");
  ok(mod.confirmExcerpt("x".repeat(100), 'It says "xxxxxxxxxxxxxxxxxxxxxxxx".') === "x".repeat(100), "a body under the window is returned whole");
  ok(!/function confirmExcerpt\(claim, text\)/.test(src), "the misplaced dead helper inside parseExtractedClaims is gone");
}

// ---------------------------------------------------------------- (1b) confirm order: oldest first, a deferring row sinks (ERRATA-DEFER-SINK-1, agent_issues 100449)
{
  const block = src.slice(src.indexOf("// ---- ERRATA-INTERNAL-CONFIRM-1:BEGIN"), src.indexOf("// ---- ERRATA-INTERNAL-CONFIRM-1:END"));
  const mod = new Function(block + "\nreturn { confirmInternalErrata };")();
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE errata_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, email_id INTEGER, source TEXT, sender TEXT, subject TEXT, paper_doi TEXT, claim TEXT, status TEXT DEFAULT 'internal-open', created_at TEXT, updated_at TEXT);
CREATE TABLE internal_errata (id TEXT PRIMARY KEY, status TEXT DEFAULT 'open', remediation TEXT, updated_at TEXT);
CREATE TABLE papers (slug TEXT, title TEXT, body_md TEXT, doi TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);`);
  db.exec(confirmMigration.replace(/^--.*$/gm, ""));
  db.prepare("INSERT INTO papers VALUES (?, ?, ?, NULL)").run("good", "Good", "The paper text is here. ".repeat(50));
  db.prepare("INSERT INTO papers VALUES (?, ?, ?, NULL)").run("empty", "Empty", "   ");
  const add = (subj, doi, created) => {
    db.prepare("INSERT INTO internal_errata (id, status, remediation) VALUES (?, 'open', '')").run(subj);
    db.prepare("INSERT INTO errata_queue (source, sender, subject, paper_doi, claim, status, created_at, updated_at) VALUES ('internal_audit', 'qnfo-lifecycle PAPER-LEARN-1', ?, ?, 'a claim', 'internal-open', ?, ?)").run(subj, doi, created, created);
  };
  add("poison-a", "empty", "2026-10-20 00:00:00"); add("poison-b", "empty", "2026-10-20 01:00:00"); add("poison-c", "empty", "2026-10-20 02:00:00");
  add("ok-1", "good", "2026-10-20 03:00:00"); add("ok-2", "good", "2026-10-20 04:00:00"); add("ok-3", "good", "2026-10-20 05:00:00");
  db.prepare("INSERT INTO ops_config VALUES ('errata_confirm_max', '3')").run();
  const env = { WATCH_DB: d1(db), QNFO_AUDIT: d1(db), PAPERS_DB: d1(db), AI: { run: async () => ({ choices: [{ message: { content: '{"confirmed": true, "why": "quoted"}' } }] }) } };
  const out1 = await mod.confirmInternalErrata(env);
  ok(out1.candidates === 3 && out1.deferred === 3 && out1.confirmed === 0, "the first run takes the three oldest rows (all three have an empty paper and defer)", out1);
  const touched = db.prepare("SELECT subject, updated_at FROM errata_queue WHERE subject LIKE 'poison-%' ORDER BY id").all();
  ok(touched.every((r) => r.updated_at > "2026-10-21"), "each deferred row is touched, so it is visible and sinks", touched);
  const out2 = await mod.confirmInternalErrata(env);
  ok(out2.candidates === 3 && out2.deferred === 0 && out2.confirmed === 3, "the second run reaches the rows behind the poison rows: they no longer hold the three slots", out2);
  const states = db.prepare("SELECT subject, status FROM errata_queue ORDER BY id").all().map((r) => r.subject + ":" + r.status);
  ok(states.join() === "poison-a:internal-open,poison-b:internal-open,poison-c:internal-open,ok-1:detected,ok-2:detected,ok-3:detected", "the good rows settled, the poison rows stay open for a later try", states);
  const out3 = await mod.confirmInternalErrata(env);
  ok(out3.candidates === 3 && out3.deferred === 3, "once nothing else is waiting the poison rows are tried again, oldest first", out3);
  ok(db.prepare("SELECT count(*) AS n FROM cloud_ops_events WHERE kind = 'errata_confirm_defer'").get().n === 0, "an empty paper is a no-body defer (console only); a model failure writes the cloud_ops_events row");
  ok(!/ORDER BY RANDOM\(\) LIMIT \?2/.test(src) && /ORDER BY q\.updated_at ASC, q\.id ASC LIMIT \?2/.test(src), "the selector is oldest-first, not random");
  const out4 = await mod.confirmInternalErrata(env);
  ok(out4.blocked === 3 && out4.deferred === 3, "the third repeated defer blocks each poison row instead of retrying forever", out4);
  const blocked = db.prepare("SELECT subject, status FROM errata_queue WHERE subject LIKE 'poison-%' ORDER BY id").all();
  ok(blocked.every((r) => r.status === "internal-blocked"), "exhausted internal errata are excluded from the automatic retry lane", blocked);
  const reasons = db.prepare("SELECT id, remediation FROM internal_errata WHERE id LIKE 'poison-%' ORDER BY id").all();
  ok(reasons.every((r) => (r.remediation.match(/ERRATA-INTERNAL-CONFIRM-DEFER-1/g) || []).length === 3 && /has no body/.test(r.remediation)), "each blocked row retains its three bounded defer reasons", reasons);
}

// ---------------------------------------------------------------- (2) routing
{
  const a = src.indexOf("var ERRATA_ROUTE_ROWS_PER_RUN"), b = src.indexOf("async function runPublish(env, mode) {");
  const ha = hub.indexOf("var ERRATA_ROUTE_ROWS_PER_RUN"), hb = hub.indexOf("async function runPublish(env, mode) {");
  ok(a > 0 && b > a && src.slice(a, b) === hub.slice(ha, hb), "the routing block of the host equals errata-hub");
  const code = src.slice(a, b);
  const m = new Function(code + "\nreturn { routeHighRiskErrata, verifyRoutedErrata, errataIdea, ERRATA_ROUTE_ROWS_PER_RUN, ERRATA_IDEA_MAX };")();
  ok(/await routeHighRiskErrata\(env\);\s*await verifyRoutedErrata\(env\);/.test(src), "runPublish routes, then verifies the routed errata");

  const mk = () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE internal_errata (id TEXT PRIMARY KEY, target_kind TEXT NOT NULL, target_ref TEXT NOT NULL, detected_at TEXT NOT NULL, detected_by TEXT, severity TEXT DEFAULT 'high', claim_text TEXT, falsification TEXT, evidence TEXT, remediation TEXT, status TEXT DEFAULT 'open', owner TEXT, updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE errata_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, email_id INTEGER UNIQUE, source TEXT NOT NULL DEFAULT 'inbound-email', sender TEXT, subject TEXT, paper_doi TEXT, claim TEXT, confidence REAL, status TEXT DEFAULT 'detected', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), confirm_attempts INTEGER DEFAULT 0);
CREATE TABLE errata_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, queue_id INTEGER NOT NULL, email_id INTEGER, paper_doi TEXT, slug TEXT, version_from TEXT, version_to TEXT, risk TEXT DEFAULT 'low', clarification TEXT, acknowledgement TEXT, changelog TEXT, corrected_md TEXT, status TEXT DEFAULT 'drafted', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE research_queue (id TEXT PRIMARY KEY, source TEXT, source_id TEXT, idea TEXT, summary TEXT, score REAL, decision TEXT, status TEXT DEFAULT 'queued', claimed_at TEXT, completed_at TEXT, paper_slug TEXT, created_at TEXT, stage TEXT, agent_task_id TEXT, attempt INTEGER DEFAULT 0, revise_count INTEGER DEFAULT 0, context TEXT, published_at TEXT, doi TEXT, paper_url TEXT, error TEXT, recover_count INTEGER DEFAULT 0, terminal_rearms INTEGER DEFAULT 0, publish_due_at TEXT, UNIQUE(source, source_id));`);
    return { db, env: { WATCH_DB: d1(db), AUDIT_DB: d1(db) } };
  };
  let seq = 0;
  const erratum = (db, slug, claim, o = {}) => {
    const sid = "pl-" + slug + "-" + (++seq);
    db.prepare("INSERT INTO internal_errata (id, target_kind, target_ref, detected_at, claim_text, status) VALUES (?, 'paper', ?, datetime('now'), ?, 'open')").run(sid, slug, claim);
    const q = db.prepare("INSERT INTO errata_queue (source, subject, claim, status) VALUES ('internal_audit', ?, ?, 'audited')").run(sid, claim);
    const act = db.prepare("INSERT INTO errata_actions (queue_id, slug, risk, status, created_at) VALUES (?, ?, ?, 'drafted', datetime('now', ?))").run(Number(q.lastInsertRowid), slug, o.risk || "high", o.age || "-7 hours");
    return { sid, queueId: Number(q.lastInsertRowid), actionId: Number(act.lastInsertRowid) };
  };
  const rows = (db) => db.prepare("SELECT * FROM research_queue WHERE source = 'remediation' ORDER BY created_at, id").all();
  const act = (db, id) => db.prepare("SELECT * FROM errata_actions WHERE id = ?").get(id);
  const que = (db, id) => db.prepare("SELECT * FROM errata_queue WHERE id = ?").get(id);

  {
    const { db, env } = mk();
    const e1 = erratum(db, "paper-a", "Table 1 has 16 rows but the text says 15."), e2 = erratum(db, "paper-a", "Reference [12] does not exist."), e3 = erratum(db, "paper-b", "The sum is 41 not 42.");
    const out = await m.routeHighRiskErrata(env);
    const r = rows(db);
    ok(r.length === 2 && out.rows === 2 && out.routed === 3 && out.merged === 1, "three errata over two papers make two remediation rows", { out, n: r.length });
    const ra = r.find((x) => x.paper_slug === "paper-a"), rb = r.find((x) => x.paper_slug === "paper-b");
    ok(ra && ra.source_id === "errata:" + e1.queueId && ra.status === "queued" && ra.stage === "ground" && ra.score === 0.95, "the paper's row is keyed by its first erratum and starts at ground", ra);
    ok(ra && ra.idea.indexOf("2 errata") > 0 && ra.idea.indexOf("Table 1 has 16 rows") > 0 && ra.idea.indexOf("Reference [12] does not exist") > 0, "the row for paper-a lists both errata", ra && ra.idea);
    ok(rb && rb.idea === "Correct the published paper 'paper-b' for erratum " + e3.sid + ": The sum is 41 not 42.", "a single erratum keeps the former idea text byte for byte", rb && rb.idea);
    ok([e1, e2, e3].every((e) => act(db, e.actionId).status === "routed" && que(db, e.queueId).status === "implemented"), "every routed erratum is routed and its queue row implemented");
    ok(db.prepare("SELECT count(*) AS n FROM internal_errata WHERE status = 'closed'").get().n === 3 && out.synced === 3, "internal_errata still follows its queue row", out);

    // an erratum for paper-a arrives while its row still waits: appended, no new row
    const e4 = erratum(db, "paper-a", "The abstract says seven criteria, the body defines six.");
    const out2 = await m.routeHighRiskErrata(env);
    const ra2 = rows(db).filter((x) => x.paper_slug === "paper-a");
    ok(ra2.length === 1 && out2.rows === 0 && out2.merged === 1 && ra2[0].idea.indexOf("Also: ") > 0 && ra2[0].idea.indexOf("seven criteria") > 0, "an erratum for a paper whose row still waits is appended to it", { out2, idea: ra2[0].idea });
    ok(act(db, e4.actionId).status === "routed" && que(db, e4.queueId).status === "implemented", "the appended erratum is routed");
    const out3 = await m.routeHighRiskErrata(env);
    ok(out3.routed === 0 && rows(db).length === 2, "a second run with nothing ready changes nothing", out3);

    // an erratum for paper-b arrives while its row is being worked: it waits
    db.prepare("UPDATE research_queue SET status = 'researching', stage = 'ensemble', claimed_at = datetime('now') WHERE paper_slug = 'paper-b'").run();
    const e5 = erratum(db, "paper-b", "Figure 2 caption contradicts the text.");
    const out4 = await m.routeHighRiskErrata(env);
    ok(out4.waiting === 1 && out4.routed === 0 && act(db, e5.actionId).status === "drafted" && que(db, e5.queueId).status === "audited" && rows(db).filter((x) => x.paper_slug === "paper-b").length === 1, "an erratum that arrives while its paper is being rewritten waits, audited", out4);
    // the row ends (parked): the next run starts a new row from the corrected state
    db.prepare("UPDATE research_queue SET status = 'wontfix', stage = 'parked' WHERE paper_slug = 'paper-b'").run();
    const out5 = await m.routeHighRiskErrata(env);
    ok(out5.rows === 1 && act(db, e5.actionId).status === "routed" && rows(db).filter((x) => x.paper_slug === "paper-b").length === 2, "once the row has ended the waiting erratum gets its own row", out5);
    // a row that is queued at a later stage (re-armed) is not appended to either
    db.prepare("UPDATE research_queue SET status = 'queued', stage = 'revise', claimed_at = NULL WHERE paper_slug = 'paper-b' AND status = 'queued'").run();
    const e6 = erratum(db, "paper-b", "Equation 7 drops a factor of two.");
    const out6 = await m.routeHighRiskErrata(env);
    ok(out6.waiting === 1 && act(db, e6.actionId).status === "drafted", "a re-armed row at a later stage is not appended to", out6);
  }
  {
    const { db, env } = mk();
    const all = [];
    for (let i = 0; i < 7; i++) all.push(erratum(db, "paper-" + i, "Defect number " + i + " in the text."));
    const out = await m.routeHighRiskErrata(env);
    ok(out.rows === m.ERRATA_ROUTE_ROWS_PER_RUN && out.waiting === 2 && rows(db).length === 5, "no more than five new rows are made in one run", out);
    ok(all.filter((e) => act(db, e.actionId).status === "drafted").length === 2, "the two errata over the cap wait for the next run");
    const out2 = await m.routeHighRiskErrata(env);
    ok(out2.rows === 2 && rows(db).length === 7, "the next run routes them", out2);
  }
  {
    const { db, env } = mk();
    const young = erratum(db, "paper-y", "Too fresh to route.", { age: "-1 hours" });
    const low = erratum(db, "paper-l", "A low risk draft is the publish lane's.", { risk: "low" });
    const out = await m.routeHighRiskErrata(env);
    ok(out.routed === 0 && act(db, young.actionId).status === "drafted" && act(db, low.actionId).status === "drafted", "a draft under six hours old and a low-risk draft are not routed", out);
  }
  {
    const { db, env } = mk();
    const long = "x".repeat(900);
    const es = [];
    for (let i = 0; i < 12; i++) es.push(erratum(db, "paper-long", "Defect " + i + " " + long));
    await m.routeHighRiskErrata(env);
    const r = rows(db);
    ok(r.length === 1 && r[0].idea.length <= m.ERRATA_IDEA_MAX && r[0].idea.indexOf("12 errata") > 0, "a long list of errata stays inside the idea limit", r.length && r[0].idea.length);
  }
  {
    // verifyRoutedErrata: routed -> verified when a remediation row of the paper published after the routing
    const { db, env } = mk();
    const e = erratum(db, "paper-v", "Defect to verify.");
    await m.routeHighRiskErrata(env);
    db.prepare("UPDATE errata_actions SET updated_at = '2026-10-26 10:00:00' WHERE id = ?").run(e.actionId);
    ok((await m.verifyRoutedErrata(env)).verified === 0 && act(db, e.actionId).status === "routed", "routed errata stay routed while the paper's row has not published");
    db.prepare("UPDATE research_queue SET status = 'published', published_at = '2026-10-26T09:00:00.000Z' WHERE paper_slug = 'paper-v'").run();
    ok((await m.verifyRoutedErrata(env)).verified === 0 && act(db, e.actionId).status === "routed", "a row published before the routing does not verify it");
    db.prepare("INSERT INTO research_queue (id, source, source_id, idea, status, paper_slug, published_at) VALUES ('rem-rev-x', 'remediation', 'revision:paper-v@1.0.0', 'loop', 'published', 'paper-v', '2026-10-26T12:00:00.000Z')").run();
    ok((await m.verifyRoutedErrata(env)).verified === 0 && act(db, e.actionId).status === "routed", "a revision-loop row of the paper does not verify an erratum it never carried");
    db.prepare("UPDATE research_queue SET published_at = '2026-10-26T11:00:00.000Z' WHERE paper_slug = 'paper-v' AND source_id LIKE 'errata:%'").run();
    const v = await m.verifyRoutedErrata(env);
    ok(v.verified === 1 && act(db, e.actionId).status === "verified", "the erratum is verified once its paper's errata row has published after the routing", v);
    ok((await m.verifyRoutedErrata(env)).verified === 0, "verifying twice changes nothing");
  }
}

// ---------------------------------------------------------------- (3) dangling citations
{
  const entries = (nums) => nums.map((n) => "[" + n + "] Author N. A work number " + n + ". arXiv:2401." + String(n).padStart(5, "0") + ".").join("\n");
  const paperOf = (title, bodyExtra, nums) => "# " + title + "\n\n## Abstract\n\nWe study the problem.\n\n## 1. Introduction\n\n" + bodyExtra + "\n\n## References\n\n" + entries(nums) + "\n";
  const T = "Ultrametric Frobnication of Bruhat Tits Lattices Under Noise";
  const d = (body, nums = [1, 2, 3, 4, 5, 6, 7, 8], title = T) => { const p = paperOf(title, body, nums); const parts = p.split(/^## References.*$/im); return danglingCitations(p, parts[parts.length - 1]); };
  ok(d("Prior work [3] and [1, 2] and [5-7] and [8].").missing.length === 0, "citations inside the list pass");
  ok(JSON.stringify(d("As shown in [12] and [3].").missing) === "[12]", "a number past the list is reported", d("As shown in [12] and [3]."));
  ok(JSON.stringify(d("See [9] and [4, 11].").missing) === "[9,11]", "numbers in a group are checked one by one", d("See [9] and [4, 11]."));
  ok(JSON.stringify(d("Both [7-10] here.").missing) === "[9,10]", "a range is checked end to end");
  ok(d("The interval [0, 1] and [0, 100] hold.").missing.length === 0, "an interval with a 0 is not a citation");
  ok(d("The index a[12] and the call f[13] are not citations.").missing.length === 0, "a bracket glued to a word is not a citation");
  ok(d("Math $x_{[12]}$ and $$y = [14]$$ and \\(z[15]\\) and \\[w = [16]\\] stay math.").missing.length === 0, "brackets inside math are not read");
  ok(d("Code `a[12]` and\n```\nb[13]\n```\nare code.").missing.length === 0, "brackets inside code are not read");
  ok(d("A link [12](https://example.org) and a definition [13]: here.").missing.length === 0, "a markdown link or definition is not a citation");
  ok(d("A far index [100] is not read as a citation.").missing.length === 0, "a number far above the list is an index, not a citation");
  ok(JSON.stringify(d("Adjacent [3][12] citations.").missing) === "[12]", "adjacent citation brackets are both read");
  ok(JSON.stringify(d("Sparse [4] and [12].", [1, 3, 5, 12]).missing) === "[4]", "the list is read by its numbers, not its length", d("Sparse [4] and [12].", [1, 3, 5, 12]));
  ok(d("A [12] here.", [1, 2]).missing.length === 0, "a list with fewer than three numbered entries decides nothing");
  ok(d("A [3].", [1, 2, 3, 4]).self.length === 0, "no self reference without a matching entry");
  const selfList = [1, 2, 3].map((n) => "[" + n + "] Author N. A work number " + n + ".").join("\n") + "\n[4] Quni R. Ultrametric Frobnication of Bruhat-Tits Lattices Under Noise. papers.qnfo.org.\n";
  const selfPaper = "# " + T + "\n\n## 1. Introduction\n\nWe cite [1] and [4].\n\n## References\n\n" + selfList;
  const sd = danglingCitations(selfPaper, selfList);
  ok(JSON.stringify(sd.self) === "[4]", "a reference that is the paper itself is found by its title", sd);
  ok(danglingCitations(selfPaper.replace(T, "Short"), selfList).self.length === 0, "a title under 24 characters is not matched");
  const arxivList = selfList.replace(/^\[4\].*$/m, "[4] Quni R. Ultrametric Frobnication of Bruhat-Tits Lattices Under Noise. arXiv:2609.07866v2. https://arxiv.org/abs/2609.07866v2");
  ok(danglingCitations(selfPaper, arxivList).self.length === 0, "an arXiv source that shares the paper's title is a source, not a self citation");

  const long = ("This sentence carries the argument forward with enough words to count as prose. ").repeat(300);
  const pap = (body) => "# " + T + "\n\n## Abstract\n\nAbstract.\n\n## 1. Introduction\n\n" + body + "\n\n" + long + "\n\n## References\n\n" + entries([1, 2, 3, 4, 5, 6, 7, 8]) + "\n";
  const g1 = finalGates(pap("Prior work [3] and [12]."), { minChars: 1000, bibCount: 8, structure: true, citeRange: true });
  const f1 = g1.fixes.find((f) => f.id === "gate-citation-range");
  ok(f1 && f1.severity === "HARD" && /\[12\]/.test(f1.claim) && /8|entries/.test(f1.reason), "finalGates holds a new paper with a dangling citation (HARD, named)", g1.fixes.map((f) => f.id));
  ok(!finalGates(pap("Prior work [3] and [12]."), { minChars: 1000, bibCount: 8, structure: true }).fixes.some((f) => f.id === "gate-citation-range"), "without the switch option the gate does not run (published papers are never gated)");
  ok(!finalGates(pap("Prior work [3] and [8]."), { minChars: 1000, bibCount: 8, structure: true, citeRange: true }).fixes.some((f) => f.id === "gate-citation-range"), "a paper whose citations all have entries passes the gate");
  ok(finalGates(pap("Prior work [3] and [12]."), { minChars: 1000, bibCount: 8, structure: true, citeRange: true }).ok === false, "a dangling citation makes finalGates not ok");

  const envFor = (val, boom) => ({ QNFO_AUDIT: { prepare: () => ({ first: async () => { if (boom) throw new Error("D1_ERROR"); return val === undefined ? null : { value: val }; } }) } });
  ok(await citeRangeOn(envFor(undefined)) === true, "no ops_config row: the gate is on");
  ok(await citeRangeOn(envFor("off")) === false && await citeRangeOn(envFor(" OFF ")) === false, "ops_config research_cite_range_gate = off turns it off");
  ok(await citeRangeOn(envFor("on")) === true && await citeRangeOn(envFor("enforce")) === true, "any other value keeps it on");
  ok(await citeRangeOn(envFor(undefined, true)) === true, "an unreadable switch keeps it on");
  ok(/citeRange: await citeRangeOn\(env\)/.test(src), "the verify stage passes the switch to finalGates");
  ok(/verify-claims-skipped/.test(src) && /ex\.claims\.length > claims\.length/.test(src), "the verify stage logs the claims its cap skipped");
}

// ---------------------------------------------------------------- (4) review prompt, (5) dead cap and heartbeat
{
  ok(src.indexOf("Cross-section consistency (PAPER-REVIEW-CONSISTENCY-1)") > 0 && /"11\. Cross-section consistency/.test(src), "the review prompt names the cross-section consistency check as item 11");
  ok(/a mismatch between two passages of the paper = HARD/i.test(src) && /table of 16 rows described as 15/.test(src), "a mismatch is HARD and the 16-row table example is in the prompt");
  ok(src.indexOf("spot-check 2-3 derivations") < 0 && /check every headline number \(Abstract, Introduction, Results, Conclusion\)/.test(src), "item 3 checks every headline number, not 2-3 derivations");
  ok(src.indexOf("daily publication cap of 5 reached") < 0, "the dead 5-a-day publication cap is gone (code-probe absent)");
  ok(/await logEvent\(env, "lane-heartbeat"/.test(src) && /_sMin === 0\) await logEvent\(env, "lane-heartbeat"/.test(src), "the hourly lane sweep leaves a lane-heartbeat event whether or not it returned a row (SINGLE-LANE-1: the former park-rearm-heartbeat)");
  ok(versionAtLeast(src.match(/var VERSION = "([^"]+)"/)?.[1], "0.37.0"), "the host is 0.37.0 or later");
  ok(/ERRATA_VERSION = "1\.9\.\d+-folded"/.test(src) && /var VERSION = "1\.9\.\d+-[a-z-]+"/.test(hub), "the member is 1.9.x in the host and in errata-hub");
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
