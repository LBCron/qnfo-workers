export default {
  async scheduled(event, env, ctx) {
    try {
      const out = await run(env);
      console.log("arxiv-radar", JSON.stringify(out));
    } catch (e) {
      console.error("arxiv-radar", String((e && e.message) || e));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: "qnfo-arxiv-radar", version: "1.0.1" }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/run") {
      const out = await run(env);
      return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }
};
const WIDE_QUERY = '(all:"ultrametric" OR all:"p-adic" OR all:"Bruhat-Tits" OR all:"quantum energy" OR all:"joules per solution" OR all:"quantum error correction" OR all:"ZBW" OR all:"quantum thermodynamics" OR all:"Landauer" OR all:"energy per logical qubit" OR all:"Margolus-Levitin" OR all:"cryogenic controller" OR all:"primon" OR all:"Gentile statistics" OR all:"adelic" OR all:"arithmetic quantum") AND (cat:quant-ph OR cat:math-ph OR cat:hep-th OR cat:cs.ET)';
const STRONG = ["ultrametric","p-adic","bruhat","primon","adelic","gentile","joules","landauer","margolus","quantum energy","error correction","thermodynamics","logical qubit","zbw","arithmetic","energy overhead","energy efficiency","cryogenic"];
const UA = "Mozilla/5.0 (QNFO arxiv-radar)";
function pad(n) { return String(n).padStart(2, "0"); }
async function run(env) {
  const out = { hits: 0, candidates: 0, enqueued: 0, dupes: 0, noteKey: null, error: null, sample: [] };
  let hits = [];
  try {
    const q = encodeURIComponent(WIDE_QUERY);
    const r = await fetch("https://export.arxiv.org/api/query?search_query=" + q + "&start=0&max_results=20&sortBy=submittedDate&sortOrder=descending", { headers: { "User-Agent": UA } });
    const txt = await r.text();
    const entries = txt.split("<entry>").slice(1);
    for (const en of entries) {
      const t = (en.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
      const id = (en.match(/<id>[\s\S]*?arxiv\.org\/abs\/([^<]+)<\/id>/) || [])[1] || "";
      const pub = (en.match(/<published>([^<]+)<\/published>/) || [])[1] || "";
      const sum = (en.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || "";
      const authors = [];
      const am = en.match(/<name>([\s\S]*?)<\/name>/g) || [];
      for (const a of am) authors.push(a.replace(/<\/?name>/g, "").trim());
      if (t) hits.push({ id: id.trim(), title: t.replace(/\s+/g, " ").trim().slice(0, 220), published: pub.slice(0, 10), authors: authors.slice(0, 6), text: (t + " " + sum).replace(/\s+/g, " ").toLowerCase() });
    }
  } catch (e) { out.error = String((e && e.message) || e); }
  out.hits = hits.length;
  const candidates = [];
  for (const h of hits) {
    let score = 0;
    for (const kw of STRONG) if (h.text.includes(kw)) score++;
    if (score >= 1) candidates.push(h);
  }
  out.candidates = candidates.length;
  out.sample = candidates.slice(0, 5).map(function(c){ return c.id + " " + c.title.slice(0, 60); });
  const lines = [];
  for (const c of candidates.slice(0, 15)) {
    lines.push("- [" + c.id + "] " + c.title + " (" + c.published + ") " + c.authors.slice(0, 3).join(", "));
  }
  const d = new Date();
  const ymd = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const key = "notes/v1/" + d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + ymd + "/_arxiv-radar-" + ymd + ".md";
  const body = "# arXiv Radar " + ymd + "\n\nWidened scan: " + hits.length + " hits, " + candidates.length + " strong candidates\n\n" + lines.join("\n") + "\n";
  try {
    if (env.VAULT) { await env.VAULT.put(key, body, { httpMetadata: { contentType: "text/markdown" } }); out.noteKey = key; }
  } catch (e) {}
  if (env.AUDIT) {
    for (const c of candidates.slice(0, 8)) {
      try {
        const dup = await env.AUDIT.prepare("SELECT 1 AS x FROM outreach_queue WHERE paper_id=?1 LIMIT 1").bind(c.id.slice(0, 40)).first();
        if (dup) { out.dupes++; continue; }
        await env.AUDIT.prepare("INSERT INTO outreach_queue (id, paper_id, author, email, reason, status, created_at) VALUES (?1,?2,?3,NULL,?4,'pending', datetime('now'))").bind("aq-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), c.id.slice(0, 40), "", "arxiv-radar widened: " + c.title.slice(0, 120)).run();
        out.enqueued++;
      } catch (e) {}
    }
  }
  return out;
}
