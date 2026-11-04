// A paper page with its Short (YT-VIDEO-EMBED-1, roadmap YT-15), opened on a phone (live mode only, read-only GETs).
// The video is the first thing under the title that a reader can play, so the journey checks what a phone reader needs: the embed is there,
// it fits the screen without sideways scrolling and it says the voice is AI-made. When no Short has been uploaded yet there is nothing to check.
export const name = "papers";
export const liveBase = "https://papers.qnfo.org";
export const journeys = [
  { id: "paper-with-short", title: "Open a paper that has a Short and see the video on the page", modes: ["live"],
    async run(u) {
      const res = await fetch("https://papers.qnfo.org/api/paper-videos").catch(() => null);
      if (!res || !res.ok) throw new Error("/api/paper-videos answered " + (res ? res.status : "nothing"));
      const list = await res.json();
      if (!list.items || !list.items.length) return; // no Short uploaded yet: the page shows no video, by design
      const slug = list.items[0].slug;
      await u.open("/papers/" + slug);
      await u.see("Watch it in under a minute");
      const frame = u.page.locator('iframe[src*="youtube-nocookie.com/embed/"]');
      if ((await frame.count()) !== 1) throw new Error("the paper page " + slug + " has no single YouTube embed");
      const box = await frame.first().boundingBox();
      const vw = await u.page.evaluate(() => window.innerWidth);
      if (!box || box.width < 150 || box.x < 0 || box.x + box.width > vw + 1) throw new Error("the video does not fit the phone screen: " + JSON.stringify(box));
      await u.see("AI-generated voice");
      await u.screen("paper-short");
    } }
];
