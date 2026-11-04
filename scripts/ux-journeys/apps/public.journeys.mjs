// Every public page a person reaches on q08.org, qnfo.org and qwav.org, opened on a phone (live mode only, read-only GETs).
// Each journey is the first thing a visitor does: open the address, see real content, then tap the first link in the page and
// land on a page that loads. A new user-facing host is added here in the PR that creates it (docs/UX-JOURNEYS.md).
export const name = "public";
export const liveBase = "https://q08.org";
export const HOSTS = [
  ["q08.org", "Personal home"], ["reading.q08.org", "Reading"], ["mind.q08.org", "Understand your mind"], ["travel.q08.org", "Travel planner", { private: true }],
  ["qnfo.org", "QNFO home"], ["papers.qnfo.org", "Papers"], ["archive.qnfo.org", "Archive"], ["fleet.qnfo.org", "Fleet dashboard"],
  ["ideas.qnfo.org", "Ideas"], ["ipatent.qnfo.org", "iPatent"], ["ai.qnfo.org", "AI"], ["qwav.org", "Quantum home"], ["ask.qwav.tech", "Ask qwav"]
];
const slug = (h) => h.replace(/\./g, "-");
// private: the app is the owner's own and asks a visitor to sign in (401/403 with a sign-in page is the expected first screen).
export const journeys = HOSTS.map(([host, label, opt = {}]) => ({
  id: slug(host), title: "Open " + label + " (" + host + ") on a phone and follow its first link", modes: ["live"],
  async run(u) {
    const res = await u.page.goto("https://" + host + "/", { waitUntil: "load", timeout: 20000 });
    const status = res ? res.status() : 0;
    const signInWall = opt.private && (status === 401 || status === 403);
    if (!res || (status >= 400 && !signInWall)) throw new Error(host + " answered " + (status || "nothing"));
    await u.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const words = await u.page.evaluate(() => (document.body.innerText || "").trim().split(/\s+/).filter(Boolean).length);
    if (words < 5) throw new Error(host + " shows a blank page on a phone (" + words + " words)");
    await u.screen("home");
    if (signInWall) return; // a private app: the sign-in screen is the whole public journey
    // The first same-site link in the main content (or the page), as a curious visitor would tap it.
    const link = u.page.locator("main a[href], article a[href], body a[href]").filter({ visible: true });
    const n = await link.count();
    for (let i = 0; i < Math.min(n, 12); i++) {
      const href = await link.nth(i).getAttribute("href");
      let url; try { url = new URL(href, u.page.url()); } catch (e) { continue; }
      if (url.hostname !== host || url.pathname === new URL(u.page.url()).pathname || /^(mailto|tel|javascript):/.test(href) || /\.(pdf|zip|xml|json)$/i.test(url.pathname)) continue;
      const before = u.page.url();
      await u.tap(link.nth(i), { wait: 300 });
      await u.page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
      if (u.page.url() === before) break; // an in-page control, not a navigation: nothing to check
      const st = await u.page.evaluate(() => (document.body.innerText || "").trim().length);
      if (st < 20) throw new Error("the first link on " + host + " (" + url.pathname + ") opens a blank page");
      break;
    }
  }
}));
