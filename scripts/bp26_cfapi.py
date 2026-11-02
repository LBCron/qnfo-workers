#!/usr/bin/env python3
"""BP26-CFAPI-1 collectors (2026-10-26, charter pillars core, cost, autonomy; agent_issues 1000351 AI Gateway budgets, 1000352 gradual deploys, 1000353 durable jobs,
1000354 observability, 1000358 agent change gates).

The runner half of nine BP26 metrics whose input is the Cloudflare API, the GitHub API or the fleet's own ledgers. Run by scripts/bp26_producers.py from the remediation-consumer job.
Every value is measured; a collector that cannot measure returns None and writes nothing (unknown is never a value). Nothing is written to Cloudflare or GitHub: reads only.

  collect_deploys       deploys_via_gradual, change_failure_rate, mttr_rollback_min_p95
        The Workers Deployments API lists only the latest 10 deployments of a script, so each run stores the ones it sees in qnfo-audit.bp26_deploy_events (INSERT of new ids only) and
        the 30-day figures are computed from that table: the window GROWS from the first run, and the note says how many deployments and how many days it holds. A deployment is gradual
        when it splits traffic over more than one version or serves a version below 100 percent. A deployment FAILED when the next deployment of the same worker, within 24 h, is a
        rollback: annotated workers/triggered_by = rollback by Cloudflare, or a re-activation of a version that was live before the failed one. A canary revert of the control plane
        (an agent_issues row CONTROL-PLANE-REVERTED-1 naming the worker, created inside that worker's recorded window) counts as one failed deployment too. mttr_rollback_min_p95 is
        the p95 of minutes from the failed deployment to its rollback deployment: detection time is recorded nowhere, so this is an upper bound; with fewer than 5 rollbacks it is None.
  collect_ai_gateway    gateway_coverage, ai_cache_hit_rate
        Cloudflare GraphQL over 7 days. ai_cache_hit_rate = cached / all AI Gateway requests (the gateway log has no flag for a deterministic route, so the all-routes rate understates the
        rate on deterministic routes). gateway_coverage = gateway requests / (gateway requests + Workers AI inferences that bypassed the gateway), the second term being Workers AI
        inferences minus the non-cached Workers AI requests the gateway logged. A provider called directly from a Worker (not Workers AI) leaves no trace in Cloudflare: the figure is an
        upper bound and the note says so.
  collect_queues        dlq_depth
        Cloudflare Queues API: every dead-letter queue named by a consumer, its backlog and oldest message. The value is the backlog of DLQs whose oldest message is older than 120 minutes
        (an upper bound: the API cannot split the backlog by age). A queue consumer WITHOUT a dead-letter queue discards its failures: it is listed in the rows and the note, never hidden.
  collect_side_effects  duplicate_side_effects
        qnfo-audit ledgers, last 7 days: social_media_posts (the same platform id, buffer id or url recorded twice), social_threads (the same post_uri twice, identical thread text
        posted twice within 24 h) and emails status sent (same recipient, subject and body twice within 24 h). social_media_posts.content_preview is a label, not the text, so identical-text
        posts that did not share a platform id cannot be detected there, and the note says so.
  collect_log_ingest    log_ingest_gb_month
        No Cloudflare API reports the bytes Workers Logs ingested: the run asks the two candidate endpoints and records their answers; the value stays None until one answers.
  collect_ci_gate       ci_gate_bypass_count
        Merged pull requests of the last 30 days whose required checks (scripts/github-main-ruleset.json: gate, guard, mirror-guard, identity-guard) were not all green on the head commit,
        read from GitHub REST with a call budget per run (the consume job sends no token: 60 requests an hour, shared with the other collectors, so one batch of 16 merges every 50 minutes) and kept in qnfo-audit.ci_gate_audit, so the audited set grows run by run.
        The value is the count among audited merges; it is None while the count is 0 and fewer than 98 percent of the window's merges are audited (a lower bound of 0 is not a measurement).
        The main-gate ruleset with those required checks is declared but NOT applied (GitHub enforces only main-safety: no deletion, no force push), and the stale-PR lane merges without
        the gate job by design: both are counted as the data shows them.

Usage:
  python3 scripts/bp26_cfapi.py --selftest     offline suite (no network, no secrets)
  CF_ACCOUNT_ID=<id> python3 scripts/bp26_producers.py --dry --only collect_deploys     live read-only run through the framework
"""
import calendar
import datetime
import json
import math
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bp26_producers import Collector, Result  # noqa: E402

REPO = "QNFO/qnfo-workers"
CF_ACCOUNT_ENV = ("CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
WINDOW_DAYS = 30
FAIL_WITHIN_H = 24
MTTR_MIN_EVENTS = 5
DLQ_HELD_MIN = 120
GH_CALLS_PER_RUN = 24
CI_AUDIT_PER_RUN = 16
CI_THROTTLE_MIN = 50
CI_COVERAGE_MIN = 0.98
GOOD_CONCLUSIONS = ("success", "neutral", "skipped")
_POST = None  # the offline suite replaces this; live it is remediation_consumer._req


def _acc():
    return next((os.environ[k] for k in CF_ACCOUNT_ENV if os.environ.get(k)), "")


def _post(ctx, path, body):
    fn = getattr(ctx, "cf_post", None) or _POST
    if fn is None:
        import remediation_consumer as RC  # noqa: E402
        return RC._req("POST", RC.CF_API + path, body)
    return fn(path, body)


def _epoch(iso):
    return calendar.timegm(time.strptime(str(iso)[:19], "%Y-%m-%dT%H:%M:%S"))


def _iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- deployments
def normalise_deployment(worker, d):
    vs = d.get("versions") or []
    pcts = [float(v.get("percentage")) for v in vs if v.get("percentage") is not None]
    ann = d.get("annotations") or {}
    return {"id": str(d.get("id")), "worker": worker, "created_on": str(d.get("created_on") or ""), "strategy": str(d.get("strategy") or ""), "n_versions": len(vs),
            "min_pct": min(pcts) if pcts else None, "triggered_by": str(ann.get("workers/triggered_by") or ""), "message": str(ann.get("workers/message") or "")[:120],
            "version_ids": tuple(sorted(str(v.get("version_id")) for v in vs if v.get("version_id")))}


def is_gradual(e):
    return e["n_versions"] > 1 or (e["min_pct"] is not None and e["min_pct"] < 100)


def analyse_deploys(events, canary_incidents=()):
    """events: normalised deployments of the window. canary_incidents: [(worker, epoch seconds)] from CONTROL-PLANE-REVERTED-1 issues.
    Returns total, gradual, failed deployments, rollback events [(worker, failed id, rollback id, minutes, how)] and the per-worker window start."""
    by = {}
    for e in events:
        by.setdefault(e["worker"], []).append(e)
    start, rollbacks, failed = {}, [], set()
    for w, lst in by.items():
        lst.sort(key=lambda e: e["created_on"])
        start[w] = _epoch(lst[0]["created_on"])
        for i in range(1, len(lst)):
            cur, prev = lst[i], lst[i - 1]
            how = None
            if cur["triggered_by"] == "rollback":
                how = "annotated rollback"
            elif cur["version_ids"] and cur["version_ids"] != prev["version_ids"] and any(x["version_ids"] == cur["version_ids"] for x in lst[:i - 1]):
                how = "re-activation of an earlier version"
            if not how:
                continue
            mins = (_epoch(cur["created_on"]) - _epoch(prev["created_on"])) / 60.0
            if mins <= FAIL_WITHIN_H * 60:
                failed.add(prev["id"])
                rollbacks.append((w, prev["id"], cur["id"], round(mins, 1), how))
    canary = []
    for w, t in canary_incidents:
        if w in start and t >= start[w]:
            canary.append((w, t))
    return {"total": len(events), "gradual": sum(1 for e in events if is_gradual(e)), "failed_by_rollback": len(failed), "canary": canary, "rollbacks": rollbacks, "start": start,
            "workers": len(by)}


def p95(values):
    v = sorted(values)
    if not v:
        return None
    return v[min(len(v) - 1, max(0, int(-(-0.95 * len(v) // 1)) - 1))]


def fetch_deployments(ctx, acc, rows):
    """Live: every script's latest deployments (bounded by the time budget). Returns (events, scripts seen, error | None)."""
    r = ctx.cf("/accounts/%s/workers/scripts" % acc)
    scripts = [s.get("id") for s in (r.get("result") or []) if s.get("id")]
    events, n_ok = [], 0
    for name in scripts:
        if ctx.left() < 25:
            rows.append(("_budget", None, "time budget reached after %d of %d scripts" % (n_ok, len(scripts))))
            break
        try:
            d = ctx.cf("/accounts/%s/workers/scripts/%s/deployments" % (acc, urllib.parse.quote(name)))
        except Exception as e:  # noqa: BLE001
            rows.append((name, None, "deployments unreadable: %s" % str(e)[:100]))
            continue
        n_ok += 1
        for x in ((d.get("result") or {}).get("deployments") or []):
            events.append(normalise_deployment(name, x))
    return events, n_ok, len(scripts)


def collect_deploys(ctx):
    acc = _acc()
    if not acc:
        return [Result(m, None, "no Cloudflare account id in this environment", []) for m in ("deploys_via_gradual", "change_failure_rate", "mttr_rollback_min_p95")]
    rows = []
    try:
        fetched, n_ok, n_scripts = fetch_deployments(ctx, acc, rows)
    except Exception as e:  # noqa: BLE001
        return [Result(m, None, "Workers API unreadable: %s" % str(e)[:160], []) for m in ("deploys_via_gradual", "change_failure_rate", "mttr_rollback_min_p95")]
    cutoff = _iso(ctx.now - WINDOW_DAYS * 86400)
    stored = {}
    try:
        for r in ctx.d1("SELECT deployment_id, worker, created_on, strategy, n_versions, min_pct, triggered_by, message, version_ids FROM bp26_deploy_events WHERE created_on >= ?1", [cutoff]):
            stored[r["deployment_id"]] = {"id": r["deployment_id"], "worker": r["worker"], "created_on": r["created_on"], "strategy": r["strategy"] or "", "n_versions": int(r["n_versions"] or 0),
                                          "min_pct": r["min_pct"], "triggered_by": r["triggered_by"] or "", "message": r["message"] or "",
                                          "version_ids": tuple(x for x in (r["version_ids"] or "").split(",") if x)}
    except Exception as e:  # noqa: BLE001
        rows.append(("bp26_deploy_events", None, "table unreadable (migration not applied?): %s" % str(e)[:100]))
    new = [e for e in fetched if e["id"] not in stored and e["created_on"] >= cutoff]
    if new and not ctx.dry:
        stamp = _iso(ctx.now)
        for i in range(0, len(new), 9):
            chunk = new[i:i + 9]
            params = []
            for e in chunk:
                params += [e["id"], e["worker"], e["created_on"], e["strategy"], e["n_versions"], e["min_pct"], e["triggered_by"], e["message"], ",".join(e["version_ids"]), stamp]
            try:
                ctx.d1("INSERT OR IGNORE INTO bp26_deploy_events (deployment_id, worker, created_on, strategy, n_versions, min_pct, triggered_by, message, version_ids, seen_at) VALUES "
                       + ", ".join(["(?,?,?,?,?,?,?,?,?,?)"] * len(chunk)), params)
            except Exception as e:  # noqa: BLE001
                rows.append(("bp26_deploy_events", None, "insert failed: %s" % str(e)[:100]))
                break
    if not ctx.dry:
        try:
            ctx.d1("DELETE FROM bp26_deploy_events WHERE created_on < ?1", [_iso(ctx.now - 40 * 86400)])
        except Exception:  # noqa: BLE001
            pass
    merged = dict(stored)
    for e in fetched:
        if e["created_on"] >= cutoff:
            merged[e["id"]] = e
    events = list(merged.values())
    if not events:
        return [Result(m, None, "no deployment recorded in the window", rows) for m in ("deploys_via_gradual", "change_failure_rate", "mttr_rollback_min_p95")]
    incidents = []
    try:
        for r in ctx.d1("SELECT title, created_at FROM agent_issues WHERE title LIKE 'CONTROL-PLANE-REVERTED-1%' AND created_at >= ?1", [int((ctx.now - WINDOW_DAYS * 86400) * 1000)]):
            m = re.search(r"reverted,\s+([a-z0-9][a-z0-9_-]*)", str(r["title"]))
            if m:
                incidents.append((m.group(1), int(r["created_at"]) // 1000))
    except Exception as e:  # noqa: BLE001
        rows.append(("canary-reverts", None, "agent_issues unreadable: %s" % str(e)[:100]))
    a = analyse_deploys(events, incidents)
    ages = sorted(round((ctx.now - t) / 86400.0, 1) for t in a["start"].values())
    median = ages[len(ages) // 2]
    scope = ("%d deployments of %d workers; per-worker history recorded covers %.1f to %.1f days (median %.1f; the API keeps only the latest 10 per script, so busy workers start later and the "
             "window grows run by run); %d of %d scripts read" % (a["total"], a["workers"], ages[0], ages[-1], median, n_ok, n_scripts))
    rows.append(("_scope", 1, scope))
    rows.append(("gradual", 1 if a["gradual"] else 0, "%d of %d deployments split traffic over versions or serve below 100 percent" % (a["gradual"], a["total"])))
    for w, fid, rid, mins, how in a["rollbacks"][:20]:
        rows.append((w, 0, "deployment %s followed by a rollback %s after %.1f min (%s)" % (fid[:8], rid[:8], mins, how)))
    for w, t in a["canary"][:10]:
        rows.append((w, 0, "canary revert of the control plane at %s" % _iso(t)))
    failures = a["failed_by_rollback"] + len(a["canary"])
    out = [Result("deploys_via_gradual", a["gradual"] / float(a["total"]), "%d of %d recorded deployments were staged rollouts. %s" % (a["gradual"], a["total"], scope), rows)]
    out.append(Result("change_failure_rate", failures / float(a["total"]),
                      "%d deployments followed within %d h by a rollback (%d annotated or re-activated versions) or a canary revert (%d) / %d recorded deployments. %s. Overlap between the two sources is possible, so this is an upper bound"
                      % (failures, FAIL_WITHIN_H, a["failed_by_rollback"], len(a["canary"]), a["total"], scope), []))
    mins = [r[3] for r in a["rollbacks"]]
    if len(mins) < MTTR_MIN_EVENTS:
        out.append(Result("mttr_rollback_min_p95", None, "%d rollback events recorded (a p95 needs %d); minutes are failed-deployment-to-rollback, not detection-to-rollback. %s" % (len(mins), MTTR_MIN_EVENTS, scope), []))
    else:
        out.append(Result("mttr_rollback_min_p95", p95(mins), "p95 of %d minutes from a failed deployment to its rollback deployment (detection time is not recorded: upper bound). %s" % (len(mins), scope), []))
    return out


# ---------------------------------------------------------------- AI Gateway
def gql_query(kind, acc, since, until):
    if kind == "gateway":
        return ('query { viewer { accounts(filter: { accountTag: "%s" }) { aiGatewayRequestsAdaptiveGroups(limit: 5000, filter: { datetime_geq: "%s", datetime_leq: "%s" }) '
                '{ count dimensions { provider gateway cached } } } } }' % (acc, since, until))
    return ('query { viewer { accounts(filter: { accountTag: "%s" }) { aiInferenceAdaptiveGroups(limit: 2000, filter: { datetime_geq: "%s", datetime_leq: "%s" }) '
            '{ count dimensions { modelId } } } } }' % (acc, since, until))


def _groups(resp, name):
    if not isinstance(resp, dict) or resp.get("errors") or not resp.get("data"):
        raise RuntimeError("GraphQL: %s" % json.dumps((resp or {}).get("errors") if isinstance(resp, dict) else resp)[:200])
    accs = ((resp.get("data") or {}).get("viewer") or {}).get("accounts") or [{}]
    return accs[0].get(name) or []


def gateway_figures(gateway_rows, inference_rows):
    total = sum(int(r.get("count") or 0) for r in gateway_rows)
    cached = sum(int(r.get("count") or 0) for r in gateway_rows if (r.get("dimensions") or {}).get("cached") in (1, True, "1"))
    wai = sum(int(r.get("count") or 0) for r in gateway_rows if (r.get("dimensions") or {}).get("provider") == "workers-ai")
    wai_cached = sum(int(r.get("count") or 0) for r in gateway_rows if (r.get("dimensions") or {}).get("provider") == "workers-ai" and (r.get("dimensions") or {}).get("cached") in (1, True, "1"))
    infer = sum(int(r.get("count") or 0) for r in inference_rows)
    direct = max(0, infer - (wai - wai_cached))
    by_provider = {}
    for r in gateway_rows:
        p = (r.get("dimensions") or {}).get("provider") or "?"
        by_provider[p] = by_provider.get(p, 0) + int(r.get("count") or 0)
    return {"total": total, "cached": cached, "wai": wai, "wai_cached": wai_cached, "infer": infer, "direct": direct, "by_provider": by_provider}


def collect_ai_gateway(ctx):
    acc = _acc()
    if not acc:
        return [Result(m, None, "no Cloudflare account id in this environment", []) for m in ("gateway_coverage", "ai_cache_hit_rate")]
    until, since = _iso(ctx.now), _iso(ctx.now - 7 * 86400)
    try:
        g = _groups(_post(ctx, "/graphql", {"query": gql_query("gateway", acc, since, until)}), "aiGatewayRequestsAdaptiveGroups")
        i = _groups(_post(ctx, "/graphql", {"query": gql_query("inference", acc, since, until)}), "aiInferenceAdaptiveGroups")
    except Exception as e:  # noqa: BLE001
        return [Result(m, None, "Cloudflare GraphQL unreadable: %s" % str(e)[:200], []) for m in ("gateway_coverage", "ai_cache_hit_rate")]
    f = gateway_figures(g, i)
    rows = [(p, 1, "%d gateway requests in 7 days" % n) for p, n in sorted(f["by_provider"].items(), key=lambda kv: -kv[1])]
    rows.append(("workers-ai-inferences", None, "%d Workers AI inferences in 7 days, %d of them not through the gateway" % (f["infer"], f["direct"])))
    out = []
    if f["total"] > 0:
        out.append(Result("ai_cache_hit_rate", f["cached"] / float(f["total"]), "%d cached / %d AI Gateway requests in the last 7 days (all routes: the log has no deterministic-route flag, so this understates the rate on deterministic routes)" % (f["cached"], f["total"]), rows))
    else:
        out.append(Result("ai_cache_hit_rate", None, "the AI Gateway logged no request in 7 days", rows))
    denom = f["total"] + f["direct"]
    if denom > 0:
        out.append(Result("gateway_coverage", f["total"] / float(denom),
                          "%d gateway requests / (%d + %d Workers AI inferences that bypassed the gateway) over 7 days. Workers AI inferences are counted by Cloudflare itself; a provider called directly from a Worker leaves no trace there, so this is an upper bound"
                          % (f["total"], f["total"], f["direct"]), []))
    else:
        out.append(Result("gateway_coverage", None, "no model call recorded in 7 days", rows))
    return out


# ---------------------------------------------------------------- queues
def queue_figures(queues, metrics_of, now_ms):
    """queues: Cloudflare queue records. metrics_of(queue_id) -> {backlog_count, oldest_message_timestamp_ms}. Returns (dlq rows, consumers without a DLQ, value, unknown)."""
    dlq_names = set()
    no_dlq = []
    for q in queues:
        for c in q.get("consumers") or []:
            if c.get("dead_letter_queue"):
                dlq_names.add(c["dead_letter_queue"])
            else:
                no_dlq.append("%s (consumer %s)" % (q.get("queue_name"), c.get("script") or "?"))
    rows, value, unknown = [], 0, 0
    for q in queues:
        if q.get("queue_name") not in dlq_names:
            continue
        try:
            m = metrics_of(q.get("queue_id")) or {}
        except Exception as e:  # noqa: BLE001
            unknown += 1
            rows.append((q.get("queue_name"), None, "metrics unreadable: %s" % str(e)[:100]))
            continue
        n, oldest = int(m.get("backlog_count") or 0), int(m.get("oldest_message_timestamp_ms") or 0)
        held = n > 0 and oldest > 0 and (now_ms - oldest) / 60000.0 > DLQ_HELD_MIN
        if held:
            value += n
        rows.append((q.get("queue_name"), 0 if held else 1, "backlog %d, oldest %s" % (n, ("%d min old" % ((now_ms - oldest) / 60000)) if oldest else "none")))
    for name in no_dlq:
        rows.append((name, 0, "consumer without a dead-letter queue: failed messages are discarded after max_retries"))
    return rows, no_dlq, value, unknown, len(dlq_names)


def collect_queues(ctx):
    acc = _acc()
    if not acc:
        return [Result("dlq_depth", None, "no Cloudflare account id in this environment", [])]
    try:
        r = ctx.cf("/accounts/%s/queues?per_page=100" % acc)
    except Exception as e:  # noqa: BLE001
        return [Result("dlq_depth", None, "Queues API unreadable: %s" % str(e)[:160], [])]
    queues = r.get("result") or []
    rows, no_dlq, value, unknown, n_dlq = queue_figures(queues, lambda qid: (ctx.cf("/accounts/%s/queues/%s/metrics" % (acc, qid)) or {}).get("result"), int(ctx.now * 1000))
    if unknown:
        return [Result("dlq_depth", None, "%d dead-letter queue(s) could not be read; a total with an unknown part is not written" % unknown, rows)]
    note = "%d queues, %d dead-letter queue(s); backlog older than %d min: %d messages (an upper bound: the API cannot split a backlog by age)" % (len(queues), n_dlq, DLQ_HELD_MIN, value)
    if no_dlq:
        note += "; %d consumer(s) have NO dead-letter queue and discard failures: %s" % (len(no_dlq), ", ".join(no_dlq)[:160])
    return [Result("dlq_depth", value, note, rows)]


# ---------------------------------------------------------------- duplicate side effects
DUP_SQL = {
    "post-id-twice": ("SELECT COALESCE(SUM(n - 1), 0) AS n FROM (SELECT COUNT(*) AS n FROM social_media_posts WHERE created_at >= datetime('now', '-7 days') AND post_id IS NOT NULL AND post_id <> '' "
                      "GROUP BY platform, post_id HAVING COUNT(*) > 1)"),
    "buffer-id-twice": ("SELECT COALESCE(SUM(n - 1), 0) AS n FROM (SELECT COUNT(*) AS n FROM social_media_posts WHERE created_at >= datetime('now', '-7 days') AND buffer_id IS NOT NULL AND buffer_id <> '' "
                        "GROUP BY buffer_id HAVING COUNT(*) > 1)"),
    "post-url-twice": ("SELECT COALESCE(SUM(n - 1), 0) AS n FROM (SELECT COUNT(*) AS n FROM social_media_posts WHERE created_at >= datetime('now', '-7 days') AND url IS NOT NULL AND url <> '' "
                       "GROUP BY platform, url HAVING COUNT(*) > 1)"),
    "thread-uri-twice": ("SELECT COALESCE(SUM(n - 1), 0) AS n FROM (SELECT COUNT(*) AS n FROM social_threads WHERE COALESCE(posted_at, created_at) >= datetime('now', '-7 days') AND post_uri IS NOT NULL AND post_uri <> '' "
                         "GROUP BY post_uri HAVING COUNT(*) > 1)"),
    "thread-text-twice-24h": ("SELECT COUNT(*) AS n FROM social_threads a JOIN social_threads b ON a.posts = b.posts AND a.id < b.id AND a.posts IS NOT NULL AND length(a.posts) > 20 "
                              "AND abs(julianday(COALESCE(b.posted_at, b.created_at)) - julianday(COALESCE(a.posted_at, a.created_at))) < 1 "
                              "WHERE a.status = 'posted' AND b.status = 'posted' AND COALESCE(b.posted_at, b.created_at) >= datetime('now', '-7 days')"),
    "mail-twice-24h": ("SELECT COUNT(*) AS n FROM emails a JOIN emails b ON a.recipient = b.recipient AND a.subject = b.subject AND a.body_text = b.body_text AND a.id < b.id AND length(COALESCE(a.body_text, '')) > 0 "
                       "AND julianday(b.received_at) - julianday(a.received_at) < 1 WHERE a.status = 'sent' AND b.status = 'sent' AND b.received_at >= datetime('now', '-7 days')"),
}


def collect_side_effects(ctx):
    rows, total, unknown = [], 0, []
    for key, sql in DUP_SQL.items():
        try:
            n = int((ctx.d1(sql) or [{}])[0].get("n") or 0)
        except Exception as e:  # noqa: BLE001
            unknown.append(key)
            rows.append((key, None, "query failed: %s" % str(e)[:100]))
            continue
        total += n
        rows.append((key, 1 if n == 0 else 0, "%d duplicate(s) in the last 7 days" % n))
    if unknown:
        return [Result("duplicate_side_effects", None, "%d of %d duplicate checks could not run (%s); a total with an unknown part is not written" % (len(unknown), len(DUP_SQL), ", ".join(unknown)), rows)]
    return [Result("duplicate_side_effects", total, "%d duplicate posts or sent mails in 7 days over %d checks (platform id, buffer id, url, thread uri, identical thread text within 24 h, identical sent mail within 24 h). Identical-text posts without a shared platform id "
                   "cannot be detected: social_media_posts.content_preview is a label, not the text" % (total, len(DUP_SQL)), rows)]


# ---------------------------------------------------------------- log ingest
def collect_log_ingest(ctx):
    acc = _acc()
    if not acc:
        return [Result("log_ingest_gb_month", None, "no Cloudflare account id in this environment", [])]
    now = time.gmtime(ctx.now)
    start = calendar.timegm((now.tm_year, now.tm_mon, 1, 0, 0, 0)) * 1000
    end = int(ctx.now * 1000)
    query = urllib.parse.urlencode({"from": start, "to": end})
    try:
        response = ctx.cf("/accounts/%s/workers/observability/usage?%s" % (acc, query))
    except Exception as e:  # noqa: BLE001
        return [Result("log_ingest_gb_month", None, "Workers Observability usage unreadable: %s" % str(e)[:120], [])]
    breakdown = (response.get("result") or {}).get("breakdown") if isinstance(response, dict) else None
    if not isinstance(breakdown, list):
        return [Result("log_ingest_gb_month", None, "Workers Observability usage response has no breakdown", [])]
    worker_rows = [entry for entry in breakdown if isinstance(entry, dict) and entry.get("dataset") == "cloudflare-workers"]
    total_bytes = 0
    rows = []
    for entry in worker_rows:
        size = entry.get("eventSize")
        if isinstance(size, bool) or not isinstance(size, (int, float)) or not math.isfinite(size) or size < 0:
            return [Result("log_ingest_gb_month", None, "Workers Observability usage returned an invalid eventSize", [])]
        total_bytes += size
        rows.append((str(entry.get("service") or "unknown"), 1, "%s eventSize: %s bytes" % (entry.get("bin") or "unknown day", size)))
    gb = total_bytes / 1000000000.0
    note = ("%.4f GB month-to-date from Workers Observability usage eventSize for the cloudflare-workers dataset "
            "(ABR-adjusted bytes; UTC month start through the current run)" % gb)
    return [Result("log_ingest_gb_month", gb, note, rows)]


# ---------------------------------------------------------------- CI gate
def required_checks(ctx):
    try:
        return list(json.loads(ctx.read("scripts/github-main-ruleset.json")).get("required_checks") or [])
    except Exception:  # noqa: BLE001
        return ["gate", "guard", "mirror-guard", "identity-guard"]


def classify_checks(check_runs, required):
    """(state, missing, red): every required name needs a run whose conclusion is success, neutral or skipped."""
    by = {}
    for c in check_runs:
        by.setdefault(c.get("name"), []).append(c)
    missing, red = [], []
    for name in required:
        runs = by.get(name)
        if not runs:
            missing.append(name)
            continue
        latest = sorted(runs, key=lambda c: c.get("completed_at") or c.get("started_at") or "")[-1]
        if latest.get("conclusion") not in GOOD_CONCLUSIONS:
            red.append(name)
    return ("green" if not missing and not red else "not-green"), missing, red


def _gh_url(ctx, url, budget):
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    tok = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    if tok:
        h["Authorization"] = "Bearer " + tok
    budget[0] -= 1
    r = ctx.http(url, headers=h, external=True, timeout=25, max_bytes=2000000)
    if r.error or r.status != 200:
        raise RuntimeError(r.error or "http %s" % r.status)
    return json.loads(r.text)


def _gh(ctx, path, budget):
    return _gh_url(ctx, "https://api.github.com/repos/%s%s" % (REPO, path), budget)


def collect_ci_gate(ctx):
    req = required_checks(ctx)
    budget = [GH_CALLS_PER_RUN]
    cutoff_s = ctx.now - WINDOW_DAYS * 86400
    cutoff = _iso(cutoff_s)
    rows, notes = [], []
    audited = {}
    try:
        for r in ctx.d1("SELECT pr, merged_at, required_state, missing, red FROM ci_gate_audit WHERE merged_at >= ?1", [cutoff]):
            audited[int(r["pr"])] = r
    except Exception as e:  # noqa: BLE001
        if not ctx.dry:
            return [Result("ci_gate_bypass_count", None, "ci_gate_audit unreadable (migration not applied?): %s" % str(e)[:120], [])]
        notes.append("dry run: ci_gate_audit not readable, starting from an empty audited set")
    try:
        last = ctx.d1("SELECT MAX(checked_at) AS t FROM ci_gate_audit")
        if last and last[0].get("t") and not ctx.dry and ctx.now - _epoch(last[0]["t"]) < CI_THROTTLE_MIN * 60:
            return [Result("ci_gate_bypass_count", None, "throttled: the last audit batch ran %s, one batch every %d minutes keeps within the 60 unauthenticated GitHub requests an hour shared with the other collectors" % (last[0]["t"], CI_THROTTLE_MIN), [])]
    except Exception:  # noqa: BLE001
        pass
    population = None
    try:
        sr = _gh_url(ctx, "https://api.github.com/search/issues?" + urllib.parse.urlencode({"q": "repo:%s is:pr is:merged merged:>=%s" % (REPO, cutoff[:10]), "per_page": 1}), budget)
        population = int(sr.get("total_count"))
    except Exception as e:  # noqa: BLE001
        notes.append("window population: %s" % str(e)[:80])
    todo = {}
    try:
        for page in (1, 2, 3):
            if budget[0] <= CI_AUDIT_PER_RUN + 1 or len(todo) >= CI_AUDIT_PER_RUN:
                break
            lst = _gh(ctx, "/pulls?" + urllib.parse.urlencode({"state": "closed", "sort": "updated", "direction": "desc", "per_page": 50, "page": page}), budget)
            for p in lst:
                n = int(p["number"])
                if p.get("merged_at") and p["merged_at"] >= cutoff and n not in audited:
                    todo[n] = {"merged_at": p["merged_at"], "merge_sha": p.get("merge_commit_sha") or "", "head_sha": (p.get("head") or {}).get("sha") or ""}
            if len(lst) < 50:
                break
    except Exception as e:  # noqa: BLE001
        notes.append("GitHub pulls list: %s" % str(e)[:100])
    stamp = _iso(ctx.now)
    for n in sorted(todo, reverse=True)[:CI_AUDIT_PER_RUN]:
        if budget[0] <= 0 or ctx.left() < 15:
            break
        try:
            cr = _gh(ctx, "/commits/%s/check-runs?per_page=100" % todo[n]["head_sha"], budget)
        except Exception as e:  # noqa: BLE001
            notes.append("check-runs for PR %d: %s" % (n, str(e)[:80]))
            if "403" in str(e) or "429" in str(e):
                break
            continue
        state, missing, red = classify_checks(cr.get("check_runs") or [], req)
        audited[n] = {"pr": n, "merged_at": todo[n]["merged_at"], "required_state": state, "missing": ",".join(missing), "red": ",".join(red)}
        if not ctx.dry:
            try:
                ctx.d1("INSERT OR REPLACE INTO ci_gate_audit (pr, merged_at, merge_sha, head_sha, required_state, missing, red, checked_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                       [n, todo[n]["merged_at"], todo[n]["merge_sha"], todo[n]["head_sha"], state, ",".join(missing), ",".join(red), stamp])
            except Exception as e:  # noqa: BLE001
                notes.append("ci_gate_audit insert: %s" % str(e)[:80])
                break
    if not ctx.dry:
        try:
            ctx.d1("DELETE FROM ci_gate_audit WHERE merged_at < ?1", [_iso(ctx.now - 40 * 86400)])
        except Exception:  # noqa: BLE001
            pass
    n_aud = len(audited)
    bypass = [n for n, r in audited.items() if r["required_state"] != "green"]
    coverage = (n_aud / float(population)) if population else None
    by_check = {}
    for n in bypass:
        for name in ((audited[n].get("missing") or "") + "," + (audited[n].get("red") or "")).split(","):
            if name:
                by_check[name] = by_check.get(name, 0) + 1
    for name, c in sorted(by_check.items(), key=lambda kv: -kv[1]):
        rows.append(("check:" + name, 0, "%d audited merge(s) without a green %s" % (c, name)))
    rows.append(("_coverage", (1 if coverage is not None and coverage >= CI_COVERAGE_MIN else None), "%d of %s merged pull requests of the last %d days audited%s" % (
        n_aud, population if population is not None else "an unknown number of", WINDOW_DAYS, (" (%.1f percent)" % (coverage * 100)) if coverage is not None else "")))
    note = ("%d of %d audited merges to main had a declared required check (%s, scripts/github-main-ruleset.json) missing or not green on the head commit; %s of the window's merges audited. "
            "The main-gate ruleset is declared but not applied (GitHub enforces only main-safety), and the stale-PR lane merges without the gate job by design; both are counted as the data shows them. %s"
            % (len(bypass), n_aud, "/".join(req), ("%d" % n_aud) if population is None else "%d of %d" % (n_aud, population), "; ".join(notes)))[:700]
    if bypass:
        return [Result("ci_gate_bypass_count", len(bypass), "at least " + note, rows)]
    if coverage is not None and coverage >= CI_COVERAGE_MIN:
        return [Result("ci_gate_bypass_count", 0, note, rows)]
    return [Result("ci_gate_bypass_count", None, "no bypass among the audited merges yet, but coverage is below %d percent so zero would not be a measurement. %s" % (int(CI_COVERAGE_MIN * 100), note), rows)]


COLLECTORS = [
    Collector("collect_deploys", collect_deploys, ["deploys_via_gradual", "change_failure_rate", "mttr_rollback_min_p95"], 55),
    Collector("collect_ai_gateway", collect_ai_gateway, ["gateway_coverage", "ai_cache_hit_rate"], 55),
    Collector("collect_queues", collect_queues, ["dlq_depth"], 55),
    Collector("collect_side_effects", collect_side_effects, ["duplicate_side_effects"], 55),
    Collector("collect_log_ingest", collect_log_ingest, ["log_ingest_gb_month"], 360),
    Collector("collect_ci_gate", collect_ci_gate, ["ci_gate_bypass_count"], 55),
]


# ---------------------------------------------------------------- selftest
def selftest():
    import sqlite3
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
            print("FAIL " + m)

    def dep(w, i, minute, versions, pct=None, by="upload"):
        t = 1793000000 + minute * 60
        return {"id": "%s-%d" % (w, i), "worker": w, "created_on": _iso(t), "strategy": "percentage", "n_versions": len(versions), "min_pct": pct if pct is not None else 100.0,
                "triggered_by": by, "message": "", "version_ids": tuple(sorted(versions))}
    # normalisation and the gradual test
    n = normalise_deployment("w", {"id": "d1", "strategy": "percentage", "created_on": "2026-10-26T19:45:59.977734Z", "annotations": {"workers/triggered_by": "upload"},
                                   "versions": [{"version_id": "v1", "percentage": 90}, {"version_id": "v2", "percentage": 10}]})
    ok(is_gradual(n) and n["n_versions"] == 2 and n["min_pct"] == 10.0, "a 90/10 split is gradual: %r" % n)
    ok(not is_gradual(normalise_deployment("w", {"id": "d2", "versions": [{"version_id": "v1", "percentage": 100}], "created_on": "2026-10-26T19:45:59Z"})), "a single 100 percent version is not")
    # sequence analysis: an annotated rollback and a re-activation both fail the deployment before them
    evs = [dep("a", 1, 0, ["v1"]), dep("a", 2, 10, ["v2"]), dep("a", 3, 20, ["v3"]), dep("a", 4, 30, ["v2"]),  # v2 re-activated: v3 failed after 10 min
           dep("b", 1, 0, ["w1"]), dep("b", 2, 5, ["w2"]), dep("b", 3, 50, ["w1"], by="rollback"),  # annotated rollback
           dep("c", 1, 0, ["x1"]), dep("c", 2, 3000, ["x2"]), dep("c", 3, 3010, ["x1"]),  # reverted after 10 minutes but... x1 is live before x2: failed
           dep("d", 1, 0, ["y1"]), dep("d", 2, 10, ["y1"]),  # same version re-deployed: not a rollback
           dep("e", 1, 0, ["z1"]), dep("e", 2, 5000, ["z2"]), dep("e", 3, 7000, ["z1"])]  # 32 h later: outside the 24 h window
    a = analyse_deploys(evs, [("a", 1793000000 + 60), ("zz", 1793000000)])
    ok(a["total"] == 15 and a["gradual"] == 0, "totals: %r" % {k: a[k] for k in ("total", "gradual")})
    ok(a["failed_by_rollback"] == 3, "three failed deployments (a-3, b-2, c-2): %r" % a["rollbacks"])
    ok(len(a["canary"]) == 1, "a canary incident counts only for a worker with a recorded window: %r" % a["canary"])
    ok(p95([1, 2, 3, 4, 100]) == 100 and p95([5]) == 5 and p95([]) is None and p95(list(range(1, 21))) == 19, "p95 nearest rank")
    # AI Gateway figures
    g = [{"count": 2129, "dimensions": {"provider": "workers-ai", "cached": 1}}, {"count": 10580, "dimensions": {"provider": "workers-ai", "cached": 0}},
         {"count": 30, "dimensions": {"provider": "deepseek", "cached": 1}}, {"count": 8945, "dimensions": {"provider": "deepseek", "cached": 0}}, {"count": 517, "dimensions": {"provider": "anthropic", "cached": 0}}]
    f = gateway_figures(g, [{"count": 20000}, {"count": 5000}])
    ok(f["total"] == 22201 and f["cached"] == 2159 and f["wai"] == 12709 and f["direct"] == 25000 - 10580, "gateway figures: %r" % f)
    # queues: a DLQ with an old backlog counts, a young one does not, a consumer without a DLQ is listed and not hidden
    qs = [{"queue_id": "q1", "queue_name": "jobs", "consumers": [{"script": "s", "dead_letter_queue": "jobs-dlq"}]}, {"queue_id": "q2", "queue_name": "jobs-dlq", "consumers": []},
          {"queue_id": "q3", "queue_name": "bare", "consumers": [{"script": "t"}]}]
    now_ms = 1793000000000
    rows, no_dlq, value, unknown, n_dlq = queue_figures(qs, lambda qid: {"backlog_count": 7, "oldest_message_timestamp_ms": now_ms - 200 * 60000}, now_ms)
    ok(value == 7 and no_dlq == ["bare (consumer t)"] and n_dlq == 1 and unknown == 0, "old backlog counted, bare consumer listed: %r" % ((value, no_dlq, n_dlq),))
    rows, no_dlq, value, unknown, n_dlq = queue_figures(qs, lambda qid: {"backlog_count": 7, "oldest_message_timestamp_ms": now_ms - 30 * 60000}, now_ms)
    ok(value == 0, "a young backlog is not counted")
    # duplicates on a sqlite shim of the ledgers
    c = sqlite3.connect(":memory:")
    c.executescript("""
CREATE TABLE social_media_posts (id TEXT PRIMARY KEY, platform TEXT, post_id TEXT, url TEXT, buffer_id TEXT, created_at TEXT);
CREATE TABLE social_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, posts TEXT, status TEXT, posted_at TEXT, created_at TEXT, post_uri TEXT);
CREATE TABLE emails (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT, subject TEXT, body_text TEXT, status TEXT, received_at TEXT);
INSERT INTO social_media_posts VALUES ('1','bsky','at://x/1','u1',NULL,datetime('now')), ('2','bsky','at://x/1','u2',NULL,datetime('now')), ('3','mastodon','m1','u3','b1',datetime('now')), ('4','mastodon','m2','u4','b1',datetime('now'));
INSERT INTO social_threads (slug, posts, status, posted_at, created_at, post_uri) VALUES ('a','the same thread text that is long enough','posted',datetime('now'),datetime('now'),'at://t/1'), ('b','the same thread text that is long enough','posted',datetime('now'),datetime('now'),'at://t/2');
INSERT INTO emails (recipient, subject, body_text, status, received_at) VALUES ('r@x','s','body','sent',datetime('now')), ('r@x','s','body','sent',datetime('now')), ('q@x','s','body','sent',datetime('now'));
""")

    class Ctx(object):
        dry = True
        now = 1793000000

        def d1(self, sql, params=None):
            cur = c.execute(sql, params or [])
            cols = [d[0] for d in cur.description] if cur.description else []
            return [dict(zip(cols, r)) for r in cur.fetchall()]

        def left(self):
            return 100

    r = collect_side_effects(Ctx())[0]
    ok(r.value is not None, "duplicate checks ran")
    got = {row[0]: row[2] for row in r.rows}
    ok(got["post-id-twice"].startswith("1 ") and got["buffer-id-twice"].startswith("1 ") and got["thread-text-twice-24h"].startswith("1 ") and got["mail-twice-24h"].startswith("1 "), "each duplicate kind is found once: %r" % got)
    ok(r.value == 4, "four duplicates in total: %r" % r.value)
    # CI gate classification
    good = [{"name": "gate", "conclusion": "success"}, {"name": "guard", "conclusion": "skipped"}, {"name": "mirror-guard", "conclusion": "success"}, {"name": "identity-guard", "conclusion": "neutral"}]
    ok(classify_checks(good, ["gate", "guard", "mirror-guard", "identity-guard"])[0] == "green", "all four required checks green")
    st, miss, red = classify_checks(good[1:] + [{"name": "gate", "conclusion": "failure"}], ["gate", "guard", "mirror-guard", "identity-guard"])
    ok(st == "not-green" and red == ["gate"] and miss == [], "a failed required check is red: %r" % ((st, miss, red),))
    st, miss, red = classify_checks([{"name": "guard", "conclusion": "success"}], ["gate", "guard"])
    ok(st == "not-green" and miss == ["gate"], "a required check that never ran is missing")
    # end to end on a sqlite shim: collect_deploys stores new deployments once and computes from the table
    import collections
    Resp = collections.namedtuple("Resp", "status headers set_cookies text final_url ms hops error")
    old_acc = os.environ.get("CF_ACCOUNT_ID")
    os.environ["CF_ACCOUNT_ID"] = "acc"
    try:
        db = sqlite3.connect(":memory:")
        db.executescript("""
CREATE TABLE bp26_deploy_events (deployment_id TEXT PRIMARY KEY, worker TEXT NOT NULL, created_on TEXT NOT NULL, strategy TEXT, n_versions INTEGER NOT NULL DEFAULT 0, min_pct REAL, triggered_by TEXT, message TEXT, version_ids TEXT, seen_at TEXT NOT NULL);
CREATE TABLE ci_gate_audit (pr INTEGER PRIMARY KEY, merged_at TEXT NOT NULL, merge_sha TEXT, head_sha TEXT, required_state TEXT NOT NULL, missing TEXT, red TEXT, checked_at TEXT NOT NULL);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, created_at INTEGER);
""")
        now = _epoch("2026-10-26T20:00:00Z")
        db.execute("INSERT INTO agent_issues VALUES (1, 'CONTROL-PLANE-REVERTED-1: push 7a9d293 reverted, qnfo-gateway deploy canary failed', ?)", [(now - 3600) * 1000])

        class LC(object):
            def __init__(self, response, stamp=_epoch("2026-11-02T12:34:56Z")):
                self.now = stamp
                self.response = response
                self.path = None

            def cf(self, path):
                self.path = path
                if isinstance(self.response, Exception):
                    raise self.response
                return self.response

        log_ctx = LC({"result": {"breakdown": [
            {"dataset": "cloudflare-workers", "service": "worker-a", "bin": "2026-11-01", "eventSize": 1000000000},
            {"dataset": "cloudflare-workers", "service": "worker-b", "bin": "2026-11-02", "eventSize": 250000000},
            {"dataset": "otel", "service": "worker-a", "bin": "2026-11-02", "eventSize": 9000000000},
            {"dataset": "ai-gateway", "service": "default", "bin": "2026-11-02", "eventSize": 8000000000},
        ]}})
        log = collect_log_ingest(log_ctx)[0]
        expected_start = _epoch("2026-11-01T00:00:00Z") * 1000
        expected_end = _epoch("2026-11-02T12:34:56Z") * 1000
        ok(log.value == 1.25, "log ingest sums only cloudflare-workers eventSize in decimal GB: %r" % log)
        ok(log_ctx.path == "/accounts/acc/workers/observability/usage?from=%d&to=%d" % (expected_start, expected_end),
           "log ingest queries from UTC month start to the current run: %s" % log_ctx.path)
        ok(collect_log_ingest(LC({"result": {"breakdown": []}}))[0].value == 0,
           "a valid empty Workers dataset is a measured zero")
        ok(collect_log_ingest(LC({"result": {}}))[0].value is None,
           "a response without breakdown stays unknown")
        ok(collect_log_ingest(LC({"result": {"breakdown": [{"dataset": "cloudflare-workers", "eventSize": True}]}}))[0].value is None,
           "a malformed eventSize stays unknown")
        ok(collect_log_ingest(LC(RuntimeError("HTTP 403")))[0].value is None,
           "an unreadable usage endpoint stays unknown")

        def mk(i, minute, vid, by="upload", pct=100):
            return {"id": "d%d" % i, "strategy": "percentage", "created_on": _iso(now - 7200 + minute * 60), "annotations": {"workers/triggered_by": by}, "versions": [{"version_id": vid, "percentage": pct}]}
        api = {"/accounts/acc/workers/scripts": {"result": [{"id": "w1"}, {"id": "qnfo-gateway"}]},
               "/accounts/acc/workers/scripts/w1/deployments": {"result": {"deployments": [mk(1, 0, "v1"), mk(2, 10, "v2"), mk(3, 20, "v1"), mk(4, 30, "v4", pct=50)]}},
               "/accounts/acc/workers/scripts/qnfo-gateway/deployments": {"result": {"deployments": [mk(5, 0, "g1"), mk(6, 5, "g2")]}}}

        class EC(object):
            dry = False

            def __init__(self):
                self.now = now

            def d1(self, sql, params=None):
                cur = db.execute(sql, params or [])
                cols = [d[0] for d in cur.description] if cur.description else []
                rows = [dict(zip(cols, r)) for r in cur.fetchall()]
                db.commit()
                return rows

            def left(self):
                return 100

            def cf(self, path):
                if path not in api:
                    raise RuntimeError("HTTP 404 " + path)
                return api[path]
        res = {r.metric: r for r in collect_deploys(EC())}
        ok(db.execute("SELECT COUNT(*) FROM bp26_deploy_events").fetchone()[0] == 6, "six deployments stored once")
        ok(abs(res["deploys_via_gradual"].value - 1 / 6.0) < 1e-9, "one of six deployments is a 50 percent step: %r" % res["deploys_via_gradual"].value)
        # w1: d3 re-activates v1 ten minutes after d2 (v2 failed); qnfo-gateway: a canary revert issue inside its window
        ok(abs(res["change_failure_rate"].value - 2 / 6.0) < 1e-9, "two failures (v2 re-activation, canary revert) of six: %r %s" % (res["change_failure_rate"].value, res["change_failure_rate"].note[:120]))
        ok(res["mttr_rollback_min_p95"].value is None and "1 rollback events" in res["mttr_rollback_min_p95"].note, "mttr stays unknown below five rollbacks: %s" % res["mttr_rollback_min_p95"].note[:80])
        res2 = {r.metric: r for r in collect_deploys(EC())}
        ok(db.execute("SELECT COUNT(*) FROM bp26_deploy_events").fetchone()[0] == 6 and abs(res2["deploys_via_gradual"].value - 1 / 6.0) < 1e-9, "a second run stores nothing new and computes the same")
        # CI gate: one audited merge without the gate check makes a count; three green merges at full coverage make a zero
        PRS = [{"number": 11, "merged_at": _iso(now - 1000), "merge_commit_sha": "m11", "head": {"sha": "h11"}, "updated_at": _iso(now)},
               {"number": 12, "merged_at": _iso(now - 2000), "merge_commit_sha": "m12", "head": {"sha": "h12"}, "updated_at": _iso(now)},
               {"number": 13, "merged_at": None, "merge_commit_sha": None, "head": {"sha": "h13"}, "updated_at": _iso(now)}]
        green = [{"name": n, "conclusion": "success"} for n in ("gate", "guard", "mirror-guard", "identity-guard")]

        def http(url, **kw):
            if "/search/issues" in url:
                return Resp(200, {}, [], json.dumps({"total_count": 2}), url, 1, [], None)
            if "/pulls?" in url:
                return Resp(200, {}, [], json.dumps(PRS), url, 1, [], None)
            if "/commits/h11/check-runs" in url:
                return Resp(200, {}, [], json.dumps({"check_runs": green}), url, 1, [], None)
            if "/commits/h12/check-runs" in url:
                return Resp(200, {}, [], json.dumps({"check_runs": green[1:]}), url, 1, [], None)
            return Resp(404, {}, [], "", url, 1, [], "http 404")

        class GC(EC):
            def http(self, url, **kw):
                return http(url, **kw)

            def read(self, rel):
                return json.dumps({"required_checks": ["gate", "guard", "mirror-guard", "identity-guard"]})
        out = collect_ci_gate(GC())[0]
        ok(out.value == 1 and out.note.startswith("at least 1 of 2 audited") and db.execute("SELECT COUNT(*) FROM ci_gate_audit").fetchone()[0] == 2, "a merge without the gate check is counted: %r %s" % (out.value, out.note[:100]))
        thr = collect_ci_gate(GC())[0]
        ok(thr.value is None and thr.note.startswith("throttled"), "a second batch inside 50 minutes is throttled: %s" % thr.note[:60])
        db.execute("UPDATE ci_gate_audit SET required_state = 'green', missing = '', checked_at = '2026-01-01T00:00:00Z'")
        out = collect_ci_gate(GC())[0]
        ok(out.value == 0, "full coverage and no bypass is a measured zero: %r %s" % (out.value, out.note[:100]))
        PRS.append({"number": 14, "merged_at": _iso(now - 500), "merge_commit_sha": "m14", "head": {"sha": "h14"}, "updated_at": _iso(now)})

        class GC2(GC):
            def http(self, url, **kw):
                if "/search/issues" in url:
                    return Resp(200, {}, [], json.dumps({"total_count": 100}), url, 1, [], None)
                return http(url, **kw)
        out = collect_ci_gate(GC2())[0]
        ok(out.value is None and "coverage is below 98 percent" in out.note, "partial coverage with no bypass is unknown, not zero: %r" % (out.value,))
    finally:
        if old_acc is None:
            os.environ.pop("CF_ACCOUNT_ID", None)
        else:
            os.environ["CF_ACCOUNT_ID"] = old_acc
    print("bp26_cfapi selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print("usage: python3 scripts/bp26_cfapi.py --selftest   (collectors run through scripts/bp26_producers.py)")
