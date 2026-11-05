/**
 * qnfo-skills-discovery — Agent Skills Discovery endpoint (RFC 8615 + RFC 0.2.0)
 *
 * Implements the Agent Skills Discovery mechanism (forked spec:
 * https://github.com/QNFO/agent-skills-discovery-rfc, upstream
 * cloudflare/agent-skills-discovery-rfc v0.2.0).
 *
 * Serves:
 *   GET /.well-known/agent-skills/index.json   — RFC 0.2.0 discovery index
 *   GET /.well-known/agent-skills/{name}/SKILL.md — skill artifact (type: skill-md)
 *
 * Data source: R2 bucket `qnfo-skills` — the canonical skills mirror kept in
 * sync by the skill-sync Worker (qnfo-skill-sync). The bucket holds top-level
 * skill directories each containing SKILL.md.
 *
 * Compliance notes (RFC 0.2.0):
 *  - index served as application/json
 *  - SKILL.md served as text/markdown
 *  - GET + HEAD supported
 *  - 404 for missing skills/files
 *  - Cache-Control headers set
 *  - CORS headers for browser-based clients
 *  - digest = sha256 of the raw artifact bytes (sha256:{hex})
 */
const SCHEMA_URI = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
const WELL_KNOWN = "/.well-known/agent-skills/";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const VERSION = "1.1.0";
const WORKER_NAME = "qnfo-skills-discovery";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (method !== "GET" && method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: CORS });
    }

    // Discovery index
    if (path === WELL_KNOWN + "index.json") {
      const index = await buildIndex(env.SKILLS_BUCKET);
      const body = JSON.stringify(index, null, 2);
      return new Response(method === "HEAD" ? null : body, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
          ...CORS,
        },
      });
    }

    // Skill artifact: /.well-known/agent-skills/{name}/SKILL.md
    if (path.startsWith(WELL_KNOWN)) {
      const rest = path.slice(WELL_KNOWN.length);
      const parts = rest.split("/");
      if (parts.length === 2 && parts[1] === "SKILL.md") {
        const name = parts[0];
        const obj = await env.SKILLS_BUCKET.get(`${name}/SKILL.md`);
        if (!obj) {
          return new Response("Not Found", { status: 404, headers: CORS });
        }
        return new Response(method === "HEAD" ? null : obj.body, {
          status: 200,
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            ETag: obj.httpEtag,
            ...CORS,
          },
        });
      }
      return new Response("Not Found", { status: 404, headers: CORS });
    }

    if (path === "/health") {
      const body = JSON.stringify({ ok: true, worker: WORKER_NAME, version: VERSION });
      return new Response(body, { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    return new Response("Not Found", { status: 404, headers: CORS });
  },
};

/**
 * Build the RFC 0.2.0 discovery index by scanning the R2 bucket for top-level
 * skill directories containing SKILL.md, parsing frontmatter, and computing
 * SHA-256 digests of the raw artifact bytes.
 */
async function buildIndex(bucket) {
  const skills = [];
  const seen = new Set();
  let cursor = undefined;

  do {
    const list = await bucket.list({ limit: 1000, cursor });
    for (const obj of list.objects) {
      if (!obj.key.endsWith("/SKILL.md")) continue;
      const parts = obj.key.split("/");
      if (parts.length !== 2) continue; // top-level skills only
      const dir = parts[0];
      if (seen.has(dir)) continue;
      seen.add(dir);

      const skillObj = await bucket.get(obj.key);
      if (!skillObj) continue;
      const text = await skillObj.text();
      const meta = parseFrontmatter(text);
      if (!meta.name || !meta.description) continue;

      skills.push({
        name: meta.name,
        type: "skill-md",
        description: meta.description,
        url: `${WELL_KNOWN}${dir}/SKILL.md`,
        digest: `sha256:${await sha256Hex(text)}`,
      });
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { $schema: SCHEMA_URI, skills };
}

/** Minimal YAML frontmatter extractor (name + description, single-line). */
function parseFrontmatter(text) {
  const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  if (!m) return { name: null, description: null };
  const fm = m[1];
  const nameM = fm.match(/^name\s*:\s*["']?([^"'\r\n]+)["']?\s*$/m);
  const descM = fm.match(/^description\s*:\s*["']?(.*?)["']?\s*$/m);
  return {
    name: nameM ? nameM[1].trim() : null,
    description: descM ? descM[1].trim() : null,
  };
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
