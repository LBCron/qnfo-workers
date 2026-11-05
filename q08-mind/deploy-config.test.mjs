import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareDeployConfig } from "./prepare-deploy-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const configPath = join(here, "wrangler.deploy.test.toml");
const outdir = mkdtempSync(join(tmpdir(), "mind-wrangler-bundle-"));
const wranglerVersion = "3.114.17";
const sourceConfig = readFileSync(join(here, "wrangler.toml"), "utf8");
const workflow = readFileSync(join(here, "..", ".github", "workflows", "mind-deploy.yml"), "utf8").replace(/\r\n/g, "\n");
const configMain = sourceConfig.match(/^main\s*=\s*"([^"]+)"/m)?.[1];
const configName = sourceConfig.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
const compatibilityDate = sourceConfig.match(/^compatibility_date\s*=\s*"([^"]+)"/m)?.[1];
const workerSource = readFileSync(join(here, configMain || "missing"), "utf8");
const version = workerSource.match(/^var VERSION = "([^"]+)";$/m)?.[1];
const imports = [...workerSource.matchAll(/from\s+["'](\.\/data\/[^"']+\.json)["']/g)].map((match) => match[1]);
const generatedConfig = prepareDeployConfig(sourceConfig);
const generatedName = generatedConfig.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
const generatedMain = generatedConfig.match(/^main\s*=\s*"([^"]+)"/m)?.[1];
const generatedCompatibilityDate = generatedConfig.match(/^compatibility_date\s*=\s*"([^"]+)"/m)?.[1];
const healthProbe = workflow.split("      - name: Verify the live version from the runner\n")[1] || "";
const apiUpload = workflow.split("      - name: Upload the module bundle through the scripts api\n")[1]?.split("\n      - name:")[0] || "";

assert.ok(configMain, "q08-mind/wrangler.toml declares a main entrypoint");
assert.ok(configName, "q08-mind/wrangler.toml declares a Worker name");
assert.ok(compatibilityDate, "q08-mind/wrangler.toml declares a compatibility date");
// MIND-DIR-CONVERGE-1 (0.33.2) renamed the checked-in identity to the production name; the invariant that matters is that
// the GENERATED config targets q08-mind (asserted next), not that the source still carries the old placeholder.
assert.ok(configName === "mind" || configName === "q08-mind", "the checked-in Wrangler file names the placeholder or the converged production identity");
assert.equal(generatedName, "q08-mind", "the generated config targets the production Worker");
assert.equal(generatedMain, "worker.js", "the generated main resolves relative to q08-mind/");
assert.equal(join(here, generatedMain), join(here, "worker.js"));
assert.equal(generatedCompatibilityDate, compatibilityDate, "the generated config keeps the source date");
assert.match(sourceConfig, /^\[observability\.traces\]\r?\nenabled = false$/m, "the source preserves its explicit trace-off setting");
assert.match(generatedConfig, /^\[observability\]\nenabled = false$/m, "the generated config uses Wrangler 3's supported disabled observability setting");
assert.doesNotMatch(generatedConfig, /^\[observability\.traces\]/m, "the generated config omits Wrangler 3's unsupported traces table");
assert.doesNotMatch(generatedConfig, /^routes\s*=/m, "the generated fallback has no placeholder routes");
assert.equal(imports.length, 4, "worker.js imports both corpus JSON modules, the book list (MIND-BOOKS-1) and the video list (COMPANION-NO-TYPING-1:videos)");
assert.equal(readFileSync(join(here, "deployed-current.worker.js"), "utf8"), workerSource, "deployed-current.worker.js mirrors the deploy source exactly");
assert.match(workerSource, /const CAPABILITIES = \["reading-list", "evidence-graded-corpus", "shelves", "entry-pages", "json-api", "rss-feed", "sitemap", "book-list", "daily-pick", "video-pick"\];/, "the Worker declares its actual read-only capabilities");
assert.match(workerSource, /const LIMITATIONS = \["static, read-only content with no accounts or tracking", "no model inference, data bindings, or outbound requests"\];/, "the Worker declares its runtime limitations");
assert.match(workerSource, /version: VERSION, capabilities: CAPABILITIES, limitations: LIMITATIONS/, "the public health contract advertises both non-empty arrays");
for (const modulePath of imports) {
  assert.ok(existsSync(join(here, modulePath)), `imported JSON module exists: ${modulePath}`);
}
assert.ok(version, "q08-mind/worker.js declares its current version");

writeFileSync(configPath, generatedConfig);
try {
  const npxArgs = [
    "--yes",
    `wrangler@${wranglerVersion}`,
    "deploy",
    "--dry-run",
    "--outdir",
    outdir,
    "--config",
    configPath,
  ];
  const command = process.platform === "win32" ? process.execPath : "npx";
  const args = process.platform === "win32"
    ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js"), ...npxArgs]
    : npxArgs;
  const output = execFileSync(
    command,
    args,
    { cwd: root, encoding: "utf8" },
  );
  assert.match(output, new RegExp(`wrangler ${wranglerVersion}`), "the generated config validates with the pinned Wrangler release");
  const bundlePath = join(outdir, "worker.js");
  assert.ok(existsSync(bundlePath), "Wrangler emits the bundled API upload entrypoint");
  const bundle = readFileSync(bundlePath, "utf8");
  assert.doesNotMatch(bundle, /from\s+["']\.\/data\/(?:entries-[ab]|books)\.json["']/, "the bundle contains no unresolved JSON imports");
  assert.ok(bundle.includes(version), "the bundle contains the source version used by the live probe");
  for (const modulePath of imports) {
    const corpus = JSON.parse(readFileSync(join(here, modulePath), "utf8"));
    assert.ok(bundle.includes(corpus[0].s), `the bundle includes content from ${modulePath}`);
  }
} finally {
  rmSync(configPath, { force: true });
  rmSync(outdir, { recursive: true, force: true });
}

assert.match(workflow, /node q08-mind\/prepare-deploy-config\.mjs q08-mind\/wrangler\.toml q08-mind\/wrangler\.deploy\.toml/, "workflow generates the same config tested here");
assert.match(workflow, new RegExp(`npx --yes wrangler@${wranglerVersion} deploy --dry-run --outdir "\\$GITHUB_WORKSPACE/q08-mind/\\.deploy" --config q08-mind/wrangler\\.deploy\\.toml`), "workflow bundles with the validated Wrangler version");
assert.match(apiUpload, /"main_module":"worker\.js","compatibility_date":"%s","observability":\{"enabled":false\}/, "API metadata matches the generated config");
assert.match(apiUpload, /workers\/scripts\/q08-mind/, "API upload targets the production Worker");
assert.match(apiUpload, /worker\.js=@q08-mind\/\.deploy\/worker\.js;type=application\/javascript\+module/, "API upload uses the supported JavaScript module MIME");
assert.doesNotMatch(apiUpload, /application\/json.*entries-[ab]\.json/, "the API part MIME is not the rejected raw JSON MIME");
assert.doesNotMatch(apiUpload, /entries-[ab]\.json/, "API upload does not send raw JSON modules");
assert.match(apiUpload, /json\.load\(open\("\/tmp\/mind-deploy\.json"\)\)\.get\("success"\) is True/, "HTTP 200 also requires API success=true");
assert.match(workflow, /if: steps\.api\.outputs\.api_upload != 'ok'/, "Wrangler deploy runs only after API upload failure");
assert.match(workflow, new RegExp(`npx --yes wrangler@${wranglerVersion} deploy --config q08-mind/wrangler\\.deploy\\.toml`), "fallback uses the same pinned Wrangler release");
assert.match(workflow, /META=.*compatibility_date.*COMPATIBILITY_DATE/, "API metadata reads the source compatibility date");
assert.match(workflow, /EXPECTED_VERSION=\$\(sed .*q08-mind\/worker\.js\)/, "health probe derives the expected version from worker.js");
assert.match(workflow, /d\.get\("ok"\) is True and d\.get\("worker"\) == "q08-mind" and d\.get\("version"\) == os\.environ\["EXPECTED_VERSION"\]/, "health probe verifies Worker identity and the exact current version");
assert.ok(!healthProbe.includes(version), "health probe derives its expected version instead of pinning it");

console.log(`mind deploy regression checks passed (Wrangler ${wranglerVersion}, ${imports.length} bundled JSON modules, version ${version})`);
