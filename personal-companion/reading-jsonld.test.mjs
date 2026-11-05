// BP26-AI-ACT-ART50-1 and BP26-STRUCTURED-DATA-1 (personal-companion 1.43.6): a reading.q08.org piece page carries an Article JSON-LD block whose creditText is the machine-readable half of
// the visible AI-generated label, and the index carries a Blog block. The worker cannot be imported under node (cloudflare: imports), so the two builders are cut out of the source and run,
// and the wiring into the page builders is checked in the source. Run: node personal-companion/reading-jsonld.test.mjs   (prints "N passed, 0 failed")
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const shared = readFileSync(new URL("../_shared/analysis-form.js", import.meta.url), "utf8"); // EK-6: the credit sentence lives in the shared analysis form
let passed = 0, failed = 0;
const ok = (c, l, x) => { if (c) passed++; else { failed++; console.error("FAIL " + l + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 200) : "")); } };

const a = src.indexOf("function pieceLd(p) {"), b = src.indexOf("function renderPiece(p, keyQS) {");
ok(a > 0 && b > a, "the JSON-LD builders are present before renderPiece");
const { pieceLd, readingIndexLd } = new Function(shared + "\n" + src.slice(a, b) + "\nreturn { pieceLd, readingIndexLd };")();
const block = (s) => { const m = /^<script type="application\/ld\+json">([\s\S]*)<\/script>$/.exec(s); return m ? JSON.parse(m[1]) : null; };

const j = block(pieceLd({ slug: "2026-10-26-essay-abc", title: "The </script><b>Vandalic</b> War", day: "2026-10-26" }));
ok(j && j["@type"] === "Article" && j["@context"] === "https://schema.org", "a piece yields an Article block that parses");
ok(j.headline.includes("Vandalic") && j.datePublished === "2026-10-26" && j.url === "https://reading.q08.org/p/2026-10-26-essay-abc", "headline, date and url come from the piece");
ok(j.author["@type"] === "Organization" && !/\b(ai|gpt|claude|assistant|bot)\b/i.test(j.author.name), "the author is an Organization and no AI or invented persona");
ok(/Written by AI/.test(j.creditText) && /No human reviews pieces before they appear/.test(j.creditText), "creditText says written by AI and that no human reviews pieces");
ok(!/<\/script>/i.test(pieceLd({ slug: "x", title: "</script><script>alert(1)</script>", day: "2026-10-26" }).slice(0, -9)), "a title cannot close the script block");

const idx = block(readingIndexLd());
ok(idx && idx["@type"] === "Blog" && idx.name === "Reading" && idx.url === "https://reading.q08.org/", "the index yields a Blog block");

ok(/return page\(p\.title, shell\(body \+ fb \+ foot\), pieceLd\(p\)( \+ og)?(, blurb)?\);/.test(src), "renderPiece puts the block in the head (READING-FEED-LEDE-1 adds the og tags and the blurb to the same call)");
ok(src.includes('return page("Reading", shell(body), readingIndexLd());'), "renderIndex puts the Blog block in the head");
ok(/var AI_LABEL_HTML = afAiLabelHtml\(\);/.test(src) && /creditText: AF_AI_LABEL_TEXT/.test(src), "the visible label and the credit text both come from the one shared sentence");
ok(/var AF_AI_LABEL_TEXT = "[^\n]*No human reviews pieces before they appear\.";/.test(shared), "the shared sentence says no human reviews pieces");
ok(/var VERSION = "1\.(?:43\.(?:[6-9]|\d{2,})|(?:4[4-9]|[5-9]\d)\.\d+)[-"]/.test(src), "VERSION is at least 1.43.6");

console.log(passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
