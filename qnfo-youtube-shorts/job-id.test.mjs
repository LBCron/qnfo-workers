// YT-SERVER-2 offline suite: the container entrypoint (qnfo-youtube-shorts/container/server.py) took the job id from the POST /render body and used it, unchecked, in
// shutil.rmtree(Path("/tmp/jobs") / jid) and as the render output directory: an id of "../../etc" reached a directory outside /tmp/jobs, and an absolute id replaced
// the base path altogether (pathlib drops the left side when the right side is absolute). CodeQL py/path-injection, alert 411.
// This imports the real server.py and drives its real HTTP handler on an ephemeral port, with a sentinel directory OUTSIDE the job root.
// Proves: job_dir accepts the plain ids the Worker sends (its integer row id) and refuses traversal, absolute, empty, dotted-leading, overlong, NUL, separator and
// non-string ids; POST /render answers 400 for a traversal or an absolute id and deletes and renders nothing; a plain id is accepted, its old directory is cleared and
// rendered into; no id still means the default job; the source no longer joins the raw id onto /tmp/jobs.
// Run: node qnfo-youtube-shorts/job-id.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const here = dirname(fileURLToPath(import.meta.url));
const container = join(here, "container");
const PY = (() => { for (const c of ["python3", "python"]) { const r = spawnSync(c, ["-I", "-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" }); if (r.status === 0 && String(r.stdout).trim() === "3") return c; } return null; })();
ok(PY !== null, "a python 3 interpreter is available");

const SCRIPT = String.raw`
import sys, json, tempfile, threading, time, shutil, urllib.request, urllib.error
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import server
from http.server import ThreadingHTTPServer

res = []
def ok(c, m, d=None): res.append({"ok": bool(c), "m": m, "d": d})

tmp = Path(tempfile.mkdtemp(prefix="yt-jobs-")).resolve()
server.JOBS_ROOT = tmp / "jobs"
server.JOBS_ROOT.mkdir()
root = server.JOBS_ROOT.resolve()

for good in ["1", "42", "job", "a-b_c.d", "A" * 64, "9007199254740991"]:
    d = server.job_dir(good)
    ok(d == root / good, "job_dir accepts " + good[:14], str(d))
for bad in ["../x", "..", "/etc", "/etc/passwd", "a/b", "", ".hidden", "-x", "a" * 65, "a\x00b", "a b", "x/../y", "..\\x", "a\\b", "a..", ".", None, 7, ["a"]]:
    ok(server.job_dir(bad) is None, "job_dir refuses " + repr(bad)[:26], str(server.job_dir(bad)))
(root / "link").symlink_to(tmp)  # an id that resolves out of the root through a symlink is refused too
ok(server.job_dir("link") is None, "job_dir refuses an id that resolves outside the root through a symlink")

victim = tmp / "victim"
victim.mkdir()
(victim / "keep.txt").write_text("precious")
rendered = []
def fake_render(job, outdir):
    Path(outdir).mkdir(parents=True, exist_ok=True)
    (Path(outdir) / "o.mp4").write_bytes(b"x")
    (Path(outdir) / "provenance.json").write_text(json.dumps({"ai_generated": True, "video_sha256": "abc"}))
    rendered.append(str(outdir))
    return {"path": str(Path(outdir) / "o.mp4"), "duration_s": 1}
server.render.render = fake_render

srv = ThreadingHTTPServer(("127.0.0.1", 0), server.H)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
def post(body):
    req = urllib.request.Request("http://127.0.0.1:%d/render" % port, data=json.dumps(body).encode(), method="POST", headers={"content-type": "application/json"})
    try:
        with opener.open(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())
def wait_done(jid):
    for _ in range(200):
        if server.JOBS.get(jid, {}).get("state") == "done":
            return True
        time.sleep(0.05)
    return False
def get(path):
    with opener.open("http://127.0.0.1:%d%s" % (port, path), timeout=10) as r:
        return r.status, json.loads(r.read())

for bad in ["../victim", str(victim), "../../" + victim.name, "/"]:
    st, js = post({"id": bad, "job": {}})
    ok(st == 400 and js.get("error") == "bad id", "POST /render refuses the id " + bad[-22:], [st, js])
ok((victim / "keep.txt").read_text() == "precious", "the directory outside the job root is untouched")
ok(not rendered and not server.JOBS, "no render ran and no job was recorded for a refused id", [rendered, list(server.JOBS)])

old = root / "7"
old.mkdir()
(old / "stale.txt").write_text("old")
st, js = post({"id": "7", "job": {}})
ok(st == 202 and js.get("id") == "7", "a plain id is accepted", [st, js])
ok(wait_done("7"), "the job ran to done", server.JOBS.get("7"))
ok(rendered == [str(old)], "the renderer is handed exactly the validated directory", rendered)
ok(not (old / "stale.txt").exists() and (old / "o.mp4").exists(), "a re-submitted job's old directory is cleared, then rendered into")
st, js = get("/provenance?id=7")
ok(st == 200 and js.get("ai_generated") is True and js.get("video_sha256") == "abc", "completed render provenance is available by validated job id", [st, js])
try:
    get("/provenance?id=../victim")
    ok(False, "provenance endpoint refuses traversal ids")
except urllib.error.HTTPError as e:
    ok(e.code == 400, "provenance endpoint refuses traversal ids", e.code)
st, js = post({"job": {}})
ok(st == 202 and js.get("id") == "job", "no id still means the default job id", [st, js])
ok(wait_done("job"), "the default job ran to done")
srv.shutdown()
shutil.rmtree(tmp, ignore_errors=True)
print(json.dumps(res))
`;

if (PY) {
  const r = spawnSync(PY, ["-I", "-c", SCRIPT, container], { encoding: "utf8", timeout: 90000 });
  const last = String(r.stdout || "").trim().split("\n").pop();
  let rows = null;
  try { rows = JSON.parse(last); } catch (e) { rows = null; }
  ok(r.status === 0 && Array.isArray(rows), "the python harness ran", { status: r.status, out: String(r.stdout).slice(-300), err: String(r.stderr).slice(-500) });
  for (const x of rows || []) ok(x.ok, "py: " + x.m, x.d);
}

const src = readFileSync(join(container, "server.py"), "utf8");
const code = src.replace(/"""[\s\S]*?"""/g, ""); // the docstring of job_dir quotes the old call
ok(!/rmtree\(Path\("\/tmp\/jobs"\)\s*\/\s*jid/.test(code) && !/render\.render\(job, Path\("\/tmp\/jobs"\)\s*\/\s*jid\)/.test(code), "no call still joins the raw id onto /tmp/jobs");
ok(/jdir = job_dir\(jid\)/.test(code) && /rmtree\(jdir,/.test(code) && /target=work, args=\(jid, jdir, body\["job"\]\)/.test(code) && /render\.render\(job, jdir\)/.test(code), "do_POST validates through job_dir and both removes and renders into the validated directory");
ok(/os\.path\.normpath\(os\.path\.join\(root, jid\)\)/.test(code) && /full\.startswith\(root \+ os\.sep\)/.test(code), "job_dir normalises the joined path and checks it sits under the root before any file system call on it");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
