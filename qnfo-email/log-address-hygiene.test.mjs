// BP26-PII-LOGS-2 (qnfo-email, roadmap row 1400, agent_issues 1000344; metric pii_in_logs): offline suite, no network, synthetic data.
// The daily step logs `console.log("qnfo-email freshness", JSON.stringify(await freshnessGuard(env)))`, and a retired mailbox store is named by its address, so the Workers Logs
// scan found the owner's two retired mailboxes in that line. Proves: the object freshnessGuard returns (what is logged) carries no raw address, a stable token stands in for each
// one so a line can still be matched to a mailbox, a non-address store name ("gmail") is left alone, and the stale list is masked the same way.
// Run: node qnfo-email/log-address-hygiene.test.mjs
import fs from "node:fs";
import { stripWorkerDefaultExport } from "../scripts/worker-source-test.mjs";
const src = stripWorkerDefaultExport(fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8"));
const lib = new Function(src.replace(/export default\{/, "const __handler={") + "\nreturn {freshnessGuard,logSafeAddr,RETIRED_STORES};")();
const fail = [];
let n = 0;
const ok = (l, c, x) => { n++; if (!c) fail.push(l + (x !== undefined ? ": " + JSON.stringify(x).slice(0, 300) : "")); };

const ADDR = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString().replace("T", " ").slice(0, 19);
const retiredAddresses = Object.keys(lib.RETIRED_STORES).filter((k) => k.includes("@"));
ok("the worker still retires at least one address-named store (the case under test)", retiredAddresses.length >= 1, Object.keys(lib.RETIRED_STORES));

function env(stores) {
  const stmt = (sql) => {
    const s = {
      bind: () => s,
      async first() { return /FROM emails/.test(sql) ? { last_seen: daysAgo(0) } : /FROM events/.test(sql) ? { last_seen: daysAgo(0) } : null; },
      async all() { return /FROM email_index/.test(sql) ? { results: stores.map((st) => ({ store: st, last_seen: daysAgo(0) })) } : { results: [] }; },
      async run() { return { meta: { changes: 0 } }; },
    };
    return s;
  };
  return { AUDIT_DB: { prepare: stmt }, PERSONAL: { prepare: stmt } };
}

const r = await lib.freshnessGuard(env(["qnfo.org", "gmail", ...retiredAddresses]));
const line = JSON.stringify(r);
ok("the logged result names every retired store", r.retired.length === 1 + retiredAddresses.length, r);
ok("no raw address is in what is logged", !ADDR.test(line), line);
ok("an address is replaced by a token", r.retired.filter((x) => /^addr#[0-9a-f]{8}$/.test(x)).length === retiredAddresses.length, r.retired);
ok("a store name that is not an address is kept", r.retired.includes("gmail"), r.retired);
ok("two different addresses give two different tokens", new Set(r.retired.filter((x) => x.startsWith("addr#"))).size === retiredAddresses.length, r.retired);

ok("the token is stable: the same address, in any case, gives the same token", lib.logSafeAddr("Someone@Example.org") === lib.logSafeAddr("someone@example.org") && /^addr#[0-9a-f]{8}$/.test(lib.logSafeAddr("someone@example.org")));
ok("an address inside a sentence is masked and the rest is kept", lib.logSafeAddr("email_index store a.b+c@mail.example.co.uk:5d") .startsWith("email_index store addr#") && lib.logSafeAddr("email_index store a.b+c@mail.example.co.uk:5d").endsWith(":5d"));
ok("null and non-strings do not throw", lib.logSafeAddr(null) === "" && lib.logSafeAddr(42) === "42");

// a stale store is masked too (its name is the source label that goes into the stale list)
const stale = await lib.freshnessGuard(Object.assign(env(["qnfo.org"]), {}));
ok("a fresh run has an empty stale list", Array.isArray(stale.stale) && stale.stale.length === 0, stale);

console.log(fail.length ? "FAILED\n" + fail.join("\n") : n + " passed, 0 failed");
process.exit(fail.length ? 1 : 0);
