// SLA-GAP-1 (agent_issues 1000619) offline suite. No network, synthetic data.
// Proves: the member route /sla-gap and the host route /backlog/sla-gap answer counts and at most 20 rows from the audit database, read only, and
// the member (qnfo-backlog-exec) and the host carry the same slaGap code (the twin-file rule of backlog-fold.test.mjs).
// Run: node qnfo-lifecycle/sla-gap.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const guest = readFileSync(new URL("../qnfo-backlog-exec/worker.js", import.meta.url), "utf8");
const mod = await import("data:text/javascript;base64," + Buffer.from(src + "\nexport { backlogMod as __member };\n").toString("base64"));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

const extract = (s) => { const i = s.indexOf("async function slaGap(env)"); const j = s.indexOf("\n}\n", i); return s.slice(i, j + 3); };
ok(extract(src).length > 200 && extract(src) === extract(guest), "the host and the member carry the same slaGap function");

function mkDb() {
  const sql = [];
  const prepare = (q) => {
    const s = {
      bind() { return s; },
      async first() { sql.push(q); if (/FROM v_issues_no_next_action/.test(q)) return { n: 7 }; return { n: 3 }; },
      async all() { sql.push(q); return { results: [{ id: 1, priority: "high", age_h: 5, title: "t" }] }; },
      async run() { sql.push(q); return { success: true, meta: { changes: 0 } }; }
    };
    return s;
  };
  return { prepare, sql };
}
const writes = (db) => db.sql.filter((q) => /^\s*(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)/i.test(q));

{
  const db = mkDb();
  const r = await mod.default.fetch(new Request("https://qnfo-lifecycle.q08.workers.dev/backlog/sla-gap"), { QNFO_AUDIT: db }, {});
  const j = await r.json();
  ok(r.status === 200 && j.ok === true && j.sla_gap.counts.no_doer === 7 && j.sla_gap.counts.open === 3 && Array.isArray(j.sla_gap.first20_no_doer) && j.sla_gap.first20_no_doer.length === 1, "GET /backlog/sla-gap answers counts and rows", j);
  ok(writes(db).length === 0, "the route writes nothing", writes(db));
  ok(db.sql.some((q) => /LIMIT 20/.test(q)), "the row list is capped at 20");
}
{
  const db = mkDb();
  const r = await mod.__member.fetch(new Request("https://backlog.internal/sla-gap"), { AUDIT: db }, {});
  const j = await r.json();
  ok(r.status === 200 && j.ok === true && j.sla_gap.counts.open === 3 && j.sla_gap.counts.no_doer === 7 && j.sla_gap.counts.no_owner === 3 && j.sla_gap.counts.no_next_action === 3 && j.sla_gap.counts.sla_breached === 3, "the qnfo-backlog-exec member directly serves all SLA-gap counts", j);
  ok(writes(db).length === 0, "the member route writes nothing", writes(db));
}
{
  const db = mkDb();
  const r = await mod.default.fetch(new Request("https://qnfo-lifecycle.q08.workers.dev/backlog/sla-gap", { method: "POST" }), { QNFO_AUDIT: db }, {});
  ok(r.status !== 200 || db.sql.length === 0, "a POST to /backlog/sla-gap does not reach the member's read path", r.status);
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
