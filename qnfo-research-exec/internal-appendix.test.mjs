// PUB-ARTIFACT-SOURCE-1 (qnfo-research-exec 0.36.1, 2026-10-26, charter pillar research; agent_issues 1000282) offline suite. Run: node qnfo-research-exec/internal-appendix.test.mjs
// The RECONCILE prompt required "## Appendix A. Divergence report" and "## Appendix B. Claim attribution" as final headings although the run already records the divergence report in R2; 164 published
// papers leaked the two sections (the hourly gate flagged them quality:internal-artifact). Now the prompt no longer asks for them and a deterministic strip removes either section from the reconciled
// text, the text the complete stage reads, the draft row and a version-queue body before anything is published; the reader-facing changelog stops listing them.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
const mod = await import("data:text/javascript;base64," + Buffer.from(src + "\nexport { stripInternalAppendices as __strip, RECONCILE_PROMPT as __prompt, rlChangeSummary as __summary, rlSections as __sections, VERSION as __version };\n").toString("base64"));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 500) : "")); } };
const strip = mod.__strip;

const main = "# A Paper\n\n## Abstract\n\nWe bound the carry depth.\n\n## 1. Introduction\n\nCarry depth limits adders.\n\n## 8. Conclusion\n\nThe bound is tight.\n\n## References\n\n[1] A. Author, A title, 2020.\n";
const appA = "\n## Appendix A. Divergence report\n\nDraft A took convention X; draft B took convention Y.\n\n### A.1 Conventions\n\nDetails.\n";
const appB = "\n## Appendix B. Claim attribution\n\n| claim | drafts | status |\n|---|---|---|\n| C1 | A, B | CONVERGENT |\n";

{ // the shape of the 164 leaked papers: both appendices after the References
  const leaked = main + appA + appB;
  const out = strip(leaked);
  ok(out === main, "both trailing appendices are removed and the paper is otherwise byte for byte as it was", { out: out.slice(-120) });
  ok(!/Appendix/i.test(out) && /## References\n\n\[1\] A\. Author/.test(out), "no appendix heading is left and the References stay");
  ok(strip(out) === out, "the strip is idempotent");
}
{ // an appendix that is not the last section: only that section goes
  const mid = "# T\n\n## 1. Introduction\n\nIntro.\n" + appA + "\n## 8. Conclusion\n\nDone.\n\n## References\n\n[1] R.\n";
  const out = strip(mid);
  ok(!/Appendix A/.test(out) && /## 8\. Conclusion\n\nDone\./.test(out) && /## References\n\n\[1\] R\./.test(out), "an appendix before the Conclusion is removed without taking the Conclusion or the References", out);
}
{ // heading variants
  for (const head of ["## Appendix A: Divergence Report", "## Appendix A - Divergence report", "## Appendix A – Divergences", "## Appendix B. Claim table", "## Appendix B) Claim attribution (C1..Cn)", "##   Appendix B.  Claim Attribution"]) {
    const out = strip(main + "\n" + head + "\n\nbody of it\n");
    ok(out === main, "variant removed: " + head, out.slice(-80));
  }
}
{ // real appendices are left alone
  for (const keep of ["## Appendix C. Extended derivations", "## Appendix A. Proof of Lemma 2", "## Appendix B. Data tables", "## Appendices", "### Appendix A. Divergence report"]) {
    const text = main + "\n" + keep + "\n\nbody\n";
    ok(strip(text) === text, "left alone: " + keep);
  }
}
{ // a clean paper comes back as the same string; odd inputs are safe
  ok(strip(main) === main, "a paper without appendices is returned unchanged");
  ok(strip(null) === "" && strip(undefined) === "" && strip("") === "", "null, undefined and empty give an empty string");
  const crlf = (main + appA).replace(/\n/g, "\r\n");
  ok(!/Appendix A/.test(strip(crlf)), "Windows line endings are handled");
}

// the prompt no longer asks for the appendices
const prompt = String(mod.__prompt);
ok(prompt.includes("PUB-ARTIFACT-SOURCE-1"), "the RECONCILE prompt carries the marker");
ok(!/Appendix A\. Divergence report'/.test(prompt) && !/Appendix B: the claim table/.test(prompt) && !/'## Appendix B\. Claim attribution'/.test(prompt), "the prompt no longer requires either appendix heading");
ok(/'## References'\. The paper ends with the References/.test(prompt), "the required heading list ends at References");
ok(/write no Appendix A or Appendix B/.test(prompt) && /name the drafts A, B and C nowhere in the paper/.test(prompt), "the editor is told to write no appendix and to name no draft");
ok(/A section headed 'Appendix A' or 'Appendix B' that reports the divergence[^"]*= HARD/.test(src), "the review treats such an appendix as a HARD internal artifact");

// the changelog stops listing them
const clean = main;
const withApp = main + appA + appB;
const sum = mod.__summary(clean, withApp);
ok(!/Appendix/i.test(sum), "the reader-facing change summary does not list the appendices as new sections", sum);
ok(/Appendix C/.test(mod.__summary(clean, main + "\n## Appendix C. Derivations\n\nx\n")), "a real new appendix is still listed", mod.__summary(clean, main + "\n## Appendix C. Derivations\n\nx\n"));
ok(!mod.__sections(withApp).some((h) => /Divergence|Claim attribution/i.test(h)), "rlSections skips the internal appendices");

// wiring: every place the text passes before publication
const calls = (src.match(/stripInternalAppendices\(/g) || []).length;
ok(calls >= 5, "stripInternalAppendices is defined once and called at the reconcile, complete, draft-row and version-queue boundaries", calls);
ok(/_stripped = stripInternalAppendices\(finalText\)/.test(src) && /var _noApp = stripInternalAppendices\(paper\)/.test(src) && /const rawBody = stripInternalAppendices\(String\(md\)\.trim\(\)\)\.trim\(\)/.test(src) && /const body = canonicalBody\(rawBody, \{ title \}\)\.trim\(\)/.test(src) && /row\.corrected_md = stripInternalAppendices\(String\(row\.corrected_md\)\)/.test(src), "the four call sites are in place before layout normalization");
const sourceVersion = /var VERSION = "([^"]+)"/.exec(src)?.[1];
ok(/var VERSION = "([^"]+)"/.exec(mirror)?.[1] === sourceVersion, "the Wrangler-built deploy mirror carries the source VERSION");
ok(mirror.includes("function stripInternalAppendices") && mirror.includes("name the drafts A, B and C nowhere"), "the built deploy mirror includes the appendix strip and prompt safeguards");
const ver = String(mod.__version).split(/[.-]/).map(Number);
ok(ver[0] === 0 && (ver[1] > 36 || (ver[1] === 36 && ver[2] >= 1)), "VERSION is at least 0.36.1", mod.__version);
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
