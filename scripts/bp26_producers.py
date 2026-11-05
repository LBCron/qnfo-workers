#!/usr/bin/env python3
"""BP26-PRODUCERS-1 (2026-10-26, charter pillars core, security, research, reach, autonomy; owner directive 2026-10-26 "Implement general best practices
systemwide across the fleet"; agent_issues 1000363 bp26_metrics_unmeasured, 1000333-1000364).

WHY   The BP26 catalogue (migrations/2026-10-26-best-practice-catalogue.sql) registered 56 metrics, each with its trigger, and said "the producer that
      measures it is part of the issue". 53 of them read UNMEASURED: their input is not in qnfo-audit (a repository scan, a public page, DNS, another
      database, the Cloudflare API) so no D1 trigger can compute them, and a value written by hand is not a measurement. This is the runner half: a small
      framework that runs measurement modules from the GitHub runner (the remediation-consumer job, through scripts/loop_breaker_runner.py, hourly) and
      writes the metric, plus the evidence behind it, to qnfo-audit.

WHAT  scripts/bp26_<area>.py modules are discovered by name (this file excluded). A module exposes
          COLLECTORS = [Collector(name, fn, metrics, every_min), ...]
      and fn(ctx) returns a list of Result(metric, value, note, rows):
          value  a number, or None for "cannot be measured right now": None writes NOTHING to metric_registry (unknown is never a value; a metric that
                 reads 0 because nothing was measured is a lie) but its rows and note are still recorded;
          note   one line saying how the value was computed this run (kept with the run row);
          rows   [(subject, ok, detail)] the numerator and denominator behind the value, one per host, file, surface or record; ok is 1, 0 or None.
      Writes go to metric_registry.last_value / last_refreshed / state = 'MEASURED' / refresh_class = 'runner' and only for a metric whose source_of_truth
      carries the [BP26] tag, so a collector can never overwrite another producer's metric. The evidence rows are appended to qnfo-audit.bp26_probe_results
      (migrations/2026-10-26-bp26-runner-producers.sql) and trimmed to 40 days; each run writes one cloud_ops_events row of kind bp26-producers.
      A collector that raises is recorded and skipped; the others still run. Each collector has a cadence (every_min): it is skipped while any of its metrics is
      fresher than that (a metric a collector could not measure waits one interval for its retry).

Usage:
  python3 scripts/bp26_producers.py                    run every due collector and write (needs CLOUDFLARE_API_TOKEN, CF_ACCOUNT_ID like the other runners)
  python3 scripts/bp26_producers.py --dry [--only <collector>]   run collectors with live READS, print the results, write nothing
  python3 scripts/bp26_producers.py --list             list the discovered collectors
  python3 scripts/bp26_producers.py --selftest         offline suite

Never raises past run(): the consumer job must not fail because a probe did.
"""
import collections
import datetime
import glob
import importlib.util
import json
import os
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
# A module that does `from bp26_producers import Result, Collector` must get THIS module's classes even when this file runs as __main__.
sys.modules.setdefault("bp26_producers", sys.modules[__name__])
UA = "qnfo-bp26-probe/1 (+https://qnfo.org; fleet best-practice measurement)"
EVIDENCE_KEEP_DAYS = 40
BUDGET_S = int(os.environ.get("BP26_BUDGET_S", "300"))
BP26_TAG = "[BP26]"
# Hosts a collector may fetch without saying so: the fleet's own planes (docs/DOMAINS.md). Anything else needs ctx.http(..., external=True).
OWNED = ("qnfo.org", "q08.org", "qwav.org", "qwav.tech", "qwav.net", "qwav.uk", "qwave.tech", "q-wave.tech", "ipatent.me", "empoweringchange.today",
         "q08.workers.dev", "workers.dev")
# Databases a collector may never read: the personal plane and the two private planes (PLANE_REFUSED in remediation_consumer.py).
D1_REFUSED_PREFIX = ("personal", "qnfo-identity", "qnfo-outreach")

Result = collections.namedtuple("Result", "metric value note rows")
Result.__new__.__defaults__ = (None, "", ())
Collector = collections.namedtuple("Collector", "name fn metrics every_min")
Collector.__new__.__defaults__ = (None, None, (), 50)
Resp = collections.namedtuple("Resp", "status headers set_cookies text final_url ms hops error")


def now_iso(t=None):
    return datetime.datetime.fromtimestamp(time.time() if t is None else t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fmt_value(v):
    """The text stored in metric_registry.last_value: an int as an int, a float with at most 4 decimals and no trailing zeros."""
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    f = round(float(v), 4)
    s = ("%.4f" % f).rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


def host_owned(host):
    h = (host or "").lower().rstrip(".")
    return any(h == o or h.endswith("." + o) for o in OWNED)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def http_get(url, headers=None, timeout=20, max_bytes=262144, follow=5, external=False, opener=None, method="GET", data=None):
    """One fetch, redirects followed by hand (https only, up to `follow` hops). Never raises: a failure is Resp(status=0, error=<token>).
    The body is decoded as UTF-8 with replacement and cut at max_bytes; no credential is ever sent."""
    opener = opener or _OPENER
    hops, cur, t0 = [], url, time.time()
    for _ in range(max(1, follow) + 1):
        u = urllib.parse.urlparse(cur)
        if u.scheme != "https":
            return Resp(0, {}, [], "", cur, int((time.time() - t0) * 1000), hops, "not-https")
        if not external and not host_owned(u.hostname):
            return Resp(0, {}, [], "", cur, 0, hops, "host-not-owned")
        h = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5"}
        h.update(headers or {})
        req = urllib.request.Request(cur, headers=h, method=method, data=data)
        try:
            r = opener.open(req, timeout=timeout)
            status, hd, body = r.status, r.headers, r.read(max_bytes)
        except urllib.error.HTTPError as e:
            status, hd = e.code, e.headers
            try:
                body = e.read(max_bytes) if status not in (301, 302, 303, 307, 308) else b""
            except Exception:  # noqa: BLE001
                body = b""
            if status in (301, 302, 303, 307, 308) and hd.get("location"):
                hops.append((status, cur))
                cur = urllib.parse.urljoin(cur, hd.get("location"))
                continue
        except (socket.timeout, TimeoutError):
            return Resp(0, {}, [], "", cur, int((time.time() - t0) * 1000), hops, "timeout")
        except ssl.SSLError as e:
            return Resp(0, {}, [], "", cur, int((time.time() - t0) * 1000), hops, "tls:" + str(e)[:60])
        except Exception as e:  # noqa: BLE001
            return Resp(0, {}, [], "", cur, int((time.time() - t0) * 1000), hops, "error:" + type(e).__name__)
        low = {k.lower(): v for k, v in hd.items()}
        cookies = hd.get_all("set-cookie") or []
        return Resp(status, low, cookies, body.decode("utf-8", "replace"), cur, int((time.time() - t0) * 1000), hops, None)
    return Resp(0, {}, [], "", cur, int((time.time() - t0) * 1000), hops, "redirect-loop")


class Ctx(object):
    """What a collector sees. d1 reads and writes qnfo-audit (a collector reads; the framework writes the metric); d1_db reads any other account
    database by name, SELECT only, never a personal or private plane; http fetches a page; cf reads the Cloudflare API with the runner's token."""

    def __init__(self, d1=None, d1_db=None, http=None, cf=None, root=ROOT, deadline=None, now=None, dry=False):
        self._d1, self._d1_db, self._http, self._cf = d1, d1_db, http, cf
        self.root = root
        self.deadline = deadline
        self.now = now if now is not None else time.time()
        self.dry = dry

    def left(self):
        return 10 ** 6 if self.deadline is None else self.deadline - time.time()

    def d1(self, sql, params=None):
        if self._d1 is None:
            raise RuntimeError("no qnfo-audit access in this context")
        return self._d1(sql, params or [])

    def d1_db(self, name, sql, params=None):
        if self._d1_db is None:
            raise RuntimeError("no other-database access in this context")
        if str(name).startswith(D1_REFUSED_PREFIX):
            raise RuntimeError("database %s is a personal or private plane: refused" % name)
        s = sql.strip().lower()
        if not (s.startswith("select") or s.startswith("with")):
            raise RuntimeError("d1_db is read-only: a SELECT or WITH statement only")
        return self._d1_db(name, sql, params or [])

    def http(self, url, **kw):
        if self.left() < 3:
            return Resp(0, {}, [], "", url, 0, [], "budget-exhausted")
        return (self._http or http_get)(url, **kw)

    def cf(self, path):
        if self._cf is None:
            raise RuntimeError("no Cloudflare API access in this context")
        return self._cf(path)

    def read(self, relpath, limit=2 * 1024 * 1024):
        p = os.path.join(self.root, relpath)
        with open(p, "rb") as f:
            return f.read(limit).decode("utf-8", "replace")

    def git(self, *args):
        import subprocess
        try:
            r = subprocess.run(["git"] + list(args), capture_output=True, text=True, cwd=self.root, timeout=60)
            return r.stdout.strip() if r.returncode == 0 else ""
        except Exception:  # noqa: BLE001
            return ""


def discover(root=None):
    """[(module name, module)] for scripts/bp26_*.py other than this file and test files, sorted by name."""
    out = []
    base = os.path.join(root or ROOT, "scripts")
    for p in sorted(glob.glob(os.path.join(base, "bp26_*.py"))):
        name = os.path.basename(p)[:-3]
        if name in ("bp26_producers",) or name.endswith(("_test", "_selftest")):
            continue
        spec = importlib.util.spec_from_file_location(name, p)
        mod = importlib.util.module_from_spec(spec)
        if os.path.dirname(p) not in sys.path:
            sys.path.insert(0, os.path.dirname(p))
        try:
            spec.loader.exec_module(mod)
        except Exception as e:  # noqa: BLE001
            out.append((name, e))
            continue
        out.append((name, mod))
    return out


def collectors(root=None):
    found, errors = [], []
    for name, mod in discover(root):
        if isinstance(mod, Exception):
            errors.append({"module": name, "error": "import: " + str(mod)[:200]})
            continue
        for c in getattr(mod, "COLLECTORS", []) or []:
            if callable(getattr(c, "fn", None)) and hasattr(c, "name") and hasattr(c, "metrics") and hasattr(c, "every_min"):
                found.append(c)
            else:
                errors.append({"module": name, "error": "not a Collector: %r" % (c,)})
    return found, errors


def _fresh(last_refreshed, every_min, now):
    if not last_refreshed:
        return False
    try:
        t = datetime.datetime.strptime(str(last_refreshed)[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc).timestamp()
    except ValueError:
        return False
    return (now - t) < every_min * 60


def _stale_first(cols, fresh):
    """BP26-FAIR-ORDER-1 (RM-TP-8-TRUST-BOUNDARY, c5-resilience): order the collectors so a sweep that spends its budget cannot starve the same tail every time.
    Modules load in name order and the sweep stops at BUDGET_S, so a collector in a late module (bp26_web, bp26_writeroutes) ran only when every earlier one was
    still fresh; measured 2026-11-05: the 00:38Z sweep stopped at postmortem_ledger and left the metric registered at 23:59 unmeasured. Never-measured first, then the
    least recently refreshed; ties keep the module order (sorted() is stable), and collectors that ran together in one sweep stay in the order they ran."""
    def key(c):
        stamps = [str(fresh.get(m) or "")[:19].replace(" ", "T") for m in (c.metrics or ())]
        return min(stamps) if stamps else ""
    return sorted(cols, key=key)


def write_results(d1, results, stamp, collector, producer_note=""):
    """Metric rows first, evidence rows second. Returns (written metrics, skipped unknown metrics, errors)."""
    written, unknown, errors = [], [], []
    for r in results:
        if r.value is None:
            unknown.append(r.metric)
        else:
            try:
                d1("UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2, state = 'MEASURED', refresh_class = 'runner' "
                   "WHERE metric = ?3 AND instr(source_of_truth, ?4) > 0", [fmt_value(r.value), stamp, r.metric, BP26_TAG])
                written.append((r.metric, fmt_value(r.value)))
            except Exception as e:  # noqa: BLE001
                errors.append({"metric": r.metric, "error": "metric write: " + str(e)[:160]})
        rows = list(r.rows or [])[:60]
        if r.note:
            rows.insert(0, ("_summary", None if r.value is None else 1, str(r.note)[:300]))
        for i in range(0, len(rows), 12):
            chunk = rows[i:i + 12]
            params = []
            for subject, ok, detail in chunk:
                params += [stamp, r.metric, str(subject)[:200], None if ok is None else (1 if ok else 0), str(detail or "")[:300], collector]
            try:
                d1("INSERT INTO bp26_probe_results (run_at, metric, subject, ok, detail, producer) VALUES " + ", ".join(["(?,?,?,?,?,?)"] * len(chunk)), params)
            except Exception as e:  # noqa: BLE001
                errors.append({"metric": r.metric, "error": "evidence write: " + str(e)[:160]})
                break
    return written, unknown, errors


def run(d1=None, d1_db=None, http=None, cf=None, root=None, only=None, dry=False, force=False, now=None, out_rows=None):
    """Run every due collector. Never raises. Returns the summary dict printed by the runner step."""
    out = {"bp26_producers": "ok", "ran": [], "skipped": [], "written": [], "unknown": [], "errors": []}
    try:
        if d1 is None:
            sys.path.insert(0, HERE)
            import remediation_consumer as RC  # noqa: E402
            d1 = RC.d1
            if d1_db is None:
                def d1_db(name, sql, params=None):  # noqa: E306
                    pid, why = RC.plane_db_id("d1-query@" + name)
                    if not pid:
                        raise RuntimeError("database %s: %s" % (name, why))
                    r = RC._req("POST", "%s/accounts/%s/d1/database/%s/query" % (RC.CF_API, RC.ACCOUNT, pid), {"sql": sql, "params": params or []})
                    if not r.get("success"):
                        raise RuntimeError("d1 error: %s" % json.dumps(r.get("errors"))[:200])
                    res = r.get("result") or []
                    return (res[0].get("results") or []) if res else []
            if cf is None:
                def cf(path):  # noqa: E306
                    return RC._req("GET", RC.CF_API + path)
        t_now = time.time() if now is None else now
        deadline = time.time() + BUDGET_S
        cols, errs = collectors(root)
        out["errors"] += errs
        fresh = {}
        try:
            for r in d1("SELECT metric, last_refreshed FROM metric_registry WHERE instr(source_of_truth, ?1) > 0", [BP26_TAG]):
                fresh[r["metric"]] = r.get("last_refreshed")
        except Exception as e:  # noqa: BLE001
            out["errors"].append({"error": "registry read: " + str(e)[:160]})
        cols = _stale_first(cols, fresh)
        for c in cols:
            if only and c.name != only:
                continue
            if not force and not only and c.metrics and any(_fresh(fresh.get(m), c.every_min, t_now) for m in c.metrics):
                out["skipped"].append(c.name)
                continue
            if time.time() > deadline:
                out["skipped"].append(c.name + ":budget")
                continue
            ctx = Ctx(d1=d1, d1_db=d1_db, http=http, cf=cf, root=root or ROOT, deadline=deadline, now=t_now, dry=dry)
            t0 = time.time()
            try:
                results = [r for r in (c.fn(ctx) or []) if hasattr(r, "metric") and hasattr(r, "value") and hasattr(r, "rows")]
            except Exception as e:  # noqa: BLE001
                out["errors"].append({"collector": c.name, "error": (type(e).__name__ + ": " + str(e))[:200]})
                continue
            out["ran"].append({"collector": c.name, "ms": int((time.time() - t0) * 1000), "results": len(results)})
            if out_rows is not None:
                out_rows.extend(results)
            if dry:
                for r in results:
                    out["written"].append({"metric": r.metric, "value": None if r.value is None else fmt_value(r.value), "note": r.note, "rows": len(r.rows or [])})
                continue
            w, u, e = write_results(d1, results, now_iso(), c.name)
            out["written"] += [{"metric": m, "value": v} for m, v in w]
            out["unknown"] += u
            out["errors"] += e
        if not dry:
            summary = json.dumps({"ran": [x["collector"] for x in out["ran"]], "written": len(out["written"]), "unknown": out["unknown"], "errors": len(out["errors"])})[:1800]
            try:
                d1("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, ?2, 'bp26-producers', ?3, ?4, 'remediation-consumer', ?5)",
                   ["bp26-" + now_iso().replace(":", "").replace("-", ""), now_iso(), "BP26 runner producers: %d written, %d unknown, %d errors" % (len(out["written"]), len(out["unknown"]), len(out["errors"])),
                    summary, "ok" if not out["errors"] else "errors"])
                d1("DELETE FROM bp26_probe_results WHERE run_at < ?1", [now_iso(t_now - EVIDENCE_KEEP_DAYS * 86400)])
            except Exception as e:  # noqa: BLE001
                out["errors"].append({"error": "run row: " + str(e)[:160]})
    except Exception as e:  # noqa: BLE001
        out["bp26_producers"] = "failed: " + (type(e).__name__ + ": " + str(e))[:200]
    return out


# ---------------------------------------------------------------- selftest
def selftest():
    import sqlite3
    import tempfile
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
            print("FAIL " + m)
    ok(fmt_value(1) == "1" and fmt_value(0.93333) == "0.9333" and fmt_value(1.0) == "1" and fmt_value(0.5) == "0.5" and fmt_value(-0.00001) == "0" and fmt_value(True) == "1", "fmt_value")
    ok(host_owned("papers.qnfo.org") and host_owned("q08.org") and not host_owned("evilqnfo.org") and not host_owned("qnfo.org.evil.com") and not host_owned(""), "host_owned")
    ok(http_get("http://qnfo.org/").error == "not-https" and http_get("https://example.com/").error == "host-not-owned", "http_get refuses http and a host the fleet does not own")
    c = sqlite3.connect(":memory:")
    c.executescript("""
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT, source_of_truth TEXT);
INSERT INTO metric_registry VALUES ('m_ok', NULL, NULL, 'UNMEASURED', NULL, 'x [BP26]');
INSERT INTO metric_registry VALUES ('m_unknown', NULL, NULL, 'UNMEASURED', NULL, 'x [BP26]');
INSERT INTO metric_registry VALUES ('m_other', '7', '2026-01-01T00:00:00Z', 'MEASURED', NULL, 'someone else');
CREATE TABLE bp26_probe_results (id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT, metric TEXT, subject TEXT, ok INTEGER, detail TEXT, producer TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
""")

    def d1(sql, params=None):
        cur = c.execute(sql, params or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    td = tempfile.mkdtemp()
    os.makedirs(os.path.join(td, "scripts"))
    with open(os.path.join(td, "scripts", "bp26_demo.py"), "w") as f:
        f.write("from bp26_producers import Result, Collector\n"
                "def a(ctx):\n"
                "    return [Result('m_ok', 0.5, 'half', [('h1', 1, 'pass'), ('h2', 0, 'fail')]), Result('m_unknown', None, 'cannot read', []), Result('m_other', 1, 'must not be written', [])]\n"
                "def boom(ctx):\n"
                "    raise RuntimeError('probe broke')\n"
                "COLLECTORS = [Collector('a', a, ['m_ok', 'm_unknown'], 50), Collector('boom', boom, ['m_boom'], 50)]\n")
    with open(os.path.join(td, "scripts", "bp26_broken.py"), "w") as f:
        f.write("raise SyntaxError('module that does not import')\n")
    sys.path.insert(0, HERE)
    out = run(d1=d1, d1_db=lambda *a: [], root=td, force=True)
    ok(out["bp26_producers"] == "ok" and [x["collector"] for x in out["ran"]] == ["a"], "one collector ran, the one that raised is recorded: %r" % out)
    ok(any(e.get("collector") == "boom" for e in out["errors"]) and any(e.get("module") == "bp26_broken" for e in out["errors"]), "a raising collector and a broken module are recorded, not fatal: %r" % out["errors"])
    row = d1("SELECT last_value, state, refresh_class FROM metric_registry WHERE metric = 'm_ok'")[0]
    ok(row == {"last_value": "0.5", "state": "MEASURED", "refresh_class": "runner"}, "the value is written as MEASURED by the runner: %r" % row)
    ok(d1("SELECT last_value, state FROM metric_registry WHERE metric = 'm_unknown'")[0] == {"last_value": None, "state": "UNMEASURED"}, "a None result writes nothing")
    ok(d1("SELECT last_value FROM metric_registry WHERE metric = 'm_other'")[0]["last_value"] == "7", "a metric without the [BP26] tag is never overwritten")
    ev = d1("SELECT metric, subject, ok FROM bp26_probe_results WHERE metric = 'm_ok' ORDER BY id")
    ok([e["subject"] for e in ev] == ["_summary", "h1", "h2"] and [e["ok"] for e in ev] == [1, 1, 0], "the evidence rows and the summary are kept: %r" % ev)
    ok(d1("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind = 'bp26-producers'")[0]["n"] == 1, "one run row")
    out2 = run(d1=d1, d1_db=lambda *a: [], root=td)
    ok("a" in out2["skipped"], "a collector whose metrics are fresher than its cadence is skipped: %r" % out2["skipped"])
    # BP26-SELFTEST-FLAKE-1: the run row id is the second, so the non-dry run above wrote a second row whenever a second boundary fell between the runs and this
    # check, which then read 2 (1 of 6 selftests failed on main). Compare with the count before the dry run instead of assuming 1.
    n_rows = d1("SELECT COUNT(*) n FROM cloud_ops_events")[0]["n"]
    out3 = run(d1=d1, d1_db=lambda *a: [], root=td, force=True, dry=True)
    ok(all(r["metric"] for r in out3["written"]) and d1("SELECT COUNT(*) n FROM cloud_ops_events")[0]["n"] == n_rows, "dry writes nothing")
    # BP26-FAIR-ORDER-1: never-measured first, then the least recently refreshed; ties keep the module order
    mk = lambda n, ms: Collector(n, None, ms, 50)  # noqa: E731
    cols_ = [mk("a_early", ["x1"]), mk("b_mid", ["x2"]), mk("c_tail_new", ["x3"]), mk("d_tail_old", ["x4"]), mk("e_tie", ["x5"]), mk("f_multi", ["x6", "x7"]), mk("g_none", [])]
    fresh_ = {"x1": "2026-11-05T00:38:30Z", "x2": "2026-11-05T00:38:40Z", "x3": None, "x4": "2026-11-04T23:57:38Z", "x5": "2026-11-05T00:38:30Z", "x6": "2026-11-05T00:10:00Z", "x7": "2026-11-05 00:50:00"}
    order = [x.name for x in _stale_first(cols_, fresh_)]
    ok(order == ["c_tail_new", "g_none", "d_tail_old", "f_multi", "a_early", "e_tie", "b_mid"], "never-measured first, then the least recently refreshed, ties keep module order: %r" % order)
    ok([x.name for x in _stale_first(cols_, {})] == [x.name for x in cols_], "with no freshness data the module order is kept")
    # a sweep that spends its budget leaves the tail for the NEXT sweep: the starved collector now goes first
    td2 = tempfile.mkdtemp()
    os.makedirs(os.path.join(td2, "scripts"))
    with open(os.path.join(td2, "scripts", "bp26_fair.py"), "w") as f:
        f.write("import time\nfrom bp26_producers import Result, Collector\n"
                "def slow(ctx):\n"
                "    time.sleep(1.3)\n"
                "    return [Result('m_early', 1, 'slow ran', [])]\n"
                "def late(ctx):\n"
                "    time.sleep(1.3)\n"
                "    return [Result('m_late', 1, 'late ran', [])]\n"
                "COLLECTORS = [Collector('a_early', slow, ['m_early'], 50), Collector('z_late', late, ['m_late'], 50)]\n")
    c.execute("INSERT INTO metric_registry VALUES ('m_early', NULL, ?, 'MEASURED', 'runner', 'x [BP26]')", [now_iso(time.time() - 3600)])
    c.execute("INSERT INTO metric_registry VALUES ('m_late', NULL, NULL, 'UNMEASURED', NULL, 'x [BP26]')")
    saved_budget = globals()["BUDGET_S"]
    globals()["BUDGET_S"] = 1.0
    try:
        o_fair = run(d1=d1, d1_db=lambda *a: [], root=td2)
    finally:
        globals()["BUDGET_S"] = saved_budget
    ok([x["collector"] for x in o_fair["ran"]] == ["z_late"] and "a_early:budget" in o_fair["skipped"], "the never-measured late collector runs first and the budget cuts the early one: ran %r skipped %r" % (o_fair["ran"], o_fair["skipped"]))
    ctx = Ctx(d1=d1, d1_db=lambda *a: [], root=td)
    try:
        ctx.d1_db("personal-life", "SELECT 1")
        ok(False, "a personal plane must be refused")
    except RuntimeError:
        pass
    try:
        ctx.d1_db("q08-signal", "DELETE FROM x")
        ok(False, "d1_db must refuse a write")
    except RuntimeError:
        pass
    def down(*a, **k):
        raise RuntimeError("D1 down")
    o4 = run(d1=down, d1_db=lambda *a: [], root=td, force=True)
    ok(o4["bp26_producers"] == "ok" and o4["errors"], "a D1 outage is recorded and never raises: %r" % o4)
    print("bp26_producers selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    return 1 if fails else 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in argv:
        return selftest()
    if "--list" in argv:
        cols, errs = collectors()
        for c in cols:
            print("%-34s every %4d min  metrics=%s" % (c.name, c.every_min, ",".join(c.metrics)))
        for e in errs:
            print("ERROR", e)
        return 0
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    out = run(only=only, dry="--dry" in argv, force="--force" in argv)
    print(json.dumps(out)[:6000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
