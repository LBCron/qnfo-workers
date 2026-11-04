// BP26-AXE-1: the axe-core runner reads its host list from bp26_web.py (so the two cannot drift) and keeps only serious and critical rule violations.
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { htmlHosts, severe } from "./bp26_axe.mjs";
const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + String(d).slice(0, 300))); } };

const hosts = htmlHosts(fs.readFileSync(join(here, "bp26_web.py"), "utf8"));
ok(hosts.length >= 10 && hosts.includes("qnfo.org") && hosts.includes("papers.qnfo.org") && hosts.includes("ask.qwav.tech"), "the host list is the HTML_HOSTS tuple of bp26_web.py", hosts.join(","));
ok(hosts.every((h) => /^[a-z0-9.-]+$/.test(h)) && new Set(hosts).size === hosts.length, "hosts are plain unique names");
ok(htmlHosts("nothing here").length === 0, "no tuple, no hosts");

const v = severe([
  { id: "color-contrast", impact: "serious", nodes: [1, 2, 3], help: "Elements must meet minimum color contrast ratio thresholds" },
  { id: "label", impact: "critical", nodes: [1], help: "Form elements must have labels" },
  { id: "region", impact: "moderate", nodes: [1, 2], help: "All page content should be contained by landmarks" },
  { id: "tabindex", impact: "minor", nodes: [], help: "x" },
]);
ok(v.length === 2 && v[0].id === "color-contrast" && v[0].nodes === 3 && v[1].impact === "critical", "only serious and critical rule violations are kept, with their node counts", JSON.stringify(v));
ok(severe(undefined).length === 0 && severe([]).length === 0, "an empty result is an empty list");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
