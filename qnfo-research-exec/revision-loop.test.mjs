// REVISION-LOOP-1 (0.26.0) suite: published pipeline papers go back through the pipeline on a rate and come out as the next
// version with a Version History; hand-written papers are never queued; a version that failed RL_MAX_TRIES times waits.
// Offline, scripted D1s. Run: node qnfo-research-exec/revision-loop.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as W from "./worker.js";
import { noticeRepairTick, rlStripNotices, ciStripPipeline, rlRegression, rlNextVersion, rlChangeSummary, rlWithHistory, rlIsRevision, rlEligible, rlErrataBlock, rlSourceId, revisionLoopTick } from "./worker.js";

// Versions move forward from the live one; a rewrite is never a fixed 2.0.0.
assert.equal(rlNextVersion("1.0.0", true), "1.1.0");
assert.equal(rlNextVersion("1.0.1", true), "1.1.0");
assert.equal(rlNextVersion("2.0.0", true), "2.1.0");
assert.equal(rlNextVersion("v0.3", true), "0.4.0");
assert.equal(rlNextVersion("", true), "1.1.0");
assert.equal(rlNextVersion("1.0.0", false), "2.0.0");
assert.equal(rlNextVersion("2.0.1", false), "3.0.0");

assert.ok(rlIsRevision({ source: "remediation", source_id: rlSourceId("a-paper", "1.0.1", 1) }));
assert.ok(!rlIsRevision({ source: "remediation", source_id: "completeness:abc" }));
assert.ok(!rlIsRevision({ source: "proposal", source_id: "revision:x@1#1" }));

// Only the pipeline's own papers, by identifier or queue row; the owner's byline on a pipeline paper does not exclude it.
assert.ok(rlEligible({ slug: "s", identifier: "qnf-2026-001", authors: "[\"QNFO Research\"]" }, {}));
assert.ok(rlEligible({ slug: "s", identifier: "x", authors: "" }, { s: 1 }));
assert.ok(rlEligible({ slug: "s", identifier: "qnf-2026-001", authors: "[\"Rowan Brad Quni-Gudzinas\"]" }, {}));
assert.ok(!rlEligible({ slug: "s", identifier: "adelic-quantum-statistics", authors: "[\"Rowan Brad Quni-Gudzinas\"]" }, {}));
assert.ok(!rlEligible({ slug: "chapter-1", identifier: "qnfo-2025-00-chapter-1", authors: "[\"QNFO Research\"]" }, {}), "imported owner writing is not a pipeline paper");
assert.ok(/source = 'remediation' AND source_id LIKE 'revision:%' THEN 'revision'/.test(readFileSync(new URL("./worker.js", import.meta.url), "utf8")) && /q\.claim_class <> 'revision' OR u\.active < 14/.test(readFileSync(new URL("./worker.js", import.meta.url), "utf8")), "queued revisions have their own class, capped below 60% of the 24-row window");
assert.equal(rlErrataBlock([]), "");
assert.match(rlErrataBlock([{ claim_text: "U = p(1-p) is concave", detected_by: "qnfo-lifecycle PAPER-LEARN-1" }]), /Reported errors[\s\S]*1\. U = p\(1-p\) is concave \(confirmed by a second model\)/);
assert.ok(!rlEligible({ slug: "s", identifier: "10.5281/x.1", authors: "" }, {}));

const oldMd = "# T\n\n## Abstract\n\nA.\n\n## 1. Introduction\n\nx y z\n\n## References\n\n[1] One.\n[2] Two.\n";
const newMd = "# T\n\n## Abstract\n\nA.\n\n## 1. Introduction\n\nx y z w\n\n## 2. Prior Work\n\np\n\n## References\n\n[1] One.\n[2] Two.\n[3] Three.\n\n## Provenance and AI Involvement\n\n- p\n";
const sum = rlChangeSummary(oldMd, newMd);
assert.match(sum, /new sections: Prior Work/);
assert.match(sum, /references 2 -> 3/);

const h = rlWithHistory(newMd, "1.1.0", "2026-10-19", ["Version 1.0.1 (2026-10-19, from 1.0.0): corrected statements", "Version 1.1.0 (2026-10-19, from 1.0.1): " + sum]);
assert.ok(!/> \*\*Revised/.test(h), "no banner under the title (PROPORTIONATE-NOTICE-1)");
assert.ok(!/## Version History|Version 1\.0\.1/.test(h), "PAPER-CANONICAL-1: the body carries no history section; the log and the ledger keep it");
assert.equal(h, newMd, "a clean body passes through unchanged");
// An old body that still carries a section or a banner has both removed, and a second pass stays clean.
const dirty = newMd.replace("## References", "> **Revised (version 1.0.1, 2026-10-19):** x\n\n## Version History\n\n- Version 1.0.1 (2026-10-19, from 1.0.0): old\n\n## References");
const h2 = rlWithHistory(dirty, "1.2.0", "2026-10-20", ["Version 1.2.0 (2026-10-20, from 1.1.0): again"]);
assert.ok(!/Version History|Revised \(version|Version 1\.2\.0/.test(h2));
assert.equal(rlWithHistory(h2, "1.2.0", "2026-10-20", []), h2);

// The tick: scripted qnfo-audit and living-paper.
function makeEnv(o) {
  const w = { queued: [], log: [], metrics: [] };
  const audit = { prepare: (sql) => {
    const res = (a) => {
      if (/FROM ops_config/.test(sql)) return o.cfg || [];
      if (/FROM research_queue WHERE source = 'remediation' AND status IN/.test(sql)) return o.open || [];
      if (/FROM version_queue/.test(sql)) return o.vq || [];
      if (/source_id LIKE 'revision:%'/.test(sql)) return o.tries || [];
      if (/SELECT DISTINCT paper_slug/.test(sql)) return o.pipeline || [];
      if (/FROM internal_errata/.test(sql)) return o.errata || [];
      return [];
    };
    const stmt = (a) => ({
      all: async () => ({ results: res(a) }),
      first: async () => (/SELECT idea, summary/.test(sql) ? { idea: "Original idea about " + a[0] } : /COUNT\(\*\) AS n/.test(sql) ? { n: 2 } : null),
      run: async () => {
        if (/INSERT OR IGNORE INTO research_queue/.test(sql)) w.queued.push(a);
        if (/INSERT INTO paper_revision_log/.test(sql)) w.log.push(a);
        if (/UPDATE metric_registry/.test(sql)) w.metrics.push(sql.match(/metric = '([^']+)'/)[1] + "=" + a[0]);
        return { meta: { changes: 1 } };
      }
    });
    return Object.assign(stmt([]), { bind: (...a) => stmt(a) });
  } };
  w.bodyReads = [];
  const papers = { prepare: (sql) => ({ bind: (...a) => ({ all: async () => {
    if (/slug IN/.test(sql)) { w.errataArgs = a; return { results: (o.errataPapers || []).filter((p) => a.indexOf(p.slug) > 0) }; }
    w.ageArg = a[0]; return { results: o.papers || [] };
  }, first: async () => {
    // REVISION-BRIEF-REFS-1: the live paper's body, read for the picked paper only.
    if (!/SELECT body_md FROM papers WHERE slug = \?1/.test(sql)) return null;
    w.bodyReads.push(a[0]);
    if (o.bodyFail) throw new Error("D1 unavailable");
    return o.bodies && a[0] in o.bodies ? { body_md: o.bodies[a[0]] } : null;
  } }) }) };
  return { env: { QNFO_AUDIT: audit, LIVING_PAPER: papers }, w };
}
const P = (slug, extra) => Object.assign({ slug, title: "Title " + slug, abstract: "abs", version: "1.0.0", identifier: "qnf-" + slug, authors: "[\"QNFO Research\"]", release_gate_pass: 0 }, extra || {});
console.error = () => {};
{
  const { env, w } = makeEnv({ papers: [P("busy"), P("human", { identifier: "adelic-quantum-statistics", authors: "Rowan Brad Quni-Gudzinas" }), P("tried"), P("a"), P("b")], open: [{ paper_slug: "busy", source_id: "completeness:1" }], tries: [1, 2, 3].map((n) => ({ source_id: "revision:tried@1.0.0#" + n })) });
  const out = await revisionLoopTick(env);
  assert.equal(out.mode, "on");
  assert.equal(w.ageArg, "-1440 minutes");
  assert.equal(out.queued.length, 1, "one per tick by default");
  assert.equal(out.queued[0].slug, "a", "skips busy, hand-written and exhausted papers");
  assert.equal(w.queued[0][1], "revision:a@1.0.0#1");
  assert.match(w.queued[0][2], /^Original idea about a\n\nPost-publication revision/);
  assert.equal(w.log.length, 1);
  assert.deepEqual(w.metrics.sort(), ["paper_loop_revisions_24h=2", "papers_awaiting_revision=2"]);
}
{
  // Backpressure: at the in-flight cap nothing new is queued; the config raises the per-tick rate.
  const full = makeEnv({ papers: [P("a")], open: Array.from({ length: 8 }, (_, i) => ({ paper_slug: "x" + i, source_id: "revision:x" + i + "@1.0.0#1" })) });
  assert.equal((await revisionLoopTick(full.env)).queued.length, 0);
  const fast = makeEnv({ papers: [P("a"), P("b"), P("c")], cfg: [{ key: "revision_loop_per_tick", value: "2" }, { key: "revision_loop_min_age_min", value: "60" }] });
  const o2 = await revisionLoopTick(fast.env);
  assert.equal(o2.queued.length, 2);
  assert.equal(fast.w.ageArg, "-60 minutes");
  const off = makeEnv({ papers: [P("a")], cfg: [{ key: "revision_loop_mode", value: "off" }] });
  const o3 = await revisionLoopTick(off.env);
  assert.ok(o3.skipped && off.w.queued.length === 0);
  // A retry of a version counts up.
  const retry = makeEnv({ papers: [P("a")], tries: [{ source_id: "revision:a@1.0.0#1" }] });
  await revisionLoopTick(retry.env);
  assert.equal(retry.w.queued[0][1], "revision:a@1.0.0#2");
}

{
  // A paper with open errata goes first, past the min age, and its brief lists the errors.
  const e = makeEnv({ papers: [P("a"), P("b")], errata: [{ target_ref: "g", claim_text: "duty cycle is not optimal", detected_by: "qnfo-lifecycle PAPER-LEARN-1" }], errataPapers: [P("g", { authors: "Rowan Brad Quni-Gudzinas", version: "1.0.1" })] });
  const o4 = await revisionLoopTick(e.env);
  assert.equal(o4.queued[0].slug, "g");
  assert.equal(o4.queued[0].errata, 1);
  assert.equal(e.w.errataArgs[0], "-60 minutes");
  assert.match(e.w.queued[0][2], /Reported errors[\s\S]*duty cycle is not optimal \(confirmed by a second model\)/);
}

// REVISION-BRIEF-REFS-1 (0.28.6, issue 100287): the brief states the live reference count and the floor the guard enforces, so a
// rewrite stops dropping references and being sent back through the whole pipeline (references 12 -> 8).
{
  assert.equal(typeof W.rlBrief, "function", "rlBrief is exported");
  assert.equal(typeof W.rlRefFloor, "function", "rlRefFloor is exported");
  // The brief as it was before 0.28.6, byte for byte.
  const oldBrief = (title, version) => "Post-publication revision of the published paper \"" + title + "\" (version " + version + "). Write an improved version of the paper under revision: bring in the relevant work in the bibliography, especially newer work; strengthen the weakest arguments and derivations; correct every error; remove or qualify any claim the sources and derivations do not support; keep everything that is correct. The result is a complete paper, not a list of changes.";
  const refs = (n) => "## References\n\n" + Array.from({ length: n }, (_, i) => "[" + (i + 1) + "] Ref " + i + ".").join("\n") + "\n";
  const live = (n) => "# T\n\n## Abstract\n\nA.\n\n## 1. Introduction\n\nx y z\n\n" + refs(n);

  // (a) no count, 0, under the guard's minimum of 3, or not a number: byte-identical to today's brief.
  assert.equal(W.rlBrief("T", "1.0.0"), oldBrief("T", "1.0.0"));
  for (const c of [undefined, null, 0, 1, 2, NaN, "", "x", -5, 2.9]) assert.equal(W.rlBrief("T", "1.0.0", c), oldBrief("T", "1.0.0"), "refCount " + String(c));
  assert.equal(W.rlBrief("", "", 2), oldBrief("", "1.0.0"));

  // (b) 3 or more: one sentence added after the old text, with the live count and the floor.
  const b12 = W.rlBrief("T", "1.0.0", 12);
  assert.ok(b12.startsWith(oldBrief("T", "1.0.0") + " "), "the old text is kept, the sentence follows");
  assert.match(b12, /The live version lists 12 references\./);
  assert.match(b12, /fewer than 9 references \(70 percent of 12, rounded up\) is rejected before publication/);
  assert.match(b12, /Keep every reference you still rely on and add new ones/);
  assert.match(b12, /drop a reference only when the claim it supports is removed or wrong\.$/);
  assert.match(W.rlBrief("T", "1.0.0", 14), /lists 14 references\..*fewer than 10 references \(70 percent of 14/);
  assert.match(W.rlBrief("T", "1.0.0", 10), /lists 10 references\..*fewer than 7 references/);
  assert.match(W.rlBrief("T", "1.0.0", 3), /lists 3 references\..*fewer than 3 references/);
  assert.match(W.rlBrief("T", "1.0.0", "12"), /lists 12 references\./, "a numeric string is read as its number");
  assert.equal(W.rlRefCount(live(12)), 12);
  assert.equal(W.rlBrief("T", "1.0.0", W.rlRefCount(live(0))), oldBrief("T", "1.0.0"), "a paper with no reference list gets the old brief");

  // (c) one rule: the floor the brief states is the smallest count the guard accepts, for every size of reference list.
  for (let n = 3; n <= 300; n++) {
    const f = W.rlRefFloor(n);
    assert.equal(W.rlRegression("# T\n\n" + refs(n), "# T\n\n" + refs(f)), "", "guard accepts " + f + " of " + n);
    assert.match(W.rlRegression("# T\n\n" + refs(n), "# T\n\n" + refs(f - 1)), new RegExp("^references " + n + " -> " + (f - 1) + "$"), "guard rejects " + (f - 1) + " of " + n);
    assert.match(W.rlBrief("T", "1.0.0", n), new RegExp("fewer than " + f + " references"));
  }
  // The constants are the only place the numbers live: change them in the source and both the guard and the brief move.
  const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  assert.match(src, /var RL_REF_KEEP = 0\.7, RL_REF_MIN = 3;/);
  assert.match(src, /rb < ra \* RL_REF_KEEP/);
  assert.ok(!/ra >= 3 && rb < ra \* 0\.7/.test(src), "the guard no longer carries its own copy of 0.7 and 3");
  const alt = src.replace("var RL_REF_KEEP = 0.7, RL_REF_MIN = 3;", "var RL_REF_KEEP = 0.5, RL_REF_MIN = 4;");
  assert.notEqual(alt, src, "the constants line was found");
  const A = await import("data:text/javascript;base64," + Buffer.from(alt).toString("base64"));
  assert.match(A.rlBrief("T", "1.0.0", 12), /fewer than 6 references \(50 percent of 12, rounded up\)/);
  assert.equal(A.rlBrief("T", "1.0.0", 3), oldBrief("T", "1.0.0"), "below the new minimum of 4 the brief is the old one");
  assert.equal(A.rlRegression("# T\n\n" + refs(10), "# T\n\n" + refs(5)), "", "the guard follows the constant: 5 of 10 passes at 50 percent");
  assert.match(A.rlRegression("# T\n\n" + refs(10), "# T\n\n" + refs(4)), /^references 10 -> 4$/);
  assert.equal(A.rlRegression("# T\n\n" + refs(3), "# T\n\n" + refs(0)), "", "the guard follows the minimum: 3 live references are not guarded at a minimum of 4");
  assert.match(W.rlRegression("# T\n\n" + refs(10), "# T\n\n" + refs(5)), /^references 10 -> 5$/, "the shipped 70 percent still rejects 5 of 10");

  // (d) the revision loop reads the picked paper's body and queues the brief with its count; the candidate select stays light.
  const e1 = makeEnv({ papers: [P("a"), P("b"), P("c")], bodies: { a: live(12), b: live(40) } });
  const r1 = await revisionLoopTick(e1.env);
  assert.equal(r1.queued.length, 1);
  assert.equal(e1.w.queued[0][3], "a");
  assert.match(e1.w.queued[0][2], /^Original idea about a\n\nPost-publication revision/);
  assert.match(e1.w.queued[0][2], /The live version lists 12 references\./);
  assert.match(e1.w.queued[0][2], /fewer than 9 references/);
  assert.deepEqual(e1.w.bodyReads, ["a"], "the body is read for the picked paper only, not for the candidates");
  const cand = /"SELECT ([^"]*?) FROM papers WHERE status = 'published' AND slug IS NOT NULL AND slug <> '' AND length\(body_md\) >= 8000/.exec(src);
  assert.ok(cand && /\bslug\b/.test(cand[1]) && !/body_md/.test(cand[1]), "the candidate select does not read body_md: " + (cand && cand[1]));

  // A paper with errata: the reference sentence precedes the error list.
  const e2 = makeEnv({ papers: [P("a")], errata: [{ target_ref: "g", claim_text: "duty cycle is not optimal", detected_by: "qnfo-lifecycle PAPER-LEARN-1" }], errataPapers: [P("g", { version: "1.0.1" })], bodies: { g: live(14) } });
  await revisionLoopTick(e2.env);
  assert.equal(e2.w.queued[0][3], "g");
  assert.match(e2.w.queued[0][2], /lists 14 references\.[\s\S]*fewer than 10 references[\s\S]*Reported errors[\s\S]*duty cycle is not optimal/);

  // Several per tick: each row carries its own paper's count.
  const e3 = makeEnv({ papers: [P("a"), P("b"), P("c")], cfg: [{ key: "revision_loop_per_tick", value: "3" }], bodies: { a: live(12), b: live(40), c: live(7) } });
  const r3 = await revisionLoopTick(e3.env);
  assert.equal(r3.queued.length, 3);
  assert.match(e3.w.queued[0][2], /lists 12 references/);
  assert.match(e3.w.queued[1][2], /lists 40 references\..*fewer than 28 references/);
  assert.match(e3.w.queued[2][2], /lists 7 references\..*fewer than 5 references/);

  // Fail-soft: a failed read, a missing row, an empty body or a short list leaves the brief exactly as it was, and the paper is still queued.
  for (const [name, o] of [["read fails", { bodyFail: true }], ["no row", { bodies: {} }], ["empty body", { bodies: { a: "" } }], ["no reference list", { bodies: { a: "# T\n\nNo references here.\n" } }], ["two references", { bodies: { a: live(2) } }]]) {
    const f = makeEnv(Object.assign({ papers: [P("a")] }, o));
    const rf = await revisionLoopTick(f.env);
    assert.equal(rf.queued.length, 1, name + ": still queued");
    assert.equal(f.w.queued[0][2], "Original idea about a\n\n" + oldBrief("Title a", "1.0.0"), name + ": the brief is the old one");
  }
}

// remediationPublish carries the computed version and the history (source check: the fixed '2.0.0' literal is gone).
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const rp = src.slice(src.indexOf("async function remediationPublish("), src.indexOf("__name(remediationPublish"));
assert.ok(!/'2\.0\.0','drafted'|,'2\.0\.0',\?5/.test(rp), "remediationPublish no longer writes a fixed 2.0.0");
assert.match(rp, /rlNextVersion\(versionFrom, isRev\)/);
assert.match(rp, /rlWithHistory\(paper, versionTo/);
const pv = src.slice(src.indexOf("async function publishV2("), src.indexOf("__name(publishV2"));
assert.ok(pv.indexOf("rlArchiveVersion(env, vSlug") > 0 && pv.indexOf("rlArchiveVersion(env, vSlug") < pv.indexOf("UPDATE papers SET title=?, body_md=?, version=?, abstract="), "the live text is archived before a revision replaces it");
console.log("revision-loop: ok");

// REVISION-CLAIMGATE-1: the claim gate never reads the pipeline's own banner, Version History or Provenance as the authors' claims.
{
  const md = rlWithHistory("# T\n\nWe prove a bound.\n\n## Results\n\nThe bound holds.\n\n## Provenance and AI Involvement\n\n- This paper was drafted, reconciled, reviewed, revised and checked by the QNFO automated research pipeline.\n\n## References\n\n1. A.\n", "1.1.0", "2026-10-19", ["Version 1.1.0: revised."]);
  const s = ciStripPipeline(md);
  assert.ok(!/Revised \(version/.test(s), "banner stripped");
  assert.ok(!/Version History/.test(s), "history stripped");
  assert.ok(!/automated research pipeline/.test(s), "provenance stripped");
  assert.ok(/The bound holds\./.test(s) && /## References/.test(s) && /We prove a bound\./.test(s), "paper text kept");
}

// REVISION-NONREGRESS-1: a revision thinner than the live paper does not replace it.
{
  const refs = (n) => "## References\n\n" + Array.from({ length: n }, (_, i) => "[" + (i + 1) + "] Ref " + i + ".").join("\n") + "\n";
  const words = (n) => "# T\n\n" + "word ".repeat(n) + "\n\n";
  assert.equal(rlRegression(words(2000) + refs(10), words(2100) + refs(9)), "");
  assert.match(rlRegression(words(2000) + refs(10), words(2100) + refs(6)), /^references 10 -> 6$/);
  assert.match(rlRegression(words(5000) + refs(5), words(2500) + refs(5)), /^length/);
  assert.equal(rlRegression(words(200) + refs(1), words(50) + refs(0)), "");
  assert.ok(/rlRegression\(existing\.body_md, paper\)/.test(readFileSync(new URL("./worker.js", import.meta.url), "utf8")), "remediationPublish checks a loop revision against the live paper");
}

// PROPORTIONATE-NOTICE-1: earlier banners and Correction Notice sections become nothing but the history line.
{
  const old = "# T\n\n> **Correction (version 1.0.1, 2026-10-19):** statements ... none took place. See the Correction Notice.\n\nBody.\n\n## Correction Notice\n\nVersion 1.0.1 corrects...\n- The previous version stated: x\n\n## References\n\n[1] A.\n";
  const s = rlStripNotices(old);
  assert.ok(!/Correction/.test(s) && /Body\./.test(s) && /## References/.test(s), s);
  const w = rlWithHistory(old, "1.0.1", "2026-10-19", ["Version 1.0.1 (2026-10-19, from 1.0.0): wording: 1 sentence was restated as a proposal"]);
  assert.ok(!/Correction|Version History/.test(w) && /Body\./.test(w) && /## References/.test(w), w);
  assert.equal(rlWithHistory("# T\n\nBody.\n", "1.0.0", "2026-10-19", []), "# T\n\nBody.\n");
  const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  assert.ok(/filter\(function\(p\) \{ return rlEligible\(p, pipeSlugs\); \}\)/.test(src), "the claim sweep covers pipeline papers only");
  assert.ok(!/withCorrection\(applied\.md/.test(src), "a correction no longer writes a banner and notice");
}

// PROPORTIONATE-NOTICE-1 repair tick: owner papers restored from backup, pipeline banners cleaned, pipeline retractions kept.
{
  const writes = [];
  const papers = [
    { slug: "owner-one", identifier: "qnfo-2026-1", version: "1.0.1", status: "retracted", title: "Retracted: Owner One" },
    { slug: "pipe-one", identifier: "qnf-1", version: "1.0.1", status: "published", title: "Pipe One" },
    { slug: "pipe-gone", identifier: "qnf-2", version: "1.0.1", status: "retracted", title: "Retracted: Pipe Gone" },
  ];
  const stmt = (sql, rows) => ({ bind: (...a) => ({ all: async () => ({ results: rows(a) }), first: async () => (rows(a) || [])[0] || null, run: async () => { writes.push([sql, a]); return { meta: { changes: 1 } }; } }), all: async () => ({ results: rows([]) }), first: async () => (rows([]) || [])[0] || null, run: async () => { writes.push([sql, []]); return {}; } });
  const env = {
    QNFO_AUDIT: { prepare: (sql) => stmt(sql, () => {
      if (/FROM paper_integrity_backups/.test(sql)) return [{ slug: "owner-one", version: "1.0.0", status: "published", title: "Owner One", abstract: "A", body_md: "# Owner One\n\nOriginal." }, { slug: "pipe-gone", version: "1.0.0", status: "published", title: "Pipe Gone", abstract: "", body_md: "# x" }];
      if (/SELECT DISTINCT paper_slug/.test(sql)) return [];
      if (/FROM paper_revision_log/.test(sql)) return [{ version_from: "1.0.0", version_to: "1.0.1", status: "claim-corrected", day: "2026-10-19" }];
      return [];
    }) },
    LIVING_PAPER: { prepare: (sql) => stmt(sql, (a) => {
      if (/WHERE status IN/.test(sql)) return papers;
      if (/SELECT body_md FROM papers/.test(sql)) return [{ body_md: "# Pipe One\n\n> **Correction (version 1.0.1, 2026-10-19):** x\n\nBody.\n\n## Correction Notice\n\nx\n\n## References\n\n[1] A.\n" }];
      return [];
    }) },
  };
  const r = await noticeRepairTick(env);
  assert.deepEqual(r.restored, ["owner-one"]);
  assert.deepEqual(r.cleaned, ["pipe-one"]);
  const up = writes.filter(([s]) => /UPDATE papers SET/.test(s));
  assert.equal(up.length, 2);
  assert.deepEqual(up[0][1].slice(0, 6), ["owner-one", "Owner One", "A", "# Owner One\n\nOriginal.", "1.0.0", "published"]);
  assert.ok(!/Correction|Version History/.test(up[1][1][1]) && /Body\./.test(up[1][1][1]) && /## References/.test(up[1][1][1]), up[1][1][1]);
  assert.ok(!up.some(([, a]) => a[0] === "pipe-gone"), "a pipeline retraction stays");
}
assert.ok(/if \(r\.verdict === "flagged" && live\[r\.slug\]\) st\.flagged\+\+/.test(readFileSync(new URL("./worker.js", import.meta.url), "utf8")), "papers_fabricated_claims_open counts only papers the sweep still covers");
