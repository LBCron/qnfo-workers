// BP26-CONSENT-1: the Google tag loads only after the visitor presses Allow. This suite pins the legal behaviour of the loader (/qds-consent.js):
// a first visit, a No, an automated browser, Global Privacy Control and Do Not Track send nothing to Google and set no cookie; Allow injects gtag.js;
// the page HTML itself never names the tracker host (so the BP26 static producer, which reads the HTML, sees what a visitor who has not consented sees).
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const env = { LIVING_PAPER: { prepare() { const st = { bind() { return st; }, async all() { return { results: [] }; }, async first() { return null; }, async run() { return {}; } }; return st; } }, DB: null, QNFO_BUCKET: { async get() { return null; } }, RELEASES: { async head() { return null; } } };
env.DB = env.LIVING_PAPER;
const get = async (url, accept) => {
  const r = await worker.fetch(new Request(url, { headers: accept ? { Accept: accept } : {} }), env, { waitUntil() {} });
  return { status: r.status, ct: r.headers.get("content-type") || "", cc: r.headers.get("cache-control") || "", text: await r.text() };
};
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + String(d).slice(0, 300))); } };

const js = await get("https://qnfo.org/qds-consent.js");
ok(js.status === 200 && /javascript/.test(js.ct), "the consent loader is served as JavaScript", js.status + " " + js.ct);
ok(/max-age=3600/.test(js.cc), "the loader is cached for an hour, not a day", js.cc);
for (const h of ["papers.qnfo.org", "qwav.org", "archive.qnfo.org"]) {
  const r = await get("https://" + h + "/qds-consent.js");
  ok(r.status === 200 && r.text === js.text, h + " serves the same loader", r.status);
}

// the pages never name the tracker host or call gtag: only the same-origin loader is referenced
for (const u of ["https://qnfo.org/privacy", "https://qnfo.org/", "https://qwav.org/", "https://archive.qnfo.org/"]) {
  const r = await get(u, "text/html");
  ok(r.status === 200, u + " renders", r.status);
  ok(!/googletagmanager|google-analytics|gtag\(/.test(r.text), u + " does not name the Google tag in its HTML");
  ok(/<script src="https:\/\/qnfo\.org\/qds-consent\.js\?v=\d+" defer><\/script>/.test(r.text), u + " references the consent loader", r.text.slice(0, 80));
}
const priv = await get("https://qnfo.org/privacy", "text/html");
ok(/data-qds-consent="granted"/.test(priv.text) && /data-qds-consent="denied"/.test(priv.text) && /data-qds-consent-state/.test(priv.text), "the privacy notice lets a visitor change the choice");
ok(/loads only if you press Allow/.test(priv.text) && /G-LV7RHRVW6R/.test(priv.text), "the privacy notice says the tag loads only on Allow");

// ---- run the loader against a DOM stub
function run({ stored = null, webdriver = false, gpc = false, dnt = null, storageThrows = false, cookie = "", host = "papers.qnfo.org" } = {}) {
  const log = { headScripts: [], bodyNodes: [], cookies: [], listeners: {}, gtagCalls: [], storage: {} };
  if (stored) log.storage["qnfo-analytics-consent"] = stored;
  const el = (tag) => ({ tag, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, appendChild(c) { this.children.push(c); return c; }, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; }, parentNode: null });
  const state = { els: {} };
  const document = {
    readyState: "complete",
    get cookie() { return cookie; },
    set cookie(v) { log.cookies.push(v); },
    createElement: el,
    getElementById(id) { return state.els[id] || null; },
    querySelectorAll() { return []; },
    addEventListener(t, f) { log.listeners[t] = f; },
    head: { appendChild(n) { log.headScripts.push(n.src || ""); return n; } },
    body: { appendChild(n) { log.bodyNodes.push(n); if (n.id) { state.els[n.id] = n; n.parentNode = { removeChild() { delete state.els[n.id]; } }; } return n; } },
  };
  const window = { dataLayer: undefined, navigator: { webdriver, globalPrivacyControl: gpc, doNotTrack: dnt }, localStorage: storageThrows ? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } : { getItem: (k) => (k in log.storage ? log.storage[k] : null), setItem: (k, v) => { log.storage[k] = v; } } };
  window.window = window;
  vm.runInNewContext(js.text, { window, document, location: { hostname: host }, navigator: window.navigator }, { timeout: 1000 });
  log.window = window;
  log.bannerShown = !!state.els["qds-consent"];
  log.click = (value) => {
    const target = { closest: () => ({ getAttribute: () => value }) };
    log.listeners.click({ target, preventDefault() {} });
    log.bannerShown = !!state.els["qds-consent"];
  };
  return log;
}

let r = run();
ok(r.headScripts.length === 0 && r.cookies.length === 0, "first visit: nothing is requested from Google and no cookie is written", JSON.stringify(r.headScripts));
ok(r.bannerShown, "first visit: the choice banner is shown");
const banner = r.bodyNodes.find((n) => n.id === "qds-consent");
ok(banner && /data-qds-consent="granted"/.test(banner._html) && /data-qds-consent="denied"/.test(banner._html), "the banner offers Allow and No thanks with the same weight");
ok(banner && banner.attrs.role === "region" && banner.attrs["aria-label"] === "Analytics choice", "the banner is a labelled region");

r = run({ stored: "denied" });
ok(r.headScripts.length === 0 && !r.bannerShown, "a stored No: no tracker, no banner");

r = run({ stored: "granted" });
ok(r.headScripts.length === 1 && r.headScripts[0] === "https://www.googletagmanager.com/gtag/js?id=G-LV7RHRVW6R", "a stored Allow loads gtag.js once", JSON.stringify(r.headScripts));
ok(Array.isArray(r.window.dataLayer) && r.window.dataLayer.length === 2, "gtag is configured (js and config calls queued)");

r = run({ webdriver: true });
ok(r.headScripts.length === 0 && !r.bannerShown && r.cookies.length === 0, "an automated browser gets no tracker and no banner");
r = run({ webdriver: true, stored: "granted" });
ok(r.headScripts.length === 0, "an automated browser never loads the tracker, even with a stored Allow");
r = run({ gpc: true });
ok(r.headScripts.length === 0 && !r.bannerShown, "Global Privacy Control counts as No");
r = run({ dnt: "1", stored: "granted" });
ok(r.headScripts.length === 0, "Do Not Track overrides a stored Allow");

r = run();
r.click("granted");
ok(r.headScripts.length === 1 && r.window.localStorage.getItem("qnfo-analytics-consent") === "granted" && !r.bannerShown, "pressing Allow stores the choice, closes the banner and loads gtag.js");

r = run({ cookie: "_ga=GA1.1.1; _ga_LV7RHRVW6R=GS1; theme=dark" });
r.click("denied");
ok(r.headScripts.length === 0 && r.window.localStorage.getItem("qnfo-analytics-consent") === "denied" && !r.bannerShown, "pressing No stores the choice and loads nothing");
ok(r.cookies.some((c) => /^_ga=; Max-Age=0/.test(c)) && r.cookies.some((c) => /^_ga_LV7RHRVW6R=; Max-Age=0/.test(c)) && !r.cookies.some((c) => /^theme=/.test(c)), "No clears the _ga cookies and leaves other cookies alone", JSON.stringify(r.cookies));
ok(r.cookies.some((c) => /domain=\.qnfo\.org/.test(c)), "No also clears the cookie on the parent domain");

r = run({ storageThrows: true });
ok(r.headScripts.length === 0 && r.bannerShown, "blocked storage: the banner is shown and nothing loads until Allow");

console.log("consent suite: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
