#!/usr/bin/env python3
# REMEDIATION-CONSUMER-1 (2026-09-30)
"""Consume the qnfo-audit `remediation_contracts` registry.

MEASURED STATE BEFORE THIS FILE
  qnfo-audit held 18 active rows in `remediation_contracts`, 8 enabled rows in
  `remediation_modules`, and TWO armed auto-close triggers
  (remediation_verification_autoclose_ins / _upd) that close an `agent_issues`
  row the moment a `remediation_verifications` row lands with pass=1, a trusted
  transport and non-empty expected/observed. What did NOT exist was any process
  that read the contract table, so every contract sat at attempts=0 /
  last_verdict=NULL and the auto-close machine could never fire once.

CONTRACT (do not weaken)
  1. A probe is executed only when it is a LITERAL read-only SELECT. Anything
     else is SKIPPED and stamped `probe-not-machine-executable`; the issue stays
     OPEN. Fail-closed by design: a guessed pass would auto-close a live defect.
  2. The probe MUST return one row carrying `expected` and `observed` (by name,
     or positionally as the first two columns). The consumer never invents either
     value - both come from the probe - so the
     `remediation_verification_evidence_guard_ins` BEFORE-INSERT guard
     (VACUOUS-VERIFICATION-EVIDENCE-1) cannot be tripped and no close can rest on
     a fabricated expectation.
  3. pass = 1 only when expected == observed and both are non-empty.
  4. The verification transport must be `trusted=1` in `transport_trust`, or the
     row is not written at all.
  5. This consumer writes no repository file except its own ci-status artifact.

RUNTIME PROBES (PROBE-TRANSPORT-MONOCULTURE-1, agent_issues 2060, 2026-10-06)
  From 2026-10-01 to 2026-10-06 every automated verification (1707 rows) was a
  SQL read of qnfo-audit: fleet-control's tick selects verify_transport =
  'd1-query' only and this file knew only D1. transport_trust listed nine trusted
  runtime transports with no executor behind any of them, so a runtime defect (a
  slow page, a dead route) could only be closed by narrative. This file now runs
  runtime probes from the GitHub-hosted runner, a vantage outside the Cloudflare
  account whose code it checks, as transport `runner-https`. It is
  the mirror of PROBE-TRANSPORTS-1 (agent_issues 2059): there qnfo-fleet-control
  runs `external-https` from Cloudflare against hosts OUTSIDE the fleet and
  refuses fleet hosts (a same-account fetch is not independent, issue 1190);
  here the runner checks the fleet's own hosts from outside. The two transports
  never select each other's contracts. The probe is declarative JSON, never
  code: {"url": "https://...", "status": 200, "contains": "...", "max_ms": 3000}.
  6. GET only, https only, no credentials, hosts in HTTPS_HOSTS only (every
     redirect hop too), at most HTTPS_READ_CAP bytes read.
  7. expected is the literal token 'ok'; observed is 'ok' or a failure token
     (status=404, missing-marker, slow=4123ms, error:<type>). No response body
     ever leaves the probe: this repository is public.
  8. A pass holds the contract for RT_HOLD_D days before it closes (the
     REMEDIATION-HOLD-1 rule fleet-control applies to d1-query); a fail streak of
     max_attempts after a pass or closure reopens the issue (REMEDIATION-REOPEN-1).
     A module 'runtime-liveness-v1' contract never closes; when it has no issue
     and fails max_attempts times in a row it files one RUNTIME-PROBE-FAIL-1
     issue and adopts it, so the autoclose trigger closes that issue on recovery.
  9. Each run writes metric runtime_verified_share_24h (share of the last 24h of
     verifications on a trusted, independent, runtime-observable transport); its
     trigger breaches if this runner stops, which a Cloudflare cron evaluates.

DEFERRALS (CONSUMER-PENDING-IS-DEFERRAL-1, 2026-10-19)
  10. A d1-query read whose observed starts with 'pending' is a deferral, as it is in
     qnfo-fleet-control's tick: verdict 'deferred', counted as skipped, no
     remediation_verifications row, last_verdict 'deferred' (never 'fail'). A pending
     read that carries a number against a bound (the measured-pending shape the D1
     trigger remediation_reopen_on_relapse_d1 still counts) remains a failure.
"""

import calendar
import json
import re
import concurrent.futures
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CF_API = "https://api.cloudflare.com/client/v4"
ACCOUNT = os.environ.get("CF_ACCOUNT_ID") or os.environ.get("CLOUDFLARE_ACCOUNT_ID") or ""
TOKEN = (os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CF_API_TOKEN") or "")
DB_NAME = os.environ.get("REMEDIATION_DB", "qnfo-audit")
DB_ID = os.environ.get("D1_DATABASE_ID", "")
VERIFIER = "remediation-consumer@%s" % (os.environ.get("GITHUB_SHA", "local")[:12])
MAX_ITEMS = int(os.environ.get("REMEDIATION_MAX_ITEMS", "10"))
# PROBE-DRAIN-1: a run drains the due set within this budget (the job also runs other steps inside its 15-minute timeout).
PROBE_BUDGET_S = int(os.environ.get("REMEDIATION_BUDGET_S", "300"))
PROBE_WORKERS = max(1, int(os.environ.get("REMEDIATION_WORKERS", "8")))  # REMEDIATION-2X-1: was 4

WRITE_KW = (
    "insert into", "update ", "delete from", "drop table", "drop index",
    "alter table", "create table", "create index", "create trigger",
    "attach ", "detach ", "pragma ", "replace into", "vacuum",
)

CONTRACT_SQL = """
SELECT class, issue_id, precondition, action, verify_probe, verify_transport,
       max_attempts, escalate_to, expected_cadence_h, module, budget_ms,
       next_due_at, max_items, attempts, last_verdict, ts
FROM remediation_contracts
WHERE (status = 'active' OR (status = 'holding' AND verify_transport = 'runner-https'))
  AND verify_transport NOT IN ('external-https', 'd1-query@portfolio-state')
  AND (next_due_at IS NULL OR datetime(next_due_at) <= datetime('now'))
ORDER BY CASE WHEN verify_transport = 'runner-https' THEN 0 ELSE 1 END,
         COALESCE(next_due_at, ts)
LIMIT ?
"""

# PROBE-TRANSPORT-MONOCULTURE-1: the runtime transport this file executes itself (see the docstring, rules 6-9).
HTTPS_TRANSPORT = "runner-https"
# CODE-READ-PROBE-1 (2026-10-11): transport_trust has listed code-read as trusted, but nothing executed it, so an issue whose
# defect IS the code (a dead caller, a hard-coded table, a missing workflow guard) could only carry needs-machine-probe (17
# open issues on 2026-10-11). This runner works in a checkout of main, so it reads the files itself. Spec (JSON data, never
# code): {"paths": ["dir/file.js", ...], "contains": "<exact text>", "absent": "<exact text>"}; ok when every path exists and
# every file contains `contains` and none contains `absent` (both case-sensitive). It proves the code on main, not behaviour:
# use it where the code state is the defect, and a runtime or D1 probe for behaviour.
CODE_TRANSPORT = "code-read"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# PROBE-PLANES-1: qwav.tech (ask.qwav.tech) and qwav.org are fleet hosts in fleet-control RT_FLEET_HOSTS as well, and a
# Worker may not probe them (issue 1190), so only this runner can.
# The spare domains (qwav.uk, qwav.net, qwave.tech) are fleet zones too, probed for their redirects (SPARE-DOMAIN-CANON-1).
HTTPS_HOSTS = ("qnfo.org", "q08.org", "q08.workers.dev", "qwav.tech", "qwav.org", "qwav.uk", "qwav.net", "qwave.tech")
HTTPS_READ_CAP = 512 * 1024
HTTPS_TIMEOUT_S = 20
RT_HOLD_D = 7
RT_HOLD_CADENCE_H = 1
LIVENESS_MODULE = "runtime-liveness-v1"


def log(msg):
    sys.stderr.write("[consumer] %s\n" % msg)
    sys.stderr.flush()


def _req(method, url, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "qnfo-remediation-consumer/1")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # CONSUMER-ERROR-BODY-1 (2026-10-17): D1 answers a refused statement with HTTP 400 and the real SQLite message
        # in the body. urllib raised with the body unread, so every failing contract reported "HTTP Error 400: Bad
        # Request" and nothing could be attributed (529 contracts at probe-error). Surface the body.
        try:
            detail = e.read().decode("utf-8", "replace")[:600]
        except Exception:  # noqa: BLE001 - the status still carries the failure
            detail = ""
        raise RuntimeError("HTTP %s from %s: %s" % (e.code, url, detail or e.reason)) from None


def resolve_db_id():
    global DB_ID
    if DB_ID:
        return DB_ID
    r = _req("GET", "%s/accounts/%s/d1/database?per_page=100" % (CF_API, ACCOUNT))
    for d in (r.get("result") or []):
        if d.get("name") == DB_NAME:
            DB_ID = d.get("uuid") or d.get("id")
            return DB_ID
    raise RuntimeError("D1 database %r not found for this account" % DB_NAME)


def d1(sql, params=None):
    url = "%s/accounts/%s/d1/database/%s/query" % (CF_API, ACCOUNT, resolve_db_id())
    r = _req("POST", url, {"sql": sql, "params": params or []})
    if not r.get("success"):
        raise RuntimeError("d1 error: %s" % json.dumps(r.get("errors")))
    res = r.get("result") or []
    return (res[0].get("results") or []) if res else []


# PLANE-PROBE-1 (2026-10-01, #1649; owner directive: no dependency on continued Claude usage). Some evidence lives in a
# separate data plane that no QNFO worker may bind (PERSONAL-QNFO-SEPARATION-1): personal-api writes brief_cron_runs to
# personal-life only. A contract whose transport names an allowlisted plane runs its probe against that database through
# the Cloudflare API, read-only and subject to the same literal-SELECT gate. Only the probe's expected/observed tokens
# leave the plane; this repository is public, so a plane probe must never select content. fleet-control's hourly tick
# runs transport 'd1-query' only, so plane contracts are executed here alone.
PLANE_DBS = {"d1-query@personal-life": "e8d6c61a-10b7-4086-b81e-9e6e85afa407"}
# PROBE-PLANES-1 (2026-10-06, agent_issues 2075, owner question "why do fleet probes only run as SQL against qnfo-audit"):
# a contract may name any D1 database of the account by name, d1-query@<name>, resolved through the Cloudflare API at run
# time (one list call per run). Before this, a d1-query@<name> other than personal-life fell through to qnfo-audit and ran
# the probe against the wrong database. Refused planes hold other people's data (owner documents, outreach contacts): a
# probe there could copy a row into this public repository's run log, so their contracts are skipped, never run.
# d1-query@portfolio-state and external-https are qnfo-fleet-control's (its hourly tick runs them on Cloudflare), so the
# due query above leaves them alone instead of stamping them unexecutable.
PLANE_REFUSED = ("qnfo-identity", "qnfo-outreach")
FLEET_CONTROL_TRANSPORTS = ("external-https", "d1-query@portfolio-state")
_PLANE_IDS = {}


def plane_db_id(transport, lister=None):
    """d1-query@<name> -> (database id, None) or (None, reason). lister() returns the account's [{name, uuid}] list."""
    t = str(transport or "")
    if t in PLANE_DBS:
        return PLANE_DBS[t], None
    if not t.startswith("d1-query@"):
        return None, "not-a-plane"
    name = t.split("@", 1)[1].strip()
    if not name or name == DB_NAME:
        return None, "plane-is-the-default-db"
    if name in PLANE_REFUSED:
        return None, "plane-refused"
    if name not in _PLANE_IDS:
        listed = (lister or _list_dbs)()
        for d in listed or []:
            _PLANE_IDS[d.get("name")] = d.get("uuid") or d.get("id")
    pid = _PLANE_IDS.get(name)
    return (pid, None) if pid else (None, "plane-not-found")


def _list_dbs():
    r = _req("GET", "%s/accounts/%s/d1/database?per_page=100" % (CF_API, ACCOUNT))
    return r.get("result") or []


# SLA-PATHS-1 (2026-10-17, owner directive): evidence persistence carries more than one path. INSERT INTO
# remediation_verifications is refused at prepare time with 7500 "triggers nested too deep" whenever the
# agent_issues trigger chain deepens (verified 2026-10-17T16:12Z; issue 2817), and this consumer then wrote nothing
# at all: a green run reported verdicts that no reader could see. Path B is remediation_evidence, the trigger-free
# sink unioned by v_remediation_evidence_all. The primary error travels with the row, so a reader never has to guess
# which path produced it.
# FIRST-PASS-CLOSE-1 (2026-10-26, pillar autonomy; remediation session rem-a4): the D1 triggers remediation_verification_autoclose_ins and
# issue_close_evidence_required refuse to close an issue while a contract of it still carries a refusal verdict in last_verdict (fail, vacuous-probe-result,
# probe-error, probe-not-machine-executable, probe-same-account-host). This runner writes the pass row first and stamps the contract afterwards (consume_one),
# so the trigger read the verdict of the PREVIOUS run: the first passing read of a contract that had been failing never closed its issue, the next run did.
# Measured 2026-10-26 on qnfo-audit over 3 days of trigger closes: 79 of the 212 closes of issues that had never been reopened had an earlier pass since the
# contract's last fail, and waited 6.2 hours on average for the second read (the 45 reopened issues wait for two passes by design and are unchanged).
# A pass now stamps the contract's refusal verdict to 'pass' immediately before its row is written, so the trigger sees the verdict this read produced;
# consume_one stamps the same value afterwards. A fail, a deferral and a contract that is no longer active or holding are untouched, and a refused
# stamp is logged and changes nothing (the row and the later stamp are unchanged).
REFUSAL_VERDICTS = ("fail", "vacuous-probe-result", "probe-error", "probe-not-machine-executable", "probe-same-account-host")


def stamp_pass_before_row(cls, passed):
    """Move the stored refusal verdict of the contract this passing read belongs to out of the way of the close triggers."""
    if passed != 1 or not cls:
        return False
    try:
        d1(
            "UPDATE remediation_contracts SET last_verdict = 'pass' WHERE class = ? AND status IN ('active', 'holding') "
            "AND COALESCE(last_verdict, '') IN (%s)" % ", ".join("'%s'" % v for v in REFUSAL_VERDICTS),
            [cls],
        )
        return True
    except Exception as e:  # noqa: BLE001 - best effort: consume_one stamps the same verdict after the row
        log("contract %s pass pre-stamp failed: %s" % (cls, e))
        return False


def record_verification(issue_id, cls, probe_url, transport, expected, observed, passed):
    """Write the verdict to path A; on refusal write the identical row to path B and return (path, primary_error)."""
    stamp_pass_before_row(cls, passed)
    try:
        d1(
            "INSERT INTO remediation_verifications "
            "(issue_id, class, probe_url, transport, expected, observed, pass, verifier) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [issue_id, cls, probe_url, transport, expected, observed, passed, VERIFIER],
        )
        return "A:verifications", None
    except RuntimeError as e_a:
        primary = str(e_a)
        d1(
            "INSERT INTO remediation_evidence "
            "(issue_id, class, probe_url, transport, expected, observed, pass, verifier, path) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [issue_id, cls, probe_url, transport, expected, observed, passed, VERIFIER, "B:consumer"],
        )
        print(json.dumps({"evt": "remediation-consumer:evidence-fallback", "class": cls,
                          "transport": transport, "primary_error": primary}))
        return "B:evidence-table", primary

def d1_plane(transport, sql):
    pid, why = plane_db_id(transport)
    if not pid:
        raise RuntimeError("plane %s: %s" % (transport, why))
    url = "%s/accounts/%s/d1/database/%s/query" % (CF_API, ACCOUNT, pid)
    r = _req("POST", url, {"sql": sql, "params": []})
    if not r.get("success"):
        raise RuntimeError("d1 plane error: %s" % json.dumps(r.get("errors")))
    res = r.get("result") or []
    return (res[0].get("results") or []) if res else []


def is_literal_select(sql):
    """A probe may only be a single literal read-only SELECT/WITH statement."""
    s = (sql or "").strip()
    if not s:
        return False, "empty-probe"
    low = s.lower()
    if not (low.startswith("select") or low.startswith("with")):
        return False, "not-a-select"
    for kw in WRITE_KW:
        if kw in low:
            return False, "write-keyword:%s" % kw.strip()
    body = s.rstrip()
    if body.endswith(";"):
        body = body[:-1]
    if ";" in body:
        return False, "multi-statement"
    return True, "ok"


def extract_pair(rows):
    """Pull (expected, observed) from the probe result. Never invents a value."""
    if not rows:
        return None, None
    row = rows[0]
    if not isinstance(row, dict):
        return None, None
    low = {str(k).lower(): v for k, v in row.items()}
    if "expected" in low and "observed" in low:
        return low["expected"], low["observed"]
    vals = list(row.values())
    if len(vals) >= 2:
        return vals[0], vals[1]
    return None, None


def classify(expected, observed):
    """(pass, verdict). None pass means: no verification row may be written."""
    e = "" if expected is None else str(expected).strip()
    o = "" if observed is None else str(observed).strip()
    if not e or not o:
        return None, "vacuous-probe-result"
    if e == o:
        return 1, "pass"
    return 0, "fail"


# CONSUMER-PENDING-IS-DEFERRAL-1 (2026-10-19, agent_issues 2954, 2826, 2880, 2881, 2953): 'pending' and 'pending: <reason>' are the fleet's
# deferral convention (REMEDIATION-PENDING-PREFIX-1): the probe cannot judge yet, so the read is not a verdict. qnfo-fleet-control's tick has
# treated it so since 0.33.11 (DEFERRAL-NOT-A-FAILURE-1: verdict 'deferred', no verification row), but this consumer, which probes the same
# d1-query contracts every 22 minutes, classified every such read as expected != observed and wrote pass = 0 plus last_verdict 'fail'.
# Measured 2026-10-19 to 12:10Z: 223 pending pass = 0 rows in 24 h from remediation-consumer@* (203 plain, 20 measured), and the
# loop-owned contracts issue-2826, issue-2880 and issue-2881 ("pending: filed by qnfo-fleet-control, which owns it for 48h") sat at
# last_verdict 'fail', which is exactly what remediation_verification_autoclose_ins reads (cb.last_verdict IN ('fail', ...)) to refuse
# the filing loop's own close. The carve-out is the one remediation_reopen_on_relapse_d1 applies: a pending read that carries a number
# and a ceiling, target, threshold, limit, "fewer than", "more than" or a comparison operator is a measurement that is off target, not a
# probe that cannot judge, and stays a failure (e.g. "pending: worker_count 33 (needs <= 24)"). Only d1-query reads can say pending: the
# runner-https and code-read judges return 'ok' or a failure token.
_MEASURED_PENDING_WORDS = ("ceiling", "target", "threshold", "limit", "fewer than", "more than")
_MEASURED_PENDING_OPS = (" <= ", " >= ", " < ", " > ")


def _observed_text(observed):
    return "" if observed is None else str(observed).strip()


def is_deferral(observed):
    """True for 'pending' and 'pending: <reason>' (any case). Mirrors rtIsDeferral in qnfo-fleet-control/worker.js."""
    return re.match(r"pending", _observed_text(observed), re.I) is not None


def is_measured_pending(observed):
    """True when a pending read carries a measurement against a bound. Twin of the WHEN clause of the D1 trigger
    remediation_reopen_on_relapse_d1: observed GLOB '*[0-9]*' AND (LIKE '%ceiling%' / '%target%' / '%threshold%' / '%limit%' /
    '%fewer than%' / '%more than%' / '% <= %' / '% >= %' / '% < %' / '% > %'); SQLite LIKE is case-insensitive for ASCII."""
    o = _observed_text(observed)
    if re.search(r"[0-9]", o) is None:
        return False
    low = o.lower()
    return any(w in low for w in _MEASURED_PENDING_WORDS) or any(op in o for op in _MEASURED_PENDING_OPS)


def is_deferred_read(observed):
    """A read that is a deferral and not a verdict: pending, and not the measured-pending shape the relapse trigger still counts."""
    return is_deferral(observed) and not is_measured_pending(observed)


def host_allowed(url):
    """https only, and the host is an allowlisted fleet domain or a subdomain of one."""
    try:
        p = urllib.parse.urlsplit(str(url or ""))
    except ValueError:
        return False
    if p.scheme != "https" or p.username or p.password or not p.hostname:
        return False
    h = p.hostname.lower().rstrip(".")
    return any(h == d or h.endswith("." + d) for d in HTTPS_HOSTS)


def parse_https_probe(spec):
    """(probe dict, None) or (None, reason). The spec is JSON data, never code."""
    try:
        p = json.loads(spec or "")
    except (TypeError, ValueError):
        return None, "not-json"
    if not isinstance(p, dict):
        return None, "not-an-object"
    # ABSENT-PROBE-1 (2026-10-11): "absent" is a case-insensitive token the body must NOT contain, so a removal (a scrub, a
    # retired string) has a machine probe; before it the six NO-DEAD-DOI issues could only carry needs-machine-probe.
    # MIN-VERSION-PROBE-1 (2026-10-12): "min_version" passes when the JSON body's "version" is at or above it (numeric core
    # compared, any -suffix ignored), so a deploy check survives the next bump; an exact "contains": "0.16.0-x" failed for good
    # once 0.16.1 shipped (#2309, #2304, #2335).
    # REDIRECT-PROBE-1 (2026-10-12): "redirect_to" checks a redirect without following it: the status must match (set 301 or
    # 308) and the Location header must start with the given https URL. Followed, a 301 to an allowlisted host reads as the
    # target's 200, so a canonicalisation could not be told apart from a duplicate page (#2077, #2361).
    unknown = set(p) - {"url", "status", "contains", "absent", "min_version", "max_ms", "redirect_to"}
    if unknown:
        return None, "unknown-key:%s" % sorted(unknown)[0]
    if not host_allowed(p.get("url")):
        return None, "url-not-allowlisted"
    st = p.get("status", 200)
    if not isinstance(st, int) or not 100 <= st <= 599:
        return None, "bad-status"
    c = p.get("contains")
    if c is not None and (not isinstance(c, str) or not c or len(c) > 200):
        return None, "bad-contains"
    a = p.get("absent")
    if a is not None and (not isinstance(a, str) or not a or len(a) > 200):
        return None, "bad-absent"
    mv = p.get("min_version")
    if mv is not None and (not isinstance(mv, str) or version_core(mv) is None):
        return None, "bad-min_version"
    m = p.get("max_ms")
    if m is not None and (not isinstance(m, int) or m <= 0 or m > HTTPS_TIMEOUT_S * 1000):
        return None, "bad-max_ms"
    rt = p.get("redirect_to")
    if rt is not None and (not isinstance(rt, str) or not rt.startswith("https://") or len(rt) > 200 or not 300 <= st <= 399):
        return None, "bad-redirect_to"
    return {"url": p["url"], "status": st, "contains": c, "absent": a, "min_version": mv, "max_ms": m, "redirect_to": rt}, None


def version_core(v):
    """(major, minor, patch) of a VERSION string such as '0.16.1-perf-pin', or None."""
    mt = re.match(r"^\s*v?(\d+)\.(\d+)\.(\d+)", str(v or ""))
    return tuple(int(x) for x in mt.groups()) if mt else None


class _AllowlistRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not host_allowed(newurl):
            raise urllib.error.URLError("redirect-off-allowlist")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_HTTPS_OPENER = urllib.request.build_opener(_AllowlistRedirect)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_NOFOLLOW_OPENER = urllib.request.build_opener(_NoRedirect)


def judge_https(probe, status, elapsed_ms, body, location=None):
    """observed token for one response. Order: status, redirect target, marker, latency."""
    if status != probe["status"]:
        return "status=%d" % status
    if probe.get("redirect_to") and not str(location or "").startswith(probe["redirect_to"]):
        return "location=%s" % str(location or "none")[:80]
    if probe.get("contains") and probe["contains"].encode("utf-8") not in (body or b""):
        return "missing-marker"
    if probe.get("absent") and probe["absent"].lower().encode("utf-8") in (body or b"").lower():
        return "present-marker"
    if probe.get("min_version"):
        try:
            live = json.loads((body or b"{}").decode("utf-8", "replace")).get("version")
        except (ValueError, AttributeError):
            live = None
        lc = version_core(live)
        if lc is None:
            return "no-version"
        if lc < version_core(probe["min_version"]):
            return "version=%s" % str(live)[:40]
    if probe.get("max_ms") and elapsed_ms > probe["max_ms"]:
        return "slow=%dms" % elapsed_ms
    return "ok"


def run_https_probe(probe):
    """Execute one GET. Returns the observed token; never raises."""
    req = urllib.request.Request(probe["url"], method="GET")
    req.add_header("User-Agent", "qnfo-remediation-consumer/2 (runner-https probe; +https://fleet.qnfo.org)")
    req.add_header("Cache-Control", "no-cache")
    t0 = time.time()
    location = None
    opener = _NOFOLLOW_OPENER if probe.get("redirect_to") else _HTTPS_OPENER
    try:
        with opener.open(req, timeout=HTTPS_TIMEOUT_S) as r:
            body = r.read(HTTPS_READ_CAP)
            status = r.status
    except urllib.error.HTTPError as e:
        body, status = b"", e.code
        location = e.headers.get("Location") if e.headers is not None else None
    except Exception as e:  # noqa: BLE001 - the failure is the observation
        reason = getattr(e, "reason", None)
        if isinstance(reason, str) and reason == "redirect-off-allowlist":
            return "error:redirect-off-allowlist"
        return "error:%s" % type(e).__name__
    return judge_https(probe, status, int((time.time() - t0) * 1000), body, location)


def rt_pass_streak_days(cls):
    """Days since the first pass after the last real failure (pending/empty are deferrals). Mirrors fleet-control."""
    rows = d1(
        "SELECT MIN(verified_at) AS t FROM v_remediation_evidence_all WHERE class = ?1 AND pass = 1 AND verified_at > "
        "COALESCE((SELECT MAX(verified_at) FROM v_remediation_evidence_all WHERE class = ?1 AND pass = 0 "
        "AND COALESCE(observed, '') <> '' AND lower(trim(observed)) NOT LIKE 'pending%'), '1970-01-01')",
        [cls])
    t = rows[0].get("t") if rows else None
    if not t:
        return 0.0
    t = str(t).replace("T", " ")[:19]
    try:
        ts = time.mktime(time.strptime(t, "%Y-%m-%d %H:%M:%S")) - time.timezone
    except ValueError:
        return 0.0
    return max(0.0, (time.time() - ts) / 86400.0)


def fails_since_last_pass(cls):
    rows = d1(
        "SELECT COUNT(*) AS n FROM v_remediation_evidence_all WHERE class = ?1 AND pass = 0 AND verified_at > "
        "COALESCE((SELECT MAX(verified_at) FROM v_remediation_evidence_all WHERE class = ?1 AND pass = 1), '1970-01-01')",
        [cls])
    return int(rows[0].get("n") or 0) if rows else 0


def is_standing_detector(cls):
    """DETECTOR-NEVER-PARKS-2: fm-<key> and belief-<key> contracts never park after a pass."""
    return isinstance(cls, str) and (cls.startswith("fm-") or cls.startswith("belief-"))


def probe_fail_description(cls, fails, observed, verify_probe):
    """Issue text for a standing liveness contract that failed max_attempts times in a row (RUNTIME-PROBE-FAIL-1).

    STALE-MARKER-HINT-1 (#7040): an observation of missing-marker means the status matched and only the marker text is absent, which on a
    page that was redesigned is a stale marker, not an outage (rt-page-qwav-home and rt-page-fleet-queue, 2026-11-04). The text then tells
    the doer to fetch the URL and repoint the marker by migration; the status check is never relaxed."""
    text = ("Charter pillar: core. remediation-consumer (%s) ran the runner-https liveness contract %s from a "
            "GitHub-hosted runner and it failed %d times in a row; latest observation %s. Probe: %s. The contract "
            "keeps running and the autoclose trigger closes this issue on its first pass. agent_issues 2060."
            % (VERIFIER, cls, fails, observed, str(verify_probe)[:300]))
    if observed == "missing-marker":
        text += ("\nSTALE-MARKER-HINT-1: the HTTP status matched and only the marker text is absent, so the page is probably healthy but "
                 "redesigned. Fetch the URL, pick text the live page carries, and repoint the marker with a migration that updates "
                 "remediation_contracts.verify_probe for this class (pattern: migrations/2026-11-04-17-page-liveness-markers.sql). "
                 "Never relax the status check.")
    return text


def https_after_verdict(c, passed, observed, out):
    """Status transitions for a runner-https contract. Returns (next_status or None, cadence_h)."""
    cls, cad = c.get("class"), max(1, int(c.get("expected_cadence_h") or 1))
    liveness = c.get("module") == LIVENESS_MODULE
    max_att = max(1, int(c.get("max_attempts") or 3))
    if passed == 1:
        # DETECTOR-NEVER-PARKS-2 (2026-10-13): a failure-mode or belief detector is a standing probe, as fleet-control's
        # remediation tick already treats its d1-query ones; a pass keeps it active at its own cadence instead of parking it
        # in holding (fm-detector-parked failed on fm-notice-reply-encoded-subject and fm-zaraz-autoinject-worker-html).
        if liveness or is_standing_detector(cls):
            return None, cad
        if rt_pass_streak_days(cls) >= RT_HOLD_D:
            return "closed", cad
        return "holding", max(cad, RT_HOLD_CADENCE_H)
    fails = fails_since_last_pass(cls)
    if fails < max_att:
        return None, cad
    issue_id = c.get("issue_id")
    if issue_id is None and liveness:
        rows = d1(
            "INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) "
            "VALUES (?1, ?2, 'remediation-consumer', 'reliability', 'high', 'open', "
            "CAST(strftime('%s','now') AS INTEGER)*1000, CAST(strftime('%s','now') AS INTEGER)*1000) RETURNING id",
            ["RUNTIME-PROBE-FAIL-1: %s" % cls, probe_fail_description(cls, fails, observed, c.get("verify_probe"))])
        if rows:
            issue_id = rows[0].get("id")
            d1("UPDATE remediation_contracts SET issue_id = ?1 WHERE class = ?2 AND issue_id IS NULL", [issue_id, cls])
            out.setdefault("filed", []).append(issue_id)
        return "active", cad
    if issue_id is not None:
        r = d1(
            "UPDATE agent_issues SET status = 'open', description = COALESCE(description, '') || ?2, updated_at = "
            "CAST(strftime('%s','now') AS INTEGER)*1000 WHERE id = ?1 AND status IN ('closed', 'resolved') RETURNING id",
            [issue_id, "\nREOPENED %s (REMEDIATION-REOPEN-1 via %s): runner-https contract %s failed %dx in a row, "
             "observed %s." % (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), VERIFIER, cls, fails, observed)])
        if r:
            out.setdefault("reopened", []).append(issue_id)
    return "active", cad


RUNTIME_SHARE_SQL = (
    "SELECT ROUND(100.0 * SUM(CASE WHEN t.trusted = 1 AND t.independent = 1 AND t.runtime_observable = 1 THEN 1 ELSE 0 END) "
    "/ COUNT(*), 1) AS v, COUNT(*) AS n FROM remediation_verifications v LEFT JOIN transport_trust t ON t.transport = v.transport "
    "WHERE replace(substr(v.verified_at, 1, 19), 'T', ' ') >= datetime('now', '-1 day')")


def refresh_runtime_share(out):
    rows = d1(RUNTIME_SHARE_SQL)
    v = rows[0].get("v") if rows else None
    out["runtime_verified_share_24h"] = v
    d1("UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2, state = 'MEASURED' "
       "WHERE metric = 'runtime_verified_share_24h'",
       ["n/a" if v is None else str(v), time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())])


# CF-TOKEN-WATCH-1 (2026-10-19, agent_issues 2581, pillar autonomy): the repository CLOUDFLARE_API_TOKEN carries every
# deploy, migration and cf-ops action, and the owner directive of 2026-10-08 says no new Cloudflare token will be issued,
# so a lapse would stop the GitHub -> Cloudflare half with no successor. Nothing measured it. Each consumer run (at least
# hourly, PROBE-CADENCE-1) asks Cloudflare to verify the token (account-owned path first, then the user path) and writes
# cloudflare_token_ok (1 when status is active) and cloudflare_token_expires_in_min (999999 when it has no expiry) to
# metric_registry; their triggers live in migrations/2026-10-19-resolve-cf-token-watch.sql. The token is never printed.
def cf_token_watch_values(result, now=None):
    """result: the Cloudflare tokens/verify `result` object (or None) -> (ok, expires_in_min)."""
    now = time.time() if now is None else now
    if not isinstance(result, dict):
        return 0, 0
    ok = 1 if str(result.get("status") or "").lower() == "active" else 0
    exp = result.get("expires_on")
    if not exp:
        return ok, 999999
    try:
        ts = calendar.timegm(time.strptime(str(exp)[:19], "%Y-%m-%dT%H:%M:%S"))
    except (ValueError, OverflowError):
        return ok, 999999
    mins = int((ts - now) // 60)
    if mins <= 0:
        return 0, 0
    return ok, mins


# CF-TOKEN-WATCH-2 (2026-10-19, PR 2603 review): a run whose verify calls both failed to get an answer (network error, 5xx,
# timeout) wrote cloudflare_token_ok=0, and the priority-0 trigger on that metric filed a false critical "deploys are blocked".
# 0 is now written only for a definite verdict: Cloudflare answered every path it was asked with HTTP 401/403, or answered
# success=false, or reported a status other than active. Anything else leaves the last value in place and records the error.
CF_REFUSAL = re.compile(r"HTTP (401|403)\b")


def cf_token_watch(out, req=None):
    if req is None and not TOKEN:
        out["cf_token_watch"] = {"skipped": "no token in this environment"}
        return out["cf_token_watch"]
    req = req or _req
    result, used, errors, undecided = None, None, [], False
    for path in ("/accounts/%s/tokens/verify" % ACCOUNT, "/user/tokens/verify"):
        try:
            r = req("GET", CF_API + path)
        except Exception as e:  # noqa: BLE001 - an account-owned token answers 4xx on the user path and vice versa
            msg = str(e).replace(TOKEN, "***") if TOKEN else str(e)
            errors.append(path.split("/")[1] + ": " + msg[:120])
            if not CF_REFUSAL.search(msg):
                undecided = True  # no HTTP answer, or a 5xx/429: Cloudflare gave no verdict on this path
            continue
        if r.get("success") and isinstance(r.get("result"), dict):
            result, used = r["result"], path.split("/")[1]
            break
        if r.get("success") is not False:
            undecided = True
            errors.append(path.split("/")[1] + ": unreadable answer")
    if result is None and undecided:
        out["cf_token_watch"] = {"skipped": "no verdict from Cloudflare, last value kept", "errors": errors}
        return out["cf_token_watch"]
    ok, mins = cf_token_watch_values(result)
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for metric, val in (("cloudflare_token_ok", ok), ("cloudflare_token_expires_in_min", mins)):
        d1("UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2, state = 'MEASURED' WHERE metric = ?3",
           [str(val), stamp, metric])
    out["cf_token_watch"] = {"ok": ok, "expires_in_min": mins, "path": used}
    return out["cf_token_watch"]


def _selftest():
    # RUNTIME-PROBE-BUDGET-1 (issue 2081): a SQL backlog must not spend the runner's budget before runtime probes run.
    import sqlite3
    with sqlite3.connect(":memory:") as db:
        db.executescript("""
            CREATE TABLE remediation_contracts (
                class TEXT, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT,
                max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, module TEXT, budget_ms INTEGER,
                next_due_at TEXT, max_items INTEGER, attempts INTEGER, last_verdict TEXT, ts TEXT, status TEXT);
        """)
        db.executemany(
            "INSERT INTO remediation_contracts (class, verify_transport, status, next_due_at, ts) VALUES (?, ?, ?, ?, ?)",
            [
                ("sql-old", "d1-query", "active", "2000-01-01", "2000-01-01"),
                ("code-old", "code-read", "active", None, "2000-01-02"),
                ("runtime-new", "runner-https", "active", "2000-01-04", "2000-01-01"),
                ("runtime-held", "runner-https", "holding", None, "2000-01-03"),
                ("runtime-future", "runner-https", "active", "2999-01-01", "2000-01-01"),
                ("runtime-closed", "runner-https", "closed", "2000-01-01", "2000-01-01"),
                ("runtime-superseded", "runner-https", "superseded", "2000-01-01", "2000-01-01"),
                ("sql-held", "d1-query", "holding", "2000-01-01", "2000-01-01"),
                ("external", "external-https", "active", "2000-01-01", "2000-01-01"),
                ("portfolio", "d1-query@portfolio-state", "active", "2000-01-01", "2000-01-01"),
            ],
        )
        for limit, want in (
            (1, ["runtime-held"]),
            (2, ["runtime-held", "runtime-new"]),
            (10, ["runtime-held", "runtime-new", "sql-old", "code-old"]),
        ):
            got = [row[0] for row in db.execute(CONTRACT_SQL, [limit])]
            if got != want:
                print(json.dumps({"ok": False, "case": "runtime-budget-priority", "limit": limit, "got": got, "want": want}))
                return 1
    cases = [
        ("SELECT 'a' AS expected, 'a' AS observed", 1, "pass"),
        ("SELECT 'a' AS expected, 'b' AS observed", 0, "fail"),
        ("SELECT NULL AS expected, 'b' AS observed", None, "vacuous-probe-result"),
        ("SELECT '' AS expected, '' AS observed", None, "vacuous-probe-result"),
    ]
    for sql, want_pass, want_verdict in cases:
        rows = [dict(zip(("expected", "observed"), ())) ] if False else None
        # simulate the probe result rather than executing it
        if "NULL" in sql:
            rows = [{"expected": None, "observed": "b"}]
        elif "'' AS expected" in sql:
            rows = [{"expected": "", "observed": ""}]
        else:
            rows = [{"expected": sql.split("'")[1], "observed": sql.split("'")[3]}]
        e, o = extract_pair(rows)
        p, v = classify(e, o)
        if p != want_pass or v != want_verdict:
            print(json.dumps({"ok": False, "case": sql, "got": [p, v],
                              "want": [want_pass, want_verdict]}))
            return 1
    # DETECTOR-NEVER-PARKS-2: a passing fm- or belief- runner-https detector stays active at its cadence (no D1 read);
    # an issue contract is not a standing detector.
    for cls_, want in (("fm-notice-reply-encoded-subject", True), ("belief-x", True), ("issue-2109", False), (None, False)):
        if is_standing_detector(cls_) != want:
            print(json.dumps({"ok": False, "case": "is_standing_detector", "cls": cls_}))
            return 1
    for cls_ in ("fm-zaraz-autoinject-worker-html", "belief-runner-https"):
        if https_after_verdict({"class": cls_, "expected_cadence_h": 1, "max_attempts": 3}, 1, "ok", {}) != (None, 1):
            print(json.dumps({"ok": False, "case": "detector parked after a pass", "cls": cls_}))
            return 1
    probes = [
        ("SELECT 1", True), ("WITH x AS (SELECT 1) SELECT * FROM x", True),
        ("UPDATE t SET a=1", False), ("SELECT 1; DROP TABLE t", False),
        ("SELECT 1; SELECT 2", False), ("", False),
        ("SELECT * FROM t WHERE a='DELETE FROM'", False),
    ]
    for sql, want in probes:
        got, why = is_literal_select(sql)
        if got != want:
            print(json.dumps({"ok": False, "probe": sql, "got": got, "why": why}))
            return 1
    # PROBE-PLANES-1: any account D1 by name, refused planes never run, fleet-control's transports never selected.
    fake = lambda: [{"name": "living-paper", "uuid": "lp-1"}, {"name": "qnfo-identity", "uuid": "id-1"}, {"name": "qnfo-outreach", "uuid": "or-1"}]
    _PLANE_IDS.clear()
    planes = [
        ("d1-query@personal-life", ("e8d6c61a-10b7-4086-b81e-9e6e85afa407", None)),
        ("d1-query@living-paper", ("lp-1", None)),
        ("d1-query@qnfo-identity", (None, "plane-refused")),
        ("d1-query@qnfo-outreach", (None, "plane-refused")),
        ("d1-query@no-such-db", (None, "plane-not-found")),
        ("d1-query@" + DB_NAME, (None, "plane-is-the-default-db")),
        ("d1-query", (None, "not-a-plane")),
    ]
    for t, want in planes:
        got = plane_db_id(t, lister=fake)
        if got != want:
            print(json.dumps({"ok": False, "plane": t, "got": got, "want": want}))
            return 1
    _PLANE_IDS.clear()
    if not all(("'%s'" % t) in CONTRACT_SQL for t in FLEET_CONTROL_TRANSPORTS) or "NOT IN" not in CONTRACT_SQL:
        print(json.dumps({"ok": False, "why": "the due query must leave fleet-control's transports alone"}))
        return 1
    # PROBE-TRANSPORT-MONOCULTURE-1: the runner-https parser, allowlist and judge, offline.
    hosts = [
        ("https://qnfo.org/health", True), ("https://fleet.qnfo.org/", True), ("https://q08.org/", True),
        ("https://x.q08.workers.dev/health", True), ("http://qnfo.org/", False), ("https://evilqnfo.org/", False),
        ("https://qnfo.org.evil.com/", False), ("https://user:pw@qnfo.org/", False), ("ftp://qnfo.org/", False),
        ("https://example.com/", False), ("", False),
        ("https://ask.qwav.tech/api/ask", True), ("https://qwav.org/", True), ("https://qwav.tech.evil.com/", False),
    ]
    for url, want in hosts:
        if host_allowed(url) != want:
            print(json.dumps({"ok": False, "host": url, "want": want}))
            return 1
    specs = [
        ('{"url": "https://qnfo.org/health", "status": 200, "contains": "qnfo-gateway"}', None),
        ('{"url": "https://qnfo.org/", "max_ms": 3000}', None),
        ('{"url": "https://example.com/"}', "url-not-allowlisted"),
        ('{"url": "https://qnfo.org/", "method": "POST"}', "unknown-key:method"),
        ('{"url": "https://qnfo.org/", "status": "200"}', "bad-status"),
        ('{"url": "https://qnfo.org/", "contains": ""}', "bad-contains"),
        ('{"url": "https://qnfo.org/", "max_ms": 999999}', "bad-max_ms"),
        ("SELECT 1", "not-json"), ("[1]", "not-an-object"),
    ]
    for spec, want_err in specs:
        p, err = parse_https_probe(spec)
        if err != want_err or (want_err is None and p is None):
            print(json.dumps({"ok": False, "spec": spec, "got": err, "want": want_err}))
            return 1
    pr = {"url": "https://qnfo.org/", "status": 200, "contains": "gateway", "max_ms": 1000}
    judged = [
        ((200, 50, b"..gateway.."), "ok"), ((404, 50, b"gateway"), "status=404"),
        ((200, 50, b"nothing"), "missing-marker"), ((200, 1500, b"gateway"), "slow=1500ms"),
    ]
    pa = {"url": "https://qnfo.org/", "status": 200, "contains": None, "absent": "10.5281/", "max_ms": None}
    if judge_https(pa, 200, 5, b"see doi.org/10.5281/x") != "present-marker" or judge_https(pa, 200, 5, b"clean") != "ok":
        print(json.dumps({"ok": False, "case": "absent-marker"}))
        return 1
    import tempfile
    tmp = tempfile.mkdtemp()
    os.makedirs(os.path.join(tmp, "w"))
    with open(os.path.join(tmp, "w", "worker.js"), "w") as fh:
        fh.write('var VERSION = "1.0.0"; fetch("https://old.q08.workers.dev")')
    code_cases = [
        ({"paths": ["w/worker.js"], "absent": "old.q08"}, "present-marker:w/worker.js"),
        ({"paths": ["w/worker.js"], "contains": "VERSION"}, "ok"),
        ({"paths": ["w/worker.js"], "contains": "Version"}, "missing-marker:w/worker.js"),
        ({"paths": ["w/none.js"], "absent": "x"}, "missing:w/none.js"),
    ]
    for spec, want in code_cases:
        pr2, err2 = parse_code_probe(json.dumps(spec))
        if err2 or run_code_probe(pr2, tmp) != want:
            print(json.dumps({"ok": False, "case": "code-read", "spec": spec, "got": err2 or run_code_probe(pr2, tmp)}))
            return 1
    if (contract_epoch("2026-10-13 11:26:05") != 1791890765 or contract_epoch("2026-10-13T11:26:05Z") != 1791890765
            or contract_epoch("") is not None or not newer_than_checkout("2026-10-13 11:26:05", 1791890700)
            or newer_than_checkout("2026-10-13 11:26:05", 1791890800) or newer_than_checkout("2026-10-13 11:26:05", None)
            or newer_than_checkout(None, 1791890700)):
        print(json.dumps({"ok": False, "case": "code-read-fresh-checkout"}))
        return 1
    # CODE-READ-STALE-CHECKOUT-1: a checkout that IS the tip of main judges a contract written after its commit; one main has moved past waits.
    import subprocess

    def _git(cwd, *a):
        env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t",
                   GIT_AUTHOR_DATE="2026-10-13T11:00:00+0000", GIT_COMMITTER_DATE="2026-10-13T11:00:00+0000", GIT_CONFIG_GLOBAL=os.devnull)
        return subprocess.run(["git", "-C", cwd] + list(a), capture_output=True, text=True, env=env, timeout=30)

    org, clone = os.path.join(tmp, "origin"), os.path.join(tmp, "clone")
    os.makedirs(org)
    _git(org, "init", "-q")
    _git(org, "symbolic-ref", "HEAD", "refs/heads/main")
    with open(os.path.join(org, "a.txt"), "w") as fh:
        fh.write("1")
    _git(org, "add", "a.txt")
    _git(org, "commit", "-q", "-m", "one")
    subprocess.run(["git", "clone", "-q", org, clone], capture_output=True, text=True, timeout=30, env=dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull))
    after, before = "2026-10-13 11:26:05", "2026-10-13 10:00:00"
    tip_now = checkout_is_tip(clone)
    cur = checkout_behind_contract(after, clone)
    with open(os.path.join(org, "a.txt"), "w") as fh:
        fh.write("2")
    _git(org, "commit", "-q", "-am", "two")
    moved, behind_moved, behind_old = checkout_is_tip(clone), checkout_behind_contract(after, clone), checkout_behind_contract(before, clone)
    _git(clone, "remote", "set-url", "origin", os.path.join(tmp, "gone"))
    unknown, behind_unknown = checkout_is_tip(clone), checkout_behind_contract(after, clone)
    if (tip_now is not True or cur is not False or moved is not False or behind_moved is not True or behind_old is not False
            or unknown is not None or behind_unknown is not True):
        print(json.dumps({"ok": False, "case": "code-read-stale-checkout", "tip_now": tip_now, "cur": cur, "moved": moved,
                          "behind_moved": behind_moved, "behind_old": behind_old, "unknown": unknown, "behind_unknown": behind_unknown}))
        return 1
    for bad, want in (('{"paths": ["../etc/passwd"], "absent": "x"}', "bad-path"), ('{"paths": ["/etc/passwd"], "absent": "x"}', "bad-path"),
                      ('{"paths": ["a"]}', "no-condition"), ('{"paths": ["a"], "absent": "x", "sql": 1}', "unknown-key:sql")):
        if parse_code_probe(bad)[1] != want:
            print(json.dumps({"ok": False, "case": "code-read-parse", "spec": bad, "got": parse_code_probe(bad)[1]}))
            return 1
    pv = {"url": "https://qnfo.org/", "status": 200, "contains": None, "absent": None, "min_version": "0.16.0", "max_ms": None}
    if (judge_https(pv, 200, 5, b'{"version": "0.16.1-perf-pin"}') != "ok" or judge_https(pv, 200, 5, b'{"version": "0.16.0-x"}') != "ok"
            or judge_https(pv, 200, 5, b'{"version": "0.15.9"}') != "version=0.15.9" or judge_https(pv, 200, 5, b"<html>") != "no-version"
            or parse_https_probe('{"url": "https://qnfo.org/", "min_version": "latest"}')[1] != "bad-min_version"):
        print(json.dumps({"ok": False, "case": "min-version"}))
        return 1
    prd, why = parse_https_probe('{"url": "https://qwav.uk/", "status": 301, "redirect_to": "https://qwav.org"}')
    if (why or judge_https(prd, 301, 5, b"", "https://qwav.org/a?b") != "ok" or judge_https(prd, 200, 5, b"dup") != "status=200"
            or judge_https(prd, 301, 5, b"", "https://qwav.tech/") != "location=https://qwav.tech/"
            or parse_https_probe('{"url": "https://qwav.uk/", "status": 200, "redirect_to": "https://qwav.org"}')[1] != "bad-redirect_to"
            or parse_https_probe('{"url": "https://qwave.tech/", "status": 301, "redirect_to": "http://x"}')[1] != "bad-redirect_to"):
        print(json.dumps({"ok": False, "case": "redirect-probe"}))
        return 1
    if parse_https_probe('{"url": "https://qnfo.org/", "absent": ""}')[1] != "bad-absent":
        print(json.dumps({"ok": False, "case": "absent-parse"}))
        return 1
    for (st, ms, body), want in judged:
        got = judge_https(pr, st, ms, body)
        if got != want:
            print(json.dumps({"ok": False, "judge": [st, ms], "got": got, "want": want}))
            return 1
    if classify("ok", "status=404") != (0, "fail") or classify("ok", "ok") != (1, "pass"):
        print(json.dumps({"ok": False, "case": "https-classify"}))
        return 1
    # CONSUMER-PENDING-IS-DEFERRAL-1: a pending read is a deferral (no verification row, verdict 'deferred'); the measured-pending shape
    # the D1 relapse trigger counts, a real failure token and a pass keep their rows. The full fake-d1 suite is scripts/remediation_consumer_pending_test.py.
    deferral_cases = [
        ("pending", True), ("pending: filed by qnfo-fleet-control, which owns it for 48h", True), ("  Pending: window not open", True),
        ("pending: worker_count 33 (needs <= 24)", False), ("pending: unmanaged share 0.55 (target 0.5)", False),
        ("pending: 7 rows", True), ("pending: no limit reached", True),
        ("stale: the filing loop did not close it", False), ("ok", False), ("", False), (None, False),
    ]
    for obs_, want in deferral_cases:
        if is_deferred_read(obs_) != want:
            print(json.dumps({"ok": False, "case": "pending-is-deferral", "observed": obs_, "want": want}))
            return 1
    probe_read, inserts = {}, []

    def fake_d1_pending(sql, params=None):
        if sql.lstrip().startswith("INSERT"):
            inserts.append(sql)
            return []
        return [{"expected": "ok", "observed": probe_read["observed"]}]
    saved_d1 = globals()["d1"]
    globals()["d1"] = fake_d1_pending
    try:
        for observed_, want_v, want_wrote in (("pending: filed by x, which owns it for 48h", "deferred", False),
                                              ("pending: worker_count 33 (needs <= 24)", "fail", True),
                                              ("stale: x did not close it", "fail", True), ("ok", "pass", True)):
            probe_read["observed"] = observed_
            del inserts[:]
            rec_, out_ = {}, {"pass": 0, "fail": 0, "skipped": 0}
            consume_d1({"class": "issue-1", "issue_id": 1, "verify_transport": "d1-query", "verify_probe": "SELECT 1"}, rec_, out_, {"d1-query"})
            if rec_.get("verdict") != want_v or bool(inserts) != want_wrote or (want_v == "deferred") != (out_["skipped"] == 1 and out_.get("deferred") == 1):
                print(json.dumps({"ok": False, "case": "pending-consume-d1", "observed": observed_, "got": rec_.get("verdict"), "writes": len(inserts), "out": out_}))
                return 1
    finally:
        globals()["d1"] = saved_d1
    # PROBE-DRAIN-1: hourly contracts come due inside their 60-minute window; counters from parallel probes add up; a run
    # drains every due batch and never probes a contract twice.
    # REMEDIATION-2X-1: half the earlier offsets (45, 345, 30 minutes).
    if next_due_offset(1) != "+22 minutes" or next_due_offset(6) != "+172 minutes" or next_due_offset(0.25) != "+15 minutes":
        print(json.dumps({"ok": False, "case": "next-due-offset"}))
        return 1
    agg = {"pass": 1, "fail": 0, "skipped": 0}
    merge_out(agg, {"pass": 2, "fail": 1, "skipped": 0, "filed": [7]})
    if agg != {"pass": 3, "fail": 1, "skipped": 0, "filed": [7]}:
        print(json.dumps({"ok": False, "case": "merge-out", "got": agg}))
        return 1
    g = globals()
    saved = (g["d1"], g["MAX_ITEMS"], g["_req"], g["migrations_sweep"])
    # SELFTEST-HERMETIC-1 (2026-10-19): main() below also runs the host census, the fleet journeys and the migration sweep.
    # With the fake d1 every migration read as unapplied, so the sweep called apply_migrations.apply_file on all 266
    # opted-in files with the real token: 8 of the job's 15 minutes went to that before a single contract was probed
    # (run 39199001472: self-test 04:20:56-04:29:04, consumer 22 s), and a genuinely unapplied file would have been
    # applied by a test. fleet_journeys.run and host_census.run likewise ran live off the fake d1's empty answers. The
    # drain case now stubs all three; their own self-tests below still cover them.
    stub_mods = {"host_census": None, "fleet_journeys": None}
    due = ["c%d" % i for i in range(9)]
    seen_sql = []

    def fake_d1(sql, params=None):
        seen_sql.append(sql.split()[0])
        if sql.lstrip().startswith("SELECT transport"):
            return [{"transport": "d1-query"}]
        if "FROM remediation_contracts" in sql and sql.lstrip().startswith("SELECT"):
            return [{"class": c, "verify_transport": "d1-query", "verify_probe": "SELECT 'a' AS expected, 'a' AS observed",
                     "expected_cadence_h": 1} for c in due[: params[0]]]
        if sql.lstrip().startswith("UPDATE remediation_contracts"):
            if params[-1] in due:
                due.remove(params[-1])
            return []
        if sql.lstrip().startswith("SELECT 'a'"):
            return [{"expected": "a", "observed": "a"}]
        return []
    try:
        g["d1"], g["MAX_ITEMS"] = fake_d1, 4

        def no_net(*a, **k):
            raise RuntimeError("selftest: no network")
        g["_req"] = no_net
        sweeps = []
        g["migrations_sweep"] = lambda out, apply=None, root=None: sweeps.append(1) or out.setdefault("migrations", {"selftest": "stubbed"})
        import io, contextlib, types
        for name in stub_mods:
            stub_mods[name] = sys.modules.get(name)
            sys.modules[name] = types.SimpleNamespace(run=lambda *a, **k: {"skipped": "selftest"})
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            main()
        res = json.loads(buf.getvalue().strip().splitlines()[-1])
    finally:
        g["d1"], g["MAX_ITEMS"], g["_req"], g["migrations_sweep"] = saved
        for name, mod in stub_mods.items():
            if mod is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = mod
    if sweeps != [1] or res.get("migrations") != {"selftest": "stubbed"} or (res.get("fleet_journeys") or {}).get("skipped") != "selftest":
        print(json.dumps({"ok": False, "case": "drain-hermetic", "sweeps": len(sweeps), "migrations": res.get("migrations"),
                          "fleet_journeys": res.get("fleet_journeys")}))
        return 1
    if res.get("due") != 9 or res.get("pass") != 9 or due:
        print(json.dumps({"ok": False, "case": "drain", "got": {k: res.get(k) for k in ("due", "pass", "fail", "skipped")}, "left": due}))
        return 1
    try:
        import host_census
        hc = host_census.selftest()
    except Exception as e:  # noqa: BLE001
        hc = {"ok": False, "error": str(e)[:200]}
    if not hc.get("ok"):
        print(json.dumps({"ok": False, "case": "host-census", "detail": hc}))
        return 1
    try:
        import fleet_journeys
        fj = fleet_journeys.selftest()
    except Exception as e:  # noqa: BLE001
        fj = {"selftest": "fail", "error": str(e)[:200]}
    if fj.get("selftest") != "ok":
        print(json.dumps({"ok": False, "case": "fleet-journeys", "detail": fj}))
        return 1
    # MIGRATION-UNAPPLIED-1: the pure comparison and the sweep with a fake applier
    import tempfile
    mroot = tempfile.mkdtemp(prefix="rc-mig-")
    os.makedirs(os.path.join(mroot, "migrations"))
    for name, head in (("a.sql", "-- APPLY-BY: ci\n-- DB: qnfo-audit\nSELECT 1;\n"), ("b.sql", "-- APPLY-BY: ci\n-- DB: qnfo-audit\nSELECT 2;\n"), ("c.sql", "-- hand-applied\nSELECT 3;\n")):
        with open(os.path.join(mroot, "migrations", name), "w", encoding="utf-8") as fh:
            fh.write(head)
    opted = opted_in_migrations(mroot)
    if opted != ["migrations/a.sql", "migrations/b.sql"]:
        print(json.dumps({"ok": False, "case": "migrations-opted-in", "got": opted}))
        return 1
    if unapplied_migrations(opted, ["migrations/a.sql"]) != ["migrations/b.sql"] or unapplied_migrations(opted, opted) != []:
        print(json.dumps({"ok": False, "case": "migrations-unapplied"}))
        return 1
    writes, applied = [], []
    g2 = globals()
    saved_d1 = g2["d1"]

    def fake_d1_m(sql, params=None):
        if sql.startswith("SELECT DISTINCT file FROM migration_runs"):
            return [{"file": "migrations/a.sql"}]
        writes.append((sql[:40], list(params or [])))
        return []
    g2["d1"] = fake_d1_m
    try:
        res = migrations_sweep({}, apply=lambda path, text: (applied.append(path), 0)[1], root=mroot)
    finally:
        g2["d1"] = saved_d1
    if res.get("unapplied") != ["migrations/b.sql"] or applied != ["migrations/b.sql"] or res.get("metric") != 0 \
            or not any(w[0].startswith("UPDATE metric_registry") and w[1][0] == "0" for w in writes) \
            or not any(w[0].startswith("INSERT INTO cloud_ops_events") for w in writes):
        print(json.dumps({"ok": False, "case": "migrations-sweep", "got": res, "applied": applied, "writes": writes}))
        return 1
    print(json.dumps({"ok": True, "marker": "REMEDIATION-CONSUMER-1",
                      "selftest": "classify+probe-guard+runner-https+host-census+migration-sweep green"}))
    return 0


def consume_https(c, rec, out, trusted):
    """Run one runner-https contract. Returns (next_status, cadence_h)."""
    probe, why = parse_https_probe(c.get("verify_probe"))
    if probe is None:
        rec["verdict"], rec["reason"] = "probe-not-machine-executable", why
        out["skipped"] += 1
        return None, None
    if HTTPS_TRANSPORT not in trusted:
        rec["verdict"], rec["reason"] = "untrusted-transport", "%r not trusted" % HTTPS_TRANSPORT
        out["skipped"] += 1
        return None, None
    obs = run_https_probe(probe)
    passed, verdict = classify("ok", obs)
    rec.update({"expected": "ok", "observed": obs, "verdict": verdict})
    record_verification(c.get("issue_id"), c.get("class"), probe["url"], HTTPS_TRANSPORT, "ok", obs, passed)
    rec["written"] = True
    out["pass" if passed == 1 else "fail"] += 1
    out["https"] = out.get("https", 0) + 1
    return https_after_verdict(c, passed, obs, out)


def parse_code_probe(spec):
    """(probe dict, None) or (None, reason) for a code-read contract."""
    try:
        p = json.loads(spec or "")
    except (TypeError, ValueError):
        return None, "not-json"
    if not isinstance(p, dict):
        return None, "not-an-object"
    unknown = set(p) - {"paths", "contains", "absent"}
    if unknown:
        return None, "unknown-key:%s" % sorted(unknown)[0]
    paths = p.get("paths")
    if not isinstance(paths, list) or not paths or len(paths) > 20:
        return None, "bad-paths"
    for x in paths:
        if not isinstance(x, str) or not x or x.startswith("/") or ".." in x.split("/") or "\\" in x:
            return None, "bad-path"
    for k in ("contains", "absent"):
        v = p.get(k)
        if v is not None and (not isinstance(v, str) or not v or len(v) > 200):
            return None, "bad-%s" % k
    if p.get("contains") is None and p.get("absent") is None:
        return None, "no-condition"
    return {"paths": paths, "contains": p.get("contains"), "absent": p.get("absent")}, None


def run_code_probe(probe, root=None):
    """observed token: ok, missing:<path>, missing-marker:<path> or present-marker:<path>."""
    root = os.path.realpath(root or REPO_ROOT)
    for rel in probe["paths"]:
        full = os.path.realpath(os.path.join(root, rel))
        if not full.startswith(root + os.sep) or not os.path.isfile(full):
            return "missing:%s" % rel
        with open(full, "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        if probe.get("contains") and probe["contains"] not in text:
            return "missing-marker:%s" % rel
        if probe.get("absent") and probe["absent"] in text:
            return "present-marker:%s" % rel
    return "ok"


# CODE-READ-FRESH-CHECKOUT-1 (2026-10-13): a run checks out main when it starts, and a migration that merges while it runs can add a
# code-read detector whose marker only that merge brings. fm-factcheck-waits-for-slowest was judged "missing-marker" at 11:26:08 UTC by
# the run of f5a8bda, a checkout that predates its own merge, and read as a recurrence. A failing code-read verdict on a contract created
# after the checkout's commit is not written: the next run, on a newer checkout, judges it. A pass is always written.
_CHECKOUT_EPOCH = []


def checkout_epoch(root=None):
    """Commit time (unix seconds) of the checked-out HEAD, or None when git cannot say."""
    if root is None and _CHECKOUT_EPOCH:
        return _CHECKOUT_EPOCH[0]
    import subprocess
    val = None
    try:
        r = subprocess.run(["git", "-C", root or REPO_ROOT, "log", "-1", "--format=%ct"], capture_output=True, text=True, timeout=10)
        val = int(r.stdout.strip()) if r.returncode == 0 and r.stdout.strip().isdigit() else None
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        print("CODE-READ-FRESH-CHECKOUT-1: git log failed: %s" % e, file=sys.stderr)
        val = None
    if root is None:
        _CHECKOUT_EPOCH.append(val)
    return val


def contract_epoch(ts):
    """Unix seconds of a remediation_contracts.ts value ('YYYY-MM-DD HH:MM:SS' UTC, or ISO), or None."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})", str(ts or ""))
    if not m:
        return None
    import calendar
    return calendar.timegm(tuple(int(x) for x in m.groups()) + (0, 0, 0))


def newer_than_checkout(ts, epoch):
    ce = contract_epoch(ts)
    return ce is not None and epoch is not None and ce > epoch


# CODE-READ-STALE-CHECKOUT-1 (2026-10-19, issue 100081): commit time against contract time called a current checkout "older" whenever
# main had no commit since the contract was written. issue-100062 (REPOSLUG-UNIFORM-1) read checkout-older-than-contract from 07:49Z
# although its fix was on main and live, and kept reading it until some other merge happened to land. A checkout is behind exactly
# when origin main has moved past its HEAD, and git answers that directly. ls-remote reads the tip without fetching, so the checkout's
# history is untouched. The contract row only exists once the merge that brings its marker is on main, so a HEAD that is the tip holds
# that merge and its failing verdict is real. A remote git cannot reach (None) keeps the CODE-READ-FRESH-CHECKOUT-1 deferral.
_CHECKOUT_TIP = []


def checkout_is_tip(root=None):
    """True when HEAD is the tip of origin main right now, False when main has moved past it, None when git cannot say."""
    if root is None and _CHECKOUT_TIP:
        return _CHECKOUT_TIP[0]
    import subprocess
    cwd = root or REPO_ROOT
    val = None
    try:
        head = subprocess.run(["git", "-C", cwd, "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10)
        tip = subprocess.run(["git", "-C", cwd, "ls-remote", "origin", "refs/heads/main"], capture_output=True, text=True, timeout=30)
        h, t = head.stdout.strip(), (tip.stdout.split() or [""])[0]
        if head.returncode == 0 and tip.returncode == 0 and h and t:
            val = h == t
        else:
            print("CODE-READ-STALE-CHECKOUT-1: tip unreadable: %s" % (tip.stderr.strip() or head.stderr.strip() or "no answer")[:160], file=sys.stderr)
    except (OSError, subprocess.SubprocessError) as e:
        print("CODE-READ-STALE-CHECKOUT-1: git failed: %s" % e, file=sys.stderr)
    if root is None:
        _CHECKOUT_TIP.append(val)
    return val


def checkout_behind_contract(ts, root=None):
    """True when a failing code-read verdict on a contract created at ts must wait for a newer checkout: the contract postdates the
    checkout's HEAD commit AND main has moved past that HEAD (or git cannot say). The tip is read only when the commit-time rule would
    defer, so a passing run never asks the remote."""
    return newer_than_checkout(ts, checkout_epoch(root)) and checkout_is_tip(root) is not True


def consume_code(c, rec, out, trusted):
    """Run one code-read contract against this checkout of main."""
    probe, why = parse_code_probe(c.get("verify_probe"))
    if probe is None:
        rec["verdict"], rec["reason"] = "probe-not-machine-executable", why
        out["skipped"] += 1
        return
    if CODE_TRANSPORT not in trusted:
        rec["verdict"], rec["reason"] = "untrusted-transport", "%r not trusted" % CODE_TRANSPORT
        out["skipped"] += 1
        return
    obs = run_code_probe(probe)
    passed, verdict = classify("ok", obs)
    if passed != 1 and checkout_behind_contract(c.get("ts")):
        rec.update({"expected": "ok", "observed": obs, "verdict": "checkout-older-than-contract",
                    "reason": "contract created %s, after this checkout's commit, and main has moved past it (or its tip cannot be read); the next run judges it" % c.get("ts")})
        out["skipped"] += 1
        return
    rec.update({"expected": "ok", "observed": obs, "verdict": verdict})
    record_verification(c.get("issue_id"), c.get("class"), "code:" + ",".join(probe["paths"])[:200], CODE_TRANSPORT, "ok", obs, passed)
    rec["written"] = True
    out["pass" if passed == 1 else "fail"] += 1


# PROBE-AUTHOR-SINK-GUARD-1 (2026-10-26, agent_issues 1000421, pillar security; doctrine section 9): the birth dry run of a probe the live-path author writes is gated to a number or one
# short token, but every later pass re-runs the stored SQL and this runner recorded the first row's expected and observed untruncated in remediation_verifications and in its run log,
# whose first 8000 characters the remediation-consumer workflow commits to main of the public repository, where git history cannot recall them. For a contract whose module is
# probe-author-1 a pass whose expected or observed is not one short token (letters, digits and _ . : + -, 1 to 64 characters) is a probe-error with the reason free-text-value, raised
# before anything is recorded (consume_one's handler logs the reason only, never the value). qnfo-fleet-control's remediation tick carries the same guard (rtSinkGuard).
SINK_TOKEN_RE = re.compile(r"[A-Za-z0-9_.:+-]{1,64}")


def sink_guard(c, exp, obs):
    if str(c.get("module") or "") != "probe-author-1":
        return
    for v in (exp, obs):
        if v is None or str(v).strip() == "":
            continue
        if not SINK_TOKEN_RE.fullmatch(str(v).strip()):
            raise ValueError("free-text-value")


def consume_d1(c, rec, out, trusted):
    """Run one d1-query (or d1-query@plane) contract: the REMEDIATION-CONSUMER-1 path, unchanged."""
    cls = c.get("class")
    ok_probe, why = is_literal_select(c.get("verify_probe"))
    if not ok_probe:
        rec["verdict"] = "probe-not-machine-executable"
        rec["reason"] = why
        out["skipped"] += 1
        return
    transport = c.get("verify_transport")
    if str(transport or "").startswith("d1-query@"):
        pid, why = plane_db_id(transport)
        if not pid:
            rec["verdict"] = why
            rec["reason"] = "%s is not run here (%s)" % (transport, why)
            out["skipped"] += 1
            return
        rows = d1_plane(transport, c["verify_probe"])
    else:
        rows = d1(c["verify_probe"])
    exp, obs = extract_pair(rows)
    sink_guard(c, exp, obs)
    passed, verdict = classify(exp, obs)
    rec["expected"] = exp
    rec["observed"] = obs
    rec["verdict"] = verdict
    if verdict == "vacuous-probe-result":
        out["skipped"] += 1
        rec["reason"] = "probe returned no expected/observed pair"
    elif transport not in trusted:
        out["skipped"] += 1
        rec["verdict"] = "untrusted-transport"
        rec["reason"] = "%r not trusted" % transport
    elif is_deferred_read(obs):
        # CONSUMER-PENDING-IS-DEFERRAL-1: exactly as qnfo-fleet-control's tick treats it (DEFERRAL-NOT-A-FAILURE-1): the verdict is
        # 'deferred', no verification row is written (the table is a verdict ledger), and the contract is stamped 'deferred', never 'fail'.
        out["skipped"] += 1
        out["deferred"] = out.get("deferred", 0) + 1
        rec["verdict"] = "deferred"
        rec["reason"] = "the probe cannot judge yet: %s" % str(obs).strip()[:160]
    else:
        record_verification(c.get("issue_id"), cls, "d1:remediation_contracts/" + str(cls),
                            transport, str(exp).strip(), str(obs).strip(), passed)
        rec["written"] = True
        if passed == 1:
            out["pass"] += 1
        else:
            out["fail"] += 1


def next_due_offset(cadence_h, steady_state=False):
    """PROBE-DRAIN-1: due 15 minutes before the cadence, so an hourly contract is probed inside its 60-minute window
    (issues_unprobed_60m) by a run that starts on the hour, instead of always just after it.
    REMEDIATION-2X-1 (owner directive 2026-10-13: every issue remediation and consumer run at least twice as fast, issues
    drained faster than they accumulate): an ordinary contract is due again after half that interval. Stable contracts
    use their full back-off interval, minus 15 minutes, so the hourly consumer does not probe them every run."""
    minutes = int(float(cadence_h) * 60) - 15
    return "+%d minutes" % max(15, minutes if steady_state else minutes // 2)


STEADY_RUN = 6  # FM-5: identical passing verifications in a row before a contract backs off
# FM-DRIFT-1 (2026-11-05, cluster C9-FAILURE-MODES): 1.5 hours, was 2. The back-off stamps next_due_at 15 minutes before its interval ("+75 minutes");
# 2 hours stamped "+105", and fm-contract-cadence-drift (open-issue contracts due later than 90 minutes) read 5 of 5 backed-off contracts of open issues
# (metric-relapse-2607, metric-relapse-1000326, issue-1000575, issue-1000609, issue-1001695, each passing, gap 105 minutes) as drift, and sla_breaches_over_120m
# counts the same column. The two rules disagreed; the back-off now sits inside the drift bound and SLA-120M-1.
STEADY_CADENCE_H = 1.5  # SLA-120M-1: never beyond 120 minutes; fm-contract-cadence-drift: never scheduled later than 90 minutes
# FM-CADENCE-1 (RM 2026-11-04, cluster C9-FAILURE-MODES; metric failure_modes_recurring 208 = 80 recurring + 132 unprobed):
# a standing detector is an audit, not an issue fix, and never backs off. v_failure_mode_status calls a detector 'unprobed'
# when its newest verification is older than 60 minutes (FAILURE-MODE-PROBES-1, DETECTOR-CADENCE-1); FM-5 parked every
# fm-* contract whose last six passes read the same value (which is every healthy detector: it reads 1) at +105 minutes, so
# 117 of the 132 unprobed rows had last been probed 90-120 minutes ago while the in-Cloudflare tick, which would have
# re-probed them every 18 minutes, found them not due. Measured before FM-5 (2026-10-19): 2 unprobed. FM-5 was written for
# issue contracts (issue 1000473 re-verified with observed=0); the cost it saved on detectors is bought back by trimming
# the redundant index of remediation_verifications (fm-redundant-indexes).
STANDING_DETECTOR_PREFIXES = ("fm-", "belief-")


def standing_detector(cls):
    return str(cls or "").startswith(STANDING_DETECTOR_PREFIXES)


def steady_state_cadence(cls, verdict, cadence_h, transport=None):
    """FM-5 (ROADMAP-1 even-keel-fm-audit, agent_issues 1000721, pillar cost): remediation_verifications took 191,906 rows in
    7 days (78.6 percent pass) and issue 1000473 was re-verified every 80 minutes with observed=0. A contract whose last
    STEADY_RUN verifications all passed with the same observed value is re-probed every STEADY_CADENCE_H hours instead of at its
    own cadence (never beyond 90 minutes, FM-DRIFT-1; SLA-120M-1 allows 120). Only a pass backs off: a failing, deferred or changing contract keeps its
    cadence, so recovery and relapse are seen as fast as before. Runtime probes keep their hourly cadence."""
    if transport == HTTPS_TRANSPORT or standing_detector(cls):
        return cadence_h
    if verdict != "pass" or float(cadence_h) >= STEADY_CADENCE_H:
        return cadence_h
    rows = d1("SELECT pass, observed FROM remediation_verifications WHERE class = ? ORDER BY id DESC LIMIT %d" % STEADY_RUN, [cls])
    if len(rows) < STEADY_RUN:
        return cadence_h
    first = rows[0].get("observed")
    if all(int(r.get("pass") or 0) == 1 and r.get("observed") == first for r in rows):
        return STEADY_CADENCE_H
    return cadence_h


def consume_one(c, trusted):
    """Probe and stamp one contract with its own counters, so contracts can run in parallel (merge_out folds them)."""
    local = {"pass": 0, "fail": 0, "skipped": 0}
    cls = c.get("class")
    rec = {"class": cls, "issue_id": c.get("issue_id"), "verdict": None}
    next_status, cadence = None, None
    try:
        if c.get("verify_transport") == HTTPS_TRANSPORT:
            next_status, cadence = consume_https(c, rec, local, trusted)
        elif c.get("verify_transport") == CODE_TRANSPORT:
            consume_code(c, rec, local, trusted)
        else:
            consume_d1(c, rec, local, trusted)
    except Exception as e:  # noqa: BLE001 - one bad contract must not kill the run
        rec["verdict"] = "probe-error"
        rec["reason"] = str(e)[:300]
        local["skipped"] += 1
        log("contract %s error: %s" % (cls, e))
        # CONSUMER-ERROR-BODY-1 (2026-10-17): the run log is ephemeral and the fleet reads D1, so the same message also
        # lands in cloud_ops_events, deduped per (class, message) for an hour. 529 contracts sat at probe-error with
        # nothing to attribute it to; an unreadable failure is a blind spot, not a verdict.
        try:
            detail = "class=%s transport=%s error=%s" % (cls, c.get("verify_transport"), str(e)[:300])
            d1(
                "INSERT INTO cloud_ops_events (id, ts, kind, text, job, status) "
                "SELECT ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'remediation.probe-error', ?, "
                "'remediation-consumer', 'error' "
                "WHERE NOT EXISTS (SELECT 1 FROM cloud_ops_events WHERE kind = 'remediation.probe-error' "
                "AND text = ? AND ts > strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 minutes'))",
                ["pe-c-%s-%d" % (cls, int(time.time())), detail, detail],
            )
        except Exception:  # noqa: BLE001 - the ledger write never changes the verdict
            pass
    if cadence is None:
        cadence = c.get("expected_cadence_h") or 1
    steady_backoff = False
    try:
        next_cadence = steady_state_cadence(
            cls, rec.get("verdict"), cadence, c.get("verify_transport"))
        steady_backoff = float(next_cadence) > float(cadence)
        cadence = next_cadence
    except Exception:  # noqa: BLE001 - a failed history read keeps the contract's own cadence
        pass
    try:
        d1(
            "UPDATE remediation_contracts SET attempts = COALESCE(attempts,0) + 1, "
            "last_attempt_at = datetime('now'), last_verdict = ?, "
            # CONSUMER-STAMP-STATUS-1 (session_01SPji35 root cause): a status another writer set between the probe and this stamp (the superseded-closure
            # trigger sets 'superseded') must not be written back; only an active or holding contract takes the verdict's next status.
            "next_due_at = datetime('now', ?), status = CASE WHEN status IN ('active', 'holding') THEN COALESCE(?, status) ELSE status END WHERE class = ?",
            [rec["verdict"], next_due_offset(cadence, steady_backoff), next_status, cls],
        )
    except Exception as e:  # noqa: BLE001
        log("contract %s stamp failed: %s" % (cls, e))
    return rec, local


def merge_out(out, local):
    for k, v in local.items():
        if isinstance(v, list):
            out.setdefault(k, []).extend(v)
        elif isinstance(v, (int, float)):
            out[k] = out.get(k, 0) + v


# MIGRATION-UNAPPLIED-1 (2026-10-12). apply-migrations.yml runs on each push to main, but two merges in quick succession left
# the middle run cancelled by the workflow's single concurrency group (runs 93 and 94 on 2026-10-12: migrations
# 2026-10-12-code-multi-file-gate.sql, 2026-10-12-merge-side-root-causes.sql; 2026-10-12-reach-replies-subscribe-funnel.sql had no
# run at all), so three merged migrations were silent for hours: no table, no metric, no failure filed. This runner works in a
# checkout of main and holds the same D1 token, so every run lists the opted-in files, compares them with migration_runs and
# applies the ones with no ok or superseded row through scripts/apply_migrations.py (which records the run and files
# MIGRATION-APPLY-FAILED-1 on an error). Metric migrations_unapplied is the count left after the attempt.
MIGRATION_HEADER_RE = re.compile(r"^-- APPLY-BY: ci\s*$", re.M)


def opted_in_migrations(root):
    """Repository-relative paths of migrations/*.sql files that opt in to the runner, sorted."""
    out = []
    d = os.path.join(root, "migrations")
    if not os.path.isdir(d):
        return out
    for name in sorted(os.listdir(d)):
        if not name.endswith(".sql"):
            continue
        try:
            with open(os.path.join(d, name), encoding="utf-8") as fh:
                head = fh.read(4000)
        except OSError:
            continue
        if MIGRATION_HEADER_RE.search(head):
            out.append("migrations/" + name)
    return out


def unapplied_migrations(opted_in, applied_files):
    """The opted-in files with no ok or superseded migration_runs row (pure)."""
    done = set(applied_files or [])
    return [f for f in opted_in if f not in done]


def migrations_sweep(out, apply=None, root=None):
    """List, compare, apply; never raises. Writes the metric and one cloud_ops_events row when anything was missing."""
    res = {"opted_in": 0, "unapplied": [], "applied_now": [], "failed": [], "metric": None}
    try:
        root = root or REPO_ROOT
        files = opted_in_migrations(root)
        res["opted_in"] = len(files)
        rows = d1("SELECT DISTINCT file FROM migration_runs WHERE status IN ('ok', 'superseded')")
        missing = unapplied_migrations(files, [r.get("file") for r in rows])
        res["unapplied"] = missing
        for path in missing:
            try:
                with open(os.path.join(root, path), encoding="utf-8") as fh:
                    text = fh.read()
                rc = (apply or _apply_migration)(path, text)
                (res["applied_now"] if rc == 0 else res["failed"]).append(path)
            except Exception as e:  # noqa: BLE001 - one bad file must not stop the sweep
                res["failed"].append(path + ": " + str(e)[:160])
        left = len(res["failed"])
        res["metric"] = left
        d1("UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2, state = 'MEASURED' WHERE metric = 'migrations_unapplied'",
           [str(left), time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())])
        if missing:
            d1("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, ?2, 'migration-sweep', ?3, ?4, 'remediation-consumer', ?5)",
               ["migration-sweep-%d" % int(time.time()), time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "MIGRATION-UNAPPLIED-1: %d opted-in migration(s) had no run: applied now %s; failed %s" % (len(missing), ", ".join(res["applied_now"]) or "none", ", ".join(res["failed"]) or "none"),
                json.dumps(res)[:3000], "error" if res["failed"] else "ok"])
    except Exception as e:  # noqa: BLE001
        res["error"] = str(e)[:200]
    out["migrations"] = res
    return res


def _apply_migration(path, text):
    """scripts/apply_migrations.py in the same directory; its apply_file records migration_runs and files failures."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import apply_migrations  # noqa: E402 - sibling script, imported only when a file is missing
    commit = os.environ.get("GITHUB_SHA", "") or "remediation-consumer"
    return apply_migrations.apply_file(path, text, ACCOUNT, TOKEN, commit, emit=log)


def main():
    t0 = time.time()
    out = {"ok": True, "marker": "REMEDIATION-CONSUMER-1", "verifier": VERIFIER,
           "due": 0, "pass": 0, "fail": 0, "skipped": 0, "deferred": 0, "contracts": []}

    trusted = {r["transport"] for r in d1("SELECT transport FROM transport_trust WHERE trusted = 1")}
    out["trusted_transports"] = sorted(trusted)
    if not trusted:
        out["ok"] = False
        out["error"] = "transport_trust returned no trusted transport; refusing to run"
        print(json.dumps(out))
        return 1

    # PROBE-DRAIN-1 (2026-10-11, owner directive "remediate all open items and failure modes ... automatic resolution of root
    # causes"): one run took MAX_ITEMS (40) contracts, but 242 contracts are hourly and a quiet main runs this workflow about
    # once an hour, so 117 were overdue at 09:08Z and issues_unprobed_60m read 59 (failure-mode detectors unprobed: 8). A run
    # now drains the due set in batches of MAX_ITEMS, PROBE_WORKERS at a time, until nothing is due or PROBE_BUDGET_S runs out.
    contracts, seen = [], set()
    while time.time() - t0 < PROBE_BUDGET_S:
        batch = [c for c in d1(CONTRACT_SQL, [MAX_ITEMS]) if c.get("class") not in seen]
        if not batch:
            break
        seen.update(c.get("class") for c in batch)
        contracts += batch
        with concurrent.futures.ThreadPoolExecutor(max_workers=PROBE_WORKERS) as pool:
            for rec, local in pool.map(lambda c: consume_one(c, trusted), batch):
                merge_out(out, local)
                out["contracts"].append(rec)
    out["due"] = len(contracts)
    out["budget_exhausted"] = time.time() - t0 >= PROBE_BUDGET_S
    log("contracts probed: %d" % len(contracts))

    try:
        refresh_runtime_share(out)
    except Exception as e:  # noqa: BLE001 - the metric must not kill the run record
        out["runtime_share_error"] = str(e)[:200]

    # HOST-CENSUS-1 (2026-10-07): every public hostname of the account, probed from this runner every 6h; read-only,
    # self-filing and self-closing (scripts/host_census.py). A failure here never stops the contract run.
    try:
        import host_census
        out["host_census"] = host_census.run(d1, lambda path: _req("GET", CF_API + path), VERIFIER)
    except Exception as e:  # noqa: BLE001
        out["host_census_error"] = str(e)[:200]

    # VIEW-HEALTH-1 (2026-11-04): every qnfo-audit view is planned with EXPLAIN (reads no rows); a view that errors on read is filed
    # as one BLINDSPOT-1 issue and closed when all compile (scripts/view_health.py). A failure here never stops the contract run.
    # CONSUMER-SPEED-1 (2026-11-04): 242 serial EXPLAINs took 4 to 6 minutes of a 9 to 11 minute step, on the path every issue close waits for. The workflow's `consume`
    # job sets REMEDIATION_VIEW_HEALTH=sweeps and its `views` job runs `view_health.py --run` beside the contract run, every cycle; any other caller still runs it here.
    if os.environ.get("REMEDIATION_VIEW_HEALTH", "inline") == "inline":
        try:
            import view_health
            out["view_health"] = view_health.run(d1, VERIFIER)
        except Exception as e:  # noqa: BLE001
            out["view_health_error"] = str(e)[:200]
    else:
        out["view_health"] = {"skipped": "runs in the views job (REMEDIATION_VIEW_HEALTH=%s)" % os.environ.get("REMEDIATION_VIEW_HEALTH")}

    # FLEET-JOURNEYS-1 (2026-10-13): the end-to-end journeys from outside the account (runner gha, public hostnames), the second path
    # to qnfo-fleet-control's server-side journeyTick; at most every 50 minutes, self-filing and self-closing (scripts/fleet_journeys.py).
    # Called here, not as a workflow step, so the change needs no workflow edit. A failure never stops the contract run.
    try:
        import fleet_journeys
        out["fleet_journeys"] = fleet_journeys.run(d1, VERIFIER)
    except Exception as e:  # noqa: BLE001
        out["fleet_journeys_error"] = str(e)[:200]

    # CF-TOKEN-WATCH-1: the repository Cloudflare token's validity and expiry, every run. A failure never stops the run.
    try:
        cf_token_watch(out)
    except Exception as e:  # noqa: BLE001
        out["cf_token_watch_error"] = str(e)[:200]

    # MIGRATION-UNAPPLIED-1: merged migrations the push-triggered runner never ran are applied here, within the hour.
    migrations_sweep(out)

    spent = int((time.time() - t0) * 1000)
    try:
        d1(
            "INSERT INTO remediation_runs "
            "(run_id, module, issue_ids, budget_ms, spent_ms, items_due, items_attempted, "
            " items_pass, items_fail, stopped_reason, checkpoint, evidence, ended_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
            ["remediation-consumer-%d" % int(time.time()), "thread-remediation",
             json.dumps([c.get("issue_id") for c in contracts]),
             45000, spent, len(contracts),
             out["pass"] + out["fail"], out["pass"], out["fail"],
             "budget-exhausted" if out.get("budget_exhausted") else "completed",
             json.dumps({"contracts": out["contracts"]})[:4000],
             json.dumps({"verifier": VERIFIER, "trusted": sorted(trusted)})],
        )
    except Exception as e:  # noqa: BLE001
        log("run record failed: %s" % e)

    out["spent_ms"] = spent
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    if not TOKEN or not ACCOUNT:
        print(json.dumps({"ok": False, "marker": "REMEDIATION-CONSUMER-1",
                          "error": "CLOUDFLARE_API_TOKEN / CF_ACCOUNT_ID not set"}))
        sys.exit(0)
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "marker": "REMEDIATION-CONSUMER-1",
                          "error": str(exc)[:500]}))
        sys.exit(0)
