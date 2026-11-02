#!/usr/bin/env python3
"""deploy-drift-guard.py - repo<->live drift monitor (VERSION + CONTENT + DIRECTION).

ROOT CAUSE (why this exists):
  1. The canonical deploy (qnfo-ops POST /ops/deploy + the qnfo-fleet-control redeploy)
     fetches <dir>/deployed-current.worker.js -- NOT <dir>/worker.js (see mirror-guard.py).
     A monitor that reads worker.js measures the wrong artifact and false-reports.
  2. A worker with NO version constant is INVISIBLE to any version-based drift check
     (silent skip) -> the drift can never be seen or reconciled. Silent skips are the
     defect this tool refuses to allow.

CLASSES (no class is ever silently dropped):
  DRIFT            repo VERSION != live /health version  (reconcile required)
  CONTENT_DRIFT    repo artifact sha256 != live /content sha256 (after normalisation)
  NO_REPO_VERSION  worker is live but the repo has no version constant (source gap)
  NO_LIVE_VERSION  worker answers /health but omits a version field (live gap)
  NOT_DEPLOYED     genuinely absent: HTTP 404 AND not in the CF account script list
  NO_HEALTH_ROUTE  IS deployed, but https://<name>.q08.workers.dev/health 404s
  CRON_ONLY        IS deployed, /health 404s, AND the directory declares >=1 cron trigger
                   with NO HTTP surface (no routes / workers_dev / custom domain). A
                   scheduled-only worker has no HTTP surface by construction, so its
                   404 is not a monitoring gap (CRON_ONLY-2, issue #1402).
                   (workers.dev route disabled, or no /health route) -- NOT "not deployed"
  NOT_A_WORKER     the directory declares no worker config (no wrangler.toml/json/jsonc)
                   AND ships no worker artifact AND the name is absent from the CF script
                   list. Repo scaffolding / non-worker directories, reported separately so
                   they cannot inflate NOT_DEPLOYED (issue #1379).
  LIVE_ERR         /health unreachable or non-404 error
  SYNC             repo == live

NAME-RESOLUTION-1 (2026-09-29, FLEET-AUTOAUDIT false negatives):
  The repo DIRECTORY is not the worker name. `agent-orchestrator/wrangler.toml` declares
  `name = "qnfo-agent-orchestrator"`, which IS deployed and answers /health v1.1.0 -- while
  `agent-orchestrator.q08.workers.dev` is a host that never existed. Probing the directory
  name returned 404, and the worker was written as NOT_DEPLOYED. Measured on the first
  FLEET-AUTOAUDIT-1 run (2026-09-29 15:44:42Z): 112 rows, 76 NOT_DEPLOYED -- a 68%
  false-negative rate on the class that is supposed to mean "retired/never-deployed".
  The guard now resolves the probe target from wrangler.toml `name` (json/jsonc fallback,
  directory name as last resort) and cross-checks the CF API script list so that
  NO_HEALTH_ROUTE is never conflated with NOT_DEPLOYED. When the CF script list is
  unavailable (no token / API error) the guard degrades to the previous NOT_DEPLOYED
  reading and reports `cf_script_list: false` rather than guessing.
  Every directory still yields exactly one class -- the fix removes a false negative,
  it does not introduce a silent skip.

NOT-DEPLOYED-KEYED-BY-DIR-1 / NOT-DEPLOYED-NONWORKER-NOISE-1 (2026-09-29, issues
#1379/#1380): two residual defects in the class above.
  (a) KEYING: every other class emitted the RESOLVED worker name, but NOT_DEPLOYED emitted
      the raw repo DIRECTORY, so the consumer wrote `worker_live_audit.worker` values that
      are not worker names and cannot be joined against the CF account or the service
      registry. `not_deployed_workers` is now a list of {"worker","dir"} objects (the legacy
      bare-string list is still emitted as `not_deployed_dirs` so no consumer silently
      changes meaning).
  (b) NOISE: a directory with no worker config and no worker artifact is not a worker; the
      old code reported it as NOT_DEPLOYED purely because its name was absent from the
      account. Measured 2026-09-29: ~26% of the class. Such directories are now classed
      NOT_A_WORKER, which is reported and counted but never treated as a worker.
  `scope` is emitted in JSON ("all" | "narrative") so the consumer knows whether the run
  covered every directory and may therefore purge stale rows (issue #1378).

DIRECTION (2026-09-29, issue #1229): a version mismatch is not automatically "the repo
is right". The live bundle can be AHEAD of the repo (DEPLOY-UNLOGGED-MUTATION, issues
#1340-#1343, and the qnfo-lifecycle 1.6.2-cronconsolidate case). `--ahead` therefore
emits only the workers where the repo artifact is STRICTLY AHEAD of live by numeric
version comparison -- the only direction where redeploying the repo is safe. Anything
else is reported, never auto-applied. This is the machine-readable contract used by
.github/workflows/fleet-autodeploy.yml.
MULTI-VERSION-AHEAD-EXCLUSION-1 (issue 1457): an artifact that declares MORE THAN
ONE distinct plain VERSION cannot be direction-trusted at all -- `_repo_version()`
picks the last declaration (#1388), which is a heuristic about which binding
/health serves. Such a worker is reported as MULTI_VERSION and is NEVER emitted in
`--ahead`, so an ambiguous artifact can never drive an autodeploy downgrade.
MULTI_VERSION is reported but not counted in the exit code, on the same precedent
as NO_HEALTH_ROUTE and NOT_A_WORKER: it is an ambiguity in the monitor's input, not
a repo<->live divergence.

CONTENT MODE (--content): fetches the live bundle from the CF API /content endpoint and
compares a normalised sha256 against the repo canonical artifact. This closes the gap
called out in issue #1229 (content-level repo<->live drift is undetectable and the
fleet-wide check is continue-on-error). Requires CLOUDFLARE_API_TOKEN + CF_ACCOUNT_ID.
Content drift is REPORT-ONLY: it is never used to justify an auto-deploy on its own,
because a mirror capture can legitimately differ in formatting from a fresh build.

JSON MODE (--json): emits ONE line of JSON carrying the full membership of every class,
including `sync_workers` and `not_deployed_workers`. Counts alone are not auditable: a
consumer (scripts/fleet-autoaudit.py) must be able to write a row per worker, so every
class carries its worker names. Entries carry BOTH `worker` (the resolved CF script name,
the value that is actually probed) and `dir` (the repo directory), so a consumer cannot
confuse the two again.

Default scope = the narrative-generation surfaces we own. `--all` = all workers.
Exit: 0 clean (scoped: SYNC only) | 1 any DRIFT / CONTENT_DRIFT / NO_*_VERSION / LIVE_ERR
NO_HEALTH_ROUTE and NOT_A_WORKER are reported but deliberately NOT counted in the exit
code: a private worker with a disabled workers.dev route is not a repo<->live divergence,
and a non-worker directory is not a divergence at all -- making either blocking would turn
a monitoring gap into a fleet-wide CI outage.
"""
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# VERSION-PRECEDENCE-1: capture the prefix so the plain VERSION constant can win.
# VERSION-QUOTE-1 (2026-09-29): accept single OR double quoted VERSION constants.
# REGEX-LITERAL-VERSION-1 (2026-10-01): a declaration must not be preceded by ^ / \\ or a quote. qnfo-fleet-control embeds
# the TEXT of a VERSION declaration inside a regex literal (`/^var VERSION = "(\d+)\.(\d+)...`) and a match() call, and the
# last-wins rule below picked that fragment as the repo version: worker_live_audit.registry_before read
# `\d+\.\d+\.\d+[^` and the worker showed DRIFT against a correct live 0.4.51 for as long as the code existed.
CONST = re.compile(r'(?<![\^/\\\'"`])(?:var|let|const)\s+(QNFO_)?VERSION\s*=\s*[\'"]([^\'"]+)[\'"]')
# TOP-LEVEL-VERSION-1 (2026-10-01): same declaration, but only at column 0. A folded-in module keeps its own indented
# `var VERSION` inside an IIFE (personal-companion's VaultIndexer, "0.1.21-folded"); it is NOT what /health serves, yet
# it comes LATER in the file, so the last-wins rule below reported it as the repo version and the worker showed DRIFT
# against a correct live 1.7.2. Top-level declarations are preferred; with none, behaviour is unchanged.
CONST_TOP = re.compile(r'(?m)^(?<![\^/\\\'"`])(?:var|let|const)\s+(QNFO_)?VERSION\s*=\s*[\'"]([^\'"]+)[\'"]')
# VERSION-QUOTE-1 (2026-09-29): SERVER_VERSION fallback. PROTOCOL_VERSION is a
# different fact and is deliberately NOT matched (see the module docstring).
SERVER_CONST = re.compile(r'(?:var|let|const)\s+SERVER_VERSION\s*=\s*[\'"]([^\'"]+)[\'"]')
CANON = ("deployed-current.worker.js", "worker.js")
TIMEOUT = 20
NARRATIVE = ["qnfo-ai", "qnfo-research-exec", "qnfo-ipatent", "qnfo-gateway"]
API_CONTENT = ("https://api.cloudflare.com/client/v4/accounts/{acct}"
               "/workers/scripts/{worker}/content")
API_SCRIPTS = ("https://api.cloudflare.com/client/v4/accounts/{acct}"
               "/workers/scripts")
WRANGLER_NAME = re.compile(r'^\s*name\s*=\s*"([^"]+)"', re.M)
WRANGLER_JSON = ("wrangler.json", "wrangler.jsonc")


def _norm(text):
    """Normalise before hashing: the live bundle is an esbuild artifact and the repo
    mirror is a capture of it, but line endings / trailing whitespace can differ."""
    lines = [ln.rstrip() for ln in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def _sha(text):
    return hashlib.sha256(_norm(text).encode("utf-8", "replace")).hexdigest()


def _num_prefix(v):
    m = re.match(r"^(\d+(?:\.\d+)*)", v or "")
    if not m:
        return None
    return tuple(int(x) for x in m.group(1).split("."))


def cmp_ver(repo_v, live_v):
    """-1 repo behind, 0 equal, 1 repo ahead, None not comparable numerically."""
    a, b = _num_prefix(repo_v), _num_prefix(live_v)
    if a is None or b is None:
        return None
    n = max(len(a), len(b))
    a = a + (0,) * (n - len(a))
    b = b + (0,) * (n - len(b))
    return (a > b) - (a < b)


def wrangler_name(d):
    """NAME-RESOLUTION-1: resolve the DEPLOYED worker name for a repo directory.

    The directory name is not the worker name (`agent-orchestrator` deploys as
    `qnfo-agent-orchestrator`). Probing the directory produced 404 -> NOT_DEPLOYED on a
    healthy worker. Prefer the wrangler.toml `name`; fall back to wrangler.json/jsonc;
    return None when nothing is declared so the caller can use the directory name.
    """
    p = os.path.join(ROOT, d, "wrangler.toml")
    if os.path.isfile(p):
        try:
            with open(p, encoding="utf-8", errors="replace") as fh:
                m = WRANGLER_NAME.search(fh.read())
        except OSError:
            m = None
        if m and m.group(1).strip():
            return m.group(1).strip()
    for fn in WRANGLER_JSON:
        p = os.path.join(ROOT, d, fn)
        if os.path.isfile(p):
            try:
                with open(p, encoding="utf-8", errors="replace") as fh:
                    data = json.load(fh)
            except Exception:
                continue
            n = data.get("name")
            if isinstance(n, str) and n.strip():
                return n.strip()
    return None


def declared_crons(d):
    """Cron triggers declared in the wrangler.toml ([] when none)."""
    p = os.path.join(ROOT, d, "wrangler.toml")
    if not os.path.isfile(p):
        return []
    try:
        with open(p, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except OSError:
        return []
    out = []
    for line in text.splitlines():
        s = line.strip()
        if not s.startswith("crons"):
            continue
        if "=" not in s or "[" not in s or "]" not in s:
            continue
        body = s.split("[", 1)[1].rsplit("]", 1)[0]
        for tok in body.split(","):
            tok = tok.strip()
            for q in (chr(34), chr(39)):
                tok = tok.strip(q)
            if tok:
                out.append(tok)
    return out


def declares_http_surface(d):
    """True when ANY HTTP surface is declared. FAIL-CLOSED on doubt."""
    toks = ("routes", "workers_dev", "route =", "[route", "[[routes]]")
    p = os.path.join(ROOT, d, "wrangler.toml")
    if os.path.isfile(p):
        try:
            with open(p, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            return True
        return any(t in text for t in toks)
    for fn in ("wrangler.json", "wrangler.jsonc"):
        q = os.path.join(ROOT, d, fn)
        if os.path.isfile(q):
            try:
                with open(q, encoding="utf-8", errors="replace") as fh:
                    return "routes" in fh.read()
            except OSError:
                return True
    return True


def cron_only_declared(d):
    """CRON_ONLY-2 (issue #1402): >=1 cron and no HTTP surface."""
    return bool(declared_crons(d)) and not declares_http_surface(d)


def deployed_workers(acct, token):
    """The authoritative deployed-script set from the CF API.

    None when unavailable (no credentials / API error). Callers MUST NOT read None as
    "nothing is deployed" -- that would re-introduce the false negative this closes.
    """
    if not (acct and token):
        return None
    out, page = set(), 1
    try:
        while True:
            url = API_SCRIPTS.format(acct=acct) + f"?per_page=100&page={page}"
            req = urllib.request.Request(url, headers={
                "Authorization": "Bearer " + token,
                "User-Agent": "qnfo-deploy-drift-guard"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                body = json.load(r)
            for it in body.get("result", []):
                if it.get("id"):
                    out.add(it["id"])
            info = body.get("result_info") or {}
            if page >= int(info.get("total_pages") or 1):
                break
            page += 1
    except Exception:
        return None
    return out


# MODULE-SCOPE-DEPTH-1 (2026-10-01): which `VERSION` does /health serve? The one at MODULE scope, i.e. brace/paren/bracket
# depth 0. A bundler (esbuild) inlines each embedded sub-worker inside an IIFE WITHOUT re-indenting it, so an embedded
# worker's `var VERSION` is at column 0 too and column/last-wins heuristics pick the wrong one: radar-hub declares 1.0.9 (its
# own, depth 0), 1.0.8 / 1.0.1+fabric (embedded IIFEs) and 1.2.4 (the LAST embedded worker), and was reported as DRIFT
# against a correct live 1.0.9 on every audit. This is a small JS scanner that skips strings, comments, template literals
# (including `${...}`) and regex literals so braces inside them cannot corrupt the depth. If it cannot find a depth-0
# declaration the caller falls back to the older heuristics, so a scanner confusion degrades to the previous behaviour.
_RE_PREV = set("(,=:[!&|?{};+-*%<>~^")
_RE_WORDS = {"return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "yield", "await"}


def _js_template(text, i, starts, hits):
    n = len(text)
    while i < n:
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if c == "`":
            return i + 1
        if c == "$" and text[i + 1:i + 2] == "{":
            i = _js_scan(text, i + 2, starts, hits, True)
            continue
        i += 1
    return i


def _js_scan(text, i, starts, hits, expr_mode):
    n = len(text)
    depth = 0
    prev = ""
    word = ""
    while i < n:
        c = text[i]
        if not expr_mode and depth == 0 and i in starts:
            hits.append(starts[i].group(2))
        if c in " \t\r\n":
            i += 1
            continue
        if c == "/" and text[i + 1:i + 2] == "/":
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if c == "/" and text[i + 1:i + 2] == "*":
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in "\"'":
            i += 1
            while i < n and text[i] != c and text[i] != "\n":
                i += 2 if text[i] == "\\" else 1
            i += 1
            prev, word = "a", ""
            continue
        if c == "`":
            i = _js_template(text, i + 1, starts, hits)
            prev, word = "a", ""
            continue
        if c == "/" and (prev == "" or prev in _RE_PREV or word in _RE_WORDS):
            i += 1
            in_class = False
            while i < n and text[i] != "\n":
                ch = text[i]
                if ch == "\\":
                    i += 2
                    continue
                if ch == "[":
                    in_class = True
                elif ch == "]":
                    in_class = False
                elif ch == "/" and not in_class:
                    break
                i += 1
            i += 1
            while i < n and text[i].isalpha():
                i += 1
            prev, word = "a", ""
            continue
        if c.isalnum() or c in "_$":
            j = i
            while j < n and (text[j].isalnum() or text[j] in "_$"):
                j += 1
            word, prev = text[i:j], "a"
            i = j
            continue
        word, prev = "", c
        if c in "{([":
            depth += 1
        elif c in "})]":
            if expr_mode and c == "}" and depth == 0:
                return i + 1
            depth -= 1
        i += 1
    return i


def _module_scope_versions(text):
    """Plain (non-QNFO_) VERSION values declared at module scope (depth 0), in file order."""
    starts = {m.start(): m for m in CONST.finditer(text) if not m.group(1)}
    hits = []
    if starts:
        _js_scan(text, 0, starts, hits, False)
    return hits


def _repo_version(text):
    """VERSION-PRECEDENCE-1: prefer the plain `VERSION` constant over `QNFO_VERSION`.

    A worker artifact can declare both. `QNFO_VERSION` is a build/fabric tag
    (e.g. "qnfo-archive/fabric-20260910"); `VERSION` is the value the worker actually
    serves on /health. Returning the first regex match made qnfo-archive report a fabric
    tag as its repo version -- a permanent false DRIFT against a live /health of 1.2.0,
    and a corrupted numeric direction comparison for --ahead. The plain constant wins;
    QNFO_VERSION remains a fallback so no worker becomes invisible to the drift check.
    """
    # MODULE-SCOPE-DEPTH-1: a real scope check beats any column heuristic (see _module_scope_versions).
    d0 = _module_scope_versions(text)
    if d0:
        return d0[-1]
    top_plain = [val for prefix, val in CONST_TOP.findall(text) if not prefix]
    if top_plain:
        return top_plain[-1]
    hits = CONST.findall(text)
    if hits:
        # VERSION-PRECEDENCE-2-MULTI-DECLARATION-1 (2026-09-29, issue #1388): a
        # concatenated bundle can declare the SAME constant twice in different scopes
        # (fleet-exec: line 7 "fleet-executor/0.3.2" inside the wrapped exec module,
        # line 186 "1.0.2" = the value /health actually serves). Returning the FIRST
        # match produced a permanent false DRIFT on a canonical deploy target. In a
        # concatenated artifact the LATER binding is the effective one, so the LAST
        # plain VERSION wins; QNFO_VERSION remains the fallback.
        plain = [val for prefix, val in hits if not prefix]
        if plain:
            # MODULE-SCOPE-VERSION-1 (2026-10-01): last-wins is wrong when a worker FOLDS another worker's
            # code in at the END of the bundle (personal-companion: line 9 `var VERSION = "1.7.2-..."` is
            # served by /health; line 1859 `  var VERSION = "0.1.21-folded"` is the folded vault-indexer's
            # own, indented). Last-wins picked the folded one -> permanent false DRIFT. A declaration at
            # column 0 is module scope; prefer the last of those, and keep plain last-wins only when no
            # plain declaration starts a line (so fleet-exec, both col 0, still resolves to its last).
            top = [m.group(2) for m in CONST.finditer(text)
                   if not m.group(1) and (m.start() == 0 or text[m.start() - 1] == "\n")]
            return (top or plain)[-1]
        return hits[-1][1]
    # VERSION-QUOTE-1: explicit SERVER_VERSION fallback, never a wildcard prefix.
    # PROTOCOL_VERSION precedes SERVER_VERSION in qnfo-memory-mcp and is not the
    # value the worker serves on /health.
    m = SERVER_CONST.search(text)
    return m.group(1) if m else None


def repo_artifact(d):
    """Return (version, path, text) for the canonical repo artifact, or (None, None, None)."""
    first = None
    for fn in CANON:
        p = os.path.join(ROOT, d, fn)
        if os.path.isfile(p):
            try:
                with open(p, encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
            except OSError:
                continue
            v = _repo_version(text)
            if v:
                return v, p, text
            # VERSION-PRECEDENCE-2: do NOT give up on the first candidate. Returning
            # None here reported NO_REPO_VERSION without ever consulting the second
            # canonical artifact -- a false source-gap whenever only the mirror lacks
            # the constant.
            if first is None:
                first = (None, p, text)
    return first if first is not None else (None, None, None)


def _plain_versions(text):
    """Distinct plain (non-QNFO_) VERSION declarations in one artifact.

    MULTI-VERSION-AHEAD-EXCLUSION-1 (issue 1457): a concatenated bundle may declare the
    plain constant several times in different scopes. `_repo_version()` resolves WHICH
    value to report (last-wins, #1388), but the NUMBER of distinct values is what
    decides whether the direction is trustworthy enough to auto-deploy on.
    """
    return sorted(set(val for prefix, val in CONST.findall(text) if not prefix))


def multi_version_reason(text):
    """Return the distinct plain versions when an artifact is ambiguous, else None.

    More than one distinct plain VERSION declaration means /health could be served from
    either binding and the repo<->live direction cannot be established from a heuristic.
    Such a worker is excluded from --ahead; the caller reports it as MULTI_VERSION.
    """
    vs = _plain_versions(text)
    return vs if len(vs) > 1 else None


def live_result(worker):
    url = "https://" + worker + ".q08.workers.dev/health"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "qnfo-deploy-drift-guard"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = json.load(r)
        return True, (data.get("version") or data.get("VERSION"))
    except urllib.error.HTTPError as e:
        return (False, None) if e.code == 404 else (False, "ERR:" + str(e)[:50])
    except Exception as e:
        return (False, "ERR:" + str(e)[:50])


# UNMANAGED-PROBE-1 / AUDIT-CRASH-FIX-1 (2026-10-26, agent_issues 100448): worker_live_audit's universe was the repo directories, so a
# script that is live in the account but has no directory was never probed. The consumer half merged three times (PRs 4201, 4221, 4226)
# with no producer: this guard only ever emitted `cf_script_list`, a BOOLEAN ("was the list readable"), and the consumer iterated it,
# which raised `TypeError: 'bool' object is not iterable` in every fleet-autodeploy run from 2026-10-25T20:21Z and froze
# worker_live_audit. The producer lives here, next to the CF script list it is built from: `unmanaged_workers` is
# [{worker, http, version}] for each deployed script that no repo directory names, probed on /health. A script answering 410 is a
# deliberate tombstone (qnfo-workers, the Workers Builds project, answers 410 "retired") and is counted, not reported.
UNMANAGED_MAX = 40
UNMANAGED_THREADS = 8
UNMANAGED_HEALTH_URLS = {
    # This Worker is intentionally exposed on lee.qnfo.org; its workers.dev health URL is unavailable.
    "qnfo-fleet-lee": "https://lee.qnfo.org/api/health",
}


def health_probe(worker):
    """(http, version) from the worker's health URL; http 0 when nothing answered."""
    url = UNMANAGED_HEALTH_URLS.get(worker, "https://" + worker + ".q08.workers.dev/health")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "qnfo-deploy-drift-guard"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            code, body = r.getcode(), r.read(65536)
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:
        return 0, None
    try:
        data = json.loads(body.decode("utf-8", "replace"))
        return code, (data.get("version") or data.get("VERSION")) if isinstance(data, dict) else None
    except Exception:
        return code, None


def unmanaged_scripts(deployed, repo_workers, probe=health_probe):
    """Deployed scripts with no repo directory, probed: (reported, tombstones, truncated).

    `deployed` is None when the CF script list was unreadable; that is "unknown", never "nothing", so nothing is reported.
    """
    if deployed is None:
        return [], 0, False
    names = sorted(set(deployed) - set(repo_workers))
    truncated = len(names) > UNMANAGED_MAX
    names = names[:UNMANAGED_MAX]
    if not names:
        return [], 0, False
    with ThreadPoolExecutor(max_workers=UNMANAGED_THREADS) as pool:
        probed = list(pool.map(probe, names))
    reported, tombstones = [], 0
    for w, (http, version) in zip(names, probed):
        if http == 410:
            tombstones += 1
            continue
        reported.append({"worker": w, "http": http, "version": version})
    return reported, tombstones, truncated


def live_content(worker, acct, token):
    """Fetch the live bundle text via the CF API /content endpoint. None on any failure."""
    url = API_CONTENT.format(acct=acct, worker=worker)
    try:
        req = urllib.request.Request(url, headers={
            "Authorization": "Bearer " + token,
            "User-Agent": "qnfo-deploy-drift-guard",
        })
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.read().decode("utf-8", "replace")
    except Exception:
        return None


def main():
    argv = sys.argv[1:]
    scan_all = "--all" in argv
    want_content = "--content" in argv
    want_json = "--json" in argv
    want_ahead = "--ahead" in argv
    wanted = set(a for a in argv if not a.startswith("-"))
    if not wanted and not scan_all:
        wanted = set(NARRATIVE)

    acct = os.environ.get("CF_ACCOUNT_ID", "")
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    content_ok = bool(acct and token)
    deployed = deployed_workers(acct, token)

    drift, content_drift, ahead, no_repo_ver, no_live_ver = [], [], [], [], []
    not_deployed, sync_workers, live_err, no_health = [], [], [], []
    multi_version = []
    not_a_worker = []
    cron_only = []
    label_mismatch = []
    retired_present = []
    repo_workers = set()

    for d in sorted(os.listdir(ROOT)):
        if not os.path.isdir(os.path.join(ROOT, d)):
            continue
        # ROOT-CAUSE FIX: .git/.github/.wrangler/_shared are infra dirs, not workers --
        # probing them produced bogus LIVE_ERR (invalid worker hostnames).
        if d.startswith(".") or d.startswith("_"):
            continue
        # NAME-RESOLUTION-1: the directory is not the worker name. Probe what is deployed.
        declared = wrangler_name(d)
        worker = declared or d
        repo_workers.add(worker)
        if wanted and d not in wanted and worker not in wanted:
            continue
        # RETIRED-PRESENT-1 (#272): a directory marked FOLDED/RETIRED means the worker must be absent from the
        # account. If the CF script list still has it, it was recreated (2026-10-01: qnfo-agent-ws, then
        # qnfo-fleet-calibrator). Informational only: it does not change the exit code, because the fix is to delete
        # the stray script, which no deploy gate can do. It is reported so the audit and /state can surface it.
        _marker = next((m for m in ("FOLDED", "RETIRED") if os.path.isfile(os.path.join(ROOT, d, m))), None)
        if _marker and deployed is not None and worker in deployed:
            retired_present.append((d, worker, _marker))
        # FOLDED-NO-PROBE-1 (2026-10-13): a FOLDED/RETIRED directory whose worker is absent from the account is the expected state,
        # so its host is not probed. The probe of a host that no longer exists can time out instead of answering 404, which filed
        # qnfo-twin-maintain (folded into personal-api 2026-10-01) as LIVE_ERR "The read operation timed out" and re-prompted every
        # drain session for an item with nothing to do. It stays in not_deployed with its marker (AUTOAUDIT-ACTIONABLE-1).
        if _marker and deployed is not None and worker not in deployed:
            not_deployed.append((d, worker))
            continue
        rv, rpath, rtext = repo_artifact(d)
        live, lv = live_result(worker)
        if not live and lv is None:
            # 404. Only NOT_DEPLOYED when the worker is genuinely absent from the account:
            # a deployed worker with a disabled workers.dev route also 404s here, and
            # calling that NOT_DEPLOYED is the false negative NAME-RESOLUTION-1 closes.
            if deployed is None or worker in deployed:
                # CRON_ONLY-2 (issue #1402): a scheduled-only worker has no HTTP
                # surface by construction. Fail-closed: ambiguous stays NO_HEALTH_ROUTE.
                if cron_only_declared(d):
                    cron_only.append((d, worker))
                else:
                    no_health.append((d, worker))
            elif declared is None and rpath is None:
                # NOT-DEPLOYED-NONWORKER-NOISE-1: no wrangler config, no worker artifact,
                # and the name is absent from the account -- this directory is not a worker.
                # Reporting it as NOT_DEPLOYED inflated the class with repo scaffolding.
                not_a_worker.append((d, worker))
            else:
                not_deployed.append((d, worker))
            continue
        if not live:  # ERR (not 404)
            live_err.append((d, worker, lv))
            continue
        if rv is None:
            no_repo_ver.append((d, worker, lv))
        elif not lv:
            no_live_ver.append((d, worker, rv))
        elif lv != rv and cmp_ver(rv, lv) == 0:
            # LABEL-MISMATCH-CLASS-1 (issue 1370 defect A): identical numeric version,
            # different build label (repo 1.6.2 vs live 1.6.2-cronconsolidate). A redeploy
            # cannot change a label, and the repo artifact can be byte-identical to live,
            # so this is NOT drift. Reported on stderr (never a silent skip) but kept OUT
            # of `drift`, so it cannot fail the exit code. --content sha stays the
            # authority on whether the bytes actually differ.
            label_mismatch.append((d, worker, rv, lv))
            sys.stderr.write("LABEL_MISMATCH %s (dir %s): repo=%s live=%s\n" % (worker, d, rv, lv))
        elif lv != rv:
            drift.append((d, worker, rv, lv))
            if cmp_ver(rv, lv) == 1:
                # MULTI-VERSION-AHEAD-EXCLUSION-1 (issue 1457): the repo artifact
                # declares more than one distinct plain VERSION, so which value
                # /health serves is a heuristic (see _repo_version, #1388). The
                # DIRECTION is therefore not trustworthy and this worker must never
                # reach --ahead, or fleet-autodeploy could DOWNGRADE live. Reported
                # loudly instead -- never a silent skip.
                mv = multi_version_reason(rtext or "")
                if mv:
                    multi_version.append((d, worker, rv, lv, rpath, ",".join(mv)))
                    sys.stderr.write(
                        "MULTI_VERSION %s (dir %s): repo=%s live=%s declarations=%s "
                        "(excluded from --ahead: direction ambiguous)\n"
                        % (worker, d, rv, lv, ",".join(mv)))
                else:
                    ahead.append((d, worker, rv, lv, rpath))
        else:
            # SYNC-VERSION-CAPTURE-1 (issue 1509): sync_workers used to be bare worker
            # name strings, so the consumer had no version to write and
            # worker_live_audit.live_version was NULL for every SYNC row -- making
            # match=1 indistinguishable from a degenerate liveness pass. Emit the
            # {worker,dir,version} object shape used by every other class.
            sync_workers.append({"worker": worker, "dir": d, "version": lv})
        if want_content and content_ok and rtext is not None:
            live_text = live_content(worker, acct, token)
            if live_text is not None and _sha(live_text) != _sha(rtext):
                content_drift.append((d, worker, _sha(rtext)[:12], _sha(live_text)[:12], rpath))

    unmanaged, unmanaged_tombstones, unmanaged_truncated = unmanaged_scripts(deployed, repo_workers) if scan_all else ([], 0, False)

    if want_json:
        print(json.dumps({
            "scope": "all" if scan_all else "narrative",
            "sync": len(sync_workers),
            "sync_workers": sync_workers,
            "drift": [{"worker": w, "dir": d, "repo": r, "live": l} for d, w, r, l in drift],
            "content_drift": [{"worker": w, "dir": d, "repo_sha": a, "live_sha": b, "artifact": p}
                              for d, w, a, b, p in content_drift],
            "ahead": [{"worker": w, "dir": d, "repo": r, "live": l, "artifact": p}
                      for d, w, r, l, p in ahead],
            "multi_version": [{"worker": w, "dir": d, "repo": r, "live": l,
                               "artifact": p, "declarations": dec}
                              for d, w, r, l, p, dec in multi_version],
            "multi_version_count": len(multi_version),
            "no_repo_version": [{"worker": w, "dir": d, "live": l} for d, w, l in no_repo_ver],
            "no_live_version": [{"worker": w, "dir": d, "repo": r} for d, w, r in no_live_ver],
            "live_err": [{"worker": w, "dir": d, "err": e} for d, w, e in live_err],
            "no_health_route": [{"worker": w, "dir": d} for d, w in no_health],
            "cron_only": [{"worker": w, "dir": d, "crons": declared_crons(d)}
                          for d, w in cron_only],
            "cron_only_count": len(cron_only),
            # AUTOAUDIT-ACTIONABLE-1 (2026-10-11): a FOLDED/RETIRED directory that is absent from the account is the
            # expected state, not a missing deploy; the marker lets the audit count those apart (76 of 76 were, measured).
            "not_deployed_workers": [{"worker": w, "dir": d, "marker": next((m for m in ("FOLDED", "RETIRED") if os.path.isfile(os.path.join(ROOT, d, m))), None)}
                                     for d, w in not_deployed],
            "not_deployed_dirs": [d for d, w in not_deployed],
            "not_deployed_notdrift": len(not_deployed),
            "not_a_worker": [{"worker": w, "dir": d} for d, w in not_a_worker],
            "not_a_worker_count": len(not_a_worker),
            "retired_present": [{"worker": w, "dir": d, "marker": m} for d, w, m in retired_present],
            "retired_present_count": len(retired_present),
            "name_resolution": True,
            "cf_script_list": deployed is not None,
            "unmanaged_workers": unmanaged,
            "unmanaged_tombstones": unmanaged_tombstones,
            "unmanaged_truncated": unmanaged_truncated,
            "content_checked": bool(want_content and content_ok),
        }, sort_keys=True))
    else:
        for d, w, rv_, lv_ in drift:
            print(f"DRIFT {w} (dir {d}): repo={rv_} live={lv_}")
        for d, w, a, b, p in content_drift:
            print(f"CONTENT_DRIFT {w} (dir {d}): repo_sha={a} live_sha={b} artifact={p}")
        for d, w, rv_, lv_, p in ahead:
            print(f"AHEAD {w} (dir {d}): repo={rv_} live={lv_} artifact={p}")
        for d, w, lv_ in no_repo_ver:
            print(f"NO_REPO_VERSION {w} (dir {d}): live={lv_}")
        for d, w, rv_ in no_live_ver:
            print(f"NO_LIVE_VERSION {w} (dir {d}): repo={rv_}")
        for d, w in no_health:
            print(f"NO_HEALTH_ROUTE {w} (dir {d})")
        for d, w in cron_only:
            print(f"CRON_ONLY {w} (dir {d}): crons={','.join(declared_crons(d))}")
        for d, w in not_a_worker:
            print(f"NOT_A_WORKER {w} (dir {d})")
        for d, w, e in live_err:
            print(f"LIVE_ERR {w} (dir {d}): {e}")
        for u in unmanaged:
            print(f"UNMANAGED {u['worker']}: http={u['http']} version={u['version']} (live in the account, no repo directory)")
        for d, w, m in retired_present:
            print(f"RETIRED_PRESENT {w} (dir {d}): {m} marker but the script exists in the account")
        tag = "all" if scan_all else "narrative"
        print(f"deploy-drift-guard[{tag}]: sync={len(sync_workers)} drift={len(drift)} "
              f"content_drift={len(content_drift)} ahead={len(ahead)} "
              f"multi_version={len(multi_version)} "
              f"no_repo_version={len(no_repo_ver)} no_live_version={len(no_live_ver)} "
              f"no_health_route={len(no_health)} cron_only={len(cron_only)} "
              f"live_err={len(live_err)} "
              f"not_deployed_notdrift={len(not_deployed)} "
              f"not_a_worker={len(not_a_worker)} "
              f"cf_script_list={deployed is not None} "
              f"content_checked={bool(want_content and content_ok)}")

    if want_ahead:
        return 0
    problems = len(drift) + len(content_drift) + len(no_repo_ver) + len(no_live_ver) + len(live_err)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
