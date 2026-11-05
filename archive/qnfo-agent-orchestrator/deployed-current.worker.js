var __defProp = Object.defineProperty;
var VERSION = "1.1.2-doi-scrub"; // Worker Contract v1: VERSION constant == /health version

var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
import { DurableObject } from "cloudflare:workers";
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var __defProp22 = Object.defineProperty;
var __name22 = /* @__PURE__ */ __name2((target, value) => __defProp22(target, "name", { value, configurable: true }), "__name");
var ARXIV_API = "https://export.arxiv.org/api/query";
function isPrivateHost(host) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h === "::1" || h === "[::1]") return true;
  if (/^(10\.|127\.|0\.|192\.168\.|169\.254\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}
__name(isPrivateHost, "isPrivateHost");
function cleanText(html) {
  return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
__name(cleanText, "cleanText");
async function arxivSearch(query, maxResults) {
  const n = Math.min(Math.max(Number(maxResults) || 5, 1), 10);
  const q = encodeURIComponent("all:" + String(query || ""));
  const r = await fetch(ARXIV_API + "?search_query=" + q + "&start=0&max_results=" + n);
  if (!r.ok) return { error: "arxiv HTTP " + r.status };
  const xml = await r.text();
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) && entries.length < n) {
    const e = m[1];
    const grab = /* @__PURE__ */ __name((tag) => {
      const re = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">");
      const mm = re.exec(e);
      return mm ? cleanText(mm[1]).slice(0, 500) : "";
    }, "grab");
    const idm = /<id>([\s\S]*?)<\/id>/.exec(e);
    const arxivId = idm ? idm[1].replace(/^.*\/(abs\/)?/, "").replace(/v\d+$/, "") : "";
    entries.push({ id: arxivId, title: grab("title"), summary: grab("summary"), authors: e.split("<author>").slice(1).map((a) => cleanText((/<name>([\s\S]*?)<\/name>/.exec(a) || [])[1] || "")).filter(Boolean).join(", "), published: grab("published"), link: idm ? idm[1] : "" });
  }
  return { count: entries.length, entries };
}
__name(arxivSearch, "arxivSearch");
async function ddgSearch(query, limit) {
  const qq = encodeURIComponent(String(query || ""));
  const ua = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "Accept": "text/html" };
  const n = Math.min(Math.max(Number(limit) || 5, 1), 8);
  for (const base of ["https://html.duckduckgo.com/html/?q=", "https://lite.duckduckgo.com/lite/?q="]) {
    try {
      const resp = await fetch(base + qq, { headers: ua });
      if (!resp.ok) continue;
      const html = await resp.text();
      const isLite = base.indexOf("lite") !== -1;
      const results = [];
      if (!isLite) {
        const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        const re2 = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
        const snips = [];
        let sm;
        while ((sm = re2.exec(html)) && snips.length < 10) snips.push(cleanText(sm[1]));
        let i = 0;
        let rm;
        while ((rm = re.exec(html)) && results.length < n) {
          let href = rm[1];
          try {
            const u = new URL(href, "https://duckduckgo.com");
            const tgt = u.searchParams.get("uddg");
            if (tgt) href = tgt;
          } catch (e) {
          }
          if (/^https?:/i.test(href)) results.push({ title: cleanText(rm[2]).slice(0, 200), url: href.slice(0, 500), snippet: (snips[i] || "").slice(0, 300) });
          i++;
        }
      } else {
        const re = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let rm;
        while ((rm = re.exec(html)) && results.length < n) {
          let href = rm[1];
          try {
            const u = new URL(href, "https://duckduckgo.com");
            const tgt = u.searchParams.get("uddg");
            if (tgt) href = tgt;
          } catch (e) {
          }
          if (/^https?:/i.test(href) && href.indexOf("duckduckgo.com") === -1) results.push({ title: cleanText(rm[2]).slice(0, 200), url: href.slice(0, 500), snippet: "" });
        }
      }
      if (results.length) return { engine: isLite ? "duckduckgo-lite" : "duckduckgo", results };
    } catch (e) {
    }
  }
  return { error: "search engine unreachable" };
}
__name(ddgSearch, "ddgSearch");
async function fetchCleanText(url, maxChars) {
  const u = new URL(url);
  if (!/^https?:$/i.test(u.protocol)) return { error: "only http(s) URLs" };
  if (isPrivateHost(u.hostname)) return { error: "private/loopback hosts blocked" };
  const resp = await fetch(u.toString(), { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "Accept": "text/html,text/plain;q=0.9,*/*;q=0.5" } });
  if (!resp.ok) return { error: "HTTP " + resp.status, url: u.toString() };
  const ct = resp.headers.get("content-type") || "";
  const isHtml = /text\/html/i.test(ct);
  const raw = await resp.text();
  const text = isHtml ? cleanText(raw) : raw;
  const cap = Math.max(Number(maxChars) || 6e3, 500);
  return { url: u.toString(), text: text.slice(0, cap), truncated: text.length > cap };
}
__name(fetchCleanText, "fetchCleanText");
function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "note";
}
__name(slugify, "slugify");
async function githubPublish(token, repo, path, content, message) {
  if (!token) return { error: "GITHUB_TOKEN not configured" };
  try {
    const b64 = btoa(unescape(encodeURIComponent(content)));
    const r = await fetch("https://api.github.com/repos/" + repo + "/contents/" + path, {
      method: "PUT",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", "User-Agent": "qnfo-agent-orchestrator", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ message, content: b64, branch: "main" })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: "github HTTP " + r.status + " " + (j.message || "") };
    return { ok: true, repo, path, sha: j.content && j.content.sha || null, commit: j.commit && j.commit.sha || null };
  } catch (e) {
    return { error: "github publish failed: " + (e && e.message || e) };
  }
}
__name(githubPublish, "githubPublish");
var SYSTEM_PROMPT = `You are the QNFO research orchestrator \u2014 a server-side agent running on the Cloudflare Quniverse fleet (account: quniverse, ~54 workers). You operate on the QNFO knowledge infrastructure: the living-paper corpus (D1 + Vectorize semantic index), the knowledge graph (D1), and the R2 projects store. QNFO is not an acronym.

QUNIVERSE FLEET CONTEXT (relevant surfaces)
- qnfo-ai (qnfo-ai.q08.workers.dev) \u2014 research gateway; auto/ensemble/reasoning models
- qnfo-ops (qnfo-ops.q08.workers.dev) \u2014 ops endpoint; fleet probes, D1/R2/KV/Vectorize
- personal-api (personal-api.q08.workers.dev) \u2014 personal twin; NEVER call for research
- ideas.qnfo.org \u2014 idea intake hub; /api/sessions, /rss.xml, /sitemap.xml
- qnfo.org \u2014 landing + email-capture; qnfo-subscribers double opt-in pipeline
- qnfo-signal-loop \u2014 signal-organism L8 re-entry; emits signals from open-question sections
- qnfo-paper-reviser \u2014 adversarial revision loop
- qnfo-outreach \u2014 autonomous outreach agent; ACTIVATION_AT 2026-09-15

PRIORITIES (attention selectivity)
1. Core strategy: the JPCUB energy benchmark and its validation.
2. Program pillars feeding the benchmark (ultrametric physics, laws of form, infomatics, research archive, platform, demos).
3. Active registry research programs.
4. Operations support (run the machine, do not expand it).
5. External noise: do not engage.
Surface only mission-relevant findings; do not spend effort on topics outside these priorities.

RESEARCH METHOD
- Gather evidence with the tools before answering. Try multiple query formulations; validate cross-system identifiers (slug, DOI).
- Prefer primary sources (corpus, knowledge graph) over assumptions. Cite specific papers by slug and DOI when known.
- Verify quantitative or statistical claims computationally where possible; state the method used.
- State uncertainty explicitly; for any strong claim, note what would disconfirm it.
- Audit before asserting; disclose rather than conceal; verify provenance.
- PERSONAL-QNFO-SEPARATION-1: never call personal-api or personal data sources for research tasks.

OUTPUT STANDARDS (hard)
- Plain scholarly prose for a human reader. No meta-commentary about the act of writing, no self-praise, no signpost overload, no cliches ("delve", "tapestry", "landscape").
- State the fact and stop; the citation carries the evidence.
- No navel-gazing: the output must be useful to an external reader, never a summary of internal pipeline status.
- Final answer: plain Markdown, no tool calls, no raw tool JSON.
- NO-JOURNALS-1: never suggest traditional journal submissions.

TOOLS
- search_papers(query, limit?): semantic search across the QWAV research corpus. Returns paper slugs, scores, and metadata.
- get_paper_context(slug): full body text of a specific paper.
- query_graph(sql): read-only SQL against the QNFO knowledge graph. Tables: nodes(id, name, label, properties), edges(source_id, target_id, label, properties).
- arxiv_search(query, max_results?): search arXiv (live external API) \u2014 returns paper ids, titles, summaries, authors, links.
- web_search(query, limit?): live web search (DuckDuckGo) for current events and external sources.
- web_fetch(url, max_chars?): fetch a web page and return its readable text.
- store_note(key, content): persist a research note to the QNFO R2 projects store.
- publish_paper(slug, title, body_md, authors?, abstract?, doi?): publish the result to the QNFO living-paper corpus (searchable + retrievable).
- social_promote(slug, title, posts[]): queue a Bluesky social thread for promotion (qnfo-social cron posts it).
- github_publish(repo?, path, content, message?): publish a file to a GitHub repository.

When you have enough evidence, answer directly in Markdown. Do not make additional tool calls in the final response.

ADVERSARIAL-REASONING-1 (anti-sycophancy / anti-confirmation-bias): never flatter, defer, or agree with the user or a source merely because it was stated \u2014 when evidence contradicts the premise, say so plainly with counter-evidence; actively seek disconfirming evidence and state the strongest argument against your own answer; expose at least one concrete failure mode (limitation, missing evidence, edge case, or falsifying observation) in every substantive response; label uncertainty, never inflate confidence.`;
var TOOLS = [
  {
    type: "function",
    function: {
      name: "search_papers",
      description: "Semantic search across the QWAV research paper corpus using vector embeddings. Returns paper slugs, scores, and metadata.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query" },
          limit: { type: "integer", description: "Max results (1-10, default 5)", default: 5 }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_paper_context",
      description: "Get the full body text of a specific paper by its slug identifier.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Paper slug (e.g., 'zbw-p5-capstone')" }
        },
        required: ["slug"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_graph",
      description: "Run a read-only SQL query against the QNFO knowledge graph (D1). Tables: nodes(id, name, label, properties JSON), edges(source_id, target_id, label, properties JSON).",
      parameters: {
        type: "object",
        properties: {
          sql: { type: "string", description: "SQL SELECT query (read-only)" }
        },
        required: ["sql"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "arxiv_search",
      description: "Search arXiv for papers by keyword (live external API). Returns paper ids, titles, summaries, authors, and links.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (title/abstract keywords)" },
          max_results: { type: "integer", description: "Max results (1-10, default 5)" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Live web search (DuckDuckGo). Returns current web results with titles, URLs, and snippets. Use for current events and external sources.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "integer", description: "Max results (1-8, default 5)" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch a web page and return its readable text (HTML stripped). Use to read a source found by web_search or arxiv_search.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full https URL to fetch" },
          max_chars: { type: "integer", description: "Max characters (500-12000, default 6000)" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "store_note",
      description: "Persist a research note (Markdown) to the QNFO R2 projects store under the current task. Use to save findings, drafts, or citations for the pipeline.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Note key/slug (e.g. 'lit-review')" },
          content: { type: "string", description: "Markdown content of the note" }
        },
        required: ["key", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "publish_paper",
      description: "Publish the research result to the QNFO living-paper corpus (D1). Makes it searchable via search_papers/get_paper_context. Use when the user asks to publish.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Paper slug (e.g. 'my-finding')" },
          title: { type: "string", description: "Paper title" },
          authors: { type: "string", description: "Authors (e.g. 'Rowan Brad Quni-Gudzinas')" },
          abstract: { type: "string", description: "Abstract" },
          body_md: { type: "string", description: "Full paper body in Markdown" },
          doi: { type: "string", description: "DOI (optional)" }
        },
        required: ["slug", "title", "body_md"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "social_promote",
      description: "Queue a social-media thread (Bluesky) promoting the result. The qnfo-social cron posts queued threads. Use to promote a published result.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Unique slug (e.g. the paper slug)" },
          title: { type: "string", description: "Title for the post" },
          posts: { type: "array", items: { type: "string" }, description: "Post texts: first = opener, rest = thread replies (max ~290 chars each)" },
          doi: { type: "string", description: "Optional DOI of the promoted paper (enables autoScan dedup)" },
          abstract: { type: "string", description: "Optional abstract of the promoted paper (fact-check context)" }
        },
        required: ["slug", "title", "posts"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "github_publish",
      description: "Publish a file to a GitHub repository via the contents API. Use to push results, code, or artifacts to GitHub.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Repo in owner/name form (default QNFO/qnfo-research)" },
          path: { type: "string", description: "File path in the repo" },
          content: { type: "string", description: "File content" },
          message: { type: "string", description: "Commit message" }
        },
        required: ["path", "content"]
      }
    }
  }
];
var AgentTask = class extends DurableObject {
  static {
    __name(this, "AgentTask");
  }
  static {
    __name2(this, "AgentTask");
  }
  static {
    __name22(this, "AgentTask");
  }
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
  }
  async fetch(request) {
    const url = new URL(request.url);
    const taskId = url.pathname.split("/").pop();
    if (url.pathname.endsWith("/start") && request.method === "POST") {
      const { prompt, maxSteps = 5, maxTokens = 4096 } = await request.json();
      this.taskId = taskId;
      const state = {
        id: taskId,
        status: "running",
        prompt,
        maxSteps,
        maxTokens,
        step: 0,
        messages: [],
        result: null,
        error: null,
        createdAt: Date.now(),
        completedAt: null
      };
      await this.ctx.storage.put("state", state);
      await this.ctx.storage.setAlarm(Date.now() + 30 * 60 * 1e3);
      this.ctx.waitUntil(this.runAgentLoop(taskId));
      return Response.json({ task_id: taskId, status: "running" });
    }
    if (url.pathname.endsWith("/alarm") && request.method === "GET") {
      await this.alarm();
      return Response.json({ ok: true });
    }
    if (url.pathname.endsWith("/status")) {
      const state = await this.ctx.storage.get("state");
      return Response.json(state || { error: "Task not found" });
    }
    return new Response("Not found", { status: 404 });
  }
  // ── Watchdog: called by the runtime when the alarm fires ──
  // If the agent loop never completed (DO eviction / crash / hang), mark the
  // task failed so polling returns a terminal state instead of "running" forever.
  async alarm() {
    const state = await this.ctx.storage.get("state");
    if (state && state.status === "running") {
      state.status = "failed";
      state.error = "Task timed out: agent loop exceeded 30-minute watchdog";
      state.completedAt = Date.now();
      await this.ctx.storage.put("state", state);
      console.log(`[watchdog] task ${state.id} marked failed after 30min`);
    }
  }
  // ── Agent loop ───────────────────────────────────────────
  async autoPublish(taskId, state) {
    try {
      if (!this.env.GITHUB_TOKEN) return;
      const base = "_agent-results/" + taskId + "/";
      await githubPublish(this.env.GITHUB_TOKEN, "QNFO/qnfo-research", base + "result.json", JSON.stringify(state, null, 2), "agent result " + taskId);
      const md = "# " + String(state.prompt || "Agent task").slice(0, 120) + "\n\n## Result\n\n" + String(state.result || "(no result)").slice(0, 2e4);
      await githubPublish(this.env.GITHUB_TOKEN, "QNFO/qnfo-research", base + "result.md", md, "agent result md " + taskId);
    } catch (e) {
      console.log("autoPublish error:", e && e.message || e);
    }
  }
  async runAgentLoop(taskId) {
    const state = await this.ctx.storage.get("state");
    if (!state) return;
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: state.prompt }
    ];
    try {
      for (let i = 0; i < state.maxSteps; i++) {
        state.step = i + 1;
        await this.ctx.storage.put("state", state);
        const aiResponse = await this.env.AI.run(
          "@cf/deepseek-ai/deepseek-v4-flash-0731",
          {
            messages,
            tools: TOOLS,
            tool_choice: "auto",
            max_tokens: state.maxTokens || 4096,
            temperature: 0.3
          }
        );
        const msg = aiResponse.choices && aiResponse.choices[0] && aiResponse.choices[0].message ? aiResponse.choices[0].message : aiResponse;
        const respVal = msg.content !== void 0 ? msg.content : aiResponse.response;
        const rawToolCalls = msg.tool_calls || aiResponse.tool_calls || [];
        if (rawToolCalls.length === 0 && respVal) {
          let candidate = null;
          if (typeof respVal === "object" && respVal.name && respVal.arguments) {
            candidate = respVal;
          } else if (typeof respVal === "string") {
            let jsonStr = respVal.trim();
            const m = jsonStr.match(/<(?:tools|tool_response)>([\s\S]*?)<\/(?:tools|tool_response)>/);
            if (m) jsonStr = m[1].trim();
            if (jsonStr.startsWith("{")) {
              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.name && parsed.arguments) candidate = parsed;
              } catch (e) {
              }
            }
          }
          if (candidate) rawToolCalls.push(candidate);
        }
        const toolCalls = rawToolCalls.map((tc) => {
          let fnName, fnArgs;
          if (tc.function) {
            fnName = tc.function.name;
            fnArgs = typeof tc.function.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function.arguments || {});
          } else if (tc.name) {
            fnName = tc.name;
            fnArgs = typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments || {});
          } else {
            return null;
          }
          return {
            id: tc.id || `call_${crypto.randomUUID().slice(0, 8)}`,
            type: "function",
            function: { name: fnName, arguments: fnArgs }
          };
        }).filter(Boolean);
        if (toolCalls.length === 0) {
          state.status = "completed";
          state.result = respVal || aiResponse.content || JSON.stringify(aiResponse);
          state.completedAt = Date.now();
          state.messages = messages;
          await this.ctx.storage.put("state", state);
          await this.env.QNFO_PROJECTS.put(
            `_agent-results/${taskId}/result.json`,
            JSON.stringify(state, null, 2),
            { httpMetadata: { contentType: "application/json" } }
          );
          await this.autoPublish(taskId, state);
          return;
        }
        messages.push({
          role: "assistant",
          content: typeof respVal === "string" ? respVal : "",
          tool_calls: toolCalls
        });
        for (const tc of toolCalls) {
          let result;
          try {
            const args = JSON.parse(tc.function.arguments);
            result = await this.executeTool(tc.function.name, args);
          } catch (e) {
            result = JSON.stringify({ error: `Tool execution failed: ${e.message}` });
          }
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result
          });
        }
      }
      messages.push({
        role: "user",
        content: "You have reached the maximum number of steps. Provide your final answer now based on the information gathered. Do NOT make additional tool calls."
      });
      const finalResponse = await this.env.AI.run(
        "@cf/deepseek-ai/deepseek-v4-flash-0731",
        { messages, max_tokens: state.maxTokens || 4096, temperature: 0.3 }
      );
      state.status = "completed";
      const fmsg = finalResponse.choices && finalResponse.choices[0] && finalResponse.choices[0].message ? finalResponse.choices[0].message : finalResponse;
      state.result = fmsg.content !== void 0 ? fmsg.content : finalResponse.response || finalResponse.content || "No result produced";
      state.completedAt = Date.now();
      state.messages = messages;
      await this.ctx.storage.put("state", state);
      await this.env.QNFO_PROJECTS.put(
        `_agent-results/${taskId}/result.json`,
        JSON.stringify(state, null, 2),
        { httpMetadata: { contentType: "application/json" } }
      );
      await this.autoPublish(taskId, state);
    } catch (err) {
      state.status = "failed";
      state.error = err.message;
      state.completedAt = Date.now();
      await this.ctx.storage.put("state", state);
    }
  }
  // ── Tool execution ───────────────────────────────────────
  async executeTool(name, args) {
    switch (name) {
      case "search_papers": {
        const limit = Math.min(args.limit || 5, 10);
        const embedResp = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: [args.query]
        });
        const vector = embedResp.data?.[0] || embedResp[0];
        if (!vector) return JSON.stringify({ error: "Embedding failed" });
        const results = await this.env.PAPER_VZ.query(vector, {
          topK: limit,
          returnValues: false,
          returnMetadata: true
        });
        const matches = results.matches.map((m) => ({
          id: m.id,
          score: Math.round(m.score * 1e3) / 1e3,
          slug: m.metadata?.slug || m.id,
          title: m.metadata?.title || "",
          authors: m.metadata?.authors || ""
        }));
        return JSON.stringify({ count: matches.length, matches });
      }
      case "get_paper_context": {
        const row = await this.env.LIVING_PAPER.prepare("SELECT body_md, doi, authors, title FROM papers WHERE slug = ?").bind(args.slug).first();
        if (!row) return JSON.stringify({ error: `Paper not found: ${args.slug}` });
        return JSON.stringify({
          slug: args.slug,
          doi: row.doi,
          title: row.title,
          authors: row.authors,
          body: (row.body_md || "").substring(0, 8e3)
        });
      }
      case "query_graph": {
        const sql = (args.sql || "").trim();
        if (!sql.toUpperCase().startsWith("SELECT")) {
          return JSON.stringify({ error: "Only SELECT queries allowed" });
        }
        const result = await this.env.QNFO_GRAPH.prepare(sql).all();
        return JSON.stringify({
          results: result.results,
          count: result.results?.length || 0
        });
      }
      case "arxiv_search": {
        const ar = await arxivSearch(args.query, args.max_results);
        return JSON.stringify(ar);
      }
      case "web_search": {
        const ws = await ddgSearch(args.query, args.limit || 5);
        return JSON.stringify(ws);
      }
      case "web_fetch": {
        const wf = await fetchCleanText(args.url, args.max_chars);
        return JSON.stringify(wf);
      }
      case "store_note": {
        const key = String(args.key || "").replace(/[^a-zA-Z0-9._\/-]/g, "-").slice(0, 80) || "note";
        const content = String(args.content || "");
        const notePath = "_agent-results/" + this.taskId + "/notes/" + key + ".md";
        await this.env.QNFO_PROJECTS.put(notePath, content, { httpMetadata: { contentType: "text/markdown" } });
        return JSON.stringify({ ok: true, key, r2_path: notePath });
      }
      case "publish_paper": {
        const slug = slugify(args.slug || args.title || "paper");
        const title = String(args.title || "").slice(0, 500);
        if (!title) return JSON.stringify({ error: "title required" });
        await this.env.LIVING_PAPER.prepare("INSERT OR REPLACE INTO papers (identifier, slug, title, authors, abstract, body_md, doi, published, status, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'published',datetime('now'),datetime('now'))").bind(slug, slug, title, String(args.authors || "QNFO Research").slice(0, 500), String(args.abstract || "").slice(0, 3e3), String(args.body_md || "").slice(0, 1e5), args.doi || null, (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)).run();
        return JSON.stringify({ ok: true, slug, published: true, note: "in living-paper corpus; searchable via search_papers/get_paper_context" });
      }
      case "social_promote": {
        const slug = slugify(args.slug || args.title || "promo");
        let posts = [];
        if (Array.isArray(args.posts)) posts = args.posts.map((p) => String(p).slice(0, 290));
        else if (typeof args.posts === "string") posts = [args.posts.slice(0, 290)];
        else if (args.title) posts = [String(args.title).slice(0, 290)];
        if (!posts.length) return JSON.stringify({ error: "posts required" });
        const existing = await this.env.QNFO_AUDIT.prepare("SELECT id FROM social_threads WHERE slug = ?1 LIMIT 1").bind(slug).first();
        if (existing) return JSON.stringify({ ok: true, slug, queued_posts: 0, note: "already queued for this slug (dedup)" });
        await this.env.QNFO_AUDIT.prepare("INSERT INTO social_threads (slug, title, posts, status, doi, abstract) VALUES (?1,?2,?3,'queued',?4,?5)").bind(slug, String(args.title || "").slice(0, 500), JSON.stringify(posts), args.doi ? String(args.doi).slice(0, 200) : null, args.abstract ? String(args.abstract).slice(0, 3e3) : null).run();
        return JSON.stringify({ ok: true, slug, queued_posts: posts.length, note: "queued in social_threads; qnfo-social cron posts to Bluesky" });
      }
      case "github_publish": {
        const gpr = await githubPublish(this.env.GITHUB_TOKEN, String(args.repo || "QNFO/qnfo-research"), String(args.path || ""), String(args.content || ""), String(args.message || "publish from qnfo-agent-orchestrator"));
        return JSON.stringify(gpr);
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  }
};
var agent_orchestrator_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    if (method === "POST" || method === "PATCH") {
      const auth = request.headers.get("X-Sync-Token");
      const authOk = env.SYNC_TOKEN && auth === env.SYNC_TOKEN || env.TEST_TOKEN && auth === env.TEST_TOKEN || env.DISPATCH_TOKEN && auth === env.DISPATCH_TOKEN;
      if (!auth || !authOk) {
        return Response.json({ error: "Unauthorized: missing or invalid X-Sync-Token" }, { status: 401 });
      }
    }
    if (url.pathname === "/health") {
      return Response.json({
        worker: "qnfo-agent-orchestrator",
        version: VERSION,
        status: "ok",
        capabilities: ["agent-tasks", "paper-search", "graph-query", "arxiv-and-web-research", "notes", "publish-tools"],
        limitations: ["every POST and PATCH needs X-Sync-Token (sync, dispatch or test token)", "a task runs at most 10 steps with an output budget of at most 16384 tokens", "publish tools act with this worker's own GitHub credentials"],
        bindings: {
          d1_living_paper: !!env.LIVING_PAPER,
          d1_graph: !!env.QNFO_GRAPH,
          vectorize: !!env.PAPER_VZ,
          r2: !!env.QNFO_PROJECTS,
          ai: !!env.AI,
          do_agent_task: !!env.AGENT_TASK
        },
        uptime: Date.now()
      });
    }
    if (url.pathname === "/task" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      if (!body.prompt || typeof body.prompt !== "string") {
        return Response.json({ error: "Missing required field: prompt (string)" }, { status: 400 });
      }
      const taskId = crypto.randomUUID();
      const maxSteps = Math.min(body.max_steps || 5, 10);
      const maxTokens = Math.min(Math.max(body.max_tokens || 4096, 1024), 16384);
      const doId = env.AGENT_TASK.idFromName(taskId);
      const stub = env.AGENT_TASK.get(doId);
      ctx.waitUntil(
        stub.fetch(new Request(`https://do/task/${taskId}/start`, {
          method: "POST",
          body: JSON.stringify({ prompt: body.prompt, maxSteps, maxTokens })
        }))
      );
      return Response.json({
        task_id: taskId,
        status: "queued",
        poll_url: `/task/${taskId}`
      }, { status: 202 });
    }
    const taskMatch = url.pathname.match(/^\/task\/([a-f0-9-]+)$/);
    if (taskMatch && request.method === "GET") {
      const taskId = taskMatch[1];
      const doId = env.AGENT_TASK.idFromName(taskId);
      const stub = env.AGENT_TASK.get(doId);
      const resp = await stub.fetch(new Request(`https://do/task/${taskId}/status`));
      return resp;
    }
    if (url.pathname === "/") {
      return Response.json({
        worker: "qnfo-agent-orchestrator",
        endpoints: {
          "POST /task": "Create agent task { prompt, max_steps? }",
          "GET /task/:id": "Poll task status and result",
          "GET /health": "Worker health and binding check"
        }
      });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }
};
export {
  AgentTask,
  agent_orchestrator_default as default
};
//# sourceMappingURL=worker.js.map