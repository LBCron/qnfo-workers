#!/usr/bin/env python3
"""CONFLICT-REPAIR-SETTLE-2 offline test (2026-10-19, PR 2603 review, charter pillar autonomy).

settle_issue closes the repair issue of a merged or closed pull request. It failed for good on the live schema: issue_triage
.sla_due_at is NOT NULL with no default, and SQLite checks NOT NULL before an ON CONFLICT upsert. This runs the statements
against an in-memory SQLite with the LIVE issue_triage definition (read from sqlite_master of qnfo-audit on 2026-10-19) and the
live close triggers (issue_close_evidence_required with CLOSE-BINDS-TO-PROBE-1, issue_close_evidence_weak_predicate_upd), so a
statement the real database would refuse fails here.

Run: python3 scripts/conflict_repair_test.py
"""
import os
import calendar
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["CLOUDFLARE_ACCOUNT_ID"] = "acct"
os.environ["CLOUDFLARE_API_TOKEN"] = "tok-test"

import apply_migrations  # noqa: E402
import conflict_repair as cr  # noqa: E402

# SUITE-IDLE-TIMER-1: repair() clears the zero-job runs of its push with the real sleep (PHANTOM_PASSES - 1 waits of PHANTOM_WAIT_S); the drive() cases
# below call it twice and idled 2 x 16 s with no network. The passes still run; only the wait between them is dropped.
cr.PHANTOM_WAIT_S = 0

fails = 0


def check(cond, msg, extra=None):
    global fails
    if cond:
        print("ok   " + msg)
    else:
        fails += 1
        print("FAIL " + msg + ("" if extra is None else " -- " + repr(extra)))


# Live definitions, copied from sqlite_master of qnfo-audit.
SCHEMA = """
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'open', updated_at INTEGER, close_channel TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT NOT NULL, triage_state TEXT NOT NULL DEFAULT 'triaged', owner TEXT NOT NULL, sla_due_at TEXT NOT NULL, triaged_at TEXT DEFAULT (datetime('now')), remediation TEXT, close_evidence TEXT, reopened_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE remediation_contracts (id INTEGER PRIMARY KEY, issue_id INTEGER, status TEXT, last_verdict TEXT);
CREATE TRIGGER issue_close_evidence_weak_predicate_upd BEFORE UPDATE OF close_evidence ON issue_triage WHEN NEW.close_evidence IS NOT NULL AND NEW.close_evidence LIKE '%present in%' AND NEW.close_evidence LIKE '%directory listing%' BEGIN SELECT RAISE(ABORT,'CLOSE-EVIDENCE-WEAK-PREDICATE-1: file presence is not defect resolution (issue 1698)'); END;
CREATE TRIGGER issue_close_evidence_required
BEFORE UPDATE OF status ON agent_issues
WHEN NEW.status IN ('closed','resolved','wontfix') AND OLD.status NOT IN ('closed','resolved','wontfix')
BEGIN
  SELECT RAISE(ABORT,'close-without-evidence')
    WHERE NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND t.close_evidence IS NOT NULL AND TRIM(t.close_evidence) <> '');
  SELECT RAISE(ABORT,'close-while-contract-fails')
    WHERE NEW.status IN ('closed','resolved')
      AND EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = NEW.id
                    AND c.status IN ('active','holding')
                    AND COALESCE(c.last_verdict,'') IN ('fail','vacuous-probe-result','probe-error','probe-not-machine-executable','probe-same-account-host'));
END;
"""


def fresh():
    db = sqlite3.connect(":memory:")
    db.executescript(SCHEMA)
    return db


def fake_d1(db):
    def d1(acct, token, db_id, sql, params=None):
        cur = db.execute(sql, params or [])
        rows = [dict(zip([c[0] for c in cur.description], r)) for r in cur.fetchall()] if cur.description else []
        db.commit()
        return rows
    return d1


def add_issue(db, iid, pr, triage=True, contract=None):
    db.execute("INSERT INTO agent_issues (id, title) VALUES (?1, ?2)", [iid, "STALE-PR-CONFLICT-REPAIR-1 PR %d: merge conflicts" % pr])
    if triage:
        db.execute("INSERT INTO issue_triage (issue_id, rc, owner, sla_due_at) VALUES (?1, 'AUTOTRIAGE-1', 'qnfo-ops', '2026-10-18 15:10:12')", [iid])
    if contract:
        db.execute("INSERT INTO remediation_contracts (issue_id, status, last_verdict) VALUES (?1, 'active', ?2)", [iid, contract])
    db.commit()


def state(db, iid):
    return db.execute("SELECT a.status, t.close_evidence, t.rc FROM agent_issues a LEFT JOIN issue_triage t ON t.issue_id = a.id WHERE a.id = ?1", [iid]).fetchone()


def channel(db, iid):
    return db.execute("SELECT close_channel FROM agent_issues WHERE id = ?1", [iid]).fetchone()[0]


EV = cr.settled_evidence({"number": 2144, "state": "closed", "merged_at": None, "closed_at": "2026-10-19T01:00:00Z"})
db = fresh()
apply_migrations.d1 = fake_d1(db)

# 0. the failure this test pins: the first settle statement is refused by the live definition, with or without a triage row.
bad = fresh()
add_issue(bad, 1, 2144)
try:
    bad.execute("INSERT INTO issue_triage (issue_id, rc, owner, close_evidence) VALUES (1, 'x', 'y', 'z') ON CONFLICT(issue_id) DO UPDATE SET close_evidence = excluded.close_evidence")
    refused = ""
except sqlite3.IntegrityError as e:
    refused = str(e)
check("sla_due_at" in refused, "the old INSERT ... ON CONFLICT is refused by the live issue_triage (NOT NULL sla_due_at)", refused)

# 1. an issue with its AUTOTRIAGE-1 row: the evidence is written, the issue closes, rc and sla are kept.
add_issue(db, 10, 2144)
check(cr.settle_issue(2144, EV) is True, "settle_issue returns True for an issue with a triage row")
st = state(db, 10)
check(st == ("closed", EV, "AUTOTRIAGE-1"), "the issue is closed with the GitHub read as evidence and its triage row kept", st)
# CLOSE-CHANNEL-REQUIRED-1 (agent_issues 100419): the close names its channel; 1000254, 1000256, 1000270, 1000365 and 100422 closed with NULL.
check(channel(db, 10) == "auto:conflict-repair-settle", "the settle close writes close_channel 'auto:conflict-repair-settle' (a NULL channel cannot be attributed to a fix, a probe or a sweep)", channel(db, 10))

# 2. an issue with no triage row: the guarded INSERT supplies every NOT NULL column.
add_issue(db, 11, 2589, triage=False)
check(cr.settle_issue(2589, EV) is True, "settle_issue returns True for an issue with no triage row")
st = state(db, 11)
check(st == ("closed", EV, "CONFLICT-REPAIR-SETTLE-1"), "a missing triage row is created with sla_due_at and the issue closes", st)
check(db.execute("SELECT sla_due_at FROM issue_triage WHERE issue_id = 11").fetchone()[0] is not None, "the created row has sla_due_at")
check(channel(db, 11) == "auto:conflict-repair-settle", "an issue that had no triage row is closed with the channel too", channel(db, 11))

# 3. CLOSE-BINDS-TO-PROBE-1 is not bypassed: a failing active contract keeps the issue open and the refusal is reported.
add_issue(db, 12, 2629, contract="fail")
check(cr.settle_issue(2629, EV) is False, "settle_issue returns False when a failing contract refuses the close")
check(state(db, 12)[0] == "open", "the issue stays open while its contract fails", state(db, 12))
check(channel(db, 12) is None, "a refused close leaves no close_channel behind", channel(db, 12))

# 4. only the open issue of the named pull request is touched; a second run is a no-op.
add_issue(db, 13, 91)
check(cr.settle_issue(2144, EV) is True and state(db, 13)[0] == "open", "another pull request's issue is untouched, a second run is a no-op")
check(channel(db, 13) is None and channel(db, 10) == "auto:conflict-repair-settle", "and a second run neither stamps the open issue nor rewrites the closed one's channel")

# 5. repair() reports the settle honestly.
orig_gh, orig_elig, orig_settle = cr.gh, cr.eligible, cr.settle_issue
cr.gh = lambda path: {"number": 2144, "state": "closed", "merged_at": None, "closed_at": "x"}
cr.eligible = lambda pr: "not open"
cr.settle_issue = lambda n, e: False
check(cr.repair(2144, push=True)["outcome"] == "settle-failed", "repair() says settle-failed when the close did not land")
cr.settle_issue = lambda n, e: True
check(cr.repair(2144, push=True)["outcome"] == "settled", "repair() says settled when it did")
cr.gh, cr.eligible, cr.settle_issue = orig_gh, orig_elig, orig_settle

# 6. PR-GUARD-FIXES-1 (agent_issues 100295): a push with GITHUB_TOKEN creates pull_request runs that start no job (run 39318576612: 0 jobs,
# failed the second PR 3106 merged), so the checks the merge lane requires are dispatched on the pushed branch. mirror-guard.yml was missing
# from DISPATCHABLE, so a repaired head had no mirror-guard result until a person re-ran it (PR 3106 waited four hours).
import re  # noqa: E402
import types  # noqa: E402

WF_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".github", "workflows")
check("mirror-guard.yml" in cr.DISPATCHABLE and len(set(cr.DISPATCHABLE)) == len(cr.DISPATCHABLE), "DISPATCHABLE names mirror-guard.yml, each workflow once", cr.DISPATCHABLE)
for wf_name in cr.DISPATCHABLE:
    wf_path = os.path.join(WF_DIR, wf_name)
    wf_text = open(wf_path, encoding="utf-8").read() if os.path.isfile(wf_path) else ""
    check(re.search(r"^  workflow_dispatch:", wf_text, re.M) is not None, "%s exists and declares workflow_dispatch, so `gh workflow run` can start it (repair() runs that command with check=False, a workflow without the trigger would fail silently)" % wf_name)


def drive(in_place, base_branch="main", delta="1\t1\tscripts/fix.py\n", head_moved=False):
    """Run repair() for one PR with git, GitHub and checks stubbed."""
    calls, git_calls, trace = [], [], {}
    pr = {"number": 5, "state": "open", "title": "fix x", "body": "", "head": {"sha": "abcdef1234567", "ref": "fix/x"}, "base": {"ref": base_branch}}

    def fake_gh(path, method="GET", fields=None, raw=False):
        if path.endswith("/pulls/5"):
            return pr
        if "/files" in path:
            return []
        if "/comments" in path:
            return []
        if "/commits/" in path:
            return {"commit": {"committer": {"date": "2026-11-03T00:00:00Z"}}}
        if path.endswith("/pulls") and method == "POST":
            trace["replacement_base"] = fields.get("base")
            return {"number": 9}
        return {}

    def fake_sh(args, cwd=None, check=True, timeout=900, env=None):
        calls.append(list(args))
        if args[:2] == ["git", "push"]:
            trace["pushed"] = True
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")
    def fake_git(args, cwd=None, check=True):
        git_calls.append(list(args))
        if args[:1] == ["rev-parse"] and args[-1] == "refs/remotes/origin/pr-5":
            return ("new-head" if head_moved else pr["head"]["sha"]) + "\n"
        if args[:2] == ["diff", "--numstat"]:
            return delta
        return "0123456789abcdef\n"
    def fake_reapply(head, base, branch, cwd=None, message=None, in_place=False):
        trace["reapply_base"] = base
        return {"outcome": "reapplied", "workers": [], "resolved": []}
    def fake_bump(workers, number, cwd=None, claims=cr.claimed_versions, base_branch="main", release_kinds=None):
        trace["bump_base"] = base_branch
        return []
    def fake_checks(workers, base, cwd=None):
        trace["check_base"] = base
        return [("suites", True)]
    names = ["gh", "eligible", "attempted", "landed_on_base", "reapply", "bump_workers", "git", "run_checks", "ledger", "sh"]
    saved = {n: getattr(cr, n) for n in names}
    cr.gh, cr.eligible, cr.attempted = fake_gh, (lambda p: None), (lambda n, s: False)
    cr.landed_on_base = lambda head, base, cwd=None: (trace.update({"landed_base": base}) or [])
    cr.reapply, cr.bump_workers, cr.git, cr.run_checks = fake_reapply, fake_bump, fake_git, fake_checks
    cr.ledger = lambda *a, **k: None
    cr.sh = fake_sh
    try:
        res = cr.repair(5, push=True, in_place=in_place)
    finally:
        for n, f in saved.items():
            setattr(cr, n, f)
    return res, [c for c in calls if c[:3] == ["gh", "workflow", "run"]], trace, git_calls


res, runs, trace, git_calls = drive(True, "release/next")
check(res.get("outcome") == "updated", "in-place repair of a conflicting pull request ends updated", res)
check(trace.get("landed_base") == "refs/remotes/origin/pr-base-5" and trace.get("reapply_base") == trace.get("landed_base")
      and trace.get("check_base") == trace.get("landed_base") and trace.get("bump_base") == "release/next"
      and ["fetch", "-q", "origin", "+refs/heads/release/next:refs/remotes/origin/pr-base-5"] in git_calls,
      "in-place repair fetches, resolves, bumps and checks against the pull request's actual base branch", [trace, git_calls])
check([c[3] for c in runs] == cr.DISPATCHABLE and "mirror-guard.yml" in [c[3] for c in runs], "in place: every DISPATCHABLE workflow, mirror-guard.yml included, is dispatched", runs)
check(all(c[c.index("--ref") + 1] == "fix/x" for c in runs), "in place: each dispatch targets the pull request's own branch", runs)
res, runs, trace, git_calls = drive(False, "release/next")
check(res.get("outcome") == "replaced", "a replacement pull request is opened and the old one superseded", res)
_, delivery_body = cr.replacement_text({"number": 5, "title": "Fix", "body": "Refs #7"}, [], [("suites", True)])
check("Definition of done (CODE-CHANGE-REQUIRED-1)" in delivery_body and "Refs #7" in delivery_body,
      "replacement PRs preserve linkage and require code changes in their DoD")
check(cr.numstat_has_code_changes("1\t0\tscripts/fix.py\n") and not cr.numstat_has_code_changes("1\t0\tdocs/report.md\n"),
      "conflict repair uses the publisher's shared implementation-diff guard")
check(trace.get("replacement_base") == "release/next", "a replacement pull request preserves the original base branch", trace)
check([c[3] for c in runs] == cr.DISPATCHABLE and "mirror-guard.yml" in [c[3] for c in runs], "replacement: every DISPATCHABLE workflow, mirror-guard.yml included, is dispatched", runs)
check(all(c[c.index("--ref") + 1] == "repair/pr-5-abcdef1" for c in runs), "replacement: each dispatch targets the repair branch", runs)
for in_place in (True, False):
    for delta in ("", "1\t0\tdocs/report.md\n", "0\t0\tscripts/fix.py\n"):
        res, runs, trace, git_calls = drive(in_place, delta=delta)
        check(res.get("outcome") == "no-code-change" and not runs
              and not trace.get("replacement_base") and not trace.get("pushed")
              and not any(c[0] == "push" for c in git_calls),
              "empty, investigation-only and zero-line repair diffs never push or open a PR", res)
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "conflict_repair.py"), encoding="utf-8").read()
check("starts no pull_request workflow" not in src and "starts none by itself" not in src, "the comments no longer say a GITHUB_TOKEN push starts no pull_request workflow (it starts runs that never get a job)")

# 7. CLOSE-CHANNEL-REQUIRED-1 (agent_issues 100419): every statement in the three scripts of this family that sets an issue closed, resolved or
# wontfix also sets close_channel. A new closing site that forgets it fails here, not in the 48 h NULL count.
HERE = os.path.dirname(os.path.abspath(__file__))
closers = {}
for script in ("conflict_repair.py", "apply_migrations.py", "canary_revert.py"):
    text = open(os.path.join(HERE, script), encoding="utf-8").read()
    for m in re.finditer(r"UPDATE\s+agent_issues\s+SET\b", text, re.I):
        set_part = text[m.end(): m.end() + 900]
        w = re.search(r"\bWHERE\b", set_part, re.I)
        set_part = set_part[: w.start()] if w else set_part[:400]
        if re.search(r"\bstatus\s*=\s*'(closed|resolved|wontfix)'", set_part, re.I):
            closers.setdefault(script, []).append("close_channel" in set_part)
check(closers.get("conflict_repair.py") == [True] and closers.get("apply_migrations.py") == [True], "every closing UPDATE agent_issues in conflict_repair.py and apply_migrations.py sets close_channel (one closing site each)", closers)
check(all(all(v) for v in closers.values()), "no closing statement in the scripts omits close_channel", closers)
check("close_channel = 'auto:conflict-repair-settle'" in cr.SETTLE_CLOSE_SQL and "close_channel = 'auto:migration-apply-resolve'" in apply_migrations.RESOLVE_CLOSE_SQL, "the two channels are the named values the closing probe counts", (cr.SETTLE_CLOSE_SQL, apply_migrations.RESOLVE_CLOSE_SQL))

import tempfile  # noqa: E402

base_source = 'var VERSION = "1.0.0"; /* base */\nconst value = 1;\n\nfunction other() { return 1; }\n'
pr_source = base_source.replace("1.0.0", "1.0.1-pr").replace("value = 1", "value = 2")
main_source = base_source.replace("1.0.0", "1.0.1-main").replace("return 1", "return 3")
merged = cr.merge_worker_metadata(pr_source, base_source, main_source)
check(merged is not None and "value = 2" in merged and "return 3" in merged
      and cr.read_version(merged) == "1.0.1-pr", "metadata isolation preserves both independent code edits")
check(cr.merge_worker_metadata(pr_source, base_source, main_source.replace("value = 1", "value = 9")) is None,
      "a genuine code overlap is never resolved by choosing a side")
check(cr.merge_worker_metadata(pr_source + 'var VERSION = "9.0.0";\n', base_source, main_source) is None,
      "duplicate VERSION declarations refuse metadata isolation")
check(cr.merge_worker_metadata(pr_source.replace("/* base */", "doSomething();"), base_source, main_source) is None,
      "executable code after VERSION is never discarded")
formatted = pr_source.replace('var VERSION = ', '\tvar   VERSION\t= ')
check(cr.read_version(formatted) == "1.0.1-pr"
      and cr.read_version(cr.set_version(formatted, "1.0.2")) == "1.0.2"
      and cr.merge_worker_metadata(formatted, base_source, main_source) is not None,
      "indented and spaced declarations parse, bump and merge consistently")
check("/* main note */" in cr.chain_notes('var VERSION = "1.0.1";', 'var VERSION = "1.0.2"; /* main note */'),
      "main release notes survive when the PR has no inline note")
note_base = base_source.replace("/* base */", "/* base */\n/* old note */")
note_pr = note_base.replace("1.0.0", "1.1.0-pr").replace("/* old note */", "/* pr note */\n/* old note */")
note_main = note_base.replace("1.0.0", "1.0.2-main").replace("/* old note */", "/* main note */\n/* old note */")
note_merged = cr.merge_worker_metadata(note_pr, note_base, note_main)
check(note_merged is not None and all(note_merged.count(n) == 1 for n in ("/* pr note */", "/* main note */", "/* old note */")),
      "split release-note history is retained without duplicate common notes")
for old, new, claimed, expected in [
    ("1.0.0", "1.0.1-fix", "1.1.3", "1.1.4-fix"),
    ("1.0.0", "1.1.0-feature", "1.1.3", "1.2.0-feature"),
    ("1.0.0", "2.0.0-breaking", "2.1.3", "3.0.0-breaking"),
    ("v1.0.0", "v1.1.0-feature", "v1.1.3", "v1.2.0-feature"),
]:
    check(cr.bump_above(new, [claimed], cr.release_kind(old, new)) == expected,
          "repair preserves declared release category and suffix: " + expected)
check(cr.core("v1.2") == cr.core("1.2.0") == cr.core("1.2.0.0"),
      "numeric version parsing matches the guard's padded comparison")

for in_place in (False, True):
    with tempfile.TemporaryDirectory(prefix="version-repair-test-") as directory:
        def g(*args):
            return cr.git(list(args), directory)
        def put(text):
            for name in ("worker.js", "deployed-current.worker.js"):
                with open(os.path.join(directory, "w", name), "w", encoding="utf-8") as fh:
                    fh.write(text)
        g("init", "-q", "-b", "main")
        g("config", "user.email", "test@example.invalid")
        g("config", "user.name", "test")
        os.mkdir(os.path.join(directory, "w"))
        put(base_source); g("add", "-A"); g("commit", "-qm", "base")
        g("checkout", "-q", "-b", "pr"); put(pr_source); g("commit", "-qam", "pr")
        pr_sha = g("rev-parse", "HEAD").strip()
        g("checkout", "-q", "main"); put(main_source); g("commit", "-qam", "main")
        main_sha = g("rev-parse", "HEAD").strip()
        result = cr.reapply("pr", "main", "repair-local", directory, in_place=in_place)
        with open(os.path.join(directory, "w", "worker.js"), encoding="utf-8") as fh:
            source = fh.read()
        with open(os.path.join(directory, "w", "deployed-current.worker.js"), encoding="utf-8") as fh:
            mirror = fh.read()
        check(result["outcome"] == "reapplied" and source == mirror
              and "value = 2" in source and "return 3" in source,
              "real Git repair resolves VERSION plus adjacent code, mirrors source: in_place=" + str(in_place), result)
        cr.bump_workers(result["workers"], 1, directory, claims=lambda *_: ["1.0.4"],
                        release_kinds=result["release_kinds"])
        g("commit", "-qm", "resolved")
        parents = g("show", "-s", "--format=%P", "HEAD").strip().split()
        check(parents == ([pr_sha, main_sha] if in_place else [main_sha, pr_sha]),
              "repair finalizes a true two-parent merge with the original branch as first parent")
        check(g("diff", "--name-only", "--diff-filter=U").strip() == "", "no unmerged index entries remain")
        check(cr.sh([sys.executable, os.path.join(HERE, "version-bump-guard.py"), "main", "HEAD"],
                    directory, check=False).returncode == 0, "repaired version passes the existing monotonic version guard")

sample = {"number": 7, "head": {"sha": "head"}, "base": {"sha": "base", "ref": "main"}}
def version_api(path, method="GET", raw=False):
    if "/files?" in path:
        return [{"filename": "w/worker.js", "status": "modified"}]
    return main_source if "ref=base" in path else pr_source
check(cr.stale_worker_versions(sample, version_api), "clean merge with an equal-core changed worker requires normalization")
check(not cr.stale_worker_versions(sample, lambda path, **kwargs:
      [{"filename": "w/worker.js", "status": "modified"}] if "/files?" in path
      else (main_source if "ref=base" in path else pr_source.replace("1.0.1-pr", "1.0.2-pr"))),
      "already-ahead versions do not trigger a normalization loop")
try:
    cr.stale_worker_versions(sample, lambda *args, **kwargs: None)
    unreadable = False
except RuntimeError:
    unreadable = True
check(unreadable, "an unreadable diff never authorizes a safe empty repair")
pages = []
def paged_files(path):
    pages.append(path)
    return [{"filename": "w/worker.js"}] * 100 if path.endswith("&page=1") else [{"filename": ".github/workflows/check.yml"}]
check(len(cr.pr_files(7, paged_files)) == 101 and len(pages) == 2, "file inspection includes protected paths beyond page one")
check(cr.eligible(dict(sample, state="open", title="HOLD: unfinished", draft=False), allow_clean=True) is not None,
      "normalization never bypasses an explicit hold on a ready PR")

activity = dict(sample, user={"login": "copilot-swe-agent[bot]"})
def activity_api(events, comments):
    def api(path):
        if "/timeline?" in path:
            return [{"event": event} for event in events]
        if "/comments?" in path:
            return comments
        return {"commit": {"committer": {"date": "2026-11-03T00:00:00Z"}}}
    return api
at = calendar.timegm(time.strptime("2026-11-03T01:00:00Z", "%Y-%m-%dT%H:%M:%SZ"))
check(cr.activity_hold(activity, activity_api(["copilot_work_started"], []), at) is not None,
      "a quiet but unfinished Copilot session is never repaired")
hold_comment = {"body": "HOLD: fix behavior", "created_at": "2026-11-03T00:01:00Z"}
release_comment = {"body": "hold released", "created_at": "2026-11-03T00:02:00Z"}
check(cr.activity_hold(activity, activity_api(["copilot_work_finished"], [hold_comment]), at) is not None,
      "a current review HOLD blocks repair")
check(cr.activity_hold(activity, activity_api(["copilot_work_finished"], [hold_comment, release_comment]), at) is None,
      "a later hold release permits repair of finished work")
res, runs, trace, _ = drive(True, head_moved=True)
check(res.get("outcome") == "head-moved" and not runs and "reapply_base" not in trace and not trace.get("pushed"),
      "a concurrent author push stops repair before code inspection, validation or publishing")

clean_pr = dict(sample, state="open", draft=False, title="fix", body="", mergeable=True, mergeable_state="clean",
                head=dict(sample["head"], repo={"full_name": cr.REPO}, ref="fix/version"),
                base=dict(sample["base"], repo={"full_name": cr.REPO}))
def scan_api(path, **kwargs):
    if path.endswith("/pulls?state=open&per_page=100"):
        return [clean_pr]
    if path.endswith("/pulls/7"):
        return clean_pr
    if "/commits/" in path:
        return {"commit": {"committer": {"date": "2026-11-03T00:00:00Z"}}}
    return version_api(path, **kwargs)
check(cr.dirty_prs(4, now=at, ghf=scan_api, normalize=True) == [7]
      and cr.dirty_prs(4, now=at, ghf=scan_api) == [],
      "normalization scan selects stale-version clean PRs without changing the legacy dirty-only scan")
check(cr.dirty_prs(4, now=at - 3550, ghf=scan_api, normalize=True) == [],
      "normalization still leaves a newly pushed PR to its author")

saved_config = {key: value for key, value in os.environ.items() if key.startswith("GIT_CONFIG_")}
os.environ.update(GIT_CONFIG_COUNT="1", GIT_CONFIG_KEY_0="test.example", GIT_CONFIG_VALUE_0="fixture")
try:
    check(not any(key.startswith("GIT_CONFIG_") for key in cr.clean_env()),
          "credential-free subprocess environments remove Git config count and values together")
finally:
    for key in list(os.environ):
        if key.startswith("GIT_CONFIG_"):
            del os.environ[key]
    os.environ.update(saved_config)

print("FAILS=%d" % fails)
sys.exit(1 if fails else 0)
