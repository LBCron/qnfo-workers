#!/usr/bin/env python3
"""BP26 source_liveness collector (2026-10-28, charter pillar research; agent_issues predicate BP26-CLAIM-LEDGER).

source_liveness: cited source URLs that resolve (or have an archived R2 copy) / all cited URLs, rolling 7 days; target >= 0.99.
Source: living-paper.paper_citations.cited_url (written by qnfo-research-exec), rows with created_at in the last 7 days, distinct https URLs.
Each sampled URL gets one HEAD (a GET when HEAD answers 403/405/501 or times out), redirects followed by hand, through ctx.http(external=True).
  - resolved: final status below 400.   - failed: status 400+ (not 401/403/429) or a transport error (timeout, TLS, DNS).
  - inconclusive: 401, 403, 429 (the site answered but gates robots): left out of numerator and denominator and counted in the note.
PROXY and limits: (1) SAMPLE, not census: at most SAMPLE distinct URLs per run (newest first) inside the run's time budget; the note says how many of
how many were checked. (2) The archived-R2-copy half of the definition has no source in the repository (no archive ledger), so a dead URL counts as
failed even if a copy exists: the value is a lower bound. (3) Alive is not correct: a page that resolves may no longer say what was cited. Unknown when
the table is unreadable, no URL was cited in the window, or every sampled URL was inconclusive; never zero.
Evidence rows carry the citing slug and the failure token only, no page content.

Offline suite: python3 scripts/bp26_source_liveness.py --selftest
"""
import datetime
import os
import sqlite3
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bp26_producers import Collector, Result, Resp  # noqa: E402

DB = "living-paper"
SAMPLE = 60
SQL = ("SELECT cited_url, MIN(citing_slug) AS slug FROM paper_citations WHERE cited_url LIKE 'https://%' AND datetime(created_at) >= datetime(?1) "
       "GROUP BY cited_url ORDER BY MAX(created_at) DESC LIMIT ?2")


def _check(ctx, url):
    """
    Perform a HEAD request first. If the HEAD fails (status >= 400, timeout, or any error),
    fall back to a GET request. Return the response that best represents the URL's availability.
    """
    r = ctx.http(url, method="HEAD", external=True, timeout=12, max_bytes=2048)

    # Determine if we need to retry with GET:
    need_get = (
        r.status >= 400
        or (r.status == 0 and r.error)          # transport error (timeout, DNS, TLS, etc.)
        or r.status in (403, 405, 501)          # servers that explicitly reject HEAD
    )
    if need_get:
        r2 = ctx.http(url, external=True, timeout=12, max_bytes=2048)
        # Prefer the GET result if it succeeded (status < 400) or if the original HEAD gave no status.
        if (r2.status and r2.status < 400) or (r.status == 0):
            r = r2
    return r


def collect_liveness(ctx):
    now = getattr(ctx, "now", None) or datetime.datetime.now(datetime.timezone.utc).timestamp()
    since = datetime.datetime.fromtimestamp(now - 7 * 86400, datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    try:
        rows = ctx.d1_db(DB, SQL, [since, SAMPLE])
    except Exception as e:  # noqa: BLE001
        return [Result("source_liveness", None, "paper_citations unreadable: " + str(e)[:100], [])]
    rows = [r for r in rows if urllib.parse.urlparse(str(r.get("cited_url") or "")).hostname]
    if not rows:
        return [Result("source_liveness", None, "no https URL cited in the last 7 days: nothing to measure", [])]
    ok_n = bad = skip = checked = 0
    ev = []
    for r in rows:
        if hasattr(ctx, "left") and ctx.left() < 8:
            break
        resp = _check(ctx, r["cited_url"])
        checked += 1
        if 0 < resp.status < 400:
            ok_n += 1
        elif resp.status in (401, 403, 429):
            skip += 1
        else:
            bad += 1
            if len(ev) < 40:
                ev.append(("cite:%s" % r.get("slug"), 0, "%s -> %s" % (urllib.parse.urlparse(r["cited_url"]).netloc, resp.status or resp.error or "no answer")))
    den = ok_n + bad
    if not den:
        return [Result("source_liveness", None, "checked %d of %d URL(s), all inconclusive (401/403/429) or none reached" % (checked, len(rows)), ev)]
    note = ("%d of %d conclusive URL(s) resolve (%d inconclusive 401/403/429 left out); %d of %d distinct URLs cited in 7 days checked, newest first, a sample "
            "not a census; no archived-copy source exists so the value is a lower bound; alive is not correct" % (ok_n, den, skip, checked, len(rows)))
    return [Result("source_liveness", round(ok_n / den, 4), note, ev)]


COLLECTORS = [Collector("source_liveness", collect_liveness, ["source_liveness"], 55)]


def selftest():
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE paper_citations (citing_slug TEXT, cited_url TEXT, ref_no INTEGER, created_at TEXT)")
    now = datetime.datetime(2026, 10, 28, tzinfo=datetime.timezone.utc)
    c.executemany("INSERT INTO paper_citations VALUES (?,?,?,?)", [
        ("p1", "https://good.example/a", 1, "2026-10-27 00:00:00"), ("p1", "https://dead.example/b", 2, "2026-10-27 00:00:00"),
        ("p2", "https://gated.example/c", 1, "2026-10-26 00:00:00"), ("p3", "https://old.example/d", 1, "2026-01-01 00:00:00"),
        ("p4", "http://plain.example/e", 1, "2026-10-27 00:00:00"), ("p5", "https://head-timeout.example/f", 1, "2026-10-27 00:00:00")])

    def d1_db(name, sql, params=None):
        cur = c.execute(sql, params or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, x)) for x in cur.fetchall()]
    seen = []

    def http(url, **kw):
        method = kw.get("method", "GET")
        seen.append((url, method))
        if "head-timeout" in url and method == "HEAD":
            return Resp(0, {}, [], "", url, 1, [], "timeout")
        st = 200 if "good" in url or "head-timeout" in url else (403 if "gated" in url else 404)
        return Resp(st, {}, [], "", url, 1, [], None)

    class Ctx:
        pass
    ctx = Ctx()
    ctx.d1_db, ctx.http, ctx.now = d1_db, http, now.timestamp()
    ctx.left = lambda: 100
    fails = []

    def ok(cond, m):
        if not cond:
            fails.append(m)
            print("FAIL " + m)
    out = collect_liveness(ctx)[0]
    ok(out.value == 0.6667 and "1 inconclusive" in out.note, "good resolves, a timed-out HEAD retries with GET, dead fails, gated left out, old and http rows excluded: %r" % (out,))
    ok(out.rows and out.rows[0][0] == "cite:p1", "the failure is evidenced by slug: %r" % (out.rows,))
    ok([method for url, method in seen if "head-timeout" in url] == ["HEAD", "GET"], "a HEAD timeout gets one GET fallback: %r" % (seen,))
    ok(not any("old.example" in u or "plain.example" in u for u, _ in seen), "only https rows of the window were fetched: %r" % (seen,))
    c.execute("DELETE FROM paper_citations")
    ok(collect_liveness(ctx)[0].value is None, "no citation in the window is unknown")
    c.execute("DROP TABLE paper_citations")
    ok(collect_liveness(ctx)[0].value is None, "missing table is unknown")
    print("bp26_source_liveness selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else 0)
