var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var VERSION = "0.1.0";
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}
__name(json, "json");
function auth(req, env) {
  if (!env.IMPACT_TOKEN) return true;
  const t = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!t) return false;
  const a = new TextEncoder().encode(t), b = new TextEncoder().encode(env.IMPACT_TOKEN);
  if (a.byteLength !== b.byteLength) return false;
  let d = 0;
  for (let i = 0; i < a.byteLength; i++) d |= a[i] ^ b[i];
  return d === 0;
}
__name(auth, "auth");
async function ensureSchema(env) {
  await env.QNFO_AUDIT.prepare("CREATE TABLE IF NOT EXISTS citation_stats (id TEXT PRIMARY KEY, doi TEXT, source TEXT, metric TEXT, value REAL, collected_at TEXT)").run();
  await env.QNFO_AUDIT.prepare("CREATE TABLE IF NOT EXISTS impact_scores (doi TEXT PRIMARY KEY, score REAL, updated_at TEXT)").run();
}
__name(ensureSchema, "ensureSchema");
async function fetchJson(url, timeoutMs = 2e4) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "QNFO/qnfo-impact/0.1 (mailto:rowan@qnfo.org)" } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}
__name(fetchJson, "fetchJson");
async function runImpact(env, commit, limit) {
  await ensureSchema(env);
  const out = { papers: 0, stats: [], errors: [] };
  if (!commit) {
    const n2 = await env.LIVING_PAPER.prepare("SELECT COUNT(*) c FROM papers WHERE doi IS NOT NULL OR registrar_doi IS NOT NULL").first();
    return { preview: true, papersWithDoi: n2 ? n2.c : 0 };
  }
  const n = Math.min(limit || 50, 100);
  const papers = await env.LIVING_PAPER.prepare("SELECT slug, doi, registrar_doi FROM papers WHERE doi IS NOT NULL OR registrar_doi IS NOT NULL ORDER BY created_at DESC LIMIT ?1").bind(n).all();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const p of papers.results || []) {
    const doi = p.registrar_doi || p.doi;
    if (!doi) continue;
    out.papers++;
    const entry = { slug: p.slug, doi, sources: {} };
    let crCited;
    if (!doi.startsWith("10.5281/registrar")) {
      const cr = await fetchJson("https://api.crossref.org/works/" + encodeURIComponent(doi));
      crCited = cr?.message && cr.message["is-referenced-by-count"];
    }
    const crCited2 = typeof crCited === "number" ? crCited : void 0;
    if (typeof crCited2 === "number") entry.sources.crossref = crCited2;
    const oa = await fetchJson("https://api.openalex.org/works/doi:" + encodeURIComponent(doi));
    const oaCited = oa?.cited_by_count;
    if (typeof oaCited === "number") entry.sources.openalex = oaCited;
    const zn = await fetchJson("https://registrar.org/api/records?q=doi:" + encodeURIComponent('"' + doi + '"') + "&size=1");
    const rec = zn && zn.hits && zn.hits.hits && zn.hits.hits[0];
    if (rec) {
      let views = 0, downloads = 0;
      const st = rec.stats || {};
      if (st.views || st.downloads) {
        views = st.views || 0;
        downloads = st.downloads || 0;
      } else {
        for (const f of rec.files || []) {
          views += f.views || 0;
          downloads += f.downloads || 0;
        }
      }
      if (views || downloads) entry.sources.registrar = { views, downloads };
    }
    const cited = (entry.sources.openalex || 0) + (entry.sources.crossref || 0);
    const dls = entry.sources.registrar && entry.sources.registrar.downloads || 0;
    const vws = entry.sources.registrar && entry.sources.registrar.views || 0;
    const score = Math.round((cited + dls / 50 + vws / 500) * 1e3) / 1e3;
    try {
      for (const [src, metric, value] of [["crossref", "is-referenced-by-count", entry.sources.crossref], ["openalex", "cited_by_count", entry.sources.openalex], ["registrar", "views", entry.sources.registrar && entry.sources.registrar.views], ["registrar", "downloads", entry.sources.registrar && entry.sources.registrar.downloads]]) {
        if (value !== void 0 && value !== null) {
          await env.QNFO_AUDIT.prepare("INSERT OR REPLACE INTO citation_stats (id, doi, source, metric, value, collected_at) VALUES (?1,?2,?3,?4,?5,?6)").bind(crypto.randomUUID(), doi, src, metric, value, now).run();
        }
      }
      await env.QNFO_AUDIT.prepare("INSERT OR REPLACE INTO impact_scores (doi, score, updated_at) VALUES (?1,?2,?3)").bind(doi, score, now).run();
    } catch (e) {
      out.errors.push({ slug: p.slug, error: String(e && e.message || e).slice(0, 200) });
    }
    out.stats.push(entry);
  }
  return out;
}
__name(runImpact, "runImpact");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === "/health") return json({ status: "ok", worker: "qnfo-impact", version: VERSION, bindings: { d1: !!env.QNFO_AUDIT, living_paper: !!env.LIVING_PAPER } });
    if (p === "/run") {
      const commit = url.searchParams.get("commit") === "1";
      if (commit && !auth(request, env)) return json({ error: "unauthorized" }, 401);
      return json(await runImpact(env, commit, parseInt(url.searchParams.get("limit") || "50", 10)));
    }
    if (p === "/stats") {
      const rows = await env.QNFO_AUDIT.prepare("SELECT doi, score, updated_at FROM impact_scores ORDER BY score DESC LIMIT 20").all();
      return json({ top: rows.results });
    }
    return json({ error: "not found" }, 404);
  },
  async scheduled(event, env) {
    if (event.cron === "0 4 * * *") {
      try {
        const r = await runImpact(env, true, 50);
        console.log("[qnfo-impact]", JSON.stringify({ papers: r.papers, errors: r.errors.length }));
      } catch (e) {
        console.error("[qnfo-impact] error:", e && e.message || e);
      }
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
