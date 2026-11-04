#!/usr/bin/env node
// scripts/copilot-yield.mjs: COPILOT-YIELD-1 re-measure (docs/COPILOT-YIELD-2026-11.md). Turns GitHub search pages of Copilot pull requests into the
// SQL that groups them by the family of the issue they fix (qnfo-audit: gh_issue_links -> agent_issues). It makes no network call and writes nothing.
// USAGE  for p in 1 2 3 4 5 6; do gh api -X GET search/issues -f q='repo:QNFO/qnfo-workers is:pr author:app/copilot-swe-agent created:>=2026-10-30' \
//          -f per_page=100 -f page=$p > sp$p.json; done          (6 reads; pause between pages, the search API has a secondary limit)
//        node scripts/copilot-yield.mjs sp1.json sp2.json ... > q.sql    then run q.sql read-only against qnfo-audit (one LIMITed SELECT).
import { readFileSync } from "node:fs";

export function toRows(items) {
  const seen = new Set(), rows = [];
  for (const p of items) {
    if (seen.has(p.number) || p.state !== "closed") continue; seen.add(p.number);
    const m = /(?:Fixes|Closes|Resolves)\s+#(\d+)/i.exec(p.body || "");
    if (!m) continue;
    const merged = p.pull_request && p.pull_request.merged_at;
    const h = merged ? ((Date.parse(merged) - Date.parse(p.created_at)) / 3600000).toFixed(1) : "NULL";
    rows.push("(" + m[1] + "," + (merged ? 1 : 0) + "," + h + ")");
  }
  return rows;
}

export function sql(rows) {
  return "WITH pr(n,m,h) AS (VALUES " + rows.join(",") + "), j AS (SELECT pr.n,pr.m,pr.h,a.title t,(instr(a.description,'code-task:')>0) ct FROM pr JOIN gh_issue_links l ON l.gh_number=pr.n JOIN agent_issues a ON a.id=l.issue_id) "
    + "SELECT CASE WHEN t LIKE 'METRIC-TRIGGER-%' THEN 'METRIC-TRIGGER-*' WHEN instr(t,':')>0 AND instr(t,':')<40 THEN substr(t,1,instr(t,':')-1) WHEN instr(t,' ')>0 THEN substr(t,1,instr(t,' ')-1) ELSE substr(t,1,30) END fam, "
    + "count(*) prs, sum(m) merged, round(avg(h),1) avg_h_to_merge, sum(ct) with_codetask FROM j GROUP BY fam ORDER BY prs DESC LIMIT 40";
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const items = process.argv.slice(2).flatMap((f) => JSON.parse(readFileSync(f, "utf8")).items);
  console.log(sql(toRows(items)));
}
