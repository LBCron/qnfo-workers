// personal-api/companion-reading.test.mjs (COMPANION-READING-1, rule 27)
// Run: node personal-api/companion-reading.test.mjs
import fs from "node:fs";
import * as C from "./companion.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra).slice(0, 400) : "")); }
};
const lane = (m, low) => C.readingLane(m, low).lane;

ok("no record reads as steady, never low", lane({ today: null, avg7: null, avg2: null }) === "steady" && lane(undefined) === "steady");
ok("a low day today is gentle", lane({ today: 2, avg7: 4, avg2: 4 }) === "gentle");
ok("two low days are gentle even without today's mood", lane({ today: null, avg7: 3, avg2: 2 }) === "gentle");
ok("risk words in the last day are gentle", lane({ today: 4, avg7: 4, avg2: 4 }, true) === "gentle");
ok("a steady week is deep", lane({ today: 4, avg7: 3.8, avg2: 3.5 }) === "deep" && lane({ today: null, avg7: 3.5, avg2: 3.5 }) === "deep");
ok("a middling week is steady", lane({ today: 3, avg7: 3.1, avg2: 3 }) === "steady");
const r = C.readingLane({ today: 1, avg7: 2, avg2: 1 });
ok("only the lane name is in the link", r.url === "https://mind.q08.org/now?lane=gentle" && !/[0-9]/.test(r.url.replace("q08", "")), r.url);
ok("the reason is plain and kind", /Stop whenever you like/.test(r.why));
const w = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
ok("the inlined worker carries readingLane and the Today card", /function readingLane/.test(w) && /Something to read/.test(w));
ok("the guide lists the reading pick", /mind\.q08\.org<\/a>/.test(C.GUIDE_HTML));
ok("worker.js and its mirror match", w === fs.readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8"));
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
