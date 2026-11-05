// READING-FEED-LEDE-1 and READING-HEALTH-ACCURACY-1 offline suite (personal-companion, roadmap EK-1 row 1748, charter pillar: reach).
// Read live 2026-11-05: the RSS item of the piece whose stored lede was lost to a prune (2026-11-04-essay-ab27...) had an empty <description>, every piece page carried the
// same one-sentence meta description, and /health printed accuracy {passed 27, retracted 74}, where the 74 are a single 2026-10-10 withdrawal of pieces written before the
// source record existed and 0 are accuracy failures. Proves: the feed item shows the lede the index and the page show (stored, else the opening paragraph; a body that opens
// on a heading shows none); a piece page carries its own meta and Open Graph description, escaped, while other pages keep the site sentence; /health splits the accuracy
// counters and keeps the old keys.
// Run: node personal-companion/reading-feed-head.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { importWorker } from "./_harness-import-worker.mjs";
const IMPORT = 'import { WorkflowEntrypoint } from "cloudflare:workers";';
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mod = await importWorker(() => (src.replace(IMPORT, "var WorkflowEntrypoint = class {};") + "\n//" + Math.random()), new URL("./", import.meta.url));
const V = mod.__verify;
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 500) : "")); } };

// ---- (1) the blurb
{
  ok(V.pieceBlurb("A  short   lede.", 200) === "A short lede.", "a short text is only whitespace-normalised");
  const b = V.pieceBlurb("word ".repeat(80), 50);
  ok(b.length <= 50 && b.charCodeAt(b.length - 1) === 8230 && !/\s.$/.test(b), "a long text is cut at a word boundary with an ellipsis", b);
  ok(V.pieceBlurb("", 200) === "" && V.pieceBlurb(null, 200) === "", "empty and null give an empty blurb");
}

// ---- (2) the feed item shows the lede a reader sees
const mkRow = (over) => Object.assign({ slug: "2026-11-04-essay-a", title: "A piece", lede: "", body_md: "", day: "2026-11-04", created_at: "2026-11-04T09:09:04.256Z" }, over);
{
  const rows = [
    mkRow({ slug: "no-lede", title: "No stored lede", lede: "", body_md: "The embassy confirmed that seven Britons were on the flight & the youngest was 27.\n\nA second paragraph that is not the lede." }),
    mkRow({ slug: "stored", title: "Stored lede", lede: "The stored lede stays as it is.", body_md: "Another opening paragraph.\n\nMore." }),
    mkRow({ slug: "heading-first", title: "Heading first", lede: "", body_md: "## A section\n\nThe paragraph under a heading is a lead-in, not a lede." }),
    mkRow({ slug: "long", title: "Long stored lede", lede: "Sentence one is here. ".repeat(40), body_md: "x" })
  ];
  let sawBodyColumn = false;
  const env = { PERSONAL: { prepare: (sql) => ({ run: async () => ({}), bind() { return this; }, first: async () => null, all: async () => { if (/FROM companion_pieces/.test(sql)) { sawBodyColumn = /substr\(body_md, 1, 1500\) AS body_md/.test(sql); return { results: rows }; } return { results: [] }; } }) } };
  const res = await V.feedXml(env, new URL("https://reading.q08.org/feed.xml"));
  const xml = await res.text();
  const items = xml.split("<item>").slice(1);
  const desc = (i) => (/<description>([\s\S]*?)<\/description>/.exec(items[i]) || [])[1];
  ok(sawBodyColumn, "the feed reads the first 1500 characters of the body beside the stored lede");
  ok(items.length === 4 && /^The embassy confirmed that seven Britons were on the flight &amp; the youngest was 27\.$/.test(desc(0)) && !/second paragraph/.test(desc(0)), "a piece with no stored lede shows its opening paragraph (escaped)", desc(0));
  ok(desc(1) === "The stored lede stays as it is.", "a stored lede is shown as it is", desc(1));
  ok(desc(2) === "", "a body that opens on a heading shows no lede (the same rule as the index and the page)", desc(2));
  ok(desc(3).length <= 400 && desc(3).charCodeAt(desc(3).length - 1) === 8230, "a long lede is cut at 400 characters with an ellipsis", desc(3).length);
}

// ---- (3) the piece page head
{
  const piece = { slug: "2026-11-04-essay-ab", title: 'A "quoted" title', form: "essay", day: "2026-11-04", word_count: 120, lede: "", subtitle: "", body_md: "Opening paragraph about the flight, with 'apostrophes' and \"quotes\".\n\nMore text.", anchor_json: "{}" };
  const html = V.renderPiece(piece, "");
  const descs = html.match(/<meta name=description /g) || [];
  ok(descs.length === 1, "one meta description on the page, not the site sentence plus the piece's", descs.length);
  ok(/<meta name=description content="Opening paragraph about the flight, with 'apostrophes' and &quot;quotes&quot;\.">/.test(html), "the meta description is the shown lede, escaped", (/<meta name=description[^>]*>/.exec(html) || [])[0]);
  ok(/<meta property=og:description content="Opening paragraph about the flight/.test(html) && /<meta property=og:title content="A &quot;quoted&quot; title">/.test(html) && /<meta property=og:type content=article>/.test(html), "Open Graph title and description are the piece's own");
  ok(!/A personal companion that writes one piece at a time/.test(html), "the piece page no longer carries the one site sentence");
  ok(/class=lede/.test(html), "the page still shows the set-apart lede");
  const noLede = V.renderPiece(Object.assign({}, piece, { body_md: "## Heading first\n\nUnder a heading.", subtitle: "" }), "");
  ok(/A personal companion that writes one piece at a time/.test(noLede) && !/og:description/.test(noLede), "a piece with nothing to preview keeps the site sentence and adds no Open Graph description");
  const other = V.readingPage("Reading", "<p>x</p>");
  ok((other.match(/A personal companion that writes one piece at a time/g) || []).length === 1 && !/og:/.test(other), "every other page keeps the site sentence");
}

// ---- (4) /health accuracy
{
  const calls = [];
  const env = { PERSONAL: { prepare: (sql) => ({
    run: async () => ({}), bind() { return this; },
    all: async () => ({ results: /SELECT COUNT\(\*\) n FROM companion_pieces/.test(sql) ? [{ n: 27 }] : /SELECT slug, title, form, day/.test(sql) ? [{ slug: "s", title: "T", form: "notes", day: "2026-11-05" }] : [] }),
    first: async () => { calls.push(sql); if (/withdrawn_no_source_record/.test(sql)) return { withdrawn_no_source_record: 74, retracted_after_audit: 0 }; if (/\) passed,/.test(sql)) return { passed: 27, retracted: 74, unaudited: 0 }; return null; }
  }) } };
  const res = await V.worker.fetch(new Request("https://reading.q08.org/health"), env, { waitUntil() {} });
  const j = await res.json();
  const a = j.accuracy || {};
  ok(res.status === 200 && j.ok === true, "/health answers", res.status);
  ok(a.passed === 27 && a.retracted === 74 && a.unaudited === 0, "the old keys are kept", a);
  ok(a.withdrawn_no_source_record === 74 && a.retracted_after_audit === 0 && a.passed_share_audited === 1, "the counters are split: 74 withdrawn for no source record, 0 retracted after an audit, 27 of 27 audited passed", a);
  const fail = { PERSONAL: { prepare: (sql) => ({ run: async () => ({}), bind() { return this; }, all: async () => ({ results: [] }), first: async () => (/withdrawn_no_source_record/.test(sql) ? { withdrawn_no_source_record: 0, retracted_after_audit: 0 } : /\) passed,/.test(sql) ? { passed: 0, retracted: 0, unaudited: 3 } : null) }) } };
  const j2 = await (await V.worker.fetch(new Request("https://reading.q08.org/health"), fail, { waitUntil() {} })).json();
  ok(j2.accuracy && j2.accuracy.passed_share_audited === null, "with nothing audited the share is null, not a divide by zero", j2.accuracy);
}

console.log("reading-feed-head: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
