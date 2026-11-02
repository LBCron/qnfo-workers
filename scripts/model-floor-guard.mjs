// model-floor-guard.mjs - MODEL-FLOOR-1 enforcement (RECURRENCE-ZERO-1 gate).
// Scans repo worker sources AND live deployed bundles for banned (sub-frontier) models.
// Exit 0 = clean; exit 1 = code-level violation; exit 2 = the scan could not read what it must scan (PR-GUARD-FIXES-1 below) or the
// policy table is malformed. Comment mentions + BANNED-list declarations are skipped (a comment may name a banned model only for
// documentation).
//
// Usage:
//   node model-floor-guard.mjs                 # repo scan (default)
//   node model-floor-guard.mjs --live          # repo + live bundles
//   node model-floor-guard.mjs --json          # machine-readable summary
//   node model-floor-guard.mjs --base <dir>    # pull-request mode: only violations added against the tree in <dir>
//   node model-floor-guard.mjs --unlisted      # also list pinned @cf/ model ids that are in neither BANNED nor the allowed table
//   node model-floor-guard.mjs --strict-allowed  # exit 1 when a worker pins an @cf/ model id that is not in the allowed table
//   node model-floor-guard.mjs --policy <file> # read the allowed table from <file> instead of scripts/model-policy.json
//
// FOLDED-AND-RETIRED-MODEL-COVERAGE-1 (agent_issues 2831): a directory carrying a RETIRED marker is not deployed and is not scanned; a
// directory carrying a FOLDED marker runs inside a host bundle, so its findings name that host (the marker text says "FOLDED into <host>").
// MODEL-POLICY-SINGLE-SOURCE-1 (agent_issues 2833): scripts/model-policy.json carries an `allowed` table (id, family, wa, ctx, reasoning)
// that this guard reads next to BANNED: every row is validated, a row that matches a BANNED rule is a conflict (exit 2), and a pinned
// `@cf/` id that is not in the table is reported (`--unlisted`) or fails the run (`--strict-allowed`).
// PR-GUARD-FIXES-1 (2026-10-20, agent_issues 100295): a failure to READ is not a finding. The repo root defaulted to the owner's laptop path,
// so a run without QNFO_WORKERS scanned nothing and exited 1 with a sentinel row "(repo unreadable)" that the exit code counted as a
// violation; "(no CF token)" and "(live list failed)" did the same, while a live bundle that answered an error or threw was skipped
// without a trace, so a partial live sweep could pass. Now the root defaults to the directory above this script (QNFO_WORKERS still wins,
// and CI sets it), and an unreadable root, a root with no <dir>/worker.js, an unreadable worker.js, a missing token, a failed or empty
// worker list and any live bundle that could not be read (after one retry of a network error, 429 or 5xx) are reported as "cannot read"
// and exit 2: never green, and never confused with a banned model. A finding still exits 1 when both occur.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const REPO = process.env.QNFO_WORKERS || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCT = process.env.CF_ACCOUNT_ID || "edb167b78c9fb901ea5bca3ce58ccc4b";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_API = "https://api.cloudflare.com/client/v4";
const LIVE_RETRY_MS = 250;

// PR-GUARD-FIXES-1: the scan could not read its input. `what` names the input (repo-root, worker-source, live-token, live-list); main()
// reports it as "cannot read" and exits 2, so a read failure is never a finding and never a pass.
class GuardReadError extends Error {
  constructor(what, detail) { super(detail); this.name = "GuardReadError"; this.what = what; this.detail = detail; }
}
// 0 clean; 1 at least one finding (a finding is certain, an unread input is not); 2 nothing found but part of the input was not read.
function exitCode(found, unread) { return found > 0 ? 1 : (unread > 0 ? 2 : 0); }
const errText = (e) => String((e && (e.code || e.message)) || e).slice(0, 120);

const BANNED = [
  { label: "llama", re: /(@cf\/(meta|meta-llama)\/llama[\w.-]*|\bllama-[\d.]+[\w.-]*)/i },
  { label: "mistral-7b", re: /(@cf\/mistral\/mistral-7b[\w.-]*|mistral-7b[\w.-]*)/i },
  { label: "gemma-small", re: /(@cf\/google\/gemma-(2b|7b|3-12b)[\w.-]*|gemma-(2b|7b|3-12b)[\w.-]*)/i },
  { label: "qwen2.5-coder-32b", re: /qwen2\.5-coder-32b[\w.-]*/i },
  { label: "qwen3-30b", re: /qwen3-30b[\w.-]*/i },
  { label: "qwq-32b", re: /qwq-32b[\w.-]*/i },
  { label: "r1-distill-32b", re: /deepseek-r1-distill-qwen-32b[\w.-]*/i },
  { label: "gemma-4-26b", re: /gemma-4-26b(?!-a4b-it(?:$|[^\w.-]))[\w.-]*/i },
  { label: "glm-4.7-flash", re: /glm-4\.7-flash[\w.-]*/i },
  { label: "glm-5.2", re: /glm-5\.2(?![\d.])[\w.-]*/i },
];

// MODEL-FLOOR-1 precision (2026-10-17): a model name in a TRAILING comment is documentation, not a selection.
// The old scan tested the whole line, so `var VERSION = "1.5.5"; // ... probes llama ...` and every
// `/* 1.5.1 ... llama ... */` note was reported as a code-level violation (ai-health-prober:6,
// qnfo-ai-calibration:6/857, qnfo-intent-orchestrator:8). Strip the trailing line comment first, honouring
// quotes so a `//` inside a string is not mistaken for one.
function codePart(line) {
  let out = "";
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      out += ch;
      if (ch === "\\") { out += line[i + 1] || ""; i++; } else if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { q = ch; out += ch; continue; }
    if (ch === "/" && line[i + 1] === "/") break;                       // line comment to EOL
    if (ch === "/" && line[i + 1] === "*") {                            // inline block comment
      const end = line.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 1;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

// A price/attribution/cap table names a model to PRICE or DESCRIBE it, not to call it: `var __AI_ATTR_RATES = {
// "@cf/...": [in, out] }`, `var REASONING_TOKENS = {...}`, `COST_TIER_PRICES`, and a bare `"<model id>": <value>`
// row. 18 of the 65 findings on 2026-10-17 were these rows. A list of ids to call (`PANEL_POOL`, `models: [...]`,
// `HEDGE_ORDER`) is NOT exempt: its key is not a model id, so it still has to name frontier models only.
const TABLE_VAR_RE = /(?:^|[\s({,])(?:(?:var|let|const)\s+)?[A-Za-z_$][\w$]*(?:RATES|PRICES|TOKENS|CAPS|ALIASES|VENDOR|CATALOG|META|COSTS|TIERS)\s*=/;
const MODEL_KEY_ROW_RE = /^\s*["']?[@a-z0-9][\w.@/\/-]*["']?\s*:\s*[\[{"'\d]/;
const MODEL_IDLIKE_RE = /^(?:@cf\/|llama|qwen|gemma|glm|kimi|deepseek|gpt-oss|mistral|qwq|nemotron|bge)/i;
function isDeclRow(code) {
  if (TABLE_VAR_RE.test(code)) return true;
  const m = MODEL_KEY_ROW_RE.exec(code);
  if (!m) return false;
  const key = m[0].replace(/[\s:"']/g, "");
  return MODEL_IDLIKE_RE.test(key);
}

// MODEL-POLICY-SINGLE-SOURCE-1: the allowed-model table. One row per model id a worker may select: `id` the router alias, `family` the
// vendor family (panels count families), `wa` the Workers AI id a worker pins, `ctx` the context window in tokens and `reasoning`
// whether it spends output tokens on thought. The rows are seeded from the qnfo-ai router catalog (MODELS in qnfo-ai/worker.js).
const POLICY_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "model-policy.json");

function loadPolicy(file) {
  let text;
  try { text = fs.readFileSync(file || POLICY_FILE, "utf8"); } catch { return { allowed: [], problems: [], found: false }; }
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { allowed: [], problems: ["policy file is not valid JSON: " + (e && e.message)], found: true }; }
  const allowed = Array.isArray(doc && doc.allowed) ? doc.allowed : [];
  return { allowed, problems: validateAllowed(allowed), found: true };
}

// A row is well formed (string id, family and @cf/ wa; positive integer ctx; boolean reasoning), unique by id and wa, and matches no
// BANNED rule: the table may not re-admit what BANNED forbids, so the two cannot drift apart silently.
function validateAllowed(allowed) {
  const problems = [];
  const ids = new Set(), was = new Set();
  allowed.forEach((r, i) => {
    const at = "allowed[" + i + "]" + (r && r.id ? " (" + r.id + ")" : "");
    if (!r || typeof r !== "object") { problems.push(at + " is not an object"); return; }
    if (typeof r.id !== "string" || !r.id) problems.push(at + " has no string id");
    if (typeof r.family !== "string" || !r.family) problems.push(at + " has no string family");
    if (typeof r.wa !== "string" || !/^@cf\/[\w.-]+\/[\w.-]+$/.test(r.wa)) problems.push(at + " wa is not an @cf/<vendor>/<model> id");
    if (!Number.isInteger(r.ctx) || r.ctx <= 0) problems.push(at + " ctx is not a positive integer");
    if (typeof r.reasoning !== "boolean") problems.push(at + " reasoning is not a boolean");
    if (typeof r.id === "string") { if (ids.has(r.id)) problems.push(at + " duplicates an id"); ids.add(r.id); }
    if (typeof r.wa === "string") { if (was.has(r.wa)) problems.push(at + " duplicates a wa id"); was.add(r.wa); }
    for (const field of [r.id, r.wa]) {
      if (typeof field !== "string") continue;
      const b = BANNED.find((x) => x.re.test(field));
      if (b) { problems.push(at + " conflicts with BANNED [" + b.label + "]: " + field); break; }
    }
  });
  return problems;
}

// `@cf/<vendor>/<model>` ids a worker pins in code (comments, BANNED lists and price/attribution rows are not selections) that the
// allowed table does not list and BANNED does not already report. Embedding, speech and image models are not text-generation
// selections, so they are not part of this table.
const CF_ID_RE = /@cf\/[a-z0-9_.-]+\/[\w.-]+/gi;
const NON_TEXT_RE = /@cf\/(baai|openai\/whisper|deepgram|myshell-ai|black-forest-labs|leonardo|lykon|runwayml|stabilityai|bytedance|pfnet|facebook|huggingface|microsoft\/resnet|unum)\b|-(embed|embedding|reranker)\b|\b(bge|whisper|melotts|flux|aura|nova|stable-diffusion)-/i;
function scanUnlisted(text, allowed) {
  const wa = new Set((allowed || []).map((r) => String(r.wa || "").toLowerCase()));
  const out = [];
  const lines = String(text).split(/\r?\n/);
  let inBanList = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], t = line.trim();
    if (/\b(BANNED|DENY|BLOCK|FORBID)[\w_]*\s*=/.test(line)) inBanList++;
    else if (inBanList > 0 && /\]/.test(line)) inBanList = Math.max(0, inBanList - 1);
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    const code = codePart(line);
    if (!code || inBanList > 0 || isDeclRow(code) || line.indexOf("MODEL-FLOOR-OK") >= 0) continue;
    for (const m of code.match(CF_ID_RE) || []) {
      const id = m.replace(/[.-]+$/, "");
      if (wa.has(id.toLowerCase()) || NON_TEXT_RE.test(id) || BANNED.some((b) => b.re.test(id))) continue;
      out.push({ line: i + 1, id, text: t.slice(0, 110) });
    }
  }
  return out;
}

function scan(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let inBanList = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (/\b(BANNED|DENY|BLOCK|FORBID)[\w_]*\s*=/.test(line)) inBanList++;
    else if (inBanList > 0 && /\]/.test(line)) inBanList = Math.max(0, inBanList - 1);
    const isComment = t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
    const isOk = line.indexOf("MODEL-FLOOR-OK") >= 0;
    const code = isComment ? "" : codePart(line);
    if (!code) continue;
    const isBanCtx = inBanList > 0 || /\b(BANNED|DENY|BLOCK|FORBID)[\w_]*\b/i.test(line) || isDeclRow(code);
    for (const b of BANNED) {
      if (b.re.test(code)) {
        const kind = (isOk || isBanCtx) ? "banlist" : "VIOLATION";
        out.push({ line: i + 1, label: b.label, kind, text: t.slice(0, 110) });
        break;
      }
    }
  }
  return out;
}

export { BANNED, scan, scanUnlisted, loadPolicy, validateAllowed };

// MODEL-FLOOR-PREMERGE-1 (2026-10-19, agent_issues 100121): a pull request fails only for a violation it ADDS. A violation is the
// worker, the banned label and the trimmed source text, so a hit that moves lines is not new and debt already on the base branch
// never blocks an unrelated pull request. diffViolations(head, base) takes two scanRepo() results and returns the added rows.
function violationKeys(rows) {
  const keys = new Set();
  for (const r of rows || []) for (const h of r.hits || []) keys.add(r.name + "|" + h.label + "|" + String(h.text || "").trim());
  return keys;
}
function diffViolations(head, base) {
  const known = violationKeys(base);
  const out = [];
  for (const r of head || []) {
    const added = (r.hits || []).filter((h) => !known.has(r.name + "|" + h.label + "|" + String(h.text || "").trim()));
    if (added.length) out.push(r.folded ? { name: r.name, folded: true, host: r.host || null, hits: added } : { name: r.name, hits: added });
  }
  return out;
}
export { diffViolations, violationKeys };

// FOLDED-AND-RETIRED-MODEL-COVERAGE-1: marker files. A RETIRED directory is not deployed (its code reaches no bundle), so it is not
// scanned. A FOLDED directory is a member of a host bundle: the marker says "<name> is FOLDED into <host>" (or "folded into <host>"), or, for
// the 2026-10-01 markers, "Its duties live in <host>" where <host> is a worker directory. A marker that names no host leaves host null; the
// member is still scanned, because its code is live inside some bundle, and its findings say the host is unnamed.
function foldedHost(text, workerDirs) {
  const t = String(text || "");
  let m = /\bFOLDED\s+into\s+([a-z0-9][\w-]*)/i.exec(t);
  if (m) return m[1];
  m = /\bduties\s+(?:now\s+)?(?:live|run)s?\s+(?:in|inside)\s+([a-z0-9][\w-]*)/i.exec(t);
  if (m && (!workerDirs || workerDirs.has(m[1]))) return m[1];
  return null;
}

function listWorkerDirs(base) {
  try { return fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return null; }
}

// { retired: [dir], folded: [{ name, host }] } for the worker directories under root (a directory with both markers counts as retired).
function repoMarkers(root) {
  const base = root || REPO;
  const out = { retired: [], folded: [] };
  const dirs = listWorkerDirs(base) || [];
  const set = new Set(dirs);
  for (const d of dirs) {
    if (fs.existsSync(path.join(base, d, "RETIRED"))) { out.retired.push(d); continue; }
    const fm = path.join(base, d, "FOLDED");
    if (!fs.existsSync(fm)) continue;
    let text = "";
    try { text = fs.readFileSync(fm, "utf8"); } catch {}
    out.folded.push({ name: d, host: foldedHost(text, set) });
  }
  return out;
}

// The worker directories under base. An unreadable root, or a root that holds no <dir>/worker.js at all (a wrong QNFO_WORKERS, or this
// script copied away from its repository), reads nothing and must not pass as clean.
function readRoot(base) {
  let dirs;
  try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch (e) { throw new GuardReadError("repo-root", base + " (" + errText(e) + "); set QNFO_WORKERS to a checkout of qnfo-workers"); }
  if (!dirs.some((d) => fs.existsSync(path.join(base, d, "worker.js")))) throw new GuardReadError("repo-root", base + " holds no <dir>/worker.js; set QNFO_WORKERS to a checkout of qnfo-workers");
  return dirs;
}

function scanRepo(root) {
  const base = root || REPO;
  const res = [];
  const dirs = readRoot(base);
  const markers = repoMarkers(base);
  const retired = new Set(markers.retired);
  const folded = new Map(markers.folded.map((x) => [x.name, x.host]));
  for (const d of dirs) {
    if (retired.has(d)) continue;                                       // not deployed: nothing to attribute
    const f = path.join(base, d, "worker.js");
    if (!fs.existsSync(f)) continue;
    let text;
    try { text = fs.readFileSync(f, "utf8"); } catch (e) { throw new GuardReadError("worker-source", f + " (" + errText(e) + ")"); }
    const hits = scan(text);
    const v = hits.filter((h) => h.kind === "VIOLATION");
    if (!v.length) continue;
    res.push(folded.has(d) ? { name: d, folded: true, host: folded.get(d), hits: v } : { name: d, hits: v });
  }
  return res;
}

// The deployed artifact each finding belongs to: a worker is its own artifact, a FOLDED member rolls up to its host (or "(unnamed host)").
function byArtifact(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const key = r.folded ? (r.host || "(unnamed host)") : r.name;
    const a = m.get(key) || { artifact: key, own: 0, members: [] };
    if (r.folded) a.members.push({ name: r.name, hits: r.hits.length }); else a.own += r.hits.length;
    m.set(key, a);
  }
  return [...m.values()].sort((a, b) => a.artifact.localeCompare(b.artifact));
}
export { foldedHost, repoMarkers, byArtifact, scanRepo };

// The allowed-table check over the repo: pinned @cf/ ids in worker.js files that are not in the table (RETIRED directories skipped).
function scanRepoUnlisted(root, allowed) {
  const base = root || REPO;
  const res = [];
  const dirs = listWorkerDirs(base) || [];
  const retired = new Set(repoMarkers(base).retired);
  for (const d of dirs) {
    if (retired.has(d)) continue;
    const f = path.join(base, d, "worker.js");
    if (!fs.existsSync(f)) continue;
    const hits = scanUnlisted(fs.readFileSync(f, "utf8"), allowed);
    if (hits.length) res.push({ name: d, hits });
  }
  return res;
}
export { scanRepoUnlisted };

// The live sweep: every worker script of the account, fetched and scanned. opts (tests inject them): token, acct, fetchImpl, sleep, members, allowed.
// Returns { findings, unreadable: [{ name, why }], scanned }. A missing token and a failed, non-200 or empty worker list throw GuardReadError
// (the sweep read nothing); a bundle that cannot be fetched, after one retry of a network error, 429 or 5xx, is listed in `unreadable`, never
// skipped.
const DYNAMIC_MODEL_ROUTES = new Set(["dynamic/value", "dynamic/standard", "dynamic/premium"]);

function configurableDefaultLine(text, hits) {
  if (!/\benv\.AI_MODEL\s*\|\|\s*DEFAULT_MODEL\b/.test(text)) return null;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(?:const|let|var)\s+DEFAULT_MODEL\s*=\s*(["'])([^"']+)\1\s*;?\s*$/.exec(lines[i]);
    if (!match) continue;
    const banned = BANNED.find((b) => b.re.test(match[2]));
    if (!banned || !hits.some((h) => h.line === i + 1 && h.label === banned.label)) continue;
    const remainder = codePart(lines[i]).replace(match[0], "");
    if (BANNED.some((b) => b.re.test(remainder))) continue;
    return i + 1;
  }
  return null;
}

function hasAllowedModelBinding(bindings, allowed) {
  const binding = bindings.find((b) => b && b.name === "AI_MODEL" && b.type === "plain_text");
  if (!binding || typeof binding.text !== "string" || !binding.text.trim()) return false;
  const model = binding.text.trim().toLowerCase();
  if (BANNED.some((b) => b.re.test(model))) return false;
  return DYNAMIC_MODEL_ROUTES.has(model) || (allowed || []).some((r) =>
    [r.id, r.wa].some((id) => typeof id === "string" && id.toLowerCase() === model));
}

async function scanLive(opts) {
  const o = opts || {};
  const token = "token" in o ? o.token : TOKEN;
  const acct = o.acct || ACCT;
  const doFetch = o.fetchImpl || globalThis.fetch;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const allowed = o.allowed || [];
  if (!token) throw new GuardReadError("live-token", "CLOUDFLARE_API_TOKEN is not set; the live sweep needs it to list the worker scripts");
  const auth = { headers: { Authorization: "Bearer " + token } };
  let list;
  try {
    const r = await doFetch(CF_API + "/accounts/" + acct + "/workers/scripts", auth);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const body = await r.json();
    if (!body || !Array.isArray(body.result)) throw new Error("the answer has no result list");
    list = body.result.map((x) => x && x.id).filter(Boolean).sort();
  } catch (e) { throw new GuardReadError("live-list", "the account's worker scripts (" + errText(e) + ")"); }
  if (!list.length) throw new GuardReadError("live-list", "the account lists no worker scripts, so the live sweep would read nothing");
  // A live bundle that hosts FOLDED members names them, so a hit inside it can be traced to the member directory that carries the same text.
  const liveMembers = o.members || {};
  if (!o.members) for (const f of repoMarkers().folded) if (f.host) (liveMembers[f.host] = liveMembers[f.host] || []).push(f.name);
  const fetchBundle = async (name) => {
    let why = "no answer";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await doFetch(CF_API + "/accounts/" + acct + "/workers/scripts/" + name + "/content/v2", auth);
        if (r.ok) return { text: await r.text() };
        why = "HTTP " + r.status;
        if (r.status !== 429 && r.status < 500) break;                  // a refusal is final; a rate limit or a server error is tried once more
      } catch (e) { why = errText(e); }
      if (attempt === 0) await sleep(LIVE_RETRY_MS);
    }
    return { why };
  };
  const fetchSettings = async (name) => {
    let why = "no answer";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await doFetch(CF_API + "/accounts/" + acct + "/workers/scripts/" + name + "/settings", auth);
        if (!r.ok) {
          why = "HTTP " + r.status;
          if (r.status !== 429 && r.status < 500) break;
        } else {
          const body = await r.json();
          if (body && body.success === true && body.result && Array.isArray(body.result.bindings)) return { bindings: body.result.bindings };
          return { why: "malformed settings response" };
        }
      } catch (e) { why = errText(e); }
      if (attempt === 0) await sleep(LIVE_RETRY_MS);
    }
    return { why };
  };
  const findings = [], unreadable = [];
  const cap = 6;
  for (let i = 0; i < list.length; i += cap) {
    const chunk = list.slice(i, i + cap);
    await Promise.all(chunk.map(async (name) => {
      const got = await fetchBundle(name);
      if (got.text === undefined) { unreadable.push({ name, why: got.why }); return; }
      let hits = scan(got.text).filter((h) => h.kind === "VIOLATION");
      const fallbackLine = configurableDefaultLine(got.text, hits);
      if (fallbackLine !== null) {
        const settings = await fetchSettings(name);
        if (settings.why) { unreadable.push({ name, why: "settings " + settings.why }); }
        else if (hasAllowedModelBinding(settings.bindings, allowed)) hits = hits.filter((h) => h.line !== fallbackLine);
      }
      if (hits.length) findings.push({ name, members: liveMembers[name] || [], hits });
    }));
  }
  findings.sort((a, b) => a.name.localeCompare(b.name));
  unreadable.sort((a, b) => a.name.localeCompare(b.name));
  return { findings, unreadable, scanned: list.length - unreadable.length };
}
export { GuardReadError, exitCode, scanLive };

// ENTRY-POINT-1 (2026-10-17): run the scan only when this file IS the process entry point, and compare paths
// portably. `import.meta.url === "file://" + process.argv[1]` (the pattern run-suites.mjs had) never matches on
// Windows, so the script printed nothing and exited 0 - a silent pass. pathToFileURL normalises both sides.
// The module also exports scan/BANNED so an audit script can reuse the exact rules instead of a copy.
function isEntry() {
  try { return import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; }
}

// An unlisted id a pull request ADDS (worker and id are the key; a hit that moves lines is not new).
function diffUnlisted(head, base) {
  const known = new Set();
  for (const r of base || []) for (const h of r.hits) known.add(r.name + "|" + h.id);
  const out = [];
  for (const r of head || []) {
    const added = r.hits.filter((h) => !known.has(r.name + "|" + h.id));
    if (added.length) out.push({ name: r.name, hits: added });
  }
  return out;
}
export { diffUnlisted };

const rowLabel = (r) => r.name + (r.folded ? " (FOLDED into " + (r.host || "an unnamed host") + ")" : "");
const argValue = (flag) => { const k = process.argv.indexOf(flag); return k > 0 ? process.argv[k + 1] : undefined; };

async function run() {
  const wantLive = process.argv.includes("--live");
  const wantJson = process.argv.includes("--json");
  const strictAllowed = process.argv.includes("--strict-allowed");
  const wantUnlisted = strictAllowed || process.argv.includes("--unlisted");

  // MODEL-POLICY-SINGLE-SOURCE-1: the allowed table is read next to BANNED; a malformed row or one that re-admits a banned model is a
  // configuration error (exit 2), never a silent pass.
  const policy = loadPolicy(argValue("--policy"));
  if (policy.problems.length) {
    if (wantJson) console.log(JSON.stringify({ policy_problems: policy.problems }, null, 1));
    else { console.log("== MODEL POLICY (" + policy.problems.length + " problems in the allowed table)"); for (const p of policy.problems) console.log("  " + p); }
    process.exit(2);
  }

  const bi = process.argv.indexOf("--base");
  if (bi > 0) {
    // Pull-request mode: scan the checked-out tree and the base tree, report only what the change adds.
    const baseDir = process.argv[bi + 1];
    if (!baseDir || !fs.existsSync(baseDir)) { console.log("model-floor-guard --base: base directory not found: " + baseDir); process.exit(2); }
    const added = diffViolations(scanRepo(), scanRepo(baseDir));
    const addedUnlisted = strictAllowed ? diffUnlisted(scanRepoUnlisted(undefined, policy.allowed), scanRepoUnlisted(baseDir, policy.allowed)) : [];
    if (wantJson) console.log(JSON.stringify({ added, added_unlisted: addedUnlisted }, null, 1));
    else {
      console.log("== ADDED BY THIS CHANGE (" + added.length + " workers with new code-level violations against the base)");
      for (const r of added) { console.log("  " + rowLabel(r)); for (const h of r.hits.slice(0, 6)) console.log("      L" + h.line + " [" + h.label + "] " + h.text); }
      if (strictAllowed) {
        console.log("== ADDED UNLISTED MODEL IDS (" + addedUnlisted.length + " workers pin an @cf/ id that is not in the allowed table)");
        for (const r of addedUnlisted) { console.log("  " + r.name); for (const h of r.hits.slice(0, 6)) console.log("      L" + h.line + " " + h.id); }
      }
    }
    process.exit(added.length + addedUnlisted.length > 0 ? 1 : 0);
  }
  const repo = scanRepo();
  const sweep = wantLive ? await scanLive({ allowed: policy.allowed }) : { findings: [], unreadable: [], scanned: 0 };
  const live = sweep.findings;
  const markers = repoMarkers();
  const unlisted = wantUnlisted ? scanRepoUnlisted(undefined, policy.allowed) : [];

  if (wantJson) {
    const out = { repo, live, artifacts: byArtifact(repo), markers: { retired_skipped: markers.retired, folded: markers.folded } };
    if (wantLive) { out.live_scanned = sweep.scanned; out.live_unreadable = sweep.unreadable; }
    if (wantUnlisted) out.unlisted = unlisted;
    console.log(JSON.stringify(out, null, 1));
  } else {
    const show = (title, rows) => {
      console.log("== " + title + " (" + rows.length + " workers with code-level violations)");
      for (const r of rows) {
        console.log("  " + rowLabel(r));
        for (const h of r.hits.slice(0, 6)) console.log("      L" + h.line + " [" + h.label + "] " + h.text);
      }
    };
    show("REPO SOURCES", repo);
    if (wantLive) {
      show("LIVE BUNDLES", live);
      console.log("== LIVE SWEEP: " + sweep.scanned + " bundles read, " + sweep.unreadable.length + " not read");
      for (const u of sweep.unreadable) console.log("  cannot read " + u.name + " (" + u.why + ")");
    }
    if (repo.some((r) => r.folded)) {
      console.log("== BY DEPLOYED ARTIFACT (FOLDED members roll up to the host bundle that runs them)");
      for (const a of byArtifact(repo)) console.log("  " + a.artifact + ": " + a.own + " own hits" + (a.members.length ? "; members " + a.members.map((m) => m.name + " " + m.hits).join(", ") : ""));
    }
    console.log("== MARKERS: " + markers.retired.length + " RETIRED directories not scanned, " + markers.folded.length + " FOLDED members (" + markers.folded.filter((f) => f.host).length + " name a host)");
    if (wantUnlisted) {
      console.log("== UNLISTED MODEL IDS (" + unlisted.length + " workers pin an @cf/ id that is not in the allowed table of " + policy.allowed.length + " models)");
      for (const r of unlisted) { console.log("  " + r.name); for (const h of r.hits.slice(0, 6)) console.log("      L" + h.line + " " + h.id); }
    }
  }

  const total = repo.length + live.length + (strictAllowed ? unlisted.length : 0);
  process.exit(exitCode(total, sweep.unreadable.length));
}

// PR-GUARD-FIXES-1: an input the scan could not read ends the run as "cannot read ..." with exit 2, apart from a finding (exit 1).
async function main() {
  try { await run(); } catch (e) {
    if (!(e instanceof GuardReadError)) throw e;
    if (process.argv.includes("--json")) console.log(JSON.stringify({ unreadable: [{ what: e.what, detail: e.detail }] }, null, 1));
    else console.log("model-floor-guard: cannot read " + e.what + ": " + e.detail);
    process.exit(2);
  }
}

if (isEntry()) await main();
