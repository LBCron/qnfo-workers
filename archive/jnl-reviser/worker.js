// jnl-reviser is RETIRED and inert (NOZ-DOI-1, 2026-10-10): the external deposit and community integration it used is gone.
// It makes no outbound calls, has no cron, and answers /health only.
var VERSION = "0.2.1-doi-scrub";
export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = { ok: path === "/health", service: "jnl-reviser", version: VERSION, retired: true };
    return new Response(JSON.stringify(body), { status: path === "/health" ? 200 : 410, headers: { "content-type": "application/json; charset=utf-8" } });
  }
};
