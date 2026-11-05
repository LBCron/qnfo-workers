var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// search.js
async function json(obj, cors = {}, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });
}
__name(json, "json");
function sanitize(s, max = 1500) {
  return String(s || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/[\uD800-\uDFFF]/g, "").trim().slice(0, max);
}
__name(sanitize, "sanitize");
async function sha16(s) {
  const data = new TextEncoder().encode(String(s));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest.slice(0, 16))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha16, "sha16");
async function embed(env, texts) {
  const resp = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: texts.slice(0, 32) }, { gateway: { id: "default" } });
  const vectors = resp && resp.data || [];
  return vectors.filter((v) => Array.isArray(v) && v.length === 768).map((v) => v.map((x) => Number.isFinite(x) ? x : 0));
}
__name(embed, "embed");
async function safeUpsert(env, batch) {
  if (batch.length === 0) return 0;
  try {
    await env.VZ.upsert(batch);
    return batch.length;
  } catch (e) {
    if (batch.length === 1) return 0;
    const mid = Math.ceil(batch.length / 2);
    const a = await safeUpsert(env, batch.slice(0, mid));
    const b = await safeUpsert(env, batch.slice(mid));
    return a + b;
  }
}
__name(safeUpsert, "safeUpsert");
var search_default = {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Index-Token, Authorization"
      };
      if (request.method === "OPTIONS") return new Response(null, { headers: cors, status: 204 });
      if (url.pathname === "/health") {
        return json({ ok: true, worker: "personal-life-search", index: "personal-life", version: "v1.2.3-env-secret" }, cors);
      }
      if (url.pathname === "/stats" && request.method === "GET") {
        const f = await env.PERSONAL.prepare("SELECT COUNT(*) as n FROM files").first();
        const p = await env.PERSONAL.prepare("SELECT COUNT(*) as n FROM profile").first();
        const e = await env.PERSONAL.prepare("SELECT COUNT(*) as n FROM events").first();
        const b = await env.PERSONAL.prepare("SELECT COUNT(*) as n FROM browse").first();
        const m = await env.PERSONAL.prepare("SELECT COUNT(*) as n FROM email_index").first();
        return json({ ok: true, filesIndexed: f && f.n || 0, profileFacets: p && p.n || 0, events: e && e.n || 0, browseUrls: b && b.n || 0, emailIndexed: m && m.n || 0 }, cors);
      }
      if (url.pathname === "/search") {
        const q = (url.searchParams.get("q") || "").trim();
        const topK = Number(url.searchParams.get("topK") || 20);
        if (!q) return json({ ok: false, error: "missing q" }, cors, 400);
        const [vector] = await embed(env, [q]);
        if (!vector) return json({ ok: false, error: "embed failed" }, cors, 500);
        const result = await env.VZ.query(vector, { topK, returnValues: false, returnMetadata: "all" });
        const byFile = /* @__PURE__ */ new Map();
        for (const hit of result.matches || []) {
          const m = hit.metadata || {};
          if (m.doc === "profile" || m.doc === "event" || m.doc === "browse") continue;
          const path = m.path || "unknown";
          if (!byFile.has(path)) byFile.set(path, []);
          byFile.get(path).push({ score: hit.score, text: m.text || "", chunk: m.chunk || 0, type: m.type || "", category: m.category || "", modified: m.modified || "" });
        }
        const files = [];
        for (const [path, hits] of byFile) {
          hits.sort((a, b) => b.score - a.score);
          files.push({ path, bestScore: hits[0].score, hits: hits.slice(0, 3), category: hits[0].category, type: hits[0].type, modified: hits[0].modified, snippet: hits[0].text });
        }
        files.sort((a, b) => b.bestScore - a.bestScore);
        return json({ ok: true, query: q, count: files.length, files }, cors);
      }
      if (url.pathname === "/profile" && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        const facet = url.searchParams.get("facet") || "";
        const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
        if (q) {
          const [vector] = await embed(env, [q]);
          if (!vector) return json({ ok: false, error: "embed failed" }, cors, 500);
          const result = await env.VZ.query(vector, { topK: 40, returnValues: false, returnMetadata: "all" });
          const matches = (result.matches || []).filter((h) => (h.metadata || {}).doc === "profile");
          const ids = matches.map((h) => (h.metadata || {}).id).filter(Boolean);
          const items = [];
          for (const id of ids.slice(0, 25)) {
            const row = await env.PERSONAL.prepare("SELECT id, facet, label, statement, evidence, confidence, updated_at FROM profile WHERE id = ?1").bind(id).first();
            if (row) items.push({ ...row, score: (matches.find((h) => (h.metadata || {}).id === id) || {}).score });
          }
          return json({ ok: true, query: q, count: items.length, facets: items }, cors);
        }
        const sql = facet ? `SELECT id, facet, label, statement, evidence, confidence, updated_at FROM profile WHERE facet = ?1 ORDER BY facet, id LIMIT ?2` : `SELECT id, facet, label, statement, evidence, confidence, updated_at FROM profile ORDER BY facet, id LIMIT ?1`;
        const rows = facet ? await env.PERSONAL.prepare(sql).bind(facet, limit).all() : await env.PERSONAL.prepare(sql).bind(limit).all();
        return json({ ok: true, count: rows.results.length, facets: rows.results }, cors);
      }
      if (url.pathname === "/events" && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        const category = url.searchParams.get("category") || "";
        const from = url.searchParams.get("from") || "";
        const to = url.searchParams.get("to") || "";
        const upcoming = url.searchParams.get("upcoming") || "";
        const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
        if (q) {
          const [vector] = await embed(env, [q]);
          if (!vector) return json({ ok: false, error: "embed failed" }, cors, 500);
          const result = await env.VZ.query(vector, { topK: 40, returnValues: false, returnMetadata: "all" });
          const matches = (result.matches || []).filter((h) => (h.metadata || {}).doc === "event");
          const ids = matches.map((h) => (h.metadata || {}).id).filter(Boolean);
          const items = [];
          for (const id of ids.slice(0, 25)) {
            const row = await env.PERSONAL.prepare("SELECT * FROM events WHERE id = ?1").bind(id).first();
            if (row) items.push({ ...row, score: (matches.find((h) => (h.metadata || {}).id === id) || {}).score });
          }
          return json({ ok: true, query: q, count: items.length, events: items }, cors);
        }
        const conds = [];
        const binds = [];
        if (category) {
          conds.push("category = ?1");
          binds.push(category);
        }
        if (from) {
          conds.push("COALESCE(start_date, '9999') >= ?" + (binds.length + 1));
          binds.push(from);
        }
        if (to) {
          conds.push("COALESCE(start_date, '') <= ?" + (binds.length + 1));
          binds.push(to);
        }
        if (upcoming) {
          conds.push("COALESCE(start_date, '9999') >= ?" + (binds.length + 1));
          binds.push((/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
        }
        const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
        const rows = await env.PERSONAL.prepare(`SELECT * FROM events ${where} ORDER BY COALESCE(start_date, '9999') ASC, ingested_at DESC LIMIT ?${binds.length + 1}`).bind(...binds, limit).all();
        return json({ ok: true, count: rows.results.length, events: rows.results }, cors);
      }
      if (url.pathname === "/browse" && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        const domain = url.searchParams.get("domain") || "";
        const days = Number(url.searchParams.get("days") || 0);
        const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
        const conds = [];
        const binds = [];
        if (q) {
          conds.push("(title LIKE ?1 OR url LIKE ?1 OR domain LIKE ?1)");
          binds.push(`%${q}%`);
        }
        if (domain) {
          conds.push("domain = ?" + (binds.length + 1));
          binds.push(domain);
        }
        if (days > 0) {
          const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
          conds.push("COALESCE(last_visit, '') >= ?" + (binds.length + 1));
          binds.push(cutoff);
        }
        const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
        const rows = await env.PERSONAL.prepare(`SELECT url, title, domain, visit_count, last_visit, first_visit FROM browse ${where} ORDER BY visit_count DESC LIMIT ?${binds.length + 1}`).bind(...binds, limit).all();
        return json({ ok: true, count: rows.results.length, browse: rows.results }, cors);
      }
      if (url.pathname === "/recommend" && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        const scope = url.searchParams.get("scope") || "all";
        const topK = Math.min(Number(url.searchParams.get("topK") || 15), 50);
        if (!q) return json({ ok: false, error: "missing q" }, cors, 400);
        const [vector] = await embed(env, [q]);
        if (!vector) return json({ ok: false, error: "embed failed" }, cors, 500);
        const want = /* @__PURE__ */ __name((s) => scope === "all" || scope === s, "want");
        const items = [];
        const scanK = Math.min(Math.max(topK * 3, 30), 40);
        const full = await env.VZ.query(vector, { topK: scanK, returnValues: false, returnMetadata: "all" });
        const typed = /* @__PURE__ */ __name((doc) => (full.matches || []).filter((h) => (h.metadata || {}).doc === doc), "typed");
        if (want("profile")) {
          for (const h of typed("profile")) {
            const id = (h.metadata || {}).id;
            if (!id) continue;
            const row = await env.PERSONAL.prepare("SELECT id, facet, label, statement, evidence FROM profile WHERE id = ?1").bind(id).first();
            if (row) items.push({ doc: "profile", id, score: h.score, facet: row.facet, label: row.label, statement: row.statement, evidence: row.evidence });
          }
        }
        if (want("events")) {
          for (const h of typed("event")) {
            const id = (h.metadata || {}).id;
            if (!id) continue;
            const row = await env.PERSONAL.prepare("SELECT * FROM events WHERE id = ?1").bind(id).first();
            if (row) items.push({ doc: "event", id, score: h.score, category: row.category, title: row.title, venue: row.venue, city: row.city, start_date: row.start_date, end_date: row.end_date, amount: row.amount, currency: row.currency, source: row.source, energy: row.energy, energy_label: row.energy_label });
          }
        }
        if (want("files")) {
          for (const h of full.matches || []) {
            const m = h.metadata || {};
            if (m.doc === "profile" || m.doc === "event" || m.doc === "browse") continue;
            items.push({ doc: "file", path: m.path, score: h.score, category: m.category, snippet: (m.text || "").slice(0, 400) });
          }
        }
        if (want("browse")) {
          for (const h of typed("browse")) {
            const m = h.metadata || {};
            items.push({ doc: "browse", url: m.url, title: m.title, domain: m.domain, visits: m.visit_count, last_visit: m.last_visit, score: h.score });
          }
        }
        items.sort((a, b) => b.score - a.score);
        return json({ ok: true, query: q, scope, count: items.length, items: items.slice(0, topK) }, cors);
      }
      if (url.pathname === "/activity" && request.method === "GET") {
        const days = Math.min(Number(url.searchParams.get("days") || 30), 365);
        const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
        const rows = await env.PERSONAL.prepare("SELECT date, title, category, venue, city, notes, energy, energy_label FROM activity WHERE date >= ?1 ORDER BY date DESC LIMIT 100").bind(from).all();
        return json({ ok: true, count: rows.results.length, activity: rows.results }, cors);
      }
      if (url.pathname === "/ingest" && request.method === "POST") {
        const token = request.headers.get("X-Index-Token") || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
        if (token !== env.INDEX_TOKEN) return json({ ok: false, error: "unauthorized \u2014 X-Index-Token required" }, cors, 401);
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: "invalid JSON body" }, cors, 400);
        }
        const items = Array.isArray(body.items) ? body.items : [];
        const counts = { profile: 0, event: 0, browse: 0, email: 0, activity: 0, vectors: 0, errors: 0 };
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const vbuf = [];
        const dbuf = [];
        for (const it of items.slice(0, 200)) {
          try {
            const doc = it.doc || "";
            if (doc === "profile") {
              const id = String(it.id || "").trim();
              const facet = sanitize(it.facet || "", 60);
              const label = sanitize(it.label || "", 120);
              const statement = sanitize(it.statement || "", 1500);
              if (!id || !facet || !statement) {
                counts.errors++;
                continue;
              }
              const evidence = sanitize(it.evidence || "", 800);
              const confidence = Number(it.confidence || 0.7);
              dbuf.push(env.PERSONAL.prepare(
                `INSERT INTO profile (id, facet, label, statement, evidence, confidence, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7)
                 ON CONFLICT(id) DO UPDATE SET facet=?2, label=?3, statement=?4, evidence=?5, confidence=?6, updated_at=?7`
              ).bind(id, facet, label, statement, evidence, confidence, now));
              const [vec] = await embed(env, [statement.slice(0, 1e3)]);
              if (vec) vbuf.push({ id: "p:" + await sha16(id), values: vec, metadata: { doc: "profile", id, facet, label, text: statement.slice(0, 800) } });
              counts.profile++;
            } else if (doc === "event") {
              const id = String(it.id || "").trim();
              const category = sanitize(it.category || "other", 40);
              const title = sanitize(it.title || "", 300);
              if (!id || !title) {
                counts.errors++;
                continue;
              }
              if (id.startsWith("evt-auto:")) {
                const sd = sanitize(it.start_date || "", 10);
                if (sd) {
                  const dup = await env.PERSONAL.prepare(
                    "SELECT id FROM events WHERE start_date = ?1 AND category = ?2 AND id NOT LIKE 'evt-auto:%' LIMIT 1"
                  ).bind(sd, category).first();
                  if (dup) {
                    counts.errors++;
                    continue;
                  }
                }
              }
              const venue = sanitize(it.venue || "", 200);
              const city = sanitize(it.city || "", 100);
              const country = sanitize(it.country || "", 80);
              const start_date = sanitize(it.start_date || "", 10);
              const end_date = sanitize(it.end_date || "", 10);
              const amount = Number(it.amount) || null;
              const currency = sanitize(it.currency || "", 8);
              const booking_ref = sanitize(it.booking_ref || "", 100);
              const source = sanitize(it.source || "", 300);
              const source_subject = sanitize(it.source_subject || "", 400);
              const energy = Number(it.energy) || null;
              const energy_label = sanitize(it.energy_label || "", 20);
              const notes = sanitize(it.notes || "", 800);
              dbuf.push(env.PERSONAL.prepare(
                `INSERT INTO events (id, category, title, venue, city, country, start_date, end_date, amount, currency, booking_ref, source, source_subject, energy, energy_label, notes, ingested_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
                 ON CONFLICT(id) DO UPDATE SET category=?2, title=?3, venue=?4, city=?5, country=?6, start_date=?7, end_date=?8, amount=?9, currency=?10, booking_ref=?11, source=?12, source_subject=?13, energy=?14, energy_label=?15, notes=?16, ingested_at=?17`
              ).bind(id, category, title, venue, city, country, start_date, end_date, amount, currency, booking_ref, source, source_subject, energy, energy_label, notes, now));
              const emb = `${title} | ${category} | ${venue} | ${city} | ${country} | ${notes}`.slice(0, 1e3);
              const [vec] = await embed(env, [emb]);
              if (vec) vbuf.push({ id: "e:" + await sha16(id), values: vec, metadata: { doc: "event", id, category, title, start_date, venue, city, text: emb.slice(0, 800) } });
              counts.event++;
            } else if (doc === "browse") {
              const burl = String(it.url || "").trim();
              if (!burl) {
                counts.errors++;
                continue;
              }
              const title = sanitize(it.title || "", 300);
              const domain = sanitize(it.domain || "", 120);
              const visit_count = Number(it.visit_count || 0);
              const last_visit = sanitize(it.last_visit || "", 40);
              const first_visit = sanitize(it.first_visit || "", 40);
              dbuf.push(env.PERSONAL.prepare(
                `INSERT INTO browse (url, title, domain, visit_count, last_visit, first_visit, indexed_at) VALUES (?1,?2,?3,?4,?5,?6,?7)
                 ON CONFLICT(url) DO UPDATE SET title=?2, domain=?3, visit_count=?4, last_visit=?5, first_visit=?6, indexed_at=?7`
              ).bind(burl, title, domain, visit_count, last_visit, first_visit, now));
              if (visit_count >= 20) {
                const [vec] = await embed(env, [`${title} | ${domain}`.slice(0, 900)]);
                if (vec) vbuf.push({ id: "b:" + await sha16(burl), values: vec, metadata: { doc: "browse", url: burl.slice(0, 500), title: title.slice(0, 300), domain, visit_count, last_visit } });
              }
              counts.browse++;
            } else if (doc === "email") {
              const message_id = String(it.message_id || "").trim();
              if (!message_id) {
                counts.errors++;
                continue;
              }
              const store = sanitize(it.store || "", 100);
              const folder = sanitize(it.folder || "", 100);
              const sender = sanitize(it.sender || "", 200);
              const subject = sanitize(it.subject || "", 400);
              const received_at = sanitize(it.received_at || "", 40);
              const category = sanitize(it.category || "", 40);
              const event_id = sanitize(it.event_id || "", 120);
              const summary = sanitize(it.summary || "", 800);
              dbuf.push(env.PERSONAL.prepare(
                `INSERT INTO email_index (message_id, store, folder, sender, subject, received_at, category, event_id, summary, ingested_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
                 ON CONFLICT(message_id) DO UPDATE SET store=?2, folder=?3, sender=?4, subject=?5, received_at=?6, category=?7, event_id=?8, summary=?9, ingested_at=?10`
              ).bind(message_id, store, folder, sender, subject, received_at, category, event_id, summary, now));
              const [vec] = await embed(env, [`${subject} | ${sender} | ${summary}`.slice(0, 900)]);
              if (vec) vbuf.push({ id: "em:" + await sha16(message_id), values: vec, metadata: { doc: "email", message_id, subject: subject.slice(0, 300), sender: sender.slice(0, 150), received_at, category, text: `${subject} | ${sender} | ${summary}`.slice(0, 800) } });
              counts.email++;
            } else if (doc === "activity") {
              const adate = sanitize(it.date || "", 10);
              const atitle = sanitize(it.title || "", 300);
              if (!adate || !atitle) {
                counts.errors++;
                continue;
              }
              const venue = sanitize(it.venue || "", 200);
              const city = sanitize(it.city || "", 100);
              const notes = sanitize(it.notes || "", 800);
              const category = sanitize(it.category || "other", 40);
              const energy = Number(it.energy) || null;
              const energy_label = sanitize(it.energy_label || "", 20);
              await env.PERSONAL.prepare("CREATE TABLE IF NOT EXISTS activity (date TEXT, title TEXT, category TEXT, venue TEXT, city TEXT, notes TEXT, energy REAL, energy_label TEXT, ingested_at TEXT, PRIMARY KEY(date, title))").run();
              dbuf.push(env.PERSONAL.prepare("INSERT INTO activity (date, title, category, venue, city, notes, energy, energy_label, ingested_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(date, title) DO UPDATE SET category=?3, venue=?4, city=?5, notes=?6, energy=?7, energy_label=?8, ingested_at=?9").bind(adate, atitle, category, venue, city, notes, energy, energy_label, now));
              const [vec] = await embed(env, [(atitle + " | " + category + " | " + venue + " | " + notes).slice(0, 900)]);
              if (vec) vbuf.push({ id: "act:" + await sha16(adate + atitle), values: vec, metadata: { doc: "activity", date: adate, title: atitle, category: category, venue: venue, text: (atitle + " - " + notes).slice(0, 800) } });
              counts.activity++;
            } else {
              counts.errors++;
            }
          } catch (e) {
            counts.errors++;
          }
        }
        if (dbuf.length) {
          try {
            await env.PERSONAL.batch(dbuf);
          } catch (e) {
            counts.errors += dbuf.length;
          }
        }
        counts.vectors = await safeUpsert(env, vbuf);
        return json({ ok: true, ...counts }, cors);
      }
      return json({ ok: false, error: "not found" }, cors, 404);
    } catch (e) {
      return json({ ok: false, error: "EXCEPTION: " + (e && e.message || String(e)), stack: (e && e.stack || "").slice(0, 800) }, {}, 500);
    }
  }
};
export {
  search_default as default
};
//# sourceMappingURL=search.js.map
