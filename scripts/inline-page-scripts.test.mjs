// scripts/inline-page-scripts.test.mjs (UX-JOURNEYS-1, CHAT-PAGE-REGEX-1): every page a worker serves from a template literal
// (`const|var|let NAME = \`<!doctype ...`) is evaluated as the template would be, and each inline <script> in it is parsed. A
// regular expression written with single backslashes inside a template loses them (\s becomes s, \/\/ becomes //), and the
// browser then refuses the whole script: ai.qnfo.org's chat page was dead that way. Templates with ${...} are evaluated with
// every interpolation replaced by an empty string, so the scripts around them are still checked. No network.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
let pass = 0, fail = 0;
const bad = [], skipped = [];
function templates(src) {
  const out = [];
  const re = /`\s*<!doctype html/gi;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    const before = src.slice(Math.max(0, start - 80), start);
    const nm = /([A-Za-z_$][\w$]*)\s*[=(:]?\s*$/.exec(before);
    let j = start + 1, depth = 0;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === "\\") { j++; continue; }
      if (depth === 0 && c === "`") break;
      if (c === "$" && src[j + 1] === "{") { depth++; j++; continue; }
      if (depth > 0 && c === "}") depth--;
    }
    const raw = /String\.raw\s*$/.test(before);
    out.push({ name: nm ? nm[1] : "page", body: (raw ? "String.raw" : "") + src.slice(start, j + 1), line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}
const dirs = fs.readdirSync(root).filter((d) => !d.startsWith(".") && d !== "node_modules" && fs.existsSync(path.join(root, d, "worker.js")) &&
  !fs.existsSync(path.join(root, d, "RETIRED")) && !fs.existsSync(path.join(root, d, "FOLDED")));
for (const d of dirs) {
  const file = path.join(d, "worker.js");
  const src = fs.readFileSync(path.join(root, file), "utf8");
  for (const t of templates(src)) {
    let html;
    // Every name an interpolation reads is a stub that calls, indexes and prints as an empty string, so the static script
    // text around the interpolations is what gets parsed.
    const prelude = "var __s=new Proxy(function(){}, {apply:function(){return __s}, get:function(t,k){return k===Symbol.toPrimitive?function(){return '0'}:(k==='length'?0:__s)}});" +
      "var __e=new Proxy({}, {has:function(t,k){return typeof k==='string'&&!(k in globalThis)}, get:function(t,k){return k===Symbol.unscopables?undefined:__s}});";
    try { html = vm.runInNewContext(prelude + (t.body.includes("${") ? "(function(){with(__e){return " + t.body + "}})()" : t.body), {}, { timeout: 1000 }); }
    catch (e) { skipped.push(file + ":" + t.line + " " + t.name + " (" + String(e.message).slice(0, 60) + ")"); continue; } // cannot be evaluated even with stubs: out of scope for a static check
    const scripts = [...String(html).matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)].map((x) => ({ attrs: x[1], s: x[2] }));
    scripts.forEach(({ attrs, s }, k) => {
      if (!s.trim() || /type=["']?(application\/ld\+json|application\/json|text\/template|importmap)/i.test(attrs)) return;
      try { new vm.Script(s); pass++; }
      catch (e) { fail++; bad.push(file + ":" + t.line + " " + t.name + " script " + k + ": " + e.message); }
    });
  }
}
for (const b of bad) console.log("  FAIL " + b);
for (const k of skipped) console.log("  skip " + k);
console.log("\n" + pass + " inline page scripts parse, " + fail + " fail");
process.exit(fail ? 1 : 0);
