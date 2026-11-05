#!/usr/bin/env python3
"""kaizen_gates.py -- KAIZEN-GATES-1 (charter pillar: autonomy; RM-KAIZEN-GATE-CANDIDATES-1, qnfo-audit.roadmap_implementation id 62).

WHY   Twelve lessons of the 2026-09-26/27 holistic sessions were written down as kaizen candidates (qnfo-audit.kaizen_candidates, class gate or
      anti-pattern) and then only "promoted" into the issue ledger. A promoted lesson is prose: nothing stopped the same mistake from being made
      again. This module turns the ones a repository check can hold into deterministic, offline checks, one function per gate, so a pull request
      that repeats the mistake fails before the merge. The other gates are held by an existing enforcer or by a runtime detector; the module keeps
      a tripwire for the enforcers it relies on (deleting the enforcer is the way such a lesson is lost).
WHAT  Each gate returns violation lines `KAIZEN-GATE <KEY> VIOLATION <path>: <what>` (stable text, no timings, so scripts/regression_gate.py can
      compare them with the base tree: a pull request fails only for a line the base does not have).
        RED-INVENTORY-1                  tripwire  the fleet dashboard phone journey that proves "what needs me" is the first thing on "/" still exists
        BUILD-GATE-NOT-RUNTIME-GATE-1    tripwire  the deploy proves itself at runtime (probes + canary revert wired in canonical-deploy, dashboard probes, load gate)
        DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1  check  no live worker.toml binds (service, tail consumer, DO script) a retired, folded or absent worker (CF 10144 fails every deploy)
        LIVE-AHEAD-OF-REPO-UNCOMMITTED-1 tripwire  the repo-vs-live audit (fleet-autoaudit, drift guard, mirror guard) is still wired in the workflows
        CURRENCY-UNIT-TRAP-1             check     a source file that reads a Cloudflare billing amount (cents) declares the unit it converts to dollars
        STALE-TEMPLATE-MODELKEY-1        check     the repo prompt-template store names no superseded model key, and the three guard copies of the default agree
      Held elsewhere (see migrations/2026-11-05-kaizen-gate-runtime.sql): FLEET-VS-EXTERNAL-MISATTRIBUTION-1 (cost_source_registry
      scope, v_cost_fleet_30d), CLAIM-SHEET-DB-ENFORCEMENT-1 (guard_registry triggers), REGISTRY-DRIFT-CONCURRENT-REMOVAL-1 (fm-registry-live-absent, fleet-graph
      untracked-worker), GOVERNANCE-CAP-DISPOSITION-1 (v_fleet_budget_undisposed, fm-fleet-budget-undisposed).
      Command-line gates, which need a live input the repository does not hold:
        GATEWAY-RUNWAY-BRAKE-1           --gateway-config FILE|-   a GET of the AI Gateway returns a request-rate brake, authentication and an enabled spend limit
        TEMPLATE-RUNTIME-INJECTION-PARITY-1  --template-parity INJECTED --store STORE [--name NAME]   the text a runtime injected equals the store entry
USAGE python3 scripts/kaizen_gates.py [--root DIR] [--only KEY[,KEY]] [--list]
      python3 scripts/kaizen_gates.py --gateway-config FILE|-
      python3 scripts/kaizen_gates.py --template-parity INJECTED --store customPrompts-canonical.json [--name "CMD UPDATE (HOLISTIC)"]
EXIT  0 no violation, 1 a violation, 2 usage or unreadable input (fail closed).
"""
import hashlib
import json
import os
import re
import sys

SKIP_DIRS = {"node_modules", "archive", "dist"}
# a worker the repository does not hold but another binds on purpose; empty on 2026-11-05 (every live binding resolves to a directory here)
ALLOWED_EXTERNAL_SERVICES = frozenset()


def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return None


def rel(root, path):
    return os.path.relpath(path, root).replace(os.sep, "/")


def worker_dirs(root):
    """{dir: {"name": toml name, "retired": bool, "toml": text}} for every top-level directory with a wrangler.toml."""
    out = {}
    for d in sorted(os.listdir(root)):
        p = os.path.join(root, d)
        if d.startswith(".") or d in SKIP_DIRS or not os.path.isdir(p):
            continue
        text = read(os.path.join(p, "wrangler.toml"))
        if text is None:
            continue
        top = re.split(r"(?m)^\[", text, maxsplit=1)[0]
        m = re.search(r'(?m)^name\s*=\s*"([^"]+)"', top)
        out[d] = {"name": m.group(1) if m else d, "retired": os.path.exists(os.path.join(p, "RETIRED")) or os.path.exists(os.path.join(p, "FOLDED")), "toml": text}
    return out


def line(key, path, msg):
    return "KAIZEN-GATE %s VIOLATION %s: %s" % (key, path, msg)


def need(root, key, path, patterns, why):
    """Tripwire helper: file `path` must exist and contain every pattern (plain text)."""
    text = read(os.path.join(root, path))
    if text is None:
        return [line(key, path, "missing; " + why)]
    return [line(key, path, "no longer contains %r; %s" % (p, why)) for p in patterns if p not in text]


# ---- RED-INVENTORY-1 --------------------------------------------------------------------------------------------------------------
def gate_red_inventory(root):
    """The owner's dashboard opens on what needs them (V3-DASH-1 replaced the 2026-09-26 failures-only inventory). The phone journey is the enforcer."""
    return need(root, "RED-INVENTORY-1", "scripts/ux-journeys/apps/fleet.journeys.mjs", ['id: "see-what-needs-me"', 'u.see("Needs you")'],
                "UX-JOURNEYS-1 holds fleet.qnfo.org to showing what needs the owner first; deleting the journey removes the check")


# ---- BUILD-GATE-NOT-RUNTIME-GATE-1 ------------------------------------------------------------------------------------------------
def gate_build_gate_not_runtime(root):
    """A green build does not prove the request path (a forward let-reference threw at request time while wrangler --dry-run passed)."""
    out = []
    why = "DEPLOY-PROBES-1 proves a deploy at runtime"
    out += need(root, "BUILD-GATE-NOT-RUNTIME-GATE-1", ".github/workflows/canonical-deploy.yml", ["scripts/deploy_probes.py", "scripts/canary_revert.py"], why)
    out += need(root, "BUILD-GATE-NOT-RUNTIME-GATE-1", "scripts/pr_fast_guards.py", ['"worker-load-gate"'], "the load of every worker entry runs on a pull request")
    probes = read(os.path.join(root, "qnfo-fleet-dashboard/probes.json"))
    if probes is None:
        out.append(line("BUILD-GATE-NOT-RUNTIME-GATE-1", "qnfo-fleet-dashboard/probes.json", "missing; the dashboard that hit the request-time failure declares no runtime probe"))
    else:
        try:
            routes = [h for h in json.loads(probes).get("http", []) if isinstance(h, dict) and h.get("contains") and not str(h.get("url", "")).endswith("/health")]
        except ValueError:
            routes = []
        if not routes:
            out.append(line("BUILD-GATE-NOT-RUNTIME-GATE-1", "qnfo-fleet-dashboard/probes.json", "declares no page route with a marker besides /health; a render builder that throws at request time would pass"))
    return out


# ---- DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1 ------------------------------------------------------------------------------------------
BINDING_BLOCK = re.compile(r"^\[\[(?:env\.[\w-]+\.)?(services|tail_consumers|durable_objects\.bindings)\]\]\s*$")


def gate_dead_service_binding(root):
    """Cloudflare answers 10144 `references worker not found` and refuses the whole deploy when a binding points at a deleted script."""
    dirs = worker_dirs(root)
    by_name = {}
    for d, v in dirs.items():
        by_name.setdefault(v["name"], []).append(d)
    out = []
    for d, v in dirs.items():
        if v["retired"]:
            continue
        for blk in re.split(r"(?m)^(?=\[)", v["toml"]):
            head = blk.split("\n", 1)[0].strip()
            m = BINDING_BLOCK.match(head)
            if not m:
                continue
            key = "script_name" if m.group(1) == "durable_objects.bindings" else "service"
            tm = re.search(r'(?m)^%s\s*=\s*"([^"]+)"' % key, blk)
            if not tm:
                continue
            target = tm.group(1)
            if target in ALLOWED_EXTERNAL_SERVICES:
                continue
            owners = by_name.get(target)
            where = d + "/wrangler.toml"
            if not owners:
                out.append(line("DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1", where, "%s binds %r, which has no worker directory in the repository (a deleted script fails every deploy with CF 10144)" % (head, target)))
            elif all(dirs[o]["retired"] for o in owners):
                out.append(line("DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1", where, "%s binds %r, whose directory %s carries a RETIRED or FOLDED marker" % (head, target, ",".join(sorted(owners)))))
    return out


# ---- LIVE-AHEAD-OF-REPO-UNCOMMITTED-1 ---------------------------------------------------------------------------------------------
def gate_live_ahead_of_repo(root):
    """The deployed worker can be ahead of the repo (never redeploy repo-over-live). The audit that sees it is a workflow plus two guards."""
    out = []
    out += need(root, "LIVE-AHEAD-OF-REPO-UNCOMMITTED-1", ".github/workflows/fleet-autodeploy.yml", ["fleet-autoaudit.py --audit", "mirror-guard.py"],
                "fleet-autoaudit reads repo-versus-live per worker into worker_live_audit and reports live-ahead workers without redeploying them")
    out += need(root, "LIVE-AHEAD-OF-REPO-UNCOMMITTED-1", "scripts/fleet-autoaudit.py", ["repo-BEHIND"], "the audit's apply mode must keep refusing a repo-behind worker")
    for p in ("scripts/deploy-drift-guard.py", "scripts/mirror-guard.py"):
        if read(os.path.join(root, p)) is None:
            out.append(line("LIVE-AHEAD-OF-REPO-UNCOMMITTED-1", p, "missing"))
    return out


# ---- CURRENCY-UNIT-TRAP-1 ---------------------------------------------------------------------------------------------------------
BILLING = re.compile(r"\b(?:amount_due|amount_paid|amount_remaining|min_cents)\b|credit[-_]balance|invoice[-_]preview|ai-gateway/billing")
UNIT = re.compile(r"[Cc]ents?\b|CENTS|/\s*100(?:\.0)?\b|\*\s*0\.01\b")
BILLING_BYTES = (b"amount_due", b"amount_paid", b"amount_remaining", b"min_cents", b"credit-balance", b"credit_balance", b"invoice-preview", b"invoice_preview", b"ai-gateway/billing")
UNIT_SKIP = re.compile(r"(?:\.test\.|_test\.py$|\.fixture\.|-patch|-selftest|deployed-current|MODULE-INNER)")


def source_files(root):
    for d in sorted(os.listdir(root)):
        p = os.path.join(root, d)
        if d.startswith(".") or d in SKIP_DIRS or not os.path.isdir(p):
            continue
        if d == "scripts":
            for base, dn, fn in os.walk(p):
                dn[:] = [x for x in dn if not x.startswith(("_", ".")) and x not in SKIP_DIRS]
                for f in fn:
                    if f.endswith((".py", ".mjs", ".js")):
                        yield os.path.join(base, f)
        elif os.path.isfile(os.path.join(p, "worker.js")) and not (os.path.exists(os.path.join(p, "RETIRED")) or os.path.exists(os.path.join(p, "FOLDED"))):
            yield os.path.join(p, "worker.js")


def gate_currency_unit_trap(root):
    """Cloudflare AI Gateway billing amounts are USD cents, gateway log cost is dollars: reading cents as dollars inflated a claim 100x."""
    out = []
    for path in source_files(root):
        name = os.path.basename(path)
        if UNIT_SKIP.search(name):
            continue
        try:
            with open(path, "rb") as fh:
                data = fh.read()
        except OSError:
            continue
        if not any(t in data for t in BILLING_BYTES):  # a 1.6 MB worker is not decoded unless it names a billing field
            continue
        text = data.decode("utf-8", "replace")
        if not BILLING.search(text) or UNIT.search(text):
            continue
        out.append(line("CURRENCY-UNIT-TRAP-1", rel(root, path), "reads a Cloudflare billing amount (cents) and never names the unit or divides by 100; declare it (for example `// Billing amounts are USD CENTS`) where the amount becomes dollars"))
    return out


# ---- STALE-TEMPLATE-MODELKEY-1 ----------------------------------------------------------------------------------------------------
SUPERSEDED_KEYS = ("gpt-4.1",)  # AI-GATEWAY/openai/gpt-4.1: AI-GATEWAY is not a registered DeepChat provider (DEFAULT-KEY-OPS-1, 2026-09-27)
PAIR_PATTERNS = (
    ("docs/ops-governance/scripts/model_guard.py", r'(?m)^DESIRED_KEY\b[^\n]*?\{\s*"providerId":\s*"([^"]+)",\s*"modelId":\s*"([^"]+)"'),
    ("docs/ops-governance/scripts/sync_system_prompt.py", r'(?m)^MODEL_DICT\b[^\n]*?\{\s*"providerId":\s*"([^"]+)",\s*"modelId":\s*"([^"]+)"'),
    ("docs/ops-governance/scripts/ops-settings-guard.py", r'(?m)^DESIRED_KEYS\b[^\n]*?\{\s*"providerId":\s*"([^"]+)",\s*"modelId":\s*"([^"]+)"'),
)


def live_default_pair(root):
    """(pair, violations): the canonical default read from the guard triplicate (GUARD-TRIPLICATE-CONSISTENCY-1), never hard-coded here."""
    pairs, out = {}, []
    for path, pat in PAIR_PATTERNS:
        text = read(os.path.join(root, path))
        m = re.search(pat, text) if text else None
        if not m:
            out.append(line("STALE-TEMPLATE-MODELKEY-1", path, "no default model key literal found; the triplicate cannot be compared"))
        else:
            pairs[path] = "%s/%s" % (m.group(1), m.group(2))
    if len(set(pairs.values())) > 1:
        out.append(line("STALE-TEMPLATE-MODELKEY-1", "docs/ops-governance/scripts", "the guard copies of the default model key disagree: " + ", ".join("%s=%s" % (os.path.basename(k), v) for k, v in sorted(pairs.items()))))
    return (next(iter(pairs.values())) if pairs else None), out


def template_findings(entries, pair):
    """[(entry name, problem)] for a prompt-template store: a superseded key, or the default-model invariant stated without the live pair."""
    out = []
    for e in entries if isinstance(entries, list) else []:
        if not isinstance(e, dict):
            continue
        blob = (e.get("content") or "") + "\n" + (e.get("template") or "")
        name = e.get("name") or e.get("id") or "?"
        for key in SUPERSEDED_KEYS:
            if key in blob:
                out.append((name, "carries the superseded model key %s" % key))
        if pair and "DEEPCHAT-DEFAULT-MODEL-1" in blob and pair not in blob:
            out.append((name, "states DEEPCHAT-DEFAULT-MODEL-1 but never names the live default %s" % pair))
    return out


def gate_stale_template_modelkey(root):
    """A CMD template kept asserting the superseded default after the live system prompt moved; obeying it would revert the fix."""
    pair, out = live_default_pair(root)
    scripts = os.path.join(root, "docs/ops-governance/scripts")
    stores = sorted(f for f in (os.listdir(scripts) if os.path.isdir(scripts) else []) if re.match(r"customPrompts.*\.json$", f))
    for f in stores:
        p = os.path.join("docs/ops-governance/scripts", f).replace(os.sep, "/")
        try:
            entries = json.loads(read(os.path.join(root, p)) or "null")
        except ValueError:
            out.append(line("STALE-TEMPLATE-MODELKEY-1", p, "is not valid JSON"))
            continue
        for name, problem in template_findings(entries, pair):
            out.append(line("STALE-TEMPLATE-MODELKEY-1", p, "template %r %s" % (name, problem)))
    return out


# ---- command-line gates -----------------------------------------------------------------------------------------------------------
RATE_BRAKE_MAX = 300  # requests per minute; GATEWAY-RUNWAY-BRAKE-1 tightened 1200 -> 300 on 2026-09-26


def gateway_brake_findings(cfg):
    """GATEWAY-RUNWAY-BRAKE-1 over the `result` of GET /accounts/{id}/ai-gateway/gateways/{name}. The rate brake stops a request loop; it does NOT
    stop token-volume burn (100K-175K-token contexts), so an enabled spend limit with a cost rule is required as well."""
    out = []
    limit, interval = cfg.get("rate_limiting_limit"), cfg.get("rate_limiting_interval")
    if not isinstance(limit, (int, float)) or isinstance(limit, bool) or limit <= 0:
        out.append("no request-rate brake (rate_limiting_limit is %r)" % (limit,))
    elif limit > RATE_BRAKE_MAX * (interval / 60.0 if isinstance(interval, (int, float)) and interval > 0 else 1):
        out.append("request-rate brake %s per %s s is looser than %d per minute" % (limit, interval, RATE_BRAKE_MAX))
    if cfg.get("authentication") is not True:
        out.append("gateway authentication is off")
    sl = cfg.get("spend_limits") or {}
    rules = [r for r in (sl.get("rules") or []) if isinstance(r, dict) and r.get("enabled") and r.get("limitType") == "cost" and isinstance(r.get("limit"), (int, float))]
    if not sl.get("enabled") or not rules:
        out.append("no enabled cost spend limit (the rate brake cannot catch token-volume burn)")
    return out


def normalise(text):
    return "\n".join(l.rstrip() for l in (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")).strip()


def template_parity_findings(injected, entries, name=None, pair=None):
    """TEMPLATE-RUNTIME-INJECTION-PARITY-1: a clean store is necessary, not sufficient; the text a runtime really injected must equal a store entry.
    Returns problems (empty = parity). With `name` the entry is chosen by name, otherwise by equality; a miss names the closest entry and the first differing line."""
    inj = normalise(injected)
    cands = [e for e in entries if isinstance(e, dict) and (name is None or e.get("name") == name)]
    if not cands:
        return ["no store entry%s" % (" named %r" % name if name else "")]
    texts = [(e.get("name") or e.get("id") or "?", normalise(e.get("content") or e.get("template") or "")) for e in cands]
    if any(t == inj for _, t in texts):
        out = []
    else:
        best = max(texts, key=lambda nt: sum(1 for a, b in zip(nt[1].split("\n"), inj.split("\n")) if a == b))
        a, b = best[1].split("\n"), inj.split("\n")
        idx = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), min(len(a), len(b)))
        out = ["injected text differs from store entry %r (sha256 %s vs %s): first difference at line %d" % (best[0], hashlib.sha256(inj.encode()).hexdigest()[:12], hashlib.sha256(best[1].encode()).hexdigest()[:12], idx + 1)]
    for key in SUPERSEDED_KEYS:
        if key in inj:
            out.append("injected text carries the superseded model key %s" % key)
    if pair and "DEEPCHAT-DEFAULT-MODEL-1" in inj and pair not in inj:
        out.append("injected text states DEEPCHAT-DEFAULT-MODEL-1 but never names the live default %s" % pair)
    return out


# ---- registry and entry point ------------------------------------------------------------------------------------------------------
GATES = [
    ("RED-INVENTORY-1", gate_red_inventory),
    ("BUILD-GATE-NOT-RUNTIME-GATE-1", gate_build_gate_not_runtime),
    ("DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1", gate_dead_service_binding),
    ("LIVE-AHEAD-OF-REPO-UNCOMMITTED-1", gate_live_ahead_of_repo),
    ("CURRENCY-UNIT-TRAP-1", gate_currency_unit_trap),
    ("STALE-TEMPLATE-MODELKEY-1", gate_stale_template_modelkey),
]


def arg(argv, name):
    return next((argv[i + 1] for i, a in enumerate(argv[:-1]) if a == name), None)


def main(argv):
    if "--gateway-config" in argv:
        src = arg(argv, "--gateway-config")
        text = sys.stdin.read() if src == "-" else read(src or "")
        try:
            doc = json.loads(text)
        except (TypeError, ValueError):
            print("kaizen_gates.py: --gateway-config needs the JSON of the gateway GET", file=sys.stderr)
            return 2
        cfg = doc.get("result", doc) if isinstance(doc, dict) else {}
        problems = gateway_brake_findings(cfg)
        for p in problems:
            print("KAIZEN-GATE GATEWAY-RUNWAY-BRAKE-1 VIOLATION gateway: " + p)
        print("KAIZEN-GATES: gateway brake, %d violation(s)" % len(problems))
        return 1 if problems else 0
    if "--template-parity" in argv:
        inj, store = read(arg(argv, "--template-parity") or ""), read(arg(argv, "--store") or "")
        if inj is None or store is None:
            print("kaizen_gates.py: --template-parity INJECTED --store STORE, both readable", file=sys.stderr)
            return 2
        try:
            entries = json.loads(store)
        except ValueError:
            print("kaizen_gates.py: the store is not valid JSON", file=sys.stderr)
            return 2
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        pair, pv = live_default_pair(arg(argv, "--root") or root)
        problems = template_parity_findings(inj, entries, arg(argv, "--name"), pair)
        for p in pv:
            print(p)
        for p in problems:
            print("KAIZEN-GATE TEMPLATE-RUNTIME-INJECTION-PARITY-1 VIOLATION injected: " + p)
        print("KAIZEN-GATES: template injection parity, %d violation(s)" % (len(problems) + len(pv)))
        return 1 if problems or pv else 0
    root = os.path.abspath(arg(argv, "--root") or os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    only = set((arg(argv, "--only") or "").split(",")) - {""}
    chosen = [(k, f) for k, f in GATES if not only or k in only]
    if "--list" in argv:
        for k, _ in chosen:
            print(k)
        return 0
    if only and len(chosen) != len(only):
        print("kaizen_gates.py: unknown gate in --only (known: %s)" % ", ".join(k for k, _ in GATES), file=sys.stderr)
        return 2
    violations = []
    for key, fn in chosen:
        violations += fn(root)
    for v in violations:
        print(v)
    print("KAIZEN-GATES: %d gate(s), %d violation(s)" % (len(chosen), len(violations)))
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
