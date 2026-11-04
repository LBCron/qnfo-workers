#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# new_note.py v3 (2026-09-04) - one-click dated Obsidian note.
# Vault: C:/Users/LENOVO/Obsidian (canonical live vault; sync -> R2 obsidian-vault).
# Creates notes/v1/YYYY/MM/DD/_<epoch>.md and opens it in Obsidian.
import datetime, os, sys, time, subprocess, urllib.parse

VAULT = r"C:\Users\LENOVO\Obsidian"
now = datetime.datetime.now()
rel_dir = os.path.join("notes", "v1", now.strftime("%Y"), now.strftime("%m"), now.strftime("%d"))
abs_dir = os.path.join(VAULT, rel_dir)
os.makedirs(abs_dir, exist_ok=True)
ts = int(time.time())
name = "_%d.md" % ts
path = os.path.join(abs_dir, name)
title = now.strftime("%Y-%m-%d %H:%M")
with open(path, "w", encoding="utf-8") as f:
    f.write("# %s\n\n" % title)
print("CREATED", path)
rel = os.path.join(rel_dir, name).replace("\\", "/")
rel_noext = rel[:-3]
uri = "obsidian://open?vault=Obsidian&file=" + urllib.parse.quote(rel_noext)
print("URI", uri)
if "--noopen" not in sys.argv:
    try:
        subprocess.Popen(["cmd", "/c", "start", "", uri], creationflags=0x08000000)
    except Exception as e:
        print("OPEN_WARN", str(e)[:200])
print("DONE")