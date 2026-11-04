import subprocess, os
SCR = "C:/Users/LENOVO/.deepchat/scripts"
def run(name, script, timeout=240):
    try:
        p = subprocess.run(["python", script], cwd=SCR, capture_output=True, text=True, timeout=timeout)
        return (name, p.returncode, (p.stdout or "")[-1500:] + (p.stderr or "")[-400:])
    except Exception as e:
        return (name, "EXC", str(e)[:200])
for name, f in [("PROMPT-STORE-VERIFY","prompt-store-verify.py"), ("DR-SCHEMA","dr_validate_schema.py"), ("SCHED-GUARD","scheduler-guard.py"), ("MODEL-GUARD","model_guard.py")]:
    if os.path.exists(os.path.join(SCR, f)):
        name_, rc, out = run(name, f)
        print("=====", name_, "rc=", rc, "=====")
        print(out[-1600:])
    else:
        print("MISSING", f)