import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPaper } from "./paper-format.js";

const TITLE = "Algorithmic-Necessity-of-Agency";
const ABSTRACT = "This treatise presents a comprehensive theoretical synthesis\nresolving the dialectic between the subjective experience of free will\nand the objective reality of a superdeterministic universe.";
const BROKEN = "# THE ALGORITHMIC NECESSITY\n\n## Abstract\n\nOF AGENCY\n\n## A\nUnified Framework for Reconciling Quantum Superdeterminism with\nEvolutionary Neurobiology\n\n**Author:** Research Author\n\n**Contact:** [author@example.org](mailto:author@example.org)\n\n**ORCID:** 0000-0000-0000-0000\n\n**ISNI:** 1234\n\n**URL:** https://papers.qnfo.org/papers/agency/ **Date:**\n2026-03-03 **Version:** 1.0\n\n### ABSTRACT\n\n" + ABSTRACT + "\n\n### KEYWORDS\n\nAgency; Determinism.\n\n### Chapter 1: The\nPhysics of Absolute Determinism\n\n#### 1.1 Quantum\nMechanics and the Measurement Problem\n\nScientific content with $x_1^2$, **emphasis** and [1].\n";

test("reported paper: complete title, real abstract, clean metadata and joined headings", () => {
  const p = formatPaper(BROKEN, { title: TITLE });
  assert.equal(p.title, TITLE);
  assert.equal(p.subtitle, "A Unified Framework for Reconciling Quantum Superdeterminism with Evolutionary Neurobiology");
  assert.equal(p.abstract, ABSTRACT);
  assert.equal((p.content.match(/^## Abstract$/gm) || []).length, 1);
  assert.doesNotMatch(p.content, /Author:|Contact:|ORCID:|ISNI:|Version:|OF AGENCY/);
  assert.match(p.content, /### Chapter 1: The Physics of Absolute Determinism/);
  assert.match(p.content, /#### 1.1 Quantum Mechanics and the Measurement Problem/);
  assert.match(p.content, /Scientific content with \$x_1\^2\$, \*\*emphasis\*\* and \[1\]\./);
  assert.equal(p.fields.date, "2026-03-03");
  assert.equal(p.fields.version, "1.0");
  assert.match(p.body, /^---\nauthor:/);
  assert.equal(formatPaper(p.body, { title: TITLE }).body, p.body);
});

test("new-style papers, multi-paragraph abstracts and code/math/tables stay intact", () => {
  const md = "# Title\n\n## Abstract\n\nFirst prose paragraph with $x$.\n\nSecond prose paragraph.\n\n## 1. Introduction\n\n```markdown\n# Example\n\n**Author:** a literal example\n```\n\n$$\nx = 1\n$$\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n## References\n\n[1] A real source.\n";
  const p = formatPaper(md, { title: "Title" });
  assert.equal(p.body, md);
  assert.equal(p.abstract, "First prose paragraph with $x$.\n\nSecond prose paragraph.");
  assert.equal(formatPaper(p.body, { title: "Title" }).body, p.body);
});

test("front matter and inline abstract are retained without printing metadata", () => {
  const md = '---\ntitle: "Correct title"\ncustom: "Keep me"\nabstract: >\n  A complete abstract stored in the original front matter.\n---\n\n# Short\n\n**Author:** Writer\n\n## 1. Introduction\n\nBody.\n';
  const p = formatPaper(md, {});
  assert.equal(p.title, "Correct title");
  assert.match(p.body, /custom: "Keep me"/);
  assert.match(p.body, /author: "Writer"/);
  assert.match(p.content, /^## Abstract\n\nA complete abstract/);
  assert.equal(formatPaper(p.body, {}).body, p.body);
  const inline = formatPaper("# Title\n\n**Abstract**: This is the real abstract.\n\n## Introduction\n\nBody.", { title: "Title" });
  assert.equal(inline.abstract, "This is the real abstract.");
});

test("a title continuation accidentally filed as the abstract is recovered from the record", () => {
  const recordAbstract = "The universe is saturated with a chaotic ocean of energy that we call the electromagnetic spectrum. This spectrum stretches from the longest radio waves to the shortest gamma rays. Between these extremes lies a wide range of frequencies that carry information about the cosmos.";
  const source = '---\ntitle: "THE ARCHITECTURE OF"\n---\n\n# THE ARCHITECTURE OF\n\n## Abstract\n\nEXPERIENCE\n\n## Deconstructing the Interface of Perception\n\n**Author:** Research Author\n\n**Version:** 1.1.0\n\n### ABSTRACT\n\nA complete abstract.\n\n### Chapter 1\n\nScientific content.\n';
  const record = { title: "THE ARCHITECTURE OF", abstract: recordAbstract };
  const paper = formatPaper(source, record);
  assert.equal(paper.title, "THE ARCHITECTURE OF EXPERIENCE");
  assert.equal(paper.abstract, recordAbstract);
  assert.match(paper.body, /^---\ntitle: "THE ARCHITECTURE OF EXPERIENCE"/);
  assert.match(paper.content, /^## Abstract\n\nThe universe is saturated/);
  assert.doesNotMatch(paper.content, /^EXPERIENCE$|Author:|Version:/m);
  assert.equal(formatPaper(paper.body, record).body, paper.body);
});

export { TITLE, ABSTRACT, BROKEN };

test("bold abstract labels and title-like scientific sections retain their boundaries", () => {
  for (const label of ["**Abstract:**", "**Abstract**:", "Abstract:"]) {
    const p = formatPaper("# Energy Floor Of The Controller\n\n" + label + "\n\nA real abstract.\n\n## The energy floor\n\nScientific content.\n", { title: "Energy Floor Of The Controller" });
    assert.equal(p.abstract, "A real abstract.");
    assert.match(p.content, /## The energy floor\n\nScientific content\./);
    assert.equal(formatPaper(p.body, { title: p.title }).body, p.body);
  }
});

test("inline emphasis in a legacy title is not stripped on successive sweeps", () => {
  const md = "## Defining Reality\n***Our Human Quest***\n\n*Author, Institution*\n\nScientific text.\n";
  const p = formatPaper(md, {});
  assert.match(p.title, /\*\*\*Our Human Quest\*\*\*/);
  assert.equal(formatPaper(p.body, {}).body, p.body);
});

test("existing metadata keys are compared literally and case-insensitively", () => {
  const md = "---\nDC.Rights: \"Kept\"\nauthor: Writer\n---\n\n# Title\n\n## Abstract\n\nThe real abstract.\n";
  const p = formatPaper(md, {});
  assert.equal((p.body.match(/dc\.rights:/gi) || []).length, 1);
  assert.equal(formatPaper(p.body, {}).body, p.body);
});
