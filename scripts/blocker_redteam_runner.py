#!/usr/bin/env python3
"""BLOCKER-REDTEAM-AUTO-1 (2026-10-11, pillar autonomy; owner directive 2026-10-11 "Remediate all open items and failure modes,
as well as automatic resolution of root causes for future issues 100% autonomously").

WHY   unverified_blocker_claims read 43 and could never fall: v_blocker_claims expires a red-team after 24 hours, and the only 9
      blocker_redteam rows ever written came from sessions. Doctrine section 3 asks that a blocker be attempted before it is
      believed; nothing attempted any automatically.
WHAT  Each run takes every row of v_blocker_claims and makes one deterministic attempt, recording it in blocker_redteam:
        - an issue claiming the owner is needed is confirmed only by an IDENTITY-BOUND: line in its text, else left counted;
        - an issue that already has a doer (a code-task line or a live work claim; a closing probe verifies, it is not a doer:
          BLOCKER-REDTEAM-AUTO-2) is not blocked: verdict false-belief-removed, naming the doer;
        - an issue claiming a missing token: the repository token is verified live against the Cloudflare API; a success is
          false-belief-removed with the verify result, a refusal is confirmed-with-evidence with the refusal text;
        - an owner card whose why carries an IDENTITY-BOUND: line: confirmed-with-evidence, quoting it (the gate, not this
          runner, reroutes cards without one).
      Anything else is left unrecorded, so it stays counted and visible: this runner never writes a verdict it did not test.
SIGNED VERDICTS (REDTEAM-TEXT-SIG-1, 2026-10-30, failure mode blocker-verdict-confirmed-expires-daily): v_blocker_claims keeps a verdict valid past
      24 hours only when the row carries blocker_redteam.text_sig, the "<title length>:<description length>" of the issue it tested, and the issue's text
      still matches it. This runner wrote none, so each of its verdicts lapsed daily and the claim returned to unverified_blocker_claims (1000554). It now
      signs a verdict only when the evidence is in the issue text itself (an IDENTITY-BOUND: line, a code-task line), computed from the same read that
      produced the verdict; a verdict that rests on a time-dependent fact (a live work claim, the token verify call) stays unsigned and keeps its 24-hour
      retest, and an edited issue text re-surfaces the claim. Cards have no signature column in the view, so they stay unsigned.
RUNS  A step of remediation-consumer.yml. Deterministic, no model call, never fails the job.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import remediation_consumer as RC  # noqa: E402

ACTOR = "blocker-redteam-runner"
TOKEN_RE = re.compile(r"needs a token|no token", re.I)
OWNER_RE = re.compile(r"owner only|owner-only|needs the owner", re.I)
BOUND_RE = re.compile(r"IDENTITY-BOUND:[^\n]{0,240}")
SURFACES = "surfaces: D1 contract and work-claim ledgers, issue text, Cloudflare token verify API, owner-card why"


CODE_TASK_DOER = "code-loop task line"


def sig_of(title, desc):
    """The text signature v_blocker_claims compares: length(title) || ':' || length(description)."""
    return "%d:%d" % (len(title or ""), len(desc or ""))


def doer_of(d1, iid, desc):
    # BLOCKER-REDTEAM-AUTO-2: a closing probe verifies a fix, it does not do the work, so only a code-loop task line or a
    # live work claim counts as a doer (the first run counted active probes and so cleared owner-bound #1750).
    m = re.search(r"code-task: repo=\S+ path=\S+", desc or "")
    if m:
        return "%s '%s'" % (CODE_TASK_DOER, m.group(0))
    rows = d1("SELECT holder FROM work_claims WHERE issue_id = ?1 AND released_at IS NULL "
              "AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now') LIMIT 1", [iid])
    if rows:
        return "live work claim by %s" % rows[0]["holder"]
    # BLOCKER-REDTEAM-AUTO-3: the two other doers v_issue_age_ladder counts (a live code task, a progressing breach-doctor case)
    other = live_doers(d1).get(iid)
    if other:
        return other
    return None


def token_attempt(req=None):
    """(ok, evidence). Verifies the repository Cloudflare token the runner holds."""
    req = req or RC._req
    for path in ("/accounts/%s/tokens/verify" % RC.ACCOUNT, "/user/tokens/verify"):
        try:
            r = req("GET", RC.CF_API + path)
        except Exception as e:  # noqa: BLE001
            last = "%s refused: %s" % (path, str(e)[:160])
            continue
        status = ((r or {}).get("result") or {}).get("status")
        if (r or {}).get("success") and status == "active":
            return True, "%s returned status active" % path
        last = "%s returned %s" % (path, json.dumps(r)[:160])
    return False, last


# BLOCKER-REDTEAM-AUTO-3 (2026-11-05, metric unverified_blocker_claims 35, pillar autonomy). v_blocker_claims matches the eight trigger phrases below as bare
# substrings of title + description, so a sentence that denies the blocker ("nothing is blocked", "Neither is owner-only", "unblocked") counts as one. Measured
# 2026-11-04 on the 36 open claims: 1 denies the phrase in the text itself (1000275), 2 carry an IDENTITY-BOUND: line without owner wording (1001748, 1001749),
# and 33 have no doer at all (v_issue_age_ladder.doer is null for every one; 16 carry a `session-task:` line), which the doer-assignment loop owns.
# The runner now (1) confirms an issue that states its own IDENTITY-BOUND: line, (2) records false-belief-removed, signed, when every occurrence of every
# trigger phrase in the text is negated, (3) counts a live code task or a progressing breach-doctor case as a doer, as v_issue_age_ladder does. A claim it
# still cannot test stays unrecorded, as before.
PHRASES = ("owner only", "owner-only", "needs a token", "no token", "needs the owner", "cannot be done", "blocked")
NEGATOR_RE = re.compile(r"no|not|never|neither|nor|nothing|none|without|\w+n't|cannot", re.I)
NEGATION_WORDS = 4
SENTENCE_BREAK_RE = re.compile(r"[.!?\n;]")
ACTIVE_STATUS = "'merged', 'closed', 'superseded', 'publish_failed', 'needs_human', 'failed', 'reverted'"


def phrase_hits(text):
    """Every (phrase, start) of a trigger phrase in the lower-cased text, as v_blocker_claims matches them (substring)."""
    low = (text or "").lower()
    hits = []
    for p in PHRASES:
        i = low.find(p)
        while i >= 0:
            hits.append((p, i))
            i = low.find(p, i + 1)
    return sorted(hits, key=lambda h: h[1])


def negated_context(text, p, i):
    """The quoted context when this occurrence denies the blocker (unblocked, or a negator earlier in the same sentence), else None."""
    low = text.lower()
    if p == "blocked" and i >= 2 and low[i - 2:i] == "un":
        return text[max(0, i - 30):i + 20].replace("\n", " ")
    start = i
    while start > 0 and not SENTENCE_BREAK_RE.match(low[start - 1]):
        start -= 1
    # The words before the phrase only ("no token" is a claim, its own "no" is not a negator), bound to it: the last NEGATION_WORDS words after the
    # last colon of the sentence. BLOCKER-REDTEAM-AUTO-3a: a 60-character window removed 3003 ("...the metric is not moving:** two producers are
    # blocked by publication-quality gates"), where the "not" negates "moving", not "blocked".
    prefix = low[max(start, i - 60):i].split(":")[-1]
    if any(NEGATOR_RE.fullmatch(w.strip("*_`()[]{}\"',")) for w in prefix.split()[-NEGATION_WORDS:]):
        return text[max(start, i - 60):i + len(p) + 20].replace("\n", " ").strip()
    return None


def all_negated(text):
    """(True, [quotes]) when the text has trigger phrases and every occurrence is negated; (False, []) otherwise."""
    hits = phrase_hits(text)
    if not hits:
        return False, []
    quotes = []
    for p, i in hits:
        q = negated_context(text, p, i)
        if q is None:
            return False, []
        quotes.append(q)
    if re.search(r"(?im)^\s*session-task:", text or ""):
        return False, []
    return True, quotes


_LIVE = {}


def live_doers(d1):
    """{issue id: doer text} for live code tasks and progressing breach-doctor cases (v_issue_age_ladder's other two doers), read once per run."""
    if "ids" in _LIVE and _LIVE.get("d1") is d1:
        return _LIVE["ids"]
    ids = {}
    try:
        for r in d1("SELECT id, substr(goal, 1, 24) AS g FROM code_tasks WHERE status NOT IN (" + ACTIVE_STATUS + ") "
                    "AND (updated_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-120 minutes') OR lease_until > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))"):
            m = re.match(r"\[issue #(\d+)\]", r.get("g") or "") or re.match(r"ct_im(\d+)$", r.get("id") or "")
            if m:
                ids.setdefault(int(m.group(1)), "live code task %s" % r.get("id"))
    except Exception:  # noqa: BLE001 - a missing table or an overloaded read leaves the other doers in force
        pass
    try:
        for r in d1("SELECT issue_id FROM breach_diagnoses WHERE mode = 'on' AND state IN ('queued', 'applied', 'verifying') AND action_ref IS NOT NULL "
                    "AND action_kind <> 'none' AND lease_until > strftime('%Y-%m-%dT%H:%M:%SZ', 'now') "
                    "AND last_progress_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-120 minutes')"):
            if r.get("issue_id") is not None:
                ids.setdefault(int(r["issue_id"]), "breach doctor case")
    except Exception:  # noqa: BLE001
        pass
    _LIVE["d1"], _LIVE["ids"] = d1, ids
    return ids


def has_owner_claim(text):
    for match in OWNER_RE.finditer(text):
        line_start = text.rfind("\n", 0, match.start()) + 1
        prefix = text[line_start:match.start()]
        if re.search(r"\b(?:not|never|neither|no)\b(?:\W+\w+){0,4}\W*$", prefix, re.I):
            continue
        return True
    return False


def record(d1, target, claim, attempt, verdict, evidence, sig=None):
    d1("INSERT INTO blocker_redteam (target, claim, attempt, verdict, evidence, actor, text_sig, ts) "
       "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
       [target, claim[:300], attempt[:300], verdict, (evidence + " | " + SURFACES)[:600], ACTOR, sig])


def main(d1=None, req=None):
    d1 = d1 or RC.d1
    _LIVE.clear()
    out = {"marker": "BLOCKER-REDTEAM-AUTO-1", "tested": 0, "removed": 0, "confirmed": 0, "left": 0}
    token_result = None
    try:
        claims = d1("SELECT target, text FROM v_blocker_claims")
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)[:200]
        print(json.dumps(out))
        return 0
    for c in claims:
        target, text = c.get("target") or "", c.get("text") or ""
        try:
            if target.startswith("issue:"):
                iid = int(target.split(":", 1)[1])
                row = d1("SELECT description FROM agent_issues WHERE id = ?1", [iid])
                desc = (row[0].get("description") if row else "") or ""
                bound = BOUND_RE.search(desc)
                if bound and not has_owner_claim(text + " " + desc):
                    # BLOCKER-REDTEAM-AUTO-3: the issue states its own identity-bound step; the line is the evidence (and signs the verdict).
                    record(d1, target, text, "read the issue's identity-bound statement", "confirmed-with-evidence", bound.group(0),
                           sig_of(text, desc))
                    out["confirmed"] += 1
                    out["tested"] += 1
                    continue
                if has_owner_claim(text + " " + desc):
                    if not bound:
                        out["left"] += 1
                        continue
                    record(d1, target, text, "read the issue's identity-bound statement", "confirmed-with-evidence", bound.group(0),
                           sig_of(text, desc))
                    out["confirmed"] += 1
                    out["tested"] += 1
                    continue
                denied, quotes = all_negated(text + "\n" + desc)
                if denied:
                    # BLOCKER-REDTEAM-AUTO-3: the text denies the blocker everywhere it names one; the evidence is in the text, so the verdict is signed.
                    record(d1, target, text, "read every trigger phrase of the claim in its sentence", "false-belief-removed",
                           "not a blocker claim, every occurrence is negated: " + " | ".join(quotes[:3]), sig_of(text, desc))
                    out["removed"] += 1
                    out["tested"] += 1
                    continue
                doer = doer_of(d1, iid, desc)
                if doer:
                    # Only a doer written in the issue text is signed; a live work claim lapses, so it is retested after 24 hours.
                    record(d1, target, text, "looked for a doer that can close it", "false-belief-removed",
                           "not blocked: " + doer, sig_of(text, desc) if doer.startswith(CODE_TASK_DOER) else None)
                    out["removed"] += 1
                elif TOKEN_RE.search(text + " " + desc):
                    if token_result is None:
                        token_result = token_attempt(req)
                    ok, ev = token_result
                    record(d1, target, text, "verified the repository Cloudflare token live",
                           "false-belief-removed" if ok else "confirmed-with-evidence", ev)
                    out["removed" if ok else "confirmed"] += 1
                else:
                    out["left"] += 1
                    continue
            elif target.startswith("card:"):
                cid = int(target.split(":", 1)[1])
                row = d1("SELECT why FROM human_actions WHERE id = ?1", [cid])
                why = (row[0].get("why") if row else "") or ""
                m = BOUND_RE.search(why)
                if not m:
                    out["left"] += 1
                    continue
                record(d1, target, text, "read the card's identity-bound statement", "confirmed-with-evidence", m.group(0))
                out["confirmed"] += 1
            else:
                out["left"] += 1
                continue
            out["tested"] += 1
        except Exception as e:  # noqa: BLE001 - one claim must not stop the rest
            out.setdefault("errors", []).append("%s: %s" % (target, str(e)[:120]))
    print(json.dumps(out))
    return 0


def _lite(conn, sql, params=None):
    """Run D1-style SQL (?1, ?2 placeholders) on sqlite3 through named parameters, so no Python version warns or raises."""
    cur = conn.execute(re.sub(r"\?(\d+)", r":p\1", sql), {"p%d" % (i + 1): v for i, v in enumerate(params or [])})
    cols = [d[0] for d in cur.description] if cur.description else []
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def selftest():
    import sqlite3
    c = sqlite3.connect(":memory:")
    c.executescript("""
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT);
CREATE TABLE remediation_contracts (class TEXT, issue_id INTEGER, status TEXT, verify_probe TEXT, verify_transport TEXT);
CREATE TABLE work_claims (issue_id INTEGER, holder TEXT, released_at TEXT, expires_at TEXT);
CREATE TABLE human_actions (id INTEGER PRIMARY KEY, why TEXT);
CREATE TABLE blocker_redteam (id INTEGER PRIMARY KEY, target TEXT, claim TEXT, attempt TEXT, verdict TEXT, evidence TEXT, actor TEXT, text_sig TEXT, ts TEXT);
CREATE TABLE claims (target TEXT, text TEXT);
CREATE VIEW v_blocker_claims AS SELECT * FROM claims;
CREATE TABLE code_tasks (id TEXT, goal TEXT, status TEXT, updated_at TEXT, lease_until TEXT);
CREATE TABLE breach_diagnoses (issue_id INTEGER, mode TEXT, state TEXT, action_ref TEXT, action_kind TEXT, lease_until TEXT, last_progress_at TEXT);
INSERT INTO agent_issues VALUES (20, 'plain', 'Neither is owner-only, so nothing is blocked.'), (21, 'move it', 'Until it exists nothing is blocked.
IDENTITY-BOUND: the owner mints the key'), (22, 'the push', 'it is unblocked now'), (23, 'blocked on a token', 'no token'),
  (24, 'Neither is owner-only', 'but this part is blocked on a reviewer'), (25, 'blocked', 'a code task owns it'), (26, 'blocked', 'the doctor owns it'),
  (27, 'blocked', 'an expired code task'), (28, 'blocked', 'session-task: a session must do this, nothing is blocked'), (29, 'not blocked', 'owner-only is wrong here');
INSERT INTO code_tasks VALUES ('ct_a', '[issue #25] fix it', 'queued', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL),
  ('ct_im27', 'x', 'queued', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-3 hours'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 hour')),
  ('ct_im99', 'x', 'merged', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL);
INSERT INTO breach_diagnoses VALUES (26, 'on', 'applied', 'ref', 'sql', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 hour'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
INSERT INTO claims VALUES ('issue:20', 'plain'), ('issue:21', 'move it'), ('issue:22', 'the push'), ('issue:23', 'blocked on a token'), ('issue:24', 'Neither is owner-only'),
  ('issue:25', 'blocked'), ('issue:26', 'blocked'), ('issue:27', 'blocked'), ('issue:28', 'blocked'), ('issue:29', 'not blocked');
INSERT INTO agent_issues VALUES (1, 'blocked on x', 'needs fixing'), (2, 'blocked', 'fix it\ncode-task: repo=qnfo-workers path=a/worker.js'),
  (3, 'needs a token', 'cannot write routes, no token'), (4, 'blocked', 'nothing'), (5, 'blocked', 'claimed'),
  (6, 'owner only', 'needs the owner
IDENTITY-BOUND: a signing act'), (9, 'owner only: x', 'code-task: repo=qnfo-workers path=a/worker.js'),
 (10, 'move token to the fleet app', 'Neither is owner-only.\ncode-task: repo=qnfo-workers path=qnfo-ops/worker.js');
INSERT INTO remediation_contracts VALUES ('issue-1', 1, 'active', 'SELECT 1', 'd1-query'), ('issue-4', 4, 'needs-machine-probe', 'needs-machine-probe', 'd1-query');
INSERT INTO work_claims VALUES (5, 'session_x', NULL, '2999-01-01T00:00:00Z');
INSERT INTO human_actions VALUES (7, 'Post the license.\nIDENTITY-BOUND: a legal act in the owner''s name'), (8, 'just do it');
INSERT INTO claims VALUES ('issue:1', 'blocked on x'), ('issue:2', 'blocked'), ('issue:3', 'needs a token'), ('issue:4', 'blocked'),
  ('issue:5', 'blocked'), ('issue:6', 'owner only'), ('issue:9', 'owner only: x'), ('issue:10', 'move token to the fleet app'),
  ('card:7', 'Post the license'), ('card:8', 'do it');
""")

    def d1(sql, params=None):
        return _lite(c, sql, params)

    def req_ok(method, url, body=None):
        return {"success": True, "result": {"status": "active"}}

    main(d1, req_ok)
    got = {r[0]: (r[1], r[2]) for r in c.execute("SELECT target, verdict, evidence FROM blocker_redteam")}
    assert "issue:1" not in got, "an active probe alone is not a doer"
    assert got["issue:6"][0] == "confirmed-with-evidence" and "signing" in got["issue:6"][1], got
    assert "issue:9" not in got, "an owner claim without IDENTITY-BOUND stays counted"
    assert got["issue:2"][0] == "false-belief-removed" and "code-task" in got["issue:2"][1], got
    assert got["issue:10"][0] == "false-belief-removed" and "code-task" in got["issue:10"][1], got
    assert got["issue:3"][0] == "false-belief-removed" and "active" in got["issue:3"][1], got
    assert "issue:4" not in got, "an untested claim must stay unrecorded"
    assert got["issue:5"][0] == "false-belief-removed" and "session_x" in got["issue:5"][1], got
    assert got["card:7"][0] == "confirmed-with-evidence" and "legal act" in got["card:7"][1], got
    assert "card:8" not in got, got
    # BLOCKER-REDTEAM-AUTO-3
    assert got["issue:20"][0] == "false-belief-removed" and "negated" in got["issue:20"][1], got
    assert got["issue:21"][0] == "confirmed-with-evidence" and "mints the key" in got["issue:21"][1], got
    assert got["issue:22"][0] == "false-belief-removed" and "negated" in got["issue:22"][1], "unblocked denies the blocker: %s" % (got,)
    assert got["issue:23"][0] == "false-belief-removed" and "active" in got["issue:23"][1], "a token claim is still tested: %s" % (got,)
    assert "issue:24" not in got, "one un-negated phrase keeps the claim counted"
    assert got["issue:25"][0] == "false-belief-removed" and "live code task ct_a" in got["issue:25"][1], got
    assert got["issue:26"][0] == "false-belief-removed" and "breach doctor" in got["issue:26"][1], got
    assert "issue:27" not in got, "an expired code task is not a doer"
    assert "issue:28" not in got, "a session-task line stays a claim even beside a negation"
    assert "issue:29" not in got, "an owner-only claim without IDENTITY-BOUND stays counted"
    assert negated_context("The push was blocked (non-fast-forward).", "blocked", 13) is None
    assert negated_context("It is not blocked.", "blocked", 10) is not None
    s3003 = "**Why the metric is not moving:** two producers are blocked by publication-quality gates"
    assert negated_context(s3003, "blocked", s3003.index("blocked")) is None, "a negator that belongs to another word does not deny the phrase (issue 3003)"
    s1000275 = "They hold no concurrency group, so nothing is blocked; they only distort run counts"
    assert negated_context(s1000275, "blocked", s1000275.index("blocked")) is not None
    s2582 = "Neither is owner-only, so nothing is blocked."
    assert all(negated_context(s2582, p, i) is not None for p, i in phrase_hits(s2582)), phrase_hits(s2582)
    sfar = "a far earlier not, then many unrelated words before the blocked step"
    assert negated_context(sfar, "blocked", sfar.index("blocked")) is None
    assert all("surfaces:" in v[1] for v in got.values())
    sig = {r[0]: r[1] for r in c.execute("SELECT target, text_sig FROM blocker_redteam")}
    assert sig["issue:6"] == sig_of("owner only", "needs the owner\nIDENTITY-BOUND: a signing act"), sig
    assert sig["issue:2"] == sig_of("blocked", "fix it\ncode-task: repo=qnfo-workers path=a/worker.js"), sig
    assert sig["issue:5"] is None and sig["issue:3"] is None, "a live claim and a token check lapse, so they stay unsigned"
    assert sig["issue:20"] == sig_of("plain", "Neither is owner-only, so nothing is blocked."), "text-borne evidence is signed"
    assert sig["issue:25"] is None and sig["issue:26"] is None, "a live task and a doctor case lapse, so they stay unsigned"
    assert sig["card:7"] is None, "the view has no signature branch for a card"

    def req_no(method, url, body=None):
        raise RuntimeError("HTTP 401")
    assert token_attempt(req_no)[0] is False and "401" in token_attempt(req_no)[1]
    selftest_view()
    print("blocker_redteam_runner selftest ok")


def selftest_view():
    """REDTEAM-TEXT-SIG-1 end to end: the runner's rows against the real v_blocker_claims text of the migration that signs them."""
    import sqlite3
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "..", "migrations", "2026-10-29-blocker-claims-confirmed-sticks.sql"), encoding="utf-8") as fh:
        ddl = fh.read()
    m = re.search(r"^CREATE VIEW v_blocker_claims AS.*?;\n", ddl, re.S | re.M)
    assert m, "the migration's view statement was not found"
    c = sqlite3.connect(":memory:")
    c.executescript("""
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, created_at INTEGER);
CREATE TABLE human_actions (id INTEGER PRIMARY KEY, title TEXT, why TEXT, status TEXT, source TEXT, slug TEXT, created_at TEXT);
CREATE TABLE issue_triage (issue_id INTEGER, close_evidence TEXT);
CREATE TABLE work_claims (issue_id INTEGER, holder TEXT, released_at TEXT, expires_at TEXT);
CREATE TABLE blocker_redteam (id INTEGER PRIMARY KEY, target TEXT, claim TEXT, attempt TEXT, verdict TEXT, evidence TEXT, actor TEXT, text_sig TEXT, ts TEXT);
""")
    c.execute(m.group(0))
    old = 1000  # created long before the 60-minute floor
    c.executemany("INSERT INTO agent_issues VALUES (?, ?, ?, 'open', ?)", [
        (11, "owner only: sign it", "a legal act\nIDENTITY-BOUND: signing in the owner's name", old),
        (12, "blocked on a fix", "do it\ncode-task: repo=qnfo-workers path=a/worker.js", old),
        (13, "blocked on a fix", "being worked", old),
        (14, "needs a token", "cannot write routes, no token", old)])
    c.execute("INSERT INTO work_claims VALUES (13, 'session_x', NULL, '2999-01-01T00:00:00Z')")

    def d1(sql, params=None):
        return _lite(c, sql, params)

    def listed():
        return sorted(r[0] for r in c.execute("SELECT target FROM v_blocker_claims"))

    assert listed() == ["issue:11", "issue:12", "issue:13", "issue:14"], listed()
    main(d1, lambda method, url, body=None: {"success": True, "result": {"status": "active"}})
    assert listed() == [], "a fresh verdict hides each claim for 24 hours: %s" % listed()
    c.execute("UPDATE blocker_redteam SET ts = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-3 days')")
    assert listed() == ["issue:13", "issue:14"], "past 24 hours only the unsigned time-dependent verdicts return: %s" % listed()
    c.execute("UPDATE agent_issues SET description = description || ' edited' WHERE id = 11")
    assert listed() == ["issue:11", "issue:13", "issue:14"], "an edited text re-surfaces its claim: %s" % listed()


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    sys.exit(main())
