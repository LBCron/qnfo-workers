// REGISTER-1 offline suite (qnfo-ipatent 3.21.0, RM-BS-DEFENSIVE-PUBLICATION-1): the consented defensive-publication register.
// What it pins: nothing is published without an explicit, recorded consent that is never pre-ticked; only the disclosure text is published (never the inventor's
// e-mail or the print version); the page carries og/canonical tags, a cite-as line and a fingerprint anyone can recompute; the author can withdraw, which removes the
// text; a cross-site POST, a private or automated draft, a short text and a link list are refused; the daily cap holds.
// Run: node qnfo-ipatent/register.test.mjs   (prints "N passed, 0 failed")
import { createHash } from "node:crypto";
const W = (await import("./worker.js")).default;
let passed = 0, failed = 0;
const ok = (c, l, x) => { if (c) passed++; else { failed++; console.error("FAIL " + l + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// A small in-memory ipatent-db: just the statements the register issues.
function makeDb() {
  const st = { tableReady: false, subs: new Map(), rows: new Map(), batches: 0 };
  const missing = () => { throw new Error("D1_ERROR: no such table: public_disclosures: SQLITE_ERROR"); };
  const exec = (sql, a) => {
    if (/^CREATE (TABLE|INDEX)/.test(sql)) { if (/public_disclosures/.test(sql)) st.tableReady = true; return { first: null, all: [] }; }
    if (/FROM submissions WHERE submission_id = \?1/.test(sql)) return { first: st.subs.get(a[0]) || null, all: [] };
    if (/INSERT INTO page_views/.test(sql)) return { first: null, all: [] };
    if (/public_disclosures/.test(sql) && !st.tableReady) missing();
    if (/^INSERT INTO public_disclosures/.test(sql)) {
      const [slug, sid, title, text, hash, name, cv, ct, now, wh] = a;
      if ([...st.rows.values()].some((r) => r.submission_id === sid)) throw new Error("UNIQUE constraint failed");
      st.rows.set(slug, { slug, submission_id: sid, title, body_text: text, content_hash: hash, display_name: name, status: "public", consent_version: cv, consent_text: ct, consented_at: now, published_at: now, withdraw_hash: wh, withdrawn_at: null, note: null });
      return { first: null, all: [] };
    }
    if (/^UPDATE public_disclosures SET status = \?2/.test(sql)) {
      const [slug, status, now, note] = a; const r = st.rows.get(slug);
      if (r && r.status === "public") Object.assign(r, { status, withdrawn_at: now, title: "[" + status + "]", body_text: "", display_name: "", note });
      return { first: null, all: [] };
    }
    if (/SELECT slug, status, content_hash FROM public_disclosures WHERE submission_id/.test(sql)) return { first: [...st.rows.values()].find((r) => r.submission_id === a[0]) || null, all: [] };
    if (/SELECT COUNT\(\*\) AS n FROM public_disclosures/.test(sql)) return { first: { n: [...st.rows.values()].filter((r) => r.published_at > a[0]).length }, all: [] };
    if (/FROM public_disclosures WHERE status = 'public' ORDER BY published_at DESC LIMIT \?1/.test(sql)) return { first: null, all: [...st.rows.values()].filter((r) => r.status === "public").sort((x, y) => (y.published_at + y.slug).localeCompare(x.published_at + x.slug)).slice(0, a[0]) };
    if (/FROM public_disclosures WHERE slug = \?1/.test(sql)) return { first: st.rows.get(a[0]) || null, all: [] };
    return { first: null, all: [] };
  };
  const prepare = (sql) => { let args = []; const s = { bind(...a) { args = a; return s; }, async run() { exec(sql, args); return {}; }, async first() { return exec(sql, args).first; }, async all() { return { results: exec(sql, args).all }; }, _sql: sql, _args: () => args }; return s; };
  const batch = async (stmts) => { st.batches++; for (const s of stmts) exec(s._sql, s._args()); return []; };
  return { db: { prepare, batch }, st };
}
const ctx = { waitUntil() {} };
const BODY = "FIELD\nA door hinge with a spring-loaded detent.\n\nDETAILED DESCRIPTION\n" + "[0001] The hinge comprises a pin, a leaf and a spring that seats in a detent at ninety degrees. ".repeat(8) + "\n\nCLAIMS\n1. A hinge comprising a pin, a leaf and a spring detent.";
const SID = "USP-ABCDEFGHJK12-MH2K3L4";
const SID2 = "USP-QRSTUVWXYZ34-MH2K3L5";
function seed(st) {
  st.subs.set(SID, { submission_id: SID, title: "Spring detent <b>hinge</b> & \"latch\"", disclosure_text: BODY, status: "draft", inventor_email: "secret.inventor@example.com", inventor_name: "Ada Inventor", document_html: "<html>secret.inventor@example.com</html>" });
  st.subs.set(SID2, { submission_id: SID2, title: "Second hinge", disclosure_text: BODY + " second", status: "draft" });
  st.subs.set("USP-PRIVATEPRIV1-MH2K3L6", { submission_id: "USP-PRIVATEPRIV1-MH2K3L6", title: "[private]", disclosure_text: "", status: "draft" });
  st.subs.set("USP-BOTBOTBOTBO1-MH2K3L7", { submission_id: "USP-BOTBOTBOTBO1-MH2K3L7", title: "bot", disclosure_text: BODY, status: "automated" });
  st.subs.set("USP-SHORTSHORT12-MH2K3L8", { submission_id: "USP-SHORTSHORT12-MH2K3L8", title: "short", disclosure_text: "too short", status: "draft" });
  st.subs.set("USP-LINKSLINKS12-MH2K3L9", { submission_id: "USP-LINKSLINKS12-MH2K3L9", title: "links", disclosure_text: BODY + " http://a.example http://b.example http://c.example http://d.example http://e.example http://f.example", status: "draft" });
}
const { db, st } = makeDb(); seed(st);
const env = { IPATENT_DB: db, IPATENT_ADMIN_TOKEN: "admin-secret" };
const req = (path, init) => W.fetch(new Request("https://ipatent.qnfo.org" + path, { headers: { "User-Agent": "Mozilla/5.0 (iPhone) Safari/605", ...(init && init.headers || {}) }, method: init && init.method || "GET", body: init && init.body }), env, ctx);
const post = (path, obj, headers) => req(path, { method: "POST", body: JSON.stringify(obj), headers: { "Content-Type": "application/json", ...(headers || {}) } });
const text = async (r) => r.text();

// 1. Before the table exists the register is empty, not an error.
let r = await req("/register");
let page = await text(r);
ok(r.status === 200, "/register answers 200 before any table exists", r.status);
ok(/Open register of defensive publications/.test(page) && /Nothing has been published yet/.test(page), "empty register says nothing is published");
ok(/<link rel="canonical" href="https:\/\/ipatent\.qnfo\.org\/register">/.test(page), "/register has a canonical");
ok(/not legal advice/i.test(page) && /not a patent/i.test(page), "/register carries the not-legal-advice and not-a-patent labels");
ok(/href="\/register\/publish"/.test(page), "/register links to the publish page");
ok(!/all rights reserved/i.test(page), "no 'all rights reserved' (QNFO-ULA)");

// 2. The publish page never pre-ticks consent and starts with the button disabled.
r = await req("/register/publish");
page = await text(r);
ok(r.status === 200 && /<input type="checkbox" id="pc">/.test(page) && !/<input type="checkbox"[^>]*checked/.test(page), "the consent checkbox is not pre-ticked");
ok(/id="pb"[^>]*disabled/.test(page), "the publish button starts disabled");
ok(/noindex/.test(page), "the publish page is noindex");
ok(page.includes("I am the inventor, or I act with the inventor"), "the page shows the full consent text");
ok(/not legal advice/i.test(page), "the publish page keeps the not-legal-advice label");
ok(/class="cf-turnstile"[^>]*data-action="ipatent_publish"/.test(page), "the publish form carries its Turnstile widget");
ok(!/\$\{/.test(page), "no unrendered template placeholder in the publish page");

// 3. Refusals: no consent, wrong consent version, bad id, unknown, private, automated, short, link list, cross-site.
const good = { submission_id: SID, consent: true, consent_version: "dp-consent-1", display_name: "  Ada <script>x</script>  Q  " };
r = await post("/api/register/publish", { ...good, consent: undefined });
ok(r.status === 400, "no consent field is refused", r.status);
r = await post("/api/register/publish", { ...good, consent: "true" });
ok(r.status === 400, "a truthy string is not consent", r.status);
r = await post("/api/register/publish", { ...good, consent: false });
ok(r.status === 400, "consent false is refused", r.status);
r = await post("/api/register/publish", { ...good, consent_version: "old" });
ok(r.status === 409, "a stale consent version is refused", r.status);
r = await post("/api/register/publish", { ...good, submission_id: "nope" });
ok(r.status === 400, "a malformed id is refused", r.status);
r = await post("/api/register/publish", { ...good, submission_id: "USP-NOSUCHDRAFT1-MH2K3LA" });
ok(r.status === 404, "an unknown draft is 404", r.status);
r = await post("/api/register/publish", { ...good, submission_id: "USP-PRIVATEPRIV1-MH2K3L6" });
ok(r.status === 404, "a private draft cannot be published", r.status);
r = await post("/api/register/publish", { ...good, submission_id: "USP-BOTBOTBOTBO1-MH2K3L7" });
ok(r.status === 404, "an automated draft cannot be published", r.status);
r = await post("/api/register/publish", { ...good, submission_id: "USP-SHORTSHORT12-MH2K3L8" });
ok(r.status === 422, "a too-short text is refused", r.status);
r = await post("/api/register/publish", { ...good, submission_id: "USP-LINKSLINKS12-MH2K3L9" });
ok(r.status === 422, "a link list is refused", r.status);
r = await post("/api/register/publish", good, { Origin: "https://evil.example" });
ok(r.status === 403, "a cross-site POST is refused", r.status);
r = await W.fetch(new Request("https://ipatent.qnfo.org/api/register/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" }), env, ctx);
ok(r.status === 400, "invalid JSON is 400", r.status);
r = await W.fetch(new Request("https://ipatent.qnfo.org/api/register/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(good) }), { ...env, TURNSTILE_SECRET: "x" }, ctx);
ok(r.status === 403, "with Turnstile bound, a missing token is refused", r.status);
ok(st.rows.size === 0, "nothing was stored by any refused request", st.rows.size);

// 4. A consented publication is stored with its consent record and a hash anyone can recompute.
r = await post("/api/register/publish", good);
const pub = await r.json();
ok(r.status === 201 && /^dp-[a-hjkmnp-z2-9]{10}$/.test(pub.slug), "publish returns 201 and a register slug", pub);
ok(/^wd-[a-hjkmnp-z2-9]{24}$/.test(pub.withdraw_code || ""), "the withdrawal code is returned once", pub.withdraw_code);
const row = st.rows.get(pub.slug);
const expectHash = sha("iPatent-DP-v1\n" + st.subs.get(SID).title + "\n" + BODY);
ok(pub.content_hash === expectHash && row.content_hash === expectHash, "the fingerprint is SHA-256 of 'iPatent-DP-v1', LF, title, LF, text");
ok(row.consent_version === "dp-consent-1" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(row.consented_at), "the consent version and time are recorded", row);
ok(row.consent_text.startsWith("I am the inventor, or I act with the inventor") && row.consent_text.includes("not legal advice"), "the exact consent text is recorded");
ok(row.withdraw_hash !== pub.withdraw_code && row.withdraw_hash.length === 64 && !JSON.stringify(row).includes(pub.withdraw_code), "only a hash of the withdrawal code is stored");
ok(row.display_name === "Ada script x /script Q", "the shown name is cleaned of markup and control characters", row.display_name);
ok(row.body_text === BODY && !JSON.stringify(row).includes("secret.inventor@example.com") && !JSON.stringify(row).includes("Ada Inventor"), "only the disclosure text is copied: no e-mail, no inventor name, no print version");
r = await post("/api/register/publish", good);
const again = await r.json();
ok(r.status === 200 && again.already === true && again.slug === pub.slug && !again.withdraw_code, "publishing twice returns the same page and no second code", again);

// 5. The public page: tags, escaping, cite-as, fingerprint, no private data.
r = await req("/register/" + pub.slug);
page = await text(r);
ok(r.status === 200 && /text\/html/.test(r.headers.get("content-type")), "the record page answers 200 HTML", r.status);
ok(page.includes('<link rel="canonical" href="https://ipatent.qnfo.org/register/' + pub.slug + '">'), "the record page has its own canonical");
ok(/<meta property="og:title"/.test(page) && /<meta property="og:description"/.test(page) && /<meta name="twitter:card"/.test(page), "the record page has og and twitter tags");
ok(!/noindex/.test(page.split("<body")[0]), "a public record is indexable");
ok(page.includes("Spring detent &lt;b&gt;hinge&lt;/b&gt; &amp; &quot;latch&quot;") && !page.includes("<b>hinge</b>"), "the title is HTML-escaped");
ok(page.includes(expectHash) && /Cite as/.test(page) && page.includes("iPatent Open Register of Defensive Publications, " + pub.slug), "the page shows the fingerprint and a cite-as line");
ok(!page.includes("secret.inventor@example.com") && !page.includes("Ada Inventor"), "the page never shows the inventor's e-mail or name");
ok(/not a patent/i.test(page) && /not legal advice/i.test(page) && /AI model drafted/.test(page), "the page says what it is not, that an AI drafted it, and keeps the legal label");
ok(/"@type":"CreativeWork"/.test(page) && page.includes("sha256:" + expectHash), "the page carries JSON-LD with the fingerprint");
r = await req("/api/register/" + pub.slug);
let api = await r.json();
ok(r.status === 200 && api.text === BODY && api.content_hash === expectHash && api.consent.version === "dp-consent-1", "the JSON record holds the text, the hash and the consent version", Object.keys(api));
ok(!("withdraw_hash" in api) && !("submission_id" in api) && !JSON.stringify(api).includes(SID), "the JSON record never exposes the withdraw hash or the private draft id");
r = await req("/api/register");
api = await r.json();
ok(api.count === 1 && api.items[0].slug === pub.slug && !("text" in api.items[0]), "the list is public and carries no body text", api);
r = await req("/register");
page = await text(r);
ok(page.includes("/register/" + pub.slug) && /Published disclosures \(1\)/.test(page), "/register lists the published disclosure");
r = await req("/sitemap.xml");
page = await text(r);
ok(page.includes("/register</loc>") && page.includes("/register/" + pub.slug + "</loc>"), "the sitemap lists /register and the record");
ok((await text(await req("/llms.txt"))).includes("/register"), "llms.txt names the register");
ok(JSON.parse(await text(await req("/health"))).capabilities.includes("defensive-register"), "/health lists the defensive-register capability");
r = await req("/register/dp-zzzzzzzzzz");
ok(r.status === 404, "an unknown register id is 404", r.status);
r = await req("/register/not-a-slug");
ok(r.status === 404, "a malformed register id is 404", r.status);

// 6. Withdrawal: wrong proof refused, right proof removes the text, republishing is refused.
r = await post("/api/register/withdraw", { slug: pub.slug, withdraw_code: "wd-wrongwrongwrongwrongwrong" });
ok(r.status === 403, "a wrong withdrawal code is refused", r.status);
r = await post("/api/register/withdraw", { slug: pub.slug });
ok(r.status === 400, "no proof is refused", r.status);
r = await post("/api/register/withdraw", { slug: pub.slug, withdraw_code: pub.withdraw_code }, { Origin: "https://evil.example" });
ok(r.status === 403, "a cross-site withdrawal is refused", r.status);
r = await post("/api/register/withdraw", { slug: pub.slug, withdraw_code: pub.withdraw_code });
ok(r.status === 200 && (await r.json()).status === "withdrawn", "the withdrawal code withdraws", r.status);
const gone = st.rows.get(pub.slug);
ok(gone.status === "withdrawn" && gone.body_text === "" && gone.title === "[withdrawn]" && gone.display_name === "" && gone.content_hash === expectHash && gone.consent_text.length > 100, "withdrawal blanks the text and name and keeps the hash and the consent record");
r = await req("/register/" + pub.slug);
page = await text(r);
ok(r.status === 410 && /noindex/.test(page) && !page.includes("hinge comprises") && page.includes(expectHash), "the withdrawn page is 410, noindex, shows no text and keeps the fingerprint", r.status);
r = await req("/api/register/" + pub.slug);
api = await r.json();
ok(r.status === 410 && api.text === null && api.status === "withdrawn", "the JSON record of a withdrawn disclosure has no text", api);
r = await req("/sitemap.xml");
ok(!(await text(r)).includes("/register/" + pub.slug), "a withdrawn disclosure leaves the sitemap");
r = await req("/api/register");
ok((await r.json()).count === 0, "a withdrawn disclosure leaves the list");
r = await post("/api/register/publish", good);
ok(r.status === 409, "a withdrawn draft cannot be published again", r.status);
r = await post("/api/register/withdraw", { slug: pub.slug, withdraw_code: pub.withdraw_code });
ok(r.status === 200 && (await r.json()).already === true, "withdrawing twice is harmless");

// 7. The private link also withdraws; an admin takedown needs the admin token.
r = await post("/api/register/publish", { submission_id: SID2, consent: true, consent_version: "dp-consent-1" });
const pub2 = await r.json();
ok(r.status === 201 && st.rows.get(pub2.slug).display_name === "", "a second draft publishes anonymously by default", pub2);
r = await req("/register/" + pub2.slug);
ok((await text(r)).includes("Anonymous inventor"), "an anonymous record says so");
r = await post("/api/register/takedown", { slug: pub2.slug, reason: "test" });
ok(r.status === 404, "takedown without the admin token is a 404", r.status);
r = await post("/api/register/takedown", { slug: pub2.slug, reason: "abuse report 1" }, { "X-Admin-Token": "admin-secret" });
ok(r.status === 200 && st.rows.get(pub2.slug).status === "removed" && st.rows.get(pub2.slug).note === "abuse report 1", "an admin takedown removes the text and records the reason");
r = await req("/register/" + pub2.slug);
ok(r.status === 410 && /removed by the register/.test(await text(r)), "a removed disclosure says it was removed by the register");

// 8. The daily cap bounds new publications.
const cap = makeDb(); seed(cap.st);
const capEnv = { IPATENT_DB: cap.db };
const nowIso = new Date().toISOString().slice(0, 19) + "Z";
cap.st.tableReady = true;
for (let i = 0; i < 30; i++) cap.st.rows.set("dp-fill" + String(i).padStart(5, "0"), { slug: "dp-fill" + i, submission_id: "x" + i, status: "public", published_at: nowIso, content_hash: "h" });
r = await W.fetch(new Request("https://ipatent.qnfo.org/api/register/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(good) }), capEnv, ctx);
ok(r.status === 429, "the 31st publication in 24 hours is refused", r.status);

// 9. Landing and withdraw pages.
page = await text(await req("/?v=1"));
ok(/href="\/register"/.test(page) && /id="pubLink"/.test(page), "the landing page links the register and offers publishing after a saved draft");
page = await text(await req("/register/withdraw"));
ok(/noindex/.test(page) && /Withdraw from the register/.test(page), "the withdraw page is noindex and has its button");

console.log(passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
