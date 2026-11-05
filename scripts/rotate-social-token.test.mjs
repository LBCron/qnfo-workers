// ROTATE-TOKEN-TMP-1 offline suite: scripts/rotate-social-token.py rotates GATEWAY_SOCIAL_TOKEN across the worker secret, an R2 mirror and ~/.env. It used to write the new
// token to a fixed TEMP/gwst.txt for wrangler (readable by other local users, never removed) and to leave ~/.env at the umask default, so each rotation left the live bearer on
// disk (CodeQL py/clear-text-storage-sensitive-data, alert 5).
// This imports the real script and runs rotate() with subprocess, the random token and check() replaced, against a temp ~/.env.
// Proves: the file wrangler uploads holds exactly the new token, is private (0600, in a 0700 directory), and is gone with its directory after a successful AND a failed
// upload; the fixed TEMP/gwst.txt is never created; the token never reaches stdout; ~/.env keeps its other lines, replaces the old token line, and ends 0600 even when it
// was created 0644. Mode checks are skipped on Windows, where POSIX modes do not exist.
// Run: node scripts/rotate-social-token.test.mjs   -> prints "N passed, 0 failed"
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const here = dirname(fileURLToPath(import.meta.url));
const PY = (() => { for (const c of ["python3", "python"]) { const r = spawnSync(c, ["-I", "-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" }); if (r.status === 0 && String(r.stdout).trim() === "3") return c; } return null; })();
ok(PY !== null, "a python 3 interpreter is available");

const SCRIPT = String.raw`
import sys, os, stat, tempfile, types, importlib.util, io, contextlib, json, shutil
from pathlib import Path
spec = importlib.util.spec_from_file_location("rst", sys.argv[1])
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
posix = os.name != "nt"
res = []
def ok(c, m, d=None): res.append({"ok": bool(c), "m": m, "d": d})

tmp = Path(tempfile.mkdtemp(prefix="rst-"))
env_file = tmp / "dotenv"
env_file.write_text("OTHER=1\nGATEWAY_SOCIAL_TOKEN=oldvalue\nLAST=z\n")
os.chmod(env_file, 0o644)
M.ENV = str(env_file)
M.check = lambda: None
M.secrets = types.SimpleNamespace(token_hex=lambda n: "ab" * n)
token = "ab" * 24
fixed = Path(tempfile.gettempdir()) / "gwst.txt"
fixed_before = fixed.exists()

class Done: returncode = 0
seen, calls = {}, []
def cmd(args):
    return ["wrangler" if os.path.basename(args[0]).lower().split(".")[0] == "wrangler" else args[0]] + list(args[1:])
def run_ok(args, **kw):
    args = cmd(args)
    calls.append(list(args))
    if args[:4] == ["wrangler", "r2", "object", "put"]:
        f = args[args.index("--file") + 1]
        seen["path"] = f
        seen["content"] = open(f).read()
        seen["mode"] = stat.S_IMODE(os.stat(f).st_mode)
        seen["dir_mode"] = stat.S_IMODE(os.stat(os.path.dirname(f)).st_mode)
    return Done()
M.subprocess = types.SimpleNamespace(run=run_ok)
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    M.rotate()
out = buf.getvalue()

ok(seen.get("content") == token, "wrangler uploads a file holding exactly the new token", seen.get("content"))
if posix:
    ok(seen["mode"] & 0o077 == 0, "the token file is private (no group or other bits)", oct(seen["mode"]))
    ok(seen["dir_mode"] & 0o077 == 0, "its directory is private (0700)", oct(seen["dir_mode"]))
ok(not os.path.exists(seen["path"]) and not os.path.exists(os.path.dirname(seen["path"])), "the token file and its directory are gone after a successful rotation")
ok(not fixed.exists() or fixed_before, "the fixed TEMP/gwst.txt is not created")
ok(token not in out, "the token never reaches stdout")
ok([c[:3] for c in calls] == [["wrangler", "secret", "put"], ["wrangler", "r2", "object"]], "the worker secret is put first, then the R2 mirror", [c[:3] for c in calls])
txt = env_file.read_text()
ok(("GATEWAY_SOCIAL_TOKEN=" + token) in txt and "OTHER=1" in txt and "LAST=z" in txt and "oldvalue" not in txt, "~/.env: the old token line is replaced and the other lines are kept", txt)
if posix:
    ok(stat.S_IMODE(os.stat(env_file).st_mode) & 0o077 == 0, "~/.env ends private (0600) though it was 0644", oct(stat.S_IMODE(os.stat(env_file).st_mode)))
    fresh = tmp / "fresh_env"
    M.ENV = str(fresh)
    with contextlib.redirect_stdout(io.StringIO()):
        M.rotate()
    ok(fresh.exists() and stat.S_IMODE(os.stat(fresh).st_mode) & 0o077 == 0, "a ~/.env that did not exist is created private (0600)")
    M.ENV = str(env_file)

# a failed upload still removes the token file
failed = {}
def run_fail(args, **kw):
    args = cmd(args)
    if args[:4] == ["wrangler", "r2", "object", "put"]:
        failed["path"] = args[args.index("--file") + 1]
        failed["existed"] = os.path.exists(failed["path"])
        raise RuntimeError("upload failed")
    return Done()
M.subprocess = types.SimpleNamespace(run=run_fail)
raised = False
try:
    with contextlib.redirect_stdout(io.StringIO()):
        M.rotate()
except RuntimeError:
    raised = True
ok(raised and failed.get("existed") is True, "a failing upload still raises (the file existed while it ran)", failed)
ok(not os.path.exists(failed.get("path", "/nonexistent-x")) and not os.path.exists(os.path.dirname(failed.get("path", "/nonexistent-x/y"))), "the token file and its directory are gone after a FAILED upload")
shutil.rmtree(tmp, ignore_errors=True)
print(json.dumps(res))
`;

if (PY) {
  const r = spawnSync(PY, ["-I", "-c", SCRIPT, join(here, "rotate-social-token.py")], { encoding: "utf8", timeout: 60000 });
  const last = String(r.stdout || "").trim().split("\n").pop();
  let rows = null;
  try { rows = JSON.parse(last); } catch (e) { rows = null; }
  ok(r.status === 0 && Array.isArray(rows), "the python harness ran", { status: r.status, out: String(r.stdout).slice(-300), err: String(r.stderr).slice(-500) });
  for (const x of rows || []) ok(x.ok, "py: " + x.m, x.d);
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
