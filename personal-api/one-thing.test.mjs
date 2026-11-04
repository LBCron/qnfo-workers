// personal-api/one-thing.test.mjs (COMPANION-FOCUS-1)
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as C from "./companion.js";

const actions = [
  { id: "later", title: "Later", gtd: "someday", minutes: 2 },
  { id: "long", title: "Long", gtd: "next", minutes: 20 },
  { id: "short", title: "Short", gtd: "next", minutes: 5, context: "@home" },
  { id: "medium", title: "Medium energy", gtd: "next", minutes: 15, energy: "medium" },
  { id: "hard-action", title: "Hard action", gtd: "next", minutes: 5, energy: "high" }
];
const activities = [
  { id: "hard", title: "Hard", energy: "high", minutes: 5, active: 1 },
  { id: "easy", title: "Easy", energy: "low", minutes: 5, active: 1, category: "rest" },
  { id: "long-easy", title: "Long easy", energy: "low", minutes: 30, active: 1 },
  { id: "off", title: "Off", energy: "low", minutes: 5, active: 0 }
];
const five = C.focusOptions(actions, activities, 5, "low");
assert.equal(five[0].kind, "action");
assert.equal(five[0].id, "short");
assert.deepEqual(five.map((x) => x.id), ["short", "easy"]);
assert.deepEqual(C.focusOptions(actions, activities, 15, "low").map((x) => x.id), ["short", "easy"]);
assert.equal(C.focusOptions(actions, activities, 30, "medium").some((x) => x.id === "medium"), true);
assert.equal(C.focusOptions(actions, activities, 30, "medium").some((x) => x.id === "hard-action"), false);
assert.equal(C.focusOptions([], activities, 30, "high").some((x) => x.id === "hard"), true);
assert.equal(C.focusOptions([], activities, 5, "low").some((x) => x.id === "off"), false);
assert.equal(C.focusOptions([], [], 2, "low")[0].minutes, 2);
assert.equal(C.focusOptions([], [], 999, "low")[0].minutes, 2);
console.log("ok   Focus 5/15/30-minute choices fit time, energy and next-action state");

const scripts = [...C.PAGE_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
for (const script of scripts) new vm.Script(script.replace(/__VERSION__/g, "test"));
console.log("ok   all companion scripts parse");

const focus = C.PAGE_HTML.match(/<section id="v-focus"[\s\S]*?<\/section>/)[0];
assert.equal(/<(input|textarea|select)\b/i.test(focus), false);
for (const text of ["Yes — start", "No, not this", "Surprise me", "Qniverse, one tap", "Start without Yes", "Pause timer", "Reset timer", "Copy session handoff", "Free, local checklist", "aria-live"]) assert.ok(C.PAGE_HTML.includes(text), text);
assert.ok(C.PAGE_HTML.includes("data-v=\"focus\""));
assert.ok(C.PAGE_HTML.includes("focus:loadFocus"));
console.log("ok   Focus is click-only and present in the existing companion");

for (const route of ["/companion/api/actions", "/companion/api/activities", "/companion/api/activity", "/companion/api/actions/done"]) assert.ok(C.PAGE_HTML.includes(route), route);
assert.equal(C.PAGE_HTML.includes("/companion/api/focus"), false);
for (const text of ["project:'Qniverse'", "source:'focus-qniverse'", "docs/ONE-THING-BACKLOG.md"]) assert.ok(C.PAGE_HTML.includes(text), text);
assert.ok(C.PAGE_HTML.includes("/companion/api/export"));
assert.equal(C.PAGE_HTML.includes("/companion/api/restore"), false);
assert.ok(C.PAGE_HTML.includes("button:focus-visible"));
console.log("ok   Focus reuses existing APIs and the Qniverse action backlog");

const focusStart = C.PAGE_HTML.indexOf("// COMPANION-FOCUS-2: everything below");
const focusEnd = C.PAGE_HTML.indexOf("var CTX=[];", focusStart);
assert.ok(focusStart >= 0 && focusEnd > focusStart, "Focus browser code is present");

function focusHarness(preferences, options) {
  const stored = new Map();
  if (preferences !== undefined) stored.set("cmp-focus-prefs", preferences);
  const nodes = new Map(), calls = [], clipboard = [];
  function node(tag) {
    const n = {
      tagName: tag.toUpperCase(), attributes: {}, children: [], textContent: "",
      appendChild(child) { this.children.push(child); return child; },
      setAttribute(name, value) { this.attributes[name] = String(value); if (name === "id") nodes.set(String(value), this); }
    };
    Object.defineProperty(n, "innerHTML", {
      get() { return ""; },
      set() { this.children = []; this.textContent = ""; }
    });
    return n;
  }
  function el(tag, attrs, children) {
    const n = node(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === "text") n.textContent = value;
      else if (key === "cls") n.className = value;
      else if (key.slice(0, 2) === "on") n[key] = value;
      else n.setAttribute(key, value);
    }
    for (const child of children || []) if (child) n.appendChild(child);
    return n;
  }
  const context = {
    localStorage: {
      getItem(key) { return stored.has(key) ? stored.get(key) : null; },
      setItem(key, value) { stored.set(key, String(value)); }
    },
    $(id) { if (!nodes.has(id)) nodes.set(id, node("div")); return nodes.get(id); },
    el,
    navigator: { clipboard: { writeText(text) { clipboard.push(text); return Promise.resolve(); } } },
    api(path, options) {
      calls.push({ path, json: options && options.json });
      if (path === "/companion/api/actions" && options && options.json) return Promise.resolve({ ok: true });
      if (path === "/companion/api/actions") return Promise.resolve({ actions: [] });
      if (path === "/companion/api/activities") return Promise.resolve({ activities: [] });
      return Promise.resolve({ ok: true });
    },
    CMP: { focusOptions() { return options; } },
    say(box, text) { box.appendChild(el("div", { text })); },
    setInterval() { return 1; },
    clearInterval() {},
    go() {}
  };
  vm.runInNewContext(C.PAGE_HTML.slice(focusStart, focusEnd), context);
  context.FOCUS.options = options;
  return { context, stored, nodes, calls, clipboard };
}

function allNodes(root) {
  return [root, ...root.children.flatMap(allNodes)];
}

const savedAction = { kind: "action", id: "action-1", title: "Write the report", minutes: 10, context: "@desk" };
const prefs = focusHarness('{"minutes":15,"energy":"medium"}', [savedAction]);
assert.equal(prefs.context.FOCUS.minutes, 15);
assert.equal(prefs.context.FOCUS.energy, "medium");
prefs.context.drawFocus();
const focusButtons = allNodes(prefs.nodes.get("focus"));
focusButtons.find((n) => n.textContent === "5 min").onclick();
focusButtons.find((n) => n.textContent === "High energy").onclick();
assert.deepEqual(JSON.parse(prefs.stored.get("cmp-focus-prefs")), { minutes: 5, energy: "high" });
assert.equal(prefs.context.FOCUS.minutes, 5);
assert.equal(prefs.context.FOCUS.energy, "high");
const invalidPrefs = focusHarness('{"minutes":999,"energy":"unknown"}', [savedAction]);
assert.equal(invalidPrefs.context.FOCUS.minutes, 5);
assert.equal(invalidPrefs.context.FOCUS.energy, "low");
console.log("ok   Focus restores and safely stores device-local time and energy selections");

const menu = focusHarness(null, [savedAction]);
menu.context.drawFocus();
assert.deepEqual(Array.from(allNodes(menu.nodes.get("focus")).filter((n) => ["5 min", "15 min", "30 min"].includes(n.textContent)).map((n) => n.textContent)), ["5 min", "15 min", "30 min"]);

const accessible = focusHarness(null, [savedAction]);
accessible.context.drawFocus();
const rendered = allNodes(accessible.nodes.get("focus"));
const timer = accessible.nodes.get("focus-clock");
assert.equal(timer.attributes.role, "timer");
assert.equal(timer.attributes["aria-label"], "Focus timer");
assert.equal(timer.attributes["aria-live"], "polite");
const checklist = rendered.filter((n) => ["Make the smallest possible start", "Stop when the timer ends", "Tap Done — a partial try counts"].includes(n.attributes["aria-label"]));
assert.equal(checklist.length, 3);
for (const button of checklist) {
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.attributes["aria-pressed"], "false");
  assert.equal(typeof button.onclick, "function");
  button.onclick();
  assert.equal(accessible.nodes.get("focus-clock").attributes.role, "timer");
}
assert.equal(accessible.context.FOCUS.checks[0], true);
console.log("ok   timer and checklist expose screen-reader semantics and native keyboard controls");

const timerControls = focusHarness(null, [savedAction]);
timerControls.context.drawFocus();
const clickFocus = (text) => allNodes(timerControls.nodes.get("focus")).find((n) => n.textContent === text).onclick();
clickFocus("Start without Yes");
assert.ok(timerControls.context.FOCUS.endAt > 0);
clickFocus("Pause timer");
assert.equal(timerControls.context.FOCUS.endAt, 0);
assert.equal(timerControls.context.FOCUS.paused, true);
assert.ok(timerControls.context.FOCUS.left > 0);
clickFocus("Resume timer");
assert.ok(timerControls.context.FOCUS.endAt > 0);
clickFocus("Reset timer");
assert.equal(timerControls.context.FOCUS.left, 0);
assert.equal(timerControls.context.FOCUS.paused, false);
assert.equal(timerControls.context.FOCUS.timer, null);
console.log("ok   Focus timer starts, pauses, resumes and resets without background work");

const localChecklist = focusHarness(null, [savedAction]);
localChecklist.context.drawFocus();
allNodes(localChecklist.nodes.get("focus")).find((n) => n.textContent.includes("Use Focus and local tools")).onclick();
assert.deepEqual(JSON.parse(localChecklist.stored.get("cmp-focus-cost-checklist")), [true, false, false]);
assert.equal(localChecklist.calls.length, 0);
console.log("ok   cost checklist is device-local and makes no API calls");

const handoff = focusHarness(null, [savedAction]);
handoff.context.FOCUS.minutes = 15;
handoff.context.FOCUS.choice = savedAction;
handoff.context.FOCUS.completed.push("Earlier task");
handoff.context.CMP.focusOptions = C.focusOptions;
handoff.context.api = (path, options) => {
  handoff.calls.push({ path, json: options && options.json });
  if (path === "/companion/api/actions") return Promise.resolve({ actions: [
    { id: "action-1", title: "Write the report", gtd: "next", minutes: 10, energy: "low" },
    { id: "action-2", title: "Water plants", gtd: "next", minutes: 5, energy: "low" },
    { id: "action-3", title: "Too demanding", gtd: "next", minutes: 5, energy: "high" },
    { id: "action-4", title: "Not next", gtd: "someday", minutes: 5, energy: "low" },
    { id: "action-5", title: "Too long", gtd: "next", minutes: 30, energy: "low" }
  ] });
  return Promise.resolve({ ok: true });
};
handoff.context.drawFocus();
await allNodes(handoff.nodes.get("focus")).find((n) => n.textContent === "Copy session handoff").onclick();
assert.match(handoff.clipboard[0], /Current goal: Write the report/);
assert.match(handoff.clipboard[0], /Completed items:\n- Earlier task/);
assert.match(handoff.clipboard[0], /Next action: Water plants \(5 min\)/);
assert.match(handoff.clipboard[0], /Constraints: 15 minutes; low energy/);
assert.equal(handoff.calls.filter((call) => call.path === "/companion/api/actions").length, 1);
console.log("ok   one-click handoff copies the current session and eligible next action");

const completed = focusHarness(null, [savedAction]);
completed.context.drawFocus();
await allNodes(completed.nodes.get("focus")).find((n) => n.textContent === "Done").onclick();
assert.deepEqual(Array.from(completed.context.FOCUS.completed), ["Write the report"]);
assert.ok(allNodes(completed.nodes.get("focus")).some((n) => n.textContent === "Copy session handoff"));
console.log("ok   completed Focus items remain in the session handoff state");

const tooLong = focusHarness(null, [savedAction]);
tooLong.context.drawFocus();
const tooLongButton = allNodes(tooLong.nodes.get("focus")).find((n) => n.textContent === "Too long — make a 2-minute step");
assert.ok(tooLongButton);
await tooLongButton.onclick();
const smallerStep = tooLong.calls.find((call) => call.path === "/companion/api/actions" && call.json);
assert.deepEqual(JSON.parse(JSON.stringify(smallerStep.json)), {
  title: "Start with 2 minutes: Write the report",
  context: "@desk",
  energy: "low",
  minutes: 2,
  gtd: "next",
  source: "focus-too-long"
});
assert.equal(tooLong.calls.some((call) => call.path === "/companion/api/chat"), false);
assert.equal(allNodes(tooLong.nodes.get("focus")).find((n) => n.attributes.role === "status").attributes["aria-live"], "polite");
const minimumStep = focusHarness(null, [{ ...savedAction, minutes: 2 }]);
minimumStep.context.drawFocus();
assert.equal(allNodes(minimumStep.nodes.get("focus")).some((n) => n.textContent.startsWith("Too long")), false);
console.log("ok   Too long creates a deterministic 2-minute next action without AI");

const worker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = fs.readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
const version = worker.match(/var VERSION = "(\d+)\.(\d+)\.(\d+)"/)?.slice(1).map(Number);
assert.ok(version && (version[0] > 4 || (version[0] === 4 && version[1] >= 32)));
const cv = worker.match(/const COMPANION_VERSION = "(\d+)\.(\d+)\.\d+"/)?.slice(1).map(Number);
assert.ok(cv && (cv[0] > 1 || cv[1] >= 17));
assert.ok(worker.includes("COMPANION-FOCUS-1"));
assert.ok(worker.includes("COMPANION-FOCUS-2"));
assert.equal(worker, mirror);
console.log("ok   versions bumped and deployed mirror is byte-identical");
console.log("COMPANION-FOCUS-2: all passed");
