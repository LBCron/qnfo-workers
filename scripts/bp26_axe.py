#!/usr/bin/env python3
"""BP26-AXE-1 collector (2026-11-04, charter pillar security + reach; breach trigger 14494 a11y_violations_serious; agent_issues 1000345 WCAG 2.2).

a11y_violations_serious: serious and critical axe-core rule violations (WCAG 2.0, 2.1 and 2.2, levels A and AA) on the home page of every public HTML host of
bp26_web.py HTML_HOSTS, the papers index and one paper page, counted once per (page, rule). The input is the JSON report of scripts/bp26_axe.mjs, which runs axe-core in
headless Chromium; the remediation-consumer job has no browser, so the ux-journeys workflow (which installs Playwright and axe-core for its phone journeys) runs
the script and then this collector with BP26_AXE_JSON pointing at the report:

    node scripts/bp26_axe.mjs --out /tmp/bp26-axe.json
    BP26_AXE_JSON=/tmp/bp26-axe.json python3 scripts/bp26_producers.py --only axe_a11y

WHY IT EXISTS  scripts/bp26_web.py a11y_findings() is a static lower bound that cannot certify zero, so it writes the metric only when it finds something. It found 4 on
2026-10-28; the pages were fixed; the stored 4 stayed, a stale breach no page has. A real axe-core run on 15 pages of 2026-11-04 (Edge, desktop 1280x800) found 0 serious or
critical violations on 14 of 15; this collector makes that reading the metric. If the static pass ever finds something axe does not, bp26_web.py writes its count and the next
axe run replaces it; the two never disagree for long because axe reports a superset of the static rules.

No report in this run (the consumer job, a failed browser) returns no result: unknown writes nothing. A report older than 6 hours, or one that measured fewer than 80 percent of
its pages (and fewer than 8), is also unknown. A page that did not load is listed as unmeasured and never counted as clean.

Offline suite: python3 scripts/bp26_axe.py --selftest
"""
import datetime
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bp26_producers import Collector, Result  # noqa: E402

MAX_AGE_S = 6 * 3600
SEVERE = ("serious", "critical")


def parse_at(s):
    try:
        return datetime.datetime.strptime(str(s)[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc).timestamp()
    except ValueError:
        return None


def judge(report, now):
    """(value or None, note, rows) for one axe report dict."""
    pages = report.get("pages") if isinstance(report, dict) else None
    if not pages:
        return None, "the axe report holds no pages", []
    at = parse_at(report.get("at"))
    if at is None or now - at > MAX_AGE_S:
        return None, "the axe report is older than %d hours or undated" % (MAX_AGE_S // 3600), []
    measured = [p for p in pages if p.get("ok")]
    if len(measured) < min(len(pages), max(8, int(0.8 * len(pages)))):
        return None, "only %d of %d pages were measured: no verdict" % (len(measured), len(pages)), [(p.get("url"), None, "not measured: %s" % (p.get("error") or "no result")) for p in pages if not p.get("ok")][:20]
    rows, total = [], 0
    for p in pages:
        if not p.get("ok"):
            rows.append((p.get("url"), None, "not measured: %s" % (p.get("error") or "no result")))
            continue
        sev = [v for v in (p.get("violations") or []) if v.get("impact") in SEVERE]
        total += len(sev)
        rows.append((p.get("url"), 0 if sev else 1, ("; ".join("%s (%s, %d node(s)): %s" % (v.get("id"), v.get("impact"), int(v.get("nodes") or 0), str(v.get("help") or "")[:70]) for v in sev)) or "no serious or critical violation"))
    note = ("axe-core %s, tags %s: %d serious or critical rule violation(s) on %d of %d pages measured (one per page and rule); %d page(s) not measured and not counted as clean"
            % (report.get("axe") or "?", "/".join(report.get("tags") or []), total, len(measured), len(pages), len(pages) - len(measured)))
    return total, note, rows


def collect_axe(ctx):
    path = os.environ.get("BP26_AXE_JSON", "")
    if not path or not os.path.isfile(path):
        return []  # not an unknown reading: this collector only has input when the browser workflow ran it
    try:
        with open(path, encoding="utf-8") as f:
            report = json.load(f)
    except (OSError, ValueError) as e:
        return [Result("a11y_violations_serious", None, "the axe report is unreadable: " + str(e)[:100], [])]
    value, note, rows = judge(report, ctx.now)
    return [Result("a11y_violations_serious", value, note, rows)]


COLLECTORS = [Collector("axe_a11y", collect_axe, ["a11y_violations_serious"], 50)]


def selftest():
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
            print("FAIL " + m)
    now = 1_800_000_000.0
    at = datetime.datetime.fromtimestamp(now - 600, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    pages = [{"url": "https://h%d.example/" % i, "ok": True, "violations": []} for i in range(10)]
    v, note, rows = judge({"at": at, "axe": "4.10.2", "tags": ["wcag2a"], "pages": pages}, now)
    ok(v == 0 and len(rows) == 10 and all(r[1] == 1 for r in rows), "ten clean pages read 0: %r %s" % (v, note))
    pages[3]["violations"] = [{"id": "color-contrast", "impact": "serious", "nodes": 3, "help": "Elements must meet minimum color contrast"}, {"id": "region", "impact": "moderate", "nodes": 9, "help": "x"}]
    pages[4]["violations"] = [{"id": "label", "impact": "critical", "nodes": 1, "help": "Form elements must have labels"}, {"id": "link-name", "impact": "serious", "nodes": 2, "help": "Links must have discernible text"}]
    v, note, rows = judge({"at": at, "pages": pages}, now)
    ok(v == 3, "serious and critical rule violations are counted once per page and rule, moderate ones are not: %r" % v)
    ok(rows[3][1] == 0 and "color-contrast" in rows[3][2] and "region" not in rows[3][2], "the evidence row names the rule")
    pages[5]["ok"], pages[5]["error"] = False, "timeout"
    v, note, rows = judge({"at": at, "pages": pages}, now)
    ok(v == 3 and rows[5][1] is None and "not measured" in rows[5][2], "a page that did not load is unmeasured, not clean: %r" % (rows[5],))
    for i in range(4):
        pages[i]["ok"] = False
    v, note, rows = judge({"at": at, "pages": pages}, now)
    ok(v is None, "fewer than 80 percent measured: no verdict (%s)" % note)
    old = datetime.datetime.fromtimestamp(now - 7 * 3600, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    v, note, rows = judge({"at": old, "pages": [{"url": "u", "ok": True, "violations": []}] * 10}, now)
    ok(v is None, "a report older than six hours is unknown")
    ok(judge({}, now)[0] is None and judge({"at": at, "pages": []}, now)[0] is None, "an empty report is unknown")

    class C:
        pass
    c = C()
    c.now = now
    os.environ.pop("BP26_AXE_JSON", None)
    ok(collect_axe(c) == [], "no report in this run returns no result at all")
    fd, p = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"at": at, "axe": "4.10.2", "tags": ["wcag2a", "wcag2aa"], "pages": [{"url": "https://a.example/", "ok": True, "violations": []}] * 12}, f)
    os.environ["BP26_AXE_JSON"] = p
    r = collect_axe(c)
    ok(len(r) == 1 and r[0].metric == "a11y_violations_serious" and r[0].value == 0, "a clean report writes 0 through the framework Result: %r" % (r and r[0].value))
    with open(p, "w", encoding="utf-8") as f:
        f.write("{not json")
    r = collect_axe(c)
    ok(len(r) == 1 and r[0].value is None, "an unreadable report is unknown")
    os.remove(p)
    del os.environ["BP26_AXE_JSON"]
    print("bp26_axe selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    print("%d failed" % len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print(__doc__)
