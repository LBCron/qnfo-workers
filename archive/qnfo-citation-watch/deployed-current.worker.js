var VERSION = "1.0.1-doi-scrub";
export default {
  async scheduled(event, env, ctx) {
    try {
      const out = await run(env);
      console.log("citation-watch", JSON.stringify(out));
    } catch (e) {
      console.error("citation-watch", String((e && e.message) || e));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: "qnfo-citation-watch", version: VERSION }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/run") {
      const out = await run(env);
      return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }
};
// NOZ-DOI-1 (2026-10-10): the five legacy DOIs all sat under the owner's closed repository prefix and no longer resolve, so the
// watch list is empty until third-party DOIs are added. Third-party DOI lookups below are unchanged.
const KNOWN_DOIS = [];
async function run(env) {
  const lines = [];
  let total = 0;
  for (const doi of KNOWN_DOIS) {
    try {
      const r = await fetch("https://api.openalex.org/works/doi:" + doi, { headers: { "User-Agent": "QNFO citation watch (mailto:rwnquni@outlook.com)" } });
      if (!r.ok) continue;
      const w = await r.json();
      const cited = (w && w.cited_by_count) || 0;
      total += cited;
      lines.push("- " + ((w && w.title) || doi) + " | cited_by: " + cited);
      const cr = await fetch("https://api.openalex.org/works?filter=cites:" + doi + "&per-page=5", { headers: { "User-Agent": "QNFO citation watch (mailto:rwnquni@outlook.com)" } });
      if (cr.ok) {
        const c = await cr.json();
        for (const cit of (c.results || []).slice(0, 3)) {
          lines.push("    - " + ((cit && cit.title) || "untitled") + " | " + ((cit && cit.publication_date) || ""));
        }
      }
    } catch (e) {}
  }
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const key = "notes/v1/" + d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + ymd + "/_citation-watch-" + ymd + ".md";
  const body = "# Citation Watch " + ymd + "\n\nTotal known-DOI citations: " + total + "\n\n" + lines.join("\n") + "\n";
  let wrote = false;
  try {
    if (env.VAULT) { await env.VAULT.put(key, body, { httpMetadata: { contentType: "text/markdown" } }); wrote = true; }
  } catch (e) {}
  return { status: "ok", total, noteKey: key, lines: lines.length, wrote };
}