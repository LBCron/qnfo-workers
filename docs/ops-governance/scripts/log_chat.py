#!/usr/bin/env python3
"""
log_chat.py v2 - Push local DeepChat session logs to Cloudflare qnfo-skill-sync.

v2 changes (QNFO.INF.LOGCAP.W1-5, 2026-08-21):
  W1 error_flag derived from deepchat_messages.status='error' (real failure
     signal) instead of keyword matching on content (~60% false positives).
  W1 error_count + error_sample (first status='error' message, <=500 chars)
     added so the kaizen extractor sees the ACTUAL failure text.
  W2 row cap raised 100 -> 1000 (--limit override) for backlog catch-up.
  W3 per-row retry (1 retry, 2s backoff); state advances to max rowid SEEN.
  W4 console window title set so the schtasks console is identifiable.
  W5 after a successful push, POST /kaizen/run fires the kaizen cycle.

Usage:
  python C:/Users/LENOVO/.deepchat/scripts/log_chat.py [--hours 24] [--limit 1000] [--dry-run] [--no-trigger]
"""

import sqlite3, json, os, sys, time, argparse, urllib.request

# --- Config ---
AGENT_DB = os.path.expandvars(r"%APPDATA%\DeepChat\app_db\agent.db")
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".log_chat_state.json")
API = "https://qnfo-skill-sync.q08.workers.dev/log/chat"
KAIZEN_API = "https://qnfo-skill-sync.q08.workers.dev/kaizen/run"

if os.name == "nt":  # W4
    try:
        os.system("title DeepChat Log Push")
    except Exception:
        pass

def _token():
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".sync_token")
    try:
        with open(p) as f:
            return f.read().strip()
    except Exception:
        return ""

UA = {"User-Agent": "Mozilla/5.0", "Content-Type": "application/json", "X-Sync-Token": _token()}

def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {"last_rowid": 0, "last_run": None}

def save_state(state):
    state["last_run"] = time.time()
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)

def _unwrap_text(raw):
    raw = str(raw or "")
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and "text" in parsed:
            return str(parsed["text"])
        return raw
    except Exception:
        return raw

def fetch_sessions(last_rowid, hours, limit):
    conn = sqlite3.connect(AGENT_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(deepchat_sessions)")
    cols = {r["name"] for r in cur.fetchall()}
    cur.execute("PRAGMA table_info(deepchat_messages)")
    msg_cols = {r["name"] for r in cur.fetchall()}
    id_col = "id" if "id" in cols else "session_id"
    sql = (f"SELECT rowid AS _rowid, {id_col} AS session_id, model_id, provider_id, "
           f"summary_text FROM deepchat_sessions WHERE rowid > ?")
    params = [last_rowid]
    if "created_at" in cols:
        sql += " AND created_at > ?"
        params.append(int((time.time() - hours * 3600) * 1000))
    sql += f" ORDER BY rowid LIMIT {int(limit)}"

    try:
        cur.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        print(f"session query error: {e}", file=sys.stderr)
        rows = []

    out = []
    for r in rows:
        session_id = r.get("session_id")
        if not session_id:
            continue

        title = (r.get("summary_text") or "").strip()[:400]
        msg_count = 0
        error_count = 0
        sample = ""
        error_sample = ""

        try:
            mid = "session_id" if "session_id" in msg_cols else id_col
            # W1: real error signal = message status column
            if "status" in msg_cols:
                cur.execute(
                    f"SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END),0) AS err "
                    f"FROM deepchat_messages WHERE {mid} = ?", (session_id,))
                mc = cur.fetchone()
                msg_count = mc["n"] if mc else 0
                error_count = int(mc["err"] or 0) if mc else 0
            else:
                cur.execute(f"SELECT COUNT(*) AS n FROM deepchat_messages WHERE {mid} = ?", (session_id,))
                mc = cur.fetchone()
                msg_count = mc["n"] if mc else 0

            cur.execute(
                f"SELECT content FROM deepchat_messages WHERE {mid} = ? AND role = 'user' ORDER BY rowid LIMIT 1",
                (session_id,))
            u = cur.fetchone()
            if u and u["content"]:
                sample = _unwrap_text(u["content"])[:600]
                if not title:
                    title = sample[:400]

            # W1: capture the actual error text for the kaizen extractor
            if error_count > 0:
                cur.execute(
                    f"SELECT content FROM deepchat_messages WHERE {mid} = ? AND status = 'error' ORDER BY rowid LIMIT 1",
                    (session_id,))
                e = cur.fetchone()
                if e and e["content"]:
                    error_sample = _unwrap_text(e["content"])[:500]
        except Exception:
            pass

        out.append({
            "session_id": str(session_id)[:200],
            "title": title,
            "summary": sample or title,
            "message_count": msg_count,
            "error_flag": bool(error_count > 0),
            "error_count": error_count,
            "error_sample": error_sample,
            "model_id": (r.get("model_id") or "")[:100],
            "provider_id": (r.get("provider_id") or "")[:100],
            "_rowid": r["_rowid"],
        })
    conn.close()
    return out

def _post(url, body, timeout=30):
    req = urllib.request.Request(url, data=body, headers=UA)
    return urllib.request.urlopen(req, timeout=timeout)

def push(sessions, dry_run=False):
    pushed = 0
    failed = 0
    for s in sessions:
        payload = {k: v for k, v in s.items() if k != "_rowid"}
        body = json.dumps(payload).encode()
        if dry_run:
            print(f"[DRY] would push: {s['session_id']} title={s['title'][:60]!r} "
                  f"err={s['error_flag']} errs={s['error_count']} msgs={s['message_count']}")
            pushed += 1
            continue
        ok = False
        last_err = "unknown"
        for attempt in (1, 2):  # W3
            try:
                resp = _post(API, body)
                result = json.loads(resp.read())
                if result.get("success"):
                    ok = True
                    break
                last_err = f"api: {result}"
            except Exception as e:
                last_err = f"net: {e}"
            if attempt == 1:
                time.sleep(2)
        if ok:
            print(f"  pushed {s['session_id']} (id={result.get('id')}) "
                  f"title={s['title'][:50]!r} err={s['error_flag']} errs={s['error_count']}")
            pushed += 1
        else:
            failed += 1
            print(f"  FAILED {s['session_id']}: {last_err}", file=sys.stderr)
    return pushed, failed

def trigger_kaizen():
    """W5: fire the kaizen cycle right after a successful push (async server-side)."""
    try:
        resp = _post(KAIZEN_API, b"{}", timeout=15)
        result = json.loads(resp.read())
        print(f"kaizen trigger: {result.get('message', result)}")
        return True
    except Exception as e:
        print(f"kaizen trigger failed: {e}", file=sys.stderr)
        return False

def main():
    ap = argparse.ArgumentParser(description="Push local DeepChat session logs to Cloudflare")
    ap.add_argument("--hours", type=int, default=24, help="Lookback window in hours (default 24)")
    ap.add_argument("--limit", type=int, default=1000, help="Max rows per run (default 1000)")
    ap.add_argument("--dry-run", action="store_true", help="Show what would be pushed without sending")
    ap.add_argument("--no-trigger", action="store_true", help="Skip the /kaizen/run trigger after push")
    args = ap.parse_args()

    state = load_state()
    last_rowid = state.get("last_rowid", 0)

    sessions = fetch_sessions(last_rowid, args.hours, args.limit)
    if not sessions:
        print(f"No new sessions since rowid {last_rowid}. ({args.hours}h lookback)")
        return

    print(f"Found {len(sessions)} new session(s) since rowid {last_rowid}.")
    pushed, failed = push(sessions, args.dry_run)

    if not args.dry_run:
        # W3: advance to max rowid SEEN; persistent failures logged, not replayed forever
        max_rowid = max(s["_rowid"] for s in sessions)
        save_state({**state, "last_rowid": max(max_rowid, state.get("last_rowid", 0))})
        print(f"State advanced to rowid {max_rowid}. Pushed {pushed}. Failed {failed}.")

    if pushed > 0 and not args.dry_run and not args.no_trigger:
        trigger_kaizen()

if __name__ == "__main__":
    main()
