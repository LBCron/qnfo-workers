// The companion at me.q08.org (personal-api/companion.js), walked as the owner uses it on their phone. Owner rules these journeys
// hold the app to: no typing (one-tap buttons, Dictate for words), no key, no e-mail channel beyond the sign-in code.
// Local journeys run the real page and API against apps/companion-harness.mjs. Live journeys are signed out and read-only: they
// never tap "E-mail me a code" (that would mail the owner a real code).
export const name = "companion";
export const liveBase = "https://me.q08.org";
export async function startLocal() { const { startCompanion } = await import("./companion-harness.mjs"); return startCompanion(); }
const signedIn = async (u) => { await u.open("/__harness/session"); await u.open("/"); await u.see("What can I do right now?"); };

export const journeys = [
  { id: "sign-in", title: "Sign in on a new phone with the e-mailed code",
    async run(u, env) {
      await u.open("/"); await u.see("E-mail me a code"); await u.screen("sign-in");
      await u.tap("E-mail me a code"); await u.see("Sent to");
      const code = await (await fetch(env.base + "/__harness/last-code")).text();
      await u.type("#li-code", code); // the one field the owner must fill: six digits from their inbox
      await u.tap("Open"); await u.see("What can I do right now?"); await u.screen("today");
    } },
  { id: "one-thing-now", title: "Bored or stuck: get one thing to do and start it",
    async run(u) {
      await signedIn(u);
      await u.tap("Give me one thing"); await u.notSee("Could not load"); await u.see("Just this");
      await u.screen("focus");
      await u.tap("Yes — start"); await u.see("Done");
    } },
  { id: "mark-done", title: "Tick off a next action",
    async run(u) {
      await signedIn(u);
      await u.tap("Do", { within: "nav" }); await u.see("Call the dentist"); await u.screen("do");
      await u.tap(u.page.locator("#v-do .item", { hasText: "Call the dentist" }).getByRole("button", { name: "Done" }));
      await u.notSee("Call the dentist", { wait: 800 });
    } },
  { id: "journal-one-tap", title: "Write a journal line without typing",
    async run(u) {
      await signedIn(u);
      await u.tap("More", { within: "nav" }); await u.tap("Journal", { within: "nav" }); await u.screen("journal");
      await u.tap("Went outside"); await u.see("Went outside", { within: "#v-journal" });
    } },
  { id: "dictate-and-talk", title: "Say something to the companion and get an answer",
    async run(u) {
      await signedIn(u);
      await u.tap("Talk", { within: "nav" }); await u.screen("talk");
      await u.tap("Dictate", { within: "#v-talk", wait: 1200 }); await u.tap("Stop", { within: "#v-talk", wait: 1500 });
      await u.tap("Send", { within: "#v-talk", wait: 1500 }); await u.see("good plan", { within: "#msgs" });
    } },
  { id: "checkin-from-notification", title: "Tap a check-in notification and answer how I feel",
    async run(u) {
      await u.open("/__harness/session"); await u.open("/#mood"); await u.see("What can I do right now?");
      // The notification opens /companion#mood; the owner should land on a one-tap mood scale.
      await u.page.locator("#mood-card button").first().waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
      await u.expect(async () => (await u.page.locator("#mood-card button").filter({ visible: true }).count()) > 0, "the check-in notification opens Today with no mood buttons to tap (no #mood-card)");
      await u.tap(u.page.locator("#mood-card button").filter({ visible: true }).nth(2)); await u.screen("mood");
    } },
  { id: "reading-pick", title: "Find something to read",
    async run(u) {
      await signedIn(u);
      await u.see("Something to read");
      await u.expect(async () => /^https:\/\/mind\.q08\.org\//.test(await u.page.getByRole("link", { name: "Open today’s pick" }).getAttribute("href") || ""), "the reading pick does not link to mind.q08.org");
    } },
  { id: "live-sign-in-screen", title: "Open me.q08.org on a phone that is not signed in", modes: ["live"],
    async run(u) { await u.open("/"); await u.see("E-mail me a code"); await u.screen("sign-in"); } },
  { id: "live-guide", title: "Read the one-page guide", modes: ["live"],
    async run(u) { await u.open("/guide"); await u.see("Open my companion"); await u.screen("guide"); } }
];
