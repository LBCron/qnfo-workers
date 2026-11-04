// q08-mind — mind.q08.org  (2.2.1)
// A reading list for the inside. Primary sources, one question each, and a probe.
//
// MIND-DOI-FIX-1 (2.2.1, 2026-10-26, pillar personal; patch: data only). Two source links pointed at the wrong or a missing
// record, found by a Crossref lookup (issues 100467, 100468; their twins 1000150, 1000151, filed again when the code loop's
// raw read of the old mind/ path returned 404). doris-situationism linked a DOI with no Crossref record; it now links the
// monograph 10.1017/cbo9781139878364 ("Lack of Character", John M. Doris). neff-compassion linked the Brown and Ryan DOI
// (mindfulness); the entry cites Neff's scale paper, 10.1080/15298860309027 (Self and Identity 2(3), 223-250).
// q08-mind/entries-doi.test.mjs pins both against the Crossref title and author, so a link cannot drift from its citation.
//
// MIND-BOOKS-1 (2.2.0, 2026-10-26, pillar personal; minor: new pages and a new data product). The owner asked (2026-10-21) for
// "another subdomain of Q08 that really helps me understand myself better ... I'm not really into New Age or guru type shit ...
// figure out what I can read that will help me understand myself and my own perceived condition and place in life". The 2.1.0
// corpus answered with papers and scale validations: right as evidence, wrong as reading. 2.2.0 puts a reading list first
// (data/books.json: books, memoir and essays under his three questions, each with why, an honest caveat and a lane), keeps the
// papers as "the evidence underneath", and adds /now, today's pick in a lane. The companion at me.q08.org links to
// /now?lane=gentle|steady|deep chosen from his own mood record; only the lane name arrives here, nothing is stored, and the
// pick is a pure function of the date and the lane, so this worker stays binding-free.
// Binding-free by design: no D1/KV/R2/AI/service bindings, no outbound fetches,
// no client-side JavaScript. The corpus is data (data/entries-*.json), so a wrong
// entry is fixed by editing JSON, never by editing rendering code.
//
// MIND-Q08-3 (2026-10-21): every entry carries an evidence grade and, where one
// exists, a real effect size. The evidence shelf exists so the reader can
// calibrate the rest of the corpus. Instruments are labelled as instruments.

import A from "./data/entries-a.json";
import B from "./data/entries-b.json";
import BOOKS from "./data/books.json";

var VERSION = "2.2.2";
const BUILT = "2026-10-26";
const ENTRIES = [...A, ...B];
const BY_SLUG = new Map(ENTRIES.map((e) => [e.s, e]));
const CAPABILITIES = ["reading-list", "evidence-graded-corpus", "shelves", "entry-pages", "json-api", "rss-feed", "sitemap", "book-list", "daily-pick"];
const BOOK_BY_SLUG = new Map(BOOKS.map((b) => [b.s, b]));
const QUESTIONS = [
  { id: "mind", label: "How my mind works", blurb: "What a brain is doing when you feel, think and remember, and why looking inward gives unreliable answers." },
  { id: "condition", label: "What I'm going through", blurb: "Low mood and anxiety from the inside, by people who lived it, and the few self-help books that were actually tested." },
  { id: "place", label: "Where I fit", blurb: "Time, meaning and how to live, from philosophers who were honest about doubt." },
];
const LANES = {
  gentle: ["Gentle", "Short, warm and practical. Fine for a heavy day."],
  steady: ["Steady", "Real substance at a normal pace. Some deal frankly with hard experiences."],
  deep: ["Deep", "Longer or harder going. For a week with some room in it."],
};
const LEN = { short: "short read", medium: "a few weeks of evenings", long: "long; dip in" };
const DAY_MS = 864e5;
// The pick is a pure function of the day and the lane: the question rotates by day, and within it the lane's books take turns.
function pickFor(lane, atMs) {
  const l = LANES[lane] ? lane : "steady";
  const day = Math.floor((atMs + 36e5) / DAY_MS); // Amsterdam is UTC+1 or +2; a fixed +1 h keeps the flip near midnight
  const pool = BOOKS.filter((b) => b.lane === l);
  const q = QUESTIONS[day % QUESTIONS.length].id;
  const inQ = pool.filter((b) => b.q === q);
  const list = inQ.length ? inQ : pool;
  return { lane: l, book: list[Math.floor(day / QUESTIONS.length) % list.length] };
}
const LIMITATIONS = ["static, read-only content with no accounts or tracking", "no model inference, data bindings, or outbound requests"];

const SHELVES = [
  { id: "attention", label: "Attention", blurb: "What you notice, and what noticing costs." },
  { id: "self", label: "Self", blurb: "Whether the thing doing the reporting can be trusted." },
  { id: "affect", label: "Feeling", blurb: "How emotion is built, labelled and forecast." },
  { id: "will", label: "Will", blurb: "Intention, situation, and what breaks the link." },
  { id: "meaning", label: "Meaning", blurb: "Worth, purpose, and the difference between them." },
  { id: "practice", label: "Practice", blurb: "Things that can be done, with their real sizes." },
  { id: "evidence", label: "Evidence", blurb: "Claims that did not survive, kept on purpose." },
  { id: "measure", label: "Measure", blurb: "Instruments, and what each one cannot see." },
];

const GRADES = {
  A: ["Replicated at scale", "A meta-analysis or multi-lab replication with a stable effect. Safe to reason from; the size still varies."],
  B: ["Replicated, size uncertain", "Independent studies agree on direction; the magnitude moves between samples."],
  C: ["Contested or single study", "One study, a live controversy, or a disputed factor structure. Treat as a hypothesis."],
  D: ["Failed replication", "The reported effect did not hold at scale, or is not distinguishable from zero."],
  P: ["Argument, not measurement", "A philosophical or primary text. It can be right and still be untested."],
};

// MIND-BOOKS-1: two of the five slugs named entries that never existed, so the start page showed three.
const START = ["killingsworth-gilbert", "nisbett-wilson", "vazire-soka", "gollwitzer-implementation-intentions", "osc-2015"];

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const paragraphs = (s) => String(s || "").split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("");

function badge(g) {
  const m = GRADES[g] || ["ungraded", "No grade recorded."];
  return `<span class="badge g-${esc(g)}" title="${esc(m[1])}">${esc(g)} · ${esc(m[0])}</span>`;
}

function page(title, body, extraHead = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="A reading list for the inside: primary sources on attention, self-knowledge, feeling and will, each with an evidence grade and a probe.">
<link rel="alternate" type="application/rss+xml" title="mind" href="/feed.xml">
${extraHead}<style>
:root{--bg:#fbfaf7;--fg:#1c1b19;--mut:#6b6660;--line:#e2ddd4;--acc:#7a4b2a}
@media(prefers-color-scheme:dark){:root{--bg:#161513;--fg:#eae6df;--mut:#a19a91;--line:#2e2b27;--acc:#d0a179}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.62 ui-serif,Georgia,"Times New Roman",serif;padding:2.4rem 1.2rem 5rem}
main{max-width:34rem;margin:0 auto}
a{color:var(--acc);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--acc) 35%,transparent)}
a:hover{border-bottom-color:var(--acc)}
h1{font-size:1.5rem;line-height:1.25;margin:0 0 .4rem;font-weight:600}
h2{font-size:1.02rem;margin:2.2rem 0 .5rem;font-weight:600;letter-spacing:.01em}
p{margin:0 0 .85rem}
.sub{color:var(--mut);font-size:.9rem;margin-bottom:2rem}
nav{font-size:.85rem;color:var(--mut);margin-bottom:2rem;display:flex;flex-wrap:wrap;gap:.4rem .9rem}
ul.plain{list-style:none;padding:0;margin:0}
ul.plain li{padding:.62rem 0;border-bottom:1px solid var(--line)}
ul.plain li:last-child{border-bottom:0}
.q{font-weight:600}
.meta{color:var(--mut);font-size:.82rem;margin-top:.15rem}
.badge{display:inline-block;font:600 .68rem/1.5 ui-sans-serif,system-ui,sans-serif;letter-spacing:.03em;padding:.05rem .38rem;border:1px solid var(--line);border-radius:3px;color:var(--mut);vertical-align:middle;white-space:nowrap}
.g-A{color:#2f6b3a;border-color:#2f6b3a55}.g-B{color:#3a5d7a;border-color:#3a5d7a55}
.g-C{color:#8a5a12;border-color:#8a5a1255}.g-D{color:#8f2f2f;border-color:#8f2f2f55}.g-P{color:var(--mut)}
.book{padding:.9rem 0;border-bottom:1px solid var(--line)}.book:last-child{border-bottom:0}
.lane{display:inline-block;font:600 .68rem/1.5 ui-sans-serif,system-ui,sans-serif;letter-spacing:.03em;padding:.05rem .38rem;border:1px solid var(--line);border-radius:3px;color:var(--mut)}
.note{color:var(--mut);font-size:.9rem}
.pick{border:1px solid var(--line);border-radius:6px;padding:1rem 1.1rem;margin:1.2rem 0 2rem}
.pick h2{margin-top:0}
.probe{border-left:2px solid var(--acc);padding:.1rem 0 .1rem .9rem;margin:1.2rem 0;color:var(--fg)}
.probe b{display:block;font:600 .72rem/1.6 ui-sans-serif,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin-bottom:.25rem}
footer{margin-top:3.4rem;padding-top:1rem;border-top:1px solid var(--line);color:var(--mut);font-size:.8rem}
code{font:.85em ui-monospace,SFMono-Regular,Menlo,monospace;background:color-mix(in srgb,var(--fg) 7%,transparent);padding:.05rem .25rem;border-radius:3px}
</style></head><body><main>${body}
<footer>mind · <a href="/">reading list</a> · <a href="/now">today</a> · <a href="/how">how it chooses</a> · <a href="/evidence">the evidence underneath</a> · <a href="/method">method</a> · <a href="/outside">outside view</a> · <a href="/record">record</a> · <a href="/api/entries.json">api</a> · <a href="/feed.xml">rss</a><br>No tracking and no accounts. Nothing about you is stored here. ${esc(VERSION)}</footer>
</main></body></html>`;
}

function entryList(list) {
  return `<ul class="plain">${list.map((e) => `<li><a class="q" href="/q/${esc(e.s)}">${esc(e.q)}</a>
<div class="meta">${esc(e.a)}${e.y ? ` · ${esc(e.y)}` : ""} · ${badge(e.e)}</div></li>`).join("")}</ul>`;
}

function bookLine(b, full) {
  const rel = b.x && BY_SLUG.get(b.x);
  return `<div class="book"><a class="q" href="/b/${esc(b.s)}">${esc(b.t)}</a>
<div class="meta">${esc(b.a)} · ${esc(b.y)} · ${esc(b.k)} · ${esc(LEN[b.len] || b.len)} · <span class="lane">${esc((LANES[b.lane] || [b.lane])[0])}</span></div>
${full ? `<p style="margin-top:.5rem">${esc(b.w)}</p><p class="note"><b>Worth knowing:</b> ${esc(b.h)}</p>${b.r ? `<p class="note"><b>How to start:</b> ${esc(b.r)}</p>` : ""}<p class="note"><a href="${esc(b.l)}" rel="noopener">Find a copy</a>${b.pd ? ` · <a href="${esc(b.pd)}" rel="noopener">free online (public domain)</a>` : ""}${rel ? ` · the research behind it: <a href="/q/${esc(rel.s)}">${esc(rel.q)}</a>` : ""}</p>` : ""}</div>`;
}

function pickBox(lane, atMs, heading) {
  const { lane: l, book } = pickFor(lane, atMs);
  if (!book) return "";
  return `<div class="pick"><h2>${esc(heading)}</h2>${bookLine(book, true)}
<p class="meta">Lane: ${esc(LANES[l][0])}. ${esc(LANES[l][1])} Other lanes today: ${Object.keys(LANES).filter((k) => k !== l).map((k) => `<a href="/now?lane=${k}">${esc(LANES[k][0].toLowerCase())}</a>`).join(", ")}.</p></div>`;
}

function home(atMs) {
  const body = `<h1>Reading to understand yourself</h1>
<p class="sub">Books, memoirs and essays about how your mind works, what you might be going through, and where you fit. Chosen from psychology, neuroscience, philosophy and honest first-person writing. No gurus, no personality types, no promises. Each one says plainly what it is good for and what to be careful about.</p>
${pickBox("gentle", atMs, "Today's pick")}
${QUESTIONS.map((q) => `<h2 id="${q.id}">${esc(q.label)}</h2><p class="note">${esc(q.blurb)}</p>${BOOKS.filter((b) => b.q === q.id).map((b) => bookLine(b, false)).join("")}`).join("")}
<h2>How to use this</h2>
<p>Read one thing at a time, slowly, and stop whenever a book is making you feel worse rather than clearer. Notice what you recognise and what you don't; both tell you something. If a passage makes you think of something you log in your companion, write a line about it there. If something comes up that you want to talk through, a book is a good thing to bring to your huisarts or a therapist.</p>
<p class="note"><a href="/how">How the pick is chosen</a> · <a href="/evidence">The evidence underneath</a>: the papers and measurements these books rest on, each graded by how well it has held up.</p>
<p class="note">If reading pulls you somewhere dark: in the Netherlands, 113 Zelfmoordpreventie answers on 113 or 0800-0113, day and night, and chats at 113.nl. In an emergency, call 112.</p>`;
  return page("Reading to understand yourself — mind", body);
}

function nowPage(lane, atMs) {
  const l = LANES[lane] ? lane : "steady";
  const body = `<h1>Something to read today</h1>
<p class="sub">${esc(l === "gentle" ? "Something short and kind. Stop whenever you like." : l === "deep" ? "One that asks a little more of you." : "Today's pick from the reading list.")}</p>
${pickBox(l, atMs, "Today")}
<p class="note"><a href="/">The whole list</a> · <a href="/how">How this is chosen</a></p>`;
  return page("Today — mind", body);
}

function bookPage(slug, atMs) {
  const b = BOOK_BY_SLUG.get(slug);
  if (!b) return null;
  const q = QUESTIONS.find((x) => x.id === b.q);
  const same = BOOKS.filter((x) => x.q === b.q && x.s !== b.s && x.lane === b.lane).slice(0, 3);
  const body = `<h1>${esc(b.t)}</h1>
<p class="sub">${esc(b.a)} · ${esc(b.y)}</p>
${bookLine(b, true).replace(/^<div class="book"><a class="q"[^>]*>[^<]*<\/a>/, '<div class="book">')}
<p class="meta">Part of: <a href="/#${esc(b.q)}">${esc(q ? q.label : b.q)}</a></p>
${same.length ? `<h2>Next, in the same spirit</h2>${same.map((x) => bookLine(x, false)).join("")}` : ""}`;
  return page(`${b.t} — mind`, body);
}

function howPage() {
  const body = `<h1>How it chooses</h1>
<p class="sub">Plainly, so you can trust it or ignore it.</p>
<h2>What is on the list</h2>
<p>Books, memoirs and essays that are well regarded by people who study the mind or who write honestly about their own. Every entry says what it is good for and what to watch out for: a finding that did not replicate, a theory that is still argued about, a memoir that describes something hard. Self-help is included only where it was tested, or where it is honest about being opinion.</p>
<h2>Three questions</h2>
<p>${QUESTIONS.map((q) => `<b>${esc(q.label)}</b>: ${esc(q.blurb)}`).join("<br>")}</p>
<h2>Three lanes</h2>
<p>${Object.values(LANES).map((v) => `<b>${esc(v[0])}</b>: ${esc(v[1])}`).join("<br>")}</p>
<h2>Today's pick</h2>
<p>Each day the pick moves to the next question, and within it to the next book in the lane, so over a few weeks you see the whole list without repeats. When you open it from your companion at me.q08.org, the companion chooses the lane from how you have been: gentle after a heavy day or two, deep after a steadier week, steady otherwise. Only the lane name travels in the link. Nothing about you is sent to this site or kept here.</p>
<h2>What this is not</h2>
<p>Not therapy and not diagnosis. A book can help you name and understand what is going on; it cannot replace a person who knows you. If things are hard, the guide at me.q08.org/guide lists who to call.</p>`;
  return page("How it chooses — mind", body);
}

function evidenceHome() {
  const body = `<h1>The evidence underneath</h1>
<p class="sub">Primary sources on how attention, self-knowledge, feeling and will actually work. One question each, an evidence grade, and a probe you can run on yourself. Not therapy, not diagnosis, not a personality test.</p>
<p><a href="/start">Start with five</a> · <a href="/method">How the grades work</a></p>
<h2>The shelves</h2>
<ul class="plain">${SHELVES.map((s) => {
    const n = ENTRIES.filter((e) => e.sh === s.id).length;
    return `<li><a class="q" href="/s/${s.id}">${esc(s.label)}</a> <span class="meta">(${n})</span><div class="meta">${esc(s.blurb)}</div></li>`;
  }).join("")}</ul>
<h2>Why this shape</h2>
<p>Most writing about the mind is a claim with no size attached. Here every entry says what kind of evidence stands behind it, and the <a href="/s/evidence">evidence shelf</a> keeps five claims that did not survive replication, because knowing the failure rate is part of knowing yourself.</p>`;
  return page("The evidence underneath — mind", body);
}

function startPage() {
  const list = START.map((s) => BY_SLUG.get(s)).filter(Boolean);
  const body = `<h1>Five entries</h1>
<p class="sub">The shortest route in: the two entries that set the frame, the one that says why an outside view is needed, the one with the largest usable effect, and the base rate.</p>
${entryList(list)}
<p style="margin-top:1.6rem"><a href="/random">Or open a random entry</a></p>`;
  return page("Start — mind", body);
}

function methodPage() {
  const body = `<h1>Method</h1>
<p class="sub">What the grades mean, what the entries are, and what this is not.</p>
<h2>Evidence grades</h2>
<ul class="plain">${Object.entries(GRADES).map(([g, m]) => `<li>${badge(g)}<div class="meta" style="margin-top:.3rem">${esc(m[1])}</div></li>`).join("")}</ul>
<h2>Rules the corpus follows</h2>
<p>1. Every empirical entry names a primary source with a DOI or a publisher link. No secondary summaries.</p>
<p>2. Where a pooled estimate exists it is stated as a number: r, d, or a percentage. Direction without size is not a finding.</p>
<p>3. Claims that failed replication are kept, on their own shelf, at the same length as the claims that held. Removing them would flatter the rest.</p>
<p>4. No entry tells you who you are. Each one describes a mechanism and hands back a probe: a measurement you run, on yourself, that can come out either way.</p>
<p>5. Barnum statements are excluded by rule. If a sentence would be true of almost anyone, it is not in the corpus.</p>
<h2>What this is not</h2>
<p>Not diagnosis. Not treatment. Not a substitute for a clinician. No instrument here is scored for you, and none of them is a screening test. Self-report is a measurement with known error: it is retrospective, reconstructive, and sensitive to mood at the moment of answering. That is why the <a href="/outside">outside view</a> and the <a href="/record">record</a> exist.</p>
<h2>Reading a claim</h2>
<p>Ask three things in order: what was measured, in whom, and did anyone repeat it. A study of 40 undergraduates that measured a self-report of a feeling is a different object from a multi-lab replication that measured behaviour. Most popular claims about the mind fail the second or third question.</p>`;
  return page("Method — mind", body);
}

function outsidePage() {
  const body = `<h1>The outside view</h1>
<p class="sub">Self-report has a blind spot with a known shape, and another person can see it.</p>
<p>The self–other knowledge asymmetry finding is that you are the better judge of your internal states, and other people are the better judges of your observable and evaluative traits. Neither of you is the better judge of everything. So for questions about how you come across, an informant is a better instrument than your own memory.</p>
<h2>A protocol</h2>
<p>Send this to two people who have seen you work or live closely for more than a year. Ask them to answer in writing, not in conversation, and to give one concrete example per answer. Tell them not to soften it; the softening is the measurement error.</p>
<div class="probe"><b>Ask them</b>
1. What do I do when I am under pressure that I do not seem to notice?<br>
2. What do I say I want, and what do my choices suggest I want?<br>
3. Where am I least accurate about myself?<br>
4. What do I do that I would deny doing?<br>
5. What have I changed in the last two years that I have not acknowledged?</div>
<p>Then answer the same five about yourself, before reading theirs. The gap between the two sets is the data. Do not argue with it; write down where it is largest and check it against your <a href="/record">record</a> for the same month.</p>
<p>Two cautions. Informants have their own biases, including politeness and the version of you they need. And a single informant is a single study; two who disagree with each other are more informative than two who agree.</p>`;
  return page("Outside view — mind", body);
}

function recordPage() {
  const body = `<h1>The record</h1>
<p class="sub">Retrospective self-report is reconstruction. A contemporaneous record is measurement.</p>
<p>When you are asked how you felt last week, you do not retrieve the week; you build a summary from what is salient now, from your beliefs about yourself, and from the last thing that happened. This is why a diary written at the end of the month and a sample taken three times a day disagree, and why the sample is the better evidence.</p>
<h2>A protocol that costs four minutes a day</h2>
<p>Three times a day, at fixed times, write one line each for five fields. Fixed times matter: choosing when to record selects for the moments you notice, which is the bias you are trying to escape.</p>
<div class="probe"><b>Each sample</b>
1. Where I am, and what I am doing.<br>
2. Attention: on the task, on myself, or elsewhere.<br>
3. Feeling: two words, specific (not good or bad).<br>
4. What I want right now.<br>
5. One sentence I said or thought that I would not say aloud.</div>
<p>After two weeks, count rather than interpret: how many samples had attention elsewhere; which two feeling words recur; how often field 4 was about something other than the task in field 1. Counts survive; impressions do not.</p>
<h2>Why counts</h2>
<p>The mind-wandering literature works this way. Asking people how much they mind-wander produces a number that tracks their beliefs about themselves; sampling them during the day produces a different and more defensible number. Your own record should be built the second way.</p>
<p>Keep it out of this site. It is a sheet of paper or a local file: there is no data plane here, nothing is stored, and nothing is sent.</p>`;
  return page("The record — mind", body);
}

function shelfPage(id) {
  const s = SHELVES.find((x) => x.id === id);
  if (!s) return null;
  const list = ENTRIES.filter((e) => e.sh === id);
  const body = `<h1>${esc(s.label)}</h1><p class="sub">${esc(s.blurb)}</p>${entryList(list)}`;
  return page(`${s.label} — mind`, body);
}

function entryPage(slug) {
  const e = BY_SLUG.get(slug);
  if (!e) return null;
  const next = e.n ? BY_SLUG.get(e.n) : null;
  const shelf = SHELVES.find((s) => s.id === e.sh);
  const src = e.l ? `<p class="meta">Source: <a href="${esc(e.l)}" rel="noopener">${esc(e.a)}${e.w ? `, ${esc(e.w)}` : ""}${e.y ? ` (${esc(e.y)})` : ""}</a></p>` : "";
  const body = `<h1>${esc(e.q)}</h1>
<p class="sub">${esc(e.a)}${e.w ? ` · ${esc(e.w)}` : ""}${e.y ? ` · ${esc(e.y)}` : ""}</p>
<p>${badge(e.e)}</p>
${paragraphs(e.g)}
<div class="probe"><b>Probe</b>${esc(e.p)}</div>
${src}
<p class="meta">Shelf: <a href="/s/${esc(e.sh)}">${esc(shelf ? shelf.label : e.sh)}</a></p>
${next ? `<h2>Next</h2><p><a href="/q/${esc(next.s)}">${esc(next.q)}</a></p>` : `<h2>End of the chain</h2><p><a href="/random">Open another</a> · <a href="/start">Back to five</a></p>`}`;
  return page(`${e.q} — mind`, body);
}

function apiJson() {
  return JSON.stringify({
    worker: "q08-mind",
    version: VERSION,
    built: BUILT,
    count: ENTRIES.length,
    shelves: SHELVES.map((s) => ({ id: s.id, label: s.label, count: ENTRIES.filter((e) => e.sh === s.id).length })),
    grades: Object.fromEntries(Object.entries(GRADES).map(([g, m]) => [g, { label: m[0], note: m[1] }])),
    entries: ENTRIES,
    questions: QUESTIONS,
    lanes: Object.fromEntries(Object.entries(LANES).map(([k, v]) => [k, { label: v[0], note: v[1] }])),
    books: BOOKS,
  }, null, 1);
}

function feed() {
  const items = ENTRIES.slice(0, 30).map((e) => `<item><title>${esc(e.q)}</title><link>https://mind.q08.org/q/${esc(e.s)}</link><guid>https://mind.q08.org/q/${esc(e.s)}</guid><description>${esc(e.g)} (${esc(e.e)})</description></item>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>mind — a reading list for the inside</title><link>https://mind.q08.org/</link><description>Primary sources on attention, self-knowledge, feeling and will, with evidence grades.</description><language>en</language>${items}</channel></rss>`;
}

function sitemap() {
  const urls = ["/", "/how", "/evidence", ...BOOKS.map((b) => `/b/${b.s}`), "/start", "/method", "/outside", "/record", ...SHELVES.map((s) => `/s/${s.id}`), ...ENTRIES.map((e) => `/q/${e.s}`)];
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>https://mind.q08.org${u}</loc><lastmod>${BUILT}</lastmod></url>`).join("")}</urlset>`;
}

const html = (body, status = 200, cache = "public, max-age=300") =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache, "referrer-policy": "no-referrer" } });
const text = (body, type, status = 200) =>
  new Response(body, { status, headers: { "content-type": type, "cache-control": "public, max-age=300" } });

var __wm_default = {
  async fetch(request) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";

    if (p === "/health") return text(JSON.stringify({ ok: true, worker: "q08-mind", version: VERSION, capabilities: CAPABILITIES, limitations: LIMITATIONS, entries: ENTRIES.length, books: BOOKS.length, shelves: SHELVES.length, built: BUILT }), "application/json; charset=utf-8");
    if (p === "/api/entries.json") return text(apiJson(), "application/json; charset=utf-8");
    if (p === "/feed.xml") return text(feed(), "application/rss+xml; charset=utf-8");
    if (p === "/sitemap.xml") return text(sitemap(), "application/xml; charset=utf-8");
    if (p === "/robots.txt") return text("User-agent: *\nAllow: /\nSitemap: https://mind.q08.org/sitemap.xml\n", "text/plain; charset=utf-8");

    if (p === "/") return html(home(Date.now()), 200, "public, max-age=600");
    if (p === "/now") return html(nowPage(url.searchParams.get("lane") || "gentle", Date.now()), 200, "private, no-store");
    if (p === "/how") return html(howPage());
    if (p === "/evidence") return html(evidenceHome());
    if (p.startsWith("/b/")) {
      const out = bookPage(decodeURIComponent(p.slice(3)), Date.now());
      return out ? html(out) : notFound();
    }
    if (p === "/start") return html(startPage());
    if (p === "/method") return html(methodPage());
    if (p === "/outside") return html(outsidePage());
    if (p === "/record") return html(recordPage());
    if (p === "/random") {
      const e = ENTRIES[Math.floor(Math.random() * ENTRIES.length)];
      return new Response(null, { status: 302, headers: { location: `/q/${e.s}`, "cache-control": "no-store" } });
    }
    if (p.startsWith("/s/")) {
      const out = shelfPage(decodeURIComponent(p.slice(3)));
      return out ? html(out) : notFound();
    }
    if (p.startsWith("/q/")) {
      const out = entryPage(decodeURIComponent(p.slice(3)));
      return out ? html(out) : notFound();
    }
    return notFound();
  },
};

function notFound() {
  return html(page("Not found — mind", `<h1>Not found</h1><p>That page does not exist.</p><p><a href="/">The reading list</a> · <a href="/evidence">The evidence underneath</a></p>`), 404);
}
export default __wm_default;

// ---- WEBMCP-FLEET-1:BEGIN (sourced from _shared/webmcp.js; applied by scripts/webmcp-apply.mjs; do not edit inside a worker) ----
// WEBMCP-FLEET-1 (2026-10-25, pillar reach, owner directive "implement WebMCP systemwide across the fleet").
//
// WHAT. WebMCP (https://blog.cloudflare.com/webmcp/, August 2026) is a browser standard, shipping experimentally in
// Chrome 146, that appears in the page as document.modelContext: a site registers MCP tools with registerTool() so an
// agent visiting the page can call the site's own operations instead of guessing its way through a page built for
// humans. Cloudflare's developer preview offers a zone toggle that injects a bridge and two packs (c2pa, and a proxy
// to the site's own MCP server). That toggle is Dashboard-only and this fleet's token may not write zone Snippets
// (probed 2026-10-25: HTTP 403 "snippets are not allowed", and GET /user/tokens 403 so no wider token can be minted),
// so the fleet carries its own implementation, which is also the only version that can expose QNFO's real operations.
//
// HOW. Three pieces, all same-origin, all served by the worker that already answers the page:
//   1. GET /.webmcp/bridge.js   the browser-side module: finds document.modelContext, reads the manifest, registers
//                               every tool, and returns without registering anything when the browser has no WebMCP.
//   2. GET /.webmcp/packs.json  the machine-readable manifest (also readable by a non-browser agent).
//   3. an HTMLRewriter step on 200 HTML responses appending one <script type="module" src="/.webmcp/bridge.js">.
//
// WHY same-origin only. The bridge runs in the visitor's page with the visitor's session. A tool that reached another
// origin would hand this origin's tools to a page we do not own, and a proxy that took a caller-supplied absolute URL
// would be an SSRF surface on every page of every host. Every request template below is a path, resolved against the
// page's own origin, and read_page refuses anything that is not a path on this origin.
//
// WHY this is not a false capability claim (DECLARED-NOT-WORKING-1). The manifest is generated from the same table the
// bridge registers from, and every endpoint in it was answered 200 by a live probe on 2026-10-25 before shipping. The
// bridge reports what actually happened in window.__webmcp: supported=false when the browser has no modelContext, and
// registered=<n> only after registerTool() returned. Measured 2026-10-25 before this shipped: ideas /api/proposals
// answered 503 and was REMOVED from the manifest rather than advertised; ideas /api/sessions, q08 /api/metrics and
// POST ask.qwav.tech/api/ask answered 200. scripts/webmcp-verify.mjs re-probes every host and every tool endpoint.
//
// ROLLBACK. Revert the deploy of a worker to its previous version; the block is inert code for a browser without
// modelContext and cannot change a page's rendered output for any other client.
var WM_VERSION = "1.2.0";
var WM_BRIDGE_PATH = "/.webmcp/bridge.js";
var WM_PACKS_PATH = "/.webmcp/packs.json";
var WM_MANIFEST_PATH = "/.webmcp/manifest.json";
// WM_MANIFEST_URL is the path the bridge reads, and it is deliberately OUTSIDE /.webmcp/: Cloudflare's own WebMCP
// preview owns that prefix at the edge when a zone has it switched on (measured 2026-10-25: /.webmcp/bridge.js answer
// 75,756 bytes of the platform bundle and /.webmcp/packs.json answer 404 without ever reaching the worker), so a
// manifest under that prefix is invisible on exactly the zone with the most traffic. /api/webmcp/ is ours end to end.
var WM_MANIFEST_URL = "/api/webmcp/manifest.json";
var WM_MCP_PATH = "/mcp";
var WM_MCP_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"];
var WM_MAX_TEXT = 40000;

// WM_PACK_DEFS: the whole tool surface. `request` is a same-origin template. `{name}` in a path or a query value is
// replaced from the call arguments; an argument that is absent drops its query key rather than sending "undefined".
var WM_PACK_DEFS = {
  site: {
    title: "This site",
    description: "Read the site the visitor is looking at: the page in front of them, any page on this origin, and the sitemap.",
    tools: [
      {
        name: "get_page_context",
        description: "Return the page the visitor is on: its URL, title, description, its section headings and any text the visitor has selected. Call this first to learn where you are.",
        inputSchema: { type: "object", properties: {} },
        local: "page_context"
      },
      {
        name: "read_page",
        description: "Fetch a path on this site and return its text (HTML reduced to readable text, or the raw body for JSON/Markdown/plain). Paths are relative to this origin.",
        inputSchema: { type: "object", properties: { path: { type: "string", description: "A path on this site, e.g. /about" }, max_chars: { type: "number", description: "Truncate the text to this many characters (default 20000)" } }, required: ["path"] },
        request: { method: "GET", path: "{path}" }
      },
      {
        name: "list_site_pages",
        description: "List the URLs published in this site's sitemap.xml.",
        inputSchema: { type: "object", properties: { limit: { type: "number", description: "Maximum URLs to return (default 100)" } } },
        request: { method: "GET", path: "/sitemap.xml", extract: "loc" }
      }
    ]
  },
  papers: {
    title: "QNFO living papers",
    description: "Search, read and question the QNFO research corpus: full texts as Markdown, a JSON metadata API, and a deterministic digest of any paper.",
    tools: [
      {
        name: "search_papers",
        description: "Full-text search over the QNFO papers corpus. Returns matching papers with slug, title, authors and abstract.",
        inputSchema: { type: "object", properties: { q: { type: "string", description: "Search words" }, limit: { type: "number", description: "1-50, default 10" } }, required: ["q"] },
        request: { method: "GET", path: "/api/papers", query: { q: "{q}", limit: "{limit}" } }
      },
      {
        name: "get_paper",
        description: "Metadata for one paper by slug: title, authors, abstract, DOI, version, dates, licence and the URLs of its Markdown and PDF.",
        inputSchema: { type: "object", properties: { slug: { type: "string", description: "Paper slug, e.g. ultrametric-intelligence" } }, required: ["slug"] },
        request: { method: "GET", path: "/api/papers/{slug}" }
      },
      {
        name: "get_paper_markdown",
        description: "The full text of one paper as Markdown. Use this to read or quote a paper.",
        inputSchema: { type: "object", properties: { slug: { type: "string" }, max_chars: { type: "number" } }, required: ["slug"] },
        request: { method: "GET", path: "/papers/{slug}.md", accept: "text/markdown" }
      },
      {
        name: "get_paper_digest",
        description: "A deterministic digest of one paper written from its own sentences: the abstract, the claim, the figures it reports, how it is done, what would falsify it, where the claim stops, and a map of where to read.",
        inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
        request: { method: "GET", path: "/api/quickread/{slug}" }
      }
    ]
  },
  fleet: {
    title: "QNFO fleet",
    description: "The live state of the QNFO Cloudflare fleet: health, spend, what needs attention and what changed.",
    tools: [
      {
        name: "fleet_status",
        description: "Fleet verdict and what the fleet is waiting on a human to do.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/human" }
      },
      {
        name: "fleet_attention",
        description: "Everything the fleet currently flags as needing attention.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/attention" }
      },
      {
        name: "fleet_cost",
        description: "Cost per surface over the current windows.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/cost" }
      },
      {
        name: "fleet_areas",
        description: "The functional areas of the fleet with their state.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/areas" }
      }
    ]
  },
  ideas: {
    title: "QNFO ideas",
    description: "The QNFO idea hub: the open idea threads.",
    tools: [
      {
        name: "list_ideas",
        description: "List the open idea threads in the hub.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/sessions" }
      }
    ]
  },
  signals: {
    title: "q08 signal organism",
    description: "Signals, forecasts and run metrics of the q08 signal organism.",
    tools: [
      {
        name: "list_signals",
        description: "The latest signals emitted by the organism.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/signals" }
      },
      {
        name: "list_forecasts",
        description: "Open and resolved forecasts with their outcomes.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/forecasts" }
      },
      {
        name: "signal_metrics",
        description: "Organism run metrics.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/metrics" }
      }
    ]
  },
  ask: {
    title: "Ask QWAV",
    description: "Ask a question over the QNFO corpus and read recent questions.",
    tools: [
      {
        name: "ask_corpus",
        description: "Ask a research question and get an answer grounded in the QNFO corpus with its sources.",
        inputSchema: { type: "object", properties: { q: { type: "string", description: "The question" } }, required: ["q"] },
        request: { method: "POST", path: "/api/ask", body: { q: "{q}" } }
      },
      {
        name: "recent_questions",
        description: "Recently asked questions and their answers.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/recent" }
      },
      {
        name: "corpus_stats",
        description: "Index statistics for the corpus behind this search.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/stats" }
      }
    ]
  },
  ipatent: {
    title: "iPatent",
    description: "Search the disclosure corpus, read its status, and get invention suggestions.",
    tools: [
      {
        name: "search_disclosures",
        description: "Search the iPatent disclosure corpus.",
        inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
        request: { method: "GET", path: "/api/search", query: { q: "{q}" } }
      },
      {
        name: "ipatent_status",
        description: "Corpus and pipeline status.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/status" }
      }
    ]
  },
  mind: {
    title: "mind.q08.org",
    description: "The inside reading surface: its corpus entries and shelves.",
    tools: [
      {
        name: "list_entries",
        description: "Every entry in the mind corpus with its shelf.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/entries.json" }
      }
    ]
  }
};

// WM_HOST_PACKS: which packs a host advertises. A host absent here gets the site pack only, so a new surface is
// agent-readable the moment it is deployed and never advertises a tool it cannot answer.
var WM_HOST_PACKS = {
  "qnfo.org": ["site", "papers"],
  "www.qnfo.org": ["site", "papers"],
  "papers.qnfo.org": ["site", "papers"],
  "archive.qnfo.org": ["site"],
  "legal.qnfo.org": ["site"],
  "qnfo.org:email": ["site"],
  "fleet.qnfo.org": ["site", "fleet"],
  "ideas.qnfo.org": ["site", "ideas"],
  "q08.org": ["site", "signals"],
  "www.q08.org": ["site", "signals"],
  "ask.qwav.tech": ["site", "ask"],
  "ask.qwav.org": ["site", "ask"],
  "ipatent.qnfo.org": ["site", "ipatent"],
  "ipatent.me": ["site", "ipatent"],
  "www.ipatent.me": ["site", "ipatent"],
  "mind.q08.org": ["site", "mind"]
};

// wmHost accepts a URL or a bare hostname (the manifest and the tests both call it with either) and never throws: an
// unknown shape yields "", which lands on the site pack rather than on a tool nobody verified.
function wmHost(url) {
  try {
    var s = typeof url === "string" ? url : String(url && url.hostname || url || "");
    if (s.indexOf("://") >= 0) {
      try { s = new URL(s).hostname; } catch (e2) { return ""; }
    }
    s = s.split("/")[0].split("?")[0].split("#")[0];
    return s.toLowerCase().replace(/:\d+$/, "");
  } catch (e) {
    return "";
  }
}
function wmPackIds(host) {
  var h = wmHost(host);
  return (WM_HOST_PACKS[h] || ["site"]).filter(function (id) { return !!WM_PACK_DEFS[id]; });
}
function wmPacks(host) {
  var out = [];
  var ids = wmPackIds(host);
  for (var i = 0; i < ids.length; i++) {
    var d = WM_PACK_DEFS[ids[i]];
    var tools = [];
    for (var j = 0; j < d.tools.length; j++) {
      var t = d.tools[j];
      tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema, local: t.local || null, request: t.request || null });
    }
    out.push({ id: ids[i], title: d.title, description: d.description, tools: tools });
  }
  return out;
}
function wmManifest(host, worker) {
  var packs = wmPacks(host);
  var n = 0;
  for (var i = 0; i < packs.length; i++) n += packs[i].tools.length;
  return {
    schema_version: "webmcp/v1",
    implementation: "qnfo-webmcp",
    version: WM_VERSION,
    worker: worker || "",
    host: wmHost(host),
    generated_from: "_shared/webmcp.js",
    bridge: WM_BRIDGE_PATH,
    standard: "https://blog.cloudflare.com/webmcp/",
    surface: { document_modelContext: true, navigator_modelContext_fallback: true, degrades_silently: true },
    pack_ids: wmPackIds(host),
    tool_count: n,
    packs: packs
  };
}

// The browser-side module. Written as lines, not a template literal, so nothing in it can be re-interpreted by the
// worker's own bundler and so a diff of this array is a diff of the shipped script.
function wmBridgeSource() {
  var L = [
    "/* QNFO WebMCP bridge " + WM_VERSION + " - generated from _shared/webmcp.js; do not edit. */",
    "(() => {",
    "  if (window.__webmcp && window.__webmcp.bridge) return;",
    "  const state = window.__webmcp = { bridge: true, version: '" + WM_VERSION + "', supported: false, mode: 'init', packs: [], tools: [], registered: 0, errors: [] };",
    "  const ctx = () => {",
    "    try {",
    "      if (document.modelContext && typeof document.modelContext.registerTool === 'function') return document.modelContext;",
    "      if (navigator.modelContext && typeof navigator.modelContext.registerTool === 'function') return navigator.modelContext;",
    "    } catch (e) { state.errors.push('context:' + e); }",
    "    return null;",
    "  };",
    "  const trunc = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '\\n[... ' + (s.length - n) + ' more characters]' : s; };",
    "  const html2text = (s) => String(s || '')",
    "    .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ').replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')",
    "    .replace(/<\\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, '\\n').replace(/<[^>]+>/g, ' ')",
    "    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '\"').replace(/&#39;/g, \"'\")",
    "    .replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();",
    "  const fill = (tpl, args) => String(tpl || '').replace(/\\{([a-z0-9_]+)\\}/gi, (m, k) => {",
    "    const v = args && args[k];",
    "    return v == null ? '' : String(v);",
    "  });",
    "  const text = (body, isErr) => ({ content: [{ type: 'text', text: body }], isError: !!isErr });",
    "  const pageContext = () => {",
    "    const heads = [];",
    "    document.querySelectorAll('h1,h2,h3').forEach((h) => { if (heads.length < 40) heads.push(h.tagName.toLowerCase() + ': ' + (h.textContent || '').trim().slice(0, 160)); });",
    "    const desc = document.querySelector('meta[name=\"description\"]');",
    "    const sel = String(window.getSelection ? window.getSelection() : '').slice(0, 4000);",
    "    const out = { url: location.href, path: location.pathname, title: document.title, description: desc ? desc.getAttribute('content') : '', lang: document.documentElement.getAttribute('lang') || '', headings: heads, selected_text: sel,",
    "      tools_available: state.tools, packs: state.packs, webmcp_supported: state.supported };",
    "    return text(JSON.stringify(out, null, 1));",
    "  };",
    "  async function call(tool, args) {",
    "    const r = tool.request || {};",
    "    let path = fill(r.path, args);",
    "    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return text('refused: the path must be relative to this site, not an absolute URL', true);",
    "    path = '/' + String(path).replace(/^\\/+/, '');",
    "    const qs = new URLSearchParams();",
    "    if (r.query) for (const k of Object.keys(r.query)) { const v = args && args[k] != null ? args[k] : null; if (v !== null) qs.set(k, String(v)); }",
    "    const url = path + (qs.toString() ? '?' + qs.toString() : '');",
    "    const init = { method: r.method || 'GET', credentials: 'same-origin', headers: { 'accept': r.accept || 'application/json, text/html;q=0.9, text/plain;q=0.8' } };",
    "    if (init.method === 'POST') { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(args || {}); }",
    "    const res = await fetch(url, init);",
    "    const raw = await res.text();",
    "    if (!res.ok) return text('HTTP ' + res.status + ' for ' + url + '\\n' + trunc(raw, 2000), true);",
    "    const ct = (res.headers.get('content-type') || '').toLowerCase();",
    "    const cap = Number(args && args.max_chars) > 0 ? Number(args.max_chars) : 20000;",
    "    if (r.extract === 'loc') {",
    "      const locs = Array.from(raw.matchAll(/<loc>([^<]+)<\\/loc>/gi)).map((m) => m[1]);",
    "      const limit = Number(args && args.limit) > 0 ? Number(args.limit) : 100;",
    "      return text(JSON.stringify({ count: locs.length, urls: locs.slice(0, limit) }, null, 1));",
    "    }",
    "    if (ct.indexOf('json') >= 0) return text(trunc(raw, 40000));",
    "    if (ct.indexOf('html') >= 0) return text(trunc(html2text(raw), cap));",
    "    return text(trunc(raw, cap));",
    "  }",
    "  function toolHandler(tool) {",
    "    return async (args) => {",
    "      try {",
    "        if (tool.local === 'page_context') return pageContext();",
    "        return await call(tool, args || {});",
    "      } catch (e) { state.errors.push(tool.name + ':' + e); return text(tool.name + ' failed: ' + (e && e.message || e), true); }",
    "    };",
    "  }",
    "  async function install(target) {",
    "    const man = state.manifest;",
    "    let n = 0;",
    "    for (const pack of (man.packs || [])) {",
    "      for (const tool of (pack.tools || [])) {",
    "        try {",
    "          await target.registerTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, execute: toolHandler(tool) });",
    "          n++;",
    "        } catch (e) { state.errors.push('register:' + tool.name + ':' + e); }",
    "      }",
    "    }",
    "    state.registered = n;",
    "    state.mode = n ? 'registered' : 'failed';",
    "    return n;",
    "  }",
    "  state.install = install;",
    "  (async () => {",
    "    try {",
    "      const platform = document.querySelector('script[src*=\"/.webmcp/bridge.js\"]:not([data-webmcp])');",
    "      state.platform_bridge = !!platform;",
    "      const res = await fetch('/api/webmcp/manifest.json', { credentials: 'same-origin', headers: { accept: 'application/json' } });",
    "      if (!res.ok) { state.mode = 'no-manifest'; state.errors.push('manifest http ' + res.status); return; }",
    "      state.manifest = await res.json();",
    "      state.packs = (state.manifest.packs || []).map((p) => p.id);",
    "      state.tools = (state.manifest.packs || []).flatMap((p) => (p.tools || []).map((t) => t.name));",
    "      const c = ctx();",
    "      state.supported = !!c;",
    "      if (!c) { state.mode = 'standalone'; return; }",
    "      // Cloudflare's own bridge is on this page (its zone toggle is on): it registers the same tools through /mcp.",
    "      // Registering them a second time would collide on tool names, so ours stands down and says so.",
    "      if (state.platform_bridge) { state.mode = 'platform'; return; }",
    "      await install(c);",
    "    } catch (e) { state.mode = 'error'; state.errors.push(String(e)); }",
    "  })();",
    "})();"
  ];
  return L.join(String.fromCharCode(10)) + String.fromCharCode(10);
}

// wmToolUrl builds the same-origin request a tool describes. Both executors use it: the browser bridge (which calls
// over HTTP with the visitor's session) and the MCP endpoint below (which calls the worker's own router). One builder
// means a tool cannot mean one thing in a browser and another in the MCP surface.
function wmToolUrl(tool, args) {
  var r = tool.request || {};
  var fill = function (tpl) {
    return String(tpl == null ? "" : tpl).replace(/\{([a-z0-9_]+)\}/gi, function (m, k) {
      var v = args && args[k];
      return v == null ? "" : String(v);
    });
  };
  var path = fill(r.path);
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  path = "/" + path.replace(/^\/+/, "");
  var qs = [];
  if (r.query) {
    for (var k in r.query) {
      if (!Object.prototype.hasOwnProperty.call(r.query, k)) continue;
      var v = args && args[k] != null ? args[k] : null;
      if (v !== null) qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(fill(r.query[k])));
    }
  }
  return path + (qs.length ? "?" + qs.join("&") : "");
}
function wmStripHtml(s) {
  return String(s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function wmTrunc(s, n) {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n) + "\n[... " + (s.length - n) + " more characters]" : s;
}
function wmToolResult(text, isError) {
  return { content: [{ type: "text", text: text }], isError: isError ? true : undefined };
}

// wmExecTool runs one tool through the worker's own router. No subrequest: the captured original fetch is called as a
// function, so the tool sees exactly the response a visitor would get, at the cost of no extra invocation.
async function wmExecTool(tool, args, request, origFetch, env, ctx) {
  if (!tool || !tool.request) {
    return wmToolResult("page_context is answered in the browser by the bridge; a server-side caller has no page.", true);
  }
  var target = wmToolUrl(tool, args);
  if (!target) return wmToolResult("refused: a tool path must be relative to this site, not an absolute URL", true);
  var origin = new URL(request.url).origin;
  var init = { method: String(tool.request.method || "GET").toUpperCase(), headers: {} };
  if (init.method === "POST") {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(args || {});
  } else {
    init.headers["accept"] = tool.request.accept || "application/json";
  }
  var res = await origFetch(new Request(origin + target, init), env, ctx);
  var raw = await res.text();
  if (!res.ok) return wmToolResult("HTTP " + res.status + " for " + target + "\n" + wmTrunc(raw, 2000), true);
  var ct = (res.headers.get("Content-Type") || "").toLowerCase();
  if (ct.indexOf("html") >= 0) return wmToolResult(wmTrunc(wmStripHtml(raw), 20000));
  return wmToolResult(wmTrunc(raw, WM_MAX_TEXT));
}
function wmFindTool(host, name) {
  var packs = wmPacks(host);
  for (var i = 0; i < packs.length; i++) {
    for (var j = 0; j < packs[i].tools.length; j++) if (packs[i].tools[j].name === name) return packs[i].tools[j];
  }
  return null;
}
function wmMcpCard(host, workerName) {
  var man = wmManifest(host, workerName);
  return {
    schema_version: "mcp/server-card/v1",
    serverInfo: { name: "qnfo-webmcp", version: WM_VERSION, title: "QNFO " + (man.host || "site") },
    description: "The same-origin MCP server behind this site's WebMCP tools. Discovered by Cloudflare's WebMCP bridge (pack mcp-server-client) and by any MCP client that speaks JSON-RPC over HTTP.",
    transport: { type: "http", path: WM_MCP_PATH, methods: ["POST", "GET", "DELETE"], protocolVersions: WM_MCP_PROTOCOLS },
    capabilities: { tools: { listChanged: false } },
    tool_count: man.tool_count,
    packs: man.pack_ids,
    standard: "https://blog.cloudflare.com/webmcp/"
  };
}
async function wmRpc(msg, request, env, ctx, origFetch, workerName) {
  var u = new URL(request.url);
  var host = u.hostname;
  var id = msg && Object.prototype.hasOwnProperty.call(msg, "id") ? msg.id : null;
  var method = msg && msg.method ? String(msg.method) : "";
  var params = (msg && msg.params) || {};
  var isNotification = !msg || !Object.prototype.hasOwnProperty.call(msg, "id") || msg.id === null;
  var reply = function (result) { return { jsonrpc: "2.0", id: id, result: result }; };
  var fail = function (code, message) { return { jsonrpc: "2.0", id: id, error: { code: code, message: message } }; };
  if (!msg || msg.jsonrpc !== "2.0" || !method) return isNotification ? null : fail(-32600, "invalid request");
  if (method === "initialize") {
    var asked = String(params.protocolVersion || "");
    var ver = WM_MCP_PROTOCOLS.indexOf(asked) >= 0 ? asked : WM_MCP_PROTOCOLS[1];
    return reply({
      protocolVersion: ver,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "qnfo-webmcp", version: WM_VERSION, title: "QNFO " + host },
      instructions: "Tools published by " + host + ". Every tool reads the same public data the page shows; nothing here takes a credential, and nothing reaches another origin."
    });
  }
  if (method.indexOf("notifications/") === 0) return null;
  if (method === "ping") return reply({});
  if (method === "tools/list") {
    var man = wmManifest(host, workerName);
    var tools = [];
    for (var i = 0; i < man.packs.length; i++) {
      for (var j = 0; j < man.packs[i].tools.length; j++) {
        var t = man.packs[i].tools[j];
        tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
      }
    }
    return reply({ tools: tools });
  }
  if (method === "tools/call") {
    var name = String(params.name || "");
    var tool = wmFindTool(host, name);
    if (!tool) return fail(-32602, "unknown tool: " + name);
    try {
      var result = await wmExecTool(tool, params.arguments || {}, request, origFetch, env, ctx);
      return reply(result);
    } catch (e) {
      return reply(wmToolResult(name + " failed: " + String((e && e.message) || e), true));
    }
  }
  return isNotification ? null : fail(-32601, "method not found: " + method);
}

// wmMcp answers the site's MCP endpoint. Cloudflare's WebMCP bridge (pack mcp-server-client, data-mcp-url defaulting to
// /mcp) runs initialize -> notifications/initialized -> tools/list -> tools/call against it with the visitor's session,
// so the fleet's tools reach document.modelContext through the platform's own implementation wherever the zone toggle
// is on, and through /.webmcp/bridge.js where it is not.
async function wmMcp(request, env, ctx, origFetch, workerName) {
  try {
    if (!request) return null;
    var u = new URL(request.url);
    if ((u.pathname.replace(/\/+$/, "") || "/") !== WM_MCP_PATH) return null;
    var m = String(request.method || "GET").toUpperCase();
    var h = { "X-WebMCP": WM_VERSION };
    if (m === "GET" || m === "HEAD") {
      var card = JSON.stringify(wmMcpCard(u.hostname, workerName));
      return new Response(m === "HEAD" ? null : card, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-WebMCP": WM_VERSION } });
    }
    if (m === "DELETE" || m === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (m !== "POST") return wmJson({ error: "method not allowed" }, 405, "no-store");
    var body = null;
    try {
      body = await request.json();
    } catch (e) {
      return wmJson({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400, "no-store");
    }
    var batch = Array.isArray(body);
    var msgs = batch ? body : [body];
    var out = [];
    for (var i = 0; i < msgs.length; i++) {
      var r = await wmRpc(msgs[i], request, env, ctx, origFetch, workerName);
      if (r) out.push(r);
    }
    if (!out.length) return new Response(null, { status: 202, headers: h });
    return wmJson(batch ? out : out[0], 200, "no-store");
  } catch (e) {
    return null;
  }
}

function wmJson(body, status, cache) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache || "public, max-age=300", "X-WebMCP": WM_VERSION }
  });
}

// wmRoute answers the bridge and the manifest and nothing else. Returns null for every other request, so a caller can
// run it before its own router without changing any existing behaviour.
function wmRoute(request, workerName) {
  try {
    if (!request) return null;
    var u = new URL(request.url);
    var p = u.pathname;
    var isManifest = p === WM_PACKS_PATH || p === WM_MANIFEST_PATH || p === WM_MANIFEST_URL;
    if (p !== WM_BRIDGE_PATH && !isManifest) return null;
    var m = String(request.method || "GET").toUpperCase();
    if (m !== "GET" && m !== "HEAD") return wmJson({ error: "method not allowed" }, 405, "no-store");
    var host = u.hostname;
    if (p === WM_BRIDGE_PATH) {
      var js = wmBridgeSource();
      var h = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-WebMCP": WM_VERSION, "X-Content-Type-Options": "nosniff" };
      return new Response(m === "HEAD" ? null : js, { status: 200, headers: h });
    }
    var man = wmManifest(host, workerName || "");
    man.paths = { bridge: WM_BRIDGE_PATH, packs: WM_MANIFEST_URL, manifest: WM_MANIFEST_URL, mcp: WM_MCP_PATH };
    var hh = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-WebMCP": WM_VERSION };
    return new Response(m === "HEAD" ? null : JSON.stringify(man), { status: 200, headers: hh });
  } catch (e) {
    return null;
  }
}

// The HTMLRewriter handler. It appends the module tag at the end of <head>; a page without a head, a non-200, a
// non-HTML body or a browser we cannot detect all pass through untouched.
// wmPlatformOn: hosts whose zone has Cloudflare own WebMCP preview switched on. Measured 2026-10-25: qnfo.org,
// papers, ideas, fleet and ipatent each carried the platform tag (data-packs="c2pa,mcp-server-client") and
// /.webmcp/bridge.js resolved to the 75,756-byte platform bundle before this worker was reached. The platform
// bundle keeps only the pack names it bundles and does NOT fall back to its defaults, so a second tag carrying
// "site,papers" downloads the same bundle again, registers nothing and logs two warnings. On those hosts this
// worker supplies /mcp and lets the platform bridge register it.
function wmPlatformOn(host) {
  var h = wmHost(host);
  return h === "qnfo.org" || h.slice(-9) === ".qnfo.org";
}
function wmInjector(host, workerName) {
  var ids = wmPackIds(host);
  var packs = ids.join(",");
  var tag = '<script type="module" src="' + WM_BRIDGE_PATH + '" data-webmcp="' + WM_VERSION + '" data-packs="' + packs + '" data-mcp-url="' + WM_MCP_PATH + '" data-worker="' + String(workerName || "").replace(/"/g, "") + '"></script>';
  return {
    element: function (el) {
      try { el.append(tag, { html: true }); } catch (e) { }
    }
  };
}
function wmWithHtml(res, request, workerName) {
  try {
    if (!res || !request) return res;
    var m = String(request.method || "GET").toUpperCase();
    if (m !== "GET") return res;
    if (res.status !== 200) return res;
    var ct = (res.headers.get("Content-Type") || "").toLowerCase();
    if (ct.indexOf("text/html") !== 0) return res;
    if (typeof HTMLRewriter === "undefined") return res;
    var u = new URL(request.url);
    if (wmPlatformOn(u.hostname)) return res;
    if (u.pathname.indexOf("/.webmcp/") === 0 || u.pathname === WM_MCP_PATH) return res;
    var out = new HTMLRewriter().on("head", wmInjector(u.hostname, workerName)).transform(res);
    // A rewritten body no longer matches the origin's Content-Length/ETag; left in place they truncate or mis-cache
    // the page. The X-WebMCP marker is what scripts/webmcp-verify.mjs reads without parsing 200 KB of HTML.
    try {
      out.headers.delete("Content-Length");
      out.headers.delete("ETag");
      out.headers.set("X-WebMCP", WM_VERSION);
    } catch (e2) { }
    return out;
  } catch (e) {
    return res;
  }
}

// wmAttach wraps a worker's default export so every response passes through the steps above. It is a property
// assignment on the exported object, so the runtime sees it on every invocation, and it is idempotent.
function wmAttach(target, workerName) {
  try {
    if (!target || typeof target.fetch !== "function" || target.__wm === WM_VERSION) return target;
    var orig = target.fetch;
    var name = workerName || "";
    target.fetch = async function (request, env, ctx) {
      var routed = wmRoute(request, name);
      if (routed) return routed;
      var mcp = await wmMcp(request, env, ctx, orig, name);
      if (mcp) return mcp;
      var res = await orig.call(this, request, env, ctx);
      return wmWithHtml(res, request, name);
    };
    target.__wm = WM_VERSION;
    return target;
  } catch (e) {
    return target;
  }
}
// ---- WEBMCP-FLEET-1:END ----
// ---- WEBMCP-FLEET-1:ATTACH q08-mind ----
wmAttach(__wm_default, "q08-mind");
