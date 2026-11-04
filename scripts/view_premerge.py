#!/usr/bin/env python3
"""IFNE: it also fails a changed migration whose CREATE TABLE IF NOT EXISTS names a table that already exists with other columns (the statement then silently does nothing).
VIEW-PREMERGE-1 (2026-11-04, pillar autonomy; sibling of scripts/view_health.py, the after-merge detector).
PR 7023 merged a view that errors on read (missing column) and nothing caught it before main. This check copies the live
qnfo-audit schema (tables and views, no rows, read-only through the Cloudflare API) into an in-memory SQLite database, applies
the pull request's changed migrations to it, and plans every view with EXPLAIN. It FAILS when a view that compiled before the
migrations no longer does, or a view the migrations create does not compile. A view already broken on main is not this PR's.
No secret in the environment (a fork), or an unreadable schema, passes with a notice: the after-merge detector still covers it.
Usage: view_premerge.py <migration files...>; exit 1 on a newly broken view."""
import os
import re
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def load_schema(rows):
    """rows: dicts type, name, sql from sqlite_master. Tables first, then views; indexes and triggers are not needed to plan a view."""
    con = sqlite3.connect(":memory:", cached_statements=0)
    for want in ("table", "view"):
        for r in rows:
            name = r.get("name") or ""
            if r.get("type") != want or not r.get("sql") or name.startswith(("sqlite_", "_cf_")):
                continue
            try:
                con.execute(r["sql"])
            except sqlite3.Error:
                pass  # virtual (FTS) tables and their shadow tables need modules this build may lack
    return con


def broken(con):
    bad = {}
    for (name,) in con.execute("SELECT name FROM sqlite_master WHERE type = 'view'").fetchall():
        try:
            con.execute('EXPLAIN SELECT * FROM "%s"' % name.replace('"', '""')).fetchall()
        except sqlite3.Error as e:
            bad[name] = str(e)[:160]
    return bad


IFNE = re.compile(r'(?is)^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+("?)(\w+)\1\s*\(')


def columns(con, table):
    return [(r[1].lower(), (r[2] or "").upper()) for r in con.execute('PRAGMA table_info("%s")' % table).fetchall()]


def ifne_conflicts(con, stmt):
    """CREATE TABLE IF NOT EXISTS silently does nothing when a table of that name already exists with another shape: the migration
    then writes to columns that are not there. Returns a message when the statement's columns differ from the live table's."""
    m = IFNE.match(stmt)
    if not m:
        return None
    name = m.group(2)
    if not con.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone():
        return None
    scratch = sqlite3.connect(":memory:", cached_statements=0)
    try:
        scratch.execute(re.sub(r"(?is)IF\s+NOT\s+EXISTS\s+", "", stmt, count=1))
    except sqlite3.Error:
        return None  # the statement itself is not valid on its own (a reference to another object); the runner reports that
    have, want = {c[0] for c in columns(con, name)}, {c[0] for c in columns(scratch, name)}
    if not (want - have):  # extra live columns come from later ALTERs and are normal; only a column the statement defines but the table lacks breaks the migration
        return None
    return "table %s already exists with other columns (missing %s; extra %s), so CREATE TABLE IF NOT EXISTS does nothing" % (
        name, sorted(want - have) or "none", sorted(have - want) or "none")


def check(rows, texts, split, conflicts=None):
    con = load_schema(rows)
    before = broken(con)
    for name in before:  # a broken view makes SQLite refuse later schema statements; the PR's migrations may recreate it, and then it is checked
        con.execute('DROP VIEW IF EXISTS "%s"' % name.replace('"', '""'))
    for text in texts:
        for stmt in split(text):
            if stmt.startswith("__INCOMPLETE__"):
                continue
            c = ifne_conflicts(con, stmt)
            if c and conflicts is not None:
                conflicts.append(c)
            try:
                con.execute(stmt)
            except sqlite3.Error:
                pass  # data statements against an empty copy may fail; only the schema matters here
    after = broken(con)
    return {k: v for k, v in after.items() if k not in before}, before


def main(argv):
    import apply_migrations as A
    acct, token = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    if not (acct and token):
        print("VIEW-PREMERGE-1: no Cloudflare credentials in this run; skipped (view_health.py still checks after merge)")
        return 0
    try:
        rows = A.d1(acct, token, A.DATABASES["qnfo-audit"], "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table', 'view')")
    except Exception as e:  # noqa: BLE001
        print("VIEW-PREMERGE-1: schema unreadable (%s); skipped" % str(e)[:160])
        return 0
    texts = []
    for p in argv:
        with open(p, encoding="utf-8") as fh:
            t = fh.read()
        if "-- DB: qnfo-audit" in t:
            texts.append(t)
    conflicts = []
    new, before = check(rows, texts, A.statements, conflicts)
    for c in conflicts:
        print("::error::" + c)
    print("VIEW-PREMERGE-1: %d views already broken on main (not this PR's), %d newly broken" % (len(before), len(new)))
    for k, v in new.items():
        print("::error::view %s no longer compiles after this PR's migrations: %s" % (k, v))
    return 1 if (new or conflicts) else 0


def selftest():
    import apply_migrations as A
    rows = [{"type": "table", "name": "t", "sql": "CREATE TABLE t (a, b)"},
            {"type": "view", "name": "v_ok", "sql": "CREATE VIEW v_ok AS SELECT a FROM t"},
            {"type": "view", "name": "v_old_bad", "sql": "CREATE VIEW v_old_bad AS SELECT nope FROM t"}]
    new, before = check(rows, ["CREATE VIEW v_good AS SELECT b FROM t;"], A.statements)
    assert not new and "v_old_bad" in before, (new, before)
    new, _ = check(rows, ["CREATE VIEW v_new_bad AS SELECT created_at FROM t;"], A.statements)
    assert list(new) == ["v_new_bad"], new
    new, _ = check(rows, ["DROP VIEW v_ok;\nCREATE VIEW v_ok AS SELECT zzz FROM t;"], A.statements)
    assert list(new) == ["v_ok"], new
    conflicts = []
    check(rows + [{"type": "table", "name": "bak", "sql": "CREATE TABLE bak (x, y)"}], ["CREATE TABLE IF NOT EXISTS bak (x, y, z);\nCREATE TABLE IF NOT EXISTS t (a, b);\nCREATE TABLE IF NOT EXISTS fresh (q);"], A.statements, conflicts)
    assert len(conflicts) == 1 and "bak" in conflicts[0] and "z" in conflicts[0], conflicts
    print("view_premerge selftest ok")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        selftest()
    else:
        sys.exit(main(sys.argv[1:]))
