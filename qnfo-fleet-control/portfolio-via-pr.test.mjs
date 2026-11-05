// PORTFOLIO-VIA-PR-1 offline suite (qnfo-fleet-control, pillar autonomy; FLEET-JOURNEY-FAILED-1 loop-heartbeats agent_issues 1001171, PORTFOLIO-WRITE-FAILED-1 issues 1001804 to 1001806).
// Since 2026-11-04 15:47Z the Contents API commit of docs/PORTFOLIO.md to main (ruleset require-build) and of PORTFOLIO.md / profile/README.md to QNFO/.github master (branch protection that asks
// for a pull request) answers HTTP 409, hourly, with the retry of PORTFOLIO-PUT-RETRY-1 repeating the same refused call. Proves, against a small in-memory GitHub: a rule refusal is told
// from a moved branch or a stale sha; a refused surface lands on one branch and one pull request that is merged when GitHub allows it and left open otherwise; the next call with the same body
// (timestamps aside) pushes nothing new and tries the merge again; a changed body moves the branch; a stale-sha 409 still takes the old retry and opens no pull request; the charter document
// takes the same road; the pull request carries no [skip ci] (it would skip the required check) and the merge commit does.
// Run: node --no-warnings qnfo-fleet-control/portfolio-via-pr.test.mjs   -> prints "N checks, 0 failure(s)"
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let fails = 0, n = 0;
const check = (c, m, x) => { n++; if (!c) { fails++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x) : "")); } };
const grab = (name) => {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(src);
  if (!m) throw new Error(name + " not found in worker.js");
  const end = src.indexOf("\n}\n", m.index);
  return src.slice(m.index, end + 3);
};
const vars = (names) => names.map((nm) => { const m = new RegExp("^var " + nm + " = .*;$", "m").exec(src); if (!m) throw new Error(nm + " not found"); return m[0]; }).join("\n");

// ---- an in-memory GitHub: contents, refs, pulls, merge ----
function github(cfg) {
  const repos = {};
  const mk = (name, c) => { repos[name] = { branch: c.branch, protectedBase: c.protectedBase !== false, mergeBlocked: !!c.mergeBlocked, refs: {}, prs: [], puts: [], merges: [], sha: 1 }; repos[name].refs[c.branch] = { sha: "base0", files: Object.assign({}, c.files) }; };
  for (const k of Object.keys(cfg)) mk(k, cfg[k]);
  const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
  const b64 = (t) => Buffer.from(t, "utf8").toString("base64");
  const fetchFn = async (url, opts) => {
    const o = opts || {}, method = o.method || "GET", u = new URL(url), p = decodeURIComponent(u.pathname);
    const m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(p);
    if (!m || !repos[m[1]]) return resp(404, { message: "Not Found" });
    const R = repos[m[1]], rest = m[2] || "", body = o.body ? JSON.parse(o.body) : null;
    if (rest === "" && method === "GET") return resp(200, { default_branch: R.branch });
    let mm;
    if ((mm = /^\/contents\/(.+)$/.exec(rest))) {
      const path = mm[1];
      if (method === "GET") {
        const br = u.searchParams.get("ref"), ref = R.refs[br];
        if (!ref) return resp(404, { message: "No commit found for the ref " + br });
        const f = ref.files[path];
        return f ? resp(200, { sha: f.sha, content: b64(f.content), encoding: "base64" }) : resp(404, { message: "Not Found" });
      }
      if (method === "PUT") {
        const br = body.branch, ref = R.refs[br];
        R.puts.push({ branch: br, path, message: body.message });
        if (!ref) return resp(404, { message: "Branch not found" });
        if (br === R.branch && R.protectedBase) return resp(409, { message: R.staleSha ? path + " does not match " + (body.sha || "?") : "Changes must be made through a pull request." });
        const old = ref.files[path];
        if (old && body.sha !== old.sha) return resp(409, { message: path + " does not match " + body.sha });
        const sha = "blob" + (R.sha++);
        ref.files[path] = { content: Buffer.from(body.content, "base64").toString("utf8"), sha };
        ref.sha = "c" + sha;
        return resp(200, { commit: { sha: ref.sha }, content: { sha } });
      }
    }
    if ((mm = /^\/git\/ref\/heads\/(.+)$/.exec(rest)) && method === "GET") { const r = R.refs[mm[1]]; return r ? resp(200, { object: { sha: r.sha } }) : resp(404, { message: "Not Found" }); }
    if (rest === "/git/refs" && method === "POST") { const nm = body.ref.replace("refs/heads/", ""); const from = Object.values(R.refs).find((r) => r.sha === body.sha) || R.refs[R.branch]; R.refs[nm] = { sha: body.sha, files: JSON.parse(JSON.stringify(from.files)) }; return resp(201, { ref: body.ref }); }
    if ((mm = /^\/git\/refs\/heads\/(.+)$/.exec(rest))) {
      if (method === "PATCH") { const r = R.refs[mm[1]]; if (!r) return resp(422, { message: "Reference does not exist" }); const from = R.refs[R.branch]; r.sha = body.sha; r.files = JSON.parse(JSON.stringify(from.files)); return resp(200, { ref: mm[1] }); }
      if (method === "DELETE") { delete R.refs[mm[1]]; return resp(204, {}); }
    }
    if (rest === "/pulls" && method === "GET") { const head = (u.searchParams.get("head") || "").split(":")[1]; return resp(200, R.prs.filter((x) => x.state === "open" && x.head === head).map((x) => ({ number: x.number, head: { ref: x.head } }))); }
    if (rest === "/pulls" && method === "POST") { const pr = { number: R.prs.length + 1, state: "open", head: body.head, base: body.base, title: body.title, body: body.body }; R.prs.push(pr); return resp(201, { number: pr.number }); }
    if ((mm = /^\/pulls\/(\d+)\/merge$/.exec(rest)) && method === "PUT") {
      const pr = R.prs[Number(mm[1]) - 1];
      R.merges.push({ number: pr.number, method: body.merge_method, title: body.commit_title });
      if (R.mergeBlocked) return resp(405, { message: 'Required status check "Workers Builds: qnfo-workers" is expected.' });
      Object.assign(R.refs[R.branch].files, JSON.parse(JSON.stringify(R.refs[pr.head].files))); R.refs[R.branch].sha = "merged" + pr.number; pr.state = "merged";
      return resp(200, { sha: "merged" + pr.number, merged: true });
    }
    return resp(404, { message: "unrouted " + method + " " + rest });
  };
  return { repos, fetchFn };
}

const pre = [vars(["CHARTER_BEGIN", "CHARTER_END", "CHARTER_REPO", "CHARTER_DOC_PATH", "PF_PROFILE_REPO"]), "var FETCH_TIMEOUT_MS = 12000, pfBranchCache = {}; function pfScrubProfile(x) { return x; } async function charterOne() { return null; }"].join("\n");
const fns = ["timedFetch", "b64encode", "pfGh", "pfGhJson", "pfDefaultBranch", "pfRuleRefusal", "pfOk2xx", "pfSameBody", "pfCommitViaPr", "pfCommitOnce", "pfPutConflict", "pfRetryPut", "charterSplice", "charterCommitOnce"].map(grab).join("\n");
const mkWorld = (cfg) => {
  const gh = github(cfg);
  const ctx = vm.createContext({ fetch: gh.fetchFn, AbortController, setTimeout, clearTimeout, Date, JSON, Object, Array, Number, String, Math, URL, TextEncoder, TextDecoder, Uint8Array, btoa, atob, console, encodeURIComponent });
  const W = vm.runInContext(pre + "\n" + fns + "\n;({ pfRuleRefusal, pfCommitOnce, pfRetryPut, charterCommitOnce, pfSameBody, reset: function () { pfBranchCache = {}; } });", ctx, { filename: "fleet-control#PORTFOLIO-VIA-PR-1" });
  return { W, gh };
};
const env = { GITHUB_TOKEN: "t" };
const doc = (ts, extra) => "# Portfolio\n_Generated at " + ts + "_\n" + (extra || "table v1") + "\n";

// ---- the classifier ----
{
  const { W } = mkWorld({ "QNFO/x": { branch: "main", files: {} } });
  check(W.pfRuleRefusal(409, "Changes must be made through a pull request."), "409 asking for a pull request is a rule refusal");
  check(W.pfRuleRefusal(409, 'Required status check "Workers Builds: qnfo-workers" is expected.'), "409 with a required status check is a rule refusal");
  check(W.pfRuleRefusal(403, "Repository rule violations found"), "403 rule violations is a rule refusal");
  check(W.pfRuleRefusal(422, "Repository rule violations found for refs/heads/main."), "422 rule violations is a rule refusal");
  check(!W.pfRuleRefusal(409, "docs/PORTFOLIO.md does not match 3e6eef15"), "a stale sha is not a rule refusal");
  check(!W.pfRuleRefusal(409, "is at abc but expected def"), "a moved branch is not a rule refusal");
  check(!W.pfRuleRefusal(200, "Changes must be made through a pull request.") && !W.pfRuleRefusal(404, "pull request"), "only 409, 403 and 422 count");
  check(W.pfSameBody("a at 2026-11-04T23:05:50.984Z b", "a at 2026-11-05T00:05:51Z b") && !W.pfSameBody("a 1", "a 2"), "bodies are the same when only ISO timestamps differ");
}

// ---- a protected main with a required check: the pull request stays open, then merges ----
{
  const { W, gh } = mkWorld({ "QNFO/qnfo-workers": { branch: "main", mergeBlocked: true, files: { "docs/PORTFOLIO.md": { content: doc("2026-11-03T21:05:00Z", "table v0"), sha: "b0" } } } });
  const R = gh.repos["QNFO/qnfo-workers"];
  const msg = "chore(portfolio): PORTFOLIO-LOOP-1 sync 2026-11-05 [skip ci]";
  const r1 = await W.pfRetryPut(() => W.pfCommitOnce(env, "QNFO/qnfo-workers", "docs/PORTFOLIO.md", doc("2026-11-05T00:05:50Z"), msg, "replace"));
  check(r1.status === "pr-open" && r1.pr === 1, "first sync: the direct commit is refused, the surface is a pull request left open", r1);
  check(R.puts.filter((p) => p.branch === "main").length === 1, "the refused direct commit was tried once, not three times (no retry of a rule refusal)", R.puts);
  check(R.refs["portfolio-loop/docs-portfolio.md"] && R.refs["portfolio-loop/docs-portfolio.md"].files["docs/PORTFOLIO.md"].content === doc("2026-11-05T00:05:50Z"), "the branch carries the new document");
  check(R.prs.length === 1 && R.prs[0].base === "main" && R.prs[0].head === "portfolio-loop/docs-portfolio.md", "one pull request from the surface branch into main", R.prs);
  check(!/skip ci/i.test(R.prs[0].title) && !/skip ci/i.test(R.puts[1].message), "the pull request title and the branch commit carry no [skip ci] (it would skip the required check)", { t: R.prs[0].title, m: R.puts[1].message });
  check(R.merges.length === 1 && /\[skip ci\]$/.test(R.merges[0].title), "the merge was tried once, and its commit says [skip ci] for the push to main", R.merges);
  check(R.refs.main.files["docs/PORTFOLIO.md"].content === doc("2026-11-03T21:05:00Z", "table v0"), "main is untouched while the pull request is open");
  // hourly retry, same body, a new timestamp
  const puts0 = R.puts.length;
  W.reset();
  const r2 = await W.pfRetryPut(() => W.pfCommitOnce(env, "QNFO/qnfo-workers", "docs/PORTFOLIO.md", doc("2026-11-05T01:05:50Z"), msg, "replace"));
  check(r2.status === "pr-open" && r2.pr === 1 && R.prs.length === 1, "retry: still the same pull request, no second one", { r2, prs: R.prs.length });
  check(R.puts.filter((p) => p.branch !== "main").length === 1, "retry: nothing new pushed to the surface branch (only the timestamp differs)", R.puts.slice(puts0));
  check(R.merges.length === 2, "retry: the merge was tried again");
  // a different body moves the branch
  W.reset();
  const r3 = await W.pfCommitOnce(env, "QNFO/qnfo-workers", "docs/PORTFOLIO.md", doc("2026-11-05T02:05:50Z", "table v2"), msg, "replace");
  check(r3.status === "pr-open" && r3.pr === 1 && R.prs.length === 1, "changed body: same pull request", r3);
  check(R.refs["portfolio-loop/docs-portfolio.md"].files["docs/PORTFOLIO.md"].content.indexOf("table v2") > 0, "changed body: the branch carries the new text");
  // the check passes: the next sync merges it
  R.mergeBlocked = false; W.reset();
  const r4 = await W.pfCommitOnce(env, "QNFO/qnfo-workers", "docs/PORTFOLIO.md", doc("2026-11-05T03:05:50Z", "table v2"), msg, "replace");
  check(r4.status === "committed" && r4.pr === 1 && /pull request #1/.test(r4.note), "merge allowed: the surface is committed through the pull request", r4);
  check(R.refs.main.files["docs/PORTFOLIO.md"].content.indexOf("table v2") > 0, "main now carries the document");
  check(!R.refs["portfolio-loop/docs-portfolio.md"], "the surface branch is deleted after the merge");
  // the next sync, a new timestamp, the same document already on main (merged by the lane or by hand): nothing to open
  W.reset();
  const r5 = await W.pfCommitOnce(env, "QNFO/qnfo-workers", "docs/PORTFOLIO.md", doc("2026-11-05T04:05:50Z", "table v2"), msg, "replace");
  check(r5.status === "unchanged" && R.prs.length === 1 && !R.refs["portfolio-loop/docs-portfolio.md"], "main already holds the document apart from its timestamps: unchanged, no new branch, no new pull request", r5);
}

// ---- master of QNFO/.github: a pull request is required, no check: merged at once ----
{
  const { W, gh } = mkWorld({ "QNFO/.github": { branch: "master", mergeBlocked: false, files: { "PORTFOLIO.md": { content: "old\n", sha: "p0" } } } });
  const R = gh.repos["QNFO/.github"];
  const r = await W.pfRetryPut(() => W.pfCommitOnce(env, "QNFO/.github", "PORTFOLIO.md", doc("2026-11-05T00:05:50Z"), "chore(portfolio): sync [skip ci]", "replace"));
  check(r.status === "committed" && r.pr === 1 && r.sha === "merged1", "a repository without a required check merges the pull request in the same sync", r);
  check(R.refs.master.files["PORTFOLIO.md"].content === doc("2026-11-05T00:05:50Z") && R.merges[0].method === "squash", "master carries the document, squash merged");
}

// ---- a stale sha is not a rule: the old retry, no pull request ----
{
  const { W, gh } = mkWorld({ "QNFO/qnfo-workers": { branch: "main", files: { "docs/PORTFOLIO.md": { content: "old\n", sha: "b0" } } } });
  const R = gh.repos["QNFO/qnfo-workers"]; R.staleSha = true;
  const r = await W.pfRetryPut(() => W.pfCommitOnce(env, "QNFO/qnfo-workers", "docs/PORTFOLIO.md", doc("2026-11-05T00:05:50Z"), "m", "replace"));
  check(r.status === "write-failed" && /HTTP 409 on main: docs\/PORTFOLIO.md does not match/.test(r.note) && /attempts 3/.test(r.note), "stale sha: three attempts, the refusal text in the note", r);
  check(R.prs.length === 0 && Object.keys(R.refs).length === 1, "stale sha: no branch and no pull request");
}

// ---- the charter document takes the same road ----
{
  const live = "<!-- CHARTER-LIVE:BEGIN -->\nold\n<!-- CHARTER-LIVE:END -->";
  const { W, gh } = mkWorld({ "QNFO/qnfo-workers": { branch: "main", mergeBlocked: true, files: { "docs/QUNIVERSE-CHARTER.md": { content: "# Charter\n" + live + "\ntail\n", sha: "c0" } } } });
  const R = gh.repos["QNFO/qnfo-workers"];
  const block = "<!-- CHARTER-LIVE:BEGIN -->\nnew block at 2026-11-05T03:10:00Z\n<!-- CHARTER-LIVE:END -->";
  const r = await W.charterCommitOnce(env, block, "2026-11-05", true);
  check(r.status === "pr-open" && /pull request #1/.test(r.note) && r.doc.indexOf("new block") > 0 && r.doc.indexOf("tail") > 0, "charter: the refused commit becomes an open pull request and the full document is still returned for the mirror", r);
  check(R.prs.length === 1 && R.prs[0].head === "portfolio-loop/docs-quniverse-charter.md" && !/skip ci/i.test(R.prs[0].title), "charter: its own surface branch, a title without [skip ci]", R.prs);
}

// ---- wiring ----
check(/pfRuleRefusal\(pr\.status, why\)\) return pfCommitViaPr\(env, repo, path, next, message, branch,/.test(src), "pfCommitOnce answers a rule refusal with the pull request path");
check(/async function pfCommit\(env, repo, path, content, message, mode\) \{\s*return pfRetryPut\(/.test(src), "pfCommit still wraps pfCommitOnce in pfRetryPut");
check(!/LW_BAD_WRITE = \{[^}]*"pr-open"/.test(src), "an open pull request is not reported as a failed write by LOOP-WATCH-1");

console.log(n + " checks, " + fails + " failure(s)");
if (fails) process.exit(1);
