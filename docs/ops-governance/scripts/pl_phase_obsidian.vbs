Set sh = CreateObject("WScript.Shell")
' pl_phase_obsidian.vbs - REPOINTED 2026-09-04: obsidian_to_r2.py missing (skill drift, ~Aug 29).
' Upload half now = obsidian_sync.py (QNFO_Obsidian_Sync task, 15 min). Index half = trigger below.
sh.Run "cmd /c python -u ""C:\Users\LENOVO\.deepchat\scripts\obsidian_index_trigger.py"" > ""%TEMP%\pl_obsidian.log"" 2>&1", 0, False
