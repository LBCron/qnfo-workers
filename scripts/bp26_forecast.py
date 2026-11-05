#!/usr/bin/env python3
"""BP26-FORECAST-HYGIENE-1 collectors (2026-10-28, charter pillar research; agent_issues 1000337).

Two metrics read from the q08-signal D1 table q08_forecasts (q08-signal-engine):

  brier_rolling_90d                       mean Brier score of forecasts with status 'resolved' and resolved_at in the last 90 days (outcome 1 or 0,
                                          the score q08-signal-engine stored). Unknown with no resolved forecast. Under 20 resolved forecasts the
                                          note says the score is mostly noise, as the /forecasts page does; target < 0.25 (always saying 50% scores 0.25).
  forecast_resolution_criteria_complete   share of OPEN forecasts whose resolution text (with any dated clarification in q08_forecast_clarifications) names a source, a date and an edge-case rule. PROXY: three
                                          text patterns (a URL or a reporting phrase; a date or "by <date/year/month>"; an if/unless/otherwise/void/
                                          ambiguous clause). It checks that the words are present, not that the criteria are good; a forecast the
                                          generator wrote to the 30-400 character rule can still fail it. Unknown with no open forecast.

Evidence rows carry the forecast id and which part is missing, never the claim text.

Offline suite: python3 scripts/bp26_forecast.py --selftest
"""
import datetime
import os
import re
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bp26_producers import Collector, Result  # noqa: E402

DB = "q08-signal"
SOURCE = re.compile(r"(?i)https?://|\b(according to|as reported|reported by|published (by|on|in)|data from|per the|official|filing|release|index|report|statistics|bureau|agency|register|database|census|dashboard|tracker)\b")
DATE = re.compile(r"(?i)\b\d{4}-\d{2}-\d{2}\b|\b(by|before|on|until|through)\s+(the\s+end\s+of\s+)?(\d{1,2}\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|20\d\d)\b|\b20\d\d\b")
EDGE = re.compile(r"(?i)\b(if|unless|otherwise|void|ambiguous|not (published|available|reported)|no (data|report|announcement)|in the event|fails? to|cannot be|revised|restated)\b")

BRIER_SQL = ("SELECT COUNT(*) AS n, AVG(brier) AS mean FROM q08_forecasts WHERE status = 'resolved' AND brier IS NOT NULL "
             "AND datetime(resolved_at) >= datetime(?1)")
OPEN_SQL = "SELECT id, resolution FROM q08_forecasts WHERE status = 'open'"
# BP26-FORECAST-CLARIFY-1 (2026-11-05): the published resolution text is immutable (trigger q08_forecasts_published_fields_immutable), so a forecast that predates the gate can only
# gain the missing source, date or edge-case rule as a dated, append-only clarification beside it (q08_forecast_clarifications, kind 'criteria'). The words a reader sees are the
# resolution plus its clarifications, and that is what this reads. The bare query stays as the fallback while the table does not exist yet.
OPEN_SQL_CLARIFIED = ("SELECT f.id AS id, f.resolution || COALESCE((SELECT ' ' || group_concat(c.text, ' ') FROM q08_forecast_clarifications c "
                      "WHERE c.forecast_id = f.id AND c.kind = 'criteria'), '') AS resolution FROM q08_forecasts f WHERE f.status = 'open'")


def collect_brier(ctx):
    since = (datetime.datetime.fromtimestamp(getattr(ctx, "now", None) or datetime.datetime.now(datetime.timezone.utc).timestamp(), datetime.timezone.utc)
             - datetime.timedelta(days=90)).strftime("%Y-%m-%d %H:%M:%S")
    try:
        r = ctx.d1_db(DB, BRIER_SQL, [since])
    except Exception as e:  # noqa: BLE001
        return [Result("brier_rolling_90d", None, "q08_forecasts unreadable: " + str(e)[:100], [])]
    n = int((r[0].get("n") if r else 0) or 0)
    if not n:
        return [Result("brier_rolling_90d", None, "no forecast resolved in the last 90 days: a score does not exist yet", [])]
    mean = round(float(r[0]["mean"]), 4)
    note = "mean Brier of %d forecast(s) resolved in 90 days (always saying 50%% scores 0.25)%s" % (n, "" if n >= 20 else "; under 20 resolved forecasts the score is mostly noise")
    return [Result("brier_rolling_90d", mean, note, [("resolved forecasts, 90 days", n, "mean Brier %s" % mean)])]


def collect_criteria(ctx):
    clarified = True
    try:
        try:
            rows = ctx.d1_db(DB, OPEN_SQL_CLARIFIED)
        except Exception:  # noqa: BLE001  (the clarification table does not exist yet)
            clarified = False
            rows = ctx.d1_db(DB, OPEN_SQL)
    except Exception as e:  # noqa: BLE001
        return [Result("forecast_resolution_criteria_complete", None, "q08_forecasts unreadable: " + str(e)[:100], [])]
    if not rows:
        return [Result("forecast_resolution_criteria_complete", None, "no open forecast", [])]
    ev, good = [], 0
    for r in rows:
        t = str(r.get("resolution") or "")
        miss = [k for k, rx in (("source", SOURCE), ("date", DATE), ("edge-case rule", EDGE)) if not rx.search(t)]
        if not miss:
            good += 1
        elif len(ev) < 40:
            ev.append(("forecast:%s" % r.get("id"), 0, "missing: " + ", ".join(miss)))
    note = ("%d of %d open forecasts name a source, a date and an edge-case rule in the resolution text%s (text-pattern proxy: words present, quality not judged)"
            % (good, len(rows), " and its dated clarifications" if clarified else ""))
    return [Result("forecast_resolution_criteria_complete", round(good / len(rows), 4), note, ev)]


COLLECTORS = [Collector("forecast_brier", collect_brier, ["brier_rolling_90d"], 55),
              Collector("forecast_criteria", collect_criteria, ["forecast_resolution_criteria_complete"], 55)]


def selftest():
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE q08_forecasts (id INTEGER PRIMARY KEY, status TEXT, brier REAL, resolved_at TEXT, resolution TEXT)")
    now = datetime.datetime(2026, 10, 28, tzinfo=datetime.timezone.utc)
    c.executemany("INSERT INTO q08_forecasts (status, brier, resolved_at, resolution) VALUES (?,?,?,?)", [
        ("resolved", 0.1, "2026-10-01 00:00:00", ""), ("resolved", 0.3, "2026-09-01 00:00:00", ""), ("resolved", 0.9, "2025-01-01 00:00:00", ""),
        ("open", None, None, "Resolves yes if the Eurostat release published by 2026-12-31 shows growth above 1%; void if the release is delayed."),
        ("open", None, None, "It will probably happen soon")])

    def d1_db(name, sql, params=None):
        cur = c.execute(sql, params or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, x)) for x in cur.fetchall()]

    class Ctx:
        pass
    ctx = Ctx()
    ctx.d1_db = d1_db
    ctx.now = now.timestamp()
    fails = []

    def ok(cond, m):
        if not cond:
            fails.append(m)
            print("FAIL " + m)
    b = collect_brier(ctx)[0]
    ok(b.value == 0.2 and "noise" in b.note, "two resolved in the window, the old one excluded, small-n note: %r" % (b,))
    k = collect_criteria(ctx)[0]
    ok(k.value == 0.5 and k.rows and "source" in k.rows[0][2], "one of two open forecasts is complete: %r" % (k,))
    ok("dated clarifications" not in k.note, "without the clarification table the bare resolution is read")
    # BP26-FORECAST-CLARIFY-1: a dated clarification completes a legacy forecast without touching its resolution text
    c.execute("CREATE TABLE q08_forecast_clarifications (id INTEGER PRIMARY KEY AUTOINCREMENT, forecast_id INTEGER NOT NULL, slug TEXT, kind TEXT NOT NULL, text TEXT NOT NULL, added_at TEXT)")
    c.execute("INSERT INTO q08_forecast_clarifications (forecast_id, slug, kind, text, added_at) SELECT id, 's', 'criteria', 'Source: https://example.org/release. Read by 2026-12-31. If the source is silent by then the forecast resolves void.', '2026-11-05' FROM q08_forecasts WHERE resolution LIKE 'It will%'")
    k2 = collect_criteria(ctx)[0]
    ok(k2.value == 1.0 and "dated clarifications" in k2.note, "the clarification completes the second forecast: %r" % (k2,))
    c.execute("INSERT INTO q08_forecast_clarifications (forecast_id, slug, kind, text, added_at) SELECT id, 's', 'note', 'Source https://x.org by 2026-01-01 if unclear', '2026-11-05' FROM q08_forecasts WHERE resolution LIKE 'Resolves%'")
    ok(collect_criteria(ctx)[0].value == 1.0, "a clarification of another kind is not read")
    c.execute("DROP TABLE q08_forecast_clarifications")
    c.execute("DELETE FROM q08_forecasts")
    ok(collect_brier(ctx)[0].value is None and collect_criteria(ctx)[0].value is None, "empty table is unknown")
    c.execute("DROP TABLE q08_forecasts")
    ok(collect_brier(ctx)[0].value is None, "missing table is unknown")
    ok(len(COLLECTORS) == 2, "two collectors")
    print("bp26_forecast selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else 0)
