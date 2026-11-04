#!/usr/bin/env python3
"""BP26-PROMPT-INJECTION-1 collectors (2026-10-26, charter pillar security; agent_issues 1000359; OWASP LLM01 and Agentic ASI01).

Three metrics, each measured from the real thing and none written by hand (scripts/bp26_producers.py contract):

  injection_eval_pass_rate           the red-team suite qnfo-email/injection-redteam.test.mjs run with node on this checkout of main; the value is pass / total from its
                                     last line (INJECTION_EVAL pass=<n> total=<m>). Limits: it exercises the guard functions and the drafter, drain and /send paths of
                                     qnfo-email worker.js against attacks (offline fakes, no model): it is not a live-model eval and it does not yet cover the personal-api
                                     twin or qnfo-social reply reading; the rows say whether the DEPLOYED qnfo-email reports the guard (/health injection_guard).
  outbound_mail_to_non_sender        agent-sent mail of the last 7 days in qnfo-audit.emails (status sent: the qnfo-email /send route and the reply drain) whose recipient is
                                     none of: a fleet-domain address, an owner address, an address that mailed us first within the 90 days before the send (the original
                                     sender of a thread), or an address on agent_send_allowlist. Limits: the ledger holds what qnfo-email sent; qnfo-outreach, qnfo-subscribers
                                     and the digests send through their own bindings under the consent machinery and are not in this ledger. Evidence rows carry counts and
                                     email ids, never an address.
  agent_tool_calls_outside_allowlist tool calls of the last 7 days that no agent_tool_allowlist row permits: ops_ai_tool events of qnfo-ops (cloud_ops_events) and mcp_log of
                                     qnfo-tools-mcp and qnfo-memory-mcp (both write the table), by tool name; plus the egress calls whose URL host no egress row permits (web_fetch, git_clone_exec). Limits: network
                                     access inside shell_exec, run_code_net and container tools is not attributable to a host from this log, and nothing records which tool
                                     calls came after untrusted content entered a session (both are code-tasks in the issue). A host outside the list is a review item, not
                                     proof of an incident. An empty allow-list is "unknown" (nothing written), never zero.

Offline suite: python3 scripts/bp26_agentsec.py --selftest
"""
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bp26_producers import Collector, Result, now_iso  # noqa: E402

EVAL_SUITE = "qnfo-email/injection-redteam.test.mjs"
EVAL_RE = re.compile(r"INJECTION_EVAL pass=(\d+) total=(\d+)")
FLEET_DOMAINS = ("qnfo.org", "q08.org", "qwav.org", "qwav.tech", "qwav.net", "qwav.uk", "qwave.tech", "q-wave.tech", "ipatent.me")
OWNER = ("rwnquni@outlook.com", "rowan.quni@outlook.com", "rowan.quni@qnfo.org", "rwnquni@qnfo.org", "rwnquni@gmail.com")
EGRESS_TOOLS = ("web_fetch", "git_clone_exec")
MCP_LOG_SURFACES = ("qnfo-tools-mcp", "qnfo-memory-mcp")  # the two workers that INSERT INTO mcp_log
LIVE_EMAIL_HEALTH = "https://qnfo-email.q08.workers.dev/health"


def since_iso(ctx, days):
    return now_iso(ctx.now - days * 86400)


# ---------------------------------------------------------------- 1. injection_eval_pass_rate
def run_eval(root, timeout=90):
    """(pass, total, failing lines) from the suite, or None when node or the suite is absent or the last line is unreadable."""
    path = os.path.join(root, *EVAL_SUITE.split("/"))
    node = shutil.which("node")
    if not node or not os.path.exists(path):
        return None
    try:
        r = subprocess.run([node, path], capture_output=True, text=True, timeout=timeout, cwd=root)
    except Exception:  # noqa: BLE001
        return None
    text = (r.stdout or "") + "\n" + (r.stderr or "")
    m = None
    for m in EVAL_RE.finditer(text):
        pass
    if not m or int(m.group(2)) <= 0:
        return None
    return int(m.group(1)), int(m.group(2)), [ln[:160] for ln in text.splitlines() if ln.startswith("FAIL ")][:8]


def collect_injection_eval(ctx):
    res = run_eval(ctx.root)
    if res is None:
        return [Result("injection_eval_pass_rate", None, "the red-team suite could not be run here (node or %s missing, or no INJECTION_EVAL line)" % EVAL_SUITE, [])]
    ok, total, fails = res
    rows = [(EVAL_SUITE, 1 if ok == total else 0, "pass %d of %d" % (ok, total))] + [("failing-check", 0, f) for f in fails]
    live = ctx.http(LIVE_EMAIL_HEALTH, timeout=15, max_bytes=8192)
    if live.status == 200:
        guard = '"injection_guard":true' in live.text.replace(" ", "")
        rows.append(("deployed qnfo-email /health", 1 if guard else 0, "injection_guard reported" if guard else "the deployed worker does not report injection_guard yet (the suite proves the code on main, not the deployment)"))
    else:
        rows.append(("deployed qnfo-email /health", None, "unreadable (%s)" % (live.error or live.status)))
    note = "pass %d of %d checks of %s on this checkout of main (offline fakes, no live model); personal-api twin and qnfo-social reply reading are not covered yet" % (ok, total, EVAL_SUITE)
    return [Result("injection_eval_pass_rate", round(ok / float(total), 4), note, rows)]


# ---------------------------------------------------------------- 2. outbound_mail_to_non_sender
OUTBOUND_SQL = (
    "SELECT s.id AS id, CASE "
    "WHEN %(fleet)s THEN 'fleet-domain' "
    "WHEN lower(s.recipient) IN (%(owner)s) THEN 'owner' "
    "WHEN EXISTS (SELECT 1 FROM emails i WHERE i.status <> 'sent' AND lower(i.sender) = lower(s.recipient) AND datetime(i.received_at) < datetime(s.received_at) "
    "AND datetime(i.received_at) >= datetime(s.received_at, '-90 days')) THEN 'prior-inbound-sender' "
    "%(allow)s"
    "ELSE 'other' END AS cat FROM emails s WHERE s.status = 'sent' AND datetime(s.received_at) >= datetime(?1)")


def outbound_sql(with_allowlist):
    fleet = " OR ".join("lower(s.recipient) LIKE '%%@%s'" % d for d in FLEET_DOMAINS)
    allow = ("WHEN EXISTS (SELECT 1 FROM agent_send_allowlist a WHERE a.enabled = 1 AND (lower(s.recipient) = lower(a.pattern) OR "
             "(substr(a.pattern, 1, 1) = '@' AND lower(s.recipient) LIKE '%' || lower(a.pattern)))) THEN 'allow-listed' ") if with_allowlist else ""
    return OUTBOUND_SQL % {"fleet": fleet, "owner": ", ".join("'%s'" % o for o in OWNER), "allow": allow}


def collect_outbound(ctx):
    since = since_iso(ctx, 7)
    with_allow = True
    try:
        rows = ctx.d1(outbound_sql(True), [since])
    except Exception:  # noqa: BLE001  (the allow-list table is created by the migration; before it exists the same question is asked without it)
        with_allow = False
        rows = ctx.d1(outbound_sql(False), [since])
    cats = {}
    others = []
    for r in rows:
        cats[r["cat"]] = cats.get(r["cat"], 0) + 1
        if r["cat"] == "other":
            others.append(r["id"])
    evidence = [("category:" + k, None, "%d sent mail(s)" % v) for k, v in sorted(cats.items())]
    evidence += [("email:%s" % i, 0, "recipient is not an original sender, an owner, a fleet or an allow-listed address") for i in others[:40]]
    try:
        refused = ctx.d1("SELECT COUNT(*) AS n FROM email_send_violations WHERE violation IN ('AGENT-SEND-POLICY', 'DRAIN-GUARD-HELD') AND datetime(detected_at) >= datetime(?1)", [since])
        evidence.append(("refused by the send policy, 7 days", None, "%s attempt(s) stopped before sending" % (refused[0]["n"] if refused else 0)))
    except Exception:  # noqa: BLE001
        pass
    note = ("%d agent-sent mail(s) in 7 days in qnfo-audit.emails; %d to a recipient that is not an original sender, owner, fleet address%s; "
            "mail sent by qnfo-outreach, qnfo-subscribers and the digests is not in this ledger") % (len(rows), len(others), " or allow-listed address" if with_allow else " (allow-list table not created yet)")
    return [Result("outbound_mail_to_non_sender", len(others), note, evidence)]


# ---------------------------------------------------------------- 3. agent_tool_calls_outside_allowlist
def host_of(url):
    try:
        return (urllib.parse.urlparse(str(url or "")).hostname or "").lower()
    except ValueError:
        return ""


def host_allowed(host, patterns):
    return any(host == p or host.endswith("." + p) for p in patterns)


def collect_tool_calls(ctx):
    since = since_iso(ctx, 7)
    try:
        allow = ctx.d1("SELECT surface, kind, pattern FROM agent_tool_allowlist WHERE enabled = 1")
    except Exception as e:  # noqa: BLE001
        return [Result("agent_tool_calls_outside_allowlist", None, "agent_tool_allowlist unreadable (%s): the migration has not been applied" % str(e)[:80], [])]
    tools = {}
    hosts = []
    for r in allow:
        if r["kind"] == "tool":
            tools.setdefault(r["surface"], set()).add(r["pattern"])
        elif r["kind"] == "egress":
            hosts.append(str(r["pattern"]).lower())
    if not tools or not hosts:
        return [Result("agent_tool_calls_outside_allowlist", None, "the allow-list is empty: an empty list is unknown, never zero", [])]
    ops_calls = ctx.d1("SELECT text AS tool, COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'ops_ai_tool' AND ts >= ?1 GROUP BY text", [since])
    mcp_calls = ctx.d1("SELECT tool, COUNT(*) AS n FROM mcp_log WHERE ts >= ?1 GROUP BY tool", [since])
    outside, evidence, total_calls = 0, [], 0
    # MCP-LOG-TWO-WRITERS-1 (2026-11-05, BP26 breach agent_tool_calls_outside_allowlist 5): mcp_log is written by TWO servers, qnfo-tools-mcp and qnfo-memory-mcp
    # (both INSERT INTO mcp_log; the table has no server column). search_papers, a qnfo-memory-mcp tool, was counted against qnfo-tools-mcp's list and read as
    # an unlisted tool. A logged MCP call is allowed when ANY MCP surface that writes the table lists the tool.
    mcp_allowed = set()
    for s in MCP_LOG_SURFACES:
        mcp_allowed |= tools.get(s, set())
    for surface, calls in (("qnfo-ops", ops_calls), ("qnfo-tools-mcp", mcp_calls)):
        allowed = tools.get(surface, set()) if surface == "qnfo-ops" else mcp_allowed
        n_out = 0
        for c in calls:
            total_calls += int(c["n"])
            if str(c["tool"]) not in allowed:
                n_out += int(c["n"])
                evidence.append(("tool:%s:%s" % (surface, c["tool"]), 0, "%d call(s) to a tool no allow-list row permits" % int(c["n"])))
        outside += n_out
    # egress: the URL host of the calls that fetch (the ops event keeps its args, the MCP log keeps them as JSON text)
    urls = []
    for r in ctx.d1("SELECT text AS tool, json_extract(meta, '$.args.url') AS url FROM cloud_ops_events WHERE kind = 'ops_ai_tool' AND ts >= ?1 AND text IN ('%s') AND json_extract(meta, '$.args.url') IS NOT NULL LIMIT 3000" % "', '".join(EGRESS_TOOLS), [since]):
        urls.append(("qnfo-ops", r["tool"], r["url"]))
    for r in ctx.d1("SELECT tool, json_extract(args, '$.url') AS url FROM mcp_log WHERE ts >= ?1 AND tool IN ('%s') AND json_valid(args) AND json_extract(args, '$.url') IS NOT NULL LIMIT 3000" % "', '".join(EGRESS_TOOLS), [since]):
        urls.append(("qnfo-tools-mcp", r["tool"], r["url"]))
    by_host = {}
    for surface, tool, url in urls:
        h = host_of(url)
        if not h or host_allowed(h, hosts):
            continue
        by_host[h] = by_host.get(h, 0) + 1
    egress_out = sum(by_host.values())
    for h, n in sorted(by_host.items(), key=lambda kv: -kv[1])[:30]:
        evidence.append(("egress-host:" + h, 0, "%d fetch(es) to a host no egress row permits" % n))
    evidence.append(("egress-calls-checked", None, "%d fetch call(s) with a URL; %d to %d host(s) outside the list" % (len(urls), egress_out, len(by_host))))
    note = ("%d tool call(s) in 7 days (ops_ai_tool + mcp_log): %d to a tool outside the allow-list, %d fetches to %d host(s) outside it; "
            "network access inside shell_exec, run_code_net and container tools is not attributable to a host from this log") % (total_calls, outside, egress_out, len(by_host))
    return [Result("agent_tool_calls_outside_allowlist", outside + egress_out, note, evidence)]


COLLECTORS = [
    Collector("agentsec_injection_eval", collect_injection_eval, ["injection_eval_pass_rate"], 50),
    Collector("agentsec_outbound_non_sender", collect_outbound, ["outbound_mail_to_non_sender"], 50),
    Collector("agentsec_tool_allowlist", collect_tool_calls, ["agent_tool_calls_outside_allowlist"], 50),
]


# ---------------------------------------------------------------- selftest
def selftest():
    import tempfile
    from bp26_producers import Ctx, Resp
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
            print("FAIL " + m)
    ok(host_of("https://API.GitHub.com/x?y=1") == "api.github.com" and host_of("nonsense") == "", "host_of")
    ok(host_allowed("api.github.com", ["github.com"]) and not host_allowed("evilgithub.com", ["github.com"]) and host_allowed("github.com", ["github.com"]), "host_allowed is a suffix match on a dot boundary")
    ok(EVAL_RE.search("x\nINJECTION_EVAL pass=58 total=61\n").groups() == ("58", "61"), "eval line regex")
    # the evaluator, against a fake suite
    td = tempfile.mkdtemp()
    os.makedirs(os.path.join(td, "qnfo-email"))
    with open(os.path.join(td, "qnfo-email", "injection-redteam.test.mjs"), "w") as f:
        f.write("console.log('FAIL one check');\nconsole.log('INJECTION_EVAL pass=3 total=4');\nprocess.exit(1);\n")
    if shutil.which("node"):
        r = run_eval(td)
        ok(r is not None and r[0] == 3 and r[1] == 4 and r[2] == ["FAIL one check"], "run_eval reads the last INJECTION_EVAL line of a failing suite: %r" % (r,))
        live_ok = Resp(200, {}, [], '{"injection_guard": true}', LIVE_EMAIL_HEALTH, 5, [], None)
        out = collect_injection_eval(Ctx(root=td, http=lambda url, **k: live_ok))
        ok(out[0].value == 0.75 and any(r_[0] == "deployed qnfo-email /health" and r_[1] == 1 for r_ in out[0].rows), "pass rate 0.75 and the live guard row: %r" % (out,))
    out = collect_injection_eval(Ctx(root=os.path.join(td, "missing")))
    ok(out[0].value is None, "no suite means unknown, never a value")
    # outbound and tool calls against an in-memory qnfo-audit shim
    c = sqlite3.connect(":memory:")
    c.executescript("""
CREATE TABLE emails (id INTEGER PRIMARY KEY, sender TEXT, recipient TEXT, status TEXT, received_at TEXT);
CREATE TABLE agent_send_allowlist (pattern TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1);
CREATE TABLE email_send_violations (id INTEGER PRIMARY KEY, detected_at TEXT, violation TEXT);
CREATE TABLE agent_tool_allowlist (surface TEXT, kind TEXT, pattern TEXT, note TEXT, enabled INTEGER DEFAULT 1);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT);
CREATE TABLE mcp_log (id TEXT, ts TEXT, tool TEXT, args TEXT);
""")
    now = "2026-10-26T12:00:00Z"
    c.executemany("INSERT INTO emails VALUES (?,?,?,?,?)", [
        (1, "q@qnfo.org", "alerts@qnfo.org", "sent", "2026-10-25T10:00:00.000Z"),           # fleet domain
        (2, "q@qnfo.org", "rwnquni@outlook.com", "sent", "2026-10-25 11:00:00"),            # owner
        (3, "jane@uni.test", "rowan.quni@qnfo.org", "received", "2026-10-24T09:00:00.000Z"),  # inbound from jane
        (4, "q@qnfo.org", "jane@uni.test", "sent", "2026-10-25T12:00:00.000Z"),             # a reply to the original sender
        (5, "q@qnfo.org", "stranger@evil.test", "sent", "2026-10-25T13:00:00.000Z"),        # a cold send to a stranger
        (6, "q@qnfo.org", "x@partner.test", "sent", "2026-10-25T14:00:00.000Z"),            # allow-listed
        (7, "q@qnfo.org", "old@evil.test", "sent", "2026-09-01T14:00:00.000Z"),             # outside the window
    ])
    c.execute("INSERT INTO agent_send_allowlist (pattern) VALUES ('@partner.test')")
    c.execute("INSERT INTO email_send_violations VALUES (1, '2026-10-26 01:00:00', 'AGENT-SEND-POLICY')")

    def d1(sql, params=None):
        cur = c.execute(sql, params or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    ctx = Ctx(d1=d1, now=1793016000.0)  # 2026-10-26T12:00:00Z
    out = collect_outbound(ctx)[0]
    ok(out.value == 1 and out.rows[0][0].startswith("category:") and not any("@" in str(r_[2]) or "@" in str(r_[0]) for r_ in out.rows), "one cold send to a stranger, no address in the evidence: %r" % (out,))
    c.execute("DROP TABLE agent_send_allowlist")
    out = collect_outbound(ctx)[0]
    ok(out.value == 2 and "not created yet" in out.note, "without the allow-list table the allow-listed mail counts as other and the note says so: %r" % (out,))
    out = collect_tool_calls(ctx)[0]
    ok(out.value is None, "an empty allow-list is unknown")
    c.executemany("INSERT INTO agent_tool_allowlist (surface, kind, pattern) VALUES (?,?,?)", [("qnfo-ops", "tool", "web_fetch"), ("qnfo-ops", "tool", "ops_d1_query"), ("qnfo-tools-mcp", "tool", "web_fetch"), ("*", "egress", "github.com"), ("*", "egress", "qnfo.org")])
    ev = lambda t, tool, url: ("e%s" % abs(hash((t, tool, url))), "2026-10-25T10:00:00.000Z", "ops_ai_tool", tool, '{"args":{"url":"%s"}}' % url)  # noqa: E731
    c.executemany("INSERT INTO cloud_ops_events VALUES (?,?,?,?,?)", [
        ev(1, "web_fetch", "https://api.github.com/x"), ev(2, "web_fetch", "https://papers.qnfo.org/p"), ev(3, "web_fetch", "https://evil.test/c?d=1"),
        ev(4, "web_fetch", "https://evil.test/d"), ev(5, "ops_d1_query", ""), ev(6, "rm_everything", "")])
    c.execute("INSERT INTO mcp_log VALUES ('m1', '2026-10-25T10:00:00.000Z', 'web_fetch', '{\"url\": \"https://github.com/a\"}')")
    c.execute("INSERT INTO mcp_log VALUES ('m2', '2026-10-25T10:00:00.000Z', 'owner_act', '{}')")
    out = collect_tool_calls(ctx)[0]
    # outside: tool rm_everything (ops) + owner_act (mcp) = 2; egress: evil.test x2 = 2
    ok(out.value == 4, "two unlisted tools and two fetches to an unlisted host: %r" % (out,))
    ok(any(r_[0] == "egress-host:evil.test" for r_ in out.rows) and any(r_[0] == "tool:qnfo-ops:rm_everything" for r_ in out.rows), "the evidence names the host and the tool")
    # MCP-LOG-TWO-WRITERS-1: a tool that only the second MCP server (qnfo-memory-mcp) lists is not outside the list, and an unlisted one still is.
    c.execute("INSERT INTO agent_tool_allowlist (surface, kind, pattern) VALUES ('qnfo-memory-mcp', 'tool', 'search_papers')")
    c.execute("INSERT INTO mcp_log VALUES ('m3', '2026-10-25T10:00:00.000Z', 'search_papers', '{}')")
    out = collect_tool_calls(ctx)[0]
    ok(out.value == 4 and not any(r_[0] == "tool:qnfo-tools-mcp:search_papers" for r_ in out.rows), "search_papers listed by qnfo-memory-mcp is not an unlisted tool: %r" % (out,))
    c.execute("INSERT INTO mcp_log VALUES ('m4', '2026-10-25T10:00:00.000Z', 'not_a_tool', '{}')")
    out = collect_tool_calls(ctx)[0]
    ok(out.value == 5 and any(r_[0] == "tool:qnfo-tools-mcp:not_a_tool" for r_ in out.rows), "an unlisted MCP tool is still counted: %r" % (out,))
    ok(len(COLLECTORS) == 3 and all(x.metrics for x in COLLECTORS), "three collectors with their metrics")
    print("bp26_agentsec selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print("bp26_agentsec is a collector module: python3 scripts/bp26_producers.py --dry --only agentsec_outbound_non_sender")
