// REACH-CANONICAL-1 (2026-11-04): reach_signals repeats one total under several entity_type rows, so a SUM without an entity_type inflated
// v_prd_funnel and v_reach_growth_7d (GA4 about 5x). New views and metric updates read v_reach_site_daily. A migration that sums
// reach_signals directly fails here unless it is on the shrink-only legacy list (entries already merged before this check).
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const LEGACY = new Set(["2026-10-14-outreach-accelerate.sql", "2026-10-14-outreach-clicks-scope.sql", "2026-10-14-paper-rollup.sql", "2026-10-19-resolve-subscriber-attribution-kpi.sql", "2026-10-25-prd-funnel-monitor.sql", "2026-11-04-outcome-northstar-2.sql", "2026-11-04-outcome-northstar-3.sql", "2026-11-04-reach-growth-view-fix.sql", "2026-11-04-reach-growth-view.sql", "2026-11-04-reader-yield-1.sql"]);
let bad = 0;
for (const f of readdirSync(DIR).filter((n) => n.endsWith(".sql"))) {
  if (LEGACY.has(f) || f === "2026-11-04-reach-site-daily.sql") continue;
  const t = readFileSync(join(DIR, f), "utf8");
  if (/FROM\s+reach_signals/i.test(t) && /\b(SUM|AVG|COUNT)\(/i.test(t) && /CREATE\s+(VIEW|TRIGGER)|UPDATE\s+metric_registry/i.test(t)) {
    console.error(f + ": sums reach_signals directly; read v_reach_site_daily (one entity_type per measure)"); bad++;
  }
}
if (bad) process.exit(1);
console.log("ok");
