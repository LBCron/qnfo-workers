// fleet-executor v0.3.0 - dynamic task execution engine + codeparse enforcement pilot (P1/P4)
// Reads fleet_tasks from qnfo-audit D1, executes by type, writes fleet_runs ledger.
// v0.3.0: every /run completion emits a kind=event envelope validated BEFORE canonical-store write
// (blocking reject on invalid, QNFO.CODEPARSE.SCOPE.v1 server_enforcement); /run responses are wrapped
// in the universal envelope (kind=message). Mini-validator mirrors schemas/envelope.json + event.json.
const VERSION = "fleet-executor/0.3.0";

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
}

function dbFor(def, env) {
  const name = (def && def.db) || "AUDIT";
  const b = env[name];
  if (!b) throw new Error("no D1 binding: " + name);
  return b;
}

async function runAI(def, env) {
  const model = ["dynamic/value", "dynamic/standard", "dynamic/premium"].includes(def.model)
    ? def.model
    : "dynamic/value";
  const resp = await env.AI.run(model, {
    messages: [{ role: "user", content: def.prompt || "ping" }],
    max_tokens: def.max_tokens || 1024
  }, { gateway: { id: "default" } });
  const text = typeof resp === "string" ? resp : (resp.response || JSON.stringify(resp));
  return { type: "ai", model: model, output: String(text).slice(0, 2000) };
}

async function runSQL(def, env) {
  const db = dbFor(def, env);
  const res = await db.prepare(def.sql).all();
  return { type: "sql", db: def.db || "AUDIT", rows: (res.results || []).length, sample: (res.results || []).slice(0, 3) };
}

async function runHTTP(def) {
  const resp = await fetch(def.url, { method: def.method || "GET", headers: def.headers || {} });
  const text = await resp.text();
  return { type: "http", status: resp.status, body: text.slice(0, 500) };
}

async function executeStep(step, env) {
  if (step.type === "ai") return runAI(step, env);
  if (step.type === "sql") return runSQL(step, env);
  if (step.type === "http") return runHTTP(step);
  throw new Error("unsupported step type: " + step.type);
}

async function executeTask(task, env) {
  let def = {};
  try { def = JSON.parse(task.definition || "{}"); } catch (e) { def = {}; }
  if (task.type === "workflow") {
    const steps = def.steps || [];
    const results = [];
    for (let i = 0; i < steps.length; i++) {
      results.push(await executeStep(steps[i], env));
    }
    return { type: "workflow", steps_run: results.length, results: results };
  }
  def.type = task.type;
  return executeStep(def, env);
}

// ---- codeparse mini-validator (deterministic, no network; D2) ----
function validateEnvelope(art) {
  const errs = [];
  if (!art || typeof art !== "object") return ["envelope: not an object"];
  if (typeof art.schema_version !== "string" || !/^1\.0$/.test(art.schema_version)) errs.push("envelope: schema_version must be '1.0'");
  if (typeof art.kind !== "string" || art.kind.length < 2 || !/^[a-z0-9-]+$/.test(art.kind)) errs.push("envelope: kind invalid");
  if (typeof art.id !== "string" || art.id.length < 2) errs.push("envelope: id invalid");
  if (typeof art.ts !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(art.ts)) errs.push("envelope: ts invalid");
  const p = art.provenance;
  if (!p || typeof p !== "object" || typeof p.emitter !== "string" || typeof p.session !== "string" || typeof p.sha256 !== "string") errs.push("envelope: provenance invalid");
  return errs;
}

function validateEventPayload(payload) {
  const errs = [];
  if (!payload || typeof payload !== "object") return ["event payload: not an object"];
  if (typeof payload.kind !== "string" || payload.kind.length < 2 || !/^[a-z0-9-]+$/.test(payload.kind)) errs.push("event payload: kind invalid");
  if (typeof payload.source !== "string" || payload.source.length < 1) errs.push("event payload: source missing");
  return errs;
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const arr = Array.from(new Uint8Array(buf));
  let hex = "";
  for (let i = 0; i < arr.length; i++) { hex += arr[i].toString(16).padStart(2, "0"); }
  return hex;
}

async function emitEvent(env, payload) {
  const nowIso = new Date().toISOString();
  const payloadStr = JSON.stringify(payload);
  const art = {
    schema_version: "1.0",
    kind: "event",
    id: "QNFO.EVT.FLEET-RUN." + Date.now(),
    ts: nowIso,
    provenance: { emitter: "fleet-executor", session: "cron-or-manual", sha256: await sha256Hex(payloadStr) },
    payload: payload
  };
  const errs = validateEnvelope(art).concat(validateEventPayload(art.payload));
  const status = errs.length === 0 ? "accepted" : "rejected";
  await env.AUDIT.prepare("INSERT INTO codeparse_events (artifact, kind, source, status, err, ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(status === "accepted" ? JSON.stringify(art) : null, "event", String(payload.source || "").slice(0, 40), status, errs.join("; ").slice(0, 300), nowIso).run();
  return { status: status, errors: errs };
}

function wrapMessage(text) {
  return {
    schema_version: "1.0",
    kind: "message",
    id: "QNFO.MSG." + Date.now(),
    ts: new Date().toISOString(),
    provenance: { emitter: "fleet-executor", session: "http", sha256: "" },
    payload: { role: "assistant", text: text, model: VERSION }
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, version: VERSION });
    if (url.pathname === "/run" && request.method === "POST") {
      let body = {};
      try { body = await request.json(); } catch (e) { return json({ ok: false, error: "bad json" }, 400); }
      const taskId = body.task_id;
      if (!taskId) return json({ ok: false, error: "missing task_id" }, 400);
      const cronName = body.cron_name || "manual";
      const task = await env.AUDIT.prepare("SELECT * FROM fleet_tasks WHERE id = ?1 AND enabled = 1").bind(taskId).first();
      if (!task) return json({ ok: false, error: "task not found or disabled" }, 404);
      const started = new Date().toISOString();
      const prior = await env.AUDIT.prepare("SELECT id FROM fleet_runs WHERE task_id = ?1 AND cron_name = ?2 ORDER BY id DESC LIMIT 1").bind(taskId, cronName).first();
      const runId = prior ? prior.id : null;
      if (runId) {
        await env.AUDIT.prepare("UPDATE fleet_runs SET status = 'running', started_at = ?1 WHERE id = ?2").bind(started, runId).run();
      }
      try {
        const result = await executeTask(task, env);
        const done = new Date().toISOString();
        const resStr = JSON.stringify(result).slice(0, 4000);
        if (runId) {
          await env.AUDIT.prepare("UPDATE fleet_runs SET status = 'ok', finished_at = ?1, result = ?2 WHERE id = ?3").bind(done, resStr, runId).run();
        } else {
          await env.AUDIT.prepare("INSERT INTO fleet_runs (task_id, cron_name, status, started_at, finished_at, result) VALUES (?1, ?2, 'ok', ?3, ?4, ?5)").bind(taskId, cronName, started, done, resStr).run();
        }
        const evt = await emitEvent(env, {
          kind: "fleet-run",
          source: "fleet-executor",
          note: "ok",
          data: { task_id: taskId, cron_name: cronName, run_id: runId, steps_run: result.steps_run || null }
        });
        return json(wrapMessage("RUN_OK " + resStr + " | codeparse_event=" + evt.status));
      } catch (err) {
        const done = new Date().toISOString();
        const msg = String(err && err.message ? err.message : err).slice(0, 1000);
        if (runId) {
          await env.AUDIT.prepare("UPDATE fleet_runs SET status = 'failed', finished_at = ?1, error = ?2 WHERE id = ?3").bind(done, msg, runId).run();
        } else {
          await env.AUDIT.prepare("INSERT INTO fleet_runs (task_id, cron_name, status, started_at, finished_at, error) VALUES (?1, ?2, 'failed', ?3, ?4, ?5)").bind(taskId, cronName, started, done, msg).run();
        }
        const evt = await emitEvent(env, {
          kind: "fleet-run",
          source: "fleet-executor",
          note: "failed",
          data: { task_id: taskId, cron_name: cronName, error: msg.slice(0, 200) }
        });
        return json(wrapMessage("RUN_FAILED " + msg + " | codeparse_event=" + evt.status), 500);
      }
    }
    return json({ ok: false, error: "not found" }, 404);
  }
};
