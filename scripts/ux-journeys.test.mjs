// scripts/ux-journeys.test.mjs (UX-JOURNEYS-1): the pure half of the phone journey check (grading, screen findings, regressions),
// plus the shape of budgets.json and of every journey module. No browser; runs in the offline suites (scripts/run-suites.mjs).
import fs from "node:fs";
import { grade, screenFindings, regressions, exitCode, journeyTitle, screensTitle } from "./ux-journeys/lib.mjs";
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (x !== undefined ? "  -> " + JSON.stringify(x) : "")); } };

ok("a journey that did not finish is broken", grade({ ok: false, error: "boom", taps: 1, typing: 0 }, { taps: 3 }).status === "broken");
ok("a page exception breaks a finished journey", grade({ ok: true, taps: 1, typing: 0, pageErrors: ["CMP is not defined"] }, { taps: 3 }).status === "broken");
ok("more taps than the budget is harder", grade({ ok: true, taps: 4, typing: 0 }, { taps: 3 }).status === "harder");
ok("typing where the budget allows none is harder", grade({ ok: true, taps: 1, typing: 1 }, { taps: 3 }).status === "harder");
ok("within budget is ok", grade({ ok: true, taps: 3, typing: 1 }, { taps: 3, typing: 1 }).status === "ok");
ok("no budget yet is new, not a failure", grade({ ok: true, taps: 3, typing: 0 }, undefined).status === "new");

const f = screenFindings({ label: "today", overflowPx: 30, narrowOverflowPx: 0, smallTargets: [{ name: "x", w: 20, h: 20 }], emptyOverlays: [{ name: "#toast", w: 388, h: 20 }],
  axe: [{ id: "color-contrast", impact: "serious", nodes: 2, help: "h" }, { id: "region", impact: "moderate", nodes: 1, help: "h" }] });
ok("sideways scroll, small targets, empty bar and serious axe each make a finding; moderate axe does not", f.length === 4, f);

const rep = (s) => ({ apps: [{ app: "c", journeys: [{ id: "a", grade: { status: s, reasons: ["r"] } }] }] });
ok("ok on base, broken on head is a regression", regressions(rep("ok"), rep("broken")).length === 1);
ok("broken on base and head is not this PR's", regressions(rep("broken"), rep("broken")).length === 0);
ok("a new journey that is broken is a regression", regressions({ apps: [] }, rep("broken")).length === 1);
ok("exit code 1 on a broken journey", exitCode(rep("broken")) === 1 && exitCode(rep("ok")) === 0);
ok("issue titles are stable", journeyTitle("companion", "sign-in") === "UX-JOURNEY-1: companion / sign-in" && screensTitle("public", "live") === "UX-SCREENS-1: public (live)");

const budgets = JSON.parse(fs.readFileSync(new URL("./ux-journeys/budgets.json", import.meta.url), "utf8"));
for (const file of fs.readdirSync(new URL("./ux-journeys/apps/", import.meta.url)).filter((x) => x.endsWith(".journeys.mjs"))) {
  const src = fs.readFileSync(new URL("./ux-journeys/apps/" + file, import.meta.url), "utf8");
  ok(file + " names its app and live base", /export const name = "[a-z0-9-]+"/.test(src) && /export const liveBase = "https:\/\//.test(src));
  const app = /export const name = "([a-z0-9-]+)"/.exec(src)[1];
  ok(file + " has a budget section", !!budgets[app]);
  for (const m of src.matchAll(/\{ id: "([a-z0-9-]+)"/g)) ok(app + "/" + m[1] + " has a budget", !!(budgets[app] || {})[m[1]]);
}
// The owner's no-typing rule: only the sign-in code may need typing in a companion journey.
for (const [id, b] of Object.entries(budgets.companion || {})) ok("companion/" + id + " needs no typing" + (id === "sign-in" ? " beyond the 6-digit code" : ""), (b.typing || 0) <= (id === "sign-in" ? 1 : 0));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
