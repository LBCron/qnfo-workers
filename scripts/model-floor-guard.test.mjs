// MODEL-FLOOR-PREMERGE-1 (agent_issues 100121) offline suite for scripts/model-floor-guard.mjs pull-request mode. Builds a base tree and a
// head tree of worker.js files in temp directories and runs the real CLI with --base. Proves: a banned model added to a worker string
// fails with exactly that violation; debt already on the base does not fail an unrelated change; a hit that only moves lines is not new;
// an added violation in a second worker is reported with the first untouched; a missing base directory exits 2; the plain mode still
// reports the whole tree; comment mentions stay documentation. FOLDED-AND-RETIRED-MODEL-COVERAGE-1 (agent_issues 2831): a RETIRED directory is
// not scanned and a FOLDED member's findings name the host bundle. MODEL-POLICY-SINGLE-SOURCE-1 (agent_issues 2833): scripts/model-policy.json
// carries an `allowed` table the guard reads next to BANNED. PR-GUARD-FIXES-1 (agent_issues 100295): a failure to READ is not a finding - the
// repo root defaults to the directory above the script (not the owner's laptop), and an unreadable or empty root, an unreadable worker.js, a
// missing token, a failed or empty worker list and an unreadable live bundle all end the run as "cannot read" with exit 2, apart from a
// finding (exit 1). Run: node scripts/model-floor-guard.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { diffViolations, foldedHost, validateAllowed, BANNED } from "./model-floor-guard.mjs";
import * as G from "./model-floor-guard.mjs";
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } };
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "model-floor-guard.mjs");
// A value is the worker.js text, or an object of file name -> text for a directory that also carries a RETIRED or FOLDED marker.
const mk = (files) => { const root = mkdtempSync(path.join(tmpdir(), "mfg-")); for (const [w, body] of Object.entries(files)) { mkdirSync(path.join(root, w)); const fs_ = typeof body === "string" ? { "worker.js": body } : body; for (const [n, text] of Object.entries(fs_)) writeFileSync(path.join(root, w, n), text); } return root; };
const run = (head, base, extra) => { const r = spawnSync(process.execPath, [script, ...(base ? ["--base", base] : []), ...(extra || [])], { env: { ...process.env, QNFO_WORKERS: head }, encoding: "utf8" }); return { code: r.status, out: r.stdout + r.stderr }; };
const clean = 'var VERSION = "1.0.0";\nexport default { async fetch() { return new Response("ok"); } };\n';
const bad = 'var VERSION = "1.0.0";\nvar DESC = { example: "model such as llama-3.3-70b-instruct-fp8-fast" };\n';
const dirs = [];
const t = (files) => { const d = mk(files); dirs.push(d); return d; };

{ const base = t({ a: clean, b: clean }), head = t({ a: bad, b: clean });
  const r = run(head, base);
  ok(r.code === 1 && /\ba\b/.test(r.out) && /\[llama\]/.test(r.out) && /1 workers with new/.test(r.out), "a banned model added to a worker string fails the pull request", r); }
{ const base = t({ a: bad, b: clean }), head = t({ a: bad, b: clean + "// an unrelated change\n" });
  const r = run(head, base);
  ok(r.code === 0 && /0 workers with new/.test(r.out), "debt already on the base does not fail an unrelated change", r); }
{ const base = t({ a: bad }), head = t({ a: "// header comment\n// one more line\n" + bad });
  const r = run(head, base);
  ok(r.code === 0, "the same hit on a different line is not new", r); }
{ const base = t({ a: bad, b: clean }), head = t({ a: bad, b: bad });
  const r = run(head, base);
  ok(r.code === 1 && /\n {2}b\n/.test("\n" + r.out) && !/\n {2}a\n/.test("\n" + r.out), "an added violation in a second worker is reported, the first is not", r.out); }
{ const base = t({ a: bad }), head = t({ a: clean });
  const r = run(head, base);
  ok(r.code === 0, "removing a violation passes", r); }
{ const head = t({ a: clean });
  const r = run(head, path.join(tmpdir(), "mfg-does-not-exist-" + process.pid));
  ok(r.code === 2 && /base directory not found/.test(r.out), "a missing base directory exits 2 with a message", r); }
{ const head = t({ a: bad, b: clean });
  const r = run(head, null);
  ok(r.code === 1 && /REPO SOURCES \(1 workers/.test(r.out), "plain mode still reports the whole tree", r); }
{ const base = t({ a: clean }), head = t({ a: clean + '// notes: llama-3.3-70b-instruct-fp8-fast was removed from the ladder\n' });
  const r = run(head, base);
  ok(r.code === 0, "a banned model named in a trailing comment is documentation, not a violation", r); }
{ const head = [{ name: "a", hits: [{ label: "llama", line: 9, text: " x " }] }], base = [{ name: "a", hits: [{ label: "llama", line: 2, text: "x" }] }];
  ok(diffViolations(head, base).length === 0 && diffViolations(head, []).length === 1 && diffViolations([], base).length === 0, "diffViolations compares worker, label and trimmed text, not the line"); }

// ---- FOLDED-AND-RETIRED-MODEL-COVERAGE-1 (agent_issues 2831) ----
const RETIRED = "x is RETIRED (2026-10-01): not deployed.\n";
const FOLDED = "x is FOLDED into host (2026-10-06, FOLD-KIT-1): its code runs unchanged as a member inside host/worker.js.\n";
{ const head = t({ a: clean, gone: { "worker.js": bad, RETIRED } });
  const r = run(head, null);
  ok(r.code === 0 && !/^ {2}gone\b/m.test(r.out) && /1 RETIRED directories not scanned/.test(r.out), "a banned model id inside a RETIRED directory is not scanned", r); }
{ const head = t({ a: clean, gone: bad }); // the same code without the marker is a violation, so the skip is the marker's doing
  const r = run(head, null);
  ok(r.code === 1 && /^ {2}gone\b/m.test(r.out), "the same source without a RETIRED marker is still reported", r); }
{ const base = t({ a: clean }), head = t({ a: clean, gone: { "worker.js": bad, RETIRED } });
  const r = run(head, base);
  ok(r.code === 0 && /0 workers with new/.test(r.out), "pull-request mode ignores a RETIRED directory the change adds", r); }
{ const base = t({ gone: { "worker.js": bad, RETIRED } }), head = t({ gone: bad }); // the marker removed to get a hit through is a new violation
  const r = run(head, base);
  ok(r.code === 1 && /^ {2}gone\b/m.test(r.out), "removing a RETIRED marker from a directory with a banned model is reported as added", r); }
{ const head = t({ host: clean, member: { "worker.js": bad, FOLDED } });
  const r = run(head, null, ["--json"]);
  let j = {}; try { j = JSON.parse(r.out); } catch {}
  const row0 = (j.repo || []).find((x) => x.name === "member");
  ok(r.code === 1 && row0 && row0.folded === true && row0.host === "host", "a FOLDED member's finding names its host bundle", r.out);
  ok(JSON.stringify(j.artifacts) === JSON.stringify([{ artifact: "host", own: 0, members: [{ name: "member", hits: 1 }] }]), "the findings roll up per deployed artifact with the member named", j.artifacts);
  const p = run(head, null);
  ok(/member \(FOLDED into host\)/.test(p.out) && /BY DEPLOYED ARTIFACT/.test(p.out) && /host: 0 own hits; members member 1/.test(p.out), "the text report names the host and rolls the member up", p.out); }
{ const head = t({ member: { "worker.js": bad, FOLDED: "member is FOLDED (2026-10-01). Duties now run inside existing workers.\n" } });
  const r = run(head, null, ["--json"]);
  let j = {}; try { j = JSON.parse(r.out); } catch {}
  ok(r.code === 1 && j.repo && j.repo[0].folded === true && j.repo[0].host === null && j.artifacts[0].artifact === "(unnamed host)", "a FOLDED member with no named host is still scanned and rolls up under an unnamed host", r.out); }
{ const dirs2 = new Set(["idea-hub", "qnfo-idea-triage"]);
  ok(foldedHost("qnfo-ai-calibration is FOLDED into qnfo-ai-calibration (2026-10-06)", dirs2) === "qnfo-ai-calibration"
    && foldedHost("folded into qnfo-fleet-control 2026-10-01: calibratorMod is mounted at /cal", dirs2) === "qnfo-fleet-control"
    && foldedHost("Its duties live in idea-hub: idea-hub embeds the intake triage", dirs2) === "idea-hub"
    && foldedHost("Its duties live in nowhere-dir: x", dirs2) === null
    && foldedHost("its duties now run inside existing workers", dirs2) === null
    && foldedHost("", dirs2) === null, "foldedHost reads the host from the marker text and only trusts a named worker directory for the 'duties live in' form"); }

// ---- MODEL-POLICY-SINGLE-SOURCE-1 (agent_issues 2833) ----
const policyFile = path.join(path.dirname(script), "model-policy.json");
const POLICY = JSON.parse(readFileSync(policyFile, "utf8"));
{ const rows = POLICY.allowed;
  ok(Array.isArray(rows) && rows.length >= 5, "scripts/model-policy.json carries an allowed table", rows && rows.length);
  ok(Array.isArray(rows) && rows.every((r) => typeof r.id === "string" && typeof r.family === "string" && /^@cf\/[\w.-]+\/[\w.-]+$/.test(r.wa) && Number.isInteger(r.ctx) && r.ctx > 0 && typeof r.reasoning === "boolean"), "every allowed row has id, family, wa, ctx and reasoning of the right type");
  ok(Array.isArray(rows) && new Set(rows.map((r) => r.id)).size === rows.length && new Set(rows.map((r) => r.wa)).size === rows.length, "allowed ids and wa ids are unique");
  ok(Array.isArray(rows) && rows.every((r) => !BANNED.some((b) => b.re.test(r.id) || b.re.test(r.wa))), "no allowed row matches a BANNED rule");
  const gemmaBan = BANNED.find((b) => b.label === "gemma-4-26b");
  ok(gemmaBan && !gemmaBan.re.test("@cf/google/gemma-4-26b-a4b-it") && gemmaBan.re.test("@cf/google/gemma-4-26b-a4b-it-v2"), "only the evaluated Gemma 4 26B A4B instruction model is exempt from the model-floor ban");
  const qwenBan = BANNED.find((b) => b.label === "qwen3-30b");
  ok(qwenBan && !qwenBan.re.test("@cf/qwen/qwen3-30b-a3b-fp8") && qwenBan.re.test("@cf/qwen/qwen3-30b") && qwenBan.re.test("@cf/qwen/qwen3-30b-instruct"), "only the catalogued Qwen 3 30B A3B FP8 model is exempt from the model-floor ban");
  ok(Array.isArray(rows) && new Set(rows.map((r) => r.family)).size >= 4, "the allowed table keeps at least four vendor families (panels count families)"); }
{ ok(validateAllowed([{ id: "x", family: "f", wa: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", ctx: 1, reasoning: false }]).some((p) => /conflicts with BANNED \[llama\]/.test(p)), "validateAllowed rejects a row that re-admits a BANNED model");
  ok(validateAllowed([{ id: "x", family: "f", wa: "nope", ctx: 0, reasoning: "no" }]).length === 3, "validateAllowed rejects a malformed row (wa, ctx, reasoning)"); }
const pol = (rows) => { const d = mkdtempSync(path.join(tmpdir(), "mfgp-")); dirs.push(d); const f = path.join(d, "policy.json"); writeFileSync(f, JSON.stringify({ version: 1, workers: {}, allowed: rows })); return f; };
const prow = (wa) => ({ id: wa.split("/").pop(), family: "acme", wa, ctx: 1000, reasoning: true });
{ const head = t({ a: clean });
  const r = run(head, null, ["--policy", pol([prow("@cf/meta/llama-3.3-70b-instruct-fp8-fast")])]);
  ok(r.code === 2 && /MODEL POLICY/.test(r.out) && /conflicts with BANNED \[llama\]/.test(r.out), "the guard reads the allowed table and exits 2 on a row that conflicts with BANNED", r); }
{ const head = t({ a: 'var M = "@cf/zai-org/glm-5.3-flash";\nvar N = "@cf/acme/new-model-9b";\n', b: clean });
  const listed = pol([prow("@cf/zai-org/glm-5.3-flash")]);
  const r = run(head, null, ["--strict-allowed", "--policy", listed]);
  ok(r.code === 1 && /^ {2}a$/m.test(r.out) && /@cf\/acme\/new-model-9b/.test(r.out) && !/L1 @cf\/zai-org/.test(r.out), "--strict-allowed fails on a pinned @cf/ id that is not in the table and not on a listed one", r.out);
  const r2 = run(head, null, ["--unlisted", "--policy", listed]);
  ok(r2.code === 0 && /1 workers pin an @cf\/ id that is not in the allowed table of 1 models/.test(r2.out), "--unlisted reports the same id without failing the run", r2.out);
  const r3 = run(head, null, ["--strict-allowed", "--policy", pol([prow("@cf/zai-org/glm-5.3-flash"), prow("@cf/acme/new-model-9b")])]);
  ok(r3.code === 0, "adding the id to the table clears it", r3.out);
  const r4 = run(head, null);
  ok(r4.code === 0 && !/UNLISTED/.test(r4.out), "without the flags an unlisted id is not reported (the default scan is unchanged)", r4.out); }
{ const base = t({ a: 'var M = "@cf/acme/old-model-9b";\n' }), head = t({ a: 'var M = "@cf/acme/old-model-9b";\nvar N = "@cf/acme/new-model-9b";\n' });
  const r = run(head, base, ["--strict-allowed", "--policy", pol([])]);
  ok(r.code === 1 && /new-model-9b/.test(r.out) && !/old-model-9b/.test(r.out), "pull-request mode with --strict-allowed reports only the unlisted id the change adds", r.out); }
{ const head = t({ a: 'var E = "@cf/baai/bge-m3";\n// "@cf/acme/in-a-comment-9b"\nvar MODEL_RATES = { "@cf/acme/priced-9b": [1, 2] };\nvar M = "@cf/acme/real-9b"; // @cf/acme/trailing-9b\n' });
  const r = run(head, null, ["--unlisted", "--policy", pol([])]);
  ok(/real-9b/.test(r.out) && !/bge-m3|in-a-comment|priced-9b|trailing-9b/.test(r.out), "embedding ids, comments and price rows are not counted as unlisted selections", r.out); }
// ---- PR-GUARD-FIXES-1 (agent_issues 100295): a failure to read is not a finding ----
const runEnv = (env, args, cwd, pre, exe) => {
  const e = { ...process.env, ...env };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete e[k];
  const r = spawnSync(process.execPath, [...(pre || []), exe || script, ...(args || [])], { env: e, cwd: cwd || tmpdir(), encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
};
const json = (r) => { try { return JSON.parse(r.out); } catch { return {}; } };
// 1. the default root is the directory above the script: a copy of the script inside a tree scans that tree, whatever the cwd, with QNFO_WORKERS unset.
const withScript = (files) => {
  const tree = t(files);
  mkdirSync(path.join(tree, "scripts"));
  copyFileSync(script, path.join(tree, "scripts", "model-floor-guard.mjs"));
  copyFileSync(path.join(path.dirname(script), "model-policy.json"), path.join(tree, "scripts", "model-policy.json"));
  return path.join(tree, "scripts", "model-floor-guard.mjs");
};
{ const r = runEnv({ QNFO_WORKERS: undefined }, [], tmpdir(), [], withScript({ a: clean, b: bad }));
  ok(r.code === 1 && /REPO SOURCES \(1 workers/.test(r.out) && /^ {2}b$/m.test(r.out) && !/^ {2}a$/m.test(r.out) && !/repo unreadable/.test(r.out), "without QNFO_WORKERS the guard scans the tree its script sits in, from any cwd, and reports the banned model of b only", r);
  const r2 = runEnv({ QNFO_WORKERS: undefined }, [], tmpdir(), [], withScript({ a: clean }));
  ok(r2.code === 0 && /REPO SOURCES \(0 workers/.test(r2.out), "a clean tree found by the script's own location exits 0 (the old laptop path made every such run exit 1)", r2); }
{ const r = runEnv({ QNFO_WORKERS: undefined }, []);
  ok(r.code !== 2 && /== MARKERS: \d+ RETIRED directories not scanned/.test(r.out) && !/cannot read|repo unreadable/.test(r.out), "run from another cwd with QNFO_WORKERS unset, the real script reads this repository", r.out.slice(-300)); }
// 2. an unreadable or empty root is an error of its own, exit 2, never a finding and never a pass.
{ const missing = path.join(tmpdir(), "mfg-no-such-root-" + process.pid);
  const r = runEnv({ QNFO_WORKERS: missing }, []);
  ok(r.code === 2 && /^model-floor-guard: cannot read repo-root: /m.test(r.out) && r.out.includes(missing) && /ENOENT/.test(r.out) && !/REPO SOURCES|repo unreadable|MARKERS/.test(r.out), "a missing repo root exits 2 with 'cannot read repo-root' and no findings table", r);
  const rj = runEnv({ QNFO_WORKERS: missing }, ["--json"]);
  const jj = json(rj);
  ok(rj.code === 2 && Array.isArray(jj.unreadable) && jj.unreadable[0] && jj.unreadable[0].what === "repo-root" && !("repo" in jj), "--json reports the unreadable root as 'unreadable', apart from 'repo'", rj); }
{ const empty = mkdtempSync(path.join(tmpdir(), "mfg-empty-")); dirs.push(empty);
  mkdirSync(path.join(empty, "docs"));
  const r = runEnv({ QNFO_WORKERS: empty }, []);
  ok(r.code === 2 && /cannot read repo-root: .* holds no <dir>\/worker\.js/.test(r.out), "a root with no <dir>/worker.js reads nothing, so it exits 2 and not 0", r); }
{ const root = t({ a: clean }); mkdirSync(path.join(root, "b")); mkdirSync(path.join(root, "b", "worker.js")); // worker.js exists but cannot be read as a file
  const r = runEnv({ QNFO_WORKERS: root }, []);
  ok(r.code === 2 && /cannot read worker-source: /.test(r.out) && r.out.includes(path.join(root, "b", "worker.js")) && /EISDIR/.test(r.out), "a worker.js that cannot be read names the file and exits 2", r); }
{ const head = t({ a: clean });
  const r = runEnv({ QNFO_WORKERS: head }, ["--base", path.join(head, "a", "worker.js")]);
  ok(r.code === 2 && /cannot read repo-root: /.test(r.out), "--base that exists but is not a readable tree exits 2 (it used to read as an empty base and pass)", r); }
// 3. exit codes: a finding is 1, an unread input alone is 2, both is 1.
ok(typeof G.exitCode === "function" && G.exitCode(0, 0) === 0 && G.exitCode(1, 0) === 1 && G.exitCode(0, 1) === 2 && G.exitCode(2, 3) === 1, "exitCode: clean 0, a finding 1, unread input alone 2, a finding with unread input 1");
// 4. the live sweep, with an injected fetch.
const listOf = (...ids) => () => new Response(JSON.stringify({ result: ids.map((id) => ({ id })) }), { status: 200 });
const fakeFetch = (list, bundles) => {
  const calls = {};
  const f = async (url) => {
    const u = String(url); calls[u] = (calls[u] || 0) + 1;
    if (u.endsWith("/workers/scripts")) return list();
    const h = bundles[u.split("/workers/scripts/")[1].split("/")[0]];
    const out = h(calls[u]);
    if (out instanceof Error) throw out;
    return out;
  };
  f.calls = calls;
  return f;
};
const noSleep = async () => {};
const rejection = async (p) => { try { await p; return null; } catch (e) { return e; } };
if (typeof G.scanLive !== "function") ok(false, "scanLive is exported");
else {
  const f = fakeFetch(listOf("clean", "bad", "down", "net", "refused", "flaky"), {
    clean: () => new Response(clean, { status: 200 }),
    bad: () => new Response('var FILL_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";\n', { status: 200 }),
    down: () => new Response("boom", { status: 500 }),
    net: () => new Error("fetch failed"),
    refused: () => new Response("no", { status: 403 }),
    flaky: (n) => (n === 1 ? new Response("boom", { status: 502 }) : new Response(clean, { status: 200 })),
  });
  const sweep = await G.scanLive({ token: "t", fetchImpl: f, sleep: noSleep, members: {} }).catch((e) => ({ error: String(e) }));
  ok(JSON.stringify((sweep.findings || []).map((x) => x.name)) === '["bad"]', "the banned model of one live bundle is a finding", sweep);
  ok(JSON.stringify((sweep.unreadable || []).map((x) => x.name + ":" + x.why)) === '["down:HTTP 500","net:fetch failed","refused:HTTP 403"]', "bundles that answered 500, threw, or were refused are listed as unreadable with the reason, not skipped", sweep.unreadable);
  ok(sweep.scanned === 3, "scanned counts the bundles actually read (clean, bad and the one that recovered on the retry)", sweep.scanned);
  const callsFor = (n) => Object.entries(f.calls).filter(([u]) => u.includes("/workers/scripts/" + n + "/")).reduce((a, [, c]) => a + c, 0);
  ok(callsFor("down") === 2 && callsFor("net") === 2 && callsFor("flaky") === 2 && callsFor("refused") === 1 && callsFor("clean") === 1, "a 5xx or a network error is tried once more, a refusal is not", f.calls);
  const what = async (opts) => { const e = await rejection(G.scanLive(Object.assign({ sleep: noSleep, members: {} }, opts))); return e && e.what; };
  ok((await what({ token: "", fetchImpl: async () => { throw new Error("must not be called"); } })) === "live-token", "no token: the sweep throws live-token before any request");
  ok((await what({ token: "t", fetchImpl: async () => new Response(JSON.stringify({ success: false, errors: [{ code: 10000 }] }), { status: 403 }) })) === "live-list", "a refused worker list is live-list (it used to read as an empty list and pass)");
  ok((await what({ token: "t", fetchImpl: async () => new Response(JSON.stringify({ success: true }), { status: 200 }) })) === "live-list", "an answer with no result list is live-list");
  ok((await what({ token: "t", fetchImpl: async () => new Response(JSON.stringify({ result: [] }), { status: 200 }) })) === "live-list", "an empty worker list is live-list: a sweep that reads nothing is no pass");
  ok((await what({ token: "t", fetchImpl: async () => { throw new Error("offline"); } })) === "live-list", "a failed list request is live-list");
}
// 5. the CLI end to end, with the network replaced by a module loaded before the script (node --import).
{ const stubDir = mkdtempSync(path.join(tmpdir(), "mfgs-")); dirs.push(stubDir);
  const stub = path.join(stubDir, "stub-fetch.mjs");
  writeFileSync(stub, `const mode = process.env.MFG_STUB; const seen = {};
const j = (o, s) => new Response(JSON.stringify(o), { status: s || 200 });
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.endsWith("/workers/scripts")) return mode === "list-403" ? j({ success: false, errors: [{ code: 10000 }] }, 403) : j({ result: [{ id: "w-one" }, { id: "w-two" }] });
  const name = u.split("/workers/scripts/")[1].split("/")[0];
  seen[name] = (seen[name] || 0) + 1;
  const llama = 'var FILL_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";';
  if (name === "w-one" && mode === "bad-and-down") return new Response(llama, { status: 200 });
  if (name === "w-two") {
    if (mode === "down" || mode === "bad-and-down") return new Response("boom", { status: 500 });
    if (mode === "flaky" && seen[name] === 1) return new Response("boom", { status: 500 });
    if (mode === "bad") return new Response(llama, { status: 200 });
  }
  return new Response("var VERSION = '1';", { status: 200 });
};
`);
  const root = t({ a: clean });
  const pre = ["--import", pathToFileURL(stub).href];
  const live = (mode, extra) => runEnv({ QNFO_WORKERS: root, CLOUDFLARE_API_TOKEN: "t", MFG_STUB: mode }, ["--live", ...(extra || [])], tmpdir(), pre);
  let r = live("clean");
  ok(r.code === 0 && /LIVE SWEEP: 2 bundles read, 0 not read/.test(r.out), "live sweep, every bundle read and clean: exit 0", r);
  r = live("down");
  ok(r.code === 2 && /LIVE SWEEP: 1 bundles read, 1 not read/.test(r.out) && /cannot read w-two \(HTTP 500\)/.test(r.out), "live sweep with one bundle that stays down: exit 2 and the bundle is named (it used to be skipped and the run passed)", r);
  r = live("flaky");
  ok(r.code === 0 && /2 bundles read, 0 not read/.test(r.out), "a bundle that fails once and answers on the retry does not fail the sweep", r);
  r = live("bad");
  ok(r.code === 1 && /LIVE BUNDLES \(1 workers/.test(r.out) && /^ {2}w-two$/m.test(r.out), "a banned model in a live bundle is a finding: exit 1", r);
  r = live("bad-and-down");
  ok(r.code === 1 && /^ {2}w-one$/m.test(r.out) && /cannot read w-two/.test(r.out), "a finding with an unread bundle exits 1 and reports both", r);
  r = live("bad-and-down", ["--json"]);
  const jr = json(r);
  ok(r.code === 1 && Array.isArray(jr.live) && jr.live[0] && jr.live[0].name === "w-one" && jr.live_unreadable && jr.live_unreadable[0].name === "w-two" && jr.live_scanned === 1, "--json keeps 'live' as the findings list and adds live_unreadable and live_scanned", r.out.slice(0, 400));
  r = live("list-403");
  ok(r.code === 2 && /cannot read live-list: /.test(r.out) && /HTTP 403/.test(r.out), "a refused worker list exits 2 with 'cannot read live-list'", r);
  r = runEnv({ QNFO_WORKERS: root, CLOUDFLARE_API_TOKEN: undefined, MFG_STUB: "clean" }, ["--live"], tmpdir(), pre);
  ok(r.code === 2 && /cannot read live-token: /.test(r.out) && !/no CF token/.test(r.out), "--live with no token exits 2 with 'cannot read live-token' (it used to exit 1 with a sentinel row)", r); }
{ const SRC = readFileSync(script, "utf8");
  ok(!/LENOVO/.test(SRC), "the script names no machine path of the owner's laptop");
  ok(!/\(repo unreadable\)|\(no CF token\)|\(live list failed\)/.test(SRC.replace(/\/\/.*$/gm, "")), "no sentinel finding rows are built for a read failure"); }
for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(fail ? fail + " failed, " + pass + " passed" : pass + " passed, 0 failed");
process.exit(fail ? 1 : 0);
