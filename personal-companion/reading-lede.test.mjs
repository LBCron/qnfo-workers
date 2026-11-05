// EK-1 regression suite (charter pillar: personal): a lede shown on the index also appears in italics on a heading-first piece page.
// Run: node personal-companion/reading-lede.test.mjs
import { readFileSync } from "node:fs";
import { importWorker } from "./_harness-import-worker.mjs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const { renderPiece, renderIndex } = await importWorker(() => src.replace(
  'import { WorkflowEntrypoint } from "cloudflare:workers";',
  "var WorkflowEntrypoint = class {};"
) + "\nexport { renderPiece, renderIndex };", new URL("./", import.meta.url));
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) passed++; else { failed++; console.error("FAIL " + l); } };
const piece = {
  slug: "2026-10-27-notes-test",
  title: "A test piece",
  form: "notes",
  day: "2026-10-27",
  word_count: 100,
  lede: "The opening paragraph.",
  anchor_json: "{}"
};
const pageLede = (html) => /<p class=lede>(.*?)<\/p>/.exec(html)?.[1];
const indexLede = (p) => /<div class=l>(.*?)<\/div>/.exec(renderIndex([p], "", ""))?.[1];

for (const heading of ["# Opening", "## Opening", "### Opening", "\n  ## Opening"]) {
  const p = { ...piece, body_md: heading + "\n\n" + piece.lede + "\n\nThe next paragraph." };
  const html = renderPiece(p, "");
  const lede = "<p class=lede>" + piece.lede + "</p>";
  ok(pageLede(html) === indexLede(p) && pageLede(html) === piece.lede, "heading-first piece matches the index lede: " + heading.trim());
  ok(html.indexOf(lede) < html.indexOf(">Opening</h"), "the lede appears before the opening heading");
  ok(/<h[23]>Opening<\/h[23]>/.test(html) && html.includes("<p>The next paragraph.</p>"), "headings and following paragraphs are preserved");
  ok(/\.lede\{[^}]*font-style:italic/.test(html), "the piece lede is styled in italics");
}

for (const body_md of ["## Opening\n\nThe next paragraph.", "The next paragraph.", piece.lede + "\n\nThe next paragraph."]) {
  const p = { ...piece, body_md };
  const html = renderPiece(p, "");
  ok(pageLede(html) === indexLede(p), "separate and paragraph-first ledes match the index");
  ok(html.slice(html.indexOf("<body")).split(piece.lede).length - 1 === 1, "a separate or leading body lede is displayed once (in the body: the page head carries the same text as its og/description blurb, READING-FEED-LEDE-1)");
}

const unsafe = { ...piece, lede: '<img src=x onerror="alert(1)"> & text.', body_md: "## Opening\n\nBody." };
const html = renderPiece(unsafe, "");
ok(pageLede(html) === indexLede(unsafe) && pageLede(html) === "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; text.", "the lede is escaped identically on index and piece pages");
ok(!html.includes("<img"), "lede markup cannot become executable HTML");

const credited = { ...piece, lede: "The opening paragraph, according to Wikipedia.", body_md: "## Opening\n\nBody." };
ok(pageLede(renderPiece(credited, "")) === "The opening paragraph." && indexLede(credited) === "The opening paragraph.", "legacy source-credit cleanup is consistent");

for (const lede of ["", null, undefined]) {
  const p = { ...piece, lede, body_md: "## Opening\n\nThe opening paragraph." };
  const html = renderPiece(p, "");
  ok(pageLede(html) === undefined && indexLede(p) === undefined, "a missing lede adds no empty lede element");
  ok(html.includes("<h2>Opening</h2>") && html.includes("<p>The opening paragraph.</p>"), "without a lede the body remains intact");
}

// EK-1 hardening (1.45.1): a piece whose stored lede is empty (a prune removed it: 2 of the 14 newest pieces on 2026-11-04) but whose body opens on a prose paragraph
// shows that paragraph as the lede on the index and the piece page alike, once.
for (const lede of ["", null, undefined]) {
  const p = { ...piece, lede, body_md: "The opening paragraph of the body.\n\nThe next paragraph." };
  const html = renderPiece(p, "");
  ok(pageLede(html) === "The opening paragraph of the body." && indexLede(p) === "The opening paragraph of the body.", "a lost lede is lifted from the body's opening paragraph, on the page and the index");
  ok(html.slice(html.indexOf("<body")).split("The opening paragraph of the body.").length - 1 === 1 && html.includes("<p>The next paragraph.</p>"), "the lifted paragraph is shown once in the body and the rest of the body remains");
}
{
  const long = Array.from({ length: 16 }, (_, i) => "Clause " + i + " says " + "word ".repeat(12).trim() + ".").join(" ");
  const p = { ...piece, lede: "", body_md: long + "\n\nThe next paragraph." };
  const html = renderPiece(p, "");
  const shown = pageLede(html);
  ok(shown && shown.split(/\s+/).length <= 110 && shown === indexLede(p), "a long opening paragraph is cut at a sentence boundary, identically on page and index");
  ok(html.includes("Clause 15 says") && html.includes("<p>The next paragraph.</p>"), "the part of the paragraph beyond the lede stays in the body");
}
{
  const p = { ...piece, lede: "", body_md: "- a list first\n\nThe paragraph after the list." };
  ok(pageLede(renderPiece(p, "")) === undefined && indexLede(p) === undefined, "a body that opens on a list yields no lede, so nothing is shown twice");
  const q = { ...piece, lede: "", body_md: "<img src=x onerror=alert(1)> and & more.\n\nNext." };
  ok(pageLede(renderPiece(q, "")) === "&lt;img src=x onerror=alert(1)&gt; and &amp; more." && !renderPiece(q, "").includes("<img"), "a lifted lede is escaped");
}
ok(src.split("CASE WHEN lede IS NULL OR lede = '' THEN substr(body_md, 1, 1500) ELSE '' END AS body_md").length - 1 === 2, "both index queries read the body head only for a piece with no stored lede");

console.log(passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
