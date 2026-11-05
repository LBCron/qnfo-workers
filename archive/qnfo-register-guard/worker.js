// qnfo-register-guard v1.0.0
// Purpose: close the task_dod_register honesty loop.
//   - Relabel phantom "scheduled-runner"/"fleet" rows whose evidence_pointer cites
//     NEITHER an executor (executor=/worker=) NOR a run trigger (job=/cron=/schedule=/task=)
//     -> owner='agent', so the ledger stops claiming a scheduled executor that does not exist.
//   - Surface the overdue-open count via cloud_ops_events (read by the daily brief).
// This is a RECONCILE/HONESTY guard, NOT a generic executor: heterogeneous open-ended rows
// (e.g. "Design COMMAND-REGISTRY") are correctly executed by the interactive agent, surfaced
// here. It mirrors the no_executor predicate already used by qnfo-cloud-ops overdue-guard.
// Canonical source: QNFO/qnfo-workers/qnfo-register-guard
// Deploy method: wrangler deploy (from qnfo-workers/qnfo-register-guard)

const VERSION = "1.0.0";
const WORKER = "qnfo-register-guard";
const EXEC_CITE = /\b(?:executor|worker)\s*=/i;
const RUN_CITE = /\b(?:job|cron|schedule|task)\s*=/i;

function ts() {
  return new Date().toISOString();
}

async function recordEvent(env, kind, text, meta) {
  try {
    await env.AUDIT.prepare(
      "INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1,?2,?3,?4,?5,?6,?7)"
    ).bind(
      kind.slice(0, 2) + "-" + WORKER + "-" + Date.now().toString(36),
      ts(), kind, String(text).slice(0, 800), JSON.stringify(meta || {}).slice(0, 800), WORKER, "ok"
    ).run();
  } catch (e) {}
}

async function run(env) {
  let relabeled = 0;
  const relabeledIds = [];
  try {
    const rows = await env.AUDIT.prepare(
      "SELECT id, owner, COALESCE(evidence_pointer,'') AS ev FROM task_dod_register WHERE status='open' AND owner IN ('scheduled-runner','fleet')"
    ).all();
    for (const r of (rows.results || [])) {
      const ev = String(r.ev || "");
      if (!(EXEC_CITE.test(ev) && RUN_CITE.test(ev))) {
        await env.AUDIT.prepare(
          "UPDATE task_dod_register SET owner='agent', evidence_pointer=COALESCE(evidence_pointer,'') || ?1, updated_at=datetime('now') WHERE id=?2 AND status='open'"
        ).bind(" [relabeled agent " + ts().slice(0, 10) + ": no executor+run citation]", r.id).run();
        relabeled++;
        relabeledIds.push(r.id);
      }
    }
  } catch (e) {}
  let overdue = 0;
  try {
    const o = await env.AUDIT.prepare(
      "SELECT COUNT(*) AS n FROM task_dod_register WHERE status='open' AND due IS NOT NULL AND due != '' AND due < ?1"
    ).bind(new Date().toISOString().slice(0, 10)).first();
    overdue = o ? Number(o.n || 0) : 0;
  } catch (e) {}
  const summary = { relabeled, relabeledIds, overdue };
  await recordEvent(env, "register-guard", "relabeled=" + relabeled + " overdue=" + overdue, summary);
  return { status: "ok", ...summary };
}

export default {
  async scheduled(event, env, ctx) {
    try {
      const o = await run(env);
      console.log(WORKER, JSON.stringify(o));
    } catch (e) {
      console.error(WORKER, String(e && e.message || e));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: WORKER, version: VERSION }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/run" && request.method === "POST") {
      const o = await run(env);
      return new Response(JSON.stringify({ ok: true, worker: WORKER, version: VERSION, out: o }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
};
