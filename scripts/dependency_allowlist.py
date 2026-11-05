#!/usr/bin/env python3
"""dependency_allowlist.py -- BP26-AGENT-CHANGE-GATES-1 (roadmap row 1414, agent_issues 1000358; charter pillar autonomy, OWASP Agentic ASI04 supply chain).

WHY   The catalogue (docs/BEST-PRACTICES-2026.md section 3.2) lists the gates agent-authored code must pass before it merges: typecheck, unit suites, wrangler types
      freshness, migration dry-run, secret scan, a dependency allow-list and a diff-size cap. Every gate but the dependency allow-list existed (deploy-gate,
      pr_fast_guards, apply_migrations --check, bp26_repo.py secret scan). A pull request written by an agent could add `"left-pad": "^1"` or an unpinned
      `pip install something` to a workflow and nothing would say so.
WHAT  A third-party dependency is declared before it is used. Scanned: every tracked package.json (dependencies, devDependencies, optionalDependencies, peerDependencies),
      the npm lock files beside them, and the install commands of .github/workflows/*.yml. Hard rules (each a line `VIOLATION <rule> <file> <detail>`, no line numbers, so
      scripts/regression_gate.py can compare it with the base tree):
        dep-not-allowlisted        a package.json dependency with no line in scripts/dependency-allowlist.txt
        dep-non-registry           a dependency that is a git, URL, file or tarball spec (not a registry version)
        dep-install-script         preinstall / install / postinstall in a package.json (runs code at install time); allow with `<dir> | script:postinstall | reason`
        dep-no-lockfile            a package.json with dependencies and no lock file beside it
        dep-lock-foreign-registry  a lock file entry resolved from a host other than registry.npmjs.org
        workflow-unpinned-install  `pip install <pkg>` without ==version, `npm install <pkg>` or `npx <pkg>` without @version in a workflow; allow with
                                   `<workflow path> | pip:<pkg> | reason`
      The allow-list line is `<dir or workflow path> | <package or pip:<pkg> or npm:<pkg> or script:<name>> | <reason, at least 20 characters>`. A pull request may add its
      own line, so the gate does not stop a determined author; it makes the choice explicit (a reason, in a file the independent review of high-risk paths reads) and it blocks
      the accidental and the prompt-injected addition, which is the ASI04 case. A line for a package that is no longer used is reported as a notice, never a failure.
USAGE python3 scripts/dependency_allowlist.py [--root DIR] [--baseline] [--selftest]
      --baseline prints the allow-list lines for the current tree (how the file was first written). Exit 1 when any hard rule fires.
      pr_fast_guards.py runs it through regression_gate.py: a violation the base tree already has never holds an unrelated pull request.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ALLOW_REL = "scripts/dependency-allowlist.txt"
SECTIONS = ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies")
INSTALL_SCRIPTS = ("preinstall", "install", "postinstall")
LOCKS = ("package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock")
NON_REGISTRY = re.compile(r"^(git\+|git:|git@|https?:|file:|link:|github:|gitlab:|bitbucket:|workspace:|[\w.-]+/[\w.-]+(#.*)?$)", re.I)
MIN_REASON = 20


def tracked(root, pattern_end):
    """Tracked files whose path ends with pattern_end (git ls-files; the walk of the checkout when git is absent)."""
    try:
        p = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, text=True, errors="replace", timeout=60)
        if p.returncode == 0:
            return sorted(f for f in p.stdout.split("\0") if f and f.endswith(pattern_end))
    except Exception:  # noqa: BLE001
        pass
    out = []
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in (".git", "node_modules")]
        for f in files:
            if f.endswith(pattern_end):
                out.append(os.path.relpath(os.path.join(d, f), root).replace(os.sep, "/"))
    return sorted(out)


def parse_allow(text):
    """({(where, key)}, [problems]) from the allow-list text."""
    allowed, problems = set(), []
    for n, raw in enumerate((text or "").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|", 2)]
        if len(parts) != 3 or not parts[0] or not parts[1]:
            problems.append("%s:%d malformed line (want: where | package | reason)" % (ALLOW_REL, n))
            continue
        if len(parts[2]) < MIN_REASON:
            problems.append("%s:%d reason shorter than %d characters" % (ALLOW_REL, n, MIN_REASON))
            continue
        allowed.add((parts[0], parts[1]))
    return allowed, problems


def read(root, rel):
    try:
        with open(os.path.join(root, rel), "rb") as f:
            return f.read(8 * 1024 * 1024).decode("utf-8", "replace")
    except OSError:
        return None


def package_findings(root, files):
    """[(rule, file, detail, allow key or None, where)] for the package.json files."""
    out, used = [], set()
    for rel in files:
        text = read(root, rel)
        if text is None:
            continue
        try:
            doc = json.loads(text)
        except ValueError:
            out.append(("dep-unreadable", rel, "package.json is not valid JSON", None, os.path.dirname(rel) or "."))
            continue
        where = os.path.dirname(rel) or "."
        deps = {}
        for sec in SECTIONS:
            for name, spec in (doc.get(sec) or {}).items():
                deps[name] = (sec, str(spec))
        for name, (sec, spec) in sorted(deps.items()):
            used.add((where, name))
            out.append(("dep-not-allowlisted", rel, "%s:%s" % (sec, name), name, where))
            if NON_REGISTRY.match(spec.strip()):
                out.append(("dep-non-registry", rel, "%s=%s" % (name, spec[:80]), name, where))
        for s in INSTALL_SCRIPTS:
            if (doc.get("scripts") or {}).get(s):
                used.add((where, "script:" + s))
                out.append(("dep-install-script", rel, s, "script:" + s, where))
        if deps and not any(os.path.exists(os.path.join(root, where, lk)) for lk in LOCKS):
            out.append(("dep-no-lockfile", rel, "no lock file beside the package.json", None, where))
        lock = read(root, (where + "/" if where != "." else "") + "package-lock.json")
        if lock:
            hosts = set(re.findall(r'"resolved":\s*"(?:https?|git\+[a-z]+)://([^/"]+)', lock))
            foreign = sorted(h for h in hosts if h != "registry.npmjs.org")
            if foreign:
                out.append(("dep-lock-foreign-registry", where + "/package-lock.json" if where != "." else "package-lock.json", ",".join(foreign)[:120], None, where))
    return out, used


PIP = re.compile(r"\bpip3?\s+install\b([^\n|&;]*)")
NPM = re.compile(r"\bnpm\s+(?:install|i)\b([^\n|&;]*)")
NPX = re.compile(r"\bnpx\b([^\n|&;]*)")


def _tokens(arg):
    toks = [t.strip("\"'") for t in arg.split() if t.strip("\"'")]
    return [t for t in toks if not re.match(r"^\d*[<>]", t)]   # a redirect (>/dev/null, 2>&1) is not a package


def workflow_findings(root, files):
    """[(rule, file, detail, allow key, where)] for install commands without a pinned version."""
    out = []
    for rel in files:
        text = read(root, rel)
        if text is None:
            continue
        for line in text.splitlines():
            if line.strip().startswith("#"):
                continue
            code = line.split(" #", 1)[0]
            m = PIP.search(code)
            if m:
                skip = False
                for t in _tokens(m.group(1)):
                    if t.startswith("-"):
                        skip = skip or t in ("-r", "--requirement", "-e", "--editable")
                        continue
                    if skip or t in (".", "..") or t.startswith(("./", "../", "/")) or "$" in t:
                        skip = False
                        continue
                    if not re.search(r"==\S", t):
                        out.append(("workflow-unpinned-install", rel, "pip:" + re.split(r"[<>=!~\[]", t)[0], "pip:" + re.split(r"[<>=!~\[]", t)[0], rel))
            m = NPM.search(code)
            if m:
                for t in _tokens(m.group(1)):
                    if t.startswith("-") or t in (".", "..") or t.startswith(("./", "../", "/")):
                        continue
                    if not re.search(r".@(\$|\d|latest\b)", t) or t.endswith("@latest"):
                        out.append(("workflow-unpinned-install", rel, "npm:" + t, "npm:" + t, rel))
            m = NPX.search(code)
            if m:
                for t in _tokens(m.group(1)):
                    if t.startswith("-"):
                        continue
                    if "$" in t or t.startswith(("./", "/")):
                        break
                    if not re.search(r".@(\$|\d)", t) and "@" not in t[1:]:
                        out.append(("workflow-unpinned-install", rel, "npm:" + t, "npm:" + t, rel))
                    break
    return out


def scan(root, allow_text=None):
    """(violation lines, notices). Pure over a checkout directory."""
    if allow_text is None:
        allow_text = read(root, ALLOW_REL) or ""
    allowed, problems = parse_allow(allow_text)
    pkg_files = tracked(root, "package.json")
    wf_files = [f for f in tracked(root, ".yml") if f.startswith(".github/workflows/")]
    found, used = package_findings(root, pkg_files)
    found += workflow_findings(root, wf_files)
    lines, seen = [], set()
    for rule, rel, detail, key, where in found:
        if rule in ("dep-not-allowlisted", "dep-install-script", "workflow-unpinned-install") and key and (where, key) in allowed:
            continue
        line = "VIOLATION %s %s %s" % (rule, rel, detail)
        if line not in seen:
            seen.add(line)
            lines.append(line)
    for p in problems:
        lines.append("VIOLATION allowlist-malformed " + p)
    notices = ["NOTICE stale allow-list entry (no longer used): %s | %s" % (w, k) for (w, k) in sorted(allowed) if (w, k) not in used and not k.startswith(("pip:", "npm:"))]
    return lines, notices


def baseline(root):
    found, _used = package_findings(root, tracked(root, "package.json"))
    found += workflow_findings(root, [f for f in tracked(root, ".yml") if f.startswith(".github/workflows/")])
    keys = sorted({(where, key) for rule, _r, _d, key, where in found if key and rule in ("dep-not-allowlisted", "dep-install-script", "workflow-unpinned-install")})
    return ["%s | %s | baseline when the dependency gate was introduced (RM-1414, 2026-11-05); present on main before it" % (w, k) for w, k in keys]


def main(argv):
    root = ROOT
    if "--root" in argv:
        root = os.path.abspath(argv[argv.index("--root") + 1])
    if "--baseline" in argv:
        print("\n".join(baseline(root)))
        return 0
    lines, notices = scan(root)
    for n in notices:
        print(n)
    for v in lines:
        print(v)
    print("dependency_allowlist: %d violation(s), %d notice(s)" % (len(lines), len(notices)))
    return 1 if lines else 0


# ---------------------------------------------------------------- selftest
def selftest():
    fails = []

    def ok(cond, m):
        if not cond:
            fails.append(m)
            print("FAIL " + m)

    def put(root, rel, text):
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
    with tempfile.TemporaryDirectory() as td:
        put(td, "app/package.json", json.dumps({"dependencies": {"zod": "^3.0.0"}, "devDependencies": {"esbuild": "0.25.0"}}))
        put(td, "app/package-lock.json", '{"packages": {"node_modules/zod": {"resolved": "https://registry.npmjs.org/zod/-/zod-3.0.0.tgz"}}}')
        put(td, ".github/workflows/a.yml", "jobs:\n  j:\n    steps:\n      - run: pip install --quiet pyyaml\n      - run: npm install --no-save pkg@1.2.3\n      - run: npx --yes wrangler@4 deploy\n")
        lines, _n = scan(td, "")
        ok(any("dep-not-allowlisted app/package.json dependencies:zod" in l for l in lines) and any("devDependencies:esbuild" in l for l in lines), "an undeclared dependency is a violation: %r" % lines)
        ok(any("workflow-unpinned-install .github/workflows/a.yml pip:pyyaml" in l for l in lines), "an unpinned pip install in a workflow is a violation: %r" % lines)
        ok(not any("pkg" in l or "wrangler" in l for l in lines), "a pinned npm install and a major-pinned npx are fine: %r" % lines)
        allow = ("app | zod | the schema library the agents bundle (RM-1414 selftest)\napp | esbuild | the bundler for the src build (RM-1414 selftest)\n"
                 ".github/workflows/a.yml | pip:pyyaml | the workflow lint needs it (RM-1414 selftest)\n")
        lines, notices = scan(td, allow)
        ok(lines == [], "declared dependencies and a declared workflow install pass: %r" % lines)
        lines, _n = scan(td, "app | zod | short\n")
        ok(any("allowlist-malformed" in l for l in lines), "a reason under %d characters is refused: %r" % (MIN_REASON, lines))
        # the hard rules
        put(td, "bad/package.json", json.dumps({"dependencies": {"evil": "github:someone/evil", "other": "https://example.com/x.tgz", "ok": "1.0.0"}, "scripts": {"postinstall": "node x.js"}}))
        lines, _n = scan(td, allow + "bad | evil | declared but still a git spec (selftest)\nbad | other | declared but still a URL spec (selftest)\nbad | ok | declared registry package (selftest)\n")
        ok(any("dep-non-registry bad/package.json evil=github:someone/evil" in l for l in lines) and any("other=https://example.com/x.tgz" in l for l in lines), "git and URL specs are violations even when declared: %r" % lines)
        ok(any("dep-install-script bad/package.json postinstall" in l for l in lines), "an install script is a violation: %r" % lines)
        ok(any("dep-no-lockfile bad/package.json" in l for l in lines), "no lock file is a violation: %r" % lines)
        put(td, "app/package-lock.json", '{"packages": {"node_modules/zod": {"resolved": "https://evil.example.net/zod-3.0.0.tgz"}}}')
        lines, _n = scan(td, allow)
        ok(any("dep-lock-foreign-registry app/package-lock.json evil.example.net" in l for l in lines), "a lock entry from another host is a violation: %r" % lines)
        # a stale line is a notice
        lines, notices = scan(td, allow + "gone | removed-pkg | package removed long ago (selftest)\n")
        ok(any("gone | removed-pkg" in n for n in notices), "a stale allow-list entry is a notice, not a failure: %r" % notices)
    live_lines, _n = scan(ROOT)
    ok(isinstance(live_lines, list), "the live tree scans")
    print("dependency_allowlist selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main(sys.argv[1:]))
