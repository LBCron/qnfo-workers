// PROBE-UA-BOT-1 (2026-11-04, pillar reach; READER-YIELD-1): the fleet's own link probes must not be counted as readers.
// qnfo-gateway counts a tagged page load in utm_clicks as ua_class human unless its user agent matches UTM_BOT_RE. probeLink and httpStatus fetch every tagged link before a post
// goes out; their user agents did not match, so each probe was a human click. This suite pins the two probe user agents to the generic part of that rule (the word bot, which the
// gateway regex has matched since UTM-CLICK-LEDGER-1) and to the mirror, so a later edit cannot quietly bring the floor back.
// Run: node qnfo-social/probe-ua.test.mjs
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");

// the user agents of the two probes, read from the function bodies
const fn = (name) => {
  const i = src.indexOf("async function " + name + "(");
  ok(i >= 0, name + " exists");
  return src.slice(i, i + 900);
};
const uaOf = (body) => { const m = /"User-Agent": "([^"]+)"/.exec(body); return m ? m[1] : null; };
const probe = uaOf(fn("probeLink"));
const gate = uaOf(fn("httpStatus"));
ok(!!probe && !!gate, "both probes set a User-Agent", { probe, gate });

// the part of the gateway rule these agents rely on: the word bot (case-insensitive); the regex is read from the gateway to prove it still contains it
const gw = readFileSync(new URL("../qnfo-gateway/worker.js", import.meta.url), "utf8");
const m = /var UTM_BOT_RE = \/([^\/]+)\/i;/.exec(gw);
ok(!!m, "the gateway UTM_BOT_RE can be read", m && m[1]);
const re = new RegExp(m ? m[1] : "$^", "i");
ok(re.test(probe), "the link-probe user agent is classed bot by the gateway rule", probe);
ok(re.test(gate), "the link-gate user agent is classed bot by the gateway rule", gate);
ok(/\bbot\b/i.test(probe) && /\bbot\b/i.test(gate), "and does so by the word bot itself, so a narrower later rule that keeps the word still matches", { probe, gate });
ok(/link-probe/.test(probe) && /link-gate/.test(gate), "each still names the probe that sent it (the log and any later rule can tell them apart)");

// a real reader's user agent still reads as human
ok(!re.test("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"), "a desktop browser is not matched, so real clicks stay counted");
ok(!re.test("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"), "a phone browser is not matched either");

// no probe still sends the old agents, and the worker and its mirror are identical (mirror-guard)
ok(!/qnfo-social link-probe\)"/.test(src) && !/qnfo-social link-gate\)"/.test(src), "the old agents without the bot marker are gone");
ok(src === mirror, "deployed-current.worker.js is identical to worker.js");
const v = /var VERSION = "([^"]+)"/.exec(src);
ok(!!v && /^0\.21\.(1[5-9]|[2-9]\d)/.test(v[1]), "VERSION is 0.21.15 or above", v && v[1]);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
