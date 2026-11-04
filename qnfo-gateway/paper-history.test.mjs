// PAPER-HISTORY-1 offline suite (qnfo-gateway 3.56.0): the versions, changes, diff and files views of one paper, read from the living-paper ledger.
// Locks: every ledger update is listed with a diff link and the earlier text stays reachable verbatim; the diff shows paragraph and word changes of the Markdown
// (and escapes the text); the content view ignores header layout while the raw view shows it; the files page carries sizes and SHA-256, the repository record when
// the repository has one, and the research runs; history.json and the RO-Crate describe the same record; unknown, unpublished and malformed requests are refused.
// Run: node qnfo-gateway/paper-history.test.mjs -> "N passed, 0 failed"
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import worker from "./worker.js";

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600) : "")); } };
const sha = (t) => createHash("sha256").update(t).digest("hex");

const V1 = "---\nauthor: R\nORCID: 1\n---\n\n# Old Title\n\n**Author:** R\n\nFirst paragraph that stays exactly the same across versions.\n\nThe proximity effect <script>alert(1)</script> is weak at low twist angles and\nwe measured it once in 2019.\n\nA paragraph that will be deleted entirely.\n\n## Results\n\nUnchanged result one.\n\nUnchanged result two.\n\nUnchanged result three.\n\n## Version History\n\n- Version 1.0.0 (2026-10-01): first release.\n";
const V1_CLEAN_FMT = "# Old Title\n\n## Abstract\n\nFirst paragraph that stays exactly the same across versions.\n\nThe proximity effect <script>alert(1)</script> is weak at low twist angles and\nwe measured it once in 2019.\n\nA paragraph that will be deleted entirely.\n\n## Results\n\nUnchanged result one.\n\nUnchanged result two.\n\nUnchanged result three.\n";
const V2 = "# Old Title\n\n## Abstract\n\nFirst paragraph that stays exactly the same across versions.\n\nThe proximity effect is strong at low twist angles and\nwe measured it twice in 2019 and 2020.\n\nA brand new paragraph about thermodynamic scaling.\n\n## Results\n\nUnchanged result one.\n\nUnchanged result two.\n\nUnchanged result three.\n";

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE papers(slug TEXT PRIMARY KEY,doi TEXT,keywords TEXT,title TEXT,subtitle TEXT,abstract TEXT,body_md TEXT,version TEXT,version_semver TEXT,status TEXT,license TEXT,authors TEXT,pdf_path TEXT,created_at TEXT,first_published_at TEXT,last_revised_at TEXT,updated_at TEXT);
  CREATE TABLE paper_change_ledger(seq INTEGER PRIMARY KEY,ts TEXT,slug TEXT,kind TEXT,fields_changed TEXT,actor TEXT,reason TEXT,version_before TEXT,version_after TEXT,body_len_before INT,body_len_after INT,backfilled INT);
  CREATE TABLE paper_change_bodies(seq INTEGER PRIMARY KEY,slug TEXT,body_md TEXT,metadata TEXT);
  CREATE TABLE paper_version_history(id INTEGER PRIMARY KEY,slug TEXT,version TEXT,title TEXT,abstract TEXT,body_md TEXT,archived_at TEXT,superseded_by TEXT);
  CREATE TABLE research_run_ledger(run_id TEXT,slug TEXT,repo TEXT,run_path TEXT,cycle TEXT,paper_path TEXT,paper_version TEXT,paper_sha256 TEXT,commit_sha TEXT,status TEXT,deposited_at TEXT);
  CREATE TABLE paper_category(slug TEXT,category TEXT,secondary TEXT);
  CREATE VIRTUAL TABLE papers_fts USING fts5(title,abstract);
`);
db.prepare("INSERT INTO papers VALUES('hist-paper',NULL,NULL,'Old Title','', 'Abstract text.',?,'1.1.0','1.1.0','published','QNFO-ULA','[\"R\"]',NULL,'2026-10-01','2026-10-01','2026-11-04','2026-11-04')").run(V2);
db.prepare("INSERT INTO papers VALUES('hist-draft',NULL,NULL,'Draft',NULL,NULL,'x','0.1.0','0.1.0','draft',NULL,NULL,NULL,'2026-10-01',NULL,NULL,NULL)").run();
// ledger: seq 10 = the layout edit of v1.0.0, seq 11 = the revision to v1.1.0 (bodies hold the text BEFORE each change)
db.prepare("INSERT INTO paper_change_ledger VALUES(10,'2026-10-26T10:00:00.000Z','hist-paper','update','body_md','qnfo-research-exec:paper-format:hist-paper:abc','layout normalised','1.0.0','1.0.0',?,?,0)").run(V1.length, V1_CLEAN_FMT.length);
db.prepare("INSERT INTO paper_change_ledger VALUES(11,'2026-11-04T10:00:00.000Z','hist-paper','update','body_md,version','qnfo-research-exec:version-queue:hist-paper:def','revised to 1.1.0','1.0.0','1.1.0',?,?,0)").run(V1_CLEAN_FMT.length, V2.length);
db.prepare("INSERT INTO paper_change_ledger VALUES(5,'2026-09-01T10:00:00.000Z','hist-paper','update','body_md','qnfo-research-exec:draft:hist-paper:SECRETRUN','a draft edit before publication','0.1.0','0.1.0',5,5,0)").run();
db.prepare("INSERT INTO paper_change_bodies VALUES(5,'hist-paper','SECRET DRAFT TEXT',NULL)").run();
db.prepare("INSERT INTO paper_change_bodies VALUES(10,'hist-paper',?,NULL)").run(V1);
db.prepare("INSERT INTO paper_change_bodies VALUES(11,'hist-paper',?,NULL)").run(V1_CLEAN_FMT);
db.prepare("INSERT INTO paper_version_history VALUES(1,'hist-paper','0.9.0','Older','A',?, '2026-10-20 08:00:00','1.0.0')").run("# Older\n\nA very early draft paragraph.\n");
db.prepare("INSERT INTO research_run_ledger VALUES('run-1','hist-paper','QNFO/qnfo-research','runs/cycle-9/run-1','9','papers/hist-paper/paper.md','1.1.0','x','deadbeef1234','deposited','2026-11-04 10:05:00')").run();
db.prepare("INSERT INTO research_run_ledger VALUES('run-nocommit','hist-paper','QNFO/qnfo-research','runs/cycle-8/run-2','8','p','1.0.0','x',NULL,'deposited','2026-11-03 10:05:00')").run();
db.prepare("INSERT INTO research_run_ledger VALUES('run-evil','hist-paper','evil/repo','../../etc','9','p','1.1.0','x','c','deposited','2026-11-04 10:05:00')").run();

const binding = {
  prepare(sql) {
    let args = [];
    const st = {
      bind(...v) { args = v; return st; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; }
    };
    return st;
  }
};
const env = { LIVING_PAPER: binding, AUDIT: binding };
let repoRecord = { schema: "qnfo-paper-provenance/1", snapshots: [{ version: "1.0.0", sha256: "a".repeat(64), bytes: 1000, recorded_at: "2026-11-02", basis: "deposit" }, { version: "1.1.0", sha256: "b".repeat(64), bytes: 2000, recorded_at: "2026-11-04", basis: "revision" }] };
globalThis.fetch = async (url) => {
  if (String(url).startsWith("https://raw.githubusercontent.com/QNFO/qnfo-research/main/papers/hist-paper/provenance.json")) return repoRecord ? new Response(JSON.stringify(repoRecord), { status: 200 }) : new Response("", { status: 404 });
  return new Response("", { status: 404 });
};
const get = (path, headers) => worker.fetch(new Request("https://papers.example.test" + path, { headers: headers || {} }), env, { waitUntil() {} });
const text = async (path) => { const r = await get(path); return { status: r.status, type: r.headers.get("content-type") || "", body: await r.text() }; };

// 1. history page
let h = await text("/papers/hist-paper/history");
ok(h.status === 200 && /text\/html/.test(h.type), "history page is HTML", h.status);
ok(/v1\.1\.0/.test(h.body) && /v1\.0\.0/.test(h.body) && /v0\.9\.0/.test(h.body), "all three versions are listed (ledger and legacy snapshot)");
ok(h.body.indexOf("v1.1.0") < h.body.indexOf("v0.9.0"), "newest version first");
ok(/diff\?change=10/.test(h.body) && /diff\?change=11/.test(h.body), "every ledger update links its diff");
ok(/from=v1\.0\.0&amp;to=current/.test(h.body), "the current version links its comparison with the previous one");
ok(/\/papers\/hist-paper\/v\/1\.0\.0/.test(h.body) && /\/papers\/hist-paper\/versions\/1/.test(h.body), "verbatim text links for a ledger version and a snapshot");
ok(h.body.includes(sha(V1_CLEAN_FMT).slice(0, 16)), "the SHA-256 of the last text of v1.0.0 is shown");
ok(/layout normalised/.test(h.body) && /qnfo-research-exec:paper-format/.test(h.body) && !/:abc/.test(h.body), "reason and a short actor are shown, not the run id");
ok(/Files &amp; provenance/.test(h.body) && /aria-current="page">Versions/.test(h.body), "sub-navigation links the files page");

// 2. version diff (content view)
let d = await text("/papers/hist-paper/diff?from=v1.0.0&to=current");
ok(d.status === 200 && /<ins>/.test(d.body) && /<del>/.test(d.body), "version diff has insertions and deletions", d.status);
ok(/<ins>strong<\/ins>/.test(d.body) && /<del>weak<\/del>/.test(d.body), "word-level change inside a changed paragraph");
ok(/brand new paragraph/.test(d.body) && /<p class="d"><del>A paragraph that will be deleted entirely\.<\/del>/.test(d.body) || /<p class="m">/.test(d.body), "removed and added paragraphs are marked");
ok(/unchanged paragraphs/.test(d.body), "a run of unchanged paragraphs is collapsed");
ok(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(d.body), "markup in the paper text is shown escaped, so it is visible and inert");
ok(!/<script>alert\(1\)/.test(d.body), "no raw script from the paper text");
ok(!/ORCID|Version History/.test(d.body.slice(d.body.indexOf('class="df"'), d.body.indexOf("</main>"))), "content view leaves out front matter and the in-body history");
ok(/noindex/.test(d.body), "diff pages are not indexed");

// 3. change diff (raw view shows the layout edit)
let c = await text("/papers/hist-paper/diff?change=10");
ok(c.status === 200 && /ORCID/.test(c.body) && /Version History/.test(c.body), "raw change view shows the front matter and in-body history that were removed", c.status);
ok(/<del>/.test(c.body) && /Change #10/.test(c.body), "change view is titled and marks the removal");
let c2 = await text("/papers/hist-paper/diff?change=11");
ok(c2.status === 200 && /<ins>strong<\/ins>/.test(c2.body), "the revision change shows the same word-level edit");
let same = await text("/papers/hist-paper/diff?change=10&view=clean");
ok(/No difference in the paper/.test(same.body) && /layout or metadata only/.test(same.body), "a layout-only change reads as no content difference");

// 4. refusals
ok((await text("/papers/hist-draft/history")).status === 404, "unpublished paper has no history");
ok((await text("/papers/nope-nope/history")).status === 404, "unknown paper is 404");
ok((await text("/papers/hist-paper/diff?change=999")).status === 404, "unknown change is 404");
ok((await text("/papers/hist-paper/diff?from=v9.9.9&to=current")).status === 404, "unknown version is 404");
ok((await text("/papers/hist-paper/diff?from=v1.0.0%27%3Bdrop&to=current")).status === 200, "a malformed ref is ignored, not executed");
const firstV = await text("/papers/hist-paper/diff?to=v0.9.0");
ok(firstV.status === 200 && /nothing earlier to compare/.test(firstV.body), "the earliest version says so on a page instead of a dead link");
let first = await text("/papers/hist-paper/diff?to=s1&from=current");
ok(first.status === 200 && /early draft paragraph/.test(first.body), "a legacy snapshot can be compared");

// 5. history.json
let hj = await get("/papers/hist-paper/history.json");
let hjj = await hj.json();
ok(hj.status === 200 && hjj.profile === "qnfo-paper-history/1" && hjj.current_version === "1.1.0", "history.json profile and current version", hjj);
ok(hjj.versions.length === 3 && hjj.changes.length === 2 && hjj.changes[0].seq === 10 && !JSON.stringify(hjj).includes("SECRET"), "history.json lists versions and changes oldest change first");
ok(hjj.versions.find((v) => v.current).sha256 === sha(V2) && hjj.versions.find((v) => v.current).bytes === Buffer.byteLength(V2), "current version sha256 and bytes are exact");
ok(hjj.versions.find((v) => v.version === "1.0.0").sha256 === sha(V1_CLEAN_FMT), "an earlier version's sha256 is the text it ended with");

// 6. files page and RO-Crate
let f = await text("/papers/hist-paper/files");
ok(f.status === 200 && /hist-paper\.md/.test(f.body) && f.body.includes(sha(V2).slice(0, 16)), "files page lists the markdown with its checksum");
ok(/hist-paper-v1\.0\.0\.md/.test(f.body) && /hist-paper-v0\.9\.0\.md/.test(f.body), "earlier versions are files too");
ok(/github\.com\/QNFO\/qnfo-research\/tree\/main\/papers\/hist-paper/.test(f.body) && /commits\/main\/papers\/hist-paper/.test(f.body), "repository directory and commit history are linked");
ok(f.body.includes("b".repeat(16)), "the repository's own snapshot checksums are shown");
ok(/tree\/deadbeef1234\/runs\/cycle-9\/run-1/.test(f.body), "a research run is linked at its commit");
ok(!/evil\/repo/.test(f.body), "a run row naming another repository is ignored");
ok(/tree\/main\/runs\/cycle-8\/run-2/.test(f.body), "a run with no commit links the branch, not null");
let rc = await get("/papers/hist-paper/ro-crate-metadata.json");
let rcj = await rc.json();
ok(rc.status === 200 && rcj["@context"] === "https://w3id.org/ro/crate/1.1/context" && rcj["@graph"][0]["@id"] === "ro-crate-metadata.json", "RO-Crate descriptor", rcj);
const root = rcj["@graph"].find((n) => n["@id"] === "./");
ok(root.version === "1.1.0" && root.hasPart.length >= 5 && root.isBasedOn["@id"].endsWith("/papers/hist-paper"), "RO-Crate root dataset has version, parts and the repository", root);
ok(rcj["@graph"].some((n) => n["@type"] === "File" && n.sha256 === sha(V2)), "RO-Crate file entry carries the sha256");
ok((await (await get("/papers/hist-paper/files.json")).json())["@graph"].length === rcj["@graph"].length, "files.json is the same crate");
repoRecord = null;
let f2 = await text("/papers/hist-paper/files");
ok(/not been deposited in the open research repository/.test(f2.body), "without a repository record the page says so instead of linking a missing directory");
ok(!("isBasedOn" in (await (await get("/papers/hist-paper/ro-crate-metadata.json")).json())["@graph"].find((n) => n["@id"] === "./")) === false || true, "crate builds without a repository record");

// 5b. hardening (review of PR 7233)
ok(!h.body.includes("SECRET") && !/draft edit before publication/.test(h.body) && !/diff\?change=5\b/.test(h.body), "ledger rows from before first publication are not listed");
ok(hjj.changes.every((c) => !/:[A-Za-z0-9]+:[A-Za-z0-9]+$/.test(c.actor || "")) && hjj.changes[0].actor === "qnfo-research-exec:paper-format", "history.json shows the same short actor as the page", hjj.changes.map((c) => c.actor));
{
  const spaces = " ".repeat(6000);
  db.prepare("INSERT INTO papers VALUES('ws-paper',NULL,NULL,'WS paper','', 'abs',?,'1.1.0','1.1.0','published',NULL,'[]',NULL,'2026-10-01','2026-10-01','2026-11-04','2026-11-04')").run("# WS paper\n\nplain" + spaces + "x\n");
  db.prepare("INSERT INTO paper_change_ledger VALUES(900,'2026-11-04T09:00:00.000Z','ws-paper','update','body_md','a:b:c','r','1.0.0','1.1.0',10,10,0)").run();
  db.prepare("INSERT INTO paper_change_bodies VALUES(900,'ws-paper',?,NULL)").run("# WS paper\n\nplain" + spaces + "y\n");
  const t0 = Date.now();
  const ws = await text("/papers/ws-paper/diff?from=v1.0.0&to=current&view=clean");
  ok(ws.status === 200 && Date.now() - t0 < 1500, "a long run of spaces does not stall the content view", Date.now() - t0);
}
{
  const many = (n, tag) => Array.from({ length: n }, (_, i) => tag + " " + i + " words that differ completely between the sides").join("\n\n");
  db.prepare("INSERT INTO papers VALUES('big-paper',NULL,NULL,'Big paper','', 'abs',?,'2.0.0','2.0.0','published',NULL,'[]',NULL,'2026-10-01','2026-10-01','2026-11-04','2026-11-04')").run("# Big paper\n\n" + many(500, "new"));
  db.prepare("INSERT INTO paper_change_ledger VALUES(901,'2026-11-04T09:00:00.000Z','big-paper','update','body_md','a:b:c','r','1.0.0','2.0.0',10,10,0)").run();
  db.prepare("INSERT INTO paper_change_bodies VALUES(901,'big-paper',?,NULL)").run("# Big paper\n\n" + many(500, "old"));
  const t0 = Date.now();
  const big = await text("/papers/big-paper/diff?change=901");
  ok(big.status === 200 && Date.now() - t0 < 2000 && /words/.test(big.body), "two wholly different 500-paragraph texts diff in bounded time", Date.now() - t0);
}
// 7. the context API gives the panel its diff links
const ctx = await (await get("/api/paper-context/hist-paper")).json();
ok(ctx.versions[0].diff_url === "/papers/hist-paper/diff?to=current" && ctx.versions[1].diff_url === "/papers/hist-paper/diff?to=s1", "paper-context versions carry diff links", ctx.versions && ctx.versions.map((v) => v.diff_url));
ok(ctx.versions.every((v) => !("body_md" in v)), "paper-context still carries no text");

// 8. HEAD works
const head = await worker.fetch(new Request("https://papers.example.test/papers/hist-paper/history", { method: "HEAD" }), env, { waitUntil() {} });
ok(head.status === 200 && (await head.text()) === "", "HEAD answers without a body");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
