// ENSEMBLE-RUN-LOG-1 (#1889 ENSEMBLE-POLICY-1) offline suite for qnfo-ai. Run: node --no-warnings qnfo-ai/ensemble-run-log.test.mjs
// Each ensemble call leaves one cloud_ops_events row (kind ensemble-run) carrying the primary and validator models, their
// families, the validator verdict and whether the reviewer ran, so same-family vs cross-family agreement is measurable.
// ENSEMBLE-FAMILY-DISJOINT-1 (5.31.4): every pool holds one model per family and the validator never shares the primary's family.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("FAIL " + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + " -- got " + JSON.stringify(a) + " want " + JSON.stringify(b)); }

const src = readFileSync(join(here, "worker.js"), "utf8");
const start = src.indexOf("function modelFamily(");
const end = src.indexOf("\n// end ensemble-run-log", start);
ok(start > 0 && end > start, "ensemble-run-log block found in worker.js");
const VERSION = (src.match(/^var VERSION = "([^"]+)"/m) || [])[1] || "";
const make = new Function("VERSION", "d1AttrWriteSkip", "d1OverloadTrip", src.slice(start, end) + "\nreturn { modelFamily, textHash32, ensembleRunMeta, logEnsembleRun, ensembleValidatorFor, poolFamiliesDistinct };");
const api = make(VERSION, () => false, () => false);
// ENSEMBLE_POOL and ENSEMBLE as the worker declares them (static reads; both are plain literals).
const poolSrc = src.slice(src.indexOf("var ENSEMBLE_POOL = {"), src.indexOf("};", src.indexOf("var ENSEMBLE_POOL = {")) + 2);
const POOL = new Function(poolSrc.replace("var ENSEMBLE_POOL", "const ENSEMBLE_POOL") + "\nreturn ENSEMBLE_POOL;")();
const ensSrc = src.slice(src.indexOf("var ENSEMBLE = {"), src.indexOf("};", src.indexOf("var ENSEMBLE = {")) + 2);
const ENS = new Function(ensSrc.replace("var ENSEMBLE", "const ENSEMBLE") + "\nreturn ENSEMBLE;")();

// 1 families: every pool entry maps to a family, same-family pairs are recognised.
eq(api.modelFamily("@cf/deepseek-ai/deepseek-v4-flash-0731"), "deepseek", "deepseek flash");
eq(api.modelFamily("@cf/deepseek-ai/deepseek-v4-pro-0813"), "deepseek", "deepseek pro");
eq(api.modelFamily("deepseek-v4-flash"), "deepseek", "short deepseek id (BYOK fallback)");
eq(api.modelFamily("@cf/moonshotai/kimi-k2.6"), "moonshot", "kimi");
eq(api.modelFamily("@cf/moonshotai/kimi-k2.7-code"), "moonshot", "kimi code");
eq(api.modelFamily("@cf/zai-org/glm-5.3"), "zai", "glm");
eq(api.modelFamily("@cf/zai-org/glm-5.3-flash"), "zai", "glm flash");
eq(api.modelFamily("@cf/openai/gpt-oss-120b"), "openai", "gpt-oss");
eq(api.modelFamily("@cf/meta/llama-3.3-70b-instruct-fp8-fast"), "meta", "llama");
eq(api.modelFamily("@cf/qwen/qwen3-30b-a3b-fp8"), "qwen", "qwen");
eq(api.modelFamily("@cf/nvidia/nemotron-3-120b-a12b"), "nvidia", "nemotron");
eq(api.modelFamily("@cf/someorg/newmodel-1"), "someorg", "unknown @cf vendor falls back to the vendor segment");
eq(api.modelFamily(""), "none", "empty id");

// 2 the hash is stable, short and text-sensitive.
eq(api.textHash32("abc"), api.textHash32("abc"), "same text, same hash");
ok(api.textHash32("abc") !== api.textHash32("abd"), "different text, different hash");
ok(/^[0-9a-f]{8}$/.test(api.textHash32("anything at all")), "8 hex chars");
eq(api.textHash32(""), api.textHash32(null), "empty and null hash alike");

// 3 the meta row for a validator PASS on a cross-family pair.
const ensPass = { primary_model: "@cf/zai-org/glm-5.3", intended_primary: "@cf/zai-org/glm-5.3", validator_model: "@cf/deepseek-ai/deepseek-v4-flash-0731", validator_verdict: "pass", reviewer_ran: false, verification_result: "passed", latency_ms: 4210 };
let m = api.ensembleRunMeta(ensPass, "science", "The answer is 42.");
eq([m.domain, m.primary_family, m.validator_family, m.same_family, m.verdict, m.reviewer_ran, m.result, m.latency_ms, m.primary_fell_back], ["science", "zai", "deepseek", false, "pass", false, "passed", 4210, false], "cross-family pass meta");
eq(m.text_len, 17, "text length recorded");
eq(m.text_hash, api.textHash32("The answer is 42."), "text hash recorded");
eq(m.v, VERSION, "row carries the worker version");

// 4 a same-family FAIL where the primary fell back and the reviewer ran.
const ensFail = { primary_model: "deepseek-v4-flash", intended_primary: "@cf/moonshotai/kimi-k2.6", validator_model: "@cf/deepseek-ai/deepseek-v4-flash-0731", validator_verdict: "fail", reviewer_ran: true, verification_result: "refined", latency_ms: 19000 };
m = api.ensembleRunMeta(ensFail, "general", "x");
eq([m.primary_family, m.validator_family, m.same_family, m.verdict, m.reviewer_ran, m.primary_fell_back, m.intended], ["deepseek", "deepseek", true, "fail", true, true, "@cf/moonshotai/kimi-k2.6"], "same-family fail meta after a fallback");

// 5 a skipped validator (no primary text) and a missing ens object never throw.
m = api.ensembleRunMeta({ validator_model: "@cf/deepseek-ai/deepseek-v4-flash-0731" }, "general", "");
eq([m.primary, m.primary_family, m.same_family, m.verdict, m.text_len], ["", "none", false, "skipped", 0], "skipped verdict meta");
m = api.ensembleRunMeta(null, undefined, undefined);
eq([m.domain, m.verdict, m.text_hash.length], ["", "skipped", 8], "null ens is tolerated");

// 6 the writer: one cloud_ops_events row, kind ensemble-run, job qnfo-ai, meta is the JSON above; errors are swallowed.
const rows = [];
const env = { QNFO_AUDIT: { prepare(sql) { let args = []; return { bind(...a) { args = a; return this; }, async run() { rows.push({ sql, args }); return { meta: { changes: 1 } }; } }; } } };
ok(await api.logEnsembleRun(env, ensPass, "science", "The answer is 42.") === true, "logEnsembleRun returns true on a write");
eq(rows.length, 1, "exactly one row");
ok(/INSERT INTO cloud_ops_events/.test(rows[0].sql) && /'ensemble-run'/.test(rows[0].sql) && /'qnfo-ai'/.test(rows[0].sql), "row is an ensemble-run event for qnfo-ai");
ok(/^ensrun-/.test(rows[0].args[0]), "id prefix ensrun-");
ok(/^ensemble science: zai -> deepseek pass$/.test(rows[0].args[2]), "text line names families and verdict: " + rows[0].args[2]);
const meta = JSON.parse(rows[0].args[3]);
eq([meta.primary_family, meta.validator_family, meta.verdict, meta.same_family], ["zai", "deepseek", "pass", false], "meta JSON round-trips");
const failEnv = { QNFO_AUDIT: { prepare() { throw new Error("D1 down"); } } };
ok(await api.logEnsembleRun(failEnv, ensPass, "science", "t") === false, "a D1 failure is swallowed, never thrown");
ok(await api.logEnsembleRun({}, ensPass, "science", "t") === false, "no binding is a no-op");

// 7 the handler wires it and the ensemble result carries the fields the log needs (static reads of the source).
ok(/ctx\.waitUntil\(logEnsembleRun\(env, ens, cls\.domain, ensText\)\);/.test(src), "handler logs every ensemble call");
ok(/primary_model: primaryModel,\s*intended_primary: intendedPrimary,\s*validator_model: validatorSpec\.wa,\s*validator_switched: validatorSpec\.switched,\s*validator_verdict: validatorVerdict,\s*reviewer_ran: membersRun\.indexOf\("reviewer"\) >= 0,/.test(src), "runEnsemble returns the model, switch and verdict fields");
ok(/validatorVerdict = pass \? "pass" : "fail";/.test(src), "validator verdict is recorded where PASS/FAIL is decided");
ok((src.match(/kind ensemble-run/g) || []).length >= 1, "the header comment names the row kind");

// 8 ENSEMBLE-FAMILY-DISJOINT-1: every pool holds at most one model per family, and the pools still cover 4 families.
for (const k of Object.keys(POOL)) ok(api.poolFamiliesDistinct(POOL[k]), "pool " + k + " has one model per family: " + POOL[k].map(api.modelFamily).join(","));
eq(POOL.science.map(api.modelFamily).sort(), ["deepseek", "moonshot", "openai", "zai"], "science pool covers four families");
eq(POOL.general.map(api.modelFamily).sort(), ["deepseek", "moonshot", "openai", "zai"], "general pool covers four families");
ok(POOL.general.indexOf("@cf/zai-org/glm-5.3-flash") >= 0 && POOL.general.indexOf("@cf/zai-org/glm-5.3") < 0, "general keeps the small zai model");
ok(POOL.science.indexOf("@cf/deepseek-ai/deepseek-v4-pro-0813") < 0, "science drops the second deepseek model");
ok(!api.poolFamiliesDistinct(["@cf/zai-org/glm-5.3", "@cf/zai-org/glm-5.3-flash"]), "the invariant check rejects two zai models");
ok(api.poolFamiliesDistinct([]) && api.poolFamiliesDistinct(null), "an empty pool is trivially distinct");

// 9 the validator is never the primary's family: deepseek primaries (pool pick or the deepseek-v4-flash fallback) are judged by validator_alt.
ok(ENS.validator_alt && ENS.validator_alt.wa && api.modelFamily(ENS.validator_alt.wa) !== api.modelFamily(ENS.validator.wa), "validator_alt is another family than validator");
let v = api.ensembleValidatorFor(ENS, "@cf/deepseek-ai/deepseek-v4-flash-0731");
eq([v.wa, v.switched], [ENS.validator_alt.wa, true], "deepseek primary (pool) switches to validator_alt");
v = api.ensembleValidatorFor(ENS, "deepseek-v4-flash");
eq([v.wa, v.switched], [ENS.validator_alt.wa, true], "deepseek fallback primary switches to validator_alt");
v = api.ensembleValidatorFor(ENS, "@cf/zai-org/glm-5.3");
eq([v.wa, v.switched, v.ctx], [ENS.validator.wa, false, ENS.validator.ctx], "zai primary keeps the default validator");
v = api.ensembleValidatorFor(ENS, "@cf/moonshotai/kimi-k2.7-code");
eq([v.wa, v.switched], [ENS.validator.wa, false], "coder primary keeps the default validator");
for (const k of Object.keys(POOL)) for (const p of POOL[k]) ok(api.modelFamily(api.ensembleValidatorFor(ENS, p).wa) !== api.modelFamily(p), "no pool member is judged by its own family: " + p);
v = api.ensembleValidatorFor({ validator: { wa: "@cf/deepseek-ai/deepseek-v4-flash-0731" } }, "@cf/deepseek-ai/deepseek-v4-pro-0813");
eq([v.wa, v.switched, v.ctx], ["@cf/deepseek-ai/deepseek-v4-flash-0731", false, 65536], "without validator_alt the default is kept (no throw)");
v = api.ensembleValidatorFor(null, "x");
eq([v.wa, v.switched], ["", false], "null ENSEMBLE is tolerated");
ok(src.includes('const validatorSpec = { wa: "dynamic/value"') && /runWorkersAI\(env, validatorSpec\.wa, truncateMessagesToFit\(vMsg, validatorSpec\.ctx\)/.test(src), "runEnsemble validates with the value route");
ok(!/runWorkersAI\(env, ENSEMBLE\.validator\.wa/.test(src), "no validator call bypasses the family check");
m = api.ensembleRunMeta({ primary_model: "deepseek-v4-flash", validator_model: ENS.validator_alt.wa, validator_switched: true, validator_verdict: "pass" }, "general", "t");
eq([m.primary_family, m.validator_family, m.same_family, m.validator_switched], ["deepseek", "zai", false, true], "meta records the switch and a cross-family pair");

// 10 ENSEMBLE-VALIDATOR-BUDGET-1: the validator keeps a budget slice (not a flat 15s) and its outcome is a stage row in the run row.
ok(/withTimeout\(runWorkersAI\(env, validatorSpec\.wa, truncateMessagesToFit\(vMsg, validatorSpec\.ctx\), 1024, false\), _stageCap\(0\.3, 15e3\), "ensemble-validator"\)/.test(src), "validator timeout is a 30% budget slice with a 15s floor");
ok(!/Math\.min\(15e3, _remaining\(\)\), "ensemble-validator"/.test(src), "the flat 15s validator cap is gone");
ok(/_mk\("validator", _sv, true\);/.test(src) && /_mk\("validator", _sv, false, eV\);\s*throw eV;/.test(src), "validator success and timeout are stage rows, the timeout still skips verification");
ok(/_mk\("reviewer", _sr, !!rText\.trim\(\)\);/.test(src) && /_mk\("reviewer", _sr, false, e\);/.test(src), "reviewer outcome is a stage row");
m = api.ensembleRunMeta({ primary_model: "@cf/openai/gpt-oss-120b", validator_model: ENS.validator.wa, validator_verdict: "skipped", stages: { primary: { ms: 55010, ok: true, rem: 64990 }, validator: { ms: 15002, ok: false, err: "timeout ensemble-validator", rem: 49988 } } }, "science", "t");
eq([m.verdict, m.stages.validator.ok, m.stages.validator.ms], ["skipped", false, 15002], "a starved validator is visible in the run row");
eq(api.ensembleRunMeta({ stages: "bad" }, "x", "").stages, null, "non-object stages are dropped");
ok(JSON.stringify(m).length < 1200, "a run row with stages stays well under the 1800-char meta cap");

console.log("ensemble-run-log: " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
