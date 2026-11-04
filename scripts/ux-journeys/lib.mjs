// scripts/ux-journeys/lib.mjs (UX-JOURNEYS-1): the pure half of the phone journey check. No browser here, so
// scripts/ux-journeys.test.mjs runs it in the offline suites. run.mjs drives the browser and calls these.

// The phone every journey runs on (Pixel 7 size, touch) and the narrow phone every screen must still fit.
export const PHONE = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 qnfo-ux-journeys/1" };
export const NARROW_WIDTH = 360;
// WCAG 2.2 SC 2.5.8 (AA): a tap target is at least 24 by 24 CSS pixels (inline links in a sentence are exempt).
export const MIN_TARGET_PX = 24;

/** Stable issue title of one journey, so a repeat finding refreshes one open issue and a pass closes it. */
export const journeyTitle = (app, id) => "UX-JOURNEY-1: " + app + " / " + id;
/** Stable issue title of an app's screen findings (fit, tap size, accessibility, console errors). */
export const screensTitle = (app, mode) => "UX-SCREENS-1: " + app + " (" + mode + ")";

/**
 * Grades one journey run against its budget.
 * broken: it did not finish (a step failed or the page threw); harder: it took more taps or more typing than its budget.
 * @param {{ok:boolean,error?:string,taps:number,typing:number,pageErrors?:string[]}} run
 * @param {{taps:number,typing?:number}|undefined} budget
 */
export function grade(run, budget) {
  const reasons = [];
  if (!run.ok) reasons.push("did not finish: " + String(run.error || "unknown").slice(0, 300));
  for (const e of run.pageErrors || []) reasons.push("page error: " + String(e).slice(0, 200));
  if (reasons.length) return { status: "broken", reasons };
  if (!budget) return { status: "new", reasons: ["no budget yet: " + run.taps + " taps, " + run.typing + " typed fields"] };
  if (run.taps > budget.taps) reasons.push("needs " + run.taps + " taps, budget " + budget.taps);
  if (run.typing > (budget.typing || 0)) reasons.push("needs typing in " + run.typing + " field(s), budget " + (budget.typing || 0));
  return reasons.length ? { status: "harder", reasons } : { status: "ok", reasons: [] };
}

/**
 * Screen findings that make a page hard to use on a phone, from the raw measurements of one screen.
 * @param {{label:string,overflowPx:number,narrowOverflowPx:number,smallTargets:Array<{name:string,w:number,h:number}>,axe:Array<{id:string,impact:string,nodes:number,help:string}>}} s
 */
export function screenFindings(s) {
  const out = [];
  if (s.overflowPx > 1) out.push(s.label + ": page is " + s.overflowPx + "px wider than the phone (sideways scrolling)");
  if (s.narrowOverflowPx > 1) out.push(s.label + ": on a 360px phone the page is " + s.narrowOverflowPx + "px too wide");
  if (s.smallTargets && s.smallTargets.length) out.push(s.label + ": " + s.smallTargets.length + " tap target(s) under " + MIN_TARGET_PX + "px, e.g. " +
    s.smallTargets.slice(0, 3).map((t) => JSON.stringify(t.name) + " " + t.w + "x" + t.h).join(", "));
  for (const o of s.emptyOverlays || []) out.push(s.label + ": an empty " + o.w + "x" + o.h + " bar (" + o.name + ") floats over the page");
  for (const v of s.axe || []) if (v.impact === "serious" || v.impact === "critical") out.push(s.label + ": accessibility " + v.impact + " " + v.id + " (" + v.nodes + "x): " + v.help);
  return out;
}

/** One line per journey for the job summary and the reply. */
export function summarise(report) {
  const lines = ["| app | journey | result | taps | typed | why |", "|---|---|---|---|---|---|"];
  for (const a of report.apps) for (const j of a.journeys)
    lines.push("| " + a.app + " | " + j.title + " | " + j.grade.status + " | " + j.taps + " | " + j.typing + " | " + (j.grade.reasons.join("; ") || "").replace(/\|/g, "/") + " |");
  const sf = report.apps.filter((a) => a.screenFindings.length);
  if (sf.length) { lines.push("", "Screen findings:"); for (const a of sf) for (const f of a.screenFindings) lines.push("- " + a.app + ": " + f); }
  return lines.join("\n");
}

/** Exit code of a run: 1 when any journey is broken or harder (a PR must not make a journey harder). Screen findings are reported, not fatal. */
export const exitCode = (report) => (report.apps.some((a) => a.journeys.some((j) => j.grade.status === "broken" || j.grade.status === "harder")) ? 1 : 0);

/**
 * A pull request may not make a journey worse than it is on the base branch: the journeys that are broken or harder on the head
 * and were ok (or new) on the base. A journey already red on the base is the base's issue (filed from main), not this PR's.
 */
export function regressions(baseReport, headReport) {
  const bad = (s) => s === "broken" || s === "harder";
  const baseStatus = new Map();
  for (const a of baseReport.apps || []) for (const j of a.journeys) baseStatus.set(a.app + "/" + j.id, j.grade.status);
  const out = [];
  for (const a of headReport.apps || []) for (const j of a.journeys)
    if (bad(j.grade.status) && !bad(baseStatus.get(a.app + "/" + j.id))) out.push(a.app + " / " + j.id + ": " + j.grade.reasons.join("; "));
  return out;
}
