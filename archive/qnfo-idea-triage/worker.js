// qnfo-idea-triage v1.1.0 — merit triage + autonomous research stage machine
// v1.0.0 (2026-09-01): dual-model scorecard (glm-5.2 + deepseek-v4-flash, qwen3-30b tiebreak),
//   ACCEPT -> research_queue, hourly cron.
// v1.1.0 (2026-09-01): + stage machine claiming research_queue and driving staged agent briefs
//   on qnfo-agent-orchestrator /task (DO agent loop):
//     note -> draft -> review -> revise -> publish -> finalize (outreach queue + IndexNow ping)
// Bindings: QNFO_AUDIT (D1 qnfo-audit), LIVING_PAPER (D1 living-paper), AI (Workers AI).
// Secrets: TRIAGE_TOKEN (bearer auth), DISPATCH_TOKEN (X-Sync-Token for agent-orchestrator),
//   INDEXNOW_KEY (IndexNow submission key).
// Crons: "0 * * * *" triage; "*/10 * * * *" stage machine (sync + claim).

var VERSION = "1.4.2-model-floor-1";
const MODELS = {
  a: "@cf/zai-org/glm-5.3-flash",
  b: "@cf/deepseek-ai/deepseek-v4-flash-0731",
  tiebreak: "@cf/qwen/qwen3.8-27b",
};
const MODEL_CHAIN = [
  "@cf/zai-org/glm-5.3-flash",
  "@cf/zai-org/glm-5.3",
  "@cf/deepseek-ai/deepseek-v4-flash-0731",
  "@cf/qwen/qwen3.8-27b",
  "@cf/zai-org/glm-5.3",
];
const ACCEPT_MIN = 0.7;
const FEAS_MIN = 0.5;
const RISK_MAX = 0.4;
const STD_TIE = 0.25;
const AGENT_ORCH_PUBLIC = "https://agent-orchestrator.qnfo.org";
const AGENT_ORCH_SVC = "https://AGENT_ORCH"; // service binding (internal, fallback)

function orchBase(env) {
  // Prefer the custom-route hostname (agent-orchestrator.qnfo.org). A custom zone route is
  // reliably fetchable from other Workers, unlike a bare workers.dev subdomain (which
  // intermittently 404s on internal fetch) and unlike a service binding (1003 subrequest
  // block). Canonical fix 2026-09-06.
  return AGENT_ORCH_PUBLIC;
}const MAX_REVISE = 2;
const MAX_STAGE_ATTEMPTS = 3;
const MAX_ACTIVE = 1;
const OUTREACH_CAP = 12;
const INDEXNOW_API = "https://api.indexnow.org/indexnow";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function auth(req, env) {
  const t = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return !!env.TRIAGE_TOKEN && !!t && t === env.TRIAGE_TOKEN;
}

function clamp(s, n) { return String(s || "").slice(0, n); }

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "paper";
}

function tryJson(s) {
  if (typeof s !== "string") return s || null;
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

// ── Triage (v1.0.0 core, kept) ────────────────────────────────────────────
const SCORECARD_PROMPT = "You are QNFO's research-idea merit reviewer. Score the idea below for the QNFO autonomous research pipeline.\n" +
"Return JSON ONLY: {\"novelty\":0-1,\"technical_merit\":0-1,\"impact_potential\":0-1,\"exposure_potential\":0-1,\"feasibility\":0-1,\"risk\":0-1,\"rationale\":\"<=120 chars\",\"hook\":\"<=90 chars, one-line public-facing hook\"}\n" +
"Scoring guide: technical_merit = depth of technical content + verifiability; impact_potential = significance if proven; exposure_potential = breadth of audience/attention it can attract (social, media, cross-field); risk = probability of producing nothing citable (1 = near-certain dead end). IMPORTANT: feasibility means feasibility of the THEORETICAL/COMPUTATIONAL research itself (can the derivation, simulation, formal analysis, and computational verification be carried out by the QNFO autonomous pipeline) — NOT experimental testability. QNFO has no laboratory; an idea is feasible if its mathematics/computation can be executed and verified in silico, even if a confirming experiment would require external labs years away. Do NOT mark a theoretical physics idea infeasible merely because no experiment currently exists.\n" +
"IDEA: ";

function extractText(r) {
  if (!r) return "";
  const ch = r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content;
  if (ch) return String(ch);
  const c2 = r.result && r.result.choices && r.result.choices[0] && r.result.choices[0].message && r.result.choices[0].message.content;
  if (c2) return String(c2);
  if (typeof r.response === "string") return r.response;
  if (r.result && typeof r.result.response === "string") return r.result.response;
  if (r.result && typeof r.result === "object") { const s = JSON.stringify(r.result); if (s && s.length > 2) return s; }
  if (r.data && typeof r.data === "object") {
    const c3 = r.data.choices && r.data.choices[0] && r.data.choices[0].message && r.data.choices[0].message.content;
    if (c3) return String(c3);
    if (typeof r.data.response === "string") return r.data.response;
  }
  return "";
}
async function runModel(env, name, prompt) {
  let lastErr = "";
  const chain = [name].concat(MODEL_CHAIN.filter(function(x){ return x !== name; })).slice(0, 4);
  for (const model of chain) {
    try {
      const r = await env.AI.run(model, { messages: [{ role: "user", content: prompt }], max_tokens: 700, temperature: 0.2 });
      const text = extractText(r);
      const mm = text && text.match(/\{[\s\S]*\}/);
      if (!mm) { lastErr = model + ": no JSON in output"; continue; }
      const parsed = JSON.parse(mm[0]);
      const keys = ["novelty","technical_merit","impact_potential","exposure_potential","feasibility","risk"];
      let ok = true;
      for (const k of keys) { const v = parseFloat(parsed[k]); if (!isFinite(v)) { ok = false; break; } parsed[k] = Math.max(0, Math.min(1, v)); }
      if (!ok) { lastErr = model + ": invalid scorecard fields"; continue; }
      return { card: parsed, model: model };
    } catch (e) { lastErr = model + ": " + (e && e.message || e); continue; }
  }
  return { error: "all scoring models failed: " + lastErr };
}

function composite(c) {
  return 0.3 * c.novelty + 0.3 * c.technical_merit + 0.2 * c.impact_potential + 0.2 * c.exposure_potential;
}

async function scoreIdea(env, desire) {
  const prompt = SCORECARD_PROMPT + String(desire || "").slice(0, 3000);
  const [ra, rb] = await Promise.all([runModel(env, MODELS.a, prompt), runModel(env, MODELS.b, prompt)]);
  const a = ra && ra.card ? ra : null;
  const b = rb && rb.card ? rb : null;
  let card = null, models = [];
  if (a && b) {
    const keys = ["novelty","technical_merit","impact_potential","exposure_potential","feasibility","risk"];
    card = {};
    for (const k of keys) card[k] = (a.card[k] + b.card[k]) / 2;
    card.rationale = a.card.rationale || "";
    card.hook = a.card.hook || "";
    models = [a.model, b.model];
    const std = Math.sqrt(keys.map(function(k){ return Math.pow(a.card[k] - b.card[k], 2); }).reduce(function(x,y){ return x + y; }, 0) / keys.length);
    if (std > STD_TIE) {
      const t = await runModel(env, MODELS.tiebreak, prompt);
      if (t && t.card) { for (const k of keys) card[k] = (a.card[k] + b.card[k] + t.card[k]) / 3; models.push(t.model); }
    }
  } else if (a) { card = a.card; models = [a.model]; }
  else if (b) { card = b.card; models = [b.model]; }
  else { const detail = [ra && ra.error, rb && rb.error].filter(Boolean).join(" | "); return { error: "all scoring models failed: " + detail }; }
  const c = composite(card);
  const decision = c >= ACCEPT_MIN && card.feasibility >= FEAS_MIN && card.risk <= RISK_MAX ? "ACCEPT" : "HOLD";
  return { score: Math.round(c * 1000) / 1000, decision,
    novelty: card.novelty, technical_merit: card.technical_merit, impact_potential: card.impact_potential,
    exposure_potential: card.exposure_potential, feasibility: card.feasibility, risk: card.risk,
    rationale: card.rationale, hook: card.hook, model: models.join("+") };
}

// v1.1.0: noise + question pre-filters (save model spend, keep the queue clean)
const NOISE_RE = [
  /^call (the )?[a-z_]+( tool)?(\s|$)/i,
  /(email_check|express_intent|intents_list|social_compose|search_research|search_papers tool)/i,
  /output the (complete )?raw json/i,
  /^reply with the single word/i,
  /^give this conversation a name/i,
  /^max \d+ chars/i,
  /based on the chat history/i,
  /rotation verification/i,
  /redirect probe/i,
  /auto-express block/i,
  /wrapped in/i,
  /^ok$/i,
];
function isNoise(text) {
  const t = String(text || "");
  return NOISE_RE.some((re) => { re.lastIndex = 0; return re.test(t); });
}
function isQuestion(text) {
  const t = String(text || "").trim();
  return t.length < 160 && /\?\s*$/.test(t) &&
    /^(what|who|where|when|why|how|is|are|do|does|did|can|could|should|would|will|has|have|quick|one line|one sentence|in one sentence|probe)/i.test(t);
}

async function enqueue(env, source, sourceId, idea, summary, s) {
  await env.QNFO_AUDIT.prepare(
    "INSERT OR IGNORE INTO research_queue (id, source, source_id, idea, summary, score, decision, status, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'queued',?8)"
  ).bind(crypto.randomUUID(), source, sourceId, String(idea || "").slice(0, 3000), String(summary || "").slice(0, 200), s.score, s.decision, new Date().toISOString()).run();
}

async function triageOne(env, row) {
  const now = new Date().toISOString();
  if (isNoise(row.desire)) {
    await env.QNFO_AUDIT.prepare("UPDATE intents SET triage_decision='NOISE', triage_rationale=?, triaged_at=?, status='triaged' WHERE id=?").bind("tool-instruction noise filter", now, row.id).run();
    return { id: row.id, verdict: "noise" };
  }
  if (isQuestion(row.desire)) {
    await env.QNFO_AUDIT.prepare("UPDATE intents SET triage_decision='HOLD', triage_rationale=?, triaged_at=?, status='triaged' WHERE id=?").bind("question, not an idea — routes to the answer path", now, row.id).run();
    return { id: row.id, verdict: "question" };
  }
  const s = await scoreIdea(env, row.desire);
  if (s.error) return { id: row.id, verdict: "error", error: s.error };
  await env.QNFO_AUDIT.prepare(
    "UPDATE intents SET triage_decision=?, triage_score=?, triage_rationale=?, triage_model=?, triaged_at=?, status='triaged' WHERE id=?"
  ).bind(s.decision, s.score, s.rationale || "", s.model, now, row.id).run();
  if (s.decision === "ACCEPT") {
    await enqueue(env, "intent", row.id, row.desire, row.summary || "", s);
  }
  return { id: row.id, verdict: s.decision, score: s.score };
}

async function runPending(env, commit, limit) {
  const out = { triaged: [], queue_added: 0, errors: [], commit };
  const intents = await env.QNFO_AUDIT.prepare(
    "SELECT * FROM intents WHERE type='research' AND status='pending' AND (triage_decision IS NULL OR triage_decision='') ORDER BY created_at ASC LIMIT ?1"
  ).bind(limit).all();
  for (const row of intents.results || []) {
    try {
      if (!commit) {
        out.triaged.push({ id: row.id, preview: "would-score" });
        continue;
      }
      const t = await triageOne(env, row);
      if (t.verdict === "ACCEPT") out.queue_added++;
      out.triaged.push(t);
    } catch (e) { out.errors.push({ id: row.id, error: e.message }); }
  }
  const props = await env.QNFO_AUDIT.prepare(
    "SELECT * FROM idea_proposals WHERE status='new' ORDER BY created_at ASC LIMIT ?1"
  ).bind(limit).all();
  for (const row of props.results || []) {
    try {
      if (!commit) { out.triaged.push({ id: String(row.id), preview: "would-score-proposal" }); continue; }
      const desire = row.idea;
      let s;
      if (isNoise(desire) || isQuestion(desire)) {
        s = null;
        await env.QNFO_AUDIT.prepare("UPDATE idea_proposals SET decision='HOLD', rationale=?, triaged_at=?, status='triaged_hold' WHERE id=?").bind("noise/question filter", new Date().toISOString(), row.id).run();
      } else {
        s = await scoreIdea(env, desire);
        if (s.error) { out.errors.push({ id: String(row.id), error: s.error }); continue; }
        await env.QNFO_AUDIT.prepare("UPDATE idea_proposals SET decision=?, score=?, rationale=?, triaged_at=?, status=? WHERE id=?").bind(s.decision, s.score, s.rationale || "", new Date().toISOString(), s.decision === "ACCEPT" ? "triaged_accepted" : "triaged_hold", row.id).run();
      }
      if (s && s.decision === "ACCEPT") { await enqueue(env, "proposal", String(row.id), desire, "", s); out.queue_added++; }
      out.triaged.push({ id: String(row.id), verdict: s ? s.decision : "HOLD" });
    } catch (e) { out.errors.push({ id: String(row.id), error: e.message }); }
  }
  return out;
}

// ── v1.1.0: stage machine ────────────────────────────────────────────────
async function ensureSchema(env) {
  const alters = [
    "ALTER TABLE research_queue ADD COLUMN stage TEXT",
    "ALTER TABLE research_queue ADD COLUMN agent_task_id TEXT",
    "ALTER TABLE research_queue ADD COLUMN attempt INTEGER DEFAULT 0",
    "ALTER TABLE research_queue ADD COLUMN revise_count INTEGER DEFAULT 0",
    "ALTER TABLE research_queue ADD COLUMN context TEXT",
    "ALTER TABLE research_queue ADD COLUMN published_at TEXT",
    "ALTER TABLE research_queue ADD COLUMN doi TEXT",
    "ALTER TABLE research_queue ADD COLUMN paper_url TEXT",
    "ALTER TABLE research_queue ADD COLUMN error TEXT",
  ];
  for (const a of alters) {
    try { await env.QNFO_AUDIT.prepare(a).run(); } catch (e) {}
  }
  await env.QNFO_AUDIT.prepare(
    "CREATE TABLE IF NOT EXISTS pipeline_tasks (id TEXT PRIMARY KEY, queue_id TEXT, stage TEXT, action TEXT, status TEXT, detail TEXT, created_at TEXT)"
  ).run();
  await env.QNFO_AUDIT.prepare(
    "CREATE INDEX IF NOT EXISTS idx_pt_queue ON pipeline_tasks(queue_id)"
  ).run();
}

async function logTask(env, queueId, stage, action, status, detail) {
  try {
    await env.QNFO_AUDIT.prepare(
      "INSERT INTO pipeline_tasks (id, queue_id, stage, action, status, detail, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)"
    ).bind(crypto.randomUUID(), queueId, stage, action, status, String(detail || "").slice(0, 2000), new Date().toISOString()).run();
  } catch (e) { console.log("logTask error", e.message); }
}

async function setPipelineStatus(env, status, phase, notes) {
  try {
    await env.QNFO_AUDIT.prepare(
      "INSERT INTO pipeline_status (project_name, status, phase, last_updated, agent, notes) VALUES ('autonomous-research', ?1, ?2, ?3, 'qnfo-idea-triage', ?4) ON CONFLICT(project_name) DO UPDATE SET status=excluded.status, phase=excluded.phase, last_updated=excluded.last_updated, agent=excluded.agent, notes=excluded.notes"
    ).bind(status, phase, new Date().toISOString(), String(notes || "").slice(0, 500)).run();
  } catch (e) {}
}

// ── Stage briefs (encode the research-skill SOP gates) ───────────────────
function briefNote(row) {
  return [
    "You are executing stage NOTE of the QNFO autonomous research pipeline.",
    "RESEARCH IDEA: " + row.idea,
    "",
    "Goal: produce a literature-review note establishing the current state of knowledge for this idea.",
    "Steps:",
    "1) arxiv_search with at least 3 DISTINCT query formulations (different phrasings/keywords).",
    "2) web_search with at least 2 distinct formulations; web_fetch the 2 most relevant non-arXiv pages.",
    "3) search_papers (QNFO corpus vector search) for prior QNFO work; get_paper_context for the 2 most relevant QNFO papers.",
    "4) query_graph (stats, then neighbors) for related QNFO knowledge-graph nodes.",
    "5) store_note(key: \"note\", content: your findings).",
    "6) Final response (Markdown, NO further tool calls):",
    "   - \"State of knowledge\": 3-8 sentences.",
    "   - \"Quantitative estimates\": key numbers/bounds with explicit assumptions and derivation steps.",
    "   - \"Open questions\": 2-5 questions this idea could answer.",
    "   - \"Citations\": top 5 sources as arXiv ids / QNFO slugs / DOIs (ONLY sources you actually retrieved).",
    "Never fabricate a citation. If a source was not retrieved, do not cite it.",
  ].join("\n");
}

function briefDraft(row, note) {
  return [
    "You are executing stage DRAFT of the QNFO autonomous research pipeline.",
    "RESEARCH IDEA: " + row.idea,
    "LITERATURE NOTE: " + String(note || "").slice(0, 8000),
    "",
    "Goal: write a complete, citable research paper (Markdown) advancing the idea.",
    "Requirements:",
    "- Title (specific, descriptive). Abstract (150-250 words). Body: Introduction, Prior work (cite the note's sources), Analysis/Results, Discussion, Conclusion, References.",
    "- Every quantitative claim must state assumptions and derivation steps (COMPUTATIONAL-VERIFICATION-1). Verify numerics step by step.",
    "- Citations: ONLY sources listed in the note. Reference format: [n] Author, Title, arXiv:XXXX or DOI.",
    "- Style: match QNFO published papers - rigorous, falsifiable claims, no hype; state what would disconfirm each strong claim.",
    "- Length: 2000-4000 words.",
    "- store_note(key: \"draft\", content: the full paper markdown).",
    "- Final response: the full paper markdown ONLY (no commentary).",
  ].join("\n");
}

function briefReview(row, draft) {
  return [
    "You are the adversarial reviewer in the QNFO autonomous research pipeline (post-publication adversarial analysis gate, applied pre-publication).",
    "RESEARCH IDEA: " + row.idea,
    "DRAFT: " + String(draft || "").slice(0, 24000),
    "",
    "Audit dimensions:",
    "- Accuracy: are claims, numbers, derivations, citations correct and traceable to retrieved sources?",
    "- Completeness: missing edge cases, error states, verification steps?",
    "- Dependency: do cited works exist and support the claim?",
    "- Novelty: does this say something not already in the cited prior work?",
    "Output JSON ONLY: {\"verdict\":\"CLEAN|REVISIONS\",\"findings\":[{\"severity\":\"HARD|SOFT|DESIGN\",\"issue\":\"...\",\"fix\":\"...\"}]}",
    "- HARD = factual/derivation error, fabricated or unsupported citation, overclaimed result.",
    "- If no HARD findings: verdict CLEAN (findings may still list SOFT/DESIGN).",
    "Final response: the JSON only.",
  ].join("\n");
}

function briefRevise(row, draft, findings) {
  return [
    "You are revising a draft paper per adversarial-review findings in the QNFO autonomous research pipeline.",
    "RESEARCH IDEA: " + row.idea,
    "DRAFT: " + String(draft || "").slice(0, 24000),
    "REVIEWER FINDINGS (JSON): " + String(findings || "").slice(0, 6000),
    "",
    "Fix EVERY HARD finding precisely. Address SOFT findings where cheap. Do not weaken the paper's core claims unless a finding demands it.",
    "- store_note(key: \"draft\", content: the revised full paper markdown).",
    "- Final response: the full revised paper markdown ONLY.",
  ].join("\n");
}

function briefPublish(row, slug, draft) {
  return [
    "You are executing stage PUBLISH of the QNFO autonomous research pipeline.",
    "RESEARCH IDEA: " + row.idea,
    "PAPER (final, reviewed): " + String(draft || "").slice(0, 24000),
    "",
    "Do the following IN ORDER:",
    "1) publish_paper(slug: \"" + slug + "\", title: <paper title>, authors: \"Rowan Brad Quni-Gudzinas\", abstract: <abstract>, body_md: <full paper markdown>).",
    "2) social_promote(slug: \"" + slug + "\", title: <paper title>, posts: [5 posts, each <=290 chars, strictly faithful to the abstract: hook -> plain-language claim -> why it matters -> 1 caveat -> link to https://papers.qnfo.org/papers/" + slug + "/]).",
    "3) github_publish(repo: \"QNFO/qnfo-research\", path: \"papers/" + slug + "/paper.md\", content: <full paper markdown>, message: \"autonomous pipeline: " + slug + "\").",
    "Never invent numbers in the social posts beyond what the paper states.",
    "Final response: JSON ONLY: {\"slug\":\"<slug>\",\"published\":true}",
  ].join("\n");
}

function briefFor(row, slug) {
  const ctx = tryJson(row.context) || {};
  switch (row.stage) {
    case "note": return { prompt: briefNote(row), maxSteps: 6 };
    case "draft": return { prompt: briefDraft(row, ctx.note), maxSteps: 8, maxTokens: 8192 };
    case "review": return { prompt: briefReview(row, ctx.draft), maxSteps: 6 };
    case "revise": return { prompt: briefRevise(row, ctx.draft, ctx.findings), maxSteps: 8, maxTokens: 8192 };
    case "publish": return { prompt: briefPublish(row, slug, ctx.draft), maxSteps: 6 };
    default: return null;
  }
}

// ── Dispatch / sync ──────────────────────────────────────────────────────
async function dispatchStage(env, row, slug) {
  const b = briefFor(row, slug);
  if (!b) return { error: "no brief for stage " + row.stage };
  if (!env.DISPATCH_TOKEN) return { error: "DISPATCH_TOKEN not configured" };
  const body = { prompt: b.prompt, max_steps: b.maxSteps };
  if (b.maxTokens) body.max_tokens = b.maxTokens;
  const base = orchBase(env);
  const r = await fetch(base + "/task", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Sync-Token": env.DISPATCH_TOKEN },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.text()).slice(0, 200); } catch (eD) {}
    console.log("[qnfo-idea-triage] dispatch fail", r.status, base, detail);
    return { error: "agent-http-" + r.status, detail: detail };
  }
  const j = await r.json().catch(() => ({}));
  if (!j.task_id) return { error: "agent-no-task-id" };
  await env.QNFO_AUDIT.prepare("UPDATE research_queue SET agent_task_id=?1 WHERE id=?2").bind(j.task_id, row.id).run();
  await logTask(env, row.id, row.stage, "dispatch", "ok", "task " + j.task_id + " steps=" + b.maxSteps);
  return { ok: true, task_id: j.task_id };
}
async function getTask(env, tid) {
  try {
    const r = await fetch(orchBase(env) + "/task/" + tid, { headers: { "X-Sync-Token": env.DISPATCH_TOKEN || "" } });
    if (!r.ok) return { error: "http-" + r.status };
    return await r.json();
  } catch (e) { return { error: String(e && e.message || e).slice(0, 200) }; }
}
async function advance(env, row, result) {
  const ctx = tryJson(row.context) || {};
  const slug = slugify(row.summary || row.idea);
  if (result.status === "completed") {
    const text = String(result.result || "");
    switch (row.stage) {
      case "note": {
        ctx.note = text;
        await env.QNFO_AUDIT.prepare("UPDATE research_queue SET stage='draft', context=?1, attempt=0 WHERE id=?2").bind(JSON.stringify(ctx), row.id).run();
        await logTask(env, row.id, "note", "complete", "ok", "note " + text.length + " chars");
        return { advanced: true, stage: "draft" };
      }
      case "draft": {
        ctx.draft = text;
        await env.QNFO_AUDIT.prepare("UPDATE research_queue SET stage='review', context=?1, attempt=0 WHERE id=?2").bind(JSON.stringify(ctx), row.id).run();
        await logTask(env, row.id, "draft", "complete", "ok", "draft " + text.length + " chars");
        return { advanced: true, stage: "review" };
      }
      case "review": {
        const rev = tryJson(text) || { verdict: "REVISIONS", findings: [{ severity: "HARD", issue: "review output unparseable: " + text.slice(0, 120), fix: "re-review" }] };
        ctx.findings = JSON.stringify(rev);
        const hard = (rev.findings || []).filter((f) => f && f.severity === "HARD").length;
        if (rev.verdict === "CLEAN" || hard === 0) {
          await env.QNFO_AUDIT.prepare("UPDATE research_queue SET stage='publish', context=?1, attempt=0 WHERE id=?2").bind(JSON.stringify(ctx), row.id).run();
          await logTask(env, row.id, "review", "complete", "clean", "verdict CLEAN; findings=" + (rev.findings || []).length);
          return { advanced: true, stage: "publish" };
        }
        const rc = (Number(row.revise_count) || 0);
        if (rc >= MAX_REVISE) {
          await env.QNFO_AUDIT.prepare("UPDATE research_queue SET status='failed', error=?1, completed_at=?2 WHERE id=?3").bind("review-gate: HARD findings persisted after " + rc + " revise rounds", new Date().toISOString(), row.id).run();
          await logTask(env, row.id, "review", "fail", "gate", "persistent HARD findings; never published");
          await setPipelineStatus(env, "idle", "research", "idea failed review gate: " + row.id);
          return { advanced: true, stage: "failed" };
        }
        await env.QNFO_AUDIT.prepare("UPDATE research_queue SET stage='revise', context=?1, attempt=0, revise_count=?2 WHERE id=?3").bind(JSON.stringify(ctx), rc + 1, row.id).run();
        await logTask(env, row.id, "review", "complete", "revisions", "HARD=" + hard + " -> revise round " + (rc + 1));
        return { advanced: true, stage: "revise" };
      }
      case "revise": {
        ctx.draft = text;
        await env.QNFO_AUDIT.prepare("UPDATE research_queue SET stage='review', context=?1, attempt=0 WHERE id=?2").bind(JSON.stringify(ctx), row.id).run();
        await logTask(env, row.id, "revise", "complete", "ok", "revised draft " + text.length + " chars -> re-review");
        return { advanced: true, stage: "review" };
      }
      case "publish": {
        const pub = tryJson(text) || {};
        const claimedSlug = pub.slug || slug;
        let lp = null;
        try {
          lp = await env.LIVING_PAPER.prepare("SELECT slug FROM papers WHERE slug=?1").bind(claimedSlug).first();
        } catch (e) { await logTask(env, row.id, "publish", "verify", "error", "living-paper check failed: " + e.message); }
        if (!lp) {
          await logTask(env, row.id, "publish", "verify", "fail", "slug not in living-paper: " + claimedSlug + "; will retry publish");
          return { advanced: false, retry: true, reason: "living-paper row missing" };
        }
        const doi = null; // NOZ-DOI-1: no DOI is registered for pipeline papers
        const paperUrl = "https://papers.qnfo.org/papers/" + lp.slug + "/";
        await env.QNFO_AUDIT.prepare(
          "UPDATE research_queue SET status='completed', completed_at=?1, paper_slug=?2, doi=?3, paper_url=?4, published_at=?1 WHERE id=?5"
        ).bind(new Date().toISOString(), lp.slug, doi, paperUrl, row.id).run();
        await logTask(env, row.id, "publish", "complete", "ok", "slug=" + lp.slug + " doi=" + doi);
        await finalize(env, row, lp.slug, doi, paperUrl);
        await setPipelineStatus(env, "idle", "research", "published " + lp.slug);
        return { advanced: true, stage: "published", slug: lp.slug, doi };
      }
      default:
        return { advanced: false };
    }
  }
  return { advanced: false, doState: result.status };
}

async function finalize(env, row, slug, doi, paperUrl) {
  // 1) Outreach: match cited authors against contact_ledger
  try {
    const ctx = tryJson(row.context) || {};
    const hay = String((ctx.draft || "") + " " + (ctx.note || "")).toLowerCase();
    const contacts = await env.QNFO_AUDIT.prepare("SELECT email, name FROM contact_ledger WHERE name IS NOT NULL").all();
    let queued = 0;
    for (const c of contacts.results || []) {
      if (queued >= OUTREACH_CAP) break;
      const name = String(c.name || "").trim();
      if (name.length < 4) continue;
      const tokens = name.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
      if (!tokens.length) continue;
      const hit = tokens.some((t) => hay.includes(t));
      if (!hit) continue;
      await env.QNFO_AUDIT.prepare(
        "INSERT OR IGNORE INTO outreach_queue (id, paper_id, author, email, reason, status, created_at) VALUES (?1,?2,?3,?4,?5,'pending',?6)"
      ).bind(crypto.randomUUID(), slug, name, c.email, "cited/related work match", new Date().toISOString()).run();
      queued++;
    }
    await logTask(env, row.id, "finalize", "outreach", queued > 0 ? "queued" : "none", "outreach_queue +" + queued);
  } catch (e) { await logTask(env, row.id, "finalize", "outreach", "error", e.message); }

  // 2) IndexNow ping for the new paper page
  try {
    if (env.INDEXNOW_KEY) {
      const body = {
        host: "papers.qnfo.org",
        key: env.INDEXNOW_KEY,
        keyLocation: "https://papers.qnfo.org/" + env.INDEXNOW_KEY + ".txt",
        urlList: [paperUrl],
      };
      const r = await fetch(INDEXNOW_API, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": "QNFO/qnfo-idea-triage/1.1" },
        body: JSON.stringify(body),
      });
      await logTask(env, row.id, "finalize", "indexnow", r.ok ? "ok:" + r.status : "http-" + r.status, paperUrl);
    } else {
      await logTask(env, row.id, "finalize", "indexnow", "skipped", "INDEXNOW_KEY not set");
    }
  } catch (e) { await logTask(env, row.id, "finalize", "indexnow", "error", e.message); }
}

async function claimNext(env) {
  const active = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) n FROM research_queue WHERE status='researching'").first();
  if (active && Number(active.n) >= MAX_ACTIVE) return { claimed: false, reason: "active-task-exists" };
  if (env.AUTO_PAUSE === "1") return { claimed: false, reason: "auto-pause" };
  const row = await env.QNFO_AUDIT.prepare("SELECT * FROM research_queue WHERE status='queued' ORDER BY score DESC LIMIT 1").first();
  if (!row) return { claimed: false, reason: "empty-queue" };
  const now = new Date().toISOString();
  const upd = await env.QNFO_AUDIT.prepare(
    "UPDATE research_queue SET status='researching', claimed_at=?1, stage='note', attempt=1, context=NULL WHERE id=?2 AND status='queued'"
  ).bind(now, row.id).run();
  if (!(upd.meta && upd.meta.changes)) return { claimed: false, reason: "claim-lost" };
  row.status = "researching";
  row.stage = "note";
  row.attempt = 1;
  await logTask(env, row.id, "note", "claim", "ok", "idea: " + String(row.idea || "").slice(0, 120));
  await setPipelineStatus(env, "active", "research", "researching: " + String(row.summary || row.idea || "").slice(0, 120));
  const d = await dispatchStage(env, row, slugify(row.summary || row.idea));
  return { claimed: true, queue_id: row.id, stage: "note", dispatch: d };
}

async function syncStages(env) {
  const rows = await env.QNFO_AUDIT.prepare("SELECT * FROM research_queue WHERE status='researching'").all();
  const out = [];
  for (const row of rows.results || []) {
    if (!row.agent_task_id) {
      const attempt = (Number(row.attempt) || 0) + 1;
      if (attempt > MAX_STAGE_ATTEMPTS) {
        await env.QNFO_AUDIT.prepare("UPDATE research_queue SET status='failed', error=?1, completed_at=?2 WHERE id=?3").bind("no task id after " + MAX_STAGE_ATTEMPTS + " attempts", new Date().toISOString(), row.id).run();
        out.push({ id: row.id, action: "failed-no-task" });
        continue;
      }
      await env.QNFO_AUDIT.prepare("UPDATE research_queue SET attempt=?1 WHERE id=?2").bind(attempt, row.id).run();
      const d = await dispatchStage(env, row, slugify(row.summary || row.idea));
      out.push({ id: row.id, action: "re-dispatch", dispatch: d });
      continue;
    }
    const st = await getTask(env, row.agent_task_id);
    if (st.error) {
      out.push({ id: row.id, action: "poll-error", error: st.error });
      continue;
    }
    if (st.status === "running") {
      const claimedMs = Date.parse(row.claimed_at || "");
      if (!isNaN(claimedMs) && Date.now() - claimedMs > 40 * 60 * 1000) {
        await env.QNFO_AUDIT.prepare("UPDATE research_queue SET status='failed', error='watchdog: stage exceeded 40min', completed_at=?1 WHERE id=?2").bind(new Date().toISOString(), row.id).run();
        await logTask(env, row.id, row.stage, "watchdog", "fail", "40min stage timeout");
        out.push({ id: row.id, action: "watchdog-failed" });
      } else {
        out.push({ id: row.id, action: "running", step: st.step });
      }
      continue;
    }
    if (st.status === "completed") {
      const adv = await advance(env, row, st);
      if (adv.retry) {
        const attempt = (Number(row.attempt) || 0) + 1;
        if (attempt > MAX_STAGE_ATTEMPTS) {
          await env.QNFO_AUDIT.prepare("UPDATE research_queue SET status='failed', error=?1, completed_at=?2 WHERE id=?3").bind("publish verify failed " + MAX_STAGE_ATTEMPTS + " attempts", new Date().toISOString(), row.id).run();
          out.push({ id: row.id, action: "failed-publish-verify" });
        } else {
          await env.QNFO_AUDIT.prepare("UPDATE research_queue SET attempt=?1 WHERE id=?2").bind(attempt, row.id).run();
          const d = await dispatchStage(env, row, slugify(row.summary || row.idea));
          out.push({ id: row.id, action: "re-dispatch-publish", dispatch: d });
        }
      } else {
        out.push({ id: row.id, action: adv.advanced ? "advanced->" + adv.stage : "held" });
        if (adv.advanced) {
          const fresh = await env.QNFO_AUDIT.prepare("SELECT * FROM research_queue WHERE id=?1").bind(row.id).first();
          if (fresh && fresh.status === "researching") {
            const d = await dispatchStage(env, fresh, slugify(fresh.summary || fresh.idea));
            out[out.length - 1].dispatch = d;
          }
        }
      }
      continue;
    }
    if (st.status === "failed") {
      const attempt = (Number(row.attempt) || 0) + 1;
      const err = String(st.error || "DO failed").slice(0, 300);
      if (attempt > MAX_STAGE_ATTEMPTS) {
        await env.QNFO_AUDIT.prepare("UPDATE research_queue SET status='failed', error=?1, completed_at=?2 WHERE id=?3").bind("stage failed after " + MAX_STAGE_ATTEMPTS + " attempts: " + err, new Date().toISOString(), row.id).run();
        await logTask(env, row.id, row.stage, "fail", "terminal", err);
        await setPipelineStatus(env, "idle", "research", "stage failed: " + row.id);
        out.push({ id: row.id, action: "terminal-fail" });
      } else {
        await env.QNFO_AUDIT.prepare("UPDATE research_queue SET attempt=?1, agent_task_id=NULL WHERE id=?2").bind(attempt, row.id).run();
        await logTask(env, row.id, row.stage, "retry", "attempt-" + attempt, err);
        const d = await dispatchStage(env, row, slugify(row.summary || row.idea));
        out.push({ id: row.id, action: "retry-" + attempt, dispatch: d });
      }
      continue;
    }
    out.push({ id: row.id, action: "unknown-state", state: st.status });
  }
  return out;
}

// ── Entry points ─────────────────────────────────────────────────────────
export default {
  async scheduled(event, env) {
    if (event.cron === "0 * * * *") {
      try {
        await ensureSchema(env);
        const r = await runPending(env, true, 8);
        console.log("[qnfo-idea-triage] triage cron:", JSON.stringify({ triaged: r.triaged.length, added: r.queue_added, errors: r.errors.length }));
      } catch (e) { console.log("[qnfo-idea-triage] triage cron error:", e.message); }
    }
    if (event.cron === "*/10 * * * *") {
      // v1.4.0-intake-only: triage does NOT claim research_queue rows or dispatch to
      // agent-orchestrator. Canonical 2026-09-06: that orchestrator path NEVER completed a
      // paper (100% 60-min watchdog timeout) and raced qnfo-research-exec.run() (row 9ea237fc
      // failed 20:21). research-exec.run() is the single research_queue stage-machine owner.
      // triage runs intake (score/enqueue) only. /run/sync + /run/queue HTTP endpoints remain
      // available for manual ops but are not auto-invoked.
      try {
        await ensureSchema(env);
        const r = await runPending(env, true, 4);
        console.log("[qnfo-idea-triage] intake cron:", JSON.stringify({ triaged: r.triaged.length, added: r.queue_added, errors: r.errors.length }));
      } catch (e) { console.log("[qnfo-idea-triage] intake cron error:", e.message); }
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
    }
    try {
      if (p === "/health") {
        return json({
          ok: true, worker: "qnfo-idea-triage", version: VERSION,
          bindings: { d1: !!env.QNFO_AUDIT, ai: !!env.AI, living_paper: !!env.LIVING_PAPER },
          secrets: { triage_token: !!env.TRIAGE_TOKEN, dispatch_token: !!env.DISPATCH_TOKEN, indexnow_key: !!env.INDEXNOW_KEY },
          policy: { acceptMin: ACCEPT_MIN, feasMin: FEAS_MIN, riskMax: RISK_MAX, stdTie: STD_TIE, maxActive: MAX_ACTIVE, maxRevise: MAX_REVISE, autoPause: env.AUTO_PAUSE === "1" },
        });
      }
      if (p === "/triage" && request.method === "POST") {
        if (!auth(request, env)) return json({ error: "unauthorized" }, 401);
        const body = await request.json().catch(() => ({}));
        const desire = String(body.desire || "").trim();
        if (!desire) return json({ error: "desire required" }, 400);
        if (isNoise(desire)) return json({ decision: "NOISE", score: 0, rationale: "noise filter" });
        if (isQuestion(desire)) return json({ decision: "HOLD", score: 0, rationale: "question, not an idea" });
        const s = await scoreIdea(env, desire);
        return json(s, s.error ? 502 : 200);
      }
      if (p === "/run/pending") {
        const commit = url.searchParams.get("commit") === "1";
        if (commit && !auth(request, env)) return json({ error: "unauthorized" }, 401);
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "8", 10) || 8, 20);
        const r = await runPending(env, commit, limit);
        return json(r);
      }
      if (p === "/run/queue") {
        const commit = url.searchParams.get("commit") === "1";
        if (commit && !auth(request, env)) return json({ error: "unauthorized" }, 401);
        await ensureSchema(env);
        if (!commit) {
          const q = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) n FROM research_queue WHERE status='queued'").first();
          const a = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) n FROM research_queue WHERE status='researching'").first();
          return json({ preview: true, queued: q ? q.n : 0, active: a ? a.n : 0 });
        }
        const r = await claimNext(env);
        return json(r);
      }
      if (p === "/run/sync") {
        const commit = url.searchParams.get("commit") === "1";
        if (commit && !auth(request, env)) return json({ error: "unauthorized" }, 401);
        await ensureSchema(env);
        const r = await syncStages(env);
        return json({ synced: r });
      }
      if (p === "/stats") {
        const intents = await env.QNFO_AUDIT.prepare("SELECT triage_decision, COUNT(*) n FROM intents WHERE triage_decision IS NOT NULL GROUP BY triage_decision").all();
        const queue = await env.QNFO_AUDIT.prepare("SELECT status, stage, COUNT(*) n FROM research_queue GROUP BY status, stage").all();
        const tasks = await env.QNFO_AUDIT.prepare("SELECT stage, status, COUNT(*) n FROM pipeline_tasks GROUP BY stage, status").all();
        return json({ intents: intents.results, queue: queue.results, pipeline_tasks: tasks.results });
      }
      return json({ error: "not found", path: p }, 404);
    } catch (e) {
      return json({ error: "server error: " + e.message }, 500);
    }
  },
};
