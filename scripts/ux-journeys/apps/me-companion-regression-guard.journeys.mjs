// COMPANION-UI-REGRESSION-GUARD-1: Specific journey to prevent "For the Quniverse" fleet asks regression
// This journey complements the runtime probe by running on every PR that touches personal-api
export const name = "me-companion-regression-guard";
export const liveBase = "https://me.q08.org";

export const journeys = [
  {
    id: "companion-no-fleet-asks",
    title: "Personal companion must not show fleet asks",
    modes: ["live"],
    async run(u) {
      // Navigate to companion
      const res = await u.page.goto("https://me.q08.org/companion", { waitUntil: "load", timeout: 20000 });
      if (!res || res.status() >= 400) {
        throw new Error("me.q08.org/companion answered " + (res ? res.status() : "nothing"));
      }
      
      // Wait for page to load
      await u.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      
      // Take screenshot
      await u.screen("companion-today");
      
      // Get all visible text
      const pageText = await u.page.evaluate(() => document.body.innerText);
      
      // CRITICAL: Must NOT contain fleet asks text
      if (pageText.includes("For the Quniverse")) {
        throw new Error("REGRESSION: 'For the Quniverse' fleet asks appeared on personal companion");
      }
      
      if (pageText.includes("Send to the Quniverse")) {
        throw new Error("REGRESSION: 'Send to Quniverse' button appeared on personal companion");
      }
      
      // Verify Today tab exists (companion UI loaded correctly)
      const todayTab = u.page.locator('text=Today');
      const todayCount = await todayTab.count();
      if (todayCount === 0) {
        throw new Error("Today tab not found - companion UI may not have loaded");
      }
      
      // Check Inbox tab
      const inboxTab = u.page.locator('text=Inbox');
      if (await inboxTab.count() > 0) {
        await u.tap(inboxTab);
        await u.page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
        await u.screen("companion-inbox");
        
        const inboxText = await u.page.evaluate(() => document.body.innerText);
        if (inboxText.includes("to_fleet")) {
          throw new Error("REGRESSION: to_fleet status appeared in inbox");
        }
      }
    }
  }
];
