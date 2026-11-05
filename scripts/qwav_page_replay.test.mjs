// RM-QWAV-CROSS-SIMULATOR-1: offline suite for scripts/qwav_page_replay.mjs (the replay of a demo page's own functions behind a stub DOM) and for the
// recorded docs/qwav-page-golden.json it fills. No network: the pages are not in the repository, so the replay is exercised on a synthetic page that has
// the shapes the real pages have (top-level const/let/class, DOM and canvas calls, localStorage, a timer) and the golden file is checked for shape.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractScript, replay, REPLAY_IDS, loadPage } from "./qwav_page_replay.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log("FAIL " + m); } };

// a page like the hardware visualizer: top-level const state, a builder, DOM wiring at load, a timer, a canvas
const page = `<!DOCTYPE html><html><body><canvas id="scene"></canvas><script>
"use strict";
const S = { atoms: [], gates: [], zoom: 1 };
function buildAtoms() {
  S.atoms = [{ id: 0, depth: 0, parent: -1 }];
  let next = 1;
  (function place(parent, depth) { if (depth >= 2) return; for (let k = 0; k < 2; k++) { const a = { id: next++, depth: depth + 1, parent: parent.id }; S.atoms.push(a); place(a, depth + 1); } })(S.atoms[0], 0);
  S.gates = [];
  for (let i = 1; i < S.atoms.length; i++) S.gates.push([S.atoms[i].parent, S.atoms[i].id]);
}
const cv = document.getElementById("scene"), ctx = cv.getContext("2d");
cv.addEventListener("mousedown", (e) => { S.dragging = e.clientX; });
document.querySelectorAll("#rotSeg button").forEach((b) => b.addEventListener("click", () => {}));
const dpr = Math.min(window.devicePixelRatio || 1, 2);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
if (!localStorage.getItem("tour-done")) setTimeout(() => {}, 800);
document.getElementById("label").textContent = "built";
buildAtoms();
</script></body></html>`;

ok(extractScript(page).includes("function buildAtoms"), "the inline script is extracted");
let threw = false;
try { extractScript("<script>a</script><script>b</script>"); } catch (e) { threw = /exactly one/.test(e.message); }
ok(threw, "a page with two inline scripts is refused instead of half-read");
ok(REPLAY_IDS.length === 7 && ["tree-distance", "ultrametric-convergence", "qpna-classifier", "monna-map-perspective", "hardware-visualizer", "error-confinement", "bt-qec"].every((id) => REPLAY_IDS.includes(id)), "a replay exists for each of the seven published demos");

const env = loadPage(page);
ok(env.elements.get("label") && env.elements.get("label").textContent === "built", "text the page writes to the DOM can be read back");
const out = replay("hardware-visualizer", page, {});
ok(out.atoms === 7 && out.gates === 6 && out.by_depth["0"] === 1 && out.by_depth["1"] === 2 && out.by_depth["2"] === 4, "the page's own builder is called through the page's top-level const: " + JSON.stringify(out));
ok(out.every_atom_has_parent_one_level_up && out.ids_unique, "structure flags are computed on the page's atoms");
ok(JSON.stringify(replay("hardware-visualizer", page, {})) === JSON.stringify(out), "a replay is deterministic");

// the recorded golden file
const golden = JSON.parse(readFileSync(join(here, "..", "docs", "qwav-page-golden.json"), "utf8"));
const ids = Object.keys(golden.page_outputs);
ok(REPLAY_IDS.every((id) => ids.includes(id)), "page_outputs holds an output for every replay: " + ids.join(","));
ok(REPLAY_IDS.every((id) => golden.pages[id] && /^[0-9a-f]{64}$/.test(golden.pages[id].sha256 || "") && golden.pages[id].bytes > 1000 && /^https:\/\//.test(golden.pages[id].url)), "every replayed page records its url, size and sha256");
ok(Object.keys(golden.inputs).every((id) => REPLAY_IDS.includes(id)), "inputs are keyed by replay id");
ok(golden.page_outputs["hardware-visualizer"].atoms === 40 && golden.page_outputs["hardware-visualizer"].gates === 39, "the recorded hardware visualizer page has 40 atoms and 39 gate edges");
ok(golden.page_outputs["error-confinement"].readouts.length === golden.inputs["error-confinement"].readout_cases.length, "the error-confinement readouts were read back for every case");

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
