#!/usr/bin/env bash
# push_head.sh - MAIN-PUSH-POLICY-1 (2026-11-04): publish the commit a workflow just made at HEAD WITHOUT pushing to main.
#
# Ruleset 26544275 `require-build` (required status check "Workers Builds: qnfo-workers" + pull request, bypass: repository
# admin role only) refuses every direct push to main from GITHUB_TOKEN: `GH013: Repository rule violations found for
# refs/heads/main`. This replaces `git push origin HEAD:main` in workflow commit-back steps. It never touches a ruleset.
#
# usage: scripts/push_head.sh artifact            status/audit snapshot -> branch fleet-artifacts (latest wins, no PR)
#        scripts/push_head.sh code <branch> [title]   source change -> branch <branch>, plus a pull request into main when the token may open one
#
# artifact: HEAD's commit is cherry-picked (-X theirs: a snapshot is never merged) onto origin/fleet-artifacts in a scratch
#   worktree, so the caller's HEAD and working tree are untouched and the caller's own retry loop still works. A branch that
#   does not exist yet is created from HEAD. Best effort BY DESIGN: a snapshot that cannot be published must not turn a
#   workflow red, so this exits 0 with a ::warning:: (PUSH_HEAD_STRICT=1 makes it exit 1).
# code: force-pushes HEAD to refs/heads/<branch> (one branch per workflow, replaced each run) and opens a pull request through
#   the REST API with $GH_TOKEN/$GITHUB_TOKEN when none is open for that branch. If the pull request cannot be opened (the
#   repository setting "Allow GitHub Actions to create pull requests" is off, or the token lacks pull-requests: write) the
#   branch still carries the change and a ::warning:: says so; the exit code stays 0 once the branch is pushed.
set -uo pipefail
mode="${1:-}"; shift || true
repo="${GITHUB_REPOSITORY:-QNFO/qnfo-workers}"
strict="${PUSH_HEAD_STRICT:-0}"

fail() { echo "::warning::push_head.sh ($mode): $*"; [ "$strict" = "1" ] && exit 1; exit 0; }

case "$mode" in
  artifact)
    sha="$(git rev-parse HEAD)" || fail "no HEAD"
    wt="$(mktemp -d)"
    for i in 1 2 3 4 5; do
      if git fetch -q --depth=1 origin fleet-artifacts 2>/dev/null; then
        rm -rf "$wt"; wt="$(mktemp -d)"
        git worktree add -q --detach "$wt" FETCH_HEAD >/dev/null 2>&1 || fail "cannot create scratch worktree"
        (
          cd "$wt" || exit 1
          git config user.name "${GIT_AUTHOR_NAME:-qnfo-selfheal-bot}"; git config user.email "${GIT_AUTHOR_EMAIL:-bot@qnfo.org}"
          if ! git cherry-pick -X theirs --allow-empty --keep-redundant-commits "$sha" >/dev/null 2>&1; then
            # delete/modify conflicts: a snapshot wins, take the file as the commit has it
            git checkout "$sha" -- . >/dev/null 2>&1 && git add -A >/dev/null 2>&1 && git -c core.editor=true cherry-pick --continue >/dev/null 2>&1 || exit 2
          fi
          git push -q origin HEAD:refs/heads/fleet-artifacts
        ) && { echo "artifact published to fleet-artifacts on attempt $i"; git worktree remove --force "$wt" >/dev/null 2>&1; exit 0; }
      else
        # branch absent: create it from HEAD (main + this artifact commit)
        git push -q origin "$sha:refs/heads/fleet-artifacts" && { echo "artifact branch fleet-artifacts created"; exit 0; }
      fi
      sleep $((i * 3))
    done
    git worktree remove --force "$wt" >/dev/null 2>&1 || true
    fail "could not publish to fleet-artifacts after 5 attempts (the snapshot stays in this run's workspace)"
    ;;
  code)
    branch="${1:-}"; title="${2:-fleet-bot change}"
    [ -n "$branch" ] || fail "code mode needs a branch name"
    # a pull request whose head commit says [skip ci] never gets the checks the lane needs: drop the marker
    if git log -1 --format=%B | grep -q '\[skip ci\]'; then
      git commit -q --amend -m "$(git log -1 --format=%B | sed 's/ *\[skip ci\]//')" || true
    fi
    git push -q --force origin "HEAD:refs/heads/$branch" || { echo "::error::push_head.sh: cannot push branch $branch"; exit 1; }
    echo "pushed refs/heads/$branch"
    tok="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
    [ -n "$tok" ] || fail "no token to open a pull request; the change waits on branch $branch"
    api="https://api.github.com/repos/$repo"
    owner="${repo%%/*}"
    open="$(curl -s -m 20 -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" "$api/pulls?state=open&head=$owner:$branch" | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else -1)
except Exception: print(-1)' 2>/dev/null || echo -1)"
    if [ "$open" = "0" ]; then
      body="Opened by a workflow because direct pushes to main are refused by ruleset require-build (MAIN-PUSH-POLICY-1, docs/MAIN-PUSH-POLICY.md). Branch ${branch} is replaced on every run of the workflow; the stale-PR lane merges it when its checks are green."
      payload="$(TITLE="$title" BRANCH="$branch" BODY="$body" python3 -c 'import json,os; print(json.dumps({"title":os.environ["TITLE"],"head":os.environ["BRANCH"],"base":"main","body":os.environ["BODY"]}))')"
      code="$(curl -s -m 20 -o /tmp/pr_out.json -w '%{http_code}' -X POST -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" "$api/pulls" -d "$payload")"
      if [ "$code" = "201" ]; then echo "opened pull request for $branch"; else fail "pull request for $branch not opened (HTTP $code: $(head -c 200 /tmp/pr_out.json 2>/dev/null)); the change waits on the branch"; fi
    elif [ "$open" = "-1" ]; then
      fail "could not list pull requests for $branch; the change waits on the branch"
    else
      echo "pull request for $branch already open"
    fi
    exit 0
    ;;
  *) echo "usage: push_head.sh artifact | code <branch> [title]"; exit 2 ;;
esac
