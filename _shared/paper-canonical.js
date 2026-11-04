// PAPER-CANONICAL-1: the stored shape of a paper. A new release, a revision and a repaired old row all end up as
// `# Title`, an optional italic subtitle, `## Abstract`, then the paper, with no YAML front matter, no byline or metadata
// block, no repeated or wrapped title and no in-body version history, changelog or revision banner. Who changed what and
// when lives in the ledger (paper_change_ledger / paper_change_bodies), paper_revision_log and the Versions tab, and the
// bibliographic fields live in the papers columns (canonicalLift moves keywords and a valid DOI there; the ORCID, ISNI,
// contact and dates stay in the ledger copy of the previous body). Needs formatPaper (paper-format.js) in scope.
// canonicalPaper(source, record, opts) -> { body, title, subtitle, abstract, fields, removed, droppedHeadings, removedWords }
// opts.keepHistory keeps in-body history sections (owner-written papers whose history is the author's own text).
export function canonicalPaper(source, record, opts) {
  const o = opts || {};
  const rec = record || {};
  const removed = [];
  let dropped = 0;
  let removedWords = 0;
  const lifted = {};
  const MARK = "\u2063";
  const wc = (s) => (String(s).match(/\S+/g) || []).length;
  const words = (s) => String(s || "").toLowerCase().replace(/[*_`#]/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const squash = (s) => String(s).toLowerCase().replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  const sim = (a, b) => {
    const x = new Set(words(a)), y = new Set(words(b));
    if (x.size < 3 || y.size < 3) return 0;
    let n = 0;
    x.forEach((w) => { if (y.has(w)) n++; });
    return n / (x.size + y.size - n);
  };
  const LABELS = "authors?|affiliations?|institution|subtitle|supersedes|edition|corresponding author|e-?mail|contact|orcid|isni|website|url|date|published|publication date|version|doi|license|keywords?|status|modified|last updated|robots|dc\\.rights";
  const META = new RegExp("^\\s*(?:[*_]{1,2})?(?:" + LABELS + ")(?:[*_]{1,2})?[ \\t]*:", "i");
  const metaLine = (l) => META.test(l) || /mailto:/i.test(l) || /^\s*https?:\/\/\S+\s*$/.test(l) || /^\s*[*_][^*_\n]*\b(?:QNFO|Quni|ORCID)\b[^*_\n]*[*_]\s*$/.test(l);
  const labelAnywhere = /\*\*(?:orcid|isni|doi|url|contact|e-?mail|version|date|affiliation|author)s?:?\*\*:?|orcid\.org|isni\.org/i;
  const isMeta = (b) => {
    const ls = b.split("\n");
    if (b.length > 900 || /^#/.test(ls[0])) return false;
    if (!metaLine(ls[0])) return false;
    return ls.filter((l) => metaLine(l) || labelAnywhere.test(l)).length * 2 >= ls.length;
  };
  // Labelled values of a metadata block, kept so canonicalLift can move keywords and a DOI to their columns.
  const readFields = (block) => {
    const re = new RegExp("(?:^|\\s)(?:\\*{1,2}|_{1,2})?(" + LABELS + ")(?:\\*{1,2}|_{1,2})?[ \\t]*:(?:\\*{1,2}|_{1,2})?[ \\t]*", "gi");
    const ms = Array.from(block.matchAll(re));
    ms.forEach((m, j) => {
      let key = m[1].toLowerCase();
      if (key === "keyword") key = "keywords";
      if (key === "e-mail" || key === "contact") key = "email";
      const v = block.slice(m.index + m[0].length, j + 1 < ms.length ? ms[j + 1].index : block.length).replace(/\s+/g, " ").trim();
      if (v && !lifted[key]) lifted[key] = v;
    });
  };

  // History sections. A heading is a history heading only when it is exactly one of these (no numbering, nothing after it),
  // and the section holds a version or a date, so "5. Release Notes", "What Changed in the Hamiltonian" and a scientific
  // "Change Log of the register" stay.
  const HIST_HEAD = /^(?:version history|revision history|revision notes|change ?log|correction notices?)$/i;
  const HIST_ENTRY = /^(?:v(?:ersion)?\s?\d+(?:\.\d+)+\b|\d{4}-\d{2}-\d{2}\b)/i;
  const HIST_TOKEN = /\b(?:v(?:ersion)?\s?\d+(?:\.\d+)*|\d{4}-\d{2}-\d{2})\b/i;
  const HIST_PROSE = /^\s*(?:\*\*)?(?:Version|Revision|v\d|Release|This (?:version|revision)|The previous|Previous|Changes?\b|Correct|Revised|Initial|Updated|\d{4}-\d{2}-\d{2})/i;
  const headText = (t) => t.replace(/[*_`]/g, "").replace(/[:.\s]+$/, "").trim();
  const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
  // The end (exclusive) of the history section that starts at heading line i: the next heading that is not a history heading or
  // an entry heading, or the first line that is not a list item, table row, rule, indented line or a line that opens like a
  // version note. Prose after the section is not part of it.
  const historyEnd = (lines, i) => {
    let j = i + 1, fence = "";
    for (; j < lines.length; j++) {
      const l = lines[j];
      const fm = FENCE.exec(l);
      if (fm) { if (!fence) fence = fm[1]; else if (fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = ""; continue; }
      if (fence) continue;
      const h = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(l);
      if (h) { const t = headText(h[2]); if (HIST_HEAD.test(t) || HIST_ENTRY.test(t)) continue; break; }
      if (!l.trim() || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l) || /^\s*(?:[-*+]|\d+[.)])\s+/.test(l) || /^\s*[|>]/.test(l) || /^\s{2,}\S/.test(l) || HIST_PROSE.test(l)) continue;
      break;
    }
    while (j > i + 1 && !lines[j - 1].trim()) j--;
    return j;
  };
  const cleanHistory = (text) => {
    const lines = text.split("\n");
    const out = [];
    let fence = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fm = FENCE.exec(line);
      if (fm) {
        if (!fence) fence = fm[1];
        else if (fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = "";
        out.push(line);
        continue;
      }
      if (fence) { out.push(line); continue; }
      const h = /^(#{2,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
      if (h && HIST_HEAD.test(headText(h[2]))) {
        const end = historyEnd(lines, i);
        const section = lines.slice(i + 1, end).join("\n");
        if (HIST_TOKEN.test(section)) {
          removed.push(h[2].trim());
          dropped += lines.slice(i, end).filter((l) => /^#{1,6}[ \t]+\S/.test(l)).length;
          removedWords += wc(section);
          i = end - 1;
          continue;
        }
      }
      // A revision banner is a blockquote opening with "Revised (version" or "Correction (version", with its continuation lines.
      if (/^>\s*\*\*(?:Revised|Correction|Revision)\s*\(version\b/i.test(line)) {
        let end = i;
        while (end + 1 < lines.length && /^>/.test(lines[end + 1])) end++;
        removedWords += wc(lines.slice(i, end + 1).join(" "));
        removed.push("banner");
        i = end;
        continue;
      }
      out.push(line);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
  };

  // The header zone: blocks between the title and the first prose block that are a byline, metadata, a bare URL or the title
  // said again (a level-2 heading that is the title, word for word). A level-2 subtitle heading, or a level-3 one straight
  // under the title that sits above a metadata block, becomes the italic subtitle line.
  const cleanHeader = (text, title) => {
    const blocks = text.replace(/\s+$/, "").split(/\n[ \t]*\n/);
    const isTitle = (b) => {
      const h = /^##[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(b);
      return !!h && b.indexOf("\n") < 0 && !/^abstract\b/i.test(h[1].replace(/[*_]/g, "").trim()) && !!title && sim(title, h[1]) >= 0.85;
    };
    const prose = (b) => !/^#{1,6}[ \t]/.test(b) && !/^\*[^*\n][\s\S]*\*$/.test(b) && !(b.length <= 300 && /^\*\*[^*]+\*\*$/.test(b)) && !isMeta(b) && !/^(?:-{3,}|\*{3,}|_{3,})$/.test(b.trim());
    let last = -1;
    for (let i = 1; i < Math.min(blocks.length, 10); i++) {
      if (/^#{1,6}[ \t]+(?:\d+(?:\.\d+)*[.)]?\s|abstract\b|introduction\b|chapter\b)/i.test(blocks[i].replace(/[*_]/g, ""))) break;
      if (prose(blocks[i])) break;
      if (isMeta(blocks[i]) || isTitle(blocks[i])) last = i;
    }
    const keep = [blocks[0]];
    let sub = blocks.length > 1 && /^\*[^*\n][\s\S]*\*$/.test(blocks[1]);
    for (let i = 1; i < blocks.length; i++) {
      const b = blocks[i];
      if (i <= last) {
        if (isMeta(b)) { readFields(b); removed.push("metadata"); continue; }
        if (isTitle(b)) { removed.push("repeated title"); dropped++; continue; }
        const h = /^(#{2,3})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(b);
        if (h && !sub && b.indexOf("\n") < 0 && words(h[2]).length <= 25 && (h[1].length === 2 || (i === 1 && i + 1 <= last && isMeta(blocks[i + 1])))) {
          keep.push("*" + h[2].replace(/[*_]/g, "").trim() + "*");
          sub = true;
          removed.push("subtitle heading");
          dropped++;
          continue;
        }
      }
      keep.push(b);
    }
    return keep.join("\n\n") + "\n";
  };

  // A paragraph that starts with a label such as "Status:" but is a sentence of the paper must survive formatPaper, which
  // removes labelled lines in a paper's opening. It gets an invisible mark that is taken out again at the end.
  const protectProse = (text) => {
    const fm = /^\s*---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text);
    const head = fm ? fm[0] : "";
    const rest = text.slice(head.length);
    let fence = "";
    const one = new RegExp("^\\s*(?:\\*{1,2}|_{1,2})?(?:" + LABELS + ")(?:\\*{1,2}|_{1,2})?[ \\t]*:(?:\\*{1,2}|_{1,2})?[ \\t]*([\\s\\S]*)$", "i");
    const blocks = rest.split(/\n[ \t]*\n/).map((b) => {
      b.split("\n").forEach((l) => { const m = FENCE.exec(l); if (m) { if (!fence) fence = m[1]; else if (m[1][0] === fence[0] && m[1].length >= fence.length) fence = ""; } });
      const m = one.exec(b);
      if (!m || fence) return b;
      const value = m[1].replace(/\s+/g, " ").trim();
      const labelsInBlock = (b.match(new RegExp("(?:^|\\s)(?:\\*{1,2}|_{1,2})?(?:" + LABELS + ")(?:\\*{1,2}|_{1,2})?[ \\t]*:", "gi")) || []).length;
      if (labelsInBlock === 1 && wc(value) >= 8 && /[.!?]["')\]]*$/.test(value)) return MARK + b;
      return b;
    });
    return head + blocks.join("\n\n");
  };

  // The labelled values formatPaper reads from a header on any pass are kept too (canonicalLift moves some of them to columns).
  const seen = {};
  const take = (ff) => Object.keys(ff.fields || {}).forEach((k) => { if (!(k in seen)) seen[k] = ff.fields[k]; });
  const first = formatPaper(protectProse(String(source || "").replace(/\r\n?/g, "\n")), rec);
  take(first);
  let f = first;
  let body = first.displayBody;
  for (let pass = 0; pass < 3; pass++) {
    const title = String(rec.title || f.title || "");
    let next = cleanHeader(body, title);
    if (!o.keepHistory) next = cleanHistory(next);
    f = formatPaper(next, rec);
    take(f);
    if (f.displayBody === body) break;
    body = f.displayBody;
  }
  body = body.split(MARK).join("");

  // formatPaper files the opening paragraph of a body that has no abstract under "## Abstract". When the record holds the real
  // abstract and the body's opening is not it, the heading goes and the record's abstract takes its place.
  const recAbs = String(rec.abstract || "").trim();
  if (recAbs && wc(recAbs) >= 20 && !first.explicitAbstract) {
    const key = squash(recAbs).slice(0, 80);
    const blocks = body.replace(/\s+$/, "").split(/\n[ \t]*\n/);
    let at = 1;
    if (blocks[at] && /^\*[^*\n][\s\S]*\*$/.test(blocks[at])) at++;
    const ai = blocks.findIndex((b, i) => i >= at && /^##[ \t]+Abstract[ \t]*$/i.test(b));
    if (ai >= 0 && ai === at) {
      const para = blocks[ai + 1] || "";
      if (!squash(para).startsWith(key)) {
        blocks.splice(ai, 1, "## Abstract", recAbs);
        removed.push("abstract from the record");
      }
    } else if (ai < 0) {
      const lead = blocks[at] || "";
      const inner = /^\*\*([^*]+)\*\*$/.exec(lead.trim());
      if (lead && !/^(?:#|\||```|~~~|\$\$|[-*+]\s|\d+[.)]\s)/.test(lead) && squash(lead).startsWith(key)) {
        blocks.splice(at, 1, "## Abstract", inner ? inner[1] : lead);
        removed.push("abstract heading added");
      } else {
        blocks.splice(at, 0, "## Abstract", recAbs);
        removed.push("abstract from the record");
      }
    } else if (ai > at) {
      // an Abstract heading further down is a section of the paper; leave the body alone
    }
    body = blocks.join("\n\n") + "\n";
    // The paragraph formatPaper had taken for the abstract stays as the opening of the paper.
  }
  const fields = Object.assign({}, lifted, seen);
  return { body, title: f.title, subtitle: f.subtitle, abstract: f.abstract, fields, removed, droppedHeadings: dropped, removedWords };
}

// The body to store: the canonical text only. Owner-written papers (identifier qnfo-2025-*) keep a history section of their own.
export function canonicalBody(md, record) {
  const r = record || {};
  return canonicalPaper(md, r, { keepHistory: String(r.identifier || "").indexOf("qnfo-2025-") === 0 }).body;
}

// What a header held that has a column to go to: keywords (as the JSON list the column uses) and a real DOI. Neither replaces a
// value the column already has; a DOI under the closed registry prefix 10.5281 or one that is not a DOI (a paper's own URL)
// is not carried. ORCID, ISNI, contact, affiliation and dates stay in the ledger copy of the previous body.
export function canonicalLift(fields, record) {
  const f = fields || {};
  const r = record || {};
  const out = {};
  if (f.keywords && !String(r.keywords || "").trim()) {
    const list = [];
    String(f.keywords).replace(/^\[|\]$/g, "").split(/[;,\u00b7]/).forEach((k) => {
      const t = k.replace(/[*_`"]/g, "").replace(/\s+/g, " ").trim();
      if (t && list.indexOf(t) < 0) list.push(t);
    });
    if (list.length && list.length <= 24 && list.every((k) => k.length <= 80)) out.keywords = JSON.stringify(list);
  }
  if (f.doi && !String(r.doi || "").trim()) {
    const m = /\b(10\.\d{4,9}\/[^\s"'<>)\]]+)/.exec(String(f.doi));
    const doi = m ? m[1].replace(/[.,;:]+$/, "") : "";
    if (doi && !/^10\.5281\//.test(doi)) out.doi = doi;
  }
  return out;
}

// Why a canonical body must not replace the stored one, or "" when it may. A body that lost more than 35% of its words, a
// reference list, or headings beyond the ones canonicalPaper dropped on purpose is left alone and counted as refused, and so
// is one whose removed history is more than 15% of the paper.
export function canonicalRefusal(before, c) {
  const src = String(before || "").replace(/\r\n?/g, "\n");
  const fm = /^\s*---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(src);
  const core = fm ? src.slice(fm[0].length) : src;
  const count = (s) => (String(s).match(/\S+/g) || []).length;
  const heads = (s) => {
    let n = 0, fence = "";
    String(s).split("\n").forEach((l) => {
      const m = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
      if (m) { if (!fence) fence = m[1]; else if (m[1][0] === fence[0] && m[1].length >= fence.length) fence = ""; return; }
      if (!fence && /^#{2,6}[ \t]+\S/.test(l)) n++;
    });
    return n;
  };
  const wb = count(core), wa = count(c.body);
  if (wb > 0 && (c.removedWords || 0) > wb * 0.15) return "removed history is " + Math.round(100 * c.removedWords / wb) + "% of the body";
  if (wb > 0 && wa < wb * 0.65) return "words " + wb + " -> " + wa + ", more than 35% lost";
  const hb = heads(core), ha = heads(c.body);
  if (ha + (c.droppedHeadings || 0) + 2 < hb) return "headings " + hb + " -> " + ha + " with " + (c.droppedHeadings || 0) + " dropped on purpose";
  const refs = /^#{1,6}[ \t]*(?:\d+\.?[ \t]*)?(?:references|bibliography|works cited)\b/im;
  if (refs.test(core) && !refs.test(c.body)) return "reference list lost";
  if (!/^# \S/.test(c.body)) return "no title line";
  return "";
}
