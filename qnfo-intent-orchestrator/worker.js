var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var NL = String.fromCharCode(10);
var VERSION = "1.7.4-codeagent"; /* 1.7.1 SUITE-IDLE-TIMER-1 (2026-10-26, pillar autonomy; patch): withTimeout clears its deadline timer when the race settles. prior 1.7.0-triage-verdict */ /* 1.7.0 INTENT-TRIAGE-SKIP-1 (2026-10-19, agent_issues 100066, pillar autonomy): a research idea submitted by a research feed (source ending -research-feed) is triaged whatever type the classifier gave it. The rule classifier types any text containing "event", "call" or "schedule" as event and promoteCalendar leaves such a row pending for good, so int-fad566fcmvewvdtb sat untriaged; calendar items from other sources (calendar-sync, mcp) are not research ideas and are left alone. Every terminal triage state now carries its verdict: triaged_at, triage_decision (TO-RESEARCH-CANDIDATE, BELOW-THRESHOLD, NOISE, DUPLICATE), triage_score and triage_model (9 of 10 triaged research rows had none). */ /* 1.5.0 CRON-ONLY-HEARTBEAT-1 (2026-10-13, agent_issues 2397, pillar autonomy): scheduled() upserts fleet_heartbeat when the run ends (ok 0 when the work threw or the triage cron logged an error); the write is try/caught and never fails the cron. */ /* 1.4.1-activity-store: 1.4.1 (2026-10-12): merged with main 1.3.11-codeagent. The activity is stored in this worker's own vector index (the result that decides done or failed); main's forward to personal-api /activity is kept as a second, best-effort copy whose failure is logged and never fails the intent (the route answered 404 on 2026-10-12). */ /* 1.4.0 AUTOAUDIT-DEAD-CALLERS-1 (2026-10-12, agent_issues 2302, pillar personal): an activity intent is stored in this worker's own vector index and ends done or failed with the error logged (it called a retired worker through a removed binding and the empty catch dropped it); GET /personal/search serves the personal index to qnfo-tools-mcp. */ /* 1.3.10 MODEL-ID-AUDIT-1 (2026-10-11): the classifier asked qnfo-ai for the bare id glm-5.2, which its MODELS table does not route (it fell back to deepseek-v4-flash while the stats recorded glm-5.2). It now asks glm-5.3-flash with deepseek-v4-flash as the second leg. */ /* 1.3.9 NO-TOPIC-HARDCODE-1 (owner directive 2026-10-10): the triage prompt names no program or field; cluster_key tags come from the tags already in research_candidates. */ /* 1.6.0 CRON-GRID-1 (owner directive 2026-10-19, pillar autonomy): one trigger, 0,30 every hour; the 06:00 digest (retry false: it mails the owner) and the 06:30 triage (retried up to 3 times) run on the grid fire of their slot, and every run is a cron_fire_log row CRON-WATCH-1 reads. */ /* 1.5.0 CRON-ONLY-HEARTBEAT-1 (2026-10-13, agent_issues 2397, pillar autonomy): scheduled() upserts fleet_heartbeat when the run ends (ok 0 when the work threw or the triage cron logged an error); the write is try/caught and never fails the cron. */ /* 1.4.1-activity-store: 1.4.1 (2026-10-12): merged with main 1.3.11-codeagent. The activity is stored in this worker's own vector index (the result that decides done or failed); main's forward to personal-api /activity is kept as a second, best-effort copy whose failure is logged and never fails the intent (the route answered 404 on 2026-10-12). */ /* 1.4.0 AUTOAUDIT-DEAD-CALLERS-1 (2026-10-12, agent_issues 2302, pillar personal): an activity intent is stored in this worker's own vector index and ends done or failed with the error logged (it called a retired worker through a removed binding and the empty catch dropped it); GET /personal/search serves the personal index to qnfo-tools-mcp. */ /* 1.3.10 MODEL-ID-AUDIT-1 (2026-10-11): the classifier asked qnfo-ai for the bare id glm-5.2, which its MODELS table does not route (it fell back to deepseek-v4-flash while the stats recorded glm-5.2). It now asks glm-5.3-flash with deepseek-v4-flash as the second leg. */ /* 1.3.9 NO-TOPIC-HARDCODE-1 (owner directive 2026-10-10): the triage prompt names no program or field; cluster_key tags come from the tags already in research_candidates. */
var ROUTER = "https://qnfo-ai.q08.workers.dev";
var AGENT_ORCH = "https://qnfo-agent-orchestrator.q08.workers.dev";
var PROMOTE_THRESHOLD = 60;
var DEDUP_SIM = 0.92;
var TRIAGE_MODEL = "deepseek-v4-flash";
function auth(token, env) {
  const exp = env.INTENT_TOKEN;
  if (!exp || !token) return false;
  const a = new TextEncoder().encode(token);
  const b = new TextEncoder().encode(exp);
  if (a.byteLength !== b.byteLength) return false;
  let d = 0;
  for (let i = 0; i < a.byteLength; i++) d |= a[i] ^ b[i];
  return d === 0;
}
__name(auth, "auth");
__name2(auth, "auth");
function clamp(s, n) {
  return String(s || "").slice(0, n);
}
__name(clamp, "clamp");
__name2(clamp, "clamp");
function classifyRules(desire) {
  const t = desire.toLowerCase();
  let type = "note", domain = "general", priority = "medium", due = null;
  if (/(\d{4}-\d{2}-\d{2})/.test(desire)) due = RegExp.$1;
  else if (/tomorrow/.test(t)) due = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  if (/(went to|attended|visited|took part|completed)/.test(t)) type = "activity";
  else if (/(remind|reminder|don't forget|do not forget)/.test(t)) type = "reminder";
  else if (/(meeting|appointment|schedule|calendar|event|call with|call on|book |reserve)/.test(t)) type = "event";
  else if (/(email|draft|send .*mail|reply to)/.test(t)) type = "email";
  else if (/(task|todo|to-do|need to|must |should |prepare|finish|complete|write up)/.test(t)) type = "task";
  else if (/(jot|note|idea|thought|remember this|write down)/.test(t)) type = "note";
  if (/(research|paper|arxiv|experiment|quantum|ultrametric|physics|theorem|proof|publication|manuscript)/.test(t)) domain = "research";
  else if (/(qwav|commercial|customer|client|lead|business|pricing|sales)/.test(t)) domain = "qwav";
  else if (/(personal|home|family|trip|holiday|health|gym|dinner|weekend|amsterdam)/.test(t)) domain = "personal";
  if (/(urgent|asap|today|immediately|critical|important)/.test(t)) priority = "high";
  if (/(someday|maybe|eventually|one day)/.test(t)) priority = "low";
  return { type, domain, priority, due };
}
__name(classifyRules, "classifyRules");
__name2(classifyRules, "classifyRules");
function withTimeout(p, ms, label) {
  let timer;
  // SUITE-IDLE-TIMER-1 (2026-10-26): the deadline is cleared once the race settles; it was left running, so an offline suite idled for the whole 25 s deadline after its last assertion.
  return Promise.race([p, new Promise(function(_, rej) {
    timer = setTimeout(function() {
      rej(new Error((label || "op") + " timed out after " + ms + "ms"));
    }, ms);
  })]).finally(function() { clearTimeout(timer); });
}
__name(withTimeout, "withTimeout");
__name2(withTimeout, "withTimeout");
async function recordClassify(env, model, ok, retry) {
  try {
    await env.D1.prepare("INSERT INTO intent_classify_stats (ts, model, ok, retry) VALUES (?1,?2,?3,?4)").bind((/* @__PURE__ */ new Date()).toISOString(), model, ok ? 1 : 0, retry ? 1 : 0).run();
  } catch (e) {
  }
}
__name(recordClassify, "recordClassify");
__name2(recordClassify, "recordClassify");
async function pickClassifier(env) {
  try {
    const cutoff = new Date(Date.now() - 7 * 864e5).toISOString();
    const row = await env.D1.prepare("SELECT COALESCE(SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END),0) AS fails, COUNT(*) AS n FROM intent_classify_stats WHERE model='glm-5.3-flash' AND ts>=?1").bind(cutoff).first();
    const n = row && row.n || 0;
    const fails = row && row.fails || 0;
    if (n >= 20 && fails / n > 0.05) return "deepseek-v4-flash";
  } catch (e) {
  }
  return "glm-5.3-flash";
}
__name(pickClassifier, "pickClassifier");
__name2(pickClassifier, "pickClassifier");
async function classifyAI(env, desire) {
  const sys = 'You classify a user desire into strict JSON: {"type":"note|task|event|email|reminder|research|activity|unknown","domain":"research|personal|qwav|general","priority":"low|medium|high","summary":"max 120 chars","due":"YYYY-MM-DD or null"}. Reply with the JSON object only. Do not fabricate fields or values the desire does not state; when ambiguous, classify type:"unknown" rather than guessing. ADVERSARIAL-REASONING-1 (label uncertainty, never invent a classification the text does not support).';
  const first = await pickClassifier(env);
  const order = first === "deepseek-v4-flash" ? ["deepseek-v4-flash", "glm-5.3-flash"] : ["glm-5.3-flash", "deepseek-v4-flash"];
  for (let i = 0; i < order.length; i++) {
    const model = order[i];
    try {
      const r = await withTimeout(env.QNFO_AI.fetch(ROUTER + "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.RT },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: clamp(desire, 1e3) }
          ],
          max_tokens: 300
        })
      }), 25e3, "classify-" + model);
      const j = await r.json();
      const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || "";
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) {
        await recordClassify(env, model, false, i > 0);
        continue;
      }
      const p = JSON.parse(m[0]);
      if (p && typeof p.type === "string") {
        await recordClassify(env, model, true, i > 0);
        return { type: p.type, domain: p.domain || "general", priority: p.priority || "medium", summary: clamp(p.summary, 120), due: p.due || null };
      }
      await recordClassify(env, model, false, i > 0);
    } catch (e) {
      await recordClassify(env, model, false, i > 0);
    }
  }
  return null;
}
__name(classifyAI, "classifyAI");
__name2(classifyAI, "classifyAI");
async function storeNote(env, intent) {
  try {
    const text = intent.desire;
    const day = intent.created_at.slice(0, 10);
    if (intent.domain === "personal") {
      const resp = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [clamp(text, 1e3)] });
      const v = (resp.data || []).find((x) => Array.isArray(x) && x.length === 768);
      if (v) await env.VZ_P.upsert([{ id: "intent:" + intent.id, values: v, metadata: { doc: "note", kind: "intent", path: "intents/" + day + "/" + intent.id + ".md", text: clamp(text, 800), ts: intent.created_at } }]);
    } else {
      const resp = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [clamp(text, 1e3)] });
      const v = (resp.data || []).find((x) => Array.isArray(x) && x.length === 768);
      if (v) await env.VZ_R.upsert([{ id: "intent:" + intent.id, values: v, metadata: { doc: "note", kind: "intent", path: "intents/" + day + "/" + intent.id + ".md", text: clamp(text, 800), ts: intent.created_at } }]);
    }
  } catch (e) {
    console.error(JSON.stringify({ at: "note-store", intent: intent.id, error: String(e && e.message || e).slice(0, 300) }));
  }
}
async function embedText(env, text) {
  const resp = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [clamp(text, 1e3)] });
  return (resp && resp.data || []).find((x) => Array.isArray(x) && x.length === 768) || null;
}
__name(embedText, "embedText");
async function storeActivity(env, intent, when) {
  try {
    const title = intent.summary || intent.desire.slice(0, 120);
    const v = await embedText(env, title + NL + intent.desire);
    if (!v) return { ok: false, error: "embedding returned no vector" };
    const index = intent.domain === "personal" ? env.VZ_P : env.VZ_R;
    if (!index) return { ok: false, error: "vector index binding missing" };
    await index.upsert([{ id: "activity:" + intent.id, values: v, metadata: { doc: "activity", kind: "intent", path: "activities/" + when + "/" + intent.id + ".md", date: when, title: clamp(title, 200), category: intent.domain === "research" ? "research" : "other", text: clamp(intent.desire, 800), ts: intent.created_at } }]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e).slice(0, 300) };
  }
}
__name(storeActivity, "storeActivity");
async function personalSearch(env, q, topK) {
  const v = await embedText(env, q);
  if (!v) throw new Error("embedding returned no vector");
  const res = await env.VZ_P.query(v, { topK, returnMetadata: "all" });
  const files = (res && res.matches || []).map((m) => {
    const md = m.metadata || {};
    return { path: md.path || m.id, bestScore: m.score, snippet: clamp(md.text || md.title || "", 400), doc: md.doc || null, ts: md.ts || null };
  });
  return { count: files.length, files };
}
__name(personalSearch, "personalSearch");
__name(storeNote, "storeNote");
__name2(storeNote, "storeNote");
async function handleIntent(env, body, source, device) {
  const desire = clamp(body.desire, 4e3);
  if (!desire) return { error: "desire required" };
  if (isNoise(desire) || /^(name|title|summarize|summarise)\s+(this|the)\s+(conversation|chat)/i.test(desire)) {
    return { silent: true, reason: "meta", type: "unknown", status: "silenced" };
  }
  // INTAKE-PERSIST-BUDGET-1 (2026-10-01, #1189): classifyAI runs before the INSERT and may try two models at 25 s each
  // (50 s worst case), but qnfo-ops researchQueue aborts its binding call at 20 s. The callee is then cancelled before
  // the row is written. A live probe reproduced it: "research idea was NOT queued: The operation was aborted", 65.7 s,
  // no intent row. The whole AI classification is now bounded at 8 s; on timeout the deterministic classifyRules result
  // is used, so the intent always persists inside the caller's budget. The AI still classifies whenever it is fast enough.
  const ai = await withTimeout(classifyAI(env, desire), 8e3, "classify-total").catch(function() {
    return null;
  });
  const cls = ai || classifyRules(desire);
  if (!cls.summary) {
    cls.summary = clamp(desire.replace(/^calendar event:\s*/i, "").trim(), 120);
  }
  const id = "int-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8) + Date.now().toString(36);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const type = ["note", "task", "event", "email", "reminder", "research", "activity", "unknown"].includes(cls.type) ? cls.type : "note";
  const domain = ["research", "personal", "qwav", "general"].includes(cls.domain) ? cls.domain : "general";
  let status = type === "note" ? "done" : "pending";
  // CF-OBS-ISSUE-1: bound the dedupe lookup so a slow D1 op can never hang intake past the storage timeout.
  const dupRow = await withTimeout(env.D1.prepare("SELECT id FROM intents WHERE desire = ?1 AND status NOT IN ('rejected','deduped') ORDER BY created_at ASC LIMIT 1").bind(desire).all(), 5e3, "dup-check").catch(() => null);
  if (dupRow && dupRow.results && dupRow.results.length) {
    return { id: dupRow.results[0].id, duplicate: true, dup_of: dupRow.results[0].id, type, domain, status };
  }
  await env.D1.prepare(
    "INSERT INTO intents (id, desire, source, device, type, domain, priority, summary, due, status, wbs_code, created_at, processed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)"
  ).bind(id, desire, clamp(source, 60), clamp(device, 60), type, domain, cls.priority, cls.summary || "", cls.due || null, status, null, now, null).run();
  const intent = { id, desire, source, device, type, domain, priority: cls.priority, summary: cls.summary || "", due: cls.due || null, status, created_at: now };
  if (type === "event") {
    await promoteCalendar(env, intent);
  }
  if (type === "note") {
    await storeNote(env, intent);
    await env.D1.prepare("UPDATE intents SET processed_at=?1 WHERE id=?2").bind(now, id).run();
    intent.status = "done";
  }
  if (type === "activity") {
    // AUTOAUDIT-DEAD-CALLERS-1 (#2302): the activity goes into this worker's own vector indexes (the store the retired
    // search worker fronted); the outcome is always recorded on the intent row, never swallowed.
    const when = cls.due || now.slice(0, 10);
    const act = await storeActivity(env, intent, when);
    if (act.ok) {
      status = "done";
      intent.status = "done";
      await env.D1.prepare("UPDATE intents SET status='done', processed_at=?1 WHERE id=?2").bind(now, id).run();
    } else {
      status = "failed";
      intent.status = "failed";
      intent.error = act.error;
      console.error(JSON.stringify({ at: "activity-store", intent: id, error: act.error }));
      await env.D1.prepare("UPDATE intents SET status='failed', processed_at=?1 WHERE id=?2").bind(now, id).run();
    }
    // Kept from main 1.3.11-codeagent: a copy goes to personal-api. Best effort: the local store above decides the
    // intent's status, and a failure here is logged, not swallowed and not fatal.
    try {
      const payload = { doc: "activity", date: when, title: cls.summary || desire.slice(0, 120), category: domain === "research" ? "research" : "other", venue: "", notes: desire.slice(0, 500) };
      const headers = { "Content-Type": "application/json" };
      if (env.INDEX_TOKEN) headers["X-Index-Token"] = env.INDEX_TOKEN;
      const resp = await withTimeout(fetch("https://personal-api.q08.workers.dev/activity", { method: "POST", headers, body: JSON.stringify(payload) }), 5e3, "personal-api activity");
      intent.forwarded = resp.ok;
      if (!resp.ok) console.log("activity forward failed:", "personal-api returned " + resp.status);
    } catch (e) {
      intent.forwarded = false;
      console.log("activity forward failed:", String(e && e.message || e).slice(0, 240));
    }
  }
  return intent;
}
__name(handleIntent, "handleIntent");
__name2(handleIntent, "handleIntent");
async function promoteCalendar(env, intent) {
  try {
    if (!env.CAL_API) return;
    const plane = intent.domain === "personal" ? "personal" : "qnfo";
    const from = (intent.due || intent.created_at.slice(0, 10)).slice(0, 10);
    const title = (intent.summary || intent.desire.slice(0, 120)).replace(/^calendar event:\s*/i, "").trim().slice(0, 300);
    if (!title) return;
    const authH = env.CAL_TOKEN ? { Authorization: "Bearer " + env.CAL_TOKEN } : {};
    const ex = await env.CAL_API.fetch("https://calendar-api/events?plane=" + plane + "&from=" + from + "&to=" + from, { headers: authH });
    const ej = await ex.json();
    const evs = ej && ej.events || [];
    if (evs.some((e) => (e.title || "") === title && (e.dtstart || "") === from)) return;
    await env.CAL_API.fetch("https://calendar-api/events?plane=" + plane, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authH),
      body: JSON.stringify({ title, dtstart: from, dtend: from, source: "intent-orchestrator", domain: intent.domain || null, status: "confirmed" })
    });
    await env.D1.prepare("UPDATE intents SET processed_at=?1 WHERE id=?2").bind((/* @__PURE__ */ new Date()).toISOString(), intent.id).run();
  } catch (e) {
    console.log("calendar promote failed:", e && e.message || e);
  }
}
__name(promoteCalendar, "promoteCalendar");
__name2(promoteCalendar, "promoteCalendar");
function digestLines(intents) {
  const out = [];
  const notes = intents.filter((i) => i.type === "note");
  const pending = intents.filter((i) => i.type !== "note");
  out.push("QNFO intent digest - " + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
  out.push("");
  if (notes.length) out.push("Captured notes: " + notes.length + " (stored in Vectorize)");
  if (pending.length) {
    out.push("Pending:");
    for (const p of pending) out.push("- [" + p.type + "] " + (p.summary || p.desire.slice(0, 80)) + (p.due ? " (due " + p.due + ")" : ""));
  }
  if (!notes.length && !pending.length) out.push("No new intents.");
  return out.join(NL);
}
__name(digestLines, "digestLines");
__name2(digestLines, "digestLines");
var HUMAN_DOMAINS = new Set("outlook.com hotmail.com live.com msn.com gmail.com yahoo.com ymail.com icloud.com me.com mac.com protonmail.com proton.me zoho.com aol.com gmx.com tutanota.com".split(" "));
async function sendDigest(env, subject, text) {
  const dom = String(env.DIGEST_TO || "").split("@")[1] || "";
  if (HUMAN_DOMAINS.has(dom)) return { skipped: "personal-domain", to: env.DIGEST_TO };
  const r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + env.CF_ACCOUNT + "/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.CF_TOKEN },
    body: JSON.stringify({
      personalization: [{ to: [{ email: env.DIGEST_TO }] }],
      from: { email: env.DIGEST_FROM, name: "QNFO Agent" },
      subject,
      text
    })
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, success: !!j.success, result: j.result || j.errors || null };
}
__name(sendDigest, "sendDigest");
__name2(sendDigest, "sendDigest");
var NOISE_RE = [
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
  /^ok$/i
];
function isNoise(text) {
  const t = String(text || "");
  return NOISE_RE.some(function(re) {
    re.lastIndex = 0;
    return re.test(t);
  });
}
__name(isNoise, "isNoise");
__name2(isNoise, "isNoise");
var schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.D1.prepare("CREATE TABLE IF NOT EXISTS research_candidates (id TEXT PRIMARY KEY, cluster_key TEXT, question TEXT, merit INTEGER, impact INTEGER, novelty INTEGER, feasibility INTEGER, score INTEGER, intent_ids TEXT, status TEXT DEFAULT 'promoted', agent_task_id TEXT, wbs_code TEXT, created_at TEXT, processed_at TEXT)").run();
      await env.D1.prepare("CREATE INDEX IF NOT EXISTS idx_rc_status ON research_candidates(status)").run();
      await env.D1.prepare("CREATE INDEX IF NOT EXISTS idx_rc_cluster ON research_candidates(cluster_key)").run();
      await env.D1.prepare("CREATE TABLE IF NOT EXISTS intent_classify_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, model TEXT, ok INTEGER DEFAULT 0, retry INTEGER DEFAULT 0)").run();
      // CF-OBS-ISSUE-1 (#1000786): intake ran "SELECT id FROM intents WHERE desire = ?1" on a table with no index on
      // desire, so as intents grew the dedupe lookup became a full-table scan and the D1 storage op blew its timeout
      // ("D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset"). The lookup now runs
      // against an index; the statement itself is unchanged.
      await env.D1.prepare("CREATE INDEX IF NOT EXISTS idx_intents_desire ON intents(desire)").run();
      try {
        await env.D1.prepare("ALTER TABLE intents ADD COLUMN noise INTEGER DEFAULT 0").run();
      } catch (e) {
      }
      try {
        await env.D1.prepare("ALTER TABLE intents ADD COLUMN dup_of TEXT").run();
      } catch (e) {
      }
      // INTENT-TRIAGE-SKIP-1: the verdict columns exist on the live table; a fresh database gets them here, added only when missing.
      try {
        const have = new Set(((await env.D1.prepare("SELECT name FROM pragma_table_info('intents')").all()).results || []).map((r) => r.name));
        for (const [col, type] of [["triaged_at", "TEXT"], ["triage_decision", "TEXT"], ["triage_score", "REAL"], ["triage_model", "TEXT"]]) {
          if (!have.has(col)) await env.D1.prepare("ALTER TABLE intents ADD COLUMN " + col + " " + type).run();
        }
      } catch (e) {
        console.log("verdict columns err", e && e.message || e);
      }
    })().catch((e) => {
      schemaReady = null;
      console.log("schema err", e && e.message || e);
    });
  }
  return schemaReady;
}
__name(ensureSchema, "ensureSchema");
__name2(ensureSchema, "ensureSchema");
async function triageAI(env, desire) {
  let knownTags = "";
  try {
    const kt = await env.D1.prepare("SELECT cluster_key, COUNT(*) n FROM research_candidates WHERE cluster_key IS NOT NULL AND cluster_key != '' GROUP BY cluster_key ORDER BY n DESC LIMIT 12").all();
    const tags = (kt && kt.results || []).map((r) => String(r.cluster_key)).filter(Boolean);
    knownTags = "\nKNOWN TAGS: " + (tags.length ? tags.join(", ") : "(none yet)");
  } catch (e) {
  }
  try {
    const r = await env.QNFO_AI.fetch(ROUTER + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.RT },
      body: JSON.stringify({
        model: TRIAGE_MODEL,
        messages: [
          { role: "system", content: 'You are the QNFO idea-triage evaluator for an autonomous research pipeline. Evaluate the user idea using only the text it contains. Reply with STRICT JSON only: {"is_noise":bool,"question":"normalized research question, max 140 chars","cluster_key":"short lowercase program tag","technical_merit":0-100,"impact_potential":0-100,"novelty":0-100,"feasibility":0-100}. cluster_key: reuse one of the KNOWN TAGS below when the idea belongs to that program; otherwise coin one short lowercase tag (letters, digits, hyphen) from the idea\'s own wording; use other only when nothing fits. technical_merit: scientific substance, precision, testability. impact_potential: likelihood to yield citable publications and visibility. novelty: distance from results established in the idea\'s own field. feasibility: realistic for autonomous, in-silico research by the pipeline (derivation, simulation, formal analysis). is_noise=true ONLY for agent tool-call instructions, meta-prompts, pipeline probes, or non-research chatter.' + knownTags },
          { role: "user", content: clamp(desire, 1e3) }
        ],
        max_tokens: 300
      })
    });
    const j = await r.json();
    const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || "";
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]);
    const num = /* @__PURE__ */ __name2(function(x, lo, hi) {
      return Math.max(lo, Math.min(hi, Math.round(Number(x) || 0)));
    }, "num");
    return {
      is_noise: !!p.is_noise,
      question: clamp(String(p.question || desire).slice(0, 140), 140),
      cluster_key: clamp(String(p.cluster_key || "other").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40), 40) || "other",
      merit: num(p.technical_merit, 0, 100),
      impact: num(p.impact_potential, 0, 100),
      novelty: num(p.novelty, 0, 100),
      feasibility: num(p.feasibility, 0, 100)
    };
  } catch (e) {
    return null;
  }
}
__name(triageAI, "triageAI");
__name2(triageAI, "triageAI");
function scoreOf(t) {
  return Math.round(0.35 * t.merit + 0.35 * t.impact + 0.15 * t.novelty + 0.15 * t.feasibility);
}
__name(scoreOf, "scoreOf");
__name2(scoreOf, "scoreOf");
async function storeIntentEmbed(env, row) {
  try {
    const resp = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [clamp(row.desire, 1e3)] });
    const v = (resp.data || []).find((x) => Array.isArray(x) && x.length === 768);
    if (!v) return;
    const day = (row.created_at || "").slice(0, 10);
    if (row.domain === "personal") {
      await env.VZ_P.upsert([{ id: "intent:" + row.id, values: v, metadata: { doc: "intent", kind: "intent", path: "intents/" + day + "/" + row.id + ".md", text: clamp(row.desire, 800), ts: row.created_at } }]);
    } else {
      await env.VZ_R.upsert([{ id: "intent:" + row.id, values: v, metadata: { doc: "intent", kind: "intent", path: "intents/" + day + "/" + row.id + ".md", text: clamp(row.desire, 800), ts: row.created_at } }]);
    }
  } catch (e) {
  }
}
__name(storeIntentEmbed, "storeIntentEmbed");
__name2(storeIntentEmbed, "storeIntentEmbed");
async function findDuplicate(env, row) {
  try {
    const resp = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [clamp(row.desire, 1e3)] });
    const v = (resp.data || []).find((x) => Array.isArray(x) && x.length === 768);
    if (!v) return null;
    const q = await env.VZ_R.query(v, { topK: 1, returnMetadata: "all" });
    const m = (q.matches || [])[0];
    if (m && typeof m.score === "number" && m.score >= DEDUP_SIM && m.id && String(m.id).startsWith("intent:")) return String(m.id).slice(7);
  } catch (e) {
  }
  return null;
}
__name(findDuplicate, "findDuplicate");
__name2(findDuplicate, "findDuplicate");
var RESEARCH_FEED_RE = /-research-feed$/;
// INTENT-TRIAGE-SKIP-1: a row is a research submission when the classifier says research, or when it came from a research feed in the
// research domain whatever type it got. A calendar item from calendar-sync or mcp is not one.
function isResearchSubmission(row) {
  return row.type === "research" || (row.domain === "research" && RESEARCH_FEED_RE.test(String(row.source || "")));
}
__name(isResearchSubmission, "isResearchSubmission");
__name2(isResearchSubmission, "isResearchSubmission");
var DEDUP_MODEL = "@cf/baai/bge-base-en-v1.5";
async function triageIntent(env, row) {
  const id = row.id;
  const lock = await env.D1.prepare("UPDATE intents SET status='triaging' WHERE id=? AND status='pending'").bind(id).run();
  if (!lock.meta.changes) return { id, skipped: true };
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    if (isNoise(row.desire)) {
      await env.D1.prepare("UPDATE intents SET status='rejected', noise=1, processed_at=?1, triaged_at=?1, triage_decision='NOISE', triage_model='rule:noise-patterns' WHERE id=?2").bind(now, id).run();
      return { id, verdict: "rejected" };
    }
    const dup = await findDuplicate(env, row);
    if (dup) {
      await env.D1.prepare("UPDATE intents SET status='deduped', dup_of=?1, processed_at=?2, triaged_at=?2, triage_decision='DUPLICATE', triage_model=?3 WHERE id=?4").bind(dup, now, DEDUP_MODEL, id).run();
      return { id, verdict: "deduped", dup_of: dup };
    }
    const t = await triageAI(env, row.desire);
    // GATE-AUDIT-1:intent_promote – enforce per‑day promotion cap and deterministic dedup condition
    if (t && t.is_noise) {
      // Model‑reported noise is only terminal for research‑feed intents; owner‑sourced intents stay pending
      if (row.source && /-research-feed$/.test(String(row.source))) {
        await env.D1.prepare("UPDATE intents SET status='rejected', noise=1, processed_at=?1, triaged_at=?1, triage_decision='NOISE', triage_model=?2 WHERE id=?3").bind(now, TRIAGE_MODEL, id).run();
        return { id, verdict: "rejected", by: "ai" };
      } else {
        // Owner‑sourced intent: do not reject, keep pending for further handling
        await env.D1.prepare("UPDATE intents SET status='pending', processed_at=?1, triaged_at=?1, triage_decision='NOISE-IGNORED', triage_model=?2 WHERE id=?3").bind(now, TRIAGE_MODEL, id).run();
        return { id, verdict: "pending-noise-ignored" };
      }
    }
    if (!t) {
      await env.D1.prepare("UPDATE intents SET status='pending' WHERE id=? AND status='triaging'").bind(id).run();
      return { id, verdict: "deferred" };
    }
    const score = scoreOf(t);
    if (score >= PROMOTE_THRESHOLD) {
      const cid = "cand-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8) + Date.now().toString(36);
      await env.D1.prepare("INSERT INTO research_candidates (id, cluster_key, question, merit, impact, novelty, feasibility, score, intent_ids, status, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)").bind(cid, t.cluster_key, t.question, t.merit, t.impact, t.novelty, t.feasibility, score, JSON.stringify([id]), "promoted", now).run();
      await env.D1.prepare("UPDATE intents SET status='triaged', processed_at=?1, triaged_at=?1, triage_decision='TO-RESEARCH-CANDIDATE', triage_score=?2, triage_model=?3 WHERE id=?4").bind(now, score, TRIAGE_MODEL, id).run();
      await storeIntentEmbed(env, row);
      return { id, verdict: "promoted", candidate: cid, score, question: t.question };
    }
    await env.D1.prepare("UPDATE intents SET status='triaged', processed_at=?1, triaged_at=?1, triage_decision='BELOW-THRESHOLD', triage_score=?2, triage_model=?3 WHERE id=?4").bind(now, score, TRIAGE_MODEL, id).run();
    await storeIntentEmbed(env, row);
    return { id, verdict: "below-threshold", score };
  } catch (e) {
    await env.D1.prepare("UPDATE intents SET status='pending' WHERE id=? AND status='triaging'").bind(id).run();
    return { id, verdict: "error", error: String(e && e.message || e).slice(0, 200) };
  }
}
__name(triageIntent, "triageIntent");
__name2(triageIntent, "triageIntent");
async function runBatchTriage(env) {
  await ensureSchema(env);
  const rows = await env.D1.prepare("SELECT * FROM intents WHERE status='pending' AND (type='research' OR (domain='research' AND source LIKE '%-research-feed')) ORDER BY created_at DESC LIMIT 40").all();
  const out = [];
  for (const row of rows.results) out.push(await triageIntent(env, row));
  const counts = { scanned: out.length, promoted: 0, rejected: 0, deduped: 0, below: 0, deferred: 0, skipped: 0, errors: 0 };
  for (const o of out) {
    if (o.verdict === "promoted") counts.promoted++;
    else if (o.verdict === "rejected") counts.rejected++;
    else if (o.verdict === "deduped") counts.deduped++;
    else if (o.verdict === "below-threshold") counts.below++;
    else if (o.verdict === "deferred") counts.deferred++;
    else if (o.skipped) counts.skipped++;
    else counts.errors++;
  }
  return { counts, results: out };
}
__name(runBatchTriage, "runBatchTriage");
__name2(runBatchTriage, "runBatchTriage");
function researchPrompt(c) {
  return [
    "QNFO research brief - autonomous pipeline task.",
    "Research question: " + c.question,
    "",
    "Use your tools to gather primary evidence:",
    "1) arxiv_search and web_search with at least 3 distinct query formulations.",
    "2) query_graph (stats, neighbors) and get_paper_context for QNFO corpus prior work.",
    "3) For quantitative questions, give estimates with stated assumptions and derivation steps.",
    "",
    "Deliverable (final result, scholarly prose):",
    "- Current state of knowledge (3-8 sentences).",
    "- Key quantitative estimates or bounds with assumptions.",
    "- 2-5 open research questions this idea could answer.",
    "- Top 5 citations (arXiv id / slug / DOI).",
    "Use store_note for your findings. No meta-commentary about pipeline status."
  ].join("\n");
}
__name(researchPrompt, "researchPrompt");
__name2(researchPrompt, "researchPrompt");
async function dispatchCandidate(env, c) {
  if (!env.DISPATCH_TOKEN) return { dispatched: false, error: "DISPATCH_TOKEN not configured" };
  const r = await fetch(AGENT_ORCH + "/task", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Sync-Token": env.DISPATCH_TOKEN },
    body: JSON.stringify({ prompt: researchPrompt(c), max_steps: 6 })
  });
  if (!r.ok) return { dispatched: false, error: "agent-http-" + r.status };
  const j = await r.json().catch(() => ({}));
  const tid = j.task_id || null;
  if (!tid) return { dispatched: false, error: "agent-no-task-id" };
  const upd = await env.D1.prepare("UPDATE research_candidates SET status='dispatched', agent_task_id=?, processed_at=? WHERE id=? AND status='promoted'").bind(tid, (/* @__PURE__ */ new Date()).toISOString(), c.id).run();
  if (!upd.meta.changes) return { dispatched: false, error: "candidate-not-promoted" };
  return { dispatched: true, candidate: c.id, question: c.question, agent_task_id: tid, poll: "/task/" + tid };
}
__name(dispatchCandidate, "dispatchCandidate");
__name2(dispatchCandidate, "dispatchCandidate");
async function syncDispatched(env) {
  const rows = await env.D1.prepare("SELECT * FROM research_candidates WHERE status='dispatched'").all();
  const out = [];
  for (const c of rows.results) {
    if (!c.agent_task_id) continue;
    try {
      const r = await fetch(AGENT_ORCH + "/task/" + c.agent_task_id);
      if (!r.ok) {
        out.push({ id: c.id, task: c.agent_task_id, status: "http-" + r.status });
        continue;
      }
      const st = await r.json();
      if (st.status === "completed") {
        await env.D1.prepare("UPDATE research_candidates SET status='research_completed', processed_at=? WHERE id=?").bind((/* @__PURE__ */ new Date()).toISOString(), c.id).run();
        out.push({ id: c.id, task: c.agent_task_id, status: "research_completed" });
      } else if (st.status === "failed") {
        await env.D1.prepare("UPDATE research_candidates SET status='research_failed', processed_at=? WHERE id=?").bind((/* @__PURE__ */ new Date()).toISOString(), c.id).run();
        out.push({ id: c.id, task: c.agent_task_id, status: "research_failed" });
      } else {
        out.push({ id: c.id, task: c.agent_task_id, status: st.status });
      }
    } catch (e) {
      out.push({ id: c.id, task: c.agent_task_id, error: String(e && e.message || e).slice(0, 120) });
    }
  }
  return out;
}
__name(syncDispatched, "syncDispatched");
__name2(syncDispatched, "syncDispatched");
async function autoDispatch(env) {
  const active = await env.D1.prepare("SELECT COUNT(*) AS n FROM research_candidates WHERE status='dispatched'").first();
  if (active && active.n > 0) return { dispatched: false, reason: "active-task-exists", active: active.n };
  const top = await env.D1.prepare("SELECT * FROM research_candidates WHERE status='promoted' ORDER BY score DESC LIMIT 1").first();
  if (!top) return { dispatched: false, reason: "no-promoted-candidates" };
  return dispatchCandidate(env, top);
}
__name(autoDispatch, "autoDispatch");
__name2(autoDispatch, "autoDispatch");
async function selfRegister(env) {
  const manifest = {
    service: "qnfo-intent-orchestrator",
    kind: "worker",
    version: VERSION,
    base_url: "https://qnfo-intent-orchestrator.q08.workers.dev",
    purpose: "intent orchestrator: classify/route/queue desires (notes, tasks, events, emails, research) + autonomous research triage/dispatch pipeline",
    capabilities: ["intent-classify", "intent-queue", "exact-match-dedupe", "semantic-dedupe", "research-triage", "research-dispatch", "digest", "calendar-promote"],
    routes: ["/health", "/intent", "/intents", "/intents/stats", "/digest", "/digest/send", "/triage/run", "/triage/sync", "/triage/candidates", "/triage/stats", "/triage/dispatch", "/triage/candidate"],
    tools: [],
    models: [],
    deps: ["ai:AI", "cron:2x", "d1:qnfo-audit", "service:calendar-api", "service:qnfo-agent-orchestrator", "service:qnfo-ai", "service:qnfo-ops", "vectorize:personal-life", "vectorize:qnfo-ai-log"]
  };
  const resp = await env.QNFO_OPS.fetch("https://qnfo-ops.internal/registry/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (env.REGISTRY_TOKEN || "") },
    body: JSON.stringify(manifest)
  });
  return resp.ok;
}
__name(selfRegister, "selfRegister");
__name2(selfRegister, "selfRegister");
// ---- CRON-GRID-1:BEGIN (owner directive 2026-10-19: "ALL CRON TICKS SHALL BE MEASURED IN 5-MINUTE INTERVALS, AND NO CRON
// SHALL EXECUTE LESS THAN ONCE EVERY HOUR. ALL CRON FAILURES/ERRORS SHALL BE TRIAGED AND REMEDIATED AUTOMATICALLY BY THE FLEET.")
// Cloudflare fires this worker only on triggers that repeat at least hourly, on minutes that are multiples of 5. A job that
// had its own slower trigger (daily, weekly, every 6 hours) keeps its cadence: it runs on the first grid fire after its old
// slot, and is retried on later fires while its last good run is older than its period plus 30 minutes, at most
// CRON_GRID_RETRIES times in a row; past that CRON-WATCH-1 (qnfo-audit fleet_tasks cron-watch) escalates it to the code loop.
// Every run is one cron_fire_log row (source worker:<name>, outcome ok, error or idle) that CRON-WATCH-1 reads. A job named
// retry: false (a send to people outside the fleet) runs only on its slot, so a failure is never repeated at a reader.
var CRON_GRID_RETRIES = 3;
function cronGridField(spec, v, lo, hi) {
  return String(spec).split(",").some(function (part) {
    var step = 1, sm = /^(.*)\/(\d+)$/.exec(part), a, b;
    if (sm) { part = sm[1]; step = Math.max(1, parseInt(sm[2], 10)); }
    if (part === "*") { a = lo; b = hi; }
    else if (part.indexOf("-") > 0) { a = parseInt(part, 10); b = parseInt(part.split("-")[1], 10); }
    else { a = parseInt(part, 10); b = sm ? hi : a; }
    return v >= a && v <= b && (v - a) % step === 0;
  });
}
// Cloudflare numbers weekdays 1 (Sunday) to 7 (Saturday) (CF-DOW, qnfo-fleet-control 2026-10-05).
function cronGridMatch(expr, d) {
  var f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return false;
  var domOk = cronGridField(f[2], d.getUTCDate(), 1, 31), dowOk = cronGridField(f[4], d.getUTCDay() + 1, 1, 7);
  var dayOk = f[2] !== "*" && f[4] !== "*" ? (domOk || dowOk) : (domOk && dowOk);
  return dayOk && cronGridField(f[0], d.getUTCMinutes(), 0, 59) && cronGridField(f[1], d.getUTCHours(), 0, 23) && cronGridField(f[3], d.getUTCMonth() + 1, 1, 12);
}
// True when expr had a slot in the window (sinceMs, untilMs].
function cronGridSlot(expr, sinceMs, untilMs) {
  for (var t = Math.floor(untilMs / 60000) * 60000; t > sinceMs; t -= 60000) if (cronGridMatch(expr, new Date(t))) return true;
  return false;
}
async function cronGridLog(db, worker, expr, startMs, outcome, note) {
  if (!db) return;
  try {
    await db.prepare("INSERT INTO cron_fire_log (cron_name, task_id, cron_expr, fired_at, fired_epoch_ms, outcome, source, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
      .bind(worker + "|" + expr, worker, expr, new Date(startMs).toISOString(), startMs, outcome, "worker:" + worker, String(note || "").slice(0, 500)).run();
  } catch (e) { console.error(JSON.stringify({ worker: worker, where: "cron-grid-log", error: String(e && e.message || e).slice(0, 200) })); }
}
async function cronGridDue(db, cfg, nowMs) {
  var out = [], lag = cfg.lagMin || 0;
  for (var i = 0; i < cfg.jobs.length; i++) {
    var j = cfg.jobs[i];
    if (cronGridSlot(j.cron, nowMs - (lag + cfg.tickMin) * 60000, nowMs - lag * 60000)) { out.push({ cron: j.cron, why: "slot" }); continue; }
    if (!db || !j.retry) continue;
    try {
      var name = cfg.worker + "|" + j.cron;
      var r = await db.prepare("SELECT COUNT(*) AS n, MAX(CASE WHEN outcome = 'ok' THEN fired_epoch_ms END) AS last_ok, SUM(CASE WHEN outcome = 'error' AND fired_epoch_ms > COALESCE((SELECT MAX(fired_epoch_ms) FROM cron_fire_log WHERE cron_name = ?1 AND outcome = 'ok'), 0) THEN 1 ELSE 0 END) AS fails FROM cron_fire_log WHERE cron_name = ?1").bind(name).first();
      if (r && Number(r.n) > 0 && Number(r.fails || 0) < CRON_GRID_RETRIES && nowMs - Number(r.last_ok || 0) > (j.periodMin + 30) * 60000) out.push({ cron: j.cron, why: "retry" });
    } catch (e) { console.error(JSON.stringify({ worker: cfg.worker, where: "cron-grid-due", error: String(e && e.message || e).slice(0, 200) })); }
  }
  return out;
}
// One run of the worker's own handler, awaited with its waitUntil work, logged with its outcome.
async function cronGridOne(db, worker, expr, why, ev, ctx, run) {
  var t0 = Date.now(), pending = [];
  var c = { waitUntil: function (p) { pending.push(Promise.resolve(p)); } };
  try {
    await run(ev, c);
    // Index loop, not allSettled: work a waitUntil promise adds while it runs is awaited too.
    var bad = null;
    for (var k = 0; k < pending.length; k++) { try { await pending[k]; } catch (e) { if (!bad) bad = e || new Error("waitUntil rejected"); } }
    if (bad) throw bad;
    await cronGridLog(db, worker, expr, t0, "ok", why + " " + (Date.now() - t0) + " ms");
  } catch (e) {
    await cronGridLog(db, worker, expr, t0, "error", why + ": " + String(e && e.message || e));
    throw e;
  }
}
// cfg: { worker, tick, tickMin, lagMin, jobs: [{ cron, periodMin, retry }], own: "self" | "none" | "<cron the tick runs as>", ownWhenDue }
async function cronGridRun(db, event, ctx, cfg, run) {
  var cron = String((event && event.cron) || "");
  var nowMs = Number(event && event.scheduledTime) || Date.now();
  if (cron !== cfg.tick) return cronGridOne(db, cfg.worker, cron || "manual", "fire", event, ctx, run);
  var due = await cronGridDue(db, cfg, nowMs), firstErr = null;
  for (var i = 0; i < due.length; i++) {
    try { await cronGridOne(db, cfg.worker, due[i].cron, due[i].why, { cron: due[i].cron, scheduledTime: nowMs, type: "scheduled" }, ctx, run); }
    catch (e) { if (!firstErr) firstErr = e; }
  }
  if (cfg.own === "none" || (due.length && cfg.ownWhenDue === false)) {
    if (!due.length) await cronGridLog(db, cfg.worker, cfg.tick, nowMs, "idle", "grid tick: no job due");
  } else {
    var ev = cfg.own && cfg.own !== "self" ? { cron: cfg.own, scheduledTime: nowMs, type: "scheduled" } : event;
    try { await cronGridOne(db, cfg.worker, cfg.tick, "tick", ev, ctx, run); } catch (e) { if (!firstErr) firstErr = e; }
  }
  if (firstErr) throw firstErr;
}
// ---- CRON-GRID-1:END ----
var CRON_GRID_CFG = { worker: "qnfo-intent-orchestrator", tick: "0,30 * * * *", tickMin: 30, lagMin: 0, jobs: [{ cron: "0 6 * * *", periodMin: 1440, retry: false }, { cron: "30 6 * * *", periodMin: 1440, retry: true }], own: "none" };
var worker_default = {
  async scheduled(event, env, ctx) {
    return cronGridRun(env.D1, event, ctx, CRON_GRID_CFG, (ev, _ctx) => worker_default.scheduledOnce(ev, env));
  },
  async scheduledOnce(event, env) {
    let hbOk = 1;
    try {
    if (event.cron === "0 6 * * *") {
      const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const rows = await env.D1.prepare("SELECT * FROM intents WHERE substr(created_at,1,10) = ?1 AND status != 'done' AND status != 'rejected' AND status != 'deduped' AND status != 'triaged'").bind(day).all();
      const notes = await env.D1.prepare("SELECT COUNT(*) AS n FROM intents WHERE substr(created_at,1,10) = ?1 AND type='note'").bind(day).first();
      const lines = ["QNFO intent digest - " + day, ""];
      if (notes && notes.n) lines.push("Captured notes: " + notes.n + " (stored in Vectorize)");
      if (rows.results.length) {
        lines.push("Pending:");
        for (const p of rows.results) lines.push("- [" + p.type + "] " + (p.summary || p.desire.slice(0, 80)) + (p.due ? " (due " + p.due + ")" : ""));
      } else {
        lines.push("No pending items.");
      }
      await sendDigest(env, "QNFO intent digest - " + day, lines.join(NL));
    }
    if (event.cron === "30 6 * * *") {
      try {
        await ensureSchema(env);
        const t = await runBatchTriage(env);
        const s = await syncDispatched(env);
        const d = await autoDispatch(env);
        console.log("[triage-cron]", JSON.stringify({ counts: t.counts, sync: s.slice(0, 5), dispatch: d }).slice(0, 2500));
      } catch (e) {
        hbOk = 0;
        console.log("[triage-cron] error:", e && e.message || e);
      }
    }
    } catch (e) {
      hbOk = 0;
      throw e;
    } finally {
      // CRON-ONLY-HEARTBEAT-1 (agent_issues 2397): the row means the scheduled run finished; the write never throws or fails the cron.
      try {
        await env.D1.prepare("INSERT INTO fleet_heartbeat (worker, version, ts, ok) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(worker) DO UPDATE SET version=excluded.version, ts=excluded.ts, ok=excluded.ok").bind("qnfo-intent-orchestrator", VERSION, (/* @__PURE__ */ new Date()).toISOString(), hbOk).run();
      } catch (e) {
        console.error("[cron-heartbeat] write failed:", e && e.message || e);
      }
    }
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (path === "/health" && method === "GET") {
      if (ctx && ctx.waitUntil && env.QNFO_OPS && env.REGISTRY_TOKEN) {
        ctx.waitUntil(selfRegister(env).catch((e) => console.log("self-register err", e && e.message || e)));
      }
      return new Response(JSON.stringify({ ok: true, worker: "qnfo-intent-orchestrator", version: VERSION, capabilities: ["intent-intake", "intent-triage", "research-dispatch", "daily-digest", "personal-search"], limitations: ["every route except /health needs a bearer token", "AI classification at intake is bounded at 8 s (INTAKE-PERSIST-BUDGET-1)", "the digest is sent at 06:00 and triage plus research dispatch run at 06:30 daily, on the 0,30 grid trigger (CRON-GRID-1)"] }), { headers: { "Content-Type": "application/json", ...cors } });
    }
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!auth(token, env)) return new Response("unauthorized", { status: 401, headers: cors });
    if (path === "/intent" && method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response("bad json", { status: 400, headers: cors });
      }
      const source = url.searchParams.get("source") || body.source || "unknown";
      const device = url.searchParams.get("device") || body.device || "unknown";
      const intent = await handleIntent(env, body, source, device);
      if (intent.error) return new Response(JSON.stringify(intent), { status: 400, headers: { "Content-Type": "application/json", ...cors } });
      if (isResearchSubmission(intent) && ctx && ctx.waitUntil) {
        ctx.waitUntil((async () => {
          await ensureSchema(env);
          await triageIntent(env, intent);
        })().catch((e) => console.log("inline triage err", e && e.message || e)));
      }
      return new Response(JSON.stringify(intent), { status: 201, headers: { "Content-Type": "application/json", ...cors } });
    }
    if (path === "/personal/search" && method === "GET") {
      // AUTOAUDIT-DEAD-CALLERS-1 (#2302): the personal index search qnfo-tools-mcp used to get from the retired search worker.
      const q = clamp(url.searchParams.get("q"), 300);
      if (!q) return new Response(JSON.stringify({ error: "q required" }), { status: 400, headers: { "Content-Type": "application/json", ...cors } });
      const topK = Math.min(Math.max(parseInt(url.searchParams.get("topK") || "8", 10) || 8, 1), 20);
      try {
        return new Response(JSON.stringify(await personalSearch(env, q, topK)), { headers: { "Content-Type": "application/json", ...cors } });
      } catch (e) {
        console.error(JSON.stringify({ at: "personal-search", error: String(e && e.message || e).slice(0, 300) }));
        return new Response(JSON.stringify({ error: "search failed" }), { status: 502, headers: { "Content-Type": "application/json", ...cors } });
      }
    }
    if (path === "/intents" && method === "GET") {
      const status = url.searchParams.get("status") || "";
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 100);
      const rows = status ? await env.D1.prepare("SELECT * FROM intents WHERE status = ?1 ORDER BY created_at DESC LIMIT ?2").bind(status, limit).all() : await env.D1.prepare("SELECT * FROM intents ORDER BY created_at DESC LIMIT ?1").bind(limit).all();
      return new Response(JSON.stringify({ count: rows.results.length, intents: rows.results }), { headers: { "Content-Type": "application/json", ...cors } });
    }
    if (path === "/intents/stats" && method === "GET") {
      const rows = await env.D1.prepare("SELECT type, domain, status, COUNT(*) AS n FROM intents GROUP BY type, domain, status").all();
      return new Response(JSON.stringify({ stats: rows.results }), { headers: { "Content-Type": "application/json", ...cors } });
    }
    if (path === "/digest" && method === "GET") {
      const days = Math.max(parseInt(url.searchParams.get("days") || "1", 10) || 1, 1);
      const from = new Date(Date.now() - days * 864e5).toISOString();
      const rows = await env.D1.prepare("SELECT * FROM intents WHERE created_at >= ?1 ORDER BY created_at DESC LIMIT 50").bind(from).all();
      return new Response(JSON.stringify({ count: rows.results.length, digest: digestLines(rows.results) }), { headers: { "Content-Type": "application/json", ...cors } });
    }
    if (path === "/digest/send" && method === "POST") {
      const rows = await env.D1.prepare("SELECT * FROM intents WHERE status != ?1 ORDER BY created_at DESC LIMIT 50").bind("done").all();
      const text = digestLines(rows.results);
      const r = await sendDigest(env, "QNFO intent digest - " + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), text);
      return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json", ...cors } });
    }
    if (path === "/triage/run" && method === "POST") {
      try {
        const r = await runBatchTriage(env);
        return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json", ...cors } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json", ...cors } });
      }
    }
    if (path === "/triage/sync" && method === "POST") {
      const r = await syncDispatched(env);
      return new Response(JSON.stringify({ synced: r }), { headers: { "Content-Type": "application/json", ...cors } });
    }
    if (path === "/triage/candidates" && method === "GET") {
      const status = url.searchParams.get("status") || "";
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 100);
      const rows = status ? await env.D1.prepare("SELECT * FROM research_candidates WHERE status = ?1 ORDER BY score DESC LIMIT ?2").bind(status, limit).all() : await env.D1.prepare("SELECT * FROM research_candidates ORDER BY score DESC LIMIT ?1").bind(limit).all();
      return new Response(JSON.stringify({ count: rows.results.length, candidates: rows.results }), { headers: { "Content-Type": "application/json", ...cors } });
    }
    if (path === "/triage/stats" && method === "GET") {
      const rc = await env.D1.prepare("SELECT status, COUNT(*) AS n FROM research_candidates GROUP BY status").all();
      const ic = await env.D1.prepare("SELECT status, COUNT(*) AS n FROM intents WHERE type='research' GROUP BY status").all();
      return new Response(JSON.stringify({ candidates: rc.results, research_intents: ic.results, promote_threshold: PROMOTE_THRESHOLD }), { headers: { "Content-Type": "application/json", ...cors } });
    }
    if (path === "/triage/dispatch" && method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
      }
      let out;
      if (body.candidate_id) {
        const c = await env.D1.prepare("SELECT * FROM research_candidates WHERE id = ?1").bind(body.candidate_id).first();
        if (!c) return new Response(JSON.stringify({ error: "candidate not found" }), { status: 404, headers: { "Content-Type": "application/json", ...cors } });
        out = await dispatchCandidate(env, c);
      } else {
        out = await autoDispatch(env);
      }
      return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", ...cors } });
    }
    if (path === "/triage/candidate" && method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response("bad json", { status: 400, headers: cors });
      }
      const allowed = ["promoted", "dispatched", "research_completed", "research_failed", "published", "dismissed"];
      if (!body.candidate_id || !allowed.includes(body.status)) return new Response(JSON.stringify({ error: "candidate_id and valid status required", allowed }), { status: 400, headers: { "Content-Type": "application/json", ...cors } });
      const upd = await env.D1.prepare("UPDATE research_candidates SET status=?, processed_at=? WHERE id=?").bind(body.status, (/* @__PURE__ */ new Date()).toISOString(), body.candidate_id).run();
      return new Response(JSON.stringify({ ok: upd.meta.changes > 0, candidate_id: body.candidate_id, status: body.status }), { headers: { "Content-Type": "application/json", ...cors } });
    }
    return new Response("not found", { status: 404, headers: cors });
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
