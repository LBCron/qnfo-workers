#!/usr/bin/env python3
"""APPLY-PENDING-1 -- land every patch script whose anchors still match.

WHY THIS EXISTS
---------------
Two defects were measured on 2026-09-29 by scripts/applier-doctor.py over the
31 scripts/*patch*.py in this repo:

  * #1395 CI-APPLIER-NEVER-APPLIES-1 -- patch scripts sat in scripts/ for days
    with a matching applier workflow yet were never applied to main. The doctor
    classifies these as `applied-now` (the patch applies cleanly to the current
    tree, therefore it was never landed).
  * #1381 FAILURE-ARTIFACT-LOSS-1 -- appliers that only commit on success leave
    no trace when they fail, so a silently-dead applier is indistinguishable
    from one that never ran.
  * PARTIAL-APPLY-1 (new, measured 2026-09-29) -- a fail-closed patcher that
    edits several files and then aborts on a later anchor leaves the tree
    half-patched. driftguard-label-and-lifecycle-sot-patch.py rewrote
    scripts/deploy-drift-guard.py and reported raw_put.py already-applied, then
    FAIL-CLOSED on qnfo-lifecycle/worker.js -- two files mutated, one not.
  * REVERT-COLLATERAL-1 (new, measured 2026-09-29) -- the envelope's own revert
    ran `git checkout -- .`, which reverts EVERY tracked file in the worktree.
    A single late fail-closed patcher therefore silently discarded every patch
    that had already landed earlier in the SAME run, while this script still
    recorded those earlier scripts as `landed`. That is the exact mechanism by
    which CI-APPLIER-NEVER-APPLIES-1 keeps recurring after being "fixed": the
    doctor sees a matching applier, the run reports success, and the work is
    gone. Revert is now path-scoped (see revert_paths).

WHAT THIS DOES
--------------
Runs every scripts/*patch*.py inside a transactional envelope:

  snapshot  -> git status --porcelain + per-path content hash
  run       -> subprocess with REPO_ROOT + a hard per-script timeout
  rc != 0   -> revert ONLY the paths this script changed
  rc == 0 and tree unchanged -> already-applied
  rc == 0 and tree changed   -> landed

It never commits and never deploys; the calling workflow does that, so this
script stays safe to run anywhere. It always writes
ci-status/applier-doctor.json, so a run that lands nothing is still visible
through the GitHub contents API without the Actions API.

Exit codes
  0  ran to completion (however many scripts landed)
  3  no repo root, or no patch scripts found (nothing was classified)
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

MARKER = "APPLY-PENDING-1"  # APPLIER-ARTIFACT-COLLISION-1


def repo_root() -> Path:
    for cand in (os.environ.get("REPO_ROOT"), os.environ.get("GITHUB_WORKSPACE"), "."):
        if not cand:
            continue
        p = Path(cand).resolve()
        if (p / "scripts").is_dir():
            return p
    return Path(".").resolve()


def git(root: Path, *args: str) -> str:
    try:
        r = subprocess.run(
            ["git", *args], cwd=str(root), capture_output=True, text=True, timeout=60
        )
        return r.stdout or ""
    except Exception as exc:  # noqa: BLE001
        return f"<git error: {exc}>"


def snapshot(root: Path) -> str:
    return git(root, "status", "--porcelain")


def _porcelain_paths(root: Path) -> dict:
    """Map path -> porcelain status code for every dirty path."""
    out = {}
    for line in git(root, "status", "--porcelain").splitlines():
        if len(line) < 4:
            continue
        code = line[:2].strip()
        p = line[3:].strip()
        if " -> " in p:  # rename/copy
            p = p.split(" -> ")[-1].strip()
        p = p.strip('"')
        if p:
            out[p] = code
    return out


def dirty_hashes(root: Path) -> dict:
    """path -> "<status-code>:<sha1|gone|err>" for every dirty path.

    REVERT-COLLATERAL-1: a porcelain-string comparison cannot tell whether a
    path that was ALREADY dirty before the script ran was changed again by that
    script. Hashing the dirty paths makes "did THIS script touch this file"
    decidable in that case too.
    """
    out = {}
    for p, code in _porcelain_paths(root).items():
        try:
            fp = root / p
            digest = hashlib.sha1(fp.read_bytes()).hexdigest() if fp.is_file() else "gone"
        except Exception:  # noqa: BLE001
            digest = "err"
        out[p] = f"{code}:{digest}"
    return out


def revert_paths(root: Path, codes: dict) -> list:
    """Undo ONLY the paths the failing script changed.

    REVERT-COLLATERAL-1 (2026-09-29): this replaced `git checkout -- .`, which
    reverted every tracked file and silently discarded patches that had already
    landed earlier in the same run.
    """
    untracked = sorted(p for p, c in codes.items() if c.strip() == "??")
    tracked = sorted(p for p, c in codes.items() if c.strip() != "??")
    for i in range(0, len(tracked), 100):
        chunk = tracked[i : i + 100]
        git(root, "checkout", "--", *chunk)
    for p in untracked:
        try:
            (root / p).unlink()
        except Exception:  # noqa: BLE001
            pass
    return sorted(codes)


# VERSION-FLOOR-1 (2026-11-04, pillar autonomy): a one-shot patcher written weeks ago names its own VERSION as a literal. toolbudget-do-loop-parity-1-patch.py (2026-09-30) still
# matched its anchor on 2026-11-04 and would have landed through a pull request with qnfo-ops VERSION "2.62.20-tool-arg-alias" replaced by "2.38.14-do-loop-budget-parity"
# (and a second final round the file already had); the same class put stale whole-file copies on main on 2026-10-19 (see PR-GUARD-FIXES-1). A patch that lowers the numeric core
# of any worker bundle's VERSION is reverted and reported, never landed.
VERSION_DECL = re.compile(r'^[ \t]*(?:var|const|let)\s+VERSION\s*=\s*"([^"\n]*)"', re.M)


def version_core(text):
    """(major, minor, patch) of the first VERSION declaration at the start of a line, or None."""
    m = VERSION_DECL.search(text or "")
    nums = re.match(r"(\d+)\.(\d+)\.(\d+)", m.group(1)) if m else None
    return tuple(int(x) for x in nums.groups()) if nums else None


def version_downgrades(root: Path, paths) -> list:
    """[(path, committed core, new core)] for each worker bundle in `paths` whose VERSION core is lower than the committed one."""
    out = []
    for p in sorted(paths):
        if not (p.endswith("/worker.js") or p.endswith("/deployed-current.worker.js")):
            continue
        fp = root / p
        if not fp.is_file():
            continue
        new = version_core(fp.read_text(encoding="utf-8", errors="replace"))
        old = version_core(git(root, "show", "HEAD:" + p))
        if new and old and new < old:
            out.append((p, ".".join(map(str, old)), ".".join(map(str, new))))
    return out


def classify(text: str, rc: int) -> str:
    low = text.lower()
    if rc != 0:
        # APPLIER-CLASSIFY-UNMASKED-1 (issue #1466, 2026-09-29).
        # The old predicate was a BARE `"anchor" in low`, so a genuine crash
        # whose *filename* contains "anchor" was filed as `stale-anchor`. The
        # applier written to fix version-anchor rot was therefore reported AS
        # that rot (NameError: name 'Path' is not defined) and never ran.
        #
        # A real Python traceback now takes precedence over the heuristic, and
        # the heuristic requires the drift SIGNATURE, not the bare word.
        if "traceback (most recent call last)" in low:
            return "error"
        if "fail-closed" in low or "anchor occurrence != 1" in low:
            return "stale-anchor"
        # APPLIER-CLASSIFY-SIGNATURE-2 (issue #1673, 2026-10-01).
        # The v1 signature list above was too narrow: five appliers emitted an
        # explicit fail-closed ANCHOR message that matched no signature and were
        # therefore filed as `error`, so anchor drift masqueraded as a crash --
        # the mirror image of the #1466 defect this predicate replaced. The drift
        # signature must now co-occur with `anchor` or a VERSION literal, so a
        # genuine application failure cannot be absorbed by this branch.
        if ("anchor" in low or "version" in low) and re.search(
            r"(count != 1|matched 0 times|occurs 0 times|occurrences = 0|"
            r"expected exactly 1|anchor not found|pre-patch version|"
            r"anchor drift|anchor-invalid)",
            low,
        ):
            return "stale-anchor"
        # CLASSIFY-FAILCLOSED-DEFAULT-1 (issue #1466 residual, 2026-09-29).
        # The bare `"does not match" in low` predicate classified ANY message
        # carrying that phrase as benign anchor drift, so a genuine application
        # failure was still masked as `stale-anchor` - the #1466 class narrowed,
        # not removed. The drift SIGNATURE must now co-occur on one line:
        # `anchor` and `does not match` within 60 characters of each other.
        # `.` excludes newlines, so the window cannot span lines.
        if re.search(r"anchor.{0,60}does not match|does not match.{0,60}anchor", low):
            return "stale-anchor"
        return "error"
    if "already applied" in low and "patched" not in low:
        return "already-applied"
    return "ran"


# APPLIER-RETIRE-2 (issue #1673, 2026-10-01): the retire lifecycle.
#
# WHY RUNTIME-VERIFIED AND NOT A STATIC LIST
#   The first attempt at this list (scripts/applier-classify-signature-and-retire-patch.py,
#   2026-09-29) never landed: it pins the pre-2026-09-30 classify() text, so it
#   exits 3 on every run, and the list was lost with it. A static list is also
#   unsafe in principle -- the tree moves after the list is written, so a stale
#   entry can silently drop a fix that was never applied. Each entry therefore
#   carries `evidence = (file, token)` and the applier is skipped ONLY IF that
#   token is found in that file AT RUN TIME. If the evidence is gone, the applier
#   runs normally. Retirement is fail-closed; execution is fail-open. A generic
#   token (a table name, whitespace) is never accepted as evidence.
RETIRED_APPLIERS = [
    {
        "script": "applier-doctor-classify-patch.py",
        "evidence": ("scripts/applier-doctor.py", "APPLIER-DOCTOR-2"),
        "reason": (
            "superseded: the doctor's classify outcome landed as APPLIER-DOCTOR-2 "
            "(with APPLIER-DOCTOR-FALSE-POSITIVE-CLASS-1); the rewrite RENAMED the "
            "marker the applier pins (APPLIER-DOCTOR-CLASSIFY-2), which is why "
            "supersession was structurally undetectable"
        ),
    },
    {
        "script": "applier-doctor-outcome-aware-patch.py",
        "evidence": ("scripts/applier-doctor.py", "OUTCOME-AWARE-2"),
        "reason": (
            "superseded: the outcome-aware doctor landed as OUTCOME-AWARE-2; the "
            "applier pins APPLIER-DOCTOR-OUTCOME-AWARE-1, the pre-rename marker"
        ),
    },
    {
        "script": "fleet-autoaudit-v4-envelope-patch.py",
        "evidence": ("scripts/fleet-autoaudit.py", "REST-ENVELOPE-OK-1"),
        "reason": (
            "superseded: two of its three declared outcome markers "
            "(REST-ENVELOPE-OK-1, AUDIT-STALE-ROWS-1) are present in the target; "
            "it now aborts with 'anchor drift ... expected (1,1,1,1), got (1,0,0,0)'"
        ),
    },
    # APPLIER-RETIRE-3 (2026-10-01, issue 1673): each entry below was verified against the tree by
    # reading the applier's own MARK/TARGET and finding its outcome in that target file.
    {
        "script": "panel6-mediated-count-patch.py",
        "evidence": ("qnfo-fleet-dashboard/worker.js", "PANEL6-MEDIATED-COUNT-1"),
        "reason": "landed: the applier's own MARK is present in its TARGET; it fails only on a moved anchor",
    },
    {
        "script": "run-gate-internal-patch.py",
        "evidence": ("qnfo-backlog-exec/worker.js", "INTERNAL-SERVICE-BINDING-AUTH-1"),
        "reason": "landed: marker present in qnfo-backlog-exec; it pins pre-patch VERSION 1.6.4-run-gate",
    },
    {
        "script": "raw-put-schedules-patch.py",
        "evidence": ("scripts/raw_put.py", "SCHEDULES-API-SHAPE-1"),
        "reason": "superseded: raw_put.py applies schedules (schedules_get/put/apply) under SCHEDULES-API-SHAPE-1",
    },
    {
        "script": "patch-schedules-body-1498.py",
        "evidence": ("scripts/raw_put.py", "SCHEDULES-API-SHAPE-1"),
        "reason": "superseded: the 1498 PUT body shape fix landed in raw_put.py as SCHEDULES-API-SHAPE-1",
    },
    {
        "script": "container-start-race-patch.py",
        "evidence": ("qnfo-containers-pilot/worker.js", "this._starting = this._doStart()"),
        "reason": "superseded: ensureStarted() carries the in-flight start promise (the START-RACE-1 fix) without its marker",
    },    # APPLIER-RETIRE-4 (2026-10-01, issues 1533-1542): each verified against its target file.
    {
        "script": "applier-classify-signature-and-retire-patch.py",
        "evidence": ("scripts/apply-pending-patches.py", "APPLIER-CLASSIFY-SIGNATURE-2"),
        "reason": "superseded: classify() carries APPLIER-CLASSIFY-SIGNATURE-2 and the retire lifecycle landed as APPLIER-RETIRE-2 (issue 1533)",
    },
    {
        "script": "applier-doctor-outcome-all-clean-patch.py",
        "evidence": ("scripts/applier-doctor.py", "OUTCOME-ALL-1: markers, when declared, are the authoritative outcome signal"),
        "reason": "superseded: both OUTCOME-ALL-2 edits (assigned marker authoritative in declared_markers; ALL-of semantics in outcome_present) are in applier-doctor.py as OUTCOME-ALL-1 (issue 1534)",
    },
    {
        "script": "cf-worker-deploy-preserve-meta-patch.py",
        "evidence": ("qnfo-ops/worker.js", "PRESERVE-WORKER-METADATA-2"),
        "reason": "superseded: opsDeploy preserves worker-level metadata (compat date/flags, containers) as PRESERVE-WORKER-METADATA-2 (issue 1536)",
    },
    {
        "script": "patch-container-binding-guard-1.py",
        "evidence": ("qnfo-containers-pilot/worker.js", "CONTAINER-CONFIG-MISSING-1"),
        "reason": "superseded: ensureStarted() and _doStart() both guard a missing ctx.container as CONTAINER-CONFIG-MISSING-1 (issue 1538)",
    },
    {
        "script": "dashboard-drift-failclosed-patch.py",
        "evidence": ("qnfo-fleet-dashboard/worker.js", "DRIFT-FAILCLOSED-1"),
        "reason": "landed: DRIFT-FAILCLOSED-1 is in the dashboard; only the applier's own self-postcondition marker is absent (issue 1539)",
    },
    {
        "script": "patch-container-binding-repair-1.py",
        "evidence": ("scripts/restore_container_config.py", "keep_bindings"),
        "reason": "superseded: RESTORE-5 sends every binding explicitly with keep_bindings for the secret, which is the repair this applier made (issue 1540)",
    },
    {
        "script": "patch-container-exports-map-1.py",
        "evidence": ("scripts/restore_container_config.py", "S1-exports-dict-sqlite"),
        "reason": "superseded: exports is sent as the dict-keyed shape (strategy S1-exports-dict-sqlite, accepted live 2026-10-01) (issue 1541)",
    },
    {
        "script": "patch-cron-only-class.py",
        "evidence": ("scripts/deploy-drift-guard.py", "CRON_ONLY"),
        "reason": "superseded: deploy-drift-guard.py classifies cron-only workers as CRON_ONLY instead of NO_HEALTH_ROUTE (issue 1542)",
    },
    # APPLIER-RETIRE-5 (2026-10-01, issue 1673): each entry below was verified by reading the applier's own MARK
    # or outcome and finding it in the file the applier targets (or, for d1guard, the blocking battery).
    {
        "script": "schedules-live-1-patch.py",
        "evidence": ("qnfo-email/worker.js", "SCHEDULES-LIVE-1"),
        "reason": "landed: the applier's own MARK (SCHEDULES-LIVE-1) is present in its target qnfo-email/worker.js; it errors only on a moved anchor",
    },
    {
        "script": "deploy-guard-wrap-patch.py",
        "evidence": ("scripts/raw_put.py", "def guard_unlock"),
        "reason": "landed: raw_put.py acquires the deploy-guard lock and releases it via atexit guard_unlock (the applier's outcome); it fails only because its 'imports' anchor moved",
    },
    {
        "script": "d1guard-literal-aware-patch.py",
        "evidence": ("scripts/d1guard-battery.mjs", "D1-GUARD-FN-AWARE-1"),
        "reason": "superseded: the literal- and function-aware guard (replace() accepted as a scalar function) is covered by D1-GUARD-FN-AWARE-1 cases in the blocking D1-GUARD-BATTERY-1 (31/31 against qnfo-ops/worker.js); the applier pins a pre-patch VERSION that no longer exists",
    },
    {
        "script": "telemetry-truth-patch.py",
        "evidence": ("qnfo-ops/worker.js", "timeoutMs: 15e3"),
        "reason": "superseded: its three root causes were fixed directly in qnfo-ops (backlog probe gets its own 15 s budget and keeps its error; telemetryReport scopes calls/fails/top to job = 'qnfo-ops'); the applier pins the TELEMETRY-TRUTH-1 marker that fix never carried",
    },
    # APPLIER-RETIRE-6 (2026-10-01, issue 1673): the last 8 stale-anchor appliers in ci-status/apply-pending-report.json
    # (07:31Z). Each was read and its defect found fixed in the target under a different shape, so its anchor can never
    # match again; the evidence token below was verified present (grep -F) in the named file.
    {
        "script": "affirm-veto-sentence-scope-patch.py",
        "evidence": ("qnfo-ops/worker.js", "AFFIRM-VETO-CLAUSE"),
        "reason": "superseded: the adjacency-scoped veto was replaced by the clause-scoped AFFIRM-VETO-CLAUSE guard (affirm-veto-clause-targets landed)",
    },
    {
        "script": "driftguard-label-and-lifecycle-sot-patch.py",
        "evidence": ("scripts/deploy-drift-guard.py", "LABEL_MISMATCH"),
        "reason": "landed: (A) LABEL_MISMATCH class in deploy-drift-guard.py, (B) raw_put.py VERSION_RE accepts QNFO_VERSION, (C) qnfo-lifecycle /health and heartbeat derive from QNFO_VERSION",
    },
    {
        "script": "driftguard-server-version-patch.py",
        "evidence": ("scripts/deploy-drift-guard.py", "SERVER_CONST = re.compile"),
        "reason": "superseded: deploy-drift-guard.py carries the explicit SERVER_VERSION fallback (VERSION-QUOTE-1), which is the NO_REPO_VERSION fix",
    },
    {
        "script": "fleet-selfheal-20260929-patch.py",
        "evidence": ("qnfo-lifecycle/worker.js", "METRIC-FRESHNESS-WRITER-1"),
        "reason": "landed: S2/S3 reported OK and S1's METRIC-FRESHNESS-WRITER-1 is in qnfo-lifecycle; only S1's anchor moved",
    },
    {
        "script": "fleetfix-1299-1193-patch.py",
        "evidence": ("qnfo-social/worker.js", "postText(s, text, null, { embed:"),
        "reason": "landed: #1299 reply arity fixed (embed passed as opts, reply null) and #1193 fleet-exec cadence is */10 in fleet-exec/wrangler.toml; it anchors on a pre-0.7.16 qnfo-social VERSION",
    },
    {
        "script": "selfheal-rate-aware-patch.py",
        "evidence": ("qnfo-ops/worker.js", "const toolKey = _tm ? _tm[1]"),
        "reason": "superseded: telemetryAnalyze extracts the bare tool name from cloud_ops_events.text (the extractor blind spot this applier fixed)",
    },
    {
        "script": "selfheal-volfloor-patch.py",
        "evidence": ("qnfo-ops/worker.js", "_rate >= 0.15 || _errs >= 25"),
        "reason": "superseded: the self-heal gate carries the absolute-volume floor (_errs >= 25) alongside the rate gate",
    },
    {
        "script": "version-anchor-normalize-patch.py",
        "evidence": ("qnfo-ops/worker.js", "SAME-ZONE-FETCH-FALLBACK-1"),
        "reason": "obsolete: it only re-anchored 8 appliers on exact qnfo-ops VERSION literals; all 8 now report already-applied (e.g. samezone-fetch-fallback's SAME-ZONE-FETCH-FALLBACK-1 is in qnfo-ops)",
    },
    # VERSION-FLOOR-1 (2026-11-04): its anchor (the closing `if (!finalText) finalText = "(tool loop did not converge ..."` line) survives, so it still reported `landed`, but the DO/WS
    # session loop already runs the final no-tools round (opsAgentChat with BUDGET_EXHAUSTED_DIRECTIVE) and records the bail as "do-session"; applying it adds a second round and writes
    # VERSION 2.38.14 over 2.62.x. The evidence token is the existing bail record, verified present in the tree.
    {
        "script": "toolbudget-do-loop-parity-1-patch.py",
        "evidence": ("qnfo-ops/worker.js", 'logToolBudgetBail(this.env, "do-session", 0, "", maxIters, false)'),
        "reason": "superseded: the DO/WS session loop already has the final no-tools round and the do-session bail record; the applier's anchor line survives but applying it duplicates the round and lowers the VERSION",
    },
]


def _retire_evidence_ok(root: Path, entry: dict) -> bool:
    """APPLIER-RETIRE-2: skip an applier ONLY when its superseding evidence is
    present in the tree RIGHT NOW. Absent evidence -> do not retire (run it)."""
    try:
        rel, token = entry["evidence"]
    except Exception:  # noqa: BLE001
        return False
    if not rel or not token or len(str(token).strip()) < 8:
        return False
    fp = root / rel
    if not fp.is_file():
        return False
    try:
        return str(token) in fp.read_text(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        return False


def main() -> int:
    root = repo_root()
    scripts_dir = root / "scripts"
    if not scripts_dir.is_dir():
        print(f"{MARKER}: no scripts/ under {root}")
        return 3

    timeout = int(os.environ.get("APPLIER_DOCTOR_TIMEOUT", "60") or "60")
    pats = sorted(
        p
        for p in scripts_dir.glob("*.py")
        if "patch" in p.name and p.name != Path(__file__).name
    )
    if not pats:
        print(f"{MARKER}: no patch scripts found under {scripts_dir}")
        return 3

    results = []
    landed = []
    reverted_any = []
    retired_seen = []

    # APPLIER-RETIRE-2: retire superseded one-shot appliers, but only on
    # evidence present in the tree at this moment (see RETIRED_APPLIERS).
    # Retirement is fail-closed (needs evidence); execution is fail-open.
    for _entry in RETIRED_APPLIERS:
        if _entry["script"] in {p.name for p in pats} and _retire_evidence_ok(root, _entry):
            retired_seen.append(_entry["script"])
    if retired_seen:
        pats = [p for p in pats if p.name not in set(retired_seen)]
        print(f"{MARKER} retired {len(retired_seen)} applier(s) whose outcome is already in the tree")
        for _n in retired_seen:
            print(f"  RETIRED {_n}")
    else:
        print(f"{MARKER} retired 0 applier(s) - no supersession evidence found")

    print(f"{MARKER} scanning {len(pats)} patch script(s) under {scripts_dir}")

    for path in pats:
        before = snapshot(root)
        before_h = dirty_hashes(root)
        started = time.time()
        try:
            proc = subprocess.run(
                [sys.executable, str(path.relative_to(root))],
                cwd=str(root),
                capture_output=True,
                text=True,
                timeout=timeout,
                env={**os.environ, "REPO_ROOT": str(root)},
            )
            rc, out = proc.returncode, (proc.stdout or "") + (proc.stderr or "")
        except subprocess.TimeoutExpired:
            rc, out = 124, f"TIMEOUT after {timeout}s"
        except Exception as exc:  # noqa: BLE001
            rc, out = 1, f"EXEC-ERROR {exc}"

        after = snapshot(root)
        after_h = dirty_hashes(root)
        changed = before != after
        # REVERT-COLLATERAL-1: the paths THIS script changed, not the whole tree.
        delta = {
            p: v.split(":", 1)[0]
            for p, v in after_h.items()
            if before_h.get(p) != v
        }
        verdict = classify(out, rc)
        reverted = []

        if rc != 0 and changed:
            # PARTIAL-APPLY-1: do not let a failed patcher leak half a patch.
            # REVERT-COLLATERAL-1: and do not let it leak into other patches.
            if not delta:
                # Defensive: a dirty-tree comparison said "changed" but hashing
                # could not name the paths. Fall back to the full dirty set so a
                # failed patcher can still never leave a half-write behind.
                delta = _porcelain_paths(root)
                print(f"  WARN {path.name}: delta unresolved, reverting {len(delta)} dirty path(s)")
            reverted = revert_paths(root, delta)
            reverted_any.append({"script": path.name, "paths": reverted})
            verdict = "stale-anchor" if verdict == "stale-anchor" else "error-reverted"
        elif rc == 0 and not changed:
            verdict = "already-applied"
        elif rc == 0 and changed:
            down = version_downgrades(root, delta or _porcelain_paths(root))
            if down:
                reverted = revert_paths(root, delta or _porcelain_paths(root))
                reverted_any.append({"script": path.name, "paths": reverted, "version_downgrade": [list(d) for d in down]})
                verdict = "version-downgrade-reverted"
                print("  VERSION-FLOOR-1 " + path.name + " would lower " + ", ".join("%s %s -> %s" % d for d in down) + "; reverted")
            else:
                verdict = "landed"
                landed.append(path.name)

        results.append(
            {
                "script": path.name,
                "rc": rc,
                "verdict": verdict,
                "changed": changed,
                "reverted": reverted,
                "seconds": round(time.time() - started, 2),
                "tail": out.strip().splitlines()[-1][:200] if out.strip() else "",
            }
        )
        print(f"  {path.name:<52} rc={rc} {verdict}")

    summary = {}
    for r in results:
        summary[r["verdict"]] = summary.get(r["verdict"], 0) + 1

    print(f"SUMMARY total={len(results)} {summary}")
    if retired_seen:
        # Visibility is the fix for the silent half of APPLIER-ROT-1: a retired
        # applier must never look like an applier that simply did not run.
        print("RETIRED(" + str(len(retired_seen)) + "): " + ", ".join(retired_seen))
    if landed:
        print("LANDED(" + str(len(landed)) + "): " + ", ".join(landed))
    else:
        print("LANDED(0): nothing to apply - main is current")
    if reverted_any:
        # Visibility is the fix for the silent half of REVERT-COLLATERAL-1.
        names = ", ".join(r["script"] for r in reverted_any)
        print(
            "::warning::REVERT-COLLATERAL-1 reverted path-scoped writes from: " + names
        )

    out_dir = root / "ci-status"
    out_dir.mkdir(exist_ok=True)
    (out_dir / "apply-pending-report.json").write_text(
        json.dumps(
            {
                "workflow": "apply-pending-patches",
                "marker": MARKER,
                "head": git(root, "rev-parse", "HEAD").strip(),
                "total": len(results),
                "summary": summary,
                "landed": landed,
                "retired": retired_seen,
                "reverted": reverted_any,
                "results": results,
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
            indent=2,
        )
        + "\n"
    )
    print("wrote ci-status/apply-pending-report.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
