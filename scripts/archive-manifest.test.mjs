// ARCHIVE-MANIFEST-1 suite (RM-REPO-DEAD-SOURCES-1, charter pillar core): a worker directory moved under archive/ keeps its RETIRED/FOLDED marker,
// has a row in archive/MANIFEST.md, has no top-level twin that could be deployed instead, and is not a deploy-targets.txt line. The same rules
// run over this checkout and over fixtures that break each rule, so the guard cannot pass vacuously.
import { readdirSync, readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0, passed = 0;
const ok = (c, m, d) => { if (c) passed++; else { failed++; console.log("FAIL " + m + (d ? " :: " + d : "")); } };

export function archivedWorkerDirs(root) {
  const base = join(root, "archive");
  if (!existsSync(base)) return [];
  return readdirSync(base).sort().filter((d) => {
    const p = join(base, d);
    try { if (!statSync(p).isDirectory()) return false; } catch (e) { return false; }
    return existsSync(join(p, "worker.js")) || existsSync(join(p, "wrangler.toml")) || existsSync(join(p, "RETIRED")) || existsSync(join(p, "FOLDED")) || existsSync(join(p, "deployed-current.worker.js"));
  });
}

function declaredName(root, d) {
  const wt = join(root, "archive", d, "wrangler.toml");
  if (!existsSync(wt)) return null;
  const m = /^\s*name\s*=\s*"([^"]+)"/m.exec(readFileSync(wt, "utf8"));
  return m ? m[1] : null;
}

// Returns the violations as "<rule> <name>: <text>" strings; empty when the archive is sound.
export function checkArchive(root) {
  const out = [];
  const dirs = archivedWorkerDirs(root);
  const manifestPath = join(root, "archive", "MANIFEST.md");
  const manifest = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : "";
  if (dirs.length && !manifest) out.push("manifest: archive/MANIFEST.md is missing");
  const targets = existsSync(join(root, "deploy-targets.txt"))
    ? readFileSync(join(root, "deploy-targets.txt"), "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#")).map((l) => l.trim().split(/\s+/))
    : [];
  for (const d of dirs) {
    if (!existsSync(join(root, "archive", d, "RETIRED")) && !existsSync(join(root, "archive", d, "FOLDED"))) out.push("marker " + d + ": archive/" + d + " has no RETIRED or FOLDED file");
    if (manifest && !manifest.includes("archive/" + d)) out.push("manifest " + d + ": no row names archive/" + d + " in archive/MANIFEST.md");
    if (existsSync(join(root, d))) out.push("twin " + d + ": a top-level " + d + "/ exists next to archive/" + d + "/");
    const n = declaredName(root, d);
    for (const t of targets) if (t[0] === d || t[0] === n || (t[1] || "").startsWith(d + "/") || (t[1] || "").startsWith("archive/" + d + "/")) out.push("deploy-targets " + d + ": deploy-targets.txt lists " + t.join(" "));
  }
  return out;
}

const real = checkArchive(repo);
ok(real.length === 0, "this checkout's archive/ is sound (marker, manifest row, no twin, no deploy target)", real.join(" | "));
ok(archivedWorkerDirs(repo).length >= 1, "the checkout holds archived worker directories, so the check above is not vacuous", String(archivedWorkerDirs(repo).length));

const root = mkdtempSync(join(tmpdir(), "archive-manifest-"));
const put = (rel, text) => { const p = join(root, ...rel.split("/")); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
try {
  put("archive/MANIFEST.md", "| archive/good | x |\n");
  put("archive/good/RETIRED", "retired\n");
  put("archive/good/wrangler.toml", 'name = "good-worker"\n');
  put("deploy-targets.txt", "# comment about good-worker good\nother other/worker.js\n");
  ok(checkArchive(root).length === 0, "a marked, listed archived directory with no twin passes");
  rmSync(join(root, "archive", "good", "RETIRED"));
  ok(checkArchive(root).some((v) => v.startsWith("marker good")), "an archived worker directory without its marker fails");
  put("archive/good/FOLDED", "folded\n");
  ok(checkArchive(root).length === 0, "a FOLDED marker also satisfies the rule");
  put("archive/unlisted/RETIRED", "retired\n");
  ok(checkArchive(root).some((v) => v.startsWith("manifest unlisted")), "an archived directory with no MANIFEST.md row fails");
  rmSync(join(root, "archive", "unlisted"), { recursive: true });
  put("good/worker.js", "x");
  ok(checkArchive(root).some((v) => v.startsWith("twin good")), "a top-level twin of an archived directory fails");
  rmSync(join(root, "good"), { recursive: true });
  put("deploy-targets.txt", "good-worker good/worker.js\n");
  ok(checkArchive(root).some((v) => v.startsWith("deploy-targets good")), "a deploy-targets.txt line naming the archived worker fails");
  put("deploy-targets.txt", "# good-worker good/worker.js is only a comment\n");
  ok(checkArchive(root).length === 0, "a comment line in deploy-targets.txt is not a target");
  rmSync(join(root, "archive", "MANIFEST.md"));
  ok(checkArchive(root).some((v) => v.startsWith("manifest:")), "archived directories with no MANIFEST.md fail");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
