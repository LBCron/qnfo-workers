#!/usr/bin/env python3
"""
log_threads.py - Push FULL DeepChat conversation threads to Cloudflare chat_sessions.

The metadata-only log_chat.py pipeline ships title/summary (first user message) to
chat_logs; this script reconstructs the COMPLETE user/assistant conversation from the
local agent.db (deepchat_messages + deepchat_user_messages + deepchat_assistant_blocks)
and pushes it to qnfo-thread-ingest /threads for the public Idea Factory.

Classification (v3, content-based) - the public feed serves ONLY genuine research:
  A session is 'research' ONLY when BOTH hold:
    1. agent_id == 'deepchat' AND session_kind == 'regular'
       (automation/personal/subagent sessions are NEVER public)
    2. CONTENT TEST: the title or ANY user-message intent scores >= 2 research
       terms AND more research terms than infra terms.
  User-message intent = text BEFORE the first CMD <WORD>: marker (CMD RESEARCH /
  CMD PUBLISH / CMD CONTINUE / CMD RED TEAM / CMD CLOSEOUT / CMD SKILLS UPDATE...)
  and file paths are stripped. This keeps CMD boilerplate (git/commit/branch/
  worker words) from polluting the score.

Usage:
  python C:/Users/LENOVO/.deepchat/scripts/log_threads.py [--all] [--dry-run] [--limit N]
    --all      backfill ALL sessions (ignore incremental state)
    --dry-run  print what would be pushed without sending
    --limit N  max sessions to process (default 200)
"""

import sqlite3, json, os, sys, time, re, argparse, urllib.request

AGENT_DB = os.path.expandvars(r"%APPDATA%\DeepChat\app_db\agent.db")
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".log_threads_state.json")
API = "https://qnfo-thread-ingest.q08.workers.dev/threads"
MAX_CONTENT = 20000
MAX_MESSAGES = 500

# ---------------------------------------------------------------------------
# Research / infrastructure vocabulary (v3 — calibrated 2026-08-28 on the
# full deepchat-regular corpus: 5 research / 15 infra)
# ---------------------------------------------------------------------------
RESEARCH_TERMS = [
    # mathematics / number theory / ultrametric
    "p-adic", "ultrametric", "adelic", "ostrowski", "number theory", "numeracy",
    "positional", "numeral", "zeta", "gamma function", "langlands", "tate",
    "morita", "valuation",
    "laws of form", "distinction", "re-entrant", "reentrant", "nested",
    # physics
    "quantum", "qubit", "qudit", "qec", "error correction", "stabilizer",
    "majorana", "anyon", "spin-statistics", "condensed matter", "topological",
    "holograph", "zitterbewegung", "zbw", "boson", "fermion", "particle",
    "field theory", "gravity", "cosmology", "black hole", "entropy",
    "information theory", "infomatics", "computation", "complexity",
    "benchmark", "joules", "energy efficiency", "landauer", "margolus",
    # research activity
    "critique", "paper", "publication", "theorem", "proof", "conjecture",
    "hypothesis", "thesis", "deep-dive", "deep dive", "compare with",
    "research topics", "potential papers", "paradigm", "consilience",
    "epistemolog", "ignorance audit", "open problem",
    # venues / programs
    "cwi", "qpl", "quantum algorithms", "summer school", "research inquiry",
]
INFRA_TERMS = [
    # builds / cloud / app config
    "ui", "web ui", "api", "endpoint", "worker", "deploy", "cloudflare",
    "openai", "chatbox", "deepseek", "mcp", "skill sync", "install",
    "access", "sync", "android", "vectorize",
    # accounts / ops
    "email", "inbox", "account", "gmail", "outlook", "oauth", "token", "secret",
    "analytics", "scrape", "archive", "backup",
    # git / process
    "git", "commit", "push", "repo", "branch", "closeout", "handoff",
    "resume", "checklist", "mandate", "workflow", "gates", "protocol",
    # system / personal
    "debloat", "slowdown", "cleanup", "disk", "performance",
    "personal", "inbox-zero", "gtd", "automation", "cron", "scheduled",
]
CMD_MARKER = re.compile(r"\bCMD\s+[A-Z][A-Z\s]*?:", re.I)


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
        return {"last_updated": 0, "last_run": None}


def save_state(state):
    state["last_run"] = time.time()
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)


def unwrap_user_text(raw):
    """User message content is a JSON wrapper {'text': '...', 'files': [], ...} or plain string."""
    raw = str(raw or "")
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and "text" in parsed:
            return str(parsed["text"])
        return raw
    except Exception:
        return raw


def _strip_noise(text):
    t = str(text or "")
    t = re.sub(r"[A-Za-z]:\\[^\s]*", " ", t)
    t = re.sub(r"\b[A-Za-z]:[^\s]*", " ", t)
    t = re.sub(r"\u2192", " ", t)
    t = re.sub(r"\s+", " ", t)
    return t.lower()


def _score_text(text):
    t = _strip_noise(text)
    if len(t) < 4:
        return (0, 0)
    r = sum(1 for term in RESEARCH_TERMS if term in t)
    i = sum(1 for term in INFRA_TERMS if term in t)
    return (r, i)


def _user_intent(m):
    """User-message text BEFORE the first CMD marker (the genuine instruction)."""
    parts = CMD_MARKER.split(str(m or ""))
    return parts[0] if parts else ""


def _meaningful_intents(user_msgs):
    """User intents with real content (strip CMD boilerplate + path-only dumps)."""
    out = []
    for m in user_msgs:
        intent = _user_intent(m).strip()
        stripped = _strip_noise(intent)
        if len(stripped) >= 20:
            out.append(intent)
    return out


def derive_title(title, user_msgs):
    """Use the session title; fall back to the first meaningful user intent."""
    t = (title or "").strip()
    stripped = _strip_noise(t).strip()
    if t and len(stripped) >= 10 and not stripped.startswith(("d:", "c:")):
        return t[:300]
    for intent in _meaningful_intents(user_msgs):
        return intent[:300]
    return t[:300]


def classify(agent_id, session_kind, title, user_msgs):
    """v4 classification — hard separation via the dedicated research agent.

    'research' when:
      (a) agent_id == 'research' AND session_kind == 'regular' — the dedicated
          Research agent's sessions are research BY DEFINITION (the user only
          uses that agent for research inquiries), OR
      (b) agent_id == 'deepchat' AND session_kind == 'regular' AND the
          title/user-intent content is research-dominant (v3 content test —
          safety net for the general agent).
    Everything else (automation/personal/subagents) = infra, never public.
    """
    if session_kind != "regular":
        return "infra"
    if agent_id == "research":
        return "research"
    if agent_id != "deepchat":
        return "infra"
    best_r, best_i = 0, 0
    t_stripped = _strip_noise(title)
    if t_stripped and not t_stripped.startswith(("d:", "c:")):
        tr, ti = _score_text(title)
        best_r, best_i = tr // 2, ti // 2
    for m in user_msgs:
        r, i = _score_text(_user_intent(m))
        best_r = max(best_r, r)
        best_i = max(best_i, i)
    if best_r >= 2 and best_r > best_i:
        return "research"
    return "infra"


def fetch_threads(last_updated, all_sessions, limit):
    conn = sqlite3.connect(f"file:{AGENT_DB}?mode=ro", uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # 1. Session metadata: new_sessions (title/agent/kind) + deepchat_sessions (model)
    sql = """SELECT ns.id AS session_id, ns.agent_id, ns.session_kind, ns.title,
                    ns.created_at AS ns_created, ns.updated_at AS ns_updated,
                    ds.model_id, ds.provider_id, ds.summary_text
             FROM new_sessions ns
             LEFT JOIN deepchat_sessions ds ON ds.id = ns.id"""
    if not all_sessions:
        sql += " WHERE ns.updated_at > ?"
    sql += " ORDER BY ns.updated_at DESC LIMIT ?"
    params = [last_updated] if not all_sessions else []
    params.append(int(limit))

    cur.execute(sql, params)
    sessions = [dict(r) for r in cur.fetchall()]

    out = []
    for s in sessions:
        sid = s["session_id"]
        raw_title = (s.get("title") or "").strip()[:300]
        model = (s.get("model_id") or "").strip()[:100]

        # 2. User messages (for classification) + full ordered thread
        cur.execute(
            "SELECT id, order_seq, role, content, created_at FROM deepchat_messages "
            "WHERE session_id = ? ORDER BY order_seq LIMIT ?",
            (sid, MAX_MESSAGES),
        )
        msgs = [dict(r) for r in cur.fetchall()]

        user_texts = []
        clean = []
        prev_sig = None
        for m in msgs:
            role = m["role"]
            content = ""
            if role == "user":
                cur.execute("SELECT text FROM deepchat_user_messages WHERE message_id = ?", (m["id"],))
                ur = cur.fetchone()
                content = ur["text"] if ur and ur["text"] else unwrap_user_text(m["content"])
                if content.strip():
                    user_texts.append(content)
            elif role == "assistant":
                cur.execute(
                    "SELECT text_content FROM deepchat_assistant_blocks "
                    "WHERE message_id = ? AND block_type = 'content' ORDER BY block_index",
                    (m["id"],),
                )
                blocks = [r["text_content"] for r in cur.fetchall() if r["text_content"]]
                if not blocks:
                    continue
                content = "\n\n".join(blocks)
            else:
                continue

            content = content.strip()
            if not content:
                continue
            if len(content) > MAX_CONTENT:
                content = content[:MAX_CONTENT] + "\n…[truncated]"

            ts = m.get("created_at")
            ts_iso = None
            if ts:
                try:
                    ts_iso = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(int(ts) / 1000))
                except Exception:
                    ts_iso = None

            sig = role + "|" + content[:80]
            if sig == prev_sig:
                continue
            prev_sig = sig

            clean.append({"role": role, "content": content, "timestamp": ts_iso})

        if len(clean) < 1:
            continue

        category = classify(s.get("agent_id"), s.get("session_kind"), raw_title, user_texts)
        title = derive_title(raw_title, user_texts)

        out.append({
            "session_id": str(sid)[:200],
            "title": title,
            "category": category,
            "agent_id": s.get("agent_id") or "",
            "model_id": model,
            "provider_id": s.get("provider_id") or "",
            "messages": clean,
            "created_at": s.get("ns_created"),
            "updated_at": s.get("ns_updated"),
            "summary": (s.get("summary_text") or "")[:2000],
        })
    conn.close()
    return out


def _post(url, body, timeout=40):
    req = urllib.request.Request(url, data=body, headers=UA)
    return urllib.request.urlopen(req, timeout=timeout)


def push(threads, dry_run=False):
    pushed = 0
    failed = 0
    max_updated = 0
    for t in threads:
        body = json.dumps(t).encode()
        if dry_run:
            print(f"[DRY] {t['session_id']} [{t['category']}] {t['title'][:60]!r} "
                  f"msgs={len(t['messages'])}")
            pushed += 1
            continue
        ok = False
        last_err = "unknown"
        for attempt in (1, 2):
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
            print(f"  pushed {t['session_id']} [{t['category']}] "
                  f"{t['title'][:50]!r} msgs={len(t['messages'])}")
            pushed += 1
        else:
            failed += 1
            print(f"  FAILED {t['session_id']}: {last_err}", file=sys.stderr)
        if t.get("updated_at"):
            try:
                max_updated = max(max_updated, int(t["updated_at"]))
            except Exception:
                pass
    return pushed, failed, max_updated


def main():
    ap = argparse.ArgumentParser(description="Push full DeepChat threads to Cloudflare")
    ap.add_argument("--all", action="store_true", help="Backfill ALL sessions (ignore state)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=200)
    args = ap.parse_args()

    state = load_state()
    last_updated = 0 if args.all else state.get("last_updated", 0)
    threads = fetch_threads(last_updated, args.all, args.limit)

    research = [t for t in threads if t["category"] == "research"]
    infra = [t for t in threads if t["category"] == "infra"]
    print(f"found {len(threads)} sessions ({len(research)} research, {len(infra)} infra)")

    pushed, failed, max_updated = push(threads, args.dry_run)
    if max_updated:
        state["last_updated"] = max_updated
        save_state(state)
    print(f"pushed={pushed} failed={failed}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
