import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mod = await import("data:text/javascript;base64," + Buffer.from(src + "\nexport { infraAIRun as __infraAIRun, AI_COST_LADDER as __ladder };\n").toString("base64"));
let pass = 0, fail = 0;
const ok = (condition, message, value) => {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL " + message + (value !== undefined ? " :: " + JSON.stringify(value).slice(0, 300) : ""));
  }
};

{
  const calls = [];
  const env = { AI: { async run(...args) { calls.push(args); return { data: [] }; } } };
  const model = Object.keys(mod.__ladder)[0];
  const input = { prompt: "non-critical" };
  await mod.__infraAIRun(env, model, input);
  const [selected, sent, options] = calls[0];
  ok(selected === mod.__ladder[model], "non-critical mapped calls select the cheaper ladder rung", selected);
  ok(sent === input && options.gateway.id === "default" && options.gateway.skipCache === false && options.gateway.cacheTtl === 86400, "default calls pass deterministic caching options through the gateway", options);
}

{
  const calls = [];
  const env = { AI: { async run(...args) { calls.push(args); return { data: [] }; } } };
  const model = Object.keys(mod.__ladder)[0];
  await mod.__infraAIRun(env, model, { prompt: "critical" }, { critical: true, skipCache: true });
  const [selected, , options] = calls[0];
  ok(selected === model, "critical calls preserve the requested model", selected);
  ok(options.gateway.id === "default" && options.gateway.skipCache === true && !("cacheTtl" in options.gateway), "skipCache omits the per-request TTL", options);
}

ok((src.match(/await infraAIRun\(env,/g) || []).length === 5, "all five infra embedding call sites use the gateway helper");
ok((src.match(/env\.AI\.run\(/g) || []).length === 1, "the only direct inference call is inside the gateway helper");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
