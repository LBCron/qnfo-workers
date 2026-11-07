// KERNEL-EVERYWHERE-1 (2026-11-06): guard that the kernel-everywhere wiring stays in place.
// The migration was applied live to D1 qnfo-audit on 2026-11-06 (doctrine_lineage row
// kernel-8.2.1-everywhere, personal_replies table, v_agent_replies / v_false_stop_candidates
// rebuilt with the personal_replies branch). This test fails if the wiring is dropped from
// the repo while the DB still carries it, so the two cannot silently diverge.
import { readFileSync } from "node:fs";

const mig = readFileSync(new URL("../migrations/2026-11-06-kernel-everywhere.sql", import.meta.url), "utf8");
const privacy = readFileSync(new URL("../migrations/2026-11-07-kernel-personal-privacy.sql", import.meta.url), "utf8");
const personalApi = readFileSync(new URL("../personal-api/worker.js", import.meta.url), "utf8");
const companion = readFileSync(new URL("../personal-companion/worker.js", import.meta.url), "utf8");
const ask = readFileSync(new URL("../qnfo-ai-search/worker.js", import.meta.url), "utf8");
const research = readFileSync(new URL("../qnfo-research-exec/worker.js", import.meta.url), "utf8");
const claudePrompt = readFileSync(new URL("../docs/ops-governance/scripts/claude-system-prompt-canonical.txt", import.meta.url), "utf8");
const chatboxPrompt = readFileSync(new URL("../docs/ops-governance/scripts/chatbox-system-prompt-canonical.txt", import.meta.url), "utf8");

let fail = 0;
const need = (label, hay, needles) => {
  for (const n of needles) if (!hay.includes(n)) { console.log(`FAIL ${label} lost ${n}`); fail++; }
};

need("migration", mig, [
  "kernel-8.2.1-everywhere",
  "CREATE TABLE IF NOT EXISTS personal_replies",
  "'personal_replies' AS source",
  "CREATE VIEW v_false_stop_candidates",
]);
need("personal-api", personalApi, ["KERNEL-EVERYWHERE-1", "KERNEL-PERSONAL-PRIVACY-1", "recordPersonalKernelTelemetry", "personal-api.kernel"]);
need("privacy migration", privacy, ["CREATE VIEW v_agent_replies", "CREATE VIEW v_false_stop_candidates"]);
if (/INSERT[^;]*INTO personal_replies/.test(personalApi) || /FROM personal_replies/.test(privacy)) {
  console.log("FAIL personal reply text escaped the PERSONAL plane"); fail++;
}
need("personal-companion", companion, ["KERNEL-REPLY-4", "KERNEL-EVERYWHERE-1"]);
need("qnfo-ai-search", ask, ["KERNEL-REPLY-4", "KERNEL-EVERYWHERE-1"]);
need("qnfo-research-exec", research, ["KERNEL-PRODUCE-1", "KERNEL-EVERYWHERE-1"]);
need("claude-canonical-prompt", claudePrompt, ["DOCTRINE KERNEL", "KERNEL-EVERYWHERE-1"]);
need("chatbox-canonical-prompt", chatboxPrompt, ["DOCTRINE KERNEL", "KERNEL-EVERYWHERE-1"]);

console.log("kernel-everywhere: " + (fail ? fail + " failed" : "all present"));
process.exit(fail ? 1 : 0);
