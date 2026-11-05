// CMD-CLI-POLL-1: scripts/qcli.mjs kept polling /api/cmd/job/<id> with the id of the previous poll answer (none), so every plain-English
// turn still running after the first poll ended in "error: bad id". Stub of the route: pending, running, answered; any other id is a 400.
import http from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d ? " " + JSON.stringify(d) : "")); } };

const JOB = "cmd-0123456789abcdef0123";
let polls = 0;
const urls = [];
let kindToSend = "pending";
const srv = http.createServer((q, s) => {
  q.resume();
  q.on("end", () => {
    s.setHeader("content-type", "application/json");
    if (q.method === "POST" && q.url === "/api/cmd") return s.end(JSON.stringify(kindToSend === "stream" ? { ok: true, kind: "stream", id: JOB, session_id: "run_abcdef123456", turn: 1 } : { ok: true, kind: "pending", id: JOB }));
    if (q.url.startsWith("/api/cmd/job/")) {
      urls.push(q.url);
      if (q.url !== "/api/cmd/job/" + JOB) { s.statusCode = 400; return s.end(JSON.stringify({ error: "bad id" })); }
      polls++;
      return s.end(JSON.stringify(polls < 2 ? { ok: true, status: "running" } : { ok: true, status: "answered", answer: "all good" }));
    }
    if (q.method === "POST" && q.url === "/api/cmd") return s.end("{}");
    s.statusCode = 404; s.end("{}");
  });
});
await new Promise((r) => srv.listen(0, r));
const home = mkdtempSync(join(tmpdir(), "qcli-poll-"));
mkdirSync(join(home, ".qnfo"), { recursive: true });
const cli = await new Promise((res) => execFile(process.execPath, [new URL("../scripts/qcli.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "why is it slow"], {
  env: { ...process.env, QNFO_BASE: "http://127.0.0.1:" + srv.address().port, HOME: home, USERPROFILE: home }, timeout: 20000,
}, (e, stdout, stderr) => res({ stdout, stderr: String(stderr) + (e ? String(e) : "") })));
ok(/all good/.test(cli.stdout), "a turn that is running on the first poll still prints its answer", cli);
ok(!/bad id/.test(cli.stdout + cli.stderr), "no bad id", cli);
ok(urls.length >= 2 && urls.every((u) => u === "/api/cmd/job/" + JOB), "every poll carries the job id", urls);

// RM-CMD-FAILURES-1: kind "stream" (a CodeSession turn) used to print nothing; the terminal polls the turn's job id and prints its answer.
polls = 0; urls.length = 0; kindToSend = "stream";
const cli2 = await new Promise((res) => execFile(process.execPath, [new URL("../scripts/qcli.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "refactor the widget module"], {
  env: { ...process.env, QNFO_BASE: "http://127.0.0.1:" + srv.address().port, HOME: home, USERPROFILE: home }, timeout: 30000,
}, (e, stdout, stderr) => res({ stdout, stderr: String(stderr) + (e ? String(e) : "") })));
srv.close();
ok(/all good/.test(cli2.stdout), "a code-session stream turn prints its answer from the job poll", cli2);
ok(urls.length >= 2 && urls.every((u) => u === "/api/cmd/job/" + JOB), "the stream turn is polled by its cmd id", urls);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
