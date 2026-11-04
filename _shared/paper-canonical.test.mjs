// PAPER-CANONICAL-1: every stored body has the new-release shape, and nothing but detritus is removed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPaper } from "./paper-format.js";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./paper-canonical.js", import.meta.url), "utf8").replace(/^export function/gm, "function");
const { canonicalPaper, canonicalBody, canonicalRefusal, canonicalLift } = new Function("formatPaper", src + "; return { canonicalPaper, canonicalBody, canonicalRefusal, canonicalLift };")(formatPaper);

const TITLE = "Quantifying Structural Unification";
const PROSE = "This work deconstructs progress in the unification of structure and measurement across scales. ";
const BODY = "## Abstract\n\n" + PROSE.repeat(3) + "\n\n## 1. Introduction\n\nBody text with $x_1^2$ and **emphasis**.\n\n## References\n\n[1] A. Author, A Journal 1 (2020).\n";
const pad = (n) => Array.from({ length: n }, (_, i) => "word" + i).join(" ");
const ABS = "We study error correction in depth and show many things about the codes that matter for readers of the journal today.";
const QT = "Quantum Error Correction: A Study";
const again = (c, rec) => assert.equal(canonicalPaper(c.body, rec).body, c.body, "idempotent");

test("the copy inlined in qnfo-research-exec (and its mirror) is this file", () => {
  for (const name of ["worker.js", "deployed-current.worker.js"]) {
    const worker = readFileSync(new URL("../qnfo-research-exec/" + name, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    assert.ok(worker.includes(src.trim().replace(/\r\n/g, "\n")), name + " carries a stale canonical formatter: run node _shared/inline-paper-canonical.mjs");
  }
});

test("front matter, byline, wrapped title and repeated title are dropped", () => {
  const input = "---\nauthor: R\ntitle: " + TITLE + "\naliases:\n  - " + TITLE + "\nmodified: 2025-06-21T03:24:20Z\n---\n\n# " + TITLE + "\n\n## " + TITLE + "\n\nAuthor: R\nAffiliation: QNFO\nEmail: r@example.org\nORCID: 0009-0002-4317-5604\nVersion: 1.0.1\nDate: 2025-09-08\n\n" + BODY;
  const c = canonicalPaper(input, { title: TITLE });
  assert.ok(c.body.startsWith("# " + TITLE + "\n\n## Abstract\n\n"), c.body.slice(0, 200));
  assert.doesNotMatch(c.body, /^---|Affiliation|ORCID|Version:|modified|aliases/m);
  assert.equal((c.body.match(new RegExp(TITLE, "g")) || []).length, 1);
  again(c, { title: TITLE });
});

test("markdown bylines with links, and a subtitle heading above them", () => {
  const input = "# EMERGENT CORRELATION\n\n## A COMPUTATIONAL PROOF-OF-PRINCIPLE\n\n**Author:** R Q\n**Contact:** r@example.org **ORCID:**\n[0009-0002-4317-5604](https://orcid.org/0009-0002-4317-5604)\n**ISNI:** [0000000526456062](https://isni.org/isni/0000000526456062)\n**URL:** https://papers.qnfo.org/papers/emergent-\ncorrelation\n\n" + BODY;
  const c = canonicalPaper(input, { title: "EMERGENT CORRELATION" });
  assert.match(c.body, /^# EMERGENT CORRELATION\n\n\*A COMPUTATIONAL PROOF-OF-PRINCIPLE\*\n\n## Abstract\n\n/);
  assert.doesNotMatch(c.body, /\*\*Author|ORCID|ISNI|isni\.org|URL:/);
  // a subtitle heading whose text starts with a digit is still a subtitle, not a numbered section
  const k = canonicalPaper("# Chiral Processing\n\n## 4-Kelvin Twistronic Architecture\n\n**Author:** R\n**Version:** 1.0\n\n" + PROSE + "\n\n## Next\n\n" + PROSE + "\n", { title: "Chiral Processing" });
  assert.match(k.body, /^# Chiral Processing\n\n\*4-Kelvin Twistronic Architecture\*\n\n/);
  assert.doesNotMatch(k.body, /Author|Version/);
});

test("Version History, Changelog, correction notices and banners go; the sections after them stay", () => {
  const input = "# " + TITLE + "\n\n> **Revised (version 1.2.0, 2026-10-01):** wording corrected.\n> second line of the banner\n\n" + BODY.replace("## References", "## Version History\n\n- Version 1.1.0 (2026-10-20, from 1.0.0): revised.\n\n### v1.0.1\n\n- fixed\n\n## Changelog\n\n- v1.2.0 fixed\n\n## Correction Notice\n\nVersion 1.0.1 corrects a wording.\n\n## References");
  const c = canonicalPaper(input, { title: TITLE });
  assert.doesNotMatch(c.body, /Version History|Changelog|Correction Notice|Revised \(version|v1\.0\.1|Version 1\.1\.0/);
  assert.match(c.body, /## 1\. Introduction\n\nBody text/);
  assert.match(c.body, /## References\n\n\[1\] A\. Author/);
  assert.equal(c.droppedHeadings, 4);
  again(c, { title: TITLE });
});

test("a history section ends at the first heading that is not history, and an unheaded tail that is not a version note stays", () => {
  const mid = "# " + QT + "\n\n## Abstract\n\n" + ABS + "\n\n## Version History\n\n- v1.0: first.\n\n### 7.1 Open Problems\n\nreal content " + pad(100) + "\n\n## References\n\n1. A.\n";
  const a = canonicalPaper(mid, { title: QT, abstract: ABS });
  assert.doesNotMatch(a.body, /Version History|v1\.0: first/);
  assert.match(a.body, /### 7\.1 Open Problems\n\nreal content/);
  assert.match(a.body, /## References/);
  const tail = "# " + QT + "\n\n## Abstract\n\n" + ABS + "\n\n## 1. Intro\n\nx " + pad(300) + "\n\n## Version History\n\n- v1: first\n\n---\n\n*Copyright notice, license text and data availability statement follows.* " + pad(60) + "\n";
  const b = canonicalPaper(tail, { title: QT, abstract: ABS });
  assert.doesNotMatch(b.body, /Version History|v1: first/);
  assert.match(b.body, /Copyright notice, license text and data availability/);
  // a Correction Notice in prose form is history; the paragraph after it that is not a version note is not
  const prose = "# " + QT + "\n\n## Abstract\n\n" + ABS + "\n\n## Correction Notice\n\nVersion 1.0.1 corrects a wording.\n\nThe measurement in section 3 was repeated twice with different results " + pad(30) + ".\n";
  const p = canonicalPaper(prose, { title: QT, abstract: ABS });
  assert.doesNotMatch(p.body, /Correction Notice|corrects a wording/);
  assert.match(p.body, /The measurement in section 3/);
});

test("genuine sections called Release Notes, What Changed or Change Log of a register are not history", () => {
  const input = "# " + QT + "\n\n## Abstract\n\n" + ABS + "\n\n## 1. Introduction\n\nIntro.\n\n## What Changed in the Hamiltonian\n\nThe Hamiltonian changed in the following way, which matters.\n\n## 5. Release Notes\n\nA genuine note on release of photons from the cavity.\n\n## 4. Change Log\n\nIn the lattice model, the change log records every state transition of the register.\n\n## Change Log\n\nThe register state changes are logged each cycle and tabulated below.\n\n## 6. Discussion\n\nOK.\n";
  const c = canonicalPaper(input, { title: QT, abstract: ABS });
  assert.equal(c.body, input);
  assert.deepEqual(c.removed, []);
});

test("a header-only title match needs near-total overlap and only a level-2 heading before the first prose", () => {
  const proof = "# " + QT + "\n\n## Abstract\n\n" + ABS + "\n\n## 1. Proof\n\n### Given\n\nx " + pad(20) + "\n\n#### Step 1: Quantum Error Correction A Study\n\nstuff " + pad(20) + "\n";
  assert.equal(canonicalPaper(proof, { title: QT, abstract: ABS }).body, proof);
  const basics = "# " + QT + "\n\n## Quantum Error Correction Basics\n\n" + pad(80) + "\n\n## Surface Codes\n\n" + pad(80) + "\n";
  assert.match(canonicalPaper(basics, { title: QT }).body, /## Quantum Error Correction Basics/);
  const sub = canonicalPaper("# Quantum Codes\n\n### Given\n\n" + pad(40) + "\n\n## 1. Intro\n\n" + pad(40) + "\n", { title: "Quantum Codes" });
  assert.match(sub.body, /### Given/);
  assert.doesNotMatch(sub.body, /\*Given\*/);
});

test("owner-written papers keep their own history section", () => {
  const input = "# " + TITLE + "\n\n" + BODY.replace("## References", "## Version History\n\n- v1.0 first.\n\n## References");
  assert.match(canonicalBody(input, { title: TITLE, identifier: "qnfo-2025-07" }), /## Version History/);
  assert.doesNotMatch(canonicalBody(input, { title: TITLE, identifier: "qnf-12" }), /## Version History/);
});

test("math, code fences and tables are untouched, even when they look like metadata or history", () => {
  const md = "# T\n\n## Abstract\n\n" + PROSE.repeat(2) + "\n\n## 1. Method\n\n```markdown\n# Example\n\n## Changelog\n\n**Author:** a literal example\n---\n```\n\n$$\nx = 1\n$$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nDate: the sentence that merely starts with a label inside the body.\n";
  const c = canonicalPaper(md, { title: "T" });
  assert.equal(c.body, md);
});

test("prose paragraphs that start with a label after the abstract survive", () => {
  const input = "# " + QT + "\n\n## Abstract\n\n" + ABS + "\n\nStatus: the codes below remain open and this sentence is real scientific prose.\n\nDate: the measurement date drifted by two hours in run 4, as reported.\n\n## 1. Intro\n\nBody.\n";
  const c = canonicalPaper(input, { title: QT, abstract: ABS });
  assert.match(c.body, /Status: the codes below remain open/);
  assert.match(c.body, /Date: the measurement date drifted/);
  assert.doesNotMatch(c.body, /⁣/);
  again(c, { title: QT, abstract: ABS });
});

test("a reference list nested under a Changelog heading survives", () => {
  const input = "# " + TITLE + "\n\n" + BODY.replace("## References", "## Changelog\n\n- v1.0.1 fixed\n\n### References");
  const c = canonicalPaper(input, { title: TITLE });
  assert.match(c.body, /### References\n\n\[1\] A\. Author/);
  assert.doesNotMatch(c.body, /Changelog|fixed/);
  assert.equal(canonicalRefusal(input, c), "");
});

test("the abstract: the record's abstract is used when the opening paragraph is an introduction", () => {
  const abstract = "Science has established a counterproductive imperative to define everything before we actually understand how the universe works, and we argue that definitions should stay provisional tools.";
  const wrapped = canonicalPaper("# T\n\n*Rowan Brad Quni, QNFO*\n\n**" + abstract + "**\n\nSecond paragraph of the introduction.\n", { title: "T", abstract });
  assert.match(wrapped.body, /^# T\n\n## Abstract\n\n/);
  assert.match(wrapped.body, new RegExp("## Abstract\\n\\n" + abstract));
  assert.doesNotMatch(wrapped.body, /Rowan/);
  again(wrapped, { title: "T", abstract });
  const real = "Surface codes protect logical qubits by measuring stabilizers; we bound the threshold under correlated noise and give a decoder with linear time complexity in the code distance.";
  const intro = "# Surface Codes Under Correlated Noise\n\nQuantum computers are fragile, and the history of the field is a long story about decoherence. In this paper we revisit the early arguments. " + pad(150) + "\n\n## 1. Background\n\nText " + pad(100) + "\n";
  const c = canonicalPaper(intro, { title: "Surface Codes Under Correlated Noise", abstract: real });
  assert.match(c.body, new RegExp("^# Surface Codes Under Correlated Noise\\n\\n## Abstract\\n\\n" + real.slice(0, 40)));
  assert.match(c.body, /Quantum computers are fragile/);
  assert.equal((c.body.match(/^## Abstract$/gm) || []).length, 1);
  again(c, { title: "Surface Codes Under Correlated Noise", abstract: real });
  // a record without a real abstract leaves the body's own opening as the abstract
  assert.match(canonicalPaper(intro, { title: "Surface Codes Under Correlated Noise", abstract: "Short." }).body, /## Abstract\n\nQuantum computers are fragile/);
});

test("keywords and a real DOI that only the header held are lifted; owner constants and junk are not", () => {
  const input = "---\ntitle: Strange Loop\n---\n\n# Strange Loop\n\n## The Strange Loop Theory\n\n**Author:** R\n**Affiliation:** QNFO **Contact:**\nr@example.org **ORCID:** 0009-0002-4317-5604\n**ISNI:** 0000 0005 2645 6062 **DOI:**\nhttps://doi.org/10.1103/PhysRevD.99.123456\n**Version:** 1.2.0\n\n**Abstract**: " + PROSE.repeat(3) + "\n\n**Keywords:** strange loop, quantization, topological\ninvariants, information stability\n\n## 1. Intro\n\nBody.\n";
  const c = canonicalPaper(input, { title: "Strange Loop" });
  assert.doesNotMatch(c.body, /Keywords|ORCID|doi\.org/);
  const lift = canonicalLift(c.fields, { keywords: null, doi: null });
  assert.deepEqual(JSON.parse(lift.keywords), ["strange loop", "quantization", "topological invariants", "information stability"]);
  assert.equal(lift.doi, "10.1103/PhysRevD.99.123456");
  assert.deepEqual(canonicalLift(c.fields, { keywords: "[\"x\"]", doi: "10.1/x" }), {});
  assert.deepEqual(canonicalLift({ doi: "https://papers.qnfo.org/papers/x/" }, {}), {});
  assert.deepEqual(canonicalLift({ doi: "10.5281/zenodo.123" }, {}), {});
  assert.equal(canonicalLift({ keywords: "[a, b; c]" }, {}).keywords, "[\"a\",\"b\",\"c\"]");
  assert.deepEqual(canonicalLift({ keywords: "x".repeat(300) }, {}), {});
});

test("refusal guards: lost words, a reference list, headings, or a history that is a large part of the paper", () => {
  const before = "# T\n\n## Abstract\n\n" + PROSE.repeat(10) + "\n\n## References\n\n[1] x\n";
  const ok = canonicalPaper(before, { title: "T" });
  assert.equal(canonicalRefusal(before, ok), "");
  assert.match(canonicalRefusal(before, { body: "# T\n\n## Abstract\n\nshort\n\n## References\n", droppedHeadings: 0 }), /words/);
  assert.match(canonicalRefusal(before, { body: "# T\n\n## Abstract\n\n" + PROSE.repeat(10) + "\n", droppedHeadings: 0 }), /reference list|headings/);
  assert.match(canonicalRefusal(before, { body: PROSE.repeat(10) + "\n## References\n## A\n## B\n", droppedHeadings: 0 }), /title/);
  const big = "# " + QT + "\n\n## Abstract\n\n" + ABS + "\n\n## 1. Intro\n\n" + pad(400) + "\n\n## Changelog\n\n" + Array.from({ length: 120 }, (_, i) => "- v1.0." + i + " fixed a thing in the paper text").join("\n") + "\n";
  const c = canonicalPaper(big, { title: QT, abstract: ABS });
  assert.ok(c.removed.includes("Changelog"));
  assert.match(canonicalRefusal(big, c), /removed history is \d+% of the body/);
});
