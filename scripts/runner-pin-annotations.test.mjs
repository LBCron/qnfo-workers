// RUNNER-PIN-ANNOTATIONS-1 suite (2026-10-20, workflow failure audit, agent_issues 100295; charter pillar autonomy).
//
// WHAT   The run annotations of the repository's workflows carried five avoidable classes. This suite pins each fix to the behaviour the
//        Actions runner would show, not to a spelling:
//          1. RUNNER-PIN-2: no workflow job runs on `ubuntu-latest` (it becomes Ubuntu 26 on a rolling basis until 2026-11-19, a notice
//             on every job and a random image per run). Every job names its image and carries the pin comment.
//          2. ANNOTATION-FIXTURE-QUIET-1: scripts/stop-commands.sh keeps the runner from reading the `::warning::` / `::error::` /
//             `::notice::` lines that an offline self-test prints on purpose as annotations (workflow-lint, fleet-autodeploy,
//             code-task-publish, windows-suite-parity). It is checked against the real fixtures through a model of the runner's
//             command parser, and the exit code of the wrapped command is kept.
//          3. container-config-selfheal-cron: the AMBER verdict (steady state while PILOT_TOKEN is not provisioned in Actions secrets) is a notice, not
//             a warning, the RED verdict stays an error, and a cancel no longer kills a running self-heal.
//          4. ci-watchdog: a workflow_run that the job's own `if:` skips takes a group of its own, so it cannot evict a waiting sweep.
//          5. qnfo-fleet-advisor (folded, never deployed): undici is overridden to a fixed version so the Dependabot security update
//             stops failing.
// Run: node scripts/runner-pin-annotations.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wfDir = join(root, ".github", "workflows");
const rd = (p) => readFileSync(join(root, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };

// ---- the runner's reading of a step's stdout ------------------------------------------------------------------------------------
// A workflow command counts only at the START of a line (`::name::message` or `::name key=value::message`; the legacy `##[name]message`
// too). After `::stop-commands::<token>` nothing counts until a line `::<token>::`. Returns the commands the runner would act on and
// whether commands are still switched off at the end (a leak that would silence every later step).
function runnerCommands(out) {
  const cmds = [];
  let stop = null;
  for (const raw of String(out).split("\n")) {
    const line = raw.replace(/\r$/, "");
    const m = /^::([A-Za-z0-9_-]+)(?: [^:]*)?::(.*)$/.exec(line) || /^##\[([A-Za-z0-9_-]+)\](.*)$/.exec(line);
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (stop !== null) { if (name === stop) stop = null; continue; }
    if (name === "stop-commands") { stop = m[2].trim().toLowerCase(); continue; }
    cmds.push({ name, text: m[2] });
  }
  return { cmds, stopped: stop !== null };
}
const levels = (out, level) => runnerCommands(out).cmds.filter((c) => c.name === level);

// ---- a workflow step's run script ------------------------------------------------------------------------------------------------
// The step whose `- name:` line matches `nameRe`: its lines up to the next step, and the script of its `run:` key (block or one line).
function step(text, nameRe) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => /^      - name: /.test(l) && nameRe.test(l));
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && !/^      - /.test(lines[j]) && !/^\S/.test(lines[j]) && !/^    \S/.test(lines[j])) j++;
  const body = lines.slice(i, j);
  const r = body.findIndex((l) => /^        run:/.test(l));
  let script = "";
  if (r >= 0) {
    const one = /^        run: (?!\|)(.+)$/.exec(body[r]);
    if (one) script = one[1];
    else {
      const blk = [];
      for (let k = r + 1; k < body.length && (/^          /.test(body[k]) || body[k].trim() === ""); k++) blk.push(body[k].replace(/^          /, ""));
      script = blk.join("\n").replace(/\n+$/, "\n");
    }
  }
  return { text: body.join("\n"), script };
}

const haveBash = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" }).status === 0;
const havePy = spawnSync("python3", ["-c", "print(1)"], { encoding: "utf8" }).status === 0;
if (!haveBash) console.log("NOTE no bash on PATH: the runner-behaviour checks are skipped, the static checks still run");
if (!havePy) console.log("NOTE no python3 on PATH: the self-test replays are skipped, the static checks still run");
const scratch = mkdtempSync(join(tmpdir(), "rpa-"));
const bash = (script, o = {}) => spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], { encoding: "utf8", cwd: o.cwd || root, env: { ...process.env, ...(o.env || {}) } });

// ---- 1. RUNNER-PIN-2: every job names its image -----------------------------------------------------------------------------------
const wfFiles = readdirSync(wfDir).filter((f) => f.endsWith(".yml")).sort();
ok(wfFiles.length >= 50, "the workflow directory was read", wfFiles.length);
const latest = [], unpinned = [], unmarked = [];
let pinnedLines = 0;
for (const f of wfFiles) {
  const lines = readFileSync(join(wfDir, f), "utf8").split("\n");
  lines.forEach((l, n) => {
    if (/^\s*#/.test(l)) return;
    if (/ubuntu-latest/.test(l)) latest.push(f + ":" + (n + 1));
    const m = /^\s*runs-on:\s*(\S+)\s*$/.exec(l);
    if (!m) return;
    if (/^ubuntu-/.test(m[1])) {
      pinnedLines++;
      if (!/^ubuntu-\d\d\.\d\d$/.test(m[1])) unpinned.push(f + ":" + (n + 1) + " " + m[1]);
      if (!/RUNNER-PIN-[12]/.test(lines[n - 1] || "")) unmarked.push(f + ":" + (n + 1));
    }
  });
}
ok(latest.length === 0, "no workflow job runs on ubuntu-latest (RUNNER-PIN-2; GitHub moves the label to Ubuntu 26 until 2026-11-19)", latest.slice(0, 12));
ok(unpinned.length === 0 && pinnedLines >= 50, "every ubuntu job names a full image such as ubuntu-24.04", { unpinned: unpinned.slice(0, 5), pinnedLines });
ok(unmarked.length === 0, "every pinned job has the pin comment on the line above it, which says why and when to unpin", unmarked.slice(0, 12));
ok(/^    runs-on: windows-latest$/m.test(readFileSync(join(wfDir, "windows-suite-parity.yml"), "utf8")), "the Windows parity job keeps windows-latest (its purpose is to follow the current Windows image)");
{
  const sample = readFileSync(join(wfDir, "workflow-lint.yml"), "utf8");
  ok(/^    # RUNNER-PIN-2 .*2026-11-19.*ubuntu-26\.04.*\n    runs-on: ubuntu-24\.04$/m.test(sample), "the pin comment names the date GitHub finishes the migration and the ubuntu-26.04 trial that releases the pin");
}

// ---- 2. ANNOTATION-FIXTURE-QUIET-1: the helper, against the runner model ----------------------------------------------------------
const helper = join(root, "scripts", "stop-commands.sh");
ok(existsSync(helper), "scripts/stop-commands.sh exists");
if (haveBash && existsSync(helper)) {
  const via = (cmdline) => bash('bash scripts/stop-commands.sh ' + cmdline);
  let r = via(`sh -c 'echo "::warning::fixture outage"; echo "::error::fixture failure"; echo "::notice::fixture note"; exit 0'`);
  let rc = runnerCommands(r.stdout);
  ok(r.status === 0 && rc.cmds.length === 0 && rc.stopped === false, "a command that prints warning, error and notice lines: the runner acts on none and commands are back on afterwards", { status: r.status, cmds: rc.cmds, stopped: rc.stopped });
  ok(/::warning::fixture outage/.test(r.stdout) && /::error::fixture failure/.test(r.stdout), "the output stays in the log verbatim (only the runner's reading of it is off)");
  const plain = bash(`sh -c 'echo "::warning::fixture outage"; echo "::error::fixture failure"'`);
  ok(levels(plain.stdout, "warning").length === 1 && levels(plain.stdout, "error").length === 1, "the model is honest: the same lines without the helper are a warning and an error annotation");
  r = via(`sh -c 'echo "::warning::before failing"; exit 3'`);
  rc = runnerCommands(r.stdout);
  ok(r.status === 3 && rc.cmds.length === 0 && rc.stopped === false, "a failing command still fails the step with its own exit code, and the commands are switched back on", { status: r.status, stopped: rc.stopped });
  r = via("sh -c 'exit 127'");
  ok(r.status === 127, "the exit code is kept exactly (127)", r.status);
  r = via("definitely-not-a-command-xyz");
  ok(r.status === 127 && runnerCommands(r.stdout).stopped === false, "a command that does not exist fails the step (127) and leaves the commands on", { status: r.status });
  r = via(`printf 'no trailing newline'`);
  rc = runnerCommands(r.stdout);
  ok(r.status === 0 && rc.stopped === false && /no trailing newline\n::[0-9a-f]+::\n$/.test(r.stdout.replace(/\n\n/g, "\n")), "output without a trailing newline: the resume line still starts a line of its own, so the runner sees it", r.stdout);
  const t1 = /::stop-commands::([0-9a-z]+)/.exec(via("true").stdout);
  const t2 = /::stop-commands::([0-9a-z]+)/.exec(via("true").stdout);
  ok(t1 && t2 && t1[1].length >= 12 && t1[1] !== t2[1], "the token is random per call and long enough that output inside the window cannot resume commands", [t1 && t1[1], t2 && t2[1]]);
  r = bash("bash scripts/stop-commands.sh");
  ok(r.status === 2 && /usage/.test(r.stderr), "no command is a usage error (2), never a silent success", { status: r.status });
  r = via(`sh -c 'echo "::stop-commands::guessed"; echo "::guessed::"; echo "::warning::after a forged resume"'`);
  ok(levels(r.stdout, "warning").length === 0 && runnerCommands(r.stdout).stopped === false, "output that tries to resume commands with a token of its own is still silent (the runner only honours the real token)");
}

// the real fixtures the audit found
if (haveBash && havePy) {
  let plain = bash("python3 scripts/secret-mutation-guard_test.py 2>/dev/null");
  ok(plain.status === 0 && levels(plain.stdout, "warning").length >= 5 && levels(plain.stdout, "warning").every((c) => /^SECRET-LOCK-UNAVAILABLE for w \(HTTP \d+\)/.test(c.text)), "secret-mutation-guard_test.py unwrapped: five SECRET-LOCK-UNAVAILABLE warnings reach the runner (the defect the audit measured)", { status: plain.status, n: levels(plain.stdout, "warning").length });
  let wrapped = bash("bash scripts/stop-commands.sh python3 scripts/secret-mutation-guard_test.py 2>/dev/null");
  ok(wrapped.status === 0 && runnerCommands(wrapped.stdout).cmds.length === 0 && runnerCommands(wrapped.stdout).stopped === false && /SECRET-LOCK-UNAVAILABLE for w/.test(wrapped.stdout), "secret-mutation-guard_test.py through the helper: zero annotations, the log line is still there, the test still passes");

  plain = bash("python3 scripts/fleet-autoaudit-selftest.py 2>/dev/null");
  ok(plain.status === 0 && levels(plain.stdout, "warning").length === 8 && levels(plain.stdout, "warning").some((c) => /rate-limited \(HTTP 403\) on PATCH \/issues\/52/.test(c.text)), "fleet-autoaudit-selftest.py unwrapped: eight warnings (seven rate-limit retries and one publish failure) reach the runner", { status: plain.status, n: levels(plain.stdout, "warning").length });
  wrapped = bash("bash scripts/stop-commands.sh python3 scripts/fleet-autoaudit-selftest.py 2>/dev/null");
  ok(wrapped.status === 0 && runnerCommands(wrapped.stdout).cmds.length === 0 && runnerCommands(wrapped.stdout).stopped === false && /0 failure\(s\)/.test(wrapped.stdout), "fleet-autoaudit-selftest.py through the helper: zero annotations and the selftest still reports 0 failures");
}

// the wiring: each noisy step runs its command through the helper, and nothing else about the step changed
const wl = rd(".github/workflows/workflow-lint.yml"), fa = rd(".github/workflows/fleet-autodeploy.yml"), cp = rd(".github/workflows/code-task-publish.yml"), wp = rd(".github/workflows/windows-suite-parity.yml");
const sWl = step(wl, /SECRET-LOCK-ENFORCE-1 offline tests/), sFa = step(fa, /audit self-test \(offline\)/), sCp = step(cp, /publisher self-test \(offline\)/);
ok(sWl && sWl.script.trim() === "bash scripts/stop-commands.sh python3 scripts/secret-mutation-guard_test.py", "workflow-lint runs the secret-lock offline tests through the helper", sWl && sWl.script);
ok(sFa && sFa.script.trim() === "bash scripts/stop-commands.sh python scripts/fleet-autoaudit-selftest.py", "fleet-autodeploy runs the audit self-test through the helper", sFa && sFa.script);
ok(sCp && sCp.script.trim() === "bash scripts/stop-commands.sh python scripts/code-task-publish.py --selftest", "code-task-publish runs the publisher self-test through the helper", sCp && sCp.script);
ok(/python3 scripts\/workflow-lint\.py$/m.test(wl) && /python3 scripts\/secret-mutation-guard\.py$/m.test(wl) && /python3 scripts\/status_unchanged_test\.py$/m.test(wl) && /python3 scripts\/canonical_deploy_skip_test\.py$/m.test(wl), "workflow-lint keeps its linter, its guard and its other offline tests exactly as they were (those are not fixtures that print workflow commands)");
ok(/python scripts\/fleet-autoaudit\.py --audit$/m.test(fa) && /python scripts\/fleet-autoaudit\.py --apply$/m.test(fa) && /python scripts\/code-task-publish\.py --repo-dir \. --base main$/m.test(cp), "the real audit, apply and publish steps are NOT wrapped: their ::warning:: / ::error:: lines are the signal");
const sWp = step(wp, /Run every offline suite/);
ok(sWp && /^bash scripts\/stop-commands\.sh tail -n 25 suite-report\.txt$/m.test(sWp.script) && /^rc=\$\?$/m.test(sWp.script) && /^exit \$rc$/m.test(sWp.script) && /echo "exit_code=\$rc" >> "\$GITHUB_OUTPUT"/.test(sWp.script), "windows-suite-parity echoes the report tail through the helper and keeps the exit_code output and the final exit $rc", sWp && sWp.script);
if (haveBash) {
  const dir = join(scratch, "win");
  mkdirSync(join(dir, "scripts"), { recursive: true });
  copyFileSync(helper, join(dir, "scripts", "stop-commands.sh"));
  writeFileSync(join(dir, "suite-report.txt"), "ok      12 ms  a/a.test.mjs\n::error::fallback deploy failed for c\nFAIL    15 ms  b/b.test.mjs\n##[error]second fixture line\n");
  const tailLine = (sWp ? sWp.script : "").split("\n").find((l) => /tail -n 25/.test(l)) || "false";
  const w = bash(tailLine, { cwd: dir });
  const p = bash("tail -n 25 suite-report.txt", { cwd: dir });
  ok(w.status === 0 && runnerCommands(w.stdout).cmds.length === 0 && /fallback deploy failed for c/.test(w.stdout), "the tail of a suite report that contains an ::error:: fixture line: zero annotations through the helper, the text is still in the log", { status: w.status, cmds: runnerCommands(w.stdout).cmds });
  ok(levels(p.stdout, "error").length >= 1, "and the same tail without the helper is an error annotation (the 'fallback deploy failed for c' line the audit measured)");
}

// ---- 3. container-config-selfheal-cron ---------------------------------------------------------------------------------------------
const sh = rd(".github/workflows/container-config-selfheal-cron.yml");
ok(/^concurrency:\n  group: container-config-selfheal-cron\n  cancel-in-progress: false$/m.test(sh), "selfheal no longer cancels a run that is in progress (it holds contents: write and calls the Cloudflare API; a newer trigger still replaces a WAITING one, so no queue builds)");
ok(!/cancel-in-progress: true/.test(sh) && !/`cancel-in-progress: true` on its OWN group/.test(sh), "and the header no longer documents the old setting");
// SCHEDULE-PIN-PARITY-1 (2026-10-25): the cron below is a PIN, not a preference. #3950 (77cd356c, "ci: cut scheduled
// Actions runs to daily") moved this workflow from '13,43 * * * *' (48/day) to '13 1 * * *' (1/day) and did not update
// this expectation, so main went red at 08:00Z and deploy-gate failed every pull request for the rest of the day - the
// merge lane was fully blocked by one stale integer. Keep the assertion as strict as it was: the schedule, the three
// provably-firing workflow_run drivers, workflow_dispatch and contents: write must all stay, and a future cadence change
// updates this line in the same commit.
ok(/on:\n  schedule:[\s\S]*cron: '13 1 \* \* \*'[\s\S]*workflow_call:[\s\S]*workflow_dispatch:/.test(sh) && /^permissions:\n  contents: write$/m.test(sh), "its triggers, schedule and permissions are unchanged");
const probe = step(sh, /Functional probe/), verdict = step(sh, /Verdict - honest red/);
ok(probe && verdict, "the probe and verdict steps were found");
ok(probe && /cat \/tmp\/health\.json 2>\/dev\/null \|\| true\n\s*echo\n/.test(probe.script) && /cat \/tmp\/status\.json 2>\/dev\/null \|\| true\n\s*echo\n/.test(probe.script), "the probe ends the file it prints with a newline, so the line after it starts a line");
ok(probe && !/::warning::/.test(probe.script) && /echo "rc=health-ok-no-pilot-token" >> "\$GITHUB_OUTPUT"/.test(probe.script), "the probe's PILOT_TOKEN line is plain text (it was never an annotation: it followed `}` on the same line) and still records health-ok-no-pilot-token");
// The PILOT_TOKEN text states the measured fact and attributes the call to the audit: no document in docs/ says the token must stay out of Actions secrets
// (docs/QUNIVERSE-BACKLOG.md item 1677 only asks for an Access or rate-limit rule and a rotation path), and the sibling workflows still read the secret.
ok(!/must NOT be copied|stays out of Actions secrets|backlog 1677|SEC-CONTAINERS-PILOT-SHELL-STATIC-TOKEN-1|deliberately absent/.test(sh) && /not provisioned in Actions secrets/.test(sh) && /audit's call, not a rule of any document/.test(sh), "the PILOT_TOKEN comment and log line state the measured fact (not provisioned in Actions secrets) and call it the audit's judgment, with no prohibition cited to backlog 1677");
ok(/PILOT_TOKEN: \$\{\{ secrets\.PILOT_TOKEN \}\}/.test(sh) && /restore-container-config-1485\.yml and deploy-containers-pilot\.yml still read the secret if it is present/.test(sh) && /secrets\.PILOT_TOKEN/.test(rd(".github/workflows/restore-container-config-1485.yml")) && /PILOT_TOKEN/.test(rd(".github/workflows/deploy-containers-pilot.yml")), "the workflow still reads secrets.PILOT_TOKEN and its comment names the two siblings that also read it (so a later session may provision it)");
if (haveBash && probe && verdict && process.platform !== "win32") {
  const fakeBin = join(scratch, "bin");
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(fakeBin, "curl"), "#!/usr/bin/env bash\nout=''\nwhile [ $# -gt 0 ]; do case \"$1\" in -o) out=\"$2\"; shift 2;; *) shift;; esac; done\nprintf '{\"status\":\"ok\"}' > \"$out\"\nprintf '200'\n");
  chmodSync(join(fakeBin, "curl"), 0o755);
  const tmp = join(scratch, "tmp").replace(/\\/g, "/");
  mkdirSync(tmp, { recursive: true });
  const go = (s, subst, env) => {
    const out = join(scratch, "gh-output-" + Math.random().toString(36).slice(2));
    writeFileSync(out, "");
    const script = s.script.replace(/\/tmp\//g, tmp + "/").replace(/\$\{\{ steps\.probe\.outputs\.rc \}\}/g, subst);
    const r = bash(script, { env: { PATH: fakeBin + ":" + process.env.PATH, GITHUB_OUTPUT: out, PILOT_TOKEN: "", ...(env || {}) } });
    return { status: r.status, stdout: r.stdout, gh: readFileSync(out, "utf8") };
  };
  const pr = go(probe, "");
  ok(pr.status === 0 && /rc=health-ok-no-pilot-token/.test(pr.gh) && !/::warning::/.test(pr.stdout) && /^PILOT_TOKEN unavailable/m.test(pr.stdout) && levels(pr.stdout, "warning").length === 0, "probe without PILOT_TOKEN: records health-ok-no-pilot-token and prints the explanation as a line of its own, with no workflow command in the output", { status: pr.status, out: pr.stdout, gh: pr.gh });
  const amber = go(verdict, "health-ok-no-pilot-token");
  ok(amber.status === 0 && /rc=AMBER/.test(amber.gh), "verdict for health-only: the AMBER verdict is still recorded for the outcome artifact", amber);
  ok(levels(amber.stdout, "warning").length === 0 && levels(amber.stdout, "error").length === 0 && levels(amber.stdout, "notice").length === 1 && /AMBER: \/health 200 but \/status unverified/.test(amber.stdout), "AMBER (the steady state while PILOT_TOKEN is not provisioned in Actions secrets) is one notice, not a warning", runnerCommands(amber.stdout).cmds);
  const red = go(verdict, "health-failed");
  ok(/rc=RED/.test(red.gh) && levels(red.stdout, "error").length === 1 && /RED: container fleet is NOT demonstrably alive \(probe_rc=health-failed\)/.test(red.stdout), "RED is still an error annotation: a real outage stays loud", runnerCommands(red.stdout).cmds);
  const green = go(verdict, "ok");
  ok(/rc=GREEN/.test(green.gh) && runnerCommands(green.stdout).cmds.length === 0, "GREEN is recorded and prints no annotation");
}

// ---- 4. ci-watchdog: the group follows the job's own predicate ---------------------------------------------------------------------
const wd = rd(".github/workflows/ci-watchdog.yml");
const grpM = /^concurrency:\n  group: (.+)\n  cancel-in-progress: (\w+)$/m.exec(wd);
const ifM = /^    if: >-\n((?:      .*\n)+)/m.exec(wd);
ok(grpM && grpM[2] === "false", "ci-watchdog keeps cancel-in-progress: false (a running sweep is never cancelled)", grpM && grpM[2]);
ok(ifM, "the job's if: predicate was read");
if (grpM && ifM) {
  const ghExpr = (s) => { const m = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(s.trim()); return m ? m[1] : s.trim(); };
  const groupExpr = /^\$\{\{/.test(grpM[1].trim()) ? ghExpr(grpM[1]) : JSON.stringify(grpM[1].trim());   // a plain group name is a string literal
  const ifExpr = ifM[1].split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
  const fns = {
    fromJSON: (s) => JSON.parse(s),
    contains: (a, b) => (Array.isArray(a) ? a.some((x) => String(x).toLowerCase() === String(b).toLowerCase()) : String(a).toLowerCase().includes(String(b).toLowerCase())),
    format: (f, ...a) => String(f).replace(/\{(\d+)\}/g, (_, i) => a[Number(i)]),
  };
  const evalExpr = (expr, github) => new Function("github", "fromJSON", "contains", "format", "return (" + expr + ");")(github, fns.fromJSON, fns.contains, fns.format);
  const mk = (event_name, name, conclusion, run_id) => ({ event_name, run_id, event: event_name === "workflow_run" ? { workflow_run: { name, conclusion } } : {} });
  const grid = [];
  for (const ev of ["workflow_dispatch", "repository_dispatch"]) grid.push(mk(ev, "", null, 1));
  for (const name of ["mirror-sync", "mirror-guard", "deploy-gate", "code-loop-test"]) for (const c of ["success", "failure", "cancelled", "skipped", "neutral", "timed_out", "startup_failure", "action_required", "stale"]) grid.push(mk("workflow_run", name, c, 1));
  let mismatch = [];
  for (const g of grid) {
    const runs = evalExpr(ifExpr, g);
    const group = evalExpr(groupExpr, g);
    if ((group === "ci-watchdog") !== Boolean(runs)) mismatch.push([g.event_name, g.event.workflow_run && g.event.workflow_run.name, g.event.workflow_run && g.event.workflow_run.conclusion, runs, group]);
  }
  ok(grid.length === 38 && mismatch.length === 0, "for every trigger, the run joins the shared `ci-watchdog` group exactly when its job would run; a run whose job is skipped does not", mismatch.slice(0, 5));
  const skipA = evalExpr(groupExpr, mk("workflow_run", "deploy-gate", "success", 111)), skipB = evalExpr(groupExpr, mk("workflow_run", "deploy-gate", "success", 222));
  ok(skipA !== skipB && skipA !== "ci-watchdog" && skipB !== "ci-watchdog", "two skipped runs get two different groups, so neither can replace the other or a waiting sweep", [skipA, skipB]);
  ok(evalExpr(groupExpr, mk("workflow_run", "mirror-sync", "success", 7)) === "ci-watchdog" && evalExpr(groupExpr, mk("workflow_run", "deploy-gate", "failure", 7)) === "ci-watchdog" && evalExpr(groupExpr, mk("workflow_dispatch", "", null, 7)) === "ci-watchdog", "a mirror-sync completion, a failed watched run and a dispatch still share the one repository-wide group (ACTIONS-QUOTA-1: one sweep runs, one waits)");
  const norm = groupExpr.replace(/\\"/g, '"');
  ok(/event_name != 'workflow_run'/.test(norm) && /workflow_run\.name == 'mirror-sync'/.test(norm) && /!contains\(fromJSON\(/.test(norm) && ["success", "cancelled", "skipped", "neutral"].every((c) => norm.includes('"' + c + '"')), "the group expression is the job's predicate, term for term (the same three conditions and the same four ignored conclusions)", groupExpr);
}

// ---- 5. qnfo-fleet-advisor (folded): undici override ------------------------------------------------------------------------------
const pkg = JSON.parse(rd("qnfo-fleet-advisor/package.json"));
const minVer = (spec) => { const m = /^[\^~>=\s]*(\d+)\.(\d+)\.(\d+)/.exec(String(spec || "")); return m ? m.slice(1).map(Number) : null; };
const ge = (a, b) => a && b && (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) >= 0;
ok(pkg.overrides && ge(minVer(pkg.overrides.undici), [7, 29, 1]) && minVer(pkg.overrides.undici)[0] === 7, "qnfo-fleet-advisor overrides undici to 7.29.1 or later within 7.x, the first fixed version (agents and @cloudflare/think pin 7.29.0 through guarded-fetch)", pkg.overrides);
ok(pkg.name === "qnfo-fleet-advisor" && pkg.private === true && pkg.dependencies && pkg.dependencies.agents === "^0.30.1" && pkg.dependencies["@cloudflare/think"] === "^0.21.0" && pkg.dependencies.ai === "^7.0.93" && Object.keys(pkg.dependencies).length === 3 && !Object.hasOwn(pkg.dependencies, "workers-ai-provider"), "the manifest retains the PR 4132 dependency upgrades without the deprecated workers-ai-provider");
ok(existsSync(join(root, "qnfo-fleet-advisor", "FOLDED")) && /FOLDED into qnfo-fleet-control/.test(rd("qnfo-fleet-advisor/FOLDED")), "the FOLDED marker is kept: the directory is still never deployed");

rmSync(scratch, { recursive: true, force: true });
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
