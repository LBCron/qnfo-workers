var __defProp = Object.defineProperty;
var VERSION = "1.1.3"; // Worker Contract v1: VERSION constant == /health version

var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
__name(json, "json");
function base64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
__name(base64Encode, "base64Encode");
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
__name(readJson, "readJson");
async function githubFetch(env, path, init = {}) {
  const headers = {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "qnfo-skill-sync",
    ...init.headers || {}
  };
  return fetch(`https://api.github.com${path}`, { ...init, headers });
}
__name(githubFetch, "githubFetch");
function normalizeTitle(t) {
  if (!t) return t;
  let s = String(t).trim();
  s = s.replace(/\b[A-Za-z0-9_-]{20,}\b/g, "<id>");
  s = s.replace(/\s+/g, " ");
  return s.slice(0, 500);
}
__name(normalizeTitle, "normalizeTitle");
var EXTRACT_PROMPT = `You are the QNFO kaizen issue extractor. Analyze DeepChat session records and extract ONLY real, actionable issues, errors, or optimization opportunities.

Session record format:
- title: the session's first user message (context only - a task prompt, NOT evidence of failure)
- [ERROR] flag + error_sample: the ACTUAL failure text captured from a status='error' message. error_sample is the PRIMARY evidence for 'error' issues - base error titles on it, never on the title.
- summary: first user message text (context only)

Rules:
- Only extract real, actionable items. Ignore routine session chatter and task prompts that merely mention error-related words.
- NEVER create generic titles like "Error in Session <id>". Use a short, specific title from the actual error text (e.g. "chat_logs INSERT failed: no column error_sample").
- A session with no [ERROR] flag and nothing concretely actionable should yield NO items.
- If the session clearly involves a specific DeepChat skill (e.g. research, email-composer, cloudflare, kaizen, qnfo-core, computer-use), include "skill": "<skill-name>" (lowercase skill name); otherwise omit it.
- For each item output JSON: title (short, specific), description (1-2 sentences), category (error | optimization | request | infrastructure), priority (high | medium | low), skill (optional, lowercase).
- Prioritize: errors -> high; resource/infrastructure problems -> high; user requests -> medium; minor optimizations -> low.
- Output ONLY a JSON array. No markdown, no commentary.

SESSION RECORDS:
{summaries}

OUTPUT:`;
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Sync-Token" } });
    }
    if (method === "POST" || method === "PATCH") {
      const auth = request.headers.get("X-Sync-Token");
      if (!auth || !env.SYNC_TOKEN || auth !== env.SYNC_TOKEN) {
        return json({ error: "Unauthorized: missing or invalid X-Sync-Token" }, 401);
      }
    }
    if (url.pathname === "/health") {
      return json({
        worker: "qnfo-skill-sync",
        version: VERSION,
        status: "ok",
        capabilities: ["skill-extraction", "skill-dedup", "stale-issue-close", "skill-source-issues"],
        limitations: ["one sync per day (03:00)", "an async run handles at most 30 rows (20-minute lock TTL)", "skill-source issues need GITHUB_TOKEN"],
        changelog: ["W6 extractor v2 + normalized dedup", "W7 stale issue auto-close", "W8 skill-source issues", "error_sample persisted", "v1.1.1 lock TTL reclaim", "v1.1.2 TTL 20min + async cap 30 rows"],
        bindings: { d1: !!env.AUDIT_DB, r2: !!env.SKILLS_BUCKET, ai: !!env.AI, github_token: !!env.GITHUB_TOKEN },
        cron: "0 3 * * *"
      });
    }
    if (url.pathname === "/log/chat" && method === "POST") {
      const len = Number(request.headers.get("Content-Length") || 0);
      if (len > 2e4) return json({ error: "payload too large (max 20KB)" }, 413);
      const body = await readJson(request);
      if (!body || !body.session_id) return json({ error: "session_id required" }, 400);
      const createdAt = body.created_at || Date.now();
      const res = await env.AUDIT_DB.prepare(
        "INSERT INTO chat_logs (session_id, source, provider_id, model_id, title, message_count, summary, error_flag, error_count, error_sample, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(
        body.session_id.slice(0, 200),
        body.source || "deepchat",
        body.provider_id || null,
        body.model_id || null,
        (body.title || "").slice(0, 500),
        body.message_count || 0,
        (body.summary || "").slice(0, 8e3),
        body.error_flag ? 1 : 0,
        body.error_count || 0,
        (body.error_sample || "").slice(0, 1e3),
        createdAt
      ).run();
      return json({ success: true, id: res.meta.last_row_id });
    }
    if (url.pathname === "/issues" && method === "POST") {
      const len = Number(request.headers.get("Content-Length") || 0);
      if (len > 2e4) return json({ error: "payload too large (max 20KB)" }, 413);
      const body = await readJson(request);
      if (!body || !body.title) return json({ error: "title required" }, 400);
      const now = Date.now();
      const res = await env.AUDIT_DB.prepare(
        "INSERT INTO agent_issues (title, description, source, category, priority, status, linked_session, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
      ).bind(
        body.title.slice(0, 500),
        (body.description || "").slice(0, 4e3),
        body.source || "user",
        body.category || "optimization",
        body.priority || "medium",
        "open",
        body.linked_session || null,
        now,
        now
      ).run();
      return json({ success: true, id: res.meta.last_row_id });
    }
    if (url.pathname === "/issues" && method === "GET") {
      const status = url.searchParams.get("status") || "open";
      const category = url.searchParams.get("category");
      const priority = url.searchParams.get("priority");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
      let sql = "SELECT * FROM agent_issues WHERE status = ?";
      const params = [status];
      if (category) {
        sql += " AND category = ?";
        params.push(category);
      }
      if (priority) {
        sql += " AND priority = ?";
        params.push(priority);
      }
      sql += " ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC LIMIT ?";
      params.push(limit);
      const res = await env.AUDIT_DB.prepare(sql).bind(...params).all();
      return json({ count: res.results.length, issues: res.results });
    }
    const issueMatch = url.pathname.match(/^\/issues\/(\d+)$/);
    if (issueMatch && method === "PATCH") {
      const body = await readJson(request);
      const id = issueMatch[1];
      const status = body?.status;
      if (!["open", "in_progress", "done", "wontfix", "blocked"].includes(status)) {
        return json({ error: "invalid status" }, 400);
      }
      await env.AUDIT_DB.prepare(
        "UPDATE agent_issues SET status = ?, updated_at = ? WHERE id = ?"
      ).bind(status, Date.now(), id).run();
      return json({ success: true, id: Number(id), status });
    }
    if (url.pathname === "/kaizen/run" && method === "POST") {
      const sync = url.searchParams.get("sync") === "true";
      if (sync) {
        const report = await runKaizenCycle(env);
        return json(report);
      }
      ctx.waitUntil(runKaizenCycle(env, 30));
      return json({ success: true, message: "kaizen cycle started (async, <=30 rows)" });
    }
    if (url.pathname === "/skills/status") {
      const gh = await githubFetch(env, `/repos/${env.SKILLS_REPO}/commits/${env.SKILLS_BRANCH}`);
      const ghJson = gh.ok ? await gh.json() : null;
      const ghSha = ghJson?.sha || null;
      const ghErr = gh.ok ? null : await gh.text();
      const snap = await env.SKILLS_BUCKET.get("_sync/last-snapshot.json");
      const snapData = snap ? JSON.parse(await snap.text()) : null;
      return json({
        repo: env.SKILLS_REPO,
        branch: env.SKILLS_BRANCH,
        github_head: ghSha,
        github_error: ghErr ? ghErr.slice(0, 300) : null,
        r2_snapshot_sha: snapData?.sha || null,
        r2_snapshot_at: snapData?.at || null,
        in_sync: ghSha !== null && ghSha === snapData?.sha
      });
    }
    if (url.pathname === "/") {
      return json({
        worker: "qnfo-skill-sync",
        version: "1.1.2",
        endpoints: {
          "POST /log/chat": "Ingest DeepChat session log { session_id, title, summary, message_count, error_flag?, error_count?, error_sample? }",
          "POST /issues": "Create issue { title, description?, category?, priority?, source? }",
          "GET /issues": "List issues ?status=open&category=&priority=&limit=",
          "PATCH /issues/:id": "Update issue status { status: open|in_progress|done|wontfix|blocked }",
          "POST /kaizen/run": "Trigger kaizen cycle (?sync=true for synchronous)",
          "GET /skills/status": "GitHub vs R2 sync status",
          "GET /health": "Health and bindings"
        }
      });
    }
    return json({ error: "Not found" }, 404);
  },
  // Daily cron: 03:00 UTC
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runKaizenCycle(env));
  }
};
async function runKaizenCycle(env, limit = 100) {
  const started = Date.now();
  const report = { date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), extracted: 0, issues: 0, staleClosed: 0, reportUrl: null, errors: [] };
  try {
    const reclaimed = await env.AUDIT_DB.prepare(
      "DELETE FROM kaizen_locks WHERE lock_key = 'cycle' AND started_at < ?"
    ).bind(started - 20 * 60 * 1e3).run();
    if (reclaimed.meta.changes > 0) report.staleLockReclaimed = true;
  } catch (e) {
  }
  try {
    const lock = await env.AUDIT_DB.prepare(
      "INSERT INTO kaizen_locks (lock_key, started_at) VALUES ('cycle', ?) ON CONFLICT(lock_key) DO NOTHING"
    ).bind(started).run();
    if (lock.meta.changes === 0) {
      return { ...report, errors: ["kaizen cycle already running - skipped"] };
    }
  } catch (e) {
    await env.AUDIT_DB.prepare(
      "CREATE TABLE IF NOT EXISTS kaizen_locks (lock_key TEXT PRIMARY KEY, started_at INTEGER)"
    ).run();
    const retry = await env.AUDIT_DB.prepare(
      "INSERT INTO kaizen_locks (lock_key, started_at) VALUES ('cycle', ?) ON CONFLICT(lock_key) DO NOTHING"
    ).bind(started).run();
    if (retry.meta.changes === 0) {
      return { ...report, errors: ["kaizen cycle already running - skipped"] };
    }
  }
  try {
    try {
      const stale = await env.AUDIT_DB.prepare(
        "UPDATE agent_issues SET status = 'wontfix', updated_at = ? WHERE source = 'kaizen-ai' AND status = 'open' AND updated_at < ?"
      ).bind(Date.now(), Date.now() - 30 * 864e5).run();
      report.staleClosed = stale.meta.changes;
    } catch (e) {
      report.errors.push(`stale-close: ${e.message}`);
    }
    const logs = await env.AUDIT_DB.prepare(
      "SELECT id, session_id, title, summary, error_flag, error_sample FROM chat_logs WHERE processed = 0 ORDER BY id DESC LIMIT ?"
    ).bind(limit).all();
    if (logs.results.length > 0) {
      const BATCH = 6;
      for (let bi = 0; bi < logs.results.length; bi += BATCH) {
        const batch = logs.results.slice(bi, bi + BATCH);
        const summaries = batch.map((l) => {
          const flag = l.error_flag ? " [ERROR]" : "";
          const es = l.error_sample ? `
  error_sample: ${String(l.error_sample).slice(0, 500)}` : "";
          return `- Session ${l.session_id}${flag}: ${l.title || "untitled"}
  summary: ${(l.summary || "").slice(0, 300)}${es}`;
        }).join("\n");
        const aiResp = await env.AI.run(
          "@cf/zai-org/glm-5.3",
          { messages: [{ role: "user", content: EXTRACT_PROMPT.replace("{summaries}", summaries) }], max_tokens: 2048, temperature: 0.2 }
        );
        let items = [];
        if (Array.isArray(aiResp?.response)) {
          items = aiResp.response;
        } else {
          let text = "";
          if (typeof aiResp === "string") text = aiResp;
          else if (typeof aiResp?.choices?.[0]?.message?.content === "string") text = aiResp.choices[0].message.content;
          else if (typeof aiResp?.response === "string") text = aiResp.response;
          else if (typeof aiResp?.content === "string") text = aiResp.content;
          else text = JSON.stringify(aiResp);
          const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
          const firstJsonBlock = /* @__PURE__ */ __name((s) => {
            const open2 = s.indexOf("{");
            const openArr = s.indexOf("[");
            let start;
            if (openArr >= 0 && (open2 < 0 || openArr < open2)) start = openArr;
            else if (open2 >= 0) start = open2;
            else return null;
            let depth = 0, inStr = false, esc = false;
            for (let i = start; i < s.length; i++) {
              const c = s[i];
              if (inStr) {
                if (esc) esc = false;
                else if (c === "\\") esc = true;
                else if (c === '"') inStr = false;
                continue;
              }
              if (c === '"') inStr = true;
              else if (c === "{" || c === "[") depth++;
              else if (c === "}" || c === "]") {
                depth--;
                if (depth === 0) return s.slice(start, i + 1);
              }
            }
            return null;
          }, "firstJsonBlock");
          const block = firstJsonBlock(cleaned);
          if (block) {
            try {
              const parsed = JSON.parse(block);
              if (!Array.isArray(parsed) && typeof parsed === "object") {
                for (const k of ["issues", "items", "results", "findings"]) {
                  if (Array.isArray(parsed[k])) {
                    items = parsed[k];
                    break;
                  }
                }
                if (items.length === 0 && Object.values(parsed).some((v) => v && typeof v === "object" && !Array.isArray(v))) {
                  items = Object.values(parsed).filter((v) => v && typeof v === "object" && !Array.isArray(v));
                }
              } else {
                items = Array.isArray(parsed) ? parsed : [parsed];
              }
            } catch (e) {
              report.errors.push(`AI parse: ${e.message}`);
            }
          } else {
            report.errors.push("AI parse: no complete JSON block found in response");
          }
          if (items.length === 0 && bi === 0) report.rawAI = text.slice(0, 1500);
        }
        const now = Date.now();
        for (const item of items.slice(0, 20)) {
          if (!item.title) continue;
          const priority = ["high", "medium", "low"].includes(item.priority) ? item.priority : "medium";
          const category = ["error", "optimization", "request", "infrastructure"].includes(item.category) ? item.category : "optimization";
          const normTitle = normalizeTitle(item.title);
          if (!normTitle) continue;
          const source = typeof item.skill === "string" && item.skill.trim() ? item.skill.trim().toLowerCase().slice(0, 100) : "kaizen-ai";
          const dup = await env.AUDIT_DB.prepare(
            "SELECT id FROM agent_issues WHERE title = ? AND source = ? AND status = 'open' LIMIT 1"
          ).bind(normTitle, source).first();
          if (dup) continue;
          await env.AUDIT_DB.prepare(
            "INSERT INTO agent_issues (title, description, source, category, priority, status, linked_session, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
          ).bind(
            normTitle,
            (item.description || "").slice(0, 4e3),
            source,
            category,
            priority,
            "open",
            null,
            now,
            now
          ).run();
          report.extracted++;
        }
        for (const l of batch) {
          await env.AUDIT_DB.prepare("UPDATE chat_logs SET processed = 1 WHERE id = ?").bind(l.id).run();
        }
      }
    }
    const open = await env.AUDIT_DB.prepare(
      "SELECT priority, COUNT(*) as n FROM agent_issues WHERE status = 'open' GROUP BY priority"
    ).all();
    report.issues = open.results.reduce((a, r) => a + r.n, 0);
    report.byPriority = Object.fromEntries(open.results.map((r) => [r.priority, r.n]));
    const body = [
      `# Kaizen Report - ${report.date}`,
      "",
      `- Generated: ${(/* @__PURE__ */ new Date()).toISOString()}`,
      `- Chat logs scanned: ${logs.results.length}`,
      `- Issues extracted: ${report.extracted}`,
      `- Stale auto-closed: ${report.staleClosed || 0}`,
      `- Open issues total: ${report.issues}`,
      `- By priority: ${JSON.stringify(report.byPriority || {})}`,
      report.errors.length ? `- Errors: ${report.errors.join("; ")}` : "- Errors: none",
      "",
      "## Next actions",
      "1. Pull prioritized issues: `GET /issues?status=open&priority=high`",
      "2. Execute local: `python .deepchat/scripts/pull_skills.py`",
      ""
    ].join("\n");
    const repId = `sync-${report.date}`;
    await env.AUDIT_DB.prepare(
      `INSERT INTO kaizen_reports (id, session_id, report_date, findings, improvements_applied, _version, wbs_code)
       VALUES (?,?,?,?,?,2,'SYN-E0')
       ON CONFLICT(id) DO UPDATE SET report_date=excluded.report_date, findings=excluded.findings, improvements_applied=excluded.improvements_applied`
    ).bind(repId, "cron-sync", report.date, body, JSON.stringify(report)).run();
    try {
      const path = `kaizen-reports/${report.date}.md`;
      const b64 = base64Encode(body);
      let sha = null;
      const existing = await githubFetch(env, `/repos/${env.SKILLS_REPO}/contents/${path}`, { headers: { ref: env.SKILLS_BRANCH } });
      if (existing.ok) {
        const ex = await existing.json();
        sha = ex.sha;
      }
      const putResp = await githubFetch(env, `/repos/${env.SKILLS_REPO}/contents/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `kaizen: daily report ${report.date} [bot]`,
          content: b64,
          branch: env.SKILLS_BRANCH,
          ...sha ? { sha } : {}
        })
      });
      if (putResp.ok) {
        const pr = await putResp.json();
        report.reportUrl = pr.content?.html_url || pr.content?.git_url || null;
        if (pr.commit?.sha) {
          await env.SKILLS_BUCKET.put("_sync/last-snapshot.json", JSON.stringify({
            sha: pr.commit.sha,
            at: (/* @__PURE__ */ new Date()).toISOString(),
            report: report.date
          }), { httpMetadata: { contentType: "application/json" } });
        }
      } else {
        const errText = await putResp.text();
        report.errors.push(`GitHub push: ${putResp.status} ${errText.slice(0, 200)}`);
      }
    } catch (e) {
      report.errors.push(`GitHub push: ${e.message}`);
    }
    try {
      const existing = await env.SKILLS_BUCKET.get("_sync/last-snapshot.json");
      if (existing && JSON.parse(await existing.text()).report === report.date) {
      } else {
        const gh = await githubFetch(env, `/repos/${env.SKILLS_REPO}/commits/${env.SKILLS_BRANCH}`);
        if (gh.ok) {
          const head = await gh.json();
          await env.SKILLS_BUCKET.put("_sync/last-snapshot.json", JSON.stringify({
            sha: head.sha,
            at: (/* @__PURE__ */ new Date()).toISOString(),
            report: report.date
          }), { httpMetadata: { contentType: "application/json" } });
        }
      }
    } catch (e) {
      report.errors.push(`R2 snapshot: ${e.message}`);
    }
  } catch (e) {
    report.errors.push(`Cycle: ${e.message}`);
  }
  try {
    await env.AUDIT_DB.prepare("DELETE FROM kaizen_locks WHERE lock_key = 'cycle'").run();
  } catch (e) {
    report.errors.push(`Lock release: ${e.message}`);
  }
  report.durationMs = Date.now() - started;
  return report;
}
__name(runKaizenCycle, "runKaizenCycle");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map