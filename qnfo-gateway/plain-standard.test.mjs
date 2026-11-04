// PLAIN-STANDARD-1 offline suite (qnfo-gateway 3.48.0, agent_issues 1000476, pillar reach).
// Proves: the summary prompt asks for a comparison, at most two figures and short sentences; plainBuild regenerates once and flags a result
// above Flesch-Kincaid grade 9 as gated (never an ungated hard text); an easy first try needs no second call; plainStore writes only
// ungated text; plainFillOrder queues stored summaries above grade 9 (hardest first) and holds a recently gated one back for six hours.
// Run: node qnfo-gateway/plain-standard.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400) : "")); } };

const lines = src.split("\n");
const grab = (re) => { const l = lines.find((x) => re.test(x)); if (!l) throw new Error("missing " + re); return l; };
const code = [
  /^var PLAIN_MAX_SENT/, /^var PLAIN_MIN_LEN/, /^var PLAIN_TARGET_GRADE/, /^var PLAIN_HARD_GRADE/, /^var PLAIN_RETRY_MS/, /^var PLAIN_REFUSAL_MARKERS/, /^var PLAIN_PROMPT_MARKERS/,
  /^function sylCount/, /^function fleschGrade/, /^function plainSentenceCount/, /^function plainHasPromptResidue/, /^function plainPrompt/,
  /^async function plainBuild/, /^function plainRevOk/, /^function plainRev\(/, /^function fnv32/, /^function plainFillOrder/, /^async function plainMarkGated/, /^async function plainStore/,
].map(grab).join("\n");

const HARD = "The investigators operationalized interferometric characterization methodologies, demonstrating considerable superconductivity-related phenomenological discrepancies notwithstanding theoretical expectations.";
const EASY = "The team built a small test that checks the idea. It worked in every trial. That helps people plan real tools.";
function make(replies) {
  const calls = [];
  const stubs = `
    var __replies = R.slice(); var plainRunCalls = C;
    async function plainRun(env, prompt) { plainRunCalls.push(prompt); return __replies.shift() || ""; }
    function plainGround(text, paper) { return { text: text, dropped: 0 }; }
    function plainTable() { return Promise.resolve(); }
    var puts = P;
    async function plainPut(env, paper, p) { puts.push(["put", p.grade]); }
  `;
  const puts = [];
  const fn = new Function("R", "C", "P", code + "\n" + stubs + "\nreturn { plainBuild, plainStore, plainPrompt, plainFillOrder, fleschGrade, PLAIN_HARD_GRADE, PLAIN_RETRY_MS };");
  return { api: fn(replies, calls, puts), calls, puts };
}

// ---- prompt ----
{
  const { api } = make([]);
  const p = api.plainPrompt({ title: "T" }, { claim: "c", abstract: ["a"] }, false);
  ok(/everyday comparison/.test(p) && /at most two figures/i.test(p) && /under 20 words/.test(p) && /Define every technical term/.test(p), "prompt asks for a comparison, two figures, short sentences, inline definitions", p.slice(0, 200));
  ok(!/its key numbers/.test(p), "prompt no longer asks for key numbers");
  ok(/hard rules:/i.test(p) && /cover, in this order:/i.test(p), "prompt residue markers are still in the prompt");
}

// ---- readability measure ----
{
  const { api } = make([]);
  ok(api.fleschGrade(HARD) > 9, "fixture HARD is above grade 9", api.fleschGrade(HARD));
  ok(api.fleschGrade(EASY) <= 9, "fixture EASY is at or under grade 9", api.fleschGrade(EASY));
  ok(api.PLAIN_HARD_GRADE === 9, "hard grade is 9");
}

// ---- build ----
{
  const t = make([EASY]);
  const b = await t.api.plainBuild({ AI: {} }, { slug: "s", title: "T", abstract: "", body_md: "" }, {});
  ok(b && !b.gated && b.grade <= 9, "an easy first try is not gated", b);
  ok(t.calls.length === 1, "an easy first try costs one model call", t.calls.length);
}
{
  const t = make([HARD, EASY]);
  const b = await t.api.plainBuild({ AI: {} }, { slug: "s", title: "T", abstract: "", body_md: "" }, {});
  ok(b && !b.gated && b.text === EASY && t.calls.length === 2, "a hard first try is regenerated once and the easy second try wins", { n: t.calls.length, g: b && b.grade });
  ok(/under 16 words/.test(t.calls[1]), "the regeneration uses the strict prompt");
}
{
  const t = make([HARD, HARD]);
  const b = await t.api.plainBuild({ AI: {} }, { slug: "s", title: "T", abstract: "", body_md: "" }, {});
  ok(b && b.gated === true && b.grade > 9 && t.calls.length === 2, "two hard tries end gated after exactly one regeneration", { n: t.calls.length, gated: b && b.gated });
  await t.api.plainStore({ LIVING_PAPER: { prepare() { return { bind() { return { run: async () => { t.puts.push(["gated-mark"]); } }; } }; } } }, { slug: "s" }, b);
  ok(t.puts.length === 1 && t.puts[0][0] === "gated-mark", "a gated build is marked, never put", t.puts);
  const t2 = make([EASY]);
  const b2 = await t2.api.plainBuild({ AI: {} }, { slug: "s", title: "T", abstract: "", body_md: "" }, {});
  const n = await t2.api.plainStore({}, { slug: "s" }, b2);
  ok(n === 1 && t2.puts.length === 1 && t2.puts[0][0] === "put", "an ungated build is put", t2.puts);
}

// ---- fill order (the backfill queue) ----
{
  const { api } = make([]);
  const now = Date.parse("2026-10-28T12:00:00Z");
  const body = "b";
  const paper = (slug, grade, extra) => Object.assign({ slug, version: "1", body_md: body, plain_text: EASY, plain_rev: "pl1|1|" + body.length + "|" + "x", plain_grade: grade }, extra || {});
  // plainRev uses fnv32; build the matching rev through the real functions
  const rev = (p) => "pl1|" + p.version + "|" + p.body_md.length + "|" + (new Function(grab(/^function fnv32/) + "\nreturn fnv32;"))()(p.body_md);
  const mk = (slug, grade, extra) => { const p = paper(slug, grade, extra); p.plain_rev = rev(p); return p; };
  const list = [
    mk("ok", 7), mk("g13", 13), mk("g10", 10), mk("g20", 20),
    mk("cool", 15, { plain_method: "gated:15", plain_at: "2026-10-28T10:00:00Z" }),
    mk("old", 15, { plain_method: "gated:15", plain_at: "2026-10-28T03:00:00Z" }),
    mk("gone", 0, { plain_text: "", plain_method: "gated:12", plain_at: "2026-10-28T11:00:00Z" }),
  ];
  const o = api.plainFillOrder(list, now);
  ok(o.over.map((p) => p.slug).join() === "g20,old,g13,g10", "over queue is hardest first, skips a fresh gated mark and a paper at grade 7", o.over.map((p) => p.slug));
  ok(o.missing.length === 0, "a missing summary gated within six hours is held back", o.missing.map((p) => p.slug));
  const o2 = api.plainFillOrder(list, now + 5 * 3600 * 1000);
  ok(o2.missing.map((p) => p.slug).join() === "gone" && o2.over.some((p) => p.slug === "cool"), "after six hours both are retried", { m: o2.missing.map((p) => p.slug), o: o2.over.map((p) => p.slug) });
}

// ---- source ----
ok(/var VERSION="3\.(4[8-9]|[5-9]\d)\./.test(src) || /var VERSION="(?:[4-9]|\d{2,})\./.test(src), "version is 3.48 or later");
ok(/ORDER BY CASE WHEN s\.slug IS NOT NULL AND " \+ plainResidueSql/.test(src) && /s\.grade > " \+ PLAIN_HARD_GRADE/.test(src), "the fill query ranks over-grade summaries ahead of fresh ones");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
