// WORK-WITH-ME-1 offline suite: renders qnfo.org/work-with-me, the home page, /about, the sitemap and llms.txt through the
// real qnfo-gateway fetch handler (stubbed D1, no network) and checks:
//   - no claim from STRATEGY s2.2 "Claims we never make": scripts/identity-guard.py's own PATTERNS, plus the wider list
//     (patents, clearance, media features, corpus counts, physics headlines, retired labels, QWAV), no claude.ai link,
//     no mojibake, no personal data (phone, street address, legal or health matters), no invented price, no form;
//   - the owner is never "he" or "she" on the page (first person, or they/them);
//   - every offer: who it is for, what they get, how to start, and a mailto to rowan.quni@qnfo.org whose subject starts
//     with its [work-with-me:<key>] tag; every mailto on the page carries a tag; the keys match qnfo-fleet-dashboard
//     WWM_OFFER_KEYS (what WORK-WITH-ME-METRIC-1 counts); qnfo-email's spam heuristic does not file any default subject;
//   - JSON-LD parses: Person with the ORCID sameAs, every makesOffer resolves to an Offer whose itemOffered is a Service,
//     no price anywhere, the page node is the canonical URL;
//   - title, description, canonical, OpenGraph, Twitter card, GA4 tag; the AI disclosure line; the selected works;
//   - links from the home page and /about, the sitemap and llms.txt entries, /contact redirects, /health advertises it.
// Run: node qnfo-gateway/work-with-me.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const gw = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const stmt = { bind() { return stmt; }, async all() { return { results: [] }; }, async first() { return null; }, async run() { return {}; } };
const env = { LIVING_PAPER: { prepare: () => stmt }, DB: { prepare: () => stmt } };
const get = async (url) => {
  const r = await gw.fetch(new Request(url, { redirect: "manual" }), env);
  return { status: r.status, headers: r.headers, text: await r.text() };
};

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (extra !== undefined ? " :: " + JSON.stringify(extra).slice(0, 400) : "")); } };
// &amp; is decoded last, so "&amp;lt;" becomes the literal text "&lt;" and is never decoded twice.
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const visible = (html) => decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

const page = await get("https://qnfo.org/work-with-me");
const html = page.text, text = visible(html);
ok(page.status === 200 && /text\/html/.test(page.headers.get("Content-Type") || ""), "GET qnfo.org/work-with-me serves HTML", page.status);
{ const wwm = await get("https://www.qnfo.org/work-with-me"); ok((await get("https://qnfo.org/work-with-me/")).status === 200 && wwm.status === 301 && wwm.headers.get("Location") === "https://qnfo.org/work-with-me", "the trailing slash serves the page; www 301s to the canonical host (SEO-HYGIENE-1)", wwm.status); }

// 1. Claims we never make. identity-guard's own patterns first (read from the guard, so the lists cannot drift).
const guard = readFileSync(join(root, "scripts", "identity-guard.py"), "utf8");
const pats = [...guard.matchAll(/re\.compile\(r"((?:[^"\\]|\\.)+)", re\.I\)/g)].map((m) => new RegExp(m[1], "i"));
ok(pats.length >= 8, "identity-guard patterns read from scripts/identity-guard.py", pats.length);
const home = await get("https://qnfo.org/"), about = await get("https://qnfo.org/about");
for (const [name, body] of [["work-with-me", html], ["home", home.text], ["about", about.text]]) {
  const hits = pats.filter((rx) => rx.test(body)).map(String);
  ok(hits.length === 0, name + ": no identity-guard pattern", hits);
}
const NEVER = [
  [/patent/i, "patent claim"], [/clearance/i, "clearance claim"], [/featured in|national media|as seen in/i, "media feature"],
  [/\b\d[\d,.]*\s*\+?\s*(publications|papers|preprints|articles)\b/i, "corpus count"], [/~\s*1,?000|\b(940|1,?000)\b/, "corpus count"],
  [/dead end|path forward|spectral artifact/i, "physics headline"], [/Research (Foundation|Collective|Program)\b/i, "retired label"],
  [/QWAV/, "parked label"], [/VP of Quantum|Chief Quantum/i, "screen-failing title"], [/\b94\b/, "repo directory count"],
  [/\b(PhD|Dr\.)\b/, "unearned title"], [/claude\.ai|anthropic\.com/i, "claude.ai link"], [/Ã|â€/, "mojibake"]
];
for (const [rx, why] of NEVER) ok(!rx.test(text), "no " + why + " on the page", (text.match(rx) || [])[0]);
ok(/44 deployed Cloudflare Workers/.test(text) && !/\b(40|94)[- ]worker/i.test(text), "fleet size is stated as deployed workers (44)");
// Personal data and prices: none.
ok(!/\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{3,}/.test(text) && !/\b(street|straat|apartment|postcode|zip code|home address)\b/i.test(text), "no phone number or street address");
ok(!/\b(lawsuit|litigation|litigant|court case|divorce|custody|diagnos\w*|medical|illness|disability)\b/i.test(text), "no legal or health matters");
ok(!/(€|EUR|USD)\s?\d|\$\d[\d,.]*\s*(k|K)?\s*(\/|per)\s*(hour|day|month|engagement)|\bhourly rate\b|\bday rate\b/.test(text) && /There is no price list/.test(text), "no invented price; the page says there is no price list");
ok(!/<form\b/i.test(html) && !/<input\b/i.test(html), "no form: the page stores nothing");
ok(!/\b(he|him|his|she|her|hers)\b/i.test(text), "no he/she for the owner", (text.match(/\b(he|him|his|she|her|hers)\b/i) || [])[0]);
ok(/^I am Rowan Brad Quni-Gudzinas/.test(text.slice(text.indexOf("I am Rowan"))) && /\bI (built|led|have run|use)\b/.test(text), "the copy is in the owner's first person");

// 2. Offers and mailto tags.
const EXPECT = ["jpcub", "agent-review", "talk", "research", "role"];
for (const k of EXPECT) {
  const a = html.indexOf('<section class="ww-offer" id="' + k + '"'), b = html.indexOf("</section>", a);
  const sec = a >= 0 ? html.slice(a, b) : "";
  ok(sec && /<h3>Who it is for<\/h3>/.test(sec) && /<h3>How to start<\/h3>/.test(sec) && /<h3>(What you get|What I bring|Topics|Three open lines)<\/h3><ul><li>/.test(sec), "offer " + k + ": who it is for, what they get, how to start");
  const m = /href="(mailto:[^"]+)"/.exec(sec);
  const u = m ? new URL(decode(m[1])) : null;
  ok(u && u.pathname === "rowan.quni@qnfo.org" && u.searchParams.get("subject").startsWith("[work-with-me:" + k + "] ") && u.searchParams.get("body").length > 20, "offer " + k + ": mailto to rowan.quni@qnfo.org with its tag and a body", u && u.searchParams.get("subject"));
}
const mailtos = [...html.matchAll(/href="(mailto:[^"]+)"/g)].map((m) => new URL(decode(m[1])));
const tags = mailtos.map((u) => (/^\[work-with-me:([a-z0-9-]+)\] /.exec(u.searchParams.get("subject") || "") || [])[1]);
ok(mailtos.length >= 7 && tags.every(Boolean) && mailtos.every((u) => u.pathname === "rowan.quni@qnfo.org"), "every mailto on the page goes to rowan.quni@qnfo.org with a tag (none untagged)", tags);
const keys = [...new Set(tags)];
ok(JSON.stringify(keys) === JSON.stringify(EXPECT.concat(["general"])), "the tags are the five offers plus general", keys);
const dash = readFileSync(join(root, "qnfo-fleet-dashboard", "worker.js"), "utf8");
const dm = /var WWM_OFFER_KEYS = (\[[^\]]*\]);/.exec(dash);
ok(dm && JSON.stringify(JSON.parse(dm[1])) === JSON.stringify(keys), "the gateway keys match qnfo-fleet-dashboard WWM_OFFER_KEYS (what the metric counts)", dm && dm[1]);
// qnfo-email files spam by heuristicSpam(from, subject); no default subject may trip it.
const em = readFileSync(join(root, "qnfo-email", "worker.js"), "utf8");
const hs = em.indexOf("function heuristicSpam("), he = em.indexOf("catch(e){return false}}", hs);
ok(hs >= 0 && he > hs, "qnfo-email heuristicSpam found");
const cx = vm.createContext({});
vm.runInContext(em.slice(hs, he + "catch(e){return false}}".length) + ";this.h = heuristicSpam;", cx);
const flagged = mailtos.map((u) => u.searchParams.get("subject")).filter((s) => cx.h("someone@example.com", s) || cx.h("someone@example.com", "Re: " + s));
ok(flagged.length === 0, "no default subject is filed as spam by qnfo-email", flagged);
ok(/Please keep it/.test(text) && /\[work-with-me:jpcub\]/.test(text), "the page tells people the tag is how contacts are counted");

// 3. JSON-LD.
const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let ld = null;
try { ld = JSON.parse(blocks[0]); } catch (e) { ld = null; }
ok(blocks.length === 1 && ld && ld["@context"] === "https://schema.org" && Array.isArray(ld["@graph"]), "one JSON-LD block, valid JSON, schema.org @graph");
const g = ld ? ld["@graph"] : [];
const byId = Object.fromEntries(g.filter((n) => n["@id"]).map((n) => [n["@id"], n]));
const person = g.find((n) => n["@type"] === "Person");
ok(person && person["@id"] === "https://qnfo.org/#person" && person.name === "Rowan Brad Quni-Gudzinas" && Array.isArray(person.sameAs) && person.sameAs.some((u) => { try { const x = new URL(u); return x.protocol === "https:" && x.hostname === "orcid.org" && x.pathname === "/0009-0002-4317-5604"; } catch (err) { return false; } }), "Person with the ORCID sameAs");
ok(person && person.email === "rowan.quni@qnfo.org" && person.contactPoint && person.contactPoint["@type"] === "ContactPoint", "Person contact point is rowan.quni@qnfo.org");
const offers = (person && person.makesOffer || []).map((o) => byId[o["@id"]]);
ok(offers.length === 4 && offers.every((o) => o && o["@type"] === "Offer" && o.itemOffered && o.itemOffered["@type"] === "Service" && o.itemOffered.name && o.url.startsWith("https://qnfo.org/work-with-me#")), "makesOffer resolves to four Offer/Service nodes", offers.map((o) => o && o.name));
ok(person && person.seeks && person.seeks["@type"] === "Demand" && /Amsterdam/.test(person.seeks.description), "the roles line is a Demand (seeks), remote from Amsterdam");
const hasPrice = (o) => o && typeof o === "object" && (Object.keys(o).some((k) => /^price|priceSpecification|priceCurrency/.test(k)) || Object.values(o).some(hasPrice));
ok(!hasPrice(ld), "no price anywhere in the structured data");
const pageNode = g.find((n) => n["@type"] === "ProfilePage" || n["@type"] === "WebPage");
ok(pageNode && pageNode.url === "https://qnfo.org/work-with-me" && pageNode.mainEntity && pageNode.mainEntity["@id"] === "https://qnfo.org/#person", "the page node is the canonical URL about the Person");

// 4. Head, analytics, disclosure, selected works.
const meta = (attr, name) => { const m = new RegExp('<meta ' + attr + '="' + name + '" content="([^"]*)"').exec(html); return m ? decode(m[1]) : null; };
ok(/<title>Work with me · Rowan Brad Quni-Gudzinas · QNFO<\/title>/.test(html) && (meta("name", "description") || "").length > 80, "title and description");
ok(/<link rel="canonical" href="https:\/\/qnfo.org\/work-with-me">/.test(html) && meta("property", "og:url") === "https://qnfo.org/work-with-me", "canonical and og:url");
ok(meta("property", "og:title") && meta("property", "og:description") && meta("property", "og:type") && meta("name", "twitter:card") === "summary_large_image" && meta("property", "og:image") === "https://qnfo.org/og.jpg" && /name="viewport"/.test(html), "OpenGraph, share image (REACH-LAYER-1), Twitter card and viewport");
ok(/<script src="https:\/\/qnfo\.org\/qds-consent\.js\?v=\d+" defer><\/script>/.test(html) && !/googletagmanager|gtag\(/.test(html), "the GA4 tag is behind the consent loader and the page names no tracker host (BP26-CONSENT-1, GA4-COLLECT-RESTORE-1)");
ok(!/cdn-cgi\/zaraz/.test(html), "no Zaraz loader: the GA4 tag is the only counter (GA4-COLLECT-RESTORE-1)");
ok(!/cloudflareinsights/.test(html), "no hand-added RUM beacon (the zone injects one; two would double count)");
ok(/prepared with an AI-assisted research pipeline; the author is responsible for the content\./i.test(text), "the STRATEGY 2.5 AI disclosure line");
ok(/AI agents do much of QNFO's engineering, analysis and drafting under my direction/.test(text), "engagements disclose AI assistance");
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => decode(m[1]));
for (const slug of ["joules-per-solution-metric", "jpcub-qec-landauer", "jpcub-competitive-landscape", "jpcub-llm-energy", "universal-ignorance-audit", "ai4metascience-ignorance-audit", "quniverse-fleet-lessons"]) ok(hrefs.some((h) => h === "https://papers.qnfo.org/papers/" + slug), "links paper:" + slug);
ok(!/doi\.org|zeno\x64o|10\.5281/i.test(html), "no DOI link or deposit-host mention on the page");
ok((html.match(/<h1[\s>]/g) || []).length === 1, "one h1");
// The gateway artifacts stay pure ASCII (scripts/math-sym-escape-patch.py): typographic characters are written as escapes.
ok(!/[^\x00-\x7f]/.test(readFileSync(join(here, "worker.js"), "utf8")), "qnfo-gateway/worker.js is pure ASCII");

// 5. Links in, discovery and routing.
ok(/href="\/work-with-me"/.test(home.text) && /Work with me/.test(visible(home.text)), "the home page links to /work-with-me");
ok(/href="\/work-with-me"/.test(about.text) && /href="mailto:rowan.quni@qnfo.org"/.test(about.text), "/about links to /work-with-me and gives rowan.quni@qnfo.org");
ok((await get("https://qnfo.org/sitemap.xml")).text.includes("<loc>https://qnfo.org/work-with-me</loc>"), "the qnfo.org sitemap lists the page");
ok((await get("https://qnfo.org/llms.txt")).text.includes("(https://qnfo.org/work-with-me)"), "llms.txt lists the page");
const c = await get("https://qnfo.org/contact");
ok(c.status === 301 && c.headers.get("Location") === "https://qnfo.org/work-with-me", "/contact redirects to /work-with-me");
const h = JSON.parse((await get("https://qnfo.org/health")).text);
ok(h.capabilities.includes("work-with-me-page") && h.limitations.some((l) => /work-with-me/.test(l)) && /^3\.\d+\.\d+/.test(h.version), "/health advertises the page and its limitation", h.version);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
