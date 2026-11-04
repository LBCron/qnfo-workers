// RELEASE-FRAGMENT-1 suite: scripts/worker_release.py makes a release (next version above main and the open pull requests, a bare VERSION line, the release note in
// <worker>/releases/, the mirror copied) without weakening version-bump-guard or mirror-guard. Run: node scripts/worker-release.test.mjs   -> prints "N passed, 0 failed"
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };
const PY = ["python3", "python"].find((p) => spawnSync(p, ["--version"], { encoding: "utf8" }).status === 0);
if (!PY) throw new Error("no python on PATH");

const root = mkdtempSync(join(tmpdir(), "wr-test-"));
const origin = join(root, "origin"), clone = join(root, "clone");
mkdirSync(origin);
const sh = (args, cwd, env = {}) => spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8", env: { ...process.env, ...env } });
const git = (cwd, ...a) => { const r = sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], cwd); if (r.status !== 0) throw new Error("git " + a.join(" ") + ": " + r.stderr); return r.stdout.trim(); };
const put = (cwd, rel, text) => { mkdirSync(dirname(join(cwd, rel)), { recursive: true }); writeFileSync(join(cwd, rel), text); };
const get = (rel) => readFileSync(join(clone, rel), "utf8");
const commit = (cwd, msg) => { git(cwd, "add", "-A"); git(cwd, "commit", "-q", "-m", msg); };

const NOTE = "/* 1.0.0 OLD-NOTE-1 (2026-11-01, pillar autonomy; patch): the previous release explained itself on the VERSION line. */";
const BODY = "export default { fetch() { return new Response(VERSION); } };\n";
const worker = (v, tail) => 'var VERSION = "' + v + '";' + (tail ? " " + tail : "") + "\n" + BODY;

git(origin, "init", "-q", "-b", "main");
git(origin, "config", "core.autocrlf", "false");
put(origin, "w/worker.js", worker("1.0.0-codeagent", NOTE));
put(origin, "w/deployed-current.worker.js", worker("1.0.0-codeagent", NOTE));
put(origin, "imp/worker.js", 'import x from "./x.js";\n' + worker("2.0.0", ""));
put(origin, "imp/deployed-current.worker.js", "// a build artifact\n" + worker("2.0.0", ""));
put(origin, "code/worker.js", 'var VERSION = "3.0.0";const V = VERSION;\n' + BODY);
put(origin, "crlf/worker.js", worker("4.0.0", "// old note").replace(/\n/g, "\r\n"));
commit(origin, "base");
const baseSha = git(origin, "rev-parse", "HEAD");
// an open pull request that already took 1.0.5
git(origin, "checkout", "-q", "-b", "pr7", baseSha);
put(origin, "w/worker.js", worker("1.0.5-codeagent", NOTE));
commit(origin, "pr7 bumps to 1.0.5");
git(origin, "update-ref", "refs/pull/7/head", "HEAD");
git(origin, "checkout", "-q", "main");
git(root, "clone", "-q", "-c", "core.autocrlf=false", origin, clone); // byte-exact checkout on Windows too
const prs = join(root, "prs.json");
writeFileSync(prs, '[{"number": 7}]');
const run = (...a) => sh([PY, join(here, "worker_release.py"), ...a, ...(a.includes("--prs-file") ? [] : ["--prs-file", prs])], clone, { WORKER_RELEASE_ROOT: clone }); // never the live GitHub list

// claims: main and the open pull request, and the next free version above both
let r = run("claims", "w", "--prs-file", prs);
ok(r.status === 0 && /main\s+1\.0\.0-codeagent/.test(r.stdout) && /pr7\s+1\.0\.5-codeagent/.test(r.stdout) && /next patch: 1\.0\.6/.test(r.stdout), "claims lists main and the open pull request and the next free version", { s: r.status, o: r.stdout, e: r.stderr });

// dry run changes nothing
r = run("bump", "w", "--note", "n", "--prs-file", prs, "--dry-run");
ok(r.status === 0 && /1\.0\.0-codeagent -> 1\.0\.6-codeagent/.test(r.stdout) && get("w/worker.js").includes('"1.0.0-codeagent"') && !existsSync(join(clone, "w/releases")), "a dry run reports the release and writes nothing", r.stdout);

// bump
r = run("bump", "w", "--note", "the release note lives in a fragment", "--name", "TEST-1", "--prs-file", prs);
ok(r.status === 0 && /1\.0\.0-codeagent -> 1\.0\.6-codeagent/.test(r.stdout), "bump takes the version above main and the open pull request, keeping the suffix", { s: r.status, o: r.stdout, e: r.stderr });
const src = get("w/worker.js");
ok(src.startsWith('var VERSION = "1.0.6-codeagent";\n' + NOTE + "\n" + BODY), "the VERSION line is bare and the old trailing comment moved, byte for byte, to the next line", src.slice(0, 260));
ok(get("w/deployed-current.worker.js") === src, "the mirror equals the source");
const frag = get("w/releases/1.0.6-codeagent.md");
ok(/^# w 1\.0\.6-codeagent \(\d{4}-\d\d-\d\d\)\n\nTEST-1: the release note lives in a fragment\n$/.test(frag), "the release note is a fragment file", frag);
ok(!src.includes("the release note lives in a fragment"), "the note is not written into worker.js");

// the guards the change must still satisfy
commit(clone, "bump w");
const g = sh([PY, join(here, "version-bump-guard.py"), "HEAD~1", "HEAD"], clone);
ok(g.status === 0 && /PASS: 1 changed worker bundle/.test(g.stdout), "version-bump-guard passes on the result", g.stdout);
const mg = sh([PY, join(here, "mirror-guard.py"), "--scope-to-diff=HEAD~1"], clone);
ok(mg.status === 0, "mirror-guard passes on the result", mg.stdout.slice(-300));

// the same version cannot be released twice
r = run("bump", "w", "--note", "again", "--to", "1.0.6-codeagent");
ok(r.status === 1 && /already exists/.test(r.stderr), "an existing fragment stops a second release of the same version", { s: r.status, e: r.stderr });

// a source with imports: the mirror is a build artifact and is left alone
r = run("bump", "imp", "--note", "n", "--minor");
ok(r.status === 0 && /2\.0\.0 -> 2\.1\.0/.test(r.stdout) && /mirror NOT copied/.test(r.stdout) && get("imp/deployed-current.worker.js").startsWith("// a build artifact"), "a source with imports keeps its mirror", r.stdout);

// code after the declaration on the same line is not a comment: left alone
r = run("bump", "code", "--note", "n");
ok(r.status === 0 && get("code/worker.js").startsWith('var VERSION = "3.0.1";const V = VERSION;\n'), "code on the VERSION line is not moved", get("code/worker.js").slice(0, 80));

// CRLF files keep their line endings
r = run("bump", "crlf", "--note", "n");
const crlf = get("crlf/worker.js");
ok(r.status === 0 && crlf.startsWith('var VERSION = "4.0.1";\r\n// old note\r\n') && !/[^\r]\n/.test(crlf), "a CRLF file keeps CRLF on every line", JSON.stringify(crlf.slice(0, 80)));

// the notes block is not edited by a release any more: the file differs from its base only on the first two lines
const base = git(clone, "show", "HEAD~1:w/worker.js").split("\n");
const now = get("w/worker.js").trimEnd().split("\n"); // git() trims its output, so trim both
ok(now.length === base.length + 1 && now.slice(2).join("\n") === base.slice(1).join("\n"), "a release touches only the VERSION line (split in two) and nothing below it");

// VERSION-LINE-NOTES-1: a bump that writes a long note onto the VERSION line is flagged (advisory; VERSION_LINE_NOTES=fail makes it a violation)
const longNote = "/* 9.9.9 LONG-NOTE-1 (2026-11-04, pillar autonomy; patch): " + "a release note written onto the VERSION line, which every release of this worker then rewrites. ".repeat(2) + "*/";
put(clone, "w/worker.js", worker("1.0.7-codeagent", longNote));
put(clone, "w/deployed-current.worker.js", worker("1.0.7-codeagent", longNote));
commit(clone, "hand bump with a note on the VERSION line");
let gr = sh([PY, join(here, "version-bump-guard.py"), "HEAD~1", "HEAD"], clone);
ok(gr.status === 0 && /::warning title=version-line-notes::w\/worker\.js: a \d+-character release note/.test(gr.stdout), "a long note written on the VERSION line is an advisory warning", { s: gr.status, o: gr.stdout });
gr = sh([PY, join(here, "version-bump-guard.py"), "HEAD~1", "HEAD"], clone, { VERSION_LINE_NOTES: "fail" });
ok(gr.status === 1 && /VERSION-LINE-NOTES-1/.test(gr.stdout), "VERSION_LINE_NOTES=fail makes it a violation", { s: gr.status, o: gr.stdout });
put(clone, "w/worker.js", worker("1.0.8-codeagent", longNote)); // the old note kept as it was, only the number moves: not a new note
put(clone, "w/deployed-current.worker.js", worker("1.0.8-codeagent", longNote));
commit(clone, "bump keeping the same trailing comment");
gr = sh([PY, join(here, "version-bump-guard.py"), "HEAD~1", "HEAD"], clone);
ok(gr.status === 0 && !/version-line-notes/.test(gr.stdout), "an unchanged trailing comment is not flagged", gr.stdout);

rmSync(root, { recursive: true, force: true });
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
