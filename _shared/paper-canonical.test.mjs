// PAPER-CANONICAL-1: every stored body has the new-release shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPaper } from "./paper-format.js";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./paper-canonical.js", import.meta.url), "utf8").replace(/^export function/gm, "function");
const { canonicalPaper, canonicalBody, canonicalRefusal } = new Function("formatPaper", src + "; return { canonicalPaper, canonicalBody, canonicalRefusal };")(formatPaper);

const TITLE = "Quantifying Structural Unification";
const PROSE = "This work deconstructs progress in the unification of structure and measurement across scales. ";
const BODY = "## Abstract\n\n" + PROSE.repeat(3) + "\n\n## 1. Introduction\n\nBody text with $x_1^2$ and **emphasis**.\n\n## References\n\n[1] A. Author, A Journal 1 (2020).\n";

test("front matter, byline, wrapped title and repeated title are dropped", () => {
  const input = "---\nauthor: R\ntitle: " + TITLE + "\naliases:\n  - " + TITLE + "\nmodified: 2025-06-21T03:24:20Z\n---\n\n# " + TITLE + "\n\n## " + TITLE + "\n\nAuthor: R\nAffiliation: QNFO\nEmail: r@example.org\nORCID: 0009-0002-4317-5604\nVersion: 1.0.1\nDate: 2025-09-08\n\n" + BODY;
  const c = canonicalPaper(input, { title: TITLE });
  assert.ok(c.body.startsWith("# " + TITLE + "\n\n## Abstract\n\n"), c.body.slice(0, 200));
  assert.doesNotMatch(c.body, /^---|Affiliation|ORCID|Version:|modified|aliases/m);
  assert.equal((c.body.match(new RegExp(TITLE, "g")) || []).length, 1);
  assert.equal(canonicalPaper(c.body, { title: TITLE }).body, c.body, "idempotent");
});

test("markdown bylines with links, and a subtitle heading above them", () => {
  const input = "# EMERGENT CORRELATION\n\n## A COMPUTATIONAL PROOF-OF-PRINCIPLE\n\n**Author:** R Q\n**Contact:** r@example.org **ORCID:**\n[0009-0002-4317-5604](https://orcid.org/0009-0002-4317-5604)\n**ISNI:** [0000000526456062](https://isni.org/isni/0000000526456062)\n**URL:** https://papers.qnfo.org/papers/emergent-\ncorrelation\n\n" + BODY;
  const c = canonicalPaper(input, { title: "EMERGENT CORRELATION" });
  assert.match(c.body, /^# EMERGENT CORRELATION\n\n\*A COMPUTATIONAL PROOF-OF-PRINCIPLE\*\n\n## Abstract\n\n/);
  assert.doesNotMatch(c.body, /\*\*Author|ORCID|ISNI|isni\.org|URL:/);
});

test("Version History, Changelog, correction sections and revision banners go; sections after them stay", () => {
  const input = "# " + TITLE + "\n\n> **Revised (version 1.2.0, 2026-10-01):** wording corrected.\n> second line of the banner\n\n" + BODY.replace("## References", "## Version History\n\n- Version 1.1.0 (2026-10-20, from 1.0.0): revised.\n\n### Details\n\nmore\n\n## Changelog\n\n- fixed\n\n## Correction Notice\n\ntext\n\n## References") ;
  const c = canonicalPaper(input, { title: TITLE });
  assert.doesNotMatch(c.body, /Version History|Changelog|Correction Notice|Revised \(version|Details|Version 1\.1\.0/);
  assert.match(c.body, /## 1\. Introduction\n\nBody text/);
  assert.match(c.body, /## References\n\n\[1\] A\. Author/);
  assert.equal(c.droppedHeadings, 4);
  assert.equal(canonicalPaper(c.body, { title: TITLE }).body, c.body);
});

test("a reference list nested under a Changelog heading survives", () => {
  const input = "# " + TITLE + "\n\n" + BODY.replace("## References", "## Changelog\n\n- fixed\n\n### References");
  const c = canonicalPaper(input, { title: TITLE });
  assert.match(c.body, /### References\n\n\[1\] A\. Author/);
  assert.doesNotMatch(c.body, /Changelog|fixed/);
  assert.equal(canonicalRefusal(input, c), "");
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

test("the abstract heading is added only when the opening paragraph is the record's abstract", () => {
  const abstract = "Science has established a counterproductive imperative to define everything before we actually understand how the universe works.";
  const input = "# T\n\n*Rowan Brad Quni, QNFO*\n\n**" + abstract + "**\n\nSecond paragraph of the introduction.\n";
  const c = canonicalPaper(input, { title: "T", abstract });
  assert.match(c.body, /^# T\n\n## Abstract\n\n/);
  assert.match(c.body, new RegExp("## Abstract\\n\\n" + abstract));
  assert.doesNotMatch(c.body, /Rowan/);
  const none = canonicalPaper("# T\n\n**Unrelated opening.**\n\nMore.\n", { title: "T", abstract });
  assert.doesNotMatch(none.body, /## Abstract/);
});

test("refusal guards: a body that lost words, a reference list or headings is never written", () => {
  const before = "# T\n\n## Abstract\n\n" + PROSE.repeat(10) + "\n\n## References\n\n[1] x\n";
  const ok = canonicalPaper(before, { title: "T" });
  assert.equal(canonicalRefusal(before, ok), "");
  assert.match(canonicalRefusal(before, { body: "# T\n\n## Abstract\n\nshort\n\n## References\n", droppedHeadings: 0 }), /words/);
  assert.match(canonicalRefusal(before, { body: "# T\n\n## Abstract\n\n" + PROSE.repeat(10) + "\n", droppedHeadings: 0 }), /reference list|headings/);
  assert.match(canonicalRefusal(before, { body: PROSE.repeat(10) + "\n## References\n## A\n## B\n", droppedHeadings: 0 }), /title/);
});
