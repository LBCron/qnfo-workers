// reading.q08.org on a phone (UX-JOURNEYS-1, roadmap EK-1; live mode only, read-only GETs, nothing typed and nothing submitted).
// The public host journey (public.journeys.mjs) only opens the index and taps its first link. These are the three things a reader does here:
// read the newest piece, narrow the list to one form, and find the subscribe form. The first one is also the live guard of EK-1 (a piece whose
// stored lede is empty still shows its opening paragraph as the set-apart italic lede) and of the labels a reader must see (AI-generated, sources).
export const name = "reading";
export const liveBase = "https://reading.q08.org";
export const journeys = [
  { id: "read-newest-piece", title: "Open the newest piece from the index and see its lede, the AI label and its sources", modes: ["live"],
    async run(u) {
      await u.open("/");
      const items = u.page.locator("ul.idx li");
      if (!(await items.count())) throw new Error("the index lists no piece");
      const title = (await items.first().locator("a.t").innerText()).trim();
      await u.screen("index");
      await u.tap(title);
      await u.see(title);
      await u.expect(async () => (await u.page.locator("p.lede").count()) === 1, "the piece page " + u.page.url() + " shows no set-apart lede (EK-1: a piece with no stored lede shows its opening paragraph)");
      await u.see("AI-generated");
      await u.see("Sources:");
      await u.screen("piece");
    } },
  { id: "filter-essays", title: "Narrow the list to essays and see only essays", modes: ["live"],
    async run(u) {
      await u.open("/");
      await u.tap("essays");
      await u.expect(async () => /[?&]form=essay/.test(u.page.url()), "tapping essays did not open the essay list: " + u.page.url());
      const labels = await u.page.locator("ul.idx li .m").allInnerTexts();
      if (!labels.length) throw new Error("the essay list shows no piece");
      const other = labels.filter((t) => !/^\s*essay\b/i.test(t));
      if (other.length) throw new Error("the essay list holds " + other.length + " piece(s) that are not essays: " + other[0].slice(0, 60));
      await u.screen("essays");
    } },
  { id: "find-subscribe", title: "Open the subscribe form from the index and see its email field", modes: ["live"],
    async run(u) {
      await u.open("/");
      await u.tap("subscribe");
      await u.see("Subscribe");
      await u.expect(async () => (await u.page.locator("input[type=email]").filter({ visible: true }).count()) === 1, "the subscribe page shows no single email field");
      await u.expect(async () => (await u.page.getByRole("button", { name: "Subscribe" }).filter({ visible: true }).count()) >= 1, "the subscribe page shows no Subscribe button");
      await u.screen("subscribe");
    } }
];
