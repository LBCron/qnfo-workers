// SCRIPT-CLOSE-1 offline suite (qnfo-gateway 3.54.3, UX-JOURNEY-1 papers-qnfo-org, agent_issues 1001732).
// lpSubscribe ended its inline script with <\\/script> inside a single-quoted JS string, so the page carried the four characters `<\/script>` instead of a closing tag.
// The browser never ended the script element: everything after it (the end of <main>, the Keep exploring section, the footer) became script text and the page threw
// "Unexpected token '<'" on papers.qnfo.org/ and /papers (a phone journey that follows the first link read it as broken).
// Proves, for every HTML page the gateway builds from these templates: no escaped closing tag is emitted, every <script> is closed by a real </script> before the next one
// opens, and no script body contains a tag. Run: node qnfo-gateway/script-close.test.mjs  -> prints "N passed, 0 failed". No network.
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(process.env.SCRIPT_CLOSE_WORKER || join(here, "worker.js")).href)).default; // SCRIPT_CLOSE_WORKER=<file> runs another copy (the pre-fix bundle must fail)
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE papers (slug TEXT, title TEXT, status TEXT)");
const d1 = { prepare(sql) { const st = { bind() { return st; }, async all() { try { return { results: db.prepare(sql).all() }; } catch (e) { return { results: [] }; } }, async first() { return null; }, async run() { return { success: true }; } }; return st; }, async batch() { return []; } };
const env = { LIVING_PAPER: d1, DB: d1, QNFO_BUCKET: { async get() { return null; } }, RELEASES: { async head() { return null; } } };
globalThis.fetch = async () => new Response("Not found", { status: 404 });
const get = async (url) => { const r = await worker.fetch(new Request(url, { headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0" } }), env, { waitUntil() {} }); return { status: r.status, type: r.headers.get("Content-Type") || "", text: await r.text() }; };
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + String(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 300))); } };

const ESCAPED_CLOSER = String.fromCharCode(60, 92, 47) + "script>"; // the four characters < \ / and then script>
// Walk the document the way an HTML parser does for script elements: an open tag starts raw text that only a real </script> ends.
const scriptReport = (html) => {
  const out = { opens: 0, closes: 0, tagInBody: [], unclosed: false };
  const re = /<script\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    out.opens++;
    const end = html.toLowerCase().indexOf("</script>", re.lastIndex);
    if (end < 0) { out.unclosed = true; break; }
    out.closes++;
    const bodyText = html.slice(re.lastIndex, end);
    if (!/application\/(ld\+)?json/i.test(m[0]) && /<\/?(section|main|div|footer|header|nav|article|aside|form|body|html)\b/i.test(bodyText)) out.tagInBody.push(bodyText.slice(0, 80));
    re.lastIndex = end + "</script>".length;
  }
  return out;
};

const PAGES = [
  "https://papers.qnfo.org/",
  "https://papers.qnfo.org/papers",
  "https://qnfo.org/",
  "https://qnfo.org/subscribe",
  "https://qwav.org/",
  "https://qnfo.org/privacy",
];
for (const url of PAGES) {
  const r = await get(url);
  ok(r.status === 200 && /text\/html/.test(r.type), url + " renders as HTML", r.status);
  ok(!r.text.includes(ESCAPED_CLOSER), url + " emits no escaped closing script tag", r.text.slice(Math.max(0, r.text.indexOf(ESCAPED_CLOSER) - 60), r.text.indexOf(ESCAPED_CLOSER) + 30));
  const s = scriptReport(r.text);
  ok(!s.unclosed && s.opens === s.closes, url + " closes every script it opens", s);
  ok(s.tagInBody.length === 0, url + " has no page markup inside a script body", s.tagInBody);
}

// the papers landing and the library both carry the subscribe script and the section that follows it
const home = await get("https://papers.qnfo.org/");
ok(/id="ld-sub-form"/.test(home.text) && /Keep exploring/.test(home.text), "the papers landing renders its subscribe form and the Keep exploring section");
const subAt = home.text.indexOf("ld-sub-form");
const exploreAt = home.text.indexOf("lp-explore-h");
const between = home.text.slice(subAt, exploreAt);
ok(subAt > 0 && exploreAt > subAt && /<\/script>/.test(between),"a real </script> separates the subscribe script from the section after it");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
