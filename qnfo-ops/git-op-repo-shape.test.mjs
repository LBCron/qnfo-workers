// GIT-OP-REPO-SHAPE-1 (qnfo-ops 2.57.6, agent_issues 1000405) and GIT-OP-HARDEN-1 (qnfo-ops 2.58.0, the independent review of 2.57.6) offline suite. No network: fetch is a stub that, like Workers' fetch,
// parses the URL string with the WHATWG URL parser before it records it, so a dot segment that survives into the string is seen collapsed, as GitHub would receive it.
// 2.57.6: git_op answered "repo (owner/name) required" for {owner:"QNFO", repo:"qnfo-workers", op:"show", ref:"main:qnfo-code-orchestrator/worker.js"}; git_op and github_cherry_pick now accept {owner, repo},
// git_op resolves an empty repo to QNFO/qnfo-workers and a bare name to QNFO/<name>, and git_op show <rev>:<path> reads that file at that revision. A write never defaults a repository.
// 2.58.0: a "." or ".." segment never reaches the URL (git_op show main:../../../../user/repos used to read GET /user/repos with the token); a repo with a leading dot (QNFO/.github) is accepted;
// an owner that contradicts a slashed repo, or an owner alone, is refused on a read and on a write; show <rev>: lists the root; a file over 256 KB or 1 MB is read as raw text in windows
// (maxChars 1-200000, offset, next_offset); a 404 names the repo, ref and path; the catalogue describes what the code reads.
// Run: node qnfo-ops/git-op-repo-shape.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
const grab = (start, end) => { const i = src.indexOf(start), j = src.indexOf(end, i); return i >= 0 && j > i ? src.slice(i, j) : ""; };
const parts = [
  grab("function decodeBase64(b64) {", "\n__name(decodeBase64"),
  grab("async function githubApi(env, method, path, body) {", "\n__name(githubApi"),
  grab("function encPath(s) {", "\n__name(encPath"),
  grab("var GIT_REPO_RE =", "async function githubCherryPick(env, args) {"),
  grab("async function githubCherryPick(env, args) {", "\n__name(githubCherryPick"),
  grab("async function gitOp(env, args) {", "\n__name(gitOp"),
];
ok(parts.every((p) => p.length > 30), "decodeBase64, githubApi, encPath, the repo helpers, githubCherryPick and gitOp are found in worker.js", parts.map((p) => p.length));
let calls = [], rawCalls = [];
let responder = () => new Response("{}", { status: 404 });
globalThis.fetch = async (url, init) => {
  const href = new URL(String(url)).href; // what the network would receive
  (init && init.headers && /raw/.test(init.headers.Accept || "") ? rawCalls : calls).push(href);
  return responder(href, init || {});
};
const { gitOp, githubCherryPick, gitRepoArg, gitRepoError, encPath } = new Function("__name22222", parts.join("\n") + "\nreturn { gitOp, githubCherryPick, gitRepoArg, gitRepoError, encPath };")((f) => f);
const env = { GITHUB_TOKEN: "t" };
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json" } });
const file = (text, extra) => J({ type: "file", encoding: "base64", content: Buffer.from(text).toString("base64"), size: Buffer.byteLength(text), sha: "abc123", ...(extra || {}) });
const commit = { sha: "0123456789abcdef", commit: { message: "m\nbody", author: { name: "n", date: "d" } }, files: [] };
const onlyApiHost = (list) => list.every((u) => u.startsWith("https://api.github.com/repos/"));

{ // the call that filed the issue
  calls = []; responder = () => file("export default {};\n");
  const r = await gitOp(env, { owner: "QNFO", repo: "qnfo-workers", op: "show", ref: "main:qnfo-code-orchestrator/worker.js" });
  ok(r.ok === true && r.type === "file" && r.repo === "QNFO/qnfo-workers" && r.ref === "main" && r.path === "qnfo-code-orchestrator/worker.js", "the failing call reads the file at main", r);
  ok(r.content === "export default {};\n" && r.truncated === false && r.sha === "abc123" && r.offset === 0 && r.chars === 19, "the file body is decoded, whole, with its window", r);
  ok(calls.length === 1 && calls[0] === "https://api.github.com/repos/QNFO/qnfo-workers/contents/qnfo-code-orchestrator/worker.js?ref=main", "one request goes to the contents API at ref=main", calls);
}
{ // windows
  calls = []; responder = () => file("0123456789".repeat(5));
  let r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main:a.txt", maxChars: 10 });
  ok(r.ok === true && r.content === "0123456789" && r.truncated === true && r.next_offset === 10 && r.chars === 50, "maxChars cuts the body, says so and names the next offset", r);
  r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main:a.txt", maxChars: 10, offset: 45 });
  ok(r.content === "56789" && r.truncated === false && r.next_offset === undefined && r.offset === 45, "offset starts the window and the last window is not truncated", r);
  r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main:a.txt", maxChars: -3 });
  ok(r.ok === true && r.content.length === 1, "a negative maxChars is clamped to 1, not read as a cut from the end", r);
  r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main:a.txt", maxChars: 9e9, offset: -5 });
  ok(r.ok === true && r.content.length === 50 && r.offset === 0, "maxChars is capped at 200000 and a negative offset at 0", r);
}
{ // large files are read as raw text
  calls = []; rawCalls = [];
  const big = "line of text\n".repeat(30000); // 390000 bytes
  responder = (href, init) => /raw/.test((init.headers || {}).Accept || "") ? new Response(big, { status: 200 }) : J({ type: "file", encoding: "base64", content: "AAAA", size: big.length, sha: "bigsha" });
  let r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main:big.js", maxChars: 26, offset: 13 });
  ok(r.ok === true && r.content === "line of text\nline of text\n" && r.chars === big.length && r.truncated === true && r.next_offset === 39 && rawCalls.length === 1, "a file over 256 KB is read as raw text, in a window", { r, rawCalls });
  ok(rawCalls[0] === "https://api.github.com/repos/QNFO/qnfo-workers/contents/big.js?ref=main", "the raw request is the same contents URL", rawCalls);
  rawCalls = [];
  responder = (href, init) => /raw/.test((init.headers || {}).Accept || "") ? new Response("x".repeat(1500000), { status: 200 }) : J({ type: "file", encoding: "none", content: "", size: 1500000, sha: "huge" });
  r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main:huge.js" });
  ok(r.ok === true && r.chars === 1500000 && r.content.length === 20000 && r.truncated === true, "a file over the contents API's 1 MB (encoding none) is read, not reported empty", r.error || r.chars);
  responder = () => J({ type: "file", encoding: "none", content: "", size: 6e6, sha: "x" });
  r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main:enormous.bin" });
  ok(r.ok === false && /over the 5 MB read limit/.test(r.error), "a file over 5 MB is refused with its size", r);
  responder = (href, init) => /raw/.test((init.headers || {}).Accept || "") ? new Response('{"message":"Not Found"}', { status: 404 }) : J({ type: "file", encoding: "none", content: "", size: 2e6, sha: "x" });
  r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main:gone.js" });
  ok(r.ok === false && /GitHub 404 reading gone\.js as raw text/.test(r.error), "a failed raw read says so", r);
}
{ // directories and the root
  calls = []; responder = () => J([{ name: "worker.js" }, { name: "wrangler.toml" }]);
  let r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main:qnfo-ops" });
  ok(r.ok === true && r.type === "dir" && r.entries.join() === "worker.js,wrangler.toml", "a directory path lists its entries", r);
  calls = [];
  r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main:" });
  ok(r.ok === true && r.type === "dir" && r.path === "" && calls[0] === "https://api.github.com/repos/QNFO/qnfo-workers/contents?ref=main", "show <rev>: lists the repository root", { r, calls });
  calls = [];
  r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main:." });
  ok(r.ok === true && r.path === "" && calls[0] === "https://api.github.com/repos/QNFO/qnfo-workers/contents?ref=main", "show <rev>:. is the root too", { r, calls });
}
{ // misses name what was asked for
  calls = []; responder = () => J({ message: "Not Found" }, 404);
  let r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main:nope.js" });
  ok(r.ok === false && r.error === "GitHub 404: Not Found (QNFO/qnfo-workers, ref main, path nope.js)", "a missing file names the repo, ref and path", r);
  r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "log", ref: "fix/merged-branch" });
  ok(r.ok === false && /\(QNFO\/qnfo-workers, ref fix\/merged-branch\)$/.test(r.error), "a log on a deleted branch names the ref", r);
  r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "blame", ref: "main", path: "x/y.js" });
  ok(r.ok === false && /\(QNFO\/qnfo-workers, ref main, path x\/y\.js\)$/.test(r.error), "blame names the ref and path", r);
  responder = () => J({ message: "Server Error" }, 500);
  r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "log" });
  ok(r.ok === false && r.error === "GitHub 500: Server Error", "only a 404 gets the context text", r);
}
{ // show of a commit is unchanged
  calls = []; responder = () => J(commit);
  let r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main" });
  ok(r.ok === true && r.full_sha === commit.sha && calls.length === 1 && /\/commits\/main$/.test(calls[0]), "show main still shows the commit", { r, calls });
  calls = [];
  r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", sha: "abc123" });
  ok(r.ok === true && /\/commits\/abc123$/.test(calls[0]), "show with a sha still shows that commit", { r, calls });
  calls = [];
  r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", sha: "abc:def" });
  ok(calls.length === 1 && /\/commits\/abc%3Adef$/.test(calls[0]), "an explicit sha is never read as rev:path", calls);
}
{ // a dot segment never reaches GitHub
  for (const p of ["../../../../user/repos", "a/../../../user/repos", "./../x", "..", "../", "x/./../../y"]) {
    calls = []; responder = () => J([{ name: "private-repo-a" }]);
    const r = await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main:" + p });
    ok(calls.length >= 1 && onlyApiHost(calls) && calls.every((u) => /^https:\/\/api\.github\.com\/repos\/QNFO\/qnfo-workers\/(contents|commits)/.test(u)), "show main:" + p + " stays under the repository's own API path", { r, calls });
  }
  calls = []; responder = () => J([{ name: "x" }]);
  await gitOp(env, { repo: "QNFO/qnfo-workers", op: "show", ref: "main:../../../../user/repos" });
  ok(calls[0] === "https://api.github.com/repos/QNFO/qnfo-workers/contents/%252e%252e/%252e%252e/%252e%252e/%252e%252e/user/repos?ref=main", "the traversal request keeps every .. as a literal name GitHub will not find", calls[0]);
  ok(encPath("a/../b") === "a/%252e%252e/b" && encPath("./x") === "%252e/x" && encPath("a.b/c..d/.hidden") === "a.b/c..d/.hidden" && encPath("a b/c#d?e") === "a%20b/c%23d%3Fe" && encPath("") === "" && encPath("%2e%2e/x") === "%252e%252e/x", "encPath neutralises only whole dot segments and encodes the rest as before");
  for (const op of ["log", "blame"]) {
    calls = []; responder = () => J([]);
    await gitOp(env, { repo: "QNFO/qnfo-workers", op, ref: "main", path: "../../../../user/repos" });
    ok(onlyApiHost(calls) && calls.every((u) => u.startsWith("https://api.github.com/repos/QNFO/qnfo-workers/commits?")), op + " with a traversal path keeps the path in the query string", calls);
  }
}
{ // repository shapes for a read
  calls = []; responder = () => J([]);
  const a = await gitOp(env, { owner: "QNFO", repo: "qnfo-workers", op: "log" });
  ok(a.ok === true && a.repo === "QNFO/qnfo-workers" && /\/repos\/QNFO\/qnfo-workers\/commits\?/.test(calls[0]), "owner plus a bare repo joins them", { a, calls });
  calls = [];
  const b = await gitOp(env, { op: "log" });
  ok(b.ok === true && b.repo === "QNFO/qnfo-workers", "an empty repo reads QNFO/qnfo-workers", b);
  const c = await gitOp(env, { repo: "q08-mind", op: "log" });
  ok(c.ok === true && c.repo === "QNFO/q08-mind", "a bare name reads QNFO/<name>", c);
  const d = await gitOp(env, { owner: "other", repo: "tool", op: "log" });
  ok(d.ok === true && d.repo === "other/tool", "an owner given with a bare name wins over the QNFO default", d);
  const e = await gitOp(env, { owner: "qnfo", repo: "QNFO/qnfo-workers", op: "log" });
  ok(e.ok === true && e.repo === "QNFO/qnfo-workers", "an owner that agrees with a full name (any case) is accepted", e);
  const g = await gitOp(env, { repo: "QNFO/.github", op: "log" });
  ok(g.ok === true && g.repo === "QNFO/.github" && /\/repos\/QNFO\/\.github\/commits\?/.test(calls[calls.length - 1]), "a repository with a leading dot is read again", { g, last: calls[calls.length - 1] });
  calls = [];
  for (const [bad, args] of [["a b/c", { repo: "a b/c" }], ["a/b/c", { repo: "a/b/c" }], ["/x", { repo: "/x" }], ["x/", { repo: "x/" }], ["x/..", { repo: "x/.." }], ["x/.", { repo: "x/." }], ["../x", { repo: "../x" }], ["owner only", { owner: "QNFO" }], ["conflicting owner", { owner: "ignored", repo: "QNFO/qnfo-workers" }]]) {
    const r = await gitOp(env, Object.assign({ op: "log" }, args));
    ok(r.ok === false && /^repo (\(owner\/name\) required|must be owner\/name \(got: )/.test(r.error), "refused: " + bad, r);
  }
  ok(calls.length === 0, "a malformed or contradictory repo makes no request", calls);
}
{ // error text
  ok(gitRepoError({}) === "repo (owner/name) required", "nothing given: repo (owner/name) required");
  ok(gitRepoError({ repo: "a b/c" }) === "repo must be owner/name (got: repo a b/c)", "a malformed repo is echoed so it is not mistaken for a missing one", gitRepoError({ repo: "a b/c" }));
  ok(gitRepoError({ owner: "QNFO" }) === "repo must be owner/name (got: owner QNFO, repo )", "an owner alone is named", gitRepoError({ owner: "QNFO" }));
}
{ // gitRepoArg directly
  ok(gitRepoArg({}, false) === "" && gitRepoArg({}, true) === "QNFO/qnfo-workers", "an empty repo is refused for a write and defaulted for a read");
  ok(gitRepoArg({ repo: "x" }, false) === "" && gitRepoArg({ repo: "x", owner: "o" }, false) === "o/x", "a bare name needs an owner for a write");
  ok(gitRepoArg({ owner: "o" }, true) === "" && gitRepoArg({ owner: "o" }, false) === "", "an owner alone is refused for a read and a write");
  ok(gitRepoArg({ repo: "QNFO/qnfo-workers" }, false) === "QNFO/qnfo-workers", "a full name passes for a write");
  ok(gitRepoArg({ repo: "QNFO/.github" }, false) === "QNFO/.github" && gitRepoArg({ repo: "QNFO/.." }, true) === "" && gitRepoArg({ repo: "-x/y.z_w" }, true) === "-x/y.z_w", "GitHub's name shapes pass, '.' and '..' do not");
  ok(gitRepoArg(null, true) === "QNFO/qnfo-workers" && gitRepoArg(undefined, false) === "", "no arguments at all do not throw");
}
{ // a write never defaults the repository
  calls = []; responder = () => J({ message: "Not Found" }, 404);
  const a = await githubCherryPick(env, { owner: "QNFO", repo: "qnfo-workers", commits: ["abc"] });
  ok(a.ok === false && /base branch not found: main/.test(a.error) && calls[0] === "https://api.github.com/repos/QNFO/qnfo-workers/git/ref/heads/main", "cherry-pick accepts owner plus repo", { a, calls });
  calls = [];
  const b = await githubCherryPick(env, { commits: ["abc"] });
  ok(b.ok === false && b.error === "repo (owner/name) required" && calls.length === 0, "cherry-pick with no repo is refused without a request", { b, calls });
  const c = await githubCherryPick(env, { repo: "qnfo-workers", commits: ["abc"] });
  ok(c.ok === false && /^repo must be owner\/name \(got: repo qnfo-workers\)/.test(c.error) && calls.length === 0, "cherry-pick with a bare name and no owner is refused and says why", { c, calls });
  const d = await githubCherryPick(env, { owner: "QNFO", repo: "cloudflare/skills", commits: ["abc"] });
  ok(d.ok === false && /^repo must be owner\/name/.test(d.error) && calls.length === 0, "cherry-pick with an owner that contradicts the slashed repo is refused", { d, calls });
}
{ // the catalogue says what the code reads
  const gi = src.indexOf('{ name: "git_op"');
  const gitEntry = src.slice(gi, src.indexOf("additionalProperties: false } },", gi) + 40);
  const props = [...gitEntry.slice(gitEntry.indexOf("properties:")).matchAll(/(\w+): \{ type: "/g)].map((m) => m[1]);
  const g0 = src.indexOf("async function gitOp(env, args) {"), g1 = src.indexOf('__name(gitOp, "gitOp");');
  const read = [...new Set([...src.slice(g0, g1).matchAll(/args && args\.([A-Za-z_]+)/g), ...src.slice(src.indexOf("function gitRepoArg"), src.indexOf("function gitRepoError")).matchAll(/args && args\.([A-Za-z_]+)/g)].map((m) => m[1]))];
  ok(read.length >= 8 && read.every((k) => props.includes(k)), "every argument gitOp reads is in the git_op schema", { read, props });
  ok(!/required: \["repo"\]/.test(gitEntry), "git_op no longer requires repo (an empty repo defaults)");
  ok(/<rev>:<path>/.test(gitEntry) && /maxChars/.test(gitEntry) && /offset/.test(gitEntry) && /next_offset/.test(gitEntry), "the description and schema document <rev>:<path>, maxChars, offset and next_offset");
  const ci = src.indexOf('{ name: "github_cherry_pick"');
  const cp = src.slice(ci, src.indexOf("additionalProperties: false } },", ci) + 40);
  ok(/owner: \{ type: "string"/.test(cp), "github_cherry_pick's schema carries owner");
}
{ // release bookkeeping
  const v = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(src);
  ok(v && (+v[1] > 2 || (+v[1] === 2 && +v[2] >= 58)), "VERSION is at least 2.58.0 (git_op reads large files in windows: a minor)", v && v[0]);
  ok(/\/\* [^\n]*GIT-OP-HARDEN-1/.test(src) && /\/\* [^\n]*GIT-OP-REPO-SHAPE-1/.test(src), "release notes carry both notes");
  ok(src === mirror, "deployed-current.worker.js is identical to worker.js");
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
