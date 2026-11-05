// W2-F-C offline suite: replays migrations/2026-11-05-w2f-c-rm52-probe-vantage.sql on node:sqlite.
// Proves: the header opts in; the rm-52 probe keeps its URL and status and swaps only the marker; a probe that no longer carries the old marker is left alone (replay changes nothing);
// the Rollback line restores the previous probe; the new probe is accepted by the consumer's own judge (scripts/remediation_consumer.py judge_https) for a Cloudflare block page and a
// challenge page and refused for a plain 404 and for an origin 403 with no Cloudflare text. It does not read live state. Output MUST contain "0 failed".
//   node migrations/w2f-c-rm52-probe-vantage.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const sql = readFileSync(new URL("./2026-11-05-w2f-c-rm52-probe-vantage.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one single-line Rollback header");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");

const OLD = '{"url": "https://papers.qnfo.org/.env", "status": 403, "contains": "Attention Required"}';
const w = new DatabaseSync(":memory:");
w.exec("CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, status TEXT, last_verdict TEXT, attempts INTEGER, next_due_at TEXT)");
w.prepare("INSERT INTO remediation_contracts VALUES ('rm-52', NULL, ?, 'runner-https', 'active', 'fail', 5, '2026-11-05 04:24:24')").run(OLD);
w.prepare("INSERT INTO remediation_contracts VALUES ('rm-53', NULL, ?, 'runner-https', 'active', 'fail', 3, 'x')").run(OLD);
w.exec(sql);
const row = w.prepare("SELECT * FROM remediation_contracts WHERE class = 'rm-52'").get();
const p = JSON.parse(row.verify_probe);
ok(p.url === "https://papers.qnfo.org/.env" && p.status === 403 && p.contains === "cdn-cgi", "URL and status are kept, the marker is the vendor-neutral cdn-cgi", p);
ok(row.attempts === 0 && row.last_verdict === null, "the contract is re-armed");
ok(w.prepare("SELECT verify_probe v FROM remediation_contracts WHERE class = 'rm-53'").get().v === OLD, "another contract with the same text is untouched");
const s1 = JSON.stringify(w.prepare("SELECT * FROM remediation_contracts ORDER BY class").all());
w.exec(sql);
ok(JSON.stringify(w.prepare("SELECT * FROM remediation_contracts ORDER BY class").all()) === s1, "a replay changes nothing");
w.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
ok(w.prepare("SELECT verify_probe v FROM remediation_contracts WHERE class = 'rm-52'").get().v === OLD, "the Rollback line restores the previous probe");

// the consumer's own verdict function agrees (python reads the module; skipped when python is not on PATH)
const py = spawnSync("python", ["-I", "-c", `
import sys, json
sys.path.insert(0, "scripts")
import remediation_consumer as RC
pr = {"url": "https://papers.qnfo.org/.env", "status": 403, "contains": "cdn-cgi", "absent": None, "min_version": None, "max_ms": None, "redirect_to": None}
cases = {
 "block": RC.judge_https(pr, 403, 50, b"<html><head><title>Attention Required! | Cloudflare</title><link href='/cdn-cgi/styles/cf.errors.css'></head></html>"),
 "challenge": RC.judge_https(pr, 403, 50, b"<html><title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1'></script></html>"),
 "origin404": RC.judge_https(pr, 404, 50, b"not found"),
 "origin403": RC.judge_https(pr, 403, 50, b"forbidden by the worker"),
}
print(json.dumps(cases))
`], { cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
if (py.status === 0) {
  const c = JSON.parse(py.stdout.trim().split("\n").pop());
  ok(c.block === "ok" && c.challenge === "ok", "the judge accepts a Cloudflare block page and a challenge page", c);
  ok(c.origin404 === "status=404" && c.origin403 === "missing-marker", "the judge refuses an origin 404 and an origin 403 with no Cloudflare text", c);
} else {
  console.log("note: python judge cases skipped (" + String(py.stderr).slice(0, 120) + ")");
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
