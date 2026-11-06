#!/usr/bin/env python3
"""BP26-REPO-1 collectors (2026-10-26, charter pillars core and security; agent_issues 1000348 workers best-practice lint, 1000349 D1 discipline, 1000350 R2/KV usage,
1000354 observability, 1000355 secrets).

The runner half of eight metrics of the BP26 catalogue that are measured from the repository checkout, the Cloudflare API or the migration ledger, run by
scripts/bp26_producers.py from the remediation-consumer job. A collector that cannot measure returns None and writes nothing (unknown is never a value). Nothing here prints
or stores a secret: the secret scan reports file:line and a pattern NAME only.

  collect_workers_config      workers_with_source_maps, observability_enabled_share
        Source maps: the share of live worker directories (the set scripts/fleet_best_practices_audit.py live_dirs() reads) whose wrangler config sets upload_source_maps = true.
        The note also says whether qnfo-ops, the canonical deploy path, has any source-map upload code at all: with none, a wrangler.toml line alone changes nothing deployed, and
        the lever is a change to the deploy path (a code-task), not 34 config edits. Observability: the share of DEPLOYED Workers (every script of the account, from the
        Cloudflare API script-settings) with observability.enabled; the wrangler.toml scan of the live directories is the fallback when the API cannot be read, and the note names
        which source was used.
  collect_kv_locking          kv_used_for_locking
        Static scan of every live worker.js for a KV namespace used as a lock or counter: a put on a binding declared under [[kv_namespaces]] whose key names a lock, lease, mutex,
        claim, counter, semaphore, sequence or increment, and a read-modify-write counter (parseInt or Number of an awaited get, an increment, a put within 400 characters).
        KV is eventually consistent, so two concurrent agents can both win; locks and counters belong in Durable Objects or D1. The value is the number of hits, evidence rows are
        file:line and the pattern. A line carrying `standards-ok:` is skipped, like the workers standards guard.
  collect_secrets_in_repo     secrets_in_repo
        Scan of the tracked files (git ls-files; the walk of the checkout when git is absent) for secret patterns: a PEM private key WITH a key body, an AWS
        access key id, GitHub tokens, Slack tokens, Stripe/OpenAI-style secret keys of real length, a Cloudflare-style 40-character token assigned to a token variable, and a
        Bluesky app password (four groups of four) on a password line, and quoted TOKEN/API_KEY assignments of 24 or more token characters (including Zenodo variable names).
        The generic assignment pattern is a heuristic, not proof that a credential is live. Entries of scripts/secret-scan-allowlist.txt (path | pattern | expiry | reason) are honoured until they
        expire. The value is the number of unallowlisted hits; a hit's text is never printed or stored. It is a pattern scan, not a replacement for a full scanner with entropy
        checks; the note says so.
  collect_credential_expiry   secret_expiry_warnings_open
        Reads qnfo-audit.bp26_credential_registry (migrations/2026-10-26-bp26-repo.sql): external credentials by NAME, with the way their expiry can be known. The value is the number of
        credentials with a KNOWN expiry inside 14 days and no open renewal issue. A credential with no expiry mechanism (X, Bluesky app password, Mastodon, Buffer, a Google service
        account key) is listed in the evidence rows as no-expiry-mechanism and is NOT counted as fine: the note names exactly which credentials the figure covers.
  collect_d1_size_and_drill   d1_db_size_pct, d1_restore_drill_age_days
        d1_db_size_pct: the largest D1 database of the account over its 10 GB limit (10 x 10^9 bytes, the conservative reading), from the Cloudflare API database list; one evidence
        row per database. d1_restore_drill_age_days: whole days since the newest d1_restore_drills row with outcome 'pass'; None while no drill has passed (an unknown age is not zero).
  collect_migration_bookmarks pre_migration_bookmark_recorded
        Every applied migration should leave a D1 Time Travel restore point. scripts/apply_migrations.py does not record one yet (the file is under another session's work claim;
        the apply-time capture is a code-task), so this collector records it: for each applied migration of the last 29 days without one it asks Time Travel for the bookmark at
        applied_at minus 120 seconds (the state just before the file ran) and stores it in migration_runs.bookmark, with bookmark_source 'time-travel-at(applied_at-120s)'. Time Travel
        keeps 30 days, so a bookmark older than that cannot be fetched and the row stays without one. The value is the share of applied migrations of the last 30 days that carry a
        bookmark, which is the metric's own definition; it reaches 1.0 only when the oldest row in the window is covered.

Usage:
  python3 scripts/bp26_repo.py --selftest     offline suite (no network, no secrets)
  CF_ACCOUNT_ID=<id> python3 scripts/bp26_producers.py --dry --only collect_kv_locking     live read-only run through the framework
"""
import datetime
import json
import os
import pathlib
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bp26_producers import Collector, Result  # noqa: E402

CF_ACCOUNT_ENV = ("CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
D1_LIMIT_BYTES = 10 * 1000 ** 3
BOOKMARK_BATCH = 300
BOOKMARK_THREADS = 6
BOOKMARK_BUDGET_S = 100
BOOKMARK_LEAD_S = 120
RETENTION_DAYS = 29  # Time Travel keeps 30 days; one day of margin so a fetch never lands on the edge
EXPIRY_WARN_DAYS = 14
SECRET_FILE_CAP = 4 * 1024 * 1024
SKIP_DIRS = {".git", "node_modules", ".claude", "__pycache__"}
SKIP_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tgz", ".woff", ".woff2", ".ttf", ".eot", ".mp3", ".mp4", ".wasm", ".bin", ".jsonl"}


def _audit():
    import fleet_best_practices_audit as A  # noqa: E402
    return A


def account_id():
    for k in CF_ACCOUNT_ENV:
        if os.environ.get(k):
            return os.environ[k]
    return ""


def live_workers(root):
    """[(name, wrangler config text, worker.js text)] for every live worker directory (the audit's definition)."""
    A = _audit()
    out = []
    for d in A.live_dirs(pathlib.Path(root)):
        wt, wj, wjs = d / "wrangler.toml", d / "wrangler.jsonc", d / "worker.js"
        cfg = wt.read_text(errors="replace") if wt.exists() else (wj.read_text(errors="replace") if wj.exists() else "")
        src = wjs.read_text(errors="replace") if wjs.exists() else ""
        out.append((d.name, cfg, src))
    return out


def bundle_names(root):
    """Live worker directories that are the esbuild bundle of their src/ (the audit's GENERATED-BUNDLE rule): the only ones a source map is for."""
    A = _audit()
    return [d.name for d in A.live_dirs(pathlib.Path(root)) if A.generated_bundle(d)]


# ---------------------------------------------------------------- source maps and observability
SM_TOML = re.compile(r"^[ \t]*upload_source_maps[ \t]*=[ \t]*true\b", re.M)
SM_JSON = re.compile(r"\"upload_source_maps\"\s*:\s*true")
# The deploy path carries a source map only if it uploads one: the multipart part type, the settings key or a source_map field. A trailing `//# sourceMappingURL=` comment of an
# esbuild bundle (qnfo-ops/worker.js ends with one) points at a file that is never uploaded, so it does not count.
DEPLOY_SM = re.compile(r"application/source-map|upload_source_maps|\bsource_maps?\b|\bsourcemaps?\b", re.I)


def has_source_maps(cfg):
    return bool(SM_TOML.search(_audit().strip_comments(cfg)) or SM_JSON.search(cfg))


def toml_observability_enabled(cfg):
    """True when the config's [observability] table sets enabled = true (comments stripped); false when the table is missing or sets it false."""
    text = _audit().strip_comments(cfg)
    m = re.search(r"^[ \t]*\[observability\][ \t]*$(.*?)(?=^[ \t]*\[|\Z)", text, re.M | re.S)
    if m:
        return bool(re.search(r"^[ \t]*enabled[ \t]*=[ \t]*true\b", m.group(1), re.M))
    return bool(re.search(r"\"observability\"\s*:\s*\{[^}]*\"enabled\"\s*:\s*true", cfg, re.S))


def deployed_observability(ctx, acct):
    """{script: enabled} for every script of the account from the Cloudflare API, or (None, reason). One settings call per script, bounded by the run budget."""
    lst = ctx.cf("/accounts/%s/workers/scripts" % acct)
    names = sorted(x.get("id") for x in (lst.get("result") or []) if x.get("id"))
    if not names:
        return None, "script list empty"
    seen, unread = {}, []
    for n in names:
        if ctx.left() < 20:
            unread.append(n)
            continue
        try:
            r = ctx.cf("/accounts/%s/workers/scripts/%s/script-settings" % (acct, n))
        except Exception as e:  # noqa: BLE001
            unread.append(n)
            continue
        ob = (r.get("result") or {}).get("observability")
        seen[n] = bool(isinstance(ob, dict) and ob.get("enabled"))
    if len(unread) > max(2, len(names) // 5):
        return None, "%d of %d script settings unreadable" % (len(unread), len(names))
    return (seen, unread), None


def collect_workers_config(ctx):
    workers = live_workers(ctx.root)
    out = []
    # ---- source maps
    try:
        eligible = set(bundle_names(ctx.root))
    except Exception:  # noqa: BLE001
        eligible = None
    # BP26-WORKERS-BP-LINT-1 (2026-10-28): a source map maps a bundle to its sources. A hand-written single-file worker.js is its own source, so a map would map the file to itself
    # and 34 of 35 workers could never "pass". The practice is judged on the generated bundles (qnfo-agents), which is where a deployed stack trace needs a map.
    if eligible:
        workers = [w for w in workers if w[0] in eligible]
    if workers:
        rows = [(n, 1 if has_source_maps(cfg) else 0, "upload_source_maps = true" if has_source_maps(cfg) else "upload_source_maps not set") for n, cfg, _ in workers]
        with_maps = sum(r[1] for r in rows)
        deploy_note = "qnfo-ops deploy path unread"
        try:
            ops = ctx.read("qnfo-ops/worker.js", limit=16 * 1024 * 1024)
            deploy_note = ("qnfo-ops/worker.js has no source-map upload code, so the canonical deploy path (/ops/deploy) cannot carry one: the lever is a deploy-path change (a code-task), not wrangler.toml lines"
                           if not DEPLOY_SM.search(ops) else "qnfo-ops/worker.js mentions source maps; check the deploy path before adding wrangler.toml lines")
        except Exception:  # noqa: BLE001
            pass
        try:
            bundles = bundle_names(ctx.root)
        except Exception:  # noqa: BLE001
            bundles = None
        bundle_note = ("; validity: only %d of %d are generated bundles (%s), the others are hand-written single files whose deployed worker.js is its own source, so a source map for them would map a file to itself and the flag changes nothing deployed" % (
            len(bundles), len(workers), ",".join(bundles) or "none")) if bundles is not None else ""
        out.append(Result("workers_with_source_maps", with_maps / float(len(workers)),
                          "%d of %d live worker directories set upload_source_maps = true (wrangler config scan); %s%s" % (with_maps, len(workers), deploy_note, bundle_note), rows))
    else:
        out.append(Result("workers_with_source_maps", None, "no live worker directory found in the checkout", []))
    # ---- observability
    acct = account_id()
    live = None
    reason = "no account id in the environment"
    if acct:
        try:
            live, reason = deployed_observability(ctx, acct)
        except Exception as e:  # noqa: BLE001
            live, reason = None, "API: " + str(e)[:100]
    if live:
        seen, unread = live
        rows = [(n, 1 if en else 0, "observability.enabled" if en else "observability disabled or absent") for n, en in sorted(seen.items())]
        on = sum(1 for en in seen.values() if en)
        out.append(Result("observability_enabled_share", on / float(len(seen)),
                          "%d of %d deployed Workers have observability.enabled (Cloudflare API script-settings, every script of the account)%s" % (
                              on, len(seen), "; %d unreadable and left out: %s" % (len(unread), ",".join(unread[:5])) if unread else ""), rows))
    elif workers:
        rows = [(n, 1 if toml_observability_enabled(cfg) else 0, "[observability] enabled = true" if toml_observability_enabled(cfg) else "no enabled [observability] in the config") for n, cfg, _ in workers]
        on = sum(r[1] for r in rows)
        out.append(Result("observability_enabled_share", on / float(len(workers)),
                          "%d of %d live worker directories declare observability enabled (wrangler config scan; the API was not used: %s)" % (on, len(workers), reason), rows))
    else:
        out.append(Result("observability_enabled_share", None, "neither the API (%s) nor a checkout could be read" % reason, []))
    return out


# ---------------------------------------------------------------- KV used as a lock or counter
KV_LOCK_KEY = re.compile(r"lock|lease|mutex|claim|counter|semaphore|incr|(?<![a-z])seq(?![a-z])", re.I)
KV_BINDING = re.compile(r"^[ \t]*binding[ \t]*=[ \t]*[\"']([A-Za-z0-9_]+)[\"']", re.M)
KV_RMW_INC = re.compile(r"\+\s*1\b|\+=\s*\d|\+\+")
STANDARDS_OK = "standards-ok:"


def kv_bindings(cfg):
    out = []
    for body in _audit().blocks(cfg, "kv_namespaces"):
        m = KV_BINDING.search(body)
        if m:
            out.append(m.group(1))
    return out


def kv_lock_hits(src, bindings):
    """[(line, pattern)] for one worker.js: KV puts under a lock-like key, and read-modify-write counters."""
    hits = []
    if not bindings or not src:
        return hits
    lines = src.split("\n")
    for b in bindings:
        put = re.compile(r"\b(?:env|this\.env)\." + re.escape(b) + r"\.put\(\s*([^,)\n]{1,160})")
        get = re.compile(r"(?:parseInt|Number)\(\s*await\s+(?:env|this\.env)\." + re.escape(b) + r"\.get\(")
        for i, ln in enumerate(lines, 1):
            s = ln.strip()
            if s.startswith("//") or s.startswith("*") or STANDARDS_OK in ln:
                continue
            m = put.search(ln)
            if m and KV_LOCK_KEY.search(m.group(1)):
                hits.append((i, "kv-lock-key"))
            g = get.search(ln)
            if g:
                window = "\n".join(lines[i - 1:i + 8])[:400]
                if KV_RMW_INC.search(window) and re.search(r"\.put\(", window):
                    hits.append((i, "kv-counter-rmw"))
    return sorted(set(hits))


def collect_kv_locking(ctx):
    workers = live_workers(ctx.root)
    if not workers:
        return [Result("kv_used_for_locking", None, "no live worker directory found in the checkout", [])]
    rows, scanned, hits = [], 0, 0
    for name, cfg, src in workers:
        b = kv_bindings(cfg)
        if not b:
            continue
        scanned += 1
        h = kv_lock_hits(src, b)
        hits += len(h)
        if h:
            rows += [("%s/worker.js:%d" % (name, ln), 0, pat) for ln, pat in h]
        else:
            rows.append((name, 1, "KV bindings %s: no lock or counter pattern" % ",".join(b)))
    return [Result("kv_used_for_locking", hits,
                   "%d lock or counter patterns over %d live workers that declare a KV namespace (static scan of worker.js: a put under a lock-like key, a read-modify-write counter); "
                   "a pattern scan finds the common shapes, not every possible one" % (hits, scanned), rows)]


# ---------------------------------------------------------------- secrets in the repository
# Each pattern is built so that this file's own source does not contain a match for it.
SECRET_PATTERNS = [
    ("pem-private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----(?:\\n|\r?\n)[A-Za-z0-9+/=\\ \r\n]{64,}")),
    ("aws-access-key-id", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("github-token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("secret-key-sk", re.compile(r"\b(?:sk_live_[A-Za-z0-9]{20,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,})\b")),
    ("cloudflare-token-assignment", re.compile(r"(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN|CF_TOKEN)[\"']?\s*[:=]\s*[\"']?[A-Za-z0-9_-]{40}(?![A-Za-z0-9_-])")),
    ("bluesky-app-password", re.compile(r"(?i)(?:password|app_?pass)[\"']?\s*[:=]\s*[\"']?[a-z0-9]{4}(?:-[a-z0-9]{4}){3}[\"']?")),
    ("credential-literal-assignment", re.compile(r"(?i)\b(?:TOKEN|API_KEY|ZENODO_TOKEN|ZENODO_SANDBOX_TOKEN)\b[\"']?[ \t]*[:=][ \t]*([\"'])[A-Za-z0-9_-]{24,}\1")),
]
PREFILTER = ("private key", "akia", "asia", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_", "xox", "sk_live_", "sk-", "token", "api_key", "password", "app_pass", "apppass")


def parse_allowlist(text, today=None):
    """[(path, pattern)] of unexpired entries. Line format: path | pattern | YYYY-MM-DD | reason. Blank and # lines are ignored; a malformed or expired entry is dropped."""
    today = today or datetime.date.today()
    out = []
    for ln in (text or "").split("\n"):
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        parts = [p.strip() for p in ln.split("|")]
        if len(parts) < 4 or not parts[3]:
            continue
        try:
            if datetime.date.fromisoformat(parts[2]) < today:
                continue
        except ValueError:
            continue
        out.append((parts[0], parts[1]))
    return out


def scan_text(text):
    """[(line, pattern name)] for one file's text. Never returns the matched text."""
    low = text.lower()
    if not any(tok in low for tok in PREFILTER):
        return []
    hits = []
    for name, rx in SECRET_PATTERNS:
        for m in rx.finditer(text):
            # SECRETS-BEACON-1 (agent_issues 1001435): the "token" in Cloudflare Web Analytics' data-cf-beacon attribute is the public site tag every visitor's browser
            # receives (read 2026-11-05: 5 of the 11 hits were that attribute in archived HTML). Only the generic assignment pattern is skipped, and only on a line that
            # carries the attribute; a GitHub, AWS, PEM, sk- or Cloudflare token on the same line is still reported.
            if name == "credential-literal-assignment":
                ls = text.rfind("\n", 0, m.start()) + 1
                le = text.find("\n", m.end())
                if "data-cf-beacon" in text[ls:(len(text) if le < 0 else le)]:
                    continue
            hits.append((text.count("\n", 0, m.start()) + 1, name))
    return sorted(set(hits))


def tracked_files(root, git):
    out = git("ls-files", "-z")
    if out:
        return [p for p in out.split("\0") if p]
    res = []
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in SKIP_DIRS]
        for f in fn:
            res.append(os.path.relpath(os.path.join(dp, f), root).replace(os.sep, "/"))
    return res


def collect_secrets_in_repo(ctx):
    root = ctx.root
    try:
        allow = parse_allowlist(open(os.path.join(root, "scripts", "secret-scan-allowlist.txt"), encoding="utf-8").read())
    except OSError:
        allow = []
    files = tracked_files(root, ctx.git)
    if not files:
        return [Result("secrets_in_repo", None, "no tracked files readable in the checkout", [])]
    rows, scanned, hits = [], 0, 0
    for rel in files:
        if ctx.left() < 15:
            return [Result("secrets_in_repo", None, "run budget exhausted after %d files; not a full scan" % scanned, [])]
        p = os.path.join(root, rel)
        if os.path.splitext(rel)[1].lower() in SKIP_EXT or not os.path.isfile(p):
            continue
        try:
            if os.path.getsize(p) > SECRET_FILE_CAP:
                continue
            with open(p, "rb") as f:
                raw = f.read()
        except OSError:
            continue
        if b"\0" in raw[:8192]:
            continue
        scanned += 1
        for ln, name in scan_text(raw.decode("utf-8", "replace")):
            # Apply allowlist entries which may be exact matches or glob patterns.
            # An entry is a tuple (path_pattern, pattern_name).  If the path pattern
            # contains a wildcard, treat it as a glob; otherwise require an exact match.
            # This makes the allowlist more flexible without changing existing
            # exact‑match behaviour used in the self‑test.
            allowed = False
            for path_pat, pat_name in allow:
                if pat_name != name:
                    continue
                if "*" in path_pat:
                    import fnmatch
                    if fnmatch.fnmatch(rel, path_pat):
                        allowed = True
                        break
                else:
                    if rel == path_pat:
                        allowed = True
                        break
            if allowed:
                continue
            hits += 1
            rows.append(("%s:%d" % (rel, ln), 0, name))
    return [Result("secrets_in_repo", hits,
                   "%d unallowlisted secret patterns in %d tracked text files (pattern scan: PEM key with body, AWS key id, GitHub/Slack tokens, sk- keys, Cloudflare-style token "
                   "assignment, Bluesky app password, quoted TOKEN/API_KEY assignments (heuristic); no entropy check; %d allowlist entries in force); a hit is reported as file:line and pattern name only" % (hits, scanned, len(allow)), rows[:60])]


# ---------------------------------------------------------------- credential expiry
def parse_epoch(s):
    """Epoch seconds of 'YYYY-MM-DDTHH:MM:SS...' or a bare 'YYYY-MM-DD' (UTC), else None."""
    s = str(s or "")
    for fmt, n in (("%Y-%m-%dT%H:%M:%S", 19), ("%Y-%m-%d", 10)):
        try:
            return datetime.datetime.strptime(s[:n], fmt).replace(tzinfo=datetime.timezone.utc).timestamp()
        except ValueError:
            continue
    return None


def collect_credential_expiry(ctx):
    try:
        reg = ctx.d1("SELECT credential, holder_worker, expiry_mechanism, expires_at, renewal_issue_id FROM bp26_credential_registry ORDER BY credential")
    except Exception as e:  # noqa: BLE001
        return [Result("secret_expiry_warnings_open", None, "bp26_credential_registry unreadable (migration 2026-10-26-bp26-repo.sql not applied?): " + str(e)[:100], [])]
    if not reg:
        return [Result("secret_expiry_warnings_open", None, "bp26_credential_registry is empty or unreadable", [])]
    # The earlier credential_registry (qnfo-infra /cred/status) holds credentials whose expiry IS dated; its rows are read, never written.
    try:
        reg = list(reg) + ctx.d1("SELECT slug AS credential, owner AS holder_worker, 'dated' AS expiry_mechanism, expires_on AS expires_at, NULL AS renewal_issue_id FROM credential_registry "
                                 "WHERE expires_on IS NOT NULL AND trim(expires_on) <> '' ORDER BY slug")
    except Exception:  # noqa: BLE001
        pass
    cf_mins = None
    try:
        r = ctx.d1("SELECT last_value, last_refreshed FROM metric_registry WHERE metric = 'cloudflare_token_expires_in_min'")
        if r and str(r[0].get("last_value") or "").lstrip("-").isdigit():
            cf_mins = int(r[0]["last_value"])
    except Exception:  # noqa: BLE001
        cf_mins = None
    now = ctx.now
    rows, warn, known, unknown = [], 0, [], []
    for c in reg:
        name, mech = c["credential"], str(c.get("expiry_mechanism") or "")
        days = None
        if mech == "cf-token-verify" and cf_mins is not None:
            days = None if cf_mins >= 999999 else cf_mins / 1440.0
            if cf_mins >= 999999:
                rows.append((name, 1, "Cloudflare token verify: no expiry date set on the token"))
                known.append(name)
                continue
        elif c.get("expires_at"):
            t = parse_epoch(c["expires_at"])
            days = None if t is None else (t - now) / 86400.0
        if days is None:
            unknown.append(name)
            rows.append((name, None, "no-expiry-mechanism" if mech in ("", "none") or mech.startswith("no-expiry") else "expiry-unknown (%s)" % mech[:60]))
            continue
        known.append(name)
        if days <= EXPIRY_WARN_DAYS:
            open_issue = False
            iid = c.get("renewal_issue_id")
            if iid:
                try:
                    open_issue = bool(ctx.d1("SELECT 1 FROM agent_issues WHERE id = ?1 AND status = 'open'", [int(iid)]))
                except Exception:  # noqa: BLE001
                    open_issue = False
            if not open_issue:
                warn += 1
            rows.append((name, 0 if not open_issue else 1, "expires in %.1f days; renewal issue %s" % (days, "open" if open_issue else "missing")))
        else:
            rows.append((name, 1, "expires in %.0f days" % days))
    return [Result("secret_expiry_warnings_open", warn,
                   "%d credentials with a known expiry (%s) were checked against a %d-day horizon; %d credentials have NO expiry mechanism and are not monitored (%s): that is a gap, not a pass" % (
                       len(known), ",".join(known) or "none", EXPIRY_WARN_DAYS, len(unknown), ",".join(unknown) or "none"), rows)]


# ---------------------------------------------------------------- D1 platform: size, restore drill, migration bookmarks
def d1_list(ctx, acct):
    r = ctx.cf("/accounts/%s/d1/database?per_page=100" % acct)
    return [(x.get("name"), x.get("uuid") or x.get("id"), int(x.get("file_size") or 0)) for x in (r.get("result") or []) if x.get("name")]


def collect_d1_size_and_drill(ctx):
    out = []
    acct = account_id()
    if acct:
        try:
            dbs = d1_list(ctx, acct)
        except Exception as e:  # noqa: BLE001
            dbs, err = [], str(e)[:100]
        else:
            err = ""
        if dbs:
            big = max(dbs, key=lambda d: d[2])
            rows = [(n, 1 if sz / float(D1_LIMIT_BYTES) <= 0.7 else 0, "%.1f MB = %.4f of 10 GB" % (sz / 1e6, sz / float(D1_LIMIT_BYTES))) for n, _, sz in sorted(dbs, key=lambda d: -d[2])]
            out.append(Result("d1_db_size_pct", big[2] / float(D1_LIMIT_BYTES),
                              "largest of %d D1 databases is %s at %.1f MB, over a 10 x 10^9 byte limit (Cloudflare API database list)" % (len(dbs), big[0], big[2] / 1e6), rows))
        else:
            out.append(Result("d1_db_size_pct", None, "D1 list unreadable: %s" % (err or "empty"), []))
    else:
        out.append(Result("d1_db_size_pct", None, "no account id in the environment", []))
    try:
        r = ctx.d1("SELECT MAX(ts) AS ts, COUNT(*) AS n, SUM(CASE WHEN outcome = 'pass' THEN 1 ELSE 0 END) AS passes FROM d1_restore_drills")
        last_pass = ctx.d1("SELECT MAX(ts) AS ts FROM d1_restore_drills WHERE outcome = 'pass'")
        n = int((r[0].get("n") if r else 0) or 0)
        lp = last_pass[0].get("ts") if last_pass else None
        if lp:
            t = datetime.datetime.strptime(str(lp)[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc).timestamp()
            days = int((ctx.now - t) // 86400)
            out.append(Result("d1_restore_drill_age_days", days, "newest passing restore drill %s (%d drills recorded)" % (str(lp)[:19], n), [("d1_restore_drills", 1, "last pass %s" % str(lp)[:19])]))
        else:
            out.append(Result("d1_restore_drill_age_days", None,
                              "no restore drill has passed (%d recorded): the age is unknown, not zero; the drill itself is not built (a code-task: export at a bookmark, import into a scratch database, compare counts, delete only that scratch database)" % n,
                              [("d1_restore_drills", None, "no passing drill")]))
    except Exception as e:  # noqa: BLE001
        out.append(Result("d1_restore_drill_age_days", None, "d1_restore_drills unreadable: " + str(e)[:100], []))
    return out


def iso_minus(iso, seconds):
    t = datetime.datetime.strptime(str(iso)[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc).timestamp() - seconds
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _fetch_bookmark(ctx, acct, dbid, ts):
    """(bookmark, error token) for the Time Travel restore point of one database at one timestamp."""
    try:
        r = ctx.cf("/accounts/%s/d1/database/%s/time_travel/bookmark?timestamp=%s" % (acct, dbid, ts))
        return ((r.get("result") or {}).get("bookmark")) or "", None
    except Exception as e:  # noqa: BLE001
        return "", str(e)[:60]


def collect_migration_bookmarks(ctx):
    acct = account_id()
    cutoff = datetime.datetime.fromtimestamp(ctx.now - RETENTION_DAYS * 86400, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        todo = ctx.d1("SELECT id, db, applied_at FROM migration_runs WHERE status = 'ok' AND (bookmark IS NULL OR bookmark = '') AND applied_at >= ?1 ORDER BY applied_at DESC LIMIT ?2",
                      [cutoff, BOOKMARK_BATCH])
    except Exception as e:  # noqa: BLE001
        return [Result("pre_migration_bookmark_recorded", None, "migration_runs.bookmark is not readable yet (migration 2026-10-26-bp26-repo.sql not applied?): " + str(e)[:100], [])]
    recorded, would, failed, ids = 0, 0, {}, {}
    if todo and acct:
        try:
            ids = {n: i for n, i, _ in d1_list(ctx, acct)}
        except Exception as e:  # noqa: BLE001
            failed["d1-list"] = str(e)[:80]
        jobs = []
        for row in todo:
            dbid = ids.get(row.get("db") or "qnfo-audit")
            if not dbid:
                failed["no-db:" + str(row.get("db"))] = failed.get("no-db:" + str(row.get("db")), 0) + 1
                continue
            jobs.append((row, dbid, iso_minus(row["applied_at"], BOOKMARK_LEAD_S)))
        # Time Travel answers a past timestamp in about 1.6 s, so the reads run in parallel, a chunk at a time, inside a wall-clock budget that leaves the run's other collectors their time.
        t_end = time.time() + min(BOOKMARK_BUDGET_S, max(0.0, ctx.left() - 25))
        stop = False
        step = max(1, BOOKMARK_THREADS * 3)
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=max(1, BOOKMARK_THREADS)) as ex:
            for i in range(0, len(jobs), step):
                if stop or time.time() > t_end:
                    break
                chunk = jobs[i:i + step]
                got = list(ex.map(lambda j: _fetch_bookmark(ctx, acct, j[1], j[2]), chunk))
                for (row, _dbid, _ts), (bm, err) in zip(chunk, got):
                    if err:
                        failed[err] = failed.get(err, 0) + 1
                        continue
                    if not bm:
                        continue
                    if ctx.dry:  # a dry run reads Time Travel but writes nothing to the ledger
                        would += 1
                        continue
                    try:
                        ctx.d1("UPDATE migration_runs SET bookmark = ?1, bookmark_source = 'time-travel-at(applied_at-120s)' WHERE id = ?2 AND (bookmark IS NULL OR bookmark = '')", [bm, row["id"]])
                        recorded += 1
                    except Exception as e:  # noqa: BLE001
                        failed["write: " + str(e)[:60]] = 1
                        stop = True
                        break
    window = datetime.datetime.fromtimestamp(ctx.now - 30 * 86400, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        r = ctx.d1("SELECT COUNT(*) AS n, SUM(CASE WHEN bookmark IS NOT NULL AND bookmark <> '' THEN 1 ELSE 0 END) AS b FROM migration_runs WHERE status = 'ok' AND applied_at >= ?1", [window])
    except Exception as e:  # noqa: BLE001
        return [Result("pre_migration_bookmark_recorded", None, "migration_runs unreadable: " + str(e)[:100], [])]
    n, b = int(r[0].get("n") or 0), int(r[0].get("b") or 0)
    if n == 0:
        return [Result("pre_migration_bookmark_recorded", None, "no migration was applied in the last 30 days", [])]
    return [Result("pre_migration_bookmark_recorded", b / float(n),
                   "%d of %d migrations applied in the last 30 days carry a Time Travel bookmark (this run recorded %d of the newest %d without one, taken at applied_at minus %d s; apply-time capture in "
                   "scripts/apply_migrations.py is a pending code-task)%s%s" % (b, n, recorded, len(todo), BOOKMARK_LEAD_S, "; failures: " + json.dumps(failed)[:160] if failed else "",
                                                                              "; dry run: %d bookmarks fetched, none stored" % would if ctx.dry else ""),
                   [("migration_runs", 1 if b == n else 0, "%d with bookmark, %d without" % (b, n - b))])]


COLLECTORS = [
    Collector("collect_workers_config", collect_workers_config, ["workers_with_source_maps", "observability_enabled_share"], 55),
    Collector("collect_kv_locking", collect_kv_locking, ["kv_used_for_locking"], 55),
    Collector("collect_secrets_in_repo", collect_secrets_in_repo, ["secrets_in_repo"], 360),
    Collector("collect_credential_expiry", collect_credential_expiry, ["secret_expiry_warnings_open"], 55),
    Collector("collect_d1_size_and_drill", collect_d1_size_and_drill, ["d1_db_size_pct", "d1_restore_drill_age_days"], 55),
    Collector("collect_migration_bookmarks", collect_migration_bookmarks, ["pre_migration_bookmark_recorded"], 55),
]


# ---------------------------------------------------------------- selftest
def selftest():
    global BOOKMARK_THREADS
    import shutil
    import sqlite3
    import tempfile
    import bp26_producers as P
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
            print("FAIL " + m)
    root = tempfile.mkdtemp()
    try:
        def write(rel, text):
            p = os.path.join(root, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                f.write(text)
        # three live workers, one retired, one with KV lock patterns
        write("w-maps/wrangler.toml", 'name = "w-maps"\nupload_source_maps = true\n[observability]\nenabled = true\n')
        write("w-maps/worker.js", "export default { fetch() { return new Response('ok'); } };\n")
        write("w-kv/wrangler.toml", 'name = "w-kv"\n# upload_source_maps = true\n[observability]\nenabled = false\n[[kv_namespaces]]\nbinding = "LOCKS_KV"\nid = "x"\n[[kv_namespaces]]\nbinding = "CACHE"\nid = "y"\n')
        write("w-kv/worker.js", "\n".join([
            "async function a(env, id) {",
            "  await env.LOCKS_KV.put('lock:' + id, '1');",            # lock key  -> hit (line 2)
            "  await env.CACHE.put('cache:' + id, '1');",              # cache key on another binding -> no hit
            "  await env.LOCKS_KV.put('page:' + id, '1');",            # not a lock key -> no hit
            "  // await env.LOCKS_KV.put('lock:x', '1');",             # comment -> no hit
            "  await env.LOCKS_KV.put('lease:' + id, '1'); // standards-ok: reviewed",  # marked -> no hit
            "  const n = parseInt(await env.CACHE.get('hits')) + 1;",  # counter rmw -> hit (line 7)
            "  await env.CACHE.put('hits', String(n));",
            "  const m = parseInt(await env.CACHE.get('ttl'));",      # read only -> no hit
            "  return m;",
            "}",
            ""]))
        write("w-plain/wrangler.toml", 'name = "w-plain"\n[observability]\nenabled = true\n')
        write("w-plain/worker.js", "export default {};\n")
        write("w-old/wrangler.toml", 'name = "w-old"\n')
        write("w-old/RETIRED", "retired\n")
        write("w-old/worker.js", "env.LOCKS_KV.put('lock:a', 1)\n")
        write("qnfo-ops/wrangler.toml", 'name = "qnfo-ops"\n[observability]\nenabled = true\n')
        write("qnfo-ops/worker.js", "// deploy path without any map upload\nexport default {};\n//# sourceMappingURL=worker.js.map\n")
        ok(not DEPLOY_SM.search("export default {};\n//# sourceMappingURL=worker.js.map") and DEPLOY_SM.search("meta.upload_source_maps = true") and DEPLOY_SM.search("type: 'application/source-map'"),
           "a trailing sourceMappingURL comment is not source-map upload code; a source_maps field or a source-map part is")
        # ---- source maps and observability (config fallback: no account id)
        os.environ.pop("CF_ACCOUNT_ID", None)
        os.environ.pop("CLOUDFLARE_ACCOUNT_ID", None)
        ctx = P.Ctx(root=root, now=time.time())
        res = {r.metric: r for r in collect_workers_config(ctx)}
        ok(abs(res["workers_with_source_maps"].value - 0.25) < 1e-9, "1 of 4 live workers sets upload_source_maps (the commented line and the retired directory do not count): %r" % res["workers_with_source_maps"].value)
        ok("no source-map upload code" in res["workers_with_source_maps"].note, "the note says the deploy path has no source-map code")
        ok("only 0 of 4 are generated bundles" in res["workers_with_source_maps"].note, "the note says how few workers a source map is for: %r" % res["workers_with_source_maps"].note[-200:])
        ok(abs(res["observability_enabled_share"].value - 0.75) < 1e-9 and "config scan" in res["observability_enabled_share"].note, "config fallback: 3 of 4 enable observability: %r" % res["observability_enabled_share"].value)
        # ---- observability from the API
        os.environ["CF_ACCOUNT_ID"] = "acct"
        calls = []

        def cf(path):
            calls.append(path)
            if path.endswith("/workers/scripts"):
                return {"result": [{"id": "a"}, {"id": "b"}, {"id": "c"}, {"id": "voice-stt"}]}
            if "/script-settings" in path:
                n = path.split("/")[-2]
                return {"result": {"observability": {"enabled": n != "c"}} if n != "voice-stt" else {"observability": None}}
            raise RuntimeError("unexpected " + path)
        res = {r.metric: r for r in collect_workers_config(P.Ctx(cf=cf, root=root, now=time.time()))}
        ok(abs(res["observability_enabled_share"].value - 0.5) < 1e-9 and "Cloudflare API" in res["observability_enabled_share"].note, "API path: 2 of 4 deployed scripts enabled: %r" % res["observability_enabled_share"].value)
        ok(any(r[0] == "c" and r[1] == 0 for r in res["observability_enabled_share"].rows), "the disabled script is named in the evidence rows")

        def cf_down(path):
            raise RuntimeError("HTTP 403")
        res = {r.metric: r for r in collect_workers_config(P.Ctx(cf=cf_down, root=root, now=time.time()))}
        ok("config scan" in res["observability_enabled_share"].note and abs(res["observability_enabled_share"].value - 0.75) < 1e-9, "an API outage falls back to the config scan and says so")
        # ---- KV locking
        r = collect_kv_locking(P.Ctx(root=root, now=time.time()))[0]
        pats = sorted((x[0].split(":")[-1], x[2]) for x in r.rows if x[1] == 0)
        ok(r.value == 2 and pats == [("2", "kv-lock-key"), ("7", "kv-counter-rmw")], "exactly the lock-key put (line 2) and the counter read-modify-write (line 7) are hits: %r %r" % (r.value, pats))
        ok(kv_lock_hits("await env.OTHER.put('lock:a', 1)", ["LOCKS_KV"]) == [], "a put on a binding the worker does not declare as KV is not a hit")
        ok(kv_lock_hits("const v = await env.CACHE.get('k'); await env.CACHE.put('k', v)", ["CACHE"]) == [], "a plain cache read then write is not a counter")
        ok(kv_bindings('[[kv_namespaces]]\nbinding = "A"\nid = "1"\n[[d1_databases]]\nbinding = "DB"\n') == ["A"], "only [[kv_namespaces]] bindings are KV")
        # ---- secrets
        fake = {
            "pem": "-----BEGIN " + "RSA PRIVATE KEY-----\n" + "MIIEowIBAAKCAQEA" * 8 + "\n-----END " + "RSA PRIVATE KEY-----\n",
            "aws": "key = '" + "AK" + "IA" + "ABCDEFGHIJKLMNOP'",
            "gh": "t = '" + "gh" + "p_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8" + "'",
            "cf": "CF_API_TOKEN = '" + "a" * 40 + "'",
            "bsky": "app_password: '" + "abcd-efgh-ijkl-mnop" + "'",
        }
        for k, v in fake.items():
            write("src/%s.txt" % k, v + "\n")
        write("src/clean.js", "const a = process.env.CF_API_TOKEN; // CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}\nconst k = 'sk-' + id;\nconst doc = '-----BEGIN ' + 'PRIVATE KEY-----';\nconst h = 'ghp_ prefix only';\n")
        write("src/big.bin", "\0" + "AKIA" + "ABCDEFGHIJKLMNOP")
        write("scripts/secret-scan-allowlist.txt", "# path | pattern | expiry | reason\nsrc/aws.txt | aws-access-key-id | 2099-01-01 | test fixture\nsrc/gh.txt | github-token | 2000-01-01 | expired entry\nbroken line\n")
        r = collect_secrets_in_repo(P.Ctx(root=root, now=time.time(), deadline=time.time() + 100, ))[0]
        names = sorted(x[2] for x in r.rows)
        ok(names == ["bluesky-app-password", "cloudflare-token-assignment", "github-token", "pem-private-key"], "four of the five fixtures are reported (the AWS one is allowlisted, the expired entry is ignored): %r" % names)
        ok(r.value == 4 and all(":" in x[0] and "AKIA" not in str(x) and "a" * 40 not in str(x) for x in r.rows), "the value counts them and no row carries the secret text")
        ok(scan_text("const re = /AKIA[0-9A-Z]{16}/; const x = 'sk-abc';") == [], "a pattern written as a regex or a short sk- string is not a secret")
        for name, length in [("TOKEN", 60), ("TOKEN", 59), ("API_KEY", 43), ("ZENODO_TOKEN", 24), ("ZENODO_SANDBOX_TOKEN", 24)]:
            literal = "a1" * (length // 2) + "a" * (length % 2)
            text = '# archived example\n' + name + ' = "' + literal + '"\n'
            ok(scan_text(text) == [(2, "credential-literal-assignment")], "audit-format quoted assignment detected by name and line only: %s/%d" % (name, length))
        literal = "a1_-" * 6
        ok(scan_text('{"api_key": "' + literal + '"}') == [(1, "credential-literal-assignment")], "JSON and token punctuation are covered")
        ok(scan_text("token = '" + literal + "'") == [(1, "credential-literal-assignment")], "single quotes and lowercase are covered")
        ok(scan_text('TOKEN = "' + literal + '" + suffix') == [(1, "credential-literal-assignment")], "a long literal remains exposed when concatenated")
        for text in [
            'TOKEN = "' + "a" * 23 + '"',
            'TOKEN = "<REDACTED>"',
            'TOKEN = os.environ["ZENODO_TOKEN"]',
            'API_KEY = process.env.API_KEY',
            'TOKEN = "' + "a" * 12 + '" * 5',
            'NOT_TOKEN = "' + "a" * 24 + '"',
            'TOKEN = "' + "a" * 24 + "'",
        ]:
            ok(scan_text(text) == [], "only a complete long quoted credential literal is reported")
        # SECRETS-BEACON-1: the Cloudflare Web Analytics site tag is public by design; the same JSON elsewhere, and any specific token format on the same line, are still reported
        beacon = '<script src="https://static.example.com/beacon.min.js" data-cf-beacon=\'{"version":"2024.11.0","token":"' + "a1b2" * 8 + '","r":1}\' crossorigin></script>'
        ok(scan_text(beacon) == [], "a data-cf-beacon token is a public site tag, not a secret")
        ok(scan_text('{"version":"2024.11.0","token":"' + "a1b2" * 8 + '","r":1}') == [(1, "credential-literal-assignment")], "the same JSON without the attribute is reported")
        ok(scan_text(beacon + "\nTOKEN = \"" + "a1" * 15 + "\"") == [(2, "credential-literal-assignment")], "the next line is judged on its own")
        ok(scan_text(beacon + " ghp" + "_" + "a1B2" * 9) == [(1, "github-token")], "a specific token format on a beacon line is still reported")
        write("src/zenodo.py", 'TOKEN = "' + "a1" * 30 + '"\n')
        r = collect_secrets_in_repo(P.Ctx(root=root, now=time.time(), deadline=time.time() + 100, ))[0]
        ok(r.value == 5 and ("src/zenodo.py:1", 0, "credential-literal-assignment") in r.rows and "a1" * 30 not in str(r), "collector counts the generic literal without exposing its value")
        ok(parse_allowlist("a | b | 2099-01-01 | why\nc | d | 2000-01-01 | old\ne | f | notadate | x\n") == [("a", "b")], "allowlist: unexpired well-formed entries only")
        # ---- credential expiry, D1 size, drills, bookmarks on an in-memory ledger
        c = sqlite3.connect(":memory:")
        c.executescript("""
CREATE TABLE bp26_credential_registry (credential TEXT PRIMARY KEY, holder_worker TEXT, expiry_mechanism TEXT, expires_at TEXT, renewal_issue_id INTEGER);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
CREATE TABLE d1_restore_drills (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, source_db TEXT, scratch_db TEXT, bookmark TEXT, rows_checked INTEGER, outcome TEXT, evidence TEXT);
CREATE TABLE migration_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT, db TEXT, status TEXT, applied_at TEXT, bookmark TEXT, bookmark_source TEXT);
INSERT INTO metric_registry VALUES ('cloudflare_token_expires_in_min', '999999', '2026-10-26T00:00:00Z');
INSERT INTO bp26_credential_registry VALUES ('CLOUDFLARE_API_TOKEN', 'ci', 'cf-token-verify', NULL, NULL);
INSERT INTO bp26_credential_registry VALUES ('BSKY_APP_PASS', 'qnfo-social', 'no-expiry-mechanism', NULL, NULL);
INSERT INTO bp26_credential_registry VALUES ('SOON_NO_ISSUE', 'w', 'dated', strftime('%Y-%m-%dT%H:%M:%SZ','now','+5 days'), NULL);
INSERT INTO bp26_credential_registry VALUES ('SOON_WITH_ISSUE', 'w', 'dated', strftime('%Y-%m-%dT%H:%M:%SZ','now','+3 days'), 7);
INSERT INTO bp26_credential_registry VALUES ('LATER', 'w', 'dated', strftime('%Y-%m-%dT%H:%M:%SZ','now','+200 days'), NULL);
INSERT INTO agent_issues VALUES (7, 'open');
CREATE TABLE credential_registry (slug TEXT PRIMARY KEY, title TEXT, kind TEXT, expires_on TEXT, rotate_before TEXT, owner TEXT, source TEXT, updated_at TEXT);
INSERT INTO credential_registry VALUES ('workers-ai-token', 'Workers AI token', 'cloudflare-api-token', '2099-10-25', '2099-09-25', 'self', 'r2', 'now');
INSERT INTO credential_registry VALUES ('no-date', 'x', 'k', NULL, NULL, 'self', 'r2', 'now');
""")

        def d1(sql, params=None):
            cur = c.execute(sql, params or [])
            cols = [d[0] for d in cur.description] if cur.description else []
            return [dict(zip(cols, r)) for r in cur.fetchall()]
        ctx = P.Ctx(d1=d1, cf=cf, root=root, now=time.time())
        r = collect_credential_expiry(ctx)[0]
        ok(r.value == 1, "one credential expires inside 14 days with no open renewal issue: %r" % r.value)
        ok(any(x[0] == "BSKY_APP_PASS" and x[1] is None and x[2] == "no-expiry-mechanism" for x in r.rows) and "BSKY_APP_PASS" in r.note and "gap, not a pass" in r.note,
           "a credential with no expiry mechanism is listed as such and named in the note")
        ok(any(x[0] == "workers-ai-token" and x[1] == 1 for x in r.rows) and "workers-ai-token" in r.note and not any(x[0] == "no-date" for x in r.rows),
           "a dated row of the earlier credential_registry is read and covered; an undated one is not part of the figure")
        ok(parse_epoch("2027-10-25") is not None and parse_epoch("2027-10-25T10:00:00Z") is not None and parse_epoch("soon") is None, "parse_epoch reads a date or a timestamp")
        c.execute("DELETE FROM bp26_credential_registry")
        ok(collect_credential_expiry(ctx)[0].value is None, "an empty registry is unknown, not zero")
        # D1 size and drill
        def cf2(path):
            if "/d1/database?" in path:
                return {"result": [{"name": "big", "uuid": "u1", "file_size": 981000000}, {"name": "small", "uuid": "u2", "file_size": 1000000}]}
            raise RuntimeError("unexpected " + path)
        res = {r.metric: r for r in collect_d1_size_and_drill(P.Ctx(d1=d1, cf=cf2, root=root, now=time.time()))}
        ok(abs(res["d1_db_size_pct"].value - 0.0981) < 1e-9 and "big" in res["d1_db_size_pct"].note, "largest database over 10 GB: %r" % res["d1_db_size_pct"].value)
        ok(res["d1_restore_drill_age_days"].value is None, "no passing drill: the age is unknown, not zero")
        c.execute("INSERT INTO d1_restore_drills (ts, outcome) VALUES (strftime('%Y-%m-%dT%H:%M:%SZ','now','-9 days'), 'pass')")
        c.execute("INSERT INTO d1_restore_drills (ts, outcome) VALUES (strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 days'), 'fail')")
        res = {r.metric: r for r in collect_d1_size_and_drill(P.Ctx(d1=d1, cf=cf2, root=root, now=time.time()))}
        ok(res["d1_restore_drill_age_days"].value in (8, 9), "age counts from the newest PASS, not the newest drill: %r" % res["d1_restore_drill_age_days"].value)
        # bookmarks (one thread: the fake API below fails its third call, which must be deterministic)
        BOOKMARK_THREADS = 1
        for i in range(6):
            c.execute("INSERT INTO migration_runs (file, db, status, applied_at) VALUES (?, 'qnfo-audit', 'ok', strftime('%Y-%m-%dT%H:%M:%SZ','now', ?))", ["m%d.sql" % i, "-%d hours" % (i + 1)])
        c.execute("INSERT INTO migration_runs (file, db, status, applied_at) VALUES ('old.sql', 'qnfo-audit', 'ok', strftime('%Y-%m-%dT%H:%M:%SZ','now','-35 days'))")
        c.execute("INSERT INTO migration_runs (file, db, status, applied_at) VALUES ('bad.sql', 'qnfo-audit', 'error', strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 hours'))")
        dry_calls = []

        def cf_dry(path):
            if "/d1/database?" in path:
                return {"result": [{"name": "qnfo-audit", "uuid": "uuid-audit", "file_size": 1}]}
            dry_calls.append(path)
            return {"result": {"bookmark": "bm-dry"}}
        rd = collect_migration_bookmarks(P.Ctx(d1=d1, cf=cf_dry, root=root, now=time.time(), dry=True))[0]
        ok(d1("SELECT COUNT(*) AS n FROM migration_runs WHERE bookmark IS NOT NULL")[0]["n"] == 0 and len(dry_calls) == 6 and "dry run: 6 bookmarks fetched, none stored" in rd.note,
           "a dry run fetches the bookmarks and stores none: %r %r" % (len(dry_calls), rd.note[-80:]))
        asked = []

        def cf3(path):
            if "/d1/database?" in path:
                return {"result": [{"name": "qnfo-audit", "uuid": "uuid-audit", "file_size": 1}]}
            if "time_travel/bookmark?timestamp=" in path:
                asked.append(path)
                if len(asked) == 3:
                    raise RuntimeError("HTTP 400: Provided timestamp is too old")
                return {"result": {"bookmark": "bm-%d" % len(asked)}}
            raise RuntimeError("unexpected " + path)
        r = collect_migration_bookmarks(P.Ctx(d1=d1, cf=cf3, root=root, now=time.time()))[0]
        have = d1("SELECT COUNT(*) AS n FROM migration_runs WHERE bookmark IS NOT NULL")[0]["n"]
        ok(have == 5 and abs(r.value - 5 / 6.0) < 1e-4, "five of six in-window migrations carry a bookmark after the run (one fetch failed; the 35-day row and the error row are outside the figure): %r %r" % (have, r.value))
        ok(all("uuid-audit/d1/database" not in p and "uuid-audit/time_travel/bookmark?timestamp=20" in p for p in asked), "the bookmark is asked for the migration's own database at a past timestamp")
        ok(d1("SELECT bookmark_source FROM migration_runs WHERE bookmark IS NOT NULL LIMIT 1")[0]["bookmark_source"] == "time-travel-at(applied_at-120s)", "the method is recorded on the row")
        r2 = collect_migration_bookmarks(P.Ctx(d1=d1, cf=cf3, root=root, now=time.time()))[0]
        ok(abs(r2.value - 1.0) < 1e-9, "the next run records the one that failed and the figure reaches 1.0: %r" % r2.value)
        BOOKMARK_THREADS = 4  # the parallel path: only the API reads run in threads, the ledger writes stay on the calling thread
        for i in range(7):
            c.execute("INSERT INTO migration_runs (file, db, status, applied_at) VALUES (?, 'qnfo-audit', 'ok', strftime('%Y-%m-%dT%H:%M:%SZ','now', ?))", ["p%d.sql" % i, "-%d hours" % (i + 10)])

        def cf4(path):
            if "/d1/database?" in path:
                return {"result": [{"name": "qnfo-audit", "uuid": "uuid-audit", "file_size": 1}]}
            return {"result": {"bookmark": "bm-par-" + path.rsplit("=", 1)[1]}}
        r3 = collect_migration_bookmarks(P.Ctx(d1=d1, cf=cf4, root=root, now=time.time()))[0]
        ok(abs(r3.value - 1.0) < 1e-9 and d1("SELECT COUNT(*) AS n FROM migration_runs WHERE bookmark LIKE 'bm-par-%'")[0]["n"] == 7, "the parallel path records all seven: %r" % r3.value)
        ok(iso_minus("2026-10-26T12:00:30Z", 120) == "2026-10-26T11:58:30Z", "iso_minus")
        # framework integration: collectors discovered with the right metrics
        cols = {x.name: x for x in COLLECTORS}
        owned = sorted(m for x in cols.values() for m in x.metrics)
        ok(owned == sorted(["workers_with_source_maps", "observability_enabled_share", "kv_used_for_locking", "secrets_in_repo", "secret_expiry_warnings_open", "d1_db_size_pct",
                            "d1_restore_drill_age_days", "pre_migration_bookmark_recorded"]), "the eight metrics of this package are covered exactly once: %r" % owned)
    finally:
        shutil.rmtree(root, ignore_errors=True)
    print("bp26_repo selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print("usage: bp26_repo.py --selftest (the collectors run through scripts/bp26_producers.py)")
