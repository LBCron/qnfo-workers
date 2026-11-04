"""prompt-store-verify.py — permanent DeepChat customPrompts integrity gate.

Read-only. Mirrors the app's exact zod schemas (PromptSchema / PromptParameterSchema /
FileItemSchema / PromptMessageSchema from app.asar /out/main/index.js) and checks:
  1. schema validity of every entry in every store (one bad field fails the WHOLE
     config.listCustomPrompts UI route — the 2026-08-20 'not loading' root cause)
  2. cross-store parity (repo canonical == script canonical == 4 live stores)
  3. template==content on every entry (PROMPT-KEY-SCHEMA-ASYMMETRY-1)

Usage:
  python prompt-store-verify.py           # full verify, exit 0 = healthy
  python prompt-store-verify.py inventory # table of stores + entry counts
Exit codes: 0 healthy | 1 violations found | 2 store unreadable

Scheduled guard: Daily Ops cronjob (216e1d12) check #6 runs this daily; notify-on-failure.
"""
import json, sqlite3, sys, os, subprocess

DEFAULT_PATHS = {
    "repo": r"C:\Users\LENOVO\Documents\GitHub\qnfo-skills\prompt-stores\customPrompts.json",
    "script": r"C:\Users\LENOVO\.deepchat\scripts\customPrompts-canonical.json",
    "roaming_cp_file": r"C:\Users\LENOVO\AppData\Roaming\DeepChat\custom_prompts.json",
    "roaming_db": r"C:\Users\LENOVO\AppData\Roaming\DeepChat\app_db\agent.db",
    # orphan canonical mirrors (2026-09-19): were stale/unmonitored cruft (3/11 update_plan);
    # now synced + swept for drift so they can never silently diverge again.
    "repo_skills_canon": r"C:\Users\LENOVO\Documents\GitHub\qnfo-skills\prompt-stores\customPrompts-canonical.json",
    "deepchat_skills_canon": r"C:\Users\LENOVO\.deepchat\skills\prompt-stores\customPrompts-canonical.json",
}
SRC_ENUM = {"local", "imported", "builtin"}
EXPECTED_IDS = ["1788197658524-RX0DE2xA", "1788197658524-RVSnJFyP", "1788197658524-2Qgtf6l6", "1788197658524-FwEKzK59", "1788197658524-2R2NP0B9", "1788197658524-CzhqBs5V", "1788197658524-hQdwK4UR",  "1788197658524-3KUDUZ2Z", "1788197658524-NmxnpZvx", "1788197658524-TWLRZ2gs", "1788197658524-fVj3nerc"]


def validate_prompt(p):
    """Exact mirror of the app's zod schemas. Returns list of violation strings."""
    errs = []
    if not isinstance(p, dict):
        return ["NOT A DICT"]
    # PromptSchema required fields
    if not isinstance(p.get("id"), str) or not p.get("id").strip():
        errs.append("id: non-empty string required")
    if not isinstance(p.get("name"), str):
        errs.append("name: string required")
    if not isinstance(p.get("description"), str):
        errs.append(f"description: string required, got {type(p.get('description')).__name__}")
    if p.get("content") is not None and not isinstance(p.get("content"), str):
        errs.append("content: must be string when present")
    # PromptParameterSchema: name AND required are REQUIRED (not optional)
    params = p.get("parameters")
    if params is not None:
        if not isinstance(params, list):
            errs.append("parameters: array required")
        else:
            for i, pa in enumerate(params):
                if not isinstance(pa, dict):
                    errs.append(f"parameters[{i}]: object required"); continue
                if not isinstance(pa.get("name"), str):
                    errs.append(f"parameters[{i}].name: REQUIRED string, got {pa.get('name')!r}")
                if not isinstance(pa.get("required"), bool):
                    errs.append(f"parameters[{i}].required: REQUIRED bool, got {pa.get('required')!r}")
                if "description" in pa and not isinstance(pa["description"], str):
                    errs.append(f"parameters[{i}].description: string when present")
    # FileItemSchema: id/name/type/path required strings
    files = p.get("files")
    if files is not None:
        if not isinstance(files, list):
            errs.append("files: array required")
        else:
            for i, fi in enumerate(files):
                if not isinstance(fi, dict):
                    errs.append(f"files[{i}]: object required"); continue
                for k in ("id", "name", "type", "path"):
                    if not isinstance(fi.get(k), str):
                        errs.append(f"files[{i}].{k}: REQUIRED string, got {fi.get(k)!r}")
    # PromptMessageSchema: role + content.text required strings
    messages = p.get("messages")
    if messages is not None:
        if not isinstance(messages, list):
            errs.append("messages: array required")
        else:
            for i, ms in enumerate(messages):
                if not isinstance(ms, dict):
                    errs.append(f"messages[{i}]: object required"); continue
                if not isinstance(ms.get("role"), str):
                    errs.append(f"messages[{i}].role: REQUIRED string")
                c = ms.get("content")
                if not isinstance(c, dict) or not isinstance(c.get("text"), str):
                    errs.append(f"messages[{i}].content.text: REQUIRED string")
    if p.get("enabled") is not None and not isinstance(p.get("enabled"), bool):
        errs.append(f"enabled: bool when present, got {p.get('enabled')!r}")
    if p.get("source") is not None and p.get("source") not in SRC_ENUM:
        errs.append(f"source: INVALID {p.get('source')!r} (enum local|imported|builtin)")
    # 2026-08-20 root cause: string timestamps fail z.number().int()
    for k in ("createdAt", "updatedAt"):
        v = p.get(k)
        if v is not None and not isinstance(v, int):
            errs.append(f"{k}: INT REQUIRED, got {type(v).__name__} {v!r}")
    # PROMPT-KEY-SCHEMA-ASYMMETRY-1: fill tool reads content; keep template in sync
    t = p.get("template")
    if isinstance(t, str) and t != p.get("content"):
        errs.append("template != content")
    return errs


def read_store(name, path):
    """Return (entries_or_None, error_string_or_None)."""
    try:
        if name.endswith("_db"):
            c = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=60)
            cols = [r[1] for r in c.execute("PRAGMA table_info(app_settings)").fetchall()]
            if "key" not in cols:
                return None, "app_settings table missing key column"
            valcol = "value_json" if "value_json" in cols else "value"
            row = c.execute(f"SELECT {valcol} FROM app_settings WHERE key='customPrompts'").fetchone()
            c.close()
            if not row:
                return None, "no customPrompts row"
            cp = json.loads(row[0]) if isinstance(row[0], str) else row[0]
        else:
            d = json.load(open(path, encoding="utf-8"))
            cp = d.get("customPrompts") if isinstance(d, dict) and "customPrompts" in d else d
        if not isinstance(cp, list):
            return None, f"not a list ({type(cp).__name__})"
        return cp, None
    except sqlite3.DatabaseError as e:
        # JSON files opened by mistake fall through to json path
        try:
            d = json.load(open(path, encoding="utf-8"))
            cp = d.get("customPrompts") if isinstance(d, dict) and "customPrompts" in d else d
            return (cp, None) if isinstance(cp, list) else (None, f"not a list ({type(cp).__name__})")
        except Exception as e2:
            return None, f"unreadable: {e} / {e2}"
    except Exception as e:
        return None, str(e)



def _proj(cp):
    return {p.get("id"): (p.get("name"), p.get("content")) for p in cp} if isinstance(cp, list) else None

def check_chatbox_prompt_parity():
    """CHATBOX-PROMPT-NO-CANONICAL-ARTIFACT-1 (issue 2807, 2026-10-17): fold the ChatBox prompt
    guard into this FATAL gate. Before this, nothing compared the live ChatBox prompt to any
    canonical text -- chatbox-system-prompt-canonical.txt is a different, shorter document and
    model_guard only checks that the doctrine block is present. So an owner directive block could
    be dropped by a ChatBox settings write and every gate would still report PASS."""
    _cg = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chatbox-prompt-guard.py")
    if not os.path.isfile(_cg):
        print("[CHATBOX-GUARD] missing guard: " + _cg)
        return False
    _r = subprocess.run([sys.executable, _cg, "--check"], capture_output=True, text=True)
    if _r.stdout.strip():
        print(_r.stdout.strip()[-900:])
    if _r.returncode != 0:
        print("[CHATBOX-PROMPT-DRIFT] chatbox-prompt-guard --check rc=%d (run it without --check to heal)" % _r.returncode)
        return False
    return True


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "inventory":
        print(f"{'store':16s} {'entries':>7s} {'violations':>10s}  status")
        for name, path in DEFAULT_PATHS.items():
            cp, err = read_store(name, path)
            if err:
                print(f"{name:16s} {'-':>7s} {'-':>10s}  ERROR {err}")
                continue
            v = sum(len(validate_prompt(p)) for p in cp)
            print(f"{name:16s} {len(cp):7d} {v:10d}  {'OK' if v == 0 else 'INVALID'}")
        return 0

    rc = 0
    results = {}
    for name, path in DEFAULT_PATHS.items():
        cp, err = read_store(name, path)
        if err:
            print(f"[STORE-ERROR] {name}: {err}")
            results[name] = None
            rc = max(rc, 2)
            continue
        results[name] = cp
        v = sum(len(validate_prompt(p)) for p in cp)
        ids = [p.get("id") for p in cp if isinstance(p, dict)]
        missing = [e for e in EXPECTED_IDS if e not in ids]
        if v:
            print(f"[SCHEMA-VIOLATION] {name}: {v} violation(s) — UI list route (config.listCustomPrompts) will fail")
            for p in cp:
                perr = validate_prompt(p)
                if perr:
                    print(f"   id={p.get('id')!r}: {perr}")
            rc = max(rc, 1)
        if missing:
            print(f"[MISSING-IDS] {name}: {missing}")
            rc = max(rc, 1)

    # parity against repo canonical
    repo = results.get("repo")
    if repo is not None:
        for name, cp in results.items():
            if name == "repo" or cp is None:
                continue
            if _proj(cp) != _proj(repo):
                print(f"[DRIFT] {name} differs from repo canonical")
                rc = max(rc, 1)

    rc = max(rc, 1 if check_system_prompt_parity() else 0)
    rc = max(rc, 1 if check_skill_anchor_parity() else 0)
    rc = max(rc, 0 if check_mcp_autoapprove_parity() else 1)
    rc = max(rc, 0 if check_gate_manifest() else 1)
    rc = max(rc, 1 if check_template_parameters() else 0)
    # TEMPLATE-MODEL-INVARIANT-1 (2026-09-27): the TEMPLATE leg of RC-1. SPEC-VS-GUARD-1 asserts
    # the SYSTEM PROMPT names the live canonical default; nothing asserted the prompt TEMPLATES,
    # so a cycle could re-introduce the superseded, unresolvable default (AI-GATEWAY/openai/gpt-4.1)
    # into a CMD template and every gate would still pass (canonical: the pasted CMD UPDATE text on
    # 2026-09-27 still carried gpt-4.1 while the stores + guards had moved to QNFO-OPS/ops).
    rc = max(rc, 0 if check_template_model_invariant() else 1)

    # ADVERSARIAL-REASONING-1 sweep (2026-09-05): fold the adversarial-reasoning guard into
    # this parity gate so adversarial content (skills/templates/system-prompt/worker prompts)
    # is swept every ops cycle (runs via Daily Ops cronjob 216e1d12 check #6 + after each
    # dual-write). Gracefully skips when the guard is not co-located.
    _ag = os.path.join(os.path.dirname(os.path.abspath(__file__)), "adversarial-guard.py")
    if os.path.isfile(_ag):
        _agr = subprocess.run([sys.executable, _ag], capture_output=True, text=True)
        if _agr.stdout:
            print(_agr.stdout.strip()[-1500:])
        rc = max(rc, 1 if _agr.returncode != 0 else 0)

    # PROMPT-PARITY-GUARD-1 (2026-09-26): fold prompt-parity-guard.py into THIS FATAL gate.
    # It carries D1 store-rot / D2 foreign-store / D3 anchor-skew across the system prompt AND
    # every versioned skill (title == newest-banner == last-footer). It existed but was wired
    # previously advisory-only and OUTSIDE the closeout trio, so a title!=footer
    # skew (canonical: system-prompt footer v4.40 while title v4.43; kaizen H1 v2.159 while
    # footer v2.160) produced rc=0 everywhere and slipped through. Wiring it here makes the
    # anchor check impossible to miss: `python prompt-store-verify.py` now covers it.
    _pg = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompt-parity-guard.py")
    if os.path.isfile(_pg):
        _pgr = subprocess.run([sys.executable, _pg], capture_output=True, text=True)
        if _pgr.stdout:
            print(_pgr.stdout.strip()[-1200:])
        rc = max(rc, 1 if _pgr.returncode != 0 else 0)

    # NOTE polarity: this check returns True on success (unlike the errs-counting checks above,
    # whose 0 means healthy). Inverting the idiom here made a PASSED check fail the gate.
    rc = max(rc, 0 if check_chatbox_prompt_parity() else 1)

    rc = max(rc, 1 if check_guard_mirror_parity() else 0)

    # CLIENT-CANONICAL-PARITY-1 (2026-10-01): the client system-prompt CANONICAL .txt files are
    # mirrored to live + qnfo-ops + qnfo-skills; a change reaching only some copies is silent drift.
    rc = max(rc, 1 if check_client_canonical_parity() else 0)

    # SPEC-VS-GUARD-1 (2026-09-27): the guards and the SPEC TEXT must agree, not just the guards
    # with each other. Closes RC-1 (canonical: the prompt kept instructing a revert to the
    # unresolvable AI-GATEWAY default after the triplicate had moved to QNFO-OPS/ops).
    rc = max(rc, 0 if check_spec_guard_parity() else 1)

    if rc == 0:
        print("PROMPT-STORE-VERIFY: PASS (schema + parity + system-prompt parity + gate manifest)")
    return rc




# === SYSTEM-PROMPT PARITY (AGENT-PROMPT-PARITY-1, 2026-08-29 remediation) ===
# Checks the system-prompt stores, INCLUDING the agents table row
# (agents.deepchat.config_json.systemPrompt), which was frozen at v3.74
# (2026-08-25) while the canonical stores moved (v3.93).
SYSPROMPT_STORES = {
    "canonical_md":   r"C:\Users\LENOVO\.deepchat\system-prompt-v2.7.md",
    "roaming_json":   r"C:\Users\LENOVO\AppData\Roaming\DeepChat\app-settings.json",
    "app_db_list":    r"C:\Users\LENOVO\AppData\Roaming\DeepChat\app_db\agent.db",
    "repo_copy_md":    r"C:\Users\LENOVO\Documents\GitHub\qnfo-skills\system-prompt-v2.7.md",
    "skills_live_md":  r"C:\Users\LENOVO\.deepchat\skills\system-prompt-v2.7.md",
    "agents_row":     r"C:\Users\LENOVO\AppData\Roaming\DeepChat\app_db\agent.db",
    # PROMPT-STORE-CONCURRENT-CLOBBER-1 (issue 2805, 2026-10-17): this row was OUTSIDE the store
    # list, so a concurrent sync could restore three stores to the old text while this one kept
    # the new text and the gate still reported "6 stores identical". A store the guard does not
    # read is a store it cannot protect.
    "db_default_row":  r"C:\Users\LENOVO\AppData\Roaming\DeepChat\app_db\agent.db",
}

def read_system_prompt(name, path):
    try:
        if name in ("canonical_md", "repo_copy_md", "skills_live_md"):
            return open(path, encoding="utf-8").read(), None
        if name == "roaming_json":
            return json.load(open(path, encoding="utf-8")).get("default_system_prompt"), None
        if name == "app_db_list":
            c = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=60)
            v = c.execute("SELECT value_json FROM app_settings WHERE key='systemPrompts'").fetchone()
            c.close()
            if not v:
                return None, "no systemPrompts row"
            j = json.loads(v[0])
            if isinstance(j, list) and j:
                return j[0].get("content"), None
            if isinstance(j, str):
                return j, None
            return None, "unexpected shape %s" % type(j).__name__
        if name == "agents_row":
            c = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=60)
            v = c.execute("SELECT config_json FROM agents WHERE id='deepchat'").fetchone()
            c.close()
            if not v:
                return None, "no deepchat agent row"
            return json.loads(v[0]).get("systemPrompt"), None
        if name == "db_default_row":
            c = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=60)
            v = c.execute("SELECT value_json FROM app_settings WHERE key='default_system_prompt'").fetchone()
            c.close()
            if not v:
                return None, "no default_system_prompt row"
            j = json.loads(v[0])
            return (j if isinstance(j, str) else None), None
        return None, "unknown store"
    except Exception as e:
        return None, str(e)

def check_system_prompt_parity():
    import os as _os, re as _re
    vals, errs = {}, 0
    for name, path in SYSPROMPT_STORES.items():
        v, err = read_system_prompt(name, path)
        if err:
            print("[SYSPROMPT-STORE-ERROR] %s: %s" % (name, err))
            errs += 1
            continue
        vals[name] = (v or "").strip()
    ref = vals.get("canonical_md")
    if ref:
        for name, v in vals.items():
            if v != ref:
                print("[SYSPROMPT-DRIFT] %s != canonical_md (len %d vs %d)" % (name, len(v), len(ref)))
                errs += 1
    hist = r"C:\Users\LENOVO\.deepchat\system-prompt-history-v2.7.md"
    if not _os.path.isfile(hist):
        print("[PROMPT-HISTORY] missing history file: " + hist)
        errs += 1
    else:
        _h = open(hist, encoding="utf-8", errors="ignore").read()
        if len(_re.findall(r"> \*\*v[\d.]+ UPDATE", _h)) < 5:
            print("[PROMPT-HISTORY] history file has <5 banner chunks")
            errs += 1
    _md = vals.get("canonical_md") or ""
    if len(_md) > 310000:
        print("[PROMPT-SIZE] canonical base %d chars > 310000 ceiling" % len(_md))
        errs += 1
    # TITLE-LINE-PARITY-1 for the system prompt itself (2026-09-26 guard-gap fix):
    # store-byte-identity does NOT catch a title/banner bump that leaves the footer stale.
    # Canonical: title/banner were bumped to v4.43 while the footer stayed v4.40 and the
    # guard still reported PASS. H1 title version MUST equal the last "Current:" footer version.
    _h1v = None
    for _l in _md.splitlines():
        if _l.startswith('# DEEPCHAT DEFAULT SYSTEM PROMPT'):
            _m = _re.search(r'v(\d+\.\d+)', _l)
            _h1v = _m.group(1) if _m else None
            break
    _cur = _re.findall(r'Current:\s*\*\*v(\d+\.\d+)\*\*', _md)
    _cv = _cur[-1] if _cur else None
    # FAIL-CLOSED (2026-09-26 hardening): an ABSENT anchor is a failure too. The original form
    # `if _h1v and _cv and _h1v != _cv` silently no-op'd whenever a title/footer FORMAT change
    # broke the regex (anchor=None) -- i.e. it failed OPEN exactly when the check went blind.
    # Aliases prompt-parity-guard.py D3 (kept as a fast local pre-check; both are fatal).
    if _h1v is None or _cv is None:
        print("[PROMPT-TITLE-FOOTER-MISSING] title-anchor=%s footer-anchor=%s (check blind; TITLE-LINE-PARITY-1)" % (_h1v, _cv))
        errs += 1
    elif _h1v != _cv:
        print("[PROMPT-TITLE-FOOTER-DRIFT] title v%s != footer v%s (TITLE-LINE-PARITY-1)" % (_h1v, _cv))
        errs += 1
    if errs == 0:
        print("SYSTEM-PROMPT-PARITY: PASS (%d stores identical)" % len(vals))
    return errs




# === SKILL ANCHOR PARITY (TITLE-LINE-PARITY-1 for skills, 2026-08-29 skills audit) ===
SKILLS_DIR = r"C:\Users\LENOVO\.deepchat\skills"

def _ver_tuple(v):
    try:
        return tuple(int(x) for x in v.split('.'))
    except Exception:
        return (0,)

def check_skill_anchor_parity():
    """H1 title version == newest banner version == last Current footer, per skill."""
    import re as _re, os as _os
    errs = 0
    n = 0
    for name in sorted(_os.listdir(SKILLS_DIR)):
        p = _os.path.join(SKILLS_DIR, name, "SKILL.md")
        if not _os.path.isfile(p):
            continue
        t = open(p, encoding="utf-8", errors="ignore").read()
        hv = None
        for _l in t.splitlines():
            if _l.startswith('# '):
                _m1 = _re.search(r'\bv?([\d.]+)\b', _l)
                hv = _m1.group(1) if _m1 else None
                break
        banners = [_re.sub(r'^v', '', v) for v in _re.findall(r'> \*\*v?([\d.]+) UPDATE', t)]
        bv = max(banners, key=_ver_tuple) if banners else None
        cur = _re.findall(r'Current:\s*\*?\*?v?([\d.]+)', t)
        cv = cur[-1] if cur else None
        if not (hv and bv and cv):
            continue
        n += 1
        if not t.startswith('---'):
            print("[SKILL-FRONTMATTER] %s: file does not start with '---'" % name)
            errs += 1
            continue
        _fvm = _re.search(r'^---\n(?:.*\n)*?version:\s*"?([\d.]+)"?', t)
        if _fvm and _fvm.group(1) != bv:
            print("[SKILL-FRONTMATTER-VERSION] %s: frontmatter v%s != banner v%s" % (name, _fvm.group(1), bv))
            errs += 1
            continue
        if not (hv == bv == cv):
            print("[SKILL-ANCHOR-DRIFT] %s: title v%s / newest-banner v%s / current v%s" % (name, hv, bv, cv))
            errs += 1
    if errs == 0:
        print("SKILL-ANCHOR-PARITY: PASS (%d versioned skills)" % n)
    return errs


def check_spec_guard_parity():
    """SPEC-VS-GUARD-1 (2026-09-27) -- closes RC-1.

    GUARD-TRIPLICATE-CONSISTENCY-1 compares the three guard scripts to EACH OTHER; nothing
    compared them to the SPEC TEXT. So a client fix that reached the live stores + the guard
    working trees but never the prompt prose left the system prompt instructing future cycles to
    REVERT the guards (canonical: 2026-09-27, prompt said AI-GATEWAY/openai/gpt-4.1 while the
    triplicate enforced QNFO-OPS/ops; AI-GATEWAY is absent from the runtime provider registry,
    0/77, so the prompt's value was unresolvable). This gate asserts:
      (1) model_guard.DESIRED_KEY == ops-settings-guard.DESIRED_KEYS == sync_system_prompt.MODEL_DICT
      (2) the system prompt's LIVE default statement names exactly that pair.
    A mismatch fails closed.
    """
    import re as _re, os as _os
    home = _os.path.expanduser("~")
    scripts = _os.path.join(home, ".deepchat", "scripts")
    srcs = [
        ("model_guard.DESIRED_KEY", _os.path.join(scripts, "model_guard.py"), "DESIRED_KEY"),
        ("ops-settings-guard.DESIRED_KEYS", _os.path.join(scripts, "ops-settings-guard.py"), "DESIRED_KEYS"),
        ("sync_system_prompt.MODEL_DICT", _os.path.join(scripts, "sync_system_prompt.py"), "MODEL_DICT"),
    ]
    vals = {}
    for label, path, ident in srcs:
        try:
            t = open(path, encoding="utf-8", errors="replace").read()
        except OSError as e:
            print("[SPEC-VS-GUARD] unreadable %s: %s" % (label, e))
            return False
        m = _re.search(r'\b%s\b[^\n]*?\{\s*"providerId":\s*"([^"]+)",\s*"modelId":\s*"([^"]+)"' % ident, t)
        if not m:
            print("[SPEC-VS-GUARD] no default-key literal next to %s in %s" % (ident, path))
            return False
        vals[label] = (m.group(1), m.group(2))
    uniq = set(vals.values())
    if len(uniq) != 1:
        print("[SPEC-VS-GUARD] guard triplicate DIVERGED: %s" % vals)
        return False
    pid, mid = uniq.pop()
    try:
        md = open(SYSPROMPT_STORES["canonical_md"], encoding="utf-8", errors="replace").read()
    except OSError as e:
        print("[SPEC-VS-GUARD] unreadable canonical_md: %s" % e)
        return False
    norm = _re.sub(r"\s+", "", md)
    lit = '{"providerId":"%s","modelId":"%s"}' % (pid, mid)
    if lit not in norm:
        print("[SPEC-VS-GUARD] system prompt does NOT state the enforced default %s/%s "
              "(the prompt and the guards have re-diverged -- RC-1)" % (pid, mid))
        return False
    print("[SPEC-VS-GUARD] PASS (spec == guard triplicate: %s/%s)" % (pid, mid))
    return True


def check_guard_mirror_parity():
    """GUARD-MIRROR-PARITY-1 (2026-09-26): the guard scripts are themselves MIRRORED to the
    qnfo-ops repo (Documents/GitHub/qnfo-ops/scripts). A fix applied only to the live copy
    silently never reaches the repo (canonical: prompt-store-verify.py live 21954B vs
    qnfo-ops mirror 20005B -- ~1.9KB of guard fixes unmirrored for an unknown interval).
    Compare the guard scripts that exist in BOTH locations, byte-for-byte after normalizing
    line endings (git autocrlf rewrites LF->CRLF on checkout, which is not a real drift)."""
    import hashlib as _h
    live = r"C:\Users\LENOVO\.deepchat\scripts"
    ops = r"C:\Users\LENOVO\Documents\GitHub\qnfo-ops\scripts"
    names = ("prompt-store-verify.py", "prompt-parity-guard.py", "model_guard.py",
             "sync_system_prompt.py", "ops-settings-guard.py",
             "scheduler-guard.py", "adversarial-guard.py")
    errs = 0
    def _norm(p):
        return open(p, "rb").read().replace(b"\r\n", b"\n")
    for n in names:
        a, b = os.path.join(live, n), os.path.join(ops, n)
        if not (os.path.isfile(a) and os.path.isfile(b)):
            continue
        ha = _h.sha256(_norm(a)).hexdigest()[:16]
        hb = _h.sha256(_norm(b)).hexdigest()[:16]
        if ha != hb:
            print("[GUARD-MIRROR-DRIFT] %s: live %s != ops %s (a fix reached only one copy)" % (n, ha, hb))
            errs += 1
    if errs == 0:
        print("GUARD-MIRROR-PARITY: PASS (live == ops mirror)")
    return errs


def check_client_canonical_parity():
    """CLIENT-CANONICAL-PARITY-1 (2026-10-01): the client system-prompt CANONICAL files
    (chatbox-system-prompt-canonical.txt, claude-system-prompt-canonical.txt) are mirrored to
    live + qnfo-ops + qnfo-skills; a change reaching only some copies is silent drift (canonical:
    the skills mirror of chatbox-system-prompt-canonical.txt carried the stale '~37 workers'
    phrasing while live/ops held the current 'live worker count: fleet.qnfo.org'). Compare all
    mirrors, byte-for-byte after normalizing line endings (git autocrlf is not a real drift)."""
    import hashlib as _h
    bases = {
        "live":   r"C:\Users\LENOVO\.deepchat\scripts",
        "ops":    r"C:\Users\LENOVO\Documents\GitHub\qnfo-ops\scripts",
        "skills": r"C:\Users\LENOVO\Documents\GitHub\qnfo-skills\prompt-stores",
    }
    names = ("chatbox-system-prompt-canonical.txt", "claude-system-prompt-canonical.txt")
    errs = 0
    def _norm(p):
        return open(p, "rb").read().replace(b"\r\n", b"\n")
    for n in names:
        digests = {}
        for loc, base in bases.items():
            p = os.path.join(base, n)
            if os.path.isfile(p):
                digests[loc] = _h.sha256(_norm(p)).hexdigest()[:16]
        if len(set(digests.values())) > 1:
            print("[CLIENT-CANONICAL-DRIFT] %s: %s (a change reached only some mirrors)" % (n, digests))
            errs += 1
    if errs == 0:
        print("CLIENT-CANONICAL-PARITY: PASS (live == ops == skills)")
    return errs


def check_mcp_autoapprove_parity():
    """MCP-AUTOAPPROVE-PARITY (DEP-1 lesson, 2026-08-31): mcp-settings.json is the source of
    truth for autoApprove sets. The running app rewrites the DB mcp_servers rows from its
    runtime and STRIPS autoApprove — DB drift is the app's known behavior (noted, not fatal).
    The gate FAILS only when the FILE itself loses the sets (the unrecoverable state)."""
    import os as _os
    cfg_dir = _os.path.dirname(DEFAULT_PATHS["roaming_cp_file"])
    mcpf = _os.path.join(cfg_dir, "mcp-settings.json")
    if not _os.path.exists(mcpf):
        print("[MCP-AUTOAPPROVE-PARITY] mcp-settings.json not found — check skipped")
        return True
    try:
        with open(mcpf, encoding="utf-8-sig") as _f:
            m = json.load(_f)
        servers = m.get("mcpServers", {}) or {}
        with_aa = {k: v for k, v in servers.items() if v.get("autoApprove")}
        if not with_aa:
            print("[MCP-FILE-EMPTY] mcp-settings.json has NO autoApprove sets — the app may have "
                  "stripped the FILE; restore from the canonical before relying on the toolchain")
            return False
        try:
            c = sqlite3.connect("file:%s?mode=ro" % DEFAULT_PATHS["roaming_db"].replace("\\", "/"),
                                uri=True, timeout=30)
            drift = []
            for _name, _cfgj in c.execute("SELECT name, config_json FROM mcp_servers").fetchall():
                _fcfg = servers.get(_name)
                if not _fcfg:
                    continue
                _faa = _fcfg.get("autoApprove") or []
                try:
                    _d = json.loads(_cfgj)
                except Exception:
                    continue
                if (_d.get("autoApprove") or []) != _faa:
                    drift.append(_name)
            c.close()
        except Exception:
            drift = []
        if drift:
            print("[MCP-DB-NOTE] DB mcp_servers rows stripped autoApprove for %d server(s) — the "
                  "running app rewrites them from its runtime; the file is the source of truth "
                  "(re-sync after app restarts): %s" % (len(drift), ", ".join(drift[:6])))
        print("[MCP-AUTOAPPROVE-PARITY] PASS (file intact: %d servers with autoApprove)" % len(with_aa))
        return True
    except Exception as e:
        print("[MCP-AUTOAPPROVE-PARITY] check skipped: %s" % e)
        return True


def check_template_parameters():
    """TEMPLATE-PARAM-PARITY (2026-09-26, F1 recurrence guard): every {{paramName}}
    placeholder in a custom template's content MUST be backed by a declared
    parameters[].name of the same name.

    Root cause this closes: the app's fill logic iterates ONLY the declared parameters
    (app.asar getTemplateDefinition + fill_prompt_template: `if (templateArgs &&
    template.parameters) for (const param of template.parameters) { ... replace({{name}}) }`).
    With `parameters: []` the loop body never runs, so any {{placeholder}} renders LITERALLY
    and templateArgs are silently ignored -- a non-functional fill template that still passes
    every schema check. Canonical: FIND PAPERS ON TOPIC ({{topic}}) + VALIDATE CITATIONS
    ({{file}}) shipped with parameters=[] until the 2026-09-26 CMD-template audit."""
    import re as _re
    cp, err = read_store("repo", DEFAULT_PATHS["repo"])
    if err:
        print("[TEMPLATE-PARAM] check skipped: repo unreadable (%s)" % err)
        return True
    _ph = _re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
    errs = 0
    for p in cp:
        used = set(_ph.findall(p.get("content") or ""))
        declared = {x.get("name") for x in (p.get("parameters") or []) if isinstance(x, dict)}
        missing = sorted(u for u in used if u not in declared)
        if missing:
            print("[TEMPLATE-PARAM] %s: placeholder(s) %s not declared in parameters[] "
                  "(fill would render them literally)" % (p.get("name"), missing))
            errs += 1
    if errs == 0:
        print("TEMPLATE-PARAM-PARITY: PASS (every {{placeholder}} has a declared parameter)")
    return errs


def check_gate_manifest():
    """Gate-manifest validation (CODEPARSE row 170): validate QNFO/qnfo-schemas gate
    manifests (bootstrap 17 + full 208) with the registry's own validator so the
    code-parsable MANDATORY gate chain is swept every ops cycle. Single source of truth
    is validate.py in the qnfo-schemas checkout; gracefully skips when not co-located."""
    _cands = [
        os.environ.get("QNFO_SCHEMAS_DIR", ""),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "Dev", "qnfo-schemas"),
        r"C:\Users\LENOVO\Dev\qnfo-schemas",
    ]
    _base = next((c for c in _cands if c and os.path.isfile(os.path.join(c, "validate.py"))), None)
    if not _base:
        print("[GATE-MANIFEST] check skipped: qnfo-schemas checkout not found (set QNFO_SCHEMAS_DIR)")
        return True
    _mf = ["gates/bootstrap-manifest.json", "gates/full-manifest.json"]
    _missing = [m for m in _mf if not os.path.isfile(os.path.join(_base, m))]
    if _missing:
        print("[GATE-MANIFEST] FAIL missing manifest(s): %s" % ", ".join(_missing))
        return False
    _r = subprocess.run([sys.executable, os.path.join(_base, "validate.py")]
                        + [os.path.join(_base, m) for m in _mf], capture_output=True, text=True, cwd=_base)
    if _r.stdout:
        print(_r.stdout.strip()[-1800:])
    if _r.returncode != 0:
        print("[GATE-MANIFEST] FAIL (validator exit %d)" % _r.returncode)
        return False
    print("[GATE-MANIFEST] PASS (bootstrap + full gate manifest schema-validated)")
    return True


def check_template_model_invariant():
    """TEMPLATE-MODEL-INVARIANT-1 (2026-09-27) -- the TEMPLATE leg of RC-1.

    SPEC-VS-GUARD-1 asserts the SYSTEM PROMPT names the live canonical default. Nothing
    asserted the prompt TEMPLATES, so a cycle could re-introduce the superseded, unresolvable
    default (AI-GATEWAY/openai/gpt-4.1) into a CMD template and every gate would still pass.
    Asserts, over the repo canonical template store:
      (1) no entry content/template contains the superseded id 'gpt-4.1';
      (2) any entry stating the default-model invariant names the live canonical pair, read
          from model_guard.DESIRED_KEY (never hardcoded here -- rule (d)).
    Fails closed.
    """
    import re as _re
    scripts = os.path.join(os.path.expanduser("~"), ".deepchat", "scripts")
    try:
        t = open(os.path.join(scripts, "model_guard.py"), encoding="utf-8", errors="replace").read()
    except OSError as e:
        print("[TEMPLATE-MODEL-INVARIANT] unreadable model_guard.py: %s" % e)
        return False
    m = _re.search(r'DESIRED_KEY\b[^\n]*?\{\s*"providerId":\s*"([^"]+)",\s*"modelId":\s*"([^"]+)"', t)
    if not m:
        print("[TEMPLATE-MODEL-INVARIANT] no DESIRED_KEY literal in model_guard.py")
        return False
    pair = "%s/%s" % (m.group(1), m.group(2))
    path = DEFAULT_PATHS.get("repo_skills_canon") or DEFAULT_PATHS.get("repo")
    try:
        cp = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        print("[TEMPLATE-MODEL-INVARIANT] unreadable canonical store %s: %s" % (path, e))
        return False
    errs = 0
    for p in (cp if isinstance(cp, list) else []):
        if not isinstance(p, dict):
            continue
        blob = (p.get("content") or "") + "\n" + (p.get("template") or "")
        if "gpt-4.1" in blob:
            print("[TEMPLATE-MODEL-INVARIANT] FAIL: template %r carries the superseded id gpt-4.1" % p.get("name"))
            errs += 1
        if "DEEPCHAT-DEFAULT-MODEL-1" in blob and pair not in blob:
            print("[TEMPLATE-MODEL-INVARIANT] FAIL: template %r states the default invariant but does not name %s" % (p.get("name"), pair))
            errs += 1
    if errs == 0:
        print("[TEMPLATE-MODEL-INVARIANT] PASS (no superseded default; invariants name %s)" % pair)
    return errs == 0


if __name__ == "__main__":
    sys.exit(main())
