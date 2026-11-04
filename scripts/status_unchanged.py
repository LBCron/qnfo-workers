#!/usr/bin/env python3
"""STATUS-NOOP-SKIP-1: tell a CI status-artifact writer whether a freshly written JSON status file differs from
the committed one ONLY in per-run stamps, so the writer can skip a commit that carries no information.

Measured 2026-10-01 over the last 40 commits of each file: ci-status/remediation-consumer.json changed in 6
(33 of 39 commits were stamp-only) and ci-status/remediation-bridge.json in 16 (23 of 39). Those commits, plus the
unmangle status file, were about 100 of the 249 bot commits pushed to main in 3 hours; every main push also
starts CodeQL runs that hit "API rate limit exceeded for installation" and report a configuration error.

STATUS-THROTTLE-1 (ACTIONS-QUOTA-1, 2026-10-02): the stamp-only skip was not enough. In the 24h to 2026-10-02 09Z
main took 648 commits and 467 carried [skip ci]: canonical-deploy 127 (its file held nothing but head and ts),
remediation-bridge 108, fleet-autoaudit 105, remediation-consumer 84. [skip ci] does not stop CodeQL default setup,
so each of those started a three-language CodeQL analysis (about 70% of all Push-on-main CodeQL runs), all drawing
on the installation API budget that the SARIF upload then found empty. With --throttle-min N a writer commits a
change that keeps every OUTCOME key the same at most once per N minutes; an outcome change (ok, job_status, error,
a gate's exit code, ...) still commits at once. The authoritative records are unchanged (D1 rows, the deploy
ledger, the run's own uploaded artifact); only the git snapshot is batched.

usage: status_unchanged.py FILE [--ignore k1,k2,...] [--ref REF]
                                [--throttle-min N] [--outcome k1,k2,...] [--stamp-key KEY]
       (REF defaults to HEAD; use origin/main after a fetch)
exit 0  skip the commit:
          FILE equals its version at REF apart from the ignored top-level keys, or
          (--throttle-min) FILE has the same top-level keys and the same OUTCOME values as REF's version, and REF's
          version is younger than N minutes (its STAMP-KEY, else the commit time of REF's last change to FILE)
exit 1  commit: anything else, including a new file, unreadable or invalid JSON, a non-object, an outcome change,
        a changed key set, or an age that cannot be established (fail-safe)

Default ignored keys are pure run stamps: head (the triggering SHA), ts, spent_ms, verifier, actor.
Outcome keys (ok, job_status, counts, guard_exit, repair_exit, ...) are never ignored. Pass --ignore "" to ignore
nothing (a file made only of stamps then commits on the throttle's heartbeat instead of never).
"""
import datetime
import json
import subprocess
import sys
import time

DEFAULT_IGNORE = ("head", "ts", "spent_ms", "verifier", "actor")
# A change in any of these commits at once, whatever the throttle says. Only keys present in a file are compared.
DEFAULT_OUTCOME = ("ok", "job_status", "error", "gate_rc", "guard_exit", "repair_exit", "deploy", "verdict")


def strip(d, ignore):
    return {k: v for k, v in d.items() if k not in ignore}


def _load_pair(path, ref):
    """(new, old) parsed objects, or None when either is missing, unreadable or not a JSON object."""
    try:
        with open(path, encoding="utf-8") as fh:
            new = json.load(fh)
        old_text = subprocess.run(["git", "show", ref + ":" + path], capture_output=True, text=True)
        if old_text.returncode != 0:
            return None  # not tracked yet: first write must be committed
        old = json.loads(old_text.stdout)
    except Exception:
        return None
    if not isinstance(new, dict) or not isinstance(old, dict):
        return None
    return new, old


def unchanged(path, ignore=DEFAULT_IGNORE, ref="HEAD"):
    pair = _load_pair(path, ref)
    if pair is None:
        return False
    new, old = pair
    return strip(new, ignore) == strip(old, ignore)


def _parse_stamp(v):
    """Epoch seconds for an ISO-8601 stamp ('2026-10-02T08:59:18Z', '2026-10-02 08:59:18'); naive means UTC."""
    if not isinstance(v, str) or not v.strip():
        return None
    try:
        dt = datetime.datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.timestamp()


def committed_epoch(path, ref, old, stamp_key):
    """When REF's copy was written: its own stamp, else the commit time of REF's last change to FILE, else None."""
    t = _parse_stamp(old.get(stamp_key)) if stamp_key else None
    if t is not None:
        return t
    r = subprocess.run(["git", "log", "-1", "--format=%ct", ref, "--", path], capture_output=True, text=True)
    out = (r.stdout or "").strip()
    return int(out) if r.returncode == 0 and out.isdigit() else None


def throttled(path, ref="HEAD", minutes=0, outcome=DEFAULT_OUTCOME, stamp_key="ts", now=None):
    """True when the commit can wait: same key set, same outcome values, and REF's copy is younger than `minutes`."""
    if minutes <= 0:
        return False
    pair = _load_pair(path, ref)
    if pair is None:
        return False
    new, old = pair
    if set(new) != set(old):
        return False
    if any(new.get(k) != old.get(k) for k in outcome if k in new or k in old):
        return False
    t = committed_epoch(path, ref, old, stamp_key)
    if t is None:
        return False
    age = (time.time() if now is None else now) - t
    return 0 <= age < minutes * 60


def _opt(argv, name, default):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) else default
    return default


ARTIFACT_REF = "origin/fleet-artifacts"


def resolve_ref(path, ref):
    """MAIN-PUSH-POLICY-1: status artifacts are published to branch fleet-artifacts (main refuses workflow pushes), so a
    comparison against origin/main would see a stale copy and never throttle. For origin/main, prefer the fleet-artifacts
    copy of PATH when the branch carries it (fetched best effort, depth 1); otherwise keep REF."""
    if ref != "origin/main":
        return ref
    subprocess.run(["git", "fetch", "-q", "--depth=1", "origin", "fleet-artifacts:refs/remotes/origin/fleet-artifacts"],
                   capture_output=True, text=True)
    r = subprocess.run(["git", "cat-file", "-e", ARTIFACT_REF + ":" + path], capture_output=True, text=True)
    return ARTIFACT_REF if r.returncode == 0 else ref


def main(argv):
    if not argv or argv[0].startswith("-"):
        print(__doc__)
        return 2
    path = argv[0]
    ignore = DEFAULT_IGNORE
    if "--ignore" in argv:
        raw = _opt(argv, "--ignore", None)
        ignore = tuple(x for x in raw.split(",") if x) if raw is not None else ignore
    ref = _opt(argv, "--ref", "HEAD")
    try:
        minutes = float(_opt(argv, "--throttle-min", "0"))
    except ValueError:
        minutes = 0.0
    outcome = DEFAULT_OUTCOME
    if "--outcome" in argv:
        raw = _opt(argv, "--outcome", None)
        outcome = tuple(x for x in raw.split(",") if x) if raw is not None else outcome
    stamp_key = _opt(argv, "--stamp-key", "ts")
    ref = resolve_ref(path, ref)
    if unchanged(path, ignore, ref):
        print("%s: unchanged apart from run stamps" % path)
        return 0
    if throttled(path, ref, minutes, outcome, stamp_key):
        print("%s: outcome unchanged and the committed copy is younger than %g min - throttled (STATUS-THROTTLE-1)"
              % (path, minutes))
        return 0
    print("%s: changed (or not comparable)" % path)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
