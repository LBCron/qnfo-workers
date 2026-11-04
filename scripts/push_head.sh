#!/usr/bin/env bash
# push_head.sh - MAIN-PUSH-POLICY-1/2 (2026-11-04): publish the commit a workflow just made at HEAD WITHOUT pushing to main.
#
# Ruleset 26544275 `require-build` (required status check "Workers Builds: qnfo-workers" + pull request, bypass: repository
# admin role only) refuses every direct push to main from GITHUB_TOKEN: `GH013: Repository rule violations found for
# refs/heads/main`. This replaces `git push origin HEAD:main` in workflow commit-back steps. It never touches a ruleset.
#
# usage: scripts/push_head.sh artifact [path ...]       status/audit snapshot -> branch fleet-artifacts (latest wins, no PR)
#        scripts/push_head.sh code <branch> [title]     source change -> branch <branch>, plus a pull request into main
#
# artifact: builds a NEW commit from the artifact paths only (arguments, else the files HEAD changed) on top of origin/fleet-artifacts
#   (origin/main when the branch does not exist yet) in a scratch worktree. Only paths under ci-status/ and audits/ are ever published:
#   nothing under .github/ can ride along (GITHUB_TOKEN may not push workflow files), and a shallow checkout (fetch-depth 1) cannot copy the
#   whole tree because the list comes from HEAD's diff after deepening, never from a missing parent. An unchanged snapshot is not
#   committed. Best effort BY DESIGN: exits 0 with a ::warning:: when it cannot publish (PUSH_HEAD_STRICT=1 makes it exit 1).
# code: skips the push when the tree of HEAD equals the tree of the remote branch (an hourly run with an identical result must not
#   reset the PR head and the lane's quiet timer); otherwise force-pushes HEAD to refs/heads/<branch>, opens a pull request through the
#   REST API when none is open, and pokes the merge lane. DURABLE OUTCOME: a branch that cannot get a pull request exits 1, so the
#   workflow goes red and ci-watchdog files it; a warning alone is never the record.
#   CHECKS: the one required check, "Workers Builds: qnfo-workers", is started by the Cloudflare GitHub app on the branch push (an app
#   webhook, not an Actions trigger, so GITHUB_TOKEN does not suppress it). Actions workflows (pr-checks) do not start on a pull request
#   that GITHUB_TOKEN opened; they are not required, and the lane poke below plus the lane's own 10-minute tick decide the merge.
set -uo pipefail
mode="${1:-}"; shift || true
repo="${GITHUB_REPOSITORY:-QNFO/qnfo-workers}"
strict="${PUSH_HEAD_STRICT:-0}"

fail() { echo "::warning::push_head.sh ($mode): $*"; [ "$strict" = "1" ] && exit 1; exit 0; }

case "$mode" in
  artifact)
    sha="$(git rev-parse HEAD)" || fail "no HEAD"
    if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then git fetch -q --deepen=1 origin >/dev/null 2>&1 || true; fi
    if [ "$#" -gt 0 ]; then paths=("$@"); else mapfile -t paths < <(git diff-tree --no-commit-id --name-only -r --root "$sha"); fi
    keep=()
    for p in "${paths[@]}"; do
      case "$p" in ci-status/*|audits/*) keep+=("$p");; *) echo "push_head.sh: not an artifact path, skipped: $p";; esac
    done
    [ "${#keep[@]}" -gt 0 ] || { echo "no artifact paths in $sha - nothing to publish"; exit 0; }
    msg="$(git log -1 --format=%B "$sha")"
    for i in 1 2 3 4 5; do
      wt="$(mktemp -d)"
      if git fetch -q --depth=1 origin fleet-artifacts 2>/dev/null; then base=FETCH_HEAD
      else git fetch -q --depth=1 origin main 2>/dev/null && base=FETCH_HEAD || { rm -rf "$wt"; sleep $((i * 3)); continue; }
      fi
      if git worktree add -q --detach "$wt" "$base" >/dev/null 2>&1; then
        (
          cd "$wt" || exit 1
          git config user.name "${GIT_AUTHOR_NAME:-$(git -C "$OLDPWD" config user.name || echo qnfo-selfheal-bot)}"
          git config user.email "${GIT_AUTHOR_EMAIL:-$(git -C "$OLDPWD" config user.email || echo bot@qnfo.org)}"
          for p in "${keep[@]}"; do
            if git cat-file -e "$sha:$p" 2>/dev/null; then git checkout "$sha" -- "$p" || exit 3; else git rm -q -f --ignore-unmatch -- "$p" >/dev/null 2>&1 || true; fi
          done
          if git diff --cached --quiet; then echo "fleet-artifacts already carries these artifacts - nothing to publish"; exit 10; fi
          git commit -q -m "$msg" || exit 4
          git push -q origin HEAD:refs/heads/fleet-artifacts
        )
        rc=$?
        git worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt"
        [ "$rc" = "10" ] && exit 0
        [ "$rc" = "0" ] && { echo "artifact published to fleet-artifacts on attempt $i"; exit 0; }
      else
        rm -rf "$wt"
      fi
      sleep $((i * 3))
    done
    fail "could not publish to fleet-artifacts after 5 attempts (the snapshot stays in this run's workspace)"
    ;;
  code)
    branch="${1:-}"; title="${2:-fleet-bot change}"
    [ -n "$branch" ] || { echo "::error::push_head.sh code needs a branch name"; exit 1; }
    # a pull request whose head commit says [skip ci] never gets the checks the lane needs: drop the marker
    if git log -1 --format=%B | grep -q '\[skip ci\]'; then
      git commit -q --amend -m "$(git log -1 --format=%B | sed 's/ *\[skip ci\]//')" || true
    fi
    mytree="$(git rev-parse 'HEAD^{tree}')"
    remote_tree=""
    if git fetch -q --depth=1 origin "refs/heads/$branch:refs/remotes/origin/$branch" 2>/dev/null; then remote_tree="$(git rev-parse "refs/remotes/origin/$branch^{tree}" 2>/dev/null || true)"; fi
    if [ -n "$remote_tree" ] && [ "$remote_tree" = "$mytree" ]; then
      echo "branch $branch already carries this exact tree - push skipped (PR head and quiet timer untouched)"
    else
      git push -q --force origin "HEAD:refs/heads/$branch" || { echo "::error::push_head.sh: cannot push branch $branch"; exit 1; }
      echo "pushed refs/heads/$branch"
    fi
    tok="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
    [ -n "$tok" ] || { echo "::error::push_head.sh: no token to open a pull request; the change waits on branch $branch"; exit 1; }
    api="https://api.github.com/repos/$repo"
    owner="${repo%%/*}"
    open="$(curl -s -m 20 -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" "$api/pulls?state=open&head=$owner:$branch" | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else -1)
except Exception: print(-1)' 2>/dev/null || echo -1)"
    if [ "$open" = "0" ]; then
      body="Opened by a workflow because direct pushes to main are refused by ruleset require-build (MAIN-PUSH-POLICY-1, docs/MAIN-PUSH-POLICY.md). Branch ${branch} is replaced on every run of the workflow whose result changed; the stale-PR lane merges it when its checks are green."
      payload="$(TITLE="$title" BRANCH="$branch" BODY="$body" python3 -c 'import json,os; print(json.dumps({"title":os.environ["TITLE"],"head":os.environ["BRANCH"],"base":"main","body":os.environ["BODY"]}))')"
      code="$(curl -s -m 20 -o /tmp/pr_out.json -w '%{http_code}' -X POST -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" "$api/pulls" -d "$payload")"
      if [ "$code" = "201" ]; then echo "opened pull request for $branch"
      else echo "::error::push_head.sh: pull request for $branch not opened (HTTP $code: $(head -c 200 /tmp/pr_out.json 2>/dev/null)); the change waits on the branch"; exit 1; fi
    elif [ "$open" = "-1" ]; then
      echo "::error::push_head.sh: could not list pull requests for $branch; the change waits on the branch"; exit 1
    else
      echo "pull request for $branch already open"
    fi
    curl -s -m 15 -X POST "${LANE_POKE_URL:-https://qnfo-fleet-control.q08.workers.dev/gh/poke}" -H "X-Poke-Event: push_head:$branch" >/dev/null 2>&1 || true
    exit 0
    ;;
  *) echo "usage: push_head.sh artifact [path ...] | code <branch> [title]"; exit 2 ;;
esac
