#!/usr/bin/env python3
"""Stop hook: re-prompt the session while actionable open items remain (>0).

Open = GitHub issues not carrying a rolling-report label (fleet-autoaudit,
fleet-drain-routine) + non-SYNC classes in the newest audits/fleet-autoaudit-*.json
(DRIFT / CONTENT_DRIFT / LIVE_ERR / NO_*_VERSION). Exit 2 + stderr = Claude continues.
Loop-capped (MAX_ROUNDS consecutive blocks) so a blocked owner-decision item cannot spin forever.
FIX-IN-OPEN-PR-1 (2026-10-02): an item whose fix already sits in an open PR waits on a merge, not on remediation,
so it is not re-prompted: an issue whose number an open PR's title or body cites (#N), and a DRIFT row whose
repo-ahead worker directory an open PR touches. Without this a session was re-prompted 16 times for #451/#452 and
autoaudit #52 while their fix (PR #453) only waited on the owner's merge.
LIVE-RECHECK-1 (2026-10-02): the audit table is a reading taken up to ~10 minutes before the issue is rewritten, so a
repo-ahead row whose deploy landed after that reading kept re-prompting (qnfo-ipatent 3.9.2: deployed 11:15:32Z, issue
written 11:16:25Z still said live 3.9.1, three rounds). A repo-ahead row whose worker's /health now reports the repo
version is a stale reading, not open work.
HOOK-REST-CACHE-1 (2026-11-04): one stop-hook run cost up to 33 GitHub REST calls (pulls, one pulls/<n>/files per open PR, issues, autoaudit), and every session
runs it on every stop; about ten sessions looping 8 rounds spent a large share of the one shared 5000/hour token, which read 0/5000 twice on 2026-11-04 and stalled every
merge. Reads now go through a disk cache shared by all sessions on the machine: an entry younger than CACHE_TTL_S (default 300) is used with no call, an older one is
revalidated with If-None-Match (a 304 does not count against the limit), and on any error, 403 rate limit included, the stale entry is used instead of failing.
DRAIN_CACHE_TTL_S=0 restores a call per read.
Fails open: any error -> exit 0.
"""
import glob, hashlib, json, os, re, sys, time, urllib.error, urllib.request

MAX_ROUNDS = int(os.environ.get("DRAIN_MAX_ROUNDS", "8"))
REPO = os.environ.get("DRAIN_REPO", "QNFO/qnfo-workers")
REPORT_LABELS = {"fleet-autoaudit", "fleet-drain-routine"}
BAD = ("DRIFT", "CONTENT_DRIFT", "LIVE_ERR", "NO_REPO_VERSION", "NO_LIVE_VERSION")
root = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
counter = os.path.join(os.environ.get("TMPDIR", "/tmp"), "qnfo-drain-rounds")

CACHE_TTL_S = int(os.environ.get("DRAIN_CACHE_TTL_S", "300"))
CACHE_DIR = os.path.join(os.environ.get("TMPDIR", "/tmp"), "qnfo-drain-cache")

def _fetch(url):
    """JSON for url through the shared disk cache (HOOK-REST-CACHE-1): fresh entry, else If-None-Match revalidation, else the stale entry on error."""
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    f = os.path.join(CACHE_DIR, hashlib.sha1(url.encode()).hexdigest() + ".json")
    cached = None
    try:
        cached = json.load(open(f))
        if time.time() - cached["t"] < CACHE_TTL_S:
            return cached["body"]
    except Exception:
        cached = None
    headers = {"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json", "User-Agent": "qnfo-drain-hook"}
    if cached and cached.get("etag"):
        headers["If-None-Match"] = cached["etag"]
    try:
        resp = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=10)
        body, etag = json.load(resp), resp.headers.get("ETag")
    except urllib.error.HTTPError as e:
        if e.code == 304 and cached:
            body, etag = cached["body"], cached.get("etag")
        elif cached:
            return cached["body"]
        else:
            raise
    except Exception:
        if cached:
            return cached["body"]
        raise
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        tmp = f + ".%d" % os.getpid()
        json.dump({"t": time.time(), "etag": etag, "body": body}, open(tmp, "w"))
        os.replace(tmp, f)
    except Exception:
        pass
    return body

def _get(path):
    return _fetch(f"https://api.github.com/repos/{REPO}/{path}")

_PRS = None

def open_prs():
    """[(number, title + body, set of top-level dirs it touches)] for up to 30 open PRs; [] on any error."""
    global _PRS
    if _PRS is not None:
        return _PRS
    _PRS = []
    try:
        if not (os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")):
            return _PRS
        for pr in _get("pulls?state=open&per_page=30"):
            dirs = set()
            try:
                dirs = {f["filename"].split("/")[0] for f in _get(f"pulls/{pr['number']}/files?per_page=100")}
            except Exception:
                pass
            _PRS.append((pr["number"], (pr.get("title") or "") + "\n" + (pr.get("body") or ""), dirs))
    except Exception:
        _PRS = []
    return _PRS

def fixed_by_open_pr(issue_number=None, worker_dirs=()):
    for num, text, dirs in open_prs():
        if issue_number is not None and re.search(r"#%d\b" % issue_number, text):
            return num
        if worker_dirs and set(worker_dirs) & dirs:
            return num
    return None

def issues():
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not tok:
        return []
    out = []
    for i in _get("issues?state=open&per_page=100"):
        if "pull_request" in i:
            continue
        if {l["name"] for l in i.get("labels", [])} & REPORT_LABELS:
            continue
        if fixed_by_open_pr(issue_number=i["number"]):
            continue
        out.append(f"#{i['number']} {i['title']}")
    return out

def live_version(worker):
    """LIVE-RECHECK-1: the version a worker's workers.dev /health reports now; None when it cannot be read."""
    try:
        req = urllib.request.Request(f"https://{worker}.q08.workers.dev/health", headers={"User-Agent": "qnfo-drain-hook"})
        return str(json.load(urllib.request.urlopen(req, timeout=6)).get("version") or "") or None
    except Exception:
        return None

def live_audit():
    """Class table of the live fleet-autoaudit issue; None if unavailable (artifact file lags it)."""
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not tok:
        return None
    rows = _get("issues?state=open&labels=fleet-autoaudit&per_page=1")
    if not rows:
        return None
    body = rows[0].get("body") or ""
    # Repo-ahead rows read "- `worker` (dir `dir`) repo `x` > live `y`": a DRIFT whose every repo-ahead row either has
    # its dir touched by an open PR (waits on that PR's merge and deploy) or is already live (LIVE-RECHECK-1) is not open.
    tail = body.split("## Repo-ahead", 1)[1] if "## Repo-ahead" in body else ""
    ahead = re.findall(r"- `([^`]+)` \(dir `([^`]+)`\) repo `([^`]+)`", tail)
    out = []
    for line in body.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 2 and cells[0] in BAD and cells[1].isdigit() and int(cells[1]) > 0:
            if cells[0] == "DRIFT" and ahead and int(cells[1]) <= len(ahead) and all(
                    fixed_by_open_pr(worker_dirs=[d]) or live_version(w) == v for w, d, v in ahead):
                continue
            out.append(f"autoaudit #{rows[0]['number']}: {cells[1]} x {cells[0]}")
    return out

def audit():
    try:
        live = live_audit()
        if live is not None:
            return live
    except Exception:
        pass
    fs = sorted(glob.glob(os.path.join(root, "audits", "fleet-autoaudit-2*.json")))
    if not fs:
        return []
    rows = json.load(open(fs[-1])).get("rows", {})
    return [f"{k}: {v.get('note')}" for k, v in rows.items() if str(v.get("note", "")).startswith(BAD)]

try:
    items = []
    for f in (issues, audit):
        try:
            items += f()
        except Exception:
            pass
    n = int(open(counter).read() or 0) if os.path.exists(counter) else 0
    if not items:
        if os.path.exists(counter):
            os.remove(counter)
        sys.exit(0)
    if n >= MAX_ROUNDS:
        os.remove(counter)
        sys.exit(0)
    open(counter, "w").write(str(n + 1))
    sys.stderr.write(f"{len(items)} open item(s) remain (round {n+1}/{MAX_ROUNDS}); continue remediating, commit and push:\n"
                     + "\n".join(items[:20]) + "\n")
    sys.exit(2)
except SystemExit:
    raise
except Exception:
    sys.exit(0)
