// The owner's fleet dashboard at fleet.qnfo.org (qnfo-fleet-dashboard, V3-DASH-1: three screens, Now / Readers / Code), walked as the owner uses it on a phone.
// Owner rules these journeys hold the app to: what needs me is the first thing on the page, every item can be handed back with one tap, a screen never hangs on
// "Loading..." when a source is down, and the command line is two taps from the home page. No key to paste: the only sign-in is the e-mailed code.
// Local journeys run the real page and API against apps/fleet-harness.mjs (fake data, the ops executor stubbed). The live read-only journey for the
// address itself is in public.journeys.mjs.
export const name = "fleet";
export const liveBase = "https://fleet.qnfo.org";
export async function startLocal() { const { startFleet } = await import("./fleet-harness.mjs"); return startFleet(); }
const STREAM_REPLY = "Two pull requests are open and both are safe to merge."; // the same text as STREAM_REPLY in fleet-harness.mjs (the harness is imported only in local mode)
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
  { id: "plus-page-loads", title: "Open the plus page and see what got better and which products are used",
    async run(u) {
      await u.open("/plus"); await u.see("Plus: what got better"); await u.see("Show the reason on every match");
      await u.see("unmeasured"); await u.see("6,126"); await u.screen("plus");
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
    } },
  // RM-CMD-FAILURES-1: the /cmd page drew an empty card for a CodeSession turn (kind "stream"). A plain-English line now shows the answer as it streams: a tool step, then text, then model and tokens.
  { id: "cmd-ask-streams", title: "Type a plain-English request on /cmd and read the streamed answer",
    async run(u) {
      await u.open("/__harness/session"); await u.open("/cmd"); await u.see("Signed in: actions enabled");
      await u.type("#ctext", "please summarise the open pull requests");
      await u.tap("Run", { within: "#cform", wait: 1500 });
      await u.see(STREAM_REPLY, { within: "#cout" }); await u.see("ops_fleet_status", { within: "#cout" }); await u.see("deepseek-v4-flash-wa", { within: "#cout" }); await u.screen("cmd-stream");
    } },
  // The microphone of /cmd (issue 5469): the page is served with Permissions-Policy microphone=() by the qnfo.org zone rule, so no browser can ask for permission. Read-only: opens the page, asks the browser.
  { id: "cmd-mic-allowed", title: "Open /cmd on a phone: the Speak button is allowed to ask for the microphone", modes: ["live"],
    async run(u) {
      await u.page.goto(u.base + "/cmd", { waitUntil: "load", timeout: 20000 });
      await u.see("Speak");
      const allowed = await u.page.evaluate(() => { const p = document.permissionsPolicy || document.featurePolicy; return p && typeof p.allowsFeature === "function" ? p.allowsFeature("microphone") : null; });
      if (allowed === false) throw new Error("/cmd is served with Permissions-Policy microphone=(): no browser can ask for the microphone, so Speak always fails (zone ruleset http_response_headers_transform sets the header over the worker's own microphone=(self))");
    } }
];
