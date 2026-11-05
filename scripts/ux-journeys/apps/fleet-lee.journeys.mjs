// Lee, the Cloudflare-account assistant, in the fleet command line (RM-LEE-CMD-1; GitHub 5482: Lee belongs in fleet.qnfo.org/cmd, not on its own host), walked on a phone as the owner uses it.
// Local journeys run the real /cmd page and /api/cmd against apps/fleet-harness.mjs with cf: true (a Cloudflare token, a stub of the zones API and a stub model that asks for one tool).
// The live journey is read-only: it opens the page and reads /api/cmd/lee/health, which says per area whether the worker's own Cloudflare token can read the account (booleans only).
export const name = "fleet-lee";
export const liveBase = "https://fleet.qnfo.org";
export async function startLocal() { const { startFleet } = await import("./fleet-harness.mjs"); return startFleet({ cf: true }); }
const ZONES_LINE = "qnfo.org"; // LEE_ZONES in fleet-harness.mjs
const LEE_REPLY = "The account has 2 active zones: qnfo.org and q08.org."; // LEE_REPLY in fleet-harness.mjs (the harness is imported only in local mode)

export const journeys = [
  { id: "cmd-cf-zones", title: "Type a Cloudflare read on /cmd (cf zones) and see the zones with no model call",
    async run(u) {
      await u.open("/__harness/session"); await u.open("/cmd"); await u.see("Signed in: actions enabled");
      await u.type("#ctext", "cf zones");
      await u.tap("Run", { within: "#cform", wait: 1200 });
      await u.see(ZONES_LINE, { within: "#cout" }); await u.see("q08.org", { within: "#cout" }); await u.screen("cmd-cf-zones");
    } },
  { id: "cmd-lee-ask", title: "Ask Lee a plain-English question on /cmd and read the answer with its tool step",
    async run(u) {
      await u.open("/__harness/session"); await u.open("/cmd"); await u.see("Signed in: actions enabled");
      await u.type("#ctext", "lee: how many zones are in the account?");
      await u.tap("Run", { within: "#cform", wait: 2500 });
      await u.see(LEE_REPLY, { within: "#cout", timeout: 10000 }); await u.see("list_zones", { within: "#cout" }); await u.screen("cmd-lee-ask");
    } },
  { id: "cmd-lee-chip", title: "Tap the lee chip on /cmd and see what Lee can read",
    async run(u) {
      await u.open("/__harness/session"); await u.open("/cmd"); await u.see("Signed in: actions enabled");
      await u.tap("lee", { within: "#cchips", wait: 1000 });
      await u.see("Lee reads the Cloudflare account", { within: "#cout" }); await u.see("read only", { within: "#cout" });
    } },
  { id: "lee-health-live", title: "The production worker's Cloudflare token reaches the account (read-only check of /api/cmd/lee/health)", modes: ["live"],
    async run(u) {
      const r = await u.page.goto(u.base + "/api/cmd/lee/health", { waitUntil: "load", timeout: 20000 });
      const j = JSON.parse(await r.text());
      if (!j.ok || !j.cf_token_set) throw new Error("fleet.qnfo.org has no Cloudflare token for Lee (cf_token_set " + j.cf_token_set + ")");
      const missing = Object.keys(j.can || {}).filter((k) => !j.can[k]);
      if (missing.length) throw new Error("the Cloudflare token of the dashboard cannot read: " + missing.join(", ") + " (statuses " + JSON.stringify(j.status) + ")");
      if (!j.ai_binding) throw new Error("fleet.qnfo.org has no Workers AI binding for Lee");
    } }
];
