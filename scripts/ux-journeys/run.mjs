#!/usr/bin/env node
// scripts/ux-journeys/run.mjs (UX-JOURNEYS-1, pillar personal + reach; owner 2026-11-04: "Have you run UI UX and user testing on this
// ... How would a user actually use this? And is it working? This needs to be baked into the fleet, not just for this app, but for anything.")
//
// WHAT  Walks each user-facing app the way a person does on a phone: headless Chromium at Pixel 7 size with touch, tapping buttons by
//       their visible names, counting every tap and every field that has to be typed in. On each screen it measures what makes a phone
//       page hard to use: sideways scrolling (also at 360px), tap targets under 24px (WCAG 2.2 SC 2.5.8) and axe-core's serious and
//       critical violations; console errors and page exceptions are collected. A journey is broken when it does not finish, harder
//       when it takes more taps or more typing than its budget in budgets.json. Deterministic: no model call, no key, no account.
// MODES --mode local: journeys against a local harness that serves the app's real code with fake data (apps/*-harness.mjs), so the
//       signed-in screens are tested on every PR without a credential. --mode live: the public, signed-out journeys against the live
//       hosts (q08.org, qnfo.org, qwav.org). Live journeys never submit a form, never ask for a sign-in code and never send anything.
// USAGE node scripts/ux-journeys/run.mjs --mode local|live [--app <name>] [--out ci-status/ux-journeys.json] [--shots <dir>]
//       Needs playwright (+ its Chromium) and axe-core resolvable from UX_MODULES (a node_modules dir), the global install, or here.
// EXIT  1 when a journey is broken or harder; screen findings are reported (and filed by file_issues.py), not fatal.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PHONE, NARROW_WIDTH, MIN_TARGET_PX, grade, screenFindings, summarise, exitCode, isForeignConsoleError, shouldRetryJourney } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? a.concat([[x.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]]) : a), []));
const MODE = args.mode || "local";
const OUT = args.out || "ci-status/ux-journeys-" + MODE + ".json";

function load(name) {
  const bases = [process.env.UX_MODULES, "/opt/node-tools/node_modules", path.join(HERE, "node_modules"), path.join(process.cwd(), "node_modules")].filter(Boolean);
  for (const b of bases) { try { const r = createRequire(path.join(b, "noop.js")); return { mod: r(name), resolve: (p) => r.resolve(p) }; } catch (e) { /* next base */ } }
  throw new Error("cannot load " + name + " (set UX_MODULES to a node_modules dir that has it)");
}
const { chromium } = load("playwright").mod;
let AXE = null;
try { AXE = fs.readFileSync(load("axe-core").resolve("axe-core/axe.min.js"), "utf8"); } catch (e) { console.warn("axe-core not found: accessibility rules skipped (" + e.message + ")"); }

// ---------------------------------------------------------------- one screen's measurements
async function measure(page, label) {
  const m = await page.evaluate(({ min }) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };
    const small = [];
    for (const e of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], label.btn")) {
      if (!vis(e)) continue;
      // WCAG 2.5.8 exempts a link inside a sentence.
      if (e.tagName === "A" && getComputedStyle(e).display === "inline" && e.parentElement && /^(P|LI|SPAN|TD|SMALL)$/.test(e.parentElement.tagName) && (e.parentElement.textContent || "").trim().length > (e.textContent || "").trim().length + 10) continue;
      const r = e.getBoundingClientRect();
      if (r.width < min || r.height < min) small.push({ name: (e.getAttribute("aria-label") || e.textContent || e.getAttribute("placeholder") || e.tagName).trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
    }
    // An empty bar floating over the page (a toast or banner whose hide rule lost to an id rule) covers content and looks broken.
    const emptyOverlays = [];
    for (const e of document.querySelectorAll("body *")) {
      const st = getComputedStyle(e);
      if ((st.position !== "fixed" && st.position !== "sticky") || !vis(e) || e.tagName === "NAV") continue;
      if ((e.textContent || "").trim() || e.querySelector("img,svg,button,input,video,canvas")) continue;
      const r = e.getBoundingClientRect();
      if (r.width * r.height >= 400) emptyOverlays.push({ name: (e.id ? "#" + e.id : e.tagName.toLowerCase() + (e.className ? "." + String(e.className).split(" ")[0] : "")), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return { overflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth), smallTargets: small, emptyOverlays };
  }, { min: MIN_TARGET_PX });
  let axe = [];
  if (AXE) {
    try {
      if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
      const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] }));
      axe = r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
    } catch (e) { axe = [{ id: "axe-not-run", impact: "minor", nodes: 0, help: String(e.message || e).slice(0, 120) }]; }
  }
  const vp = page.viewportSize();
  await page.setViewportSize({ width: NARROW_WIDTH, height: vp.height });
  const narrowOverflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
  await page.setViewportSize(vp);
  return { label, ...m, narrowOverflowPx, axe };
}

// ---------------------------------------------------------------- the driver a journey uses
function driver(page, base, run, shots) {
  const name = (target) => (typeof target === "string" ? target : String(target));
  const find = async (target, within) => {
    if (typeof target !== "string") return target;
    const root = within ? page.locator(within) : page;
    for (const role of ["button", "link", "checkbox", "tab"]) {
      const l = root.getByRole(role, { name: target }).filter({ visible: true });
      if (await l.count()) return l.first();
    }
    const t = root.getByText(target, { exact: false }).filter({ visible: true });
    if (await t.count()) return t.first();
    throw new Error("no visible control named " + JSON.stringify(target) + (within ? " in " + within : "") + " on " + page.url());
  };
  const u = {
    page, base,
    async open(p) { await page.goto(new URL(p, base).href, { waitUntil: "load" }); await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {}); },
    /** One tap on the control a person would see by that name. */
    async tap(target, opt = {}) { const l = await find(target, opt.within); await l.click({ timeout: 5000 }); run.taps++; run.steps.push("tap " + name(target)); await page.waitForTimeout(opt.wait ?? 400); },
    /** Typing into a field; counted, because a journey that needs typing is harder (for the owner: not allowed). */
    async type(selector, text) { await page.locator(selector).fill(text); run.typing++; run.steps.push("type into " + selector); },
    async see(text, opt = {}) {
      const l = (opt.within ? page.locator(opt.within) : page).getByText(text, { exact: false }).filter({ visible: true }).first();
      try { await l.waitFor({ state: "visible", timeout: opt.timeout || 6000 }); } catch (e) { throw new Error("expected to see " + JSON.stringify(String(text)) + (opt.within ? " in " + opt.within : "") + " on " + page.url()); }
    },
    async notSee(text, opt = {}) { await page.waitForTimeout(opt.wait ?? 300); if (await page.getByText(text, { exact: false }).filter({ visible: true }).count()) throw new Error("saw " + JSON.stringify(String(text)) + " on " + page.url()); },
    async expect(cond, msg) { if (!(await cond())) throw new Error(msg); },
    /** Measures the screen as it is now (fit, tap size, accessibility). */
    async screen(label) { run.screens.push(await measure(page, label)); if (shots) await page.screenshot({ path: path.join(shots, (run.app + "-" + run.id + "-" + label).replace(/[^\w.-]+/g, "_") + ".png") }); }
  };
  return u;
}

// ---------------------------------------------------------------- apps
const appFiles = fs.readdirSync(path.join(HERE, "apps")).filter((f) => f.endsWith(".journeys.mjs")).sort();
const budgets = JSON.parse(fs.readFileSync(path.join(HERE, "budgets.json"), "utf8"));
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const report = { mode: MODE, at: new Date().toISOString(), sha: process.env.GITHUB_SHA || null, apps: [] };
if (args.shots) fs.mkdirSync(args.shots, { recursive: true });

for (const f of appFiles) {
  const app = await import(pathToFileURL(path.join(HERE, "apps", f)).href);
  if (args.app && app.name !== args.app) continue;
  const journeys = (app.journeys || []).filter((j) => (j.modes || ["local"]).includes(MODE));
  if (!journeys.length) continue;
  // Local mode starts a fresh harness per journey, so one journey's taps never change another's starting screen.
  const start = async () => (MODE === "local" && app.startLocal ? app.startLocal() : { base: app.liveBase, close: async () => {} });
  const out = { app: app.name, base: MODE === "live" ? app.liveBase : "local harness", journeys: [], screenFindings: [] };
  for (const j of journeys) {
    // UX-JOURNEY-1 ROOT-CAUSE-1: a live journey that did not finish gets one more try in a fresh phone context; only a repeat failure is reported (lib.mjs shouldRetryJourney).
    for (let attempt = 1; ; attempt++) {
      const env = await start();
      const ctx = await browser.newContext({ ...PHONE, bypassCSP: true, permissions: [] });
      if (MODE === "local") await ctx.grantPermissions(["microphone"], { origin: env.base }).catch(() => {});
      // The local harness reaches nothing outside itself. Live pages load as a visitor's phone would load them (fonts, analytics),
      // so a blocked request never shows up as a false console error.
      if (MODE === "local") await ctx.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
      const page = await ctx.newPage();
      const run = { app: app.name, id: j.id, title: j.title, taps: 0, typing: 0, steps: [], screens: [], consoleErrors: [], pageErrors: [], badResponses: [], ok: false, error: null, attempts: attempt };
      page.on("console", (m) => { if (m.type() === "error" && !isForeignConsoleError(m.text())) run.consoleErrors.push(m.text().slice(0, 200)); });
      page.on("pageerror", (e) => run.pageErrors.push(String(e.message || e).slice(0, 200)));
      page.on("response", (r) => {
        if (r.status() >= 500 || r.status() === 404) run.badResponses.push(r.status() + " " + r.url().slice(0, 160));
        // A script URL answered with an HTML page (a catch-all route) makes the browser throw "Unexpected token '<'".
        else if (r.request().resourceType() === "script" && /text\/html/i.test(r.headers()["content-type"] || "")) run.badResponses.push("script answered with an HTML page: " + r.url().slice(0, 160));
      });
      const t0 = Date.now();
      try { await j.run(driver(page, env.base, run, args.shots), env); run.ok = true; }
      catch (e) { run.error = String(e.message || e).split("\n")[0].slice(0, 300); if (args.shots) await page.screenshot({ path: path.join(args.shots, (app.name + "-" + j.id + "-FAILED").replace(/[^\w.-]+/g, "_") + ".png") }).catch(() => {}); }
      run.ms = Date.now() - t0;
      run.grade = grade(run, (budgets[app.name] || {})[j.id]);
      if (shouldRetryJourney(run.grade.status, MODE, attempt)) {
        console.log("  retry " + app.name + " / " + j.id + "  attempt " + attempt + " did not finish: " + run.grade.reasons.join("; "));
        await ctx.close();
        await env.close();
        continue;
      }
      for (const s of run.screens) for (const x of screenFindings(s)) if (!out.screenFindings.includes(x)) out.screenFindings.push(x);
      for (const c of run.consoleErrors) { const x = "console error in " + j.id + ": " + c; if (!out.screenFindings.includes(x)) out.screenFindings.push(x); }
      for (const b of run.badResponses) { const x = "HTTP " + b + " during " + j.id; if (!out.screenFindings.includes(x)) out.screenFindings.push(x); }
      out.journeys.push(run);
      console.log((run.grade.status === "ok" ? "  ok    " : "  " + run.grade.status.toUpperCase().padEnd(6)) + app.name + " / " + j.id + "  taps=" + run.taps + " typed=" + run.typing + (attempt > 1 ? " (attempt " + attempt + ")" : "") + "  " + run.grade.reasons.join("; "));
      await ctx.close();
      await env.close();
      break;
    }
  }
  report.apps.push(out);
}
await browser.close();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
const md = summarise(report);
console.log("\n" + md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Phone journeys (" + MODE + ")\n\n" + md + "\n");
process.exit(args["no-fail"] ? 0 : exitCode(report));
