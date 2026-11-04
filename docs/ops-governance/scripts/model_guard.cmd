@echo off
python "C:\Users\LENOVO\Documents\GitHub\qnfo-ops\scripts\model_guard.py" >> "C:\Users\LENOVO\.deepchat\logs\model-guard.log" 2>&1
python "C:\Users\LENOVO\.deepchat\scripts\local-config-selfheal.py" >> "C:\Users\LENOVO\.deepchat\logs\model-guard.log" 2>&1
