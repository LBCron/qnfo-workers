#!/usr/bin/env python3
"""
skill_pull.py — Pull updated skills from GitHub (canonical) to the local
DeepChat skills filesystem. Runs as a scheduled task so skill updates pushed
by the Cloudflare kaizen engine reach the local instance WITHOUT manual
kaizen/sync triggers.

Flow:
  1. git -C <repo> pull origin master (GitHub QNFO/qnfo-skills = source of truth)
  2. Copy each <skill>/SKILL.md + linked files from repo → %USERPROFILE%/.deepchat/skills/<skill>/
  3. Verify: count SKILL.md files in destination

Usage:
  python C:/Users/LENOVO/.deepchat/scripts/skill_pull.py [--repo PATH] [--dry-run]
"""

import os, sys, subprocess, shutil, argparse, glob

REPO = r"C:\Users\LENOVO\Documents\GitHub\qnfo-skills"
DEST = os.path.expandvars(r"%USERPROFILE%\.deepchat\skills")

def run(cmd, cwd=None):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, shell=True)
    return r.returncode, r.stdout, r.stderr

def main():
    ap = argparse.ArgumentParser(description="Pull updated skills from GitHub to local DeepChat")
    ap.add_argument("--repo", default=REPO, help="Path to qnfo-skills git repo")
    ap.add_argument("--dest", default=DEST, help="Destination skills directory")
    ap.add_argument("--dry-run", action="store_true", help="Show what would be copied")
    ap.add_argument("--no-pull", action="store_true", help="Skip git pull (just copy)")
    args = ap.parse_args()

    if not os.path.isdir(args.repo):
        print(f"ERROR: repo not found: {args.repo}", file=sys.stderr)
        sys.exit(1)

    # 1. git pull
    if not args.no_pull:
        print("== git pull ==")
        code, out, err = run(f"git pull origin master", cwd=args.repo)
        print(out.strip()[-1500:])
        if err.strip():
            print(err.strip()[-500:], file=sys.stderr)
        if code != 0:
            print("WARN: git pull exited", code, file=sys.stderr)

    # 2. Discover skill dirs (repo root has flat <skill>/ dirs; also support prompts/skills layout)
    skill_dirs = []
    for pattern in [os.path.join(args.repo, "*", "SKILL.md"),
                    os.path.join(args.repo, "prompts", "skills", "*", "SKILL.md")]:
        for f in glob.glob(pattern):
            skill_dirs.append(os.path.dirname(f))
    skill_dirs = sorted(set(skill_dirs))
    print(f"Found {len(skill_dirs)} skill(s) in repo")

    # 3. Copy each skill dir to destination
    os.makedirs(args.dest, exist_ok=True)
    copied = 0
    for sd in skill_dirs:
        name = os.path.basename(sd)
        target = os.path.join(args.dest, name)
        if args.dry_run:
            print(f"[DRY] copy {name}")
            copied += 1
            continue
        # Copy whole skill dir (SKILL.md + references/ + scripts/ + templates/)
        if os.path.isdir(target):
            shutil.rmtree(target)
        shutil.copytree(sd, target, dirs_exist_ok=True)
        copied += 1

    # 4. Verify
    count = len(glob.glob(os.path.join(args.dest, "*", "SKILL.md")))
    print(f"Copied {copied} skill(s). Destination has {count} SKILL.md files.")
    if count == 0:
        print("WARN: no SKILL.md found in destination — check repo layout", file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()
