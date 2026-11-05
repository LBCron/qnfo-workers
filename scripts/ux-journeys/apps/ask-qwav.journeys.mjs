// ask.qwav.tech on a phone (live mode only, read-only): the pages qnfo-ai-search 2.16.0 to 2.18.0 added next to the ask page (UX-JOURNEYS-1, roadmap rows 31 RM-VISION-LIVING-PAPER-1,
// 36 RM-VISION-REPRODUCE-BUTTON-1, 34 and 38). None of them is asked to send anything: the living paper is opened and its equations are drawn, the record of a paper's verification
// script is opened (the Run button is seen, not pressed: it downloads about 10 MB of Python), and the calculators compute in the page.
export const name = "ask-qwav";
export const liveBase = "https://ask.qwav.tech";
export const journeys = [
  { id: "living-paper", title: "Open a paper as a living paper and see its equations drawn", modes: ["live"],
    async run(u) {
      await u.open("/paper/twisted-cuprate-twistronics");
      const h1 = u.page.locator("#pt");
      await h1.waitFor({ state: "visible", timeout: 10000 });
      await u.expect(async () => /Twisted Cuprate/.test((await h1.innerText()) || ""), "the living paper shows no title on " + u.page.url());
      await u.page.locator("#body .katex").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => { throw new Error("no equation was drawn on " + u.page.url()); });
      await u.see("Ask this paper a question");
      await u.screen("living-paper");
    } },
  { id: "reproduce-record", title: "Open the record of a paper's verification script and see the claims and the Run button", modes: ["live"],
    async run(u) {
      await u.open("/reproduce/ultrametric-state-counting-a-p-adic-alternative-to-planck-s-black-body-statistic");
      await u.page.locator("#cb tr").first().waitFor({ state: "attached", timeout: 15000 }).catch(() => { throw new Error("the record lists no claims on " + u.page.url()); });
      await u.see("Run in my browser");
      await u.see("Recorded when the pipeline ran it");
      await u.screen("reproduce-record");
    } },
  { id: "compute-padic", title: "Open the calculators and compute a p-adic valuation", modes: ["live"],
    async run(u) {
      await u.open("/compute");
      await u.see("p-adic valuation and ultrametric distance");
      await u.tap("Compute", { within: "#pf", wait: 300 });
      await u.see("Strong triangle inequality");
      await u.see("Valuation, absolute value and p-adic digits");
      await u.screen("compute");
    } }
];
