#!/usr/bin/env python3
"""fleet_lessons_gates.py -- FLEET-LESSONS-GATES-1 (charter pillar: autonomy; roadmap rows RM-GATE-C1, C3, D4, E2, H1, H2, H3).

WHY   The "quniverse-fleet-lessons" failure ledger (docs/QUNIVERSE-BACKLOG.md section 3) names, for each failure, a remedy that became a
      standing gate. Eight of them were audited 2026-09-30 as `local-only`: the guard that enforces them (docs/ops-governance/scripts,
      folded from QNFO/qnfo-ops by REPO-UNIFY-2) runs on the owner's machine, so a change that breaks the remedy was noticed by nobody until the
      next local cycle (agent_issues 1686 GUARDS-LOCAL-ONLY-1: "nothing in the cloud notices if the local guards stop running").
      The RUNTIME half of those guards (the owner's DeepChat database, %TEMP%, the skills directory) can only run on that machine. The
      REPOSITORY half is plain text and is enforced here, offline, on every pull request that touches it:

      C1  Client-state changes are mirrored into the enforcing guard. The default-model key {providerId, modelId} is written in five places
          (model_guard.DESIRED_KEY and SESSION_KEY, ops-settings-guard.DESIRED_KEYS, sync_system_prompt.MODEL_DICT, local-config-selfheal
          heal_app_db) and in the provider-status tables of two of them; they must be one value. The canonical prompt templates must not carry the
          superseded default (gpt-4.1) and must name the live pair wherever they state the default-model invariant (what prompt-store-verify
          check_spec_guard_parity and check_template_model_invariant do on the owner's machine, here on the checkout).
      C3  A client default model must resolve in the runtime registry. The model id of each provider the guards pin must be the id its
          runtime worker advertises (qnfo-ops OPS_PUBLIC_MODEL, the qnfo-ai and personal-api /v1/models entry) and must be listed under that
          provider in chatbox-providers-canonical.json; the default key's provider must be one of the pinned providers (the superseded
          AI-GATEWAY/openai/gpt-4.1 default named a provider the client never registered: 0 of 77).
      E2  Secrets are read from their file stores. A script that runs on the owner's machine and reads a credential (a variable named *TOKEN, *_KEY,
          *SECRET, *PASSWORD) from the process environment also consults the file store (~/.env, ~/.qnfo, .deepchat/secrets, ~/tokens) before it
          reports the key missing: a session once judged "missing credential" from the environment while the key sat in the file.
      D4  A wrapper uses the platform-correct command form. Node tools (npx, npm, wrangler ...) are .cmd shims on Windows: a process argv that
          starts with the bare name raises WinError 2 before the guard ever runs. A script that builds one needs a resolver in the same file
          (shutil.which, a .cmd literal, an os.name / sys.platform branch, shell=True), the pattern of scripts/deploy_gate.py.
      H1  Independent purge sweeps for backup orphans. A script that creates agent-snapshot-* files purges orphans of earlier runs BEFORE it
          takes its first snapshot and cleans up in a finally block; purge-agent-snapshots.py collects same-day orphans (default cutoff
          SNAPSHOT_ORPHAN_MIN_AGE_MIN at most 360), not only files a day old.
      H2  Skill registry membership is verified before reliance. skill_pull.py does not stop at counting SKILL.md files in the destination: it
          compares the set of skills in the source with the destination and exits non-zero when one is missing or has no SKILL.md.
      H3  A junction/hardlink probe comes before any dedupe deletion. In the owner-machine scripts a directory-tree deletion
          (shutil.rmtree, os.rmdir, os.removedirs), and any file deletion inside a dedupe/duplicate function, needs a link probe in the same
          function (islink, isjunction, samefile, lstat, st_nlink, realpath ...), or a `link-probe-exempt: <reason>` comment on or above the call.
      Not here, and why: RM-GATE-H5 (runtime state reconciled in-session) is a behaviour of a session on the owner's machine (whether the running
      app re-read its file). It stays local-only; the cloud keeps it visible through the fm-h5-owner-restart-handoff detector, and the session half of
      E2 (which store a session looked in) through the blocker_redteam ledger, metric unverified_blocker_claims and fm-e2-credential-missing-claim
      (migrations/2026-11-04-c4-gates-roadmap-closeout.sql).

WHAT  Pure standard library, no network, about 1 s. Reads only files under the root. A missing input is a finding (fail closed).
      One line per finding, without line numbers, so scripts/regression_gate.py compares runs by text:
          VIOLATION <gate> <path>: <message>
      and one `FLEET-LESSONS-GATES <gate> ok|<n> finding(s)` line per gate.
USAGE python3 scripts/fleet_lessons_gates.py [--root DIR] [--only C1,C3,D4,E2,H1,H2,H3] [--list]
      FLEET_LESSONS_ROOT overrides the root (the offline suite scripts/fleet-lessons-gates.test.mjs builds fixture trees).
EXIT  0 no finding; 1 at least one finding.
"""
import ast
import importlib.util
import json
import os
import re
import sys
import tempfile
import warnings

HERE = os.path.dirname(os.path.abspath(__file__))
OPS = "docs/ops-governance/scripts"

# D4 --------------------------------------------------------------------------------------------------------------------------------------
NODE_TOOLS = {"npx", "npm", "pnpm", "yarn", "wrangler", "tsc", "esbuild", "vite", "vitest", "jest", "eslint", "prettier", "bun", "corepack", "playwright"}
RESOLVER = re.compile(r"shutil\.which\(|\.cmd[\"']|\bos\.name\b|sys\.platform|platform\.system\(|shell\s*=\s*True")
NODE_QUOTED = re.compile(r"""["'](?:%s)["']""" % "|".join(sorted(NODE_TOOLS)))
JS_SPAWN = re.compile(r"""\b(?:spawn|spawnSync|execFile|execFileSync)\(\s*(["'`])(%s)\1""" % "|".join(sorted(NODE_TOOLS)))
JS_RESOLVER = re.compile(r"win32|\.cmd[\"'`]|shell\s*:\s*true|process\.platform")

# E2 --------------------------------------------------------------------------------------------------------------------------------------
SECRET_NAME = re.compile(r"(?:TOKEN|_KEY|SECRET|PASSWORD|PASS)$")
FILE_STORE = re.compile(r"~/\.env|\.env[\"']|(?:[\\/]|[\"'])\.qnfo|deepchat[\\/]+secrets|[\"']\.deepchat[\"']\s*,\s*[\"']secrets|[\\/]tokens[\\/]|[\"']tokens[\"']")

# H3 --------------------------------------------------------------------------------------------------------------------------------------
LINK_PROBE = re.compile(r"is_?link|is_?junction|is_symlink|link_probe|samefile|st_nlink|\blstat\b|readlink|realpath|S_ISLNK|REPARSE_POINT")
DEDUPE_WORDS = re.compile(r"dedup|duplicate|dupe", re.I)
EXEMPT = re.compile(r"link-probe-exempt:\s*\S+")

# C1 / C3 ---------------------------------------------------------------------------------------------------------------------------------
KEY_SOURCES = [  # label, file under OPS, identifier that sits on the same line as the {"providerId": ..., "modelId": ...} literal
    ("model_guard.DESIRED_KEY", "model_guard.py", "DESIRED_KEY"),
    ("model_guard.SESSION_KEY", "model_guard.py", "SESSION_KEY"),
    ("ops-settings-guard.DESIRED_KEYS", "ops-settings-guard.py", "DESIRED_KEYS"),
    ("sync_system_prompt.MODEL_DICT", "sync_system_prompt.py", "MODEL_DICT"),
    ("local-config-selfheal.heal_app_db", "local-config-selfheal.py", "want"),
]
STATUS_SOURCES = [("local-config-selfheal.STATUS_WHITELIST", "local-config-selfheal.py", "STATUS_WHITELIST"),
                  ("model_guard.MODEL_STATUS_CANON", "model_guard.py", "MODEL_STATUS_CANON")]
# provider -> (runtime worker source, pattern whose group 1 is the id the endpoint advertises)
RUNTIME = {
    "QNFO-OPS": ("qnfo-ops/worker.js", r'OPS_PUBLIC_MODEL\s*=\s*"([\w.-]+)"'),
    "QNFO-ROUTER": ("qnfo-ai/worker.js", r'id:\s*"([\w.-]+)",\s*object:\s*"model",\s*created:\s*171e7,\s*owned_by:\s*"qnfo",\s*capabilities'),
    "PERSONAL-TWIN": ("personal-api/worker.js", r'\{\s*id:\s*"([\w.-]+)",\s*object:\s*"model"'),
}


class Findings:
    def __init__(self):
        self.items = []  # (gate, path, message)

    def add(self, gate, path, message):
        line = (gate, path.replace("\\", "/"), re.sub(r"\s+", " ", message).strip())
        if line not in self.items:
            self.items.append(line)

    def count(self, gate):
        return sum(1 for g, _, _ in self.items if g == gate)


def read(root, rel):
    try:
        with open(os.path.join(root, rel), encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return None


def parse(text):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # a Windows path in a docstring is a SyntaxWarning, not a finding
            return ast.parse(text)
    except (SyntaxError, ValueError):
        return None


def listdir(root, rel, suffix):
    try:
        return sorted(f for f in os.listdir(os.path.join(root, rel)) if f.endswith(suffix) and os.path.isfile(os.path.join(root, rel, f)))
    except OSError:
        return []


def key_literal(text, ident):
    m = re.search(r'\b%s\b[^\n]*?\{\s*"providerId":\s*"([^"]+)",\s*"modelId":\s*"([^"]+)"' % re.escape(ident), text)
    return (m.group(1), m.group(2)) if m else None


def dict_literal(text, ident):
    m = re.search(r"^%s\s*=\s*(\{[^}]*\})" % re.escape(ident), text, re.M)
    if not m:
        return None
    try:
        v = ast.literal_eval(m.group(1))
    except (ValueError, SyntaxError):
        return None
    return v if isinstance(v, dict) else None


# C1 --------------------------------------------------------------------------------------------------------------------------------------
def check_c1(root, f):
    vals = {}
    for label, fn, ident in KEY_SOURCES:
        text = read(root, OPS + "/" + fn)
        if text is None:
            f.add("C1", OPS + "/" + fn, "cannot read the enforcing guard; the default-model key cannot be compared")
            continue
        v = key_literal(text, ident)
        if v is None:
            f.add("C1", OPS + "/" + fn, "no {providerId, modelId} literal next to %s" % ident)
            continue
        vals[label] = v
    if len(set(vals.values())) > 1:
        f.add("C1", OPS, "the default-model key diverged across the guards: " + "; ".join("%s=%s/%s" % (k, v[0], v[1]) for k, v in sorted(vals.items())))
    tables = {}
    for label, fn, ident in STATUS_SOURCES:
        text = read(root, OPS + "/" + fn)
        t = dict_literal(text, ident) if text is not None else None
        if t is None:
            f.add("C1", OPS + "/" + fn, "no readable %s table" % ident)
        else:
            tables[label] = t
    if len(tables) == 2 and tables[STATUS_SOURCES[0][0]] != tables[STATUS_SOURCES[1][0]]:
        f.add("C1", OPS, "the provider-status tables diverged: %s" % "; ".join("%s=%s" % (k, json.dumps(v, sort_keys=True)) for k, v in sorted(tables.items())))
    pair = next(iter(set(vals.values())), None) if len(set(vals.values())) == 1 else None
    raw = read(root, OPS + "/customPrompts-canonical.json")
    if raw is None:
        f.add("C1", OPS + "/customPrompts-canonical.json", "cannot read the canonical template store")
        return pair, tables
    try:
        store = json.loads(raw)
    except ValueError:
        f.add("C1", OPS + "/customPrompts-canonical.json", "the canonical template store is not valid JSON")
        return pair, tables
    for p in store if isinstance(store, list) else []:
        if not isinstance(p, dict):
            continue
        blob = (p.get("content") or "") + "\n" + (p.get("template") or "")
        name = p.get("name") or p.get("id") or "?"
        if "gpt-4.1" in blob:
            f.add("C1", OPS + "/customPrompts-canonical.json", "template %r carries the superseded default id gpt-4.1" % name)
        if pair and "DEEPCHAT-DEFAULT-MODEL-1" in blob and ("%s/%s" % pair) not in blob:
            f.add("C1", OPS + "/customPrompts-canonical.json", "template %r states the default-model invariant but does not name %s/%s" % (name, pair[0], pair[1]))
    for fn in listdir(root, OPS, ".txt"):
        if fn.endswith("-canonical.txt"):
            text = read(root, OPS + "/" + fn) or ""
            if "gpt-4.1" in text:
                f.add("C1", OPS + "/" + fn, "the canonical prompt carries the superseded default id gpt-4.1")
            for m in re.finditer(r'\{\s*"?providerId"?\s*:\s*"([^"]+)"\s*,\s*"?modelId"?\s*:\s*"([^"]+)"', text):
                if pair and (m.group(1), m.group(2)) != pair:
                    f.add("C1", OPS + "/" + fn, "the canonical prompt names default key %s/%s, the guards enforce %s/%s" % (m.group(1), m.group(2), pair[0], pair[1]))
    return pair, tables


# C3 --------------------------------------------------------------------------------------------------------------------------------------
def check_c3(root, f, pair=None, tables=None):
    if pair is None or tables is None:
        scratch = Findings()
        pair, tables = check_c1(root, scratch)
    status = tables.get("local-config-selfheal.STATUS_WHITELIST") or tables.get("model_guard.MODEL_STATUS_CANON")
    if not status:
        f.add("C3", OPS, "no provider-status table, so the pinned models cannot be resolved against the runtime registry")
        return
    if pair is None:
        f.add("C3", OPS, "no single default-model key, so it cannot be resolved against the runtime registry")
    elif pair[0] not in status or status[pair[0]] != pair[1]:
        f.add("C3", OPS, "default key %s/%s does not resolve: the pinned providers are %s" % (pair[0], pair[1], json.dumps(status, sort_keys=True)))
    raw = read(root, OPS + "/chatbox-providers-canonical.json")
    try:
        client = {str(p.get("id", "")).lower(): [m.get("modelId") for m in (p.get("defaultSettings") or {}).get("models", []) if isinstance(m, dict)]
                  for p in (json.loads(raw) if raw else [])}
    except (ValueError, AttributeError):
        client = None
    if client is None:
        f.add("C3", OPS + "/chatbox-providers-canonical.json", "cannot read the client provider registry")
        client = {}
    for provider, model in sorted(status.items()):
        if model not in (client.get(provider.lower()) or []):
            f.add("C3", OPS + "/chatbox-providers-canonical.json", "provider %s does not list model %s" % (provider.lower(), model))
        if provider not in RUNTIME:
            f.add("C3", OPS, "pinned provider %s has no runtime worker in the gate's table" % provider)
            continue
        src, pat = RUNTIME[provider]
        text = read(root, src)
        if text is None:
            f.add("C3", src, "cannot read the runtime worker that must advertise model %s" % model)
            continue
        m = re.search(pat, text)
        if not m:
            f.add("C3", src, "advertises no single public model id the gate can read (expected %s)" % model)
        elif m.group(1) != model:
            f.add("C3", src, "advertises model %s, the client pins %s for provider %s" % (m.group(1), model, provider))
    ops_src = read(root, RUNTIME["QNFO-OPS"][0])
    if ops_src and pair and pair[0] == "QNFO-OPS":
        alias = re.search(r"OPS_PUBLIC_ALIAS\s*=\s*\{([^}]*)\}", ops_src)
        if alias and not re.search(r'"%s"\s*:' % re.escape(pair[1]), alias.group(1)):
            f.add("C3", RUNTIME["QNFO-OPS"][0], "OPS_PUBLIC_ALIAS does not accept the pinned default model %s" % pair[1])


# D4 --------------------------------------------------------------------------------------------------------------------------------------
def py_scan_files(root):
    out = [("scripts", fn) for fn in listdir(root, "scripts", ".py")]
    base = os.path.join(root, OPS)
    for dirpath, _, files in os.walk(base):
        rel = os.path.relpath(dirpath, root).replace("\\", "/")
        out += [(rel, fn) for fn in sorted(files) if fn.endswith(".py")]
    return out


def check_d4(root, f):
    for d, fn in py_scan_files(root):
        rel = d + "/" + fn
        text = read(root, rel)
        if text is None or "subprocess" not in text or not NODE_QUOTED.search(text) or RESOLVER.search(text):
            continue
        tree = parse(text)
        if tree is None:
            continue
        for node in ast.walk(tree):
            if isinstance(node, (ast.List, ast.Tuple)) and node.elts and isinstance(node.elts[0], ast.Constant) \
                    and isinstance(node.elts[0].value, str) and node.elts[0].value in NODE_TOOLS:
                f.add("D4", rel, "process argv starts with the bare command %r and the file has no platform resolver (Windows needs %s.cmd: use shutil.which)" % (node.elts[0].value, node.elts[0].value))
    for fn in listdir(root, "scripts", ".mjs"):
        rel = "scripts/" + fn
        text = read(root, rel)
        if text is None or JS_RESOLVER.search(text):
            continue
        m = JS_SPAWN.search(text)
        if m:
            f.add("D4", rel, "spawns the bare command %r with no win32 / .cmd / shell handling in the file" % m.group(2))


# E2 --------------------------------------------------------------------------------------------------------------------------------------
def is_environ(node):
    return isinstance(node, ast.Attribute) and node.attr == "environ" and isinstance(node.value, ast.Name) and node.value.id == "os"


def env_secret_reads(tree):
    """Credential-like names (*TOKEN, *_KEY, *SECRET, *PASSWORD) the module reads from the process environment by a literal name."""
    names = set()
    for n in ast.walk(tree):
        name = None
        if isinstance(n, ast.Call) and n.args and isinstance(n.args[0], ast.Constant) and isinstance(n.args[0].value, str):
            fn = n.func
            if isinstance(fn, ast.Attribute) and ((fn.attr == "get" and is_environ(fn.value)) or (fn.attr == "getenv" and isinstance(fn.value, ast.Name) and fn.value.id == "os")):
                name = n.args[0].value
        elif isinstance(n, ast.Subscript) and is_environ(n.value):
            key = n.slice
            if isinstance(key, ast.Constant) and isinstance(key.value, str):
                name = key.value
        if name and SECRET_NAME.search(name):
            names.add(name)
    return sorted(names)


def check_e2(root, f):
    for d, fn in py_scan_files(root):
        if not d.startswith(OPS):
            continue
        rel = d + "/" + fn
        text = read(root, rel)
        if text is None or "environ" not in text and "getenv" not in text:
            continue
        tree = parse(text)
        if tree is None:
            continue
        names = env_secret_reads(tree)
        if names and not FILE_STORE.search(text):
            f.add("E2", rel, "reads %s from the process environment only and never consults a file store (~/.env, ~/.qnfo, .deepchat/secrets), so a key held there is reported missing" % ", ".join(names))


# H1 --------------------------------------------------------------------------------------------------------------------------------------
def call_name(node):
    fn = node.func
    return fn.id if isinstance(fn, ast.Name) else (fn.attr if isinstance(fn, ast.Attribute) else "")


def check_h1(root, f):
    for fn in listdir(root, OPS, ".py"):
        rel = OPS + "/" + fn
        text = read(root, rel)
        tree = parse(text) if text else None
        if tree is None:
            continue
        creates = any(isinstance(n, ast.Constant) and isinstance(n.value, str) and n.value.startswith("agent-snapshot-") and "*" not in n.value for n in ast.walk(tree))
        if creates:
            mains = [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "main"]
            calls = sorted(((c.lineno, call_name(c)) for m in mains for c in ast.walk(m) if isinstance(c, ast.Call)))
            purge = next((ln for ln, nm in calls if re.search(r"purge|sweep", nm, re.I) and re.search(r"orphan|snapshot", nm, re.I)), None)
            first_snap = next((ln for ln, nm in calls if nm == "snapshot"), None)
            if not mains or first_snap is None:
                f.add("H1", rel, "creates agent-snapshot-* files but has no main() that takes the snapshot, so the purge order cannot be checked")
            elif purge is None or purge > first_snap:
                f.add("H1", rel, "creates agent-snapshot-* files but does not purge orphans of earlier runs before its first snapshot")
            # the finally must be in the function that owns the snapshots: another function's finally (the upload's own temp file) does not clean them
            if not any(isinstance(n, ast.Try) and n.finalbody and any(call_name(c) in ("remove", "unlink") for b in n.finalbody for c in ast.walk(b) if isinstance(c, ast.Call))
                       for m in mains for n in ast.walk(m)):
                f.add("H1", rel, "creates agent-snapshot-* files but removes them in no finally block of main() (a failed upload leaks the file)")
    purge_fn = OPS + "/purge-agent-snapshots.py"
    text = read(root, purge_fn)
    if text is None:
        f.add("H1", purge_fn, "cannot read the independent purge sweep")
    else:
        m = re.search(r'SNAPSHOT_ORPHAN_MIN_AGE_MIN"?\s*,\s*"(\d+)"', text)
        if not m:
            f.add("H1", purge_fn, "no SNAPSHOT_ORPHAN_MIN_AGE_MIN cutoff: a same-day orphan waits for the daily age limit")
        elif int(m.group(1)) > 360:
            f.add("H1", purge_fn, "the orphan cutoff defaults to %s minutes; a same-day orphan needs at most 360" % m.group(1))


# H2 --------------------------------------------------------------------------------------------------------------------------------------
def check_h2(root, f):
    rel = OPS + "/skill_pull.py"
    text = read(root, rel)
    if text is None:
        f.add("H2", rel, "cannot read the skill sync script")
        return
    try:
        spec = importlib.util.spec_from_file_location("fl_skill_pull", os.path.join(root, rel))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        verify = getattr(mod, "verify_membership")
    except Exception as e:  # noqa: BLE001 - a script that cannot be loaded or has no verifier is the finding
        f.add("H2", rel, "has no importable verify_membership(src_dirs, dest): %s" % type(e).__name__)
        return
    tree = parse(text)
    main_calls = [call_name(c) for n in (tree.body if tree else []) if isinstance(n, ast.FunctionDef) and n.name == "main" for c in ast.walk(n) if isinstance(c, ast.Call)]
    if "verify_membership" not in main_calls:
        f.add("H2", rel, "main() never calls verify_membership, so a skill missing from the destination goes unnoticed")
    with tempfile.TemporaryDirectory(prefix="fl-h2-") as td:
        src, dest = os.path.join(td, "src"), os.path.join(td, "dest")
        for base, names in ((src, ("alpha", "beta", "gamma")), (dest, ("alpha", "gamma"))):
            for n in names:
                os.makedirs(os.path.join(base, n))
                with open(os.path.join(base, n, "SKILL.md"), "w", encoding="utf-8") as fh:
                    fh.write("---\nname: %s\n---\n" % n)
        os.remove(os.path.join(dest, "gamma", "SKILL.md"))  # registered by directory, unusable without its SKILL.md
        try:
            missing = sorted(verify([os.path.join(src, n) for n in ("alpha", "beta", "gamma")], dest))
        except Exception as e:  # noqa: BLE001
            f.add("H2", rel, "verify_membership raised %s on a fixture" % type(e).__name__)
            return
        if missing != ["beta", "gamma"]:
            f.add("H2", rel, "verify_membership reported %s for a fixture missing beta and a SKILL.md for gamma" % missing)


# H3 --------------------------------------------------------------------------------------------------------------------------------------
DELETE_CALL = re.compile(r"rmtree|rmdir|removedirs|\bremove\(|unlink")
TREE_DELETES = {"rmtree", "rmdir", "removedirs"}
FILE_DELETES = {"remove", "unlink"}


def check_h3(root, f):
    for fn in listdir(root, OPS, ".py"):
        rel = OPS + "/" + fn
        text = read(root, rel)
        tree = parse(text) if text and DELETE_CALL.search(text) else None
        if tree is None:
            continue
        lines = text.splitlines()
        funcs = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
        for call in (n for n in ast.walk(tree) if isinstance(n, ast.Call)):
            name = call_name(call)
            if name not in TREE_DELETES | FILE_DELETES:
                continue
            owner = None
            for fd in funcs:
                if fd.lineno <= call.lineno <= (fd.end_lineno or fd.lineno) and (owner is None or fd.lineno > owner.lineno):
                    owner = fd
            scope = (ast.get_source_segment(text, owner) if owner else text) or ""
            dedupe = bool(owner and DEDUPE_WORDS.search(owner.name + " " + (ast.get_docstring(owner) or "")))
            if name in FILE_DELETES and not dedupe:
                continue
            around = "\n".join(lines[max(0, call.lineno - 2):call.lineno])
            if LINK_PROBE.search(scope) or EXEMPT.search(around):
                continue
            where = owner.name + "()" if owner else "module level"
            f.add("H3", rel, "%s in %s deletes without a junction/hardlink probe (islink, isjunction, samefile, lstat, st_nlink) and carries no `link-probe-exempt: <reason>`" % (name, where))


GATES = [("C1", None), ("C3", None), ("D4", check_d4), ("E2", check_e2), ("H1", check_h1), ("H2", check_h2), ("H3", check_h3)]  # C1 and C3 share the parsed guard values (see run)


def run(root, only=None):
    f = Findings()
    pair = tables = None
    for gate, fn in GATES:
        if only and gate not in only:
            continue
        if gate == "C1":
            pair, tables = check_c1(root, f)
        elif gate == "C3":
            check_c3(root, f, pair, tables)
        else:
            fn(root, f)
    return f


def main(argv):
    if "--list" in argv:
        print(",".join(g for g, _ in GATES))
        return 0
    root = next((argv[i + 1] for i, a in enumerate(argv[:-1]) if a == "--root"), None) or os.environ.get("FLEET_LESSONS_ROOT") or os.path.dirname(HERE)
    only = next((argv[i + 1].split(",") for i, a in enumerate(argv[:-1]) if a == "--only"), None)
    f = run(root, only)
    for gate, path, message in f.items:
        print("VIOLATION %s %s: %s" % (gate, path, message))
    for gate, _ in GATES:
        if only and gate not in only:
            continue
        n = f.count(gate)
        print("FLEET-LESSONS-GATES %s %s" % (gate, "ok" if n == 0 else "%d finding(s)" % n))
    return 1 if f.items else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
