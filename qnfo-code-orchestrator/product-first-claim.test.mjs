import { readFileSync } from "node:fs";
import assert from "node:assert";
const s = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(s.includes("PRODUCT-FIRST-CLAIM-1"));
assert.ok(s.includes('"ORDER BY CASE WHEN " + PRODUCT_TASK_SQL + " THEN 0 ELSE 1 END'));
assert.equal(s, readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8"));
console.log("ok");
