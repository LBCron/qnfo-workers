#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""obsidian_cloud_bridge.py v1.0 (2026-09-04) - Minimal Obsidian fallback vault (obsidian-vault bucket, mounted O:)
-> d-drive/obsidian-cloud mirror -> personal-life-indexer (KB/twin retrieval). Excludes .obsidian config noise.
Daily 07:05 via QNFO_Obsidian_Cloud_Bridge. Run log: obsidian-cloud-bridge.log.
"""
import json, time, sys, os, subprocess, urllib.parse

RCLONE = r"C:\rclone\rclone.exe"
CURL = r"C:\Windows\System32\curl.exe"
SRC = "primary-r2:obsidian-vault"
DST = "primary-r2:d-drive/obsidian-cloud"
TOKEN_PATH = r"C:\Users\LENOVO\.deepchat\secrets\qnfo-agent-tokens.json"
LOGDIR = r"C:\Users\LENOVO\.deepchat\logs"
RUNLOG = os.path.join(LOGDIR, "obsidian-cloud-bridge.log")

def log(line):
    try:
        with open(RUNLOG, "a", encoding="utf-8") as f:
            f.write("[%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), line))
    except Exception:
        pass

def main():
    os.makedirs(LOGDIR, exist_ok=True)
    t0 = time.time()
    try:
        # 1) mirror obsidian-vault -> d-drive/obsidian-cloud (exclude config noise)
        r = subprocess.run([RCLONE, "copy", SRC, DST, "--update", "--checksum", "--transfers", "6",
                            "--exclude", "/.obsidian/**", "--exclude", "desktop.ini",
                            "--log-file", os.path.join(LOGDIR, "obsidian-cloud-rclone.log"),
                            "--log-level", "INFO"], capture_output=True, text=True, timeout=600)
        log("mirror exit=%s dt=%.0fs" % (r.returncode, time.time() - t0))
        # 2) trigger personal-life-indexer on the mirror prefix (single call, tiny tree)
        with open(TOKEN_PATH, encoding="utf-8") as f:
            tok = json.load(f).get("index_token", "")
        url = "https://personal-life-indexer.q08.workers.dev/index?prefix=obsidian-cloud&scanCap=1000"
        r2 = subprocess.run([CURL, "-s", "--max-time", "240", "-A", "Mozilla/5.0",
                             "-H", "X-Index-Token: " + tok, url], capture_output=True, text=True, timeout=250)
        log("index rc=%s body=%s" % (r2.returncode, r2.stdout.strip()[:400]))
        return 0 if (r.returncode == 0 and r2.returncode == 0) else 2
    except Exception as e:
        log("ERROR: %r" % (e,))
        return 1

if __name__ == "__main__":
    sys.exit(main())
