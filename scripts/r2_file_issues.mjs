// Files issues from out/issues.jsonl with gh, skipping titles that already have an open issue. Cap per run is argv[3].
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [file, cap = "25"] = process.argv.slice(2);
const items = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const open = new Set(JSON.parse(execFileSync("gh", ["issue", "list", "--state", "open", "--limit", "1000", "--json", "title"], { encoding: "utf8" })).map((i) => i.title));
let made = 0, skipped = 0;
for (const it of items) {
  if (open.has(it.title)) { skipped++; continue; }
  if (made >= Number(cap)) break;
  execFileSync("gh", ["issue", "create", "--title", it.title, "--body", it.body, ...it.labels.flatMap((l) => ["--label", l])], { stdio: "inherit" });
  made++;
}
console.log(JSON.stringify({ orphans: items.length, filed: made, already_open: skipped, deferred: Math.max(0, items.length - made - skipped) }));
