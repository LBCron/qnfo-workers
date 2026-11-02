// REVISER-FOLD-1 (qnfo-research-exec 0.9.64, agent_issues 1756) offline suite. No network, synthetic data.
// Proves: the qnfo-paper-reviser code runs as the member reviserMod (VERSION/export differ, and PAPER-FORMAT-2
// replaces the retired layout normalizer); the host's */15 tick runs it at :30 of every fourth UTC hour with
// PAPERS_DB = LIVING_PAPER, WATCH_DB = QNFO_AUDIT and its AI calls attributed to qnfo-paper-reviser, and the handler awaits
// it; GET /reviser/health is public; its /run/* and /debug/* routes answer only a service binding whose props name the
// member with a qnfo-* caller (the props stand in for X-Reviser-Token, #1703) and are not reachable otherwise; the
// dashboard's SVC_QNFO_PAPER_REVISER binding is declared to this host with those props.
// Run: node qnfo-research-exec/reviser-fold.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync, existsSync } from "node:fs";
import { versionAtLeast } from "../scripts/version-at-least.mjs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const guest = readFileSync(new URL("../qnfo-paper-reviser/worker.js", import.meta.url), "utf8");
const dash = readFileSync(new URL("../qnfo-fleet-dashboard/wrangler.toml", import.meta.url), "utf8");
const mod = await import("data:text/javascript;base64," + Buffer.from(src + "\nexport { reviserMod as __member, REVISER_VERSION as __mv, VERSION as __hv, reviserDue as __due };\n").toString("base64"));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

{
  const legacy = /\/\/ REVISED-STANDARD-1[\s\S]*?__name\(standardizeBody, "standardizeBody"\);/;
  ok(legacy.test(guest) && /function standardizeBody\(md, title\) \{\s*return formatPaper\(md, \{ title \}\)\.body;/.test(src), "only the retired standardizer is replaced by the shared canonical formatter");
  const missing = guest.replace(legacy, "").split("\n").filter((l) => l.trim() && !src.includes(l.trim()));
  ok(missing.every((l) => /^var VERSION = |^export \{|^  worker_default as default,|^  recordFlaggedErrata|^\};|^\/\/# sourceMappingURL/.test(l)) && missing.some((l) => l.startsWith("var VERSION = ")), "every reviser line is in the host except its VERSION line and its export block", missing.map((l) => l.slice(0, 60)));
  ok(versionAtLeast(mod.__hv, "0.9.64") && versionAtLeast(mod.__mv, "1.3.0") && (src.match(/var VERSION = "/g) || []).length === 1, "host 0.9.64+, member 1.2.8-folded, one quoted VERSION constant", [mod.__hv, mod.__mv]);
}

// cadence
{
  const at = (h, m) => Date.UTC(2026, 9, 6, h, m, 5);
  ok(mod.__due(at(0, 30)) && mod.__due(at(4, 30)) && mod.__due(at(20, 30)), "due at :30 of hours 0, 4, 20");
  ok(!mod.__due(at(0, 15)) && !mod.__due(at(0, 45)) && !mod.__due(at(1, 30)) && !mod.__due(at(5, 30)), "not due at :15, :45 or other hours");
  for (const step of [10, 15]) { let n = 0; for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += step) if (mod.__due(at(h, m))) n++;
    ok(n === 6, "six runs a day on a */" + step + " tick, as the old 37 */4 (TICK-10M-1)", n); }
}

function mkDb(tag) {
  const sql = [];
  const prepare = (q) => { let a = []; const s = { bind(...x) { a = x; return s; }, async run() { sql.push({ q, a }); return { success: true, meta: { changes: 0 } }; }, async first() { sql.push({ q, a }); return { n: 3 }; }, async all() { sql.push({ q, a }); return { results: [] }; } }; return s; };
  return { tag, prepare, sql };
}
const mkEnv = () => ({ LIVING_PAPER: mkDb("living"), QNFO_AUDIT: mkDb("audit"), AI: { run: async () => ({ response: "x" }) }, RESEARCH_HALT: "1" });

// the tick runs the member with the mapped bindings, attributes its AI, and awaits it
{
  const real = mod.__member.scheduled;
  const calls = [];
  let done = false;
  mod.__member.scheduled = async (ev, env) => { calls.push(env); await new Promise((r) => setTimeout(r, 40)); done = true; };
  const env = mkEnv();
  await mod.default.scheduled({ cron: "*/15 * * * *", scheduledTime: Date.UTC(2026, 9, 6, 8, 30, 4) }, env, { waitUntil(p) { p.catch(() => {}); } });
  const e = calls[0];
  ok(calls.length === 1 && e.PAPERS_DB === env.LIVING_PAPER && e.WATCH_DB === env.QNFO_AUDIT, "the 08:30 tick runs the member with PAPERS_DB = LIVING_PAPER and WATCH_DB = QNFO_AUDIT", calls.length);
  ok(e && e.__aiAttr === 1 && e.AI !== env.AI, "the member's AI binding is wrapped for attribution");
  ok(done, "the handler awaits the member's run");
  await mod.default.scheduled({ cron: "*/15 * * * *", scheduledTime: Date.UTC(2026, 9, 6, 9, 30, 4) }, mkEnv(), { waitUntil(p) { p.catch(() => {}); } });
  ok(calls.length === 1, "the 09:30 tick does not run the member");
  mod.__member.scheduled = real;
  // attribution: an AI call inside the member is counted for qnfo-paper-reviser
  const env2 = mkEnv(); let seen = null;
  mod.__member.scheduled = async (ev, en) => { await en.AI.run("@cf/x/y", { messages: [{ role: "user", content: "hi" }] }); };
  await mod.default.scheduled({ cron: "*/15 * * * *", scheduledTime: Date.UTC(2026, 9, 6, 12, 30, 4) }, env2, { waitUntil(p) { p.catch(() => {}); } });
  seen = env2.QNFO_AUDIT.sql.find((x) => /INSERT INTO ai_call_counters/.test(x.q));
  ok(seen && seen.a[1] === "qnfo-paper-reviser", "a member AI call is attributed to qnfo-paper-reviser", seen && seen.a);
  mod.__member.scheduled = real;
}

// routes
{
  const host = "https://qnfo-research-exec.q08.workers.dev";
  const h = await mod.default.fetch(new Request(host + "/reviser/health"), mkEnv(), {});
  const hj = await h.json();
  ok(h.status === 200 && hj.worker === "qnfo-paper-reviser" && versionAtLeast(hj.version, "1.3.0"), "GET /reviser/health answers as the member", hj);
  const props = { caller: "qnfo-fleet-dashboard", member: "qnfo-paper-reviser" };
  const st = await mod.default.fetch(new Request("https://internal/run/status"), mkEnv(), { props });
  const sj = await st.json();
  ok(st.status === 200 && sj.worker === "qnfo-paper-reviser" && sj.published_total === 3, "a binding with member props reaches /run/status, authenticated by the props", sj);
  const noProps = await mod.default.fetch(new Request(host + "/run/status"), mkEnv(), {});
  ok(noProps.status === 404, "without the props /run/status is the host's 404, not the member", noProps.status);
  const badCaller = await mod.default.fetch(new Request("https://internal/run/status"), mkEnv(), { props: { caller: "evil", member: "qnfo-paper-reviser" } });
  ok(badCaller.status === 404, "props with a caller outside qnfo-* do not reach the member", badCaller.status);
  const tok = await mod.default.fetch(new Request(host + "/run/scan?mode=live", { headers: { "X-Reviser-Token": "guess" } }), mkEnv(), {});
  ok(tok.status === 404, "a public /run/scan with a guessed token is not routed to the member", tok.status);
}
ok(/binding = "SVC_QNFO_PAPER_REVISER"\n(#[^\n]*\n)*service = "qnfo-research-exec"\nenvironment = "production"\nprops = \{ caller = "qnfo-fleet-dashboard", member = "qnfo-paper-reviser" \}/.test(dash), "the dashboard's SVC_QNFO_PAPER_REVISER is declared to qnfo-research-exec with member props");
ok(existsSync(new URL("../qnfo-paper-reviser/FOLDED", import.meta.url)), "qnfo-paper-reviser carries a FOLDED marker");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
