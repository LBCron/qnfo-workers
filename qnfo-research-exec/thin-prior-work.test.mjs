// THIN-PRIOR-WORK-1 (qnfo-research-exec 0.21.0, agent_issues 99949, pillar research). A published paper that fails the release
// gate as quality:thin gets a Prior Work section grounded in related gate-passing QNFO papers, re-read by a second model, and is
// queued as a drafted revision only when the revision passes the gate. Runs the functions from the source against scripted D1s.
// Run: node qnfo-research-exec/thin-prior-work.test.mjs
import { readFileSync } from "node:fs";
import { formatPaper } from "../_shared/paper-format.js";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x) : "")); } };
const grab = (name) => {
  let i = src.indexOf("\nasync function " + name + "(");
  if (i < 0) i = src.indexOf("\nfunction " + name + "(");
  if (i < 0) throw new Error("missing " + name);
  const j = src.indexOf("\n}\n", i); return src.slice(i, j + 2);
};
const vars = ["THIN_BATCH", "THIN_RELATED_MAX", "THIN_RELATED_MIN", "THIN_RELATED_BODY_MAX", "THIN_TARGET_FULL_MAX", "THIN_TARGET_HEAD", "THIN_RETRY_DAYS", "THIN_HEADING", "THIN_STOP"].map((c) => {
  const m = new RegExp("\\nvar " + c + " = ([^\\n]*;)").exec(src); if (!m) throw new Error("missing " + c); return "var " + c + " = " + m[1];
}).join("\n");
const fns = ["thinPaperUrl", "thinMatchQuery", "thinBump", "thinTargetText", "thinWorksBlock", "thinPrompt", "thinSectionCheck", "thinRereadPrompt", "standardizeBody", "insertPriorWork", "thinLog", "thinCandidates", "thinRelated", "thinPriorWork", "thinRun", "thinOff", "parseRereadVerdict", "parseJsonObject", "addChangelog", "applyVersionMarkers", "releaseGateVerdict"];
// DEGENERATE-TEXT-PRODUCER-1 (0.39.0): releaseGateVerdict reads the DEGENERATE-TEXT block, so the block is part of the function under test.
const degenBlock = src.slice(src.indexOf("// DEGENERATE-TEXT-BEGIN"), src.indexOf("// DEGENERATE-TEXT-END"));
const factory = new Function("aiText", "formatPaper", vars + "\nvar __name = function(){};\nvar MODEL = 'writer-model'; var REREAD_MODEL = 'reader-model';\n" + degenBlock + "\n" + fns.map(grab).join("\n") + "\nreturn { " + fns.join(", ") + " };");
const mod = (aiText) => factory(aiText, formatPaper);
console.error = () => {};

// The filler is varied text: a sentence repeated back to back is a model loop the release gate now fails as quality:repetition.
const lexw = (i) => { let s = "", k = i + 1; while (k > 0) { s += "abcdefghijklmnopqrstuvwxyz"[k % 26]; k = Math.floor(k / 26); } return "w" + s; };
const long = (n) => { let out = ""; for (let i = 0; out.length < n; i++) out += "Lorem ipsum " + lexw(i) + " sit amet, a process ontology of distinction. "; return out.slice(0, n); };
const target = { slug: "spectral-schism", title: "The Spectral Schism in Holographic Physics", version: "1.0.0", body_md: "# The Spectral Schism\n\n" + long(9000) + "\n\n## References\n\nnone\n" };
const rel = [
  { slug: "holographic-a", title: "Holographic Readout A", body_md: long(20000) },
  { slug: "spectral-b", title: "Spectral Gap B", body_md: long(20000) },
  { slug: "schism-c", title: "Schism C", body_md: long(20000) }
];
const goodSection = "The present work continues [Holographic Readout A](https://papers.qnfo.org/papers/holographic-a), which treats readout as a process of distinction. " + long(600) + "\n\nIt departs from [Spectral Gap B](https://papers.qnfo.org/papers/spectral-b) in its account of the gap. " + long(500);

function makeEnv(opts) {
  const writes = { log: [], vq: [] };
  const env = {
    PAPERS_DB: { prepare: (sql) => ({ bind: (...a) => ({ all: async () => {
      if (/papers_fts/.test(sql)) { writes.match = a[0]; return { results: (opts.related || rel).filter((r) => r.slug !== a[1]).slice(0, a[3]) }; }
      return { results: [] };
    } }), all: async () => ({ results: opts.papers || [target] }) }) },
    WATCH_DB: { prepare: (sql) => ({
      first: async () => (/ops_config/.test(sql) ? (opts.off ? { value: "off" } : null) : null),
      all: async () => ({ results: /version_queue/.test(sql) ? (opts.pending || []) : [] }),
      bind: (...a) => ({
        all: async () => ({ results: /paper_revision_log/.test(sql) ? (opts.recent || []) : [] }),
        run: async () => { if (/INSERT INTO version_queue/.test(sql)) writes.vq.push(a); if (/INSERT INTO paper_revision_log/.test(sql)) writes.log.push(a); return { meta: { changes: 1 } }; }
      })
    }) }
  };
  return { env, writes };
}
const scripted = (writer, reader) => { const calls = []; return { calls, fn: async (env, prompt, model) => { calls.push({ model, prompt }); return model === "writer-model" ? writer : reader; } }; };

// 1. Pure helpers
{
  const m = mod(async () => "");
  const q = m.thinMatchQuery("The Spectral Schism in Holographic Physics: 2026 notes");
  ok(q === '"spectral" OR "schism" OR "holographic" OR "physics"', "match query keeps content words, drops stop words, years and short words", q);
  ok(m.thinBump("1.0.0") === "1.1.0" && m.thinBump("2.0.0") === "2.1.0" && m.thinBump("v0.1-draft") === "0.2.0" && m.thinBump("") === "1.1.0", "version bump raises the minor number, so a 2.x paper moves forward");
  const ins = m.insertPriorWork(target.body_md, "Body.");
  ok(ins.indexOf("## Prior Work and Related Literature\n\nBody.") >= 0 && ins.indexOf("## Prior Work") < ins.indexOf("## References"), "section lands before References");
  ok(m.releaseGateVerdict(target.body_md).pass === 0 && m.releaseGateVerdict(ins).pass === 1, "the thin fixture fails the gate and passes once the section is in");
  const big = { title: "t", body_md: "x".repeat(150000) };
  ok(m.thinPrompt(big, rel).indexOf("opening sections") >= 0 && m.thinPrompt(target, rel).indexOf("opening sections") < 0, "only a paper over the full-text limit is described through its opening sections");
  ok(m.thinPrompt(target, rel).indexOf(rel[2].body_md) >= 0, "each related work is given in full");
}
// 2. Section check
{
  const m = mod(async () => "");
  ok(m.thinSectionCheck(goodSection, rel).ok === true, "a section citing two listed works passes the check");
  ok(m.thinSectionCheck("## Prior Work and Related Literature\n\n" + goodSection, rel).ok === true, "a leading prior-work heading is stripped");
  ok(/outside/.test(m.thinSectionCheck(goodSection + " See https://example.com/x.", rel).reason), "a link outside the related works is refused");
  ok(/needs 2/.test(m.thinSectionCheck("Only [Holographic Readout A](https://papers.qnfo.org/papers/holographic-a). " + long(1000), rel).reason), "a section citing one work is refused");
  ok(/arrived/.test(m.thinSectionCheck(goodSection + " The excerpt supplied says little.", rel).reason), "a section that talks about how its sources arrived is refused");
  ok(/heading/.test(m.thinSectionCheck(goodSection + "\n\n### Aside\n\ntext", rel).reason), "a nested heading is refused");
  ok(/too-short/.test(m.thinSectionCheck("short", rel).reason), "a short reply is refused");
}
// 3. End to end: queued
{
  const ai = scripted(goodSection, '{"verdict":"pass","hard":[]}');
  const m = mod(ai.fn);
  const { env, writes } = makeEnv({});
  const r = await m.thinRun(env);
  ok(r.results.length === 1 && r.results[0].queued === true, "a thin paper with related works is queued", r);
  ok(writes.vq.length === 1 && writes.vq[0][4] === "1.1.0" && /## Prior Work and Related Literature/.test(writes.vq[0][5]), "version_queue gets a drafted 1.1.0 revision with the section", writes.vq.map((v) => v[4]));
  // REVISED-STANDARD-1 (owner directive 2026-10-28): a revised body is typeset like a new paper, so the changelog lives in paper_revision_log, not in the body.
  ok(!/^#{1,6}[ 	]+Changelog/m.test(writes.vq[0][5]), "the revision body carries no changelog section (the log keeps it)");
  ok(writes.log.length === 1 && writes.log[0][5] === "thin-prior-work-queued", "the outcome is logged as thin-prior-work-queued");
  ok(ai.calls.length === 2 && ai.calls[0].model === "writer-model" && ai.calls[1].model === "reader-model" && ai.calls[1].prompt.indexOf(goodSection) >= 0, "writer then a second model re-reads the section");
  ok(/"spectral"/.test(writes.match), "related works are found by the title's words");
}
// 4. Fail closed
{
  const ai = scripted(goodSection, '{"verdict":"fail","hard":[{"change":1,"reason":"B does not say that"}]}');
  const m = mod(ai.fn); const { env, writes } = makeEnv({});
  const r = await m.thinRun(env);
  ok(r.results[0].rejected === "reread-fail" && writes.vq.length === 0 && writes.log[0][5] === "thin-prior-work-rejected", "a HARD re-read finding keeps it out of version_queue");
}
{
  const m = mod(scripted(goodSection, "I think it is fine").fn); const { env, writes } = makeEnv({});
  const r = await m.thinRun(env);
  ok(r.results[0].rejected === "reread-unjudged" && writes.vq.length === 0, "no readable verdict fails closed");
}
{
  const m = mod(scripted(goodSection, '{"verdict":"pass","hard":[]}').fn); const { env, writes } = makeEnv({ related: rel.slice(0, 1) });
  const r = await m.thinRun(env);
  ok(r.results[0].skipped === "no-related" && writes.vq.length === 0 && writes.log[0][5] === "thin-prior-work-skipped", "fewer than two related works: skipped and logged");
}
{
  const withLit = Object.assign({}, target, { body_md: "# T\n\n## Related Work\n\n" + long(9000) });
  const ai = scripted(goodSection, '{"verdict":"pass","hard":[]}');
  const m = mod(ai.fn); const { env, writes } = makeEnv({ papers: [withLit] });
  const r = await m.thinRun(env);
  ok(r.results[0].skipped === "has-prior-work" && ai.calls.length === 0 && writes.vq.length === 0, "a paper that already has the section is skipped without a model call");
}
{
  const m = mod(scripted(goodSection, '{"verdict":"pass","hard":[]}').fn);
  const a = makeEnv({ recent: [{ slug: target.slug }] }); const b = makeEnv({ pending: [{ slug: target.slug }] }); const c = makeEnv({ off: true });
  ok((await m.thinRun(a.env)).candidates === 0, "a paper with a recent thin-prior-work row is not retried");
  ok((await m.thinRun(b.env)).candidates === 0, "a paper with a pending revision is not taken");
  ok((await m.thinRun(c.env)).off === true && c.writes.vq.length === 0, "ops_config thin_prior_work = off stops the step");
}
// 4b. GATE-NON-REGRESSION-1: publishV2's QUALITY-GATE-1 does not hold a revision for a marker the live version also lacks.
{
  const g = new Function(grab("qualityGate") + grab("gateNonRegression") + "\nreturn { qualityGate, gateNonRegression };")();
  const thinLive = target.body_md;
  const revised = mod(async () => "").insertPriorWork(thinLive, goodSection);
  const gate = g.qualityGate({ corrected_md: revised }, 8000, 5);
  ok(!gate.ok && gate.reason === "quality gate: no_verification_marker", "the thin revision alone is held only for the missing marker", gate);
  const nr = g.gateNonRegression(gate, g.qualityGate({ corrected_md: thinLive }, 0, 0));
  ok(nr.ok === true && /live version/.test(nr.waived), "the marker is waived when the live version lacks one too", nr);
  const withTable = thinLive + "\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
  ok(g.gateNonRegression(gate, g.qualityGate({ corrected_md: withTable }, 0, 0)).ok === false, "a revision that drops the live version's table is still held");
  const shortGate = g.qualityGate({ corrected_md: "# T\n\nshort" }, 8000, 5);
  const nr2 = g.gateNonRegression(shortGate, g.qualityGate({ corrected_md: "# T\n\nshort" }, 0, 0));
  ok(nr2.ok === false && /body_len/.test(nr2.reason) && !/no_verification_marker/.test(nr2.reason), "other reasons still hold the revision", nr2);
  ok(/GATE-NON-REGRESSION-1[\s\S]{0,900}gateNonRegression\(gate, qualityGate\(\{ corrected_md: liveV\.body_md \}, 0, 0\)\)/.test(src), "publishV2 applies it against the live body");
}
// 5. Wiring
ok(/thinDue\(Number\(event && event.scheduledTime\) \|\| Date.now\(\)\) \? reviserMod\.thin\(reviserEnv\(rawEnv\)\)/.test(src) && /if \(thinRunP\) await thinRunP;/.test(src), "the host cron runs and awaits the step on the :30 tick");
ok(/url\.pathname === "\/run\/thin"/.test(src), "the member exposes /run/thin behind its member auth");
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
