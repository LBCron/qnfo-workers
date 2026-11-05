// PRECHECK-1 (qnfo-research-exec 0.52.0, roadmap row 37 RM-VISION-AUTO-PEER-REVIEW-1, charter pillar: research) offline suite.
// Drives the real worker: GET /precheck, POST /api/precheck (Markdown body and JSON body), CORS preflight, size and shape refusals,
// the per-address rate limit, and the report itself on fixtures with known defects.
// Proves: a clean manuscript reports nothing to fix; each seeded defect (no References, dangling citation number, odd $, maths typed as plain text, chatbot
// residue, placeholder, repeated passage, misnumbered subsection, dangling section reference) is found with a quoted claim and a fix and is
// graded fix or look; the report always lists what was not checked; nothing is stored (the only write is the rate-limit counter); the page loads no
// outside script and writes results with textContent; a public host is served (this route has no internal-caller guard); the ledger statement counts per address.
// Run: node --no-warnings qnfo-research-exec/precheck.test.mjs   -> prints "N passed, 0 failed"
import worker, { precheckReport } from "./worker.js";

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d !== undefined ? " -- " + JSON.stringify(d) : "")); } };
const ctx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); }, passThroughOnException() {} };

const counters = new Map();
const writes = [];
const env = { QNFO_AUDIT: { prepare(sql) { const s = { bind(k) { s.k = k; return s; }, async first() { writes.push(sql.slice(0, 30)); const n = (counters.get(s.k) || 0) + 1; counters.set(s.k, n); return { n }; }, async run() { return { success: true }; }, async all() { return { results: [] }; } }; return s; } } };

const para = "This section describes the measurement protocol, the correctness check and the boundary of the system in plain words so that a reader can repeat the work. ";
const GOOD = "# A Clean Manuscript About Energy Per Answer\n\n## Abstract\nWe define a protocol for energy per correct answer and apply it to three machines, reporting the result with its uncertainty.\n\n## 1. Introduction\n" + para.repeat(8) + "Earlier work [1] and [2, 3] set the scene, and [4] gives the formula $E = k T \\ln 2$.\n\n### 1.1 Scope\n" + para.repeat(6) + "\n## 2. Method\n" + para.repeat(8) + "\n## 3. Results\n" + para.repeat(8) + "As Section 2 explains, the boundary matters.\n\n## 4. Conclusion\n" + para.repeat(4) + "\n## References\n[1] Landauer, R. Irreversibility and heat generation in the computing process. 1961.\n[2] Bennett, C. Logical reversibility of computation. 1973.\n[3] Margolus, N. and Levitin, L. The maximum speed of dynamical evolution. 1998.\n[4] Bremermann, H. Optimization through evolution and recombination. 1962.\n[5] Koomey, J. Implications of historical trends in the electrical efficiency of computing. 2011.\n";
const report = (t) => precheckReport(t);
const ids = (r) => r.findings.map((f) => f.id);

// 1. clean manuscript
{
  const r = report(GOOD);
  ok(r.ok === true && r.findings.filter((f) => f.severity === "fix").length === 0, "a clean manuscript has nothing to fix", r.findings);
  ok(r.not_checked.length === 4 && r.not_checked.every((x) => typeof x === "string") && /Passing them does not mean/.test(r.note), "the report names what it did not check");
  ok(r.stats.references === 5 && r.stats.citations === 3 && r.stats.words > 300, "stats are counted", r.stats);
  ok(r.checks.length >= 10 && r.checks.every((c) => ["pass", "look", "fix"].includes(c.result)), "every check reports a result");
}
// 2. seeded defects
{
  const noRefs = GOOD.split("## References")[0];
  let r = report(noRefs);
  ok(ids(r).includes("references") && r.ok === false, "no References section is a fix", ids(r));
  r = report(GOOD.replace("[4] gives", "[9] gives"));
  const f = r.findings.find((x) => x.id === "citations");
  ok(f && f.severity === "fix" && /\[9\]/.test(f.claim), "a citation number with no entry is a fix", r.findings);
  r = report(GOOD.replace("$E = k T \\ln 2$", "$E = k T \\ln 2"));
  ok(ids(r).includes("dollar"), "an odd number of $ is a fix", ids(r));
  r = report(GOOD.replace("Scope\n", "Scope\nThe state |ψ⟩ evolves as x_1^2 + y_2^3 = z_3^4 and A_ij B_kl C_mn. "));
  ok(r.findings.some((x) => x.id === "math" && x.severity === "fix"), "maths typed as plain text is a fix", r.findings.map((x) => x.id));
  r = report(GOOD.replace("# A Clean", "Sure, here is the paper you asked for.\n\n# A Clean"));
  ok(ids(r).includes("residue"), "assistant text is a fix", ids(r));
  r = report(GOOD.replace("Earlier work", "Earlier work [citation needed]"));
  ok(ids(r).includes("placeholder"), "a placeholder is a fix", ids(r));
  r = report(GOOD.replace("## 2. Method\n", "## 2. Method\n" + ("The same sentence repeats again and again without any change at all. ").repeat(60)));
  ok(ids(r).includes("repeats"), "a repeated passage is a fix", ids(r));
  r = report(GOOD.replace("### 1.1 Scope", "### 2.1 Scope"));
  ok(r.findings.some((x) => x.id === "numbering" && x.severity === "look"), "a subsection under the wrong number is worth a look", ids(r));
  r = report(GOOD.replace("As Section 2 explains", "As Section 9 explains"));
  ok(r.findings.some((x) => x.id === "sections"), "a reference to a missing section is worth a look", ids(r));
  r = report(GOOD.replace("# A Clean Manuscript About Energy Per Answer\n\n", ""));
  ok(r.findings.some((x) => x.id === "title" && x.severity === "look"), "a missing title is worth a look");
  r = report("# Tiny\n\nShort.");
  ok(ids(r).includes("length") && ids(r).includes("references"), "a stub reports length and references", ids(r));
  ok(r.findings.every((f) => f.claim && f.fix && (f.severity === "fix" || f.severity === "look")), "every finding has a claim, a fix and a grade");
}
// 3. the route
const base = "https://research-exec.qnfo.org";
const post = (body, headers, ip) => worker.fetch(new Request(base + "/api/precheck", { method: "POST", body, headers: Object.assign({ "CF-Connecting-IP": ip || "198.51.100.7" }, headers || {}) }), env, ctx);
{
  let r = await post(GOOD, { "content-type": "text/markdown" });
  let j = await r.json();
  ok(r.status === 200 && j.ok === true && r.headers.get("cache-control") === "no-store" && r.headers.get("access-control-allow-origin") === "*", "Markdown body is checked on a public host", [r.status, j.summary]);
  r = await post(JSON.stringify({ text: GOOD.split("## References")[0] }), { "content-type": "application/json" });
  j = await r.json();
  ok(r.status === 200 && j.ok === false && j.findings.some((f) => f.id === "references"), "JSON body is checked");
  r = await post("{not json", { "content-type": "application/json" });
  ok(r.status === 400, "invalid JSON is refused with 400");
  r = await post("   ", { "content-type": "text/markdown" });
  ok(r.status === 400, "an empty body is refused with 400");
  r = await post("x".repeat(60001), { "content-type": "text/markdown" });
  j = await r.json();
  ok(r.status === 413 && /60000/.test(j.error), "over the limit is refused with 413 and the limit is named");
  const pre = await worker.fetch(new Request(base + "/api/precheck", { method: "OPTIONS" }), env, ctx);
  ok(pre.status === 204 && /POST/.test(pre.headers.get("access-control-allow-methods")), "CORS preflight answers");
  const get = await worker.fetch(new Request(base + "/api/precheck"), env, ctx);
  ok(get.status === 405, "GET on the API is 405");
  ok(writes.every((w) => /INSERT INTO ask_rate/.test(w)), "the only write is the rate-limit counter", writes.slice(0, 3));
  counters.clear();
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await post(GOOD, { "content-type": "text/markdown" }, "203.0.113.50")).status;
  ok(last === 429, "the 31st check in an hour from one address is refused with 429", last);
  ok((await post(GOOD, { "content-type": "text/markdown" }, "203.0.113.51")).status === 200, "another address is not blocked");
  const dead = { QNFO_AUDIT: { prepare() { throw new Error("D1 unavailable"); } } };
  const open = await worker.fetch(new Request(base + "/api/precheck", { method: "POST", body: GOOD, headers: { "content-type": "text/markdown" } }), dead, ctx);
  ok(open.status === 200, "when the counter cannot be read the check still answers (fails open, no model spend)");
}
// 4. the page
{
  const r = await worker.fetch(new Request(base + "/precheck"), env, ctx), t = await r.text();
  ok(r.status === 200 && /data-page="precheck"/.test(t) && /Check a manuscript before you submit it/.test(t), "page and marker");
  ok(!/<script[^>]+src=/.test(t) && !/innerHTML|document\.write|eval\(/.test(t), "no outside script, results written with textContent");
  ok(/not stored/.test(t) && /prefers-color-scheme:dark/.test(t) && /:focus-visible/.test(t) && /name="viewport"/.test(t), "privacy line, dark mode, focus style, viewport");
  ok(!/pipeline|grounding|supplied summary|model wrote/i.test(t.replace(/<script[\s\S]*?<\/script>/g, "")), "reader text has no pipeline talk");
  const h = await (await worker.fetch(new Request(base + "/health"), env, ctx)).json();
  ok(h.capabilities.includes("pre-submission-check"), "health lists the capability");
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
