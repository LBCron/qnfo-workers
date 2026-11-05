#!/usr/bin/env node
// qcli: the Quniverse fleet command line (CMD-VOICE-1). A thin terminal client of fleet.qnfo.org/api/cmd, which runs every
// command, tool and agent turn server-side on Cloudflare. No model vendor SDK and no local execution: the client sends
// text (or a recording for Workers AI Whisper) and prints what the fleet returns.
//   node scripts/qcli.mjs                     interactive session
//   node scripts/qcli.mjs "status"            one command
//   node scripts/qcli.mjs --audio note.webm   transcribe a recording, then run it (--no-run prints only)
//   node scripts/qcli.mjs login               email a 6-digit code and sign in (12 h session, kept in ~/.qnfo/session.json)
// In the session: /agent <text>, /tools [filter], /tool <name> {json}, /voice <file>, /mic [seconds], /run <n> (an offered
// action), /login, /logout, /quit. Anything else is sent as typed. Environment: QNFO_BASE (default https://fleet.qnfo.org),
// QNFO_LOOP_TOKEN (loop token instead of an email code), QCLI_REC_CMD (recorder template with {out} and {secs}).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BASE = (process.env.QNFO_BASE || "https://fleet.qnfo.org").replace(/\/+$/, "");
const SESSION_FILE = path.join(os.homedir(), ".qnfo", "session.json");
const MIME = { webm: "audio/webm", ogg: "audio/ogg", opus: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", mp4: "audio/mp4", flac: "audio/flac" };

let cookie = "";
try { cookie = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")).cookie || ""; } catch { /* no saved session */ }
let offered = [];

function headers(extra) {
  const h = { "x-fleet-ui": "1", ...(extra || {}) };
  if (cookie) h.Cookie = cookie;
  if (process.env.QNFO_LOOP_TOKEN) h["x-loop-token"] = process.env.QNFO_LOOP_TOKEN;
  return h;
}
function keepCookie(res) {
  const set = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const m = /^(fleet_cmd)=([^;]*)/.exec(c);
    if (!m) continue;
    cookie = m[2] ? m[1] + "=" + m[2] : "";
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ cookie }), { mode: 0o600 });
  }
}
async function call(p, init) {
  const res = await fetch(BASE + p, init);
  keepCookie(res);
  let j;
  try { j = await res.json(); } catch { j = { ok: false, error: "HTTP " + res.status }; }
  return j;
}
const post = (p, body) => call(p, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(body) });

export async function transcribe(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const buf = fs.readFileSync(file);
  return call("/api/cmd/transcribe", { method: "POST", headers: headers({ "Content-Type": MIME[ext] || "application/octet-stream" }), body: buf });
}

function show(j) {
  if (j.error) console.log("error: " + j.error);
  const t = j.text || j.answer;
  if (t) console.log(t);
  offered = Array.isArray(j.actions) ? j.actions.filter((a) => a && a.op) : [];
  offered.forEach((a, i) => console.log("  [" + (i + 1) + "] " + a.label + (a.destructive ? " (destructive)" : "") + "  -> /run " + (i + 1)));
  (j.links || []).forEach((l) => console.log("  " + l.label + ": " + l.href));
}

async function ask(rl, q) { return new Promise((r) => rl.question(q, r)); }

async function signIn(rl) {
  const c = await post("/api/cmd/code", {});
  console.log(c.note || c.error || "");
  if (!c.ok) return false;
  const v = await post("/api/cmd/verify", { code: (await ask(rl, "6-digit code: ")).trim() });
  console.log(v.text || v.error || "");
  return !!v.ok;
}

async function send(text, rl) {
  let j = await post("/api/cmd", { text, from: "" });
  // RM-CMD-FAILURES-1: kind "stream" is a CodeSession turn (qnfo-agents); the terminal does not read the event stream, it polls the turn's job id like an agent run
  // (the dashboard settles the job from the session), and waits as long as an agent run (a code-session turn takes minutes).
  if ((j.kind === "pending" || j.kind === "stream") && j.id) {
    // CMD-CLI-POLL-1: keep the job id; the poll answer carries none, so reading j.id again polled /job/undefined ("bad id").
    const jobId = j.id;
    const t0 = Date.now();
    const streamed = j.kind === "stream";
    let limit = streamed ? 1500000 : 90000;
    do {
      await new Promise((r) => setTimeout(r, streamed ? 2500 : 1200));
      j = await call("/api/cmd/job/" + jobId, { headers: headers() });
      if (j.agent) limit = Math.max(limit, 1500000); // an agent run keeps the longer window
    } while (j.status === "running" && Date.now() - t0 < limit);
    if (j.status === "running") j = { error: "Still running after " + Math.round((Date.now() - t0) / 1000) + "s; the run continues on the server (job " + jobId + ")." };
  }
  // A one-shot run without a terminal cannot answer the code prompt; say how to sign in instead of crashing (readline closed).
  if (j.need && rl && !process.stdin.isTTY) { console.log("Sign in first: node scripts/qcli.mjs login"); return show(j); }
  if (j.need && rl && (await signIn(rl))) return send(text, rl);
  show(j);
}

function record(secs) {
  const out = path.join(os.tmpdir(), "qcli-" + Date.now() + ".wav");
  const tpl = process.env.QCLI_REC_CMD || (process.platform === "win32" ? "" : "ffmpeg -y -loglevel error -f " + (process.platform === "darwin" ? "avfoundation -i :0" : "pulse -i default") + " -t {secs} {out}");
  if (!tpl) { console.log("Set QCLI_REC_CMD to a recorder, e.g. ffmpeg -y -f dshow -i audio=\"<device>\" -t {secs} {out}, or use /voice <file>."); return null; }
  const cmd = tpl.replaceAll("{secs}", String(secs)).replaceAll("{out}", JSON.stringify(out));
  console.log("Recording " + secs + "s...");
  const r = spawnSync(cmd, { shell: true, stdio: "inherit" });
  return r.status === 0 && fs.existsSync(out) ? out : (console.log("recorder failed"), null);
}

async function voice(file, rl, run) {
  const t = await transcribe(file);
  if (t.need && rl && (await signIn(rl))) return voice(file, rl, run);
  if (!t.ok) return show(t);
  console.log("heard: " + t.text);
  if (run) await send(t.text, rl);
}

async function line(s, rl) {
  const m = /^\/(\S+)\s*([\s\S]*)$/.exec(s);
  if (!m) return send(s, rl);
  const [, cmd, rest] = m;
  if (cmd === "agent") return send("agent: " + rest, rl);
  if (cmd === "tools") return send("tools " + rest, rl);
  if (cmd === "tool") return send("tool " + rest, rl);
  if (cmd === "login") return void (await signIn(rl));
  if (cmd === "logout") { await send("logout", rl); cookie = ""; return; }
  if (cmd === "voice") return voice(rest.trim(), rl, true);
  if (cmd === "mic") { const f = record(Number(rest) || 8); return f ? voice(f, rl, true) : undefined; }
  if (cmd === "run") {
    const a = offered[Number(rest) - 1];
    if (!a) return console.log("no such offered action");
    let j = await post("/api/cmd/run", { op: a.op, args: a.args });
    if (j.need && (await signIn(rl))) j = await post("/api/cmd/run", { op: a.op, args: a.args });
    return show(j);
  }
  console.log("unknown: /" + cmd + " (try /agent /tools /tool /voice /mic /run /login /logout /quit)");
}

async function main() {
  const argv = process.argv.slice(2);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (argv[0] === "--audio") return await voice(argv[1], rl, !argv.includes("--no-run"));
    if (argv[0] === "login") return void (await signIn(rl));
    if (argv.length) return await line(argv.join(" "), rl);
    console.log("Quniverse fleet command line -> " + BASE + (cookie ? " (signed in)" : " (read-only until /login)") + ". /quit to leave.");
    for (;;) {
      const s = (await ask(rl, "> ")).trim();
      if (!s) continue;
      if (s === "/quit" || s === "/exit") break;
      await line(s, rl);
    }
  } finally { rl.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
