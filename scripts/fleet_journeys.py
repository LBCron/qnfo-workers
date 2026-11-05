#!/usr/bin/env python3
# FLEET-JOURNEYS-1 (2026-10-13, pillar core). Owner question, verbatim: "Test all worker functionality and
# interconnectedness/routing. How to know if all workers actually work as intended end-to-end in real-world complex
# processes and workflows (not just simple probe results)?"
"""End-to-end journeys across the fleet, run from the GitHub runner.

WHY
  Measured 2026-10-13 23:30Z: all 28 live workers answered GET /health 200 from the runner, yet in the same minute qnfo-ops
  /fleet (the census that crosses service bindings) could not see 5 of them (cf-1042, healthy null), the dashboard verdict
  was DEGRADED with an integration-chain signal, and papers.qnfo.org reported 2 pages with render defects. A /health 200
  proves an isolate starts; it does not prove that a request crosses the bindings it depends on, that the data a loop
  writes is the data the next worker reads, or that a cron loop ran recently. This runner drives the fleet's real
  processes from outside the account (a Worker cannot fetch a sibling's *.workers.dev host, issue 1190) and asserts the
  effect at the far end of each one.

WHAT
  Each journey is a chain of requests where a later step consumes what an earlier one returned, so a broken hop fails the
  journey, not just a probe:
    deploy-coherence   repo VERSION on main == live /health version == qnfo-ops /registry version, per live worker
                       (a commit younger than DEPLOY_GRACE_MIN is "deploying", not a failure)
    binding-census     qnfo-ops /fleet crosses its service bindings to each worker; any healthy=false fails, healthy=null
                       (the census cannot see the worker) is reported as blind and fails above BLIND_MAX. Before the journeys run,
                       external_heartbeat (CENSUS-EXTERNAL-HEARTBEAT-1) probes each blind or 410 census row from the runner and, for one it
                       reached (HTTP 2xx, or the documented retired stub), upserts its fleet_heartbeat so qnfo-ops reads it healthy
    lock-roundtrip     qnfo-deploy-guard acquire -> /work-locks lists it -> release -> /work-locks no longer lists it
                       (worker + KV lease + D1 work_claims, written and read back by the public API)
    papers-path        papers.qnfo.org /api/papers -> the item's page -> /feed.json -> OAI-PMH GetRecord for the same id
                       (qnfo-gateway host routing, D1 papers, the feed and the harvest surface agree on one paper)
    ask-path           ask.qwav.tech /api/ask (qnfo-ai-search -> GATEWAY binding -> retrieval -> Workers AI) streams an
                       answer whose [n] citations are within its sources, and every cited source URL resolves on
                       papers.qnfo.org. One model call; opt-in here (JOURNEY_ASK=1), every 6 h server-side.
    loop-heartbeats    the cron loops ran recently: fleet-control /loops and /chaos-drill, dashboard /api/loop and
                       /api/state, ai-search /api/loop, gateway /api/render-health
    ai-router          qnfo-ai /health declares its bindings, /v1/models lists models, /v1/ensemble/policy answers
    dashboard-load     fleet.qnfo.org/ (HTML) and /api/managers (JSON) each answer 200 with a body; the journey's ms is the summed wall time of
                       both fetches, the dashboard load time a North Star reliability metric reads. Slowness never fails it (DASHBOARD-LOAD-1)

  Results: one journey_runs row per journey per run (runner gha; failed steps and the hops taken, never response bodies: this repository
  is public), the shared metric fleet_journeys_failing, and the shared self-closing issue "FLEET-JOURNEY-FAILED-1: <journey> (...)".
  FLEET-JOURNEYS-2: qnfo-fleet-control 0.27.0 runs the same journeys server-side every 20 minutes through service bindings (runner cf)
  and adds traffic-health from real traffic; this runner is the second path, from outside the account, over the public hostnames. An
  issue closes when one runner passes and the other's newest run in 2 h did not fail. The ask journey runs here only with JOURNEY_ASK=1.

RUNS  A step of remediation-consumer.yml (hourly, dispatched by qnfo-cloud-ops when the consumer is idle 60 min); at most
      once per JOURNEY_EVERY_MIN. --dry-run prints the journeys without writing D1. Never fails the job.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

UA = "qnfo-fleet-journeys/1 (+https://fleet.qnfo.org)"
JOURNEY_EVERY_MIN = int(os.environ.get("JOURNEY_EVERY_MIN", "50"))
DEPLOY_GRACE_MIN = int(os.environ.get("JOURNEY_DEPLOY_GRACE_MIN", "45"))
BLIND_MAX = int(os.environ.get("JOURNEY_BLIND_MAX", "0"))
TIMEOUT = int(os.environ.get("JOURNEY_TIMEOUT_S", "30"))
ISSUE_PREFIX = "FLEET-JOURNEY-FAILED-1"
METRIC = "fleet_journeys_failing"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

OPS = "https://qnfo-ops.q08.workers.dev"
GUARD = "https://qnfo-deploy-guard.q08.workers.dev"
CONTROL = "https://qnfo-fleet-control.q08.workers.dev"
DASH = "https://fleet.qnfo.org"
PAPERS = "https://papers.qnfo.org"
ASK = "https://ask.qwav.tech"
AI = "https://qnfo-ai.q08.workers.dev"
LOCK_KEY = "file:journeys/fleet-journeys.probe"

# HEALTH-URL-OVERRIDE-1 (agent_issues 1000750, GitHub 5743; 2026-11-05): a worker whose health route is not <name>.q08.workers.dev/health. qnfo-fleet-lee is deliberately
# exposed on lee.qnfo.org and answers 404 on /health at its workers.dev host, so qnfo-ops /fleet read it blind (healthy null) or down (false) in every run for days
# and binding-census failed on it from both runners. The runner is outside the account, so it can reach the custom host: external_heartbeat probes this URL instead
# and writes the heartbeat that qnfo-ops already honours (CRON-ONLY-HEARTBEAT-1). scripts/deploy-drift-guard.py UNMANAGED_HEALTH_URLS carries the same address.
HEALTH_URLS = {"qnfo-fleet-lee": "https://lee.qnfo.org/api/health"}

# LOOP-ERR-COVERED-1 (agent_issues 1001171, GitHub 6420): dashboard issue categories whose error level is judged by another journey. worker-errors is the per-worker
# error rate over real traffic, read by traffic-health every 20 minutes; counting it here made loop-heartbeats red for as long as any worker threw an exception,
# whatever the state of the loops this journey is named for.
LOOP_ERR_COVERED = ("worker-errors",)


def health_url(name):
    return HEALTH_URLS.get(name) or "https://%s.q08.workers.dev/health" % name

# Freshness budgets in minutes: at most the loop's cadence plus 120 minutes (SLA-120M-2, owner directive 2026-10-14: no SLA exceeds
# 120 minutes), so a missed run is detected within 120 minutes of its due time.
FRESH = {
    "fleet-control portfolio_last": 150,   # hourly
    "fleet-control charter_last": 26 * 60,  # daily
    "fleet-control chaos last_drill": 480,  # every 6 h: cadence + 120 min (SLA-120M-2, no SLA past 120 min after due)
    "dashboard last_sync": 45,             # 15 min
    "dashboard last_execute": 45,          # 15 min
    "dashboard state generated_at": 45,    # 15 min
    "ai-search loop runs[0]": 150,         # hourly
    "gateway render last_checked": 26 * 60,  # daily
}


# ---------------------------------------------------------------- transport

class Http:
    """GET/POST from the runner. Every call is logged as (method, url, status, ms) for the run record."""

    def __init__(self, opener=None):
        self.opener = opener or self._urlopen
        self.calls = []

    @staticmethod
    def _urlopen(method, url, body, headers):
        req = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.status, r.read(512 * 1024).decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read(64 * 1024).decode("utf-8", "replace")

    def req(self, method, url, data=None):
        # SYNTHETIC-TAG-1: workers that keep analytics (qnfo-ai-search 2.6.1) leave a journey request out of their metrics.
        headers = {"User-Agent": UA, "Accept": "application/json, text/event-stream, text/html;q=0.8", "x-qnfo-synthetic": "1"}
        body = None
        if data is not None:
            body = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"
        t0 = time.time()
        last = None
        for attempt in range(2):  # one retry, for transport errors only; an HTTP status is an answer
            try:
                status, text = self.opener(method, url, body, headers)
                self.calls.append((method, url, status, int((time.time() - t0) * 1000)))
                return status, text
            except Exception as e:  # noqa: BLE001
                last = e
                if attempt == 0:
                    time.sleep(2)
        self.calls.append((method, url, 0, int((time.time() - t0) * 1000)))
        return 0, "transport:%s" % type(last).__name__

    def json(self, method, url, data=None):
        status, text = self.req(method, url, data)
        try:
            return status, json.loads(text)
        except Exception:  # noqa: BLE001
            return status, None


class Journey:
    def __init__(self, name):
        self.name = name
        self.steps = []

    def check(self, step, ok, detail=""):
        self.steps.append({"step": step, "ok": bool(ok), "detail": str(detail)[:240]})
        return bool(ok)

    @property
    def ok(self):
        return bool(self.steps) and all(s["ok"] for s in self.steps)


def age_min(iso, now=None):
    """Minutes since an ISO-8601 or 'YYYY-MM-DD HH:MM:SS' UTC timestamp; None when unparseable."""
    if not iso:
        return None
    s = str(iso).replace(" ", "T")[:19]
    try:
        t = time.mktime(time.strptime(s, "%Y-%m-%dT%H:%M:%S")) - time.timezone
    except ValueError:
        return None
    return ((now or time.time()) - t) / 60.0


def fresh(j, label, iso, now=None):
    a = age_min(iso, now)
    lim = FRESH[label]
    return j.check("fresh: " + label, a is not None and a <= lim, "age %s min, budget %d" % ("?" if a is None else int(a), lim))


# ---------------------------------------------------------------- repo state

def live_dirs(root=REPO):
    """Worker dirs on this checkout that deploy: a wrangler.toml, a worker.js, and no RETIRED or FOLDED marker."""
    out = {}
    for d in sorted(os.listdir(root)):
        p = os.path.join(root, d)
        if not os.path.isfile(os.path.join(p, "wrangler.toml")) or not os.path.isfile(os.path.join(p, "worker.js")):
            continue
        if os.path.exists(os.path.join(p, "RETIRED")) or os.path.exists(os.path.join(p, "FOLDED")):
            continue
        name = d
        with open(os.path.join(p, "wrangler.toml"), encoding="utf-8") as f:
            m = re.search(r'^name\s*=\s*"([^"]+)"', f.read(), re.M)
            if m:
                name = m.group(1)
        with open(os.path.join(p, "worker.js"), encoding="utf-8", errors="replace") as f:
            # The declaration, not a comment that quotes it (qnfo-model-eval's `var VERSION = "..."` note, agent_issues 100008);
            # minified bundles write it without spaces (qnfo-email, qnfo-gateway).
            v = re.search(r'^[ \t]*var VERSION\s*=\s*"([^"\n]*)"', f.read(200000), re.M)
        out[name] = {"dir": d, "version": v.group(1) if v else None}
    return out


def commit_age_min(path, root=REPO):
    try:
        ts = subprocess.run(["git", "-C", root, "log", "-1", "--format=%ct", "--", path], capture_output=True, text=True, timeout=20).stdout.strip()
        return (time.time() - int(ts)) / 60.0 if ts else None
    except Exception:  # noqa: BLE001
        return None


_MAIN_HEAD = {}


def main_version(d, root=REPO):
    """JOURNEY-MAIN-FRESH-1 (2026-10-19, agent_issues 100076): the VERSION of <d>/worker.js on the newest origin/main. The consumer
    queues (concurrency cancel-in-progress false), so its checkout can be several merges behind main when the journey runs, and a
    worker deployed from a later merge read as "live != main" (8 of 41 steps on 2026-10-19 07:51Z, every live version ahead of the
    checkout and equal to main). One shallow fetch per run; None when git or the network fails, so the checkout's verdict stands."""
    if "ref" not in _MAIN_HEAD:
        try:
            r = subprocess.run(["git", "-C", root, "fetch", "--quiet", "--depth=1", "origin", "main"], capture_output=True, text=True, timeout=60)
            _MAIN_HEAD["ref"] = "FETCH_HEAD" if r.returncode == 0 else None
        except Exception:  # noqa: BLE001
            _MAIN_HEAD["ref"] = None
    if not _MAIN_HEAD["ref"]:
        return None
    try:
        src = subprocess.run(["git", "-C", root, "show", "%s:%s/worker.js" % (_MAIN_HEAD["ref"], d)], capture_output=True, text=True, timeout=20).stdout
        v = re.search(r'^[ \t]*var VERSION\s*=\s*"([^"\n]*)"', src[:200000], re.M)
        return v.group(1) if v else None
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------- journeys

def j_deploy_coherence(h, repo=None, commit_age=commit_age_min, main_ver=main_version):
    j = Journey("deploy-coherence")
    repo = repo if repo is not None else live_dirs()
    j.check("repo lists live workers", len(repo) > 0, "%d" % len(repo))
    st, reg = h.json("GET", OPS + "/registry")
    regv = {r.get("service"): r.get("version") for r in ((reg or {}).get("registry") or [])}
    j.check("qnfo-ops /registry answers", st == 200 and regv, "http %s, %d rows" % (st, len(regv)))
    for name, info in sorted(repo.items()):
        st, hj = h.json("GET", "https://%s.q08.workers.dev/health" % name)
        live = (hj or {}).get("version") if isinstance(hj, dict) else None
        if not j.check("%s /health answers" % name, st == 200 and live, "http %s" % st):
            continue
        want = info.get("version")
        if want and live != want:
            a = commit_age(os.path.join(info["dir"], "worker.js"))
            if a is not None and a < DEPLOY_GRACE_MIN:
                j.check("%s deploying" % name, True, "main %s, live %s, commit %d min old" % (want, live, int(a)))
                continue  # the registry follows the deploy; judge it on the next run
            if main_ver(info["dir"]) == live:
                j.check("%s live == main" % name, True, "checkout %s is behind main; live %s == main" % (want, live))
                continue
            j.check("%s live == main" % name, False, "main %s, live %s" % (want, live))
        if name in regv and regv[name] and regv[name] != live:
            j.check("%s registry == live" % name, False, "registry %s, live %s" % (regv[name], live))
    return j


ATTESTED_KEY = "census_external_attested"


def external_heartbeat(d1, h, now=None):
    """CENSUS-EXTERNAL-HEARTBEAT-1 (agent_issues 100166, 2026-10-26). qnfo-ops /fleet judges a worker by a service binding or by its
    workers.dev URL; a worker with no binding is answered cf-1042 from inside the account (healthy null, "blind"), and the repository-root
    stub qnfo-workers (a deliberate HTTP 410 that Cloudflare Workers Builds redeploys on every push) reads healthy false. qnfo-ops already
    judges such a worker by its fleet_heartbeat row when fresh (CRON-ONLY-HEARTBEAT-1, under 2 h). This runner is outside the account, so
    it can reach those hosts: for each census row that is blind (or a 410), it probes /health itself and, only when it saw HTTP 2xx or the
    documented retired stub (410 with {"status": "retired"}), upserts the worker's heartbeat. A worker that answers an error stays
    unhealthy; a row that is healthy:false for any other reason is never touched.
    CENSUS-EXTERNAL-HEARTBEAT-2 (2026-10-26): the first version wrote only while a row was blind, so the heartbeat it wrote aged out two
    hours later (run 8863 at 18:18Z, expiry 20:18Z) and the runner, which runs about hourly, healed it only after the census had been
    blind for up to an hour, which reopened FLEET-JOURNEY-FAILED-1 on every cycle. The names this runner has attested are kept in
    ops_config census_external_attested; a row judged healthy by its heartbeat is probed again every run when its name is on that list, so
    the heartbeat never ages out while the host answers. A cron-only worker that writes its own heartbeat is never on the list, so its
    stale heartbeat still reads as a dead cron. Returns the names written."""
    st, d = h.json("GET", OPS + "/fleet")
    rows = (d or {}).get("fleet") or []
    if st != 200 or not rows:
        return []
    at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now or time.time()))
    attested = set()
    try:
        got = d1("SELECT value FROM ops_config WHERE key = ?1", [ATTESTED_KEY])
        attested = set(json.loads((got[0] or {}).get("value") or "[]")) if got else set()
    except Exception:  # noqa: BLE001 - an unreadable list only means no refresh of an already-healthy row this run
        attested = set()
    wrote = []
    for r in rows:
        name = r.get("name")
        if not name:
            continue
        if r.get("healthy") is True and not (name in attested and r.get("probe") == "heartbeat"):
            continue
        blind = r.get("healthy") is None or "1042" in str(r.get("error") or "")
        if not (blind or r.get("http") == 410):
            continue
        status, text = h.req("GET", health_url(name))
        try:
            body = json.loads(text)
        except Exception:  # noqa: BLE001
            body = None
        retired = status == 410 and isinstance(body, dict) and body.get("status") == "retired"
        if not (200 <= status < 300 or retired):
            continue
        version = "retired-stub" if retired else str((body or {}).get("version") or (body or {}).get("VERSION") or "")[:40] if isinstance(body, dict) else ""
        d1("INSERT INTO fleet_heartbeat (worker, version, ts, ok) VALUES (?1, ?2, ?3, 1) ON CONFLICT(worker) DO UPDATE SET version = excluded.version, ts = excluded.ts, ok = 1",
           [name, version, at])
        wrote.append(name)
    now_set = attested | set(wrote)
    if now_set != attested:
        d1("INSERT INTO ops_config (key, value, note, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
           [ATTESTED_KEY, json.dumps(sorted(now_set)), "CENSUS-EXTERNAL-HEARTBEAT-2: workers whose fleet_heartbeat is written by scripts/fleet_journeys.py from outside the account", at])
    return wrote


def j_binding_census(h):
    j = Journey("binding-census")
    st, d = h.json("GET", OPS + "/fleet")
    rows = (d or {}).get("fleet") or []
    if not j.check("qnfo-ops /fleet answers", st == 200 and rows, "http %s, %d rows" % (st, len(rows))):
        return j
    down = [r.get("name") for r in rows if r.get("healthy") is False]
    # CENSUS-RETIRED-NOT-BLIND-1 (agent_issues 100166): a row qnfo-ops marks retired (a live stub that answered 410 with a retired marker, OPS-FLEET-RETIRED-1) is a third state, neither up nor down
    # and left out of the healthy / total ratio; it keeps healthy null by design and skips the heartbeat merge, so counting it as blind failed this journey for as long as the repository-root stub
    # qnfo-workers (which Workers Builds recreates on every push) answered 410.
    blind = [r.get("name") for r in rows if r.get("healthy") is None and r.get("retired") is not True]
    j.check("no worker unhealthy through the census", not down, ",".join(down))
    j.check("census sees every worker (blind <= %d)" % BLIND_MAX, len(blind) <= BLIND_MAX, ",".join(blind))
    return j


def j_lock_roundtrip(h):
    j = Journey("lock-roundtrip")
    owner = "fleet-journeys-%d" % int(time.time())
    st, a = h.json("POST", GUARD + "/work-lock/acquire", {"key": LOCK_KEY, "owner": owner, "intent": "FLEET-JOURNEYS-1 round trip", "ttl_sec": 120})
    token = (a or {}).get("token")
    if not j.check("acquire", 200 <= st < 300 and (a or {}).get("acquired") and token, "http %s acquired %s holder %s" % (st, (a or {}).get("acquired"), (a or {}).get("holder"))):
        return j
    try:
        st, l1 = h.json("GET", GUARD + "/work-locks")
        listed = any(owner == (c.get("holder") or c.get("owner")) for c in ((l1 or {}).get("claims") or []))
        j.check("/work-locks lists the claim", 200 <= st < 300 and listed, "http %s" % st)
    finally:
        st, r = h.json("POST", GUARD + "/work-lock/release", {"key": LOCK_KEY, "token": token, "outcome": "done"})
        j.check("release", 200 <= st < 300, "http %s %s" % (st, json.dumps(r)[:120]))
    st, l2 = h.json("GET", GUARD + "/work-locks")
    still = any(owner == (c.get("holder") or c.get("owner")) for c in ((l2 or {}).get("claims") or []))
    j.check("/work-locks no longer lists it", 200 <= st < 300 and not still, "http %s" % st)
    return j


def j_papers_path(h):
    j = Journey("papers-path")
    st, d = h.json("GET", PAPERS + "/api/papers?limit=1")
    items = (d or {}).get("items") or []
    if not j.check("/api/papers lists a paper", 200 <= st < 300 and items and (d or {}).get("total", 0) > 0, "http %s total %s" % (st, (d or {}).get("total"))):
        return j
    it = items[0]
    slug, pid, title = it.get("slug"), it.get("id"), (it.get("title") or "")
    st, page = h.req("GET", PAPERS + "/papers/" + str(slug))
    # The page may typeset or escape the title; the first 24 plain characters are enough to prove it is this paper.
    norm = lambda x: re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ]", " ", re.sub(r"<[^>]+>", " ", x))).strip().lower()  # noqa: E731
    probe = norm(title)[:24].strip()
    j.check("paper page renders the listed paper", 200 <= st < 300 and probe and probe in norm(page), "http %s" % st)
    st, feed = h.json("GET", PAPERS + "/feed.json")
    fitems = (feed or {}).get("items") or []
    j.check("feed.json carries the newest paper", 200 <= st < 300 and any(str(slug) in json.dumps(x) for x in fitems), "http %s, %d items" % (st, len(fitems)))
    if pid:
        st, oai = h.req("GET", PAPERS + "/oai?verb=GetRecord&metadataPrefix=oai_dc&identifier=" + urllib.request.quote(str(pid), safe=":"))
        j.check("OAI-PMH GetRecord returns the same id", 200 <= st < 300 and str(pid) in oai and "<error" not in oai, "http %s" % st)
    return j


def parse_sse(text):
    events = []
    ev, data = None, []
    for line in text.splitlines() + [""]:
        if line.startswith("event:"):
            ev = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].strip())
        elif not line.strip() and (ev or data):
            try:
                events.append((ev, json.loads("\n".join(data))))
            except Exception:  # noqa: BLE001
                events.append((ev, None))
            ev, data = None, []
    return events


ASK_QUERY = os.environ.get("JOURNEY_ASK_QUERY", "What is the silent radix?")


def j_ask_path(h):
    j = Journey("ask-path")
    st, text = h.req("POST", ASK + "/api/ask", {"query": ASK_QUERY})
    events = parse_sse(text) if 200 <= st < 300 else []
    if not j.check("ask streams", 200 <= st < 300 and events, "http %s, %d events" % (st, len(events))):
        return j
    meta = next((d for e, d in events if e == "meta" and isinstance(d, dict)), {}) or {}
    sources = meta.get("sources") or []
    answer = "".join((d or {}).get("t", "") for e, d in events if e == "token" and isinstance(d, dict))
    done = next((d for e, d in events if e == "done"), None)
    j.check("retrieval returned sources", len(sources) > 0, "%d" % len(sources))
    j.check("answer is non-empty and finished", len(answer) > 80 and done is not None, "%d chars, done %s" % (len(answer), done is not None))
    cites = sorted({int(n) for grp in re.findall(r"\[(\d+(?:\s*,\s*\d+)*)\]", answer) for n in re.split(r"\s*,\s*", grp)})
    j.check("answer cites its sources", cites and max(cites) <= len(sources) and min(cites) >= 1, "cites %s of %d" % (cites[:8], len(sources)))
    for n in [c for c in cites if 1 <= c <= len(sources)][:3]:
        url = (sources[n - 1] or {}).get("url") or ""
        if url.startswith(PAPERS):
            st, _ = h.req("GET", url)
            j.check("cited source [%d] resolves" % n, 200 <= st < 300, "%s http %s" % (url[len(PAPERS):][:80], st))
    return j


def dashboard_error_issues(state):
    """Error-level dashboard issues this journey owns: those outside LOOP_ERR_COVERED. 1 when the state carries nothing to count (an unreadable answer is a failure)."""
    issues = (state or {}).get("issues")
    if isinstance(issues, list):
        return sum(1 for i in issues if isinstance(i, dict) and i.get("sev") == "err" and i.get("category") not in LOOP_ERR_COVERED)
    counts = (state or {}).get("issue_counts")
    return (counts or {}).get("err", 1) if isinstance(counts, dict) else 1


def j_loop_heartbeats(h, now=None):
    j = Journey("loop-heartbeats")
    st, d = h.json("GET", CONTROL + "/loops")
    d = d or {}
    j.check("fleet-control LOOP-WATCH healthy", st == 200 and d.get("healthy") is True, "findings %s" % json.dumps(d.get("findings"))[:160])
    fresh(j, "fleet-control portfolio_last", (d.get("portfolio_last") or {}).get("ts"), now)
    fresh(j, "fleet-control charter_last", (d.get("charter_last") or {}).get("ts"), now)
    st, c = h.json("GET", CONTROL + "/chaos-drill")
    c = c or {}
    fresh(j, "fleet-control chaos last_drill", c.get("last_drill"), now)
    j.check("chaos drill: every component tested in 24 h", st == 200 and c.get("untested_24h") == 0, "untested %s" % c.get("untested_24h"))
    failing = [p.get("component") for p in (c.get("probes") or []) if p.get("enabled") and p.get("last_pass") == 0]
    j.check("chaos drill: no enabled component failing", not failing, "; ".join(str(x)[:50] for x in failing))
    st, l = h.json("GET", DASH + "/api/loop")
    l = l or {}
    fresh(j, "dashboard last_sync", l.get("last_sync"), now)
    fresh(j, "dashboard last_execute", l.get("last_execute"), now)
    fails = ((l.get("last_execute_summary") or {}).get("failed") or 0)
    j.check("dashboard executor: no failed actions", fails == 0, "failed %s" % fails)
    st, s = h.json("GET", DASH + "/api/state")
    s = s or {}
    fresh(j, "dashboard state generated_at", s.get("generated_at"), now)
    errs = dashboard_error_issues(s)
    j.check("dashboard state: no error-level issues", st == 200 and errs == 0, "error-level issues outside %s: %s; issue_counts %s verdict %s" % ("/".join(LOOP_ERR_COVERED), errs, s.get("issue_counts"), s.get("verdict")))
    st, a = h.json("GET", ASK + "/api/loop")
    runs = (a or {}).get("runs") or []
    fresh(j, "ai-search loop runs[0]", runs[0].get("ts") if runs else None, now)
    st, r = h.json("GET", PAPERS + "/api/render-health")
    fresh(j, "gateway render last_checked", (r or {}).get("last_checked"), now)
    return j


def j_ai_router(h):
    j = Journey("ai-router")
    st, d = h.json("GET", AI + "/health")
    b = (d or {}).get("bindings") or {}
    # Bindings the router's own routes cross (service bindings and D1); the vector indexes and optional keys are reported, not judged.
    need = ("ai", "auth", "query_db", "qnfo_infra", "qnfo_intent")
    missing = [k for k in need if not b.get(k)]
    j.check("qnfo-ai /health declares its routing bindings", st == 200 and not missing, "missing %s" % ",".join(missing))
    st, m = h.json("GET", AI + "/v1/models")
    j.check("/v1/models lists models", st == 200 and len((m or {}).get("data") or []) > 0, "http %s" % st)
    st, p = h.json("GET", AI + "/v1/ensemble/policy")
    j.check("/v1/ensemble/policy answers", st == 200 and isinstance(p, dict), "http %s" % st)
    return j


def j_dashboard_load(h):
    """DASHBOARD-LOAD-1: how long the owner's dashboard takes to load, measured from the runner (outside Cloudflare, so it is what a browser sees).

    The recorded journey_runs.ms is the wall time of this whole function, i.e. the SUM of the two sequential GETs (home HTML, then /api/managers JSON);
    the per-request times are also in path_json. Pass = HTTP 200 and a non-empty body for both. Slowness is never a failure here: a failing journey files
    FLEET-JOURNEY-FAILED-1, and a slow dashboard is the business of the metric trigger that reads ms. Only an error status, an empty body or a network
    error sets ok=false. Both fetches always run (no early return), so ms covers both even when the first fails. Per-request timeout is TIMEOUT (30 s)."""
    j = Journey("dashboard-load")
    for label, path in (("dashboard home (HTML)", "/"), ("/api/managers (JSON)", "/api/managers")):
        t0 = time.time()
        st, body = h.req("GET", DASH + path)
        ms = int((time.time() - t0) * 1000)
        j.check("%s answers 200 with a body" % label, st == 200 and bool((body or "").strip()), "http %s, %d bytes, %d ms" % (st, len(body or ""), ms))
    return j


JOURNEYS = [j_deploy_coherence, j_binding_census, j_lock_roundtrip, j_papers_path, j_ask_path, j_loop_heartbeats, j_ai_router, j_dashboard_load]


def run_all(h=None, skip_ai=None):
    h = h or Http()
    # FLEET-JOURNEYS-2: qnfo-fleet-control asks every 6 h server-side (ai-search answers about 11 real questions a day, so an hourly
    # synthetic one would swamp its metrics); this runner asks only when JOURNEY_ASK=1.
    skip_ai = os.environ.get("JOURNEY_ASK") != "1" if skip_ai is None else skip_ai
    out = []
    for fn in JOURNEYS:
        if skip_ai and fn is j_ask_path:
            continue
        t0 = time.time()
        c0 = len(h.calls)
        try:
            j = fn(h)
        except Exception as e:  # noqa: BLE001 - a crashed journey is a failed journey, never a silent one
            j = Journey(fn.__name__[2:].replace("_", "-"))
            j.check("journey ran", False, "%s: %s" % (type(e).__name__, e))
        out.append({"journey": j.name, "ok": j.ok, "ms": int((time.time() - t0) * 1000), "steps": len(j.steps),
                    "failed": [s for s in j.steps if not s["ok"]], "passed": [s["step"] for s in j.steps if s["ok"]],
                    "path": [{"via": "https", "to": _host_worker(u), "path": _host_path(u), "status": st, "ms": ms} for (_m, u, st, ms) in h.calls[c0:]]})
    return out


def _host_path(url):
    m = re.match(r"https?://([^/?#]+)([^?#]*)", url)
    return (m.group(1) + m.group(2))[:120] if m else url[:120]


HOST_WORKER = {"papers.qnfo.org": "qnfo-gateway", "ask.qwav.tech": "qnfo-ai-search", "fleet.qnfo.org": "qnfo-fleet-dashboard"}


def _host_worker(url):
    host = (re.match(r"https?://([^/?#]+)", url) or [None, ""])[1]
    if host.endswith(".q08.workers.dev"):
        return host[: -len(".q08.workers.dev")]
    return HOST_WORKER.get(host, host)


# ---------------------------------------------------------------- record

def due(d1):
    rows = d1("SELECT MAX(ts) AS t FROM journey_runs WHERE runner = 'gha'")
    t = rows[0].get("t") if rows else None
    a = age_min(t)
    return a is None or a >= JOURNEY_EVERY_MIN


def record(d1, results, verifier, now=None):
    """One journey_runs row per journey (runner gha), the shared metric, and the shared self-closing issue per failing journey."""
    now = now or time.time()
    at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
    since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - 7200))
    failing = [r for r in results if not r["ok"]]
    for r in results:
        d1("INSERT INTO journey_runs (ts, runner, journey, ok, steps, failed, ms, failed_json, path_json, version) VALUES (?1, 'gha', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
           [at, r["journey"], 1 if r["ok"] else 0, r["steps"], len(r["failed"]), r["ms"], json.dumps(r["failed"])[:4000], json.dumps(r.get("path") or [])[:4000], verifier])
    # Same rule as qnfo-fleet-control: a journey fails while its newest run (either runner, within 2 h) failed.
    m = d1("SELECT COUNT(*) AS n FROM (SELECT journey FROM journey_runs r WHERE ts > ?1 AND id = (SELECT MAX(id) FROM journey_runs x WHERE x.journey = r.journey "
           "AND x.runner = r.runner AND x.ts > ?1) GROUP BY journey HAVING MIN(ok) = 0)", [since])
    d1("UPDATE metric_registry SET last_value = ?2, last_refreshed = ?3, state = 'MEASURED' WHERE metric = ?1", [METRIC, str((m[0] or {}).get("n", len(failing)) if m else len(failing)), at])
    now_ms = int(now * 1000)
    actions = {}
    for r in results:
        title_like = "%s: %s %%" % (ISSUE_PREFIX, r["journey"])
        open_rows = d1("SELECT id FROM agent_issues WHERE status = 'open' AND title LIKE ?1", [title_like])
        if r["ok"]:
            # RELAPSE-HOLD-1 gha-journeys: ensure a prior passing gha run exists at least 10 min earlier and after the issue's last reopen
            # Fetch the most recent previous gha run for this journey
            prev_gha = d1(
                "SELECT ok, ts FROM journey_runs WHERE journey = ?1 AND runner = 'gha' AND ts < ?2 ORDER BY ts DESC LIMIT 1",
                [r["journey"], at],
            )
            # Fetch the issue's last updated timestamp (used for reopen tracking)
            issue_info = d1(
                "SELECT updated_at FROM agent_issues WHERE id = ?1",
                [open_rows[0]["id"]] if open_rows else [None],
            )
            keep_open = False
            # Condition: no prior passing gha run, or it is too recent (<10 min), or it occurred before the issue was (re)opened
            if not prev_gha or int(prev_gha[0].get("ok") or 0) != 1:
                keep_open = True
            else:
                prev_ts = prev_gha[0].get("ts")
                # Ensure at least 10 minutes earlier than the current run
                if prev_ts is None or age_min(prev_ts, now) < 10:
                    keep_open = True
                else:
                    # Compare timestamps: if the previous run is not after the issue's last update, keep open
                    issue_updated = issue_info[0].get("updated_at") if issue_info else None
                    if issue_updated is not None:
                        # Convert ISO timestamp to epoch milliseconds
                        try:
                            t_struct = time.strptime(prev_ts[:19], "%Y-%m-%dT%H:%M:%S")
                            prev_epoch_ms = int((time.mktime(t_struct) - time.timezone) * 1000)
                        except Exception:  # noqa: BLE001
                            prev_epoch_ms = None
                        if prev_epoch_ms is None or prev_epoch_ms <= issue_updated:
                            keep_open = True
            if keep_open:
                actions[r["journey"]] = "kept open: first passing run"
                continue
            if not open_rows:
                continue
            other = d1("SELECT ok FROM journey_runs WHERE journey = ?1 AND runner <> 'gha' AND ts > ?2 ORDER BY id DESC LIMIT 1", [r["journey"], since])
            if other and int(other[0].get("ok") or 0) == 0:
                actions[r["journey"]] = "kept open: the server-side runner's newest run failed"
                continue
            for o in open_rows:
                d1("UPDATE issue_triage SET close_evidence = ?1 WHERE issue_id = ?2",
                   ["FLEET-JOURNEYS-1 %s: journey %s passed all %d steps end to end from the GitHub runner (%s); journey_runs runner gha; path %s"
                    % (at, r["journey"], r["steps"], verifier, " > ".join("%s %s" % (x["to"], x["status"]) for x in (r.get("path") or []))[:300]), o["id"]])
                d1("UPDATE agent_issues SET status = 'closed', close_channel = 'auto-recovery', updated_at = ?1 WHERE id = ?2", [now_ms, o["id"]])
            actions[r["journey"]] = "closed %s" % ",".join(str(o["id"]) for o in open_rows)
            continue
        listing = "; ".join("%s (%s)" % (x["step"], x["detail"]) for x in r["failed"])[:1500]
        path = " > ".join("%s %s %s %dms" % (x["to"], x["path"], x["status"], x["ms"]) for x in (r.get("path") or []))[:1200]
        title = "%s: %s (%d of %d steps failing)" % (ISSUE_PREFIX, r["journey"], len(r["failed"]), r["steps"])
        desc = ("Filed by scripts/fleet_journeys.py (FLEET-JOURNEYS-1) from the GitHub runner, outside the account, at %s. The %s journey drives a "
                "real multi-worker process end to end over the public hostnames and checks the effect at its far end. Failing steps: %s. Path "
                "taken: %s. Every run is in qnfo-audit journey_runs; GET https://qnfo-fleet-control.q08.workers.dev/journeys shows both runners. "
                "This issue closes itself the first run the journey passes every step. Pillar core.") % (at, r["journey"], listing, path or "none")
        if open_rows:
            d1("UPDATE agent_issues SET title = ?1, description = ?2, updated_at = ?3 WHERE id = ?4", [title, desc, now_ms, open_rows[0]["id"]])
            actions[r["journey"]] = "updated %s" % open_rows[0]["id"]
        else:
            d1("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) "
               "SELECT ?1, ?2, 'fleet-journeys', 'reliability', 'high', 'open', ?3, ?3 WHERE NOT EXISTS "
               "(SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE ?4)", [title, desc, now_ms, title_like])
            actions[r["journey"]] = "filed"
    return {"at": at, "journeys": len(results), "failing": [r["journey"] for r in failing], "issues": actions}


def run(d1, verifier, h=None, force=False):
    if not force and not due(d1):
        return {"skipped": "ran within %d min" % JOURNEY_EVERY_MIN}
    h = h or Http()
    try:
        heartbeats = external_heartbeat(d1, h)
    except Exception as e:  # noqa: BLE001 - the census journey then reports the blind worker, as before
        heartbeats = "error %s: %s" % (type(e).__name__, str(e)[:120])
    results = run_all(h)
    out = record(d1, results, verifier)
    out["heartbeats"] = heartbeats
    out["results"] = [{"journey": r["journey"], "ok": r["ok"], "ms": r["ms"], "failed": [s["step"] for s in r["failed"]]} for r in results]
    return out


# ---------------------------------------------------------------- selftest

def selftest():
    """Offline: canned answers for every URL prove each journey's pass and fail paths and the record/issue lifecycle."""
    now = time.time()
    iso = lambda m: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - m * 60))  # noqa: E731
    state = {"claims": []}

    def site(break_hop=None):
        def opener(method, url, body, headers):
            b = json.loads(body) if body else {}
            if url == OPS + "/registry":
                return 200, json.dumps({"registry": [{"service": "w1", "version": "1.0.0"}]})
            if url == "https://w1.q08.workers.dev/health":
                return 200, json.dumps({"version": "1.0.1" if break_hop == "deploy" else "1.0.0"})
            if url == OPS + "/fleet":
                return 200, json.dumps({"fleet": [{"name": "w1", "healthy": None if break_hop == "blind" else True}] + ([{"name": "stub", "healthy": None, "retired": True}] if break_hop == "retired" else [])})
            if url == GUARD + "/work-lock/acquire":
                state["claims"].append({"holder": b["owner"]})
                return 200, json.dumps({"acquired": True, "token": "t"})
            if url == GUARD + "/work-lock/release":
                if break_hop != "release":
                    state["claims"].clear()
                return 200, "{}"
            if url == GUARD + "/work-locks":
                return 200, json.dumps({"claims": list(state["claims"])})
            if url == PAPERS + "/api/papers?limit=1":
                return 200, json.dumps({"total": 1, "items": [{"id": "oai:papers.qnfo.org:p1", "slug": "p1", "title": "A Paper on Things"}]})
            if url == PAPERS + "/papers/p1":
                return (404, "") if break_hop == "page" else (200, "<h1>A Paper on <em>Things</em></h1>")
            if url == PAPERS + "/feed.json":
                return 200, json.dumps({"items": [{"url": PAPERS + "/papers/p1"}]})
            if url.startswith(PAPERS + "/oai?"):
                return 200, "<record><identifier>oai:papers.qnfo.org:p1</identifier></record>"
            if url == ASK + "/api/ask":
                cite = "[3]" if break_hop == "cite" else "[1]"
                return 200, ('event: meta\ndata: {"sources":[{"url":"%s/papers/p1"}]}\n\nevent: token\ndata: {"t":"%s"}\n\nevent: done\ndata: {"id":"a"}\n\n'
                             % (PAPERS, "The answer is long enough to count as a real answer to the question asked here, " + cite))
            if url == CONTROL + "/loops":
                return 200, json.dumps({"healthy": True, "findings": [], "portfolio_last": {"ts": iso(30)}, "charter_last": {"ts": iso(600)}})
            if url == CONTROL + "/chaos-drill":
                return 200, json.dumps({"last_drill": iso(60), "untested_24h": 0, "probes": [{"component": "x", "enabled": 1, "last_pass": 1}]})
            if url == DASH + "/api/loop":
                return 200, json.dumps({"last_sync": iso(500 if break_hop == "stale" else 5), "last_execute": iso(5), "last_execute_summary": {"failed": 0}})
            if url == DASH + "/api/state":
                if break_hop in ("worker-err", "loop-err"):
                    cat = "worker-errors" if break_hop == "worker-err" else "stale-loop"
                    return 200, json.dumps({"generated_at": iso(5), "issue_counts": {"err": 1, "warn": 0, "total": 1}, "issues": [{"sev": "err", "category": cat}, {"sev": "warn", "category": "general"}]})
                return 200, json.dumps({"generated_at": iso(5), "issue_counts": {"err": 0}, "issues": []})
            if url == ASK + "/api/loop":
                return 200, json.dumps({"runs": [{"ts": iso(20)}]})
            if url == PAPERS + "/api/render-health":
                return 200, json.dumps({"last_checked": iso(300).replace("T", " ").rstrip("Z")})
            if url == AI + "/health":
                return 200, json.dumps({"bindings": {"ai": True, "auth": True, "query_db": True, "qnfo_infra": True, "qnfo_intent": True}})
            if url == AI + "/v1/models":
                return 200, json.dumps({"data": [{"id": "qnfo"}]})
            if url == AI + "/v1/ensemble/policy":
                return 200, "{}"
            if url in (DASH + "/", DASH + "/api/managers"):
                if break_hop == "dash-slow":
                    time.sleep(0.12)  # slow but healthy: must still pass
                if break_hop == "dash-500" and url.endswith("/managers"):
                    return 500, "boom"
                if break_hop == "dash-empty" and url == DASH + "/":
                    return 200, "   "
                return 200, "<html>ok</html>" if url == DASH + "/" else json.dumps({"managers": []})
            return 404, ""
        return opener

    repo = {"w1": {"dir": "w1", "version": "1.0.0"}}
    old = lambda p: 600  # noqa: E731
    young = lambda p: 5  # noqa: E731
    checks = []

    def expect(label, cond):
        checks.append((label, bool(cond)))

    def run_one(fn, hop=None, **kw):
        state["claims"].clear()
        return fn(Http(site(hop)), **kw)

    expect("deploy passes", run_one(j_deploy_coherence, repo=repo, commit_age=old, main_ver=lambda d: "1.0.0").ok)
    expect("deploy mismatch fails", not run_one(j_deploy_coherence, "deploy", repo=repo, commit_age=old, main_ver=lambda d: "1.0.0").ok)
    expect("deploy mismatch in grace passes", run_one(j_deploy_coherence, "deploy", repo=repo, commit_age=young).ok)
    expect("deploy mismatch with the checkout behind main passes", run_one(j_deploy_coherence, "deploy", repo=repo, commit_age=old, main_ver=lambda d: "1.0.1").ok)
    expect("deploy mismatch with main unreadable fails", not run_one(j_deploy_coherence, "deploy", repo=repo, commit_age=old, main_ver=lambda d: None).ok)
    expect("census passes", run_one(j_binding_census).ok)
    expect("census blind fails", not run_one(j_binding_census, "blind").ok)
    expect("census: a retired row (healthy null, retired true) is not blind", run_one(j_binding_census, "retired").ok)

    # CENSUS-EXTERNAL-HEARTBEAT-1: the runner attests the workers qnfo-ops cannot probe, and only those it reached.
    hb_rows = [{"name": "w1", "healthy": True},
               {"name": "blind-ok", "healthy": None, "error": "cf-1042-no-published-route (probe blocked; target state unknown)"},
               {"name": "stub", "healthy": False, "http": 410},
               {"name": "blind-down", "healthy": None},
               {"name": "real-down", "healthy": False, "http": 500, "error": "boom"},
               {"name": "gone410", "healthy": False, "http": 410},
               {"name": "own-beat", "healthy": True, "probe": "heartbeat", "error": "cf-1042-no-published-route (probe blocked; target state unknown)"},
               {"name": "kept", "healthy": True, "probe": "heartbeat", "error": "cf-1042-no-published-route (probe blocked; target state unknown)"},
               {"name": "kept-down", "healthy": True, "probe": "heartbeat", "error": "cf-1042-no-published-route (probe blocked; target state unknown)"},
               {"name": "qnfo-fleet-lee", "healthy": None, "error": "cf-1042-no-published-route (probe blocked; target state unknown)"}]

    def hb_opener(method, url, body, headers):
        if url == OPS + "/fleet":
            return 200, json.dumps({"fleet": hb_rows})
        if url == "https://blind-ok.q08.workers.dev/health":
            return 200, json.dumps({"ok": True, "version": "3.1.4"})
        if url == "https://stub.q08.workers.dev/health":
            return 410, json.dumps({"status": "retired", "reason": "x"})
        if url == "https://blind-down.q08.workers.dev/health":
            return 503, "{}"
        if url == "https://gone410.q08.workers.dev/health":
            return 410, json.dumps({"error": "gone"})
        if url == "https://kept.q08.workers.dev/health":
            return 200, json.dumps({"ok": True, "version": "7.0.1"})
        if url == "https://kept-down.q08.workers.dev/health":
            return 502, ""
        if url == "https://own-beat.q08.workers.dev/health":
            return 200, json.dumps({"ok": True, "version": "9.9.9"})
        # HEALTH-URL-OVERRIDE-1: the worker's health route is on its custom host; the workers.dev /health is a 404, as qnfo-fleet-lee's is
        if url == "https://lee.qnfo.org/api/health":
            return 200, json.dumps({"ok": True})
        if url == "https://qnfo-fleet-lee.q08.workers.dev/health":
            return 404, ""
        return 500, ""

    # CENSUS-EXTERNAL-HEARTBEAT-2: "kept" and "kept-down" were attested by an earlier run and are healthy only through that heartbeat; "own-beat"
    # is a cron-only worker that writes its own heartbeat (never on the list), so it is neither probed nor refreshed.
    hb_http, hb_sql = Http(hb_opener), []
    hb_store = {ATTESTED_KEY: json.dumps(["kept", "kept-down", "stub"])}

    def hb_d1(sql, p=None):
        hb_sql.append((sql, p))
        if sql.startswith("SELECT value FROM ops_config"):
            return [{"value": hb_store[p[0]]}] if p[0] in hb_store else []
        if sql.startswith("INSERT INTO ops_config"):
            hb_store[p[0]] = p[1]
        return []

    def hb_beats():
        return [(p[0], p[1]) for s, p in hb_sql if s.startswith("INSERT INTO fleet_heartbeat")]

    hb_wrote = external_heartbeat(hb_d1, hb_http, now=now)
    expect("heartbeat: a blind worker the runner reaches, the retired stub and an attested worker that is judged by its heartbeat are written",
           hb_wrote == ["blind-ok", "stub", "kept", "qnfo-fleet-lee"])
    expect("heartbeat: the version is recorded and the stub is marked retired-stub", hb_beats() == [("blind-ok", "3.1.4"), ("stub", "retired-stub"), ("kept", "7.0.1"), ("qnfo-fleet-lee", "")])
    expect("heartbeat: a blind worker that answers 503, a real failure and a plain 410 are not masked",
           not {"blind-down", "real-down", "gone410"} & set(hb_wrote))
    expect("heartbeat: an attested worker whose host answers an error is not refreshed, so its heartbeat ages out and the census shows it",
           "kept-down" not in hb_wrote)
    expect("heartbeat: a worker with its own heartbeat is never probed or refreshed, so a dead cron still ages out",
           "own-beat" not in hb_wrote and not [u for (_m, u, _s, _ms) in hb_http.calls if "own-beat." in u])
    expect("heartbeat: a row that is healthy through a real probe is never probed", not [u for (_m, u, _s, _ms) in hb_http.calls if "w1." in u])
    expect("heartbeat: the attested list gains the new names and keeps the others",
           json.loads(hb_store[ATTESTED_KEY]) == ["blind-ok", "kept", "kept-down", "qnfo-fleet-lee", "stub"])
    n_before = len(hb_sql)
    hb_http2 = Http(hb_opener)
    external_heartbeat(hb_d1, hb_http2, now=now)
    expect("heartbeat: a second pass writes the list only when it changed", not [1 for s, _p in hb_sql[n_before:] if s.startswith("INSERT INTO ops_config")])
    expect("heartbeat: an unreadable list falls back to attesting blind rows only",
           external_heartbeat(lambda sql, p=None: (_ for _ in ()).throw(RuntimeError("d1 down")) if sql.startswith("SELECT") else [], Http(hb_opener), now=now) == ["blind-ok", "stub", "qnfo-fleet-lee"])
    expect("heartbeat: HEALTH_URLS sends qnfo-fleet-lee to its custom host and never to the workers.dev 404",
           ("GET", "https://lee.qnfo.org/api/health") in [(m, u) for (m, u, _s, _ms) in hb_http.calls] and not [u for (_m, u, _s, _ms) in hb_http.calls if "qnfo-fleet-lee.q08" in u]
           and health_url("kept") == "https://kept.q08.workers.dev/health" and health_url("qnfo-fleet-lee") == "https://lee.qnfo.org/api/health")
    expect("heartbeat: an unreadable census writes nothing", external_heartbeat(lambda sql, p=None: hb_sql.append(1) or [], Http(lambda m, u, b, hd: (500, ""))) == [])
    expect("lock passes", run_one(j_lock_roundtrip).ok)
    expect("lock left behind fails", not run_one(j_lock_roundtrip, "release").ok)
    expect("papers passes", run_one(j_papers_path).ok)
    expect("papers page 404 fails", not run_one(j_papers_path, "page").ok)
    expect("ask passes", run_one(j_ask_path).ok)
    expect("ask out-of-range citation fails", not run_one(j_ask_path, "cite").ok)
    expect("loops pass", run_one(j_loop_heartbeats).ok)
    expect("stale loop fails", not run_one(j_loop_heartbeats, "stale").ok)
    # LOOP-ERR-COVERED-1: an error-level dashboard issue in a category another journey judges (worker-errors) does not fail the loops; one about anything else still does.
    expect("loops: an error-level worker-errors dashboard issue is traffic-health's, not a loop failure", run_one(j_loop_heartbeats, "worker-err").ok)
    expect("loops: an error-level dashboard issue of another category fails", not run_one(j_loop_heartbeats, "loop-err").ok)
    expect("loops: an answer with no issues list falls back to issue_counts.err", dashboard_error_issues({"issue_counts": {"err": 2}}) == 2 and dashboard_error_issues({}) == 1 and dashboard_error_issues({"issues": [], "issue_counts": {"err": 5}}) == 0)
    expect("ai router passes", run_one(j_ai_router).ok)
    # DASHBOARD-LOAD-1: registered under its name; passes on 200 + body; an error status or an empty body fails; slow-but-200 passes with ms = summed fetch time.
    expect("dashboard-load is registered", j_dashboard_load in JOURNEYS and run_one(j_dashboard_load).name == "dashboard-load")
    expect("dashboard-load passes on 200 with bodies", run_one(j_dashboard_load).ok)
    expect("dashboard-load 500 on /api/managers fails", not run_one(j_dashboard_load, "dash-500").ok)
    expect("dashboard-load empty home body fails", not run_one(j_dashboard_load, "dash-empty").ok)
    expect("dashboard-load transport error (status 0) fails", not j_dashboard_load(Http(lambda m, u, b, hd: (0, ""))).ok)
    saved_journeys = list(JOURNEYS)
    JOURNEYS[:] = [j_dashboard_load]
    try:
        slow = run_all(Http(site("dash-slow")), skip_ai=True)
    finally:
        JOURNEYS[:] = saved_journeys
    expect("dashboard-load slow-but-200 passes and records ms as the summed fetch time (2 x 120 ms)",
           len(slow) == 1 and slow[0]["journey"] == "dashboard-load" and slow[0]["ok"] is True and slow[0]["ms"] >= 200
           and len(slow[0]["path"]) == 2 and all(p["to"] == "qnfo-fleet-dashboard" and p["status"] == 200 for p in slow[0]["path"]))
    expect("age_min parses both forms", abs(age_min(iso(10)) - 10) < 1 and abs(age_min(iso(10).replace("T", " ").rstrip("Z")) - 10) < 1)

    # Record lifecycle on an in-memory SQLite with the production columns: a failing journey files once, updates on the next failure,
    # stays open while the server-side runner's newest run fails, and closes with evidence once both pass.
    import sqlite3
    con = sqlite3.connect(":memory:")
    con.executescript("""CREATE TABLE journey_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, runner TEXT NOT NULL, journey TEXT NOT NULL,
        ok INTEGER NOT NULL, steps INTEGER, failed INTEGER, ms INTEGER, failed_json TEXT, path_json TEXT, healed_json TEXT, version TEXT);
      CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT,
        status TEXT, close_channel TEXT, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, close_evidence TEXT);
      CREATE TRIGGER t AFTER INSERT ON agent_issues BEGIN INSERT INTO issue_triage (issue_id) VALUES (NEW.id); END;
      CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);
      INSERT INTO metric_registry (metric) VALUES ('fleet_journeys_failing');""")
    con.row_factory = sqlite3.Row

    def d1(sql, params=None):
        cur = con.execute(re.sub(r"\?(\d+)", lambda m: ":p" + m.group(1), sql), {"p%d" % (i + 1): v for i, v in enumerate(params or [])})
        rows = [dict(r) for r in cur.fetchall()]
        con.commit()
        return rows

    q = lambda sql: [dict(r) for r in con.execute(sql).fetchall()]  # noqa: E731
    path = [{"via": "https", "to": "qnfo-gateway", "path": "papers.qnfo.org/papers/p1", "status": 500, "ms": 9}]
    bad = [{"journey": "papers-path", "ok": False, "ms": 1, "steps": 3, "failed": [{"step": "x", "ok": False, "detail": "y"}], "passed": [], "path": path}]
    good = [{"journey": "papers-path", "ok": True, "ms": 1, "steps": 3, "failed": [], "passed": ["a", "b", "c"], "path": [dict(path[0], status=200)]}]
    t = now
    r1 = record(d1, bad, "selftest", now=t)
    r2 = record(d1, bad, "selftest", now=t + 60)
    iss = q("SELECT * FROM agent_issues")
    expect("first failure files one issue", r1["issues"].get("papers-path") == "filed" and len(iss) == 1 and "qnfo-gateway papers.qnfo.org/papers/p1 500" in iss[0]["description"])
    expect("second failure updates it", r2["issues"].get("papers-path") == "updated 1" and len(q("SELECT id FROM agent_issues")) == 1)
    expect("metric counts failing journeys", q("SELECT last_value v FROM metric_registry")[0]["v"] == "1")
    con.execute("INSERT INTO journey_runs (ts, runner, journey, ok) VALUES (?, 'cf', 'papers-path', 0)", [time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t + 90))])
    r3 = record(d1, good, "selftest", now=t + 120)
    expect("stays open while the server-side newest run fails", q("SELECT status FROM agent_issues")[0]["status"] == "open" and "kept open" in r3["issues"].get("papers-path", ""))
    con.execute("INSERT INTO journey_runs (ts, runner, journey, ok) VALUES (?, 'cf', 'papers-path', 1)", [time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t + 150))])
    r4 = record(d1, good, "selftest", now=t + 180)
    row = q("SELECT a.status, t.close_evidence FROM agent_issues a JOIN issue_triage t ON t.issue_id = a.id")[0]
    expect("closes with evidence once both runners pass", row["status"] == "closed" and "passed all 3 steps" in row["close_evidence"] and "qnfo-gateway 200" in row["close_evidence"] and r4["issues"].get("papers-path") == "closed 1")
    expect("metric returns to 0", q("SELECT last_value v FROM metric_registry")[0]["v"] == "0")
    expect("one gha row per journey per run", q("SELECT COUNT(*) n FROM journey_runs WHERE runner = 'gha'")[0]["n"] == 4)
    expect("host to worker mapping", _host_worker("https://papers.qnfo.org/x") == "qnfo-gateway" and _host_worker("https://qnfo-ops.q08.workers.dev/fleet") == "qnfo-ops")

    failed = [c for c, ok in checks if not ok]
    return {"selftest": "ok" if not failed else "fail", "checks": len(checks), "failed": failed}


def main(argv):
    if "--selftest" in argv:
        st = selftest()
        print(json.dumps(st))
        return 0 if st["selftest"] == "ok" else 1
    if "--dry-run" in argv:
        res = run_all()
        print(json.dumps(res, indent=1))
        print("\n".join("%s %-18s %3d steps %6d ms  %s" % ("PASS" if r["ok"] else "FAIL", r["journey"], r["steps"], r["ms"],
                        "; ".join("%s (%s)" % (s["step"], s["detail"]) for s in r["failed"])[:400]) for r in res), file=sys.stderr)
        return 0
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import remediation_consumer as RC  # noqa: E402
    try:
        out = run(RC.d1, "github-runner/%s" % os.environ.get("GITHUB_RUN_ID", "local"), force="--force" in argv)
    except Exception as e:  # noqa: BLE001 - never fails the job; the missing heartbeat is itself measured
        out = {"fleet_journeys": "error", "error": "%s: %s" % (type(e).__name__, str(e)[:200])}
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
