import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatPaper } from "../_shared/paper-format.js";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const { lpPaperHTML, handlePaperMarkdown } = await import("data:text/javascript;base64," + Buffer.from(source + "\nexport { lpPaperHTML, handlePaperMarkdown };").toString("base64"));
test("the public paper page formats before Markdown rendering and preserves the subtitle", () => {
  const start = source.indexOf("function lpPaperHTML(");
  const body = source.slice(start, source.indexOf("// ---- READER-REPORT-1:BEGIN", start));
  assert.match(body, /const formatted = formatPaper\(md, paper\)/);
  assert.ok(body.indexOf("formatPaper(md, paper)") < body.indexOf("renderMarkdown(md)"));
  assert.match(body, /formatted\.subtitle/);
  const p = formatPaper("# Truncated\n\n## Abstract\n\nTitle\n\n**Author:** Writer\n\n### ABSTRACT\n\nReal abstract.\n\n## Introduction\n\nScientific content.", { title: "Truncated Title" });
  assert.match(p.content, /^## Abstract\n\nReal abstract\./);
  assert.doesNotMatch(p.content, /Writer|Truncated|### ABSTRACT/);
  const html = lpPaperHTML({ slug: "example", title: "Truncated Title", body_md: "# Truncated\n\n## Abstract\n\nTitle\n\n**Author:** Writer\n\n### ABSTRACT\n\nReal abstract.\n\n## Introduction\n\nScientific content.", authors: '["Writer"]', version: "2.0" });
  assert.equal((html.match(/<h1>/g) || []).length, 1);
  assert.equal((html.match(/<section class="abstract"/g) || []).length, 1);
  assert.match(html, /Real abstract\./);
  assert.match(html, /Scientific content\./);
  assert.doesNotMatch(html, /\*\*Author:\*\*|### ABSTRACT|<p>Title<\/p>/);
});

test("Markdown downloads contain one title/abstract and preserve custom YAML and bylines", async () => {
  const paper = { slug: "example", title: "Complete Title", status: "published", abstract: "Stale abstract.", body_md: '---\ncustom:\n  keep: true\ntitle: Old title\n---\n\n# Complete\n\nTitle\n\n**Contact:** author@example.org\n\n**Abstract:**\n\nReal abstract.\n\n## Introduction\n\nScientific content.\n' };
  const env = { LIVING_PAPER: { prepare() { return { bind() { return { async first() { return paper; } }; } }; } } };
  const response = await handlePaperMarkdown(env, paper.slug, "papers.qnfo.org");
  const md = await response.text();
  assert.equal((md.match(/^# /gm) || []).length, 1);
  assert.equal((md.match(/^## Abstract/gm) || []).length, 1);
  assert.match(md, /custom:\n  keep: true/);
  assert.match(md, /email: "author@example.org"/);
  assert.match(md, /Real abstract\./);
  assert.doesNotMatch(md, /Stale abstract|Old title|\*\*Contact:/);
});

test("the public page repairs a split title/abstract and never renders a cached refusal", () => {
  const recordAbstract = "The universe is saturated with a chaotic ocean of energy that we call the electromagnetic spectrum. This spectrum stretches from the longest radio waves to the shortest gamma rays. Between these extremes lies a wide range of frequencies that carry information about the cosmos.";
  const body = '---\ntitle: "THE ARCHITECTURE OF"\n---\n\n# THE ARCHITECTURE OF\n\n## Abstract\n\nEXPERIENCE\n\n## Deconstructing the Interface of Perception\n\n**Author:** Research Author\n\n**Version:** 1.1.0\n\n### ABSTRACT\n\nA complete abstract.\n\n### Chapter 1\n\nScientific content.\n';
  const html = lpPaperHTML({
    slug: "architecture-of-experience",
    title: "THE ARCHITECTURE OF",
    abstract: recordAbstract,
    body_md: body,
    _article: { short: "I\u2019m sorry, but I can\u2019t rewrite that paper without the necessary details.", minutes: 2 },
    _plain: { text: "I\u2019m sorry, but I can\u2019t rewrite that paper without the necessary details." }
  });
  assert.match(html, /<h1>THE ARCHITECTURE OF EXPERIENCE<\/h1>/);
  assert.match(html, /The universe is saturated with a chaotic ocean of energy/);
  assert.doesNotMatch(html, /<p>EXPERIENCE<\/p>|Author:|Version:|I\u2019m sorry/);
});
