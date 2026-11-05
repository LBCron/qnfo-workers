var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// indexer.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var indexer_default = {
  async scheduled(event, env, ctx) {
    console.log(`[indexer] cron: ${event.cron} \u2014 one slice of 400`);
    ctx.waitUntil(indexAll(env, { limit: 300, scanCap: 400 }));
  },
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      };
      if (request.method === "OPTIONS") return new Response(null, { headers: cors, status: 204 });
      if (url.pathname === "/health") {
        return json({ ok: true, worker: "personal-life-indexer", index: "personal-life", version: "v2.5-index-auth" }, cors);
      }
      if (url.pathname === "/index") {
        const token = request.headers.get("X-Index-Token") || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
        if (token !== env.INDEX_TOKEN) {
          return json({ ok: false, error: "unauthorized \u2014 X-Index-Token required" }, cors, 401);
        }
        if (request.method !== "POST" && request.method !== "GET") return json({ ok: false, error: "method" }, cors, 405);
        const limit = Number(url.searchParams.get("limit") || 200);
        const scanCap = Number(url.searchParams.get("scanCap") || 400);
        const prefix = url.searchParams.get("prefix") || "";
        const cursor = url.searchParams.get("cursor") || void 0;
        const result = await indexAll(env, { limit, scanCap, prefix, cursor });
        return json({ ok: true, ...result }, cors);
      }
      if (url.pathname === "/files" && request.method === "GET") {
        const prefix = url.searchParams.get("prefix") || "";
        const limit = Number(url.searchParams.get("limit") || 50);
        const rows = await env.PERSONAL.prepare(
          "SELECT path, type, size, modified, indexed_at, chunks, category FROM files WHERE path LIKE ?1 ORDER BY modified DESC LIMIT ?2"
        ).bind(`%${prefix}%`, limit).all();
        return json({ ok: true, files: rows.results, count: rows.results.length }, cors);
      }
      return json({ ok: false, error: "not found" }, cors, 404);
    } catch (e) {
      return json({ ok: false, error: "EXCEPTION: " + (e && e.message || String(e)) }, {}, 500);
    }
  }
};
async function json(obj, cors = {}, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });
}
__name(json, "json");
__name2(json, "json");
var TEXT_EXTS = /* @__PURE__ */ new Set(["md", "txt", "csv", "tsv", "json", "html", "htm", "xml", "yaml", "yml", "tex", "bib", "mermaid", "log", "ini", "cfg", "conf", "rtf", "mdx", "markdown"]);
var NOISE_FRAGMENTS = ["node_modules", "/.git/", ".wrangler/", "/dist/", "/build/", "/.obsidian/workspace", "desktop.ini"];
function extOf(key) {
  const i = key.lastIndexOf(".");
  return i >= 0 ? key.slice(i + 1).toLowerCase() : "";
}
__name(extOf, "extOf");
__name2(extOf, "extOf");
function sanitize(s, max = 800) {
  return String(s || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/[\uD800-\uDFFF]/g, "").trim().slice(0, max);
}
__name(sanitize, "sanitize");
__name2(sanitize, "sanitize");
async function getObjectText(r2, key, maxBytes = 4 * 1024 * 1024) {
  try {
    const obj = await r2.get(key);
    if (!obj || obj.size > maxBytes) return null;
    const ext = extOf(key);
    if (!TEXT_EXTS.has(ext)) return null;
    const buf = await obj.arrayBuffer();
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  } catch (e) {
    return null;
  }
}
__name(getObjectText, "getObjectText");
__name2(getObjectText, "getObjectText");
function chunkText(text, size = 900, overlap = 120) {
  const chunks = [];
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  const n = clean.length;
  if (n < 60) return chunks;
  let i = 0;
  while (i < n) {
    let end = i + size;
    if (end > n) end = n;
    else {
      let lastNl = -1;
      for (let j = i; j < end; j++) if (clean.charCodeAt(j) === 10) lastNl = j;
      if (lastNl > i + size * 0.5) end = lastNl;
      else {
        let lastSp = -1;
        for (let j = i; j < end; j++) if (clean.charCodeAt(j) === 32) lastSp = j;
        if (lastSp > i + size * 0.5) end = lastSp;
      }
    }
    const chunk = clean.slice(i, end).trim();
    if (chunk.length >= 40) chunks.push(chunk);
    if (end >= n) break;
    if (end <= i) break;
    i = end - overlap;
  }
  return chunks;
}
__name(chunkText, "chunkText");
__name2(chunkText, "chunkText");
var CATEGORY_KEYWORDS = [
  ["finance", ["bank", "statement", "tax", "invoice", "receipt", "mortgage", "rent", "insurance", "salary", "paycheck", "visa card"]],
  ["health", ["medical", "doctor", "clinic", "prescription", "vaccin", "hospital", "therapy"]],
  ["legal", ["contract", "agreement", "will", "power of attorney", "court", "lawsuit", "notary", "settlement"]],
  ["housing", ["apartment", "lease", "landlord", "property", "utilities", "electricity", "water bill"]],
  ["identity", ["passport", "driving license", "residence permit", "visa", "birth certificate", "id card"]],
  ["work", ["resume", "cv", "interview", "offer letter", "employment", "reference"]],
  ["travel", ["flight", "boarding", "itinerary", "hotel", "booking", "ticket"]],
  ["education", ["diploma", "transcript", "degree", "course", "university", "certificate"]],
  ["personal", ["family", "photo", "journal", "diary", "letter"]]
];
function categorize(text, key) {
  const hay = (text + " " + key).toLowerCase();
  let best = "general", bestScore = 0;
  for (const [cat, kws] of CATEGORY_KEYWORDS) {
    let score = 0;
    for (const kw of kws) if (hay.includes(kw)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }
  return bestScore > 0 ? best : "general";
}
__name(categorize, "categorize");
__name2(categorize, "categorize");
async function sha256hex(s) {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest.slice(0, 16))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256hex, "sha256hex");
__name2(sha256hex, "sha256hex");
async function safeUpsert(env, batch, skipped) {
  if (batch.length === 0) return;
  try {
    await env.VZ.upsert(batch);
  } catch (e) {
    if (batch.length === 1) {
      const md = batch[0].metadata || {};
      skipped.push(md.path || "?");
      console.log(`[indexer] skipped bad vector id=${batch[0].id} path=${md.path}`);
      return;
    }
    const mid = Math.ceil(batch.length / 2);
    await safeUpsert(env, batch.slice(0, mid), skipped);
    await safeUpsert(env, batch.slice(mid), skipped);
  }
}
__name(safeUpsert, "safeUpsert");
__name2(safeUpsert, "safeUpsert");
async function indexAll(env, { limit, scanCap, prefix, cursor }) {
  const started = Date.now();
  let scanned = 0, indexed = 0, skipped = 0, errors = 0;
  let nextCursor = void 0;
  const skippedVectors = [];
  const regRows = await env.PERSONAL.prepare("SELECT path, size, modified FROM files").all();
  const registry = /* @__PURE__ */ new Map();
  for (const r of regRows.results || []) registry.set(r.path, `${r.size}|${r.modified}`);
  const vectorBuf = [];
  const d1Buf = [];
  async function flush() {
    if (vectorBuf.length) await safeUpsert(env, vectorBuf.splice(0, vectorBuf.length), skippedVectors);
    if (d1Buf.length) {
      try {
        await env.PERSONAL.batch(d1Buf.splice(0, d1Buf.length));
      } catch (e) {
        d1Buf.splice(0, d1Buf.length);
      }
    }
  }
  __name(flush, "flush");
  __name2(flush, "flush");
  const listed = await env.DDRIVE.list({ cursor, limit: 1e3, prefix: prefix || void 0 });
  nextCursor = listed.cursor || void 0;
  for (const obj of listed.objects || []) {
    scanned++;
    if (scanned > scanCap) break;
    const key = obj.key;
    if (NOISE_FRAGMENTS.some((f) => key.includes(f))) {
      skipped++;
      continue;
    }
    const ext = extOf(key);
    if (!TEXT_EXTS.has(ext)) {
      skipped++;
      continue;
    }
    const mod = obj.uploaded && obj.uploaded.toISOString() || (/* @__PURE__ */ new Date()).toISOString();
    const sig = `${obj.size}|${mod}`;
    if (registry.get(key) === sig) {
      skipped++;
      continue;
    }
    const text = await getObjectText(env.DDRIVE, key);
    if (!text) {
      skipped++;
      continue;
    }
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      skipped++;
      continue;
    }
    let vectors = [];
    try {
      const resp = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: chunks.slice(0, 32) }, { gateway: { id: "default" } });
      vectors = resp && resp.data || [];
    } catch (e) {
      errors++;
      continue;
    }
    const valid = vectors.filter((v) => Array.isArray(v) && v.length === 768).map((v) => v.map((x) => Number.isFinite(x) ? x : 0));
    if (valid.length === 0) {
      errors++;
      continue;
    }
    const cat = categorize(chunks.join(" "), key);
    const keyDigest = await sha256hex(key);
    const pathSan = sanitize(key, 500);
    for (let i = 0; i < valid.length; i++) {
      vectorBuf.push({
        id: `${keyDigest}:${i}`,
        values: valid[i],
        metadata: {
          path: pathSan,
          type: String(ext),
          chunk: String(i),
          category: String(cat),
          modified: String(mod),
          text: sanitize(chunks[i] || "", 800)
        }
      });
    }
    d1Buf.push(env.PERSONAL.prepare(
      `INSERT INTO files (path, type, size, modified, indexed_at, chunks, title, category)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(path) DO UPDATE SET size=?3, modified=?4, indexed_at=?5, chunks=?6, title=?7, category=?8`
    ).bind(key, ext, obj.size, mod, (/* @__PURE__ */ new Date()).toISOString(), valid.length, basename(key), cat));
    registry.set(key, sig);
    indexed++;
    if (indexed >= limit || vectorBuf.length >= 500) await flush();
  }
  await flush();
  return {
    scanned,
    indexed,
    skipped,
    errors,
    elapsedMs: Date.now() - started,
    cursor: nextCursor,
    done: !nextCursor,
    skippedVectors: skippedVectors.length
  };
}
__name(indexAll, "indexAll");
__name2(indexAll, "indexAll");
function basename(key) {
  const parts = key.split("/");
  return parts[parts.length - 1] || key;
}
__name(basename, "basename");
__name2(basename, "basename");
export {
  indexer_default as default
};
//# sourceMappingURL=indexer.js.map