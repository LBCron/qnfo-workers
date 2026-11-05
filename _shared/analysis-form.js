// ---- ANALYSIS-FORM-1 (EK-6, roadmap row 1753, charter pillar reach). One analysis form for every writer that outsiders read.
//
// WHAT. The form that reading.q08.org grew over October 2026 lives here once: the writer's rules (lede, systems analysis, quotation,
// contested-topic sources, the strongest objection, even keel), the essay form and the adversarial reader's rubric; the objection
// finder; the lede helpers; the even-keel check (prompt, parser, verdict, reviewer choice, revision note); the sources footer with
// the host profile table; the AI label. A form improvement is made in this file, inlined into each adopting worker by
// `node _shared/inline-analysis-form.mjs <worker>`, and proved by `_shared/analysis-form.test.mjs`, which also fails when an adopting
// worker holds a stale copy. Nothing here imports anything or touches a binding: pure strings and pure functions, so any worker can
// take it (personal-companion today; q08-signal-engine and the research writers by the same script).
//
// WHY. Before this file the form existed only inside personal-companion/worker.js while q08 and the research writers kept separate
// prompts, so each fix (a lede that names its subject, an objection placed where the argument needs it, a label for AI text) had to be
// ported by hand, and the even-keel check (EK-3) was written against a model family that did not exist (BALANCE_FAMILY "ensemble-policy-1").
//
// HOW TO ADOPT (q08-signal-engine, research writers). 1) Run `node _shared/inline-analysis-form.mjs q08-signal-engine --anchor "<a line of
// the worker to insert the block before>"` once; it writes the block between its BEGIN and END marker lines
// and mirrors deployed-current.worker.js; later runs replace the block in place (`--check` only reports a stale copy). 2) Build the
// writer prompt from the AF_ rules (AF_LEDE_RULE, AF_SYSTEMS_RULE, AF_QUOTE_RULE, AF_CONTESTED_RULE, AF_OBJECTION_RULE, AF_EVEN_KEEL_RULE) and
// AF_P_ESSAY; keep the worker's own voice and format lines around them. 3) After the deterministic gate and the fact-check, ask one reviewer
// from another family (afPickBalanceReviewer) with AF_BALANCE_PROMPT, read the reply with afParseBalanceScore, decide with afBalanceVerdict,
// and on a fail revise with afBalanceRevisionNote. 4) Render with afSourcesFooter and afAiLabelHtml.
//
// RULES FOR EDITING. ES5 style (var and function), no import or export, every name starts with AF_ or af, no `*` followed by `/` in a
// comment. A change here changes every adopter on its next inline run: version the change in AF_VERSION and say what moved in the PR.
var AF_VERSION = "1.0.0";
var AF_NL = "\n";
function afLines() { return Array.prototype.slice.call(arguments).join(AF_NL); }
function afEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

// ---- the writer's rules, one string each, verbatim from reading.q08.org's prompt (the pinned tests read them back)
var AF_LEDE_RULE = "LEDE (inverted pyramid, checked before anything else): the first paragraph, at most 110 words and before any heading, tells a reader who has never heard of the subject what it is, where it comes from in the world (the place, the period, the field or the people) and why it matters. Never credit or name the source document in the lede or anywhere in the prose: no 'according to the Wikipedia article', no 'the arXiv paper describes'; the sources are listed under the piece for the reader. Name the subject in the first sentence. Then the most important facts from the source, most important first, and only then the analysis. Never open on a generality, an aphorism, a question or an abstract noun ('the idea of', 'the pattern').";
var AF_SYSTEMS_RULE = "CONTEXT AND SYSTEMS ANALYSIS (required; this is why the piece exists, and a piece that only retells its source is rejected): after the facts, place the subject in its bigger picture and explain the system behind it, from the source material. Name the parties or parts involved and what each is rewarded, punished or constrained by; the constraint, delay or information gap that shapes the outcome; the feedback loop that keeps it in place or changes it; who gains and who pays; and where the same arrangement operates beyond this case. Reason openly and say it is reasoning ('the incentive is ...', 'that means ...', 'if ... then ...'), introducing no name, date, number, event or quotation the source material does not contain. Every sentence of the analysis that the source does not state must read as reasoning from its first words; never state an inferred arrangement, funding, motive or behaviour as a reported fact. Build the analysis from this subject's own particulars in the source (its named parties, figures, dates and events): a paragraph that would read the same for any other subject is boilerplate and is rejected. Begin the analysis with a line of its own that contains exactly <!-- analysis --> (readers never see it): everything before that line is reporting from the source material, everything after it is your analysis.";
var AF_QUOTE_RULE = "Quotations: quote only words that appear verbatim in the source material, attributed to the person the source attributes them to, and only from the source that concerns that person; never invent, paraphrase into quotation marks or move a quotation to another subject. Every quotation of five or more words is checked against the sources.";
var AF_CONTESTED_RULE = "- For a contested topic in policy, history, geopolitics, health or economics, use at least three independent full-text sources with at least two explicit viewpoint labels and one verified non-US source. Compare where the viewpoints differ; source metadata is not evidence for factual claims.";
var AF_OBJECTION_RULE = "- The strongest objection to your central claim must appear in the piece, stated fairly in your own words as an objection a careful reader could raise, with an honest assessment of how bad it is. Never put it in quotation marks and never attribute it to critics, scholars, commentators or anyone the source material does not name making that objection. It may rest on the source material or be pure logic; it may not rest on facts from outside it. Where it sits is your choice; do not give it the same heading or the same position twice in a row.";
// EK-3 (writer side): the reviewer below scores what the writer was asked for here, so a draft is told its bar before it is judged.
var AF_EVEN_KEEL_RULE = "- Even keel: a disputed claim is stated as the position of the party that holds it, naming the party only where the source material names it, never as settled fact. Use neutral descriptive words for people, groups, causes and events; where the source material's own wording is loaded, report it as that party's wording or replace it with a plain description. Where the source material holds more than one account of an event or a policy, give each its strongest form and say where they differ.";
// The long-form essay contract (reading.q08.org's P_ESSAY; the probe for issue 1000716 reads the first line of it in both files).
var AF_P_ESSAY = afLines(
  "FORM: essay, 2000 to 2800 words. This is long-form. One sustained line of thought, carried to the end; do not stop while the argument is still thin, and do not pad.",
  "The subject is one thing. Write about the subject itself, in depth. Do not survey. Argue.",
  "Your argument must be a specific, falsifiable claim with consequences - something a knowledgeable reader could disagree with. It must not be an analogy, a family resemblance, or a restatement of the obvious.",
  "You are given real source material below. Mine it. Use the names, dates, numbers, mechanisms and cases it contains, and only those; a piece that could have been written without reading the sources has failed, and a piece that states anything the sources do not contain is discarded.",
  "Required content, not required sections: (a) the strongest objection to your central claim, stated fairly in your own words (never as a quotation or an unnamed critic), weighed honestly; (b) what would have to be true for your claim to hold, and what observation would falsify it. Where these sit is your call - the objection can be a heading, two sentences mid-argument, or the whole last section. Do not end every piece with the same two moves.",
  "Vary the section plan. Your previous pieces are listed below; your structure must differ from each of their structures. A reader must not be able to predict your headings from the first page."
);
// The adversarial reader's rubric (reading.q08.org's P_CRITIQUE).
var AF_P_CRITIQUE = afLines(
  "You are an adversarial reader. You dislike fluency. You are looking for reasons this piece is worthless.",
  "You are given the SOURCE MATERIAL the writer was allowed to use, and the piece.",
  "Score each dimension 0 to 10. Be harsh: a 7 means genuinely good.",
  "specificity: does it hang on concrete checkable particulars from the source material, or could it have been written about anything?",
  "argument: is there a claim that could be wrong, or only gestures?",
  "objection: is the stated objection the strongest available one, or a straw man?",
  "voice: plain scholarly prose free of filler, tells, and self-reference?",
  "grounding: does every concrete claim (name, date, number, event, quotation) trace to the source material? Score 0 if you find one that does not. A sentence that reports as fact something the source does not state (an event, an arrangement, a behaviour, a cause) counts as such a claim. Reasoning the writer frames as reasoning ('the incentive is ...', 'that means ...', 'if ... then ...', 'it follows that ...') and that adds no name, date, number, event or quotation is not a grounding failure: judge it under argument and systems. Text after a line <!-- analysis --> is the writer's marked analysis: there, count under grounding only a concrete invented fact (a name, date, number, event, rule, quotation or study the source material does not contain); claims about incentives, constraints, motives and consequences in that section are judged under argument and systems, never grounding. Text before that line is held to the full rule.",
  "systems: does the piece place its subject in a bigger picture and explain the system behind it (the parties and what each is rewarded or constrained by, the constraint or information gap, the feedback loop, who gains and who pays, where else it operates), or does it only retell the source? A retelling scores at most 3.",
  "invented: every concrete claim you found that the source material does not support, each as a short quotation copied exactly from the piece (at most 16; an empty list when there is none).",
  'Return JSON only: {"specificity":n,"argument":n,"objection":n,"voice":n,"grounding":n,"systems":n,"invented":["exact quotation", ...],"verdict":"accept" or "reject","why":"one sentence"}'
);

// ---- the objection finder (OBJECTION-FIND-1): where the essay contract lets the objection sit, not only under a heading that says so
function afExtractSection(md, needle) {
  var lines = String(md).split(AF_NL);
  var out = [];
  var on = false;
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (t.indexOf("#") === 0) {
      if (on) break;
      if (t.toLowerCase().indexOf(needle) >= 0) on = true;
      continue;
    }
    if (on) out.push(t);
  }
  return out.join(" ").trim();
}
var AF_OBJECTION_CUE_RE = /\b(objections?|object(?:s)? that|counter-?arguments?|case against|argument against|strongest (?:challenge|reply|doubt)|a careful reader|a sceptic|a skeptic)\b/i;
var AF_OBJECTION_HEAD_RE = /\b(objections?|against|counter|critics?|sceptic|skeptic|doubts?|wrong|other side|caveats?|challenges?|reservations?|rebuttal|dissent|weakness(?:es)?)\b/i;
function afFindObjection(md) {
  var s = afExtractSection(md, "objection");
  if (s.length >= 40) return s;
  var paras = String(md || "").split(/\n\s*\n/).map(function (x) { return x.trim(); }).filter(Boolean);
  for (var i = 0; i < paras.length; i++) {
    if (paras[i].indexOf("#") === 0 || !AF_OBJECTION_CUE_RE.test(paras[i])) continue;
    var t = paras[i];
    if (t.length < 200 && i + 1 < paras.length && paras[i + 1].indexOf("#") !== 0) t += " " + paras[i + 1];
    t = t.replace(/\s+/g, " ").trim();
    if (t.length >= 40) return t;
  }
  var lines = String(md || "").split(AF_NL), on = false, out = [];
  for (var j = 0; j < lines.length; j++) {
    var l = lines[j].trim();
    if (l.indexOf("#") === 0) {
      if (on && out.join(" ").trim().length >= 40) break;
      on = AF_OBJECTION_HEAD_RE.test(l.replace(/^#+/, "")); out = [];
      continue;
    }
    if (on && l) out.push(l);
  }
  var h = out.join(" ").replace(/\s+/g, " ").trim();
  return on && h.length >= 40 ? h : s;
}

// ---- the lede (COMPANION-LEDE-1, LEDE-RULE-1, LEDE-SPLIT-1) and the sentence splitter it shares with sentence deletion
// SENT-INITIALISM-1 (1.26.2, companion_runs 6224 of 2026-10-14 08:11 UTC): a dotted initialism ("U.S.", "D.C.") ended a sentence, so the
// critic prune that deleted "... of the U.S." left the fragment "Consul. Negotiations failed ..." and the critic scored the fragment
// invented. An initialism of two or more dotted capitals no longer ends a sentence (a sentence that truly ends on one joins the next).
var AF_SENT_ABBREV_RE = /(?:^|[\s(])(?:(?:[A-Z]\.)+[A-Z]|[A-Z]|Dr|Mr|Mrs|Ms|Prof|St|No|vs|v|cf|Fig|Eq|et al|e\.g|i\.e|pp?|Jr|Sr|Gen|Gov|Sen|Rep|Lt|Col|Capt|Sgt|Hon|Stat|Ct|Mt|Ft)\.\s*$/;
function afExtractLede(md) {
  var lines = String(md).split(AF_NL);
  var i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  var startsHeading = i < lines.length && lines[i].trim().indexOf("#") === 0;
  while (i < lines.length && lines[i].trim().indexOf("#") === 0) {
    i++;
    while (i < lines.length && !lines[i].trim()) i++;
  }
  var buf = [];
  while (i < lines.length) {
    var t = lines[i].trim();
    if (!t) break;
    if (t.indexOf("#") === 0) break;
    if (t.indexOf("- ") === 0 || t.indexOf("> ") === 0) break;
    buf.push(t);
    i++;
  }
  var lede = buf.join(" ").trim();
  var rest = startsHeading ? String(md).trim() : lines.slice(i).join(AF_NL).trim();
  return { lede, rest, startsHeading };
}
// COMPANION-LEDE-1 (1.17.0; owner 2026-10-13: every piece opens with a proper lede, inverted pyramid). The lede is the first paragraph a
// reader sees (piece.lede, else the first prose paragraph of the body). It must share at least one significant word with the subject's
// title (the first five letters, so "trackway" matches "trackways"), must not open on abstract framing or a question, and stays short.
var AF_LEDE_MAX_WORDS = 120;
var AF_LEDE_ABSTRACT_RE = /^\s*(?:(?:the|this|that|these|such|our)\s+(?:very\s+)?(?:idea|notion|concept|question|problem|pattern|mechanism|story|history|tension|dynamics?|nature|essence|meaning|paradox)\s+of\b|in\s+(?:a|an|the|our|today's)\s+(?:world|age|era|time|times)\b|throughout\s+(?:history|time|the\s+ages)\b|since\s+the\s+dawn\b|(?:imagine|consider|picture)\b|what\s+(?:if|does|do|is|makes|happens)\b|(?:we|you)\s+(?:often|rarely|tend|all|like)\b|there\s+is\s+something\b|few\s+\w+\s+(?:are|have|capture)\b)/i;
var AF_LEDE_STOP = /^(this|that|with|from|have|were|their|there|which|when|what|into|than|then|they|them|been|also|only|more|most|such|does|each|over|will|would|could|should|about|after|before|because|while|where|your|using|based|towards?|new|how|why|the|and|for)$/;
function afLedeWords(t) { return String(t || "").toLowerCase().replace(/[‐-―−]/g, "-").split(/[^a-z0-9À-ɏ]+/).filter(function (w) { return w.length >= 4 && !AF_LEDE_STOP.test(w); }); }
function afLedeOf(piece) {
  var l = String(piece && piece.lede || "").trim();
  if (l) return l;
  var paras = String(piece && piece.body_md || "").split(/\n\s*\n/);
  for (var i = 0; i < paras.length; i++) { var p = paras[i].trim(); if (p && p.charAt(0) !== "#" && p.indexOf("- ") !== 0 && p.indexOf("> ") !== 0 && p.indexOf("<!--") !== 0) return p.replace(/\s+/g, " "); }
  return "";
}
function afLedeProblems(piece, subject) {
  var lede = afLedeOf(piece), out = [];
  if (!lede) return ["lede missing: open with a paragraph that says what the subject is and where it comes from"];
  var n = lede.split(/\s+/).filter(Boolean).length;
  if (n > AF_LEDE_MAX_WORDS) out.push("lede too long (" + n + " words; the first paragraph is at most " + AF_LEDE_MAX_WORDS + ")");
  var first = (lede.match(/^[\s\S]*?[.!?](?=\s|$)/) || [lede])[0];
  if (AF_LEDE_ABSTRACT_RE.test(lede.replace(/^[*_\s]+/, "")) || /\?\s*$/.test(first)) out.push("lede opens on abstract framing or a question ('" + lede.slice(0, 50) + "'): open by saying what the subject is and where it comes from");
  var want = afLedeWords(subject);
  var have = afLedeWords(lede).map(function (w) { return w.slice(0, 5); });
  if (want.length && !want.some(function (w) { return have.indexOf(w.slice(0, 5)) >= 0; })) out.push("lede does not name the subject: the first paragraph must say what " + String(subject).slice(0, 80) + " is and where it comes from");
  return out;
}
// LEDE-SPLIT-1 (1.19.1, run 5342-5364: three of five drafts failed only or mainly on "lede too long", 137-174 words). An over-long first
// paragraph is split at a sentence boundary: the opening sentences up to AF_LEDE_SPLIT_WORDS stay the lede, the rest becomes the first body
// paragraph. Nothing is added or removed, so no fact changes; a single sentence longer than the limit is left to the check.
var AF_LEDE_SPLIT_WORDS = 100;
function afSplitLongLede(piece) {
  var lede = String(piece && piece.lede || "").trim();
  var count = function (s) { return String(s).split(/\s+/).filter(Boolean).length; };
  if (!lede || count(lede) <= AF_LEDE_MAX_WORDS) return piece;
  var raw = lede.match(/[\s\S]*?[.!?]+["')\]’”]*(?=\s|$)\s*|[\s\S]+$/g) || [lede], sents = [];
  raw.forEach(function (x) { if (sents.length && AF_SENT_ABBREV_RE.test(sents[sents.length - 1])) sents[sents.length - 1] += x; else sents.push(x); });
  var kept = [], n = 0, i = 0;
  for (; i < sents.length; i++) { var w = count(sents[i]); if (kept.length && n + w > AF_LEDE_SPLIT_WORDS) break; kept.push(sents[i]); n += w; }
  if (i >= sents.length) return piece;
  var head = kept.join("").trim(), rest = sents.slice(i).join("").trim();
  var body = String(piece.body_md || "");
  // when the lede was read out of the body (a draft that opened with a heading) the body already holds the paragraph: shorten only the lede
  if (body.indexOf(lede) !== -1) return Object.assign({}, piece, { lede: head });
  return Object.assign({}, piece, { lede: head, body_md: rest + "\n\n" + body });
}
// EK-1 (roadmap row 1748): the lede a reader is shown. The stored lede when there is one; otherwise, when the body OPENS on a prose paragraph, that
// paragraph, cut at a sentence boundary when it runs past AF_LEDE_SPLIT_WORDS. The index preview and the piece page both call this, so they always agree,
// and a piece whose stored lede was lost to a prune (2 of the 14 newest reading.q08.org pieces on 2026-11-04) still opens on a set-apart lede. A body that
// opens on a heading, list, quote or comment yields none: the paragraph under a heading is a section's lead-in and would be shown twice. Empty then.
function afShownLede(piece) {
  var stored = String(piece && piece.lede || "").trim();
  if (stored) return stored;
  var body = String(piece && piece.body_md || "").replace(/^\s+/, "");
  if (!body || /^(?:#|[-*] |> |<!--)/.test(body)) return "";
  var first = body.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  if (!first) return "";
  return String(afSplitLongLede({ lede: first, body_md: "" }).lede || first).trim();
}

// ---- the even-keel check (EK-3): one reviewer from a family other than the writer's scores how fairly the piece handles disagreement
var AF_BALANCE_MIN_SCORE = 70;
var AF_BALANCE_PROMPT = afLines(
  "You are an even-keel reviewer. You did not write this draft and you are not its editor. Score how fairly it handles disagreement, using only what is on the page.",
  "Score each part from 0 to 10:",
  "opposing: is the strongest argument against the draft's central claim stated at the strength its own holders would give it, and weighed honestly rather than set up to fail? A draft that makes no contested claim scores 10 here.",
  "wording: are loaded or partisan terms for people, groups, causes and events avoided, or reported as a party's own words? 10 means none unattributed.",
  "attribution: is every disputed claim attributed to the party that makes it, or stated as disputed, instead of asserted as settled fact? 10 means none unattributed.",
  "Do not judge accuracy, style, length or whether you agree with the draft. A draft is one-sided when it argues one position while presenting it as the only reasonable view.",
  "Return only JSON: {\"opposing\":n,\"wording\":n,\"attribution\":n,\"reason\":\"one sentence that names the weakest passage\"}"
);
function afBalanceScore(parts) { return Math.round(parts.opposing * 5 + parts.wording * 2.5 + parts.attribution * 2.5); }
// Reads a reviewer's reply: sub-scores 0 to 10 combined by weight into 0 to 100 (opposing counts double); a reply that gives only "score" is read as such.
// null when nothing usable is in the reply.
function afParseBalanceScore(text) {
  var t = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  var o = null, m = t.match(/\{[\s\S]*\}/);
  if (m) { try { o = JSON.parse(m[0]); } catch (e) { o = null; } }
  if (!o) {
    var parts0 = {}, any = 0;
    ["opposing", "wording", "attribution"].forEach(function (k) { var mm = t.match(new RegExp("\"" + k + "\"\\s*:\\s*(\\d+(?:\\.\\d+)?)")); if (mm) { parts0[k] = Number(mm[1]); any++; } });
    if (any === 3) o = parts0;
    else { var sm = t.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/); if (!sm) return null; o = { score: Number(sm[1]) }; }
  }
  var reason = String(o.reason || "").replace(/\s+/g, " ").trim().slice(0, 260);
  var p = { opposing: Number(o.opposing), wording: Number(o.wording), attribution: Number(o.attribution) };
  var haveParts = [p.opposing, p.wording, p.attribution].every(function (x) { return isFinite(x) && x >= 0 && x <= 10; });
  if (haveParts) return { score: afBalanceScore(p), parts: p, reason: reason };
  var score = Number(o.score);
  if (!isFinite(score) || score < 0 || score > 100) return null;
  return { score: Math.round(score), parts: null, reason: reason };
}
// pass, fail or unavailable: a missing or unreadable reply is "unavailable" (the caller fails open only after the deterministic gate and the
// fact-check have passed, and records that it did), never a pass.
function afBalanceVerdict(res, minScore) {
  var min = typeof minScore === "number" ? minScore : AF_BALANCE_MIN_SCORE;
  if (!res || typeof res.score !== "number" || !isFinite(res.score)) return { state: "unavailable", score: null, reason: String(res && res.reason || "no score") };
  return { state: res.score >= min ? "pass" : "fail", score: res.score, parts: res.parts || null, reason: String(res.reason || "") };
}
// The reviewers, in the order to ask them: models whose family is known and is not the writer's, families that have not yet judged the piece
// first (a fresh family reads it, ENSEMBLE-POLICY-1 rule 2), then those that have; one model per family. The start rotates with the seed.
// Empty when no model qualifies. opts: familyOf(id) -> family, allowed(id) -> bool, writerFamily, avoid (families), sick (map of model ids to skip), seed.
function afBalanceReviewers(pool, opts) {
  opts = opts || {};
  var fam = opts.familyOf || function (id) { return String(id).split("/")[1] || String(id); };
  var avoid = {}; (opts.avoid || []).forEach(function (f) { avoid[f] = 1; });
  var seen = {};
  var list = (pool || []).filter(function (id) {
    var f = fam(id);
    if (!f || String(f).indexOf("unknown") === 0 || f === opts.writerFamily || (opts.allowed && !opts.allowed(id)) || (opts.sick && opts.sick[id]) || seen[f]) return false;
    seen[f] = 1;
    return true;
  });
  if (!list.length) return [];
  var start = Math.abs(opts.seed | 0) % list.length, rotated = list.slice(start).concat(list.slice(0, start));
  return rotated.filter(function (id) { return !avoid[fam(id)]; }).concat(rotated.filter(function (id) { return avoid[fam(id)]; }));
}
function afPickBalanceReviewer(pool, opts) { return afBalanceReviewers(pool, opts)[0] || ""; }
// The instruction a draft gets when the even-keel reviewer found it one-sided. It may reorganise, attribute and reword; it may not add a fact.
function afBalanceRevisionNote(reason) {
  return "EVEN-KEEL REVISION. A reviewer from another editorial family found the draft below one-sided: " + String(reason || "it argues one position as the only reasonable view") + AF_NL +
    "Return the SAME piece in the SAME output format (a single # heading with the title, then the prose). State the strongest argument against your central claim at the strength its own holders would give it and weigh it honestly; attribute each disputed claim to the party the source material names as making it, or say it is disputed; replace loaded words with plain description. Use only what the source material states: add no name, date, figure, event or claim it does not contain, and keep the title, the headings and the length.";
}

// The instruction for a fresh draft after an attempt was rejected as one-sided and could not be revised in the time left.
function afBalanceRetryFeedback(reason) {
  return "The previous draft was found one-sided by a reviewer from another editorial family: " + String(reason || "it argues one position as the only reasonable view") + " Write a new draft that states the strongest argument against its central claim at the strength its own holders would give it, attributes each disputed claim to the party the source material names or says it is disputed, and uses plain descriptive words. Use only facts the source material states.";
}
// What is stored with the piece (quality_json): what the check said, never the draft. res is a balanceCheck result: { unavailable, ok, score, parts, reason, model, family, tried }.
function afBalanceRecord(res) {
  if (!res) return { state: "not-run" };
  if (res.unavailable) return { state: "unavailable", reason: String(res.reason || "").slice(0, 200), tried: res.tried || [] };
  return { state: res.ok ? "pass" : "fail", score: res.score, parts: res.parts || null, reason: String(res.reason || "").slice(0, 260), model: res.model || "", family: res.family || "" };
}

// ---- the sources footer and the host profile table (EK-2): where a source is from and what standpoint it speaks from
// country is an ISO 3166 alpha-2 code of the publisher; viewpoint is a short standpoint label ("" for an encyclopedia or a journal, which speak from none).
var AF_SOURCE_PROFILES = {
  "wikipedia.org": { label: "Wikipedia", country: "US", viewpoint: "" },
  "arxiv.org": { label: "arXiv", country: "US", viewpoint: "" },
  "hansard.parliament.uk": { label: "Hansard (UK Parliament)", country: "GB", viewpoint: "uk-parliament" },
  "globalvoices.org": { label: "Global Voices", country: "NL", viewpoint: "global-citizen-media" }
};
function afHost(ref) {
  var m = /^https:\/\/([^\/?#:]+)/i.exec(String(ref || ""));
  return m ? m[1].toLowerCase().replace(/^(?:www|m)\./, "") : "";
}
// The profile of the longest registered host suffix of the reference's host (en.wikipedia.org matches wikipedia.org); null when unregistered.
function afSourceProfile(ref) {
  var host = afHost(ref), best = "";
  Object.keys(AF_SOURCE_PROFILES).forEach(function (h) { if ((host === h || host.slice(-(h.length + 1)) === "." + h) && h.length > best.length) best = h; });
  return best ? AF_SOURCE_PROFILES[best] : null;
}
function afSourceLabel(ref) {
  var r = String(ref || ""), m = /wikipedia\.org\/wiki\/([^?#]+)/.exec(r);
  if (m) { try { return decodeURIComponent(m[1]).replace(/_/g, " ") + " (Wikipedia)"; } catch (e) { return r; } }
  var a = /arxiv\.org\/abs\/([^?#]+)/.exec(r);
  if (a) return "arXiv " + a[1];
  var prof = afSourceProfile(r);
  return prof ? prof.label : (afHost(r) || r);
}
// refs: https URLs (anything else is dropped); esc: the host's HTML escaper (default afEsc). The markup is the footer reading.q08.org has always had.
function afSourcesFooter(refs, esc) {
  var e = esc || afEsc, Q = String.fromCharCode(34);
  var list = (refs || []).filter(function (r) { return /^https:\/\//.test(String(r)); });
  if (!list.length) return "";
  var items = list.slice(0, 8).map(function (r) { return "<a href=" + Q + e(r) + Q + " rel=noopener>" + e(afSourceLabel(r)) + "</a>"; });
  return "<p class=src>Sources: " + items.join(" &middot; ") + "</p>";
}
function afSourcesFooterFromJson(anchorJson, esc) {
  var refs = [];
  try { refs = JSON.parse(String(anchorJson || "{}")).refs || []; } catch (e) { return ""; }
  return afSourcesFooter(refs, esc);
}

// ---- the AI label (BP26-AI-LABEL-1, BP26-AI-ACT-ART50-1): the visible label and the machine-readable credit ride the same sentence
var AF_AI_LABEL_TEXT = "Written by AI and checked against its source material by automated review. No human reviews pieces before they appear.";
function afAiLabelHtml() { return "<span class=ai title=" + String.fromCharCode(34) + AF_AI_LABEL_TEXT + String.fromCharCode(34) + ">AI-generated</span>"; }
