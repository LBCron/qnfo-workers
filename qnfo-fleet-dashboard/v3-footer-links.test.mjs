// FLEET-FOOTER-LINKS-1 offline suite (qnfo-fleet-dashboard 1.91.1). On a phone the v3 dashboard's fixed bottom tab bar covered the "More:" links
// (full dashboard, changelog, data (JSON), managers) at the end of the page: measured on fleet.qnfo.org at 375x812, the four links sat at y 774-793 while the bar
// covers y >= 760, so elementFromPoint returned the Readers tab and a tap went to the wrong screen; the phone journey "follow the first link" timed out on them
// (UX-JOURNEY-1 public / fleet-qnfo-org). Proves, from the page's own CSS: the paragraph that holds those links keeps at least the tab bar's height plus a gap clear below it,
// honours the safe-area inset, and each link is at least 24px tall (WCAG 2.2 SC 2.5.8). Run: node qnfo-fleet-dashboard/v3-footer-links.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(process.env.V3_FOOTER_WORKER || join(here, "worker.js"), "utf8").replace(/\r\n/g, "\n"); // V3_FOOTER_WORKER=<file> runs another copy (the pre-fix bundle must fail)
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const a = src.indexOf("var V3_CSS = String.raw`");
const b = src.indexOf("`;", a);
ok(a >= 0 && b > a, "the v3 stylesheet is present");
const css = src.slice(a, b);
const rule = (sel) => { const m = css.match(new RegExp("(?:^|[}\\s])" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{([^}]*)\\}")); return m ? m[1] : ""; };
const decl = (body, prop) => { const m = body.match(new RegExp("(?:^|;)\\s*" + prop + ":([^;]*)")); return m ? m[1].trim() : ""; };

// the tab bar: padding 14px above and below a 16px / 1.45 label, plus a 1px rule
const nav = rule("nav"), navA = rule("nav a");
ok(/position:fixed/.test(nav) && /bottom:0/.test(nav), "the tab bar is fixed to the bottom edge");
const padY = parseFloat((decl(navA, "padding").split(/\s+/)[0]) || "0");
const NAV_H = 2 * padY + 16 * 1.45 + 1;
ok(NAV_H >= 50 && NAV_H <= 56, "the tab bar measures about 52px", NAV_H);

// the paragraph after </main> that holds the footer links
const more = rule(".more");
const padVal = decl(more, "padding"); // `0 16px calc(84px + env(safe-area-inset-bottom))`: top, sides, bottom (a calc() holds spaces, so peel two tokens instead of splitting)
const bottom = padVal.replace(/^\S+\s+\S+\s+/, "");
const px = parseFloat((bottom.match(/calc\(\s*([\d.]+)px/) || bottom.match(/^([\d.]+)px/) || [])[1] || "0");
ok(px >= NAV_H + 16, "the footer links keep the tab bar height plus a 16px gap clear below them", { bottom, px, NAV_H });
ok(/env\(safe-area-inset-bottom\)/.test(bottom), "the clearance adds the safe-area inset (the bar does too)", bottom);

// each link is a real tap target
const moreA = rule(".more a");
ok(/display:inline-block/.test(moreA), "the footer links are inline-block so their padding counts as hit area");
const padA = parseFloat((decl(moreA, "padding").split(/\s+/)[0]) || "0");
const lineH = 13 * 1.45;
ok(2 * padA + lineH >= 24, "each footer link is at least 24px tall", { height: 2 * padA + lineH });

// the markup still carries the four links after </main>, before the command bar
const h = src.indexOf("function v3Html(env)");
const html = src.slice(h, h + 6000);
const mainEnd = html.indexOf("</main>"), moreAt = html.indexOf('class="more"'), cbar = html.indexOf('id="cbar"');
ok(mainEnd > 0 && moreAt > mainEnd && cbar > moreAt, "the More paragraph follows </main> and precedes the command bar");
for (const href of ["/overview", "/changelog", "/api", "/managers"]) ok(html.indexOf('<a href="' + href + '">', moreAt) > moreAt, "the More paragraph links " + href);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
