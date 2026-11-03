import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = readFileSync(new URL("../deploy-targets.txt", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
const targets = manifest
  .split(/\r?\n/)
  .map((line) => line.split("#", 1)[0].trim())
  .filter(Boolean)
  .map((line) => line.split(/\s+/));

assert.deepEqual(
  targets.filter(([worker]) => worker === "q08-signal-engine"),
  [["q08-signal-engine", "q08-signal-engine/worker.js"]],
  "q08 publication worker must be included exactly once in full canonical deploys",
);
assert.match(wrangler, /pattern = "q08\.org\/\*"/);
assert.match(wrangler, /pattern = "www\.q08\.org\/\*"/);
