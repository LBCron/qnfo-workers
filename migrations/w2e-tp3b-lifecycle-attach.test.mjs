// TP-3B-ATTACH-1 offline suite (W2-E, 2026-11-05): replays migrations/2026-11-05-w2e-tp3b-lifecycle-attach.sql on node:sqlite and checks the repository agrees.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted, no trigger, no metric); row 128 keeps its evidence, stays partial and gains one note once; issue 1001943 stays open,
// gains one note ahead of its code-task block (that block stays last and byte-identical), a replay changes nothing and the Rollback line restores both rows byte for byte; and, in the repository,
// the attach-lifecycle-custom-domain workflow is gone while its script and ci-status record stay, nothing names it as a dependency and the manifest says delete 6, keep 2.
// Output MUST contain "0 failed" on success.   node migrations/w2e-tp3b-lifecycle-attach.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sql = readFileSync(join(here, "2026-11-05-w2e-tp3b-lifecycle-attach.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the body deletes and drops nothing (no BACKUP header needed)");
ok(!/CREATE\s+(TEMP\s+)?TRIGGER/i.test(body) && !/INSERT\s+(OR\s+\w+\s+)?INTO\s+metric_registry/i.test(body), "no trigger and no metric");
const likes = [...body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)].map((m) => m[1]);
ok(likes.every((p) => Buffer.byteLength(p) <= 50), "no LIKE pattern over 50 bytes (D1 rejects it)", likes);

const rollback = header.find((l) => /^-- Rollback:/.test(l)).replace(/^-- Rollback:\s*/, "");
const w = new DatabaseSync(":memory:");
w.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT);`);
const EVID = "measured 2026-10-06: 42 live | exit: worker_count <= 24, d1 <= 8, workflows <= 25 || C5-RESILIENCE-128 2026-11-05: partial, re-measured.";
const DESC = "QNFO.INFRA; charter pillar core; roadmap row RM-TP-3-FOOTPRINT-TEARDOWN (workflow count 71 against the exit of 25). Prediction: workflow files 71 to 68. Closing marker: the change carries the text TP-3B-ATTACH-1."
  + "\ncode-task: repo=qnfo-workers path=scripts/attach-ask-qwav-route.py\ncode-anchor: def attach_tech_redirect(zone):\ncode-probe: {\"paths\":[\"scripts/attach-ask-qwav-route.py\"],\"contains\":\"TP-3B-ATTACH-1\"}";
w.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (128, 'RM-TP-3-FOOTPRINT-TEARDOWN', 'docs/TRANSFORMATION-PROGRAM.md T3', 'partial', ?)").run(EVID);
w.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (129, 'RM-TP-4-COST-FLEET-40', 'x', 'partial', 'untouched')").run();
w.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1001943, 'ROADMAP-1: QNFO.INFRA TP-3B-ATTACH-1: three attach workflows', ?, 'open')").run(DESC);
w.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1001944, 'other', 'untouched', 'open')").run();
const one = (q, ...a) => w.prepare(q).get(...a);
const snap = () => JSON.stringify([w.prepare("SELECT * FROM roadmap_implementation").all(), w.prepare("SELECT * FROM agent_issues").all()]);
const before0 = snap();

w.exec(sql);
const r = one("SELECT status, evidence FROM roadmap_implementation WHERE id = 128");
ok(r.status === "partial" && r.evidence.startsWith(EVID + " || W2E-TP3B-ATTACH-1 2026-11-05:") && /72 to 71/.test(r.evidence) && /1001943/.test(r.evidence), "row 128 keeps its evidence, stays partial and gains the note", r.evidence.slice(0, 200));
ok(!/\b(done|complete|verified)\b/i.test(r.evidence.slice(EVID.length)), "the note does not claim completion");
ok(one("SELECT evidence FROM roadmap_implementation WHERE id = 129").evidence === "untouched", "no other roadmap row changes");
const i = one("SELECT status, description FROM agent_issues WHERE id = 1001943");
const tail = DESC.slice(DESC.indexOf("\ncode-task:"));
ok(i.status === "open" && i.description.endsWith(tail), "issue 1001943 stays open and its code-task block is still last and byte-identical");
ok(i.description.indexOf("W2E-TP3B-ATTACH-1") > 0 && i.description.indexOf("W2E-TP3B-ATTACH-1") < i.description.indexOf("\ncode-task:") && /attach-ask-qwav-route/.test(i.description) && /attach-surface-routes/.test(i.description), "the note sits ahead of the code-task block and names both remaining workflows");
ok(one("SELECT description FROM agent_issues WHERE id = 1001944").description === "untouched", "no other issue changes");

const after = snap();
w.exec(sql);
ok(after === snap(), "a replay changes nothing");
w.exec(rollback);
ok(snap() === before0, "the Rollback line restores both rows byte for byte");

// the repository agrees with the migration
const wf = join(root, ".github", "workflows");
ok(!existsSync(join(wf, "attach-lifecycle-custom-domain.yml")), "the workflow file is deleted");
ok(existsSync(join(root, "scripts", "attach-lifecycle-custom-domain.py")) && existsSync(join(root, "ci-status", "attach-lifecycle-custom-domain.json")), "its script and its ci-status record (the route ids) stay");
const st = JSON.parse(readFileSync(join(root, "ci-status", "attach-lifecycle-custom-domain.json"), "utf8"));
ok(st.route_http === 409 && /"code": 10020/.test(JSON.stringify(st.error).replace(/\\"/g, '"')) && /already exists \(used by Worker: qnfo-lifecycle\)/.test(st.error), "the recorded failure is Cloudflare 10020 route already exists for qnfo-lifecycle", { route_http: st.route_http });
const others = readdirSync(wf).filter((f) => f.endsWith(".yml")).map((f) => [f, readFileSync(join(wf, f), "utf8")]);
const refs = others.filter(([, t]) => /(workflow_run[\s\S]{0,200}|uses:\s*\.\/\.github\/workflows\/|gh workflow run\s+)attach-lifecycle-custom-domain/.test(t)).map(([f]) => f);
ok(refs.length === 0, "no workflow depends on attach-lifecycle-custom-domain", refs);
const man = readFileSync(join(root, "archive", "ATTACH-WORKFLOWS-MANIFEST.md"), "utf8");
const rows = man.split("\n").filter((l) => /^\| attach-/.test(l));
ok(rows.some((l) => l.startsWith("| attach-lifecycle-custom-domain ") && /\| delete \|$/.test(l)) && /delete 6, keep 2/.test(man), "the manifest says delete for it and counts delete 6, keep 2");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
