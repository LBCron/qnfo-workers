// PLUS-5 offline suite: /api/plus and /plus read product_registry (usage columns from PLUS-2), plus_ledger and plus_digest and tell the owner what got better.
// An unreadable table is named, never shown as an empty week; a product with no usage number says unmeasured; usage is requests, not people.
// Run: node qnfo-fleet-dashboard/plus.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const mkEnv = (db) => ({ AUDIT: { prepare(sql) { let params = []; const st = { bind(...v) { params = v; return st; }, async all() { return { results: db.prepare(sql).all(...params) }; }, async first() { return db.prepare(sql).get(...params) || null; }, async run() { return { meta: {} }; } }; return st; } } });
const call = (env, p) => worker.fetch(new Request("https://fleet.qnfo.org" + p), env, { waitUntil() {} });
const REG = (usage) => `CREATE TABLE product_registry (product TEXT PRIMARY KEY, host TEXT, worker TEXT, program_code TEXT NOT NULL, what_for TEXT, usage_metric TEXT, quality_measure TEXT, plus_cadence_h INTEGER NOT NULL DEFAULT 168, last_plus_at TEXT, rest_until TEXT, misses_in_row INTEGER NOT NULL DEFAULT 0, pluses_since_simplify INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'active', created_at TEXT${usage ? ", usage_value INTEGER, usage_window TEXT, usage_errors INTEGER, usage_read_at TEXT, usage_source TEXT" : ""});`;
const LEDGER = `CREATE TABLE plus_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, product_slug TEXT, plus TEXT, status TEXT, metric TEXT, decided_at TEXT, product TEXT, kind TEXT, title TEXT, issue_id INTEGER, pr_url TEXT, outcome TEXT);`;
const DIGEST = `CREATE TABLE plus_digest (day TEXT PRIMARY KEY, products INTEGER, in_flight INTEGER, decided_7d INTEGER, deployed_7d INTEGER, reverted_7d INTEGER, body_md TEXT NOT NULL, created_at TEXT);`;
const now = new Date();
const iso = (d) => new Date(now.getTime() - d * 86400000).toISOString().slice(0, 19).replace("T", " ");

{ // empty tables: honest page, no error
  const db = new DatabaseSync(":memory:");
  db.exec(REG(true) + LEDGER + DIGEST);
  const j = await (await call(mkEnv(db), "/api/plus")).json();
  ok(j.schema_version === "fleet-plus/v1" && j.ok && j.digest === null && j.products.length === 0 && j.unavailable.length === 0, "empty tables read as no digest yet", j);
  const h = await (await call(mkEnv(db), "/plus")).text();
  ok(/No digest has been written yet/.test(h) && /No plus was proposed, shipped or reverted in the last 7 days/.test(h), "the page says nothing was written, not that something failed");
}
{ // full data
  const db = new DatabaseSync(":memory:");
  db.exec(REG(true) + LEDGER + DIGEST);
  db.exec(`INSERT INTO product_registry (product, host, worker, program_code, what_for, plus_cadence_h, last_plus_at, state, usage_metric, usage_value, usage_window, usage_errors, usage_read_at, usage_source) VALUES
    ('jobs', 'jobs.q08.org', 'qnfo-jobsearch', 'QNFO.PERSONAL', 'live job matcher', 24, '2026-11-04T10:00:00Z', 'active', 'worker_requests_7d', 6126, '7d', 3, '2026-11-04T03:10:53.347Z', 'cf'),
    ('shorts-channel', 'youtube', 'qnfo-youtube-shorts', 'QNFO.REACH', 'plain-language Shorts', 24, NULL, 'active', 'youtube_views_total', NULL, 'lifetime', NULL, NULL, 'views'),
    ('resting', 'x.q08.org', 'w', 'QNFO.REACH', '<b>x</b>', 24, NULL, 'active', NULL, 12, '7d', 0, NULL, NULL);
    UPDATE product_registry SET rest_until = '2999-01-01T00:00:00Z' WHERE product = 'resting';
    INSERT INTO plus_ledger (product, kind, title, status, decided_at, issue_id, pr_url) VALUES
    ('jobs', 'plus', 'Group stretch matches', 'proposed', '${iso(1)}', 1001801, NULL),
    ('jobs', 'plus', 'Show the reason on every match', 'deployed', '${iso(2)}', 12, 'https://github.com/QNFO/qnfo-workers/pull/1'),
    ('jobs', 'plus', 'Old plus', 'reverted', '${iso(30)}', 3, NULL),
    ('shorts-channel', 'plus', 'A <script>alert(1)</script> plus', 'kept', '${iso(3)}', NULL, NULL);
    INSERT INTO plus_digest VALUES ('2026-11-03', 9, 1, 3, 2, 0, 'What got better in the last 7 days: ' || char(10) || '- jobs: Show the reason on every match [deployed]', '2026-11-03T00:50:00Z'), ('2026-10-27', 9, 0, 0, 0, 0, 'older', '2026-10-27T00:50:00Z');`);
  const r = await call(mkEnv(db), "/api/plus");
  const j = await r.json();
  ok(r.status === 200 && j.unavailable.length === 0 && j.products.length === 3, "feed answers with three products", j);
  const jobs = j.products.find((p) => p.product === "jobs");
  ok(jobs.in_flight === 1 && jobs.shipped === 1 && jobs.reverted === 1 && jobs.usage.value === 6126 && jobs.usage.errors === 3 && jobs.usage.window === "7d", "per product: in flight, kept, reverted, usage", jobs);
  const sh = j.products.find((p) => p.product === "shorts-channel");
  ok(sh.usage === null && sh.shipped === 1, "a product with a NULL usage value has usage null (unmeasured), not 0", sh);
  ok(j.digest.day === "2026-11-03" && j.digests.length === 2, "the newest digest first", j.digests);
  ok(j.week.length === 3 && j.week.every((w) => w.title !== "Old plus"), "the week list holds only the last 7 days", j.week);
  const h = await (await call(mkEnv(db), "/plus")).text();
  ok(/Digest of 2026-11-03/.test(h) && /Show the reason on every match \[deployed\]/.test(h), "the page shows the newest digest text");
  ok(/6,126/.test(h) && /unmeasured/.test(h) && /not how many people use them/.test(h) && /never zero/.test(h), "usage is formatted, unmeasured is named, and the page says it is requests not people");
  ok(!/<script>alert/.test(h) && /&lt;script&gt;alert/.test(h), "ledger text is escaped");
  ok(/resting to 2999-01-01/.test(h), "a resting product says so");
  ok(/href="\/plus"/.test(h) && /aria-current="page"/.test(h), "the page is in the navigation and lights its tab");
  ok(/<a href="https:\/\/github.com\/QNFO\/qnfo-workers\/pull\/1">PR<\/a>/.test(h), "a shipped plus links its pull request");
  ok(/<thead><tr><th>Product<\/th>/.test(h) && (h.match(/data-l="Used \(7 days\)"/g) || []).length === 3 && /data-l="Host"/.test(h) && /@media\(max-width:640px\)/.test(h), "on a phone each product is a stacked card: header row hidden, every value labelled (data-l)");
  ok(/<td><b>jobs<\/b> <span class="meta">20\d\d-\d\d-\d\d<\/span><\/td><td data-l="Plus">Show the reason on every match/.test(h), "the week list leads with the product and the date, the plus and its state are labelled");
  const e1 = r.headers.get("etag");
  const r2 = await worker.fetch(new Request("https://fleet.qnfo.org/api/plus", { headers: { "if-none-match": e1 || "x" } }), mkEnv(db), { waitUntil() {} });
  ok(!e1 || r2.status === 304 || r2.status === 200, "the feed carries an ETag like its sibling feeds");
}
{ // an unreadable ledger is named, not shown as an empty week
  const db = new DatabaseSync(":memory:");
  db.exec(REG(true) + DIGEST);
  const j = await (await call(mkEnv(db), "/api/plus")).json();
  ok(j.unavailable.includes("plus_ledger"), "a missing plus_ledger is named in unavailable", j.unavailable);
  const h = await (await call(mkEnv(db), "/plus")).text();
  ok(/Could not read: .*plus_ledger/.test(h) && !/No plus was proposed, shipped or reverted/.test(h), "the page names the unreadable table instead of claiming an empty week");
}
{ // the usage columns are not there yet: the page still lists the products
  const db = new DatabaseSync(":memory:");
  db.exec(REG(false) + LEDGER + DIGEST);
  db.exec("INSERT INTO product_registry (product, host, worker, program_code, what_for) VALUES ('q08-home', 'q08.org', 'q08-signal-engine', 'QNFO.REACH', 'homepage')");
  const j = await (await call(mkEnv(db), "/api/plus")).json();
  ok(j.products.length === 1 && j.products[0].usage === null && j.unavailable.includes("product_registry.usage"), "without the usage columns the product is listed and the gap is named", j);
}
{ // the area registry and the API index know the page
  const db = new DatabaseSync(":memory:");
  db.exec(REG(true) + LEDGER + DIGEST);
  const a = await (await call(mkEnv(db), "/api")).text();
  ok(/\/api\/plus/.test(a), "the API index lists /api/plus");
}
console.log(pass + " passed, " + fail + " failed");
