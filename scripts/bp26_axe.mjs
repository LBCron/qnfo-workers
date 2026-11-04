#!/usr/bin/env node
// scripts/bp26_axe.mjs (BP26-AXE-1, charter pillar security + reach; breach trigger 14494 a11y_violations_serious).
//
// WHY   The static pass in scripts/bp26_web.py is a lower bound that cannot certify zero ("zero cannot be certified without axe-core"), so it writes the metric only
//       when it finds something. It found 4 on 2026-10-28, the defects were fixed, and the stored 4 has stayed for a week because nothing may write a zero: a stale
//       reading held a breach open that no page has. This is the real measurement: axe-core in headless Chromium (the same Playwright and axe-core that
//       scripts/ux-journeys/run.mjs installs) on the home page of every public HTML host in bp26_web.py HTML_HOSTS plus the papers index and one paper page.
// WHAT  Writes one JSON report: { at, axe, pages: [{ url, host, ok, error?, violations: [{ id, impact, nodes, help }] }] } with every serious and critical rule
//       violation of the WCAG 2.0/2.1/2.2 A and AA rule sets. scripts/bp26_axe.py turns the report into the metric and its evidence rows.
// USAGE node scripts/bp26_axe.mjs --out /tmp/bp26-axe.json      (needs playwright + axe-core resolvable from UX_MODULES, like run.mjs)
// NOTE  Automated browsers are treated as "No" by the consent loader (BP26-CONSENT-1), so no banner is on the page when axe runs; the banner itself is audited by
//       consent.test.mjs and by the ux-journeys screens of real phones.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? a.concat([[x.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]]) : a), []));
const OUT = args.out || "/tmp/bp26-axe.json";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SEVERE = new Set(["serious", "critical"]);

function load(name) {
  const bases = [process.env.UX_MODULES, "/opt/node-tools/node_modules", path.join(HERE, "node_modules"), path.join(process.cwd(), "node_modules")].filter(Boolean);
  for (const b of bases) { try { const r = createRequire(path.join(b, "noop.js")); return { mod: r(name), resolve: (p) => r.resolve(p) }; } catch (e) { /* next base */ } }
  throw new Error("cannot load " + name + " (set UX_MODULES to a node_modules dir that has it)");
}

/** The hosts bp26_web.py measures, read from its HTML_HOSTS tuple so the two lists cannot drift. */
export function htmlHosts(src) {
  const m = /HTML_HOSTS\s*=\s*\(([\s\S]*?)\)/.exec(src);
  if (!m) return [];
  return [...m[1].matchAll(/"([a-z0-9.-]+)"/g)].map((x) => x[1]);
}

/** Serious and critical violations of one axe result, one entry per rule. */
export function severe(violations) {
  return (violations || []).filter((v) => SEVERE.has(v.impact)).map((v) => ({ id: v.id, impact: v.impact, nodes: (v.nodes || []).length, help: String(v.help || "").slice(0, 120) }));
}

async function firstPaperUrl() {
  try {
    const r = await fetch("https://papers.qnfo.org/sitemap.xml", { headers: { "User-Agent": "qnfo-bp26-axe/1 (+https://qnfo.org)" }, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    const m = /<loc>(https:\/\/papers\.qnfo\.org\/papers\/[^<]+)<\/loc>/.exec(t);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

async function main() {
  const hosts = htmlHosts(fs.readFileSync(path.join(HERE, "bp26_web.py"), "utf8"));
  const urls = hosts.map((h) => "https://" + h + "/");
  urls.push("https://papers.qnfo.org/papers");
  const paper = await firstPaperUrl();
  if (paper) urls.push(paper);
  const { chromium } = load("playwright").mod;
  const AXE = fs.readFileSync(load("axe-core").resolve("axe-core/axe.min.js"), "utf8");
  const axeVersion = (/axe v([0-9.]+)/.exec(AXE.slice(0, 400)) || [null, "unknown"])[1];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 qnfo-bp26-axe/1" });
  const pages = [];
  for (const url of urls) {
    const entry = { url, host: new URL(url).hostname, ok: false, violations: [] };
    for (let attempt = 0; attempt < 2 && !entry.ok; attempt++) {
      const page = await ctx.newPage();
      try {
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
        if (!resp || resp.status() >= 500) throw new Error("status " + (resp && resp.status()));
        await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.addScriptTag({ content: AXE });
        const r = await page.evaluate((tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] }), TAGS);
        entry.violations = severe(r.violations);
        entry.status = resp.status();
        entry.ok = true;
        delete entry.error;
      } catch (e) { entry.error = String(e.message || e).slice(0, 160); }
      await page.close();
    }
    pages.push(entry);
    console.log((entry.ok ? "ok   " : "FAIL ") + url + " " + (entry.ok ? entry.violations.map((v) => v.id + ":" + v.nodes).join(",") || "0" : entry.error));
  }
  await browser.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), axe: axeVersion, tags: TAGS, pages }, null, 1));
  console.log("wrote " + OUT + ": " + pages.filter((p) => p.ok).length + " of " + pages.length + " pages measured, " + pages.reduce((n, p) => n + p.violations.length, 0) + " serious or critical rule violation(s)");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("bp26_axe failed: " + (e.message || e)); process.exit(0); });
}
