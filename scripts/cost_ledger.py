#!/usr/bin/env python3
"""COST-LEDGER-DAILY-1 (2026-10-09, pillar cost; owner request 2026-10-09: realistic targets from actual usage, a monthly
total that covers the Cloudflare fleet and all billing, extrapolated from the last 7-10 days rather than a 30-day window).

WHAT  Writes qnfo-audit.cost_daily, one row per (date, source), for the last LOOKBACK_DAYS complete days plus today:
        workers_ai             account-wide Workers AI neurons (GraphQL aiInferenceAdaptiveGroups) at $0.011 per 1k after
                               10k free per day: the billed Workers AI amount, not only the fleet-attributed calls;
        ai_gateway:<provider>  AI Gateway cost per provider (GraphQL aiGatewayRequestsAdaptiveGroups.sum.cost): unified billing
                               (paid from gateway credit) and BYOK (paid to the provider) both cost the owner money;
        cloudflare_plan        the account's subscriptions (GET /accounts/{id}/subscriptions) spread per day; when the token is
                               refused, the seeded monthly baseline in cost_source_registry, with the refusal in the note;
        direct_providers_external  the owner's stated spend outside the fleet (no API sees it), per day, marked unverified.
      v_cost_run_rate (migration 2026-10-09-14) projects each source and the total to 30 days from the 7- and 10-day means.
RUNS  A step of the `heavy` job of remediation-consumer.yml (every 3 hours since CONSUMER-SPEED-1, 2026-11-04; was hourly; rewrites the same rows, so it is idempotent). Never fails the job.
"""
import datetime as dt
import json
from math import isfinite
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import remediation_consumer as RC  # noqa: E402

LOOKBACK_DAYS = int(os.environ.get("COST_LOOKBACK_DAYS", "10"))
# LEDGER-FAST-1 (2026-11-04): the consume job is capped at 15 minutes and the consumer plus its sweeps already take about 13 of them, so this step is
# killed when it runs long (17:10 and 17:41Z on 2026-11-04: cancelled after writing 10-25..10-28, the forecast, unit-cost and reconciliation tail never
# ran). The day loop therefore goes newest first, stops after this many seconds (the first day always runs) and leaves the tail to run.
LEDGER_DAY_BUDGET_S = float(os.environ.get("COST_LEDGER_DAY_BUDGET_S", "150"))
# A per-model meter day older than today minus this is final: it is rewritten only when it has no rows yet (the first backfill), not every run.
METER_REFRESH_DAYS = 2
# Rows per multi-row upsert: 6 bound parameters each plus the date, under the 100 D1 allows a statement.
METER_CHUNK = 12
NEURON_USD_PER_1K = 0.011
FREE_NEURONS_PER_DAY = 10000
TASK_COST_DETAIL_LIMIT = 50
AI_SEARCH_BILLING_START = dt.date(2026, 12, 1)


def cf(method, path, body=None, timeout=30):
    req = urllib.request.Request(RC.CF_API + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Authorization": "Bearer " + RC.TOKEN, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace") or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8", "replace") or "{}")
        except Exception:  # noqa: BLE001
            return e.code, {}


def gql(query, call=cf):
    st, j = call("POST", "/graphql", {"query": query})
    if not 200 <= (st or 0) < 300 or j.get("errors"):
        raise RuntimeError("graphql %s %s" % (st, json.dumps(j.get("errors"))[:200]))
    acc = (((j.get("data") or {}).get("viewer") or {}).get("accounts") or [{}])[0]
    return acc


def day_window(day):
    start = dt.datetime.combine(day, dt.time(0, 0), tzinfo=dt.timezone.utc)
    end = min(start + dt.timedelta(days=1), dt.datetime.now(dt.timezone.utc))
    return start.strftime("%Y-%m-%dT%H:%M:%SZ"), end.strftime("%Y-%m-%dT%H:%M:%SZ")


def workers_ai_day_models(day, call=cf):
    """AI-METER-MODEL-1 (2026-11-04): the day's account-wide Workers AI usage with its modelId dimension, in the same one GraphQL call
    that used to return only the total. Returns (usd, requests, neurons, models) where models is [(modelId, neurons, requests, input
    tokens, output tokens)]. A row without a modelId dimension is kept as 'unknown', so the total never drops a group."""
    a, b = day_window(day)
    acc = gql('query { viewer { accounts(filter: { accountTag: "%s" }) { aiInferenceAdaptiveGroups(limit: 1000, filter: { datetime_geq: "%s", datetime_lt: "%s" }) { count sum { totalNeurons totalInputTokens totalOutputTokens } dimensions { modelId } } } } }'
              % (RC.ACCOUNT, a, b), call)
    rows = acc.get("aiInferenceAdaptiveGroups") or []
    models = {}
    for r in rows:
        sm = r.get("sum") or {}
        mid = str((r.get("dimensions") or {}).get("modelId") or "unknown")[:120]
        m = models.setdefault(mid, [0.0, 0, 0, 0])
        m[0] += float(sm.get("totalNeurons") or 0)
        m[1] += int(r.get("count") or 0)
        m[2] += int(sm.get("totalInputTokens") or 0)
        m[3] += int(sm.get("totalOutputTokens") or 0)
    neurons = sum(m[0] for m in models.values())
    reqs = sum(m[1] for m in models.values())
    return (max(0.0, neurons - FREE_NEURONS_PER_DAY) / 1000 * NEURON_USD_PER_1K, reqs, neurons,
            [(mid, m[0], m[1], m[2], m[3]) for mid, m in sorted(models.items())])


def workers_ai_day(day, call=cf):
    usd, reqs, neurons, _ = workers_ai_day_models(day, call)
    return usd, reqs, neurons


def write_model_meter(d1, date, models):
    """AI-METER-MODEL-1: one ai_meter_model_daily row per (date, model); the Cloudflare meter, not the per-worker counters. A model that
    stopped appearing in a re-read day is removed so the day's rows always sum to the meter. LEDGER-FAST-1: METER_CHUNK rows per statement,
    so a day costs two or three D1 round trips instead of one per model (16 to 22 models a day, each a slow REST call while D1 is loaded)."""
    seen = []
    for lo in range(0, len(models), METER_CHUNK):
        chunk = models[lo:lo + METER_CHUNK]
        values, params = [], [date]
        for k, (mid, neurons, reqs, tin, tout) in enumerate(chunk):
            b = 2 + k * 5
            values.append("(?1, ?%d, ?%d, ?%d, ?%d, ?%d, strftime('%%Y-%%m-%%dT%%H:%%M:%%SZ', 'now'))" % (b, b + 1, b + 2, b + 3, b + 4))
            params += [mid, round(neurons, 2), int(reqs), int(tin), int(tout)]
            seen.append(mid)
        d1("INSERT INTO ai_meter_model_daily (date, model, neurons, requests, input_tokens, output_tokens, observed_at) VALUES " + ", ".join(values) +
           " ON CONFLICT(date, model) DO UPDATE SET neurons = excluded.neurons, requests = excluded.requests, input_tokens = excluded.input_tokens, "
           "output_tokens = excluded.output_tokens, observed_at = excluded.observed_at", params)
    if seen:
        d1("DELETE FROM ai_meter_model_daily WHERE date = ?1 AND model NOT IN (%s)" % ",".join("?%d" % (i + 2) for i in range(len(seen))), [date] + seen)


def meter_days_present(d1):
    """The dates that already have per-model meter rows (one cheap read per run); empty when the table cannot be read."""
    try:
        return {str(r["date"]) for r in d1("SELECT DISTINCT date FROM ai_meter_model_daily")}
    except Exception:  # noqa: BLE001
        return set()


def gateway_day(day, call=cf):
    a, b = day_window(day)
    acc = gql('query { viewer { accounts(filter: { accountTag: "%s" }) { aiGatewayRequestsAdaptiveGroups(limit: 2000, filter: { datetime_geq: "%s", datetime_lt: "%s" }) { count sum { cost } dimensions { provider model } } } } }'
              % (RC.ACCOUNT, a, b), call)
    by = {}
    for r in acc.get("aiGatewayRequestsAdaptiveGroups") or []:
        d = r.get("dimensions") or {}
        prov = str(d.get("provider") or "unknown").lower()
        model = str(d.get("model") or "")
        if prov in ("compat", "unknown", "universal") and "/" in model:
            prov = provider_label(model.split("/")[0])
        if prov in ("workers-ai", "workers_ai"):
            continue  # neuron-billed, counted in workers_ai
        c = float((r.get("sum") or {}).get("cost") or 0)
        u, n = by.get(prov, (0.0, 0))
        by[prov] = (u + c, n + int(r.get("count") or 0))
    return by


def workers_ai_window(start, end, window_days, call=cf):
    """Account-wide Workers AI cost, applying the non-rollover free allowance to each UTC day."""
    acc = gql('query { viewer { accounts(filter: { accountTag: "%s" }) { aiInferenceAdaptiveGroups(limit: 1000, filter: { datetime_geq: "%s", datetime_lt: "%s" }) { count sum { totalNeurons } dimensions { date } } } } }'
              % (RC.ACCOUNT, start, end), call)
    rows = acc.get("aiInferenceAdaptiveGroups") or []
    neurons_by_day = {}
    end_day = dt.date.fromisoformat(end[:10])
    if end[10:19] == "T00:00:00":
        end_day -= dt.timedelta(days=1)
    for row in rows:
        day = str((row.get("dimensions") or {}).get("date") or "")
        if not day or day < start[:10] or day > end_day.isoformat():
            raise RuntimeError("Workers AI daily grouping returned an invalid date")
        neurons_by_day[day] = neurons_by_day.get(day, 0.0) + float((row.get("sum") or {}).get("totalNeurons") or 0)
    neurons = sum(neurons_by_day.values())
    requests = sum(int(r.get("count") or 0) for r in rows)
    billable_neurons = sum(max(0.0, daily_neurons - FREE_NEURONS_PER_DAY) for daily_neurons in neurons_by_day.values())
    cost = billable_neurons / 1000 * NEURON_USD_PER_1K
    return cost, requests, neurons, window_days, len(rows), billable_neurons


def provider_label(value):
    label = str(value or "unknown").lower()
    if not label or len(label) > 48 or not all(c.isalnum() or c in "._-" for c in label):
        return "other"
    if any(marker in label for marker in ("ghp", "github", "cfat", "sk-ant-", "aiza", "akia", "opskeypx")):
        return "other"
    return label


def gateway_window(start, end, call=cf):
    """Provider-billed AI Gateway costs across the same 30-day UTC window."""
    acc = gql('query { viewer { accounts(filter: { accountTag: "%s" }) { aiGatewayRequestsAdaptiveGroups(limit: 2000, filter: { datetime_geq: "%s", datetime_lt: "%s" }) { count sum { cost } dimensions { provider model } } } } }'
              % (RC.ACCOUNT, start, end), call)
    by = {}
    rows = acc.get("aiGatewayRequestsAdaptiveGroups") or []
    for row in rows:
        dimensions = row.get("dimensions") or {}
        provider = provider_label(dimensions.get("provider"))
        model = str(dimensions.get("model") or "")
        if provider in ("compat", "unknown", "universal") and "/" in model:
            provider = provider_label(model.split("/")[0])
        if provider in ("workers-ai", "workers_ai"):
            continue
        amount, requests = by.get(provider, (0.0, 0))
        by[provider] = (amount + float((row.get("sum") or {}).get("cost") or 0),
                        requests + int(row.get("count") or 0))
    return by, len(rows)


def ai_search_usage_window(start, end, call=cf):
    """Return billable AI Search charges by charge-period day. Missing lines are not zero after billing starts."""
    info_status, info = call("GET", "/accounts/%s/billable-usage/info" % RC.ACCOUNT)
    if not 200 <= (info_status or 0) < 300 or info.get("success") is False:
        raise RuntimeError("billable-usage info unavailable (%s)" % info_status)
    subscriptions = ((info.get("result") or {}).get("subscriptions") or [])
    anchor_days = []
    for subscription in subscriptions:
        try:
            anchor_days.append(int(str(subscription["billing_cycle_anchor_timestamp"])[8:10]))
        except (KeyError, TypeError, ValueError):
            continue
    query_start = dt.date.fromisoformat(start)
    query_end = dt.date.fromisoformat(end)
    if anchor_days:
        anchor_day = anchor_days[0]
        anchor = query_end.replace(day=min(anchor_day, 28))
        if anchor > query_end:
            anchor = (anchor - dt.timedelta(days=1)).replace(day=min(anchor_day, 28))
        if anchor < query_start:
            query_start = anchor
    path = "/accounts/%s/billable-usage?from=%s&to=%s" % (RC.ACCOUNT, query_start.isoformat(), query_end.isoformat())
    status, payload = call("GET", path)
    if not 200 <= (status or 0) < 300 or payload.get("success") is False:
        raise RuntimeError("billable-usage answered %s" % status)
    rows = payload.get("result")
    if not isinstance(rows, list):
        raise RuntimeError("billable-usage result is unreadable")
    by_day, details = {}, []
    for row in rows:
        if not isinstance(row, dict):
            continue
        product = " ".join(str(row.get(k) or "") for k in ("ServiceFamilyName", "ServiceName", "ChargeDescription"))
        if not __import__("re").search(r"\bAI[\s-]*Search\b", product, __import__("re").I):
            continue
        period = str(row.get("ChargePeriodStart") or "")[:10]
        if not period or period < start or period > end:
            continue
        try:
            amount = float(row["ContractedCost"])
        except (KeyError, TypeError, ValueError):
            raise RuntimeError("AI Search billable cost is missing")
        if not isfinite(amount) or amount < 0:
            raise RuntimeError("AI Search billable cost is invalid")
        by_day[period] = by_day.get(period, 0.0) + amount
        details.append({
            "service": str(row.get("ServiceName") or "")[:120],
            "description": str(row.get("ChargeDescription") or "")[:200],
            "period_start": str(row.get("ChargePeriodStart") or "")[:32],
            "consumed_quantity": row.get("ConsumedQuantity"),
            "consumed_unit": str(row.get("ConsumedUnit") or "")[:40],
            "contracted_cost_usd": amount,
        })
    state = "measured" if details else ("pre-billing" if query_end < AI_SEARCH_BILLING_START else "unmeasured")
    return {"by_day": by_day, "details": details, "state": state, "query_start": query_start.isoformat(),
            "query_end": query_end.isoformat(), "total_usd": round(sum(by_day.values()), 4) if details else None}


def ai_search_inventory(call=cf):
    """Enumerate all AI Search namespaces and instances, retaining only non-secret settings and statistics."""
    namespaces = []
    page = 1
    while True:
        status, payload = call("GET", "/accounts/%s/ai-search/namespaces?page=%d&per_page=100" % (RC.ACCOUNT, page))
        if not 200 <= (status or 0) < 300 or payload.get("success") is False:
            raise RuntimeError("AI Search namespace inventory answered %s" % status)
        namespaces.extend(payload.get("result") or [])
        pages = int((payload.get("result_info") or {}).get("total_pages") or page)
        if page >= pages:
            break
        page += 1
    instances = []
    for namespace in namespaces:
        name = str(namespace.get("name") or "")
        if not name:
            continue
        page = 1
        while True:
            path = "/accounts/%s/ai-search/namespaces/%s/instances?page=%d&per_page=100" % (RC.ACCOUNT, name, page)
            status, payload = call("GET", path)
            if not 200 <= (status or 0) < 300 or payload.get("success") is False:
                raise RuntimeError("AI Search instance inventory answered %s for namespace %s" % (status, name))
            found = payload.get("result") or []
            pages = int((payload.get("result_info") or {}).get("total_pages") or page)
            for instance in found:
                instance_id = str(instance.get("id") or "")
                if not instance_id:
                    continue
                stats_state = "unavailable"
                stats = {}
                stats_path = "/accounts/%s/ai-search/namespaces/%s/instances/%s/stats" % (RC.ACCOUNT, name, instance_id)
                try:
                    stats_status, stats_payload = call("GET", stats_path)
                    if 200 <= (stats_status or 0) < 300 and stats_payload.get("success") is not False:
                        stats = stats_payload.get("result") or {}
                        stats_state = "degraded" if stats.get("degraded") else "measured"
                except Exception:  # noqa: BLE001
                    pass
                engine = stats.get("engine") or {}
                vectorize = engine.get("vectorize") or {}
                r2 = engine.get("r2") or {}
                instances.append({
                    "id": instance_id,
                    "namespace": name,
                    "engine_version": instance.get("engine_version"),
                    "enabled": instance.get("enable"),
                    "paused": instance.get("paused"),
                    "embedding_model": instance.get("embedding_model"),
                    "hybrid_search_enabled": instance.get("hybrid_search_enabled"),
                    "reranking": instance.get("reranking"),
                    "reranking_model": instance.get("reranking_model"),
                    "rewrite_query": instance.get("rewrite_query"),
                    "summarization": instance.get("summarization"),
                    "use_ocr": (instance.get("indexing_options") or {}).get("use_ocr"),
                    "stats_state": stats_state,
                    "vectors_count": vectorize.get("vectorsCount"),
                    "storage_bytes": (r2.get("payloadSizeBytes") or 0) + (r2.get("metadataSizeBytes") or 0) if r2 else None,
                    "object_count": r2.get("objectCount"),
                    "indexing": {key: stats.get(key) for key in ("completed", "queued", "running", "error", "skipped", "outdated") if key in stats},
                    "last_activity": stats.get("last_activity") or instance.get("last_activity"),
                })
            if page >= pages:
                break
            page += 1
    return instances


def write_ai_search_snapshot(d1, day, call=cf):
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    result = {"state": "unavailable", "errors": []}
    inventory = None  # None: the inventory could not be read (an unread inventory is recorded as unknown, never as zero instances)
    try:
        inventory = ai_search_inventory(call)
    except Exception as error:  # noqa: BLE001
        result["errors"].append("inventory: %s" % str(error)[:120])
    start = (day - dt.timedelta(days=29)).isoformat()
    try:
        usage = ai_search_usage_window(start, day.isoformat(), call)
        result.update(usage)
        for charge_day, amount in usage["by_day"].items():
            upsert(d1, charge_day, "ai_search:usage", "fleet", amount, 0,
                   "Cloudflare billable-usage v1 ContractedCost; account-wide AI Search charges")
        if usage["state"] == "pre-billing":
            result["state"] = "pre-billing"
        elif usage["state"] == "measured":
            result["state"] = "measured"
        else:
            result["state"] = "unmeasured"
    except Exception as error:  # noqa: BLE001
        result["errors"].append("usage: %s" % str(error)[:120])
        result["state"] = "pre-billing" if day < AI_SEARCH_BILLING_START else "unavailable"
    count = len(inventory) if inventory is not None else None
    instance_fee = 0 if count is not None and count <= 100 else None
    d1("INSERT INTO ai_search_cost_snapshots (snapshot_day, observed_at, instance_count, known_instance_fee_usd, usage_state, usage_usd, query_start, query_end, inventory_json, usage_json) "
       "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT(snapshot_day) DO UPDATE SET observed_at=excluded.observed_at, instance_count=excluded.instance_count, "
       "known_instance_fee_usd=excluded.known_instance_fee_usd, usage_state=excluded.usage_state, usage_usd=excluded.usage_usd, query_start=excluded.query_start, query_end=excluded.query_end, "
       "inventory_json=excluded.inventory_json, usage_json=excluded.usage_json",
       [day.isoformat(), now, count, instance_fee, result["state"], result.get("total_usd"), result.get("query_start"),
        result.get("query_end"), json.dumps(inventory if inventory is not None else [], separators=(",", ":")), json.dumps(result.get("details") or [], separators=(",", ":"))])
    result["instance_count"] = count
    result["known_instance_fee_usd"] = instance_fee
    result["inventory"] = inventory if inventory is not None else []
    return result


def ai_search_summary(d1, day, call=cf):
    """AI-SEARCH-COST-1 (RM-AISEARCH-GA-MIGRATE-1): the hourly run records the AI Search inventory and the account's billable AI Search usage
    (write_ai_search_snapshot had no caller, and its table no DDL, so the 2026-12-01 usage billing would have reached no cost line) and
    reports only a summary, because main prints the first 1500 characters of its result."""
    r = write_ai_search_snapshot(d1, day, call)
    return {"state": r.get("state"), "instances": r.get("instance_count"), "usage_usd": r.get("total_usd"), "errors": r.get("errors") or []}


def owner_local_window(d1, first_day):
    """COST-OWNER-SPLIT-1: {(day, provider): (usd, calls)} the owner's own gateway clients spent (qnfo-fleet-control OWNER-LOCAL-INGEST-1, untagged
    requests on the stored key, hourly). Provider names follow gateway_day(). None when the table cannot be read, so the caller labels the
    gateway rows as mixed instead of presenting the owner's spend as the fleet's."""
    try:
        rows = d1("SELECT day, lower(provider) AS provider, SUM(usd) AS usd, SUM(calls) AS calls FROM ai_spend_owner_local WHERE day >= ?1 GROUP BY day, lower(provider)", [first_day])
    except Exception:  # noqa: BLE001
        return None
    return {(r["day"], r["provider"]): (float(r["usd"] or 0), int(r["calls"] or 0)) for r in rows}


def split_gateway(by, owner):
    """One day's gateway cost per provider -> {provider: (fleet_usd, fleet_n, owner_usd, owner_n)}. The owner term is capped at the gateway
    total (its log-derived cost and GraphQL's can differ by rounding), so the two parts always add up to what the gateway measured."""
    out = {}
    for prov, (usd, n) in by.items():
        ou, on = owner.get(prov, (0.0, 0))
        ou = min(max(ou, 0.0), usd)
        on = min(max(on, 0), n)
        out[prov] = (usd - ou, n - on, ou, on)
    return out


def plan_monthly(d1, call=cf):
    st, j = call("GET", "/accounts/%s/subscriptions" % RC.ACCOUNT)
    if st == 200 and j.get("success") is not False and isinstance(j.get("result"), list):
        total, names = 0.0, []
        for s in j["result"]:
            price = float(s.get("price") or 0)
            freq = str(s.get("frequency") or "monthly").lower()
            monthly = price / 12 if freq in ("yearly", "annual") else price * 4.33 if freq == "weekly" else price
            if monthly > 0:
                total += monthly
                names.append("%s %.2f/%s" % (((s.get("rate_plan") or {}).get("public_name") or s.get("id") or "plan"), price, freq))
        return total, "subscriptions API: " + "; ".join(names)[:300]
    seeded = d1("SELECT usd FROM cost_daily WHERE source = 'cloudflare_plan' AND instr(COALESCE(note, ''), 'seeded') > 0 ORDER BY date LIMIT 1")
    base = float(seeded[0]["usd"]) if seeded else None
    return base, "seeded monthly baseline (subscriptions API answered %s: %s)" % (st, json.dumps(j.get("errors") or "")[:120])


def stated_external(d1):
    r = d1("SELECT usd FROM cost_daily WHERE source = 'direct_providers_external' ORDER BY date LIMIT 1")
    return float(r[0]["usd"]) if r else None
def task_cost_outcomes(d1, start_ts, end_ts):
    """Return exact qnfo-ops workflow job/outcome links and their logged token-cost estimates."""
    aggregate_query = (
        "WITH task_cost AS ("
        "SELECT j.id, j.status AS outcome, COUNT(l.id) AS log_rows, COUNT(l.cost_usd) AS priced_rows, "
        "SUM(CASE WHEN l.cost_usd = 0 THEN 1 ELSE 0 END) AS zero_cost_rows, "
        "SUM(CASE WHEN l.cost_usd > 0 THEN 1 ELSE 0 END) AS positive_cost_rows, SUM(l.cost_usd) AS cost_usd "
        "FROM ops_jobs j LEFT JOIN ops_ai_log l ON l.job_id = j.id AND l.strategy = 'job-workflow' "
        "WHERE j.status IN ('succeeded', 'failed') AND j.updated_at >= ?1 AND j.updated_at < ?2 "
        "GROUP BY j.id, j.status"
        ") "
        "SELECT outcome, COUNT(*) AS task_count, "
        "SUM(CASE WHEN COALESCE(c.priced_rows, 0) > 0 THEN 1 ELSE 0 END) AS cost_linked_task_count, "
        "SUM(CASE WHEN COALESCE(c.log_rows, 0) = 0 OR COALESCE(c.priced_rows, 0) = 0 THEN 1 ELSE 0 END) AS missing_cost_link_tasks, "
        "SUM(CASE WHEN COALESCE(c.zero_cost_rows, 0) > 0 THEN 1 ELSE 0 END) AS tasks_with_zero_cost_logs, "
        "SUM(CASE WHEN COALESCE(c.positive_cost_rows, 0) > 0 THEN 1 ELSE 0 END) AS tasks_with_positive_cost_estimate, "
        "SUM(CASE WHEN COALESCE(c.priced_rows, 0) > 0 THEN c.cost_usd END) AS logged_cost_usd_estimate "
        "FROM task_cost c GROUP BY outcome"
    )
    detail_query = (
        "SELECT j.id AS task_id, j.status AS outcome, COUNT(l.id) AS cost_log_rows, COUNT(l.cost_usd) AS priced_cost_rows, "
        "SUM(CASE WHEN l.cost_usd = 0 THEN 1 ELSE 0 END) AS zero_cost_rows, "
        "SUM(CASE WHEN l.cost_usd > 0 THEN 1 ELSE 0 END) AS positive_cost_rows, "
        "SUM(l.cost_usd) AS logged_cost_usd_estimate "
        "FROM ops_jobs j LEFT JOIN ops_ai_log l ON l.job_id = j.id AND l.strategy = 'job-workflow' "
        "WHERE j.status IN ('succeeded', 'failed') AND j.updated_at >= ?1 AND j.updated_at < ?2 "
        "GROUP BY j.id, j.status ORDER BY j.updated_at DESC, j.id LIMIT %d" % TASK_COST_DETAIL_LIMIT
    )
    try:
        rows = d1(aggregate_query, [start_ts, end_ts])
        details = d1(detail_query, [start_ts, end_ts])
    except Exception as error:  # noqa: BLE001
        return None, "qnfo-ops job-cost join unavailable (%s)" % type(error).__name__
    by_outcome = {
        "succeeded": {
            "task_count": 0,
            "cost_linked_task_count": 0,
            "missing_cost_link_tasks": 0,
            "tasks_with_zero_cost_logs": 0,
            "tasks_with_positive_cost_estimate": 0,
            "logged_cost_usd_estimate": None,
            "mean_logged_cost_usd_estimate_per_task_with_positive_logged_cost": None,
        },
        "failed": {
            "task_count": 0,
            "cost_linked_task_count": 0,
            "missing_cost_link_tasks": 0,
            "tasks_with_zero_cost_logs": 0,
            "tasks_with_positive_cost_estimate": 0,
            "logged_cost_usd_estimate": None,
            "mean_logged_cost_usd_estimate_per_task_with_positive_logged_cost": None,
        },
    }
    for row in rows:
        outcome = str(row.get("outcome") or "")
        if outcome not in by_outcome:
            continue
        values = by_outcome[outcome]
        values["task_count"] = int(row.get("task_count") or 0)
        values["cost_linked_task_count"] = int(row.get("cost_linked_task_count") or 0)
        values["missing_cost_link_tasks"] = int(row.get("missing_cost_link_tasks") or 0)
        values["tasks_with_zero_cost_logs"] = int(row.get("tasks_with_zero_cost_logs") or 0)
        values["tasks_with_positive_cost_estimate"] = int(row.get("tasks_with_positive_cost_estimate") or 0)
        if values["cost_linked_task_count"] > 0 and row.get("logged_cost_usd_estimate") is not None:
            values["logged_cost_usd_estimate"] = round(float(row["logged_cost_usd_estimate"]), 6)
        if values["tasks_with_positive_cost_estimate"] > 0 and values["logged_cost_usd_estimate"] is not None:
            values["mean_logged_cost_usd_estimate_per_task_with_positive_logged_cost"] = round(
                values["logged_cost_usd_estimate"] / values["tasks_with_positive_cost_estimate"], 6
            )
    task_count = sum(values["task_count"] for values in by_outcome.values())
    task_details = []
    for row in details:
        priced_rows = int(row.get("priced_cost_rows") or 0)
        zero_cost_rows = int(row.get("zero_cost_rows") or 0)
        positive_cost_rows = int(row.get("positive_cost_rows") or 0)
        estimate = row.get("logged_cost_usd_estimate")
        cost_link_status = (
            "missing" if not priced_rows else
            "unverified_zero" if not positive_cost_rows else
            "partial_unverified" if zero_cost_rows else
            "linked"
        )
        task_details.append({
            "task_id": str(row.get("task_id") or ""),
            "outcome": str(row.get("outcome") or ""),
            "cost_link_status": cost_link_status,
            "cost_log_rows": int(row.get("cost_log_rows") or 0),
            "priced_cost_rows": priced_rows,
            "zero_cost_rows": zero_cost_rows,
            "positive_cost_rows": positive_cost_rows,
            "logged_cost_usd_estimate": (
                round(float(estimate), 6) if positive_cost_rows and estimate is not None else None
            ),
        })
    return {
        "by_outcome": by_outcome,
        "task_id_outcome_sample": task_details,
        "task_id_outcome_sample_limit": TASK_COST_DETAIL_LIMIT,
        "task_id_outcome_sample_truncated": task_count > len(task_details),
    }, None


def upsert(d1, date, source, scope, usd, reqs, note):
    d1("INSERT INTO cost_daily (date, source, scope, usd, requests, note, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) "
       "ON CONFLICT(date, source) DO UPDATE SET usd = excluded.usd, requests = excluded.requests, note = excluded.note, scope = excluded.scope, updated_at = excluded.updated_at",
       [date, source, scope, round(usd, 4), int(reqs), note[:300]])


def write_forecast(d1):
    """COST-SUSTAIN-1 (2026-10-21): month-to-date, 3-day pace and month-end forecast per scope from v_cost_forecast; writes
    fleet_cost_pace_30d_usd / fleet_cost_forecast_month_usd (metric_registry) and fleet_budget cost:fleet_all_in_month.current.
    PRECONDITION: cost_daily rows for today were just upserted. POSTCONDITION: the two metrics carry the fleet scope's values, or
    the error is returned and nothing is written (never a fabricated zero)."""
    try:
        rows = d1("SELECT * FROM v_cost_forecast")
    except Exception as e:  # noqa: BLE001
        return "v_cost_forecast missing: %s" % str(e)[:80]
    by = {r["scope"]: r for r in rows}
    f = by.get("fleet")
    if not f:
        return {"scopes": by, "error": "no fleet rows"}
    stamp = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"
    for metric, val in (("fleet_cost_pace_30d_usd", f["pace_30d_usd"]), ("fleet_cost_forecast_month_usd", f["forecast_month_usd"])):
        d1("UPDATE metric_registry SET last_value = CAST(?1 AS TEXT), last_refreshed = " + stamp + ", state = 'MEASURED' WHERE metric = ?2", [val, metric])
    d1("UPDATE fleet_budget SET current = ?1, updated_at = " + stamp + " WHERE node_class = 'cost:fleet_all_in_month'", [f["pace_30d_usd"]])
    # COST-SUSTAIN-3: the cap-aware bound (what the configured daily caps allow) and the bounded month-end forecast. A view without
    # the columns (migration not applied yet) leaves the metric untouched rather than writing a fabricated value.
    if f.get("bound_30d_usd") is not None:
        d1("UPDATE metric_registry SET last_value = CAST(?1 AS TEXT), last_refreshed = " + stamp + ", state = 'MEASURED' WHERE metric = 'fleet_cost_bound_month_usd'", [f["bound_30d_usd"]])
    return {k: {"mtd": v.get("mtd_complete_usd"), "pace_30d": v.get("pace_30d_usd"), "forecast_month": v.get("forecast_month_usd"),
                "forecast_bounded_month": v.get("forecast_bounded_month_usd"), "bound_30d": v.get("bound_30d_usd")} for k, v in by.items()}


def write_unit_cost(d1):
    """COST-SUSTAIN-3: research neurons per published version over the 7 complete UTC days before today. POSTCONDITION: the metric
    carries the ratio, or nothing is written when no version was published (a ratio over zero is not a measurement)."""
    try:
        r = d1("SELECT (SELECT COALESCE(SUM(neurons), 0) FROM ai_call_counters WHERE worker IN ('qnfo-research-exec', 'errata-hub', 'qnfo-paper-reviser') "
               "AND day >= date('now', '-7 days') AND day < date('now')) AS n, (SELECT COUNT(*) FROM research_queue WHERE published_at >= date('now', '-7 days') "
               "AND published_at < date('now')) AS pubs")
    except Exception as e:  # noqa: BLE001
        return "unit cost unreadable: %s" % str(e)[:80]
    n, pubs = float(r[0]["n"] or 0), int(r[0]["pubs"] or 0)
    if pubs <= 0:
        return {"neurons_7d": n, "publications_7d": 0, "written": False}
    val = round(n / pubs, 1)
    d1("UPDATE metric_registry SET last_value = CAST(?1 AS TEXT), last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED' WHERE metric = 'research_neurons_per_publication_7d'", [val])
    return {"neurons_7d": n, "publications_7d": pubs, "per_publication": val}


def write_paper_yield(d1):
    """PAPER-YIELD-1 (agent_issues 1000778, owner request "Yield: papers published per $100"): published versions per $100 of all-billing
    spend over the 7 complete UTC days before today, the same window and the same published count as research_neurons_per_publication_7d, so
    the two can be read together (yield up while the unit cost falls is the push and the trim of the card). Spend is the v_cost_run_rate
    total:all-billing daily mean x 7 (Cloudflare plan, AI Gateway, owner gateway, owner-stated providers). POSTCONDITION: the metric carries
    the ratio (0 when nothing was published but money was spent), or nothing is written when the spend is unknown (a ratio over no spend is not a measurement)."""
    try:
        r = d1("SELECT (SELECT COUNT(*) FROM research_queue WHERE published_at >= date('now', '-7 days') AND published_at < date('now')) AS pubs, "
               "(SELECT daily_7d FROM v_cost_run_rate WHERE source_group = 'total:all-billing') AS daily")
    except Exception as e:  # noqa: BLE001
        return "paper yield unreadable: %s" % str(e)[:80]
    pubs, daily = int(r[0]["pubs"] or 0), float(r[0]["daily"] or 0)
    if daily <= 0:
        return {"publications_7d": pubs, "usd_7d": 0.0, "written": False}
    usd = daily * 7.0
    val = round(100.0 * pubs / usd, 3)
    d1("UPDATE metric_registry SET last_value = CAST(?1 AS TEXT), last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED' WHERE metric = 'papers_per_100usd_7d'", [val])
    return {"publications_7d": pubs, "usd_7d": round(usd, 2), "per_100usd": val}


def billed_gateway(d1, call=cf):
    """COST-SUSTAIN-3: the provider-billed AI Gateway figure for the current period (invoice-preview; amounts are CENTS, AI-GW-COST-UNIT-
    CENTS-1). Billed = amount_due + every pretax credit applied (the credit balance pays most of it). POSTCONDITION: metric written, or the
    refusal returned and nothing written."""
    st, j = call("GET", "/accounts/%s/ai-gateway/billing/invoice-preview" % RC.ACCOUNT)
    res = j.get("result") if isinstance(j, dict) else None
    if not (200 <= (st or 0) < 300) or not isinstance(res, dict):
        return "invoice-preview answered %s" % st
    cents = 0
    for ln in res.get("invoice_lines") or []:
        cents += int(ln.get("amount") or 0)
    usd = round(cents / 100.0, 2)
    d1("UPDATE metric_registry SET last_value = CAST(?1 AS TEXT), last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED' WHERE metric = 'billed_ai_gateway_mtd_usd'", [usd])
    return {"billed_usd": usd, "lines": len(res.get("invoice_lines") or []), "period_start": res.get("period_start")}


def cost_reconciliation(d1, call=cf, today=None, plan_monthly_usd=None, plan_basis="", external_monthly_usd=None):
    """Build a disjoint 30-day total from billed sources, and report secondary ledgers as checks.

    Unified/BYOK are a split of gateway usage, not extra costs. Account-wide
    Workers AI includes router binding calls, so those are excluded from direct
    provider ledger costs. cost_daily is a shorter rolling ledger, not the 30-day
    source of truth.
    """
    today = today or dt.datetime.now(dt.timezone.utc).date()
    start = (today - dt.timedelta(days=29)).isoformat()
    end = today.isoformat()
    start_ts = start + "T00:00:00Z"
    now = dt.datetime.now(dt.timezone.utc)
    end_ts = (
        now.strftime("%Y-%m-%dT%H:%M:%SZ")
        if now.date() == today else (today + dt.timedelta(days=1)).isoformat() + "T00:00:00Z"
    )
    source_errors = []
    workers = None
    gateway_by_provider = None
    gateway_group_count = None
    try:
        workers = workers_ai_window(start_ts, end_ts, 30, call)
    except Exception as error:  # noqa: BLE001
        source_errors.append("Workers AI GraphQL unavailable (%s)" % type(error).__name__)
    try:
        gateway_by_provider, gateway_group_count = gateway_window(start_ts, end_ts, call)
    except Exception as error:  # noqa: BLE001
        source_errors.append("AI Gateway GraphQL unavailable (%s)" % type(error).__name__)
    if workers is not None and workers[4] >= 1000:
        source_errors.append("Workers AI response reached the 1000-group query limit")
    if gateway_group_count is not None and gateway_group_count >= 2000:
        source_errors.append("AI Gateway response reached the 2000-group query limit")

    direct_rows = d1(
        "SELECT day, provider, SUM(usd) AS usd, SUM(calls) AS calls FROM ai_spend_ledger "
        "WHERE day >= ?1 AND day <= ?2 AND lower(provider) NOT IN ('workers-ai', 'workers_ai', 'gateway') GROUP BY day, provider",
        [start, end],
    )
    meta_rows = d1("SELECT key, value FROM analytics_dash_meta WHERE key IN ('unified_cost_usd_30d', 'byok_cost_usd_30d', 'last_refresh')")
    metrics = d1(
        "SELECT metric, last_value, last_refreshed, formula, source_of_truth FROM metric_registry "
        "WHERE metric IN ('cost_usd_30d', 'ai_est_cost_30d', 'cost_per_successful_task_by_class')"
    )
    direct_by_provider = {}
    direct_calls_by_provider = {}
    for row in direct_rows:
        provider = provider_label(row.get("provider"))
        direct_by_provider[provider] = round(direct_by_provider.get(provider, 0.0) + float(row.get("usd") or 0), 4)
        direct_calls_by_provider[provider] = direct_calls_by_provider.get(provider, 0) + int(row.get("calls") or 0)
    direct_days = sorted({str(row.get("day")) for row in direct_rows if row.get("day")})

    meta = {str(row.get("key")): row.get("value") for row in meta_rows}

    def numeric(value):
        try:
            n = float(value)
            return n if isfinite(n) else None
        except (TypeError, ValueError):
            return None

    unified = numeric(meta.get("unified_cost_usd_30d"))
    byok = numeric(meta.get("byok_cost_usd_30d"))
    gateway_payment_total = unified + byok if unified is not None and byok is not None else None
    gateway_total = round(sum(amount for amount, _ in gateway_by_provider.values()), 4) if gateway_by_provider is not None else None
    gateway_delta = round(gateway_total - gateway_payment_total, 4) if gateway_total is not None and gateway_payment_total is not None else None
    worker_usd, worker_requests, worker_neurons, worker_days, worker_group_count, worker_billable_neurons = (
        workers if workers is not None else (None, None, None, None, None, None)
    )
    direct_total = round(sum(direct_by_provider.values()), 4)
    plan = numeric(plan_monthly_usd)
    external_unverified = numeric(external_monthly_usd)
    if plan is None:
        source_errors.append("Cloudflare plan amount is not measurable")
    if external_unverified is None:
        source_errors.append("owner-stated external-provider amount is unavailable")

    try:
        daily_coverage = d1(
            "SELECT COUNT(DISTINCT date) AS days, MIN(date) AS first_day, MAX(date) AS last_day "
            "FROM cost_daily WHERE date >= ?1 AND date <= ?2",
            [start, end],
        )[0]
    except Exception as error:  # noqa: BLE001
        daily_coverage = None
        source_errors.append("cost_daily coverage unavailable (%s)" % type(error).__name__)

    if unified is None or byok is None:
        source_errors.append("analytics_dash_meta unified/BYOK split is unavailable")
    if gateway_delta is not None and gateway_delta != 0:
        source_errors.append("AI Gateway GraphQL differs from the unified/BYOK cross-check")
    if workers is None:
        source_errors.append("Workers AI source total is unavailable")
    if gateway_by_provider is None:
        source_errors.append("AI Gateway source total is unavailable")
    if plan_basis and "seeded" in plan_basis.lower():
        source_errors.append("Cloudflare plan uses a seeded monthly baseline")
    if external_unverified and external_unverified > 0:
        source_errors.append("owner-stated external-provider cost is unverified")

    metric_by_name = {str(row.get("metric")): row for row in metrics}
    task = metric_by_name.get("cost_per_successful_task_by_class")
    successful_call_metric = {
        "metric": "cost_per_successful_task_by_class",
        "value_usd": numeric(task.get("last_value")) if task else None,
        "last_refreshed": task.get("last_refreshed") if task else None,
        "scope": "successful qnfo-ops model-ladder calls, not all fleet tasks",
    }
    task_coverage, task_outcome_error = task_cost_outcomes(d1, start_ts, end_ts)
    if task_outcome_error:
        source_errors.append(task_outcome_error)
    task_outcomes = task_coverage["by_outcome"] if task_coverage else None
    workers_gateway = None
    if worker_usd is not None and gateway_total is not None:
        workers_gateway = round(worker_usd + gateway_total, 4)
    plan_is_unverified = plan is not None and "seeded" in plan_basis.lower()
    measured_subtotal = (
        round(workers_gateway + direct_total + (plan if not plan_is_unverified else 0.0), 4)
        if workers_gateway is not None else None
    )
    all_billing_including_unverified = (
        round(measured_subtotal + (plan if plan_is_unverified else 0.0) + external_unverified, 4)
        if measured_subtotal is not None and plan is not None and external_unverified is not None else None
    )
    metric_cross_checks = {}
    for name in ("cost_usd_30d", "ai_est_cost_30d"):
        metric = metric_by_name.get(name)
        metric_value = numeric(metric.get("last_value")) if metric else None
        comparison_total = (
            round(workers_gateway + direct_total, 4)
            if name == "cost_usd_30d" and workers_gateway is not None else workers_gateway
        )
        metric_cross_checks[name] = {
            "metric": name,
            "value_usd": metric_value,
            "last_refreshed": metric.get("last_refreshed") if metric else None,
            "comparison_basis": "measured Workers AI + AI Gateway + direct provider ledger" if name == "cost_usd_30d" else "measured Workers AI + AI Gateway",
            "difference_from_measured_sources_usd": (
                round(metric_value - comparison_total, 4)
                if metric_value is not None and comparison_total is not None else None
            ),
            "included_in_total": False,
        }

    return {
        "window_start": start,
        "window_end": end,
        "window_days": 30,
        "window_start_at": start_ts,
        "window_end_exclusive_at": end_ts,
        "window_basis": (
            "29 complete UTC dates plus the current UTC date through snapshot time"
            if now.date() == today else "30 UTC calendar dates through the supplied snapshot boundary"
        ),
        "snapshot_at": end_ts,
        "billing_status": "partial" if source_errors else "reconciled",
        "source_errors": source_errors,
        "components_usd": {
            "workers_ai_account_wide": round(worker_usd, 4) if worker_usd is not None else None,
            "ai_gateway_all_clients": gateway_total,
            "ai_gateway_payment_split": {
                "unified": unified,
                "byok": byok,
                "reported_at": meta.get("last_refresh"),
                "gateway_usage_total": gateway_total,
                "difference_usd": gateway_delta,
                "included_in_gateway_usage_total": True,
            },
            "direct_providers_metered": direct_total,
            "cloudflare_plan_monthly_equivalent": plan,
            "direct_providers_owner_stated_unverified_monthly": external_unverified,
        },
        "workers_ai_meter": {
            "requests": worker_requests,
            "neurons": worker_neurons,
            "billable_neurons_after_daily_free_allowance": worker_billable_neurons,
            "daily_free_allowance_days": worker_days,
            "group_count": worker_group_count,
        },
        "ai_gateway_group_count": gateway_group_count,
        "ai_gateway_usd_by_provider": {
            provider: round(amount, 4) for provider, (amount, _) in (gateway_by_provider or {}).items()
        },
        "ai_gateway_requests_by_provider": {
            provider: requests for provider, (_, requests) in (gateway_by_provider or {}).items()
        },
        "direct_provider_usd_by_provider": direct_by_provider,
        "direct_provider_calls_by_provider": direct_calls_by_provider,
        "measured_source_subtotal_usd": measured_subtotal,
        "direct_provider_ledger_entries": len(direct_rows),
        "direct_provider_ledger_coverage": {
            "days_with_entries": len(direct_days),
            "first_day": direct_days[0] if direct_days else None,
            "last_day": direct_days[-1] if direct_days else None,
        },
        "all_billing_including_unverified_usd": all_billing_including_unverified,
        "daily_ledger_coverage": daily_coverage,
        "cost_metric_cross_checks": metric_cross_checks,
        "plan_basis": plan_basis if plan_basis in ("subscriptions API", "seeded monthly baseline", "unavailable") else "unverified source",
        "task_cost_coverage": {
            "status": "partial",
            "source": "qnfo-audit.ops_jobs.status joined to ops_ai_log.job_id",
            "log_filter": "ops_ai_log.strategy = 'job-workflow'; unassociated and other-strategy calls are not inferred or included",
            "window_start_at": start_ts,
            "window_end_exclusive_at": end_ts,
            "scope": "terminal qnfo-ops asynchronous workflow jobs only; not all fleet tasks",
            "included_in_billing_total": False,
            "cost_basis": (
                "logged qnfo-ops model token-price estimates from ops_ai_log.cost_usd; "
                "not provider invoice charges; qnfo-ops can log zero when upstream token usage is absent, "
                "so zero-cost rows are unverified rather than evidence of zero spend"
            ),
            "successful_call_metric": successful_call_metric,
            "by_outcome": task_outcomes,
            "task_id_outcome_sample": task_coverage["task_id_outcome_sample"] if task_coverage else None,
            "task_id_outcome_sample_limit": TASK_COST_DETAIL_LIMIT,
            "task_id_outcome_sample_truncated": task_coverage["task_id_outcome_sample_truncated"] if task_coverage else None,
            "failed_task_cost_usd": None,
            "failed_task_cost_usd_estimate": (
                task_outcomes["failed"]["logged_cost_usd_estimate"]
                if task_outcomes and task_outcomes["failed"]["tasks_with_positive_cost_estimate"] > 0 else None
            ),
            "successful_task_cost_usd_estimate": (
                task_outcomes["succeeded"]["logged_cost_usd_estimate"]
                if task_outcomes and task_outcomes["succeeded"]["tasks_with_positive_cost_estimate"] > 0 else None
            ),
            "reason": (
                task_outcome_error or
                "Exact task IDs and final outcomes are joined for qnfo-ops workflow jobs; unlinked task cost remains unknown and other workers' ledgers remain aggregate."
            ),
        },
    }


def write_cost_reconciliation(d1, today=None, call=cf, plan_monthly_usd=None, plan_basis="", external_monthly_usd=None):
    snapshot = cost_reconciliation(
        d1, call=call, today=today, plan_monthly_usd=plan_monthly_usd,
        plan_basis=plan_basis, external_monthly_usd=external_monthly_usd,
    )
    event_day = snapshot["window_end"]
    event_id = "cost-reconciliation-" + event_day
    status = "ok" if snapshot["billing_status"] == "reconciled" and snapshot["task_cost_coverage"]["status"] == "complete" else "partial"
    text = "30-day cost reconciliation " + status + ": " + str(len(snapshot["source_errors"])) + " billing/source gaps; failed-task cost attribution remains unmeasured"
    d1(
        "INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) "
        "VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'cost-reconciliation', ?2, ?3, 'cost-ledger', ?4) "
        "ON CONFLICT(id) DO UPDATE SET ts=excluded.ts, text=excluded.text, meta=excluded.meta, status=excluded.status",
        [event_id, text[:500], json.dumps(snapshot, separators=(",", ":")), status],
    )
    return snapshot


def main(d1=None, call=cf, today=None):
    d1 = d1 or RC.d1
    today = today or dt.datetime.now(dt.timezone.utc).date()
    days = [today - dt.timedelta(days=k) for k in range(LOOKBACK_DAYS, -1, -1)]
    out = {"cost_ledger": "ok", "days": len(days), "errors": []}
    try:
        plan_m, plan_note = plan_monthly(d1, call)
    except Exception as e:  # noqa: BLE001
        plan_m, plan_note = None, "plan read failed: %s" % str(e)[:120]
        out["errors"].append(plan_note)
    try:
        ext_m = stated_external(d1)
    except Exception as e:  # noqa: BLE001
        ext_m = None
        out["errors"].append("owner-stated external-provider amount unreadable: %s" % str(e)[:120])
    owner = owner_local_window(d1, days[0].isoformat())
    if owner is None:
        out["errors"].append("ai_spend_owner_local unreadable: gateway rows keep the owner term (scope fleet+owner-clients)")
    have_meter = meter_days_present(d1)
    t_loop = time.monotonic()
    for n_done, day in enumerate(reversed(days)):
        if n_done > 0 and time.monotonic() - t_loop > LEDGER_DAY_BUDGET_S:
            out["errors"].append("day loop stopped after %ds with %d of %d days written; the next run continues with the older days" % (LEDGER_DAY_BUDGET_S, n_done, len(days)))
            out["days_written"] = n_done
            break
        ds = day.isoformat()
        try:
            usd, reqs, neurons, models = workers_ai_day_models(day, call)
            upsert(d1, ds, "workers_ai", "fleet", usd, reqs, "GraphQL aiInferenceAdaptiveGroups: %d neurons, 10k/day free, $0.011/1k" % neurons)
            try:
                if ds not in have_meter or day >= today - dt.timedelta(days=METER_REFRESH_DAYS):
                    write_model_meter(d1, ds, models)
            except Exception as e2:  # noqa: BLE001
                out["errors"].append("ai_meter_model_daily %s: %s" % (ds, str(e2)[:100]))
        except Exception as e:  # noqa: BLE001
            out["errors"].append("workers_ai %s: %s" % (ds, str(e)[:100]))
        try:
            by = gateway_day(day, call)
            # owner term unreadable: keep the whole gateway cost, labelled as mixed (the fm-cost-metric-includes-owner-spend detector sees it)
            scope = "fleet" if owner is not None else "fleet+owner-clients"
            note = "GraphQL aiGatewayRequestsAdaptiveGroups sum.cost (unified credit or BYOK)" + (" less the owner-local term (COST-OWNER-SPLIT-1)" if owner is not None else "; ai_spend_owner_local unreadable, owner term not split")
            for prov, (fu, fn, ou, on) in split_gateway(by, {k[1]: v for k, v in (owner or {}).items() if k[0] == ds}).items():
                upsert(d1, ds, "ai_gateway:" + prov, scope, fu, fn, note)
                if ou > 0:
                    upsert(d1, ds, "owner_gateway:" + prov, "owner-clients", ou, on, "ai_spend_owner_local (untagged owner clients on the stored key), at most the gateway day total %.4f" % by[prov][0])
        except Exception as e:  # noqa: BLE001
            out["errors"].append("gateway %s: %s" % (ds, str(e)[:100]))
        if plan_m is not None and plan_m > 0:
            upsert(d1, ds, "cloudflare_plan:daily", "fleet", plan_m / 30.0, 0, "monthly %.2f / 30; %s" % (plan_m, plan_note))
        if ext_m is not None and ext_m > 0:
            upsert(d1, ds, "direct_providers_external:daily", "owner-direct", ext_m / 30.0, 0, "owner-stated monthly %.2f / 30 (unverified; no API sees it)" % ext_m)
    try:
        rr = d1("SELECT source_group, run_rate_30d_7d, run_rate_30d_10d FROM v_cost_run_rate ORDER BY run_rate_30d_7d DESC")
        out["run_rate"] = {r["source_group"]: [r["run_rate_30d_7d"], r["run_rate_30d_10d"]] for r in rr}
    except Exception as e:  # noqa: BLE001
        out["run_rate"] = "view missing: %s" % str(e)[:80]
    out["forecast"] = write_forecast(d1)
    for k, fn in (("unit_cost", lambda: write_unit_cost(d1)), ("paper_yield", lambda: write_paper_yield(d1)), ("billed", lambda: billed_gateway(d1, call)),
                  ("ai_search", lambda: ai_search_summary(d1, today, call))):
        try:
            out[k] = fn()
        except Exception as e:  # noqa: BLE001
            out["errors"].append("%s: %s" % (k, str(e)[:100]))
    for e in (out.get("ai_search") or {}).get("errors") or []:
        out["errors"].append("ai_search " + str(e)[:100])
    try:
        plan_basis = (
            "unavailable" if plan_m is None else
            "seeded monthly baseline" if "seeded" in plan_note.lower() else
            "subscriptions API" if plan_note.lower().startswith("subscriptions api") else
            "unverified source"
        )
        out["reconciliation"] = write_cost_reconciliation(
            d1, today, call, plan_m, plan_basis, ext_m
        )
    except Exception as e:  # noqa: BLE001
        out["errors"].append("cost reconciliation: %s" % str(e)[:120])
    print(json.dumps(out)[:1500])
    return 0


def selftest():
    c = sqlite3.connect(":memory:")
    c.executescript("""CREATE TABLE cost_daily (date TEXT NOT NULL, source TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'fleet', usd REAL NOT NULL DEFAULT 0,
      requests INTEGER DEFAULT 0, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, note TEXT, updated_at TEXT, PRIMARY KEY (date, source));
      INSERT INTO cost_daily (date, source, usd, note) VALUES ('2026-09-26', 'cloudflare_plan', 200, 'monthly baseline (seeded)'), ('2026-09-26', 'direct_providers_external', 450, 'user-stated');
      CREATE TABLE ops_jobs (id TEXT PRIMARY KEY, status TEXT, updated_at TEXT);
      CREATE TABLE ops_ai_log (id TEXT PRIMARY KEY, ts TEXT, strategy TEXT, job_id TEXT, cost_usd REAL);
      CREATE TABLE ai_spend_ledger (day TEXT, provider TEXT, calls INTEGER, usd REAL);
      CREATE TABLE analytics_dash_meta (key TEXT, value TEXT);
      INSERT INTO analytics_dash_meta VALUES ('unified_cost_usd_30d','50'),('byok_cost_usd_30d','48.7766'),('last_refresh','2026-10-09T23:00:00Z');
      CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
      CREATE TABLE ai_spend_owner_local (day TEXT NOT NULL, gateway TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER DEFAULT 0,
      in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, usd REAL DEFAULT 0, PRIMARY KEY (day, gateway, provider, model));
      INSERT INTO ai_spend_owner_local (day, gateway, provider, model, calls, usd) VALUES
        ('2026-10-09', 'gw', 'anthropic', 'claude-opus-5.5', 1140, 97.026573), ('2026-10-09', 'gw', 'openai', 'gpt-5.5', 2, 0.2),
        ('2026-10-09', 'gw', 'mistral', 'large', 4, 3.0);
      CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT,
        formula TEXT, source_of_truth TEXT);
      CREATE TABLE ai_meter_model_daily (date TEXT NOT NULL, model TEXT NOT NULL, neurons REAL NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, observed_at TEXT, PRIMARY KEY (date, model));
      CREATE TABLE ai_search_cost_snapshots (snapshot_day TEXT PRIMARY KEY, observed_at TEXT, instance_count INTEGER, known_instance_fee_usd REAL,
        usage_state TEXT, usage_usd REAL, query_start TEXT, query_end TEXT, inventory_json TEXT, usage_json TEXT);""")

    def d1(sql, params=None):
        sql = sql.replace("strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", "'now'")
        cur = c.execute(sql, params or [])
        cols = [x[0] for x in cur.description] if cur.description else []
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    def call(method, path, body=None, timeout=30):
        if path.endswith("/subscriptions"):
            return 403, {"success": False, "errors": [{"code": 10000, "message": "Authentication error"}]}
        if path.endswith("/invoice-preview"):
            return 200, {"result": {"invoice_lines": []}}
        if "/billable-usage/info" in path:
            return 200, {"success": True, "result": {"subscriptions": [{"billing_cycle_anchor_timestamp": "2026-10-01T00:00:00Z"}]}}
        if "/billable-usage?" in path:
            return 200, {"success": True, "result": [
                {"ServiceFamilyName": "AI Search", "ServiceName": "AI Search", "ChargeDescription": "Semantic queries", "ChargePeriodStart": "2026-10-08T00:00:00Z",
                 "ContractedCost": "0.42", "ConsumedQuantity": 560, "ConsumedUnit": "queries"},
                {"ServiceFamilyName": "Workers", "ServiceName": "Workers", "ChargeDescription": "Requests", "ChargePeriodStart": "2026-10-08T00:00:00Z", "ContractedCost": "9.99"}]}
        if "/ai-search/namespaces/" in path and path.endswith("/stats"):
            return 200, {"success": True, "result": {"completed": 7, "engine": {"vectorize": {"vectorsCount": 1200}, "r2": {"payloadSizeBytes": 100, "metadataSizeBytes": 5, "objectCount": 7}}}}
        if "/ai-search/namespaces/" in path:
            return 200, {"success": True, "result": [{"id": "qnfo-corpus", "engine_version": 3, "hybrid_search_enabled": True,
                                                      "embedding_model": "@cf/qwen/qwen3-embedding-0.6b", "reranking": False}], "result_info": {"total_pages": 1}}
        if "/ai-search/namespaces" in path:
            return 200, {"success": True, "result": [{"name": "default"}], "result_info": {"total_pages": 1}}
        q = body["query"]
        if "aiInferenceAdaptiveGroups" in q:
            if "dimensions { date }" in q:
                return 200, {"data": {"viewer": {"accounts": [{"aiInferenceAdaptiveGroups": [
                    {"count": 100, "sum": {"totalNeurons": 210000}, "dimensions": {"date": "2026-10-09"}}
                ]}]}}}
            if "dimensions { modelId }" in q:
                return 200, {"data": {"viewer": {"accounts": [{"aiInferenceAdaptiveGroups": [
                    {"count": 60, "sum": {"totalNeurons": 150000, "totalInputTokens": 9000000, "totalOutputTokens": 90000}, "dimensions": {"modelId": "@cf/deepseek-ai/deepseek-v4.1-flash-1017"}},
                    {"count": 30, "sum": {"totalNeurons": 40000, "totalInputTokens": 700000, "totalOutputTokens": 70000}, "dimensions": {"modelId": "@cf/openai/gpt-oss-120b"}},
                    {"count": 10, "sum": {"totalNeurons": 20000, "totalInputTokens": 100000, "totalOutputTokens": 50000}, "dimensions": {"modelId": "@cf/openai/gpt-oss-120b"}}]}]}}}
            return 200, {"data": {"viewer": {"accounts": [{"aiInferenceAdaptiveGroups": [{"count": 100, "sum": {"totalNeurons": 210000}}]}]}}}
        return 200, {"data": {"viewer": {"accounts": [{"aiGatewayRequestsAdaptiveGroups": [
            {"count": 3, "sum": {"cost": 0.5}, "dimensions": {"provider": "openai", "model": "gpt-5.5"}},
            {"count": 2, "sum": {"cost": 0.25}, "dimensions": {"provider": "compat", "model": "deepseek/deepseek-flash"}},
            {"count": 1141, "sum": {"cost": 97.0266}, "dimensions": {"provider": "anthropic", "model": "claude-opus-5.5"}},
            {"count": 1, "sum": {"cost": 1.0}, "dimensions": {"provider": "mistral", "model": "large"}},
            {"count": 9, "sum": {"cost": 9.0}, "dimensions": {"provider": "workers-ai", "model": "x"}}]}]}}}

    assert main(d1, call, dt.date(2026, 10, 9)) == 0
    rows = {(r["date"], r["source"]): r["usd"] for r in d1("SELECT date, source, usd FROM cost_daily")}
    assert abs(rows[("2026-10-09", "workers_ai")] - 2.2) < 1e-9, rows  # (210000 - 10000) / 1000 * 0.011
    assert rows[("2026-10-09", "ai_gateway:deepseek")] == 0.25  # no owner term: the whole gateway cost is the fleet's
    assert ("2026-10-09", "ai_gateway:workers-ai") not in rows  # neuron-billed, never double counted
    assert abs(rows[("2026-10-09", "cloudflare_plan:daily")] - 200 / 30) < 1e-3 and abs(rows[("2026-10-09", "direct_providers_external:daily")] - 15) < 1e-9
    assert len([k for k in rows if k[1] == "workers_ai"]) == 11  # 10 complete days plus today
    # AI-SEARCH-COST-1: the run records the AI Search inventory and the account's billable AI Search usage; the usage is a cost_daily line of its own
    # (v_cost_lines_month reads it as cloudflare / ai_search / invoice), and an inventory that could not be read is NULL, never zero instances
    snap = d1("SELECT * FROM ai_search_cost_snapshots")
    assert len(snap) == 1 and snap[0]["snapshot_day"] == "2026-10-09" and snap[0]["instance_count"] == 1 and snap[0]["usage_state"] == "measured", snap
    assert abs(snap[0]["usage_usd"] - 0.42) < 1e-9 and snap[0]["known_instance_fee_usd"] == 0 and "qnfo-corpus" in snap[0]["inventory_json"], snap
    assert abs(rows[("2026-10-08", "ai_search:usage")] - 0.42) < 1e-9 and not [k for k in rows if k[1] == "ai_search:usage" and k[0] != "2026-10-08"], rows
    assert not [k for k in rows if k[1].startswith("ai_search") and abs(rows[k] - 9.99) < 1e-9], "only AI Search lines of the billing report are kept"

    def no_ai_search(method, path, body=None, timeout=30):
        if "/ai-search/" in path:
            return 403, {"success": False, "errors": [{"message": "test refusal"}]}
        return call(method, path, body, timeout)
    d1("DELETE FROM ai_search_cost_snapshots")
    unread = ai_search_summary(d1, dt.date(2026, 10, 9), no_ai_search)
    snap = d1("SELECT * FROM ai_search_cost_snapshots")
    assert snap[0]["instance_count"] is None and snap[0]["known_instance_fee_usd"] is None and snap[0]["inventory_json"] == "[]", snap
    assert unread["instances"] is None and unread["errors"] and unread["errors"][0].startswith("inventory:"), unread
    assert snap[0]["usage_state"] == "measured", "the usage report is independent of the inventory"
    assert ai_search_summary(d1, dt.date(2026, 10, 9), call)["instances"] == 1 and len(d1("SELECT * FROM ai_search_cost_snapshots")) == 1, "a read run replaces the unknown row"
    # AI-METER-MODEL-1: the per-model meter sums to the day's total, merges a model that GraphQL returns in two groups, and is idempotent
    mm = {(r["date"], r["model"]): r for r in d1("SELECT * FROM ai_meter_model_daily")}
    assert len(mm) == 22 and abs(mm[("2026-10-09", "@cf/openai/gpt-oss-120b")]["neurons"] - 60000) < 1e-6 and mm[("2026-10-09", "@cf/openai/gpt-oss-120b")]["requests"] == 40, mm
    assert abs(sum(v["neurons"] for k, v in mm.items() if k[0] == "2026-10-09") - 210000) < 1e-6, mm
    assert mm[("2026-10-09", "@cf/deepseek-ai/deepseek-v4.1-flash-1017")]["input_tokens"] == 9000000, mm
    d1("INSERT INTO ai_meter_model_daily (date, model, neurons) VALUES ('2026-10-09', '@cf/gone/model', 5)")
    assert main(d1, call, dt.date(2026, 10, 9)) == 0 and not d1("SELECT 1 FROM ai_meter_model_daily WHERE model = '@cf/gone/model'") and len(d1("SELECT * FROM ai_meter_model_daily")) == 22
    # LEDGER-FAST-1: (a) 30 models are written in 3 multi-row upserts plus one delete, each under 100 bound parameters, and a re-run is idempotent;
    # (b) a day with rows that is older than METER_REFRESH_DAYS is not rewritten; (c) the day loop runs newest first and stops at its budget while the
    # tail of the run still executes.
    seen_stmts = []

    def counting_d1(sql, params=None):
        seen_stmts.append((sql, len(params or [])))
        return d1(sql, params)

    many = [("@cf/test/m%02d" % i, float(i + 1), i + 1, 10 * i, i) for i in range(30)]
    write_model_meter(counting_d1, "2026-09-01", many)
    assert len(seen_stmts) == 4 and all(n <= 100 for _, n in seen_stmts), seen_stmts
    assert seen_stmts[0][0].startswith("INSERT INTO ai_meter_model_daily") and seen_stmts[-1][0].startswith("DELETE FROM ai_meter_model_daily"), seen_stmts
    assert d1("SELECT COUNT(*) AS n, SUM(neurons) AS s FROM ai_meter_model_daily WHERE date = '2026-09-01'") == [{"n": 30, "s": float(sum(range(1, 31)))}]
    write_model_meter(d1, "2026-09-01", many)
    assert d1("SELECT COUNT(*) AS n FROM ai_meter_model_daily WHERE date = '2026-09-01'") == [{"n": 30}]
    d1("UPDATE ai_meter_model_daily SET neurons = 12345 WHERE date = '2026-10-01'")
    assert main(d1, call, dt.date(2026, 10, 9)) == 0
    assert d1("SELECT MAX(neurons) AS m FROM ai_meter_model_daily WHERE date = '2026-10-01'")[0]["m"] == 12345, "a final meter day is not rewritten"
    assert d1("SELECT MAX(neurons) AS m FROM ai_meter_model_daily WHERE date = '2026-10-09'")[0]["m"] == 150000, "today is rewritten"
    assert meter_days_present(d1) >= {"2026-09-01", "2026-10-01", "2026-10-09"}
    d1("DELETE FROM cost_daily WHERE source = 'workers_ai'")
    import contextlib
    import io
    global LEDGER_DAY_BUDGET_S
    keep_budget, LEDGER_DAY_BUDGET_S = LEDGER_DAY_BUDGET_S, -1.0
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            assert main(d1, call, dt.date(2026, 10, 9)) == 0
    finally:
        LEDGER_DAY_BUDGET_S = keep_budget
    assert [r["date"] for r in d1("SELECT date FROM cost_daily WHERE source = 'workers_ai'")] == ["2026-10-09"], "newest day first, then the budget stop"
    assert "day loop stopped after" in buf.getvalue() and '"reconciliation"' in buf.getvalue(), "the tail of the run still ran"
    assert main(d1, call, dt.date(2026, 10, 9)) == 0 and len(d1("SELECT date FROM cost_daily WHERE source = 'workers_ai'")) == 11
    d1("DELETE FROM ai_meter_model_daily WHERE date = '2026-09-01'")
    c.execute("DROP TABLE ai_meter_model_daily")
    out_missing = {"errors": []}
    try:
        write_model_meter(d1, "2026-10-09", [("m", 1.0, 1, 1, 1)])
        raise SystemExit("write_model_meter must raise when the table is missing")
    except sqlite3.OperationalError:
        pass
    assert main(d1, call, dt.date(2026, 10, 9)) == 0  # a missing table is reported in the run, never fatal: cost_daily is still written
    c.execute("CREATE TABLE ai_meter_model_daily (date TEXT NOT NULL, model TEXT NOT NULL, neurons REAL NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, observed_at TEXT, PRIMARY KEY (date, model))")
    assert main(d1, call, dt.date(2026, 10, 9)) == 0
    assert main(d1, call, dt.date(2026, 10, 9)) == 0 and len(rows) == len(d1("SELECT * FROM cost_daily"))  # idempotent
    # COST-OWNER-SPLIT-1: the owner's untagged client spend (ai_spend_owner_local) is its own owner_gateway:<provider> row, never in the fleet row.
    # (a) the owner term equals the provider's gateway total: the fleet row is 0 and the owner row carries the day (2026-10-18: anthropic 97.03)
    assert rows[("2026-10-09", "ai_gateway:anthropic")] < 1e-3 and abs(rows[("2026-10-09", "owner_gateway:anthropic")] - 97.0266) < 1e-3, rows
    # (b) a partial owner term splits the provider total; (c) none leaves it all to the fleet; (d) an owner term above the gateway total (log cost vs GraphQL
    # cost drift) is capped at the gateway total, so the two rows still add up to what the gateway measured
    assert abs(rows[("2026-10-09", "ai_gateway:openai")] - 0.3) < 1e-9 and abs(rows[("2026-10-09", "owner_gateway:openai")] - 0.2) < 1e-9, rows
    assert ("2026-10-09", "owner_gateway:deepseek") not in rows
    assert rows[("2026-10-09", "ai_gateway:mistral")] == 0 and rows[("2026-10-09", "owner_gateway:mistral")] == 1.0, rows
    # the owner term is per day: a day without ai_spend_owner_local rows keeps the whole gateway cost as fleet
    assert abs(rows[("2026-10-08", "ai_gateway:anthropic")] - 97.0266) < 1e-9 and ("2026-10-08", "owner_gateway:anthropic") not in rows, rows
    scopes = {r["source"]: r["scope"] for r in d1("SELECT DISTINCT source, scope FROM cost_daily WHERE instr(source, 'gateway:') > 0")}
    assert all(sc == "fleet" for src, sc in scopes.items() if src.startswith("ai_gateway:")), scopes  # no mixed-scope gateway row remains
    assert all(sc == "owner-clients" for src, sc in scopes.items() if src.startswith("owner_gateway:")), scopes
    # (e) the owner term is not readable (table missing): the ledger does not guess; it keeps the whole gateway cost and labels the row as mixed
    c.execute("DROP TABLE ai_spend_owner_local")
    c.execute("DELETE FROM cost_daily WHERE source LIKE 'owner_gateway:%'")
    assert main(d1, call, dt.date(2026, 10, 9)) == 0
    lag = {(r["date"], r["source"]): (r["usd"], r["scope"]) for r in d1("SELECT date, source, usd, scope FROM cost_daily")}
    assert lag[("2026-10-09", "ai_gateway:anthropic")] == (97.0266, "fleet+owner-clients") and not [k for k in lag if k[1].startswith("owner_gateway:")], lag
    # the run-rate view (the migration's own SQL, replayed here): the owner term is measured in its own groups and in all-billing, and absent from the fleet groups
    here = os.path.dirname(os.path.abspath(__file__))
    mig = open(os.path.join(here, "..", "migrations", "2026-10-19-cost-ledger-owner-split.sql"), encoding="utf-8").read()
    view = mig[mig.index("\nCREATE VIEW v_cost_run_rate AS") + 1:]  # at a line start: the Rollback header holds the old text
    view = view[:view.index(";\n")]
    v = sqlite3.connect(":memory:")
    v.executescript("CREATE TABLE cost_daily (date TEXT NOT NULL, source TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'fleet', usd REAL NOT NULL DEFAULT 0, "
                    "requests INTEGER DEFAULT 0, note TEXT, updated_at TEXT, PRIMARY KEY (date, source));")
    for k in range(1, 9):
        day = (dt.date.today() - dt.timedelta(days=k)).isoformat()
        for src, usd in (("workers_ai", 2.0), ("ai_gateway:anthropic", 0.5), ("owner_gateway:anthropic", 10.0), ("cloudflare_plan:daily", 1.0), ("direct_providers_external:daily", 15.0)):
            v.execute("INSERT INTO cost_daily (date, source, usd) VALUES (?, ?, ?)", [day, src, usd])
    v.execute(view)
    rr = {r[0]: r[1] for r in v.execute("SELECT source_group, daily_7d FROM v_cost_run_rate")}
    assert rr["ai_gateway:anthropic"] == 0.5 and rr["owner_gateway:anthropic"] == 10.0 and rr["total:owner-gateway"] == 10.0, rr
    assert rr["total:cloudflare+gateway"] == 3.5, rr  # workers_ai 2 + fleet gateway 0.5 + plan 1: fleet_cost_run_rate_usd, without the owner's 10
    assert rr["total:all-billing"] == 28.5, rr  # the owner's total monthly budget keeps its gateway spend: 3.5 + 10 + 15
    # COST-SUSTAIN-3: invoice-preview lines are cents and include credit-paid usage; a refusal writes nothing
    m = sqlite3.connect(":memory:")
    m.executescript("CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT); INSERT INTO metric_registry (metric) VALUES ('billed_ai_gateway_mtd_usd'), ('research_neurons_per_publication_7d'), ('papers_per_100usd_7d');"
                    "CREATE TABLE ai_call_counters (day TEXT, worker TEXT, neurons REAL); CREATE TABLE research_queue (published_at TEXT);"
                    "CREATE TABLE v_cost_run_rate (source_group TEXT, daily_7d REAL);")

    def md1(sql, params=None):
        sql = sql.replace("strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", "'now'")
        cur = m.execute(sql, params or [])
        cols = [x[0] for x in cur.description] if cur.description else []
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    inv = {"result": {"amount_due": 0, "invoice_lines": [{"amount": 0}, {"amount": 4522}]}}
    assert billed_gateway(md1, lambda *a, **k: (200, inv))["billed_usd"] == 45.22
    assert md1("SELECT last_value FROM metric_registry WHERE metric = 'billed_ai_gateway_mtd_usd'")[0]["last_value"] == "45.22"
    assert isinstance(billed_gateway(md1, lambda *a, **k: (403, {})), str)
    y = (dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1)).isoformat()  # UTC like SQLite date('now'): the local date is a day ahead near midnight
    assert write_unit_cost(md1)["written"] is False  # no publication: no ratio
    m.execute("INSERT INTO ai_call_counters VALUES (?, 'qnfo-research-exec', 300000), (?, 'q08-signal-engine', 999999)", [y, y])
    m.executemany("INSERT INTO research_queue VALUES (?)", [[y + "T10:00:00Z"]] * 20)
    assert write_unit_cost(md1)["per_publication"] == 15000.0
    # PAPER-YIELD-1: no spend figure writes nothing; 20 versions over 7 x 28.5 USD is 10.025 per $100; zero versions with spend is a measured 0
    assert write_paper_yield(md1)["written"] is False
    assert md1("SELECT last_value FROM metric_registry WHERE metric = 'papers_per_100usd_7d'")[0]["last_value"] is None
    m.execute("INSERT INTO v_cost_run_rate VALUES ('total:all-billing', 28.5), ('total:cloudflare+gateway', 3.5)")
    assert write_paper_yield(md1)["per_100usd"] == 10.025
    assert md1("SELECT last_value, state FROM metric_registry WHERE metric = 'papers_per_100usd_7d'")[0] == {"last_value": "10.025", "state": "MEASURED"}
    m.execute("DELETE FROM research_queue")
    assert write_paper_yield(md1)["per_100usd"] == 0.0
    m.executemany("INSERT INTO research_queue VALUES (?)", [[y + "T10:00:00Z"]] * 20)
    assert isinstance(write_paper_yield(lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no such table"))), str)

    reconciliation_db = sqlite3.connect(":memory:")
    reconciliation_db.executescript("""CREATE TABLE cost_daily (date TEXT, source TEXT, scope TEXT, usd REAL);
      CREATE TABLE ai_spend_ledger (day TEXT, provider TEXT, calls INTEGER, usd REAL);
      CREATE TABLE analytics_dash_meta (key TEXT, value TEXT);
      CREATE TABLE metric_registry (metric TEXT, last_value TEXT, last_refreshed TEXT, formula TEXT, source_of_truth TEXT);
      CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
      CREATE TABLE ops_jobs (id TEXT PRIMARY KEY, status TEXT, updated_at TEXT);
      CREATE TABLE ops_ai_log (id TEXT PRIMARY KEY, ts TEXT, strategy TEXT, job_id TEXT, cost_usd REAL);
      INSERT INTO analytics_dash_meta VALUES ('unified_cost_usd_30d','5'),('byok_cost_usd_30d','3'),('last_refresh','2026-10-09T23:00:00Z');
      INSERT INTO metric_registry VALUES ('cost_usd_30d','10.165','2026-10-09T23:00:00Z','all-provider AI estimate','gateway + Workers AI + direct');
      INSERT INTO metric_registry VALUES ('ai_est_cost_30d','8.165','2026-10-09T23:00:00Z','AI list cost','gateway + Workers AI');
      INSERT INTO metric_registry VALUES ('cost_per_successful_task_by_class','0.01','2026-10-09T23:00:00Z','COST-PER-TASK-WINDOW-1: model ladder spend / successful calls','ops_ai_log');
      INSERT INTO cost_daily VALUES ('2026-10-09','workers_ai','fleet',1),('2026-10-09','ai_gateway:openai','fleet',5),
        ('2026-10-09','owner_gateway:openai','owner-clients',1),('2026-10-09','cloudflare_plan:daily','fleet',1),
        ('2026-10-09','direct_providers_external:daily','owner-direct',15);
      INSERT INTO ops_jobs VALUES
        ('job-success-linked','succeeded','2026-10-09T22:30:00Z'),
        ('job-success-unlinked','succeeded','2026-10-09T22:40:00Z'),
        ('job-retried','succeeded','2026-10-09T22:45:00Z'),
        ('job-failed-linked','failed','2026-10-09T22:50:00Z'),
        ('job-failed-unlinked','failed','2026-10-09T23:00:00Z'),
        ('job-failed-zero','failed','2026-10-09T23:05:00Z'),
        ('job-old','succeeded','2026-08-01T00:00:00Z'),
        ('job-running','running','2026-10-09T23:10:00Z');
      INSERT INTO ops_ai_log VALUES
        ('log-success','2026-10-09T22:30:00Z','job-workflow','job-success-linked',0.12),
        ('log-success-zero','2026-10-09T22:35:00Z','job-workflow','job-success-linked',0),
        ('log-retry-1','2026-10-09T22:41:00Z','job-workflow','job-retried',0.02),
        ('log-retry-2','2026-10-09T22:44:00Z','job-workflow','job-retried',0.03),
        ('log-other-strategy','2026-10-09T22:45:00Z','model-ladder','job-retried',0.5),
        ('log-failed','2026-10-09T22:50:00Z','job-workflow','job-failed-linked',0.03),
        ('log-failed-zero','2026-10-09T23:05:00Z','job-workflow','job-failed-zero',0),
        ('log-unassociated','2026-10-09T23:06:00Z','job-workflow',NULL,0.7),
        ('log-old','2026-08-01T00:00:00Z','job-workflow','job-old',9.0);
      CREATE TRIGGER event_secret_guard_insert AFTER INSERT ON cloud_ops_events
      WHEN NEW.meta LIKE '%cfat_%' OR NEW.meta LIKE '%ghp_%' OR NEW.meta LIKE '%github_pat_%'
        OR NEW.meta LIKE '%sk-ant-%' OR NEW.meta LIKE '%AIza%' OR NEW.meta LIKE '%AKIA%' OR NEW.meta LIKE '%OPSKEYPX%'
      BEGIN UPDATE cloud_ops_events SET meta=CASE
        WHEN instr(NEW.meta,'cfat_')>0 THEN substr(NEW.meta,1,instr(NEW.meta,'cfat_')-1)||'[REDACTED-CF-TOKEN]'
        WHEN instr(NEW.meta,'github_pat_')>0 THEN substr(NEW.meta,1,instr(NEW.meta,'github_pat_')-1)||'[REDACTED-GH-PAT]'
        WHEN instr(NEW.meta,'ghp_')>0 THEN substr(NEW.meta,1,instr(NEW.meta,'ghp_')-1)||'[REDACTED-GH-TOKEN]'
        WHEN instr(NEW.meta,'sk-ant-')>0 THEN substr(NEW.meta,1,instr(NEW.meta,'sk-ant-')-1)||'[REDACTED-ANTHROPIC-KEY]'
        WHEN instr(NEW.meta,'AIza')>0 THEN substr(NEW.meta,1,instr(NEW.meta,'AIza')-1)||'[REDACTED-GOOGLE-KEY]'
        WHEN instr(NEW.meta,'AKIA')>0 THEN substr(NEW.meta,1,instr(NEW.meta,'AKIA')-1)||'[REDACTED-AWS-KEY]'
        WHEN instr(NEW.meta,'OPSKEYPX')>0 THEN substr(NEW.meta,1,instr(NEW.meta,'OPSKEYPX')-1)||'[REDACTED-OPS-KEY]'
        ELSE '[REDACTED-SECRET-ADJACENT]' END WHERE rowid=NEW.rowid; END;
      CREATE TRIGGER event_secret_guard_update AFTER UPDATE OF meta ON cloud_ops_events
      WHEN NEW.meta LIKE '%cfat_%' OR NEW.meta LIKE '%ghp_%' OR NEW.meta LIKE '%github_pat_%'
        OR NEW.meta LIKE '%sk-ant-%' OR NEW.meta LIKE '%AIza%' OR NEW.meta LIKE '%AKIA%' OR NEW.meta LIKE '%OPSKEYPX%'
      BEGIN UPDATE cloud_ops_events SET meta=CASE
        WHEN instr(NEW.meta,'cfat_')>0 THEN substr(NEW.meta,1,instr(NEW.meta,'cfat_')-1)||'[REDACTED-CF-TOKEN]'
        WHEN instr(NEW.meta,'github_pat_')>0 THEN substr(NEW.meta,1,instr(NEW.meta,'github_pat_')-1)||'[REDACTED-GH-PAT]'
        WHEN instr(NEW.meta,'ghp_')>0 THEN substr(NEW.meta,1,instr(NEW.meta,'ghp_')-1)||'[REDACTED-GH-TOKEN]'
        WHEN instr(NEW.meta,'sk-ant-')>0 THEN substr(NEW.meta,1,instr(NEW.meta,'sk-ant-')-1)||'[REDACTED-ANTHROPIC-KEY]'
        WHEN instr(NEW.meta,'AIza')>0 THEN substr(NEW.meta,1,instr(NEW.meta,'AIza')-1)||'[REDACTED-GOOGLE-KEY]'
        WHEN instr(NEW.meta,'AKIA')>0 THEN substr(NEW.meta,1,instr(NEW.meta,'AKIA')-1)||'[REDACTED-AWS-KEY]'
        WHEN instr(NEW.meta,'OPSKEYPX')>0 THEN substr(NEW.meta,1,instr(NEW.meta,'OPSKEYPX')-1)||'[REDACTED-OPS-KEY]'
        ELSE '[REDACTED-SECRET-ADJACENT]' END WHERE rowid=NEW.rowid; END;
      CREATE TRIGGER event_meta_json_guard AFTER UPDATE OF meta ON cloud_ops_events
      WHEN NEW.meta IS NOT NULL AND NOT json_valid(NEW.meta)
      BEGIN UPDATE cloud_ops_events SET meta=json_object('_truncated',1,'_raw',NEW.meta) WHERE rowid=NEW.rowid; END;""")

    def rd1(sql, params=None):
        cur = reconciliation_db.execute(sql, params or [])
        cols = [x[0] for x in cur.description] if cur.description else []
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def reconciliation_call(method, path, body=None, timeout=30):
        query = body["query"]
        if "aiInferenceAdaptiveGroups" in query:
            result = {"aiInferenceAdaptiveGroups": [
                {"count": 2, "sum": {"totalNeurons": 20000}, "dimensions": {"date": "2026-09-10"}},
                {"count": 3, "sum": {"totalNeurons": 15000}, "dimensions": {"date": "2026-10-09"}},
            ]}
        else:
            result = {"aiGatewayRequestsAdaptiveGroups": [
                {"count": 10, "sum": {"cost": 5}, "dimensions": {"provider": "openai", "model": "gpt-5.5"}},
                {"count": 5, "sum": {"cost": 3}, "dimensions": {"provider": "compat", "model": "throughput/deepseek-flash"}},
                {"count": 20, "sum": {"cost": 99}, "dimensions": {"provider": "workers-ai", "model": "x"}},
                {"count": 1, "sum": {"cost": 0}, "dimensions": {"provider": "throughput", "model": "test"}},
            ]}
        return 200, {"data": {"viewer": {"accounts": [result]}}}

    reconciliation_db.executemany(
        "INSERT INTO ai_spend_ledger VALUES (?, ?, ?, ?)",
        [["2026-10-09", "deepseek", 7, 1.5], ["2026-10-09", "mistral", 2, 0.5],
         ["2026-10-09", "gateway", 9, 99], ["2026-10-09", "workers-ai", 8, 99]],
    )
    snapshot = cost_reconciliation(
        rd1, reconciliation_call, dt.date(2026, 10, 9), 30, "subscriptions API", 450
    )
    assert snapshot["billing_status"] == "partial"  # owner-stated external spend remains unverified
    assert snapshot["components_usd"]["ai_gateway_all_clients"] == 8
    assert snapshot["components_usd"]["ai_gateway_payment_split"]["difference_usd"] == 0
    assert snapshot["workers_ai_meter"]["neurons"] == 35000  # the idle UTC date has no usage group
    assert snapshot["workers_ai_meter"]["group_count"] == 2
    assert snapshot["workers_ai_meter"]["billable_neurons_after_daily_free_allowance"] == 15000
    assert snapshot["components_usd"]["workers_ai_account_wide"] == 0.165  # burst + idle + partial current date; allowance does not roll over
    assert snapshot["components_usd"]["direct_providers_metered"] == 2
    assert snapshot["measured_source_subtotal_usd"] == 40.165
    assert snapshot["all_billing_including_unverified_usd"] == 490.165
    assert snapshot["cost_metric_cross_checks"]["cost_usd_30d"]["difference_from_measured_sources_usd"] == 0
    assert snapshot["cost_metric_cross_checks"]["ai_est_cost_30d"]["difference_from_measured_sources_usd"] == 0
    assert snapshot["window_start_at"] == "2026-09-10T00:00:00Z"
    assert snapshot["window_end_exclusive_at"] == "2026-10-10T00:00:00Z"
    assert snapshot["task_cost_coverage"]["by_outcome"]["succeeded"] == {
        "task_count": 3,
        "cost_linked_task_count": 2,
        "missing_cost_link_tasks": 1,
        "tasks_with_zero_cost_logs": 1,
        "tasks_with_positive_cost_estimate": 2,
        "logged_cost_usd_estimate": 0.17,
        "mean_logged_cost_usd_estimate_per_task_with_positive_logged_cost": 0.085,
    }
    assert snapshot["task_cost_coverage"]["by_outcome"]["failed"] == {
        "task_count": 3,
        "cost_linked_task_count": 2,
        "missing_cost_link_tasks": 1,
        "tasks_with_zero_cost_logs": 1,
        "tasks_with_positive_cost_estimate": 1,
        "logged_cost_usd_estimate": 0.03,
        "mean_logged_cost_usd_estimate_per_task_with_positive_logged_cost": 0.03,
    }
    assert snapshot["task_cost_coverage"]["failed_task_cost_usd"] is None
    assert snapshot["task_cost_coverage"]["included_in_billing_total"] is False
    assert snapshot["task_cost_coverage"]["failed_task_cost_usd_estimate"] == 0.03
    assert "not provider invoice charges" in snapshot["task_cost_coverage"]["cost_basis"]
    assert "zero-cost rows are unverified" in snapshot["task_cost_coverage"]["cost_basis"]
    assert "unassociated and other-strategy calls are not inferred or included" in snapshot["task_cost_coverage"]["log_filter"]
    task_sample = {row["task_id"]: row for row in snapshot["task_cost_coverage"]["task_id_outcome_sample"]}
    assert task_sample["job-success-linked"]["outcome"] == "succeeded"
    assert task_sample["job-success-linked"]["cost_link_status"] == "partial_unverified"
    assert task_sample["job-success-linked"]["zero_cost_rows"] == 1
    assert task_sample["job-success-linked"]["logged_cost_usd_estimate"] == 0.12
    assert task_sample["job-retried"]["cost_log_rows"] == 2
    assert task_sample["job-retried"]["logged_cost_usd_estimate"] == 0.05
    assert snapshot["task_cost_coverage"]["by_outcome"]["succeeded"]["task_count"] == 3
    assert task_sample["job-failed-linked"]["outcome"] == "failed"
    assert task_sample["job-failed-linked"]["logged_cost_usd_estimate"] == 0.03
    assert task_sample["job-failed-zero"]["cost_link_status"] == "unverified_zero"
    assert task_sample["job-failed-zero"]["logged_cost_usd_estimate"] is None
    assert snapshot["task_cost_coverage"]["task_id_outcome_sample_truncated"] is False
    task_db = sqlite3.connect(":memory:")
    task_db.executescript("CREATE TABLE ops_jobs (id TEXT PRIMARY KEY, status TEXT, updated_at TEXT); CREATE TABLE ops_ai_log (id TEXT PRIMARY KEY, strategy TEXT, job_id TEXT, cost_usd REAL);"
                         "INSERT INTO ops_jobs VALUES ('failed-unpriced','failed','2026-10-09T23:00:00Z'),"
                         "('failed-zero','failed','2026-10-09T23:10:00Z');"
                         "INSERT INTO ops_ai_log VALUES ('zero','job-workflow','failed-zero',0);")

    def td1(sql, params=None):
        cur = task_db.execute(sql, params or [])
        cols = [col[0] for col in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    task_rows, task_error = task_cost_outcomes(td1, "2026-09-10T00:00:00Z", "2026-10-10T00:00:00Z")
    assert task_error is None
    assert task_rows["by_outcome"]["failed"]["task_count"] == 2
    assert task_rows["by_outcome"]["failed"]["missing_cost_link_tasks"] == 1
    assert task_rows["by_outcome"]["failed"]["tasks_with_zero_cost_logs"] == 1
    assert task_rows["by_outcome"]["failed"]["logged_cost_usd_estimate"] == 0
    assert task_rows["task_id_outcome_sample"] == [
        {
            "task_id": "failed-zero",
            "outcome": "failed",
            "cost_link_status": "unverified_zero",
            "cost_log_rows": 1,
            "priced_cost_rows": 1,
            "zero_cost_rows": 1,
            "positive_cost_rows": 0,
            "logged_cost_usd_estimate": None,
        },
        {
            "task_id": "failed-unpriced",
            "outcome": "failed",
            "cost_link_status": "missing",
            "cost_log_rows": 0,
            "priced_cost_rows": 0,
            "zero_cost_rows": 0,
            "positive_cost_rows": 0,
            "logged_cost_usd_estimate": None,
        },
    ]
    task_db.executemany(
        "INSERT INTO ops_jobs VALUES (?, 'succeeded', '2026-10-09T23:30:00Z')",
        [("success-%02d" % index,) for index in range(TASK_COST_DETAIL_LIMIT)],
    )
    task_rows, task_error = task_cost_outcomes(td1, "2026-09-10T00:00:00Z", "2026-10-10T00:00:00Z")
    assert task_error is None
    assert len(task_rows["task_id_outcome_sample"]) == TASK_COST_DETAIL_LIMIT
    assert task_rows["task_id_outcome_sample_truncated"] is True
    assert provider_label("throughput") == "other"
    assert provider_label("cfatX") == "other"
    assert "throughput" not in json.dumps(snapshot)
    daily_gateway = gateway_day(
        dt.date(2026, 10, 9),
        lambda *args, **kwargs: (200, {"data": {"viewer": {"accounts": [{
            "aiGatewayRequestsAdaptiveGroups": [
                {"count": 1, "sum": {"cost": 1}, "dimensions": {"provider": "compat", "model": "throughput/example"}}
            ]
        }]}}}),
    )
    assert daily_gateway["other"] == (1, 1)
    try:
        workers_ai_window(
            "2026-09-10T00:00:00Z", "2026-10-10T00:00:00Z", 30,
            lambda *args, **kwargs: (200, {"data": {"viewer": {"accounts": [{
                "aiInferenceAdaptiveGroups": [
                    {"count": 1, "sum": {"totalNeurons": 1}, "dimensions": {"date": "2026-10-10"}}
                ]
            }]}}}),
        )
        raise AssertionError("Workers AI window accepted its exclusive end date")
    except RuntimeError as error:
        assert "invalid date" in str(error)
    assert snapshot["cost_metric_cross_checks"]["cost_usd_30d"]["included_in_total"] is False
    assert snapshot["task_cost_coverage"]["successful_call_metric"]["scope"] == "successful qnfo-ops model-ladder calls, not all fleet tasks"
    assert snapshot["task_cost_coverage"]["failed_task_cost_usd"] is None
    written = write_cost_reconciliation(
        rd1, dt.date(2026, 10, 9), reconciliation_call, 30, "subscriptions API", 450
    )
    assert written["all_billing_including_unverified_usd"] == 490.165
    event = rd1("SELECT status, meta FROM cloud_ops_events WHERE id = 'cost-reconciliation-2026-10-09'")[0]
    assert event["status"] == "partial" and json.loads(event["meta"]) == written
    for marker in ("%cfat_%", "%ghp_%", "%github_pat_%", "%sk-ant-%", "%AIza%", "%AKIA%", "%OPSKEYPX%"):
        assert rd1("SELECT ?1 LIKE ?2 AS matched", [event["meta"], marker])[0]["matched"] == 0, marker
    updated = write_cost_reconciliation(
        rd1, dt.date(2026, 10, 9), reconciliation_call, 30, "subscriptions API", 450
    )
    updated_event = rd1("SELECT meta FROM cloud_ops_events WHERE id = 'cost-reconciliation-2026-10-09'")[0]["meta"]
    assert updated_event == json.dumps(updated, separators=(",", ":")) and json.loads(updated_event) == updated
    def failed_source_call(method, path, body=None, timeout=30):
        return 403, {"errors": [{"message": "test source refusal"}]}
    failed_snapshot = cost_reconciliation(
        rd1, failed_source_call, dt.date(2026, 10, 9), 30, "subscriptions API", 450
    )
    assert failed_snapshot["components_usd"]["workers_ai_account_wide"] is None
    assert failed_snapshot["components_usd"]["ai_gateway_all_clients"] is None
    assert failed_snapshot["measured_source_subtotal_usd"] is None
    assert any(error.startswith("Workers AI GraphQL unavailable") for error in failed_snapshot["source_errors"])
    assert any(error.startswith("AI Gateway GraphQL unavailable") for error in failed_snapshot["source_errors"])
    print("cost_ledger selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    sys.exit(main())
