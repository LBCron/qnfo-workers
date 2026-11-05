// CMD-AGENT-1 (dashboard 1.77.0): the owner's plain-English line runs the ops agent, not the no-tools RAG prompt.
// Source-shape test: it proves the routing and the poll contract exist; the live proof is POST /api/cmd as the owner answering
// kind "pending" with agent:true and /api/cmd/job/<id> showing "step n: <tool>" progress, then an answer that carries the tool trace.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
const ver = /var VERSION = "(\d+)\.(\d+)\.(\d+)"/.exec(src);
ok(ver && (Number(ver[1]) > 1 || Number(ver[2]) >= 77), "version is at least 1.77.0");
const nl = src.indexOf("// Natural language: capped AI in the background");
// RM-CODE-SESSION-1 (1.78.0) replaced the CMD-AGENT-1 banner comment that used to open this route with its own. The route still runs from that banner to the capped RAG
// answer; it now starts a resumable CodeSession first and keeps the CMD-AGENT-1 ops-agent run as the independent fallback. Without the guard below, a banner that moves
// again would leave an empty slice and every regex on it would fail with no hint why (the 2026-11-01 red).
const routeAt = src.lastIndexOf("RM-CODE-SESSION-1: only after deterministic commands", nl);
ok(routeAt >= 0 && routeAt < nl, "the owner route has its banner before the capped RAG answer");
const route = src.slice(routeAt, nl);
ok(/if \(holder\) \{/.test(route), "only the signed-in owner is routed to the agent");
ok(/op: "start"/.test(route) && /run_id: aid/.test(route) && /max_iters: 16/.test(route), "the line starts a background ops-exec run keyed by the cmd id");
ok(/kind: "pending", id: aid, agent: true/.test(route), "the page gets a pending job with agent:true");
ok(routeAt >= 0 && nl > routeAt, "the capped RAG answer stays as the fallback after the agent route");
ok(/if \(st\.json && st\.json\.ok\)/.test(route), "a failed start falls through to the grounded answer");
const sessionAt = route.search(/cmdCodeSessionFetch\(env, sessionPath/), opsAt = route.search(/op: "start"/);
ok(sessionAt >= 0 && opsAt > sessionAt && /kind: "stream"/.test(route), "RM-CODE-SESSION-1: the CodeSession start comes first and the ops-agent run is its independent fallback");
ok(/row\.kind === "agent" && row\.status === "running"/.test(src) && /cmdAgentPoll\(env, id\)/.test(src), "the job poll reads the agent run");
ok(/op: "result", id: id/.test(src) && /status=\?1, answer=\?2, error=\?3/.test(src), "a finished run is written back to cmd_log");
// RM-CMD-FAILURES-1 (1.92.0): CodeSession stream turns (kind agent-stream) are spared the 3-minute mark too and settled from their session; cmd-stream.test.mjs proves the behaviour.
ok(/kind NOT IN \('agent', 'agent-stream'\) AND ts < datetime\('now', '-3 minutes'\)/.test(src) && /kind = 'agent' AND ts < datetime\('now', '-30 minutes'\)/.test(src), "the sweep spares agent runs for 30 minutes");
ok(/j\.agent\?1500000:45000/.test(src) && /j\.progress\|\|'thinking'/.test(src), "the page polls an agent run for 25 minutes and shows its step");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
