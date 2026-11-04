#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""obsidian_index_trigger.py v1.6 (2026-09-04) - PER-FOLDER full-cover drain for obsidian/ prefix.
Day-folder prefixes from D:\\Obsidian (prunes .git/.obsidian), /index?prefix=<folder> per folder.
curl --max-time per call; resumable via obsidian-index-folder-state.json.
"""
import json, time, sys, os, subprocess, urllib.parse

BASE = "https://personal-life-indexer.q08.workers.dev/index"
TOKEN_PATH = r"C:\Users\LENOVO\.deepchat\secrets\qnfo-agent-tokens.json"
LOGDIR = r"C:\Users\LENOVO\.deepchat\logs"
RUNLOG = os.path.join(LOGDIR, "obsidian-index-run.log")
STATE = os.path.join(LOGDIR, "obsidian-index-folder-state.json")
CURL = r"C:\Windows\System32\curl.exe"
VAULT = r"D:\Obsidian"

def log(line):
    try:
        with open(RUNLOG, "a", encoding="utf-8") as f:
            f.write("[%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), line))
    except Exception:
        pass

def walk_folders():
    prefixes = []
    for root, dirs_, files_ in os.walk(VAULT):
        dirs_[:] = [d for d in dirs_ if d not in (".git", ".obsidian")]
        for d in dirs_:
            rel = os.path.relpath(os.path.join(root, d), VAULT).replace("\\", "/")
            prefixes.append("obsidian/" + rel + "/")
    return sorted(set(prefixes))

def call(prefix):
    url = BASE + "?prefix=" + urllib.parse.quote(prefix, safe="/") + "&scanCap=1000"
    with open(TOKEN_PATH, encoding="utf-8") as f:
        tok = json.load(f).get("index_token", "")
    r = subprocess.run([CURL, "-s", "--max-time", "200", "-A", "Mozilla/5.0",
                        "-H", "X-Index-Token: " + tok, url], capture_output=True, text=True, timeout=210)
    if r.returncode != 0:
        raise RuntimeError("curl rc=%s %s" % (r.returncode, r.stderr[-160:]))
    return json.loads(r.stdout.strip())

def main():
    os.makedirs(LOGDIR, exist_ok=True)
    prefixes = walk_folders()
    try:
        with open(STATE, encoding="utf-8") as f:
            st = json.load(f)
        start = st.get("last", "")
    except Exception:
        start = ""
    t = {"scanned": 0, "indexed": 0, "skipped": 0, "errors": 0}
    log("FOLDER-DRAIN v1.6 RESTART folders=%d resume_after=%s" % (len(prefixes), start or "(none)"))
    begun = not start
    try:
        for p in prefixes:
            if not begun:
                if p == start:
                    begun = True
                continue
            try:
                j = call(p)
                for k in ("scanned", "indexed", "skipped", "errors"):
                    t[k] = t.get(k, 0) + j.get(k, 0)
                log("%s scanned=%s indexed=%s skipped=%s errors=%s %sms done=%s" % (
                    p, j.get("scanned"), j.get("indexed"), j.get("skipped"), j.get("errors"),
                    j.get("elapsedMs"), j.get("done")))
                with open(STATE, "w", encoding="utf-8") as f:
                    json.dump({"last": p, "totals": t}, f)
            except Exception as e:
                log("FOLDER-ERROR %s: %r (continue)" % (p, e))
            time.sleep(0.12)
        log("FOLDER-DRAIN DONE " + json.dumps(t))
        return 0
    except Exception as e:
        log("FATAL: %r" % (e,))
        return 1

if __name__ == "__main__":
    sys.exit(main())
