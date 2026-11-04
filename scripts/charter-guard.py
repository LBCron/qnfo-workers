#!/usr/bin/env python3
"""charter-guard.py - QUNIVERSE-CHARTER-1 (2026-10-01).

WHY THIS EXISTS
  docs/QUNIVERSE-CHARTER.md is the system's charter: what the Quniverse is, what it should be,
  its objectives, SWOT, MVP, blue-sky footprint, roadmap and decision rules. Half of it is
  generated daily by qnfo-fleet-control (CHARTER-LOOP-1) and committed to main between two
  markers. A charter that nothing checks decays into prose: the markers get deleted by a
  hand edit, the pillar names in the document drift from the ones the worker grades, and new
  workers appear with no stated reason to exist (FLEET-NODE-MAP: 30 -> 38 -> 45 workers
  because "each new feature ships as a NEW worker; no registration barrier existed").

WHAT IT CHECKS (fail closed; exit 1 on any violation)
  C1 CHARTER-DOC-SHAPE-1    the charter exists, carries exactly one CHARTER-LIVE:BEGIN and one
                            CHARTER-LIVE:END marker in that order, and keeps every required
                            hand-written section heading.
  C2 CHARTER-PILLAR-PARITY-1 the pillar keys in the charter's pillar table equal the keys in
                            CHARTER_PILLARS inside qnfo-fleet-control/worker.js. Doc and code
                            must grade the same seven things.
  C3 CHARTER-NEW-WORKER-1   (only with a diff range) every worker directory ADDED in the range
                            declares `# charter-pillar: <key>` in its wrangler.toml, with a key
                            from C2, unless it carries a RETIRED or FOLDED marker. A worker that
                            cannot name the pillar it serves is parked, not built.
  C5 CHARTER-VERSION-PARITY-1 the "Charter X.Y.Z," header line equals CHARTER_VERSION in the worker.
  C4 PORTFOLIO-DOC-SHAPE-1 docs/PORTFOLIO.md exists and carries exactly one PORTFOLIO-LIVE:BEGIN and one
                            PORTFOLIO-LIVE:END marker in that order (PORTFOLIO-LOOP-1 splices between them).
  C6 CHARTER-PILLAR-EVERY-TOML-1 (TP-3.9, issue 6796) every live worker directory (a wrangler.toml and no RETIRED or FOLDED marker)
                            declares `# charter-pillar: <key>` with a key from C2, not only a directory added in the range.
                            The 27 that lacked it landed their declarations in the same change.

USAGE
  python3 scripts/charter-guard.py                     # C1 + C2 + A1
  python3 scripts/charter-guard.py <base_ref> <head_ref>  # plus C3 on the added directories

EXIT
  0 pass   1 violation   3 cannot evaluate a given ref (fail closed; never green by accident)
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

ROOT = os.environ.get("CHARTER_ROOT", ".")
DOC = os.path.join(ROOT, "docs", "QUNIVERSE-CHARTER.md")
WORKER = os.path.join(ROOT, "qnfo-fleet-control", "worker.js")
BEGIN = "<!-- CHARTER-LIVE:BEGIN -->"
END = "<!-- CHARTER-LIVE:END -->"
REQUIRED_HEADINGS = [
    "what the quniverse is",
    "what it should be",
    "objectives and value",
    "swot",
    "mvp",
    "blue-sky",
    "roadmap",
    "decision rules",
    "how this charter maintains itself",
]
NOT_WORKER_DIRS = {"_shared", "audits", "ci-status", "docs", "funding", "machine-readability", "migrations", "papers", "scripts", ".github"}


def fail(msg: str) -> None:
    print(f"CHARTER-GUARD FAIL: {msg}")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def check_doc_shape(doc: str) -> list[str]:
    errs = []
    if doc.count(BEGIN) != 1:
        errs.append(f"C1 expected exactly one {BEGIN} marker, found {doc.count(BEGIN)}")
    if doc.count(END) != 1:
        errs.append(f"C1 expected exactly one {END} marker, found {doc.count(END)}")
    if doc.count(BEGIN) == 1 and doc.count(END) == 1 and doc.index(BEGIN) > doc.index(END):
        errs.append("C1 CHARTER-LIVE:END precedes CHARTER-LIVE:BEGIN")
    headings = [h.strip().lower() for h in re.findall(r"^##\s+(.+)$", doc, flags=re.M)]
    for needle in REQUIRED_HEADINGS:
        if not any(needle in h for h in headings):
            errs.append(f"C1 missing a '## ...' heading containing '{needle}'")
    return errs


def worker_pillars(src: str) -> list[str]:
    a = src.find("var CHARTER_PILLARS = [")
    b = src.find("];", a)
    if a < 0 or b < 0:
        return []
    return re.findall(r'\{\s*key:\s*"([a-z-]+)"', src[a:b])


def doc_pillars(doc: str) -> list[str]:
    # The hand-written pillar table: rows of the form `| key | ... |` under the Objectives section.
    a = doc.find("<!-- CHARTER-PILLARS:BEGIN -->")
    b = doc.find("<!-- CHARTER-PILLARS:END -->")
    if a < 0 or b < 0 or b < a:
        return []
    return re.findall(r"^\|\s*`([a-z-]+)`\s*\|", doc[a:b], flags=re.M)


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL)


def rev_ok(ref: str) -> bool:
    try:
        subprocess.check_call(["git", "cat-file", "-e", f"{ref}^{{commit}}"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception:
        return False


def added_worker_dirs(base: str, head: str) -> list[str]:
    out = git("diff", "--name-only", "--diff-filter=A", base, head)
    dirs = set()
    for line in out.splitlines():
        parts = line.strip().split("/")
        if len(parts) == 2 and parts[1] in ("wrangler.toml", "worker.js") and parts[0] not in NOT_WORKER_DIRS:
            dirs.add(parts[0])
    return sorted(d for d in dirs if os.path.isfile(os.path.join(ROOT, d, "wrangler.toml")))


def pillar_line(toml_path: str) -> str | None:
    try:
        text = read(toml_path)
    except OSError:
        return None
    m = re.search(r"^\s*#\s*charter-pillar:\s*([a-z-]+)\b", text, flags=re.M)
    return m.group(1) if m else None


def deployable_dirs() -> list[str]:
    out = []
    for d in sorted(os.listdir(ROOT)):
        p = os.path.join(ROOT, d)
        if d in NOT_WORKER_DIRS or d.startswith(".") or not os.path.isdir(p):
            continue
        if not os.path.isfile(os.path.join(p, "wrangler.toml")):
            continue
        if os.path.isfile(os.path.join(p, "RETIRED")) or os.path.isfile(os.path.join(p, "FOLDED")):
            continue
        out.append(d)
    return out


def main(argv: list[str]) -> int:
    errs: list[str] = []
    if not os.path.isfile(DOC):
        fail(f"C1 {DOC} is missing")
        return 1
    doc = read(DOC)
    errs += check_doc_shape(doc)
    src = read(WORKER) if os.path.isfile(WORKER) else ""
    wp = worker_pillars(src)
    dp = doc_pillars(doc)
    if not wp:
        errs.append("C2 CHARTER_PILLARS not found in qnfo-fleet-control/worker.js")
    if not dp:
        errs.append("C2 no pillar table between CHARTER-PILLARS markers in the charter")
    if wp and dp and wp != dp:
        errs.append(f"C2 pillar keys differ: worker.js {wp} vs charter {dp}")
    # C5 CHARTER-VERSION-PARITY-1: the version line in the document equals CHARTER_VERSION in the kernel, so the
    # snapshots, the live block and the Cloudflare mirror never report a version the document does not carry (#1727).
    dv = re.search(r"^Charter (\d+\.\d+\.\d+),", doc, flags=re.M)
    wv = re.search(r'var CHARTER_VERSION = "(\d+\.\d+\.\d+)";', src)
    if not dv or not wv:
        errs.append("C5 cannot read the charter version from the document header or CHARTER_VERSION in worker.js")
    elif dv.group(1) != wv.group(1):
        errs.append(f"C5 charter version differs: document {dv.group(1)} vs worker.js CHARTER_VERSION {wv.group(1)}")
    keys = set(wp) | set(dp)

    if len(argv) >= 3:
        base, head = argv[1], argv[2]
        if not rev_ok(base) or not rev_ok(head):
            fail(f"C3 cannot resolve refs {base}..{head}; refusing to report green")
            return 3
        for d in added_worker_dirs(base, head):
            if os.path.isfile(os.path.join(ROOT, d, "RETIRED")) or os.path.isfile(os.path.join(ROOT, d, "FOLDED")):
                continue
            key = pillar_line(os.path.join(ROOT, d, "wrangler.toml"))
            if key is None:
                errs.append(f"C3 new worker directory {d}/ declares no '# charter-pillar: <key>' in wrangler.toml (keys: {sorted(keys)})")
            elif key not in keys:
                errs.append(f"C3 new worker directory {d}/ names unknown pillar '{key}' (keys: {sorted(keys)})")

    pdoc = os.path.join(ROOT, "docs", "PORTFOLIO.md")
    if not os.path.isfile(pdoc):
        errs.append("C4 docs/PORTFOLIO.md is missing")
    else:
        ptxt = read(pdoc)
        pb, pe = "<!-- PORTFOLIO-LIVE:BEGIN -->", "<!-- PORTFOLIO-LIVE:END -->"
        if ptxt.count(pb) != 1 or ptxt.count(pe) != 1:
            errs.append(f"C4 docs/PORTFOLIO.md needs exactly one {pb} and one {pe} marker (found {ptxt.count(pb)}/{ptxt.count(pe)})")
        elif ptxt.index(pb) > ptxt.index(pe):
            errs.append("C4 PORTFOLIO-LIVE:END precedes PORTFOLIO-LIVE:BEGIN")

    missing = [d for d in deployable_dirs() if pillar_line(os.path.join(ROOT, d, "wrangler.toml")) is None]
    print(f"charter-guard: pillars={wp} deployable_dirs={len(deployable_dirs())} missing_pillar_line={len(missing)}")
    for d in missing:
        errs.append(f"C6 live worker directory {d}/ declares no '# charter-pillar: <key>' in wrangler.toml (keys: {sorted(keys)})")
    for d in deployable_dirs():
        key = pillar_line(os.path.join(ROOT, d, "wrangler.toml"))
        if key is not None and key not in keys:
            errs.append(f"C6 live worker directory {d}/ names unknown pillar '{key}' (keys: {sorted(keys)})")
    if errs:
        for e in errs:
            fail(e)
        return 1
    print("CHARTER-GUARD PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
