@echo off
python "C:\Users\LENOVO\.deepchat\scripts\local-config-selfheal.py" >> "C:\Users\LENOVO\.deepchat\logs\scheduler-guard.log" 2>&1
python "C:\Users\LENOVO\Documents\GitHub\qnfo-ops\scripts\scheduler-guard.py" >> "C:\Users\LENOVO\.deepchat\logs\scheduler-guard.log" 2>&1
