// NO-STANDALONE-DOCS-1 / DOC-IS-CODE-1 runtime half (owner directive 2026-11-06).
// doc_audit.py only sees docs/ in this repo. This audits documents that sit in R2 (qnfo-projects, qnfo-ddocs) and
// files each unimplemented one as a roadmap row + issue body that carries `code-task:` and `code-probe:` lines.
// Pure functions are exported for tests; the CLI reads a key list (JSON lines {bucket,key,size}) and a source blob.
//   node scripts/r2_doc_audit.mjs --keys keys.jsonl --src-dir . [--emit out/]
// Writes nothing to Cloudflare. Exit 1 with --strict when orphans exist.
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

export const DOC_EXT = /\.(md|txt|pdf)$/i;
export const SKIP = /(^|\/)(_manifests|_agent-results|node_modules|\.git)\//;
export const SRC_EXT = /\.(js|mjs|py|sql|ya?ml|toml|json|sh)$/;
const RULE_ID = /\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)*-\d+\b/g;

// Generic names (paper.md, README.md, PROJECT-PLAN.md ...) appear in unrelated source text; they count only by full key.
export const GENERIC = /^(paper|paper-v[\d.]+|readme|project-plan|handoff|index|test|notes|synthesis|artifacts?)\.(md|txt|pdf)$/i;

export function isDoc(key) { return DOC_EXT.test(key) && !SKIP.test(key); }

/** A doc is implemented when its file name, its key, or one of its rule ids appears in non-doc source. */
export function classify(docs, srcBlob, texts = {}) {
  return docs.filter((d) => isDoc(d.key)).map((d) => {
    const stem = basename(d.key);
    const ids = [...new Set((texts[d.key] || "").match(RULE_ID) || [])];
    const hitPath = GENERIC.test(stem) ? srcBlob.includes(d.key) : (srcBlob.includes(stem) || srcBlob.includes(d.key));
    const hitIds = ids.filter((i) => srcBlob.includes(i));
    return { bucket: d.bucket, key: d.key, size: d.size ?? 0, rule_ids: ids.length, ids_in_code: hitIds.length, path_in_code: hitPath, orphan: !hitPath && !hitIds.length };
  });
}

/** One issue body per orphan: problem, files, acceptance, code-task and a probe that fails until code cites the doc. */
export function issueFor(o) {
  const stem = basename(o.key);
  return {
    title: `DOC-IS-CODE-1: implement or retire R2 document ${o.bucket}/${o.key}`,
    labels: ["doc-orphan", "code-task"],
    body: [
      `Problem: \`r2://${o.bucket}/${o.key}\` (${o.size} bytes) is cited by no worker, script, migration or workflow (NO-STANDALONE-DOCS-1).`,
      `Acceptance: code that uses what the document specifies lands (a rule, probe, metric, migration or worker change) and cites \`${stem}\`, or the document is retired with the reason recorded in the PR.`,
      `code-task: scripts/ or the owning worker's worker.js; name the file in the PR and cite ${stem}`,
      `code-probe: node scripts/r2_doc_audit.mjs --keys <r2-keys.jsonl> --src-dir . --strict reports no orphan for ${o.bucket}/${o.key}`,
      `Pillar: core. Doer: the code loop (qnfo-code-orchestrator). Metric: orphan count in the weekly r2-doc-audit run falls.`,
    ].join("\n\n"),
  };
}

export function roadmapRow(o) {
  return { id: "DOC-" + basename(o.key).replace(/[^A-Za-z0-9]+/g, "-").toUpperCase().slice(0, 48), source: `r2://${o.bucket}/${o.key}`, status: "open", doer: "qnfo-code-orchestrator", probe: "r2_doc_audit orphan=false" };
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === ".git" || n === "node_modules") continue;
    const p = join(dir, n); const s = statSync(p);
    if (s.isDirectory()) walk(p, out); else if (SRC_EXT.test(n) && s.size < 3_000_000) out.push(p);
  }
  return out;
}

function arg(name, def) { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : def; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const keys = readFileSync(arg("--keys"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const textsPath = arg("--texts");
  const texts = textsPath ? JSON.parse(readFileSync(textsPath, "utf8")) : {};
  const blob = walk(arg("--src-dir", ".")).map((f) => readFileSync(f, "utf8")).join("\n");
  const rows = classify(keys, blob, texts);
  const orphans = rows.filter((r) => r.orphan);
  const emit = arg("--emit");
  if (emit) {
    mkdirSync(emit, { recursive: true });
    writeFileSync(join(emit, "issues.jsonl"), orphans.map((o) => JSON.stringify(issueFor(o))).join("\n") + "\n");
    writeFileSync(join(emit, "roadmap.jsonl"), orphans.map((o) => JSON.stringify(roadmapRow(o))).join("\n") + "\n");
  }
  for (const r of rows) console.log(JSON.stringify(r));
  console.error(JSON.stringify({ summary: { docs: rows.length, orphans: orphans.length } }));
  process.exit(orphans.length && process.argv.includes("--strict") ? 1 : 0);
}
