// ERRATA-FOLD-1 (qnfo-research-exec 0.9.65, agent_issues 1756) offline suite. No network, synthetic data.
// Proves: the errata-hub bundle runs unchanged as the member errataMod (only its node:buffer imports, its VERSION line and
// its export line differ); the host's */15 tick runs its three jobs at their own minutes (:00 watch, :15 respond, :30
// publish; nothing at :45), each as a table entry, awaited, with PAPERS_DB = LIVING_PAPER, WATCH_DB = AUDIT_DB = QNFO_AUDIT
// and the host's GRAPH_DB, MIRROR, BROWSER, and SEND_EMAIL; GET /errata-hub/health is public; every other
// route of the member answers only a service binding whose props name it with a qnfo-* caller (the props stand in for
// ERRATA_TOKEN), and is not reachable from the public host; wrangler.toml carries nodejs_compat, BROWSER and SEND_EMAIL.
// Run: node qnfo-research-exec/errata-fold.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync, existsSync } from "node:fs";
import { versionAtLeast } from "../scripts/version-at-least.mjs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const guest = readFileSync(new URL("../errata-hub/worker.js", import.meta.url), "utf8");
const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
const mod = await import("data:text/javascript;base64," + Buffer.from(src + "\nexport { errataMod as __member, ERRATA_VERSION as __mv, VERSION as __hv, errataJobAt as __job };\n").toString("base64"));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

{
  // RENDER-SOURCE-1 (0.53.0): the member's return line also hands out renderSourceHtml (the bundle's Browser Run binding, used by the pipeline's source renderer);
  // that one extended line stands in for the guest's plain return line and nothing else in the bundle differs.
  const extReturn = "return { default: publish_worker_src_default, renderSourceHtml };";
  const missing = guest.split("\n").filter((l) => l.trim() && !src.includes(l.trim())).filter((l) => !(l.trim() === "return { default: publish_worker_src_default };" && src.includes(extReturn)));
  ok(missing.length === 4 && missing.filter((l) => l.startsWith("import { Buffer as Buffer")).length === 2 && missing.some((l) => l.startsWith("var VERSION = ")) && missing.some((l) => l === "export default {"),
    "every errata-hub line is in the host except its two node:buffer imports, its VERSION line and its export", missing.map((l) => l.slice(0, 60)));
  ok(versionAtLeast(mod.__hv, "0.9.65") && versionAtLeast(mod.__mv, "1.5.0") && (src.match(/var VERSION = "/g) || []).length === 1, "host 0.9.65 or later, member 1.4.2-folded, one quoted VERSION constant", [mod.__hv, mod.__mv]);
  ok(/^import \{ Buffer as __ErrataBuffer \} from "node:buffer";\n/.test(src), "the host imports node:buffer once for the member");
}

{
  const at = (m) => Date.UTC(2026, 9, 6, 9, m, 4);
  // TICK-10M-1 (0.18.38): each job owns the first 10 minutes of its quarter hour, so a */10 or */15 tick runs it once.
  ok(mod.__job(at(0)) === "0 * * * *" && mod.__job(at(9)) === "0 * * * *" && mod.__job(at(10)) === null && mod.__job(at(15)) === "15 * * * *" && mod.__job(at(20)) === "15 * * * *" && mod.__job(at(30)) === "30 * * * *" && mod.__job(at(40)) === null && mod.__job(at(45)) === null && mod.__job(at(50)) === null,
    "the tick maps to the member's own minutes: :00 watch, :15/:20 respond, :30 publish, nothing at :10, :40, :45, :50");
  for (const step of [10, 15]) { const seen = {}; for (let m = 0; m < 60; m += step) { const j = mod.__job(at(m)); if (j) seen[j] = (seen[j] || 0) + 1; }
    ok(seen["0 * * * *"] === 1 && seen["15 * * * *"] === 1 && seen["30 * * * *"] === 1, "every member job runs exactly once an hour on a */" + step + " tick", seen); }
}

const db = (tag) => { const s = { bind: () => s, run: async () => ({ success: true, meta: {} }), first: async () => null, all: async () => ({ results: [] }) }; return { tag, prepare: () => s }; };
const mkEnv = () => ({ LIVING_PAPER: db("living"), QNFO_AUDIT: db("audit"), GRAPH_DB: db("graph"), MIRROR: { tag: "r2" }, BROWSER: { tag: "browser" }, SEND_EMAIL: { tag: "mail" }, AI: { run: async () => ({ response: "x" }) }, RESEARCH_HALT: "1" });

{
  const real = mod.__member.scheduled;
  const calls = []; let done = false;
  mod.__member.scheduled = async (ev, env, c) => { calls.push({ ev, env }); c.waitUntil(new Promise((r) => setTimeout(() => { done = true; r(); }, 50))); };
  const env = mkEnv();
  await mod.default.scheduled({ cron: "*/15 * * * *", scheduledTime: Date.UTC(2026, 9, 6, 9, 30, 3) }, env, { waitUntil(p) { p.catch(() => {}); } });
  const c = calls[0];
  ok(calls.length === 1 && c.ev.cron === "30 * * * *" && c.ev.tickEntry === true, "the 09:30 tick runs the member's publish job as a table entry", calls.map((x) => x.ev));
  ok(c && c.env.PAPERS_DB === env.LIVING_PAPER && c.env.WATCH_DB === env.QNFO_AUDIT && c.env.AUDIT_DB === env.QNFO_AUDIT && c.env.GRAPH_DB === env.GRAPH_DB && c.env.MIRROR === env.MIRROR && c.env.BROWSER === env.BROWSER && c.env.SEND_EMAIL === env.SEND_EMAIL,
    "the member gets PAPERS_DB = LIVING_PAPER, WATCH_DB = AUDIT_DB = QNFO_AUDIT and the host's GRAPH_DB, MIRROR, BROWSER, SEND_EMAIL ");
  ok(done, "the handler awaits the member's waitUntil work");
  await mod.default.scheduled({ cron: "*/15 * * * *", scheduledTime: Date.UTC(2026, 9, 6, 9, 45, 3) }, mkEnv(), { waitUntil(p) { p.catch(() => {}); } });
  ok(calls.length === 1, "the :45 tick runs no member job");
  mod.__member.scheduled = real;
}

{
  const pub = "https://qnfo-research-exec.q08.workers.dev";
  const h = await mod.default.fetch(new Request(pub + "/errata-hub/health"), mkEnv(), {});
  const hj = await h.json();
  ok(h.status === 200 && hj.worker === "errata-hub" && versionAtLeast(hj.version, "1.5.0"), "GET /errata-hub/health answers as the member", hj);
  const confirmLimit = hj.limitations.find((limitation) => limitation.startsWith("after the sweep, up to ops_config errata_confirm_max"));
  ok(confirmLimit && confirmLimit.includes("(default 20)") && confirmLimit.includes("gpt-oss-120b then glm-5.3 for a reviser finding, deepseek-v4-flash then glm-5.3 otherwise") && !confirmLimit.includes("kimi-k2.6"),
    "the public errata health metadata reports the active model and default batch", confirmLimit);
  const props = { caller: "qnfo-ops", member: "errata-hub" };
  const viaBinding = await mod.default.fetch(new Request("https://internal/internal-errata", { method: "POST", body: "not json" }), mkEnv(), { props });
  ok(viaBinding.status === 400 && (await viaBinding.json()).error === "invalid json", "a binding with member props passes the member's token gate (POST /internal-errata reaches body validation)", viaBinding.status);
  const publicCall = await mod.default.fetch(new Request(pub + "/internal-errata", { method: "POST", body: "{}", headers: { "X-Erratta-Token": "guess" } }), mkEnv(), {});
  ok(publicCall.status === 404, "the public host does not route /internal-errata to the member", publicCall.status);
  const badCaller = await mod.default.fetch(new Request("https://internal/internal-errata", { method: "POST", body: "not json" }), mkEnv(), { props: { caller: "evil", member: "errata-hub" } });
  ok(badCaller.status === 404, "props with a caller outside qnfo-* do not reach the member", badCaller.status);
}
ok(/\ncompatibility_flags = \["nodejs_compat"\]\n/.test(toml) && /\nsend_email = \[\n  \{ name = "SEND_EMAIL" \}\n\]\n/.test(toml) && /\n\[browser\]\nbinding = "BROWSER"\n/.test(toml), "wrangler.toml carries nodejs_compat, SEND_EMAIL and BROWSER for the member");
ok(existsSync(new URL("../errata-hub/FOLDED", import.meta.url)), "errata-hub carries a FOLDED marker");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
