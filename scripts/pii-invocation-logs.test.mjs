// scripts/pii-invocation-logs.test.mjs (BP26-PII-LOGS-1 and BP26-PII-LOGS-2, roadmap row 1400, agent_issues 1000344; metric pii_in_logs).
// Workers Logs "invocation logs" record every request header. Crawlers put a contact e-mail address in `User-Agent` or `From` (read from a 24 h sample of 12000 events on
// 2026-11-05: q08-signal-engine 8 matches, qnfo-ipatent 2, qnfo-ai-search 1; qnfo-gateway had 32 before BP26-PII-LOGS-1), so a worker that answers public crawlers declares
// invocation_logs = false. Application logs (console.log) stay on. This suite keeps a later wrangler.toml edit from turning them back on without a decision.
// Run: node scripts/pii-invocation-logs.test.mjs
import fs from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (x !== undefined ? "  -> " + String(x).slice(0, 300) : "")); } };

// workers that answer public traffic from crawlers (custom domains on q08.org, qnfo.org, qwav.org / qwav.tech)
const PUBLIC = ["qnfo-gateway", "qnfo-email", "q08-signal-engine", "qnfo-ipatent", "qnfo-ai-search", "idea-hub"];

function section(toml, name) {
  const lines = toml.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inside = false;
  for (const l of lines) {
    const h = /^\s*\[([^\]]+)\]\s*$/.exec(l);
    if (h) { inside = h[1].trim() === name; continue; }
    if (inside) out.push(l.replace(/#.*$/, ""));
  }
  return out.join("\n");
}

for (const w of PUBLIC) {
  const toml = fs.readFileSync(new URL("../" + w + "/wrangler.toml", import.meta.url), "utf8");
  const logs = section(toml, "observability.logs");
  ok(w + " declares [observability.logs] with logs enabled", /^\s*enabled\s*=\s*true\s*$/m.test(logs), logs);
  ok(w + " turns invocation logs off (crawler addresses stay out of Workers Logs)", /^\s*invocation_logs\s*=\s*false\s*$/m.test(logs), logs);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
