// model-floor-guard.mjs - MODEL-FLOOR-1 enforcement (RECURRENCE-ZERO-1 gate).
// Scans repo worker sources AND live deployed bundles for banned (sub-frontier) models.
// Exit 0 = clean; exit 1 = code-level violation. Comment mentions + BANNED-list
// declarations are skipped (a comment may name a banned model only for documentation).
//
// Usage:
//   node model-floor-guard.mjs                 # repo scan (default)
//   node model-floor-guard.mjs --live          # repo + live bundles
//   node model-floor-guard.mjs --json          # machine-readable summary

import fs from "node:fs";
import path from "node:path";

const REPO = process.env.QNFO_WORKERS || "C:/Users/LENOVO/Documents/GitHub/qnfo-workers";
const ACCT = process.env.CF_ACCOUNT_ID || "edb167b78c9fb901ea5bca3ce58ccc4b";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const BANNED = [
  { label: "llama", re: /(@cf\/(meta|meta-llama)\/llama[\w.-]*|\bllama-[\d.]+[\w.-]*)/i },
  { label: "mistral-7b", re: /(@cf\/mistral\/mistral-7b[\w.-]*|mistral-7b[\w.-]*)/i },
  { label: "gemma-small", re: /(@cf\/google\/gemma-(2b|7b|3-12b)[\w.-]*|gemma-(2b|7b|3-12b)[\w.-]*)/i },
  { label: "qwen2.5-coder-32b", re: /qwen2\.5-coder-32b[\w.-]*/i },
  { label: "qwen3-30b", re: /qwen3-30b[\w.-]*/i },
  { label: "qwq-32b", re: /qwq-32b[\w.-]*/i },
  { label: "r1-distill-32b", re: /deepseek-r1-distill-qwen-32b[\w.-]*/i },
  { label: "gemma-4-26b", re: /gemma-4-26b[\w.-]*/i },
  { label: "glm-4.7-flash", re: /glm-4\.7-flash[\w.-]*/i },
  { label: "glm-5.2", re: /glm-5\.2(?![\d.])[\w.-]*/i },
];

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
    const isBanCtx = inBanList > 0 || /\b(BANNED|DENY|BLOCK|FORBID)[\w_]*\b/i.test(line);
    for (const b of BANNED) {
      if (b.re.test(line)) {
        const kind = isComment ? "comment" : (isOk || isBanCtx) ? "banlist" : "VIOLATION";
        out.push({ line: i + 1, label: b.label, kind, text: t.slice(0, 110) });
        break;
      }
    }
  }
  return out;
}

function scanRepo() {
  const res = [];
  let dirs = [];
  try { dirs = fs.readdirSync(REPO, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return [{ name: "(repo unreadable)", hits: [] }]; }
  for (const d of dirs) {
    const f = path.join(REPO, d, "worker.js");
    if (!fs.existsSync(f)) continue;
    const hits = scan(fs.readFileSync(f, "utf8"));
    const v = hits.filter((h) => h.kind === "VIOLATION");
    if (v.length) res.push({ name: d, hits: v });
  }
  return res;
}

async function scanLive() {
  const res = [];
  if (!TOKEN) return [{ name: "(no CF token)", hits: [] }];
  let list = [];
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + ACCT + "/workers/scripts", { headers: { Authorization: "Bearer " + TOKEN } });
    list = ((await r.json()).result || []).map((x) => x.id).sort();
  } catch { return [{ name: "(live list failed)", hits: [] }]; }
  const cap = 6;
  for (let i = 0; i < list.length; i += cap) {
    const chunk = list.slice(i, i + cap);
    await Promise.all(chunk.map(async (name) => {
      try {
        const r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + ACCT + "/workers/scripts/" + name + "/content/v2", { headers: { Authorization: "Bearer " + TOKEN } });
        if (!r.ok) return;
        const hits = scan(await r.text()).filter((h) => h.kind === "VIOLATION");
        if (hits.length) res.push({ name, hits });
      } catch {}
    }));
  }
  res.sort((a, b) => a.name.localeCompare(b.name));
  return res;
}

const wantLive = process.argv.includes("--live");
const wantJson = process.argv.includes("--json");
const repo = scanRepo();
const live = wantLive ? await scanLive() : [];

if (wantJson) {
  console.log(JSON.stringify({ repo, live }, null, 1));
} else {
  const show = (title, rows) => {
    console.log("== " + title + " (" + rows.length + " workers with code-level violations)");
    for (const r of rows) {
      console.log("  " + r.name);
      for (const h of r.hits.slice(0, 6)) console.log("      L" + h.line + " [" + h.label + "] " + h.text);
    }
  };
  show("REPO SOURCES", repo);
  if (wantLive) show("LIVE BUNDLES", live);
}

const total = repo.length + live.length;
process.exit(total > 0 ? 1 : 0);
