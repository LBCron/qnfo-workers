#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""obsidian_sync.py v1.0 (2026-09-04) - Mirror D:/Obsidian vault -> R2 d-drive bucket prefix obsidian/.
Push-only (rclone copy --update, no --delete): local vault is canonical; R2 is the durable superset
archive consumed by backend Cloudflare processes (personal-life-indexer -> personal-life D1 + Vectorize
-> personal twin RAG; future QNFO-side bridges bind the same bucket).
Overlapping-run guard via msvcrt byte lock. Exit: 0=ok/skip, 3=vault missing, else rclone exit.
"""
import subprocess, sys, os, time, msvcrt

RCLONE = r"C:\rclone\rclone.exe"
VAULT = r"C:\Users\LENOVO\Obsidian"
REMOTE = "primary-r2:d-drive/obsidian"
BASE = os.path.dirname(os.path.abspath(__file__))
FILTERS = os.path.join(BASE, "obsidian-sync-filters.txt")
LOGDIR = r"C:\Users\LENOVO\.deepchat\logs"
LOG = os.path.join(LOGDIR, "obsidian-sync.log")       # rclone detail log
RUNLOG = os.path.join(LOGDIR, "obsidian-sync-run.log")  # python run log
LOCK = os.path.join(LOGDIR, "obsidian-sync.lock")

def main():
    os.makedirs(LOGDIR, exist_ok=True)
    try:
        lf = open(LOCK, "a+b")
        msvcrt.locking(lf.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        with open(RUNLOG, "a", encoding="utf-8") as f:
            f.write("[%s] SKIP: previous run active\n" % time.strftime("%Y-%m-%d %H:%M:%S"))
        return 0
    try:
        if not os.path.isdir(VAULT):
            with open(RUNLOG, "a", encoding="utf-8") as f:
                f.write("[%s] ERROR: vault dir missing\n" % time.strftime("%Y-%m-%d %H:%M:%S"))
            return 3
        cmd = [RCLONE, "copy", VAULT, REMOTE, "--update", "--checksum", "--transfers", "8", "--retries", "3",
               "--log-file", LOG, "--log-level", "INFO"]
        if os.path.exists(FILTERS):
            cmd += ["--filter-from", FILTERS]
        t0 = time.time()
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=2400)
        dt = time.time() - t0
        tail = ((r.stdout or "") + (r.stderr or ""))[-500:]
        with open(RUNLOG, "a", encoding="utf-8") as f:
            f.write("[%s] exit=%s dt=%.0fs %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), r.returncode, dt, tail.replace("\n", " | ")[:400]))
        return r.returncode
    finally:
        try:
            lf.seek(0)
            msvcrt.locking(lf.fileno(), msvcrt.LK_UNLCK, 1)
        except Exception:
            pass
        lf.close()

if __name__ == "__main__":
    sys.exit(main())
