// iPatent's open register of defensive publications (REGISTER-1, RM-BS-DEFENSIVE-PUBLICATION-1), opened on a phone (live mode only, read-only GETs).
// The register is the one place a person can put a draft into the public record, so the journey checks the two things a phone visitor must be able to rely on:
// the register page says what a published disclosure is and is not, and the publish page never starts with consent already given (the box is unticked and the
// button is disabled until it is ticked and a draft is previewed). It publishes nothing: no POST is made.
export const name = "ipatent";
export const liveBase = "https://ipatent.qnfo.org";
export const journeys = [
  { id: "register-open-publish", title: "Open the register on a phone and reach the publish page with consent unticked", modes: ["live"],
    async run(u) {
      await u.open("/register");
      await u.see("Open register of defensive publications");
      await u.see("not legal advice");
      await u.screen("register");
      await u.tap("Publish a saved draft");
      await u.expect(async () => /\/register\/publish$/.test(u.page.url()), "tapping Publish a saved draft did not reach /register/publish: " + u.page.url());
      await u.see("Nothing is published until you tick the box");
      await u.expect(async () => !(await u.page.locator("#pc").isChecked()), "the consent box is already ticked on the publish page");
      await u.expect(async () => await u.page.locator("#pb").isDisabled(), "the publish button is enabled before consent and a preview");
      await u.screen("publish");
    } }
];
