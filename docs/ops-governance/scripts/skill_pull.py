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

def is_link(path):
    """True for a symlink, an NTFS junction or any directory reparse point. os.path.islink is False for a junction before Python 3.12, and a
    junction or hardlink that makes two skill directories look like duplicates is the near-miss that RM-GATE-H3 (fleet-lessons H3) records."""
    if os.path.islink(path):
        return True
    isjunction = getattr(os.path, "isjunction", None)
    if isjunction and isjunction(path):
        return True
    try:
        return bool(os.lstat(path).st_file_attributes & 0x400)  # FILE_ATTRIBUTE_REPARSE_POINT; the attribute exists on Windows only
    except (AttributeError, OSError):
        return False


def verify_membership(src_dirs, dest):
    """RM-GATE-H2 (fleet-lessons H2): on-disk presence is not registration. A skill the repo holds counts as present only when the destination
    has its directory with a SKILL.md that starts with the '---' frontmatter fence; returns the sorted names that do not. Counting SKILL.md files
    (the old step 4) hid forty skills on disk against fifteen registered. scripts/fleet_lessons_gates.py (gate H2) exercises this on a fixture."""
    missing = []
    for sd in src_dirs:
        name = os.path.basename(os.path.normpath(sd))
        md = os.path.join(dest, name, "SKILL.md")
        try:
            with open(md, encoding="utf-8", errors="replace") as fh:
                ok = fh.read(3) == "---"
        except OSError:
            ok = False
        if not ok:
            missing.append(name)
    return sorted(missing)


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
        # RM-GATE-H3: a destination that is a junction, symlink or reparse point already IS another copy of the skill (or of this repo); deleting it
        # (older Pythons follow a junction) or replacing it risks the very files it points at. Probe first, leave a link alone.
        if is_link(target):
            print(f"SKIP {name}: destination is a link/junction; left in place", file=sys.stderr)
            copied += 1
            continue
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
    # RM-GATE-H2: membership, not a count. Every skill the repo holds must be usable in the destination before anything relies on it.
    if not args.dry_run:
        missing = verify_membership(skill_dirs, args.dest)
        if missing:
            print(f"ERROR: {len(missing)} skill(s) in the repo are not usable in the destination: {', '.join(missing[:10])}", file=sys.stderr)
            sys.exit(2)

if __name__ == "__main__":
    main()
