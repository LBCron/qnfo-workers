export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    let out;
    try {
      if (cron === "0 8 * * 7") out = await jobregistrar(env);
      else if (cron === "0 6 1 * *") out = await jobPhilpapers(env);
      else if (cron === "0 9 * * 7") out = await jobSeo(env);
      else out = { status: "skipped", cron: cron };
      console.log("research-radar", JSON.stringify(out));
    } catch (e) {
      console.error("research-radar", String((e && e.message) || e));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: "qnfo-research-radar", version: "1.0.1" }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/run") {
      const mode = url.searchParams.get("job") || "all";
      const results = {};
      if (mode === "registrar" || mode === "all") results.registrar = await jobregistrar(env);
      if (mode === "philpapers" || mode === "all") results.philpapers = await jobPhilpapers(env);
      if (mode === "seo" || mode === "all") results.seo = await jobSeo(env);
      return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }
};
const registrar_DOIS = ["10.5281/registrar.21803159","10.5281/registrar.21786473","10.5281/registrar.21784489","10.5281/registrar.21784490","10.5281/registrar.21786603"];
const SITEMAPS = ["https://rwnq8.github.io/sitemap.xml","https://qnfo-landing.pages.dev/sitemap.xml"];
function pad(n) { return String(n).padStart(2, "0"); }
function todayKey() {
  const d = new Date();
  const ymd = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  return { ymd: ymd, dir: "notes/v1/" + d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + ymd };
}
async function writeNote(env, name, body) {
  const t = todayKey();
  const key = t.dir + "/_" + name + "-" + t.ymd + ".md";
  try {
    if (env.VAULT) { await env.VAULT.put(key, body, { httpMetadata: { contentType: "text/markdown" } }); return key; }
  } catch (e) {}
  return null;
}
async function jobregistrar(env) {
  const lines = [];
  let ok = 0;
  for (const doi of registrar_DOIS) {
    try {
      const r = await fetch("https://doi.org/api/handles/" + doi, { headers: { "User-Agent": "QNFO registrar attribution audit (mailto:rwnquni@outlook.com)" } });
      if (r.ok) { ok++; lines.push("- " + doi + " | resolve: OK (HTTP " + r.status + ")"); }
      else lines.push("- " + doi + " | resolve: FAIL (HTTP " + r.status + ")");
    } catch (e) { lines.push("- " + doi + " | resolve: ERROR " + String((e && e.message) || e)); }
  }
  const body = "# registrar Attribution Audit " + todayKey().ymd + "\n\nDOIs checked: " + registrar_DOIS.length + " | resolving: " + ok + "\n\n" + lines.join("\n") + "\n";
  const noteKey = await writeNote(env, "registrar-attribution", body);
  return { status: "ok", resolving: ok, total: registrar_DOIS.length, noteKey: noteKey };
}
async function jobPhilpapers(env) {
  let status = 0, len = 0, line = "no check";
  try {
    const r = await fetch("https://philpapers.org/s/Quni-Gudzinas", { headers: { "User-Agent": "Mozilla/5.0 (QNFO philpapers monitor)" } });
    status = r.status;
    const t = await r.text();
    len = t.length;
    line = "philpapers.org search page HTTP " + status + " | bytes " + len;
  } catch (e) { line = "ERROR " + String((e && e.message) || e); }
  const body = "# PhilPapers Index Monitor " + todayKey().ymd + "\n\n" + line + "\n";
  const noteKey = await writeNote(env, "philpapers", body);
  return { status: "ok", httpStatus: status, bytes: len, noteKey: noteKey };
}
async function jobSeo(env) {
  const lines = [];
  for (const u of SITEMAPS) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (QNFO SEO health)" } });
      const t = await r.text();
      const lastmod = (t.match(/<lastmod>([^<]+)<\/lastmod>/i) || [])[1] || "none";
      lines.push("- " + u + " | HTTP " + r.status + " | bytes " + t.length + " | lastmod " + lastmod);
    } catch (e) { lines.push("- " + u + " | ERROR " + String((e && e.message) || e)); }
  }
  const body = "# SEO Health Check " + todayKey().ymd + "\n\n" + lines.join("\n") + "\n";
  const noteKey = await writeNote(env, "seo-health", body);
  return { status: "ok", noteKey: noteKey, checks: lines.length };
}
