#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""new_daily_note.py v1.2 (2026-09-04) - ONE-CLICK unique dated note in the SINGLE Obsidian vault D:\Obsidian.
Creates notes/v1/YYYY/MM/DD/<YYYY-MM-DD-HHMMSS>.md (unique timestamp name, date-nested per vault
newFileFolderPath) with frontmatter (type/date/source) + daily heading - content crosses the
personal-life-indexer 60-char minimum so notes reach the KB/twin after the next 15-min sync.
Then opens the note in the running Obsidian vault via obsidian:// URI. Desktop: 'New Dated Note.vbs'.
"""
import os, sys, datetime, urllib.parse

VAULT = r"D:\Obsidian"

def main():
    now = datetime.datetime.now()
    base = now.strftime("%Y-%m-%d-%H%M%S")
    folder = os.path.join(VAULT, "notes", "v1", now.strftime("%Y"), now.strftime("%m"), now.strftime("%d"))
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, base + ".md")
    n = 2
    while os.path.exists(path):
        path = os.path.join(folder, "%s-%d.md" % (base, n))
        n += 1
    iso = now.strftime("%Y-%m-%dT%H:%M:%S")
    with open(path, "w", encoding="utf-8") as f:
        f.write("---\ntype: daily-note\ndate: %s\nsource: obsidian\n---\n\n# %s\n\n" % (iso, now.strftime("%Y-%m-%d %H:%M")))
    uri = "obsidian://open?path=" + urllib.parse.quote(path.replace("\\", "/"))
    try:
        os.startfile(uri)
    except Exception:
        pass
    print(path)
    return 0

if __name__ == "__main__":
    sys.exit(main())
