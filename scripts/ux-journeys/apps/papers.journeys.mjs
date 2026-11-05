// papers.qnfo.org on a phone (live mode only, read-only GETs): the two ways a reader reaches a paper.
//  - paper-from-list: the reader opens the papers list, taps Read on the first paper and sees its title and the screen measures (UX-SCREENS-1 1001825: the paper page
//    carried the same small links, an empty progress bar and an empty toast as the list, and no journey measured it unless a paper had a Short).
//  - paper-with-short (YT-VIDEO-EMBED-1, roadmap YT-15): a paper that has a Short shows the video first. The page is the link /api/paper-videos hands to every consumer
//    (outreach, search engines, this journey), so a dead link there is a broken journey, not a skipped one. When no Short has been uploaded yet there is nothing to check.
export const name = "papers";
export const liveBase = "https://papers.qnfo.org";
export const journeys = [
  { id: "paper-from-list", title: "Open the papers list and read the first paper", modes: ["live"],
    async run(u) {
      await u.open("/");
      await u.see("Read");
      const read = u.page.locator("#plist li.pc .pc-x a").filter({ hasText: /^Read$/ }).first();
      await u.tap(read, { wait: 600 });
      await u.page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
      await u.expect(async () => /\/papers\/[^/]+/.test(new URL(u.page.url()).pathname), "Read on the first paper did not open a paper page: " + u.page.url());
      const h1 = u.page.locator("main h1").first();
      await h1.waitFor({ state: "visible", timeout: 8000 });
      await u.expect(async () => ((await h1.innerText()) || "").trim().length > 3, "the paper page has no visible title on " + u.page.url());
      await u.screen("paper");
    } },
  { id: "paper-with-short", title: "Open a paper that has a Short and see the video on the page", modes: ["live"],
    async run(u) {
      const res = await fetch("https://papers.qnfo.org/api/paper-videos").catch(() => null);
      if (!res || !res.ok) throw new Error("/api/paper-videos answered " + (res ? res.status : "nothing"));
      const list = await res.json();
      if (!list.items || !list.items.length) return; // no Short uploaded yet: the page shows no video, by design
      const item = list.items[0];
      await u.open(item.page || "/papers/" + item.slug); // the API's own link, as every consumer follows it
      await u.see("Watch it in under a minute");
      const frame = u.page.locator('iframe[src*="youtube-nocookie.com/embed/"]');
      if ((await frame.count()) !== 1) throw new Error("the paper page " + item.slug + " has no single YouTube embed");
      const box = await frame.first().boundingBox();
      const vw = await u.page.evaluate(() => window.innerWidth);
      if (!box || box.width < 150 || box.x < 0 || box.x + box.width > vw + 1) throw new Error("the video does not fit the phone screen: " + JSON.stringify(box));
      await u.see("AI-generated voice");
      await u.screen("paper-short");
    } }
];
