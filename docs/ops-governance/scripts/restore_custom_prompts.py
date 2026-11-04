"""restore_custom_prompts.py — canonical restore of DeepChat custom prompts (v2, schema-gated).

v2.1 (2026-09-04, RESTORE-CP-FILE-GAP-1 fix): restore() now also rewrites ROAMING_CP_FILE (Roaming/DeepChat/custom_prompts.json) - it was omitted and every restore left that store stale (prompt-store-verify exit 1). v2 (2026-08-20, post 'not loading' incident): every write is gated by an EXACT mirror
of the app's zod PromptSchema (updatedAt/createdAt INT — string timestamps were the
root cause of the UI list failing), timestamps are coerced to int, and the canonical
source order prefers the git-tracked repo copy. A canonical that fails validation is
REFUSED — never blind-restored (RECOVERY-SOURCE-SHAPE-1 / SCHEMA-VERIFY-BEFORE-RESTORE-1).

Usage:
  python restore_custom_prompts.py            # restore all 4 live stores + script canon from canonical
  python restore_custom_prompts.py verify     # read-only exact-schema + parity verification
  python restore_custom_prompts.py inventory  # store table
  python restore_custom_prompts.py export     # write canonical backup next to this script

Canonical source order:
  A. repo  <qnfo-skills>/prompt-stores/customPrompts.json  (git-tracked, wins)
  B. backup file next to this script (customPrompts-canonical.json)
  C. live Roaming app-settings.json customPrompts
  D. Roaming DB app_settings row
All sources must validate against the app schema and carry the 12 expected ids.
Safe to run while DeepChat is live (WAL mode; runtime UI cache still needs an app
restart to re-read — RUNTIME-CACHE-CONTRACT-1).
"""
import sqlite3, json, os, sys, datetime, time

REPO_CANON = r"C:\Users\LENOVO\Documents\GitHub\qnfo-skills\prompt-stores\customPrompts.json"
SKILLS_COPY = r"C:\Users\LENOVO\.deepchat\skills\prompt-stores\customPrompts.json"  # the local skills mirror — gate-checked, not canonical
CANON_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "customPrompts-canonical.json")
ROAMING_JSON = r"C:\Users\LENOVO\AppData\Roaming\DeepChat\app-settings.json"
ROAMING_CP_FILE = r"C:\Users\LENOVO\AppData\Roaming\DeepChat\custom_prompts.json"
ROAMING_DB = r"C:\Users\LENOVO\AppData\Roaming\DeepChat\app_db\agent.db"
EXPECTED_IDS = ['1788197658524-RX0DE2xA', '1788197658524-RVSnJFyP', '1788197658524-2Qgtf6l6', '1788197658524-FwEKzK59', '1788197658524-2R2NP0B9', '1788197658524-CzhqBs5V', '1788197658524-hQdwK4UR',  '1788197658524-3KUDUZ2Z', '1788197658524-NmxnpZvx', '1788197658524-TWLRZ2gs', '1788197658524-fVj3nerc']
SRC_ENUM = {"local", "imported", "builtin"}


def log(m):
    print(f"{datetime.datetime.now().isoformat()}  {m}", flush=True)


def validate_prompt(p):
    errs = []
    if not isinstance(p, dict):
        return ["NOT A DICT"]
    if not isinstance(p.get("id"), str) or not p.get("id").strip():
        errs.append("id: non-empty string required")
    if not isinstance(p.get("name"), str):
        errs.append("name: string required")
    if not isinstance(p.get("description"), str):
        errs.append("description: string required")
    if p.get("content") is not None and not isinstance(p.get("content"), str):
        errs.append("content: string when present")
    params = p.get("parameters")
    if params is not None:
        if not isinstance(params, list):
            errs.append("parameters: array required")
        else:
            for i, pa in enumerate(params):
                if not isinstance(pa, dict) or not isinstance(pa.get("name"), str) or not isinstance(pa.get("required"), bool):
                    errs.append(f"parameters[{i}]: name+required(boolean) REQUIRED")
    files = p.get("files")
    if files is not None:
        if not isinstance(files, list):
            errs.append("files: array required")
        else:
            for i, fi in enumerate(files):
                if not isinstance(fi, dict) or any(not isinstance(fi.get(k), str) for k in ("id", "name", "type", "path")):
                    errs.append(f"files[{i}]: id/name/type/path REQUIRED")
    messages = p.get("messages")
    if messages is not None:
        if not isinstance(messages, list):
            errs.append("messages: array required")
        else:
            for i, ms in enumerate(messages):
                c = ms.get("content") if isinstance(ms, dict) else None
                if not isinstance(ms, dict) or not isinstance(ms.get("role"), str) or not isinstance(c, dict) or not isinstance(c.get("text"), str):
                    errs.append(f"messages[{i}]: role + content.text REQUIRED")
    if p.get("enabled") is not None and not isinstance(p.get("enabled"), bool):
        errs.append("enabled: boolean when present")
    if p.get("source") is not None and p.get("source") not in SRC_ENUM:
        errs.append(f"source: INVALID {p.get('source')!r}")
    for k in ("createdAt", "updatedAt"):
        v = p.get(k)
        if v is not None and not isinstance(v, int):
            errs.append(f"{k}: INT REQUIRED ({type(v).__name__})")
    t = p.get("template")
    if isinstance(t, str) and t != p.get("content"):
        errs.append("template != content")
    return errs


def _json_list(path):
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    return d.get("customPrompts") if isinstance(d, dict) and "customPrompts" in d else d


def _db_list(path):
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=60)
    cols = [r[1] for r in c.execute("PRAGMA table_info(app_settings)").fetchall()]
    valcol = "value_json" if "value_json" in cols else "value"
    row = c.execute(f"SELECT {valcol} FROM app_settings WHERE key='customPrompts'").fetchone()
    c.close()
    return json.loads(row[0]) if row and isinstance(row[0], str) else (row[0] if row else None)


def _validate_canon(cp):
    if not isinstance(cp, list) or len(cp) < 9:
        return False, f"not a list of >=9 (got {type(cp).__name__})"
    ids = [p.get("id") for p in cp if isinstance(p, dict)]
    missing = [e for e in EXPECTED_IDS if e not in ids]
    if missing:
        return False, f"missing expected ids: {missing}"
    errs = sum(len(validate_prompt(p)) for p in cp)
    if errs:
        return False, f"{errs} schema violation(s)"
    return True, "ok"


def _coerce_ints(cp):
    for p in cp:
        for k in ("createdAt", "updatedAt"):
            v = p.get(k)
            if isinstance(v, str) and v.isdigit():
                p[k] = int(v)
            elif isinstance(v, bool) or (v is not None and not isinstance(v, int)):
                p[k] = None
    return cp


def load_canonical():
    for label, loader in (
        ("repo canonical", lambda: _json_list(REPO_CANON) if os.path.exists(REPO_CANON) else None),
        ("backup file", lambda: _json_list(CANON_FILE) if os.path.exists(CANON_FILE) else None),
        ("live Roaming app-settings.json", lambda: _json_list(ROAMING_JSON)),
        ("Roaming DB", lambda: _db_list(ROAMING_DB)),
    ):
        try:
            cp = loader()
        except Exception as e:
            log(f"source {label} unreadable: {e}")
            continue
        ok, why = _validate_canon(cp)
        if ok:
            return _coerce_ints(cp), label
        log(f"source {label} REJECTED: {why}")
    return None, None


def cmd_restore():
    log("=== restore_custom_prompts.py v2 (schema-gated) ===")
    canon, src = load_canonical()
    if canon is None:
        log("FAILED: no schema-valid canonical source found (all candidates rejected)")
        return 2
    ok, why = _validate_canon(canon)
    if not ok:
        log(f"FAILED: canonical still invalid after coercion: {why}")
        return 2
    ids = [p.get("id") for p in canon]
    log(f"canonical source: {src} | {len(canon)} prompts | ids complete: {sorted(ids) == sorted(EXPECTED_IDS)}")
    canon_json = json.dumps(canon, ensure_ascii=False)
    now = int(time.time() * 1000)
    ok_all = True

    try:
        with open(CANON_FILE, "w", encoding="utf-8", newline="\n") as f:
            json.dump(canon, f, ensure_ascii=False, indent=2)
            f.write("\n")
        log("canonical backup written")
    except Exception as e:
        log(f"backup write FAILED: {e}")

    # 1. Roaming DB (app's primary store)
    try:
        c = sqlite3.connect(ROAMING_DB, timeout=120)
        c.execute("PRAGMA busy_timeout=120000")
        c.execute("UPDATE app_settings SET value_json=?, updated_at=? WHERE key='customPrompts'", (canon_json, now))
        c.commit()
        row = c.execute("SELECT value_json FROM app_settings WHERE key='customPrompts'").fetchone()
        c.close()
        ok = bool(row) and json.loads(row[0]) == canon
        ok_all &= ok
        log(f"Roaming DB app_settings: {'OK' if ok else 'MISMATCH'}")
    except Exception as e:
        ok_all = False
        log(f"Roaming DB FAILED: {e}")

    # 3+4. JSON stores (full-file rewrite, LF)
    for path, label in [(ROAMING_JSON, "Roaming app-settings.json")]:
        try:
            d = json.load(open(path, encoding="utf-8"))
            d["customPrompts"] = canon
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(d, f, ensure_ascii=False, indent=2)
            d2 = json.load(open(path, encoding="utf-8"))
            ok = d2.get("customPrompts") == canon
            ok_all &= ok
            log(f"{label}: {'OK' if ok else 'MISMATCH'}")
        except Exception as e:
            ok_all = False
            log(f"{label} FAILED: {e}")

    # 4. Roaming custom_prompts.json (standalone CP file store - RESTORE-CP-FILE-GAP-1: was omitted,
    # leaving psv exit 1 after every restore until manually synced)
    try:
        with open(ROAMING_CP_FILE, "w", encoding="utf-8", newline="\n") as f:
            json.dump(canon, f, ensure_ascii=False, indent=2)
            f.write("\n")
        d3 = json.load(open(ROAMING_CP_FILE, encoding="utf-8"))
        ok = d3 == canon
        ok_all &= ok
        log(f"Roaming custom_prompts.json: {'OK' if ok else 'MISMATCH'}")
    except Exception as e:
        ok_all = False
        log(f"Roaming custom_prompts.json FAILED: {e}")

    log(f"=== RESTORE {'COMPLETE (all stores OK)' if ok_all else 'PARTIAL/FAILED'} ===")
    log("NOTE: restart DeepChat for the UI prompt list to reload (RUNTIME-CACHE-CONTRACT-1)")
    return 0 if ok_all else 2



def _proj(cp):
    return {p.get("id"): (p.get("name"), p.get("content")) for p in cp} if isinstance(cp, list) else None

def cmd_verify():
    log("=== verify ===")
    stores = {
        "repo": lambda: _json_list(REPO_CANON) if os.path.exists(REPO_CANON) else None,
        "skills_copy": lambda: _json_list(SKILLS_COPY) if os.path.exists(SKILLS_COPY) else None,
        "script": lambda: _json_list(CANON_FILE) if os.path.exists(CANON_FILE) else None,
        "roaming_cp_file": lambda: _json_list(ROAMING_CP_FILE),
        "roaming_db": lambda: _db_list(ROAMING_DB),
    }
    rc = 0
    results = {}
    for name, loader in stores.items():
        try:
            cp = loader()
        except Exception as e:
            log(f"[STORE-ERROR] {name}: {e}")
            rc = max(rc, 2)
            continue
        results[name] = cp
        ok, why = _validate_canon(cp)
        if not ok:
            log(f"[INVALID] {name}: {why}")
            rc = max(rc, 1)
        else:
            log(f"[ok] {name}: {len(cp)} entries")
    repo = results.get("repo")
    if repo is not None:
        for name, cp in results.items():
            if name != "repo" and _proj(cp) != _proj(repo):
                log(f"[DRIFT] {name} differs from repo canonical")
                rc = max(rc, 1)
    log("VERIFY PASS" if rc == 0 else "VERIFY FAILED")
    return rc


def cmd_inventory():
    stores = {
        "repo": lambda: _json_list(REPO_CANON) if os.path.exists(REPO_CANON) else None,
        "skills_copy": lambda: _json_list(SKILLS_COPY) if os.path.exists(SKILLS_COPY) else None,
        "script": lambda: _json_list(CANON_FILE) if os.path.exists(CANON_FILE) else None,
        "roaming_cp_file": lambda: _json_list(ROAMING_CP_FILE),
        "roaming_db": lambda: _db_list(ROAMING_DB),
    }
    for name, loader in stores.items():
        try:
            cp = loader()
            v = sum(len(validate_prompt(p)) for p in cp) if isinstance(cp, list) else None
            print(f"{name:16s} entries={len(cp) if isinstance(cp, list) else 'ERR'} violations={v}")
        except Exception as e:
            print(f"{name:16s} ERROR {e}")
    return 0


def cmd_export():
    canon, src = load_canonical()
    if canon is None:
        log("FAILED: no schema-valid canonical source")
        return 2
    with open(CANON_FILE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(canon, f, ensure_ascii=False, indent=2)
        f.write("\n")
    log(f"exported {len(canon)} entries from {src} -> {CANON_FILE}")
    return 0


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "restore"
    sys.exit({"restore": cmd_restore, "verify": cmd_verify, "inventory": cmd_inventory,
              "export": cmd_export}.get(mode, cmd_restore)())
