// OBJECTION-FIND-1 offline suite (personal-companion 1.25.3, charter pillar: personal; agent_issues 2552).
// Proves: the objection is read from wherever the essay contract lets the writer place it (a heading naming it, a paragraph that
// raises it in so many words, or a section whose heading challenges the claim), not only from a heading containing "objection";
// a piece with no objection still reads empty, so the "objection too thin" rail keeps failing it; composePiece and the reframe
// parse both use the finder.
// Run: node personal-companion/objection-find.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 300) : "")); } };

const shared = readFileSync(new URL("../_shared/analysis-form.js", import.meta.url), "utf8"); // EK-6: the finder lives in the shared analysis form
ok(/function afFindObjection\(md\) \{/.test(shared) && /function findObjection\(md\) \{ return afFindObjection\(md\); \}/.test(src), "the shared finder is present and the worker delegates to it");
const NL = "\n";
const findObjection = new Function(shared + "; return afFindObjection;")();

// 1. the classic heading still works
const classic = "Lede.\n\n## The objection\n\nA careful reader might say the count itself was disputed, and that this weakens the claim.\n\n## End\n\nx";
ok(/count itself was disputed/.test(findObjection(classic)), "a heading containing objection is read as before");

// 2. mid-argument, two sentences, no heading (the 04:00 UTC deepseek shape)
const mid = "Lede.\n\n## The vote\n\nThe count ran for days.\n\nThe strongest objection to this reading is that the negotiators fixed the outcome before any ballot was cast. If so, the vote ratified rather than decided.\n\n## Next\n\nMore.";
ok(/negotiators fixed the outcome/.test(findObjection(mid)), "a paragraph that raises the objection in so many words is read");

// 3. a short opener is joined with the paragraph that develops it
const opener = "Lede.\n\nThere is a counter-argument here.\n\nThe interim arrangement may have bound every party to the same cabinet whatever the count, which would make the vote decorative.\n\n## End";
const o3 = findObjection(opener);
ok(/counter-argument/.test(o3) && /decorative/.test(o3), "a short opener is joined with the paragraph that develops it", o3);

// 4. a heading that challenges the claim
const head = "Lede.\n\n## Where this could be wrong\n\nIf the interim arrangement had not bound the parties, the same count would have produced a different cabinet and the claim fails.\n\n## End\n\nx";
ok(/different cabinet/.test(findObjection(head)), "a section under a heading that challenges the claim is read");

// 5. no objection anywhere: still empty, so validatePiece keeps failing "objection too thin"
const none = "Lede.\n\n## History\n\nThe war against the state ended in 1994 and the sides talked.\n\n## Results\n\nThe count was announced.";
ok(findObjection(none) === "", "a piece without an objection reads empty (plain 'against' in prose is no cue)", findObjection(none));

// 6. a too-short cue paragraph with no follower does not pass the 40-character rail
ok(findObjection("Lede.\n\nObjection noted.") === "", "a cue shorter than 40 characters is not an objection");

// 7. wiring: composePiece and parseDraftMd use the finder; the rail is unchanged
ok(/var objection = findObjection\(md\);/.test(src), "composePiece reads the objection with findObjection");
ok(/body_md: ledeObj\.rest, objection: findObjection\(md\) \};/.test(src), "the reframe parse reads the objection with findObjection");
ok(/problems\.push\("objection too thin"\)/.test(src), "the objection-too-thin rail still exists");

// 8. LIKE-PATTERN-50-1: the duplicate-opening key stays under D1's 50-byte LIKE pattern limit
const km = src.match(/var openKey = [^\n]*\.slice\(0, (\d+)\);/);
ok(km && Number(km[1]) + 1 <= 50, "the duplicate-opening LIKE pattern (key plus %) is at most 50 bytes", km && km[1]);

const ver = (src.match(/var VERSION = "(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
ok(ver.length === 3 && (ver[0] > 1 || (ver[0] === 1 && (ver[1] > 25 || (ver[1] === 25 && ver[2] >= 3)))), "VERSION is at least 1.25.3", ver);
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
