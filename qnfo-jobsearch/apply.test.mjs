// JOBSEARCH-APPLY-1 suite: apply links per ATS, keyword report, resume exports (docx/html/txt), the kit route, and that both pages' scripts parse.
// Run: node qnfo-jobsearch/apply.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const T = worker.__test;
const db = new DatabaseSync(":memory:");
db.exec(readFileSync(join(here, "../migrations/2026-10-27-jobsearch.sql"), "utf8"));
const stmt = (sql, args = []) => ({
  bind: (...values) => stmt(sql, values),
  run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
});
const env = { JOBS_DB: { prepare: (sql) => stmt(sql), batch: async (a) => { for (const x of a) await x.run(); return []; } }, LOOP_TOKEN: "test-token" };
const ctx = { waitUntil: () => {} };
const req = (path, init = {}) => worker.fetch(new Request("https://x" + path, init), env, ctx);
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };

// 1. apply links per ATS
const a = T.atsOf;
ok(a("https://boards.greenhouse.io/acme/jobs/12345?gh_src=x").apply_url === "https://boards.greenhouse.io/acme/jobs/12345#app", "greenhouse");
ok(a("https://job-boards.greenhouse.io/acme/jobs/12345").ats === "greenhouse", "greenhouse new host");
ok(a("https://jobs.lever.co/acme/0a1b2c3d-1111-2222-3333-444455556666").apply_url.endsWith("/apply"), "lever apply");
ok(a("https://jobs.lever.co/acme/0a1b2c3d-1111-2222-3333-444455556666/apply").apply_url.endsWith("556666/apply"), "lever apply not doubled");
ok(a("https://jobs.ashbyhq.com/acme/0a1b2c3d-1111-2222-3333-444455556666").apply_url.endsWith("/application"), "ashby");
ok(a("https://apply.workable.com/acme/j/ABC123DEF/").apply_url === "https://apply.workable.com/acme/j/ABC123DEF/apply/", "workable");
ok(a("https://acme.recruitee.com/o/data-lead").apply_url.endsWith("/c/new"), "recruitee");
ok(a("https://acme.wd3.myworkdayjobs.com/en/x/job/1").fill === false, "workday opens, no autofill");
ok(a("https://example.org/careers/1").ats === "other", "other");

// 2. keyword report: echoes what the CV backs, names what it lacks, never invents
const job = { id: "t:1", company: "Acme", title: "Senior Policy Advisor", location: "Amsterdam", url: "https://boards.greenhouse.io/acme/jobs/1",
  desc: "You will lead public policy research and transport forecasting for government agencies. Tableau and Kubernetes are required. GIS experience and statistics help. Tableau dashboards daily." };
const sc = T.scoreJob(job, await T.loadCtx(env), "analyze");
const res = T.buildResume(job, { clusters: sc.clusters });
ok(T.verify(res, job).length === 0, "keyword-ordered resume still verifies: " + T.verify(res, job).join("; "));
const kw = T.keywordReport(job, res);
ok(kw.missing.includes("tableau") && kw.missing.includes("kubernetes"), "unclaimed tools are gaps: " + JSON.stringify(kw));
ok(!res.toLowerCase().includes("tableau") && !res.toLowerCase().includes("kubernetes"), "gaps never reach the resume");
ok(kw.total > 0 && kw.coverage >= 0 && kw.coverage <= 100, "coverage is a percentage");

// 3. exports
const md = "# Rowan Q <!--P-->\nAmsterdam | a@b.c <!--P-->\n\n## Experience <!--S-->\n**Lead**, Org | 2020 to 2024 <!--R:x-->\n- Did **a thing** & more <!--F:x-->\n";
const txt = T.plainOf(md);
ok(!txt.includes("<!--") && !txt.includes("**") && !txt.includes("# "), "plain text is clean: " + txt);
const html = T.resumeHtml(md, "t");
ok(html.includes("<h1>Rowan Q</h1>") && html.includes("<li>Did <b>a thing</b> &amp; more</li>") && !html.includes("<!--F"), "html: " + html.slice(300, 700));
const docx = T.docxOf(md);
ok(docx[0] === 0x50 && docx[1] === 0x4b, "docx is a zip");
const dir = mkdtempSync(join(tmpdir(), "docx-"));
const f = join(dir, "r.docx");
writeFileSync(f, docx);
const py = spawnSync("python", ["-I", "-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(sorted(z.namelist()));d=z.read('word/document.xml').decode();assert 'a thing' in d and 'ROWAN' not in d;import xml.dom.minidom as m;m.parseString(d)", f], { encoding: "utf8" });
if (py.error) console.log("python not available; zip integrity check skipped");
else ok(py.status === 0, "docx opens as a valid zip with well-formed XML: " + py.stderr + py.stdout);

// 4. routes: exports are readable, the kit needs sign-in
const resumeMd = T.stripTags ? null : null;
const resFull = T.buildResume(job, { clusters: sc.clusters }), noteFull = T.buildNote(job, { clusters: sc.clusters });
const strip = (s) => s.replace(/ <!--.*?-->$/gm, "");
db.prepare("INSERT INTO jobsearch_matches (id, first_seen, last_seen, company, title, location, url, tier, score, why_json, flags_json, verified, resume_md, note_md, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .run("gh:acme:1", new Date().toISOString(), new Date().toISOString(), "Acme", job.title, "Amsterdam", job.url, "A", 80, "[]", "[]", 1, strip(resFull), strip(noteFull), "pending_owner_approval");
const dx = await req("/api/matches/" + encodeURIComponent("gh:acme:1") + "/resume.docx");
ok(dx.status === 200 && dx.headers.get("content-type").includes("wordprocessingml") && /\.docx"/.test(dx.headers.get("content-disposition")), "docx route");
ok(new Uint8Array(await dx.arrayBuffer())[0] === 0x50, "docx route body is a zip");
const ht = await req("/api/matches/" + encodeURIComponent("gh:acme:1") + "/resume.html");
ok(ht.status === 200 && (await ht.text()).includes("<h1>"), "html route");
const nt = await req("/api/matches/" + encodeURIComponent("gh:acme:1") + "/note.txt");
ok(nt.status === 200 && !(await nt.text()).includes("<!--"), "note route");
ok((await req("/api/matches/nope/resume.docx")).status === 404, "unknown match is 404");
ok((await req("/api/matches/" + encodeURIComponent("gh:acme:1") + "/kit")).status === 401, "kit needs sign-in");
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response("down", { status: 503 });
try {
  const kr = await req("/api/matches/" + encodeURIComponent("gh:acme:1") + "/kit", { headers: { "x-loop-token": "test-token" } });
  const kit = await kr.json();
  ok(kr.status === 200 && kit.ats === "greenhouse" && kit.apply_url.endsWith("#app") && kit.can_fill === true, "kit: " + JSON.stringify(kit).slice(0, 200));
  ok(kit.fields.first_name === "Rowan" && kit.fields.last_name.startsWith("Quni") && kit.fields.email.includes("@"), "kit fields come from the CV");
  ok(kit.resume_docx_b64.startsWith("UEsD") && kit.resume_file.endsWith("_Resume_Acme.docx"), "kit carries the docx: " + kit.resume_file);
  ok(kit.fresh === false && kit.keywords === null, "unreadable posting falls back to the stored draft");
  ok(kit.left_for_you.some((x) => /work authorization/.test(x)), "owner-only questions are listed, not filled");
} finally { globalThis.fetch = realFetch; }

// 5. both pages' scripts parse (a syntax slip in the template literal breaks the whole page)
for (const path of ["/", "/cv"]) {
  const body = await (await req(path)).text();
  const scripts = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  ok(scripts.length > 0, path + " has a script");
  for (const s of scripts) new vm.Script(s);
  ok(body.includes("function FILL()") || body.includes("async function FILL()"), path + " carries the fill bookmark");
}
const home = await (await req("/")).text();
ok(home.includes("Ready to apply") && home.includes("One-click apply: set up once"), "home page shows the apply controls");
// the bookmarklet itself parses and is a single line
const bm = home.match(/async function FILL\(\)\{[\s\S]*?\n\}\nfunction bookmarkHref/);
ok(bm, "FILL source found");
new vm.Script("(" + bm[0].replace(/\nfunction bookmarkHref$/, "").split("\n").join(" ") + ")");

// 6. follow-ups: applied 8 days ago with no reply is listed with a note that states only role, employer and date
db.prepare("UPDATE jobsearch_matches SET status='applied' WHERE id='gh:acme:1'").run();
db.prepare("INSERT INTO jobsearch_events (match_id, event, ts, note) VALUES ('gh:acme:1','applied',?, 'owner')").run(new Date(Date.now() - 8 * 86400000).toISOString());
const fu = await (await req("/api/followups")).json();
ok(fu.count === 1 && fu.items[0].days_waiting >= 8 && fu.items[0].note.includes("Senior Policy Advisor role at Acme"), "follow-up listed: " + JSON.stringify(fu).slice(0, 200));
db.prepare("INSERT INTO jobsearch_events (match_id, event, ts, note) VALUES ('gh:acme:1','replied',?, 'owner')").run(new Date().toISOString());
db.prepare("UPDATE jobsearch_matches SET status='replied' WHERE id='gh:acme:1'").run();
ok((await (await req("/api/followups")).json()).count === 0, "a reply removes it");
console.log(`qnfo-jobsearch apply: ${pass} passed, 0 failed`);
