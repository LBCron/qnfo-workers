// FOLD-GUARD-PARITY-1 (qnfo-fleet-control 0.4.133, SCORER-HOST-DENY-1) offline suite. No network.
// A worker on the never-auto-merge list keeps that protection when it is folded: SCORER-FOLD-1 moved qnfo-autonomy-scorer
// (denied, because it computes the scores the fleet is graded by) into qnfo-observability, which no list named, so the
// planner and the merge runner accepted changes to the scoring formula. This suite reads every FOLDED marker in the
// repository ("<guest> is FOLDED into <host>" or "folded into <host>") and fails when a denied guest's host is not denied;
// it also holds the copies of the lists equal: fleet-control EVOLVE_DENY + the code loop (CM_CONTROL_PLANE), the transformation
// loop's TP_CONTROL_PLANE and the code orchestrator's PLAN_CONTROL_PLANE.
// CODE-LOOP-CONTROL-PLANE-1 (0.37.0): the owner named qnfo-fleet-control, qnfo-ops, qnfo-deploy-guard and the loop's own code; they are in
// CM_LOOP_CANARIED now, each with its canary entries (the check below), and the scorer host stays out.
// CONTROL-PLANE-FUNCTIONAL-CANARY-1 (0.20.0, agent_issues 2176): the code loop's deny list (CM_DENY, PLAN_DENY_WORKERS) is the
// control-plane list minus the workers whose canonical deploy runs a functional canary with an automatic revert
// (CM_LOOP_CANARIED = PLAN_LOOP_CANARIED). Every such worker must have a FUNCTIONAL entry and a CANARY_WORKERS entry in
// scripts/canary_revert.py and a CP_CANARY_WORKERS entry here, or the loop would merge a worker nothing reverts.
// Run: node qnfo-fleet-control/fold-guard.test.mjs   -> prints "N passed, 0 failed"
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fc = fs.readFileSync(path.join(root, "qnfo-fleet-control/worker.js"), "utf8");
const co = fs.readFileSync(path.join(root, "qnfo-code-orchestrator/worker.js"), "utf8");
const cr = fs.readFileSync(path.join(root, "scripts/canary_revert.py"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
const list = (src, re) => { const m = re.exec(src); return m ? JSON.parse(m[1]) : null; };
const evolveDeny = list(fc, /^var EVOLVE_DENY = (\[[^\]]*\]);$/m);
const cmExtra = list(fc, /^var CM_CONTROL_PLANE = EVOLVE_DENY\.concat\((\[[^\]]*\])\);$/m);
const cmCanaried = list(fc, /^var CM_LOOP_CANARIED = (\[[^\]]*\]);$/m);
const tpCp = list(fc, /^var TP_CONTROL_PLANE = (\[[^\]]*\]);$/m);
const cpCanary = list(fc, /^var CP_CANARY_WORKERS = (\[[^\]]*\]);$/m);
const planCp = list(co, /^const PLAN_CONTROL_PLANE = (\[[^\]]*\]);$/m);
const planCanaried = list(co, /^const PLAN_LOOP_CANARIED = (\[[^\]]*\]);$/m);
const pyList = (re) => { const m = re.exec(cr); return m ? m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean) : null; };
const canaryWorkers = pyList(/^CANARY_WORKERS = \[([^\]]*)\]$/m);
// DEPLOY-PROBES-1 (2026-11-04) moved the functional checks from a FUNCTIONAL table in canary_revert.py to <worker>/probes.json; a worker has a functional check when its probes.json exists and is non-empty.
const functional = fs.readdirSync(root).filter((d) => { const f = path.join(root, d, "probes.json"); try { return fs.statSync(f).size > 2; } catch (e) { return false; } });
ok(Array.isArray(evolveDeny) && Array.isArray(cmExtra) && Array.isArray(cmCanaried) && Array.isArray(tpCp) && Array.isArray(cpCanary) && Array.isArray(planCp) && Array.isArray(planCanaried) && Array.isArray(canaryWorkers) && functional.length > 0,
  "the lists parse", { evolveDeny, cmExtra, cmCanaried, tpCp, cpCanary, planCp, planCanaried, canaryWorkers, functional });
ok(/^var CM_DENY = CM_CONTROL_PLANE\.filter\(/m.test(fc) && /^const PLAN_DENY_WORKERS = PLAN_CONTROL_PLANE\.filter\(/m.test(co), "CM_DENY and PLAN_DENY_WORKERS are derived from the control-plane lists minus the canaried workers");
const cm = (evolveDeny || []).concat(cmExtra || []);
const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
ok(same(cm, tpCp || []), "TP_CONTROL_PLANE equals CM_CONTROL_PLANE (EVOLVE_DENY + the code loop)", { cm, tpCp });
ok(same(cm, planCp || []), "PLAN_CONTROL_PLANE equals CM_CONTROL_PLANE", { cm, planCp });
ok(same(cmCanaried || [], planCanaried || []), "PLAN_LOOP_CANARIED equals CM_LOOP_CANARIED", { cmCanaried, planCanaried });
ok((cmCanaried || []).every((w) => cm.includes(w)), "every canaried worker is a control-plane worker (the lane still pairs and canaries it)", cmCanaried);
ok((cmCanaried || []).every((w) => (cpCanary || []).includes(w) && (canaryWorkers || []).includes(w) && functional.includes(w)), "every canaried worker has a /health canary, a canary_revert.py CANARY_WORKERS entry and a FUNCTIONAL check", { cmCanaried, cpCanary, canaryWorkers, functional });
// CODE-LOOP-CONTROL-PLANE-1 (0.37.0, owner directive 2026-10-19): the code loop may always change the three verifier workers and its own
// orchestrator; the scorer host, the scorer and the container pilot are still denied.
for (const w of ["qnfo-fleet-control", "qnfo-ops", "qnfo-deploy-guard", "qnfo-code-orchestrator"]) ok((cmCanaried || []).includes(w), w + " is in the loop's scope (owner directive 2026-10-19)");
for (const w of ["qnfo-observability", "qnfo-autonomy-scorer", "qnfo-containers-pilot"]) ok(!(cmCanaried || []).includes(w), w + " (the scorer host, the scorer, the container pilot) is never canaried into the loop's scope");
// Every FOLDED marker that names a host.
const folds = [];
for (const d of fs.readdirSync(root)) {
  const f = path.join(root, d, "FOLDED");
  if (!fs.existsSync(f)) continue;
  const txt = fs.readFileSync(f, "utf8");
  const m = /\bis FOLDED into ([a-z0-9][a-z0-9-]+)/.exec(txt) || /\bfolded into ([a-z0-9][a-z0-9-]+)/i.exec(txt);
  if (m) folds.push({ guest: d, host: m[1] });
}
ok(folds.length >= 8, "the FOLDED markers that name a host are read (8 on 2026-10-06)", folds.length);
ok(folds.some((x) => x.guest === "qnfo-autonomy-scorer" && x.host === "qnfo-observability"), "the scorer's marker names qnfo-observability");
const holes = folds.filter((x) => cm.includes(x.guest) && !cm.includes(x.host));
ok(holes.length === 0, "every denied guest's host is denied (a fold never lifts the protection)", holes);
const deny = cm.filter((w) => !(cmCanaried || []).includes(w));
const denyHoles = folds.filter((x) => deny.includes(x.guest) && !deny.includes(x.host));
ok(denyHoles.length === 0, "every guest the loop may not touch has a host the loop may not touch", denyHoles);
ok(cm.includes("qnfo-observability") && deny.includes("qnfo-observability"), "qnfo-observability (the scorer's host) is on both lists");
// The merge runner refuses the host path, and the transformation loop routes its levers to a session.
const line = (k) => fc.slice(fc.indexOf(k), fc.indexOf("\n", fc.indexOf(k)));
const scope = new Function([line("var EVOLVE_DENY = "), line("var CM_CONTROL_PLANE = "), line("var CM_LOOP_CANARIED = "), line("var CM_DENY = ")].join("\n") + "\n" +
  fc.slice(fc.indexOf("function cmScope(path) {"), fc.indexOf("__name(cmScope")) + "\nreturn cmScope;")();
const r = scope("qnfo-observability/worker.js");
ok(r && r.ok === false && /never auto-merges/.test(r.why), "cmScope refuses qnfo-observability/worker.js", r);
ok(scope("qnfo-infra/worker.js").ok === true, "an ordinary worker is still in scope");
ok(scope("qnfo-ai/worker.js").ok === true && scope("qnfo-gateway/worker.js").ok === true, "cmScope accepts the canaried control-plane workers (CONTROL-PLANE-FUNCTIONAL-CANARY-1)");
ok(["qnfo-fleet-control", "qnfo-ops", "qnfo-deploy-guard", "qnfo-code-orchestrator"].every((w) => scope(w + "/worker.js").ok === true), "cmScope accepts the verifier workers and the orchestrator (CODE-LOOP-CONTROL-PLANE-1, owner directive 2026-10-19)");
ok(["qnfo-observability", "qnfo-autonomy-scorer", "qnfo-containers-pilot", "qnfo-code-agent"].every((w) => scope(w + "/worker.js").ok === false), "cmScope still refuses the scorer host, the scorer, the container pilot and the retired code agent");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
