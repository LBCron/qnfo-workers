// WEEKLY-SIGNAL-1 (RM-BS-WEEKLY-SIGNAL-1, pillar reach): the weekly "claim, check, limits" issue, its human review gate and its send rules.
// Offline: an in-memory SQLite stands in for D1 (the table is created from the real migration file), a mock sender stands in for Email Service.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { signalSlot, signalDate, signalTick, signalToken, sigPick, sigTitle, sigCheck, sigLimits } from "./worker.js";

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("weekly-signal tests must not access a network"); };
const TOKEN = "synthetic-weekly-signal-authority";
const ctx = { waitUntil() {} };
const MIGRATION = readFileSync(new URL("../migrations/2026-11-05-weekly-signal-issues.sql", import.meta.url), "utf8");
const NOW = Date.parse("2026-11-05T05:00:00Z"); // a Thursday; the next slot is Sunday 2026-11-08 16:00 UTC
const SEND_DATE = "2026-11-08";
const today = () => new Date().toISOString().slice(0, 10);

const BODY_A = [
  "# Paper A", "", "## 6. Discussion", "",
  "**Falsification.** The result would be falsified if a measured gap fell below one unit for large N, e.g. in a device with analog arithmetic. A second observation would also refute it.", "",
  "**Limitations.** The result rests on the following assumptions:", "",
  "1. **Integer penalties are available** (Section 3). The whole result depends on this.",
  "2. **Thermal equilibrium holds.** Tunnelling would break it.", "",
  "## Provenance and AI Involvement", "",
  "- Not checked: whether each cited source supports its sentence. This paper has not been peer reviewed."
].join("\n");
const BODY_B = "# Paper B\n\n## Abstract\n\nA short abstract with no falsification section and no limitations section.\n";
const BODY_H = "# Paper H\n\n## 5. Falsifiability\n\nThis claim fails if the replication shows no effect at the stated sample size. Nothing else is claimed.\n\n## 6. Limitations\n\nThe sample is small and the instruments were not calibrated.\n";
const BODY_E = "# Paper E\n\n**(c) Smallest falsifying experiment.** Run the circuit on five qubits and compare the two energies. A difference above one percent refutes the claim.\n\n**Falsification.** Some other test that should lose to the experiment.\n\n**What the results do and do not claim.** The numbers are exact for the model and say nothing about hardware.\n";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE papers(slug TEXT, title TEXT, created_at TEXT, doi TEXT, status TEXT, version TEXT DEFAULT '1.0.0', paper_type TEXT, body_md TEXT);
    CREATE TABLE plain_summary(slug TEXT PRIMARY KEY, rev TEXT, text TEXT, grade REAL);
    CREATE TABLE internal_errata(id TEXT PRIMARY KEY, target_kind TEXT, target_ref TEXT, status TEXT, severity TEXT);
    CREATE TABLE subscribers(email TEXT PRIMARY KEY, status TEXT, unsub_token TEXT, created_at TEXT, updated_at TEXT, last_digest_at TEXT);
    CREATE TABLE email_suppression(email TEXT PRIMARY KEY);
    CREATE TABLE subscriber_digest_runs(period_start TEXT, period_end TEXT, papers INTEGER, recipients INTEGER, sent INTEGER, failed INTEGER, status TEXT, notes TEXT);
    CREATE TABLE cloud_ops_events(id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
  `);
  db.exec(MIGRATION);
  const binding = {
    prepare(sql) {
      let args = [];
      const q = {
        bind(...values) { args = values; return q; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async first() { return db.prepare(sql).get(...args) || null; },
        async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; }
      };
      return q;
    }
  };
  const deliveries = [];
  const env = {
    AUDIT: binding, LIVING: binding, SUBSCRIBERS_TOKEN: TOKEN,
    SEND_EMAIL: { async send(message) { deliveries.push(message); return { messageId: "synthetic-" + deliveries.length }; } }
  };
  const paper = (slug, title, createdAt, status, body, plain, extra = {}) => {
    db.prepare("INSERT INTO papers(slug,title,created_at,status,version,paper_type,body_md) VALUES(?,?,?,?,?,?,?)").run(slug, title, createdAt, status, "1.0.0", "preprint", body);
    if (plain !== null) db.prepare("INSERT INTO plain_summary(slug,rev,text,grade) VALUES(?,?,?,?)").run(slug, extra.rev || "pl1|1.0.0|1234|abcd|g2", plain, extra.grade ?? 8);
  };
  const add = (email, status) => db.prepare("INSERT INTO subscribers VALUES(?,?,?,datetime('now'),NULL,NULL)").run(email, status, "link-" + email.split("@")[0]);
  const call = (path, init) => worker.fetch(new Request("https://subscribers.example.test" + path, init), env, ctx);
  const digest = (body = {}) => call("/run/digest", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN }, body: JSON.stringify(body) });
  const insertIssue = (sendDate, status, extra = {}) => db.prepare(
    "INSERT INTO weekly_signal_issues(send_date,status,subject,body_text,items_json,voice_disclosure) VALUES(?,?,?,?,?,?)"
  ).run(sendDate, status, extra.subject || "QNFO weekly signal, " + sendDate + ": 1 claim with checks and limits", extra.body || "QNFO weekly signal, " + sendDate + "\n\nBody of the approved text.\n\nAudio edition: not yet published. When it is, the voice is synthetic and will be labelled as such.", extra.items || "[{\"slug\":\"a\"}]", "Audio edition: not yet published.");
  return { db, env, deliveries, paper, add, call, digest, insertIssue };
}
function seedPapers(f) {
  f.paper("paper-a", "Paper A: a constant gap", "2026-11-03 10:00:00", "published", BODY_A, "A gap of one unit holds in the idealised model. It says nothing about hardware.");
  f.paper("paper-b", "Paper B: plain only", "2026-11-04 10:00:00", "published", BODY_B, "A short claim without any test attached to it.");
  f.paper("paper-e", "Paper E: an experiment", "2026-11-02 09:00:00", "published", BODY_E, "Five qubits are enough to see the effect in principle.");
  f.paper("paper-h", "Paper H: headings of a $\\mathbb{Z}_2$ kind", "2026-11-01 09:00:00", "published", BODY_H, "A replication decides this claim.");
  f.paper("paper-err", "Paper with an open erratum", "2026-11-04 12:00:00", "published", BODY_A, "Should never be chosen.");
  f.db.prepare("INSERT INTO internal_errata VALUES('x1','paper','paper-err','open','high')").run();
  f.db.prepare("INSERT INTO internal_errata VALUES('x2','paper','paper-a','closed','high')").run();
  f.paper("paper-draft", "A draft paper", "2026-11-04 13:00:00", "draft", BODY_A, "Not published, never chosen.");
  f.paper("paper-nosummary", "No summary", "2026-11-04 14:00:00", "published", BODY_A, null);
  f.paper("paper-oldrev", "Summary for another version", "2026-11-04 15:00:00", "published", BODY_A, "Stale summary.", { rev: "pl1|0.9.0|1|a|g2" });
  f.paper("paper-hard", "Summary above grade twelve", "2026-11-04 16:00:00", "published", BODY_A, "Hard summary.", { grade: 14 });
  f.paper("paper-old", "Older than a week", "2026-10-20 10:00:00", "published", BODY_A, "Too old.");
}
const countRows = (db, t) => db.prepare("SELECT COUNT(*) n FROM " + t).get().n;

try {
  // 1. The slot arithmetic is the cron's: Sunday 16:00 UTC, the next one at or after now.
  assert.equal(signalDate(signalSlot(NOW)), SEND_DATE);
  assert.equal(new Date(signalSlot(Date.parse("2026-11-08T15:59:00Z"))).toISOString(), "2026-11-08T16:00:00.000Z");
  assert.equal(new Date(signalSlot(Date.parse("2026-11-08T16:00:00Z"))).toISOString(), "2026-11-15T16:00:00.000Z", "at the slot the next week begins");
  assert.equal(new Date(signalSlot(Date.parse("2026-11-09T00:00:00Z"))).toISOString(), "2026-11-15T16:00:00.000Z");

  // 2. The extractors quote the paper and say when there is nothing to quote.
  assert.equal(sigPick("See e.g. the Hamiltonian. It holds. Then (see Fig. 3) it fails.", 400, 3), "See e.g. the Hamiltonian. It holds. Then (see Fig. 3) it fails.", "abbreviations do not end a sentence");
  assert.equal(sigPick("The gap is $\\Delta E=1$ here. It holds.", 400, 3), "The gap is (formula) here. It holds.");
  assert.equal(sigPick("A $$x=\\frac{1}{2}$$ B.", 400, 1), "A (formula) B.");
  assert.equal(sigPick("A (formula) b (formula) c (formula) d. Plain next sentence.", 400, 1), "Plain next sentence.", "a sentence of formulas is skipped");
  assert.ok(sigPick("x ".repeat(400) + "end.", 100, 1).endsWith("…"));
  assert.match(sigCheck(BODY_A), /^The result would be falsified if a measured gap fell below one unit for large N, e\.g\. in a device with analog arithmetic\./);
  assert.match(sigCheck(BODY_E), /^Run the circuit on five qubits/, "the smallest falsifying experiment is preferred to the general falsification paragraph");
  assert.match(sigCheck(BODY_H), /^This claim fails if the replication shows no effect/, "a heading works as well as a bold label");
  assert.equal(sigCheck(BODY_B), "");
  assert.equal(sigTitle("A $\\mathbb{Z}_2$ invariant of $x^{2}$ maps"), "A Z2 invariant of x2 maps", "TeX in a title is flattened to plain text");
  assert.equal(sigPick("$a$ and $b$ and $c$ hold. Plain next sentence.", 400, 1, true), "", "with lead set the excerpt never starts mid-passage");
  assert.match(sigCheck("**Falsification.** The claim fails for $a$, $b$ and $c$ together. A later sentence.\n"), /formulas this step does not quote/, "a test that exists but cannot be quoted is said so, not reported missing");
  assert.match(sigCheck("**(c) The smallest next test.** Measure the gap on five qubits. A gap under one refutes the claim.\n"), /^Measure the gap on five qubits\./);
  assert.match(sigLimits("**Limitations list.**\n\n1. $a$, $b$ and $c$ are assumed.\n"), /formulas this step does not quote/);
  assert.equal(sigLimits(BODY_A), "Limits the paper states: (1) Integer penalties are available (Section 3). (2) Thermal equilibrium holds.");
  assert.match(sigLimits(BODY_H), /^The sample is small/);
  assert.match(sigLimits(BODY_E), /^The numbers are exact for the model/);
  assert.equal(sigLimits(BODY_B), "");

  // 3. Outside the 96-hour lead window nothing is drafted; the tick expires only what is past.
  {
    const f = fixture(); seedPapers(f);
    const r = await signalTick(f.env, Date.parse("2026-11-02T10:00:00Z"), {});
    assert.equal(r.skipped, "outside-window");
    assert.equal(countRows(f.db, "weekly_signal_issues"), 0);
    assert.equal(f.deliveries.length, 0);
  }

  // 4. Inside the window: one draft, chosen by rule, mailed once to the owner, never to a subscriber.
  let reviewUrl;
  {
    const f = fixture(); seedPapers(f);
    f.add("sub@example.test", "subscribed");
    const r = await signalTick(f.env, NOW, {});
    assert.equal(r.ok, true);
    assert.equal(r.owner_mail, "sent");
    const row = f.db.prepare("SELECT * FROM weekly_signal_issues").get();
    assert.equal(row.send_date, SEND_DATE);
    assert.equal(row.status, "draft");
    assert.equal(row.mail_attempts, 1);
    assert.ok(row.owner_mailed_at);
    const items = JSON.parse(row.items_json);
    assert.equal(items.length, 3, "at most three items");
    const slugs = items.map(i => i.slug);
    for (const bad of ["paper-err", "paper-draft", "paper-nosummary", "paper-oldrev", "paper-hard", "paper-old"]) assert.ok(!slugs.includes(bad), bad + " is not eligible");
    assert.deepEqual(slugs.slice().sort(), ["paper-a", "paper-e", "paper-h"], "papers with a stated check and limits rank above the plain-only paper");
    assert.ok(!slugs.includes("paper-b"));
    assert.equal(items.find(i => i.slug === "paper-h").title, "Paper H: headings of a Z2 kind", "the stored title carries no TeX");
    assert.ok(!row.body_text.includes("$") && !row.body_text.includes("\\mathbb"), "no TeX reaches the issue text");
    assert.ok(row.body_text.includes("Claim (plain-language summary, written by a model):"));
    assert.ok(row.body_text.includes("Check: "));
    assert.ok(row.body_text.includes("Limits: "));
    assert.ok(row.body_text.includes("Not independently peer-reviewed."));
    assert.ok(row.body_text.includes("No open erratum is recorded."));
    assert.ok(row.body_text.includes("Audio edition: not yet published. When it is, the voice is synthetic and will be labelled as such."));
    assert.ok(row.body_text.includes("human editor"));
    assert.ok(row.body_text.includes("utm_source=digest"));
    assert.equal(row.voice_disclosure.includes("synthetic"), true);
    assert.equal(f.deliveries.length, 1, "exactly one mail, to the owner");
    assert.equal(f.deliveries[0].to, "rwnquni@outlook.com");
    assert.match(f.deliveries[0].subject, /^QNFO weekly signal draft for 2026-11-08/);
    assert.ok(f.deliveries[0].text.includes("Nothing goes to subscribers unless you approve it."));
    assert.ok(f.deliveries[0].text.includes(row.body_text), "the owner reads the whole draft in the mail");
    const m = /https:\/\/qnfo-subscribers\.q08\.workers\.dev(\/review\?week=2026-11-08&token=[0-9a-f]{40})/.exec(f.deliveries[0].text);
    assert.ok(m, "the mail carries the review link");
    reviewUrl = m[1];
    assert.ok(!f.deliveries[0].text.includes(TOKEN), "the secret itself is never in the mail");
    // Later ticks neither redraft nor mail again.
    await signalTick(f.env, NOW + 36e5, {});
    await signalTick(f.env, NOW + 2 * 36e5, {});
    assert.equal(countRows(f.db, "weekly_signal_issues"), 1);
    assert.equal(f.deliveries.length, 1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind='subscribers-signal' AND status='drafted'").get().n, 1);

    // 5. The review link: a GET changes nothing; a wrong token is refused; the buttons decide.
    const before = JSON.stringify(f.db.prepare("SELECT * FROM weekly_signal_issues").all());
    const get = await f.call(reviewUrl);
    assert.equal(get.status, 200);
    const page = await get.text();
    assert.ok(page.includes('name="decision" value="approve"') && page.includes('name="decision" value="reject"'));
    assert.ok(page.includes('content="noindex,nofollow"'));
    assert.equal(get.headers.get("Cache-Control"), "no-store");
    assert.equal(JSON.stringify(f.db.prepare("SELECT * FROM weekly_signal_issues").all()), before, "a GET never changes the issue");
    assert.equal((await f.call("/review?week=2026-11-08&token=" + "0".repeat(40))).status, 403);
    assert.equal((await f.call("/review?week=2026-11-08&token=short")).status, 400);
    assert.equal((await f.call("/review?week=2026-11-09&token=" + reviewUrl.split("token=")[1])).status, 403, "a token is bound to its date");
    assert.equal(JSON.stringify(f.db.prepare("SELECT * FROM weekly_signal_issues").all()), before);
  }

  // 6. The decision (POST) on a far-future issue so the result does not depend on the wall clock.
  {
    const f = fixture();
    f.insertIssue("2099-01-03", "draft");
    const token = await signalToken(f.env, "2099-01-03");
    assert.match(token, /^[0-9a-f]{40}$/);
    const post = (decision, tok = token) => f.call("/review", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ week: "2099-01-03", token: tok, decision }).toString() });
    const status = () => f.db.prepare("SELECT status FROM weekly_signal_issues WHERE send_date='2099-01-03'").get().status;
    assert.equal((await post("approve", "f".repeat(40))).status, 403);
    assert.equal(status(), "draft", "a wrong token decides nothing");
    assert.equal((await post("maybe")).status, 200);
    assert.equal(status(), "draft", "an unknown decision decides nothing");
    const ok = await post("approve");
    assert.equal(ok.status, 200);
    assert.equal(status(), "approved");
    assert.match(await ok.text(), /approved; it will be sent to confirmed subscribers/);
    const row = f.db.prepare("SELECT reviewed_at, reviewed_by FROM weekly_signal_issues").get();
    assert.ok(row.reviewed_at && row.reviewed_by);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM cloud_ops_events WHERE kind='subscribers-signal' AND status='approved'").get().n, 1);
    const withdraw = await post("reject");
    assert.equal(status(), "rejected", "an approval can be withdrawn before the slot");
    assert.match(await withdraw.text(), /rejected; the paper roll-up goes out as before/);
    await post("approve");
    assert.equal(status(), "rejected", "a rejected issue cannot be approved again");
    assert.equal(f.deliveries.length, 0, "deciding mails nobody");
  }
  {
    // After the slot has passed, nothing can be decided.
    const f = fixture();
    f.insertIssue("2026-01-04", "draft");
    const token = await signalToken(f.env, "2026-01-04");
    const res = await f.call("/review", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ week: "2026-01-04", token, decision: "approve" }).toString() });
    assert.match(await res.text(), /slot has passed/);
    assert.equal(f.db.prepare("SELECT status FROM weekly_signal_issues").get().status, "draft");
  }

  // 7. Sending: an approved issue for today's slot goes to confirmed, non-suppressed subscribers only, once.
  {
    const f = fixture();
    f.add("ok@example.test", "subscribed");
    f.add("pending@example.test", "pending");
    f.add("optedout@example.test", "unsubscribed");
    f.add("blocked@example.test", "subscribed");
    f.db.exec("INSERT INTO email_suppression VALUES('BLOCKED@EXAMPLE.TEST')");
    f.insertIssue(today(), "approved");
    const res = await (await f.digest({})).json();
    assert.equal(res.ok, true);
    assert.equal(res.signal, today());
    assert.equal(res.recipients, 1);
    assert.equal(res.sent, 1);
    assert.deepEqual(f.deliveries.map(m => m.to), ["ok@example.test"], "pending, opted-out and suppressed addresses are never mailed");
    const mail = f.deliveries[0];
    assert.match(mail.subject, /^QNFO weekly signal, /);
    assert.ok(mail.text.includes("Body of the approved text."));
    assert.ok(mail.text.includes("the voice is synthetic and will be labelled"));
    assert.ok(mail.text.includes("Unsubscribe: https://qnfo.org/api/unsubscribe?token=link-ok"));
    assert.ok(mail.headers["List-Unsubscribe"] && mail.headers["List-Unsubscribe-Post"]);
    const row = f.db.prepare("SELECT status, sent_count, sent_at FROM weekly_signal_issues").get();
    assert.equal(row.status, "sent");
    assert.equal(row.sent_count, 1);
    assert.ok(row.sent_at);
    assert.match(f.db.prepare("SELECT notes FROM subscriber_digest_runs").get().notes, /^weekly-signal /);
    // A second run (the cron after a manual run, or a retry) neither resends the issue nor sends the roll-up on top of it.
    const again = await (await f.digest({})).json();
    assert.equal(again.skipped, "signal-already-sent");
    assert.equal(f.deliveries.length, 1);
    // Public archive now lists exactly this issue.
    const index = await (await f.call("/signal")).text();
    assert.ok(index.includes("/signal/" + today()));
    const one = await f.call("/signal/" + today());
    assert.equal(one.status, 200);
    assert.ok((await one.text()).includes("Body of the approved text."));
  }
  {
    // Two runs at once: the 'sending' claim lets one of them mail.
    const f = fixture();
    f.add("ok@example.test", "subscribed");
    f.insertIssue(today(), "approved");
    const [a, b] = await Promise.all([f.digest({}), f.digest({})]);
    const results = [await a.json(), await b.json()];
    assert.equal(f.deliveries.length, 1, "at most one mail per subscriber");
    assert.equal(results.filter(r => r.sent === 1).length, 1);
  }
  {
    // A crash after the claim leaves 'sending': never resent automatically.
    const f = fixture();
    f.add("ok@example.test", "subscribed");
    f.insertIssue(today(), "sending");
    const res = await (await f.digest({})).json();
    assert.equal(res.skipped, "signal-already-sent");
    assert.equal(f.deliveries.length, 0);
  }
  {
    // No confirmed subscriber: the claim is released and nothing is sent.
    const f = fixture();
    f.add("pending@example.test", "pending");
    f.insertIssue(today(), "approved");
    const res = await (await f.digest({})).json();
    assert.equal(res.skipped, "no-subscribers");
    assert.equal(f.db.prepare("SELECT status FROM weekly_signal_issues").get().status, "approved");
    assert.equal(f.deliveries.length, 0);
  }

  // 8. Without an approved issue the roll-up is sent exactly as before.
  for (const status of [null, "draft", "rejected", "expired"]) {
    const f = fixture();
    f.paper("rollup-1", "Roll-up paper", new Date(Date.now() - 864e5).toISOString().slice(0, 19).replace("T", " "), "published", BODY_B, null);
    f.add("ok@example.test", "subscribed");
    if (status) f.insertIssue(today(), status);
    const res = await (await f.digest({})).json();
    assert.equal(res.ok, true, "status " + status);
    assert.equal(res.sent, 1, "status " + status);
    assert.match(f.deliveries[0].subject, /^QNFO research digest — 1 new paper$/, "roll-up subject, status " + status);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM weekly_signal_issues WHERE status='sent'").get().n, 0);
  }
  {
    // An on-demand run with its own window is the roll-up even on a day with an approved issue.
    const f = fixture();
    f.paper("rollup-1", "Roll-up paper", new Date(Date.now() - 864e5).toISOString().slice(0, 19).replace("T", " "), "published", BODY_B, null);
    f.add("ok@example.test", "subscribed");
    f.insertIssue(today(), "approved");
    const res = await (await f.digest({ windowDays: 3 })).json();
    assert.equal(res.sent, 1);
    assert.match(f.deliveries[0].subject, /^QNFO research digest/);
    assert.equal(f.db.prepare("SELECT status FROM weekly_signal_issues").get().status, "approved");
  }
  {
    // The store of the issues missing altogether: the roll-up still goes out.
    const f = fixture();
    f.paper("rollup-1", "Roll-up paper", new Date(Date.now() - 864e5).toISOString().slice(0, 19).replace("T", " "), "published", BODY_B, null);
    f.add("ok@example.test", "subscribed");
    f.db.exec("DROP TABLE weekly_signal_issues");
    const res = await (await f.digest({})).json();
    assert.equal(res.sent, 1);
    const tick = await signalTick(f.env, NOW, {});
    assert.equal(tick.ok, false);
    assert.match(tick.error, /weekly_signal_issues unreadable/);
    const index = await f.call("/signal");
    assert.equal(index.status, 200, "the archive page degrades to a 200 shell");
    assert.ok((await index.text()).includes("cannot be read right now"));
  }

  // 9. Draft, expiry, mail failures, a missing review key.
  {
    const f = fixture();
    const none = await signalTick(f.env, NOW, {});
    assert.equal(none.skipped, "no-candidates");
    assert.equal(countRows(f.db, "weekly_signal_issues"), 0, "nothing qualifies: nothing is stored");
    seedPapers(f);
    f.db.prepare("UPDATE papers SET status='quarantined' WHERE slug NOT IN ('paper-err')").run();
    assert.equal((await signalTick(f.env, NOW, {})).skipped, "all-candidates-have-open-errata");
  }
  {
    const f = fixture(); seedPapers(f);
    f.insertIssue("2026-11-01", "draft");
    f.insertIssue("2026-10-25", "approved");
    f.insertIssue("2026-10-18", "rejected");
    await signalTick(f.env, NOW, {});
    const rows = Object.fromEntries(f.db.prepare("SELECT send_date, status, notes FROM weekly_signal_issues").all().map(r => [r.send_date, r]));
    assert.equal(rows["2026-11-01"].status, "expired");
    assert.equal(rows["2026-11-01"].notes, "not sent: the slot passed while the issue was draft");
    assert.equal(rows["2026-10-25"].status, "expired");
    assert.equal(rows["2026-10-18"].status, "rejected", "a decision is never overwritten");
    assert.equal(rows[SEND_DATE].status, "draft");
  }
  {
    const f = fixture(); seedPapers(f);
    delete f.env.SUBSCRIBERS_TOKEN;
    const r = await signalTick(f.env, NOW, {});
    assert.equal(r.owner_mail, "no-review-key");
    assert.equal(f.deliveries.length, 0);
    assert.equal(f.db.prepare("SELECT status, mail_attempts FROM weekly_signal_issues").get().mail_attempts, 0);
    assert.equal((await f.call("/review?week=2026-11-08&token=" + "a".repeat(40))).status, 403, "without a key nothing validates");
    assert.equal((await f.call("/run/signal/draft", { method: "POST" })).status, 401);
  }
  {
    const f = fixture(); seedPapers(f);
    f.env.SEND_EMAIL = { async send() { throw new Error("mailbox unavailable"); } };
    for (let i = 0; i < 5; i++) await signalTick(f.env, NOW + i * 36e5, {});
    const row = f.db.prepare("SELECT mail_attempts, owner_mailed_at FROM weekly_signal_issues").get();
    assert.equal(row.mail_attempts, 3, "three attempts at most");
    assert.equal(row.owner_mailed_at, null);
  }
  {
    // The authenticated draft route drafts without waiting for the window and can skip the mail.
    const f = fixture(); seedPapers(f);
    const early = Date.parse("2026-11-02T10:00:00Z");
    assert.equal((await signalTick(f.env, early, {})).skipped, "outside-window");
    const res = await (await f.call("/run/signal/draft", { method: "POST", headers: { Authorization: "Bearer " + TOKEN }, body: JSON.stringify({ force: true, noMail: true }) })).json();
    assert.equal(res.ok, true);
    assert.equal(countRows(f.db, "weekly_signal_issues"), 1);
    assert.equal(f.deliveries.length, 0);
  }

  // 10. The public archive shows sent issues only and escapes what it prints; health names the capability.
  {
    const f = fixture();
    f.insertIssue("2026-11-01", "sent", { subject: "Sent <b>issue</b>", body: "QNFO weekly signal\n\nIntro paragraph.\n\nOpen <script>alert(1)</script> https://qnfo.org/papers/x?utm_source=digest&utm_campaign=x" });
    f.insertIssue("2026-11-08", "draft", { subject: "Secret draft subject" });
    f.insertIssue("2026-11-15", "approved", { subject: "Approved but unsent subject" });
    const index = await f.call("/signal");
    assert.equal(index.status, 200);
    const html = await index.text();
    assert.ok(html.includes("<title>QNFO weekly signal</title>"));
    assert.ok(html.includes('rel="canonical"') && html.includes('property="og:title"') && html.includes('name="twitter:card"'));
    assert.ok(!html.includes('content="noindex'), "the archive is indexable");
    assert.ok(html.includes("/signal/2026-11-01"));
    assert.ok(!html.includes("Secret draft subject") && !html.includes("Approved but unsent"), "only sent issues are public");
    assert.ok(html.includes("Sent &lt;b&gt;issue&lt;/b&gt;"));
    const sent = await f.call("/signal/2026-11-01");
    assert.equal(sent.status, 200);
    const sentHtml = await sent.text();
    assert.ok(!sentHtml.includes("<script>alert(1)"), "issue text is escaped");
    assert.ok(sentHtml.includes("&lt;script&gt;"));
    assert.ok(sentHtml.includes('<a href="https://qnfo.org/papers/x?utm_source=digest&amp;utm_campaign=x"'));
    assert.equal((await f.call("/signal/2026-11-08")).status, 404, "a draft has no public page");
    assert.equal((await f.call("/signal/2026-11-15")).status, 404);
    assert.equal((await f.call("/signal/not-a-date")).status, 404);
    const health = await (await f.call("/health")).json();
    assert.ok(health.capabilities.includes("weekly-signal"));
    assert.deepEqual(health.weekly_signal_latest, { send_date: "2026-11-15", status: "approved" });
    assert.ok(!JSON.stringify(health).includes("Secret draft"));
  }
  {
    const f = fixture();
    const index = await f.call("/signal");
    assert.ok((await index.text()).includes("No issue has been sent yet."));
    assert.deepEqual((await (await f.call("/health")).json()).weekly_signal_latest, { send_date: null, status: "none" });
  }

  assert.equal(networkCalls, 0);
  console.log("PASS weekly signal: slot arithmetic, quoted check/limits extraction, rule-based draft, one owner mail, GET-safe review link, approve/reject, subscribers-only send once, roll-up fallback, expiry, archive");
} finally {
  globalThis.fetch = originalFetch;
}
