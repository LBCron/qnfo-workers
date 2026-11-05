// qnfo-research-supervisor v1.1.1 -- durable supervisor + v2-drain driver over the research-publication pipeline.
// v1.0.0 (2026-09-06): survey + remediate stalls + record.
// v1.1.0 (2026-09-06): added RESEARCH_EXEC service binding + drive step.
// v1.1.1 (2026-09-06): drive step = SAFE v2 publish drain ONLY (research-exec drainV2 claim is now an
//   atomic lease in research-exec v0.5.15, so concurrent drainers cannot double-publish). Research-cycle
//   /run driving is DEFERRED: research-exec run() stage selection (researching+note/draft) is not yet
//   atomically claimed, so a second driver could double-generate an in-flight item. Do NOT add a research
//   /run loop until run() gets atomic stage claims.
// Steps: survey -> remediate (stale claims / stale 'publishing') -> drive (v2 drain) -> record.

import { WorkflowEntrypoint } from "cloudflare:workers";

const VERSION = "1.1.1";

function json(data, status) {
  if (status === void 0) status = 200;
  return new Response(JSON.stringify(data), { status: status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

async function countBy(env, table, col) {
  const sql = "SELECT " + col + " AS k, COUNT(*) AS n FROM " + table + " GROUP BY " + col + " ORDER BY " + col;
  const r = await env.QNFO_AUDIT.prepare(sql).all();
  return (r.results || []).map(function (x) { return { k: x.k, n: x.n }; });
}

async function firstRows(env, sql, max) {
  const r = await env.QNFO_AUDIT.prepare(sql).all();
  return (r.results || []).slice(0, max || 20);
}

async function countWhere(env, sql) {
  const r = await env.QNFO_AUDIT.prepare(sql).first();
  return (r && r.n) || 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({
        ok: true,
        worker: "qnfo-research-supervisor",
        version: VERSION,
        bindings: { workflow: !!env.RESEARCH_SUPERVISOR, audit: !!env.QNFO_AUDIT, living: !!env.LIVING_PAPER, researchExec: !!env.RESEARCH_EXEC },
        workflowClass: "ResearchSupervisor"
      });
    }
    if (url.pathname === "/run/workflow") {
      const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
      const inst = await env.RESEARCH_SUPERVISOR.create({
        id: "run-" + stamp + "-" + Math.random().toString(36).slice(2, 8),
        params: { trigger: "http" }
      });
      return json({ ok: true, instance: inst.id, started: true });
    }
    return json({ error: "not found" }, 404);
  }
};

export class ResearchSupervisor extends WorkflowEntrypoint {
  async run(event, step) {
    const env = this.env;
    const schedule = event && event.schedule || null;
    const retry = { limit: 3, delay: "5 seconds", backoff: "exponential" };

    const survey = await step.do("survey", { retries: retry, timeout: "60 seconds" }, async function () {
      const rq = await countBy(env, "research_queue", "status");
      const vq = await countBy(env, "version_queue", "status");
      const st = await countBy(env, "social_threads", "status");
      const prl = await countBy(env, "paper_revision_log", "status");
      const staleClaims = await firstRows(env, "SELECT id, stage, claimed_at, attempt, agent_task_id FROM research_queue WHERE status='researching' AND agent_task_id IS NULL AND claimed_at < datetime('now','-60 minutes') ORDER BY claimed_at ASC", 20);
      const stalePublishing = await firstRows(env, "SELECT id, slug, updated_at FROM version_queue WHERE status='publishing' AND updated_at < datetime('now','-30 minutes') ORDER BY updated_at ASC", 20);
      let publishedTotal = 0;
      let published24h = 0;
      try {
        const p = await env.LIVING_PAPER.prepare("SELECT COUNT(*) AS n FROM papers WHERE status='published'").first();
        publishedTotal = (p && p.n) || 0;
        const p24 = await env.LIVING_PAPER.prepare("SELECT COUNT(*) AS n FROM papers WHERE status='published' AND updated_at >= datetime('now','-24 hours')").first();
        published24h = (p24 && p24.n) || 0;
      } catch (e) {}
      return { rq: rq, vq: vq, st: st, prl: prl, staleClaims: staleClaims, stalePublishing: stalePublishing, publishedTotal: publishedTotal, published24h: published24h };
    });

    const remediate = await step.do("remediate", { retries: retry, timeout: "60 seconds" }, async function () {
      const actions = [];
      const stale = (survey.staleClaims || []).slice(0, 5);
      for (let i = 0; i < stale.length; i++) {
        const it = stale[i];
        const up = await env.QNFO_AUDIT.prepare("UPDATE research_queue SET status='queued', stage=NULL, claimed_at=NULL, error='stale-claim-reset-by-supervisor' WHERE id=? AND status='researching'").bind(it.id).run();
        if (up && up.meta && up.meta.changes) actions.push({ kind: "release-rq-claim", id: it.id, stage: it.stage });
      }
      const stalePub = (survey.stalePublishing || []).slice(0, 5);
      for (let j = 0; j < stalePub.length; j++) {
        const it = stalePub[j];
        const up = await env.QNFO_AUDIT.prepare("UPDATE version_queue SET status='drafted', updated_at=datetime('now') WHERE id=? AND status='publishing'").bind(it.id).run();
        if (up && up.meta && up.meta.changes) actions.push({ kind: "release-vq-publishing", id: it.id, slug: it.slug });
      }
      return { actions: actions, acted: actions.length };
    });

    const drive = await step.do("drive", { retries: retry, timeout: "300 seconds" }, async function () {
      if (!env.RESEARCH_EXEC) return { skipped: "no-service-binding", calls: 0 };
      const haltRow = await env.QNFO_AUDIT.prepare("SELECT id FROM cloud_ops_events WHERE job='qnfo-research-exec' AND kind='halt' AND ts >= datetime('now','-60 minutes') LIMIT 1").first();
      if (haltRow) return { skipped: "research-halted", calls: 0 };
      const vq = await countWhere(env, "SELECT COUNT(*) AS n FROM version_queue WHERE status IN ('drafted','publishing')");
      const calls = [];
      if (vq > 0) {
        let res;
        try {
          res = await env.RESEARCH_EXEC.fetch("https://RESEARCH_EXEC/run/drain-v2", { method: "POST" });
        } catch (e) {
          calls.push({ kind: "drain-v2", error: String(e && e.message || e).slice(0, 200) });
          return { skipped: "", calls: calls, backlog: { version: vq } };
        }
        let body = null;
        try { body = await res.json(); } catch (e) {}
        calls.push({ kind: "drain-v2", status: res.status, drained: body && Array.isArray(body.drained) ? body.drained.length : null });
      }
      return { skipped: "", calls: calls, backlog: { version: vq } };
    });

    const record = await step.do("record", { retries: retry, timeout: "30 seconds" }, async function () {
      const text = JSON.stringify({
        rq: survey.rq, vq: survey.vq, st: survey.st, prl: survey.prl,
        staleClaims: survey.staleClaims.length, stalePublishing: survey.stalePublishing.length,
        publishedTotal: survey.publishedTotal, published24h: survey.published24h,
        actions: remediate.actions,
        drive: drive
      });
      const id = "spv-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
      await env.QNFO_AUDIT.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?,?,?,?,?,?,?)").bind(id, new Date().toISOString(), "pipeline-supervisor", String(text).slice(0, 2000), "{}", "qnfo-research-supervisor", "ok").run();
      return { logged: true };
    });

    return {
      ok: true,
      version: VERSION,
      trigger: schedule ? "cron:" + schedule.cron : "http",
      survey: {
        researchQueue: survey.rq,
        versionQueue: survey.vq,
        socialThreads: survey.st,
        revisionLog: survey.prl,
        staleClaims: survey.staleClaims.length,
        stalePublishing: survey.stalePublishing.length,
        publishedTotal: survey.publishedTotal,
        published24h: survey.published24h
      },
      remediate: remediate,
      drive: drive
    };
  }
}
