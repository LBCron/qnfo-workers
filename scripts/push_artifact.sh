#!/usr/bin/env bash
# push_artifact.sh - ARTIFACT-PUSH-CONFLICT-1 (2026-09-30): commit + publish CI status/audit artifacts (to branch fleet-artifacts since
# MAIN-PUSH-POLICY-1; main refuses direct pushes) without ever entering a merge/rebase conflict.
#
# The common pattern `git pull --rebase --autostash origin main && git push` CONFLICTS whenever a concurrent
# run already pushed a newer copy of the same artifact file (measured: fleet-autodeploy run 36752410754,
# canonical-deploy run 36760796833). A status artifact is a SNAPSHOT -- latest wins, it is never merged -- so
# on rejection this re-bases BY CONSTRUCTION: save this run's copies, hard-reset to origin/main, restore the
# copies, recommit. A content conflict is impossible in that sequence.
#
# usage: scripts/push_artifact.sh "<commit message>" <path> [<path> ...]
# exit:  0 published / nothing to publish / publish failed (warning); never red for an artifact.
set -uo pipefail
msg="$1"; shift
[ "$#" -ge 1 ] || { echo "usage: push_artifact.sh <message> <path>..."; exit 2; }
snap="$(mktemp -d)"
for p in "$@"; do
  [ -e "$p" ] || continue
  mkdir -p "$snap/$(dirname "$p")"
  cp -a "$p" "$snap/$p"
done
restore_and_commit() {
  for p in "$@"; do
    [ -e "$snap/$p" ] || continue
    mkdir -p "$(dirname "$p")"
    cp -a "$snap/$p" "$p"
    git add -- "$p"
  done
  if git diff --cached --quiet; then return 1; fi
  git commit -q -m "$msg"
}
git add -- "$@" 2>/dev/null || true
if git diff --cached --quiet; then echo "artifact unchanged - nothing to push"; exit 0; fi
git commit -q -m "$msg"
# MAIN-PUSH-POLICY-1 (2026-11-04): ruleset require-build refuses direct pushes to main from the workflow token (GH013), so a
# status artifact is published to the branch fleet-artifacts instead (see scripts/push_head.sh, docs/MAIN-PUSH-POLICY.md).
# Best effort: exits 0 with a warning when the branch cannot be updated, so the workflow's verdict is its own step's, not the artifact's.
exec bash "$(dirname "$0")/push_head.sh" artifact
