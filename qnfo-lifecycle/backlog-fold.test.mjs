// BACKLOG-FOLD-1 (qnfo-lifecycle 1.8.0, agent_issues 1756) offline suite. No network, synthetic data.
// Proves: the qnfo-backlog-exec code runs unchanged as the member backlogMod (only its VERSION line and its export differ);
// the host's hourly tick runs it once a day, on the 02:00 UTC tick (its old "10 1 * * *" at the next full hour), awaited,
// with AUDIT = QNFO_AUDIT and no FLEET_FEED; the tick still runs the host's own table; GET /backlog/health is public; a
// service binding whose props name the member (qnfo-ops BACKLOG) reaches all of its routes, so qnfo-ops' drain at
// https://backlog.internal/run keeps its internal-caller gate, while the same path from the public host is not the
// member; qnfo-ops declares BACKLOG to this host with those props; runPing no longer probes the retired qnfo-archive.
// Run: node qnfo-lifecycle/backlog-fold.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync, existsSync } from "node:fs";
import { versionAtLeast } from "../scripts/version-at-least.mjs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const guest = readFileSync(new URL("../qnfo-backlog-exec/worker.js", import.meta.url), "utf8");
const opsToml = readFileSync(new URL("../qnfo-ops/wrangler.toml", import.meta.url), "utf8");
const mod = await import("data:text/javascript;base64," + Buffer.from(src + "\nexport { backlogMod as __member, BACKLOG_VERSION as __mv, VERSION as __hv, backlogDue as __due };\n").toString("base64"));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

{
  const missing = guest.split("\n").filter((l) => l.trim() && !src.includes(l.trim()));
  ok(missing.every((l) => /^var VERSION = |^export \{|^  worker_default as default$|^\/\/# sourceMappingURL/.test(l)) && missing.some((l) => l.startsWith("var VERSION = ")), "every backlog-exec line is in the host except its VERSION line and its export", missing.map((l) => l.slice(0, 60)));
  ok(versionAtLeast(mod.__hv, "1.8.0") && mod.__mv === "2.0.7-folded" && (src.match(/var VERSION = "/g) || []).length === 1, "host 1.8.0+, member 2.0.7-folded, one quoted VERSION constant", [mod.__hv, mod.__mv]);
}

{
  const t = (h, day = 7) => ({ cron: "0 * * * *", scheduledTime: Date.UTC(2026, 9, day, h, 0, 4) });
  const recent = { QNFO_AUDIT: mkDb({ ts: "2026-10-07T02:00:00.000Z" }) };
  const stale = { QNFO_AUDIT: mkDb({ ts: "2026-10-07T02:00:00.000Z" }) };
  ok(await mod.__due(t(2), {}), "due on the normal 02:00 UTC tick without a history lookup");
  ok(!await mod.__due(t(3), recent), "the recent completed daily run prevents an extra hourly drain");
  ok(await mod.__due(t(3, 8), stale), "a missed daily run is retried on the next hourly tick after 24 hours");
  ok(await mod.__due(t(3), { QNFO_AUDIT: mkDb() }), "an absent completion event triggers the initial catch-up");
  ok(!await mod.__due(Object.assign(t(2), { tickEntry: true }), recent) && !await mod.__due({ cron: "0 3 * * *", scheduledTime: Date.UTC(2026, 9, 7, 2, 0) }, recent), "not due on table entries or another trigger");
}

function mkDb(firstResult = null) {
  const sql = [];
  const prepare = (q) => { let a = []; const s = { bind(...x) { a = x; return s; }, async run() { sql.push({ q, a }); return { success: true, meta: { changes: 0 } }; }, async first() { sql.push({ q, a }); return firstResult; }, async all() { sql.push({ q, a }); return { results: [] }; } }; return s; };
  return { prepare, sql };
}
globalThis.fetch = async () => new Response("{}", { status: 200 });

{
  const real = mod.__member.scheduled;
  const calls = []; let done = false;
  mod.__member.scheduled = async (ev, env) => { calls.push(env); await new Promise((r) => setTimeout(r, 40)); done = true; };
  const env = { QNFO_AUDIT: mkDb(), FLEET_FEED: { fetch() {} } };
  await mod.default.scheduled({ cron: "0 * * * *", scheduledTime: Date.UTC(2026, 9, 7, 2, 0, 4) }, env, { waitUntil(p) { p.catch(() => {}); } });
  ok(calls.length === 1 && calls[0].AUDIT === env.QNFO_AUDIT && !("FLEET_FEED" in calls[0]), "the 02:00 tick runs the member with AUDIT = QNFO_AUDIT and no FLEET_FEED", calls.length);
  ok(done, "the handler awaits the member");
  ok(env.QNFO_AUDIT.sql.some((x) => /fleet_heartbeat/.test(x.q) && x.a[0] === "qnfo-lifecycle"), "the tick still runs the host's own hourly work");
  await mod.default.scheduled({ cron: "0 * * * *", scheduledTime: Date.UTC(2026, 9, 7, 3, 0, 4) }, { QNFO_AUDIT: mkDb({ ts: "2026-10-07T02:00:00.000Z" }) }, { waitUntil(p) { p.catch(() => {}); } });
  ok(calls.length === 1, "the 03:00 tick does not run the member");
  await mod.default.scheduled({ cron: "0 * * * *", scheduledTime: Date.UTC(2026, 9, 8, 3, 0, 4) }, { QNFO_AUDIT: mkDb({ ts: "2026-10-07T02:00:00.000Z" }) }, { waitUntil(p) { p.catch(() => {}); } });
  ok(calls.length === 2, "the hourly scheduled handler catches up when the daily member missed its tick");
  mod.__member.scheduled = real;
}

{
  const pub = "https://qnfo-lifecycle.q08.workers.dev";
  const h = await mod.default.fetch(new Request(pub + "/backlog/health"), { QNFO_AUDIT: mkDb() }, {});
  const hj = await h.json();
  ok(h.status === 200 && hj.worker === "qnfo-backlog-exec" && hj.version === "2.0.7-folded", "GET /backlog/health answers as the member", hj);
  const props = { caller: "qnfo-ops", member: "qnfo-backlog-exec" };
  const viaBinding = await mod.default.fetch(new Request("https://backlog.internal/health"), { QNFO_AUDIT: mkDb() }, { props });
  ok((await viaBinding.json()).worker === "qnfo-backlog-exec", "the qnfo-ops BACKLOG binding (member props) reaches the member's /health");
  const real = mod.__member.fetch;
  let sawRun = null;
  mod.__member.fetch = async (req, env) => { sawRun = { host: new URL(req.url).hostname, path: new URL(req.url).pathname, audit: env.AUDIT }; return new Response("{}"); };
  const env = { QNFO_AUDIT: mkDb() };
  await mod.default.fetch(new Request("https://backlog.internal/run", { method: "POST" }), env, { props });
  ok(sawRun && sawRun.host === "backlog.internal" && sawRun.path === "/run" && sawRun.audit === env.QNFO_AUDIT, "qnfo-ops' https://backlog.internal/run reaches the member unchanged (its internal-caller gate sees backlog.internal)", sawRun);
  sawRun = null;
  const pubRun = await mod.default.fetch(new Request(pub + "/run", { method: "POST" }), env, {});
  ok(sawRun === null && pubRun.status === 404, "a public POST /run does not reach the member", pubRun.status);
  await mod.default.fetch(new Request("https://backlog.internal/run", { method: "POST" }), env, { props: { caller: "evil", member: "qnfo-backlog-exec" } });
  ok(sawRun === null, "props with a caller outside qnfo-* do not reach the member");
  mod.__member.fetch = real;
}
ok(/binding = "BACKLOG"\n(#[^\n]*\n)*service = "qnfo-lifecycle"\nenvironment = "production"\nprops = \{ caller = "qnfo-ops", member = "qnfo-backlog-exec" \}/.test(opsToml), "qnfo-ops declares BACKLOG to qnfo-lifecycle with member props");
ok(!/qnfo-archive\.q08\.workers\.dev/.test(src), "runPing no longer probes the retired qnfo-archive");
ok(existsSync(new URL("../qnfo-backlog-exec/FOLDED", import.meta.url)) && existsSync(new URL("../qnfo-archive/RETIRED", import.meta.url)), "FOLDED and RETIRED markers are present");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
