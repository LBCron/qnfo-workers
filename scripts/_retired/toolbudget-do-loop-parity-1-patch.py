#!/usr/bin/env python3
"""TOOLBUDGET-DO-LOOP-PARITY-1 (2026-09-30).

DEFECT: qnfo-ops runs THREE server-side tool loops. TOOL-BUDGET-PENDING-1 fixed the
chat loop (L4713) and the workflow job loop (L5666) so a budget-spent turn still
records its unexecuted calls and still returns an answer. The Durable-Object /
WebSocket session loop (L5481) was missed: its `while (iter < maxIters)` exits with
finalText="" and falls through to the literal
  "(tool loop did not converge within N iterations)"
so a budget-spent session returns NO answer at all and writes NO bail record -
exactly the silent-failure class the other two paths were fixed for.

FIX: give the DO loop the chat path's final no-tools round (BUDGET_EXHAUSTED_DIRECTIVE,
mirroring worker.js L4731-4736) and record the bail via logToolBudgetBail so the event
lands in qnfo-audit cloud_ops_events (kind=ops_tool_budget_bail) instead of only being
visible as prose.

FAIL-CLOSED: aborts (exit 3) if an anchor is missing or non-unique, if the two bundles
diverge, or if the result fails `node --check`. Idempotent: exit 0 if already applied.
"""
import re
import subprocess
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKER = ROOT / "qnfo-ops" / "worker.js"
MIRROR = ROOT / "qnfo-ops" / "deployed-current.worker.js"
GUARD = ROOT / "qnfo-ops" / "scripts" / "guard-timebudget.sh"

MARK = "TOOLBUDGET-DO-LOOP-PARITY-1"
NEW_VERSION = "2.38.14-do-loop-budget-parity"

OLD = '      if (!finalText) finalText = "(tool loop did not converge within " + maxIters + " iterations)";'

NEW = '''      // TOOLBUDGET-DO-LOOP-PARITY-1 (2026-09-30): this DO/WS session loop had no final
      // no-tools round, so a session whose round cap was spent returned
      // "(tool loop did not converge within N iterations)" and NO answer at all -
      // the same silent-failure class TOOL-BUDGET-PENDING-1 fixed on the chat path
      // (worker.js L4731). Give it the identical final round and record the bail.
      if (!finalText) {
        try {
          const _fin = await callDeepSeek(this.env, messages.concat([{ role: "system", content: BUDGET_EXHAUSTED_DIRECTIVE }]), DEFAULT_MAX_OUT, null, {});
          const _fc = _fin && _fin.resp && _fin.resp.choices && _fin.resp.choices[0];
          const _fm = _fc && _fc.message || {};
          finalText = stripToolFrames(String(_fm.content || "").trim());
        } catch (e) { finalText = ""; }
        try { await logToolBudgetBail(this.env, "do-session", 0, "", maxIters, false); } catch (e) { }
        if (!finalText) finalText = "(tool loop did not converge within " + maxIters + " iterations)";
      }'''

GUARD_ANCHOR = "  if ! grep -q 'ops_tool_budget_bail' \"$DIR/$f\"; then\n    echo \"FAIL: ops_tool_budget_bail event missing from $f (budget-bail observability)\"; FAIL=1\n  fi"
GUARD_ADD = GUARD_ANCHOR + "\n  if ! grep -q 'TOOLBUDGET-DO-LOOP-PARITY-1' \"$DIR/$f\"; then\n    echo \"FAIL: DO/WS tool loop lacks the final no-tools round in $f (TOOLBUDGET-DO-LOOP-PARITY-1)\"; FAIL=1\n  fi"


def die(msg):
    print("ABORT (fail-closed): " + msg)
    sys.exit(3)


def read(p):
    if not p.exists():
        die("missing file: " + str(p))
    return p.read_text(encoding="utf-8")


def check_js(p):
    r = subprocess.run(["node", "--check", str(p)], capture_output=True, text=True)
    if r.returncode != 0:
        die("node --check failed for %s: %s" % (p.name, (r.stderr or r.stdout).strip()[:400]))


w = read(WORKER)
m = read(MIRROR)
if w != m:
    die("worker.js and deployed-current.worker.js already diverge (%d vs %d bytes); refusing to patch" % (len(w), len(m)))

if MARK in w:
    print("ALREADY APPLIED (idempotent no-op): %s present in both bundles" % MARK)
    sys.exit(0)

n = w.count(OLD)
if n != 1:
    die("anchor for the DO-loop fallthrough occurs %d times (need exactly 1)" % n)

g = read(GUARD)
if GUARD_ANCHOR not in g:
    die("guard anchor missing from guard-timebudget.sh")
if g.count(GUARD_ANCHOR) != 1:
    die("guard anchor is non-unique")

new_w = w.replace(OLD, NEW)
if new_w.count(MARK) != 1:
    die("post-patch marker count != 1")
if "opsToolBudgetBail" not in new_w or "logToolBudgetBail" not in new_w:
    die("bail recorder vanished from the bundle")

mv = re.search(r'^var VERSION = "([^"]+)";$', new_w, re.M)
if not mv:
    die("var VERSION line not found")
new_w = new_w.replace('var VERSION = "%s";' % mv.group(1), 'var VERSION = "%s";' % NEW_VERSION, 1)

new_g = g.replace(GUARD_ANCHOR, GUARD_ADD, 1)

WORKER.write_text(new_w, encoding="utf-8")
MIRROR.write_text(new_w, encoding="utf-8")
GUARD.write_text(new_g, encoding="utf-8")
check_js(WORKER)
check_js(MIRROR)

if WORKER.read_bytes() != MIRROR.read_bytes():
    die("post-write parity break")

print("APPLIED: worker.js + deployed-current.worker.js %d -> %d bytes; VERSION %s -> %s; guard extended"
      % (len(w), len(new_w), mv.group(1), NEW_VERSION))
