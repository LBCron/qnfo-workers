/**
 * portfolio.test.mjs -- offline regression lock for PORTFOLIO-LOOP-1 (docs/PORTFOLIO.md).
 *
 * Slices the PORTFOLIO-LOOP-1 block out of worker.js (same technique as charter.test.mjs), evaluates its pure
 * half in a sandbox and replays portfolio.fixture.json (the QNFO organisation as read on 2026-10-01).
 * Output MUST contain "0 failed" on success; charter-guard.yml greps for exactly that string.
 *
 *   node qnfo-fleet-control/portfolio.test.mjs             # assertions
 *   node qnfo-fleet-control/portfolio.test.mjs --render    # the docs/PORTFOLIO.md live block
 *   node qnfo-fleet-control/portfolio.test.mjs --public    # the QNFO/.github/PORTFOLIO.md mirror
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const BEGIN = "// ---- PORTFOLIO-LOOP-1:BEGIN";
const END = "// ---- PORTFOLIO-LOOP-1:END ----";
const a = src.indexOf(BEGIN);
const b = src.indexOf(END);
if (a < 0 || b < 0 || b < a) {
  console.error("FAIL portfolio block markers missing from worker.js");
  console.log("1 failed");
  process.exit(1);
}
const sandbox = { VERSION: "0.0.0-test", timedFetch: null, b64encode: null, charterOne: null, charterRows: null, console, Date, Math, JSON, Number, String, Object, Array, RegExp, isNaN, TextDecoder, atob, __export: null };
vm.createContext(sandbox);
vm.runInContext(src.slice(a, b + END.length) + "\n__export = { pfTier, pfHygiene, pfEvaluate, pfRenderDocBlock, pfRenderPublic, pfRenderReadmeBlock, pfSplice, pfSpliceOrBootstrap, PF_BEGIN, PF_END, PF_README_ANCHOR, PF_TIER_ORDER, pfWbsHint, pfTopicsFor, pfDescriptionFromReadme, pfHygienePlan, PF_HYGIENE_MAX, pfNeedsSync, PF_STALE_H, pfScrubProfile, PF_PROFILE_SCRUB, pfIsMetadata, pfStandards, pfStandardsSummary, pfUnpinnedUses, pfLicenseVersion, pfStaleLicenseRef, pfCredentialMatchCount, pfCodeqlSetupFailed, pfPureMirrorCandidates, PF_STANDARD_FLAGS };", sandbox, { filename: "portfolio-block.js" });
const P = sandbox.__export;
const fx = JSON.parse(readFileSync(join(here, "portfolio.fixture.json"), "utf8"));
const standardsFixture = JSON.parse(readFileSync(join(here, "portfolio-standards.fixture.json"), "utf8"));
const NOW = "2026-10-01T12:00:00.000Z";

let passed = 0, failed = 0;
function eq(actual, expected, label) { if (actual === expected) { passed++; return; } failed++; console.error(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`); }
function ok(c, label) { eq(!!c, true, label); }

// --- tiers -----------------------------------------------------------------
eq(P.pfTier({ name: "qnfo-workers" }), "platform", "qnfo-workers is platform");
eq(P.pfTier({ name: ".github" }), "governance", ".github is governance");
eq(P.pfTier({ name: "deepchat" }), "client-config", "deepchat is client-config");
eq(P.pfTier({ name: "qwav-demo-bt-qec" }), "demo", "qwav-demo-* is demo");
eq(P.pfTier({ name: "qwav-demos" }), "demo", "qwav-demos is demo");
eq(P.pfTier({ name: "ultrametric-physics" }), "research", "a program repo is research");
eq(P.pfTier({ name: "qnfo-workers", archived: true }), "archived", "archived overrides everything");
eq(P.pfTier({ name: "mcp", fork: true }), "fork", "fork overrides research");
eq(P.pfTier({ name: "mcp", fork: true, archived: true }), "archived", "archived overrides fork");

// --- hygiene ---------------------------------------------------------------
const nowMs = Date.parse(NOW);
eq(P.pfHygiene({ name: "x", description: "d", license: "MIT", topics: ["a"], pushed_at: "2026-09-30T00:00:00Z" }, "research", nowMs).length, 0, "complete repo has no flags");
eq(P.pfHygiene({ name: "x", description: "", license: null, topics: [], pushed_at: "2026-05-01T00:00:00Z" }, "research", nowMs).join(","), "no-description,no-license,no-topics,dormant-153d", "every flag fires");
eq(P.pfHygiene({ name: "x", description: "", license: null, topics: [] }, "archived", nowMs).length, 0, "archived repos are not graded");
eq(P.pfHygiene({ name: ".github", description: "d", license: "NOASSERTION", topics: ["a"], pushed_at: NOW }, "governance", nowMs).length, 0, "a custom licence counts for governance");

// --- evaluate on the live fixture --------------------------------------------
const ev = P.pfEvaluate(fx.repos, fx.wbs, NOW);
eq(ev.total, fx.repos.length, "every repository classified");
eq(ev.total, 127, "fixture holds the 2026-10-01 organisation (116 search + 11 forks)");
ok(ev.tiers.archived >= 70, "most of the organisation is archived");
eq(ev.tiers.fork, 10, "ten live forks");
eq(ev.tiers.platform, 14, "fourteen platform repositories");
eq(ev.tiers.governance, 3, "three governance repositories");
eq(ev.tiers["client-config"], 3, "three private config repositories");
ok(ev.tiers.demo >= 7, "the qwav-demo family is demo");
ok(ev.private_count >= 7, "private repositories are counted");
const byName = Object.fromEntries(ev.rows.map((r) => [r.name, r]));
eq(byName["ultrametric-physics"].wbs.includes("QNFO.UMP"), true, "WBS program linked through github_repo");
eq(byName["qnfo-research"].wbs.length, 2, "a repo can carry several WBS codes");
eq(byName["deepchat"].visibility, "private", "private flag honoured");
eq(byName["qnfo-workers"].pillar, "core", "platform maps to pillar core");
eq(byName["qwav-demo-bt-qec"].pillar, "reach", "demo maps to pillar reach");
ok(ev.hygiene_score !== null && ev.hygiene_score >= 0 && ev.hygiene_score <= 1, "hygiene score is a ratio");
ok(ev.unlinked_research.includes("reentrant-distinctions"), "a research repo without a WBS code is listed as unlinked");
ok(!ev.unlinked_research.includes("laws-of-form"), "a linked research repo is not listed as unlinked");
ok(ev.rows.every((r) => P.PF_TIER_ORDER.includes(r.tier)), "every tier is a known tier");
ok(ev.rows.findIndex((r) => r.tier === "archived") > ev.rows.findIndex((r) => r.tier === "research"), "rows ordered platform..archived");
const ev0 = P.pfEvaluate([], [], NOW);
eq(ev0.total, 0, "empty organisation evaluates without throwing");
eq(ev0.hygiene_score, null, "empty organisation has no hygiene score");

// --- PORTFOLIO-STANDARDS-1 --------------------------------------------------
const standardRepos = standardsFixture.repos.map((r) => Object.assign({ description: "fixture", license: "MIT", topics: ["qnfo"], pushed_at: NOW }, r));
const standardEv = P.pfEvaluate(standardRepos, [], NOW);
for (const [repo, flag] of [
  ["standards-no-security", "no-security-policy"],
  ["standards-unpinned", "actions-unpinned"],
  ["standards-no-dependabot", "no-dependabot"],
  ["standards-stale-license", "stale-license-ref"],
  ["standards-credential", "committed-credential"],
  ["standards-pure-mirror", "fork-pure-mirror"],
  ["standards-fork-actions", "fork-actions-enabled"],
  ["standards-codeql-failed", "codeql-setup-failed"]
]) ok(standardEv.rows.find((r) => r.name === repo).standards.flags.includes(flag), `${flag} grades from the fixture`);
eq(standardEv.rows.find((r) => r.name === "standards-unpinned").standards.counts["actions-unpinned"], 1, "only root workflow uses without a 40-character SHA are counted");
eq(standardEv.standards.counts["committed-credential"], 2, "credential alerts are represented as a count");
eq(standardEv.rows.find((r) => r.name === "standards-codeql-recovered").standards.flags.includes("codeql-setup-failed"), false, "later CodeQL success clears the failure flag");
eq(P.pfLicenseVersion("QNFO Unified License Agreement v2.1"), "2.1", "canonical license version is parsed");
eq(P.pfStaleLicenseRef("QNFO-ULA v2.0", "2.1"), true, "an older QNFO license reference is flagged");
eq(P.pfStaleLicenseRef("QNFO-ULA v2.1", "2.1"), false, "the current QNFO license reference is not flagged");
eq(P.pfCredentialMatchCount([["AKIA", "A".repeat(16)].join("")]), 1, "default-branch credential patterns are counted without returning their values");
eq(standardEv.hygiene_score, 1, "standards flags do not affect the existing hygiene score");
eq(standardEv.standards.available, true, "standards summary is available for a complete fixture");
eq(P.pfPureMirrorCandidates(standardEv).join(","), "standards-pure-mirror", "pure mirrors are proposed without including other forks");
const standardsPublic = P.pfRenderPublic(standardEv);
ok(standardsPublic.includes("### Standards (reported separately; not included in the hygiene score)"), "public mirror includes standards summary");
ok(!standardsPublic.includes("private-standard-repository"), "private repository is never named in the standards render");
ok(!standardsPublic.includes("AKIA") && !standardsPublic.includes(".github/workflows"), "public standards output contains no credential value or path");

// --- renders never name a private repository ---------------------------------
const doc = P.pfRenderDocBlock(ev);
const pub = P.pfRenderPublic(ev);
const rd = P.pfRenderReadmeBlock(ev);
const privNames = ev.rows.filter((r) => r.visibility === "private").map((r) => r.name);
for (const txt of [doc, pub, rd]) {
  ok(privNames.every((n) => !txt.includes("/" + n + ")") && !txt.includes("[" + n + "]")), "no private repository is named in a render");
}
ok(doc.startsWith(P.PF_BEGIN) && doc.endsWith(P.PF_END), "doc block wrapped in markers");
ok(rd.startsWith(P.PF_BEGIN) && rd.endsWith(P.PF_END), "readme block wrapped in markers");
ok(pub.startsWith("# QNFO portfolio (public mirror)"), "public mirror has its title");
ok(pub.includes("docs/QUNIVERSE-CHARTER.md") && pub.includes("papers.qnfo.org") && pub.includes("/portfolio`"), "public mirror links charter, papers and the live endpoint");
ok(doc.includes("[ultrametric-physics](https://github.com/QNFO/ultrametric-physics)"), "research table links the repo");
ok(doc.includes("### Portfolio actions"), "actions section rendered");
ok(doc.length < 60000 && pub.length < 60000, "renders bounded");

// --- splice and bootstrap -------------------------------------------------------
const readme = "# QNFO\n\nintro\n\n## Research Portfolio\n\ntable\n";
const boot = P.pfSpliceOrBootstrap(readme, rd);
ok(boot !== null && boot.indexOf(P.PF_BEGIN) < boot.indexOf("## Research Portfolio"), "bootstrap inserts the block above the anchor");
eq(P.pfSpliceOrBootstrap(boot, rd), boot, "second pass is idempotent");
const rd2 = rd.replace(ev.ts.slice(0, 10), "2026-10-02");
const again = P.pfSpliceOrBootstrap(boot, rd2);
ok(again.includes("2026-10-02") && again.split(P.PF_BEGIN).length === 2, "later pass replaces in place, no duplicate markers");
eq(P.pfSpliceOrBootstrap("no anchor here", rd), null, "no markers and no anchor refuses");
eq(P.pfSplice("plain", doc), null, "splice refuses a doc without markers");

// --- PROFILE-CLAIMS-SCRUB-1 ------------------------------------------------------
const claims = P.PF_PROFILE_SCRUB.map((x) => x[0]);
const dirty = "# QNFO\n\n" + claims.join("\n") + "\n" + boot;
const clean = P.pfScrubProfile(dirty);
eq(claims.filter((c) => clean.includes(c)).length, 0, "every retired claim is replaced");
ok(clean.includes("independent research imprint") && clean.includes("$1.5M federal research"), "the replacements land");
ok(!/co-directed the \$10M|foundational US patents|Publicis\n|501\(c\)\(3\)|\(92 records\)|867 records/.test(clean), "no retired claim survives");
eq(P.pfScrubProfile(clean), clean, "scrub is idempotent");
eq(P.pfScrubProfile(boot), boot, "a README without the claims is unchanged (managed block untouched)");
ok(clean.indexOf(P.PF_BEGIN) > 0 && clean.split(P.PF_BEGIN).length === 2, "the managed block survives the scrub");
eq(P.pfScrubProfile("x co-directed the $10M y"), "x co-directed the $10M y", "drifted text is left alone, not guessed at");

if (process.argv.includes("--render")) console.log(doc);
if (process.argv.includes("--public")) console.log(pub);

// --- PORTFOLIO-HYGIENE-1 ---------------------------------------------------
eq(P.pfHygiene({ name: "QWAV", description: "d", license: "NOASSERTION", topics: ["a"], pushed_at: NOW }, "research", nowMs).length, 0, "a NOASSERTION licence file (the QNFO-ULA) counts as licensed on every tier");
eq(P.pfWbsHint("QNFO.UMP.004: QEC-Darwinism tradeoff").join(","), "QNFO.UMP.004", "a WBS code in the description is a hint");
eq(P.pfWbsHint("QNFO Research Artifacts").length, 0, "the bare imprint name is not a code");
eq(P.pfWbsHint("codes QNFO.ADL.001 and QNFO.ADL.001 and QWAV.DEM").join(","), "QNFO.ADL.001,QWAV.DEM", "codes are deduped");
eq(P.pfDescriptionFromReadme("# Title\n\n![badge](x)\n\nThis repository holds the **Adelic** [theory](u) of things.\n\nMore."), "This repository holds the Adelic theory of things.", "first real paragraph, markdown stripped");
eq(P.pfDescriptionFromReadme("# Only a title\n\n- a list\n- only"), null, "no paragraph means no description");
eq(P.pfDescriptionFromReadme("---\ntitle: x\n---\n\nFront matter is skipped before the paragraph."), "Front matter is skipped before the paragraph.", "front matter is skipped");
ok(P.pfDescriptionFromReadme("word ".repeat(80) + "end").length <= 244, "long paragraphs are cut at a word with an ellipsis");
eq(P.pfDescriptionFromReadme("<!-- hidden --> Intro paragraph <b>with</b> markup\n\nA clean second paragraph of the README text."), "A clean second paragraph of the README text.", "lines carrying markup are left out and comments are cut by index");
eq(P.pfDescriptionFromReadme("<!-- unterminated comment\n\nnothing after it"), null, "an unterminated comment swallows the rest");
const wbsAll = fx.wbs.concat([
  { wbs_code: "QWAV", level: "portfolio", slug: "qwav", name: "QWAV", status: "active", github_repo: null },
  { wbs_code: "QNFO.QEC.001", level: "project", slug: "qec-darwinism-ultrametric", name: "x", status: "active", github_repo: null },
  { wbs_code: "QNFO.TST", level: "program", slug: "Test Program", name: "t", status: "active", github_repo: null }
]);
eq(P.pfTopicsFor({ tier: "research", wbs: ["QNFO.TST.001"], description: "" }, wbsAll).join(","), "qnfo,research,open-research,test-program", "topics = tier baseline + served program slug");
eq(P.pfTopicsFor({ tier: "demo", wbs: [], description: "part of QWAV.DEM" }, wbsAll).join(","), "qnfo,qwav,interactive-demo", "a slug already in the baseline is not repeated");
const evH = P.pfEvaluate(fx.repos, wbsAll, NOW);
const plan = P.pfHygienePlan(evH, wbsAll);
ok(plan.length > 0 && plan.length <= P.PF_HYGIENE_MAX, "the plan is bounded (" + plan.length + " <= " + P.PF_HYGIENE_MAX + ")");
eq(plan[0].action, "wbs-link", "registry links come first");
ok(plan.some((a) => a.repo === "QWAV" && a.action === "wbs-link" && a.code === "QWAV"), "QWAV links by slug");
ok(plan.some((a) => a.repo === "qec-darwinism-ultrametric" && a.action === "wbs-link" && a.code === "QNFO.QEC.001"), "qec-darwinism-ultrametric links by slug");
ok(plan.every((a) => { const r = evH.rows.find((x) => x.name === a.repo); return r && r.visibility === "public" && !r.archived && !r.fork && r.tier !== "client-config"; }), "no action touches a private, archived, fork or client-config repository");
ok(plan.filter((a) => a.action === "license").every((a) => evH.rows.find((x) => x.name === a.repo).license === null), "licence actions only where no LICENSE file exists");
ok(plan.filter((a) => a.action === "topics").every((a) => a.topics.length >= 2 && a.topics.every((t) => /^[a-z0-9][a-z0-9-]{0,49}$/.test(t))), "topic actions carry valid GitHub topics");
const fullPlan = (() => { const ev2 = P.pfEvaluate(fx.repos, wbsAll, NOW); return ev2.rows.filter((r) => r.visibility === "public" && !r.archived && !r.fork && r.tier !== "client-config" && r.flags.some((f) => f.indexOf("dormant") !== 0)).length; })();
ok(fullPlan > P.PF_HYGIENE_MAX, "the fixture has more work than one sync takes (" + fullPlan + " flagged repositories)");
eq(P.pfHygienePlan({ rows: [] }, wbsAll).length, 0, "an empty register plans nothing");
const evA = Object.assign({}, evH, { actions: [{ repo: "x", action: "license", status: "committed", note: "abc" }] });
ok(P.pfRenderDocBlock(evA).includes("Hygiene actions the loop took") && P.pfRenderDocBlock(evA).includes("- x: license committed (abc)"), "actions taken are rendered");
ok(!P.pfRenderDocBlock(evH).includes("Hygiene actions the loop took"), "no actions, no section");


// --- DEPLOY-SYNC-1 ----------------------------------------------------------
const T0 = Date.parse(NOW);
const h = (n) => new Date(T0 - n * 3600000).toISOString();
eq(P.pfNeedsSync(null, "1.0.0", T0), "no successful run yet", "no run: sync");
eq(P.pfNeedsSync({ ts: h(1), status: "ok", note: "kernel 1.0.0; wbs:ok" }, "1.0.0", T0), null, "a fresh ok run by this kernel: hold");
eq(P.pfNeedsSync({ ts: h(1), status: "ok", note: "kernel 0.9.9; wbs:ok" }, "1.0.0", T0), "kernel 1.0.0 has not synced yet", "a new kernel syncs on its first tick");
eq(P.pfNeedsSync({ ts: h(1), status: "ok", note: "wbs:ok; dormant 1" }, "1.0.0", T0), "kernel 1.0.0 has not synced yet", "a run from before DEPLOY-SYNC-1 counts as another kernel");
eq(P.pfNeedsSync({ ts: h(P.PF_STALE_H + 1), status: "ok", note: "kernel 1.0.0;" }, "1.0.0", T0), "last ok run is " + (P.PF_STALE_H + 1) + "h old", "an ok run older than the hold: sync");
eq(P.pfNeedsSync({ ts: h(0.5), status: "partial", note: "kernel 1.0.0;" }, "1.0.0", T0), null, "a partial run 30 minutes ago: hold");
eq(P.pfNeedsSync({ ts: h(1), status: "partial", note: "kernel 1.0.0;" }, "1.0.0", T0), "last partial run is 1h old", "a partial run an hour ago: retry");
eq(P.pfNeedsSync({ ts: "garbage", status: "ok", note: "kernel 1.0.0;" }, "1.0.0", T0) !== null, true, "an unreadable timestamp: sync");


// --- HINT-LINK-1 ------------------------------------------------------------
const hintRepos = [
  { name: "paper-artifacts", description: "QNFO.TST.001: the paper's artifacts", visibility: "public", archived: false, fork: false, pushed_at: NOW, topics: ["a"], license: "MIT" },
  { name: "unknown-code", description: "QNFO.ZZZ.999: a code nobody registered", visibility: "public", archived: false, fork: false, pushed_at: NOW, topics: ["a"], license: "MIT" }
];
const hintRows = [{ wbs_code: "QNFO.TST.001", level: "project", slug: "tst-paper", name: "t", status: "active", github_repo: "QNFO/other-repo" }];
const evL = P.pfEvaluate(hintRepos, hintRows, NOW);
eq(evL.rows.find((r) => r.name === "paper-artifacts").wbs.join(","), "QNFO.TST.001", "a description naming a registry code links the repository");
eq(evL.rows.find((r) => r.name === "unknown-code").wbs.length, 0, "an unknown code does not link");
eq(evL.unlinked_research.join(","), "unknown-code", "only the repository with no known code is unlinked");
eq(P.pfHygienePlan(evL, hintRows).filter((a) => a.action === "wbs-link").length, 0, "a code already linked elsewhere is not re-linked");


// --- DESCRIPTION-QUALITY-1 --------------------------------------------------
eq(P.pfIsMetadata("Status: 20-chapter guide drafted | Phase: P3 (Review) | Started: 2026-05-26 | Updated: 2026-05-26"), true, "a labelled metadata line is not a description");
eq(P.pfIsMetadata("Author: QNFO Research | Date: 2026-07-29 | Status: Phase 0 — Active"), true, "author/date/status line is metadata");
eq(P.pfIsMetadata("A Unified Treatise on the Loop, the Tree, and the Constants of Self-Reference"), false, "a sentence is not metadata");
eq(P.pfIsMetadata("Implements P0 (foundation) of QNFO.CODEPARSE.SCOPE.v1: every instruction, chat, prompt, skill"), false, "a colon inside prose is not a label");
eq(P.pfDescriptionFromReadme("# Guide\n\n**Status:** drafted | **Phase:** P3 | **Updated:** 2026-05-26\n\n## Identity\n\nA revolutionary beginner's guide to quantum computing that starts with the why."), "A revolutionary beginner's guide to quantum computing that starts with the why.", "the metadata paragraph is skipped and the next real one taken");
const evR = P.pfEvaluate([
  { name: "loop-wrote", description: "Status: drafted | Phase: P3 | Updated: 2026-05-26", visibility: "public", archived: false, fork: false, pushed_at: NOW, topics: ["a"], license: "MIT" },
  { name: "person-wrote", description: "Status: drafted | Phase: P3 | Updated: 2026-05-26", visibility: "public", archived: false, fork: false, pushed_at: NOW, topics: ["a"], license: "MIT" }
], [], NOW);
const planR = P.pfHygienePlan(evR, [], { "loop-wrote": "Status: drafted | Phase: P3 | Updated: 2026-05-26" });
eq(planR.filter((a) => a.action === "description-revise").map((a) => a.repo).join(","), "loop-wrote", "only a description the loop wrote is revised");
eq(P.pfHygienePlan(evR, [], { "loop-wrote": "something else the loop wrote earlier" }).filter((a) => a.action === "description-revise").length, 0, "a description changed by a person since is not touched");
eq(P.pfNeedsSync({ ts: h(1), status: "ok", note: "kernel 1.0.0; wbs:ok; dormant 1; unlinked 0; actions 12 (11 committed)" }, "1.0.0", T0), "last ok run is 1h old", "a run that took actions retries within the hour");
eq(P.pfNeedsSync({ ts: h(0.5), status: "ok", note: "kernel 1.0.0; actions 12 (11 committed)" }, "1.0.0", T0), null, "but not within 50 minutes");
eq(P.pfNeedsSync({ ts: h(1), status: "ok", note: "kernel 1.0.0; actions 0 (0 committed)" }, "1.0.0", T0), null, "a run with nothing left to do holds for the day");


// --- REVISE-OUTSIDE-CAP-1 ---------------------------------------------------
const manyRepos = [];
for (let i = 0; i < 20; i++) manyRepos.push({ name: "r" + String(i).padStart(2, "0"), description: "", visibility: "public", archived: false, fork: false, pushed_at: NOW, topics: ["a"], license: "MIT" });
for (let i = 0; i < 4; i++) manyRepos.push({ name: "w" + i, description: "loop wrote this one " + i, visibility: "public", archived: false, fork: false, pushed_at: NOW, topics: ["a"], license: "MIT" });
const wrote = { w0: "loop wrote this one 0", w1: "loop wrote this one 1", w2: "loop wrote this one 2", w3: "loop wrote this one 3" };
const planM = P.pfHygienePlan(P.pfEvaluate(manyRepos, [], NOW), [], wrote);
eq(planM.filter((a) => a.action === "description-revise").length, 4, "every loop-written description is revised");
eq(planM.filter((a) => a.action !== "description-revise").length, P.PF_HYGIENE_MAX, "and the write budget is still fully used");


// --- HYGIENE-SCOPE-1 ----------------------------------------------------------
const scopeRepos = [
  { name: "qnfo-ops", description: "d", visibility: "public", archived: false, fork: false, pushed_at: NOW, topics: ["a"], license: "MIT" },
  { name: "priv-dirty", description: "", visibility: "private", private: true, archived: false, fork: false, pushed_at: "2025-01-01T00:00:00Z", topics: [], license: null }
];
const evS = P.pfEvaluate(scopeRepos, [], NOW);
eq(evS.hygiene_score, 1, "a flagged private repository does not lower the score");
eq(evS.graded, 1, "only public repositories are graded");
eq(evS.dormant.length, 0, "a dormant private repository is never named");
eq(evS.unlinked_research.length, 0, "an unlinked private research repository is never named");
eq(evS.private_count, 1, "but it is counted");

console.log(`portfolio.test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
