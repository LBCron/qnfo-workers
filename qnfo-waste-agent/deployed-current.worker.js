
var VERSION = "1.0.1";
// spof-review: AUDIT is the existing telemetry store; a failed sweep logs its
// failure and the next hourly run retries. Authenticated /run is the alternate.
import { timingSafeEqual } from "node:crypto";
function validRunKey(value, expected) {
  if (!value || !expected) return false;
  const a = new TextEncoder().encode(value), b = new TextEncoder().encode(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
const NEURON_USD = 0.011 / 1000;
const MAX_NEW_ISSUES = 5;
const CLEAN_RUNS_TO_CLOSE = 3;
const iso = () => new Date().toISOString();
async function ensure(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS waste_ledger (day TEXT, worker TEXT, purpose TEXT, calls INTEGER, errors INTEGER, out_tok INTEGER, neurons REAL, wasted_neurons REAL, PRIMARY KEY (day, worker, purpose))"),
    db.prepare("CREATE TABLE IF NOT EXISTS waste_findings (key TEXT PRIMARY KEY, rule TEXT, worker TEXT, purpose TEXT, first_seen TEXT, last_seen TEXT, clean_runs INTEGER DEFAULT 0, metric REAL, usd REAL, evidence TEXT, issue_id INTEGER, status TEXT DEFAULT 'open')"),
    db.prepare("CREATE TABLE IF NOT EXISTS waste_runs (ts TEXT PRIMARY KEY, wasted_usd_7d REAL, spend_usd_7d REAL, published_7d INTEGER, usd_per_published REAL, findings_open INTEGER, issues_filed INTEGER, issues_closed INTEGER, error TEXT)"),
  ]);
}
async function all(db, sql, p) { return (await db.prepare(sql).bind(...(p || [])).all()).results; }
async function first(db, sql, p) { return await db.prepare(sql).bind(...(p || [])).first(); }
function codeTask(worker, probe) {
  return "\ncode-task: repo=qnfo-workers path=" + worker + "/worker.js\ncode-anchor: export default\ncode-probe: " + probe;
}
async function findings(db) {
  const out = [];
  const rows = await all(db, "SELECT worker, purpose, SUM(calls) AS calls, SUM(errors) AS errors, SUM(out_tok) AS out_tok, SUM(neurons) AS neurons, SUM(wasted_neurons) AS wasted FROM waste_ledger WHERE day >= date('now','-7 day') GROUP BY worker, purpose");
  for (const r of rows) {
    const calls = Number(r.calls), errors = Number(r.errors), wasted = Number(r.wasted || 0), neurons = Number(r.neurons || 0);
    const where = r.worker + " / " + r.purpose;
    if (wasted >= 20000) out.push({ key: "W-ERR|" + r.worker + "|" + r.purpose, rule: "W-ERR", worker: r.worker, purpose: r.purpose, metric: wasted, usd: wasted * NEURON_USD,
      title: "WASTE W-ERR: " + where + " spent " + Math.round(wasted) + " neurons on errored calls in 7 days",
      body: calls + " calls, " + errors + " errors, " + Math.round(neurons) + " neurons total, " + Math.round(wasted) + " neurons (about $" + (wasted * NEURON_USD).toFixed(2) + ") billed on calls that returned an error and were retried or dropped. Cut it by fixing the cause of the error or by not paying for the failing leg first (cheapest verified-success path), without lowering any quality gate." + codeTask(r.worker, "waste_ledger wasted_neurons for " + where + " over 7 days is below 20000") });
    if (calls >= 100 && errors / calls >= 0.10) out.push({ key: "W-RATE|" + r.worker + "|" + r.purpose, rule: "W-RATE", worker: r.worker, purpose: r.purpose, metric: errors / calls, usd: wasted * NEURON_USD,
      title: "WASTE W-RATE: " + where + " error rate " + (100 * errors / calls).toFixed(1) + "% over " + calls + " calls",
      body: errors + " of " + calls + " calls errored in 7 days. Find the error class in cloud_ops_events and ai_gateway_failures and fix it at the source." + codeTask(r.worker, "error rate for " + where + " below 10 percent over 7 days with 100+ calls") });
    if (calls >= 100 && !Number(r.out_tok) && !neurons) out.push({ key: "W-META|" + r.worker + "|" + r.purpose, rule: "W-META", worker: r.worker, purpose: r.purpose, metric: calls, usd: 0,
      title: "WASTE W-META: " + where + " made " + calls + " AI calls with no tokens or neurons recorded",
      body: "The call counter records calls but zero output tokens and zero neurons, so cost and output cannot be attributed. Record out_tok and neurons in ai_call_counters for this purpose." + codeTask(r.worker, "ai_call_counters shows out_tok above 0 or neurons above 0 for " + where) });
  }
  const bl = await first(db, "SELECT COUNT(*) AS n FROM research_queue WHERE status = 'deferred' AND stage = 'ground' AND created_at < datetime('now','-7 day')");
  if (Number(bl.n) >= 500) out.push({ key: "W-BACKLOG|qnfo-research-exec|ground", rule: "W-BACKLOG", worker: "qnfo-research-exec", purpose: "ground", metric: Number(bl.n), usd: 0,
    title: "WASTE W-BACKLOG: " + bl.n + " research rows deferred at ground for over 7 days",
    body: "Rows wait at ground while later stages are nearly empty. Throughput, not demand, is the limit: find what holds the release (RESEARCH-BACKPRESSURE-1, research_ready_cap, tick allowance, D1 overload) and release rows in priority order." + codeTask("qnfo-research-exec", "deferred ground rows older than 7 days below 500") });
  const st = await first(db, "SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'research-stalled' AND ts >= datetime('now','-1 day')");
  if (Number(st.n) >= 100) out.push({ key: "W-STALL|qnfo-research-exec|tick", rule: "W-STALL", worker: "qnfo-research-exec", purpose: "tick", metric: Number(st.n), usd: 0,
    title: "WASTE W-STALL: research stage stalled " + st.n + " times in 24 hours with queued work and no budget hold",
    body: "research-stalled events say queued work exists and the budget is not holding. Find the real limiter and remove it." + codeTask("qnfo-research-exec", "research-stalled events in 24 hours below 100") });
  const cur = await first(db, "SELECT (SELECT SUM(usd) FROM ai_spend_ledger WHERE day >= date('now','-7 day')) AS usd, (SELECT COUNT(*) FROM research_queue WHERE status = 'published' AND published_at >= date('now','-7 day')) AS pub");
  const prev = await first(db, "SELECT (SELECT SUM(usd) FROM ai_spend_ledger WHERE day >= date('now','-14 day') AND day < date('now','-7 day')) AS usd, (SELECT COUNT(*) FROM research_queue WHERE status = 'published' AND published_at >= date('now','-14 day') AND published_at < date('now','-7 day')) AS pub");
  const cpp = Number(cur.pub) ? Number(cur.usd) / Number(cur.pub) : null, ppp = Number(prev.pub) ? Number(prev.usd) / Number(prev.pub) : null;
  if (cpp != null && ppp != null && cpp > ppp * 1.25) out.push({ key: "W-YIELD|fleet|research", rule: "W-YIELD", worker: "qnfo-research-exec", purpose: "yield", metric: cpp, usd: 0,
    title: "WASTE W-YIELD: spend per published paper rose to $" + cpp.toFixed(2) + " from $" + ppp.toFixed(2),
    body: "Last 7 days: $" + Number(cur.usd).toFixed(2) + " for " + cur.pub + " papers. Previous 7 days: $" + Number(prev.usd || 0).toFixed(2) + " for " + prev.pub + " papers. Find the stage whose cost grew without more publications." + codeTask("qnfo-research-exec", "ai_spend_ledger usd per published paper within 25 percent of the prior 7 days") });
  return { out, cur, cpp };
}
async function run(env) {
  const db = env.AUDIT, now = iso();
  let filed = 0, closed = 0, err = null, f = { out: [], cur: { usd: 0, pub: 0 }, cpp: null };
  try {
    await ensure(db);
    await db.prepare("INSERT OR REPLACE INTO waste_ledger SELECT day, worker, purpose, SUM(calls), SUM(errors), SUM(out_tok), SUM(neurons), SUM(CASE WHEN calls > 0 THEN errors * 1.0 * neurons / calls ELSE 0 END) FROM ai_call_counters WHERE day >= date('now','-8 day') GROUP BY day, worker, purpose").run();
    f = await findings(db);
    const hit = new Set(f.out.map((x) => x.key));
    for (const x of f.out) {
      const ex = await first(db, "SELECT key, issue_id, status FROM waste_findings WHERE key = ?1", [x.key]);
      if (!ex) {
        let issueId = null;
        if (filed < MAX_NEW_ISSUES) {
          const ins = await db.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status, linked_session, created_at, updated_at, predicate_id) VALUES (?1, ?2, 'session', 'reliability', ?3, 'open', 'waste-agent', ?4, ?4, ?5)").bind(x.title, x.body + "\nOpened by qnfo-waste-agent (finding " + x.key + "). Closes itself after " + CLEAN_RUNS_TO_CLOSE + " clean hourly runs.", x.usd >= 2 || x.rule === "W-BACKLOG" || x.rule === "W-STALL" ? "high" : "medium", Date.now(), x.key).run();
          issueId = ins.meta.last_row_id; filed++;
        }
        await db.prepare("INSERT INTO waste_findings (key, rule, worker, purpose, first_seen, last_seen, clean_runs, metric, usd, evidence, issue_id, status) VALUES (?1, ?2, ?3, ?4, ?5, ?5, 0, ?6, ?7, ?8, ?9, 'open')").bind(x.key, x.rule, x.worker, x.purpose, now, x.metric, x.usd, x.title, issueId).run();
      } else {
        await db.prepare("UPDATE waste_findings SET last_seen = ?1, clean_runs = 0, metric = ?2, usd = ?3, evidence = ?4, status = 'open' WHERE key = ?5").bind(now, x.metric, x.usd, x.title, x.key).run();
        if (ex.status === 'closed' && ex.issue_id) await db.prepare("UPDATE agent_issues SET status = 'open', close_channel = NULL, updated_at = ?1 WHERE id = ?2").bind(Date.now(), ex.issue_id).run();
      }
    }
    const open = await all(db, "SELECT key, issue_id, clean_runs FROM waste_findings WHERE status = 'open'");
    for (const o of open) {
      if (hit.has(o.key)) continue;
      const c = Number(o.clean_runs) + 1;
      if (c >= CLEAN_RUNS_TO_CLOSE) {
        await db.prepare("UPDATE waste_findings SET status = 'closed', clean_runs = ?1 WHERE key = ?2").bind(c, o.key).run();
        if (o.issue_id) await db.prepare("UPDATE agent_issues SET status = 'closed', close_channel = 'auto:waste-agent', updated_at = ?1 WHERE id = ?2 AND status = 'open'").bind(Date.now(), o.issue_id).run();
        closed++;
      } else await db.prepare("UPDATE waste_findings SET clean_runs = ?1 WHERE key = ?2").bind(c, o.key).run();
    }
  } catch (e) { err = String(e && e.message || e).slice(0, 300); }
  try {
    const w = await first(db, "SELECT ROUND(SUM(wasted_neurons) * " + NEURON_USD + ", 2) AS usd FROM waste_ledger WHERE day >= date('now','-7 day')");
    const o = await first(db, "SELECT COUNT(*) AS n FROM waste_findings WHERE status = 'open'");
    await db.prepare("INSERT OR REPLACE INTO waste_runs (ts, wasted_usd_7d, spend_usd_7d, published_7d, usd_per_published, findings_open, issues_filed, issues_closed, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)").bind(now, Number(w && w.usd || 0), Number(f.cur.usd || 0), Number(f.cur.pub || 0), f.cpp, Number(o && o.n || 0), filed, closed, err).run();
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-waste-agent", event: "waste-run-ledger-failed", error: String(e && e.message || e).slice(0, 300) })); }
  return { filed, closed, err };
}
export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === "/health") return Response.json({ ok: true, worker: "qnfo-waste-agent", version: VERSION });
    if (u.pathname === "/run" && request.method === "POST" && validRunKey(request.headers.get("x-run-key"), env.RUN_KEY)) return new Response(JSON.stringify(await run(env)), { headers: { "content-type": "application/json" } });
    return new Response("not found", { status: 404 });
  },
};
