#!/usr/bin/env python3
"""MIGRATION-RUNNER-1 (transformation lever T5.3, pillar autonomy): merged migrations apply themselves.

WHAT   A migration file opts in with two header lines:
           -- APPLY-BY: ci
           -- DB: qnfo-audit
       and must carry a rollback line in its header comments ("-- Rollback: ..."). Every DELETE FROM / DROP TABLE /
       DROP INDEX / DROP VIEW statement additionally needs a "-- BACKUP: <table>" line; the named table must exist in the
       same database and hold at least one row before the first destructive statement runs (no data is deleted without a
       backup). A file may create its own backup ("CREATE TABLE [IF NOT EXISTS] <table> AS SELECT ...") ahead of the first
       destructive statement; then the check runs right before that statement, otherwise before anything runs.
       --check validates opted-in files (the PR gate). --apply runs them on Cloudflare D1 statement by statement and records
       each run in qnfo-audit.migration_runs (file, sha256, commit, status, statements, error); a file whose sha256 already
       has an ok run is skipped, so a re-run or a hand-applied twin is harmless (migrations here are idempotent by
       convention). A failed file records the error, files one deduped agent_issues row (MIGRATION-APPLY-FAILED-1: <file>)
       and exits 1, so the workflow turns red and ci-watchdog sees it.
WHY    On 2026-10-06 all 75 files under migrations/ had been applied by hand by the session that wrote them; nothing
       recorded which ones ran, and a merged migration that nobody applied was invisible. Files without the header are
       ignored, so nothing already applied runs again.
USAGE  python3 scripts/apply_migrations.py --check  migrations/a.sql [...]
       python3 scripts/apply_migrations.py --apply  migrations/a.sql [...] [--commit SHA]
       --apply reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Exit 0 = every opted-in file passed (or was skipped).
HEADERLESS (MIGRATION-HEADER-GUARD-1, 2026-10-19): a file with no "APPLY-BY: ci" used to be skipped without a word, so a migration
       that forgot the header was never applied (2026-10-18-subscribers-utm-attribution.sql: its columns were missing live while the
       code that reads them shipped). --check now refuses a file whose SQL contains an executable statement (ALTER, CREATE,
       INSERT, UPDATE, DELETE, DROP, REPLACE) and that declares neither "-- APPLY-BY: ci" nor "-- APPLY-BY: manual (<reason>)" /
       "-- APPLY-BY: none (<reason>)". The files that already existed are listed in migrations/headerless-allowlist.txt
       (shrink-only: a file that gains a header leaves the list). --apply is unchanged and still skips a file without "ci".
PARSE-LINT (APPLY-MIGRATIONS-LINT-1, 2026-10-20): plan() also prepares every statement with EXPLAIN in an in-memory SQLite and refuses a
       file when SQLite cannot parse one (syntax error, unrecognized token, incomplete input, unterminated); a missing table, column or
       function is not a parse error and is ignored, so the lint needs no schema. A statement D1 refuses at parse time used to pass --check
       and fail on main (migrations/2026-10-18-portfolio-lifecycle.sql, migration_runs 288: unquoted text in a VALUES list). A file that
       needs syntax newer than the runner's SQLite says so on a "-- PARSE-LINT: off (<reason>)" header line; the lint is also skipped, and
       says so in the --check line, when the runner's SQLite is older than PARSE_LINT_MIN_SQLITE.
BACKUP-SCHEMA-ONLY (2026-10-20): an empty BACKUP table stops a file only when the file deletes rows (DELETE FROM, DROP TABLE). A file
       whose destructive statements are all DROP TRIGGER / DROP INDEX / DROP VIEW loses no row, so an empty backup is accepted for it.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

DATABASES = {"qnfo-audit": "35e2e573-92f3-46ac-83c6-22f6429fc5e5", "living-paper": "70a58cb3-b2cd-498d-877f-ecca86859a22"}
# MIGRATION-LIVING-PAPER-1 (2026-10-26): living-paper (papers.qnfo.org) had no CI path, so its guard triggers could only change by hand or
# from a worker lifting its own guard (migrations/2026-10-20-research-cluster-b.sql recorded that dead end for the publish floor).
# A file with '-- DB: living-paper' runs its statements there; migration_runs, failure issues and the ledger stay in qnfo-audit.
LEDGER_DB = "qnfo-audit"
# D1 caps a LIKE/GLOB pattern at 50 bytes and rejects longer ones at run time ("LIKE or GLOB pattern too complex",
# MIGRATION-APPLY-FAILED-1, issue 2046). --check catches it in the PR; use instr(col, 'text') = 0 / > 0 instead.
LIKE_MAX_BYTES = 50
LIKE_LITERAL = re.compile(r"\b(?:LIKE|GLOB)\s+'((?:[^']|'')*)'", re.I)
# metric_registry.refresh_cadence is guarded on D1 by the BEFORE INSERT/UPDATE triggers metric_registry_cadence_canonical_*
# (METRIC-CADENCE-CANONICAL-1), which abort the statement at apply time (MIGRATION-APPLY-FAILED-1, issue 2063: "hourly (D1
# triggers ...)"). --check evaluates the triggers' own WHEN expression in SQLite on every literal cadence a migration writes,
# so the PR fails instead of the merge. Keep this expression equal to the trigger (read from sqlite_master on 2026-10-06).
CADENCE_REJECT_SQL = ("SELECT ?1 IS NOT NULL AND trim(?1) <> '' AND (instr(trim(?1),' ') > 0 OR NOT ("
                      "lower(trim(?1)) IN ('hourly','daily','weekly','monthly') OR trim(?1) GLOB '*/[0-9]*' "
                      "OR trim(?1) GLOB '[0-9]*m' OR trim(?1) GLOB '[0-9]*h'))")
# CRON-GRID-MIGRATION-1 (2026-11-05, agent_issues 1001842-1001844): three fleet_crons rows written by migrations with minutes 42, 49 and 52 fired
# off the 5-minute grid (CRON-TICK-5M-1) and each filed a CRON-FAULT-1 "schedule" issue, because v_cron_schedule.off_grid reads the rows and nothing
# read the migration that wrote them. --check (a new or changed file) now applies the view's own rule to every 5-field cron literal that an INSERT, REPLACE
# or UPDATE of fleet_crons writes: a minute field whose numeric part is not a multiple of 5 is a problem. A file that wants the minute on purpose says
# why on a "-- CRON-GRID-OK: <reason>" line (the live exemption list is ops_config cron_grid_exempt).
CRON_WRITE = re.compile(r"^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?)\s+\"?fleet_crons\"?\b", re.I)
CRON_LITERAL = re.compile(r"'([0-9*/,\-]+\s+[0-9*/,\-]+\s+[0-9*/,\-?]+\s+[0-9A-Za-z*/,\-]+\s+[0-9A-Za-z*/,\-?]+)'")
CRON_GRID_OK = re.compile(r"^--[ \t]*CRON-GRID-OK:[ \t]*\S", re.M)


def off_grid_crons(stmt):
    """Cron literals of a fleet_crons write whose minute field is off the 5-minute grid, by the rule of v_cron_schedule (a part is off when its number,
    or the number after */, is not a multiple of 5; '*' and a part that does not start with a number read as on the grid, as CAST does in the view)."""
    if not CRON_WRITE.match(stmt):
        return []
    out = []
    # only what the statement writes: a WHERE clause may name the old expression it replaces (UPDATE ... WHERE cron_expr = '42 * * * *')
    for m in CRON_LITERAL.finditer(re.split(r"\bWHERE\b", stmt, 1, flags=re.I)[0]):
        expr = " ".join(m.group(1).split())
        for part in expr.split(" ")[0].split(","):
            if part in ("", "*"):
                continue
            n = re.match(r"\d+", part[2:] if part.startswith("*/") else part)
            if n and int(n.group(0)) % 5:
                out.append(expr)
                break
    return out


METRIC_INSERT = re.compile(r"^\s*(?:INSERT|REPLACE)\s+(?:OR\s+\w+\s+)?INTO\s+\"?metric_registry\"?\s*\(", re.I)
METRIC_UPDATE_CADENCE = re.compile(r"^\s*UPDATE\s+\"?metric_registry\"?\s+SET\b.*?\brefresh_cadence\s*=\s*'((?:[^']|'')*)'", re.I | re.S)
DESTRUCTIVE = re.compile(r"^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b", re.I)
# BACKUP-SCHEMA-ONLY-1 (2026-10-20, workflow failure audit; migration_runs 352, 355 and 361): the runner refused a backup table with no rows
# before a destructive statement, and counted DROP TRIGGER like DELETE FROM. migrations/2026-10-19-repo-slug-any-depth.sql made its backup
# with CREATE TABLE IF NOT EXISTS ... AS SELECT ... WHERE lower(repo) LIKE 'qnfo/%'; no row matched any more, the backup was empty, and the
# DROP TRIGGER IF EXISTS at statement 3 stopped on "BACKUP table ... is empty" (three red runs on main; the retained empty table meant a
# re-run could never pass). Dropping a trigger, index or view deletes no row: its definition is recoverable from the Rollback line, so an
# empty backup protects nothing. Only a statement that destroys rows keeps the rule that the backup holds at least one row. The "table does
# not exist" check is unchanged for every file. The earlier patches (BACKUP-CREATES-1/2, BACKUP-SELF-EMPTY-1) each fixed one shape; this one
# states the rule by what the file can lose.
ROW_DESTRUCTIVE = re.compile(r"^\s*(DELETE\s+FROM|DROP\s+TABLE)\b", re.I)
# APPEND-ONLY-LINT-1 (GHA-AUDIT-1, 2026-10-13): decision_log and issue_lifecycle carry BEFORE UPDATE/DELETE triggers that
# RAISE(ABORT) (decision_log_no_update/_no_delete, issue_lifecycle_no_update/_no_delete, read from sqlite_master
# 2026-10-13). A migration that updates, deletes or REPLACEs a row there passed --check and failed on main (migration_runs
# 2026-10-12, 2026-10-12-34-default-adopt-prediction.sql statement 4). Append a new row instead.
APPEND_ONLY = ("decision_log", "issue_lifecycle")
APPEND_ONLY_WRITE = re.compile(r"^\s*(?:UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM|(?:INSERT\s+OR\s+REPLACE|REPLACE)\s+INTO)\s+\"?("
                               + "|".join(APPEND_ONLY) + r")\"?\b", re.I)
# STEP-SCHEMA-LINT-1 (2026-10-18, fleet_runs 10278 at 16:18:57Z): a fleet_tasks workflow step without "type" passed
# --check and then aborted its run at execution time with "unsupported step type: undefined" (every step after it never
# ran). Measured in qnfo-audit on 2026-10-18: 184 steps across 39 fleet_tasks rows of type 'workflow' -- 'sql' 183 (38
# tasks), 'http' 1. Every live step carries a type; 151 of 184 carry no "name" and ran fine, so name stays optional; no
# sql step lacks db/sql and the one http step carries url. A file may name a type the runner gained with a
# "-- STEP-TYPES: sql,http,<new>" header line, so a new capability is a one-line header and not a red PR.
# MIGRATION-NO-CLOBBER-1 (2026-10-19, agent_issues 3009): the runner applies a file again whenever its sha256 changes, so EDITING a file that has
# already merged re-runs all of it on the next merge. migrations/2026-10-18-portfolio-lifecycle.sql was edited two hours after
# PORTFOLIO-ONE-OWNER-1 cut fleet_tasks portfolio-lifecycle from 14 steps to 8; the re-run (migration_runs 309, 2026-10-18T14:44:14Z) wrote the 14-step row
# back with INSERT OR REPLACE and the issue was reopened a day later. An edited, already-merged file may therefore not rewrite a live definition row
# (fleet_tasks, fleet_crons, ops_config): the change belongs in a NEW file. A file that must be re-applied on purpose says why on a
# "-- REAPPLY-OK: <reason>" line, which also marks a repaired file that never applied ok.
CLOBBER_WRITE = re.compile(r"^\s*(?:INSERT\s+OR\s+REPLACE\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?)\s+\"?(fleet_tasks|fleet_crons|ops_config)\"?\b", re.I)
REAPPLY_OK = re.compile(r"^--[ \t]*REAPPLY-OK:[ \t]*\S", re.M)


def clobber_problems(text, base_text, history=()):
    """base_text is the file as it stands on the base branch (None for a new file); history is the content the file had at earlier commits.
    Returns the refusal lines for an edited file that rewrites a live definition row without a REAPPLY-OK line; an edit that only adds comments or touches
    other statements passes. So does restoring a content the file already had (a revert of an edit): the runner keys an applied file by (file, sha256), so that
    sha256 is already applied and the file is skipped, not re-run."""
    if base_text is None or text == base_text or REAPPLY_OK.search(text):
        return []
    if header_value(header(base_text), "APPLY-BY") != "ci":
        return []
    bad = []
    for st in statements(text):
        m = CLOBBER_WRITE.match(body(st))
        if m:
            bad.append(m.group(1))
    if not bad or text in history:
        return []
    return ["edited migration rewrites live " + ", ".join(sorted(set(bad))) + " row(s): the runner re-applies an edited file on merge and would overwrite the "
            "newer definition (MIGRATION-NO-CLOBBER-1, issue 3009). Put the change in a new migration file, or add a '-- REAPPLY-OK: <reason>' line "
            "if the re-run is intended"]


def base_text_of(path, base):
    import subprocess
    r = subprocess.run(["git", "show", base + ":" + path], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def history_texts_of(path, base):
    """Every content path had at a commit reachable from base (newest first); empty when git holds no history for it. RESTORE-APPLIED-CONTENT-1: a revert of
    an edit to an already-applied migration (#5366 edited 2026-10-29-plussing-3.sql, which the runner then replayed) is a file the runner skips."""
    import subprocess
    r = subprocess.run(["git", "log", "--format=%H", base, "--", path], capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        return []
    out = []
    for sha in r.stdout.split():
        s = subprocess.run(["git", "show", sha + ":" + path], capture_output=True, text=True, encoding="utf-8")
        if s.returncode == 0:
            out.append(s.stdout)
    return out


STEP_TYPES = ("sql", "http")
LEDGER_DDL = ("CREATE TABLE IF NOT EXISTS migration_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT NOT NULL, "
              "sha256 TEXT NOT NULL, commit_sha TEXT, db TEXT, status TEXT NOT NULL, statements INTEGER, error TEXT, "
              "applied_by TEXT, applied_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))")


def header(text):
    """The leading comment block (lines starting with --, before the first statement)."""
    out = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            out.append("")
            continue
        if s.startswith("--"):
            out.append(s[2:].strip())
            continue
        break
    return out


def header_value(lines, key):
    for l in lines:
        m = re.match(r"^" + re.escape(key) + r"\s*:\s*(.+)$", l, re.I)
        if m:
            return m.group(1).strip()
    return None


# MIGRATION-HEADER-GUARD-1: the statement keywords that change a database. A file with none of them (comments, SELECT, a note) needs no
# header; a file with one and no APPLY-BY declaration is the silent-skip defect. A WITH (CTE) statement counts when it writes: its
# CTE list is followed by INSERT, UPDATE, DELETE or REPLACE INTO (2026-10-02-work-with-me-triggers.sql is one). Comments of both kinds
# (full-line, trailing and /* */) and string literals are removed first, so neither hides a statement nor fakes one.
EXECUTABLE = re.compile(r"^\s*(?:ALTER|CREATE|INSERT|UPDATE|DELETE|DROP|REPLACE)\b", re.I)
WITH_WRITE = re.compile(r"^\s*WITH\b.*\b(?:INSERT|UPDATE|DELETE|REPLACE\s+INTO)\b", re.I | re.S)
APPLY_BY_DECLARED = re.compile(r"^(manual|none)\s*\(\s*(\S.*?)\s*\)\s*$", re.I)
ALLOWLIST = os.path.join(HERE, "..", "migrations", "headerless-allowlist.txt")


def load_allowlist(path=None):
    """(names, expires): the grandfathered file names and the "# EXPIRES: yyyy-mm-dd" date of migrations/headerless-allowlist.txt."""
    names, expires = set(), None
    try:
        for line in open(path or ALLOWLIST, encoding="utf-8").read().splitlines():
            line = line.strip()
            m = re.match(r"^#\s*EXPIRES\s*:\s*(\d{4}-\d{2}-\d{2})\b", line, re.I)
            if m:
                expires = m.group(1)
            if line and not line.startswith("#"):
                names.add(os.path.basename(line))
    except OSError:
        pass
    return names, expires


def strip_sql(sql):
    """sql without comments ("--" to end of line, /* */) and with each string literal emptied: what is left is the SQL's shape."""
    out, i, n = [], 0, len(sql)
    while i < n:
        two, c = sql[i:i + 2], sql[i]
        if two == "--":
            while i < n and sql[i] != "\n":
                i += 1
        elif two == "/*":
            j = sql.find("*/", i + 2)
            i = n if j < 0 else j + 2
            out.append(" ")
        elif c in "'\"`":
            j = i + 1
            while j < n and not (sql[j] == c and sql[j + 1:j + 2] != c):
                j += 2 if sql[j] == c else 1
            out.append(c + c)
            i = j + 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def has_executable(text):
    for s in statements(text):
        b = strip_sql(s.replace("__INCOMPLETE__", "", 1))
        if EXECUTABLE.match(b) or WITH_WRITE.match(b):
            return True
    return False


def headerless_verdict(path, text, allow=None):
    """MIGRATION-HEADER-GUARD-1: what --check says about a file plan() skipped (no "APPLY-BY: ci"). Returns (verdict, note):
    'declared' (APPLY-BY: manual|none with a reason), 'no-sql' (nothing executable, no header needed), 'grandfathered' (listed in
    migrations/headerless-allowlist.txt) or 'refused' (executable SQL that nothing will ever apply)."""
    by = header_value(header(text), "APPLY-BY")
    if by and APPLY_BY_DECLARED.match(by):
        return "declared", "APPLY-BY: " + by
    if not has_executable(text):
        return "no-sql", None
    names = allow if allow is not None else load_allowlist()[0]
    if os.path.basename(path) in names:
        return "grandfathered", "listed in migrations/headerless-allowlist.txt"
    got = ("APPLY-BY: " + by) if by else "no APPLY-BY header"
    return "refused", ("has executable SQL (ALTER/CREATE/INSERT/UPDATE/DELETE/DROP) but " + got + ", so no run applies it and "
                       "nothing reports it (MIGRATION-HEADER-GUARD-1): add '-- APPLY-BY: ci', '-- DB: qnfo-audit' and "
                       "'-- Rollback: <sql>' to apply it on merge, or '-- APPLY-BY: manual (<reason>)' / '-- APPLY-BY: none (<reason>)' "
                       "when it is applied some other way or not at all")


def body(stmt):
    """A statement without its full-line comments (the header and any "--" notes): D1 receives only SQL."""
    return "\n".join(l for l in stmt.splitlines() if not l.strip().startswith("--")).strip()


def statements(text):
    """Split SQL into complete statements with SQLite's own tokenizer (quotes, comments and semicolons inside strings)."""
    out, buf = [], ""
    for line in text.splitlines(keepends=True):
        buf += line
        if sqlite3.complete_statement(buf):
            s = buf.strip()
            b = body(s)
            if b and b != ";":
                out.append(s)
            buf = ""
    rest = body(buf)
    if rest:
        out.append("__INCOMPLETE__" + rest[:200])
    return out


def _close(s, i):
    """Index of the parenthesis that closes the one at s[i], skipping string literals ('' is an escaped quote)."""
    depth, q, j = 0, False, i
    while j < len(s):
        c = s[j]
        if q:
            if c == "'":
                if j + 1 < len(s) and s[j + 1] == "'":
                    j += 2
                    continue
                q = False
        elif c == "'":
            q = True
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return j
        j += 1
    return -1


def _split_top(s):
    """Split on commas that are outside parentheses and string literals."""
    out, depth, q, cur, j = [], 0, False, "", 0
    while j < len(s):
        c = s[j]
        if q:
            cur += c
            if c == "'":
                if j + 1 < len(s) and s[j + 1] == "'":
                    cur += "'"
                    j += 1
                else:
                    q = False
        elif c == "'":
            q, cur = True, cur + c
        elif c == "(":
            depth, cur = depth + 1, cur + c
        elif c == ")":
            depth, cur = depth - 1, cur + c
        elif c == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += c
        j += 1
    if cur.strip():
        out.append(cur.strip())
    return out


PROBE_UPDATE = re.compile(r"^\s*UPDATE\s+\"?remediation_contracts\"?\s+SET\b", re.I)
PROBE_INSERT = re.compile(r"^\s*(?:INSERT|REPLACE)\s+(?:OR\s+\w+\s+)?INTO\s+\"?remediation_contracts\"?\s*\(", re.I)
_SQL_STR = re.compile(r"^'((?:[^']|'')*)'$", re.S)


def _str_lit(expr):
    m = _SQL_STR.match(expr.strip())
    return m.group(1).replace("''", "'") if m else None


def probe_semicolons(sql):
    """PROBE-SEMICOLON-LINT-1 (issue 1000507): the string literals a statement stores as remediation_contracts.verify_probe that hold a
    semicolon while the transport is d1-query (or, for an UPDATE that leaves the transport alone, unset). The D1 triggers
    remediation_probe_semicolon_ins/_upd turn the semicolon into a comma, so a probe that matches such text fails for ever
    (verification 332685). A code-read or other JSON probe is exempt: the triggers act on d1-query probes only."""
    bad = []
    if PROBE_UPDATE.match(sql):
        pm = re.search(r"\bverify_probe\s*=\s*('(?:[^']|'')*')", sql, re.I)
        tm = re.search(r"\bverify_transport\s*=\s*('(?:[^']|'')*')", sql, re.I)
        if pm:
            lit = _str_lit(pm.group(1))
            tr = _str_lit(tm.group(1)) if tm else None
            if lit and ";" in lit and (tr is None or tr.lower().startswith("d1-query")):
                bad.append(lit)
        return bad
    m = PROBE_INSERT.match(sql)
    if not m:
        return bad
    cstart = m.end() - 1
    cend = _close(sql, cstart)
    if cend < 0:
        return bad
    cols = [c.strip().strip('"').lower() for c in _split_top(sql[cstart + 1:cend])]
    if "verify_probe" not in cols:
        return bad
    kp = cols.index("verify_probe")
    kt = cols.index("verify_transport") if "verify_transport" in cols else None
    rest = sql[cend + 1:].lstrip()
    if not re.match(r"VALUES\b", rest, re.I):
        return bad
    j = 6
    while j < len(rest):
        while j < len(rest) and rest[j] in " \t\r\n,":
            j += 1
        if j >= len(rest) or rest[j] != "(":
            break
        e = _close(rest, j)
        if e < 0:
            break
        vals = _split_top(rest[j + 1:e])
        if len(vals) == len(cols):
            lit = _str_lit(vals[kp])
            tr = _str_lit(vals[kt]) if kt is not None else None
            if lit and ";" in lit and (tr is None or tr.lower().startswith("d1-query")):
                bad.append(lit)
        j = e + 1
    return bad


def metric_cadences(sql):
    """The literal refresh_cadence values a statement writes to metric_registry (INSERT ... VALUES, INSERT ... SELECT,
    UPDATE ... SET). An expression rather than a single string literal is not judged here."""
    vals = []
    m = METRIC_INSERT.match(sql)
    if m:
        cstart = m.end() - 1
        cend = _close(sql, cstart)
        if cend < 0:
            return vals
        cols = [c.strip().strip('"').lower() for c in _split_top(sql[cstart + 1:cend])]
        if "refresh_cadence" not in cols:
            return vals
        k = cols.index("refresh_cadence")
        rest = sql[cend + 1:].lstrip()
        rows = []
        if re.match(r"VALUES\b", rest, re.I):
            j = 6
            while True:
                while j < len(rest) and rest[j] in " \t\r\n":
                    j += 1
                if j >= len(rest) or rest[j] != "(":
                    break
                e = _close(rest, j)
                if e < 0:
                    break
                rows.append(_split_top(rest[j + 1:e]))
                j = e + 1
                while j < len(rest) and rest[j] in " \t\r\n":
                    j += 1
                if j < len(rest) and rest[j] == ",":
                    j += 1
                    continue
                break
        elif re.match(r"SELECT\b", rest, re.I):
            body_, depth, q, j = rest[6:], 0, False, 0
            while j < len(body_):
                c = body_[j]
                if q:
                    if c == "'" and not (j + 1 < len(body_) and body_[j + 1] == "'"):
                        q = False
                    elif c == "'":
                        j += 1
                elif c == "'":
                    q = True
                elif c == "(":
                    depth += 1
                elif c == ")":
                    depth -= 1
                elif depth == 0 and re.match(r"\s(FROM|WHERE|UNION|ON\s+CONFLICT)\b", body_[j:], re.I):
                    break
                j += 1
            rows.append(_split_top(body_[:j]))
        for r in rows:
            v = r[k].strip() if k < len(r) else ""
            lm = re.match(r"^'((?:[^']|'')*)'$", v, re.S)
            if lm:
                vals.append(lm.group(1).replace("''", "'"))
    u = METRIC_UPDATE_CADENCE.match(sql)
    if u:
        vals.append(u.group(1).replace("''", "'"))
    return vals


def cadence_rejected(value):
    """True when the D1 triggers metric_registry_cadence_canonical_* would abort on this refresh_cadence."""
    con = sqlite3.connect(":memory:")
    try:
        return bool(con.execute(CADENCE_REJECT_SQL, (value,)).fetchone()[0])
    finally:
        con.close()


# D1-COMPOUND-LIMIT-1 (2026-10-09): D1 refuses a compound SELECT of more than 5 terms (UNION / UNION ALL / INTERSECT /
# EXCEPT at one level), far below SQLite's default 500: migration 2026-10-09-09 stopped at a 7-term UNION ALL. A multi-row
# VALUES list is not limited the same way (a 7-row VALUES insert applied in the same file).
COMPOUND_MAX_TERMS = 5
COMPOUND_OP = re.compile(r"\b(UNION(\s+ALL)?|INTERSECT|EXCEPT)\b", re.I)


def compound_terms(sql):
    """Largest number of terms joined by compound operators at one parenthesis level, ignoring string literals."""
    text = re.sub(r"'(?:[^']|'')*'", "''", sql)
    counts, stack, depth_id = {}, [0], 0
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "(":
            depth_id += 1
            stack.append(depth_id)
        elif ch == ")":
            if len(stack) > 1:
                stack.pop()
        else:
            m = COMPOUND_OP.match(text, i)
            if m and (i == 0 or not (text[i - 1].isalnum() or text[i - 1] == "_")):
                counts[stack[-1]] = counts.get(stack[-1], 0) + 1
                i = m.end()
                continue
        i += 1
    return (max(counts.values()) + 1) if counts else 1


# CHECK-ENUM-LINT-1 (2026-10-12): the registers carry CHECK constraints the runner cannot see offline, and a literal outside the
# allowed set fails the file at that statement with everything before it applied (migrations 2026-10-12-29 and -30 failed on
# control_registry.kind 'audit' and 'loop'; runs 119 and 120). --check now refuses a literal that the live constraint would refuse.
ENUMS = {
    "control_registry": {"kind": {"hold", "filter", "pause", "kill-switch", "gate", "cap", "guard", "lease"},
                         "disposition": {"remove", "demote", "replace", "keep"},
                         "disposition_state": {"planned", "applied"}},
}
INSERT_HEAD = re.compile(r"^\s*INSERT\s+(?:OR\s+(?:REPLACE|IGNORE|ABORT|FAIL|ROLLBACK)\s+)?INTO\s+\"?([A-Za-z_][A-Za-z0-9_]*)\"?\s*\(", re.I)


def enum_violations(sql):
    """['table.column literal'] for every literal in an INSERT ... VALUES that a known CHECK constraint refuses."""
    out = []
    m = INSERT_HEAD.match(sql)
    if not m or m.group(1).lower() not in ENUMS:
        return out
    enums = ENUMS[m.group(1).lower()]
    open_i = m.end() - 1
    close_i = _close(sql, open_i)
    if close_i < 0:
        return out
    cols = [c.strip().strip('"').lower() for c in _split_top(sql[open_i + 1:close_i])]
    watch = {i: c for i, c in enumerate(cols) if c in enums}
    if not watch:
        return out
    v = re.compile(r"\bVALUES\b", re.I).search(sql, close_i)
    if not v:
        return out
    i = v.end()
    while True:
        p = sql.find("(", i)
        if p < 0:
            break
        q = _close(sql, p)
        if q < 0:
            break
        vals = _split_top(sql[p + 1:q])
        for idx, col in watch.items():
            if idx < len(vals) and re.fullmatch(r"'(?:[^']|'')*'", vals[idx]):
                lit = vals[idx][1:-1].replace("''", "'")
                if lit not in enums[col]:
                    out.append(m.group(1).lower() + "." + col + " '" + lit + "' (allowed: " + ", ".join(sorted(enums[col])) + ")")
        i = q + 1
        rest = sql[i:].lstrip()
        if not rest.startswith(","):
            break
    return out


def _literals(sql):
    """Every single-quoted literal in a statement, decoded (SQL '' is an escaped quote), skipping -- comments."""
    out, i, n = [], 0, len(sql)
    while i < n:
        if sql[i] == "-" and sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if sql[i] != "'":
            i += 1
            continue
        j, buf = i + 1, []
        while j < n:
            if sql[j] == "'":
                if j + 1 < n and sql[j + 1] == "'":
                    buf.append("'")
                    j += 2
                    continue
                break
            buf.append(sql[j])
            j += 1
        out.append("".join(buf))
        i = j + 1
    return out


def step_violations(sql, allowed=None):
    """A problem per fleet_tasks workflow step the runner would refuse at execution time (STEP-SCHEMA-LINT-1)."""
    allowed = [t.strip().lower() for t in (allowed or STEP_TYPES) if t and t.strip()]
    problems = []
    for lit in _literals(sql):
        if '"steps"' not in lit:
            continue
        try:
            doc = json.loads(lit)
        except ValueError:
            continue  # a fragment this lint cannot read: make no claim about it
        steps = doc.get("steps") if isinstance(doc, dict) else None
        if not isinstance(steps, list):
            continue
        for n, step in enumerate(steps, 1):
            if not isinstance(step, dict):
                problems.append("step " + str(n) + " is not a JSON object")
                continue
            kind = step.get("type")
            label = "step " + str(n) + " (" + str(step.get("name") or "unnamed") + ")"
            if not isinstance(kind, str) or not kind.strip():
                problems.append("step " + str(n) + " has no \"type\": the runner aborts the whole run with "
                                "'unsupported step type: undefined'")
                continue
            if kind.strip().lower() not in allowed:
                problems.append(label + " type '" + kind + "' is not a type the runner executes ("
                                + ", ".join(allowed) + "); add it to a '-- STEP-TYPES:' header line if the runner "
                                "gained it")
                continue
            if kind.strip().lower() == "sql":
                for key in ("db", "sql"):
                    v = step.get(key)
                    if not isinstance(v, str) or not v.strip():
                        problems.append(label + " has no \"" + key + "\" (a sql step needs both db and sql)")
            else:
                v = step.get("url")
                if not isinstance(v, str) or not v.strip():
                    problems.append(label + " has no \"url\" (an http step needs one)")
    return problems


# APPLY-MIGRATIONS-LINT-1 (2026-10-20, workflow failure audit, agent_issues 100295): plan() and --check ran header and regex lints and never
# parsed the SQL, so a statement SQLite cannot read passed the PR gate and failed on main. migrations/2026-10-18-portfolio-lifecycle.sql
# statement 2 listed unquoted text in a VALUES clause (PORTFOLIO-LIFECYCLE-1: maintain, implement, ...); D1 answered 'unrecognized token ":"
# at offset 167' (migration_runs 288, apply-migrations run 39126889193) and the fix landed seven minutes later. Every statement is now
# prepared with EXPLAIN in an in-memory SQLite (nothing runs, nothing is written) and the file is refused when the PARSER rejects one.
# Only parse-class messages count. EXPLAIN resolves names after parsing, so "no such table", "no such column", "no such function" and
# the other schema questions of an empty database are ignored: the lint needs no schema and cannot disagree with D1 about what exists.
# Measured 2026-10-20 on origin/main (SQLite 3.45.1, the ubuntu-latest runner's): it flags the e7d8b482 bytes of statement 2 with the same
# text D1 returned ('unrecognized token: ":"'), refuses 0 of the 437 opted-in migrations (2735 statements) and 0 of the 447 distinct sha256
# values migration_runs holds as ok (2841 statements); of the 671 historical contents of migrations/*.sql it refuses only that one. Two ways
# a dialect gap could still produce a false refusal are closed here: an older SQLite than PARSE_LINT_MIN_SQLITE skips the lint (and the
# --check line says so), and a file that needs syntax newer than the runner's SQLite carries "-- PARSE-LINT: off (<reason>)".
# Limit, stated plainly: the parser stops at its first error of any kind, so a name-resolution error SQLite raises WHILE parsing (a duplicate
# column, a trigger on a missing table) hides a later syntax error in the same statement. The trigger case is the common one, because a
# trigger's table is looked up before its body is read: a stand-in table (or view, for INSTEAD OF) is created for it in the throwaway
# database, which lets the body be parsed too (a column or table the body names is only resolved when the trigger fires, so none is needed).
PARSE_ERROR = re.compile(r"syntax error|unrecognized token|incomplete input|unterminated", re.I)
PARSE_LINT_MIN_SQLITE = (3, 39, 0)  # RIGHT/FULL JOIN, the newest syntax in routine use; D1 runs a newer SQLite than any runner image
PARSE_LINT_OFF = re.compile(r"^off\s*\(\s*(\S.*?)\s*\)\s*$", re.I)
EXPLAIN_HEAD = re.compile(r"^\s*EXPLAIN\b", re.I)
INSTEAD_OF_TRIGGER = re.compile(r'(?is)^\s*CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?"?\w+"?\s+INSTEAD\s+OF\b')


def _stand_in_for_trigger_target(con, sql):
    """Gives the parser the table (or view) a CREATE TRIGGER is on, so that the trigger body is read; TRIGGER_ON is defined further down."""
    m = TRIGGER_ON.match(sql)
    if not m:
        return
    view = bool(INSTEAD_OF_TRIGGER.match(sql))
    try:
        con.execute(('CREATE VIEW IF NOT EXISTS "%s" AS SELECT 1 AS x' if view else 'CREATE TABLE IF NOT EXISTS "%s" (x)') % m.group(2))
    except sqlite3.Error:
        pass  # a name already taken by the other kind: the trigger is then judged without a stand-in, as before


def parse_problems(stmts, lines):
    """(problems, note): a problem per statement SQLite's parser refuses, and a note when the lint did not run.
    stmts is statements(text); lines is header(text)."""
    switch = header_value(lines, "PARSE-LINT")
    if switch is not None:
        if PARSE_LINT_OFF.match(switch):
            return [], "off: " + switch
        return ["PARSE-LINT header must read '-- PARSE-LINT: off (<reason>)' (got '" + switch[:60] + "')"], None
    if sqlite3.sqlite_version_info < PARSE_LINT_MIN_SQLITE:
        return [], "skipped: sqlite " + sqlite3.sqlite_version + " is older than " + ".".join(map(str, PARSE_LINT_MIN_SQLITE))
    problems = []
    con = sqlite3.connect(":memory:")
    try:
        for n, s in enumerate(stmts, 1):
            if s.startswith("__INCOMPLETE__"):
                continue  # reported on its own line
            sql = body(s)
            _stand_in_for_trigger_target(con, sql)
            try:
                con.execute(sql if EXPLAIN_HEAD.match(sql) else "EXPLAIN " + sql)
            except sqlite3.Error as e:
                # OperationalError carries the parser's message; ProgrammingError/Warning (bound parameters, two statements on one
                # line) are not parse refusals and make no claim.
                if isinstance(e, sqlite3.OperationalError) and PARSE_ERROR.search(str(e)):
                    problems.append("statement " + str(n) + " is not valid SQL: " + str(e)[:160] + " [" + " ".join(sql.split())[:70]
                                    + "] (APPLY-MIGRATIONS-LINT-1: D1 refuses it at apply time)")
    finally:
        con.close()
    return problems, None


# CONTROL-PROBE-AT-BIRTH-1 (2026-10-26, agent_issues 1000483; CHAOS-DRILL-FAILED-1 control:control-alternate-probes, 1000214): 18 controls were
# registered in one day by several sessions with an alternate_path and no control_alternate_probes row, and v_control_alternate_status read them
# as no-probe until migrations/2026-10-26-control-alternate-probes4.sql gave them probes. Nothing asked the author for the probe at the
# registration, so --check does: a control_registry INSERT that sets an alternate_path needs, in the same file, a control_alternate_probes row
# for that control, or ALTERNATE-NOT-EXERCISABLE in that control's evidence (the view then reads not-exercisable), or the header line
# "-- CONTROL-PROBE: none (<reason>)". Only a file that changes in the pull request is checked; the controls already registered are untouched,
# and an UPDATE of an existing control row is not an INSERT, so it passes.
CONTROL_PROBE_NONE = re.compile(r"^none\s*\(\s*(\S.*?)\s*\)\s*$", re.I)
NOT_EXERCISABLE = "ALTERNATE-NOT-EXERCISABLE"
CONTROL_PROBE_HOW = ("add INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note, enabled) VALUES ('<control>', "
                     "'SELECT ''ok'' AS expected, CASE WHEN <the alternate is missing or in the wrong state> THEN ''<reason>'' ELSE ''ok'' END AS observed', "
                     "'<window in minutes>', 1) with a read-only, falsifiable probe of the alternate_path (example: "
                     "migrations/2026-10-26-control-alternate-probes4.sql), or put " + NOT_EXERCISABLE + " in the control's evidence, "
                     "or declare '-- CONTROL-PROBE: none (<reason>)' in the header")


def control_probe_problems(stmts, lines):
    """Problems for controls this file registers with an alternate_path and no probe; stmts is statements(text), lines is header(text)."""
    switch = header_value(lines, "CONTROL-PROBE")
    if switch is not None:
        if CONTROL_PROBE_NONE.match(switch):
            return []
        return ["CONTROL-PROBE header must read '-- CONTROL-PROBE: none (<reason>)' (got '" + switch[:60] + "') (CONTROL-PROBE-AT-BIRTH-1)"]
    inserts = [(INSERT_HEAD.match(body(s)), body(s)) for s in stmts if not s.startswith("__INCOMPLETE__")]
    probes = [sql for m, sql in inserts if m and m.group(1).lower() == "control_alternate_probes"]
    probed = set()
    for sql in probes:
        probed.update(_literals(sql))
    missing = []
    for m, sql in inserts:
        if not m or m.group(1).lower() != "control_registry":
            continue
        open_i = m.end() - 1
        close_i = _close(sql, open_i)
        cols = [c.strip().strip('"').lower() for c in _split_top(sql[open_i + 1:close_i])] if close_i > 0 else []
        if "alternate_path" not in cols:
            continue  # no alternate registered: v_control_alternate_status reads no-alternate
        v = re.compile(r"\bVALUES\b", re.I).search(sql, close_i) if close_i > 0 else None
        if not v:  # INSERT ... SELECT: the names are not literals here, so any probe insert in the file or the marker in the statement counts
            if not probes and NOT_EXERCISABLE not in sql:
                missing.append("(INSERT ... SELECT)")
            continue
        i = v.end()
        while True:
            p = sql.find("(", i)
            q = _close(sql, p) if p >= 0 else -1
            if q < 0:
                break
            row = _split_top(sql[p + 1:q])
            by = {c: row[k] for k, c in enumerate(cols) if k < len(row)}
            alt = by.get("alternate_path", "NULL")
            name = by.get("control", "")
            if not re.fullmatch(r"(?i)NULL|''", alt.strip()):
                lit = name[1:-1].replace("''", "'") if re.fullmatch(r"'(?:[^']|'')*'", name) else None
                if NOT_EXERCISABLE not in sql[p:q + 1] and (lit is None and not probes or lit is not None and lit not in probed):
                    missing.append(lit if lit is not None else "(computed name)")
            i = q + 1
            if not sql[i:].lstrip().startswith(","):
                break
    if not missing:
        return []
    return ["control_registry INSERT sets an alternate_path for " + ", ".join(missing[:5]) + (" and %d more" % (len(missing) - 5) if len(missing) > 5 else "")
            + " and this file inserts no control_alternate_probes row for it (CONTROL-PROBE-AT-BIRTH-1: the drill reads it as no-probe and "
            "fm-control-alternate-undrilled files an issue); " + CONTROL_PROBE_HOW]


def plan(path, text, birth=False):
    """Validate one file. Returns (opted_in, problems, info). birth=True adds the checks that only guard a new or changed file in a pull request
    (CONTROL-PROBE-AT-BIRTH-1); only --check asks for it (not --history), so a file already on main is applied as merged and never refused for a
    probe its author did not write."""
    lines = header(text)
    by = header_value(lines, "APPLY-BY")
    if not by or by.split()[0].lower() != "ci":
        return False, [], {"skip": "no APPLY-BY: ci header"}
    problems = []
    db = header_value(lines, "DB")
    if db not in DATABASES:
        problems.append("DB header must name one of " + ", ".join(sorted(DATABASES)) + " (got " + str(db) + ")")
    if not any(re.match(r"^rollback\s*:", l, re.I) for l in lines):
        problems.append("no '-- Rollback:' line in the header")
    stmts = statements(text)
    if any(s.startswith("__INCOMPLETE__") for s in stmts):
        problems.append("the file ends with an incomplete statement")
    if not [s for s in stmts if not s.startswith("__INCOMPLETE__")]:
        problems.append("no statement to apply")
    parse_bad, parse_note = parse_problems(stmts, lines)
    problems.extend(parse_bad)
    for s in stmts:
        for m in LIKE_LITERAL.finditer(body(s)):
            lit = m.group(1).replace("''", "'")
            if len(lit.encode("utf-8")) > LIKE_MAX_BYTES:
                problems.append("LIKE/GLOB pattern of " + str(len(lit.encode("utf-8"))) + " bytes (D1 rejects over "
                                + str(LIKE_MAX_BYTES) + "; use instr()): '" + lit[:60] + "'")
    for s in stmts if birth else []:  # birth only: files already on main are applied as merged
        for lit in probe_semicolons(body(s)):
            problems.append("verify_probe holds a semicolon (D1 triggers remediation_probe_semicolon_* rewrite it to a comma, so a probe that "
                            "matches it fails for ever; use char(59) or instr on a part without it) (PROBE-SEMICOLON-LINT-1): '" + lit[:60] + "'")
    for s in stmts:
        worst = compound_terms(body(s))
        if worst > COMPOUND_MAX_TERMS:
            problems.append("compound SELECT of " + str(worst) + " terms (D1 rejects over " + str(COMPOUND_MAX_TERMS)
                            + ": 'too many terms in compound SELECT'; split it into several INSERT ... SELECT statements or a VALUES list)")
    for s in stmts:
        for cad in metric_cadences(body(s)):
            if cadence_rejected(cad):
                problems.append("metric_registry refresh_cadence '" + cad[:60] + "' is not a canonical token (D1 trigger "
                                "METRIC-CADENCE-CANONICAL-1 aborts it: use */N, */Nh, Nm, Nh or hourly|daily|weekly|monthly)")
    for s in stmts:
        for bad in enum_violations(body(s)):
            problems.append("CHECK constraint would refuse " + bad + " (CHECK-ENUM-LINT-1)")
    if birth and not CRON_GRID_OK.search(text):  # birth only: rows already on main were written as merged
        for s in stmts:
            for expr in off_grid_crons(body(s)):
                problems.append("fleet_crons cron '" + expr[:60] + "' fires off the 5-minute grid (v_cron_schedule.off_grid; CRON-FAULT-1 files a schedule issue "
                                "for it): use a minute that is a multiple of 5, or add a '-- CRON-GRID-OK: <reason>' line (CRON-GRID-MIGRATION-1)")
    if birth:
        problems.extend(control_probe_problems(stmts, lines))
    for s in stmts:
        m = APPEND_ONLY_WRITE.match(body(s))
        if m:
            problems.append(m.group(1).lower() + " is append-only (its D1 trigger aborts UPDATE, DELETE and REPLACE); "
                            "INSERT a new row instead (APPEND-ONLY-LINT-1)")
    step_types = header_value(lines, "STEP-TYPES")
    for s in stmts:
        for bad in step_violations(body(s), step_types.split(",") if step_types else None):
            problems.append(bad + " (STEP-SCHEMA-LINT-1)")
    destructive = [s for s in stmts if DESTRUCTIVE.match(body(s))]
    row_destructive = [s for s in destructive if ROW_DESTRUCTIVE.match(body(s))]
    backup = header_value(lines, "BACKUP")
    if destructive and not backup:
        problems.append(str(len(destructive)) + " destructive statement(s) (DELETE/DROP) need a '-- BACKUP: <table>' header line")
    if backup and not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", backup):
        problems.append("BACKUP must name one table")
    creates = False
    if backup:
        # BACKUP-CREATES-1: a file that creates its backup before any destructive statement (or has none, e.g. an UPDATE
        # whose Rollback line restores from the backup) must not demand the table already exist (#856).
        first = next((i for i, s in enumerate(stmts) if DESTRUCTIVE.match(body(s))), len(stmts))
        mk = re.compile(r"^\s*CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?\"?" + re.escape(backup) + r"\"?\s+AS\s+SELECT\b", re.I)
        creates = any(mk.match(body(s)) for s in stmts[:first])
        # BACKUP-CREATES-2 (2026-10-13): the CREATE TABLE <backup> (...) + INSERT INTO <backup> SELECT pair is a self-made
        # backup too; the runner used to demand that table already exist and failed the file on main (migration_runs 134).
        mk_ddl = re.compile(r"^\s*CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?\"?" + re.escape(backup) + r"\"?\s*\(", re.I)
        mk_fill = re.compile(r"^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+\"?" + re.escape(backup) + r"\"?[\s(].*\bSELECT\b", re.I | re.S)
        head = [body(s) for s in stmts[:first]]
        creates = creates or (any(mk_ddl.match(h) for h in head) and any(mk_fill.match(h) for h in head))
        # BACKUP-SELF-EMPTY-1 (2026-10-14, migration_runs 244): a BACKUP that names a table this same file creates empty passed
        # --check and then failed on main, because the runner wants the backup to exist and hold rows before it runs the file. A
        # new table backs nothing up: drop the BACKUP line when the file deletes nothing, or fill the table from the rows first.
        if not creates and any(mk_ddl.match(body(s2)) for s2 in stmts):
            problems.append("BACKUP " + backup + " is a table this file creates empty; the runner requires it to exist and hold rows "
                            "(BACKUP-SELF-EMPTY-1): remove the BACKUP line if nothing is deleted, or create it AS SELECT from the rows")
    return True, problems, {"db": db, "statements": len(stmts), "destructive": len(destructive), "row_destructive": len(row_destructive),
                            "backup": backup, "creates_backup": creates, "parse_lint": parse_note or "ok"}


# BP26-D1-DISCIPLINE-1 (2026-10-28, agent_issues 1000349): a Time Travel bookmark is recorded in migration_runs.bookmark before a file
# runs, so a bad migration can be rolled back to the moment before it with `wrangler d1 time-travel restore`. Best effort by design:
# a failed bookmark read never blocks a migration (the BACKUP header rules still apply); the column is added on first use.
def time_travel_bookmark(acct, token, db_id):
    import cf_ops_actions as C
    try:
        st, j = C.call("GET", f"/accounts/{acct}/d1/database/{db_id}/time_travel/bookmark", token, None, timeout=30)
        if st == 200 and j.get("success", False):
            return str((j.get("result") or {}).get("bookmark") or "")
    except Exception:  # noqa: BLE001
        pass
    return ""


def ensure_bookmark_column(acct, token, ledger_id):
    try:
        d1(acct, token, ledger_id, "ALTER TABLE migration_runs ADD COLUMN bookmark TEXT")
    except Exception as e:  # noqa: BLE001
        if "duplicate column" not in str(e).lower():
            return False
    return True


D1_OVERLOAD_BACKOFF_S = (5, 10, 20, 30, 45)  # D1-429-RETRY-1: "D1 DB is overloaded ... 10 second window" rejects the statement, so a retry is safe


def d1(acct, token, db_id, sql, params=None, meta=None, retry=True):
    import time
    import cf_ops_actions as C
    for wait in (D1_OVERLOAD_BACKOFF_S if retry else ()) + (None,):
        st, j = C.call("POST", f"/accounts/{acct}/d1/database/{db_id}/query", token, {"sql": sql, "params": params or []}, timeout=90)
        if st != 429 or wait is None:
            break
        time.sleep(wait)
    if st != 200 or not j.get("success", False):
        raise RuntimeError("D1 HTTP " + str(st) + ": " + json.dumps(j.get("errors") or j)[:300])
    res = j.get("result") or []
    if meta is not None:
        meta.update((res[0].get("meta") if res else None) or {})
    return (res[0].get("results") if res else []) or []


# D1-TRIGGER-DEPTH-1 (2026-10-08): D1 refuses any write whose trigger programs nest more than 10 levels ("triggers nested
# too deep"), and it counts at compile time: a trigger whose WHEN is never true still counts, and so does an INSERT ... WHERE 0.
# Measured on scratch tables: a 10-trigger chain compiles, 11 fails. On 2026-10-08 two migrations (fleet_tick feeders in
# -10, self-updating agent_issues triggers in -13) pushed the cron log, heartbeat, event and metric writes over it for about
# 30 minutes. So after every CREATE TRIGGER the runner compiles a zero-row INSERT, UPDATE and DELETE on every table whose
# trigger chain can reach the new trigger's table, and drops the trigger at once if any of them is refused.
TRIGGER_ON = re.compile(r'(?is)^\s*CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+(?:BEFORE|AFTER|INSTEAD\s+OF)?\s*(?:INSERT|UPDATE|DELETE)\b.*?\bON\s+"?(\w+)"?')
WRITE_TARGET = re.compile(r'(?is)\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+"?(\w+)"?')
# NOOP-UPDATE-1 (2026-11-04, from session:spend-enforce): ISSUE-PROBE-CAP-1 and CAP-2 both applied "ok" in migration_runs, but their
# UPDATE fleet_tasks SET steps = replace(steps, ...) WHERE ... matched 0 rows (the live text had moved on), so the cap never existed while
# decision_log said it did, and about 1.2 M neurons a day ran uncapped for a day. D1 returns meta.changes for every statement and d1()
# used to drop it. A top-level UPDATE with a WHERE that changed 0 rows is now reported (JSON key noop_updates, a ::warning annotation and a
# cloud_ops_events row), never failed: a replay or a guard that is already satisfied legitimately matches nothing. A file that expects it
# says so with a `-- NOOP-OK: <why>` line. kind migration-noop-replace is the text-surgery class the incident belonged to (detector
# fm-migration-noop-replace reads it).
NOOP_UPDATE = re.compile(r'(?is)^\s*UPDATE\s+(?:OR\s+\w+\s+)?"?(\w+)"?\s+SET\b.*\bWHERE\b')
NOOP_OK = re.compile(r'(?im)^\s*--\s*NOOP-OK\b')
NOOP_REPLACE = re.compile(r'(?i)\breplace\s*\(')
def top_where(sql):
    """Index just after the first top-level WHERE (outside quotes and parentheses), or -1."""
    depth, quote, i, n = 0, None, 0, len(sql)
    while i < n:
        c = sql[i]
        if quote:
            if c == quote:
                if i + 1 < n and sql[i + 1] == quote:
                    i += 2
                    continue
                quote = None
        elif c in "'\"":
            quote = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif depth == 0 and c in "Ww" and sql[i:i + 5].upper() == "WHERE" and (i == 0 or not (sql[i - 1].isalnum() or sql[i - 1] == "_")) \
                and (i + 5 >= n or not (sql[i + 5].isalnum() or sql[i + 5] == "_")):
            return i + 5
        i += 1
    return -1


def call_args(sql, open_idx):
    """The top-level arguments of the call whose '(' is at open_idx (quotes and nested parentheses respected), or None."""
    depth, quote, start, args, i, n = 0, None, open_idx + 1, [], open_idx, len(sql)
    while i < n:
        c = sql[i]
        if quote:
            if c == quote:
                if i + 1 < n and sql[i + 1] == quote:
                    i += 2
                    continue
                quote = None
        elif c in "'\"":
            quote = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                args.append(sql[start:i].strip())
                return args
        elif c == "," and depth == 1:
            args.append(sql[start:i].strip())
            start = i + 1
        i += 1
    return None


REPLACE_COL = re.compile(r'^"?\w+"?$')
REPLACE_LIT = re.compile(r"^'(?:[^']|'')*'$")
REPLACE_CALL = re.compile(r"(?is)^replace\s*\(")


def replace_terms(set_part):
    """[(column, 'quoted text')] for every replace(column, 'text', ...) in a SET clause, following replace(replace(column, ...), ...) chains;
    None when a call's target is not a plain column or its search text is not a literal (then nothing is probed, so nothing is guessed)."""
    terms = []
    for m in re.finditer(r"(?i)\breplace\s*\(", set_part):
        args = call_args(set_part, m.end() - 1)
        if not args or len(args) != 3 or not REPLACE_LIT.match(args[1]):
            return None
        col = args[0]
        while REPLACE_CALL.match(col):
            inner = call_args(col, REPLACE_CALL.match(col).end() - 1)
            if not inner:
                return None
            col = inner[0]
        if not REPLACE_COL.match(col):
            return None
        terms.append((col, args[1]))
    return terms


def drop_comments(sql):
    """sql without "--" line comments and /* */ blocks, string literals and quoted identifiers kept as written."""
    out, i, n = [], 0, len(sql)
    while i < n:
        two, c = sql[i:i + 2], sql[i]
        if two == "--":
            while i < n and sql[i] != "\n":
                i += 1
        elif two == "/*":
            j = sql.find("*/", i + 2)
            i = n if j < 0 else j + 2
            out.append(" ")
        elif c in "'\"`":
            j = i + 1
            while j < n and not (sql[j] == c and sql[j + 1:j + 2] != c):
                j += 2 if sql[j] == c else 1
            out.append(sql[i:j + 1])
            i = j + 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def replace_text_probe(stmt):
    """NOOP-UPDATE-1: `UPDATE t SET c = replace(c, 'A', 'B') WHERE k = 1` matches its row and reports changes = 1 even when no row holds 'A', so
    meta.changes cannot see a replace() that finds nothing. This read-only EXISTS asks the live rows the same WHERE whether any of them holds a
    text the statement replaces; 0 means the text surgery is a no-op. None when the statement is not that shape: every SET assignment must be a
    replace() call (a statement that also sets another column changes something whatever the replace() finds), and a trailing comment is
    dropped first so it cannot swallow the appended condition."""
    stmt = drop_comments(stmt)
    m = NOOP_UPDATE.match(stmt)
    w = top_where(stmt) if m else -1
    if w < 0:
        return None
    set_part = stmt[:w]
    assigns = _split_top(re.sub(r"(?is)^\s*UPDATE\s+(?:OR\s+\w+\s+)?\"?\w+\"?\s+SET\b", "", set_part, count=1)[:-5])
    if not assigns or not all(REPLACE_CALL.match(a.split("=", 1)[1].strip()) for a in assigns if "=" in a) or any("=" not in a for a in assigns):
        return None
    terms = replace_terms(set_part)
    if not terms:
        return None
    return 'SELECT EXISTS (SELECT 1 FROM "%s" WHERE (%s) AND (%s)) AS n' % (m.group(1), stmt[w:].strip().rstrip(";").strip(), " OR ".join("instr(%s, %s) > 0" % (c, lit) for c, lit in terms))


# TRIGGER-COMPILE-CANARY-1 (2026-11-04): a trigger body or a view it reads that no longer compiles fails EVERY write to the table at prepare time,
# whatever the trigger's WHEN says. outcome_northstar_tick (migrations/2026-11-04-outcome-northstar.sql) read ask_feedback.created_at, a column that
# does not exist, so every INSERT INTO fleet_tick failed with "no such column: created_at" from 16:43:47Z to 16:58:44Z: no 10-minute fixer ran for 24
# minutes. The canary compiled the zero-row INSERT probe on fleet_tick and saw the error, but only "nested too deep" was acted on. A compile-class
# error now refuses the trigger too, unless it is already there without this trigger (a latent fault elsewhere, reported as an advisory).
TRIGGER_COMPILE_ERR = re.compile(r"no such (?:column|table|function|collation sequence)|ambiguous column name|syntax error|misuse of aggregate", re.I)
ADD_COLUMN = re.compile(r"(?is)^\s*ALTER\s+TABLE\s+\S+\s+ADD\s+(?:COLUMN\s+)?")


def trigger_upstream(trigger_rows, table):
    """Tables whose writes can reach `table` through trigger bodies (the table itself included)."""
    edges = {}
    for r in trigger_rows:
        m = TRIGGER_ON.match(r.get("sql") or "")
        if not m:
            continue
        sql = r["sql"]
        begin = re.search(r"(?is)\bBEGIN\b", sql)
        for t in WRITE_TARGET.findall(sql[begin.end():] if begin else ""):
            edges.setdefault(t.lower(), set()).add(m.group(2).lower())
    seen, todo = {table.lower()}, [table.lower()]
    while todo:
        for src in edges.get(todo.pop(), ()):
            if src not in seen:
                seen.add(src)
                todo.append(src)
    return seen


# INSERT-BASELINE-CANARY-1 (2026-11-04, live outage 18:57:17-19:22Z): migration cloud-ops-events-trigger-cost.sql re-created tool_error_rate_filer_v3_ins (an AFTER INSERT
# trigger on cloud_ops_events whose body INSERTs into agent_issues) with only its WHEN clause changed. From 9 seconds later every plain INSERT INTO cloud_ops_events
# ("INSERT ... VALUES" and "INSERT ... SELECT") failed with "triggers nested too deep" (INSERT OR IGNORE and OR REPLACE still worked, so about half the writers did), for 25
# minutes, across qnfo-ops, qnfo-fleet-control, qnfo-pdf and qnfo-youtube-shorts. The canary saw it: its INSERT-shaped probe was refused, but since 2026-10-18 that refusal is
# only an advisory (on agent_issues the same form is refused whatever the trigger contains while real inserts work), so the run was recorded ok. Reproduced on a scratch copy of
# the schema: with the filer trigger absent the insert compiles; with it present, in either its old or new text, as the newest trigger of the table, it does not; the same trigger
# with INSERT OR IGNORE INTO agent_issues in its body compiles. A table whose insert probe is refused BEFORE the file runs (agent_issues) is chronic and stays an advisory; a table
# whose insert probe passed before and is refused after a CREATE TRIGGER is this file's regression and refuses it, exactly like an UPDATE or DELETE refusal.
def insert_probe(acct, token, db_id, name):
    """'ok', 'deep' (refused with a trigger-depth error) or 'unknown' for a zero-row explicit-column INSERT on table `name`."""
    cols = [c["name"] for c in d1(acct, token, db_id, "SELECT name FROM pragma_table_info(?1)", [name])]
    if not cols:
        return "unknown"
    ins = 'INSERT INTO "%s" (%s) SELECT %s FROM "%s" WHERE 0' % (name, ", ".join('"%s"' % c for c in cols), ", ".join('"%s"' % c for c in cols), name)
    try:
        d1(acct, token, db_id, ins, retry=False)
        return "ok"
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        return "deep" if ("nested too deep" in msg or "too many levels of trigger" in msg) else "unknown"


def insert_baseline(acct, token, db_id, trigger_rows, tables):
    """{table: 'ok'|'deep'|'unknown'} for each table in `tables` and every table upstream of it, read before a file changes any trigger."""
    names = {r["name"].lower(): r["name"] for r in d1(acct, token, db_id, "SELECT name FROM sqlite_master WHERE type = 'table'")}
    want = set()
    for t in tables:
        want |= trigger_upstream(trigger_rows, t)
    return {t: insert_probe(acct, token, db_id, names[t]) for t in sorted(want) if t in names}


def depth_canary(acct, token, db_id, table, advisory=None, baseline=None):
    """None when every zero-row UPDATE/DELETE upstream of `table` still compiles, else the refused statement and error.

    TRIGGER-DEPTH-INSERT-ADVISORY-1 (2026-10-18, migration_runs 292/296): an INSERT-shaped zero-row probe is still run,
    because it is the strongest signal, but its refusal no longer vetoes the change on its own. Measured on
    qnfo-audit.agent_issues (13:14Z): every `INSERT ... SELECT` form is refused with 7500 "triggers nested too deep" -
    with a star select, with an explicit column list, and with a literal source that reads nothing - while
    `DELETE ... WHERE 0` and `UPDATE ... SET c = c WHERE 0` compile, and real single-row INSERTs succeed (the fleet filed
    agent_issues 99905/99906 at 13:10Z). A statement shape D1 refuses whatever the trigger contains cannot answer "did
    this trigger break inserts?", and acting on it deleted a working trigger twice (migration_runs 292 left production
    without agent_issues_autotriage2_ins; 296 was saved only by the restore snapshot). So a refused INSERT probe is
    reported through `advisory` and the UPDATE/DELETE probes decide.

    The cost is stated plainly: UPDATE/DELETE traverse the trigger graph but not the insert path, so a purely insert-path
    depth regression no longer stops an apply. It surfaces through real traffic instead, which the fleet generates
    continuously. That is the trade this makes.
    """
    trig = d1(acct, token, db_id, "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger'")
    tables = {r["name"].lower(): r["name"] for r in d1(acct, token, db_id, "SELECT name FROM sqlite_master WHERE type = 'table'")}
    for t in sorted(trigger_upstream(trig, table)):
        if t not in tables:
            continue
        name = tables[t]
        cols = [c["name"] for c in d1(acct, token, db_id, "SELECT name FROM pragma_table_info(?1)", [name])]
        deciding = ['DELETE FROM "%s" WHERE 0' % name]
        if cols:
            deciding.append('UPDATE "%s" SET %s WHERE 0' % (name, ", ".join('"%s" = "%s"' % (c, c) for c in cols)))
        for q in deciding:
            try:
                d1(acct, token, db_id, q)
            except Exception as e:  # noqa: BLE001
                if "nested too deep" in str(e) or "too many levels of trigger" in str(e):
                    return q[:120] + " -> " + str(e)[:200]
                if TRIGGER_COMPILE_ERR.search(str(e)):
                    return "TRIGGER-COMPILE-1: " + q[:120] + " -> " + str(e)[:200]
        if cols:
            ins = 'INSERT INTO "%s" (%s) SELECT %s FROM "%s" WHERE 0' % (
                name, ", ".join('"%s"' % c for c in cols), ", ".join('"%s"' % c for c in cols), name)
            try:
                d1(acct, token, db_id, ins)
            except Exception as e:  # noqa: BLE001
                msg = str(e)
                if ("nested too deep" in msg or "too many levels of trigger" in msg) and baseline and baseline.get(t) == "ok":
                    return ins[:70] + " -> triggers nested too deep (INSERT-BASELINE-CANARY-1: it compiled before this file)"
                if ("nested too deep" in msg or "too many levels of trigger" in msg) and advisory is not None:
                    advisory.append(ins[:120] + " -> " + msg[:120])
                elif TRIGGER_COMPILE_ERR.search(msg):
                    return "TRIGGER-COMPILE-1: " + ins[:120] + " -> " + msg[:200]
    return None


def tick_compile_error(acct, token, db_id):
    """TRIGGER-COMPILE-CANARY-1 (2026-11-04): None when a zero-row INSERT into fleet_tick compiles, else the compile-class error text.

    SQLite compiles every AFTER INSERT trigger body, and the views they read, when the INSERT is prepared, so one missing column in a view the tick
    triggers read fails every tick insert even though no trigger was created or changed (a CREATE OR REPLACE of the view is enough). A table that
    does not exist (another database) or an error of another class is not a verdict."""
    try:
        d1(acct, token, db_id, "INSERT INTO fleet_tick (source) SELECT 'migration-canary' WHERE 0")
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if TRIGGER_COMPILE_ERR.search(msg) and "no such table: main.fleet_tick" not in msg and "no such table: fleet_tick" not in msg:
            return msg[:200]
    return None


# MIGRATION-CONCURRENT-APPLY-1 (2026-10-19, agent_issues 99991): the push-triggered runner (apply-migrations.yml) and the hourly
# consumer sweep (MIGRATION-UNAPPLIED-1) can apply the same merged file at the same moment, because the sweep lists a file as
# unapplied until the first runner records its ok row at the END of the file. The second runner then meets an object the first
# one just created ("trigger remediation_reopen_on_relapse_d1 already exists", migration_runs 2026-10-19T16:32:39Z) and recorded an
# error row plus a MIGRATION-APPLY-FAILED-1 issue, and the sweep reported "failed" in a migration-sweep event: 18 such events filed
# LOOP-BREAKER-1 99991 while every file was in fact applied ok seconds later. When a statement fails with an "already exists"
# class error, the runner waits up to CONCURRENT_WAIT_S for the other runner's ok row for the SAME content (sha256); finding it
# is a success with no error row and no issue, and not finding it is recorded as a failure exactly as before.
CONCURRENT_WAIT_S = 120
CONCURRENT_POLL_S = 5
CONCURRENT_ERRORS = ("already exists", "UNIQUE constraint failed")
_sleep = time.sleep


def applied_by_other(acct, token, db_id, path, sha, err):
    """True when err is an already-exists class error and another runner records an ok run of this very content within the wait."""
    if not any(k in str(err) for k in CONCURRENT_ERRORS):
        return False
    deadline = time.time() + CONCURRENT_WAIT_S
    while True:
        try:
            if d1(acct, token, db_id, "SELECT id FROM migration_runs WHERE file = ?1 AND sha256 = ?2 AND status = 'ok' LIMIT 1", [path, sha]):
                return True
        except Exception:  # noqa: BLE001 - the ledger unreadable: record the failure as before
            return False
        if time.time() >= deadline:
            return False
        _sleep(CONCURRENT_POLL_S)


def apply_file(path, text, acct, token, commit, emit=print):
    ok, problems, info = plan(path, text)
    if not ok:
        emit(json.dumps({"file": path, "skipped": info.get("skip")}))
        return 0
    if problems:
        emit(json.dumps({"file": path, "refused": problems}))
        return 1
    db_id = DATABASES[info["db"]]
    ledger_id = DATABASES[LEDGER_DB]
    sha = hashlib.sha256(text.encode()).hexdigest()
    d1(acct, token, ledger_id, LEDGER_DDL)
    done = d1(acct, token, ledger_id, "SELECT id FROM migration_runs WHERE file = ?1 AND sha256 = ?2 AND status = 'ok' LIMIT 1", [path, sha])
    if done:
        emit(json.dumps({"file": path, "already_applied": True, "sha256": sha[:12]}))
        resolve_applied(path, sha, acct, token, ledger_id, done[0].get("id"))
        return 0
    # MIGRATION-STALE-SHA-1 (2026-10-14, agent_issues 2556): a run on an older commit replays the content that commit holds. When that
    # content already failed and a newer content of the same file has since applied ok, the replay can only fail again and file a
    # MIGRATION-APPLY-FAILED-1 issue for a file that main holds applied: migration_runs 248 (commit 03b9dcd, 03:54:20Z) replayed the
    # fleet-journeys content refused as run 244 after run 246 had applied its repair, and the issue was reopened. Such a content is
    # skipped as superseded, with no error row and no issue; a content that never failed, or one with no newer ok row, runs as before.
    stale = d1(acct, token, ledger_id, "SELECT e.id AS err_id, o.id AS ok_id, o.sha256 AS ok_sha FROM migration_runs e JOIN migration_runs o "
               "ON o.file = e.file AND o.status = 'ok' AND o.sha256 <> e.sha256 AND o.id > e.id "
               "WHERE e.file = ?1 AND e.sha256 = ?2 AND e.status = 'error' ORDER BY o.id DESC LIMIT 1", [path, sha])
    if stale:
        emit(json.dumps({"file": path, "superseded": True, "sha256": sha[:12], "note": "MIGRATION-STALE-SHA-1: this content failed as "
                         "migration_runs " + str(stale[0].get("err_id")) + " and a newer content (sha256 " + str(stale[0].get("ok_sha") or "")[:12]
                         + ") applied ok as migration_runs " + str(stale[0].get("ok_id")) + "; a run on an older commit does not replay it"}))
        return 0
    # D1-TRIGGER-DEPTH-RETRY-1 (2026-10-13): a file whose same content was already refused by the depth canary fails the same
    # way again, and every re-run repeats its DROP and CREATE TRIGGER: the new trigger is live until the canary drops it, so
    # writes through that table fail for those seconds, and an old trigger the file dropped first stays gone. migration_runs
    # 225, 227 and 228 (one sha256, 21:56-22:02Z) were this: three short insert outages on cloud_ops_events. Such a file
    # runs again only when its content changes (a new sha256).
    depth = d1(acct, token, ledger_id, "SELECT id FROM migration_runs WHERE file = ?1 AND sha256 = ?2 AND status = 'error' "
               "AND (instr(COALESCE(error, ''), 'D1-TRIGGER-DEPTH-1') > 0 OR instr(COALESCE(error, ''), 'TRIGGER-COMPILE-1') > 0) ORDER BY id DESC LIMIT 1", [path, sha])
    if depth:
        emit(json.dumps({"file": path, "ok": False, "refused": "D1-TRIGGER-DEPTH-RETRY-1: this content was refused by the depth "
                         "canary in migration_runs " + str(depth[0].get("id")) + "; change the file to run it again", "sha256": sha[:12]}))
        return 1
    def backup_missing():
        n = d1(acct, token, db_id, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?1", [info["backup"]])
        if not n or int(n[0].get("n") or 0) == 0:
            return "BACKUP table " + info["backup"] + " does not exist"
        rows = d1(acct, token, db_id, 'SELECT COUNT(*) AS n FROM "' + info["backup"] + '"')
        # BACKUP-SCHEMA-ONLY-1: an empty backup stops only a file that destroys rows (DELETE FROM, DROP TABLE). A file whose destructive
        # statements are all DROP TRIGGER / DROP INDEX / DROP VIEW loses no row, so there is nothing for the backup to hold.
        if (not rows or int(rows[0].get("n") or 0) == 0) and info.get("row_destructive", 1):
            return "BACKUP table " + info["backup"] + " is empty"
        return None
    checked = not info["backup"]
    if info["backup"] and not info.get("creates_backup"):
        why = backup_missing()
        if why:
            return record_failure(path, sha, commit, info, acct, token, ledger_id, why, emit)
        checked = True
    done_n = 0
    bookmark = time_travel_bookmark(acct, token, db_id) if ensure_bookmark_column(acct, token, ledger_id) else ""
    # D1-TRIGGER-DEPTH-RESTORE-1 (2026-10-18, migration_runs 292): snapshot every trigger definition BEFORE the file runs, so
    # a refused canary can put the table back the way it was. A per-statement read is not enough: a file that does
    # DROP TRIGGER then CREATE TRIGGER has already removed the standing definition by the time the CREATE is checked, and
    # the old runner then dropped the new one too, leaving the table silently without the trigger the migration was only
    # trying to adjust.
    trigger_snapshot = {}
    advisories = []
    noops = []
    try:
        for r in d1(acct, token, db_id, "SELECT name, sql FROM sqlite_master WHERE type = 'trigger'"):
            trigger_snapshot[(r.get("name") or "").lower()] = r.get("sql")
    except Exception:  # noqa: BLE001
        trigger_snapshot = {}
    # TRIGGER-COMPILE-CANARY-1: a file that creates, drops or alters anything could break the fleet_tick insert through a view its triggers read, so
    # the insert is probed before and after; only a fault the file brought makes it fail, and the views it created or changed are put back.
    insert_base = {}
    trig_tables = {m.group(2) for m in (TRIGGER_ON.match(body(s)) for s in statements(text)) if m}
    if trig_tables and info["db"] == "qnfo-audit":
        try:
            insert_base = insert_baseline(acct, token, db_id, [{"sql": v} for v in trigger_snapshot.values() if v], trig_tables)
        except Exception:  # noqa: BLE001 - no baseline: every insert refusal stays an advisory, as before
            insert_base = {}
    tick_baseline_ok, view_snapshot = None, {}
    if info["db"] == "qnfo-audit" and re.search(r"(?im)^\s*(?:CREATE|DROP|ALTER)\s", text):
        try:
            tick_baseline_ok = tick_compile_error(acct, token, db_id) is None
            for r in d1(acct, token, db_id, "SELECT name, sql FROM sqlite_master WHERE type = 'view'"):
                view_snapshot[(r.get("name") or "").lower()] = (r.get("name"), r.get("sql"))
        except Exception:  # noqa: BLE001
            tick_baseline_ok, view_snapshot = None, {}
    for s in statements(text):
        if not checked and DESTRUCTIVE.match(body(s)):
            why = backup_missing()
            if why:
                return record_failure(path, sha, commit, info, acct, token, ledger_id, why + " (checked before statement " + str(done_n + 1) + ")", emit, done_n)
            checked = True
        # D1-TRIGGER-DEPTH-RESTORE-1: the definition this statement may replace, captured before the file ran.
        tm = TRIGGER_ON.match(body(s))
        prior = trigger_snapshot.get(tm.group(1).lower()) if tm else None
        noop_meta = {} if (NOOP_UPDATE.match(body(s)) and not NOOP_OK.search(text)) else None
        no_text = False
        if noop_meta is not None and replace_text_probe(body(s)):
            try:
                held = d1(acct, token, db_id, replace_text_probe(body(s)), retry=False)  # one attempt: the probe must never cost the statement its time
                no_text = bool(held) and int(held[0].get("n") or 0) == 0
            except Exception:  # noqa: BLE001 - a probe that cannot run never blocks the statement
                no_text = False
        try:
            if noop_meta is None:
                d1(acct, token, db_id, body(s))
            else:
                d1(acct, token, db_id, body(s), meta=noop_meta)
            done_n += 1
            if noop_meta is not None and (noop_meta.get("changes") == 0 or no_text):
                noops.append((done_n, NOOP_UPDATE.match(body(s)).group(1), " ".join(body(s).split())[:160], bool(NOOP_REPLACE.search(drop_comments(body(s))[:max(top_where(drop_comments(body(s))), 0)])),
                              "found no row holding the text its replace() looks for" if no_text else "changed 0 rows"))
        except Exception as e:  # noqa: BLE001
            # A re-run after a partial apply meets the columns it already added; SQLite has no ADD COLUMN IF NOT EXISTS.
            if ADD_COLUMN.match(body(s)) and "duplicate column name" in str(e):
                done_n += 1
                continue
            if applied_by_other(acct, token, ledger_id, path, sha, e):
                emit(json.dumps({"file": path, "already_applied": True, "concurrent": True, "sha256": sha[:12], "note": "MIGRATION-CONCURRENT-APPLY-1: statement "
                                 + str(done_n + 1) + " met an object another runner created; that runner recorded this content ok, so nothing failed"}))
                return 0
            return record_failure(path, sha, commit, info, acct, token, ledger_id, "statement " + str(done_n + 1) + ": " + str(e)[:400], emit, done_n)
        tm = TRIGGER_ON.match(body(s))
        if tm:
            refused = depth_canary(acct, token, db_id, tm.group(2), advisories, insert_base)
            if refused:
                try:
                    d1(acct, token, db_id, 'DROP TRIGGER IF EXISTS "%s"' % tm.group(1))
                except Exception:  # noqa: BLE001
                    pass
                restored = ""
                if prior:
                    try:
                        d1(acct, token, db_id, prior)
                        restored = " The definition this file replaced was restored, so the table is as it was."
                        # INSERT-BASELINE-CANARY-1: a trigger's place in the table's list matters (the same text restored as the newest trigger can break inserts again),
                        # so after an insert refusal the restored definition is probed too; if inserts are refused again it is dropped, because working inserts outrank
                        # one optional trigger.
                        if refused.startswith("INSERT") and insert_probe(acct, token, db_id, tm.group(2)) == "deep":
                            d1(acct, token, db_id, 'DROP TRIGGER IF EXISTS "%s"' % tm.group(1))
                            restored = (" The replaced definition was restored, refused inserts again at its new position and was dropped again (" + tm.group(2) + " accepts inserts, "
                                        "without " + tm.group(1) + "; re-create it with a shallower body, for example INSERT OR IGNORE).")
                    except Exception as e:  # noqa: BLE001
                        restored = " RESTORE FAILED, the table is without this trigger: " + str(e)[:120]
                compile_class = refused.startswith("TRIGGER-COMPILE-1")
                if compile_class:
                    # TRIGGER-COMPILE-CANARY-1: with this trigger gone (and the prior one back), does the same probe still fail? Then the fault was already
                    # there: put the trigger back, say so, and carry on; only a fault this trigger brought is a refusal.
                    still = None
                    try:
                        still = depth_canary(acct, token, db_id, tm.group(2), None)
                    except Exception:  # noqa: BLE001
                        still = None
                    if still and still.startswith("TRIGGER-COMPILE-1"):
                        try:
                            d1(acct, token, db_id, body(s))
                            advisories.append("pre-existing compile error on " + tm.group(2) + " (not caused by trigger " + tm.group(1) + "): " + still[:160])
                            continue
                        except Exception as e:  # noqa: BLE001
                            restored += " RE-CREATE FAILED: " + str(e)[:120]
                    return record_failure(path, sha, commit, info, acct, token, ledger_id, "statement " + str(done_n) + " (trigger " + tm.group(1) +
                                          "): TRIGGER-COMPILE-1, an insert, update or delete on " + tm.group(2) + " no longer compiles with this trigger (a column, table or "
                                          "function its body or a view it reads does not have), so every write to the table would fail; the trigger was dropped at once: "
                                          + refused + restored, emit, done_n)
                return record_failure(path, sha, commit, info, acct, token, ledger_id, "statement " + str(done_n) + " (trigger " + tm.group(1) +
                                      "): D1-TRIGGER-DEPTH-1, a write now nests deeper than D1's limit, so the trigger was dropped at once: " + refused + restored, emit, done_n)
    if tick_baseline_ok:
        tick_err = tick_compile_error(acct, token, db_id)
        if tick_err:
            restored_views = []
            try:
                for r in d1(acct, token, db_id, "SELECT name, sql FROM sqlite_master WHERE type = 'view'"):
                    key = (r.get("name") or "").lower()
                    before = view_snapshot.get(key)
                    if before is None or before[1] != r.get("sql"):
                        d1(acct, token, db_id, 'DROP VIEW IF EXISTS "%s"' % r.get("name"))
                        if before is not None:
                            d1(acct, token, db_id, before[1])
                        restored_views.append(r.get("name"))
            except Exception as e:  # noqa: BLE001
                restored_views.append("RESTORE FAILED: " + str(e)[:100])
            fixed = tick_compile_error(acct, token, db_id) is None
            return record_failure(path, sha, commit, info, acct, token, ledger_id, "statement " + str(done_n) + ": TRIGGER-COMPILE-1, INSERT INTO fleet_tick compiled before this "
                                  "file and fails after it (" + tick_err + "): every tick insert would fail. Views created or changed by the file were put back (" + ", ".join(restored_views or ["none"])
                                  + "); the insert compiles again: " + ("yes" if fixed else "NO, repair at once"), emit, done_n)
    try:
        d1(acct, token, ledger_id, "INSERT INTO migration_runs (file, sha256, commit_sha, db, status, statements, applied_by, bookmark, bookmark_source) VALUES (?1, ?2, ?3, ?4, 'ok', ?5, 'ci:apply-migrations', ?6, ?7)",
           [path, sha, commit or "", info["db"], str(done_n), bookmark, "apply-time" if bookmark else ""])
    except Exception:  # noqa: BLE001
        d1(acct, token, ledger_id, "INSERT INTO migration_runs (file, sha256, commit_sha, db, status, statements, applied_by) VALUES (?1, ?2, ?3, ?4, 'ok', ?5, 'ci:apply-migrations')",
           [path, sha, commit or "", info["db"], str(done_n)])
    resolve_failure(path, sha, acct, token, ledger_id, done_n)
    applied = {"file": path, "ok": True, "statements": done_n, "sha256": sha[:12]}
    if advisories:
        # TRIGGER-DEPTH-INSERT-ADVISORY-1: the change applied, but a zero-row INSERT probe upstream of a trigger it creates
        # was refused. That shape is refused on agent_issues whatever the trigger contains, so it is reported here rather
        # than vetoing the file. A run carrying this key means the table's insert path is at or past D1's compile limit and
        # is worth reading even though the migration succeeded.
        applied["advisory"] = advisories
    if noops:
        applied["noop_updates"] = ["statement %d: UPDATE %s %s: %s" % (n, t, w, h) for n, t, h, _r, w in noops]
        report_noop_updates(path, sha, noops, acct, token, ledger_id)
    emit(json.dumps(applied))
    return 0


def report_noop_updates(path, sha, noops, acct, token, db_id):
    """NOOP-UPDATE-1: best effort, never fails the run. One cloud_ops_events row per statement, and a workflow annotation on stderr."""
    for n, table, head, is_replace, why in noops:
        msg = ("NOOP-UPDATE-1: " + path + " statement " + str(n) + " (UPDATE " + table + ") applied and " + why + ", so what it meant to change did not change"
               + (" (a replace() on live text that no longer matches)" if is_replace else "") + "; add a '-- NOOP-OK: <why>' line if that is intended")
        print("::warning file=" + path.replace("%", "%25").replace(",", "%2C").replace(":", "%3A") + "::" + msg.replace("%", "%25").replace(chr(10), "%0A"), file=sys.stderr)
        try:
            d1(acct, token, db_id, "INSERT OR IGNORE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?2, ?3, ?4, 'apply-migrations', 'warn')",
               ["noop-update-" + sha[:12] + "-" + str(n), "migration-noop-replace" if is_replace else "migration-noop-update", msg[:900],
                json.dumps({"file": path, "sha256": sha[:12], "statement": n, "table": table, "head": head})])
        except Exception as e:  # noqa: BLE001
            print("noop report " + path + " failed: " + str(e)[:160], file=sys.stderr)


# CLOSE-CHANNEL-REQUIRED-1 (agent_issues 100419): this close wrote no close_channel, so MIGRATION-APPLY-FAILED-1 issue 1000212 closed with
# NULL and could not be attributed to a fix, a probe or a sweep. Named like the other loop closes ("auto:<loop>-<step>").
RESOLVE_CLOSE_CHANNEL = "auto:migration-apply-resolve"
RESOLVE_CLOSE_SQL = ("UPDATE agent_issues SET status = 'closed', close_channel = '" + RESOLVE_CLOSE_CHANNEL + "', "
                     "updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000, "
                     "description = COALESCE(description, '') || char(10) || 'MIGRATION-APPLY-RESOLVE-1: ' || ?2 WHERE title = ?1 "
                     "AND status NOT IN ('closed','resolved','wontfix')")


def resolve_failure(path, sha, acct, token, db_id, done_n):
    """MIGRATION-APPLY-RESOLVE-1 (2026-10-08): a later ok run closes the MIGRATION-APPLY-FAILED-1 issue this runner filed
    for the file, with the ok run as evidence. Before, nothing closed it: its birth probe read pending for 48h and then
    stale, so a migration fixed within the hour still left an open issue (2188-2190). Best effort; never fails the run."""
    title = "MIGRATION-APPLY-FAILED-1: " + os.path.basename(path)
    ev = "migration_runs ok for " + path + " (sha256 " + sha[:12] + ", " + str(done_n) + " statements, ci:apply-migrations)"
    try:
        d1(acct, token, db_id, "UPDATE issue_triage SET close_evidence = ?2 WHERE issue_id IN (SELECT id FROM agent_issues WHERE title = ?1 "
           "AND status NOT IN ('closed','resolved','wontfix'))", [title, ev])
        d1(acct, token, db_id, RESOLVE_CLOSE_SQL, [title, ev])
    except Exception as e:  # noqa: BLE001
        print("resolve " + title + " failed: " + str(e)[:200], file=sys.stderr)


def resolve_applied(path, sha, acct, token, db_id, ok_id):
    """MIGRATION-APPLY-RESOLVE-2 (2026-11-05, agent_issues 1001682): the content on main is already applied ok (an earlier run of this very sha256), so an open
    MIGRATION-APPLY-FAILED-1 issue of the file can only stand for an error run of another content that was edited away: migration_runs 1121 failed a code-task edit of
    2026-11-02-management-personas-metric-intake.sql, PR 7124 reverted the edit, every later push reported 'already applied' and wrote no row, and the issue stayed open
    for ever because MIGRATION-APPLY-RESOLVE-1 only closes on a NEW ok run. Closes it with the ok run as evidence, through the same statement and channel. Reads first, so a
    push of files with no open issue costs one read per file. Best effort; never fails the run."""
    title = "MIGRATION-APPLY-FAILED-1: " + os.path.basename(path)
    try:
        if not d1(acct, token, db_id, "SELECT id FROM agent_issues WHERE title = ?1 AND status NOT IN ('closed','resolved','wontfix') LIMIT 1", [title]):
            return
        ev = ("migration_runs " + str(ok_id) + " ok for " + path + " carries the content now on main (sha256 " + sha[:12] + "); the failed run was of an edit that is no longer "
              "on main (MIGRATION-APPLY-RESOLVE-2)")
        d1(acct, token, db_id, "UPDATE issue_triage SET close_evidence = ?2 WHERE issue_id IN (SELECT id FROM agent_issues WHERE title = ?1 "
           "AND status NOT IN ('closed','resolved','wontfix'))", [title, ev])
        d1(acct, token, db_id, RESOLVE_CLOSE_SQL, [title, ev])
    except Exception as e:  # noqa: BLE001
        print("resolve-applied " + title + " failed: " + str(e)[:200], file=sys.stderr)


ISSUE_NOW_MS = "CAST(strftime('%s','now') AS INTEGER) * 1000"
ISSUE_OPEN = "status NOT IN ('closed','resolved','wontfix')"


def file_failure_issue(acct, token, db_id, title, desc):
    """Records the MIGRATION-APPLY-FAILED-1 issue once; returns 'select', 'values' or 'exists'. Raises when no form could be written.

    APPLY-MIGRATIONS-LINT-1 (2026-10-20, workflow failure audit): the one-statement form, INSERT ... SELECT ... WHERE NOT EXISTS, is the shape
    D1 refuses on agent_issues while its trigger chain is at the 10-level limit ("triggers nested too deep", measured 2026-10-18 13:14Z: every
    INSERT ... SELECT is refused, a single-row INSERT ... VALUES succeeds). The failure was then only printed, so migration_runs 291, 293 and
    296 left a red run and no issue (no-silent-drop). When the first form raises, the open duplicate is looked up with a SELECT and the row is
    written with INSERT ... VALUES; the unique index on open titles (idx_agent_issues_open_title_ci) is the second guard against a duplicate."""
    cols = "(title, description, source, category, priority, status, created_at, updated_at)"
    try:
        d1(acct, token, db_id, "INSERT INTO agent_issues " + cols + " "
           "SELECT ?1, ?2, 'ci:apply-migrations', 'migration', 'high', 'open', " + ISSUE_NOW_MS + ", " + ISSUE_NOW_MS + " "
           "WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = ?1 AND " + ISSUE_OPEN + ")", [title, desc])
        return "select"
    except Exception as first:  # noqa: BLE001
        try:
            if d1(acct, token, db_id, "SELECT id FROM agent_issues WHERE title = ?1 AND " + ISSUE_OPEN + " LIMIT 1", [title]):
                return "exists"
        except Exception:  # noqa: BLE001 - the duplicate check unreadable: the insert below is still guarded by the unique index
            pass
        try:
            d1(acct, token, db_id, "INSERT INTO agent_issues " + cols + " VALUES (?1, ?2, 'ci:apply-migrations', 'migration', 'high', 'open', "
               + ISSUE_NOW_MS + ", " + ISSUE_NOW_MS + ")", [title, desc])
            return "values"
        except Exception as second:  # noqa: BLE001
            if "UNIQUE constraint failed" in str(second):
                return "exists"
            raise RuntimeError("select form: " + str(first)[:160] + "; values form: " + str(second)[:160])


def annotate_error(path, message):
    """A GitHub Actions error annotation (workflow command) naming the file; '%' and line breaks are escaped as the runner requires.

    Written to stderr, not stdout: remediation_consumer.migrations_sweep calls apply_file with emit=log (stderr) because the consumer's
    stdout is one JSON document that the workflow tees into /tmp/remediation-consumer.json and parses. The runner processes workflow
    commands from stderr as well, so the annotation stays visible."""
    msg = str(message).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print("::error file=" + str(path).replace("%", "%25").replace(",", "%2C").replace(":", "%3A") + "::" + msg, file=sys.stderr)


def record_failure(path, sha, commit, info, acct, token, db_id, err, emit, done_n=0):
    title = "MIGRATION-APPLY-FAILED-1: " + os.path.basename(path)
    desc = ("Charter pillar: autonomy (MIGRATION-RUNNER-1). " + path + " (sha256 " + sha[:12] + ", commit " + (commit or "?")[:12] + ") failed after " + str(done_n)
            + " statement(s): " + err[:600] + ". Statements before the failure were applied; migrations are idempotent by convention, so fix the file and merge again (a new sha256 runs again).")
    lost = []
    # The ledger row and the issue are written independently: a refused ledger insert must not keep the issue from being filed.
    try:
        d1(acct, token, db_id, "INSERT INTO migration_runs (file, sha256, commit_sha, db, status, statements, error, applied_by) VALUES (?1, ?2, ?3, ?4, 'error', ?5, ?6, 'ci:apply-migrations')",
           [path, sha, commit or "", info.get("db") or "", str(done_n), err[:1000]])
    except Exception as e2:  # noqa: BLE001
        lost.append("migration_runs row not written: " + str(e2)[:200])
    try:
        file_failure_issue(acct, token, db_id, title, desc)
    except Exception as e3:  # noqa: BLE001
        lost.append("issue not filed: " + str(e3)[:300])
    if lost:
        emit(json.dumps({"file": path, "ledger_error": "; ".join(lost)[:500]}))
        # A failure the ledger or the queue could not record must still be named outside the red status.
        annotate_error(path, "MIGRATION-APPLY-FAILED-1 could not be recorded (" + "; ".join(lost)[:400] + ") after: " + err[:300])
    emit(json.dumps({"file": path, "ok": False, "error": err[:400], "applied_before_failure": done_n}))
    return 1


def main(argv=None):
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--apply", action="store_true")
    ap.add_argument("--commit", default=os.environ.get("GITHUB_SHA", ""))
    ap.add_argument("--base", default="", help="with --check: the base ref; an edited, already-merged file is checked for MIGRATION-NO-CLOBBER-1")
    ap.add_argument("--history", action="store_true", help="with --check: files already on main; skips the checks that only guard a new or changed file (CONTROL-PROBE-AT-BIRTH-1)")
    ap.add_argument("files", nargs="*")
    a = ap.parse_args(argv)
    files = [f for f in a.files if f.endswith(".sql") and os.path.exists(f)]
    rc = 0
    if a.check:
        for f in files:
            text = open(f, encoding="utf-8").read()
            ok, problems, info = plan(f, text, birth=not a.history)
            if ok and a.base:
                bt = base_text_of(f, a.base)
                problems = list(problems) + clobber_problems(text, bt, history_texts_of(f, a.base) if bt is not None and bt != text else ())
            if not ok:
                verdict, note = headerless_verdict(f, text)
                if verdict == "refused":
                    rc = 1
                    print(json.dumps({"file": f, "refused": [note]}))
                else:
                    res = {"file": f, "skipped": info.get("skip")}
                    if verdict in ("declared", "grandfathered"):
                        res[verdict] = note
                    print(json.dumps(res))
            elif problems:
                rc = 1
                print(json.dumps({"file": f, "refused": problems}))
            else:
                print(json.dumps({"file": f, "ok": True, **info}))
        names, expires = load_allowlist()
        if names and expires and expires < datetime.date.today().isoformat():
            # A reminder, not a failure: the list is a grandfather clause with an expiry (control_registry
            # migration-headerless-allowlist), and a lapsed one must not turn unrelated PRs red.
            print("migrations/headerless-allowlist.txt expired " + expires + " with " + str(len(names)) + " file(s) still listed: "
                  "give each a header or APPLY-BY: manual (<reason>) and remove it from the list", file=sys.stderr)
        return rc
    acct, token = os.environ.get("CLOUDFLARE_ACCOUNT_ID", ""), os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not acct or not token:
        print(json.dumps({"error": "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for --apply"}))
        return 2
    for f in sorted(files):
        rc |= apply_file(f, open(f, encoding="utf-8").read(), acct, token, a.commit)
    return rc


if __name__ == "__main__":
    sys.exit(main())
