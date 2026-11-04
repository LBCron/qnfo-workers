// The owner's fleet dashboard at fleet.qnfo.org (qnfo-fleet-dashboard, V3-DASH-1: three screens, Now / Readers / Code), walked as the owner uses it on a phone.
// Owner rules these journeys hold the app to: what needs me is the first thing on the page, every item can be handed back with one tap, a screen never hangs on
// "Loading..." when a source is down, and the command line is two taps from the home page. No key to paste: the only sign-in is the e-mailed code.
// Local journeys run the real page and API against apps/fleet-harness.mjs (fake data, the ops executor stubbed). The live read-only journey for the
// address itself is in public.journeys.mjs.
export const name = "fleet";
export const liveBase = "https://fleet.qnfo.org";
export async function startLocal() { const { startFleet } = await import("./fleet-harness.mjs"); return startFleet(); }
const signedIn = async (u) => { await u.open("/__harness/session"); await u.open("/"); await u.see("Needs you"); };
const card = (u, title) => u.page.locator(".need", { hasText: title });

export const journeys = [
  { id: "see-what-needs-me", title: "Open the dashboard and see what needs me, whether the fleet is running and what it costs",
    async run(u) {
      await signedIn(u);
      await u.see("Approve the annual domain renewal"); await u.see("Add the fleet Google account to Search Console");
      await u.see("Is it running?"); await u.see("Money this month"); await u.screen("now");
    } },
  { id: "hand-back-one-tap", title: "Hand an item back to the fleet with one tap",
    async run(u) {
      await signedIn(u);
      await u.tap(card(u, "Approve the annual domain renewal").getByRole("button", { name: "Fleet: you do it" }), { wait: 1200 });
      await u.notSee("Approve the annual domain renewal", { wait: 600 });
      await u.see("Add the fleet Google account to Search Console"); // the other item stays
    } },
  { id: "snooze-one-tap", title: "Snooze an item for a week with one tap",
    async run(u) {
      await signedIn(u);
      await u.tap(card(u, "Add the fleet Google account to Search Console").getByRole("button", { name: "Snooze 7 days" }), { wait: 1200 });
      await u.notSee("Add the fleet Google account to Search Console", { wait: 600 });
    } },
  { id: "readers-loads", title: "Open the Readers screen and see it finish loading",
    async run(u) {
      await signedIn(u);
      await u.tap("Readers", { within: "nav" }); await u.notSee("Loading...", { wait: 1500 }); await u.screen("readers");
    } },
  { id: "code-sign-in-screen", title: "Open the command line on a phone that is not signed in",
    async run(u) {
      await u.open("/"); await u.see("Is it running?");
      await u.tap("Code", { within: "nav" }); await u.see("Email me a code"); await u.screen("code-signed-out");
    } },
  { id: "code-run-status", title: "Ask the command line for the fleet status with one tap",
    async run(u) {
      await signedIn(u);
      await u.tap("Code", { within: "nav" }); await u.tap("Status", { within: "#s-code", wait: 800 });
      await u.see("Fleet is healthy", { within: "#log" }); await u.screen("code-run");
    } }
];
