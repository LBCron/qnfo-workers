// fleet-scheduler v0.1.0 - dynamic cron dispatcher
// Per-minute tick reads fleet_crons from qnfo-audit D1, dispatches due jobs to fleet-executor.
const VERSION = "fleet-scheduler/0.1.0";

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
}

function matchField(field, val) {
  const parts = String(field).split(",");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p === "*") return true;
    if (p.indexOf("*/") === 0) {
      const n = Number(p.slice(2));
      if (n > 0 && val % n === 0) return true;
      continue;
    }
    if (p.indexOf("-") > 0) {
      const ab = p.split("-");
      if (val >= Number(ab[0]) && val <= Number(ab[1])) return true;
      continue;
    }
    if (Number(p) === val) return true;
  }
  return false;
}

function nextFire(expr, from) {
  const fields = String(expr).trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const cur = new Date(from.getTime());
  cur.setSeconds(0, 0);
  cur.setMinutes(cur.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const m = cur.getUTCMinutes();
    const h = cur.getUTCHours();
    const d = cur.getUTCDate();
    const mo = cur.getUTCMonth() + 1;
    const dw = cur.getUTCDay();
    if (matchField(fields[0], m) && matchField(fields[1], h) && matchField(fields[2], d) && matchField(fields[3], mo) && matchField(fields[4], dw)) return cur;
    cur.setMinutes(cur.getMinutes() + 1);
  }
  return null;
}

async function runTick(env) {
  const now = new Date();
  const nowIso = now.toISOString();
  const due = await env.AUDIT.prepare("SELECT * FROM fleet_crons WHERE enabled = 1 AND (next_fire IS NULL OR next_fire <= ?1)").bind(nowIso).all();
  const fired = [];
  for (let i = 0; i < due.results.length; i++) {
    const row = due.results[i];
    const next = nextFire(row.cron_expr, now);
    const nextIso = next ? next.toISOString() : null;
    await env.AUDIT.prepare("INSERT INTO fleet_runs (task_id, cron_name, status, started_at) VALUES (?1, ?2, 'queued', ?3)").bind(row.task_id, row.name, nowIso).run();
    try {
      const resp = await env.EXECUTOR.fetch("https://fleet-executor/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task_id: row.task_id, cron_name: row.name })
      });
      fired.push({ name: row.name, task: row.task_id, dispatched: resp.status });
    } catch (err) {
      fired.push({ name: row.name, task: row.task_id, dispatch_error: String(err && err.message ? err.message : err).slice(0, 200) });
    }
    await env.AUDIT.prepare("UPDATE fleet_crons SET last_fired = ?1, next_fire = ?2, updated_at = ?1 WHERE name = ?3").bind(nowIso, nextIso, row.name).run();
  }
  return fired;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async function () {
      try { await runTick(env); } catch (e) {}
    })());
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, version: VERSION });
    if (url.pathname === "/tick" && request.method === "POST") {
      const fired = await runTick(env);
      return json({ ok: true, fired: fired });
    }
    return json({ ok: false, error: "not found" }, 404);
  }
};
