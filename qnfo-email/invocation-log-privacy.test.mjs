import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8").split(/\r?\n/);
function section(name) {
  const start = config.indexOf(`[${name}]`);
  assert.notEqual(start, -1, `missing [${name}] section`);
  const end = config.findIndex((line, i) => i > start && /^\s*\[/.test(line));
  return config.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

assert.match(section("observability.logs"), /^enabled\s*=\s*true\s*$/m);
assert.match(section("observability.logs"), /^invocation_logs\s*=\s*false\s*$/m);
assert.match(section("observability.traces"), /^enabled\s*=\s*true\s*$/m);

console.log("qnfo-email disables PII-bearing invocation logs while retaining application logs and traces");
