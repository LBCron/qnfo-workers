// The weekly signal archive (WEEKLY-SIGNAL-1, RM-BS-WEEKLY-SIGNAL-1), opened on a phone (live mode only, read-only GETs).
// The page is a reader's first look at the weekly issue, so the journey checks what a phone visitor must be able to rely on: the page says that a human
// approves every issue, says that no audio edition exists yet and that the voice will be synthetic and labelled, and fits a 375 px screen without sideways scroll.
// The owner's review page needs a signed link and is covered by qnfo-subscribers/weekly-signal.test.mjs (a GET never changes anything, only the buttons decide).
export const name = "signal";
export const liveBase = "https://qnfo-subscribers.q08.workers.dev";
export const journeys = [
  { id: "archive-open", title: "Open the weekly signal archive on a phone and read how an issue is made", modes: ["live"],
    async run(u) {
      await u.open("/signal");
      await u.see("QNFO weekly signal");
      await u.see("A human editor approves every issue");
      await u.see("the voice is synthetic and will be labelled");
      await u.expect(async () => await u.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the weekly signal archive scrolls sideways on a phone");
      await u.screen("archive");
    } }
];
