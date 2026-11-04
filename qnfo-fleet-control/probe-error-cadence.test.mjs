import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(!/if \(out\.probe_error\) cadH/.test(src), "the shared out flag no longer sets the cadence");
assert.ok(/if \(verdict === "probe-error"\) cadH = Math\.max\(cadH, 1\);/.test(src), "only this contract's own probe-error stretches its cadence, to one hour");
console.log("ok");
