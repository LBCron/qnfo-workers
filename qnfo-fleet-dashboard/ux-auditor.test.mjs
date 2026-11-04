// UX-AUDITOR-1 offline suite: uxAnalyzeHtml scores layout, accessibility, typography and speed deterministically.
// Run: node qnfo-fleet-dashboard/ux-auditor.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "worker.js"), "utf8");
const i = src.indexOf("function uxAnalyzeHtml("), j = src.indexOf("async function uxAudit(");
const analyze = new Function(src.slice(i, j) + "; return uxAnalyzeHtml;")();
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.error("FAIL", m, d === undefined ? "" : JSON.stringify(d)); } };
const good = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>x</title></head><body><h1>Hi</h1><img src=a alt="a"><a href=/>home</a></body></html>';
ok(analyze(good, 300, 200).score === 100, "clean page scores 100", analyze(good, 300, 200));
const bad = '<html><head></head><body><img src=a><input type=text><a href=/></a><button></button><p style="font-size:10px">t</p></body></html>';
const r = analyze(bad, 4000, 200);
const keys = r.findings.map((x) => x.k);
for (const k of ["no-viewport", "no-lang", "no-title", "no-h1", "img-no-alt", "form-no-label", "empty-link", "empty-button", "tiny-text", "slow"]) ok(keys.includes(k), "flags " + k, keys);
ok(r.score < 40, "bad page scores low", r.score);
ok(analyze("", 100, 0).findings[0].k === "unreachable", "unreachable first");
ok(/ctx\.waitUntil\(uxAudit\(env\)\)/.test(src) && /var VERSION = "1\.(8[4-9]|9\d)\./.test(src), "wired and versioned");
console.log(pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
