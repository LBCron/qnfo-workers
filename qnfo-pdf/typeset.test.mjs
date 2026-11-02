// TYPESET-PRO-1 (1.5.0, 2026-10-18): the paper PDF carries a real title block (authors, affiliations,
// identifiers) and a resolved bibliography. These tests pin the behaviour that made the old PDF unusable as
// a citable artifact: `[@key]` printed as raw keys, an empty "References" heading, the author/orcid/DOI
// columns never reaching the page, and an in-body byline block printed as prose.
//
// The renderer is read out of worker.js between its markers and evaluated with a KaTeX stub, so the suite
// runs on the same inlined copy that ships and needs no bundle dependency (the deploy gate installs none).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const workerSrc = readFileSync(join(here, "worker.js"), "utf8");

const RENDERER_MARK = "// renderer.js";
const WORKER_MARK = "// worker.js";
const start = workerSrc.indexOf(RENDERER_MARK);
const end = workerSrc.indexOf(WORKER_MARK);
assert.ok(start > 0 && end > start, "worker.js carries the renderer region between its markers");
const region = workerSrc.slice(start + RENDERER_MARK.length, end);

// a KaTeX stand-in: the tests assert structure and text, not glyph metrics
const katexStub = {
  renderToString: function (tex) {
    return '<span class="katex-stub">' + String(tex) + "</span>";
  }
};

const R = new Function(
  "katex",
  region +
    "\nreturn { RENDERER_VERSION, parseBibTeX, decodeLatex, formatNames, formatBibEntry, scanCitations," +
    " parseBodyReferences, buildPrintTemplates, buildMeta, extractBylineBlock, renderPaperHTML, renderFullHTML };"
)(katexStub);

const { RENDERER_VERSION, parseBibTeX, decodeLatex, formatNames, scanCitations, parseBodyReferences, buildPrintTemplates, extractBylineBlock, renderPaperHTML, renderFullHTML } = R;

const BIB = [
  "@article{ostrowski1916,",
  "  author  = {Alexander Ostrowski},",
  "  title   = {{\\\"U}ber einige L{\\\"o}sungen der Funktionalgleichung},",
  "  journal = {Acta Mathematica},",
  "  volume  = {41},",
  "  pages   = {271--284},",
  "  year    = {1916}",
  "}",
  "",
  "@book{conway1976,",
  "  author    = {John H. Conway},",
  "  title     = {On Numbers and Games},",
  "  publisher = {Academic Press},",
  "  address   = {London},",
  "  year      = {1976}",
  "}",
  "",
  "@misc{tateadelic,",
  "  author       = {Rowan Brad Quni-Gudzinas},",
  "  title        = {Tate's Thesis as a Template for Adelic Quantum Mechanics},",
  "  howpublished = {10.5281/x.21600741},",
  "  year         = {2026}",
  "}",
  ""
].join("\n");

const MD = [
  "---",
  'title: "Completeness Senses and the Levi-Civita Field"',
  'author: "Rowan Brad Quni-Gudzinas"',
  'date: "2026-08-26"',
  'version: "1.1.1"',
  'license: "QNFO-ULA-2.1"',
  "---",
  "",
  "# Completeness Senses and the Levi-Civita Field",
  "",
  "Ostrowski classifies every absolute value on the rationals [@ostrowski1916] and the reals follow from it [@conway1976; @tateadelic].",
  "",
  "## 1. Scope",
  "",
  "A second passage cites the same pair again [@conway1976; @tateadelic].",
  "",
  "## References",
  ""
].join("\n");

const META = {
  slug: "completeness-senses-levi-civita",
  authors: JSON.stringify(["Rowan Brad Quni-Gudzinas"]),
  identifier: "10.5281/x.22109086",
  license: "QNFO-ULA-2.1",
  published: "2026-08-26",
  version: "1.1.1",
  keywords: JSON.stringify(["Ostrowski theorem", "Levi-Civita field"]),
  quality_label: "High-quality scholarly research",
  quality_basis: "QNFO publisher classification for open-access, versioned research with a public revision history and reader correction channel; this is not a claim of independent peer review.",
  peer_review_status: "Not independently peer-reviewed",
  quality_evidence_url: "https://qnfo.org/about",
  quality_tags: JSON.stringify(["High-quality scholarly research", "open-access scholarly work", "versioned research publication"]),
  categories: JSON.stringify(["mathematics"])
};

function render(md, meta, bibtex) {
  return renderPaperHTML(md || MD, { meta: meta === undefined ? META : meta, bibtex: bibtex === undefined ? BIB : bibtex });
}

test("BibTeX parses every entry, keeps braced fields intact and decodes LaTeX accents", () => {
  const bib = parseBibTeX(BIB);
  assert.equal(bib.size, 3);
  assert.deepEqual(Array.from(bib.keys()), ["ostrowski1916", "conway1976", "tateadelic"]);
  assert.equal(bib.get("ostrowski1916").fields.journal, "Acta Mathematica");
  assert.match(bib.get("ostrowski1916").fields.title, /\\"U/);
  assert.equal(decodeLatex('{\\"U}ber L{\\"o}sungen'), "Über Lösungen");
  assert.equal(decodeLatex("271--284"), "271–284");
  assert.equal(decodeLatex("$0.999\\ldots$"), "$0.999\\ldots$", "math survives decoding for the typesetter");
});

test("author lists become numeric-style name strings", () => {
  assert.equal(formatNames("Alexander Ostrowski"), "A. Ostrowski");
  assert.equal(formatNames("Karin Usadi Katz and Mikhail G. Katz"), "K. U. Katz, M. G. Katz");
  assert.equal(formatNames("Khodr Shamseddine and others"), "K. Shamseddine, et al.");
});

test("citations are numbered in order of first appearance and a repeat citation reuses the number", () => {
  assert.deepEqual(scanCitations(MD), ["ostrowski1916", "conway1976", "tateadelic"]);
  const r = render();
  assert.equal(r.stats.citations, 3);
  assert.equal(r.stats.references, 3);
  assert.equal(r.stats.unresolved.length, 0);
  assert.match(r.bodyHtml, /href="#ref-1">\[1\]</);
  assert.match(r.bodyHtml, /href="#ref-2">\[2, 3\]</);
  assert.ok(!/\[@/.test(r.bodyHtml), "no raw [@key] marker may reach the page");
});

test("the reference list carries the full entry: authors, title, venue, volume, pages, year", () => {
  const r = render();
  const text = r.refsHtml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
  assert.match(text, /A\. Ostrowski\./);
  assert.match(text, /Über einige Lösungen/);
  assert.match(text, /Acta Mathematica, vol\. 41, pp\. 271–284, 1916/);
  assert.match(text, /J\. H\. Conway\. On Numbers and Games\. London: Academic Press, 1976\./);
  assert.match(r.refsHtml, /doi:<a href="https:\/\/doi\.org\/10\.5281\/x\.21600741">/);
  assert.match(r.refsHtml, /class="ref-num">\[1\]</);
  assert.ok(!/\\"|\{\}|--/.test(text), "no raw LaTeX survives into the reference text");
});

test("the title block carries author, affiliations, ORCID, DOI, licence, keywords and subjects", () => {
  const meta = Object.assign({}, META, {
    affiliations: JSON.stringify(["QNFO Research", "Independent"]),
    orcid: "0009-0002-4317-5604"
  });
  const r = render(null, meta);
  assert.match(r.front, /class="paper-title"/);
  assert.match(r.front, /Rowan Brad Quni-Gudzinas<sup>1<\/sup>/);
  assert.match(r.front, /class="affiliation"><sup>1<\/sup>QNFO Research</);
  assert.match(r.front, /class="affiliation"><sup>2<\/sup>Independent</);
  assert.match(r.front, /https:\/\/orcid\.org\/0009-0002-4317-5604/);
  assert.match(r.front, /https:\/\/doi\.org\/10\.5281\/x\.22109086/);
  assert.match(r.front, /QNFO-ULA-2\.1/);
  assert.match(r.front, /Ostrowski theorem/);
  assert.match(r.front, /mathematics/);
  assert.match(r.front, /Publisher classification/);
  assert.match(r.front, /High-quality scholarly research/);
  assert.match(r.front, /Not independently peer-reviewed/);
  assert.match(r.front, /not a claim of independent peer review/);
  assert.match(r.front, /Cite as/);
  assert.match(r.front, /August 26, 2026/);
});

test("PDF HTML exposes publisher classification to crawlers without implying independent review", () => {
  const html = renderFullHTML(MD, { meta: META, bibtex: BIB });
  assert.match(html, /<meta name="qnfo:quality-label" content="High-quality scholarly research">/);
  assert.match(html, /<meta name="qnfo:peer-review-status" content="Not independently peer-reviewed">/);
  assert.match(html, /<meta name="citation_keywords" content="High-quality scholarly research">/);
  const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(jsonLd, "the PDF render has ScholarlyArticle JSON-LD");
  const article = JSON.parse(jsonLd[1]);
  assert.equal(article["@type"], "ScholarlyArticle");
  assert.equal(article.genre, "High-quality scholarly research");
  assert.equal(article.additionalProperty[1].value, "Not independently peer-reviewed");
});

test("an in-body byline block is lifted into the title block and removed from the prose", () => {
  const body = "## A Geometric Unification Framework\n\nAuthor: Rowan Brad Quni-Gudzinas\nAffiliation: QNFO\nEmail: rowan.quni@qnfo.org\nORCID: 0009-0002-4317-5604\nISNI: 0000000526456062\nVersion: 1.0.1\nDate: 2025-09-08\n\nhttps://papers.qnfo.org/papers\n\nThe pursuit of a theory of everything.";
  const lifted = extractBylineBlock(body);
  assert.equal(lifted.fields.author, "Rowan Brad Quni-Gudzinas");
  assert.equal(lifted.fields.affiliation, "QNFO");
  assert.ok(!/Author: Rowan/.test(lifted.body), "the byline lines leave the body");
  assert.match(lifted.body, /A Geometric Unification Framework/, "the section heading stays");
  const r = renderPaperHTML(body, {});
  assert.deepEqual(r.authors, ["Rowan Brad Quni-Gudzinas"]);
  assert.deepEqual(r.affiliations, ["QNFO"]);
  assert.match(r.front, /rowan\.quni@qnfo\.org/);
  assert.match(r.front, /0009-0002-4317-5604/);
  assert.ok(!/Author: Rowan/.test(r.bodyHtml), "the byline is not printed as a body paragraph");
});

test("an empty trailing References heading is replaced by the generated list, never printed bare", () => {
  const r = render();
  assert.equal((r.bodyHtml.match(/>References</g) || []).length, 0, "the body keeps no stray heading");
  assert.match(r.refsHtml, /<h2 class="refs-h">References<\/h2>/);
  const bare = render(MD, META, "");
  assert.equal(bare.stats.references, 0);
  assert.ok(!/>References</.test(bare.bodyHtml), "no empty References heading without a bibliography");
});

test("an unknown key is flagged when a bibliography exists, and counted either way", () => {
  const md = MD.replace("## References", "Uncited claim [@ghost2020].\n\n## References");
  // with a bibliography present an unmatched key is a real defect and is marked
  const withBib = render(md, META, BIB);
  assert.ok(withBib.stats.unresolved.indexOf("ghost2020") >= 0);
  assert.match(withBib.bodyHtml, /cite-missing[^>]*>\[ghost2020\]</);
  // with no bibliography at all there is nothing to be missing: the key prints plainly, still counted
  const without = render(md, META, "");
  assert.equal(without.stats.references, 0);
  assert.ok(without.stats.unresolved.indexOf("ghost2020") >= 0);
  assert.match(without.bodyHtml, /class="cite">\[ghost2020\]</);
});

test("a citation wrapped across a source line break still becomes a number, not literal text", () => {
  const md = MD.replace(
    "and the reals follow from it [@conway1976; @tateadelic].",
    "and the reals follow from it [@conway1976;\n@tateadelic]."
  );
  const r = render(md);
  assert.ok(!/\[@/.test(r.bodyHtml), "a wrapped marker must not survive as raw text");
  assert.match(r.bodyHtml, /href="#ref-2">\[2, 3\]</);
  assert.equal(r.stats.references, 3);
});

test("a paper whose bibliography lives in its own numbered list is resolved, and the key annotation is stripped", () => {
  const body = [
    "---",
    'title: "Adelic Synthesis"',
    "---",
    "",
    "Kauffman built the invariant [@Kauffman1991] on Spencer-Brown's calculus [@SpencerBrown1969], with Kitaev's anyons [@Kitaev2003].",
    "",
    "## References",
    "",
    "1. Kauffman, L.H. (1991). *Knots and Physics*. World Scientific. [@Kauffman1991]",
    "2. Spencer-Brown, G. (1969). *Laws of Form*. Allen & Unwin. [@SpencerBrown1969]",
    "3. Kitaev, A.Y. (2003). Fault-tolerant quantum computation by anyons. *Annals of Physics*. [@Kitaev2003]",
    "",
    "---",
    "",
    "*Colophon that must survive.*"
  ].join("\n");
  const parsed = parseBodyReferences(body);
  assert.ok(parsed, "the numbered list is recognised");
  assert.equal(parsed.entries.length, 3);
  assert.equal(parsed.entries[0].key, "Kauffman1991");
  assert.ok(!/\[@/.test(parsed.entries[0].text), "the key annotation is removed from the entry text");

  const r = renderPaperHTML(body, {});
  assert.equal(r.stats.references, 3);
  assert.equal(r.stats.unresolved.length, 0);
  assert.match(r.bodyHtml, /href="#ref-1">\[1\]</);
  assert.match(r.bodyHtml, /href="#ref-3">\[3\]</);
  assert.match(r.refsHtml, /Knots and Physics/);
  assert.ok(!/\[@/.test(r.refsHtml), "no key annotation is printed in the reference list");
  assert.match(r.bodyHtml, /Colophon that must survive/, "content after the reference list is kept");
  assert.equal((r.bodyHtml.match(/>References</g) || []).length, 0, "the list is not printed twice");
});

test("an unresolved key with no bibliography at all prints plainly instead of as an error", () => {
  const body = ["---", 'title: "No List"', "---", "", "A claim [@Arute2019] with no reference list anywhere."].join("\n");
  const r = renderPaperHTML(body, {});
  assert.equal(r.stats.references, 0);
  assert.ok(r.stats.unresolved.indexOf("Arute2019") >= 0, "the unresolved key is still counted");
  assert.ok(!/cite-missing/.test(r.bodyHtml), "nothing is flagged as missing when the paper carries no bibliography");
  assert.match(r.bodyHtml, /class="cite">\[Arute2019\]</);
});

test("an unkeyed reference list is still typeset as a bibliography", () => {
  const body = [
    "---",
    'title: "Unkeyed"',
    "---",
    "",
    "A body paragraph with no citation markers at all, followed by the paper's own list.",
    "",
    "## References",
    "",
    "1. Ostrowski, A. (1918). Über einige Lösungen der Funktionalgleichung. *Acta Math*. 41:271-284.",
    "2. Robinson, A. (1966). *Non-standard Analysis*. North-Holland.",
    "3. Conway, J.H. (1976). *On Numbers and Games*. Academic Press."
  ].join("\n");
  const r = renderPaperHTML(body, {});
  assert.equal(r.stats.references, 3, "the list is recognised without keys");
  assert.match(r.refsHtml, /<h2 class="refs-h">References<\/h2>/);
  assert.match(r.refsHtml, /Acta Math/);
  assert.equal((r.bodyHtml.match(/>References</g) || []).length, 0, "not printed twice");
});

test("a numbered list that only follows a References heading is not turned into a bibliography", () => {
  const body = [
    "---",
    'title: "Checklist"',
    "---",
    "",
    "Some prose.",
    "",
    "## References",
    "",
    "1. Run the separator sweep.",
    "2. Re-check the figure captions.",
    "3. File the follow-up."
  ].join("\n");
  const r = renderPaperHTML(body, {});
  assert.equal(r.stats.references, 0, "no year and no DOI: not a bibliography");
  assert.match(r.bodyHtml, /Run the separator sweep/, "the text is still on the page");
});

test("a body H1 that repeats the title is dropped (title appears once)", () => {
  const r = render();
  assert.equal((r.front.match(/class="paper-title"/g) || []).length, 1, "one title heading");
  assert.ok(!/<h1[ >]/.test(r.bodyHtml), "the body carries no H1 of its own");
});

test("the print header and footer carry the short title, the author, the DOI and page x / y", () => {
  const tpl = buildPrintTemplates({ title: "Completeness Senses and the Levi-Civita Field", authors: "Rowan Brad Quni-Gudzinas", doi: "10.5281/x.22109086", license: "QNFO-ULA-2.1" });
  assert.match(tpl.headerTemplate, /Completeness Senses/);
  assert.match(tpl.headerTemplate, /Rowan Brad Quni-Gudzinas/);
  assert.match(tpl.footerTemplate, /class="pageNumber"/);
  assert.match(tpl.footerTemplate, /class="totalPages"/);
  assert.match(tpl.footerTemplate, /doi:10\.5281\/x\.22109086/);
  const long = buildPrintTemplates({ title: "x".repeat(200) });
  assert.match(long.headerTemplate, /…/);
});

test("worker.js turns the header/footer on and files the D1 record into the render", () => {
  assert.match(workerSrc, /displayHeaderFooter: true/, "the templates must reach the PDF");
  assert.match(workerSrc, /preferCSSPageSize: true/);
  assert.match(workerSrc, /const tpl = buildPrintTemplates\(/);
  // metadata plumbing: the row feeds the renderer, and the bibliography comes from R2 beside the markdown
  assert.match(workerSrc, /function buildPaperMeta\(row\)/);
  assert.match(workerSrc, /async function loadBib\(env, meta\)/);
  assert.match(workerSrc, /references\.bib/);
  assert.match(workerSrc, /bibtex: bib/);
  assert.match(workerSrc, /meta: meta/);
  // and the back catalogue is stamp-aware, so a typesetting change reaches stored PDFs
  assert.match(workerSrc, /customMetadata/);
  assert.match(workerSrc, /rendererVersion: RENDERER_VERSION/);
});

test("the rendered page is UTF-8 clean (no mojibake) and declares citation metadata", () => {
  const html = renderFullHTML(MD, { meta: META, bibtex: BIB });
  assert.ok(!/â€|Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]/.test(html), "no double-encoded characters");
  assert.match(html, /<meta name="citation_title" content="Completeness Senses and the Levi-Civita Field">/);
  assert.match(html, /<meta name="citation_author" content="Rowan Brad Quni-Gudzinas">/);
  assert.match(html, /<meta name="citation_doi" content="10\.5281\/x\.22109086">/);
  assert.match(html, /@page \{ size: A4/);
  assert.ok(!/\[@/.test(html), "no raw citation marker anywhere in the page, including the description tag");
});

test("the renderer declares its version and the worker names it", () => {
  assert.match(RENDERER_VERSION, /^\d+\.\d+\.\d+/);
  assert.ok(workerSrc.indexOf("renderer: RENDERER_VERSION") > 0);
});

test("revised split title, subtitle, separated byline and real abstract render only once", () => {
  const md = "# THE ALGORITHMIC NECESSITY\n\n## Abstract\n\nOF AGENCY\n\n## A\nUnified Framework\n\n**Author:** Writer\n\n**Contact:** [writer@example.org](mailto:writer@example.org)\n\n**ORCID:** 0000-0000-0000-0000\n\n### ABSTRACT\n\nThis is the actual abstract with $x^2$.\n\n### Chapter 1: The\nScientific Framework\n\nScientific content.\n";
  const r = renderPaperHTML(md, { title: "Algorithmic Necessity of Agency" });
  assert.equal(r.title, "Algorithmic Necessity of Agency");
  assert.match(r.front, /A Unified Framework/);
  assert.match(r.front, /mailto:writer@example\.org/);
  assert.match(r.front, /This is the actual abstract/);
  assert.doesNotMatch(r.bodyHtml, /OF AGENCY|Author|Contact|ORCID|Abstract|actual abstract/);
  assert.match(r.bodyHtml, /Chapter 1: The Scientific Framework/);
  assert.match(r.bodyHtml, /Scientific content\./);
  assert.equal((r.front.match(/class="abstract"/g) || []).length, 1);
});
